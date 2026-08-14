import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

import {
  planV2Actions,
  V2_SCHEDULER_SCHEMA,
  V2_SCHEDULER_SCHEMA_VERSION,
} from "./scheduler.mjs";
import {
  finalizeV2CandidateInventoryCycle,
  V2_CANDIDATE_CYCLE_RECEIPT_SCHEMA,
  V2_CANDIDATE_SHARD_RECEIPT_SCHEMA,
  validateV2CandidateCycleReceipt,
  validateV2CandidateInventory,
  validateV2CandidateShardReceipt,
} from "./candidate-inventory.mjs";
import {
  assertV2ProviderPreScopeArtifactEqualsSnapshot,
  assertV2ProviderPreScopeArtifactHandle,
  assertV2TransportSnapshotHandle,
  getExactArtifact,
  V2_TRANSPORT_DEFAULT_LIMITS,
} from "./transport.mjs";
import {
  buildV2AttemptReceipt,
  prepareV2Request,
} from "./runner.mjs";

export const V2_GIT_LEDGER_REF =
  "refs/heads/codex-review-gate-ledger-v2";
export const V2_GIT_LEDGER_BLOB_PATH =
  "codex-review-gate-ledger-v2.json";
export const V2_GIT_LEDGER_CAPABILITY_SCHEMA =
  "codex-review-gate-git-ledger-capability-v2";
export const V2_GIT_LEDGER_ENVELOPE_SCHEMA =
  "codex-review-gate-git-ledger-envelope-v2";
export const V2_GIT_LEDGER_PUBLIC_ENVELOPE_SCHEMA =
  "codex-review-gate-git-ledger-public-envelope-v2";
export const V2_GIT_LEDGER_RECORD_SCHEMA =
  "codex-review-gate-git-ledger-record-v2";
export const V2_GIT_LEDGER_APPEND_RECEIPT_SCHEMA =
  "codex-review-gate-git-ledger-append-receipt-v2";
export const V2_GIT_LEDGER_BOOTSTRAP_RECEIPT_SCHEMA =
  "codex-review-gate-git-ledger-bootstrap-receipt-v2";
export const V2_GIT_LEDGER_BOOTSTRAP_INPUT_SCHEMA =
  "codex-review-gate-git-ledger-bootstrap-input-v2";
export const V2_GIT_LEDGER_WRITE_OBSERVATION_SCHEMA =
  "codex-review-gate-git-ledger-write-observation-v2";
export const V2_GIT_LEDGER_LEASE_RECEIPT_SCHEMA =
  "codex-review-gate-git-ledger-lease-receipt-v2";
export const V2_GIT_LEDGER_PROVENANCE_REQUEST_SCHEMA =
  "codex-review-gate-git-ledger-provenance-request-v2";
export const V2_GIT_LEDGER_PROVENANCE_RECEIPT_SCHEMA =
  "codex-review-gate-git-ledger-provenance-receipt-v2";
export const V2_GIT_LEDGER_PROVENANCE_VERIFIER_REQUEST_SCHEMA =
  "codex-review-gate-git-ledger-provenance-verifier-request-v2";
export const V2_GIT_LEDGER_PROVENANCE_VERIFIER_RESULT_SCHEMA =
  "codex-review-gate-git-ledger-provenance-verifier-result-v2";
export const V2_GIT_LEDGER_EFFECT_PAYLOAD_SCHEMA =
  "codex-review-gate-git-ledger-effect-payload-v2";
export const V2_GIT_LEDGER_AUTHORITY_PROJECTION_SCHEMA =
  "codex-review-gate-git-ledger-authority-projection-v2";
export const V2_GIT_LEDGER_CONTROL_PLANE_AUTHORITY_SCHEMA =
  "codex-review-gate-git-ledger-control-plane-authority-v2";
export const V2_GIT_LEDGER_EVALUATED_SCOPE_RECEIPT_SCHEMA =
  "codex-review-gate-git-ledger-evaluated-scope-receipt-v2";
export const V2_GIT_LEDGER_DISCOVERY_CONTINUITY_RECEIPT_SCHEMA =
  "codex-review-gate-git-ledger-discovery-continuity-receipt-v2";
export const V2_GIT_LEDGER_SCHEDULER_OBSERVATION_SCHEMA =
  "codex-review-gate-git-ledger-scheduler-observation-v2";
export const V2_GIT_LEDGER_RUNNER_STATE_SCHEMA =
  "codex-review-gate-git-ledger-runner-state-v2";
export const V2_GIT_LEDGER_INITIAL_RUNNER_STATE_AUTHORITY_SCHEMA =
  "codex-review-gate-git-ledger-initial-runner-state-authority-v2";
export const V2_GIT_LEDGER_ESTABLISHED_RUNNER_STATE_AUTHORITY_SCHEMA =
  "codex-review-gate-git-ledger-established-runner-state-authority-v2";
export const V2_GIT_LEDGER_STATUS_WRITE_INTENT_HANDLE_SCHEMA =
  "codex-review-gate-git-ledger-status-write-intent-handle-v2";
export const V2_GIT_LEDGER_AUTOMATIC_RESERVATION_HANDLE_SCHEMA =
  "codex-review-gate-git-ledger-automatic-reservation-handle-v2";
export const V2_GIT_LEDGER_RESERVATION_STATUS_INTENT_HANDLE_SCHEMA =
  "codex-review-gate-git-ledger-reservation-status-intent-handle-v2";
export const V2_GIT_LEDGER_AUTOMATIC_REQUEST_INTENT_HANDLE_SCHEMA =
  "codex-review-gate-git-ledger-automatic-request-intent-handle-v2";
export const V2_GIT_LEDGER_AUTOMATIC_REVIEW_REQUEST_BINDING_RECEIPT_SCHEMA =
  "codex-review-gate-git-ledger-automatic-review-request-binding-receipt-v2";
export const V2_GIT_LEDGER_AUTOMATIC_REVIEW_REQUEST_SCOPE_RECEIPT_SCHEMA =
  "codex-review-gate-parent-recorded-request-scope-v1";
export const V2_GIT_LEDGER_REQUEST_RESERVATION_SCHEMA =
  "codex-review-gate-request-reservation-v2";
export const V2_GIT_LEDGER_REQUEST_ATTEMPT_SCHEMA =
  "codex-review-gate-request-attempt-v2";
export const V2_GIT_LEDGER_HEAD_LEDGER_SCHEMA =
  "codex-review-gate-head-ledger-v2";
export const V2_GIT_LEDGER_CANDIDATE_INVENTORY_RECORD_SCHEMA =
  "codex-review-gate-git-ledger-candidate-inventory-record-v2";
export const V2_GIT_LEDGER_CANDIDATE_INVENTORY_AUTHORITY_SCHEMA =
  "codex-review-gate-git-ledger-candidate-inventory-authority-v2";
export const V2_GIT_LEDGER_CANDIDATE_DISPATCH_RECORD_SCHEMA =
  "codex-review-gate-git-ledger-candidate-dispatch-record-v2";
export const V2_GIT_LEDGER_CANDIDATE_DISPATCH_AUTHORITY_SCHEMA =
  "codex-review-gate-git-ledger-candidate-dispatch-authority-v2";
export const V2_GIT_LEDGER_CANDIDATE_DISPATCH_HANDLE_SCHEMA =
  "codex-review-gate-git-ledger-candidate-dispatch-handle-v2";
export const V2_GIT_LEDGER_CANDIDATE_DISPATCH_RESERVATION_SCHEMA =
  "codex-review-gate-git-ledger-candidate-dispatch-reservation-v2";
export const V2_GIT_LEDGER_CANDIDATE_DISPATCH_RESERVATION_RECEIPT_SCHEMA =
  "codex-review-gate-git-ledger-candidate-dispatch-reservation-receipt-v2";
export const V2_GIT_LEDGER_CANDIDATE_DISPATCH_PLAN_SCHEMA =
  "codex-review-gate-git-ledger-candidate-dispatch-plan-v2";
export const V2_GIT_LEDGER_CANDIDATE_DISPATCH_RESULT_SCHEMA =
  "codex-review-gate-git-ledger-candidate-dispatch-result-v2";
export const V2_GIT_LEDGER_CANDIDATE_DISPATCH_RESULT_HANDLE_SCHEMA =
  "codex-review-gate-git-ledger-candidate-dispatch-result-handle-v2";
export const MAX_V2_CANDIDATE_DISPATCH_ITEMS = 64;
export const MAX_V2_CANDIDATE_DISPATCH_PLAN_BYTES = 32 * 1024;
export const MAX_V2_CANDIDATE_DISPATCH_CYCLE_ITEMS = 512;
export const MAX_V2_CANDIDATE_DISPATCH_BATCHES = 8;
export const MAX_V2_CANDIDATE_DISPATCH_RECORD_BYTES = 128 * 1024;
// One lease acquire, one scheduler observation, required status intent/response,
// automatic reservation, reservation-status intent/response, effect attempt,
// review-request intent/response, request-binding intent/response, release,
// and the repository-scoped candidate acknowledgement. The stable capability
// epoch and its bootstrap/attestation are factory preconditions, not per-PR
// records in this bounded protocol.
export const MAX_V2_SCHEDULED_CANDIDATE_LEDGER_RECORDS = 14;
export const V2_GIT_LEDGER_PROVIDER_IDENTITY_POLICY_SCHEMA =
  "codex-review-gate-provider-identity-policy-v2";
export const V2_GIT_LEDGER_PROVIDER_IDENTITY_AUTHORITY_SCHEMA =
  "codex-review-gate-provider-identity-authority-v2";
export const V2_GIT_LEDGER_OIDC_AUDIENCE =
  "codex-review-gate-git-ledger-v2";
export const MAX_V2_GIT_LEDGER_COMMITS = 4_096;
export const MAX_V2_GIT_LEDGER_BLOB_BYTES = 1024 * 1024;
export const MAX_V2_GIT_LEDGER_HTTP_REQUESTS =
  MAX_V2_GIT_LEDGER_COMMITS * 3 + 64;
export const MAX_V2_GIT_LEDGER_HTTP_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_V2_GIT_LEDGER_HTTP_TOTAL_BYTES = 256 * 1024 * 1024;
export const V2_GIT_LEDGER_HTTP_TIMEOUT_MS = 15_000;
export const V2_GIT_LEDGER_PROVENANCE_TIMEOUT_MS = 15_000;
export const V2_GIT_LEDGER_APPEND_SAFETY_WINDOW_MS =
  V2_GIT_LEDGER_PROVENANCE_TIMEOUT_MS + (5 * V2_GIT_LEDGER_HTTP_TIMEOUT_MS);
export const V2_GIT_LEDGER_HTTP_LIMITS = Object.freeze({
  request_count: MAX_V2_GIT_LEDGER_HTTP_REQUESTS,
  response_bytes: MAX_V2_GIT_LEDGER_HTTP_RESPONSE_BYTES,
  total_response_bytes: MAX_V2_GIT_LEDGER_HTTP_TOTAL_BYTES,
  timeout_ms: V2_GIT_LEDGER_HTTP_TIMEOUT_MS,
});
export const V2_GIT_LEDGER_EFFECT_KINDS = Object.freeze([
  "control-comment-create",
  "control-comment-update",
  "automatic-request-reservation",
  "reservation-status-write",
  "review-request",
  "request-binding",
  "artifact-binding",
  "status-write",
  "sticky-comment",
  "no-start-observation",
  "thread-resolution-observation",
  "scheduler-observation",
  "effect-attempt",
  "scheduler-state",
]);
export const V2_GIT_LEDGER_OIDC_CLAIMS = Object.freeze([
  "aud", "event_name", "exp", "iat", "iss", "job_workflow_ref",
  "job_workflow_sha", "nbf", "ref", "repository", "repository_id",
  "repository_owner_id", "run_attempt", "run_id", "sha", "sub",
  "workflow_ref", "workflow_sha",
]);
export const V2_GIT_LEDGER_OPTIONAL_OIDC_CLAIMS = Object.freeze(["jti"]);

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const GENERATION_ID = /^(automatic|manual):([1-9][0-9]*)$/u;
const RUNNER_EPOCH_ID = /^v2-head:[0-9a-f]{64}$/u;
const RUNNER_ATTEMPT_ID = /^v2-attempt:[0-9a-f]{64}$/u;
const RUNNER_INTENT_ID = /^v2-request:[0-9a-f]{64}$/u;
const CANDIDATE_CYCLE_ID = /^candidate-cycle:[0-9a-f]{64}$/u;
const CANDIDATE_DISPATCH_GENERATION_ID =
  /^candidate-dispatch:[0-9a-f]{64}$/u;
const COMMIT_AUTHOR = Object.freeze({
  name: "Codex Review Gate",
  email: "codex-review-gate@users.noreply.github.com",
});
const TIMESTAMP =
  /^(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d{1,3}))?Z$/u;
const RECORD_TYPES = new Set([
  "lease-acquire",
  "lease-release",
  "effect-intent",
  "effect-response",
  "candidate-inventory-observation",
  "candidate-dispatch-observation",
]);
const REPOSITORY_RECORD_TYPES = new Set([
  "candidate-inventory-observation",
  "candidate-dispatch-observation",
]);
const INTERNAL_RECORD_TYPES = new Set([
  "genesis",
  "capability-canary",
  "capability-attestation",
]);
const ALL_RECORD_TYPES = new Set([...RECORD_TYPES, ...INTERNAL_RECORD_TYPES]);
const PROVENANCE_OPERATIONS = new Set([
  "load",
  "bootstrap-genesis",
  "bootstrap-race",
  "bootstrap-race-alpha",
  "bootstrap-race-beta",
  ...RECORD_TYPES,
]);
const BOOTSTRAP_AUTHORITY = Symbol("v2-git-ledger-bootstrap-authority");
const CONTROL_PLANE_AUTHORITY_HANDLES = new WeakSet();
const INITIAL_RUNNER_STATE_AUTHORITY_HANDLES = new WeakMap();
const ESTABLISHED_RUNNER_STATE_AUTHORITY_HANDLES = new WeakMap();
const STATUS_WRITE_INTENT_HANDLES = new WeakMap();
const AUTOMATIC_RESERVATION_HANDLES = new WeakMap();
const RESERVATION_STATUS_INTENT_HANDLES = new WeakMap();
const AUTOMATIC_REQUEST_INTENT_HANDLES = new WeakMap();
const CANDIDATE_DISPATCH_HANDLES = new WeakMap();
const CANDIDATE_DISPATCH_RESULT_HANDLES = new WeakMap();
const EFFECT_KINDS = new Set(V2_GIT_LEDGER_EFFECT_KINDS);
const CONFLICT_PROFILES = new Map([
  [409, Object.freeze({
    message: "Reference update conflict",
    documentation_url: "https://docs.github.com/rest/git/refs#update-a-reference",
    status: "409",
  })],
  [422, Object.freeze({
    message: "Update is not a fast forward",
    documentation_url: "https://docs.github.com/rest/git/refs#update-a-reference",
    status: "422",
  })],
]);

/**
 * Atomic, append-only controller ledger backed by one protected Git ref.
 *
 * Git objects are deliberately created before the compare-and-advance ref
 * update. A losing sibling is unreachable and harmless; it is never rebased
 * or retried. Production records are accepted only behind a reachable live
 * capability attestation for the exact current protection receipt.
 */
export function createV2GitHubGitLedger({
  fetch: fetchImpl,
  token,
  repository,
  ledgerRef,
  restBaseUrl = "https://api.github.com",
  capabilityReceipt = null,
  preflightHandle = null,
  verifyWorkflowProvenance,
  httpLimits = V2_GIT_LEDGER_HTTP_LIMITS,
  provenanceTimeoutMs = V2_GIT_LEDGER_PROVENANCE_TIMEOUT_MS,
  _bootstrapAuthority = null,
  _bootstrapInput = null,
}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("Git ledger requires fetch");
  }
  const authorization = boundedString(token, "token", 4096);
  const repo = normalizeRepository(repository);
  if (
    preflightHandle !== null &&
    (typeof preflightHandle !== "object" || preflightHandle === null)
  ) {
    throw new TypeError("Git ledger preflightHandle must be an object or null");
  }
  const ref = normalizeLedgerRef(ledgerRef);
  let capability = capabilityReceipt === null
    ? null
    : validateV2GitLedgerCapabilityReceipt(capabilityReceipt, {
      repository: repo,
      ledger_ref: ref,
    });
  const bootstrapCandidate = _bootstrapAuthority === BOOTSTRAP_AUTHORITY
    ? validateV2GitLedgerBootstrapInput(_bootstrapInput, {
      repository: repo,
      ledger_ref: ref,
    })
    : null;
  if (
    (_bootstrapAuthority === BOOTSTRAP_AUTHORITY) !==
      (bootstrapCandidate !== null) ||
    (_bootstrapAuthority !== BOOTSTRAP_AUTHORITY && capability === null)
  ) {
    throw new TypeError("Git ledger capability authority is unavailable");
  }
  if (typeof verifyWorkflowProvenance !== "function") {
    throw new TypeError("Git ledger requires verifyWorkflowProvenance");
  }
  const base = normalizeRestBase(restBaseUrl);
  const repoPath = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
  const refSuffix = ref.slice("refs/".length);
  const createRequestBudget = () => createHttpRequestBudget(httpLimits);
  const createVerifierBudget = () => createProvenanceBudget(
    provenanceTimeoutMs,
  );
  const providerPreScopeReceipts = new WeakMap();
  const fullScopeReceipts = new WeakMap();
  const providerFullScopeReceipts = new WeakSet();
  const manualScopeReceipts = new WeakSet();
  const evaluatedScopeReceipts = new WeakMap();
  const controlPlaneAuthorityHandles = new WeakMap();
  const initialRunnerStateAuthorityHandles = new WeakMap();
  const consumedInitialRunnerStateAuthorities = new WeakSet();
  const establishedRunnerStateAuthorityHandles = new WeakMap();
  const consumedEstablishedRunnerStateAuthorities = new WeakSet();
  const schedulerAppendHandles = new WeakMap();
  const consumedStatusSchedulerAppends = new WeakSet();
  const consumedReservationSchedulerAppends = new WeakSet();
  const statusWriteIntentHandles = new WeakMap();
  const consumedStatusWriteIntentHandles = new WeakSet();
  const automaticReservationHandles = new WeakMap();
  const reservationStatusIntentHandles = new WeakMap();
  const consumedReservationStatusIntents = new WeakSet();
  const reservationStatusResponseAppends = new WeakMap();
  const consumedReservationStatusResponseAppends = new WeakSet();
  const automaticRequestIntentHandles = new WeakMap();
  const automaticRequestBindingProgress = new WeakMap();
  const candidateDispatchHandles = new WeakMap();
  const candidateDispatchResultHandles = new WeakMap();
  const consumedCandidateDispatchHandles = new WeakSet();
  const candidateDispatchReservationReceipts = new WeakMap();
  const candidateDispatchScheduledReceipts = new WeakMap();
  const candidateDispatchHandlesByPreScopeReceipt = new WeakMap();
  const leaseReleaseReceipts = new WeakMap();
  let authorityMintOrdinal = 0;

  const sealSchedulerAppend = ({
    schema,
    record,
    append_receipt: appendReceipt,
    evaluated_scope_receipt: evaluatedScopeReceipt,
    lease_authority: leaseAuthority,
    scope,
    runner_state_authority: runnerStateAuthority,
  }) => {
    const result = deepFreeze({
      schema,
      schema_version: 1,
      record,
      append_receipt: appendReceipt,
    });
    schedulerAppendHandles.set(result, deepFreeze({
      evaluated_scope_receipt: evaluatedScopeReceipt,
      lease_authority: structuredClone(leaseAuthority),
      scope: structuredClone(scope),
      observation_record_oid: appendReceipt.commit_sha,
      runner_state_authority: runnerStateAuthority,
    }));
    return result;
  };

  const mintCandidateDispatchHandle = ({
    loaded,
    purpose,
    workflowCommandHandle,
    commandAuthority,
    minimalScopeHandle = null,
    candidate = null,
  }) => {
    const dispatchAuthority = loaded.authority_projection.candidate_dispatch;
    const active = dispatchAuthority.active_reservation;
    if (active === null) {
      throw ledgerError(
        "candidate-dispatch-reservation-required",
        "candidate dispatch handle requires one reachable active reservation",
      );
    }
    const source = loaded.records.find((entry) =>
      entry.commit_sha === active.reservation_record_oid);
    const evaluatedScopeReceipt = source?.envelope?.workflow_provenance
      ?.operation_binding?.evaluated_scope_receipt;
    if (
      source?.envelope?.record_type !== "candidate-dispatch-observation" ||
      source.envelope.payload.phase !== "reserve" ||
      evaluatedScopeReceipt?.relation !== "scheduled-repository-dispatch"
    ) {
      throw ledgerError(
        "candidate-dispatch-reservation-unreachable",
        "active candidate dispatch reservation lacks one protected source record",
      );
    }
    const plan = purpose === "scan" ? createCandidateDispatchPlan(active) : null;
    const reservationReceipt = createCandidateDispatchReservationReceipt({
      active,
      sourceDispatchAuthorityDigest: dispatchAuthority.authority_digest,
      sourceTipCommitSha: loaded.tip_commit_sha,
    });
    const handle = sealCandidateDispatchHandle({
      purpose,
      reservation: active.reservation,
      candidate,
      sourceDispatchAuthorityDigest: dispatchAuthority.authority_digest,
      sourceTipCommitSha: loaded.tip_commit_sha,
    });
    const privateHandle = deepFreeze({
      purpose,
      repository: structuredClone(repo),
      reservation: structuredClone(active.reservation),
      reservation_record_oid: active.reservation_record_oid,
      reservation_receipt: reservationReceipt,
      reservation_evaluated_scope_receipt:
        structuredClone(evaluatedScopeReceipt),
      repository_endpoint_receipt:
        structuredClone(evaluatedScopeReceipt.scope_endpoint_receipt),
      source_dispatch_authority_digest: dispatchAuthority.authority_digest,
      source_tip_commit_sha: loaded.tip_commit_sha,
      workflow_command_handle: workflowCommandHandle,
      command_authority: structuredClone(commandAuthority),
      trigger_identity: structuredClone(active.reservation.trigger_identity),
      minimal_scope_handle: minimalScopeHandle,
      candidate: candidate === null ? null : structuredClone(candidate),
      candidate_index: candidate === null
        ? null
        : active.reservation.candidates.findIndex((item) =>
          canonicalJson(item) === canonicalJson(candidate)),
      plan,
    });
    if (candidate !== null && privateHandle.candidate_index < 0) {
      throw ledgerError(
        "candidate-dispatch-scope-mismatch",
        "candidate dispatch handle selected a candidate outside its reservation",
      );
    }
    CANDIDATE_DISPATCH_HANDLES.set(handle, privateHandle);
    candidateDispatchHandles.set(handle, privateHandle);
    candidateDispatchReservationReceipts.set(
      reservationReceipt,
      privateHandle,
    );
    return deepFreeze({
      candidate_dispatch_handle: handle,
      reservation_receipt: reservationReceipt,
      plan,
    });
  };

  const api = Object.freeze({
    async load() {
      if (capability === null) {
        throw ledgerError(
          "capability-attestation-required",
          "production load is unavailable before bootstrap seals capability",
        );
      }
      const requestBudget = createRequestBudget();
      const provenanceBudget = createVerifierBudget();
      const loaded = await loadStableChain({
        fetchImpl,
        authorization,
        base,
        repoPath,
        ref,
        refSuffix,
        repo,
        verifyWorkflowProvenance,
        provenanceBudget,
        requestBudget,
      });
      await validateStoredProviderIdentityAuthorities(
        loaded.records,
        capability.provider_identity_policy,
        preflightHandle,
        repo,
      );
      const authority = requireCurrentCapability(loaded, capability);
      const provenance = await obtainWorkflowProvenance({
        verifyWorkflowProvenance,
        operation: "load",
        repository: repo,
        ledgerRef: ref,
        predecessorCommitSha: loaded.tip_commit_sha,
        protectionReceiptDigest:
          capability.protection.live_ruleset_receipt_digest,
        source: sourceWorkflow(capability.controller_release),
        effectScope: null,
        recordIdentity: null,
        serverTime: loaded.post_ref.server_time,
        policy: capability.workflow_provenance_policy,
        provenanceBudget,
      });
      assertUnusedProvenanceJti(
        new Set(loaded.records.map((entry) =>
          provenanceReplayIdentity(entry.envelope.workflow_provenance))),
        provenance.receipt,
      );
      return sealLoadedLedger(
        loaded,
        capability,
        authority,
        loaded.observed_at,
        provenance.receipt,
      );
    },

    async loadControlPlaneAuthority(expectedScope) {
      const scope = normalizeEffectScope(expectedScope);
      if (scope === null) {
        throw new TypeError("control-plane authority requires one exact effect scope");
      }
      const loaded = await api.load();
      const scopedAuthority = deriveV2GitLedgerAuthority(
        loaded.records,
        scope,
        loaded.observed_at,
      );
      const binding = {
        schema: V2_GIT_LEDGER_CONTROL_PLANE_AUTHORITY_SCHEMA,
        schema_version: 1,
        scope,
        load: loaded,
        scoped_authority: scopedAuthority,
        stable: true,
      };
      const handle = validateV2GitLedgerControlPlaneAuthority({
        ...binding,
        binding_digest: digestCanonical(
          "codex-review-gate-v2-git-ledger-control-plane-authority",
          binding,
        ),
      });
      CONTROL_PLANE_AUTHORITY_HANDLES.add(handle);
      controlPlaneAuthorityHandles.set(handle, deepFreeze({
        load: loaded,
        scope: handle.scope,
        created_ordinal: ++authorityMintOrdinal,
      }));
      return handle;
    },

    async loadControlPlaneReceipt(expectedScope) {
      const handle = await api.loadControlPlaneAuthority(expectedScope);
      const module = await import("./control-plane-receipt.mjs");
      if (
        typeof module.createV2ControlPlaneReceiptFromGitLedgerAuthority !==
          "function"
      ) {
        throw ledgerError(
          "CONTROL_PLANE_RECEIPT_ADAPTER_UNAVAILABLE",
          "control-plane receipt authority adapter is unavailable",
        );
      }
      return module.createV2ControlPlaneReceiptFromGitLedgerAuthority(handle);
    },

    async loadInitialRunnerStateAuthority({
      control_plane_authority,
      evaluated_scope_receipt,
      workflow_command_handle,
    }) {
      const controlPlaneAuthority =
        assertV2GitLedgerControlPlaneAuthorityHandle(
          control_plane_authority,
        );
      const controlPlanePrivate = controlPlaneAuthorityHandles.get(
        control_plane_authority,
      );
      if (controlPlanePrivate === undefined) {
        throw ledgerError(
          "UNTRUSTED_CONTROL_PLANE_AUTHORITY_HANDLE",
          "initial runner authority requires this factory's exact control-plane load",
        );
      }
      const evaluatedScopeReceipt = validateV2GitLedgerEvaluatedScopeReceipt(
        evaluated_scope_receipt,
        { repository: repo },
      );
      if (!evaluatedScopeReceipts.has(evaluated_scope_receipt)) {
        throw ledgerError(
          "untrusted-evaluated-scope-receipt",
          "initial runner authority requires the exact factory-created evaluated scope",
        );
      }
      if (
        evaluatedScopeReceipt.phase !== "full-discovery" ||
        !fullScopeReceipts.has(evaluated_scope_receipt)
      ) {
        throw ledgerError(
          "full-discovery-receipt-required",
          "initial runner authority requires post-lease full discovery",
        );
      }
      if (
        evaluatedScopeReceipt.relation === "provider-selector" &&
        (
          evaluatedScopeReceipt.provider_artifact_receipt.phase !==
            "full-discovery" ||
          !providerFullScopeReceipts.has(evaluated_scope_receipt)
        )
      ) {
        throw ledgerError(
          "provider-full-scope-required",
          "initial runner authority requires post-lease provider discovery",
        );
      }
      if (
        canonicalJson(controlPlaneAuthority.scope) !==
          canonicalJson(evaluatedScopeReceipt.scope) ||
        canonicalJson(controlPlanePrivate.scope) !==
          canonicalJson(evaluatedScopeReceipt.scope)
      ) {
        throw ledgerError(
          "CONTROL_PLANE_AUTHORITY_SCOPE_MISMATCH",
          "initial runner authority control-plane load binds another scope",
        );
      }
      const fullScopePrivate = fullScopeReceipts.get(
        evaluated_scope_receipt,
      );
      if (
        fullScopePrivate === undefined ||
        fullScopePrivate.created_ordinal >= controlPlanePrivate.created_ordinal
      ) {
        throw ledgerError(
          "CONTROL_PLANE_AUTHORITY_ORDER_MISMATCH",
          "initial runner authority requires a control-plane load minted after full discovery",
        );
      }
      const commandAuthority = await initialWorkflowCommandAuthority({
        workflow_command_handle,
        repository: repo,
        evaluated_scope_receipt: evaluatedScopeReceipt,
      });
      const preflightAuthority = await initialPreflightAuthority(
        preflightHandle,
        repo,
      );
      const loaded = controlPlanePrivate.load;
      const scope = evaluatedScopeReceipt.scope;
      const leaseAuthority = validateInitialActiveLeaseAuthority({
        loaded,
        evaluated_scope_receipt: evaluatedScopeReceipt,
        workflow_command: commandAuthority.command,
      });
      if (loaded.records.some((entry) =>
        new Set(["effect-intent", "effect-response"])
          .has(entry.envelope.record_type) &&
        sameHeadScope(entry.envelope, scope))) {
        throw ledgerError(
          "initial-runner-history-exists",
          "initial runner authority requires an effect-free head epoch",
        );
      }
      const currentRef = await readRef({
        fetchImpl,
        authorization,
        base,
        repoPath,
        ref,
        refSuffix,
        requestBudget: createRequestBudget(),
      });
      if (currentRef.target_commit_sha !== loaded.tip_commit_sha) {
        throw ledgerError(
          "STALE_CONTROL_PLANE_AUTHORITY",
          "initial runner authority control-plane tip is no longer current",
        );
      }
      const priorAuthorityDigest = runnerPriorAuthorityDigest(
        loaded.records,
        scope,
      );
      const priorScheduling = initialRunnerScheduling({
        repository: repo,
        scope,
        command: commandAuthority.command,
        public_wait_supported: preflightAuthority.public_wait_supported,
        started_at: leaseAuthority.acquired_at,
      });
      const priorHeadLedger = deriveRunnerHeadLedger(
        loaded.records,
        scope,
        repo,
        loaded.post_ref.server_time,
      );
      const scopedAuthority = controlPlaneAuthority.scoped_authority;
      const sourceAuthority = {
        tip_commit_sha: loaded.tip_commit_sha,
        same_job_source_inventory_digest:
          scopedAuthority.source_inventory_digest,
        same_job_scoped_authority_digest: scopedAuthority.authority_digest,
        fully_reachable_record_manifest_digest:
          loaded.fully_reachable_record_manifest_digest,
        capability_attestation_commit_sha:
          loaded.capability.attestation_commit_sha,
        capability_input_digest: loaded.capability.capability_input_digest,
        controller_release_digest: digestCanonical(
          "codex-review-gate-v2-controller-release",
          loaded.capability.controller_release,
        ),
        post_ref_receipt: structuredClone(loaded.post_ref),
      };
      const evaluatedScopeAuthority = {
        relation: evaluatedScopeReceipt.relation,
        record_evaluated_scope_receipt_digest:
          evaluatedScopeReceipt.receipt_digest,
        lease_evaluated_scope_receipt_digest:
          leaseAuthority.evaluated_scope_receipt_digest,
        discovery_continuity_receipt:
          structuredClone(
            evaluatedScopeReceipt.discovery_continuity_receipt,
          ),
        provider_pre_scope_receipt_digest:
          evaluatedScopeReceipt.relation === "provider-selector"
            ? evaluatedScopeReceipt.provider_artifact_receipt
              .pre_scope_receipt_digest
            : null,
      };
      const withoutDigest = {
        schema: V2_GIT_LEDGER_INITIAL_RUNNER_STATE_AUTHORITY_SCHEMA,
        schema_version: 1,
        scope: structuredClone(scope),
        source_authority: sourceAuthority,
        lease_authority: leaseAuthority,
        evaluated_scope_authority: evaluatedScopeAuthority,
        workflow_command_authority: commandAuthority.public_authority,
        preflight_authority: preflightAuthority.public_authority,
        prior_authority_digest: priorAuthorityDigest,
        scheduling: priorScheduling,
        head_ledger: priorHeadLedger,
        stable: true,
      };
      const handle = validateV2GitLedgerInitialRunnerStateAuthority({
        ...withoutDigest,
        authority_digest: digestCanonical(
          "codex-review-gate-v2-git-ledger-initial-runner-state-authority",
          withoutDigest,
        ),
      });
      const privateAuthority = deepFreeze({
        control_plane_authority,
        evaluated_scope_receipt,
        workflow_command_handle,
        preflight_handle: preflightHandle,
        source_tip_commit_sha: loaded.tip_commit_sha,
        lease_acquire_commit_sha: leaseAuthority.acquire_commit_sha,
      });
      initialRunnerStateAuthorityHandles.set(handle, privateAuthority);
      INITIAL_RUNNER_STATE_AUTHORITY_HANDLES.set(handle, privateAuthority);
      return handle;
    },

    async loadEstablishedRunnerStateAuthority({
      control_plane_authority,
      evaluated_scope_receipt,
      workflow_command_handle,
    }) {
      const controlPlaneAuthority =
        assertV2GitLedgerControlPlaneAuthorityHandle(
          control_plane_authority,
        );
      const controlPlanePrivate = controlPlaneAuthorityHandles.get(
        control_plane_authority,
      );
      if (controlPlanePrivate === undefined) {
        throw ledgerError(
          "UNTRUSTED_CONTROL_PLANE_AUTHORITY_HANDLE",
          "established runner authority requires this factory's exact control-plane load",
        );
      }
      const evaluatedScopeReceipt = validateV2GitLedgerEvaluatedScopeReceipt(
        evaluated_scope_receipt,
        { repository: repo },
      );
      if (!evaluatedScopeReceipts.has(evaluated_scope_receipt)) {
        throw ledgerError(
          "untrusted-evaluated-scope-receipt",
          "established runner authority requires the exact factory-created evaluated scope",
        );
      }
      if (
        evaluatedScopeReceipt.phase !== "full-discovery" ||
        !fullScopeReceipts.has(evaluated_scope_receipt)
      ) {
        throw ledgerError(
          "full-discovery-receipt-required",
          "established runner authority requires post-lease full discovery",
        );
      }
      if (
        evaluatedScopeReceipt.relation === "provider-selector" &&
        (
          evaluatedScopeReceipt.provider_artifact_receipt.phase !==
            "full-discovery" ||
          !providerFullScopeReceipts.has(evaluated_scope_receipt)
        )
      ) {
        throw ledgerError(
          "provider-full-scope-required",
          "established runner authority requires post-lease provider discovery",
        );
      }
      if (
        canonicalJson(controlPlaneAuthority.scope) !==
          canonicalJson(evaluatedScopeReceipt.scope) ||
        canonicalJson(controlPlanePrivate.scope) !==
          canonicalJson(evaluatedScopeReceipt.scope)
      ) {
        throw ledgerError(
          "CONTROL_PLANE_AUTHORITY_SCOPE_MISMATCH",
          "established runner authority control-plane load binds another scope",
        );
      }
      const fullScopePrivate = fullScopeReceipts.get(
        evaluated_scope_receipt,
      );
      if (
        fullScopePrivate === undefined ||
        fullScopePrivate.created_ordinal >= controlPlanePrivate.created_ordinal
      ) {
        throw ledgerError(
          "CONTROL_PLANE_AUTHORITY_ORDER_MISMATCH",
          "established runner authority requires a control-plane load minted after full discovery",
        );
      }
      const commandAuthority = await establishedWorkflowCommandAuthority({
        workflow_command_handle,
        repository: repo,
        evaluated_scope_receipt: evaluatedScopeReceipt,
      });
      const preflightAuthority = await initialPreflightAuthority(
        preflightHandle,
        repo,
      );
      const loaded = controlPlanePrivate.load;
      const scope = evaluatedScopeReceipt.scope;
      const leaseAuthority = validateInitialActiveLeaseAuthority({
        loaded,
        evaluated_scope_receipt: evaluatedScopeReceipt,
        workflow_command: commandAuthority.command,
      });
      const runnerState = controlPlaneAuthority.scoped_authority.runner_state;
      if (
        runnerState?.scheduling === null ||
        schedulerObservationRecords(loaded.records, scope).length === 0
      ) {
        throw ledgerError(
          "established-runner-history-required",
          "established runner authority requires reachable scheduler history",
        );
      }
      const currentRef = await readRef({
        fetchImpl,
        authorization,
        base,
        repoPath,
        ref,
        refSuffix,
        requestBudget: createRequestBudget(),
      });
      if (currentRef.target_commit_sha !== loaded.tip_commit_sha) {
        throw ledgerError(
          "STALE_CONTROL_PLANE_AUTHORITY",
          "established runner authority control-plane tip is no longer current",
        );
      }
      const currentScheduling = {
        ...structuredClone(runnerState.scheduling),
        trigger: commandAuthority.command.route.trigger,
        run_identity: {
          run_id: commandAuthority.command.invocation.run_id,
          run_attempt: commandAuthority.command.invocation.run_attempt,
        },
      };
      const scheduling = deriveRunnerScheduling(
        loaded.records,
        scope,
        repo,
        currentScheduling,
      );
      const headLedger = deriveRunnerHeadLedger(
        loaded.records,
        scope,
        repo,
        loaded.post_ref.server_time,
      );
      const sourceAuthority = initialSourceAuthority({
        loaded,
        scoped_authority: controlPlaneAuthority.scoped_authority,
      });
      const evaluatedScopeAuthority = initialEvaluatedScopeAuthority({
        evaluated_scope_receipt: evaluatedScopeReceipt,
        lease_authority: leaseAuthority,
      });
      const withoutDigest = {
        schema: V2_GIT_LEDGER_ESTABLISHED_RUNNER_STATE_AUTHORITY_SCHEMA,
        schema_version: 1,
        scope: structuredClone(scope),
        source_authority: sourceAuthority,
        lease_authority: leaseAuthority,
        evaluated_scope_authority: evaluatedScopeAuthority,
        workflow_command_authority: commandAuthority.public_authority,
        preflight_authority: preflightAuthority.public_authority,
        prior_authority_digest: runnerState.source_authority_digest,
        scheduling,
        head_ledger: headLedger,
        stable: true,
      };
      const handle = validateV2GitLedgerEstablishedRunnerStateAuthority({
        ...withoutDigest,
        authority_digest: digestCanonical(
          "codex-review-gate-v2-git-ledger-established-runner-state-authority",
          withoutDigest,
        ),
      });
      const privateAuthority = deepFreeze({
        control_plane_authority,
        evaluated_scope_receipt,
        workflow_command_handle,
        preflight_handle: preflightHandle,
        source_tip_commit_sha: loaded.tip_commit_sha,
        lease_acquire_commit_sha: leaseAuthority.acquire_commit_sha,
      });
      establishedRunnerStateAuthorityHandles.set(handle, privateAuthority);
      ESTABLISHED_RUNNER_STATE_AUTHORITY_HANDLES.set(handle, privateAuthority);
      return handle;
    },

    async appendInitialSchedulerObservation({
      initial_runner_state_authority,
      scheduler_evaluation,
      status_plan,
    }) {
      const initial = assertV2GitLedgerInitialRunnerStateAuthorityHandle(
        initial_runner_state_authority,
      );
      const privateAuthority = initialRunnerStateAuthorityHandles.get(
        initial_runner_state_authority,
      );
      if (privateAuthority === undefined) {
        throw ledgerError(
          "UNTRUSTED_INITIAL_RUNNER_STATE_AUTHORITY_HANDLE",
          "initial scheduler append requires this factory's exact authority",
        );
      }
      if (consumedInitialRunnerStateAuthorities.has(
        initial_runner_state_authority,
      )) {
        throw ledgerError(
          "initial-runner-authority-replayed",
          "initial runner authority is already consumed",
        );
      }
      const evaluation = validateRunnerSchedulerSnapshot(
        scheduler_evaluation,
        {
          epoch_id: initial.scheduling.epoch.id,
          epoch_started_at: initial.scheduling.epoch.started_at,
          observed_not_after: scheduler_evaluation?.observed_at,
          require_complete: true,
        },
        "initial scheduler append evaluation",
      );
      if (
        evaluation.run_id !== initial.scheduling.run_identity.run_id ||
        evaluation.run_attempt !== initial.scheduling.run_identity.run_attempt ||
        canonicalJson(evaluation.no_start_candidate) !==
          canonicalJson(initial.scheduling.no_start_candidate)
      ) {
        throw ledgerError(
          "initial-scheduler-evaluation-mismatch",
          "initial scheduler evaluation differs from its protected run authority",
        );
      }
      const schedulerPlan = planV2Actions({
        schema: V2_SCHEDULER_SCHEMA,
        schema_version: V2_SCHEDULER_SCHEMA_VERSION,
        trigger: initial.scheduling.trigger,
        now: evaluation.observed_at,
        public_wait_supported: initial.scheduling.public_wait_supported,
        status_target_mode: initial.scheduling.status_target_mode,
        epoch: initial.scheduling.epoch,
        evaluation,
        complete_snapshots: initial.scheduling.complete_snapshots,
        status: {
          exact_sha_context_count:
            initial.scheduling.status.exact_sha_context_count,
          latest_idempotency_key:
            initial.scheduling.status.latest_idempotency_key,
        },
        applied_action_keys: initial.scheduling.applied_action_keys,
      });
      const statusPlan = validateRunnerStatusPlan(
        status_plan,
        evaluation,
        schedulerPlan,
      );
      if (statusPlan.mode !== initial.scheduling.status_target_mode) {
        throw ledgerError(
          "initial-status-plan-mode-mismatch",
          "initial status plan changes the protected target mode",
        );
      }
      const action = {
        schema: V2_GIT_LEDGER_SCHEDULER_OBSERVATION_SCHEMA,
        schema_version: 1,
        prior_authority_digest: initial.prior_authority_digest,
        prior_scheduling: structuredClone(initial.scheduling),
        prior_head_ledger: structuredClone(initial.head_ledger),
        scheduler_evaluation: structuredClone(evaluation),
        scheduler_plan: structuredClone(schedulerPlan),
        scheduler_plan_digest: digestCanonical(
          "codex-review-gate-v2-scheduler-plan",
          schedulerPlan,
        ),
        status_plan: structuredClone(statusPlan),
        status_plan_digest: digestCanonical(
          "codex-review-gate-v2-status-plan",
          statusPlan,
        ),
        snapshot_server_time: evaluation.observed_at,
        initial_runner_state_authority: structuredClone(initial),
      };
      const observationIdentity = digestCanonical(
        "codex-review-gate-v2-initial-scheduler-observation-identity",
        {
          initial_runner_state_authority_digest: initial.authority_digest,
          snapshot_id: evaluation.snapshot_id,
          scheduler_plan_digest: action.scheduler_plan_digest,
          status_plan_digest: action.status_plan_digest,
        },
      ).slice("sha256:".length);
      const record = createV2GitLedgerEffectIntentRecord({
        predecessor_commit_sha: initial.source_authority.tip_commit_sha,
        scope: initial.scope,
        kind: "scheduler-observation",
        effect_id: `scheduler-observation:${observationIdentity}`,
        idempotency_key: `scheduler-observation:${observationIdentity}`,
        server_observed_at: evaluation.observed_at,
        action,
        control_comment_binding: null,
        lease_receipt: initial.lease_authority,
      });
      const appendReceipt = await api.appendRecord(record, {
        evaluated_scope_receipt:
          privateAuthority.evaluated_scope_receipt,
        initial_runner_state_authority,
      });
      return sealSchedulerAppend({
        schema: "codex-review-gate-git-ledger-initial-scheduler-append-v2",
        record,
        append_receipt: appendReceipt,
        evaluated_scope_receipt: privateAuthority.evaluated_scope_receipt,
        lease_authority: initial.lease_authority,
        scope: initial.scope,
        runner_state_authority: initial_runner_state_authority,
      });
    },

    async appendEstablishedSchedulerObservation({
      established_runner_state_authority,
      scheduler_evaluation,
      status_plan,
    }) {
      const established =
        assertV2GitLedgerEstablishedRunnerStateAuthorityHandle(
          established_runner_state_authority,
        );
      const privateAuthority = establishedRunnerStateAuthorityHandles.get(
        established_runner_state_authority,
      );
      if (privateAuthority === undefined) {
        throw ledgerError(
          "UNTRUSTED_ESTABLISHED_RUNNER_STATE_AUTHORITY_HANDLE",
          "established scheduler append requires this factory's exact authority",
        );
      }
      if (consumedEstablishedRunnerStateAuthorities.has(
        established_runner_state_authority,
      )) {
        throw ledgerError(
          "established-runner-authority-replayed",
          "established runner authority is already consumed",
        );
      }
      const evaluation = validateRunnerSchedulerSnapshot(
        scheduler_evaluation,
        {
          epoch_id: established.scheduling.epoch.id,
          epoch_started_at: established.scheduling.epoch.started_at,
          observed_not_after: scheduler_evaluation?.observed_at,
          require_complete: true,
        },
        "established scheduler append evaluation",
      );
      if (
        evaluation.run_id !== established.scheduling.run_identity.run_id ||
        evaluation.run_attempt !==
          established.scheduling.run_identity.run_attempt ||
        canonicalJson(evaluation.no_start_candidate) !==
          canonicalJson(established.scheduling.no_start_candidate)
      ) {
        throw ledgerError(
          "established-scheduler-evaluation-mismatch",
          "established scheduler evaluation differs from its protected run authority",
        );
      }
      const schedulerPlan = planV2Actions({
        schema: V2_SCHEDULER_SCHEMA,
        schema_version: V2_SCHEDULER_SCHEMA_VERSION,
        trigger: established.scheduling.trigger,
        now: evaluation.observed_at,
        public_wait_supported: established.scheduling.public_wait_supported,
        status_target_mode: established.scheduling.status_target_mode,
        epoch: established.scheduling.epoch,
        evaluation,
        complete_snapshots: established.scheduling.complete_snapshots,
        status: {
          exact_sha_context_count:
            established.scheduling.status.exact_sha_context_count,
          latest_idempotency_key:
            established.scheduling.status.latest_idempotency_key,
        },
        applied_action_keys: established.scheduling.applied_action_keys,
      });
      const statusPlan = validateRunnerStatusPlan(
        status_plan,
        evaluation,
        schedulerPlan,
      );
      if (statusPlan.mode !== established.scheduling.status_target_mode) {
        throw ledgerError(
          "established-status-plan-mode-mismatch",
          "established status plan changes the protected target mode",
        );
      }
      const action = {
        schema: V2_GIT_LEDGER_SCHEDULER_OBSERVATION_SCHEMA,
        schema_version: 1,
        prior_authority_digest: established.prior_authority_digest,
        prior_scheduling: structuredClone(established.scheduling),
        prior_head_ledger: structuredClone(established.head_ledger),
        scheduler_evaluation: structuredClone(evaluation),
        scheduler_plan: structuredClone(schedulerPlan),
        scheduler_plan_digest: digestCanonical(
          "codex-review-gate-v2-scheduler-plan",
          schedulerPlan,
        ),
        status_plan: structuredClone(statusPlan),
        status_plan_digest: digestCanonical(
          "codex-review-gate-v2-status-plan",
          statusPlan,
        ),
        snapshot_server_time: evaluation.observed_at,
        initial_runner_state_authority: null,
      };
      const observationIdentity = digestCanonical(
        "codex-review-gate-v2-established-scheduler-observation-identity",
        {
          established_runner_state_authority_digest:
            established.authority_digest,
          snapshot_id: evaluation.snapshot_id,
          scheduler_plan_digest: action.scheduler_plan_digest,
          status_plan_digest: action.status_plan_digest,
        },
      ).slice("sha256:".length);
      const record = createV2GitLedgerEffectIntentRecord({
        predecessor_commit_sha: established.source_authority.tip_commit_sha,
        scope: established.scope,
        kind: "scheduler-observation",
        effect_id: `scheduler-observation:${observationIdentity}`,
        idempotency_key: `scheduler-observation:${observationIdentity}`,
        server_observed_at: evaluation.observed_at,
        action,
        control_comment_binding: null,
        lease_receipt: established.lease_authority,
      });
      const appendReceipt = await api.appendRecord(record, {
        evaluated_scope_receipt:
          privateAuthority.evaluated_scope_receipt,
        established_runner_state_authority,
      });
      return sealSchedulerAppend({
        schema:
          "codex-review-gate-git-ledger-established-scheduler-append-v2",
        record,
        append_receipt: appendReceipt,
        evaluated_scope_receipt: privateAuthority.evaluated_scope_receipt,
        lease_authority: established.lease_authority,
        scope: established.scope,
        runner_state_authority: established_runner_state_authority,
      });
    },

    async appendStatusWriteIntent({
      scheduler_append,
      status_write_index,
    }) {
      if (status_write_index !== 0) {
        throw ledgerError(
          "status-write-index-unsupported",
          "the first status effect slice accepts only status_write_index zero",
        );
      }
      const schedulerAuthority = schedulerAppendHandles.get(scheduler_append);
      if (schedulerAuthority === undefined) {
        throw ledgerError(
          "UNTRUSTED_SCHEDULER_APPEND_HANDLE",
          "status intent requires this factory's exact scheduler append result",
        );
      }
      if (consumedStatusSchedulerAppends.has(scheduler_append)) {
        throw ledgerError(
          "status-scheduler-append-replayed",
          "the scheduler append already consumed its status publication authority",
        );
      }
      const observationRecord = validateV2GitLedgerRecord(
        scheduler_append.record,
      );
      const observationAction = validateV2GitLedgerSchedulerObservation(
        observationRecord.payload.action,
      );
      const writes = observationAction.status_plan.writes;
      if (writes.length !== 1) {
        throw ledgerError(
          "status-write-transaction-required",
          "the first status effect slice requires exactly one planned write",
        );
      }
      const publishActions = observationAction.scheduler_plan.actions.filter(
        (action) => action.kind === "publish_status",
      );
      if (publishActions.length !== 1) {
        throw ledgerError(
          "status-scheduler-action-required",
          "status intent requires one exact protected publish action",
        );
      }
      const evaluatedScopeReceipt = schedulerAuthority.evaluated_scope_receipt;
      if (
        evaluatedScopeReceipt.relation === "manual-pull-request" ||
        evaluatedScopeReceipt.phase !== "full-discovery" ||
        !fullScopeReceipts.has(evaluatedScopeReceipt)
      ) {
        throw ledgerError(
          "status-full-scope-authority-required",
          "status intent requires a non-manual full-discovery authority",
        );
      }
      const loaded = await api.load();
      validateCurrentSchedulerAppendForStatus({
        loaded,
        scheduler_append,
        scheduler_authority: schedulerAuthority,
        evaluated_scope_receipt: evaluatedScopeReceipt,
      });
      const planned = writes[0];
      const description = canonicalStatusDescription(planned.reason);
      const descriptionDigest = statusDescriptionDigest(description);
      const statusIdentity = digestCanonical(
        "codex-review-gate-v2-git-ledger-status-write-identity",
        {
          scheduler_observation_record_oid:
            schedulerAuthority.observation_record_oid,
          scheduler_plan_digest: observationAction.scheduler_plan_digest,
          status_plan_digest: observationAction.status_plan_digest,
          status_write_index: 0,
          status_idempotency_key: planned.idempotency_key,
        },
      ).slice("sha256:".length);
      const record = createV2GitLedgerEffectIntentRecord({
        predecessor_commit_sha: loaded.tip_commit_sha,
        scope: schedulerAuthority.scope,
        kind: "status-write",
        effect_id: `status-write:${statusIdentity}`,
        idempotency_key: planned.idempotency_key,
        server_observed_at: loaded.post_ref.server_time,
        action: {
          mode: observationAction.status_plan.mode,
          target_sha: planned.sha,
          role: planned.role,
          context: planned.context,
          state: planned.state,
          description_digest: descriptionDigest,
          scheduler_observation_record_oid:
            schedulerAuthority.observation_record_oid,
          scheduler_action_key: publishActions[0].idempotency_key,
          scheduler_plan_digest: observationAction.scheduler_plan_digest,
          status_plan_digest: observationAction.status_plan_digest,
          status_write_index: 0,
          status_write_count: 1,
        },
        control_comment_binding: loaded.control_comment_binding,
        lease_receipt: schedulerAuthority.lease_authority,
      });
      const appendReceipt = await api.appendRecord(record, {
        evaluated_scope_receipt: evaluatedScopeReceipt,
      });
      const transport = deepFreeze({
        method: "POST",
        target_sha: planned.sha,
        role: planned.role,
        context: planned.context,
        state: planned.state,
        description,
        description_digest: descriptionDigest,
      });
      const handle = sealStatusWriteIntentHandle({
        intent_commit_sha: appendReceipt.commit_sha,
        append_receipt_digest: appendReceipt.receipt_digest,
        transport,
      });
      const privateIntent = deepFreeze({
        scheduler_append,
        evaluated_scope_receipt: evaluatedScopeReceipt,
        lease_authority: schedulerAuthority.lease_authority,
        scope: schedulerAuthority.scope,
        intent_record: record,
        intent_append_receipt: appendReceipt,
        transport,
      });
      statusWriteIntentHandles.set(handle, privateIntent);
      STATUS_WRITE_INTENT_HANDLES.set(handle, privateIntent);
      consumedStatusSchedulerAppends.add(scheduler_append);
      return deepFreeze({
        schema: "codex-review-gate-git-ledger-status-write-intent-append-v2",
        schema_version: 1,
        status_intent_handle: handle,
        intent_append_receipt: appendReceipt,
        transport,
      });
    },

    async appendStatusWriteResponse({
      status_intent_handle,
      intent_append_receipt,
      receipt,
    }) {
      assertV2GitLedgerStatusWriteIntentHandle(status_intent_handle);
      const privateIntent = statusWriteIntentHandles.get(
        status_intent_handle,
      );
      if (privateIntent === undefined) {
        throw ledgerError(
          "UNTRUSTED_STATUS_WRITE_INTENT_HANDLE",
          "status response requires this factory's exact intent handle",
        );
      }
      if (intent_append_receipt !== privateIntent.intent_append_receipt) {
        throw ledgerError(
          "STATUS_WRITE_INTENT_RECEIPT_MISMATCH",
          "status response requires the exact same-process intent append receipt",
        );
      }
      if (consumedStatusWriteIntentHandles.has(status_intent_handle)) {
        throw ledgerError(
          "status-write-response-replayed",
          "status response authority is already consumed",
        );
      }
      const responseReceipt = validateV2GitLedgerStatusWriteResponseReceipt(
        receipt,
        {
          action: privateIntent.intent_record.payload.action,
          not_before:
            privateIntent.intent_append_receipt.ref_reread.server_time,
        },
      );
      const loaded = await api.load();
      validateCurrentStatusIntentForResponse({
        loaded,
        private_intent: privateIntent,
      });
      const record = createV2GitLedgerEffectResponseRecord({
        intent_record: privateIntent.intent_record,
        intent_commit_sha:
          privateIntent.intent_append_receipt.commit_sha,
        server_observed_at: responseReceipt.refetch_server_time,
        receipt: responseReceipt,
      });
      const appendReceipt = await api.appendRecord(record, {
        evaluated_scope_receipt: privateIntent.evaluated_scope_receipt,
      });
      consumedStatusWriteIntentHandles.add(status_intent_handle);
      const final = await api.load();
      const runnerState = deriveV2GitLedgerRunnerState(
        final.records,
        privateIntent.scope,
        final.post_ref.server_time,
      );
      const authoritativeStatus = runnerState.status_inventory.find((item) =>
        item.intent_record_oid ===
          privateIntent.intent_append_receipt.commit_sha);
      if (
        final.tip_commit_sha !== appendReceipt.commit_sha ||
        authoritativeStatus?.response_record_oid !== appendReceipt.commit_sha ||
        authoritativeStatus.status_id !== responseReceipt.status_id ||
        authoritativeStatus.receipt_observed_at !== responseReceipt.created_at
      ) {
        throw ledgerError(
          "status-write-response-reread-mismatch",
          "status response is absent from the exact stable authority reread",
        );
      }
      return deepFreeze({
        schema: "codex-review-gate-git-ledger-status-write-response-append-v2",
        schema_version: 1,
        status_intent_digest: status_intent_handle.intent_digest,
        response_append_receipt: appendReceipt,
        authoritative_status: structuredClone(authoritativeStatus),
        runner_state_digest: runnerState.runner_state_digest,
      });
    },

    async appendAutomaticRequestReservation({ scheduler_append }) {
      const schedulerAuthority = schedulerAppendHandles.get(scheduler_append);
      if (schedulerAuthority === undefined) {
        throw ledgerError(
          "UNTRUSTED_SCHEDULER_APPEND_HANDLE",
          "automatic reservation requires this factory's exact scheduler append result",
        );
      }
      if (consumedReservationSchedulerAppends.has(scheduler_append)) {
        throw ledgerError(
          "automatic-reservation-scheduler-replayed",
          "the scheduler append already consumed its automatic reservation authority",
        );
      }
      const observation = validateV2GitLedgerSchedulerObservation(
        scheduler_append.record.payload.action,
      );
      const persistActions = observation.scheduler_plan.actions.filter(
        (action) => action.kind === "persist_auto_request_intent",
      );
      const postActions = observation.scheduler_plan.actions.filter(
        (action) => action.kind === "post_review_request",
      );
      if (
        persistActions.length !== 1 || postActions.length !== 1 ||
        postActions[0].depends_on_idempotency_key !==
          persistActions[0].idempotency_key ||
        postActions[0].intent_id !== persistActions[0].intent_id
      ) {
        throw ledgerError(
          "automatic-reservation-scheduler-actions-required",
          "automatic reservation requires one exact persist/post scheduler pair",
        );
      }
      const evaluatedScopeReceipt = schedulerAuthority.evaluated_scope_receipt;
      const fullScopeAuthority = fullScopeReceipts.get(evaluatedScopeReceipt);
      if (
        fullScopeAuthority === undefined ||
        evaluatedScopeReceipt.relation === "manual-pull-request"
      ) {
        throw ledgerError(
          "automatic-reservation-full-scope-required",
          "automatic reservation requires a non-manual full-discovery authority",
        );
      }
      const loaded = await api.load();
      validateCurrentSchedulerAppendAuthority({
        loaded,
        scheduler_append,
        scheduler_authority: schedulerAuthority,
        evaluated_scope_receipt: evaluatedScopeReceipt,
      });
      validateRequiredStatusBindingsForObservation(
        loaded.records,
        schedulerAuthority.observation_record_oid,
      );
      if (automaticReservationRecords(
        loaded.records,
        schedulerAuthority.scope,
      ).some((entry) =>
        entry.envelope.payload.action.scheduler_observation_record_oid ===
          schedulerAuthority.observation_record_oid)) {
        throw ledgerError(
          "automatic-reservation-scheduler-replayed",
          "the scheduler observation already consumed its automatic reservation authority",
        );
      }
      const reservationSnapshot = structuredClone(
        fullScopeAuthority.projection.discovery_snapshot,
      );
      reservationSnapshot.server_time = loaded.post_ref.server_time;
      const runnerState = deriveV2GitLedgerRunnerState(
        loaded.records,
        schedulerAuthority.scope,
        loaded.post_ref.server_time,
      );
      const reservation = prepareV2Request({
        snapshot: reservationSnapshot,
        head_ledger: runnerState.head_ledger,
        scheduler_post_action: postActions[0],
      });
      const generation = automaticEffectGeneration(
        reservation.ordinal,
        schedulerAuthority.scope,
      );
      const record = createV2GitLedgerEffectIntentRecord({
        predecessor_commit_sha: loaded.tip_commit_sha,
        scope: schedulerAuthority.scope,
        kind: "automatic-request-reservation",
        effect_id: `automatic-reservation:${reservation.intent_digest
          .slice("sha256:".length)}`,
        idempotency_key: persistActions[0].idempotency_key,
        server_observed_at: loaded.post_ref.server_time,
        generation,
        ordinal: generation.index,
        action: {
          scheduler_observation_record_oid:
            schedulerAuthority.observation_record_oid,
          scheduler_action_key: persistActions[0].idempotency_key,
          post_scheduler_action_key: postActions[0].idempotency_key,
          reservation,
          reservation_digest: reservation.reservation_digest,
          budget_limit: 3,
        },
        control_comment_binding: loaded.control_comment_binding,
        lease_receipt: schedulerAuthority.lease_authority,
      });
      const appendReceipt = await api.appendRecord(record, {
        evaluated_scope_receipt: evaluatedScopeReceipt,
      });
      const handle = sealAutomaticReservationHandle({
        reservation_record_oid: appendReceipt.commit_sha,
        append_receipt_digest: appendReceipt.receipt_digest,
        reservation_digest: reservation.reservation_digest,
      });
      const privateReservation = deepFreeze({
        scheduler_append,
        evaluated_scope_receipt: evaluatedScopeReceipt,
        lease_authority: schedulerAuthority.lease_authority,
        scope: schedulerAuthority.scope,
        reservation_record: record,
        reservation_append_receipt: appendReceipt,
        reservation,
        generation,
      });
      automaticReservationHandles.set(handle, privateReservation);
      AUTOMATIC_RESERVATION_HANDLES.set(handle, privateReservation);
      consumedReservationSchedulerAppends.add(scheduler_append);
      return deepFreeze({
        schema:
          "codex-review-gate-git-ledger-automatic-reservation-append-v2",
        schema_version: 1,
        automatic_reservation_handle: handle,
        reservation_append_receipt: appendReceipt,
        reservation,
      });
    },

    async appendReservationStatusWriteIntent({
      automatic_reservation_handle,
      reservation_append_receipt,
    }) {
      assertV2GitLedgerAutomaticReservationHandle(
        automatic_reservation_handle,
      );
      const privateReservation = automaticReservationHandles.get(
        automatic_reservation_handle,
      );
      if (privateReservation === undefined) {
        throw ledgerError(
          "UNTRUSTED_AUTOMATIC_RESERVATION_HANDLE",
          "reservation status requires this factory's exact reservation handle",
        );
      }
      if (
        reservation_append_receipt !==
          privateReservation.reservation_append_receipt
      ) {
        throw ledgerError(
          "AUTOMATIC_RESERVATION_RECEIPT_MISMATCH",
          "reservation status requires the exact reservation append receipt",
        );
      }
      const loaded = await api.load();
      validateCurrentAutomaticReservation({
        loaded,
        private_reservation: privateReservation,
        require_status_absent: true,
      });
      const reservation = privateReservation.reservation;
      const context =
        `codex/github-review-gate-reservation/${reservation.ordinal}`;
      const transport = deepFreeze({
        method: "POST",
        target_sha: reservation.epoch_head_sha,
        context,
        state: "pending",
        description: reservation.reservation_digest,
        description_digest: reservation.reservation_digest,
      });
      const identity = reservation.reservation_digest.slice("sha256:".length);
      const record = createV2GitLedgerEffectIntentRecord({
        predecessor_commit_sha: loaded.tip_commit_sha,
        scope: privateReservation.scope,
        kind: "reservation-status-write",
        effect_id: `reservation-status:${identity}`,
        idempotency_key: `reservation-status:${identity}`,
        server_observed_at: loaded.post_ref.server_time,
        generation: privateReservation.generation,
        ordinal: reservation.ordinal,
        action: {
          reservation_record_oid:
            privateReservation.reservation_append_receipt.commit_sha,
          generation_id: reservation.generation_id,
          ordinal: reservation.ordinal,
          target_sha: reservation.epoch_head_sha,
          context,
          state: "pending",
          description_digest: reservation.reservation_digest,
        },
        control_comment_binding: loaded.control_comment_binding,
        lease_receipt: privateReservation.lease_authority,
      });
      const appendReceipt = await api.appendRecord(record, {
        evaluated_scope_receipt: privateReservation.evaluated_scope_receipt,
      });
      const handle = sealReservationStatusIntentHandle({
        intent_commit_sha: appendReceipt.commit_sha,
        append_receipt_digest: appendReceipt.receipt_digest,
        reservation_digest: reservation.reservation_digest,
        transport,
      });
      const privateIntent = deepFreeze({
        automatic_reservation_handle,
        evaluated_scope_receipt: privateReservation.evaluated_scope_receipt,
        lease_authority: privateReservation.lease_authority,
        scope: privateReservation.scope,
        intent_record: record,
        intent_append_receipt: appendReceipt,
        transport,
      });
      reservationStatusIntentHandles.set(handle, privateIntent);
      RESERVATION_STATUS_INTENT_HANDLES.set(handle, privateIntent);
      return deepFreeze({
        schema:
          "codex-review-gate-git-ledger-reservation-status-intent-append-v2",
        schema_version: 1,
        reservation_status_intent_handle: handle,
        intent_append_receipt: appendReceipt,
        transport,
      });
    },

    async appendReservationStatusWriteResponse({
      reservation_status_intent_handle,
      intent_append_receipt,
      receipt,
    }) {
      assertV2GitLedgerReservationStatusIntentHandle(
        reservation_status_intent_handle,
      );
      const privateIntent = reservationStatusIntentHandles.get(
        reservation_status_intent_handle,
      );
      if (privateIntent === undefined) {
        throw ledgerError(
          "UNTRUSTED_RESERVATION_STATUS_INTENT_HANDLE",
          "reservation status response requires this factory's exact intent handle",
        );
      }
      if (intent_append_receipt !== privateIntent.intent_append_receipt) {
        throw ledgerError(
          "RESERVATION_STATUS_INTENT_RECEIPT_MISMATCH",
          "reservation status response requires the exact intent append receipt",
        );
      }
      if (consumedReservationStatusIntents.has(
        reservation_status_intent_handle,
      )) {
        throw ledgerError(
          "reservation-status-response-replayed",
          "reservation status response authority is already consumed",
        );
      }
      const responseReceipt = validateV2GitLedgerReservationStatusResponseReceipt(
        receipt,
        {
          action: privateIntent.intent_record.payload.action,
          not_before:
            privateIntent.intent_append_receipt.ref_reread.server_time,
        },
      );
      const loaded = await api.load();
      validateCurrentReservationStatusIntent({
        loaded,
        private_intent: privateIntent,
      });
      const record = createV2GitLedgerEffectResponseRecord({
        intent_record: privateIntent.intent_record,
        intent_commit_sha: privateIntent.intent_append_receipt.commit_sha,
        server_observed_at: responseReceipt.refetch_server_time,
        receipt: responseReceipt,
      });
      const appendReceipt = await api.appendRecord(record, {
        evaluated_scope_receipt: privateIntent.evaluated_scope_receipt,
      });
      consumedReservationStatusIntents.add(
        reservation_status_intent_handle,
      );
      const final = await api.load();
      const runnerState = deriveV2GitLedgerRunnerState(
        final.records,
        privateIntent.scope,
        final.post_ref.server_time,
      );
      const reservation = runnerState.reservations.find((item) =>
        item.reservation_status_intent_record_oid ===
          privateIntent.intent_append_receipt.commit_sha);
      if (
        final.tip_commit_sha !== appendReceipt.commit_sha ||
        reservation?.reservation_status_response_record_oid !==
          appendReceipt.commit_sha ||
        reservation.reservation_status_bound !== true
      ) {
        throw ledgerError(
          "reservation-status-response-reread-mismatch",
          "reservation status response is absent from exact stable authority",
        );
      }
      const result = deepFreeze({
        schema:
          "codex-review-gate-git-ledger-reservation-status-response-append-v2",
        schema_version: 1,
        reservation_status_intent_digest:
          reservation_status_intent_handle.intent_digest,
        response_append_receipt: appendReceipt,
        authoritative_reservation: structuredClone(reservation),
        runner_state_digest: runnerState.runner_state_digest,
      });
      reservationStatusResponseAppends.set(result, deepFreeze({
        automatic_reservation_handle:
          privateIntent.automatic_reservation_handle,
        private_intent: privateIntent,
        response_record: record,
        response_append_receipt: appendReceipt,
      }));
      return result;
    },

    async appendAutomaticReviewRequestIntent({
      automatic_reservation_handle,
      reservation_append_receipt,
      reservation_status_response_append,
    }) {
      assertV2GitLedgerAutomaticReservationHandle(
        automatic_reservation_handle,
      );
      const privateReservation = automaticReservationHandles.get(
        automatic_reservation_handle,
      );
      if (privateReservation === undefined) {
        throw ledgerError(
          "UNTRUSTED_AUTOMATIC_RESERVATION_HANDLE",
          "automatic request intent requires this factory's exact reservation handle",
        );
      }
      if (
        reservation_append_receipt !==
          privateReservation.reservation_append_receipt
      ) {
        throw ledgerError(
          "AUTOMATIC_RESERVATION_RECEIPT_MISMATCH",
          "automatic request intent requires the exact reservation append receipt",
        );
      }
      const privateResponse = reservationStatusResponseAppends.get(
        reservation_status_response_append,
      );
      if (
        privateResponse === undefined ||
        privateResponse.automatic_reservation_handle !==
          automatic_reservation_handle
      ) {
        throw ledgerError(
          "UNTRUSTED_RESERVATION_STATUS_RESPONSE_APPEND",
          "automatic request intent requires this factory's exact reservation status response append",
        );
      }
      if (consumedReservationStatusResponseAppends.has(
        reservation_status_response_append,
      )) {
        throw ledgerError(
          "automatic-review-request-attempt-replayed",
          "the reservation status response already consumed its retry-zero request attempt",
        );
      }

      const loaded = await api.load();
      const schedulerAuthority = schedulerAppendHandles.get(
        privateReservation.scheduler_append,
      );
      if (schedulerAuthority === undefined) {
        throw ledgerError(
          "UNTRUSTED_SCHEDULER_APPEND_HANDLE",
          "automatic request attempt lost its scheduler append authority",
        );
      }
      validateCurrentSchedulerAppendAuthority({
        loaded,
        scheduler_append: privateReservation.scheduler_append,
        scheduler_authority: schedulerAuthority,
        evaluated_scope_receipt:
          privateReservation.evaluated_scope_receipt,
      });
      validateCurrentAutomaticReservationForAttempt({
        loaded,
        private_reservation: privateReservation,
        private_response: privateResponse,
      });
      const reservation = privateReservation.reservation;
      const reservationAction =
        privateReservation.reservation_record.payload.action;
      const schedulerActionKey = reservationAction.post_scheduler_action_key;
      const attempt = buildV2AttemptReceipt({
        reservation,
        recorded_at: loaded.post_ref.server_time,
      });
      const attemptIdentity =
        attempt.attempt_digest.slice("sha256:".length);
      const attemptRecord = createV2GitLedgerEffectIntentRecord({
        predecessor_commit_sha: loaded.tip_commit_sha,
        scope: privateReservation.scope,
        kind: "effect-attempt",
        effect_id: `effect-attempt:${attemptIdentity}`,
        idempotency_key: `effect-attempt:${attemptIdentity}`,
        server_observed_at: loaded.post_ref.server_time,
        generation: privateReservation.generation,
        ordinal: reservation.ordinal,
        action: {
          scheduler_observation_record_oid:
            reservationAction.scheduler_observation_record_oid,
          reservation_record_oid:
            privateReservation.reservation_append_receipt.commit_sha,
          scheduler_action_key: schedulerActionKey,
          attempt,
        },
        control_comment_binding: loaded.control_comment_binding,
        lease_receipt: privateReservation.lease_authority,
      });
      const attemptAppendReceipt = await api.appendRecord(attemptRecord, {
        evaluated_scope_receipt: privateReservation.evaluated_scope_receipt,
      });
      consumedReservationStatusResponseAppends.add(
        reservation_status_response_append,
      );

      const afterAttempt = await api.load();
      const authoritativeAttempt =
        validateCurrentAutomaticReviewRequestAttempt({
        loaded: afterAttempt,
        private_reservation: privateReservation,
        private_response: privateResponse,
        attempt_record: attemptRecord,
        attempt_append_receipt: attemptAppendReceipt,
        });
      const transport = deepFreeze({
        method: "POST",
        path: `/repos/${encodeURIComponent(repo.owner)}/` +
          `${encodeURIComponent(repo.name)}/issues/` +
          `${reservation.pull_request.number}/comments`,
        body: reservation.body,
        json: { body: reservation.body },
        expected_status: 201,
        retry_limit: 0,
        record_attempt_before_effect: true,
        network_uncertainty_policy: "do-not-retry-or-reclaim",
        generation_id: reservation.generation_id,
        reservation_digest: reservation.reservation_digest,
        attempt_digest: authoritativeAttempt.attempt_digest,
      });
      validateAutomaticReviewRequestTransport(transport, {
        repository: repo,
        reservation,
        attempt: authoritativeAttempt,
      });
      const reservationIdentity =
        reservation.reservation_digest.slice("sha256:".length);
      const intentRecord = createV2GitLedgerEffectIntentRecord({
        predecessor_commit_sha: attemptAppendReceipt.commit_sha,
        scope: privateReservation.scope,
        kind: "review-request",
        effect_id: `review-request:${reservationIdentity}`,
        idempotency_key: schedulerActionKey,
        server_observed_at: afterAttempt.post_ref.server_time,
        generation: privateReservation.generation,
        ordinal: reservation.ordinal,
        action: {
          method: "POST",
          request_body_sha256: rawDigest(reservation.body),
          scheduler_observation_record_oid:
            reservationAction.scheduler_observation_record_oid,
          reservation_record_oid:
            privateReservation.reservation_append_receipt.commit_sha,
          attempt_record_oid: attemptAppendReceipt.commit_sha,
          scheduler_action_key: schedulerActionKey,
        },
        control_comment_binding: afterAttempt.control_comment_binding,
        lease_receipt: privateReservation.lease_authority,
      });
      const intentAppendReceipt = await api.appendRecord(intentRecord, {
        evaluated_scope_receipt: privateReservation.evaluated_scope_receipt,
      });
      const final = await api.load();
      const intentEntry = final.records.find((entry) =>
        entry.commit_sha === intentAppendReceipt.commit_sha);
      if (
        final.tip_commit_sha !== intentAppendReceipt.commit_sha ||
        intentEntry?.envelope.record_type !== "effect-intent" ||
        intentEntry.envelope.kind !== "review-request" ||
        canonicalJson(intentEntry.envelope.payload.action) !==
          canonicalJson(intentRecord.payload.action)
      ) {
        throw ledgerError(
          "automatic-review-request-intent-reread-mismatch",
          "review request intent is absent from the exact stable authority reread",
        );
      }
      const handle = sealAutomaticRequestIntentHandle({
        attempt_record_oid: attemptAppendReceipt.commit_sha,
        attempt_append_receipt_digest: attemptAppendReceipt.receipt_digest,
        intent_record_oid: intentAppendReceipt.commit_sha,
        intent_append_receipt_digest: intentAppendReceipt.receipt_digest,
        reservation_digest: reservation.reservation_digest,
        attempt_digest: authoritativeAttempt.attempt_digest,
        transport,
      });
      const privateRequestIntent = deepFreeze({
        automatic_reservation_handle,
        reservation_status_response_append,
        evaluated_scope_receipt: privateReservation.evaluated_scope_receipt,
        lease_authority: privateReservation.lease_authority,
        scope: privateReservation.scope,
        reservation,
        attempt: authoritativeAttempt,
        attempt_record: attemptRecord,
        attempt_append_receipt: attemptAppendReceipt,
        intent_record: intentRecord,
        intent_append_receipt: intentAppendReceipt,
        transport,
      });
      automaticRequestIntentHandles.set(handle, privateRequestIntent);
      AUTOMATIC_REQUEST_INTENT_HANDLES.set(handle, privateRequestIntent);
      return deepFreeze({
        schema:
          "codex-review-gate-git-ledger-automatic-review-request-intent-append-v2",
        schema_version: 1,
        automatic_request_intent_handle: handle,
        attempt_append_receipt: attemptAppendReceipt,
        intent_append_receipt: intentAppendReceipt,
        transport,
      });
    },

    async appendAutomaticReviewRequestBinding({
      automatic_request_intent_handle,
      intent_append_receipt,
      receipt,
    }) {
      assertV2GitLedgerAutomaticRequestIntentHandle(
        automatic_request_intent_handle,
      );
      const privateIntent = automaticRequestIntentHandles.get(
        automatic_request_intent_handle,
      );
      if (privateIntent === undefined) {
        throw ledgerError(
          "UNTRUSTED_AUTOMATIC_REQUEST_INTENT_HANDLE",
          "automatic request binding requires this factory's exact intent handle",
        );
      }
      if (intent_append_receipt !== privateIntent.intent_append_receipt) {
        throw ledgerError(
          "AUTOMATIC_REQUEST_INTENT_RECEIPT_MISMATCH",
          "automatic request binding requires the exact review intent append receipt",
        );
      }
      const principal = await automaticReviewRequestControllerAuthority({
        preflight_handle: preflightHandle,
        repository: repo,
        lease_owner: privateIntent.lease_authority.owner,
      });
      const receiptBoundary = receipt?.request_scope_receipt?.post_scope
        ?.observed_at;
      const bindingReceipt =
        validateV2GitLedgerAutomaticReviewRequestBindingReceipt(receipt, {
          repository: repo,
          scope: privateIntent.scope,
          action: privateIntent.intent_record.payload.action,
          controller_actor_id: principal.actor_id,
          controller_app: principal.app,
          not_before:
            privateIntent.intent_append_receipt.ref_reread.server_time,
          record_boundary: receiptBoundary,
          rest_base_url: base,
        });
      const requestScopeDigest = automaticReviewRequestScopeDigest(
        bindingReceipt.request_scope_receipt.pre_scope,
      );
      if (requestScopeDigest !== privateIntent.reservation.pre_scope_digest) {
        throw ledgerError(
          "automatic-review-request-pre-scope-mismatch",
          "automatic review request scope differs from its protected reservation",
        );
      }

      const priorProgress = automaticRequestBindingProgress.get(
        automatic_request_intent_handle,
      ) ?? null;
      if (
        priorProgress !== null &&
        priorProgress.receipt_digest !== bindingReceipt.receipt_digest
      ) {
        throw ledgerError(
          "automatic-review-request-binding-receipt-conflict",
          "automatic request binding cannot replace its exact POST/refetch receipt",
        );
      }
      if (priorProgress?.result !== null && priorProgress?.result !== undefined) {
        return priorProgress.result;
      }

      let progress = priorProgress ?? {
        receipt_digest: bindingReceipt.receipt_digest,
        review_response_record: null,
        review_response_append_receipt: null,
        request_binding_intent_record: null,
        request_binding_intent_append_receipt: null,
        request_binding_response_record: null,
        request_binding_response_append_receipt: null,
        result: null,
      };
      let loaded = await api.load();
      validateCurrentAutomaticReviewRequestBinding({
        loaded,
        private_intent: privateIntent,
        progress,
      });

      if (progress.review_response_append_receipt === null) {
        const responseRecord = createV2GitLedgerEffectResponseRecord({
          intent_record: privateIntent.intent_record,
          intent_commit_sha: privateIntent.intent_append_receipt.commit_sha,
          server_observed_at:
            bindingReceipt.request_scope_receipt.post_scope.observed_at,
          receipt: bindingReceipt,
        });
        const appendReceipt = await api.appendRecord(responseRecord, {
          evaluated_scope_receipt: privateIntent.evaluated_scope_receipt,
        });
        progress = {
          ...progress,
          review_response_record: responseRecord,
          review_response_append_receipt: appendReceipt,
        };
        automaticRequestBindingProgress.set(
          automatic_request_intent_handle,
          progress,
        );
      }

      if (progress.request_binding_intent_append_receipt === null) {
        const requestIdentity = bindingReceipt.request_digest.slice(
          "sha256:".length,
        );
        const requestBindingIntent = createV2GitLedgerEffectIntentRecord({
          predecessor_commit_sha:
            progress.review_response_append_receipt.commit_sha,
          scope: privateIntent.scope,
          kind: "request-binding",
          effect_id: `request-binding:${requestIdentity}`,
          idempotency_key: `request-binding:${requestIdentity}`,
          server_observed_at:
            progress.review_response_append_receipt.ref_reread.server_time,
          generation: privateIntent.intent_record.payload.generation,
          ordinal: privateIntent.intent_record.payload.ordinal,
          action: {
            generation_id:
              privateIntent.intent_record.payload.generation.generation_id,
            request_id: bindingReceipt.request_id,
            reservation_record_oid:
              privateIntent.automatic_reservation_handle
                .reservation_record_oid,
            attempt_record_oid:
              privateIntent.attempt_append_receipt.commit_sha,
          },
          control_comment_binding:
            privateIntent.intent_record.control_comment_binding,
          lease_receipt: privateIntent.lease_authority,
        });
        const appendReceipt = await api.appendRecord(requestBindingIntent, {
          evaluated_scope_receipt: privateIntent.evaluated_scope_receipt,
        });
        progress = {
          ...progress,
          request_binding_intent_record: requestBindingIntent,
          request_binding_intent_append_receipt: appendReceipt,
        };
        automaticRequestBindingProgress.set(
          automatic_request_intent_handle,
          progress,
        );
      }

      if (progress.request_binding_response_append_receipt === null) {
        const requestBindingReceipt = {
          request_id: bindingReceipt.request_id,
          request_node_id: bindingReceipt.request_node_id,
          request_url: bindingReceipt.request_url,
          body_sha256: bindingReceipt.body_sha256,
          created_at: bindingReceipt.created_at,
          updated_at: bindingReceipt.updated_at,
          raw_body_sha256: bindingReceipt.refetch_raw_body_sha256,
          actor: structuredClone(bindingReceipt.actor),
          controlled: true,
        };
        const responseRecord = createV2GitLedgerEffectResponseRecord({
          intent_record: progress.request_binding_intent_record,
          intent_commit_sha:
            progress.request_binding_intent_append_receipt.commit_sha,
          server_observed_at:
            progress.request_binding_intent_append_receipt.ref_reread
              .server_time,
          receipt: requestBindingReceipt,
        });
        const appendReceipt = await api.appendRecord(responseRecord, {
          evaluated_scope_receipt: privateIntent.evaluated_scope_receipt,
        });
        progress = {
          ...progress,
          request_binding_response_record: responseRecord,
          request_binding_response_append_receipt: appendReceipt,
        };
        automaticRequestBindingProgress.set(
          automatic_request_intent_handle,
          progress,
        );
      }

      const final = await api.load();
      const runnerState = deriveV2GitLedgerRunnerState(
        final.records,
        privateIntent.scope,
        final.post_ref.server_time,
      );
      const controlledRequest = runnerState.scheduling?.epoch
        ?.controlled_request ?? null;
      const authoritativeAttempt = runnerState.effect_attempts.find((item) =>
        item.record_oid === privateIntent.attempt_append_receipt.commit_sha);
      if (
        final.tip_commit_sha !==
          progress.request_binding_response_append_receipt.commit_sha ||
        controlledRequest?.request_id !== bindingReceipt.request_id ||
        controlledRequest.binding_record_oid !==
          progress.request_binding_response_append_receipt.commit_sha ||
        controlledRequest.bound_at !== bindingReceipt.created_at ||
        authoritativeAttempt?.bound !== true ||
        authoritativeAttempt.binding_record_oid !==
          progress.request_binding_response_append_receipt.commit_sha
      ) {
        throw ledgerError(
          "automatic-review-request-binding-reread-mismatch",
          "automatic review request binding is absent from exact stable authority",
        );
      }
      const result = deepFreeze({
        schema:
          "codex-review-gate-git-ledger-automatic-review-request-binding-append-v2",
        schema_version: 1,
        automatic_request_intent_digest:
          automatic_request_intent_handle.intent_digest,
        review_response_append_receipt:
          progress.review_response_append_receipt,
        request_binding_intent_append_receipt:
          progress.request_binding_intent_append_receipt,
        request_binding_response_append_receipt:
          progress.request_binding_response_append_receipt,
        authoritative_controlled_request:
          structuredClone(controlledRequest),
        authoritative_attempt: structuredClone(authoritativeAttempt),
        runner_state_digest: runnerState.runner_state_digest,
      });
      automaticRequestBindingProgress.set(
        automatic_request_intent_handle,
        { ...progress, result },
      );
      return result;
    },

    async loadOrReserveCandidateDispatch({
      workflow_command_handle,
      trigger_identity,
      repository_endpoint_receipt,
    }) {
      const command = await scheduledWorkflowCommandAuthority({
        workflow_command_handle,
        repository: repo,
        trigger_identity,
        pull_request_number: null,
      });
      const repositoryEndpointReceipt = normalizeRepositoryEndpointReceipt(
        repository_endpoint_receipt,
        repo,
      );
      let loaded = await api.load();
      let candidateAuthority = loaded.authority_projection.candidate_inventory;
      let dispatchAuthority = loaded.authority_projection.candidate_dispatch;
      let current = dispatchAuthority.current_cycle;
      const completed = candidateAuthority.completed_cycle;
      if (completed === null || candidateAuthority.incomplete_cycle !== null) {
        throw ledgerError(
          "candidate-dispatch-inventory-incomplete",
          "candidate dispatch requires one completed inventory cycle",
        );
      }
      const generationId = candidateDispatchGenerationId(repo, completed);
      if (current !== null && current.generation_id !== generationId &&
          current.cycle_complete === false) {
        throw ledgerError(
          "candidate-dispatch-cycle-active",
          "another candidate dispatch generation is unfinished",
        );
      }
      const activeAllAcknowledged = current?.active_reservation !== null &&
        current?.active_reservation.acknowledgements.length ===
          current?.active_reservation.reservation.candidates.length;
      const cycleCompletionPending =
        current?.active_reservation === null &&
        current?.cycle_complete === false &&
        current?.completed_batches.length === current?.batch_count;
      if (current?.generation_id === generationId &&
          (activeAllAcknowledged || cycleCompletionPending)) {
        const completion = await completeCandidateDispatchAfterAcks({
          api,
          loaded,
          repository: repo,
          commandAuthority: command.authority,
          triggerIdentity: trigger_identity,
          repositoryEndpointReceipt,
        });
        loaded = completion.loaded;
        candidateAuthority = loaded.authority_projection.candidate_inventory;
        dispatchAuthority = loaded.authority_projection.candidate_dispatch;
        current = dispatchAuthority.current_cycle;
      }
      if (
        current?.generation_id === generationId &&
        current.active_reservation !== null
      ) {
        const active = current.active_reservation;
        if (
          canonicalJson(candidateDispatchStableCommandAuthority(
            command.authority,
          )) !== canonicalJson(candidateDispatchStableCommandAuthority(
            active.scan_command_authority,
          )) ||
          canonicalJson(normalizeCandidateDispatchTriggerIdentity(
            trigger_identity,
          )) !== canonicalJson(active.reservation.trigger_identity)
        ) {
          throw ledgerError(
            "candidate-dispatch-restart-authority-mismatch",
            "candidate dispatch restart differs from its durable schedule authority",
          );
        }
        const recoveryRequired = candidateDispatchRecoveryRequirement({
          loaded,
          active,
        });
        if (recoveryRequired !== null) {
          return deepFreeze({
            schema: "codex-review-gate-git-ledger-candidate-dispatch-load-v2",
            schema_version: 1,
            state: "recovery-required",
            restarted: true,
            candidate_dispatch_handle: null,
            reservation_receipt: null,
            plan: null,
            recovery_required: recoveryRequired,
          });
        }
        return deepFreeze({
          schema: "codex-review-gate-git-ledger-candidate-dispatch-load-v2",
          schema_version: 1,
          state: "dispatch",
          restarted: true,
          recovery_required: null,
          ...mintCandidateDispatchHandle({
            loaded,
            purpose: "scan",
            workflowCommandHandle: workflow_command_handle,
            commandAuthority: command.authority,
          }),
        });
      }
      if (current?.generation_id === generationId && current.cycle_complete) {
        return deepFreeze({
          schema: "codex-review-gate-git-ledger-candidate-dispatch-load-v2",
          schema_version: 1,
          state: "complete",
          restarted: false,
          candidate_dispatch_handle: null,
          reservation_receipt: null,
          plan: null,
          recovery_required: null,
        });
      }
      const reservation = createCandidateDispatchReservation({
        repository: repo,
        candidateAuthority,
        dispatchAuthority,
        sourceTipCommitSha: loaded.tip_commit_sha,
        reachableRecordCount: loaded.commit_count,
        commandAuthority: command.authority,
        triggerIdentity: trigger_identity,
      });
      if (reservation === null) {
        if (candidateDispatchSelections(completed).length !== 0) {
          throw ledgerError(
            "candidate-dispatch-completion-required",
            "non-empty candidate dispatch cannot complete through the empty-cycle path",
          );
        }
        const emptyCycle = newCandidateDispatchCycle({
          repository: repo,
          candidateAuthority,
          completed,
          candidates: [],
          batchCount: 0,
        });
        const cycleCompletion = createCandidateDispatchCycleCompletion(
          emptyCycle,
        );
        const payload = createCandidateDispatchPayload({
          phase: "cycle-complete",
          dispatchAuthority,
          candidateAuthority,
          commandAuthority: command.authority,
          triggerIdentity: trigger_identity,
          cycleCompletion,
        });
        const appendReceipt = await appendCandidateDispatchPayload({
          api,
          loaded,
          repository: repo,
          payload,
          triggerIdentity: trigger_identity,
          repositoryEndpointReceipt,
        });
        const exact = await api.load();
        if (
          exact.tip_commit_sha !== appendReceipt.commit_sha ||
          exact.authority_projection.candidate_dispatch.current_cycle
            ?.cycle_complete !== true
        ) {
          throw ledgerError(
            "candidate-dispatch-completion-reread-mismatch",
            "empty candidate dispatch completion is absent after append",
          );
        }
        return deepFreeze({
          schema: "codex-review-gate-git-ledger-candidate-dispatch-load-v2",
          schema_version: 1,
          state: "complete",
          restarted: false,
          candidate_dispatch_handle: null,
          reservation_receipt: null,
          plan: null,
          recovery_required: null,
        });
      }
      // Validate the exact public projection before persisting a reservation.
      // A bounded-but-large identity batch must fail with zero writes rather
      // than leave an active reservation that no scanner can project.
      createCandidateDispatchPlan({
        reservation,
        acknowledgements: [],
      });
      const payload = createCandidateDispatchPayload({
        phase: "reserve",
        dispatchAuthority,
        candidateAuthority,
        commandAuthority: command.authority,
        triggerIdentity: trigger_identity,
        reservation,
      });
      const appendReceipt = await appendCandidateDispatchPayload({
        api,
        loaded,
        repository: repo,
        payload,
        triggerIdentity: trigger_identity,
        repositoryEndpointReceipt,
      });
      loaded = await api.load();
      if (
        loaded.tip_commit_sha !== appendReceipt.commit_sha ||
        loaded.authority_projection.candidate_dispatch.active_reservation
          ?.reservation.reservation_digest !== reservation.reservation_digest
      ) {
        throw ledgerError(
          "candidate-dispatch-reservation-reread-mismatch",
          "candidate dispatch reservation is absent after append",
        );
      }
      return deepFreeze({
        schema: "codex-review-gate-git-ledger-candidate-dispatch-load-v2",
        schema_version: 1,
        state: "dispatch",
        restarted: false,
        recovery_required: null,
        ...mintCandidateDispatchHandle({
          loaded,
          purpose: "scan",
          workflowCommandHandle: workflow_command_handle,
          commandAuthority: command.authority,
        }),
      });
    },

    async loadCandidateDispatchForScheduledPullRequest({
      workflow_command_handle,
      minimal_scope_handle,
      trigger_identity,
      expected_dispatch_binding,
    }) {
      const expectedBinding = normalizeCandidateDispatchPlanItem(
        expected_dispatch_binding,
        "candidate dispatch expected binding",
      );
      const expectedCandidate = expectedBinding.candidate;
      const minimal = await minimalScopeAuthorityFromHandle(
        minimal_scope_handle,
        repo,
      );
      const command = await scheduledWorkflowCommandAuthority({
        workflow_command_handle,
        repository: repo,
        trigger_identity,
        pull_request_number: minimal.scope.pull_request.number,
        expected_dispatch_binding: expectedBinding,
      });
      const loaded = await api.load();
      const dispatchAuthority = loaded.authority_projection.candidate_dispatch;
      const active = dispatchAuthority.active_reservation;
      if (active === null) {
        throw ledgerError(
          "candidate-dispatch-reservation-required",
          "scheduled PR requires one reachable active dispatch reservation",
        );
      }
      const candidate = active.reservation.candidates.find((item) =>
        item.number === minimal.scope.pull_request.number &&
        item.node_id === minimal.scope.pull_request.node_id);
      const candidateIndex = candidate === undefined
        ? -1
        : active.reservation.candidates.indexOf(candidate);
      if (
        candidate === undefined ||
        canonicalJson(candidate) !== canonicalJson(expectedCandidate) ||
        expectedBinding.generation_id !== active.reservation.generation_id ||
        expectedBinding.cycle_id !== active.reservation.cycle_id ||
        expectedBinding.inventory_digest !==
          active.reservation.inventory_digest ||
        expectedBinding.batch_index !== active.reservation.batch_index ||
        expectedBinding.batch_count !== active.reservation.batch_count ||
        expectedBinding.dispatch_digest !==
          active.reservation.dispatch_digest ||
        active.acknowledgements.some((ack) =>
          ack.candidate_index === candidateIndex) ||
        candidate.head_ref_oid !== minimal.scope.head_ref_oid ||
        candidate.base_ref_oid !== minimal.scope.base_ref_oid ||
        canonicalJson(candidateDispatchStableCommandAuthority(
          command.authority,
        )) !== canonicalJson(candidateDispatchStableCommandAuthority(
          active.scan_command_authority,
        )) ||
        canonicalJson(normalizeCandidateDispatchTriggerIdentity(
          trigger_identity,
        )) !== canonicalJson(active.reservation.trigger_identity)
      ) {
        throw ledgerError(
          "candidate-dispatch-scope-mismatch",
          "scheduled PR is outside or differs from its active dispatch reservation",
        );
      }
      const remainingBudget = calculateActiveCandidateDispatchCommitBudget(
        dispatchAuthority.current_cycle,
        loaded.commit_count,
      );
      if (remainingBudget.remaining_ledger_commit_capacity_after_dispatch < 0) {
        throw ledgerError(
          "candidate-dispatch-commit-capacity",
          "ledger cannot persist the remaining scheduled candidate protocol",
        );
      }
      return deepFreeze({
        schema:
          "codex-review-gate-git-ledger-candidate-dispatch-rehydrate-v2",
        schema_version: 1,
        ...mintCandidateDispatchHandle({
          loaded,
          purpose: "scheduled-pull-request",
          workflowCommandHandle: workflow_command_handle,
          commandAuthority: command.authority,
          minimalScopeHandle: minimal_scope_handle,
          candidate,
        }),
      });
    },

    async loadScheduledPullRequestEvaluatedScopeReceipt({
      candidate_dispatch_handle,
      minimal_scope_handle,
      trigger_identity,
    }) {
      const dispatchHandle = assertV2GitLedgerCandidateDispatchHandle(
        candidate_dispatch_handle,
        {
          purpose: "scheduled-pull-request",
          minimal_scope_handle,
        },
      );
      const dispatchPrivate = candidateDispatchHandles.get(
        candidate_dispatch_handle,
      );
      if (dispatchPrivate === undefined) {
        throw ledgerError(
          "UNTRUSTED_CANDIDATE_DISPATCH_HANDLE",
          "scheduled scope requires this factory's exact dispatch handle",
        );
      }
      const minimal = await minimalScopeAuthorityFromHandle(
        minimal_scope_handle,
        repo,
      );
      const loaded = await api.load();
      const dispatchAuthority = loaded.authority_projection.candidate_dispatch;
      if (
        dispatchAuthority.authority_digest !==
          dispatchHandle.source_dispatch_authority_digest ||
        loaded.tip_commit_sha !== dispatchHandle.source_tip_commit_sha
      ) {
        throw ledgerError(
          "candidate-dispatch-handle-stale",
          "scheduled scope dispatch handle is no longer current",
        );
      }
      const receipt = createScheduledPullRequestEvaluatedScopeReceiptFromAuthority({
        repository: repo,
        scope: minimal.scope,
        trigger_identity,
        scope_endpoint_receipt: minimal.scope_endpoint_receipt,
        candidate_authority:
          loaded.authority_projection.candidate_inventory,
        dispatch_authority: dispatchAuthority,
      });
      evaluatedScopeReceipts.set(receipt, deepFreeze({
        relation: receipt.relation,
        minimal_scope_handle,
        candidate_dispatch_handle,
      }));
      candidateDispatchHandlesByPreScopeReceipt.set(
        receipt,
        candidate_dispatch_handle,
      );
      candidateDispatchScheduledReceipts.set(
        candidate_dispatch_handle,
        {
          pre_scope_receipt: receipt,
          full_scope_receipt: null,
        },
      );
      return receipt;
    },

    async createCandidateDispatchResultAuthority({
      candidate_dispatch_handle,
      scheduler_append,
      production_runner_authority,
      lease_release_receipt,
      terminal_result,
    }) {
      assertV2GitLedgerCandidateDispatchHandle(
        candidate_dispatch_handle,
        { purpose: "scheduled-pull-request" },
      );
      const privateHandle = candidateDispatchHandles.get(
        candidate_dispatch_handle,
      );
      if (privateHandle === undefined) {
        throw ledgerError(
          "UNTRUSTED_CANDIDATE_DISPATCH_HANDLE",
          "candidate result authority requires this factory's exact scheduled handle",
        );
      }
      const schedulerAuthority = schedulerAppendHandles.get(scheduler_append);
      if (schedulerAuthority === undefined) {
        throw ledgerError(
          "UNTRUSTED_SCHEDULER_APPEND_HANDLE",
          "candidate result authority requires this factory's exact scheduler append",
        );
      }
      const releaseAuthority = leaseReleaseReceipts.get(
        lease_release_receipt,
      );
      if (releaseAuthority === undefined) {
        throw ledgerError(
          "UNTRUSTED_LEASE_RELEASE_RECEIPT",
          "candidate result authority requires this factory's exact durable lease release",
        );
      }
      const { assertV2ProductionRunnerAuthorityHandle } = await import(
        "./control-plane-receipt.mjs"
      );
      const runnerAuthority = assertV2ProductionRunnerAuthorityHandle(
        production_runner_authority,
      );
      const scheduled = candidateDispatchScheduledReceipts.get(
        candidate_dispatch_handle,
      );
      const fullScopeReceipt = scheduled?.full_scope_receipt ?? null;
      const fullScopeAuthority = fullScopeReceipts.get(fullScopeReceipt);
      if (fullScopeReceipt === null || fullScopeAuthority === undefined) {
        throw ledgerError(
          "candidate-dispatch-result-scope-mismatch",
          "candidate result authority lacks its scheduled full-discovery receipt",
        );
      }
      if (schedulerAuthority.evaluated_scope_receipt !== fullScopeReceipt) {
        throw ledgerError(
          "candidate-dispatch-result-scope-mismatch",
          "candidate scheduler authority differs from its scheduled full discovery",
        );
      }
      if (releaseAuthority.evaluated_scope_receipt !==
          fullScopeAuthority.pre_scope_receipt) {
        throw ledgerError(
          "candidate-dispatch-result-scope-mismatch",
          "candidate lease release differs from its scheduled pre-scope authority",
        );
      }
      const releaseLease = validateLeaseReceipt(
        releaseAuthority.lease_receipt,
        repo,
        ref,
      );
      const schedulerLease = normalizeInitialLeaseAuthority(
        schedulerAuthority.lease_authority,
      );
      if (
        releaseLease.lease_id !== schedulerLease.lease_id ||
        canonicalJson(releaseLease.owner) !== canonicalJson(
          schedulerLease.owner,
        ) ||
        releaseLease.acquire_commit_sha !==
          schedulerLease.acquire_commit_sha ||
        releaseLease.acquired_at !== schedulerLease.acquired_at ||
        releaseLease.expires_at !== schedulerLease.expires_at ||
        schedulerLease.evaluated_scope_receipt_digest !==
          releaseAuthority.evaluated_scope_receipt.receipt_digest
      ) {
        throw ledgerError(
          "candidate-dispatch-result-scope-mismatch",
          "candidate scheduler and release authorities cite different leases",
        );
      }
      const loaded = await api.load();
      const normalizedTerminal = validateCandidateDispatchTerminalResult({
        terminal_result,
        scheduler_append,
        scheduler_authority: schedulerAuthority,
        production_runner_authority: runnerAuthority,
        lease_release_receipt,
        loaded,
      });
      const terminalAuthority = createCandidateDispatchTerminalAuthority({
        scheduler_append,
        scheduler_authority: schedulerAuthority,
        full_scope_receipt: fullScopeReceipt,
        lease_release_receipt,
        terminal_result: normalizedTerminal,
      });
      validateCandidateDispatchTerminalHistory({
        loaded,
        terminal_authority: terminalAuthority,
        scheduled_scope_receipt: fullScopeReceipt,
        owner: candidateDispatchOwner(privateHandle.command_authority),
      });
      const result = createV2GitLedgerCandidateDispatchResult({
        candidate: privateHandle.candidate,
        controller_authority_digest: terminalAuthority.authority_digest,
        controller_result_digest:
          terminalAuthority.terminal_projection_digest,
        ...candidateDispatchOutcomeFromTerminal(normalizedTerminal),
      });
      const resultHandle = sealCandidateDispatchResultHandle({
        candidateDispatchHandle: candidate_dispatch_handle,
        schedulerAppend: scheduler_append,
        leaseReleaseReceipt: lease_release_receipt,
        result,
      });
      const privateResult = deepFreeze({
        candidate_dispatch_handle,
        reservation_receipt: privateHandle.reservation_receipt,
        full_scope_receipt: fullScopeReceipt,
        scheduler_append,
        production_runner_authority,
        lease_release_receipt,
        terminal_result: structuredClone(normalizedTerminal),
        terminal_authority: terminalAuthority,
        result,
        result_handle: resultHandle,
        source_tip_commit_sha: loaded.tip_commit_sha,
      });
      CANDIDATE_DISPATCH_RESULT_HANDLES.set(resultHandle, privateResult);
      candidateDispatchResultHandles.set(resultHandle, privateResult);
      return deepFreeze({
        schema:
          "codex-review-gate-git-ledger-candidate-dispatch-result-authority-v2",
        schema_version: 1,
        candidate_dispatch_result_handle: resultHandle,
        result,
      });
    },

    async ackCandidateDispatch({
      candidate_dispatch_handle,
      reservation_receipt,
      full_scope_receipt,
      candidate_dispatch_result_handle,
    }) {
      const handle = assertV2GitLedgerCandidateDispatchHandle(
        candidate_dispatch_handle,
        {
          purpose: "scheduled-pull-request",
          reservation_receipt,
        },
      );
      const privateHandle = candidateDispatchHandles.get(
        candidate_dispatch_handle,
      );
      if (privateHandle === undefined ||
          consumedCandidateDispatchHandles.has(candidate_dispatch_handle)) {
        throw ledgerError(
          "candidate-dispatch-handle-replayed",
          "candidate dispatch ack requires one unused same-factory handle",
        );
      }
      const reservationReceipt =
        validateV2GitLedgerCandidateDispatchReservationReceipt(
          reservation_receipt,
        );
      if (
        candidateDispatchReservationReceipts.get(reservation_receipt) !==
          privateHandle ||
        reservationReceipt.receipt_digest !==
          privateHandle.reservation_receipt.receipt_digest ||
        reservationReceipt.reservation_digest !==
          privateHandle.reservation.reservation_digest
      ) {
        throw ledgerError(
          "candidate-dispatch-reservation-receipt-mismatch",
          "candidate dispatch ack cites another reservation receipt",
        );
      }
      const normalizedResultHandle =
        assertV2GitLedgerCandidateDispatchResultHandle(
          candidate_dispatch_result_handle,
        );
      const privateResult = candidateDispatchResultHandles.get(
        candidate_dispatch_result_handle,
      );
      if (
        privateResult === undefined ||
        privateResult.candidate_dispatch_handle !==
          candidate_dispatch_handle ||
        privateResult.reservation_receipt !== reservation_receipt ||
        privateResult.full_scope_receipt !== full_scope_receipt
      ) {
        throw ledgerError(
          "CANDIDATE_DISPATCH_RESULT_HANDLE_BINDING_MISMATCH",
          "candidate dispatch ack requires the exact same-factory terminal result authority",
        );
      }
      const normalizedResult = privateResult.result;
      if (
        normalizedResultHandle.result_digest !==
          normalizedResult.result_digest
      ) {
        throw ledgerError(
          "CANDIDATE_DISPATCH_RESULT_HANDLE_BINDING_MISMATCH",
          "candidate dispatch result handle differs from its protected result",
        );
      }
      if (
        canonicalJson(normalizedResult.candidate) !==
          canonicalJson(privateHandle.candidate)
      ) {
        throw ledgerError(
          "candidate-dispatch-result-mismatch",
          "candidate dispatch result belongs to another candidate",
        );
      }
      const scheduled = candidateDispatchScheduledReceipts.get(
        candidate_dispatch_handle,
      );
      if (scheduled?.full_scope_receipt === null ||
          scheduled?.full_scope_receipt === undefined ||
          scheduled.full_scope_receipt !== full_scope_receipt ||
          !fullScopeReceipts.has(full_scope_receipt)) {
        throw ledgerError(
          "candidate-dispatch-full-scope-required",
          "candidate dispatch ack requires same-job full PR discovery",
        );
      }
      const fullScopeReceipt = validateV2GitLedgerEvaluatedScopeReceipt(
        scheduled.full_scope_receipt,
        { repository: repo },
      );
      let loaded = await api.load();
      if (
        loaded.tip_commit_sha !== privateResult.source_tip_commit_sha ||
        loaded.tip_commit_sha !==
          privateResult.lease_release_receipt.commit_sha
      ) {
        throw ledgerError(
          "candidate-dispatch-result-handle-stale",
          "candidate dispatch result authority is not the exact current released tip",
        );
      }
      if (loaded.active_lease !== null) {
        throw ledgerError(
          "candidate-dispatch-lease-release-required",
          "candidate dispatch ack requires a durably released PR lease",
        );
      }
      let candidateAuthority = loaded.authority_projection.candidate_inventory;
      let dispatchAuthority = loaded.authority_projection.candidate_dispatch;
      const active = dispatchAuthority.active_reservation;
      if (
        active === null ||
        active.reservation_record_oid !==
          reservationReceipt.reservation_record_oid ||
        active.reservation.reservation_digest !==
          reservationReceipt.reservation_digest ||
        active.reservation.dispatch_digest !== handle.dispatch_digest ||
        active.acknowledgements.some((ack) =>
          ack.candidate_index === privateHandle.candidate_index)
      ) {
        throw ledgerError(
          "candidate-dispatch-handle-stale",
          "candidate dispatch reservation advanced before its ack",
        );
      }
      validateScheduledDispatchReceiptAgainstReservation(
        fullScopeReceipt,
        active.reservation,
        privateHandle.candidate,
      );
      const ackWithoutDigest = {
        generation_id: active.reservation.generation_id,
        cycle_id: active.reservation.cycle_id,
        inventory_digest: active.reservation.inventory_digest,
        reservation_digest: active.reservation.reservation_digest,
        dispatch_digest: active.reservation.dispatch_digest,
        batch_index: active.reservation.batch_index,
        candidate_index: privateHandle.candidate_index,
        candidate: structuredClone(privateHandle.candidate),
        result: normalizedResult,
        terminal_authority: privateResult.terminal_authority,
        scheduled_scope_receipt: fullScopeReceipt,
      };
      const candidateAck = normalizeCandidateDispatchAck({
        ...ackWithoutDigest,
        ack_digest: digestCanonical(
          "codex-review-gate-v2-candidate-dispatch-ack",
          ackWithoutDigest,
        ),
      });
      const payload = createCandidateDispatchPayload({
        phase: "candidate-ack",
        dispatchAuthority,
        candidateAuthority,
        commandAuthority: privateHandle.command_authority,
        triggerIdentity: privateHandle.trigger_identity,
        candidateAck,
      });
      const ackAppendReceipt = await appendCandidateDispatchPayload({
        api,
        loaded,
        repository: repo,
        payload,
        triggerIdentity: privateHandle.trigger_identity,
        repositoryEndpointReceipt:
          privateHandle.repository_endpoint_receipt,
      });
      consumedCandidateDispatchHandles.add(candidate_dispatch_handle);
      loaded = await api.load();
      if (
        loaded.tip_commit_sha !== ackAppendReceipt.commit_sha ||
        !loaded.authority_projection.candidate_dispatch.active_reservation
          ?.acknowledgements.some((ack) =>
            ack.record_oid === ackAppendReceipt.commit_sha &&
            ack.result.result_digest === normalizedResult.result_digest)
      ) {
        throw ledgerError(
          "candidate-dispatch-ack-reread-mismatch",
          "candidate dispatch ack is absent after its protected append",
        );
      }
      let completion = {
        loaded,
        batch_completion_append_receipt: null,
        cycle_completion_append_receipt: null,
      };
      const reloadedActive = loaded.authority_projection.candidate_dispatch
        .active_reservation;
      if (reloadedActive?.acknowledgements.length ===
          reloadedActive?.reservation.candidates.length) {
        completion = await completeCandidateDispatchAfterAcks({
          api,
          loaded,
          repository: repo,
          commandAuthority: privateHandle.command_authority,
          triggerIdentity: privateHandle.trigger_identity,
          repositoryEndpointReceipt:
            privateHandle.repository_endpoint_receipt,
        });
      }
      const finalAuthority = completion.loaded.authority_projection
        .candidate_dispatch;
      return deepFreeze({
        schema: "codex-review-gate-git-ledger-candidate-dispatch-ack-v2",
        schema_version: 1,
        result_digest: normalizedResult.result_digest,
        ack_append_receipt: ackAppendReceipt,
        batch_completion_append_receipt:
          completion.batch_completion_append_receipt,
        cycle_completion_append_receipt:
          completion.cycle_completion_append_receipt,
        dispatch_authority_digest: finalAuthority.authority_digest,
        cycle_complete: finalAuthority.current_cycle?.cycle_complete === true,
        remaining_plan: finalAuthority.active_reservation === null
          ? null
          : createCandidateDispatchPlan(finalAuthority.active_reservation),
      });
    },

    async recoverCandidateDispatchFailure({
      workflow_command_handle,
      trigger_identity,
      repository_endpoint_receipt,
      expected_dispatch_binding,
    }) {
      const expectedBinding = normalizeCandidateDispatchPlanItem(
        expected_dispatch_binding,
        "candidate dispatch recovery expected binding",
      );
      const command = await scheduledRecoveryWorkflowCommandAuthority({
        workflow_command_handle,
        repository: repo,
        trigger_identity,
        expected_dispatch_binding: expectedBinding,
      });
      const repositoryEndpointReceipt = normalizeRepositoryEndpointReceipt(
        repository_endpoint_receipt,
        repo,
      );
      let loaded = await api.load();
      const dispatchAuthority = loaded.authority_projection.candidate_dispatch;
      const active = dispatchAuthority.active_reservation;
      if (active === null) {
        throw ledgerError(
          "candidate-dispatch-recovery-reservation-required",
          "candidate dispatch recovery requires one active reservation",
        );
      }
      const reservation = active.reservation;
      const candidateIndex = reservation.candidates.findIndex((candidate) =>
        canonicalJson(candidate) === canonicalJson(expectedBinding.candidate));
      if (
        expectedBinding.generation_id !== reservation.generation_id ||
        expectedBinding.cycle_id !== reservation.cycle_id ||
        expectedBinding.inventory_digest !== reservation.inventory_digest ||
        expectedBinding.batch_index !== reservation.batch_index ||
        expectedBinding.batch_count !== reservation.batch_count ||
        expectedBinding.dispatch_digest !== reservation.dispatch_digest ||
        candidateIndex < 0 ||
        active.acknowledgements.some((ack) =>
          ack.candidate_index === candidateIndex) ||
        canonicalJson(candidateDispatchStableCommandAuthority(
          command.authority,
        )) !== canonicalJson(candidateDispatchStableCommandAuthority(
          active.scan_command_authority,
        )) ||
        canonicalJson(normalizeCandidateDispatchTriggerIdentity(
          trigger_identity,
        )) !== canonicalJson(reservation.trigger_identity)
      ) {
        throw ledgerError(
          "candidate-dispatch-recovery-binding-mismatch",
          "candidate dispatch recovery differs from its active reserved candidate",
        );
      }
      const attempts = candidateDispatchScheduledAcquireAttempts(
        loaded.records,
      ).filter(({ binding }) =>
        binding.dispatch_reservation_digest === reservation.reservation_digest &&
        binding.dispatch_candidate_index === candidateIndex &&
        canonicalJson(binding.selected_candidate) === canonicalJson({
          id: expectedBinding.candidate.id,
          node_id: expectedBinding.candidate.node_id,
          number: expectedBinding.candidate.number,
          created_at: expectedBinding.candidate.created_at,
        }));
      if (attempts.length === 0) {
        throw ledgerError(
          "candidate-dispatch-recovery-not-started",
          "an unstarted dispatch candidate remains eligible for its first attempt",
        );
      }
      if (attempts.length !== 1) {
        throw ledgerError(
          "candidate-dispatch-recovery-attempt-mismatch",
          "candidate dispatch recovery found multiple durable attempts",
        );
      }
      const attemptBinding = attempts[0].binding;
      if (loaded.active_lease !== null &&
          Date.parse(loaded.post_ref.server_time) <
            Date.parse(loaded.active_lease.expires_at)) {
        throw ledgerError(
          "candidate-dispatch-recovery-not-ready",
          "candidate dispatch recovery must wait for release or trusted expiry",
        );
      }
      const evidence = deriveCandidateDispatchRecoveryEvidence({
        records: loaded.records,
        attempt_binding: attemptBinding,
        source_tip_commit_sha: loaded.tip_commit_sha,
        post_ref_receipt: refReceipt(loaded.post_ref),
      });
      validateScheduledDispatchReceiptAgainstReservation(
        evidence.scheduled_scope_receipt,
        reservation,
        expectedBinding.candidate,
        { allow_pre_scope: true },
      );
      const terminalAuthority =
        createCandidateDispatchRecoveryTerminalAuthority(evidence);
      const outcome = candidateDispatchOutcomeFromTerminalAuthority(
        terminalAuthority,
      );
      const result = createV2GitLedgerCandidateDispatchResult({
        candidate: expectedBinding.candidate,
        controller_authority_digest: terminalAuthority.authority_digest,
        controller_result_digest:
          terminalAuthority.terminal_projection_digest,
        ...outcome,
      });
      const ackWithoutDigest = {
        generation_id: reservation.generation_id,
        cycle_id: reservation.cycle_id,
        inventory_digest: reservation.inventory_digest,
        reservation_digest: reservation.reservation_digest,
        dispatch_digest: reservation.dispatch_digest,
        batch_index: reservation.batch_index,
        candidate_index: candidateIndex,
        candidate: structuredClone(expectedBinding.candidate),
        result,
        terminal_authority: terminalAuthority,
        scheduled_scope_receipt: evidence.scheduled_scope_receipt,
      };
      const candidateAck = normalizeCandidateDispatchAck({
        ...ackWithoutDigest,
        ack_digest: digestCanonical(
          "codex-review-gate-v2-candidate-dispatch-ack",
          ackWithoutDigest,
        ),
      });
      const payload = createCandidateDispatchPayload({
        phase: "candidate-ack",
        dispatchAuthority,
        candidateAuthority:
          loaded.authority_projection.candidate_inventory,
        commandAuthority: command.authority,
        triggerIdentity: trigger_identity,
        candidateAck,
      });
      const ackAppendReceipt = await appendCandidateDispatchPayload({
        api,
        loaded,
        repository: repo,
        payload,
        triggerIdentity: trigger_identity,
        repositoryEndpointReceipt,
      });
      loaded = await api.load();
      if (
        loaded.tip_commit_sha !== ackAppendReceipt.commit_sha ||
        !loaded.authority_projection.candidate_dispatch.active_reservation
          ?.acknowledgements.some((ack) =>
            ack.record_oid === ackAppendReceipt.commit_sha &&
            ack.result.result_digest === result.result_digest)
      ) {
        throw ledgerError(
          "candidate-dispatch-recovery-reread-mismatch",
          "candidate dispatch recovery ack is absent after append",
        );
      }
      let completion = {
        loaded,
        batch_completion_append_receipt: null,
        cycle_completion_append_receipt: null,
      };
      const reloadedActive = loaded.authority_projection.candidate_dispatch
        .active_reservation;
      if (reloadedActive?.acknowledgements.length ===
          reloadedActive?.reservation.candidates.length) {
        completion = await completeCandidateDispatchAfterAcks({
          api,
          loaded,
          repository: repo,
          commandAuthority: command.authority,
          triggerIdentity: trigger_identity,
          repositoryEndpointReceipt,
        });
      }
      const finalAuthority = completion.loaded.authority_projection
        .candidate_dispatch;
      return deepFreeze({
        schema: "codex-review-gate-git-ledger-candidate-dispatch-recovery-v2",
        schema_version: 1,
        result,
        recovery_authority_digest: terminalAuthority.authority_digest,
        recovery_mode: terminalAuthority.recovery.mode,
        prefix_phase: terminalAuthority.recovery.prefix_phase,
        ack_append_receipt: ackAppendReceipt,
        batch_completion_append_receipt:
          completion.batch_completion_append_receipt,
        cycle_completion_append_receipt:
          completion.cycle_completion_append_receipt,
        dispatch_authority_digest: finalAuthority.authority_digest,
        cycle_complete: finalAuthority.current_cycle?.cycle_complete === true,
        remaining_plan: finalAuthority.active_reservation === null
          ? null
          : createCandidateDispatchPlan(finalAuthority.active_reservation),
      });
    },

    async createPullRequestEventEvaluatedScopeReceipt({
      minimal_scope_handle,
      trigger_identity,
    }) {
      const minimal = await minimalScopeAuthorityFromHandle(
        minimal_scope_handle,
        repo,
      );
      const receipt = createV2GitLedgerPullRequestEventPreScopeReceipt({
        repository: repo,
        scope: minimal.scope,
        trigger_identity,
        scope_endpoint_receipt: minimal.scope_endpoint_receipt,
      });
      evaluatedScopeReceipts.set(receipt, deepFreeze({
        relation: receipt.relation,
        minimal_scope_handle,
      }));
      return receipt;
    },

    async createManualPullRequestEvaluatedScopeReceipt({
      minimal_scope_handle,
      trigger_identity,
      workflow_command_handle,
    }) {
      const minimal = await minimalScopeAuthorityFromHandle(
        minimal_scope_handle,
        repo,
      );
      const command = await manualWorkflowCommandAuthority({
        workflow_command_handle,
        repository: repo,
        scope: minimal.scope,
        trigger_identity,
      });
      const selectionReceipt = createV2GitLedgerManualSelectionReceipt({
        source: "trusted-reusable-workflow-input",
        input_name: "pull-request",
        input_value: String(minimal.scope.pull_request.number),
        command_receipt_digest: command.command_receipt_digest,
        scope: minimal.scope,
      });
      const receipt = createV2GitLedgerManualPullRequestEvaluatedScopeReceipt({
        repository: repo,
        scope: minimal.scope,
        trigger_identity,
        selection_receipt: selectionReceipt,
        scope_endpoint_receipt: minimal.scope_endpoint_receipt,
      });
      manualScopeReceipts.add(receipt);
      evaluatedScopeReceipts.set(receipt, deepFreeze({
        relation: receipt.relation,
        minimal_scope_handle,
        workflow_command_handle,
      }));
      return receipt;
    },

    async createProviderEventPreScopeEvaluatedScopeReceipt({
      minimal_scope_handle,
      trigger_identity,
      provider_artifact_handle,
    }) {
      const minimal = await minimalScopeAuthorityFromHandle(
        minimal_scope_handle,
        repo,
      );
      const scope = minimal.scope;
      const liveProviderIdentityAuthority =
        await providerIdentityAuthorityFromPreflight(
          preflightHandle,
          capability.provider_identity_policy,
          repo,
        );
      const provider = normalizeExpectedProvider({
        actor: liveProviderIdentityAuthority.actor,
        app: liveProviderIdentityAuthority.app,
      });
      const artifactHandle = assertV2ProviderPreScopeArtifactHandle(
        provider_artifact_handle,
        {
          repository: { owner: repo.owner, name: repo.name },
          scope: {
            pull_request: { number: scope.pull_request.number },
            head_ref_oid: scope.head_ref_oid,
          },
          expected_provider: provider,
        },
      );
      const selector = providerEvaluatedScopeSelector(
        artifactHandle,
        scope,
      );
      const providerArtifactReceipt = providerArtifactContinuityReceipt({
        phase: "pre-scope",
        preScopeReceiptDigest: null,
        selector,
        artifactEntry: artifactHandle,
        snapshotDigest: null,
      });
      const receipt = createV2GitLedgerEvaluatedScopeReceipt({
        relation: "provider-selector",
        repository: repo,
        scope,
        trigger_identity,
        selector,
        inventory_receipt: null,
        provider_artifact_receipt: providerArtifactReceipt,
        provider_identity_authority: liveProviderIdentityAuthority,
        scope_endpoint_receipt: minimal.scope_endpoint_receipt,
      });
      providerPreScopeReceipts.set(receipt, deepFreeze({
        artifact_handle: artifactHandle,
        expected_provider: provider,
        provider_identity_authority: liveProviderIdentityAuthority,
        minimal_scope_handle,
      }));
      evaluatedScopeReceipts.set(receipt, deepFreeze({
        relation: receipt.relation,
        phase: "pre-scope",
        minimal_scope_handle,
      }));
      return receipt;
    },

    async createFullDiscoveryEvaluatedScopeReceipt({
      pre_scope_receipt,
      lease_receipt,
      continuity_handle,
    }) {
      const preAuthority = evaluatedScopeReceipts.get(pre_scope_receipt);
      if (preAuthority === undefined) {
        throw ledgerError(
          "untrusted-pre-scope-receipt",
          "full discovery requires this factory's exact pre-scope receipt",
        );
      }
      const pre = validateV2GitLedgerEvaluatedScopeReceipt(
        pre_scope_receipt,
        { repository: repo },
      );
      if (
        pre.phase !== "pre-scope" ||
        pre.discovery_continuity_receipt !== null ||
        pre.relation === "scheduled-repository-inventory"
      ) {
        throw ledgerError(
          "pre-scope-receipt-required",
          "full discovery requires one PR pre-scope receipt",
        );
      }
      const leaseReceipt = validateLeaseReceipt(lease_receipt, repo, ref);
      const loaded = await api.load();
      validateFullDiscoveryLease({
        loaded,
        lease_receipt: leaseReceipt,
        pre_scope_receipt: pre,
      });
      const projection = await projectDiscoveryContinuityAuthority({
        handle: continuity_handle,
        repository: repo,
        scope: pre.scope,
        pre_scope_receipt,
        lease_receipt,
      });
      const receipt = createV2GitLedgerEvaluatedScopeReceipt({
        relation: pre.relation,
        phase: "full-discovery",
        repository: repo,
        scope: pre.scope,
        trigger_identity: {
          event_name: pre.trigger_event_name,
          ref: pre.trigger_ref,
          sha: pre.trigger_sha,
        },
        selector: pre.selector,
        inventory_receipt: pre.inventory_receipt,
        provider_artifact_receipt: pre.provider_artifact_receipt,
        provider_identity_authority: pre.provider_identity_authority,
        discovery_continuity_receipt: projection.continuity_receipt,
        scope_endpoint_receipt: pre.scope_endpoint_receipt,
      });
      const authority = deepFreeze({
        pre_scope_receipt,
        lease_receipt,
        continuity_handle,
        projection,
        created_ordinal: ++authorityMintOrdinal,
      });
      fullScopeReceipts.set(receipt, authority);
      evaluatedScopeReceipts.set(receipt, deepFreeze({
        relation: receipt.relation,
        phase: "full-discovery",
        pre_scope_receipt,
        lease_acquire_commit_sha: leaseReceipt.acquire_commit_sha,
        continuity_handle,
      }));
      if (receipt.relation === "manual-pull-request") {
        manualScopeReceipts.add(receipt);
      }
      const dispatchHandle = candidateDispatchHandlesByPreScopeReceipt.get(
        pre_scope_receipt,
      );
      if (dispatchHandle !== undefined) {
        const scheduled = candidateDispatchScheduledReceipts.get(
          dispatchHandle,
        );
        if (scheduled === undefined ||
            scheduled.pre_scope_receipt !== pre_scope_receipt) {
          throw ledgerError(
            "candidate-dispatch-scope-handle-mismatch",
            "scheduled full discovery lost its dispatch pre-scope authority",
          );
        }
        scheduled.full_scope_receipt = receipt;
      }
      return receipt;
    },

    async createProviderEventFullDiscoveryEvaluatedScopeReceipt({
      full_scope_receipt,
      continuity_handle,
    }) {
      const fullAuthority = fullScopeReceipts.get(full_scope_receipt);
      if (
        fullAuthority === undefined ||
        fullAuthority.continuity_handle !== continuity_handle
      ) {
        throw ledgerError(
          "untrusted-full-scope-receipt",
          "provider overlay requires this factory's exact full discovery",
        );
      }
      const preScopeReceipt = fullAuthority.pre_scope_receipt;
      const authority = providerPreScopeReceipts.get(preScopeReceipt);
      if (authority === undefined) {
        throw ledgerError(
          "untrusted-provider-pre-scope-receipt",
          "provider overlay requires the exact factory-created pre-scope receipt",
        );
      }
      const full = validateV2GitLedgerEvaluatedScopeReceipt(
        full_scope_receipt,
        { repository: repo },
      );
      const pre = validateV2GitLedgerEvaluatedScopeReceipt(
        preScopeReceipt,
        { repository: repo },
      );
      const leaseReceipt = validateLeaseReceipt(
        fullAuthority.lease_receipt,
        repo,
        ref,
      );
      if (
        full.relation !== "provider-selector" ||
        full.provider_artifact_receipt?.phase !== "pre-scope" ||
        full.discovery_continuity_receipt === null
      ) {
        throw ledgerError(
          "provider-pre-scope-relation-required",
          "provider overlay requires a provider common full receipt",
        );
      }
      const loaded = await api.load();
      validateFullDiscoveryLease({
        loaded,
        lease_receipt: leaseReceipt,
        pre_scope_receipt: pre,
      });
      const snapshot = fullAuthority.projection.discovery_snapshot;
      assertV2ProviderPreScopeArtifactEqualsSnapshot(
        authority.artifact_handle,
        snapshot,
      );
      const artifactEntry = getExactArtifact(
        snapshot,
        authority.artifact_handle.selector,
      );
      if (
        Date.parse(artifactEntry.response_server_time) <=
          Date.parse(leaseReceipt.acquired_at)
      ) {
        throw ledgerError(
          "provider-full-discovery-before-lease",
          "provider exact artifact refetch must follow lease acquire",
        );
      }
      const selector = providerEvaluatedScopeSelector(
        artifactEntry,
        pre.scope,
      );
      const providerArtifactReceipt = providerArtifactContinuityReceipt({
        phase: "full-discovery",
        preScopeReceiptDigest: pre.receipt_digest,
        selector,
        artifactEntry,
        snapshotDigest:
          full.discovery_continuity_receipt.full_snapshot.snapshot_digest,
      });
      if (
        providerArtifactReceipt.carrier_digest !==
          pre.provider_artifact_receipt.carrier_digest
      ) {
        throw ledgerError(
          "provider-artifact-changed",
          "provider full discovery differs from its pre-lease exact artifact",
        );
      }
      const receipt = createV2GitLedgerEvaluatedScopeReceipt({
        relation: "provider-selector",
        phase: "full-discovery",
        repository: repo,
        scope: pre.scope,
        trigger_identity: {
          event_name: pre.trigger_event_name,
          ref: pre.trigger_ref,
          sha: pre.trigger_sha,
        },
        selector,
        inventory_receipt: null,
        provider_artifact_receipt: providerArtifactReceipt,
        provider_identity_authority:
          authority.provider_identity_authority,
        discovery_continuity_receipt:
          full.discovery_continuity_receipt,
        scope_endpoint_receipt: full.scope_endpoint_receipt,
      });
      providerFullScopeReceipts.add(receipt);
      const providerFullAuthority = deepFreeze({
        ...fullAuthority,
        created_ordinal: ++authorityMintOrdinal,
      });
      fullScopeReceipts.set(receipt, providerFullAuthority);
      evaluatedScopeReceipts.set(receipt, deepFreeze({
        relation: receipt.relation,
        phase: "full-discovery",
        pre_scope_receipt: preScopeReceipt,
        lease_acquire_commit_sha: leaseReceipt.acquire_commit_sha,
        continuity_handle,
      }));
      return receipt;
    },

    async bootstrapCapability() {
      if (bootstrapCandidate === null) {
        throw ledgerError(
          "bootstrap-authority-required",
          "capability bootstrap is restricted to a validated bootstrap candidate",
        );
      }
      const bootstrapPolicy = bootstrapCandidate.workflow_provenance_policy;
      const bootstrapRelease = bootstrapCandidate.controller_release;
      const bootstrapProtectionDigest =
        bootstrapCandidate.protection.live_ruleset_receipt_digest;
      const requestBudget = createRequestBudget();
      const provenanceBudget = createVerifierBudget();
      let initialRef = await readRef({
        fetchImpl,
        authorization,
        base,
        repoPath,
        ref,
        refSuffix,
        allowAbsent: true,
        requestBudget,
      });
      let chain;
      let genesisCommitSha;
      let genesisReceipt = null;
      let genesisWriteObservation = null;
      if (initialRef.absent === true) {
        const genesisProvenance = await obtainWorkflowProvenance({
          verifyWorkflowProvenance,
          operation: "bootstrap-genesis",
          repository: repo,
          ledgerRef: ref,
          predecessorCommitSha: null,
          protectionReceiptDigest: bootstrapProtectionDigest,
          source: sourceWorkflow(bootstrapRelease),
          effectScope: null,
          recordIdentity: null,
          serverTime: initialRef.server_time,
          policy: bootstrapPolicy,
          provenanceBudget,
        });
        const genesisEnvelope = sealEnvelope({
          repository: repo,
          ledger_ref: ref,
          record_type: "genesis",
          sequence: 0,
          pull_request: null,
          head_ref_oid: null,
          base_ref_oid: null,
          potential_merge_commit_oid: null,
          kind: null,
          effect_id: null,
          idempotency_key: null,
          predecessor_commit_sha: null,
          server_observed_at: initialRef.server_time,
          payload: {
            sealed: true,
            bootstrap_candidate_digest: bootstrapCandidate.input_digest,
            bootstrap_candidate: structuredClone(bootstrapCandidate),
          },
          control_comment_binding: null,
          lease: null,
          source_workflow: sourceWorkflow(bootstrapRelease),
          workflow_provenance: genesisProvenance.receipt,
          workflow_provenance_jwt: genesisProvenance.compact_jwt,
        });
        const objects = await createCommitObjects({
          fetchImpl,
          authorization,
          base,
          repoPath,
          envelope: genesisEnvelope,
          parents: [],
          requestBudget,
        });
        const createdRef = await createRef({
          fetchImpl,
          authorization,
          base,
          repoPath,
          ref,
          shaValue: objects.commit_sha,
          requestBudget,
        });
        const exact = await readRef({
          fetchImpl,
          authorization,
          base,
          repoPath,
          ref,
          refSuffix,
          requestBudget,
        });
        if (exact.target_commit_sha !== objects.commit_sha) {
          throw ledgerError(
            "ref-reread-mismatch",
            "sealed genesis ref reread does not equal the created commit",
          );
        }
        genesisCommitSha = objects.commit_sha;
        genesisReceipt = sealAppendReceipt({
          repository: repo,
          ledger_ref: ref,
          record_type: "genesis",
          sequence: 0,
          predecessor_commit_sha: null,
          commit_sha: objects.commit_sha,
          tree_sha: objects.tree_sha,
          blob_sha: objects.blob_sha,
          server_observed_at: genesisEnvelope.server_observed_at,
          payload_digest: genesisEnvelope.payload_digest,
          ref_update: captureReceipt(createdRef),
          ref_reread: refReceipt(exact),
          capability_attestation_commit_sha: null,
          protection_receipt_digest:
            bootstrapProtectionDigest,
          stable: true,
        });
        genesisWriteObservation = deepFreeze({
          commit_sha: objects.commit_sha,
          tree_sha: objects.tree_sha,
          blob_sha: objects.blob_sha,
          object_write_receipts: objects.object_write_receipts,
          ref_create: captureReceipt(createdRef),
          ref_reread: refReceipt(exact),
        });
        initialRef = exact;
      }

      chain = await loadStableChain({
        fetchImpl,
        authorization,
        base,
        repoPath,
        ref,
        refSuffix,
        repo,
        verifyWorkflowProvenance,
        provenanceBudget,
        requestBudget,
      });
      genesisCommitSha = chain.genesis_commit_sha;
      const current = findCurrentCapabilityForBootstrapCandidate(
        chain,
        bootstrapCandidate,
      );
      if (current !== null) {
        capability = current.capability_receipt;
        return deepFreeze({
          bootstrap_receipt: sealBootstrapReceipt({
          repository: repo,
          ledger_ref: ref,
          genesis_commit_sha: genesisCommitSha,
          genesis_receipt: genesisReceipt,
          race_parent_commit_sha: null,
          contenders: [],
          winner_commit_sha: null,
          race_final_ref_reread: refReceipt(chain.post_ref),
          attestation_receipt: null,
          capability_attestation_commit_sha: current.commit_sha,
          protection_receipt_digest:
            bootstrapProtectionDigest,
          already_current: true,
          stable: true,
          }),
          sealed_capability_receipt: capability,
        });
      }
      if (
        chain.authority_projection.candidate_dispatch.active_reservation !==
          null
      ) {
        throw ledgerError(
          "candidate-dispatch-capability-drift",
          "active candidate dispatch forbids capability replacement",
        );
      }
      if (chain.active_lease !== null) {
        throw ledgerError(
          "lease-active",
          "cannot attest a new capability while a controller lease is active",
        );
      }
      requireCommitCapacity(chain.records.length, 2, "capability bootstrap");

      const raceParent = chain.tip_commit_sha;
      const raceParentSequence = chain.records.at(-1).envelope.sequence;
      const priorUnattestedCanaries = collectTrailingCanaries(chain.records);
      const consumedJtis = new Set(chain.records.map((entry) =>
        provenanceReplayIdentity(entry.envelope.workflow_provenance)));
      const contenderObjects = [];
      for (const label of ["alpha", "beta"]) {
        const contenderProvenance = await obtainWorkflowProvenance({
          verifyWorkflowProvenance,
          operation: `bootstrap-race-${label}`,
          repository: repo,
          ledgerRef: ref,
          predecessorCommitSha: raceParent,
          protectionReceiptDigest: bootstrapProtectionDigest,
          source: sourceWorkflow(bootstrapRelease),
          effectScope: null,
          recordIdentity: null,
          serverTime: chain.post_ref.server_time,
          policy: bootstrapPolicy,
          provenanceBudget,
        });
        assertUnusedProvenanceJti(consumedJtis, contenderProvenance.receipt);
        const envelope = sealEnvelope({
          repository: repo,
          ledger_ref: ref,
          record_type: "capability-canary",
          sequence: raceParentSequence + 1,
          pull_request: null,
          head_ref_oid: null,
          base_ref_oid: null,
          potential_merge_commit_oid: null,
          kind: null,
          effect_id: null,
          idempotency_key: null,
          predecessor_commit_sha: raceParent,
          server_observed_at: chain.post_ref.server_time,
          payload: {
            contender: label,
            genesis_commit_sha: genesisCommitSha,
            race_parent_commit_sha: raceParent,
            bootstrap_candidate_digest: bootstrapCandidate.input_digest,
            bootstrap_candidate: structuredClone(bootstrapCandidate),
          },
          control_comment_binding: null,
          lease: null,
          source_workflow: sourceWorkflow(bootstrapRelease),
          workflow_provenance: contenderProvenance.receipt,
          workflow_provenance_jwt: contenderProvenance.compact_jwt,
        });
        contenderObjects.push({
          label,
          objects: await createCommitObjects({
            fetchImpl,
            authorization,
            base,
            repoPath,
            envelope,
            parents: [raceParent],
            requestBudget,
          }),
        });
      }

      const raceResults = await Promise.all(contenderObjects.map(async (contender) => ({
        label: contender.label,
        commit_sha: contender.objects.commit_sha,
        ...(await raceUpdateRef({
          fetchImpl,
          authorization,
          base,
          repoPath,
          ref,
          refSuffix,
          shaValue: contender.objects.commit_sha,
          requestBudget,
        })),
      })));
      const winners = raceResults.filter((result) => result.outcome === "winner");
      const losers = raceResults.filter((result) => result.outcome === "non-fast-forward");
      if (winners.length !== 1 || losers.length !== 1) {
        throw ledgerError(
          "canary-race-invalid",
          "capability race did not produce exactly one winner and one non-fast-forward loser",
        );
      }
      const winner = winners[0];
      const raceFinal = await readRef({
        fetchImpl,
        authorization,
        base,
        repoPath,
        ref,
        refSuffix,
        requestBudget,
      });
      if (raceFinal.target_commit_sha !== winner.commit_sha) {
        throw ledgerError(
          "canary-race-reread-mismatch",
          "capability race final ref does not equal its unique winner",
        );
      }

      const writeObservation = sealWriteObservationReceipt({
        bootstrap_candidate_digest: bootstrapCandidate.input_digest,
        genesis: genesisWriteObservation,
        race_parent_commit_sha: raceParent,
        contenders: contenderObjects.map((contender) => ({
          label: contender.label,
          commit_sha: contender.objects.commit_sha,
          tree_sha: contender.objects.tree_sha,
          blob_sha: contender.objects.blob_sha,
          object_write_receipts: contender.objects.object_write_receipts,
        })).sort((left, right) => left.label.localeCompare(right.label)),
        race_results: raceResults.map(normalizeRaceAttestationResult)
          .sort((left, right) => left.label.localeCompare(right.label)),
        winner_commit_sha: winner.commit_sha,
        race_final_ref_reread: refReceipt(raceFinal),
      });
      capability = validateV2GitLedgerCapabilityReceipt(
        sealCapabilityFromBootstrap(bootstrapCandidate, writeObservation),
        { repository: repo, ledger_ref: ref },
      );

      const raceProvenance = await obtainWorkflowProvenance({
        verifyWorkflowProvenance,
        operation: "bootstrap-race",
        repository: repo,
        ledgerRef: ref,
        predecessorCommitSha: winner.commit_sha,
        protectionReceiptDigest:
          capability.protection.live_ruleset_receipt_digest,
        source: sourceWorkflow(capability.controller_release),
        effectScope: null,
        recordIdentity: null,
        serverTime: raceFinal.server_time,
        policy: capability.workflow_provenance_policy,
        provenanceBudget,
      });
      assertUnusedProvenanceJti(consumedJtis, raceProvenance.receipt);

      const attestationEnvelope = sealEnvelope({
        repository: repo,
        ledger_ref: ref,
        record_type: "capability-attestation",
        sequence: raceParentSequence + 2,
        pull_request: null,
        head_ref_oid: null,
        base_ref_oid: null,
        potential_merge_commit_oid: null,
        kind: null,
        effect_id: null,
        idempotency_key: null,
        predecessor_commit_sha: winner.commit_sha,
        server_observed_at: raceFinal.server_time,
        payload: {
          genesis_commit_sha: genesisCommitSha,
          race_parent_commit_sha: raceParent,
          bootstrap_candidate_digest: bootstrapCandidate.input_digest,
          write_observation_receipt: writeObservation,
          capability_input_digest: capabilityBindingDigest(capability),
          capability_stable_digest: stableCapabilityBindingDigest(capability),
          capability_receipt: structuredClone(capability),
          protection_receipt_digest:
            capability.protection.live_ruleset_receipt_digest,
          controller_release: structuredClone(capability.controller_release),
          contenders: raceResults
            .map(normalizeRaceAttestationResult)
            .sort((left, right) => left.label.localeCompare(right.label)),
          winner_commit_sha: winner.commit_sha,
          race_final_ref_reread: refReceipt(raceFinal),
          recovered_unattested_canary_commits: priorUnattestedCanaries,
        },
        control_comment_binding: null,
        lease: null,
        source_workflow: sourceWorkflow(capability.controller_release),
        workflow_provenance: raceProvenance.receipt,
        workflow_provenance_jwt: raceProvenance.compact_jwt,
      });
      const attestationObjects = await createCommitObjects({
        fetchImpl,
        authorization,
        base,
        repoPath,
        envelope: attestationEnvelope,
        parents: [winner.commit_sha],
        requestBudget,
      });
      const attestationUpdate = await updateRefStrict({
        fetchImpl,
        authorization,
        base,
        repoPath,
        ref,
        refSuffix,
        shaValue: attestationObjects.commit_sha,
        requestBudget,
      });
      const attestationExact = await readRef({
        fetchImpl,
        authorization,
        base,
        repoPath,
        ref,
        refSuffix,
        requestBudget,
      });
      if (attestationExact.target_commit_sha !== attestationObjects.commit_sha) {
        throw ledgerError(
          "ref-reread-mismatch",
          "capability attestation ref reread does not equal its commit",
        );
      }
      const attestationReceipt = sealAppendReceipt({
        repository: repo,
        ledger_ref: ref,
        record_type: "capability-attestation",
        sequence: attestationEnvelope.sequence,
        predecessor_commit_sha: winner.commit_sha,
        commit_sha: attestationObjects.commit_sha,
        tree_sha: attestationObjects.tree_sha,
        blob_sha: attestationObjects.blob_sha,
        server_observed_at: attestationEnvelope.server_observed_at,
        payload_digest: attestationEnvelope.payload_digest,
        ref_update: captureReceipt(attestationUpdate),
        ref_reread: refReceipt(attestationExact),
        capability_attestation_commit_sha: attestationObjects.commit_sha,
        protection_receipt_digest:
          capability.protection.live_ruleset_receipt_digest,
        stable: true,
      });

      const final = await api.load();
      if (final.tip_commit_sha !== attestationObjects.commit_sha) {
        throw ledgerError(
          "bootstrap-final-mismatch",
          "capability bootstrap final stable load differs from its attestation",
        );
      }
      const bootstrapReceipt = sealBootstrapReceipt({
        repository: repo,
        ledger_ref: ref,
        genesis_commit_sha: genesisCommitSha,
        genesis_receipt: genesisReceipt,
        race_parent_commit_sha: raceParent,
        contenders: raceResults.map(normalizeRaceAttestationResult)
          .sort((left, right) => left.label.localeCompare(right.label)),
        winner_commit_sha: winner.commit_sha,
        race_final_ref_reread: refReceipt(raceFinal),
        attestation_receipt: attestationReceipt,
        capability_attestation_commit_sha: attestationObjects.commit_sha,
        protection_receipt_digest:
          capability.protection.live_ruleset_receipt_digest,
        already_current: false,
        stable: true,
      });
      return deepFreeze({
        bootstrap_receipt: bootstrapReceipt,
        sealed_capability_receipt: capability,
      });
    },

    async appendRecord(record, {
      evaluated_scope_receipt = null,
      initial_runner_state_authority = null,
      established_runner_state_authority = null,
    } = {}) {
      if (capability === null) {
        throw ledgerError(
          "capability-attestation-required",
          "production append is unavailable before bootstrap seals capability",
        );
      }
      const normalized = validateV2GitLedgerRecord(record);
      const evaluatedScopeReceipt = validateV2GitLedgerEvaluatedScopeReceipt(
        evaluated_scope_receipt,
        {
          repository: repo,
          scope: recordScope(normalized),
        },
      );
      validateFactoryEvaluatedScopeHandle({
        raw_receipt: evaluated_scope_receipt,
        receipt: evaluatedScopeReceipt,
        record: normalized,
        provider_pre_scope_receipts: providerPreScopeReceipts,
        full_scope_receipts: fullScopeReceipts,
        provider_full_scope_receipts: providerFullScopeReceipts,
        manual_scope_receipts: manualScopeReceipts,
        evaluated_scope_receipts: evaluatedScopeReceipts,
      });
      validateCandidateEvaluatedScopeBinding(
        normalized,
        evaluatedScopeReceipt,
      );
      const loaded = await api.load();
      const requestBudget = createRequestBudget();
      const provenanceBudget = createVerifierBudget();
      if (normalized.predecessor_commit_sha !== loaded.tip_commit_sha) {
        throw ledgerError(
          "stale-predecessor",
          "append predecessor is not the exact stable ledger tip",
        );
      }
      validateEvaluatedScopeAuthorityForAppend(
        loaded.records,
        normalized,
        evaluatedScopeReceipt,
        repo,
      );
      requireCommitCapacity(loaded.records.length, 1, "production append");
      const writeFence = await readRef({
        fetchImpl,
        authorization,
        base,
        repoPath,
        ref,
        refSuffix,
        requestBudget,
      });
      if (writeFence.target_commit_sha !== loaded.tip_commit_sha) {
        throw ledgerError(
          "stale-predecessor",
          "append predecessor changed before the final pre-write fence",
        );
      }
      const authoritativeRecord = authoritativeRecordTime(
        normalized,
        writeFence.server_time,
      );
      validateProductionTransition(
        loaded,
        authoritativeRecord,
        repo,
        evaluatedScopeReceipt,
      );
      const initialAuthorityAdmission =
        validateInitialRunnerStateAppendAdmission({
          raw_handle: initial_runner_state_authority,
          local_handles: initialRunnerStateAuthorityHandles,
          consumed_handles: consumedInitialRunnerStateAuthorities,
          record: authoritativeRecord,
          evaluated_scope_receipt,
          loaded,
          write_fence: writeFence,
        });
      const establishedAuthorityAdmission =
        validateEstablishedRunnerStateAppendAdmission({
          raw_handle: established_runner_state_authority,
          local_handles: establishedRunnerStateAuthorityHandles,
          consumed_handles: consumedEstablishedRunnerStateAuthorities,
          record: authoritativeRecord,
          evaluated_scope_receipt,
          loaded,
          write_fence: writeFence,
        });
      requireLeaseWriteWindow(
        authoritativeRecord,
        loaded.active_lease,
        writeFence.server_time,
      );
      const provenance = await obtainWorkflowProvenance({
        verifyWorkflowProvenance,
        operation: normalized.record_type,
        repository: repo,
        ledgerRef: ref,
        predecessorCommitSha: loaded.tip_commit_sha,
        protectionReceiptDigest:
          capability.protection.live_ruleset_receipt_digest,
        source: sourceWorkflow(capability.controller_release),
        effectScope: recordScope(normalized),
        evaluatedScopeReceipt,
        recordIdentity: productionRecordIdentity(authoritativeRecord),
        serverTime: writeFence.server_time,
        policy: capability.workflow_provenance_policy,
        provenanceBudget,
      });
      assertUnusedProvenanceJti(
        new Set(loaded.records.map((entry) =>
          provenanceReplayIdentity(entry.envelope.workflow_provenance))),
        provenance.receipt,
      );
      if (initialAuthorityAdmission !== null) {
        if (consumedInitialRunnerStateAuthorities.has(initialAuthorityAdmission)) {
          throw ledgerError(
            "initial-runner-authority-replayed",
            "initial runner authority is already consumed",
          );
        }
        consumedInitialRunnerStateAuthorities.add(initialAuthorityAdmission);
      }
      if (establishedAuthorityAdmission !== null) {
        if (consumedEstablishedRunnerStateAuthorities.has(
          establishedAuthorityAdmission,
        )) {
          throw ledgerError(
            "established-runner-authority-replayed",
            "established runner authority is already consumed",
          );
        }
        consumedEstablishedRunnerStateAuthorities.add(
          establishedAuthorityAdmission,
        );
      }
      const envelope = sealEnvelope({
        repository: repo,
        ledger_ref: ref,
        record_type: normalized.record_type,
        sequence: loaded.records.at(-1).envelope.sequence + 1,
        pull_request: normalized.pull_request,
        head_ref_oid: normalized.head_ref_oid,
        base_ref_oid: normalized.base_ref_oid,
        potential_merge_commit_oid: normalized.potential_merge_commit_oid,
        kind: normalized.kind,
        effect_id: normalized.effect_id,
        idempotency_key: normalized.idempotency_key,
        predecessor_commit_sha: normalized.predecessor_commit_sha,
        server_observed_at: authoritativeRecord.server_observed_at,
        payload: authoritativeRecord.payload,
        control_comment_binding: authoritativeRecord.control_comment_binding,
        lease: authoritativeRecord.lease,
        source_workflow: sourceWorkflow(capability.controller_release),
        workflow_provenance: provenance.receipt,
        workflow_provenance_jwt: provenance.compact_jwt,
      });
      const objects = await createCommitObjects({
        fetchImpl,
        authorization,
        base,
        repoPath,
        envelope,
        parents: [loaded.tip_commit_sha],
        requestBudget,
      });
      const refUpdate = await updateRefStrict({
        fetchImpl,
        authorization,
        base,
        repoPath,
        ref,
        refSuffix,
        shaValue: objects.commit_sha,
        requestBudget,
      });
      const exact = await readRef({
        fetchImpl,
        authorization,
        base,
        repoPath,
        ref,
        refSuffix,
        requestBudget,
      });
      if (exact.target_commit_sha !== objects.commit_sha) {
        throw ledgerError(
          "ref-reread-mismatch",
          "append ref reread does not equal the new commit",
        );
      }
      return sealAppendReceipt({
        repository: repo,
        ledger_ref: ref,
        record_type: envelope.record_type,
        sequence: envelope.sequence,
        predecessor_commit_sha: loaded.tip_commit_sha,
        commit_sha: objects.commit_sha,
        tree_sha: objects.tree_sha,
        blob_sha: objects.blob_sha,
        server_observed_at: envelope.server_observed_at,
        payload_digest: envelope.payload_digest,
        ref_update: captureReceipt(refUpdate),
        ref_reread: refReceipt(exact),
        capability_attestation_commit_sha:
          loaded.capability.attestation_commit_sha,
        protection_receipt_digest:
          capability.protection.live_ruleset_receipt_digest,
        stable: true,
      });
    },

    async append(record, authority = {}) {
      return api.appendRecord(record, authority);
    },

    async appendEffectIntent(input, authority = {}) {
      return api.appendRecord(
        createV2GitLedgerEffectIntentRecord(input),
        authority,
      );
    },

    async appendEffectResponse(input, authority = {}) {
      return api.appendRecord(
        createV2GitLedgerEffectResponseRecord(input),
        authority,
      );
    },

    async appendCandidateInventory({
      predecessor_commit_sha,
      owner,
      server_observed_at,
      payload,
      trigger_identity,
      repository_endpoint_receipt,
    }) {
      const record = createV2GitLedgerCandidateInventoryRecord({
        predecessor_commit_sha,
        owner,
        server_observed_at,
        payload,
      });
      const evaluatedScopeReceipt =
        createV2GitLedgerCandidateInventoryEvaluatedScopeReceipt({
          repository: repo,
          payload,
          trigger_identity,
          repository_endpoint_receipt,
        });
      return api.appendRecord(record, {
        evaluated_scope_receipt: evaluatedScopeReceipt,
      });
    },

    async acquireLease(input, authority = {}) {
      const value = normalizeLeaseAcquireInput(input);
      const record = sealRecord({
        record_type: "lease-acquire",
        predecessor_commit_sha: value.predecessor_commit_sha,
        pull_request: value.pull_request,
        head_ref_oid: value.head_ref_oid,
        base_ref_oid: value.base_ref_oid,
        potential_merge_commit_oid: value.potential_merge_commit_oid,
        kind: null,
        effect_id: null,
        idempotency_key: null,
        server_observed_at: value.observed_at,
        payload: {
          lease_id: value.lease_id,
          owner: value.owner,
          acquired_at: value.observed_at,
          expires_at: addSeconds(value.observed_at, value.lease_ttl_seconds),
          lease_ttl_seconds: value.lease_ttl_seconds,
        },
        control_comment_binding: value.control_comment_binding,
        lease: null,
      });
      const appendReceipt = await api.appendRecord(record, authority);
      const exact = await api.load();
      const acquireRecord = exact.records.find((entry) =>
        entry.commit_sha === appendReceipt.commit_sha);
      if (acquireRecord?.envelope.record_type !== "lease-acquire") {
        throw ledgerError(
          "lease-acquire-reread",
          "lease acquire commit is absent from the exact stable ledger reread",
        );
      }
      const acquiredAt = acquireRecord.envelope.payload.acquired_at;
      const expiresAt = acquireRecord.envelope.payload.expires_at;
      const withoutDigest = {
        schema: V2_GIT_LEDGER_LEASE_RECEIPT_SCHEMA,
        schema_version: 1,
        repository: repo,
        ledger_ref: ref,
        lease_id: value.lease_id,
        owner: value.owner,
        acquire_commit_sha: appendReceipt.commit_sha,
        acquired_at: acquiredAt,
        expires_at: expiresAt,
        scope: {
          pull_request: value.pull_request,
          head_ref_oid: value.head_ref_oid,
          base_ref_oid: value.base_ref_oid,
          potential_merge_commit_oid: value.potential_merge_commit_oid,
        },
        append_receipt_digest: appendReceipt.receipt_digest,
      };
      return deepFreeze({
        ...withoutDigest,
        receipt_digest: digestCanonical(
          "codex-review-gate-v2-git-ledger-lease-receipt",
          withoutDigest,
        ),
      });
    },

    async releaseLease({
      predecessor_commit_sha,
      lease_receipt,
      released_at,
      control_comment_binding = null,
    }, authority = {}) {
      const leaseReceipt = validateLeaseReceipt(lease_receipt, repo, ref);
      const at = timestamp(released_at, "released_at");
      const record = sealRecord({
        record_type: "lease-release",
        predecessor_commit_sha: sha(predecessor_commit_sha, "predecessor_commit_sha"),
        pull_request: leaseReceipt.scope.pull_request,
        head_ref_oid: leaseReceipt.scope.head_ref_oid,
        base_ref_oid: leaseReceipt.scope.base_ref_oid,
        potential_merge_commit_oid:
          leaseReceipt.scope.potential_merge_commit_oid,
        kind: null,
        effect_id: null,
        idempotency_key: null,
        server_observed_at: at,
        payload: {
          lease_id: leaseReceipt.lease_id,
          owner: leaseReceipt.owner,
          acquire_commit_sha: leaseReceipt.acquire_commit_sha,
          released_at: at,
        },
        control_comment_binding:
          normalizeControlCommentBinding(control_comment_binding),
        lease: leaseBindingFromReceipt(leaseReceipt),
      });
      const appendReceipt = await api.appendRecord(record, authority);
      leaseReleaseReceipts.set(appendReceipt, deepFreeze({
        lease_receipt: lease_receipt,
        evaluated_scope_receipt:
          authority.evaluated_scope_receipt ?? null,
        scope: structuredClone(leaseReceipt.scope),
        release_record: record,
      }));
      return appendReceipt;
    },
  });

  if (_bootstrapAuthority === BOOTSTRAP_AUTHORITY) return api;
  const {
    bootstrapCapability: _bootstrapCapability,
    ...productionApi
  } = api;
  return Object.freeze(productionApi);
}

/**
 * Restricted install-time state. It cannot load or append production records.
 * The only successful transition seals one active production capability after
 * genesis, the live sibling race, and a reachable OIDC-bound attestation.
 */
export function createV2GitHubGitLedgerBootstrap({
  fetch: fetchImpl,
  token,
  repository,
  ledgerRef,
  restBaseUrl = "https://api.github.com",
  bootstrapCapabilityInput,
  preflightHandle = null,
  verifyWorkflowProvenance,
  httpLimits = V2_GIT_LEDGER_HTTP_LIMITS,
  provenanceTimeoutMs = V2_GIT_LEDGER_PROVENANCE_TIMEOUT_MS,
}) {
  const repo = normalizeRepository(repository);
  const ref = normalizeLedgerRef(ledgerRef);
  const input = validateV2GitLedgerBootstrapInput(bootstrapCapabilityInput, {
    repository: repo,
    ledger_ref: ref,
  });
  if (typeof verifyWorkflowProvenance !== "function") {
    throw new TypeError("Git ledger bootstrap requires verifyWorkflowProvenance");
  }
  return deepFreeze({
    async bootstrapCapability() {
      const ledger = createV2GitHubGitLedger({
        fetch: fetchImpl,
        token,
        repository: repo,
        ledgerRef: ref,
        restBaseUrl,
        capabilityReceipt: null,
        preflightHandle,
        verifyWorkflowProvenance,
        httpLimits,
        provenanceTimeoutMs,
        _bootstrapAuthority: BOOTSTRAP_AUTHORITY,
        _bootstrapInput: input,
      });
      const result = await ledger.bootstrapCapability();
      const bootstrapReceipt = result.bootstrap_receipt;
      const sealedCapability = result.sealed_capability_receipt;
      if (
        bootstrapReceipt.stable !== true ||
        bootstrapReceipt.capability_attestation_commit_sha === null
      ) {
        throw ledgerError(
          "bootstrap-not-active",
          "restricted bootstrap did not produce one stable reachable attestation",
        );
      }
      const productionLedger = createV2GitHubGitLedger({
        fetch: fetchImpl,
        token,
        repository: repo,
        ledgerRef: ref,
        restBaseUrl,
        capabilityReceipt: sealedCapability,
        preflightHandle,
        verifyWorkflowProvenance,
        httpLimits,
        provenanceTimeoutMs,
      });
      return deepFreeze({
        bootstrap_receipt: bootstrapReceipt,
        sealed_capability_receipt: sealedCapability,
        ledger: productionLedger,
      });
    },
  });
}

export function validateV2GitLedgerBootstrapInput(value, expected = null) {
  assertObject(value, "bootstrapCapabilityInput");
  exactKeys(value, [
    "schema", "schema_version", "sealed", "bootstrap_eligible",
    "current_attestation", "repository", "repository_endpoint_receipt",
    "ledger_ref", "permissions",
    "protection", "ruleset_receipt", "protection_receipt",
    "controller_release", "workflow_provenance_policy",
    "provider_identity_policy", "observed_at",
    "input_digest",
  ], "bootstrapCapabilityInput");
  if (
    value.schema !== V2_GIT_LEDGER_BOOTSTRAP_INPUT_SCHEMA ||
    value.schema_version !== 1 || value.sealed !== false ||
    value.bootstrap_eligible !== true || value.current_attestation !== false
  ) {
    throw new Error("Git ledger bootstrap input is not eligible or is already active");
  }
  const repository = normalizeRepository(value.repository);
  const repositoryEndpointReceipt = normalizeRepositoryEndpointReceipt(
    value.repository_endpoint_receipt,
    repository,
  );
  const ledgerRef = normalizeLedgerRef(value.ledger_ref);
  assertObject(value.permissions, "bootstrapCapabilityInput.permissions");
  exactKeys(value.permissions, [
    "contents_write_requested", "metadata_read_observed", "observed_only",
    "observation_receipt_digest",
  ], "bootstrapCapabilityInput.permissions");
  if (
    value.permissions.contents_write_requested !== true ||
    value.permissions.metadata_read_observed !== true ||
    value.permissions.observed_only !== true
  ) {
    throw new Error("Git ledger bootstrap requires requested contents:write");
  }
  digest(value.permissions.observation_receipt_digest,
    "bootstrapCapabilityInput.permissions.observation_receipt_digest");
  const release = normalizeControllerRelease(value.controller_release);
  const policy = normalizeProvenancePolicy(value.workflow_provenance_policy);
  const providerIdentityPolicy = normalizeProviderIdentityPolicy(
    value.provider_identity_policy,
  );
  if (policy.repository_owner_id !== repository.owner_id) {
    throw new Error("Git ledger bootstrap OIDC owner differs from repository");
  }
  validateProtectionPolicy(value.protection);
  const ruleset = normalizeLedgerRulesetReceipt(
    value.ruleset_receipt,
    repository,
    ledgerRef,
  );
  const protectionReceipt = normalizeLedgerProtectionReceipt(
    value.protection_receipt,
    ruleset,
  );
  validateProtectionBindings(
    value.protection,
    ruleset,
    protectionReceipt,
    release,
  );
  timestamp(value.observed_at, "bootstrapCapabilityInput.observed_at");
  if (expected !== null && (
    canonicalJson(repository) !== canonicalJson(expected.repository) ||
    ledgerRef !== expected.ledger_ref
  )) {
    throw new Error("Git ledger bootstrap candidate binds another repository or ref");
  }
  digest(value.input_digest, "bootstrapCapabilityInput.input_digest");
  const { input_digest: _inputDigest, ...withoutDigest } = value;
  if (digestCanonical("codex-review-gate-v2-git-ledger-bootstrap-input",
    withoutDigest) !== value.input_digest) {
    throw new Error("Git ledger bootstrap input digest is invalid");
  }
  return deepFreeze({
    ...structuredClone(value),
    repository,
    repository_endpoint_receipt: repositoryEndpointReceipt,
    ledger_ref: ledgerRef,
    controller_release: release,
    workflow_provenance_policy: policy,
    provider_identity_policy: providerIdentityPolicy,
    ruleset_receipt: ruleset,
    protection_receipt: protectionReceipt,
  });
}

function sealCapabilityFromBootstrap(input, writeObservation) {
  return sealCapabilityValue({
    schema: V2_GIT_LEDGER_CAPABILITY_SCHEMA,
    schema_version: 1,
    feature_enabled: true,
    repository: structuredClone(input.repository),
    repository_endpoint_receipt:
      structuredClone(input.repository_endpoint_receipt),
    ledger_ref: input.ledger_ref,
    bootstrap_candidate_digest: input.input_digest,
    permissions: {
      contents_write_observed: true,
      metadata_read_observed: input.permissions.metadata_read_observed,
      observed_only: true,
      observation_receipt_digest: writeObservation.receipt_digest,
    },
    protection: structuredClone(input.protection),
    ruleset_receipt: structuredClone(input.ruleset_receipt),
    protection_receipt: structuredClone(input.protection_receipt),
    controller_release: structuredClone(input.controller_release),
    workflow_provenance_policy:
      structuredClone(input.workflow_provenance_policy),
    provider_identity_policy:
      structuredClone(input.provider_identity_policy),
    observed_at: input.observed_at,
  });
}

function sealCapabilityValue(value) {
  return {
    ...value,
    receipt_digest: digestCanonical(
      "codex-review-gate-v2-git-ledger-capability",
      value,
    ),
  };
}

export function validateV2GitLedgerCapabilityReceipt(value, expected = null) {
  assertObject(value, "capabilityReceipt");
  exactKeys(value, [
    "schema",
    "schema_version",
    "feature_enabled",
    "repository",
    "repository_endpoint_receipt",
    "ledger_ref",
    "bootstrap_candidate_digest",
    "permissions",
    "protection",
    "ruleset_receipt",
    "protection_receipt",
    "controller_release",
    "workflow_provenance_policy",
    "provider_identity_policy",
    "observed_at",
    "receipt_digest",
  ], "capabilityReceipt");
  if (
    value.schema !== V2_GIT_LEDGER_CAPABILITY_SCHEMA ||
    value.schema_version !== 1 || value.feature_enabled !== true
  ) {
    throw new Error("Git ledger capability is absent, disabled, or unsupported");
  }
  const repository = normalizeRepository(value.repository);
  const repositoryEndpointReceipt = normalizeRepositoryEndpointReceipt(
    value.repository_endpoint_receipt,
    repository,
  );
  const ledgerRef = normalizeLedgerRef(value.ledger_ref);
  digest(value.bootstrap_candidate_digest,
    "capabilityReceipt.bootstrap_candidate_digest");
  assertObject(value.permissions, "capabilityReceipt.permissions");
  exactKeys(value.permissions, [
    "contents_write_observed",
    "metadata_read_observed",
    "observed_only",
    "observation_receipt_digest",
  ], "capabilityReceipt.permissions");
  if (
    value.permissions.contents_write_observed !== true ||
    value.permissions.metadata_read_observed !== true ||
    value.permissions.observed_only !== true
  ) {
    throw new Error("Git ledger requires observed contents:write capability");
  }
  digest(
    value.permissions.observation_receipt_digest,
    "capabilityReceipt.permissions.observation_receipt_digest",
  );
  assertObject(value.protection, "capabilityReceipt.protection");
  exactKeys(value.protection, [
    "deletion_blocked",
    "non_fast_forward_blocked",
    "force_pushes_blocked",
    "live_ruleset_receipt_digest",
    "source_workflow_pin",
    "accepted_records_restricted_by_oidc_source",
  ], "capabilityReceipt.protection");
  if (
    value.protection.deletion_blocked !== true ||
    value.protection.non_fast_forward_blocked !== true ||
    value.protection.force_pushes_blocked !== true ||
    value.protection.accepted_records_restricted_by_oidc_source !== true
  ) {
    throw new Error("Git ledger ref protection is incomplete");
  }
  digest(
    value.protection.live_ruleset_receipt_digest,
    "capabilityReceipt.protection.live_ruleset_receipt_digest",
  );
  const release = normalizeControllerRelease(value.controller_release);
  const provenancePolicy = normalizeProvenancePolicy(
    value.workflow_provenance_policy,
  );
  const providerIdentityPolicy = normalizeProviderIdentityPolicy(
    value.provider_identity_policy,
  );
  if (provenancePolicy.repository_owner_id !== repository.owner_id) {
    throw new Error(
      "Git ledger OIDC policy owner differs from the repository API authority",
    );
  }
  const rulesetReceipt = normalizeLedgerRulesetReceipt(
    value.ruleset_receipt,
    repository,
    ledgerRef,
  );
  const protectionReceipt = normalizeLedgerProtectionReceipt(
    value.protection_receipt,
    rulesetReceipt,
  );
  const sourcePin = normalizeSourceWorkflow(
    value.protection.source_workflow_pin,
    "capabilityReceipt.protection.source_workflow_pin",
  );
  if (
    canonicalJson(sourcePin) !== canonicalJson(sourceWorkflow(release))
  ) {
    throw new Error(
      "Git ledger protection does not exact-pin the current source workflow",
    );
  }
  if (
    value.protection.live_ruleset_receipt_digest !==
      rulesetReceipt.receipt_digest ||
    protectionReceipt.protection_digest !==
      value.protection.live_ruleset_receipt_digest ||
    protectionReceipt.deletion_blocked !== value.protection.deletion_blocked ||
    protectionReceipt.non_fast_forward_blocked !==
      value.protection.non_fast_forward_blocked
  ) {
    throw new Error(
      "Git ledger capability protection receipts do not bind the live ruleset",
    );
  }
  const observedAt = timestamp(value.observed_at, "capabilityReceipt.observed_at");
  digest(value.receipt_digest, "capabilityReceipt.receipt_digest");
  const { receipt_digest: _digest, ...withoutDigest } = value;
  const expectedDigest = digestCanonical(
    "codex-review-gate-v2-git-ledger-capability",
    withoutDigest,
  );
  if (expectedDigest !== value.receipt_digest) {
    throw new Error("Git ledger capability receipt digest is invalid");
  }
  const normalized = {
    ...structuredClone(value),
    repository,
    repository_endpoint_receipt: repositoryEndpointReceipt,
    ledger_ref: ledgerRef,
    controller_release: release,
    ruleset_receipt: rulesetReceipt,
    protection_receipt: protectionReceipt,
    workflow_provenance_policy: provenancePolicy,
    provider_identity_policy: providerIdentityPolicy,
    observed_at: observedAt,
  };
  if (expected !== null) {
    if (
      canonicalJson(repository) !== canonicalJson(expected.repository) ||
      ledgerRef !== expected.ledger_ref
    ) {
      throw new Error("Git ledger capability does not bind this repository and ref");
    }
  }
  return deepFreeze(normalized);
}

function validateProtectionPolicy(value) {
  assertObject(value, "capability protection");
  exactKeys(value, [
    "deletion_blocked", "non_fast_forward_blocked",
    "force_pushes_blocked", "live_ruleset_receipt_digest",
    "source_workflow_pin", "accepted_records_restricted_by_oidc_source",
  ], "capability protection");
  if (
    value.deletion_blocked !== true ||
    value.non_fast_forward_blocked !== true ||
    value.force_pushes_blocked !== true ||
    value.accepted_records_restricted_by_oidc_source !== true
  ) {
    throw new Error("Git ledger ref protection is incomplete");
  }
  digest(value.live_ruleset_receipt_digest,
    "capability protection.live_ruleset_receipt_digest");
}

function validateProtectionBindings(
  protection,
  rulesetReceipt,
  protectionReceipt,
  release,
) {
  const sourcePin = normalizeSourceWorkflow(
    protection.source_workflow_pin,
    "capability protection.source_workflow_pin",
  );
  if (canonicalJson(sourcePin) !== canonicalJson(sourceWorkflow(release))) {
    throw new Error("Git ledger protection does not exact-pin the current source workflow");
  }
  if (
    protection.live_ruleset_receipt_digest !== rulesetReceipt.receipt_digest ||
    protectionReceipt.protection_digest !==
      protection.live_ruleset_receipt_digest ||
    protectionReceipt.deletion_blocked !== protection.deletion_blocked ||
    protectionReceipt.non_fast_forward_blocked !==
      protection.non_fast_forward_blocked
  ) {
    throw new Error("Git ledger capability protection receipts do not bind the live ruleset");
  }
}

export function validateV2GitLedgerProvenanceReceipt(
  value,
  { request = null, policy = null } = {},
) {
  assertObject(value, "workflow provenance receipt");
  exactKeys(value, [
    "schema", "schema_version", "verified", "signature_verified",
    "jwks_verified", "live_supported", "issuer", "audience", "algorithm",
    "key_id", "claims", "token_sha256", "discovery", "jwks",
    "verified_at_server_time", "replay_prevention_receipt_digest",
    "operation_binding", "receipt_digest",
  ], "workflow provenance receipt");
  if (
    value.schema !== V2_GIT_LEDGER_PROVENANCE_RECEIPT_SCHEMA ||
    value.schema_version !== 1 || value.verified !== true ||
    value.signature_verified !== true || value.jwks_verified !== true ||
    value.live_supported !== true
  ) {
    throw new Error("workflow provenance is not live, verified, and signature-bound");
  }
  if (
    value.issuer !== "https://token.actions.githubusercontent.com" ||
    value.algorithm !== "RS256"
  ) {
    throw new Error("workflow provenance issuer, audience, or algorithm is unsupported");
  }
  boundedString(value.audience, "workflow provenance audience", 512);
  boundedString(value.key_id, "workflow provenance key_id", 512);
  digest(value.token_sha256, "workflow provenance token_sha256");
  digest(
    value.replay_prevention_receipt_digest,
    "workflow provenance replay_prevention_receipt_digest",
  );
  const claims = normalizeOidcClaims(value.claims);
  const verifiedAt = timestamp(
    value.verified_at_server_time,
    "workflow provenance verified_at_server_time",
  );
  if (
    claims.iss !== value.issuer || claims.aud !== value.audience ||
    Date.parse(verifiedAt) < claims.nbf * 1000 ||
    Date.parse(verifiedAt) > claims.exp * 1000 ||
    claims.iat * 1000 > Date.parse(verifiedAt) ||
    claims.iat > claims.exp || claims.nbf > claims.exp
  ) {
    throw new Error("workflow provenance claims are outside their verified server-time window");
  }
  const discovery = normalizeOidcDiscoveryReceipt(value.discovery);
  const jwks = normalizeOidcJwksReceipt(value.jwks);
  const binding = normalizeProvenanceOperationBinding(value.operation_binding);
  digest(value.receipt_digest, "workflow provenance receipt_digest");
  const { receipt_digest: _digest, ...withoutDigest } = value;
  if (digestCanonical("codex-review-gate-v2-git-ledger-provenance", withoutDigest) !==
      value.receipt_digest) {
    throw new Error("workflow provenance receipt digest is invalid");
  }
  const effectivePolicy = policy === null ? null : normalizeProvenancePolicy(policy);
  if (effectivePolicy !== null) {
    validateProvenanceAgainstPolicy({
      value,
      claims,
      discovery,
      jwks,
      policy: effectivePolicy,
    });
  }
  if (request !== null) {
    const normalizedRequest = validateProvenanceRequest(request);
    if (
      canonicalJson(binding) !== canonicalJson(operationBinding(normalizedRequest)) ||
      value.audience !== normalizedRequest.audience ||
      verifiedAt !== normalizedRequest.github_server_time ||
      claims.repository_id !== normalizedRequest.repository.id ||
      claims.repository !==
        `${normalizedRequest.repository.owner}/${normalizedRequest.repository.name}` ||
      claims.workflow_ref !== normalizedRequest.source_workflow.workflow_ref ||
      claims.workflow_sha !== normalizedRequest.source_workflow.workflow_sha ||
      claims.job_workflow_ref !==
        normalizedRequest.source_workflow.job_workflow_ref ||
      claims.job_workflow_sha !==
        normalizedRequest.source_workflow.job_workflow_sha
    ) {
      throw new Error("workflow provenance does not bind the exact operation and source");
    }
    validateTriggerIdentityAgainstClaims(
      normalizedRequest.evaluated_scope_receipt,
      claims,
    );
    validateOidcEffectScopeRelation(claims, normalizedRequest.effect_scope);
  }
  return deepFreeze(structuredClone(value));
}

function normalizeProvenancePolicy(value) {
  assertObject(value, "workflow_provenance_policy");
  exactKeys(value, [
    "issuer", "audience", "discovery_url", "jwks_uri", "algorithm",
    "required_claims", "claims_supported",
    "repository_owner_id", "subject_pattern", "subject_pattern_digest",
    "subject_policy_receipt_digest", "execution_policy_receipt_digest",
    "replay_registry_policy_receipt_digest", "fork_pull_requests_api_only",
    "candidate_code_execution_blocked", "allowed_event_names", "allowed_refs",
  ], "workflow_provenance_policy");
  if (
    value.issuer !== "https://token.actions.githubusercontent.com" ||
    value.discovery_url !==
      "https://token.actions.githubusercontent.com/.well-known/openid-configuration" ||
    value.jwks_uri !==
      "https://token.actions.githubusercontent.com/.well-known/jwks" ||
    value.algorithm !== "RS256"
  ) {
    throw new Error("workflow provenance policy does not bind GitHub OIDC RS256");
  }
  boundedString(value.audience, "workflow provenance policy audience", 512);
  if (value.audience !== V2_GIT_LEDGER_OIDC_AUDIENCE) {
    throw new Error("workflow provenance policy audience is not dedicated");
  }
  decimal(value.repository_owner_id,
    "workflow provenance policy repository_owner_id");
  boundedString(value.subject_pattern,
    "workflow provenance policy subject_pattern", 1024);
  digest(value.subject_pattern_digest,
    "workflow provenance policy subject_pattern_digest");
  digest(value.subject_policy_receipt_digest,
    "workflow provenance policy subject_policy_receipt_digest");
  digest(value.execution_policy_receipt_digest,
    "workflow provenance policy execution_policy_receipt_digest");
  digest(value.replay_registry_policy_receipt_digest,
    "workflow provenance policy replay_registry_policy_receipt_digest");
  if (
    value.fork_pull_requests_api_only !== true ||
    value.candidate_code_execution_blocked !== true
  ) {
    throw new Error(
      "workflow provenance policy does not block candidate-code execution",
    );
  }
  if (digestCanonical("codex-review-gate-v2-oidc-subject-pattern",
    value.subject_pattern) !== value.subject_pattern_digest) {
    throw new Error("workflow provenance subject pattern digest is invalid");
  }
  normalizeUniqueStringArray(
    value.allowed_event_names,
    "workflow provenance allowed_event_names",
  );
  normalizeUniqueStringArray(value.allowed_refs,
    "workflow provenance allowed_refs");
  const required = normalizeUniqueStringArray(
    value.required_claims,
    "workflow provenance required_claims",
  );
  const supported = normalizeUniqueStringArray(
    value.claims_supported,
    "workflow provenance claims_supported",
  );
  if (
    canonicalJson(required) !== canonicalJson([...V2_GIT_LEDGER_OIDC_CLAIMS].sort()) ||
    required.some((claim) => !supported.includes(claim))
  ) {
    throw new Error("live GitHub OIDC discovery does not support every required claim");
  }
  return deepFreeze(structuredClone(value));
}

export function digestV2GitLedgerPayload(payload) {
  validateCanonicalJsonValue(payload, "payload");
  return digestCanonical("codex-review-gate-v2-git-ledger-payload", payload);
}

export function createV2GitLedgerRecord(value) {
  return sealRecord(value);
}

export function createV2GitLedgerEffectIntentRecord({
  predecessor_commit_sha,
  scope: scopeValue,
  kind,
  effect_id,
  idempotency_key,
  server_observed_at,
  generation = null,
  ordinal = generation?.index ?? 1,
  action,
  control_comment_binding = null,
  lease_receipt,
}) {
  const predecessor = sha(
    predecessor_commit_sha,
    "effect intent predecessor_commit_sha",
  );
  const scope = normalizeEffectScope(scopeValue);
  if (scope === null) {
    throw new TypeError("effect intent builder requires one exact PR scope");
  }
  const lease = leaseBindingFromValue(lease_receipt);
  return createV2GitLedgerRecord({
    record_type: "effect-intent",
    predecessor_commit_sha: predecessor,
    pull_request: scope.pull_request,
    head_ref_oid: scope.head_ref_oid,
    base_ref_oid: scope.base_ref_oid,
    potential_merge_commit_oid: scope.potential_merge_commit_oid,
    kind,
    effect_id,
    idempotency_key,
    server_observed_at,
    payload: {
      schema: V2_GIT_LEDGER_EFFECT_PAYLOAD_SCHEMA,
      schema_version: 1,
      phase: "intent",
      kind,
      scope,
      generation,
      ordinal,
      predecessor_commit_sha: predecessor,
      action: structuredClone(action),
      intent_commit_sha: null,
      receipt: null,
    },
    control_comment_binding,
    lease,
  });
}

export function createV2GitLedgerEffectResponseRecord({
  intent_record,
  intent_commit_sha,
  server_observed_at,
  receipt,
  control_comment_binding = undefined,
}) {
  const intent = validateV2GitLedgerRecord(intent_record);
  if (intent.record_type !== "effect-intent") {
    throw new TypeError("effect response builder requires an exact intent record");
  }
  const intentCommit = sha(intent_commit_sha, "effect response intent_commit_sha");
  const control = control_comment_binding === undefined
    ? intent.control_comment_binding
    : control_comment_binding;
  return createV2GitLedgerRecord({
    record_type: "effect-response",
    predecessor_commit_sha: intentCommit,
    pull_request: intent.pull_request,
    head_ref_oid: intent.head_ref_oid,
    base_ref_oid: intent.base_ref_oid,
    potential_merge_commit_oid: intent.potential_merge_commit_oid,
    kind: intent.kind,
    effect_id: intent.effect_id,
    idempotency_key: intent.idempotency_key,
    server_observed_at,
    payload: {
      schema: V2_GIT_LEDGER_EFFECT_PAYLOAD_SCHEMA,
      schema_version: 1,
      phase: "response",
      kind: intent.kind,
      scope: structuredClone(intent.payload.scope),
      generation: structuredClone(intent.payload.generation),
      ordinal: intent.payload.ordinal,
      predecessor_commit_sha: intentCommit,
      action: structuredClone(intent.payload.action),
      intent_commit_sha: intentCommit,
      receipt: structuredClone(receipt),
    },
    control_comment_binding: control,
    lease: structuredClone(intent.lease),
  });
}

export function createV2GitLedgerEvaluatedScopeReceipt({
  relation,
  phase = relation === "scheduled-repository-inventory"
    ? "repository-inventory"
    : relation === "scheduled-repository-dispatch"
      ? "repository-dispatch"
    : "pre-scope",
  repository,
  scope,
  trigger_identity,
  selector = null,
  inventory_receipt = null,
  provider_artifact_receipt = null,
  provider_identity_authority = null,
  discovery_continuity_receipt = null,
  scope_endpoint_receipt,
}) {
  assertObject(trigger_identity, "evaluated scope trigger identity");
  exactKeys(trigger_identity, ["event_name", "ref", "sha"],
    "evaluated scope trigger identity");
  const withoutDigest = {
    schema: V2_GIT_LEDGER_EVALUATED_SCOPE_RECEIPT_SCHEMA,
    schema_version: 1,
    relation,
    phase,
    repository: structuredClone(repository),
    scope: structuredClone(scope),
    trigger_event_name: trigger_identity.event_name,
    trigger_ref: trigger_identity.ref,
    trigger_sha: trigger_identity.sha,
    selector: structuredClone(selector),
    inventory_receipt: structuredClone(inventory_receipt),
    provider_artifact_receipt: structuredClone(provider_artifact_receipt),
    provider_identity_authority:
      structuredClone(provider_identity_authority),
    discovery_continuity_receipt:
      structuredClone(discovery_continuity_receipt),
    scope_endpoint_receipt: structuredClone(scope_endpoint_receipt),
  };
  return validateV2GitLedgerEvaluatedScopeReceipt({
    ...withoutDigest,
    receipt_digest: digestCanonical(
      "codex-review-gate-v2-evaluated-scope-receipt",
      withoutDigest,
    ),
  });
}

export function createV2GitLedgerDiscoveryContinuityReceipt({
  repository,
  scope,
  pre_scope_receipt_digest,
  lease_receipt,
  discovery_snapshot,
  transport_limits,
  minimal_pre,
  minimal_post,
}) {
  const normalizedRepository = normalizeRepository(repository);
  const normalizedScope = normalizeEffectScope(scope);
  if (normalizedScope === null) {
    throw new TypeError("discovery continuity builder requires one PR scope");
  }
  const lease = normalizeDiscoveryContinuityLeaseReceipt(
    lease_receipt,
    normalizedScope,
  );
  const fullSnapshot = projectDiscoveryContinuityFullSnapshot(
    discovery_snapshot,
    transport_limits,
    normalizedRepository,
    normalizedScope,
  );
  const minimalPre = projectDiscoveryContinuityMinimalScope(
    minimal_pre,
    normalizedRepository,
    normalizedScope,
    "discovery continuity builder minimal pre",
  );
  const minimalPost = projectDiscoveryContinuityMinimalScope(
    minimal_post,
    normalizedRepository,
    normalizedScope,
    "discovery continuity builder minimal post",
  );
  const withoutDigest = {
    schema: V2_GIT_LEDGER_DISCOVERY_CONTINUITY_RECEIPT_SCHEMA,
    schema_version: 1,
    repository: structuredClone(normalizedRepository),
    scope: structuredClone(normalizedScope),
    pre_scope_receipt_digest,
    lease: structuredClone(lease),
    full_snapshot: fullSnapshot,
    minimal_pre: minimalPre,
    minimal_post: minimalPost,
    ordering: [
      "pre-scope",
      "lease-acquire",
      "full-discovery",
      "minimal-post",
    ],
    stable: true,
  };
  return validateV2GitLedgerDiscoveryContinuityReceipt({
    ...withoutDigest,
    continuity_receipt_digest: digestCanonical(
      "codex-review-gate-v2-git-ledger-discovery-continuity",
      withoutDigest,
    ),
  });
}

export function validateV2GitLedgerDiscoveryContinuityReceipt(
  value,
  {
    repository: repositoryValue = null,
    scope: scopeValue = null,
    pre_scope_receipt_digest: preScopeReceiptDigest = null,
    lease_receipt: leaseReceiptValue = null,
  } = {},
) {
  assertObject(value, "discovery continuity receipt");
  exactKeys(value, [
    "schema", "schema_version", "repository", "scope",
    "pre_scope_receipt_digest", "lease", "full_snapshot",
    "minimal_pre", "minimal_post", "ordering", "stable",
    "continuity_receipt_digest",
  ], "discovery continuity receipt");
  if (
    value.schema !== V2_GIT_LEDGER_DISCOVERY_CONTINUITY_RECEIPT_SCHEMA ||
    value.schema_version !== 1 || value.stable !== true
  ) {
    throw new Error("discovery continuity receipt schema is unsupported");
  }
  const repository = normalizeRepository(value.repository);
  const scope = normalizeEffectScope(value.scope);
  if (scope === null) {
    throw new TypeError("discovery continuity receipt requires one PR scope");
  }
  digest(value.pre_scope_receipt_digest,
    "discovery continuity pre_scope_receipt_digest");
  const lease = normalizeDiscoveryContinuityLease(value.lease, scope);
  const fullSnapshot = normalizeDiscoveryContinuityFullSnapshot(
    value.full_snapshot,
    repository,
    scope,
  );
  const minimalPre = normalizeDiscoveryContinuityMinimalScope(
    value.minimal_pre,
    repository,
    scope,
    "discovery continuity minimal pre",
  );
  const minimalPost = normalizeDiscoveryContinuityMinimalPost(
    value.minimal_post,
    repository,
    scope,
  );
  if (
    canonicalJson(value.ordering) !== canonicalJson([
      "pre-scope", "lease-acquire", "full-discovery", "minimal-post",
    ])
  ) {
    throw new Error("discovery continuity invocation order is not closed");
  }
  if (
    Date.parse(lease.acquired_at) < Date.parse(minimalPre.observed_at) ||
    Date.parse(fullSnapshot.scope_pre.scope_receipt.server_time) <
      Date.parse(lease.acquired_at) ||
    Date.parse(fullSnapshot.scope_post.scope_receipt.server_time) <
      Date.parse(fullSnapshot.scope_pre.scope_receipt.server_time) ||
    Date.parse(minimalPost.endpoint_receipts[0].server_time) <
      Date.parse(fullSnapshot.scope_post.scope_receipt.server_time) ||
    Date.parse(minimalPost.observed_at) <
      Date.parse(minimalPost.endpoint_receipts[0].server_time) ||
    canonicalJson(minimalScopeStableProjection(minimalPre)) !==
      canonicalJson(minimalScopeStableProjection(minimalPost)) ||
    canonicalJson(fullMinimalSharedProjection(
      fullSnapshot.scope_pre.scope_receipt,
    )) !== canonicalJson(fullMinimalSharedProjection(minimalPre)) ||
    canonicalJson(fullMinimalSharedProjection(
      fullSnapshot.scope_post.scope_receipt,
    )) !== canonicalJson(fullMinimalSharedProjection(minimalPost))
  ) {
    throw new Error("discovery continuity server time regressed");
  }
  if (
    repositoryValue !== null &&
    canonicalJson(repository) !==
      canonicalJson(normalizeRepository(repositoryValue))
  ) {
    throw new Error("discovery continuity belongs to another repository");
  }
  if (
    scopeValue !== null &&
    canonicalJson(scope) !== canonicalJson(normalizeEffectScope(scopeValue))
  ) {
    throw new Error("discovery continuity belongs to another PR scope");
  }
  if (
    preScopeReceiptDigest !== null &&
    value.pre_scope_receipt_digest !== preScopeReceiptDigest
  ) {
    throw new Error("discovery continuity cites another pre-scope receipt");
  }
  if (leaseReceiptValue !== null) {
    const expectedLease = normalizeDiscoveryContinuityLeaseReceipt(
      leaseReceiptValue,
      scope,
    );
    if (canonicalJson(lease) !== canonicalJson(expectedLease)) {
      throw new Error("discovery continuity cites another lease receipt");
    }
  }
  digest(value.continuity_receipt_digest,
    "discovery continuity receipt_digest");
  const { continuity_receipt_digest: _digest, ...withoutDigest } = value;
  if (
    value.continuity_receipt_digest !== digestCanonical(
      "codex-review-gate-v2-git-ledger-discovery-continuity",
      withoutDigest,
    )
  ) {
    throw new Error("discovery continuity receipt digest is invalid");
  }
  return deepFreeze({
    ...structuredClone(value),
    repository,
    scope,
    lease,
    full_snapshot: fullSnapshot,
    minimal_pre: minimalPre,
    minimal_post: minimalPost,
  });
}

function normalizeDiscoveryContinuityLease(value, scope) {
  assertObject(value, "discovery continuity lease");
  exactKeys(value, [
    "acquire_commit_sha", "acquired_at", "receipt_digest",
  ], "discovery continuity lease");
  sha(value.acquire_commit_sha,
    "discovery continuity lease acquire_commit_sha");
  timestamp(value.acquired_at, "discovery continuity lease acquired_at");
  digest(value.receipt_digest, "discovery continuity lease receipt_digest");
  void scope;
  return value;
}

function normalizeDiscoveryContinuityLeaseReceipt(value, scope = null) {
  assertObject(value, "discovery continuity lease receipt");
  assertObject(value.scope, "discovery continuity lease receipt.scope");
  const normalizedScope = normalizeEffectScope(value.scope);
  if (
    normalizedScope === null ||
    (scope !== null && canonicalJson(normalizedScope) !== canonicalJson(scope))
  ) {
    throw new Error("discovery continuity lease belongs to another PR scope");
  }
  validateLeaseReceipt(
    value,
    normalizeRepository(value.repository),
    normalizeLedgerRef(value.ledger_ref),
  );
  return normalizeDiscoveryContinuityLease({
    acquire_commit_sha: value.acquire_commit_sha,
    acquired_at: value.acquired_at,
    receipt_digest: value.receipt_digest,
  }, normalizedScope);
}

function projectDiscoveryContinuityFullSnapshot(
  value,
  transportLimits,
  repository,
  scope,
) {
  assertObject(value, "discovery continuity source snapshot");
  exactKeys(value, [
    "schema_version", "repository", "pull_request", "server_time", "scope",
    "pages", "permissions", "service_start_observations", "scope_receipts",
    "completeness", "stability",
  ], "discovery continuity source snapshot");
  if (value.schema_version !== 2) {
    throw new Error("discovery continuity source snapshot schema is unsupported");
  }
  assertObject(value.repository, "discovery continuity snapshot.repository");
  exactKeys(value.repository, ["owner", "name", "node_id"],
    "discovery continuity snapshot.repository");
  assertObject(value.pull_request,
    "discovery continuity snapshot.pull_request");
  exactKeys(value.pull_request, [
    "number", "node_id", "state", "merged", "merged_at", "is_draft",
  ], "discovery continuity snapshot.pull_request");
  if (
    value.repository.owner !== repository.owner ||
    value.repository.name !== repository.name ||
    value.repository.node_id !== repository.node_id ||
    value.pull_request.number !== scope.pull_request.number ||
    value.pull_request.node_id !== scope.pull_request.node_id ||
    value.pull_request.state !== "OPEN" || value.pull_request.merged !== false ||
    value.pull_request.merged_at !== null ||
    typeof value.pull_request.is_draft !== "boolean"
  ) {
    throw new Error("discovery continuity snapshot identity is not exact");
  }
  assertObject(value.scope, "discovery continuity snapshot.scope");
  if (
    value.scope.head_ref_oid !== scope.head_ref_oid ||
    value.scope.base_ref_tip !== scope.base_ref_oid ||
    value.scope.potential_merge_oid !== scope.potential_merge_commit_oid
  ) {
    throw new Error("discovery continuity snapshot scope differs");
  }
  assertObject(value.scope_receipts,
    "discovery continuity snapshot.scope_receipts");
  exactKeys(value.scope_receipts, ["pre", "post"],
    "discovery continuity snapshot.scope_receipts");
  const pre = projectDiscoveryContinuityFullScopeReceipt(
    value.scope_receipts.pre,
    repository,
    scope,
  );
  const post = projectDiscoveryContinuityFullScopeReceipt(
    value.scope_receipts.post,
    repository,
    scope,
  );
  const summary = {
    completeness: discoveryContinuityCompleteness(value.completeness),
    stability: discoveryContinuityStability(value.stability),
    transport_counts: discoveryContinuityTransportCounts(value.completeness),
    transport_limits: structuredClone(transportLimits),
    scope_digest: digestCanonical(
      "codex-review-gate-v2-transport-snapshot-scope",
      value.scope,
    ),
    evidence_digest: digestCanonical(
      "codex-review-gate-v2-transport-snapshot-evidence",
      value.pages,
    ),
    permissions_digest: digestCanonical(
      "codex-review-gate-v2-transport-snapshot-permissions",
      value.permissions,
    ),
    service_start_digest: digestCanonical(
      "codex-review-gate-v2-transport-snapshot-service-start",
      value.service_start_observations,
    ),
  };
  return normalizeDiscoveryContinuityFullSnapshot({
    snapshot_schema_version: value.schema_version,
    snapshot_digest: digestCanonical(
      "codex-review-gate-v2-transport-snapshot",
      value,
    ),
    server_time: value.server_time,
    scope_pre: pre,
    scope_post: post,
    summary,
  }, repository, scope);
}

function projectDiscoveryContinuityFullScopeReceipt(value, repository, scope) {
  return normalizeDiscoveryContinuityFullScopeReceipt({
    scope_receipt: structuredClone(value),
    scope_receipt_digest: digestCanonical(
      "codex-review-gate-v2-transport-scope-receipt",
      value,
    ),
    endpoint_receipts_digest: digestCanonical(
      "codex-review-gate-v2-transport-scope-endpoint-receipts",
      value.endpoint_receipts,
    ),
  }, repository, scope, "discovery continuity projected full scope");
}

function normalizeDiscoveryContinuityFullSnapshot(value, repository, scope) {
  assertObject(value, "discovery continuity full snapshot");
  exactKeys(value, [
    "snapshot_schema_version", "snapshot_digest", "server_time",
    "scope_pre", "scope_post", "summary",
  ], "discovery continuity full snapshot");
  if (value.snapshot_schema_version !== 2) {
    throw new Error("discovery continuity snapshot schema is unsupported");
  }
  digest(value.snapshot_digest,
    "discovery continuity full snapshot digest");
  timestamp(value.server_time,
    "discovery continuity full snapshot server_time");
  const pre = normalizeDiscoveryContinuityFullScopeReceipt(
    value.scope_pre,
    repository,
    scope,
    "discovery continuity full snapshot scope_pre",
  );
  const post = normalizeDiscoveryContinuityFullScopeReceipt(
    value.scope_post,
    repository,
    scope,
    "discovery continuity full snapshot scope_post",
  );
  if (
    canonicalJson(fullScopeStableProjection(pre)) !==
      canonicalJson(fullScopeStableProjection(post)) ||
    Date.parse(value.server_time) < Date.parse(post.scope_receipt.server_time)
  ) {
    throw new Error("discovery continuity full snapshot scope is unstable");
  }
  const summary = normalizeDiscoveryContinuitySummary(value.summary);
  return { ...value, scope_pre: pre, scope_post: post, summary };
}

function normalizeDiscoveryContinuityFullScopeReceipt(
  value,
  repository,
  scope,
  label,
) {
  assertObject(value, label);
  exactKeys(value, [
    "scope_receipt", "scope_receipt_digest", "endpoint_receipts_digest",
  ], label);
  const receipt = normalizeDiscoveryContinuityTransportScopeReceipt(
    value.scope_receipt,
    repository,
    scope,
    `${label}.scope_receipt`,
  );
  digest(value.scope_receipt_digest, `${label}.scope_receipt_digest`);
  digest(value.endpoint_receipts_digest,
    `${label}.endpoint_receipts_digest`);
  if (
    value.scope_receipt_digest !== digestCanonical(
      "codex-review-gate-v2-transport-scope-receipt",
      receipt,
    ) ||
    value.endpoint_receipts_digest !== digestCanonical(
      "codex-review-gate-v2-transport-scope-endpoint-receipts",
      receipt.endpoint_receipts,
    )
  ) {
    throw new Error(`${label} digest is invalid`);
  }
  return { ...value, scope_receipt: receipt };
}

function normalizeDiscoveryContinuityTransportScopeReceipt(
  value,
  repository,
  scope,
  label,
) {
  assertObject(value, label);
  exactKeys(value, [
    "repository_owner", "repository_name", "repository_node_id",
    "pull_request_number", "pull_request_node_id", "pull_request_state",
    "pull_request_merged", "pull_request_merged_at",
    "pull_request_is_draft", "base_ref_name", "base_ref_tip",
    "head_ref_name", "head_ref_oid", "merge_base_sha",
    "potential_merge_oid", "potential_merge_tree", "ordered_parent_oids",
    "merge_ref_oid", "mergeable", "endpoint_receipts", "server_time",
  ], label);
  if (
    value.repository_owner !== repository.owner ||
    value.repository_name !== repository.name ||
    value.pull_request_number !== scope.pull_request.number ||
    value.pull_request_node_id !== scope.pull_request.node_id ||
    value.pull_request_state !== "OPEN" || value.pull_request_merged !== false ||
    value.pull_request_merged_at !== null ||
    value.base_ref_tip !== scope.base_ref_oid ||
    value.head_ref_oid !== scope.head_ref_oid ||
    value.potential_merge_oid !== scope.potential_merge_commit_oid
  ) {
    throw new Error(`${label} differs from the protected PR scope`);
  }
  boundedString(value.repository_node_id, `${label}.repository_node_id`, 256);
  if (typeof value.pull_request_is_draft !== "boolean") {
    throw new TypeError(`${label}.pull_request_is_draft is not boolean`);
  }
  nullableBoundedString(value.base_ref_name, `${label}.base_ref_name`, 256);
  nullableBoundedString(value.head_ref_name, `${label}.head_ref_name`, 256);
  nullableSha(value.merge_base_sha, `${label}.merge_base_sha`);
  nullableSha(value.potential_merge_tree, `${label}.potential_merge_tree`);
  if (!Array.isArray(value.ordered_parent_oids) ||
      value.ordered_parent_oids.length > 3) {
    throw new TypeError(`${label}.ordered_parent_oids is not bounded`);
  }
  value.ordered_parent_oids.forEach((oid, index) =>
    sha(oid, `${label}.ordered_parent_oids[${index}]`));
  nullableSha(value.merge_ref_oid, `${label}.merge_ref_oid`);
  if (!new Set(["CONFLICTING", "MERGEABLE", "UNKNOWN"])
    .has(value.mergeable)) {
    throw new Error(`${label}.mergeable is unsupported`);
  }
  timestamp(value.server_time, `${label}.server_time`);
  normalizeDiscoveryContinuityScopeEndpoints(
    value.endpoint_receipts,
    value,
    `${label}.endpoint_receipts`,
  );
  return value;
}

function normalizeDiscoveryContinuityScopeEndpoints(value, scope, label) {
  assertObject(value, label);
  exactKeys(value, ["pull_request", "graphql", "compare", "merge_ref"], label);
  const repoPath = `/repos/${scope.repository_owner}/${scope.repository_name}`;
  normalizeDiscoveryContinuityEndpoint(value.pull_request,
    `${label}.pull_request`, "GET",
    `${repoPath}/pulls/${scope.pull_request_number}`, new Set([200]));
  normalizeDiscoveryContinuityEndpoint(value.graphql,
    `${label}.graphql`, "POST", null, new Set([200]));
  const comparePath = scope.base_ref_tip === null || scope.head_ref_oid === null
    ? null
    : `${repoPath}/compare/${scope.base_ref_tip}...${scope.head_ref_oid}`;
  if (comparePath === null) {
    if (value.compare !== null) {
      throw new Error(`${label}.compare is not null without base/head`);
    }
  } else {
    normalizeDiscoveryContinuityEndpoint(value.compare,
      `${label}.compare`, "GET", comparePath, new Set([200]));
  }
  normalizeDiscoveryContinuityEndpoint(value.merge_ref,
    `${label}.merge_ref`, "GET",
    `${repoPath}/git/ref/pull/${scope.pull_request_number}/merge`,
    new Set([200, 404]));
  if ((value.merge_ref.status === 404) !== (scope.merge_ref_oid === null)) {
    throw new Error(`${label}.merge_ref contradicts merge ref identity`);
  }
  const ordered = [
    value.pull_request,
    value.graphql,
    ...(value.compare === null ? [] : [value.compare]),
    value.merge_ref,
  ];
  for (let index = 1; index < ordered.length; index += 1) {
    if (Date.parse(ordered[index].server_time) <
        Date.parse(ordered[index - 1].server_time)) {
      throw new Error(`${label} server time regressed`);
    }
  }
  if (scope.server_time !== ordered.at(-1).server_time) {
    throw new Error(`${label} does not end at scope server time`);
  }
}

function normalizeDiscoveryContinuityEndpoint(
  value,
  label,
  method,
  path,
  statuses,
) {
  assertObject(value, label);
  exactKeys(value, [
    "method", "path", "status", "server_time", "raw_body_sha256",
  ], label);
  if (
    value.method !== method || !statuses.has(value.status) ||
    typeof value.path !== "string" || !value.path.startsWith("/") ||
    value.path.includes("?") || value.path.includes("#") ||
    /[\r\n]/u.test(value.path) || (path !== null && value.path !== path)
  ) {
    throw new Error(`${label} endpoint binding is invalid`);
  }
  timestamp(value.server_time, `${label}.server_time`);
  digest(value.raw_body_sha256, `${label}.raw_body_sha256`);
  return value;
}

function normalizeDiscoveryContinuitySummary(value) {
  assertObject(value, "discovery continuity snapshot summary");
  exactKeys(value, [
    "completeness", "stability", "transport_counts", "transport_limits",
    "scope_digest", "evidence_digest", "permissions_digest",
    "service_start_digest",
  ], "discovery continuity snapshot summary");
  assertObject(value.completeness,
    "discovery continuity completeness");
  exactKeys(value.completeness, [
    "all_pages_loaded", "issue_comments", "reviews", "inline_comments",
    "threads", "reactions", "permissions", "exact_artifacts",
    "service_start_observations",
  ], "discovery continuity completeness");
  for (const item of Object.values(value.completeness)) {
    if (item !== true) {
      throw new Error("discovery continuity snapshot is incomplete");
    }
  }
  assertObject(value.stability, "discovery continuity stability");
  exactKeys(value.stability, [
    "scope_stable", "service_start_observations_stable",
    "server_time_monotonic",
  ], "discovery continuity stability");
  for (const item of Object.values(value.stability)) {
    if (item !== true) {
      throw new Error("discovery continuity snapshot is unstable");
    }
  }
  assertObject(value.transport_counts,
    "discovery continuity transport counts");
  exactKeys(value.transport_counts, [
    "request_count", "item_count", "response_bytes", "server_date_headers",
  ], "discovery continuity transport counts");
  for (const [key, count] of Object.entries(value.transport_counts)) {
    nonnegativeInteger(count, `discovery continuity transport counts.${key}`);
  }
  if (
    value.transport_counts.server_date_headers !==
      value.transport_counts.request_count
  ) {
    throw new Error("discovery continuity server Date coverage is incomplete");
  }
  assertObject(value.transport_limits,
    "discovery continuity transport limits");
  exactKeys(value.transport_limits, [
    "max_pages", "page_size", "max_items", "max_response_bytes",
    "max_total_response_bytes", "max_requests", "max_artifact_selectors",
    "request_timeout_ms",
  ], "discovery continuity transport limits");
  for (const [key, limit] of Object.entries(value.transport_limits)) {
    positiveInteger(limit, `discovery continuity transport limits.${key}`);
  }
  if (
    value.transport_counts.request_count > value.transport_limits.max_requests ||
    value.transport_counts.item_count > value.transport_limits.max_items ||
    value.transport_counts.response_bytes >
      value.transport_limits.max_total_response_bytes
  ) {
    throw new Error("discovery continuity transport counts exceed limits");
  }
  for (const [key, limit] of Object.entries(value.transport_limits)) {
    if (limit > V2_TRANSPORT_DEFAULT_LIMITS[key]) {
      throw new Error(`discovery continuity transport limits.${key} is relaxed`);
    }
  }
  if (
    value.transport_limits.max_artifact_selectors >
      value.transport_limits.max_items
  ) {
    throw new Error(
      "discovery continuity artifact selector cap exceeds its item cap",
    );
  }
  for (const key of [
    "scope_digest", "evidence_digest", "permissions_digest",
    "service_start_digest",
  ]) {
    digest(value[key], `discovery continuity summary.${key}`);
  }
  return value;
}

function discoveryContinuityCompleteness(value) {
  assertObject(value, "discovery continuity source completeness");
  exactKeys(value, [
    "all_pages_loaded", "issue_comments", "reviews", "inline_comments",
    "threads", "reactions", "permissions", "exact_artifacts",
    "service_start_observations", "request_count", "item_count",
    "response_bytes", "server_date_headers",
  ], "discovery continuity source completeness");
  return {
    all_pages_loaded: value.all_pages_loaded,
    issue_comments: value.issue_comments,
    reviews: value.reviews,
    inline_comments: value.inline_comments,
    threads: value.threads,
    reactions: value.reactions,
    permissions: value.permissions,
    exact_artifacts: value.exact_artifacts,
    service_start_observations: value.service_start_observations,
  };
}

function discoveryContinuityStability(value) {
  assertObject(value, "discovery continuity source stability");
  exactKeys(value, [
    "scope_stable", "service_start_observations_stable",
    "server_time_monotonic",
  ], "discovery continuity source stability");
  return structuredClone(value);
}

function discoveryContinuityTransportCounts(value) {
  return {
    request_count: value.request_count,
    item_count: value.item_count,
    response_bytes: value.response_bytes,
    server_date_headers: value.server_date_headers,
  };
}

function projectDiscoveryContinuityMinimalScope(
  value,
  repository,
  scope,
  label,
) {
  assertObject(value, label);
  const projected = {
    ...structuredClone(value),
    endpoint_receipts_digest: digestCanonical(
      "codex-review-gate-v2-minimal-scope-endpoint-receipts",
      value.endpoint_receipts,
    ),
  };
  return normalizeDiscoveryContinuityMinimalScope(
    projected,
    repository,
    scope,
    label,
  );
}

function normalizeDiscoveryContinuityMinimalScope(
  value,
  repository,
  scope,
  label,
) {
  assertObject(value, label);
  exactKeys(value, [
    "schema", "schema_version", "repository", "pull_request", "scope",
    "endpoint_receipts", "observed_at", "receipt_digest",
    "endpoint_receipts_digest",
  ], label);
  if (
    value.schema !== "codex-review-gate-minimal-scope-receipt-v2" ||
    value.schema_version !== 1
  ) {
    throw new Error(`${label} schema is unsupported`);
  }
  assertObject(value.repository, `${label}.repository`);
  exactKeys(value.repository, ["owner", "name", "node_id"],
    `${label}.repository`);
  assertObject(value.pull_request, `${label}.pull_request`);
  exactKeys(value.pull_request, [
    "number", "node_id", "state", "merged", "merged_at", "is_draft",
    "updated_at",
  ], `${label}.pull_request`);
  assertObject(value.scope, `${label}.scope`);
  exactKeys(value.scope, [
    "base_ref_name", "base_ref_tip", "head_ref_name", "head_ref_oid",
    "potential_merge_oid", "potential_merge_tree", "ordered_parent_oids",
    "mergeable", "merge_base_sha", "merge_ref_oid",
  ], `${label}.scope`);
  if (
    value.repository.owner !== repository.owner ||
    value.repository.name !== repository.name ||
    value.repository.node_id !== repository.node_id ||
    value.pull_request.number !== scope.pull_request.number ||
    value.pull_request.node_id !== scope.pull_request.node_id ||
    value.pull_request.state !== "OPEN" || value.pull_request.merged !== false ||
    value.pull_request.merged_at !== null ||
    value.scope.head_ref_oid !== scope.head_ref_oid ||
    value.scope.base_ref_tip !== scope.base_ref_oid ||
    value.scope.potential_merge_oid !== scope.potential_merge_commit_oid
  ) {
    throw new Error(`${label} differs from the protected PR scope`);
  }
  if (typeof value.pull_request.is_draft !== "boolean") {
    throw new TypeError(`${label}.pull_request.is_draft is not boolean`);
  }
  timestamp(value.pull_request.updated_at,
    `${label}.pull_request.updated_at`);
  nullableBoundedString(value.scope.base_ref_name,
    `${label}.scope.base_ref_name`, 256);
  nullableBoundedString(value.scope.head_ref_name,
    `${label}.scope.head_ref_name`, 256);
  nullableSha(value.scope.merge_base_sha, `${label}.scope.merge_base_sha`);
  nullableSha(value.scope.potential_merge_tree,
    `${label}.scope.potential_merge_tree`);
  if (!Array.isArray(value.scope.ordered_parent_oids) ||
      value.scope.ordered_parent_oids.length > 3) {
    throw new TypeError(`${label}.scope.ordered_parent_oids is not bounded`);
  }
  value.scope.ordered_parent_oids.forEach((oid, index) =>
    sha(oid, `${label}.scope.ordered_parent_oids[${index}]`));
  nullableSha(value.scope.merge_ref_oid, `${label}.scope.merge_ref_oid`);
  if (!new Set(["CONFLICTING", "MERGEABLE", "UNKNOWN"])
    .has(value.scope.mergeable)) {
    throw new Error(`${label}.scope.mergeable is unsupported`);
  }
  digest(value.receipt_digest,
    `${label} receipt_digest`);
  timestamp(value.observed_at,
    `${label} observed_at`);
  const endpoints = normalizeDiscoveryContinuityMinimalEndpoints(
    value.endpoint_receipts,
    repository,
    scope,
    value.scope,
    `${label}.endpoint_receipts`,
  );
  digest(value.endpoint_receipts_digest,
    `${label} endpoint receipts digest`);
  if (
    value.endpoint_receipts_digest !== digestCanonical(
      "codex-review-gate-v2-minimal-scope-endpoint-receipts",
      endpoints,
    )
  ) {
    throw new Error(`${label} endpoint receipt digest is invalid`);
  }
  const {
    endpoint_receipts_digest: _endpointDigest,
    receipt_digest: _receiptDigest,
    ...minimalWithoutDigest
  } = value;
  if (
    value.receipt_digest !== runnerDigestCanonical(
      "codex-review-gate-v2-minimal-live-scope",
      minimalWithoutDigest,
    )
  ) {
    throw new Error(`${label} receipt digest is invalid`);
  }
  if (value.observed_at !== endpoints.at(-1).server_time) {
    throw new Error(`${label} observed_at differs from endpoint inventory`);
  }
  return { ...value, endpoint_receipts: endpoints };
}

function normalizeDiscoveryContinuityMinimalPost(value, repository, scope) {
  return normalizeDiscoveryContinuityMinimalScope(
    value,
    repository,
    scope,
    "discovery continuity minimal post",
  );
}

function normalizeDiscoveryContinuityMinimalEndpoints(
  value,
  repository,
  scope,
  minimalScope,
  label,
) {
  if (!Array.isArray(value) || !new Set([3, 4]).has(value.length)) {
    throw new TypeError(`${label} is not the closed minimal endpoint sequence`);
  }
  const repoPath = `/repos/${repository.owner}/${repository.name}`;
  const expected = [
    ["GET", `${repoPath}/pulls/${scope.pull_request.number}`, new Set([200])],
    ["POST", null, new Set([200])],
    ...(value.length === 4
      ? [["GET", `${repoPath}/compare/${scope.base_ref_oid}...${scope.head_ref_oid}`,
        new Set([200])]]
      : []),
    ["GET", `${repoPath}/git/ref/pull/${scope.pull_request.number}/merge`,
      new Set([200, 404])],
  ];
  value.forEach((receipt, index) =>
    normalizeDiscoveryContinuityEndpoint(
      receipt,
      `${label}[${index}]`,
      expected[index][0],
      expected[index][1],
      expected[index][2],
    ));
  for (let index = 1; index < value.length; index += 1) {
    if (Date.parse(value[index].server_time) <
        Date.parse(value[index - 1].server_time)) {
      throw new Error(`${label} server time regressed`);
    }
  }
  if ((value.at(-1).status === 404) !==
      (minimalScope.merge_ref_oid === null)) {
    throw new Error(`${label} merge-ref status contradicts evaluated scope`);
  }
  return value;
}

function fullScopeStableProjection(value) {
  const { endpoint_receipts: _endpoints, server_time: _time, ...stable } =
    value.scope_receipt;
  return stable;
}

function minimalScopeStableProjection(value) {
  return {
    repository: value.repository,
    pull_request: value.pull_request,
    scope: value.scope,
  };
}

function fullMinimalSharedProjection(value) {
  if (Object.hasOwn(value, "repository_owner")) {
    return {
      repository: {
        owner: value.repository_owner,
        name: value.repository_name,
        node_id: value.repository_node_id,
      },
      pull_request: {
        number: value.pull_request_number,
        node_id: value.pull_request_node_id,
        state: value.pull_request_state,
        merged: value.pull_request_merged,
        merged_at: value.pull_request_merged_at,
        is_draft: value.pull_request_is_draft,
      },
      scope: {
        base_ref_name: value.base_ref_name,
        base_ref_tip: value.base_ref_tip,
        head_ref_name: value.head_ref_name,
        head_ref_oid: value.head_ref_oid,
        merge_base_sha: value.merge_base_sha,
        potential_merge_oid: value.potential_merge_oid,
        potential_merge_tree: value.potential_merge_tree,
        ordered_parent_oids: value.ordered_parent_oids,
        merge_ref_oid: value.merge_ref_oid,
        mergeable: value.mergeable,
      },
    };
  }
  return {
    repository: value.repository,
    pull_request: {
      number: value.pull_request.number,
      node_id: value.pull_request.node_id,
      state: value.pull_request.state,
      merged: value.pull_request.merged,
      merged_at: value.pull_request.merged_at,
      is_draft: value.pull_request.is_draft,
    },
    scope: value.scope,
  };
}

export function createV2GitLedgerPullRequestEvaluatedScopeReceipt(value) {
  if (!new Set(["pull-request-event", "manual-pull-request"])
    .has(value?.relation)) {
    throw new TypeError(
      "direct PR evaluated scope may only bind a native PR or manual selector",
    );
  }
  return createV2GitLedgerEvaluatedScopeReceipt(value);
}

export function createV2GitLedgerPullRequestEventPreScopeReceipt({
  repository,
  scope,
  trigger_identity,
  scope_endpoint_receipt,
}) {
  return createV2GitLedgerEvaluatedScopeReceipt({
    relation: "pull-request-event",
    repository,
    scope,
    trigger_identity,
    selector: null,
    inventory_receipt: null,
    provider_artifact_receipt: null,
    provider_identity_authority: null,
    scope_endpoint_receipt,
  });
}

export function createV2GitLedgerManualPullRequestEvaluatedScopeReceipt({
  repository,
  scope,
  trigger_identity,
  selection_receipt,
  scope_endpoint_receipt,
}) {
  return createV2GitLedgerEvaluatedScopeReceipt({
    relation: "manual-pull-request",
    repository,
    scope,
    trigger_identity,
    selector: selection_receipt,
    inventory_receipt: null,
    provider_artifact_receipt: null,
    provider_identity_authority: null,
    scope_endpoint_receipt,
  });
}

export function createV2GitLedgerManualSelectionReceipt({
  source,
  input_name,
  input_value,
  command_receipt_digest,
  scope: scopeValue,
}) {
  const scope = normalizeEffectScope(scopeValue);
  if (scope === null) {
    throw new TypeError("manual selection requires one exact PR scope");
  }
  const withoutDigest = {
    source,
    input_name,
    input_value,
    pull_request_number: scope.pull_request.number,
    pull_request_node_id: scope.pull_request.node_id,
    command_receipt_digest,
  };
  return deepFreeze({
    ...withoutDigest,
    selection_receipt_digest: digestCanonical(
      "codex-review-gate-v2-manual-pull-request-selection",
      withoutDigest,
    ),
  });
}

function normalizeExpectedProvider(value) {
  assertObject(value, "expected provider");
  exactKeys(value, ["actor", "app"], "expected provider");
  validateExternalActor(value.actor, "expected provider.actor");
  validateExternalApp(value.app, "expected provider.app");
  validateCodexProvider(value.actor, value.app, "expected provider");
  return deepFreeze(structuredClone(value));
}

export function validateV2GitLedgerProviderIdentityPolicy(value) {
  return normalizeProviderIdentityPolicy(value);
}

function normalizeProviderIdentityPolicy(value) {
  assertObject(value, "provider identity policy");
  exactKeys(value, [
    "schema", "schema_version", "catalog_version", "actor", "app",
    "actor_endpoint_path", "app_endpoint_path", "catalog_digest",
  ], "provider identity policy");
  if (
    value.schema !== V2_GIT_LEDGER_PROVIDER_IDENTITY_POLICY_SCHEMA ||
    value.schema_version !== 1 || value.catalog_version !== 1 ||
    value.actor_endpoint_path !==
      "/users/chatgpt-codex-connector%5Bbot%5D" ||
    value.app_endpoint_path !== "/apps/chatgpt-codex-connector"
  ) {
    throw new Error("provider identity policy is unsupported or unpinned");
  }
  validateExternalActor(value.actor, "provider identity policy.actor");
  validateExternalApp(value.app, "provider identity policy.app");
  validateCodexProvider(value.actor, value.app, "provider identity policy");
  digest(value.catalog_digest, "provider identity policy.catalog_digest");
  const { catalog_digest: _catalogDigest, ...withoutDigest } = value;
  if (
    value.catalog_digest !== digestCanonical(
      "codex-review-gate-v2-provider-identity-policy",
      withoutDigest,
    )
  ) {
    throw new Error("provider identity policy catalog digest is invalid");
  }
  return deepFreeze(structuredClone(value));
}

function normalizeProviderIdentityAuthority(value, policy) {
  const normalized = normalizeProviderIdentityAuthorityStructure(value);
  if (
    normalized.catalog_version !== policy.catalog_version ||
    normalized.catalog_digest !== policy.catalog_digest ||
    canonicalJson(normalized.actor) !== canonicalJson(policy.actor) ||
    canonicalJson(normalized.app) !== canonicalJson(policy.app) ||
    normalized.actor_endpoint_receipt.path !== policy.actor_endpoint_path ||
    normalized.app_endpoint_receipt.path !== policy.app_endpoint_path
  ) {
    throw ledgerError(
      "provider-identity-policy-mismatch",
      "live provider identity authority differs from the attested catalog",
    );
  }
  return normalized;
}

function normalizeProviderIdentityAuthorityStructure(value) {
  assertObject(value, "provider identity authority");
  exactKeys(value, [
    "schema", "schema_version", "catalog_version", "catalog_digest",
    "actor", "app",
    "actor_endpoint_receipt", "app_endpoint_receipt",
    "actor_endpoint_receipt_digest", "app_endpoint_receipt_digest",
    "identity_digest",
  ], "provider identity authority");
  if (
    value.schema !== V2_GIT_LEDGER_PROVIDER_IDENTITY_AUTHORITY_SCHEMA ||
    value.schema_version !== 1 || value.catalog_version !== 1
  ) {
    throw ledgerError(
      "provider-identity-policy-mismatch",
      "live provider identity authority differs from the attested catalog",
    );
  }
  validateExternalActor(value.actor, "provider identity authority.actor");
  validateExternalApp(value.app, "provider identity authority.app");
  validateCodexProvider(value.actor, value.app, "provider identity authority");
  digest(value.catalog_digest, "provider identity authority.catalog_digest");
  validateProviderIdentityEndpointReceipt(
    value.actor_endpoint_receipt,
    "/users/chatgpt-codex-connector%5Bbot%5D",
    "provider actor endpoint receipt",
  );
  validateProviderIdentityEndpointReceipt(
    value.app_endpoint_receipt,
    "/apps/chatgpt-codex-connector",
    "provider App endpoint receipt",
  );
  digest(value.actor_endpoint_receipt_digest,
    "provider identity actor endpoint digest");
  digest(value.app_endpoint_receipt_digest,
    "provider identity App endpoint digest");
  if (
    value.actor_endpoint_receipt_digest !== digestCanonical(
      "codex-review-gate-v2-provider-actor-endpoint-receipt",
      value.actor_endpoint_receipt,
    ) ||
    value.app_endpoint_receipt_digest !== digestCanonical(
      "codex-review-gate-v2-provider-app-endpoint-receipt",
      value.app_endpoint_receipt,
    )
  ) {
    throw ledgerError(
      "provider-identity-receipt-mismatch",
      "live provider identity endpoint receipt digest is invalid",
    );
  }
  digest(value.identity_digest, "provider identity authority.identity_digest");
  const {
    identity_digest: _identityDigest,
    catalog_digest: _catalogDigest,
    ...withoutDigest
  } = value;
  if (
    value.identity_digest !== digestCanonical(
      "codex-review-gate-v2-provider-identity-authority",
      withoutDigest,
    )
  ) {
    throw ledgerError(
      "provider-identity-authority-mismatch",
      "live provider identity authority digest is invalid",
    );
  }
  return deepFreeze(structuredClone(value));
}

async function minimalScopeAuthorityFromHandle(handle, repository) {
  const module = await import("./workflow-controller.mjs");
  if (
    typeof module.assertV2MinimalLiveScopeHandle !== "function" ||
    typeof module.projectV2MinimalScopeForGitLedger !== "function"
  ) {
    throw ledgerError(
      "minimal-live-scope-authority-unavailable",
      "minimal live-scope authority adapter is unavailable",
    );
  }
  module.assertV2MinimalLiveScopeHandle(handle, {
    repository: { owner: repository.owner, name: repository.name },
  });
  const projection = module.projectV2MinimalScopeForGitLedger(handle);
  const scope = normalizeEffectScope(projection.scope);
  if (scope === null) {
    throw new TypeError("minimal live-scope authority requires one PR scope");
  }
  const scopeEndpointReceipt = normalizeEvaluatedScopeEndpointReceipt(
    projection.scope_endpoint_receipt,
    "pull-request-event",
    repository,
    scope,
  );
  return deepFreeze({
    scope,
    scope_endpoint_receipt: structuredClone(scopeEndpointReceipt),
  });
}

async function manualWorkflowCommandAuthority({
  workflow_command_handle: workflowCommandHandle,
  repository,
  scope,
  trigger_identity: triggerIdentity,
}) {
  const module = await import("./workflow-command.mjs");
  if (
    typeof module.assertV2WorkflowCommandHandle !== "function" ||
    typeof module.digestV2WorkflowCommand !== "function"
  ) {
    throw ledgerError(
      "workflow-command-authority-unavailable",
      "protected workflow-command authority adapter is unavailable",
    );
  }
  const command = module.assertV2WorkflowCommandHandle(workflowCommandHandle);
  if (
    command.repository.owner !== repository.owner ||
    command.repository.name !== repository.name ||
    command.pull_request.number !== scope.pull_request.number ||
    command.invocation.event_name !== "workflow_dispatch" ||
    command.route.operation !== "evaluate-only" ||
    command.route.trigger !== "manual" ||
    triggerIdentity.event_name !== command.invocation.event_name
  ) {
    throw ledgerError(
      "manual-workflow-command-mismatch",
      "manual evaluated scope differs from its protected workflow command",
    );
  }
  return deepFreeze({
    command_receipt_digest: module.digestV2WorkflowCommand(command),
  });
}

async function scheduledWorkflowCommandAuthority({
  workflow_command_handle: workflowCommandHandle,
  repository,
  trigger_identity: triggerIdentity,
  pull_request_number: pullRequestNumber,
  expected_dispatch_binding: expectedDispatchBindingValue = null,
}) {
  const module = await import("./workflow-command.mjs");
  if (
    typeof module.assertV2WorkflowCommandHandle !== "function" ||
    typeof module.digestV2WorkflowCommand !== "function"
  ) {
    throw ledgerError(
      "workflow-command-authority-unavailable",
      "candidate dispatch requires the protected workflow-command adapter",
    );
  }
  const command = module.assertV2WorkflowCommandHandle(workflowCommandHandle);
  const expectedDispatchBinding = expectedDispatchBindingValue === null
    ? null
    : normalizeCandidateDispatchPlanItem(
      expectedDispatchBindingValue,
      "candidate dispatch expected workflow binding",
    );
  const expectedRoute = {
    operation: "ordinary",
    trigger: "schedule",
    observation_boundary: "initial",
  };
  if (
    command.repository.owner !== repository.owner ||
    command.repository.name !== repository.name ||
    command.pull_request.number !== pullRequestNumber ||
    canonicalJson(command.dispatch_binding) !==
      canonicalJson(expectedDispatchBinding) ||
    command.invocation.event_name !== "schedule" ||
    canonicalJson(command.route) !== canonicalJson(expectedRoute) ||
    canonicalJson(normalizeCandidateDispatchTriggerIdentity(triggerIdentity)) !==
      canonicalJson(triggerIdentity)
  ) {
    throw ledgerError(
      "candidate-dispatch-workflow-command-mismatch",
      "candidate dispatch differs from its protected schedule command",
    );
  }
  const commandDigest = module.digestV2WorkflowCommand(command);
  const authority = normalizeCandidateDispatchCommandAuthority({
    command_digest: commandDigest,
    repository: candidateRepository(repository),
    pull_request_number: pullRequestNumber,
    dispatch_binding: expectedDispatchBinding,
    selection_policy: command.selection_policy,
    route: structuredClone(command.route),
    invocation: structuredClone(command.invocation),
    workflow_receipt_digest: digestCanonical(
      "codex-review-gate-v2-candidate-dispatch-workflow-receipt",
      command.workflow_receipt,
    ),
  });
  return deepFreeze({
    command,
    authority,
    command_digest: commandDigest,
    workflow_command_handle: workflowCommandHandle,
  });
}

async function scheduledRecoveryWorkflowCommandAuthority({
  workflow_command_handle: workflowCommandHandle,
  repository,
  trigger_identity: triggerIdentity,
  expected_dispatch_binding: expectedDispatchBindingValue,
}) {
  const module = await import("./workflow-command.mjs");
  if (typeof module.assertV2WorkflowCommandHandle !== "function") {
    throw ledgerError(
      "workflow-command-authority-unavailable",
      "candidate recovery requires the protected workflow-command adapter",
    );
  }
  const command = module.assertV2WorkflowCommandHandle(workflowCommandHandle);
  const expectedDispatchBinding = normalizeCandidateDispatchPlanItem(
    expectedDispatchBindingValue,
    "candidate dispatch recovery workflow binding",
  );
  const pullRequestNumber = command.pull_request.number;
  if (
    pullRequestNumber !== null &&
    pullRequestNumber !== expectedDispatchBinding.candidate.number
  ) {
    throw ledgerError(
      "candidate-dispatch-workflow-command-mismatch",
      "candidate recovery command selects another pull request",
    );
  }
  return scheduledWorkflowCommandAuthority({
    workflow_command_handle: workflowCommandHandle,
    repository,
    trigger_identity: triggerIdentity,
    pull_request_number: pullRequestNumber,
    expected_dispatch_binding: pullRequestNumber === null
      ? null
      : expectedDispatchBinding,
  });
}

async function initialWorkflowCommandAuthority({
  workflow_command_handle: workflowCommandHandle,
  repository,
  evaluated_scope_receipt: evaluatedScopeReceipt,
}) {
  const module = await import("./workflow-command.mjs");
  if (
    typeof module.assertV2WorkflowCommandHandle !== "function" ||
    typeof module.digestV2WorkflowCommand !== "function"
  ) {
    throw ledgerError(
      "workflow-command-authority-unavailable",
      "initial runner authority requires the protected workflow-command adapter",
    );
  }
  const command = module.assertV2WorkflowCommandHandle(workflowCommandHandle);
  validateInitialCommandScope(command, repository, evaluatedScopeReceipt);
  const commandDigest = module.digestV2WorkflowCommand(command);
  return deepFreeze({
    command,
    public_authority: {
      command: structuredClone(command),
      command_digest: commandDigest,
    },
  });
}

async function establishedWorkflowCommandAuthority({
  workflow_command_handle: workflowCommandHandle,
  repository,
  evaluated_scope_receipt: evaluatedScopeReceipt,
}) {
  const module = await import("./workflow-command.mjs");
  if (
    typeof module.assertV2WorkflowCommandHandle !== "function" ||
    typeof module.digestV2WorkflowCommand !== "function"
  ) {
    throw ledgerError(
      "workflow-command-authority-unavailable",
      "established runner authority requires the protected workflow-command adapter",
    );
  }
  const command = module.assertV2WorkflowCommandHandle(workflowCommandHandle);
  validateEstablishedCommandScope(command, repository, evaluatedScopeReceipt);
  const commandDigest = module.digestV2WorkflowCommand(command);
  return deepFreeze({
    command,
    public_authority: {
      command: structuredClone(command),
      command_digest: commandDigest,
    },
  });
}

async function initialPreflightAuthority(preflightHandle, repository) {
  if (preflightHandle === null) {
    throw ledgerError(
      "initial-preflight-authority-required",
      "initial runner authority requires one branded same-job preflight",
    );
  }
  const module = await import("./workflow-preflight.mjs");
  if (typeof module.assertV2WorkflowPreflightHandle !== "function") {
    throw ledgerError(
      "initial-preflight-authority-unavailable",
      "initial runner authority requires the workflow preflight adapter",
    );
  }
  const preflight = module.assertV2WorkflowPreflightHandle(preflightHandle);
  if (
    preflight.repository.owner !== repository.owner ||
    preflight.repository.name !== repository.name ||
    preflight.repository.id !== repository.id ||
    preflight.repository.node_id !== repository.node_id ||
    preflight.repository.owner_id !== repository.owner_id
  ) {
    throw ledgerError(
      "initial-preflight-repository-mismatch",
      "initial runner preflight belongs to another repository",
    );
  }
  const projection = initialPublicWaitProjection(preflight, repository);
  return deepFreeze({
    public_wait_supported: projection.public_wait_supported,
    public_authority: projection,
  });
}

function initialPublicWaitProjection(preflight, repository) {
  const visibility = boundedString(
    preflight.repository.visibility,
    "initial preflight repository visibility",
    32,
  );
  const wait = preflight.public_wait;
  assertObject(wait, "initial preflight public_wait");
  if (
    typeof wait.required !== "boolean" ||
    wait.configuration_compatible !== true ||
    typeof wait.live_canary_required !== "boolean" ||
    !Array.isArray(wait.environments)
  ) {
    throw ledgerError(
      "initial-public-wait-incompatible",
      "initial runner authority lacks one compatible wait topology",
    );
  }
  const environments = wait.environments.map((value, index) => {
    assertObject(value, `initial public wait environment ${index}`);
    exactKeys(value, [
      "stage", "name", "id", "wait_timer_rule_id", "wait_timer_minutes",
    ], `initial public wait environment ${index}`);
    if (value.wait_timer_minutes !== 15) {
      throw ledgerError(
        "initial-public-wait-incompatible",
        "initial public wait timer differs from fifteen minutes",
      );
    }
    return {
      stage: boundedString(value.stage, `initial wait stage ${index}`, 64),
      name: boundedString(value.name, `initial wait name ${index}`, 255),
      id: decimal(value.id, `initial wait id ${index}`),
      wait_timer_rule_id: decimal(
        value.wait_timer_rule_id,
        `initial wait timer rule id ${index}`,
      ),
      wait_timer_minutes: 15,
    };
  });
  const publicRepository = visibility === "public";
  if (
    !new Set(["public", "private", "internal"]).has(visibility) ||
    publicRepository !== (wait.required === true) ||
    publicRepository !== (wait.live_canary_required === true) ||
    (publicRepository ? environments.length !== 3 : environments.length !== 0)
  ) {
    throw ledgerError(
      "initial-public-wait-incompatible",
      "repository visibility differs from its closed wait topology",
    );
  }
  const repoPath = `/repos/${encodeURIComponent(repository.owner)}/` +
    `${encodeURIComponent(repository.name)}`;
  const endpointReceipts = (preflight.endpoint_receipts ?? [])
    .filter((receipt) =>
      typeof receipt?.path === "string" &&
      receipt.path.startsWith(`${repoPath}/environments`))
    .map((receipt, index) => normalizeInitialEndpointReceipt(
      receipt,
      `initial public wait endpoint ${index}`,
    ));
  if (
    (publicRepository && endpointReceipts.length !== 4) ||
    (!publicRepository && endpointReceipts.length !== 0)
  ) {
    throw ledgerError(
      "initial-public-wait-evidence-incomplete",
      "initial public wait endpoint inventory is incomplete",
    );
  }
  const topology = {
    required: wait.required,
    configuration_compatible: wait.configuration_compatible,
    live_canary_required: wait.live_canary_required,
    environments,
  };
  const withoutDigests = {
    preflight_receipt_digest: digest(
      preflight.receipt_digest,
      "initial preflight receipt_digest",
    ),
    configuration_digest: digest(
      preflight.configuration_digest,
      "initial preflight configuration_digest",
    ),
    repository_visibility: visibility,
    public_wait_supported: publicRepository,
    public_wait_topology: topology,
    public_wait_endpoint_receipts: endpointReceipts,
  };
  return {
    ...withoutDigests,
    public_wait_topology_digest: digestCanonical(
      "codex-review-gate-v2-initial-public-wait-topology",
      topology,
    ),
    public_wait_endpoint_inventory_digest: digestCanonical(
      "codex-review-gate-v2-initial-public-wait-endpoint-inventory",
      endpointReceipts,
    ),
  };
}

function normalizeInitialEndpointReceipt(value, label) {
  assertObject(value, label);
  exactKeys(value, [
    "method", "path", "status", "server_time", "raw_body_sha256",
  ], label);
  if (value.method !== "GET" || value.status !== 200) {
    throw new Error(`${label} is not one successful GET`);
  }
  return {
    method: "GET",
    path: boundedString(value.path, `${label}.path`, 4096),
    status: 200,
    server_time: timestamp(value.server_time, `${label}.server_time`),
    raw_body_sha256: digest(
      value.raw_body_sha256,
      `${label}.raw_body_sha256`,
    ),
  };
}

function validateInitialCommandScope(command, repository, evaluatedScopeReceipt) {
  assertObject(command, "initial workflow command");
  const scope = evaluatedScopeReceipt.scope;
  const expectedTrigger = {
    "pull-request-event": "initial",
    "provider-selector": "provider-event",
    "scheduled-pull-request": "schedule",
    "manual-pull-request": "manual",
  }[evaluatedScopeReceipt.relation];
  if (
    expectedTrigger === undefined ||
    command.repository.owner !== repository.owner ||
    command.repository.name !== repository.name ||
    command.pull_request.number !== scope.pull_request.number ||
    command.route.trigger !== expectedTrigger ||
    command.route.observation_boundary !== "initial" ||
    command.invocation.event_name !== evaluatedScopeReceipt.trigger_event_name
  ) {
    throw ledgerError(
      "initial-workflow-command-mismatch",
      "initial workflow command differs from its evaluated PR authority",
    );
  }
  if (
    (evaluatedScopeReceipt.relation === "manual-pull-request") !==
      (command.route.operation === "evaluate-only")
  ) {
    throw ledgerError(
      "initial-workflow-command-mismatch",
      "initial workflow operation differs from its evaluated relation",
    );
  }
}

function validateEstablishedCommandScope(
  command,
  repository,
  evaluatedScopeReceipt,
) {
  assertObject(command, "established workflow command");
  const scope = evaluatedScopeReceipt.scope;
  const initialTrigger = {
    "pull-request-event": "initial",
    "provider-selector": "provider-event",
    "scheduled-pull-request": "schedule",
    "manual-pull-request": "manual",
  }[evaluatedScopeReceipt.relation];
  const continuation = command.route.observation_boundary !== "initial";
  const expectedTrigger = continuation ? "timer" : initialTrigger;
  if (
    expectedTrigger === undefined ||
    command.repository.owner !== repository.owner ||
    command.repository.name !== repository.name ||
    command.pull_request.number !== scope.pull_request.number ||
    command.route.trigger !== expectedTrigger ||
    command.invocation.event_name !== evaluatedScopeReceipt.trigger_event_name
  ) {
    throw ledgerError(
      "established-workflow-command-mismatch",
      "established workflow command differs from its evaluated PR authority",
    );
  }
  if (
    evaluatedScopeReceipt.relation === "manual-pull-request"
      ? command.route.operation !== "evaluate-only" || continuation
      : command.route.operation !== "ordinary"
  ) {
    throw ledgerError(
      "established-workflow-command-mismatch",
      "established workflow operation differs from its evaluated relation",
    );
  }
}

function initialSourceAuthority({ loaded, scoped_authority: scopedAuthority }) {
  return {
    tip_commit_sha: loaded.tip_commit_sha,
    same_job_source_inventory_digest:
      scopedAuthority.source_inventory_digest,
    same_job_scoped_authority_digest: scopedAuthority.authority_digest,
    fully_reachable_record_manifest_digest:
      loaded.fully_reachable_record_manifest_digest,
    capability_attestation_commit_sha:
      loaded.capability.attestation_commit_sha,
    capability_input_digest: loaded.capability.capability_input_digest,
    controller_release_digest: digestCanonical(
      "codex-review-gate-v2-controller-release",
      loaded.capability.controller_release,
    ),
    post_ref_receipt: structuredClone(loaded.post_ref),
  };
}

function initialEvaluatedScopeAuthority({
  evaluated_scope_receipt: evaluatedScopeReceipt,
  lease_authority: leaseAuthority,
}) {
  return {
    relation: evaluatedScopeReceipt.relation,
    record_evaluated_scope_receipt_digest:
      evaluatedScopeReceipt.receipt_digest,
    lease_evaluated_scope_receipt_digest:
      leaseAuthority.evaluated_scope_receipt_digest,
    discovery_continuity_receipt:
      structuredClone(evaluatedScopeReceipt.discovery_continuity_receipt),
    provider_pre_scope_receipt_digest:
      evaluatedScopeReceipt.relation === "provider-selector"
        ? evaluatedScopeReceipt.provider_artifact_receipt
          .pre_scope_receipt_digest
        : null,
  };
}

function validateInitialActiveLeaseAuthority({
  loaded,
  evaluated_scope_receipt: evaluatedScopeReceipt,
  workflow_command: command,
}) {
  const active = loaded.active_lease;
  if (
    active === null ||
    canonicalJson(active.scope) !== canonicalJson(evaluatedScopeReceipt.scope) ||
    active.owner.run_id !== command.invocation.run_id ||
    active.owner.run_attempt !== command.invocation.run_attempt ||
    active.owner.actor_id !== command.invocation.actor_id
  ) {
    throw ledgerError(
      "initial-active-lease-mismatch",
      "initial runner authority requires the exact active command-owned lease",
    );
  }
  validateFullDiscoveryScopeLineage(
    active.evaluated_scope_receipt,
    evaluatedScopeReceipt,
    active,
  );
  const acquire = loaded.records.find((entry) =>
    entry.commit_sha === active.acquire_commit_sha);
  if (acquire?.envelope.record_type !== "lease-acquire") {
    throw ledgerError(
      "initial-lease-acquire-unreachable",
      "initial runner active lease acquire is not reachable",
    );
  }
  return {
    lease_id: active.lease_id,
    owner: structuredClone(active.owner),
    acquire_commit_sha: active.acquire_commit_sha,
    acquired_at: active.acquired_at,
    expires_at: active.expires_at,
    evaluated_scope_receipt_digest:
      active.evaluated_scope_receipt.receipt_digest,
  };
}

function initialRunnerScheduling({
  repository,
  scope,
  command,
  public_wait_supported: publicWaitSupported,
  started_at: startedAt,
}) {
  return {
    trigger: command.route.trigger,
    public_wait_supported: publicWaitSupported,
    status_target_mode: command.workflow_receipt.status_target_mode,
    run_identity: {
      run_id: command.invocation.run_id,
      run_attempt: command.invocation.run_attempt,
    },
    epoch: {
      id: runnerEpochId(
        repository.node_id,
        scope.pull_request.node_id,
        scope.head_ref_oid,
      ),
      started_at: startedAt,
      controlled_request: null,
      automatic_request: {
        state: "available",
        intent_id: null,
        intent_persisted_at: null,
        effect_attempted_at: null,
      },
    },
    complete_snapshots: [],
    status: {
      exact_sha_context_count: 0,
      latest_idempotency_key: null,
      head_sentinel_receipt: null,
    },
    applied_action_keys: [],
    no_start_candidate: null,
  };
}

function validateFullDiscoveryLease({
  loaded,
  lease_receipt: leaseReceipt,
  pre_scope_receipt: preScopeReceipt,
}) {
  if (
    loaded.active_lease === null ||
    loaded.active_lease.acquire_commit_sha !== leaseReceipt.acquire_commit_sha ||
    loaded.active_lease.lease_id !== leaseReceipt.lease_id ||
    canonicalJson(loaded.active_lease.owner) !==
      canonicalJson(leaseReceipt.owner) ||
    canonicalJson(loaded.active_lease.scope) !==
      canonicalJson(leaseReceipt.scope) ||
    canonicalJson(loaded.active_lease.evaluated_scope_receipt) !==
      canonicalJson(preScopeReceipt)
  ) {
    throw ledgerError(
      "provider-full-discovery-lease-mismatch",
      "full discovery requires the exact active pre-scope lease",
    );
  }
}

async function projectDiscoveryContinuityAuthority({
  handle,
  repository,
  scope,
  pre_scope_receipt: preScopeReceipt,
  lease_receipt: leaseReceipt,
}) {
  const module = await import("./workflow-controller.mjs");
  if (
    typeof module.assertV2LeasedDiscoveryContinuityHandle !== "function" ||
    typeof module.projectV2LeasedDiscoveryContinuityForGitLedger !== "function"
  ) {
    throw ledgerError(
      "leased-discovery-continuity-authority-unavailable",
      "leased discovery continuity adapter is unavailable",
    );
  }
  module.assertV2LeasedDiscoveryContinuityHandle(handle, {
    repository: structuredClone(repository),
    scope: structuredClone(scope),
    pre_scope_receipt: preScopeReceipt,
    lease_receipt: leaseReceipt,
  });
  const projection = module.projectV2LeasedDiscoveryContinuityForGitLedger(
    handle,
  );
  assertObject(projection, "leased discovery continuity projection");
  exactKeys(projection, [
    "continuity_receipt", "discovery_snapshot", "effective_limits",
    "minimal_pre", "minimal_post",
  ], "leased discovery continuity projection");
  const rebuilt = createV2GitLedgerDiscoveryContinuityReceipt({
    repository,
    scope,
    pre_scope_receipt_digest: preScopeReceipt.receipt_digest,
    lease_receipt: leaseReceipt,
    discovery_snapshot: projection.discovery_snapshot,
    transport_limits: projection.effective_limits,
    minimal_pre: projection.minimal_pre,
    minimal_post: projection.minimal_post,
  });
  if (
    canonicalJson(rebuilt) !== canonicalJson(projection.continuity_receipt) ||
    canonicalJson(rebuilt) !== canonicalJson(handle.continuity_receipt)
  ) {
    throw ledgerError(
      "leased-discovery-continuity-binding-mismatch",
      "leased discovery continuity projection changed after sealing",
    );
  }
  return deepFreeze({
    continuity_receipt: rebuilt,
    discovery_snapshot: projection.discovery_snapshot,
    effective_limits: structuredClone(projection.effective_limits),
    minimal_pre: projection.minimal_pre,
    minimal_post: projection.minimal_post,
  });
}

function normalizeEvaluatedProviderIdentityAuthority(value, relation) {
  if (relation !== "provider-selector") {
    if (value !== null) {
      throw new Error("non-provider scope cannot carry provider identity authority");
    }
    return null;
  }
  return normalizeProviderIdentityAuthorityStructure(value);
}

async function providerIdentityAuthorityFromPreflight(
  preflightHandle,
  policy,
  repository,
) {
  if (preflightHandle === null) {
    throw ledgerError(
      "provider-identity-authority-required",
      "provider records require one branded same-job live preflight",
    );
  }
  const module = await import("./workflow-preflight.mjs");
  if (typeof module.assertV2WorkflowPreflightHandle !== "function") {
    throw ledgerError(
      "provider-identity-authority-unavailable",
      "workflow preflight authority validator is unavailable",
    );
  }
  const preflight = module.assertV2WorkflowPreflightHandle(preflightHandle);
  if (
    preflight.repository.owner !== repository.owner ||
    preflight.repository.name !== repository.name ||
    preflight.repository.id !== repository.id ||
    preflight.repository.node_id !== repository.node_id ||
    preflight.repository.owner_id !== repository.owner_id
  ) {
    throw ledgerError(
      "provider-identity-repository-mismatch",
      "live provider identity authority belongs to another repository preflight",
    );
  }
  return normalizeProviderIdentityAuthority(
    preflight.provider_identity_authority,
    policy,
  );
}

async function validateStoredProviderIdentityAuthorities(
  records,
  policy,
  preflightHandle,
  repository,
) {
  const stored = records.flatMap((entry) => {
    const receipt = entry.envelope.workflow_provenance
      ?.operation_binding?.evaluated_scope_receipt;
    return receipt?.relation === "provider-selector"
      ? [receipt.provider_identity_authority]
      : [];
  });
  if (stored.length === 0) return;
  const live = await providerIdentityAuthorityFromPreflight(
    preflightHandle,
    policy,
    repository,
  );
  for (const authority of stored) {
    const normalized = normalizeProviderIdentityAuthority(authority, policy);
    if (
      normalized.catalog_version !== live.catalog_version ||
      canonicalJson(normalized.actor) !== canonicalJson(live.actor) ||
      canonicalJson(normalized.app) !== canonicalJson(live.app)
    ) {
      throw ledgerError(
        "provider-identity-catalog-drift",
        "stored provider identity differs from the current live attested catalog",
      );
    }
  }
}

function validateProviderIdentityEndpointReceipt(value, path, label) {
  assertObject(value, label);
  exactKeys(value, [
    "method", "path", "status", "server_time", "raw_body_sha256",
  ], label);
  if (value.method !== "GET" || value.path !== path || value.status !== 200) {
    throw ledgerError(
      "provider-identity-endpoint-mismatch",
      `${label} does not bind the official catalog endpoint`,
    );
  }
  timestamp(value.server_time, `${label}.server_time`);
  digest(value.raw_body_sha256, `${label}.raw_body_sha256`);
}

function providerEvaluatedScopeSelector(artifactEntry, scopeValue) {
  assertObject(artifactEntry, "provider artifact entry");
  exactKeys(artifactEntry, [
    "selector", "artifact", "response_server_time", "raw_body_sha256",
  ], "provider artifact entry");
  const scope = normalizeEffectScope(scopeValue);
  if (scope === null) {
    throw new TypeError("provider artifact requires one exact PR scope");
  }
  const carrier = normalizeCarrierSelector(
    artifactEntry.selector,
    "provider artifact selector",
  );
  assertObject(artifactEntry.artifact, "provider artifact");
  const actor = structuredClone(artifactEntry.artifact.author);
  const app = structuredClone(artifactEntry.artifact.app);
  validateExternalActor(actor, "provider artifact actor");
  validateExternalApp(app, "provider artifact app");
  validateCodexProvider(actor, app, "provider artifact provider");
  return {
    kind: carrier.kind,
    id: carrier.id,
    node_id: boundedString(
      artifactEntry.artifact.node_id,
      "provider artifact node_id",
      256,
    ),
    url: githubUrl(
      artifactEntry.artifact.html_url,
      "provider artifact html_url",
    ),
    pull_request_number: scope.pull_request.number,
    pull_request_node_id: scope.pull_request.node_id,
    actor,
    app,
    server_time: timestamp(
      artifactEntry.response_server_time,
      "provider artifact response_server_time",
    ),
    raw_body_sha256: digest(
      artifactEntry.raw_body_sha256,
      "provider artifact raw_body_sha256",
    ),
  };
}

function providerArtifactContinuityReceipt({
  phase,
  preScopeReceiptDigest,
  selector,
  artifactEntry,
  snapshotDigest = null,
}) {
  const { server_time: observedAt, ...stableSelector } = selector;
  const stableCarrier = {
    selector: stableSelector,
    artifact: structuredClone(artifactEntry.artifact),
    raw_body_sha256: artifactEntry.raw_body_sha256,
  };
  return {
    phase,
    pre_scope_receipt_digest: preScopeReceiptDigest,
    carrier_digest: digestCanonical(
      "codex-review-gate-v2-provider-artifact-carrier",
      stableCarrier,
    ),
    snapshot_digest: snapshotDigest,
    observed_at: observedAt,
  };
}

function validateFactoryEvaluatedScopeHandle({
  raw_receipt: rawReceipt,
  receipt,
  record,
  provider_pre_scope_receipts: providerPreScopeReceipts,
  full_scope_receipts: fullScopeReceipts,
  provider_full_scope_receipts: providerFullScopeReceipts,
  manual_scope_receipts: manualScopeReceipts,
  evaluated_scope_receipts: evaluatedScopeReceipts,
}) {
  if (
    rawReceipt !== receipt &&
    canonicalJson(rawReceipt) !== canonicalJson(receipt)
  ) {
    throw ledgerError(
      "evaluated-scope-normalization-mismatch",
      "evaluated scope changed during closed validation",
    );
  }
  // A release is the fail-closed crash-recovery path. Its authority comes
  // from the exact reachable lease-acquire receipt, reloaded and compared
  // below before any Git object write. Requiring an in-process WeakSet brand
  // here would make a lease impossible to release after a job restart.
  if (record.record_type === "lease-release") return;
  if (new Set([
    "scheduled-repository-inventory",
    "scheduled-repository-dispatch",
  ]).has(receipt.relation)) return;
  if (!evaluatedScopeReceipts.has(rawReceipt)) {
    throw ledgerError(
      "untrusted-evaluated-scope-receipt",
      "PR authority requires the exact factory-created live-scope receipt",
    );
  }
  const leaseAcquire = record.record_type === "lease-acquire";
  if (
    leaseAcquire && receipt.phase !== "pre-scope" ||
    !leaseAcquire &&
      (receipt.phase !== "full-discovery" ||
        !fullScopeReceipts.has(rawReceipt))
  ) {
    throw ledgerError(
      leaseAcquire
        ? "pre-scope-receipt-required"
        : "full-discovery-receipt-required",
      leaseAcquire
        ? "lease acquire requires the exact pre-scope authority"
        : "PR effects require the exact full-discovery authority",
    );
  }
  if (receipt.relation === "manual-pull-request") {
    if (!manualScopeReceipts.has(rawReceipt)) {
      throw ledgerError(
        "untrusted-manual-scope-receipt",
        "manual authority requires the exact factory-created workflow input receipt",
      );
    }
    return;
  }
  if (receipt.relation !== "provider-selector") return;
  const phase = receipt.provider_artifact_receipt.phase;
  const preScopeRecord = leaseAcquire;
  if (
    preScopeRecord &&
    (phase !== "pre-scope" || !providerPreScopeReceipts.has(rawReceipt))
  ) {
    throw ledgerError(
      "untrusted-provider-pre-scope-receipt",
      "provider lease authority requires the exact factory-created pre-scope receipt",
    );
  }
  if (
    !preScopeRecord &&
    (phase !== "full-discovery" || !providerFullScopeReceipts.has(rawReceipt))
  ) {
    throw ledgerError(
      "untrusted-provider-full-scope-receipt",
      "provider effects require the exact factory-created full-discovery receipt",
    );
  }
}

function validateInitialRunnerStateAppendAdmission({
  raw_handle: rawHandle,
  local_handles: localHandles,
  consumed_handles: consumedHandles,
  record,
  evaluated_scope_receipt: evaluatedScopeReceipt,
  loaded,
  write_fence: writeFence,
}) {
  const schedulerIntent =
    record.record_type === "effect-intent" &&
    record.kind === "scheduler-observation";
  if (!schedulerIntent) {
    if (rawHandle !== null) {
      throw ledgerError(
        "initial-runner-authority-kind-mismatch",
        "initial runner authority can authorize only one scheduler observation",
      );
    }
    return null;
  }
  const priorObservations = schedulerObservationRecords(
    loaded.records,
    recordScope(record),
  );
  if (priorObservations.length !== 0) {
    if (
      rawHandle !== null ||
      record.payload.action.initial_runner_state_authority !== null
    ) {
      throw ledgerError(
        "initial-runner-authority-replayed",
        "later scheduler observation cannot reuse initial authority",
      );
    }
    return null;
  }
  if (rawHandle === null) {
    throw ledgerError(
      "initial-runner-authority-required",
      "first scheduler observation requires one exact factory handle",
    );
  }
  const local = localHandles.get(rawHandle);
  if (local === undefined) {
    throw ledgerError(
      "UNTRUSTED_INITIAL_RUNNER_STATE_AUTHORITY_HANDLE",
      "first scheduler observation rejects a serialized or foreign authority",
    );
  }
  assertV2GitLedgerInitialRunnerStateAuthorityHandle(rawHandle, {
    control_plane_authority: local.control_plane_authority,
    evaluated_scope_receipt: evaluatedScopeReceipt,
    workflow_command_handle: local.workflow_command_handle,
    preflight_handle: local.preflight_handle,
  });
  if (consumedHandles.has(rawHandle)) {
    throw ledgerError(
      "initial-runner-authority-replayed",
      "initial runner authority is already consumed",
    );
  }
  const actionAuthority = record.payload.action.initial_runner_state_authority;
  if (
    canonicalJson(actionAuthority) !== canonicalJson(rawHandle) ||
    rawHandle.source_authority.tip_commit_sha !== loaded.tip_commit_sha ||
    rawHandle.source_authority.tip_commit_sha !==
      writeFence.target_commit_sha ||
    rawHandle.lease_authority.acquire_commit_sha !==
      loaded.active_lease?.acquire_commit_sha ||
    local.evaluated_scope_receipt !== evaluatedScopeReceipt ||
    canonicalJson(record.payload.action.prior_scheduling) !==
      canonicalJson(rawHandle.scheduling) ||
    canonicalJson(record.payload.action.prior_head_ledger) !==
      canonicalJson(rawHandle.head_ledger) ||
    record.payload.action.prior_authority_digest !==
      rawHandle.prior_authority_digest
  ) {
    throw ledgerError(
      "initial-runner-authority-binding-mismatch",
      "first scheduler observation differs from its exact initial authority",
    );
  }
  return rawHandle;
}

function validateEstablishedRunnerStateAppendAdmission({
  raw_handle: rawHandle,
  local_handles: localHandles,
  consumed_handles: consumedHandles,
  record,
  evaluated_scope_receipt: evaluatedScopeReceipt,
  loaded,
  write_fence: writeFence,
}) {
  const schedulerIntent =
    record.record_type === "effect-intent" &&
    record.kind === "scheduler-observation";
  if (!schedulerIntent) {
    if (rawHandle !== null) {
      throw ledgerError(
        "established-runner-authority-kind-mismatch",
        "established runner authority can authorize only one scheduler observation",
      );
    }
    return null;
  }
  const priorObservations = schedulerObservationRecords(
    loaded.records,
    recordScope(record),
  );
  if (priorObservations.length === 0) {
    if (rawHandle !== null) {
      throw ledgerError(
        "established-runner-history-required",
        "first scheduler observation cannot consume established authority",
      );
    }
    return null;
  }
  if (rawHandle === null) {
    throw ledgerError(
      "established-runner-authority-required",
      "later scheduler observation requires one exact factory handle",
    );
  }
  const local = localHandles.get(rawHandle);
  if (local === undefined) {
    throw ledgerError(
      "UNTRUSTED_ESTABLISHED_RUNNER_STATE_AUTHORITY_HANDLE",
      "later scheduler observation rejects a serialized or foreign authority",
    );
  }
  assertV2GitLedgerEstablishedRunnerStateAuthorityHandle(rawHandle, {
    control_plane_authority: local.control_plane_authority,
    evaluated_scope_receipt: evaluatedScopeReceipt,
    workflow_command_handle: local.workflow_command_handle,
    preflight_handle: local.preflight_handle,
  });
  if (consumedHandles.has(rawHandle)) {
    throw ledgerError(
      "established-runner-authority-replayed",
      "established runner authority is already consumed",
    );
  }
  if (
    record.payload.action.initial_runner_state_authority !== null ||
    rawHandle.source_authority.tip_commit_sha !== loaded.tip_commit_sha ||
    rawHandle.source_authority.tip_commit_sha !==
      writeFence.target_commit_sha ||
    rawHandle.lease_authority.acquire_commit_sha !==
      loaded.active_lease?.acquire_commit_sha ||
    local.evaluated_scope_receipt !== evaluatedScopeReceipt ||
    canonicalJson(record.payload.action.prior_scheduling) !==
      canonicalJson(rawHandle.scheduling) ||
    canonicalJson(record.payload.action.prior_head_ledger) !==
      canonicalJson(rawHandle.head_ledger) ||
    record.payload.action.prior_authority_digest !==
      rawHandle.prior_authority_digest
  ) {
    throw ledgerError(
      "established-runner-authority-binding-mismatch",
      "later scheduler observation differs from its exact established authority",
    );
  }
  return rawHandle;
}

export function createV2GitLedgerCandidateInventoryEvaluatedScopeReceipt({
  repository,
  payload: payloadValue,
  trigger_identity,
  repository_endpoint_receipt,
}) {
  const payload = validateV2GitLedgerCandidateInventoryPayload(
    payloadValue,
    { repository },
  );
  const evidence = payload.phase === "cycle-start"
    ? payload.initial_inventory
    : payload.phase === "shard"
      ? payload.shard_receipt
      : payload.cycle_receipt;
  return createV2GitLedgerEvaluatedScopeReceipt({
    relation: "scheduled-repository-inventory",
    repository,
    scope: null,
    trigger_identity,
    selector: null,
    inventory_receipt: {
      phase: payload.phase,
      cycle_id: payload.cycle_id,
      initial_inventory_receipt_digest:
        payload.initial_inventory_receipt_digest,
      shard_index: payload.phase === "shard"
        ? payload.shard_receipt.shard_index
        : null,
      evidence_receipt_digest: evidence.receipt_digest,
      observed_at: evidence.observed_at,
    },
    provider_artifact_receipt: null,
    provider_identity_authority: null,
    scope_endpoint_receipt: repository_endpoint_receipt,
  });
}

export function createV2GitLedgerCandidateDispatchEvaluatedScopeReceipt({
  repository,
  payload: payloadValue,
  trigger_identity,
  repository_endpoint_receipt,
}) {
  const payload = validateV2GitLedgerCandidateDispatchPayload(
    payloadValue,
    { repository },
  );
  const phaseEvidence = payload.reservation ?? payload.candidate_ack ??
    payload.batch_completion ?? payload.cycle_completion;
  const reservationDigest = payload.reservation?.reservation_digest ??
    payload.candidate_ack?.reservation_digest ??
    payload.batch_completion?.reservation_digest ?? null;
  const dispatchDigest = payload.reservation?.dispatch_digest ??
    payload.candidate_ack?.dispatch_digest ??
    payload.batch_completion?.dispatch_digest ?? null;
  const batchIndex = payload.reservation?.batch_index ??
    payload.candidate_ack?.batch_index ??
    payload.batch_completion?.batch_index ?? null;
  const candidateNumber = payload.candidate_ack?.candidate.number ?? null;
  const resultDigest = payload.candidate_ack?.result.result_digest ?? null;
  return createV2GitLedgerEvaluatedScopeReceipt({
    relation: "scheduled-repository-dispatch",
    repository,
    scope: null,
    trigger_identity,
    selector: null,
    inventory_receipt: {
      phase: payload.phase,
      generation_id: payload.generation_id,
      cycle_id: payload.cycle_id,
      inventory_digest: payload.inventory_digest,
      reservation_digest: reservationDigest,
      dispatch_digest: dispatchDigest,
      batch_index: batchIndex,
      candidate_number: candidateNumber,
      result_digest: resultDigest,
      evidence_digest: digestCanonical(
        "codex-review-gate-v2-candidate-dispatch-evidence",
        phaseEvidence,
      ),
    },
    provider_artifact_receipt: null,
    provider_identity_authority: null,
    scope_endpoint_receipt: repository_endpoint_receipt,
  });
}

function createScheduledPullRequestEvaluatedScopeReceiptFromAuthority({
  repository,
  scope,
  trigger_identity,
  scope_endpoint_receipt,
  candidate_authority,
  dispatch_authority,
}) {
  const inventoryReceipt = scheduledPullRequestInventoryReceipt(
    candidate_authority,
    dispatch_authority,
    scope,
    repository,
  );
  return createV2GitLedgerEvaluatedScopeReceipt({
    relation: "scheduled-pull-request",
    repository,
    scope,
    trigger_identity,
    selector: null,
    inventory_receipt: inventoryReceipt,
    provider_artifact_receipt: null,
    provider_identity_authority: null,
    scope_endpoint_receipt,
  });
}

function scheduledPullRequestInventoryReceipt(
  authority,
  dispatchAuthority,
  scope,
  repository,
) {
  assertObject(authority, "candidate inventory authority");
  if (
    authority.schema !== V2_GIT_LEDGER_CANDIDATE_INVENTORY_AUTHORITY_SCHEMA ||
    authority.schema_version !== 1 || authority.completed_cycle === null ||
    authority.open_pr_discovery?.bootstrap_complete !== true ||
    canonicalJson(normalizeRepository(authority.repository)) !==
      canonicalJson(normalizeRepository(repository))
  ) {
    throw ledgerError(
      "candidate-inventory-incomplete",
      "scheduled PR effects require one completed protected candidate cycle",
    );
  }
  const observation = authority.open_pr_discovery.current_open_pull_requests
    .find((item) =>
      item.number === scope.pull_request.number &&
      item.node_id === scope.pull_request.node_id);
  if (
    observation === undefined || observation.state !== "open" ||
    observation.merged !== false || observation.merged_at !== null ||
    observation.head.sha !== scope.head_ref_oid ||
    observation.base.sha !== scope.base_ref_oid
  ) {
    throw ledgerError(
      "candidate-inventory-scope-mismatch",
      "scheduled PR scope is not one current open candidate exact GET",
    );
  }
  const candidate = authority.open_pr_discovery.candidates.find((item) =>
    item.number === scope.pull_request.number &&
    item.node_id === scope.pull_request.node_id);
  if (candidate === undefined) {
    throw ledgerError(
      "candidate-inventory-scope-mismatch",
      "scheduled PR scope is absent from the durable candidate superset",
    );
  }
  assertObject(dispatchAuthority, "candidate dispatch authority");
  if (
    dispatchAuthority.schema !==
      V2_GIT_LEDGER_CANDIDATE_DISPATCH_AUTHORITY_SCHEMA ||
    dispatchAuthority.schema_version !== 1 ||
    canonicalJson(normalizeRepository(dispatchAuthority.repository)) !==
      canonicalJson(normalizeRepository(repository))
  ) {
    throw ledgerError(
      "candidate-dispatch-authority-mismatch",
      "scheduled PR scope lacks one protected candidate dispatch authority",
    );
  }
  const active = dispatchAuthority.active_reservation;
  if (
    active === null ||
    active.reservation.candidate_inventory_authority_digest !==
      authority.authority_digest
  ) {
    throw ledgerError(
      "candidate-dispatch-reservation-required",
      "scheduled PR scope is outside the unique active dispatch reservation",
    );
  }
  const selectedIndex = active.reservation.candidates.findIndex((item) =>
    item.number === scope.pull_request.number &&
    item.node_id === scope.pull_request.node_id);
  if (
    selectedIndex < 0 || active.acknowledgements.some((item) =>
      item.candidate_index === selectedIndex) ||
    canonicalJson(active.reservation.candidates[selectedIndex]) !==
      canonicalJson(candidateDispatchSelectionFromObservation(observation))
  ) {
    throw ledgerError(
      "candidate-dispatch-scope-mismatch",
      "scheduled PR scope is absent or already acknowledged in the active batch",
    );
  }
  return {
    candidate_authority_digest: authority.authority_digest,
    candidate_dispatch_authority_digest: dispatchAuthority.authority_digest,
    completed_cycle_record_oid: authority.completed_cycle.complete_record_oid,
    cycle_receipt_digest:
      authority.completed_cycle.cycle_receipt.receipt_digest,
    dispatch_generation_id: active.reservation.generation_id,
    dispatch_cycle_id: active.reservation.cycle_id,
    dispatch_reservation_record_oid: active.reservation_record_oid,
    dispatch_reservation_digest: active.reservation.reservation_digest,
    dispatch_digest: active.reservation.dispatch_digest,
    dispatch_batch_index: active.reservation.batch_index,
    dispatch_batch_count: active.reservation.batch_count,
    dispatch_candidate_index: selectedIndex,
    selected_candidate: structuredClone(candidate),
    selected_pull_request_number: scope.pull_request.number,
    selected_pull_request_node_id: scope.pull_request.node_id,
    selected_observation_raw_body_sha256:
      observation.endpoint_receipt.raw_body_sha256,
    server_time: observation.endpoint_receipt.server_time,
    inventory_digest:
      authority.completed_cycle.final_inventory.candidate_digest,
  };
}

function validateEvaluatedScopeAuthorityForAppend(
  records,
  record,
  receipt,
  repository,
) {
  if (receipt.relation === "scheduled-pull-request") {
    const authority = deriveV2GitLedgerCandidateInventoryAuthority(
      records,
      repository,
    );
    const dispatchAuthority = deriveV2GitLedgerCandidateDispatchAuthority(
      records,
      repository,
    );
    validateScheduledPullRequestInventoryBinding(
      authority,
      dispatchAuthority,
      recordScope(record),
      receipt,
      repository,
    );
  }
  const activeLease = projectedActiveLease(records);
  validateEvaluatedScopeLeaseLineage(record, receipt, activeLease);
}

function projectedActiveLease(records) {
  let activeLease = null;
  for (const [recordIndex, entry] of records.entries()) {
    const envelope = entry.envelope;
    if (envelope.record_type === "lease-acquire") {
      activeLease = {
        lease_id: envelope.payload.lease_id,
        acquire_commit_sha: entry.commit_sha,
        evaluated_scope_receipt:
          envelope.workflow_provenance.operation_binding
            .evaluated_scope_receipt,
      };
    } else if (envelope.record_type === "lease-release") {
      activeLease = null;
    }
  }
  return activeLease;
}

function validateEvaluatedScopeLeaseLineage(record, receipt, activeLease) {
  if (record.record_type === "candidate-dispatch-observation") {
    // Repository-scoped dispatch transitions are authorized by their closed
    // transition validator. In particular, an expiry recovery ack must not
    // masquerade as a PR effect merely because its acquire remains in history.
    return;
  }
  if (record.record_type === "lease-acquire") {
    if (
      receipt.phase !== "pre-scope" ||
      receipt.discovery_continuity_receipt !== null ||
      receipt.relation === "provider-selector" &&
        receipt.provider_artifact_receipt.phase !== "pre-scope"
    ) {
      throw ledgerError(
        "pre-scope-receipt-required",
        "lease acquire requires one exact pre-scope authority",
      );
    }
    return;
  }
  if (activeLease === null) return;
  const acquireReceipt = activeLease.evaluated_scope_receipt;
  if (record.record_type === "lease-release") {
    if (canonicalJson(receipt) !== canonicalJson(acquireReceipt)) {
      throw ledgerError(
        "lease-scope-authority-mismatch",
        "lease release must cite its exact acquire evaluated scope",
      );
    }
    return;
  }
  validateFullDiscoveryScopeLineage(acquireReceipt, receipt, activeLease);
  if (acquireReceipt.relation === "manual-pull-request") {
    validateManualEffectPolicy(record);
  }
}

function validateFullDiscoveryScopeLineage(pre, full, activeLease) {
  const continuity = full.discovery_continuity_receipt;
  if (
    pre.phase !== "pre-scope" ||
    pre.discovery_continuity_receipt !== null ||
    full.phase !== "full-discovery" ||
    continuity === null ||
    continuity.pre_scope_receipt_digest !== pre.receipt_digest ||
    continuity.lease.acquire_commit_sha !== activeLease.acquire_commit_sha ||
    full.relation !== pre.relation ||
    canonicalJson(full.repository) !== canonicalJson(pre.repository) ||
    canonicalJson(full.scope) !== canonicalJson(pre.scope) ||
    full.trigger_event_name !== pre.trigger_event_name ||
    full.trigger_ref !== pre.trigger_ref ||
    full.trigger_sha !== pre.trigger_sha ||
    canonicalJson(full.inventory_receipt) !==
      canonicalJson(pre.inventory_receipt) ||
    canonicalJson(full.provider_identity_authority) !==
      canonicalJson(pre.provider_identity_authority) ||
    canonicalJson(full.scope_endpoint_receipt) !==
      canonicalJson(pre.scope_endpoint_receipt)
  ) {
    throw ledgerError(
      "full-discovery-lineage-mismatch",
      "full discovery does not exact-bind its active pre-scope lease",
    );
  }
  if (pre.relation === "provider-selector") {
    validateProviderFullScopeLineage(pre, full);
  } else if (
    canonicalJson(full.selector) !== canonicalJson(pre.selector) ||
    full.provider_artifact_receipt !== null
  ) {
    throw ledgerError(
      "full-discovery-lineage-mismatch",
      "full discovery changes its pre-scope selector authority",
    );
  }
}

function validateProviderFullScopeLineage(pre, full) {
  if (
    pre.phase !== "pre-scope" ||
    full.phase !== "full-discovery" ||
    full.relation !== "provider-selector" ||
    full.provider_artifact_receipt.phase !== "full-discovery" ||
    full.provider_artifact_receipt.pre_scope_receipt_digest !==
      pre.receipt_digest ||
    full.provider_artifact_receipt.carrier_digest !==
      pre.provider_artifact_receipt.carrier_digest ||
    full.provider_artifact_receipt.snapshot_digest !==
      full.discovery_continuity_receipt?.full_snapshot.snapshot_digest ||
    canonicalJson(full.provider_identity_authority) !==
      canonicalJson(pre.provider_identity_authority) ||
    Date.parse(full.provider_artifact_receipt.observed_at) <
      Date.parse(pre.provider_artifact_receipt.observed_at) ||
    canonicalJson(full.repository) !== canonicalJson(pre.repository) ||
    canonicalJson(full.scope) !== canonicalJson(pre.scope) ||
    full.trigger_event_name !== pre.trigger_event_name ||
    full.trigger_ref !== pre.trigger_ref ||
    full.trigger_sha !== pre.trigger_sha ||
    canonicalJson(providerSelectorStable(full.selector)) !==
      canonicalJson(providerSelectorStable(pre.selector))
  ) {
    throw ledgerError(
      "provider-artifact-lineage-mismatch",
      "provider full discovery does not exact-bind its pre-lease carrier",
    );
  }
}

function providerSelectorStable(value) {
  const { server_time: _serverTime, ...stable } = value;
  return stable;
}

function validateManualEffectPolicy(record) {
  if (
    record.record_type !== "effect-intent" ||
    !new Set([
      "scheduler-observation",
      "thread-resolution-observation",
    ]).has(record.kind)
  ) {
    throw ledgerError(
      "manual-publication-forbidden",
      "manual evaluated scope cannot append an external publication effect",
    );
  }
}

function validateScheduledPullRequestInventoryBinding(
  authority,
  dispatchAuthority,
  scope,
  receipt,
  repository,
) {
  const expected = scheduledPullRequestInventoryReceipt(
    authority,
    dispatchAuthority,
    scope,
    repository,
  );
  if (canonicalJson(receipt.inventory_receipt) !== canonicalJson(expected)) {
    throw ledgerError(
      "candidate-inventory-authority-mismatch",
      "scheduled PR evaluated scope differs from protected candidate authority",
    );
  }
}

function validateScheduledDispatchReceiptAgainstReservation(
  receipt,
  reservation,
  candidate,
  { allow_pre_scope: allowPreScope = false } = {},
) {
  const inventory = receipt.inventory_receipt;
  if (
    receipt.relation !== "scheduled-pull-request" ||
    !(receipt.phase === "full-discovery" ||
      allowPreScope && receipt.phase === "pre-scope") ||
    inventory.dispatch_generation_id !== reservation.generation_id ||
    inventory.dispatch_cycle_id !== reservation.cycle_id ||
    inventory.dispatch_reservation_digest !== reservation.reservation_digest ||
    inventory.dispatch_digest !== reservation.dispatch_digest ||
    inventory.dispatch_batch_index !== reservation.batch_index ||
    inventory.dispatch_batch_count !== reservation.batch_count ||
    inventory.dispatch_candidate_index !==
      reservation.candidates.findIndex((item) =>
        canonicalJson(item) === canonicalJson(candidate)) ||
    receipt.scope.pull_request.number !== candidate.number ||
    receipt.scope.pull_request.node_id !== candidate.node_id ||
    receipt.scope.head_ref_oid !== candidate.head_ref_oid ||
    receipt.scope.base_ref_oid !== candidate.base_ref_oid
  ) {
    throw ledgerError(
      "candidate-dispatch-scheduled-scope-mismatch",
      "scheduled PR authority differs from its active dispatch reservation",
    );
  }
}

export function createV2GitLedgerCandidateInventoryRecord({
  predecessor_commit_sha,
  owner,
  server_observed_at,
  payload,
}) {
  const normalizedPayload = structuredClone(payload);
  if (canonicalJson(normalizedPayload.owner) !==
      canonicalJson(normalizeLeaseOwner(owner))) {
    throw new Error("candidate inventory record owner differs from its payload");
  }
  return createV2GitLedgerRecord({
    record_type: "candidate-inventory-observation",
    predecessor_commit_sha,
    pull_request: null,
    head_ref_oid: null,
    base_ref_oid: null,
    potential_merge_commit_oid: null,
    kind: null,
    effect_id: null,
    idempotency_key: null,
    server_observed_at,
    payload: normalizedPayload,
    control_comment_binding: null,
    lease: null,
  });
}

export function validateV2GitLedgerCandidateInventoryPayload(
  value,
  expected = null,
) {
  assertObject(value, "candidate inventory ledger payload");
  exactKeys(value, [
    "schema", "schema_version", "phase", "cycle_id", "owner",
    "prior_candidate_authority_digest", "supersedes_incomplete_cycle_id",
    "initial_inventory_receipt_digest", "initial_inventory",
    "shard_receipt", "final_inventory", "cycle_receipt",
  ], "candidate inventory ledger payload");
  if (
    value.schema !== V2_GIT_LEDGER_CANDIDATE_INVENTORY_RECORD_SCHEMA ||
    value.schema_version !== 1 ||
    !new Set(["cycle-start", "shard", "cycle-complete"]).has(value.phase) ||
    !CANDIDATE_CYCLE_ID.test(value.cycle_id)
  ) {
    throw new Error("candidate inventory ledger payload schema is unsupported");
  }
  normalizeLeaseOwner(value.owner);
  digest(value.prior_candidate_authority_digest,
    "candidate inventory prior authority digest");
  if (value.supersedes_incomplete_cycle_id !== null &&
      !CANDIDATE_CYCLE_ID.test(value.supersedes_incomplete_cycle_id)) {
    throw new Error("candidate inventory superseded cycle identity is invalid");
  }
  digest(value.initial_inventory_receipt_digest,
    "candidate inventory initial receipt digest");
  let repository = null;
  if (value.phase === "cycle-start") {
    if (
      value.initial_inventory === null || value.shard_receipt !== null ||
      value.final_inventory !== null || value.cycle_receipt !== null
    ) {
      throw new Error("candidate inventory cycle start fields are not closed");
    }
    const initial = validateV2CandidateInventory(value.initial_inventory);
    repository = initial.repository;
    if (
      value.initial_inventory_receipt_digest !== initial.receipt_digest ||
      value.cycle_id !==
        `candidate-cycle:${initial.receipt_digest.slice("sha256:".length)}`
    ) {
      throw new Error("candidate inventory cycle identity differs from its receipt");
    }
  } else if (value.phase === "shard") {
    if (
      value.initial_inventory !== null || value.shard_receipt === null ||
      value.final_inventory !== null || value.cycle_receipt !== null ||
      value.supersedes_incomplete_cycle_id !== null
    ) {
      throw new Error("candidate inventory shard fields are not closed");
    }
    assertObject(value.shard_receipt, "candidate inventory shard receipt");
    exactKeys(value.shard_receipt, [
      "schema", "schema_version", "repository", "inventory_receipt_digest",
      "shard_index", "shard_digest", "candidates", "observations",
      "observed_at", "stable", "receipt_digest",
    ], "candidate inventory shard receipt");
    if (
      value.shard_receipt.schema !== V2_CANDIDATE_SHARD_RECEIPT_SCHEMA ||
      value.shard_receipt.schema_version !== 1 ||
      value.shard_receipt.stable !== true ||
      value.shard_receipt.inventory_receipt_digest !==
        value.initial_inventory_receipt_digest
    ) {
      throw new Error("candidate inventory shard receipt identity is invalid");
    }
    repository = normalizeCandidateRepository(value.shard_receipt.repository);
    nonnegativeInteger(value.shard_receipt.shard_index,
      "candidate inventory shard index");
    digest(value.shard_receipt.shard_digest,
      "candidate inventory shard digest");
    timestamp(value.shard_receipt.observed_at,
      "candidate inventory shard observed_at");
    digest(value.shard_receipt.receipt_digest,
      "candidate inventory shard receipt digest");
  } else {
    if (
      value.initial_inventory !== null || value.shard_receipt !== null ||
      value.final_inventory === null || value.cycle_receipt === null ||
      value.supersedes_incomplete_cycle_id !== null
    ) {
      throw new Error("candidate inventory completion fields are not closed");
    }
    const finalInventory = validateV2CandidateInventory(value.final_inventory);
    repository = finalInventory.repository;
    const cycleReceipt = validateV2CandidateCycleReceipt(value.cycle_receipt);
    if (
      cycleReceipt.schema !== V2_CANDIDATE_CYCLE_RECEIPT_SCHEMA ||
      cycleReceipt.initial_inventory_receipt_digest !==
        value.initial_inventory_receipt_digest ||
      cycleReceipt.final_inventory_receipt_digest !==
        finalInventory.receipt_digest
    ) {
      throw new Error("candidate inventory completion receipt identity is invalid");
    }
  }
  if (expected?.repository !== undefined &&
      canonicalJson(repository) !==
        canonicalJson(candidateRepository(expected.repository))) {
    throw new Error("candidate inventory payload belongs to another repository");
  }
  return deepFreeze(structuredClone(value));
}

function validateCandidateEvaluatedScopeBinding(record, receipt) {
  if (record.record_type !== "candidate-inventory-observation") return;
  const payload = validateV2GitLedgerCandidateInventoryPayload(record.payload);
  const evidence = payload.phase === "cycle-start"
    ? payload.initial_inventory
    : payload.phase === "shard"
      ? payload.shard_receipt
      : payload.cycle_receipt;
  const expectedInventoryReceipt = {
    phase: payload.phase,
    cycle_id: payload.cycle_id,
    initial_inventory_receipt_digest:
      payload.initial_inventory_receipt_digest,
    shard_index: payload.phase === "shard"
      ? payload.shard_receipt.shard_index
      : null,
    evidence_receipt_digest: evidence.receipt_digest,
    observed_at: evidence.observed_at,
  };
  if (
    receipt.relation !== "scheduled-repository-inventory" ||
    receipt.scope !== null || receipt.selector !== null ||
    canonicalJson(receipt.inventory_receipt) !==
      canonicalJson(expectedInventoryReceipt)
  ) {
    throw new Error(
      "candidate inventory record differs from its evaluated repository evidence",
    );
  }
}

function validateCandidateDispatchEvaluatedScopeBinding(record, receipt) {
  if (record.record_type !== "candidate-dispatch-observation") return;
  const payload = validateV2GitLedgerCandidateDispatchPayload(record.payload);
  const expected = createV2GitLedgerCandidateDispatchEvaluatedScopeReceipt({
    repository: receipt.repository,
    payload,
    trigger_identity: {
      event_name: receipt.trigger_event_name,
      ref: receipt.trigger_ref,
      sha: receipt.trigger_sha,
    },
    repository_endpoint_receipt: receipt.scope_endpoint_receipt,
  });
  if (canonicalJson(receipt) !== canonicalJson(expected)) {
    throw new Error(
      "candidate dispatch record differs from its evaluated repository authority",
    );
  }
}

export function deriveV2GitLedgerCandidateInventoryAuthority(
  records,
  repositoryValue = null,
) {
  if (!Array.isArray(records) || records.length > MAX_V2_GIT_LEDGER_COMMITS) {
    throw new TypeError(
      "candidate inventory authority requires a bounded reachable record array",
    );
  }
  const repository = normalizeRepository(
    repositoryValue ?? records[0]?.envelope?.repository,
  );
  const state = {
    source_records: [],
    seen_cycle_ids: new Set(),
    completed: null,
    incomplete: null,
  };
  for (const [recordIndex, entry] of records.entries()) {
    assertObject(entry, "candidate inventory authority record");
    if (entry.envelope?.record_type !== "candidate-inventory-observation") {
      continue;
    }
    validateProjectionEnvelope(entry.envelope);
    if (
      canonicalJson(normalizeRepository(entry.envelope.repository)) !==
        canonicalJson(repository)
    ) {
      throw new Error("candidate inventory history crosses repository authority");
    }
    const payload = validateV2GitLedgerCandidateInventoryPayload(
      entry.envelope.payload,
      { repository },
    );
    const current = buildCandidateInventoryAuthority(repository, state);
    if (payload.prior_candidate_authority_digest !== current.authority_digest) {
      throw ledgerError(
        "candidate-inventory-predecessor",
        "candidate inventory record does not bind the prior repository authority",
      );
    }
    const row = candidateInventorySourceRecord(entry);
    validateAndApplyCandidateInventoryTransition({
      payload,
      repository,
      state,
      recordOid: row.record_oid,
      recordServerTime: entry.envelope.server_observed_at,
      apply: true,
    });
    state.source_records.push(row);
  }
  return buildCandidateInventoryAuthority(repository, state);
}

function validateCandidateInventoryTransition(records, record, repository) {
  const authority = deriveV2GitLedgerCandidateInventoryAuthority(
    records,
    repository,
  );
  const state = candidateInventoryStateFromAuthority(authority);
  const payload = validateV2GitLedgerCandidateInventoryPayload(
    record.payload,
    { repository },
  );
  if (payload.prior_candidate_authority_digest !== authority.authority_digest) {
    throw ledgerError(
      "candidate-inventory-predecessor",
      "candidate inventory append does not bind the current repository authority",
    );
  }
  validateAndApplyCandidateInventoryTransition({
    payload,
    repository,
    state,
    recordOid: null,
    recordServerTime: record.server_observed_at,
    apply: false,
  });
}

function candidateInventoryStateFromAuthority(authority) {
  const completed = authority.completed_cycle === null
    ? null
    : structuredClone(authority.completed_cycle);
  const incomplete = authority.incomplete_cycle === null
    ? null
    : structuredClone(authority.incomplete_cycle);
  const seen = new Set();
  for (const row of authority.source_records) {
    if (row.phase === "cycle-start") seen.add(row.cycle_id);
  }
  return {
    source_records: structuredClone(authority.source_records),
    seen_cycle_ids: seen,
    completed,
    incomplete,
  };
}

function validateAndApplyCandidateInventoryTransition({
  payload,
  repository,
  state,
  recordOid,
  recordServerTime,
  apply,
}) {
  const evidence = payload.phase === "cycle-start"
    ? payload.initial_inventory
    : payload.phase === "shard"
      ? payload.shard_receipt
      : payload.cycle_receipt;
  if (Date.parse(evidence.observed_at) > Date.parse(recordServerTime)) {
    throw ledgerError(
      "candidate-inventory-time",
      "candidate inventory evidence is after its protected-ref observation",
    );
  }
  if (payload.phase === "cycle-start") {
    if (state.seen_cycle_ids.has(payload.cycle_id)) {
      throw ledgerError(
        "candidate-inventory-cycle-duplicate",
        "candidate inventory cycle identity is already reachable",
      );
    }
    const expectedSuperseded = state.incomplete?.cycle_id ?? null;
    if (payload.supersedes_incomplete_cycle_id !== expectedSuperseded) {
      throw ledgerError(
        "candidate-inventory-recovery",
        "candidate inventory start does not exactly supersede the incomplete cycle",
      );
    }
    const initial = validateV2CandidateInventory(
      payload.initial_inventory,
      candidateRepository(repository),
    );
    const priorInventory = state.incomplete?.initial_inventory ??
      state.completed?.final_inventory ?? null;
    if (
      initial.prior_inventory_digest !==
        (priorInventory?.receipt_digest ?? null)
    ) {
      throw ledgerError(
        "candidate-inventory-prior",
        "candidate inventory start does not bind the last completed superset",
      );
    }
    requireCandidateSuperset(priorInventory?.candidates ?? [], initial.candidates);
    const stableIds = new Set(initial.passes.at(-1).candidates.map(({ id }) => id));
    const expectedRetained = (priorInventory?.candidates ?? [])
      .filter(({ id }) => !stableIds.has(id))
      .map(({ id }) => id)
      .sort((left, right) =>
        BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0);
    if (
      canonicalJson(expectedRetained) !==
        canonicalJson(initial.retained_prior_candidate_ids)
    ) {
      throw ledgerError(
        "candidate-inventory-retention",
        "candidate inventory does not enumerate every retained prior candidate",
      );
    }
    if (apply) {
      state.seen_cycle_ids.add(payload.cycle_id);
      state.incomplete = {
        cycle_id: payload.cycle_id,
        start_record_oid: sha(recordOid, "candidate inventory start record oid"),
        start_owner: structuredClone(payload.owner),
        initial_inventory: structuredClone(initial),
        shard_record_oids: [],
        shard_receipts: [],
        next_shard_index: 0,
      };
    }
    return;
  }
  if (
    state.incomplete === null ||
    state.incomplete.cycle_id !== payload.cycle_id ||
    payload.initial_inventory_receipt_digest !==
      state.incomplete.initial_inventory.receipt_digest
  ) {
    throw ledgerError(
      "candidate-inventory-cycle",
      "candidate inventory continuation has no exact reachable cycle start",
    );
  }
  if (payload.phase === "shard") {
    const shard = validateV2CandidateShardReceipt(
      payload.shard_receipt,
      state.incomplete.initial_inventory,
    );
    if (shard.shard_index !== state.incomplete.next_shard_index) {
      throw ledgerError(
        "candidate-inventory-shard-order",
        "candidate inventory shard is missing, duplicated, or out of order",
      );
    }
    const previousTime = state.incomplete.shard_receipts.at(-1)?.observed_at ??
      state.incomplete.initial_inventory.observed_at;
    if (Date.parse(shard.observed_at) < Date.parse(previousTime)) {
      throw ledgerError(
        "candidate-inventory-time",
        "candidate inventory shard server time regressed",
      );
    }
    if (apply) {
      state.incomplete.shard_record_oids.push(
        sha(recordOid, "candidate inventory shard record oid"),
      );
      state.incomplete.shard_receipts.push(structuredClone(shard));
      state.incomplete.next_shard_index += 1;
    }
    return;
  }
  const finalInventory = validateV2CandidateInventory(
    payload.final_inventory,
    candidateRepository(repository),
  );
  const previousTime = state.incomplete.shard_receipts.at(-1)?.observed_at ??
    state.incomplete.initial_inventory.observed_at;
  if (Date.parse(finalInventory.observed_at) < Date.parse(previousTime)) {
    throw ledgerError(
      "candidate-inventory-time",
      "candidate inventory final scan server time regressed",
    );
  }
  const recomputed = finalizeV2CandidateInventoryCycle({
    initial_inventory: state.incomplete.initial_inventory,
    shard_receipts: state.incomplete.shard_receipts,
    final_inventory: finalInventory,
  });
  const supplied = validateV2CandidateCycleReceipt(payload.cycle_receipt);
  if (canonicalJson(recomputed) !== canonicalJson(supplied)) {
    throw ledgerError(
      "candidate-inventory-cycle-receipt",
      "candidate inventory completion is not the canonical full-shard cycle",
    );
  }
  if (apply) {
    state.completed = {
      cycle_id: state.incomplete.cycle_id,
      start_record_oid: state.incomplete.start_record_oid,
      start_owner: structuredClone(state.incomplete.start_owner),
      shard_record_oids: structuredClone(state.incomplete.shard_record_oids),
      complete_record_oid: sha(
        recordOid,
        "candidate inventory completion record oid",
      ),
      initial_inventory: structuredClone(state.incomplete.initial_inventory),
      shard_receipts: structuredClone(state.incomplete.shard_receipts),
      final_inventory: structuredClone(finalInventory),
      cycle_receipt: structuredClone(supplied),
    };
    state.incomplete = null;
  }
}

function requireCandidateSuperset(priorCandidates, currentCandidates) {
  const current = new Map(currentCandidates.map((candidate) => [
    candidate.id,
    candidate,
  ]));
  for (const prior of priorCandidates) {
    const retained = current.get(prior.id);
    if (retained === undefined ||
        canonicalJson(retained) !== canonicalJson(prior)) {
      throw ledgerError(
        "candidate-inventory-shrink",
        "candidate inventory omitted or changed a durable prior identity",
      );
    }
  }
}

function candidateInventorySourceRecord(entry) {
  const envelope = entry.envelope;
  return {
    record_oid: sha(entry.commit_sha, "candidate inventory record oid"),
    parent_oid: sha(entry.parents[0], "candidate inventory parent oid"),
    sequence: nonnegativeInteger(
      envelope.sequence,
      "candidate inventory sequence",
    ),
    phase: envelope.payload.phase,
    cycle_id: envelope.payload.cycle_id,
    envelope_digest: digest(
      envelope.envelope_digest,
      "candidate inventory envelope digest",
    ),
    payload_digest: digest(
      envelope.payload_digest,
      "candidate inventory payload digest",
    ),
    workflow_provenance_receipt_digest: digest(
      envelope.workflow_provenance.receipt_digest,
      "candidate inventory provenance digest",
    ),
    workflow_provenance_replay_identity:
      provenanceReplayIdentity(envelope.workflow_provenance),
    server_observed_at: timestamp(
      envelope.server_observed_at,
      "candidate inventory record time",
    ),
  };
}

function buildCandidateInventoryAuthority(repository, state) {
  const sourceRecords = structuredClone(state.source_records);
  const sourceRecordDigest = digestCanonical(
    "codex-review-gate-v2-candidate-inventory-source-records",
    sourceRecords,
  );
  const completed = state.completed === null
    ? null
    : structuredClone(state.completed);
  const incomplete = state.incomplete === null
    ? null
    : structuredClone(state.incomplete);
  const durableInventory = incomplete?.initial_inventory ??
    completed?.final_inventory ?? null;
  const discovery = {
    bootstrap_complete: completed !== null,
    created_watermark:
      structuredClone(durableInventory?.high_watermark ?? null),
    candidates: structuredClone(durableInventory?.candidates ?? []),
    current_open_pull_requests:
      structuredClone(completed?.cycle_receipt.open_pull_requests ?? []),
    completed_cycle_id: completed?.cycle_id ?? null,
    completed_at: completed?.cycle_receipt.observed_at ?? null,
    incomplete_cycle_id: incomplete?.cycle_id ?? null,
    next_shard_index: incomplete?.next_shard_index ?? null,
  };
  const authorityBinding = {
    repository: structuredClone(repository),
    source_record_digest: sourceRecordDigest,
    completed_cycle_record_oid: completed?.complete_record_oid ?? null,
    completed_cycle_receipt_digest:
      completed?.cycle_receipt.receipt_digest ?? null,
    incomplete_cycle_id: incomplete?.cycle_id ?? null,
    incomplete_start_record_oid: incomplete?.start_record_oid ?? null,
    incomplete_next_shard_index: incomplete?.next_shard_index ?? null,
  };
  return deepFreeze({
    schema: V2_GIT_LEDGER_CANDIDATE_INVENTORY_AUTHORITY_SCHEMA,
    schema_version: 1,
    repository: structuredClone(repository),
    source_records: sourceRecords,
    source_record_digest: sourceRecordDigest,
    completed_cycle: completed,
    incomplete_cycle: incomplete,
    open_pr_discovery: discovery,
    authority_binding: authorityBinding,
    authority_digest: digestCanonical(
      "codex-review-gate-v2-candidate-inventory-authority",
      authorityBinding,
    ),
  });
}

export function createV2GitLedgerCandidateDispatchRecord({
  predecessor_commit_sha,
  server_observed_at,
  payload,
}) {
  const normalizedPayload = validateV2GitLedgerCandidateDispatchPayload(
    payload,
  );
  return createV2GitLedgerRecord({
    record_type: "candidate-dispatch-observation",
    predecessor_commit_sha,
    pull_request: null,
    head_ref_oid: null,
    base_ref_oid: null,
    potential_merge_commit_oid: null,
    kind: null,
    effect_id: null,
    idempotency_key: null,
    server_observed_at,
    payload: normalizedPayload,
    control_comment_binding: null,
    lease: null,
  });
}

export function validateV2GitLedgerCandidateDispatchPayload(
  value,
  expected = null,
) {
  assertObject(value, "candidate dispatch ledger payload");
  exactKeys(value, [
    "schema", "schema_version", "phase", "owner",
    "prior_candidate_dispatch_authority_digest", "generation_id",
    "cycle_id", "candidate_inventory_authority_digest",
    "completed_cycle_record_oid", "inventory_digest", "reservation",
    "candidate_ack", "batch_completion", "cycle_completion",
    "command_authority", "trigger_identity",
  ], "candidate dispatch ledger payload");
  if (
    value.schema !== V2_GIT_LEDGER_CANDIDATE_DISPATCH_RECORD_SCHEMA ||
    value.schema_version !== 1 ||
    !new Set([
      "reserve", "candidate-ack", "batch-complete", "cycle-complete",
    ]).has(value.phase) ||
    !CANDIDATE_DISPATCH_GENERATION_ID.test(value.generation_id) ||
    !CANDIDATE_CYCLE_ID.test(value.cycle_id)
  ) {
    throw new Error("candidate dispatch payload schema is unsupported");
  }
  normalizeLeaseOwner(value.owner);
  digest(value.prior_candidate_dispatch_authority_digest,
    "candidate dispatch prior authority digest");
  digest(value.candidate_inventory_authority_digest,
    "candidate dispatch inventory authority digest");
  sha(value.completed_cycle_record_oid,
    "candidate dispatch completed cycle record oid");
  digest(value.inventory_digest, "candidate dispatch inventory digest");
  const commandAuthority = normalizeCandidateDispatchCommandAuthority(
    value.command_authority,
  );
  const triggerIdentity = normalizeCandidateDispatchTriggerIdentity(
    value.trigger_identity,
  );
  const fields = [
    value.reservation,
    value.candidate_ack,
    value.batch_completion,
    value.cycle_completion,
  ];
  const expectedIndex = {
    reserve: 0,
    "candidate-ack": 1,
    "batch-complete": 2,
    "cycle-complete": 3,
  }[value.phase];
  if (fields.some((field, index) => (field !== null) !== (index === expectedIndex))) {
    throw new Error("candidate dispatch payload phase fields are not closed");
  }
  const reservation = value.reservation === null
    ? null
    : validateV2GitLedgerCandidateDispatchReservation(value.reservation);
  const candidateAck = value.candidate_ack === null
    ? null
    : normalizeCandidateDispatchAck(value.candidate_ack);
  const batchCompletion = value.batch_completion === null
    ? null
    : normalizeCandidateDispatchBatchCompletion(value.batch_completion);
  const cycleCompletion = value.cycle_completion === null
    ? null
    : normalizeCandidateDispatchCycleCompletion(value.cycle_completion);
  const phaseEvidence = reservation ?? candidateAck ?? batchCompletion ??
    cycleCompletion;
  if (
    phaseEvidence.generation_id !== value.generation_id ||
    phaseEvidence.cycle_id !== value.cycle_id ||
    phaseEvidence.inventory_digest !== value.inventory_digest ||
    (reservation !== null && (
      reservation.candidate_inventory_authority_digest !==
        value.candidate_inventory_authority_digest ||
      reservation.completed_cycle_record_oid !==
        value.completed_cycle_record_oid
    ))
  ) {
    throw new Error("candidate dispatch phase evidence changes its generation");
  }
  if (
    value.phase === "reserve" && commandAuthority.pull_request_number !== null ||
    value.phase === "candidate-ack" && (
      candidateAck.terminal_authority.kind === "controller-terminal" &&
        commandAuthority.pull_request_number !== candidateAck.candidate.number ||
      candidateAck.terminal_authority.kind === "durable-prefix-recovery" &&
        commandAuthority.pull_request_number !== null &&
        commandAuthority.pull_request_number !== candidateAck.candidate.number
    )
  ) {
    throw new Error("candidate dispatch command selector differs from its phase");
  }
  if (expected?.repository !== undefined) {
    const repository = reservation?.repository ??
      expected.repository;
    if (canonicalJson(normalizeRepository(repository)) !==
        canonicalJson(normalizeRepository(expected.repository))) {
      throw new Error("candidate dispatch payload belongs to another repository");
    }
  }
  const bytes = Buffer.byteLength(canonicalJson(value), "utf8");
  if (bytes > MAX_V2_CANDIDATE_DISPATCH_RECORD_BYTES) {
    throw ledgerError(
      "candidate-dispatch-record-size",
      "candidate dispatch payload exceeds its hard byte cap",
    );
  }
  return deepFreeze({
    ...structuredClone(value),
    reservation,
    candidate_ack: candidateAck,
    batch_completion: batchCompletion,
    cycle_completion: cycleCompletion,
    command_authority: commandAuthority,
    trigger_identity: triggerIdentity,
  });
}

export function validateV2GitLedgerCandidateDispatchReservation(value) {
  assertObject(value, "candidate dispatch reservation");
  exactKeys(value, [
    "schema", "schema_version", "repository", "generation_id", "cycle_id",
    "candidate_inventory_authority_digest", "completed_cycle_record_oid",
    "inventory_digest", "source_tip_commit_sha", "batch_index",
    "batch_count", "candidate_offset", "candidates", "dispatch_digest",
    "scan_command_digest", "scan_workflow_receipt_digest",
    "trigger_identity", "dispatch_commit_budget_required",
    "candidate_execution_commit_budget_required",
    "total_commit_budget_required",
    "remaining_ledger_commit_capacity_after_dispatch", "reservation_digest",
  ], "candidate dispatch reservation");
  if (
    value.schema !== V2_GIT_LEDGER_CANDIDATE_DISPATCH_RESERVATION_SCHEMA ||
    value.schema_version !== 1 ||
    !CANDIDATE_DISPATCH_GENERATION_ID.test(value.generation_id) ||
    !CANDIDATE_CYCLE_ID.test(value.cycle_id)
  ) {
    throw new Error("candidate dispatch reservation schema is unsupported");
  }
  const repository = normalizeRepository(value.repository);
  digest(value.candidate_inventory_authority_digest,
    "candidate dispatch reservation inventory authority digest");
  sha(value.completed_cycle_record_oid,
    "candidate dispatch reservation completed cycle record oid");
  digest(value.inventory_digest,
    "candidate dispatch reservation inventory digest");
  sha(value.source_tip_commit_sha,
    "candidate dispatch reservation source tip");
  const batchIndex = nonnegativeInteger(
    value.batch_index,
    "candidate dispatch reservation batch index",
  );
  const batchCount = positiveInteger(
    value.batch_count,
    "candidate dispatch reservation batch count",
  );
  if (
    batchCount > MAX_V2_CANDIDATE_DISPATCH_BATCHES ||
    batchIndex >= batchCount
  ) {
    throw new Error("candidate dispatch reservation batch identity is invalid");
  }
  const offset = nonnegativeInteger(
    value.candidate_offset,
    "candidate dispatch reservation candidate offset",
  );
  if (offset !== batchIndex * MAX_V2_CANDIDATE_DISPATCH_ITEMS) {
    throw new Error("candidate dispatch reservation offset is not canonical");
  }
  if (
    !Array.isArray(value.candidates) || value.candidates.length === 0 ||
    value.candidates.length > MAX_V2_CANDIDATE_DISPATCH_ITEMS
  ) {
    throw new Error("candidate dispatch reservation candidate batch is invalid");
  }
  const candidates = value.candidates.map((candidate, index) =>
    normalizeCandidateDispatchSelection(
      candidate,
      `candidate dispatch reservation candidate ${index}`,
    ));
  requireUniqueCandidateDispatchSelections(candidates);
  digest(value.dispatch_digest, "candidate dispatch reservation dispatch digest");
  const expectedDispatchDigest = digestCanonical(
    "codex-review-gate-v2-candidate-dispatch-selection",
    {
      repository,
      generation_id: value.generation_id,
      cycle_id: value.cycle_id,
      inventory_digest: value.inventory_digest,
      batch_index: batchIndex,
      batch_count: batchCount,
      candidate_offset: offset,
      candidates,
    },
  );
  if (value.dispatch_digest !== expectedDispatchDigest) {
    throw new Error("candidate dispatch reservation selection digest is invalid");
  }
  digest(value.scan_command_digest,
    "candidate dispatch reservation scan command digest");
  digest(value.scan_workflow_receipt_digest,
    "candidate dispatch reservation workflow receipt digest");
  const triggerIdentity = normalizeCandidateDispatchTriggerIdentity(
    value.trigger_identity,
  );
  const commitBudget = positiveInteger(
    value.dispatch_commit_budget_required,
    "candidate dispatch reservation commit budget",
  );
  const candidateExecutionBudget = positiveInteger(
    value.candidate_execution_commit_budget_required,
    "candidate dispatch reservation execution commit budget",
  );
  const totalCommitBudget = positiveInteger(
    value.total_commit_budget_required,
    "candidate dispatch reservation total commit budget",
  );
  const remaining = nonnegativeInteger(
    value.remaining_ledger_commit_capacity_after_dispatch,
    "candidate dispatch reservation remaining commit capacity",
  );
  if (commitBudget > MAX_V2_GIT_LEDGER_COMMITS ||
      candidateExecutionBudget > MAX_V2_GIT_LEDGER_COMMITS ||
      totalCommitBudget !== commitBudget + candidateExecutionBudget ||
      totalCommitBudget > MAX_V2_GIT_LEDGER_COMMITS ||
      remaining > MAX_V2_GIT_LEDGER_COMMITS) {
    throw new Error("candidate dispatch reservation commit budget is invalid");
  }
  digest(value.reservation_digest,
    "candidate dispatch reservation digest");
  const { reservation_digest: _digest, ...withoutDigest } = value;
  if (
    value.reservation_digest !== digestCanonical(
      "codex-review-gate-v2-candidate-dispatch-reservation",
      withoutDigest,
    )
  ) {
    throw new Error("candidate dispatch reservation digest is invalid");
  }
  return deepFreeze({
    ...structuredClone(value),
    repository,
    batch_index: batchIndex,
    batch_count: batchCount,
    candidate_offset: offset,
    candidates,
    trigger_identity: triggerIdentity,
    dispatch_commit_budget_required: commitBudget,
    candidate_execution_commit_budget_required: candidateExecutionBudget,
    total_commit_budget_required: totalCommitBudget,
    remaining_ledger_commit_capacity_after_dispatch: remaining,
  });
}

export function validateV2GitLedgerCandidateDispatchPlan(value) {
  assertObject(value, "candidate dispatch plan");
  exactKeys(value, [
    "schema", "schema_version", "repository", "generation_id", "cycle_id",
    "inventory_digest", "batch_index", "batch_count", "dispatch_digest",
    "items", "remaining_count", "dispatch_commit_budget_required",
    "candidate_execution_commit_budget_required",
    "total_commit_budget_required",
    "remaining_ledger_commit_capacity_after_dispatch", "plan_digest",
  ], "candidate dispatch plan");
  if (
    value.schema !== V2_GIT_LEDGER_CANDIDATE_DISPATCH_PLAN_SCHEMA ||
    value.schema_version !== 1 ||
    !CANDIDATE_DISPATCH_GENERATION_ID.test(value.generation_id) ||
    !CANDIDATE_CYCLE_ID.test(value.cycle_id)
  ) {
    throw new Error("candidate dispatch plan schema is unsupported");
  }
  const repository = normalizeRepository(value.repository);
  digest(value.inventory_digest, "candidate dispatch plan inventory digest");
  const batchIndex = nonnegativeInteger(value.batch_index,
    "candidate dispatch plan batch index");
  const batchCount = positiveInteger(value.batch_count,
    "candidate dispatch plan batch count");
  if (batchIndex >= batchCount || batchCount > MAX_V2_CANDIDATE_DISPATCH_BATCHES) {
    throw new Error("candidate dispatch plan batch identity is invalid");
  }
  digest(value.dispatch_digest, "candidate dispatch plan dispatch digest");
  if (!Array.isArray(value.items) ||
      value.items.length > MAX_V2_CANDIDATE_DISPATCH_ITEMS) {
    throw new Error("candidate dispatch plan items exceed the hard cap");
  }
  const items = value.items.map((item, index) =>
    normalizeCandidateDispatchPlanItem(
      item,
      `candidate dispatch plan item ${index}`,
    ));
  for (const item of items) {
    if (
      item.generation_id !== value.generation_id ||
      item.cycle_id !== value.cycle_id ||
      item.inventory_digest !== value.inventory_digest ||
      item.batch_index !== batchIndex ||
      item.batch_count !== batchCount ||
      item.dispatch_digest !== value.dispatch_digest
    ) {
      throw new Error("candidate dispatch plan item changes its batch binding");
    }
  }
  requireUniqueCandidateDispatchSelections(items.map(({ candidate }) =>
    candidate));
  const remainingCount = nonnegativeInteger(value.remaining_count,
    "candidate dispatch plan remaining_count");
  if (remainingCount !== items.length) {
    throw new Error("candidate dispatch plan remaining_count is invalid");
  }
  positiveInteger(value.dispatch_commit_budget_required,
    "candidate dispatch plan commit budget");
  positiveInteger(value.candidate_execution_commit_budget_required,
    "candidate dispatch plan execution commit budget");
  if (positiveInteger(value.total_commit_budget_required,
    "candidate dispatch plan total commit budget") !==
      value.dispatch_commit_budget_required +
        value.candidate_execution_commit_budget_required) {
    throw new Error("candidate dispatch plan total commit budget is invalid");
  }
  nonnegativeInteger(value.remaining_ledger_commit_capacity_after_dispatch,
    "candidate dispatch plan remaining commit capacity");
  digest(value.plan_digest, "candidate dispatch plan digest");
  const { plan_digest: _digest, ...withoutDigest } = value;
  if (value.plan_digest !== digestCanonical(
    "codex-review-gate-v2-candidate-dispatch-plan",
    withoutDigest,
  )) {
    throw new Error("candidate dispatch plan digest is invalid");
  }
  if (Buffer.byteLength(canonicalJson(value), "utf8") >
      MAX_V2_CANDIDATE_DISPATCH_PLAN_BYTES) {
    throw ledgerError(
      "candidate-dispatch-plan-size",
      "candidate dispatch plan exceeds its public byte cap",
    );
  }
  return deepFreeze({ ...structuredClone(value), repository, items });
}

export function validateV2GitLedgerCandidateDispatchResult(value) {
  assertObject(value, "candidate dispatch result");
  exactKeys(value, [
    "schema", "schema_version", "candidate", "controller_authority_digest",
    "controller_result_digest", "decision", "public_effects_performed",
    "outcome", "failure_code", "result_digest",
  ], "candidate dispatch result");
  if (
    value.schema !== V2_GIT_LEDGER_CANDIDATE_DISPATCH_RESULT_SCHEMA ||
    value.schema_version !== 1
  ) {
    throw new Error("candidate dispatch result schema is unsupported");
  }
  const candidate = normalizeCandidateDispatchSelection(
    value.candidate,
    "candidate dispatch result candidate",
  );
  digest(value.controller_authority_digest,
    "candidate dispatch result controller authority digest");
  digest(value.controller_result_digest,
    "candidate dispatch result controller result digest");
  const decisions = new Set([
    "not-selected", "pending", "clean", "findings", "inconclusive",
    "skipped-unavailable", "blocked-configuration", "blocked-input",
  ]);
  if (!decisions.has(value.decision)) {
    throw new Error("candidate dispatch result decision is unsupported");
  }
  const effects = nonnegativeInteger(
    value.public_effects_performed,
    "candidate dispatch result public effects",
  );
  if (effects > 64) {
    throw new Error("candidate dispatch result public effects exceed the cap");
  }
  if (!new Set(["success", "blocked", "failed"]).has(value.outcome)) {
    throw new Error("candidate dispatch result outcome is unsupported");
  }
  const blocked = new Set([
    "not-selected", "blocked-configuration", "blocked-input",
  ]);
  if (
    value.outcome === "blocked" && !blocked.has(value.decision) ||
    value.outcome === "success" && blocked.has(value.decision)
  ) {
    throw new Error("candidate dispatch outcome differs from its decision");
  }
  const failureCode = value.failure_code === null
    ? null
    : boundedString(value.failure_code,
      "candidate dispatch result failure_code", 128);
  if (
    (value.outcome === "failed") !== (failureCode !== null) ||
    failureCode !== null && !/^[A-Z][A-Z0-9_]{2,127}$/u.test(failureCode)
  ) {
    throw new Error("candidate dispatch failed outcome requires a typed failure code");
  }
  digest(value.result_digest, "candidate dispatch result digest");
  const { result_digest: _digest, ...withoutDigest } = value;
  if (value.result_digest !== digestCanonical(
    "codex-review-gate-v2-candidate-dispatch-result",
    withoutDigest,
  )) {
    throw new Error("candidate dispatch result digest is invalid");
  }
  return deepFreeze({
    ...structuredClone(value),
    candidate,
    public_effects_performed: effects,
    failure_code: failureCode,
  });
}

function createV2GitLedgerCandidateDispatchResult({
  candidate,
  controller_authority_digest,
  controller_result_digest,
  decision,
  public_effects_performed,
  outcome,
  failure_code = null,
}) {
  const withoutDigest = {
    schema: V2_GIT_LEDGER_CANDIDATE_DISPATCH_RESULT_SCHEMA,
    schema_version: 1,
    candidate: normalizeCandidateDispatchSelection(
      candidate,
      "candidate dispatch result candidate",
    ),
    controller_authority_digest,
    controller_result_digest,
    decision,
    public_effects_performed,
    outcome,
    failure_code,
  };
  return validateV2GitLedgerCandidateDispatchResult({
    ...withoutDigest,
    result_digest: digestCanonical(
      "codex-review-gate-v2-candidate-dispatch-result",
      withoutDigest,
    ),
  });
}

const CANDIDATE_DISPATCH_TERMINAL_RESULT_KEYS = Object.freeze([
  "schema", "schema_version", "decision", "report", "due_at",
  "wakeup_hints", "status_plan", "request_plan", "comment_plan",
  "writes_performed", "public_effects_performed", "effect_barrier",
  "status_effect_outcome", "status_ambiguity_code",
  "status_intent_digest", "status_response_runner_state_digest",
  "reservation_status_effect_outcome",
  "reservation_status_ambiguity_code", "automatic_reservation_digest",
  "reservation_status_intent_digest",
  "reservation_status_response_runner_state_digest",
  "automatic_request_effect_outcome", "automatic_request_ambiguity_code",
  "automatic_request_intent_digest",
  "automatic_request_binding_runner_state_digest",
  "authoritative_controlled_request", "scheduler_append_receipt",
  "lease_release_receipt", "preflight_receipt_digest", "handoff_digest",
  "continuity_receipt_digest", "control_plane_receipt_digest",
  "initial_runner_state_authority_digest",
  "established_runner_state_authority_digest", "runner_authority_digest",
]);

function validateCandidateDispatchTerminalResult({
  terminal_result: value,
  scheduler_append: schedulerAppend,
  scheduler_authority: schedulerAuthority,
  production_runner_authority: runnerAuthority,
  lease_release_receipt: leaseReleaseReceipt,
  loaded,
}) {
  assertObject(value, "candidate dispatch controller terminal result");
  exactKeys(value, CANDIDATE_DISPATCH_TERMINAL_RESULT_KEYS,
    "candidate dispatch controller terminal result");
  if (
    value.schema !== "codex-review-gate-production-assembly-v2" ||
    value.schema_version !== 1 || value.status_plan !== null ||
    value.request_plan !== null || value.comment_plan !== null
  ) {
    throw new Error("candidate dispatch terminal result is not a closed production result");
  }
  const observation = validateV2GitLedgerSchedulerObservation(
    schedulerAppend.record.payload.action,
  );
  const decision = boundedString(
    value.decision,
    "candidate dispatch terminal decision",
    64,
  );
  if (decision !== observation.scheduler_evaluation.decision) {
    throw new Error("candidate dispatch terminal decision differs from scheduler authority");
  }
  assertObject(value.report, "candidate dispatch terminal report");
  if (value.report.decision !== decision) {
    throw new Error("candidate dispatch terminal report changes the protected decision");
  }
  if (value.due_at !== null) {
    timestamp(value.due_at, "candidate dispatch terminal due_at");
  }
  if (typeof value.wakeup_hints !== "string" ||
      value.wakeup_hints.length > 128) {
    throw new TypeError("candidate dispatch terminal wakeup_hints is invalid");
  }
  const effects = nonnegativeInteger(
    value.public_effects_performed,
    "candidate dispatch terminal public effects",
  );
  if (effects > 3 || value.writes_performed !== (effects > 0)) {
    throw new Error("candidate dispatch terminal public effect count is invalid");
  }
  for (const key of [
    "status_effect_outcome", "reservation_status_effect_outcome",
    "automatic_request_effect_outcome",
  ]) {
    if (!new Set(["not-required", "bound", "ambiguous"]).has(value[key])) {
      throw new Error(`candidate dispatch terminal ${key} is invalid`);
    }
  }
  for (const key of [
    "status_ambiguity_code", "reservation_status_ambiguity_code",
    "automatic_request_ambiguity_code",
  ]) {
    if (value[key] !== null) {
      boundedString(value[key], `candidate dispatch terminal ${key}`, 256);
    }
  }
  for (const key of [
    "status_intent_digest", "status_response_runner_state_digest",
    "automatic_reservation_digest", "reservation_status_intent_digest",
    "reservation_status_response_runner_state_digest",
    "automatic_request_intent_digest",
    "automatic_request_binding_runner_state_digest",
    "preflight_receipt_digest", "handoff_digest", "continuity_receipt_digest",
    "control_plane_receipt_digest", "initial_runner_state_authority_digest",
    "established_runner_state_authority_digest", "runner_authority_digest",
  ]) {
    if (value[key] !== null) {
      digest(value[key], `candidate dispatch terminal ${key}`);
    }
  }
  const runnerStateAuthority = schedulerAuthority.runner_state_authority;
  const initial = observation.initial_runner_state_authority !== null;
  if (
    value.runner_authority_digest !== runnerAuthority.authority_digest ||
    value.initial_runner_state_authority_digest !==
      (initial ? runnerStateAuthority.authority_digest : null) ||
    value.established_runner_state_authority_digest !==
      (initial ? null : runnerStateAuthority.authority_digest)
  ) {
    throw new Error("candidate dispatch terminal authority digests are inconsistent");
  }
  if (canonicalJson(runnerAuthority.scope) !== canonicalJson(
    candidateDispatchProductionScope(
      scheduledScopeRepository(schedulerAuthority.evaluated_scope_receipt),
      schedulerAuthority.scope,
    ),
  )) {
    throw new Error("candidate dispatch terminal runner scope is inconsistent");
  }
  if (canonicalJson(runnerAuthority.scheduling) !==
      canonicalJson(observation.prior_scheduling)) {
    throw new Error("candidate dispatch terminal runner scheduling is inconsistent");
  }
  if (canonicalJson(runnerAuthority.head_ledger) !==
      canonicalJson(observation.prior_head_ledger)) {
    throw new Error("candidate dispatch terminal runner head ledger is inconsistent");
  }
  if (
    runnerAuthority.control_plane_binding.tip_oid !==
      schedulerAppend.record.predecessor_commit_sha
  ) {
    throw new Error("candidate dispatch terminal control-plane tip is inconsistent");
  }
  if (
    canonicalJson(value.scheduler_append_receipt) !==
      canonicalJson(schedulerAppend.append_receipt)
  ) {
    throw new Error("candidate dispatch terminal scheduler receipt is inconsistent");
  }
  if (
    canonicalJson(value.lease_release_receipt) !==
      canonicalJson(leaseReleaseReceipt)
  ) {
    throw new Error("candidate dispatch terminal release receipt is inconsistent");
  }
  const evaluated = validateV2GitLedgerEvaluatedScopeReceipt(
    schedulerAuthority.evaluated_scope_receipt,
  );
  if (
    evaluated.discovery_continuity_receipt === null ||
    value.continuity_receipt_digest !==
      evaluated.discovery_continuity_receipt.continuity_receipt_digest ||
    loaded.tip_commit_sha !== leaseReleaseReceipt.commit_sha
  ) {
    throw new Error("candidate dispatch terminal result differs from its durable release tip");
  }
  return deepFreeze(structuredClone(value));
}

function scheduledScopeRepository(value) {
  return validateV2GitLedgerEvaluatedScopeReceipt(value).repository;
}

function candidateDispatchProductionScope(repositoryValue, scopeValue) {
  const repository = normalizeRepository(repositoryValue);
  const scope = normalizeEffectScope(scopeValue);
  if (scope === null) {
    throw new TypeError("candidate dispatch production scope requires one PR");
  }
  return {
    repository_id: repository.id,
    repository_node_id: repository.node_id,
    pull_request_number: scope.pull_request.number,
    pull_request_node_id: scope.pull_request.node_id,
    base_oid: scope.base_ref_oid,
    head_oid: scope.head_ref_oid,
    potential_merge_oid: scope.potential_merge_commit_oid,
    review_epoch_digest: digestCanonical(
      "codex-review-gate-v2-review-epoch",
      {
        pull_request: scope.pull_request,
        base_ref_oid: scope.base_ref_oid,
        head_ref_oid: scope.head_ref_oid,
        potential_merge_commit_oid: scope.potential_merge_commit_oid,
      },
    ),
  };
}

function validateCandidateDispatchTerminalHistory({
  loaded,
  terminal_authority: terminalAuthorityValue,
  scheduled_scope_receipt: scheduledScopeReceipt,
  owner,
}) {
  if (loaded.active_lease !== null) {
    throw ledgerError(
      "candidate-dispatch-lease-release-required",
      "candidate terminal result requires a durably released PR lease",
    );
  }
  const terminalAuthority = normalizeCandidateDispatchTerminalAuthority(
    terminalAuthorityValue,
  );
  validateCandidateDispatchTerminalHistoryRecords({
    records: loaded.records,
    scheduler_observation_record_oid:
      terminalAuthority.scheduler_observation_record_oid,
    scheduler_observation_payload_digest:
      terminalAuthority.scheduler_observation_payload_digest,
    lease_acquire_commit_sha:
      terminalAuthority.lease_acquire_commit_sha,
    lease_release_record_oid: terminalAuthority.lease_release_record_oid,
    terminal_projection: terminalAuthority.terminal_projection,
    scheduled_scope_receipt: scheduledScopeReceipt,
    owner,
  });
}

function validateCandidateDispatchTerminalHistoryRecords({
  records: allRecords,
  scheduler_observation_record_oid: observationOid,
  scheduler_observation_payload_digest: observationPayloadDigest,
  lease_acquire_commit_sha: leaseAcquireCommitSha,
  lease_release_record_oid: releaseRecordOid,
  terminal_projection: terminal,
  scheduled_scope_receipt: scheduledScopeReceiptValue,
  owner: ownerValue,
}) {
  const scheduledScopeReceipt = validateV2GitLedgerEvaluatedScopeReceipt(
    scheduledScopeReceiptValue,
  );
  const owner = normalizeLeaseOwner(ownerValue);
  const acquireIndex = allRecords.findIndex((entry) =>
    entry.commit_sha === leaseAcquireCommitSha);
  const observationIndex = allRecords.findIndex((entry) =>
    entry.commit_sha === observationOid);
  const releaseIndex = allRecords.findIndex((entry) =>
    entry.commit_sha === releaseRecordOid);
  const acquire = allRecords[acquireIndex];
  const observation = allRecords[observationIndex];
  const release = allRecords[releaseIndex];
  const acquireEvaluated = acquire?.envelope.workflow_provenance
    ?.operation_binding?.evaluated_scope_receipt ?? null;
  const observationEvaluated = observation?.envelope.workflow_provenance
    ?.operation_binding?.evaluated_scope_receipt ?? null;
  const releaseEvaluated = release?.envelope.workflow_provenance
    ?.operation_binding?.evaluated_scope_receipt ?? null;
  const continuity = scheduledScopeReceipt.discovery_continuity_receipt;
  if (
    scheduledScopeReceipt.relation !== "scheduled-pull-request" ||
    scheduledScopeReceipt.phase !== "full-discovery" ||
    continuity === null ||
    acquireIndex < 0 || observationIndex !== acquireIndex + 1 ||
    releaseIndex <= observationIndex ||
    releaseIndex !== allRecords.length - 1 ||
    acquire?.envelope.record_type !== "lease-acquire" ||
    observation?.envelope.record_type !== "effect-intent" ||
    observation.envelope.kind !== "scheduler-observation" ||
    observationPayloadDigest !== null &&
      observation.envelope.payload_digest !== observationPayloadDigest ||
    release?.envelope.record_type !== "lease-release" ||
    release.envelope.payload.acquire_commit_sha !==
      leaseAcquireCommitSha ||
    continuity.lease.acquire_commit_sha !== leaseAcquireCommitSha ||
    continuity.pre_scope_receipt_digest !== acquireEvaluated?.receipt_digest ||
    canonicalJson(observationEvaluated) !==
      canonicalJson(scheduledScopeReceipt) ||
    canonicalJson(releaseEvaluated) !== canonicalJson(acquireEvaluated) ||
    canonicalJson(envelopeScope(acquire.envelope)) !==
      canonicalJson(scheduledScopeReceipt.scope) ||
    canonicalJson(envelopeScope(release.envelope)) !==
      canonicalJson(scheduledScopeReceipt.scope) ||
    canonicalJson(envelopeScope(observation.envelope)) !==
      canonicalJson(scheduledScopeReceipt.scope) ||
    canonicalJson(normalizeRepository(acquire.envelope.repository)) !==
      canonicalJson(scheduledScopeReceipt.repository) ||
    canonicalJson(normalizeRepository(observation.envelope.repository)) !==
      canonicalJson(scheduledScopeReceipt.repository) ||
    canonicalJson(normalizeRepository(release.envelope.repository)) !==
      canonicalJson(scheduledScopeReceipt.repository) ||
    canonicalJson(normalizeLeaseOwner(acquire.envelope.payload.owner)) !==
      canonicalJson(owner) ||
    canonicalJson(normalizeLeaseOwner(observation.envelope.lease?.owner)) !==
      canonicalJson(owner) ||
    canonicalJson(normalizeLeaseOwner(release.envelope.payload.owner)) !==
      canonicalJson(owner) ||
    canonicalJson(normalizeLeaseOwner(release.envelope.lease?.owner)) !==
      canonicalJson(owner) ||
    release.envelope.predecessor_commit_sha !==
      allRecords[releaseIndex - 1].commit_sha
  ) {
    throw ledgerError(
      "candidate-dispatch-release-unreachable",
      "candidate terminal result lacks one exact reachable lease release",
    );
  }
  const observationAction = validateV2GitLedgerSchedulerObservation(
    observation.envelope.payload.action,
  );
  if (terminal.decision !== observationAction.scheduler_evaluation.decision) {
    throw new Error("candidate dispatch terminal projection changes scheduler decision");
  }
  const records = allRecords.slice(observationIndex + 1, releaseIndex);
  const permittedKinds = new Set([
    "status-write",
    "automatic-request-reservation",
    "reservation-status-write",
    "effect-attempt",
    "review-request",
    "request-binding",
  ]);
  for (const entry of records) {
    const envelope = entry.envelope;
    const evaluated = envelope.workflow_provenance?.operation_binding
      ?.evaluated_scope_receipt ?? null;
    if (
      !new Set(["effect-intent", "effect-response"])
        .has(envelope.record_type) ||
      !permittedKinds.has(envelope.kind) ||
      canonicalJson(evaluated) !== canonicalJson(scheduledScopeReceipt) ||
      canonicalJson(envelopeScope(envelope)) !==
        canonicalJson(scheduledScopeReceipt.scope) ||
      canonicalJson(normalizeRepository(envelope.repository)) !==
        canonicalJson(scheduledScopeReceipt.repository) ||
      envelope.lease?.acquire_commit_sha !== leaseAcquireCommitSha ||
      canonicalJson(normalizeLeaseOwner(envelope.lease?.owner)) !==
        canonicalJson(owner)
    ) {
      throw ledgerError(
        "candidate-dispatch-terminal-history-open",
        "candidate terminal history contains an unbound or unsupported record",
      );
    }
  }
  const intents = (kind, predicate = () => true) => records.filter((entry) =>
    entry.envelope.record_type === "effect-intent" &&
    entry.envelope.kind === kind && predicate(entry));
  const responsesFor = (entries) => records.filter((entry) =>
    entry.envelope.record_type === "effect-response" &&
    entries.some((intent) =>
      entry.envelope.effect_id === intent.envelope.effect_id));
  const requiredStatusIntents = intents("status-write", (entry) =>
    entry.envelope.payload.action.scheduler_observation_record_oid ===
      observationOid);
  const requiredStatusResponses = responsesFor(requiredStatusIntents);
  validateCandidateDispatchEffectOutcome({
    label: "status",
    outcome: terminal.status_effect_outcome,
    required: schedulerAppendStatusWriteCount(
      observationAction,
    ),
    intents: requiredStatusIntents,
    responses: requiredStatusResponses,
  });
  const reservations = intents("automatic-request-reservation", (entry) =>
    entry.envelope.payload.action.scheduler_observation_record_oid ===
      observationOid);
  if (reservations.length > 1) {
    throw new Error("candidate dispatch terminal history repeats automatic reservation");
  }
  const reservationOid = reservations[0]?.commit_sha ?? null;
  const reservationStatusIntents = intents(
    "reservation-status-write",
    (entry) => entry.envelope.payload.action.reservation_record_oid ===
      reservationOid,
  );
  const reservationStatusResponses = responsesFor(reservationStatusIntents);
  validateCandidateDispatchEffectOutcome({
    label: "reservation status",
    outcome: terminal.reservation_status_effect_outcome,
    required: reservations.length,
    intents: reservationStatusIntents,
    responses: reservationStatusResponses,
  });
  const attempts = reservationOid === null ? [] : intents(
    "effect-attempt",
    (entry) =>
      entry.envelope.payload.action.reservation_record_oid === reservationOid &&
      entry.envelope.payload.action.scheduler_observation_record_oid ===
        observationOid,
  );
  const requestIntents = reservationOid === null ? [] : intents(
    "review-request",
    (entry) => entry.envelope.payload.action.reservation_record_oid ===
      reservationOid,
  );
  const requestResponses = responsesFor(requestIntents);
  const bindingIntents = reservationOid === null ? [] : intents(
    "request-binding",
    (entry) => entry.envelope.payload.action.reservation_record_oid ===
      reservationOid,
  );
  const bindingResponses = responsesFor(bindingIntents);
  const expectedHistory = [
    ...requiredStatusIntents,
    ...requiredStatusResponses,
    ...reservations,
    ...reservationStatusIntents,
    ...reservationStatusResponses,
    ...attempts,
    ...requestIntents,
    ...requestResponses,
    ...bindingIntents,
    ...bindingResponses,
  ];
  if (
    expectedHistory.length !== records.length ||
    expectedHistory.some((entry, index) => entry !== records[index]) ||
    attempts.length > 1 ||
    (attempts.length === 1 && reservationStatusResponses.length !== 1) ||
    requestIntents.some((entry) =>
      attempts.length !== 1 ||
      entry.envelope.payload.action.attempt_record_oid !==
        attempts[0].commit_sha) ||
    bindingIntents.some((entry) =>
      attempts.length !== 1 ||
      entry.envelope.payload.action.attempt_record_oid !==
        attempts[0].commit_sha)
  ) {
    throw new Error(
      "candidate dispatch terminal history is not the closed production chain",
    );
  }
  if (terminal.automatic_request_effect_outcome === "not-required") {
    if (attempts.length !== 0 || requestIntents.length !== 0 ||
        requestResponses.length !== 0 ||
        bindingIntents.length !== 0 || bindingResponses.length !== 0) {
      throw new Error("candidate dispatch terminal request outcome hides durable effects");
    }
  } else if (terminal.automatic_request_effect_outcome === "bound") {
    if (attempts.length !== 1 || requestIntents.length !== 1 ||
        requestResponses.length !== 1 ||
        bindingIntents.length !== 1 || bindingResponses.length !== 1) {
      throw new Error("candidate dispatch terminal bound request lacks its exact chain");
    }
  } else if (
    attempts.length !== 1 || requestIntents.length > 1 ||
    requestResponses.length > 1 || bindingIntents.length > 1 ||
    bindingResponses.length !== 0 ||
    requestIntents.length === 0 &&
      (requestResponses.length !== 0 || bindingIntents.length !== 0) ||
    requestIntents.length === 1 && requestResponses.length === 0 &&
      bindingIntents.length !== 0
  ) {
    throw new Error("candidate dispatch terminal ambiguous request is not fail closed");
  }
  const performed = requiredStatusIntents.length +
    reservationStatusIntents.length + requestIntents.length;
  if (terminal.public_effects_performed !== performed) {
    throw new Error("candidate dispatch terminal public effects differ from durable intents");
  }
}

function schedulerAppendStatusWriteCount(observation) {
  const value = validateV2GitLedgerSchedulerObservation(observation);
  return value.status_plan.writes.length;
}

function validateCandidateDispatchEffectOutcome({
  label,
  outcome,
  required,
  intents,
  responses,
}) {
  if (required > 1 || intents.length > 1 || responses.length > 1) {
    throw new Error(`candidate dispatch ${label} requires a higher-level transaction`);
  }
  if (
    outcome === "not-required" &&
      (required !== 0 || intents.length !== 0 || responses.length !== 0) ||
    outcome === "bound" &&
      (required !== 1 || intents.length !== 1 || responses.length !== 1) ||
    outcome === "ambiguous" &&
      (required !== 1 || intents.length !== 1 || responses.length !== 0)
  ) {
    throw new Error(`candidate dispatch ${label} outcome differs from durable history`);
  }
}

function candidateDispatchOutcomeFromTerminal(terminal) {
  const ambiguityCode = terminal.automatic_request_ambiguity_code ??
    terminal.reservation_status_ambiguity_code ??
    terminal.status_ambiguity_code;
  const ambiguous = [
    terminal.status_effect_outcome,
    terminal.reservation_status_effect_outcome,
    terminal.automatic_request_effect_outcome,
  ].includes("ambiguous");
  const blocked = new Set([
    "not-selected", "blocked-configuration", "blocked-input",
  ]).has(terminal.decision);
  const normalizedFailureCode = typeof ambiguityCode === "string" &&
    /^[A-Z][A-Z0-9_]{2,127}$/u.test(ambiguityCode)
    ? ambiguityCode
    : "CANDIDATE_PUBLIC_EFFECT_AMBIGUOUS";
  return {
    decision: terminal.decision,
    public_effects_performed: terminal.public_effects_performed,
    outcome: ambiguous ? "failed" : blocked ? "blocked" : "success",
    failure_code: ambiguous ? normalizedFailureCode : null,
  };
}

function candidateDispatchOutcomeFromTerminalAuthority(authorityValue) {
  const authority = normalizeCandidateDispatchTerminalAuthority(
    authorityValue,
  );
  if (authority.kind === "durable-prefix-recovery") {
    return {
      decision: authority.terminal_projection.decision,
      public_effects_performed:
        authority.terminal_projection.public_effects_performed,
      outcome: "failed",
      failure_code: authority.recovery.failure_code,
    };
  }
  return candidateDispatchOutcomeFromTerminal(authority.terminal_projection);
}

const CANDIDATE_DISPATCH_RECOVERY_PHASES = Object.freeze([
  "lease-acquired",
  "scheduler-observed",
  "status-intent",
  "status-response",
  "automatic-reservation",
  "reservation-status-intent",
  "reservation-status-response",
  "request-attempt",
  "review-request-intent",
  "review-request-response",
  "request-binding-intent",
  "request-binding-response",
]);

const CANDIDATE_DISPATCH_RECOVERY_FAILURE_CODES = Object.freeze([
  "CANDIDATE_ATTEMPT_RECOVERED_AFTER_LEASE",
  "CANDIDATE_ATTEMPT_RECOVERED_AFTER_SCHEDULER",
  "CANDIDATE_STATUS_EFFECT_AMBIGUOUS",
  "CANDIDATE_ATTEMPT_RECOVERED_AFTER_STATUS",
  "CANDIDATE_ATTEMPT_RECOVERED_AFTER_RESERVATION",
  "CANDIDATE_RESERVATION_STATUS_EFFECT_AMBIGUOUS",
  "CANDIDATE_ATTEMPT_RECOVERED_AFTER_RESERVATION_STATUS",
  "CANDIDATE_ATTEMPT_RECOVERED_AFTER_REQUEST_ATTEMPT",
  "CANDIDATE_REQUEST_EFFECT_AMBIGUOUS",
  "CANDIDATE_ATTEMPT_RECOVERED_AFTER_REQUEST_RESPONSE",
  "CANDIDATE_ATTEMPT_RECOVERED_AFTER_BINDING_INTENT",
  "CANDIDATE_ATTEMPT_RECOVERED_AFTER_BINDING_RESPONSE",
]);

function candidateDispatchRecoveryEffectOutcome(records, kind, {
  binding = false,
} = {}) {
  const intents = records.filter((entry) =>
    entry.envelope.record_type === "effect-intent" &&
    entry.envelope.kind === kind);
  const responses = records.filter((entry) =>
    entry.envelope.record_type === "effect-response" &&
    entry.envelope.kind === kind &&
    intents.some((intent) =>
      intent.envelope.effect_id === entry.envelope.effect_id));
  if (intents.length > 1 || responses.length > 1) {
    throw new Error(
      `candidate dispatch recovery repeats ${kind} effects`,
    );
  }
  if (intents.length === 0) {
    if (responses.length !== 0) {
      throw new Error(
        `candidate dispatch recovery ${kind} response lacks its intent`,
      );
    }
    return { outcome: "not-required", ambiguity_code: null, intents: 0 };
  }
  const bound = binding
    ? records.some((entry) =>
      entry.envelope.record_type === "effect-response" &&
      entry.envelope.kind === "request-binding")
    : responses.length === 1;
  return {
    outcome: bound ? "bound" : "ambiguous",
    ambiguity_code: bound
      ? null
      : kind === "status-write"
        ? "CANDIDATE_STATUS_EFFECT_AMBIGUOUS"
        : kind === "reservation-status-write"
          ? "CANDIDATE_RESERVATION_STATUS_EFFECT_AMBIGUOUS"
          : "CANDIDATE_REQUEST_EFFECT_AMBIGUOUS",
    intents: 1,
  };
}

function deriveCandidateDispatchRecoveryEvidence({
  records,
  attempt_binding: attemptBindingValue,
  source_tip_commit_sha: sourceTipCommitShaValue,
  post_ref_receipt: postRefReceiptValue,
  scheduled_scope_receipt: scheduledScopeReceiptValue = null,
}) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new TypeError("candidate dispatch recovery history is unavailable");
  }
  const attemptBinding = candidateDispatchAttemptBindingFromValue(
    attemptBindingValue,
  );
  const sourceTipCommitSha = sha(
    sourceTipCommitShaValue,
    "candidate dispatch recovery source tip",
  );
  validateRefReceipt(postRefReceiptValue);
  const postRefReceipt = structuredClone(postRefReceiptValue);
  if (
    postRefReceipt.target_commit_sha !== sourceTipCommitSha ||
    records.at(-1).commit_sha !== sourceTipCommitSha
  ) {
    throw ledgerError(
      "candidate-dispatch-recovery-tip-mismatch",
      "candidate dispatch recovery does not bind the exact stable ledger tip",
    );
  }
  const attempts = candidateDispatchScheduledAcquireAttempts(records)
    .filter(({ binding }) =>
      canonicalJson(binding) === canonicalJson(attemptBinding));
  if (attempts.length !== 1) {
    throw ledgerError(
      "candidate-dispatch-recovery-attempt-mismatch",
      "candidate dispatch recovery requires one unique scheduled lease attempt",
    );
  }
  const acquireIndex = records.indexOf(attempts[0].entry);
  const suffix = records.slice(acquireIndex);
  let previousStage = -1;
  for (const entry of suffix) {
    const evaluated = entry.envelope.workflow_provenance?.operation_binding
      ?.evaluated_scope_receipt ?? null;
    const binding = candidateDispatchAttemptBinding(evaluated);
    const stage = candidateDispatchAttemptStage(entry.envelope);
    if (
      stage === null || stage <= previousStage ||
      canonicalJson(binding) !== canonicalJson(attemptBinding) ||
      stage === 1 && previousStage !== 0 ||
      stage > 1 && stage < 12 && previousStage < 1 ||
      stage === 12 && entry !== suffix.at(-1)
    ) {
      throw ledgerError(
        "candidate-dispatch-recovery-prefix",
        "candidate dispatch recovery history is not one closed durable prefix",
      );
    }
    previousStage = stage;
  }
  const acquire = suffix[0];
  const release = candidateDispatchAttemptStage(suffix.at(-1).envelope) === 12
    ? suffix.at(-1)
    : null;
  const prefix = release === null ? suffix : suffix.slice(0, -1);
  const prefixTip = prefix.at(-1);
  const prefixStage = candidateDispatchAttemptStage(prefixTip.envelope);
  const acquireEvaluated = acquire.envelope.workflow_provenance
    ?.operation_binding?.evaluated_scope_receipt ?? null;
  const fullRecords = prefix.slice(1);
  const fullScopeReceipt = fullRecords.length === 0
    ? null
    : fullRecords[0].envelope.workflow_provenance?.operation_binding
      ?.evaluated_scope_receipt ?? null;
  if (
    acquireEvaluated?.relation !== "scheduled-pull-request" ||
    acquireEvaluated.phase !== "pre-scope" ||
    fullRecords.some((entry) => canonicalJson(
      entry.envelope.workflow_provenance?.operation_binding
        ?.evaluated_scope_receipt ?? null,
    ) !== canonicalJson(fullScopeReceipt)) ||
    fullScopeReceipt !== null && (
      fullScopeReceipt.relation !== "scheduled-pull-request" ||
      fullScopeReceipt.phase !== "full-discovery" ||
      fullScopeReceipt.discovery_continuity_receipt?.lease
        ?.acquire_commit_sha !== acquire.commit_sha ||
      fullScopeReceipt.discovery_continuity_receipt
        ?.pre_scope_receipt_digest !== acquireEvaluated.receipt_digest
    )
  ) {
    throw ledgerError(
      "candidate-dispatch-recovery-scope-mismatch",
      "candidate dispatch recovery prefix changes its scheduled scope authority",
    );
  }
  const scheduledScopeReceipt = scheduledScopeReceiptValue === null
    ? fullScopeReceipt ?? acquireEvaluated
    : validateV2GitLedgerEvaluatedScopeReceipt(
      scheduledScopeReceiptValue,
    );
  if (canonicalJson(scheduledScopeReceipt) !== canonicalJson(
    fullScopeReceipt ?? acquireEvaluated,
  )) {
    throw ledgerError(
      "candidate-dispatch-recovery-scope-mismatch",
      "candidate dispatch recovery ack cites another scheduled scope receipt",
    );
  }
  const leaseExpiresAt = timestamp(
    acquire.envelope.payload.expires_at,
    "candidate dispatch recovery lease expiry",
  );
  let mode;
  if (release !== null) {
    const releaseEvaluated = release.envelope.workflow_provenance
      ?.operation_binding?.evaluated_scope_receipt ?? null;
    if (
      release.envelope.payload.acquire_commit_sha !== acquire.commit_sha ||
      canonicalJson(releaseEvaluated) !== canonicalJson(acquireEvaluated)
    ) {
      throw ledgerError(
        "candidate-dispatch-recovery-release-mismatch",
        "candidate dispatch recovery release differs from its lease acquire",
      );
    }
    mode = "released";
  } else {
    if (Date.parse(postRefReceipt.server_time) < Date.parse(leaseExpiresAt)) {
      throw ledgerError(
        "candidate-dispatch-recovery-not-ready",
        "candidate dispatch recovery must wait for its unreleased lease to expire",
      );
    }
    mode = "expired";
  }
  const observation = prefix.find((entry) =>
    entry.envelope.kind === "scheduler-observation") ?? null;
  const observationAction = observation === null
    ? null
    : validateV2GitLedgerSchedulerObservation(
      observation.envelope.payload.action,
    );
  const status = candidateDispatchRecoveryEffectOutcome(
    prefix,
    "status-write",
  );
  const reservationStatus = candidateDispatchRecoveryEffectOutcome(
    prefix,
    "reservation-status-write",
  );
  const request = candidateDispatchRecoveryEffectOutcome(
    prefix,
    "review-request",
    { binding: true },
  );
  const ambiguityCode = request.ambiguity_code ??
    reservationStatus.ambiguity_code ?? status.ambiguity_code;
  const failureCode = ambiguityCode ??
    CANDIDATE_DISPATCH_RECOVERY_FAILURE_CODES[prefixStage];
  const terminalProjection = {
    decision: observationAction?.scheduler_evaluation.decision ??
      "inconclusive",
    public_effects_performed:
      status.intents + reservationStatus.intents + request.intents,
    status_effect_outcome: status.outcome,
    status_ambiguity_code: status.ambiguity_code,
    reservation_status_effect_outcome: reservationStatus.outcome,
    reservation_status_ambiguity_code: reservationStatus.ambiguity_code,
    automatic_request_effect_outcome: request.outcome,
    automatic_request_ambiguity_code: request.ambiguity_code,
  };
  const recovery = normalizeCandidateDispatchRecoveryAuthority({
    mode,
    source_tip_commit_sha: sourceTipCommitSha,
    post_ref_receipt: postRefReceipt,
    prefix_tip_record_oid: prefixTip.commit_sha,
    prefix_phase: CANDIDATE_DISPATCH_RECOVERY_PHASES[prefixStage],
    lease_expires_at: leaseExpiresAt,
    failure_code: failureCode,
  });
  return deepFreeze({
    attempt_binding: attemptBinding,
    scheduler_observation_record_oid: observation?.commit_sha ?? null,
    scheduler_observation_payload_digest:
      observation?.envelope.payload_digest ?? null,
    lease_acquire_commit_sha: acquire.commit_sha,
    lease_release_record_oid: release?.commit_sha ?? null,
    full_scope_receipt_digest: fullScopeReceipt?.receipt_digest ?? null,
    scheduled_scope_receipt: structuredClone(scheduledScopeReceipt),
    terminal_projection: terminalProjection,
    recovery,
  });
}

function candidateDispatchAttemptBindingFromValue(value) {
  assertObject(value, "candidate dispatch attempt binding");
  exactKeys(value, [
    "repository", "dispatch_generation_id", "dispatch_cycle_id",
    "dispatch_reservation_record_oid", "dispatch_reservation_digest",
    "dispatch_digest", "dispatch_batch_index", "dispatch_batch_count",
    "dispatch_candidate_index", "selected_candidate", "trigger_event_name",
    "trigger_ref", "trigger_sha",
  ], "candidate dispatch attempt binding");
  assertObject(value.selected_candidate,
    "candidate dispatch attempt selected candidate");
  exactKeys(value.selected_candidate, [
    "id", "node_id", "number", "created_at",
  ], "candidate dispatch attempt selected candidate");
  const selectedCandidate = {
    id: decimal(value.selected_candidate.id,
      "candidate dispatch attempt selected candidate id"),
    node_id: boundedString(value.selected_candidate.node_id,
      "candidate dispatch attempt selected candidate node_id", 512),
    number: positiveInteger(value.selected_candidate.number,
      "candidate dispatch attempt selected candidate number"),
    created_at: timestamp(value.selected_candidate.created_at,
      "candidate dispatch attempt selected candidate created_at"),
  };
  if (!CANDIDATE_DISPATCH_GENERATION_ID.test(value.dispatch_generation_id) ||
      !CANDIDATE_CYCLE_ID.test(value.dispatch_cycle_id) ||
      value.trigger_event_name !== "schedule") {
    throw new Error("candidate dispatch attempt binding identity is invalid");
  }
  return deepFreeze({
    repository: normalizeRepository(value.repository),
    dispatch_generation_id: value.dispatch_generation_id,
    dispatch_cycle_id: value.dispatch_cycle_id,
    dispatch_reservation_record_oid: sha(
      value.dispatch_reservation_record_oid,
      "candidate dispatch attempt reservation record",
    ),
    dispatch_reservation_digest: digest(
      value.dispatch_reservation_digest,
      "candidate dispatch attempt reservation digest",
    ),
    dispatch_digest: digest(
      value.dispatch_digest,
      "candidate dispatch attempt dispatch digest",
    ),
    dispatch_batch_index: nonnegativeInteger(
      value.dispatch_batch_index,
      "candidate dispatch attempt batch index",
    ),
    dispatch_batch_count: positiveInteger(
      value.dispatch_batch_count,
      "candidate dispatch attempt batch count",
    ),
    dispatch_candidate_index: nonnegativeInteger(
      value.dispatch_candidate_index,
      "candidate dispatch attempt candidate index",
    ),
    selected_candidate: selectedCandidate,
    trigger_event_name: "schedule",
    trigger_ref: boundedString(value.trigger_ref,
      "candidate dispatch attempt trigger ref", 1024),
    trigger_sha: sha(value.trigger_sha,
      "candidate dispatch attempt trigger sha"),
  });
}

function createCandidateDispatchRecoveryTerminalAuthority(evidence) {
  const terminalProjectionDigest = digestCanonical(
    "codex-review-gate-v2-candidate-dispatch-terminal-projection",
    evidence.terminal_projection,
  );
  const withoutDigest = {
    kind: "durable-prefix-recovery",
    scheduler_observation_record_oid:
      evidence.scheduler_observation_record_oid,
    scheduler_observation_payload_digest:
      evidence.scheduler_observation_payload_digest,
    lease_acquire_commit_sha: evidence.lease_acquire_commit_sha,
    lease_release_record_oid: evidence.lease_release_record_oid,
    full_scope_receipt_digest: evidence.full_scope_receipt_digest,
    scheduled_scope_receipt_digest:
      evidence.scheduled_scope_receipt.receipt_digest,
    terminal_projection: evidence.terminal_projection,
    terminal_projection_digest: terminalProjectionDigest,
    recovery: evidence.recovery,
  };
  return normalizeCandidateDispatchTerminalAuthority({
    ...withoutDigest,
    authority_digest: digestCanonical(
      "codex-review-gate-v2-candidate-dispatch-terminal-authority",
      withoutDigest,
    ),
  });
}

/**
 * Classify one structurally closed durable candidate-attempt prefix.
 * This projection deliberately carries no ref-read or terminal authority and
 * cannot authorize an acknowledgement; the factory recovery API supplies the
 * trusted current ref boundary before it seals any recovery result.
 */
export function classifyV2GitLedgerCandidateDispatchRecoveryPrefix({
  records,
  scheduled_scope_receipt: scheduledScopeReceiptValue,
}) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new TypeError(
      "candidate dispatch recovery prefix requires reachable records",
    );
  }
  const scheduledScopeReceipt = validateV2GitLedgerEvaluatedScopeReceipt(
    scheduledScopeReceiptValue,
  );
  const attemptBinding = candidateDispatchAttemptBinding(
    scheduledScopeReceipt,
  );
  if (attemptBinding === null) {
    throw new TypeError(
      "candidate dispatch recovery prefix requires scheduled PR authority",
    );
  }
  const attempt = candidateDispatchScheduledAcquireAttempts(records)
    .find(({ binding }) => canonicalJson(binding) ===
      canonicalJson(attemptBinding));
  if (attempt === undefined) {
    throw ledgerError(
      "candidate-dispatch-recovery-attempt-mismatch",
      "candidate dispatch recovery prefix lacks its scheduled lease acquire",
    );
  }
  const sourceTipCommitSha = records.at(-1).commit_sha;
  const leaseExpiresAt = timestamp(
    attempt.entry.envelope.payload.expires_at,
    "candidate dispatch recovery projection lease expiry",
  );
  const recordTime = timestamp(
    records.at(-1).envelope.server_observed_at,
    "candidate dispatch recovery projection record time",
  );
  const projectionTime = new Date(Math.max(
    Date.parse(leaseExpiresAt),
    Date.parse(recordTime),
  )).toISOString();
  const evidence = deriveCandidateDispatchRecoveryEvidence({
    records,
    attempt_binding: attemptBinding,
    source_tip_commit_sha: sourceTipCommitSha,
    post_ref_receipt: {
      ref: records.at(-1).envelope.ledger_ref,
      node_id: "REF_candidate_dispatch_recovery_projection",
      target_commit_sha: sourceTipCommitSha,
      server_time: projectionTime,
      raw_body_sha256: digestCanonical(
        "codex-review-gate-v2-candidate-dispatch-recovery-projection",
        { source_tip_commit_sha: sourceTipCommitSha, projectionTime },
      ),
    },
    scheduled_scope_receipt: scheduledScopeReceipt,
  });
  return deepFreeze({
    schema:
      "codex-review-gate-git-ledger-candidate-dispatch-recovery-prefix-v2",
    schema_version: 1,
    prefix_phase: evidence.recovery.prefix_phase,
    failure_code: evidence.recovery.failure_code,
    lease_release_record_oid: evidence.lease_release_record_oid,
    terminal_projection: structuredClone(evidence.terminal_projection),
  });
}

function validateCandidateDispatchAckTerminalAuthority({
  prior_records: priorRecords,
  predecessor_commit_sha: predecessorCommitSha,
  ack,
  owner,
  record_server_time: recordServerTime,
}) {
  if (!Array.isArray(priorRecords)) {
    throw new TypeError("candidate dispatch ack history is unavailable");
  }
  const terminalAuthority = normalizeCandidateDispatchTerminalAuthority(
    ack.terminal_authority,
  );
  const scheduledScopeReceipt = validateV2GitLedgerEvaluatedScopeReceipt(
    ack.scheduled_scope_receipt,
  );
  if (
    ack.result.controller_authority_digest !==
      terminalAuthority.authority_digest ||
    ack.result.controller_result_digest !==
      terminalAuthority.terminal_projection_digest
  ) {
    throw ledgerError(
      "candidate-dispatch-terminal-authority-mismatch",
      "candidate dispatch ack does not bind its exact terminal ledger authority",
    );
  }
  if (terminalAuthority.kind === "controller-terminal") {
    const continuity = scheduledScopeReceipt.discovery_continuity_receipt;
    if (
      terminalAuthority.lease_release_record_oid !== predecessorCommitSha ||
      terminalAuthority.full_scope_receipt_digest !==
        scheduledScopeReceipt.receipt_digest ||
      continuity === null ||
      continuity.lease.acquire_commit_sha !==
        terminalAuthority.lease_acquire_commit_sha
    ) {
      throw ledgerError(
        "candidate-dispatch-terminal-authority-mismatch",
        "candidate dispatch ack does not bind its exact released terminal authority",
      );
    }
    validateCandidateDispatchTerminalHistoryRecords({
      records: priorRecords,
      scheduler_observation_record_oid:
        terminalAuthority.scheduler_observation_record_oid,
      scheduler_observation_payload_digest:
        terminalAuthority.scheduler_observation_payload_digest,
      lease_acquire_commit_sha:
        terminalAuthority.lease_acquire_commit_sha,
      lease_release_record_oid: terminalAuthority.lease_release_record_oid,
      terminal_projection: terminalAuthority.terminal_projection,
      scheduled_scope_receipt: scheduledScopeReceipt,
      owner,
    });
  } else {
    const recovery = terminalAuthority.recovery;
    if (
      recovery.source_tip_commit_sha !== predecessorCommitSha ||
      Date.parse(timestamp(recordServerTime,
        "candidate dispatch recovery ack time")) <
        Date.parse(recovery.post_ref_receipt.server_time)
    ) {
      throw ledgerError(
        "candidate-dispatch-terminal-authority-mismatch",
        "candidate dispatch recovery ack does not follow its stable source tip",
      );
    }
    const evidence = deriveCandidateDispatchRecoveryEvidence({
      records: priorRecords,
      attempt_binding: candidateDispatchAttemptBinding(
        scheduledScopeReceipt,
      ),
      source_tip_commit_sha: predecessorCommitSha,
      post_ref_receipt: recovery.post_ref_receipt,
      scheduled_scope_receipt: scheduledScopeReceipt,
    });
    if (
      terminalAuthority.scheduler_observation_record_oid !==
        evidence.scheduler_observation_record_oid ||
      terminalAuthority.scheduler_observation_payload_digest !==
        evidence.scheduler_observation_payload_digest ||
      terminalAuthority.lease_acquire_commit_sha !==
        evidence.lease_acquire_commit_sha ||
      terminalAuthority.lease_release_record_oid !==
        evidence.lease_release_record_oid ||
      terminalAuthority.full_scope_receipt_digest !==
        evidence.full_scope_receipt_digest ||
      canonicalJson(terminalAuthority.terminal_projection) !==
        canonicalJson(evidence.terminal_projection) ||
      canonicalJson(terminalAuthority.recovery) !==
        canonicalJson(evidence.recovery)
    ) {
      throw ledgerError(
        "candidate-dispatch-terminal-authority-mismatch",
        "candidate dispatch recovery authority differs from reachable history",
      );
    }
  }
  const expectedResult = candidateDispatchOutcomeFromTerminalAuthority(
    terminalAuthority,
  );
  if (
    ack.result.decision !== expectedResult.decision ||
    ack.result.public_effects_performed !==
      expectedResult.public_effects_performed ||
    ack.result.outcome !== expectedResult.outcome ||
    ack.result.failure_code !== expectedResult.failure_code
  ) {
    throw ledgerError(
      "candidate-dispatch-terminal-result-mismatch",
      "candidate dispatch result differs from its reachable terminal history",
    );
  }
}

function sealCandidateDispatchResultHandle({
  candidateDispatchHandle,
  schedulerAppend,
  leaseReleaseReceipt,
  result,
}) {
  const withoutDigest = {
    schema: V2_GIT_LEDGER_CANDIDATE_DISPATCH_RESULT_HANDLE_SCHEMA,
    schema_version: 1,
    candidate_number: result.candidate.number,
    dispatch_digest: candidateDispatchHandle.dispatch_digest,
    scheduler_observation_record_oid: schedulerAppend.append_receipt.commit_sha,
    release_record_oid: leaseReleaseReceipt.commit_sha,
    controller_authority_digest: result.controller_authority_digest,
    controller_result_digest: result.controller_result_digest,
    result_digest: result.result_digest,
  };
  return deepFreeze({
    ...withoutDigest,
    handle_digest: digestCanonical(
      "codex-review-gate-v2-candidate-dispatch-result-handle",
      withoutDigest,
    ),
  });
}

function createCandidateDispatchTerminalAuthority({
  scheduler_append: schedulerAppend,
  scheduler_authority: schedulerAuthority,
  full_scope_receipt: fullScopeReceipt,
  lease_release_receipt: leaseReleaseReceipt,
  terminal_result: terminal,
}) {
  const projection = {
    decision: terminal.decision,
    public_effects_performed: terminal.public_effects_performed,
    status_effect_outcome: terminal.status_effect_outcome,
    status_ambiguity_code: terminal.status_ambiguity_code,
    reservation_status_effect_outcome:
      terminal.reservation_status_effect_outcome,
    reservation_status_ambiguity_code:
      terminal.reservation_status_ambiguity_code,
    automatic_request_effect_outcome:
      terminal.automatic_request_effect_outcome,
    automatic_request_ambiguity_code:
      terminal.automatic_request_ambiguity_code,
  };
  const terminalProjectionDigest = digestCanonical(
    "codex-review-gate-v2-candidate-dispatch-terminal-projection",
    projection,
  );
  const withoutDigest = {
    kind: "controller-terminal",
    scheduler_observation_record_oid:
      schedulerAuthority.observation_record_oid,
    scheduler_observation_payload_digest:
      schedulerAppend.record.payload_digest,
    lease_acquire_commit_sha:
      schedulerAuthority.lease_authority.acquire_commit_sha,
    lease_release_record_oid: leaseReleaseReceipt.commit_sha,
    full_scope_receipt_digest: fullScopeReceipt.receipt_digest,
    scheduled_scope_receipt_digest: fullScopeReceipt.receipt_digest,
    terminal_projection: projection,
    terminal_projection_digest: terminalProjectionDigest,
    recovery: null,
  };
  return normalizeCandidateDispatchTerminalAuthority({
    ...withoutDigest,
    authority_digest: digestCanonical(
      "codex-review-gate-v2-candidate-dispatch-terminal-authority",
      withoutDigest,
    ),
  });
}

function normalizeCandidateDispatchTerminalAuthority(value) {
  assertObject(value, "candidate dispatch terminal authority");
  exactKeys(value, [
    "kind", "scheduler_observation_record_oid",
    "scheduler_observation_payload_digest", "lease_acquire_commit_sha",
    "lease_release_record_oid", "full_scope_receipt_digest",
    "scheduled_scope_receipt_digest", "terminal_projection",
    "terminal_projection_digest", "recovery", "authority_digest",
  ], "candidate dispatch terminal authority");
  if (!new Set(["controller-terminal", "durable-prefix-recovery"])
    .has(value.kind)) {
    throw new Error("candidate dispatch terminal authority kind is invalid");
  }
  if (value.scheduler_observation_record_oid !== null) {
    sha(value.scheduler_observation_record_oid,
      "candidate dispatch terminal scheduler observation");
  }
  if (value.scheduler_observation_payload_digest !== null) {
    digest(value.scheduler_observation_payload_digest,
      "candidate dispatch terminal scheduler payload");
  }
  sha(value.lease_acquire_commit_sha,
    "candidate dispatch terminal lease acquire");
  if (value.lease_release_record_oid !== null) {
    sha(value.lease_release_record_oid,
      "candidate dispatch terminal lease release");
  }
  if (value.full_scope_receipt_digest !== null) {
    digest(value.full_scope_receipt_digest,
      "candidate dispatch terminal full scope receipt");
  }
  digest(value.scheduled_scope_receipt_digest,
    "candidate dispatch terminal scheduled scope receipt");
  assertObject(value.terminal_projection,
    "candidate dispatch terminal projection");
  exactKeys(value.terminal_projection, [
    "decision", "public_effects_performed", "status_effect_outcome",
    "status_ambiguity_code", "reservation_status_effect_outcome",
    "reservation_status_ambiguity_code", "automatic_request_effect_outcome",
    "automatic_request_ambiguity_code",
  ], "candidate dispatch terminal projection");
  boundedString(value.terminal_projection.decision,
    "candidate dispatch terminal projection decision", 64);
  nonnegativeInteger(value.terminal_projection.public_effects_performed,
    "candidate dispatch terminal projection public effects");
  for (const key of [
    "status_effect_outcome", "reservation_status_effect_outcome",
    "automatic_request_effect_outcome",
  ]) {
    if (!new Set(["not-required", "bound", "ambiguous"])
      .has(value.terminal_projection[key])) {
      throw new Error(`candidate dispatch terminal projection ${key} is invalid`);
    }
  }
  const recovery = value.recovery === null
    ? null
    : normalizeCandidateDispatchRecoveryAuthority(value.recovery);
  if (
    value.kind === "controller-terminal" && (
      value.scheduler_observation_record_oid === null ||
      value.scheduler_observation_payload_digest === null ||
      value.lease_release_record_oid === null ||
      value.full_scope_receipt_digest === null ||
      value.scheduled_scope_receipt_digest !==
        value.full_scope_receipt_digest ||
      recovery !== null
    ) ||
    value.kind === "durable-prefix-recovery" && recovery === null
  ) {
    throw new Error("candidate dispatch terminal authority fields differ from its kind");
  }
  for (const key of [
    "status_ambiguity_code", "reservation_status_ambiguity_code",
    "automatic_request_ambiguity_code",
  ]) {
    if (value.terminal_projection[key] !== null) {
      boundedString(value.terminal_projection[key],
        `candidate dispatch terminal projection ${key}`, 256);
    }
  }
  digest(value.terminal_projection_digest,
    "candidate dispatch terminal projection digest");
  digest(value.authority_digest,
    "candidate dispatch terminal authority digest");
  if (
    value.terminal_projection_digest !== digestCanonical(
      "codex-review-gate-v2-candidate-dispatch-terminal-projection",
      value.terminal_projection,
    )
  ) {
    throw new Error("candidate dispatch terminal projection digest is invalid");
  }
  const { authority_digest: _digest, ...withoutDigest } = value;
  if (value.authority_digest !== digestCanonical(
    "codex-review-gate-v2-candidate-dispatch-terminal-authority",
    withoutDigest,
  )) {
    throw new Error("candidate dispatch terminal authority digest is invalid");
  }
  return deepFreeze({ ...structuredClone(value), recovery });
}

function normalizeCandidateDispatchRecoveryAuthority(value) {
  assertObject(value, "candidate dispatch recovery authority");
  exactKeys(value, [
    "mode", "source_tip_commit_sha", "post_ref_receipt",
    "prefix_tip_record_oid", "prefix_phase", "lease_expires_at",
    "failure_code",
  ], "candidate dispatch recovery authority");
  if (!new Set(["released", "expired"]).has(value.mode)) {
    throw new Error("candidate dispatch recovery mode is invalid");
  }
  sha(value.source_tip_commit_sha,
    "candidate dispatch recovery source tip");
  validateRefReceipt(value.post_ref_receipt);
  const postRefReceipt = structuredClone(value.post_ref_receipt);
  if (postRefReceipt.target_commit_sha !== value.source_tip_commit_sha) {
    throw new Error("candidate dispatch recovery ref receipt differs from its source tip");
  }
  sha(value.prefix_tip_record_oid,
    "candidate dispatch recovery prefix tip");
  boundedString(value.prefix_phase,
    "candidate dispatch recovery prefix phase", 64);
  timestamp(value.lease_expires_at,
    "candidate dispatch recovery lease expiry");
  const failureCode = boundedString(value.failure_code,
    "candidate dispatch recovery failure code", 128);
  if (!/^[A-Z][A-Z0-9_]{2,127}$/u.test(failureCode)) {
    throw new Error("candidate dispatch recovery failure code is invalid");
  }
  return deepFreeze({
    ...structuredClone(value),
    post_ref_receipt: structuredClone(postRefReceipt),
    failure_code: failureCode,
  });
}

function normalizeCandidateDispatchAck(value) {
  assertObject(value, "candidate dispatch ack");
  exactKeys(value, [
    "generation_id", "cycle_id", "inventory_digest", "reservation_digest",
    "dispatch_digest", "batch_index", "candidate_index", "candidate",
    "result", "terminal_authority", "scheduled_scope_receipt", "ack_digest",
  ], "candidate dispatch ack");
  if (!CANDIDATE_DISPATCH_GENERATION_ID.test(value.generation_id) ||
      !CANDIDATE_CYCLE_ID.test(value.cycle_id)) {
    throw new Error("candidate dispatch ack generation is invalid");
  }
  for (const [field, label] of [
    [value.inventory_digest, "inventory"],
    [value.reservation_digest, "reservation"],
    [value.dispatch_digest, "dispatch"],
    [value.ack_digest, "ack"],
  ]) digest(field, `candidate dispatch ack ${label} digest`);
  const batchIndex = nonnegativeInteger(value.batch_index,
    "candidate dispatch ack batch index");
  const candidateIndex = nonnegativeInteger(value.candidate_index,
    "candidate dispatch ack candidate index");
  if (candidateIndex >= MAX_V2_CANDIDATE_DISPATCH_ITEMS) {
    throw new Error("candidate dispatch ack candidate index exceeds the batch cap");
  }
  const candidate = normalizeCandidateDispatchSelection(
    value.candidate,
    "candidate dispatch ack candidate",
  );
  const result = validateV2GitLedgerCandidateDispatchResult(value.result);
  const terminalAuthority = normalizeCandidateDispatchTerminalAuthority(
    value.terminal_authority,
  );
  if (
    canonicalJson(candidate) !== canonicalJson(result.candidate) ||
    result.controller_authority_digest !==
      terminalAuthority.authority_digest ||
    result.controller_result_digest !==
      terminalAuthority.terminal_projection_digest
  ) {
    throw new Error("candidate dispatch ack result belongs to another candidate");
  }
  const scheduledScopeReceipt = validateV2GitLedgerEvaluatedScopeReceipt(
    value.scheduled_scope_receipt,
  );
  if (scheduledScopeReceipt.relation !== "scheduled-pull-request" ||
      terminalAuthority.scheduled_scope_receipt_digest !==
        scheduledScopeReceipt.receipt_digest ||
      terminalAuthority.kind === "controller-terminal" && (
        scheduledScopeReceipt.phase !== "full-discovery" ||
        terminalAuthority.full_scope_receipt_digest !==
          scheduledScopeReceipt.receipt_digest
      ) ||
      terminalAuthority.kind === "durable-prefix-recovery" && (
        !new Set(["pre-scope", "full-discovery"])
          .has(scheduledScopeReceipt.phase) ||
        (scheduledScopeReceipt.phase === "full-discovery") !==
          (terminalAuthority.full_scope_receipt_digest !== null) ||
        terminalAuthority.full_scope_receipt_digest !== null &&
          terminalAuthority.full_scope_receipt_digest !==
            scheduledScopeReceipt.receipt_digest
      )) {
    throw new Error("candidate dispatch ack lacks its scheduled PR authority");
  }
  const { ack_digest: _digest, ...withoutDigest } = value;
  if (value.ack_digest !== digestCanonical(
    "codex-review-gate-v2-candidate-dispatch-ack",
    withoutDigest,
  )) {
    throw new Error("candidate dispatch ack digest is invalid");
  }
  return deepFreeze({
    ...structuredClone(value),
    batch_index: batchIndex,
    candidate_index: candidateIndex,
    candidate,
    result,
    terminal_authority: terminalAuthority,
    scheduled_scope_receipt: scheduledScopeReceipt,
  });
}

function normalizeCandidateDispatchBatchCompletion(value) {
  assertObject(value, "candidate dispatch batch completion");
  exactKeys(value, [
    "generation_id", "cycle_id", "inventory_digest", "reservation_digest",
    "dispatch_digest", "batch_index", "batch_count", "ack_record_oids",
    "result_digests", "completion_digest",
  ], "candidate dispatch batch completion");
  if (!CANDIDATE_DISPATCH_GENERATION_ID.test(value.generation_id) ||
      !CANDIDATE_CYCLE_ID.test(value.cycle_id)) {
    throw new Error("candidate dispatch batch completion generation is invalid");
  }
  for (const field of [
    "inventory_digest", "reservation_digest", "dispatch_digest",
    "completion_digest",
  ]) digest(value[field], `candidate dispatch batch completion ${field}`);
  const batchIndex = nonnegativeInteger(value.batch_index,
    "candidate dispatch batch completion batch index");
  const batchCount = positiveInteger(value.batch_count,
    "candidate dispatch batch completion batch count");
  if (batchIndex >= batchCount || batchCount > MAX_V2_CANDIDATE_DISPATCH_BATCHES) {
    throw new Error("candidate dispatch batch completion identity is invalid");
  }
  if (!Array.isArray(value.ack_record_oids) ||
      !Array.isArray(value.result_digests) ||
      value.ack_record_oids.length === 0 ||
      value.ack_record_oids.length !== value.result_digests.length ||
      value.ack_record_oids.length > MAX_V2_CANDIDATE_DISPATCH_ITEMS) {
    throw new Error("candidate dispatch batch completion inventory is invalid");
  }
  value.ack_record_oids.forEach((oid, index) =>
    sha(oid, `candidate dispatch batch completion ack oid ${index}`));
  value.result_digests.forEach((entry, index) =>
    digest(entry, `candidate dispatch batch completion result digest ${index}`));
  if (new Set(value.ack_record_oids).size !== value.ack_record_oids.length ||
      new Set(value.result_digests).size !== value.result_digests.length) {
    throw new Error("candidate dispatch batch completion entries are duplicated");
  }
  const { completion_digest: _digest, ...withoutDigest } = value;
  if (value.completion_digest !== digestCanonical(
    "codex-review-gate-v2-candidate-dispatch-batch-completion",
    withoutDigest,
  )) {
    throw new Error("candidate dispatch batch completion digest is invalid");
  }
  return deepFreeze(structuredClone(value));
}

function normalizeCandidateDispatchCycleCompletion(value) {
  assertObject(value, "candidate dispatch cycle completion");
  exactKeys(value, [
    "generation_id", "cycle_id", "inventory_digest", "batch_count",
    "candidate_count", "batch_completion_record_oids",
    "batch_completion_digests", "completion_digest",
  ], "candidate dispatch cycle completion");
  if (!CANDIDATE_DISPATCH_GENERATION_ID.test(value.generation_id) ||
      !CANDIDATE_CYCLE_ID.test(value.cycle_id)) {
    throw new Error("candidate dispatch cycle completion generation is invalid");
  }
  digest(value.inventory_digest,
    "candidate dispatch cycle completion inventory digest");
  const batchCount = nonnegativeInteger(value.batch_count,
    "candidate dispatch cycle completion batch count");
  const candidateCount = nonnegativeInteger(value.candidate_count,
    "candidate dispatch cycle completion candidate count");
  if (batchCount > MAX_V2_CANDIDATE_DISPATCH_BATCHES ||
      candidateCount > MAX_V2_CANDIDATE_DISPATCH_CYCLE_ITEMS ||
      !Array.isArray(value.batch_completion_record_oids) ||
      !Array.isArray(value.batch_completion_digests) ||
      value.batch_completion_record_oids.length !== batchCount ||
      value.batch_completion_digests.length !== batchCount) {
    throw new Error("candidate dispatch cycle completion inventory is invalid");
  }
  value.batch_completion_record_oids.forEach((oid, index) =>
    sha(oid, `candidate dispatch cycle completion batch oid ${index}`));
  value.batch_completion_digests.forEach((entry, index) =>
    digest(entry, `candidate dispatch cycle completion batch digest ${index}`));
  digest(value.completion_digest,
    "candidate dispatch cycle completion digest");
  const { completion_digest: _digest, ...withoutDigest } = value;
  if (value.completion_digest !== digestCanonical(
    "codex-review-gate-v2-candidate-dispatch-cycle-completion",
    withoutDigest,
  )) {
    throw new Error("candidate dispatch cycle completion digest is invalid");
  }
  return deepFreeze(structuredClone(value));
}

function normalizeCandidateDispatchPlanItem(value, label) {
  assertObject(value, label);
  exactKeys(value, [
    "generation_id", "cycle_id", "inventory_digest", "batch_index",
    "batch_count", "dispatch_digest", "candidate",
  ], label);
  if (!CANDIDATE_DISPATCH_GENERATION_ID.test(value.generation_id) ||
      !CANDIDATE_CYCLE_ID.test(value.cycle_id)) {
    throw new Error(`${label} generation is invalid`);
  }
  digest(value.inventory_digest, `${label}.inventory_digest`);
  const batchIndex = nonnegativeInteger(
    value.batch_index,
    `${label}.batch_index`,
  );
  const batchCount = positiveInteger(value.batch_count, `${label}.batch_count`);
  if (batchIndex >= batchCount ||
      batchCount > MAX_V2_CANDIDATE_DISPATCH_BATCHES) {
    throw new Error(`${label} batch identity is invalid`);
  }
  digest(value.dispatch_digest, `${label}.dispatch_digest`);
  return deepFreeze({
    generation_id: value.generation_id,
    cycle_id: value.cycle_id,
    inventory_digest: value.inventory_digest,
    batch_index: batchIndex,
    batch_count: batchCount,
    dispatch_digest: value.dispatch_digest,
    candidate: normalizeCandidateDispatchSelection(
      value.candidate,
      `${label}.candidate`,
    ),
  });
}

function normalizeCandidateDispatchSelection(value, label) {
  assertObject(value, label);
  exactKeys(value, [
    "id", "node_id", "number", "created_at", "head_ref_oid",
    "base_ref_oid", "observation_server_time",
    "observation_raw_body_sha256",
  ], label);
  return {
    id: decimal(value.id, `${label}.id`),
    node_id: boundedString(value.node_id, `${label}.node_id`, 256),
    number: positiveInteger(value.number, `${label}.number`),
    created_at: timestamp(value.created_at, `${label}.created_at`),
    head_ref_oid: sha(value.head_ref_oid, `${label}.head_ref_oid`),
    base_ref_oid: sha(value.base_ref_oid, `${label}.base_ref_oid`),
    observation_server_time: timestamp(
      value.observation_server_time,
      `${label}.observation_server_time`,
    ),
    observation_raw_body_sha256: digest(
      value.observation_raw_body_sha256,
      `${label}.observation_raw_body_sha256`,
    ),
  };
}

function requireUniqueCandidateDispatchSelections(candidates) {
  const ids = new Set();
  const nodes = new Set();
  const numbers = new Set();
  for (const candidate of candidates) {
    if (ids.has(candidate.id) || nodes.has(candidate.node_id) ||
        numbers.has(candidate.number)) {
      throw new Error("candidate dispatch selection contains duplicate identity");
    }
    ids.add(candidate.id);
    nodes.add(candidate.node_id);
    numbers.add(candidate.number);
  }
}

function normalizeCandidateDispatchCommandAuthority(value) {
  assertObject(value, "candidate dispatch command authority");
  exactKeys(value, [
    "command_digest", "repository", "pull_request_number",
    "dispatch_binding", "selection_policy", "route", "invocation",
    "workflow_receipt_digest",
  ], "candidate dispatch command authority");
  digest(value.command_digest, "candidate dispatch command digest");
  const repository = normalizeCandidateRepository(value.repository);
  const pullRequestNumber = value.pull_request_number === null
    ? null
    : positiveInteger(value.pull_request_number,
      "candidate dispatch command pull request number");
  const dispatchBinding = value.dispatch_binding === null
    ? null
    : normalizeCandidateDispatchPlanItem(
      value.dispatch_binding,
      "candidate dispatch command dispatch binding",
    );
  if ((pullRequestNumber === null) !== (dispatchBinding === null) ||
      dispatchBinding !== null &&
        dispatchBinding.candidate.number !== pullRequestNumber) {
    throw new Error(
      "candidate dispatch command selector differs from its dispatch binding",
    );
  }
  boundedString(value.selection_policy,
    "candidate dispatch command selection policy", 128);
  assertObject(value.route, "candidate dispatch command route");
  exactKeys(value.route, ["operation", "trigger", "observation_boundary"],
    "candidate dispatch command route");
  if (canonicalJson(value.route) !== canonicalJson({
    operation: "ordinary",
    trigger: "schedule",
    observation_boundary: "initial",
  })) {
    throw new Error("candidate dispatch command is not an initial schedule route");
  }
  assertObject(value.invocation, "candidate dispatch command invocation");
  exactKeys(value.invocation, [
    "event_name", "event_payload_sha256", "run_id", "run_attempt",
    "actor_id",
  ], "candidate dispatch command invocation");
  if (value.invocation.event_name !== "schedule") {
    throw new Error("candidate dispatch command is not a schedule invocation");
  }
  digest(value.invocation.event_payload_sha256,
    "candidate dispatch command event payload digest");
  decimal(value.invocation.run_id, "candidate dispatch command run_id");
  positiveInteger(value.invocation.run_attempt,
    "candidate dispatch command run_attempt");
  decimal(value.invocation.actor_id, "candidate dispatch command actor_id");
  digest(value.workflow_receipt_digest,
    "candidate dispatch workflow receipt digest");
  return deepFreeze({
    ...structuredClone(value),
    repository,
    pull_request_number: pullRequestNumber,
    dispatch_binding: dispatchBinding,
  });
}

function candidateDispatchStableCommandAuthority(value) {
  const command = normalizeCandidateDispatchCommandAuthority(value);
  return {
    repository: structuredClone(command.repository),
    selection_policy: command.selection_policy,
    route: structuredClone(command.route),
    invocation: {
      event_name: command.invocation.event_name,
      event_payload_sha256: command.invocation.event_payload_sha256,
    },
    workflow_receipt_digest: command.workflow_receipt_digest,
  };
}

function candidateDispatchCompletionCommandMatches(current, prior) {
  const currentCommand = normalizeCandidateDispatchCommandAuthority(current);
  const priorCommand = normalizeCandidateDispatchCommandAuthority(prior);
  return canonicalJson(currentCommand) === canonicalJson(priorCommand) ||
    currentCommand.pull_request_number === null &&
      canonicalJson(candidateDispatchStableCommandAuthority(currentCommand)) ===
        canonicalJson(candidateDispatchStableCommandAuthority(priorCommand));
}

function normalizeCandidateDispatchTriggerIdentity(value) {
  assertObject(value, "candidate dispatch trigger identity");
  exactKeys(value, ["event_name", "ref", "sha"],
    "candidate dispatch trigger identity");
  if (value.event_name !== "schedule" ||
      !boundedString(value.ref, "candidate dispatch trigger ref", 1024)
        .startsWith("refs/")) {
    throw new Error("candidate dispatch trigger is not one schedule ref");
  }
  return {
    event_name: "schedule",
    ref: value.ref,
    sha: sha(value.sha, "candidate dispatch trigger sha"),
  };
}

export function deriveV2GitLedgerCandidateDispatchAuthority(
  records,
  repositoryValue = null,
) {
  if (!Array.isArray(records) || records.length > MAX_V2_GIT_LEDGER_COMMITS) {
    throw new TypeError(
      "candidate dispatch authority requires a bounded reachable record array",
    );
  }
  const repository = normalizeRepository(
    repositoryValue ?? records[0]?.envelope?.repository,
  );
  const inventoryState = {
    source_records: [],
    seen_cycle_ids: new Set(),
    completed: null,
    incomplete: null,
  };
  const dispatchState = {
    source_records: [],
    cycles: [],
  };
  for (const [recordIndex, entry] of records.entries()) {
    assertObject(entry, "candidate dispatch authority record");
    const envelope = entry.envelope;
    if (envelope?.record_type === "candidate-inventory-observation") {
      validateProjectionEnvelope(envelope);
      const payload = validateV2GitLedgerCandidateInventoryPayload(
        envelope.payload,
        { repository },
      );
      const currentDispatch = dispatchState.cycles.at(-1) ?? null;
      if (payload.phase === "cycle-start" &&
          currentDispatch !== null && currentDispatch.cycle_complete === false) {
        throw ledgerError(
          "candidate-dispatch-inventory-replacement",
          "a new candidate inventory cannot replace an unfinished dispatch cycle",
        );
      }
      const inventoryRow = candidateInventorySourceRecord(entry);
      validateAndApplyCandidateInventoryTransition({
        payload,
        repository,
        state: inventoryState,
        recordOid: inventoryRow.record_oid,
        recordServerTime: envelope.server_observed_at,
        apply: true,
      });
      inventoryState.source_records.push(inventoryRow);
      continue;
    }
    if (envelope?.record_type !== "candidate-dispatch-observation") continue;
    validateProjectionEnvelope(envelope);
    if (canonicalJson(normalizeRepository(envelope.repository)) !==
        canonicalJson(repository)) {
      throw new Error("candidate dispatch history crosses repository authority");
    }
    const payload = validateV2GitLedgerCandidateDispatchPayload(
      envelope.payload,
      { repository },
    );
    const currentAuthority = buildCandidateDispatchAuthority(
      repository,
      dispatchState,
    );
    if (payload.prior_candidate_dispatch_authority_digest !==
        currentAuthority.authority_digest) {
      throw ledgerError(
        "candidate-dispatch-predecessor",
        "candidate dispatch record does not bind prior dispatch authority",
      );
    }
    const row = candidateDispatchSourceRecord(entry);
    validateAndApplyCandidateDispatchTransition({
      payload,
      repository,
      candidateAuthority: buildCandidateInventoryAuthority(
        repository,
        inventoryState,
      ),
      state: dispatchState,
      recordOid: row.record_oid,
      predecessorCommitSha: envelope.predecessor_commit_sha,
      recordServerTime: envelope.server_observed_at,
      reachableRecordCount: entry.envelope.sequence,
      priorRecords: records.slice(0, recordIndex),
      apply: true,
    });
    validateCandidateDispatchEvaluatedScopeBinding(
      envelope,
      envelope.workflow_provenance.operation_binding.evaluated_scope_receipt,
    );
    dispatchState.source_records.push(row);
  }
  return buildCandidateDispatchAuthority(repository, dispatchState);
}

function validateCandidateDispatchTransition(records, record, repository) {
  const authority = deriveV2GitLedgerCandidateDispatchAuthority(
    records,
    repository,
  );
  const state = candidateDispatchStateFromAuthority(authority);
  const payload = validateV2GitLedgerCandidateDispatchPayload(
    record.payload,
    { repository },
  );
  if (payload.prior_candidate_dispatch_authority_digest !==
      authority.authority_digest) {
    throw ledgerError(
      "candidate-dispatch-predecessor",
      "candidate dispatch append does not bind current dispatch authority",
    );
  }
  validateAndApplyCandidateDispatchTransition({
    payload,
    repository,
    candidateAuthority: deriveV2GitLedgerCandidateInventoryAuthority(
      records,
      repository,
    ),
    state,
    recordOid: null,
    predecessorCommitSha: record.predecessor_commit_sha,
    recordServerTime: record.server_observed_at,
    reachableRecordCount: records.length,
    priorRecords: records,
    apply: false,
  });
}

function validateAndApplyCandidateDispatchTransition({
  payload,
  repository,
  candidateAuthority,
  state,
  recordOid,
  predecessorCommitSha,
  recordServerTime,
  reachableRecordCount,
  priorRecords,
  apply,
}) {
  const completed = candidateAuthority.completed_cycle;
  if (
    completed === null || candidateAuthority.incomplete_cycle !== null ||
    payload.cycle_id !== completed.cycle_id ||
    payload.candidate_inventory_authority_digest !==
      candidateAuthority.authority_digest ||
    payload.completed_cycle_record_oid !== completed.complete_record_oid ||
    payload.inventory_digest !== completed.cycle_receipt.receipt_digest
  ) {
    throw ledgerError(
      "candidate-dispatch-inventory-authority-mismatch",
      "candidate dispatch does not bind one current completed inventory cycle",
    );
  }
  const expectedGeneration = candidateDispatchGenerationId(
    repository,
    completed,
  );
  if (payload.generation_id !== expectedGeneration) {
    throw ledgerError(
      "candidate-dispatch-generation-mismatch",
      "candidate dispatch generation differs from its completed inventory",
    );
  }
  const command = payload.command_authority;
  if (
    canonicalJson(command.repository) !==
      canonicalJson(candidateRepository(repository)) ||
    command.invocation.run_id !== payload.owner.run_id ||
    command.invocation.run_attempt !== payload.owner.run_attempt ||
    command.invocation.actor_id !== payload.owner.actor_id
  ) {
    throw ledgerError(
      "candidate-dispatch-command-owner-mismatch",
      "candidate dispatch command differs from its signed record owner",
    );
  }
  const candidates = candidateDispatchSelections(completed);
  if (candidates.length > MAX_V2_CANDIDATE_DISPATCH_CYCLE_ITEMS) {
    throw ledgerError(
      "candidate-dispatch-cycle-size",
      "completed candidate cycle exceeds the dispatch item hard cap",
    );
  }
  const batchCount = Math.ceil(
    candidates.length / MAX_V2_CANDIDATE_DISPATCH_ITEMS,
  );
  if (batchCount > MAX_V2_CANDIDATE_DISPATCH_BATCHES) {
    throw ledgerError(
      "candidate-dispatch-batch-cap",
      "completed candidate cycle exceeds the dispatch batch hard cap",
    );
  }
  let cycle = state.cycles.at(-1) ?? null;
  if (cycle !== null && cycle.generation_id !== expectedGeneration &&
      cycle.cycle_complete === false) {
    throw ledgerError(
      "candidate-dispatch-cycle-active",
      "another candidate dispatch generation is unfinished",
    );
  }
  if (payload.phase === "reserve") {
    if (candidates.length === 0) {
      throw ledgerError(
        "candidate-dispatch-empty-reservation",
        "an empty completed inventory cannot reserve a dispatch batch",
      );
    }
    if (cycle === null || cycle.generation_id !== expectedGeneration) {
      cycle = newCandidateDispatchCycle({
        repository,
        candidateAuthority,
        completed,
        candidates,
        batchCount,
      });
      if (apply) state.cycles.push(cycle);
    } else if (cycle.cycle_complete) {
      throw ledgerError(
        "candidate-dispatch-cycle-replayed",
        "completed candidate dispatch generation cannot reserve again",
      );
    }
    if (cycle.active_reservation !== null) {
      throw ledgerError(
        "candidate-dispatch-reservation-active",
        "candidate dispatch already has one active reservation",
      );
    }
    const batchIndex = cycle.completed_batches.length;
    if (batchIndex >= batchCount) {
      throw ledgerError(
        "candidate-dispatch-batches-complete",
        "all candidate dispatch batches are already completed",
      );
    }
    const offset = batchIndex * MAX_V2_CANDIDATE_DISPATCH_ITEMS;
    const selected = candidates.slice(
      offset,
      offset + MAX_V2_CANDIDATE_DISPATCH_ITEMS,
    );
    const reservation = payload.reservation;
    const remainingCandidates = candidates.length - offset;
    const remainingBatches = batchCount - batchIndex;
    const commitBudget = calculateV2GitLedgerCandidateDispatchCommitBudget({
      candidate_count: remainingCandidates,
      batch_count: remainingBatches,
      reachable_record_count: reachableRecordCount,
    });
    if (commitBudget.remaining_ledger_commit_capacity_after_dispatch < 0) {
      throw ledgerError(
        "candidate-dispatch-commit-capacity",
        "ledger cannot persist the remaining scheduled candidate protocol",
      );
    }
    if (
      reservation.source_tip_commit_sha !== predecessorCommitSha ||
      reservation.batch_index !== batchIndex ||
      reservation.batch_count !== batchCount ||
      reservation.candidate_offset !== offset ||
      canonicalJson(reservation.candidates) !== canonicalJson(selected) ||
      reservation.dispatch_commit_budget_required !==
        commitBudget.dispatch_commit_budget_required ||
      reservation.candidate_execution_commit_budget_required !==
        commitBudget.candidate_execution_commit_budget_required ||
      reservation.total_commit_budget_required !==
        commitBudget.total_commit_budget_required ||
      reservation.remaining_ledger_commit_capacity_after_dispatch !==
        commitBudget.remaining_ledger_commit_capacity_after_dispatch ||
      reservation.scan_command_digest !== command.command_digest ||
      reservation.scan_workflow_receipt_digest !==
        command.workflow_receipt_digest ||
      canonicalJson(payload.trigger_identity) !==
        canonicalJson(reservation.trigger_identity) ||
      reservation.repository.owner !== repository.owner ||
      reservation.repository.name !== repository.name ||
      reservation.repository.id !== repository.id ||
      reservation.repository.node_id !== repository.node_id
    ) {
      throw ledgerError(
        "candidate-dispatch-reservation-mismatch",
        "candidate dispatch reservation is not the canonical next batch",
      );
    }
    if (Date.parse(selected.at(-1).observation_server_time) >
        Date.parse(recordServerTime)) {
      throw ledgerError(
        "candidate-dispatch-time",
        "candidate dispatch reservation predates its selected inventory",
      );
    }
    if (apply) {
      if (cycle.dispatch_command_authority === null) {
        cycle.dispatch_command_authority = structuredClone(command);
        cycle.trigger_identity = structuredClone(payload.trigger_identity);
      }
      cycle.active_reservation = {
        reservation_record_oid: sha(
          recordOid,
          "candidate dispatch reservation record oid",
        ),
        reservation: structuredClone(reservation),
        scan_command_authority: structuredClone(command),
        acknowledgements: [],
      };
    }
    return;
  }
  if (cycle === null || cycle.generation_id !== expectedGeneration ||
      cycle.cycle_complete) {
    if (payload.phase === "cycle-complete" && candidates.length === 0 &&
        cycle === null) {
      const completion = payload.cycle_completion;
      if (
        completion.batch_count !== 0 || completion.candidate_count !== 0 ||
        completion.batch_completion_record_oids.length !== 0 ||
        completion.batch_completion_digests.length !== 0 ||
        command.pull_request_number !== null
      ) {
        throw ledgerError(
          "candidate-dispatch-empty-completion",
          "empty dispatch cycle completion is not canonical",
        );
      }
      if (apply) {
        const empty = newCandidateDispatchCycle({
          repository,
          candidateAuthority,
          completed,
          candidates,
          batchCount,
        });
        empty.dispatch_command_authority = structuredClone(command);
        empty.trigger_identity = structuredClone(payload.trigger_identity);
        empty.cycle_complete = true;
        empty.cycle_complete_record_oid = sha(
          recordOid,
          "candidate dispatch empty cycle record oid",
        );
        empty.cycle_completion = structuredClone(completion);
        state.cycles.push(empty);
      }
      return;
    }
    throw ledgerError(
      "candidate-dispatch-cycle-unavailable",
      "candidate dispatch continuation has no active generation",
    );
  }
  if (payload.phase === "candidate-ack") {
    const active = cycle.active_reservation;
    if (active === null) {
      throw ledgerError(
        "candidate-dispatch-reservation-required",
        "candidate ack requires one active dispatch reservation",
      );
    }
    const ack = payload.candidate_ack;
    const reservation = active.reservation;
    const expectedCandidate = reservation.candidates[ack.candidate_index];
    if (
      ack.reservation_digest !== reservation.reservation_digest ||
      ack.dispatch_digest !== reservation.dispatch_digest ||
      ack.batch_index !== reservation.batch_index ||
      expectedCandidate === undefined ||
      canonicalJson(ack.candidate) !== canonicalJson(expectedCandidate) ||
      active.acknowledgements.some((item) =>
        item.candidate_index === ack.candidate_index ||
        item.result.result_digest === ack.result.result_digest) ||
      ack.terminal_authority.kind === "controller-terminal" &&
        command.pull_request_number !== expectedCandidate?.number ||
      ack.terminal_authority.kind === "durable-prefix-recovery" &&
        command.pull_request_number !== null &&
        command.pull_request_number !== expectedCandidate?.number ||
      canonicalJson(candidateDispatchStableCommandAuthority(command)) !==
        canonicalJson(candidateDispatchStableCommandAuthority(
          active.scan_command_authority,
        )) ||
      canonicalJson(payload.trigger_identity) !==
        canonicalJson(reservation.trigger_identity)
    ) {
      throw ledgerError(
        "candidate-dispatch-ack-mismatch",
        "candidate dispatch ack is stale, duplicated, or outside the active batch",
      );
    }
    validateScheduledDispatchReceiptAgainstReservation(
      ack.scheduled_scope_receipt,
      reservation,
      ack.candidate,
      {
        allow_pre_scope:
          ack.terminal_authority.kind === "durable-prefix-recovery",
      },
    );
    validateCandidateDispatchAckTerminalAuthority({
      prior_records: priorRecords,
      predecessor_commit_sha: predecessorCommitSha,
      ack,
      owner: payload.owner,
      record_server_time: recordServerTime,
    });
    if (apply) {
      active.acknowledgements.push({
        record_oid: sha(recordOid, "candidate dispatch ack record oid"),
        candidate_index: ack.candidate_index,
        result: structuredClone(ack.result),
        ack_digest: ack.ack_digest,
        command_authority: structuredClone(command),
        trigger_identity: structuredClone(payload.trigger_identity),
      });
      active.acknowledgements.sort((left, right) =>
        left.candidate_index - right.candidate_index);
    }
    return;
  }
  if (payload.phase === "batch-complete") {
    const active = cycle.active_reservation;
    if (active === null ||
        active.acknowledgements.length !== active.reservation.candidates.length) {
      throw ledgerError(
        "candidate-dispatch-batch-incomplete",
        "candidate dispatch batch completion requires every candidate ack",
      );
    }
    const completion = payload.batch_completion;
    const acknowledgements = [...active.acknowledgements]
      .sort((left, right) => left.candidate_index - right.candidate_index);
    if (
      completion.reservation_digest !==
        active.reservation.reservation_digest ||
      completion.dispatch_digest !== active.reservation.dispatch_digest ||
      completion.batch_index !== active.reservation.batch_index ||
      completion.batch_count !== active.reservation.batch_count ||
      canonicalJson(completion.ack_record_oids) !== canonicalJson(
        acknowledgements.map(({ record_oid: oid }) => oid),
      ) ||
      canonicalJson(completion.result_digests) !== canonicalJson(
        acknowledgements.map(({ result }) => result.result_digest),
      ) ||
      !candidateDispatchCompletionCommandMatches(
        command,
        acknowledgements.at(-1).command_authority,
      ) ||
      canonicalJson(payload.trigger_identity) !==
        canonicalJson(acknowledgements.at(-1).trigger_identity)
    ) {
      throw ledgerError(
        "candidate-dispatch-batch-completion-mismatch",
        "candidate dispatch batch completion differs from reachable acks",
      );
    }
    if (apply) {
      cycle.completed_batches.push({
        batch_index: completion.batch_index,
        reservation_record_oid: active.reservation_record_oid,
        reservation_digest: active.reservation.reservation_digest,
        dispatch_digest: active.reservation.dispatch_digest,
        candidate_count: active.reservation.candidates.length,
        ack_record_oids: structuredClone(completion.ack_record_oids),
        result_digests: structuredClone(completion.result_digests),
        command_authority: structuredClone(command),
        trigger_identity: structuredClone(payload.trigger_identity),
        complete_record_oid: sha(
          recordOid,
          "candidate dispatch batch completion record oid",
        ),
        completion_digest: completion.completion_digest,
      });
      cycle.active_reservation = null;
    }
    return;
  }
  if (cycle.active_reservation !== null ||
      cycle.completed_batches.length !== batchCount) {
    throw ledgerError(
      "candidate-dispatch-cycle-incomplete",
      "candidate dispatch cycle completion requires every batch completion",
    );
  }
  const completion = payload.cycle_completion;
  if (
    completion.batch_count !== batchCount ||
    completion.candidate_count !== candidates.length ||
    canonicalJson(completion.batch_completion_record_oids) !== canonicalJson(
      cycle.completed_batches.map(({ complete_record_oid: oid }) => oid),
    ) ||
    canonicalJson(completion.batch_completion_digests) !== canonicalJson(
      cycle.completed_batches.map(({ completion_digest: entry }) => entry),
    ) ||
    !candidateDispatchCompletionCommandMatches(
      command,
      cycle.completed_batches.at(-1).command_authority,
    ) ||
    canonicalJson(payload.trigger_identity) !==
      canonicalJson(cycle.completed_batches.at(-1).trigger_identity)
  ) {
    throw ledgerError(
      "candidate-dispatch-cycle-completion-mismatch",
      "candidate dispatch cycle completion differs from reachable batches",
    );
  }
  if (apply) {
    cycle.cycle_complete = true;
    cycle.cycle_complete_record_oid = sha(
      recordOid,
      "candidate dispatch cycle completion record oid",
    );
    cycle.cycle_completion = structuredClone(completion);
  }
}

function newCandidateDispatchCycle({
  repository,
  candidateAuthority,
  completed,
  candidates,
  batchCount,
}) {
  return {
    repository: structuredClone(repository),
    generation_id: candidateDispatchGenerationId(repository, completed),
    cycle_id: completed.cycle_id,
    candidate_inventory_authority_digest: candidateAuthority.authority_digest,
    completed_cycle_record_oid: completed.complete_record_oid,
    inventory_digest: completed.cycle_receipt.receipt_digest,
    candidate_count: candidates.length,
    batch_count: batchCount,
    candidates: structuredClone(candidates),
    dispatch_command_authority: null,
    trigger_identity: null,
    completed_batches: [],
    active_reservation: null,
    cycle_complete: false,
    cycle_complete_record_oid: null,
    cycle_completion: null,
  };
}

function candidateDispatchGenerationId(repository, completed) {
  const value = digestCanonical(
    "codex-review-gate-v2-candidate-dispatch-generation",
    {
      repository: candidateRepository(repository),
      cycle_id: completed.cycle_id,
      completed_cycle_record_oid: completed.complete_record_oid,
      inventory_digest: completed.cycle_receipt.receipt_digest,
    },
  );
  return `candidate-dispatch:${value.slice("sha256:".length)}`;
}

export function calculateV2GitLedgerCandidateDispatchCommitBudget({
  candidate_count,
  batch_count,
  reachable_record_count,
  reservation_persisted = false,
}) {
  const candidateCount = nonnegativeInteger(
    candidate_count,
    "candidate dispatch budget candidate_count",
  );
  const batchCount = nonnegativeInteger(
    batch_count,
    "candidate dispatch budget batch_count",
  );
  const reachableRecordCount = nonnegativeInteger(
    reachable_record_count,
    "candidate dispatch budget reachable_record_count",
  );
  if (typeof reservation_persisted !== "boolean") {
    throw new TypeError(
      "candidate dispatch budget reservation_persisted must be boolean",
    );
  }
  if (
    candidateCount > MAX_V2_CANDIDATE_DISPATCH_CYCLE_ITEMS ||
    batchCount > MAX_V2_CANDIDATE_DISPATCH_BATCHES ||
    (candidateCount === 0) !== (batchCount === 0) ||
    (!reservation_persisted &&
      batchCount !== Math.ceil(
        candidateCount / MAX_V2_CANDIDATE_DISPATCH_ITEMS,
      )) ||
    (reservation_persisted && (
      batchCount < Math.ceil(
        candidateCount / MAX_V2_CANDIDATE_DISPATCH_ITEMS,
      ) ||
      batchCount > Math.ceil(
        candidateCount / MAX_V2_CANDIDATE_DISPATCH_ITEMS,
      ) + 1
    )) ||
    reachableRecordCount > MAX_V2_GIT_LEDGER_COMMITS
  ) {
    throw ledgerError(
      "candidate-dispatch-commit-capacity",
      "candidate dispatch budget input exceeds the closed production profile",
    );
  }
  const dispatchCommitBudgetRequired = candidateCount +
    (2 * batchCount) + (reservation_persisted ? 0 : 1);
  const candidateExecutionCommitBudgetRequired = candidateCount *
    (MAX_V2_SCHEDULED_CANDIDATE_LEDGER_RECORDS - 1);
  const totalCommitBudgetRequired = dispatchCommitBudgetRequired +
    candidateExecutionCommitBudgetRequired;
  const remainingCapacity = MAX_V2_GIT_LEDGER_COMMITS -
    reachableRecordCount - totalCommitBudgetRequired;
  return deepFreeze({
    dispatch_commit_budget_required: dispatchCommitBudgetRequired,
    candidate_execution_commit_budget_required:
      candidateExecutionCommitBudgetRequired,
    total_commit_budget_required: totalCommitBudgetRequired,
    remaining_ledger_commit_capacity_after_dispatch: remainingCapacity,
  });
}

function calculateActiveCandidateDispatchCommitBudget(
  cycle,
  reachableRecordCount,
) {
  if (cycle?.active_reservation === null ||
      cycle?.active_reservation === undefined || cycle.cycle_complete) {
    throw ledgerError(
      "candidate-dispatch-reservation-required",
      "candidate dispatch capacity requires one active reservation",
    );
  }
  const completedCandidateCount = cycle.completed_batches.reduce(
    (total, batch) => total + batch.candidate_count,
    0,
  );
  const remainingCandidateCount = cycle.candidate_count -
    completedCandidateCount -
    cycle.active_reservation.acknowledgements.length;
  const remainingBatchCount = cycle.batch_count -
    cycle.completed_batches.length;
  return calculateV2GitLedgerCandidateDispatchCommitBudget({
    candidate_count: remainingCandidateCount,
    batch_count: remainingBatchCount,
    reachable_record_count: reachableRecordCount,
    reservation_persisted: true,
  });
}

function candidateDispatchSelections(completed) {
  return completed.cycle_receipt.open_pull_requests.map((observation) =>
    candidateDispatchSelectionFromObservation(observation));
}

function candidateDispatchSelectionFromObservation(observation) {
  return normalizeCandidateDispatchSelection({
    id: observation.id,
    node_id: observation.node_id,
    number: observation.number,
    created_at: observation.created_at,
    head_ref_oid: observation.head.sha,
    base_ref_oid: observation.base.sha,
    observation_server_time: observation.endpoint_receipt.server_time,
    observation_raw_body_sha256:
      observation.endpoint_receipt.raw_body_sha256,
  }, `candidate dispatch selection ${observation.number}`);
}

function candidateDispatchSourceRecord(entry) {
  const envelope = entry.envelope;
  return {
    record_oid: sha(entry.commit_sha, "candidate dispatch record oid"),
    parent_oid: sha(entry.parents[0], "candidate dispatch parent oid"),
    sequence: nonnegativeInteger(envelope.sequence,
      "candidate dispatch sequence"),
    phase: envelope.payload.phase,
    generation_id: envelope.payload.generation_id,
    envelope_digest: digest(envelope.envelope_digest,
      "candidate dispatch envelope digest"),
    payload_digest: digest(envelope.payload_digest,
      "candidate dispatch payload digest"),
    workflow_provenance_receipt_digest: digest(
      envelope.workflow_provenance.receipt_digest,
      "candidate dispatch provenance digest",
    ),
    workflow_provenance_replay_identity:
      provenanceReplayIdentity(envelope.workflow_provenance),
    server_observed_at: timestamp(envelope.server_observed_at,
      "candidate dispatch record time"),
  };
}

function candidateDispatchStateFromAuthority(authority) {
  return {
    source_records: structuredClone(authority.source_records),
    cycles: structuredClone(authority.cycles),
  };
}

function buildCandidateDispatchAuthority(repository, state) {
  const sourceRecords = structuredClone(state.source_records);
  const cycles = structuredClone(state.cycles);
  const current = cycles.at(-1) ?? null;
  const sourceRecordDigest = digestCanonical(
    "codex-review-gate-v2-candidate-dispatch-source-records",
    sourceRecords,
  );
  const binding = {
    repository: structuredClone(repository),
    source_record_digest: sourceRecordDigest,
    current_generation_id: current?.generation_id ?? null,
    current_inventory_digest: current?.inventory_digest ?? null,
    active_reservation_digest:
      current?.active_reservation?.reservation.reservation_digest ?? null,
    active_ack_record_oids:
      current?.active_reservation?.acknowledgements
        .map(({ record_oid: oid }) => oid) ?? [],
    completed_batch_record_oids:
      current?.completed_batches.map(({ complete_record_oid: oid }) => oid) ?? [],
    cycle_complete_record_oid: current?.cycle_complete_record_oid ?? null,
  };
  return deepFreeze({
    schema: V2_GIT_LEDGER_CANDIDATE_DISPATCH_AUTHORITY_SCHEMA,
    schema_version: 1,
    repository: structuredClone(repository),
    source_records: sourceRecords,
    source_record_digest: sourceRecordDigest,
    cycles,
    current_cycle: current,
    active_reservation: current?.active_reservation ?? null,
    authority_binding: binding,
    authority_digest: digestCanonical(
      "codex-review-gate-v2-candidate-dispatch-authority",
      binding,
    ),
  });
}

function createCandidateDispatchReservation({
  repository,
  candidateAuthority,
  dispatchAuthority,
  sourceTipCommitSha,
  reachableRecordCount,
  commandAuthority,
  triggerIdentity,
}) {
  const completed = candidateAuthority.completed_cycle;
  if (completed === null || candidateAuthority.incomplete_cycle !== null) {
    throw ledgerError(
      "candidate-dispatch-inventory-incomplete",
      "candidate dispatch requires one completed inventory cycle",
    );
  }
  const candidates = candidateDispatchSelections(completed);
  if (candidates.length === 0) return null;
  if (candidates.length > MAX_V2_CANDIDATE_DISPATCH_CYCLE_ITEMS) {
    throw ledgerError(
      "candidate-dispatch-cycle-size",
      "completed candidate cycle exceeds the dispatch item hard cap",
    );
  }
  const batchCount = Math.ceil(
    candidates.length / MAX_V2_CANDIDATE_DISPATCH_ITEMS,
  );
  if (batchCount > MAX_V2_CANDIDATE_DISPATCH_BATCHES) {
    throw ledgerError(
      "candidate-dispatch-batch-cap",
      "completed candidate cycle exceeds the dispatch batch hard cap",
    );
  }
  const current = dispatchAuthority.current_cycle;
  const generationId = candidateDispatchGenerationId(repository, completed);
  if (current !== null && current.generation_id !== generationId &&
      current.cycle_complete === false) {
    throw ledgerError(
      "candidate-dispatch-cycle-active",
      "another candidate dispatch generation is unfinished",
    );
  }
  if (current?.generation_id === generationId && current.cycle_complete) {
    return null;
  }
  const batchIndex = current?.generation_id === generationId
    ? current.completed_batches.length
    : 0;
  if (batchIndex >= batchCount) return null;
  const offset = batchIndex * MAX_V2_CANDIDATE_DISPATCH_ITEMS;
  const selected = candidates.slice(
    offset,
    offset + MAX_V2_CANDIDATE_DISPATCH_ITEMS,
  );
  const remainingCandidates = candidates.length - offset;
  const remainingBatches = batchCount - batchIndex;
  const commitBudget = calculateV2GitLedgerCandidateDispatchCommitBudget({
    candidate_count: remainingCandidates,
    batch_count: remainingBatches,
    reachable_record_count: reachableRecordCount,
  });
  if (commitBudget.remaining_ledger_commit_capacity_after_dispatch < 0) {
    throw ledgerError(
      "candidate-dispatch-commit-capacity",
      "ledger cannot persist the remaining scheduled candidate protocol",
    );
  }
  const selection = {
    repository: normalizeRepository(repository),
    generation_id: generationId,
    cycle_id: completed.cycle_id,
    inventory_digest: completed.cycle_receipt.receipt_digest,
    batch_index: batchIndex,
    batch_count: batchCount,
    candidate_offset: offset,
    candidates: selected,
  };
  const withoutDigest = {
    schema: V2_GIT_LEDGER_CANDIDATE_DISPATCH_RESERVATION_SCHEMA,
    schema_version: 1,
    repository: normalizeRepository(repository),
    generation_id: generationId,
    cycle_id: completed.cycle_id,
    candidate_inventory_authority_digest: candidateAuthority.authority_digest,
    completed_cycle_record_oid: completed.complete_record_oid,
    inventory_digest: completed.cycle_receipt.receipt_digest,
    source_tip_commit_sha: sourceTipCommitSha,
    batch_index: batchIndex,
    batch_count: batchCount,
    candidate_offset: offset,
    candidates: selected,
    dispatch_digest: digestCanonical(
      "codex-review-gate-v2-candidate-dispatch-selection",
      selection,
    ),
    scan_command_digest: commandAuthority.command_digest,
    scan_workflow_receipt_digest: commandAuthority.workflow_receipt_digest,
    trigger_identity: normalizeCandidateDispatchTriggerIdentity(triggerIdentity),
    dispatch_commit_budget_required:
      commitBudget.dispatch_commit_budget_required,
    candidate_execution_commit_budget_required:
      commitBudget.candidate_execution_commit_budget_required,
    total_commit_budget_required: commitBudget.total_commit_budget_required,
    remaining_ledger_commit_capacity_after_dispatch:
      commitBudget.remaining_ledger_commit_capacity_after_dispatch,
  };
  return validateV2GitLedgerCandidateDispatchReservation({
    ...withoutDigest,
    reservation_digest: digestCanonical(
      "codex-review-gate-v2-candidate-dispatch-reservation",
      withoutDigest,
    ),
  });
}

function createCandidateDispatchPlan(active) {
  const acknowledged = new Set(
    active.acknowledgements.map(({ candidate_index: index }) => index),
  );
  const remaining = active.reservation.candidates.filter((_, index) =>
    !acknowledged.has(index));
  const items = remaining.map((candidate) => ({
    generation_id: active.reservation.generation_id,
    cycle_id: active.reservation.cycle_id,
    inventory_digest: active.reservation.inventory_digest,
    batch_index: active.reservation.batch_index,
    batch_count: active.reservation.batch_count,
    dispatch_digest: active.reservation.dispatch_digest,
    candidate: structuredClone(candidate),
  }));
  const withoutDigest = {
    schema: V2_GIT_LEDGER_CANDIDATE_DISPATCH_PLAN_SCHEMA,
    schema_version: 1,
    repository: structuredClone(active.reservation.repository),
    generation_id: active.reservation.generation_id,
    cycle_id: active.reservation.cycle_id,
    inventory_digest: active.reservation.inventory_digest,
    batch_index: active.reservation.batch_index,
    batch_count: active.reservation.batch_count,
    dispatch_digest: active.reservation.dispatch_digest,
    items,
    remaining_count: items.length,
    dispatch_commit_budget_required:
      active.reservation.dispatch_commit_budget_required,
    candidate_execution_commit_budget_required:
      active.reservation.candidate_execution_commit_budget_required,
    total_commit_budget_required:
      active.reservation.total_commit_budget_required,
    remaining_ledger_commit_capacity_after_dispatch:
      active.reservation.remaining_ledger_commit_capacity_after_dispatch,
  };
  return validateV2GitLedgerCandidateDispatchPlan({
    ...withoutDigest,
    plan_digest: digestCanonical(
      "codex-review-gate-v2-candidate-dispatch-plan",
      withoutDigest,
    ),
  });
}

function candidateDispatchPlanItem(reservation, candidate) {
  return normalizeCandidateDispatchPlanItem({
    generation_id: reservation.generation_id,
    cycle_id: reservation.cycle_id,
    inventory_digest: reservation.inventory_digest,
    batch_index: reservation.batch_index,
    batch_count: reservation.batch_count,
    dispatch_digest: reservation.dispatch_digest,
    candidate: structuredClone(candidate),
  }, "candidate dispatch recovery binding");
}

function candidateDispatchRecoveryRequirement({ loaded, active }) {
  const acknowledged = new Set(active.acknowledgements.map(
    ({ candidate_index: index }) => index,
  ));
  const attempts = candidateDispatchScheduledAcquireAttempts(loaded.records)
    .filter(({ binding }) =>
      binding.dispatch_reservation_digest ===
        active.reservation.reservation_digest &&
      !acknowledged.has(binding.dispatch_candidate_index));
  if (attempts.length === 0) return null;
  if (attempts.length !== 1) {
    throw ledgerError(
      "candidate-dispatch-recovery-attempt-mismatch",
      "active dispatch contains multiple unfinished candidate attempts",
    );
  }
  const attempt = attempts[0];
  const candidate = active.reservation.candidates[
    attempt.binding.dispatch_candidate_index
  ];
  if (
    candidate === undefined ||
    canonicalJson(attempt.binding.selected_candidate) !== canonicalJson({
      id: candidate.id,
      node_id: candidate.node_id,
      number: candidate.number,
      created_at: candidate.created_at,
    })
  ) {
    throw ledgerError(
      "candidate-dispatch-recovery-binding-mismatch",
      "unfinished candidate attempt differs from its active reservation",
    );
  }
  let evidence = null;
  try {
    evidence = deriveCandidateDispatchRecoveryEvidence({
      records: loaded.records,
      attempt_binding: attempt.binding,
      source_tip_commit_sha: loaded.tip_commit_sha,
      post_ref_receipt: refReceipt(loaded.post_ref),
    });
  } catch (error) {
    if (error?.code !== "candidate-dispatch-recovery-not-ready") throw error;
  }
  const leaseExpiresAt = timestamp(
    attempt.entry.envelope.payload.expires_at,
    "candidate dispatch recovery requirement lease expiry",
  );
  const release = evidence?.lease_release_record_oid === null ||
      evidence?.lease_release_record_oid === undefined
    ? null
    : loaded.records.find((entry) =>
      entry.commit_sha === evidence.lease_release_record_oid) ?? null;
  const mode = evidence === null
    ? "pending-expiry"
    : evidence.recovery.mode;
  return deepFreeze({
    expected_dispatch_binding: candidateDispatchPlanItem(
      active.reservation,
      candidate,
    ),
    ready: evidence !== null,
    ready_at: release?.envelope.server_observed_at ?? leaseExpiresAt,
    mode,
  });
}

function candidateDispatchOwner(commandAuthority) {
  return {
    run_id: commandAuthority.invocation.run_id,
    run_attempt: commandAuthority.invocation.run_attempt,
    actor_id: commandAuthority.invocation.actor_id,
  };
}

function createCandidateDispatchPayload({
  phase,
  dispatchAuthority,
  candidateAuthority,
  commandAuthority,
  triggerIdentity,
  reservation = null,
  candidateAck = null,
  batchCompletion = null,
  cycleCompletion = null,
}) {
  const completed = candidateAuthority.completed_cycle;
  if (completed === null) {
    throw ledgerError(
      "candidate-dispatch-inventory-incomplete",
      "candidate dispatch payload requires one completed inventory cycle",
    );
  }
  return validateV2GitLedgerCandidateDispatchPayload({
    schema: V2_GIT_LEDGER_CANDIDATE_DISPATCH_RECORD_SCHEMA,
    schema_version: 1,
    phase,
    owner: candidateDispatchOwner(commandAuthority),
    prior_candidate_dispatch_authority_digest:
      dispatchAuthority.authority_digest,
    generation_id: candidateDispatchGenerationId(
      candidateAuthority.repository,
      completed,
    ),
    cycle_id: completed.cycle_id,
    candidate_inventory_authority_digest: candidateAuthority.authority_digest,
    completed_cycle_record_oid: completed.complete_record_oid,
    inventory_digest: completed.cycle_receipt.receipt_digest,
    reservation,
    candidate_ack: candidateAck,
    batch_completion: batchCompletion,
    cycle_completion: cycleCompletion,
    command_authority: commandAuthority,
    trigger_identity: triggerIdentity,
  }, { repository: candidateAuthority.repository });
}

function createCandidateDispatchBatchCompletion(active) {
  const acknowledgements = [...active.acknowledgements]
    .sort((left, right) => left.candidate_index - right.candidate_index);
  const withoutDigest = {
    generation_id: active.reservation.generation_id,
    cycle_id: active.reservation.cycle_id,
    inventory_digest: active.reservation.inventory_digest,
    reservation_digest: active.reservation.reservation_digest,
    dispatch_digest: active.reservation.dispatch_digest,
    batch_index: active.reservation.batch_index,
    batch_count: active.reservation.batch_count,
    ack_record_oids: acknowledgements.map(({ record_oid: oid }) => oid),
    result_digests: acknowledgements.map(({ result }) => result.result_digest),
  };
  return normalizeCandidateDispatchBatchCompletion({
    ...withoutDigest,
    completion_digest: digestCanonical(
      "codex-review-gate-v2-candidate-dispatch-batch-completion",
      withoutDigest,
    ),
  });
}

function createCandidateDispatchCycleCompletion(cycle) {
  const withoutDigest = {
    generation_id: cycle.generation_id,
    cycle_id: cycle.cycle_id,
    inventory_digest: cycle.inventory_digest,
    batch_count: cycle.batch_count,
    candidate_count: cycle.candidate_count,
    batch_completion_record_oids: cycle.completed_batches.map(
      ({ complete_record_oid: oid }) => oid,
    ),
    batch_completion_digests: cycle.completed_batches.map(
      ({ completion_digest: entry }) => entry,
    ),
  };
  return normalizeCandidateDispatchCycleCompletion({
    ...withoutDigest,
    completion_digest: digestCanonical(
      "codex-review-gate-v2-candidate-dispatch-cycle-completion",
      withoutDigest,
    ),
  });
}

async function appendCandidateDispatchPayload({
  api,
  loaded,
  repository,
  payload,
  triggerIdentity,
  repositoryEndpointReceipt,
}) {
  const record = createV2GitLedgerCandidateDispatchRecord({
    predecessor_commit_sha: loaded.tip_commit_sha,
    server_observed_at: loaded.post_ref.server_time,
    payload,
  });
  const evaluatedScopeReceipt =
    createV2GitLedgerCandidateDispatchEvaluatedScopeReceipt({
      repository,
      payload,
      trigger_identity: triggerIdentity,
      repository_endpoint_receipt: repositoryEndpointReceipt,
    });
  return api.appendRecord(record, {
    evaluated_scope_receipt: evaluatedScopeReceipt,
  });
}

async function completeCandidateDispatchAfterAcks({
  api,
  loaded,
  repository,
  commandAuthority,
  triggerIdentity,
  repositoryEndpointReceipt,
}) {
  let current = loaded;
  let batchCompletionAppendReceipt = null;
  let cycleCompletionAppendReceipt = null;
  let candidateAuthority = current.authority_projection.candidate_inventory;
  let dispatchAuthority = current.authority_projection.candidate_dispatch;
  let cycle = dispatchAuthority.current_cycle;
  const active = cycle?.active_reservation ?? null;
  if (active !== null) {
    if (active.acknowledgements.length !== active.reservation.candidates.length) {
      throw ledgerError(
        "candidate-dispatch-batch-incomplete",
        "candidate dispatch completion recovery found unacknowledged candidates",
      );
    }
    const finalAck = active.acknowledgements.at(-1);
    if (
      !candidateDispatchCompletionCommandMatches(
        commandAuthority,
        finalAck.command_authority,
      ) ||
      canonicalJson(normalizeCandidateDispatchTriggerIdentity(
        triggerIdentity,
      )) !== canonicalJson(finalAck.trigger_identity)
    ) {
      throw ledgerError(
        "candidate-dispatch-completion-authority-mismatch",
        "candidate dispatch completion requires the last ack schedule authority",
      );
    }
    const payload = createCandidateDispatchPayload({
      phase: "batch-complete",
      dispatchAuthority,
      candidateAuthority,
      commandAuthority,
      triggerIdentity,
      batchCompletion: createCandidateDispatchBatchCompletion(active),
    });
    batchCompletionAppendReceipt = await appendCandidateDispatchPayload({
      api,
      loaded: current,
      repository,
      payload,
      triggerIdentity,
      repositoryEndpointReceipt,
    });
    current = await api.load();
    candidateAuthority = current.authority_projection.candidate_inventory;
    dispatchAuthority = current.authority_projection.candidate_dispatch;
    cycle = dispatchAuthority.current_cycle;
  }
  if (
    cycle !== null && cycle.cycle_complete === false &&
    cycle.active_reservation === null &&
    cycle.completed_batches.length === cycle.batch_count
  ) {
    const lastBatch = cycle.completed_batches.at(-1);
    if (
      !candidateDispatchCompletionCommandMatches(
        commandAuthority,
        lastBatch.command_authority,
      ) ||
      canonicalJson(normalizeCandidateDispatchTriggerIdentity(
        triggerIdentity,
      )) !== canonicalJson(lastBatch.trigger_identity)
    ) {
      throw ledgerError(
        "candidate-dispatch-completion-authority-mismatch",
        "candidate dispatch cycle completion requires its last batch authority",
      );
    }
    const payload = createCandidateDispatchPayload({
      phase: "cycle-complete",
      dispatchAuthority,
      candidateAuthority,
      commandAuthority,
      triggerIdentity,
      cycleCompletion: createCandidateDispatchCycleCompletion(cycle),
    });
    cycleCompletionAppendReceipt = await appendCandidateDispatchPayload({
      api,
      loaded: current,
      repository,
      payload,
      triggerIdentity,
      repositoryEndpointReceipt,
    });
    current = await api.load();
  }
  return deepFreeze({
    loaded: current,
    batch_completion_append_receipt: batchCompletionAppendReceipt,
    cycle_completion_append_receipt: cycleCompletionAppendReceipt,
  });
}

export function projectV2GitLedgerRecords(records) {
  if (!Array.isArray(records) || records.length > MAX_V2_GIT_LEDGER_COMMITS) {
    throw new TypeError("Git ledger projection requires a bounded record array");
  }
  const selectors = {
    candidate_inventory_observations: [],
    candidate_dispatch_observations: [],
    effect_intents: [],
    automatic_reservations: [],
    automatic_requests: [],
    request_bindings: [],
    artifact_bindings: [],
    no_start_observations: [],
    thread_resolution_observations: [],
    status_writes: [],
    scheduler_states: [],
    control_comments: [],
    sticky_comments: [],
  };
  const scopes = new Map();
  let controlCommentBinding = null;
  for (const entry of records) {
    assertObject(entry, "projected Git ledger entry");
    const commitSha = sha(entry.commit_sha, "projected Git ledger commit_sha");
    const envelope = entry.envelope;
    validateProjectionEnvelope(envelope);
    if (!RECORD_TYPES.has(envelope.record_type)) continue;
    if (
      envelope.record_type === "effect-response" &&
      new Set(["control-comment-create", "control-comment-update"])
        .has(envelope.kind)
    ) {
      controlCommentBinding = structuredClone(envelope.control_comment_binding);
    }
    const item = {
      record_oid: commitSha,
      parent_oid: entry.parents[0] ?? null,
      tree_oid: entry.tree_sha,
      envelope_digest: envelope.envelope_digest,
      record_type: envelope.record_type,
      kind: envelope.kind,
      effect_id: envelope.effect_id,
      idempotency_key: envelope.idempotency_key,
      pull_request: envelope.pull_request,
      head_ref_oid: envelope.head_ref_oid,
      base_ref_oid: envelope.base_ref_oid,
      potential_merge_commit_oid: envelope.potential_merge_commit_oid,
      server_observed_at: envelope.server_observed_at,
      payload_digest: envelope.payload_digest,
      payload: structuredClone(envelope.payload),
      control_comment_binding: envelope.control_comment_binding,
      workflow_provenance_receipt_digest:
        envelope.workflow_provenance.receipt_digest,
      workflow_provenance_jti:
        provenanceReplayIdentity(envelope.workflow_provenance),
    };
    if (envelope.record_type === "candidate-inventory-observation") {
      selectors.candidate_inventory_observations.push(item);
      continue;
    }
    if (envelope.record_type === "candidate-dispatch-observation") {
      selectors.candidate_dispatch_observations.push(item);
      continue;
    }
    const scopeKey = canonicalJson({
      pull_request: envelope.pull_request,
      head_ref_oid: envelope.head_ref_oid,
    });
    const scope = scopes.get(scopeKey) ?? {
      pull_request: structuredClone(envelope.pull_request),
      head_ref_oid: envelope.head_ref_oid,
      automatic_reservations_on_head: 0,
      automatic_requests_on_head: 0,
      request_binding_count: 0,
      no_start_observation_count: 0,
      thread_resolution_observation_count: 0,
    };
    if (
      envelope.record_type === "effect-intent" &&
      envelope.kind === "automatic-request-reservation"
    ) {
      selectors.effect_intents.push(item);
      selectors.automatic_reservations.push(item);
      scope.automatic_reservations_on_head += 1;
    } else if (envelope.record_type === "effect-intent") {
      selectors.effect_intents.push(item);
    } else if (
      envelope.record_type === "effect-response" &&
      envelope.kind === "review-request"
    ) {
      selectors.automatic_requests.push(item);
      if (envelope.payload.generation.kind === "automatic") {
        scope.automatic_requests_on_head += 1;
      }
    } else if (
      envelope.record_type === "effect-response" &&
      envelope.kind === "request-binding"
    ) {
      selectors.request_bindings.push(item);
      scope.request_binding_count += 1;
    } else if (
      envelope.record_type === "effect-response" &&
      envelope.kind === "artifact-binding"
    ) {
      selectors.artifact_bindings.push(item);
    } else if (
      envelope.record_type === "effect-response" &&
      envelope.kind === "no-start-observation"
    ) {
      selectors.no_start_observations.push(item);
      scope.no_start_observation_count += 1;
    } else if (
      envelope.record_type === "effect-response" &&
      envelope.kind === "thread-resolution-observation"
    ) {
      selectors.thread_resolution_observations.push(item);
      scope.thread_resolution_observation_count += 1;
    } else if (
      envelope.record_type === "effect-response" &&
      envelope.kind === "status-write"
    ) {
      selectors.status_writes.push(item);
    } else if (
      envelope.record_type === "effect-response" &&
      envelope.kind === "scheduler-state"
    ) {
      selectors.scheduler_states.push(item);
    } else if (
      envelope.record_type === "effect-response" &&
      envelope.kind === "control-comment-create"
    ) {
      selectors.control_comments.push(item);
    } else if (
      envelope.record_type === "effect-response" &&
      envelope.kind === "control-comment-update"
    ) {
      selectors.control_comments.push(item);
    } else if (
      envelope.record_type === "effect-response" &&
      envelope.kind === "sticky-comment"
    ) {
      selectors.sticky_comments.push(item);
    }
    scopes.set(scopeKey, scope);
  }
  const scopeCounters = [...scopes.values()].sort((left, right) =>
    left.pull_request.number - right.pull_request.number ||
    left.head_ref_oid.localeCompare(right.head_ref_oid));
  const withoutDigest = {
    schema: V2_GIT_LEDGER_AUTHORITY_PROJECTION_SCHEMA,
    schema_version: 1,
    control_comment_binding: controlCommentBinding,
    scope_counters: scopeCounters,
    selectors,
  };
  return deepFreeze({
    ...withoutDigest,
    projection_digest: digestCanonical(
      "codex-review-gate-v2-git-ledger-projection",
      withoutDigest,
    ),
  });
}

export function deriveV2GitLedgerAuthority(
  records,
  expectedScope = null,
  observedAt = null,
) {
  const projection = projectV2GitLedgerRecords(records);
  const scope = expectedScope === null
    ? null
    : normalizeEffectScope(expectedScope);
  const matches = (item) => scope === null || (
    canonicalJson(item.pull_request) === canonicalJson(scope.pull_request) &&
    item.head_ref_oid === scope.head_ref_oid &&
    item.base_ref_oid === scope.base_ref_oid &&
    item.potential_merge_commit_oid === scope.potential_merge_commit_oid
  );
  const authorityFactsByOid = new Map();
  for (const selector of Object.values(projection.selectors)) {
    for (const item of selector) {
      if (matches(item)) {
        authorityFactsByOid.set(item.record_oid, structuredClone(item));
      }
    }
  }
  const authorityFacts = [...authorityFactsByOid.values()];
  authorityFacts.sort((left, right) =>
    left.record_oid.localeCompare(right.record_oid));
  const scopeCounters = projection.scope_counters.filter((item) =>
    scope === null || (
      canonicalJson(item.pull_request) === canonicalJson(scope.pull_request) &&
      item.head_ref_oid === scope.head_ref_oid
    ));
  const orderedRecords = records.map((entry) => {
    assertObject(entry, "authority Git ledger entry");
    validateProjectionEnvelope(entry.envelope);
    const record = {
      commit_sha: sha(entry.commit_sha, "authority commit_sha"),
      parents: structuredClone(entry.parents),
      tree_sha: sha(entry.tree_sha, "authority tree_sha"),
      blob_sha: sha(entry.blob_sha, "authority blob_sha"),
      envelope: redactEnvelope(entry.envelope),
      evidence: structuredClone(entry.evidence),
    };
    return record;
  });
  const sourceInventoryDigest = digestCanonical(
    "codex-review-gate-v2-git-ledger-source-inventory",
    orderedRecords,
  );
  const runnerState = scope === null
    ? null
    : deriveV2GitLedgerRunnerState(
      records,
      scope,
      observedAt ?? records.at(-1)?.envelope.server_observed_at,
    );
  const candidateInventory = deriveV2GitLedgerCandidateInventoryAuthority(
    records,
    records[0]?.envelope.repository,
  );
  const candidateDispatch = deriveV2GitLedgerCandidateDispatchAuthority(
    records,
    records[0]?.envelope.repository,
  );
  const withoutDigest = {
    schema: V2_GIT_LEDGER_AUTHORITY_PROJECTION_SCHEMA,
    schema_version: 1,
    scope,
    ordered_records: orderedRecords,
    source_inventory_digest: sourceInventoryDigest,
    authority_facts: authorityFacts,
    scope_counters: structuredClone(scopeCounters),
    control_comment_binding:
      projection.control_comment_binding === null
        ? null
        : structuredClone(projection.control_comment_binding),
    candidate_inventory: candidateInventory,
    candidate_dispatch: candidateDispatch,
    runner_state: runnerState,
    source_projection_digest: projection.projection_digest,
  };
  return deepFreeze({
    ...withoutDigest,
    authority_digest: digestCanonical(
      "codex-review-gate-v2-git-ledger-authority-projection",
      withoutDigest,
    ),
  });
}

export function deriveV2GitLedgerRunnerState(
  records,
  expectedScope,
  observedAt,
) {
  if (!Array.isArray(records) || records.length > MAX_V2_GIT_LEDGER_COMMITS) {
    throw new TypeError("runner state requires a bounded reachable record array");
  }
  const scope = normalizeEffectScope(expectedScope);
  if (scope === null) {
    throw new TypeError("runner state requires one exact scope");
  }
  const boundary = timestamp(observedAt, "runner state observed_at");
  const repository = records[0]?.envelope.repository;
  if (repository === undefined) {
    throw new TypeError("runner state requires one reachable ledger history");
  }
  const observations = schedulerObservationRecords(records, scope);
  const latestObservation = observations.at(-1) ?? null;
  const scheduling = latestObservation === null
    ? null
    : deriveRunnerScheduling(
      records,
      scope,
      repository,
      latestObservation.envelope.payload.action.prior_scheduling,
    );
  const headLedger = deriveRunnerHeadLedger(
    records,
    scope,
    repository,
    boundary,
  );
  const reservations = automaticReservationRecords(records, scope).map((entry) => {
    const statusIntent = records.find((candidate) =>
      candidate.envelope.record_type === "effect-intent" &&
      candidate.envelope.kind === "reservation-status-write" &&
      candidate.envelope.payload.action.reservation_record_oid ===
        entry.commit_sha);
    const statusResponse = statusIntent === undefined
      ? undefined
      : records.find((candidate) =>
        candidate.envelope.record_type === "effect-response" &&
        candidate.envelope.kind === "reservation-status-write" &&
        candidate.envelope.effect_id === statusIntent.envelope.effect_id);
    return {
      record_oid: entry.commit_sha,
      payload_digest: entry.envelope.payload_digest,
      scheduler_observation_record_oid:
        entry.envelope.payload.action.scheduler_observation_record_oid,
      scheduler_action_key: entry.envelope.payload.action.scheduler_action_key,
      post_scheduler_action_key:
        entry.envelope.payload.action.post_scheduler_action_key,
      reservation_status_intent_record_oid: statusIntent?.commit_sha ?? null,
      reservation_status_response_record_oid: statusResponse?.commit_sha ?? null,
      reservation_status_bound: statusResponse !== undefined,
      reservation: structuredClone(entry.envelope.payload.action.reservation),
    };
  });
  const attempts = records.filter((entry) =>
    entry.envelope.record_type === "effect-intent" &&
    entry.envelope.kind === "effect-attempt" &&
    sameHeadScope(entry.envelope, scope)).map((entry) => {
    const action = entry.envelope.payload.action;
    const binding = records.find((candidate) =>
      candidate.envelope.record_type === "effect-response" &&
      candidate.envelope.kind === "request-binding" &&
      candidate.envelope.payload.action.attempt_record_oid === entry.commit_sha);
    return {
      record_oid: entry.commit_sha,
      payload_digest: entry.envelope.payload_digest,
      reservation_record_oid: action.reservation_record_oid,
      scheduler_observation_record_oid:
        action.scheduler_observation_record_oid,
      scheduler_action_key: action.scheduler_action_key,
      attempt: structuredClone(action.attempt),
      bound: binding !== undefined,
      binding_record_oid: binding?.commit_sha ?? null,
    };
  });
  const statusInventory = requiredStatusIntentRecords(records, scope)
    .map((entry) => {
      const response = records.find((candidate) =>
        candidate.envelope.record_type === "effect-response" &&
        candidate.envelope.effect_id === entry.envelope.effect_id);
      const action = entry.envelope.payload.action;
      return {
        intent_record_oid: entry.commit_sha,
        response_record_oid: response?.commit_sha ?? null,
        payload_digest: entry.envelope.payload_digest,
        mode: action.mode,
        role: action.role,
        target_sha: action.target_sha,
        context: action.context,
        state: action.state,
        effect_id: entry.envelope.effect_id,
        carrier_idempotency_key: entry.envelope.idempotency_key,
        scheduler_action_key: action.scheduler_action_key,
        scheduler_observation_record_oid:
          action.scheduler_observation_record_oid,
        status_plan_digest: action.status_plan_digest,
        status_write_index: action.status_write_index,
        status_write_count: action.status_write_count,
        status_id: response?.envelope.payload.receipt.status_id ?? null,
        receipt_observed_at:
          response?.envelope.payload.receipt.created_at ?? null,
      };
    });
  const observationHistory = observations.map((entry) => {
    const action = entry.envelope.payload.action;
    return {
      record_oid: entry.commit_sha,
      payload_digest: entry.envelope.payload_digest,
      prior_authority_digest: action.prior_authority_digest,
      run_identity: {
        run_id: entry.envelope.workflow_provenance.claims.run_id,
        run_attempt: Number(
          entry.envelope.workflow_provenance.claims.run_attempt,
        ),
      },
      scheduler_evaluation: structuredClone(action.scheduler_evaluation),
      scheduler_plan_digest: action.scheduler_plan_digest,
      status_plan_digest: action.status_plan_digest,
      snapshot_server_time: action.snapshot_server_time,
    };
  });
  const sourceAuthorityDigest = runnerPriorAuthorityDigest(records, scope);
  const withoutDigest = {
    schema: V2_GIT_LEDGER_RUNNER_STATE_SCHEMA,
    schema_version: 1,
    scope,
    epoch_digest: digestCanonical(
      "codex-review-gate-v2-runner-epoch",
      {
        repository_node_id: repository.node_id,
        pull_request_node_id: scope.pull_request.node_id,
        head_ref_oid: scope.head_ref_oid,
      },
    ),
    source_authority_digest: sourceAuthorityDigest,
    observed_at: boundary,
    scheduling,
    head_ledger: headLedger,
    reservations,
    effect_attempts: attempts,
    status_inventory: statusInventory,
    observation_history: observationHistory,
  };
  return validateV2GitLedgerRunnerState({
    ...withoutDigest,
    runner_state_digest: digestCanonical(
      "codex-review-gate-v2-git-ledger-runner-state",
      withoutDigest,
    ),
  });
}

export function validateV2GitLedgerRunnerState(value, expected = null) {
  assertObject(value, "Git ledger runner state");
  exactKeys(value, [
    "schema", "schema_version", "scope", "epoch_digest",
    "source_authority_digest", "observed_at", "scheduling", "head_ledger",
    "reservations", "effect_attempts", "status_inventory",
    "observation_history", "runner_state_digest",
  ], "Git ledger runner state");
  if (
    value.schema !== V2_GIT_LEDGER_RUNNER_STATE_SCHEMA ||
    value.schema_version !== 1
  ) {
    throw new Error("Git ledger runner state has an unsupported schema");
  }
  const scope = normalizeEffectScope(value.scope);
  digest(value.epoch_digest, "Git ledger runner state epoch_digest");
  digest(value.source_authority_digest,
    "Git ledger runner state source_authority_digest");
  const boundary = timestamp(value.observed_at,
    "Git ledger runner state observed_at");
  if (value.scheduling !== null) {
    validateRunnerScheduling(value.scheduling, boundary, {
      repository_node_id: value.head_ledger.repository_node_id,
      pull_request_node_id: scope.pull_request.node_id,
      head_ref_oid: scope.head_ref_oid,
    });
  }
  validateRunnerHeadLedger(value.head_ledger, {
    pull_request_node_id: scope.pull_request.node_id,
    head_ref_oid: scope.head_ref_oid,
    observed_not_after: boundary,
  });
  for (const name of [
    "reservations", "effect_attempts", "status_inventory",
    "observation_history",
  ]) {
    if (!Array.isArray(value[name]) ||
        value[name].length > MAX_V2_GIT_LEDGER_COMMITS) {
      throw new TypeError(`Git ledger runner state ${name} is unbounded`);
    }
  }
  for (const [index, reservation] of value.reservations.entries()) {
    assertObject(reservation, `runner state reservations[${index}]`);
    exactKeys(reservation, [
      "record_oid", "payload_digest", "scheduler_observation_record_oid",
      "scheduler_action_key", "post_scheduler_action_key",
      "reservation_status_intent_record_oid",
      "reservation_status_response_record_oid", "reservation_status_bound",
      "reservation",
    ], `runner state reservations[${index}]`);
    sha(reservation.record_oid, `runner state reservations[${index}].record_oid`);
    digest(reservation.payload_digest,
      `runner state reservations[${index}].payload_digest`);
    sha(reservation.scheduler_observation_record_oid,
      `runner state reservations[${index}].scheduler_observation_record_oid`);
    boundedString(reservation.scheduler_action_key,
      `runner state reservations[${index}].scheduler_action_key`, 1024);
    boundedString(reservation.post_scheduler_action_key,
      `runner state reservations[${index}].post_scheduler_action_key`, 1024);
    nullableSha(reservation.reservation_status_intent_record_oid,
      `runner state reservations[${index}].reservation_status_intent_record_oid`);
    nullableSha(reservation.reservation_status_response_record_oid,
      `runner state reservations[${index}].reservation_status_response_record_oid`);
    if (
      typeof reservation.reservation_status_bound !== "boolean" ||
      reservation.reservation_status_bound !==
        (reservation.reservation_status_response_record_oid !== null) ||
      reservation.reservation_status_response_record_oid !== null &&
        reservation.reservation_status_intent_record_oid === null
    ) {
      throw new Error("runner reservation status binding is not closed");
    }
    validateV2GitLedgerRunnerReservation(reservation.reservation, {
      scope,
      generation: {
        generation_id: reservation.reservation.generation_id,
      },
    });
    if (reservation.reservation.ordinal !== index + 1) {
      throw new Error("runner reservation history skips or reorders a budget slot");
    }
  }
  for (const [index, attempt] of value.effect_attempts.entries()) {
    assertObject(attempt, `runner state effect_attempts[${index}]`);
    exactKeys(attempt, [
      "record_oid", "payload_digest", "reservation_record_oid",
      "scheduler_observation_record_oid", "scheduler_action_key", "attempt",
      "bound", "binding_record_oid",
    ], `runner state effect_attempts[${index}]`);
    sha(attempt.record_oid, `runner state effect_attempts[${index}].record_oid`);
    digest(attempt.payload_digest,
      `runner state effect_attempts[${index}].payload_digest`);
    sha(attempt.reservation_record_oid,
      `runner state effect_attempts[${index}].reservation_record_oid`);
    sha(attempt.scheduler_observation_record_oid,
      `runner state effect_attempts[${index}].scheduler_observation_record_oid`);
    boundedString(attempt.scheduler_action_key,
      `runner state effect_attempts[${index}].scheduler_action_key`, 1024);
    validateV2GitLedgerRequestAttempt(attempt.attempt);
    nullableSha(attempt.binding_record_oid,
      `runner state effect_attempts[${index}].binding_record_oid`);
    if (typeof attempt.bound !== "boolean" ||
        attempt.bound !== (attempt.binding_record_oid !== null)) {
      throw new Error("runner effect attempt binding is not closed");
    }
  }
  for (const [index, status] of value.status_inventory.entries()) {
    assertObject(status, `runner state status_inventory[${index}]`);
    exactKeys(status, [
      "intent_record_oid", "response_record_oid", "payload_digest", "mode",
      "role", "target_sha", "context", "state", "effect_id",
      "carrier_idempotency_key", "scheduler_action_key",
      "scheduler_observation_record_oid", "status_plan_digest",
      "status_write_index", "status_write_count", "status_id",
      "receipt_observed_at",
    ], `runner state status_inventory[${index}]`);
    sha(status.intent_record_oid,
      `runner state status_inventory[${index}].intent_record_oid`);
    nullableSha(status.response_record_oid,
      `runner state status_inventory[${index}].response_record_oid`);
    digest(status.payload_digest,
      `runner state status_inventory[${index}].payload_digest`);
    validateRunnerStatusWrite({
      role: status.role,
      sha: status.target_sha,
      context: status.context,
      state: status.state,
      reason: "reachable-status-intent",
      idempotency_key: status.carrier_idempotency_key,
    }, `runner state status_inventory[${index}]`);
    if (!new Set(["head", "test-merge-with-head-sentinel"]).has(status.mode)) {
      throw new Error("runner status inventory mode is not closed");
    }
    boundedString(status.effect_id,
      `runner state status_inventory[${index}].effect_id`, 256);
    boundedString(status.scheduler_action_key,
      `runner state status_inventory[${index}].scheduler_action_key`, 1024);
    sha(status.scheduler_observation_record_oid,
      `runner state status_inventory[${index}].scheduler_observation_record_oid`);
    digest(status.status_plan_digest,
      `runner state status_inventory[${index}].status_plan_digest`);
    const count = integerBetween(status.status_write_count, 1, 2,
      `runner state status_inventory[${index}].status_write_count`);
    if (nonnegativeInteger(status.status_write_index,
      `runner state status_inventory[${index}].status_write_index`) >= count) {
      throw new Error("runner status inventory index exceeds its plan");
    }
    if (status.status_id === null) {
      if (status.response_record_oid !== null || status.receipt_observed_at !== null) {
        throw new Error("runner status inventory has a partial response binding");
      }
    } else {
      decimal(status.status_id,
        `runner state status_inventory[${index}].status_id`);
      if (status.response_record_oid === null) {
        throw new Error("runner status inventory response lacks its record OID");
      }
      timestamp(status.receipt_observed_at,
        `runner state status_inventory[${index}].receipt_observed_at`);
    }
  }
  for (const [index, observation] of value.observation_history.entries()) {
    assertObject(observation, `runner state observation_history[${index}]`);
    exactKeys(observation, [
      "record_oid", "payload_digest", "prior_authority_digest",
      "run_identity", "scheduler_evaluation", "scheduler_plan_digest",
      "status_plan_digest", "snapshot_server_time",
    ], `runner state observation_history[${index}]`);
    sha(observation.record_oid,
      `runner state observation_history[${index}].record_oid`);
    digest(observation.payload_digest,
      `runner state observation_history[${index}].payload_digest`);
    digest(observation.prior_authority_digest,
      `runner state observation_history[${index}].prior_authority_digest`);
    const runIdentity = validateRunnerRunIdentity(
      observation.run_identity,
      `runner state observation_history[${index}].run_identity`,
    );
    validateRunnerSchedulerSnapshot(observation.scheduler_evaluation, {
      epoch_id: value.scheduling?.epoch.id ?? observation.scheduler_evaluation.epoch_id,
      epoch_started_at: value.scheduling?.epoch.started_at ??
        observation.scheduler_evaluation.observed_at,
      observed_not_after: boundary,
      require_complete: true,
    }, `runner state observation_history[${index}].scheduler_evaluation`);
    if (
      observation.scheduler_evaluation.run_id !== runIdentity.run_id ||
      observation.scheduler_evaluation.run_attempt !== runIdentity.run_attempt
    ) {
      throw new Error("runner observation history differs from its run identity");
    }
    digest(observation.scheduler_plan_digest,
      `runner state observation_history[${index}].scheduler_plan_digest`);
    digest(observation.status_plan_digest,
      `runner state observation_history[${index}].status_plan_digest`);
    if (timestamp(observation.snapshot_server_time,
      `runner state observation_history[${index}].snapshot_server_time`) !==
        observation.scheduler_evaluation.observed_at) {
      throw new Error("runner observation history snapshot time is inconsistent");
    }
  }
  if (
    value.reservations.length !== value.head_ledger.automatic_request_count ||
    value.status_inventory.length !== value.head_ledger.exact_sha_context_count
  ) {
    throw new Error("runner state inventory counters differ from head authority");
  }
  digest(value.runner_state_digest,
    "Git ledger runner state runner_state_digest");
  const { runner_state_digest: _digest, ...withoutDigest } = value;
  if (
    value.runner_state_digest !== digestCanonical(
      "codex-review-gate-v2-git-ledger-runner-state",
      withoutDigest,
    )
  ) {
    throw new Error("Git ledger runner state digest is invalid");
  }
  if (expected !== null) {
    if (canonicalJson(scope) !== canonicalJson(expected.scope) ||
        boundary !== expected.observed_at) {
      throw new Error("Git ledger runner state binds another authority boundary");
    }
    const derived = deriveV2GitLedgerRunnerState(
      expected.records,
      expected.scope,
      expected.observed_at,
    );
    if (canonicalJson(derived) !== canonicalJson(value)) {
      throw new Error("Git ledger runner state is not derived from reachable records");
    }
  }
  return deepFreeze(structuredClone(value));
}

export function validateV2GitLedgerControlPlaneAuthority(
  value,
  expectedScope = null,
) {
  assertObject(value, "Git ledger control-plane authority");
  exactKeys(value, [
    "schema",
    "schema_version",
    "scope",
    "load",
    "scoped_authority",
    "stable",
    "binding_digest",
  ], "Git ledger control-plane authority");
  if (
    value.schema !== V2_GIT_LEDGER_CONTROL_PLANE_AUTHORITY_SCHEMA ||
    value.schema_version !== 1 || value.stable !== true
  ) {
    throw new Error("Git ledger control-plane authority is not stable and supported");
  }
  const scope = normalizeEffectScope(value.scope);
  if (scope === null) {
    throw new TypeError("Git ledger control-plane authority requires one scope");
  }
  if (
    expectedScope !== null &&
    canonicalJson(scope) !== canonicalJson(normalizeEffectScope(expectedScope))
  ) {
    throw new Error("Git ledger control-plane authority binds another scope");
  }
  assertObject(value.load, "Git ledger control-plane authority load");
  if (value.load.stable !== true) {
    throw new Error("Git ledger control-plane authority load is unstable");
  }
  digest(value.load.inventory_digest, "Git ledger load inventory_digest");
  const { inventory_digest: _inventoryDigest, ...loadWithoutDigest } = value.load;
  if (
    digestCanonical(
      "codex-review-gate-v2-git-ledger-inventory",
      loadWithoutDigest,
    ) !== value.load.inventory_digest
  ) {
    throw new Error("Git ledger control-plane authority load digest is invalid");
  }
  digest(
    value.load.fully_reachable_record_manifest_digest,
    "Git ledger fully reachable manifest digest",
  );
  digest(
    value.load.provenance_reverification_digest,
    "Git ledger provenance reverification digest",
  );
  assertObject(value.load.capability, "Git ledger load capability");
  digest(
    value.load.capability.capability_input_digest,
    "Git ledger current capability input digest",
  );
  digest(
    value.load.capability.provider_identity_policy_catalog_digest,
    "Git ledger current provider identity policy catalog digest",
  );
  if (
    value.load.capability_attestation
      .provider_identity_policy_catalog_digest !==
      value.load.capability.provider_identity_policy_catalog_digest
  ) {
    throw new Error(
      "Git ledger capability provider identity policy binding is inconsistent",
    );
  }
  const derived = deriveV2GitLedgerAuthority(
    value.load.records,
    scope,
    value.load.observed_at,
  );
  if (canonicalJson(derived) !== canonicalJson(value.scoped_authority)) {
    throw new Error("Git ledger scoped authority is not derived from its load");
  }
  digest(value.binding_digest, "Git ledger control-plane authority binding_digest");
  const { binding_digest: _bindingDigest, ...withoutDigest } = value;
  if (
    digestCanonical(
      "codex-review-gate-v2-git-ledger-control-plane-authority",
      withoutDigest,
    ) !== value.binding_digest
  ) {
    throw new Error("Git ledger control-plane authority binding digest is invalid");
  }
  return deepFreeze(structuredClone(value));
}

export function assertV2GitLedgerControlPlaneAuthorityHandle(
  value,
  expectedScope = null,
) {
  if (
    value === null || typeof value !== "object" ||
    !CONTROL_PLANE_AUTHORITY_HANDLES.has(value)
  ) {
    throw ledgerError(
      "UNTRUSTED_CONTROL_PLANE_AUTHORITY_HANDLE",
      "control-plane authority must be the direct closure-bound ledger result",
    );
  }
  validateV2GitLedgerControlPlaneAuthority(value, expectedScope);
  return value;
}

export function validateV2GitLedgerInitialRunnerStateAuthority(value) {
  assertObject(value, "initial runner state authority");
  exactKeys(value, [
    "schema", "schema_version", "scope", "source_authority",
    "lease_authority", "evaluated_scope_authority",
    "workflow_command_authority", "preflight_authority",
    "prior_authority_digest", "scheduling", "head_ledger", "stable",
    "authority_digest",
  ], "initial runner state authority");
  if (
    value.schema !== V2_GIT_LEDGER_INITIAL_RUNNER_STATE_AUTHORITY_SCHEMA ||
    value.schema_version !== 1 ||
    value.stable !== true
  ) {
    throw new Error("initial runner state authority schema is unsupported");
  }
  const scope = normalizeEffectScope(value.scope);
  if (scope === null) {
    throw new TypeError("initial runner state authority requires one PR scope");
  }
  const source = normalizeInitialSourceAuthority(value.source_authority);
  const lease = normalizeInitialLeaseAuthority(value.lease_authority);
  const evaluated = normalizeInitialEvaluatedScopeAuthority(
    value.evaluated_scope_authority,
  );
  const command = normalizeInitialWorkflowCommandAuthority(
    value.workflow_command_authority,
  );
  const preflight = normalizeInitialPreflightAuthority(
    value.preflight_authority,
  );
  digest(value.prior_authority_digest,
    "initial runner prior_authority_digest");
  const scheduling = validateRunnerScheduling(
    value.scheduling,
    source.post_ref_receipt.server_time,
    {
      repository_node_id: value.head_ledger.repository_node_id,
      pull_request_node_id: scope.pull_request.node_id,
      head_ref_oid: scope.head_ref_oid,
    },
  );
  validateRunnerHeadLedger(value.head_ledger, {
    repository_node_id: value.head_ledger.repository_node_id,
    pull_request_node_id: scope.pull_request.node_id,
    head_ref_oid: scope.head_ref_oid,
    observed_not_after: source.post_ref_receipt.server_time,
  });
  if (
    source.post_ref_receipt.target_commit_sha !== source.tip_commit_sha ||
    canonicalJson(lease.owner) !== canonicalJson({
      run_id: command.command.invocation.run_id,
      run_attempt: command.command.invocation.run_attempt,
      actor_id: command.command.invocation.actor_id,
    }) ||
    scheduling.trigger !== command.command.route.trigger ||
    scheduling.status_target_mode !==
      command.command.workflow_receipt.status_target_mode ||
    scheduling.public_wait_supported !== preflight.public_wait_supported ||
    scheduling.epoch.started_at !== lease.acquired_at ||
    evaluated.record_evaluated_scope_receipt_digest === null ||
    value.head_ledger.observed_at !== source.post_ref_receipt.server_time
  ) {
    throw new Error("initial runner state authority fields are not closed");
  }
  digest(value.authority_digest, "initial runner authority_digest");
  const { authority_digest: _digest, ...withoutDigest } = value;
  if (
    value.authority_digest !== digestCanonical(
      "codex-review-gate-v2-git-ledger-initial-runner-state-authority",
      withoutDigest,
    )
  ) {
    throw new Error("initial runner state authority digest is invalid");
  }
  return deepFreeze(structuredClone(value));
}

export function assertV2GitLedgerInitialRunnerStateAuthorityHandle(
  value,
  {
    control_plane_authority: controlPlaneAuthority = null,
    evaluated_scope_receipt: evaluatedScopeReceipt = null,
    workflow_command_handle: workflowCommandHandle = null,
    preflight_handle: preflightHandle = null,
  } = {},
) {
  const privateAuthority = INITIAL_RUNNER_STATE_AUTHORITY_HANDLES.get(value);
  if (privateAuthority === undefined) {
    throw ledgerError(
      "UNTRUSTED_INITIAL_RUNNER_STATE_AUTHORITY_HANDLE",
      "initial runner authority must come directly from its Git ledger factory",
    );
  }
  if (
    (controlPlaneAuthority !== null &&
      privateAuthority.control_plane_authority !== controlPlaneAuthority) ||
    (evaluatedScopeReceipt !== null &&
      privateAuthority.evaluated_scope_receipt !== evaluatedScopeReceipt) ||
    (workflowCommandHandle !== null &&
      privateAuthority.workflow_command_handle !== workflowCommandHandle) ||
    (preflightHandle !== null &&
      privateAuthority.preflight_handle !== preflightHandle)
  ) {
    throw ledgerError(
      "INITIAL_RUNNER_STATE_AUTHORITY_BINDING_MISMATCH",
      "initial runner authority belongs to another control-plane load, scope, command, or preflight",
    );
  }
  validateV2GitLedgerInitialRunnerStateAuthority(value);
  return value;
}

export function validateV2GitLedgerEstablishedRunnerStateAuthority(value) {
  assertObject(value, "established runner state authority");
  exactKeys(value, [
    "schema", "schema_version", "scope", "source_authority",
    "lease_authority", "evaluated_scope_authority",
    "workflow_command_authority", "preflight_authority",
    "prior_authority_digest", "scheduling", "head_ledger", "stable",
    "authority_digest",
  ], "established runner state authority");
  if (
    value.schema !== V2_GIT_LEDGER_ESTABLISHED_RUNNER_STATE_AUTHORITY_SCHEMA ||
    value.schema_version !== 1 ||
    value.stable !== true
  ) {
    throw new Error(
      "established runner state authority schema is unsupported",
    );
  }
  const scope = normalizeEffectScope(value.scope);
  if (scope === null) {
    throw new TypeError(
      "established runner state authority requires one PR scope",
    );
  }
  const source = normalizeInitialSourceAuthority(value.source_authority);
  const lease = normalizeInitialLeaseAuthority(value.lease_authority);
  const evaluated = normalizeInitialEvaluatedScopeAuthority(
    value.evaluated_scope_authority,
  );
  const command = normalizeInitialWorkflowCommandAuthority(
    value.workflow_command_authority,
    { established: true },
  );
  const preflight = normalizeInitialPreflightAuthority(
    value.preflight_authority,
  );
  digest(value.prior_authority_digest,
    "established runner prior_authority_digest");
  const scheduling = validateRunnerScheduling(
    value.scheduling,
    source.post_ref_receipt.server_time,
    {
      repository_node_id: value.head_ledger.repository_node_id,
      pull_request_node_id: scope.pull_request.node_id,
      head_ref_oid: scope.head_ref_oid,
    },
  );
  validateRunnerHeadLedger(value.head_ledger, {
    repository_node_id: value.head_ledger.repository_node_id,
    pull_request_node_id: scope.pull_request.node_id,
    head_ref_oid: scope.head_ref_oid,
    observed_not_after: source.post_ref_receipt.server_time,
  });
  if (
    source.post_ref_receipt.target_commit_sha !== source.tip_commit_sha ||
    canonicalJson(lease.owner) !== canonicalJson({
      run_id: command.command.invocation.run_id,
      run_attempt: command.command.invocation.run_attempt,
      actor_id: command.command.invocation.actor_id,
    }) ||
    scheduling.trigger !== command.command.route.trigger ||
    scheduling.run_identity.run_id !== command.command.invocation.run_id ||
    scheduling.run_identity.run_attempt !==
      command.command.invocation.run_attempt ||
    scheduling.status_target_mode !==
      command.command.workflow_receipt.status_target_mode ||
    scheduling.public_wait_supported !== preflight.public_wait_supported ||
    Date.parse(scheduling.epoch.started_at) > Date.parse(lease.acquired_at) ||
    evaluated.record_evaluated_scope_receipt_digest === null ||
    value.head_ledger.observed_at !== source.post_ref_receipt.server_time
  ) {
    throw new Error("established runner state authority fields are not closed");
  }
  digest(value.authority_digest, "established runner authority_digest");
  const { authority_digest: _digest, ...withoutDigest } = value;
  if (
    value.authority_digest !== digestCanonical(
      "codex-review-gate-v2-git-ledger-established-runner-state-authority",
      withoutDigest,
    )
  ) {
    throw new Error("established runner state authority digest is invalid");
  }
  return deepFreeze(structuredClone(value));
}

export function assertV2GitLedgerEstablishedRunnerStateAuthorityHandle(
  value,
  {
    control_plane_authority: controlPlaneAuthority = null,
    evaluated_scope_receipt: evaluatedScopeReceipt = null,
    workflow_command_handle: workflowCommandHandle = null,
    preflight_handle: preflightHandle = null,
  } = {},
) {
  const privateAuthority =
    ESTABLISHED_RUNNER_STATE_AUTHORITY_HANDLES.get(value);
  if (privateAuthority === undefined) {
    throw ledgerError(
      "UNTRUSTED_ESTABLISHED_RUNNER_STATE_AUTHORITY_HANDLE",
      "established runner authority must come directly from its Git ledger factory",
    );
  }
  if (
    (controlPlaneAuthority !== null &&
      privateAuthority.control_plane_authority !== controlPlaneAuthority) ||
    (evaluatedScopeReceipt !== null &&
      privateAuthority.evaluated_scope_receipt !== evaluatedScopeReceipt) ||
    (workflowCommandHandle !== null &&
      privateAuthority.workflow_command_handle !== workflowCommandHandle) ||
    (preflightHandle !== null &&
      privateAuthority.preflight_handle !== preflightHandle)
  ) {
    throw ledgerError(
      "ESTABLISHED_RUNNER_STATE_AUTHORITY_BINDING_MISMATCH",
      "established runner authority belongs to another control-plane load, scope, command, or preflight",
    );
  }
  validateV2GitLedgerEstablishedRunnerStateAuthority(value);
  return value;
}

export function assertV2GitLedgerStatusWriteIntentHandle(value) {
  const privateIntent = STATUS_WRITE_INTENT_HANDLES.get(value);
  if (privateIntent === undefined) {
    throw ledgerError(
      "UNTRUSTED_STATUS_WRITE_INTENT_HANDLE",
      "status intent must be the direct closure-bound ledger result",
    );
  }
  assertObject(value, "status write intent handle");
  exactKeys(value, [
    "schema", "schema_version", "intent_commit_sha",
    "append_receipt_digest", "transport_digest", "intent_digest",
  ], "status write intent handle");
  if (
    value.schema !== V2_GIT_LEDGER_STATUS_WRITE_INTENT_HANDLE_SCHEMA ||
    value.schema_version !== 1
  ) {
    throw new Error("status write intent handle schema is unsupported");
  }
  sha(value.intent_commit_sha, "status write intent handle intent_commit_sha");
  digest(value.append_receipt_digest,
    "status write intent handle append_receipt_digest");
  digest(value.transport_digest,
    "status write intent handle transport_digest");
  digest(value.intent_digest, "status write intent handle intent_digest");
  const { intent_digest: _digest, ...withoutDigest } = value;
  if (
    value.intent_digest !== digestCanonical(
      "codex-review-gate-v2-git-ledger-status-write-intent-handle",
      withoutDigest,
    ) ||
    value.transport_digest !== digestCanonical(
      "codex-review-gate-v2-git-ledger-status-write-transport",
      privateIntent.transport,
    )
  ) {
    throw new Error("status write intent handle digest is invalid");
  }
  return value;
}

export function projectV2GitLedgerStatusWriteTransport(value) {
  assertV2GitLedgerStatusWriteIntentHandle(value);
  return deepFreeze(structuredClone(
    STATUS_WRITE_INTENT_HANDLES.get(value).transport,
  ));
}

export function validateV2GitLedgerStatusWriteResponseReceipt(
  value,
  { action: expectedAction = null, not_before: notBefore = null } = {},
) {
  assertObject(value, "status write response receipt");
  exactKeys(value, [
    "http_status", "status_id", "target_sha", "role", "context", "state",
    "description_digest", "created_at", "updated_at", "creator",
    "post_server_time", "post_raw_body_sha256", "refetch_server_time",
    "refetch_page_count", "refetch_item_count", "refetch_match_count",
    "refetch_inventory_digest", "refetch_pages",
  ], "status write response receipt");
  if (value.http_status !== 201) {
    throw new Error("status write POST did not return HTTP 201");
  }
  decimal(value.status_id, "status write response status_id");
  sha(value.target_sha, "status write response target_sha");
  if (!new Set(["head-sentinel", "primary-terminal"]).has(value.role) ||
      value.context !== "codex/github-review-gate" ||
      !new Set(["pending", "success", "failure", "error"])
        .has(value.state) ||
      (value.role === "head-sentinel" && value.state === "success")) {
    throw new Error("status write response is outside the closed status profile");
  }
  digest(value.description_digest,
    "status write response description_digest");
  const created = timestamp(value.created_at,
    "status write response created_at");
  const updated = timestamp(value.updated_at,
    "status write response updated_at");
  if (updated !== created) {
    throw new Error("status exact refetch authorizes an edited status");
  }
  assertObject(value.creator, "status write response creator");
  exactKeys(value.creator, ["login", "type"],
    "status write response creator");
  if (
    value.creator.login !== "github-actions[bot]" ||
    value.creator.type !== "Bot"
  ) {
    throw new Error("status write was not created by GitHub Actions");
  }
  const postTime = timestamp(value.post_server_time,
    "status write response post_server_time");
  const refetchTime = timestamp(value.refetch_server_time,
    "status write response refetch_server_time");
  digest(value.post_raw_body_sha256,
    "status write response post_raw_body_sha256");
  const pageCount = positiveInteger(value.refetch_page_count,
    "status write response refetch_page_count");
  const itemCount = nonnegativeInteger(value.refetch_item_count,
    "status write response refetch_item_count");
  if (value.refetch_match_count !== 1) {
    throw new Error("status exact refetch must select one unique status");
  }
  digest(value.refetch_inventory_digest,
    "status write response refetch_inventory_digest");
  if (!Array.isArray(value.refetch_pages) ||
      value.refetch_pages.length !== pageCount || pageCount > 10) {
    throw new Error("status exact refetch page inventory is not bounded and complete");
  }
  let totalItems = 0;
  let priorTime = postTime;
  for (const [index, page] of value.refetch_pages.entries()) {
    assertObject(page, `status write response refetch_pages[${index}]`);
    exactKeys(page, [
      "page", "http_status", "server_time", "raw_body_sha256",
      "item_count",
    ], `status write response refetch_pages[${index}]`);
    if (page.page !== index + 1 || page.http_status !== 200) {
      throw new Error("status exact refetch page identity is invalid");
    }
    const pageTime = timestamp(page.server_time,
      `status write response refetch_pages[${index}].server_time`);
    if (Date.parse(pageTime) < Date.parse(priorTime)) {
      throw new Error("status exact refetch server time regressed");
    }
    priorTime = pageTime;
    digest(page.raw_body_sha256,
      `status write response refetch_pages[${index}].raw_body_sha256`);
    const count = nonnegativeInteger(page.item_count,
      `status write response refetch_pages[${index}].item_count`);
    if (count > 100 || (index < pageCount - 1 && count !== 100)) {
      throw new Error("status exact refetch pagination is incomplete");
    }
    totalItems += count;
  }
  if (
    totalItems !== itemCount ||
    value.refetch_pages.at(-1).item_count >= 100 ||
    priorTime !== refetchTime ||
    Date.parse(postTime) > Date.parse(refetchTime) ||
    Date.parse(created) > Date.parse(postTime)
  ) {
    throw new Error("status exact refetch receipt is not ordered and complete");
  }
  const expectedInventoryDigest = digestCanonical(
    "codex-review-gate-v2-status-refetch-inventory",
    {
      target_sha: value.target_sha,
      status_id: value.status_id,
      pages: value.refetch_pages.map((page) => ({
        page: page.page,
        raw_body_sha256: page.raw_body_sha256,
        item_count: page.item_count,
      })),
    },
  );
  if (value.refetch_inventory_digest !== expectedInventoryDigest) {
    throw new Error("status exact refetch inventory digest is invalid");
  }
  if (notBefore !== null) {
    const boundary = timestamp(notBefore,
      "status write response authority boundary");
    if (
      Date.parse(created) < Date.parse(boundary) ||
      Date.parse(postTime) < Date.parse(boundary)
    ) {
      throw new Error("status write response predates its durable intent");
    }
  }
  if (expectedAction !== null && (
    value.target_sha !== expectedAction.target_sha ||
    value.role !== expectedAction.role ||
    value.context !== expectedAction.context ||
    value.state !== expectedAction.state ||
    value.description_digest !== expectedAction.description_digest
  )) {
    throw new Error("status write response differs from its exact intent");
  }
  return deepFreeze(structuredClone(value));
}

export function validateV2GitLedgerReservationStatusResponseReceipt(
  value,
  { action: expectedAction = null, not_before: notBefore = null } = {},
) {
  assertObject(value, "reservation status response receipt");
  exactKeys(value, [
    "http_status", "status_id", "target_sha", "context", "state",
    "description_digest", "created_at", "updated_at", "creator",
    "post_server_time", "post_raw_body_sha256", "refetch_server_time",
    "refetch_page_count", "refetch_item_count", "refetch_match_count",
    "refetch_inventory_digest", "refetch_pages",
  ], "reservation status response receipt");
  if (
    value.http_status !== 201 || value.state !== "pending" ||
    value.context === "codex/github-review-gate" ||
    !/^codex\/github-review-gate-reservation\/[1-3]$/u.test(value.context)
  ) {
    throw new Error("reservation status response is outside its audit-only profile");
  }
  decimal(value.status_id, "reservation status response status_id");
  sha(value.target_sha, "reservation status response target_sha");
  digest(value.description_digest,
    "reservation status response description_digest");
  const created = timestamp(value.created_at,
    "reservation status response created_at");
  if (timestamp(value.updated_at,
    "reservation status response updated_at") !== created) {
    throw new Error("reservation status exact refetch authorizes an edited status");
  }
  assertObject(value.creator, "reservation status response creator");
  exactKeys(value.creator, ["login", "type"],
    "reservation status response creator");
  if (
    value.creator.login !== "github-actions[bot]" ||
    value.creator.type !== "Bot"
  ) {
    throw new Error("reservation status was not created by GitHub Actions");
  }
  const postTime = timestamp(value.post_server_time,
    "reservation status response post_server_time");
  const refetchTime = timestamp(value.refetch_server_time,
    "reservation status response refetch_server_time");
  digest(value.post_raw_body_sha256,
    "reservation status response post_raw_body_sha256");
  const pageCount = positiveInteger(value.refetch_page_count,
    "reservation status response refetch_page_count");
  const itemCount = nonnegativeInteger(value.refetch_item_count,
    "reservation status response refetch_item_count");
  if (value.refetch_match_count !== 1) {
    throw new Error("reservation status refetch must select one unique status");
  }
  digest(value.refetch_inventory_digest,
    "reservation status response refetch_inventory_digest");
  if (!Array.isArray(value.refetch_pages) ||
      value.refetch_pages.length !== pageCount || pageCount > 10) {
    throw new Error("reservation status refetch page inventory is not bounded");
  }
  let totalItems = 0;
  let priorTime = postTime;
  for (const [index, page] of value.refetch_pages.entries()) {
    assertObject(page,
      `reservation status response refetch_pages[${index}]`);
    exactKeys(page, [
      "page", "http_status", "server_time", "raw_body_sha256",
      "item_count",
    ], `reservation status response refetch_pages[${index}]`);
    if (page.page !== index + 1 || page.http_status !== 200) {
      throw new Error("reservation status refetch page identity is invalid");
    }
    const pageTime = timestamp(page.server_time,
      `reservation status response refetch_pages[${index}].server_time`);
    if (Date.parse(pageTime) < Date.parse(priorTime)) {
      throw new Error("reservation status refetch server time regressed");
    }
    priorTime = pageTime;
    digest(page.raw_body_sha256,
      `reservation status response refetch_pages[${index}].raw_body_sha256`);
    const count = nonnegativeInteger(page.item_count,
      `reservation status response refetch_pages[${index}].item_count`);
    if (count > 100 || (index < pageCount - 1 && count !== 100)) {
      throw new Error("reservation status refetch pagination is incomplete");
    }
    totalItems += count;
  }
  if (
    totalItems !== itemCount ||
    value.refetch_pages.at(-1).item_count >= 100 ||
    priorTime !== refetchTime ||
    Date.parse(postTime) > Date.parse(refetchTime) ||
    Date.parse(created) > Date.parse(postTime)
  ) {
    throw new Error("reservation status refetch receipt is not ordered and complete");
  }
  const expectedInventoryDigest = digestCanonical(
    "codex-review-gate-v2-reservation-status-refetch-inventory",
    {
      target_sha: value.target_sha,
      status_id: value.status_id,
      context: value.context,
      pages: value.refetch_pages.map((page) => ({
        page: page.page,
        raw_body_sha256: page.raw_body_sha256,
        item_count: page.item_count,
      })),
    },
  );
  if (value.refetch_inventory_digest !== expectedInventoryDigest) {
    throw new Error("reservation status refetch inventory digest is invalid");
  }
  if (notBefore !== null) {
    const boundary = timestamp(notBefore,
      "reservation status response authority boundary");
    if (
      Date.parse(created) < Date.parse(boundary) ||
      Date.parse(postTime) < Date.parse(boundary)
    ) {
      throw new Error("reservation status response predates its durable intent");
    }
  }
  if (expectedAction !== null && (
    value.target_sha !== expectedAction.target_sha ||
    value.context !== expectedAction.context ||
    value.state !== expectedAction.state ||
    value.description_digest !== expectedAction.description_digest
  )) {
    throw new Error("reservation status response differs from its exact intent");
  }
  return deepFreeze(structuredClone(value));
}

function sealStatusWriteIntentHandle({
  intent_commit_sha: intentCommitSha,
  append_receipt_digest: appendReceiptDigest,
  transport,
}) {
  validateStatusWriteTransport(transport);
  const withoutDigest = {
    schema: V2_GIT_LEDGER_STATUS_WRITE_INTENT_HANDLE_SCHEMA,
    schema_version: 1,
    intent_commit_sha: sha(intentCommitSha,
      "status write intent commit SHA"),
    append_receipt_digest: digest(appendReceiptDigest,
      "status write intent append receipt digest"),
    transport_digest: digestCanonical(
      "codex-review-gate-v2-git-ledger-status-write-transport",
      transport,
    ),
  };
  return deepFreeze({
    ...withoutDigest,
    intent_digest: digestCanonical(
      "codex-review-gate-v2-git-ledger-status-write-intent-handle",
      withoutDigest,
    ),
  });
}

function validateStatusWriteTransport(value) {
  assertObject(value, "status write transport");
  exactKeys(value, [
    "method", "target_sha", "role", "context", "state", "description",
    "description_digest",
  ], "status write transport");
  if (value.method !== "POST") {
    throw new Error("status write transport method must be POST");
  }
  sha(value.target_sha, "status write transport target_sha");
  if (!new Set(["head-sentinel", "primary-terminal"]).has(value.role) ||
      value.context !== "codex/github-review-gate" ||
      !new Set(["pending", "success", "failure", "error"])
        .has(value.state) ||
      (value.role === "head-sentinel" && value.state === "success")) {
    throw new Error("status write transport is outside the closed status profile");
  }
  const description = boundedString(value.description,
    "status write transport description", 140);
  if (Buffer.byteLength(description, "utf8") > 140 ||
      value.description_digest !== statusDescriptionDigest(description)) {
    throw new Error("status write transport description binding is invalid");
  }
  return value;
}

function canonicalStatusDescription(value) {
  const reason = boundedString(value, "status write reason", 256);
  let description = "";
  let byteLength = 0;
  for (const character of reason) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (byteLength + characterBytes > 140) break;
    description += character;
    byteLength += characterBytes;
  }
  if (description.length === 0) {
    throw new Error("status write reason has no canonical description");
  }
  return description;
}

function statusDescriptionDigest(description) {
  return digestCanonical(
    "codex-review-gate-v2-status-description",
    { description },
  );
}

export function assertV2GitLedgerAutomaticReservationHandle(value) {
  const privateReservation = AUTOMATIC_RESERVATION_HANDLES.get(value);
  if (privateReservation === undefined) {
    throw ledgerError(
      "UNTRUSTED_AUTOMATIC_RESERVATION_HANDLE",
      "automatic reservation must be the direct closure-bound ledger result",
    );
  }
  assertObject(value, "automatic reservation handle");
  exactKeys(value, [
    "schema", "schema_version", "reservation_record_oid",
    "append_receipt_digest", "reservation_digest", "authority_digest",
  ], "automatic reservation handle");
  if (
    value.schema !== V2_GIT_LEDGER_AUTOMATIC_RESERVATION_HANDLE_SCHEMA ||
    value.schema_version !== 1
  ) {
    throw new Error("automatic reservation handle schema is unsupported");
  }
  sha(value.reservation_record_oid,
    "automatic reservation handle reservation_record_oid");
  digest(value.append_receipt_digest,
    "automatic reservation handle append_receipt_digest");
  digest(value.reservation_digest,
    "automatic reservation handle reservation_digest");
  digest(value.authority_digest,
    "automatic reservation handle authority_digest");
  const { authority_digest: _digest, ...withoutDigest } = value;
  if (
    value.authority_digest !== digestCanonical(
      "codex-review-gate-v2-git-ledger-automatic-reservation-handle",
      withoutDigest,
    ) ||
    value.reservation_digest !==
      privateReservation.reservation.reservation_digest
  ) {
    throw new Error("automatic reservation handle digest is invalid");
  }
  return value;
}

export function projectV2GitLedgerAutomaticReservation(value) {
  assertV2GitLedgerAutomaticReservationHandle(value);
  return deepFreeze(structuredClone(
    AUTOMATIC_RESERVATION_HANDLES.get(value).reservation,
  ));
}

export function assertV2GitLedgerCandidateDispatchHandle(
  value,
  expected = null,
) {
  const privateHandle = CANDIDATE_DISPATCH_HANDLES.get(value);
  if (privateHandle === undefined) {
    throw ledgerError(
      "UNTRUSTED_CANDIDATE_DISPATCH_HANDLE",
      "candidate dispatch handle must be the direct closure-bound ledger result",
    );
  }
  assertObject(value, "candidate dispatch handle");
  exactKeys(value, [
    "schema", "schema_version", "purpose", "generation_id",
    "reservation_digest", "dispatch_digest", "candidate_number",
    "source_dispatch_authority_digest", "source_tip_commit_sha",
    "handle_digest",
  ], "candidate dispatch handle");
  if (
    value.schema !== V2_GIT_LEDGER_CANDIDATE_DISPATCH_HANDLE_SCHEMA ||
    value.schema_version !== 1 ||
    !new Set(["scan", "scheduled-pull-request"]).has(value.purpose) ||
    !CANDIDATE_DISPATCH_GENERATION_ID.test(value.generation_id)
  ) {
    throw new Error("candidate dispatch handle schema is unsupported");
  }
  for (const key of [
    "reservation_digest", "dispatch_digest",
    "source_dispatch_authority_digest", "handle_digest",
  ]) digest(value[key], `candidate dispatch handle ${key}`);
  if (value.candidate_number !== null) {
    positiveInteger(value.candidate_number,
      "candidate dispatch handle candidate_number");
  }
  sha(value.source_tip_commit_sha,
    "candidate dispatch handle source_tip_commit_sha");
  const { handle_digest: _digest, ...withoutDigest } = value;
  if (value.handle_digest !== digestCanonical(
    "codex-review-gate-v2-candidate-dispatch-handle",
    withoutDigest,
  )) {
    throw new Error("candidate dispatch handle digest is invalid");
  }
  if (expected !== null) {
    if (expected.purpose !== undefined && value.purpose !== expected.purpose ||
        expected.reservation_receipt !== undefined &&
          privateHandle.reservation_receipt !== expected.reservation_receipt ||
        expected.workflow_command_handle !== undefined &&
          privateHandle.workflow_command_handle !==
            expected.workflow_command_handle ||
        expected.minimal_scope_handle !== undefined &&
          privateHandle.minimal_scope_handle !== expected.minimal_scope_handle) {
      throw ledgerError(
        "CANDIDATE_DISPATCH_HANDLE_BINDING_MISMATCH",
        "candidate dispatch handle differs from its exact same-job authority",
      );
    }
  }
  return value;
}

export function validateV2GitLedgerCandidateDispatchReservationReceipt(value) {
  assertObject(value, "candidate dispatch reservation receipt");
  exactKeys(value, [
    "schema", "schema_version", "generation_id",
    "reservation_record_oid", "reservation_digest", "dispatch_digest",
    "source_dispatch_authority_digest", "source_tip_commit_sha",
    "receipt_digest",
  ], "candidate dispatch reservation receipt");
  if (
    value.schema !==
      V2_GIT_LEDGER_CANDIDATE_DISPATCH_RESERVATION_RECEIPT_SCHEMA ||
    value.schema_version !== 1 ||
    !CANDIDATE_DISPATCH_GENERATION_ID.test(value.generation_id)
  ) {
    throw new Error(
      "candidate dispatch reservation receipt schema is unsupported",
    );
  }
  sha(value.reservation_record_oid,
    "candidate dispatch reservation receipt record oid");
  for (const key of [
    "reservation_digest", "dispatch_digest",
    "source_dispatch_authority_digest", "receipt_digest",
  ]) {
    digest(value[key], `candidate dispatch reservation receipt ${key}`);
  }
  sha(value.source_tip_commit_sha,
    "candidate dispatch reservation receipt source tip");
  const { receipt_digest: _digest, ...withoutDigest } = value;
  if (value.receipt_digest !== digestCanonical(
    "codex-review-gate-v2-candidate-dispatch-reservation-receipt",
    withoutDigest,
  )) {
    throw new Error("candidate dispatch reservation receipt digest is invalid");
  }
  return deepFreeze(structuredClone(value));
}

export function assertV2GitLedgerCandidateDispatchResultHandle(value) {
  const privateResult = CANDIDATE_DISPATCH_RESULT_HANDLES.get(value);
  if (privateResult === undefined) {
    throw ledgerError(
      "UNTRUSTED_CANDIDATE_DISPATCH_RESULT_HANDLE",
      "candidate dispatch result must be the direct closure-bound ledger authority",
    );
  }
  assertObject(value, "candidate dispatch result handle");
  exactKeys(value, [
    "schema", "schema_version", "candidate_number", "dispatch_digest",
    "scheduler_observation_record_oid", "release_record_oid",
    "controller_authority_digest", "controller_result_digest",
    "result_digest", "handle_digest",
  ], "candidate dispatch result handle");
  if (
    value.schema !== V2_GIT_LEDGER_CANDIDATE_DISPATCH_RESULT_HANDLE_SCHEMA ||
    value.schema_version !== 1
  ) {
    throw new Error("candidate dispatch result handle schema is unsupported");
  }
  positiveInteger(value.candidate_number,
    "candidate dispatch result handle candidate_number");
  for (const key of [
    "dispatch_digest", "controller_authority_digest",
    "controller_result_digest", "result_digest", "handle_digest",
  ]) {
    digest(value[key], `candidate dispatch result handle ${key}`);
  }
  sha(value.scheduler_observation_record_oid,
    "candidate dispatch result handle scheduler observation");
  sha(value.release_record_oid,
    "candidate dispatch result handle release record");
  const { handle_digest: _digest, ...withoutDigest } = value;
  if (
    value.handle_digest !== digestCanonical(
      "codex-review-gate-v2-candidate-dispatch-result-handle",
      withoutDigest,
    ) ||
    value.result_digest !== privateResult.result.result_digest
  ) {
    throw new Error("candidate dispatch result handle digest is invalid");
  }
  return value;
}

function createCandidateDispatchReservationReceipt({
  active,
  sourceDispatchAuthorityDigest,
  sourceTipCommitSha,
}) {
  const withoutDigest = {
    schema: V2_GIT_LEDGER_CANDIDATE_DISPATCH_RESERVATION_RECEIPT_SCHEMA,
    schema_version: 1,
    generation_id: active.reservation.generation_id,
    reservation_record_oid: active.reservation_record_oid,
    reservation_digest: active.reservation.reservation_digest,
    dispatch_digest: active.reservation.dispatch_digest,
    source_dispatch_authority_digest: sourceDispatchAuthorityDigest,
    source_tip_commit_sha: sourceTipCommitSha,
  };
  return validateV2GitLedgerCandidateDispatchReservationReceipt({
    ...withoutDigest,
    receipt_digest: digestCanonical(
      "codex-review-gate-v2-candidate-dispatch-reservation-receipt",
      withoutDigest,
    ),
  });
}

export function projectV2GitLedgerCandidateDispatchPlan(value) {
  assertV2GitLedgerCandidateDispatchHandle(value, { purpose: "scan" });
  const plan = CANDIDATE_DISPATCH_HANDLES.get(value).plan;
  if (plan === null) {
    throw ledgerError(
      "candidate-dispatch-plan-unavailable",
      "candidate dispatch handle does not carry one public scan plan",
    );
  }
  return validateV2GitLedgerCandidateDispatchPlan(structuredClone(plan));
}

function sealCandidateDispatchHandle({
  purpose,
  reservation,
  candidate,
  sourceDispatchAuthorityDigest,
  sourceTipCommitSha,
}) {
  const withoutDigest = {
    schema: V2_GIT_LEDGER_CANDIDATE_DISPATCH_HANDLE_SCHEMA,
    schema_version: 1,
    purpose,
    generation_id: reservation.generation_id,
    reservation_digest: reservation.reservation_digest,
    dispatch_digest: reservation.dispatch_digest,
    candidate_number: candidate?.number ?? null,
    source_dispatch_authority_digest: sourceDispatchAuthorityDigest,
    source_tip_commit_sha: sourceTipCommitSha,
  };
  return deepFreeze({
    ...withoutDigest,
    handle_digest: digestCanonical(
      "codex-review-gate-v2-candidate-dispatch-handle",
      withoutDigest,
    ),
  });
}

export function assertV2GitLedgerReservationStatusIntentHandle(value) {
  const privateIntent = RESERVATION_STATUS_INTENT_HANDLES.get(value);
  if (privateIntent === undefined) {
    throw ledgerError(
      "UNTRUSTED_RESERVATION_STATUS_INTENT_HANDLE",
      "reservation status intent must be the direct closure-bound ledger result",
    );
  }
  assertObject(value, "reservation status intent handle");
  exactKeys(value, [
    "schema", "schema_version", "intent_commit_sha",
    "append_receipt_digest", "reservation_digest", "transport_digest",
    "intent_digest",
  ], "reservation status intent handle");
  if (
    value.schema !== V2_GIT_LEDGER_RESERVATION_STATUS_INTENT_HANDLE_SCHEMA ||
    value.schema_version !== 1
  ) {
    throw new Error("reservation status intent handle schema is unsupported");
  }
  sha(value.intent_commit_sha,
    "reservation status intent handle intent_commit_sha");
  for (const key of [
    "append_receipt_digest", "reservation_digest", "transport_digest",
    "intent_digest",
  ]) {
    digest(value[key], `reservation status intent handle ${key}`);
  }
  const { intent_digest: _digest, ...withoutDigest } = value;
  if (
    value.intent_digest !== digestCanonical(
      "codex-review-gate-v2-git-ledger-reservation-status-intent-handle",
      withoutDigest,
    ) ||
    value.transport_digest !== digestCanonical(
      "codex-review-gate-v2-git-ledger-reservation-status-transport",
      privateIntent.transport,
    )
  ) {
    throw new Error("reservation status intent handle digest is invalid");
  }
  return value;
}

export function projectV2GitLedgerReservationStatusTransport(value) {
  assertV2GitLedgerReservationStatusIntentHandle(value);
  return deepFreeze(structuredClone(
    RESERVATION_STATUS_INTENT_HANDLES.get(value).transport,
  ));
}

export function assertV2GitLedgerAutomaticRequestIntentHandle(value) {
  const privateIntent = AUTOMATIC_REQUEST_INTENT_HANDLES.get(value);
  if (privateIntent === undefined) {
    throw ledgerError(
      "UNTRUSTED_AUTOMATIC_REQUEST_INTENT_HANDLE",
      "automatic request intent must be the direct closure-bound ledger result",
    );
  }
  assertObject(value, "automatic request intent handle");
  exactKeys(value, [
    "schema", "schema_version", "attempt_record_oid",
    "attempt_append_receipt_digest", "intent_record_oid",
    "intent_append_receipt_digest", "reservation_digest", "attempt_digest",
    "transport_digest", "intent_digest",
  ], "automatic request intent handle");
  if (
    value.schema !== V2_GIT_LEDGER_AUTOMATIC_REQUEST_INTENT_HANDLE_SCHEMA ||
    value.schema_version !== 1
  ) {
    throw new Error("automatic request intent handle schema is unsupported");
  }
  sha(value.attempt_record_oid,
    "automatic request intent handle attempt_record_oid");
  sha(value.intent_record_oid,
    "automatic request intent handle intent_record_oid");
  for (const key of [
    "attempt_append_receipt_digest", "intent_append_receipt_digest",
    "reservation_digest", "attempt_digest", "transport_digest",
    "intent_digest",
  ]) {
    digest(value[key], `automatic request intent handle ${key}`);
  }
  const { intent_digest: _digest, ...withoutDigest } = value;
  if (
    value.intent_digest !== digestCanonical(
      "codex-review-gate-v2-git-ledger-automatic-request-intent-handle",
      withoutDigest,
    ) ||
    value.reservation_digest !== privateIntent.reservation.reservation_digest ||
    value.attempt_digest !== privateIntent.attempt.attempt_digest ||
    value.transport_digest !== digestCanonical(
      "codex-review-gate-v2-git-ledger-automatic-review-request-transport",
      privateIntent.transport,
    )
  ) {
    throw new Error("automatic request intent handle digest is invalid");
  }
  return value;
}

export function projectV2GitLedgerAutomaticReviewRequestTransport(value) {
  assertV2GitLedgerAutomaticRequestIntentHandle(value);
  return deepFreeze(structuredClone(
    AUTOMATIC_REQUEST_INTENT_HANDLES.get(value).transport,
  ));
}

export function validateV2GitLedgerAutomaticReviewRequestBindingReceipt(
  value,
  expected,
) {
  assertObject(expected, "automatic review request receipt expectation");
  exactKeys(expected, [
    "repository", "scope", "action", "controller_actor_id",
    "controller_app", "not_before", "record_boundary", "rest_base_url",
  ], "automatic review request receipt expectation");
  const repository = expected.repository === undefined
    ? normalizeAutomaticReviewRequestRepository(
        value?.request_scope_receipt?.pre_scope?.repository,
      )
    : normalizeRepository(expected.repository);
  const scope = normalizeEffectScope(expected.scope);
  if (scope === null) {
    throw new TypeError("automatic review request receipt requires one PR scope");
  }
  const action = expected.action;
  assertObject(action, "automatic review request receipt action");
  if (
    action.method !== "POST" ||
    digest(action.request_body_sha256,
      "automatic review request receipt action body digest") !==
      rawDigest("@codex review")
  ) {
    throw new Error("automatic review request receipt differs from its POST intent");
  }
  const actorId = decimal(
    expected.controller_actor_id,
    "automatic review request controller actor ID",
  );
  const expectedApp = expected.controller_app === null
    ? null
    : structuredClone(expected.controller_app);
  if (expectedApp !== null) {
    validateExternalApp(
      expectedApp,
      "automatic review request expected controller App",
    );
  }
  const notBefore = timestamp(
    expected.not_before,
    "automatic review request receipt not_before",
  );
  const recordBoundary = timestamp(
    expected.record_boundary,
    "automatic review request receipt record boundary",
  );
  const restBase = normalizeRestBase(expected.rest_base_url);

  assertObject(value, "automatic review request binding receipt");
  exactKeys(value, [
    "schema", "schema_version", "http_status", "carrier_selector",
    "request_id", "request_node_id", "api_url", "request_url",
    "issue_url", "body_sha256", "created_at", "updated_at", "actor",
    "app", "post_server_time", "post_raw_body_sha256", "request_digest",
    "refetch_http_status", "refetch_server_time",
    "refetch_raw_body_sha256", "refetched_request_digest",
    "request_scope_receipt", "receipt_digest",
  ], "automatic review request binding receipt");
  if (
    value.schema !==
      V2_GIT_LEDGER_AUTOMATIC_REVIEW_REQUEST_BINDING_RECEIPT_SCHEMA ||
    value.schema_version !== 1 || value.http_status !== 201 ||
    value.refetch_http_status !== 200
  ) {
    throw new Error("automatic review request was not created and refetched exactly");
  }
  const selector = normalizeCarrierSelector(
    value.carrier_selector,
    "automatic review request carrier_selector",
  );
  const requestId = decimal(value.request_id,
    "automatic review request request_id");
  if (selector.kind !== "issue_comment" || selector.id !== requestId) {
    throw new Error("automatic review request selector differs from its comment ID");
  }
  boundedString(value.request_node_id,
    "automatic review request request_node_id", 256);
  const expectedApiUrl = `${restBase}/repos/` +
    `${encodeURIComponent(repository.owner)}/` +
    `${encodeURIComponent(repository.name)}/issues/comments/${requestId}`;
  const expectedIssueUrl = `${restBase}/repos/` +
    `${encodeURIComponent(repository.owner)}/` +
    `${encodeURIComponent(repository.name)}/issues/${scope.pull_request.number}`;
  if (
    value.api_url !== expectedApiUrl || value.issue_url !== expectedIssueUrl ||
    value.request_url !== exactArtifactUrl(
      repository,
      scope.pull_request,
      selector,
    )
  ) {
    throw ledgerError(
      "automatic-review-request-url-scope",
      "automatic review request URLs do not bind the exact repository, PR, and comment",
    );
  }
  githubUrl(value.request_url, "automatic review request request_url");
  if (value.body_sha256 !== action.request_body_sha256) {
    throw new Error("automatic review request body differs from its durable intent");
  }
  digest(value.body_sha256, "automatic review request body_sha256");
  const created = timestamp(value.created_at,
    "automatic review request created_at");
  const updated = timestamp(value.updated_at,
    "automatic review request updated_at");
  if (updated !== created) {
    throw new Error("automatic review request was edited before exact binding");
  }
  validateExternalActor(value.actor, "automatic review request actor");
  validateExternalApp(value.app, "automatic review request app");
  validateControllerCommentIdentity(value.actor, value.app, "review-request");
  if (
    value.actor.id !== actorId ||
    (expectedApp !== null &&
      canonicalJson(value.app) !== canonicalJson(expectedApp))
  ) {
    throw ledgerError(
      "automatic-review-request-controller-principal-mismatch",
      "automatic review request is not owned by the authenticated controller principal",
    );
  }
  const postServerTime = timestamp(value.post_server_time,
    "automatic review request post_server_time");
  const refetchServerTime = timestamp(value.refetch_server_time,
    "automatic review request refetch_server_time");
  digest(value.post_raw_body_sha256,
    "automatic review request post_raw_body_sha256");
  digest(value.refetch_raw_body_sha256,
    "automatic review request refetch_raw_body_sha256");
  const identity = {
    carrier_selector: structuredClone(selector),
    request_id: requestId,
    request_node_id: value.request_node_id,
    api_url: value.api_url,
    request_url: value.request_url,
    issue_url: value.issue_url,
    body_sha256: value.body_sha256,
    created_at: created,
    updated_at: updated,
    actor: structuredClone(value.actor),
    app: structuredClone(value.app),
  };
  const requestDigest = digestCanonical(
    "codex-review-gate-v2-automatic-review-request-identity",
    identity,
  );
  if (
    digest(value.request_digest,
      "automatic review request request_digest") !== requestDigest ||
    digest(value.refetched_request_digest,
      "automatic review request refetched_request_digest") !== requestDigest
  ) {
    throw new Error("automatic review request POST and exact GET identities differ");
  }
  const requestScope = normalizeAutomaticReviewRequestScopeReceipt(
    value.request_scope_receipt,
    { repository, scope },
  );
  if (
    Date.parse(requestScope.pre_scope.observed_at) < Date.parse(notBefore) ||
    Date.parse(created) < Date.parse(notBefore) ||
    Date.parse(postServerTime) < Date.parse(created) ||
    Date.parse(postServerTime) <
      Date.parse(requestScope.pre_scope.observed_at) ||
    Date.parse(refetchServerTime) < Date.parse(postServerTime) ||
    Date.parse(requestScope.post_scope.observed_at) <
      Date.parse(refetchServerTime) ||
    Date.parse(requestScope.post_scope.observed_at) >
      Date.parse(recordBoundary)
  ) {
    throw ledgerError(
      "automatic-review-request-time-order",
      "automatic review request intent, scope, POST, refetch, and record times are not causal",
    );
  }
  digest(value.receipt_digest,
    "automatic review request binding receipt digest");
  const normalized = {
    ...structuredClone(value),
    carrier_selector: structuredClone(selector),
    request_scope_receipt: requestScope,
  };
  const { receipt_digest: _receiptDigest, ...withoutDigest } = normalized;
  if (
    value.receipt_digest !== digestCanonical(
      "codex-review-gate-v2-automatic-review-request-binding-receipt",
      withoutDigest,
    )
  ) {
    throw new Error("automatic review request binding receipt digest is invalid");
  }
  return deepFreeze(normalized);
}

function normalizeAutomaticReviewRequestScopeReceipt(
  value,
  { repository, scope },
) {
  assertObject(value, "automatic review request scope receipt");
  exactKeys(value, [
    "schema", "schema_version", "pre_scope", "post_scope", "stable",
    "receipt_digest",
  ], "automatic review request scope receipt");
  if (
    value.schema !==
      V2_GIT_LEDGER_AUTOMATIC_REVIEW_REQUEST_SCOPE_RECEIPT_SCHEMA ||
    value.schema_version !== 1 || value.stable !== true
  ) {
    throw new Error("automatic review request scope receipt is not stable");
  }
  const normalizeMinimal = (minimal, label) => {
    assertObject(minimal, label);
    exactKeys(minimal, [
      "schema", "schema_version", "repository", "pull_request", "scope",
      "endpoint_receipts", "observed_at", "receipt_digest",
    ], label);
    const projected = projectDiscoveryContinuityMinimalScope(
      minimal,
      repository,
      scope,
      label,
    );
    const {
      endpoint_receipts_digest: _endpointReceiptsDigest,
      ...normalized
    } = projected;
    return normalized;
  };
  const pre = normalizeMinimal(
    value.pre_scope,
    "automatic review request pre scope",
  );
  const post = normalizeMinimal(
    value.post_scope,
    "automatic review request post scope",
  );
  if (
    canonicalJson(minimalScopeStableProjection(pre)) !==
      canonicalJson(minimalScopeStableProjection(post)) ||
    Date.parse(post.observed_at) < Date.parse(pre.observed_at)
  ) {
    throw ledgerError(
      "automatic-review-request-scope-drift",
      "automatic review request changed PR scope across its public effect",
    );
  }
  const normalized = {
    schema: value.schema,
    schema_version: value.schema_version,
    pre_scope: pre,
    post_scope: post,
    stable: true,
    receipt_digest: value.receipt_digest,
  };
  digest(value.receipt_digest,
    "automatic review request scope receipt digest");
  const { receipt_digest: _receiptDigest, ...withoutDigest } = normalized;
  if (
    value.receipt_digest !== digestCanonical(
      "codex-review-gate-v2-automatic-review-request-scope-receipt",
      withoutDigest,
    )
  ) {
    throw new Error("automatic review request scope receipt digest is invalid");
  }
  return deepFreeze(normalized);
}

function sealAutomaticReservationHandle({
  reservation_record_oid: reservationRecordOid,
  append_receipt_digest: appendReceiptDigest,
  reservation_digest: reservationDigest,
}) {
  const withoutDigest = {
    schema: V2_GIT_LEDGER_AUTOMATIC_RESERVATION_HANDLE_SCHEMA,
    schema_version: 1,
    reservation_record_oid: sha(reservationRecordOid,
      "automatic reservation record OID"),
    append_receipt_digest: digest(appendReceiptDigest,
      "automatic reservation append receipt digest"),
    reservation_digest: digest(reservationDigest,
      "automatic reservation digest"),
  };
  return deepFreeze({
    ...withoutDigest,
    authority_digest: digestCanonical(
      "codex-review-gate-v2-git-ledger-automatic-reservation-handle",
      withoutDigest,
    ),
  });
}

function sealReservationStatusIntentHandle({
  intent_commit_sha: intentCommitSha,
  append_receipt_digest: appendReceiptDigest,
  reservation_digest: reservationDigest,
  transport,
}) {
  validateReservationStatusTransport(transport);
  const withoutDigest = {
    schema: V2_GIT_LEDGER_RESERVATION_STATUS_INTENT_HANDLE_SCHEMA,
    schema_version: 1,
    intent_commit_sha: sha(intentCommitSha,
      "reservation status intent commit SHA"),
    append_receipt_digest: digest(appendReceiptDigest,
      "reservation status intent append receipt digest"),
    reservation_digest: digest(reservationDigest,
      "reservation status reservation digest"),
    transport_digest: digestCanonical(
      "codex-review-gate-v2-git-ledger-reservation-status-transport",
      transport,
    ),
  };
  return deepFreeze({
    ...withoutDigest,
    intent_digest: digestCanonical(
      "codex-review-gate-v2-git-ledger-reservation-status-intent-handle",
      withoutDigest,
    ),
  });
}

function sealAutomaticRequestIntentHandle({
  attempt_record_oid: attemptRecordOid,
  attempt_append_receipt_digest: attemptAppendReceiptDigest,
  intent_record_oid: intentRecordOid,
  intent_append_receipt_digest: intentAppendReceiptDigest,
  reservation_digest: reservationDigest,
  attempt_digest: attemptDigest,
  transport,
}) {
  const withoutDigest = {
    schema: V2_GIT_LEDGER_AUTOMATIC_REQUEST_INTENT_HANDLE_SCHEMA,
    schema_version: 1,
    attempt_record_oid: sha(attemptRecordOid,
      "automatic request attempt record OID"),
    attempt_append_receipt_digest: digest(attemptAppendReceiptDigest,
      "automatic request attempt append receipt digest"),
    intent_record_oid: sha(intentRecordOid,
      "automatic review request intent record OID"),
    intent_append_receipt_digest: digest(intentAppendReceiptDigest,
      "automatic review request intent append receipt digest"),
    reservation_digest: digest(reservationDigest,
      "automatic review request reservation digest"),
    attempt_digest: digest(attemptDigest,
      "automatic review request attempt digest"),
    transport_digest: digestCanonical(
      "codex-review-gate-v2-git-ledger-automatic-review-request-transport",
      transport,
    ),
  };
  return deepFreeze({
    ...withoutDigest,
    intent_digest: digestCanonical(
      "codex-review-gate-v2-git-ledger-automatic-request-intent-handle",
      withoutDigest,
    ),
  });
}

function validateAutomaticReviewRequestTransport(value, expected = null) {
  assertObject(value, "automatic review request transport");
  exactKeys(value, [
    "method", "path", "body", "json", "expected_status", "retry_limit",
    "record_attempt_before_effect", "network_uncertainty_policy",
    "generation_id", "reservation_digest", "attempt_digest",
  ], "automatic review request transport");
  assertObject(value.json, "automatic review request transport json");
  exactKeys(value.json, ["body"], "automatic review request transport json");
  if (
    value.method !== "POST" || value.body !== "@codex review" ||
    value.json.body !== value.body || value.expected_status !== 201 ||
    value.retry_limit !== 0 || value.record_attempt_before_effect !== true ||
    value.network_uncertainty_policy !== "do-not-retry-or-reclaim" ||
    !GENERATION_ID.test(value.generation_id)
  ) {
    throw new Error("automatic review request transport is outside its retry-zero profile");
  }
  digest(value.reservation_digest,
    "automatic review request transport reservation_digest");
  digest(value.attempt_digest,
    "automatic review request transport attempt_digest");
  boundedString(value.path, "automatic review request transport path", 2048);
  if (expected !== null) {
    const repository = normalizeRepository(expected.repository);
    const reservation = validateV2GitLedgerRunnerReservation(
      expected.reservation,
    );
    const attempt = validateV2GitLedgerRequestAttempt(expected.attempt, {
      reservation,
    });
    const expectedPath =
      `/repos/${encodeURIComponent(repository.owner)}/` +
      `${encodeURIComponent(repository.name)}/issues/` +
      `${reservation.pull_request.number}/comments`;
    if (
      value.path !== expectedPath ||
      value.generation_id !== reservation.generation_id ||
      value.reservation_digest !== reservation.reservation_digest ||
      value.attempt_digest !== attempt.attempt_digest
    ) {
      throw new Error("automatic review request transport differs from its authority");
    }
  }
  return value;
}

function validateReservationStatusTransport(value) {
  assertObject(value, "reservation status transport");
  exactKeys(value, [
    "method", "target_sha", "context", "state", "description",
    "description_digest",
  ], "reservation status transport");
  if (
    value.method !== "POST" || value.state !== "pending" ||
    value.context === "codex/github-review-gate" ||
    !/^codex\/github-review-gate-reservation\/[1-3]$/u
      .test(value.context)
  ) {
    throw new Error("reservation status transport is outside its audit-only profile");
  }
  sha(value.target_sha, "reservation status transport target_sha");
  digest(value.description, "reservation status transport description");
  if (value.description_digest !== value.description) {
    throw new Error("reservation status transport description binding is invalid");
  }
  return value;
}

function automaticEffectGeneration(index, scope) {
  return {
    generation_id: `automatic:${index}`,
    kind: "automatic",
    index,
    review_epoch_digest: reviewEpochDigest(scope),
  };
}

function normalizeInitialSourceAuthority(value) {
  assertObject(value, "initial source authority");
  exactKeys(value, [
    "tip_commit_sha", "same_job_source_inventory_digest",
    "same_job_scoped_authority_digest",
    "fully_reachable_record_manifest_digest",
    "capability_attestation_commit_sha", "capability_input_digest",
    "controller_release_digest", "post_ref_receipt",
  ], "initial source authority");
  sha(value.tip_commit_sha, "initial source tip_commit_sha");
  for (const key of [
    "same_job_source_inventory_digest", "same_job_scoped_authority_digest",
    "fully_reachable_record_manifest_digest", "capability_input_digest",
    "controller_release_digest",
  ]) {
    digest(value[key], `initial source ${key}`);
  }
  sha(value.capability_attestation_commit_sha,
    "initial source capability_attestation_commit_sha");
  validateRefReceipt(value.post_ref_receipt);
  return value;
}

function normalizeInitialLeaseAuthority(value) {
  assertObject(value, "initial lease authority");
  exactKeys(value, [
    "lease_id", "owner", "acquire_commit_sha", "acquired_at", "expires_at",
    "evaluated_scope_receipt_digest",
  ], "initial lease authority");
  boundedString(value.lease_id, "initial lease_id", 256);
  const owner = normalizeLeaseOwner(value.owner);
  sha(value.acquire_commit_sha, "initial lease acquire_commit_sha");
  const acquired = timestamp(value.acquired_at, "initial lease acquired_at");
  const expires = timestamp(value.expires_at, "initial lease expires_at");
  if (Date.parse(expires) <= Date.parse(acquired)) {
    throw new Error("initial lease expiry is not after acquire");
  }
  digest(value.evaluated_scope_receipt_digest,
    "initial lease evaluated_scope_receipt_digest");
  return { ...value, owner };
}

function normalizeInitialEvaluatedScopeAuthority(value) {
  assertObject(value, "initial evaluated scope authority");
  exactKeys(value, [
    "relation", "record_evaluated_scope_receipt_digest",
    "lease_evaluated_scope_receipt_digest",
    "discovery_continuity_receipt",
    "provider_pre_scope_receipt_digest",
  ], "initial evaluated scope authority");
  if (!new Set([
    "pull-request-event", "provider-selector", "scheduled-pull-request",
    "manual-pull-request",
  ]).has(value.relation)) {
    throw new Error("initial evaluated scope relation is unsupported");
  }
  digest(value.record_evaluated_scope_receipt_digest,
    "initial record evaluated scope digest");
  digest(value.lease_evaluated_scope_receipt_digest,
    "initial lease evaluated scope digest");
  validateV2GitLedgerDiscoveryContinuityReceipt(
    value.discovery_continuity_receipt,
  );
  if (value.relation === "provider-selector") {
    digest(value.provider_pre_scope_receipt_digest,
      "initial provider pre-scope digest");
  } else if (value.provider_pre_scope_receipt_digest !== null) {
    throw new Error("initial non-provider scope cites provider authority");
  }
  return value;
}

function normalizeInitialWorkflowCommandAuthority(
  value,
  { established = false } = {},
) {
  assertObject(value, "initial workflow command authority");
  exactKeys(value, ["command", "command_digest"],
    "initial workflow command authority");
  const command = value.command;
  assertObject(command, "initial stored workflow command");
  exactKeys(command, [
    "schema", "schema_version", "command", "repository", "pull_request",
    "dispatch_binding", "selection_policy", "route", "invocation",
    "workflow_receipt", "receipt_policy",
  ], "initial stored workflow command");
  if (
    command.schema !== "codex-review-gate-workflow-command-v2" ||
    command.schema_version !== 1 || command.command !== "run"
  ) {
    throw new Error("initial stored workflow command schema is unsupported");
  }
  assertObject(command.repository, "initial command repository");
  exactKeys(command.repository, ["owner", "name"],
    "initial command repository");
  assertObject(command.pull_request, "initial command pull_request");
  exactKeys(command.pull_request, ["number"], "initial command pull_request");
  positiveInteger(command.pull_request.number,
    "initial command pull_request.number");
  const dispatchBinding = command.dispatch_binding === null
    ? null
    : normalizeCandidateDispatchPlanItem(
      command.dispatch_binding,
      "initial command dispatch binding",
    );
  assertObject(command.route, "initial command route");
  exactKeys(command.route, ["operation", "trigger", "observation_boundary"],
    "initial command route");
  const supportedBoundary = established
    ? new Set([
        "initial", "public-initial-wait-complete",
        "public-post-request-wait-complete", "public-no-start-wait-complete",
        "private-reconcile",
      ])
    : new Set(["initial"]);
  const supportedTriggers = established
    ? new Set(["initial", "provider-event", "schedule", "manual", "timer"])
    : new Set(["initial", "provider-event", "schedule", "manual"]);
  if (
    !supportedBoundary.has(command.route.observation_boundary) ||
    !new Set(["ordinary", "evaluate-only"]).has(command.route.operation) ||
    !supportedTriggers.has(command.route.trigger)
  ) {
    throw new Error("initial command route is unsupported");
  }
  if ((command.route.trigger === "schedule") !==
      (dispatchBinding !== null) ||
      dispatchBinding !== null && dispatchBinding.candidate.number !==
        command.pull_request.number) {
    throw new Error("initial command dispatch binding differs from its route");
  }
  assertObject(command.invocation, "initial command invocation");
  exactKeys(command.invocation, [
    "event_name", "event_payload_sha256", "run_id", "run_attempt",
    "actor_id",
  ], "initial command invocation");
  boundedString(command.invocation.event_name,
    "initial command event_name", 128);
  digest(command.invocation.event_payload_sha256,
    "initial command event_payload_sha256");
  decimal(command.invocation.run_id, "initial command run_id");
  positiveInteger(command.invocation.run_attempt,
    "initial command run_attempt");
  decimal(command.invocation.actor_id, "initial command actor_id");
  assertObject(command.workflow_receipt, "initial command workflow_receipt");
  if (!new Set(["head", "test-merge-with-head-sentinel"])
    .has(command.workflow_receipt.status_target_mode)) {
    throw new Error("initial command status target mode is unsupported");
  }
  digest(value.command_digest, "initial workflow command_digest");
  if (
    value.command_digest !== digestCanonical(
      "codex-review-gate-v2-workflow-command",
      command,
    )
  ) {
    throw new Error("initial workflow command digest is invalid");
  }
  return value;
}

function normalizeInitialPreflightAuthority(value) {
  assertObject(value, "initial preflight authority");
  exactKeys(value, [
    "preflight_receipt_digest", "configuration_digest",
    "repository_visibility", "public_wait_supported",
    "public_wait_topology", "public_wait_endpoint_receipts",
    "public_wait_topology_digest",
    "public_wait_endpoint_inventory_digest",
  ], "initial preflight authority");
  digest(value.preflight_receipt_digest,
    "initial preflight receipt_digest");
  digest(value.configuration_digest,
    "initial preflight configuration_digest");
  const visibility = boundedString(value.repository_visibility,
    "initial preflight repository_visibility", 32);
  if (!new Set(["public", "private", "internal"]).has(visibility)) {
    throw new Error("initial preflight repository visibility is unsupported");
  }
  assertObject(value.public_wait_topology,
    "initial preflight public_wait_topology");
  exactKeys(value.public_wait_topology, [
    "required", "configuration_compatible", "live_canary_required",
    "environments",
  ], "initial preflight public_wait_topology");
  const topology = value.public_wait_topology;
  if (
    topology.configuration_compatible !== true ||
    !Array.isArray(topology.environments) ||
    typeof topology.required !== "boolean" ||
    typeof topology.live_canary_required !== "boolean"
  ) {
    throw new Error("initial preflight public wait topology is invalid");
  }
  for (const [index, environment] of topology.environments.entries()) {
    assertObject(environment, `stored public wait environment ${index}`);
    exactKeys(environment, [
      "stage", "name", "id", "wait_timer_rule_id", "wait_timer_minutes",
    ], `stored public wait environment ${index}`);
    if (environment.wait_timer_minutes !== 15) {
      throw new Error("stored public wait timer is not fifteen minutes");
    }
    decimal(environment.id, `stored public wait environment ${index}.id`);
    decimal(environment.wait_timer_rule_id,
      `stored public wait environment ${index}.wait_timer_rule_id`);
  }
  if (!Array.isArray(value.public_wait_endpoint_receipts)) {
    throw new TypeError("initial public wait endpoint receipts are not bounded");
  }
  value.public_wait_endpoint_receipts.forEach((receipt, index) =>
    normalizeInitialEndpointReceipt(
      receipt,
      `stored public wait endpoint ${index}`,
    ));
  const supported = visibility === "public";
  if (
    value.public_wait_supported !== supported ||
    topology.required !== supported ||
    topology.live_canary_required !== supported ||
    topology.environments.length !== (supported ? 3 : 0) ||
    value.public_wait_endpoint_receipts.length !== (supported ? 4 : 0)
  ) {
    throw new Error("initial public wait topology differs from visibility");
  }
  digest(value.public_wait_topology_digest,
    "initial public wait topology_digest");
  digest(value.public_wait_endpoint_inventory_digest,
    "initial public wait endpoint_inventory_digest");
  if (
    value.public_wait_topology_digest !== digestCanonical(
      "codex-review-gate-v2-initial-public-wait-topology",
      topology,
    ) ||
    value.public_wait_endpoint_inventory_digest !== digestCanonical(
      "codex-review-gate-v2-initial-public-wait-endpoint-inventory",
      value.public_wait_endpoint_receipts,
    )
  ) {
    throw new Error("initial public wait evidence digest is invalid");
  }
  return value;
}

export function validateV2GitLedgerRecord(value) {
  assertObject(value, "Git ledger record");
  exactKeys(value, [
    "schema",
    "schema_version",
    "record_type",
    "predecessor_commit_sha",
    "pull_request",
    "head_ref_oid",
    "base_ref_oid",
    "potential_merge_commit_oid",
    "kind",
    "effect_id",
    "idempotency_key",
    "server_observed_at",
    "payload",
    "payload_digest",
    "control_comment_binding",
    "lease",
    "record_digest",
  ], "Git ledger record");
  if (value.schema !== V2_GIT_LEDGER_RECORD_SCHEMA || value.schema_version !== 1) {
    throw new Error("Git ledger record has an unsupported schema");
  }
  if (!RECORD_TYPES.has(value.record_type)) {
    throw new Error("Git ledger record_type is not a production record");
  }
  sha(value.predecessor_commit_sha, "record.predecessor_commit_sha");
  const repositoryObservation = REPOSITORY_RECORD_TYPES.has(value.record_type);
  const pullRequest = repositoryObservation
    ? requireNull(value.pull_request, "candidate inventory pull_request")
    : normalizePullRequest(value.pull_request);
  const head = repositoryObservation
    ? requireNull(value.head_ref_oid, "candidate inventory head_ref_oid")
    : sha(value.head_ref_oid, "record.head_ref_oid");
  const base = repositoryObservation
    ? requireNull(value.base_ref_oid, "candidate inventory base_ref_oid")
    : sha(value.base_ref_oid, "record.base_ref_oid");
  const potential = repositoryObservation
    ? requireNull(
      value.potential_merge_commit_oid,
      "candidate inventory potential_merge_commit_oid",
    )
    : nullableSha(
      value.potential_merge_commit_oid,
      "record.potential_merge_commit_oid",
    );
  const kind = nullableBoundedString(value.kind, "record.kind", 128);
  const effectId = nullableBoundedString(value.effect_id, "record.effect_id", 256);
  const idempotencyKey = nullableBoundedString(
    value.idempotency_key,
    "record.idempotency_key",
    256,
  );
  const observedAt = timestamp(value.server_observed_at, "record.server_observed_at");
  validateCanonicalJsonValue(value.payload, "record.payload");
  const payloadDigest = digest(value.payload_digest, "record.payload_digest");
  if (payloadDigest !== digestV2GitLedgerPayload(value.payload)) {
    throw new Error("Git ledger record payload digest is invalid");
  }
  const control = normalizeControlCommentBinding(value.control_comment_binding);
  const lease = normalizeLeaseBinding(value.lease);
  validateRecordTypeFields({
    ...value,
    pull_request: pullRequest,
    head_ref_oid: head,
    base_ref_oid: base,
    potential_merge_commit_oid: potential,
    kind,
    effect_id: effectId,
    idempotency_key: idempotencyKey,
    server_observed_at: observedAt,
    control_comment_binding: control,
    lease,
  });
  digest(value.record_digest, "record.record_digest");
  const { record_digest: _recordDigest, ...withoutDigest } = value;
  const expectedDigest = digestCanonical(
    "codex-review-gate-v2-git-ledger-record",
    withoutDigest,
  );
  if (expectedDigest !== value.record_digest) {
    throw new Error("Git ledger record digest is invalid");
  }
  return deepFreeze(structuredClone(value));
}

export function validateV2GitLedgerEnvelope(value, expected = null) {
  assertObject(value, "Git ledger envelope");
  exactKeys(value, [
    "schema",
    "schema_version",
    "repository",
    "ledger_ref",
    "record_type",
    "sequence",
    "pull_request",
    "head_ref_oid",
    "base_ref_oid",
    "potential_merge_commit_oid",
    "kind",
    "effect_id",
    "idempotency_key",
    "predecessor_commit_sha",
    "server_observed_at",
    "payload",
    "payload_digest",
    "control_comment_binding",
    "lease",
    "source_workflow",
    "workflow_provenance",
    "workflow_provenance_jwt",
    "envelope_digest",
  ], "Git ledger envelope");
  if (
    value.schema !== V2_GIT_LEDGER_ENVELOPE_SCHEMA ||
    value.schema_version !== 1 || !ALL_RECORD_TYPES.has(value.record_type)
  ) {
    throw new Error("Git ledger envelope has an unsupported schema or record type");
  }
  const repository = normalizeRepository(value.repository);
  const ledgerRef = normalizeLedgerRef(value.ledger_ref);
  const sequence = nonnegativeInteger(value.sequence, "envelope.sequence");
  const predecessor = value.predecessor_commit_sha === null
    ? null
    : sha(value.predecessor_commit_sha, "envelope.predecessor_commit_sha");
  const source = normalizeSourceWorkflow(
    value.source_workflow,
    "envelope.source_workflow",
  );
  const provenance = validateV2GitLedgerProvenanceReceipt(
    value.workflow_provenance,
  );
  const compactJwt = compactOidcJwt(value.workflow_provenance_jwt);
  if (rawDigest(compactJwt) !== provenance.token_sha256) {
    throw new Error(
      "Git ledger workflow provenance JWT digest differs from its receipt",
    );
  }
  timestamp(value.server_observed_at, "envelope.server_observed_at");
  validateCanonicalJsonValue(value.payload, "envelope.payload");
  if (digestV2GitLedgerPayload(value.payload) !== value.payload_digest) {
    throw new Error("Git ledger envelope payload digest is invalid");
  }
  normalizeEnvelopeScopeFields(value);
  validateInternalEnvelopeFields(value);
  validateEnvelopeProvenanceBinding(value, provenance);
  digest(value.envelope_digest, "envelope.envelope_digest");
  const { envelope_digest: _digest, ...withoutDigest } = value;
  if (
    digestCanonical("codex-review-gate-v2-git-ledger-envelope", withoutDigest) !==
    value.envelope_digest
  ) {
    throw new Error("Git ledger envelope digest is invalid");
  }
  if (expected !== null && (
    canonicalJson(repository) !== canonicalJson(expected.repository) ||
    ledgerRef !== expected.ledger_ref ||
    canonicalJson(source) !== canonicalJson(expected.source_workflow) ||
    !provenanceMatchesExpected(provenance, expected)
  )) {
    throw new Error("Git ledger envelope does not bind its repository, ref, and provenance");
  }
  if (sequence === 0 && predecessor !== null) {
    throw new Error("Git ledger genesis cannot have a predecessor");
  }
  if (sequence > 0 && predecessor === null) {
    throw new Error("non-genesis Git ledger envelope requires a predecessor");
  }
  return value;
}

export function validateV2GitLedgerPublicEnvelope(value) {
  assertObject(value, "public Git ledger envelope");
  exactKeys(value, [
    "schema",
    "schema_version",
    "repository",
    "ledger_ref",
    "record_type",
    "sequence",
    "pull_request",
    "head_ref_oid",
    "base_ref_oid",
    "potential_merge_commit_oid",
    "kind",
    "effect_id",
    "idempotency_key",
    "predecessor_commit_sha",
    "server_observed_at",
    "payload",
    "payload_digest",
    "control_comment_binding",
    "lease",
    "source_workflow",
    "workflow_provenance",
    "envelope_digest",
    "public_envelope_digest",
  ], "public Git ledger envelope");
  if (
    value.schema !== V2_GIT_LEDGER_PUBLIC_ENVELOPE_SCHEMA ||
    value.schema_version !== 1 || !ALL_RECORD_TYPES.has(value.record_type)
  ) {
    throw new Error("public Git ledger envelope has an unsupported schema or record type");
  }
  normalizeRepository(value.repository);
  normalizeLedgerRef(value.ledger_ref);
  nonnegativeInteger(value.sequence, "public envelope.sequence");
  if (value.predecessor_commit_sha !== null) {
    sha(value.predecessor_commit_sha, "public envelope.predecessor_commit_sha");
  }
  timestamp(value.server_observed_at, "public envelope.server_observed_at");
  validateCanonicalJsonValue(value.payload, "public envelope.payload");
  if (digestV2GitLedgerPayload(value.payload) !== value.payload_digest) {
    throw new Error("public Git ledger envelope payload digest is invalid");
  }
  normalizeSourceWorkflow(value.source_workflow, "public envelope.source_workflow");
  validateV2GitLedgerProvenanceReceipt(value.workflow_provenance);
  normalizeEnvelopeScopeFields(value);
  validateInternalEnvelopeFields(value);
  validateEnvelopeProvenanceBinding(value, value.workflow_provenance);
  digest(value.envelope_digest, "public envelope.envelope_digest");
  digest(value.public_envelope_digest, "public envelope.public_envelope_digest");
  const { public_envelope_digest: _digest, ...withoutDigest } = value;
  if (
    digestCanonical(
      "codex-review-gate-v2-git-ledger-public-envelope",
      withoutDigest,
    ) !== value.public_envelope_digest
  ) {
    throw new Error("public Git ledger envelope digest is invalid");
  }
  return value;
}

function validateProjectionEnvelope(value) {
  if (value?.schema === V2_GIT_LEDGER_PUBLIC_ENVELOPE_SCHEMA) {
    return validateV2GitLedgerPublicEnvelope(value);
  }
  return validateV2GitLedgerEnvelope(value);
}

function redactEnvelope(value) {
  if (value.schema === V2_GIT_LEDGER_PUBLIC_ENVELOPE_SCHEMA) {
    validateV2GitLedgerPublicEnvelope(value);
    return structuredClone(value);
  }
  validateV2GitLedgerEnvelope(value);
  const {
    schema: _schema,
    workflow_provenance_jwt: _compactJwt,
    ...publicFields
  } = value;
  const withoutDigest = {
    schema: V2_GIT_LEDGER_PUBLIC_ENVELOPE_SCHEMA,
    ...structuredClone(publicFields),
  };
  const redacted = {
    ...withoutDigest,
    public_envelope_digest: digestCanonical(
      "codex-review-gate-v2-git-ledger-public-envelope",
      withoutDigest,
    ),
  };
  validateV2GitLedgerPublicEnvelope(redacted);
  return redacted;
}

function redactRecordEntry(entry) {
  return {
    commit_sha: entry.commit_sha,
    parents: structuredClone(entry.parents),
    tree_sha: entry.tree_sha,
    blob_sha: entry.blob_sha,
    envelope: redactEnvelope(entry.envelope),
    evidence: structuredClone(entry.evidence),
  };
}

function validateEnvelopeProvenanceBinding(envelope, provenance) {
  let operation;
  if (envelope.record_type === "genesis") {
    operation = "bootstrap-genesis";
  } else if (envelope.record_type === "capability-canary") {
    operation = `bootstrap-race-${envelope.payload.contender}`;
  } else if (envelope.record_type === "capability-attestation") {
    operation = "bootstrap-race";
  } else {
    operation = envelope.record_type;
  }
  const expectedScope = RECORD_TYPES.has(envelope.record_type)
    ? envelopeScope(envelope)
    : null;
  const expectedIdentity = RECORD_TYPES.has(envelope.record_type)
    ? productionRecordIdentity(envelope)
    : null;
  const binding = provenance.operation_binding;
  if (
    binding.operation !== operation ||
    canonicalJson(binding.repository) !== canonicalJson(envelope.repository) ||
    binding.ledger_ref !== envelope.ledger_ref ||
    binding.predecessor_commit_sha !== envelope.predecessor_commit_sha ||
    binding.github_server_time !== envelope.server_observed_at ||
    canonicalJson(binding.source_workflow) !==
      canonicalJson(envelope.source_workflow) ||
    canonicalJson(binding.effect_scope) !== canonicalJson(expectedScope) ||
    canonicalJson(binding.record_identity) !== canonicalJson(expectedIdentity)
  ) {
    throw new Error(
      "Git ledger envelope does not bind its exact workflow provenance operation",
    );
  }
  if (!RECORD_TYPES.has(envelope.record_type)) return;
  validateTriggerIdentityAgainstClaims(
    binding.evaluated_scope_receipt,
    provenance.claims,
  );
  if (envelope.record_type === "candidate-inventory-observation") {
    validateCandidateEvaluatedScopeBinding(
      envelope,
      binding.evaluated_scope_receipt,
    );
  } else if (envelope.record_type === "candidate-dispatch-observation") {
    validateCandidateDispatchEvaluatedScopeBinding(
      envelope,
      binding.evaluated_scope_receipt,
    );
  }
  validateOidcEffectScopeRelation(provenance.claims, expectedScope);
  const owner = new Set([
    "lease-acquire",
    "candidate-inventory-observation",
    "candidate-dispatch-observation",
  ]).has(envelope.record_type)
    ? envelope.payload.owner
    : envelope.lease.owner;
  if (
    provenance.claims.run_id !== owner.run_id ||
    provenance.claims.run_attempt !== String(owner.run_attempt)
  ) {
    throw new Error(
      "Git ledger envelope lease owner differs from OIDC run identity",
    );
  }
}

function sealRecord(value) {
  const base = {
    schema: V2_GIT_LEDGER_RECORD_SCHEMA,
    schema_version: 1,
    ...structuredClone(value),
    payload_digest: digestV2GitLedgerPayload(value.payload),
  };
  const sealed = {
    ...base,
    record_digest: digestCanonical(
      "codex-review-gate-v2-git-ledger-record",
      base,
    ),
  };
  validateV2GitLedgerRecord(sealed);
  return deepFreeze(sealed);
}

function sealEnvelope(value) {
  const base = {
    schema: V2_GIT_LEDGER_ENVELOPE_SCHEMA,
    schema_version: 1,
    ...structuredClone(value),
    payload_digest: digestV2GitLedgerPayload(value.payload),
  };
  const sealed = {
    ...base,
    envelope_digest: digestCanonical(
      "codex-review-gate-v2-git-ledger-envelope",
      base,
    ),
  };
  validateV2GitLedgerEnvelope(sealed);
  return deepFreeze(sealed);
}

async function loadStableChain({
  fetchImpl,
  authorization,
  base,
  repoPath,
  ref,
  refSuffix,
  repo,
  verifyWorkflowProvenance,
  provenanceBudget,
  requestBudget,
}) {
  const preRef = await readRef({
    fetchImpl,
    authorization,
    base,
    repoPath,
    ref,
    refSuffix,
    requestBudget,
  });
  const readBoundary = preRef.server_time;
  const reverse = [];
  const visited = new Set();
  let cursor = preRef.target_commit_sha;
  for (let count = 0; count < MAX_V2_GIT_LEDGER_COMMITS; count += 1) {
    if (visited.has(cursor)) {
      throw ledgerError("commit-cycle", "Git ledger commit graph contains a cycle");
    }
    visited.add(cursor);
    const record = await fetchCommitEnvelope({
      fetchImpl,
      authorization,
      base,
      repoPath,
      commitSha: cursor,
      repo,
      ref,
      requestBudget,
    });
    reverse.push(record);
    if (record.parents.length === 0) break;
    cursor = record.parents[0];
    if (count === MAX_V2_GIT_LEDGER_COMMITS - 1) {
      throw ledgerError("commit-cap", "Git ledger exceeds the bounded commit cap");
    }
  }
  const records = reverse.reverse();
  validateReachableChain(records, readBoundary);
  const provenanceReverification = await reverifyReachableWorkflowProvenance({
    records,
    repository: repo,
    ledgerRef: ref,
    verifyWorkflowProvenance,
    provenanceBudget,
  });
  const postRef = await readRef({
    fetchImpl,
    authorization,
    base,
    repoPath,
    ref,
    refSuffix,
    requestBudget,
  });
  if (preRef.target_commit_sha !== postRef.target_commit_sha) {
    throw ledgerError(
      "unstable-ref",
      "Git ledger ref changed across the two-pass stable read",
    );
  }
  const state = projectChainState(records, readBoundary);
  return deepFreeze({
    tip_commit_sha: preRef.target_commit_sha,
    genesis_commit_sha: records[0].commit_sha,
    records,
    pre_ref: preRef,
    post_ref: postRef,
    observed_at: readBoundary,
    provenance_reverification: provenanceReverification,
    ...state,
  });
}

async function fetchCommitEnvelope({
  fetchImpl,
  authorization,
  base,
  repoPath,
  commitSha,
  repo,
  ref,
  requestBudget,
}) {
  const commitCapture = await request({
    fetchImpl,
    authorization,
    base,
    method: "GET",
    path: `${repoPath}/git/commits/${commitSha}`,
    expectedStatus: 200,
    requestBudget,
  });
  const commit = commitCapture.data;
  assertObject(commit, "Git ledger commit");
  if (sha(commit.sha, "Git ledger commit.sha") !== commitSha) {
    throw ledgerError("commit-identity", "Git ledger commit response changed its SHA");
  }
  if (!Array.isArray(commit.parents) || commit.parents.length > 1) {
    throw ledgerError("multi-parent", "Git ledger commits must have at most one parent");
  }
  const parents = commit.parents.map((parent) => {
    assertObject(parent, "Git ledger commit parent");
    return sha(parent.sha, "Git ledger commit parent.sha");
  });
  assertObject(commit.tree, "Git ledger commit tree");
  const treeSha = sha(commit.tree.sha, "Git ledger commit.tree.sha");
  const treeCapture = await request({
    fetchImpl,
    authorization,
    base,
    method: "GET",
    path: `${repoPath}/git/trees/${treeSha}`,
    expectedStatus: 200,
    requestBudget,
  });
  const tree = treeCapture.data;
  assertObject(tree, "Git ledger tree");
  if (
    sha(tree.sha, "Git ledger tree.sha") !== treeSha ||
    !Array.isArray(tree.tree) || tree.tree.length !== 1
  ) {
    throw ledgerError("tree-shape", "Git ledger tree must contain exactly one entry");
  }
  const entry = tree.tree[0];
  assertObject(entry, "Git ledger tree entry");
  if (
    entry.path !== V2_GIT_LEDGER_BLOB_PATH || entry.mode !== "100644" ||
    entry.type !== "blob"
  ) {
    throw ledgerError("tree-shape", "Git ledger tree entry is not the canonical blob");
  }
  const blobSha = sha(entry.sha, "Git ledger tree entry.sha");
  if (canonicalTreeSha(blobSha) !== treeSha) {
    throw ledgerError(
      "tree-identity",
      "Git ledger tree bytes do not match their exact Git object identity",
    );
  }
  const blobCapture = await request({
    fetchImpl,
    authorization,
    base,
    method: "GET",
    path: `${repoPath}/git/blobs/${blobSha}`,
    expectedStatus: 200,
    requestBudget,
  });
  const blob = blobCapture.data;
  assertObject(blob, "Git ledger blob");
  if (
    sha(blob.sha, "Git ledger blob.sha") !== blobSha ||
    blob.encoding !== "base64" || typeof blob.content !== "string"
  ) {
    throw ledgerError("blob-shape", "Git ledger blob is not canonical base64 content");
  }
  const bytes = Buffer.from(blob.content.replace(/\n/gu, ""), "base64");
  if (
    bytes.length === 0 || bytes.length > MAX_V2_GIT_LEDGER_BLOB_BYTES ||
    bytes.toString("base64") !== blob.content.replace(/\n/gu, "") ||
    gitObjectSha("blob", bytes) !== blobSha
  ) {
    throw ledgerError(
      "blob-identity",
      "Git ledger blob bytes do not match their exact Git object identity",
    );
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw ledgerError(
      "invalid-blob-utf8",
      "Git ledger blob bytes are not canonical UTF-8",
    );
  }
  if (!text.endsWith("\n")) {
    throw ledgerError("noncanonical-blob", "Git ledger blob lacks one canonical newline");
  }
  let envelope;
  try {
    envelope = JSON.parse(text.slice(0, -1));
  } catch (error) {
    throw ledgerError("invalid-json", "Git ledger blob is not JSON", error);
  }
  if (`${canonicalJson(envelope)}\n` !== text) {
    throw ledgerError("noncanonical-blob", "Git ledger blob bytes are not canonical JSON");
  }
  validateV2GitLedgerEnvelope(envelope);
  if (
    canonicalJson(envelope.repository) !== canonicalJson(repo) ||
    envelope.ledger_ref !== ref
  ) {
    throw ledgerError(
      "envelope-scope",
      "Git ledger envelope belongs to another repository or ref",
    );
  }
  const expectedMessage = commitMessage(envelope);
  if (commit.message !== expectedMessage) {
    throw ledgerError("commit-message", "Git ledger commit message is not canonical");
  }
  validateCommitIdentity({
    commit,
    commitSha,
    treeSha,
    parents,
    envelope,
  });
  return deepFreeze({
    commit_sha: commitSha,
    parents,
    tree_sha: treeSha,
    blob_sha: blobSha,
    envelope,
    evidence: {
      commit_raw_body_sha256: rawDigest(commitCapture.raw_body),
      tree_raw_body_sha256: rawDigest(treeCapture.raw_body),
      blob_raw_body_sha256: rawDigest(blobCapture.raw_body),
      commit_server_time: commitCapture.server_time,
      tree_server_time: treeCapture.server_time,
      blob_server_time: blobCapture.server_time,
    },
  });
}

function validateReachableChain(records, observedAt) {
  if (records.length === 0) {
    throw ledgerError("empty-chain", "Git ledger ref has no reachable commit");
  }
  const genesis = records[0];
  if (
    genesis.parents.length !== 0 || genesis.envelope.sequence !== 0 ||
    genesis.envelope.record_type !== "genesis" ||
    genesis.envelope.predecessor_commit_sha !== null
  ) {
    throw ledgerError("invalid-genesis", "Git ledger root is not one sealed genesis");
  }
  let priorTime = null;
  const provenanceIdentities = new Set();
  for (const [index, record] of records.entries()) {
    const envelope = record.envelope;
    if (envelope.sequence !== index) {
      throw ledgerError("sequence-gap", "Git ledger sequence is not contiguous from zero");
    }
    if (index > 0) {
      const parent = records[index - 1];
      if (
        record.parents.length !== 1 || record.parents[0] !== parent.commit_sha ||
        envelope.predecessor_commit_sha !== parent.commit_sha
      ) {
        throw ledgerError("predecessor-mismatch", "Git ledger predecessor is not its sole parent");
      }
    }
    const currentTime = Date.parse(envelope.server_observed_at);
    if (priorTime !== null && currentTime < priorTime) {
      throw ledgerError("time-regression", "Git ledger observation time regressed");
    }
    priorTime = currentTime;
    if (currentTime > Date.parse(observedAt)) {
      throw ledgerError("future-record", "Git ledger contains a record after the read boundary");
    }
    const replayIdentity = provenanceReplayIdentity(
      record.envelope.workflow_provenance,
    );
    if (provenanceIdentities.has(replayIdentity)) {
      throw ledgerError(
        "duplicate-provenance-identity",
        "Git ledger reuses one OIDC token identity across records",
      );
    }
    provenanceIdentities.add(replayIdentity);
  }
  validateCapabilityPairs(records);
}

function assertUnusedProvenanceJti(consumed, provenance) {
  const replayIdentity = provenanceReplayIdentity(provenance);
  if (consumed.has(replayIdentity)) {
    throw ledgerError(
      "duplicate-provenance-identity",
      "OIDC token identity is already consumed by the Git ledger",
    );
  }
  consumed.add(replayIdentity);
}

function provenanceReplayIdentity(provenance) {
  const claims = normalizeOidcClaims(provenance.claims);
  return claims.jti === null
    ? `jwt:${provenance.token_sha256}`
    : `jti:${claims.jti}`;
}

function validateCapabilityPairs(records) {
  for (let index = 1; index < records.length; index += 1) {
    const record = records[index];
    if (record.envelope.record_type !== "capability-canary") continue;
    const next = records[index + 1];
    if (next === undefined) continue;
    if (next.envelope.record_type === "capability-canary") continue;
    if (next.envelope.record_type !== "capability-attestation") {
      throw ledgerError(
        "unattested-canary",
        "reachable capability canary is not immediately sealed by an attestation",
      );
    }
    const payload = next.envelope.payload;
    if (
      payload.winner_commit_sha !== record.commit_sha ||
      payload.race_parent_commit_sha !== record.parents[0] ||
      payload.genesis_commit_sha !== records[0].commit_sha ||
      payload.bootstrap_candidate_digest !==
        record.envelope.payload.bootstrap_candidate_digest ||
      payload.race_final_ref_reread.target_commit_sha !== record.commit_sha
    ) {
      throw ledgerError("attestation-binding", "capability attestation does not bind its race");
    }
    const winners = payload.contenders.filter((item) => item.outcome === "winner");
    const losers = payload.contenders.filter((item) => item.outcome === "non-fast-forward");
    if (
      winners.length !== 1 || losers.length !== 1 ||
      winners[0].commit_sha !== record.commit_sha
    ) {
      throw ledgerError("attestation-race", "capability attestation race evidence is invalid");
    }
    const recovered = [];
    for (let prior = index - 1; prior >= 0; prior -= 1) {
      if (records[prior].envelope.record_type !== "capability-canary") break;
      recovered.unshift(records[prior].commit_sha);
    }
    if (canonicalJson(recovered) !==
        canonicalJson(payload.recovered_unattested_canary_commits)) {
      throw ledgerError(
        "attestation-recovery",
        "capability attestation does not bind every prior unattested canary",
      );
    }
  }
}

function collectTrailingCanaries(records) {
  const commits = [];
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (records[index].envelope.record_type !== "capability-canary") break;
    commits.unshift(records[index].commit_sha);
  }
  if (commits.length > 32) {
    throw ledgerError(
      "capability-recovery-cap",
      "too many consecutive unattested canaries require operator recovery",
    );
  }
  return commits;
}

function projectChainState(records, observedAt) {
  const intentByEffect = new Map();
  const effectByIdempotency = new Map();
  const responseByEffect = new Set();
  const leaseIds = new Set();
  let activeLease = null;
  let latestCapability = null;
  let currentControlComment = null;
  const candidateInventoryState = {
    source_records: [],
    seen_cycle_ids: new Set(),
    completed: null,
    incomplete: null,
  };
  const candidateDispatchState = {
    source_records: [],
    cycles: [],
  };
  for (const [recordIndex, record] of records.entries()) {
    const envelope = record.envelope;
    const dispatchBefore = buildCandidateDispatchAuthority(
      envelope.repository,
      candidateDispatchState,
    );
    if (dispatchBefore.active_reservation !== null &&
        envelope.record_type === "capability-attestation") {
      throw ledgerError(
        "candidate-dispatch-write-window",
        "active candidate dispatch rejects a capability replacement",
      );
    }
    if (envelope.record_type === "capability-attestation") {
      latestCapability = {
        attestation_commit_sha: record.commit_sha,
        capability_input_digest: envelope.payload.capability_input_digest,
        capability_stable_digest: envelope.payload.capability_stable_digest,
        capability_receipt: envelope.payload.capability_receipt,
        protection_receipt_digest: envelope.payload.protection_receipt_digest,
        controller_release: envelope.payload.controller_release,
        payload: envelope.payload,
      };
      continue;
    }
    if (envelope.record_type === "candidate-inventory-observation") {
      const payload = validateV2GitLedgerCandidateInventoryPayload(
        envelope.payload,
        { repository: envelope.repository },
      );
      const authority = buildCandidateInventoryAuthority(
        envelope.repository,
        candidateInventoryState,
      );
      const currentDispatch = candidateDispatchState.cycles.at(-1) ?? null;
      if (currentDispatch !== null &&
          currentDispatch.cycle_complete === false) {
        throw ledgerError(
          "candidate-dispatch-inventory-replacement",
          "candidate inventory cannot advance during an unfinished dispatch cycle",
        );
      }
      if (payload.prior_candidate_authority_digest !== authority.authority_digest) {
        throw ledgerError(
          "candidate-inventory-predecessor",
          "candidate inventory history does not bind prior repository authority",
        );
      }
      const row = candidateInventorySourceRecord(record);
      validateAndApplyCandidateInventoryTransition({
        payload,
        repository: envelope.repository,
        state: candidateInventoryState,
        recordOid: row.record_oid,
        recordServerTime: envelope.server_observed_at,
        apply: true,
      });
      candidateInventoryState.source_records.push(row);
      continue;
    }
    if (envelope.record_type === "candidate-dispatch-observation") {
      const payload = validateV2GitLedgerCandidateDispatchPayload(
        envelope.payload,
        { repository: envelope.repository },
      );
      const authority = buildCandidateDispatchAuthority(
        envelope.repository,
        candidateDispatchState,
      );
      if (payload.prior_candidate_dispatch_authority_digest !==
          authority.authority_digest) {
        throw ledgerError(
          "candidate-dispatch-predecessor",
          "candidate dispatch history does not bind prior dispatch authority",
        );
      }
      const expiryRecovery = activeLease !== null &&
        payload.phase === "candidate-ack" &&
        payload.candidate_ack.terminal_authority.kind ===
          "durable-prefix-recovery" &&
        payload.candidate_ack.terminal_authority.recovery.mode === "expired" &&
        payload.candidate_ack.terminal_authority.lease_release_record_oid ===
          null &&
        payload.candidate_ack.terminal_authority.lease_acquire_commit_sha ===
          activeLease.acquire_commit_sha &&
        payload.candidate_ack.terminal_authority.recovery.lease_expires_at ===
          activeLease.expires_at &&
        Date.parse(
          payload.candidate_ack.terminal_authority.recovery.post_ref_receipt
            .server_time,
        ) >= Date.parse(activeLease.expires_at);
      if (activeLease !== null && !expiryRecovery) {
        throw ledgerError(
          "candidate-dispatch-lease-release-required",
          "candidate dispatch records require no active PR lease",
        );
      }
      const row = candidateDispatchSourceRecord(record);
      validateAndApplyCandidateDispatchTransition({
        payload,
        repository: envelope.repository,
        candidateAuthority: buildCandidateInventoryAuthority(
          envelope.repository,
          candidateInventoryState,
        ),
        state: candidateDispatchState,
        recordOid: row.record_oid,
        predecessorCommitSha: envelope.predecessor_commit_sha,
        recordServerTime: envelope.server_observed_at,
        reachableRecordCount: recordIndex,
        priorRecords: records.slice(0, recordIndex),
        apply: true,
      });
      candidateDispatchState.source_records.push(row);
      if (expiryRecovery) activeLease = null;
      continue;
    }
    const evaluatedScopeReceipt =
      envelope.workflow_provenance?.operation_binding?.evaluated_scope_receipt ??
      null;
    if (evaluatedScopeReceipt?.relation === "scheduled-pull-request") {
      validateScheduledPullRequestInventoryBinding(
        buildCandidateInventoryAuthority(
          envelope.repository,
          candidateInventoryState,
        ),
        buildCandidateDispatchAuthority(
          envelope.repository,
          candidateDispatchState,
        ),
        envelopeScope(envelope),
        evaluatedScopeReceipt,
        envelope.repository,
      );
    }
    validateCandidateDispatchAttemptWindow({
      prior_records: records.slice(0, recordIndex),
      record: envelope,
      evaluated_scope_receipt: evaluatedScopeReceipt,
      dispatch_authority: buildCandidateDispatchAuthority(
        envelope.repository,
        candidateDispatchState,
      ),
      active_lease: activeLease,
    });
    validateEvaluatedScopeLeaseLineage(
      envelope,
      evaluatedScopeReceipt,
      activeLease,
    );
    if (envelope.record_type === "lease-acquire") {
      const payload = envelope.payload;
      if (leaseIds.has(payload.lease_id)) {
        throw ledgerError("duplicate-lease", "Git ledger repeats a lease identity");
      }
      leaseIds.add(payload.lease_id);
      if (
        activeLease !== null &&
        Date.parse(payload.acquired_at) < Date.parse(activeLease.expires_at)
      ) {
        throw ledgerError("overlapping-lease", "Git ledger contains overlapping leases");
      }
      activeLease = {
        lease_id: payload.lease_id,
        owner: payload.owner,
        acquire_commit_sha: record.commit_sha,
        acquired_at: payload.acquired_at,
        expires_at: payload.expires_at,
        scope: envelopeScope(envelope),
        evaluated_scope_receipt: evaluatedScopeReceipt,
      };
      continue;
    }
    if (envelope.record_type === "lease-release") {
      if (
        activeLease === null ||
        envelope.payload.lease_id !== activeLease.lease_id ||
        envelope.payload.acquire_commit_sha !== activeLease.acquire_commit_sha ||
        canonicalJson(envelope.payload.owner) !== canonicalJson(activeLease.owner) ||
        Date.parse(envelope.payload.released_at) >= Date.parse(activeLease.expires_at)
      ) {
        throw ledgerError("invalid-lease-release", "Git ledger lease release is not authoritative");
      }
      requireSameScope(envelopeScope(envelope), activeLease.scope, "lease release");
      activeLease = null;
      continue;
    }
    if (
      envelope.record_type === "effect-intent" ||
      envelope.record_type === "effect-response"
    ) {
      if (envelope.kind === "artifact-binding") {
        validateArtifactBindingLineage(
          records.slice(0, recordIndex),
          envelope,
          envelope.repository,
        );
      } else if (envelope.kind === "request-binding") {
        validateRequestBindingLineage(
          records.slice(0, recordIndex),
          envelope,
          envelope.repository,
        );
      } else if (envelope.kind === "review-request") {
        validateReviewRequestLineage(
          records.slice(0, recordIndex),
          envelope,
        );
      } else if (envelope.kind === "automatic-request-reservation") {
        validateAutomaticReservationLineage(
          records.slice(0, recordIndex),
          envelope,
        );
      } else if (envelope.kind === "scheduler-observation") {
        validateSchedulerObservationLineage(
          records.slice(0, recordIndex),
          envelope,
        );
      } else if (envelope.kind === "effect-attempt") {
        validateEffectAttemptLineage(
          records.slice(0, recordIndex),
          envelope,
        );
      } else if (envelope.kind === "reservation-status-write") {
        validateReservationStatusLineage(
          records.slice(0, recordIndex),
          envelope,
        );
      } else if (envelope.kind === "status-write") {
        validateStatusWriteLineage(
          records.slice(0, recordIndex),
          envelope,
        );
      }
      if (
        activeLease === null ||
        Date.parse(envelope.server_observed_at) >= Date.parse(activeLease.expires_at)
      ) {
        throw ledgerError("lease-required", "effect record is outside an active lease");
      }
      validateEnvelopeLease(envelope, activeLease);
      requireSameScope(envelopeScope(envelope), activeLease.scope, "effect record");
      if (envelope.kind === "control-comment-create") {
        if (
          currentControlComment !== null ||
          (envelope.record_type === "effect-intent" &&
            envelope.control_comment_binding !== null)
        ) {
          throw ledgerError(
            "control-comment-binding",
            "control comment create history has an invalid prior binding",
          );
        }
      } else if (envelope.kind === "control-comment-update") {
        if (
          currentControlComment === null ||
          (envelope.record_type === "effect-intent" &&
            canonicalJson(envelope.control_comment_binding) !==
              canonicalJson(currentControlComment))
        ) {
          throw ledgerError(
            "control-comment-binding",
            "control comment update history does not bind the current comment",
          );
        }
      } else if (
        envelope.control_comment_binding !== null &&
        canonicalJson(envelope.control_comment_binding) !==
          canonicalJson(currentControlComment)
      ) {
        throw ledgerError(
          "control-comment-binding",
          "effect history cites a non-current controller comment",
        );
      }
      if (envelope.record_type === "effect-intent") {
        if (intentByEffect.has(envelope.effect_id)) {
          throw ledgerError("duplicate-effect", "Git ledger repeats an effect identity");
        }
        if (effectByIdempotency.has(envelope.idempotency_key)) {
          throw ledgerError("duplicate-idempotency", "Git ledger repeats an idempotency key");
        }
        intentByEffect.set(envelope.effect_id, record);
        effectByIdempotency.set(envelope.idempotency_key, record);
      } else {
        const intent = intentByEffect.get(envelope.effect_id);
        if (
          intent === undefined || responseByEffect.has(envelope.effect_id) ||
          intent.envelope.idempotency_key !== envelope.idempotency_key ||
          intent.envelope.kind !== envelope.kind ||
          envelope.payload.intent_commit_sha !== intent.commit_sha ||
          envelope.payload.predecessor_commit_sha !== intent.commit_sha ||
          canonicalJson(envelope.payload.action) !==
            canonicalJson(intent.envelope.payload.action) ||
          canonicalJson(envelope.payload.generation) !==
            canonicalJson(intent.envelope.payload.generation) ||
          envelope.payload.ordinal !== intent.envelope.payload.ordinal
        ) {
          throw ledgerError("invalid-effect-response", "effect response lacks one exact intent");
        }
        responseByEffect.add(envelope.effect_id);
        if (new Set(["control-comment-create", "control-comment-update"])
          .has(envelope.kind)) {
          currentControlComment = structuredClone(envelope.control_comment_binding);
        }
      }
    }
  }
  if (
    activeLease !== null &&
    Date.parse(observedAt) >= Date.parse(activeLease.expires_at)
  ) {
    activeLease = null;
  }
  const projection = projectV2GitLedgerRecords(records);
  const authorityProjection = deriveV2GitLedgerAuthority(records);
  return {
    active_lease: activeLease,
    latest_capability: latestCapability,
    effect_intent_count: intentByEffect.size,
    effect_response_count: responseByEffect.size,
    control_comment_binding: projection.control_comment_binding,
    projection,
    authority_projection: authorityProjection,
  };
}

function candidateDispatchAttemptBinding(receiptValue) {
  if (receiptValue === null || receiptValue === undefined) return null;
  const receipt = validateV2GitLedgerEvaluatedScopeReceipt(receiptValue);
  if (receipt.relation !== "scheduled-pull-request") return null;
  const inventory = receipt.inventory_receipt;
  return {
    repository: structuredClone(receipt.repository),
    dispatch_generation_id: inventory.dispatch_generation_id,
    dispatch_cycle_id: inventory.dispatch_cycle_id,
    dispatch_reservation_record_oid:
      inventory.dispatch_reservation_record_oid,
    dispatch_reservation_digest: inventory.dispatch_reservation_digest,
    dispatch_digest: inventory.dispatch_digest,
    dispatch_batch_index: inventory.dispatch_batch_index,
    dispatch_batch_count: inventory.dispatch_batch_count,
    dispatch_candidate_index: inventory.dispatch_candidate_index,
    selected_candidate: structuredClone(inventory.selected_candidate),
    trigger_event_name: receipt.trigger_event_name,
    trigger_ref: receipt.trigger_ref,
    trigger_sha: receipt.trigger_sha,
  };
}

function candidateDispatchAttemptStage(value) {
  if (value.record_type === "lease-acquire") return 0;
  if (value.record_type === "lease-release") return 12;
  if (!new Set(["effect-intent", "effect-response"])
    .has(value.record_type)) return null;
  const responseOffset = value.record_type === "effect-response" ? 1 : 0;
  if (value.kind === "scheduler-observation") {
    return responseOffset === 0 ? 1 : null;
  }
  if (value.kind === "status-write") return 2 + responseOffset;
  if (value.kind === "automatic-request-reservation") {
    return responseOffset === 0 ? 4 : null;
  }
  if (value.kind === "reservation-status-write") return 5 + responseOffset;
  if (value.kind === "effect-attempt") {
    return responseOffset === 0 ? 7 : null;
  }
  if (value.kind === "review-request") return 8 + responseOffset;
  if (value.kind === "request-binding") return 10 + responseOffset;
  return null;
}

function candidateDispatchScheduledAcquireAttempts(records) {
  return records.flatMap((entry) => {
    if (entry.envelope.record_type !== "lease-acquire") return [];
    const receipt = entry.envelope.workflow_provenance?.operation_binding
      ?.evaluated_scope_receipt ?? null;
    const binding = candidateDispatchAttemptBinding(receipt);
    return binding === null ? [] : [{ entry, binding }];
  });
}

function validateCandidateDispatchAttemptWindow({
  prior_records: priorRecords,
  record,
  evaluated_scope_receipt: evaluatedScopeReceipt,
  dispatch_authority: dispatchAuthority,
  active_lease: activeLease,
}) {
  const active = dispatchAuthority.active_reservation;
  if (active === null) return;
  const binding = candidateDispatchAttemptBinding(evaluatedScopeReceipt);
  if (binding === null) {
    throw ledgerError(
      "candidate-dispatch-write-window",
      "an active candidate dispatch rejects unrelated production records",
    );
  }
  const reservation = active.reservation;
  const candidate = reservation.candidates[binding.dispatch_candidate_index];
  const candidateIdentity = candidate === undefined ? null : {
    id: candidate.id,
    node_id: candidate.node_id,
    number: candidate.number,
    created_at: candidate.created_at,
  };
  if (
    binding.dispatch_generation_id !== reservation.generation_id ||
    binding.dispatch_cycle_id !== reservation.cycle_id ||
    binding.dispatch_reservation_record_oid !== active.reservation_record_oid ||
    binding.dispatch_reservation_digest !== reservation.reservation_digest ||
    binding.dispatch_digest !== reservation.dispatch_digest ||
    binding.dispatch_batch_index !== reservation.batch_index ||
    binding.dispatch_batch_count !== reservation.batch_count ||
    candidate === undefined ||
    canonicalJson(binding.selected_candidate) !==
      canonicalJson(candidateIdentity) ||
    active.acknowledgements.some((ack) =>
      ack.candidate_index === binding.dispatch_candidate_index)
  ) {
    throw ledgerError(
      "candidate-dispatch-write-window",
      "production record differs from the active dispatch candidate",
    );
  }
  const stage = candidateDispatchAttemptStage(record);
  if (stage === null) {
    throw ledgerError(
      "candidate-dispatch-write-window",
      "active candidate dispatch record is outside the bounded protocol",
    );
  }
  const attempts = candidateDispatchScheduledAcquireAttempts(priorRecords)
    .filter(({ binding: prior }) =>
      prior.dispatch_reservation_digest === reservation.reservation_digest);
  const sameAttempt = attempts.filter(({ binding: prior }) =>
    canonicalJson(prior) === canonicalJson(binding));
  if (stage === 0) {
    if (sameAttempt.length !== 0) {
      throw ledgerError(
        "candidate-dispatch-attempt-replayed",
        "a dispatch candidate cannot acquire a second production lease",
      );
    }
    const acknowledged = new Set(active.acknowledgements.map(
      ({ candidate_index: index }) => index,
    ));
    if (attempts.some(({ binding: prior }) =>
      !acknowledged.has(prior.dispatch_candidate_index))) {
      throw ledgerError(
        "candidate-dispatch-attempt-unfinished",
        "the prior dispatch candidate must reach one durable acknowledgement",
      );
    }
    const budget = calculateActiveCandidateDispatchCommitBudget(
      dispatchAuthority.current_cycle,
      priorRecords.length,
    );
    if (budget.remaining_ledger_commit_capacity_after_dispatch < 0) {
      throw ledgerError(
        "candidate-dispatch-commit-capacity",
        "ledger cannot persist the remaining scheduled candidate protocol",
      );
    }
    return;
  }
  if (sameAttempt.length !== 1 || activeLease === null ||
      activeLease.acquire_commit_sha !== sameAttempt[0].entry.commit_sha ||
      canonicalJson(candidateDispatchAttemptBinding(
        activeLease.evaluated_scope_receipt,
      )) !== canonicalJson(binding)) {
    throw ledgerError(
      "candidate-dispatch-attempt-authority",
      "candidate production record lacks its unique active scheduled attempt",
    );
  }
  const acquireIndex = priorRecords.indexOf(sameAttempt[0].entry);
  const attemptRecords = priorRecords.slice(acquireIndex).map((entry) => ({
    value: entry.envelope,
    binding: candidateDispatchAttemptBinding(
      entry.envelope.workflow_provenance?.operation_binding
        ?.evaluated_scope_receipt ?? null,
    ),
  }));
  attemptRecords.push({ value: record, binding });
  let previousStage = -1;
  for (const item of attemptRecords) {
    const itemStage = candidateDispatchAttemptStage(item.value);
    if (
      itemStage === null || itemStage <= previousStage ||
      canonicalJson(item.binding) !== canonicalJson(binding) ||
      itemStage === 1 && previousStage !== 0 ||
      itemStage > 1 && itemStage < 12 && previousStage < 1
    ) {
      throw ledgerError(
        "candidate-dispatch-attempt-order",
        "candidate production attempt is not one closed ordered prefix",
      );
    }
    previousStage = itemStage;
  }
}

function validateProductionTransition(
  loaded,
  record,
  repository,
  evaluatedScopeReceipt,
) {
  if (record.record_type === "candidate-inventory-observation") {
    const dispatch = deriveV2GitLedgerCandidateDispatchAuthority(
      loaded.records,
      repository,
    );
    if (
      record.payload.phase === "cycle-start" &&
      dispatch.current_cycle !== null &&
      dispatch.current_cycle.cycle_complete === false
    ) {
      throw ledgerError(
        "candidate-dispatch-inventory-replacement",
        "a new candidate inventory cannot start before dispatch completes",
      );
    }
    validateCandidateInventoryTransition(loaded.records, record, repository);
    return;
  }
  if (record.record_type === "candidate-dispatch-observation") {
    if (loaded.active_lease !== null &&
        record.payload.phase !== "candidate-ack") {
      throw ledgerError(
        "candidate-dispatch-active-pr-lease",
        "repository dispatch control cannot advance during an active PR lease",
      );
    }
    if (record.payload.phase === "candidate-ack" &&
        loaded.active_lease !== null) {
      throw ledgerError(
        "candidate-dispatch-lease-release-required",
        "candidate dispatch ack requires a durably released PR lease",
      );
    }
    validateCandidateDispatchTransition(loaded.records, record, repository);
    return;
  }
  validateCandidateDispatchAttemptWindow({
    prior_records: loaded.records,
    record,
    evaluated_scope_receipt: evaluatedScopeReceipt,
    dispatch_authority: loaded.authority_projection.candidate_dispatch,
    active_lease: loaded.active_lease,
  });
  if (record.record_type === "lease-acquire") {
    if (loaded.active_lease !== null) {
      throw ledgerError("lease-active", "another unexpired controller lease is active");
    }
    if (loaded.records.some((entry) =>
      entry.envelope.record_type === "lease-acquire" &&
      entry.envelope.payload.lease_id === record.payload.lease_id)) {
      throw ledgerError("duplicate-lease", "lease identity is already consumed");
    }
    if (
      record.control_comment_binding !== null &&
      canonicalJson(record.control_comment_binding) !==
        canonicalJson(loaded.control_comment_binding)
    ) {
      throw ledgerError(
        "control-comment-binding",
        "lease acquire cites a non-current controller comment binding",
      );
    }
    return;
  }
  if (loaded.active_lease === null) {
    throw ledgerError("lease-required", "production record requires an active controller lease");
  }
  validateRecordLease(record, loaded.active_lease);
  requireSameScope(recordScope(record), loaded.active_lease.scope, "production record");
  if (record.record_type === "lease-release") {
    if (Date.parse(record.server_observed_at) >= Date.parse(loaded.active_lease.expires_at)) {
      throw ledgerError("lease-expired", "an expired lease cannot be released or reused");
    }
    return;
  }
  if (Date.parse(record.server_observed_at) >= Date.parse(loaded.active_lease.expires_at)) {
    throw ledgerError("lease-expired", "effect record is at or after lease expiry");
  }
  if (record.kind === "control-comment-create") {
    if (loaded.control_comment_binding !== null) {
      throw ledgerError(
        "control-comment-exists",
        "control-comment-create cannot replace an authorized controller comment",
      );
    }
  } else if (record.kind === "control-comment-update") {
    if (
      loaded.control_comment_binding === null ||
      (record.record_type === "effect-intent" &&
        canonicalJson(record.control_comment_binding) !==
          canonicalJson(loaded.control_comment_binding))
    ) {
      throw ledgerError(
        "control-comment-binding",
        "control-comment-update intent does not bind the current controller comment",
      );
    }
  } else if (
    record.control_comment_binding !== null &&
    canonicalJson(record.control_comment_binding) !==
      canonicalJson(loaded.control_comment_binding)
  ) {
    throw ledgerError(
      "control-comment-binding",
      "effect record cites a non-current controller comment binding",
    );
  }
  if (record.record_type === "effect-intent") {
    if (record.kind === "artifact-binding") {
      validateArtifactBindingLineage(loaded.records, record, repository);
    } else if (record.kind === "request-binding") {
      validateRequestBindingLineage(loaded.records, record, repository);
    } else if (record.kind === "review-request") {
      validateReviewRequestLineage(loaded.records, record);
    } else if (record.kind === "automatic-request-reservation") {
      validateAutomaticReservationLineage(loaded.records, record);
    } else if (record.kind === "scheduler-observation") {
      validateSchedulerObservationLineage(loaded.records, record);
    } else if (record.kind === "effect-attempt") {
      validateEffectAttemptLineage(loaded.records, record);
    } else if (record.kind === "reservation-status-write") {
      validateReservationStatusLineage(loaded.records, record);
    } else if (record.kind === "status-write") {
      validateStatusWriteLineage(loaded.records, record);
    }
    for (const entry of loaded.records) {
      if (entry.envelope.record_type !== "effect-intent") continue;
      if (entry.envelope.effect_id === record.effect_id) {
        throw ledgerError("duplicate-effect", "effect identity is already consumed");
      }
      if (entry.envelope.idempotency_key === record.idempotency_key) {
        throw ledgerError("duplicate-idempotency", "idempotency key is already consumed");
      }
    }
  } else {
    if (record.kind === "artifact-binding") {
      validateArtifactBindingLineage(loaded.records, record, repository);
    } else if (record.kind === "request-binding") {
      validateRequestBindingLineage(loaded.records, record, repository);
    } else if (record.kind === "review-request") {
      validateReviewRequestLineage(loaded.records, record);
    } else if (record.kind === "status-write") {
      validateStatusWriteLineage(loaded.records, record);
    }
    const intent = loaded.records.find((entry) =>
      entry.envelope.record_type === "effect-intent" &&
      entry.envelope.effect_id === record.effect_id);
    const response = loaded.records.find((entry) =>
      entry.envelope.record_type === "effect-response" &&
      entry.envelope.effect_id === record.effect_id);
    if (
      intent === undefined || response !== undefined ||
      intent.envelope.idempotency_key !== record.idempotency_key ||
      intent.envelope.kind !== record.kind ||
      record.payload.intent_commit_sha !== intent.commit_sha ||
      record.payload.predecessor_commit_sha !== intent.commit_sha ||
      canonicalJson(record.payload.action) !==
        canonicalJson(intent.envelope.payload.action) ||
      canonicalJson(record.payload.generation) !==
        canonicalJson(intent.envelope.payload.generation) ||
      record.payload.ordinal !== intent.envelope.payload.ordinal
    ) {
      throw ledgerError("invalid-effect-response", "response does not bind one unbound intent");
    }
  }
}

function validateArtifactBindingLineage(priorRecords, value, repositoryValue) {
  const repository = normalizeRepository(repositoryValue);
  const action = value.payload.action;
  const bindingEntry = priorRecords.find((entry) =>
    entry.commit_sha === action.request_binding_record_oid);
  const binding = bindingEntry?.envelope;
  if (
    binding?.record_type !== "effect-response" ||
    binding.kind !== "request-binding"
  ) {
    throw ledgerError(
      "artifact-request-binding-required",
      "artifact binding requires one prior reachable request-binding response",
    );
  }
  validateRequestBindingLineage(
    priorRecords.slice(0, priorRecords.indexOf(bindingEntry)),
    binding,
    repository,
  );
  requireSameScope(
    value.record_type?.startsWith("effect-")
      ? recordScope(value)
      : envelopeScope(value),
    envelopeScope(binding),
    "artifact binding request lineage",
  );
  const bindingPayload = binding.payload;
  if (
    canonicalJson(bindingPayload.generation) !==
      canonicalJson(value.payload.generation) ||
    bindingPayload.action.generation_id !== action.generation_id ||
    bindingPayload.action.request_id !== action.request_id ||
    bindingPayload.receipt.request_id !== action.request_id ||
    bindingPayload.receipt.request_node_id !== action.request_node_id ||
    bindingPayload.receipt.controlled !== true
  ) {
    throw ledgerError(
      "artifact-request-lineage-mismatch",
      "artifact binding differs from its prior controlled request authority",
    );
  }
  if (value.record_type !== "effect-response") return;
  const receipt = value.payload.receipt;
  requireExactArtifactUrl(
    receipt.artifact_url,
    repository,
    value.pull_request,
    receipt.artifact_selector,
  );
  if (
    Date.parse(receipt.artifact_created_at) <=
      Date.parse(bindingPayload.receipt.created_at) ||
    Date.parse(receipt.server_time) < Date.parse(receipt.artifact_created_at)
  ) {
    throw ledgerError(
      "artifact-time-order",
      "artifact binding does not strictly follow its request authority",
    );
  }
}

function validateReviewRequestLineage(priorRecords, value) {
  const reservations = priorRecords.filter((entry) => {
    const envelope = entry.envelope;
    return envelope.record_type === "effect-intent" &&
      envelope.kind === "automatic-request-reservation" &&
      canonicalJson(envelopeScope(envelope)) ===
        canonicalJson(recordOrEnvelopeScope(value)) &&
      canonicalJson(envelope.payload.generation) ===
        canonicalJson(value.payload.generation);
  });
  if (reservations.length !== 1) {
    throw ledgerError(
      "review-request-reservation-required",
      "review request requires one prior automatic reservation for its generation",
    );
  }
  const action = value.payload.action;
  const reservation = reservations[0];
  const attempts = priorRecords.filter((entry) => {
    const envelope = entry.envelope;
    return entry.commit_sha === action.attempt_record_oid &&
      envelope.record_type === "effect-intent" &&
      envelope.kind === "effect-attempt";
  });
  if (
    attempts.length !== 1 ||
    reservation.commit_sha !== action.reservation_record_oid ||
    reservation.envelope.payload.action.scheduler_observation_record_oid !==
      action.scheduler_observation_record_oid ||
    attempts[0].envelope.payload.action.reservation_record_oid !==
      reservation.commit_sha ||
    attempts[0].envelope.payload.action.scheduler_action_key !==
      action.scheduler_action_key ||
    reservation.envelope.payload.action.post_scheduler_action_key !==
      action.scheduler_action_key
  ) {
    throw ledgerError(
      "review-request-attempt-required",
      "review request lacks one durable retry-zero attempt and reservation lineage",
    );
  }
  if (value.record_type === "effect-response") {
    const intent = priorRecords.find((entry) =>
      entry.commit_sha === value.payload.intent_commit_sha);
    if (
      intent?.envelope.record_type !== "effect-intent" ||
      intent.envelope.kind !== "review-request" ||
      Date.parse(value.payload.receipt.request_scope_receipt.pre_scope.observed_at) <
        Date.parse(intent.envelope.server_observed_at)
    ) {
      throw ledgerError(
        "review-request-scope-precedes-intent",
        "review request scope evidence precedes its durable retry-zero intent",
      );
    }
  }
}

function validateAutomaticReservationLineage(priorRecords, value) {
  const action = value.payload.action;
  const repository = value.repository ?? priorRecords[0]?.envelope.repository;
  if (repository === undefined) {
    throw ledgerError(
      "automatic-reservation-repository-authority-missing",
      "automatic reservation lacks its reachable repository authority",
    );
  }
  const observation = priorRecords.find((entry) =>
    entry.commit_sha === action.scheduler_observation_record_oid);
  if (
    observation?.envelope.record_type !== "effect-intent" ||
    observation.envelope.kind !== "scheduler-observation"
  ) {
    throw ledgerError(
      "scheduler-observation-required",
      "automatic reservation requires one prior scheduler observation",
    );
  }
  const observed = observation.envelope.payload.action;
  validateRequiredStatusBindingsForObservation(
    priorRecords,
    observation.commit_sha,
  );
  const persist = observed.scheduler_plan.actions.find((item) =>
    item.kind === "persist_auto_request_intent" &&
    item.idempotency_key === action.scheduler_action_key);
  const post = observed.scheduler_plan.actions.find((item) =>
    item.kind === "post_review_request" &&
    item.idempotency_key === action.post_scheduler_action_key);
  if (
    persist === undefined || post === undefined ||
    persist.intent_id !== action.reservation.scheduler_intent_id ||
    post.intent_id !== persist.intent_id ||
    post.depends_on_idempotency_key !== persist.idempotency_key ||
    Date.parse(action.reservation.created_at) <
      Date.parse(observed.snapshot_server_time) ||
    action.reservation.status_ledger_binding.automatic_request_count !==
      countAutomaticReservations(priorRecords, recordOrEnvelopeScope(value))
  ) {
    throw ledgerError(
      "automatic-reservation-scheduler-mismatch",
      "automatic reservation differs from its exact scheduler action authority",
    );
  }
  if (
    action.reservation.status_ledger_binding.ledger_digest !==
      runnerHeadLedgerDigestFromRecords(
        priorRecords,
        recordOrEnvelopeScope(value),
        repository,
        action.reservation.status_ledger_binding.observed_at,
      )
  ) {
    throw ledgerError(
      "automatic-reservation-ledger-mismatch",
      "automatic reservation head-ledger preimage differs from reachable authority",
    );
  }
}

function validateRequiredStatusBindingsForObservation(
  priorRecords,
  observationRecordOid,
) {
  const observation = priorRecords.find((entry) =>
    entry.commit_sha === observationRecordOid);
  if (
    observation?.envelope.record_type !== "effect-intent" ||
    observation.envelope.kind !== "scheduler-observation"
  ) {
    throw ledgerError(
      "scheduler-observation-required",
      "automatic reservation requires one protected scheduler observation",
    );
  }
  const statusPlan = observation.envelope.payload.action.status_plan;
  if (statusPlan.writes.length !== 1) {
    throw ledgerError(
      "automatic-request-status-transaction-required",
      "automatic request requires one exact required-status transaction",
    );
  }
  const intents = priorRecords.filter((entry) =>
    entry.envelope.record_type === "effect-intent" &&
    entry.envelope.kind === "status-write" &&
    entry.envelope.payload.action.scheduler_observation_record_oid ===
      observationRecordOid);
  if (intents.length !== 1) {
    throw ledgerError(
      "automatic-request-required-status-unbound",
      "automatic request requires one durable required-status intent",
    );
  }
  const intent = intents[0];
  const action = intent.envelope.payload.action;
  const responses = priorRecords.filter((entry) =>
    entry.envelope.record_type === "effect-response" &&
    entry.envelope.kind === "status-write" &&
    entry.envelope.effect_id === intent.envelope.effect_id);
  if (
    responses.length !== 1 ||
    action.status_write_index !== 0 ||
    action.status_write_count !== 1 ||
    action.status_plan_digest !==
      observation.envelope.payload.action.status_plan_digest
  ) {
    throw ledgerError(
      "automatic-request-required-status-unbound",
      "automatic request requires one exact required-status response binding",
    );
  }
}

function validateSchedulerObservationLineage(priorRecords, value) {
  const action = value.payload.action;
  const scope = recordOrEnvelopeScope(value);
  const repository = value.repository ?? priorRecords[0]?.envelope.repository;
  if (repository === undefined) {
    throw ledgerError(
      "scheduler-repository-authority-missing",
      "scheduler observation lacks its reachable repository authority",
    );
  }
  if (
    action.prior_authority_digest !==
      runnerPriorAuthorityDigest(priorRecords, scope)
  ) {
    throw ledgerError(
      "scheduler-prior-authority-mismatch",
      "scheduler observation does not bind the exact reachable predecessor authority",
    );
  }
  const claims = value.workflow_provenance?.claims;
  const leaseOwner = value.lease?.owner;
  if (
    leaseOwner === undefined ||
    action.prior_scheduling.run_identity.run_id !== leaseOwner.run_id ||
    action.prior_scheduling.run_identity.run_attempt !==
      leaseOwner.run_attempt ||
    action.scheduler_evaluation.run_id !== leaseOwner.run_id ||
    action.scheduler_evaluation.run_attempt !== leaseOwner.run_attempt
  ) {
    throw ledgerError(
      "scheduler-run-identity-mismatch",
      "scheduler observation run identity differs from its protected lease owner",
    );
  }
  if (
    claims !== undefined &&
    (action.prior_scheduling.run_identity.run_id !== claims.run_id ||
      action.prior_scheduling.run_identity.run_attempt !==
        Number(claims.run_attempt) ||
      action.scheduler_evaluation.run_id !== claims.run_id ||
      action.scheduler_evaluation.run_attempt !== Number(claims.run_attempt))
  ) {
    throw ledgerError(
      "scheduler-run-identity-mismatch",
      "scheduler observation run identity differs from its signed OIDC claims",
    );
  }
  const priorHead = deriveRunnerHeadLedger(
    priorRecords,
    scope,
    repository,
    action.prior_head_ledger.observed_at,
  );
  if (canonicalJson(priorHead) !== canonicalJson(action.prior_head_ledger)) {
    throw ledgerError(
      "scheduler-head-ledger-mismatch",
      "scheduler observation head ledger differs from reachable intent authority",
    );
  }
  const observations = schedulerObservationRecords(priorRecords, scope);
  if (observations.some((entry) =>
    entry.envelope.payload.action.scheduler_evaluation.snapshot_id ===
      action.scheduler_evaluation.snapshot_id)) {
    throw ledgerError(
      "scheduler-snapshot-replay",
      "scheduler observation repeats one protected snapshot identity",
    );
  }
  if (observations.length === 0) {
    if (action.initial_runner_state_authority === null) {
      throw ledgerError(
        "initial-runner-authority-required",
        "first scheduler observation lacks its protected initial authority",
      );
    }
    validateInitialRunnerStateHistoricalAuthority({
      prior_records: priorRecords,
      record_or_envelope: value,
      repository,
      authority: action.initial_runner_state_authority,
    });
    if (
      action.prior_scheduling.complete_snapshots.length !== 0 ||
      action.prior_scheduling.applied_action_keys.length !== 0 ||
      action.prior_scheduling.status.exact_sha_context_count !== 0 ||
      action.prior_scheduling.status.latest_idempotency_key !== null ||
      action.prior_scheduling.status.head_sentinel_receipt !== null ||
      action.prior_scheduling.epoch.controlled_request !== null ||
      action.prior_scheduling.epoch.automatic_request.state !== "available" ||
      action.prior_scheduling.epoch.id !== runnerEpochId(
        repository.node_id,
        value.pull_request.node_id,
        value.head_ref_oid,
      )
    ) {
      throw ledgerError(
        "scheduler-genesis-state-mismatch",
        "first scheduler observation does not start from an empty review epoch",
      );
    }
  } else {
    if (action.initial_runner_state_authority !== null) {
      throw ledgerError(
        "initial-runner-authority-replayed",
        "later scheduler observation repeats initial authority",
      );
    }
    const expected = deriveRunnerScheduling(
      priorRecords,
      scope,
      repository,
      action.prior_scheduling,
    );
    if (canonicalJson(expected) !== canonicalJson(action.prior_scheduling)) {
      throw ledgerError(
        "scheduler-prior-state-mismatch",
        "scheduler observation prior state differs from reachable authority",
      );
    }
  }
  validateNoStartHistory([
    ...observations.map((entry) => entry.envelope.payload.action.scheduler_evaluation),
    action.scheduler_evaluation,
  ]);
}

function validateInitialRunnerStateHistoricalAuthority({
  prior_records: priorRecords,
  record_or_envelope: value,
  repository,
  authority: authorityValue,
}) {
  const authority = validateV2GitLedgerInitialRunnerStateAuthority(
    authorityValue,
  );
  const scope = recordOrEnvelopeScope(value);
  const action = value.payload.action;
  const source = authority.source_authority;
  const lease = authority.lease_authority;
  const evaluated = authority.evaluated_scope_authority;
  const command = authority.workflow_command_authority.command;
  const preflight = authority.preflight_authority;
  const tip = priorRecords.at(-1);
  if (
    canonicalJson(authority.scope) !== canonicalJson(scope) ||
    tip?.commit_sha !== source.tip_commit_sha ||
    value.predecessor_commit_sha !== source.tip_commit_sha ||
    action.prior_authority_digest !== authority.prior_authority_digest ||
    canonicalJson(action.prior_scheduling) !==
      canonicalJson(authority.scheduling) ||
    canonicalJson(action.prior_head_ledger) !==
      canonicalJson(authority.head_ledger) ||
    canonicalJson(value.lease?.owner) !== canonicalJson(lease.owner)
  ) {
    throw ledgerError(
      "initial-runner-authority-lineage-mismatch",
      "initial runner authority differs from its scheduler predecessor",
    );
  }
  if (
    runnerPriorAuthorityDigest(priorRecords, scope) !==
      authority.prior_authority_digest ||
    priorRecords.some((entry) =>
      new Set(["effect-intent", "effect-response"])
        .has(entry.envelope.record_type) && sameHeadScope(entry.envelope, scope))
  ) {
    throw ledgerError(
      "initial-runner-prior-history-mismatch",
      "initial runner authority does not bind an effect-free predecessor",
    );
  }
  if (
    source.fully_reachable_record_manifest_digest !==
      fullyReachableRecordManifestDigest(priorRecords)
  ) {
    throw ledgerError(
      "initial-runner-source-manifest-mismatch",
      "initial runner manifest differs from reachable history",
    );
  }
  const acquire = priorRecords.find((entry) =>
    entry.commit_sha === lease.acquire_commit_sha);
  const acquireEvaluated = acquire?.envelope.workflow_provenance
    ?.operation_binding?.evaluated_scope_receipt;
  if (
    acquire?.envelope.record_type !== "lease-acquire" ||
    acquire.envelope.payload.lease_id !== lease.lease_id ||
    acquire.envelope.payload.acquired_at !== lease.acquired_at ||
    acquire.envelope.payload.expires_at !== lease.expires_at ||
    canonicalJson(acquire.envelope.payload.owner) !== canonicalJson(lease.owner) ||
    acquireEvaluated?.receipt_digest !==
      lease.evaluated_scope_receipt_digest ||
    acquireEvaluated?.receipt_digest !==
      evaluated.lease_evaluated_scope_receipt_digest
  ) {
    throw ledgerError(
      "initial-runner-lease-authority-mismatch",
      "initial runner lease differs from its reachable acquire",
    );
  }
  const recordEvaluated = value.workflow_provenance?.operation_binding
    ?.evaluated_scope_receipt ?? null;
  if (
    recordEvaluated !== null &&
    (
      recordEvaluated.receipt_digest !==
        evaluated.record_evaluated_scope_receipt_digest ||
      canonicalJson(recordEvaluated.scope) !== canonicalJson(scope) ||
      recordEvaluated.relation !== evaluated.relation
    )
  ) {
    throw ledgerError(
      "initial-runner-evaluated-scope-mismatch",
      "initial runner record differs from its stored evaluated scope",
    );
  }
  if (evaluated.relation === "provider-selector") {
    if (
      acquireEvaluated.provider_artifact_receipt.phase !== "pre-scope" ||
      evaluated.provider_pre_scope_receipt_digest !==
        acquireEvaluated.receipt_digest ||
      recordEvaluated !== null &&
        recordEvaluated.provider_artifact_receipt.pre_scope_receipt_digest !==
          acquireEvaluated.receipt_digest
    ) {
      throw ledgerError(
        "initial-runner-provider-lineage-mismatch",
        "initial runner provider authority reverses pre/full discovery lineage",
      );
    }
  }
  if (recordEvaluated !== null) {
    validateFullDiscoveryScopeLineage(acquireEvaluated, recordEvaluated, lease);
    if (
      canonicalJson(evaluated.discovery_continuity_receipt) !==
        canonicalJson(recordEvaluated.discovery_continuity_receipt)
    ) {
      throw ledgerError(
        "initial-runner-continuity-mismatch",
        "initial runner action omits its full discovery continuity receipt",
      );
    }
  }
  validateInitialCommandScope(command, repository, recordEvaluated ?? acquireEvaluated);
  if (
    command.invocation.run_id !== lease.owner.run_id ||
    command.invocation.run_attempt !== lease.owner.run_attempt ||
    command.invocation.actor_id !== lease.owner.actor_id ||
    authority.scheduling.public_wait_supported !==
      preflight.public_wait_supported ||
    authority.scheduling.epoch.started_at !== lease.acquired_at
  ) {
    throw ledgerError(
      "initial-runner-command-authority-mismatch",
      "initial runner command/preflight projection differs from its lease",
    );
  }
  const claims = value.workflow_provenance?.claims;
  if (
    claims !== undefined &&
    (
      claims.run_id !== command.invocation.run_id ||
      Number(claims.run_attempt) !== command.invocation.run_attempt ||
      claims.event_name !== command.invocation.event_name
    )
  ) {
    throw ledgerError(
      "initial-runner-command-oidc-mismatch",
      "initial runner command differs from reverified record OIDC claims",
    );
  }
  const attestation = priorRecords.find((entry) =>
    entry.commit_sha === source.capability_attestation_commit_sha);
  const embeddedCapability = attestation?.envelope.payload.capability_receipt;
  if (
    attestation?.envelope.record_type !== "capability-attestation" ||
    attestation.envelope.payload.capability_input_digest !==
      source.capability_input_digest ||
    embeddedCapability === undefined ||
    digestCanonical(
      "codex-review-gate-v2-controller-release",
      embeddedCapability.controller_release,
    ) !== source.controller_release_digest
  ) {
    throw ledgerError(
      "initial-runner-capability-authority-mismatch",
      "initial runner authority differs from its reachable capability epoch",
    );
  }
}

function fullyReachableRecordManifestDigest(records) {
  const manifest = records.map((entry) => ({
    record_oid: entry.commit_sha,
    parent_oid: entry.parents[0] ?? null,
    tree_oid: entry.tree_sha,
    envelope_digest: entry.envelope.envelope_digest,
    record_type: entry.envelope.record_type,
    kind: entry.envelope.kind,
    effect_id: entry.envelope.effect_id,
    idempotency_key: entry.envelope.idempotency_key,
    payload_digest: entry.envelope.payload_digest,
    workflow_provenance_receipt_digest:
      entry.envelope.workflow_provenance.receipt_digest,
    workflow_provenance_jti:
      provenanceReplayIdentity(entry.envelope.workflow_provenance),
    server_observed_at: entry.envelope.server_observed_at,
  }));
  return digestCanonical(
    "codex-review-gate-v2-fully-reachable-record-manifest",
    manifest,
  );
}

function runnerPriorAuthorityDigest(records, scope) {
  const rows = records.map((entry) => ({
    record_oid: entry.commit_sha,
    parent_oids: structuredClone(entry.parents),
    tree_oid: entry.tree_sha,
    blob_oid: entry.blob_sha,
    envelope_digest: entry.envelope.envelope_digest,
  }));
  return digestCanonical(
    "codex-review-gate-v2-runner-prior-authority",
    { scope, records: rows },
  );
}

function schedulerObservationRecords(records, scope) {
  return records.filter((entry) =>
    entry.envelope.record_type === "effect-intent" &&
    entry.envelope.kind === "scheduler-observation" &&
    sameHeadScope(entry.envelope, scope));
}

function deriveRunnerScheduling(records, scope, repository, currentInput) {
  const observations = schedulerObservationRecords(records, scope);
  if (observations.length === 0) {
    throw ledgerError(
      "scheduler-observation-required",
      "runner scheduling cannot be derived without a protected observation",
    );
  }
  const first = observations[0].envelope.payload.action.prior_scheduling;
  const completeSnapshots = [];
  const snapshotIds = new Set();
  for (const observation of observations) {
    const snapshot = observation.envelope.payload.action.scheduler_evaluation;
    if (snapshot.complete === true && !snapshotIds.has(snapshot.snapshot_id)) {
      completeSnapshots.push(structuredClone(snapshot));
      snapshotIds.add(snapshot.snapshot_id);
    }
  }
  const automaticRequest = deriveRunnerAutomaticRequest(records, scope);
  const controlledRequest = deriveRunnerControlledRequest(records, scope);
  const head = deriveRunnerHeadLedger(
    records,
    scope,
    repository,
    currentInput.status.head_sentinel_receipt?.observed_at ??
      records.at(-1).envelope.server_observed_at,
  );
  const status = deriveRunnerSchedulingStatus(records, scope);
  return {
    trigger: currentInput.trigger,
    public_wait_supported: first.public_wait_supported,
    status_target_mode: first.status_target_mode,
    run_identity: structuredClone(currentInput.run_identity),
    epoch: {
      id: first.epoch.id,
      started_at: first.epoch.started_at,
      controlled_request: controlledRequest,
      automatic_request: automaticRequest,
    },
    complete_snapshots: completeSnapshots,
    status: {
      exact_sha_context_count: head.exact_sha_context_count,
      latest_idempotency_key: head.latest_status_idempotency_key,
      head_sentinel_receipt: status.head_sentinel_receipt,
    },
    applied_action_keys: deriveAppliedSchedulerActionKeys(records, scope),
    no_start_candidate: structuredClone(currentInput.no_start_candidate),
  };
}

function deriveRunnerAutomaticRequest(records, scope) {
  const reservations = automaticReservationRecords(records, scope);
  if (reservations.length === 0) {
    return {
      state: "available",
      intent_id: null,
      intent_persisted_at: null,
      effect_attempted_at: null,
    };
  }
  const reservation = reservations.at(-1);
  const reservationValue = reservation.envelope.payload.action.reservation;
  const attempt = records.find((entry) =>
    entry.envelope.record_type === "effect-intent" &&
    entry.envelope.kind === "effect-attempt" &&
    entry.envelope.payload.action.reservation_record_oid ===
      reservation.commit_sha);
  return {
    state: attempt === undefined ? "intent-persisted" : "effect-attempted",
    intent_id: reservationValue.scheduler_intent_id,
    intent_persisted_at: reservation.envelope.server_observed_at,
    effect_attempted_at: attempt === undefined
      ? null
      : attempt.envelope.server_observed_at,
  };
}

function deriveRunnerControlledRequest(records, scope) {
  const bindings = records.filter((entry) =>
    entry.envelope.record_type === "effect-response" &&
    entry.envelope.kind === "request-binding" &&
    sameHeadScope(entry.envelope, scope));
  if (bindings.length === 0) return null;
  const binding = bindings.at(-1);
  return {
    request_id: binding.envelope.payload.receipt.request_id,
    bound_at: binding.envelope.payload.receipt.created_at,
    binding_record_oid: binding.commit_sha,
    binding_receipt_digest: digestCanonical(
      "codex-review-gate-v2-request-binding-receipt",
      binding.envelope.payload.receipt,
    ),
  };
}

function validateNoStartHistory(snapshots) {
  const earliest = new Map();
  for (const snapshot of snapshots) {
    const candidate = snapshot.no_start_candidate;
    if (candidate === null) continue;
    const key = canonicalJson({
      artifact_id: candidate.artifact_id,
      artifact_digest: candidate.artifact_digest,
      scope_fingerprint: candidate.scope_fingerprint,
      lifecycle_fingerprint: candidate.lifecycle_fingerprint,
    });
    const prior = earliest.get(key);
    if (prior !== undefined && prior !== candidate.first_seen_at) {
      throw ledgerError(
        "no-start-first-seen-drift",
        "no-start candidate resets its durable first-seen authority",
      );
    }
    earliest.set(key, candidate.first_seen_at);
  }
}

function automaticReservationRecords(records, scope) {
  return records.filter((entry) =>
    entry.envelope.record_type === "effect-intent" &&
    entry.envelope.kind === "automatic-request-reservation" &&
    sameHeadScope(entry.envelope, scope));
}

function countAutomaticReservations(records, scope) {
  const reservations = automaticReservationRecords(records, scope);
  if (reservations.length > 3) {
    throw ledgerError(
      "automatic-reservation-cap",
      "reachable automatic reservation intents exceed the head budget",
    );
  }
  return reservations.length;
}

function sameHeadScope(value, scope) {
  return canonicalJson(value.pull_request) === canonicalJson(scope.pull_request) &&
    value.head_ref_oid === scope.head_ref_oid;
}

function deriveRunnerHeadLedger(records, scope, repository, observedAtValue) {
  const observedAt = timestamp(observedAtValue, "runner head ledger boundary");
  const automaticRequestCount = countAutomaticReservations(records, scope);
  const statusIntents = requiredStatusIntentRecords(records, scope);
  if (statusIntents.length > 1000) {
    throw ledgerError(
      "status-intent-cap",
      "reachable required status intents exceed the exact SHA context cap",
    );
  }
  const boundAttemptIds = [];
  const bound = new Set();
  for (const entry of records) {
    const envelope = entry.envelope;
    if (
      envelope.record_type !== "effect-response" ||
      envelope.kind !== "request-binding" ||
      !sameHeadScope(envelope, scope)
    ) continue;
    const attemptEntry = records.find((candidate) =>
      candidate.commit_sha === envelope.payload.action.attempt_record_oid);
    const attemptId = attemptEntry?.envelope.payload.action.attempt.attempt_id;
    if (!RUNNER_ATTEMPT_ID.test(attemptId ?? "") || bound.has(attemptId)) {
      throw ledgerError(
        "bound-attempt-conflict",
        "request binding repeats or lacks one protected pre-effect attempt",
      );
    }
    bound.add(attemptId);
    boundAttemptIds.push(attemptId);
  }
  const latestStatus = statusIntents.at(-1)?.envelope.payload.action ?? null;
  return {
    schema: V2_GIT_LEDGER_HEAD_LEDGER_SCHEMA,
    schema_version: 1,
    repository_node_id: repository.node_id,
    pull_request_node_id: scope.pull_request.node_id,
    head_ref_oid: scope.head_ref_oid,
    automatic_request_count: automaticRequestCount,
    exact_sha_context_count: statusIntents.length,
    latest_status_idempotency_key:
      latestStatus?.scheduler_action_key ?? null,
    bound_attempt_ids: boundAttemptIds,
    observed_at: observedAt,
  };
}

function runnerHeadLedgerDigestFromRecords(
  records,
  scope,
  repository,
  observedAt,
) {
  return runnerDigestCanonical(
    "codex-review-gate-v2-head-ledger",
    deriveRunnerHeadLedger(records, scope, repository, observedAt),
  );
}

function requiredStatusIntentRecords(records, scope) {
  return records.filter((entry) => {
    const envelope = entry.envelope;
    return envelope.record_type === "effect-intent" &&
      envelope.kind === "status-write" &&
      envelope.payload.action.context === "codex/github-review-gate" &&
      sameHeadScope(envelope, scope);
  });
}

function deriveRunnerSchedulingStatus(records, scope) {
  const intents = requiredStatusIntentRecords(records, scope);
  let headSentinelReceipt = null;
  for (const entry of records) {
    const envelope = entry.envelope;
    if (
      envelope.record_type !== "effect-response" ||
      envelope.kind !== "status-write" ||
      envelope.payload.action.role !== "head-sentinel" ||
      envelope.payload.action.context !== "codex/github-review-gate" ||
      !sameHeadScope(envelope, scope)
    ) continue;
    if (envelope.payload.receipt.state === "success") {
      throw ledgerError(
        "sentinel-success-forbidden",
        "reachable head sentinel response cannot carry success",
      );
    }
    headSentinelReceipt = {
      sha: envelope.payload.receipt.target_sha,
      context: envelope.payload.receipt.context,
      state: envelope.payload.receipt.state,
      status_id: envelope.payload.receipt.status_id,
      observed_at: envelope.payload.receipt.created_at,
    };
  }
  return {
    exact_sha_context_count: intents.length,
    latest_idempotency_key:
      intents.at(-1)?.envelope.payload.action.scheduler_action_key ?? null,
    head_sentinel_receipt: headSentinelReceipt,
  };
}

function deriveAppliedSchedulerActionKeys(records, scope) {
  const keys = [];
  const identities = new Map();
  const statusIndexes = new Map();
  const add = (key, identity, statusIndex = null, statusCount = null) => {
    const prior = identities.get(key);
    if (prior === undefined) {
      identities.set(key, identity);
      keys.push(key);
    } else if (prior !== identity) {
      throw ledgerError(
        "scheduler-action-key-conflict",
        "one scheduler action key identifies competing protected intents",
      );
    }
    if (statusIndex !== null) {
      const state = statusIndexes.get(key) ?? {
        count: statusCount,
        indexes: new Set(),
      };
      if (state.count !== statusCount || state.indexes.has(statusIndex)) {
        throw ledgerError(
          "status-plan-index-conflict",
          "status scheduler authority repeats or conflicts on a planned slot",
        );
      }
      state.indexes.add(statusIndex);
      statusIndexes.set(key, state);
    }
  };
  for (const entry of records) {
    const envelope = entry.envelope;
    if (envelope.record_type !== "effect-intent" ||
        !sameHeadScope(envelope, scope)) continue;
    const action = envelope.payload.action;
    if (envelope.kind === "automatic-request-reservation") {
      add(action.scheduler_action_key,
        `reservation:${entry.commit_sha}`);
    } else if (envelope.kind === "effect-attempt") {
      add(action.scheduler_action_key, `attempt:${entry.commit_sha}`);
    } else if (envelope.kind === "status-write") {
      add(
        action.scheduler_action_key,
        `status:${action.scheduler_observation_record_oid}:` +
          `${action.status_plan_digest}`,
        action.status_write_index,
        action.status_write_count,
      );
    }
  }
  for (const [key, state] of statusIndexes) {
    if (state.indexes.size !== state.count) {
      // Partial status publication remains consumed and authoritative. Missing
      // siblings are not refunded, so the scheduler key is still applied.
      void key;
    }
  }
  return keys;
}

function validateEffectAttemptLineage(priorRecords, value) {
  const action = value.payload.action;
  const reservation = priorRecords.find((entry) =>
    entry.commit_sha === action.reservation_record_oid);
  const observation = priorRecords.find((entry) =>
    entry.commit_sha === action.scheduler_observation_record_oid);
  if (
    reservation?.envelope.record_type !== "effect-intent" ||
    reservation.envelope.kind !== "automatic-request-reservation" ||
    observation?.envelope.record_type !== "effect-intent" ||
    observation.envelope.kind !== "scheduler-observation" ||
    reservation.envelope.payload.action.scheduler_observation_record_oid !==
      observation.commit_sha ||
    reservation.envelope.payload.action.post_scheduler_action_key !==
      action.scheduler_action_key
  ) {
    throw ledgerError(
      "effect-attempt-reservation-required",
      "effect attempt lacks its exact scheduler observation and reservation",
    );
  }
  validateV2GitLedgerRequestAttempt(action.attempt, {
    reservation: reservation.envelope.payload.action.reservation,
  });
  if (canonicalJson(value.payload.generation) !==
      canonicalJson(reservation.envelope.payload.generation)) {
    throw ledgerError(
      "effect-attempt-generation-mismatch",
      "effect attempt differs from its consumed reservation generation",
    );
  }
  const reservationStatusResponses = priorRecords.filter((entry) => {
    const envelope = entry.envelope;
    return envelope.record_type === "effect-response" &&
      envelope.kind === "reservation-status-write" &&
      envelope.payload.action.reservation_record_oid === reservation.commit_sha &&
      canonicalJson(envelope.payload.generation) ===
        canonicalJson(value.payload.generation);
  });
  if (reservationStatusResponses.length !== 1) {
    throw ledgerError(
      "reservation-status-binding-required",
      "effect attempt is forbidden before one exact reservation status binding",
    );
  }
  if (
    Date.parse(action.attempt.recorded_at) <
      Date.parse(
        reservationStatusResponses[0].envelope.payload.receipt
          .refetch_server_time,
      )
  ) {
    throw ledgerError(
      "effect-attempt-before-reservation-status",
      "effect attempt precedes its exact reservation status refetch binding",
    );
  }
}

function validateReservationStatusLineage(priorRecords, value) {
  const action = value.payload.action;
  const reservation = priorRecords.find((entry) =>
    entry.commit_sha === action.reservation_record_oid);
  if (
    reservation?.envelope.record_type !== "effect-intent" ||
    reservation.envelope.kind !== "automatic-request-reservation" ||
    canonicalJson(reservation.envelope.payload.generation) !==
      canonicalJson(value.payload.generation) ||
    action.description_digest !==
      reservation.envelope.payload.action.reservation_digest ||
    action.generation_id !==
      reservation.envelope.payload.generation.generation_id ||
    action.ordinal !== reservation.envelope.payload.ordinal
  ) {
    throw ledgerError(
      "reservation-status-lineage",
      "reservation status does not bind one exact consumed reservation",
    );
  }
}

function validateStatusWriteLineage(priorRecords, value) {
  const action = value.payload.action;
  const observation = priorRecords.find((entry) =>
    entry.commit_sha === action.scheduler_observation_record_oid);
  if (
    observation?.envelope.record_type !== "effect-intent" ||
    observation.envelope.kind !== "scheduler-observation"
  ) {
    throw ledgerError(
      "status-scheduler-observation-required",
      "status write lacks its exact scheduler observation",
    );
  }
  const observed = observation.envelope.payload.action;
  const publish = observed.scheduler_plan.actions.find((item) =>
    item.kind === "publish_status" &&
    item.idempotency_key === action.scheduler_action_key);
  const writes = observed.status_plan.writes;
  const planned = writes[action.status_write_index];
  if (
    publish === undefined ||
    action.scheduler_plan_digest !== observed.scheduler_plan_digest ||
    action.status_plan_digest !== observed.status_plan_digest ||
    action.status_write_count !== writes.length ||
    planned === undefined || action.mode !== observed.status_plan.mode ||
    planned.role !== action.role || planned.sha !== action.target_sha ||
    planned.context !== action.context || planned.state !== action.state ||
    value.idempotency_key !== planned.idempotency_key
  ) {
    throw ledgerError(
      "status-plan-mismatch",
      "status write differs from its exact scheduler and runner status plan",
    );
  }
}

function validateCurrentSchedulerAppendForStatus({
  loaded,
  scheduler_append: schedulerAppend,
  scheduler_authority: schedulerAuthority,
  evaluated_scope_receipt: evaluatedScopeReceipt,
}) {
  validateCurrentSchedulerAppendAuthority({
    loaded,
    scheduler_append: schedulerAppend,
    scheduler_authority: schedulerAuthority,
    evaluated_scope_receipt: evaluatedScopeReceipt,
  });
  const observationRecordOid = schedulerAuthority.observation_record_oid;
  const scope = schedulerAuthority.scope;
  if (requiredStatusIntentRecords(loaded.records, scope).some((entry) =>
    entry.envelope.payload.action.scheduler_observation_record_oid ===
      observationRecordOid)) {
    throw ledgerError(
      "status-scheduler-append-replayed",
      "the scheduler observation already consumed its status publication authority",
    );
  }
}

function validateCurrentSchedulerAppendAuthority({
  loaded,
  scheduler_append: schedulerAppend,
  scheduler_authority: schedulerAuthority,
  evaluated_scope_receipt: evaluatedScopeReceipt,
}) {
  const observationRecordOid = schedulerAuthority.observation_record_oid;
  const observation = loaded.records.find((entry) =>
    entry.commit_sha === observationRecordOid);
  const scope = schedulerAuthority.scope;
  const observations = schedulerObservationRecords(loaded.records, scope);
  const activeLease = loaded.active_lease;
  if (
    observation?.envelope.record_type !== "effect-intent" ||
    observation.envelope.kind !== "scheduler-observation" ||
    observations.at(-1)?.commit_sha !== observationRecordOid ||
    schedulerAppend.append_receipt.commit_sha !== observationRecordOid ||
    schedulerAppend.append_receipt.payload_digest !==
      observation.envelope.payload_digest ||
    schedulerAppend.record.effect_id !== observation.envelope.effect_id ||
    schedulerAppend.record.idempotency_key !==
      observation.envelope.idempotency_key ||
    canonicalJson(schedulerAppend.record.payload.action) !==
      canonicalJson(observation.envelope.payload.action) ||
    activeLease === null ||
    activeLease.acquire_commit_sha !==
      schedulerAuthority.lease_authority.acquire_commit_sha ||
    canonicalJson(activeLease.scope) !== canonicalJson(scope)
  ) {
    throw ledgerError(
      "stale-scheduler-status-authority",
      "status intent requires the current reachable scheduler observation and lease",
    );
  }
  validateFullDiscoveryScopeLineage(
    activeLease.evaluated_scope_receipt,
    evaluatedScopeReceipt,
    activeLease,
  );
}

function validateCurrentStatusIntentForResponse({
  loaded,
  private_intent: privateIntent,
}) {
  const intentOid = privateIntent.intent_append_receipt.commit_sha;
  const intent = loaded.records.find((entry) => entry.commit_sha === intentOid);
  const activeLease = loaded.active_lease;
  if (
    intent?.envelope.record_type !== "effect-intent" ||
    intent.envelope.kind !== "status-write" ||
    canonicalJson(intent.envelope.payload.action) !==
      canonicalJson(privateIntent.intent_record.payload.action) ||
    loaded.records.some((entry) =>
      entry.envelope.record_type === "effect-response" &&
      entry.envelope.effect_id === privateIntent.intent_record.effect_id) ||
    activeLease === null ||
    activeLease.acquire_commit_sha !==
      privateIntent.lease_authority.acquire_commit_sha ||
    canonicalJson(activeLease.scope) !== canonicalJson(privateIntent.scope)
  ) {
    throw ledgerError(
      "stale-status-intent-authority",
      "status response requires one current reachable unbound intent and lease",
    );
  }
  validateFullDiscoveryScopeLineage(
    activeLease.evaluated_scope_receipt,
    privateIntent.evaluated_scope_receipt,
    activeLease,
  );
}

function validateCurrentAutomaticReservation({
  loaded,
  private_reservation: privateReservation,
  require_status_absent: requireStatusAbsent,
}) {
  const reservationOid =
    privateReservation.reservation_append_receipt.commit_sha;
  const reservation = loaded.records.find((entry) =>
    entry.commit_sha === reservationOid);
  const activeLease = loaded.active_lease;
  const statusIntents = loaded.records.filter((entry) =>
    entry.envelope.record_type === "effect-intent" &&
    entry.envelope.kind === "reservation-status-write" &&
    entry.envelope.payload.action.reservation_record_oid === reservationOid);
  if (
    reservation?.envelope.record_type !== "effect-intent" ||
    reservation.envelope.kind !== "automatic-request-reservation" ||
    canonicalJson(reservation.envelope.payload.action) !==
      canonicalJson(privateReservation.reservation_record.payload.action) ||
    activeLease === null ||
    activeLease.acquire_commit_sha !==
      privateReservation.lease_authority.acquire_commit_sha ||
    canonicalJson(activeLease.scope) !== canonicalJson(privateReservation.scope) ||
    (requireStatusAbsent && statusIntents.length !== 0)
  ) {
    throw ledgerError(
      "stale-automatic-reservation-authority",
      "reservation status requires one current reachable reservation and lease",
    );
  }
  validateFullDiscoveryScopeLineage(
    activeLease.evaluated_scope_receipt,
    privateReservation.evaluated_scope_receipt,
    activeLease,
  );
}

function validateCurrentReservationStatusIntent({
  loaded,
  private_intent: privateIntent,
}) {
  const intentOid = privateIntent.intent_append_receipt.commit_sha;
  const intent = loaded.records.find((entry) => entry.commit_sha === intentOid);
  const activeLease = loaded.active_lease;
  if (
    intent?.envelope.record_type !== "effect-intent" ||
    intent.envelope.kind !== "reservation-status-write" ||
    canonicalJson(intent.envelope.payload.action) !==
      canonicalJson(privateIntent.intent_record.payload.action) ||
    loaded.records.some((entry) =>
      entry.envelope.record_type === "effect-response" &&
      entry.envelope.effect_id === privateIntent.intent_record.effect_id) ||
    activeLease === null ||
    activeLease.acquire_commit_sha !==
      privateIntent.lease_authority.acquire_commit_sha ||
    canonicalJson(activeLease.scope) !== canonicalJson(privateIntent.scope)
  ) {
    throw ledgerError(
      "stale-reservation-status-intent-authority",
      "reservation status response requires one reachable unbound intent and lease",
    );
  }
  validateFullDiscoveryScopeLineage(
    activeLease.evaluated_scope_receipt,
    privateIntent.evaluated_scope_receipt,
    activeLease,
  );
}

function validateCurrentAutomaticReservationForAttempt({
  loaded,
  private_reservation: privateReservation,
  private_response: privateResponse,
}) {
  validateCurrentAutomaticReservation({
    loaded,
    private_reservation: privateReservation,
    require_status_absent: false,
  });
  const reservationOid =
    privateReservation.reservation_append_receipt.commit_sha;
  const responseOid = privateResponse.response_append_receipt.commit_sha;
  const response = loaded.records.find((entry) =>
    entry.commit_sha === responseOid);
  const statusIntent = privateResponse.private_intent;
  const attempts = loaded.records.filter((entry) =>
    entry.envelope.record_type === "effect-intent" &&
    entry.envelope.kind === "effect-attempt" &&
    entry.envelope.payload.action.reservation_record_oid === reservationOid);
  const reviewRequests = loaded.records.filter((entry) =>
    entry.envelope.record_type === "effect-intent" &&
    entry.envelope.kind === "review-request" &&
    entry.envelope.payload.action.reservation_record_oid === reservationOid);
  const runnerState = deriveV2GitLedgerRunnerState(
    loaded.records,
    privateReservation.scope,
    loaded.post_ref.server_time,
  );
  const authoritativeReservation = runnerState.reservations.find((item) =>
    item.record_oid === reservationOid);
  if (
    response?.envelope.record_type !== "effect-response" ||
    response.envelope.kind !== "reservation-status-write" ||
    response.envelope.payload.intent_commit_sha !==
      statusIntent.intent_append_receipt.commit_sha ||
    canonicalJson(response.envelope.payload.action) !==
      canonicalJson(statusIntent.intent_record.payload.action) ||
    canonicalJson(response.envelope.payload.receipt) !==
      canonicalJson(privateResponse.response_record.payload.receipt) ||
    authoritativeReservation?.reservation_status_response_record_oid !==
      responseOid ||
    authoritativeReservation.reservation_status_bound !== true ||
    attempts.length !== 0 || reviewRequests.length !== 0
  ) {
    throw ledgerError(
      "stale-automatic-request-attempt-authority",
      "automatic request attempt requires one bound reservation status and no prior attempt",
    );
  }
}

function validateCurrentAutomaticReviewRequestAttempt({
  loaded,
  private_reservation: privateReservation,
  private_response: privateResponse,
  attempt_record: attemptRecord,
  attempt_append_receipt: attemptAppendReceipt,
}) {
  validateCurrentAutomaticReservation({
    loaded,
    private_reservation: privateReservation,
    require_status_absent: false,
  });
  const reservationOid =
    privateReservation.reservation_append_receipt.commit_sha;
  const attempt = loaded.records.find((entry) =>
    entry.commit_sha === attemptAppendReceipt.commit_sha);
  const response = loaded.records.find((entry) =>
    entry.commit_sha === privateResponse.response_append_receipt.commit_sha);
  const reviewRequests = loaded.records.filter((entry) =>
    entry.envelope.record_type === "effect-intent" &&
    entry.envelope.kind === "review-request" &&
    entry.envelope.payload.action.reservation_record_oid === reservationOid);
  if (
    loaded.tip_commit_sha !== attemptAppendReceipt.commit_sha ||
    attempt?.envelope.record_type !== "effect-intent" ||
    attempt.envelope.kind !== "effect-attempt"
  ) {
    throw ledgerError(
      "automatic-review-request-attempt-reread-mismatch",
      "retry-zero request attempt is absent from exact stable authority",
    );
  }
  const storedAction = attempt.envelope.payload.action;
  const preparedAction = attemptRecord.payload.action;
  if (
    storedAction.scheduler_observation_record_oid !==
      preparedAction.scheduler_observation_record_oid ||
    storedAction.reservation_record_oid !==
      preparedAction.reservation_record_oid ||
    storedAction.scheduler_action_key !== preparedAction.scheduler_action_key ||
    Date.parse(storedAction.attempt.recorded_at) <
      Date.parse(preparedAction.attempt.recorded_at)
  ) {
    throw ledgerError(
      "automatic-review-request-attempt-action-mismatch",
      "retry-zero request attempt differs from its exact prepared action",
    );
  }
  validateV2GitLedgerRequestAttempt(storedAction.attempt, {
    reservation: privateReservation.reservation,
  });
  if (
    response?.envelope.record_type !== "effect-response" ||
    response.envelope.kind !== "reservation-status-write"
  ) {
    throw ledgerError(
      "automatic-review-request-status-response-missing",
      "retry-zero request attempt lost its reservation status authority",
    );
  }
  if (reviewRequests.length !== 0) {
    throw ledgerError(
      "automatic-review-request-intent-already-present",
      "retry-zero request attempt already has one reachable review intent",
    );
  }
  return deepFreeze(structuredClone(storedAction.attempt));
}

async function automaticReviewRequestControllerAuthority({
  preflight_handle: preflightHandle,
  repository,
  lease_owner: leaseOwnerValue,
}) {
  if (preflightHandle === null) {
    throw ledgerError(
      "automatic-review-request-preflight-required",
      "automatic review request binding requires one branded live preflight",
    );
  }
  const module = await import("./workflow-preflight.mjs");
  if (typeof module.assertV2WorkflowPreflightHandle !== "function") {
    throw ledgerError(
      "automatic-review-request-preflight-unavailable",
      "automatic review request binding cannot validate its controller principal",
    );
  }
  const preflight = module.assertV2WorkflowPreflightHandle(preflightHandle);
  const leaseOwner = normalizeLeaseOwner(leaseOwnerValue);
  const app = structuredClone(preflight.identity_evidence?.app_catalog);
  validateExternalApp(app, "automatic review request controller App catalog");
  if (
    preflight.repository.owner !== repository.owner ||
    preflight.repository.name !== repository.name ||
    preflight.repository.id !== repository.id ||
    preflight.repository.node_id !== repository.node_id ||
    preflight.repository.owner_id !== repository.owner_id ||
    preflight.identity_evidence.triggering_actor_id_claim !==
      leaseOwner.actor_id ||
    app.id !== "15368" || app.slug !== "github-actions"
  ) {
    throw ledgerError(
      "automatic-review-request-controller-authority-mismatch",
      "automatic review request controller principal differs from preflight, OIDC lease, or App catalog",
    );
  }
  return deepFreeze({ actor_id: leaseOwner.actor_id, app });
}

function automaticReviewRequestScopeDigest(value) {
  return runnerDigestCanonical("codex-review-gate-v2-scope", {
    repository_node_id: value.repository.node_id,
    pull_request_node_id: value.pull_request.node_id,
    pull_request_number: value.pull_request.number,
    lifecycle: {
      state: value.pull_request.state,
      merged: value.pull_request.merged,
      merged_at: value.pull_request.merged_at,
      is_draft: value.pull_request.is_draft,
    },
    scope: value.scope,
  });
}

function validateCurrentAutomaticReviewRequestBinding({
  loaded,
  private_intent: privateIntent,
  progress,
}) {
  const intentOid = privateIntent.intent_append_receipt.commit_sha;
  const reviewIntent = loaded.records.find((entry) =>
    entry.commit_sha === intentOid);
  const reviewResponses = loaded.records.filter((entry) =>
    entry.envelope.record_type === "effect-response" &&
    entry.envelope.kind === "review-request" &&
    entry.envelope.effect_id === privateIntent.intent_record.effect_id);
  const bindingIntents = loaded.records.filter((entry) =>
    entry.envelope.record_type === "effect-intent" &&
    entry.envelope.kind === "request-binding" &&
    entry.envelope.payload.action.attempt_record_oid ===
      privateIntent.attempt_append_receipt.commit_sha);
  const bindingResponses = loaded.records.filter((entry) =>
    entry.envelope.record_type === "effect-response" &&
    entry.envelope.kind === "request-binding" &&
    entry.envelope.payload.action.attempt_record_oid ===
      privateIntent.attempt_append_receipt.commit_sha);
  const activeLease = loaded.active_lease;
  if (
    reviewIntent?.envelope.record_type !== "effect-intent" ||
    reviewIntent.envelope.kind !== "review-request" ||
    canonicalJson(reviewIntent.envelope.payload.action) !==
      canonicalJson(privateIntent.intent_record.payload.action) ||
    activeLease === null ||
    activeLease.acquire_commit_sha !==
      privateIntent.lease_authority.acquire_commit_sha ||
    canonicalJson(activeLease.scope) !== canonicalJson(privateIntent.scope) ||
    reviewResponses.length > 1 || bindingIntents.length > 1 ||
    bindingResponses.length > 1
  ) {
    throw ledgerError(
      "stale-automatic-review-request-binding-authority",
      "automatic review request binding lost its exact intent, lease, or unique lineage",
    );
  }
  validateFullDiscoveryScopeLineage(
    activeLease.evaluated_scope_receipt,
    privateIntent.evaluated_scope_receipt,
    activeLease,
  );
  if (progress.review_response_append_receipt === null) {
    if (
      loaded.tip_commit_sha !== intentOid || reviewResponses.length !== 0 ||
      bindingIntents.length !== 0 || bindingResponses.length !== 0
    ) {
      throw ledgerError(
        "automatic-review-request-response-already-present",
        "automatic review request response authority is stale or already consumed",
      );
    }
    return;
  }
  const reviewResponse = reviewResponses[0];
  if (
    reviewResponse?.commit_sha !==
      progress.review_response_append_receipt.commit_sha ||
    canonicalJson(reviewResponse.envelope.payload.receipt) !==
      canonicalJson(progress.review_response_record.payload.receipt)
  ) {
    throw ledgerError(
      "automatic-review-request-response-reread-mismatch",
      "automatic review request response is absent from reachable authority",
    );
  }
  if (progress.request_binding_intent_append_receipt === null) {
    if (
      loaded.tip_commit_sha !== reviewResponse.commit_sha ||
      bindingIntents.length !== 0 || bindingResponses.length !== 0
    ) {
      throw ledgerError(
        "automatic-review-request-binding-intent-already-present",
        "automatic review request binding intent authority is stale or consumed",
      );
    }
    return;
  }
  const bindingIntent = bindingIntents[0];
  if (
    bindingIntent?.commit_sha !==
      progress.request_binding_intent_append_receipt.commit_sha ||
    canonicalJson(bindingIntent.envelope.payload.action) !==
      canonicalJson(progress.request_binding_intent_record.payload.action)
  ) {
    throw ledgerError(
      "automatic-review-request-binding-intent-reread-mismatch",
      "request binding intent is absent from reachable authority",
    );
  }
  if (progress.request_binding_response_append_receipt === null) {
    if (
      loaded.tip_commit_sha !== bindingIntent.commit_sha ||
      bindingResponses.length !== 0
    ) {
      throw ledgerError(
        "automatic-review-request-binding-response-already-present",
        "request binding response authority is stale or consumed",
      );
    }
    return;
  }
  const bindingResponse = bindingResponses[0];
  if (
    bindingResponse?.commit_sha !==
      progress.request_binding_response_append_receipt.commit_sha ||
    canonicalJson(bindingResponse.envelope.payload.receipt) !==
      canonicalJson(progress.request_binding_response_record.payload.receipt)
  ) {
    throw ledgerError(
      "automatic-review-request-binding-response-reread-mismatch",
      "request binding response is absent from reachable authority",
    );
  }
}

function validateRequestBindingLineage(priorRecords, value, repositoryValue) {
  const repository = normalizeRepository(repositoryValue);
  const action = value.payload.action;
  const requests = priorRecords.filter((entry) => {
    const envelope = entry.envelope;
    return envelope.record_type === "effect-response" &&
      envelope.kind === "review-request" &&
      canonicalJson(envelopeScope(envelope)) ===
        canonicalJson(recordOrEnvelopeScope(value)) &&
      canonicalJson(envelope.payload.generation) ===
        canonicalJson(value.payload.generation) &&
      envelope.payload.receipt.carrier_selector.id === action.request_id;
  });
  if (requests.length !== 1) {
    throw ledgerError(
      "request-binding-review-request-required",
      "request binding requires one prior exact review-request response",
    );
  }
  const reservation = priorRecords.find((entry) =>
    entry.commit_sha === action.reservation_record_oid);
  const attempt = priorRecords.find((entry) =>
    entry.commit_sha === action.attempt_record_oid);
  const requestAction = requests[0].envelope.payload.action;
  if (
    reservation?.envelope.record_type !== "effect-intent" ||
    reservation.envelope.kind !== "automatic-request-reservation" ||
    attempt?.envelope.record_type !== "effect-intent" ||
    attempt.envelope.kind !== "effect-attempt" ||
    requestAction.reservation_record_oid !== reservation.commit_sha ||
    requestAction.attempt_record_oid !== attempt.commit_sha ||
    canonicalJson(reservation.envelope.payload.generation) !==
      canonicalJson(value.payload.generation) ||
    canonicalJson(attempt.envelope.payload.generation) !==
      canonicalJson(value.payload.generation)
  ) {
    throw ledgerError(
      "request-binding-attempt-lineage",
      "request binding lacks its exact reservation and pre-effect attempt",
    );
  }
  const selector = requests[0].envelope.payload.receipt.carrier_selector;
  requireExactArtifactUrl(
    value.record_type === "effect-response"
      ? value.payload.receipt.request_url
      : exactArtifactUrl(repository, value.pull_request, selector),
    repository,
    value.pull_request,
    selector,
  );
  if (value.record_type === "effect-response") {
    const requestReceipt = requests[0].envelope.payload.receipt;
    const bindingReceipt = value.payload.receipt;
    if (
      bindingReceipt.controlled !== true ||
      bindingReceipt.request_id !== requestReceipt.request_id ||
      bindingReceipt.request_node_id !== requestReceipt.request_node_id ||
      bindingReceipt.request_url !== requestReceipt.request_url ||
      bindingReceipt.body_sha256 !== requestReceipt.body_sha256 ||
      bindingReceipt.created_at !== requestReceipt.created_at ||
      bindingReceipt.updated_at !== requestReceipt.updated_at ||
      bindingReceipt.raw_body_sha256 !==
        requestReceipt.refetch_raw_body_sha256 ||
      canonicalJson(bindingReceipt.actor) !==
        canonicalJson(requestReceipt.actor)
    ) {
      throw ledgerError(
        "request-binding-receipt-mismatch",
        "request binding differs from its exact POST and refetch authority",
      );
    }
  }
}

function recordOrEnvelopeScope(value) {
  return {
    pull_request: value.pull_request,
    head_ref_oid: value.head_ref_oid,
    base_ref_oid: value.base_ref_oid,
    potential_merge_commit_oid: value.potential_merge_commit_oid,
  };
}

function requireExactArtifactUrl(value, repository, pullRequest, selectorValue) {
  const selector = normalizeCarrierSelector(selectorValue, "artifact URL selector");
  if (value !== exactArtifactUrl(repository, pullRequest, selector)) {
    throw ledgerError(
      "artifact-url-scope",
      "artifact URL does not bind the exact repository, pull request, type, and ID",
    );
  }
}

function exactArtifactUrl(repository, pullRequestValue, selector) {
  const pullRequest = normalizePullRequest(pullRequestValue);
  const prefix = `https://github.com/${repository.owner}/${repository.name}`;
  if (selector.kind === "issue_comment") {
    return `${prefix}/pull/${pullRequest.number}#issuecomment-${selector.id}`;
  }
  if (selector.kind === "pull_request_review") {
    return `${prefix}/pull/${pullRequest.number}#pullrequestreview-${selector.id}`;
  }
  return `${prefix}/pull/${pullRequest.number}#discussion_r${selector.id}`;
}

function exactProviderArtifactUrl(
  repository,
  pullRequestValue,
  selector,
) {
  const pullRequest = normalizePullRequest(pullRequestValue);
  const prefix = `https://github.com/${repository.owner}/${repository.name}`;
  if (selector.kind === "issue_comment") {
    return `${prefix}/pull/${pullRequest.number}#issuecomment-${selector.id}`;
  }
  if (selector.kind === "pull_request_review") {
    return `${prefix}/pull/${pullRequest.number}#pullrequestreview-${selector.id}`;
  }
  return `${prefix}/pull/${pullRequest.number}#discussion_r${selector.id}`;
}

function authoritativeRecordTime(record, authorityTime) {
  const authority = timestamp(authorityTime, "authoritative GitHub server time");
  if (Date.parse(record.server_observed_at) > Date.parse(authority)) {
    throw ledgerError(
      "caller-clock-ahead",
      "caller record time is after the authoritative GitHub ref observation",
    );
  }
  const normalized = structuredClone(record);
  normalized.server_observed_at = authority;
  if (normalized.record_type === "lease-acquire") {
    normalized.payload.acquired_at = authority;
    normalized.payload.expires_at = addSeconds(
      authority,
      normalized.payload.lease_ttl_seconds,
    );
  } else if (normalized.record_type === "lease-release") {
    normalized.payload.released_at = authority;
  } else if (
    normalized.record_type === "effect-intent" &&
    normalized.kind === "effect-attempt"
  ) {
    const attempt = normalized.payload.action.attempt;
    attempt.recorded_at = authority;
    const { attempt_digest: _attemptDigest, ...withoutDigest } = attempt;
    attempt.attempt_digest = runnerDigestCanonical(
      "codex-review-gate-v2-request-attempt",
      withoutDigest,
    );
  }
  return normalized;
}

function requireLeaseWriteWindow(record, activeLease, authorityTime) {
  if (new Set([
    "lease-acquire",
    "candidate-inventory-observation",
    "candidate-dispatch-observation",
  ]).has(record.record_type)) return;
  if (activeLease === null) {
    throw ledgerError("lease-required", "production append lacks an active lease");
  }
  const remaining = Date.parse(activeLease.expires_at) -
    Date.parse(timestamp(authorityTime, "lease write-fence GitHub time"));
  const required = record.record_type === "lease-release"
    ? 1
    : V2_GIT_LEDGER_APPEND_SAFETY_WINDOW_MS;
  if (remaining < required) {
    throw ledgerError(
      "lease-write-window",
      "active lease cannot cover the bounded protected-ref append window",
    );
  }
}

function requireCurrentCapability(loaded, capability) {
  if (loaded.records.at(-1)?.envelope.record_type === "capability-canary") {
    throw ledgerError(
      "capability-recovery-required",
      "production access is blocked behind an unattested capability canary",
    );
  }
  const current = findCurrentCapability(loaded, capability);
  if (current === null) {
    throw ledgerError(
      "capability-attestation-required",
      "production Git ledger access requires a reachable current capability attestation",
    );
  }
  return current;
}

function requireCommitCapacity(currentCount, required, operation) {
  if (currentCount + required > MAX_V2_GIT_LEDGER_COMMITS) {
    throw ledgerError(
      "commit-capacity",
      `${operation} cannot fit within the bounded Git ledger commit cap`,
    );
  }
}

function findCurrentCapability(loaded, capability) {
  const latest = loaded.latest_capability;
  if (latest === null) return null;
  if (
    latest.capability_stable_digest !== stableCapabilityBindingDigest(capability) ||
    latest.protection_receipt_digest !==
      capability.protection.live_ruleset_receipt_digest ||
    canonicalJson(latest.controller_release) !==
      canonicalJson(capability.controller_release)
  ) {
    return null;
  }
  return deepFreeze({
    commit_sha: latest.attestation_commit_sha,
    ...structuredClone(latest),
  });
}

function capabilityBindingDigest(capability) {
  return digestCanonical("codex-review-gate-v2-git-ledger-capability-binding", {
    repository: capability.repository,
    repository_endpoint_receipt: capability.repository_endpoint_receipt,
    ledger_ref: capability.ledger_ref,
    permissions: capability.permissions,
    protection: capability.protection,
    ruleset_receipt: capability.ruleset_receipt,
    protection_receipt: capability.protection_receipt,
    controller_release: capability.controller_release,
    workflow_provenance_policy: capability.workflow_provenance_policy,
    provider_identity_policy: capability.provider_identity_policy,
  });
}

export function projectV2GitLedgerStableControllerReleaseAuthorization(value) {
  const release = normalizeControllerRelease(value);
  return deepFreeze({
    repository: structuredClone(release.repository),
    release_sha: release.release_sha,
    workflow_path: release.workflow_path,
    workflow_ref: release.workflow_ref,
    workflow_sha: release.workflow_sha,
    job_workflow_ref: release.job_workflow_ref,
    job_workflow_sha: release.job_workflow_sha,
    current: true,
  });
}

function projectStableSourceWorkflowAuthorization(value) {
  const source = normalizeSourceWorkflow(
    value,
    "stable capability source_workflow_pin",
  );
  return {
    repository: structuredClone(source.repository),
    workflow_path: source.workflow_path,
    workflow_ref: source.workflow_ref,
    workflow_sha: source.workflow_sha,
    job_workflow_ref: source.job_workflow_ref,
    job_workflow_sha: source.job_workflow_sha,
  };
}

function projectStableCapabilityPermissions(value) {
  assertObject(value, "stable capability permissions");
  const requested = value.contents_write_requested;
  const observed = value.contents_write_observed;
  if (
    (requested !== true && observed !== true) ||
    (requested !== undefined && observed !== undefined) ||
    value.metadata_read_observed !== true ||
    value.observed_only !== true
  ) {
    throw new Error("stable capability permissions are incomplete or ambiguous");
  }
  return {
    contents_write_authorized: true,
    metadata_read_authorized: true,
    observed_only: true,
  };
}

export function projectV2GitLedgerStableCapabilityAuthorization(value) {
  assertObject(value, "stable capability authorization");
  const repository = normalizeRepository(value.repository);
  const ledgerRef = normalizeLedgerRef(value.ledger_ref);
  validateProtectionPolicy(value.protection);
  const ruleset = normalizeLedgerRulesetReceipt(
    value.ruleset_receipt,
    repository,
    ledgerRef,
  );
  const protectionReceipt = normalizeLedgerProtectionReceipt(
    value.protection_receipt,
    ruleset,
  );
  const release = normalizeControllerRelease(value.controller_release);
  validateProtectionBindings(
    value.protection,
    ruleset,
    protectionReceipt,
    release,
  );
  const provenancePolicy = normalizeProvenancePolicy(
    value.workflow_provenance_policy,
  );
  const providerIdentityPolicy = normalizeProviderIdentityPolicy(
    value.provider_identity_policy,
  );
  if (provenancePolicy.repository_owner_id !== repository.owner_id) {
    throw new Error(
      "stable capability OIDC owner differs from the repository authority",
    );
  }
  return deepFreeze({
    repository,
    ledger_ref: ledgerRef,
    permissions: projectStableCapabilityPermissions(value.permissions),
    protection: {
      deletion_blocked: value.protection.deletion_blocked,
      non_fast_forward_blocked: value.protection.non_fast_forward_blocked,
      force_pushes_blocked: value.protection.force_pushes_blocked,
      live_ruleset_receipt_digest:
        value.protection.live_ruleset_receipt_digest,
      source_workflow_pin: projectStableSourceWorkflowAuthorization(
        value.protection.source_workflow_pin,
      ),
      accepted_records_restricted_by_oidc_source:
        value.protection.accepted_records_restricted_by_oidc_source,
    },
    ruleset_receipt: ruleset,
    protection_receipt: protectionReceipt,
    controller_release:
      projectV2GitLedgerStableControllerReleaseAuthorization(release),
    workflow_provenance_policy: provenancePolicy,
    provider_identity_policy: providerIdentityPolicy,
  });
}

export function digestV2GitLedgerStableCapabilityAuthorization(value) {
  return digestCanonical(
    "codex-review-gate-v2-git-ledger-stable-capability-binding",
    projectV2GitLedgerStableCapabilityAuthorization(value),
  );
}

function stableCapabilityBindingDigest(value) {
  return digestV2GitLedgerStableCapabilityAuthorization(value);
}

function findCurrentCapabilityForBootstrapCandidate(loaded, candidate) {
  const latest = loaded.latest_capability;
  if (
    latest === null ||
    latest.capability_stable_digest !== stableCapabilityBindingDigest(candidate)
  ) {
    return null;
  }
  const embedded = validateV2GitLedgerCapabilityReceipt(
    latest.capability_receipt,
    { repository: candidate.repository, ledger_ref: candidate.ledger_ref },
  );
  return deepFreeze({
    commit_sha: latest.attestation_commit_sha,
    capability_receipt: embedded,
    ...structuredClone(latest),
  });
}

function provenanceExpected(capability) {
  return {
    ...capability.workflow_provenance_policy,
    protection_receipt_digest:
      capability.protection.live_ruleset_receipt_digest,
  };
}

function sealLoadedLedger(
  loaded,
  capability,
  authority,
  observedAt,
  provenance,
) {
  const tip = loaded.records.at(-1);
  const publicRecords = loaded.records.map(redactRecordEntry);
  const recordManifest = loaded.records.map((entry) => ({
    record_oid: entry.commit_sha,
    parent_oid: entry.parents[0] ?? null,
    tree_oid: entry.tree_sha,
    envelope_digest: entry.envelope.envelope_digest,
    record_type: entry.envelope.record_type,
    kind: entry.envelope.kind,
    effect_id: entry.envelope.effect_id,
    idempotency_key: entry.envelope.idempotency_key,
    payload_digest: entry.envelope.payload_digest,
    workflow_provenance_receipt_digest:
      entry.envelope.workflow_provenance.receipt_digest,
    workflow_provenance_jti:
      provenanceReplayIdentity(entry.envelope.workflow_provenance),
    server_observed_at: entry.envelope.server_observed_at,
  }));
  const recordManifestDigest = digestCanonical(
    "codex-review-gate-v2-fully-reachable-record-manifest",
    recordManifest,
  );
  const attestation = loaded.records.find((entry) =>
    entry.commit_sha === authority.attestation_commit_sha);
  if (attestation?.envelope.record_type !== "capability-attestation") {
    throw ledgerError(
      "capability-attestation-unreachable",
      "current capability attestation is absent from the stable record manifest",
    );
  }
  const withoutDigest = {
    schema: "codex-review-gate-git-ledger-load-v2",
    schema_version: 1,
    repository: capability.repository,
    repository_endpoint_receipt: capability.repository_endpoint_receipt,
    ledger_ref: capability.ledger_ref,
    tip_commit_sha: loaded.tip_commit_sha,
    tip_tree_sha: tip.tree_sha,
    tip_tree_digest: digestCanonical(
      "codex-review-gate-v2-git-ledger-tip-tree",
      { tree_oid: tip.tree_sha, blob_oid: tip.blob_sha },
    ),
    genesis_commit_sha: loaded.genesis_commit_sha,
    commit_count: loaded.records.length,
    observed_at: observedAt,
    capability: {
      attestation_commit_sha: authority.attestation_commit_sha,
      capability_input_digest: authority.capability_input_digest,
      protection_receipt_digest: authority.protection_receipt_digest,
      controller_release: authority.controller_release,
      provider_identity_policy_catalog_digest:
        capability.provider_identity_policy.catalog_digest,
      provider_identity_policy:
        capability.provider_identity_policy,
    },
    ruleset_receipt: capability.ruleset_receipt,
    protection_receipt: capability.protection_receipt,
    capability_attestation: {
      record_oid: authority.attestation_commit_sha,
      oidc_attestation_digest:
        attestation.envelope.workflow_provenance.receipt_digest,
      workflow_provenance_policy_digest: digestCanonical(
        "codex-review-gate-v2-workflow-provenance-policy",
        capability.workflow_provenance_policy,
      ),
      controller_release_digest: digestCanonical(
        "codex-review-gate-v2-controller-release",
        capability.controller_release,
      ),
      provider_identity_policy_catalog_digest:
        capability.provider_identity_policy.catalog_digest,
    },
    source_authority: {
      source_workflow_pin: capability.protection.source_workflow_pin,
      accepted_records_restricted_by_oidc_source:
        capability.protection.accepted_records_restricted_by_oidc_source,
      live_ruleset_receipt_digest:
        capability.protection.live_ruleset_receipt_digest,
      workflow_provenance_receipt_digest: provenance.receipt_digest,
      workflow_provenance: provenance,
    },
    protection_receipt_digest:
      capability.protection.live_ruleset_receipt_digest,
    active_lease: loaded.active_lease,
    control_comment_binding: loaded.control_comment_binding,
    projection: loaded.projection,
    authority_projection: loaded.authority_projection,
    provenance_reverification: loaded.provenance_reverification,
    provenance_reverification_digest: digestCanonical(
      "codex-review-gate-v2-git-ledger-provenance-reverification-inventory",
      loaded.provenance_reverification,
    ),
    effect_intent_count: loaded.effect_intent_count,
    effect_response_count: loaded.effect_response_count,
    records: publicRecords,
    record_manifest: recordManifest,
    fully_reachable_record_manifest_digest: recordManifestDigest,
    pre_ref: refReceipt(loaded.pre_ref),
    post_ref: refReceipt(loaded.post_ref),
    two_pass_reads: {
      pre: {
        read_index: 1,
        ref_oid: loaded.pre_ref.target_commit_sha,
        server_time: loaded.pre_ref.server_time,
        raw_body_sha256: loaded.pre_ref.raw_body_sha256,
      },
      post: {
        read_index: 2,
        ref_oid: loaded.post_ref.target_commit_sha,
        server_time: loaded.post_ref.server_time,
        raw_body_sha256: loaded.post_ref.raw_body_sha256,
      },
      stable: true,
    },
    stable: true,
  };
  return deepFreeze({
    ...withoutDigest,
    inventory_digest: digestCanonical(
      "codex-review-gate-v2-git-ledger-inventory",
      withoutDigest,
    ),
  });
}

async function createCommitObjects({
  fetchImpl,
  authorization,
  base,
  repoPath,
  envelope,
  parents,
  requestBudget,
}) {
  const bytes = `${canonicalJson(envelope)}\n`;
  if (Buffer.byteLength(bytes, "utf8") > MAX_V2_GIT_LEDGER_BLOB_BYTES) {
    throw ledgerError("blob-size", "Git ledger envelope exceeds its blob cap");
  }
  const blobCapture = await request({
    fetchImpl,
    authorization,
    base,
    method: "POST",
    path: `${repoPath}/git/blobs`,
    body: { content: bytes, encoding: "utf-8" },
    expectedStatus: 201,
    requestBudget,
  });
  const blobSha = responseSha(blobCapture.data, "created blob");
  const treeCapture = await request({
    fetchImpl,
    authorization,
    base,
    method: "POST",
    path: `${repoPath}/git/trees`,
    body: {
      tree: [{
        path: V2_GIT_LEDGER_BLOB_PATH,
        mode: "100644",
        type: "blob",
        sha: blobSha,
      }],
    },
    expectedStatus: 201,
    requestBudget,
  });
  const treeSha = responseSha(treeCapture.data, "created tree");
  if (canonicalTreeSha(blobSha) !== treeSha) {
    throw ledgerError(
      "tree-identity",
      "created Git ledger tree does not match its exact Git object identity",
    );
  }
  const commitCapture = await request({
    fetchImpl,
    authorization,
    base,
    method: "POST",
    path: `${repoPath}/git/commits`,
    body: {
      message: commitMessage(envelope),
      tree: treeSha,
      parents,
      author: {
        ...COMMIT_AUTHOR,
        date: envelope.server_observed_at,
      },
      committer: {
        ...COMMIT_AUTHOR,
        date: envelope.server_observed_at,
      },
    },
    expectedStatus: 201,
    requestBudget,
  });
  const commit = commitCapture.data;
  const commitSha = responseSha(commit, "created commit");
  if (
    commit.tree?.sha !== treeSha || !Array.isArray(commit.parents) ||
    canonicalJson(commit.parents.map((parent) => parent.sha)) !== canonicalJson(parents) ||
    commit.message !== commitMessage(envelope)
  ) {
    throw ledgerError("commit-create-echo", "created commit did not echo tree and parents");
  }
  validateCommitIdentity({
    commit,
    commitSha,
    treeSha,
    parents,
    envelope,
  });
  return {
    blob_sha: blobSha,
    tree_sha: treeSha,
    commit_sha: commitSha,
    object_write_receipts: {
      blob: { object_sha: blobSha, ...captureReceipt(blobCapture) },
      tree: { object_sha: treeSha, ...captureReceipt(treeCapture) },
      commit: { object_sha: commitSha, ...captureReceipt(commitCapture) },
    },
  };
}

async function readRef({
  fetchImpl,
  authorization,
  base,
  repoPath,
  ref,
  refSuffix,
  allowAbsent = false,
  requestBudget,
}) {
  const capture = await request({
    fetchImpl,
    authorization,
    base,
    method: "GET",
    path: `${repoPath}/git/ref/${refSuffix}`,
    expectedStatus: [200, 404],
    requestBudget,
  });
  if (capture.http_status === 404) {
    validateAbsentRefBody(capture.data);
    if (allowAbsent) {
      return deepFreeze({
        absent: true,
        ref,
        server_time: capture.server_time,
        raw_body_sha256: rawDigest(capture.raw_body),
      });
    }
    throw ledgerError("ref-absent", "protected Git ledger ref is absent");
  }
  return parseRefCapture(capture, ref);
}

async function createRef({
  fetchImpl,
  authorization,
  base,
  repoPath,
  ref,
  shaValue,
  requestBudget,
}) {
  const capture = await request({
    fetchImpl,
    authorization,
    base,
    method: "POST",
    path: `${repoPath}/git/refs`,
    body: { ref, sha: shaValue },
    expectedStatus: 201,
    requestBudget,
  });
  const parsed = parseRefCapture(capture, ref);
  if (parsed.target_commit_sha !== shaValue) {
    throw ledgerError("ref-create-echo", "created ref did not echo the genesis commit");
  }
  return capture;
}

async function updateRefStrict(options) {
  const capture = await request({
    fetchImpl: options.fetchImpl,
    authorization: options.authorization,
    base: options.base,
    method: "PATCH",
    path: `${options.repoPath}/git/refs/${options.refSuffix}`,
    body: { sha: options.shaValue, force: false },
    expectedStatus: [200, 409, 422],
    requestBudget: options.requestBudget,
  });
  if (capture.http_status !== 200) {
    validateNonFastForwardConflict(capture);
    const error = ledgerError(
      "non-fast-forward",
      "Git ledger append lost the atomic ref race; the sibling commit is unreachable",
    );
    error.http_status = capture.http_status;
    error.raw_body_sha256 = rawDigest(capture.raw_body);
    throw error;
  }
  const ref = parseRefCapture(capture, options.ref);
  if (ref.target_commit_sha !== options.shaValue) {
    throw ledgerError("ref-update-echo", "updated ref did not echo the appended commit");
  }
  return capture;
}

async function raceUpdateRef(options) {
  const capture = await request({
    fetchImpl: options.fetchImpl,
    authorization: options.authorization,
    base: options.base,
    method: "PATCH",
    path: `${options.repoPath}/git/refs/${options.refSuffix}`,
    body: { sha: options.shaValue, force: false },
    expectedStatus: [200, 409, 422],
    requestBudget: options.requestBudget,
  });
  if (capture.http_status === 200) {
    const ref = parseRefCapture(capture, options.ref);
    if (ref.target_commit_sha !== options.shaValue) {
      throw ledgerError("ref-update-echo", "race winner did not echo its commit");
    }
    return {
      outcome: "winner",
      http_status: 200,
      server_time: capture.server_time,
      raw_body_sha256: rawDigest(capture.raw_body),
    };
  }
  validateNonFastForwardConflict(capture);
  return {
    outcome: "non-fast-forward",
    http_status: capture.http_status,
    server_time: capture.server_time,
    raw_body_sha256: rawDigest(capture.raw_body),
  };
}

function parseRefCapture(capture, expectedRef) {
  assertObject(capture.data, "Git ref response");
  if (capture.data.ref !== expectedRef) {
    throw ledgerError("ref-identity", "Git ref response names another ref");
  }
  assertObject(capture.data.object, "Git ref object");
  if (capture.data.object.type !== "commit") {
    throw ledgerError("ref-target-type", "Git ledger ref must target a commit");
  }
  return deepFreeze({
    ref: expectedRef,
    node_id: boundedString(capture.data.node_id, "Git ref node_id", 256),
    target_commit_sha: sha(capture.data.object.sha, "Git ref target SHA"),
    server_time: capture.server_time,
    raw_body_sha256: rawDigest(capture.raw_body),
  });
}

function validateAbsentRefBody(value) {
  assertObject(value, "absent ref response");
  exactKeys(value, ["message", "documentation_url", "status"], "absent ref response");
  if (
    value.message !== "Not Found" || value.status !== "404" ||
    value.documentation_url !== "https://docs.github.com/rest/git/refs#get-a-reference"
  ) {
    throw ledgerError("unexpected-404", "absent ref response is not the closed GitHub profile");
  }
}

function validateNonFastForwardConflict(capture) {
  const profile = CONFLICT_PROFILES.get(capture.http_status);
  if (profile === undefined || canonicalJson(capture.data) !== canonicalJson(profile)) {
    throw ledgerError(
      "unexpected-ref-conflict",
      "ref update conflict does not match the documented non-fast-forward profile",
    );
  }
}

async function request({
  fetchImpl,
  authorization,
  base,
  method,
  path,
  body = null,
  expectedStatus,
  requestBudget,
}) {
  validateHttpRequestBudget(requestBudget);
  if (requestBudget.request_count >= requestBudget.limits.request_count) {
    throw ledgerError(
      "http-request-cap",
      "Git ledger exhausted its aggregate GitHub request cap",
    );
  }
  requestBudget.request_count += 1;

  const controller = new AbortController();
  let rejectDeadline;
  const deadline = new Promise((resolve, reject) => {
    void resolve;
    rejectDeadline = reject;
  });
  const timer = setTimeout(() => {
    const error = ledgerError(
      "http-timeout",
      "Git ledger GitHub request exceeded its fixed deadline",
    );
    controller.abort(error);
    rejectDeadline(error);
  }, requestBudget.limits.timeout_ms);
  try {
    let response;
    try {
      response = await Promise.race([
        fetchImpl(`${base}${path}`, {
          method,
          redirect: "error",
          signal: controller.signal,
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${authorization}`,
            "x-github-api-version": "2022-11-28",
            ...(body === null ? {} : { "content-type": "application/json" }),
          },
          ...(body === null ? {} : { body: JSON.stringify(body) }),
        }),
        deadline,
      ]);
    } catch (error) {
      if (error?.code === "http-timeout") throw error;
      throw ledgerError(
        "http-request-failed",
        "Git ledger GitHub request failed before a response was read",
        error,
      );
    }
    if (
      response === null || typeof response !== "object" ||
      !Number.isInteger(response.status) ||
      typeof response.headers?.get !== "function" ||
      typeof response.body?.getReader !== "function"
    ) {
      throw ledgerError(
        "invalid-http-response",
        "Git ledger GitHub response is not Response-compatible",
      );
    }
    const expected = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
    if (!expected.includes(response.status)) {
      throw ledgerError(
        "unexpected-http-status",
        `Git ledger expected HTTP ${expected.join(" or ")} and received ${response.status}`,
      );
    }
    const declaredLength = parseContentLength(
      response.headers.get("content-length"),
    );
    if (declaredLength !== null &&
        declaredLength > requestBudget.limits.response_bytes) {
      throw ledgerError(
        "http-response-cap",
        "Git ledger GitHub response exceeds its declared byte cap",
      );
    }
    const serverTime = githubServerTime(response.headers.get("date"));
    const rawBody = await readResponseBodyBounded({
      response,
      deadline,
      controller,
      requestBudget,
    });
    let data;
    try {
      data = JSON.parse(rawBody);
    } catch (error) {
      throw ledgerError("invalid-api-json", "Git ledger API response is not JSON", error);
    }
    return {
      http_status: response.status,
      server_time: serverTime,
      raw_body: rawBody,
      data,
    };
  } finally {
    clearTimeout(timer);
  }
}

function createHttpRequestBudget(limits) {
  return {
    request_count: 0,
    total_response_bytes: 0,
    limits: normalizeHttpLimits(limits),
  };
}

function createProvenanceBudget(timeoutMs) {
  return {
    call_count: 0,
    maximum_calls: MAX_V2_GIT_LEDGER_COMMITS * 8 + 64,
    timeout_ms: normalizeProvenanceTimeout(timeoutMs),
  };
}

function consumeProvenanceBudget(budget) {
  if (
    budget === null || typeof budget !== "object" ||
    !Number.isSafeInteger(budget.call_count) || budget.call_count < 0 ||
    !Number.isSafeInteger(budget.maximum_calls) || budget.maximum_calls < 1 ||
    !Number.isSafeInteger(budget.timeout_ms) || budget.timeout_ms < 1 ||
    budget.timeout_ms > V2_GIT_LEDGER_PROVENANCE_TIMEOUT_MS
  ) {
    throw new TypeError("Git ledger provenance verifier budget is invalid");
  }
  if (budget.call_count >= budget.maximum_calls) {
    throw ledgerError(
      "provenance-call-cap",
      "Git ledger exhausted its bounded provenance verifier calls",
    );
  }
  budget.call_count += 1;
  const controller = new AbortController();
  let rejectDeadline;
  const deadline = new Promise((resolve, reject) => {
    void resolve;
    rejectDeadline = reject;
  });
  const timer = setTimeout(() => {
    const error = ledgerError(
      "provenance-timeout",
      "Git ledger provenance verifier exceeded its fixed deadline",
    );
    controller.abort(error);
    rejectDeadline(error);
  }, budget.timeout_ms);
  return {
    signal: controller.signal,
    deadline,
    timeout_ms: budget.timeout_ms,
    finish() {
      clearTimeout(timer);
    },
  };
}

function normalizeProvenanceTimeout(value) {
  const normalized = positiveInteger(value, "Git ledger provenance timeout");
  if (normalized > V2_GIT_LEDGER_PROVENANCE_TIMEOUT_MS) {
    throw new Error("Git ledger provenance timeout may only tighten its hard maximum");
  }
  return normalized;
}

function validateHttpRequestBudget(value) {
  if (
    value === null || typeof value !== "object" || Array.isArray(value) ||
    !Number.isSafeInteger(value.request_count) || value.request_count < 0 ||
    !Number.isSafeInteger(value.total_response_bytes) ||
    value.total_response_bytes < 0 || value.limits === null ||
    typeof value.limits !== "object"
  ) {
    throw new TypeError("Git ledger HTTP budget is invalid");
  }
}

function normalizeHttpLimits(value) {
  assertObject(value, "Git ledger HTTP limits");
  exactKeys(value, [
    "request_count", "response_bytes", "total_response_bytes", "timeout_ms",
  ], "Git ledger HTTP limits");
  const normalized = {
    request_count: positiveInteger(value.request_count,
      "Git ledger HTTP limits.request_count"),
    response_bytes: positiveInteger(value.response_bytes,
      "Git ledger HTTP limits.response_bytes"),
    total_response_bytes: positiveInteger(value.total_response_bytes,
      "Git ledger HTTP limits.total_response_bytes"),
    timeout_ms: positiveInteger(value.timeout_ms,
      "Git ledger HTTP limits.timeout_ms"),
  };
  if (
    normalized.request_count > MAX_V2_GIT_LEDGER_HTTP_REQUESTS ||
    normalized.response_bytes > MAX_V2_GIT_LEDGER_HTTP_RESPONSE_BYTES ||
    normalized.total_response_bytes > MAX_V2_GIT_LEDGER_HTTP_TOTAL_BYTES ||
    normalized.timeout_ms > V2_GIT_LEDGER_HTTP_TIMEOUT_MS
  ) {
    throw new Error("Git ledger HTTP limits may only tighten hard maxima");
  }
  return deepFreeze(normalized);
}

async function readResponseBodyBounded({
  response,
  deadline,
  controller,
  requestBudget,
}) {
  const reader = response.body.getReader();
  const chunks = [];
  let responseBytes = 0;
  try {
    while (true) {
      let read;
      try {
        read = await Promise.race([reader.read(), deadline]);
      } catch (error) {
        if (error?.code === "http-timeout") throw error;
        throw ledgerError(
          "http-body-failed",
          "Git ledger GitHub response body could not be read",
          error,
        );
      }
      if (
        read === null || typeof read !== "object" ||
        typeof read.done !== "boolean"
      ) {
        throw ledgerError(
          "invalid-http-response",
          "Git ledger GitHub response stream returned an invalid chunk",
        );
      }
      if (read.done) break;
      if (!(read.value instanceof Uint8Array)) {
        throw ledgerError(
          "invalid-http-response",
          "Git ledger GitHub response stream chunk is not bytes",
        );
      }
      responseBytes += read.value.byteLength;
      if (responseBytes > requestBudget.limits.response_bytes) {
        controller.abort();
        void reader.cancel().catch(() => {});
        throw ledgerError(
          "http-response-cap",
          "Git ledger GitHub response exceeds its streamed byte cap",
        );
      }
      if (
        requestBudget.total_response_bytes + read.value.byteLength >
        requestBudget.limits.total_response_bytes
      ) {
        controller.abort();
        void reader.cancel().catch(() => {});
        throw ledgerError(
          "http-total-byte-cap",
          "Git ledger exhausted its aggregate GitHub response byte cap",
        );
      }
      requestBudget.total_response_bytes += read.value.byteLength;
      chunks.push(Buffer.from(
        read.value.buffer,
        read.value.byteOffset,
        read.value.byteLength,
      ));
    }
  } finally {
    reader.releaseLock?.();
  }
  if (responseBytes === 0) {
    throw ledgerError(
      "http-response-cap",
      "Git ledger GitHub response body must be non-empty",
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true })
      .decode(Buffer.concat(chunks, responseBytes));
  } catch (error) {
    throw ledgerError(
      "invalid-api-utf8",
      "Git ledger GitHub response is not valid UTF-8",
      error,
    );
  }
}

function parseContentLength(value) {
  if (value === null) return null;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw ledgerError(
      "invalid-content-length",
      "Git ledger GitHub response Content-Length is invalid",
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw ledgerError(
      "invalid-content-length",
      "Git ledger GitHub response Content-Length is outside the safe range",
    );
  }
  return parsed;
}

function validateInternalEnvelopeFields(value) {
  if (value.record_type === "genesis") {
    if (
      value.sequence !== 0 || value.predecessor_commit_sha !== null ||
      value.pull_request !== null || value.head_ref_oid !== null ||
      value.base_ref_oid !== null || value.potential_merge_commit_oid !== null ||
      value.kind !== null || value.effect_id !== null || value.idempotency_key !== null ||
      value.control_comment_binding !== null || value.lease !== null
    ) {
      throw new Error("Git ledger genesis has non-genesis fields");
    }
    assertObject(value.payload, "genesis payload");
    exactKeys(value.payload, [
      "sealed", "bootstrap_candidate_digest", "bootstrap_candidate",
    ], "genesis payload");
    if (value.payload.sealed !== true) throw new Error("Git ledger genesis is not sealed");
    digest(value.payload.bootstrap_candidate_digest,
      "genesis bootstrap_candidate_digest");
    validateEmbeddedBootstrapCandidate(
      value.payload,
      value.repository,
      value.ledger_ref,
    );
    return;
  }
  if (value.record_type === "capability-canary") {
    assertNullProductionScope(value, "capability canary");
    assertObject(value.payload, "capability canary payload");
    exactKeys(value.payload, [
      "contender", "genesis_commit_sha", "race_parent_commit_sha",
      "bootstrap_candidate_digest", "bootstrap_candidate",
    ], "capability canary payload");
    if (!new Set(["alpha", "beta"]).has(value.payload.contender)) {
      throw new Error("capability contender is invalid");
    }
    sha(value.payload.genesis_commit_sha, "canary genesis_commit_sha");
    sha(value.payload.race_parent_commit_sha, "canary race_parent_commit_sha");
    digest(value.payload.bootstrap_candidate_digest,
      "canary bootstrap_candidate_digest");
    validateEmbeddedBootstrapCandidate(
      value.payload,
      value.repository,
      value.ledger_ref,
    );
    return;
  }
  if (value.record_type === "capability-attestation") {
    assertNullProductionScope(value, "capability attestation");
    validateAttestationPayload(value.payload);
    if (
      canonicalJson(value.source_workflow) !== canonicalJson(sourceWorkflow(
        normalizeControllerRelease(value.payload.controller_release),
      ))
    ) {
      throw new Error("capability attestation source workflow binding is invalid");
    }
    return;
  }
  validateRecordTypeFields(value);
}

function validateAttestationPayload(payload) {
  assertObject(payload, "capability attestation payload");
  exactKeys(payload, [
    "genesis_commit_sha",
    "race_parent_commit_sha",
    "bootstrap_candidate_digest",
    "write_observation_receipt",
    "capability_input_digest",
    "capability_stable_digest",
    "capability_receipt",
    "protection_receipt_digest",
    "controller_release",
    "contenders",
    "winner_commit_sha",
    "race_final_ref_reread",
    "recovered_unattested_canary_commits",
  ], "capability attestation payload");
  sha(payload.genesis_commit_sha, "attestation genesis_commit_sha");
  sha(payload.race_parent_commit_sha, "attestation race_parent_commit_sha");
  digest(payload.bootstrap_candidate_digest,
    "attestation bootstrap_candidate_digest");
  const writeObservation = validateWriteObservationReceipt(
    payload.write_observation_receipt,
  );
  if (
    writeObservation.bootstrap_candidate_digest !==
      payload.bootstrap_candidate_digest ||
    writeObservation.race_parent_commit_sha !== payload.race_parent_commit_sha
  ) {
    throw new Error("attestation write observation binds another bootstrap race");
  }
  digest(payload.capability_input_digest, "attestation capability_input_digest");
  digest(payload.capability_stable_digest,
    "attestation capability_stable_digest");
  const capability = validateEmbeddedCapability(payload);
  if (
    capability.bootstrap_candidate_digest !==
      payload.bootstrap_candidate_digest ||
    capability.permissions.observation_receipt_digest !==
      writeObservation.receipt_digest ||
    stableCapabilityBindingDigest(capability) !==
      payload.capability_stable_digest
  ) {
    throw new Error("attestation capability does not bind its write observation");
  }
  digest(payload.protection_receipt_digest, "attestation protection_receipt_digest");
  normalizeControllerRelease(payload.controller_release);
  if (!Array.isArray(payload.contenders) || payload.contenders.length !== 2) {
    throw new Error("capability attestation requires exactly two contenders");
  }
  const labels = new Set();
  for (const contender of payload.contenders) {
    assertObject(contender, "capability contender receipt");
    exactKeys(contender, [
      "label", "commit_sha", "outcome", "http_status", "server_time",
      "raw_body_sha256",
    ], "capability contender receipt");
    if (!new Set(["alpha", "beta"]).has(contender.label) || labels.has(contender.label)) {
      throw new Error("capability contender labels are invalid or repeated");
    }
    labels.add(contender.label);
    sha(contender.commit_sha, "capability contender commit_sha");
    if (contender.outcome === "winner") {
      if (contender.http_status !== 200) throw new Error("winner status must be 200");
    } else if (contender.outcome === "non-fast-forward") {
      if (!CONFLICT_PROFILES.has(contender.http_status)) {
        throw new Error("loser status is not a documented non-fast-forward conflict");
      }
    } else {
      throw new Error("capability contender outcome is invalid");
    }
    timestamp(contender.server_time, "capability contender server_time");
    digest(contender.raw_body_sha256, "capability contender raw_body_sha256");
  }
  sha(payload.winner_commit_sha, "attestation winner_commit_sha");
  validateRefReceipt(payload.race_final_ref_reread);
  if (
    !Array.isArray(payload.recovered_unattested_canary_commits) ||
    payload.recovered_unattested_canary_commits.length > 32
  ) {
    throw new Error("capability recovery canary list is invalid");
  }
  const recovered = new Set();
  for (const commitSha of payload.recovered_unattested_canary_commits) {
    const current = sha(commitSha, "recovered capability canary commit");
    if (recovered.has(current)) {
      throw new Error("capability recovery repeats a canary commit");
    }
    recovered.add(current);
  }
}

function validateEmbeddedCapability(payload, repository = null, ledgerRef = null) {
  const capability = validateV2GitLedgerCapabilityReceipt(
    payload.capability_receipt,
    repository === null ? null : {
      repository,
      ledger_ref: ledgerRef,
    },
  );
  if (capabilityBindingDigest(capability) !== payload.capability_input_digest) {
    throw new Error("embedded capability receipt binding digest is invalid");
  }
  return capability;
}

function validateEmbeddedBootstrapCandidate(
  payload,
  repository = null,
  ledgerRef = null,
) {
  const candidate = validateV2GitLedgerBootstrapInput(
    payload.bootstrap_candidate,
    repository === null ? null : {
      repository,
      ledger_ref: ledgerRef,
    },
  );
  if (candidate.input_digest !== payload.bootstrap_candidate_digest) {
    throw new Error("embedded bootstrap candidate digest is invalid");
  }
  return candidate;
}

function assertNullProductionScope(value, label) {
  if (
    value.pull_request !== null || value.head_ref_oid !== null ||
    value.base_ref_oid !== null || value.potential_merge_commit_oid !== null ||
    value.kind !== null || value.effect_id !== null || value.idempotency_key !== null ||
    value.control_comment_binding !== null || value.lease !== null
  ) {
    throw new Error(`${label} has production-only fields`);
  }
}

function validateRecordTypeFields(value) {
  if (value.record_type === "candidate-inventory-observation") {
    if (
      value.pull_request !== null || value.head_ref_oid !== null ||
      value.base_ref_oid !== null ||
      value.potential_merge_commit_oid !== null || value.kind !== null ||
      value.effect_id !== null || value.idempotency_key !== null ||
      value.control_comment_binding !== null || value.lease !== null
    ) {
      throw new Error("candidate inventory record has PR-effect fields");
    }
    validateV2GitLedgerCandidateInventoryPayload(value.payload);
    return;
  }
  if (value.record_type === "candidate-dispatch-observation") {
    if (
      value.pull_request !== null || value.head_ref_oid !== null ||
      value.base_ref_oid !== null ||
      value.potential_merge_commit_oid !== null || value.kind !== null ||
      value.effect_id !== null || value.idempotency_key !== null ||
      value.control_comment_binding !== null || value.lease !== null
    ) {
      throw new Error("candidate dispatch record has PR-effect fields");
    }
    validateV2GitLedgerCandidateDispatchPayload(value.payload);
    return;
  }
  normalizePullRequest(value.pull_request);
  sha(value.head_ref_oid, "production head_ref_oid");
  sha(value.base_ref_oid, "production base_ref_oid");
  nullableSha(value.potential_merge_commit_oid, "production potential_merge_commit_oid");
  if (value.record_type === "lease-acquire") {
    requireNullEffectFields(value, "lease acquire");
    if (value.lease !== null) throw new Error("lease acquire cannot bind itself");
    validateLeaseAcquirePayload(value.payload);
  } else if (value.record_type === "lease-release") {
    requireNullEffectFields(value, "lease release");
    normalizeLeaseBinding(value.lease, { required: true });
    validateLeaseReleasePayload(value.payload);
  } else {
    const kind = boundedString(value.kind, "effect kind", 128);
    if (!EFFECT_KINDS.has(kind)) {
      throw new Error("effect kind is outside the closed Git ledger kind set");
    }
    boundedString(value.effect_id, "effect_id", 256);
    boundedString(value.idempotency_key, "idempotency_key", 256);
    const control = normalizeControlCommentBinding(value.control_comment_binding);
    const lease = normalizeLeaseBinding(value.lease, { required: true });
    if (kind === "control-comment-create") {
      if (value.record_type === "effect-intent" && control !== null) {
        throw new Error("control-comment-create intent must precede its comment binding");
      }
      if (value.record_type === "effect-response" && control === null) {
        throw new Error("control-comment-create response requires the exact new comment binding");
      }
    }
    if (kind === "control-comment-update" && control === null) {
      throw new Error("control-comment-update requires an exact comment binding");
    }
    if (
      new Set([
        "automatic-request-reservation", "scheduler-observation",
        "effect-attempt",
      ]).has(kind) && value.record_type !== "effect-intent"
    ) {
      throw new Error(`${kind} is one authoritative intent record`);
    }
    validateV2GitLedgerEffectPayload(value.payload, {
      record_type: value.record_type,
      kind,
      scope: recordScope(value),
      predecessor_commit_sha: value.predecessor_commit_sha,
      control_comment_binding: control,
      server_observed_at: value.server_observed_at,
      repository: value.repository,
      lease,
    });
  }
}

export function validateV2GitLedgerRunnerReservation(value, expected = null) {
  assertObject(value, "runner reservation");
  exactKeys(value, [
    "schema", "schema_version", "repository", "pull_request",
    "epoch_head_sha", "ordinal", "generation_id", "generation_kind",
    "generation_index", "recovery_authority", "scheduler_intent_id",
    "intent_id", "intent_digest", "attempt_id", "body", "created_at",
    "automatic", "consumed", "pre_scope_digest", "status_ledger_binding",
    "reservation_digest",
  ], "runner reservation");
  if (
    value.schema !== V2_GIT_LEDGER_REQUEST_RESERVATION_SCHEMA ||
    value.schema_version !== 1
  ) {
    throw new TypeError("runner reservation has an unsupported schema");
  }
  assertObject(value.repository, "runner reservation.repository");
  exactKeys(value.repository, ["owner", "name", "node_id"],
    "runner reservation.repository");
  boundedString(value.repository.owner, "runner reservation repository.owner", 256);
  boundedString(value.repository.name, "runner reservation repository.name", 256);
  boundedString(value.repository.node_id,
    "runner reservation repository.node_id", 256);
  const pullRequest = normalizePullRequest(value.pull_request);
  const head = sha(value.epoch_head_sha, "runner reservation epoch_head_sha");
  const ordinal = positiveInteger(value.ordinal, "runner reservation ordinal");
  if (ordinal > 3 || value.generation_id !== `automatic:${ordinal}` ||
      value.generation_kind !== "automatic" ||
      value.generation_index !== ordinal) {
    throw new Error("runner reservation generation is not one automatic budget slot");
  }
  validateRunnerRecoveryAuthority(
    value.recovery_authority,
    ordinal,
    value.created_at,
  );
  boundedString(value.scheduler_intent_id,
    "runner reservation scheduler_intent_id", 512);
  if (!RUNNER_INTENT_ID.test(value.intent_id)) {
    throw new TypeError("runner reservation intent_id is invalid");
  }
  digest(value.intent_digest, "runner reservation intent_digest");
  if (!RUNNER_ATTEMPT_ID.test(value.attempt_id)) {
    throw new TypeError("runner reservation attempt_id is invalid");
  }
  if (value.body !== "@codex review" ||
      value.automatic !== true || value.consumed !== true) {
    throw new Error("runner reservation is not one consumed automatic request");
  }
  const createdAt = timestamp(value.created_at, "runner reservation created_at");
  digest(value.pre_scope_digest, "runner reservation pre_scope_digest");
  const binding = validateRunnerHeadLedgerBinding(
    value.status_ledger_binding,
    {
      repository_node_id: value.repository.node_id,
      pull_request_node_id: pullRequest.node_id,
      head_ref_oid: head,
      observed_not_after: createdAt,
    },
  );
  if (binding.automatic_request_count !== ordinal - 1) {
    throw new Error("runner reservation ordinal does not follow its head ledger");
  }
  const expectedIntentDigest = runnerDigestCanonical(
    "codex-review-gate-v2-request-intent",
    {
      repository_node_id: value.repository.node_id,
      pull_request_node_id: pullRequest.node_id,
      head_ref_oid: head,
      ordinal,
      generation_id: value.generation_id,
      scheduler_intent_id: value.scheduler_intent_id,
      body: value.body,
      created_at: createdAt,
      pre_scope_digest: value.pre_scope_digest,
      ledger_digest: binding.ledger_digest,
      recovery_authority: value.recovery_authority,
    },
  );
  if (
    value.intent_digest !== expectedIntentDigest ||
    value.intent_id !==
      `v2-request:${expectedIntentDigest.slice("sha256:".length)}`
  ) {
    throw new Error("runner reservation intent identity is invalid");
  }
  const expectedAttemptId = `v2-attempt:${runnerDigestCanonical(
    "codex-review-gate-v2-request-attempt-id",
    { intent_id: value.intent_id, intent_digest: value.intent_digest },
  ).slice("sha256:".length)}`;
  if (value.attempt_id !== expectedAttemptId) {
    throw new Error("runner reservation attempt identity is invalid");
  }
  digest(value.reservation_digest, "runner reservation reservation_digest");
  const { reservation_digest: _digest, ...withoutDigest } = value;
  if (
    value.reservation_digest !== runnerDigestCanonical(
      "codex-review-gate-v2-request-reservation",
      withoutDigest,
    )
  ) {
    throw new Error("runner reservation digest is invalid");
  }
  if (expected !== null) {
    if (expected.repository !== undefined && (
      value.repository.owner !== expected.repository.owner ||
      value.repository.name !== expected.repository.name ||
      value.repository.node_id !== expected.repository.node_id
    )) {
      throw new Error("runner reservation belongs to another repository");
    }
    if (expected.scope !== undefined && (
      canonicalJson(pullRequest) !==
        canonicalJson(expected.scope.pull_request) ||
      head !== expected.scope.head_ref_oid
    )) {
      throw new Error("runner reservation belongs to another review epoch");
    }
    if (expected.generation !== undefined &&
        value.generation_id !== expected.generation.generation_id) {
      throw new Error("runner reservation generation differs from its effect");
    }
  }
  return value;
}

export function validateV2GitLedgerRequestAttempt(value, expected = null) {
  assertObject(value, "runner request attempt");
  exactKeys(value, [
    "schema", "schema_version", "attempt_id", "reservation_digest",
    "scheduler_intent_id", "recorded_at", "recorded_before_effect",
    "retry_limit", "attempt_digest",
  ], "runner request attempt");
  if (
    value.schema !== V2_GIT_LEDGER_REQUEST_ATTEMPT_SCHEMA ||
    value.schema_version !== 1 ||
    !RUNNER_ATTEMPT_ID.test(value.attempt_id) ||
    value.recorded_before_effect !== true || value.retry_limit !== 0
  ) {
    throw new Error("runner request attempt is not closed retry-zero authority");
  }
  digest(value.reservation_digest, "runner request attempt reservation_digest");
  boundedString(value.scheduler_intent_id,
    "runner request attempt scheduler_intent_id", 512);
  timestamp(value.recorded_at, "runner request attempt recorded_at");
  digest(value.attempt_digest, "runner request attempt attempt_digest");
  const { attempt_digest: _digest, ...withoutDigest } = value;
  if (
    value.attempt_digest !== runnerDigestCanonical(
      "codex-review-gate-v2-request-attempt",
      withoutDigest,
    )
  ) {
    throw new Error("runner request attempt digest is invalid");
  }
  if (expected !== null) {
    const reservation = validateV2GitLedgerRunnerReservation(
      expected.reservation,
    );
    if (
      value.attempt_id !== reservation.attempt_id ||
      value.reservation_digest !== reservation.reservation_digest ||
      value.scheduler_intent_id !== reservation.scheduler_intent_id ||
      Date.parse(value.recorded_at) < Date.parse(reservation.created_at)
    ) {
      throw new Error("runner request attempt differs from its reservation");
    }
  }
  return value;
}

export function validateV2GitLedgerSchedulerObservation(
  value,
  expected = null,
) {
  assertObject(value, "scheduler observation");
  exactKeys(value, [
    "schema", "schema_version", "prior_authority_digest",
    "prior_scheduling", "prior_head_ledger", "scheduler_evaluation",
    "scheduler_plan", "scheduler_plan_digest", "status_plan",
    "status_plan_digest", "snapshot_server_time",
    "initial_runner_state_authority",
  ], "scheduler observation");
  if (
    value.schema !== V2_GIT_LEDGER_SCHEDULER_OBSERVATION_SCHEMA ||
    value.schema_version !== 1
  ) {
    throw new Error("scheduler observation has an unsupported schema");
  }
  digest(value.prior_authority_digest,
    "scheduler observation prior_authority_digest");
  const boundary = timestamp(
    value.snapshot_server_time,
    "scheduler observation snapshot_server_time",
  );
  const scheduling = validateRunnerScheduling(
    value.prior_scheduling,
    boundary,
    expected,
  );
  validateRunnerHeadLedger(value.prior_head_ledger, {
    ...(expected ?? {}),
    observed_not_after: boundary,
  });
  if (value.initial_runner_state_authority !== null) {
    const initial = validateV2GitLedgerInitialRunnerStateAuthority(
      value.initial_runner_state_authority,
    );
    if (
      value.prior_authority_digest !== initial.prior_authority_digest ||
      canonicalJson(value.prior_scheduling) !==
        canonicalJson(initial.scheduling) ||
      canonicalJson(value.prior_head_ledger) !==
        canonicalJson(initial.head_ledger)
    ) {
      throw new Error(
        "scheduler observation differs from its initial runner authority",
      );
    }
  }
  const evaluation = validateRunnerSchedulerSnapshot(
    value.scheduler_evaluation,
    {
      epoch_id: scheduling.epoch.id,
      epoch_started_at: scheduling.epoch.started_at,
      observed_not_after: boundary,
      require_complete: true,
    },
    "scheduler observation evaluation",
  );
  if (
    evaluation.observed_at !== boundary ||
    canonicalJson(evaluation.no_start_candidate) !==
      canonicalJson(scheduling.no_start_candidate)
  ) {
    throw new Error(
      "scheduler observation evaluation differs from its exact snapshot input",
    );
  }
  const schedulerPlan = validateRunnerSchedulerPlan(value.scheduler_plan);
  const expectedPlan = planV2Actions({
    schema: V2_SCHEDULER_SCHEMA,
    schema_version: V2_SCHEDULER_SCHEMA_VERSION,
    trigger: scheduling.trigger,
    now: boundary,
    public_wait_supported: scheduling.public_wait_supported,
    status_target_mode: scheduling.status_target_mode,
    epoch: scheduling.epoch,
    evaluation,
    complete_snapshots: scheduling.complete_snapshots,
    status: {
      exact_sha_context_count: scheduling.status.exact_sha_context_count,
      latest_idempotency_key: scheduling.status.latest_idempotency_key,
    },
    applied_action_keys: scheduling.applied_action_keys,
  });
  if (canonicalJson(schedulerPlan) !== canonicalJson(expectedPlan)) {
    throw new Error("scheduler observation plan is not the closed scheduler result");
  }
  digest(value.scheduler_plan_digest,
    "scheduler observation scheduler_plan_digest");
  if (
    value.scheduler_plan_digest !== digestCanonical(
      "codex-review-gate-v2-scheduler-plan",
      schedulerPlan,
    )
  ) {
    throw new Error("scheduler observation plan digest is invalid");
  }
  const statusPlan = validateRunnerStatusPlan(
    value.status_plan,
    evaluation,
    schedulerPlan,
  );
  if (statusPlan.mode !== scheduling.status_target_mode) {
    throw new Error(
      "scheduler observation status plan changes its persisted target mode",
    );
  }
  digest(value.status_plan_digest, "scheduler observation status_plan_digest");
  if (
    value.status_plan_digest !== digestCanonical(
      "codex-review-gate-v2-status-plan",
      statusPlan,
    )
  ) {
    throw new Error("scheduler observation status plan digest is invalid");
  }
  return value;
}

function validateRunnerRecoveryAuthority(value, ordinal, createdAtValue) {
  if (ordinal === 1) {
    if (value !== null) {
      throw new Error("first automatic reservation cannot carry recovery authority");
    }
    return null;
  }
  assertObject(value, "runner reservation recovery_authority");
  exactKeys(value, [
    "prior_generation_id", "finding_ids", "closure_ids",
    "closure_observed_at",
  ], "runner reservation recovery_authority");
  if (value.prior_generation_id !== `automatic:${ordinal - 1}`) {
    throw new Error("runner recovery authority skips a generation");
  }
  const findings = validateUniqueBoundedStrings(
    value.finding_ids,
    "runner recovery authority finding_ids",
    256,
  );
  const closures = validateUniqueBoundedStrings(
    value.closure_ids,
    "runner recovery authority closure_ids",
    256,
  );
  if (findings.length === 0 || findings.length !== closures.length) {
    throw new Error("runner recovery authority lacks exact finding closures");
  }
  if (
    Date.parse(timestamp(value.closure_observed_at,
      "runner recovery authority closure_observed_at")) >=
      Date.parse(timestamp(createdAtValue,
        "runner recovery authority reservation time"))
  ) {
    throw new Error("runner recovery closure does not precede its reservation");
  }
  return value;
}

function validateRunnerHeadLedgerBinding(value, expected) {
  assertObject(value, "runner head-ledger binding");
  exactKeys(value, [
    "head_ref_oid", "automatic_request_count", "exact_sha_context_count",
    "latest_status_idempotency_key", "bound_attempt_ids", "observed_at",
    "ledger_digest",
  ], "runner head-ledger binding");
  const headLedger = {
    schema: V2_GIT_LEDGER_HEAD_LEDGER_SCHEMA,
    schema_version: 1,
    repository_node_id: expected.repository_node_id,
    pull_request_node_id: expected.pull_request_node_id,
    head_ref_oid: value.head_ref_oid,
    automatic_request_count: value.automatic_request_count,
    exact_sha_context_count: value.exact_sha_context_count,
    latest_status_idempotency_key: value.latest_status_idempotency_key,
    bound_attempt_ids: value.bound_attempt_ids,
    observed_at: value.observed_at,
  };
  validateRunnerHeadLedger(headLedger, expected);
  digest(value.ledger_digest, "runner head-ledger binding ledger_digest");
  if (
    value.ledger_digest !== runnerDigestCanonical(
      "codex-review-gate-v2-head-ledger",
      headLedger,
    )
  ) {
    throw new Error("runner head-ledger binding digest is invalid");
  }
  return value;
}

function validateRunnerHeadLedger(value, expected = null) {
  assertObject(value, "runner head ledger");
  exactKeys(value, [
    "schema", "schema_version", "repository_node_id",
    "pull_request_node_id", "head_ref_oid", "automatic_request_count",
    "exact_sha_context_count", "latest_status_idempotency_key",
    "bound_attempt_ids", "observed_at",
  ], "runner head ledger");
  if (
    value.schema !== V2_GIT_LEDGER_HEAD_LEDGER_SCHEMA ||
    value.schema_version !== 1
  ) {
    throw new Error("runner head ledger has an unsupported schema");
  }
  boundedString(value.repository_node_id, "runner head ledger repository_node_id", 256);
  boundedString(value.pull_request_node_id,
    "runner head ledger pull_request_node_id", 256);
  sha(value.head_ref_oid, "runner head ledger head_ref_oid");
  integerBetween(value.automatic_request_count, 0, 3,
    "runner head ledger automatic_request_count");
  integerBetween(value.exact_sha_context_count, 0, 1000,
    "runner head ledger exact_sha_context_count");
  if (value.latest_status_idempotency_key !== null) {
    boundedString(value.latest_status_idempotency_key,
      "runner head ledger latest_status_idempotency_key", 1024);
  }
  validateRunnerAttemptIds(value.bound_attempt_ids,
    "runner head ledger bound_attempt_ids");
  const observedAt = timestamp(value.observed_at,
    "runner head ledger observed_at");
  if (expected !== null) {
    if (
      expected.repository_node_id !== undefined &&
      value.repository_node_id !== expected.repository_node_id ||
      expected.pull_request_node_id !== undefined &&
      value.pull_request_node_id !== expected.pull_request_node_id ||
      expected.head_ref_oid !== undefined &&
      value.head_ref_oid !== expected.head_ref_oid
    ) {
      throw new Error("runner head ledger belongs to another scope");
    }
    if (
      expected.observed_not_after !== undefined &&
      Date.parse(observedAt) > Date.parse(expected.observed_not_after)
    ) {
      throw new Error("runner head ledger is newer than its authority boundary");
    }
  }
  return value;
}

function validateRunnerScheduling(value, boundaryValue, expected = null) {
  assertObject(value, "runner scheduling");
  exactKeys(value, [
    "trigger", "public_wait_supported", "status_target_mode", "run_identity", "epoch",
    "complete_snapshots", "status", "applied_action_keys",
    "no_start_candidate",
  ], "runner scheduling");
  if (!new Set(["initial", "timer", "schedule", "provider-event", "manual"])
    .has(value.trigger) || typeof value.public_wait_supported !== "boolean" ||
    !new Set(["head", "test-merge-with-head-sentinel"])
      .has(value.status_target_mode)) {
    throw new Error("runner scheduling trigger or wait policy is invalid");
  }
  const boundary = timestamp(boundaryValue, "runner scheduling boundary");
  const runIdentity = validateRunnerRunIdentity(
    value.run_identity,
    "runner scheduling run_identity",
  );
  assertObject(value.epoch, "runner scheduling epoch");
  exactKeys(value.epoch, [
    "id", "started_at", "controlled_request", "automatic_request",
  ], "runner scheduling epoch");
  if (!RUNNER_EPOCH_ID.test(value.epoch.id)) {
    throw new Error("runner scheduling epoch id is invalid");
  }
  const startedAt = timestamp(value.epoch.started_at,
    "runner scheduling epoch.started_at");
  if (Date.parse(startedAt) > Date.parse(boundary)) {
    throw new Error("runner scheduling epoch starts after its boundary");
  }
  if (expected?.repository_node_id !== undefined) {
    const derived = runnerEpochId(
      expected.repository_node_id,
      expected.pull_request_node_id,
      expected.head_ref_oid,
    );
    if (value.epoch.id !== derived) {
      throw new Error("runner scheduling epoch does not bind the exact scope");
    }
  }
  if (value.epoch.controlled_request !== null) {
    const requestObserved = validateRunnerControlledRequest(
      value.epoch.controlled_request,
      boundary,
    ).bound_at;
    if (
      Date.parse(requestObserved) < Date.parse(startedAt) ||
      Date.parse(requestObserved) > Date.parse(boundary)
    ) {
      throw new Error("runner scheduling request observation is out of bounds");
    }
  }
  validateRunnerAutomaticRequest(
    value.epoch.automatic_request,
    startedAt,
    boundary,
  );
  void runIdentity;
  if (!Array.isArray(value.complete_snapshots) ||
      value.complete_snapshots.length > MAX_V2_GIT_LEDGER_COMMITS) {
    throw new TypeError("runner scheduling complete snapshots are unbounded");
  }
  const snapshotIds = new Set();
  let priorObserved = null;
  for (const [index, snapshotValue] of value.complete_snapshots.entries()) {
    const snapshot = validateRunnerSchedulerSnapshot(snapshotValue, {
      epoch_id: value.epoch.id,
      epoch_started_at: startedAt,
      observed_not_after: boundary,
      require_complete: true,
    }, `runner scheduling complete_snapshots[${index}]`);
    if (snapshotIds.has(snapshot.snapshot_id) ||
        (priorObserved !== null &&
          Date.parse(snapshot.observed_at) < Date.parse(priorObserved))) {
      throw new Error("runner scheduling snapshot history is duplicate or reordered");
    }
    snapshotIds.add(snapshot.snapshot_id);
    priorObserved = snapshot.observed_at;
  }
  assertObject(value.status, "runner scheduling status");
  exactKeys(value.status, [
    "exact_sha_context_count", "latest_idempotency_key",
    "head_sentinel_receipt",
  ], "runner scheduling status");
  integerBetween(value.status.exact_sha_context_count, 0, 1000,
    "runner scheduling status exact_sha_context_count");
  if (value.status.latest_idempotency_key !== null) {
    boundedString(value.status.latest_idempotency_key,
      "runner scheduling status latest_idempotency_key", 1024);
  }
  if (value.status.head_sentinel_receipt !== null) {
    validateRunnerHeadSentinel(value.status.head_sentinel_receipt, boundary);
  }
  validateUniqueBoundedStrings(
    value.applied_action_keys,
    "runner scheduling applied_action_keys",
    MAX_V2_GIT_LEDGER_COMMITS,
  );
  if (value.no_start_candidate !== null) {
    validateRunnerNoStartCandidate(value.no_start_candidate, boundary,
      "runner scheduling no_start_candidate");
  }
  return value;
}

function validateRunnerAutomaticRequest(value, startedAt, boundary) {
  assertObject(value, "runner automatic request");
  exactKeys(value, [
    "state", "intent_id", "intent_persisted_at", "effect_attempted_at",
  ], "runner automatic request");
  if (!new Set(["available", "intent-persisted", "effect-attempted"])
    .has(value.state)) {
    throw new Error("runner automatic request state is invalid");
  }
  if (value.state === "available") {
    if (
      value.intent_id !== null || value.intent_persisted_at !== null ||
      value.effect_attempted_at !== null
    ) {
      throw new Error("available runner request already carries consumption authority");
    }
    return;
  }
  boundedString(value.intent_id, "runner automatic request intent_id", 512);
  const persisted = timestamp(value.intent_persisted_at,
    "runner automatic request intent_persisted_at");
  if (Date.parse(persisted) < Date.parse(startedAt) ||
      Date.parse(persisted) > Date.parse(boundary)) {
    throw new Error("runner automatic request persistence time is out of bounds");
  }
  if (value.state === "intent-persisted") {
    if (value.effect_attempted_at !== null) {
      throw new Error("intent-persisted runner request already has an attempt");
    }
    return;
  }
  const attempted = timestamp(value.effect_attempted_at,
    "runner automatic request effect_attempted_at");
  if (Date.parse(attempted) < Date.parse(persisted) ||
      Date.parse(attempted) > Date.parse(boundary)) {
    throw new Error("runner automatic request attempt time is out of bounds");
  }
}

function validateRunnerRunIdentity(value, label) {
  assertObject(value, label);
  exactKeys(value, ["run_id", "run_attempt"], label);
  return {
    run_id: decimal(value.run_id, `${label}.run_id`),
    run_attempt: positiveInteger(value.run_attempt, `${label}.run_attempt`),
  };
}

function validateRunnerControlledRequest(value, boundaryValue) {
  assertObject(value, "runner controlled request");
  exactKeys(value, [
    "request_id", "bound_at", "binding_record_oid",
    "binding_receipt_digest",
  ], "runner controlled request");
  decimal(value.request_id, "runner controlled request request_id");
  const boundAt = timestamp(value.bound_at, "runner controlled request bound_at");
  if (Date.parse(boundAt) > Date.parse(boundaryValue)) {
    throw new Error("runner controlled request follows its scheduler boundary");
  }
  sha(value.binding_record_oid,
    "runner controlled request binding_record_oid");
  digest(value.binding_receipt_digest,
    "runner controlled request binding_receipt_digest");
  return value;
}

function validateRunnerSchedulerSnapshot(value, expected, label) {
  assertObject(value, label);
  exactKeys(value, [
    "epoch_id", "decision", "complete", "snapshot_id",
    "snapshot_fingerprint", "observed_at", "provider_activity_fingerprint",
    "no_start_candidate", "run_id", "run_attempt",
  ], label);
  if (value.epoch_id !== expected.epoch_id ||
      !new Set([
        "not-selected", "pending", "clean", "findings", "inconclusive",
        "skipped-unavailable", "blocked-configuration", "blocked-input",
      ]).has(value.decision) || typeof value.complete !== "boolean" ||
      (expected.require_complete === true && value.complete !== true)) {
    throw new Error(`${label} is not one closed evaluation`);
  }
  boundedString(value.snapshot_id, `${label}.snapshot_id`, 512);
  boundedString(value.snapshot_fingerprint,
    `${label}.snapshot_fingerprint`, 512);
  boundedString(value.provider_activity_fingerprint,
    `${label}.provider_activity_fingerprint`, 512);
  decimal(value.run_id, `${label}.run_id`);
  positiveInteger(value.run_attempt, `${label}.run_attempt`);
  const observed = timestamp(value.observed_at, `${label}.observed_at`);
  if (
    Date.parse(observed) < Date.parse(expected.epoch_started_at) ||
    Date.parse(observed) > Date.parse(expected.observed_not_after)
  ) {
    throw new Error(`${label} time is outside its review epoch`);
  }
  if (value.no_start_candidate !== null) {
    validateRunnerNoStartCandidate(
      value.no_start_candidate,
      observed,
      `${label}.no_start_candidate`,
    );
  }
  if (value.decision === "skipped-unavailable" &&
      value.no_start_candidate === null) {
    throw new Error(`${label} skipped-unavailable lacks a no-start candidate`);
  }
  return value;
}

function validateRunnerNoStartCandidate(value, boundary, label) {
  assertObject(value, label);
  exactKeys(value, [
    "artifact_id", "artifact_digest", "scope_fingerprint",
    "lifecycle_fingerprint", "first_seen_at",
  ], label);
  boundedString(value.artifact_id, `${label}.artifact_id`, 512);
  digest(value.artifact_digest, `${label}.artifact_digest`);
  boundedString(value.scope_fingerprint, `${label}.scope_fingerprint`, 512);
  boundedString(value.lifecycle_fingerprint,
    `${label}.lifecycle_fingerprint`, 512);
  if (Date.parse(timestamp(value.first_seen_at, `${label}.first_seen_at`)) >
      Date.parse(boundary)) {
    throw new Error(`${label}.first_seen_at follows its observation`);
  }
}

function validateRunnerHeadSentinel(value, boundary) {
  assertObject(value, "runner head sentinel");
  exactKeys(value, ["sha", "context", "state", "status_id", "observed_at"],
    "runner head sentinel");
  sha(value.sha, "runner head sentinel sha");
  if (value.context !== "codex/github-review-gate" ||
      !new Set(["pending", "failure", "error"]).has(value.state)) {
    throw new Error("runner head sentinel is outside the closed status profile");
  }
  decimal(value.status_id, "runner head sentinel status_id");
  if (Date.parse(timestamp(value.observed_at,
    "runner head sentinel observed_at")) > Date.parse(boundary)) {
    throw new Error("runner head sentinel follows its authority boundary");
  }
}

function validateRunnerSchedulerPlan(value) {
  assertObject(value, "runner scheduler plan");
  exactKeys(value, [
    "schema", "schema_version", "actions", "due_at",
    "automatic_retry_stopped", "event_wakeup_hints_are_advisory",
    "freshness_assurance",
  ], "runner scheduler plan");
  if (
    value.schema !== V2_SCHEDULER_SCHEMA ||
    value.schema_version !== V2_SCHEDULER_SCHEMA_VERSION ||
    !Array.isArray(value.actions) ||
    typeof value.automatic_retry_stopped !== "boolean" ||
    value.event_wakeup_hints_are_advisory !== true ||
    value.freshness_assurance !== "point-in-time"
  ) {
    throw new Error("runner scheduler plan is not closed v2 output");
  }
  if (value.due_at !== null) timestamp(value.due_at, "runner scheduler plan due_at");
  const keys = new Set();
  for (const [index, action] of value.actions.entries()) {
    validateRunnerSchedulerAction(action, `runner scheduler plan action[${index}]`);
    if (keys.has(action.idempotency_key)) {
      throw new Error("runner scheduler plan repeats an action key");
    }
    keys.add(action.idempotency_key);
  }
  return value;
}

function validateRunnerSchedulerAction(value, label) {
  assertObject(value, label);
  if (value.kind === "evaluate_snapshot") {
    exactKeys(value, ["kind", "idempotency_key", "mode", "reason"], label);
    if (!new Set(["ordinary", "evaluate-only"]).has(value.mode)) {
      throw new Error(`${label} mode is invalid`);
    }
    boundedString(value.reason, `${label}.reason`, 256);
  } else if (value.kind === "persist_auto_request_intent") {
    exactKeys(value, [
      "kind", "idempotency_key", "intent_id",
      "consumes_automatic_reservation",
    ], label);
    boundedString(value.intent_id, `${label}.intent_id`, 512);
    if (value.consumes_automatic_reservation !== true) {
      throw new Error(`${label} does not consume its reservation`);
    }
  } else if (value.kind === "post_review_request") {
    exactKeys(value, [
      "kind", "idempotency_key", "intent_id",
      "depends_on_idempotency_key", "retry_limit",
      "record_attempt_before_effect",
    ], label);
    boundedString(value.intent_id, `${label}.intent_id`, 512);
    boundedString(value.depends_on_idempotency_key,
      `${label}.depends_on_idempotency_key`, 1024);
    if (value.retry_limit !== 0 || value.record_attempt_before_effect !== true) {
      throw new Error(`${label} is not retry-zero with a durable pre-attempt`);
    }
  } else if (value.kind === "publish_status") {
    exactKeys(value, [
      "kind", "idempotency_key", "decision", "snapshot_id",
      "required_write_slots", "reason",
    ], label);
    boundedString(value.snapshot_id, `${label}.snapshot_id`, 512);
    if (!new Set([
      "pending", "clean", "findings", "inconclusive",
      "skipped-unavailable", "blocked-configuration", "blocked-input",
    ]).has(value.decision)) {
      throw new Error(`${label} decision is invalid`);
    }
    integerBetween(value.required_write_slots, 1, 2,
      `${label}.required_write_slots`);
    if (!new Set(["evaluation-decision", "inconclusive-timeout"])
      .has(value.reason)) {
      throw new Error(`${label} reason is outside the closed status authority`);
    }
    if (
      value.reason === "inconclusive-timeout" &&
      value.decision !== "inconclusive"
    ) {
      throw new Error(`${label} timeout reason requires inconclusive authority`);
    }
  } else if (value.kind === "record_head_ledger") {
    exactKeys(value, [
      "kind", "idempotency_key", "decision", "reason",
      "exact_sha_context_count", "required_write_slots",
    ], label);
    if (value.decision !== "blocked-input" ||
        value.reason !== "status-cap-exhausted") {
      throw new Error(`${label} is not the closed status-cap record`);
    }
    integerBetween(value.exact_sha_context_count, 0, 1000,
      `${label}.exact_sha_context_count`);
    integerBetween(value.required_write_slots, 1, 2,
      `${label}.required_write_slots`);
  } else {
    throw new Error(`${label} kind is outside the closed scheduler action set`);
  }
  boundedString(value.idempotency_key, `${label}.idempotency_key`, 1024);
}

function validateRunnerStatusPlan(value, evaluation, schedulerPlan) {
  assertObject(value, "runner status plan");
  const suppressed = Object.hasOwn(value, "suppressed_writes");
  exactKeys(value, suppressed
    ? [
        "mode", "decision", "writes", "terminal_cutover",
        "freshness_assurance", "suppressed_writes", "suppression_reason",
      ]
    : [
        "mode", "decision", "writes", "terminal_cutover",
        "freshness_assurance",
      ], "runner status plan");
  if (
    !new Set(["head", "test-merge-with-head-sentinel"]).has(value.mode) ||
    value.decision !== evaluation.decision ||
    !Array.isArray(value.writes) ||
    typeof value.terminal_cutover !== "boolean" ||
    value.freshness_assurance !== "point-in-time"
  ) {
    throw new Error("runner status plan is not exact closed output");
  }
  for (const [index, write] of value.writes.entries()) {
    validateRunnerStatusWrite(write, `runner status plan writes[${index}]`);
  }
  if (value.mode === "head" && (
    value.terminal_cutover !== false ||
    value.writes.some((write) =>
      write.role !== "head-sentinel" || write.state === "success")
  )) {
    throw new Error("head-mode status plan is limited to non-success sentinels");
  }
  const publish = schedulerPlan.actions.find((action) =>
    action.kind === "publish_status");
  if (suppressed) {
    if (value.writes.length !== 0 || value.terminal_cutover !== false ||
        !Array.isArray(value.suppressed_writes)) {
      throw new Error("runner suppressed status plan has public write authority");
    }
    for (const [index, write] of value.suppressed_writes.entries()) {
      validateRunnerStatusWrite(write,
        `runner status plan suppressed_writes[${index}]`);
    }
    boundedString(value.suppression_reason,
      "runner status plan suppression_reason", 256);
    if (
      value.mode === "head" &&
      new Set(["clean", "skipped-unavailable"]).has(value.decision) &&
      value.suppression_reason !== "suppressed-unsupported-terminal-target"
    ) {
      throw new Error("runner head-mode suppression reason is not authoritative");
    }
    if (publish !== undefined &&
        (value.mode !== "head" ||
          !new Set(["clean", "skipped-unavailable"]).has(value.decision) ||
          value.suppression_reason !== "suppressed-unsupported-terminal-target")) {
      throw new Error("runner status suppression conflicts with scheduler authority");
    }
  } else if (value.writes.length > 0 && (
    publish === undefined || publish.decision !== value.decision ||
    publish.snapshot_id !== evaluation.snapshot_id ||
    publish.required_write_slots < value.writes.length
  )) {
    throw new Error("runner status plan lacks its scheduler publication authority");
  }
  return value;
}

function validateRunnerStatusWrite(value, label) {
  assertObject(value, label);
  exactKeys(value, [
    "role", "sha", "context", "state", "reason", "idempotency_key",
  ], label);
  if (!new Set(["head-sentinel", "primary-terminal"]).has(value.role) ||
      value.context !== "codex/github-review-gate" ||
      !new Set(["pending", "success", "failure", "error"]).has(value.state) ||
      (value.role === "head-sentinel" && value.state === "success")) {
    throw new Error(`${label} is outside the closed status profile`);
  }
  sha(value.sha, `${label}.sha`);
  boundedString(value.reason, `${label}.reason`, 256);
  boundedString(value.idempotency_key, `${label}.idempotency_key`, 1024);
}

function validateRunnerAttemptIds(value, label) {
  if (!Array.isArray(value) || value.length > 1000) {
    throw new TypeError(`${label} is not a bounded array`);
  }
  const seen = new Set();
  for (const attemptId of value) {
    if (!RUNNER_ATTEMPT_ID.test(attemptId) || seen.has(attemptId)) {
      throw new Error(`${label} contains an invalid or duplicate attempt`);
    }
    seen.add(attemptId);
  }
}

function runnerEpochId(repositoryNodeId, pullRequestNodeId, headRefOid) {
  return `v2-head:${runnerDigestCanonical("codex-review-gate-v2-head-epoch", {
    repository_node_id: repositoryNodeId,
    pull_request_node_id: pullRequestNodeId,
    head_ref_oid: headRefOid,
  }).slice("sha256:".length)}`;
}

export function validateV2GitLedgerEffectPayload(payload, expected) {
  assertObject(payload, "effect payload");
  exactKeys(payload, [
    "schema", "schema_version", "phase", "kind", "scope", "generation",
    "ordinal", "predecessor_commit_sha", "action", "intent_commit_sha",
    "receipt",
  ], "effect payload");
  if (
    payload.schema !== V2_GIT_LEDGER_EFFECT_PAYLOAD_SCHEMA ||
    payload.schema_version !== 1
  ) {
    throw new Error("effect payload has an unsupported schema");
  }
  const phase = payload.phase;
  if (!new Set(["intent", "response"]).has(phase) ||
      phase !== expected.record_type.slice("effect-".length)) {
    throw new Error("effect payload phase differs from its record type");
  }
  if (payload.kind !== expected.kind) {
    throw new Error("effect payload kind differs from its envelope");
  }
  const scope = normalizeEffectScope(payload.scope);
  if (canonicalJson(scope) !== canonicalJson(expected.scope)) {
    throw new Error("effect payload scope differs from its envelope");
  }
  const generation = normalizeEffectGeneration(payload.generation, scope);
  const ordinal = positiveInteger(payload.ordinal, "effect payload ordinal");
  const predecessor = sha(
    payload.predecessor_commit_sha,
    "effect payload predecessor_commit_sha",
  );
  if (predecessor !== expected.predecessor_commit_sha) {
    throw new Error("effect payload predecessor differs from its envelope");
  }
  validateEffectGenerationUse(payload.kind, generation, ordinal);
  validateEffectAction(
    payload.kind,
    payload.action,
    generation,
    scope,
    expected.server_observed_at,
  );
  if (phase === "intent") {
    if (payload.intent_commit_sha !== null || payload.receipt !== null) {
      throw new Error("effect intent cannot contain response authority");
    }
  } else {
    sha(payload.intent_commit_sha, "effect response intent_commit_sha");
    validateEffectReceipt(
      payload.kind,
      payload.receipt,
      payload.action,
      generation,
      expected.control_comment_binding,
      scope,
      expected.repository,
      expected.lease,
      expected.server_observed_at,
    );
    validateEffectReceiptTemporalBoundary(
      payload.kind,
      payload.receipt,
      expected.server_observed_at,
    );
  }
  return payload;
}

function normalizeEffectGeneration(value, scope) {
  if (value === null) return null;
  assertObject(value, "effect payload generation");
  exactKeys(value, [
    "generation_id", "kind", "index", "review_epoch_digest",
  ], "effect payload generation");
  const match = GENERATION_ID.exec(value.generation_id);
  if (match === null) throw new TypeError("effect generation_id is invalid");
  if (!new Set(["automatic", "manual"]).has(value.kind)) {
    throw new TypeError("effect generation kind is invalid");
  }
  const index = positiveInteger(value.index, "effect generation index");
  if (match[1] !== value.kind || Number(match[2]) !== index) {
    throw new Error("effect generation identity, kind, and index differ");
  }
  if (value.kind === "automatic" && index > 3) {
    throw new Error("automatic generation exceeds the closed budget cap");
  }
  digest(value.review_epoch_digest, "effect generation review_epoch_digest");
  if (value.review_epoch_digest !== reviewEpochDigest(scope)) {
    throw new Error("effect generation does not bind the exact review epoch");
  }
  return value;
}

function validateEffectGenerationUse(kind, generation, ordinal) {
  const required = new Set([
    "automatic-request-reservation", "reservation-status-write",
    "review-request", "request-binding",
    "artifact-binding", "no-start-observation", "effect-attempt",
    "scheduler-state",
  ]);
  if ((required.has(kind) && generation === null) ||
      (!required.has(kind) && generation !== null)) {
    throw new Error("effect generation presence does not match its kind");
  }
  if (generation !== null && generation.index !== ordinal) {
    throw new Error("effect ordinal differs from its generation index");
  }
  if (generation === null && ordinal !== 1) {
    throw new Error("non-generation effect ordinal must be one");
  }
  if (kind === "automatic-request-reservation" &&
      generation.kind !== "automatic") {
    throw new Error("automatic reservation requires an automatic generation");
  }
  if (new Set(["review-request", "artifact-binding"]).has(kind) &&
      generation.kind !== "automatic") {
    throw new Error(`${kind} requires an automatic generation`);
  }
}

function validateEffectAction(kind, action, generation, scope, boundaryValue) {
  assertObject(action, `${kind} action`);
  if (kind === "control-comment-create") {
    exactKeys(action, [
      "method", "body_digest", "pre_comment_inventory_digest",
    ], `${kind} action`);
    if (action.method !== "POST") throw new Error("control comment create must POST");
    digest(action.body_digest, `${kind} body_digest`);
    digest(action.pre_comment_inventory_digest,
      `${kind} pre_comment_inventory_digest`);
  } else if (kind === "control-comment-update") {
    exactKeys(action, [
      "method", "comment_id", "prior_raw_body_sha256", "body_digest",
      "pre_comment_inventory_digest",
    ], `${kind} action`);
    if (action.method !== "PATCH") throw new Error("control comment update must PATCH");
    decimal(action.comment_id, `${kind} comment_id`);
    digest(action.prior_raw_body_sha256, `${kind} prior_raw_body_sha256`);
    digest(action.body_digest, `${kind} body_digest`);
    digest(action.pre_comment_inventory_digest,
      `${kind} pre_comment_inventory_digest`);
  } else if (kind === "automatic-request-reservation") {
    exactKeys(action, [
      "scheduler_observation_record_oid", "scheduler_action_key",
      "post_scheduler_action_key", "reservation", "reservation_digest",
      "budget_limit",
    ], `${kind} action`);
    sha(action.scheduler_observation_record_oid,
      `${kind} scheduler_observation_record_oid`);
    boundedString(action.scheduler_action_key,
      `${kind} scheduler_action_key`, 1024);
    boundedString(action.post_scheduler_action_key,
      `${kind} post_scheduler_action_key`, 1024);
    const reservation = validateV2GitLedgerRunnerReservation(
      action.reservation,
      { scope, generation },
    );
    digest(action.reservation_digest, `${kind} reservation_digest`);
    if (
      action.reservation_digest !== reservation.reservation_digest ||
      Date.parse(reservation.created_at) > Date.parse(boundaryValue) ||
      action.budget_limit !== 3
    ) {
      throw new Error("automatic reservation budget limit must be three");
    }
  } else if (kind === "scheduler-observation") {
    const observation = validateV2GitLedgerSchedulerObservation(action);
    if (Date.parse(observation.snapshot_server_time) > Date.parse(boundaryValue)) {
      throw new Error("scheduler observation follows its GitHub record boundary");
    }
  } else if (kind === "effect-attempt") {
    exactKeys(action, [
      "scheduler_observation_record_oid", "reservation_record_oid",
      "scheduler_action_key", "attempt",
    ], `${kind} action`);
    sha(action.scheduler_observation_record_oid,
      `${kind} scheduler_observation_record_oid`);
    sha(action.reservation_record_oid, `${kind} reservation_record_oid`);
    boundedString(action.scheduler_action_key,
      `${kind} scheduler_action_key`, 1024);
    const attempt = validateV2GitLedgerRequestAttempt(action.attempt);
    if (Date.parse(attempt.recorded_at) > Date.parse(boundaryValue)) {
      throw new Error("effect attempt follows its GitHub record boundary");
    }
  } else if (kind === "reservation-status-write") {
    exactKeys(action, [
      "reservation_record_oid", "generation_id", "ordinal", "target_sha",
      "context", "state", "description_digest",
    ], `${kind} action`);
    sha(action.reservation_record_oid, `${kind} reservation_record_oid`);
    if (
      action.generation_id !== generation.generation_id ||
      action.ordinal !== generation.index ||
      sha(action.target_sha, `${kind} target_sha`) !== scope.head_ref_oid ||
      action.context !==
        `codex/github-review-gate-reservation/${generation.index}` ||
      action.context === "codex/github-review-gate" ||
      action.state !== "pending"
    ) {
      throw new Error("reservation status intent is outside its non-required profile");
    }
    digest(action.description_digest, `${kind} description_digest`);
  } else if (kind === "review-request") {
    exactKeys(action, [
      "method", "request_body_sha256", "scheduler_observation_record_oid",
      "reservation_record_oid", "attempt_record_oid", "scheduler_action_key",
    ], `${kind} action`);
    if (action.method !== "POST") throw new Error("review request must POST");
    digest(action.request_body_sha256, `${kind} request_body_sha256`);
    sha(action.scheduler_observation_record_oid,
      `${kind} scheduler_observation_record_oid`);
    sha(action.reservation_record_oid, `${kind} reservation_record_oid`);
    sha(action.attempt_record_oid, `${kind} attempt_record_oid`);
    boundedString(action.scheduler_action_key,
      `${kind} scheduler_action_key`, 1024);
  } else if (kind === "request-binding") {
    exactKeys(action, [
      "generation_id", "request_id", "reservation_record_oid",
      "attempt_record_oid",
    ], `${kind} action`);
    if (action.generation_id !== generation.generation_id) {
      throw new Error("request binding action generation differs from its authority");
    }
    decimal(action.request_id, `${kind} request_id`);
    sha(action.reservation_record_oid, `${kind} reservation_record_oid`);
    sha(action.attempt_record_oid, `${kind} attempt_record_oid`);
  } else if (kind === "artifact-binding") {
    exactKeys(action, [
      "generation_id", "request_binding_record_oid", "request_id",
      "request_node_id", "artifact_selector", "expected_actor",
      "expected_app",
    ], `${kind} action`);
    if (action.generation_id !== generation.generation_id) {
      throw new Error("artifact binding action generation differs from its authority");
    }
    sha(action.request_binding_record_oid,
      `${kind} request_binding_record_oid`);
    decimal(action.request_id, `${kind} request_id`);
    boundedString(action.request_node_id, `${kind} request_node_id`, 256);
    normalizeCarrierSelector(action.artifact_selector,
      `${kind} artifact_selector`);
    validateExternalActor(action.expected_actor, `${kind} expected_actor`);
    validateExternalApp(action.expected_app, `${kind} expected_app`);
    validateCodexProvider(
      action.expected_actor,
      action.expected_app,
      `${kind} expected provider`,
    );
  } else if (kind === "no-start-observation") {
    exactKeys(action, [
      "generation_id", "request_id", "request_run_id", "request_created_at",
      "carrier_selector",
    ], `${kind} action`);
    if (action.generation_id !== generation.generation_id) {
      throw new Error("no-start action generation differs from its authority");
    }
    decimal(action.request_id, `${kind} request_id`);
    decimal(action.request_run_id, `${kind} request_run_id`);
    timestamp(action.request_created_at, `${kind} request_created_at`);
    normalizeCarrierSelector(action.carrier_selector, `${kind} carrier_selector`);
  } else if (kind === "thread-resolution-observation") {
    exactKeys(action, ["thread_id", "head_oid"], `${kind} action`);
    boundedString(action.thread_id, `${kind} thread_id`, 256);
    if (sha(action.head_oid, `${kind} head_oid`) !== scope.head_ref_oid) {
      throw new Error("thread resolution action binds another head");
    }
  } else if (kind === "status-write") {
    exactKeys(action, [
      "mode", "target_sha", "role", "context", "state",
      "description_digest",
      "scheduler_observation_record_oid", "scheduler_action_key",
      "scheduler_plan_digest", "status_plan_digest", "status_write_index",
      "status_write_count",
    ], `${kind} action`);
    const targetSha = sha(action.target_sha, `${kind} target_sha`);
    if (!new Set(["head", "test-merge-with-head-sentinel"])
      .has(action.mode)) {
      throw new Error("status-write mode is outside the closed target profile");
    }
    if (!new Set(["head-sentinel", "primary-terminal"]).has(action.role)) {
      throw new Error("status-write role is outside the closed target profile");
    }
    if (
      (action.mode === "head" &&
        (action.role !== "head-sentinel" || targetSha !== scope.head_ref_oid ||
          action.state === "success")) ||
      (action.mode === "test-merge-with-head-sentinel" &&
        action.role === "head-sentinel" &&
        (targetSha !== scope.head_ref_oid || action.state === "success")) ||
      (action.mode === "test-merge-with-head-sentinel" &&
        action.role === "primary-terminal" &&
        (scope.potential_merge_commit_oid === null ||
          targetSha !== scope.potential_merge_commit_oid))
    ) {
      throw new Error("status-write target does not match its closed role");
    }
    if (action.context !== "codex/github-review-gate" ||
        !new Set(["pending", "success", "failure", "error"])
          .has(action.state)) {
      throw new Error("status-write action is outside the closed status profile");
    }
    digest(action.description_digest, `${kind} description_digest`);
    sha(action.scheduler_observation_record_oid,
      `${kind} scheduler_observation_record_oid`);
    boundedString(action.scheduler_action_key,
      `${kind} scheduler_action_key`, 1024);
    digest(action.scheduler_plan_digest, `${kind} scheduler_plan_digest`);
    digest(action.status_plan_digest, `${kind} status_plan_digest`);
    const writeCount = integerBetween(action.status_write_count, 1, 2,
      `${kind} status_write_count`);
    const writeIndex = nonnegativeInteger(action.status_write_index,
      `${kind} status_write_index`);
    if (writeIndex >= writeCount) {
      throw new Error("status-write index is outside its authorized plan");
    }
  } else if (kind === "sticky-comment") {
    exactKeys(action, [
      "method", "comment_id", "body_digest", "pre_comment_inventory_digest",
    ], `${kind} action`);
    if (!new Set(["POST", "PATCH"]).has(action.method) ||
        (action.method === "POST" && action.comment_id !== null) ||
        (action.method === "PATCH" && action.comment_id === null)) {
      throw new Error("sticky-comment method/comment identity is invalid");
    }
    if (action.comment_id !== null) decimal(action.comment_id, `${kind} comment_id`);
    digest(action.body_digest, `${kind} body_digest`);
    digest(action.pre_comment_inventory_digest,
      `${kind} pre_comment_inventory_digest`);
  } else if (kind === "scheduler-state") {
    exactKeys(action, [
      "prior_generation_id", "next_generation_id",
    ], `${kind} action`);
    const prior = GENERATION_ID.exec(action.prior_generation_id);
    if (action.next_generation_id !== generation.generation_id ||
        prior === null || prior[1] !== "automatic" ||
        Number(prior[2]) + 1 !== generation.index ||
        generation.kind !== "automatic") {
      throw new Error("scheduler-state generation transition is invalid");
    }
  }
}

function validateEffectReceipt(
  kind,
  receipt,
  action,
  generation,
  control,
  scope,
  repository,
  lease,
  recordBoundary,
) {
  assertObject(receipt, `${kind} receipt`);
  if (new Set(["control-comment-create", "control-comment-update"])
    .has(kind)) {
    exactKeys(receipt, [
      "http_status", "server_time", "raw_body_sha256", "comment", "actor",
      "app", "pre_comment_inventory_digest", "post_comment_inventory_digest",
    ], `${kind} receipt`);
    const expectedStatus = kind === "control-comment-create" ? 201 : 200;
    if (receipt.http_status !== expectedStatus ||
        canonicalJson(normalizeControlCommentBinding(receipt.comment, {
          required: true,
        })) !== canonicalJson(control) ||
        (kind === "control-comment-update" &&
          receipt.comment.comment_id !== action.comment_id)) {
      throw new Error("control comment response receipt is not exact");
    }
    validateExternalActor(receipt.actor, `${kind} receipt.actor`);
    validateExternalApp(receipt.app, `${kind} receipt.app`);
    validateControllerCommentIdentity(receipt.actor, receipt.app, kind);
    timestamp(receipt.server_time, `${kind} receipt.server_time`);
    digest(receipt.raw_body_sha256, `${kind} receipt.raw_body_sha256`);
    if (receipt.pre_comment_inventory_digest !==
        action.pre_comment_inventory_digest) {
      throw new Error("control comment inventory preimage differs from its intent");
    }
    digest(receipt.pre_comment_inventory_digest,
      `${kind} receipt.pre_comment_inventory_digest`);
    digest(receipt.post_comment_inventory_digest,
      `${kind} receipt.post_comment_inventory_digest`);
  } else if (kind === "automatic-request-reservation") {
    exactKeys(receipt, ["committed", "server_time"], `${kind} receipt`);
    if (receipt.committed !== true) throw new Error("reservation receipt is not committed");
    timestamp(receipt.server_time, `${kind} receipt.server_time`);
  } else if (kind === "reservation-status-write") {
    exactKeys(receipt, [
      "http_status", "status_id", "target_sha", "context", "state",
      "description_digest", "created_at", "updated_at", "creator",
      "post_server_time", "post_raw_body_sha256", "refetch_server_time",
      "refetch_page_count", "refetch_item_count", "refetch_match_count",
      "refetch_inventory_digest", "refetch_pages",
    ], `${kind} receipt`);
    validateV2GitLedgerReservationStatusResponseReceipt(receipt, { action });
  } else if (kind === "review-request") {
    validateV2GitLedgerAutomaticReviewRequestBindingReceipt(receipt, {
      repository,
      scope,
      action,
      controller_actor_id: lease.owner.actor_id,
      controller_app: null,
      not_before: receipt.request_scope_receipt.pre_scope.observed_at,
      record_boundary: recordBoundary,
      rest_base_url: new URL(receipt.api_url).origin,
    });
  } else if (kind === "request-binding") {
    exactKeys(receipt, [
      "request_id", "request_node_id", "request_url", "body_sha256",
      "created_at", "updated_at", "raw_body_sha256", "actor", "controlled",
    ], `${kind} receipt`);
    if (decimal(receipt.request_id, `${kind} receipt.request_id`) !==
        action.request_id) {
      throw new Error("request binding receipt identifies another request");
    }
    boundedString(receipt.request_node_id, `${kind} receipt.request_node_id`, 256);
    githubUrl(receipt.request_url, `${kind} receipt.request_url`);
    digest(receipt.body_sha256, `${kind} receipt.body_sha256`);
    const created = timestamp(receipt.created_at, `${kind} receipt.created_at`);
    if (timestamp(receipt.updated_at, `${kind} receipt.updated_at`) !== created) {
      throw new Error("request binding receipt authorizes an edited request");
    }
    digest(receipt.raw_body_sha256, `${kind} receipt.raw_body_sha256`);
    validateExternalActor(receipt.actor, `${kind} receipt.actor`);
    if (
      receipt.controlled !== true ||
      receipt.actor.id !== lease.owner.actor_id ||
      receipt.actor.login !== "github-actions[bot]" ||
      receipt.actor.type !== "Bot"
    ) {
      throw new Error(
        "request binding must be controlled by the authenticated controller principal",
      );
    }
  } else if (kind === "artifact-binding") {
    exactKeys(receipt, [
      "generation_id", "request_binding_record_oid", "request_id",
      "request_node_id", "artifact_selector", "artifact_node_id",
      "artifact_url", "artifact_type", "artifact_created_at",
      "server_time", "raw_body_sha256", "actor", "app",
    ], `${kind} receipt`);
    if (
      receipt.generation_id !== generation.generation_id ||
      receipt.generation_id !== action.generation_id ||
      receipt.request_binding_record_oid !== action.request_binding_record_oid ||
      receipt.request_id !== action.request_id ||
      receipt.request_node_id !== action.request_node_id ||
      canonicalJson(receipt.artifact_selector) !==
        canonicalJson(action.artifact_selector)
    ) {
      throw new Error("artifact binding receipt differs from its intent lineage");
    }
    sha(receipt.request_binding_record_oid,
      `${kind} receipt.request_binding_record_oid`);
    decimal(receipt.request_id, `${kind} receipt.request_id`);
    boundedString(receipt.request_node_id,
      `${kind} receipt.request_node_id`, 256);
    const selector = normalizeCarrierSelector(
      receipt.artifact_selector,
      `${kind} receipt.artifact_selector`,
    );
    boundedString(receipt.artifact_node_id,
      `${kind} receipt.artifact_node_id`, 256);
    githubUrl(receipt.artifact_url, `${kind} receipt.artifact_url`);
    if (receipt.artifact_type !== selector.kind) {
      throw new Error("artifact binding type differs from its exact selector");
    }
    timestamp(receipt.artifact_created_at,
      `${kind} receipt.artifact_created_at`);
    timestamp(receipt.server_time, `${kind} receipt.server_time`);
    digest(receipt.raw_body_sha256, `${kind} receipt.raw_body_sha256`);
    validateExternalActor(receipt.actor, `${kind} receipt.actor`);
    validateExternalApp(receipt.app, `${kind} receipt.app`);
    if (
      canonicalJson(receipt.actor) !== canonicalJson(action.expected_actor) ||
      canonicalJson(receipt.app) !== canonicalJson(action.expected_app)
    ) {
      throw new Error("artifact binding response is not from the expected provider");
    }
    validateCodexProvider(receipt.actor, receipt.app, `${kind} provider`);
  } else if (kind === "no-start-observation") {
    exactKeys(receipt, [
      "carrier_created_at", "carrier_raw_body_sha256", "first_run_id",
      "first_observed_at", "confirmation_run_id", "confirmed_at",
    ], `${kind} receipt`);
    const carrier = timestamp(receipt.carrier_created_at,
      `${kind} receipt.carrier_created_at`);
    digest(receipt.carrier_raw_body_sha256,
      `${kind} receipt.carrier_raw_body_sha256`);
    const firstRun = decimal(receipt.first_run_id, `${kind} receipt.first_run_id`);
    const first = timestamp(receipt.first_observed_at,
      `${kind} receipt.first_observed_at`);
    const confirmationRun = decimal(receipt.confirmation_run_id,
      `${kind} receipt.confirmation_run_id`);
    const confirmed = timestamp(receipt.confirmed_at, `${kind} receipt.confirmed_at`);
    if (new Set([action.request_run_id, firstRun, confirmationRun]).size !== 3 ||
        !(Date.parse(action.request_created_at) < Date.parse(carrier) &&
          Date.parse(carrier) <= Date.parse(first) &&
          Date.parse(confirmed) - Date.parse(first) >= 900_000)) {
      throw new Error("no-start receipt lacks independent ordered observations");
    }
  } else if (kind === "thread-resolution-observation") {
    exactKeys(receipt, [
      "is_resolved", "response_server_time", "run_id", "raw_body_sha256",
    ], `${kind} receipt`);
    if (receipt.is_resolved !== true) throw new Error("thread is not resolved");
    timestamp(receipt.response_server_time, `${kind} receipt.response_server_time`);
    decimal(receipt.run_id, `${kind} receipt.run_id`);
    digest(receipt.raw_body_sha256, `${kind} receipt.raw_body_sha256`);
  } else if (kind === "status-write") {
    exactKeys(receipt, [
      "http_status", "status_id", "target_sha", "role", "context", "state",
      "description_digest", "created_at", "updated_at", "creator",
      "post_server_time", "post_raw_body_sha256", "refetch_server_time",
      "refetch_page_count", "refetch_item_count", "refetch_match_count",
      "refetch_inventory_digest", "refetch_pages",
    ], `${kind} receipt`);
    validateV2GitLedgerStatusWriteResponseReceipt(receipt, { action });
  } else if (kind === "sticky-comment") {
    exactKeys(receipt, [
      "http_status", "server_time", "raw_body_sha256", "comment", "actor",
      "app", "pre_comment_inventory_digest", "post_comment_inventory_digest",
    ], `${kind} receipt`);
    const expectedStatus = action.method === "POST" ? 201 : 200;
    if (receipt.http_status !== expectedStatus) {
      throw new Error("sticky comment response status is invalid");
    }
    normalizeControlCommentBinding(receipt.comment, { required: true });
    validateExternalActor(receipt.actor, `${kind} receipt.actor`);
    validateExternalApp(receipt.app, `${kind} receipt.app`);
    validateControllerCommentIdentity(receipt.actor, receipt.app, kind);
    timestamp(receipt.server_time, `${kind} receipt.server_time`);
    digest(receipt.raw_body_sha256, `${kind} receipt.raw_body_sha256`);
    if (receipt.pre_comment_inventory_digest !==
        action.pre_comment_inventory_digest) {
      throw new Error("sticky comment inventory preimage differs from its intent");
    }
    digest(receipt.post_comment_inventory_digest,
      `${kind} receipt.post_comment_inventory_digest`);
  } else if (kind === "scheduler-state") {
    exactKeys(receipt, [
      "closure_kind", "closure_ids", "finding_observed_at",
      "closure_observed_at", "next_request_created_at", "same_review_epoch",
    ], `${kind} receipt`);
    if (!new Set(["top-level-addressed", "inline-resolved"])
      .has(receipt.closure_kind) || receipt.same_review_epoch !== true) {
      throw new Error("scheduler-state closure receipt is invalid");
    }
    normalizeUniqueStringArray(receipt.closure_ids, `${kind} receipt.closure_ids`);
    const finding = timestamp(receipt.finding_observed_at,
      `${kind} receipt.finding_observed_at`);
    const closure = timestamp(receipt.closure_observed_at,
      `${kind} receipt.closure_observed_at`);
    const request = timestamp(receipt.next_request_created_at,
      `${kind} receipt.next_request_created_at`);
    if (!(Date.parse(finding) < Date.parse(closure) &&
          Date.parse(closure) < Date.parse(request))) {
      throw new Error("scheduler-state closure times are not strictly ordered");
    }
  }
}

function validateEffectReceiptTemporalBoundary(kind, receipt, boundaryValue) {
  const boundary = Date.parse(timestamp(
    boundaryValue,
    `${kind} authoritative record boundary`,
  ));
  const fields = [
    "server_time", "created_at", "updated_at", "carrier_created_at",
    "artifact_created_at",
    "first_observed_at", "confirmed_at", "response_server_time",
    "finding_observed_at", "closure_observed_at", "next_request_created_at",
    "post_server_time", "refetch_server_time",
  ];
  for (const field of fields) {
    if (receipt[field] !== undefined && Date.parse(receipt[field]) > boundary) {
      throw new Error(`${kind} receipt ${field} is after its GitHub ref boundary`);
    }
  }
}

function validateControllerCommentIdentity(actor, app, kind) {
  if (
    actor.login !== "github-actions[bot]" || actor.type !== "Bot" ||
    app.id !== "15368" || app.slug !== "github-actions"
  ) {
    throw new Error(`${kind} receipt is not owned by the trusted GitHub Actions app`);
  }
}

function requireNullEffectFields(value, label) {
  if (value.kind !== null || value.effect_id !== null || value.idempotency_key !== null) {
    throw new Error(`${label} cannot carry effect identity fields`);
  }
}

function validateLeaseAcquirePayload(payload) {
  assertObject(payload, "lease acquire payload");
  exactKeys(payload, [
    "lease_id", "owner", "acquired_at", "expires_at", "lease_ttl_seconds",
  ],
    "lease acquire payload");
  boundedString(payload.lease_id, "lease_id", 256);
  normalizeLeaseOwner(payload.owner);
  const acquired = timestamp(payload.acquired_at, "lease acquired_at");
  const expires = timestamp(payload.expires_at, "lease expires_at");
  if (Date.parse(expires) <= Date.parse(acquired)) {
    throw new Error("lease expiry must be after acquisition");
  }
  const ttl = positiveInteger(payload.lease_ttl_seconds, "lease_ttl_seconds");
  if (ttl > 900 || Date.parse(expires) - Date.parse(acquired) !== ttl * 1000) {
    throw new Error("lease expiry does not match its bounded TTL");
  }
}

function validateLeaseReleasePayload(payload) {
  assertObject(payload, "lease release payload");
  exactKeys(payload, ["lease_id", "owner", "acquire_commit_sha", "released_at"],
    "lease release payload");
  boundedString(payload.lease_id, "lease release lease_id", 256);
  normalizeLeaseOwner(payload.owner);
  sha(payload.acquire_commit_sha, "lease release acquire_commit_sha");
  timestamp(payload.released_at, "lease release released_at");
}

function normalizeLeaseAcquireInput(value) {
  assertObject(value, "lease acquire input");
  exactKeys(value, [
    "predecessor_commit_sha", "pull_request", "head_ref_oid", "base_ref_oid",
    "potential_merge_commit_oid", "lease_id", "owner", "observed_at",
    "lease_ttl_seconds", "control_comment_binding",
  ], "lease acquire input");
  const normalized = {
    predecessor_commit_sha: sha(value.predecessor_commit_sha, "predecessor_commit_sha"),
    pull_request: normalizePullRequest(value.pull_request),
    head_ref_oid: sha(value.head_ref_oid, "head_ref_oid"),
    base_ref_oid: sha(value.base_ref_oid, "base_ref_oid"),
    potential_merge_commit_oid: nullableSha(
      value.potential_merge_commit_oid,
      "potential_merge_commit_oid",
    ),
    lease_id: boundedString(value.lease_id, "lease_id", 256),
    owner: normalizeLeaseOwner(value.owner),
    observed_at: timestamp(value.observed_at, "observed_at"),
    lease_ttl_seconds: positiveInteger(
      value.lease_ttl_seconds,
      "lease_ttl_seconds",
    ),
    control_comment_binding:
      normalizeControlCommentBinding(value.control_comment_binding),
  };
  if (normalized.lease_ttl_seconds > 900) {
    throw new Error("lease TTL exceeds the 900-second safety cap");
  }
  return normalized;
}

function validateLeaseReceipt(value, repo, ref) {
  assertObject(value, "lease receipt");
  exactKeys(value, [
    "schema", "schema_version", "repository", "ledger_ref", "lease_id", "owner",
    "acquire_commit_sha", "acquired_at", "expires_at", "scope",
    "append_receipt_digest", "receipt_digest",
  ], "lease receipt");
  if (value.schema !== V2_GIT_LEDGER_LEASE_RECEIPT_SCHEMA || value.schema_version !== 1) {
    throw new Error("lease receipt has an unsupported schema");
  }
  if (
    canonicalJson(normalizeRepository(value.repository)) !== canonicalJson(repo) ||
    normalizeLedgerRef(value.ledger_ref) !== ref
  ) {
    throw new Error("lease receipt belongs to another repository or ref");
  }
  boundedString(value.lease_id, "lease receipt lease_id", 256);
  normalizeLeaseOwner(value.owner);
  sha(value.acquire_commit_sha, "lease receipt acquire_commit_sha");
  timestamp(value.acquired_at, "lease receipt acquired_at");
  timestamp(value.expires_at, "lease receipt expires_at");
  assertObject(value.scope, "lease receipt scope");
  exactKeys(value.scope, [
    "pull_request", "head_ref_oid", "base_ref_oid", "potential_merge_commit_oid",
  ], "lease receipt scope");
  normalizePullRequest(value.scope.pull_request);
  sha(value.scope.head_ref_oid, "lease receipt scope.head_ref_oid");
  sha(value.scope.base_ref_oid, "lease receipt scope.base_ref_oid");
  nullableSha(value.scope.potential_merge_commit_oid,
    "lease receipt scope.potential_merge_commit_oid");
  digest(value.append_receipt_digest, "lease receipt append_receipt_digest");
  digest(value.receipt_digest, "lease receipt receipt_digest");
  const { receipt_digest: _digest, ...withoutDigest } = value;
  if (digestCanonical("codex-review-gate-v2-git-ledger-lease-receipt", withoutDigest) !==
      value.receipt_digest) {
    throw new Error("lease receipt digest is invalid");
  }
  return value;
}

function normalizeEnvelopeScopeFields(value) {
  if (
    INTERNAL_RECORD_TYPES.has(value.record_type) ||
    REPOSITORY_RECORD_TYPES.has(value.record_type)
  ) {
    if (value.pull_request !== null) normalizePullRequest(value.pull_request);
    if (value.head_ref_oid !== null) sha(value.head_ref_oid, "envelope.head_ref_oid");
    if (value.base_ref_oid !== null) sha(value.base_ref_oid, "envelope.base_ref_oid");
  } else {
    normalizePullRequest(value.pull_request);
    sha(value.head_ref_oid, "envelope.head_ref_oid");
    sha(value.base_ref_oid, "envelope.base_ref_oid");
  }
  nullableSha(value.potential_merge_commit_oid, "envelope.potential_merge_commit_oid");
  nullableBoundedString(value.kind, "envelope.kind", 128);
  nullableBoundedString(value.effect_id, "envelope.effect_id", 256);
  nullableBoundedString(value.idempotency_key, "envelope.idempotency_key", 256);
  normalizeControlCommentBinding(value.control_comment_binding);
  normalizeLeaseBinding(value.lease);
}

async function obtainWorkflowProvenance({
  verifyWorkflowProvenance,
  operation,
  repository,
  ledgerRef,
  predecessorCommitSha,
  protectionReceiptDigest,
  source,
  effectScope,
  evaluatedScopeReceipt = null,
  recordIdentity,
  serverTime,
  policy,
  provenanceBudget,
}) {
  const request = sealProvenanceRequest({
    operation,
    repository,
    ledger_ref: ledgerRef,
    predecessor_commit_sha: predecessorCommitSha,
    protection_receipt_digest: protectionReceiptDigest,
    source_workflow: source,
    effect_scope: effectScope,
    evaluated_scope_receipt: evaluatedScopeReceipt,
    record_identity: recordIdentity,
    github_server_time: serverTime,
  });
  return callWorkflowProvenanceVerifier({
    verifyWorkflowProvenance,
    mode: "mint-and-verify",
    request,
    compactJwt: null,
    storedReceipt: null,
    policy,
    provenanceBudget,
  });
}

async function reverifyStoredWorkflowProvenance({
  verifyWorkflowProvenance,
  envelope,
  policy,
  provenanceBudget,
}) {
  const binding = envelope.workflow_provenance.operation_binding;
  const request = validateProvenanceRequest({
    schema: V2_GIT_LEDGER_PROVENANCE_REQUEST_SCHEMA,
    schema_version: 1,
    ...structuredClone(binding),
  });
  const result = await callWorkflowProvenanceVerifier({
    verifyWorkflowProvenance,
    mode: "reverify-stored",
    request,
    compactJwt: envelope.workflow_provenance_jwt,
    storedReceipt: envelope.workflow_provenance,
    policy,
    provenanceBudget,
  });
  validateReverifiedProvenanceStableFields(
    envelope.workflow_provenance,
    result.receipt,
  );
  return result.receipt;
}

async function reverifyReachableWorkflowProvenance({
  records,
  repository,
  ledgerRef,
  verifyWorkflowProvenance,
  provenanceBudget,
}) {
  let activeCapability = null;
  const evidence = [];
  for (const entry of records) {
    const envelope = entry.envelope;
    let recordCapability;
    if (new Set(["genesis", "capability-canary"])
      .has(envelope.record_type)) {
      recordCapability = validateEmbeddedBootstrapCandidate(
        envelope.payload,
        repository,
        ledgerRef,
      );
    } else if (envelope.record_type === "capability-attestation") {
      recordCapability = validateEmbeddedCapability(
        envelope.payload,
        repository,
        ledgerRef,
      );
    } else {
      if (activeCapability === null) {
        throw ledgerError(
          "capability-attestation-required",
          "production Git ledger record precedes any reachable capability attestation",
        );
      }
      recordCapability = activeCapability;
    }
    validateV2GitLedgerEnvelope(envelope, {
      repository,
      ledger_ref: ledgerRef,
      source_workflow: sourceWorkflow(recordCapability.controller_release),
      provenance_policy: provenanceExpected(recordCapability),
    });
    const liveReceipt = await reverifyStoredWorkflowProvenance({
      verifyWorkflowProvenance,
      envelope,
      policy: recordCapability.workflow_provenance_policy,
      provenanceBudget,
    });
    const withoutDigest = {
      record_oid: entry.commit_sha,
      stored_receipt_digest: envelope.workflow_provenance.receipt_digest,
      live_receipt_digest: liveReceipt.receipt_digest,
      token_sha256: liveReceipt.token_sha256,
      key_id: liveReceipt.key_id,
      verified_at_server_time: liveReceipt.verified_at_server_time,
      discovery: structuredClone(liveReceipt.discovery),
      jwks: structuredClone(liveReceipt.jwks),
    };
    evidence.push({
      ...withoutDigest,
      evidence_digest: digestCanonical(
        "codex-review-gate-v2-git-ledger-provenance-reverification",
        withoutDigest,
      ),
    });
    if (envelope.record_type === "capability-attestation") {
      if (
        envelope.payload.protection_receipt_digest !==
          recordCapability.protection.live_ruleset_receipt_digest ||
        canonicalJson(envelope.payload.controller_release) !==
          canonicalJson(recordCapability.controller_release)
      ) {
        throw ledgerError(
          "attestation-capability-mismatch",
          "capability attestation does not activate its embedded capability receipt",
        );
      }
      activeCapability = recordCapability;
    }
  }
  return deepFreeze(evidence);
}

async function callWorkflowProvenanceVerifier({
  verifyWorkflowProvenance,
  mode,
  request,
  compactJwt,
  storedReceipt,
  policy,
  provenanceBudget,
}) {
  const verifierRequest = deepFreeze({
    schema: V2_GIT_LEDGER_PROVENANCE_VERIFIER_REQUEST_SCHEMA,
    schema_version: 1,
    mode,
    provenance_request: structuredClone(request),
    compact_jwt: compactJwt,
    stored_receipt:
      storedReceipt === null ? null : structuredClone(storedReceipt),
  });
  let rawResult;
  const verifierSignal = consumeProvenanceBudget(provenanceBudget);
  try {
    rawResult = await Promise.race([
      verifyWorkflowProvenance(structuredClone(verifierRequest), {
        signal: verifierSignal.signal,
        deadline_ms: verifierSignal.timeout_ms,
      }),
      verifierSignal.deadline,
    ]);
  } catch (error) {
    if (error?.code === "provenance-timeout") throw error;
    if (new Set(["oidc-kid-unavailable", "OIDC_KID_UNAVAILABLE"])
      .has(error?.code)) {
      throw ledgerError(
        "oidc-kid-unavailable",
        "stored OIDC JWT key id is unavailable in the current GitHub JWKS",
      );
    }
    throw ledgerError(
      "workflow-provenance-verification-failed",
      "GitHub OIDC workflow provenance verification failed closed",
    );
  } finally {
    verifierSignal.finish();
  }
  assertObject(rawResult, "workflow provenance verifier result");
  exactKeys(rawResult, [
    "schema", "schema_version", "mode", "compact_jwt", "receipt",
  ], "workflow provenance verifier result");
  if (
    rawResult.schema !== V2_GIT_LEDGER_PROVENANCE_VERIFIER_RESULT_SCHEMA ||
    rawResult.schema_version !== 1 || rawResult.mode !== mode
  ) {
    throw new Error("workflow provenance verifier result schema is invalid");
  }
  const jwt = mode === "mint-and-verify"
    ? compactOidcJwt(rawResult.compact_jwt)
    : compactOidcJwt(compactJwt);
  if (
    (mode === "reverify-stored" && rawResult.compact_jwt !== null) ||
    (mode === "mint-and-verify" && rawResult.compact_jwt !== jwt)
  ) {
    throw new Error("workflow provenance verifier returned unexpected JWT bytes");
  }
  const receipt = validateV2GitLedgerProvenanceReceipt(
    rawResult.receipt,
    mode === "mint-and-verify" ? { request, policy } : { request },
  );
  if (mode === "reverify-stored") {
    validateReverifiedProvenanceAgainstPolicy(receipt, policy);
  }
  if (rawDigest(jwt) !== receipt.token_sha256) {
    throw new Error("workflow provenance verifier JWT digest is invalid");
  }
  return deepFreeze({ receipt, compact_jwt: jwt });
}

function validateReverifiedProvenanceStableFields(stored, live) {
  const stableFields = [
    "verified",
    "signature_verified",
    "jwks_verified",
    "live_supported",
    "issuer",
    "audience",
    "algorithm",
    "key_id",
    "claims",
    "token_sha256",
    "verified_at_server_time",
    "replay_prevention_receipt_digest",
    "operation_binding",
  ];
  for (const field of stableFields) {
    if (canonicalJson(stored[field]) !== canonicalJson(live[field])) {
      throw ledgerError(
        "stored-provenance-mismatch",
        "stored workflow provenance stable fields differ from live JWT reverification",
      );
    }
  }
}

function validateReverifiedProvenanceAgainstPolicy(receipt, policyValue) {
  const policy = normalizeProvenancePolicy(policyValue);
  const claims = normalizeOidcClaims(receipt.claims);
  const discovery = normalizeOidcDiscoveryReceipt(receipt.discovery);
  const jwks = normalizeOidcJwksReceipt(receipt.jwks);
  if (
    receipt.issuer !== policy.issuer ||
    !receipt.audience.startsWith(`${policy.audience}:`) ||
    receipt.algorithm !== policy.algorithm ||
    discovery.url !== policy.discovery_url ||
    jwks.url !== policy.jwks_uri ||
    policy.required_claims.some((claim) =>
      !discovery.claims_supported.includes(claim)) ||
    claims.repository_owner_id !== String(policy.repository_owner_id) ||
    claims.sub !== policy.subject_pattern ||
    digestCanonical("codex-review-gate-v2-oidc-subject-pattern", claims.sub) !==
      policy.subject_pattern_digest ||
    !policy.allowed_event_names.includes(claims.event_name) ||
    !policy.allowed_refs.includes(claims.ref)
  ) {
    throw ledgerError(
      "live-provenance-policy-mismatch",
      "live JWT reverification differs from the sealed stable OIDC policy",
    );
  }
}

function sealProvenanceRequest(value) {
  const nonceInput = {
    schema: V2_GIT_LEDGER_PROVENANCE_REQUEST_SCHEMA,
    schema_version: 1,
    ...structuredClone(value),
  };
  const nonce = digestCanonical(
    "codex-review-gate-v2-git-ledger-provenance-nonce",
    nonceInput,
  );
  const withoutDigest = {
    ...nonceInput,
    nonce,
    audience: `${V2_GIT_LEDGER_OIDC_AUDIENCE}:${nonce.slice("sha256:".length)}`,
  };
  const sealed = {
    ...withoutDigest,
    request_digest: digestCanonical(
      "codex-review-gate-v2-git-ledger-provenance-request",
      withoutDigest,
    ),
  };
  validateProvenanceRequest(sealed);
  return deepFreeze(sealed);
}

function validateProvenanceRequest(value) {
  assertObject(value, "workflow provenance request");
  exactKeys(value, [
    "schema", "schema_version", "operation", "repository", "ledger_ref",
    "predecessor_commit_sha", "protection_receipt_digest", "source_workflow",
    "effect_scope", "evaluated_scope_receipt", "record_identity",
    "github_server_time", "nonce",
    "audience", "request_digest",
  ], "workflow provenance request");
  if (
    value.schema !== V2_GIT_LEDGER_PROVENANCE_REQUEST_SCHEMA ||
    value.schema_version !== 1
  ) {
    throw new Error("workflow provenance request has an unsupported schema");
  }
  const operation = boundedString(
    value.operation,
    "workflow provenance operation",
    128,
  );
  if (!PROVENANCE_OPERATIONS.has(operation)) {
    throw new Error("workflow provenance operation is not closed");
  }
  const repository = normalizeRepository(value.repository);
  const ledgerRef = normalizeLedgerRef(value.ledger_ref);
  const predecessor = value.predecessor_commit_sha === null
    ? null
    : sha(value.predecessor_commit_sha,
      "workflow provenance predecessor_commit_sha");
  digest(value.protection_receipt_digest,
    "workflow provenance protection_receipt_digest");
  const source = normalizeSourceWorkflow(
    value.source_workflow,
    "workflow provenance source_workflow",
  );
  const effectScope = normalizeEffectScope(value.effect_scope);
  const evaluatedScopeReceipt = value.evaluated_scope_receipt === null
    ? null
    : validateV2GitLedgerEvaluatedScopeReceipt(
      value.evaluated_scope_receipt,
      { repository, scope: effectScope },
    );
  const recordIdentity = normalizeProvenanceRecordIdentity(value.record_identity);
  const productionOperation = RECORD_TYPES.has(operation);
  const repositoryOperation = REPOSITORY_RECORD_TYPES.has(operation);
  if ((productionOperation &&
        ((repositoryOperation ? effectScope !== null : effectScope === null) ||
          evaluatedScopeReceipt === null ||
          recordIdentity === null)) ||
      (!productionOperation &&
        (effectScope !== null || evaluatedScopeReceipt !== null ||
          recordIdentity !== null))) {
    throw new Error(
      "workflow provenance effect scope does not match its operation",
    );
  }
  const serverTime = timestamp(
    value.github_server_time,
    "workflow provenance github_server_time",
  );
  const nonce = digest(value.nonce, "workflow provenance nonce");
  boundedString(value.audience, "workflow provenance audience", 512);
  const {
    request_digest: _requestDigest,
    audience: _audience,
    nonce: _nonce,
    ...nonceInput
  } = value;
  const expectedNonce = digestCanonical(
    "codex-review-gate-v2-git-ledger-provenance-nonce",
    nonceInput,
  );
  if (
    nonce !== expectedNonce ||
    value.audience !==
      `${V2_GIT_LEDGER_OIDC_AUDIENCE}:${nonce.slice("sha256:".length)}`
  ) {
    throw new Error("workflow provenance nonce or effect-bound audience is invalid");
  }
  digest(value.request_digest, "workflow provenance request_digest");
  const { request_digest: _digest, ...withoutDigest } = value;
  if (digestCanonical("codex-review-gate-v2-git-ledger-provenance-request",
    withoutDigest) !== value.request_digest) {
    throw new Error("workflow provenance request digest is invalid");
  }
  return {
    ...value,
    repository,
    ledger_ref: ledgerRef,
    predecessor_commit_sha: predecessor,
    source_workflow: source,
    effect_scope: effectScope,
    evaluated_scope_receipt: evaluatedScopeReceipt,
    record_identity: recordIdentity,
    github_server_time: serverTime,
  };
}

function operationBinding(request) {
  return {
    operation: request.operation,
    repository: request.repository,
    ledger_ref: request.ledger_ref,
    predecessor_commit_sha: request.predecessor_commit_sha,
    protection_receipt_digest: request.protection_receipt_digest,
    source_workflow: request.source_workflow,
    effect_scope: request.effect_scope,
    evaluated_scope_receipt: request.evaluated_scope_receipt,
    record_identity: request.record_identity,
    github_server_time: request.github_server_time,
    nonce: request.nonce,
    audience: request.audience,
    request_digest: request.request_digest,
  };
}

function normalizeProvenanceOperationBinding(value) {
  assertObject(value, "workflow provenance operation_binding");
  exactKeys(value, [
    "operation", "repository", "ledger_ref", "predecessor_commit_sha",
    "protection_receipt_digest", "source_workflow", "effect_scope",
    "evaluated_scope_receipt",
    "record_identity", "github_server_time", "nonce", "audience",
    "request_digest",
  ], "workflow provenance operation_binding");
  const operation = boundedString(
    value.operation,
    "workflow provenance binding.operation",
    128,
  );
  if (!PROVENANCE_OPERATIONS.has(operation)) {
    throw new Error("workflow provenance binding operation is not closed");
  }
  normalizeRepository(value.repository);
  normalizeLedgerRef(value.ledger_ref);
  if (value.predecessor_commit_sha !== null) {
    sha(value.predecessor_commit_sha,
      "workflow provenance binding.predecessor_commit_sha");
  }
  digest(value.protection_receipt_digest,
    "workflow provenance binding.protection_receipt_digest");
  normalizeSourceWorkflow(value.source_workflow,
    "workflow provenance binding.source_workflow");
  const effectScope = normalizeEffectScope(value.effect_scope);
  const evaluatedScopeReceipt = value.evaluated_scope_receipt === null
    ? null
    : validateV2GitLedgerEvaluatedScopeReceipt(
      value.evaluated_scope_receipt,
      { repository: value.repository, scope: effectScope },
    );
  const recordIdentity = normalizeProvenanceRecordIdentity(value.record_identity);
  const repositoryOperation = REPOSITORY_RECORD_TYPES.has(operation);
  if ((RECORD_TYPES.has(operation) &&
        ((repositoryOperation ? effectScope !== null : effectScope === null) ||
          evaluatedScopeReceipt === null ||
          recordIdentity === null)) ||
      (!RECORD_TYPES.has(operation) &&
        (effectScope !== null || evaluatedScopeReceipt !== null ||
          recordIdentity !== null))) {
    throw new Error(
      "workflow provenance binding effect scope does not match its operation",
    );
  }
  timestamp(value.github_server_time,
    "workflow provenance binding.github_server_time");
  digest(value.nonce, "workflow provenance binding.nonce");
  boundedString(value.audience, "workflow provenance binding.audience", 512);
  digest(value.request_digest, "workflow provenance binding.request_digest");
  const { request_digest: _digest, ...requestFields } = value;
  const request = {
    schema: V2_GIT_LEDGER_PROVENANCE_REQUEST_SCHEMA,
    schema_version: 1,
    ...structuredClone(requestFields),
  };
  if (digestCanonical("codex-review-gate-v2-git-ledger-provenance-request",
    request) !== value.request_digest) {
    throw new Error("workflow provenance binding request digest is invalid");
  }
  return value;
}

function normalizeOidcClaims(value) {
  assertObject(value, "workflow provenance claims");
  const keys = Object.keys(value).sort();
  const withoutJti = [...V2_GIT_LEDGER_OIDC_CLAIMS].sort();
  const withJti = [...V2_GIT_LEDGER_OIDC_CLAIMS, "jti"].sort();
  if (
    canonicalJson(keys) !== canonicalJson(withoutJti) &&
    canonicalJson(keys) !== canonicalJson(withJti)
  ) {
    throw new TypeError(
      "workflow provenance claims must use the closed required set with only optional jti",
    );
  }
  const strings = {};
  for (const key of V2_GIT_LEDGER_OIDC_CLAIMS) {
    if (new Set(["iat", "nbf", "exp"]).has(key)) continue;
    strings[key] = boundedString(value[key], `workflow provenance claims.${key}`, 1024);
  }
  const jti = value.jti === undefined
    ? null
    : boundedString(value.jti, "workflow provenance claims.jti", 1024);
  if (!SHA.test(strings.sha) || !SHA.test(strings.workflow_sha) ||
      !SHA.test(strings.job_workflow_sha)) {
    throw new Error("workflow provenance SHA claims must be lowercase full SHAs");
  }
  if (!strings.ref.startsWith("refs/")) {
    throw new Error("workflow provenance ref claim is not canonical");
  }
  return {
    ...strings,
    jti,
    iat: nonnegativeInteger(value.iat, "workflow provenance claims.iat"),
    nbf: nonnegativeInteger(value.nbf, "workflow provenance claims.nbf"),
    exp: positiveInteger(value.exp, "workflow provenance claims.exp"),
  };
}

function normalizeOidcDiscoveryReceipt(value) {
  assertObject(value, "workflow provenance discovery receipt");
  exactKeys(value, [
    "url", "server_time", "raw_body_sha256", "claims_supported",
  ], "workflow provenance discovery receipt");
  if (value.url !==
      "https://token.actions.githubusercontent.com/.well-known/openid-configuration") {
    throw new Error("workflow provenance discovery URL is unsupported");
  }
  timestamp(value.server_time, "workflow provenance discovery server_time");
  digest(value.raw_body_sha256,
    "workflow provenance discovery raw_body_sha256");
  normalizeUniqueStringArray(value.claims_supported,
    "workflow provenance discovery claims_supported");
  return value;
}

function normalizeOidcJwksReceipt(value) {
  assertObject(value, "workflow provenance JWKS receipt");
  exactKeys(value, [
    "url", "server_time", "raw_body_sha256",
  ], "workflow provenance JWKS receipt");
  if (value.url !== "https://token.actions.githubusercontent.com/.well-known/jwks") {
    throw new Error("workflow provenance JWKS URL is unsupported");
  }
  timestamp(value.server_time, "workflow provenance JWKS server_time");
  digest(value.raw_body_sha256, "workflow provenance JWKS raw_body_sha256");
  return value;
}

function validateProvenanceAgainstPolicy({ value, discovery, jwks, policy }) {
  if (
    value.issuer !== policy.issuer ||
    !value.audience.startsWith(`${policy.audience}:`) ||
    value.algorithm !== policy.algorithm || discovery.url !== policy.discovery_url ||
    jwks.url !== policy.jwks_uri ||
    canonicalJson([...discovery.claims_supported].sort()) !==
      canonicalJson([...policy.claims_supported].sort())
  ) {
    throw new Error("workflow provenance differs from the live capability policy");
  }
  const claims = normalizeOidcClaims(value.claims);
  if (
    claims.repository_owner_id !== String(policy.repository_owner_id) ||
    claims.sub !== policy.subject_pattern ||
    digestCanonical("codex-review-gate-v2-oidc-subject-pattern", claims.sub) !==
      policy.subject_pattern_digest ||
    !policy.allowed_event_names.includes(claims.event_name) ||
    !policy.allowed_refs.includes(claims.ref)
  ) {
    throw new Error("workflow provenance claims violate the closed subject/event/ref policy");
  }
}

function validateOidcEffectScopeRelation(claims, effectScope) {
  if (effectScope === null) return;
  if (claims.event_name === "pull_request") {
    const expectedRef = `refs/pull/${effectScope.pull_request.number}/merge`;
    if (
      effectScope.potential_merge_commit_oid === null ||
      claims.ref !== expectedRef ||
      claims.sha !== effectScope.potential_merge_commit_oid
    ) {
      throw new Error(
        "pull_request OIDC ref/SHA does not bind the exact effect scope",
      );
    }
    return;
  }
  if (claims.event_name === "pull_request_target") {
    if (claims.sha !== effectScope.base_ref_oid) {
      throw new Error(
        "pull_request_target OIDC SHA does not bind the exact base scope",
      );
    }
    return;
  }
  if (new Set([
    "issue_comment", "pull_request_review", "pull_request_review_comment",
    "schedule", "workflow_dispatch",
  ]).has(claims.event_name)) return;
  throw new Error("OIDC trigger event cannot authorize production effects");
}

function validateTriggerIdentityAgainstClaims(receipt, claimsValue) {
  if (receipt === null) return;
  const claims = normalizeOidcClaims(claimsValue);
  if (
    receipt.trigger_event_name !== claims.event_name ||
    receipt.trigger_ref !== claims.ref ||
    receipt.trigger_sha !== claims.sha
  ) {
    throw new Error(
      "evaluated scope receipt trigger identity differs from signed OIDC claims",
    );
  }
}

export function validateV2GitLedgerEvaluatedScopeReceipt(
  value,
  { repository: repositoryValue = null, scope: scopeValue = null } = {},
) {
  assertObject(value, "evaluated_scope_receipt");
  exactKeys(value, [
    "schema", "schema_version", "relation", "phase", "repository", "scope",
    "trigger_event_name", "trigger_ref", "trigger_sha", "selector",
    "inventory_receipt", "provider_artifact_receipt",
    "provider_identity_authority",
    "discovery_continuity_receipt",
    "scope_endpoint_receipt", "receipt_digest",
  ], "evaluated_scope_receipt");
  if (
    value.schema !== V2_GIT_LEDGER_EVALUATED_SCOPE_RECEIPT_SCHEMA ||
    value.schema_version !== 1
  ) {
    throw new Error("evaluated scope receipt schema is unsupported");
  }
  const repository = normalizeRepository(value.repository);
  const relations = new Set([
    "pull-request-event", "provider-selector", "scheduled-pull-request",
    "scheduled-repository-inventory", "scheduled-repository-dispatch",
    "manual-pull-request",
  ]);
  if (!relations.has(value.relation)) {
    throw new Error("evaluated scope receipt relation is unsupported");
  }
  const repositoryRelation = new Set([
    "scheduled-repository-inventory",
    "scheduled-repository-dispatch",
  ]).has(value.relation);
  const expectedPhases = value.relation === "scheduled-repository-inventory"
    ? new Set(["repository-inventory"])
    : value.relation === "scheduled-repository-dispatch"
      ? new Set(["repository-dispatch"])
    : new Set(["pre-scope", "full-discovery"]);
  if (!expectedPhases.has(value.phase)) {
    throw new Error("evaluated scope receipt phase is unsupported");
  }
  const scope = normalizeEffectScope(value.scope);
  if (
    repositoryRelation !== (scope === null)
  ) {
    throw new Error(
      "evaluated scope receipt PR scope differs from its repository relation",
    );
  }
  const eventName = boundedString(
    value.trigger_event_name,
    "evaluated scope trigger_event_name",
    128,
  );
  const triggerRef = boundedString(
    value.trigger_ref,
    "evaluated scope trigger_ref",
    1024,
  );
  if (!triggerRef.startsWith("refs/")) {
    throw new Error("evaluated scope trigger_ref is not canonical");
  }
  const triggerSha = sha(value.trigger_sha, "evaluated scope trigger_sha");
  const allowedByRelation = {
    "pull-request-event": new Set(["pull_request", "pull_request_target"]),
    "provider-selector": new Set([
      "issue_comment", "pull_request_review", "pull_request_review_comment",
    ]),
    "scheduled-pull-request": new Set(["schedule"]),
    "scheduled-repository-inventory": new Set(["schedule"]),
    "scheduled-repository-dispatch": new Set(["schedule"]),
    "manual-pull-request": new Set(["workflow_dispatch"]),
  };
  if (!allowedByRelation[value.relation].has(eventName)) {
    throw new Error("evaluated scope relation differs from its trigger event");
  }
  const selector = normalizeEvaluatedScopeSelector(
    value.selector,
    value.relation,
    repository,
    scope,
  );
  const inventoryReceipt = normalizeEvaluatedScopeInventoryReceipt(
    value.inventory_receipt,
    value.relation,
    scope,
  );
  const providerArtifactReceipt = normalizeProviderArtifactReceipt(
    value.provider_artifact_receipt,
    value.relation,
    selector,
  );
  const providerIdentityAuthority = normalizeEvaluatedProviderIdentityAuthority(
    value.provider_identity_authority,
    value.relation,
  );
  const discoveryContinuityReceipt =
    normalizeEvaluatedDiscoveryContinuityReceipt(
      value.discovery_continuity_receipt,
      value.relation,
      repository,
      scope,
    );
  if (
    (value.phase === "full-discovery") !==
      (discoveryContinuityReceipt !== null)
  ) {
    throw new Error(
      "evaluated scope receipt phase differs from discovery continuity",
    );
  }
  const scopeEndpointReceipt = normalizeEvaluatedScopeEndpointReceipt(
    value.scope_endpoint_receipt,
    value.relation,
    repository,
    scope,
  );
  if (
    repositoryValue !== null &&
    canonicalJson(repository) !==
      canonicalJson(normalizeRepository(repositoryValue))
  ) {
    throw new Error("evaluated scope receipt binds another repository");
  }
  if (
    scopeValue !== null &&
    canonicalJson(scope) !== canonicalJson(normalizeEffectScope(scopeValue))
  ) {
    throw new Error("evaluated scope receipt binds another PR scope");
  }
  digest(value.receipt_digest, "evaluated scope receipt_digest");
  const { receipt_digest: _receiptDigest, ...withoutDigest } = value;
  if (digestCanonical("codex-review-gate-v2-evaluated-scope-receipt",
    withoutDigest) !== value.receipt_digest) {
    throw new Error("evaluated scope receipt digest is invalid");
  }
  return deepFreeze({
    ...structuredClone(value),
    repository,
    scope,
    trigger_event_name: eventName,
    trigger_ref: triggerRef,
    trigger_sha: triggerSha,
    selector,
    inventory_receipt: inventoryReceipt,
    provider_artifact_receipt: providerArtifactReceipt,
    provider_identity_authority: providerIdentityAuthority,
    discovery_continuity_receipt: discoveryContinuityReceipt,
    scope_endpoint_receipt: scopeEndpointReceipt,
  });
}

function normalizeEvaluatedDiscoveryContinuityReceipt(
  value,
  relation,
  repository,
  scope,
) {
  if (value === null) return null;
  if (new Set([
    "scheduled-repository-inventory",
    "scheduled-repository-dispatch",
  ]).has(relation) || scope === null) {
    throw new Error("repository inventory cannot carry PR discovery continuity");
  }
  return validateV2GitLedgerDiscoveryContinuityReceipt(value, {
    repository,
    scope,
  });
}

function normalizeEvaluatedScopeSelector(value, relation, repository, scope) {
  if (relation === "manual-pull-request") {
    assertObject(value, "manual evaluated scope selector");
    exactKeys(value, [
      "source", "input_name", "input_value", "pull_request_number",
      "pull_request_node_id", "command_receipt_digest",
      "selection_receipt_digest",
    ], "manual evaluated scope selector");
    if (
      value.source !== "trusted-reusable-workflow-input" ||
      value.input_name !== "pull-request" ||
      value.input_value !== String(scope.pull_request.number) ||
      positiveInteger(
        value.pull_request_number,
        "manual evaluated scope selector.pull_request_number",
      ) !== scope.pull_request.number ||
      value.pull_request_node_id !== scope.pull_request.node_id
    ) {
      throw new Error(
        "manual evaluated scope is not one trusted explicit PR selection",
      );
    }
    boundedString(
      value.pull_request_node_id,
      "manual evaluated scope selector.pull_request_node_id",
      256,
    );
    digest(
      value.command_receipt_digest,
      "manual evaluated scope selector.command_receipt_digest",
    );
    digest(
      value.selection_receipt_digest,
      "manual evaluated scope selector.selection_receipt_digest",
    );
    const { selection_receipt_digest: _digest, ...withoutDigest } = value;
    if (
      value.selection_receipt_digest !== digestCanonical(
        "codex-review-gate-v2-manual-pull-request-selection",
        withoutDigest,
      )
    ) {
      throw new Error("manual evaluated scope selection digest is invalid");
    }
    return value;
  }
  if (relation !== "provider-selector") {
    if (value !== null) throw new Error("scope relation cannot carry a selector");
    return null;
  }
  assertObject(value, "evaluated scope selector");
  exactKeys(value, [
    "kind", "id", "node_id", "url", "pull_request_number",
    "pull_request_node_id", "actor", "app", "server_time",
    "raw_body_sha256",
  ], "evaluated scope selector");
  const selector = normalizeCarrierSelector(
    { kind: value.kind, id: value.id },
    "evaluated scope selector",
  );
  boundedString(value.node_id, "evaluated scope selector.node_id", 256);
  if (
    value.url !== exactProviderArtifactUrl(
      repository,
      scope.pull_request,
      selector,
    ) ||
    positiveInteger(value.pull_request_number,
      "evaluated scope selector.pull_request_number") !==
      scope.pull_request.number ||
    value.pull_request_node_id !== scope.pull_request.node_id
  ) {
    throw new Error("provider selector does not exact-bind the evaluated PR");
  }
  boundedString(value.pull_request_node_id,
    "evaluated scope selector.pull_request_node_id", 256);
  validateExternalActor(value.actor, "evaluated scope selector.actor");
  validateExternalApp(value.app, "evaluated scope selector.app");
  validateCodexProvider(value.actor, value.app, "evaluated scope selector provider");
  timestamp(value.server_time, "evaluated scope selector.server_time");
  digest(value.raw_body_sha256, "evaluated scope selector.raw_body_sha256");
  return value;
}

function normalizeProviderArtifactReceipt(value, relation, selector) {
  if (relation !== "provider-selector") {
    if (value !== null) {
      throw new Error("non-provider scope cannot carry provider artifact evidence");
    }
    return null;
  }
  assertObject(value, "provider artifact receipt");
  exactKeys(value, [
    "phase", "pre_scope_receipt_digest", "carrier_digest",
    "snapshot_digest", "observed_at",
  ], "provider artifact receipt");
  if (!new Set(["pre-scope", "full-discovery"]).has(value.phase)) {
    throw new Error("provider artifact receipt phase is unsupported");
  }
  if (value.phase === "pre-scope") {
    if (
      value.pre_scope_receipt_digest !== null ||
      value.snapshot_digest !== null
    ) {
      throw new Error("provider pre-scope receipt cannot cite full discovery");
    }
  } else {
    digest(
      value.pre_scope_receipt_digest,
      "provider artifact pre_scope_receipt_digest",
    );
    digest(value.snapshot_digest, "provider artifact snapshot_digest");
  }
  digest(value.carrier_digest, "provider artifact carrier_digest");
  const observedAt = timestamp(value.observed_at,
    "provider artifact observed_at");
  if (observedAt !== selector.server_time) {
    throw new Error("provider artifact receipt time differs from its exact selector");
  }
  return value;
}

function normalizeEvaluatedScopeInventoryReceipt(value, relation, scope) {
  if (relation === "scheduled-repository-inventory") {
    assertObject(value, "evaluated repository inventory receipt");
    exactKeys(value, [
      "phase", "cycle_id", "initial_inventory_receipt_digest",
      "shard_index", "evidence_receipt_digest", "observed_at",
    ], "evaluated repository inventory receipt");
    if (
      !new Set(["cycle-start", "shard", "cycle-complete"]).has(value.phase) ||
      !CANDIDATE_CYCLE_ID.test(value.cycle_id)
    ) {
      throw new Error("evaluated repository inventory phase is unsupported");
    }
    digest(value.initial_inventory_receipt_digest,
      "evaluated repository inventory initial digest");
    if (value.phase === "shard") {
      nonnegativeInteger(value.shard_index,
        "evaluated repository inventory shard_index");
    } else if (value.shard_index !== null) {
      throw new Error("non-shard repository inventory cannot carry a shard index");
    }
    digest(value.evidence_receipt_digest,
      "evaluated repository inventory evidence digest");
    timestamp(value.observed_at,
      "evaluated repository inventory observed_at");
    return value;
  }
  if (relation === "scheduled-repository-dispatch") {
    assertObject(value, "evaluated repository dispatch receipt");
    exactKeys(value, [
      "phase", "generation_id", "cycle_id", "inventory_digest",
      "reservation_digest", "dispatch_digest", "batch_index",
      "candidate_number", "result_digest", "evidence_digest",
    ], "evaluated repository dispatch receipt");
    if (
      !new Set([
        "reserve", "candidate-ack", "batch-complete", "cycle-complete",
      ]).has(value.phase) ||
      !CANDIDATE_DISPATCH_GENERATION_ID.test(value.generation_id) ||
      !CANDIDATE_CYCLE_ID.test(value.cycle_id)
    ) {
      throw new Error("evaluated repository dispatch phase is unsupported");
    }
    digest(value.inventory_digest,
      "evaluated repository dispatch inventory digest");
    if (value.reservation_digest !== null) {
      digest(value.reservation_digest,
        "evaluated repository dispatch reservation digest");
    }
    if (value.dispatch_digest !== null) {
      digest(value.dispatch_digest,
        "evaluated repository dispatch dispatch digest");
    }
    if (value.batch_index !== null) {
      nonnegativeInteger(value.batch_index,
        "evaluated repository dispatch batch index");
    }
    if (value.candidate_number !== null) {
      positiveInteger(value.candidate_number,
        "evaluated repository dispatch candidate number");
    }
    if (value.result_digest !== null) {
      digest(value.result_digest,
        "evaluated repository dispatch result digest");
    }
    digest(value.evidence_digest,
      "evaluated repository dispatch evidence digest");
    return value;
  }
  if (relation !== "scheduled-pull-request") {
    if (value !== null) throw new Error("non-scheduled scope cannot carry inventory");
    return null;
  }
  assertObject(value, "evaluated scope inventory receipt");
  exactKeys(value, [
    "candidate_authority_digest", "candidate_dispatch_authority_digest",
    "completed_cycle_record_oid", "cycle_receipt_digest",
    "dispatch_generation_id", "dispatch_cycle_id",
    "dispatch_reservation_record_oid", "dispatch_reservation_digest",
    "dispatch_digest", "dispatch_batch_index", "dispatch_batch_count",
    "dispatch_candidate_index", "selected_candidate",
    "selected_pull_request_number", "selected_pull_request_node_id",
    "selected_observation_raw_body_sha256", "server_time", "inventory_digest",
  ], "evaluated scope inventory receipt");
  digest(value.candidate_authority_digest,
    "evaluated scope inventory candidate_authority_digest");
  digest(value.candidate_dispatch_authority_digest,
    "evaluated scope inventory candidate_dispatch_authority_digest");
  sha(value.completed_cycle_record_oid,
    "evaluated scope inventory completed_cycle_record_oid");
  digest(value.cycle_receipt_digest,
    "evaluated scope inventory cycle_receipt_digest");
  if (!CANDIDATE_DISPATCH_GENERATION_ID.test(value.dispatch_generation_id) ||
      !CANDIDATE_CYCLE_ID.test(value.dispatch_cycle_id)) {
    throw new Error("scheduled inventory dispatch generation is invalid");
  }
  sha(value.dispatch_reservation_record_oid,
    "evaluated scope inventory dispatch_reservation_record_oid");
  digest(value.dispatch_reservation_digest,
    "evaluated scope inventory dispatch_reservation_digest");
  digest(value.dispatch_digest,
    "evaluated scope inventory dispatch_digest");
  nonnegativeInteger(value.dispatch_batch_index,
    "evaluated scope inventory dispatch_batch_index");
  positiveInteger(value.dispatch_batch_count,
    "evaluated scope inventory dispatch_batch_count");
  nonnegativeInteger(value.dispatch_candidate_index,
    "evaluated scope inventory dispatch_candidate_index");
  const candidate = normalizeCandidateInventoryIdentity(
    value.selected_candidate,
  );
  if (
    positiveInteger(value.selected_pull_request_number,
      "evaluated scope inventory selected_pull_request_number") !==
      scope.pull_request.number ||
    value.selected_pull_request_node_id !== scope.pull_request.node_id ||
    candidate.number !== scope.pull_request.number ||
    candidate.node_id !== scope.pull_request.node_id
  ) {
    throw new Error("scheduled inventory selected another pull request");
  }
  boundedString(value.selected_pull_request_node_id,
    "evaluated scope inventory selected_pull_request_node_id", 256);
  digest(value.selected_observation_raw_body_sha256,
    "evaluated scope inventory selected observation raw digest");
  timestamp(value.server_time, "evaluated scope inventory server_time");
  digest(value.inventory_digest, "evaluated scope inventory inventory_digest");
  return value;
}

function normalizeEvaluatedScopeEndpointReceipt(
  value,
  relation,
  repository,
  scope,
) {
  if (new Set([
    "scheduled-repository-inventory",
    "scheduled-repository-dispatch",
  ]).has(relation)) {
    return normalizeRepositoryEndpointReceipt(value, repository);
  }
  assertObject(value, "evaluated scope endpoint receipt");
  exactKeys(value, [
    "method", "path", "status", "server_time", "raw_body_sha256",
    "pull_request", "head_ref_oid", "base_ref_oid",
    "potential_merge_commit_oid",
  ], "evaluated scope endpoint receipt");
  if (
    value.method !== "GET" || value.status !== 200 ||
    value.path !== `/repos/${repository.owner}/${repository.name}/pulls/` +
      scope.pull_request.number ||
    canonicalJson(normalizePullRequest(value.pull_request)) !==
      canonicalJson(scope.pull_request) ||
    sha(value.head_ref_oid, "evaluated scope endpoint head_ref_oid") !==
      scope.head_ref_oid ||
    sha(value.base_ref_oid, "evaluated scope endpoint base_ref_oid") !==
      scope.base_ref_oid ||
    nullableSha(value.potential_merge_commit_oid,
      "evaluated scope endpoint potential_merge_commit_oid") !==
      scope.potential_merge_commit_oid
  ) {
    throw new Error("live PR endpoint receipt differs from evaluated scope");
  }
  timestamp(value.server_time, "evaluated scope endpoint server_time");
  digest(value.raw_body_sha256, "evaluated scope endpoint raw_body_sha256");
  return value;
}

function provenanceMatchesExpected(provenance, expected) {
  if (expected.provenance_policy === undefined) return true;
  try {
    const {
      protection_receipt_digest: protectionDigest,
      ...policy
    } = expected.provenance_policy;
    validateV2GitLedgerProvenanceReceipt(provenance, {
      policy,
    });
    return canonicalJson(provenance.operation_binding.repository) ===
      canonicalJson(expected.repository) &&
      provenance.operation_binding.ledger_ref === expected.ledger_ref &&
      canonicalJson(provenance.operation_binding.source_workflow) ===
        canonicalJson(expected.source_workflow) &&
      provenance.operation_binding.protection_receipt_digest ===
        protectionDigest;
  } catch {
    return false;
  }
}

function normalizeUniqueStringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) {
    throw new TypeError(`${label} must be a non-empty bounded array`);
  }
  const strings = value.map((item, index) =>
    boundedString(item, `${label}[${index}]`, 128));
  if (new Set(strings).size !== strings.length ||
      canonicalJson(strings) !== canonicalJson([...strings].sort())) {
    throw new Error(`${label} must be unique and lexically sorted`);
  }
  return strings;
}

function normalizeUniqueDecimalArray(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) {
    throw new TypeError(`${label} must be a non-empty bounded array`);
  }
  const decimals = value.map((item, index) =>
    decimal(item, `${label}[${index}]`));
  const sorted = [...decimals].sort((left, right) =>
    BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0);
  if (new Set(decimals).size !== decimals.length ||
      canonicalJson(decimals) !== canonicalJson(sorted)) {
    throw new Error(`${label} must be unique and numerically sorted`);
  }
  return decimals;
}

function normalizeRepository(value) {
  assertObject(value, "repository");
  exactKeys(value, ["owner", "name", "id", "node_id", "owner_id"], "repository");
  const part = /^[A-Za-z0-9_.-]{1,100}$/u;
  if (!part.test(value.owner) || !part.test(value.name)) {
    throw new TypeError("repository owner and name are not canonical GitHub parts");
  }
  return {
    owner: value.owner,
    name: value.name,
    id: decimal(value.id, "repository.id"),
    node_id: boundedString(value.node_id, "repository.node_id", 256),
    owner_id: decimal(value.owner_id, "repository.owner_id"),
  };
}

function normalizeAutomaticReviewRequestRepository(value) {
  assertObject(value, "automatic review request repository");
  exactKeys(value, ["owner", "name", "node_id"],
    "automatic review request repository");
  const part = /^[A-Za-z0-9_.-]{1,100}$/u;
  if (!part.test(value.owner) || !part.test(value.name)) {
    throw new TypeError("automatic review request repository is not canonical");
  }
  return {
    owner: value.owner,
    name: value.name,
    node_id: boundedString(
      value.node_id,
      "automatic review request repository.node_id",
      256,
    ),
  };
}

function candidateRepository(value) {
  const repository = normalizeRepository(value);
  return normalizeCandidateRepository({
    owner: repository.owner,
    name: repository.name,
    id: repository.id,
    node_id: repository.node_id,
  });
}

function normalizeCandidateRepository(value) {
  assertObject(value, "candidate inventory repository");
  exactKeys(value, ["owner", "name", "id", "node_id"],
    "candidate inventory repository");
  const part = /^[A-Za-z0-9_.-]{1,100}$/u;
  if (!part.test(value.owner) || !part.test(value.name)) {
    throw new TypeError("candidate inventory repository is invalid");
  }
  return {
    owner: value.owner,
    name: value.name,
    id: decimal(value.id, "candidate inventory repository.id"),
    node_id: boundedString(
      value.node_id,
      "candidate inventory repository.node_id",
      256,
    ),
  };
}

function normalizeCandidateInventoryIdentity(value) {
  assertObject(value, "candidate inventory identity");
  exactKeys(value, ["id", "node_id", "number", "created_at"],
    "candidate inventory identity");
  return {
    id: decimal(value.id, "candidate inventory identity.id"),
    node_id: boundedString(
      value.node_id,
      "candidate inventory identity.node_id",
      256,
    ),
    number: positiveInteger(
      value.number,
      "candidate inventory identity.number",
    ),
    created_at: timestamp(
      value.created_at,
      "candidate inventory identity.created_at",
    ),
  };
}

function normalizeRepositoryEndpointReceipt(value, repository) {
  assertObject(value, "repository_endpoint_receipt");
  exactKeys(value, [
    "method", "path", "status", "server_time", "raw_body_sha256",
  ], "repository_endpoint_receipt");
  const expectedPath = `/repos/${repository.owner}/${repository.name}`;
  if (
    value.method !== "GET" || value.path !== expectedPath ||
    value.status !== 200
  ) {
    throw new Error(
      "repository endpoint receipt does not bind the exact repository GET",
    );
  }
  timestamp(value.server_time, "repository_endpoint_receipt.server_time");
  digest(value.raw_body_sha256,
    "repository_endpoint_receipt.raw_body_sha256");
  return deepFreeze(structuredClone(value));
}

function normalizeLedgerRulesetReceipt(value, repository, ledgerRef) {
  assertObject(value, "capabilityReceipt.ruleset_receipt");
  exactKeys(value, [
    "receipt_digest", "configuration_digest", "protection_digest",
    "repository_id", "ledger_ref", "ruleset_ids",
    "target_includes_exact_ref", "deletion_blocked",
    "non_fast_forward_blocked", "force_pushes_blocked",
    "bypass_actors_empty",
  ], "capabilityReceipt.ruleset_receipt");
  digest(value.receipt_digest, "ruleset_receipt.receipt_digest");
  digest(value.configuration_digest, "ruleset_receipt.configuration_digest");
  digest(value.protection_digest, "ruleset_receipt.protection_digest");
  const rulesetIds = normalizeUniqueDecimalArray(
    value.ruleset_ids,
    "ruleset_receipt.ruleset_ids",
  );
  if (
    decimal(value.repository_id, "ruleset_receipt.repository_id") !==
      repository.id ||
    value.ledger_ref !== ledgerRef ||
    value.target_includes_exact_ref !== true ||
    value.deletion_blocked !== true ||
    value.non_fast_forward_blocked !== true ||
    value.force_pushes_blocked !== true ||
    value.bypass_actors_empty !== true
  ) {
    throw new Error(
      "Git ledger ruleset receipt does not exact-protect the dedicated ledger ref",
    );
  }
  return deepFreeze({
    ...structuredClone(value),
    ruleset_ids: rulesetIds,
  });
}

function normalizeLedgerProtectionReceipt(value, ruleset) {
  assertObject(value, "capabilityReceipt.protection_receipt");
  exactKeys(value, [
    "receipt_digest",
    "protection_digest",
    "ruleset_receipt_digest",
    "deletion_blocked",
    "non_fast_forward_blocked",
    "source_workflow_pinned",
  ], "capabilityReceipt.protection_receipt");
  digest(value.receipt_digest, "protection_receipt.receipt_digest");
  digest(value.protection_digest, "protection_receipt.protection_digest");
  if (
    value.ruleset_receipt_digest !== ruleset.receipt_digest ||
    value.protection_digest !== ruleset.protection_digest ||
    value.deletion_blocked !== true ||
    value.non_fast_forward_blocked !== true ||
    value.source_workflow_pinned !== true
  ) {
    throw new Error("Git ledger protection receipt is incomplete or mismatched");
  }
  return deepFreeze(structuredClone(value));
}

function normalizeControllerRelease(value) {
  assertObject(value, "controller_release");
  exactKeys(value, [
    "repository", "release_sha", "workflow_path", "workflow_ref",
    "workflow_sha", "job_workflow_ref", "job_workflow_sha",
    "caller_workflow_file_receipt_digest",
    "job_workflow_file_receipt_digest", "release_receipt_digest", "current",
  ], "controller_release");
  assertObject(value.repository, "controller_release.repository");
  exactKeys(value.repository, ["owner", "name", "id"], "controller_release.repository");
  const part = /^[A-Za-z0-9_.-]{1,100}$/u;
  if (!part.test(value.repository.owner) || !part.test(value.repository.name)) {
    throw new TypeError("controller release repository is invalid");
  }
  if (value.current !== true) throw new Error("controller release is not current");
  const normalized = {
    repository: {
      owner: value.repository.owner,
      name: value.repository.name,
      id: decimal(value.repository.id, "controller_release.repository.id"),
    },
    release_sha: sha(value.release_sha, "controller_release.release_sha"),
    workflow_path: boundedString(value.workflow_path, "controller_release.workflow_path", 512),
    workflow_ref: callerWorkflowRef(
      value.workflow_ref,
      "controller_release.workflow_ref",
    ),
    workflow_sha: sha(value.workflow_sha, "controller_release.workflow_sha"),
    job_workflow_ref: jobWorkflowRef(
      value.job_workflow_ref,
      "controller_release.job_workflow_ref",
    ),
    job_workflow_sha: sha(
      value.job_workflow_sha,
      "controller_release.job_workflow_sha",
    ),
    caller_workflow_file_receipt_digest: digest(
      value.caller_workflow_file_receipt_digest,
      "controller_release.caller_workflow_file_receipt_digest",
    ),
    job_workflow_file_receipt_digest: digest(
      value.job_workflow_file_receipt_digest,
      "controller_release.job_workflow_file_receipt_digest",
    ),
    release_receipt_digest: digest(
      value.release_receipt_digest,
      "controller_release.release_receipt_digest",
    ),
    current: true,
  };
  validateCalledWorkflowIdentity(normalized, "controller_release");
  if (normalized.release_sha !== normalized.job_workflow_sha) {
    throw new Error(
      "controller release SHA does not equal the reusable workflow SHA",
    );
  }
  return normalized;
}

function sourceWorkflow(release) {
  return {
    repository: structuredClone(release.repository),
    workflow_path: release.workflow_path,
    workflow_ref: release.workflow_ref,
    workflow_sha: release.workflow_sha,
    job_workflow_ref: release.job_workflow_ref,
    job_workflow_sha: release.job_workflow_sha,
    caller_workflow_file_receipt_digest:
      release.caller_workflow_file_receipt_digest,
    job_workflow_file_receipt_digest:
      release.job_workflow_file_receipt_digest,
    release_receipt_digest: release.release_receipt_digest,
  };
}

function normalizeSourceWorkflow(value, label) {
  assertObject(value, label);
  exactKeys(value, [
    "repository", "workflow_path", "workflow_ref", "workflow_sha",
    "job_workflow_ref", "job_workflow_sha",
    "caller_workflow_file_receipt_digest",
    "job_workflow_file_receipt_digest", "release_receipt_digest",
  ], label);
  assertObject(value.repository, `${label}.repository`);
  exactKeys(value.repository, ["owner", "name", "id"], `${label}.repository`);
  const part = /^[A-Za-z0-9_.-]{1,100}$/u;
  if (!part.test(value.repository.owner) || !part.test(value.repository.name)) {
    throw new TypeError(`${label}.repository is invalid`);
  }
  const normalized = {
    repository: {
      owner: value.repository.owner,
      name: value.repository.name,
      id: decimal(value.repository.id, `${label}.repository.id`),
    },
    workflow_path: boundedString(value.workflow_path, `${label}.workflow_path`, 512),
    workflow_ref: callerWorkflowRef(value.workflow_ref, `${label}.workflow_ref`),
    workflow_sha: sha(value.workflow_sha, `${label}.workflow_sha`),
    job_workflow_ref: jobWorkflowRef(
      value.job_workflow_ref,
      `${label}.job_workflow_ref`,
    ),
    job_workflow_sha: sha(value.job_workflow_sha, `${label}.job_workflow_sha`),
    caller_workflow_file_receipt_digest: digest(
      value.caller_workflow_file_receipt_digest,
      `${label}.caller_workflow_file_receipt_digest`,
    ),
    job_workflow_file_receipt_digest: digest(
      value.job_workflow_file_receipt_digest,
      `${label}.job_workflow_file_receipt_digest`,
    ),
    release_receipt_digest: digest(
      value.release_receipt_digest,
      `${label}.release_receipt_digest`,
    ),
  };
  validateCalledWorkflowIdentity(normalized, label);
  return normalized;
}

function callerWorkflowRef(value, label) {
  const ref = boundedString(value, label, 1024);
  if (!ref.includes("/.github/workflows/") || !ref.includes("@refs/")) {
    throw new TypeError(`${label} must be a GitHub workflow @refs/ shape`);
  }
  return ref;
}

function jobWorkflowRef(value, label) {
  const ref = boundedString(value, label, 1024);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/\.github\/workflows\/[A-Za-z0-9_.\/-]+@[0-9a-f]{40}$/u
    .test(ref)) {
    throw new TypeError(`${label} must be a reusable workflow exact-SHA ref`);
  }
  return ref;
}

function validateCalledWorkflowIdentity(value, label) {
  if (!value.workflow_path.startsWith(".github/workflows/") ||
      value.workflow_path.includes("..")) {
    throw new TypeError(`${label}.workflow_path is not canonical`);
  }
  const expected = `${value.repository.owner}/${value.repository.name}/` +
    `${value.workflow_path}@${value.job_workflow_sha}`;
  if (value.job_workflow_ref !== expected) {
    throw new Error(`${label} does not bind the reusable workflow repository/path`);
  }
}

function normalizePullRequest(value) {
  assertObject(value, "pull_request");
  exactKeys(value, ["number", "node_id"], "pull_request");
  return {
    number: positiveInteger(value.number, "pull_request.number"),
    node_id: boundedString(value.node_id, "pull_request.node_id", 256),
  };
}

function normalizeLeaseOwner(value) {
  assertObject(value, "lease owner");
  exactKeys(value, ["run_id", "run_attempt", "actor_id"], "lease owner");
  return {
    run_id: decimal(value.run_id, "lease owner.run_id"),
    run_attempt: positiveInteger(value.run_attempt, "lease owner.run_attempt"),
    actor_id: decimal(value.actor_id, "lease owner.actor_id"),
  };
}

function normalizeLeaseBinding(value, { required = false } = {}) {
  if (value === null) {
    if (required) throw new Error("active lease binding is required");
    return null;
  }
  assertObject(value, "lease binding");
  exactKeys(value, [
    "lease_id", "owner", "acquire_commit_sha", "expires_at",
  ], "lease binding");
  return {
    lease_id: boundedString(value.lease_id, "lease binding.lease_id", 256),
    owner: normalizeLeaseOwner(value.owner),
    acquire_commit_sha: sha(value.acquire_commit_sha,
      "lease binding.acquire_commit_sha"),
    expires_at: timestamp(value.expires_at, "lease binding.expires_at"),
  };
}

function normalizeControlCommentBinding(value, { required = false } = {}) {
  if (value === null) {
    if (required) throw new Error("effect record requires a control comment binding");
    return null;
  }
  assertObject(value, "control_comment_binding");
  exactKeys(value, [
    "comment_id", "comment_node_id", "raw_body_sha256",
  ], "control_comment_binding");
  return {
    comment_id: decimal(value.comment_id, "control_comment_binding.comment_id"),
    comment_node_id: boundedString(
      value.comment_node_id,
      "control_comment_binding.comment_node_id",
      256,
    ),
    raw_body_sha256: digest(
      value.raw_body_sha256,
      "control_comment_binding.raw_body_sha256",
    ),
  };
}

function normalizeCarrierSelector(value, label) {
  assertObject(value, label);
  exactKeys(value, ["kind", "id"], label);
  if (!new Set(["issue_comment", "pull_request_review", "inline_comment"])
    .has(value.kind)) {
    throw new TypeError(`${label}.kind is unsupported`);
  }
  decimal(value.id, `${label}.id`);
  return value;
}

function validateExternalActor(value, label) {
  assertObject(value, label);
  exactKeys(value, ["id", "node_id", "login", "type"], label);
  decimal(value.id, `${label}.id`);
  boundedString(value.node_id, `${label}.node_id`, 256);
  boundedString(value.login, `${label}.login`, 128);
  boundedString(value.type, `${label}.type`, 64);
}

function validateExternalApp(value, label) {
  assertObject(value, label);
  exactKeys(value, ["id", "node_id", "slug"], label);
  decimal(value.id, `${label}.id`);
  boundedString(value.node_id, `${label}.node_id`, 256);
  boundedString(value.slug, `${label}.slug`, 128);
}

function validateCodexProvider(actor, app, label) {
  if (
    actor.login !== "chatgpt-codex-connector[bot]" ||
    actor.type !== "Bot" || app.slug !== "chatgpt-codex-connector"
  ) {
    throw new Error(`${label} is not the exact GitHub Codex provider`);
  }
}

function githubUrl(value, label) {
  const text = boundedString(value, label, 2048);
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new TypeError(`${label} must be an exact github.com URL`);
  }
  if (
    parsed.protocol !== "https:" || parsed.hostname !== "github.com" ||
    parsed.username !== "" || parsed.password !== ""
  ) {
    throw new TypeError(`${label} must be an exact github.com URL`);
  }
  return text;
}

function normalizeLedgerRef(value) {
  if (value !== V2_GIT_LEDGER_REF) {
    throw new Error(`Git ledger ref must be exactly ${V2_GIT_LEDGER_REF}`);
  }
  return value;
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

function normalizeRaceAttestationResult(value) {
  return {
    label: value.label,
    commit_sha: value.commit_sha,
    outcome: value.outcome,
    http_status: value.http_status,
    server_time: value.server_time,
    raw_body_sha256: value.raw_body_sha256,
  };
}

function validateRecordLease(record, active) {
  const lease = normalizeLeaseBinding(record.lease, { required: true });
  if (
    lease.lease_id !== active.lease_id ||
    lease.acquire_commit_sha !== active.acquire_commit_sha ||
    lease.expires_at !== active.expires_at ||
    canonicalJson(lease.owner) !== canonicalJson(active.owner)
  ) {
    throw ledgerError("lease-binding", "record does not bind the active controller lease");
  }
}

function validateEnvelopeLease(envelope, active) {
  validateRecordLease(envelope, active);
}

function leaseBindingFromReceipt(receipt) {
  return {
    lease_id: receipt.lease_id,
    owner: structuredClone(receipt.owner),
    acquire_commit_sha: receipt.acquire_commit_sha,
    expires_at: receipt.expires_at,
  };
}

function leaseBindingFromValue(value) {
  assertObject(value, "effect builder lease receipt");
  const candidate = {
    lease_id: value.lease_id,
    owner: value.owner,
    acquire_commit_sha: value.acquire_commit_sha,
    expires_at: value.expires_at,
  };
  return normalizeLeaseBinding(candidate, { required: true });
}

function envelopeScope(envelope) {
  if (REPOSITORY_RECORD_TYPES.has(envelope.record_type)) return null;
  return {
    pull_request: envelope.pull_request,
    head_ref_oid: envelope.head_ref_oid,
    base_ref_oid: envelope.base_ref_oid,
    potential_merge_commit_oid: envelope.potential_merge_commit_oid,
  };
}

function recordScope(record) {
  if (REPOSITORY_RECORD_TYPES.has(record.record_type)) return null;
  return {
    pull_request: record.pull_request,
    head_ref_oid: record.head_ref_oid,
    base_ref_oid: record.base_ref_oid,
    potential_merge_commit_oid: record.potential_merge_commit_oid,
  };
}

function productionRecordIdentity(record) {
  return {
    record_type: record.record_type,
    kind: record.kind,
    effect_id: record.effect_id,
    idempotency_key: record.idempotency_key,
    // Authoritative GitHub Date normalization may rewrite timestamp-bearing
    // payload fields after the caller record was sealed. Bind the OIDC request
    // to the bytes that will actually be committed, never to the caller's
    // superseded payload digest.
    payload_digest: digestV2GitLedgerPayload(record.payload),
  };
}

function normalizeProvenanceRecordIdentity(value) {
  if (value === null) return null;
  assertObject(value, "workflow provenance record_identity");
  exactKeys(value, [
    "record_type", "kind", "effect_id", "idempotency_key", "payload_digest",
  ], "workflow provenance record_identity");
  if (!RECORD_TYPES.has(value.record_type)) {
    throw new TypeError("workflow provenance record type is not production");
  }
  const effect = new Set(["effect-intent", "effect-response"])
    .has(value.record_type);
  if (effect) {
    if (!EFFECT_KINDS.has(value.kind)) {
      throw new TypeError("workflow provenance effect kind is unsupported");
    }
    boundedString(value.effect_id, "workflow provenance effect_id", 256);
    boundedString(
      value.idempotency_key,
      "workflow provenance idempotency_key",
      256,
    );
  } else if (
    value.kind !== null || value.effect_id !== null ||
    value.idempotency_key !== null
  ) {
    throw new TypeError("workflow provenance lease identity has effect fields");
  }
  digest(value.payload_digest, "workflow provenance payload_digest");
  return value;
}

function reviewEpochDigest(scope) {
  return digestCanonical("codex-review-gate-v2-review-epoch", {
    pull_request: scope.pull_request,
    base_ref_oid: scope.base_ref_oid,
    head_ref_oid: scope.head_ref_oid,
    potential_merge_commit_oid: scope.potential_merge_commit_oid,
  });
}

function normalizeEffectScope(value) {
  if (value === null) return null;
  assertObject(value, "workflow provenance effect_scope");
  exactKeys(value, [
    "pull_request",
    "head_ref_oid",
    "base_ref_oid",
    "potential_merge_commit_oid",
  ], "workflow provenance effect_scope");
  return {
    pull_request: normalizePullRequest(value.pull_request),
    head_ref_oid: sha(
      value.head_ref_oid,
      "workflow provenance effect_scope.head_ref_oid",
    ),
    base_ref_oid: sha(
      value.base_ref_oid,
      "workflow provenance effect_scope.base_ref_oid",
    ),
    potential_merge_commit_oid: nullableSha(
      value.potential_merge_commit_oid,
      "workflow provenance effect_scope.potential_merge_commit_oid",
    ),
  };
}

function requireSameScope(actual, expected, label) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw ledgerError("scope-mismatch", `${label} does not bind the active lease scope`);
  }
}

function sealAppendReceipt(value) {
  const withoutDigest = {
    schema: V2_GIT_LEDGER_APPEND_RECEIPT_SCHEMA,
    schema_version: 1,
    ...value,
  };
  return deepFreeze({
    ...withoutDigest,
    receipt_digest: digestCanonical(
      "codex-review-gate-v2-git-ledger-append-receipt",
      withoutDigest,
    ),
  });
}

function sealBootstrapReceipt(value) {
  const withoutDigest = {
    schema: V2_GIT_LEDGER_BOOTSTRAP_RECEIPT_SCHEMA,
    schema_version: 1,
    ...value,
  };
  return deepFreeze({
    ...withoutDigest,
    receipt_digest: digestCanonical(
      "codex-review-gate-v2-git-ledger-bootstrap-receipt",
      withoutDigest,
    ),
  });
}

function sealWriteObservationReceipt(value) {
  const withoutDigest = {
    schema: V2_GIT_LEDGER_WRITE_OBSERVATION_SCHEMA,
    schema_version: 1,
    ...structuredClone(value),
  };
  return validateWriteObservationReceipt({
    ...withoutDigest,
    receipt_digest: digestCanonical(
      "codex-review-gate-v2-git-ledger-write-observation",
      withoutDigest,
    ),
  });
}

function validateWriteObservationReceipt(value) {
  assertObject(value, "write observation receipt");
  exactKeys(value, [
    "schema", "schema_version", "bootstrap_candidate_digest", "genesis",
    "race_parent_commit_sha", "contenders", "race_results",
    "winner_commit_sha", "race_final_ref_reread", "receipt_digest",
  ], "write observation receipt");
  if (
    value.schema !== V2_GIT_LEDGER_WRITE_OBSERVATION_SCHEMA ||
    value.schema_version !== 1
  ) {
    throw new Error("write observation receipt schema is unsupported");
  }
  digest(value.bootstrap_candidate_digest,
    "write observation bootstrap_candidate_digest");
  if (value.genesis !== null) validateGenesisWriteObservation(value.genesis);
  sha(value.race_parent_commit_sha,
    "write observation race_parent_commit_sha");
  if (!Array.isArray(value.contenders) || value.contenders.length !== 2) {
    throw new Error("write observation requires two contender object writes");
  }
  const contenderByLabel = new Map();
  for (const contender of value.contenders) {
    assertObject(contender, "write observation contender");
    exactKeys(contender, [
      "label", "commit_sha", "tree_sha", "blob_sha",
      "object_write_receipts",
    ], "write observation contender");
    if (!new Set(["alpha", "beta"]).has(contender.label) ||
        contenderByLabel.has(contender.label)) {
      throw new Error("write observation contender labels are invalid");
    }
    validateObjectWriteReceipts(contender);
    contenderByLabel.set(contender.label, contender);
  }
  if (!Array.isArray(value.race_results) || value.race_results.length !== 2) {
    throw new Error("write observation requires two race results");
  }
  const winners = [];
  const losers = [];
  for (const result of value.race_results) {
    validateRaceResultReceipt(result);
    const contender = contenderByLabel.get(result.label);
    if (contender?.commit_sha !== result.commit_sha) {
      throw new Error("write observation race result differs from object write");
    }
    (result.outcome === "winner" ? winners : losers).push(result);
  }
  if (
    winners.length !== 1 || losers.length !== 1 ||
    sha(value.winner_commit_sha, "write observation winner_commit_sha") !==
      winners[0].commit_sha
  ) {
    throw new Error("write observation lacks one winner and one loser");
  }
  validateRefReceipt(value.race_final_ref_reread);
  if (value.race_final_ref_reread.target_commit_sha !== value.winner_commit_sha) {
    throw new Error("write observation ref reread differs from its winner");
  }
  digest(value.receipt_digest, "write observation receipt_digest");
  const { receipt_digest: _receiptDigest, ...withoutDigest } = value;
  if (digestCanonical("codex-review-gate-v2-git-ledger-write-observation",
    withoutDigest) !== value.receipt_digest) {
    throw new Error("write observation receipt digest is invalid");
  }
  return deepFreeze(structuredClone(value));
}

function validateRaceResultReceipt(value) {
  assertObject(value, "write observation race result");
  exactKeys(value, [
    "label", "commit_sha", "outcome", "http_status", "server_time",
    "raw_body_sha256",
  ], "write observation race result");
  if (!new Set(["alpha", "beta"]).has(value.label)) {
    throw new Error("write observation race label is invalid");
  }
  sha(value.commit_sha, "write observation race commit_sha");
  if (
    (value.outcome === "winner" && value.http_status !== 200) ||
    (value.outcome === "non-fast-forward" &&
      !CONFLICT_PROFILES.has(value.http_status)) ||
    !new Set(["winner", "non-fast-forward"]).has(value.outcome)
  ) {
    throw new Error("write observation race outcome is invalid");
  }
  timestamp(value.server_time, "write observation race server_time");
  digest(value.raw_body_sha256, "write observation race raw_body_sha256");
}

function validateGenesisWriteObservation(value) {
  assertObject(value, "genesis write observation");
  exactKeys(value, [
    "commit_sha", "tree_sha", "blob_sha", "object_write_receipts",
    "ref_create", "ref_reread",
  ], "genesis write observation");
  validateObjectWriteReceipts(value);
  validateCaptureReceipt(value.ref_create, "genesis ref create");
  if (value.ref_create.http_status !== 201) {
    throw new Error("genesis ref create was not successful");
  }
  validateRefReceipt(value.ref_reread);
  if (value.ref_reread.target_commit_sha !== value.commit_sha) {
    throw new Error("genesis ref reread differs from its commit");
  }
}

function validateObjectWriteReceipts(value) {
  const objectShas = {
    blob: sha(value.blob_sha, "object write blob_sha"),
    tree: sha(value.tree_sha, "object write tree_sha"),
    commit: sha(value.commit_sha, "object write commit_sha"),
  };
  assertObject(value.object_write_receipts, "object write receipts");
  exactKeys(value.object_write_receipts, ["blob", "tree", "commit"],
    "object write receipts");
  for (const [kind, receipt] of Object.entries(value.object_write_receipts)) {
    assertObject(receipt, `${kind} object write receipt`);
    exactKeys(receipt, [
      "object_sha", "http_status", "server_time", "raw_body_sha256",
    ], `${kind} object write receipt`);
    if (
      receipt.object_sha !== objectShas[kind] ||
      receipt.http_status !== 201
    ) {
      throw new Error(`${kind} object write receipt is not exact and successful`);
    }
    timestamp(receipt.server_time, `${kind} object write server_time`);
    digest(receipt.raw_body_sha256, `${kind} object write raw_body_sha256`);
  }
}

function validateCaptureReceipt(value, label) {
  assertObject(value, label);
  exactKeys(value, ["http_status", "server_time", "raw_body_sha256"], label);
  positiveInteger(value.http_status, `${label}.http_status`);
  timestamp(value.server_time, `${label}.server_time`);
  digest(value.raw_body_sha256, `${label}.raw_body_sha256`);
}

function captureReceipt(capture) {
  return {
    http_status: capture.http_status,
    server_time: capture.server_time,
    raw_body_sha256: rawDigest(capture.raw_body),
  };
}

function refReceipt(value) {
  return {
    ref: value.ref,
    node_id: value.node_id,
    target_commit_sha: value.target_commit_sha,
    server_time: value.server_time,
    raw_body_sha256: value.raw_body_sha256,
  };
}

function validateRefReceipt(value) {
  assertObject(value, "ref receipt");
  exactKeys(value, [
    "ref", "node_id", "target_commit_sha", "server_time", "raw_body_sha256",
  ], "ref receipt");
  normalizeLedgerRef(value.ref);
  boundedString(value.node_id, "ref receipt.node_id", 256);
  sha(value.target_commit_sha, "ref receipt.target_commit_sha");
  timestamp(value.server_time, "ref receipt.server_time");
  digest(value.raw_body_sha256, "ref receipt.raw_body_sha256");
}

function responseSha(value, label) {
  assertObject(value, label);
  return sha(value.sha, `${label}.sha`);
}

function validateCommitIdentity({ commit, commitSha, treeSha, parents, envelope }) {
  assertObject(commit.author, "Git ledger commit.author");
  assertObject(commit.committer, "Git ledger commit.committer");
  const identity = {
    name: COMMIT_AUTHOR.name,
    email: COMMIT_AUTHOR.email,
    date: envelope.server_observed_at,
  };
  for (const [label, value] of [
    ["author", commit.author],
    ["committer", commit.committer],
  ]) {
    if (
      value.name !== identity.name || value.email !== identity.email ||
      timestamp(value.date, `Git ledger commit.${label}.date`) !== identity.date
    ) {
      throw ledgerError(
        "commit-identity",
        `Git ledger commit ${label} differs from the canonical identity`,
      );
    }
  }
  const lines = [
    `tree ${treeSha}`,
    ...parents.map((parent) => `parent ${parent}`),
    `author ${identity.name} <${identity.email}> ${gitTimestamp(identity.date)}`,
    `committer ${identity.name} <${identity.email}> ${gitTimestamp(identity.date)}`,
    "",
    commitMessage(envelope),
  ];
  const bytes = Buffer.from(lines.join("\n"), "utf8");
  if (gitObjectSha("commit", bytes) !== commitSha) {
    throw ledgerError(
      "commit-object-identity",
      "Git ledger commit response fields do not hash to its exact object identity",
    );
  }
}

function gitTimestamp(value) {
  const date = new Date(timestamp(value, "Git commit timestamp"));
  return `${Math.floor(date.getTime() / 1000)} +0000`;
}

function gitObjectSha(type, bytes) {
  const header = Buffer.from(`${type} ${bytes.byteLength}\0`, "utf8");
  return createHash("sha1").update(header).update(bytes).digest("hex");
}

function canonicalTreeSha(blobSha) {
  const treeBytes = Buffer.concat([
    Buffer.from(`100644 ${V2_GIT_LEDGER_BLOB_PATH}\0`, "utf8"),
    Buffer.from(sha(blobSha, "Git ledger tree blob SHA"), "hex"),
  ]);
  return gitObjectSha("tree", treeBytes);
}

function commitMessage(envelope) {
  return `Codex Review Gate v2: ${envelope.record_type} #${envelope.sequence}`;
}

function githubServerTime(value) {
  const text = boundedString(value, "GitHub Date header", 128);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) {
    throw ledgerError("server-time", "GitHub response lacks a valid Date header");
  }
  return new Date(parsed).toISOString();
}

function timestamp(value, label) {
  if (typeof value !== "string" || !TIMESTAMP.test(value)) {
    throw new TypeError(`${label} must be a canonical UTC timestamp`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} is invalid`);
  return new Date(parsed).toISOString();
}

function addSeconds(value, seconds) {
  const at = timestamp(value, "time arithmetic input");
  const duration = positiveInteger(seconds, "time arithmetic seconds");
  return new Date(Date.parse(at) + duration * 1000).toISOString();
}

function sha(value, label) {
  if (typeof value !== "string" || !SHA.test(value)) {
    throw new TypeError(`${label} must be a lowercase full SHA`);
  }
  return value;
}

function nullableSha(value, label) {
  return value === null ? null : sha(value, label);
}

function requireNull(value, label) {
  if (value !== null) throw new TypeError(`${label} must be null`);
  return null;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} must be sha256:<64 lowercase hex>`);
  }
  return value;
}

function decimal(value, label) {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new TypeError(`${label} must be a canonical decimal string`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer`);
  }
  return value;
}

function integerBetween(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(
      `${label} must be an integer from ${minimum} through ${maximum}`,
    );
  }
  return value;
}

function validateUniqueBoundedStrings(value, label, maximumItems) {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  const seen = new Set();
  for (const [index, item] of value.entries()) {
    const normalized = boundedString(item, `${label}[${index}]`, 1024);
    if (seen.has(normalized)) {
      throw new Error(`${label} must not contain duplicates`);
    }
    seen.add(normalized);
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

function compactOidcJwt(value) {
  const jwt = boundedString(value, "workflow provenance compact JWT", 32 * 1024);
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(jwt)) {
    throw new TypeError("workflow provenance compact JWT is not canonical");
  }
  return jwt;
}

function nullableBoundedString(value, label, maximum) {
  return value === null ? null : boundedString(value, label, maximum);
}

function assertObject(value, label) {
  if (
    value === null || typeof value !== "object" || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(keys)) {
    throw new TypeError(`${label} must use the closed key set ${keys.join(", ")}`);
  }
}

function validateCanonicalJsonValue(value, label, depth = 0) {
  if (depth > 32) throw new TypeError(`${label} exceeds canonical JSON depth`);
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`${label} numbers must be safe integers`);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 10_000) throw new TypeError(`${label} array exceeds its cap`);
    for (const [index, item] of value.entries()) {
      validateCanonicalJsonValue(item, `${label}[${index}]`, depth + 1);
    }
    return;
  }
  assertObject(value, label);
  if (Object.keys(value).length > 10_000) {
    throw new TypeError(`${label} object exceeds its key cap`);
  }
  for (const [key, item] of Object.entries(value)) {
    if (key.length === 0) throw new TypeError(`${label} contains an empty key`);
    validateCanonicalJsonValue(item, `${label}.${key}`, depth + 1);
  }
}

function rawDigest(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function digestCanonical(domain, value) {
  return rawDigest(`${domain}\0${canonicalJson(value)}`);
}

// Runner reservation and head-ledger receipts predate the Git ledger and use
// their own length-prefixed domain separation. Keep this distinct from the
// Git-ledger envelope digest so real runner receipts interoperate byte-for-byte.
function runnerDigestCanonical(domain, value) {
  const domainBytes = Buffer.from(domain, "utf8");
  const valueBytes = Buffer.from(canonicalJson(value), "utf8");
  const hash = createHash("sha256");
  hash.update(`${domainBytes.length}:`);
  hash.update(domainBytes);
  hash.update("\0");
  hash.update(`${valueBytes.length}:`);
  hash.update(valueBytes);
  return `sha256:${hash.digest("hex")}`;
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

function ledgerError(code, message, cause = undefined) {
  const error = cause === undefined ? new Error(message) : new Error(message, { cause });
  error.code = code;
  return error;
}
