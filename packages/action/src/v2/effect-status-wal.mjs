import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { performance } from "node:perf_hooks";
import { setImmediate as nodeSetImmediate } from "node:timers";
import { TextDecoder, types as utilTypes } from "node:util";

export const V2_EFFECT_STATUS_WAL_SCHEMA =
  "codex-review-gate-effect-status-wal-v2";
export const V2_EFFECT_STATUS_RECEIPT_SCHEMA =
  "codex-review-gate-effect-status-receipt-v2";
export const V2_EFFECT_STATUS_CONTEXT_PREFIX =
  "codex/github-review-gate-effect/";
export const MAX_V2_EFFECT_STATUS_RECORDS = 1_000;

const MAX_V2_GITHUB_JSON_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_V2_GITHUB_JSON_RESPONSE_CHUNKS = 4_096;
const MAX_V2_GITHUB_JSON_OPERATION_BYTES = 16 * 1024 * 1024;
const V2_GITHUB_JSON_REQUEST_TIMEOUT_MS = 15_000;
const scheduleImmediateIntrinsic = nodeSetImmediate;
const reflectApplyIntrinsic = Reflect.apply;
const reflectOwnKeysIntrinsic = Reflect.ownKeys;
const objectGetOwnPropertyDescriptorIntrinsic = Object.getOwnPropertyDescriptor;
const objectHasOwnIntrinsic = Object.hasOwn;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "buffer",
).get;
const typedArrayByteOffsetGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteOffset",
).get;
const typedArrayByteLengthGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "byteLength",
).get;
const arrayBufferDetachedGetter = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "detached",
)?.get ?? null;
const arrayBufferResizableGetter = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "resizable",
)?.get ?? null;
const isArrayBufferIntrinsic = utilTypes.isArrayBuffer;
const isUint8ArrayIntrinsic = utilTypes.isUint8Array;
const uint8ArraySetIntrinsic = Uint8Array.prototype.set;

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

  async function loadWithBudget({ head_ref_oid }, responseBudget) {
    const head = sha(head_ref_oid, "head_ref_oid");
    const inventory = await loadStatusInventory({
      fetchImpl,
      authorization,
      base,
      repoPath,
      head,
      responseBudget,
    });
    return projectWal(inventory, head, creator);
  }

  const wal = {
    load(input) {
      return loadWithBudget(input, createGithubJsonResponseBudget());
    },

    async persistIntent({ head_ref_oid, ordinal, intent_digest }) {
      const responseBudget = createGithubJsonResponseBudget();
      const head = sha(head_ref_oid, "head_ref_oid");
      const expectedOrdinal = positiveInteger(ordinal, "ordinal");
      const intentDigest = digest(intent_digest, "intent_digest");
      const before = await loadWithBudget({ head_ref_oid: head }, responseBudget);
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
        responseBudget,
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
        responseBudget,
      });
      const refetched = normalizeStatus(exact.status, head, creator);
      if (canonicalJson(refetched) !== canonicalJson(created)) {
        throw new Error("exact intent status refetch differs from its 201 response");
      }
      const after = await loadWithBudget({ head_ref_oid: head }, responseBudget);
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
        create_raw_body_sha256: capture.raw_body_sha256,
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
      const responseBudget = createGithubJsonResponseBudget();
      const head = sha(head_ref_oid, "head_ref_oid");
      const expectedOrdinal = positiveInteger(ordinal, "ordinal");
      const intentDigest = digest(intent_digest, "intent_digest");
      const responseDigest = digest(response_digest, "response_digest");
      const before = await loadWithBudget({ head_ref_oid: head }, responseBudget);
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
        responseBudget,
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
        responseBudget,
      });
      const refetched = normalizeStatus(exact.status, head, creator);
      if (canonicalJson(refetched) !== canonicalJson(created)) {
        throw new Error("exact response status refetch differs from its 201 response");
      }
      const after = await loadWithBudget({ head_ref_oid: head }, responseBudget);
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
        create_raw_body_sha256: capture.raw_body_sha256,
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
  responseBudget,
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
      expectedShape: "array",
      responseBudget,
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
      raw_body_sha256: capture.raw_body_sha256,
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
  responseBudget,
}) {
  return requestJson({
    fetchImpl,
    authorization,
    base,
    method: "POST",
    path: `${repoPath}/statuses/${head}`,
    body: { state, context, description },
    expectedStatus: 201,
    expectedShape: "object",
    responseBudget,
  });
}

async function exactStatusRefetch({
  fetchImpl,
  authorization,
  base,
  repoPath,
  head,
  id,
  responseBudget,
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
      expectedShape: "array",
      responseBudget,
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
          raw_body_sha256: capture.raw_body_sha256,
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
  expectedShape,
  responseBudget,
}) {
  const label = "effect status WAL response";
  const deadline = createGithubJsonRequestDeadline(label);
  let response = null;
  let bodyConsumed = false;
  let completed = false;
  try {
    response = await deadline.wait(() => fetchImpl(
      `${base}${path}`,
      {
        method,
        signal: deadline.signal,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${authorization}`,
          "x-github-api-version": "2022-11-28",
          ...(body === null ? {} : { "content-type": "application/json" }),
        },
        ...(body === null ? {} : { body: JSON.stringify(body) }),
      },
    ), cancelResponseBody);
    if (response?.status !== expectedStatus) {
      throw new Error(
        `effect status WAL expected HTTP ${expectedStatus} and received ${response?.status}`,
      );
    }
    const serverTime = githubServerTime(response.headers?.get?.("date"));
    const {
      raw_body: rawBody,
      raw_body_sha256: rawBodySha256,
    } = await readBoundedUtf8Response(
      response,
      label,
      responseBudget,
      deadline,
    );
    bodyConsumed = true;
    deadline.assertOpen();
    let data;
    try {
      data = JSON.parse(rawBody);
    } catch (error) {
      throw new Error("effect status WAL response is not exact JSON", { cause: error });
    }
    if (
      (expectedShape === "array" && !Array.isArray(data)) ||
      (expectedShape === "object" &&
        (data === null || typeof data !== "object" || Array.isArray(data)))
    ) {
      throw new TypeError(
        `effect status WAL response must be a top-level ${expectedShape}`,
      );
    }
    const capture = {
      http_status: response.status,
      server_time: serverTime,
      raw_body: rawBody,
      raw_body_sha256: rawBodySha256,
      data,
    };
    deadline.assertOpen();
    completed = true;
    return capture;
  } finally {
    if (response !== null && !bodyConsumed) {
      cancelResponseBodyBestEffort(response);
    }
    deadline.finish(completed);
  }
}

async function readBoundedUtf8Response(
  response,
  label,
  responseBudget,
  deadline,
) {
  assertGithubJsonResponseBudget(responseBudget);
  const contentLength = response?.headers?.get?.("content-length");
  let declaredBytes = 0;
  if (contentLength !== null && contentLength !== undefined) {
    if (
      typeof contentLength !== "string" ||
      !/^(?:0|[1-9][0-9]*)$/u.test(contentLength)
    ) {
      throw new Error(`${label} has a malformed Content-Length`);
    }
    if (BigInt(contentLength) > BigInt(MAX_V2_GITHUB_JSON_RESPONSE_BYTES)) {
      throw new Error(
        `${label} exceeds the ${MAX_V2_GITHUB_JSON_RESPONSE_BYTES}-byte cap`,
      );
    }
    declaredBytes = Number(contentLength);
    if (
      responseBudget.bytes + declaredBytes >
      MAX_V2_GITHUB_JSON_OPERATION_BYTES
    ) {
      throw new Error(
        `${label} exceeds the ${MAX_V2_GITHUB_JSON_OPERATION_BYTES}-byte aggregate budget`,
      );
    }
  }
  let reader = null;
  const chunks = [];
  let chunkCount = 0;
  let totalBytes = 0;
  let complete = false;
  try {
    reader = response?.body?.getReader?.();
    if (reader === undefined || reader === null || typeof reader.read !== "function") {
      throw new Error(`${label} body is not a readable byte stream`);
    }
    while (true) {
      const result = await deadline.wait(() => reader.read());
      const { done, value } = snapshotClosedByteStreamReadResult(
        result,
        () => new Error(`${label} byte stream returned a malformed read result`),
      );
      if (done) {
        complete = true;
        break;
      }
      chunkCount += 1;
      if (chunkCount > MAX_V2_GITHUB_JSON_RESPONSE_CHUNKS) {
        throw new Error(
          `${label} exceeds the ${MAX_V2_GITHUB_JSON_RESPONSE_CHUNKS}-chunk cap`,
        );
      }
      const view = inspectFixedUint8ArrayChunk(
        value,
        () => new Error(`${label} byte stream returned a non-byte chunk`),
      );
      if (view.byte_length > MAX_V2_GITHUB_JSON_RESPONSE_BYTES - totalBytes) {
        throw new Error(
          `${label} exceeds the ${MAX_V2_GITHUB_JSON_RESPONSE_BYTES}-byte cap`,
        );
      }
      const nextTotalBytes = totalBytes + view.byte_length;
      if (
        responseBudget.bytes + Math.max(declaredBytes, nextTotalBytes) >
        MAX_V2_GITHUB_JSON_OPERATION_BYTES
      ) {
        throw new Error(
          `${label} exceeds the ${MAX_V2_GITHUB_JSON_OPERATION_BYTES}-byte aggregate budget`,
        );
      }
      const chunk = snapshotFixedUint8ArrayChunk(
        value,
        view,
        () => new Error(`${label} byte stream returned an unstable byte chunk`),
      );
      totalBytes += chunk.length;
      chunks.push(chunk);
    }
  } finally {
    if (reader !== null) {
      cleanupReaderBestEffort(reader, !complete);
    }
  }
  deadline.assertOpen();
  responseBudget.bytes += Math.max(declaredBytes, totalBytes);
  const rawBytes = Buffer.concat(chunks, totalBytes);
  let rawBody;
  try {
    rawBody = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(rawBytes);
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8`, { cause: error });
  }
  const rawBodySha256 = rawDigest(rawBytes);
  deadline.assertOpen();
  return {
    raw_body: rawBody,
    raw_body_sha256: rawBodySha256,
  };
}

function snapshotClosedByteStreamReadResult(result, failure) {
  if (result === null || typeof result !== "object") throw failure();
  let keys;
  let doneDescriptor;
  let valueDescriptor;
  try {
    keys = reflectOwnKeysIntrinsic(result);
    doneDescriptor = objectGetOwnPropertyDescriptorIntrinsic(result, "done");
    valueDescriptor = objectGetOwnPropertyDescriptorIntrinsic(result, "value");
  } catch {
    throw failure();
  }
  const exactKeys = keys.length === 2 && (
    (keys[0] === "done" && keys[1] === "value") ||
    (keys[0] === "value" && keys[1] === "done")
  );
  if (
    !exactKeys || doneDescriptor === undefined || valueDescriptor === undefined ||
    !objectHasOwnIntrinsic(doneDescriptor, "value") ||
    !objectHasOwnIntrinsic(valueDescriptor, "value")
  ) {
    throw failure();
  }
  const done = doneDescriptor.value;
  const value = valueDescriptor.value;
  if (typeof done !== "boolean" || (done && value !== undefined)) throw failure();
  return { done, value };
}

function inspectFixedUint8ArrayChunk(value, failure) {
  try {
    if (!reflectApplyIntrinsic(isUint8ArrayIntrinsic, utilTypes, [value])) {
      throw new TypeError("not Uint8Array");
    }
    const backing = reflectApplyIntrinsic(typedArrayBufferGetter, value, []);
    const byteOffset = reflectApplyIntrinsic(typedArrayByteOffsetGetter, value, []);
    const byteLength = reflectApplyIntrinsic(typedArrayByteLengthGetter, value, []);
    const detached = arrayBufferDetachedGetter === null
      ? false
      : reflectApplyIntrinsic(arrayBufferDetachedGetter, backing, []);
    const resizable = arrayBufferResizableGetter === null
      ? false
      : reflectApplyIntrinsic(arrayBufferResizableGetter, backing, []);
    if (
      !reflectApplyIntrinsic(isArrayBufferIntrinsic, utilTypes, [backing]) ||
      detached || resizable
    ) {
      throw new TypeError("not fixed ordinary ArrayBuffer backing");
    }
    return {
      backing,
      byte_offset: byteOffset,
      byte_length: byteLength,
    };
  } catch {
    throw failure();
  }
}

function snapshotFixedUint8ArrayChunk(value, expected, failure) {
  try {
    const before = inspectFixedUint8ArrayChunk(value, failure);
    if (
      before.backing !== expected.backing ||
      before.byte_offset !== expected.byte_offset ||
      before.byte_length !== expected.byte_length
    ) {
      throw new TypeError("chunk changed before snapshot");
    }
    const snapshot = Buffer.alloc(expected.byte_length);
    reflectApplyIntrinsic(uint8ArraySetIntrinsic, snapshot, [value, 0]);
    const after = inspectFixedUint8ArrayChunk(value, failure);
    if (
      after.backing !== expected.backing ||
      after.byte_offset !== expected.byte_offset ||
      after.byte_length !== expected.byte_length
    ) {
      throw new TypeError("chunk changed during snapshot");
    }
    return snapshot;
  } catch {
    throw failure();
  }
}

function createGithubJsonResponseBudget() {
  return { bytes: 0 };
}

function assertGithubJsonResponseBudget(value) {
  if (
    value === null || typeof value !== "object" ||
    !Number.isSafeInteger(value.bytes) || value.bytes < 0 ||
    value.bytes > MAX_V2_GITHUB_JSON_OPERATION_BYTES
  ) {
    throw new TypeError("GitHub JSON response budget is invalid");
  }
}

const GITHUB_JSON_DEADLINE_TERMINATED = Symbol("github-json-deadline-terminated");

function createGithubJsonRequestDeadline(label) {
  const controller = new AbortController();
  const expiresAt = performance.now() + V2_GITHUB_JSON_REQUEST_TIMEOUT_MS;
  const timeoutError = new Error(
    `${label} exceeded its fixed ${V2_GITHUB_JSON_REQUEST_TIMEOUT_MS}ms request deadline`,
  );
  let expired = false;
  let finished = false;
  let adapterAbortScheduled = false;
  let resolveTermination;
  const termination = new Promise((resolvePromise) => {
    resolveTermination = resolvePromise;
  });
  const expire = () => {
    if (expired || finished) return;
    expired = true;
    resolveTermination(GITHUB_JSON_DEADLINE_TERMINATED);
    if (!adapterAbortScheduled) {
      adapterAbortScheduled = true;
      startDeferredBestEffort(() => controller.abort(
        new Error("effect status WAL adapter cancelled after terminal deadline"),
      ));
    }
  };
  const timer = setTimeout(expire, V2_GITHUB_JSON_REQUEST_TIMEOUT_MS);
  const deadline = {
    signal: controller.signal,
    termination,
    expiredOrElapsed() {
      if (!expired && githubJsonDeadlineExpired(expiresAt)) expire();
      return expired;
    },
    assertOpen() {
      if (deadline.expiredOrElapsed()) throw timeoutError;
    },
    wait(operationFactory, onLateValue = null) {
      if (deadline.expiredOrElapsed()) {
        return Promise.reject(timeoutError);
      }
      let operation;
      try {
        operation = operationFactory();
      } catch (error) {
        if (deadline.expiredOrElapsed()) {
          return Promise.reject(timeoutError);
        }
        return Promise.reject(error);
      }
      return waitForGithubJsonDeadline(
        operation,
        deadline,
        timeoutError,
        onLateValue,
      );
    },
    finish(requireOpen = false) {
      try {
        if (requireOpen) deadline.assertOpen();
      } finally {
        finished = true;
        clearTimeout(timer);
      }
    },
  };
  return deadline;
}

async function waitForGithubJsonDeadline(
  promise,
  deadline,
  timeoutError,
  onLateValue,
) {
  const operation = Promise.resolve(promise).then(
    (value) => ({ state: "fulfilled", value }),
    (error) => ({ state: "rejected", error }),
  );
  if (deadline.expiredOrElapsed()) {
    discardLateGithubJsonValue(operation, onLateValue);
    throw timeoutError;
  }
  const outcome = await Promise.race([operation, deadline.termination]);
  if (
    outcome === GITHUB_JSON_DEADLINE_TERMINATED ||
    deadline.expiredOrElapsed()
  ) {
    if (outcome === GITHUB_JSON_DEADLINE_TERMINATED) {
      discardLateGithubJsonValue(operation, onLateValue);
    } else if (outcome.state === "fulfilled" && onLateValue !== null) {
      startDeferredBestEffort(onLateValue, outcome.value);
    }
    throw timeoutError;
  }
  if (outcome.state === "rejected") throw outcome.error;
  return outcome.value;
}

function discardLateGithubJsonValue(operation, onLateValue) {
  if (onLateValue === null) return;
  operation.then((outcome) => {
    if (outcome.state === "fulfilled") {
      startDeferredBestEffort(onLateValue, outcome.value);
    }
  }, () => {});
}

function githubJsonDeadlineExpired(expiresAt) {
  return performance.now() >= expiresAt;
}

function startDeferredBestEffort(action, value = undefined) {
  if (typeof action !== "function") return;
  try {
    let invoked = false;
    scheduleImmediateIntrinsic(() => {
      if (invoked) return;
      invoked = true;
      try {
        Promise.resolve(action(value)).catch(() => {});
      } catch {
        // Deferred cleanup cannot replace the authoritative WAL result.
      }
    });
  } catch {
    // Cleanup scheduling is best-effort after the result has settled.
  }
}

function cleanupReaderBestEffort(reader, shouldCancel) {
  startDeferredBestEffort(() => {
    if (shouldCancel) {
      try {
        const cancel = reader?.cancel;
        if (typeof cancel === "function") {
          Promise.resolve(cancel.call(reader)).catch(() => {});
        }
      } catch {
        // Cancellation cannot replace the primary WAL result.
      }
    }
    try {
      const releaseLock = reader?.releaseLock;
      if (typeof releaseLock === "function") {
        Promise.resolve(releaseLock.call(reader)).catch(() => {});
      }
    } catch {
      // Lock release cannot replace the primary WAL result.
    }
  });
}

function cancelResponseBody(response) {
  const body = response?.body;
  const cancel = body?.cancel;
  if (typeof cancel === "function") {
    return cancel.call(body);
  }
  return undefined;
}

function cancelResponseBodyBestEffort(response) {
  startDeferredBestEffort(cancelResponseBody, response);
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
