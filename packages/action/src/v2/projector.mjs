import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  V2_OFFICIAL_CODEX_BOT_LOGIN,
  codexInlineParentReviewBodyHasClosedGrammar,
  collectCodexThreadEvidence,
  isExactV2CodexProviderApp,
  isExactV2CodexProviderIdentity,
  parseCodexIssueCommentArtifact,
  parseCodexIssueCommentTerminalHeading,
  parseCodexReviewArtifact,
} from "../core.mjs";
import {
  V2_MANUAL_REVIEW_REQUEST,
  V2_NO_START_BODIES,
  assertV2ReducerInput,
} from "./schema.mjs";
import {
  V2_TRANSPORT_DEFAULT_LIMITS,
  assertV2Snapshot,
} from "./transport.mjs";
import { V2_SELECTION_POLICIES } from "./workflow-command.mjs";

export const V2_PROJECTOR_CONTROLLER_SCHEMA =
  "codex-review-gate-projector-controller-v2";
export const V2_PROJECTOR_CONTROLLER_SCHEMA_VERSION = 1;
export const V2_PROJECTOR_FINAL_REREAD_ASSURANCE =
  "two-complete-point-in-time-snapshots";

const COMPLETE_KEYS = Object.freeze([
  "all_pages_loaded",
  "issue_comments",
  "reviews",
  "inline_comments",
  "threads",
  "reactions",
  "permissions",
  "exact_artifacts",
  "service_start_observations",
]);
const CONTROLLER_KEYS = Object.freeze([
  "schema",
  "schema_version",
  "selection",
  "server_enforcement",
  "budget",
  "request_bindings",
  "generation_admissions",
  "artifact_bindings",
  "thread_resolution_observations",
  "no_start_observations",
  "final_reread",
]);
const REQUEST_BINDING_KEYS = Object.freeze([
  "id",
  "kind",
  "base_oid",
  "head_oid",
  "current_incarnation",
  "controlled",
  "generation_id",
  "generation_kind",
  "generation_index",
]);
const GENERATION_ADMISSION_KEYS = Object.freeze([
  "prior_generation_id",
  "next_generation_id",
  "prior_request_id",
  "next_request_id",
  "head_oid",
  "prior_request_binding_record_oid",
  "recovery_transition_record_oid",
  "recovery_transition_payload_digest",
  "next_request_binding_record_oid",
  "next_request_binding_payload_digest",
  "transition_server_time",
  "ledger_order",
]);
const GENERATION_ADMISSION_LEDGER_ORDER_KEYS = Object.freeze([
  "prior_request_binding_index",
  "recovery_transition_index",
  "next_request_binding_index",
]);
const LEGACY_ARTIFACT_BINDING_KEYS = Object.freeze(["id", "request_id"]);
const ARTIFACT_BINDING_KEYS = Object.freeze([
  "id",
  "request_id",
  "generation_id",
  "request_node_id",
  "artifact_selector",
  "artifact_node_id",
  "artifact_url",
  "artifact_type",
  "artifact_created_at",
  "raw_body_sha256",
  "actor",
  "app",
]);
const THREAD_RESOLUTION_OBSERVATION_KEYS = Object.freeze([
  "thread_id",
  "repository_id",
  "pull_request_number",
  "head_oid",
  "response_server_time",
  "run_id",
  "is_resolved",
]);
const NO_START_OBSERVATION_KEYS = Object.freeze([
  "request_id",
  "carrier_selector",
  "first_seen_at",
  "first_run_id",
  "confirmation_run_id",
  "request_run_id",
]);
const SELECTOR_KINDS = new Set([
  "issue_comment",
  "pull_request_review",
  "inline_comment",
]);
const REVIEW_TERMINAL_BODY = /^### 💡 Codex Review(?:\r?\n|$)/u;
const DECIMAL_ID = /^(?:0|[1-9][0-9]*)$/u;
const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const V2_CODEX_BOT_LOGINS = new Set([V2_OFFICIAL_CODEX_BOT_LOGIN]);

export class V2ProjectorError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "V2ProjectorError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Discover the exact objects that the second transport snapshot must refetch.
 * The controller is required because request ownership is persistent state, not
 * something that can be inferred from an indistinguishable `@codex review`
 * comment.
 */
export function deriveV2EvidenceRequest({ discovery_snapshot, controller }) {
  assertCompleteTransportSnapshot(discovery_snapshot, "discovery_snapshot");
  const normalizedController = normalizeController(controller);

  const requestComments = requestCommentsById(
    discovery_snapshot,
    normalizedController,
  );
  const bindings = requestBindingsById(
    normalizedController,
    requestComments,
    discovery_snapshot.scope.head_ref_oid,
  );
  const selectorsByKey = new Map(
    deriveSelectors(
      discovery_snapshot,
      bindings,
      discovery_snapshot.scope.head_ref_oid,
    ).map((selector) => [selectorKey(selector), selector]),
  );
  for (const observation of normalizedController.no_start_observations) {
    selectorsByKey.set(
      selectorKey(observation.carrier_selector),
      observation.carrier_selector,
    );
  }
  const selectors = [...selectorsByKey.values()].sort(compareSelectors);
  if (selectors.length > V2_TRANSPORT_DEFAULT_LIMITS.max_artifact_selectors) {
    throw projectorFailure(
      "SELECTOR_LIMIT_EXCEEDED",
      `discovery produced ${selectors.length} exact selectors, exceeding ` +
        `${V2_TRANSPORT_DEFAULT_LIMITS.max_artifact_selectors}`,
    );
  }

  const permissionSubjects = selectors.filter((selector) => {
    if (selector.kind !== "issue_comment") return false;
    const comment = inventoryArtifact(discovery_snapshot, selector);
    const binding = bindings.get(selector.id);
    const unboundRequestCandidate =
      comment?.body === V2_MANUAL_REVIEW_REQUEST && binding === undefined;
    return unboundRequestCandidate ||
      (binding?.head_oid === discovery_snapshot.scope.head_ref_oid &&
        binding.kind === "manual") ||
      isAddressCommandCandidate(comment?.body);
  });

  return deepFreeze({
    artifactSelectors: selectors,
    permissionSubjects,
  });
}

/**
 * Project two immutable transport snapshots and explicit controller state into
 * the sole closed reducer input. This function performs no I/O and does not
 * infer request ownership, server enforcement, budgets, or no-start history.
 */
export function projectV2TransportSnapshots({
  discovery_snapshot,
  evidence_snapshot,
  controller,
}) {
  assertCompleteTransportSnapshot(discovery_snapshot, "discovery_snapshot");
  assertCompleteTransportSnapshot(evidence_snapshot, "evidence_snapshot");
  const normalizedController = normalizeController(controller);
  assertRawSnapshotContinuity(discovery_snapshot, evidence_snapshot);

  const expectedRequest = deriveV2EvidenceRequest({
    discovery_snapshot,
    controller: normalizedController,
  });
  const exactBySelector = assertExactEvidenceClosure(
    discovery_snapshot,
    evidence_snapshot,
    expectedRequest.artifactSelectors,
  );
  assertPermissionClosure(
    evidence_snapshot,
    expectedRequest.permissionSubjects,
    exactBySelector,
  );
  assertUnboundRequestCandidateAuthority(
    evidence_snapshot,
    normalizedController,
  );
  assertThreadResolutionClosure(
    discovery_snapshot,
    evidence_snapshot,
    normalizedController.thread_resolution_observations,
  );

  const requestComments = requestCommentsById(
    discovery_snapshot,
    normalizedController,
  );
  const requestBindings = requestBindingsById(
    normalizedController,
    requestComments,
    evidence_snapshot.scope.head_ref_oid,
  );
  const epoch = projectEpoch(evidence_snapshot);
  const requests = projectRequests({
    requestComments,
    requestBindings,
    evidenceSnapshot: evidence_snapshot,
  });
  const provider = projectProviderEvidence({
    discoverySnapshot: discovery_snapshot,
    evidenceSnapshot: evidence_snapshot,
    exactBySelector,
    controller: normalizedController,
  });
  bindProviderArtifacts(
    provider.artifacts,
    normalizedController.artifact_bindings,
    requests,
    exactBySelector,
  );
  const noStartObservations = projectNoStartObservations({
    discoverySnapshot: discovery_snapshot,
    evidenceSnapshot: evidence_snapshot,
    exactBySelector,
    controller: normalizedController,
    requests,
  });
  const generationAdmissions = projectGenerationAdmissions(
    normalizedController.generation_admissions,
    requests,
    epoch.head_oid,
  );

  const withoutFingerprint = {
    schema_version: 2,
    observed_at: evidence_snapshot.server_time,
    complete: true,
    selection: projectSelection(normalizedController),
    server_enforcement: projectServerEnforcement(normalizedController),
    review_epoch: epoch,
    scope_stable: true,
    inventories: {
      requests: true,
      artifacts: true,
      threads: true,
      acknowledgements: true,
      no_start: true,
    },
    requests,
    artifacts: provider.artifacts,
    threads: provider.threads,
    acknowledgements: provider.acknowledgements,
    no_start_observations: noStartObservations,
    generation_admissions: generationAdmissions,
    evidence_authority: {
      pagination_sha256: digestCanonical(
        "codex-review-gate-v2-pagination-authority",
        {
          pages: evidence_snapshot.pages,
          permissions: evidence_snapshot.permissions,
          service_start_observations:
            evidence_snapshot.service_start_observations,
        },
      ),
      final_reread_sha256: digestCanonical(
        "codex-review-gate-v2-final-reread-authority",
        transportLineage(
          discovery_snapshot,
          evidence_snapshot,
          normalizedController,
        ),
      ),
    },
    budget: structuredClone(normalizedController.budget),
  };
  const projected = {
    schema_version: withoutFingerprint.schema_version,
    observed_at: withoutFingerprint.observed_at,
    snapshot_fingerprint: digestCanonical(
      "codex-review-gate-v2-reducer-input",
      {
        reducer_semantics: withoutFingerprint,
        transport_lineage: transportLineage(
          discovery_snapshot,
          evidence_snapshot,
          normalizedController,
        ),
      },
    ),
    complete: withoutFingerprint.complete,
    selection: withoutFingerprint.selection,
    server_enforcement: withoutFingerprint.server_enforcement,
    review_epoch: withoutFingerprint.review_epoch,
    scope_stable: withoutFingerprint.scope_stable,
    inventories: withoutFingerprint.inventories,
    requests: withoutFingerprint.requests,
    artifacts: withoutFingerprint.artifacts,
    threads: withoutFingerprint.threads,
    acknowledgements: withoutFingerprint.acknowledgements,
    no_start_observations: withoutFingerprint.no_start_observations,
    generation_admissions: withoutFingerprint.generation_admissions,
    evidence_authority: withoutFingerprint.evidence_authority,
    budget: withoutFingerprint.budget,
  };
  assertV2ReducerInput(projected);
  return deepFreeze(projected);
}

/**
 * Derive the compact reducer selection and its public four-field projection
 * from one closed policy plus live server-enforcement facts. This is a pure
 * mapping, not an authority factory; production callers must obtain both
 * inputs from the branded preflight/control-plane adapter.
 */
export function deriveV2SelectionProjection({
  selection_policy,
  server_enforcement,
}) {
  oneOf(selection_policy, V2_SELECTION_POLICIES, "selection_policy");
  validateEnforcementReceipt(server_enforcement);
  const workflow = server_enforcement.workflow;
  const ruleset = server_enforcement.ruleset;
  let publicSelection;
  let reducerSelection;
  if (ruleset.required) {
    publicSelection = {
      selected: true,
      intent: "required",
      mode: "implicit",
      source: "active-ruleset",
    };
    reducerSelection = {
      intent: "implicit",
      eligible: true,
      reason: "Required by the active server ruleset",
    };
  } else if (workflow.present) {
    publicSelection = {
      selected: true,
      intent: "required",
      mode: "implicit",
      source: "workflow",
    };
    reducerSelection = {
      intent: "implicit",
      eligible: true,
      reason: "Required by the present caller workflow",
    };
  } else if (selection_policy === "joey-default") {
    publicSelection = {
      selected: true,
      intent: "required",
      mode: "implicit",
      source: "joey-default",
    };
    reducerSelection = {
      intent: "implicit",
      eligible: true,
      reason: "Required by the trusted Joey default policy",
    };
  } else if (selection_policy === "user-explicit") {
    publicSelection = {
      selected: true,
      intent: "explicit",
      mode: "explicit",
      source: "user-explicit",
    };
    reducerSelection = {
      intent: "explicit",
      eligible: true,
      reason: "Explicitly selected by the trusted selection policy",
    };
  } else if (selection_policy === "legacy-triple") {
    publicSelection = {
      selected: true,
      intent: "explicit",
      mode: "explicit",
      source: "legacy-triple",
    };
    reducerSelection = {
      intent: "explicit",
      eligible: true,
      reason: "Explicitly selected by the trusted legacy policy",
    };
  } else {
    publicSelection = {
      selected: false,
      intent: "none",
      mode: "none",
      source: "none",
    };
    reducerSelection = {
      intent: "disabled",
      eligible: false,
      reason: selection_policy === "required-infrastructure-only"
        ? "No required ruleset or caller workflow is present"
        : "Disabled by the trusted selection policy",
    };
  }
  return deepFreeze({
    selection_policy,
    public_selection: publicSelection,
    reducer_selection: reducerSelection,
  });
}

function assertThreadResolutionClosure(discovery, evidence, observations) {
  const discoveryThreads = new Map(
    discovery.pages.threads.map((thread) => [thread.id, thread]),
  );
  const evidenceThreads = new Map(
    evidence.pages.threads.map((thread) => [thread.id, thread]),
  );
  for (const observation of observations) {
    const before = discoveryThreads.get(observation.thread_id);
    const after = evidenceThreads.get(observation.thread_id);
    if (
      before === undefined ||
      after === undefined ||
      !isDeepStrictEqual(before, after) ||
      after.is_resolved !== true
    ) {
      throw projectorFailure(
        "THREAD_RESOLUTION_UNSTABLE",
        `thread ${observation.thread_id} is not a stable resolved object in both snapshots`,
      );
    }
  }
}

function assertCompleteTransportSnapshot(snapshot, label) {
  try {
    assertV2Snapshot(snapshot);
  } catch (error) {
    throw projectorFailure(
      "INVALID_TRANSPORT_SNAPSHOT",
      `${label} did not satisfy the closed transport schema: ${error.message}`,
      null,
      error,
    );
  }
  const incomplete = COMPLETE_KEYS.filter(
    (key) => snapshot.completeness[key] !== true,
  );
  if (incomplete.length > 0) {
    throw projectorFailure(
      "INCOMPLETE_TRANSPORT_SNAPSHOT",
      `${label} is incomplete: ${incomplete.join(", ")}`,
    );
  }
  if (
    !snapshot.stability.scope_stable ||
    !snapshot.stability.server_time_monotonic
  ) {
    throw projectorFailure(
      "UNSTABLE_TRANSPORT_SNAPSHOT",
      `${label} does not have stable scope and monotonic server time`,
    );
  }
  if (!snapshot.permissions.transport_capabilities.stable) {
    throw projectorFailure(
      "TRANSPORT_PERMISSION_UNSTABLE",
      `${label} transport-token permissions drifted across its point reads`,
    );
  }
}

function assertRawSnapshotContinuity(discovery, evidence) {
  const comparisons = [
    ["repository identity", discovery.repository, evidence.repository],
    ["pull-request lifecycle", discovery.pull_request, evidence.pull_request],
    ["review epoch", discovery.scope, evidence.scope],
    ["issue-comment inventory", discovery.pages.issue_comments, evidence.pages.issue_comments],
    ["review inventory", discovery.pages.reviews, evidence.pages.reviews],
    ["inline-comment inventory", discovery.pages.inline_comments, evidence.pages.inline_comments],
    ["thread inventory", discovery.pages.threads, evidence.pages.threads],
    ["reaction inventory", discovery.pages.reactions, evidence.pages.reactions],
    [
      "service-start inventory",
      serviceStartInventory(discovery.service_start_observations),
      serviceStartInventory(evidence.service_start_observations),
    ],
  ];
  for (const [label, initial, final] of comparisons) {
    if (!isDeepStrictEqual(initial, final)) {
      throw projectorFailure(
        "FINAL_REREAD_DRIFT",
        `discovery and evidence ${label} differ`,
      );
    }
  }
  if (Date.parse(evidence.server_time) < Date.parse(discovery.server_time)) {
    throw projectorFailure(
      "FINAL_REREAD_TIME_REGRESSED",
      "evidence snapshot server time precedes discovery snapshot server time",
    );
  }
}

function serviceStartInventory(observations) {
  const receipt = (value) => ({
    page_count: value.page_count,
    total_check_runs: value.total_check_runs,
    matching_app_ids: value.matching_app_ids,
    check_runs: value.check_runs,
    page_receipts: value.page_receipts.map((page) => ({
      page: page.page,
      item_count: page.item_count,
      total_count: page.total_count,
      raw_body_sha256: page.raw_body_sha256,
    })),
  });
  return {
    provider_app_slug: observations.provider_app_slug,
    head_sha: observations.head_sha,
    pre: receipt(observations.pre),
    post: receipt(observations.post),
    stable: observations.stable,
  };
}

function deriveSelectors(snapshot, requestBindings, currentHead) {
  const selectors = new Map();
  const add = (kind, id) => selectors.set(`${kind}:${id}`, { kind, id });
  const reviews = new Map(snapshot.pages.reviews.map((review) => [review.id, review]));

  for (const comment of snapshot.pages.issue_comments) {
    const native = issueCommentForCore(comment);
    const terminal = parseCodexIssueCommentTerminalHeading(comment.body ?? "");
    const binding = requestBindings.get(comment.id);
    const exactRequestBody = comment.body === V2_MANUAL_REVIEW_REQUEST;
    const currentRequest =
      exactRequestBody && binding?.head_oid === currentHead;
    const unboundRequestCandidate = exactRequestBody && binding === undefined;
    if (
      currentRequest ||
      unboundRequestCandidate ||
      isAddressCommandCandidate(comment.body) ||
      terminal.terminalLooking ||
      providerLike(comment)
    ) {
      add("issue_comment", comment.id);
    }
    // Invoke the closed parser during discovery too. A non-null result is a
    // selector even if future parser grammar adds a terminal shape.
    if (parseCodexIssueCommentArtifact(native, repositoryParserOptions(snapshot)) !== null) {
      add("issue_comment", comment.id);
    }
  }
  for (const review of snapshot.pages.reviews) {
    const native = reviewForCore(review);
    if (
      providerLike(review) ||
      REVIEW_TERMINAL_BODY.test(review.body ?? "") ||
      parseCodexReviewArtifact(native, repositoryParserOptions(snapshot)) !== null ||
      codexInlineParentReviewBodyHasClosedGrammar(native)
    ) {
      add("pull_request_review", review.id);
    }
  }
  for (const comment of snapshot.pages.inline_comments) {
    const parent = reviews.get(comment.pull_request_review_id);
    if (providerLike(comment) || (parent !== undefined && providerLike(parent))) {
      add("inline_comment", comment.id);
      add("pull_request_review", comment.pull_request_review_id);
    }
  }
  return [...selectors.values()].sort(compareSelectors);
}

function assertExactEvidenceClosure(discovery, evidence, selectors) {
  const expectedKeys = new Set(selectors.map(selectorKey));
  const actual = new Map();
  for (const exact of evidence.pages.exact_artifacts) {
    const key = selectorKey(exact.selector);
    if (!expectedKeys.has(key)) {
      throw projectorFailure(
        "UNEXPECTED_EXACT_ARTIFACT",
        `evidence snapshot refetched unselected artifact ${key}`,
      );
    }
    if (actual.has(key)) {
      throw projectorFailure("DUPLICATE_EXACT_ARTIFACT", `duplicate exact artifact ${key}`);
    }
    if (!DIGEST.test(exact.raw_body_sha256)) {
      throw projectorFailure(
        "INVALID_RAW_ARTIFACT_DIGEST",
        `exact artifact ${key} has no canonical raw-body digest`,
      );
    }
    const initial = inventoryArtifact(discovery, exact.selector);
    const final = inventoryArtifact(evidence, exact.selector);
    if (
      initial === null ||
      final === null ||
      !isDeepStrictEqual(initial, final) ||
      !isDeepStrictEqual(final, exact.artifact)
    ) {
      throw projectorFailure(
        "EXACT_ARTIFACT_DRIFT",
        `exact artifact ${key} did not preserve paginated identity and content`,
      );
    }
    actual.set(key, exact);
  }
  for (const key of expectedKeys) {
    if (!actual.has(key)) {
      throw projectorFailure(
        "MISSING_EXACT_ARTIFACT",
        `evidence snapshot did not refetch ${key}`,
      );
    }
  }
  return actual;
}

function assertPermissionClosure(snapshot, subjects, exactBySelector) {
  const expected = new Set(subjects.map(selectorKey));
  const actual = new Set();
  for (const permission of snapshot.permissions.actor_permissions) {
    const key = selectorKey(permission.subject);
    if (!expected.has(key)) {
      throw projectorFailure(
        "UNEXPECTED_ACTOR_PERMISSION",
        `evidence snapshot loaded permission for unselected subject ${key}`,
      );
    }
    if (actual.has(key)) {
      throw projectorFailure("DUPLICATE_ACTOR_PERMISSION", `duplicate permission ${key}`);
    }
    const exact = exactBySelector.get(key);
    if (
      exact === undefined ||
      exact.artifact.author === null ||
      !isDeepStrictEqual(permission.actor, exact.artifact.author)
    ) {
      throw projectorFailure(
        "PERMISSION_ACTOR_DRIFT",
        `permission actor for ${key} differs from the exact request actor`,
      );
    }
    if (!permission.stable) {
      throw projectorFailure(
        "PERMISSION_UNSTABLE",
        `permission for ${key} drifted or became unreadable across point reads`,
      );
    }
    if (
      !DIGEST.test(permission.pre.raw_body_sha256) ||
      !DIGEST.test(permission.post.raw_body_sha256)
    ) {
      throw projectorFailure(
        "INVALID_PERMISSION_DIGEST",
        `permission for ${key} has no canonical raw-body digests`,
      );
    }
    actual.add(key);
  }
  for (const key of expected) {
    if (!actual.has(key)) {
      throw projectorFailure(
        "MISSING_ACTOR_PERMISSION",
        `manual request ${key} has no two-point actor permission receipt`,
      );
    }
  }
}

function assertUnboundRequestCandidateAuthority(snapshot, controller) {
  const boundIds = new Set(
    controller.request_bindings.map((binding) => binding.id),
  );
  const permissions = new Map(
    snapshot.permissions.actor_permissions.map((permission) => [
      permission.subject.id,
      permission,
    ]),
  );
  for (const comment of snapshot.pages.issue_comments) {
    if (
      comment.body !== V2_MANUAL_REVIEW_REQUEST ||
      boundIds.has(comment.id)
    ) {
      continue;
    }
    const permission = permissions.get(comment.id);
    if (permission === undefined) {
      throw projectorFailure(
        "MISSING_ACTOR_PERMISSION",
        `unbound request candidate ${comment.id} has no two-point actor permission receipt`,
      );
    }
    const initiallyAuthorized = permission.pre.permissions.push;
    const finallyAuthorized = permission.post.permissions.push;
    if (!initiallyAuthorized && !finallyAuthorized) {
      continue;
    }
    if (!initiallyAuthorized || !finallyAuthorized) {
      throw projectorFailure(
        "REQUEST_PERMISSION_UNSTABLE",
        `unbound request candidate ${comment.id} does not have stable no-push authority`,
      );
    }
    throw projectorFailure(
      "REQUEST_BINDING_MISSING",
      `authorized exact request ${comment.id} has no persistent controller binding`,
    );
  }
}

function projectEpoch(snapshot) {
  const scope = snapshot.scope;
  return {
    repository_id: snapshot.repository.node_id,
    pull_request_number: snapshot.pull_request.number,
    base_oid: scope.base_ref_tip,
    head_oid: scope.head_ref_oid,
    merge_base_oid: scope.merge_base_sha,
    merge_oid: scope.potential_merge_oid,
    merge_tree_oid: scope.potential_merge_tree,
    merge_parents: [...scope.ordered_parent_oids],
    merge_ref_oid: scope.merge_ref_oid,
    mergeable: scope.mergeable,
    lifecycle: lifecycle(snapshot.pull_request),
  };
}

function projectRequests({ requestComments, requestBindings, evidenceSnapshot }) {
  const permissions = new Map(
    evidenceSnapshot.permissions.actor_permissions.map((permission) => [
      permission.subject.id,
      permission,
    ]),
  );
  return [...requestComments.values()]
    .filter((comment) =>
      requestBindings.get(comment.id)?.head_oid ===
        evidenceSnapshot.scope.head_ref_oid)
    .sort(compareIds)
    .map((comment) => {
      const binding = requestBindings.get(comment.id);
      return {
        id: comment.id,
        url: comment.html_url,
        kind: binding.kind,
        body: comment.body,
        created_at: comment.created_at,
        updated_at: comment.updated_at,
        controlled: binding.controlled,
        stable: true,
        base_oid: binding.base_oid,
        head_oid: binding.head_oid,
        current_incarnation: binding.current_incarnation,
        actor_permission: binding.kind === "manual"
          ? projectActorPermission(permissions.get(comment.id))
          : null,
        generation_id: binding.generation_id,
        generation_kind: binding.generation_kind,
        generation_index: binding.generation_index,
      };
    });
}

function projectGenerationAdmissions(admissions, requests, currentHead) {
  const requestsById = new Map(requests.map((request) => [request.id, request]));
  return admissions.map((admission) => {
    const prior = requestsById.get(admission.prior_request_id);
    const next = requestsById.get(admission.next_request_id);
    if (
      admission.head_oid !== currentHead ||
      prior?.generation_id !== admission.prior_generation_id ||
      next?.generation_id !== admission.next_generation_id ||
      prior.head_oid !== currentHead ||
      next.head_oid !== currentHead ||
      Date.parse(admission.transition_server_time) <=
        Date.parse(prior.created_at) ||
      Date.parse(admission.transition_server_time) >=
        Date.parse(next.created_at)
    ) {
      throw projectorFailure(
        "GENERATION_ADMISSION_LINEAGE_INVALID",
        `generation admission ${admission.next_generation_id} is not bound to its same-head request transition`,
      );
    }
    return structuredClone(admission);
  });
}

function projectActorPermission(permission) {
  if (permission === undefined) {
    throw projectorFailure(
      "MISSING_ACTOR_PERMISSION",
      "manual request permission disappeared before projection",
    );
  }
  return {
    assurance: "point-in-time-only",
    request_time_permission: "unproven",
    permission_aba_excluded: false,
    initial: permissionObservation(permission.pre),
    final: permissionObservation(permission.post),
  };
}

function bindProviderArtifacts(artifacts, bindings, requests, exactBySelector) {
  const requestsById = new Map(requests.map((request) => [request.id, request]));
  const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  for (const binding of bindings) {
    const artifact = artifactsById.get(binding.id);
    const request = requestsById.get(binding.request_id);
    if (artifact === undefined || request === undefined) {
      if (isRichArtifactBinding(binding)) {
        throw artifactBindingReceiptMismatch(binding.id);
      }
      throw projectorFailure(
        "ARTIFACT_GENERATION_BINDING_INVALID",
        `artifact binding ${binding.id} does not bind an observed artifact and request generation`,
      );
    }
    if (Date.parse(artifact.created_at) <= Date.parse(request.created_at)) {
      throw projectorFailure(
        "ARTIFACT_GENERATION_ORDER_INVALID",
        `artifact ${binding.id} is not strictly later than request ${binding.request_id}`,
      );
    }
    if (!isRichArtifactBinding(binding)) {
      // Historical two-field receipts predate exact carrier commitments. They
      // remain sufficient for fail-closed findings and recovery bookkeeping,
      // but can never authorize a positive terminal-clean result.
      if (artifact.kind === "terminal-findings") {
        artifact.request_id = request.id;
      }
      continue;
    }
    if (!artifactBindingMatchesExactArtifact(
      binding,
      artifact,
      request,
      exactBySelector,
    )) {
      throw artifactBindingReceiptMismatch(binding.id);
    }
    if (artifact.kind === "terminal-findings") {
      artifact.request_id = request.id;
    }
  }
}

function artifactBindingMatchesExactArtifact(
  binding,
  artifact,
  request,
  exactBySelector,
) {
  const exactReceipt = exactBySelector.get(selectorKey(binding.artifact_selector));
  const exactRequest = exactBySelector.get(`issue_comment:${request.id}`);
  if (exactReceipt === undefined) {
    return false;
  }
  const nativeArtifact = exactReceipt.artifact;
  const nativeCreatedAt = binding.artifact_selector.kind === "pull_request_review"
    ? nativeArtifact.submitted_at
    : nativeArtifact.created_at;
  return binding.id === binding.artifact_selector.id &&
    binding.generation_id === request.generation_id &&
    exactRequest?.artifact.node_id === binding.request_node_id &&
    binding.artifact_type === binding.artifact_selector.kind &&
    artifact.id === binding.id &&
    artifact.url === binding.artifact_url &&
    artifact.created_at === binding.artifact_created_at &&
    nativeArtifact.id === binding.id &&
    nativeArtifact.node_id === binding.artifact_node_id &&
    nativeArtifact.html_url === binding.artifact_url &&
    nativeCreatedAt === binding.artifact_created_at &&
    exactReceipt.raw_body_sha256 === binding.raw_body_sha256 &&
    isDeepStrictEqual(nativeArtifact.author, binding.actor) &&
    isDeepStrictEqual(nativeArtifact.app, binding.app);
}

function artifactBindingReceiptMismatch(id) {
  return projectorFailure(
    "ARTIFACT_BINDING_RECEIPT_MISMATCH",
    `artifact binding ${id} does not match the current exact carrier receipt`,
  );
}

function isRichArtifactBinding(binding) {
  return Object.hasOwn(binding, "artifact_selector");
}

function permissionObservation(receipt) {
  return {
    observed_at: receipt.response_server_time,
    actor: reducerActor(receipt.actor),
    push: receipt.permissions.push,
  };
}

function projectProviderEvidence({
  discoverySnapshot,
  evidenceSnapshot,
  exactBySelector,
  controller,
}) {
  const snapshot = evidenceSnapshot;
  const artifacts = [];
  const threads = [];
  const acknowledgements = [];
  const historicalTopLevelCarriers = [];
  const parserOptions = repositoryParserOptions(snapshot);
  const nativeReviews = snapshot.pages.reviews.map(reviewForCore);
  const nativeInline = snapshot.pages.inline_comments.map(inlineCommentForCore);
  const nativeThreads = snapshot.pages.threads.map(threadForCore);
  const threadEvidence = collectCodexThreadEvidence(
    nativeInline,
    nativeReviews,
    nativeThreads,
    V2_CODEX_BOT_LOGINS,
    snapshot.scope.head_ref_oid,
  );
  if (threadEvidence.errors.length > 0 || threadEvidence.transientErrors.length > 0) {
    throw projectorFailure(
      "INCOMPLETE_THREAD_EVIDENCE",
      "closed thread evidence could not be established",
      {
        errors: threadEvidence.errors,
        transient_errors: threadEvidence.transientErrors,
      },
    );
  }
  const reviewsById = new Map(snapshot.pages.reviews.map((review) => [review.id, review]));
  const inlineParentIds = new Set(
    threadEvidence.validatedCodexInlineParentReviewIds.filter((id) =>
      providerLike(reviewsById.get(id))),
  );

  for (const comment of snapshot.pages.issue_comments) {
    if (!exactBySelector.has(`issue_comment:${comment.id}`)) {
      continue;
    }
    const parsed = parseCodexIssueCommentArtifact(
      issueCommentForCore(comment),
      parserOptions,
    );
    if (parsed === null || parsed.kind === "pending") {
      continue;
    }
    if (
      parsed.kind === "finding" &&
      parsed.headSha !== snapshot.scope.head_ref_oid &&
      providerLike(comment)
    ) {
      historicalTopLevelCarriers.push({
        carrier: comment,
        finding_created_at: parsed.createdAt,
      });
    }
    const projected = projectParsedArtifact(
      parsed,
      comment,
      snapshot.scope.head_ref_oid,
      "issue-comment",
    );
    if (projected !== null) {
      artifacts.push(projected.artifact);
      threads.push(...projected.threads);
    }
  }
  for (const review of snapshot.pages.reviews) {
    if (
      !exactBySelector.has(`pull_request_review:${review.id}`) ||
      inlineParentIds.has(review.id) ||
      !providerLike(review)
    ) {
      continue;
    }
    const parsed = parseCodexReviewArtifact(reviewForCore(review), parserOptions);
    if (parsed === null) {
      continue;
    }
    if (
      parsed.kind === "finding" &&
      parsed.headSha !== snapshot.scope.head_ref_oid
    ) {
      historicalTopLevelCarriers.push({
        carrier: review,
        finding_created_at: parsed.createdAt,
      });
    }
    const projected = projectParsedArtifact(
      parsed,
      review,
      snapshot.scope.head_ref_oid,
      "pull-request-review",
    );
    if (projected !== null) {
      artifacts.push(projected.artifact);
      threads.push(...projected.threads);
    }
  }

  projectInlineFindings({
    snapshot,
    inlineParentIds,
    artifacts,
    threads,
    resolutionObservations: controller.thread_resolution_observations,
    // Without a controller receipt, use the final snapshot time as a
    // deliberately conservative post-observation barrier. This is not a
    // provider resolution timestamp and forces recovery onto a future request.
    fallbackResolutionObservedAt: evidenceSnapshot.server_time,
  });
  projectRequestReactions(
    snapshot,
    acknowledgements,
    new Set(controller.request_bindings
      .filter((binding) => binding.head_oid === snapshot.scope.head_ref_oid)
      .map((binding) => binding.id)),
  );
  projectAddressedAcknowledgements({
    snapshot,
    exactBySelector,
    artifacts,
    threads,
    acknowledgements,
    historicalTopLevelCarriers,
  });

  return {
    artifacts: artifacts.sort(compareIds),
    threads: threads.sort((left, right) => left.id.localeCompare(right.id)),
    acknowledgements: acknowledgements.sort(compareIds),
  };
}

function projectParsedArtifact(parsed, nativeArtifact, currentHead, channel) {
  let commitOid;
  if (parsed.kind === "clean") {
    const reference = parsed.headSha ?? parsed.commitRef ?? null;
    if (reference === null) {
      return null;
    }
    if (reference.length !== 40) {
      // The snapshots contain no repository-wide uniqueness proof for a short
      // prefix, so it cannot be promoted to an exact commit identity.
      return null;
    }
    commitOid = reference;
  } else if (parsed.kind === "finding") {
    commitOid = parsed.headSha;
  } else {
    // Malformed terminal-looking issue comments have no trustworthy commit
    // lineage. Binding them to the current audit epoch is deliberately only a
    // fail-closed negative projection; it can never produce a clean result.
    commitOid = nativeArtifact.commit_id ?? currentHead;
  }
  if (!SHA.test(commitOid)) {
    throw projectorFailure(
      "UNBOUND_PROVIDER_ARTIFACT",
      `provider artifact ${nativeArtifact.id} has no full commit identity`,
    );
  }
  if (parsed.kind !== "malformed" && commitOid !== currentHead) {
    // Historical provider artifacts remain bound into the transport lineage,
    // but reducer evidence contains only the exact current-head epoch.
    return null;
  }

  // A terminal carrier is one top-level finding identity even when its body
  // contains multiple samples. One exact address command closes that carrier
  // as a unit; samples remain parser/audit data, not independently closable
  // identities.
  const findingIds = parsed.kind === "finding"
    ? [findingId(nativeArtifact.id, 0, parsed.samples.join("\n"))]
    : [];
  const artifact = {
    id: nativeArtifact.id,
    url: nativeArtifact.html_url,
    kind: parsed.kind === "clean"
      ? "terminal-clean"
      : parsed.kind === "finding"
        ? "terminal-findings"
        : "malformed",
    channel,
    request_id: null,
    created_at: parsed.createdAt,
    commit_oid: commitOid,
    stable: true,
    finding_ids: findingIds,
  };
  const projectedThreads = findingIds.map((id, index) => ({
    id: `top-level:${nativeArtifact.id}:${index}`,
    finding_id: id,
    kind: "top-level",
    created_at: parsed.createdAt,
    is_resolved: false,
    resolution_observed_at: null,
    stable: true,
  }));
  return { artifact, threads: projectedThreads };
}

function projectInlineFindings({
  snapshot,
  inlineParentIds,
  artifacts,
  threads,
  resolutionObservations,
  fallbackResolutionObservedAt,
}) {
  const observations = new Map(
    resolutionObservations.map((observation) => [observation.thread_id, observation]),
  );
  const inlineById = new Map(
    snapshot.pages.inline_comments.map((comment) => [comment.id, comment]),
  );
  const findingIdsByReview = new Map();
  const createdAtByReview = new Map();
  for (const thread of snapshot.pages.threads) {
    const comments = thread.comments
      .map((comment) => inlineById.get(comment.database_id))
      .filter((comment) => comment !== undefined && providerLike(comment));
    if (comments.length === 0) {
      continue;
    }
    const parentIds = new Set(comments.map((comment) => comment.pull_request_review_id));
    if (parentIds.size !== 1) {
      throw projectorFailure(
        "INLINE_FINDING_PARENT_DRIFT",
        `unresolved provider thread ${thread.id} has conflicting parent reviews`,
      );
    }
    const reviewId = [...parentIds][0];
    if (!inlineParentIds.has(reviewId)) {
      throw projectorFailure(
        "INLINE_PARENT_NOT_CLOSED",
        `inline parent review ${reviewId} did not satisfy closed provider grammar`,
      );
    }
    const currentHeadComments = comments.filter((comment) => {
      const parent = snapshot.pages.reviews.find(
        (review) => review.id === comment.pull_request_review_id,
      );
      return parent?.commit_id === snapshot.scope.head_ref_oid;
    });
    if (currentHeadComments.length === 0) {
      continue;
    }
    const finding = {
      id: `thread:${thread.id}`,
    };
    const ids = findingIdsByReview.get(reviewId) ?? [];
    ids.push(finding.id);
    findingIdsByReview.set(reviewId, ids);
    const firstCreated = currentHeadComments
      .map((comment) => comment.created_at)
      .sort(compareTimestamps)[0];
    createdAtByReview.set(reviewId, firstCreated);
    const observation = observations.get(thread.id) ?? null;
    if (
      observation !== null &&
      (!thread.is_resolved ||
        observation.is_resolved !== true ||
        observation.repository_id !== snapshot.repository.node_id ||
        observation.pull_request_number !== snapshot.pull_request.number ||
        observation.head_oid !== snapshot.scope.head_ref_oid ||
        Date.parse(observation.response_server_time) > Date.parse(snapshot.server_time))
    ) {
      throw projectorFailure(
        "THREAD_RESOLUTION_RECEIPT_MISMATCH",
        `thread resolution receipt ${thread.id} does not bind the final transport state`,
      );
    }
    threads.push({
      id: thread.id,
      finding_id: finding.id,
      kind: "inline",
      created_at: firstCreated,
      is_resolved: thread.is_resolved,
      // This is the lower-bound time of a GitHub response that observed
      // isResolved=true. It is not the provider's resolution timestamp.
      resolution_observed_at: thread.is_resolved
        ? observation?.response_server_time ?? fallbackResolutionObservedAt
        : null,
      stable: true,
    });
  }
  for (const [reviewId, findingIds] of findingIdsByReview) {
    const nativeReview = snapshot.pages.reviews.find((review) => review.id === reviewId);
    artifacts.push({
      id: reviewId,
      url: nativeReview.html_url,
      kind: "terminal-findings",
      channel: "pull-request-review",
      request_id: null,
      created_at: createdAtByReview.get(reviewId),
      commit_oid: snapshot.scope.head_ref_oid,
      stable: true,
      finding_ids: [...new Set(findingIds)].sort(),
    });
  }
}

function projectRequestReactions(snapshot, acknowledgements, currentRequestIds) {
  for (const group of snapshot.pages.reactions.issue_comments) {
    if (!currentRequestIds.has(group.subject_id)) {
      continue;
    }
    for (const reaction of group.reactions) {
      const actor = reaction.author === null ? null : {
        login: reaction.author.login,
        type: reaction.author.type,
      };
      if (
        !isExactV2CodexProviderIdentity(actor) ||
        (reaction.content !== "+1" && reaction.content !== "eyes")
      ) {
        continue;
      }
      acknowledgements.push({
        id: reaction.id,
        kind: reaction.content === "+1" ? "plus-one" : "eyes",
        request_id: group.subject_id,
        finding_id: null,
        created_at: reaction.created_at,
        commit_oid: snapshot.scope.head_ref_oid,
        exact_provider: true,
        stable: true,
      });
    }
  }
}

function projectAddressedAcknowledgements({
  snapshot,
  exactBySelector,
  artifacts,
  threads,
  acknowledgements,
  historicalTopLevelCarriers,
}) {
  const permissions = new Map(
    snapshot.permissions.actor_permissions.map((permission) => [
      selectorKey(permission.subject),
      permission,
    ]),
  );
  const carrierById = new Map([
    ...snapshot.pages.issue_comments.map((carrier) => [
      `issue_comment:${carrier.id}`,
      carrier,
    ]),
    ...snapshot.pages.reviews.map((carrier) => [
      `pull_request_review:${carrier.id}`,
      carrier,
    ]),
  ]);
  const addressable = [];
  for (const artifact of artifacts) {
    if (artifact.kind !== "terminal-findings") {
      continue;
    }
    const topLevelFindingIds = threads
      .filter((thread) =>
        thread.kind === "top-level" &&
        artifact.finding_ids.includes(thread.finding_id))
      .map((thread) => thread.finding_id);
    if (topLevelFindingIds.length === 0) {
      continue;
    }
    const carriers = [
      carrierById.get(`issue_comment:${artifact.id}`),
      carrierById.get(`pull_request_review:${artifact.id}`),
    ].filter((carrier) => carrier !== undefined && providerLike(carrier));
    if (carriers.length !== 1) {
      throw projectorFailure(
        "TOP_LEVEL_CARRIER_AMBIGUOUS",
        `top-level finding ${artifact.id} does not have one exact provider carrier`,
      );
    }
    if (topLevelFindingIds.length !== 1) {
      throw projectorFailure(
        "TOP_LEVEL_FINDING_NOT_AGGREGATED",
        `top-level carrier ${artifact.id} must project as one finding identity`,
      );
    }
    const carrier = carriers[0];
    assertCanonicalCarrierHtmlUrl(carrier, snapshot);
    addressable.push({
      finding_id: topLevelFindingIds[0],
      carrier_url: carrier.html_url,
      finding_created_at: artifact.created_at,
    });
  }

  for (const comment of snapshot.pages.issue_comments) {
    if (!isAddressCommandCandidate(comment.body)) {
      continue;
    }
    const exactKey = `issue_comment:${comment.id}`;
    if (!exactBySelector.has(exactKey)) {
      throw projectorFailure(
        "ADDRESS_COMMAND_NOT_EXACT",
        `address command ${comment.id} was not exact-refetched`,
      );
    }
    const permission = permissions.get(exactKey);
    if (
      permission === undefined ||
      !permission.stable ||
      comment.author === null ||
      !isDeepStrictEqual(permission.actor, comment.author)
    ) {
      throw projectorFailure(
        "ADDRESS_COMMAND_PERMISSION_INVALID",
        `address command ${comment.id} has no stable two-point actor authority`,
      );
    }
    if (comment.author.type !== "User") {
      continue;
    }
    const initiallyAuthorized = permission.pre.permissions.push;
    const finallyAuthorized = permission.post.permissions.push;
    if (!initiallyAuthorized && !finallyAuthorized) {
      continue;
    }
    if (!initiallyAuthorized || !finallyAuthorized) {
      throw projectorFailure(
        "ADDRESS_COMMAND_PERMISSION_INVALID",
        `address command ${comment.id} has no stable two-point write authority`,
      );
    }
    if (comment.created_at !== comment.updated_at) {
      throw projectorFailure(
        "ADDRESS_COMMAND_EDITED",
        `address command ${comment.id} was edited`,
      );
    }
    const targetUrl = parseAddressCommand(comment.body);
    if (targetUrl === null) {
      throw projectorFailure(
        "ADDRESS_COMMAND_TARGET_INVALID",
        `address command ${comment.id} has no canonical target URL`,
      );
    }
    const matches = addressable.filter((finding) => finding.carrier_url === targetUrl);
    const historicalMatches = historicalTopLevelCarriers.filter(
      ({ carrier }) => carrier.html_url === targetUrl,
    );
    if (matches.length + historicalMatches.length !== 1) {
      throw projectorFailure(
        "ADDRESS_COMMAND_TARGET_INVALID",
        `address command ${comment.id} does not bind one top-level carrier`,
      );
    }
    if (historicalMatches.length === 1) {
      const historical = historicalMatches[0];
      assertCanonicalCarrierHtmlUrl(historical.carrier, snapshot);
      if (
        Date.parse(comment.created_at) <=
          Date.parse(historical.finding_created_at)
      ) {
        throw projectorFailure(
          "ADDRESS_COMMAND_NOT_LATER",
          `address command ${comment.id} is not strictly later than its finding`,
        );
      }
      continue;
    }
    const selected = matches[0];
    if (Date.parse(comment.created_at) <= Date.parse(selected.finding_created_at)) {
      throw projectorFailure(
        "ADDRESS_COMMAND_NOT_LATER",
        `address command ${comment.id} is not strictly later than its finding`,
      );
    }
    acknowledgements.push({
      id: comment.id,
      kind: "addressed",
      request_id: null,
      finding_id: selected.finding_id,
      created_at: comment.created_at,
      commit_oid: snapshot.scope.head_ref_oid,
      exact_provider: false,
      stable: true,
    });
  }
  acknowledgements.sort(compareIds);
}

function projectNoStartObservations({
  discoverySnapshot,
  evidenceSnapshot,
  exactBySelector,
  controller,
  requests,
}) {
  const requestsById = new Map(requests.map((request) => [request.id, request]));
  const projected = [];
  const ids = new Set();
  for (const observation of controller.no_start_observations) {
    const selector = observation.carrier_selector;
    const exactKey = selectorKey(selector);
    const carrier = inventoryArtifact(evidenceSnapshot, selector);
    const exactReceipt = exactBySelector.get(exactKey);
    const request = requestsById.get(observation.request_id);
    if (
      request === undefined ||
      request.kind !== "automatic" ||
      carrier === null ||
      exactReceipt === undefined ||
      !providerLike(carrier) ||
      !V2_NO_START_BODIES.includes(carrier.body) ||
      carrier.created_at !== carrier.updated_at
    ) {
      throw projectorFailure(
        "NO_START_RECEIPT_MISMATCH",
        `no-start receipt ${exactKey} does not bind one stable exact-provider carrier and request`,
      );
    }
    const discoveryCarrier = inventoryArtifact(discoverySnapshot, selector);
    if (discoveryCarrier === null || !isDeepStrictEqual(discoveryCarrier, carrier)) {
      throw projectorFailure(
        "NO_START_CARRIER_UNSTABLE",
        `no-start carrier ${exactKey} was not stable across both snapshots`,
      );
    }
    if (
      Date.parse(carrier.created_at) <= Date.parse(request.created_at) ||
      Date.parse(observation.first_seen_at) < Date.parse(carrier.created_at) ||
      Date.parse(observation.first_seen_at) > Date.parse(discoverySnapshot.server_time)
    ) {
      throw projectorFailure(
        "NO_START_CAUSAL_ORDER_INVALID",
        `no-start carrier ${exactKey} does not strictly follow its request and first observation`,
      );
    }
    if (providerActivityVetoesNoStart({
      discoverySnapshot,
      evidenceSnapshot,
      request,
      carrierId: carrier.id,
    })) {
      continue;
    }
    if (ids.has(carrier.id)) {
      throw projectorFailure(
        "NO_START_CARRIER_DUPLICATE",
        `no-start carrier ${exactKey} has duplicate controller history`,
      );
    }
    ids.add(carrier.id);
    projected.push({
      id: carrier.id,
      url: carrier.html_url,
      request_id: observation.request_id,
      body: carrier.body,
      carrier_created_at: carrier.created_at,
      exact_provider: true,
      stable: true,
      first_seen_at: observation.first_seen_at,
      confirmed_at: evidenceSnapshot.server_time,
      first_run_id: observation.first_run_id,
      confirmation_run_id: observation.confirmation_run_id,
      request_run_id: observation.request_run_id,
    });
  }
  return projected.sort(compareIds);
}

function providerActivityVetoesNoStart({
  discoverySnapshot,
  evidenceSnapshot,
  request,
  carrierId,
}) {
  for (const snapshot of [discoverySnapshot, evidenceSnapshot]) {
    const observations = snapshot.service_start_observations;
    if (
      !observations.stable ||
      !snapshot.stability.service_start_observations_stable
    ) {
      return true;
    }
    const runs = new Map([
      ...observations.pre.check_runs,
      ...observations.post.check_runs,
    ].map((run) => [run.id, run]));
    for (const run of runs.values()) {
      if (
        !isExactV2CodexProviderApp(run.app) ||
        run.started_at === null ||
        run.completed_at === null ||
        Date.parse(run.completed_at) >= Date.parse(request.created_at)
      ) {
        return true;
      }
    }

    for (const comment of snapshot.pages.issue_comments) {
      if (
        comment.id !== carrierId &&
        providerLike(comment) &&
        (Date.parse(comment.created_at) >= Date.parse(request.created_at) ||
          Date.parse(comment.updated_at) >= Date.parse(request.created_at))
      ) {
        return true;
      }
    }
    for (const review of snapshot.pages.reviews) {
      if (
        providerLike(review) &&
        (review.submitted_at === null ||
          Date.parse(review.submitted_at) >= Date.parse(request.created_at))
      ) {
        return true;
      }
    }
    for (const comment of snapshot.pages.inline_comments) {
      if (
        providerLike(comment) &&
        (Date.parse(comment.created_at) >= Date.parse(request.created_at) ||
          Date.parse(comment.updated_at) >= Date.parse(request.created_at))
      ) {
        return true;
      }
    }
    if (request.current_incarnation) {
      for (const group of snapshot.pages.reactions.issue_comments) {
        if (group.subject_id !== request.id) {
          continue;
        }
        for (const reaction of group.reactions) {
          const actor = reaction.author === null
            ? null
            : { login: reaction.author.login, type: reaction.author.type };
          if (
            isExactV2CodexProviderIdentity(actor) &&
            (reaction.content === "+1" || reaction.content === "eyes") &&
            Date.parse(reaction.created_at) >= Date.parse(request.created_at)
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

function normalizeController(value) {
  exactObject(value, CONTROLLER_KEYS, "controller");
  exact(value.schema, V2_PROJECTOR_CONTROLLER_SCHEMA, "controller.schema");
  exact(
    value.schema_version,
    V2_PROJECTOR_CONTROLLER_SCHEMA_VERSION,
    "controller.schema_version",
  );
  exactObject(value.selection, ["policy"], "controller.selection");
  oneOf(
    value.selection.policy,
    V2_SELECTION_POLICIES,
    "controller.selection.policy",
  );
  exactObject(
    value.server_enforcement,
    ["workflow", "ruleset", "app"],
    "controller.server_enforcement",
  );
  validateEnforcementReceipt(value.server_enforcement);
  exactObject(
    value.budget,
    [
      "automatic_requests_on_head",
      "automatic_reservations_on_head",
      "manual_requests_in_epoch",
    ],
    "controller.budget",
  );
  for (const key of Object.keys(value.budget)) {
    nonNegativeInteger(value.budget[key], `controller.budget.${key}`);
  }
  if (!Array.isArray(value.request_bindings)) {
    throw new TypeError("controller.request_bindings must be an array");
  }
  const bindingIds = new Set();
  value.request_bindings.forEach((binding, index) => {
    const label = `controller.request_bindings[${index}]`;
    exactObject(binding, REQUEST_BINDING_KEYS, label);
    decimal(binding.id, `${label}.id`);
    oneOf(binding.kind, ["automatic", "manual"], `${label}.kind`);
    sha(binding.base_oid, `${label}.base_oid`);
    sha(binding.head_oid, `${label}.head_oid`);
    boolean(binding.current_incarnation, `${label}.current_incarnation`);
    boolean(binding.controlled, `${label}.controlled`);
    oneOf(binding.generation_kind, ["automatic", "manual"], `${label}.generation_kind`);
    nonNegativeInteger(binding.generation_index, `${label}.generation_index`);
    if (binding.generation_index < 1 || binding.generation_index > (binding.kind === "automatic" ? 3 : 64)) {
      throw new TypeError(`${label}.generation_index is outside its generation budget`);
    }
    exact(binding.generation_kind, binding.kind, `${label}.generation_kind`);
    exact(
      binding.generation_id,
      `${binding.generation_kind}:${binding.generation_index}`,
      `${label}.generation_id`,
    );
    if (bindingIds.has(binding.id)) {
      throw new TypeError(`controller.request_bindings repeats id ${binding.id}`);
    }
    bindingIds.add(binding.id);
  });
  if (!Array.isArray(value.generation_admissions) ||
      value.generation_admissions.length > 2) {
    throw new TypeError("controller.generation_admissions must be a bounded array");
  }
  const admittedNextGenerations = new Set();
  value.generation_admissions.forEach((admission, index) => {
    const label = `controller.generation_admissions[${index}]`;
    exactObject(admission, GENERATION_ADMISSION_KEYS, label);
    const priorMatch = /^automatic:([1-2])$/u.exec(admission.prior_generation_id);
    const nextMatch = /^automatic:([2-3])$/u.exec(admission.next_generation_id);
    if (
      priorMatch === null ||
      nextMatch === null ||
      Number(priorMatch[1]) !== index + 1 ||
      Number(nextMatch[1]) !== index + 2
    ) {
      throw new TypeError(`${label} must advance one ordered automatic generation`);
    }
    decimal(admission.prior_request_id, `${label}.prior_request_id`);
    decimal(admission.next_request_id, `${label}.next_request_id`);
    sha(admission.head_oid, `${label}.head_oid`);
    sha(admission.prior_request_binding_record_oid,
      `${label}.prior_request_binding_record_oid`);
    sha(admission.recovery_transition_record_oid,
      `${label}.recovery_transition_record_oid`);
    sha(admission.next_request_binding_record_oid,
      `${label}.next_request_binding_record_oid`);
    if (!DIGEST.test(admission.recovery_transition_payload_digest) ||
        !DIGEST.test(admission.next_request_binding_payload_digest)) {
      throw new TypeError(`${label} must bind both durable payload digests`);
    }
    timestamp(admission.transition_server_time,
      `${label}.transition_server_time`);
    exactObject(admission.ledger_order,
      GENERATION_ADMISSION_LEDGER_ORDER_KEYS, `${label}.ledger_order`);
    const priorOrder = admission.ledger_order.prior_request_binding_index;
    const transitionOrder = admission.ledger_order.recovery_transition_index;
    const nextOrder = admission.ledger_order.next_request_binding_index;
    for (const [field, position] of Object.entries(admission.ledger_order)) {
      nonNegativeInteger(position, `${label}.ledger_order.${field}`);
    }
    if (!(priorOrder < transitionOrder && transitionOrder < nextOrder)) {
      throw new TypeError(`${label}.ledger_order is not strictly causal`);
    }
    if (admittedNextGenerations.has(admission.next_generation_id)) {
      throw new TypeError(`${label} repeats a next generation`);
    }
    admittedNextGenerations.add(admission.next_generation_id);
    const previous = value.generation_admissions[index - 1];
    if (
      previous !== undefined &&
      (
        previous.next_generation_id !== admission.prior_generation_id ||
        previous.next_request_id !== admission.prior_request_id ||
        previous.next_request_binding_record_oid !==
          admission.prior_request_binding_record_oid ||
        previous.ledger_order.next_request_binding_index !==
          admission.ledger_order.prior_request_binding_index
      )
    ) {
      throw new TypeError(`${label} does not continue the prior durable admission`);
    }
  });
  if (!Array.isArray(value.artifact_bindings)) {
    throw new TypeError("controller.artifact_bindings must be an array");
  }
  const artifactBindingIds = new Set();
  value.artifact_bindings.forEach((binding, index) => {
    const label = `controller.artifact_bindings[${index}]`;
    const rich = Object.hasOwn(binding, "artifact_selector");
    exactObject(
      binding,
      rich ? ARTIFACT_BINDING_KEYS : LEGACY_ARTIFACT_BINDING_KEYS,
      label,
    );
    decimal(binding.id, `${label}.id`);
    decimal(binding.request_id, `${label}.request_id`);
    if (rich) {
      exactObject(binding.artifact_selector, ["kind", "id"],
        `${label}.artifact_selector`);
      oneOf(binding.artifact_selector.kind, [...SELECTOR_KINDS],
        `${label}.artifact_selector.kind`);
      decimal(binding.artifact_selector.id, `${label}.artifact_selector.id`);
      exact(binding.artifact_selector.id, binding.id,
        `${label}.artifact_selector.id`);
      boundedString(binding.artifact_node_id, `${label}.artifact_node_id`, 256);
      if (!/^(?:automatic|manual):[1-9][0-9]*$/u.test(binding.generation_id)) {
        throw new TypeError(`${label}.generation_id is invalid`);
      }
      boundedString(binding.request_node_id, `${label}.request_node_id`, 256);
      githubUrl(binding.artifact_url, `${label}.artifact_url`);
      oneOf(binding.artifact_type, [...SELECTOR_KINDS],
        `${label}.artifact_type`);
      timestamp(binding.artifact_created_at, `${label}.artifact_created_at`);
      if (!DIGEST.test(binding.raw_body_sha256)) {
        throw new TypeError(`${label}.raw_body_sha256 must be a SHA-256 digest`);
      }
      validateBindingActor(binding.actor, `${label}.actor`);
      validateBindingApp(binding.app, `${label}.app`);
    }
    if (artifactBindingIds.has(binding.id)) {
      throw new TypeError(`controller.artifact_bindings repeats id ${binding.id}`);
    }
    artifactBindingIds.add(binding.id);
  });
  if (!Array.isArray(value.thread_resolution_observations)) {
    throw new TypeError("controller.thread_resolution_observations must be an array");
  }
  const observedThreads = new Set();
  value.thread_resolution_observations.forEach((observation, index) => {
    const label = `controller.thread_resolution_observations[${index}]`;
    exactObject(observation, THREAD_RESOLUTION_OBSERVATION_KEYS, label);
    boundedString(observation.thread_id, `${label}.thread_id`, 256);
    boundedString(observation.repository_id, `${label}.repository_id`, 256);
    if (!Number.isSafeInteger(observation.pull_request_number) || observation.pull_request_number <= 0) {
      throw new TypeError(`${label}.pull_request_number must be a positive safe integer`);
    }
    sha(observation.head_oid, `${label}.head_oid`);
    timestamp(observation.response_server_time, `${label}.response_server_time`);
    decimal(observation.run_id, `${label}.run_id`);
    exact(observation.is_resolved, true, `${label}.is_resolved`);
    if (observedThreads.has(observation.thread_id)) {
      throw new TypeError(
        `controller.thread_resolution_observations repeats thread_id ${observation.thread_id}`,
      );
    }
    observedThreads.add(observation.thread_id);
  });
  if (!Array.isArray(value.no_start_observations)) {
    throw new TypeError("controller.no_start_observations must be an array");
  }
  value.no_start_observations.forEach((observation, index) => {
    const label = `controller.no_start_observations[${index}]`;
    exactObject(observation, NO_START_OBSERVATION_KEYS, label);
    decimal(observation.request_id, `${label}.request_id`);
    exactObject(observation.carrier_selector, ["kind", "id"], `${label}.carrier_selector`);
    if (observation.carrier_selector.kind !== "issue_comment") {
      throw new TypeError(`${label}.carrier_selector.kind must be issue_comment`);
    }
    decimal(observation.carrier_selector.id, `${label}.carrier_selector.id`);
    timestamp(observation.first_seen_at, `${label}.first_seen_at`);
    decimal(observation.first_run_id, `${label}.first_run_id`);
    decimal(observation.confirmation_run_id, `${label}.confirmation_run_id`);
    decimal(observation.request_run_id, `${label}.request_run_id`);
    if (!(
      BigInt(observation.request_run_id) < BigInt(observation.first_run_id) &&
      BigInt(observation.first_run_id) < BigInt(observation.confirmation_run_id)
    )) {
      throw new TypeError(`${label} must bind three distinct ordered workflow runs`);
    }
  });
  exactObject(
    value.final_reread,
    ["required", "assurance"],
    "controller.final_reread",
  );
  exact(value.final_reread.required, true, "controller.final_reread.required");
  exact(
    value.final_reread.assurance,
    V2_PROJECTOR_FINAL_REREAD_ASSURANCE,
    "controller.final_reread.assurance",
  );
  return value;
}

function validateEnforcementReceipt(value) {
  exactObject(
    value.workflow,
    ["present", "compatible", "source", "path", "revision"],
    "controller.server_enforcement.workflow",
  );
  boolean(value.workflow.present, "controller.server_enforcement.workflow.present");
  boolean(value.workflow.compatible, "controller.server_enforcement.workflow.compatible");
  exact(
    value.workflow.source,
    "trusted-reusable-workflow",
    "controller.server_enforcement.workflow.source",
  );
  boundedString(value.workflow.path, "controller.server_enforcement.workflow.path", 512);
  boundedString(value.workflow.revision, "controller.server_enforcement.workflow.revision", 256);
  if (value.workflow.present && (!value.workflow.path || !value.workflow.revision)) {
    throw new TypeError("present workflow receipt requires path and revision");
  }
  if (!value.workflow.present && value.workflow.compatible) {
    throw new TypeError("absent workflow receipt cannot be compatible");
  }

  exactObject(
    value.ruleset,
    ["required", "present", "compatible", "status_context", "expected_source", "source_id"],
    "controller.server_enforcement.ruleset",
  );
  boolean(value.ruleset.required, "controller.server_enforcement.ruleset.required");
  boolean(value.ruleset.present, "controller.server_enforcement.ruleset.present");
  boolean(value.ruleset.compatible, "controller.server_enforcement.ruleset.compatible");
  exact(
    value.ruleset.status_context,
    "codex/github-review-gate",
    "controller.server_enforcement.ruleset.status_context",
  );
  boundedString(value.ruleset.expected_source, "controller.server_enforcement.ruleset.expected_source", 256);
  boundedString(value.ruleset.source_id, "controller.server_enforcement.ruleset.source_id", 256);
  if (value.ruleset.present && (!value.ruleset.expected_source || !value.ruleset.source_id)) {
    throw new TypeError("present ruleset receipt requires expected_source and source_id");
  }
  if (!value.ruleset.present && value.ruleset.compatible) {
    throw new TypeError("absent ruleset receipt cannot be compatible");
  }

  exactObject(
    value.app,
    ["required", "bound", "source_matches"],
    "controller.server_enforcement.app",
  );
  boolean(value.app.required, "controller.server_enforcement.app.required");
  boolean(value.app.bound, "controller.server_enforcement.app.bound");
  boolean(value.app.source_matches, "controller.server_enforcement.app.source_matches");
  if (!value.app.bound && value.app.source_matches) {
    throw new TypeError("unbound app receipt cannot match the expected source");
  }
}

function projectSelection(controller) {
  return structuredClone(deriveV2SelectionProjection({
    selection_policy: controller.selection.policy,
    server_enforcement: controller.server_enforcement,
  }).reducer_selection);
}

function projectServerEnforcement(controller) {
  const { workflow, ruleset, app } = controller.server_enforcement;
  return {
    controller_available: true,
    workflow_present: workflow.present,
    workflow_compatible: workflow.compatible,
    ruleset_required: ruleset.required,
    ruleset_compatible: ruleset.present && ruleset.compatible,
    app_bound: app.bound && app.source_matches,
  };
}

function transportLineage(discovery, evidence, controller) {
  const inventory = {
    repository: evidence.repository,
    pull_request: evidence.pull_request,
    scope: evidence.scope,
    issue_comments: evidence.pages.issue_comments,
    reviews: evidence.pages.reviews,
    inline_comments: evidence.pages.inline_comments,
    threads: evidence.pages.threads,
    reactions: evidence.pages.reactions,
    service_start_observations: evidence.service_start_observations,
  };
  const exactArtifacts = evidence.pages.exact_artifacts
    .map((receipt) => ({
      selector: receipt.selector,
      artifact_id: receipt.artifact.id,
      artifact_node_id: receipt.artifact.node_id,
      raw_body_sha256: receipt.raw_body_sha256,
      response_server_time: receipt.response_server_time,
    }))
    .sort((left, right) => compareSelectors(left.selector, right.selector));
  const actorPermissions = evidence.permissions.actor_permissions
    .map((receipt) => ({
      subject: receipt.subject,
      actor: receipt.actor,
      stable: receipt.stable,
      pre: {
        raw_body_sha256: receipt.pre.raw_body_sha256,
        response_server_time: receipt.pre.response_server_time,
      },
      post: {
        raw_body_sha256: receipt.post.raw_body_sha256,
        response_server_time: receipt.post.response_server_time,
      },
    }))
    .sort((left, right) => compareSelectors(left.subject, right.subject));
  return {
    assurance: V2_PROJECTOR_FINAL_REREAD_ASSURANCE,
    discovery_server_time: discovery.server_time,
    evidence_server_time: evidence.server_time,
    discovery_snapshot_sha256: digestCanonical(
      "codex-review-gate-v2-discovery-snapshot",
      discovery,
    ),
    evidence_snapshot_sha256: digestCanonical(
      "codex-review-gate-v2-evidence-snapshot",
      evidence,
    ),
    controller_receipt_sha256: digestCanonical(
      "codex-review-gate-v2-projector-controller",
      controller,
    ),
    complete_inventory_sha256: digestCanonical(
      "codex-review-gate-v2-complete-inventory",
      inventory,
    ),
    discovery_scope_receipts_sha256: digestCanonical(
      "codex-review-gate-v2-discovery-scope-receipts",
      discovery.scope_receipts,
    ),
    evidence_scope_receipts_sha256: digestCanonical(
      "codex-review-gate-v2-evidence-scope-receipts",
      evidence.scope_receipts,
    ),
    exact_artifacts: exactArtifacts,
    actor_permissions: actorPermissions,
    transport_capabilities: {
      stable: evidence.permissions.transport_capabilities.stable,
      pre_raw_body_sha256:
        evidence.permissions.transport_capabilities.pre.raw_body_sha256,
      post_raw_body_sha256:
        evidence.permissions.transport_capabilities.post.raw_body_sha256,
      pre_server_time:
        evidence.permissions.transport_capabilities.pre.response_server_time,
      post_server_time:
        evidence.permissions.transport_capabilities.post.response_server_time,
    },
  };
}

function requestCommentsById(snapshot, controller) {
  // A lookalike comment is not a request identity. The controller's already
  // validated bindings define the closed identity domain; the raw transport
  // only proves that each current binding still has one unedited exact body.
  const boundIds = new Set(
    controller.request_bindings.map((binding) => binding.id),
  );
  return new Map(
    snapshot.pages.issue_comments
      .filter((comment) =>
        boundIds.has(comment.id) &&
        comment.body === V2_MANUAL_REVIEW_REQUEST &&
        comment.created_at === comment.updated_at)
      .map((comment) => [comment.id, comment]),
  );
}

function requestBindingsById(controller, requestComments, currentHead) {
  const bindings = new Map(
    controller.request_bindings.map((binding) => [binding.id, binding]),
  );
  for (const [id, binding] of bindings) {
    if (binding.head_oid === currentHead && !requestComments.has(id)) {
      throw projectorFailure(
        "REQUEST_BINDING_ORPHANED",
        `controller binding ${id} has no exact visible request artifact`,
      );
    }
  }
  return bindings;
}

function inventoryArtifact(snapshot, selector) {
  const key = selector.kind === "issue_comment"
    ? "issue_comments"
    : selector.kind === "pull_request_review"
      ? "reviews"
      : "inline_comments";
  return snapshot.pages[key].find((artifact) => artifact.id === selector.id) ?? null;
}

function issueCommentForCore(comment) {
  return {
    ...comment,
    id: safeCoreId(comment.id, "issue comment"),
    user: actorForCore(comment.author),
    performed_via_github_app: comment.app === null
      ? null
      : { slug: comment.app.slug },
  };
}

function reviewForCore(review) {
  return {
    ...review,
    id: safeCoreId(review.id, "review"),
    user: actorForCore(review.author),
    created_at: review.submitted_at,
  };
}

function inlineCommentForCore(comment) {
  return {
    ...comment,
    id: safeCoreId(comment.id, "inline comment"),
    pull_request_review_id: safeCoreId(
      comment.pull_request_review_id,
      "inline parent review",
    ),
    user: actorForCore(comment.author),
  };
}

function threadForCore(thread) {
  return {
    id: thread.id,
    isResolved: thread.is_resolved,
    isOutdated: thread.is_outdated,
    path: thread.path,
    line: thread.line,
    startLine: thread.start_line,
    diffSide: thread.diff_side,
    startDiffSide: thread.start_diff_side,
    comments: {
      nodes: thread.comments.map((comment) => ({
        id: comment.id,
        fullDatabaseId: comment.database_id,
      })),
    },
  };
}

function actorForCore(actor) {
  return actor === null ? null : {
    id: safeCoreId(actor.id, "actor"),
    login: actor.login,
    type: actor.type,
  };
}

function reducerActor(actor) {
  return { id: actor.id, login: actor.login, type: actor.type };
}

function providerLike(artifact) {
  return artifact !== undefined && artifact !== null &&
    isExactV2CodexProviderIdentity(artifact.author, artifact.app);
}

function isAddressCommandCandidate(body) {
  return typeof body === "string" && body.startsWith("/codex-gate addressed");
}

function parseAddressCommand(body) {
  if (typeof body !== "string") {
    return null;
  }
  const match = /^\/codex-gate addressed (https:\/\/github\.com\/[^\s]+)$/u.exec(body);
  return match?.[1] ?? null;
}

function assertCanonicalCarrierHtmlUrl(carrier, snapshot) {
  let parsed;
  try {
    parsed = new URL(carrier.html_url);
  } catch {
    throw projectorFailure(
      "TOP_LEVEL_CARRIER_URL_INVALID",
      `top-level carrier ${carrier.id} has no absolute HTML URL`,
    );
  }
  const expectedPath =
    `/${snapshot.repository.owner}/${snapshot.repository.name}/pull/` +
    `${snapshot.pull_request.number}`;
  const expectedHash = Object.hasOwn(carrier, "issue_url")
    ? `#issuecomment-${carrier.id}`
    : `#pullrequestreview-${carrier.id}`;
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "github.com" ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== expectedPath ||
    parsed.search !== "" ||
    parsed.hash !== expectedHash ||
    parsed.href !== `https://github.com${expectedPath}${expectedHash}`
  ) {
    throw projectorFailure(
      "TOP_LEVEL_CARRIER_URL_INVALID",
      `top-level carrier ${carrier.id} HTML URL is not canonical for the selected PR`,
    );
  }
}

function repositoryParserOptions(snapshot) {
  return {
    owner: snapshot.repository.owner,
    repo: snapshot.repository.name,
    botLogins: V2_CODEX_BOT_LOGINS,
  };
}

function lifecycle(pullRequest) {
  if (pullRequest.state === "MERGED") {
    return "merged";
  }
  return pullRequest.state === "OPEN" ? "open" : "closed";
}

function safeCoreId(value, label) {
  if (!DECIMAL_ID.test(value)) {
    throw projectorFailure("INVALID_NATIVE_ID", `${label} id is not canonical decimal`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw projectorFailure(
      "UNSUPPORTED_NATIVE_ID",
      `${label} id cannot be represented by the closed core parser`,
    );
  }
  return number;
}

function findingId(artifactId, index, sample) {
  return `finding:${artifactId}:${index}:${createHash("sha256")
    .update(sample, "utf8")
    .digest("hex")
    .slice(0, 24)}`;
}

function selectorKey(selector) {
  if (!SELECTOR_KINDS.has(selector.kind) || !DECIMAL_ID.test(selector.id)) {
    throw projectorFailure("INVALID_SELECTOR", "selector is outside the closed identity set");
  }
  return `${selector.kind}:${selector.id}`;
}

function compareSelectors(left, right) {
  return left.kind.localeCompare(right.kind) || compareDecimal(left.id, right.id);
}

function compareIds(left, right) {
  return compareDecimal(left.id, right.id);
}

function compareDecimal(left, right) {
  const leftBig = BigInt(left);
  const rightBig = BigInt(right);
  return leftBig < rightBig ? -1 : leftBig > rightBig ? 1 : 0;
}

function compareTimestamps(left, right) {
  return Date.parse(left) - Date.parse(right);
}

function digestCanonical(domain, value) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0${canonicalJson(value)}`, "utf8")
    .digest("hex")}`;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function exactObject(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (!isDeepStrictEqual(actual, expected)) {
    throw new TypeError(`${label} must contain exactly ${expected.join(", ")}`);
  }
}

function exact(value, expected, label) {
  if (value !== expected) {
    throw new TypeError(`${label} must be exactly ${String(expected)}`);
  }
}

function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new TypeError(`${label} is outside the closed value set`);
  }
}

function boolean(value, label) {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be boolean`);
  }
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
}

function decimal(value, label) {
  if (typeof value !== "string" || !DECIMAL_ID.test(value)) {
    throw new TypeError(`${label} must be a canonical decimal string`);
  }
}

function sha(value, label) {
  if (typeof value !== "string" || !SHA.test(value)) {
    throw new TypeError(`${label} must be a lowercase full SHA`);
  }
}

function timestamp(value, label) {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(Date.parse(value)).toISOString() !== value
  ) {
    throw new TypeError(`${label} must be a canonical millisecond UTC timestamp`);
  }
}

function boundedString(value, label, max) {
  if (typeof value !== "string" || value.length > max) {
    throw new TypeError(`${label} must be a string no longer than ${max}`);
  }
}

function validateBindingActor(value, label) {
  exactObject(value, ["id", "node_id", "login", "type"], label);
  decimal(value.id, `${label}.id`);
  boundedString(value.node_id, `${label}.node_id`, 256);
  boundedString(value.login, `${label}.login`, 128);
  boundedString(value.type, `${label}.type`, 64);
}

function validateBindingApp(value, label) {
  exactObject(value, ["id", "node_id", "slug"], label);
  decimal(value.id, `${label}.id`);
  boundedString(value.node_id, `${label}.node_id`, 256);
  boundedString(value.slug, `${label}.slug`, 128);
}

function githubUrl(value, label) {
  boundedString(value, label, 2048);
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new TypeError(`${label} must be an absolute URL`, { cause: error });
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "github.com" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new TypeError(`${label} must be one credential-free github.com URL`);
  }
}

function projectorFailure(code, message, details = null, cause = undefined) {
  const error = new V2ProjectorError(code, message, details);
  if (cause !== undefined) {
    error.cause = cause;
  }
  return error;
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
