import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

export const V2_CANDIDATE_INVENTORY_SCHEMA =
  "codex-review-gate-candidate-inventory-v2";
export const V2_CANDIDATE_SHARD_RECEIPT_SCHEMA =
  "codex-review-gate-candidate-shard-receipt-v2";
export const V2_CANDIDATE_CYCLE_RECEIPT_SCHEMA =
  "codex-review-gate-candidate-cycle-receipt-v2";
export const MAX_V2_CANDIDATES_PER_SHARD = 256;
export const MAX_V2_CANDIDATE_PAGES = 256;
export const MAX_V2_CANDIDATE_SCAN_PASSES = 6;
export const MAX_V2_CANDIDATE_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_V2_CANDIDATE_TOTAL_BYTES = 128 * 1024 * 1024;
export const V2_CANDIDATE_HTTP_TIMEOUT_MS = 15_000;

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const TIMESTAMP =
  /^(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d{1,3}))?Z$/u;

export class V2CandidateInventoryError extends Error {
  constructor(code, message, details = null, cause = undefined) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "V2CandidateInventoryError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Build the read-only private-schedule inventory transport.
 *
 * The protected property is candidate-set completeness at the final point
 * reads. Candidate identity uses immutable PR id/node/number/created_at fields;
 * mutable lifecycle metadata is deliberately exact-refetched per shard. A
 * close/reopen transition therefore cannot remove or reorder a candidate.
 */
export function createV2GitHubCandidateInventory({
  fetch: fetchImpl,
  token,
  repository,
  restBaseUrl = "https://api.github.com",
  timeoutMs = V2_CANDIDATE_HTTP_TIMEOUT_MS,
  maxPages = MAX_V2_CANDIDATE_PAGES,
  maxPasses = MAX_V2_CANDIDATE_SCAN_PASSES,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("candidate inventory requires fetch");
  }
  const authorization = boundedString(token, "candidate inventory token", 4096);
  const repo = normalizeRepository(repository);
  const base = normalizeRestBase(restBaseUrl);
  const limits = normalizeLimits({ timeoutMs, maxPages, maxPasses });
  const repoPath = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;

  return Object.freeze({
    async scan({ prior_inventory = null } = {}) {
      const prior = prior_inventory === null
        ? null
        : validateV2CandidateInventory(prior_inventory, repo);
      const budget = { bytes: 0, requests: 0 };
      const passes = [];
      let previous = null;
      let stable = null;
      for (let pass = 1; pass <= limits.max_passes; pass += 1) {
        const current = await scanOnePass({
          fetchImpl,
          authorization,
          base,
          repoPath,
          repo,
          pass,
          budget,
          limits,
        });
        passes.push(current.receipt);
        if (
          previous !== null &&
          current.receipt.candidate_digest === previous.receipt.candidate_digest &&
          canonicalJson(current.candidates) === canonicalJson(previous.candidates)
        ) {
          stable = current;
          break;
        }
        previous = current;
      }
      if (stable === null) {
        throw inventoryError(
          "CANDIDATE_INVENTORY_UNSTABLE",
          "state=all candidate inventory did not stabilize within the pass cap",
          { passes: passes.length },
        );
      }
      const merged = mergeCandidateSuperset(
        prior?.candidates ?? [],
        stable.candidates,
      );
      const retainedPrior = merged.filter((candidate) =>
        !stable.candidates.some((current) => current.id === candidate.id));
      const shards = buildShards(merged);
      const observedAt = passes.at(-1).observed_at;
      const withoutDigest = {
        schema: V2_CANDIDATE_INVENTORY_SCHEMA,
        schema_version: 1,
        repository: repo,
        query: {
          state: "all",
          sort: "created",
          direction: "asc",
          per_page: 100,
        },
        prior_inventory_digest: prior?.receipt_digest ?? null,
        candidates: merged,
        candidate_digest: digestCanonical(
          "codex-review-gate-v2-candidate-identities",
          merged,
        ),
        high_watermark: merged.at(-1) ?? null,
        retained_prior_candidate_ids: retainedPrior
          .map(({ id }) => id)
          .sort(decimalCompare),
        passes,
        shards,
        observed_at: observedAt,
        stable: true,
        completeness: "stable-state-all-candidate-superset",
      };
      const receipt = deepFreeze({
        ...withoutDigest,
        receipt_digest: digestCanonical(
          "codex-review-gate-v2-candidate-inventory",
          withoutDigest,
        ),
      });
      validateV2CandidateInventory(receipt, repo);
      return receipt;
    },

    async readShard({ inventory, shard_index }) {
      const selected = validateV2CandidateInventory(inventory, repo);
      if (!Number.isSafeInteger(shard_index) || shard_index < 0 ||
          shard_index >= selected.shards.length) {
        throw new TypeError("candidate shard index is outside the inventory");
      }
      const shard = selected.shards[shard_index];
      const budget = { bytes: 0, requests: 0 };
      const observations = [];
      for (const candidate of shard.candidates) {
        const capture = await jsonRequest({
          fetchImpl,
          authorization,
          base,
          path: `${repoPath}/pulls/${candidate.number}`,
          budget,
          timeoutMs: limits.timeout_ms,
          label: `pull request ${candidate.number}`,
        });
        const observation = normalizePullRequest(capture.data, {
          candidate,
          repository: repo,
          apiOrigin: base.origin,
        });
        observations.push({
          ...observation,
          endpoint_receipt: capture.receipt,
        });
      }
      const observedAt = observations.at(-1)?.endpoint_receipt.server_time ??
        selected.observed_at;
      const withoutDigest = {
        schema: V2_CANDIDATE_SHARD_RECEIPT_SCHEMA,
        schema_version: 1,
        repository: repo,
        inventory_receipt_digest: selected.receipt_digest,
        shard_index,
        shard_digest: shard.shard_digest,
        candidates: structuredClone(shard.candidates),
        observations,
        observed_at: observedAt,
        stable: true,
      };
      const receipt = deepFreeze({
        ...withoutDigest,
        receipt_digest: digestCanonical(
          "codex-review-gate-v2-candidate-shard",
          withoutDigest,
        ),
      });
      validateV2CandidateShardReceipt(receipt, selected);
      return receipt;
    },
  });
}

/**
 * Close one point-in-time scan cycle after every deterministic shard has been
 * exact-refetched and a final stable state=all scan retained the same superset.
 */
export function finalizeV2CandidateInventoryCycle({
  initial_inventory,
  shard_receipts,
  final_inventory,
}) {
  const initial = validateV2CandidateInventory(initial_inventory);
  const final = validateV2CandidateInventory(
    final_inventory,
    initial.repository,
  );
  if (
    final.prior_inventory_digest !== initial.receipt_digest ||
    initial.candidate_digest !== final.candidate_digest ||
    canonicalJson(initial.candidates) !== canonicalJson(final.candidates)
  ) {
    throw inventoryError(
      "CANDIDATE_INVENTORY_DRIFT",
      "candidate superset changed during exact lifecycle reads",
    );
  }
  if (!Array.isArray(shard_receipts) ||
      shard_receipts.length !== initial.shards.length) {
    throw inventoryError(
      "CANDIDATE_SHARDS_INCOMPLETE",
      "every candidate shard must have one exact lifecycle receipt",
    );
  }
  const byIndex = new Map();
  for (const value of shard_receipts) {
    const receipt = validateV2CandidateShardReceipt(value, initial);
    if (byIndex.has(receipt.shard_index)) {
      throw inventoryError(
        "CANDIDATE_SHARD_DUPLICATE",
        "candidate shard receipt index is duplicated",
      );
    }
    byIndex.set(receipt.shard_index, receipt);
  }
  const ordered = initial.shards.map((_, index) => {
    const receipt = byIndex.get(index);
    if (receipt === undefined) {
      throw inventoryError(
        "CANDIDATE_SHARDS_INCOMPLETE",
        "candidate shard receipt is missing",
        { shard_index: index },
      );
    }
    return receipt;
  });
  const observations = ordered.flatMap((receipt) => receipt.observations);
  if (observations.length !== initial.candidates.length) {
    throw inventoryError(
      "CANDIDATE_SHARDS_INCOMPLETE",
      "candidate shard observations do not cover the full superset",
    );
  }
  const openPullRequests = observations
    .filter((observation) =>
      observation.state === "open" &&
      observation.merged === false &&
      observation.merged_at === null)
    .map((observation) => structuredClone(observation));
  const withoutDigest = {
    schema: V2_CANDIDATE_CYCLE_RECEIPT_SCHEMA,
    schema_version: 1,
    repository: structuredClone(initial.repository),
    initial_inventory_receipt_digest: initial.receipt_digest,
    final_inventory_receipt_digest: final.receipt_digest,
    candidate_digest: initial.candidate_digest,
    shard_receipt_digests: ordered.map(({ receipt_digest }) => receipt_digest),
    open_pull_requests: openPullRequests,
    observed_at: final.observed_at,
    stable: true,
    completeness: "point-in-time-all-open-pull-requests",
  };
  return deepFreeze({
    ...withoutDigest,
    receipt_digest: digestCanonical(
      "codex-review-gate-v2-candidate-cycle",
      withoutDigest,
    ),
  });
}

export function validateV2CandidateCycleReceipt(value) {
  assertObject(value, "candidate cycle receipt");
  exactKeys(value, [
    "schema", "schema_version", "repository",
    "initial_inventory_receipt_digest", "final_inventory_receipt_digest",
    "candidate_digest", "shard_receipt_digests", "open_pull_requests",
    "observed_at", "stable", "completeness", "receipt_digest",
  ], "candidate cycle receipt");
  if (
    value.schema !== V2_CANDIDATE_CYCLE_RECEIPT_SCHEMA ||
    value.schema_version !== 1 || value.stable !== true ||
    value.completeness !== "point-in-time-all-open-pull-requests"
  ) {
    throw new TypeError("candidate cycle receipt schema or assurance is invalid");
  }
  const repository = normalizeRepository(value.repository);
  digest(value.initial_inventory_receipt_digest,
    "candidate cycle initial inventory digest");
  digest(value.final_inventory_receipt_digest,
    "candidate cycle final inventory digest");
  digest(value.candidate_digest, "candidate cycle candidate digest");
  if (!Array.isArray(value.shard_receipt_digests)) {
    throw new TypeError("candidate cycle shard digests must be an array");
  }
  value.shard_receipt_digests.forEach((entry, index) =>
    digest(entry, `candidate cycle shard digest[${index}]`));
  if (new Set(value.shard_receipt_digests).size !==
      value.shard_receipt_digests.length) {
    throw new TypeError("candidate cycle shard receipt digests must be unique");
  }
  if (!Array.isArray(value.open_pull_requests)) {
    throw new TypeError("candidate cycle open pull requests must be an array");
  }
  const openPullRequests = value.open_pull_requests.map((observation, index) => {
    assertObject(observation, `candidate cycle open pull request ${index}`);
    const candidate = normalizeCandidate({
      id: observation.id,
      node_id: observation.node_id,
      number: observation.number,
      created_at: observation.created_at,
    }, `candidate cycle open pull request ${index}`);
    const normalized = normalizeStoredPullObservation(observation, {
      candidate,
      repository,
    });
    if (normalized.state !== "open" || normalized.merged ||
        normalized.merged_at !== null) {
      throw new Error("candidate cycle output may contain only current open PRs");
    }
    return normalized;
  });
  for (let index = 1; index < openPullRequests.length; index += 1) {
    if (compareCandidate(openPullRequests[index - 1], openPullRequests[index]) >= 0) {
      throw new Error("candidate cycle open PRs must retain canonical candidate order");
    }
  }
  timestamp(value.observed_at, "candidate cycle observed_at");
  digest(value.receipt_digest, "candidate cycle receipt digest");
  const { receipt_digest: _receiptDigest, ...withoutDigest } = value;
  if (value.receipt_digest !== digestCanonical(
    "codex-review-gate-v2-candidate-cycle", withoutDigest)) {
    throw new Error("candidate cycle receipt digest is invalid");
  }
  return deepFreeze({ ...structuredClone(value), repository, open_pull_requests: openPullRequests });
}

export function validateV2CandidateInventory(value, expectedRepository = null) {
  assertObject(value, "candidate inventory");
  exactKeys(value, [
    "schema", "schema_version", "repository", "query",
    "prior_inventory_digest", "candidates", "candidate_digest",
    "high_watermark", "retained_prior_candidate_ids", "passes", "shards",
    "observed_at", "stable", "completeness", "receipt_digest",
  ], "candidate inventory");
  if (
    value.schema !== V2_CANDIDATE_INVENTORY_SCHEMA ||
    value.schema_version !== 1 || value.stable !== true ||
    value.completeness !== "stable-state-all-candidate-superset"
  ) {
    throw new TypeError("candidate inventory schema or assurance is invalid");
  }
  const repository = normalizeRepository(value.repository);
  if (expectedRepository !== null &&
      canonicalJson(repository) !== canonicalJson(normalizeRepository(expectedRepository))) {
    throw new TypeError("candidate inventory repository differs from expected scope");
  }
  assertObject(value.query, "candidate inventory query");
  exactKeys(value.query, ["state", "sort", "direction", "per_page"],
    "candidate inventory query");
  if (canonicalJson(value.query) !== canonicalJson({
    state: "all", sort: "created", direction: "asc", per_page: 100,
  })) {
    throw new TypeError("candidate inventory query is not the fixed all-state scan");
  }
  if (value.prior_inventory_digest !== null) {
    digest(value.prior_inventory_digest, "candidate inventory prior digest");
  }
  const candidates = normalizeCandidates(value.candidates);
  digest(value.candidate_digest, "candidate inventory candidate digest");
  if (value.candidate_digest !== digestCanonical(
    "codex-review-gate-v2-candidate-identities", candidates)) {
    throw new Error("candidate inventory candidate digest is invalid");
  }
  const highWatermark = value.high_watermark === null
    ? null
    : normalizeCandidate(value.high_watermark, "candidate inventory high watermark");
  if (canonicalJson(highWatermark) !== canonicalJson(candidates.at(-1) ?? null)) {
    throw new Error("candidate inventory high watermark is invalid");
  }
  const retained = normalizeUniqueDecimals(
    value.retained_prior_candidate_ids,
    "candidate inventory retained ids",
  );
  for (const id of retained) {
    if (!candidates.some((candidate) => candidate.id === id)) {
      throw new Error("candidate inventory retained id is outside the superset");
    }
  }
  if (!Array.isArray(value.passes) || value.passes.length < 2 ||
      value.passes.length > MAX_V2_CANDIDATE_SCAN_PASSES) {
    throw new TypeError("candidate inventory requires bounded stable scan passes");
  }
  const passes = value.passes.map((pass, index) =>
    normalizePassReceipt(pass, repository, index + 1));
  for (let index = 1; index < passes.length; index += 1) {
    if (Date.parse(passes[index].observed_at) <
        Date.parse(passes[index - 1].observed_at)) {
      throw new Error("candidate inventory pass server time regressed");
    }
  }
  const last = passes.at(-1);
  const previous = passes.at(-2);
  if (last.candidate_digest !== previous.candidate_digest ||
      last.candidate_digest !== digestCanonical(
        "codex-review-gate-v2-candidate-identities",
        normalizeCandidates(last.candidates),
      ) ||
      canonicalJson(last.candidates) !== canonicalJson(previous.candidates)) {
    throw new Error("candidate inventory final scan pair is not stable");
  }
  const shards = normalizeShards(value.shards, candidates);
  timestamp(value.observed_at, "candidate inventory observed_at");
  if (value.observed_at !== last.observed_at) {
    throw new Error("candidate inventory observation time is not the final point read");
  }
  if (value.prior_inventory_digest !== null &&
      passes[0].candidates.length > candidates.length) {
    throw new Error("candidate inventory cannot shrink below its stable pass");
  }
  digest(value.receipt_digest, "candidate inventory receipt digest");
  const { receipt_digest: _receiptDigest, ...withoutDigest } = value;
  if (value.receipt_digest !== digestCanonical(
    "codex-review-gate-v2-candidate-inventory", withoutDigest)) {
    throw new Error("candidate inventory receipt digest is invalid");
  }
  return deepFreeze({
    ...structuredClone(value),
    repository,
    candidates,
    high_watermark: highWatermark,
    retained_prior_candidate_ids: retained,
    passes,
    shards,
  });
}

export function validateV2CandidateShardReceipt(value, inventory) {
  const selected = validateV2CandidateInventory(inventory);
  assertObject(value, "candidate shard receipt");
  exactKeys(value, [
    "schema", "schema_version", "repository", "inventory_receipt_digest",
    "shard_index", "shard_digest", "candidates", "observations",
    "observed_at", "stable", "receipt_digest",
  ], "candidate shard receipt");
  if (
    value.schema !== V2_CANDIDATE_SHARD_RECEIPT_SCHEMA ||
    value.schema_version !== 1 || value.stable !== true ||
    canonicalJson(normalizeRepository(value.repository)) !==
      canonicalJson(selected.repository) ||
    value.inventory_receipt_digest !== selected.receipt_digest ||
    !Number.isSafeInteger(value.shard_index) || value.shard_index < 0 ||
    value.shard_index >= selected.shards.length
  ) {
    throw new TypeError("candidate shard receipt identity is invalid");
  }
  const expectedShard = selected.shards[value.shard_index];
  const candidates = normalizeCandidates(value.candidates);
  if (
    value.shard_digest !== expectedShard.shard_digest ||
    canonicalJson(candidates) !== canonicalJson(expectedShard.candidates)
  ) {
    throw new Error("candidate shard receipt differs from its inventory shard");
  }
  if (!Array.isArray(value.observations) ||
      value.observations.length !== candidates.length) {
    throw new TypeError("candidate shard observations are incomplete");
  }
  const observations = value.observations.map((observation, index) =>
    normalizeStoredPullObservation(observation, {
      candidate: candidates[index],
      repository: selected.repository,
    }));
  timestamp(value.observed_at, "candidate shard observed_at");
  const expectedObservedAt = observations.at(-1)?.endpoint_receipt.server_time ??
    selected.observed_at;
  if (value.observed_at !== expectedObservedAt) {
    throw new Error("candidate shard observed_at is not the final exact read");
  }
  digest(value.receipt_digest, "candidate shard receipt digest");
  const { receipt_digest: _receiptDigest, ...withoutDigest } = value;
  if (value.receipt_digest !== digestCanonical(
    "codex-review-gate-v2-candidate-shard", withoutDigest)) {
    throw new Error("candidate shard receipt digest is invalid");
  }
  return deepFreeze({ ...structuredClone(value), candidates, observations });
}

async function scanOnePass({
  fetchImpl,
  authorization,
  base,
  repoPath,
  repo,
  pass,
  budget,
  limits,
}) {
  const candidates = [];
  const pages = [];
  let page = 1;
  while (true) {
    if (page > limits.max_pages) {
      throw inventoryError(
        "CANDIDATE_PAGE_CAP_EXCEEDED",
        "candidate inventory exceeded its page cap",
      );
    }
    const path = `${repoPath}/pulls?state=all&sort=created&direction=asc&` +
      `per_page=100&page=${page}`;
    const capture = await jsonRequest({
      fetchImpl,
      authorization,
      base,
      path,
      budget,
      timeoutMs: limits.timeout_ms,
      label: `candidate inventory pass ${pass} page ${page}`,
    });
    if (!Array.isArray(capture.data)) {
      throw inventoryError(
        "CANDIDATE_PAGE_MALFORMED",
        "candidate inventory page is not an array",
        { pass, page },
      );
    }
    const items = capture.data.map((item, index) =>
      normalizeListCandidate(
        item,
        `candidate page ${page} item ${index}`,
        repo,
        base.origin,
      ));
    const nextPage = normalizeNextLink(capture.link, {
      base,
      repoPath,
      currentPage: page,
      itemCount: items.length,
    });
    pages.push({
      page,
      path,
      server_time: capture.receipt.server_time,
      raw_body_sha256: capture.receipt.raw_body_sha256,
      link_sha256: rawDigest(capture.link ?? ""),
      item_count: items.length,
      first_candidate: items[0] ?? null,
      last_candidate: items.at(-1) ?? null,
    });
    candidates.push(...items);
    if (nextPage === null) break;
    page = nextPage;
  }
  const normalized = normalizeCandidates(candidates);
  const observedAt = pages.at(-1).server_time;
  const receipt = deepFreeze({
    pass,
    pages,
    candidates: normalized,
    candidate_digest: digestCanonical(
      "codex-review-gate-v2-candidate-identities",
      normalized,
    ),
    high_watermark: normalized.at(-1) ?? null,
    observed_at: observedAt,
  });
  return { candidates: normalized, receipt };
}

function normalizePassReceipt(value, repository, expectedPass) {
  assertObject(value, "candidate inventory pass");
  exactKeys(value, [
    "pass", "pages", "candidates", "candidate_digest", "high_watermark",
    "observed_at",
  ], "candidate inventory pass");
  if (value.pass !== expectedPass ||
      !Array.isArray(value.pages) || value.pages.length === 0 ||
      value.pages.length > MAX_V2_CANDIDATE_PAGES) {
    throw new TypeError("candidate inventory pass is outside its bounds");
  }
  let previousServerTime = null;
  let candidateOffset = 0;
  for (const [index, page] of value.pages.entries()) {
    assertObject(page, `candidate inventory page ${index}`);
    exactKeys(page, [
      "page", "path", "server_time", "raw_body_sha256", "link_sha256",
      "item_count", "first_candidate", "last_candidate",
    ], `candidate inventory page ${index}`);
    if (page.page !== index + 1 || !Number.isSafeInteger(page.item_count) ||
        page.item_count < 0 || page.item_count > 100) {
      throw new TypeError("candidate inventory page ordinal or count is invalid");
    }
    const expectedPath = `/repos/${repository.owner}/${repository.name}/pulls?` +
      `state=all&sort=created&direction=asc&per_page=100&page=${index + 1}`;
    if (page.path !== expectedPath) {
      throw new Error("candidate inventory page path is not the fixed successor");
    }
    timestamp(page.server_time, "candidate inventory page server_time");
    digest(page.raw_body_sha256, "candidate inventory page raw digest");
    digest(page.link_sha256, "candidate inventory page Link digest");
    if (previousServerTime !== null &&
        Date.parse(page.server_time) < Date.parse(previousServerTime)) {
      throw new Error("candidate inventory page server time regressed");
    }
    previousServerTime = page.server_time;
    if (index < value.pages.length - 1 && page.item_count !== 100) {
      throw new Error("candidate inventory non-final page must contain exactly 100 items");
    }
    candidateOffset += page.item_count;
  }
  const candidates = normalizeCandidates(value.candidates);
  if (candidateOffset !== candidates.length) {
    throw new Error("candidate inventory page counts do not cover the candidate list");
  }
  let offset = 0;
  for (const page of value.pages) {
    const slice = candidates.slice(offset, offset + page.item_count);
    const first = slice[0] ?? null;
    const last = slice.at(-1) ?? null;
    if (canonicalJson(first) !== canonicalJson(page.first_candidate) ||
        canonicalJson(last) !== canonicalJson(page.last_candidate)) {
      throw new Error("candidate inventory page boundary identities are invalid");
    }
    offset += page.item_count;
  }
  digest(value.candidate_digest, "candidate inventory pass digest");
  if (value.candidate_digest !== digestCanonical(
    "codex-review-gate-v2-candidate-identities", candidates)) {
    throw new Error("candidate inventory pass candidate digest is invalid");
  }
  const highWatermark = value.high_watermark === null
    ? null
    : normalizeCandidate(value.high_watermark, "candidate pass high watermark");
  if (canonicalJson(highWatermark) !== canonicalJson(candidates.at(-1) ?? null)) {
    throw new Error("candidate inventory pass high watermark is invalid");
  }
  timestamp(value.observed_at, "candidate inventory pass observed_at");
  if (value.observed_at !== value.pages.at(-1).server_time) {
    throw new Error("candidate inventory pass time is not its last page time");
  }
  return deepFreeze({
    ...structuredClone(value), candidates, high_watermark: highWatermark,
  });
}

function normalizeListCandidate(
  value,
  label,
  repository,
  apiOrigin = "https://api.github.com",
) {
  assertObject(value, label);
  const candidate = normalizeCandidate({
    id: value.id,
    node_id: value.node_id,
    number: value.number,
    created_at: value.created_at,
  }, label);
  if (typeof value.url !== "string") {
    throw inventoryError("CANDIDATE_IDENTITY_MISMATCH", `${label} has no API URL`);
  }
  const expected = `${apiOrigin}/repos/${repository.owner}/` +
    `${repository.name}/pulls/${candidate.number}`;
  if (value.url !== expected) {
    throw inventoryError(
      "CANDIDATE_IDENTITY_MISMATCH",
      `${label} belongs to another repository or pull request`,
    );
  }
  return candidate;
}

function normalizePullRequest(
  value,
  { candidate, repository, apiOrigin = "https://api.github.com" },
) {
  assertObject(value, `pull request ${candidate.number}`);
  const current = normalizeListCandidate(
    value,
    `pull request ${candidate.number}`,
    repository,
    apiOrigin,
  );
  if (canonicalJson(current) !== canonicalJson(candidate)) {
    throw inventoryError(
      "CANDIDATE_IDENTITY_MISMATCH",
      `pull request ${candidate.number} identity changed after inventory`,
    );
  }
  const state = enumValue(value.state, new Set(["open", "closed"]),
    `pull request ${candidate.number} state`);
  if (typeof value.merged !== "boolean") {
    throw new TypeError(`pull request ${candidate.number} merged must be boolean`);
  }
  const mergedAt = value.merged_at === null
    ? null
    : timestamp(value.merged_at, `pull request ${candidate.number} merged_at`);
  if (value.merged !== (mergedAt !== null)) {
    throw inventoryError(
      "CANDIDATE_LIFECYCLE_CONTRADICTORY",
      `pull request ${candidate.number} merged fields disagree`,
    );
  }
  if ((state === "open" && value.merged) ||
      (state === "open" && mergedAt !== null)) {
    throw inventoryError(
      "CANDIDATE_LIFECYCLE_CONTRADICTORY",
      `pull request ${candidate.number} is both open and merged`,
    );
  }
  const base = normalizePullRef(value.base, `pull request ${candidate.number} base`);
  const head = normalizePullRef(value.head, `pull request ${candidate.number} head`);
  return {
    ...candidate,
    state,
    merged: value.merged,
    merged_at: mergedAt,
    updated_at: timestamp(value.updated_at,
      `pull request ${candidate.number} updated_at`),
    draft: boolean(value.draft, `pull request ${candidate.number} draft`),
    base,
    head,
  };
}

function normalizeStoredPullObservation(value, { candidate, repository }) {
  assertObject(value, `stored pull request ${candidate.number}`);
  exactKeys(value, [
    "id", "node_id", "number", "created_at", "state", "merged",
    "merged_at", "updated_at", "draft", "base", "head", "endpoint_receipt",
  ], `stored pull request ${candidate.number}`);
  const normalized = normalizePullRequest({
    ...structuredClone(value),
    url: `https://api.github.com/repos/${repository.owner}/${repository.name}/` +
      `pulls/${candidate.number}`,
  }, { candidate, repository });
  const endpointReceipt = normalizeEndpointReceipt(
    value.endpoint_receipt,
    `/repos/${repository.owner}/${repository.name}/pulls/${candidate.number}`,
  );
  return deepFreeze({ ...normalized, endpoint_receipt: endpointReceipt });
}

function normalizePullRef(value, label) {
  assertObject(value, label);
  assertObject(value.repo, `${label}.repo`);
  return {
    ref: boundedString(value.ref, `${label}.ref`, 255),
    sha: sha(value.sha, `${label}.sha`),
    repo: {
      id: decimal(value.repo.id, `${label}.repo.id`),
      node_id: boundedString(value.repo.node_id, `${label}.repo.node_id`, 256),
      full_name: boundedString(value.repo.full_name, `${label}.repo.full_name`, 256),
    },
  };
}

function normalizeEndpointReceipt(value, expectedPath) {
  assertObject(value, "candidate endpoint receipt");
  exactKeys(value, ["method", "path", "status", "server_time", "raw_body_sha256"],
    "candidate endpoint receipt");
  if (value.method !== "GET" || value.path !== expectedPath || value.status !== 200) {
    throw new Error("candidate endpoint receipt does not bind its exact GET");
  }
  timestamp(value.server_time, "candidate endpoint receipt server_time");
  digest(value.raw_body_sha256, "candidate endpoint receipt raw digest");
  return deepFreeze(structuredClone(value));
}

function mergeCandidateSuperset(prior, current) {
  const map = new Map();
  for (const candidate of [...normalizeCandidates(prior), ...normalizeCandidates(current)]) {
    const priorCandidate = map.get(candidate.id);
    if (priorCandidate !== undefined &&
        canonicalJson(priorCandidate) !== canonicalJson(candidate)) {
      throw inventoryError(
        "CANDIDATE_IDENTITY_CONFLICT",
        "one immutable pull request id has conflicting identity fields",
        { id: candidate.id },
      );
    }
    map.set(candidate.id, candidate);
  }
  return normalizeCandidates([...map.values()].sort(compareCandidate));
}

function normalizeCandidates(value) {
  if (!Array.isArray(value)) throw new TypeError("candidate inventory must be an array");
  const candidates = value.map((candidate, index) =>
    normalizeCandidate(candidate, `candidate ${index}`));
  const ids = new Set();
  const nodes = new Set();
  const numbers = new Set();
  for (const candidate of candidates) {
    if (ids.has(candidate.id) || nodes.has(candidate.node_id) ||
        numbers.has(candidate.number)) {
      throw inventoryError(
        "CANDIDATE_IDENTITY_CONFLICT",
        "candidate id, node id, and number must each be unique",
      );
    }
    ids.add(candidate.id);
    nodes.add(candidate.node_id);
    numbers.add(candidate.number);
  }
  for (let index = 1; index < candidates.length; index += 1) {
    if (compareCandidate(candidates[index - 1], candidates[index]) >= 0) {
      throw inventoryError(
        "CANDIDATE_ORDER_INVALID",
        "candidate identities must be strictly ordered by created time and number",
      );
    }
  }
  return candidates;
}

function normalizeCandidate(value, label) {
  assertObject(value, label);
  exactKeys(value, ["id", "node_id", "number", "created_at"], label);
  const number = value.number;
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${label}.number must be a positive safe integer`);
  }
  return {
    id: decimal(value.id, `${label}.id`),
    node_id: boundedString(value.node_id, `${label}.node_id`, 256),
    number,
    created_at: timestamp(value.created_at, `${label}.created_at`),
  };
}

function compareCandidate(left, right) {
  const time = Date.parse(left.created_at) - Date.parse(right.created_at);
  if (time !== 0) return time;
  return left.number - right.number;
}

function buildShards(candidates) {
  const shards = [];
  for (let offset = 0; offset < candidates.length;
      offset += MAX_V2_CANDIDATES_PER_SHARD) {
    const selected = candidates.slice(offset, offset + MAX_V2_CANDIDATES_PER_SHARD);
    const index = shards.length;
    shards.push({
      index,
      candidates: selected,
      shard_digest: digestCanonical(
        "codex-review-gate-v2-candidate-shard-selection",
        { index, candidates: selected },
      ),
      next_shard_index:
        offset + MAX_V2_CANDIDATES_PER_SHARD < candidates.length
          ? index + 1
          : null,
    });
  }
  return shards;
}

function normalizeShards(value, candidates) {
  if (!Array.isArray(value)) throw new TypeError("candidate shards must be an array");
  const expected = buildShards(candidates);
  if (canonicalJson(value) !== canonicalJson(expected)) {
    throw new Error("candidate shards are not the canonical bounded partition");
  }
  return deepFreeze(structuredClone(expected));
}

function normalizeNextLink(value, { base, repoPath, currentPage, itemCount }) {
  if (value === null) {
    if (itemCount === 100) {
      throw inventoryError(
        "CANDIDATE_PAGINATION_INCOMPLETE",
        "a full candidate page omitted its exact next Link",
      );
    }
    return null;
  }
  boundedString(value, "candidate inventory Link header", 8192);
  const relations = new Map();
  for (const entry of value.split(",")) {
    const match = entry.trim().match(/^<([^>]+)>;\s*rel="([a-z]+)"$/u);
    if (match === null || relations.has(match[2])) {
      throw inventoryError(
        "CANDIDATE_PAGINATION_INVALID",
        "candidate inventory Link header is malformed or ambiguous",
      );
    }
    relations.set(match[2], match[1]);
  }
  const next = relations.get("next");
  if (next === undefined) {
    if (itemCount === 100) {
      throw inventoryError(
        "CANDIDATE_PAGINATION_INCOMPLETE",
        "a full candidate page omitted its exact next Link",
      );
    }
    return null;
  }
  const url = new URL(next);
  if (url.origin !== base.origin || url.pathname !== `${repoPath}/pulls`) {
    throw inventoryError(
      "CANDIDATE_PAGINATION_INVALID",
      "candidate inventory next page leaves the fixed API scope",
    );
  }
  const expected = new URLSearchParams({
    state: "all",
    sort: "created",
    direction: "asc",
    per_page: "100",
    page: String(currentPage + 1),
  });
  if (canonicalJson(canonicalSearch(url.searchParams)) !==
      canonicalJson(canonicalSearch(expected))) {
    throw inventoryError(
      "CANDIDATE_PAGINATION_INVALID",
      "candidate inventory next page is not the exact successor",
    );
  }
  return currentPage + 1;
}

function canonicalSearch(value) {
  return [...value.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) =>
    leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
}

async function jsonRequest({
  fetchImpl,
  authorization,
  base,
  path,
  budget,
  timeoutMs,
  label,
}) {
  budget.requests += 1;
  if (budget.requests >
      (MAX_V2_CANDIDATE_PAGES * MAX_V2_CANDIDATE_SCAN_PASSES) +
        MAX_V2_CANDIDATES_PER_SHARD + 8) {
    throw inventoryError("CANDIDATE_REQUEST_CAP_EXCEEDED", "candidate request cap exceeded");
  }
  const url = new URL(path, base);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await Promise.race([
      fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${authorization}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        redirect: "error",
        signal: controller.signal,
      }),
      new Promise((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(
          inventoryError("CANDIDATE_HTTP_TIMEOUT", `${label} timed out`),
        ), { once: true });
      }),
    ]);
  } catch (error) {
    if (error instanceof V2CandidateInventoryError) throw error;
    throw inventoryError("CANDIDATE_HTTP_UNREADABLE", `${label} failed`, null, error);
  } finally {
    clearTimeout(timer);
  }
  if (response === null || typeof response !== "object" ||
      response.status !== 200 || response.headers === null ||
      typeof response.headers?.get !== "function" ||
      typeof response.arrayBuffer !== "function") {
    throw inventoryError(
      response?.status === 404
        ? "CANDIDATE_INACCESSIBLE"
        : "CANDIDATE_HTTP_UNREADABLE",
      `${label} did not return one readable HTTP 200`,
      { status: Number.isSafeInteger(response?.status) ? response.status : null },
    );
  }
  const serverTime = normalizeHttpDate(response.headers.get("date"), `${label} Date`);
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null &&
      (!DECIMAL.test(declaredLength) || Number(declaredLength) >
        MAX_V2_CANDIDATE_RESPONSE_BYTES)) {
    throw inventoryError("CANDIDATE_RESPONSE_TOO_LARGE", `${label} is too large`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_V2_CANDIDATE_RESPONSE_BYTES) {
    throw inventoryError("CANDIDATE_RESPONSE_TOO_LARGE", `${label} is too large`);
  }
  budget.bytes += bytes.byteLength;
  if (budget.bytes > MAX_V2_CANDIDATE_TOTAL_BYTES) {
    throw inventoryError("CANDIDATE_TOTAL_BYTES_EXCEEDED", "candidate byte budget exceeded");
  }
  let text;
  let data;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    data = JSON.parse(text);
  } catch (error) {
    throw inventoryError("CANDIDATE_HTTP_UNREADABLE", `${label} is not UTF-8 JSON`, null, error);
  }
  return {
    data,
    link: response.headers.get("link"),
    receipt: {
      method: "GET",
      path,
      status: 200,
      server_time: serverTime,
      raw_body_sha256: rawDigest(bytes),
    },
  };
}

function normalizeLimits({ timeoutMs, maxPages, maxPasses }) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 ||
      timeoutMs > V2_CANDIDATE_HTTP_TIMEOUT_MS ||
      !Number.isSafeInteger(maxPages) || maxPages <= 0 ||
      maxPages > MAX_V2_CANDIDATE_PAGES ||
      !Number.isSafeInteger(maxPasses) || maxPasses < 2 ||
      maxPasses > MAX_V2_CANDIDATE_SCAN_PASSES) {
    throw new TypeError("candidate inventory limits may only tighten fixed bounds");
  }
  return { timeout_ms: timeoutMs, max_pages: maxPages, max_passes: maxPasses };
}

function normalizeRepository(value) {
  assertObject(value, "candidate repository");
  exactKeys(value, ["owner", "name", "id", "node_id"], "candidate repository");
  const part = /^[A-Za-z0-9_.-]{1,100}$/u;
  if (!part.test(value.owner) || !part.test(value.name)) {
    throw new TypeError("candidate repository owner or name is invalid");
  }
  return {
    owner: value.owner,
    name: value.name,
    id: decimal(value.id, "candidate repository id"),
    node_id: boundedString(value.node_id, "candidate repository node id", 256),
  };
}

function normalizeRestBase(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
      url.search !== "" || url.hash !== "" ||
      !new Set(["api.github.com", "github.example.test"]).has(url.hostname)) {
    throw new TypeError("candidate inventory REST base is unsupported");
  }
  url.pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  return url;
}

function normalizeHttpDate(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw inventoryError("CANDIDATE_HTTP_UNREADABLE", `${label} is missing or invalid`);
  }
  return new Date(Date.parse(value)).toISOString();
}

function normalizeUniqueDecimals(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const normalized = value.map((entry, index) => decimal(entry, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length ||
      canonicalJson(normalized) !== canonicalJson([...normalized].sort(decimalCompare))) {
    throw new TypeError(`${label} must be unique and sorted`);
  }
  return normalized;
}

function decimalCompare(left, right) {
  return BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0;
}

function decimal(value, label) {
  const normalized = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : value;
  if (typeof normalized !== "string" || !DECIMAL.test(normalized)) {
    throw new TypeError(`${label} must be a canonical decimal`);
  }
  return normalized;
}

function timestamp(value, label) {
  if (typeof value !== "string" || !TIMESTAMP.test(value) ||
      !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be a canonical UTC timestamp`);
  }
  return new Date(Date.parse(value)).toISOString();
}

function sha(value, label) {
  if (typeof value !== "string" || !SHA.test(value)) {
    throw new TypeError(`${label} must be a full lowercase SHA`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} must be a sha256 digest`);
  }
  return value;
}

function boolean(value, label) {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be boolean`);
  return value;
}

function enumValue(value, allowed, label) {
  if (!allowed.has(value)) throw new TypeError(`${label} is unsupported`);
  return value;
}

function boundedString(value, label, limit) {
  if (typeof value !== "string" || value.length === 0 || value.length > limit) {
    throw new TypeError(`${label} must be a bounded non-empty string`);
  }
  return value;
}

function assertObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

function exactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new TypeError(`${label} has unexpected or missing fields`);
  }
}

function rawDigest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function digestCanonical(domain, value) {
  return rawDigest(`${domain}\n${canonicalJson(value)}\n`);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
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

function inventoryError(code, message, details = null, cause = undefined) {
  return new V2CandidateInventoryError(code, message, details, cause);
}
