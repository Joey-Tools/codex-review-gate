import { createHash } from "node:crypto";

export const V2_EFFECT_STATUS_WAL_SCHEMA =
  "codex-review-gate-effect-status-wal-v2";
export const V2_EFFECT_STATUS_RECEIPT_SCHEMA =
  "codex-review-gate-effect-status-receipt-v2";
export const V2_EFFECT_STATUS_CONTEXT_PREFIX =
  "codex/github-review-gate-effect/";
export const MAX_V2_EFFECT_STATUS_RECORDS = 1_000;

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const TIMESTAMP =
  /^(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d{1,3}))?Z$/u;

/**
 * Append-only correctness authority for controller effects.
 *
 * Each effect owns one non-required HEAD context. A pending record binds the
 * exact intent digest before any protected network call; a later success
 * record on the same context binds the response digest. Mutable comments may
 * store the full payload, but they never consume, refund, or complete an
 * effect without this history.
 */
export function createV2GitHubEffectStatusWal({
  fetch: fetchImpl,
  token,
  repository,
  expected_creator,
  restBaseUrl = "https://api.github.com",
}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("effect status WAL requires fetch");
  }
  const authorization = boundedString(token, "token", 4096);
  const repo = normalizeRepository(repository);
  const creator = normalizeCreator(expected_creator, { closed: true });
  const base = normalizeRestBase(restBaseUrl);
  const repoPath = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;

  const wal = {
    async load({ head_ref_oid }) {
      const head = sha(head_ref_oid, "head_ref_oid");
      const inventory = await loadStatusInventory({
        fetchImpl,
        authorization,
        base,
        repoPath,
        head,
      });
      return projectWal(inventory, head, creator);
    },

    async persistIntent({ head_ref_oid, ordinal, intent_digest }) {
      const head = sha(head_ref_oid, "head_ref_oid");
      const expectedOrdinal = positiveInteger(ordinal, "ordinal");
      const intentDigest = digest(intent_digest, "intent_digest");
      const before = await wal.load({ head_ref_oid: head });
      if (expectedOrdinal !== before.next_ordinal) {
        throw new Error(
          `effect intent ordinal must be the next append-only ordinal ${before.next_ordinal}`,
        );
      }
      const capture = await createStatus({
        fetchImpl,
        authorization,
        base,
        repoPath,
        head,
        context: effectContext(expectedOrdinal),
        state: "pending",
        description: `intent:${intentDigest}`,
      });
      const created = normalizeStatus(capture.data, head, creator);
      if (
        created.ordinal !== expectedOrdinal ||
        created.phase !== "intent" ||
        created.digest !== intentDigest
      ) {
        throw new Error("created intent status did not echo its exact WAL identity");
      }
      const exact = await exactStatusRefetch({
        fetchImpl,
        authorization,
        base,
        repoPath,
        head,
        id: created.id,
      });
      const refetched = normalizeStatus(exact.status, head, creator);
      if (canonicalJson(refetched) !== canonicalJson(created)) {
        throw new Error("exact intent status refetch differs from its 201 response");
      }
      const after = await wal.load({ head_ref_oid: head });
      const record = after.records.find((candidate) =>
        candidate.ordinal === expectedOrdinal);
      if (
        record === undefined || record.intent.status_id !== created.id ||
        record.intent.digest !== intentDigest || record.response !== null
      ) {
        throw new Error("complete status history did not bind the new intent record");
      }
      return sealReceipt({
        phase: "intent",
        head_ref_oid: head,
        ordinal: expectedOrdinal,
        intent_digest: intentDigest,
        response_digest: null,
        status: created,
        create_server_time: capture.server_time,
        create_raw_body_sha256: rawDigest(capture.raw_body),
        refetch_server_time: exact.server_time,
        refetch_page_raw_body_sha256: exact.raw_body_sha256,
        inventory_digest: after.inventory_digest,
      });
    },

    async persistResponse({
      head_ref_oid,
      ordinal,
      intent_digest,
      response_digest,
    }) {
      const head = sha(head_ref_oid, "head_ref_oid");
      const expectedOrdinal = positiveInteger(ordinal, "ordinal");
      const intentDigest = digest(intent_digest, "intent_digest");
      const responseDigest = digest(response_digest, "response_digest");
      const before = await wal.load({ head_ref_oid: head });
      const prior = before.records.find((candidate) =>
        candidate.ordinal === expectedOrdinal);
      if (prior === undefined || prior.intent.digest !== intentDigest) {
        throw new Error("response status has no exact append-only intent authority");
      }
      if (prior.response !== null) {
        throw new Error("effect response ordinal is already consumed");
      }
      const capture = await createStatus({
        fetchImpl,
        authorization,
        base,
        repoPath,
        head,
        context: effectContext(expectedOrdinal),
        state: "success",
        description: `response:${responseDigest}`,
      });
      const created = normalizeStatus(capture.data, head, creator);
      if (
        created.ordinal !== expectedOrdinal ||
        created.phase !== "response" ||
        created.digest !== responseDigest
      ) {
        throw new Error("created response status did not echo its exact WAL identity");
      }
      const exact = await exactStatusRefetch({
        fetchImpl,
        authorization,
        base,
        repoPath,
        head,
        id: created.id,
      });
      const refetched = normalizeStatus(exact.status, head, creator);
      if (canonicalJson(refetched) !== canonicalJson(created)) {
        throw new Error("exact response status refetch differs from its 201 response");
      }
      const after = await wal.load({ head_ref_oid: head });
      const record = after.records.find((candidate) =>
        candidate.ordinal === expectedOrdinal);
      if (
        record?.response?.status_id !== created.id ||
        record.response.digest !== responseDigest ||
        record.intent.digest !== intentDigest
      ) {
        throw new Error("complete status history did not bind the new response record");
      }
      return sealReceipt({
        phase: "response",
        head_ref_oid: head,
        ordinal: expectedOrdinal,
        intent_digest: intentDigest,
        response_digest: responseDigest,
        status: created,
        create_server_time: capture.server_time,
        create_raw_body_sha256: rawDigest(capture.raw_body),
        refetch_server_time: exact.server_time,
        refetch_page_raw_body_sha256: exact.raw_body_sha256,
        inventory_digest: after.inventory_digest,
      });
    },
  };
  return Object.freeze(wal);
}

function projectWal(inventory, head, creator) {
  const byOrdinal = new Map();
  for (const raw of inventory.statuses) {
    const context = typeof raw?.context === "string" ? raw.context : "";
    if (!context.startsWith(V2_EFFECT_STATUS_CONTEXT_PREFIX)) continue;
    const status = normalizeStatus(raw, head, creator);
    const current = byOrdinal.get(status.ordinal) ?? {
      ordinal: status.ordinal,
      intent: null,
      response: null,
    };
    if (current[status.phase] !== null) {
      throw new Error(
        `effect status WAL repeats ${status.phase} for ordinal ${status.ordinal}`,
      );
    }
    current[status.phase] = statusRecord(status);
    byOrdinal.set(status.ordinal, current);
  }
  const ordinals = [...byOrdinal.keys()].sort((left, right) => left - right);
  if (ordinals.length > MAX_V2_EFFECT_STATUS_RECORDS / 2) {
    throw new Error("effect status WAL exceeds the fail-closed record cap");
  }
  const records = [];
  for (const [index, ordinal] of ordinals.entries()) {
    if (ordinal !== index + 1) {
      throw new Error("effect status WAL ordinals are not contiguous from one");
    }
    const record = byOrdinal.get(ordinal);
    if (record.intent === null) {
      throw new Error(`effect status WAL ordinal ${ordinal} has a response without intent`);
    }
    if (record.response !== null &&
        compareStatusOrder(record.intent, record.response) >= 0) {
      throw new Error(`effect status WAL ordinal ${ordinal} response is not after intent`);
    }
    records.push(deepFreeze(record));
  }
  const withoutDigest = {
    schema: V2_EFFECT_STATUS_WAL_SCHEMA,
    schema_version: 1,
    head_ref_oid: head,
    complete: true,
    status_count: inventory.statuses.length,
    record_count: records.length,
    next_ordinal: records.length + 1,
    creator,
    pages: inventory.pages,
    records,
  };
  return deepFreeze({
    ...withoutDigest,
    inventory_digest: digestCanonical(
      "codex-review-gate-v2-effect-status-inventory",
      withoutDigest,
    ),
  });
}

function normalizeStatus(raw, head, creator) {
  assertObject(raw, "effect status");
  const id = decimal(raw.id, "effect status.id");
  const statusHead = sha(raw.sha, "effect status.sha");
  if (statusHead !== head) {
    throw new Error("effect status belongs to another head");
  }
  const context = boundedString(raw.context, "effect status.context", 128);
  const ordinalText = context.slice(V2_EFFECT_STATUS_CONTEXT_PREFIX.length);
  if (!/^[1-9][0-9]*$/u.test(ordinalText)) {
    throw new Error("effect status context has a non-canonical ordinal");
  }
  const ordinal = positiveInteger(Number(ordinalText), "effect status.ordinal");
  if (effectContext(ordinal) !== context || ordinal > MAX_V2_EFFECT_STATUS_RECORDS / 2) {
    throw new Error("effect status context ordinal exceeds the closed WAL range");
  }
  const state = boundedString(raw.state, "effect status.state", 32);
  const description = boundedString(raw.description, "effect status.description", 140);
  let phase;
  let boundDigest;
  if (state === "pending" && description.startsWith("intent:")) {
    phase = "intent";
    boundDigest = description.slice("intent:".length);
  } else if (state === "success" && description.startsWith("response:")) {
    phase = "response";
    boundDigest = description.slice("response:".length);
  } else {
    throw new Error("effect status must be pending intent or successful response");
  }
  digest(boundDigest, `effect status ${phase} digest`);
  const actualCreator = normalizeCreator(raw.creator);
  const actualApp = raw?.performed_via_github_app === undefined
    ? null
    : normalizeStatusApp(raw.performed_via_github_app);
  if (canonicalJson(actualCreator) !== canonicalJson(creator)) {
    throw new Error("effect status creator does not match the source-pinned authority");
  }
  const createdAt = timestamp(raw.created_at, "effect status.created_at");
  const updatedAt = timestamp(raw.updated_at, "effect status.updated_at");
  if (createdAt !== updatedAt) {
    throw new Error("effect status record was not immutable at publication");
  }
  return deepFreeze({
    id,
    sha: statusHead,
    context,
    state,
    description,
    phase,
    digest: boundDigest,
    ordinal,
    creator: actualCreator,
    app: actualApp,
    created_at: createdAt,
    updated_at: updatedAt,
  });
}

function normalizeStatusApp(value) {
  if (value === null) return null;
  assertObject(value, "effect status app");
  return {
    id: decimal(value.id, "effect status app.id"),
    node_id: boundedString(value.node_id, "effect status app.node_id", 256),
    slug: boundedString(value.slug, "effect status app.slug", 128),
  };
}

function statusRecord(status) {
  return {
    status_id: status.id,
    digest: status.digest,
    created_at: status.created_at,
  };
}

function compareStatusOrder(left, right) {
  const time = Date.parse(left.created_at) - Date.parse(right.created_at);
  if (time !== 0) return time;
  return BigInt(left.status_id) < BigInt(right.status_id)
    ? -1
    : BigInt(left.status_id) > BigInt(right.status_id) ? 1 : 0;
}

function effectContext(ordinal) {
  return `${V2_EFFECT_STATUS_CONTEXT_PREFIX}${positiveInteger(ordinal, "ordinal")}`;
}

async function loadStatusInventory({
  fetchImpl,
  authorization,
  base,
  repoPath,
  head,
}) {
  const statuses = [];
  const pages = [];
  let previousTime = null;
  for (let page = 1; page <= 10; page += 1) {
    const capture = await requestJson({
      fetchImpl,
      authorization,
      base,
      method: "GET",
      path: `${repoPath}/commits/${head}/statuses?per_page=100&page=${page}`,
      expectedStatus: 200,
    });
    if (!Array.isArray(capture.data)) {
      throw new TypeError("effect status history response must be an array");
    }
    if (previousTime !== null && Date.parse(capture.server_time) < Date.parse(previousTime)) {
      throw new Error("effect status history server Date regressed across pagination");
    }
    previousTime = capture.server_time;
    statuses.push(...capture.data);
    pages.push({
      page,
      item_count: capture.data.length,
      response_server_time: capture.server_time,
      raw_body_sha256: rawDigest(capture.raw_body),
    });
    if (statuses.length > MAX_V2_EFFECT_STATUS_RECORDS) {
      throw new Error("effect status history exceeds the 1000-record safety cap");
    }
    if (capture.data.length < 100) {
      return { statuses, pages };
    }
  }
  throw new Error("effect status history pagination did not terminate within 1000 records");
}

async function createStatus({
  fetchImpl,
  authorization,
  base,
  repoPath,
  head,
  context,
  state,
  description,
}) {
  return requestJson({
    fetchImpl,
    authorization,
    base,
    method: "POST",
    path: `${repoPath}/statuses/${head}`,
    body: { state, context, description },
    expectedStatus: 201,
  });
}

async function exactStatusRefetch({
  fetchImpl,
  authorization,
  base,
  repoPath,
  head,
  id,
}) {
  let found = null;
  let receipt = null;
  for (let page = 1; page <= 10; page += 1) {
    const capture = await requestJson({
      fetchImpl,
      authorization,
      base,
      method: "GET",
      path: `${repoPath}/commits/${head}/statuses?per_page=100&page=${page}`,
      expectedStatus: 200,
    });
    if (!Array.isArray(capture.data)) {
      throw new TypeError("exact status history response must be an array");
    }
    for (const status of capture.data) {
      if (String(status.id) === id) {
        if (found !== null) {
          throw new Error("exact status identity appears more than once");
        }
        found = status;
        receipt = {
          server_time: capture.server_time,
          raw_body_sha256: rawDigest(capture.raw_body),
        };
      }
    }
    if (capture.data.length < 100) break;
    if (page === 10) {
      throw new Error("exact status refetch exceeds the 1000-record cap");
    }
  }
  if (found === null) {
    throw new Error("created effect status is absent from exact paginated history");
  }
  return { status: found, ...receipt };
}

function sealReceipt(value) {
  const withoutDigest = {
    schema: V2_EFFECT_STATUS_RECEIPT_SCHEMA,
    schema_version: 1,
    ...value,
  };
  return deepFreeze({
    ...withoutDigest,
    receipt_digest: digestCanonical(
      "codex-review-gate-v2-effect-status-receipt",
      withoutDigest,
    ),
  });
}

async function requestJson({
  fetchImpl,
  authorization,
  base,
  method,
  path,
  body = null,
  expectedStatus,
}) {
  const response = await fetchImpl(`${base}${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${authorization}`,
      "x-github-api-version": "2022-11-28",
      ...(body === null ? {} : { "content-type": "application/json" }),
    },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
  });
  if (response?.status !== expectedStatus) {
    throw new Error(
      `effect status WAL expected HTTP ${expectedStatus} and received ${response?.status}`,
    );
  }
  const serverTime = githubServerTime(response.headers?.get?.("date"));
  const rawBody = await response.text();
  let data;
  try {
    data = JSON.parse(rawBody);
  } catch (error) {
    throw new Error("effect status WAL response is not exact JSON", { cause: error });
  }
  return {
    http_status: response.status,
    server_time: serverTime,
    raw_body: rawBody,
    data,
  };
}

function normalizeRepository(value) {
  assertObject(value, "repository");
  exactKeys(value, ["owner", "name"], "repository");
  const part = /^[A-Za-z0-9_.-]{1,100}$/u;
  if (!part.test(value.owner) || !part.test(value.name)) {
    throw new TypeError("repository owner and name are not canonical GitHub parts");
  }
  return { owner: value.owner, name: value.name };
}

function normalizeCreator(value, { closed = false } = {}) {
  assertObject(value, "expected_creator");
  if (closed) {
    exactKeys(value, ["id", "node_id", "login", "type"], "expected_creator");
  }
  return {
    id: decimal(value.id, "expected_creator.id"),
    node_id: boundedString(value.node_id, "expected_creator.node_id", 256),
    login: boundedString(value.login, "expected_creator.login", 128),
    type: boundedString(value.type, "expected_creator.type", 32),
  };
}

function normalizeRestBase(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new TypeError("restBaseUrl must be an absolute HTTPS URL", { cause: error });
  }
  if (
    url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
    url.search !== "" || url.hash !== ""
  ) {
    throw new TypeError("restBaseUrl must be a credential-free HTTPS URL");
  }
  return url.href.replace(/\/$/u, "");
}

function githubServerTime(value) {
  const text = boundedString(value, "GitHub Date header", 128);
  const milliseconds = Date.parse(text);
  if (!Number.isFinite(milliseconds)) {
    throw new Error("GitHub response lacks a valid Date header");
  }
  return new Date(milliseconds).toISOString();
}

function timestamp(value, label) {
  if (typeof value !== "string" || !TIMESTAMP.test(value)) {
    throw new TypeError(`${label} must be a canonical UTC timestamp`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} is invalid`);
  return new Date(parsed).toISOString();
}

function sha(value, label) {
  if (typeof value !== "string" || !SHA.test(value)) {
    throw new TypeError(`${label} must be a lowercase full SHA`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} must be sha256:<64 lowercase hex>`);
  }
  return value;
}

function decimal(value, label) {
  const text = String(value);
  if (!DECIMAL.test(text)) throw new TypeError(`${label} must be a decimal id`);
  return text;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function boundedString(value, label, maximum) {
  if (
    typeof value !== "string" || value.length === 0 ||
    Buffer.byteLength(value, "utf8") > maximum
  ) {
    throw new TypeError(`${label} must be a non-empty bounded string`);
  }
  return value;
}

function assertObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(keys)) {
    throw new TypeError(`${label} must use the closed key set ${keys.join(", ")}`);
  }
}

function rawDigest(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function digestCanonical(domain, value) {
  return rawDigest(`${domain}\0${canonicalJson(value)}`);
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
