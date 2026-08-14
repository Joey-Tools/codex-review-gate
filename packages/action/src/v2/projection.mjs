import { Buffer } from "node:buffer";
import { createHash, timingSafeEqual } from "node:crypto";
import { TextDecoder } from "node:util";

import { assertV2ReducerOutput } from "./schema.mjs";

export const STICKY_AUDIT_SCHEMA = "codex-review-gate-sticky-v2";
export const STICKY_AUDIT_SCHEMA_VERSION = 1;
export const STICKY_RAW_BINDING_SCHEMA =
  "codex-review-gate-sticky-raw-binding-v2";
export const STICKY_RAW_BINDING_SCHEMA_VERSION = 1;
export const V2_STATUS_CONTEXT = "codex/github-review-gate";

// GitHub issue comments currently allow more than this, but parsing keeps the
// existing 60 KiB state-comment boundary and generation leaves four KiB of
// headroom for API-side changes.
export const MAX_STICKY_COMMENT_BYTES = 60 * 1024;
export const MAX_GENERATED_STICKY_COMMENT_BYTES = 56 * 1024;
export const MAX_STICKY_METADATA_BYTES = 36 * 1024;
export const MAX_STICKY_EDIT_LOG_ENTRIES = 32;
export const MAX_REDUCER_REPORT_BYTES = 256 * 1024;

const STICKY_MARKER = STICKY_AUDIT_SCHEMA;
const HISTORY_MODEL = "append-only-within-sticky-edits";
const INTEGRITY_LIMIT = "not-immutable-or-deletion-resistant";
const REPORT_DIGEST_DOMAIN = "codex-review-gate-reducer-report-v2";
const EDIT_HASH_DOMAIN = "codex-review-gate-sticky-edit-v2";
const RAW_BINDING_HASH_DOMAIN = "codex-review-gate-sticky-raw-binding-v2";
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const POSITIVE_DECIMAL_PATTERN = /^[1-9][0-9]*$/u;
const TOKEN_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/u;
const DECISIONS = new Set([
  "not-selected",
  "pending",
  "clean",
  "findings",
  "inconclusive",
  "skipped-unavailable",
  "blocked-configuration",
  "blocked-input",
]);
const PROVIDER_PROFILES = new Set([
  "terminal-payload",
  "thumbs-up-clean",
  "mixed",
  "no-start-rejection",
  "unknown",
]);
const REQUEST_POLICY_STATUSES = new Set([
  "compliant",
  "warning",
  "unknown",
  "not-applicable",
]);
const SERVER_ENFORCEMENT_STATUSES = new Set([
  "enforced",
  "not-enforced",
  "unknown",
  "not-applicable",
]);
const SELECTION_STATUSES = new Set(["selected", "not-selected", "blocked"]);
const SELECTION_INTENTS = new Set(["implicit", "explicit", "disabled"]);
const STATUS_TARGET_MODES = new Set([
  "head",
  "test-merge-with-head-sentinel",
]);
const EVIDENCE_BASIS_KINDS = new Set([
  "terminal-clean",
  "terminal-findings",
  "thumbs-up-clean",
  "no-start-rejection",
  "unresolved-inline-finding",
  "malformed-evidence",
  "incomplete-snapshot",
  "unstable-scope",
  "configuration",
  "input",
]);
const PULL_REQUEST_LIFECYCLES = new Set(["open", "closed", "merged"]);
const EVIDENCE_BASIS_KEYS = [
  "kind",
  "scope_assurance",
  "artifact_id",
  "summary",
  "authority_receipt",
];
const STRICT_UTC_TIMESTAMP =
  /^(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d{1,3}))?Z$/u;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

const REPORT_KEYS = [
  "schema_version",
  "selection",
  "server_enforcement",
  "review_epoch",
  "request_policy",
  "provider_profile",
  "provider_input_lineage",
  "evidence_basis",
  "status_target",
  "decision",
  "freshness_assurance",
  "snapshot_fingerprint",
];
const SELECTION_KEYS = ["status", "intent", "reason"];
const SERVER_ENFORCEMENT_KEYS = [
  "status",
  "controller_available",
  "workflow_present",
  "workflow_compatible",
  "ruleset_required",
  "ruleset_compatible",
  "app_bound",
];
const REVIEW_EPOCH_KEYS = [
  "repository_id",
  "pull_request_number",
  "base_oid",
  "head_oid",
  "merge_base_oid",
  "merge_oid",
  "merge_tree_oid",
  "merge_parents",
  "merge_ref_oid",
  "mergeable",
  "lifecycle",
];
const REQUEST_POLICY_KEYS = [
  "status",
  "selected_request_id",
  "reason",
  "permission_assurance",
  "request_time_permission",
  "permission_aba_excluded",
  "generation_id",
  "generation_kind",
  "generation_index",
];
const STATUS_TARGET_KEYS = ["mode", "sha", "context"];
const SCOPE_KEYS = ["repository_node_id", "pull_request_node_id"];
const HISTORY_SEMANTICS_KEYS = ["model", "integrity_limit"];
const EDIT_KEYS = [
  "timestamp",
  "actor_login",
  "run_id",
  "run_attempt",
];
const SNAPSHOT_KEYS = [
  "report_schema_version",
  "decision",
  "selection_status",
  "selection_intent",
  "selection_reason",
  "server_enforcement_status",
  "controller_available",
  "workflow_present",
  "workflow_compatible",
  "ruleset_required",
  "ruleset_compatible",
  "app_bound",
  "repository_id",
  "pull_request_number",
  "base_sha",
  "head_sha",
  "merge_base_sha",
  "test_merge_sha",
  "test_merge_tree_sha",
  "merge_parent_shas",
  "merge_ref_sha",
  "mergeable",
  "pull_request_lifecycle",
  "request_policy_status",
  "selected_request_id",
  "request_policy_reason",
  "permission_assurance",
  "request_time_permission",
  "permission_aba_excluded",
  "generation_id",
  "generation_kind",
  "generation_index",
  "provider_profile",
  "provider_input_lineage",
  "evidence_basis_kind",
  "evidence_scope_assurance",
  "status_target_sha",
  "status_context",
  "status_target_mode",
  "freshness_assurance",
  "snapshot_fingerprint",
  "report_sha256",
];
const ENTRY_KEYS = [
  "sequence",
  "edit",
  "snapshot",
  "previous_entry_hash",
  "entry_hash",
];
const METADATA_KEYS = [
  "schema",
  "schema_version",
  "scope",
  "history_semantics",
  "current_sequence",
  "edit_log",
];
const RAW_BINDING_KEYS = [
  "schema",
  "schema_version",
  "repository_node_id",
  "repository_id",
  "pull_request_node_id",
  "pull_request_number",
  "base_sha",
  "head_sha",
  "merge_base_sha",
  "test_merge_sha",
  "test_merge_tree_sha",
  "merge_parent_shas",
  "pull_request_lifecycle",
  "provider_input_lineage",
  "comment_id",
  "comment_node_id",
  "raw_body_bytes",
  "raw_body_sha256",
  "binding_sha256",
];

/**
 * Build the human-readable sticky comment and its hidden audit projection.
 *
 * reducer_report is always the sole source of the current state. A prior
 * projection contributes only already-validated audit entries and therefore
 * cannot alter the reducer result.
 */
export function buildStickyAuditProjection({
  reducer_report,
  scope,
  edit,
  prior_projection = null,
}) {
  const normalizedScope = normalizeScope(scope);
  const normalizedEdit = normalizeEdit(edit);
  const snapshot = snapshotFromReducerReport(reducer_report);

  let priorEntries = [];
  if (prior_projection !== null) {
    const prior = validateStickyMetadata(prior_projection);
    if (!sameScope(prior.scope, normalizedScope)) {
      throw new Error("prior sticky projection belongs to a different repository or pull request");
    }
    priorEntries = structuredClone(prior.edit_log);
  }

  if (priorEntries.length >= MAX_STICKY_EDIT_LOG_ENTRIES) {
    throw new Error(
      `sticky audit edit log already contains the maximum ${MAX_STICKY_EDIT_LOG_ENTRIES} entries`,
    );
  }

  const sequence = priorEntries.length + 1;
  const entryWithoutHash = {
    sequence,
    edit: normalizedEdit,
    snapshot,
    previous_entry_hash: priorEntries.at(-1)?.entry_hash || null,
  };
  const entry = {
    ...entryWithoutHash,
    entry_hash: computeEditHash(normalizedScope, entryWithoutHash),
  };
  const metadata = {
    schema: STICKY_AUDIT_SCHEMA,
    schema_version: STICKY_AUDIT_SCHEMA_VERSION,
    scope: normalizedScope,
    history_semantics: {
      model: HISTORY_MODEL,
      integrity_limit: INTEGRITY_LIMIT,
    },
    current_sequence: sequence,
    edit_log: [...priorEntries, entry],
  };

  validateStickyMetadata(metadata);
  const body = renderStickyBody(metadata);
  const bodyBytes = Buffer.byteLength(body, "utf8");
  if (bodyBytes > MAX_GENERATED_STICKY_COMMENT_BYTES) {
    throw new Error(
      `generated sticky audit comment is ${bodyBytes} bytes; ` +
        `the maximum is ${MAX_GENERATED_STICKY_COMMENT_BYTES}`,
    );
  }

  return {
    body,
    body_sha256: digestExactRawStickyBody(body),
    metadata,
  };
}

/**
 * Parse only canonical comments produced by buildStickyAuditProjection.
 * Invalid, oversized, non-canonical, visibly tampered, or chain-broken bodies
 * return null. Callers may rebuild audit output from the reducer report, but
 * must never feed this result into the reducer.
 */
export function parseStickyAuditProjection(body) {
  if (typeof body !== "string" || Buffer.byteLength(body, "utf8") > MAX_STICKY_COMMENT_BYTES) {
    return null;
  }

  try {
    const markerPrefix = `<!-- ${STICKY_MARKER}\n`;
    if (countOccurrences(body, markerPrefix) !== 1) {
      return null;
    }
    const match = body.match(
      new RegExp(
        `\\n\\n<!-- ${escapeRegExp(STICKY_MARKER)}\\n` +
          "([A-Za-z0-9+/]+={0,2})\\n-->\\n$",
        "u",
      ),
    );
    if (!match) {
      return null;
    }

    const encoded = match[1];
    if (encoded.length % 4 !== 0) {
      return null;
    }
    const metadataBytes = Buffer.from(encoded, "base64");
    if (
      metadataBytes.length > MAX_STICKY_METADATA_BYTES ||
      metadataBytes.toString("base64") !== encoded
    ) {
      return null;
    }
    const metadataJson = UTF8_DECODER.decode(metadataBytes);
    const metadata = JSON.parse(metadataJson);
    validateStickyMetadata(metadata);
    if (canonicalJson(metadata) !== metadataJson) {
      return null;
    }
    if (renderStickyBody(metadata) !== body) {
      return null;
    }
    return metadata;
  } catch {
    return null;
  }
}

/** Hash the exact bytes supplied by the caller without newline normalization. */
export function digestExactRawStickyBody(raw_body) {
  const bytes = rawBytes(raw_body);
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * Bind an exact raw comment body to its GitHub object identity after the
 * comment ID is known. This receipt is intentionally outside the body: a body
 * cannot contain its own exact digest without a self-reference problem.
 */
export function bindStickyCommentRawDigest({
  raw_body,
  repository_node_id,
  repository_id,
  pull_request_node_id,
  pull_request_number,
  base_sha,
  head_sha,
  merge_base_sha,
  test_merge_sha,
  test_merge_tree_sha,
  merge_parent_shas,
  pull_request_lifecycle,
  provider_input_lineage,
  comment_id,
  comment_node_id,
}) {
  const bytes = rawBytes(raw_body);
  if (bytes.length > MAX_STICKY_COMMENT_BYTES) {
    throw new Error(
      `raw sticky comment is ${bytes.length} bytes; the maximum is ${MAX_STICKY_COMMENT_BYTES}`,
    );
  }
  const text = exactUtf8Text(bytes);
  const normalized = {
    repository_node_id: boundedString(repository_node_id, "repository_node_id", 256),
    repository_id: boundedString(repository_id, "repository_id", 256),
    pull_request_node_id: boundedString(pull_request_node_id, "pull_request_node_id", 256),
    pull_request_number: positiveSafeInteger(pull_request_number, "pull_request_number"),
    base_sha: fullSha(base_sha, "base_sha"),
    head_sha: fullSha(head_sha, "head_sha"),
    merge_base_sha: fullSha(merge_base_sha, "merge_base_sha"),
    test_merge_sha: fullSha(test_merge_sha, "test_merge_sha"),
    test_merge_tree_sha: fullSha(test_merge_tree_sha, "test_merge_tree_sha"),
    merge_parent_shas: mergeParentTuple(merge_parent_shas, "merge_parent_shas"),
    pull_request_lifecycle: enumValue(
      pull_request_lifecycle,
      PULL_REQUEST_LIFECYCLES,
      "pull_request_lifecycle",
    ),
    provider_input_lineage: exactString(
      provider_input_lineage,
      "unavailable",
      "provider_input_lineage",
    ),
    comment_id: positiveDecimal(comment_id, "comment_id"),
    comment_node_id: boundedString(comment_node_id, "comment_node_id", 256),
  };
  const metadata = parseStickyAuditProjection(text);
  if (metadata === null) {
    throw new Error("raw sticky body is not a canonical sticky audit projection");
  }
  const current = metadata.edit_log.at(-1).snapshot;
  const projectedIdentity = {
    repository_node_id: metadata.scope.repository_node_id,
    repository_id: current.repository_id,
    pull_request_node_id: metadata.scope.pull_request_node_id,
    pull_request_number: current.pull_request_number,
    base_sha: current.base_sha,
    head_sha: current.head_sha,
    merge_base_sha: current.merge_base_sha,
    test_merge_sha: current.test_merge_sha,
    test_merge_tree_sha: current.test_merge_tree_sha,
    merge_parent_shas: current.merge_parent_shas,
    pull_request_lifecycle: current.pull_request_lifecycle,
    provider_input_lineage: current.provider_input_lineage,
  };
  const suppliedIdentity = {
    repository_node_id: normalized.repository_node_id,
    repository_id: normalized.repository_id,
    pull_request_node_id: normalized.pull_request_node_id,
    pull_request_number: normalized.pull_request_number,
    base_sha: normalized.base_sha,
    head_sha: normalized.head_sha,
    merge_base_sha: normalized.merge_base_sha,
    test_merge_sha: normalized.test_merge_sha,
    test_merge_tree_sha: normalized.test_merge_tree_sha,
    merge_parent_shas: normalized.merge_parent_shas,
    pull_request_lifecycle: normalized.pull_request_lifecycle,
    provider_input_lineage: normalized.provider_input_lineage,
  };
  if (!constantTimeEqual(canonicalJson(projectedIdentity), canonicalJson(suppliedIdentity))) {
    throw new Error("raw sticky body identity does not match the supplied binding scope and review epoch");
  }
  const rawBodySha256 = digestExactRawStickyBody(bytes);
  const bindingSha256 = hashLengthPrefixed(RAW_BINDING_HASH_DOMAIN, [
    normalized.repository_node_id,
    normalized.repository_id,
    normalized.pull_request_node_id,
    normalized.pull_request_number,
    normalized.base_sha,
    normalized.head_sha,
    normalized.merge_base_sha,
    normalized.test_merge_sha,
    normalized.test_merge_tree_sha,
    canonicalJson(normalized.merge_parent_shas),
    normalized.pull_request_lifecycle,
    normalized.provider_input_lineage,
    normalized.comment_id,
    normalized.comment_node_id,
    bytes,
  ]);

  return {
    schema: STICKY_RAW_BINDING_SCHEMA,
    schema_version: STICKY_RAW_BINDING_SCHEMA_VERSION,
    ...normalized,
    raw_body_bytes: bytes.length,
    raw_body_sha256: rawBodySha256,
    binding_sha256: bindingSha256,
  };
}

export function verifyStickyCommentRawDigest(binding, raw_body) {
  try {
    validateRawBinding(binding);
    const expected = bindStickyCommentRawDigest({
      raw_body,
      repository_node_id: binding.repository_node_id,
      repository_id: binding.repository_id,
      pull_request_node_id: binding.pull_request_node_id,
      pull_request_number: binding.pull_request_number,
      base_sha: binding.base_sha,
      head_sha: binding.head_sha,
      merge_base_sha: binding.merge_base_sha,
      test_merge_sha: binding.test_merge_sha,
      test_merge_tree_sha: binding.test_merge_tree_sha,
      merge_parent_shas: binding.merge_parent_shas,
      pull_request_lifecycle: binding.pull_request_lifecycle,
      provider_input_lineage: binding.provider_input_lineage,
      comment_id: binding.comment_id,
      comment_node_id: binding.comment_node_id,
    });
    return constantTimeEqual(canonicalJson(binding), canonicalJson(expected));
  } catch {
    return false;
  }
}

/**
 * Validate the complete closed reducer report and return the bounded audit
 * snapshot it projects. The reducer report is never reconstructed from sticky
 * state; this helper exists so the runner and projector share one contract.
 */
export function validateV2ReducerReport(report) {
  return structuredClone(snapshotFromReducerReport(report));
}

function snapshotFromReducerReport(report) {
  assertV2ReducerOutput(report);
  assertExactKeys(report, REPORT_KEYS, "reducer_report");
  if (report.schema_version !== 2) {
    throw new Error("reducer_report.schema_version must be exactly 2");
  }
  assertExactKeys(report.selection, SELECTION_KEYS, "reducer_report.selection");
  assertExactKeys(
    report.server_enforcement,
    SERVER_ENFORCEMENT_KEYS,
    "reducer_report.server_enforcement",
  );
  assertExactKeys(report.review_epoch, REVIEW_EPOCH_KEYS, "reducer_report.review_epoch");
  assertExactKeys(
    report.request_policy,
    REQUEST_POLICY_KEYS,
    "reducer_report.request_policy",
  );
  assertExactKeys(report.status_target, STATUS_TARGET_KEYS, "reducer_report.status_target");

  const evidenceBasis = normalizeEvidenceBasis(report.evidence_basis);
  const snapshot = {
    report_schema_version: 2,
    decision: enumValue(report.decision, DECISIONS, "reducer_report.decision"),
    selection_status: enumValue(
      report.selection.status,
      SELECTION_STATUSES,
      "reducer_report.selection.status",
    ),
    selection_intent: enumValue(
      report.selection.intent,
      SELECTION_INTENTS,
      "reducer_report.selection.intent",
    ),
    selection_reason: boundedString(report.selection.reason, "reducer_report.selection.reason", 256),
    server_enforcement_status: enumValue(
      report.server_enforcement.status,
      SERVER_ENFORCEMENT_STATUSES,
      "reducer_report.server_enforcement.status",
    ),
    controller_available: strictBoolean(
      report.server_enforcement.controller_available,
      "reducer_report.server_enforcement.controller_available",
    ),
    workflow_present: strictBoolean(
      report.server_enforcement.workflow_present,
      "reducer_report.server_enforcement.workflow_present",
    ),
    workflow_compatible: strictBoolean(
      report.server_enforcement.workflow_compatible,
      "reducer_report.server_enforcement.workflow_compatible",
    ),
    ruleset_required: strictBoolean(
      report.server_enforcement.ruleset_required,
      "reducer_report.server_enforcement.ruleset_required",
    ),
    ruleset_compatible: strictBoolean(
      report.server_enforcement.ruleset_compatible,
      "reducer_report.server_enforcement.ruleset_compatible",
    ),
    app_bound: strictBoolean(
      report.server_enforcement.app_bound,
      "reducer_report.server_enforcement.app_bound",
    ),
    repository_id: boundedString(
      report.review_epoch.repository_id,
      "reducer_report.review_epoch.repository_id",
      256,
    ),
    pull_request_number: positiveSafeInteger(
      report.review_epoch.pull_request_number,
      "reducer_report.review_epoch.pull_request_number",
    ),
    base_sha: nullableFullSha(report.review_epoch.base_oid, "reducer_report.review_epoch.base_oid"),
    head_sha: fullSha(report.review_epoch.head_oid, "reducer_report.review_epoch.head_oid"),
    merge_base_sha: nullableFullSha(
      report.review_epoch.merge_base_oid,
      "reducer_report.review_epoch.merge_base_oid",
    ),
    test_merge_sha: nullableFullSha(
      report.review_epoch.merge_oid,
      "reducer_report.review_epoch.merge_oid",
    ),
    test_merge_tree_sha: nullableFullSha(
      report.review_epoch.merge_tree_oid,
      "reducer_report.review_epoch.merge_tree_oid",
    ),
    merge_parent_shas: potentialMergeParents(
      report.review_epoch.merge_parents,
      "reducer_report.review_epoch.merge_parents",
    ),
    merge_ref_sha: nullableFullSha(
      report.review_epoch.merge_ref_oid,
      "reducer_report.review_epoch.merge_ref_oid",
    ),
    mergeable: enumValue(
      report.review_epoch.mergeable,
      new Set(["MERGEABLE", "CONFLICTING", "UNKNOWN"]),
      "reducer_report.review_epoch.mergeable",
    ),
    pull_request_lifecycle: enumValue(
      report.review_epoch.lifecycle,
      PULL_REQUEST_LIFECYCLES,
      "reducer_report.review_epoch.lifecycle",
    ),
    request_policy_status: enumValue(
      report.request_policy.status,
      REQUEST_POLICY_STATUSES,
      "reducer_report.request_policy.status",
    ),
    selected_request_id: nullableDecimal(
      report.request_policy.selected_request_id,
      "reducer_report.request_policy.selected_request_id",
    ),
    request_policy_reason: boundedString(
      report.request_policy.reason,
      "reducer_report.request_policy.reason",
      256,
    ),
    permission_assurance: nullableExactString(
      report.request_policy.permission_assurance,
      "point-in-time-only",
      "reducer_report.request_policy.permission_assurance",
    ),
    request_time_permission: nullableExactString(
      report.request_policy.request_time_permission,
      "unproven",
      "reducer_report.request_policy.request_time_permission",
    ),
    permission_aba_excluded: nullableBoolean(
      report.request_policy.permission_aba_excluded,
      "reducer_report.request_policy.permission_aba_excluded",
    ),
    generation_id: report.request_policy.generation_id,
    generation_kind: report.request_policy.generation_kind,
    generation_index: report.request_policy.generation_index,
    provider_profile: nullableEnumValue(
      report.provider_profile,
      PROVIDER_PROFILES,
      "reducer_report.provider_profile",
    ),
    provider_input_lineage: exactString(
      report.provider_input_lineage,
      "unavailable",
      "reducer_report.provider_input_lineage",
    ),
    evidence_basis_kind: evidenceBasis?.kind ?? null,
    evidence_scope_assurance: evidenceBasis === null
      ? null
      : evidenceBasis.scope_assurance,
    status_target_sha: nullableFullSha(
      report.status_target.sha,
      "reducer_report.status_target.sha",
    ),
    status_context: exactString(
      report.status_target.context,
      V2_STATUS_CONTEXT,
      "reducer_report.status_target.context",
    ),
    status_target_mode: enumValue(
      report.status_target.mode,
      STATUS_TARGET_MODES,
      "reducer_report.status_target.mode",
    ),
    freshness_assurance: exactString(
      report.freshness_assurance,
      "point-in-time",
      "reducer_report.freshness_assurance",
    ),
    snapshot_fingerprint: digestString(
      report.snapshot_fingerprint,
      "reducer_report.snapshot_fingerprint",
    ),
    report_sha256: `sha256:${"0".repeat(64)}`,
  };
  // Validate and cap every individual field before canonicalizing the complete
  // report so the aggregate byte cap is not preceded by unbounded string work.
  validateSnapshot(snapshot);
  const reportJson = canonicalJson(report);
  const reportBytes = Buffer.byteLength(reportJson, "utf8");
  if (reportBytes > MAX_REDUCER_REPORT_BYTES) {
    throw new Error(
      `reducer report is ${reportBytes} bytes; the maximum is ${MAX_REDUCER_REPORT_BYTES}`,
    );
  }
  snapshot.report_sha256 = hashLengthPrefixed(REPORT_DIGEST_DOMAIN, [reportJson]);
  validateSnapshot(snapshot);
  return snapshot;
}

function normalizeScope(scope) {
  assertExactKeys(scope, SCOPE_KEYS, "scope");
  return {
    repository_node_id: boundedString(scope.repository_node_id, "scope.repository_node_id", 256),
    pull_request_node_id: boundedString(
      scope.pull_request_node_id,
      "scope.pull_request_node_id",
      256,
    ),
  };
}

function normalizeEdit(edit) {
  assertExactKeys(edit, EDIT_KEYS, "edit");
  return {
    timestamp: canonicalTimestamp(edit.timestamp, "edit.timestamp"),
    actor_login: boundedString(edit.actor_login, "edit.actor_login", 100),
    run_id: positiveDecimal(edit.run_id, "edit.run_id"),
    run_attempt: positiveSafeInteger(edit.run_attempt, "edit.run_attempt"),
  };
}

function normalizeEvidenceBasis(value) {
  if (value === null) {
    return null;
  }
  assertExactKeys(value, EVIDENCE_BASIS_KEYS, "reducer_report.evidence_basis");
  const kind = enumValue(
    value.kind,
    EVIDENCE_BASIS_KINDS,
    "reducer_report.evidence_basis.kind",
  );
  const scopeAssurance = exactString(
    value.scope_assurance,
    "whole-pr-contractual",
    "reducer_report.evidence_basis.scope_assurance",
  );
  return {
    kind,
    scope_assurance: scopeAssurance,
    artifact_id: nullableDecimal(
      value.artifact_id,
      "reducer_report.evidence_basis.artifact_id",
    ),
    summary: boundedString(value.summary, "reducer_report.evidence_basis.summary", 256),
    authority_receipt: structuredClone(value.authority_receipt),
  };
}

function validateStickyMetadata(metadata) {
  assertExactKeys(metadata, METADATA_KEYS, "sticky metadata");
  if (
    metadata.schema !== STICKY_AUDIT_SCHEMA ||
    metadata.schema_version !== STICKY_AUDIT_SCHEMA_VERSION
  ) {
    throw new Error("sticky metadata has an unsupported schema");
  }
  const scope = normalizeScope(metadata.scope);
  assertExactKeys(
    metadata.history_semantics,
    HISTORY_SEMANTICS_KEYS,
    "sticky metadata.history_semantics",
  );
  if (
    metadata.history_semantics.model !== HISTORY_MODEL ||
    metadata.history_semantics.integrity_limit !== INTEGRITY_LIMIT
  ) {
    throw new Error("sticky metadata history semantics are unsupported");
  }
  if (
    !Number.isSafeInteger(metadata.current_sequence) ||
    metadata.current_sequence <= 0 ||
    !Array.isArray(metadata.edit_log) ||
    metadata.edit_log.length === 0 ||
    metadata.edit_log.length > MAX_STICKY_EDIT_LOG_ENTRIES ||
    metadata.current_sequence !== metadata.edit_log.length
  ) {
    throw new Error("sticky metadata edit log has an invalid length or current sequence");
  }

  let previousEntryHash = null;
  for (const [index, entry] of metadata.edit_log.entries()) {
    assertExactKeys(entry, ENTRY_KEYS, `sticky metadata.edit_log[${index}]`);
    if (entry.sequence !== index + 1) {
      throw new Error(`sticky metadata.edit_log[${index}] has a non-contiguous sequence`);
    }
    const normalizedEdit = normalizeEdit(entry.edit);
    validateSnapshot(entry.snapshot);
    if (entry.previous_entry_hash !== previousEntryHash) {
      throw new Error(`sticky metadata.edit_log[${index}] breaks the previous-entry chain`);
    }
    digestString(entry.entry_hash, `sticky metadata.edit_log[${index}].entry_hash`);
    const expectedHash = computeEditHash(scope, {
      sequence: entry.sequence,
      edit: normalizedEdit,
      snapshot: entry.snapshot,
      previous_entry_hash: entry.previous_entry_hash,
    });
    if (!constantTimeEqual(entry.entry_hash, expectedHash)) {
      throw new Error(`sticky metadata.edit_log[${index}] has an invalid entry hash`);
    }
    previousEntryHash = entry.entry_hash;
  }

  const metadataBytes = Buffer.byteLength(canonicalJson(metadata), "utf8");
  if (metadataBytes > MAX_STICKY_METADATA_BYTES) {
    throw new Error(
      `sticky metadata is ${metadataBytes} bytes; the maximum is ${MAX_STICKY_METADATA_BYTES}`,
    );
  }
  return metadata;
}

function validateSnapshot(snapshot) {
  assertExactKeys(snapshot, SNAPSHOT_KEYS, "sticky snapshot");
  if (snapshot.report_schema_version !== 2) {
    throw new Error("sticky snapshot report_schema_version must be exactly 2");
  }
  enumValue(snapshot.decision, DECISIONS, "sticky snapshot.decision");
  enumValue(
    snapshot.selection_status,
    SELECTION_STATUSES,
    "sticky snapshot.selection_status",
  );
  enumValue(
    snapshot.selection_intent,
    SELECTION_INTENTS,
    "sticky snapshot.selection_intent",
  );
  boundedString(snapshot.selection_reason, "sticky snapshot.selection_reason", 256);
  enumValue(
    snapshot.server_enforcement_status,
    SERVER_ENFORCEMENT_STATUSES,
    "sticky snapshot.server_enforcement_status",
  );
  strictBoolean(snapshot.controller_available, "sticky snapshot.controller_available");
  strictBoolean(snapshot.workflow_present, "sticky snapshot.workflow_present");
  strictBoolean(snapshot.workflow_compatible, "sticky snapshot.workflow_compatible");
  strictBoolean(snapshot.ruleset_required, "sticky snapshot.ruleset_required");
  strictBoolean(snapshot.ruleset_compatible, "sticky snapshot.ruleset_compatible");
  strictBoolean(snapshot.app_bound, "sticky snapshot.app_bound");
  boundedString(snapshot.repository_id, "sticky snapshot.repository_id", 256);
  positiveSafeInteger(snapshot.pull_request_number, "sticky snapshot.pull_request_number");
  for (const key of [
    "head_sha",
  ]) {
    fullSha(snapshot[key], `sticky snapshot.${key}`);
  }
  for (const key of [
    "base_sha",
    "merge_base_sha",
    "test_merge_sha",
    "test_merge_tree_sha",
    "merge_ref_sha",
    "status_target_sha",
  ]) {
    nullableFullSha(snapshot[key], `sticky snapshot.${key}`);
  }
  potentialMergeParents(snapshot.merge_parent_shas, "sticky snapshot.merge_parent_shas");
  enumValue(
    snapshot.mergeable,
    new Set(["MERGEABLE", "CONFLICTING", "UNKNOWN"]),
    "sticky snapshot.mergeable",
  );
  enumValue(
    snapshot.pull_request_lifecycle,
    PULL_REQUEST_LIFECYCLES,
    "sticky snapshot.pull_request_lifecycle",
  );
  enumValue(
    snapshot.request_policy_status,
    REQUEST_POLICY_STATUSES,
    "sticky snapshot.request_policy_status",
  );
  nullableDecimal(snapshot.selected_request_id, "sticky snapshot.selected_request_id");
  if (snapshot.generation_id === null) {
    if (snapshot.generation_kind !== null || snapshot.generation_index !== null) {
      throw new Error("sticky snapshot generation identity must be all null or all present");
    }
  } else {
    enumValue(
      snapshot.generation_kind,
      new Set(["automatic", "manual"]),
      "sticky snapshot.generation_kind",
    );
    if (!Number.isSafeInteger(snapshot.generation_index) || snapshot.generation_index < 1) {
      throw new Error("sticky snapshot.generation_index must be a positive safe integer");
    }
    exactString(
      snapshot.generation_id,
      `${snapshot.generation_kind}:${snapshot.generation_index}`,
      "sticky snapshot.generation_id",
    );
  }
  boundedString(snapshot.request_policy_reason, "sticky snapshot.request_policy_reason", 256);
  nullableExactString(
    snapshot.permission_assurance,
    "point-in-time-only",
    "sticky snapshot.permission_assurance",
  );
  nullableExactString(
    snapshot.request_time_permission,
    "unproven",
    "sticky snapshot.request_time_permission",
  );
  nullableBoolean(
    snapshot.permission_aba_excluded,
    "sticky snapshot.permission_aba_excluded",
  );
  const manualPermissionAuditPresent =
    snapshot.permission_assurance !== null ||
    snapshot.request_time_permission !== null ||
    snapshot.permission_aba_excluded !== null;
  if (
    manualPermissionAuditPresent &&
    !(
      snapshot.permission_assurance === "point-in-time-only" &&
      snapshot.request_time_permission === "unproven" &&
      snapshot.permission_aba_excluded === false
    )
  ) {
    throw new Error("sticky snapshot manual permission audit fields must form the closed unproven tuple");
  }
  if (manualPermissionAuditPresent && snapshot.request_policy_status === "not-applicable") {
    throw new Error(
      "sticky snapshot manual permission audit cannot use a not-applicable request policy",
    );
  }
  nullableEnumValue(
    snapshot.provider_profile,
    PROVIDER_PROFILES,
    "sticky snapshot.provider_profile",
  );
  exactString(
    snapshot.provider_input_lineage,
    "unavailable",
    "sticky snapshot.provider_input_lineage",
  );
  nullableEnumValue(
    snapshot.evidence_basis_kind,
    EVIDENCE_BASIS_KINDS,
    "sticky snapshot.evidence_basis_kind",
  );
  nullableExactString(
    snapshot.evidence_scope_assurance,
    "whole-pr-contractual",
    "sticky snapshot.evidence_scope_assurance",
  );
  if (
    (snapshot.evidence_basis_kind === null) !==
    (snapshot.evidence_scope_assurance === null)
  ) {
    throw new Error(
      "sticky snapshot evidence scope assurance must bind every non-null basis",
    );
  }
  validateProviderBasisPair(snapshot.provider_profile, snapshot.evidence_basis_kind);
  exactString(snapshot.status_context, V2_STATUS_CONTEXT, "sticky snapshot.status_context");
  enumValue(
    snapshot.status_target_mode,
    STATUS_TARGET_MODES,
    "sticky snapshot.status_target_mode",
  );
  exactString(
    snapshot.freshness_assurance,
    "point-in-time",
    "sticky snapshot.freshness_assurance",
  );
  digestString(snapshot.snapshot_fingerprint, "sticky snapshot.snapshot_fingerprint");
  digestString(snapshot.report_sha256, "sticky snapshot.report_sha256");
  const expectedStatusTarget = snapshot.status_target_mode === "head"
    ? snapshot.head_sha
    : projectedEpochIsBound(snapshot)
      ? snapshot.test_merge_sha
      : null;
  if (snapshot.status_target_sha !== expectedStatusTarget) {
    throw new Error(
      "sticky snapshot status target must match the validated test-merge target",
    );
  }
  return snapshot;
}

function validateRawBinding(binding) {
  assertExactKeys(binding, RAW_BINDING_KEYS, "raw sticky binding");
  if (
    binding.schema !== STICKY_RAW_BINDING_SCHEMA ||
    binding.schema_version !== STICKY_RAW_BINDING_SCHEMA_VERSION
  ) {
    throw new Error("raw sticky binding has an unsupported schema");
  }
  boundedString(binding.repository_node_id, "raw binding.repository_node_id", 256);
  boundedString(binding.repository_id, "raw binding.repository_id", 256);
  boundedString(binding.pull_request_node_id, "raw binding.pull_request_node_id", 256);
  positiveSafeInteger(binding.pull_request_number, "raw binding.pull_request_number");
  fullSha(binding.base_sha, "raw binding.base_sha");
  fullSha(binding.head_sha, "raw binding.head_sha");
  fullSha(binding.merge_base_sha, "raw binding.merge_base_sha");
  fullSha(binding.test_merge_sha, "raw binding.test_merge_sha");
  fullSha(binding.test_merge_tree_sha, "raw binding.test_merge_tree_sha");
  mergeParentTuple(binding.merge_parent_shas, "raw binding.merge_parent_shas");
  enumValue(
    binding.pull_request_lifecycle,
    PULL_REQUEST_LIFECYCLES,
    "raw binding.pull_request_lifecycle",
  );
  exactString(
    binding.provider_input_lineage,
    "unavailable",
    "raw binding.provider_input_lineage",
  );
  positiveDecimal(binding.comment_id, "raw binding.comment_id");
  boundedString(binding.comment_node_id, "raw binding.comment_node_id", 256);
  if (
    !Number.isSafeInteger(binding.raw_body_bytes) ||
    binding.raw_body_bytes < 0 ||
    binding.raw_body_bytes > MAX_STICKY_COMMENT_BYTES
  ) {
    throw new Error("raw sticky binding has an invalid raw_body_bytes value");
  }
  digestString(binding.raw_body_sha256, "raw binding.raw_body_sha256");
  digestString(binding.binding_sha256, "raw binding.binding_sha256");
  return binding;
}

function validateProviderBasisPair(providerProfile, evidenceBasisKind) {
  if (providerProfile === null) {
    if (
      evidenceBasisKind !== null &&
      !new Set(["configuration", "input"]).has(evidenceBasisKind)
    ) {
      throw new Error(
        "sticky snapshot null provider profile accepts only configuration or input basis",
      );
    }
    return;
  }
  if (providerProfile === "unknown") {
    if (
      new Set([
        "terminal-clean",
        "terminal-findings",
        "thumbs-up-clean",
        "no-start-rejection",
      ]).has(evidenceBasisKind)
    ) {
      throw new Error("sticky snapshot unknown provider profile has a conclusive basis");
    }
    return;
  }
  const allowedBasis = providerProfile === "thumbs-up-clean"
    ? new Set(["thumbs-up-clean"])
    : providerProfile === "no-start-rejection"
      ? new Set(["no-start-rejection"])
      : new Set([
          "terminal-clean",
          "terminal-findings",
          "thumbs-up-clean",
          "unresolved-inline-finding",
          "malformed-evidence",
        ]);
  if (!allowedBasis.has(evidenceBasisKind)) {
    throw new Error("sticky snapshot provider profile does not match its closed evidence basis");
  }
}

function computeEditHash(scope, entryWithoutHash) {
  return hashLengthPrefixed(EDIT_HASH_DOMAIN, [
    scope.repository_node_id,
    scope.pull_request_node_id,
    entryWithoutHash.snapshot.test_merge_sha,
    canonicalJson(entryWithoutHash),
  ]);
}

function renderStickyBody(metadata) {
  const current = metadata.edit_log.at(-1);
  const snapshot = current.snapshot;
  const lines = [
    "## Codex GitHub review gate",
    "",
    `- Decision: <code>${escapeHtml(snapshot.decision)}</code>`,
    `- Selection: <code>${escapeHtml(snapshot.selection_status)}</code> ` +
      `(<code>${escapeHtml(snapshot.selection_intent)}</code>)`,
    `- Reason: ${escapeHtml(snapshot.selection_reason)}`,
    `- Server enforcement: <code>${escapeHtml(snapshot.server_enforcement_status)}</code>`,
    `- Request policy: <code>${escapeHtml(snapshot.request_policy_status)}</code>`,
    `- Provider profile: <code>${escapeHtml(snapshot.provider_profile ?? "none")}</code>`,
    `- Provider input lineage: <code>${snapshot.provider_input_lineage}</code>`,
    `- Evidence basis: <code>${escapeHtml(snapshot.evidence_basis_kind ?? "none")}</code> ` +
      `(<code>${escapeHtml(snapshot.evidence_scope_assurance ?? "none")}</code>)`,
    `- Pull request lifecycle: <code>${snapshot.pull_request_lifecycle}</code>`,
    `- Merge base: <code>${snapshot.merge_base_sha}</code>`,
    `- Merge parents: <code>${snapshot.merge_parent_shas.join(" ")}</code>`,
    `- Test-merge: <code>${snapshot.test_merge_sha}</code>`,
    `- Status target: <code>${snapshot.status_context}</code> at ` +
      `<code>${snapshot.status_target_sha}</code>`,
    `- Snapshot: <code>${snapshot.snapshot_fingerprint}</code>`,
    `- Audit edit: <code>#${current.sequence}</code> at ` +
      `<code>${current.edit.timestamp}</code> by ` +
      `<code>${escapeHtml(current.edit.actor_login)}</code>`,
    "",
    "This sticky comment is an audit projection only; it is never review-gate input.",
    "Its in-comment edit history is append-only when preserved, but is not immutable or deletion-resistant.",
  ];

  const priorEntries = metadata.edit_log.slice(0, -1).reverse();
  if (priorEntries.length > 0) {
    lines.push(
      "",
      "<details>",
      `<summary>Prior audit projections (${priorEntries.length})</summary>`,
      "",
    );
    for (const entry of priorEntries) {
      lines.push(
        `- <code>#${entry.sequence}</code> ` +
          `<code>${entry.edit.timestamp}</code> — decision ` +
          `<code>${escapeHtml(entry.snapshot.decision)}</code>, test-merge ` +
          `<code>${entry.snapshot.test_merge_sha}</code>, entry ` +
          `<code>${entry.entry_hash}</code>`,
      );
    }
    lines.push("", "</details>");
  }

  const metadataJson = canonicalJson(metadata);
  const metadataBytes = Buffer.from(metadataJson, "utf8");
  if (metadataBytes.length > MAX_STICKY_METADATA_BYTES) {
    throw new Error(
      `sticky metadata is ${metadataBytes.length} bytes; ` +
        `the maximum is ${MAX_STICKY_METADATA_BYTES}`,
    );
  }
  const encodedMetadata = metadataBytes.toString("base64");
  lines.push("", `<!-- ${STICKY_MARKER}`, encodedMetadata, "-->", "");
  return lines.join("\n");
}

function rawBytes(value) {
  if (typeof value === "string") {
    return Buffer.from(value, "utf8");
  }
  if (Buffer.isBuffer(value)) {
    return Buffer.from(value);
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError("raw_body must be a string, Buffer, or Uint8Array");
}

function exactUtf8Text(bytes) {
  const text = UTF8_DECODER.decode(bytes);
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    throw new Error("raw sticky body must use exact canonical UTF-8 bytes without a BOM");
  }
  return text;
}

function hashLengthPrefixed(domain, fields) {
  const hash = createHash("sha256");
  const domainBytes = Buffer.from(domain, "utf8");
  hash.update(`${domainBytes.length}:`);
  hash.update(domainBytes);
  hash.update("\0");
  for (const field of fields) {
    const bytes = Buffer.isBuffer(field)
      ? field
      : field instanceof Uint8Array
        ? Buffer.from(field.buffer, field.byteOffset, field.byteLength)
        : Buffer.from(String(field), "utf8");
    hash.update(`${bytes.length}:`);
    hash.update(bytes);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function canonicalJson(value) {
  const seen = new Set();
  return canonicalJsonValue(value, seen, 0);
}

function canonicalJsonValue(value, seen, depth) {
  if (depth > 32) {
    throw new Error("canonical JSON exceeds the maximum nesting depth");
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error("canonical JSON accepts only safe integer numbers");
    }
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new Error("canonical JSON contains an unsupported value");
  }
  if (seen.has(value)) {
    throw new Error("canonical JSON contains a cycle");
  }
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = `[${value.map((item) => canonicalJsonValue(item, seen, depth + 1)).join(",")}]`;
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new Error("canonical JSON accepts only plain objects");
    }
    const keys = Object.keys(value).sort();
    result = `{${keys.map((key) => {
      const item = value[key];
      if (item === undefined) {
        throw new Error("canonical JSON does not accept undefined values");
      }
      return `${JSON.stringify(key)}:${canonicalJsonValue(item, seen, depth + 1)}`;
    }).join(",")}}`;
  }
  seen.delete(value);
  return result;
}

function assertExactKeys(value, expectedKeys, label) {
  if (!isPlainRecord(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const actualKeys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actualKeys.length !== expected.length ||
    actualKeys.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${label} must use the closed key set: ${expected.join(", ")}`);
  }
}

function isPlainRecord(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype,
  );
}

function boundedString(value, label, maximum) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    /[\u0000-\u001F\u007F]/u.test(value) ||
    hasUnpairedSurrogate(value)
  ) {
    throw new Error(`${label} must be a non-empty string of at most ${maximum} code units`);
  }
  return value;
}

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function token(value, label) {
  if (typeof value !== "string" || !TOKEN_PATTERN.test(value)) {
    throw new Error(`${label} must be a canonical lower-case token`);
  }
  return value;
}

function enumValue(value, allowed, label) {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new Error(`${label} must be one of: ${[...allowed].join(", ")}`);
  }
  return value;
}

function nullableEnumValue(value, allowed, label) {
  return value === null ? null : enumValue(value, allowed, label);
}

function nullableExactString(value, expected, label) {
  return value === null ? null : exactString(value, expected, label);
}

function nullableBoolean(value, label) {
  return value === null ? null : strictBoolean(value, label);
}

function fullSha(value, label) {
  if (typeof value !== "string" || !FULL_SHA_PATTERN.test(value)) {
    throw new Error(`${label} must be an exact lower-case 40-character SHA`);
  }
  return value;
}

function nullableFullSha(value, label) {
  return value === null ? null : fullSha(value, label);
}

function mergeParentTuple(value, label) {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`${label} must contain exactly two SHAs`);
  }
  return value.map((parent, index) => fullSha(parent, `${label}[${index}]`));
}

function potentialMergeParents(value, label) {
  if (!Array.isArray(value) || value.length > 3) {
    throw new Error(`${label} must contain at most three SHAs`);
  }
  return value.map((parent, index) => fullSha(parent, `${label}[${index}]`));
}

function projectedEpochIsBound(snapshot) {
  return (
    snapshot.mergeable === "MERGEABLE" &&
    snapshot.base_sha !== null &&
    snapshot.merge_base_sha !== null &&
    snapshot.test_merge_sha !== null &&
    snapshot.test_merge_tree_sha !== null &&
    snapshot.merge_ref_sha === snapshot.test_merge_sha &&
    snapshot.test_merge_sha !== snapshot.head_sha &&
    snapshot.test_merge_sha !== snapshot.base_sha &&
    snapshot.merge_parent_shas.length === 2 &&
    snapshot.merge_parent_shas[0] === snapshot.base_sha &&
    snapshot.merge_parent_shas[1] === snapshot.head_sha
  );
}

function canonicalDecimal(value, label) {
  if (
    typeof value !== "string" ||
    value.length > 32 ||
    !DECIMAL_PATTERN.test(value)
  ) {
    throw new Error(`${label} must be a canonical decimal string`);
  }
  return value;
}

function nullableDecimal(value, label) {
  return value === null ? null : canonicalDecimal(value, label);
}

function positiveDecimal(value, label) {
  const normalized = Number.isSafeInteger(value) && value > 0 ? String(value) : value;
  if (
    typeof normalized !== "string" ||
    normalized.length > 32 ||
    !POSITIVE_DECIMAL_PATTERN.test(normalized)
  ) {
    throw new Error(`${label} must be a canonical positive decimal string`);
  }
  return normalized;
}

function nullablePositiveDecimal(value, label) {
  return value === null ? null : positiveDecimal(value, label);
}

function positiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function strictBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function exactString(value, expected, label) {
  if (value !== expected) {
    throw new Error(`${label} must be exactly ${expected}`);
  }
  return value;
}

function digestString(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a lower-case sha256 digest`);
  }
  return value;
}

function canonicalTimestamp(value, label) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a canonical UTC timestamp`);
  }
  const match = STRICT_UTC_TIMESTAMP.exec(value);
  if (!match) {
    throw new Error(`${label} must be a canonical UTC timestamp`);
  }
  const parsed = Date.parse(value);
  const canonical = `${match[1]}.${(match[2] || "").padEnd(3, "0")}Z`;
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== canonical) {
    throw new Error(`${label} must be a real canonical UTC timestamp`);
  }
  return value;
}

function sameScope(left, right) {
  return (
    left.repository_node_id === right.repository_node_id &&
    left.pull_request_node_id === right.pull_request_node_id
  );
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let offset = 0;
  while ((offset = haystack.indexOf(needle, offset)) >= 0) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") {
    return false;
  }
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}
