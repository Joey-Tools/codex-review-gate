import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { TextDecoder, types as utilTypes } from "node:util";

const SafeAbortController = AbortController;
const SafePromise = Promise;
const SafeSet = Set;
const SafeWeakMap = WeakMap;
const SafeWeakSet = WeakSet;
const safeArrayIsArray = Array.isArray;
const arrayPrototype = Array.prototype;
const arrayJoinIntrinsic = Array.prototype.join;
const arrayMapIntrinsic = Array.prototype.map;
const arraySortIntrinsic = Array.prototype.sort;
const jsonStringifyIntrinsic = JSON.stringify;
const objectPrototype = Object.prototype;
const reflectApply = Reflect.apply;
const safeClearTimeout = clearTimeout;
const safeObjectFreeze = Object.freeze;
const safeObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const safeObjectGetPrototypeOf = Object.getPrototypeOf;
const safeObjectHasOwn = Object.hasOwn;
const safeObjectIsFrozen = Object.isFrozen;
const safeObjectKeys = Object.keys;
const safeObjectValues = Object.values;
const reflectOwnKeysIntrinsic = Reflect.ownKeys;
const safeSetTimeout = setTimeout;
const safeStructuredClone = structuredClone;
const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayBufferGetter = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  "buffer",
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
const performanceNowIntrinsic = performance.now;
const promiseResolveIntrinsic = SafePromise.resolve;
const promiseThenIntrinsic = SafePromise.prototype.then;
const setAddIntrinsic = SafeSet.prototype.add;
const setHasIntrinsic = SafeSet.prototype.has;
const setSizeIntrinsic = Object.getOwnPropertyDescriptor(
  SafeSet.prototype,
  "size",
).get;
const weakSetAddIntrinsic = SafeWeakSet.prototype.add;
const weakSetHasIntrinsic = SafeWeakSet.prototype.has;
const weakMapGetIntrinsic = SafeWeakMap.prototype.get;
const weakMapSetIntrinsic = SafeWeakMap.prototype.set;
const hashPrototype = safeObjectGetPrototypeOf(createHash("sha256"));
const hashDigestIntrinsic = hashPrototype.digest;
const hashUpdateIntrinsic = hashPrototype.update;
const INTERNAL_INVENTORY_ERRORS = new SafeWeakSet();
const NORMALIZED_INVENTORY_CACHE = new SafeWeakMap();
const CURRENT_OPEN_GIT_LEDGER_PROJECTION_HANDLES = new SafeWeakMap();
const CURRENT_OPEN_PRODUCTION_CANDIDATE_AUTHORITY_HANDLES = new SafeWeakMap();
const CONSUMED_CURRENT_OPEN_PRODUCTION_CANDIDATE_AUTHORITIES =
  new SafeWeakSet();
const CURRENT_OPEN_COLLECTION_FENCES = new SafeWeakMap();
const CONSUMED_CURRENT_OPEN_COLLECTION_FENCES = new SafeWeakSet();
let currentOpenCollectionEventOrdinal = 0n;

export const V2_CANDIDATE_INVENTORY_SCHEMA =
  "codex-review-gate-candidate-inventory-v2";
export const V2_CANDIDATE_SHARD_RECEIPT_SCHEMA =
  "codex-review-gate-candidate-shard-receipt-v2";
export const V2_CANDIDATE_CYCLE_RECEIPT_SCHEMA =
  "codex-review-gate-candidate-cycle-receipt-v2";
export const V2_CURRENT_OPEN_CANDIDATE_INVENTORY_SCHEMA =
  "codex-review-gate-current-open-candidate-inventory-v2";
export const V2_CURRENT_OPEN_CANDIDATE_INVENTORY_PROJECTION_SCHEMA =
  "codex-review-gate-current-open-candidate-inventory-ledger-projection-v2";
export const V2_CURRENT_OPEN_PRODUCTION_CANDIDATE_AUTHORITY_SCHEMA =
  "codex-review-gate-current-open-production-candidate-authority-v2";
export const V2_CURRENT_OPEN_CANDIDATE_COLLECTION_FENCE_SCHEMA =
  "codex-review-gate-current-open-candidate-collection-fence-v2";
export const V2_LEGACY_STATE_ALL_CANDIDATE_INVENTORY_USE =
  "non-production-finish-only";
export const MAX_V2_CANDIDATES_PER_SHARD = 256;
export const MAX_V2_CURRENT_OPEN_CANDIDATES = 512;
export const MAX_V2_CURRENT_OPEN_CANDIDATE_PAGES = 6;
export const MAX_V2_CURRENT_OPEN_CANDIDATE_REQUEST_BYTES = 64 * 1024;
export const MAX_V2_CURRENT_OPEN_CANDIDATE_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_V2_CURRENT_OPEN_CANDIDATE_TOTAL_BYTES = 32 * 1024 * 1024;
export const MAX_V2_CANDIDATE_RESPONSE_CHUNKS = 4_096;
export const MAX_V2_CANDIDATE_PAGES = 256;
export const MAX_V2_CANDIDATE_SCAN_PASSES = 6;
export const MAX_V2_CANDIDATE_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_V2_CANDIDATE_TOTAL_BYTES = 128 * 1024 * 1024;
export const V2_CANDIDATE_HTTP_TIMEOUT_MS = 15_000;
export const V2_CURRENT_OPEN_PULL_REQUESTS_QUERY = `query CodexReviewGateCurrentOpenPullRequests(
  $owner: String!
  $name: String!
  $after: String
) {
  repository(owner: $owner, name: $name) {
    id
    databaseId
    nameWithOwner
    pullRequests(
      states: OPEN
      orderBy: {field: CREATED_AT, direction: ASC}
      first: 100
      after: $after
    ) {
      nodes {
        id
        fullDatabaseId
        number
        state
        isDraft
        createdAt
        updatedAt
        headRefOid
        headRefName
        baseRefOid
        baseRefName
        headRepository {
          id
          databaseId
          nameWithOwner
        }
        baseRepository {
          id
          databaseId
          nameWithOwner
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}`;

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const TIMESTAMP =
  /^(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d{1,3}))?Z$/u;
const GITHUB_API_VERSION = "2022-11-28";
const CURRENT_OPEN_PRODUCER_ASSURANCE =
  "authenticated-producer-internal-consistency-replay";
const CURRENT_OPEN_REF_FENCE_ASSURANCE = "not-bound-by-inventory";
const CURRENT_OPEN_PRODUCTION_AUTHORITY_CLASS =
  "production-current-open-net-set";
const TRANSPORT_ABORT_SENTINEL = "candidate-inventory-transport-abort";
const CURRENT_OPEN_FACTORY_EPOCH =
  /^current-open-factory:[0-9a-f]{64}$/u;
const RESPONSE_BODY_DEADLINE_YIELD_INTERVAL = 64;
const MAX_V2_CURRENT_OPEN_GRAPHQL_REQUESTS =
  MAX_V2_CANDIDATE_SCAN_PASSES *
  (MAX_V2_CURRENT_OPEN_CANDIDATE_PAGES + 1);

export class V2CandidateInventoryError extends Error {
  constructor(code, message, details = null, cause = undefined) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "V2CandidateInventoryError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Build the legacy state=all finish-only inventory transport.
 *
 * The protected property is candidate-set completeness plus bounded lifecycle
 * stability. Candidate identity uses immutable PR id/node/number/created_at
 * fields; mutable lifecycle metadata is exact-refetched per shard both before
 * and after the final identity scan. A completed cycle therefore requires two
 * equal lifecycle projections around that final scan. This retained-superset
 * protocol is explicitly non-production and finish-only; new production
 * candidate admission uses the branded bounded current-open authority below.
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

  return safeObjectFreeze({
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
      const stableCandidateIds = new SafeSet();
      for (const candidate of stable.candidates) {
        safeSetAdd(stableCandidateIds, candidate.id);
      }
      const retainedPrior = [];
      for (const candidate of merged) {
        if (!safeSetHas(stableCandidateIds, candidate.id)) {
          retainedPrior.push(candidate);
        }
      }
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
      return validateV2CandidateInventory(receipt, repo);
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
          apiOrigin: restBaseIdentity(base),
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
        candidates: safeStructuredClone(shard.candidates),
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
 * Sample the bounded net-current OPEN connection through one fixed GraphQL
 * selection. Each pass records a time interval and re-reads its first page as
 * a final fence. This is not an atomic snapshot or historical event authority:
 * independent dirty/event evidence must cover changes that occur only between
 * observations. Its factory-bound projector is the only in-process publication
 * authority. A durable projection requires an authenticated producer envelope;
 * its exported validator proves internal consistency only, not that any HTTP
 * request independently occurred. The injected fetch is part of that producer
 * trust boundary and must transmit the exact immutable URL and request-init
 * values supplied here. Freezing closes ordinary reference mutation; it does
 * not authenticate a malicious adapter, and a generic/test factory cannot by
 * itself mint production durable admission.
 */
export function createV2GitHubCurrentOpenCandidateInventory({
  fetch: fetchImpl,
  token,
  repository,
  graphqlUrl = "https://api.github.com/graphql",
  timeoutMs = V2_CANDIDATE_HTTP_TIMEOUT_MS,
  maxPages = MAX_V2_CURRENT_OPEN_CANDIDATE_PAGES,
  maxPasses = MAX_V2_CANDIDATE_SCAN_PASSES,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("current-open candidate inventory requires fetch");
  }
  const authorization = boundedString(
    token,
    "current-open candidate inventory token",
    4096,
  );
  const repo = deepFreeze(normalizeRepository(repository));
  const endpoint = normalizeGraphqlUrl(graphqlUrl);
  const endpointHref = endpoint.href;
  const limits = deepFreeze(
    normalizeCurrentOpenLimits({ timeoutMs, maxPages, maxPasses }),
  );
  const factoryEpoch = `current-open-factory:${randomBytes(32).toString("hex")}`;
  // Direct identity slots deliberately avoid an authority-bearing collection
  // whose mutable prototype methods could expose or replace private bindings.
  let latestReceipt = null;
  let latestBinding = null;
  let latestGeneration = 0;
  let scanGeneration = 0;
  let productionGenerationToken = null;

  return safeObjectFreeze({
    async scan() {
      scanGeneration += 1;
      const generation = scanGeneration;
      if (productionGenerationToken !== null) {
        productionGenerationToken.active = false;
      }
      productionGenerationToken = {
        active: true,
        generation,
        authority_state: "available",
      };
      currentOpenCollectionEventOrdinal += 1n;
      const scanStartedCollectionOrdinal = currentOpenCollectionEventOrdinal;
      latestReceipt = null;
      latestBinding = null;
      latestGeneration = 0;
      const assertActiveScan = () => {
        if (generation !== scanGeneration) {
          throw inventoryError(
            "CANDIDATE_OPEN_SCAN_SUPERSEDED",
            "current-open GraphQL scan was superseded by a newer attempt",
          );
        }
      };
      const budget = { bytes: 0, requests: 0, request_ids: new SafeSet() };
      const passes = [];
      const rawPasses = [];
      let previous = null;
      let stable = null;
      for (let pass = 1; pass <= limits.max_passes; pass += 1) {
        const current = await scanCurrentOpenPass({
          fetchImpl,
          authorization,
          endpoint,
          repo,
          pass,
          budget,
          limits,
          assertActiveScan,
        });
        assertActiveScan();
        passes.push(current.receipt);
        rawPasses.push(deepFreeze({
          pass,
          pages: current.raw_pages,
          final_fence: current.raw_final_fence,
        }));
        if (
          previous !== null &&
          current.receipt.current_open_semantic_digest ===
            previous.receipt.current_open_semantic_digest &&
          canonicalJson(current.semantic_projection) ===
            canonicalJson(previous.semantic_projection)
        ) {
          stable = current;
          break;
        }
        previous = current;
      }
      if (stable === null) {
        throw inventoryError(
          "CANDIDATE_OPEN_SET_UNSTABLE",
          "current-open GraphQL inventory did not stabilize within the pass cap",
          { passes: passes.length },
        );
      }
      const withoutDigest = {
        schema: V2_CURRENT_OPEN_CANDIDATE_INVENTORY_SCHEMA,
        schema_version: 4,
        factory_epoch: factoryEpoch,
        producer_assurance: CURRENT_OPEN_PRODUCER_ASSURANCE,
        repository: repo,
        graphql_url: endpointHref,
        api_version: GITHUB_API_VERSION,
        query: V2_CURRENT_OPEN_PULL_REQUESTS_QUERY,
        query_sha256: rawDigest(V2_CURRENT_OPEN_PULL_REQUESTS_QUERY),
        effective_limits: safeStructuredClone(limits),
        ref_fence: null,
        ref_fence_assurance: CURRENT_OPEN_REF_FENCE_ASSURANCE,
        current_open_pull_requests: stable.observations,
        current_open_semantic_digest:
          stable.receipt.current_open_semantic_digest,
        passes,
        observation_window: {
          started_at: passes[0].observation_window.started_at,
          completed_at: passes.at(-1).observation_window.completed_at,
        },
        stable: true,
        completeness: "bounded-stable-sampled-current-open-net-set",
      };
      const receipt = deepFreeze({
        ...withoutDigest,
        receipt_digest: digestCanonical(
          "codex-review-gate-v2-current-open-candidate-inventory",
          withoutDigest,
        ),
      });
      validateV2CurrentOpenCandidateInventory(receipt, repo);
      const binding = deepFreeze({
        scan_generation: generation,
        scan_started_collection_ordinal: scanStartedCollectionOrdinal,
        factory_epoch: factoryEpoch,
        producer_assurance: CURRENT_OPEN_PRODUCER_ASSURANCE,
        repository: repo,
        current_open_pull_requests: stable.observations,
        semantic_projection: stable.semantic_projection,
        raw_passes: rawPasses,
        graphql_url: endpointHref,
        api_version: GITHUB_API_VERSION,
        query: V2_CURRENT_OPEN_PULL_REQUESTS_QUERY,
        effective_limits: limits,
        ref_fence: null,
        ref_fence_assurance: CURRENT_OPEN_REF_FENCE_ASSURANCE,
      });
      if (generation !== scanGeneration) {
        throw inventoryError(
          "CANDIDATE_OPEN_SCAN_SUPERSEDED",
          "current-open GraphQL scan was superseded before publication",
        );
      }
      latestReceipt = receipt;
      latestBinding = binding;
      latestGeneration = generation;
      return receipt;
    },
    projectForGitLedger(value) {
      return projectCurrentOpenCandidateInventoryForGitLedger(
        value,
        repo,
        endpointHref,
        limits,
        factoryEpoch,
        scanGeneration,
        latestGeneration,
        latestReceipt,
        latestBinding,
      );
    },
    projectProductionCandidateAuthority(value) {
      const authority = projectCurrentOpenProductionCandidateAuthority(
        value,
        repo,
        factoryEpoch,
        scanGeneration,
        latestGeneration,
        latestReceipt,
        latestBinding,
        productionGenerationToken,
      );
      return authority;
    },
  });
}

function assertCurrentOpenCandidateInventoryHandleForFactory(
  value,
  expectedRepository,
  endpointHref,
  limits,
  factoryEpoch,
  scanGeneration,
  latestGeneration,
  latestReceipt,
  binding,
) {
  if (value !== latestReceipt || binding === null ||
      latestGeneration === 0 || latestGeneration !== scanGeneration ||
      binding.scan_generation !== latestGeneration ||
      binding.factory_epoch !== factoryEpoch ||
      value.factory_epoch !== factoryEpoch ||
      binding.producer_assurance !== CURRENT_OPEN_PRODUCER_ASSURANCE ||
      value.producer_assurance !== CURRENT_OPEN_PRODUCER_ASSURANCE ||
      !sameCurrentOpenRepository(binding.repository, expectedRepository) ||
      !sameCurrentOpenRepository(value.repository, expectedRepository) ||
      binding.graphql_url !== endpointHref || value.graphql_url !== endpointHref ||
      binding.api_version !== GITHUB_API_VERSION ||
      value.api_version !== GITHUB_API_VERSION ||
      binding.query !== V2_CURRENT_OPEN_PULL_REQUESTS_QUERY ||
      value.query !== V2_CURRENT_OPEN_PULL_REQUESTS_QUERY ||
      !sameCurrentOpenLimits(binding.effective_limits, limits) ||
      !sameCurrentOpenLimits(value.effective_limits, limits) ||
      binding.ref_fence !== null || value.ref_fence !== null ||
      binding.ref_fence_assurance !== CURRENT_OPEN_REF_FENCE_ASSURANCE ||
      value.ref_fence_assurance !== CURRENT_OPEN_REF_FENCE_ASSURANCE) {
    throw inventoryError(
      "UNTRUSTED_CURRENT_OPEN_INVENTORY_HANDLE",
      "current-open candidate inventory is not from this live factory",
    );
  }
  const normalized = validateV2CurrentOpenCandidateInventory(
    value,
    expectedRepository,
  );
  if (binding.factory_epoch !== normalized.factory_epoch ||
      binding.producer_assurance !== normalized.producer_assurance ||
      canonicalJson(binding.repository) !== canonicalJson(normalized.repository) ||
      canonicalJson(binding.current_open_pull_requests) !==
        canonicalJson(normalized.current_open_pull_requests) ||
      canonicalJson(binding.semantic_projection) !== canonicalJson(
        currentOpenDispatchProjection(normalized.current_open_pull_requests),
      ) || binding.graphql_url !== normalized.graphql_url ||
      binding.api_version !== normalized.api_version ||
      binding.query !== normalized.query ||
      canonicalJson(binding.effective_limits) !==
        canonicalJson(normalized.effective_limits) ||
      binding.ref_fence !== normalized.ref_fence ||
      binding.ref_fence_assurance !== normalized.ref_fence_assurance) {
    throw inventoryError(
      "UNTRUSTED_CURRENT_OPEN_INVENTORY_HANDLE",
      "current-open candidate inventory differs from its live factory binding",
    );
  }
  return value;
}

function projectCurrentOpenCandidateInventoryForGitLedger(
  value,
  expectedRepository,
  endpointHref,
  limits,
  factoryEpoch,
  scanGeneration,
  latestGeneration,
  latestReceipt,
  binding,
) {
  const receipt = assertCurrentOpenCandidateInventoryHandleForFactory(
    value,
    expectedRepository,
    endpointHref,
    limits,
    factoryEpoch,
    scanGeneration,
    latestGeneration,
    latestReceipt,
    binding,
  );
  const projection = validateV2CurrentOpenCandidateInventoryGitLedgerProjection({
    schema: V2_CURRENT_OPEN_CANDIDATE_INVENTORY_PROJECTION_SCHEMA,
    schema_version: 4,
    factory_epoch: binding.factory_epoch,
    producer_assurance: binding.producer_assurance,
    receipt: safeStructuredClone(receipt),
    semantic_projection: safeStructuredClone(binding.semantic_projection),
    raw_passes: safeStructuredClone(binding.raw_passes),
    graphql_url: binding.graphql_url,
    api_version: binding.api_version,
    query: binding.query,
    query_sha256: rawDigest(binding.query),
    effective_limits: safeStructuredClone(binding.effective_limits),
    ref_fence: binding.ref_fence,
    ref_fence_assurance: binding.ref_fence_assurance,
  }, expectedRepository);
  safeWeakMapSet(
    CURRENT_OPEN_GIT_LEDGER_PROJECTION_HANDLES,
    projection,
    safeObjectFreeze({
      factory_epoch: binding.factory_epoch,
      scan_generation: binding.scan_generation,
      source_receipt: receipt,
      scan_started_collection_ordinal:
        binding.scan_started_collection_ordinal,
    }),
  );
  return projection;
}

function projectCurrentOpenProductionCandidateAuthority(
  value,
  expectedRepository,
  factoryEpoch,
  scanGeneration,
  latestGeneration,
  latestReceipt,
  latestBinding,
  productionGenerationToken,
) {
  const sourceBinding = value === null ||
      (typeof value !== "object" && typeof value !== "function")
    ? undefined
    : safeWeakMapGet(CURRENT_OPEN_GIT_LEDGER_PROJECTION_HANDLES, value);
  if (sourceBinding === undefined ||
      sourceBinding.factory_epoch !== factoryEpoch) {
    throw inventoryError(
      "UNTRUSTED_CURRENT_OPEN_PRODUCTION_AUTHORITY_SOURCE",
      "production candidate authority requires this factory's exact live projection",
    );
  }
  if (
    latestGeneration === 0 || latestGeneration !== scanGeneration ||
    latestReceipt === null || latestBinding === null ||
    productionGenerationToken === null ||
    productionGenerationToken.active !== true ||
    productionGenerationToken.generation !== latestGeneration ||
    sourceBinding.scan_generation !== latestGeneration ||
    sourceBinding.source_receipt !== latestReceipt
  ) {
    throw inventoryError(
      "STALE_CURRENT_OPEN_PRODUCTION_AUTHORITY_SOURCE",
      "production candidate authority source is not the current scan generation",
    );
  }
  if (productionGenerationToken.authority_state !== "available") {
    throw inventoryError(
      "CONSUMED_CURRENT_OPEN_PRODUCTION_AUTHORITY_SOURCE",
      "current scan generation already produced its production candidate authority",
    );
  }
  productionGenerationToken.authority_state = "claimed";
  let published = false;
  try {
    const source = validateV2CurrentOpenCandidateInventoryGitLedgerProjection(
      value,
      expectedRepository,
    );
    if (
      source.factory_epoch !== factoryEpoch ||
      source.receipt.receipt_digest !== latestReceipt.receipt_digest ||
      source.receipt.current_open_semantic_digest !==
        latestReceipt.current_open_semantic_digest ||
      canonicalJson(source.semantic_projection) !==
        canonicalJson(latestBinding.semantic_projection)
    ) {
      throw inventoryError(
        "UNTRUSTED_CURRENT_OPEN_PRODUCTION_AUTHORITY_SOURCE",
        "production candidate authority source differs from its live scan binding",
      );
    }

    const candidates = safeArrayMap(
      source.semantic_projection,
      (observation) => productionCandidateSummary(observation),
    );
    const candidateSetDigest = digestCanonical(
      "codex-review-gate-v2-production-current-open-candidate-set",
      candidates,
    );
    const withoutDigest = {
      schema: V2_CURRENT_OPEN_PRODUCTION_CANDIDATE_AUTHORITY_SCHEMA,
      schema_version: 1,
      authority_class: CURRENT_OPEN_PRODUCTION_AUTHORITY_CLASS,
      repository: safeStructuredClone(expectedRepository),
      candidate_count: candidates.length,
      candidates,
      candidate_set_digest: candidateSetDigest,
      source_current_open_semantic_digest:
        source.receipt.current_open_semantic_digest,
    };
    const authority = validateV2CurrentOpenProductionCandidateAuthority({
      ...withoutDigest,
      authority_digest: digestCanonical(
        "codex-review-gate-v2-current-open-production-candidate-authority",
        withoutDigest,
      ),
    }, expectedRepository);
    if (productionGenerationToken.active !== true ||
        productionGenerationToken.generation !== latestGeneration) {
      throw inventoryError(
        "STALE_CURRENT_OPEN_PRODUCTION_AUTHORITY_SOURCE",
        "production candidate authority source was revoked before publication",
      );
    }
    safeWeakMapSet(
      CURRENT_OPEN_PRODUCTION_CANDIDATE_AUTHORITY_HANDLES,
      authority,
      safeObjectFreeze({
        source_projection: value,
        scan_generation: latestGeneration,
        factory_epoch: factoryEpoch,
        generation_token: productionGenerationToken,
      }),
    );
    productionGenerationToken.authority_state = "produced";
    published = true;
    return authority;
  } finally {
    if (!published &&
        productionGenerationToken.authority_state === "claimed") {
      productionGenerationToken.authority_state = "available";
    }
  }
}

function productionCandidateSummary(observation) {
  const identity = candidateIdentityProjection(observation);
  const lifecycleSeed = {
    state: observation.state,
    updated_at: observation.updated_at,
    draft: observation.draft,
    base: safeStructuredClone(observation.base),
    head: safeStructuredClone(observation.head),
  };
  return {
    identity,
    identity_digest: digestCanonical(
      "codex-review-gate-v2-production-candidate-identity",
      identity,
    ),
    lifecycle_seed: lifecycleSeed,
    lifecycle_seed_digest: digestCanonical(
      "codex-review-gate-v2-production-candidate-lifecycle-seed",
      { identity, lifecycle_seed: lifecycleSeed },
    ),
  };
}

export function assertV2CurrentOpenCandidateInventoryHandle() {
  throw inventoryError(
    "UNTRUSTED_CURRENT_OPEN_INVENTORY_HANDLE",
    "current-open handles require their creating factory's live authority",
  );
}

export function projectV2CurrentOpenCandidateInventoryForGitLedger() {
  throw inventoryError(
    "UNTRUSTED_CURRENT_OPEN_INVENTORY_HANDLE",
    "current-open projection requires the creating factory's projector",
  );
}

/**
 * Consume the exact production authority minted by one factory upgrade.
 *
 * Offline structural replay never registers this private brand. The binding
 * deliberately retains the exact source projection identity and private scan
 * generation while the public durable summary exposes neither. Starting any
 * newer scan synchronously revokes the prior generation, and each handle is
 * admitted once.
 */
export function consumeV2CurrentOpenProductionCandidateAuthorityHandle(value) {
  const binding = value === null ||
      (typeof value !== "object" && typeof value !== "function")
    ? undefined
    : safeWeakMapGet(
      CURRENT_OPEN_PRODUCTION_CANDIDATE_AUTHORITY_HANDLES,
      value,
    );
  if (binding === undefined) {
    throw inventoryError(
      "UNTRUSTED_CURRENT_OPEN_PRODUCTION_AUTHORITY_HANDLE",
      "production candidate authority requires the exact live factory handle",
    );
  }
  if (binding.generation_token.active !== true ||
      binding.generation_token.generation !== binding.scan_generation) {
    throw inventoryError(
      "STALE_CURRENT_OPEN_PRODUCTION_AUTHORITY_HANDLE",
      "production candidate authority was revoked by a newer scan generation",
    );
  }
  if (reflectApply(
    weakSetHasIntrinsic,
    CONSUMED_CURRENT_OPEN_PRODUCTION_CANDIDATE_AUTHORITIES,
    [value],
  )) {
    throw inventoryError(
      "CONSUMED_CURRENT_OPEN_PRODUCTION_AUTHORITY_HANDLE",
      "production candidate authority is a one-shot admission handle",
    );
  }
  reflectApply(
    weakSetAddIntrinsic,
    CONSUMED_CURRENT_OPEN_PRODUCTION_CANDIDATE_AUTHORITIES,
    [value],
  );
  return value;
}

export function assertV2CurrentOpenProductionCandidateAuthorityHandle(value) {
  return consumeV2CurrentOpenProductionCandidateAuthorityHandle(value);
}

/**
 * Require the exact projection returned by one live factory projector.
 *
 * Offline validation proves only closed structural replay. It deliberately
 * does not mint candidate-suppression authority for a clone, reconstructed
 * value, or raw current-open receipt.
 */
export function assertV2CurrentOpenCandidateInventoryGitLedgerProjectionHandle(
  value,
) {
  const binding = value === null ||
      (typeof value !== "object" && typeof value !== "function")
    ? undefined
    : safeWeakMapGet(CURRENT_OPEN_GIT_LEDGER_PROJECTION_HANDLES, value);
  if (binding === undefined) {
    throw inventoryError(
      "UNTRUSTED_CURRENT_OPEN_INVENTORY_PROJECTION_HANDLE",
      "current-open suppression evidence input requires the exact live factory projection",
    );
  }
  return value;
}

/**
 * Mint a same-module monotonic fence immediately before requesting one fresh
 * current-open scan. A clone carries no authority.
 */
export function createV2CurrentOpenCandidateInventoryCollectionFence() {
  currentOpenCollectionEventOrdinal += 1n;
  const handle = safeObjectFreeze({
    schema: V2_CURRENT_OPEN_CANDIDATE_COLLECTION_FENCE_SCHEMA,
    schema_version: 1,
    nonce: randomBytes(32).toString("hex"),
  });
  safeWeakMapSet(CURRENT_OPEN_COLLECTION_FENCES, handle, safeObjectFreeze({
    started_collection_ordinal: currentOpenCollectionEventOrdinal,
  }));
  return handle;
}

/**
 * Require that the live scan underlying one exact projection began after the
 * supplied same-module collection fence. Reprojecting a cached receipt or
 * finishing a scan that was already in flight is therefore insufficient, and
 * each fence is one-shot.
 */
export function assertV2CurrentOpenCandidateInventoryProjectionAfterFence(
  value,
  fence,
) {
  const projection =
    assertV2CurrentOpenCandidateInventoryGitLedgerProjectionHandle(value);
  const fenceBinding = fence === null ||
      (typeof fence !== "object" && typeof fence !== "function")
    ? undefined
    : safeWeakMapGet(CURRENT_OPEN_COLLECTION_FENCES, fence);
  if (fenceBinding === undefined) {
    throw inventoryError(
      "UNTRUSTED_CURRENT_OPEN_COLLECTION_FENCE",
      "current-open collection requires the exact same-module fence",
    );
  }
  if (reflectApply(
    weakSetHasIntrinsic,
    CONSUMED_CURRENT_OPEN_COLLECTION_FENCES,
    [fence],
  )) {
    throw inventoryError(
      "CONSUMED_CURRENT_OPEN_COLLECTION_FENCE",
      "current-open collection fence is one-shot",
    );
  }
  reflectApply(
    weakSetAddIntrinsic,
    CONSUMED_CURRENT_OPEN_COLLECTION_FENCES,
    [fence],
  );
  const projectionBinding = safeWeakMapGet(
    CURRENT_OPEN_GIT_LEDGER_PROJECTION_HANDLES,
    projection,
  );
  if (
    projectionBinding.scan_started_collection_ordinal <=
      fenceBinding.started_collection_ordinal
  ) {
    throw inventoryError(
      "STALE_CURRENT_OPEN_INVENTORY_PROJECTION_HANDLE",
      "current-open scan began before its requested collection",
    );
  }
  return projection;
}

/**
 * Rebuild and cross-check one ledger-bound projection offline.
 *
 * This validator is not an append-admission, suppression authority, or
 * HTTP-origin authenticator. The protected ledger must first authenticate the
 * exact live projection handle that published the factory-bound projection.
 * Raw bodies, Date, and X-GitHub-Request-Id then support bounded internal
 * replay only; none is a server signature.
 */
export function validateV2CurrentOpenCandidateInventoryGitLedgerProjection(
  value,
  expectedRepository = null,
) {
  assertObject(value, "current-open Git ledger projection");
  exactKeys(value, [
    "schema", "schema_version", "factory_epoch", "producer_assurance",
    "receipt", "semantic_projection",
    "raw_passes", "graphql_url", "api_version", "query", "query_sha256",
    "effective_limits", "ref_fence", "ref_fence_assurance",
  ], "current-open Git ledger projection");
  if (
    value.schema !== V2_CURRENT_OPEN_CANDIDATE_INVENTORY_PROJECTION_SCHEMA ||
    value.schema_version !== 4 ||
    value.producer_assurance !== CURRENT_OPEN_PRODUCER_ASSURANCE ||
    value.ref_fence !== null ||
    value.ref_fence_assurance !== CURRENT_OPEN_REF_FENCE_ASSURANCE
  ) {
    throw new TypeError("current-open Git ledger projection schema is invalid");
  }
  const factoryEpoch = normalizeCurrentOpenFactoryEpoch(value.factory_epoch);
  const receipt = validateV2CurrentOpenCandidateInventory(
    value.receipt,
    expectedRepository,
  );
  if (receipt.factory_epoch !== factoryEpoch ||
      receipt.producer_assurance !== value.producer_assurance ||
      receipt.ref_fence !== value.ref_fence ||
      receipt.ref_fence_assurance !== value.ref_fence_assurance) {
    throw new Error(
      "current-open Git ledger producer boundary differs from its receipt",
    );
  }
  const endpoint = normalizeGraphqlUrl(value.graphql_url);
  if (endpoint.href !== value.graphql_url ||
      receipt.graphql_url !== endpoint.href) {
    throw new Error(
      "current-open Git ledger GraphQL URL differs from its receipt",
    );
  }
  if (value.api_version !== GITHUB_API_VERSION ||
      receipt.api_version !== value.api_version) {
    throw new Error("current-open Git ledger API version is invalid");
  }
  if (value.query !== V2_CURRENT_OPEN_PULL_REQUESTS_QUERY ||
      value.query_sha256 !== rawDigest(V2_CURRENT_OPEN_PULL_REQUESTS_QUERY) ||
      receipt.query !== value.query ||
      receipt.query_sha256 !== value.query_sha256) {
    throw new Error("current-open Git ledger fixed GraphQL query is invalid");
  }
  const limits = normalizeCurrentOpenEffectiveLimits(
    value.effective_limits,
    "current-open effective limits",
  );
  if (canonicalJson(receipt.effective_limits) !== canonicalJson(limits)) {
    throw new Error(
      "current-open Git ledger effective limits differ from its receipt",
    );
  }
  const expectedProjection = currentOpenDispatchProjection(
    receipt.current_open_pull_requests,
  );
  if (canonicalJson(value.semantic_projection) !==
      canonicalJson(expectedProjection)) {
    throw new Error(
      "current-open Git ledger semantic projection differs from its receipt",
    );
  }
  if (!safeArrayIsArray(value.raw_passes) ||
      value.raw_passes.length !== receipt.passes.length ||
      value.raw_passes.length > limits.max_passes) {
    throw new TypeError(
      "current-open Git ledger raw passes do not cover the bounded scan",
    );
  }
  let totalBytes = 0;
  const replayedRequestIds = new SafeSet();
  const replayedPasses = safeArrayMap(value.raw_passes, (rawPass, passIndex) => {
    const passReceipt = receipt.passes[passIndex];
    assertObject(rawPass, `current-open raw pass ${passIndex + 1}`);
    exactKeys(rawPass, ["pass", "pages", "final_fence"],
      `current-open raw pass ${passIndex + 1}`);
    if (rawPass.pass !== passIndex + 1 || !safeArrayIsArray(rawPass.pages) ||
        rawPass.pages.length !== passReceipt.pages.length ||
        rawPass.pages.length > limits.max_pages) {
      throw new TypeError(
        `current-open raw pass ${passIndex + 1} does not match its receipt`,
      );
    }
    const observations = [];
    const replayedPages = [];
    for (let pageIndex = 0; pageIndex < rawPass.pages.length; pageIndex += 1) {
      const rawPage = rawPass.pages[pageIndex];
      const pageReceipt = passReceipt.pages[pageIndex];
      const replayed = replayCurrentOpenRawArtifact({
        rawArtifact: rawPage,
        artifactReceipt: pageReceipt,
        pass: passIndex + 1,
        page: pageIndex + 1,
        kind: "page",
        repository: receipt.repository,
        endpoint,
      });
      totalBytes += replayed.raw_bytes;
      assertUniqueCurrentOpenRequestId(
        replayed.request_id,
        replayedRequestIds,
        `current-open raw pass ${passIndex + 1} page ${pageIndex + 1}`,
      );
      if (totalBytes > MAX_V2_CURRENT_OPEN_CANDIDATE_TOTAL_BYTES) {
        throw inventoryError(
          "CANDIDATE_TOTAL_BYTES_EXCEEDED",
          "current-open raw replay exceeds its byte budget",
        );
      }
      appendDenseArray(observations, replayed.observations);
      replayedPages.push(replayed);
    }
    validateReplayedCurrentOpenPageChain(
      replayedPages,
      `current-open raw pass ${passIndex + 1}`,
    );
    const fence = replayCurrentOpenRawArtifact({
      rawArtifact: rawPass.final_fence,
      artifactReceipt: passReceipt.final_fence,
      pass: passIndex + 1,
      page: 1,
      kind: "fence",
      repository: receipt.repository,
      endpoint,
    });
    totalBytes += fence.raw_bytes;
    assertUniqueCurrentOpenRequestId(
      fence.request_id,
      replayedRequestIds,
      `current-open raw pass ${passIndex + 1} final fence`,
    );
    if (totalBytes > MAX_V2_CURRENT_OPEN_CANDIDATE_TOTAL_BYTES) {
      throw inventoryError(
        "CANDIDATE_TOTAL_BYTES_EXCEEDED",
        "current-open raw replay exceeds its byte budget",
      );
    }
    if (canonicalJson(fence.page_projection) !==
        canonicalJson(replayedPages[0].page_projection)) {
      throw new Error(
        `current-open raw pass ${passIndex + 1} final fence drifted`,
      );
    }
    return validateReplayedCurrentOpenPass(
      observations,
      passReceipt,
      `current-open raw pass ${passIndex + 1}`,
    );
  });
  for (let index = 1; index < replayedPasses.length - 1; index += 1) {
    if (canonicalJson(replayedPasses[index - 1]) ===
        canonicalJson(replayedPasses[index])) {
      throw new Error(
        "current-open Git ledger scan did not stop at its earliest stable pair",
      );
    }
  }
  if (
    canonicalJson(replayedPasses.at(-2)) !==
      canonicalJson(replayedPasses.at(-1)) ||
    canonicalJson(replayedPasses.at(-1)) !==
      canonicalJson(receipt.current_open_pull_requests)
  ) {
    throw new Error(
      "current-open Git ledger raw final pair does not replay its stable receipt",
    );
  }
  return deepFreeze({
    schema: V2_CURRENT_OPEN_CANDIDATE_INVENTORY_PROJECTION_SCHEMA,
    schema_version: 4,
    factory_epoch: factoryEpoch,
    producer_assurance: CURRENT_OPEN_PRODUCER_ASSURANCE,
    receipt: safeStructuredClone(receipt),
    semantic_projection: safeStructuredClone(expectedProjection),
    raw_passes: safeStructuredClone(value.raw_passes),
    graphql_url: endpoint.href,
    api_version: GITHUB_API_VERSION,
    query: V2_CURRENT_OPEN_PULL_REQUESTS_QUERY,
    query_sha256: rawDigest(V2_CURRENT_OPEN_PULL_REQUESTS_QUERY),
    effective_limits: safeStructuredClone(limits),
    ref_fence: null,
    ref_fence_assurance: CURRENT_OPEN_REF_FENCE_ASSURANCE,
  });
}

/**
 * Replay one closed production candidate summary without minting live
 * authority. The summary is deterministic for equivalent stable current-open
 * metadata. Durable ledger state, not this stateless projector, must derive a
 * new lifecycle generation from an admitted absent-to-present transition.
 */
export function validateV2CurrentOpenProductionCandidateAuthority(
  value,
  expectedRepository = null,
) {
  assertObject(value, "production current-open candidate authority");
  exactOwnDataKeys(value, [
    "schema", "schema_version", "authority_class", "repository",
    "candidate_count", "candidates", "candidate_set_digest",
    "source_current_open_semantic_digest", "authority_digest",
  ], "production current-open candidate authority");
  if (
    value.schema !==
      V2_CURRENT_OPEN_PRODUCTION_CANDIDATE_AUTHORITY_SCHEMA ||
    value.schema_version !== 1 ||
    value.authority_class !== CURRENT_OPEN_PRODUCTION_AUTHORITY_CLASS
  ) {
    throw new TypeError(
      "production current-open candidate authority schema is invalid",
    );
  }
  exactOwnDataKeys(
    value.repository,
    ["owner", "name", "id", "node_id"],
    "production current-open candidate authority repository",
  );
  const repository = normalizeRepository(value.repository);
  if (expectedRepository !== null &&
      canonicalJson(repository) !==
        canonicalJson(normalizeRepository(expectedRepository))) {
    throw new TypeError(
      "production current-open candidate authority repository differs from expected scope",
    );
  }
  if (!Number.isSafeInteger(value.candidate_count) ||
      value.candidate_count < 0 ||
      value.candidate_count > MAX_V2_CURRENT_OPEN_CANDIDATES) {
    throw inventoryError(
      "CANDIDATE_OPEN_SET_CAP",
      "production current-open candidate authority exceeds its dispatch cap",
    );
  }
  assertExactDenseOwnDataArray(
    value.candidates,
    "production current-open candidate authority candidates",
  );
  if (value.candidates.length !== value.candidate_count) {
    throw new TypeError(
      "production current-open candidate authority count is invalid",
    );
  }
  const candidates = safeArrayMap(
    value.candidates,
    (candidate, index) => normalizeProductionCandidateSummary(
      candidate,
      `production current-open candidate ${index}`,
    ),
  );
  normalizeCandidates(safeArrayMap(candidates, ({ identity }) => identity));
  digest(
    value.candidate_set_digest,
    "production current-open candidate set digest",
  );
  if (value.candidate_set_digest !== digestCanonical(
    "codex-review-gate-v2-production-current-open-candidate-set",
    candidates,
  )) {
    throw new Error(
      "production current-open candidate set digest is invalid",
    );
  }
  digest(
    value.source_current_open_semantic_digest,
    "production current-open source semantic digest",
  );
  const semanticProjection = safeArrayMap(candidates, (candidate) => ({
    ...safeStructuredClone(candidate.identity),
    ...safeStructuredClone(candidate.lifecycle_seed),
  }));
  if (value.source_current_open_semantic_digest !== digestCanonical(
    "codex-review-gate-v2-current-open-dispatch-semantic",
    semanticProjection,
  )) {
    throw new Error(
      "production current-open source semantic digest is invalid",
    );
  }
  digest(value.authority_digest,
    "production current-open authority digest");
  const withoutDigest = {
    schema: V2_CURRENT_OPEN_PRODUCTION_CANDIDATE_AUTHORITY_SCHEMA,
    schema_version: 1,
    authority_class: CURRENT_OPEN_PRODUCTION_AUTHORITY_CLASS,
    repository,
    candidate_count: candidates.length,
    candidates,
    candidate_set_digest: value.candidate_set_digest,
    source_current_open_semantic_digest:
      value.source_current_open_semantic_digest,
  };
  if (value.authority_digest !== digestCanonical(
    "codex-review-gate-v2-current-open-production-candidate-authority",
    withoutDigest,
  )) {
    throw new Error(
      "production current-open candidate authority digest is invalid",
    );
  }
  return deepFreeze({
    ...safeStructuredClone(withoutDigest),
    authority_digest: value.authority_digest,
  });
}

function normalizeProductionCandidateSummary(value, label) {
  assertObject(value, label);
  exactOwnDataKeys(value, [
    "identity", "identity_digest", "lifecycle_seed",
    "lifecycle_seed_digest",
  ], label);
  assertObject(value.identity, `${label} identity`);
  exactOwnDataKeys(
    value.identity,
    ["id", "node_id", "number", "created_at"],
    `${label} identity`,
  );
  const identity = normalizeCandidate(value.identity, `${label} identity`);
  digest(value.identity_digest, `${label} identity digest`);
  if (value.identity_digest !== digestCanonical(
    "codex-review-gate-v2-production-candidate-identity",
    identity,
  )) {
    throw new Error(`${label} identity digest is invalid`);
  }
  assertObject(value.lifecycle_seed, `${label} lifecycle seed`);
  exactOwnDataKeys(value.lifecycle_seed, [
    "state", "updated_at", "draft", "base", "head",
  ], `${label} lifecycle seed`);
  if (value.lifecycle_seed.state !== "open") {
    throw inventoryError(
      "CANDIDATE_OPEN_SET_LIFECYCLE",
      `${label} lifecycle seed is not current open`,
    );
  }
  const lifecycleSeed = {
    state: "open",
    updated_at: timestamp(
      value.lifecycle_seed.updated_at,
      `${label} lifecycle seed updated_at`,
    ),
    draft: boolean(
      value.lifecycle_seed.draft,
      `${label} lifecycle seed draft`,
    ),
    base: normalizeProductionPullRef(
      value.lifecycle_seed.base,
      `${label} lifecycle seed base`,
    ),
    head: normalizeProductionPullRef(
      value.lifecycle_seed.head,
      `${label} lifecycle seed head`,
    ),
  };
  digest(value.lifecycle_seed_digest, `${label} lifecycle seed digest`);
  if (value.lifecycle_seed_digest !== digestCanonical(
    "codex-review-gate-v2-production-candidate-lifecycle-seed",
    { identity, lifecycle_seed: lifecycleSeed },
  )) {
    throw new Error(`${label} lifecycle seed digest is invalid`);
  }
  return {
    identity,
    identity_digest: value.identity_digest,
    lifecycle_seed: lifecycleSeed,
    lifecycle_seed_digest: value.lifecycle_seed_digest,
  };
}

function normalizeProductionPullRef(value, label) {
  assertObject(value, label);
  exactOwnDataKeys(value, ["ref", "sha", "repo"], label);
  assertObject(value.repo, `${label}.repo`);
  exactOwnDataKeys(
    value.repo,
    ["id", "node_id", "full_name"],
    `${label}.repo`,
  );
  return normalizePullRef(value, label);
}

/**
 * Close one bounded-stable scan cycle after every deterministic shard has been
 * exact-refetched on both sides of a final stable state=all identity scan.
 */
export function finalizeV2CandidateInventoryCycle({
  initial_inventory,
  shard_receipts,
  final_inventory,
  final_shard_receipts,
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
  const ordered = orderCycleShardReceipts(shard_receipts, initial);
  const finalOrdered = orderCycleShardReceipts(
    final_shard_receipts,
    final,
    "final candidate shard",
  );
  const observations = ordered.flatMap((receipt) => receipt.observations);
  const finalObservations = finalOrdered.flatMap(
    (receipt) => receipt.observations,
  );
  if (
    observations.length !== initial.candidates.length ||
    finalObservations.length !== final.candidates.length
  ) {
    throw inventoryError(
      "CANDIDATE_SHARDS_INCOMPLETE",
      "candidate shard observations do not cover the full superset",
    );
  }
  const lifecycleProjection = projectCandidateLifecycle(observations);
  const finalLifecycleProjection = projectCandidateLifecycle(
    finalObservations,
  );
  if (canonicalJson(lifecycleProjection) !==
      canonicalJson(finalLifecycleProjection)) {
    throw inventoryError(
      "CANDIDATE_LIFECYCLE_DRIFT",
      "candidate lifecycle changed across the final identity scan",
    );
  }
  for (const receipt of finalOrdered) {
    if (Date.parse(receipt.observed_at) < Date.parse(final.observed_at)) {
      throw inventoryError(
        "CANDIDATE_LIFECYCLE_TIME",
        "final lifecycle verification predates the final identity scan",
      );
    }
  }
  const openPullRequests = finalObservations
    .filter((observation) =>
      observation.state === "open" &&
      observation.merged === false &&
      observation.merged_at === null)
    .map((observation) => safeStructuredClone(observation));
  const withoutDigest = {
    schema: V2_CANDIDATE_CYCLE_RECEIPT_SCHEMA,
    schema_version: 1,
    repository: safeStructuredClone(initial.repository),
    initial_inventory_receipt_digest: initial.receipt_digest,
    final_inventory_receipt_digest: final.receipt_digest,
    candidate_digest: initial.candidate_digest,
    shard_receipt_digests: ordered.map(({ receipt_digest }) => receipt_digest),
    final_inventory_observed_at: final.observed_at,
    final_shard_receipts: finalOrdered.map((receipt) =>
      safeStructuredClone(receipt)),
    lifecycle_projection_digest: digestCanonical(
      "codex-review-gate-v2-candidate-lifecycle-projection",
      finalLifecycleProjection,
    ),
    open_pull_requests: openPullRequests,
    observed_at: finalOrdered.at(-1)?.observed_at ?? final.observed_at,
    stable: true,
    completeness: "bounded-stable-all-open-pull-requests",
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
    "candidate_digest", "shard_receipt_digests",
    "final_inventory_observed_at", "final_shard_receipts",
    "lifecycle_projection_digest", "open_pull_requests", "observed_at",
    "stable", "completeness", "receipt_digest",
  ], "candidate cycle receipt");
  if (
    value.schema !== V2_CANDIDATE_CYCLE_RECEIPT_SCHEMA ||
    value.schema_version !== 1 || value.stable !== true ||
    value.completeness !== "bounded-stable-all-open-pull-requests"
  ) {
    throw new TypeError("candidate cycle receipt schema or assurance is invalid");
  }
  const repository = normalizeRepository(value.repository);
  digest(value.initial_inventory_receipt_digest,
    "candidate cycle initial inventory digest");
  digest(value.final_inventory_receipt_digest,
    "candidate cycle final inventory digest");
  digest(value.candidate_digest, "candidate cycle candidate digest");
  if (!safeArrayIsArray(value.shard_receipt_digests)) {
    throw new TypeError("candidate cycle shard digests must be an array");
  }
  value.shard_receipt_digests.forEach((entry, index) =>
    digest(entry, `candidate cycle shard digest[${index}]`));
  if (safeSetSize(new SafeSet(value.shard_receipt_digests)) !==
      value.shard_receipt_digests.length) {
    throw new TypeError("candidate cycle shard receipt digests must be unique");
  }
  timestamp(value.final_inventory_observed_at,
    "candidate cycle final inventory observed_at");
  const finalShardReceipts = normalizeEmbeddedFinalShardReceipts(
    value.final_shard_receipts,
    repository,
    value.final_inventory_receipt_digest,
  );
  if (value.shard_receipt_digests.length !== finalShardReceipts.length) {
    throw new Error("candidate cycle lifecycle rounds cover different shards");
  }
  for (const receipt of finalShardReceipts) {
    if (Date.parse(receipt.observed_at) <
        Date.parse(value.final_inventory_observed_at)) {
      throw new Error(
        "candidate cycle final lifecycle read predates its identity scan",
      );
    }
  }
  const finalObservations = finalShardReceipts.flatMap(
    (receipt) => receipt.observations,
  );
  if (digestCanonical(
    "codex-review-gate-v2-candidate-identities",
    finalShardReceipts.flatMap((receipt) => receipt.candidates),
  ) !== value.candidate_digest) {
    throw new Error("candidate cycle final shard identities are incomplete");
  }
  const lifecycleProjection = projectCandidateLifecycle(finalObservations);
  digest(value.lifecycle_projection_digest,
    "candidate cycle lifecycle projection digest");
  if (value.lifecycle_projection_digest !== digestCanonical(
    "codex-review-gate-v2-candidate-lifecycle-projection",
    lifecycleProjection,
  )) {
    throw new Error("candidate cycle lifecycle projection digest is invalid");
  }
  if (!safeArrayIsArray(value.open_pull_requests)) {
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
  const expectedOpenPullRequests = finalObservations.filter((observation) =>
    observation.state === "open" && observation.merged === false &&
    observation.merged_at === null);
  if (canonicalJson(openPullRequests) !==
      canonicalJson(expectedOpenPullRequests)) {
    throw new Error("candidate cycle open PRs differ from final lifecycle reads");
  }
  timestamp(value.observed_at, "candidate cycle observed_at");
  const expectedObservedAt = finalShardReceipts.at(-1)?.observed_at ??
    value.final_inventory_observed_at;
  if (value.observed_at !== expectedObservedAt ||
      Date.parse(value.observed_at) <
        Date.parse(value.final_inventory_observed_at)) {
    throw new Error("candidate cycle time is not the final lifecycle boundary");
  }
  digest(value.receipt_digest, "candidate cycle receipt digest");
  const { receipt_digest: _receiptDigest, ...withoutDigest } = value;
  if (value.receipt_digest !== digestCanonical(
    "codex-review-gate-v2-candidate-cycle", withoutDigest)) {
    throw new Error("candidate cycle receipt digest is invalid");
  }
  return deepFreeze({
    ...safeStructuredClone(value),
    repository,
    final_shard_receipts: finalShardReceipts,
    open_pull_requests: openPullRequests,
  });
}

export function validateV2CandidateInventory(value, expectedRepository = null) {
  if (value !== null && typeof value === "object") {
    const cached = safeWeakMapGet(NORMALIZED_INVENTORY_CACHE, value);
    if (cached !== undefined) {
      if (expectedRepository !== null &&
          canonicalJson(cached.repository) !==
            canonicalJson(normalizeRepository(expectedRepository))) {
        throw new TypeError(
          "candidate inventory repository differs from expected scope",
        );
      }
      return cached;
    }
  }
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
  const candidateIds = new SafeSet();
  for (const candidate of candidates) {
    safeSetAdd(candidateIds, candidate.id);
  }
  for (const id of retained) {
    if (!safeSetHas(candidateIds, id)) {
      throw new Error("candidate inventory retained id is outside the superset");
    }
  }
  if (!safeArrayIsArray(value.passes) || value.passes.length < 2 ||
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
  const normalized = deepFreeze({
    ...safeStructuredClone(value),
    repository,
    candidates,
    high_watermark: highWatermark,
    retained_prior_candidate_ids: retained,
    passes,
    shards,
  });
  safeWeakMapSet(NORMALIZED_INVENTORY_CACHE, normalized, normalized);
  return normalized;
}

/**
 * Validate receipt structure and bounded scan consistency.
 *
 * This does not recover the factory's private publication authority. Only the
 * creating factory's synchronous projector can admit a live receipt for an
 * authenticated producer envelope.
 */
export function validateV2CurrentOpenCandidateInventory(
  value,
  expectedRepository = null,
) {
  assertObject(value, "current-open candidate inventory");
  exactKeys(value, [
    "schema", "schema_version", "factory_epoch", "producer_assurance",
    "repository", "graphql_url", "api_version", "query", "query_sha256",
    "effective_limits", "ref_fence", "ref_fence_assurance",
    "current_open_pull_requests", "current_open_semantic_digest", "passes",
    "observation_window", "stable", "completeness", "receipt_digest",
  ], "current-open candidate inventory");
  if (
    value.schema !== V2_CURRENT_OPEN_CANDIDATE_INVENTORY_SCHEMA ||
    value.schema_version !== 4 || value.stable !== true ||
    value.producer_assurance !== CURRENT_OPEN_PRODUCER_ASSURANCE ||
    value.ref_fence !== null ||
    value.ref_fence_assurance !== CURRENT_OPEN_REF_FENCE_ASSURANCE ||
    value.completeness !== "bounded-stable-sampled-current-open-net-set"
  ) {
    throw new TypeError(
      "current-open candidate inventory schema or assurance is invalid",
    );
  }
  const factoryEpoch = normalizeCurrentOpenFactoryEpoch(value.factory_epoch);
  const repository = normalizeRepository(value.repository);
  const endpoint = normalizeGraphqlUrl(value.graphql_url);
  if (endpoint.href !== value.graphql_url ||
      value.api_version !== GITHUB_API_VERSION ||
      value.query !== V2_CURRENT_OPEN_PULL_REQUESTS_QUERY ||
      value.query_sha256 !== rawDigest(V2_CURRENT_OPEN_PULL_REQUESTS_QUERY)) {
    throw new TypeError(
      "current-open candidate inventory request authority is invalid",
    );
  }
  const effectiveLimits = normalizeCurrentOpenEffectiveLimits(
    value.effective_limits,
    "current-open candidate inventory effective limits",
  );
  if (expectedRepository !== null &&
      canonicalJson(repository) !==
        canonicalJson(normalizeRepository(expectedRepository))) {
    throw new TypeError(
      "current-open candidate inventory repository differs from expected scope",
    );
  }
  if (!safeArrayIsArray(value.current_open_pull_requests) ||
      value.current_open_pull_requests.length >
        MAX_V2_CURRENT_OPEN_CANDIDATES) {
    throw inventoryError(
      "CANDIDATE_OPEN_SET_CAP",
      "current-open candidate inventory exceeds its dispatch cap",
    );
  }
  const currentOpen = safeArrayMap(
    value.current_open_pull_requests,
    (observation, index) => normalizeStoredCurrentOpenObservation(
      observation,
      `current-open pull request ${index}`,
    ),
  );
  assertUniqueOrderedCurrentOpen(currentOpen);
  digest(
    value.current_open_semantic_digest,
    "current-open candidate inventory semantic digest",
  );
  const semanticProjection = currentOpenDispatchProjection(currentOpen);
  if (value.current_open_semantic_digest !== digestCanonical(
    "codex-review-gate-v2-current-open-dispatch-semantic",
    semanticProjection,
  )) {
    throw new Error(
      "current-open candidate inventory semantic digest is invalid",
    );
  }
  if (!safeArrayIsArray(value.passes) || value.passes.length < 2 ||
      value.passes.length > effectiveLimits.max_passes) {
    throw new TypeError(
      "current-open candidate inventory requires bounded stable passes",
    );
  }
  const requestIds = new SafeSet();
  const passes = safeArrayMap(
    value.passes,
    (pass, index) => normalizeCurrentOpenPassReceipt(
      pass,
      repository,
      index + 1,
      endpoint.href,
      requestIds,
      effectiveLimits.max_pages,
    ),
  );
  for (let index = 1; index < passes.length; index += 1) {
    if (index < passes.length - 1 &&
        passes[index].current_open_semantic_digest ===
          passes[index - 1].current_open_semantic_digest) {
      throw new Error(
        "current-open candidate inventory did not stop at its earliest stable pair",
      );
    }
    if (Date.parse(passes[index].observation_window.started_at) <
        Date.parse(passes[index - 1].observation_window.completed_at)) {
      throw new Error("current-open candidate inventory time regressed");
    }
  }
  const previous = passes.at(-2);
  const last = passes.at(-1);
  if (
    previous.current_open_semantic_digest !==
      last.current_open_semantic_digest ||
    last.current_open_semantic_digest !==
      value.current_open_semantic_digest ||
    last.current_open_count !== currentOpen.length ||
    last.identity_digest !== digestCanonical(
      "codex-review-gate-v2-candidate-identities",
      safeArrayMap(currentOpen, candidateIdentityProjection),
    ) ||
    canonicalJson(last.first_candidate) !==
      canonicalJson(currentOpen[0] === undefined
        ? null
        : candidateIdentityProjection(currentOpen[0])) ||
    canonicalJson(last.last_candidate) !==
      canonicalJson(currentOpen.at(-1) === undefined
        ? null
        : candidateIdentityProjection(currentOpen.at(-1)))
  ) {
    throw new Error(
      "current-open candidate inventory final scan pair is not stable or complete",
    );
  }
  const observationWindow = normalizeObservationWindow(
    value.observation_window,
    "current-open candidate inventory observation window",
  );
  if (
    observationWindow.started_at !== passes[0].observation_window.started_at ||
    observationWindow.completed_at !==
      passes.at(-1).observation_window.completed_at
  ) {
    throw new Error(
      "current-open candidate inventory observation window is incomplete",
    );
  }
  digest(value.receipt_digest, "current-open candidate inventory receipt digest");
  const { receipt_digest: _receiptDigest, ...withoutDigest } = value;
  if (value.receipt_digest !== digestCanonical(
    "codex-review-gate-v2-current-open-candidate-inventory",
    withoutDigest,
  )) {
    throw new Error("current-open candidate inventory receipt digest is invalid");
  }
  return deepFreeze({
    ...safeStructuredClone(value),
    factory_epoch: factoryEpoch,
    repository,
    effective_limits: effectiveLimits,
    current_open_pull_requests: currentOpen,
    passes,
    observation_window: observationWindow,
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
  if (!safeArrayIsArray(value.observations) ||
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
  return deepFreeze({ ...safeStructuredClone(value), candidates, observations });
}

function orderCycleShardReceipts(
  receipts,
  inventory,
  label = "candidate shard",
) {
  if (!safeArrayIsArray(receipts) || receipts.length !== inventory.shards.length) {
    throw inventoryError(
      "CANDIDATE_SHARDS_INCOMPLETE",
      `every ${label} must have one exact lifecycle receipt`,
    );
  }
  const byIndex = new Map();
  for (const value of receipts) {
    const receipt = validateV2CandidateShardReceipt(value, inventory);
    if (byIndex.has(receipt.shard_index)) {
      throw inventoryError(
        "CANDIDATE_SHARD_DUPLICATE",
        `${label} receipt index is duplicated`,
      );
    }
    byIndex.set(receipt.shard_index, receipt);
  }
  return inventory.shards.map((_, index) => {
    const receipt = byIndex.get(index);
    if (receipt === undefined) {
      throw inventoryError(
        "CANDIDATE_SHARDS_INCOMPLETE",
        `${label} receipt is missing`,
        { shard_index: index },
      );
    }
    return receipt;
  });
}

function normalizeEmbeddedFinalShardReceipts(
  values,
  repository,
  finalInventoryReceiptDigest,
) {
  if (!safeArrayIsArray(values)) {
    throw new TypeError("candidate cycle final shard receipts must be an array");
  }
  const receipts = values.map((value, index) => {
    const label = `candidate cycle final shard receipt ${index}`;
    assertObject(value, label);
    exactKeys(value, [
      "schema", "schema_version", "repository", "inventory_receipt_digest",
      "shard_index", "shard_digest", "candidates", "observations",
      "observed_at", "stable", "receipt_digest",
    ], label);
    if (
      value.schema !== V2_CANDIDATE_SHARD_RECEIPT_SCHEMA ||
      value.schema_version !== 1 || value.stable !== true ||
      canonicalJson(normalizeRepository(value.repository)) !==
        canonicalJson(repository) ||
      value.inventory_receipt_digest !== finalInventoryReceiptDigest ||
      !Number.isSafeInteger(value.shard_index) || value.shard_index < 0
    ) {
      throw new TypeError(`${label} identity is invalid`);
    }
    const candidates = normalizeCandidates(value.candidates);
    digest(value.shard_digest, `${label} shard digest`);
    if (!safeArrayIsArray(value.observations) ||
        value.observations.length !== candidates.length) {
      throw new TypeError(`${label} observations are incomplete`);
    }
    const observations = value.observations.map((observation, itemIndex) =>
      normalizeStoredPullObservation(observation, {
        candidate: candidates[itemIndex],
        repository,
      }));
    for (let itemIndex = 1; itemIndex < observations.length; itemIndex += 1) {
      if (Date.parse(observations[itemIndex].endpoint_receipt.server_time) <
          Date.parse(observations[itemIndex - 1]
            .endpoint_receipt.server_time)) {
        throw new Error(`${label} endpoint time regressed`);
      }
    }
    timestamp(value.observed_at, `${label} observed_at`);
    const expectedObservedAt = observations.at(-1)
      ?.endpoint_receipt.server_time;
    if (expectedObservedAt !== undefined &&
        value.observed_at !== expectedObservedAt) {
      throw new Error(`${label} observed_at is not its final exact read`);
    }
    digest(value.receipt_digest, `${label} receipt digest`);
    const { receipt_digest: _receiptDigest, ...withoutDigest } = value;
    if (value.receipt_digest !== digestCanonical(
      "codex-review-gate-v2-candidate-shard",
      withoutDigest,
    )) {
      throw new Error(`${label} receipt digest is invalid`);
    }
    return deepFreeze({
      ...safeStructuredClone(value),
      repository: safeStructuredClone(repository),
      candidates,
      observations,
    });
  });
  for (let index = 0; index < receipts.length; index += 1) {
    if (receipts[index].shard_index !== index) {
      throw new Error(
        "candidate cycle final shard receipts are missing or out of order",
      );
    }
    if (index > 0 && Date.parse(receipts[index].observed_at) <
        Date.parse(receipts[index - 1].observed_at)) {
      throw new Error("candidate cycle final shard time regressed");
    }
  }
  const expectedShards = buildShards(
    receipts.flatMap((receipt) => receipt.candidates),
  );
  if (expectedShards.length !== receipts.length) {
    throw new Error("candidate cycle final shard partition is incomplete");
  }
  for (let index = 0; index < expectedShards.length; index += 1) {
    if (
      receipts[index].shard_digest !== expectedShards[index].shard_digest ||
      canonicalJson(receipts[index].candidates) !==
        canonicalJson(expectedShards[index].candidates)
    ) {
      throw new Error("candidate cycle final shard partition is not canonical");
    }
  }
  return deepFreeze(receipts);
}

function projectCandidateLifecycle(observations) {
  return observations.map((observation) => {
    const { endpoint_receipt: _endpointReceipt, ...projection } = observation;
    return safeStructuredClone(projection);
  });
}

function candidateIdentityProjection(value) {
  return {
    id: value.id,
    node_id: value.node_id,
    number: value.number,
    created_at: value.created_at,
  };
}

function currentOpenDispatchProjection(observations) {
  return safeArrayMap(observations, (observation) => ({
    ...candidateIdentityProjection(observation),
    state: observation.state,
    updated_at: observation.updated_at,
    draft: observation.draft,
    base: safeStructuredClone(observation.base),
    head: safeStructuredClone(observation.head),
  }));
}

function normalizeCurrentOpenObservation(
  value,
  repository,
  label,
) {
  assertObject(value, label);
  exactKeys(value, [
    "id", "fullDatabaseId", "number", "state", "isDraft", "createdAt",
    "updatedAt", "headRefOid", "headRefName", "baseRefOid",
    "baseRefName", "headRepository", "baseRepository",
  ], label);
  if (value.state !== "OPEN") {
    throw inventoryError(
      "CANDIDATE_OPEN_SET_LIFECYCLE",
      `${label} is not one current OPEN pull request`,
    );
  }
  const candidate = normalizeCandidate({
    id: graphqlFullDatabaseId(
      value.fullDatabaseId,
      `${label}.fullDatabaseId`,
    ),
    node_id: boundedString(value.id, `${label}.id`, 256),
    number: value.number,
    created_at: value.createdAt,
  }, `${label} identity`);
  const base = normalizeGraphqlPullRef({
    refName: value.baseRefName,
    refOid: value.baseRefOid,
    repository: value.baseRepository,
  }, `${label} base`);
  if (canonicalJson(base.repo) !== canonicalJson({
    id: repository.id,
    node_id: repository.node_id,
    full_name: `${repository.owner}/${repository.name}`,
  })) {
    throw inventoryError(
      "CANDIDATE_IDENTITY_MISMATCH",
      `${label} base repository differs from the selected repository`,
    );
  }
  return {
    ...candidate,
    state: "open",
    updated_at: timestamp(value.updatedAt, `${label}.updatedAt`),
    draft: boolean(value.isDraft, `${label}.isDraft`),
    base,
    head: normalizeGraphqlPullRef({
      refName: value.headRefName,
      refOid: value.headRefOid,
      repository: value.headRepository,
    }, `${label} head`),
  };
}

function normalizeStoredCurrentOpenObservation(value, label) {
  assertObject(value, label);
  exactKeys(value, [
    "id", "node_id", "number", "created_at", "state", "updated_at",
    "draft", "base", "head",
  ], label);
  const candidate = normalizeCandidate({
    id: value.id,
    node_id: value.node_id,
    number: value.number,
    created_at: value.created_at,
  }, `${label} identity`);
  if (value.state !== "open") {
    throw inventoryError(
      "CANDIDATE_OPEN_SET_LIFECYCLE",
      `${label} is not one current open pull request`,
    );
  }
  return {
    ...candidate,
    state: "open",
    updated_at: timestamp(value.updated_at, `${label} updated_at`),
    draft: boolean(value.draft, `${label} draft`),
    base: normalizePullRef(value.base, `${label} base`),
    head: normalizePullRef(value.head, `${label} head`),
  };
}

function normalizeCurrentOpenGraphqlResponse(value, repository, label) {
  try {
    assertObject(value, label);
    if (Object.hasOwn(value, "errors")) {
      throw inventoryError(
        "CANDIDATE_PAGE_MALFORMED",
        `${label} returned GraphQL errors or partial data`,
      );
    }
    exactKeys(value, ["data"], label);
    assertObject(value.data, `${label}.data`);
    exactKeys(value.data, ["repository"], `${label}.data`);
    if (value.data.repository === null) {
      throw inventoryError(
        "CANDIDATE_INACCESSIBLE",
        `${label} repository is missing or inaccessible`,
      );
    }
    assertObject(value.data.repository, `${label}.data.repository`);
    exactKeys(value.data.repository, [
      "id", "databaseId", "nameWithOwner", "pullRequests",
    ], `${label}.data.repository`);
    const selectedRepository = normalizeGraphqlRepositoryIdentity(
      {
        id: value.data.repository.id,
        databaseId: value.data.repository.databaseId,
        nameWithOwner: value.data.repository.nameWithOwner,
      },
      `${label}.data.repository`,
    );
    if (canonicalJson(selectedRepository) !== canonicalJson({
      id: repository.id,
      node_id: repository.node_id,
      full_name: `${repository.owner}/${repository.name}`,
    })) {
      throw inventoryError(
        "CANDIDATE_IDENTITY_MISMATCH",
        `${label} repository identity differs from the selected scope`,
      );
    }
    const connection = value.data.repository.pullRequests;
    assertObject(connection, `${label}.data.repository.pullRequests`);
    exactKeys(connection, ["nodes", "pageInfo"],
      `${label}.data.repository.pullRequests`);
    if (!safeArrayIsArray(connection.nodes) || connection.nodes.length > 100) {
      throw new TypeError(`${label} nodes are outside the fixed page size`);
    }
    const observations = safeArrayMap(
      connection.nodes,
      (node, index) => normalizeCurrentOpenObservation(
        node,
        repository,
        `${label}.nodes[${index}]`,
      ),
    );
    assertObject(connection.pageInfo, `${label}.pageInfo`);
    exactKeys(connection.pageInfo, ["hasNextPage", "endCursor"],
      `${label}.pageInfo`);
    const hasNextPage = boolean(
      connection.pageInfo.hasNextPage,
      `${label}.pageInfo.hasNextPage`,
    );
    const rawEndCursor = connection.pageInfo.endCursor;
    if (rawEndCursor !== null &&
        (typeof rawEndCursor !== "string" || rawEndCursor.length === 0 ||
          rawEndCursor.length > 1024)) {
      throw inventoryError(
        "CANDIDATE_PAGINATION_INVALID",
        `${label} endCursor is not bounded`,
      );
    }
    const endCursor = rawEndCursor;
    if (hasNextPage && (observations.length === 0 || endCursor === null)) {
      throw inventoryError(
        "CANDIDATE_PAGINATION_INVALID",
        `${label} hasNextPage lacks items and a bounded endCursor`,
      );
    }
    const pageInfo = {
      has_next_page: hasNextPage,
      end_cursor: endCursor,
    };
    return {
      observations,
      page_info: pageInfo,
      page_projection: {
        repository: selectedRepository,
        observations: safeStructuredClone(observations),
        page_info: pageInfo,
      },
    };
  } catch (error) {
    if (isInventoryError(error)) throw error;
    throw inventoryError(
      "CANDIDATE_PAGE_MALFORMED",
      `${label} does not match the fixed GraphQL response schema`,
      null,
      error,
    );
  }
}

function currentOpenArtifactReceipt({
  kind,
  page,
  inputCursor,
  capture,
  normalized,
  endpoint,
}) {
  const identities = safeArrayMap(
    normalized.observations,
    candidateIdentityProjection,
  );
  return deepFreeze({
    kind,
    page,
    input_cursor: inputCursor,
    end_cursor: normalized.page_info.end_cursor,
    has_next_page: normalized.page_info.has_next_page,
    graphql_url: endpoint.href,
    api_version: GITHUB_API_VERSION,
    request_id: capture.receipt.request_id,
    server_time: capture.receipt.server_time,
    request_body_sha256: capture.receipt.request_body_sha256,
    raw_body_sha256: capture.receipt.raw_body_sha256,
    item_count: normalized.observations.length,
    first_candidate: identities[0] ?? null,
    last_candidate: identities.at(-1) ?? null,
    page_semantic_digest: digestCanonical(
      "codex-review-gate-v2-current-open-graphql-page",
      normalized.page_projection,
    ),
  });
}

function currentOpenRawArtifact({
  kind,
  page,
  inputCursor,
  capture,
}) {
  return deepFreeze({
    kind,
    page,
    input_cursor: inputCursor,
    request_body_base64: capture.request_body_base64,
    response_body_base64: capture.raw_body_base64,
    receipt: safeStructuredClone(capture.receipt),
  });
}

function normalizeCurrentOpenArtifactReceipt(value, {
  kind,
  page,
  inputCursor,
  repository,
  graphqlUrl,
  label,
}) {
  assertObject(value, label);
  exactKeys(value, [
    "kind", "page", "input_cursor", "end_cursor", "has_next_page",
    "graphql_url", "api_version", "request_id", "server_time",
    "request_body_sha256", "raw_body_sha256", "item_count",
    "first_candidate", "last_candidate", "page_semantic_digest",
  ], label);
  const normalizedInputCursor = normalizeGraphqlCursor(
    value.input_cursor,
    `${label}.input_cursor`,
  );
  const expectedInputCursor = normalizeGraphqlCursor(
    inputCursor,
    `${label} expected input cursor`,
  );
  if (value.kind !== kind || value.page !== page ||
      canonicalJson(normalizedInputCursor) !==
        canonicalJson(expectedInputCursor) ||
      value.graphql_url !== graphqlUrl ||
      value.api_version !== GITHUB_API_VERSION) {
    throw new Error(`${label} request authority is invalid`);
  }
  const hasNextPage = boolean(value.has_next_page,
    `${label}.has_next_page`);
  const endCursor = normalizeGraphqlCursor(
    value.end_cursor,
    `${label}.end_cursor`,
  );
  if (!Number.isSafeInteger(value.item_count) || value.item_count < 0 ||
      value.item_count > 100 ||
      (hasNextPage && (value.item_count === 0 || endCursor === null))) {
    throw new TypeError(`${label} page size or cursor is invalid`);
  }
  timestamp(value.server_time, `${label}.server_time`);
  normalizeGithubRequestId(value.request_id, `${label}.request_id`);
  digest(value.request_body_sha256, `${label}.request_body_sha256`);
  digest(value.raw_body_sha256, `${label}.raw_body_sha256`);
  digest(value.page_semantic_digest, `${label}.page_semantic_digest`);
  if (value.request_body_sha256 !== rawDigest(
    currentOpenGraphqlRequestBytes(repository, normalizedInputCursor),
  )) {
    throw new Error(`${label} request body digest is not the fixed query`);
  }
  const first = value.first_candidate === null
    ? null
    : normalizeCandidate(value.first_candidate, `${label}.first_candidate`);
  const last = value.last_candidate === null
    ? null
    : normalizeCandidate(value.last_candidate, `${label}.last_candidate`);
  if ((value.item_count === 0) !== (first === null && last === null) ||
      (value.item_count > 0 && (first === null || last === null))) {
    throw new Error(`${label} page boundaries are invalid`);
  }
  return deepFreeze({
    ...safeStructuredClone(value),
    input_cursor: normalizedInputCursor,
    end_cursor: endCursor,
    first_candidate: first,
    last_candidate: last,
  });
}

function normalizeObservationWindow(value, label) {
  assertObject(value, label);
  exactKeys(value, ["started_at", "completed_at"], label);
  const startedAt = timestamp(value.started_at, `${label}.started_at`);
  const completedAt = timestamp(value.completed_at, `${label}.completed_at`);
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    throw new Error(`${label} regressed`);
  }
  return deepFreeze({ started_at: startedAt, completed_at: completedAt });
}

async function scanCurrentOpenPass({
  fetchImpl,
  authorization,
  endpoint,
  repo,
  pass,
  budget,
  limits,
  assertActiveScan,
}) {
  const traversedObservations = [];
  const pages = [];
  const rawPages = [];
  const cursors = new SafeSet();
  let inputCursor = null;
  let firstPageProjection = null;
  let page = 1;
  while (true) {
    if (page > limits.max_pages) {
      throw inventoryError(
        "CANDIDATE_OPEN_SET_CAP",
        "current-open candidate inventory exceeded its page cap",
      );
    }
    assertActiveScan();
    let capture;
    try {
      capture = await graphqlJsonRequest({
        fetchImpl,
        authorization,
        endpoint,
        repository: repo,
        after: inputCursor,
        budget,
        timeoutMs: limits.timeout_ms,
        label: `current-open candidate inventory pass ${pass} page ${page}`,
        maxResponseBytes: limits.max_response_bytes,
        maxTotalBytes: limits.max_total_bytes,
        maxRequests: limits.max_requests,
      });
    } catch (error) {
      assertActiveScan();
      throw error;
    }
    assertActiveScan();
    const normalized = normalizeCurrentOpenGraphqlResponse(
      capture.data,
      repo,
      `current-open pass ${pass} page ${page}`,
    );
    appendDenseArray(traversedObservations, normalized.observations);
    if (traversedObservations.length > MAX_V2_CURRENT_OPEN_CANDIDATES) {
      throw inventoryError(
        "CANDIDATE_OPEN_SET_CAP",
        "current-open candidate inventory exceeds 512 pull requests",
        { count: traversedObservations.length },
      );
    }
    const artifactReceipt = currentOpenArtifactReceipt({
      kind: "page",
      page,
      inputCursor,
      capture,
      normalized,
      endpoint,
    });
    pages.push(artifactReceipt);
    rawPages.push(currentOpenRawArtifact({
      kind: "page",
      page,
      inputCursor,
      capture,
    }));
    if (firstPageProjection === null) {
      firstPageProjection = normalized.page_projection;
    }
    if (!normalized.page_info.has_next_page) break;
    if (traversedObservations.length >= MAX_V2_CURRENT_OPEN_CANDIDATES ||
        page >= limits.max_pages) {
      throw inventoryError(
        "CANDIDATE_OPEN_SET_CAP",
        "current-open GraphQL connection continues beyond its bounded domain",
        { count: traversedObservations.length, page },
      );
    }
    const nextCursor = normalized.page_info.end_cursor;
    if (nextCursor === inputCursor || safeSetHas(cursors, nextCursor)) {
      throw inventoryError(
        "CANDIDATE_PAGINATION_INVALID",
        "current-open GraphQL cursor repeated within one pass",
      );
    }
    safeSetAdd(cursors, nextCursor);
    inputCursor = nextCursor;
    page += 1;
  }
  assertCurrentOpenTraversalOrder(traversedObservations);
  assertActiveScan();
  let fenceCapture;
  try {
    fenceCapture = await graphqlJsonRequest({
      fetchImpl,
      authorization,
      endpoint,
      repository: repo,
      after: null,
      budget,
      timeoutMs: limits.timeout_ms,
      label: `current-open candidate inventory pass ${pass} final fence`,
      maxResponseBytes: limits.max_response_bytes,
      maxTotalBytes: limits.max_total_bytes,
      maxRequests: limits.max_requests,
    });
  } catch (error) {
    assertActiveScan();
    throw error;
  }
  assertActiveScan();
  const fenceNormalized = normalizeCurrentOpenGraphqlResponse(
    fenceCapture.data,
    repo,
    `current-open pass ${pass} final fence`,
  );
  if (canonicalJson(fenceNormalized.page_projection) !==
      canonicalJson(firstPageProjection)) {
    throw inventoryError(
      "CANDIDATE_OPEN_SET_DRIFT",
      "current-open GraphQL first page changed before its final fence",
      { pass },
    );
  }
  const finalFence = currentOpenArtifactReceipt({
    kind: "fence",
    page: 1,
    inputCursor: null,
    capture: fenceCapture,
    normalized: fenceNormalized,
    endpoint,
  });
  const rawFinalFence = currentOpenRawArtifact({
    kind: "fence",
    page: 1,
    inputCursor: null,
    capture: fenceCapture,
  });
  const observations = canonicalizeCurrentOpenObservations(
    traversedObservations,
  );
  const semanticProjection = currentOpenDispatchProjection(observations);
  const identities = safeArrayMap(observations, candidateIdentityProjection);
  const receipt = deepFreeze({
    pass,
    pages,
    final_fence: finalFence,
    current_open_count: observations.length,
    identity_digest: digestCanonical(
      "codex-review-gate-v2-candidate-identities",
      identities,
    ),
    current_open_semantic_digest: digestCanonical(
      "codex-review-gate-v2-current-open-dispatch-semantic",
      semanticProjection,
    ),
    first_candidate: identities[0] ?? null,
    last_candidate: identities.at(-1) ?? null,
    observation_window: {
      started_at: pages[0].server_time,
      completed_at: finalFence.server_time,
    },
  });
  return {
    observations: deepFreeze(safeStructuredClone(observations)),
    semantic_projection: deepFreeze(semanticProjection),
    raw_pages: deepFreeze(rawPages),
    raw_final_fence: deepFreeze(rawFinalFence),
    receipt,
  };
}

function normalizeCurrentOpenPassReceipt(
  value,
  repository,
  expectedPass,
  expectedGraphqlUrl,
  requestIds,
  maxPages,
) {
  assertObject(value, "current-open candidate inventory pass");
  exactKeys(value, [
    "pass", "pages", "final_fence", "current_open_count", "identity_digest",
    "current_open_semantic_digest", "first_candidate", "last_candidate",
    "observation_window",
  ], "current-open candidate inventory pass");
  if (
    value.pass !== expectedPass || !safeArrayIsArray(value.pages) ||
    value.pages.length === 0 ||
    value.pages.length > maxPages ||
    !Number.isSafeInteger(value.current_open_count) ||
    value.current_open_count < 0 ||
    value.current_open_count > MAX_V2_CURRENT_OPEN_CANDIDATES
  ) {
    throw new TypeError("current-open candidate inventory pass is outside its bounds");
  }
  let count = 0;
  let previousServerTime = null;
  let expectedInputCursor = null;
  const cursors = new SafeSet();
  for (let index = 0; index < value.pages.length; index += 1) {
    const page = value.pages[index];
    const normalizedPage = normalizeCurrentOpenArtifactReceipt(
      page,
      {
        kind: "page",
        page: index + 1,
        inputCursor: expectedInputCursor,
        repository,
        graphqlUrl: expectedGraphqlUrl,
        label: `current-open candidate inventory page ${index + 1}`,
      },
    );
    assertUniqueCurrentOpenRequestId(
      normalizedPage.request_id,
      requestIds,
      `current-open candidate inventory page ${index + 1}`,
    );
    if (previousServerTime !== null &&
        Date.parse(normalizedPage.server_time) < Date.parse(previousServerTime)) {
      throw new Error("current-open candidate page server time regressed");
    }
    previousServerTime = normalizedPage.server_time;
    const terminal = index === value.pages.length - 1;
    if (normalizedPage.has_next_page === terminal) {
      throw new Error(
        "current-open candidate cursor chain does not terminate exactly once",
      );
    }
    if (normalizedPage.has_next_page) {
      if (safeSetHas(cursors, normalizedPage.end_cursor) ||
          normalizedPage.end_cursor === normalizedPage.input_cursor) {
        throw new Error("current-open candidate cursor chain repeats");
      }
      safeSetAdd(cursors, normalizedPage.end_cursor);
      expectedInputCursor = normalizedPage.end_cursor;
    }
    count += normalizedPage.item_count;
  }
  if (count !== value.current_open_count) {
    throw new Error(
      "current-open candidate page counts do not cover the open set",
    );
  }
  digest(value.identity_digest, "current-open candidate identity digest");
  digest(value.current_open_semantic_digest,
    "current-open candidate semantic digest");
  const finalFence = normalizeCurrentOpenArtifactReceipt(
    value.final_fence,
    {
      kind: "fence",
      page: 1,
      inputCursor: null,
      repository,
      graphqlUrl: expectedGraphqlUrl,
      label: "current-open candidate inventory final fence",
    },
  );
  assertUniqueCurrentOpenRequestId(
    finalFence.request_id,
    requestIds,
    "current-open candidate inventory final fence",
  );
  if (Date.parse(finalFence.server_time) < Date.parse(previousServerTime) ||
      finalFence.page_semantic_digest !== value.pages[0].page_semantic_digest) {
    throw new Error("current-open candidate final fence is invalid");
  }
  const first = value.first_candidate === null
    ? null
    : normalizeCandidate(value.first_candidate,
      "current-open candidate pass first identity");
  const last = value.last_candidate === null
    ? null
    : normalizeCandidate(value.last_candidate,
      "current-open candidate pass last identity");
  const observationWindow = normalizeObservationWindow(
    value.observation_window,
    "current-open candidate pass observation window",
  );
  if (observationWindow.started_at !== value.pages[0].server_time ||
      observationWindow.completed_at !== finalFence.server_time) {
    throw new Error("current-open candidate pass observation window is invalid");
  }
  return deepFreeze({
    ...safeStructuredClone(value),
    pages: safeStructuredClone(value.pages),
    final_fence: finalFence,
    first_candidate: first,
    last_candidate: last,
    observation_window: observationWindow,
  });
}

function replayCurrentOpenRawArtifact({
  rawArtifact,
  artifactReceipt,
  pass,
  page,
  kind,
  repository,
  endpoint,
}) {
  const label = `current-open raw pass ${pass} ${kind} ${page}`;
  assertObject(rawArtifact, label);
  exactKeys(rawArtifact, [
    "kind", "page", "input_cursor", "request_body_base64",
    "response_body_base64", "receipt",
  ], label);
  if (rawArtifact.kind !== kind || rawArtifact.page !== page ||
      canonicalJson(rawArtifact.input_cursor) !==
        canonicalJson(artifactReceipt.input_cursor)) {
    throw new TypeError(`${label} ordinal is invalid`);
  }
  const requestBytes = decodeCanonicalBase64(
    rawArtifact.request_body_base64,
    `${label} request body`,
    MAX_V2_CURRENT_OPEN_CANDIDATE_REQUEST_BYTES,
  );
  const responseBytes = decodeCanonicalBase64(
    rawArtifact.response_body_base64,
    `${label} raw body`,
    MAX_V2_CURRENT_OPEN_CANDIDATE_RESPONSE_BYTES,
  );
  if (rawDigest(responseBytes) !== artifactReceipt.raw_body_sha256) {
    throw new Error(`${label} raw body digest differs from its receipt`);
  }
  if (rawDigest(requestBytes) !== artifactReceipt.request_body_sha256) {
    throw new Error(`${label} request body digest differs from its receipt`);
  }
  const endpointReceipt = normalizeCurrentOpenEndpointReceipt(
    rawArtifact.receipt,
    endpoint.href,
  );
  if (
    endpointReceipt.server_time !== artifactReceipt.server_time ||
    endpointReceipt.request_id !== artifactReceipt.request_id ||
    endpointReceipt.request_body_sha256 !==
      artifactReceipt.request_body_sha256 ||
    endpointReceipt.raw_body_sha256 !== artifactReceipt.raw_body_sha256
  ) {
    throw new Error(`${label} endpoint receipt differs from its pass receipt`);
  }
  const request = parseExactJsonBytes(
    requestBytes,
    `${label} request body`,
    "CANDIDATE_PAGE_MALFORMED",
  );
  validateCurrentOpenGraphqlRequest(
    request,
    repository,
    artifactReceipt.input_cursor,
    requestBytes,
    label,
  );
  const data = parseExactJsonBytes(
    responseBytes,
    `${label} response body`,
    "CANDIDATE_PAGE_MALFORMED",
  );
  const normalized = normalizeCurrentOpenGraphqlResponse(
    data,
    repository,
    label,
  );
  const expectedReceipt = currentOpenArtifactReceipt({
    kind,
    page,
    inputCursor: artifactReceipt.input_cursor,
    capture: {
      receipt: endpointReceipt,
    },
    normalized,
    endpoint,
  });
  if (canonicalJson(expectedReceipt) !== canonicalJson(artifactReceipt)) {
    throw new Error(`${label} normalized response differs from its pass receipt`);
  }
  return {
    observations: normalized.observations,
    raw_bytes: responseBytes.byteLength,
    input_cursor: artifactReceipt.input_cursor,
    end_cursor: normalized.page_info.end_cursor,
    has_next_page: normalized.page_info.has_next_page,
    page_projection: normalized.page_projection,
    request_id: endpointReceipt.request_id,
  };
}

function validateReplayedCurrentOpenPageChain(pages, label) {
  let expectedInputCursor = null;
  const cursors = new SafeSet();
  let count = 0;
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const terminal = index === pages.length - 1;
    if (canonicalJson(page.input_cursor) !== canonicalJson(expectedInputCursor) ||
        page.has_next_page === terminal) {
      throw new Error(`${label} raw cursor chain is not contiguous and terminal`);
    }
    count += page.observations.length;
    if (count > MAX_V2_CURRENT_OPEN_CANDIDATES ||
        (page.has_next_page && count >= MAX_V2_CURRENT_OPEN_CANDIDATES)) {
      throw inventoryError(
        "CANDIDATE_OPEN_SET_CAP",
        `${label} raw cursor chain exceeds its candidate cap`,
      );
    }
    if (page.has_next_page) {
      if (typeof page.end_cursor !== "string" ||
          page.end_cursor === page.input_cursor ||
          safeSetHas(cursors, page.end_cursor)) {
        throw new Error(`${label} raw cursor chain repeats`);
      }
      safeSetAdd(cursors, page.end_cursor);
      expectedInputCursor = page.end_cursor;
    }
  }
}

function validateReplayedCurrentOpenPass(observations, receipt, label) {
  assertCurrentOpenTraversalOrder(observations);
  const canonical = canonicalizeCurrentOpenObservations(observations);
  const identities = safeArrayMap(canonical, candidateIdentityProjection);
  const semanticProjection = currentOpenDispatchProjection(canonical);
  if (
    observations.length !== receipt.current_open_count ||
    digestCanonical("codex-review-gate-v2-candidate-identities", identities) !==
      receipt.identity_digest ||
    digestCanonical(
      "codex-review-gate-v2-current-open-dispatch-semantic",
      semanticProjection,
    ) !== receipt.current_open_semantic_digest ||
    canonicalJson(identities[0] ?? null) !==
      canonicalJson(receipt.first_candidate) ||
    canonicalJson(identities.at(-1) ?? null) !==
      canonicalJson(receipt.last_candidate)
  ) {
    throw new Error(`${label} does not replay its pass receipt`);
  }
  return canonical;
}

function assertUniqueOrderedCurrentOpen(observations) {
  normalizeCandidates(safeArrayMap(observations, candidateIdentityProjection));
}

function decodeCanonicalBase64(
  value,
  label,
  maxBytes = MAX_V2_CURRENT_OPEN_CANDIDATE_RESPONSE_BYTES,
) {
  const maxLength = Math.ceil(maxBytes / 3) * 4;
  if (typeof value !== "string" || value.length === 0 ||
      value.length > maxLength || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) {
    throw new TypeError(`${label} is not bounded canonical Base64`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength > maxBytes || bytes.toString("base64") !== value) {
    throw new TypeError(`${label} is not bounded canonical Base64`);
  }
  return new Uint8Array(bytes);
}

function canonicalizeCurrentOpenObservations(observations) {
  const canonical = safeArrayMap(
    observations,
    (observation) => observation,
  );
  reflectApply(arraySortIntrinsic, canonical, [
    (left, right) => compareCandidate(left, right),
  ]);
  assertUniqueOrderedCurrentOpen(canonical);
  return canonical;
}

function assertCurrentOpenTraversalOrder(observations) {
  for (let index = 1; index < observations.length; index += 1) {
    if (Date.parse(observations[index].created_at) <
        Date.parse(observations[index - 1].created_at)) {
      throw inventoryError(
        "CANDIDATE_ORDER_INVALID",
        "current-open GraphQL traversal regressed in CREATED_AT order",
      );
    }
  }
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
    if (!safeArrayIsArray(capture.data)) {
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
        restBaseIdentity(base),
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
      !safeArrayIsArray(value.pages) || value.pages.length === 0 ||
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
    ...safeStructuredClone(value), candidates, high_watermark: highWatermark,
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
  const state = enumValue(value.state, new SafeSet(["open", "closed"]),
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
    ...safeStructuredClone(value),
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

function normalizeGraphqlPullRef(value, label) {
  assertObject(value, label);
  exactKeys(value, ["refName", "refOid", "repository"], label);
  return {
    ref: boundedString(value.refName, `${label}.refName`, 255),
    sha: sha(value.refOid, `${label}.refOid`),
    repo: normalizeGraphqlRepositoryIdentity(
      value.repository,
      `${label}.repository`,
    ),
  };
}

function normalizeGraphqlRepositoryIdentity(value, label) {
  assertObject(value, label);
  exactKeys(value, ["id", "databaseId", "nameWithOwner"], label);
  const fullName = boundedString(
    value.nameWithOwner,
    `${label}.nameWithOwner`,
    256,
  );
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u.test(fullName)) {
    throw new TypeError(`${label}.nameWithOwner is invalid`);
  }
  return {
    id: graphqlDatabaseId(value.databaseId, `${label}.databaseId`),
    node_id: boundedString(value.id, `${label}.id`, 256),
    full_name: fullName,
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
  return deepFreeze(safeStructuredClone(value));
}

function normalizeCurrentOpenEndpointReceipt(
  value,
  expectedGraphqlUrl,
) {
  assertObject(value, "current-open candidate endpoint receipt");
  exactKeys(value, [
    "method", "url", "status", "server_time", "request_body_sha256",
    "raw_body_sha256", "api_version", "request_id",
  ], "current-open candidate endpoint receipt");
  if (value.method !== "POST" || value.url !== expectedGraphqlUrl ||
      value.status !== 200 || value.api_version !== GITHUB_API_VERSION) {
    throw new Error(
      "current-open candidate endpoint request authority changed",
    );
  }
  timestamp(value.server_time, "current-open endpoint server_time");
  normalizeGithubRequestId(value.request_id, "current-open endpoint request_id");
  digest(value.request_body_sha256, "current-open endpoint request digest");
  digest(value.raw_body_sha256, "current-open endpoint response digest");
  return deepFreeze(safeStructuredClone(value));
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
  if (!safeArrayIsArray(value)) {
    throw new TypeError("candidate inventory must be an array");
  }
  const candidates = safeArrayMap(
    value,
    (candidate, index) => normalizeCandidate(candidate, `candidate ${index}`),
  );
  const ids = new SafeSet();
  const nodes = new SafeSet();
  const numbers = new SafeSet();
  for (const candidate of candidates) {
    if (safeSetHas(ids, candidate.id) ||
        safeSetHas(nodes, candidate.node_id) ||
        safeSetHas(numbers, candidate.number)) {
      throw inventoryError(
        "CANDIDATE_IDENTITY_CONFLICT",
        "candidate id, node id, and number must each be unique",
      );
    }
    safeSetAdd(ids, candidate.id);
    safeSetAdd(nodes, candidate.node_id);
    safeSetAdd(numbers, candidate.number);
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
  if (!safeArrayIsArray(value)) {
    throw new TypeError("candidate shards must be an array");
  }
  const expected = buildShards(candidates);
  if (canonicalJson(value) !== canonicalJson(expected)) {
    throw new Error("candidate shards are not the canonical bounded partition");
  }
  return deepFreeze(safeStructuredClone(expected));
}

function normalizeNextLink(
  value,
  {
    base,
    repoPath,
    currentPage,
    itemCount,
    state = "all",
    allowFullPageWithoutNext = false,
  },
) {
  if (value === null) {
    if (itemCount === 100 && !allowFullPageWithoutNext) {
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
    if (match === null || relations.has(match[2]) ||
        !safeSetHas(new SafeSet(["next", "prev", "first", "last"]),
          match[2])) {
      throw inventoryError(
        "CANDIDATE_PAGINATION_INVALID",
        "candidate inventory Link header is malformed or ambiguous",
      );
    }
    relations.set(match[2], match[1]);
  }
  const expectedPathname = new URL(
    `${repoPath.replace(/^\//u, "")}/pulls`,
    base,
  ).pathname;
  for (const [relation, target] of relations) {
    let url;
    try {
      url = new URL(target);
    } catch (error) {
      throw inventoryError(
        "CANDIDATE_PAGINATION_INVALID",
        "candidate inventory Link target is not one absolute URL",
        null,
        error,
      );
    }
    if (url.origin !== base.origin || url.pathname !== expectedPathname) {
      throw inventoryError(
        "CANDIDATE_PAGINATION_INVALID",
        "candidate inventory Link relation leaves the fixed API scope",
      );
    }
    const targetPage = url.searchParams.get("page");
    const targetPageNumber = Number(targetPage);
    if (targetPage === null || !DECIMAL.test(targetPage) ||
        !Number.isSafeInteger(targetPageNumber) || targetPageNumber < 1 ||
        (relation === "next" && targetPageNumber !== currentPage + 1) ||
        (relation === "prev" &&
          (currentPage === 1 || targetPageNumber !== currentPage - 1)) ||
        (relation === "first" && targetPageNumber !== 1)) {
      throw inventoryError(
        "CANDIDATE_PAGINATION_INVALID",
        "candidate inventory Link relation has an invalid page target",
      );
    }
    const expected = new URLSearchParams({
      state,
      sort: "created",
      direction: "asc",
      per_page: "100",
      page: targetPage,
    });
    if (canonicalJson(canonicalSearch(url.searchParams)) !==
        canonicalJson(canonicalSearch(expected))) {
      throw inventoryError(
        "CANDIDATE_PAGINATION_INVALID",
        "candidate inventory Link relation leaves the fixed query",
      );
    }
  }
  const next = relations.get("next");
  const last = relations.get("last");
  const lastPage = last === undefined
    ? null
    : Number(new URL(last).searchParams.get("page"));
  if ((next === undefined && lastPage !== null && lastPage > currentPage) ||
      (next !== undefined && lastPage !== null &&
        lastPage < currentPage + 1) ||
      (lastPage !== null && itemCount > 0 && lastPage < currentPage) ||
      (lastPage !== null && itemCount === 0 &&
        lastPage < Math.max(1, currentPage - 1))) {
    throw inventoryError(
      "CANDIDATE_PAGINATION_INVALID",
      "candidate inventory Link relations disagree about future pages",
    );
  }
  if (next === undefined) {
    if (itemCount === 100 && !allowFullPageWithoutNext) {
      throw inventoryError(
        "CANDIDATE_PAGINATION_INCOMPLETE",
        "a full candidate page omitted its exact next Link",
      );
    }
    return null;
  }
  return currentPage + 1;
}

function canonicalSearch(value) {
  return [...value.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) =>
    leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
}

function currentOpenGraphqlRequestBytes(repository, after) {
  return Buffer.from(reflectApply(jsonStringifyIntrinsic, JSON, [{
    query: V2_CURRENT_OPEN_PULL_REQUESTS_QUERY,
    variables: {
      owner: repository.owner,
      name: repository.name,
      after,
    },
  }]), "utf8");
}

function validateCurrentOpenGraphqlRequest(
  value,
  repository,
  after,
  bytes,
  label,
) {
  assertObject(value, `${label} GraphQL request`);
  exactKeys(value, ["query", "variables"], `${label} GraphQL request`);
  if (value.query !== V2_CURRENT_OPEN_PULL_REQUESTS_QUERY) {
    throw new Error(`${label} GraphQL query is not the fixed operation`);
  }
  assertObject(value.variables, `${label} GraphQL variables`);
  exactKeys(value.variables, ["owner", "name", "after"],
    `${label} GraphQL variables`);
  const normalizedAfter = normalizeGraphqlCursor(
    value.variables.after,
    `${label} GraphQL variables.after`,
  );
  if (value.variables.owner !== repository.owner ||
      value.variables.name !== repository.name ||
      canonicalJson(normalizedAfter) !== canonicalJson(after)) {
    throw new Error(`${label} GraphQL variables leave the selected scope`);
  }
  const expectedBytes = currentOpenGraphqlRequestBytes(repository, after);
  if (!Buffer.from(bytes).equals(expectedBytes)) {
    throw new Error(`${label} GraphQL request bytes are not canonical`);
  }
}

async function graphqlJsonRequest({
  fetchImpl,
  authorization,
  endpoint,
  repository,
  after,
  budget,
  timeoutMs,
  label,
  maxResponseBytes,
  maxTotalBytes,
  maxRequests,
}) {
  const requestBytes = currentOpenGraphqlRequestBytes(repository, after);
  if (requestBytes.byteLength > MAX_V2_CURRENT_OPEN_CANDIDATE_REQUEST_BYTES) {
    throw inventoryError(
      "CANDIDATE_REQUEST_TOO_LARGE",
      `${label} fixed GraphQL request exceeds its byte profile`,
    );
  }
  const outboundRequestBody = requestBytes.toString("utf8");
  budget.requests += 1;
  if (budget.requests > maxRequests ||
      budget.requests > MAX_V2_CURRENT_OPEN_GRAPHQL_REQUESTS) {
    throw inventoryError(
      "CANDIDATE_REQUEST_CAP_EXCEEDED",
      "current-open GraphQL request cap exceeded",
    );
  }
  const controller = new SafeAbortController();
  const timeoutError = inventoryError(
    "CANDIDATE_HTTP_TIMEOUT",
    `${label} timed out`,
  );
  const deadlineAt = monotonicNow() + timeoutMs;
  let timedOut = false;
  let rejectDeadline;
  const deadline = new SafePromise((_, reject) => {
    rejectDeadline = reject;
  });
  const timer = safeSetTimeout(() => {
    timedOut = true;
    controller.abort(TRANSPORT_ABORT_SENTINEL);
    rejectDeadline(timeoutError);
  }, timeoutMs);
  try {
    const requestHeaders = safeObjectFreeze({
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${authorization}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    });
    const requestInit = safeObjectFreeze({
      method: "POST",
      headers: requestHeaders,
      body: outboundRequestBody,
      redirect: "error",
      signal: controller.signal,
    });
    const response = await settleFirst(
      callExternalAdapter(
        () => fetchImpl(endpoint.href, requestInit),
        `${label} fetch`,
      ),
      deadline,
    );
    const responseView = inspectExternalResponse(response, label);
    if (responseView.status !== 200 || responseView.headers === null ||
        typeof responseView.get_header !== "function" ||
        responseView.body === null ||
        typeof responseView.get_reader !== "function") {
      throw inventoryError(
        responseView.status === 404
          ? "CANDIDATE_INACCESSIBLE"
          : "CANDIDATE_HTTP_UNREADABLE",
        `${label} did not return one readable streaming GraphQL HTTP 200`,
        {
          status: Number.isSafeInteger(responseView.status)
            ? responseView.status
            : null,
        },
      );
    }
    const serverTime = normalizeHttpDate(
      readExternalHeader(responseView, "date", label),
      `${label} Date`,
    );
    let requestId;
    try {
      requestId = normalizeGithubRequestId(
        readExternalHeader(responseView, "x-github-request-id", label),
        `${label} X-GitHub-Request-Id`,
      );
    } catch (error) {
      throw inventoryError(
        "CANDIDATE_HTTP_UNREADABLE",
        `${label} X-GitHub-Request-Id is missing or invalid`,
        null,
        error,
      );
    }
    assertUniqueCurrentOpenRequestId(
      requestId,
      budget.request_ids,
      label,
    );
    const declaredLength = readExternalHeader(
      responseView,
      "content-length",
      label,
    );
    if (declaredLength !== null &&
        (typeof declaredLength !== "string" ||
          !DECIMAL.test(declaredLength) ||
          !Number.isSafeInteger(Number(declaredLength)))) {
      throw inventoryError(
        "CANDIDATE_HTTP_UNREADABLE",
        `${label} Content-Length is invalid`,
      );
    }
    if (declaredLength !== null && Number(declaredLength) > maxResponseBytes) {
      throw inventoryError(
        "CANDIDATE_RESPONSE_TOO_LARGE",
        `${label} is too large`,
      );
    }
    if (declaredLength !== null &&
        budget.bytes + Number(declaredLength) > maxTotalBytes) {
      throw inventoryError(
        "CANDIDATE_TOTAL_BYTES_EXCEEDED",
        "current-open GraphQL byte budget exceeded",
      );
    }
    const bytes = await readBoundedResponseBody({
      responseView,
      controller,
      deadline,
      deadlineAt,
      timeoutError,
      label,
      maxResponseBytes,
      maxTotalBytes,
      priorTotalBytes: budget.bytes,
    });
    budget.bytes += bytes.byteLength;
    const data = parseExactJsonBytes(
      bytes,
      `${label} response body`,
      "CANDIDATE_PAGE_MALFORMED",
    );
    return {
      data,
      request_body_base64: requestBytes.toString("base64"),
      raw_body_base64: Buffer.from(bytes).toString("base64"),
      receipt: {
        method: "POST",
        url: endpoint.href,
        status: 200,
        server_time: serverTime,
        request_body_sha256: rawDigest(requestBytes),
        raw_body_sha256: rawDigest(bytes),
        api_version: GITHUB_API_VERSION,
        request_id: requestId,
      },
    };
  } catch (error) {
    if (timedOut) {
      throw timeoutError;
    }
    if (isInventoryError(error)) {
      if (!controller.signal.aborted) {
        controller.abort(TRANSPORT_ABORT_SENTINEL);
      }
      throw error;
    }
    controller.abort(TRANSPORT_ABORT_SENTINEL);
    throw inventoryError(
      "CANDIDATE_HTTP_UNREADABLE",
      `${label} failed`,
      null,
      error,
    );
  } finally {
    safeClearTimeout(timer);
  }
}

function parseExactJsonBytes(bytes, label, errorCode) {
  try {
    if (bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb &&
        bytes[2] === 0xbf) {
      throw new SyntaxError("JSON BOM is not permitted");
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    assertNoDuplicateJsonObjectKeys(text);
    return JSON.parse(text);
  } catch (error) {
    throw inventoryError(
      errorCode,
      `${label} is not unambiguous exact UTF-8 JSON`,
      null,
      error,
    );
  }
}

function assertNoDuplicateJsonObjectKeys(text) {
  let offset = 0;
  const numberPattern =
    /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/uy;
  const whitespace = () => {
    while (text[offset] === " " || text[offset] === "\n" ||
        text[offset] === "\r" || text[offset] === "\t") {
      offset += 1;
    }
  };
  const parseString = () => {
    if (text[offset] !== '"') throw new SyntaxError("expected JSON string");
    const start = offset;
    offset += 1;
    while (offset < text.length) {
      if (text[offset] === '"') {
        offset += 1;
        return JSON.parse(text.slice(start, offset));
      }
      if (text[offset] === "\\") {
        offset += 1;
        if (text[offset] === "u") offset += 4;
      }
      offset += 1;
    }
    throw new SyntaxError("unterminated JSON string");
  };
  const parseValue = () => {
    whitespace();
    if (text[offset] === "{") {
      offset += 1;
      whitespace();
      const keys = new SafeSet();
      if (text[offset] === "}") {
        offset += 1;
        return;
      }
      while (true) {
        const key = parseString();
        if (safeSetHas(keys, key)) {
          throw new SyntaxError("duplicate JSON member");
        }
        safeSetAdd(keys, key);
        whitespace();
        if (text[offset] !== ":") throw new SyntaxError("expected colon");
        offset += 1;
        parseValue();
        whitespace();
        if (text[offset] === "}") {
          offset += 1;
          return;
        }
        if (text[offset] !== ",") throw new SyntaxError("expected comma");
        offset += 1;
        whitespace();
      }
    }
    if (text[offset] === "[") {
      offset += 1;
      whitespace();
      if (text[offset] === "]") {
        offset += 1;
        return;
      }
      while (true) {
        parseValue();
        whitespace();
        if (text[offset] === "]") {
          offset += 1;
          return;
        }
        if (text[offset] !== ",") throw new SyntaxError("expected comma");
        offset += 1;
      }
    }
    if (text[offset] === '"') {
      parseString();
      return;
    }
    const literals = ["true", "false", "null"];
    for (let index = 0; index < literals.length; index += 1) {
      const literal = literals[index];
      if (text.startsWith(literal, offset)) {
        offset += literal.length;
        return;
      }
    }
    numberPattern.lastIndex = offset;
    const number = numberPattern.exec(text)?.[0];
    if (number === undefined) throw new SyntaxError("invalid JSON value");
    offset = numberPattern.lastIndex;
  };
  parseValue();
  whitespace();
  if (offset !== text.length) throw new SyntaxError("trailing JSON data");
}

async function jsonRequest({
  fetchImpl,
  authorization,
  base,
  path,
  budget,
  timeoutMs,
  label,
  captureRawBody = false,
  maxResponseBytes = MAX_V2_CANDIDATE_RESPONSE_BYTES,
  maxTotalBytes = MAX_V2_CANDIDATE_TOTAL_BYTES,
}) {
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0 ||
      maxResponseBytes > MAX_V2_CURRENT_OPEN_CANDIDATE_RESPONSE_BYTES ||
      !Number.isSafeInteger(maxTotalBytes) || maxTotalBytes <= 0 ||
      maxTotalBytes > MAX_V2_CANDIDATE_TOTAL_BYTES) {
    throw new TypeError("candidate request byte limits are outside the closed profile");
  }
  budget.requests += 1;
  if (budget.requests >
      (MAX_V2_CANDIDATE_PAGES * MAX_V2_CANDIDATE_SCAN_PASSES) +
        MAX_V2_CANDIDATES_PER_SHARD + 8) {
    throw inventoryError("CANDIDATE_REQUEST_CAP_EXCEEDED", "candidate request cap exceeded");
  }
  const url = new URL(path.replace(/^\//u, ""), base);
  const controller = new SafeAbortController();
  const timeoutError = inventoryError(
    "CANDIDATE_HTTP_TIMEOUT",
    `${label} timed out`,
  );
  const deadlineAt = monotonicNow() + timeoutMs;
  let timedOut = false;
  let rejectDeadline;
  const deadline = new SafePromise((_, reject) => {
    rejectDeadline = reject;
  });
  const timer = safeSetTimeout(() => {
    timedOut = true;
    controller.abort(TRANSPORT_ABORT_SENTINEL);
    rejectDeadline(timeoutError);
  }, timeoutMs);
  try {
    const response = await settleFirst(
      callExternalAdapter(() => fetchImpl(url.href, {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${authorization}`,
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
        },
        redirect: "error",
        signal: controller.signal,
      }), `${label} fetch`),
      deadline,
    );
    const responseView = inspectExternalResponse(response, label);
    if (responseView.status !== 200 || responseView.headers === null ||
        typeof responseView.get_header !== "function" ||
        responseView.body === null ||
        typeof responseView.get_reader !== "function") {
      throw inventoryError(
        responseView.status === 404
          ? "CANDIDATE_INACCESSIBLE"
          : "CANDIDATE_HTTP_UNREADABLE",
        `${label} did not return one readable streaming HTTP 200`,
        {
          status: Number.isSafeInteger(responseView.status)
            ? responseView.status
            : null,
        },
      );
    }
    const serverTime = normalizeHttpDate(
      readExternalHeader(responseView, "date", label),
      `${label} Date`,
    );
    const declaredLength = readExternalHeader(
      responseView,
      "content-length",
      label,
    );
    if (declaredLength !== null &&
        (typeof declaredLength !== "string" ||
          !DECIMAL.test(declaredLength) ||
          !Number.isSafeInteger(Number(declaredLength)))) {
      throw inventoryError(
        "CANDIDATE_HTTP_UNREADABLE",
        `${label} Content-Length is invalid`,
      );
    }
    if (declaredLength !== null && Number(declaredLength) > maxResponseBytes) {
      throw inventoryError(
        "CANDIDATE_RESPONSE_TOO_LARGE",
        `${label} is too large`,
      );
    }
    if (declaredLength !== null &&
        budget.bytes + Number(declaredLength) > maxTotalBytes) {
      throw inventoryError(
        "CANDIDATE_TOTAL_BYTES_EXCEEDED",
        "candidate byte budget exceeded",
      );
    }
    const bytes = await readBoundedResponseBody({
      responseView,
      controller,
      deadline,
      deadlineAt,
      timeoutError,
      label,
      maxResponseBytes,
      maxTotalBytes,
      priorTotalBytes: budget.bytes,
    });
    budget.bytes += bytes.byteLength;
    let text;
    let data;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      data = JSON.parse(text);
    } catch (error) {
      throw inventoryError(
        "CANDIDATE_HTTP_UNREADABLE",
        `${label} is not UTF-8 JSON`,
        null,
        error,
      );
    }
    return {
      data,
      link: readExternalHeader(responseView, "link", label),
      ...(captureRawBody
        ? { raw_body_base64: Buffer.from(bytes).toString("base64") }
        : {}),
      receipt: {
        method: "GET",
        path,
        status: 200,
        server_time: serverTime,
        raw_body_sha256: rawDigest(bytes),
      },
    };
  } catch (error) {
    if (timedOut) {
      throw timeoutError;
    }
    if (isInventoryError(error)) {
      if (!controller.signal.aborted) {
        controller.abort(TRANSPORT_ABORT_SENTINEL);
      }
      throw error;
    }
    controller.abort(TRANSPORT_ABORT_SENTINEL);
    throw inventoryError(
      "CANDIDATE_HTTP_UNREADABLE",
      `${label} failed`,
      null,
      error,
    );
  } finally {
    safeClearTimeout(timer);
  }
}

async function readBoundedResponseBody({
  responseView,
  controller,
  deadline,
  deadlineAt,
  timeoutError,
  label,
  maxResponseBytes,
  maxTotalBytes,
  priorTotalBytes,
}) {
  const reader = callExternalAdapterSync(
    () => reflectApply(
      responseView.get_reader,
      responseView.body,
      [],
    ),
    `${label} body reader`,
  );
  const remainingTotalBytes = maxTotalBytes - priorTotalBytes;
  const capacity = Math.min(maxResponseBytes, remainingTotalBytes);
  const bytes = new Uint8Array(capacity);
  let total = 0;
  let reads = 0;
  let chunks = 0;
  let failed = null;
  const assertBeforeDeadline = () => {
    if (monotonicNow() >= deadlineAt) throw timeoutError;
  };
  try {
    while (true) {
      assertBeforeDeadline();
      if (reads > 0 &&
          reads % RESPONSE_BODY_DEADLINE_YIELD_INTERVAL === 0) {
        await settleFirst(
          new SafePromise((resolve) => safeSetTimeout(resolve, 0)),
          deadline,
        );
        assertBeforeDeadline();
      }
      if (reads >= MAX_V2_CANDIDATE_RESPONSE_CHUNKS + 1) {
        throw inventoryError(
          "CANDIDATE_RESPONSE_FRAGMENTED",
          `${label} exceeded its streaming read profile`,
        );
      }
      const result = await settleFirst(
        callExternalAdapter(() => reader.read(), `${label} body reader`),
        deadline,
      );
      reads += 1;
      assertBeforeDeadline();
      const resultView = inspectExternalReadResult(result, label);
      if (typeof resultView.done !== "boolean") {
        throw inventoryError(
          "CANDIDATE_HTTP_UNREADABLE",
          `${label} returned an invalid body read result`,
        );
      }
      if (resultView.done) {
        if (!resultView.done_value_valid) {
          throw inventoryError(
            "CANDIDATE_HTTP_UNREADABLE",
            `${label} returned a value after the body ended`,
          );
        }
        break;
      }
      if (!resultView.is_bytes) {
        throw inventoryError(
          "CANDIDATE_HTTP_UNREADABLE",
          `${label} returned a non-byte body chunk`,
        );
      }
      chunks += 1;
      if (resultView.byte_length === 0) {
        throw inventoryError(
          "CANDIDATE_HTTP_UNREADABLE",
          `${label} returned an empty body chunk`,
        );
      }
      if (chunks > MAX_V2_CANDIDATE_RESPONSE_CHUNKS) {
        throw inventoryError(
          "CANDIDATE_RESPONSE_FRAGMENTED",
          `${label} exceeded its streaming chunk profile`,
        );
      }
      const nextTotal = total + resultView.byte_length;
      if (nextTotal > maxResponseBytes) {
        throw inventoryError(
          "CANDIDATE_RESPONSE_TOO_LARGE",
          `${label} is too large`,
        );
      }
      if (priorTotalBytes + nextTotal > maxTotalBytes) {
        throw inventoryError(
          "CANDIDATE_TOTAL_BYTES_EXCEEDED",
          "candidate byte budget exceeded",
        );
      }
      assertBeforeDeadline();
      const snapshot = snapshotExternalBodyChunk(
        resultView.value,
        resultView.byte_length,
        label,
      );
      assertBeforeDeadline();
      reflectApply(uint8ArraySetIntrinsic, bytes, [snapshot, total]);
      total = nextTotal;
    }
  } catch (error) {
    failed = error;
    controller.abort(TRANSPORT_ABORT_SENTINEL);
    try {
      void reader.cancel(TRANSPORT_ABORT_SENTINEL).catch(() => {});
    } catch {
      // Preserve the typed transport failure that caused cancellation.
    }
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      if (failed === null) {
        throw inventoryError(
          "CANDIDATE_HTTP_UNREADABLE",
          `${label} body reader could not be released`,
        );
      }
    }
  }
  return bytes.subarray(0, total);
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

function normalizeCurrentOpenLimits({ timeoutMs, maxPages, maxPasses }) {
  const normalized = normalizeLimits({ timeoutMs, maxPages, maxPasses });
  if (normalized.max_pages > MAX_V2_CURRENT_OPEN_CANDIDATE_PAGES) {
    throw new TypeError(
      "current-open candidate page limit exceeds its complete 512-item domain",
    );
  }
  return {
    ...normalized,
    max_request_bytes: MAX_V2_CURRENT_OPEN_CANDIDATE_REQUEST_BYTES,
    max_response_bytes: MAX_V2_CURRENT_OPEN_CANDIDATE_RESPONSE_BYTES,
    max_response_chunks: MAX_V2_CANDIDATE_RESPONSE_CHUNKS,
    max_total_bytes: MAX_V2_CURRENT_OPEN_CANDIDATE_TOTAL_BYTES,
    max_requests: normalized.max_passes * (normalized.max_pages + 1),
  };
}

function normalizeCurrentOpenEffectiveLimits(value, label) {
  assertObject(value, label);
  exactKeys(value, [
    "timeout_ms", "max_pages", "max_passes", "max_response_bytes",
    "max_response_chunks", "max_request_bytes", "max_total_bytes",
    "max_requests",
  ], label);
  const normalized = normalizeCurrentOpenLimits({
    timeoutMs: value.timeout_ms,
    maxPages: value.max_pages,
    maxPasses: value.max_passes,
  });
  if (value.max_request_bytes !==
        MAX_V2_CURRENT_OPEN_CANDIDATE_REQUEST_BYTES ||
      value.max_response_bytes !==
        MAX_V2_CURRENT_OPEN_CANDIDATE_RESPONSE_BYTES ||
      value.max_response_chunks !== MAX_V2_CANDIDATE_RESPONSE_CHUNKS ||
      value.max_total_bytes !== MAX_V2_CURRENT_OPEN_CANDIDATE_TOTAL_BYTES ||
      value.max_requests !== value.max_passes * (value.max_pages + 1) ||
      canonicalJson(value) !== canonicalJson(normalized)) {
    throw new TypeError(`${label} are invalid`);
  }
  return normalized;
}

function sameCurrentOpenLimits(left, right) {
  return left !== null && right !== null &&
    typeof left === "object" && typeof right === "object" &&
    left.timeout_ms === right.timeout_ms &&
    left.max_pages === right.max_pages &&
    left.max_passes === right.max_passes &&
    left.max_request_bytes === right.max_request_bytes &&
    left.max_response_bytes === right.max_response_bytes &&
    left.max_response_chunks === right.max_response_chunks &&
    left.max_total_bytes === right.max_total_bytes &&
    left.max_requests === right.max_requests;
}

function sameCurrentOpenRepository(left, right) {
  return left !== null && right !== null &&
    typeof left === "object" && typeof right === "object" &&
    left.owner === right.owner && left.name === right.name &&
    left.id === right.id && left.node_id === right.node_id;
}

function normalizeCurrentOpenFactoryEpoch(value) {
  if (typeof value !== "string" || !CURRENT_OPEN_FACTORY_EPOCH.test(value)) {
    throw new TypeError("current-open factory epoch is invalid");
  }
  return value;
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
      !safeSetHas(new SafeSet(["api.github.com", "github.example.test"]),
        url.hostname)) {
    throw new TypeError("candidate inventory REST base is unsupported");
  }
  url.pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  return url;
}

function normalizeGraphqlUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new TypeError("current-open GraphQL URL is invalid", { cause: error });
  }
  if (url.protocol !== "https:" || url.username !== "" ||
      url.password !== "" || url.port !== "" || url.search !== "" ||
      url.hash !== "" ||
      !safeSetHas(new SafeSet(["api.github.com", "github.example.test"]),
        url.hostname) ||
      !safeSetHas(new SafeSet(["/graphql", "/api/graphql"]), url.pathname)) {
    throw new TypeError("current-open GraphQL URL is unsupported");
  }
  return url;
}

function restBaseIdentity(value) {
  return value.href.replace(/\/$/u, "");
}

function normalizeHttpDate(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw inventoryError("CANDIDATE_HTTP_UNREADABLE", `${label} is missing or invalid`);
  }
  return new Date(Date.parse(value)).toISOString();
}

function normalizeGithubRequestId(value, label) {
  if (typeof value !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,255}$/u.test(value)) {
    throw new TypeError(`${label} must be one bounded request identifier`);
  }
  return value;
}

function assertUniqueCurrentOpenRequestId(value, requestIds, label) {
  if (!(requestIds instanceof Set)) {
    throw new TypeError(`${label} request identity set is missing`);
  }
  if (safeSetHas(requestIds, value)) {
    throw inventoryError(
      "CANDIDATE_HTTP_REPLAYED",
      "current-open GraphQL request identity was reused",
      { request_id: value },
    );
  }
  safeSetAdd(requestIds, value);
}

function normalizeUniqueDecimals(value, label) {
  if (!safeArrayIsArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  const normalized = value.map((entry, index) => decimal(entry, `${label}[${index}]`));
  if (safeSetSize(new SafeSet(normalized)) !== normalized.length ||
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

function graphqlDatabaseId(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be one positive GraphQL databaseId`);
  }
  return String(value);
}

function graphqlFullDatabaseId(value, label) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,18}$/u.test(value) ||
      BigInt(value) > 9_223_372_036_854_775_807n) {
    throw new TypeError(
      `${label} must be one canonical positive signed-64 GraphQL BigInt string`,
    );
  }
  return value;
}

function normalizeGraphqlCursor(value, label) {
  if (value === null) return null;
  return boundedString(value, label, 1024);
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
  if (!safeSetHas(allowed, value)) {
    throw new TypeError(`${label} is unsupported`);
  }
  return value;
}

function boundedString(value, label, limit) {
  if (typeof value !== "string" || value.length === 0 || value.length > limit) {
    throw new TypeError(`${label} must be a bounded non-empty string`);
  }
  return value;
}

function assertObject(value, label) {
  if (value === null || typeof value !== "object" || safeArrayIsArray(value) ||
      safeObjectGetPrototypeOf(value) !== objectPrototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

function exactKeys(value, keys, label) {
  const actual = reflectApply(safeObjectKeys, Object, [value]);
  reflectApply(arraySortIntrinsic, actual, []);
  const expected = [];
  for (let index = 0; index < keys.length; index += 1) {
    expected[index] = keys[index];
  }
  reflectApply(arraySortIntrinsic, expected, []);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new TypeError(`${label} has unexpected or missing fields`);
  }
}

function exactOwnDataKeys(value, keys, label) {
  assertObject(value, label);
  const actual = reflectApply(reflectOwnKeysIntrinsic, Reflect, [value]);
  if (actual.length !== keys.length) {
    throw new TypeError(`${label} has unexpected or missing own data fields`);
  }
  for (let index = 0; index < actual.length; index += 1) {
    const key = actual[index];
    let expected = false;
    if (typeof key === "string") {
      for (let expectedIndex = 0; expectedIndex < keys.length;
          expectedIndex += 1) {
        if (keys[expectedIndex] === key) {
          expected = true;
          break;
        }
      }
    }
    if (!expected) {
      throw new TypeError(`${label} has unexpected or missing own data fields`);
    }
    const descriptor = reflectApply(
      safeObjectGetOwnPropertyDescriptor,
      Object,
      [value, key],
    );
    if (descriptor === undefined || descriptor.enumerable !== true ||
        !reflectApply(safeObjectHasOwn, Object, [descriptor, "value"])) {
      throw new TypeError(`${label}.${key} must be enumerable own data`);
    }
  }
}

function assertExactDenseOwnDataArray(value, label) {
  if (!safeArrayIsArray(value) ||
      safeObjectGetPrototypeOf(value) !== arrayPrototype) {
    throw new TypeError(`${label} must be a plain array`);
  }
  assertDenseArray(value);
  const actual = reflectApply(reflectOwnKeysIntrinsic, Reflect, [value]);
  if (actual.length !== value.length + 1) {
    throw new TypeError(`${label} has unexpected own fields`);
  }
  for (let index = 0; index < actual.length; index += 1) {
    const key = actual[index];
    const descriptor = reflectApply(
      safeObjectGetOwnPropertyDescriptor,
      Object,
      [value, key],
    );
    if (descriptor === undefined ||
        !reflectApply(safeObjectHasOwn, Object, [descriptor, "value"])) {
      throw new TypeError(`${label} requires own data elements`);
    }
    if (key === "length") {
      if (descriptor.enumerable !== false) {
        throw new TypeError(`${label}.length descriptor is invalid`);
      }
      continue;
    }
    if (typeof key !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(key) ||
        Number(key) >= value.length || descriptor.enumerable !== true) {
      throw new TypeError(`${label} has unexpected own fields`);
    }
  }
}

function rawDigest(value) {
  const hash = createHash("sha256");
  reflectApply(hashUpdateIntrinsic, hash, [value]);
  return `sha256:${reflectApply(hashDigestIntrinsic, hash, ["hex"])}`;
}

function digestCanonical(domain, value) {
  return rawDigest(`${domain}\n${canonicalJson(value)}\n`);
}

function canonicalJson(value) {
  if (safeArrayIsArray(value)) {
    return `[${reflectApply(
      arrayJoinIntrinsic,
      safeArrayMap(value, canonicalJson),
      [","],
    )}]`;
  }
  if (value !== null && typeof value === "object") {
    const keys = reflectApply(safeObjectKeys, Object, [value]);
    reflectApply(arraySortIntrinsic, keys, []);
    const entries = safeArrayMap(keys, (key) =>
      `${reflectApply(jsonStringifyIntrinsic, JSON, [key])}:` +
      canonicalJson(value[key]));
    return `{${reflectApply(arrayJoinIntrinsic, entries, [","])}}`;
  }
  return reflectApply(jsonStringifyIntrinsic, JSON, [value]);
}

function monotonicNow() {
  return reflectApply(performanceNowIntrinsic, performance, []);
}

function settleFirst(left, right) {
  return new SafePromise((resolve, reject) => {
    const settle = (value) => reflectApply(
      promiseThenIntrinsic,
      reflectApply(promiseResolveIntrinsic, SafePromise, [value]),
      [resolve, reject],
    );
    settle(left);
    settle(right);
  });
}

function callExternalAdapter(call, label) {
  return new SafePromise((resolve, reject) => {
    let value;
    try {
      value = call();
    } catch (cause) {
      reject(inventoryError(
        "CANDIDATE_HTTP_UNREADABLE",
        `${label} failed`,
        null,
        cause,
      ));
      return;
    }
    const promise = reflectApply(promiseResolveIntrinsic, SafePromise, [value]);
    reflectApply(promiseThenIntrinsic, promise, [
      resolve,
      (cause) => reject(inventoryError(
        "CANDIDATE_HTTP_UNREADABLE",
        `${label} failed`,
        null,
        cause,
      )),
    ]);
  });
}

function callExternalAdapterSync(call, label) {
  try {
    return call();
  } catch (cause) {
    throw inventoryError(
      "CANDIDATE_HTTP_UNREADABLE",
      `${label} failed`,
      null,
      cause,
    );
  }
}

function inspectExternalResponse(value, label) {
  if (value === null || typeof value !== "object") {
    return {
      status: null,
      headers: null,
      body: null,
      get_header: null,
      get_reader: null,
    };
  }
  return callExternalAdapterSync(() => {
    const headers = value.headers;
    const body = value.body;
    return {
      status: value.status,
      headers,
      body,
      get_header: headers === null || headers === undefined
        ? null
        : headers.get,
      get_reader: body === null || body === undefined
        ? null
        : body.getReader,
    };
  }, `${label} response`);
}

function readExternalHeader(responseView, name, label) {
  return callExternalAdapterSync(
    () => reflectApply(
      responseView.get_header,
      responseView.headers,
      [name],
    ),
    `${label} ${name} header`,
  );
}

function inspectExternalReadResult(value, label) {
  if (value === null || typeof value !== "object") {
    return {
      done: null,
      done_value_valid: false,
      value: undefined,
      is_bytes: false,
      byte_length: null,
    };
  }
  return callExternalAdapterSync(() => {
    const done = value.done;
    if (typeof done !== "boolean") {
      return {
        done,
        done_value_valid: false,
        value: undefined,
        is_bytes: false,
        byte_length: null,
      };
    }
    const chunk = value.value;
    if (done) {
      return {
        done,
        done_value_valid: chunk === undefined,
        value: undefined,
        is_bytes: false,
        byte_length: 0,
      };
    }
    const isBytes = reflectApply(
      isUint8ArrayIntrinsic,
      utilTypes,
      [chunk],
    );
    if (!isBytes) {
      return {
        done,
        done_value_valid: false,
        value: chunk,
        is_bytes: false,
        byte_length: null,
      };
    }
    const backing = reflectApply(typedArrayBufferGetter, chunk, []);
    const isOrdinaryArrayBuffer = reflectApply(
      isArrayBufferIntrinsic,
      utilTypes,
      [backing],
    );
    const detached = arrayBufferDetachedGetter === null
      ? false
      : reflectApply(arrayBufferDetachedGetter, backing, []);
    const resizable = arrayBufferResizableGetter === null
      ? false
      : reflectApply(arrayBufferResizableGetter, backing, []);
    if (!isOrdinaryArrayBuffer || detached || resizable) {
      throw new TypeError(
        "body chunks require fixed ordinary ArrayBuffer backing",
      );
    }
    const byteLength = reflectApply(typedArrayByteLengthGetter, chunk, []);
    return {
      done,
      done_value_valid: false,
      value: chunk,
      is_bytes: true,
      byte_length: byteLength,
    };
  }, `${label} body read result`);
}

function snapshotExternalBodyChunk(value, expectedByteLength, label) {
  return callExternalAdapterSync(() => {
    const isBytes = reflectApply(
      isUint8ArrayIntrinsic,
      utilTypes,
      [value],
    );
    if (!isBytes) {
      throw new TypeError("body chunk identity changed before snapshot");
    }
    const backing = reflectApply(typedArrayBufferGetter, value, []);
    const isOrdinaryArrayBuffer = reflectApply(
      isArrayBufferIntrinsic,
      utilTypes,
      [backing],
    );
    const detached = arrayBufferDetachedGetter === null
      ? false
      : reflectApply(arrayBufferDetachedGetter, backing, []);
    const resizable = arrayBufferResizableGetter === null
      ? false
      : reflectApply(arrayBufferResizableGetter, backing, []);
    const byteLength = reflectApply(typedArrayByteLengthGetter, value, []);
    if (
      !isOrdinaryArrayBuffer || detached || resizable ||
      byteLength !== expectedByteLength
    ) {
      throw new TypeError("body chunk changed before snapshot");
    }
    const snapshot = new Uint8Array(expectedByteLength);
    reflectApply(uint8ArraySetIntrinsic, snapshot, [value, 0]);
    return snapshot;
  }, `${label} body chunk snapshot`);
}

function safeArrayMap(value, callback) {
  assertDenseArray(value);
  return reflectApply(arrayMapIntrinsic, value, [callback]);
}

function appendDenseArray(target, value) {
  assertDenseArray(value);
  for (let index = 0; index < value.length; index += 1) {
    target[target.length] = value[index];
  }
}

function assertDenseArray(value) {
  for (let index = 0; index < value.length; index += 1) {
    if (!reflectApply(safeObjectHasOwn, Object, [value, index])) {
      throw new TypeError("array input must be dense");
    }
  }
}

function safeSetAdd(set, value) {
  return reflectApply(setAddIntrinsic, set, [value]);
}

function safeSetHas(set, value) {
  return reflectApply(setHasIntrinsic, set, [value]);
}

function safeSetSize(set) {
  return reflectApply(setSizeIntrinsic, set, []);
}

function safeWeakMapGet(map, key) {
  return reflectApply(weakMapGetIntrinsic, map, [key]);
}

function safeWeakMapSet(map, key, value) {
  return reflectApply(weakMapSetIntrinsic, map, [key, value]);
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" &&
      !safeObjectIsFrozen(value)) {
    safeObjectFreeze(value);
    const children = safeObjectValues(value);
    for (let index = 0; index < children.length; index += 1) {
      deepFreeze(children[index]);
    }
  }
  return value;
}

function inventoryError(code, message, details = null, cause = undefined) {
  const error = new V2CandidateInventoryError(code, message, details, cause);
  reflectApply(weakSetAddIntrinsic, INTERNAL_INVENTORY_ERRORS, [error]);
  return error;
}

function isInventoryError(value) {
  return value instanceof V2CandidateInventoryError &&
    reflectApply(weakSetHasIntrinsic, INTERNAL_INVENTORY_ERRORS, [value]);
}
