import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setImmediate as scheduleImmediateBinding } from "node:timers";
import { isDeepStrictEqual, TextDecoder } from "node:util";

const safeSetImmediate = scheduleImmediateBinding;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype);
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "buffer",
).get;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
).get;
const TYPED_ARRAY_BYTE_OFFSET_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteOffset",
).get;

export const V2_GITHUB_SNAPSHOT_SCHEMA_VERSION = 2;

export const V2_TRANSPORT_DEFAULT_LIMITS = Object.freeze({
  max_pages: 1_000,
  page_size: 100,
  max_items: 20_000,
  max_response_bytes: 8 * 1024 * 1024,
  max_total_response_bytes: 64 * 1024 * 1024,
  max_requests: 2_048,
  max_artifact_selectors: 256,
  request_timeout_ms: 30_000,
});

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DECIMAL_ID_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const HTTP_DATE_PATTERN =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), [0-9]{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$/;
const MERGEABLE_VALUES = new Set(["CONFLICTING", "MERGEABLE", "UNKNOWN"]);
const PULL_REQUEST_STATES = new Set(["OPEN", "CLOSED", "MERGED"]);
const REVIEW_STATES = new Set([
  "APPROVED",
  "CHANGES_REQUESTED",
  "COMMENTED",
  "DISMISSED",
  "PENDING",
]);
const DIFF_SIDES = new Set(["LEFT", "RIGHT"]);
const SERVICE_START_APP_SLUG = "chatgpt-codex-connector";
const MAX_V2_TRANSPORT_RESPONSE_CHUNKS = 4_096;
const CHECK_RUN_STATUSES = new Set([
  "queued",
  "in_progress",
  "completed",
  "waiting",
  "requested",
  "pending",
]);
const CHECK_RUN_CONCLUSIONS = new Set([
  "action_required",
  "cancelled",
  "failure",
  "neutral",
  "success",
  "skipped",
  "stale",
  "timed_out",
]);
const PROVIDER_PRE_SCOPE_BINDINGS = new WeakMap();
const TRANSPORT_SNAPSHOT_BINDINGS = new WeakMap();

export const V2_SCOPE_QUERY = `
  query CodexReviewGateV2Scope($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      id
      name
      owner { login }
      pullRequest(number: $number) {
        id
        number
        state
        merged
        mergedAt
        isDraft
        mergeable
        baseRefName
        baseRef {
          name
          target { ... on Commit { oid } }
        }
        headRefName
        headRefOid
        headRef {
          name
          target { ... on Commit { oid } }
        }
        potentialMergeCommit {
          oid
          tree { oid }
          parents(first: 3) {
            totalCount
            pageInfo { hasNextPage endCursor }
            nodes { oid }
          }
        }
      }
    }
  }
`;

export const V2_REVIEW_THREADS_QUERY = `
  query CodexReviewGateV2ReviewThreads(
    $owner: String!
    $repo: String!
    $number: Int!
    $after: String
    $pageSize: Int!
  ) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: $pageSize, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            isResolved
            isOutdated
            path
            line
            startLine
            diffSide
            startDiffSide
            comments(first: $pageSize) {
              pageInfo { hasNextPage endCursor }
              nodes { id fullDatabaseId }
            }
          }
        }
      }
    }
  }
`;

export const V2_REVIEW_THREAD_COMMENTS_QUERY = `
  query CodexReviewGateV2ReviewThreadComments(
    $threadId: ID!
    $after: String
    $pageSize: Int!
  ) {
    node(id: $threadId) {
      ... on PullRequestReviewThread {
        id
        isResolved
        isOutdated
        path
        line
        startLine
        diffSide
        startDiffSide
        comments(first: $pageSize, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { id fullDatabaseId }
        }
      }
    }
  }
`;

export const V2_REVIEW_REACTIONS_QUERY = `
  query CodexReviewGateV2ReviewReactions(
    $reviewId: ID!
    $after: String
    $pageSize: Int!
  ) {
    node(id: $reviewId) {
      ... on PullRequestReview {
        id
        fullDatabaseId
        reactions(
          first: $pageSize
          after: $after
          orderBy: { field: CREATED_AT, direction: ASC }
        ) {
          totalCount
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            databaseId
            content
            createdAt
            user { id databaseId login }
          }
        }
      }
    }
  }
`;

export class V2TransportError extends Error {
  constructor(code, message, details = null, options = undefined) {
    super(message, options);
    this.name = "V2TransportError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Same-realm fetch adapters and their AbortSignal listeners are trusted code:
 * they must be nonthrowing, avoid synchronous blocking, and cooperate with
 * cancellation. A same-thread deadline cannot preempt synchronous adapter code.
 * Remote-derived response metadata, body chunks, and reader results are instead
 * validated as untrusted input. Direct cancel/release cleanup throws are ignored.
 */
export function createV2GitHubTransport(options = {}) {
  assertClosedObject(options, "transport options", [
    "fetch",
    "token",
    "restBaseUrl",
    "restUrl",
    "graphqlUrl",
    "limits",
    "userAgent",
  ], { optional: true });

  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new TypeError("transport options.fetch must be a function");
  }
  if (options.restBaseUrl !== undefined && options.restUrl !== undefined) {
    throw new TypeError("transport options may set restBaseUrl or restUrl, not both");
  }
  const restBaseUrl = normalizeServiceUrl(
    options.restBaseUrl ?? options.restUrl ?? "https://api.github.com",
    "REST base URL",
  );
  const graphqlUrl = normalizeServiceUrl(
    options.graphqlUrl ?? defaultGraphqlUrl(restBaseUrl),
    "GraphQL URL",
    { allowPath: true },
  );
  const token = options.token;
  if (token !== undefined && (typeof token !== "string" || token.length === 0)) {
    throw new TypeError("transport options.token must be a non-empty string");
  }
  const userAgent = options.userAgent ?? "codex-review-gate-v2";
  if (typeof userAgent !== "string" || userAgent.length === 0 || userAgent.length > 200) {
    throw new TypeError("transport options.userAgent must be a non-empty short string");
  }
  const limits = normalizeLimits(options.limits);

  return Object.freeze({
    async loadSnapshot(input) {
      const snapshot = await loadSnapshot({
        input,
        fetchImpl,
        token,
        restBaseUrl,
        graphqlUrl,
        userAgent,
        limits,
      });
      TRANSPORT_SNAPSHOT_BINDINGS.set(
        snapshot,
        deepFreeze({
          ...transportSnapshotAuthorityBinding(snapshot),
          effective_limits: structuredClone(limits),
        }),
      );
      return snapshot;
    },
  });
}

export async function loadV2GitHubSnapshot(options) {
  assertPlainObject(options, "loadV2GitHubSnapshot options");
  const transportKeys = new Set([
    "fetch",
    "token",
    "restBaseUrl",
    "restUrl",
    "graphqlUrl",
    "limits",
    "userAgent",
  ]);
  const transportOptions = {};
  const input = {};
  for (const [key, value] of Object.entries(options)) {
    if (transportKeys.has(key)) {
      transportOptions[key] = value;
    } else {
      input[key] = value;
    }
  }
  return createV2GitHubTransport(transportOptions).loadSnapshot(input);
}

/**
 * Load one native provider artifact before the complete evidence snapshot.
 *
 * This deliberately performs exactly one REST GET. The caller supplies the
 * complete expected provider identities because the public Codex identity
 * strings alone do not bind one GitHub actor or App object.
 * Its injected fetch adapter follows createV2GitHubTransport's trust contract.
 */
export async function loadV2ProviderPreScopeArtifact(options) {
  assertClosedObject(options, "provider pre-scope options", [
    "fetch",
    "token",
    "restBaseUrl",
    "restUrl",
    "limits",
    "userAgent",
    "owner",
    "repo",
    "pullNumber",
    "headSha",
    "selector",
    "expectedActor",
    "expectedApp",
  ], { optional: true });
  if (options.restBaseUrl !== undefined && options.restUrl !== undefined) {
    throw new TypeError(
      "provider pre-scope options may set restBaseUrl or restUrl, not both",
    );
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new TypeError("provider pre-scope options.fetch must be a function");
  }
  const token = options.token;
  if (token !== undefined && (typeof token !== "string" || token.length === 0)) {
    throw new TypeError("provider pre-scope options.token must be a non-empty string");
  }
  const userAgent = options.userAgent ?? "codex-review-gate-v2";
  if (typeof userAgent !== "string" || userAgent.length === 0 || userAgent.length > 200) {
    throw new TypeError(
      "provider pre-scope options.userAgent must be a non-empty short string",
    );
  }
  const request = normalizeSnapshotRequest({
    owner: options.owner,
    repo: options.repo,
    pullNumber: options.pullNumber,
    artifactSelectors: [options.selector],
    permissionSubjects: [],
  });
  const headSha = requireSha(options.headSha, "provider pre-scope headSha");
  const expectedActor = normalizeExpectedProviderActor(options.expectedActor);
  const expectedApp = normalizeExpectedProviderApp(options.expectedApp);
  const restBaseUrl = normalizeServiceUrl(
    options.restBaseUrl ?? options.restUrl ?? "https://api.github.com",
    "provider pre-scope REST base URL",
  );
  const limits = normalizeLimits(options.limits);

  try {
    const work = new TransportWork({
      fetchImpl,
      token,
      restBaseUrl,
      graphqlUrl: defaultGraphqlUrl(restBaseUrl),
      userAgent,
      limits,
    });
    const entry = await work.loadProviderPreScopeArtifact({
      request,
      headSha,
      selector: request.artifactSelectors[0],
      expectedActor,
      expectedApp,
    });
    assertExactArtifactEntry(entry, "provider pre-scope artifact");
    const frozenEntry = deepFreeze(entry);
    PROVIDER_PRE_SCOPE_BINDINGS.set(frozenEntry, deepFreeze({
      owner: request.owner,
      repo: request.repo,
      pull_number: request.pullNumber,
      head_sha: headSha,
      expected_actor: expectedActor,
      expected_app: expectedApp,
    }));
    return frozenEntry;
  } catch (error) {
    if (error instanceof V2TransportError) {
      throw error;
    }
    if (error instanceof TypeError) {
      throw transportFailure(
        "INVALID_RESPONSE_SCHEMA",
        `GitHub provider artifact did not satisfy the v2 transport schema: ${error.message}`,
        null,
        error,
      );
    }
    throw error;
  }
}

async function loadSnapshot({
  input,
  fetchImpl,
  token,
  restBaseUrl,
  graphqlUrl,
  userAgent,
  limits,
}) {
  const request = normalizeSnapshotRequest(input);
  if (request.artifactSelectors.length > limits.max_artifact_selectors) {
    throw new TypeError(
      `snapshot request contains ${request.artifactSelectors.length} artifact selectors, ` +
        `exceeding ${limits.max_artifact_selectors}`,
    );
  }
  if (request.permissionSubjects.length > limits.max_artifact_selectors) {
    throw new TypeError(
      `snapshot request contains ${request.permissionSubjects.length} permission subjects, ` +
        `exceeding ${limits.max_artifact_selectors}`,
    );
  }
  try {
    const work = new TransportWork({
      fetchImpl,
      token,
      restBaseUrl,
      graphqlUrl,
      userAgent,
      limits,
    });

    const pre = await work.loadScope(request, "pre");
    const canonicalRequest = {
      ...request,
      owner: pre.repository_owner,
      repo: pre.repository_name,
    };
    const serviceStartPre = await work.loadServiceStartObservations(
      canonicalRequest,
      pre.head_ref_oid,
      "pre",
    );
    const pages = await work.loadEvidence(canonicalRequest);
    const permissionPre = await work.loadPermissions(
      canonicalRequest,
      pages.pages,
      "pre",
    );
    const post = await work.loadScope(canonicalRequest, "post");
    const permissionPost = await work.loadPermissions(
      canonicalRequest,
      pages.pages,
      "post",
    );
    const serviceStartPost = await work.loadServiceStartObservations(
      canonicalRequest,
      post.head_ref_oid,
      "post",
    );
    const permissions = reconcilePermissionReceipts(permissionPre, permissionPost);

    const preStable = scopeStabilityProjection(pre);
    const postStable = scopeStabilityProjection(post);
    if (!isDeepStrictEqual(preStable, postStable)) {
      throw transportFailure(
        "SCOPE_UNSTABLE",
        "Pull request scope changed while the complete evidence snapshot was loading",
        { pre: preStable, post: postStable },
      );
    }
    if (Date.parse(post.server_time) < Date.parse(pre.server_time)) {
      throw transportFailure(
        "SERVER_TIME_REGRESSED",
        "GitHub server Date moved backwards across the scope receipts",
        { pre: pre.server_time, post: post.server_time },
      );
    }
    const serviceStartStable = isDeepStrictEqual(
      serviceStartStabilityProjection(serviceStartPre),
      serviceStartStabilityProjection(serviceStartPost),
    );
    const serviceStartObservations = {
      provider_app_slug: SERVICE_START_APP_SLUG,
      head_sha: post.head_ref_oid,
      pre: serviceStartPre,
      post: serviceStartPost,
      stable: serviceStartStable,
    };

    const snapshot = {
      schema_version: V2_GITHUB_SNAPSHOT_SCHEMA_VERSION,
      repository: {
        owner: post.repository_owner,
        name: post.repository_name,
        node_id: post.repository_node_id,
      },
      pull_request: {
        number: post.pull_request_number,
        node_id: post.pull_request_node_id,
        state: post.pull_request_state,
        merged: post.pull_request_merged,
        merged_at: post.pull_request_merged_at,
        is_draft: post.pull_request_is_draft,
      },
      server_time: latestServerTime([
        post.server_time,
        permissionPost.transport_capability.response_server_time,
        ...permissionPost.actor_permissions.map((receipt) => receipt.response_server_time),
        serviceStartPost.server_time,
      ]),
      scope: scopeFromReceipt(post),
      pages: pages.pages,
      permissions,
      service_start_observations: serviceStartObservations,
      scope_receipts: { pre, post },
      completeness: {
        all_pages_loaded: true,
        issue_comments: true,
        reviews: true,
        inline_comments: true,
        threads: true,
        reactions: true,
        permissions: true,
        exact_artifacts: true,
        service_start_observations: true,
        request_count: work.requestCount,
        item_count: work.itemCount,
        response_bytes: work.responseBytes,
        server_date_headers: work.serverDateCount,
      },
      stability: {
        scope_stable: true,
        service_start_observations_stable: serviceStartStable,
        server_time_monotonic: true,
      },
    };
    assertV2Snapshot(snapshot);
    return deepFreeze(snapshot);
  } catch (error) {
    if (error instanceof V2TransportError) {
      throw error;
    }
    if (error instanceof TypeError) {
      throw transportFailure(
        "INVALID_RESPONSE_SCHEMA",
        `GitHub response did not satisfy the v2 transport schema: ${error.message}`,
        null,
        error,
      );
    }
    throw error;
  }
}

class TransportWork {
  constructor({
    fetchImpl,
    token,
    restBaseUrl,
    graphqlUrl,
    userAgent,
    limits,
  }) {
    this.fetchImpl = fetchImpl;
    this.token = token;
    this.restBaseUrl = restBaseUrl;
    this.graphqlUrl = graphqlUrl;
    this.userAgent = userAgent;
    this.limits = limits;
    this.requestCount = 0;
    this.itemCount = 0;
    this.responseBytes = 0;
    this.serverDateCount = 0;
    this.lastServerTime = null;
  }

  async loadScope(request, phase) {
    const requestedRepoPath = repositoryPath(request.owner, request.repo);
    const pullRequestPath = `${requestedRepoPath}/pulls/${request.pullNumber}`;
    const mergeRefresh = await this.rest(
      "GET",
      pullRequestPath,
      undefined,
      `${phase} pull-request merge-candidate refresh`,
    );
    const refreshIdentity = normalizeMergeRefreshResponse(
      mergeRefresh.data,
      request,
      requestedRepoPath,
      this.restBaseUrl,
      `${phase} pull-request merge-candidate refresh`,
    );
    const graphql = await this.graphql(V2_SCOPE_QUERY, {
      owner: request.owner,
      repo: request.repo,
      number: request.pullNumber,
    }, `${phase} pull-request scope`);
    const graphScope = normalizeGraphScope(
      graphql.data,
      request,
      `${phase} GraphQL scope`,
    );
    const canonicalPath = repositoryPath(
      graphScope.repository_owner,
      graphScope.repository_name,
    );
    if (
      refreshIdentity.pull_request_node_id !== graphScope.pull_request_node_id ||
      refreshIdentity.pull_request_state !== graphScope.pull_request_state ||
      refreshIdentity.pull_request_merged !== graphScope.pull_request_merged ||
      refreshIdentity.pull_request_merged_at !== graphScope.pull_request_merged_at
    ) {
      throw transportFailure(
        "PULL_REQUEST_IDENTITY_MISMATCH",
        `${phase} REST merge-candidate refresh and GraphQL scope did not identify the ` +
          "same pull-request lifecycle",
      );
    }

    let mergeBaseSha = null;
    let compare = null;
    let comparePath = null;
    if (graphScope.base_ref_tip !== null && graphScope.head_ref_oid !== null) {
      comparePath =
        `${canonicalPath}/compare/${graphScope.base_ref_tip}...${graphScope.head_ref_oid}`;
      compare = await this.rest(
        "GET",
        comparePath,
        undefined,
        `${phase} live-base comparison`,
      );
      mergeBaseSha = normalizeCompareResponse(
        compare.data,
        graphScope.base_ref_tip,
        `${phase} REST comparison`,
      );
    }

    const mergeRefPath = `${canonicalPath}/git/ref/pull/${request.pullNumber}/merge`;
    const mergeRef = await this.rest(
      "GET",
      mergeRefPath,
      undefined,
      `${phase} refs/pull/${request.pullNumber}/merge`,
      { allowNotFound: true },
    );
    const mergeRefOid = mergeRef.data === null
      ? null
      : normalizeMergeRefResponse(
        mergeRef.data,
        request.pullNumber,
        mergeRefPath,
        this.restBaseUrl,
        `${phase} merge ref`,
      );

    return {
      repository_owner: graphScope.repository_owner,
      repository_name: graphScope.repository_name,
      repository_node_id: graphScope.repository_node_id,
      pull_request_number: graphScope.pull_request_number,
      pull_request_node_id: graphScope.pull_request_node_id,
      pull_request_state: graphScope.pull_request_state,
      pull_request_merged: graphScope.pull_request_merged,
      pull_request_merged_at: graphScope.pull_request_merged_at,
      pull_request_is_draft: graphScope.pull_request_is_draft,
      base_ref_name: graphScope.base_ref_name,
      base_ref_tip: graphScope.base_ref_tip,
      head_ref_name: graphScope.head_ref_name,
      head_ref_oid: graphScope.head_ref_oid,
      merge_base_sha: mergeBaseSha,
      potential_merge_oid: graphScope.potential_merge_oid,
      potential_merge_tree: graphScope.potential_merge_tree,
      ordered_parent_oids: graphScope.ordered_parent_oids,
      merge_ref_oid: mergeRefOid,
      mergeable: graphScope.mergeable,
      endpoint_receipts: {
        pull_request: scopeEndpointReceipt("GET", pullRequestPath, mergeRefresh),
        graphql: scopeEndpointReceipt(
          "POST",
          new URL(this.graphqlUrl).pathname,
          graphql,
        ),
        compare: compare === null
          ? null
          : scopeEndpointReceipt("GET", comparePath, compare),
        merge_ref: scopeEndpointReceipt("GET", mergeRefPath, mergeRef),
      },
      server_time: latestServerTime([
        mergeRefresh.serverTime,
        graphql.serverTime,
        compare?.serverTime,
        mergeRef.serverTime,
      ]),
    };
  }

  async loadServiceStartObservations(request, headSha, phase) {
    const repoPath = repositoryPath(request.owner, request.repo);
    const path = `${repoPath}/commits/${headSha}/check-runs`;
    const matchingRuns = [];
    const pageReceipts = [];
    const allRunIds = new Set();
    let totalCheckRuns = null;
    let loadedCheckRuns = 0;
    let lastServerTime = null;
    let expectedLastPage = null;

    for (let page = 1; page <= this.limits.max_pages; page += 1) {
      const response = await this.rest(
        "GET",
        path,
        {
          filter: "all",
          per_page: this.limits.page_size,
          page,
        },
        `${phase} current-head check runs page ${page}`,
      );
      if (response.status !== 200) {
        throw transportFailure(
          "HTTP_ERROR",
          `${phase} current-head check runs page ${page} returned HTTP ${response.status}`,
        );
      }
      assertPlainObject(response.data, `${phase} current-head check runs page ${page}`);
      const pageTotal = requireNonNegativeSafeInteger(
        response.data.total_count,
        `${phase} current-head check runs page ${page}.total_count`,
      );
      if (totalCheckRuns === null) {
        totalCheckRuns = pageTotal;
      } else if (pageTotal !== totalCheckRuns) {
        throw transportFailure(
          "CHECK_RUN_PAGINATION_DRIFT",
          `${phase} current-head check-run total_count changed during pagination`,
          { expected: totalCheckRuns, actual: pageTotal, page },
        );
      }
      if (!Array.isArray(response.data.check_runs)) {
        throw transportFailure(
          "INVALID_RESPONSE_SCHEMA",
          `${phase} current-head check runs page ${page}.check_runs must be an array`,
        );
      }
      if (response.data.check_runs.length > this.limits.page_size) {
        throw transportFailure(
          "INVALID_RESPONSE_SCHEMA",
          `${phase} current-head check runs page ${page} exceeded ` +
            `per_page=${this.limits.page_size}`,
        );
      }
      this.consumeItems(
        response.data.check_runs.length,
        `${phase} current-head check-run discovery`,
      );
      for (const [index, value] of response.data.check_runs.entries()) {
        const discovery = normalizeCheckRunDiscovery(
          value,
          headSha,
          `${phase} current-head check runs page ${page} item ${index}`,
        );
        if (allRunIds.has(discovery.id)) {
          throw transportFailure(
            "DUPLICATE_ITEM",
            `${phase} current-head check-run pagination repeated id ${discovery.id}`,
          );
        }
        allRunIds.add(discovery.id);
        if (discovery.app_slug === SERVICE_START_APP_SLUG) {
          matchingRuns.push(normalizeServiceStartCheckRun(
            value,
            headSha,
            repoPath,
            this.restBaseUrl,
            `${phase} current-head check runs page ${page} item ${index}`,
          ));
        }
      }
      loadedCheckRuns += response.data.check_runs.length;
      lastServerTime = response.serverTime;
      pageReceipts.push({
        page,
        item_count: response.data.check_runs.length,
        total_count: totalCheckRuns,
        response_server_time: response.serverTime,
        raw_body_sha256: response.bodySha256,
      });
      if (loadedCheckRuns > totalCheckRuns) {
        throw transportFailure(
          "INVALID_RESPONSE_SCHEMA",
          `${phase} current-head check-run pages exceeded total_count=${totalCheckRuns}`,
        );
      }
      const pagination = parseAndValidatePaginationLink(
        response.headers.get("link"),
        this.restBaseUrl,
        path,
        page,
        this.limits.page_size,
        this.limits.max_pages,
        `${phase} current-head check runs`,
        { filter: "all" },
      );
      if (pagination.lastPage !== null) {
        if (
          expectedLastPage !== null &&
          pagination.lastPage !== expectedLastPage
        ) {
          throw transportFailure(
            "INCOMPLETE_PAGINATION",
            `${phase} current-head check-run pagination changed its promised last page ` +
              `from ${expectedLastPage} to ${pagination.lastPage}`,
          );
        }
        expectedLastPage = pagination.lastPage;
      }
      if (
        expectedLastPage !== null &&
        (
          page > expectedLastPage ||
          (page < expectedLastPage && pagination.nextPage !== page + 1) ||
          (page === expectedLastPage && pagination.nextPage !== null)
        )
      ) {
        throw transportFailure(
          "INCOMPLETE_PAGINATION",
          `${phase} current-head check-run page ${page} violated its promised last page ` +
            `${expectedLastPage}`,
        );
      }
      if (loadedCheckRuns === totalCheckRuns) {
        if (pagination.nextPage !== null) {
          throw transportFailure(
            "INVALID_PAGINATION_LINK",
            `${phase} current-head check-run page ${page} advertised another page after ` +
              "total_count was satisfied",
          );
        }
        if (expectedLastPage !== null && page !== expectedLastPage) {
          throw transportFailure(
            "INCOMPLETE_PAGINATION",
            `${phase} current-head check-run total_count was satisfied on page ${page} ` +
              `before promised last page ${expectedLastPage}`,
          );
        }
        matchingRuns.sort(compareDecimalIdObjects);
        const matchingAppIds = [...new Set(matchingRuns.map((run) => run.app.id))]
          .sort(compareDecimalIds);
        return {
          server_time: lastServerTime,
          page_count: page,
          total_check_runs: totalCheckRuns,
          matching_app_ids: matchingAppIds,
          check_runs: matchingRuns,
          page_receipts: pageReceipts,
        };
      }
      if (response.data.check_runs.length < this.limits.page_size) {
        throw transportFailure(
          "INCOMPLETE_PAGINATION",
          `${phase} current-head check-run page ${page} ended before ` +
            `total_count=${totalCheckRuns} was satisfied`,
        );
      }
      if (pagination.nextPage !== page + 1) {
        throw transportFailure(
          "INCOMPLETE_PAGINATION",
          `${phase} current-head check-run page ${page} did not link the next page ` +
            `before total_count=${totalCheckRuns} was satisfied`,
        );
      }
    }
    throw transportFailure(
      "PAGE_LIMIT_EXCEEDED",
      `${phase} current-head check-run pagination exceeded ${this.limits.max_pages} pages`,
    );
  }

  async loadEvidence(request) {
    const repoPath = repositoryPath(request.owner, request.repo);
    const prPath = `${repoPath}/pulls/${request.pullNumber}`;
    const issuePath = `${repoPath}/issues/${request.pullNumber}`;

    const issueComments = await this.paginateRest(
      `${issuePath}/comments`,
      "issue comments",
      (value, index) => normalizeIssueComment(
        value,
        `${issuePath}/comments page item ${index}`,
        {
          restBaseUrl: this.restBaseUrl,
          repoPath,
          issuePath,
          owner: request.owner,
          repo: request.repo,
          pullNumber: request.pullNumber,
        },
      ),
    );
    const reviews = await this.paginateRest(
      `${prPath}/reviews`,
      "pull-request reviews",
      (value, index) => normalizeReview(
        value,
        `${prPath}/reviews page item ${index}`,
        {
          restBaseUrl: this.restBaseUrl,
          repoPath,
          prPath,
          owner: request.owner,
          repo: request.repo,
          pullNumber: request.pullNumber,
        },
      ),
    );
    const inlineComments = await this.paginateRest(
      `${prPath}/comments`,
      "inline review comments",
      (value, index) => normalizeInlineComment(
        value,
        `${prPath}/comments page item ${index}`,
        {
          restBaseUrl: this.restBaseUrl,
          repoPath,
          prPath,
          owner: request.owner,
          repo: request.repo,
          pullNumber: request.pullNumber,
        },
      ),
    );
    const threads = await this.loadReviewThreads(request);
    validateThreadCommentClosure(threads, inlineComments);

    const issueReactions = await this.paginateRest(
      `${issuePath}/reactions`,
      "pull-request issue reactions",
      (value, index) => normalizeReaction(
        value,
        `${issuePath}/reactions page item ${index}`,
      ),
    );
    const issueCommentReactions = [];
    for (const comment of issueComments) {
      issueCommentReactions.push({
        subject_id: comment.id,
        reactions: await this.paginateRest(
          `${repoPath}/issues/comments/${comment.id}/reactions`,
          `issue-comment ${comment.id} reactions`,
          (value, index) => normalizeReaction(
            value,
            `issue-comment ${comment.id} reaction ${index}`,
          ),
        ),
      });
    }
    const inlineCommentReactions = [];
    for (const comment of inlineComments) {
      inlineCommentReactions.push({
        subject_id: comment.id,
        reactions: await this.paginateRest(
          `${repoPath}/pulls/comments/${comment.id}/reactions`,
          `inline-comment ${comment.id} reactions`,
          (value, index) => normalizeReaction(
            value,
            `inline-comment ${comment.id} reaction ${index}`,
          ),
        ),
      });
    }
    const reviewReactions = await this.loadReviewReactions(reviews);

    const exactArtifacts = await this.loadExactArtifacts({
      request,
      repoPath,
      prPath,
      issuePath,
      issueComments,
      reviews,
      inlineComments,
    });

    return {
      pages: {
        issue_comments: issueComments,
        reviews,
        inline_comments: inlineComments,
        threads,
        reactions: {
          issue: issueReactions,
          issue_comments: issueCommentReactions,
          reviews: reviewReactions,
          inline_comments: inlineCommentReactions,
        },
        exact_artifacts: exactArtifacts,
      },
    };
  }

  async loadProviderPreScopeArtifact({
    request,
    headSha,
    selector,
    expectedActor,
    expectedApp,
  }) {
    const repoPath = repositoryPath(request.owner, request.repo);
    const prPath = `${repoPath}/pulls/${request.pullNumber}`;
    const issuePath = `${repoPath}/issues/${request.pullNumber}`;
    let path;
    let normalize;
    if (selector.kind === "issue_comment") {
      path = `${repoPath}/issues/comments/${selector.id}`;
      normalize = (value) => normalizeIssueComment(
        value,
        `provider pre-scope issue comment ${selector.id}`,
        {
          restBaseUrl: this.restBaseUrl,
          repoPath,
          issuePath,
          owner: request.owner,
          repo: request.repo,
          pullNumber: request.pullNumber,
        },
      );
    } else if (selector.kind === "pull_request_review") {
      path = `${prPath}/reviews/${selector.id}`;
      normalize = (value) => normalizeReview(
        value,
        `provider pre-scope review ${selector.id}`,
        {
          restBaseUrl: this.restBaseUrl,
          repoPath,
          prPath,
          owner: request.owner,
          repo: request.repo,
          pullNumber: request.pullNumber,
        },
      );
    } else {
      path = `${repoPath}/pulls/comments/${selector.id}`;
      normalize = (value) => normalizeInlineComment(
        value,
        `provider pre-scope inline comment ${selector.id}`,
        {
          restBaseUrl: this.restBaseUrl,
          repoPath,
          prPath,
          owner: request.owner,
          repo: request.repo,
          pullNumber: request.pullNumber,
        },
      );
    }
    const response = await this.rest(
      "GET",
      path,
      undefined,
      `provider pre-scope ${selector.kind} ${selector.id}`,
    );
    const artifact = normalize(response.data);
    if (artifact.id !== selector.id) {
      throw transportFailure(
        "ARTIFACT_ID_MISMATCH",
        `Provider pre-scope ${selector.kind} GET returned id ${artifact.id} ` +
          `instead of ${selector.id}`,
      );
    }
    if (
      artifact.commit_id !== undefined && artifact.commit_id !== null &&
      artifact.commit_id !== headSha
    ) {
      throw transportFailure(
        "PROVIDER_ARTIFACT_HEAD_MISMATCH",
        `Provider pre-scope ${selector.kind} ${selector.id} is not bound to head ${headSha}`,
        { expected: headSha, actual: artifact.commit_id },
      );
    }
    if (artifact.author === null) {
      throw transportFailure(
        "PROVIDER_ARTIFACT_ACTOR_MISSING",
        `Provider pre-scope ${selector.kind} ${selector.id} has no actor identity`,
      );
    }
    if (!isDeepStrictEqual(artifact.author, expectedActor)) {
      throw transportFailure(
        "PROVIDER_ARTIFACT_ACTOR_MISMATCH",
        `Provider pre-scope ${selector.kind} ${selector.id} has the wrong actor identity`,
      );
    }
    if (artifact.app === null) {
      throw transportFailure(
        "PROVIDER_ARTIFACT_APP_MISSING",
        `Provider pre-scope ${selector.kind} ${selector.id} has no App identity`,
      );
    }
    if (!isDeepStrictEqual(artifact.app, expectedApp)) {
      throw transportFailure(
        "PROVIDER_ARTIFACT_APP_MISMATCH",
        `Provider pre-scope ${selector.kind} ${selector.id} has the wrong App identity`,
      );
    }
    this.consumeItems(1, "provider pre-scope artifact");
    return {
      selector,
      artifact,
      response_server_time: response.serverTime,
      raw_body_sha256: response.bodySha256,
    };
  }

  async loadPermissions(request, pages, phase) {
    const repoPath = repositoryPath(request.owner, request.repo);
    const capabilityResponse = await this.rest(
      "GET",
      repoPath,
      undefined,
      `${phase} transport capability`,
    );
    const transportCapability = {
      ...normalizeTransportCapability(
        capabilityResponse.data,
        request,
        repoPath,
        this.restBaseUrl,
      ),
      endpoint: apiUrl(this.restBaseUrl, repoPath).href,
      http_status: 200,
      response_server_time: capabilityResponse.serverTime,
      raw_body_sha256: capabilityResponse.bodySha256,
    };

    const exactArtifacts = new Map(
      pages.exact_artifacts.map((entry) => [
        `${entry.selector.kind}:${entry.selector.id}`,
        entry,
      ]),
    );
    const actorPermissions = [];
    for (const subject of request.permissionSubjects) {
      const exact = exactArtifacts.get(`${subject.kind}:${subject.id}`);
      if (!exact) {
        throw transportFailure(
          "PERMISSION_SUBJECT_NOT_EXACT",
          `Permission subject ${subject.kind}:${subject.id} has no exact artifact receipt`,
        );
      }
      const actor = exact.artifact.author;
      if (actor === null) {
        throw transportFailure(
          "PERMISSION_SUBJECT_ACTOR_UNKNOWN",
          `Permission subject ${subject.kind}:${subject.id} has no actor`,
        );
      }
      const permissionPath =
        `${repoPath}/collaborators/${encodeURIComponent(actor.login)}/permission`;
      const response = await this.rest(
        "GET",
        permissionPath,
        undefined,
        `${phase} actor permission for ${subject.kind}:${subject.id}`,
      );
      actorPermissions.push({
        subject,
        actor,
        ...normalizeActorPermissionResponse(
          response.data,
          actor,
          `${phase} actor permission for ${subject.kind}:${subject.id}`,
        ),
        endpoint: apiUrl(this.restBaseUrl, permissionPath).href,
        http_status: 200,
        response_server_time: response.serverTime,
        raw_body_sha256: response.bodySha256,
      });
    }
    return {
      transport_capability: transportCapability,
      actor_permissions: actorPermissions,
    };
  }

  async loadExactArtifacts({
    request,
    repoPath,
    prPath,
    issuePath,
    issueComments,
    reviews,
    inlineComments,
  }) {
    const collections = {
      issue_comment: new Map(issueComments.map((item) => [item.id, item])),
      pull_request_review: new Map(reviews.map((item) => [item.id, item])),
      inline_comment: new Map(inlineComments.map((item) => [item.id, item])),
    };
    const result = [];
    for (const selector of request.artifactSelectors) {
      let path;
      let normalize;
      let context;
      if (selector.kind === "issue_comment") {
        path = `${repoPath}/issues/comments/${selector.id}`;
        context = {
          restBaseUrl: this.restBaseUrl,
          repoPath,
          issuePath,
          owner: request.owner,
          repo: request.repo,
          pullNumber: request.pullNumber,
        };
        normalize = (value) => normalizeIssueComment(value, `exact issue comment ${selector.id}`, context);
      } else if (selector.kind === "pull_request_review") {
        path = `${prPath}/reviews/${selector.id}`;
        context = {
          restBaseUrl: this.restBaseUrl,
          repoPath,
          prPath,
          owner: request.owner,
          repo: request.repo,
          pullNumber: request.pullNumber,
        };
        normalize = (value) => normalizeReview(value, `exact review ${selector.id}`, context);
      } else {
        path = `${repoPath}/pulls/comments/${selector.id}`;
        context = {
          restBaseUrl: this.restBaseUrl,
          repoPath,
          prPath,
          owner: request.owner,
          repo: request.repo,
          pullNumber: request.pullNumber,
        };
        normalize = (value) => normalizeInlineComment(
          value,
          `exact inline comment ${selector.id}`,
          context,
        );
      }
      const response = await this.rest(
        "GET",
        path,
        undefined,
        `exact ${selector.kind} ${selector.id}`,
      );
      const artifact = normalize(response.data);
      if (artifact.id !== selector.id) {
        throw transportFailure(
          "ARTIFACT_ID_MISMATCH",
          `Exact ${selector.kind} GET returned id ${artifact.id} instead of ${selector.id}`,
        );
      }
      const paginated = collections[selector.kind].get(selector.id);
      if (!paginated) {
        throw transportFailure(
          "ARTIFACT_NOT_IN_SNAPSHOT",
          `Exact ${selector.kind} ${selector.id} was absent from the complete PR pages`,
        );
      }
      if (!isDeepStrictEqual(paginated, artifact)) {
        throw transportFailure(
          "ARTIFACT_DRIFT",
          `Exact ${selector.kind} ${selector.id} changed relative to its paginated snapshot`,
        );
      }
      this.consumeItems(1, `exact ${selector.kind} artifacts`);
      result.push({
        selector,
        artifact,
        response_server_time: response.serverTime,
        raw_body_sha256: response.bodySha256,
      });
    }
    return result;
  }

  async loadReviewThreads(request) {
    const result = [];
    const seenThreadIds = new Set();
    let after = null;
    for (let page = 1; page <= this.limits.max_pages; page += 1) {
      const response = await this.graphql(V2_REVIEW_THREADS_QUERY, {
        owner: request.owner,
        repo: request.repo,
        number: request.pullNumber,
        after,
        pageSize: this.limits.page_size,
      }, `review threads page ${page}`);
      const connection = response.data?.repository?.pullRequest?.reviewThreads;
      const parsed = normalizeConnection(
        connection,
        `review threads page ${page}`,
        this.limits.page_size,
      );
      this.consumeItems(parsed.nodes.length, "review threads");
      for (const [index, node] of parsed.nodes.entries()) {
        const thread = normalizeThreadNode(
          node,
          `review threads page ${page} node ${index}`,
          this.limits.page_size,
        );
        if (seenThreadIds.has(thread.id)) {
          throw transportFailure(
            "DUPLICATE_ITEM",
            `Review-thread pagination repeated id ${thread.id}`,
          );
        }
        seenThreadIds.add(thread.id);
        this.consumeItems(thread.comments.length, `review-thread ${thread.id} comments`);
        if (node.comments.pageInfo.hasNextPage) {
          const remaining = await this.loadRemainingThreadComments(thread, node.comments.pageInfo);
          thread.comments.push(...remaining);
        }
        validateUniqueIds(thread.comments, `review-thread ${thread.id} comments`);
        result.push(thread);
      }
      if (!parsed.pageInfo.hasNextPage) {
        return result;
      }
      after = nextCursor(parsed.pageInfo, after, `review threads page ${page}`);
    }
    throw transportFailure(
      "PAGE_LIMIT_EXCEEDED",
      `GraphQL review-thread pagination exceeded ${this.limits.max_pages} pages`,
    );
  }

  async loadReviewReactions(reviews) {
    const groups = [];
    for (const review of reviews) {
      const reactions = [];
      const seenReactionIds = new Set();
      let expectedTotalCount = null;
      let after = null;
      let complete = false;
      for (let page = 1; page <= this.limits.max_pages; page += 1) {
        const response = await this.graphql(V2_REVIEW_REACTIONS_QUERY, {
          reviewId: review.node_id,
          after,
          pageSize: this.limits.page_size,
        }, `pull-request review ${review.id} reactions page ${page}`);
        const node = response.data?.node;
        assertPlainObject(node, `pull-request review ${review.id} reactions page ${page} node`);
        const nodeId = requireNonEmptyString(
          node.id,
          `pull-request review ${review.id} reactions page ${page} node.id`,
        );
        const databaseId = requireDecimalId(
          node.fullDatabaseId,
          `pull-request review ${review.id} reactions page ${page} node.fullDatabaseId`,
        );
        if (nodeId !== review.node_id || databaseId !== review.id) {
          throw transportFailure(
            "REACTION_SUBJECT_MISMATCH",
            `GraphQL review reaction subject did not match REST review ${review.id}`,
          );
        }
        const connection = node.reactions;
        assertPlainObject(
          connection,
          `pull-request review ${review.id} reactions page ${page}`,
        );
        if (!Number.isSafeInteger(connection.totalCount) || connection.totalCount < 0) {
          throw transportFailure(
            "INVALID_RESPONSE_SCHEMA",
            `pull-request review ${review.id} reactions totalCount must be a ` +
              "non-negative safe integer",
          );
        }
        if (expectedTotalCount === null) {
          expectedTotalCount = connection.totalCount;
        } else if (connection.totalCount !== expectedTotalCount) {
          throw transportFailure(
            "REACTION_PAGE_DRIFT",
            `Pull-request review ${review.id} reaction totalCount changed during pagination`,
          );
        }
        const parsed = normalizeConnection(
          connection,
          `pull-request review ${review.id} reactions page ${page}`,
          this.limits.page_size,
        );
        this.consumeItems(parsed.nodes.length, `pull-request review ${review.id} reactions`);
        for (const [index, value] of parsed.nodes.entries()) {
          const reaction = normalizeGraphqlReaction(
            value,
            `pull-request review ${review.id} reactions page ${page} node ${index}`,
          );
          if (seenReactionIds.has(reaction.node_id)) {
            throw transportFailure(
              "DUPLICATE_ITEM",
              `Pull-request review ${review.id} reactions repeated node id ${reaction.node_id}`,
            );
          }
          seenReactionIds.add(reaction.node_id);
          reactions.push(reaction);
        }
        if (!parsed.pageInfo.hasNextPage) {
          if (reactions.length !== expectedTotalCount) {
            throw transportFailure(
              "INCOMPLETE_PAGINATION",
              `Pull-request review ${review.id} loaded ${reactions.length} reactions but ` +
                `GitHub reported ${expectedTotalCount}`,
            );
          }
          complete = true;
          break;
        }
        after = nextCursor(
          parsed.pageInfo,
          after,
          `pull-request review ${review.id} reactions page ${page}`,
        );
      }
      if (!complete) {
        throw transportFailure(
          "PAGE_LIMIT_EXCEEDED",
          `GraphQL pull-request review ${review.id} reaction pagination exceeded ` +
            `${this.limits.max_pages} pages`,
        );
      }
      groups.push({ subject_id: review.id, reactions });
    }
    return groups;
  }

  async loadRemainingThreadComments(initialThread, initialPageInfo) {
    const result = [];
    let after = nextCursor(
      initialPageInfo,
      null,
      `review-thread ${initialThread.id} initial comments`,
    );
    for (let page = 2; page <= this.limits.max_pages; page += 1) {
      const response = await this.graphql(V2_REVIEW_THREAD_COMMENTS_QUERY, {
        threadId: initialThread.id,
        after,
        pageSize: this.limits.page_size,
      }, `review-thread ${initialThread.id} comments page ${page}`);
      const node = response.data?.node;
      const identity = normalizeThreadIdentity(
        node,
        `review-thread ${initialThread.id} comments page ${page}`,
      );
      if (!isDeepStrictEqual(identity, threadIdentity(initialThread))) {
        throw transportFailure(
          "THREAD_STATE_DRIFT",
          `Review-thread ${initialThread.id} changed while its comments were paginated`,
        );
      }
      const parsed = normalizeConnection(
        node.comments,
        `review-thread ${initialThread.id} comments page ${page}`,
        this.limits.page_size,
      );
      const comments = parsed.nodes.map((comment, index) =>
        normalizeThreadComment(
          comment,
          `review-thread ${initialThread.id} comments page ${page} node ${index}`,
        ));
      this.consumeItems(comments.length, `review-thread ${initialThread.id} comments`);
      result.push(...comments);
      if (!parsed.pageInfo.hasNextPage) {
        return result;
      }
      after = nextCursor(
        parsed.pageInfo,
        after,
        `review-thread ${initialThread.id} comments page ${page}`,
      );
    }
    throw transportFailure(
      "PAGE_LIMIT_EXCEEDED",
      `GraphQL review-thread ${initialThread.id} comments exceeded ` +
        `${this.limits.max_pages} pages`,
    );
  }

  async paginateRest(path, label, normalize) {
    const result = [];
    const ids = new Set();
    let expectedLastPage = null;
    for (let page = 1; page <= this.limits.max_pages; page += 1) {
      const response = await this.rest(
        "GET",
        path,
        { per_page: this.limits.page_size, page },
        `${label} page ${page}`,
      );
      if (!Array.isArray(response.data)) {
        throw transportFailure(
          "INVALID_RESPONSE_SCHEMA",
          `${label} page ${page} did not return an array`,
        );
      }
      if (response.data.length > this.limits.page_size) {
        throw transportFailure(
          "INVALID_RESPONSE_SCHEMA",
          `${label} page ${page} returned ${response.data.length} items, ` +
            `exceeding per_page=${this.limits.page_size}`,
        );
      }
      this.consumeItems(response.data.length, label);
      for (const [index, value] of response.data.entries()) {
        const item = normalize(value, index);
        if (ids.has(item.id)) {
          throw transportFailure(
            "DUPLICATE_ITEM",
            `${label} pagination repeated id ${item.id}`,
          );
        }
        ids.add(item.id);
        result.push(item);
      }
      const pagination = parseAndValidatePaginationLink(
        response.headers.get("link"),
        this.restBaseUrl,
        path,
        page,
        this.limits.page_size,
        this.limits.max_pages,
        label,
      );
      if (pagination.lastPage !== null) {
        if (
          expectedLastPage !== null &&
          pagination.lastPage !== expectedLastPage
        ) {
          throw transportFailure(
            "INCOMPLETE_PAGINATION",
            `${label} changed its promised last page from ${expectedLastPage} to ` +
              `${pagination.lastPage}`,
          );
        }
        expectedLastPage = pagination.lastPage;
      }
      if (
        expectedLastPage !== null &&
        (
          page > expectedLastPage ||
          (page < expectedLastPage && pagination.nextPage !== page + 1) ||
          (page === expectedLastPage && pagination.nextPage !== null)
        )
      ) {
        throw transportFailure(
          "INCOMPLETE_PAGINATION",
          `${label} page ${page} violated its promised last page ${expectedLastPage}`,
        );
      }
      if (pagination.nextPage === null) {
        return result;
      }
    }
    throw transportFailure(
      "PAGE_LIMIT_EXCEEDED",
      `${label} pagination exceeded ${this.limits.max_pages} pages`,
    );
  }

  consumeItems(count, label) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new TypeError("transport item count must be a non-negative safe integer");
    }
    this.itemCount += count;
    if (this.itemCount > this.limits.max_items) {
      throw transportFailure(
        "ITEM_LIMIT_EXCEEDED",
        `Complete PR snapshot exceeded ${this.limits.max_items} items while loading ${label}`,
      );
    }
  }

  async rest(method, path, query, label, { allowNotFound = false } = {}) {
    const url = apiUrl(this.restBaseUrl, path);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, String(value));
    }
    return this.requestJson(url, {
      method,
      headers: this.headers(),
    }, label, { allowNotFound });
  }

  async graphql(query, variables, label) {
    const response = await this.requestJson(this.graphqlUrl, {
      method: "POST",
      headers: {
        ...this.headers(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    }, label);
    if (!isPlainObject(response.data)) {
      throw transportFailure(
        "INVALID_RESPONSE_SCHEMA",
        `${label} GraphQL response was not an object`,
      );
    }
    if (response.data.errors !== undefined) {
      if (!Array.isArray(response.data.errors) || response.data.errors.length === 0) {
        throw transportFailure(
          "INVALID_RESPONSE_SCHEMA",
          `${label} returned an invalid GraphQL errors field`,
        );
      }
      const messages = response.data.errors.map((error) =>
        typeof error?.message === "string" ? error.message : "malformed GraphQL error");
      throw transportFailure(
        "GRAPHQL_ERROR",
        `${label} failed: ${messages.join("; ")}`,
      );
    }
    if (!Object.hasOwn(response.data, "data") || !isPlainObject(response.data.data)) {
      throw transportFailure(
        "INVALID_RESPONSE_SCHEMA",
        `${label} omitted the GraphQL data object`,
      );
    }
    return {
      data: response.data.data,
      status: response.status,
      serverTime: response.serverTime,
      headers: response.headers,
      bodySha256: response.bodySha256,
    };
  }

  headers() {
    const headers = {
      Accept: "application/vnd.github+json",
      "User-Agent": this.userAgent,
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (this.token !== undefined) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  async requestJson(url, options, label, { allowNotFound = false } = {}) {
    if (this.requestCount >= this.limits.max_requests) {
      throw transportFailure(
        "REQUEST_LIMIT_EXCEEDED",
        `Complete PR snapshot exhausted its ${this.limits.max_requests}-request budget ` +
          `before ${label}`,
      );
    }
    this.requestCount += 1;
    const deadline = new RequestDeadline(this.limits.request_timeout_ms, label);
    let response;
    let rawBody;
    let serverTime;
    let cancelResponse = () => {};
    try {
      deadline.checkpoint();
      const fetchOperation = this.fetchImpl(url, {
        ...options,
        redirect: "error",
        signal: deadline.signal,
      });
      response = await awaitRequestOperation(fetchOperation, deadline, {
        onLateFulfilled: cancelResponseBody,
      });
      cancelResponse = createBestEffortOnce(() => cancelResponseBody(response));
      deadline.checkpoint();
      if (
        response === null ||
        typeof response !== "object" ||
        typeof response.body?.getReader !== "function" ||
        !response.headers ||
        typeof response.headers.get !== "function" ||
        !Number.isInteger(response.status)
      ) {
        throw transportFailure(
          "INVALID_FETCH_RESPONSE",
          `${label} fetch did not return a Response-compatible object`,
        );
      }
      deadline.checkpoint();
      serverTime = normalizeServerDate(response.headers.get("date"), label);
      this.observeServerTime(serverTime, label);
      deadline.checkpoint();
      const declaredLength = parseContentLength(response.headers.get("content-length"), label);
      if (declaredLength !== null) {
        this.enforceResponseBudget(declaredLength, this.responseBytes, label, true);
      }
      deadline.checkpoint();
      const remainingWorkBytes = this.limits.max_total_response_bytes - this.responseBytes;
      rawBody = await readBoundedResponseBody(
        response,
        Math.min(this.limits.max_response_bytes, remainingWorkBytes),
        label,
        deadline,
      );
      deadline.checkpoint();
      const byteLength = rawBody.byteLength;
      this.enforceResponseBudget(byteLength, this.responseBytes, label, false);
      this.responseBytes += byteLength;

      deadline.checkpoint();
      let text;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(rawBody);
      } catch (error) {
        throw transportFailure(
          "INVALID_UTF8",
          `${label} response body was not valid UTF-8`,
          null,
          error,
        );
      }
      deadline.checkpoint();
      let data;
      try {
        data = JSON.parse(text);
      } catch (error) {
        throw transportFailure(
          "INVALID_JSON",
          `${label} response was not valid JSON`,
          null,
          error,
        );
      }
      deadline.checkpoint();
      if (allowNotFound && response.status === 404) {
        const result = {
          data: null,
          status: response.status,
          serverTime,
          headers: response.headers,
          bodySha256: sha256(rawBody),
        };
        deadline.checkpoint();
        return result;
      }
      if (response.status < 200 || response.status >= 300) {
        const message = typeof data?.message === "string" ? `: ${data.message}` : "";
        throw transportFailure(
          "HTTP_ERROR",
          `${label} failed with HTTP ${response.status}${message}`,
          { status: response.status },
        );
      }
      const result = {
        data,
        status: response.status,
        serverTime,
        headers: response.headers,
        bodySha256: sha256(rawBody),
      };
      deadline.checkpoint();
      return result;
    } catch (error) {
      const timedOut = deadline.expiredOrElapsed();
      if (!timedOut) {
        deadline.abort();
      }
      cancelResponse();
      if (timedOut) {
        if (error instanceof V2TransportError && error.code === "REQUEST_TIMEOUT") {
          throw error;
        }
        throw deadline.failure(error);
      }
      if (error instanceof V2TransportError) {
        throw error;
      }
      throw transportFailure(
        "NETWORK_ERROR",
        `${label} request failed: ${error.message}`,
        null,
        error,
      );
    } finally {
      deadline.close();
    }
  }

  enforceResponseBudget(byteLength, priorBytes, label, declared) {
    if (byteLength > this.limits.max_response_bytes) {
      throw transportFailure(
        "RESPONSE_BYTE_LIMIT_EXCEEDED",
        `${label} ${declared ? "declared" : "returned"} ${byteLength} bytes, exceeding ` +
          `${this.limits.max_response_bytes}`,
      );
    }
    if (priorBytes + byteLength > this.limits.max_total_response_bytes) {
      throw transportFailure(
        "TOTAL_RESPONSE_BYTE_LIMIT_EXCEEDED",
        `${label} would raise snapshot response bytes to ${priorBytes + byteLength}, ` +
          `exceeding ${this.limits.max_total_response_bytes}`,
      );
    }
  }

  observeServerTime(serverTime, label) {
    if (
      this.lastServerTime !== null &&
      Date.parse(serverTime) < Date.parse(this.lastServerTime)
    ) {
      throw transportFailure(
        "SERVER_TIME_REGRESSED",
        `${label} returned GitHub server time ${serverTime} before prior response time ` +
          this.lastServerTime,
      );
    }
    this.lastServerTime = serverTime;
    this.serverDateCount += 1;
  }
}

const REQUEST_DEADLINE_EXPIRED = Symbol("request-deadline-expired");

class RequestDeadline {
  constructor(timeoutMs, label) {
    this.timeoutMs = timeoutMs;
    this.label = label;
    this.controller = new AbortController();
    this.expiresAt = performance.now() + timeoutMs;
    this.expired = false;
    this.abortStarted = false;
    this.expiration = new Promise((resolve) => {
      this.resolveExpiration = resolve;
    });
    this.timer = setTimeout(() => this.expire(), timeoutMs);
  }

  get signal() {
    return this.controller.signal;
  }

  expire() {
    if (this.expired) {
      return;
    }
    this.expired = true;
    this.abort();
    this.resolveExpiration(REQUEST_DEADLINE_EXPIRED);
  }

  abort() {
    if (this.abortStarted || this.controller.signal.aborted) {
      return;
    }
    this.abortStarted = true;
    const abortReason = new Error(`${this.label} request cleanup`);
    startBestEffort(() => this.controller.abort(abortReason));
  }

  expiredOrElapsed() {
    if (!this.expired && performance.now() >= this.expiresAt) {
      this.expire();
    }
    return this.expired;
  }

  checkpoint() {
    if (this.expiredOrElapsed()) {
      throw this.failure();
    }
  }

  failure(cause = undefined) {
    return transportFailure(
      "REQUEST_TIMEOUT",
      `${this.label} request timed out after ${this.timeoutMs} ms`,
      null,
      cause,
    );
  }

  close() {
    clearTimeout(this.timer);
  }
}

async function awaitRequestOperation(operation, deadline, {
  onTimeout = undefined,
  onLateFulfilled = undefined,
} = {}) {
  const tracked = Promise.resolve(operation).then(
    (value) => ({ state: "fulfilled", value }),
    (error) => ({ state: "rejected", error }),
  );
  if (deadline.expiredOrElapsed()) {
    handleTimedOutOperation(tracked, REQUEST_DEADLINE_EXPIRED, onTimeout, onLateFulfilled);
    throw deadline.failure();
  }
  const outcome = await Promise.race([tracked, deadline.expiration]);
  if (outcome === REQUEST_DEADLINE_EXPIRED || deadline.expiredOrElapsed()) {
    handleTimedOutOperation(tracked, outcome, onTimeout, onLateFulfilled);
    const cause = outcome?.state === "rejected" ? outcome.error : undefined;
    throw deadline.failure(cause);
  }
  if (outcome.state === "rejected") {
    throw outcome.error;
  }
  return outcome.value;
}

function handleTimedOutOperation(tracked, outcome, onTimeout, onLateFulfilled) {
  startBestEffort(onTimeout);
  if (outcome?.state === "fulfilled") {
    startBestEffort(onLateFulfilled, outcome.value);
    return;
  }
  if (outcome === REQUEST_DEADLINE_EXPIRED && typeof onLateFulfilled === "function") {
    tracked.then((late) => {
      if (late.state === "fulfilled") {
        startBestEffort(onLateFulfilled, late.value);
      }
    });
  }
}

function createBestEffortOnce(action) {
  let started = false;
  return () => {
    if (started) {
      return;
    }
    started = true;
    startBestEffort(action);
  };
}

function startBestEffort(action, value = undefined) {
  if (typeof action !== "function") {
    return;
  }
  let invoked = false;
  try {
    safeSetImmediate(() => {
      if (invoked) {
        return;
      }
      invoked = true;
      try {
        Promise.resolve(action(value)).catch(() => {});
      } catch {
        // Ignore direct cancel/release throws from deferred cleanup calls.
        // Node rethrows AbortSignal listener exceptions outside this catch; those
        // listeners are trusted adapter code and must remain nonthrowing.
      }
    });
  } catch {
    // Scheduling cleanup is best-effort and must never replace the primary result.
  }
}

function cancelResponseBody(response) {
  if (typeof response?.body?.cancel === "function") {
    return response.body.cancel();
  }
  return undefined;
}

async function readBoundedResponseBody(
  response,
  maxBytes,
  label,
  deadline,
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw transportFailure(
      "TOTAL_RESPONSE_BYTE_LIMIT_EXCEEDED",
      `${label} has no remaining response-byte budget`,
    );
  }
  deadline.checkpoint();
  const reader = response.body.getReader();
  const cancelReader = createBestEffortOnce(() => reader.cancel());
  const chunks = [];
  let chunkCount = 0;
  let byteLength = 0;
  let complete = false;
  try {
    deadline.checkpoint();
    while (true) {
      deadline.checkpoint();
      const readResult = await awaitRequestOperation(
        reader.read(),
        deadline,
        {
          onTimeout: cancelReader,
          onLateFulfilled: cancelReader,
        },
      );
      deadline.checkpoint();
      const { done, value } = normalizeResponseReadResult(readResult, label);
      deadline.checkpoint();
      if (done) {
        complete = true;
        break;
      }
      const internalByteLength = responseChunkInternalByteLength(value, label);
      if (internalByteLength === 0) {
        cancelReader();
        throw transportFailure(
          "INVALID_FETCH_RESPONSE",
          `${label} response stream returned an empty byte chunk`,
        );
      }
      chunkCount += 1;
      if (chunkCount > MAX_V2_TRANSPORT_RESPONSE_CHUNKS) {
        cancelReader();
        throw transportFailure(
          "RESPONSE_CHUNK_LIMIT_EXCEEDED",
          `${label} response exceeded the ${MAX_V2_TRANSPORT_RESPONSE_CHUNKS}-chunk cap`,
        );
      }
      if (internalByteLength > maxBytes - byteLength) {
        deadline.abort();
        cancelReader();
        throw transportFailure(
          "RESPONSE_BYTE_LIMIT_EXCEEDED",
          `${label} returned more than its remaining ${maxBytes}-byte budget`,
        );
      }
      const chunk = copyResponseByteChunk(value, internalByteLength, label);
      const nextByteLength = byteLength + chunk.length;
      if (nextByteLength > maxBytes) {
        deadline.abort();
        cancelReader();
        throw transportFailure(
          "RESPONSE_BYTE_LIMIT_EXCEEDED",
          `${label} returned more than its remaining ${maxBytes}-byte budget`,
        );
      }
      chunks.push(chunk);
      byteLength = nextByteLength;
      deadline.checkpoint();
    }
  } finally {
    if (!complete) {
      cancelReader();
    }
    startBestEffort(() => reader.releaseLock());
  }
  deadline.checkpoint();
  return Buffer.concat(chunks, byteLength);
}

function responseChunkInternalByteLength(value, label) {
  if (!(value instanceof Uint8Array)) {
    throw transportFailure(
      "INVALID_FETCH_RESPONSE",
      `${label} response stream returned a non-byte chunk`,
    );
  }
  try {
    return Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []);
  } catch (error) {
    throw transportFailure(
      "INVALID_FETCH_RESPONSE",
      `${label} response stream returned an unreadable byte chunk`,
      null,
      error,
    );
  }
}

function copyResponseByteChunk(value, internalByteLength, label) {
  try {
    const buffer = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []);
    const byteOffset = Reflect.apply(TYPED_ARRAY_BYTE_OFFSET_GETTER, value, []);
    const copy = Buffer.from(new Uint8Array(buffer, byteOffset, internalByteLength));
    if (copy.length !== internalByteLength) {
      throw new Error("byte chunk copy length changed");
    }
    return copy;
  } catch (error) {
    throw transportFailure(
      "INVALID_FETCH_RESPONSE",
      `${label} response stream byte chunk could not be copied exactly`,
      null,
      error,
    );
  }
}

function normalizeResponseReadResult(result, label) {
  if (!isPlainObject(result)) {
    throw transportFailure(
      "INVALID_FETCH_RESPONSE",
      `${label} response stream returned a non-object read result`,
    );
  }
  let keys;
  let doneDescriptor;
  let valueDescriptor;
  try {
    keys = Reflect.ownKeys(result);
    doneDescriptor = Object.getOwnPropertyDescriptor(result, "done");
    valueDescriptor = Object.getOwnPropertyDescriptor(result, "value");
  } catch (error) {
    throw transportFailure(
      "INVALID_FETCH_RESPONSE",
      `${label} response stream returned an unreadable read result`,
      null,
      error,
    );
  }
  if (
    keys.length !== 2 ||
    !keys.includes("done") ||
    !keys.includes("value") ||
    !Object.hasOwn(doneDescriptor ?? {}, "value") ||
    !Object.hasOwn(valueDescriptor ?? {}, "value")
  ) {
    throw transportFailure(
      "INVALID_FETCH_RESPONSE",
      `${label} response stream returned a non-closed read result`,
    );
  }
  const done = doneDescriptor.value;
  const value = valueDescriptor.value;
  if (typeof done !== "boolean") {
    throw transportFailure(
      "INVALID_FETCH_RESPONSE",
      `${label} response stream returned a non-boolean done flag`,
    );
  }
  if (done && value !== undefined) {
    throw transportFailure(
      "INVALID_FETCH_RESPONSE",
      `${label} response stream returned a terminal value`,
    );
  }
  return { done, value };
}

function normalizeMergeRefreshResponse(data, request, repoPath, restBaseUrl, label) {
  assertPlainObject(data, label);
  if (data.number !== request.pullNumber) {
    throw transportFailure(
      "PULL_REQUEST_IDENTITY_MISMATCH",
      `${label} returned pull request ${String(data.number)} instead of ${request.pullNumber}`,
    );
  }
  assertCanonicalApiUrl(
    data.url,
    `${repoPath}/pulls/${request.pullNumber}`,
    restBaseUrl,
    `${label}.url`,
  );
  const merged = requireBoolean(data.merged, `${label}.merged`);
  const mergedAt = nullableTimestamp(data.merged_at, `${label}.merged_at`);
  const restState = requireEnum(data.state, new Set(["open", "closed"]), `${label}.state`);
  if (merged !== (mergedAt !== null)) {
    throw transportFailure(
      "INVALID_PULL_REQUEST_LIFECYCLE",
      `${label} merged and merged_at fields were inconsistent`,
    );
  }
  return {
    pull_request_node_id: requireNonEmptyString(data.node_id, `${label}.node_id`),
    pull_request_state: merged ? "MERGED" : restState.toUpperCase(),
    pull_request_merged: merged,
    pull_request_merged_at: mergedAt,
  };
}

function normalizeGraphScope(data, request, path) {
  assertPlainObject(data, path);
  const repository = data.repository;
  assertPlainObject(repository, `${path}.repository`);
  const owner = requireNonEmptyString(repository.owner?.login, `${path}.repository.owner.login`);
  const name = requireNonEmptyString(repository.name, `${path}.repository.name`);
  if (owner.toLowerCase() !== request.owner.toLowerCase() || name.toLowerCase() !== request.repo.toLowerCase()) {
    throw transportFailure(
      "REPOSITORY_IDENTITY_MISMATCH",
      `${path} resolved ${owner}/${name} instead of ${request.owner}/${request.repo}`,
    );
  }
  const repositoryNodeId = requireNonEmptyString(repository.id, `${path}.repository.id`);
  const pullRequest = repository.pullRequest;
  assertPlainObject(pullRequest, `${path}.repository.pullRequest`);
  if (pullRequest.number !== request.pullNumber) {
    throw transportFailure(
      "PULL_REQUEST_IDENTITY_MISMATCH",
      `${path} returned pull request ${pullRequest.number} instead of ${request.pullNumber}`,
    );
  }
  const state = requireEnum(
    pullRequest.state,
    PULL_REQUEST_STATES,
    `${path}.pullRequest.state`,
  );
  const merged = requireBoolean(pullRequest.merged, `${path}.pullRequest.merged`);
  const mergedAt = nullableTimestamp(pullRequest.mergedAt, `${path}.pullRequest.mergedAt`);
  const isDraft = requireBoolean(pullRequest.isDraft, `${path}.pullRequest.isDraft`);
  const mergeable = requireEnum(
    pullRequest.mergeable,
    MERGEABLE_VALUES,
    `${path}.pullRequest.mergeable`,
  );
  const baseRefName = nullableNonEmptyString(
    pullRequest.baseRefName,
    `${path}.pullRequest.baseRefName`,
  );
  const headRefName = nullableNonEmptyString(
    pullRequest.headRefName,
    `${path}.pullRequest.headRefName`,
  );
  const baseRefTip = normalizeRefTarget(
    pullRequest.baseRef,
    baseRefName,
    `${path}.pullRequest.baseRef`,
  );
  const headRefOid = requireSha(
    pullRequest.headRefOid,
    `${path}.pullRequest.headRefOid`,
  );
  const headRefTarget = normalizeRefTarget(
    pullRequest.headRef,
    headRefName,
    `${path}.pullRequest.headRef`,
  );
  if (headRefTarget !== null && headRefTarget !== headRefOid) {
    throw transportFailure(
      "HEAD_REF_OID_MISMATCH",
      `${path}.pullRequest.headRefOid did not equal headRef.target.oid`,
    );
  }
  const potential = normalizePotentialMergeCommit(
    pullRequest.potentialMergeCommit,
    `${path}.pullRequest.potentialMergeCommit`,
  );
  if (merged && (state !== "MERGED" || mergedAt === null)) {
    throw transportFailure(
      "INVALID_PULL_REQUEST_LIFECYCLE",
      `${path} reported merged=true without state=MERGED and mergedAt`,
    );
  }
  if (!merged && (state === "MERGED" || mergedAt !== null)) {
    throw transportFailure(
      "INVALID_PULL_REQUEST_LIFECYCLE",
      `${path} reported an unmerged pull request with merged lifecycle fields`,
    );
  }

  return {
    repository_owner: owner,
    repository_name: name,
    repository_node_id: repositoryNodeId,
    pull_request_number: request.pullNumber,
    pull_request_node_id: requireNonEmptyString(
      pullRequest.id,
      `${path}.pullRequest.id`,
    ),
    pull_request_state: state,
    pull_request_merged: merged,
    pull_request_merged_at: mergedAt,
    pull_request_is_draft: isDraft,
    base_ref_name: baseRefName,
    base_ref_tip: baseRefTip,
    head_ref_name: headRefName,
    head_ref_oid: headRefOid,
    potential_merge_oid: potential.oid,
    potential_merge_tree: potential.tree,
    ordered_parent_oids: potential.parents,
    mergeable,
  };
}

function normalizeRefTarget(ref, expectedName, path) {
  if (ref === null || ref === undefined) {
    if (expectedName !== null) {
      return null;
    }
    return null;
  }
  assertPlainObject(ref, path);
  const name = requireNonEmptyString(ref.name, `${path}.name`);
  if (expectedName === null || name !== expectedName) {
    throw transportFailure(
      "REF_NAME_MISMATCH",
      `${path}.name ${name} did not equal its pull-request ref name ${expectedName}`,
    );
  }
  return requireSha(ref.target?.oid, `${path}.target.oid`);
}

function normalizePotentialMergeCommit(value, path) {
  if (value === null || value === undefined) {
    return { oid: null, tree: null, parents: [] };
  }
  assertPlainObject(value, path);
  const oid = requireSha(value.oid, `${path}.oid`);
  const tree = requireSha(value.tree?.oid, `${path}.tree.oid`);
  const parents = value.parents;
  assertPlainObject(parents, `${path}.parents`);
  if (!Number.isSafeInteger(parents.totalCount) || parents.totalCount < 0) {
    throw transportFailure(
      "INVALID_RESPONSE_SCHEMA",
      `${path}.parents.totalCount must be a non-negative safe integer`,
    );
  }
  const pageInfo = normalizePageInfo(parents.pageInfo, `${path}.parents.pageInfo`);
  if (pageInfo.hasNextPage || parents.totalCount > 3) {
    throw transportFailure(
      "PARENT_LIST_TRUNCATED",
      `${path}.parents was not complete within the three-parent hard bound`,
    );
  }
  if (!Array.isArray(parents.nodes) || parents.nodes.length !== parents.totalCount) {
    throw transportFailure(
      "INVALID_RESPONSE_SCHEMA",
      `${path}.parents nodes did not match totalCount`,
    );
  }
  return {
    oid,
    tree,
    parents: parents.nodes.map((parent, index) =>
      requireSha(parent?.oid, `${path}.parents.nodes[${index}].oid`)),
  };
}

function normalizeCompareResponse(data, baseSha, path) {
  assertPlainObject(data, path);
  const returnedBase = requireSha(data.base_commit?.sha, `${path}.base_commit.sha`);
  if (returnedBase !== baseSha) {
    throw transportFailure(
      "COMPARE_BASE_MISMATCH",
      `${path} bound base ${returnedBase} instead of live base ${baseSha}`,
    );
  }
  return requireSha(data.merge_base_commit?.sha, `${path}.merge_base_commit.sha`);
}

function normalizeCheckRunDiscovery(value, headSha, path) {
  assertPlainObject(value, path);
  const id = requireDecimalId(value.id, `${path}.id`);
  const returnedHeadSha = requireSha(value.head_sha, `${path}.head_sha`);
  if (returnedHeadSha !== headSha) {
    throw transportFailure(
      "CHECK_RUN_HEAD_MISMATCH",
      `${path} bound head ${returnedHeadSha} instead of requested current head ${headSha}`,
    );
  }
  assertPlainObject(value.app, `${path}.app`);
  return {
    id,
    app_id: requireDecimalId(value.app.id, `${path}.app.id`),
    app_node_id: requireNonEmptyString(value.app.node_id, `${path}.app.node_id`),
    app_slug: requireNonEmptyString(value.app.slug, `${path}.app.slug`),
  };
}

function normalizeServiceStartCheckRun(value, headSha, repoPath, restBaseUrl, path) {
  const discovery = normalizeCheckRunDiscovery(value, headSha, path);
  if (discovery.app_slug !== SERVICE_START_APP_SLUG) {
    throw new TypeError(`${path}.app.slug did not identify the selected service App`);
  }
  assertCanonicalApiUrl(
    value.url,
    `${repoPath}/check-runs/${discovery.id}`,
    restBaseUrl,
    `${path}.url`,
  );
  const status = requireEnum(value.status, CHECK_RUN_STATUSES, `${path}.status`);
  const conclusion = nullableEnum(
    value.conclusion,
    CHECK_RUN_CONCLUSIONS,
    `${path}.conclusion`,
  );
  const startedAt = nullableTimestamp(value.started_at, `${path}.started_at`);
  const completedAt = nullableTimestamp(value.completed_at, `${path}.completed_at`);
  if (status === "completed" && conclusion === null) {
    throw new TypeError(`${path}.conclusion is required for a completed check run`);
  }
  if (status !== "completed" && (conclusion !== null || completedAt !== null)) {
    throw new TypeError(
      `${path}.conclusion and completed_at require status=completed`,
    );
  }
  if (
    startedAt !== null &&
    completedAt !== null &&
    Date.parse(completedAt) < Date.parse(startedAt)
  ) {
    throw new TypeError(`${path}.completed_at must not precede started_at`);
  }
  return {
    id: discovery.id,
    node_id: requireNonEmptyString(value.node_id, `${path}.node_id`),
    url: apiUrl(restBaseUrl, `${repoPath}/check-runs/${discovery.id}`).href,
    name: requireNonEmptyString(value.name, `${path}.name`),
    head_sha: headSha,
    status,
    conclusion,
    started_at: startedAt,
    completed_at: completedAt,
    external_id: nullableString(value.external_id, `${path}.external_id`),
    details_url: nullableAbsoluteUrl(value.details_url, `${path}.details_url`),
    app: {
      id: discovery.app_id,
      node_id: discovery.app_node_id,
      slug: discovery.app_slug,
    },
  };
}

function normalizeMergeRefResponse(data, pullNumber, path, restBaseUrl, label) {
  assertPlainObject(data, label);
  const expectedRef = `refs/pull/${pullNumber}/merge`;
  if (data.ref !== expectedRef) {
    throw transportFailure(
      "MERGE_REF_NAME_MISMATCH",
      `${label} returned ref ${String(data.ref)} instead of ${expectedRef}`,
    );
  }
  if (data.object?.type !== "commit") {
    throw transportFailure(
      "INVALID_RESPONSE_SCHEMA",
      `${label}.object.type must be commit`,
    );
  }
  const responsePath = path.replace("/git/ref/", "/git/refs/");
  assertCanonicalApiUrl(data.url, responsePath, restBaseUrl, `${label}.url`);
  const oid = requireSha(data.object.sha, `${label}.object.sha`);
  const commitPath = path.replace(/\/git\/ref\/pull\/[0-9]+\/merge$/, `/git/commits/${oid}`);
  assertCanonicalApiUrl(
    data.object.url,
    commitPath,
    restBaseUrl,
    `${label}.object.url`,
  );
  return oid;
}

function normalizeIssueComment(value, path, context) {
  assertPlainObject(value, path);
  const id = requireDecimalId(value.id, `${path}.id`);
  assertCanonicalApiUrl(
    value.url,
    `${context.repoPath}/issues/comments/${id}`,
    context.restBaseUrl,
    `${path}.url`,
  );
  assertCanonicalApiUrl(
    value.issue_url,
    context.issuePath,
    context.restBaseUrl,
    `${path}.issue_url`,
  );
  return {
    id,
    node_id: requireNonEmptyString(value.node_id, `${path}.node_id`),
    url: value.url,
    html_url: requireCanonicalGitHubArtifactUrl(
      value.html_url,
      context,
      "issuecomment",
      id,
      `${path}.html_url`,
    ),
    issue_url: value.issue_url,
    author: normalizeActor(value.user, `${path}.user`),
    app: normalizeApp(value.performed_via_github_app ?? value.app, `${path}.app`),
    author_association: requireNonEmptyString(
      value.author_association,
      `${path}.author_association`,
    ),
    body: nullableString(value.body, `${path}.body`),
    created_at: requireTimestamp(value.created_at, `${path}.created_at`),
    updated_at: requireTimestamp(value.updated_at, `${path}.updated_at`),
  };
}

function normalizeReview(value, path, context) {
  assertPlainObject(value, path);
  const id = requireDecimalId(value.id, `${path}.id`);
  assertCanonicalApiUrl(
    value.url,
    `${context.prPath}/reviews/${id}`,
    context.restBaseUrl,
    `${path}.url`,
  );
  assertCanonicalApiUrl(
    value.pull_request_url,
    context.prPath,
    context.restBaseUrl,
    `${path}.pull_request_url`,
  );
  return {
    id,
    node_id: requireNonEmptyString(value.node_id, `${path}.node_id`),
    url: value.url,
    html_url: requireCanonicalGitHubArtifactUrl(
      value.html_url,
      context,
      "pullrequestreview",
      id,
      `${path}.html_url`,
    ),
    pull_request_url: value.pull_request_url,
    author: normalizeActor(value.user, `${path}.user`),
    app: normalizeApp(value.app, `${path}.app`),
    author_association: requireNonEmptyString(
      value.author_association,
      `${path}.author_association`,
    ),
    body: nullableString(value.body, `${path}.body`),
    state: requireEnum(
      String(value.state || "").toUpperCase(),
      REVIEW_STATES,
      `${path}.state`,
    ),
    submitted_at: nullableTimestamp(value.submitted_at, `${path}.submitted_at`),
    commit_id: nullableSha(value.commit_id, `${path}.commit_id`),
  };
}

function normalizeInlineComment(value, path, context) {
  assertPlainObject(value, path);
  const id = requireDecimalId(value.id, `${path}.id`);
  assertCanonicalApiUrl(
    value.url,
    `${context.repoPath}/pulls/comments/${id}`,
    context.restBaseUrl,
    `${path}.url`,
  );
  assertCanonicalApiUrl(
    value.pull_request_url,
    context.prPath,
    context.restBaseUrl,
    `${path}.pull_request_url`,
  );
  return {
    id,
    node_id: requireNonEmptyString(value.node_id, `${path}.node_id`),
    pull_request_review_id: requireDecimalId(
      value.pull_request_review_id,
      `${path}.pull_request_review_id`,
    ),
    url: value.url,
    html_url: requireCanonicalGitHubArtifactUrl(
      value.html_url,
      context,
      "discussion_r",
      id,
      `${path}.html_url`,
    ),
    pull_request_url: value.pull_request_url,
    author: normalizeActor(value.user, `${path}.user`),
    app: normalizeApp(value.app, `${path}.app`),
    author_association: requireNonEmptyString(
      value.author_association,
      `${path}.author_association`,
    ),
    body: nullableString(value.body, `${path}.body`),
    path: requireNonEmptyString(value.path, `${path}.path`),
    line: nullableInteger(value.line, `${path}.line`),
    start_line: nullableInteger(value.start_line, `${path}.start_line`),
    side: nullableEnum(value.side, DIFF_SIDES, `${path}.side`),
    start_side: nullableEnum(value.start_side, DIFF_SIDES, `${path}.start_side`),
    commit_id: requireSha(value.commit_id, `${path}.commit_id`),
    original_commit_id: requireSha(
      value.original_commit_id,
      `${path}.original_commit_id`,
    ),
    in_reply_to_id: nullableDecimalId(value.in_reply_to_id, `${path}.in_reply_to_id`),
    created_at: requireTimestamp(value.created_at, `${path}.created_at`),
    updated_at: requireTimestamp(value.updated_at, `${path}.updated_at`),
  };
}

function normalizeReaction(value, path) {
  assertPlainObject(value, path);
  return {
    id: requireDecimalId(value.id, `${path}.id`),
    node_id: requireNonEmptyString(value.node_id, `${path}.node_id`),
    content: requireEnum(
      value.content,
      new Set(["+1", "-1", "laugh", "confused", "heart", "hooray", "rocket", "eyes"]),
      `${path}.content`,
    ),
    created_at: requireTimestamp(value.created_at, `${path}.created_at`),
    author: normalizeActor(value.user, `${path}.user`),
  };
}

function normalizeGraphqlReaction(value, path) {
  assertPlainObject(value, path);
  const content = new Map([
    ["THUMBS_UP", "+1"],
    ["THUMBS_DOWN", "-1"],
    ["LAUGH", "laugh"],
    ["CONFUSED", "confused"],
    ["HEART", "heart"],
    ["HOORAY", "hooray"],
    ["ROCKET", "rocket"],
    ["EYES", "eyes"],
  ]).get(value.content);
  if (content === undefined) {
    throw new TypeError(`${path}.content has an unsupported value`);
  }
  return {
    id: requireDecimalId(value.databaseId, `${path}.databaseId`),
    node_id: requireNonEmptyString(value.id, `${path}.id`),
    content,
    created_at: requireTimestamp(value.createdAt, `${path}.createdAt`),
    author: normalizeGraphqlReactionUser(value.user, `${path}.user`),
  };
}

function normalizeGraphqlReactionUser(value, path) {
  if (value === null) {
    return null;
  }
  assertPlainObject(value, path);
  return {
    id: requireDecimalId(value.databaseId, `${path}.databaseId`),
    login: requireNonEmptyString(value.login, `${path}.login`),
    type: "User",
    node_id: requireNonEmptyString(value.id, `${path}.id`),
  };
}

function normalizeActor(value, path) {
  if (value === null) {
    return null;
  }
  assertPlainObject(value, path);
  return {
    id: requireDecimalId(value.id, `${path}.id`),
    login: requireNonEmptyString(value.login, `${path}.login`),
    type: requireNonEmptyString(value.type, `${path}.type`),
    node_id: requireNonEmptyString(value.node_id, `${path}.node_id`),
  };
}

function normalizeApp(value, path) {
  if (value === null || value === undefined) {
    return null;
  }
  assertPlainObject(value, path);
  return {
    id: requireDecimalId(value.id, `${path}.id`),
    slug: requireNonEmptyString(value.slug, `${path}.slug`),
    node_id: nullableNonEmptyString(value.node_id, `${path}.node_id`),
  };
}

function normalizeExpectedProviderActor(value) {
  assertClosedObject(value, "provider pre-scope expectedActor", [
    "id",
    "login",
    "type",
    "node_id",
  ]);
  const actor = normalizeActor(value, "provider pre-scope expectedActor");
  if (
    actor.login !== "chatgpt-codex-connector[bot]" ||
    actor.type !== "Bot"
  ) {
    throw new TypeError(
      "provider pre-scope expectedActor must identify the exact GitHub Codex bot",
    );
  }
  return actor;
}

function normalizeExpectedProviderApp(value) {
  assertClosedObject(value, "provider pre-scope expectedApp", [
    "id",
    "node_id",
    "slug",
  ]);
  const app = {
    id: requireDecimalId(value.id, "provider pre-scope expectedApp.id"),
    node_id: requireNonEmptyString(
      value.node_id,
      "provider pre-scope expectedApp.node_id",
    ),
    slug: requireNonEmptyString(value.slug, "provider pre-scope expectedApp.slug"),
  };
  if (app.slug !== SERVICE_START_APP_SLUG) {
    throw new TypeError(
      "provider pre-scope expectedApp must identify the exact GitHub Codex App",
    );
  }
  return app;
}

function normalizeTransportCapability(value, request, repoPath, restBaseUrl) {
  assertPlainObject(value, "repository permissions response");
  const fullName = requireNonEmptyString(
    value.full_name,
    "repository permissions response.full_name",
  );
  if (fullName.toLowerCase() !== `${request.owner}/${request.repo}`.toLowerCase()) {
    throw transportFailure(
      "REPOSITORY_IDENTITY_MISMATCH",
      `Repository permissions resolved ${fullName} instead of ${request.owner}/${request.repo}`,
    );
  }
  assertCanonicalApiUrl(
    value.url,
    repoPath,
    restBaseUrl,
    "repository permissions response.url",
  );
  assertPlainObject(value.permissions, "repository permissions response.permissions");
  return {
    capability_kind: "authenticated-transport-token",
    admin: requireBoolean(value.permissions.admin, "permissions.admin"),
    maintain: requireBoolean(value.permissions.maintain, "permissions.maintain"),
    push: requireBoolean(value.permissions.push, "permissions.push"),
    triage: requireBoolean(value.permissions.triage, "permissions.triage"),
    pull: requireBoolean(value.permissions.pull, "permissions.pull"),
    role_name: nullableNonEmptyString(value.role_name, "permissions.role_name"),
  };
}

function normalizeActorPermissionResponse(value, expectedActor, path) {
  assertPlainObject(value, path);
  const permission = requireEnum(
    value.permission,
    new Set(["admin", "write", "read", "none"]),
    `${path}.permission`,
  );
  const roleName = value.role_name === "" && permission === "none"
    ? ""
    : requireNonEmptyString(value.role_name, `${path}.role_name`);
  const responseActor = normalizeActor(value.user, `${path}.user`);
  if (
    responseActor.id !== expectedActor.id ||
    responseActor.node_id !== expectedActor.node_id ||
    responseActor.login !== expectedActor.login ||
    responseActor.type !== expectedActor.type
  ) {
    throw transportFailure(
      "PERMISSION_ACTOR_MISMATCH",
      `${path} actor did not exactly match the selected comment/review actor`,
      { expected: expectedActor, actual: responseActor },
    );
  }

  let permissions;
  let mappingSource;
  if (value.user.permissions !== undefined) {
    assertPlainObject(value.user.permissions, `${path}.user.permissions`);
    assertClosedObject(value.user.permissions, `${path}.user.permissions`, [
      "admin",
      "maintain",
      "push",
      "triage",
      "pull",
    ]);
    permissions = {
      admin: requireBoolean(value.user.permissions.admin, `${path}.user.permissions.admin`),
      maintain: requireBoolean(
        value.user.permissions.maintain,
        `${path}.user.permissions.maintain`,
      ),
      push: requireBoolean(value.user.permissions.push, `${path}.user.permissions.push`),
      triage: requireBoolean(value.user.permissions.triage, `${path}.user.permissions.triage`),
      pull: requireBoolean(value.user.permissions.pull, `${path}.user.permissions.pull`),
    };
    mappingSource = "user.permissions";
  } else {
    const writeOrHigher = permission === "admin" || permission === "write";
    const readOrHigher = permission !== "none";
    permissions = {
      admin: permission === "admin",
      maintain: permission === "admin" || permission === "write",
      push: writeOrHigher,
      triage: readOrHigher,
      pull: readOrHigher,
    };
    mappingSource = "legacy-permission";
  }
  if (
    roleName === "" &&
    Object.values(permissions).some((allowed) => allowed)
  ) {
    throw new TypeError(
      `${path}.user.permissions must all be false when permission is none and role_name is empty`,
    );
  }
  return {
    effective_permission: permission,
    role_name: roleName,
    permissions,
    mapping_source: mappingSource,
    permission_assurance: "point-in-time-only",
    request_time_permission: "unproven",
    permission_aba_excluded: false,
  };
}

function reconcilePermissionReceipts(pre, post) {
  if (!isDeepStrictEqual(
    permissionReceiptProjection(pre.transport_capability),
    permissionReceiptProjection(post.transport_capability),
  )) {
    throw transportFailure(
      "TRANSPORT_CAPABILITY_DRIFT",
      "Authenticated transport-token repository capabilities changed across the snapshot",
    );
  }
  if (pre.actor_permissions.length !== post.actor_permissions.length) {
    throw transportFailure(
      "ACTOR_PERMISSION_DRIFT",
      "Actor permission receipt count changed across the snapshot",
    );
  }
  const actorPermissions = pre.actor_permissions.map((preReceipt, index) => {
    const postReceipt = post.actor_permissions[index];
    if (!isDeepStrictEqual(
      permissionReceiptProjection(preReceipt),
      permissionReceiptProjection(postReceipt),
    )) {
      throw transportFailure(
        "ACTOR_PERMISSION_DRIFT",
        `Actor permission for ${preReceipt.subject.kind}:${preReceipt.subject.id} ` +
          "changed across the snapshot",
      );
    }
    return {
      subject: preReceipt.subject,
      actor: preReceipt.actor,
      assurance: "point-in-time-only",
      request_time_permission: "unproven",
      permission_aba_excluded: false,
      stable: true,
      pre: preReceipt,
      post: postReceipt,
    };
  });
  return {
    transport_capabilities: {
      stable: true,
      pre: pre.transport_capability,
      post: post.transport_capability,
    },
    actor_permissions: actorPermissions,
  };
}

function permissionReceiptProjection(receipt) {
  const {
    response_server_time: _serverTime,
    raw_body_sha256: _rawDigest,
    ...projection
  } = receipt;
  return projection;
}

function normalizeThreadNode(value, path, pageSize) {
  const identity = normalizeThreadIdentity(value, path);
  const connection = normalizeConnection(value.comments, `${path}.comments`, pageSize);
  return {
    ...identity,
    comments: connection.nodes.map((comment, index) =>
      normalizeThreadComment(comment, `${path}.comments.nodes[${index}]`)),
  };
}

function normalizeThreadIdentity(value, path) {
  assertPlainObject(value, path);
  return {
    id: requireNonEmptyString(value.id, `${path}.id`),
    is_resolved: requireBoolean(value.isResolved, `${path}.isResolved`),
    is_outdated: requireBoolean(value.isOutdated, `${path}.isOutdated`),
    path: nullableNonEmptyString(value.path, `${path}.path`),
    line: nullableInteger(value.line, `${path}.line`),
    start_line: nullableInteger(value.startLine, `${path}.startLine`),
    diff_side: nullableEnum(value.diffSide, DIFF_SIDES, `${path}.diffSide`),
    start_diff_side: nullableEnum(
      value.startDiffSide,
      DIFF_SIDES,
      `${path}.startDiffSide`,
    ),
  };
}

function threadIdentity(thread) {
  return {
    id: thread.id,
    is_resolved: thread.is_resolved,
    is_outdated: thread.is_outdated,
    path: thread.path,
    line: thread.line,
    start_line: thread.start_line,
    diff_side: thread.diff_side,
    start_diff_side: thread.start_diff_side,
  };
}

function normalizeThreadComment(value, path) {
  assertPlainObject(value, path);
  return {
    id: requireNonEmptyString(value.id, `${path}.id`),
    database_id: requireDecimalId(value.fullDatabaseId, `${path}.fullDatabaseId`),
  };
}

function validateThreadCommentClosure(threads, inlineComments) {
  const restIds = new Set(inlineComments.map((comment) => comment.id));
  const seenDatabaseIds = new Set();
  for (const thread of threads) {
    for (const comment of thread.comments) {
      if (seenDatabaseIds.has(comment.database_id)) {
        throw transportFailure(
          "DUPLICATE_ITEM",
          `GraphQL review threads repeated database id ${comment.database_id}`,
        );
      }
      seenDatabaseIds.add(comment.database_id);
      if (!restIds.has(comment.database_id)) {
        throw transportFailure(
          "THREAD_COMMENT_NOT_IN_REST_SNAPSHOT",
          `GraphQL review-thread comment ${comment.database_id} was absent from the ` +
            "complete REST inline-comment pages",
        );
      }
    }
  }
}

function normalizeConnection(value, path, pageSize) {
  assertPlainObject(value, path);
  if (!Array.isArray(value.nodes)) {
    throw transportFailure("INVALID_RESPONSE_SCHEMA", `${path}.nodes must be an array`);
  }
  if (value.nodes.length > pageSize) {
    throw transportFailure(
      "INVALID_RESPONSE_SCHEMA",
      `${path}.nodes exceeded the requested page size ${pageSize}`,
    );
  }
  return {
    nodes: value.nodes,
    pageInfo: normalizePageInfo(value.pageInfo, `${path}.pageInfo`),
  };
}

function normalizePageInfo(value, path) {
  assertPlainObject(value, path);
  const hasNextPage = requireBoolean(value.hasNextPage, `${path}.hasNextPage`);
  const endCursor = nullableNonEmptyString(value.endCursor, `${path}.endCursor`);
  if (hasNextPage && endCursor === null) {
    throw transportFailure(
      "INVALID_RESPONSE_SCHEMA",
      `${path}.endCursor is required when hasNextPage is true`,
    );
  }
  return { hasNextPage, endCursor };
}

function nextCursor(pageInfo, previous, label) {
  const cursor = pageInfo.endCursor;
  if (cursor === null || cursor === previous) {
    throw transportFailure(
      "PAGINATION_CURSOR_INVALID",
      `${label} did not provide a new non-null pagination cursor`,
    );
  }
  return cursor;
}

function parseAndValidatePaginationLink(
  header,
  restBaseUrl,
  path,
  page,
  pageSize,
  maxPages,
  label,
  fixedQuery = {},
) {
  if (header === null || header === "") {
    return { nextPage: null, lastPage: null };
  }
  if (typeof header !== "string" || header.length > 8_192) {
    throw transportFailure(
      "INVALID_PAGINATION_LINK",
      `${label} returned an invalid Link header`,
    );
  }
  const entries = header.split(",");
  if (entries.length > 4) {
    throw transportFailure(
      "INVALID_PAGINATION_LINK",
      `${label} returned an ambiguous Link header`,
    );
  }
  const relations = new Map();
  for (const entry of entries) {
    const match = entry.trim().match(
      /^<([^<>\u0000-\u0020\u007f]+)>; rel="(next|prev|first|last)"$/u,
    );
    if (match === null || relations.has(match[2])) {
      throw transportFailure(
        "INVALID_PAGINATION_LINK",
        `${label} returned a malformed, unknown, or duplicate Link relation`,
      );
    }
    const relation = match[2];
    let target;
    try {
      target = new URL(match[1]);
    } catch (error) {
      throw transportFailure(
        "INVALID_PAGINATION_LINK",
        `${label} returned an invalid Link target`,
        null,
        error,
      );
    }
    const pageValues = target.searchParams.getAll("page");
    if (pageValues.length !== 1 || !/^[1-9][0-9]*$/u.test(pageValues[0])) {
      throw transportFailure(
        "INVALID_PAGINATION_LINK",
        `${label} Link relation omitted one canonical page`,
      );
    }
    const targetPage = Number(pageValues[0]);
    if (!Number.isSafeInteger(targetPage) || targetPage > maxPages) {
      throw transportFailure(
        "PAGE_LIMIT_EXCEEDED",
        `${label} Link relation exceeded the ${maxPages}-page cap`,
      );
    }
    const expected = apiUrl(restBaseUrl, path);
    for (const [key, value] of Object.entries(fixedQuery)) {
      expected.searchParams.set(key, String(value));
    }
    expected.searchParams.set("per_page", String(pageSize));
    expected.searchParams.set("page", String(targetPage));
    const expectedParameters = [...expected.searchParams.entries()].sort(compareEntries);
    const actualParameters = [...target.searchParams.entries()].sort(compareEntries);
    if (
      target.origin !== expected.origin ||
      target.pathname !== expected.pathname ||
      target.username !== "" ||
      target.password !== "" ||
      target.hash !== "" ||
      !isDeepStrictEqual(actualParameters, expectedParameters)
    ) {
      throw transportFailure(
        "INVALID_PAGINATION_LINK",
        `${label} Link relation left its canonical pagination scope`,
        { expected: expected.href, actual: target.href },
      );
    }
    if (
      (relation === "next" && targetPage !== page + 1) ||
      (relation === "prev" && (page === 1 || targetPage !== page - 1)) ||
      (relation === "first" && targetPage !== 1) ||
      (relation === "last" && targetPage < page)
    ) {
      throw transportFailure(
        "INVALID_PAGINATION_LINK",
        `${label} Link relation targeted the wrong page`,
      );
    }
    relations.set(relation, targetPage);
  }
  const nextPage = relations.get("next") ?? null;
  const lastPage = relations.get("last") ?? null;
  if (
    (nextPage === null && lastPage !== null && lastPage > page) ||
    (nextPage !== null && lastPage !== null && lastPage < nextPage)
  ) {
    throw transportFailure(
      "INVALID_PAGINATION_LINK",
      `${label} Link relations disagreed about later pages`,
    );
  }
  return { nextPage, lastPage };
}

function compareEntries(left, right) {
  return left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]);
}

function compareDecimalIds(left, right) {
  const leftId = BigInt(left);
  const rightId = BigInt(right);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function compareDecimalIdObjects(left, right) {
  return compareDecimalIds(left.id, right.id);
}

function normalizeSnapshotRequest(value) {
  assertClosedObject(value, "snapshot request", [
    "owner",
    "repo",
    "pullNumber",
    "artifactSelectors",
    "permissionSubjects",
  ], { optional: true });
  const owner = requireCanonicalOwner(value.owner, "snapshot request.owner");
  const repo = requireCanonicalRepositoryName(value.repo, "snapshot request.repo");
  if (!Number.isSafeInteger(value.pullNumber) || value.pullNumber <= 0) {
    throw new TypeError("snapshot request.pullNumber must be a positive safe integer");
  }
  const selectors = value.artifactSelectors ?? [];
  if (!Array.isArray(selectors)) {
    throw new TypeError("snapshot request.artifactSelectors must be an array");
  }
  const normalizedSelectors = selectors.map(normalizeArtifactSelector);
  validateUniqueSelectorKeys(normalizedSelectors);
  const permissionSubjects = value.permissionSubjects ?? [];
  if (!Array.isArray(permissionSubjects)) {
    throw new TypeError("snapshot request.permissionSubjects must be an array");
  }
  const normalizedPermissionSubjects = permissionSubjects.map(normalizeArtifactSelector);
  validateUniqueSelectorKeys(normalizedPermissionSubjects);
  const exactSelectorKeys = new Set(
    normalizedSelectors.map((selector) => `${selector.kind}:${selector.id}`),
  );
  for (const subject of normalizedPermissionSubjects) {
    const key = `${subject.kind}:${subject.id}`;
    if (!exactSelectorKeys.has(key)) {
      throw new TypeError(
        `snapshot request permission subject ${key} must also be an artifact selector`,
      );
    }
  }
  return {
    owner,
    repo,
    pullNumber: value.pullNumber,
    artifactSelectors: normalizedSelectors,
    permissionSubjects: normalizedPermissionSubjects,
  };
}

function requireCanonicalOwner(value, path) {
  const owner = requireNonEmptyString(value, path);
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)) {
    throw new TypeError(`${path} is not a canonical GitHub owner name`);
  }
  return owner;
}

function requireCanonicalRepositoryName(value, path) {
  const repo = requireNonEmptyString(value, path);
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(repo) || repo === "." || repo === "..") {
    throw new TypeError(`${path} is not a canonical GitHub repository name`);
  }
  return repo;
}

function normalizeArtifactSelector(value, index) {
  assertClosedObject(value, `artifactSelectors[${index}]`, ["kind", "id"]);
  const aliases = new Map([
    ["issue_comment", "issue_comment"],
    ["pull_request_review", "pull_request_review"],
    ["review", "pull_request_review"],
    ["inline_comment", "inline_comment"],
    ["review_comment", "inline_comment"],
  ]);
  const kind = aliases.get(value.kind);
  if (!kind) {
    throw new TypeError(
      `artifactSelectors[${index}].kind must be issue_comment, ` +
        "pull_request_review, or inline_comment",
    );
  }
  return { kind, id: requireDecimalId(value.id, `artifactSelectors[${index}].id`) };
}

function validateUniqueSelectorKeys(selectors) {
  const seen = new Set();
  for (const selector of selectors) {
    const key = `${selector.kind}:${selector.id}`;
    if (seen.has(key)) {
      throw new TypeError(`snapshot request repeated artifact selector ${key}`);
    }
    seen.add(key);
  }
}

function normalizeLimits(value) {
  if (value === undefined) {
    return { ...V2_TRANSPORT_DEFAULT_LIMITS };
  }
  assertClosedObject(value, "transport limits", Object.keys(V2_TRANSPORT_DEFAULT_LIMITS), {
    optional: true,
  });
  const result = { ...V2_TRANSPORT_DEFAULT_LIMITS, ...value };
  for (const [key, limit] of Object.entries(result)) {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new TypeError(`transport limits.${key} must be a positive safe integer`);
    }
  }
  if (result.page_size > 100) {
    throw new TypeError("transport limits.page_size cannot exceed GitHub's 100-item maximum");
  }
  if (result.max_artifact_selectors > result.max_items) {
    throw new TypeError("max_artifact_selectors cannot exceed max_items");
  }
  return result;
}

function normalizeServiceUrl(value, label, { allowPath = false } = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${label} must be an absolute URL`);
  }
  const localHttp = url.protocol === "http:" &&
    new Set(["localhost", "127.0.0.1", "::1"]).has(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new TypeError(`${label} must use HTTPS (or loopback HTTP for local tests)`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError(`${label} cannot contain credentials, a query, or a fragment`);
  }
  if (!allowPath && url.pathname !== "/" && url.pathname !== "") {
    url.pathname = url.pathname.replace(/\/$/, "");
  } else {
    url.pathname = url.pathname.replace(/\/$/, "");
  }
  return url.href.replace(/\/$/, "");
}

function defaultGraphqlUrl(restBaseUrl) {
  const rest = new URL(restBaseUrl);
  if (rest.hostname === "api.github.com" && (rest.pathname === "/" || rest.pathname === "")) {
    return "https://api.github.com/graphql";
  }
  if (rest.pathname.endsWith("/api/v3")) {
    rest.pathname = rest.pathname.slice(0, -"/v3".length) + "/graphql";
    return rest.href;
  }
  rest.pathname = `${rest.pathname.replace(/\/$/, "")}/graphql`;
  return rest.href;
}

function repositoryPath(owner, repo) {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function apiUrl(restBaseUrl, path) {
  const base = restBaseUrl.replace(/\/$/, "");
  return new URL(`${base}${path}`);
}

function assertCanonicalApiUrl(value, path, restBaseUrl, label) {
  const actual = requireAbsoluteUrl(value, label);
  const expected = apiUrl(restBaseUrl, path).href;
  if (actual !== expected) {
    throw transportFailure(
      "NONCANONICAL_ARTIFACT_URL",
      `${label} was not the canonical current-repository API URL`,
      { expected, actual },
    );
  }
}

function requireCanonicalGitHubArtifactUrl(
  value,
  context,
  fragmentKind,
  id,
  label,
) {
  const expected =
    `https://github.com/${encodeURIComponent(context.owner)}/` +
    `${encodeURIComponent(context.repo)}/pull/${context.pullNumber}` +
    (fragmentKind === "discussion_r"
      ? `#discussion_r${id}`
      : `#${fragmentKind}-${id}`);
  if (value !== expected) {
    throw transportFailure(
      "NONCANONICAL_ARTIFACT_HTML_URL",
      `${label} does not bind the current repository, pull request, kind, and database id`,
      { expected, actual: value },
    );
  }
  return value;
}

function normalizeServerDate(value, label) {
  if (typeof value !== "string" || !HTTP_DATE_PATTERN.test(value)) {
    throw transportFailure(
      "MISSING_SERVER_DATE",
      `${label} response omitted a canonical HTTP Date header`,
    );
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw transportFailure("INVALID_SERVER_DATE", `${label} returned an invalid Date header`);
  }
  return new Date(milliseconds).toISOString();
}

function parseContentLength(value, label) {
  if (value === null) {
    return null;
  }
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw transportFailure(
      "INVALID_CONTENT_LENGTH",
      `${label} returned an invalid Content-Length header`,
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw transportFailure(
      "INVALID_CONTENT_LENGTH",
      `${label} returned an unsafe Content-Length header`,
    );
  }
  return parsed;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function latestServerTime(values) {
  const present = values.filter((value) => value !== null && value !== undefined);
  if (present.length === 0) {
    throw transportFailure("MISSING_SERVER_DATE", "Scope receipt had no GitHub server Date");
  }
  return present.reduce((latest, value) =>
    Date.parse(value) > Date.parse(latest) ? value : latest);
}

function scopeEndpointReceipt(method, path, response) {
  return {
    method,
    path,
    status: response.status,
    server_time: response.serverTime,
    raw_body_sha256: response.bodySha256,
  };
}

function scopeFromReceipt(receipt) {
  return {
    base_ref_name: receipt.base_ref_name,
    base_ref_tip: receipt.base_ref_tip,
    head_ref_name: receipt.head_ref_name,
    head_ref_oid: receipt.head_ref_oid,
    merge_base_sha: receipt.merge_base_sha,
    potential_merge_oid: receipt.potential_merge_oid,
    potential_merge_tree: receipt.potential_merge_tree,
    ordered_parent_oids: [...receipt.ordered_parent_oids],
    merge_ref_oid: receipt.merge_ref_oid,
    mergeable: receipt.mergeable,
  };
}

function scopeStabilityProjection(receipt) {
  const {
    server_time: _serverTime,
    endpoint_receipts: _endpointReceipts,
    ...stable
  } = receipt;
  return stable;
}

function serviceStartStabilityProjection(receipt) {
  const { server_time: _serverTime, page_receipts: pageReceipts, ...stable } = receipt;
  return {
    ...stable,
    page_receipts: pageReceipts.map(({ response_server_time: _responseTime, ...page }) => page),
  };
}

export function validateStatusTarget(
  snapshot,
  mode = "test-merge-with-head-sentinel",
) {
  assertV2Snapshot(snapshot);
  if (!new Set(["head", "test-merge-with-head-sentinel"]).has(mode)) {
    throw new TypeError("status target mode is not closed");
  }
  const blocked = (blockedReason) => ({ validated: false, blocked_reason: blockedReason });
  if (![
    "all_pages_loaded",
    "issue_comments",
    "reviews",
    "inline_comments",
    "threads",
    "reactions",
    "permissions",
    "exact_artifacts",
    "service_start_observations",
  ].every((key) => snapshot.completeness[key] === true)) {
    return blocked("snapshot-incomplete");
  }
  if (snapshot.completeness.server_date_headers !== snapshot.completeness.request_count) {
    return blocked("server-date-coverage-incomplete");
  }
  if (!snapshot.stability.scope_stable) {
    return blocked("scope-not-stable");
  }
  if (!snapshot.stability.server_time_monotonic) {
    return blocked("server-time-not-monotonic");
  }
  if (!isDeepStrictEqual(
    scopeStabilityProjection(snapshot.scope_receipts.pre),
    scopeStabilityProjection(snapshot.scope_receipts.post),
  )) {
    return blocked("scope-receipt-mismatch");
  }
  if (!isDeepStrictEqual(snapshot.scope, scopeFromReceipt(snapshot.scope_receipts.post))) {
    return blocked("scope-summary-mismatch");
  }
  const post = snapshot.scope_receipts.post;
  if (
    snapshot.repository.owner !== post.repository_owner ||
    snapshot.repository.name !== post.repository_name ||
    snapshot.repository.node_id !== post.repository_node_id ||
    snapshot.pull_request.number !== post.pull_request_number ||
    snapshot.pull_request.node_id !== post.pull_request_node_id ||
    snapshot.pull_request.state !== post.pull_request_state ||
    snapshot.pull_request.merged !== post.pull_request_merged ||
    snapshot.pull_request.merged_at !== post.pull_request_merged_at ||
    snapshot.pull_request.is_draft !== post.pull_request_is_draft ||
    Date.parse(snapshot.server_time) < Date.parse(post.server_time)
  ) {
    return blocked("identity-summary-mismatch");
  }
  if (snapshot.pull_request.state !== "OPEN") {
    return blocked("pull-request-not-open");
  }
  if (snapshot.pull_request.merged) {
    return blocked("pull-request-merged");
  }
  if (snapshot.pull_request.merged_at !== null) {
    return blocked("pull-request-merged-at-present");
  }
  if (mode === "head") {
    return {
      mode,
      head_sentinel_sha: null,
      terminal_sha: snapshot.scope.head_ref_oid,
      validated: true,
    };
  }
  if (snapshot.scope.mergeable !== "MERGEABLE") {
    return blocked("pull-request-not-mergeable");
  }
  if (snapshot.scope.base_ref_tip === null) {
    return blocked("live-base-ref-unavailable");
  }
  if (snapshot.scope.head_ref_oid === null) {
    return blocked("head-ref-unavailable");
  }
  if (snapshot.scope.merge_base_sha === null) {
    return blocked("merge-base-unavailable");
  }
  if (snapshot.scope.potential_merge_oid === null) {
    return blocked("potential-merge-unavailable");
  }
  if (snapshot.scope.potential_merge_tree === null) {
    return blocked("potential-merge-tree-unavailable");
  }
  if (snapshot.scope.ordered_parent_oids.length !== 2) {
    return blocked("potential-merge-parent-count-invalid");
  }
  if (
    snapshot.scope.ordered_parent_oids[0] !== snapshot.scope.base_ref_tip ||
    snapshot.scope.ordered_parent_oids[1] !== snapshot.scope.head_ref_oid
  ) {
    return blocked("potential-merge-parent-order-mismatch");
  }
  if (
    snapshot.scope.potential_merge_oid === snapshot.scope.base_ref_tip ||
    snapshot.scope.potential_merge_oid === snapshot.scope.head_ref_oid
  ) {
    return blocked("potential-merge-equals-parent");
  }
  if (snapshot.scope.merge_ref_oid === null) {
    return blocked("merge-ref-unavailable");
  }
  if (snapshot.scope.merge_ref_oid !== snapshot.scope.potential_merge_oid) {
    return blocked("merge-ref-potential-merge-mismatch");
  }
  return {
    mode: "test-merge-with-head-sentinel",
    head_sentinel_sha: snapshot.scope.head_ref_oid,
    terminal_sha: snapshot.scope.potential_merge_oid,
    validated: true,
  };
}

export function getExactArtifact(snapshot, selector) {
  assertV2Snapshot(snapshot);
  const normalized = normalizeArtifactSelector(selector, "selector");
  const match = snapshot.pages.exact_artifacts.find((entry) =>
    entry.selector.kind === normalized.kind && entry.selector.id === normalized.id);
  if (!match) {
    throw new V2TransportError(
      "EXACT_ARTIFACT_NOT_LOADED",
      `Snapshot does not contain exact ${normalized.kind} ${normalized.id}`,
    );
  }
  return match;
}

/**
 * Require the exact immutable object returned by the one-GET provider loader.
 * A structured clone or a plain reconstruction preserves audit data but never
 * regains the in-process authority carried by the WeakMap binding.
 */
export function assertV2ProviderPreScopeArtifactHandle(value, expected) {
  assertExactArtifactEntry(value, "provider pre-scope artifact handle");
  assertClosedObject(expected, "provider pre-scope expected binding", [
    "repository",
    "scope",
    "expected_provider",
  ], { optional: true });
  for (const key of ["repository", "scope"]) {
    if (!Object.hasOwn(expected, key)) {
      throw new TypeError(`provider pre-scope expected binding is missing required key ${key}`);
    }
  }
  assertClosedObject(expected.repository, "provider pre-scope expected repository", [
    "owner",
    "name",
  ]);
  const repository = {
    owner: requireCanonicalOwner(
      expected.repository.owner,
      "provider pre-scope expected repository.owner",
    ),
    name: requireCanonicalRepositoryName(
      expected.repository.name,
      "provider pre-scope expected repository.name",
    ),
  };
  assertClosedObject(expected.scope, "provider pre-scope expected scope", [
    "pull_request",
    "head_ref_oid",
  ]);
  assertClosedObject(
    expected.scope.pull_request,
    "provider pre-scope expected scope.pull_request",
    ["number"],
  );
  if (
    !Number.isSafeInteger(expected.scope.pull_request.number) ||
    expected.scope.pull_request.number <= 0
  ) {
    throw new TypeError(
      "provider pre-scope expected scope.pull_request.number must be a positive safe integer",
    );
  }
  const scope = {
    pull_request: { number: expected.scope.pull_request.number },
    head_ref_oid: requireSha(
      expected.scope.head_ref_oid,
      "provider pre-scope expected scope.head_ref_oid",
    ),
  };
  let provider;
  if (Object.hasOwn(expected, "expected_provider")) {
    assertClosedObject(
      expected.expected_provider,
      "provider pre-scope expected provider",
      ["actor", "app"],
    );
    provider = {
      actor: normalizeExpectedProviderActor(expected.expected_provider.actor),
      app: normalizeExpectedProviderApp(expected.expected_provider.app),
    };
  }

  const binding = PROVIDER_PRE_SCOPE_BINDINGS.get(value);
  if (binding === undefined) {
    throw transportFailure(
      "UNTRUSTED_PROVIDER_PRE_SCOPE_ARTIFACT_HANDLE",
      "Provider pre-scope authority must come directly from the one-GET loader",
    );
  }
  if (!isDeepFrozen(value) || !isDeepFrozen(binding)) {
    throw transportFailure(
      "UNSEALED_PROVIDER_PRE_SCOPE_ARTIFACT_HANDLE",
      "Provider pre-scope handle and its binding must remain deeply frozen",
    );
  }
  const boundRepository = { owner: binding.owner, name: binding.repo };
  const boundScope = {
    pull_request: { number: binding.pull_number },
    head_ref_oid: binding.head_sha,
  };
  if (
    !isDeepStrictEqual(repository, expected.repository) ||
    !isDeepStrictEqual(scope, expected.scope) ||
    !isDeepStrictEqual(repository, boundRepository) ||
    !isDeepStrictEqual(scope, boundScope)
  ) {
    throw transportFailure(
      "PROVIDER_PRE_SCOPE_HANDLE_BINDING_MISMATCH",
      "Provider pre-scope repository or scope differs from its sealed binding",
    );
  }
  if (
    provider !== undefined &&
    (
      !isDeepStrictEqual(provider, expected.expected_provider) ||
      !isDeepStrictEqual(provider, {
        actor: binding.expected_actor,
        app: binding.expected_app,
      })
    )
  ) {
    throw transportFailure(
      "PROVIDER_PRE_SCOPE_HANDLE_PROVIDER_MISMATCH",
      "Provider pre-scope identity differs from its sealed binding",
    );
  }
  return value;
}

export function assertV2ProviderPreScopeArtifactEqualsSnapshot(
  preScopeArtifact,
  snapshot,
) {
  assertExactArtifactEntry(preScopeArtifact, "provider pre-scope artifact");
  const binding = PROVIDER_PRE_SCOPE_BINDINGS.get(preScopeArtifact);
  if (binding === undefined) {
    throw transportFailure(
      "PROVIDER_PRE_SCOPE_BINDING_MISSING",
      "Provider pre-scope artifact is not the exact object returned by its protected read",
    );
  }
  assertTransportSnapshotHandleBinding(snapshot, {
    repository: { owner: binding.owner, name: binding.repo },
    pull_request_number: binding.pull_number,
    head_ref_oid: binding.head_sha,
  });
  const snapshotArtifact = getExactArtifact(snapshot, preScopeArtifact.selector);
  if (
    snapshot.repository.owner !== binding.owner ||
    snapshot.repository.name !== binding.repo ||
    snapshot.pull_request.number !== binding.pull_number ||
    snapshot.scope.head_ref_oid !== binding.head_sha
  ) {
    throw transportFailure(
      "PROVIDER_PRE_SCOPE_SCOPE_MISMATCH",
      "Full snapshot repository, pull request, or head differs from provider pre-scope",
    );
  }
  if (
    !isDeepStrictEqual(preScopeArtifact.artifact.author, binding.expected_actor) ||
    !isDeepStrictEqual(preScopeArtifact.artifact.app, binding.expected_app)
  ) {
    throw transportFailure(
      "PROVIDER_PRE_SCOPE_IDENTITY_MISMATCH",
      "Provider pre-scope artifact no longer equals its exact actor and App binding",
    );
  }
  if (
    Date.parse(snapshotArtifact.response_server_time) <
      Date.parse(preScopeArtifact.response_server_time)
  ) {
    throw transportFailure(
      "PROVIDER_ARTIFACT_SERVER_TIME_REGRESSED",
      "Full snapshot exact artifact predates its provider pre-scope read",
    );
  }
  if (
    !isDeepStrictEqual(preScopeArtifact.selector, snapshotArtifact.selector) ||
    !isDeepStrictEqual(preScopeArtifact.artifact, snapshotArtifact.artifact) ||
    preScopeArtifact.raw_body_sha256 !== snapshotArtifact.raw_body_sha256
  ) {
    throw transportFailure(
      "PROVIDER_ARTIFACT_CHANGED",
      "Provider artifact changed between its pre-scope read and the complete snapshot",
    );
  }
  const commitId = preScopeArtifact.artifact.commit_id;
  if (
    commitId !== undefined && commitId !== null &&
    commitId !== snapshot.scope.head_ref_oid
  ) {
    throw transportFailure(
      "PROVIDER_ARTIFACT_HEAD_MISMATCH",
      "Provider artifact commit does not equal the complete snapshot head",
      { expected: snapshot.scope.head_ref_oid, actual: commitId },
    );
  }
  return true;
}

/**
 * Require the exact full snapshot object returned by this module's live
 * transport and bind it to one complete protected-ledger PR scope. A clone or
 * caller-constructed structural equivalent never regains this authority.
 */
export function assertV2TransportSnapshotHandle(value, expected) {
  assertClosedObject(expected, "transport snapshot expected binding", [
    "repository",
    "scope",
  ]);
  assertClosedObject(expected.repository, "transport snapshot expected repository", [
    "owner",
    "name",
  ]);
  assertClosedObject(expected.scope, "transport snapshot expected scope", [
    "pull_request",
    "head_ref_oid",
    "base_ref_oid",
    "potential_merge_commit_oid",
  ]);
  assertClosedObject(
    expected.scope.pull_request,
    "transport snapshot expected scope.pull_request",
    ["number", "node_id"],
  );
  if (
    !Number.isSafeInteger(expected.scope.pull_request.number) ||
    expected.scope.pull_request.number <= 0
  ) {
    throw new TypeError(
      "transport snapshot expected pull request number must be a positive safe integer",
    );
  }
  const pullNodeId = requireNonEmptyString(
    expected.scope.pull_request.node_id,
    "transport snapshot expected pull request node id",
  );
  if (pullNodeId.length > 256) {
    throw new TypeError("transport snapshot expected pull request node id is too long");
  }
  const normalized = {
    repository: {
      owner: requireCanonicalOwner(
        expected.repository.owner,
        "transport snapshot expected repository.owner",
      ),
      name: requireCanonicalRepositoryName(
        expected.repository.name,
        "transport snapshot expected repository.name",
      ),
    },
    scope: {
      pull_request: {
        number: expected.scope.pull_request.number,
        node_id: pullNodeId,
      },
      head_ref_oid: requireSha(
        expected.scope.head_ref_oid,
        "transport snapshot expected scope.head_ref_oid",
      ),
      base_ref_oid: requireSha(
        expected.scope.base_ref_oid,
        "transport snapshot expected scope.base_ref_oid",
      ),
      potential_merge_commit_oid: nullableSha(
        expected.scope.potential_merge_commit_oid,
        "transport snapshot expected scope.potential_merge_commit_oid",
      ),
    },
  };
  const binding = assertTransportSnapshotHandleBinding(value);
  const boundScope = {
    repository: binding.repository,
    scope: binding.scope,
  };
  if (
    !isDeepStrictEqual(normalized, expected) ||
    !isDeepStrictEqual(normalized, boundScope)
  ) {
    throw transportFailure(
      "TRANSPORT_SNAPSHOT_HANDLE_BINDING_MISMATCH",
      "Full transport snapshot repository or PR scope differs from its sealed binding",
    );
  }
  return value;
}

/**
 * Project one branded snapshot and its private effective HTTP limits into the
 * trusted Git-ledger assembler. Public snapshot bytes intentionally omit the
 * limits so a caller cannot forge a more permissive authority profile.
 */
export function projectV2TransportSnapshotForGitLedger(value, expected) {
  const snapshot = assertV2TransportSnapshotHandle(value, expected);
  const binding = assertTransportSnapshotHandleBinding(snapshot);
  const effectiveLimits = binding.effective_limits;
  assertClosedObject(
    effectiveLimits,
    "transport snapshot effective limits",
    Object.keys(V2_TRANSPORT_DEFAULT_LIMITS),
  );
  for (const [key, productionLimit] of
    Object.entries(V2_TRANSPORT_DEFAULT_LIMITS)) {
    const effective = effectiveLimits[key];
    if (!Number.isSafeInteger(effective) || effective <= 0 ||
        effective > productionLimit) {
      throw transportFailure(
        "TRANSPORT_LIMITS_RELAXED",
        `Full transport snapshot limit ${key} exceeds its production authority cap`,
      );
    }
  }
  if (
    effectiveLimits.page_size > 100 ||
    effectiveLimits.max_artifact_selectors > effectiveLimits.max_items
  ) {
    throw transportFailure(
      "TRANSPORT_LIMITS_RELAXED",
      "Full transport snapshot effective limits violate their closed relationships",
    );
  }
  return deepFreeze({
    snapshot,
    effective_limits: structuredClone(effectiveLimits),
  });
}

function assertTransportSnapshotHandleBinding(value, expectedIdentity = null) {
  const binding = TRANSPORT_SNAPSHOT_BINDINGS.get(value);
  if (binding === undefined) {
    throw transportFailure(
      "UNTRUSTED_TRANSPORT_SNAPSHOT_HANDLE",
      "Full transport authority must come directly from the live snapshot loader",
    );
  }
  if (!isDeepFrozen(value) || !isDeepFrozen(binding)) {
    throw transportFailure(
      "UNSEALED_TRANSPORT_SNAPSHOT_HANDLE",
      "Full transport snapshot handle and its binding must remain deeply frozen",
    );
  }
  if (expectedIdentity !== null && (
    binding.repository.owner !== expectedIdentity.repository.owner ||
    binding.repository.name !== expectedIdentity.repository.name ||
    binding.scope.pull_request.number !== expectedIdentity.pull_request_number ||
    binding.scope.head_ref_oid !== expectedIdentity.head_ref_oid
  )) {
    throw transportFailure(
      "TRANSPORT_SNAPSHOT_HANDLE_BINDING_MISMATCH",
      "Full transport snapshot differs from the pre-scope repository, PR, or head",
    );
  }
  return binding;
}

function transportSnapshotAuthorityBinding(snapshot) {
  return {
    repository: {
      owner: snapshot.repository.owner,
      name: snapshot.repository.name,
    },
    scope: {
      pull_request: {
        number: snapshot.pull_request.number,
        node_id: snapshot.pull_request.node_id,
      },
      head_ref_oid: snapshot.scope.head_ref_oid,
      base_ref_oid: snapshot.scope.base_ref_tip,
      potential_merge_commit_oid: snapshot.scope.potential_merge_oid,
    },
  };
}

export function assertV2Snapshot(snapshot) {
  assertClosedObject(snapshot, "snapshot", [
    "schema_version",
    "repository",
    "pull_request",
    "server_time",
    "scope",
    "pages",
    "permissions",
    "service_start_observations",
    "scope_receipts",
    "completeness",
    "stability",
  ]);
  if (snapshot.schema_version !== V2_GITHUB_SNAPSHOT_SCHEMA_VERSION) {
    throw new TypeError("snapshot.schema_version must be 2");
  }
  assertClosedObject(snapshot.repository, "snapshot.repository", ["owner", "name", "node_id"]);
  requireNonEmptyString(snapshot.repository.owner, "snapshot.repository.owner");
  requireNonEmptyString(snapshot.repository.name, "snapshot.repository.name");
  requireNonEmptyString(snapshot.repository.node_id, "snapshot.repository.node_id");
  assertClosedObject(snapshot.pull_request, "snapshot.pull_request", [
    "number",
    "node_id",
    "state",
    "merged",
    "merged_at",
    "is_draft",
  ]);
  if (!Number.isSafeInteger(snapshot.pull_request.number) || snapshot.pull_request.number <= 0) {
    throw new TypeError("snapshot.pull_request.number must be a positive safe integer");
  }
  requireNonEmptyString(snapshot.pull_request.node_id, "snapshot.pull_request.node_id");
  requireEnum(snapshot.pull_request.state, PULL_REQUEST_STATES, "snapshot.pull_request.state");
  requireBoolean(snapshot.pull_request.merged, "snapshot.pull_request.merged");
  nullableTimestamp(snapshot.pull_request.merged_at, "snapshot.pull_request.merged_at");
  requireBoolean(snapshot.pull_request.is_draft, "snapshot.pull_request.is_draft");
  if (
    snapshot.pull_request.merged !== (snapshot.pull_request.merged_at !== null) ||
    snapshot.pull_request.merged !== (snapshot.pull_request.state === "MERGED")
  ) {
    throw new TypeError("snapshot.pull_request lifecycle fields are inconsistent");
  }
  requireTimestamp(snapshot.server_time, "snapshot.server_time");
  assertScope(snapshot.scope, "snapshot.scope");
  assertPages(snapshot.pages, "snapshot.pages");
  assertArtifactHtmlScope(
    snapshot.pages,
    snapshot.repository,
    snapshot.pull_request.number,
  );
  assertPageRelations(snapshot.pages, snapshot.server_time);
  assertPermissions(
    snapshot.permissions,
    "snapshot.permissions",
    snapshot.pages.exact_artifacts,
  );
  assertServiceStartObservations(
    snapshot.service_start_observations,
    snapshot.scope.head_ref_oid,
    snapshot.server_time,
    "snapshot.service_start_observations",
  );
  assertClosedObject(snapshot.scope_receipts, "snapshot.scope_receipts", ["pre", "post"]);
  assertScopeReceipt(snapshot.scope_receipts.pre, "snapshot.scope_receipts.pre");
  assertScopeReceipt(snapshot.scope_receipts.post, "snapshot.scope_receipts.post");
  assertClosedObject(snapshot.completeness, "snapshot.completeness", [
    "all_pages_loaded",
    "issue_comments",
    "reviews",
    "inline_comments",
    "threads",
    "reactions",
    "permissions",
    "exact_artifacts",
    "service_start_observations",
    "request_count",
    "item_count",
    "response_bytes",
    "server_date_headers",
  ]);
  for (const key of [
    "all_pages_loaded",
    "issue_comments",
    "reviews",
    "inline_comments",
    "threads",
    "reactions",
    "permissions",
    "exact_artifacts",
    "service_start_observations",
  ]) {
    requireBoolean(snapshot.completeness[key], `snapshot.completeness.${key}`);
  }
  for (const key of ["request_count", "item_count", "response_bytes", "server_date_headers"]) {
    if (!Number.isSafeInteger(snapshot.completeness[key]) || snapshot.completeness[key] < 0) {
      throw new TypeError(`snapshot.completeness.${key} must be a non-negative safe integer`);
    }
  }
  if (
    snapshot.completeness.item_count !== countSnapshotItems(
      snapshot.pages,
      snapshot.service_start_observations,
    )
  ) {
    throw new TypeError(
      "snapshot.completeness.item_count does not equal the closed evidence inventory",
    );
  }
  if (snapshot.completeness.server_date_headers !== snapshot.completeness.request_count) {
    throw new TypeError(
      "snapshot.completeness.server_date_headers must equal request_count",
    );
  }
  assertClosedObject(snapshot.stability, "snapshot.stability", [
    "scope_stable",
    "service_start_observations_stable",
    "server_time_monotonic",
  ]);
  requireBoolean(snapshot.stability.scope_stable, "snapshot.stability.scope_stable");
  requireBoolean(
    snapshot.stability.service_start_observations_stable,
    "snapshot.stability.service_start_observations_stable",
  );
  if (
    snapshot.stability.service_start_observations_stable !==
    snapshot.service_start_observations.stable
  ) {
    throw new TypeError(
      "snapshot.stability.service_start_observations_stable must equal " +
        "snapshot.service_start_observations.stable",
    );
  }
  requireBoolean(
    snapshot.stability.server_time_monotonic,
    "snapshot.stability.server_time_monotonic",
  );
  return snapshot;
}

export const validateV2Snapshot = assertV2Snapshot;

function assertScope(value, path) {
  assertClosedObject(value, path, [
    "base_ref_name",
    "base_ref_tip",
    "head_ref_name",
    "head_ref_oid",
    "merge_base_sha",
    "potential_merge_oid",
    "potential_merge_tree",
    "ordered_parent_oids",
    "merge_ref_oid",
    "mergeable",
  ]);
  nullableNonEmptyString(value.base_ref_name, `${path}.base_ref_name`);
  nullableSha(value.base_ref_tip, `${path}.base_ref_tip`);
  nullableNonEmptyString(value.head_ref_name, `${path}.head_ref_name`);
  nullableSha(value.head_ref_oid, `${path}.head_ref_oid`);
  nullableSha(value.merge_base_sha, `${path}.merge_base_sha`);
  nullableSha(value.potential_merge_oid, `${path}.potential_merge_oid`);
  nullableSha(value.potential_merge_tree, `${path}.potential_merge_tree`);
  if (!Array.isArray(value.ordered_parent_oids) || value.ordered_parent_oids.length > 3) {
    throw new TypeError(`${path}.ordered_parent_oids must be an array of at most three SHAs`);
  }
  value.ordered_parent_oids.forEach((oid, index) =>
    requireSha(oid, `${path}.ordered_parent_oids[${index}]`));
  nullableSha(value.merge_ref_oid, `${path}.merge_ref_oid`);
  requireEnum(value.mergeable, MERGEABLE_VALUES, `${path}.mergeable`);
}

function assertScopeReceipt(value, path) {
  assertClosedObject(value, path, [
    "repository_owner",
    "repository_name",
    "repository_node_id",
    "pull_request_number",
    "pull_request_node_id",
    "pull_request_state",
    "pull_request_merged",
    "pull_request_merged_at",
    "pull_request_is_draft",
    "base_ref_name",
    "base_ref_tip",
    "head_ref_name",
    "head_ref_oid",
    "merge_base_sha",
    "potential_merge_oid",
    "potential_merge_tree",
    "ordered_parent_oids",
    "merge_ref_oid",
    "mergeable",
    "endpoint_receipts",
    "server_time",
  ]);
  requireNonEmptyString(value.repository_owner, `${path}.repository_owner`);
  requireNonEmptyString(value.repository_name, `${path}.repository_name`);
  requireNonEmptyString(value.repository_node_id, `${path}.repository_node_id`);
  if (!Number.isSafeInteger(value.pull_request_number) || value.pull_request_number <= 0) {
    throw new TypeError(`${path}.pull_request_number must be a positive safe integer`);
  }
  requireNonEmptyString(value.pull_request_node_id, `${path}.pull_request_node_id`);
  requireEnum(value.pull_request_state, PULL_REQUEST_STATES, `${path}.pull_request_state`);
  requireBoolean(value.pull_request_merged, `${path}.pull_request_merged`);
  nullableTimestamp(value.pull_request_merged_at, `${path}.pull_request_merged_at`);
  requireBoolean(value.pull_request_is_draft, `${path}.pull_request_is_draft`);
  if (
    value.pull_request_merged !== (value.pull_request_merged_at !== null) ||
    value.pull_request_merged !== (value.pull_request_state === "MERGED")
  ) {
    throw new TypeError(`${path} pull-request lifecycle fields are inconsistent`);
  }
  assertScope(scopeFromReceipt(value), `${path}.scope`);
  requireTimestamp(value.server_time, `${path}.server_time`);
  assertScopeEndpointReceipts(value.endpoint_receipts, value, path);
}

function assertScopeEndpointReceipts(value, scope, path) {
  assertClosedObject(value, `${path}.endpoint_receipts`, [
    "pull_request",
    "graphql",
    "compare",
    "merge_ref",
  ]);
  const repoPath = repositoryPath(scope.repository_owner, scope.repository_name);
  assertScopeEndpointReceipt(
    value.pull_request,
    `${path}.endpoint_receipts.pull_request`,
    {
      method: "GET",
      path: `${repoPath}/pulls/${scope.pull_request_number}`,
      statuses: new Set([200]),
    },
  );
  assertScopeEndpointReceipt(
    value.graphql,
    `${path}.endpoint_receipts.graphql`,
    { method: "POST", path: null, statuses: new Set([200]) },
  );
  const compareExpected = scope.base_ref_tip === null || scope.head_ref_oid === null
    ? null
    : `${repoPath}/compare/${scope.base_ref_tip}...${scope.head_ref_oid}`;
  if (compareExpected === null) {
    if (value.compare !== null) {
      throw new TypeError(`${path}.endpoint_receipts.compare must be null without a base or head`);
    }
  } else {
    assertScopeEndpointReceipt(
      value.compare,
      `${path}.endpoint_receipts.compare`,
      { method: "GET", path: compareExpected, statuses: new Set([200]) },
    );
  }
  assertScopeEndpointReceipt(
    value.merge_ref,
    `${path}.endpoint_receipts.merge_ref`,
    {
      method: "GET",
      path: `${repoPath}/git/ref/pull/${scope.pull_request_number}/merge`,
      statuses: new Set([200, 404]),
    },
  );
  if (
    (value.merge_ref.status === 404) !== (scope.merge_ref_oid === null)
  ) {
    throw new TypeError(`${path}.endpoint_receipts.merge_ref status contradicts merge_ref_oid`);
  }
  const ordered = [
    value.pull_request,
    value.graphql,
    ...(value.compare === null ? [] : [value.compare]),
    value.merge_ref,
  ];
  for (let index = 1; index < ordered.length; index += 1) {
    if (
      Date.parse(ordered[index].server_time) <
        Date.parse(ordered[index - 1].server_time)
    ) {
      throw new TypeError(`${path}.endpoint_receipts server time regressed`);
    }
  }
  const latest = latestServerTime(ordered.map((receipt) => receipt.server_time));
  if (scope.server_time !== latest) {
    throw new TypeError(`${path}.server_time must equal its latest endpoint receipt time`);
  }
}

function assertScopeEndpointReceipt(value, path, expected) {
  assertClosedObject(value, path, [
    "method",
    "path",
    "status",
    "server_time",
    "raw_body_sha256",
  ]);
  if (value.method !== expected.method) {
    throw new TypeError(`${path}.method must be ${expected.method}`);
  }
  const endpointPath = requireNonEmptyString(value.path, `${path}.path`);
  if (
    endpointPath.length > 4096 || !endpointPath.startsWith("/") ||
    endpointPath.includes("?") || endpointPath.includes("#") ||
    /[\r\n]/u.test(endpointPath) ||
    (expected.path !== null && endpointPath !== expected.path)
  ) {
    throw new TypeError(`${path}.path is not the canonical configured endpoint path`);
  }
  if (!expected.statuses.has(value.status)) {
    throw new TypeError(`${path}.status is not allowed`);
  }
  requireTimestamp(value.server_time, `${path}.server_time`);
  if (typeof value.raw_body_sha256 !== "string" ||
      !/^sha256:[0-9a-f]{64}$/u.test(value.raw_body_sha256)) {
    throw new TypeError(`${path}.raw_body_sha256 must be a lowercase SHA-256 digest`);
  }
}

function assertPages(value, path) {
  assertClosedObject(value, path, [
    "issue_comments",
    "reviews",
    "inline_comments",
    "threads",
    "reactions",
    "exact_artifacts",
  ]);
  assertNormalizedArray(value.issue_comments, `${path}.issue_comments`, assertIssueComment);
  assertNormalizedArray(value.reviews, `${path}.reviews`, assertReview);
  assertNormalizedArray(value.inline_comments, `${path}.inline_comments`, assertInlineComment);
  assertNormalizedArray(value.threads, `${path}.threads`, assertThread);
  assertClosedObject(value.reactions, `${path}.reactions`, [
    "issue",
    "issue_comments",
    "reviews",
    "inline_comments",
  ]);
  assertNormalizedArray(value.reactions.issue, `${path}.reactions.issue`, assertReaction);
  for (const key of ["issue_comments", "reviews", "inline_comments"]) {
    assertNormalizedArray(
      value.reactions[key],
      `${path}.reactions.${key}`,
      (entry, entryPath) => {
        assertClosedObject(entry, entryPath, ["subject_id", "reactions"]);
        requireDecimalId(entry.subject_id, `${entryPath}.subject_id`);
        assertNormalizedArray(entry.reactions, `${entryPath}.reactions`, assertReaction);
      },
      { requireId: false },
    );
  }
  assertNormalizedArray(
    value.exact_artifacts,
    `${path}.exact_artifacts`,
    assertExactArtifactEntry,
    { requireId: false },
  );
}

function assertExactArtifactEntry(entry, entryPath) {
  assertClosedObject(entry, entryPath, [
    "selector",
    "artifact",
    "response_server_time",
    "raw_body_sha256",
  ]);
  assertClosedObject(entry.selector, `${entryPath}.selector`, ["kind", "id"]);
  if (!new Set(["issue_comment", "pull_request_review", "inline_comment"])
    .has(entry.selector.kind)) {
    throw new TypeError(`${entryPath}.selector.kind is invalid`);
  }
  requireDecimalId(entry.selector.id, `${entryPath}.selector.id`);
  if (entry.selector.kind === "issue_comment") {
    assertIssueComment(entry.artifact, `${entryPath}.artifact`);
  } else if (entry.selector.kind === "pull_request_review") {
    assertReview(entry.artifact, `${entryPath}.artifact`);
  } else {
    assertInlineComment(entry.artifact, `${entryPath}.artifact`);
  }
  if (entry.artifact.id !== entry.selector.id) {
    throw new TypeError(`${entryPath}.artifact.id does not equal its selector id`);
  }
  requireTimestamp(entry.response_server_time, `${entryPath}.response_server_time`);
  if (
    typeof entry.raw_body_sha256 !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(entry.raw_body_sha256)
  ) {
    throw new TypeError(
      `${entryPath}.raw_body_sha256 must be a prefixed lowercase raw SHA-256 digest`,
    );
  }
}

function assertArtifactHtmlScope(pages, repository, pullNumber) {
  const context = {
    owner: repository.owner,
    repo: repository.name,
    pullNumber,
  };
  for (const [collection, fragmentKind] of [
    [pages.issue_comments, "issuecomment"],
    [pages.reviews, "pullrequestreview"],
    [pages.inline_comments, "discussion_r"],
  ]) {
    for (const artifact of collection) {
      requireCanonicalGitHubArtifactUrl(
        artifact.html_url,
        context,
        fragmentKind,
        artifact.id,
        `snapshot artifact ${artifact.id}.html_url`,
      );
    }
  }
}

function assertPageRelations(pages, snapshotServerTime) {
  const issueComments = new Map(pages.issue_comments.map((item) => [item.id, item]));
  const reviews = new Map(pages.reviews.map((item) => [item.id, item]));
  const inlineComments = new Map(pages.inline_comments.map((item) => [item.id, item]));
  assertReactionSubjectClosure(
    pages.reactions.issue_comments,
    issueComments,
    "snapshot.pages.reactions.issue_comments",
  );
  assertReactionSubjectClosure(
    pages.reactions.inline_comments,
    inlineComments,
    "snapshot.pages.reactions.inline_comments",
  );
  assertReactionSubjectClosure(
    pages.reactions.reviews,
    reviews,
    "snapshot.pages.reactions.reviews",
  );

  const threadCommentDatabaseIds = new Set();
  const threadCommentNodeIds = new Set();
  for (const thread of pages.threads) {
    for (const comment of thread.comments) {
      if (threadCommentDatabaseIds.has(comment.database_id)) {
        throw new TypeError(
          `snapshot.pages.threads repeats comment database_id ${comment.database_id}`,
        );
      }
      if (threadCommentNodeIds.has(comment.id)) {
        throw new TypeError(`snapshot.pages.threads repeats comment node id ${comment.id}`);
      }
      threadCommentDatabaseIds.add(comment.database_id);
      threadCommentNodeIds.add(comment.id);
      const restComment = inlineComments.get(comment.database_id);
      if (!restComment || restComment.node_id !== comment.id) {
        throw new TypeError(
          `snapshot.pages.threads comment ${comment.database_id} is not identical to its ` +
            "REST inline-comment identity",
        );
      }
    }
  }
  if (threadCommentDatabaseIds.size !== inlineComments.size) {
    throw new TypeError(
      "snapshot.pages.threads does not cover the complete REST inline-comment inventory",
    );
  }

  const exactSelectorKeys = new Set();
  for (const entry of pages.exact_artifacts) {
    const key = `${entry.selector.kind}:${entry.selector.id}`;
    if (exactSelectorKeys.has(key)) {
      throw new TypeError(`snapshot.pages.exact_artifacts repeats selector ${key}`);
    }
    exactSelectorKeys.add(key);
    const collection = entry.selector.kind === "issue_comment"
      ? issueComments
      : entry.selector.kind === "pull_request_review"
        ? reviews
        : inlineComments;
    const paginated = collection.get(entry.selector.id);
    if (!paginated || !isDeepStrictEqual(entry.artifact, paginated)) {
      throw new TypeError(
        `snapshot.pages.exact_artifacts ${key} does not equal its complete page record`,
      );
    }
    if (Date.parse(entry.response_server_time) > Date.parse(snapshotServerTime)) {
      throw new TypeError(
        `snapshot.pages.exact_artifacts ${key} was observed after snapshot.server_time`,
      );
    }
  }
}

function assertReactionSubjectClosure(groups, subjects, path) {
  const seen = new Set();
  for (const group of groups) {
    if (seen.has(group.subject_id)) {
      throw new TypeError(`${path} repeats subject_id ${group.subject_id}`);
    }
    seen.add(group.subject_id);
    if (!subjects.has(group.subject_id)) {
      throw new TypeError(`${path} contains unknown subject_id ${group.subject_id}`);
    }
  }
  if (seen.size !== subjects.size) {
    throw new TypeError(`${path} does not cover the complete subject inventory`);
  }
}

function countSnapshotItems(pages, serviceStartObservations) {
  return pages.issue_comments.length +
    pages.reviews.length +
    pages.inline_comments.length +
    pages.threads.length +
    pages.threads.reduce((count, thread) => count + thread.comments.length, 0) +
    pages.reactions.issue.length +
    pages.reactions.issue_comments.reduce(
      (count, group) => count + group.reactions.length,
      0,
    ) +
    pages.reactions.reviews.reduce(
      (count, group) => count + group.reactions.length,
      0,
    ) +
    pages.reactions.inline_comments.reduce(
      (count, group) => count + group.reactions.length,
      0,
    ) +
    pages.exact_artifacts.length +
    serviceStartObservations.pre.total_check_runs +
    serviceStartObservations.post.total_check_runs;
}

function assertNormalizedArray(value, path, validator, { requireId = true } = {}) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be an array`);
  }
  const ids = new Set();
  value.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    validator(item, itemPath);
    if (requireId) {
      if (ids.has(item.id)) {
        throw new TypeError(`${path} repeats id ${item.id}`);
      }
      ids.add(item.id);
    }
  });
}

function assertIssueComment(value, path) {
  assertClosedObject(value, path, [
    "id", "node_id", "url", "html_url", "issue_url", "author", "app",
    "author_association", "body", "created_at", "updated_at",
  ]);
  assertCommonArtifact(value, path);
  requireAbsoluteUrl(value.issue_url, `${path}.issue_url`);
}

function assertReview(value, path) {
  assertClosedObject(value, path, [
    "id", "node_id", "url", "html_url", "pull_request_url", "author", "app",
    "author_association", "body", "state", "submitted_at", "commit_id",
  ]);
  assertCommonArtifact(value, path, { timestamps: false });
  requireAbsoluteUrl(value.pull_request_url, `${path}.pull_request_url`);
  requireEnum(value.state, REVIEW_STATES, `${path}.state`);
  nullableTimestamp(value.submitted_at, `${path}.submitted_at`);
  nullableSha(value.commit_id, `${path}.commit_id`);
}

function assertInlineComment(value, path) {
  assertClosedObject(value, path, [
    "id", "node_id", "pull_request_review_id", "url", "html_url", "pull_request_url",
    "author", "app", "author_association", "body", "path", "line", "start_line",
    "side", "start_side", "commit_id", "original_commit_id", "in_reply_to_id",
    "created_at", "updated_at",
  ]);
  assertCommonArtifact(value, path);
  requireDecimalId(value.pull_request_review_id, `${path}.pull_request_review_id`);
  requireAbsoluteUrl(value.pull_request_url, `${path}.pull_request_url`);
  requireNonEmptyString(value.path, `${path}.path`);
  nullableInteger(value.line, `${path}.line`);
  nullableInteger(value.start_line, `${path}.start_line`);
  nullableEnum(value.side, DIFF_SIDES, `${path}.side`);
  nullableEnum(value.start_side, DIFF_SIDES, `${path}.start_side`);
  requireSha(value.commit_id, `${path}.commit_id`);
  requireSha(value.original_commit_id, `${path}.original_commit_id`);
  nullableDecimalId(value.in_reply_to_id, `${path}.in_reply_to_id`);
}

function assertCommonArtifact(value, path, { timestamps = true } = {}) {
  requireDecimalId(value.id, `${path}.id`);
  requireNonEmptyString(value.node_id, `${path}.node_id`);
  requireAbsoluteUrl(value.url, `${path}.url`);
  requireAbsoluteUrl(value.html_url, `${path}.html_url`);
  assertActor(value.author, `${path}.author`);
  assertApp(value.app, `${path}.app`);
  requireNonEmptyString(value.author_association, `${path}.author_association`);
  nullableString(value.body, `${path}.body`);
  if (timestamps) {
    requireTimestamp(value.created_at, `${path}.created_at`);
    requireTimestamp(value.updated_at, `${path}.updated_at`);
  }
}

function assertActor(value, path) {
  if (value === null) {
    return;
  }
  assertClosedObject(value, path, ["id", "login", "type", "node_id"]);
  requireDecimalId(value.id, `${path}.id`);
  requireNonEmptyString(value.login, `${path}.login`);
  requireNonEmptyString(value.type, `${path}.type`);
  requireNonEmptyString(value.node_id, `${path}.node_id`);
}

function assertApp(value, path) {
  if (value === null) {
    return;
  }
  assertClosedObject(value, path, ["id", "slug", "node_id"]);
  requireDecimalId(value.id, `${path}.id`);
  requireNonEmptyString(value.slug, `${path}.slug`);
  nullableNonEmptyString(value.node_id, `${path}.node_id`);
}

function assertReaction(value, path) {
  assertClosedObject(value, path, ["id", "node_id", "content", "created_at", "author"]);
  requireDecimalId(value.id, `${path}.id`);
  requireNonEmptyString(value.node_id, `${path}.node_id`);
  requireEnum(
    value.content,
    new Set(["+1", "-1", "laugh", "confused", "heart", "hooray", "rocket", "eyes"]),
    `${path}.content`,
  );
  requireTimestamp(value.created_at, `${path}.created_at`);
  assertActor(value.author, `${path}.author`);
}

function assertThread(value, path) {
  assertClosedObject(value, path, [
    "id", "is_resolved", "is_outdated", "path", "line", "start_line", "diff_side",
    "start_diff_side", "comments",
  ]);
  requireNonEmptyString(value.id, `${path}.id`);
  requireBoolean(value.is_resolved, `${path}.is_resolved`);
  requireBoolean(value.is_outdated, `${path}.is_outdated`);
  nullableNonEmptyString(value.path, `${path}.path`);
  nullableInteger(value.line, `${path}.line`);
  nullableInteger(value.start_line, `${path}.start_line`);
  nullableEnum(value.diff_side, DIFF_SIDES, `${path}.diff_side`);
  nullableEnum(value.start_diff_side, DIFF_SIDES, `${path}.start_diff_side`);
  assertNormalizedArray(
    value.comments,
    `${path}.comments`,
    (comment, commentPath) => {
      assertClosedObject(comment, commentPath, ["id", "database_id"]);
      requireNonEmptyString(comment.id, `${commentPath}.id`);
      requireDecimalId(comment.database_id, `${commentPath}.database_id`);
    },
  );
}

function assertServiceStartObservations(value, expectedHeadSha, snapshotServerTime, path) {
  assertClosedObject(value, path, [
    "provider_app_slug",
    "head_sha",
    "pre",
    "post",
    "stable",
  ]);
  if (value.provider_app_slug !== SERVICE_START_APP_SLUG) {
    throw new TypeError(`${path}.provider_app_slug must identify the Codex connector App`);
  }
  const headSha = requireSha(value.head_sha, `${path}.head_sha`);
  if (headSha !== expectedHeadSha) {
    throw new TypeError(`${path}.head_sha must equal snapshot.scope.head_ref_oid`);
  }
  assertServiceStartReceipt(value.pre, headSha, `${path}.pre`);
  assertServiceStartReceipt(value.post, headSha, `${path}.post`);
  if (Date.parse(value.pre.server_time) > Date.parse(value.post.server_time)) {
    throw new TypeError(`${path}.post.server_time must not precede pre.server_time`);
  }
  if (Date.parse(value.post.server_time) > Date.parse(snapshotServerTime)) {
    throw new TypeError(`${path}.post.server_time must not follow snapshot.server_time`);
  }
  const stable = isDeepStrictEqual(
    serviceStartStabilityProjection(value.pre),
    serviceStartStabilityProjection(value.post),
  );
  requireBoolean(value.stable, `${path}.stable`);
  if (value.stable !== stable) {
    throw new TypeError(`${path}.stable does not match its pre/post receipts`);
  }
}

function assertServiceStartReceipt(value, expectedHeadSha, path) {
  assertClosedObject(value, path, [
    "server_time",
    "page_count",
    "total_check_runs",
    "matching_app_ids",
    "check_runs",
    "page_receipts",
  ]);
  requireTimestamp(value.server_time, `${path}.server_time`);
  if (!Number.isSafeInteger(value.page_count) || value.page_count <= 0) {
    throw new TypeError(`${path}.page_count must be a positive safe integer`);
  }
  requireNonNegativeSafeInteger(value.total_check_runs, `${path}.total_check_runs`);
  if (!Array.isArray(value.matching_app_ids)) {
    throw new TypeError(`${path}.matching_app_ids must be an array`);
  }
  let priorAppId = null;
  for (const [index, appIdValue] of value.matching_app_ids.entries()) {
    const appId = requireDecimalId(appIdValue, `${path}.matching_app_ids[${index}]`);
    if (priorAppId !== null && compareDecimalIds(priorAppId, appId) >= 0) {
      throw new TypeError(`${path}.matching_app_ids must be unique and ascending`);
    }
    priorAppId = appId;
  }
  assertNormalizedArray(
    value.check_runs,
    `${path}.check_runs`,
    (run, runPath) => assertServiceStartCheckRun(run, expectedHeadSha, runPath),
  );
  let priorRunId = null;
  for (const run of value.check_runs) {
    if (priorRunId !== null && compareDecimalIds(priorRunId, run.id) >= 0) {
      throw new TypeError(`${path}.check_runs must be sorted by ascending id`);
    }
    priorRunId = run.id;
  }
  const derivedAppIds = [...new Set(value.check_runs.map((run) => run.app.id))]
    .sort(compareDecimalIds);
  if (!isDeepStrictEqual(value.matching_app_ids, derivedAppIds)) {
    throw new TypeError(`${path}.matching_app_ids does not match check_runs`);
  }
  if (value.check_runs.length > value.total_check_runs) {
    throw new TypeError(`${path}.check_runs cannot exceed total_check_runs`);
  }
  if (!Array.isArray(value.page_receipts)) {
    throw new TypeError(`${path}.page_receipts must be an array`);
  }
  if (value.page_receipts.length !== value.page_count) {
    throw new TypeError(`${path}.page_receipts must cover every fetched page`);
  }
  let itemCount = 0;
  for (const [index, page] of value.page_receipts.entries()) {
    const pagePath = `${path}.page_receipts[${index}]`;
    assertClosedObject(page, pagePath, [
      "page",
      "item_count",
      "total_count",
      "response_server_time",
      "raw_body_sha256",
    ]);
    if (page.page !== index + 1) {
      throw new TypeError(`${pagePath}.page must be the canonical one-based page number`);
    }
    requireNonNegativeSafeInteger(page.item_count, `${pagePath}.item_count`);
    requireNonNegativeSafeInteger(page.total_count, `${pagePath}.total_count`);
    if (page.total_count !== value.total_check_runs) {
      throw new TypeError(`${pagePath}.total_count must equal receipt total_check_runs`);
    }
    requireTimestamp(page.response_server_time, `${pagePath}.response_server_time`);
    if (Date.parse(page.response_server_time) > Date.parse(value.server_time)) {
      throw new TypeError(`${pagePath}.response_server_time must not follow receipt server_time`);
    }
    if (
      typeof page.raw_body_sha256 !== "string" ||
      !/^sha256:[0-9a-f]{64}$/.test(page.raw_body_sha256)
    ) {
      throw new TypeError(`${pagePath}.raw_body_sha256 must be a prefixed SHA-256 digest`);
    }
    itemCount += page.item_count;
  }
  if (itemCount !== value.total_check_runs) {
    throw new TypeError(`${path}.page_receipts item counts must equal total_check_runs`);
  }
}

function assertServiceStartCheckRun(value, expectedHeadSha, path) {
  assertClosedObject(value, path, [
    "id",
    "node_id",
    "url",
    "name",
    "head_sha",
    "status",
    "conclusion",
    "started_at",
    "completed_at",
    "external_id",
    "details_url",
    "app",
  ]);
  requireDecimalId(value.id, `${path}.id`);
  requireNonEmptyString(value.node_id, `${path}.node_id`);
  requireAbsoluteUrl(value.url, `${path}.url`);
  requireNonEmptyString(value.name, `${path}.name`);
  const headSha = requireSha(value.head_sha, `${path}.head_sha`);
  if (headSha !== expectedHeadSha) {
    throw new TypeError(`${path}.head_sha must equal the receipt current head`);
  }
  const status = requireEnum(value.status, CHECK_RUN_STATUSES, `${path}.status`);
  const conclusion = nullableEnum(value.conclusion, CHECK_RUN_CONCLUSIONS, `${path}.conclusion`);
  const startedAt = nullableTimestamp(value.started_at, `${path}.started_at`);
  const completedAt = nullableTimestamp(value.completed_at, `${path}.completed_at`);
  if (status === "completed" && conclusion === null) {
    throw new TypeError(`${path}.conclusion is required for completed status`);
  }
  if (status !== "completed" && (conclusion !== null || completedAt !== null)) {
    throw new TypeError(`${path}.conclusion/completed_at require completed status`);
  }
  if (
    startedAt !== null &&
    completedAt !== null &&
    Date.parse(completedAt) < Date.parse(startedAt)
  ) {
    throw new TypeError(`${path}.completed_at must not precede started_at`);
  }
  nullableString(value.external_id, `${path}.external_id`);
  nullableAbsoluteUrl(value.details_url, `${path}.details_url`);
  assertClosedObject(value.app, `${path}.app`, ["id", "node_id", "slug"]);
  requireDecimalId(value.app.id, `${path}.app.id`);
  requireNonEmptyString(value.app.node_id, `${path}.app.node_id`);
  if (value.app.slug !== SERVICE_START_APP_SLUG) {
    throw new TypeError(`${path}.app.slug must identify the selected service App`);
  }
}

function assertPermissions(value, path, exactArtifacts) {
  assertClosedObject(value, path, ["transport_capabilities", "actor_permissions"]);
  assertClosedObject(value.transport_capabilities, `${path}.transport_capabilities`, [
    "stable",
    "pre",
    "post",
  ]);
  requireBoolean(value.transport_capabilities.stable, `${path}.transport_capabilities.stable`);
  assertTransportCapabilityReceipt(
    value.transport_capabilities.pre,
    `${path}.transport_capabilities.pre`,
  );
  assertTransportCapabilityReceipt(
    value.transport_capabilities.post,
    `${path}.transport_capabilities.post`,
  );
  if (!Array.isArray(value.actor_permissions)) {
    throw new TypeError(`${path}.actor_permissions must be an array`);
  }
  const exactArtifactsBySubject = new Map(exactArtifacts.map((entry) => [
    `${entry.selector.kind}:${entry.selector.id}`,
    entry,
  ]));
  const subjectKeys = new Set();
  for (const [index, receipt] of value.actor_permissions.entries()) {
    const receiptPath = `${path}.actor_permissions[${index}]`;
    assertClosedObject(receipt, receiptPath, [
      "subject",
      "actor",
      "assurance",
      "request_time_permission",
      "permission_aba_excluded",
      "stable",
      "pre",
      "post",
    ]);
    assertClosedObject(receipt.subject, `${receiptPath}.subject`, ["kind", "id"]);
    if (!new Set(["issue_comment", "pull_request_review", "inline_comment"]).has(receipt.subject.kind)) {
      throw new TypeError(`${receiptPath}.subject.kind is invalid`);
    }
    requireDecimalId(receipt.subject.id, `${receiptPath}.subject.id`);
    const subjectKey = `${receipt.subject.kind}:${receipt.subject.id}`;
    if (subjectKeys.has(subjectKey)) {
      throw new TypeError(`${path}.actor_permissions repeats subject ${subjectKey}`);
    }
    subjectKeys.add(subjectKey);
    assertActor(receipt.actor, `${receiptPath}.actor`);
    const exactArtifact = exactArtifactsBySubject.get(subjectKey);
    if (
      exactArtifact === undefined ||
      receipt.actor === null ||
      exactArtifact.artifact.author === null ||
      !isDeepStrictEqual(receipt.actor, exactArtifact.artifact.author)
    ) {
      throw new TypeError(
        `${receiptPath} permission actor must equal its exact artifact author`,
      );
    }
    if (receipt.assurance !== "point-in-time-only") {
      throw new TypeError(`${receiptPath}.assurance must be point-in-time-only`);
    }
    if (receipt.request_time_permission !== "unproven") {
      throw new TypeError(`${receiptPath}.request_time_permission must be unproven`);
    }
    if (receipt.permission_aba_excluded !== false) {
      throw new TypeError(`${receiptPath}.permission_aba_excluded must be false`);
    }
    requireBoolean(receipt.stable, `${receiptPath}.stable`);
    assertActorPermissionReceipt(receipt.pre, `${receiptPath}.pre`);
    assertActorPermissionReceipt(receipt.post, `${receiptPath}.post`);
    if (
      !isDeepStrictEqual(receipt.subject, receipt.pre.subject) ||
      !isDeepStrictEqual(receipt.subject, receipt.post.subject) ||
      !isDeepStrictEqual(receipt.actor, receipt.pre.actor) ||
      !isDeepStrictEqual(receipt.actor, receipt.post.actor)
    ) {
      throw new TypeError(`${receiptPath} subject/actor does not match its point receipts`);
    }
    if (!isDeepStrictEqual(
      permissionReceiptProjection(receipt.pre),
      permissionReceiptProjection(receipt.post),
    )) {
      throw new TypeError(`${receiptPath} pre/post permission projections differ`);
    }
  }
}

function assertTransportCapabilityReceipt(value, path) {
  assertClosedObject(value, path, [
    "capability_kind",
    "admin",
    "maintain",
    "push",
    "triage",
    "pull",
    "role_name",
    "endpoint",
    "http_status",
    "response_server_time",
    "raw_body_sha256",
  ]);
  if (value.capability_kind !== "authenticated-transport-token") {
    throw new TypeError(`${path}.capability_kind is invalid`);
  }
  for (const key of ["admin", "maintain", "push", "triage", "pull"]) {
    requireBoolean(value[key], `${path}.${key}`);
  }
  nullableNonEmptyString(value.role_name, `${path}.role_name`);
  assertReceiptTransport(value, path);
}

function assertActorPermissionReceipt(value, path) {
  assertClosedObject(value, path, [
    "subject",
    "actor",
    "effective_permission",
    "role_name",
    "permissions",
    "mapping_source",
    "permission_assurance",
    "request_time_permission",
    "permission_aba_excluded",
    "endpoint",
    "http_status",
    "response_server_time",
    "raw_body_sha256",
  ]);
  assertClosedObject(value.subject, `${path}.subject`, ["kind", "id"]);
  assertActor(value.actor, `${path}.actor`);
  const effectivePermission = requireEnum(
    value.effective_permission,
    new Set(["admin", "write", "read", "none"]),
    `${path}.effective_permission`,
  );
  if (value.role_name !== "" || effectivePermission !== "none") {
    requireNonEmptyString(value.role_name, `${path}.role_name`);
  }
  assertClosedObject(value.permissions, `${path}.permissions`, [
    "admin", "maintain", "push", "triage", "pull",
  ]);
  for (const key of ["admin", "maintain", "push", "triage", "pull"]) {
    requireBoolean(value.permissions[key], `${path}.permissions.${key}`);
  }
  if (
    value.role_name === "" &&
    Object.values(value.permissions).some((allowed) => allowed)
  ) {
    throw new TypeError(
      `${path}.permissions must all be false when effective_permission is none and ` +
        "role_name is empty",
    );
  }
  requireEnum(
    value.mapping_source,
    new Set(["user.permissions", "legacy-permission"]),
    `${path}.mapping_source`,
  );
  if (value.permission_assurance !== "point-in-time-only") {
    throw new TypeError(`${path}.permission_assurance must be point-in-time-only`);
  }
  if (value.request_time_permission !== "unproven") {
    throw new TypeError(`${path}.request_time_permission must be unproven`);
  }
  if (value.permission_aba_excluded !== false) {
    throw new TypeError(`${path}.permission_aba_excluded must be false`);
  }
  assertReceiptTransport(value, path);
}

function assertReceiptTransport(value, path) {
  requireAbsoluteUrl(value.endpoint, `${path}.endpoint`);
  if (value.http_status !== 200) {
    throw new TypeError(`${path}.http_status must be 200`);
  }
  requireTimestamp(value.response_server_time, `${path}.response_server_time`);
  if (
    typeof value.raw_body_sha256 !== "string" ||
    !/^sha256:[0-9a-f]{64}$/.test(value.raw_body_sha256)
  ) {
    throw new TypeError(
      `${path}.raw_body_sha256 must be a prefixed lowercase raw SHA-256 digest`,
    );
  }
}

function validateUniqueIds(values, label) {
  const ids = new Set();
  for (const value of values) {
    if (ids.has(value.id)) {
      throw transportFailure("DUPLICATE_ITEM", `${label} repeated id ${value.id}`);
    }
    ids.add(value.id);
  }
}

function requireDecimalId(value, path) {
  let result;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`${path} must be a non-negative safe decimal id`);
    }
    result = String(value);
  } else if (typeof value === "string" && DECIMAL_ID_PATTERN.test(value)) {
    result = value;
  } else {
    throw new TypeError(`${path} must be a non-negative decimal id`);
  }
  return result;
}

function nullableDecimalId(value, path) {
  return value === null || value === undefined ? null : requireDecimalId(value, path);
}

function requireSha(value, path) {
  if (typeof value !== "string" || !SHA_PATTERN.test(value.toLowerCase())) {
    throw new TypeError(`${path} must be a 40-character hexadecimal SHA`);
  }
  return value.toLowerCase();
}

function nullableSha(value, path) {
  return value === null || value === undefined ? null : requireSha(value, path);
}

function requireNonEmptyString(value, path) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty string`);
  }
  return value;
}

function nullableNonEmptyString(value, path) {
  return value === null || value === undefined ? null : requireNonEmptyString(value, path);
}

function nullableString(value, path) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new TypeError(`${path} must be a string or null`);
  }
  return value;
}

function requireBoolean(value, path) {
  if (typeof value !== "boolean") {
    throw new TypeError(`${path} must be a boolean`);
  }
  return value;
}

function nullableInteger(value, path) {
  if (value === null || value === undefined) {
    return null;
  }
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${path} must be a safe integer or null`);
  }
  return value;
}

function requireEnum(value, allowed, path) {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new TypeError(`${path} has an unsupported value`);
  }
  return value;
}

function nullableEnum(value, allowed, path) {
  return value === null || value === undefined ? null : requireEnum(value, allowed, path);
}

function requireTimestamp(value, path) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${path} must be an ISO timestamp`);
  }
  const canonical = new Date(Date.parse(value)).toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(canonical)) {
    throw new TypeError(`${path} is outside the supported timestamp range`);
  }
  return canonical;
}

function nullableTimestamp(value, path) {
  return value === null || value === undefined ? null : requireTimestamp(value, path);
}

function requireNonNegativeSafeInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer`);
  }
  return value;
}

function requireAbsoluteUrl(value, path) {
  if (typeof value !== "string") {
    throw new TypeError(`${path} must be an absolute URL`);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${path} must be an absolute URL`);
  }
  if (!new Set(["https:", "http:"]).has(url.protocol) || url.username || url.password) {
    throw new TypeError(`${path} must be an HTTP(S) URL without credentials`);
  }
  return url.href;
}

function nullableAbsoluteUrl(value, path) {
  return value === null || value === undefined ? null : requireAbsoluteUrl(value, path);
}

function assertClosedObject(value, path, keys, { optional = false } = {}) {
  assertPlainObject(value, path);
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${path} contains unsupported key ${key}`);
    }
  }
  if (!optional) {
    for (const key of keys) {
      if (!Object.hasOwn(value, key)) {
        throw new TypeError(`${path} is missing required key ${key}`);
      }
    }
  }
}

function assertPlainObject(value, path) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${path} must be a plain object`);
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

function isDeepFrozen(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object") {
    return true;
  }
  if (seen.has(value)) {
    return true;
  }
  if (!Object.isFrozen(value) || !Object.isSealed(value)) {
    return false;
  }
  seen.add(value);
  return Object.values(value).every((child) => isDeepFrozen(child, seen));
}

function transportFailure(code, message, details = null, cause = undefined) {
  return new V2TransportError(code, message, details, cause === undefined ? undefined : { cause });
}
