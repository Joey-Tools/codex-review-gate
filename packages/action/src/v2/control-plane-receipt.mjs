import { createHash } from "node:crypto";

import {
  assertV2GitLedgerControlPlaneAuthorityHandle,
  assertV2GitLedgerEstablishedRunnerStateAuthorityHandle,
  assertV2GitLedgerInitialRunnerStateAuthorityHandle,
  validateV2GitLedgerStatusWriteResponseReceipt,
  V2_GIT_LEDGER_REF,
} from "./git-ledger.mjs";
import {
  deriveV2SelectionProjection,
  V2_PROJECTOR_CONTROLLER_SCHEMA,
  V2_PROJECTOR_CONTROLLER_SCHEMA_VERSION,
  V2_PROJECTOR_FINAL_REREAD_ASSURANCE,
} from "./projector.mjs";
import {
  validateV2PublicReportSelectionAuthority,
  V2_PUBLIC_REPORT_SELECTION_AUTHORITY_SCHEMA,
  V2_PUBLIC_REPORT_SELECTION_AUTHORITY_SCHEMA_VERSION,
} from "./public-report-projector.mjs";
import { assertV2WorkflowPreflightHandle } from "./workflow-preflight.mjs";

export const V2_CONTROL_PLANE_RECEIPT_SCHEMA =
  "codex-review-gate-control-plane-receipt-v2";
export const V2_CONTROL_PLANE_RECEIPT_SCHEMA_VERSION = 2;
export const V2_CONTROL_PLANE_LEDGER_REF = V2_GIT_LEDGER_REF;
export const V2_CONTROL_PLANE_EFFECT_KINDS = Object.freeze([
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
export const V2_CONTROL_PLANE_HEAD_HISTORY_INTENT_KINDS = Object.freeze([
  "automatic-request-reservation",
]);
export const V2_CONTROL_PLANE_HEAD_HISTORY_RESPONSE_KINDS = Object.freeze([
  "review-request",
  "request-binding",
  "artifact-binding",
  "scheduler-state",
]);
export const V2_PRODUCTION_RUNNER_AUTHORITY_SCHEMA =
  "codex-review-gate-production-runner-authority-v2";

const CONTROL_PLANE_RECEIPT_HANDLES = new WeakSet();
const CONTROL_PLANE_RECEIPT_PRIVATE_AUTHORITY = new WeakMap();
const PRODUCTION_RUNNER_AUTHORITY_HANDLES = new WeakSet();
const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const GENERATION_ID = /^(automatic|manual):([1-9][0-9]*)$/u;
const TIMESTAMP =
  /^(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d{1,3}))?Z$/u;
const MAX_AUTOMATIC_GENERATIONS = 3;
const MAX_MANUAL_GENERATIONS = 64;
const MAX_LEGACY_REQUEST_BINDINGS =
  MAX_AUTOMATIC_GENERATIONS + MAX_MANUAL_GENERATIONS;
const MAX_RECORDS = 4_096;
const STATUS_CONTEXT = "codex/github-review-gate";
const HEAD_HISTORY_INTENT_KINDS = new Set(
  V2_CONTROL_PLANE_HEAD_HISTORY_INTENT_KINDS,
);
const HEAD_HISTORY_RESPONSE_KINDS = new Set(
  V2_CONTROL_PLANE_HEAD_HISTORY_RESPONSE_KINDS,
);

const TOP_KEYS = Object.freeze([
  "schema",
  "schema_version",
  "repository",
  "repository_endpoint_receipt",
  "ledger_ref",
  "scope",
  "genesis_oid",
  "tip_oid",
  "tip_tree_digest",
  "ruleset_receipt",
  "protection_receipt",
  "capability_attestation",
  "record_count",
  "fully_reachable_record_manifest_digest",
  "two_pass_reads",
  "source_inventory_digest",
  "source_authority_digest",
  "source_binding_digest",
  "provenance_reverification_digest",
  "derived",
  "receipt_digest",
]);
const DERIVED_KEYS = Object.freeze([
  "budget",
  "generations",
  "recovery_bindings",
  "request_bindings",
  "artifact_bindings",
  "no_start_observations",
  "thread_resolution_observations",
  "status_bindings",
  "sentinel_binding",
  "control_comment_binding",
  "sticky_comment_binding",
  "derived_digest",
]);
const LEGACY_REQUEST_BINDING_KEYS = Object.freeze([
  "record_oid", "payload_digest", "generation_id", "generation_kind",
  "generation_index", "base_oid", "head_oid", "request_id",
  "request_node_id", "request_url", "body_sha256", "created_at",
  "updated_at", "raw_body_sha256", "actor_id", "actor_node_id",
  "controlled",
]);
const REQUEST_BINDING_KEYS = Object.freeze([
  ...LEGACY_REQUEST_BINDING_KEYS,
  "current_incarnation",
]);
const LEGACY_RECOVERY_BINDING_KEYS = Object.freeze([
  "record_oid", "payload_digest", "prior_generation_id",
  "next_generation_id", "committed", "recovery_transition_digest",
  "intent_recovery_authority_digest", "completion_recovery_authority",
  "completion_recovery_authority_digest",
  "completion_scheduler_observation_record_oid",
  "completion_full_scope_receipt_digest", "server_time",
]);
const RECOVERY_BINDING_KEYS = Object.freeze([
  ...LEGACY_RECOVERY_BINDING_KEYS,
  "ledger_index", "ledger_order", "next_request_binding_record_oid",
  "next_request_id",
]);
const RECOVERY_AUTHORITY_KEYS = Object.freeze([
  "schema", "schema_version", "decision", "snapshot_fingerprint",
  "review_epoch_id", "prior_generation_id", "prior_generation_index",
  "next_generation_id", "next_generation_index", "prior_request_id",
  "prior_request_binding_record_oid",
  "prior_request_binding_receipt_digest", "scope", "scope_digest",
  "finding_ids", "closure_ids", "closure_records", "finding_observed_at",
  "closure_observed_at", "final_snapshot_server_time", "pagination_sha256",
  "final_reread_sha256", "evidence_snapshot_digest", "reducer_input_digest",
  "reducer_report_digest", "same_review_epoch", "authority_digest",
]);

export class V2ControlPlaneReceiptError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "V2ControlPlaneReceiptError";
    this.code = code;
  }
}

/**
 * Project controller facts from one fresh, closure-bound Git-ledger authority
 * handle. A caller-supplied or reconstructed ledger load is never accepted.
 *
 * The returned object is serializable audit evidence. Execution authority is
 * deliberately process-local: only this exact branded object may be consumed
 * by deriveV2ProjectorControlAuthority. Rehashing or deserializing the audit
 * object does not recreate authority.
 */
export function createV2ControlPlaneReceiptFromGitLedgerAuthority(authority) {
  const handle = assertV2GitLedgerControlPlaneAuthorityHandle(authority);
  const load = handle.load;
  const queryRecordCount = handle.scoped_authority.ordered_records.length;
  if (queryRecordCount !== load.records.length) {
    throw new V2ControlPlaneReceiptError(
      "CONTROL_PLANE_QUERY_CARDINALITY_MISMATCH",
      "control plane authority query rows differ from its load manifest",
    );
  }
  const derivedInput = deriveControllerFacts(handle);
  const derived = {
    ...derivedInput,
    derived_digest: digestCanonical(
      "codex-review-gate-v2-control-plane-derived-facts",
      derivedInput,
    ),
  };
  const withoutDigest = {
    schema: V2_CONTROL_PLANE_RECEIPT_SCHEMA,
    schema_version: V2_CONTROL_PLANE_RECEIPT_SCHEMA_VERSION,
    repository: structuredClone(load.repository),
    repository_endpoint_receipt:
      structuredClone(load.repository_endpoint_receipt),
    ledger_ref: load.ledger_ref,
    scope: projectScope(handle.scope, load.repository),
    genesis_oid: load.genesis_commit_sha,
    tip_oid: load.tip_commit_sha,
    tip_tree_digest: load.tip_tree_digest,
    ruleset_receipt: structuredClone(load.ruleset_receipt),
    protection_receipt: structuredClone(load.protection_receipt),
    capability_attestation: structuredClone(load.capability_attestation),
    record_count: queryRecordCount,
    fully_reachable_record_manifest_digest:
      load.fully_reachable_record_manifest_digest,
    two_pass_reads: structuredClone(load.two_pass_reads),
    source_inventory_digest: load.inventory_digest,
    source_authority_digest: handle.scoped_authority.authority_digest,
    source_binding_digest: handle.binding_digest,
    provenance_reverification_digest:
      load.provenance_reverification_digest,
    derived,
  };
  const receipt = deepFreeze({
    ...withoutDigest,
    receipt_digest: digestCanonical(
      "codex-review-gate-v2-control-plane-receipt",
      withoutDigest,
    ),
  });
  validateV2ControlPlaneReceipt(receipt);
  CONTROL_PLANE_RECEIPT_HANDLES.add(receipt);
  CONTROL_PLANE_RECEIPT_PRIVATE_AUTHORITY.set(receipt, deepFreeze({
    control_plane_authority: handle,
    runner_state: structuredClone(handle.scoped_authority.runner_state),
  }));
  return receipt;
}

/**
 * Validate the closed serialized audit shape. This does not grant authority;
 * callers that need reducer/controller facts must use the branded assertion.
 */
export function validateV2ControlPlaneReceipt(value) {
  assertObject(value, "control_plane_receipt");
  exactKeys(value, TOP_KEYS, "control_plane_receipt");
  exact(value.schema, V2_CONTROL_PLANE_RECEIPT_SCHEMA,
    "control_plane_receipt.schema");
  const schemaVersion = integer(
    value.schema_version,
    1,
    V2_CONTROL_PLANE_RECEIPT_SCHEMA_VERSION,
    "control_plane_receipt.schema_version",
  );
  validateRepository(value.repository);
  validateRepositoryEndpointReceipt(
    value.repository_endpoint_receipt,
    value.repository,
  );
  exact(value.ledger_ref, V2_CONTROL_PLANE_LEDGER_REF,
    "control_plane_receipt.ledger_ref");
  validateProjectedScope(value.scope, value.repository);
  sha(value.genesis_oid, "control_plane_receipt.genesis_oid");
  sha(value.tip_oid, "control_plane_receipt.tip_oid");
  digest(value.tip_tree_digest, "control_plane_receipt.tip_tree_digest");
  validateOpaqueReceipt(value.ruleset_receipt,
    "control_plane_receipt.ruleset_receipt");
  validateOpaqueReceipt(value.protection_receipt,
    "control_plane_receipt.protection_receipt");
  validateCapabilityAttestation(value.capability_attestation);
  integer(value.record_count, 1, MAX_RECORDS,
    "control_plane_receipt.record_count");
  digest(value.fully_reachable_record_manifest_digest,
    "control_plane_receipt.fully_reachable_record_manifest_digest");
  validateTwoPassReads(value.two_pass_reads, value.tip_oid);
  digest(value.source_inventory_digest,
    "control_plane_receipt.source_inventory_digest");
  digest(value.source_authority_digest,
    "control_plane_receipt.source_authority_digest");
  digest(value.source_binding_digest,
    "control_plane_receipt.source_binding_digest");
  digest(value.provenance_reverification_digest,
    "control_plane_receipt.provenance_reverification_digest");
  validateDerived(value.derived, value.scope, schemaVersion, value.record_count);
  digest(value.receipt_digest, "control_plane_receipt.receipt_digest");
  const { receipt_digest: _receiptDigest, ...withoutDigest } = value;
  if (digestCanonical("codex-review-gate-v2-control-plane-receipt",
    withoutDigest) !== value.receipt_digest) {
    fail("RECEIPT_DIGEST_MISMATCH",
      "control plane receipt digest is invalid");
  }
  return value;
}

export function assertV2ControlPlaneReceiptHandle(value, expectedScope = null) {
  if ((typeof value !== "object" || value === null) ||
      !CONTROL_PLANE_RECEIPT_HANDLES.has(value)) {
    fail(
      "UNTRUSTED_CONTROL_PLANE_RECEIPT_HANDLE",
      "control plane authority must come directly from the live Git-ledger adapter",
    );
  }
  validateV2ControlPlaneReceipt(value);
  if (expectedScope !== null) validateExpectedScope(expectedScope, value.scope);
  return value;
}

/**
 * Return only controller facts derived from reachable paired ledger records.
 * Comments, statuses, configuration, and caller JSON never supply counters.
 */
export function deriveV2ProjectorControlAuthority(receipt, expectedScope) {
  const value = assertV2ControlPlaneReceiptHandle(receipt, expectedScope);
  return deepFreeze({
    control_plane_binding: {
      receipt_digest: value.receipt_digest,
      ledger_ref: value.ledger_ref,
      repository_id: value.repository.id,
      repository_node_id: value.repository.node_id,
      repository_owner_id: value.repository.owner_id,
      genesis_oid: value.genesis_oid,
      tip_oid: value.tip_oid,
      tip_tree_digest: value.tip_tree_digest,
      fully_reachable_record_manifest_digest:
        value.fully_reachable_record_manifest_digest,
      source_inventory_digest: value.source_inventory_digest,
      source_authority_digest: value.source_authority_digest,
      source_binding_digest: value.source_binding_digest,
      oidc_attestation_digest:
        value.capability_attestation.oidc_attestation_digest,
      provider_identity_policy_catalog_digest:
        value.capability_attestation.provider_identity_policy_catalog_digest,
      provenance_reverification_digest:
        value.provenance_reverification_digest,
    },
    budget: {
      automatic_requests_on_head:
        value.derived.budget.automatic_requests_on_head,
      automatic_reservations_on_head:
        value.derived.budget.automatic_reservations_on_head,
      manual_requests_in_epoch:
        value.derived.budget.manual_requests_in_epoch,
    },
    generations: structuredClone(value.derived.generations),
    generation_admissions: projectGenerationAdmissions(value.derived),
    request_bindings: value.derived.request_bindings.map((item) => ({
      id: item.request_id,
      kind: item.generation_kind,
      base_oid: item.base_oid,
      head_oid: item.head_oid,
      current_incarnation: item.current_incarnation,
      controlled: item.controlled,
      generation_id: item.generation_id,
      generation_kind: item.generation_kind,
      generation_index: item.generation_index,
    })),
    artifact_bindings: value.derived.artifact_bindings.map((item) => ({
      id: item.artifact_selector.id,
      request_id: item.request_id,
      generation_id: item.generation_id,
      request_node_id: item.request_node_id,
      artifact_selector: structuredClone(item.artifact_selector),
      artifact_node_id: item.artifact_node_id,
      artifact_url: item.artifact_url,
      artifact_type: item.artifact_type,
      artifact_created_at: item.artifact_created_at,
      raw_body_sha256: item.raw_body_sha256,
      actor: structuredClone(item.actor),
      app: structuredClone(item.app),
    })),
    no_start_observations: value.derived.no_start_observations.map((item) => ({
      request_id: item.request_id,
      carrier_selector: structuredClone(item.carrier_selector),
      first_seen_at: item.first_observed_at,
      first_run_id: item.first_run_id,
      confirmation_run_id: item.confirmation_run_id,
      request_run_id: item.request_run_id,
    })),
    thread_resolution_observations:
      value.derived.thread_resolution_observations.map((item) => ({
        thread_id: item.thread_id,
        repository_id: value.repository.node_id,
        pull_request_number: value.scope.pull_request_number,
        head_oid: item.head_oid,
        response_server_time: item.response_server_time,
        run_id: item.run_id,
        is_resolved: true,
      })),
    sentinel_binding: value.derived.sentinel_binding === null
      ? null
      : structuredClone(value.derived.sentinel_binding),
    status_bindings: structuredClone(value.derived.status_bindings),
    control_comment_binding: value.derived.control_comment_binding === null
      ? null
      : structuredClone(value.derived.control_comment_binding),
    sticky_comment_binding: value.derived.sticky_comment_binding === null
      ? null
      : structuredClone(value.derived.sticky_comment_binding),
  });
}

/**
 * Build the only production runner authority from live branded preflight and
 * protected-ledger handles. Neither serialized audit receipt can be re-sealed
 * into execution authority. The adapter keeps selection, provider identity,
 * reducer controller facts, and runner history on one digest-bound scope.
 */
export function createV2ProductionRunnerAuthority({
  preflight_handle,
  control_plane_receipt,
  initial_runner_state_authority = null,
  established_runner_state_authority = null,
  expected_scope = null,
}) {
  const preflight = assertV2WorkflowPreflightHandle(preflight_handle);
  const receipt = assertV2ControlPlaneReceiptHandle(
    control_plane_receipt,
    expected_scope,
  );
  const privateAuthority = CONTROL_PLANE_RECEIPT_PRIVATE_AUTHORITY.get(receipt);
  if (
    privateAuthority === undefined ||
    privateAuthority.control_plane_authority === undefined ||
    privateAuthority.runner_state === null
  ) {
    fail(
      "RUNNER_STATE_AUTHORITY_UNAVAILABLE",
      "protected-ledger receipt has no closure-bound runner state",
    );
  }
  if (
    preflight.repository.id !== receipt.repository.id ||
    preflight.repository.node_id !== receipt.repository.node_id ||
    preflight.repository.owner_id !== receipt.repository.owner_id ||
    preflight.repository.owner !== receipt.repository.owner ||
    preflight.repository.name !== receipt.repository.name
  ) {
    fail(
      "PREFLIGHT_CONTROL_PLANE_SCOPE_MISMATCH",
      "live preflight and protected-ledger receipt bind different repositories",
    );
  }
  const selection = deriveV2SelectionProjection({
    selection_policy: preflight.selection_policy,
    server_enforcement: preflight.server_enforcement,
  });
  const control = deriveV2ProjectorControlAuthority(receipt, receipt.scope);
  const runnerState = structuredClone(privateAuthority.runner_state);
  const isInitialBoundary = runnerState.scheduling === null;
  if (isInitialBoundary && established_runner_state_authority !== null) {
    fail(
      "ESTABLISHED_RUNNER_STATE_AUTHORITY_UNEXPECTED",
      "an empty scheduler history cannot consume established runner authority",
    );
  }
  if (!isInitialBoundary && initial_runner_state_authority !== null) {
    fail(
      "INITIAL_RUNNER_STATE_AUTHORITY_UNEXPECTED",
      "an established scheduler history cannot consume initial runner authority",
    );
  }
  const initialAuthority = isInitialBoundary
    ? bindInitialRunnerStateAuthority({
      initial_runner_state_authority,
      control_plane_authority: privateAuthority.control_plane_authority,
      control_plane_receipt: receipt,
      control_runner_state: runnerState,
      preflight_handle,
      preflight,
    })
    : null;
  const establishedAuthority = isInitialBoundary
    ? null
    : bindEstablishedRunnerStateAuthority({
      established_runner_state_authority,
      control_plane_authority: privateAuthority.control_plane_authority,
      control_plane_receipt: receipt,
      control_runner_state: runnerState,
      preflight_handle,
      preflight,
    });
  const executionAuthority = initialAuthority ?? establishedAuthority;
  const serverEnforcement = selection.public_selection.selected
    ? preflight.server_enforcement.ruleset.required &&
        preflight.server_enforcement.workflow.present &&
        preflight.server_enforcement.workflow.compatible &&
        preflight.server_enforcement.ruleset.compatible &&
        preflight.server_enforcement.app.bound &&
        preflight.server_enforcement.app.source_matches
      ? "enforced"
      : "not-enforced"
    : "not-applicable";
  const providerIdentity = projectProviderIdentityAuthority(
    preflight.provider_identity_authority,
  );
  if (providerIdentity.catalog_digest !==
      preflight.provider_identity_policy.catalog_digest) {
    fail(
      "PROVIDER_IDENTITY_POLICY_MISMATCH",
      "live provider authority differs from its stable catalog policy",
    );
  }
  if (preflight.provider_identity_policy.catalog_digest !==
      receipt.capability_attestation.provider_identity_policy_catalog_digest) {
    fail(
      "PROVIDER_IDENTITY_CAPABILITY_MISMATCH",
      "live provider policy differs from the active protected-ledger capability",
    );
  }
  const sourceBinding = {
    preflight_receipt_digest: preflight.receipt_digest,
    preflight_configuration_digest: preflight.configuration_digest,
    control_plane_receipt_digest: receipt.receipt_digest,
    control_plane_source_binding_digest: receipt.source_binding_digest,
    scope: structuredClone(receipt.scope),
    selection: structuredClone(selection),
    server_enforcement: serverEnforcement,
    provider_identity_policy_catalog_digest:
      preflight.provider_identity_policy.catalog_digest,
    provider_identity: structuredClone(providerIdentity),
    runner_state_digest: runnerState.runner_state_digest,
    initial_runner_state_authority_digest:
      initialAuthority === null ? null : initialAuthority.authority_digest,
    established_runner_state_authority_digest:
      establishedAuthority === null
        ? null
        : establishedAuthority.authority_digest,
  };
  const sourceBindingDigest = digestCanonical(
    "codex-review-gate-v2-production-runner-source-binding",
    sourceBinding,
  );
  const publicReportAuthority = validateV2PublicReportSelectionAuthority({
    schema: V2_PUBLIC_REPORT_SELECTION_AUTHORITY_SCHEMA,
    schema_version: V2_PUBLIC_REPORT_SELECTION_AUTHORITY_SCHEMA_VERSION,
    repository_node_id: receipt.scope.repository_node_id,
    pull_request_node_id: receipt.scope.pull_request_node_id,
    head_ref_oid: receipt.scope.head_oid,
    selection: structuredClone(selection.public_selection),
    server_enforcement: serverEnforcement,
    authority_receipt_digest: sourceBindingDigest,
  });
  const projectorController = {
    schema: V2_PROJECTOR_CONTROLLER_SCHEMA,
    schema_version: V2_PROJECTOR_CONTROLLER_SCHEMA_VERSION,
    selection: { policy: preflight.selection_policy },
    server_enforcement: structuredClone(preflight.server_enforcement),
    budget: structuredClone(control.budget),
    request_bindings: structuredClone(control.request_bindings),
    generation_admissions: structuredClone(control.generation_admissions),
    artifact_bindings: structuredClone(control.artifact_bindings),
    thread_resolution_observations:
      structuredClone(control.thread_resolution_observations),
    no_start_observations: structuredClone(control.no_start_observations),
    final_reread: {
      required: true,
      assurance: V2_PROJECTOR_FINAL_REREAD_ASSURANCE,
    },
  };
  const withoutDigest = {
    schema: V2_PRODUCTION_RUNNER_AUTHORITY_SCHEMA,
    schema_version: 1,
    scope: structuredClone(receipt.scope),
    source_binding_digest: sourceBindingDigest,
    control_plane_binding: structuredClone(control.control_plane_binding),
    projector_controller: projectorController,
    public_report_authority: structuredClone(publicReportAuthority),
    provider_identity_authority: providerIdentity,
    runner_state: runnerState,
    scheduling: structuredClone(executionAuthority.scheduling),
    head_ledger: structuredClone(executionAuthority.head_ledger),
    effect_barrier: "scheduler-observation-required",
  };
  const authority = deepFreeze({
    ...withoutDigest,
    authority_digest: digestCanonical(
      "codex-review-gate-v2-production-runner-authority",
      withoutDigest,
    ),
  });
  PRODUCTION_RUNNER_AUTHORITY_HANDLES.add(authority);
  return authority;
}

function bindInitialRunnerStateAuthority({
  initial_runner_state_authority: initialRunnerStateAuthority,
  control_plane_authority: controlPlaneAuthority,
  control_plane_receipt: receipt,
  control_runner_state: runnerState,
  preflight_handle: preflightHandle,
  preflight,
}) {
  if (runnerState.scheduling !== null) {
    if (initialRunnerStateAuthority !== null) {
      fail(
        "INITIAL_RUNNER_STATE_AUTHORITY_UNEXPECTED",
        "an established scheduler history cannot consume initial runner authority",
      );
    }
    return null;
  }
  if (initialRunnerStateAuthority === null) {
    fail(
      "INITIAL_RUNNER_STATE_AUTHORITY_REQUIRED",
      "an empty scheduler history requires same-load initial runner authority",
    );
  }
  let initial;
  try {
    initial = assertV2GitLedgerInitialRunnerStateAuthorityHandle(
      initialRunnerStateAuthority,
      {
        control_plane_authority: controlPlaneAuthority,
        preflight_handle: preflightHandle,
      },
    );
  } catch (error) {
    fail(
      "INITIAL_RUNNER_STATE_AUTHORITY_UNTRUSTED",
      `initial runner authority is not bound to this control plane: ${
        typeof error?.code === "string" ? error.code : "invalid-authority"
      }`,
    );
  }

  const mismatches = runnerStateAuthorityBoundaryMismatches({
    authority: initial,
    control_plane_authority: controlPlaneAuthority,
    control_plane_receipt: receipt,
    control_runner_state: runnerState,
    preflight,
  });
  if (mismatches.length > 0) {
    fail(
      "INITIAL_RUNNER_STATE_AUTHORITY_MISMATCH",
      `initial runner authority differs from its same-load boundary: ${
        mismatches.join(", ")
      }`,
    );
  }
  return initial;
}

function bindEstablishedRunnerStateAuthority({
  established_runner_state_authority: establishedRunnerStateAuthority,
  control_plane_authority: controlPlaneAuthority,
  control_plane_receipt: receipt,
  control_runner_state: runnerState,
  preflight_handle: preflightHandle,
  preflight,
}) {
  if (establishedRunnerStateAuthority === null) {
    fail(
      "ESTABLISHED_RUNNER_STATE_AUTHORITY_REQUIRED",
      "scheduler history requires same-load established runner authority",
    );
  }
  let established;
  try {
    established = assertV2GitLedgerEstablishedRunnerStateAuthorityHandle(
      establishedRunnerStateAuthority,
      {
        control_plane_authority: controlPlaneAuthority,
        preflight_handle: preflightHandle,
      },
    );
  } catch (error) {
    fail(
      "ESTABLISHED_RUNNER_STATE_AUTHORITY_UNTRUSTED",
      `established runner authority is not bound to this control plane: ${
        typeof error?.code === "string" ? error.code : "invalid-authority"
      }`,
    );
  }
  const mismatches = runnerStateAuthorityBoundaryMismatches({
    authority: established,
    control_plane_authority: controlPlaneAuthority,
    control_plane_receipt: receipt,
    control_runner_state: runnerState,
    preflight,
  });
  const expectedScheduling = structuredClone(runnerState.scheduling);
  expectedScheduling.trigger =
    established.workflow_command_authority.command.route.trigger;
  expectedScheduling.run_identity = {
    run_id:
      established.workflow_command_authority.command.invocation.run_id,
    run_attempt:
      established.workflow_command_authority.command.invocation.run_attempt,
  };
  if (canonicalJson(established.scheduling) !==
      canonicalJson(expectedScheduling)) {
    mismatches.push("current scheduling projection");
  }
  if (mismatches.length > 0) {
    fail(
      "ESTABLISHED_RUNNER_STATE_AUTHORITY_MISMATCH",
      `established runner authority differs from its same-load boundary: ${
        mismatches.join(", ")
      }`,
    );
  }
  return established;
}

function runnerStateAuthorityBoundaryMismatches({
  authority,
  control_plane_authority: controlPlaneAuthority,
  control_plane_receipt: receipt,
  control_runner_state: runnerState,
  preflight,
}) {
  const load = controlPlaneAuthority.load;
  const source = authority.source_authority;
  const lease = authority.lease_authority;
  const evaluated = authority.evaluated_scope_authority;
  const command = authority.workflow_command_authority.command;
  const authorityPreflight = authority.preflight_authority;
  const activeLease = load.active_lease;
  const acquireEvaluated = activeLease?.evaluated_scope_receipt ?? null;
  const projectedScope = projectScope(authority.scope, load.repository);
  const { observed_at: headObservedAt, ...headState } = authority.head_ledger;
  const { observed_at: _controlObservedAt, ...controlHeadState } =
    runnerState.head_ledger;
  return [
    ["control scope", canonicalJson(authority.scope) !==
      canonicalJson(controlPlaneAuthority.scope)],
    ["projected scope", canonicalJson(projectedScope) !==
      canonicalJson(receipt.scope)],
    ["receipt tip", source.tip_commit_sha !== receipt.tip_oid],
    ["load tip", source.tip_commit_sha !== load.tip_commit_sha],
    ["source inventory", source.same_job_source_inventory_digest !==
      controlPlaneAuthority.scoped_authority.source_inventory_digest],
    ["receipt scoped authority", source.same_job_scoped_authority_digest !==
      receipt.source_authority_digest],
    ["control scoped authority", source.same_job_scoped_authority_digest !==
      controlPlaneAuthority.scoped_authority.authority_digest],
    ["record manifest", source.fully_reachable_record_manifest_digest !==
      receipt.fully_reachable_record_manifest_digest],
    ["capability attestation", source.capability_attestation_commit_sha !==
      receipt.capability_attestation.record_oid],
    ["capability input", source.capability_input_digest !==
      load.capability.capability_input_digest],
    ["controller release", source.controller_release_digest !==
      receipt.capability_attestation.controller_release_digest],
    ["post ref", canonicalJson(source.post_ref_receipt) !==
      canonicalJson(load.post_ref)],
    ["prior authority", authority.prior_authority_digest !==
      runnerState.source_authority_digest],
    ["head ledger", canonicalJson(headState) !==
      canonicalJson(controlHeadState)],
    ["head observation", headObservedAt !==
      source.post_ref_receipt.server_time],
    ["active lease", activeLease === null],
    ["lease scope", activeLease !== null && canonicalJson(authority.scope) !==
      canonicalJson(activeLease.scope)],
    ["lease id", lease.lease_id !== activeLease?.lease_id],
    ["lease commit", lease.acquire_commit_sha !==
      activeLease?.acquire_commit_sha],
    ["lease acquired time", lease.acquired_at !== activeLease?.acquired_at],
    ["lease expiry", lease.expires_at !== activeLease?.expires_at],
    ["lease owner", activeLease !== null && canonicalJson(lease.owner) !==
      canonicalJson(activeLease.owner)],
    ["lease evaluated scope", lease.evaluated_scope_receipt_digest !==
      acquireEvaluated?.receipt_digest],
    ["full evaluated scope", evaluated.lease_evaluated_scope_receipt_digest !==
      acquireEvaluated?.receipt_digest],
    ["continuity pre scope",
      evaluated.discovery_continuity_receipt.pre_scope_receipt_digest !==
        acquireEvaluated?.receipt_digest],
    ["continuity lease", evaluated.discovery_continuity_receipt.lease
      .acquire_commit_sha !== activeLease?.acquire_commit_sha],
    ["continuity repository",
      canonicalJson(evaluated.discovery_continuity_receipt.repository) !==
        canonicalJson(load.repository)],
    ["continuity scope",
      canonicalJson(evaluated.discovery_continuity_receipt.scope) !==
        canonicalJson(authority.scope)],
    ["preflight receipt", authorityPreflight.preflight_receipt_digest !==
      preflight.receipt_digest],
    ["preflight configuration", authorityPreflight.configuration_digest !==
      preflight.configuration_digest],
    ["command repository owner", command.repository.owner !==
      receipt.repository.owner],
    ["command repository name", command.repository.name !==
      receipt.repository.name],
    ["command pull request", command.pull_request.number !==
      receipt.scope.pull_request_number],
  ].filter(([, mismatch]) => mismatch).map(([label]) => label);
}

export function assertV2ProductionRunnerAuthorityHandle(value) {
  if ((typeof value !== "object" || value === null) ||
      !PRODUCTION_RUNNER_AUTHORITY_HANDLES.has(value)) {
    fail(
      "UNTRUSTED_PRODUCTION_RUNNER_AUTHORITY_HANDLE",
      "production runner authority must come directly from the branded adapter",
    );
  }
  return value;
}

function projectProviderIdentityAuthority(value) {
  if (typeof value !== "object" || value === null) {
    fail("PROVIDER_IDENTITY_AUTHORITY_MISSING",
      "live preflight has no provider identity authority");
  }
  return deepFreeze({
    schema: value.schema,
    schema_version: value.schema_version,
    catalog_version: value.catalog_version,
    actor: structuredClone(value.actor),
    app: structuredClone(value.app),
    catalog_digest: value.catalog_digest,
    identity_digest: value.identity_digest,
    actor_endpoint_receipt_digest: value.actor_endpoint_receipt_digest,
    app_endpoint_receipt_digest: value.app_endpoint_receipt_digest,
  });
}

function deriveControllerFacts(handle) {
  const records = handle.scoped_authority.ordered_records;
  const scope = handle.scope;
  const generationMap = new Map();
  const recoveryBindings = [];
  const requestBindings = [];
  const artifactBindings = [];
  const noStartObservations = [];
  const threadResolutionObservations = [];
  const statusBindings = [];
  let controlCommentBinding = null;
  let stickyCommentBinding = null;
  const currentIncarnationRecordOids = currentScopeIncarnationRecordOids(
    records,
    scope,
  );

  for (const [recordIndex, record] of records.entries()) {
    const envelope = record.envelope;
    if (!new Set(["effect-intent", "effect-response"])
      .has(envelope.record_type)) {
      continue;
    }
    const isForeignHeadRequestBinding =
      envelope.record_type === "effect-response" &&
      envelope.kind === "request-binding" &&
      canonicalJson(envelope.pull_request) ===
        canonicalJson(scope.pull_request) &&
      envelope.head_ref_oid !== scope.head_ref_oid;
    if (isForeignHeadRequestBinding) {
      requestBindings.push(projectRequestBindingAudit(
        record,
        currentIncarnationRecordOids,
      ));
      continue;
    }
    // Request quota and recovery advance on one PR head even when its base or
    // synthetic merge commit changes. Keep those bindings at head scope while
    // leaving statuses, scheduler observations, and comments exact-scope only.
    const usesHeadHistory = recordUsesHeadHistory(envelope);
    const headHistoryRecord = recordMatchesHeadHistory(envelope, scope) &&
      usesHeadHistory;
    const exactCurrentRecord = currentIncarnationRecordOids.has(record.commit_sha) &&
      !usesHeadHistory;
    if (!headHistoryRecord && !exactCurrentRecord) {
      continue;
    }
    const payload = envelope.payload;
    const generation = payload.generation;
    // An automatic reservation is the generation origin. A same-head retarget
    // gives its later effects a new exact epoch, but those records remain
    // references to the one reservation instead of redefining its origin.
    // Manual generations have no reservation and originate at their binding.
    if (envelope.record_type === "effect-intent" &&
        envelope.kind === "automatic-request-reservation") {
      const item = defineGenerationOrigin(
        generationMap,
        generation,
        envelope,
        scope,
        "automatic",
      );
      item.reservation_record_oid = record.commit_sha;
      item.reservation_payload_digest = envelope.payload_digest;
      item.reservation_digest = payload.action.reservation_digest;
    }
    if (envelope.record_type !== "effect-response") continue;
    if (envelope.kind === "review-request") {
      const item = requireGenerationReference(
        generationMap,
        generation,
        envelope,
        scope,
      );
      if (
        item.kind !== "automatic" ||
        item.reservation_record_oid !== payload.action.reservation_record_oid ||
        item.request_effect_record_oid !== null
      ) {
        fail(
          "AUTOMATIC_REQUEST_EFFECT_LINEAGE_INVALID",
          "review-request response does not uniquely reference its reservation origin",
        );
      }
      item.request_effect_record_oid = record.commit_sha;
      item.request_effect_payload_digest = envelope.payload_digest;
      item.created_request_id = payload.receipt.carrier_selector.id;
    } else if (envelope.kind === "request-binding") {
      const item = generation.kind === "manual"
        ? defineGenerationOrigin(
          generationMap,
          generation,
          envelope,
          scope,
          "manual",
        )
        : requireGenerationReference(
          generationMap,
          generation,
          envelope,
          scope,
        );
      const receipt = payload.receipt;
      if (
        item.request_binding_record_oid !== null ||
        (item.kind === "automatic" && (
          item.reservation_record_oid !== payload.action.reservation_record_oid ||
          item.request_effect_record_oid === null ||
          item.created_request_id !== receipt.request_id
        ))
      ) {
        fail(
          "REQUEST_BINDING_LINEAGE_INVALID",
          "request binding does not uniquely reference its generation and request effect",
        );
      }
      item.request_binding_record_oid = record.commit_sha;
      item.request_binding_payload_digest = envelope.payload_digest;
      item.request_id = receipt.request_id;
      item.request_url = receipt.request_url;
      item.request_created_at = receipt.created_at;
      requestBindings.push(projectRequestBindingAudit(
        record,
        currentIncarnationRecordOids,
      ));
    } else if (envelope.kind === "artifact-binding") {
      requireGenerationReference(generationMap, generation, envelope, scope);
      const receipt = payload.receipt;
      for (const binding of receipt.bindings) {
        artifactBindings.push({
          record_oid: record.commit_sha,
          payload_digest: envelope.payload_digest,
          generation_id: generation.generation_id,
          request_binding_record_oid: binding.request_binding_record_oid,
          request_id: binding.request_id,
          request_node_id: binding.request_node_id,
          artifact_selector: structuredClone(binding.artifact_selector),
          artifact_node_id: binding.artifact_node_id,
          artifact_url: binding.artifact_url,
          artifact_type: binding.artifact_type,
          artifact_created_at: binding.artifact_created_at,
          server_time: binding.server_time,
          raw_body_sha256: binding.raw_body_sha256,
          actor: structuredClone(binding.actor),
          app: structuredClone(binding.app),
        });
      }
    } else if (envelope.kind === "scheduler-state") {
      requireGenerationReference(generationMap, generation, envelope, scope);
      recoveryBindings.push({
        record_oid: record.commit_sha,
        payload_digest: envelope.payload_digest,
        ledger_index: recordIndex,
        prior_generation_id: payload.action.prior_generation_id,
        next_generation_id: payload.action.next_generation_id,
        ...structuredClone(payload.receipt),
      });
    } else if (envelope.kind === "no-start-observation") {
      noStartObservations.push({
        record_oid: record.commit_sha,
        payload_digest: envelope.payload_digest,
        generation_id: generation.generation_id,
        request_id: payload.action.request_id,
        request_run_id: payload.action.request_run_id,
        request_created_at: payload.action.request_created_at,
        carrier_selector: structuredClone(payload.action.carrier_selector),
        ...structuredClone(payload.receipt),
      });
    } else if (envelope.kind === "thread-resolution-observation") {
      threadResolutionObservations.push({
        record_oid: record.commit_sha,
        payload_digest: envelope.payload_digest,
        thread_id: payload.action.thread_id,
        head_oid: payload.action.head_oid,
        ...structuredClone(payload.receipt),
      });
    } else if (envelope.kind === "status-write") {
      statusBindings.push({
        record_oid: record.commit_sha,
        payload_digest: envelope.payload_digest,
        ...structuredClone(payload.receipt),
      });
    } else if (new Set(["control-comment-create", "control-comment-update"])
      .has(envelope.kind)) {
      controlCommentBinding = {
        record_oid: record.commit_sha,
        payload_digest: envelope.payload_digest,
        comment_id: payload.receipt.comment.comment_id,
        comment_node_id: payload.receipt.comment.comment_node_id,
        raw_body_sha256: payload.receipt.comment.raw_body_sha256,
        actor: structuredClone(payload.receipt.actor),
        app: structuredClone(payload.receipt.app),
        pre_comment_inventory_digest:
          payload.receipt.pre_comment_inventory_digest,
        post_comment_inventory_digest:
          payload.receipt.post_comment_inventory_digest,
      };
    } else if (envelope.kind === "sticky-comment") {
      stickyCommentBinding = {
        record_oid: record.commit_sha,
        payload_digest: envelope.payload_digest,
        comment_id: payload.receipt.comment.comment_id,
        comment_node_id: payload.receipt.comment.comment_node_id,
        raw_body_sha256: payload.receipt.comment.raw_body_sha256,
        actor: structuredClone(payload.receipt.actor),
        app: structuredClone(payload.receipt.app),
        pre_comment_inventory_digest:
          payload.receipt.pre_comment_inventory_digest,
        post_comment_inventory_digest:
          payload.receipt.post_comment_inventory_digest,
      };
    }
  }

  const generations = [...generationMap.values()]
    .sort((left, right) =>
      generationKindOrder(left.kind) - generationKindOrder(right.kind) ||
      left.index - right.index);
  validateGenerationCompleteness(generations);
  for (const binding of recoveryBindings) {
    const completion = binding.completion_recovery_authority;
    const priorIndex = records.findIndex((record) =>
      record.commit_sha === completion.prior_request_binding_record_oid);
    const nextBinding = requestBindings.find((requestBinding) =>
      requestBinding.head_oid === scope.head_ref_oid &&
      requestBinding.generation_id === binding.next_generation_id) ?? null;
    const nextIndex = nextBinding === null
      ? null
      : records.findIndex((record) => record.commit_sha === nextBinding.record_oid);
    if (
      priorIndex < 0 ||
      priorIndex >= binding.ledger_index ||
      (nextIndex !== null && nextIndex <= binding.ledger_index)
    ) {
      fail(
        "RECOVERY_LEDGER_ORDER_INVALID",
        "durable generation recovery is not ordered between its request bindings",
      );
    }
    binding.ledger_order = {
      prior_request_binding_index: priorIndex,
      recovery_transition_index: binding.ledger_index,
      next_request_binding_index: nextIndex,
    };
    binding.next_request_binding_record_oid = nextBinding?.record_oid ?? null;
    binding.next_request_id = nextBinding?.request_id ?? null;
  }
  const counter = handle.scoped_authority.scope_counters.find((item) =>
    item.pull_request.number === scope.pull_request.number &&
    item.pull_request.node_id === scope.pull_request.node_id &&
    item.head_ref_oid === scope.head_ref_oid);
  const sentinel = [...statusBindings].reverse().find((item) =>
    item.role === "head-sentinel") ?? null;
  return {
    budget: {
      automatic_reservations_on_head:
        counter?.automatic_reservations_on_head ?? 0,
      automatic_requests_on_head:
        counter?.automatic_requests_on_head ?? 0,
      manual_requests_in_epoch: generations.filter((item) =>
        item.kind === "manual" && item.request_binding_record_oid !== null).length,
    },
    generations,
    recovery_bindings: recoveryBindings,
    request_bindings: requestBindings,
    artifact_bindings: artifactBindings,
    no_start_observations: noStartObservations,
    thread_resolution_observations: threadResolutionObservations,
    status_bindings: statusBindings,
    sentinel_binding: sentinel,
    control_comment_binding: controlCommentBinding,
    sticky_comment_binding: stickyCommentBinding,
  };
}

function projectRequestBindingAudit(record, currentIncarnationRecordOids) {
  const envelope = record.envelope;
  const generation = envelope.payload.generation;
  const receipt = envelope.payload.receipt;
  return {
    record_oid: record.commit_sha,
    payload_digest: envelope.payload_digest,
    generation_id: generation.generation_id,
    generation_kind: generation.kind,
    generation_index: generation.index,
    base_oid: envelope.base_ref_oid,
    head_oid: envelope.head_ref_oid,
    current_incarnation: currentIncarnationRecordOids.has(record.commit_sha),
    request_id: receipt.request_id,
    request_node_id: receipt.request_node_id,
    request_url: receipt.request_url,
    body_sha256: receipt.body_sha256,
    created_at: receipt.created_at,
    updated_at: receipt.updated_at,
    raw_body_sha256: receipt.raw_body_sha256,
    actor_id: receipt.actor.id,
    actor_node_id: receipt.actor.node_id,
    controlled: receipt.controlled,
  };
}

function projectGenerationAdmissions(derived) {
  const generations = new Map(derived.generations.map((generation) => [
    generation.generation_id,
    generation,
  ]));
  return derived.recovery_bindings.flatMap((binding) => {
    const completion = binding.completion_recovery_authority;
    const prior = generations.get(binding.prior_generation_id);
    const next = generations.get(binding.next_generation_id);
    if (
      prior === undefined ||
      next === undefined ||
      binding.next_request_id === null ||
      binding.next_request_binding_record_oid === null ||
      binding.ledger_order.next_request_binding_index === null
    ) {
      return [];
    }
    return [{
      prior_generation_id: binding.prior_generation_id,
      next_generation_id: binding.next_generation_id,
      prior_request_id: completion.prior_request_id,
      next_request_id: binding.next_request_id,
      head_oid: completion.scope.head_oid,
      prior_request_binding_record_oid:
        completion.prior_request_binding_record_oid,
      recovery_transition_record_oid: binding.record_oid,
      recovery_transition_payload_digest: binding.payload_digest,
      next_request_binding_record_oid:
        binding.next_request_binding_record_oid,
      next_request_binding_payload_digest:
        derived.request_bindings.find((requestBinding) =>
          requestBinding.record_oid === binding.next_request_binding_record_oid)
          .payload_digest,
      transition_server_time: binding.server_time,
      ledger_order: structuredClone(binding.ledger_order),
    }];
  });
}

function defineGenerationOrigin(
  map,
  generation,
  envelope,
  scope,
  expectedKind,
) {
  if (
    generation === null ||
    generation.kind !== expectedKind ||
    envelope.head_ref_oid !== scope.head_ref_oid
  ) {
    fail(
      "GENERATION_ORIGIN_INVALID",
      "generation origin has the wrong kind or head",
    );
  }
  if (map.has(generation.generation_id)) {
    fail(
      "GENERATION_ORIGIN_DUPLICATE",
      "one generation has more than one ledger origin",
    );
  }
  const projected = {
    generation_id: generation.generation_id,
    kind: generation.kind,
    index: generation.index,
    review_epoch_digest: generation.review_epoch_digest,
    base_oid: envelope.base_ref_oid,
    head_oid: envelope.head_ref_oid,
    reservation_record_oid: null,
    reservation_payload_digest: null,
    reservation_digest: null,
    request_effect_record_oid: null,
    request_effect_payload_digest: null,
    created_request_id: null,
    request_binding_record_oid: null,
    request_binding_payload_digest: null,
    request_id: null,
    request_url: null,
    request_created_at: null,
  };
  map.set(generation.generation_id, projected);
  return projected;
}

function requireGenerationReference(map, generation, envelope, scope) {
  const existing = map.get(generation.generation_id);
  if (
    existing === undefined ||
    existing.kind !== generation.kind ||
    existing.index !== generation.index ||
    envelope.head_ref_oid !== scope.head_ref_oid
  ) {
    fail(
      "GENERATION_REFERENCE_INVALID",
      "generation reference has no unique same-head origin",
    );
  }
  return existing;
}

function validateGenerationCompleteness(generations) {
  const seen = { automatic: new Set(), manual: new Set() };
  for (const item of generations) {
    if (!GENERATION_ID.test(item.generation_id) ||
        item.generation_id !== `${item.kind}:${item.index}` ||
        seen[item.kind]?.has(item.index)) {
      fail("GENERATION_ID_INVALID", "ledger generations are not unique and canonical");
    }
    seen[item.kind].add(item.index);
    if (item.kind === "automatic" &&
        (item.index > MAX_AUTOMATIC_GENERATIONS ||
          item.reservation_record_oid === null ||
          item.reservation_digest === null)) {
      fail("AUTOMATIC_RESERVATION_MISSING",
        "automatic generation lacks its reachable reservation intent");
    }
    if (item.kind === "manual" &&
        (item.index > MAX_MANUAL_GENERATIONS ||
          item.request_binding_record_oid === null)) {
      fail("MANUAL_REQUEST_BINDING_MISSING",
        "manual generation lacks its reachable request binding");
    }
    if (item.request_binding_record_oid !== null &&
        item.kind === "automatic" && item.request_effect_record_oid === null) {
      fail("AUTOMATIC_REQUEST_EFFECT_MISSING",
        "automatic request binding lacks its reachable POST response");
    }
    if (item.request_effect_record_oid !== null &&
        item.created_request_id === null) {
      fail("REQUEST_EFFECT_ID_MISSING",
        "review-request response lacks its created comment identity");
    }
    if (item.request_binding_record_oid !== null &&
        item.created_request_id !== null &&
        item.request_id !== item.created_request_id) {
      fail("REQUEST_EFFECT_BINDING_MISMATCH",
        "request binding does not identify the comment created by its effect");
    }
  }
}

function projectScope(scope, repository) {
  return {
    repository_id: repository.id,
    repository_node_id: repository.node_id,
    pull_request_number: scope.pull_request.number,
    pull_request_node_id: scope.pull_request.node_id,
    base_oid: scope.base_ref_oid,
    head_oid: scope.head_ref_oid,
    potential_merge_oid: scope.potential_merge_commit_oid,
    review_epoch_digest: digestCanonical("codex-review-gate-v2-review-epoch", {
      pull_request: scope.pull_request,
      base_ref_oid: scope.base_ref_oid,
      head_ref_oid: scope.head_ref_oid,
      potential_merge_commit_oid: scope.potential_merge_commit_oid,
    }),
  };
}

function recordMatchesScope(envelope, scope) {
  return recordMatchesHeadHistory(envelope, scope) &&
    envelope.base_ref_oid === scope.base_ref_oid &&
    envelope.potential_merge_commit_oid === scope.potential_merge_commit_oid;
}

function currentScopeIncarnationRecordOids(records, scope) {
  let exclusiveBoundaryIndex = -1;
  for (const [index, record] of records.entries()) {
    if (
      recordMatchesPullRequest(record.envelope, scope) &&
      !recordMatchesScope(record.envelope, scope)
    ) {
      exclusiveBoundaryIndex = index;
    }
  }
  return new Set(records
    .slice(exclusiveBoundaryIndex + 1)
    .filter((record) => recordMatchesScope(record.envelope, scope))
    .map((record) => record.commit_sha));
}

function recordMatchesHeadHistory(envelope, scope) {
  return recordMatchesPullRequest(envelope, scope) &&
    envelope.head_ref_oid === scope.head_ref_oid;
}

function recordMatchesPullRequest(envelope, scope) {
  return canonicalJson(envelope.pull_request) ===
    canonicalJson(scope.pull_request);
}

function recordUsesHeadHistory(envelope) {
  return envelope.record_type === "effect-intent" &&
      HEAD_HISTORY_INTENT_KINDS.has(envelope.kind) ||
    envelope.record_type === "effect-response" &&
      HEAD_HISTORY_RESPONSE_KINDS.has(envelope.kind);
}

function validateDerived(value, scope, schemaVersion, recordCount) {
  assertObject(value, "control_plane_receipt.derived");
  exactKeys(value, DERIVED_KEYS, "control_plane_receipt.derived");
  validateBudget(value.budget);
  boundedArray(value.generations, MAX_AUTOMATIC_GENERATIONS +
    MAX_MANUAL_GENERATIONS, "derived.generations");
  boundedArray(value.recovery_bindings, MAX_AUTOMATIC_GENERATIONS - 1,
    "derived.recovery_bindings");
  boundedArray(value.request_bindings,
    schemaVersion === 1 ? MAX_LEGACY_REQUEST_BINDINGS : MAX_RECORDS,
    "derived.request_bindings");
  boundedArray(value.artifact_bindings, MAX_RECORDS,
    "derived.artifact_bindings");
  boundedArray(value.no_start_observations,
    MAX_AUTOMATIC_GENERATIONS + MAX_MANUAL_GENERATIONS,
    "derived.no_start_observations");
  boundedArray(value.thread_resolution_observations, 1_000,
    "derived.thread_resolution_observations");
  boundedArray(value.status_bindings, MAX_RECORDS,
    "derived.status_bindings");
  for (const generation of value.generations) {
    validateGenerationAudit(generation, scope, schemaVersion);
  }
  validateGenerationCompleteness(value.generations);
  let currentIncarnationStarted = false;
  const requestRecordOids = new Set();
  const requestIds = new Set();
  const requestNodeIds = new Set();
  for (const binding of value.request_bindings) {
    validateRequestBindingAudit(binding, scope, schemaVersion);
    if (
      requestRecordOids.has(binding.record_oid) ||
      requestIds.has(binding.request_id) ||
      requestNodeIds.has(binding.request_node_id)
    ) {
      throw new TypeError("request binding identities must be unique");
    }
    requestRecordOids.add(binding.record_oid);
    requestIds.add(binding.request_id);
    requestNodeIds.add(binding.request_node_id);
    if (schemaVersion === V2_CONTROL_PLANE_RECEIPT_SCHEMA_VERSION) {
      if (binding.current_incarnation) {
        const matchingGenerations = value.generations.filter((generation) =>
          generation.generation_id === binding.generation_id);
        const generation = matchingGenerations[0];
        if (
          matchingGenerations.length !== 1 ||
          generation.kind !== binding.generation_kind ||
          generation.index !== binding.generation_index ||
          generation.head_oid !== binding.head_oid ||
          generation.request_binding_record_oid !== binding.record_oid ||
          generation.request_binding_payload_digest !== binding.payload_digest ||
          generation.request_id !== binding.request_id ||
          generation.request_url !== binding.request_url ||
          generation.request_created_at !== binding.created_at ||
          (generation.kind === "manual" &&
            generation.base_oid !== binding.base_oid) ||
          (generation.kind === "manual" &&
            generation.review_epoch_digest !== scope.review_epoch_digest)
        ) {
          throw new TypeError(
            "current request binding must join its exact generation reference",
          );
        }
        currentIncarnationStarted = true;
      } else if (currentIncarnationStarted) {
        throw new TypeError(
          "request binding current_incarnation markers must form one ledger suffix",
        );
      }
    }
  }
  let priorRecovery = null;
  for (const binding of value.recovery_bindings) {
    validateRecoveryBindingAudit(binding, {
      scope,
      schemaVersion,
      recordCount,
      requestBindings: value.request_bindings,
      priorRecovery,
    });
    priorRecovery = binding;
  }
  const artifactSelectors = new Set();
  const artifactRecords = new Map();
  for (const binding of value.artifact_bindings) {
    validateArtifactBindingAudit(binding, {
      scope,
      generations: value.generations,
      requestBindings: value.request_bindings,
    });
    const selectorKey = `${binding.artifact_selector.kind}:${binding.artifact_selector.id}`;
    if (artifactSelectors.has(selectorKey)) {
      throw new TypeError("artifact binding selectors must be unique");
    }
    artifactSelectors.add(selectorKey);
    const recordPayload = artifactRecords.get(binding.record_oid);
    if (recordPayload !== undefined && recordPayload !== binding.payload_digest) {
      throw new TypeError(
        "artifact bindings from one ledger record must share one payload digest",
      );
    }
    artifactRecords.set(binding.record_oid, binding.payload_digest);
  }
  for (const binding of value.status_bindings) validateStatusBindingAudit(binding, scope);
  if (value.sentinel_binding !== null) {
    validateStatusBindingAudit(value.sentinel_binding, scope);
    exact(value.sentinel_binding.role, "head-sentinel",
      "derived.sentinel_binding.role");
  }
  for (const key of ["control_comment_binding", "sticky_comment_binding"]) {
    if (value[key] !== null) validateCommentBindingAudit(value[key], `derived.${key}`);
  }
  digest(value.derived_digest, "derived.derived_digest");
  const { derived_digest: _derivedDigest, ...withoutDigest } = value;
  if (digestCanonical("codex-review-gate-v2-control-plane-derived-facts",
    withoutDigest) !== value.derived_digest) {
    fail("DERIVED_DIGEST_MISMATCH", "control plane derived digest is invalid");
  }
}

function validateBudget(value) {
  assertObject(value, "derived.budget");
  exactKeys(value, [
    "automatic_reservations_on_head",
    "automatic_requests_on_head",
    "manual_requests_in_epoch",
  ], "derived.budget");
  const reservations = integer(value.automatic_reservations_on_head, 0,
    MAX_AUTOMATIC_GENERATIONS, "derived.budget.automatic_reservations_on_head");
  const requests = integer(value.automatic_requests_on_head, 0,
    MAX_AUTOMATIC_GENERATIONS, "derived.budget.automatic_requests_on_head");
  integer(value.manual_requests_in_epoch, 0, MAX_MANUAL_GENERATIONS,
    "derived.budget.manual_requests_in_epoch");
  if (requests > reservations) {
    fail("AUTOMATIC_BUDGET_RELATION_INVALID",
      "automatic requests cannot exceed durable reservations");
  }
}

function validateGenerationAudit(value, scope, schemaVersion) {
  assertObject(value, "derived generation");
  exactKeys(value, [
    "generation_id", "kind", "index", "review_epoch_digest", "base_oid",
    "head_oid", "reservation_record_oid", "reservation_payload_digest",
    "reservation_digest", "request_effect_record_oid",
    "request_effect_payload_digest", "created_request_id",
    "request_binding_record_oid", "request_binding_payload_digest",
    "request_id", "request_url", "request_created_at",
  ], "derived generation");
  const match = GENERATION_ID.exec(value.generation_id);
  if (match === null || match[1] !== value.kind || Number(match[2]) !== value.index) {
    throw new TypeError("derived generation identity is invalid");
  }
  sha(value.base_oid, "derived generation.base_oid");
  if (schemaVersion === 1) {
    exact(value.base_oid, scope.base_oid, "derived generation.base_oid");
  }
  exact(sha(value.head_oid, "derived generation.head_oid"), scope.head_oid,
    "derived generation.head_oid");
  digest(value.review_epoch_digest, "derived generation.review_epoch_digest");
  nullableSha(value.reservation_record_oid, "derived generation.reservation_record_oid");
  nullableDigest(value.reservation_payload_digest,
    "derived generation.reservation_payload_digest");
  nullableDigest(value.reservation_digest, "derived generation.reservation_digest");
  nullableSha(value.request_effect_record_oid,
    "derived generation.request_effect_record_oid");
  nullableDigest(value.request_effect_payload_digest,
    "derived generation.request_effect_payload_digest");
  nullableDecimal(value.created_request_id, "derived generation.created_request_id");
  nullableSha(value.request_binding_record_oid,
    "derived generation.request_binding_record_oid");
  nullableDigest(value.request_binding_payload_digest,
    "derived generation.request_binding_payload_digest");
  nullableDecimal(value.request_id, "derived generation.request_id");
  nullableUrl(value.request_url, "derived generation.request_url");
  nullableTimestamp(value.request_created_at,
    "derived generation.request_created_at");
}

function validateRequestBindingAudit(value, scope, schemaVersion) {
  assertObject(value, "derived request binding");
  exactKeys(
    value,
    schemaVersion === 1
      ? LEGACY_REQUEST_BINDING_KEYS
      : REQUEST_BINDING_KEYS,
    "derived request binding",
  );
  sha(value.record_oid, "request binding.record_oid");
  digest(value.payload_digest, "request binding.payload_digest");
  sha(value.base_oid, "request binding.base_oid");
  sha(value.head_oid, "request binding.head_oid");
  if (schemaVersion === 1) {
    exact(value.base_oid, scope.base_oid, "request binding.base_oid");
    exact(value.head_oid, scope.head_oid, "request binding.head_oid");
  } else {
    if (typeof value.current_incarnation !== "boolean") {
      throw new TypeError("request binding current_incarnation must be boolean");
    }
    if (
      value.current_incarnation &&
      (value.base_oid !== scope.base_oid || value.head_oid !== scope.head_oid)
    ) {
      throw new TypeError(
        "request binding current_incarnation requires the current scope base and head",
      );
    }
  }
  if (!new Set(["automatic", "manual"]).has(value.generation_kind)) {
    throw new TypeError("request binding generation_kind is invalid");
  }
  integer(
    value.generation_index,
    1,
    value.generation_kind === "automatic"
      ? MAX_AUTOMATIC_GENERATIONS
      : MAX_MANUAL_GENERATIONS,
    "request binding.generation_index",
  );
  exact(
    value.generation_id,
    `${value.generation_kind}:${value.generation_index}`,
    "request binding.generation_id",
  );
  decimal(value.request_id, "request binding.request_id");
  boundedString(value.request_node_id, "request binding.request_node_id", 256);
  githubUrl(value.request_url, "request binding.request_url");
  digest(value.body_sha256, "request binding.body_sha256");
  timestamp(value.created_at, "request binding.created_at");
  exact(value.updated_at, value.created_at, "request binding.updated_at");
  digest(value.raw_body_sha256, "request binding.raw_body_sha256");
  decimal(value.actor_id, "request binding.actor_id");
  boundedString(value.actor_node_id, "request binding.actor_node_id", 256);
  if (typeof value.controlled !== "boolean") {
    throw new TypeError("request binding controlled must be boolean");
  }
}

function validateRecoveryBindingAudit(value, {
  scope,
  schemaVersion,
  recordCount,
  requestBindings,
  priorRecovery,
}) {
  const label = "derived recovery binding";
  assertObject(value, label);
  exactKeys(
    value,
    schemaVersion === 1
      ? LEGACY_RECOVERY_BINDING_KEYS
      : RECOVERY_BINDING_KEYS,
    label,
  );
  sha(value.record_oid, `${label}.record_oid`);
  digest(value.payload_digest, `${label}.payload_digest`);
  const completion = validateRecoveryAuthority(
    value.completion_recovery_authority,
    scope,
    schemaVersion,
  );
  exact(value.prior_generation_id, completion.prior_generation_id,
    `${label}.prior_generation_id`);
  exact(value.next_generation_id, completion.next_generation_id,
    `${label}.next_generation_id`);
  exact(value.committed, true, `${label}.committed`);
  digest(value.recovery_transition_digest,
    `${label}.recovery_transition_digest`);
  exact(
    value.recovery_transition_digest,
    recoveryTransitionDigest(completion),
    `${label}.recovery_transition_digest`,
  );
  digest(value.intent_recovery_authority_digest,
    `${label}.intent_recovery_authority_digest`);
  digest(value.completion_recovery_authority_digest,
    `${label}.completion_recovery_authority_digest`);
  exact(
    value.completion_recovery_authority_digest,
    completion.authority_digest,
    `${label}.completion_recovery_authority_digest`,
  );
  sha(value.completion_scheduler_observation_record_oid,
    `${label}.completion_scheduler_observation_record_oid`);
  digest(value.completion_full_scope_receipt_digest,
    `${label}.completion_full_scope_receipt_digest`);
  const serverTime = timestamp(value.server_time, `${label}.server_time`);
  if (Date.parse(completion.final_snapshot_server_time) > Date.parse(serverTime)) {
    throw new TypeError(
      "derived recovery binding server_time precedes its final snapshot",
    );
  }

  const priorBinding = requestBindings.find((binding) =>
    binding.record_oid === completion.prior_request_binding_record_oid);
  if (
    priorBinding === undefined ||
    priorBinding.generation_id !== completion.prior_generation_id ||
    priorBinding.request_id !== completion.prior_request_id ||
    (schemaVersion === 1 &&
      priorBinding.base_oid !== completion.scope.base_oid) ||
    priorBinding.head_oid !== completion.scope.head_oid
  ) {
    throw new TypeError(
      "derived recovery binding has no exact prior request binding",
    );
  }
  if (Date.parse(priorBinding.created_at) >= Date.parse(serverTime)) {
    throw new TypeError(
      "derived recovery binding must follow its prior request binding",
    );
  }

  if (schemaVersion === V2_CONTROL_PLANE_RECEIPT_SCHEMA_VERSION) {
    const ledgerIndex = integer(
      value.ledger_index,
      0,
      recordCount - 1,
      `${label}.ledger_index`,
    );
    assertObject(value.ledger_order, `${label}.ledger_order`);
    exactKeys(value.ledger_order, [
      "prior_request_binding_index",
      "recovery_transition_index",
      "next_request_binding_index",
    ], `${label}.ledger_order`);
    const priorIndex = integer(
      value.ledger_order.prior_request_binding_index,
      0,
      recordCount - 1,
      `${label}.ledger_order.prior_request_binding_index`,
    );
    const transitionIndex = integer(
      value.ledger_order.recovery_transition_index,
      0,
      recordCount - 1,
      `${label}.ledger_order.recovery_transition_index`,
    );
    const nextIndex = value.ledger_order.next_request_binding_index === null
      ? null
      : integer(
          value.ledger_order.next_request_binding_index,
          0,
          recordCount - 1,
          `${label}.ledger_order.next_request_binding_index`,
        );
    if (
      transitionIndex !== ledgerIndex ||
      priorIndex >= transitionIndex ||
      (nextIndex !== null && transitionIndex >= nextIndex)
    ) {
      throw new TypeError(
        "derived recovery binding ledger_order must be strictly causal",
      );
    }
    const nextIdentityIsNull =
      value.next_request_binding_record_oid === null &&
      value.next_request_id === null;
    if ((nextIndex === null) !== nextIdentityIsNull) {
      throw new TypeError(
        "derived recovery binding next request identity and order must agree",
      );
    }
    if (nextIndex !== null) {
      sha(value.next_request_binding_record_oid,
        `${label}.next_request_binding_record_oid`);
      decimal(value.next_request_id, `${label}.next_request_id`);
      const nextBinding = requestBindings.find((binding) =>
        binding.record_oid === value.next_request_binding_record_oid);
      if (
        nextBinding === undefined ||
        nextBinding.generation_id !== completion.next_generation_id ||
        nextBinding.request_id !== value.next_request_id ||
        nextBinding.head_oid !== completion.scope.head_oid
      ) {
        throw new TypeError(
          "derived recovery binding has no exact next request binding",
        );
      }
      if (Date.parse(serverTime) >= Date.parse(nextBinding.created_at)) {
        throw new TypeError(
          "derived recovery binding must precede its next request binding",
        );
      }
    } else {
      exact(value.next_request_binding_record_oid, null,
        `${label}.next_request_binding_record_oid`);
      exact(value.next_request_id, null, `${label}.next_request_id`);
    }
  }

  if (priorRecovery !== null) {
    if (
      priorRecovery.next_generation_id !== value.prior_generation_id ||
      (schemaVersion === V2_CONTROL_PLANE_RECEIPT_SCHEMA_VERSION &&
        priorRecovery.ledger_index >= value.ledger_index)
    ) {
      throw new TypeError(
        "derived recovery bindings must follow generation and ledger order",
      );
    }
  }
}

function validateRecoveryAuthority(value, scope, schemaVersion) {
  const label = "derived recovery authority";
  assertObject(value, label);
  exactKeys(value, RECOVERY_AUTHORITY_KEYS, label);
  exact(value.schema,
    "codex-review-gate-automatic-request-recovery-authority-v2",
    `${label}.schema`);
  exact(value.schema_version, 1, `${label}.schema_version`);
  exact(value.decision, "findings", `${label}.decision`);
  exact(value.same_review_epoch, true, `${label}.same_review_epoch`);
  digest(value.snapshot_fingerprint, `${label}.snapshot_fingerprint`);
  boundedString(value.review_epoch_id, `${label}.review_epoch_id`, 96);
  const priorIndex = integer(value.prior_generation_index, 1, 2,
    `${label}.prior_generation_index`);
  const nextIndex = integer(value.next_generation_index, 2, 3,
    `${label}.next_generation_index`);
  if (
    nextIndex !== priorIndex + 1 ||
    value.prior_generation_id !== `automatic:${priorIndex}` ||
    value.next_generation_id !== `automatic:${nextIndex}`
  ) {
    throw new TypeError(
      "derived recovery authority generations must be immediate",
    );
  }
  decimal(value.prior_request_id, `${label}.prior_request_id`);
  sha(value.prior_request_binding_record_oid,
    `${label}.prior_request_binding_record_oid`);
  digest(value.prior_request_binding_receipt_digest,
    `${label}.prior_request_binding_receipt_digest`);

  assertObject(value.scope, `${label}.scope`);
  exactKeys(value.scope, [
    "repository_node_id", "pull_request_node_id", "pull_request_number",
    "base_oid", "head_oid", "merge_base_oid",
  ], `${label}.scope`);
  exact(value.scope.repository_node_id, scope.repository_node_id,
    `${label}.scope.repository_node_id`);
  exact(value.scope.pull_request_node_id, scope.pull_request_node_id,
    `${label}.scope.pull_request_node_id`);
  exact(value.scope.pull_request_number, scope.pull_request_number,
    `${label}.scope.pull_request_number`);
  sha(value.scope.base_oid, `${label}.scope.base_oid`);
  exact(sha(value.scope.head_oid, `${label}.scope.head_oid`), scope.head_oid,
    `${label}.scope.head_oid`);
  sha(value.scope.merge_base_oid, `${label}.scope.merge_base_oid`);
  if (schemaVersion === 1) {
    exact(value.scope.base_oid, scope.base_oid, `${label}.scope.base_oid`);
  }
  digest(value.scope_digest, `${label}.scope_digest`);
  exact(
    value.scope_digest,
    digestCanonical(
      "codex-review-gate-v2-automatic-recovery-scope",
      value.scope,
    ),
    `${label}.scope_digest`,
  );

  const findingIds = validateUniqueRecoveryIds(
    value.finding_ids,
    `${label}.finding_ids`,
  );
  const closureIds = validateUniqueRecoveryIds(
    value.closure_ids,
    `${label}.closure_ids`,
  );
  if (
    findingIds.length === 0 ||
    findingIds.length !== closureIds.length ||
    !Array.isArray(value.closure_records) ||
    value.closure_records.length !== findingIds.length
  ) {
    throw new TypeError("derived recovery authority closure inventory is incomplete");
  }
  let latestFinding = null;
  let latestClosure = null;
  value.closure_records.forEach((record, index) => {
    const recordLabel = `${label}.closure_records[${index}]`;
    assertObject(record, recordLabel);
    exactKeys(record, [
      "finding_id", "finding_kind", "finding_artifact_id",
      "finding_server_time", "closure_id", "closure_server_time",
      "closure_authority_digest",
    ], recordLabel);
    if (
      record.finding_id !== findingIds[index] ||
      record.closure_id !== closureIds[index] ||
      !new Set(["inline", "top-level"]).has(record.finding_kind)
    ) {
      throw new TypeError(
        "derived recovery authority closure ordering is invalid",
      );
    }
    boundedString(record.finding_artifact_id,
      `${recordLabel}.finding_artifact_id`, 256);
    const findingTime = timestamp(record.finding_server_time,
      `${recordLabel}.finding_server_time`);
    const closureTime = timestamp(record.closure_server_time,
      `${recordLabel}.closure_server_time`);
    digest(record.closure_authority_digest,
      `${recordLabel}.closure_authority_digest`);
    if (Date.parse(findingTime) >= Date.parse(closureTime)) {
      throw new TypeError(
        "derived recovery authority closure must follow its finding",
      );
    }
    if (latestFinding === null ||
        Date.parse(findingTime) > Date.parse(latestFinding)) {
      latestFinding = findingTime;
    }
    if (latestClosure === null ||
        Date.parse(closureTime) > Date.parse(latestClosure)) {
      latestClosure = closureTime;
    }
  });
  const findingObservedAt = timestamp(value.finding_observed_at,
    `${label}.finding_observed_at`);
  const closureObservedAt = timestamp(value.closure_observed_at,
    `${label}.closure_observed_at`);
  const finalSnapshotServerTime = timestamp(value.final_snapshot_server_time,
    `${label}.final_snapshot_server_time`);
  if (
    findingObservedAt !== latestFinding ||
    closureObservedAt !== latestClosure ||
    Date.parse(findingObservedAt) >= Date.parse(closureObservedAt) ||
    Date.parse(closureObservedAt) > Date.parse(finalSnapshotServerTime)
  ) {
    throw new TypeError("derived recovery authority times are invalid");
  }
  for (const key of [
    "pagination_sha256", "final_reread_sha256", "evidence_snapshot_digest",
    "reducer_input_digest", "reducer_report_digest", "authority_digest",
  ]) {
    digest(value[key], `${label}.${key}`);
  }
  const { authority_digest: authorityDigest, ...withoutDigest } = value;
  exact(
    authorityDigest,
    digestCanonical(
      "codex-review-gate-v2-automatic-request-recovery-authority",
      withoutDigest,
    ),
    `${label}.authority_digest`,
  );
  return value;
}

function validateUniqueRecoveryIds(value, label) {
  boundedArray(value, MAX_RECORDS, label);
  value.forEach((item, index) =>
    boundedString(item, `${label}[${index}]`, 256));
  if (new Set(value).size !== value.length) {
    throw new TypeError(`${label} must contain unique identifiers`);
  }
  return value;
}

function recoveryTransitionDigest(authority) {
  return digestCanonical(
    "codex-review-gate-v2-automatic-request-recovery-transition",
    {
      review_epoch_id: authority.review_epoch_id,
      prior_generation_id: authority.prior_generation_id,
      next_generation_id: authority.next_generation_id,
      prior_request_id: authority.prior_request_id,
      prior_request_binding_record_oid:
        authority.prior_request_binding_record_oid,
      prior_request_binding_receipt_digest:
        authority.prior_request_binding_receipt_digest,
      scope_digest: authority.scope_digest,
    },
  );
}

function validateArtifactBindingAudit(value, {
  scope,
  generations,
  requestBindings,
}) {
  assertObject(value, "derived artifact binding");
  exactKeys(value, [
    "record_oid", "payload_digest", "generation_id",
    "request_binding_record_oid", "request_id", "request_node_id",
    "artifact_selector", "artifact_node_id", "artifact_url",
    "artifact_type", "artifact_created_at", "server_time",
    "raw_body_sha256", "actor", "app",
  ], "derived artifact binding");
  sha(value.record_oid, "artifact binding.record_oid");
  digest(value.payload_digest, "artifact binding.payload_digest");
  if (!GENERATION_ID.test(value.generation_id)) {
    throw new TypeError("artifact binding.generation_id is invalid");
  }
  sha(value.request_binding_record_oid,
    "artifact binding.request_binding_record_oid");
  decimal(value.request_id, "artifact binding.request_id");
  boundedString(value.request_node_id, "artifact binding.request_node_id", 256);
  validateSelector(value.artifact_selector, "artifact binding.artifact_selector");
  if (!new Set(["issue_comment", "pull_request_review", "inline_comment"])
    .has(value.artifact_type)) {
    throw new TypeError("artifact binding.artifact_type is unsupported");
  }
  if (value.artifact_type !== value.artifact_selector.kind) {
    throw new TypeError(
      "artifact binding.artifact_type must exactly match artifact_selector.kind",
    );
  }
  boundedString(value.artifact_node_id,
    "artifact binding.artifact_node_id", 256);
  githubUrl(value.artifact_url, "artifact binding.artifact_url");
  timestamp(value.artifact_created_at, "artifact binding.artifact_created_at");
  timestamp(value.server_time, "artifact binding.server_time");
  digest(value.raw_body_sha256, "artifact binding.raw_body_sha256");
  validateActor(value.actor, "artifact binding.actor");
  validateApp(value.app, "artifact binding.app");
  const matchingRequests = requestBindings.filter((binding) =>
    binding.record_oid === value.request_binding_record_oid);
  const matchingGenerations = generations.filter((generation) =>
    generation.generation_id === value.generation_id);
  const request = matchingRequests[0];
  const generation = matchingGenerations[0];
  if (
    matchingRequests.length !== 1 ||
    matchingGenerations.length !== 1 ||
    request.generation_id !== value.generation_id ||
    request.request_id !== value.request_id ||
    request.request_node_id !== value.request_node_id ||
    request.head_oid !== scope.head_oid ||
    generation.request_binding_record_oid !== request.record_oid ||
    generation.request_id !== request.request_id
  ) {
    throw new TypeError(
      "artifact binding must join one unique request binding and generation",
    );
  }
  if (Date.parse(request.created_at) >= Date.parse(value.artifact_created_at)) {
    throw new TypeError("artifact must follow its request binding");
  }
  if (Date.parse(value.artifact_created_at) > Date.parse(value.server_time)) {
    throw new TypeError("artifact server_time precedes artifact creation");
  }
  // These three values remain serialized audit provenance. The receipt binds
  // only a source-manifest digest, not its individual rows, so a deserialized
  // validator cannot independently join them back to source entries. Only the
  // branded live-ledger construction establishes that execution lineage.
}

function validateStatusBindingAudit(value, scope) {
  assertObject(value, "derived status binding");
  exactKeys(value, [
    "record_oid", "payload_digest", "http_status", "status_id",
    "target_sha", "role", "context", "state", "description_digest",
    "created_at", "updated_at", "creator", "post_server_time",
    "post_raw_body_sha256", "refetch_server_time", "refetch_page_count",
    "refetch_item_count", "refetch_match_count",
    "refetch_inventory_digest", "refetch_pages",
  ], "derived status binding");
  sha(value.record_oid, "status binding.record_oid");
  digest(value.payload_digest, "status binding.payload_digest");
  const {
    record_oid: _recordOid,
    payload_digest: _payloadDigest,
    ...responseReceipt
  } = value;
  validateV2GitLedgerStatusWriteResponseReceipt(responseReceipt);
  const target = sha(value.target_sha, "status binding.target_sha");
  if (value.role === "head-sentinel") {
    exact(target, scope.head_oid, "status binding head target");
  } else if (value.role === "primary-terminal") {
    exact(target, scope.potential_merge_oid,
      "status binding potential-merge target");
  } else {
    throw new TypeError("status binding role is unsupported");
  }
}

function validateCommentBindingAudit(value, label) {
  assertObject(value, label);
  exactKeys(value, [
    "record_oid", "payload_digest", "comment_id", "comment_node_id",
    "raw_body_sha256", "actor", "app", "pre_comment_inventory_digest",
    "post_comment_inventory_digest",
  ], label);
  sha(value.record_oid, `${label}.record_oid`);
  digest(value.payload_digest, `${label}.payload_digest`);
  decimal(value.comment_id, `${label}.comment_id`);
  boundedString(value.comment_node_id, `${label}.comment_node_id`, 256);
  digest(value.raw_body_sha256, `${label}.raw_body_sha256`);
  validateActor(value.actor, `${label}.actor`);
  validateApp(value.app, `${label}.app`);
  digest(value.pre_comment_inventory_digest,
    `${label}.pre_comment_inventory_digest`);
  digest(value.post_comment_inventory_digest,
    `${label}.post_comment_inventory_digest`);
}

function validateRepository(value) {
  assertObject(value, "control_plane_receipt.repository");
  exactKeys(value, ["owner", "name", "id", "node_id", "owner_id"],
    "control_plane_receipt.repository");
  boundedString(value.owner, "repository.owner", 100);
  boundedString(value.name, "repository.name", 100);
  decimal(value.id, "repository.id");
  boundedString(value.node_id, "repository.node_id", 256);
  decimal(value.owner_id, "repository.owner_id");
}

function validateRepositoryEndpointReceipt(value, repository) {
  assertObject(value, "repository_endpoint_receipt");
  exactKeys(value, ["method", "path", "status", "server_time", "raw_body_sha256"],
    "repository_endpoint_receipt");
  exact(value.method, "GET", "repository_endpoint_receipt.method");
  exact(value.path, `/repos/${repository.owner}/${repository.name}`,
    "repository_endpoint_receipt.path");
  exact(value.status, 200, "repository_endpoint_receipt.status");
  timestamp(value.server_time, "repository_endpoint_receipt.server_time");
  digest(value.raw_body_sha256, "repository_endpoint_receipt.raw_body_sha256");
}

function validateProjectedScope(value, repository) {
  assertObject(value, "control_plane_receipt.scope");
  exactKeys(value, [
    "repository_id", "repository_node_id", "pull_request_number",
    "pull_request_node_id", "base_oid", "head_oid", "potential_merge_oid",
    "review_epoch_digest",
  ], "control_plane_receipt.scope");
  exact(value.repository_id, repository.id, "scope.repository_id");
  exact(value.repository_node_id, repository.node_id,
    "scope.repository_node_id");
  integer(value.pull_request_number, 1, Number.MAX_SAFE_INTEGER,
    "scope.pull_request_number");
  boundedString(value.pull_request_node_id, "scope.pull_request_node_id", 256);
  sha(value.base_oid, "scope.base_oid");
  sha(value.head_oid, "scope.head_oid");
  nullableSha(value.potential_merge_oid, "scope.potential_merge_oid");
  digest(value.review_epoch_digest, "scope.review_epoch_digest");
}

function validateCapabilityAttestation(value) {
  assertObject(value, "capability_attestation");
  exactKeys(value, [
    "record_oid", "oidc_attestation_digest",
    "workflow_provenance_policy_digest", "controller_release_digest",
    "provider_identity_policy_catalog_digest",
  ], "capability_attestation");
  sha(value.record_oid, "capability_attestation.record_oid");
  digest(value.oidc_attestation_digest,
    "capability_attestation.oidc_attestation_digest");
  digest(value.workflow_provenance_policy_digest,
    "capability_attestation.workflow_provenance_policy_digest");
  digest(value.controller_release_digest,
    "capability_attestation.controller_release_digest");
  digest(value.provider_identity_policy_catalog_digest,
    "capability_attestation.provider_identity_policy_catalog_digest");
}

function validateTwoPassReads(value, tipOid) {
  assertObject(value, "two_pass_reads");
  exactKeys(value, ["pre", "post", "stable"], "two_pass_reads");
  exact(value.stable, true, "two_pass_reads.stable");
  for (const [key, index] of [["pre", 1], ["post", 2]]) {
    const read = value[key];
    assertObject(read, `two_pass_reads.${key}`);
    exactKeys(read, ["read_index", "ref_oid", "server_time", "raw_body_sha256"],
      `two_pass_reads.${key}`);
    exact(read.read_index, index, `two_pass_reads.${key}.read_index`);
    exact(read.ref_oid, tipOid, `two_pass_reads.${key}.ref_oid`);
    timestamp(read.server_time, `two_pass_reads.${key}.server_time`);
    digest(read.raw_body_sha256, `two_pass_reads.${key}.raw_body_sha256`);
  }
  if (Date.parse(value.post.server_time) < Date.parse(value.pre.server_time)) {
    fail("TWO_PASS_TIME_REGRESSED", "ledger two-pass server Date regressed");
  }
}

function validateOpaqueReceipt(value, label) {
  assertObject(value, label);
  validateCanonicalJsonValue(value, label);
  const digests = [value.receipt_digest, value.protection_digest]
    .filter((item) => item !== undefined);
  if (digests.length === 0) {
    throw new TypeError(`${label} needs a receipt or protection digest`);
  }
  for (const item of digests) digest(item, `${label} digest`);
}

function validateExpectedScope(expected, actual) {
  assertObject(expected, "expected control plane scope");
  const aliases = {
    pull_request_number: expected.pull_request_number ?? expected.pull_request?.number,
    pull_request_node_id:
      expected.pull_request_node_id ?? expected.pull_request?.node_id,
    base_oid: expected.base_oid ?? expected.base_ref_oid,
    head_oid: expected.head_oid ?? expected.head_ref_oid,
    potential_merge_oid: Object.hasOwn(expected, "potential_merge_oid")
      ? expected.potential_merge_oid
      : expected.potential_merge_commit_oid,
  };
  for (const [key, value] of Object.entries(aliases)) {
    exact(actual[key], value, `control plane expected scope ${key}`);
  }
}

function validateActor(value, label) {
  assertObject(value, label);
  exactKeys(value, ["id", "node_id", "login", "type"], label);
  decimal(value.id, `${label}.id`);
  boundedString(value.node_id, `${label}.node_id`, 256);
  boundedString(value.login, `${label}.login`, 128);
  boundedString(value.type, `${label}.type`, 64);
}

function validateApp(value, label) {
  assertObject(value, label);
  exactKeys(value, ["id", "node_id", "slug"], label);
  decimal(value.id, `${label}.id`);
  boundedString(value.node_id, `${label}.node_id`, 256);
  boundedString(value.slug, `${label}.slug`, 128);
}

function validateSelector(value, label) {
  assertObject(value, label);
  exactKeys(value, ["kind", "id"], label);
  if (!new Set(["issue_comment", "pull_request_review", "inline_comment"])
    .has(value.kind)) {
    throw new TypeError(`${label}.kind is unsupported`);
  }
  decimal(value.id, `${label}.id`);
}

function generationKindOrder(kind) {
  return kind === "automatic" ? 0 : 1;
}

function boundedArray(value, maximum, label) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  for (const item of value) validateCanonicalJsonValue(item, label);
  return value;
}

function validateCanonicalJsonValue(value, label, depth = 0) {
  if (depth > 64) throw new TypeError(`${label} is too deeply nested`);
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`${label} contains a non-canonical number`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) validateCanonicalJsonValue(item, label, depth + 1);
    return;
  }
  assertObject(value, label);
  for (const [key, item] of Object.entries(value)) {
    boundedString(key, `${label} key`, 256);
    validateCanonicalJsonValue(item, label, depth + 1);
  }
}

function assertObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length ||
      actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} must use the closed key set ${wanted.join(", ")}`);
  }
}

function exact(value, expected, label) {
  if (value !== expected) {
    throw new TypeError(`${label} must equal ${String(expected)}`);
  }
  return value;
}

function integer(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer in its closed range`);
  }
  return value;
}

function boundedString(value, label, maximum) {
  if (typeof value !== "string" || value.length === 0 ||
      Buffer.byteLength(value, "utf8") > maximum ||
      /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${label} must be a nonempty bounded string`);
  }
  return value;
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

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} must be a canonical SHA-256 digest`);
  }
  return value;
}

function nullableDigest(value, label) {
  return value === null ? null : digest(value, label);
}

function decimal(value, label) {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new TypeError(`${label} must be a canonical decimal string`);
  }
  return value;
}

function nullableDecimal(value, label) {
  return value === null ? null : decimal(value, label);
}

function timestamp(value, label) {
  if (typeof value !== "string" || !TIMESTAMP.test(value) ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(Date.parse(value)).toISOString() !== normalizeTimestamp(value)) {
    throw new TypeError(`${label} must be a canonical UTC timestamp`);
  }
  return value;
}

function nullableTimestamp(value, label) {
  return value === null ? null : timestamp(value, label);
}

function normalizeTimestamp(value) {
  const [prefix, fraction] = value.slice(0, -1).split(".");
  return `${prefix}.${(fraction ?? "000").padEnd(3, "0")}Z`;
}

function githubUrl(value, label) {
  boundedString(value, label, 2048);
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new TypeError(`${label} must be an absolute URL`, { cause: error });
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" ||
      parsed.username !== "" || parsed.password !== "") {
    throw new TypeError(`${label} must be one credential-free github.com URL`);
  }
  return value;
}

function nullableUrl(value, label) {
  return value === null ? null : githubUrl(value, label);
}

function digestCanonical(domain, value) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0${canonicalJson(value)}`, "utf8")
    .digest("hex")}`;
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" ||
      typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function fail(code, message) {
  throw new V2ControlPlaneReceiptError(code, message);
}
