/**
 * Validator for the canonical public v2 GitHub Codex evidence report.
 *
 * This contract is intentionally separate from schema.mjs: that module
 * validates the action's internal compact reducer report, which is not a
 * public report under the vendored evidence authority.
 */

export const V2_PUBLIC_REPORT_SCHEMA_VERSION = 2;
export const V2_PUBLIC_REPORT_POLICY_SHA256 =
  "29e07793900bb480278cee322746dde679ddcf3b18a8b7b82f552fec389291fc";
export const V2_PUBLIC_REPORT_POLICY_DIGEST =
  `sha256:${V2_PUBLIC_REPORT_POLICY_SHA256}`;
export const V2_PUBLIC_REPORT_AUTHORITY_SHA256 = V2_PUBLIC_REPORT_POLICY_SHA256;
export const V2_PUBLIC_REPORT_AUTHORITY_DIGEST = V2_PUBLIC_REPORT_POLICY_DIGEST;

const REQUIRED_REPORT_FIELDS = Object.freeze([
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
]);
const OPTIONAL_REPORT_FIELDS = Object.freeze([
  "schema_version",
  "snapshot_fingerprint",
]);
const DECISIONS = Object.freeze([
  "not-selected",
  "pending",
  "clean",
  "findings",
  "inconclusive",
  "skipped-unavailable",
  "blocked-configuration",
  "blocked-input",
]);
const PROVIDER_PROFILES = Object.freeze([
  "terminal-payload",
  "thumbs-up-clean",
  "mixed",
  "no-start-rejection",
  "unknown",
  null,
]);
const REQUEST_POLICY_STATUSES = Object.freeze([
  "compliant",
  "warning",
  "unknown",
  "not-applicable",
]);

export const V2_PUBLIC_REPORT_SCHEMA = deepFreeze({
  schema_version: V2_PUBLIC_REPORT_SCHEMA_VERSION,
  policy_sha256: V2_PUBLIC_REPORT_POLICY_SHA256,
  required_top_level_fields: REQUIRED_REPORT_FIELDS,
  allowed_additional_top_level_fields: OPTIONAL_REPORT_FIELDS,
  decisions: DECISIONS,
  provider_profiles: PROVIDER_PROFILES,
  request_policy_statuses: REQUEST_POLICY_STATUSES,
});
export const V2_PUBLIC_REPORT_POLICY_SCHEMA = V2_PUBLIC_REPORT_SCHEMA;
export const V2_PUBLIC_REPORT_AUTHORITY_SCHEMA = V2_PUBLIC_REPORT_SCHEMA;

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/u;
const GENERATION_ID = /^(automatic|manual):([1-9][0-9]*)$/u;
const STRICT_UTC =
  /^(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d{1,3}))?Z$/u;
const GITHUB_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const GITHUB_ARTIFACT_URL =
  /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)#(issuecomment-|pullrequestreview-|discussion_r)([1-9][0-9]*)$/u;

const SELECTIONS = Object.freeze([
  [false, "none", "none", "none"],
  [true, "required", "implicit", "active-ruleset"],
  [true, "required", "implicit", "workflow"],
  [true, "required", "implicit", "joey-default"],
  [true, "explicit", "explicit", "user-explicit"],
  [true, "explicit", "explicit", "legacy-triple"],
]);

const STATE_MATRIX = Object.freeze([
  {
    decision: "not-selected", selected: false, modes: ["none"],
    profiles: [null], kinds: [null], statuses: ["not-applicable"],
  },
  {
    decision: "pending", selected: true, modes: ["implicit", "explicit"],
    profiles: ["unknown"], kinds: [null],
    statuses: ["compliant", "warning", "unknown"],
  },
  {
    decision: "clean", selected: true, modes: ["implicit", "explicit"],
    profiles: ["terminal-payload", "mixed"], kinds: ["terminal-payload"],
    statuses: ["compliant", "warning", "unknown"],
  },
  {
    decision: "clean", selected: true, modes: ["implicit", "explicit"],
    profiles: ["thumbs-up-clean"], kinds: ["current-request-reaction"],
    statuses: ["compliant", "warning"],
  },
  {
    decision: "findings", selected: true, modes: ["implicit", "explicit"],
    profiles: ["terminal-payload", "mixed"], kinds: ["terminal-payload"],
    statuses: ["compliant", "warning", "unknown"],
  },
  {
    decision: "inconclusive", selected: true, modes: ["implicit", "explicit"],
    profiles: ["terminal-payload", "thumbs-up-clean", "mixed", "no-start-rejection", "unknown"],
    kinds: [null, "malformed-terminal", "unknown-terminal", "stable-evidence-blocker"],
    statuses: ["compliant", "warning", "unknown"],
  },
  {
    decision: "skipped-unavailable", selected: true, modes: ["implicit"],
    profiles: ["no-start-rejection"], kinds: ["stable-exact-no-start"],
    statuses: ["compliant", "warning", "unknown"],
  },
  {
    decision: "blocked-configuration", selected: true, modes: ["explicit"],
    profiles: ["no-start-rejection"], kinds: ["stable-exact-no-start"],
    statuses: ["compliant", "warning", "unknown"],
  },
  {
    decision: "blocked-configuration", selected: true, modes: ["implicit", "explicit"],
    profiles: [null], kinds: [null], statuses: ["not-applicable"],
  },
  {
    decision: "blocked-input", selected: true, modes: ["implicit", "explicit"],
    profiles: ["terminal-payload", "thumbs-up-clean", "mixed", "no-start-rejection", "unknown", null],
    kinds: [null, "stable-input-blocker"],
    statuses: ["compliant", "warning", "unknown", "not-applicable"],
  },
]);

const BASIS_OUTCOMES = deepFreeze({
  "terminal-payload": ["clean", "findings"],
  "current-request-reaction": ["clean"],
  "stable-exact-no-start": ["skipped-unavailable", "blocked-configuration"],
  "malformed-terminal": ["inconclusive"],
  "unknown-terminal": ["inconclusive"],
  "stable-evidence-blocker": ["inconclusive"],
  "stable-input-blocker": ["blocked-input"],
});
const BASIS_PROFILES = deepFreeze({
  "terminal-payload": ["terminal-payload", "mixed"],
  "current-request-reaction": ["thumbs-up-clean"],
  "stable-exact-no-start": ["no-start-rejection"],
  "malformed-terminal": ["terminal-payload", "mixed", "unknown"],
  "unknown-terminal": ["terminal-payload", "mixed", "unknown"],
  "stable-evidence-blocker": ["terminal-payload", "thumbs-up-clean", "mixed", "no-start-rejection", "unknown"],
  "stable-input-blocker": ["terminal-payload", "thumbs-up-clean", "mixed", "no-start-rejection", "unknown", null],
});

export function validateV2PublicReport(value) {
  exactObject(
    value,
    [...REQUIRED_REPORT_FIELDS, ...OPTIONAL_REPORT_FIELDS],
    "report",
    REQUIRED_REPORT_FIELDS,
  );
  if (Object.hasOwn(value, "schema_version")) {
    exact(value.schema_version, 2, "report.schema_version");
  }
  if (Object.hasOwn(value, "snapshot_fingerprint")) {
    pattern(value.snapshot_fingerprint, DIGEST, "report.snapshot_fingerprint");
  }

  validateSelection(value.selection);
  oneOf(value.server_enforcement, ["enforced", "not-enforced", "not-applicable"], "report.server_enforcement");
  oneOf(value.decision, DECISIONS, "report.decision");
  oneOf(value.provider_profile, PROVIDER_PROFILES, "report.provider_profile");
  exact(value.provider_input_lineage, "unavailable", "report.provider_input_lineage");
  exact(value.freshness_assurance, "point-in-time", "report.freshness_assurance");
  validateRequestPolicy(value.request_policy, value.selection);

  nullable(value.review_epoch, (item) => validateReviewEpoch(item), "report.review_epoch");
  nullable(value.status_target, (item) => validateStatusTarget(item, value.decision), "report.status_target");
  nullable(value.evidence_basis, (item) => validateEvidenceBasis(item, value), "report.evidence_basis");

  validateSelectionAndServerRelations(value);
  validateStateMatrix(value);
  validateRequiredSelectedObjects(value);
  validateRequestPolicyApplicability(value);
  validateStatusPublicationRelations(value);
  validateArtifactUrlRelations(value);
  return value;
}

export const assertV2PublicReport = validateV2PublicReport;

function validateSelection(value) {
  exactObject(value, ["selected", "intent", "mode", "source"], "report.selection");
  bool(value.selected, "report.selection.selected");
  oneOf(value.intent, ["none", "required", "explicit"], "report.selection.intent");
  oneOf(value.mode, ["none", "implicit", "explicit"], "report.selection.mode");
  oneOf(value.source, ["none", "active-ruleset", "workflow", "joey-default", "user-explicit", "legacy-triple"], "report.selection.source");
  if (!SELECTIONS.some((item) => sameTuple(item, [value.selected, value.intent, value.mode, value.source]))) {
    fail("report.selection is not an authority-approved combination");
  }
}

function validateReviewEpoch(value) {
  const keys = [
    "host", "repository", "pull_request", "pr_state", "pr_merged", "pr_merged_at",
    "base_ref", "live_base_ref_tip", "head_ref", "head_ref_oid", "pr_merge_base",
    "controlled_request_id",
  ];
  exactObject(value, keys, "report.review_epoch");
  exact(value.host, "github.com", "report.review_epoch.host");
  pattern(value.repository, GITHUB_REPOSITORY, "report.review_epoch.repository");
  positiveInteger(value.pull_request, "report.review_epoch.pull_request");
  exact(value.pr_state, "OPEN", "report.review_epoch.pr_state");
  exact(value.pr_merged, false, "report.review_epoch.pr_merged");
  exact(value.pr_merged_at, null, "report.review_epoch.pr_merged_at");
  nonEmptyString(value.base_ref, "report.review_epoch.base_ref");
  pattern(value.live_base_ref_tip, SHA, "report.review_epoch.live_base_ref_tip");
  nonEmptyString(value.head_ref, "report.review_epoch.head_ref");
  pattern(value.head_ref_oid, SHA, "report.review_epoch.head_ref_oid");
  pattern(value.pr_merge_base, SHA, "report.review_epoch.pr_merge_base");
  nullablePattern(value.controlled_request_id, POSITIVE_DECIMAL, "report.review_epoch.controlled_request_id");
}

function validateRequestPolicy(value, selection) {
  const keys = [
    "status", "warnings", "warning_evidence", "request_id", "request_url", "manual",
    "generation_id", "generation_kind", "generation_index",
    "automatic_reservations_consumed_on_head", "manual_requests_in_review_epoch",
    "permission_assurance", "request_time_permission", "permission_aba_excluded",
  ];
  exactObject(value, keys, "report.request_policy");
  oneOf(value.status, REQUEST_POLICY_STATUSES, "report.request_policy.status");
  const warnings = array(value.warnings, "report.request_policy.warnings");
  warnings.forEach((warning, index) =>
    exact(warning, "legacy-triple-alias", `report.request_policy.warnings[${index}]`));
  if (new Set(warnings).size !== warnings.length) {
    fail("report.request_policy.warnings must not contain duplicates");
  }
  exactObject(value.warning_evidence, ["legacy_triple_alias"], "report.request_policy.warning_evidence");
  const legacyEvidence = value.warning_evidence.legacy_triple_alias;
  if (![true, false, null].includes(legacyEvidence)) {
    fail("report.request_policy.warning_evidence.legacy_triple_alias must be boolean or null");
  }
  exact(warnings.includes("legacy-triple-alias"), legacyEvidence === true, "report.request_policy warning projection");

  const legacyAlias = selection.source === "legacy-triple";
  if (value.status === "compliant") {
    exact(warnings.length, 0, "report.request_policy.compliant warning count");
  } else if (value.status === "not-applicable" && !legacyAlias) {
    exact(warnings.length, 0, "report.request_policy.not-applicable warning count");
  } else if (value.status === "warning" && warnings.length === 0) {
    fail("report.request_policy warning status requires a warning");
  }
  if (legacyAlias) {
    exact(warnings.length, 1, "legacy-triple-alias warning count");
    exact(warnings[0], "legacy-triple-alias", "legacy-triple-alias warning");
    exact(legacyEvidence, true, "legacy-triple-alias warning evidence");
  } else {
    exact(warnings.length, 0, "non-legacy warning count");
    exact(legacyEvidence, null, "non-legacy warning evidence");
  }

  bool(value.manual, "report.request_policy.manual");
  nullablePattern(value.request_id, POSITIVE_DECIMAL, "report.request_policy.request_id");
  nullablePattern(value.request_url, GITHUB_ARTIFACT_URL, "report.request_policy.request_url");
  nullablePattern(value.generation_id, GENERATION_ID, "report.request_policy.generation_id");
  nullableOneOf(value.generation_kind, ["automatic", "manual"], "report.request_policy.generation_kind");
  nullablePositiveInteger(value.generation_index, "report.request_policy.generation_index");
  boundedInteger(value.automatic_reservations_consumed_on_head, 0, 3, "report.request_policy.automatic_reservations_consumed_on_head");
  boundedInteger(value.manual_requests_in_review_epoch, 0, 64, "report.request_policy.manual_requests_in_review_epoch");

  const generationTuple = [
    value.request_id, value.request_url, value.generation_id,
    value.generation_kind, value.generation_index,
  ];
  const allNull = generationTuple.every((item) => item === null);
  const allPresent = generationTuple.every((item) => item !== null);
  if (!allNull && !allPresent) {
    fail("report.request_policy generation and request identity must be all null or all present");
  }
  if (value.status === "not-applicable" && !allNull) {
    fail("not-applicable request policy cannot select a request generation");
  }
  if (allNull) {
    exact(value.manual, false, "report.request_policy.manual");
  } else {
    const match = GENERATION_ID.exec(value.generation_id);
    exact(value.generation_kind, match[1], "report.request_policy.generation_kind");
    exact(value.generation_index, Number(match[2]), "report.request_policy.generation_index");
    exact(value.manual, value.generation_kind === "manual", "report.request_policy.manual");
    if (value.generation_kind === "automatic") {
      boundedInteger(value.generation_index, 1, 3, "report.request_policy.generation_index");
      if (value.generation_index > value.automatic_reservations_consumed_on_head) {
        fail("automatic generation index exceeds consumed reservations");
      }
    } else {
      boundedInteger(value.generation_index, 1, 64, "report.request_policy.generation_index");
      if (value.generation_index > value.manual_requests_in_review_epoch) {
        fail("manual generation index exceeds manual requests in the review epoch");
      }
    }
  }

  nullableOneOf(value.permission_assurance, ["point-in-time-only"], "report.request_policy.permission_assurance");
  nullableOneOf(value.request_time_permission, ["unproven"], "report.request_policy.request_time_permission");
  if (value.permission_aba_excluded !== null && value.permission_aba_excluded !== false) {
    fail("report.request_policy.permission_aba_excluded must be false or null");
  }
  const permissionTuple = [
    value.permission_assurance, value.request_time_permission, value.permission_aba_excluded,
  ];
  if (value.manual) {
    if (!sameTuple(permissionTuple, ["point-in-time-only", "unproven", false])) {
      fail("manual request permission fields must use the authority's point-in-time tuple");
    }
  } else if (!permissionTuple.every((item) => item === null)) {
    fail("non-manual request permission fields must all be null");
  }
}

function validateEvidenceBasis(value, report) {
  const keys = [
    "kind", "outcome", "selected_ids", "selected_urls", "server_times",
    "pagination_complete", "final_reread_complete", "scope_assurance",
    "provider_input_lineage", "finding_recovery", "authority_receipt",
  ];
  exactObject(value, keys, "report.evidence_basis");
  oneOf(value.kind, Object.keys(BASIS_OUTCOMES), "report.evidence_basis.kind");
  oneOf(value.outcome, BASIS_OUTCOMES[value.kind], "report.evidence_basis.outcome");
  exact(value.outcome, report.decision, "report.evidence_basis.outcome");
  oneOf(report.provider_profile, BASIS_PROFILES[value.kind], "report.provider_profile");

  const ids = array(value.selected_ids, "report.evidence_basis.selected_ids");
  const urls = array(value.selected_urls, "report.evidence_basis.selected_urls");
  if (ids.length !== urls.length) {
    fail("report.evidence_basis selected ids and urls must be equal length");
  }
  if (["terminal-payload", "current-request-reaction", "stable-exact-no-start"].includes(value.kind) && ids.length === 0) {
    fail("accepted report.evidence_basis selected ids and urls must be non-empty");
  }
  ids.forEach((id, index) =>
    pattern(id, POSITIVE_DECIMAL, `report.evidence_basis.selected_ids[${index}]`));
  urls.forEach((url, index) => pattern(url, GITHUB_ARTIFACT_URL, `report.evidence_basis.selected_urls[${index}]`));
  if (new Set(ids).size !== ids.length) fail("report.evidence_basis.selected_ids must be unique");
  if (new Set(urls).size !== urls.length) fail("report.evidence_basis.selected_urls must be unique");

  validateBasisServerTimes(value.server_times, ids, value.kind);
  bool(value.pagination_complete, "report.evidence_basis.pagination_complete");
  bool(value.final_reread_complete, "report.evidence_basis.final_reread_complete");
  if (["terminal-payload", "current-request-reaction", "stable-exact-no-start"].includes(value.kind)) {
    exact(value.pagination_complete, true, "accepted evidence pagination_complete");
    exact(value.final_reread_complete, true, "accepted evidence final_reread_complete");
  }
  exact(value.scope_assurance, "whole-pr-contractual", "report.evidence_basis.scope_assurance");
  exact(value.provider_input_lineage, "unavailable", "report.evidence_basis.provider_input_lineage");
  nullable(value.finding_recovery, (item) => validateFindingRecovery(item), "report.evidence_basis.finding_recovery");
  validateAuthorityReceipt(value.authority_receipt, value, report);

  if (["current-request-reaction", "stable-exact-no-start"].includes(value.kind)) {
    if (report.request_policy.generation_id === null) {
      fail("request-bound evidence requires a non-null request generation");
    }
  }
  if (value.finding_recovery !== null) {
    const recovery = value.finding_recovery;
    exact(recovery.new_generation_id, report.request_policy.generation_id, "finding recovery generation id");
    exact(recovery.new_request_id, report.request_policy.request_id, "finding recovery request id");
    if (value.server_times.request === null) {
      fail("finding recovery requires a request-bound server time");
    }
    exact(recovery.new_request_server_time, value.server_times.request, "finding recovery request server time");
    const completionIndex = value.selected_ids.indexOf(recovery.later_clean_id);
    if (completionIndex === -1) fail("finding recovery completion must be selected evidence");
    exact(
      recovery.later_clean_server_time,
      value.server_times.selected[completionIndex].server_time,
      "finding recovery completion server time",
    );
    if (value.authority_receipt.selected_request === null) {
      fail("finding recovery requires selected_request receipt data");
    }
  }
}

function validateBasisServerTimes(value, ids, kind) {
  exactObject(value, ["request", "selected"], "report.evidence_basis.server_times");
  nullableTimestamp(value.request, "report.evidence_basis.server_times.request");
  if (["current-request-reaction", "stable-exact-no-start"].includes(kind) && value.request === null) {
    fail("request-bound evidence requires a request server time");
  }
  const selected = array(value.selected, "report.evidence_basis.server_times.selected");
  exact(selected.length, ids.length, "report.evidence_basis.server_times.selected length");
  selected.forEach((record, index) => {
    exactObject(record, ["id", "server_time"], `report.evidence_basis.server_times.selected[${index}]`);
    exact(record.id, ids[index], `report.evidence_basis.server_times.selected[${index}].id`);
    timestamp(record.server_time, `report.evidence_basis.server_times.selected[${index}].server_time`);
    if (
      ["current-request-reaction", "stable-exact-no-start"].includes(kind) &&
      !before(value.request, record.server_time)
    ) {
      fail("request-bound selected server times must be strictly after the request time");
    }
  });
}

function validateAuthorityReceipt(value, basis, report) {
  exactObject(
    value,
    ["selected_request", "selected_artifact", "pagination_sha256", "final_reread_sha256", "recovery"],
    "report.evidence_basis.authority_receipt",
  );
  nullable(value.selected_request, (item) => validateSelectedObject(item, "selected_request"), "selected_request");
  nullable(value.selected_artifact, (item) => validateSelectedObject(item, "selected_artifact"), "selected_artifact");
  pattern(value.pagination_sha256, DIGEST, "report.evidence_basis.authority_receipt.pagination_sha256");
  pattern(value.final_reread_sha256, DIGEST, "report.evidence_basis.authority_receipt.final_reread_sha256");
  nullable(value.recovery, (item) => validateReceiptRecovery(item), "report.evidence_basis.authority_receipt.recovery");

  if (value.selected_request !== null) {
    if (report.request_policy.request_id === null) {
      fail("authority receipt selected request requires a public request identity");
    }
    exact(value.selected_request.id, report.request_policy.request_id,
      "authority receipt selected request id");
    exact(value.selected_request.url, report.request_policy.request_url,
      "authority receipt selected request url");
  }

  if (["current-request-reaction", "stable-exact-no-start"].includes(basis.kind)) {
    if (value.selected_request === null) fail("request-bound evidence requires selected_request receipt data");
    if (basis.kind === "stable-exact-no-start") {
      exact(report.request_policy.manual, false, "stable exact no-start manual request flag");
      exact(report.review_epoch.controlled_request_id, report.request_policy.request_id, "review epoch controlled request id");
    }
  }
  if (["terminal-payload", "malformed-terminal", "unknown-terminal"].includes(basis.kind) && value.selected_artifact === null) {
    fail(`${basis.kind} evidence requires selected_artifact receipt data`);
  }
  if (value.selected_artifact !== null) {
    const artifactIndex = basis.selected_ids.indexOf(value.selected_artifact.id);
    if (artifactIndex === -1 || basis.selected_urls[artifactIndex] !== value.selected_artifact.url) {
      fail("authority receipt selected artifact must match an ordered selected id/url pair");
    }
    const selectedTime = basis.server_times.selected[artifactIndex];
    exact(selectedTime.server_time, value.selected_artifact.created_at, "selected artifact server time");
  }
  if (value.selected_request !== null && basis.server_times.request !== null) {
    exact(basis.server_times.request, value.selected_request.created_at, "selected request server time");
  }
  if (basis.finding_recovery === null) {
    exact(value.recovery, null, "authority receipt recovery");
  } else if (value.recovery === null) {
    fail("finding recovery requires authority receipt recovery data");
  } else {
    exact(value.recovery.new_request_id, basis.finding_recovery.new_request_id, "recovery new request id");
    exact(value.recovery.completion_id, basis.finding_recovery.later_clean_id, "recovery completion id");
    assertArrayEqual(
      value.recovery.finding_ids,
      basis.finding_recovery.closure_records.map((record) => record.finding_id),
      "recovery finding ids",
    );
    assertArrayEqual(
      value.recovery.closure_ids,
      basis.finding_recovery.closure_records.map((record) => record.closure_evidence_id),
      "recovery closure ids",
    );
  }
}

function validateSelectedObject(value, label) {
  exactObject(value, ["id", "url", "created_at"], `report.evidence_basis.authority_receipt.${label}`);
  pattern(value.id, POSITIVE_DECIMAL, `${label}.id`);
  pattern(value.url, GITHUB_ARTIFACT_URL, `${label}.url`);
  timestamp(value.created_at, `${label}.created_at`);
}

function validateReceiptRecovery(value) {
  exactObject(value, ["finding_ids", "closure_ids", "new_request_id", "completion_id"], "authority receipt recovery");
  const findings = array(value.finding_ids, "authority receipt recovery.finding_ids");
  const closures = array(value.closure_ids, "authority receipt recovery.closure_ids");
  if (findings.length === 0 || findings.length !== closures.length) {
    fail("authority receipt recovery finding and closure ids must be non-empty and equal length");
  }
  findings.forEach((item, index) => nonEmptyString(item, `recovery.finding_ids[${index}]`));
  closures.forEach((item, index) => nonEmptyString(item, `recovery.closure_ids[${index}]`));
  pattern(value.new_request_id, POSITIVE_DECIMAL, "recovery.new_request_id");
  pattern(value.completion_id, POSITIVE_DECIMAL, "recovery.completion_id");
}

function validateFindingRecovery(value) {
  const keys = [
    "closure_records", "new_generation_id", "new_request_id", "new_request_server_time",
    "later_clean_id", "later_clean_server_time",
  ];
  exactObject(value, keys, "report.evidence_basis.finding_recovery");
  const records = array(value.closure_records, "finding_recovery.closure_records");
  if (records.length === 0) fail("finding_recovery.closure_records must not be empty");
  pattern(value.new_generation_id, GENERATION_ID, "finding_recovery.new_generation_id");
  pattern(value.new_request_id, POSITIVE_DECIMAL, "finding_recovery.new_request_id");
  timestamp(value.new_request_server_time, "finding_recovery.new_request_server_time");
  pattern(value.later_clean_id, POSITIVE_DECIMAL, "finding_recovery.later_clean_id");
  timestamp(value.later_clean_server_time, "finding_recovery.later_clean_server_time");
  if (!before(value.new_request_server_time, value.later_clean_server_time)) {
    fail("finding recovery later clean time must be strictly after the new request");
  }
  const findingIds = new Set();
  const closureEvidenceIds = new Set();
  records.forEach((record, index) => {
    validateClosureRecord(record, index, value.new_request_server_time);
    if (findingIds.has(record.finding_id)) fail("finding recovery requires one record per finding");
    if (closureEvidenceIds.has(record.closure_evidence_id)) {
      fail("finding recovery requires one unique closure evidence id per finding");
    }
    findingIds.add(record.finding_id);
    closureEvidenceIds.add(record.closure_evidence_id);
  });
}

function validateClosureRecord(value, index, newRequestServerTime) {
  const path = `finding_recovery.closure_records[${index}]`;
  const keys = [
    "finding_id", "finding_kind", "finding_url", "finding_server_time",
    "closure_evidence_id", "closure_server_time", "inline_final_is_resolved",
    "top_level_exact_body", "top_level_unedited", "top_level_actor_stable",
    "top_level_actor_permission",
  ];
  exactObject(value, keys, path);
  nonEmptyString(value.finding_id, `${path}.finding_id`);
  oneOf(value.finding_kind, ["inline", "top-level"], `${path}.finding_kind`);
  pattern(value.finding_url, GITHUB_ARTIFACT_URL, `${path}.finding_url`);
  timestamp(value.finding_server_time, `${path}.finding_server_time`);
  nonEmptyString(value.closure_evidence_id, `${path}.closure_evidence_id`);
  timestamp(value.closure_server_time, `${path}.closure_server_time`);
  if (!before(value.finding_server_time, value.closure_server_time) ||
      !before(value.closure_server_time, newRequestServerTime)) {
    fail(`${path} must satisfy finding < closure < new request time`);
  }
  if (value.finding_kind === "inline") {
    exact(value.inline_final_is_resolved, true, `${path}.inline_final_is_resolved`);
    for (const key of ["top_level_exact_body", "top_level_unedited", "top_level_actor_stable", "top_level_actor_permission"]) {
      exact(value[key], null, `${path}.${key}`);
    }
  } else {
    exact(value.inline_final_is_resolved, null, `${path}.inline_final_is_resolved`);
    exact(value.top_level_exact_body, `/codex-gate addressed ${value.finding_url}`, `${path}.top_level_exact_body`);
    exact(value.top_level_unedited, true, `${path}.top_level_unedited`);
    exact(value.top_level_actor_stable, true, `${path}.top_level_actor_stable`);
    oneOf(value.top_level_actor_permission, ["write", "maintain", "admin"], `${path}.top_level_actor_permission`);
  }
}

function validateStatusTarget(value, decision) {
  const keys = [
    "context", "mode", "live_base_ref_tip", "head_ref_oid", "pr_merge_base",
    "potential_merge_commit_oid", "potential_merge_commit_tree_oid",
    "potential_merge_commit_parent_oids", "merge_ref_oid", "potential_target_state",
    "head_sentinel_state", "validation_receipt",
  ];
  exactObject(value, keys, "report.status_target");
  exact(value.context, "codex/github-review-gate", "report.status_target.context");
  oneOf(value.mode, ["head", "test-merge-with-head-sentinel"],
    "report.status_target.mode");
  pattern(value.live_base_ref_tip, SHA, "report.status_target.live_base_ref_tip");
  pattern(value.head_ref_oid, SHA, "report.status_target.head_ref_oid");
  pattern(value.pr_merge_base, SHA, "report.status_target.pr_merge_base");
  for (const key of ["potential_merge_commit_oid", "potential_merge_commit_tree_oid", "merge_ref_oid"]) {
    nullablePattern(value[key], SHA, `report.status_target.${key}`);
  }
  if (value.potential_merge_commit_parent_oids !== null) {
    const parents = array(value.potential_merge_commit_parent_oids, "report.status_target.potential_merge_commit_parent_oids");
    parents.forEach((parent, index) => pattern(parent, SHA, `potential_merge_commit_parent_oids[${index}]`));
  }
  oneOf(value.potential_target_state, ["validated", "unavailable", "invalid", "conflicting", "stale", "not-applicable"], "report.status_target.potential_target_state");
  oneOf(value.head_sentinel_state, ["absent", "pending", "failure", "error"],
    "report.status_target.head_sentinel_state");
  nullable(value.validation_receipt, (item) => validateTargetReceipt(item, value.mode), "report.status_target.validation_receipt");

  if (value.mode === "head") {
    exact(value.potential_target_state, "not-applicable",
      "head report.status_target.potential_target_state");
    for (const key of ["potential_merge_commit_oid", "potential_merge_commit_tree_oid", "potential_merge_commit_parent_oids", "merge_ref_oid"]) {
      exact(value[key], null, `head report.status_target.${key}`);
    }
    if (value.validation_receipt === null) {
      fail("head report.status_target.validation_receipt is required");
    }
    validateHeadTargetReceiptMatches(value);
    return;
  }

  if (value.potential_target_state === "validated") {
    for (const key of ["potential_merge_commit_oid", "potential_merge_commit_tree_oid", "potential_merge_commit_parent_oids", "merge_ref_oid", "validation_receipt"]) {
      if (value[key] === null) fail(`report.status_target.${key} is required for a validated target`);
    }
    exact(value.potential_merge_commit_parent_oids.length, 2, "validated merge parent count");
    assertArrayEqual(value.potential_merge_commit_parent_oids, [value.live_base_ref_tip, value.head_ref_oid], "validated merge parents");
    exact(value.merge_ref_oid, value.potential_merge_commit_oid, "report.status_target.merge_ref_oid");
    validateTargetReceiptMatches(value);
  } else {
    for (const key of ["potential_merge_commit_oid", "potential_merge_commit_tree_oid", "potential_merge_commit_parent_oids", "merge_ref_oid", "validation_receipt"]) {
      exact(value[key], null, `non-validated report.status_target.${key}`);
    }
  }
}

function validateTargetReceipt(value, mode) {
  exactObject(value, ["pre", "post"], "report.status_target.validation_receipt");
  validateTargetObservation(value.pre, "pre", mode);
  validateTargetObservation(value.post, "post", mode);
  if (!before(value.pre.observed_http_date, value.post.observed_http_date)) {
    fail("status target post HTTP date must be strictly after pre HTTP date");
  }
  for (const key of targetStableFields(mode)) {
    if (!deepEqual(value.pre[key], value.post[key])) {
      fail(`status target validation receipt ${key} must be type-preserving equal`);
    }
  }
}

function validateTargetObservation(value, label, mode) {
  const keys = ["observed_http_date", ...targetStableFields(mode)];
  const path = `report.status_target.validation_receipt.${label}`;
  exactObject(value, keys, path);
  timestamp(value.observed_http_date, `${path}.observed_http_date`);
  exact(value.pr_state, "OPEN", `${path}.pr_state`);
  exact(value.pr_merged, false, `${path}.pr_merged`);
  exact(value.pr_merged_at, null, `${path}.pr_merged_at`);
  const shaFields = mode === "head"
    ? ["live_base_ref_tip", "head_ref_oid", "pr_merge_base"]
    : ["live_base_ref_tip", "head_ref_oid", "pr_merge_base", "potential_merge_commit_oid", "potential_merge_commit_tree_oid", "merge_ref_oid"];
  for (const key of shaFields) {
    pattern(value[key], SHA, `${path}.${key}`);
  }
  if (mode === "head") return;
  exact(value.mergeable, "MERGEABLE", `${path}.mergeable`);
  const parents = array(value.potential_merge_commit_parent_oids, `${path}.potential_merge_commit_parent_oids`);
  exact(parents.length, 2, `${path}.potential_merge_commit_parent_oids length`);
  parents.forEach((parent, index) => pattern(parent, SHA, `${path}.potential_merge_commit_parent_oids[${index}]`));
  assertArrayEqual(parents, [value.live_base_ref_tip, value.head_ref_oid], `${path} parent order`);
  exact(value.merge_ref_oid, value.potential_merge_commit_oid, `${path}.merge_ref_oid`);
}

function targetStableFields(mode) {
  const common = [
    "pr_state", "pr_merged", "pr_merged_at", "mergeable", "live_base_ref_tip",
    "head_ref_oid", "pr_merge_base",
  ];
  if (mode === "head") return common.filter((key) => key !== "mergeable");
  return [
    ...common, "potential_merge_commit_oid",
    "potential_merge_commit_tree_oid", "potential_merge_commit_parent_oids", "merge_ref_oid",
  ];
}

function validateHeadTargetReceiptMatches(target) {
  const projection = {
    live_base_ref_tip: target.live_base_ref_tip,
    head_ref_oid: target.head_ref_oid,
    pr_merge_base: target.pr_merge_base,
  };
  for (const observation of [target.validation_receipt.pre, target.validation_receipt.post]) {
    for (const [key, expected] of Object.entries(projection)) {
      if (!deepEqual(observation[key], expected)) {
        fail(`head status target validation receipt does not match target ${key}`);
      }
    }
  }
}

function validateTargetReceiptMatches(target) {
  const projection = {
    live_base_ref_tip: target.live_base_ref_tip,
    head_ref_oid: target.head_ref_oid,
    pr_merge_base: target.pr_merge_base,
    potential_merge_commit_oid: target.potential_merge_commit_oid,
    potential_merge_commit_tree_oid: target.potential_merge_commit_tree_oid,
    potential_merge_commit_parent_oids: target.potential_merge_commit_parent_oids,
    merge_ref_oid: target.merge_ref_oid,
  };
  for (const observation of [target.validation_receipt.pre, target.validation_receipt.post]) {
    for (const [key, expected] of Object.entries(projection)) {
      if (!deepEqual(observation[key], expected)) {
        fail(`status target validation receipt does not match target ${key}`);
      }
    }
  }
}

function validateSelectionAndServerRelations(report) {
  if (!report.selection.selected) {
    exact(report.server_enforcement, "not-applicable", "unselected server enforcement");
    exact(report.decision, "not-selected", "unselected decision");
  } else {
    if (report.server_enforcement === "not-applicable") {
      fail("selected report cannot use not-applicable server enforcement");
    }
    if (report.decision === "not-selected") {
      fail("selected report cannot use not-selected decision");
    }
  }
  if (report.server_enforcement === "enforced" && !report.selection.selected) {
    fail("not-selected report forbids enforced server status");
  }
  if (report.selection.source === "active-ruleset" && report.server_enforcement === "not-enforced") {
    exact(report.decision, "blocked-configuration", "active ruleset without enforcement decision");
  }
  if (report.selection.source === "workflow") {
    exact(report.server_enforcement, "not-enforced", "workflow-only server enforcement");
  }
}

function validateStateMatrix(report) {
  const kind = report.evidence_basis?.kind ?? null;
  const match = STATE_MATRIX.some((state) =>
    state.decision === report.decision &&
    state.selected === report.selection.selected &&
    state.modes.includes(report.selection.mode) &&
    state.profiles.includes(report.provider_profile) &&
    state.kinds.includes(kind) &&
    state.statuses.includes(report.request_policy.status));
  if (!match) fail("report does not match any authority-approved public report state");
}

function validateRequiredSelectedObjects(report) {
  if (report.selection.selected) {
    const preEpochBlocker =
      ["blocked-input", "blocked-configuration"].includes(report.decision) &&
      report.provider_profile === null &&
      report.evidence_basis === null;
    if ((report.review_epoch === null) !== (report.status_target === null)) {
      fail("selected report review_epoch and status_target must both be present or both be null");
    }
    if (report.review_epoch === null && !preEpochBlocker) {
      fail("selected report null epoch/target requires a closed pre-epoch blocker");
    }
    if (report.review_epoch === null) {
      exact(report.provider_profile, null, "pre-epoch provider_profile");
      exact(report.evidence_basis, null, "pre-epoch evidence_basis");
      exact(report.request_policy.request_id, null, "pre-epoch request id");
      exact(report.request_policy.status, "not-applicable", "pre-epoch request policy status");
      return;
    }
    if (report.request_policy.request_id !== null) {
      if (report.request_policy.manual) {
        exact(report.review_epoch.controlled_request_id, null, "manual request controlled_request_id");
      } else {
        exact(
          report.review_epoch.controlled_request_id,
          report.request_policy.request_id,
          "automatic request controlled_request_id",
        );
      }
    }
    if (report.status_target !== null) {
      exact(report.status_target.live_base_ref_tip, report.review_epoch.live_base_ref_tip, "status target live base tip");
      exact(report.status_target.head_ref_oid, report.review_epoch.head_ref_oid, "status target head oid");
      exact(report.status_target.pr_merge_base, report.review_epoch.pr_merge_base, "status target merge base");
    }
  } else {
    exact(report.review_epoch, null, "not-selected review_epoch");
    exact(report.status_target, null, "not-selected status_target");
    exact(report.evidence_basis, null, "not-selected evidence_basis");
    exact(report.request_policy.request_id, null, "not-selected request id");
  }
}

function validateRequestPolicyApplicability(report) {
  if (report.request_policy.status !== "not-applicable") return;
  const preProviderConfigurationBlock =
    report.decision === "blocked-configuration" &&
    report.provider_profile === null &&
    report.evidence_basis === null;
  if (
    report.selection.selected &&
    report.review_epoch !== null &&
    !preProviderConfigurationBlock
  ) {
    fail("not-applicable request policy requires an absent eligible request plane");
  }
}

function validateStatusPublicationRelations(report) {
  if (report.status_target === null) return;
  if (
    report.status_target.mode === "test-merge-with-head-sentinel" &&
    ["clean", "skipped-unavailable"].includes(report.decision)
  ) {
    exact(report.status_target.potential_target_state, "validated", "positive decision target state");
    oneOf(
      report.status_target.head_sentinel_state,
      ["pending", "failure", "error"],
      "positive decision head_sentinel_state",
    );
  }
}

function validateArtifactUrlRelations(report) {
  const epoch = report.review_epoch;
  const request = report.request_policy;
  if (epoch === null) {
    exact(request.request_url, null, "report without review epoch request_url");
    return;
  }

  if (request.request_url !== null) {
    assertArtifactUrlRelation(request.request_url, epoch, {
      expectedId: request.request_id,
      allowedKinds: ["issuecomment"],
      path: "report.request_policy.request_url",
    });
  }

  const basis = report.evidence_basis;
  if (basis === null) return;
  basis.selected_urls.forEach((url, index) => {
    const reaction = basis.kind === "current-request-reaction";
    if (reaction) {
      exact(url, request.request_url,
        `report.evidence_basis.selected_urls[${index}] request parent`);
    }
    assertArtifactUrlRelation(url, epoch, {
      expectedId: reaction ? request.request_id : basis.selected_ids[index],
      allowedKinds: reaction || basis.kind === "stable-exact-no-start"
        ? ["issuecomment"]
        : ["issuecomment", "pullrequestreview"],
      path: `report.evidence_basis.selected_urls[${index}]`,
    });
  });

  const receipt = basis.authority_receipt;
  if (receipt.selected_request !== null) {
    assertArtifactUrlRelation(receipt.selected_request.url, epoch, {
      expectedId: receipt.selected_request.id,
      allowedKinds: ["issuecomment"],
      path: "report.evidence_basis.authority_receipt.selected_request.url",
    });
  }
  if (receipt.selected_artifact !== null) {
    assertArtifactUrlRelation(receipt.selected_artifact.url, epoch, {
      expectedId: receipt.selected_artifact.id,
      allowedKinds: basis.kind === "stable-exact-no-start"
        ? ["issuecomment"]
        : ["issuecomment", "pullrequestreview"],
      path: "report.evidence_basis.authority_receipt.selected_artifact.url",
    });
  }
  for (const [index, record] of (basis.finding_recovery?.closure_records ?? []).entries()) {
    assertArtifactUrlRelation(record.finding_url, epoch, {
      expectedId: null,
      allowedKinds: record.finding_kind === "inline"
        ? ["discussion_r"]
        : ["issuecomment", "pullrequestreview"],
      path: `report.evidence_basis.finding_recovery.closure_records[${index}].finding_url`,
    });
  }
}

function assertArtifactUrlRelation(value, epoch, {
  expectedId,
  allowedKinds,
  path,
}) {
  const match = GITHUB_ARTIFACT_URL.exec(value);
  if (match === null) fail(`${path} has an invalid format`);
  const [, owner, repository, pullRequest, fragmentPrefix, id] = match;
  const kind = fragmentPrefix === "discussion_r"
    ? fragmentPrefix
    : fragmentPrefix.slice(0, -1);
  exact(`${owner}/${repository}`, epoch.repository, `${path} repository`);
  exact(pullRequest, String(epoch.pull_request), `${path} pull request`);
  if (!allowedKinds.includes(kind)) {
    fail(`${path} fragment kind is incompatible with its evidence object`);
  }
  if (expectedId !== null) exact(id, expectedId, `${path} fragment id`);
}

function nullable(value, validator, path) {
  if (value !== null) validator(value);
  return value;
}

function exactObject(value, allowedKeys, path, requiredKeys = allowedKeys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${path} must be an object`);
  }
  const keys = Object.keys(value);
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) fail(`${path} is missing required key ${key}`);
  }
  for (const key of keys) {
    if (!allowedKeys.includes(key)) fail(`${path} contains unknown key ${key}`);
  }
}

function array(value, path) {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  return value;
}

function bool(value, path) {
  if (typeof value !== "boolean") fail(`${path} must be a boolean`);
}

function exact(actual, expected, path) {
  if (!Object.is(actual, expected)) fail(`${path} must equal ${JSON.stringify(expected)}`);
}

function oneOf(value, choices, path) {
  if (!choices.includes(value)) fail(`${path} is outside the closed authority enum`);
}

function nullableOneOf(value, choices, path) {
  if (value !== null) oneOf(value, choices, path);
}

function pattern(value, regex, path) {
  if (typeof value !== "string" || !regex.test(value)) fail(`${path} has an invalid format`);
}

function nullablePattern(value, regex, path) {
  if (value !== null) pattern(value, regex, path);
}

function nonEmptyString(value, path) {
  if (typeof value !== "string" || value.length === 0) fail(`${path} must be a non-empty string`);
}

function positiveInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${path} must be a positive safe integer`);
}

function nullablePositiveInteger(value, path) {
  if (value !== null) positiveInteger(value, path);
}

function boundedInteger(value, minimum, maximum, path) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${path} must be a safe integer between ${minimum} and ${maximum}`);
  }
}

function timestamp(value, path) {
  pattern(value, STRICT_UTC, path);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail(`${path} must be a real UTC server time`);
  const match = STRICT_UTC.exec(value);
  const instant = new Date(parsed);
  const expected = [
    Number(match[1].slice(0, 4)), Number(match[1].slice(5, 7)) - 1,
    Number(match[1].slice(8, 10)), Number(match[1].slice(11, 13)),
    Number(match[1].slice(14, 16)), Number(match[1].slice(17, 19)),
  ];
  const actual = [
    instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate(),
    instant.getUTCHours(), instant.getUTCMinutes(), instant.getUTCSeconds(),
  ];
  if (!sameTuple(actual, expected)) fail(`${path} must be a real UTC server time`);
}

function nullableTimestamp(value, path) {
  if (value !== null) timestamp(value, path);
}

function before(left, right) {
  return Date.parse(left) < Date.parse(right);
}

function sameTuple(left, right) {
  return left.length === right.length && left.every((item, index) => Object.is(item, right[index]));
}

function assertArrayEqual(actual, expected, path) {
  if (!sameTuple(actual, expected)) fail(`${path} must match the authority-defined order`);
}

function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => deepEqual(item, right[index]));
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return sameTuple(leftKeys, rightKeys) && leftKeys.every((key) => deepEqual(left[key], right[key]));
  }
  return false;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

function fail(message) {
  throw new Error(message);
}
