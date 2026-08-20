export const V2_SCHEMA_VERSION = 2;
export const V2_STATUS_CONTEXT = "codex/github-review-gate";
export const V2_MANUAL_REVIEW_REQUEST = "@codex review";
export const V2_NO_START_BODIES = Object.freeze([
  "To use Codex here, [create an environment for this repo](https://chatgpt.com/codex/cloud/settings/environments).",
  "To use Codex here, [create a Codex account and connect to github](https://chatgpt.com/codex/cloud/settings/connectors).",
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
export const V2_PROVIDER_PROFILES = Object.freeze([
  "terminal-payload",
  "thumbs-up-clean",
  "mixed",
  "no-start-rejection",
  "unknown",
  null,
]);
export const V2_REQUEST_POLICY_STATUSES = Object.freeze([
  "compliant",
  "warning",
  "unknown",
  "not-applicable",
]);
export const V2_SERVER_ENFORCEMENT_STATUSES = Object.freeze([
  "enforced",
  "not-enforced",
  "unknown",
  "not-applicable",
]);
export const V2_SELECTION_STATUSES = Object.freeze([
  "selected",
  "not-selected",
  "blocked",
]);
export const V2_SELECTION_INTENTS = Object.freeze(["implicit", "explicit", "disabled"]);
export const V2_FRESHNESS_ASSURANCES = Object.freeze(["point-in-time"]);
export const V2_STATUS_TARGET_MODES = Object.freeze([
  "head",
  "test-merge-with-head-sentinel",
]);

export const TERMINAL_V2_DECISIONS = new Set([
  "clean",
  "findings",
  "inconclusive",
  "skipped-unavailable",
  "blocked-configuration",
  "blocked-input",
]);

const ARTIFACT_PUBLICATION_BASIS_KINDS = new Set([
  "terminal-clean",
  "terminal-findings",
  "unresolved-inline-finding",
  "malformed-evidence",
  "unknown-terminal",
]);

export const V2_REDUCER_INPUT_SCHEMA = deepFreeze({
  schema_version: 2,
  exact_keys: [
    "schema_version",
    "observed_at",
    "snapshot_fingerprint",
    "complete",
    "selection",
    "server_enforcement",
    "review_epoch",
    "scope_stable",
    "inventories",
    "requests",
    "artifacts",
    "threads",
    "acknowledgements",
    "no_start_observations",
    "generation_admissions",
    "evidence_authority",
    "budget",
  ],
  selection: {
    exact_keys: ["intent", "eligible", "reason"],
    intent: V2_SELECTION_INTENTS,
  },
  server_enforcement: {
    exact_keys: [
      "controller_available",
      "workflow_present",
      "workflow_compatible",
      "ruleset_required",
      "ruleset_compatible",
      "app_bound",
    ],
  },
  review_epoch: {
    exact_keys: [
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
    ],
    mergeable: ["MERGEABLE", "CONFLICTING", "UNKNOWN"],
    lifecycle: ["open", "closed", "merged"],
  },
  inventories: {
    exact_keys: ["requests", "artifacts", "threads", "acknowledgements", "no_start"],
  },
  request: {
    exact_keys: [
      "id",
      "url",
      "kind",
      "body",
      "created_at",
      "updated_at",
      "controlled",
      "stable",
      "base_oid",
      "head_oid",
      "current_incarnation",
      "actor_permission",
      "generation_id",
      "generation_kind",
      "generation_index",
    ],
    kind: ["automatic", "manual"],
  },
  actor_permission: {
    exact_keys: [
      "assurance",
      "request_time_permission",
      "permission_aba_excluded",
      "initial",
      "final",
    ],
  },
  permission_observation: {
    exact_keys: ["observed_at", "actor", "push"],
  },
  actor: { exact_keys: ["id", "login", "type"] },
  artifact: {
    exact_keys: [
      "id",
      "url",
      "kind",
      "channel",
      "request_id",
      "created_at",
      "commit_oid",
      "stable",
      "finding_ids",
    ],
    kind: ["terminal-clean", "terminal-findings", "malformed"],
    channel: ["issue-comment", "pull-request-review"],
  },
  thread: {
    exact_keys: [
      "id",
      "finding_id",
      "kind",
      "created_at",
      "is_resolved",
      "resolution_observed_at",
      "stable",
    ],
    kind: ["top-level", "inline"],
  },
  acknowledgement: {
    exact_keys: [
      "id",
      "kind",
      "request_id",
      "finding_id",
      "created_at",
      "commit_oid",
      "exact_provider",
      "stable",
    ],
    kind: ["plus-one", "eyes", "addressed"],
  },
  no_start_observation: {
    exact_keys: [
      "id",
      "url",
      "request_id",
      "body",
      "carrier_created_at",
      "exact_provider",
      "stable",
      "first_seen_at",
      "confirmed_at",
      "first_run_id",
      "confirmation_run_id",
      "request_run_id",
    ],
  },
  generation_admission: {
    exact_keys: [
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
    ],
    ledger_order: {
      exact_keys: [
        "prior_request_binding_index",
        "recovery_transition_index",
        "next_request_binding_index",
      ],
    },
  },
  evidence_authority: {
    exact_keys: ["pagination_sha256", "final_reread_sha256"],
  },
  budget: {
    exact_keys: [
      "automatic_requests_on_head",
      "automatic_reservations_on_head",
      "manual_requests_in_epoch",
    ],
    automatic_limit: 3,
    manual_limit: 64,
  },
});

export const V2_REDUCER_OPTIONS_SCHEMA = deepFreeze({
  exact_keys: ["status_target_mode", "status_context"],
  status_target_mode: V2_STATUS_TARGET_MODES,
});

export const V2_REDUCER_OUTPUT_SCHEMA = deepFreeze({
  schema_version: 2,
  exact_keys: [
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
  ],
  selection: {
    exact_keys: ["status", "intent", "reason"],
    status: V2_SELECTION_STATUSES,
    intent: V2_SELECTION_INTENTS,
  },
  server_enforcement: {
    exact_keys: [
      "status",
      "controller_available",
      "workflow_present",
      "workflow_compatible",
      "ruleset_required",
      "ruleset_compatible",
      "app_bound",
    ],
    status: V2_SERVER_ENFORCEMENT_STATUSES,
  },
  review_epoch: V2_REDUCER_INPUT_SCHEMA.review_epoch,
  request_policy: {
    exact_keys: [
      "status",
      "selected_request_id",
      "reason",
      "permission_assurance",
      "request_time_permission",
      "permission_aba_excluded",
      "generation_id",
      "generation_kind",
      "generation_index",
    ],
    status: V2_REQUEST_POLICY_STATUSES,
  },
  provider_profile: V2_PROVIDER_PROFILES,
  provider_input_lineage: ["unavailable"],
  evidence_basis: {
    exact_keys: [
      "kind",
      "scope_assurance",
      "artifact_id",
      "summary",
      "authority_receipt",
    ],
    kind: [
      "terminal-clean",
      "terminal-findings",
      "thumbs-up-clean",
      "no-start-rejection",
      "unresolved-inline-finding",
      "malformed-evidence",
      "unknown-terminal",
      "stable-evidence-blocker",
      "incomplete-snapshot",
      "unstable-scope",
      "configuration",
      "input",
    ],
  },
  status_target: {
    exact_keys: ["mode", "sha", "context"],
    mode: V2_STATUS_TARGET_MODES,
  },
  decision: V2_DECISIONS,
  freshness_assurance: V2_FRESHNESS_ASSURANCES,
});

const FULL_SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const STRICT_UTC_TIMESTAMP =
  /^(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d{1,3}))?Z$/u;

export function assertV2ReducerInput(value) {
  exactObject(value, V2_REDUCER_INPUT_SCHEMA.exact_keys, "snapshot");
  exact(value.schema_version, 2, "snapshot.schema_version");
  timestamp(value.observed_at, "snapshot.observed_at");
  digest(value.snapshot_fingerprint, "snapshot.snapshot_fingerprint");
  bool(value.complete, "snapshot.complete");

  exactObject(value.selection, V2_REDUCER_INPUT_SCHEMA.selection.exact_keys, "selection");
  oneOf(value.selection.intent, V2_REDUCER_INPUT_SCHEMA.selection.intent, "selection.intent");
  bool(value.selection.eligible, "selection.eligible");
  boundedString(value.selection.reason, "selection.reason", 256);

  exactObject(
    value.server_enforcement,
    V2_REDUCER_INPUT_SCHEMA.server_enforcement.exact_keys,
    "server_enforcement",
  );
  for (const key of V2_REDUCER_INPUT_SCHEMA.server_enforcement.exact_keys) {
    bool(value.server_enforcement[key], `server_enforcement.${key}`);
  }

  validateReviewEpoch(value.review_epoch, "review_epoch");
  bool(value.scope_stable, "snapshot.scope_stable");
  exactObject(value.inventories, V2_REDUCER_INPUT_SCHEMA.inventories.exact_keys, "inventories");
  for (const key of V2_REDUCER_INPUT_SCHEMA.inventories.exact_keys) {
    bool(value.inventories[key], `inventories.${key}`);
  }

  const requests = array(value.requests, "requests");
  const artifacts = array(value.artifacts, "artifacts");
  const threads = array(value.threads, "threads");
  const acknowledgements = array(value.acknowledgements, "acknowledgements");
  const noStartObservations = array(value.no_start_observations, "no_start_observations");
  const generationAdmissions = array(
    value.generation_admissions,
    "generation_admissions",
  );
  requests.forEach((item, index) => validateRequest(item, index));
  artifacts.forEach((item, index) => validateArtifact(item, index));
  threads.forEach((item, index) => validateThread(item, index));
  acknowledgements.forEach((item, index) => validateAcknowledgement(item, index));
  noStartObservations.forEach((item, index) => validateNoStartObservation(item, index));
  if (generationAdmissions.length > 2) {
    throw new Error("generation_admissions must contain at most two transitions");
  }
  generationAdmissions.forEach((item, index) =>
    validateGenerationAdmission(item, index));
  uniqueField(requests, "id", "requests");
  uniqueField(artifacts, "id", "artifacts");
  uniqueField(threads, "id", "threads");
  uniqueField(threads, "finding_id", "threads");
  uniqueField(acknowledgements, "id", "acknowledgements");
  uniqueField(noStartObservations, "id", "no_start_observations");

  const requestIds = new Set(requests.map((item) => item.id));
  const allFindingIds = artifacts.flatMap((item) => item.finding_ids);
  const findingIds = new Set(allFindingIds);
  if (findingIds.size !== allFindingIds.length) {
    throw new Error("artifacts must not repeat finding_ids across terminal carriers");
  }
  for (const artifact of artifacts) {
    if (artifact.request_id !== null && !requestIds.has(artifact.request_id)) {
      throw new Error(`artifact ${artifact.id} references an unknown request_id`);
    }
  }
  for (const thread of threads) {
    if (!findingIds.has(thread.finding_id)) {
      throw new Error(`thread ${thread.id} references an unknown finding_id`);
    }
  }
  for (const acknowledgement of acknowledgements) {
    if (
      acknowledgement.request_id !== null &&
      !requestIds.has(acknowledgement.request_id)
    ) {
      throw new Error(
        `acknowledgement ${acknowledgement.id} references an unknown request_id`,
      );
    }
    if (
      acknowledgement.finding_id !== null &&
      !findingIds.has(acknowledgement.finding_id)
    ) {
      throw new Error(
        `acknowledgement ${acknowledgement.id} references an unknown finding_id`,
      );
    }
  }
  for (const observation of noStartObservations) {
    if (!requestIds.has(observation.request_id)) {
      throw new Error(
        `no-start observation ${observation.id} references an unknown request_id`,
      );
    }
  }
  const requestsById = new Map(requests.map((request) => [request.id, request]));
  const seenAdmissionRequests = new Set();
  const seenAdmissionTransitions = new Set();
  generationAdmissions.forEach((admission, index) => {
    const label = `generation_admissions[${index}]`;
    const prior = requestsById.get(admission.prior_request_id);
    const next = requestsById.get(admission.next_request_id);
    if (
      admission.head_oid !== value.review_epoch.head_oid ||
      prior?.generation_id !== admission.prior_generation_id ||
      next?.generation_id !== admission.next_generation_id ||
      prior?.head_oid !== value.review_epoch.head_oid ||
      next?.head_oid !== value.review_epoch.head_oid
    ) {
      throw new Error(`${label} must bind two observed requests on the current head`);
    }
    if (Date.parse(admission.transition_server_time) >= Date.parse(next.created_at)) {
      throw new Error(`${label} transition must strictly precede its next request`);
    }
    if (
      seenAdmissionRequests.has(admission.next_request_id) ||
      seenAdmissionTransitions.has(admission.recovery_transition_record_oid)
    ) {
      throw new Error(`${label} repeats a durable generation admission identity`);
    }
    seenAdmissionRequests.add(admission.next_request_id);
    seenAdmissionTransitions.add(admission.recovery_transition_record_oid);
    const previous = generationAdmissions[index - 1];
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
      throw new Error(`${label} does not continue the prior durable admission`);
    }
  });

  exactObject(
    value.evidence_authority,
    V2_REDUCER_INPUT_SCHEMA.evidence_authority.exact_keys,
    "evidence_authority",
  );
  digest(value.evidence_authority.pagination_sha256, "evidence_authority.pagination_sha256");
  digest(value.evidence_authority.final_reread_sha256, "evidence_authority.final_reread_sha256");

  exactObject(value.budget, V2_REDUCER_INPUT_SCHEMA.budget.exact_keys, "budget");
  for (const key of V2_REDUCER_INPUT_SCHEMA.budget.exact_keys) {
    nonNegativeSafeInteger(value.budget[key], `budget.${key}`);
  }
  return value;
}

export function assertV2ReducerOptions(value) {
  exactObject(value, V2_REDUCER_OPTIONS_SCHEMA.exact_keys, "options");
  oneOf(
    value.status_target_mode,
    V2_REDUCER_OPTIONS_SCHEMA.status_target_mode,
    "options.status_target_mode",
  );
  exact(value.status_context, V2_STATUS_CONTEXT, "options.status_context");
  return value;
}

export function assertV2ReducerOutput(value) {
  exactObject(value, V2_REDUCER_OUTPUT_SCHEMA.exact_keys, "report");
  exact(value.schema_version, 2, "report.schema_version");
  exactObject(value.selection, V2_REDUCER_OUTPUT_SCHEMA.selection.exact_keys, "report.selection");
  oneOf(value.selection.status, V2_REDUCER_OUTPUT_SCHEMA.selection.status, "report.selection.status");
  oneOf(value.selection.intent, V2_REDUCER_OUTPUT_SCHEMA.selection.intent, "report.selection.intent");
  boundedString(value.selection.reason, "report.selection.reason", 256);

  exactObject(
    value.server_enforcement,
    V2_REDUCER_OUTPUT_SCHEMA.server_enforcement.exact_keys,
    "report.server_enforcement",
  );
  oneOf(
    value.server_enforcement.status,
    V2_REDUCER_OUTPUT_SCHEMA.server_enforcement.status,
    "report.server_enforcement.status",
  );
  for (const key of [
    "controller_available",
    "workflow_present",
    "workflow_compatible",
    "ruleset_required",
    "ruleset_compatible",
    "app_bound",
  ]) {
    bool(value.server_enforcement[key], `report.server_enforcement.${key}`);
  }
  validateReviewEpoch(value.review_epoch, "report.review_epoch");

  exactObject(
    value.request_policy,
    V2_REDUCER_OUTPUT_SCHEMA.request_policy.exact_keys,
    "report.request_policy",
  );
  oneOf(
    value.request_policy.status,
    V2_REDUCER_OUTPUT_SCHEMA.request_policy.status,
    "report.request_policy.status",
  );
  nullableDecimal(value.request_policy.selected_request_id, "report.request_policy.selected_request_id");
  if (value.request_policy.generation_id === null) {
    if (
      value.request_policy.generation_kind !== null ||
      value.request_policy.generation_index !== null
    ) {
      throw new Error("report.request_policy generation identity must be all null or all present");
    }
  } else {
    oneOf(
      value.request_policy.generation_kind,
      ["automatic", "manual"],
      "report.request_policy.generation_kind",
    );
    positiveSafeInteger(
      value.request_policy.generation_index,
      "report.request_policy.generation_index",
    );
    exact(
      value.request_policy.generation_id,
      `${value.request_policy.generation_kind}:${value.request_policy.generation_index}`,
      "report.request_policy.generation_id",
    );
    if (value.request_policy.selected_request_id === null) {
      throw new Error("report.request_policy generation requires selected_request_id");
    }
  }
  boundedString(value.request_policy.reason, "report.request_policy.reason", 256);
  nullableOneOf(
    value.request_policy.permission_assurance,
    ["point-in-time-only"],
    "report.request_policy.permission_assurance",
  );
  nullableOneOf(
    value.request_policy.request_time_permission,
    ["unproven"],
    "report.request_policy.request_time_permission",
  );
  if (
    value.request_policy.permission_aba_excluded !== null &&
    value.request_policy.permission_aba_excluded !== false
  ) {
    throw new Error("report.request_policy.permission_aba_excluded must be false or null");
  }
  const permissionTuple = [
    value.request_policy.permission_assurance,
    value.request_policy.request_time_permission,
    value.request_policy.permission_aba_excluded,
  ];
  if (
    !(
      permissionTuple.every((item) => item === null) ||
      (permissionTuple[0] === "point-in-time-only" &&
        permissionTuple[1] === "unproven" &&
        permissionTuple[2] === false)
    )
  ) {
    throw new Error("report.request_policy manual permission fields must form the closed weak tuple");
  }

  oneOf(value.provider_profile, V2_REDUCER_OUTPUT_SCHEMA.provider_profile, "report.provider_profile");
  exact(
    value.provider_input_lineage,
    "unavailable",
    "report.provider_input_lineage",
  );
  validateEvidenceBasis(value.evidence_basis);
  validateProviderBasisPair(value.provider_profile, value.evidence_basis?.kind ?? null);
  exactObject(value.status_target, V2_REDUCER_OUTPUT_SCHEMA.status_target.exact_keys, "report.status_target");
  oneOf(value.status_target.mode, V2_REDUCER_OUTPUT_SCHEMA.status_target.mode, "report.status_target.mode");
  nullableSha(value.status_target.sha, "report.status_target.sha");
  exact(value.status_target.context, V2_STATUS_CONTEXT, "report.status_target.context");
  const expectedTarget = value.status_target.mode === "head"
    ? value.review_epoch.head_oid
    : reviewEpochTargetIsBound(value.review_epoch)
      ? value.review_epoch.merge_oid
      : null;
  exact(value.status_target.sha, expectedTarget, "report.status_target.sha");
  oneOf(value.decision, V2_DECISIONS, "report.decision");
  exact(value.freshness_assurance, "point-in-time", "report.freshness_assurance");
  digest(value.snapshot_fingerprint, "report.snapshot_fingerprint");
  validateReducerReportSemantics(value);
  return value;
}

function reviewEpochTargetIsBound(epoch) {
  return (
    epoch.mergeable === "MERGEABLE" &&
    epoch.base_oid !== null &&
    epoch.merge_base_oid !== null &&
    epoch.merge_oid !== null &&
    epoch.merge_tree_oid !== null &&
    epoch.merge_ref_oid === epoch.merge_oid &&
    epoch.merge_oid !== epoch.head_oid &&
    epoch.merge_oid !== epoch.base_oid &&
    epoch.merge_parents.length === 2 &&
    epoch.merge_parents[0] === epoch.base_oid &&
    epoch.merge_parents[1] === epoch.head_oid
  );
}

function validateReducerReportSemantics(value) {
  const kind = value.evidence_basis?.kind ?? null;
  const epochFoundationIsBound =
    value.review_epoch.lifecycle === "open" &&
    value.review_epoch.base_oid !== null &&
    value.review_epoch.head_oid !== null &&
    value.review_epoch.merge_base_oid !== null;
  const preProviderEpochBlocker =
    value.selection.status === "selected" &&
    value.review_epoch.lifecycle === "open" &&
    !epochFoundationIsBound &&
    value.decision === "blocked-input" &&
    value.provider_profile === null &&
    value.evidence_basis === null &&
    value.request_policy.status === "not-applicable";
  const serverReady = value.server_enforcement.controller_available &&
    (!value.server_enforcement.workflow_present ||
      value.server_enforcement.workflow_compatible) &&
    (
      !value.server_enforcement.ruleset_required || (
        value.server_enforcement.workflow_present &&
        value.server_enforcement.workflow_compatible &&
        value.server_enforcement.ruleset_compatible &&
        value.server_enforcement.app_bound
      )
    );
  const expectedServerStatus = value.selection.status === "not-selected"
    ? "not-applicable"
    : value.server_enforcement.ruleset_required && serverReady
      ? "enforced"
      : "not-enforced";
  exact(
    value.server_enforcement.status,
    expectedServerStatus,
    "report.server_enforcement.status",
  );

  if (
    value.selection.status === "selected" &&
    value.review_epoch.lifecycle === "open" &&
    !epochFoundationIsBound &&
    !preProviderEpochBlocker
  ) {
    throw new Error(
      "report selected open evaluation requires a bound epoch foundation or the closed pre-provider blocker",
    );
  }
  if (
    value.decision === "blocked-input" &&
    value.evidence_basis === null &&
    !preProviderEpochBlocker
  ) {
    throw new Error(
      "report null blocked-input basis is reserved for the closed pre-provider epoch blocker",
    );
  }

  if (
    value.status_target.mode === "test-merge-with-head-sentinel" &&
    value.status_target.sha === null &&
    !(
      value.decision === "not-selected" ||
      value.decision === "blocked-input" ||
      (
        value.decision === "blocked-configuration" &&
        kind === "configuration"
      ) ||
      (
        value.decision === "findings" &&
        ["terminal-findings", "unresolved-inline-finding"].includes(kind)
      ) ||
      (
        value.decision === "inconclusive" &&
        value.evidence_basis?.kind === "malformed-evidence"
      )
    )
  ) {
    throw new Error("report null status target requires an input blocker or independent negative provider evidence");
  }
  if (
    value.selection.status === "selected" &&
    value.decision !== "blocked-configuration" &&
    !serverReady &&
    !preProviderEpochBlocker
  ) {
    throw new Error("report selected evaluation requires a ready controller configuration");
  }
  if (
    value.decision === "blocked-configuration" &&
    kind === "configuration" &&
    serverReady
  ) {
    throw new Error("report configuration blocker requires an unready controller configuration");
  }

  validateEvidenceAuthoritySemantics(value);

  const requireState = ({ selection, profiles, kinds }) => {
    if (!selection.includes(value.selection.status)) {
      throw new Error(`report.decision ${value.decision} has an incompatible selection status`);
    }
    if (!profiles.includes(value.provider_profile)) {
      throw new Error(`report.decision ${value.decision} has an incompatible provider profile`);
    }
    if (!kinds.includes(kind)) {
      throw new Error(`report.decision ${value.decision} has an incompatible evidence basis`);
    }
  };

  switch (value.decision) {
    case "not-selected":
      requireState({ selection: ["not-selected"], profiles: [null], kinds: [null] });
      exact(value.request_policy.status, "not-applicable", "report.request_policy.status");
      break;
    case "pending":
      requireState({ selection: ["selected"], profiles: ["unknown"], kinds: [null] });
      break;
    case "clean":
      requireState({
        selection: ["selected"],
        profiles: ["thumbs-up-clean"],
        kinds: ["thumbs-up-clean"],
      });
      if (kind === "thumbs-up-clean" && value.provider_profile !== "thumbs-up-clean") {
        throw new Error("report clean profile does not match its evidence authority");
      }
      break;
    case "findings":
      requireState({
        selection: ["selected"],
        profiles: ["terminal-payload", "mixed"],
        kinds: ["terminal-findings", "unresolved-inline-finding"],
      });
      break;
    case "skipped-unavailable":
      requireState({
        selection: ["selected"],
        profiles: ["no-start-rejection"],
        kinds: ["no-start-rejection"],
      });
      break;
    case "blocked-configuration":
      requireState({
        selection: ["blocked", "selected"],
        profiles: [null, "no-start-rejection"],
        kinds: ["configuration", "no-start-rejection"],
      });
      break;
    case "blocked-input":
      requireState({
        selection: ["selected"],
        profiles: [null, "unknown", "terminal-payload", "mixed"],
        kinds: [null, "input"],
      });
      break;
    case "inconclusive":
      requireState({
        selection: ["selected"],
        profiles: ["unknown", "terminal-payload", "mixed"],
        kinds: [
          null,
          "terminal-clean",
          "input",
          "malformed-evidence",
          "unknown-terminal",
          "stable-evidence-blocker",
          "incomplete-snapshot",
          "unstable-scope",
        ],
      });
      break;
    default:
      throw new Error("report.decision is unsupported");
  }
}

function validateEvidenceAuthoritySemantics(value) {
  const basis = value.evidence_basis;
  if (basis === null) {
    return;
  }
  const receipt = basis.authority_receipt;
  if (
    basis.kind === "terminal-clean" &&
    (
      receipt.selected_request !== null ||
      receipt.selected_generation !== null ||
      receipt.recovery !== null
    )
  ) {
    throw new Error("report terminal clean classification lineage must be null");
  }
  if (
    basis.kind === "thumbs-up-clean" &&
    receipt.selected_artifact !== null
  ) {
    throw new Error("report reaction clean authority selected artifact must be null");
  }
  if (
    receipt.selected_request !== null &&
    receipt.selected_request.id !== value.request_policy.selected_request_id
  ) {
    throw new Error(
      "report evidence selected request must equal request_policy.selected_request_id",
    );
  }
  if (
    ARTIFACT_PUBLICATION_BASIS_KINDS.has(basis.kind) ||
    basis.kind === "no-start-rejection"
  ) {
    if (
      receipt.selected_artifact === null ||
      receipt.selected_artifact.id !== basis.artifact_id
    ) {
      throw new Error("report evidence basis must bind its exact selected artifact");
    }
  }
  if (
    new Set(["thumbs-up-clean", "no-start-rejection"]).has(basis.kind) &&
    receipt.selected_request === null
  ) {
    throw new Error("report evidence basis must bind its exact selected request");
  }
  if (receipt.recovery !== null) {
    if (
      receipt.selected_request === null ||
      receipt.recovery.new_request_id !== receipt.selected_request.id ||
      receipt.recovery.completion_id !== basis.artifact_id ||
      basis.kind !== "thumbs-up-clean"
    ) {
      throw new Error("report evidence recovery receipt is not bound to its request and completion");
    }
  }
}

function validateReviewEpoch(value, label) {
  exactObject(value, V2_REDUCER_INPUT_SCHEMA.review_epoch.exact_keys, label);
  boundedString(value.repository_id, `${label}.repository_id`, 256);
  positiveSafeInteger(value.pull_request_number, `${label}.pull_request_number`);
  nullableSha(value.base_oid, `${label}.base_oid`);
  sha(value.head_oid, `${label}.head_oid`);
  for (const key of ["merge_base_oid", "merge_oid", "merge_tree_oid", "merge_ref_oid"]) {
    nullableSha(value[key], `${label}.${key}`);
  }
  const parents = array(value.merge_parents, `${label}.merge_parents`);
  if (parents.length > 3) {
    throw new Error(`${label}.merge_parents must contain at most three SHAs`);
  }
  parents.forEach((parent, index) => sha(parent, `${label}.merge_parents[${index}]`));
  oneOf(value.mergeable, V2_REDUCER_INPUT_SCHEMA.review_epoch.mergeable, `${label}.mergeable`);
  oneOf(value.lifecycle, V2_REDUCER_INPUT_SCHEMA.review_epoch.lifecycle, `${label}.lifecycle`);
}

function validateRequest(value, index) {
  const label = `requests[${index}]`;
  exactObject(value, V2_REDUCER_INPUT_SCHEMA.request.exact_keys, label);
  decimal(value.id, `${label}.id`);
  githubPullArtifactUrl(value.url, `${label}.url`);
  oneOf(value.kind, V2_REDUCER_INPUT_SCHEMA.request.kind, `${label}.kind`);
  boundedString(value.body, `${label}.body`, 256);
  timestamp(value.created_at, `${label}.created_at`);
  timestamp(value.updated_at, `${label}.updated_at`);
  bool(value.controlled, `${label}.controlled`);
  bool(value.stable, `${label}.stable`);
  sha(value.base_oid, `${label}.base_oid`);
  sha(value.head_oid, `${label}.head_oid`);
  bool(value.current_incarnation, `${label}.current_incarnation`);
  validateGeneration(value, label);
  if (value.kind === "manual") {
    validateActorPermission(value.actor_permission, `${label}.actor_permission`);
  } else if (value.actor_permission !== null) {
    throw new Error(`${label}.actor_permission must be null for automatic requests`);
  }
}

function validateActorPermission(value, label) {
  exactObject(value, V2_REDUCER_INPUT_SCHEMA.actor_permission.exact_keys, label);
  exact(value.assurance, "point-in-time-only", `${label}.assurance`);
  exact(value.request_time_permission, "unproven", `${label}.request_time_permission`);
  exact(value.permission_aba_excluded, false, `${label}.permission_aba_excluded`);
  validatePermissionObservation(value.initial, `${label}.initial`);
  validatePermissionObservation(value.final, `${label}.final`);
}

function validatePermissionObservation(value, label) {
  exactObject(value, V2_REDUCER_INPUT_SCHEMA.permission_observation.exact_keys, label);
  timestamp(value.observed_at, `${label}.observed_at`);
  exactObject(value.actor, V2_REDUCER_INPUT_SCHEMA.actor.exact_keys, `${label}.actor`);
  decimal(value.actor.id, `${label}.actor.id`);
  boundedString(value.actor.login, `${label}.actor.login`, 128);
  oneOf(value.actor.type, ["User", "Bot"], `${label}.actor.type`);
  bool(value.push, `${label}.push`);
}

function validateArtifact(value, index) {
  const label = `artifacts[${index}]`;
  exactObject(value, V2_REDUCER_INPUT_SCHEMA.artifact.exact_keys, label);
  decimal(value.id, `${label}.id`);
  githubPullArtifactUrl(value.url, `${label}.url`);
  oneOf(value.kind, V2_REDUCER_INPUT_SCHEMA.artifact.kind, `${label}.kind`);
  oneOf(value.channel, V2_REDUCER_INPUT_SCHEMA.artifact.channel, `${label}.channel`);
  nullableDecimal(value.request_id, `${label}.request_id`);
  timestamp(value.created_at, `${label}.created_at`);
  sha(value.commit_oid, `${label}.commit_oid`);
  bool(value.stable, `${label}.stable`);
  const findingIds = array(value.finding_ids, `${label}.finding_ids`);
  findingIds.forEach((item, findingIndex) =>
    boundedString(item, `${label}.finding_ids[${findingIndex}]`, 128));
  if (value.kind === "terminal-findings" && findingIds.length === 0) {
    throw new Error(`${label}.finding_ids must be non-empty for terminal-findings`);
  }
  if (value.kind !== "terminal-findings" && findingIds.length !== 0) {
    throw new Error(`${label}.finding_ids must be empty unless kind is terminal-findings`);
  }
  if (new Set(findingIds).size !== findingIds.length) {
    throw new Error(`${label}.finding_ids must not contain duplicates`);
  }
}

function validateThread(value, index) {
  const label = `threads[${index}]`;
  exactObject(value, V2_REDUCER_INPUT_SCHEMA.thread.exact_keys, label);
  boundedString(value.id, `${label}.id`, 256);
  boundedString(value.finding_id, `${label}.finding_id`, 128);
  oneOf(value.kind, V2_REDUCER_INPUT_SCHEMA.thread.kind, `${label}.kind`);
  timestamp(value.created_at, `${label}.created_at`);
  bool(value.is_resolved, `${label}.is_resolved`);
  nullableTimestamp(value.resolution_observed_at, `${label}.resolution_observed_at`);
  bool(value.stable, `${label}.stable`);
  if (value.is_resolved !== (value.resolution_observed_at !== null)) {
    throw new Error(
      `${label}.resolved state requires a controller-bound point-read observation time`,
    );
  }
  if (value.kind === "top-level" && value.is_resolved) {
    throw new Error(`${label}.top-level findings close only through addressed acknowledgements`);
  }
}

function validateAcknowledgement(value, index) {
  const label = `acknowledgements[${index}]`;
  exactObject(value, V2_REDUCER_INPUT_SCHEMA.acknowledgement.exact_keys, label);
  decimal(value.id, `${label}.id`);
  oneOf(value.kind, V2_REDUCER_INPUT_SCHEMA.acknowledgement.kind, `${label}.kind`);
  nullableDecimal(value.request_id, `${label}.request_id`);
  if (value.kind === "addressed") {
    boundedString(value.finding_id, `${label}.finding_id`, 128);
  } else if (value.finding_id !== null) {
    throw new Error(`${label}.finding_id must be null unless kind is addressed`);
  }
  timestamp(value.created_at, `${label}.created_at`);
  sha(value.commit_oid, `${label}.commit_oid`);
  bool(value.exact_provider, `${label}.exact_provider`);
  bool(value.stable, `${label}.stable`);
  if (value.kind === "addressed" && value.exact_provider) {
    throw new Error(`${label}.addressed authority must be a permitted human write`);
  }
  if (value.kind !== "addressed" && !value.exact_provider) {
    throw new Error(`${label}.${value.kind} authority must be the exact provider`);
  }
}

function validateNoStartObservation(value, index) {
  const label = `no_start_observations[${index}]`;
  exactObject(value, V2_REDUCER_INPUT_SCHEMA.no_start_observation.exact_keys, label);
  decimal(value.id, `${label}.id`);
  githubPullArtifactUrl(value.url, `${label}.url`);
  decimal(value.request_id, `${label}.request_id`);
  boundedString(value.body, `${label}.body`, 256);
  timestamp(value.carrier_created_at, `${label}.carrier_created_at`);
  bool(value.exact_provider, `${label}.exact_provider`);
  bool(value.stable, `${label}.stable`);
  timestamp(value.first_seen_at, `${label}.first_seen_at`);
  timestamp(value.confirmed_at, `${label}.confirmed_at`);
  decimal(value.first_run_id, `${label}.first_run_id`);
  decimal(value.confirmation_run_id, `${label}.confirmation_run_id`);
  decimal(value.request_run_id, `${label}.request_run_id`);
  if (!(
    BigInt(value.request_run_id) < BigInt(value.first_run_id) &&
    BigInt(value.first_run_id) < BigInt(value.confirmation_run_id)
  )) {
    throw new Error(`${label} must bind three distinct ordered workflow runs`);
  }
}

function validateGeneration(value, label) {
  oneOf(value.generation_kind, ["automatic", "manual"], `${label}.generation_kind`);
  positiveSafeInteger(value.generation_index, `${label}.generation_index`);
  const maximum = value.generation_kind === "automatic" ? 3 : 64;
  if (value.generation_index > maximum) {
    throw new Error(`${label}.generation_index exceeds the ${value.generation_kind} limit`);
  }
  exact(
    value.generation_id,
    `${value.generation_kind}:${value.generation_index}`,
    `${label}.generation_id`,
  );
  exact(value.kind, value.generation_kind, `${label}.generation_kind`);
}

function validateGenerationAdmission(value, index) {
  const label = `generation_admissions[${index}]`;
  exactObject(
    value,
    V2_REDUCER_INPUT_SCHEMA.generation_admission.exact_keys,
    label,
  );
  const priorIndex = index + 1;
  const nextIndex = priorIndex + 1;
  exact(
    value.prior_generation_id,
    `automatic:${priorIndex}`,
    `${label}.prior_generation_id`,
  );
  exact(
    value.next_generation_id,
    `automatic:${nextIndex}`,
    `${label}.next_generation_id`,
  );
  decimal(value.prior_request_id, `${label}.prior_request_id`);
  decimal(value.next_request_id, `${label}.next_request_id`);
  sha(value.head_oid, `${label}.head_oid`);
  sha(
    value.prior_request_binding_record_oid,
    `${label}.prior_request_binding_record_oid`,
  );
  sha(
    value.recovery_transition_record_oid,
    `${label}.recovery_transition_record_oid`,
  );
  digest(
    value.recovery_transition_payload_digest,
    `${label}.recovery_transition_payload_digest`,
  );
  sha(
    value.next_request_binding_record_oid,
    `${label}.next_request_binding_record_oid`,
  );
  digest(
    value.next_request_binding_payload_digest,
    `${label}.next_request_binding_payload_digest`,
  );
  timestamp(value.transition_server_time, `${label}.transition_server_time`);
  exactObject(
    value.ledger_order,
    V2_REDUCER_INPUT_SCHEMA.generation_admission.ledger_order.exact_keys,
    `${label}.ledger_order`,
  );
  const priorOrder = value.ledger_order.prior_request_binding_index;
  const transitionOrder = value.ledger_order.recovery_transition_index;
  const nextOrder = value.ledger_order.next_request_binding_index;
  nonNegativeSafeInteger(priorOrder, `${label}.ledger_order.prior_request_binding_index`);
  nonNegativeSafeInteger(transitionOrder, `${label}.ledger_order.recovery_transition_index`);
  nonNegativeSafeInteger(nextOrder, `${label}.ledger_order.next_request_binding_index`);
  if (!(priorOrder < transitionOrder && transitionOrder < nextOrder)) {
    throw new Error(`${label}.ledger_order must be strictly causal`);
  }
}

function validateEvidenceBasis(value) {
  if (value === null) {
    return;
  }
  exactObject(value, V2_REDUCER_OUTPUT_SCHEMA.evidence_basis.exact_keys, "report.evidence_basis");
  oneOf(value.kind, V2_REDUCER_OUTPUT_SCHEMA.evidence_basis.kind, "report.evidence_basis.kind");
  nullableOneOf(
    value.scope_assurance,
    ["whole-pr-contractual", "artifact-publication-only"],
    "report.evidence_basis.scope_assurance",
  );
  const expectedAssurance = ARTIFACT_PUBLICATION_BASIS_KINDS.has(value.kind)
    ? "artifact-publication-only"
    : "whole-pr-contractual";
  if (value.scope_assurance !== expectedAssurance) {
    throw new Error(
      `report.evidence_basis.${value.kind} must use ${expectedAssurance} scope assurance`,
    );
  }
  nullableDecimal(value.artifact_id, "report.evidence_basis.artifact_id");
  boundedString(value.summary, "report.evidence_basis.summary", 256);
  validateAuthorityReceipt(value.authority_receipt);
}

function validateAuthorityReceipt(value) {
  exactObject(
    value,
    [
      "selected_request",
      "selected_artifact",
      "pagination_sha256",
      "final_reread_sha256",
      "recovery",
      "selected_generation",
    ],
    "report.evidence_basis.authority_receipt",
  );
  validateSelectedAuthorityObject(
    value.selected_request,
    "report.evidence_basis.authority_receipt.selected_request",
  );
  if (value.selected_generation === null) {
    if (value.selected_request !== null) {
      throw new Error("report evidence selected request requires selected_generation");
    }
  } else {
    exactObject(
      value.selected_generation,
      ["id", "kind", "index"],
      "report.evidence_basis.authority_receipt.selected_generation",
    );
    oneOf(
      value.selected_generation.kind,
      ["automatic", "manual"],
      "report.evidence_basis.authority_receipt.selected_generation.kind",
    );
    positiveSafeInteger(
      value.selected_generation.index,
      "report.evidence_basis.authority_receipt.selected_generation.index",
    );
    exact(
      value.selected_generation.id,
      `${value.selected_generation.kind}:${value.selected_generation.index}`,
      "report.evidence_basis.authority_receipt.selected_generation.id",
    );
    if (value.selected_request === null) {
      throw new Error("report evidence selected_generation requires selected request");
    }
  }
  validateSelectedAuthorityObject(
    value.selected_artifact,
    "report.evidence_basis.authority_receipt.selected_artifact",
  );
  digest(
    value.pagination_sha256,
    "report.evidence_basis.authority_receipt.pagination_sha256",
  );
  digest(
    value.final_reread_sha256,
    "report.evidence_basis.authority_receipt.final_reread_sha256",
  );
  if (value.recovery !== null) {
    exactObject(
      value.recovery,
      ["finding_ids", "closure_ids", "new_request_id", "completion_id"],
      "report.evidence_basis.authority_receipt.recovery",
    );
    const findingIds = array(
      value.recovery.finding_ids,
      "report.evidence_basis.authority_receipt.recovery.finding_ids",
    );
    const closureIds = array(
      value.recovery.closure_ids,
      "report.evidence_basis.authority_receipt.recovery.closure_ids",
    );
    if (findingIds.length === 0 || findingIds.length !== closureIds.length) {
      throw new Error("report evidence recovery must bind equal non-empty finding and closure lists");
    }
    findingIds.forEach((id, index) =>
      boundedString(id, `report evidence recovery finding_ids[${index}]`, 128));
    closureIds.forEach((id, index) =>
      boundedString(id, `report evidence recovery closure_ids[${index}]`, 256));
    if (
      new Set(findingIds).size !== findingIds.length ||
      new Set(closureIds).size !== closureIds.length
    ) {
      throw new Error("report evidence recovery finding and closure lists must be unique");
    }
    decimal(value.recovery.new_request_id, "report evidence recovery.new_request_id");
    decimal(value.recovery.completion_id, "report evidence recovery.completion_id");
  }
}

function validateSelectedAuthorityObject(value, label) {
  if (value === null) {
    return;
  }
  exactObject(value, ["id", "url", "created_at"], label);
  decimal(value.id, `${label}.id`);
  githubPullArtifactUrl(value.url, `${label}.url`);
  timestamp(value.created_at, `${label}.created_at`);
}

function githubPullArtifactUrl(value, label) {
  boundedString(value, label, 2048);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a canonical GitHub pull-request artifact URL`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "github.com" ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.href !== value ||
    !/^\/[^/]+\/[^/]+\/pull\/[1-9][0-9]*$/u.test(parsed.pathname) ||
    !/^#(?:issuecomment-[1-9][0-9]*|pullrequestreview-[1-9][0-9]*|discussion_r[1-9][0-9]*)$/u.test(parsed.hash)
  ) {
    throw new Error(`${label} must be a canonical GitHub pull-request artifact URL`);
  }
}

function validateProviderBasisPair(profile, kind) {
  if (profile === null) {
    if (kind !== null && kind !== "configuration" && kind !== "input") {
      throw new Error("report null provider profile has an incompatible evidence basis");
    }
    return;
  }
  if (profile === "unknown") {
    if (["terminal-clean", "terminal-findings", "thumbs-up-clean", "no-start-rejection"].includes(kind)) {
      throw new Error("report unknown provider profile has a conclusive evidence basis");
    }
    return;
  }
  const allowed = profile === "thumbs-up-clean"
    ? ["thumbs-up-clean"]
    : profile === "no-start-rejection"
      ? ["no-start-rejection"]
      : profile === "terminal-payload"
        ? [
          "terminal-clean",
          "terminal-findings",
          "unresolved-inline-finding",
          "malformed-evidence",
          "unknown-terminal",
          "stable-evidence-blocker",
          "input",
        ]
        : [
          "terminal-clean",
          "terminal-findings",
          "unresolved-inline-finding",
          "malformed-evidence",
          "unknown-terminal",
          "stable-evidence-blocker",
          "input",
        ];
  if (!allowed.includes(kind)) {
    throw new Error("report provider profile has an incompatible evidence basis");
  }
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must use the closed key set: ${expected.join(", ")}`);
  }
}

function uniqueField(values, key, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value[key])) {
      throw new Error(`${label} must not contain duplicate ${key} values`);
    }
    seen.add(value[key]);
  }
}

function array(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  return value;
}

function bool(value, label) {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean`);
  }
}

function boundedString(value, label, maximum) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value)) {
    throw new Error(`${label} must be a non-empty string of at most ${maximum} code units`);
  }
}

function decimal(value, label) {
  if (typeof value !== "string" || value.length > 32 || !DECIMAL.test(value)) {
    throw new Error(`${label} must be a canonical decimal string`);
  }
}

function nullableDecimal(value, label) {
  if (value !== null) {
    decimal(value, label);
  }
}

function sha(value, label) {
  if (typeof value !== "string" || !FULL_SHA.test(value)) {
    throw new Error(`${label} must be an exact lower-case 40-character SHA`);
  }
}

function nullableSha(value, label) {
  if (value !== null) {
    sha(value, label);
  }
}

function digest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`${label} must be an exact sha256 digest`);
  }
}

function timestamp(value, label) {
  if (typeof value !== "string" || !STRICT_UTC_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be a strict UTC timestamp`);
  }
}

function nullableTimestamp(value, label) {
  if (value !== null) {
    timestamp(value, label);
  }
}

function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new Error(`${label} must be one of: ${allowed.map(String).join(", ")}`);
  }
}

function nullableOneOf(value, allowed, label) {
  if (value !== null) {
    oneOf(value, allowed, label);
  }
}

function exact(value, expected, label) {
  if (value !== expected) {
    throw new Error(`${label} must be exactly ${String(expected)}`);
  }
}

function nonNegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

function positiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
  }
  return value;
}
