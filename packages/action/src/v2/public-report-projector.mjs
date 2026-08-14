import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  codexInlineParentReviewBodyHasClosedGrammar,
  isExactV2CodexProviderIdentity,
  parseCodexIssueCommentArtifact,
  parseCodexReviewArtifact,
} from "../core.mjs";
import {
  assertV2PublicReport,
} from "./public-report.mjs";
import {
  projectV2TransportSnapshots,
} from "./projector.mjs";
import {
  reduceV2Snapshot,
} from "./reducer.mjs";
import {
  V2_STATUS_CONTEXT,
  assertV2ReducerInput,
  assertV2ReducerOutput,
} from "./schema.mjs";
import {
  assertV2Snapshot,
} from "./transport.mjs";

export const V2_PUBLIC_REPORT_SELECTION_AUTHORITY_SCHEMA =
  "codex-review-gate-public-selection-authority-v2";
export const V2_PUBLIC_REPORT_SELECTION_AUTHORITY_SCHEMA_VERSION = 1;

const SELECTION_SOURCES = new Set([
  "none",
  "active-ruleset",
  "workflow",
  "joey-default",
  "user-explicit",
  "legacy-triple",
]);
const NON_SUCCESS_HEAD_STATES = new Set(["pending", "failure", "error"]);
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const STRICT_UTC =
  /^(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d{1,3}))?Z$/u;

export class V2PublicReportProjectionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "V2PublicReportProjectionError";
    this.code = code;
  }
}

/**
 * Project the internal compact reducer result into the canonical public v2
 * report. Every public fact is re-bound to the sealed reducer input, the final
 * complete transport snapshot, and a controller-owned selection authority.
 * This function never upgrades an absent or incomplete fact by inference.
 */
export function projectV2PublicReport({
  compact_report,
  reducer_input,
  evidence_snapshot,
  selection_authority,
  head_sentinel_receipt,
}) {
  assertV2ReducerOutput(compact_report);
  assertV2ReducerInput(reducer_input);
  assertV2Snapshot(evidence_snapshot);
  const selectionAuthority = validateV2PublicReportSelectionAuthority(
    selection_authority,
  );
  bindCompactReport(compact_report, reducer_input, evidence_snapshot);
  bindSelectionAuthority(
    selectionAuthority,
    compact_report,
    reducer_input,
    evidence_snapshot,
  );

  const selection = structuredClone(selectionAuthority.selection);
  const selectedRequest = selectedRequestFromReducer(
    compact_report,
    reducer_input,
  );
  const requestPolicy = projectRequestPolicy({
    compactReport: compact_report,
    reducerInput: reducer_input,
    selection,
    selectedRequest,
  });

  if (!selection.selected) {
    const publicReport = sealPublicReport({
      schema_version: 2,
      selection,
      server_enforcement: "not-applicable",
      review_epoch: null,
      request_policy: requestPolicy,
      provider_profile: null,
      provider_input_lineage: "unavailable",
      evidence_basis: null,
      status_target: null,
      decision: "not-selected",
      freshness_assurance: "point-in-time",
    }, {
      compactFingerprint: compact_report.snapshot_fingerprint,
      selectionAuthority,
      headSentinelReceipt: null,
    });
    assertV2PublicReport(publicReport);
    return deepFreeze(publicReport);
  }

  const preEpochBlocker = isPreEpochBlocker(compact_report, evidence_snapshot);
  const reviewEpoch = preEpochBlocker
    ? null
    : projectReviewEpoch({
        compactReport: compact_report,
        evidenceSnapshot: evidence_snapshot,
        selectedRequest,
      });
  const statusTarget = preEpochBlocker
    ? null
    : projectStatusTarget({
        compactReport: compact_report,
        evidenceSnapshot: evidence_snapshot,
        headSentinelReceipt: head_sentinel_receipt,
      });
  const evidenceBasis = projectEvidenceBasis({
    compactReport: compact_report,
    reducerInput: reducer_input,
    evidenceSnapshot: evidence_snapshot,
    requestPolicy,
    preEpochBlocker,
  });
  const publicReport = sealPublicReport({
    schema_version: 2,
    selection,
    server_enforcement: selectionAuthority.server_enforcement,
    review_epoch: reviewEpoch,
    request_policy: requestPolicy,
    provider_profile: preEpochBlocker ? null : compact_report.provider_profile,
    provider_input_lineage: "unavailable",
    evidence_basis: evidenceBasis,
    status_target: statusTarget,
    decision: compact_report.decision,
    freshness_assurance: "point-in-time",
  }, {
    compactFingerprint: compact_report.snapshot_fingerprint,
    selectionAuthority,
    headSentinelReceipt: head_sentinel_receipt,
  });
  try {
    assertV2PublicReport(publicReport);
  } catch (error) {
    throw projectionFailure(
      "PUBLIC_REPORT_UNREPRESENTABLE",
      `sealed internal state cannot be represented by the canonical public report: ${error.message}`,
      error,
    );
  }
  return deepFreeze(publicReport);
}

export function projectV2AutomaticRequestRecoveryAuthority({
  compact_report,
  reducer_input,
  discovery_snapshot,
  evidence_snapshot,
  controller,
  controlled_request,
}) {
  assertV2ReducerOutput(compact_report);
  assertV2ReducerInput(reducer_input);
  assertV2Snapshot(discovery_snapshot);
  assertV2Snapshot(evidence_snapshot);
  const canonicalReducerInput = projectV2TransportSnapshots({
    discovery_snapshot,
    evidence_snapshot,
    controller,
  });
  if (!isDeepStrictEqual(canonicalReducerInput, reducer_input)) return null;
  const canonicalReport = reduceV2Snapshot(canonicalReducerInput, {
    status_target_mode: compact_report.status_target.mode,
    status_context: compact_report.status_target.context,
  });
  if (!isDeepStrictEqual(canonicalReport, compact_report)) return null;
  bindCompactReport(compact_report, reducer_input, evidence_snapshot);
  bindAutomaticRecoverySnapshot(reducer_input, evidence_snapshot);
  if (
    compact_report.decision !== "findings" ||
    compact_report.evidence_basis?.kind !== "terminal-findings" ||
    compact_report.request_policy.status !== "compliant" ||
    controlled_request === null ||
    reducer_input.complete !== true ||
    !Object.values(reducer_input.inventories).every((value) => value === true) ||
    reducer_input.scope_stable !== true ||
    evidence_snapshot.stability.scope_stable !== true ||
    evidence_snapshot.stability.server_time_monotonic !== true
  ) {
    return null;
  }
  record(controlled_request, "controlled_request");
  exactKeys(controlled_request, [
    "request_id", "bound_at", "binding_record_oid", "binding_receipt_digest",
  ], "controlled_request");
  decimal(controlled_request.request_id, "controlled_request.request_id");
  timestamp(controlled_request.bound_at, "controlled_request.bound_at");
  sha(controlled_request.binding_record_oid,
    "controlled_request.binding_record_oid");
  digest(controlled_request.binding_receipt_digest,
    "controlled_request.binding_receipt_digest");
  const selectedRequest = selectedRequestFromReducer(
    compact_report,
    reducer_input,
  );
  if (
    selectedRequest === null ||
    selectedRequest.kind !== "automatic" ||
    selectedRequest.controlled !== true ||
    selectedRequest.stable !== true ||
    selectedRequest.body !== "@codex review" ||
    selectedRequest.created_at !== selectedRequest.updated_at ||
    selectedRequest.id !== controlled_request.request_id ||
    selectedRequest.created_at !== controlled_request.bound_at ||
    selectedRequest.head_oid !== reducer_input.review_epoch.head_oid
  ) {
    throw projectionFailure(
      "AUTOMATIC_RECOVERY_CONTROLLED_REQUEST_MISMATCH",
      "automatic recovery differs from its bound controlled request and review epoch",
    );
  }
  if (
    selectedRequest.generation_kind !== "automatic" ||
    selectedRequest.generation_id !==
      `automatic:${selectedRequest.generation_index}` ||
    selectedRequest.generation_index < 1 ||
    selectedRequest.generation_index >= 3
  ) {
    return null;
  }
  if (!automaticRecoveryRequestInventoryIsClosed({
    selectedRequest,
    reducerInput: reducer_input,
    evidenceSnapshot: evidence_snapshot,
  })) {
    return null;
  }
  const rawRequest = evidence_snapshot.pages.issue_comments.find((item) =>
    item.id === selectedRequest.id);
  if (
    rawRequest === undefined ||
    rawRequest.html_url !== selectedRequest.url ||
    rawRequest.body !== "@codex review" ||
    rawRequest.created_at !== rawRequest.updated_at ||
    rawRequest.created_at !== selectedRequest.created_at ||
    !hasExactArtifact(
      evidence_snapshot,
      "issue_comment",
      rawRequest.id,
      rawRequest,
    )
  ) {
    throw projectionFailure(
      "AUTOMATIC_RECOVERY_REQUEST_TRANSPORT_MISMATCH",
      "automatic recovery request is absent from the final exact transport snapshot",
    );
  }
  const postRequestFindingArtifacts = reducer_input.artifacts
    .filter((artifact) =>
      artifact.kind === "terminal-findings" &&
      artifact.commit_oid === reducer_input.review_epoch.head_oid &&
      Date.parse(artifact.created_at) > Date.parse(selectedRequest.created_at));
  if (postRequestFindingArtifacts.some((artifact) =>
    artifact.stable !== true || artifact.request_id !== selectedRequest.id)) {
    return null;
  }
  const findingArtifacts = postRequestFindingArtifacts
    .sort((left, right) =>
      Date.parse(left.created_at) - Date.parse(right.created_at) ||
      compareDecimal(left.id, right.id));
  if (
    findingArtifacts.length === 0 ||
    !findingArtifacts.some((artifact) =>
      artifact.id === compact_report.evidence_basis.artifact_id)
  ) {
    return null;
  }
  if (!automaticRecoveryTerminalInventoryIsClosed({
    selectedArtifactId: compact_report.evidence_basis.artifact_id,
    reducerInput: reducer_input,
    evidenceSnapshot: evidence_snapshot,
  })) {
    return null;
  }
  const closureRecords = [];
  for (const artifact of findingArtifacts) {
    if (
      !automaticRecoveryFindingCarrierIsExact(artifact, evidence_snapshot) ||
      !automaticRecoveryArtifactTimingIsExact(artifact, reducer_input)
    ) {
      throw projectionFailure(
        "AUTOMATIC_RECOVERY_FINDING_TRANSPORT_MISMATCH",
        `automatic recovery finding ${artifact.id} lacks its final exact provider carrier`,
      );
    }
    for (const findingId of artifact.finding_ids) {
      const closure = automaticRecoveryClosureRecord({
        artifact,
        findingId,
        reducerInput: reducer_input,
        evidenceSnapshot: evidence_snapshot,
      });
      if (closure === null) return null;
      closureRecords.push(closure);
    }
  }
  if (closureRecords.length === 0) return null;
  const findingIds = closureRecords.map((item) => item.finding_id);
  const closureIds = closureRecords.map((item) => item.closure_id);
  if (
    new Set(findingIds).size !== findingIds.length ||
    new Set(closureIds).size !== closureIds.length
  ) {
    throw projectionFailure(
      "AUTOMATIC_RECOVERY_CLOSURE_CONFLICT",
      "automatic recovery repeats a finding or closure authority",
    );
  }
  const scope = {
    repository_node_id: evidence_snapshot.repository.node_id,
    pull_request_node_id: evidence_snapshot.pull_request.node_id,
    pull_request_number: evidence_snapshot.pull_request.number,
    base_oid: reducer_input.review_epoch.base_oid,
    head_oid: reducer_input.review_epoch.head_oid,
    merge_base_oid: reducer_input.review_epoch.merge_base_oid,
  };
  const withoutDigest = {
    schema: "codex-review-gate-automatic-request-recovery-authority-v2",
    schema_version: 1,
    decision: "findings",
    snapshot_fingerprint: compact_report.snapshot_fingerprint,
    review_epoch_id: automaticRecoveryEpochId({
      repository_node_id: evidence_snapshot.repository.node_id,
      pull_request_node_id: evidence_snapshot.pull_request.node_id,
      head_ref_oid: reducer_input.review_epoch.head_oid,
    }),
    prior_generation_id: selectedRequest.generation_id,
    prior_generation_index: selectedRequest.generation_index,
    next_generation_id: `automatic:${selectedRequest.generation_index + 1}`,
    next_generation_index: selectedRequest.generation_index + 1,
    prior_request_id: selectedRequest.id,
    prior_request_binding_record_oid: controlled_request.binding_record_oid,
    prior_request_binding_receipt_digest:
      controlled_request.binding_receipt_digest,
    scope,
    scope_digest: projectionDigest(
      "codex-review-gate-v2-automatic-recovery-scope",
      scope,
    ),
    finding_ids: findingIds,
    closure_ids: closureIds,
    closure_records: closureRecords,
    finding_observed_at: closureRecords.reduce((latest, item) =>
      Date.parse(item.finding_server_time) > Date.parse(latest)
        ? item.finding_server_time
        : latest,
    closureRecords[0].finding_server_time),
    closure_observed_at: closureRecords.reduce((latest, item) =>
      Date.parse(item.closure_server_time) > Date.parse(latest)
        ? item.closure_server_time
        : latest,
    closureRecords[0].closure_server_time),
    final_snapshot_server_time: evidence_snapshot.server_time,
    pagination_sha256: reducer_input.evidence_authority.pagination_sha256,
    final_reread_sha256: reducer_input.evidence_authority.final_reread_sha256,
    evidence_snapshot_digest: projectionDigest(
      "codex-review-gate-v2-automatic-recovery-evidence-snapshot",
      evidence_snapshot,
    ),
    reducer_input_digest: projectionDigest(
      "codex-review-gate-v2-automatic-recovery-reducer-input",
      reducer_input,
    ),
    reducer_report_digest: projectionDigest(
      "codex-review-gate-v2-automatic-recovery-reducer-report",
      compact_report,
    ),
    same_review_epoch: true,
  };
  return deepFreeze({
    ...withoutDigest,
    authority_digest: projectionDigest(
      "codex-review-gate-v2-automatic-request-recovery-authority",
      withoutDigest,
    ),
  });
}

function isPreEpochBlocker(compactReport, evidenceSnapshot) {
  if (!["blocked-input", "blocked-configuration"].includes(compactReport.decision)) {
    return false;
  }
  const epoch = compactReport.review_epoch;
  return (
    epoch.lifecycle !== "open" ||
    evidenceSnapshot.pull_request.state !== "OPEN" ||
    evidenceSnapshot.pull_request.merged !== false ||
    evidenceSnapshot.pull_request.merged_at !== null ||
    !SHA.test(epoch.base_oid ?? "") ||
    !SHA.test(epoch.head_oid ?? "") ||
    !SHA.test(epoch.merge_base_oid ?? "")
  );
}

export function validateV2PublicReportSelectionAuthority(value) {
  record(value, "selection_authority");
  exactKeys(value, [
    "schema",
    "schema_version",
    "repository_node_id",
    "pull_request_node_id",
    "head_ref_oid",
    "selection",
    "server_enforcement",
    "authority_receipt_digest",
  ], "selection_authority");
  exact(
    value.schema,
    V2_PUBLIC_REPORT_SELECTION_AUTHORITY_SCHEMA,
    "selection_authority.schema",
  );
  exact(
    value.schema_version,
    V2_PUBLIC_REPORT_SELECTION_AUTHORITY_SCHEMA_VERSION,
    "selection_authority.schema_version",
  );
  boundedString(value.repository_node_id, "selection_authority.repository_node_id", 256);
  boundedString(value.pull_request_node_id, "selection_authority.pull_request_node_id", 256);
  sha(value.head_ref_oid, "selection_authority.head_ref_oid");
  validatePublicSelection(value.selection);
  oneOf(
    value.server_enforcement,
    new Set(["enforced", "not-enforced", "not-applicable"]),
    "selection_authority.server_enforcement",
  );
  // This digest is an external binding to the trusted controller/control-plane
  // receipt. The projector deliberately has no API that self-seals authority.
  digest(value.authority_receipt_digest, "selection_authority.authority_receipt_digest");
  exact(
    value.server_enforcement === "not-applicable",
    !value.selection.selected,
    "selection_authority not-applicable relation",
  );
  return value;
}

function validatePublicSelection(value) {
  record(value, "selection_authority.selection");
  exactKeys(value, ["selected", "intent", "mode", "source"],
    "selection_authority.selection");
  boolean(value.selected, "selection_authority.selection.selected");
  oneOf(value.source, SELECTION_SOURCES, "selection_authority.selection.source");
  const expected = value.source === "none"
    ? [false, "none", "none"]
    : [true,
        ["user-explicit", "legacy-triple"].includes(value.source)
          ? "explicit"
          : "required",
        ["user-explicit", "legacy-triple"].includes(value.source)
          ? "explicit"
          : "implicit"];
  exact(value.selected, expected[0], "selection_authority.selection.selected");
  exact(value.intent, expected[1], "selection_authority.selection.intent");
  exact(value.mode, expected[2], "selection_authority.selection.mode");
}

function bindSelectionAuthority(authority, report, input, snapshot) {
  exact(authority.repository_node_id, snapshot.repository.node_id,
    "selection_authority.repository_node_id");
  exact(authority.pull_request_node_id, snapshot.pull_request.node_id,
    "selection_authority.pull_request_node_id");
  exact(authority.head_ref_oid, snapshot.scope.head_ref_oid,
    "selection_authority.head_ref_oid");
  const { source } = authority.selection;
  if (source === "none") {
    if (input.selection.eligible || input.selection.intent !== "disabled" ||
        report.selection.status !== "not-selected") {
      throw projectionFailure(
        "SELECTION_AUTHORITY_MISMATCH",
        "unselected authority does not match the sealed reducer selection",
      );
    }
    return;
  }
  if (!input.selection.eligible || report.selection.status === "not-selected") {
    throw projectionFailure(
      "SELECTION_AUTHORITY_MISMATCH",
      "selected authority does not match the sealed reducer selection",
    );
  }
  const explicit = source === "user-explicit" ||
    source === "legacy-triple";
  exact(input.selection.intent, explicit ? "explicit" : "implicit",
    "selection authority intent");
  if (source === "active-ruleset" && !input.server_enforcement.ruleset_required) {
    throw projectionFailure(
      "SELECTION_AUTHORITY_MISMATCH",
      "active-ruleset selection has no required ruleset receipt",
    );
  }
  if (source === "workflow" &&
      (!input.server_enforcement.workflow_present ||
       input.server_enforcement.ruleset_required)) {
    throw projectionFailure(
      "SELECTION_AUTHORITY_MISMATCH",
      "workflow selection does not match the sealed workflow/ruleset facts",
    );
  }
  if (source === "joey-default" &&
      (input.server_enforcement.workflow_present ||
       input.server_enforcement.ruleset_required)) {
    throw projectionFailure(
      "SELECTION_AUTHORITY_MISMATCH",
      "joey-default selection cannot replace an observed workflow or ruleset source",
    );
  }
  const expectedEnforcement = deriveServerEnforcement(input, source);
  exact(authority.server_enforcement, expectedEnforcement,
    "selection_authority.server_enforcement");
}

function deriveServerEnforcement(input, source) {
  if (source === "none") return "not-applicable";
  const server = input.server_enforcement;
  return server.ruleset_required &&
    server.controller_available &&
    server.workflow_present &&
    server.workflow_compatible &&
    server.ruleset_compatible &&
    server.app_bound
    ? "enforced"
    : "not-enforced";
}

function bindCompactReport(report, input, snapshot) {
  exact(report.snapshot_fingerprint, input.snapshot_fingerprint,
    "compact_report.snapshot_fingerprint");
  if (!isDeepStrictEqual(report.review_epoch, input.review_epoch)) {
    throw projectionFailure(
      "COMPACT_REPORT_INPUT_MISMATCH",
      "compact report review epoch differs from the sealed reducer input",
    );
  }
  const expectedEpoch = {
    repository_id: snapshot.repository.node_id,
    pull_request_number: snapshot.pull_request.number,
    base_oid: snapshot.scope.base_ref_tip,
    head_oid: snapshot.scope.head_ref_oid,
    merge_base_oid: snapshot.scope.merge_base_sha,
    merge_oid: snapshot.scope.potential_merge_oid,
    merge_tree_oid: snapshot.scope.potential_merge_tree,
    merge_parents: [...snapshot.scope.ordered_parent_oids],
    merge_ref_oid: snapshot.scope.merge_ref_oid,
    mergeable: snapshot.scope.mergeable,
    lifecycle: snapshotLifecycle(snapshot.pull_request),
  };
  if (!isDeepStrictEqual(input.review_epoch, expectedEpoch)) {
    throw projectionFailure(
      "REDUCER_TRANSPORT_EPOCH_MISMATCH",
      "sealed reducer input does not bind the final transport review epoch",
    );
  }
  exact(input.evidence_authority.pagination_sha256,
    report.evidence_basis?.authority_receipt.pagination_sha256 ??
      input.evidence_authority.pagination_sha256,
    "compact report pagination authority");
  exact(input.evidence_authority.final_reread_sha256,
    report.evidence_basis?.authority_receipt.final_reread_sha256 ??
      input.evidence_authority.final_reread_sha256,
    "compact report final reread authority");
}

function selectedRequestFromReducer(report, input) {
  const selectedId = report.request_policy.selected_request_id;
  if (selectedId === null) {
    for (const key of ["generation_id", "generation_kind", "generation_index"]) {
      exact(report.request_policy[key], null, `compact_report.request_policy.${key}`);
    }
    return null;
  }
  const matches = input.requests.filter((request) => request.id === selectedId);
  if (matches.length !== 1) {
    throw projectionFailure(
      "SELECTED_REQUEST_NOT_UNIQUE",
      "compact report selected request does not bind one sealed request",
    );
  }
  const request = matches[0];
  exact(report.request_policy.generation_id, request.generation_id,
    "compact_report.request_policy.generation_id");
  exact(report.request_policy.generation_kind, request.generation_kind,
    "compact_report.request_policy.generation_kind");
  exact(report.request_policy.generation_index, request.generation_index,
    "compact_report.request_policy.generation_index");
  return request;
}

function projectRequestPolicy({ compactReport, reducerInput, selection, selectedRequest }) {
  const legacy = selection.source === "legacy-triple";
  const status = !selection.selected
    ? "not-applicable"
    : legacy && compactReport.request_policy.status === "compliant"
      ? "warning"
      : compactReport.request_policy.status;
  const permission = selectedRequest?.kind === "manual"
    ? {
        permission_assurance: compactReport.request_policy.permission_assurance,
        request_time_permission: compactReport.request_policy.request_time_permission,
        permission_aba_excluded: compactReport.request_policy.permission_aba_excluded,
      }
    : {
        permission_assurance: null,
        request_time_permission: null,
        permission_aba_excluded: null,
      };
  return {
    status,
    warnings: legacy ? ["legacy-triple-alias"] : [],
    warning_evidence: { legacy_triple_alias: legacy ? true : null },
    request_id: selectedRequest?.id ?? null,
    request_url: selectedRequest?.url ?? null,
    manual: selectedRequest?.kind === "manual",
    generation_id: selectedRequest?.generation_id ?? null,
    generation_kind: selectedRequest?.generation_kind ?? null,
    generation_index: selectedRequest?.generation_index ?? null,
    automatic_reservations_consumed_on_head:
      reducerInput.budget.automatic_reservations_on_head,
    manual_requests_in_review_epoch:
      reducerInput.budget.manual_requests_in_epoch,
    ...permission,
  };
}

function projectReviewEpoch({ compactReport, evidenceSnapshot, selectedRequest }) {
  const epoch = compactReport.review_epoch;
  if (
    evidenceSnapshot.pull_request.state !== "OPEN" ||
    evidenceSnapshot.pull_request.merged !== false ||
    evidenceSnapshot.pull_request.merged_at !== null ||
    epoch.lifecycle !== "open"
  ) {
    throw projectionFailure(
      "PUBLIC_REVIEW_EPOCH_UNAVAILABLE",
      "canonical public review_epoch cannot represent a non-open pull request",
    );
  }
  if (!SHA.test(epoch.base_oid ?? "") || !SHA.test(epoch.head_oid ?? "") ||
      !SHA.test(epoch.merge_base_oid ?? "")) {
    throw projectionFailure(
      "PUBLIC_REVIEW_EPOCH_UNAVAILABLE",
      "canonical public review_epoch requires exact base, head, and merge-base OIDs",
    );
  }
  return {
    host: "github.com",
    repository: `${evidenceSnapshot.repository.owner}/${evidenceSnapshot.repository.name}`,
    pull_request: evidenceSnapshot.pull_request.number,
    pr_state: "OPEN",
    pr_merged: false,
    pr_merged_at: null,
    base_ref: evidenceSnapshot.scope.base_ref_name,
    live_base_ref_tip: epoch.base_oid,
    head_ref: evidenceSnapshot.scope.head_ref_name,
    head_ref_oid: epoch.head_oid,
    pr_merge_base: epoch.merge_base_oid,
    controlled_request_id:
      selectedRequest?.kind === "automatic" && selectedRequest.controlled
        ? selectedRequest.id
        : null,
  };
}

function projectStatusTarget({ compactReport, evidenceSnapshot, headSentinelReceipt }) {
  const mode = compactReport.status_target.mode;
  const headState = validateHeadSentinelReceipt(
    headSentinelReceipt,
    evidenceSnapshot,
  );
  if (mode === "test-merge-with-head-sentinel" &&
      ["clean", "skipped-unavailable"].includes(compactReport.decision) &&
      !NON_SUCCESS_HEAD_STATES.has(headState)) {
    throw projectionFailure(
      "HEAD_SENTINEL_UNPROVEN",
      "positive terminal public report requires an observed non-success head sentinel",
    );
  }
  const epoch = compactReport.review_epoch;
  const validationReceipt = {
    pre: targetObservation(evidenceSnapshot.scope_receipts.pre, mode),
    post: targetObservation(evidenceSnapshot.scope_receipts.post, mode),
  };
  if (
    Date.parse(validationReceipt.post.observed_http_date) <=
      Date.parse(validationReceipt.pre.observed_http_date)
  ) {
    throw projectionFailure(
      "TARGET_REREAD_TIME_NOT_STRICT",
      "public target validation requires a strictly later final GitHub Date",
    );
  }
  if (mode === "head") {
    return {
      context: V2_STATUS_CONTEXT,
      mode,
      live_base_ref_tip: epoch.base_oid,
      head_ref_oid: epoch.head_oid,
      pr_merge_base: epoch.merge_base_oid,
      potential_merge_commit_oid: null,
      potential_merge_commit_tree_oid: null,
      potential_merge_commit_parent_oids: null,
      merge_ref_oid: null,
      potential_target_state: "not-applicable",
      head_sentinel_state: headState,
      validation_receipt: validationReceipt,
    };
  }
  const targetState = classifyPotentialTarget(epoch);
  const common = {
    context: V2_STATUS_CONTEXT,
    mode,
    live_base_ref_tip: epoch.base_oid,
    head_ref_oid: epoch.head_oid,
    pr_merge_base: epoch.merge_base_oid,
    head_sentinel_state: headState,
  };
  if (targetState !== "validated") {
    return {
      ...common,
      potential_merge_commit_oid: null,
      potential_merge_commit_tree_oid: null,
      potential_merge_commit_parent_oids: null,
      merge_ref_oid: null,
      potential_target_state: targetState,
      validation_receipt: null,
    };
  }
  return {
    ...common,
    potential_merge_commit_oid: epoch.merge_oid,
    potential_merge_commit_tree_oid: epoch.merge_tree_oid,
    potential_merge_commit_parent_oids: [...epoch.merge_parents],
    merge_ref_oid: epoch.merge_ref_oid,
    potential_target_state: "validated",
    validation_receipt: validationReceipt,
  };
}

function validateHeadSentinelReceipt(receipt, snapshot) {
  if (receipt === null) return "absent";
  record(receipt, "head_sentinel_receipt");
  exactKeys(receipt, ["sha", "context", "state", "status_id", "observed_at"],
    "head_sentinel_receipt");
  exact(receipt.sha, snapshot.scope.head_ref_oid, "head_sentinel_receipt.sha");
  exact(receipt.context, V2_STATUS_CONTEXT, "head_sentinel_receipt.context");
  oneOf(receipt.state, new Set(["pending", "failure", "error"]),
    "head_sentinel_receipt.state");
  decimal(receipt.status_id, "head_sentinel_receipt.status_id");
  timestamp(receipt.observed_at, "head_sentinel_receipt.observed_at");
  if (Date.parse(receipt.observed_at) > Date.parse(snapshot.server_time)) {
    throw projectionFailure(
      "HEAD_SENTINEL_FROM_FUTURE",
      "head sentinel observation follows the final evidence snapshot",
    );
  }
  return receipt.state;
}

function classifyPotentialTarget(epoch) {
  if (epoch.mergeable === "CONFLICTING") return "conflicting";
  if (
    epoch.base_oid === null || epoch.merge_base_oid === null ||
    epoch.merge_oid === null || epoch.merge_tree_oid === null ||
    epoch.merge_ref_oid === null || epoch.merge_parents.length === 0
  ) return "unavailable";
  if (
    epoch.merge_ref_oid !== epoch.merge_oid ||
    !isDeepStrictEqual(epoch.merge_parents, [epoch.base_oid, epoch.head_oid])
  ) return "stale";
  if (
    epoch.mergeable !== "MERGEABLE" ||
    epoch.merge_oid === epoch.base_oid || epoch.merge_oid === epoch.head_oid
  ) return "invalid";
  return "validated";
}

function targetObservation(receipt, mode) {
  const common = {
    observed_http_date: receipt.server_time,
    pr_state: receipt.pull_request_state,
    pr_merged: receipt.pull_request_merged,
    pr_merged_at: receipt.pull_request_merged_at,
    live_base_ref_tip: receipt.base_ref_tip,
    head_ref_oid: receipt.head_ref_oid,
    pr_merge_base: receipt.merge_base_sha,
  };
  if (mode === "head") return common;
  return {
    ...common,
    mergeable: receipt.mergeable,
    potential_merge_commit_oid: receipt.potential_merge_oid,
    potential_merge_commit_tree_oid: receipt.potential_merge_tree,
    potential_merge_commit_parent_oids: [...receipt.ordered_parent_oids],
    merge_ref_oid: receipt.merge_ref_oid,
  };
}

function projectEvidenceBasis({
  compactReport,
  reducerInput,
  evidenceSnapshot,
  requestPolicy,
  preEpochBlocker,
}) {
  if (preEpochBlocker) return null;
  const compactBasis = compactReport.evidence_basis;
  if (compactBasis === null) return null;
  if (compactBasis.kind === "configuration") return null;
  const publicKind = publicBasisKind(compactBasis.kind, compactReport.decision);
  const selected = selectedEvidence({
    compactReport,
    reducerInput,
    evidenceSnapshot,
    publicKind,
    requestPolicy,
  });
  assertSelectedEvidenceTransportBinding({
    publicKind,
    selected,
    requestPolicy,
    evidenceSnapshot,
  });
  const recovery = projectFindingRecovery({
    compactReport,
    reducerInput,
    evidenceSnapshot,
    selected,
  });
  const accepted = [
    "terminal-payload",
    "current-request-reaction",
    "stable-exact-no-start",
  ].includes(publicKind);
  if (accepted &&
      (!reducerInput.complete ||
       !Object.values(reducerInput.inventories).every((value) => value === true))) {
    throw projectionFailure(
      "ACCEPTED_EVIDENCE_INCOMPLETE",
      "accepted public evidence requires every sealed inventory and final reread",
    );
  }
  const authority = compactBasis.authority_receipt;
  return {
    kind: publicKind,
    outcome: compactReport.decision,
    selected_ids: selected.map((item) => item.id),
    selected_urls: selected.map((item) => item.url),
    server_times: {
      request: ["current-request-reaction", "stable-exact-no-start"].includes(publicKind)
        ? requestPolicy.request_id === null
          ? null
          : reducerInput.requests.find((request) => request.id === requestPolicy.request_id)
            ?.created_at ?? null
        : recovery?.new_request_server_time ?? null,
      selected: selected.map((item) => ({
        id: item.id,
        server_time: item.created_at,
      })),
    },
    pagination_complete: reducerInput.inventories.requests &&
      reducerInput.inventories.artifacts &&
      reducerInput.inventories.threads &&
      reducerInput.inventories.acknowledgements &&
      reducerInput.inventories.no_start,
    final_reread_complete: reducerInput.complete,
    scope_assurance: "whole-pr-contractual",
    provider_input_lineage: "unavailable",
    finding_recovery: recovery,
    authority_receipt: {
      selected_request: authority.selected_request === null
        ? null
        : publicSelectedObject(authority.selected_request),
      selected_artifact: authority.selected_artifact === null
        ? null
        : publicSelectedObject(authority.selected_artifact),
      pagination_sha256: authority.pagination_sha256,
      final_reread_sha256: authority.final_reread_sha256,
      recovery: authority.recovery === null
        ? null
        : structuredClone(authority.recovery),
    },
  };
}

function publicBasisKind(kind, decision) {
  if (["terminal-clean", "terminal-findings", "unresolved-inline-finding"].includes(kind)) {
    return "terminal-payload";
  }
  if (kind === "thumbs-up-clean") return "current-request-reaction";
  if (kind === "no-start-rejection") return "stable-exact-no-start";
  if (kind === "malformed-evidence") return "malformed-terminal";
  if (kind === "unknown-terminal") return "unknown-terminal";
  if (kind === "stable-evidence-blocker") return "stable-evidence-blocker";
  if (kind === "input") {
    return decision === "blocked-input"
      ? "stable-input-blocker"
      : "stable-evidence-blocker";
  }
  if (["incomplete-snapshot", "unstable-scope"].includes(kind)) {
    return "stable-evidence-blocker";
  }
  throw projectionFailure(
    "PUBLIC_BASIS_KIND_UNMAPPABLE",
    `compact evidence basis ${kind} has no canonical public mapping`,
  );
}

function selectedEvidence({
  compactReport,
  reducerInput,
  evidenceSnapshot,
  publicKind,
  requestPolicy,
}) {
  const compactBasis = compactReport.evidence_basis;
  const authority = compactBasis.authority_receipt;
  if (publicKind === "current-request-reaction") {
    const acknowledgement = reducerInput.acknowledgements.find((item) =>
      item.id === compactBasis.artifact_id &&
      item.kind === "plus-one" &&
      item.request_id === requestPolicy.request_id &&
      item.exact_provider && item.stable);
    if (acknowledgement === undefined || requestPolicy.request_url === null) {
      throw projectionFailure(
        "REACTION_BASIS_UNBOUND",
        "current-request reaction basis does not bind one exact provider +1 and parent URL",
      );
    }
    return [{
      id: acknowledgement.id,
      url: requestPolicy.request_url,
      created_at: acknowledgement.created_at,
    }];
  }
  if (authority.selected_artifact !== null) {
    return [publicSelectedObject(authority.selected_artifact)];
  }
  if (["stable-evidence-blocker", "stable-input-blocker"].includes(publicKind)) {
    return [];
  }
  const noStart = reducerInput.no_start_observations.find(
    (item) => item.id === compactBasis.artifact_id,
  );
  if (noStart !== undefined) {
    return [{
      id: noStart.id,
      url: noStart.url,
      created_at: noStart.carrier_created_at,
    }];
  }
  throw projectionFailure(
    "SELECTED_EVIDENCE_UNBOUND",
    `${publicKind} basis has no selected evidence object`,
  );
}

function projectFindingRecovery({
  compactReport,
  reducerInput,
  evidenceSnapshot,
  selected,
}) {
  const receipt = compactReport.evidence_basis?.authority_receipt.recovery ?? null;
  if (receipt === null) return null;
  const request = reducerInput.requests.find((item) => item.id === receipt.new_request_id);
  const completion = selected.find((item) => item.id === receipt.completion_id);
  if (request === undefined || completion === undefined) {
    throw projectionFailure(
      "RECOVERY_COMPLETION_UNBOUND",
      "recovery receipt does not bind its new request and selected completion",
    );
  }
  const records = receipt.finding_ids.map((findingId, index) =>
    recoveryClosureRecord({
      findingId,
      closureId: receipt.closure_ids[index],
      reducerInput,
      evidenceSnapshot,
    }));
  return {
    closure_records: records,
    new_generation_id: request.generation_id,
    new_request_id: request.id,
    new_request_server_time: request.created_at,
    later_clean_id: completion.id,
    later_clean_server_time: completion.created_at,
  };
}

function recoveryClosureRecord({ findingId, closureId, reducerInput, evidenceSnapshot }) {
  const artifact = reducerInput.artifacts.find((item) =>
    item.finding_ids.includes(findingId));
  const thread = reducerInput.threads.find((item) => item.finding_id === findingId);
  if (artifact === undefined || thread === undefined) {
    throw projectionFailure(
      "RECOVERY_FINDING_UNBOUND",
      `recovery finding ${findingId} is absent from the sealed artifact/thread inventory`,
    );
  }
  if (thread.kind === "inline") {
    exact(closureId, thread.id, `recovery closure ${findingId}`);
    if (!thread.is_resolved || thread.resolution_observed_at === null) {
      throw projectionFailure(
        "RECOVERY_INLINE_UNRESOLVED",
        `inline recovery finding ${findingId} lacks a final resolved point-read`,
      );
    }
    return {
      finding_id: findingId,
      finding_kind: "inline",
      finding_url: inlineFindingUrl(evidenceSnapshot, thread),
      finding_server_time: artifact.created_at,
      closure_evidence_id: closureId,
      closure_server_time: thread.resolution_observed_at,
      inline_final_is_resolved: true,
      top_level_exact_body: null,
      top_level_unedited: null,
      top_level_actor_stable: null,
      top_level_actor_permission: null,
    };
  }
  const acknowledgement = reducerInput.acknowledgements.find((item) =>
    item.id === closureId && item.finding_id === findingId &&
    item.kind === "addressed" && item.stable && !item.exact_provider);
  const comment = evidenceSnapshot.pages.issue_comments.find(
    (item) => item.id === closureId,
  );
  const permission = evidenceSnapshot.permissions.actor_permissions.find(
    (item) => item.subject.kind === "issue_comment" && item.subject.id === closureId,
  );
  if (
    acknowledgement === undefined || comment === undefined || permission === undefined ||
    !permission.stable || !isDeepStrictEqual(permission.actor, comment.author) ||
    !permission.pre.permissions.push || !permission.post.permissions.push
  ) {
    throw projectionFailure(
      "RECOVERY_ADDRESS_AUTHORITY_UNBOUND",
      `top-level recovery finding ${findingId} lacks exact stable address authority`,
    );
  }
  return {
    finding_id: findingId,
    finding_kind: "top-level",
    finding_url: artifact.url,
    finding_server_time: artifact.created_at,
    closure_evidence_id: acknowledgement.id,
    closure_server_time: acknowledgement.created_at,
    inline_final_is_resolved: null,
    top_level_exact_body: comment.body,
    top_level_unedited: comment.created_at === comment.updated_at,
    top_level_actor_stable: true,
    top_level_actor_permission: permissionLevel(permission.post),
  };
}

function bindAutomaticRecoverySnapshot(reducerInput, evidenceSnapshot) {
  if (reducerInput.observed_at !== evidenceSnapshot.server_time) {
    throw projectionFailure(
      "AUTOMATIC_RECOVERY_SNAPSHOT_TIME_MISMATCH",
      "automatic recovery reducer input is not the final transport point-read",
    );
  }
  const paginationDigest = projectionDigest(
    "codex-review-gate-v2-pagination-authority",
    {
      pages: evidenceSnapshot.pages,
      permissions: evidenceSnapshot.permissions,
      service_start_observations:
        evidenceSnapshot.service_start_observations,
    },
  );
  if (paginationDigest !== reducerInput.evidence_authority.pagination_sha256) {
    throw projectionFailure(
      "AUTOMATIC_RECOVERY_SNAPSHOT_AUTHORITY_MISMATCH",
      "automatic recovery final raw evidence differs from its reducer authority",
    );
  }
}

function automaticRecoveryRequestInventoryIsClosed({
  selectedRequest,
  reducerInput,
  evidenceSnapshot,
}) {
  const currentRequests = reducerInput.requests.filter((request) =>
    request.head_oid === reducerInput.review_epoch.head_oid);
  if (currentRequests.some((request) =>
    compareRecoveryEvidence(request, selectedRequest) > 0)) {
    return false;
  }
  const automaticRequests = currentRequests
    .filter((request) => request.kind === "automatic")
    .sort((left, right) =>
      left.generation_index - right.generation_index ||
      compareRecoveryEvidence(left, right));
  if (automaticRequests.length !== selectedRequest.generation_index) {
    return false;
  }
  if (
    reducerInput.budget.automatic_requests_on_head !==
      selectedRequest.generation_index ||
    reducerInput.budget.automatic_reservations_on_head !==
      selectedRequest.generation_index
  ) {
    return false;
  }
  for (let index = 0; index < automaticRequests.length; index += 1) {
    const request = automaticRequests[index];
    const generationIndex = index + 1;
    const rawRequest = evidenceSnapshot.pages.issue_comments.find((item) =>
      item.id === request.id);
    if (
      request.generation_kind !== "automatic" ||
      request.generation_index !== generationIndex ||
      request.generation_id !== `automatic:${generationIndex}` ||
      request.controlled !== true ||
      request.stable !== true ||
      request.body !== "@codex review" ||
      request.created_at !== request.updated_at ||
      rawRequest === undefined ||
      rawRequest.html_url !== request.url ||
      rawRequest.body !== request.body ||
      rawRequest.created_at !== request.created_at ||
      rawRequest.updated_at !== request.updated_at ||
      !hasExactArtifact(
        evidenceSnapshot,
        "issue_comment",
        rawRequest.id,
        rawRequest,
      ) ||
      (index > 0 &&
        compareRecoveryEvidence(automaticRequests[index - 1], request) >= 0)
    ) {
      return false;
    }
    if (index > 0 && !automaticRecoveryGenerationPredecessorIsClosed({
      priorRequest: automaticRequests[index - 1],
      nextRequest: request,
      reducerInput,
      evidenceSnapshot,
    })) {
      return false;
    }
  }
  if (automaticRequests.at(-1)?.id !== selectedRequest.id) return false;

  const reducerRequestsById = new Map(
    reducerInput.requests.map((request) => [request.id, request]),
  );
  for (const rawRequest of evidenceSnapshot.pages.issue_comments.filter(
    (comment) => comment.body === "@codex review",
  )) {
    const projected = reducerRequestsById.get(rawRequest.id);
    if (
      projected === undefined ||
      projected.url !== rawRequest.html_url ||
      projected.created_at !== rawRequest.created_at ||
      projected.updated_at !== rawRequest.updated_at ||
      !hasExactArtifact(
        evidenceSnapshot,
        "issue_comment",
        rawRequest.id,
        rawRequest,
      )
    ) {
      return false;
    }
    if (
      compareRecoveryEvidence(
        { id: rawRequest.id, created_at: rawRequest.created_at },
        selectedRequest,
      ) > 0
    ) {
      return false;
    }
  }
  return true;
}

function automaticRecoveryGenerationPredecessorIsClosed({
  priorRequest,
  nextRequest,
  reducerInput,
  evidenceSnapshot,
}) {
  const selectedPredecessor = selectAutomaticRecoveryTerminalArtifact(
    reducerInput.artifacts.filter((artifact) =>
      artifact.commit_oid === reducerInput.review_epoch.head_oid &&
      ["terminal-clean", "terminal-findings", "malformed"]
        .includes(artifact.kind) &&
      Date.parse(artifact.created_at) > Date.parse(priorRequest.created_at) &&
      Date.parse(artifact.created_at) <= Date.parse(nextRequest.created_at)),
  );
  if (
    selectedPredecessor === null ||
    selectedPredecessor.stable !== true ||
    selectedPredecessor.kind !== "terminal-findings" ||
    selectedPredecessor.request_id !== priorRequest.id
  ) {
    return false;
  }
  const findings = reducerInput.artifacts.filter((artifact) =>
    artifact.kind === "terminal-findings" &&
    artifact.commit_oid === reducerInput.review_epoch.head_oid &&
    Date.parse(artifact.created_at) > Date.parse(priorRequest.created_at) &&
    Date.parse(artifact.created_at) <= Date.parse(nextRequest.created_at));
  if (
    findings.length === 0 ||
    findings.some((artifact) =>
      artifact.stable !== true || artifact.request_id !== priorRequest.id) ||
    reducerInput.artifacts.some((artifact) =>
      artifact.kind === "terminal-findings" &&
      artifact.commit_oid === reducerInput.review_epoch.head_oid &&
      artifact.request_id === priorRequest.id &&
      (Date.parse(artifact.created_at) <= Date.parse(priorRequest.created_at) ||
       Date.parse(artifact.created_at) >= Date.parse(nextRequest.created_at)))
  ) {
    return false;
  }
  for (const artifact of findings) {
    if (
      Date.parse(artifact.created_at) <= Date.parse(priorRequest.created_at) ||
      Date.parse(artifact.created_at) >= Date.parse(nextRequest.created_at) ||
      !automaticRecoveryFindingCarrierIsExact(artifact, evidenceSnapshot) ||
      !automaticRecoveryArtifactTimingIsExact(artifact, reducerInput)
    ) {
      return false;
    }
    for (const findingId of artifact.finding_ids) {
      const closure = automaticRecoveryClosureRecord({
        artifact,
        findingId,
        reducerInput,
        evidenceSnapshot,
      });
      if (
        closure === null ||
        Date.parse(closure.closure_server_time) >=
          Date.parse(nextRequest.created_at)
      ) {
        return false;
      }
    }
  }
  return true;
}

function automaticRecoveryFindingCarrierIsExact(artifact, evidenceSnapshot) {
  if (artifact.channel === "issue-comment") {
    const carrier = evidenceSnapshot.pages.issue_comments.find((item) =>
      item.id === artifact.id);
    if (!(carrier !== undefined &&
      carrier.html_url === artifact.url &&
      carrier.created_at === artifact.created_at &&
      isExactV2CodexProviderIdentity(carrier.author, carrier.app) &&
      hasExactArtifact(
        evidenceSnapshot,
        "issue_comment",
        carrier.id,
        carrier,
      ))) return false;
    const parsed = parseAutomaticRecoveryIssueCarrier(
      carrier,
      evidenceSnapshot,
    );
    return parsed?.kind === "finding" &&
      parsed.headSha === artifact.commit_oid;
  }
  if (artifact.channel === "pull-request-review") {
    const carrier = evidenceSnapshot.pages.reviews.find((item) =>
      item.id === artifact.id);
    if (!(carrier !== undefined &&
      carrier.html_url === artifact.url &&
      carrier.commit_id === artifact.commit_oid &&
      isExactV2CodexProviderIdentity(carrier.author, carrier.app) &&
      hasExactArtifact(
        evidenceSnapshot,
        "pull_request_review",
        carrier.id,
        carrier,
      ))) return false;
    const native = automaticRecoveryCoreCarrier(carrier, "review");
    if (native === null) return false;
    if (codexInlineParentReviewBodyHasClosedGrammar(native)) return true;
    const parsed = parseCodexReviewArtifact(native, {
      owner: evidenceSnapshot.repository.owner,
      repo: evidenceSnapshot.repository.name,
    });
    return parsed?.kind === "finding" &&
      parsed.headSha === artifact.commit_oid;
  }
  return false;
}

function automaticRecoveryTerminalInventoryIsClosed({
  selectedArtifactId,
  reducerInput,
  evidenceSnapshot,
}) {
  const reducerArtifacts = new Map(
    reducerInput.artifacts.map((artifact) => [artifact.id, artifact]),
  );
  const rawTerminal = [];
  for (const carrier of evidenceSnapshot.pages.issue_comments) {
    if (!isExactV2CodexProviderIdentity(carrier.author, carrier.app)) continue;
    const parsed = parseAutomaticRecoveryIssueCarrier(carrier, evidenceSnapshot);
    if (parsed === null || parsed.kind === "pending") continue;
    const commitOid = parsed.kind === "finding"
      ? parsed.headSha
      : parsed.kind === "clean" && parsed.commitRef?.length === 40
        ? parsed.commitRef
        : parsed.kind === "malformed"
          ? reducerInput.review_epoch.head_oid
          : null;
    if (commitOid !== reducerInput.review_epoch.head_oid) continue;
    rawTerminal.push({
      id: carrier.id,
      kind: parsed.kind === "finding"
        ? "terminal-findings"
        : parsed.kind === "clean"
          ? "terminal-clean"
          : "malformed",
      created_at: parsed.createdAt,
      channel: "issue-comment",
      exact: hasExactArtifact(
        evidenceSnapshot,
        "issue_comment",
        carrier.id,
        carrier,
      ),
    });
  }
  for (const carrier of evidenceSnapshot.pages.reviews) {
    if (!isExactV2CodexProviderIdentity(carrier.author, carrier.app)) continue;
    const native = automaticRecoveryCoreCarrier(carrier, "review");
    if (native === null) return false;
    if (
      codexInlineParentReviewBodyHasClosedGrammar(native) &&
      automaticRecoveryReviewIsProjectedInlineCarrier(
        carrier,
        reducerArtifacts,
        reducerInput,
      )
    ) {
      continue;
    }
    const parsed = parseCodexReviewArtifact(native, {
      owner: evidenceSnapshot.repository.owner,
      repo: evidenceSnapshot.repository.name,
    });
    const commitOid = parsed?.kind === "malformed"
      ? carrier.commit_id
      : parsed?.headSha ?? null;
    if (parsed === null || commitOid !== reducerInput.review_epoch.head_oid) {
      continue;
    }
    rawTerminal.push({
      id: carrier.id,
      kind: parsed.kind === "finding"
        ? "terminal-findings"
        : parsed.kind === "clean"
          ? "terminal-clean"
          : "malformed",
      created_at: parsed.createdAt,
      channel: "pull-request-review",
      exact: hasExactArtifact(
        evidenceSnapshot,
        "pull_request_review",
        carrier.id,
        carrier,
      ),
    });
  }
  for (const raw of rawTerminal) {
    const projected = reducerArtifacts.get(raw.id);
    if (
      !raw.exact ||
      projected === undefined ||
      projected.kind !== raw.kind ||
      projected.channel !== raw.channel ||
      projected.created_at !== raw.created_at ||
      projected.commit_oid !== reducerInput.review_epoch.head_oid
    ) {
      return false;
    }
  }
  const selected = selectAutomaticRecoveryTerminalArtifact(
    reducerInput.artifacts.filter((artifact) =>
      artifact.commit_oid === reducerInput.review_epoch.head_oid &&
      ["terminal-clean", "terminal-findings", "malformed"]
        .includes(artifact.kind)),
  );
  return selected !== null &&
    selected.stable === true &&
    selected.kind === "terminal-findings" &&
    selected.id === selectedArtifactId;
}

function automaticRecoveryReviewIsProjectedInlineCarrier(
  carrier,
  reducerArtifacts,
  reducerInput,
) {
  const artifact = reducerArtifacts.get(carrier.id);
  return artifact !== undefined &&
    artifact.kind === "terminal-findings" &&
    artifact.channel === "pull-request-review" &&
    artifact.commit_oid === carrier.commit_id &&
    artifact.finding_ids.length > 0 &&
    artifact.finding_ids.every((findingId) => {
      const thread = reducerInput.threads.find((item) =>
        item.finding_id === findingId);
      return thread !== undefined &&
        thread.kind === "inline" &&
        findingId === `thread:${thread.id}`;
    });
}

function selectAutomaticRecoveryTerminalArtifact(artifacts) {
  if (artifacts.length === 0) return null;
  const latestTime = artifacts.reduce((latest, artifact) =>
    Date.parse(artifact.created_at) > Date.parse(latest)
      ? artifact.created_at
      : latest,
  artifacts[0].created_at);
  const latest = artifacts.filter((artifact) =>
    artifact.created_at === latestTime);
  if (new Set(latest.map((artifact) => artifact.channel)).size > 1) {
    return null;
  }
  const precedence = new Map([
    ["terminal-clean", 0],
    ["terminal-findings", 1],
    ["malformed", 2],
  ]);
  const selectedPrecedence = Math.max(
    ...latest.map((artifact) => precedence.get(artifact.kind)),
  );
  return latest
    .filter((artifact) => precedence.get(artifact.kind) === selectedPrecedence)
    .sort((left, right) => compareDecimal(left.id, right.id))
    .at(-1) ?? null;
}

function automaticRecoveryArtifactTimingIsExact(artifact, reducerInput) {
  const threads = artifact.finding_ids.map((findingId) =>
    reducerInput.threads.find((thread) => thread.finding_id === findingId));
  if (threads.some((thread) => thread === undefined)) return false;
  const earliest = threads.reduce((value, thread) =>
    Date.parse(thread.created_at) < Date.parse(value)
      ? thread.created_at
      : value,
  threads[0].created_at);
  return earliest === artifact.created_at;
}

function parseAutomaticRecoveryIssueCarrier(carrier, evidenceSnapshot) {
  const native = automaticRecoveryCoreCarrier(carrier, "issue-comment");
  return native === null
    ? null
    : parseCodexIssueCommentArtifact(native, {
        owner: evidenceSnapshot.repository.owner,
        repo: evidenceSnapshot.repository.name,
      });
}

function automaticRecoveryCoreCarrier(carrier, kind) {
  const id = Number(carrier.id);
  const actorId = Number(carrier.author?.id);
  if (
    !Number.isSafeInteger(id) || id <= 0 ||
    !Number.isSafeInteger(actorId) || actorId <= 0
  ) {
    return null;
  }
  const native = {
    ...carrier,
    id,
    user: {
      id: actorId,
      login: carrier.author.login,
      type: carrier.author.type,
    },
  };
  if (kind === "issue-comment") {
    native.performed_via_github_app = carrier.app === null
      ? null
      : { slug: carrier.app.slug };
  } else {
    native.created_at = carrier.submitted_at;
  }
  return native;
}

function automaticRecoveryClosureRecord({
  artifact,
  findingId,
  reducerInput,
  evidenceSnapshot,
}) {
  const thread = reducerInput.threads.find((item) =>
    item.finding_id === findingId);
  if (thread === undefined || thread.stable !== true) return null;
  if (thread.kind === "inline") {
    if (
      findingId !== `thread:${thread.id}` ||
      thread.is_resolved !== true ||
      thread.resolution_observed_at === null ||
      Date.parse(thread.resolution_observed_at) <= Date.parse(thread.created_at) ||
      Date.parse(thread.resolution_observed_at) >
        Date.parse(evidenceSnapshot.server_time)
    ) {
      return null;
    }
    const rawThread = evidenceSnapshot.pages.threads.find((item) =>
      item.id === thread.id);
    if (rawThread === undefined || rawThread.is_resolved !== true) return null;
    const commentsById = new Map(
      evidenceSnapshot.pages.inline_comments.map((item) => [item.id, item]),
    );
    const joinedComments = rawThread.comments.map((item) =>
      commentsById.get(item.database_id));
    if (joinedComments.some((item) => item === undefined)) return null;
    const providerComments = joinedComments.filter((item) =>
      isExactV2CodexProviderIdentity(item.author, item.app));
    if (
      providerComments.length === 0 ||
      providerComments.some((item) =>
        item.pull_request_review_id !== artifact.id ||
        item.commit_id !== reducerInput.review_epoch.head_oid ||
        item.original_commit_id !== reducerInput.review_epoch.head_oid ||
        item.in_reply_to_id !== null ||
        !hasExactArtifact(
          evidenceSnapshot,
          "inline_comment",
          item.id,
          item,
        )) ||
      providerComments.reduce((earliest, item) =>
        Date.parse(item.created_at) < Date.parse(earliest)
          ? item.created_at
          : earliest,
      providerComments[0].created_at) !== thread.created_at
    ) {
      return null;
    }
    return {
      finding_id: findingId,
      finding_kind: "inline",
      finding_artifact_id: artifact.id,
      finding_server_time: thread.created_at,
      closure_id: thread.id,
      closure_server_time: thread.resolution_observed_at,
      closure_authority_digest: projectionDigest(
        "codex-review-gate-v2-automatic-recovery-inline-closure",
        {
          thread: rawThread,
          provider_comments: providerComments,
          final_snapshot_server_time: evidenceSnapshot.server_time,
        },
      ),
    };
  }
  if (
    thread.kind !== "top-level" ||
    thread.id !== `top-level:${artifact.id}:0` ||
    thread.created_at !== artifact.created_at ||
    !automaticRecoveryTopLevelFindingIdIsExact(
      artifact,
      findingId,
      evidenceSnapshot,
    )
  ) {
    return null;
  }
  const acknowledgement = reducerInput.acknowledgements
    .filter((item) =>
      item.finding_id === findingId &&
      item.kind === "addressed" &&
      item.stable &&
      !item.exact_provider &&
      item.commit_oid === reducerInput.review_epoch.head_oid &&
      Date.parse(item.created_at) > Date.parse(artifact.created_at))
    .sort((left, right) =>
      Date.parse(left.created_at) - Date.parse(right.created_at) ||
      compareDecimal(left.id, right.id))
    .at(-1);
  if (acknowledgement === undefined) return null;
  const comment = evidenceSnapshot.pages.issue_comments.find((item) =>
    item.id === acknowledgement.id);
  const permission = evidenceSnapshot.permissions.actor_permissions.find(
    (item) =>
      item.subject.kind === "issue_comment" &&
      item.subject.id === acknowledgement.id,
  );
  if (
    comment === undefined ||
    permission === undefined ||
    comment.author?.type !== "User" ||
    isExactV2CodexProviderIdentity(comment.author, comment.app) ||
    comment.body !== `/codex-gate addressed ${artifact.url}` ||
    comment.created_at !== comment.updated_at ||
    comment.created_at !== acknowledgement.created_at ||
    Date.parse(comment.created_at) > Date.parse(evidenceSnapshot.server_time) ||
    !hasExactArtifact(
      evidenceSnapshot,
      "issue_comment",
      comment.id,
      comment,
    ) ||
    !permission.stable ||
    !isDeepStrictEqual(permission.actor, comment.author) ||
    !permission.pre.permissions.push ||
    !permission.post.permissions.push
  ) {
    return null;
  }
  permissionLevel(permission.post);
  return {
    finding_id: findingId,
    finding_kind: "top-level",
    finding_artifact_id: artifact.id,
    finding_server_time: artifact.created_at,
    closure_id: acknowledgement.id,
    closure_server_time: acknowledgement.created_at,
    closure_authority_digest: projectionDigest(
      "codex-review-gate-v2-automatic-recovery-top-level-closure",
      {
        comment,
        permission,
        final_snapshot_server_time: evidenceSnapshot.server_time,
      },
    ),
  };
}

function automaticRecoveryTopLevelFindingIdIsExact(
  artifact,
  findingId,
  evidenceSnapshot,
) {
  let parsed;
  if (artifact.channel === "issue-comment") {
    const carrier = evidenceSnapshot.pages.issue_comments.find((item) =>
      item.id === artifact.id);
    if (carrier === undefined) return false;
    parsed = parseAutomaticRecoveryIssueCarrier(carrier, evidenceSnapshot);
  } else {
    const carrier = evidenceSnapshot.pages.reviews.find((item) =>
      item.id === artifact.id);
    if (carrier === undefined) return false;
    const native = automaticRecoveryCoreCarrier(carrier, "review");
    if (native === null) return false;
    parsed = parseCodexReviewArtifact(native, {
      owner: evidenceSnapshot.repository.owner,
      repo: evidenceSnapshot.repository.name,
    });
  }
  if (parsed?.kind !== "finding") return false;
  const expected = `finding:${artifact.id}:0:${createHash("sha256")
    .update(parsed.samples.join("\n"), "utf8")
    .digest("hex")
    .slice(0, 24)}`;
  return findingId === expected;
}

function compareRecoveryEvidence(left, right) {
  return Date.parse(left.created_at) - Date.parse(right.created_at) ||
    compareDecimal(left.id, right.id);
}

function inlineFindingUrl(snapshot, thread) {
  const rawThread = snapshot.pages.threads.find((item) => item.id === thread.id);
  if (rawThread === undefined) {
    throw projectionFailure(
      "INLINE_FINDING_URL_UNBOUND",
      `inline thread ${thread.id} is absent from the final transport snapshot`,
    );
  }
  const commentsById = new Map(snapshot.pages.inline_comments.map((item) => [item.id, item]));
  const comments = rawThread.comments
    .map((item) => commentsById.get(item.database_id))
    .filter((item) => item !== undefined &&
      isExactV2CodexProviderIdentity(item.author, item.app))
    .sort((left, right) =>
      Date.parse(left.created_at) - Date.parse(right.created_at) ||
      compareDecimal(left.id, right.id));
  if (comments.length === 0) {
    throw projectionFailure(
      "INLINE_FINDING_URL_UNBOUND",
      `inline thread ${thread.id} has no exact-provider comment URL`,
    );
  }
  return comments[0].html_url;
}

function permissionLevel(receipt) {
  if (receipt.permissions.admin || receipt.effective_permission === "admin") return "admin";
  if (receipt.permissions.push || receipt.effective_permission === "write") return "write";
  throw projectionFailure(
    "RECOVERY_ADDRESS_PERMISSION_INSUFFICIENT",
    "top-level address actor has no proved write permission",
  );
}

function publicSelectedObject(value) {
  return { id: value.id, url: value.url, created_at: value.created_at };
}

function assertSelectedEvidenceTransportBinding({
  publicKind,
  selected,
  requestPolicy,
  evidenceSnapshot,
}) {
  if (requestPolicy.request_id !== null) {
    const request = evidenceSnapshot.pages.issue_comments.find(
      (item) => item.id === requestPolicy.request_id,
    );
    if (
      request === undefined || request.html_url !== requestPolicy.request_url ||
      request.body !== "@codex review" || request.created_at !== request.updated_at ||
      !hasExactArtifact(evidenceSnapshot, "issue_comment", request.id, request)
    ) {
      throw projectionFailure(
        "PUBLIC_REQUEST_TRANSPORT_MISMATCH",
        "public request identity is not exact-refetched from the final transport snapshot",
      );
    }
  }
  if (publicKind === "current-request-reaction") {
    const groups = evidenceSnapshot.pages.reactions.issue_comments.filter(
      (group) => group.subject_id === requestPolicy.request_id,
    );
    const matches = groups.flatMap((group) => group.reactions).filter(
      (reaction) =>
        selected.some((item) =>
          item.id === reaction.id && item.created_at === reaction.created_at) &&
        reaction.content === "+1" &&
        isExactV2CodexProviderIdentity(reaction.author),
    );
    if (matches.length !== selected.length) {
      throw projectionFailure(
        "PUBLIC_REACTION_TRANSPORT_MISMATCH",
        "public reaction evidence is absent or identity-mismatched in the final transport snapshot",
      );
    }
    return;
  }
  for (const item of selected) {
    const candidate = transportArtifactByPublicIdentity(evidenceSnapshot, item);
    if (candidate === null) {
      throw projectionFailure(
        "PUBLIC_ARTIFACT_TRANSPORT_MISMATCH",
        `public selected artifact ${item.id} is absent from the final transport snapshot`,
      );
    }
    const providerRequired = [
      "terminal-payload",
      "stable-exact-no-start",
      "malformed-terminal",
      "unknown-terminal",
    ].includes(publicKind);
    if (providerRequired &&
        !isExactV2CodexProviderIdentity(candidate.artifact.author, candidate.artifact.app)) {
      throw projectionFailure(
        "PUBLIC_ARTIFACT_IDENTITY_MISMATCH",
        `public selected artifact ${item.id} lacks the exact v2 provider identity`,
      );
    }
    if (!hasExactArtifact(
      evidenceSnapshot,
      candidate.kind,
      item.id,
      candidate.artifact,
    )) {
      throw projectionFailure(
        "PUBLIC_ARTIFACT_NOT_EXACT",
        `public selected artifact ${item.id} was not exact-refetched`,
      );
    }
  }
}

function transportArtifactByPublicIdentity(snapshot, selected) {
  const issue = snapshot.pages.issue_comments.find((item) => item.id === selected.id);
  if (
    issue !== undefined && issue.html_url === selected.url &&
    issue.created_at === selected.created_at
  ) return { kind: "issue_comment", artifact: issue };
  const review = snapshot.pages.reviews.find((item) => item.id === selected.id);
  if (
    review !== undefined && review.html_url === selected.url &&
    review.submitted_at === selected.created_at
  ) return { kind: "pull_request_review", artifact: review };
  return null;
}

function hasExactArtifact(snapshot, kind, id, artifact) {
  return snapshot.pages.exact_artifacts.some((receipt) =>
    receipt.selector.kind === kind && receipt.selector.id === id &&
    isDeepStrictEqual(receipt.artifact, artifact));
}

function sealPublicReport(core, {
  compactFingerprint,
  selectionAuthority,
  headSentinelReceipt,
}) {
  const snapshotFingerprint = `sha256:${createHash("sha256")
    .update("codex-review-gate-v2-canonical-public-report\0", "utf8")
    .update(canonicalJson({
      compact_snapshot_fingerprint: compactFingerprint,
      selection_authority_receipt_digest:
        selectionAuthority.authority_receipt_digest,
      head_sentinel_receipt: headSentinelReceipt,
      report: core,
    }), "utf8")
    .digest("hex")}`;
  return { ...core, snapshot_fingerprint: snapshotFingerprint };
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

function projectionDigest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0`, "utf8")
    .update(canonicalJson(value), "utf8")
    .digest("hex")}`;
}

function automaticRecoveryEpochId(scope) {
  const domain = "codex-review-gate-v2-head-epoch";
  const domainBytes = Buffer.from(domain, "utf8");
  const valueBytes = Buffer.from(canonicalJson(scope), "utf8");
  const hash = createHash("sha256");
  hash.update(`${domainBytes.length}:`);
  hash.update(domainBytes);
  hash.update("\0");
  hash.update(`${valueBytes.length}:`);
  hash.update(valueBytes);
  return `v2-head:${hash.digest("hex")}`;
}

function snapshotLifecycle(value) {
  if (value.merged) return "merged";
  return value.state === "OPEN" ? "open" : "closed";
}

function compareDecimal(left, right) {
  const a = BigInt(left);
  const b = BigInt(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function sha(value, path) {
  if (typeof value !== "string" || !SHA.test(value)) {
    throw new TypeError(`${path} must be a full lowercase SHA`);
  }
  return value;
}

function decimal(value, path) {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new TypeError(`${path} must be a canonical decimal string`);
  }
  return value;
}

function digest(value, path) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${path} must be a prefixed SHA-256 digest`);
  }
  return value;
}

function timestamp(value, path) {
  if (typeof value !== "string" || !STRICT_UTC.test(value) ||
      !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${path} must be a strict UTC timestamp`);
  }
  return value;
}

function boundedString(value, path, maximum) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new TypeError(`${path} must be a bounded non-empty string`);
  }
  return value;
}

function boolean(value, path) {
  if (typeof value !== "boolean") throw new TypeError(`${path} must be boolean`);
}

function oneOf(value, choices, path) {
  if (!choices.has(value)) throw new TypeError(`${path} is outside the closed enum`);
  return value;
}

function exact(actual, expected, path) {
  if (!Object.is(actual, expected)) {
    throw new TypeError(`${path} must equal ${JSON.stringify(expected)}`);
  }
}

function record(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
}

function exactKeys(value, keys, path) {
  record(value, path);
  const actual = Object.keys(value);
  if (!isDeepStrictEqual(actual.slice().sort(), keys.slice().sort())) {
    throw new TypeError(`${path} must have exactly the closed key set`);
  }
}

function projectionFailure(code, message, cause = undefined) {
  const error = new V2PublicReportProjectionError(code, message);
  if (cause !== undefined) error.cause = cause;
  return error;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
