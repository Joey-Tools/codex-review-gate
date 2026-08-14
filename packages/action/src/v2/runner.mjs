import { createHash } from "node:crypto";

import {
  V2_SCHEDULER_SCHEMA,
  V2_SCHEDULER_SCHEMA_VERSION,
  planV2Actions,
} from "./scheduler.mjs";
import {
  V2_STATUS_CONTEXT,
  validateV2ReducerReport,
} from "./projection.mjs";
import {
  deriveV2EvidenceRequest,
  projectV2TransportSnapshots,
} from "./projector.mjs";
import {
  getExactArtifact,
  validateStatusTarget,
} from "./transport.mjs";
import {
  projectV2PublicReport,
  validateV2PublicReportSelectionAuthority,
} from "./public-report-projector.mjs";

export const V2_RUNNER_SCHEMA = "codex-review-gate-runner-v2";
export const V2_RUNNER_SCHEMA_VERSION = 1;
export const V2_REQUEST_RESERVATION_SCHEMA =
  "codex-review-gate-request-reservation-v2";
export const V2_REQUEST_BINDING_SCHEMA =
  "codex-review-gate-request-binding-v2";
export const V2_REQUEST_ATTEMPT_SCHEMA =
  "codex-review-gate-request-attempt-v2";
export const V2_HEAD_LEDGER_SCHEMA = "codex-review-gate-head-ledger-v2";
export const V2_REQUEST_BODY = "@codex review";
export const MAX_AUTOMATIC_REQUESTS_PER_HEAD = 3;

export const V2_OPERATIONS = Object.freeze([
  "prepare-request",
  "bind-request",
  "evaluate-only",
]);
export const V2_STATUS_TARGET_MODES = Object.freeze([
  "head",
  "test-merge-with-head-sentinel",
]);
export const V2_DECISIONS = Object.freeze([
  "not-selected",
  "pending",
  "clean",
  "findings",
  "inconclusive",
  "skipped-unavailable",
  "blocked-configuration",
  "blocked-input",
]);
export const V2_TERMINAL_DECISIONS = new Set([
  "clean",
  "findings",
  "inconclusive",
  "skipped-unavailable",
  "blocked-configuration",
  "blocked-input",
]);

const OPERATIONS = new Set(V2_OPERATIONS);
const STATUS_TARGET_MODES = new Set(V2_STATUS_TARGET_MODES);
const DECISIONS = new Set(V2_DECISIONS);
const GITHUB_STATE_BY_DECISION = Object.freeze({
  pending: "pending",
  clean: "success",
  findings: "failure",
  inconclusive: "error",
  "skipped-unavailable": "success",
  "blocked-configuration": "error",
  "blocked-input": "error",
});
const HEAD_SENTINEL_STATE_BY_DECISION = Object.freeze({
  pending: "pending",
  findings: "failure",
  inconclusive: "error",
  "blocked-configuration": "error",
  "blocked-input": "error",
});
const RUNNER_INPUT_KEYS = Object.freeze([
  "schema",
  "schema_version",
  "operation",
  "status_target_mode",
  "status_context",
  "snapshot_request",
  "controller",
  "public_report_authority",
  "scheduling",
  "head_ledger",
  "reservation",
  "post_response",
]);
const SNAPSHOT_REQUEST_KEYS = Object.freeze(["owner", "repo", "pull_number"]);
const SCHEDULING_KEYS = Object.freeze([
  "trigger",
  "public_wait_supported",
  "status_target_mode",
  "run_identity",
  "epoch",
  "complete_snapshots",
  "status",
  "applied_action_keys",
  "no_start_candidate",
]);
const RUN_IDENTITY_KEYS = Object.freeze(["run_id", "run_attempt"]);
const HEAD_LEDGER_KEYS = Object.freeze([
  "schema",
  "schema_version",
  "repository_node_id",
  "pull_request_node_id",
  "head_ref_oid",
  "automatic_request_count",
  "exact_sha_context_count",
  "latest_status_idempotency_key",
  "bound_attempt_ids",
  "observed_at",
]);
const POST_RESPONSE_KEYS = Object.freeze([
  "status",
  "server_time",
  "raw_body",
  "attempt",
]);
const RESERVATION_KEYS = Object.freeze([
  "schema",
  "schema_version",
  "repository",
  "pull_request",
  "epoch_head_sha",
  "ordinal",
  "generation_id",
  "generation_kind",
  "generation_index",
  "recovery_authority",
  "scheduler_intent_id",
  "intent_id",
  "intent_digest",
  "attempt_id",
  "body",
  "created_at",
  "automatic",
  "consumed",
  "pre_scope_digest",
  "status_ledger_binding",
  "reservation_digest",
]);
const RESERVATION_REPOSITORY_KEYS = Object.freeze(["owner", "name", "node_id"]);
const RESERVATION_PULL_REQUEST_KEYS = Object.freeze(["number", "node_id"]);
const LEDGER_BINDING_KEYS = Object.freeze([
  "head_ref_oid",
  "automatic_request_count",
  "exact_sha_context_count",
  "latest_status_idempotency_key",
  "bound_attempt_ids",
  "observed_at",
  "ledger_digest",
]);
const ATTEMPT_KEYS = Object.freeze([
  "schema",
  "schema_version",
  "attempt_id",
  "reservation_digest",
  "scheduler_intent_id",
  "recorded_at",
  "recorded_before_effect",
  "retry_limit",
  "attempt_digest",
]);
const RECOVERY_AUTHORITY_KEYS = Object.freeze([
  "prior_generation_id",
  "finding_ids",
  "closure_ids",
  "closure_observed_at",
]);
const STRICT_UTC_TIMESTAMP =
  /^(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d{1,3}))?Z$/u;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const DECIMAL_ID_PATTERN = /^(?:0|[1-9][0-9]*)$/u;

/**
 * Run one v2 operation. This function performs only read transport calls.
 * Every status write and POST remains a returned plan for a caller-owned
 * effect step. In particular, evaluate-only cannot emit a mutating effect.
 */
export async function runV2Operation(rawInput, rawDependencies) {
  const input = validateRunnerInput(rawInput);
  const dependencies = validateDependencies(rawDependencies);
  const responseArtifact = input.operation === "bind-request"
    ? parsePostResponse(input.post_response, input.reservation)
    : null;
  const bindArtifactSelectors = responseArtifact === null
    ? []
    : [{ kind: "issue_comment", id: responseArtifact.id }];
  const discoverySnapshot = await dependencies.transport.loadSnapshot({
    owner: input.snapshot_request.owner,
    repo: input.snapshot_request.repo,
    pullNumber: input.snapshot_request.pull_number,
    artifactSelectors: bindArtifactSelectors,
  });
  validateSnapshotEnvelope(discoverySnapshot, input.snapshot_request);
  const projectionController = controllerForProjection(
    input,
    discoverySnapshot,
    responseArtifact,
  );

  const derivedEvidenceRequest = validateDerivedEvidenceRequest(
    dependencies.deriveEvidenceRequest({
      discovery_snapshot: discoverySnapshot,
      controller: projectionController,
    }),
  );
  const evidenceSnapshot = await dependencies.transport.loadSnapshot({
    owner: input.snapshot_request.owner,
    repo: input.snapshot_request.repo,
    pullNumber: input.snapshot_request.pull_number,
    artifactSelectors: mergeArtifactSelectors(
      derivedEvidenceRequest.artifactSelectors,
      bindArtifactSelectors,
    ),
    permissionSubjects: derivedEvidenceRequest.permissionSubjects,
  });
  validateSnapshotEnvelope(evidenceSnapshot, input.snapshot_request);

  const projectedSnapshot = dependencies.projectSnapshots({
    discovery_snapshot: discoverySnapshot,
    evidence_snapshot: evidenceSnapshot,
    controller: projectionController,
  });

  const reducerReport = dependencies.reduceSnapshot(projectedSnapshot, {
    status_target_mode: input.status_target_mode,
    status_context: input.status_context,
  });
  validateReducerReport(reducerReport, evidenceSnapshot, input);
  const publicReport = dependencies.projectPublicReport({
    compact_report: reducerReport,
    reducer_input: projectedSnapshot,
    evidence_snapshot: evidenceSnapshot,
    selection_authority: input.public_report_authority,
    head_sentinel_receipt: input.scheduling.status.head_sentinel_receipt,
  });
  if (
    publicReport === null ||
    typeof publicReport !== "object" ||
    Array.isArray(publicReport) ||
    publicReport.decision !== reducerReport.decision
  ) {
    throw new TypeError(
      "runner public report must be an object with the compact reducer decision",
    );
  }

  const targetResult = dependencies.validateTarget(
    evidenceSnapshot,
    input.status_target_mode,
  );
  const target = targetResult.validated
    ? { ...targetResult }
    : {
        ...targetResult,
        head_sentinel_sha: evidenceSnapshot.scope.head_ref_oid,
      };
  target.head_sentinel_receipt = input.scheduling.status.head_sentinel_receipt;
  const statusPlan = buildV2StatusPlan({
    decision: reducerReport.decision,
    status_target_mode: input.status_target_mode,
    status_context: input.status_context,
    target,
    snapshot_fingerprint: reducerReport.snapshot_fingerprint,
  });
  const schedulerInput = buildSchedulerInput(
    input,
    evidenceSnapshot,
    projectedSnapshot,
    reducerReport,
  );
  const schedulerPlan = dependencies.planActions(schedulerInput);
  const publishStatusAction = schedulerPlan.actions.find((action) =>
    action.kind === "publish_status");
  const authorizedStatusPlan = publishStatusAction === undefined
    ? statusPlan.suppression_reason !== undefined
      ? statusPlan
      : suppressStatusWrites(
          statusPlan,
          input.operation === "evaluate-only"
            ? "evaluate-only"
            : "scheduler-did-not-authorize-publication",
        )
    : authorizeStatusWrites(statusPlan, publishStatusAction);

  let reservation = null;
  let postIntent = null;
  let bindingReceipt = null;
  if (input.operation === "prepare-request") {
    const postAction = schedulerPlan.actions.find((action) =>
      action.kind === "post_review_request");
    if (postAction !== undefined) {
      reservation = prepareV2Request({
        snapshot: evidenceSnapshot,
        head_ledger: input.head_ledger,
        scheduler_post_action: postAction,
      });
      postIntent = buildPostIntent(reservation);
    }
  } else if (input.operation === "bind-request") {
    const exactArtifact = dependencies.getExactArtifact(evidenceSnapshot, {
      kind: "issue_comment",
      id: responseArtifact.id,
    });
    bindingReceipt = bindV2Request({
      reservation: input.reservation,
      post_response: input.post_response,
      response_artifact: responseArtifact,
      snapshot: evidenceSnapshot,
      exact_artifact: exactArtifact,
      scheduler_automatic_request: input.scheduling.epoch.automatic_request,
      binding_ledger: input.head_ledger,
    });
  }

  if (
    input.operation === "evaluate-only" &&
    (schedulerPlan.actions.length !== 0 || authorizedStatusPlan.writes.length !== 0)
  ) {
    throw runnerError(
      "EVALUATE_ONLY_EFFECT",
      "evaluate-only must not return scheduler effects after a complete evaluation",
    );
  }

  return deepFreeze({
    schema: V2_RUNNER_SCHEMA,
    schema_version: V2_RUNNER_SCHEMA_VERSION,
    operation: input.operation,
    decision: reducerReport.decision,
    report: publicReport,
    reducer_report: reducerReport,
    scheduler_evaluation: schedulerInput.evaluation,
    scheduler_plan: schedulerPlan,
    status_plan: authorizedStatusPlan,
    reservation,
    post_intent: postIntent,
    binding_receipt: bindingReceipt,
    writes_performed: false,
    freshness_assurance: "point-in-time",
  });
}

export function evaluateV2Only(input, dependencies) {
  return runV2Operation({ ...input, operation: "evaluate-only" }, dependencies);
}

export function prepareV2RequestOperation(input, dependencies) {
  return runV2Operation({ ...input, operation: "prepare-request" }, dependencies);
}

export function bindV2RequestOperation(input, dependencies) {
  return runV2Operation({ ...input, operation: "bind-request" }, dependencies);
}

export function buildV2AttemptReceipt({ reservation, recorded_at }) {
  const normalizedReservation = validateReservation(reservation);
  const withoutDigest = {
    schema: V2_REQUEST_ATTEMPT_SCHEMA,
    schema_version: V2_RUNNER_SCHEMA_VERSION,
    attempt_id: normalizedReservation.attempt_id,
    reservation_digest: normalizedReservation.reservation_digest,
    scheduler_intent_id: normalizedReservation.scheduler_intent_id,
    recorded_at: canonicalTimestamp(recorded_at, "recorded_at"),
    recorded_before_effect: true,
    retry_limit: 0,
  };
  if (Date.parse(withoutDigest.recorded_at) < Date.parse(normalizedReservation.created_at)) {
    throw new TypeError("recorded_at cannot predate reservation creation");
  }
  return deepFreeze({
    ...withoutDigest,
    attempt_digest: digestCanonical(
      "codex-review-gate-v2-request-attempt",
      withoutDigest,
    ),
  });
}

/** Build a consumed reservation before any POST is attempted. */
export function prepareV2Request({ snapshot, head_ledger, scheduler_post_action }) {
  validateSnapshotIdentity(snapshot);
  const ledger = validateHeadLedger(head_ledger, snapshot);
  assertRecord(scheduler_post_action, "scheduler_post_action");
  if (
    scheduler_post_action.kind !== "post_review_request" ||
    scheduler_post_action.retry_limit !== 0 ||
    scheduler_post_action.record_attempt_before_effect !== true
  ) {
    throw runnerError(
      "UNSAFE_POST_ACTION",
      "scheduler post action must be retry-zero and recorded before its effect",
    );
  }
  if (ledger.automatic_request_count >= MAX_AUTOMATIC_REQUESTS_PER_HEAD) {
    throw runnerError(
      "REQUEST_RESERVATION_EXHAUSTED",
      `head already consumed ${MAX_AUTOMATIC_REQUESTS_PER_HEAD} automatic reservations`,
    );
  }
  const ordinal = ledger.automatic_request_count + 1;
  const recoveryAuthority = ordinal === 1
    ? null
    : validateRecoveryAuthority(scheduler_post_action.recovery_authority, ordinal, snapshot);
  const preScopeDigest = digestCanonical("codex-review-gate-v2-scope", scopeBinding(snapshot));
  const ledgerDigest = digestCanonical("codex-review-gate-v2-head-ledger", ledger);
  const statusLedgerBinding = {
    head_ref_oid: ledger.head_ref_oid,
    automatic_request_count: ledger.automatic_request_count,
    exact_sha_context_count: ledger.exact_sha_context_count,
    latest_status_idempotency_key: ledger.latest_status_idempotency_key,
    bound_attempt_ids: ledger.bound_attempt_ids,
    observed_at: ledger.observed_at,
    ledger_digest: ledgerDigest,
  };
  const schedulerIntentId = nonEmptyString(
    scheduler_post_action.intent_id,
    "scheduler_post_action.intent_id",
  );
  const intentSeed = {
    repository_node_id: snapshot.repository.node_id,
    pull_request_node_id: snapshot.pull_request.node_id,
    head_ref_oid: snapshot.scope.head_ref_oid,
    ordinal,
    generation_id: `automatic:${ordinal}`,
    scheduler_intent_id: schedulerIntentId,
    body: V2_REQUEST_BODY,
    created_at: canonicalTimestamp(snapshot.server_time, "snapshot.server_time"),
    pre_scope_digest: preScopeDigest,
    ledger_digest: ledgerDigest,
    recovery_authority: recoveryAuthority,
  };
  const intentDigest = digestCanonical("codex-review-gate-v2-request-intent", intentSeed);
  const intentId = `v2-request:${intentDigest.slice("sha256:".length)}`;
  const attemptId = `v2-attempt:${digestCanonical(
    "codex-review-gate-v2-request-attempt-id",
    { intent_id: intentId, intent_digest: intentDigest },
  ).slice("sha256:".length)}`;
  const withoutDigest = {
    schema: V2_REQUEST_RESERVATION_SCHEMA,
    schema_version: V2_RUNNER_SCHEMA_VERSION,
    repository: {
      owner: snapshot.repository.owner,
      name: snapshot.repository.name,
      node_id: snapshot.repository.node_id,
    },
    pull_request: {
      number: snapshot.pull_request.number,
      node_id: snapshot.pull_request.node_id,
    },
    epoch_head_sha: snapshot.scope.head_ref_oid,
    ordinal,
    generation_id: `automatic:${ordinal}`,
    generation_kind: "automatic",
    generation_index: ordinal,
    recovery_authority: recoveryAuthority,
    scheduler_intent_id: schedulerIntentId,
    intent_id: intentId,
    intent_digest: intentDigest,
    attempt_id: attemptId,
    body: V2_REQUEST_BODY,
    created_at: snapshot.server_time,
    automatic: true,
    consumed: true,
    pre_scope_digest: preScopeDigest,
    status_ledger_binding: statusLedgerBinding,
  };
  return deepFreeze({
    ...withoutDigest,
    reservation_digest: digestCanonical(
      "codex-review-gate-v2-request-reservation",
      withoutDigest,
    ),
  });
}

/**
 * Bind an already-consumed reservation to the exact 201 response and a later
 * exact GET from the complete snapshot. A snapshot by itself is insufficient.
 */
export function bindV2Request({
  reservation,
  post_response,
  response_artifact = null,
  snapshot,
  exact_artifact,
  scheduler_automatic_request,
  binding_ledger,
}) {
  const normalizedReservation = validateReservation(reservation);
  const parsedResponse = parsePostResponse(post_response, normalizedReservation);
  if (response_artifact !== null && !isDeepEqual(response_artifact, parsedResponse)) {
    throw runnerError(
      "POST_RESPONSE_PARSE_MISMATCH",
      "pre-parsed POST response does not equal the exact 201 response body",
    );
  }
  const response = parsedResponse;
  const attempt = validateAttemptReceipt(
    post_response.attempt,
    normalizedReservation,
    scheduler_automatic_request,
  );
  validateSnapshotIdentity(snapshot);
  const currentLedger = validateHeadLedger(binding_ledger, snapshot);
  if (currentLedger.automatic_request_count !== normalizedReservation.ordinal) {
    throw runnerError(
      "BINDING_LEDGER_COUNT_MISMATCH",
      "head ledger has not durably consumed exactly this reservation ordinal",
    );
  }
  const reservedBoundAttemptIds =
    normalizedReservation.status_ledger_binding.bound_attempt_ids;
  if (
    currentLedger.bound_attempt_ids.length < reservedBoundAttemptIds.length ||
    reservedBoundAttemptIds.some(
      (attemptId, index) => currentLedger.bound_attempt_ids[index] !== attemptId,
    )
  ) {
    throw runnerError(
      "BINDING_LEDGER_HISTORY_MISMATCH",
      "head ledger does not preserve the reservation's durable binding history",
    );
  }
  if (currentLedger.bound_attempt_ids.includes(normalizedReservation.attempt_id)) {
    throw runnerError(
      "ATTEMPT_ALREADY_BOUND",
      "the deterministic request attempt already has a durable binding",
    );
  }
  if (
    snapshot.repository.owner !== normalizedReservation.repository.owner ||
    snapshot.repository.name !== normalizedReservation.repository.name ||
    snapshot.repository.node_id !== normalizedReservation.repository.node_id ||
    snapshot.pull_request.number !== normalizedReservation.pull_request.number ||
    snapshot.pull_request.node_id !== normalizedReservation.pull_request.node_id ||
    snapshot.scope.head_ref_oid !== normalizedReservation.epoch_head_sha
  ) {
    throw runnerError(
      "RESERVATION_SCOPE_MISMATCH",
      "post-refetch snapshot does not match the reserved repository, PR, and head epoch",
    );
  }
  const postScopeDigest = digestCanonical(
    "codex-review-gate-v2-scope",
    scopeBinding(snapshot),
  );
  if (postScopeDigest !== normalizedReservation.pre_scope_digest) {
    throw runnerError(
      "REQUEST_SCOPE_DRIFT",
      "request scope changed between reservation and post-response binding",
    );
  }
  validateExactArtifact(exact_artifact, response);
  if (
    Date.parse(normalizedReservation.created_at) > Date.parse(attempt.recorded_at) ||
    Date.parse(attempt.recorded_at) > Date.parse(response.created_at) ||
    Date.parse(response.created_at) > Date.parse(response.server_time)
  ) {
    throw runnerError(
      "REQUEST_CAUSAL_TIME_INVALID",
      "request times must order reservation, pre-effect attempt, comment creation, and POST response",
    );
  }
  if (Date.parse(exact_artifact.response_server_time) < Date.parse(response.server_time)) {
    throw runnerError(
      "REFETCH_TIME_REGRESSED",
      "exact GET server time predates the captured POST response",
    );
  }

  const responseRawDigest = digestRaw(post_response.raw_body);
  const responseRecord = {
    status: 201,
    server_time: response.server_time,
    raw_body_sha256: responseRawDigest,
    id: response.id,
    node_id: response.node_id,
    url: response.url,
    html_url: response.html_url,
    actor: response.actor,
    app: response.app,
    body: response.body,
    created_at: response.created_at,
    updated_at: response.updated_at,
  };
  const refetchRecord = {
    response_server_time: exact_artifact.response_server_time,
    raw_body_sha256: exact_artifact.raw_body_sha256,
    artifact_id: exact_artifact.artifact.id,
    artifact_digest: digestCanonical(
      "codex-review-gate-v2-refetched-artifact",
      exact_artifact.artifact,
    ),
  };
  const nextLedger = {
    ...currentLedger,
    bound_attempt_ids: [...currentLedger.bound_attempt_ids, normalizedReservation.attempt_id],
    observed_at: snapshot.server_time,
  };
  const ledgerUpdate = {
    previous_ledger_digest: digestCanonical(
      "codex-review-gate-v2-head-ledger",
      currentLedger,
    ),
    next_ledger: nextLedger,
    next_ledger_digest: digestCanonical(
      "codex-review-gate-v2-head-ledger",
      nextLedger,
    ),
  };
  const withoutDigest = {
    schema: V2_REQUEST_BINDING_SCHEMA,
    schema_version: V2_RUNNER_SCHEMA_VERSION,
    repository: normalizedReservation.repository,
    pull_request: normalizedReservation.pull_request,
    epoch_head_sha: normalizedReservation.epoch_head_sha,
    ordinal: normalizedReservation.ordinal,
    generation_id: normalizedReservation.generation_id,
    generation_kind: normalizedReservation.generation_kind,
    generation_index: normalizedReservation.generation_index,
    recovery_authority: normalizedReservation.recovery_authority,
    scheduler_intent_id: normalizedReservation.scheduler_intent_id,
    intent_id: normalizedReservation.intent_id,
    intent_digest: normalizedReservation.intent_digest,
    reservation_digest: normalizedReservation.reservation_digest,
    body: V2_REQUEST_BODY,
    automatic: true,
    consumed: true,
    effect_attempt: attempt,
    pre_scope_digest: normalizedReservation.pre_scope_digest,
    post_scope_digest: postScopeDigest,
    post_response: responseRecord,
    post_refetch: refetchRecord,
    ledger_update: ledgerUpdate,
    non_replayable_effect_policy: "retry-zero-no-reclaim",
  };
  return deepFreeze({
    ...withoutDigest,
    receipt_digest: digestCanonical(
      "codex-review-gate-v2-request-binding",
      withoutDigest,
    ),
  });
}

export function buildV2StatusPlan({
  decision,
  status_target_mode,
  status_context,
  target,
  snapshot_fingerprint,
}) {
  enumValue(decision, DECISIONS, "decision");
  enumValue(status_target_mode, STATUS_TARGET_MODES, "status_target_mode");
  const context = boundedString(status_context, "status_context", 128);
  if (context !== V2_STATUS_CONTEXT) {
    throw new TypeError(`status_context must be exactly ${V2_STATUS_CONTEXT}`);
  }
  digestString(snapshot_fingerprint, "snapshot_fingerprint");
  assertRecord(target, "target");

  if (decision === "not-selected") {
    return deepFreeze({
      mode: status_target_mode,
      decision,
      writes: [],
      terminal_cutover: false,
      freshness_assurance: "point-in-time",
    });
  }

  if (status_target_mode === "head") {
    if (!target.validated || !isSha(target.terminal_sha)) {
      return statusPlan(status_target_mode, decision, [], false);
    }
    if (decision === "clean" || decision === "skipped-unavailable") {
      return suppressStatusWrites(
        statusPlan(status_target_mode, decision, [], false),
        "suppressed-unsupported-terminal-target",
      );
    }
    const state = HEAD_SENTINEL_STATE_BY_DECISION[decision];
    if (state === undefined) {
      return statusPlan(status_target_mode, decision, [], false);
    }
    return statusPlan(status_target_mode, decision, [{
      role: "head-sentinel",
      sha: target.terminal_sha,
      context,
      state,
      reason: decision === "pending" ? "awaiting-terminal-head-decision" : `decision-${decision}`,
      idempotency_key: statusWriteKey(
        target.terminal_sha,
        context,
        state,
        snapshot_fingerprint,
      ),
    }], false);
  }

  if (decision === "pending") {
    if (!isSha(target.head_sentinel_sha)) {
      return blockedHeadPlan({
        mode: status_target_mode,
        decision,
        context,
        target,
        snapshotFingerprint: snapshot_fingerprint,
      });
    }
    return statusPlan(status_target_mode, decision, [{
      role: "head-sentinel",
      sha: target.head_sentinel_sha,
      context,
      state: "pending",
      reason: "awaiting-terminal-test-merge-decision",
      idempotency_key: statusWriteKey(
        target.head_sentinel_sha,
        context,
        "pending",
        snapshot_fingerprint,
      ),
    }], false);
  }

  if (!target.validated || !isSha(target.terminal_sha)) {
    return blockedHeadPlan({
      mode: status_target_mode,
      decision,
      context,
      target,
      snapshotFingerprint: snapshot_fingerprint,
    });
  }

  if (
    (decision === "clean" || decision === "skipped-unavailable") &&
    !validNonSuccessHeadSentinelReceipt(target.head_sentinel_receipt, {
      sha: target.head_sentinel_sha,
      context,
    })
  ) {
    return blockedHeadPlan({
      mode: status_target_mode,
      decision,
      context,
      target,
      snapshotFingerprint: snapshot_fingerprint,
    });
  }

  const terminalState = GITHUB_STATE_BY_DECISION[decision];
  const writes = [{
    role: "primary-terminal",
    sha: target.terminal_sha,
    context,
    state: terminalState,
    reason: `decision-${decision}`,
    idempotency_key: statusWriteKey(
      target.terminal_sha,
      context,
      terminalState,
      snapshot_fingerprint,
    ),
  }];
  const sentinelState = HEAD_SENTINEL_STATE_BY_DECISION[decision];
  if (sentinelState && isSha(target.head_sentinel_sha)) {
    writes.push({
      role: "head-sentinel",
      sha: target.head_sentinel_sha,
      context,
      state: sentinelState,
      reason: `decision-${decision}`,
      idempotency_key: statusWriteKey(
        target.head_sentinel_sha,
        context,
        sentinelState,
        snapshot_fingerprint,
      ),
    });
  }
  return statusPlan(status_target_mode, decision, writes, true);
}

export function deriveV2EpochId(snapshot) {
  validateSnapshotIdentity(snapshot);
  return `v2-head:${digestCanonical("codex-review-gate-v2-head-epoch", {
    repository_node_id: snapshot.repository.node_id,
    pull_request_node_id: snapshot.pull_request.node_id,
    head_ref_oid: snapshot.scope.head_ref_oid,
  }).slice("sha256:".length)}`;
}

function buildSchedulerInput(input, snapshot, projectedSnapshot, reducerReport) {
  const scheduling = input.scheduling;
  if (scheduling.epoch.id !== deriveV2EpochId(snapshot)) {
    throw runnerError(
      "EPOCH_ID_MISMATCH",
      "scheduler epoch.id does not match the repository, PR, and head epoch",
    );
  }
  const evaluation = {
    epoch_id: scheduling.epoch.id,
    decision: reducerReport.decision,
    complete: snapshotIsComplete(snapshot) && projectedSnapshot.complete === true,
    snapshot_id: digestCanonical("codex-review-gate-v2-snapshot-id", snapshot),
    snapshot_fingerprint: reducerReport.snapshot_fingerprint,
    observed_at: snapshot.server_time,
    provider_activity_fingerprint: digestCanonical(
      "codex-review-gate-v2-provider-activity",
      snapshot.pages,
    ),
    no_start_candidate: scheduling.no_start_candidate,
    run_id: scheduling.run_identity.run_id,
    run_attempt: scheduling.run_identity.run_attempt,
  };
  return {
    schema: V2_SCHEDULER_SCHEMA,
    schema_version: V2_SCHEDULER_SCHEMA_VERSION,
    trigger: scheduling.trigger,
    now: snapshot.server_time,
    public_wait_supported: scheduling.public_wait_supported,
    status_target_mode: input.status_target_mode,
    epoch: scheduling.epoch,
    evaluation,
    complete_snapshots: scheduling.complete_snapshots,
    status: {
      exact_sha_context_count: scheduling.status.exact_sha_context_count,
      latest_idempotency_key: scheduling.status.latest_idempotency_key,
    },
    applied_action_keys: scheduling.applied_action_keys,
  };
}

function buildPostIntent(reservation) {
  const preEffectAttempt = buildV2AttemptReceipt({
    reservation,
    recorded_at: reservation.created_at,
  });
  return deepFreeze({
    method: "POST",
    path: `/repos/${encodeURIComponent(reservation.repository.owner)}/` +
      `${encodeURIComponent(reservation.repository.name)}/issues/` +
      `${reservation.pull_request.number}/comments`,
    body: V2_REQUEST_BODY,
    json: { body: V2_REQUEST_BODY },
    retry_limit: 0,
    record_attempt_before_effect: true,
    pre_effect_attempt_receipt: preEffectAttempt,
    network_uncertainty_policy: "do-not-retry-or-reclaim",
    reservation_digest: reservation.reservation_digest,
  });
}

function parsePostResponse(postResponse, reservation) {
  assertClosedRecord(postResponse, POST_RESPONSE_KEYS, "post_response");
  if (postResponse.status !== 201) {
    throw runnerError("POST_RESPONSE_NOT_CREATED", "bind-request requires exact HTTP 201");
  }
  const serverTime = canonicalTimestamp(postResponse.server_time, "post_response.server_time");
  if (typeof postResponse.raw_body !== "string" || postResponse.raw_body.length === 0) {
    throw new TypeError("post_response.raw_body must be the non-empty exact response text");
  }
  let body;
  try {
    body = JSON.parse(postResponse.raw_body);
  } catch (error) {
    throw runnerError("POST_RESPONSE_INVALID_JSON", "201 response body is not valid JSON", {
      cause: error,
    });
  }
  assertRecord(body, "post_response body");
  const id = decimalId(body.id, "post_response body.id");
  const response = {
    server_time: serverTime,
    id,
    node_id: nonEmptyString(body.node_id, "post_response body.node_id"),
    url: absoluteUrl(body.url, "post_response body.url"),
    html_url: absoluteUrl(body.html_url, "post_response body.html_url"),
    issue_url: absoluteUrl(body.issue_url, "post_response body.issue_url"),
    actor: normalizeActor(body.user, "post_response body.user"),
    app: normalizeApp(body.performed_via_github_app ?? body.app ?? null),
    body: body.body,
    created_at: canonicalTimestamp(body.created_at, "post_response body.created_at"),
    updated_at: canonicalTimestamp(body.updated_at, "post_response body.updated_at"),
  };
  if (response.body !== V2_REQUEST_BODY || response.body !== reservation.body) {
    throw runnerError(
      "POST_RESPONSE_BODY_MISMATCH",
      `created comment body must be exactly ${V2_REQUEST_BODY}`,
    );
  }
  if (response.created_at !== response.updated_at) {
    throw runnerError(
      "POST_RESPONSE_ALREADY_EDITED",
      "created request must have equal created_at and updated_at",
    );
  }
  if (Date.parse(response.created_at) > Date.parse(serverTime)) {
    throw runnerError(
      "POST_RESPONSE_TIME_INVALID",
      "created comment time is later than the POST response server time",
    );
  }
  const expectedApiPrefix = `/repos/${reservation.repository.owner}/` +
    `${reservation.repository.name}/issues/`;
  const commentUrl = new URL(response.url);
  const issueUrl = new URL(response.issue_url);
  if (
    !commentUrl.pathname.endsWith(`/issues/comments/${id}`) ||
    issueUrl.pathname !== `${expectedApiPrefix}${reservation.pull_request.number}`
  ) {
    throw runnerError(
      "POST_RESPONSE_URL_MISMATCH",
      "created comment URLs do not bind the reserved repository and pull request",
    );
  }
  return response;
}

function validateExactArtifact(exactEntry, response) {
  assertRecord(exactEntry, "exact_artifact");
  assertRecord(exactEntry.selector, "exact_artifact.selector");
  assertRecord(exactEntry.artifact, "exact_artifact.artifact");
  canonicalTimestamp(
    exactEntry.response_server_time,
    "exact_artifact.response_server_time",
  );
  digestString(exactEntry.raw_body_sha256, "exact_artifact.raw_body_sha256");
  if (
    exactEntry.selector.kind !== "issue_comment" ||
    exactEntry.selector.id !== response.id
  ) {
    throw runnerError("REFETCH_SELECTOR_MISMATCH", "exact GET selector does not match 201 id");
  }
  const expectedArtifact = {
    id: response.id,
    node_id: response.node_id,
    url: response.url,
    html_url: response.html_url,
    issue_url: response.issue_url,
    author: response.actor,
    app: response.app,
    body: response.body,
    created_at: response.created_at,
    updated_at: response.updated_at,
  };
  for (const [key, value] of Object.entries(expectedArtifact)) {
    if (!isDeepEqual(exactEntry.artifact[key], value)) {
      throw runnerError(
        "POST_REFETCH_MISMATCH",
        `exact GET field ${key} does not equal the captured 201 response`,
      );
    }
  }
}

function validateReservation(value) {
  assertClosedRecord(value, RESERVATION_KEYS, "reservation");
  if (
    value.schema !== V2_REQUEST_RESERVATION_SCHEMA ||
    value.schema_version !== V2_RUNNER_SCHEMA_VERSION
  ) {
    throw new TypeError("reservation has an unsupported schema");
  }
  assertClosedRecord(value.repository, RESERVATION_REPOSITORY_KEYS, "reservation.repository");
  assertClosedRecord(
    value.pull_request,
    RESERVATION_PULL_REQUEST_KEYS,
    "reservation.pull_request",
  );
  nonEmptyString(value.repository.owner, "reservation.repository.owner");
  nonEmptyString(value.repository.name, "reservation.repository.name");
  nonEmptyString(value.repository.node_id, "reservation.repository.node_id");
  positiveSafeInteger(value.pull_request.number, "reservation.pull_request.number");
  nonEmptyString(value.pull_request.node_id, "reservation.pull_request.node_id");
  sha(value.epoch_head_sha, "reservation.epoch_head_sha");
  if (
    !Number.isSafeInteger(value.ordinal) ||
    value.ordinal < 1 ||
    value.ordinal > MAX_AUTOMATIC_REQUESTS_PER_HEAD
  ) {
    throw new TypeError("reservation.ordinal must be from 1 through 3");
  }
  if (
    value.generation_id !== `automatic:${value.ordinal}` ||
    value.generation_kind !== "automatic" ||
    value.generation_index !== value.ordinal
  ) {
    throw new TypeError("reservation generation identity must match its automatic ordinal");
  }
  if (value.ordinal === 1) {
    if (value.recovery_authority !== null) {
      throw new TypeError("initial generation cannot carry recovery authority");
    }
  } else {
    validateRecoveryAuthority(value.recovery_authority, value.ordinal, {
      server_time: value.created_at,
      scope: { head_ref_oid: value.epoch_head_sha },
    });
  }
  nonEmptyString(value.intent_id, "reservation.intent_id");
  nonEmptyString(value.scheduler_intent_id, "reservation.scheduler_intent_id");
  digestString(value.intent_digest, "reservation.intent_digest");
  nonEmptyString(value.attempt_id, "reservation.attempt_id");
  if (value.body !== V2_REQUEST_BODY || value.automatic !== true || value.consumed !== true) {
    throw new TypeError("reservation must be an automatic consumed exact request");
  }
  canonicalTimestamp(value.created_at, "reservation.created_at");
  digestString(value.pre_scope_digest, "reservation.pre_scope_digest");
  assertClosedRecord(
    value.status_ledger_binding,
    LEDGER_BINDING_KEYS,
    "reservation.status_ledger_binding",
  );
  sha(
    value.status_ledger_binding.head_ref_oid,
    "reservation.status_ledger_binding.head_ref_oid",
  );
  if (value.status_ledger_binding.head_ref_oid !== value.epoch_head_sha) {
    throw new TypeError("reservation status ledger belongs to another head");
  }
  digestString(
    value.status_ledger_binding.ledger_digest,
    "reservation.status_ledger_binding.ledger_digest",
  );
  integerRange(
    value.status_ledger_binding.automatic_request_count,
    0,
    MAX_AUTOMATIC_REQUESTS_PER_HEAD,
    "reservation.status_ledger_binding.automatic_request_count",
  );
  if (value.status_ledger_binding.automatic_request_count !== value.ordinal - 1) {
    throw new TypeError("reservation ordinal does not follow its head-ledger count");
  }
  integerRange(
    value.status_ledger_binding.exact_sha_context_count,
    0,
    1_000,
    "reservation.status_ledger_binding.exact_sha_context_count",
  );
  nullableString(
    value.status_ledger_binding.latest_status_idempotency_key,
    "reservation.status_ledger_binding.latest_status_idempotency_key",
  );
  validateBoundAttemptIds(
    value.status_ledger_binding.bound_attempt_ids,
    "reservation.status_ledger_binding.bound_attempt_ids",
  );
  canonicalTimestamp(
    value.status_ledger_binding.observed_at,
    "reservation.status_ledger_binding.observed_at",
  );
  if (Date.parse(value.status_ledger_binding.observed_at) > Date.parse(value.created_at)) {
    throw new TypeError("reservation head ledger cannot be observed after reservation creation");
  }
  const reconstructedLedger = {
    schema: V2_HEAD_LEDGER_SCHEMA,
    schema_version: V2_RUNNER_SCHEMA_VERSION,
    repository_node_id: value.repository.node_id,
    pull_request_node_id: value.pull_request.node_id,
    head_ref_oid: value.epoch_head_sha,
    automatic_request_count: value.status_ledger_binding.automatic_request_count,
    exact_sha_context_count: value.status_ledger_binding.exact_sha_context_count,
    latest_status_idempotency_key:
      value.status_ledger_binding.latest_status_idempotency_key,
    bound_attempt_ids: value.status_ledger_binding.bound_attempt_ids,
    observed_at: value.status_ledger_binding.observed_at,
  };
  const expectedLedgerDigest = digestCanonical(
    "codex-review-gate-v2-head-ledger",
    reconstructedLedger,
  );
  if (expectedLedgerDigest !== value.status_ledger_binding.ledger_digest) {
    throw runnerError("LEDGER_DIGEST_MISMATCH", "reservation head-ledger digest is invalid");
  }
  const expectedIntentDigest = digestCanonical(
    "codex-review-gate-v2-request-intent",
    {
      repository_node_id: value.repository.node_id,
      pull_request_node_id: value.pull_request.node_id,
      head_ref_oid: value.epoch_head_sha,
      ordinal: value.ordinal,
      generation_id: value.generation_id,
      scheduler_intent_id: value.scheduler_intent_id,
      body: value.body,
      created_at: value.created_at,
      pre_scope_digest: value.pre_scope_digest,
      ledger_digest: value.status_ledger_binding.ledger_digest,
      recovery_authority: value.recovery_authority,
    },
  );
  if (
    expectedIntentDigest !== value.intent_digest ||
    value.intent_id !== `v2-request:${expectedIntentDigest.slice("sha256:".length)}`
  ) {
    throw runnerError("INTENT_DIGEST_MISMATCH", "reservation intent identity is invalid");
  }
  const expectedAttemptId = `v2-attempt:${digestCanonical(
    "codex-review-gate-v2-request-attempt-id",
    { intent_id: value.intent_id, intent_digest: value.intent_digest },
  ).slice("sha256:".length)}`;
  if (value.attempt_id !== expectedAttemptId) {
    throw runnerError("ATTEMPT_ID_MISMATCH", "reservation attempt identity is invalid");
  }
  digestString(value.reservation_digest, "reservation.reservation_digest");
  const { reservation_digest: _digest, ...withoutDigest } = value;
  const expected = digestCanonical(
    "codex-review-gate-v2-request-reservation",
    withoutDigest,
  );
  if (expected !== value.reservation_digest) {
    throw runnerError("RESERVATION_DIGEST_MISMATCH", "reservation digest is invalid");
  }
  return value;
}

function validateRecoveryAuthority(value, ordinal, snapshot) {
  assertClosedRecord(value, RECOVERY_AUTHORITY_KEYS, "recovery_authority");
  if (value.prior_generation_id !== `automatic:${ordinal - 1}`) {
    throw new TypeError("recovery_authority must bind the immediately prior generation");
  }
  if (!Array.isArray(value.finding_ids) || !Array.isArray(value.closure_ids)) {
    throw new TypeError("recovery_authority finding_ids and closure_ids must be arrays");
  }
  if (
    value.finding_ids.length === 0 ||
    value.finding_ids.length !== value.closure_ids.length ||
    new Set(value.finding_ids).size !== value.finding_ids.length ||
    new Set(value.closure_ids).size !== value.closure_ids.length
  ) {
    throw new TypeError("recovery_authority must bind unique equal non-empty finding and closure lists");
  }
  value.finding_ids.forEach((id, index) =>
    nonEmptyString(id, `recovery_authority.finding_ids[${index}]`));
  value.closure_ids.forEach((id, index) =>
    nonEmptyString(id, `recovery_authority.closure_ids[${index}]`));
  canonicalTimestamp(value.closure_observed_at, "recovery_authority.closure_observed_at");
  if (Date.parse(value.closure_observed_at) >= Date.parse(snapshot.server_time)) {
    throw new TypeError("recovery_authority closure must be observed before the new reservation");
  }
  return structuredClone(value);
}

function validateAttemptReceipt(value, reservation, schedulerRequest) {
  assertClosedRecord(value, ATTEMPT_KEYS, "post_response.attempt");
  if (value.schema !== V2_REQUEST_ATTEMPT_SCHEMA || value.schema_version !== 1) {
    throw new TypeError("post_response.attempt has an unsupported schema");
  }
  if (
    value.attempt_id !== reservation.attempt_id ||
    value.reservation_digest !== reservation.reservation_digest ||
    value.scheduler_intent_id !== reservation.scheduler_intent_id ||
    value.recorded_before_effect !== true ||
    value.retry_limit !== 0
  ) {
    throw runnerError(
      "ATTEMPT_BINDING_MISMATCH",
      "pre-effect attempt does not bind the consumed retry-zero reservation",
    );
  }
  canonicalTimestamp(value.recorded_at, "post_response.attempt.recorded_at");
  digestString(value.attempt_digest, "post_response.attempt.attempt_digest");
  const { attempt_digest: _digest, ...withoutDigest } = value;
  if (
    value.attempt_digest !== digestCanonical(
      "codex-review-gate-v2-request-attempt",
      withoutDigest,
    )
  ) {
    throw runnerError("ATTEMPT_DIGEST_MISMATCH", "pre-effect attempt digest is invalid");
  }
  assertRecord(schedulerRequest, "scheduler automatic request");
  if (
    schedulerRequest.state !== "effect-attempted" ||
    schedulerRequest.intent_id !== reservation.scheduler_intent_id ||
    schedulerRequest.intent_persisted_at !== reservation.created_at ||
    schedulerRequest.effect_attempted_at !== value.recorded_at
  ) {
    throw runnerError(
      "ATTEMPT_LEDGER_MISMATCH",
      "scheduler ledger does not prove the reserved effect attempt was persisted",
    );
  }
  return value;
}

function validateHeadLedger(value, snapshot) {
  assertClosedRecord(value, HEAD_LEDGER_KEYS, "head_ledger");
  if (value.schema !== V2_HEAD_LEDGER_SCHEMA || value.schema_version !== 1) {
    throw new TypeError("head_ledger has an unsupported schema");
  }
  if (
    value.repository_node_id !== snapshot.repository.node_id ||
    value.pull_request_node_id !== snapshot.pull_request.node_id ||
    value.head_ref_oid !== snapshot.scope.head_ref_oid
  ) {
    throw runnerError(
      "HEAD_LEDGER_SCOPE_MISMATCH",
      "head ledger does not match the current repository, PR, and head epoch",
    );
  }
  sha(value.head_ref_oid, "head_ledger.head_ref_oid");
  integerRange(
    value.automatic_request_count,
    0,
    MAX_AUTOMATIC_REQUESTS_PER_HEAD,
    "head_ledger.automatic_request_count",
  );
  integerRange(value.exact_sha_context_count, 0, 1_000, "head_ledger.exact_sha_context_count");
  nullableString(
    value.latest_status_idempotency_key,
    "head_ledger.latest_status_idempotency_key",
  );
  validateBoundAttemptIds(value.bound_attempt_ids, "head_ledger.bound_attempt_ids");
  canonicalTimestamp(value.observed_at, "head_ledger.observed_at");
  if (Date.parse(value.observed_at) > Date.parse(snapshot.server_time)) {
    throw new TypeError("head_ledger.observed_at cannot be later than snapshot.server_time");
  }
  return value;
}

function validateRunnerInput(input) {
  assertClosedRecord(input, RUNNER_INPUT_KEYS, "runner input");
  if (input.schema !== V2_RUNNER_SCHEMA || input.schema_version !== V2_RUNNER_SCHEMA_VERSION) {
    throw new TypeError("runner input has an unsupported schema");
  }
  enumValue(input.operation, OPERATIONS, "operation");
  enumValue(input.status_target_mode, STATUS_TARGET_MODES, "status_target_mode");
  if (boundedString(input.status_context, "status_context", 128) !== V2_STATUS_CONTEXT) {
    throw new TypeError(`status_context must be exactly ${V2_STATUS_CONTEXT}`);
  }
  assertClosedRecord(
    input.snapshot_request,
    SNAPSHOT_REQUEST_KEYS,
    "snapshot_request",
  );
  nonEmptyString(input.snapshot_request.owner, "snapshot_request.owner");
  nonEmptyString(input.snapshot_request.repo, "snapshot_request.repo");
  positiveSafeInteger(input.snapshot_request.pull_number, "snapshot_request.pull_number");
  assertRecord(input.controller, "controller");
  validateV2PublicReportSelectionAuthority(input.public_report_authority);
  validateSchedulingInput(input.scheduling, input.operation);
  if (input.scheduling.status_target_mode !== input.status_target_mode) {
    throw new TypeError(
      "scheduling.status_target_mode must match the public runner status_target_mode",
    );
  }

  if (input.operation === "prepare-request") {
    if (input.head_ledger === null || input.reservation !== null || input.post_response !== null) {
      throw new TypeError(
        "prepare-request requires head_ledger and forbids reservation/post_response",
      );
    }
  } else if (input.operation === "bind-request") {
    if (input.head_ledger === null || input.reservation === null || input.post_response === null) {
      throw new TypeError(
        "bind-request requires head_ledger, reservation, and post_response",
      );
    }
    validateReservation(input.reservation);
  } else if (
    input.head_ledger !== null ||
    input.reservation !== null ||
    input.post_response !== null
  ) {
    throw new TypeError("evaluate-only forbids head_ledger, reservation, and post_response");
  }
  return input;
}

function validateSchedulingInput(value, operation) {
  assertClosedRecord(value, SCHEDULING_KEYS, "scheduling");
  if (operation === "evaluate-only" && value.trigger !== "manual") {
    throw new TypeError("evaluate-only requires scheduling.trigger manual");
  }
  if (operation !== "evaluate-only" && value.trigger === "manual") {
    throw new TypeError("request operations cannot use scheduling.trigger manual");
  }
  if (typeof value.public_wait_supported !== "boolean") {
    throw new TypeError("scheduling.public_wait_supported must be boolean");
  }
  enumValue(
    value.status_target_mode,
    STATUS_TARGET_MODES,
    "scheduling.status_target_mode",
  );
  assertClosedRecord(value.run_identity, RUN_IDENTITY_KEYS, "scheduling.run_identity");
  if (typeof value.run_identity.run_id !== "string" ||
      !/^[1-9][0-9]*$/u.test(value.run_identity.run_id)) {
    throw new TypeError("scheduling.run_identity.run_id must be a positive decimal string");
  }
  positiveSafeInteger(
    value.run_identity.run_attempt,
    "scheduling.run_identity.run_attempt",
  );
  assertRecord(value.epoch, "scheduling.epoch");
  if (!Array.isArray(value.complete_snapshots)) {
    throw new TypeError("scheduling.complete_snapshots must be an array");
  }
  assertRecord(value.status, "scheduling.status");
  assertClosedRecord(
    value.status,
    ["exact_sha_context_count", "latest_idempotency_key", "head_sentinel_receipt"],
    "scheduling.status",
  );
  if (value.status.head_sentinel_receipt !== null) {
    validateHeadSentinelReceipt(value.status.head_sentinel_receipt);
  }
  if (!Array.isArray(value.applied_action_keys)) {
    throw new TypeError("scheduling.applied_action_keys must be an array");
  }
  if (value.no_start_candidate !== null) {
    assertRecord(value.no_start_candidate, "scheduling.no_start_candidate");
  }
}

function validateDependencies(value) {
  assertRecord(value, "runner dependencies");
  if (typeof value.transport?.loadSnapshot !== "function") {
    throw new TypeError("runner dependencies.transport.loadSnapshot must be a function");
  }
  if (typeof value.reduceSnapshot !== "function") {
    throw new TypeError("runner dependencies.reduceSnapshot must be a function");
  }
  const deriveEvidenceRequest = value.deriveEvidenceRequest ?? deriveV2EvidenceRequest;
  const projectSnapshots = value.projectSnapshots ?? projectV2TransportSnapshots;
  const projectPublicReport = value.projectPublicReport ?? projectV2PublicReport;
  if (typeof deriveEvidenceRequest !== "function") {
    throw new TypeError("runner dependencies.deriveEvidenceRequest must be a function");
  }
  if (typeof projectSnapshots !== "function") {
    throw new TypeError("runner dependencies.projectSnapshots must be a function");
  }
  if (typeof projectPublicReport !== "function") {
    throw new TypeError("runner dependencies.projectPublicReport must be a function");
  }
  return {
    transport: value.transport,
    reduceSnapshot: value.reduceSnapshot,
    deriveEvidenceRequest,
    projectSnapshots,
    projectPublicReport,
    planActions: value.planActions ?? planV2Actions,
    validateTarget: value.validateTarget ?? validateStatusTarget,
    getExactArtifact: value.getExactArtifact ?? getExactArtifact,
  };
}

function mergeArtifactSelectors(primary, required) {
  const merged = [];
  const seen = new Set();
  for (const selector of [
    ...normalizeSelectors(primary, "derived artifactSelectors"),
    ...normalizeSelectors(required, "required artifact selectors"),
  ]) {
    const { kind, id } = selector;
    const key = `${kind}:${id}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push({ kind, id });
    }
  }
  return merged;
}

function controllerForProjection(input, discoverySnapshot, responseArtifact) {
  if (responseArtifact === null) {
    return input.controller;
  }
  const controller = structuredClone(input.controller);
  if (!Array.isArray(controller.request_bindings)) {
    // The projector owns the complete controller schema validation. This
    // explicit error only prevents an unsafe provisional bind insertion.
    throw new TypeError("bind-request controller.request_bindings must be an array");
  }
  const provisional = {
    id: responseArtifact.id,
    kind: "automatic",
    base_oid: discoverySnapshot.scope.base_ref_tip,
    head_oid: input.reservation.epoch_head_sha,
    controlled: false,
    generation_id: input.reservation.generation_id,
    generation_kind: input.reservation.generation_kind,
    generation_index: input.reservation.generation_index,
  };
  const existing = controller.request_bindings.find(
    (binding) => binding?.id === responseArtifact.id,
  );
  if (existing !== undefined) {
    if (
      existing.kind !== provisional.kind ||
      existing.base_oid !== provisional.base_oid ||
      existing.head_oid !== provisional.head_oid ||
      existing.controlled !== false
      || existing.generation_id !== provisional.generation_id
      || existing.generation_kind !== provisional.generation_kind
      || existing.generation_index !== provisional.generation_index
    ) {
      throw runnerError(
        "PREMATURE_REQUEST_BINDING",
        "bind-request cannot consume a controlled or scope-mismatched request binding before exact receipt",
      );
    }
    return controller;
  }
  controller.request_bindings.push(provisional);
  return controller;
}

function validateDerivedEvidenceRequest(value) {
  assertClosedRecord(
    value,
    ["artifactSelectors", "permissionSubjects"],
    "derived evidence request",
  );
  return {
    artifactSelectors: normalizeSelectors(
      value.artifactSelectors,
      "derived evidence request.artifactSelectors",
    ),
    permissionSubjects: normalizeSelectors(
      value.permissionSubjects,
      "derived evidence request.permissionSubjects",
    ),
  };
}

function normalizeSelectors(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  const normalized = [];
  const seen = new Set();
  const kinds = new Set(["issue_comment", "pull_request_review", "inline_comment"]);
  for (const [index, selector] of value.entries()) {
    assertClosedRecord(selector, ["kind", "id"], `${label}[${index}]`);
    const kind = nonEmptyString(selector.kind, `${label}[${index}].kind`);
    if (!kinds.has(kind)) {
      throw new TypeError(`${label}[${index}].kind is not a closed artifact kind`);
    }
    const id = decimalId(selector.id, `${label}[${index}].id`);
    const key = `${kind}:${id}`;
    if (seen.has(key)) {
      throw new TypeError(`${label} must not contain duplicate selectors`);
    }
    seen.add(key);
    normalized.push({ kind, id });
  }
  return normalized;
}

function validateReducerReport(report, snapshot, input) {
  validateV2ReducerReport(report);
  enumValue(report.decision, DECISIONS, "reducer report.decision");
  digestString(report.snapshot_fingerprint, "reducer report.snapshot_fingerprint");
  assertRecord(report.status_target, "reducer report.status_target");
  if (
    report.status_target.mode !== input.status_target_mode ||
    report.status_target.context !== input.status_context
  ) {
    throw runnerError(
      "REDUCER_TARGET_MISMATCH",
      "reducer status target does not match the required runner configuration",
    );
  }
  assertRecord(report.review_epoch, "reducer report.review_epoch");
  if (
    String(report.review_epoch.repository_id) !== String(snapshot.repository.node_id)
  ) {
    throw runnerError(
      "REDUCER_REPOSITORY_MISMATCH",
      "reducer report belongs to another repository",
    );
  }
  if (
    report.review_epoch.pull_request_number !== snapshot.pull_request.number ||
    report.review_epoch.base_oid !== snapshot.scope.base_ref_tip ||
    report.review_epoch.head_oid !== snapshot.scope.head_ref_oid ||
    report.review_epoch.merge_base_oid !== snapshot.scope.merge_base_sha ||
    report.review_epoch.merge_oid !== snapshot.scope.potential_merge_oid ||
    report.review_epoch.merge_tree_oid !== snapshot.scope.potential_merge_tree ||
    !isDeepEqual(report.review_epoch.merge_parents, snapshot.scope.ordered_parent_oids) ||
    report.review_epoch.merge_ref_oid !== snapshot.scope.merge_ref_oid ||
    report.review_epoch.mergeable !== snapshot.scope.mergeable ||
    report.review_epoch.lifecycle !== snapshotLifecycle(snapshot.pull_request)
  ) {
    throw runnerError("REDUCER_EPOCH_MISMATCH", "reducer report belongs to another review epoch");
  }
  const expectedTargetSha = input.status_target_mode === "head"
    ? snapshot.scope.head_ref_oid
    : snapshotPotentialTargetIsBound(snapshot.scope)
      ? snapshot.scope.potential_merge_oid
      : null;
  if (report.status_target.sha !== expectedTargetSha) {
    throw runnerError(
      "REDUCER_TARGET_SHA_MISMATCH",
      "reducer status target SHA does not match the current review epoch",
    );
  }
}

function snapshotPotentialTargetIsBound(scope) {
  return scope.mergeable === "MERGEABLE" &&
    isSha(scope.base_ref_tip) &&
    isSha(scope.head_ref_oid) &&
    isSha(scope.merge_base_sha) &&
    isSha(scope.potential_merge_oid) &&
    isSha(scope.potential_merge_tree) &&
    scope.merge_ref_oid === scope.potential_merge_oid &&
    scope.potential_merge_oid !== scope.head_ref_oid &&
    scope.potential_merge_oid !== scope.base_ref_tip &&
    isDeepEqual(scope.ordered_parent_oids, [scope.base_ref_tip, scope.head_ref_oid]);
}

function authorizeStatusWrites(plan, publishAction) {
  if (
    publishAction.decision !== plan.decision ||
    !Number.isSafeInteger(publishAction.required_write_slots) ||
    publishAction.required_write_slots < plan.writes.length
  ) {
    throw runnerError(
      "SCHEDULER_STATUS_MISMATCH",
      "scheduler status authorization does not cover the runner status plan",
    );
  }
  return plan;
}

function suppressStatusWrites(plan, reason) {
  return deepFreeze({
    ...plan,
    writes: [],
    terminal_cutover: false,
    suppressed_writes: plan.writes,
    suppression_reason: reason,
  });
}

function validateSnapshotEnvelope(snapshot, request) {
  validateSnapshotIdentity(snapshot);
  if (
    snapshot.repository.owner.toLowerCase() !== request.owner.toLowerCase() ||
    snapshot.repository.name.toLowerCase() !== request.repo.toLowerCase() ||
    snapshot.pull_request.number !== request.pull_number
  ) {
    throw runnerError(
      "SNAPSHOT_REQUEST_MISMATCH",
      "transport snapshot does not match the requested repository and pull request",
    );
  }
}

function validateSnapshotIdentity(snapshot) {
  assertRecord(snapshot, "snapshot");
  assertRecord(snapshot.repository, "snapshot.repository");
  assertRecord(snapshot.pull_request, "snapshot.pull_request");
  assertRecord(snapshot.scope, "snapshot.scope");
  assertRecord(snapshot.pages, "snapshot.pages");
  assertRecord(snapshot.completeness, "snapshot.completeness");
  nonEmptyString(snapshot.repository.owner, "snapshot.repository.owner");
  nonEmptyString(snapshot.repository.name, "snapshot.repository.name");
  nonEmptyString(snapshot.repository.node_id, "snapshot.repository.node_id");
  positiveSafeInteger(snapshot.pull_request.number, "snapshot.pull_request.number");
  nonEmptyString(snapshot.pull_request.node_id, "snapshot.pull_request.node_id");
  sha(snapshot.scope.head_ref_oid, "snapshot.scope.head_ref_oid");
  canonicalTimestamp(snapshot.server_time, "snapshot.server_time");
}

function snapshotIsComplete(snapshot) {
  const required = [
    "all_pages_loaded",
    "issue_comments",
    "reviews",
    "inline_comments",
    "threads",
    "reactions",
    "permissions",
    "exact_artifacts",
  ];
  return required.every((key) => snapshot.completeness[key] === true);
}

function scopeBinding(snapshot) {
  return {
    repository_node_id: snapshot.repository.node_id,
    pull_request_node_id: snapshot.pull_request.node_id,
    pull_request_number: snapshot.pull_request.number,
    lifecycle: {
      state: snapshot.pull_request.state,
      merged: snapshot.pull_request.merged,
      merged_at: snapshot.pull_request.merged_at,
      is_draft: snapshot.pull_request.is_draft,
    },
    scope: snapshot.scope,
  };
}

function snapshotLifecycle(pullRequest) {
  if (pullRequest.merged === true || pullRequest.merged_at !== null) {
    return "merged";
  }
  return pullRequest.state === "OPEN" ? "open" : "closed";
}

function statusPlan(mode, decision, writes, terminalCutover) {
  return deepFreeze({
    mode,
    decision,
    writes,
    terminal_cutover: terminalCutover,
    freshness_assurance: "point-in-time",
  });
}

function blockedHeadPlan({
  mode,
  decision,
  context,
  target,
  snapshotFingerprint,
}) {
  const state = HEAD_SENTINEL_STATE_BY_DECISION[decision] ?? "error";
  const writes = isSha(target.head_sentinel_sha)
    ? [{
        role: "head-sentinel",
        sha: target.head_sentinel_sha,
        context,
        state,
        reason: target.blocked_reason ?? "status-target-invalid",
        idempotency_key: statusWriteKey(
          target.head_sentinel_sha,
          context,
          state,
          snapshotFingerprint,
        ),
      }]
    : [];
  return statusPlan(mode, decision, writes, false);
}

function statusWriteKey(shaValue, context, state, fingerprint) {
  return `status:${digestCanonical("codex-review-gate-v2-status-write", {
    sha: shaValue,
    context,
    state,
    snapshot_fingerprint: fingerprint,
  }).slice("sha256:".length)}`;
}

function validNonSuccessHeadSentinelReceipt(value, expected) {
  if (value === null || value === undefined) return false;
  try {
    validateHeadSentinelReceipt(value);
  } catch {
    return false;
  }
  return value.sha === expected.sha &&
    value.context === expected.context &&
    value.state !== "success";
}

function validateHeadSentinelReceipt(value) {
  assertClosedRecord(
    value,
    ["sha", "context", "state", "status_id", "observed_at"],
    "head_sentinel_receipt",
  );
  sha(value.sha, "head_sentinel_receipt.sha");
  if (value.context !== V2_STATUS_CONTEXT) {
    throw new TypeError(`head_sentinel_receipt.context must be exactly ${V2_STATUS_CONTEXT}`);
  }
  enumValue(value.state, new Set(["pending", "failure", "error"]), "head_sentinel_receipt.state");
  decimalId(value.status_id, "head_sentinel_receipt.status_id");
  canonicalTimestamp(value.observed_at, "head_sentinel_receipt.observed_at");
  return value;
}

function normalizeActor(value, label) {
  assertRecord(value, label);
  return {
    id: decimalId(value.id, `${label}.id`),
    login: nonEmptyString(value.login, `${label}.login`),
    type: nonEmptyString(value.type, `${label}.type`),
    node_id: nullableNonEmptyString(value.node_id, `${label}.node_id`),
  };
}

function normalizeApp(value) {
  if (value === null) {
    return null;
  }
  assertRecord(value, "post_response body app");
  return {
    id: decimalId(value.id, "post_response body app.id"),
    slug: nonEmptyString(value.slug, "post_response body app.slug"),
    node_id: nullableNonEmptyString(value.node_id, "post_response body app.node_id"),
  };
}

function digestRaw(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function digestCanonical(domain, value) {
  const hash = createHash("sha256");
  const domainBytes = Buffer.from(domain, "utf8");
  const valueBytes = Buffer.from(canonicalJson(value), "utf8");
  hash.update(`${domainBytes.length}:`);
  hash.update(domainBytes);
  hash.update("\0");
  hash.update(`${valueBytes.length}:`);
  hash.update(valueBytes);
  return `sha256:${hash.digest("hex")}`;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function isDeepEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function assertRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertClosedRecord(value, allowedKeys, label) {
  assertRecord(value, label);
  const allowed = new Set(allowedKeys);
  const keys = Object.keys(value);
  const missing = allowedKeys.filter((key) => !Object.hasOwn(value, key));
  const unknown = keys.filter((key) => !allowed.has(key));
  if (missing.length > 0 || unknown.length > 0) {
    throw new TypeError(
      `${label} must use its closed schema ` +
      `(missing: ${missing.join(", ") || "none"}; unknown: ${unknown.join(", ") || "none"})`,
    );
  }
}

function enumValue(value, allowed, label) {
  if (!allowed.has(value)) {
    throw new TypeError(`${label} is not a closed v2 value`);
  }
  return value;
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function boundedString(value, label, maxLength) {
  nonEmptyString(value, label);
  if (value.length > maxLength) {
    throw new TypeError(`${label} exceeds ${maxLength} characters`);
  }
  return value;
}

function nullableString(value, label) {
  if (value !== null) {
    nonEmptyString(value, label);
  }
  return value;
}

function nullableNonEmptyString(value, label) {
  if (value === null || value === undefined) {
    return null;
  }
  return nonEmptyString(value, label);
}

function canonicalTimestamp(value, label) {
  if (typeof value !== "string" || !STRICT_UTC_TIMESTAMP.test(value)) {
    throw new TypeError(`${label} must be a strict UTC timestamp`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== normalizeIso(value)) {
    throw new TypeError(`${label} must be a canonical UTC timestamp`);
  }
  return normalizeIso(value);
}

function normalizeIso(value) {
  const match = value.match(STRICT_UTC_TIMESTAMP);
  return `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z`;
}

function isSha(value) {
  return typeof value === "string" && SHA_PATTERN.test(value);
}

function sha(value, label) {
  if (!isSha(value)) {
    throw new TypeError(`${label} must be a lowercase 40-character SHA`);
  }
  return value;
}

function digestString(value, label) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function validateBoundAttemptIds(value, label) {
  if (!Array.isArray(value) || value.length > 1_000) {
    throw new TypeError(`${label} must be an array with at most 1000 entries`);
  }
  const seen = new Set();
  for (const [index, attemptId] of value.entries()) {
    if (
      typeof attemptId !== "string" ||
      !/^v2-attempt:[0-9a-f]{64}$/u.test(attemptId)
    ) {
      throw new TypeError(`${label}[${index}] must be a canonical v2 attempt id`);
    }
    if (seen.has(attemptId)) {
      throw new TypeError(`${label} must not contain duplicate attempt ids`);
    }
    seen.add(attemptId);
  }
  return value;
}


function decimalId(value, label) {
  const normalized = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : value;
  if (typeof normalized !== "string" || !DECIMAL_ID_PATTERN.test(normalized)) {
    throw new TypeError(`${label} must be a canonical decimal id`);
  }
  return normalized;
}

function positiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function integerRange(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${label} must be an integer from ${min} through ${max}`);
  }
  return value;
}

function absoluteUrl(value, label) {
  nonEmptyString(value, label);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${label} must be an absolute URL`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TypeError(`${label} must use HTTP or HTTPS`);
  }
  return parsed.href;
}

function runnerError(code, message, options = undefined) {
  const error = new Error(message, options);
  error.name = "V2RunnerError";
  error.code = code;
  return error;
}
