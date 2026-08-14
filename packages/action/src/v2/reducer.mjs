import {
  TERMINAL_V2_DECISIONS,
  V2_DECISIONS,
  V2_FRESHNESS_ASSURANCES,
  V2_MANUAL_REVIEW_REQUEST,
  V2_NO_START_BODIES,
  V2_PROVIDER_PROFILES,
  V2_REDUCER_INPUT_SCHEMA,
  V2_REDUCER_OPTIONS_SCHEMA,
  V2_REDUCER_OUTPUT_SCHEMA,
  V2_SCHEMA_VERSION,
  V2_SELECTION_INTENTS,
  V2_SELECTION_STATUSES,
  V2_SERVER_ENFORCEMENT_STATUSES,
  V2_STATUS_CONTEXT,
  V2_STATUS_TARGET_MODES,
  V2_REQUEST_POLICY_STATUSES,
  assertV2ReducerInput,
  assertV2ReducerOptions,
  assertV2ReducerOutput,
} from "./schema.mjs";

export {
  TERMINAL_V2_DECISIONS,
  V2_DECISIONS,
  V2_FRESHNESS_ASSURANCES,
  V2_MANUAL_REVIEW_REQUEST,
  V2_NO_START_BODIES,
  V2_PROVIDER_PROFILES,
  V2_REDUCER_INPUT_SCHEMA,
  V2_REDUCER_OPTIONS_SCHEMA,
  V2_REDUCER_OUTPUT_SCHEMA,
  V2_SCHEMA_VERSION,
  V2_SELECTION_INTENTS,
  V2_SELECTION_STATUSES,
  V2_SERVER_ENFORCEMENT_STATUSES,
  V2_STATUS_CONTEXT,
  V2_STATUS_TARGET_MODES,
  V2_REQUEST_POLICY_STATUSES,
  assertV2ReducerInput,
  assertV2ReducerOptions,
  assertV2ReducerOutput,
};

const NO_START_CONFIRMATION_MS = 15 * 60 * 1000;
const AUTOMATIC_REQUEST_LIMIT = 3;
const MANUAL_REQUEST_LIMIT = 64;

/**
 * Reduce one sealed, normalized provider snapshot into a deterministic report.
 *
 * The function intentionally has no I/O, environment, or clock dependency.
 * Every time, permission, pagination, and stability fact used below is supplied
 * by the caller and validated against the exported closed schema.
 */
export function reduceV2Snapshot(snapshot, options) {
  assertV2ReducerInput(snapshot);
  assertV2ReducerOptions(options);

  const context = createContext(snapshot, options);

  if (snapshot.selection.intent === "disabled" || !snapshot.selection.eligible) {
    return finish(context, {
      selection_status: "not-selected",
      selection_reason: snapshot.selection.reason,
      server_status: "not-applicable",
      request_policy: requestPolicy("not-applicable", null, "Review gate was not selected"),
      provider_profile: null,
      evidence_basis: null,
      decision: "not-selected",
    });
  }

  if (snapshot.review_epoch.lifecycle !== "open") {
    return finish(context, {
      selection_reason: "Pull request is not open",
      server_status: serverStatus(snapshot.server_enforcement),
      request_policy: requestPolicy("not-applicable", null, "Pull request is not open"),
      provider_profile: null,
      evidence_basis: basis(
        snapshot,
        "input",
        null,
        null,
        "Pull request lifecycle is not open",
      ),
      decision: "blocked-input",
    });
  }

  // Both public status modes require an established review epoch. Head mode
  // does not require a synthetic test merge, but it still must not evaluate
  // provider evidence before the canonical base, head, and merge-base tuple is
  // bound. This is a pre-provider input blocker, so no provider profile or
  // evidence basis exists yet.
  if (!epochFoundationIsBound(snapshot.review_epoch)) {
    return finish(context, {
      selection_reason: "Review epoch does not bind the current base, head, and merge-base",
      server_status: serverStatus(snapshot.server_enforcement),
      request_policy: requestPolicy(
        "not-applicable",
        null,
        "Provider evaluation is blocked before the review epoch is established",
      ),
      provider_profile: null,
      evidence_basis: null,
      decision: "blocked-input",
    });
  }

  if (!serverEnforcementIsReady(snapshot.server_enforcement)) {
    return finish(context, {
      selection_reason: "Required server-side workflow or ruleset binding is missing",
      server_status: "not-enforced",
      request_policy: requestPolicy(
        "not-applicable",
        null,
        "Provider evaluation is blocked by server configuration",
      ),
      provider_profile: null,
      evidence_basis: basis(
        snapshot,
        "configuration",
        null,
        null,
        "Workflow, required ruleset, and GitHub App binding must all be enabled",
      ),
      decision: "blocked-configuration",
    });
  }

  const requestEvaluation = evaluateRequests(snapshot);
  const evidence = evaluateProviderEvidence(snapshot, requestEvaluation);

  // Terminal carrier precedence is independent from request production. A
  // request budget, generation-admission, sidecar, reaction, or no-start
  // anomaly may degrade those planes, but it cannot erase one independently
  // stable current-scope terminal outcome.
  if (evidence.terminal_problem !== null) {
    return finish(context, {
      request_policy: requestEvaluation.policy,
      provider_profile: evidence.profile,
      evidence_basis: evidence.terminal_problem,
      decision: "inconclusive",
    });
  }

  // A trustworthy finding is negative evidence even when another inventory is
  // incomplete. Positive completion, by contrast, requires the entire sealed
  // snapshot to be complete and stable.
  if (evidence.blocking_finding !== null) {
    return finish(context, {
      request_policy: requestEvaluation.policy,
      provider_profile: evidence.profile,
      evidence_basis: evidence.blocking_finding,
      decision: "findings",
    });
  }

  if (
    options.status_target_mode === "test-merge-with-head-sentinel" &&
    !epochIsBound(snapshot.review_epoch)
  ) {
    const selectedTerminal = evidence.terminal_clean === null
      ? null
      : snapshot.artifacts.find(
        (artifact) => artifact.id === evidence.terminal_clean.artifact_id,
      ) ?? null;
    const stableCompleteTerminal =
      snapshot.scope_stable &&
      snapshot.complete &&
      allInventoriesComplete(snapshot.inventories)
        ? selectedTerminal
        : null;
    return finish(context, {
      selection_reason: "Review epoch does not bind the current merge-base and ordered parents",
      server_status: serverStatus(snapshot.server_enforcement),
      request_policy: requestEvaluation.policy,
      provider_profile: stableCompleteTerminal === null
        ? "unknown"
        : evidence.profile,
      evidence_basis: basis(
        snapshot,
        "input",
        null,
        stableCompleteTerminal?.id ?? null,
        "Review epoch does not bind base, head, merge-base, and potential merge",
        { selectedArtifact: stableCompleteTerminal },
      ),
      decision: "blocked-input",
    });
  }

  if (!snapshot.scope_stable) {
    return finish(context, {
      request_policy: requestEvaluation.policy,
      provider_profile: "unknown",
      evidence_basis: basis(
        snapshot,
        "unstable-scope",
        null,
        null,
        "Initial and final pull request scope projections differ",
      ),
      decision: "inconclusive",
    });
  }

  if (!snapshot.complete || !allInventoriesComplete(snapshot.inventories)) {
    return finish(context, {
      request_policy: requestEvaluation.policy,
      provider_profile: "unknown",
      evidence_basis: basis(
        snapshot,
        "incomplete-snapshot",
        null,
        null,
        "Provider evidence pagination or final reread is incomplete",
      ),
      decision: "inconclusive",
    });
  }

  if (evidence.terminal_clean !== null) {
    return finish(context, {
      request_policy: requestEvaluation.policy,
      provider_profile: evidence.profile,
      evidence_basis: evidence.terminal_clean,
      decision: "clean",
    });
  }

  if (evidence.unstable_evidence !== null) {
    return finish(context, {
      request_policy: requestEvaluation.policy,
      provider_profile: evidence.profile,
      evidence_basis: evidence.unstable_evidence,
      decision: "inconclusive",
    });
  }

  if (requestEvaluation.limit_failure !== null) {
    return finish(context, {
      request_policy: requestEvaluation.policy,
      provider_profile: "unknown",
      evidence_basis: basis(
        snapshot,
        "input",
        null,
        null,
        requestEvaluation.limit_failure,
      ),
      decision: "inconclusive",
    });
  }

  if (evidence.no_start !== null) {
    const explicitlyRequested = snapshot.selection.intent === "explicit";
    return finish(context, {
      request_policy: requestEvaluation.policy,
      provider_profile: "no-start-rejection",
      evidence_basis: evidence.no_start,
      decision: explicitlyRequested ? "blocked-configuration" : "skipped-unavailable",
    });
  }

  if (evidence.accepted_plus_one !== null) {
    return finish(context, {
      request_policy: requestEvaluation.policy,
      provider_profile: evidence.profile,
      evidence_basis: evidence.accepted_plus_one,
      decision: "clean",
    });
  }

  if (requestEvaluation.selected === null) {
    if (requestEvaluation.automatic_capacity_exhausted) {
      return finish(context, {
        request_policy: requestEvaluation.policy,
        provider_profile: "unknown",
        evidence_basis: basis(
          snapshot,
          "input",
          null,
          null,
          "Automatic request budget is exhausted for this head",
        ),
        decision: "inconclusive",
      });
    }
    return finish(context, {
      request_policy: requestEvaluation.policy,
      provider_profile: evidence.profile,
      evidence_basis: null,
      decision: "pending",
    });
  }

  return finish(context, {
    request_policy: requestEvaluation.policy,
    provider_profile: evidence.profile,
    evidence_basis: null,
    decision: "pending",
  });
}

export const reduceReviewGateV2 = reduceV2Snapshot;

function createContext(snapshot, options) {
  return {
    snapshot,
    options,
    selection_status: "selected",
    selection_reason: snapshot.selection.reason,
    server_status: serverStatus(snapshot.server_enforcement),
  };
}

function finish(context, overrides) {
  const snapshot = context.snapshot;
  const mode = context.options.status_target_mode;
  const report = {
    schema_version: V2_SCHEMA_VERSION,
    selection: {
      status: overrides.selection_status ?? context.selection_status,
      intent: snapshot.selection.intent,
      reason: overrides.selection_reason ?? context.selection_reason,
    },
    server_enforcement: {
      status: overrides.server_status ?? context.server_status,
      controller_available: snapshot.server_enforcement.controller_available,
      workflow_present: snapshot.server_enforcement.workflow_present,
      workflow_compatible: snapshot.server_enforcement.workflow_compatible,
      ruleset_required: snapshot.server_enforcement.ruleset_required,
      ruleset_compatible: snapshot.server_enforcement.ruleset_compatible,
      app_bound: snapshot.server_enforcement.app_bound,
    },
    review_epoch: structuredClone(snapshot.review_epoch),
    request_policy: overrides.request_policy,
    provider_profile: overrides.provider_profile,
    provider_input_lineage: "unavailable",
    evidence_basis: overrides.evidence_basis,
    status_target: {
      mode,
      sha: mode === "head"
        ? snapshot.review_epoch.head_oid
        : epochIsBound(snapshot.review_epoch)
          ? snapshot.review_epoch.merge_oid
          : null,
      context: context.options.status_context,
    },
    decision: overrides.decision,
    freshness_assurance: "point-in-time",
    snapshot_fingerprint: snapshot.snapshot_fingerprint,
  };
  assertV2ReducerOutput(report);
  return report;
}

function epochFoundationIsBound(epoch) {
  return (
    epoch.lifecycle === "open" &&
    epoch.base_oid !== null &&
    epoch.head_oid !== null &&
    epoch.merge_base_oid !== null
  );
}

function epochIsBound(epoch) {
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

function serverEnforcementIsReady(value) {
  return value.controller_available &&
    (!value.workflow_present || value.workflow_compatible) &&
    (
      !value.ruleset_required || (
        value.workflow_present &&
        value.workflow_compatible &&
        value.ruleset_compatible &&
        value.app_bound
      )
  );
}

function serverStatus(value) {
  return value.ruleset_required && serverEnforcementIsReady(value)
    ? "enforced"
    : "not-enforced";
}

function evaluateRequests(snapshot) {
  const currentRequests = snapshot.requests.filter(
    (request) => request.head_oid === snapshot.review_epoch.head_oid,
  );
  const visibleAutomatic = currentRequests.filter((request) => request.kind === "automatic").length;
  const visibleManual = currentRequests.filter((request) => request.kind === "manual").length;
  let limitFailure = null;
  if (
    snapshot.budget.automatic_requests_on_head < visibleAutomatic ||
    snapshot.budget.manual_requests_in_epoch < visibleManual
  ) {
    limitFailure = "Request budget counters are smaller than the sealed request inventory";
  } else if (
    snapshot.budget.automatic_requests_on_head >
    snapshot.budget.automatic_reservations_on_head
  ) {
    limitFailure = "Visible automatic requests exceed consumed generation reservations";
  } else if (snapshot.budget.automatic_reservations_on_head > AUTOMATIC_REQUEST_LIMIT) {
    limitFailure = `Automatic generation reservations exceed the per-head limit of ${AUTOMATIC_REQUEST_LIMIT}`;
  } else if (snapshot.budget.manual_requests_in_epoch > MANUAL_REQUEST_LIMIT) {
    limitFailure = `Manual requests exceed the per-review-epoch limit of ${MANUAL_REQUEST_LIMIT}`;
  }

  const authoritative = admittedGenerations(snapshot, currentRequests);
  const admissionFailure = requestInventoryAdmissionFailure(
    currentRequests,
    authoritative,
  );
  const ordered = [...authoritative].sort(compareEvidence);
  const selected = ordered.at(-1) ?? null;
  let status = "compliant";
  let reason = selected === null
    ? "No current-epoch request has been observed"
      : ordered.length === 1
      ? "Exactly one current-epoch request was observed"
      : "Multiple admitted generations were observed; the latest generation is authoritative";

  if (selected === null && currentRequests.length > 0) {
    status = "unknown";
    reason = "No observed request has an admitted generation and recovery chain";
  }

  if (selected !== null && !requestHasStableExactShape(selected)) {
    status = "unknown";
    reason = "Selected request is edited, unstable, uncontrolled, or has a non-exact body";
  }

  if (selected?.kind === "manual" && !manualPermissionIsAccepted(selected)) {
    status = "unknown";
    reason = "Manual request actor permission or identity is not stable across both point reads";
  }

  if (admissionFailure !== null) {
    status = "unknown";
    reason = admissionFailure;
  }

  if (limitFailure !== null) {
    status = "unknown";
    reason = limitFailure;
  }

  const permissionFields = selected?.kind === "manual"
    ? {
        permission_assurance: "point-in-time-only",
        request_time_permission: "unproven",
        permission_aba_excluded: false,
      }
    : {
        permission_assurance: null,
        request_time_permission: null,
        permission_aba_excluded: null,
      };

  return {
    selected,
    policy: requestPolicy(status, selected, reason, permissionFields),
    selected_is_authoritative:
      selected !== null &&
      status === "compliant" &&
      requestHasStableExactShape(selected) &&
      (selected.kind !== "manual" || manualPermissionIsAccepted(selected)),
    automatic_capacity_exhausted:
      snapshot.budget.automatic_reservations_on_head >= AUTOMATIC_REQUEST_LIMIT,
    limit_failure: limitFailure,
  };
}

function requestInventoryAdmissionFailure(requests, admitted) {
  const admittedSet = new Set(admitted);
  if (
    requests.length === admitted.length &&
    requests.every((request) => admittedSet.has(request))
  ) {
    return null;
  }
  const generationCounts = new Map();
  for (const request of requests) {
    generationCounts.set(
      request.generation_id,
      (generationCounts.get(request.generation_id) ?? 0) + 1,
    );
  }
  if ([...generationCounts.values()].some((count) => count !== 1)) {
    return "The complete request inventory contains a duplicate generation identity";
  }
  return "The complete request inventory contains an unadmitted, unstable, or non-contiguous generation";
}

function admittedGenerations(snapshot, requests) {
  const byGeneration = new Map();
  for (const request of requests) {
    const existing = byGeneration.get(request.generation_id) ?? [];
    existing.push(request);
    byGeneration.set(request.generation_id, existing);
  }
  const candidates = [...byGeneration.values()]
    .filter((group) => group.length === 1)
    .map(([request]) => request)
    .filter((request) => requestHasStableExactShape(request))
    .sort((left, right) =>
      left.generation_kind.localeCompare(right.generation_kind) ||
      left.generation_index - right.generation_index ||
      compareEvidence(left, right));
  const admitted = [];
  for (const request of candidates) {
    if (request.kind === "manual") {
      if (manualPermissionIsAccepted(request)) admitted.push(request);
      continue;
    }
    if (request.generation_index === 1) {
      admitted.push(request);
      continue;
    }
    const prior = admitted.find(
      (candidate) =>
        candidate.kind === "automatic" &&
        candidate.generation_index === request.generation_index - 1,
    );
    if (prior !== undefined && generationFindingClosureIsProven(snapshot, prior, request)) {
      admitted.push(request);
    }
  }
  return admitted;
}

function generationFindingClosureIsProven(snapshot, priorRequest, newRequest) {
  const findings = snapshot.artifacts.filter(
    (artifact) =>
      artifact.kind === "terminal-findings" &&
      artifact.stable &&
      artifact.request_id === priorRequest.id &&
      artifact.commit_oid === snapshot.review_epoch.head_oid,
  );
  if (findings.length === 0) return false;
  return findings.every((artifact) =>
    artifact.finding_ids.every((findingId) => {
      const thread = snapshot.threads.find((candidate) => candidate.finding_id === findingId) ?? null;
      const closure = findingClosure(snapshot, artifact, findingId, thread);
      return closure !== null && compareTimestamp(newRequest.created_at, closure.created_at) > 0;
    }));
}

function requestHasStableExactShape(request) {
  return (
    request.body === V2_MANUAL_REVIEW_REQUEST &&
    request.created_at === request.updated_at &&
    request.stable &&
    (request.kind === "manual" || request.controlled)
  );
}

function manualPermissionIsAccepted(request) {
  const permission = request.actor_permission;
  if (
    permission === null ||
    permission.assurance !== "point-in-time-only" ||
    permission.request_time_permission !== "unproven" ||
    permission.permission_aba_excluded !== false ||
    !permission.initial.push ||
    !permission.final.push
  ) {
    return false;
  }
  const initial = permission.initial.actor;
  const final = permission.final.actor;
  return (
    initial.id === final.id &&
    initial.login === final.login &&
    initial.type === final.type &&
    compareTimestamp(permission.initial.observed_at, permission.final.observed_at) <= 0
  );
}

function evaluateProviderEvidence(snapshot, requestEvaluation) {
  const currentArtifacts = snapshot.artifacts.filter(
    (artifact) => artifact.commit_oid === snapshot.review_epoch.head_oid,
  );
  const terminal = currentArtifacts.filter((artifact) =>
    artifact.kind.startsWith("terminal-"));
  const malformed = currentArtifacts.filter((artifact) => artifact.kind === "malformed");
  const terminalSelection = selectTerminalOutcome([...terminal, ...malformed]);
  const providerAcknowledgements = snapshot.acknowledgements.filter(
    (acknowledgement) => acknowledgement.exact_provider,
  );
  const hasReaction = providerAcknowledgements.some(
    (acknowledgement) => acknowledgement.kind === "plus-one" || acknowledgement.kind === "eyes",
  );
  const profile = terminal.length > 0
    ? hasReaction
      ? "mixed"
      : "terminal-payload"
    : hasReaction
      ? "unknown"
      : "unknown";

  const unstableNonterminal = [
    ...snapshot.requests,
    ...snapshot.threads,
    ...snapshot.acknowledgements,
    ...snapshot.no_start_observations,
  ].find((item) => item.stable === false);
  const selectedMalformed = terminalSelection.selected?.kind === "malformed"
    ? terminalSelection.selected
    : null;
  const terminalProblem = terminalSelection.unstable !== null
    ? basis(
        snapshot,
        "unknown-terminal",
        "artifact-publication-only",
        terminalSelection.unstable.id,
        "The canonically selected terminal carrier set is not stable across point reads",
        { selectedArtifact: terminalSelection.unstable },
      )
    : terminalSelection.conflict !== null
      ? basis(
          snapshot,
          "malformed-evidence",
          "artifact-publication-only",
          terminalSelection.conflict.id,
          "Equal-time terminal carriers from different channels cannot be ordered",
          { selectedArtifact: terminalSelection.conflict },
        )
      : selectedMalformed !== null
        ? basis(
            snapshot,
            "malformed-evidence",
            "artifact-publication-only",
            selectedMalformed.id,
            "The selected provider terminal carrier has malformed closed-schema evidence",
            { selectedArtifact: selectedMalformed },
          )
        : null;
  const unstableEvidence = unstableNonterminal !== undefined
    ? basis(
        snapshot,
        "stable-evidence-blocker",
        null,
        null,
        "Initial and final nonterminal evidence projections are not stable",
      )
    : null;

  const terminalClean = selectTerminalClean(
    snapshot,
    terminal,
    requestEvaluation,
    profile,
    terminalSelection.selected,
  );
  const acceptedPlusOne = terminalClean === null
    ? selectAcceptedPlusOne(snapshot, terminal, requestEvaluation)
    : null;
  const blockingFinding = findBlockingFinding(
    snapshot,
    terminal,
    terminalClean,
    terminalSelection.selected,
    terminalSelection.conflict,
  );
  const noStart = terminal.length === 0 && malformed.length === 0 &&
      providerAcknowledgements.length === 0
    ? selectNoStart(snapshot, requestEvaluation)
    : null;

  return {
    profile:
      noStart !== null
        ? "no-start-rejection"
        : acceptedPlusOne !== null
          ? terminal.length > 0
            ? "mixed"
            : "thumbs-up-clean"
          : profile,
    blocking_finding: blockingFinding,
    terminal_problem: terminalProblem,
    unstable_evidence: unstableEvidence,
    terminal_clean: terminalClean,
    accepted_plus_one: acceptedPlusOne,
    no_start: noStart,
  };
}

function findBlockingFinding(
  snapshot,
  terminal,
  terminalClean,
  selectedTerminal,
  terminalConflict,
) {
  const findingArtifacts = terminal.filter(
    (artifact) => artifact.kind === "terminal-findings" && artifact.stable,
  );
  if (
    findingArtifacts.length === 0 ||
    terminalClean !== null ||
    terminalConflict !== null ||
    selectedTerminal?.kind === "malformed"
  ) {
    return null;
  }
  for (const artifact of [...findingArtifacts].sort(compareEvidence).reverse()) {
    for (const findingId of artifact.finding_ids) {
      const thread = snapshot.threads.find((candidate) => candidate.finding_id === findingId) ?? null;
      const closure = findingClosure(snapshot, artifact, findingId, thread);
      if (closure === null) {
        return basis(
          snapshot,
          thread?.kind === "inline" ? "unresolved-inline-finding" : "terminal-findings",
          "artifact-publication-only",
          artifact.id,
          thread?.kind === "inline"
            ? "An exact-provider inline finding has no stable resolved point-read receipt"
            : "An exact-provider top-level finding has no strictly later permitted human address command",
          { selectedArtifact: artifact },
        );
      }
    }
  }
  const latest = [...findingArtifacts].sort(compareEvidence).at(-1);
  return basis(
    snapshot,
    "terminal-findings",
    "artifact-publication-only",
    latest.id,
    "Closed findings still require a new exact request and a strictly later clean completion",
    { selectedArtifact: latest },
  );
}

function selectTerminalClean(
  snapshot,
  terminal,
  requestEvaluation,
  profile,
  selectedTerminal,
) {
  const latestTerminal = selectedTerminal;
  if (latestTerminal?.kind !== "terminal-clean" || !latestTerminal.stable) {
    return null;
  }
  const recoversPriorFindings = terminal.some(
    (artifact) => artifact.kind === "terminal-findings" && artifact.stable,
  );
  if (
    recoversPriorFindings &&
    (
      requestEvaluation.selected === null ||
      !requestEvaluation.selected_is_authoritative ||
      latestTerminal.request_id !== requestEvaluation.selected.id
    )
  ) {
    return null;
  }
  const recovery = completionRecoversFindings(
    snapshot,
    terminal,
    requestEvaluation,
    latestTerminal.created_at,
    latestTerminal.id,
  );
  if (!recovery.accepted) {
    return null;
  }
  return basis(
    snapshot,
    "terminal-clean",
    "artifact-publication-only",
    latestTerminal.id,
    profile === "mixed"
      ? "Latest terminal payload is clean; reactions are retained only as audit evidence"
      : "Latest stable terminal payload is clean",
    {
      selectedRequest:
        latestTerminal.request_id !== null &&
        latestTerminal.request_id === requestEvaluation.selected?.id
          ? requestEvaluation.selected
          : null,
      selectedArtifact: latestTerminal,
      recovery: recovery.receipt,
    },
  );
}

function selectAcceptedPlusOne(snapshot, terminal, requestEvaluation) {
  const request = requestEvaluation.selected;
  if (!requestEvaluation.selected_is_authoritative || request === null) {
    return null;
  }
  const matching = snapshot.acknowledgements
    .filter(
      (acknowledgement) =>
        acknowledgement.kind === "plus-one" &&
        acknowledgement.request_id === request.id &&
        acknowledgement.exact_provider &&
        acknowledgement.stable &&
        acknowledgement.commit_oid === snapshot.review_epoch.head_oid &&
        compareTimestamp(acknowledgement.created_at, request.created_at) > 0,
    )
    .sort(compareEvidence);
  const selected = matching.at(-1) ?? null;
  if (selected === null) {
    return null;
  }
  // `eyes` is liveness-only. It never changes a selected generation's +1
  // outcome and is retained only in the sealed audit inventory.
  const recovery = completionRecoversFindings(
    snapshot,
    terminal,
    requestEvaluation,
    selected.created_at,
    selected.id,
  );
  if (!recovery.accepted) {
    return null;
  }
  return basis(
    snapshot,
    "thumbs-up-clean",
    null,
    selected.id,
    request.kind === "manual"
      ? "Stable exact-provider +1 follows a manual request with two accepted permission point reads"
      : "Stable exact-provider +1 follows the latest controlled exact request",
    {
      selectedRequest: request,
      recovery: recovery.receipt,
    },
  );
}

function completionRecoversFindings(
  snapshot,
  terminal,
  requestEvaluation,
  completionCreatedAt,
  completionId,
) {
  const findingArtifacts = terminal.filter(
    (artifact) => artifact.kind === "terminal-findings" && artifact.stable,
  ).sort(compareEvidence);
  if (findingArtifacts.length === 0) {
    return { accepted: true, receipt: null };
  }
  const request = requestEvaluation.selected;
  if (
    request === null ||
    !requestEvaluation.selected_is_authoritative ||
    compareTimestamp(completionCreatedAt, request.created_at) <= 0
  ) {
    return { accepted: false, receipt: null };
  }
  const findingIds = [];
  const closureIds = [];
  for (const artifact of findingArtifacts) {
    if (compareTimestamp(completionCreatedAt, artifact.created_at) <= 0) {
      return { accepted: false, receipt: null };
    }
    for (const findingId of artifact.finding_ids) {
      const thread = snapshot.threads.find(
        (candidate) => candidate.finding_id === findingId,
      ) ?? null;
      const closure = findingClosure(snapshot, artifact, findingId, thread);
      if (
        closure === null ||
        compareTimestamp(request.created_at, closure.created_at) <= 0
      ) {
        return { accepted: false, receipt: null };
      }
      findingIds.push(findingId);
      closureIds.push(closure.id);
    }
  }
  return {
    accepted: true,
    receipt: {
      finding_ids: findingIds,
      closure_ids: closureIds,
      new_request_id: request.id,
      completion_id: completionId,
    },
  };
}

function findingClosure(snapshot, artifact, findingId, thread) {
  if (thread?.kind === "inline") {
    return thread.stable &&
      thread.is_resolved &&
      thread.resolution_observed_at !== null &&
      compareTimestamp(thread.resolution_observed_at, artifact.created_at) > 0
      ? {
          id: thread.id,
          created_at: thread.resolution_observed_at,
        }
      : null;
  }
  const addressed = snapshot.acknowledgements
    .filter(
      (candidate) =>
        candidate.kind === "addressed" &&
        candidate.finding_id === findingId &&
        candidate.exact_provider === false &&
        candidate.stable &&
        candidate.commit_oid === snapshot.review_epoch.head_oid &&
        compareTimestamp(candidate.created_at, artifact.created_at) > 0,
    )
    .sort(compareEvidence)
    .at(-1) ?? null;
  return addressed === null
    ? null
    : {
        id: addressed.id,
        created_at: addressed.created_at,
      };
}

function selectNoStart(snapshot, requestEvaluation) {
  const request = requestEvaluation.selected;
  if (
    request === null ||
    request.kind !== "automatic" ||
    !request.controlled ||
    !requestEvaluation.selected_is_authoritative
  ) {
    return null;
  }
  const selected = snapshot.no_start_observations
    .filter(
      (observation) =>
        observation.request_id === request.id &&
        V2_NO_START_BODIES.includes(observation.body) &&
        observation.exact_provider &&
        observation.stable &&
        compareTimestamp(observation.carrier_created_at, request.created_at) > 0 &&
        compareTimestamp(observation.first_seen_at, observation.carrier_created_at) >= 0 &&
        BigInt(observation.request_run_id) < BigInt(observation.first_run_id) &&
        BigInt(observation.first_run_id) < BigInt(observation.confirmation_run_id) &&
        compareTimestamp(observation.confirmed_at, observation.first_seen_at) >=
          NO_START_CONFIRMATION_MS,
    )
    .sort((left, right) => compareTimestamp(left.confirmed_at, right.confirmed_at) || compareIds(left.id, right.id))
    .at(-1) ?? null;
  return selected === null
    ? null
    : basis(
        snapshot,
        "no-start-rejection",
        "artifact-publication-only",
        selected.id,
        "Exact no-start rejection was independently stable on a second run at least 15 minutes later",
        {
          selectedRequest: request,
          selectedArtifact: {
            id: selected.id,
            url: selected.url,
            created_at: selected.carrier_created_at,
          },
        },
      );
}

function requestPolicy(status, selectedRequest, reason, permission = {}) {
  return {
    status,
    selected_request_id: selectedRequest?.id ?? null,
    reason,
    permission_assurance: permission.permission_assurance ?? null,
    request_time_permission: permission.request_time_permission ?? null,
    permission_aba_excluded: permission.permission_aba_excluded ?? null,
    generation_id: selectedRequest?.generation_id ?? null,
    generation_kind: selectedRequest?.generation_kind ?? null,
    generation_index: selectedRequest?.generation_index ?? null,
  };
}

function basis(
  snapshot,
  kind,
  _scopeAssurance,
  artifactId,
  summary,
  {
    selectedRequest = null,
    selectedArtifact = null,
    recovery = null,
  } = {},
) {
  return {
    kind,
    scope_assurance: "whole-pr-contractual",
    artifact_id: artifactId,
    summary,
    authority_receipt: {
      selected_request: authorityObject(selectedRequest),
      selected_artifact: authorityObject(selectedArtifact),
      pagination_sha256: snapshot.evidence_authority.pagination_sha256,
      final_reread_sha256: snapshot.evidence_authority.final_reread_sha256,
      recovery,
      selected_generation: selectedRequest === null ? null : {
        id: selectedRequest.generation_id,
        kind: selectedRequest.generation_kind,
        index: selectedRequest.generation_index,
      },
    },
  };
}

function authorityObject(value) {
  return value === null
    ? null
    : {
        id: value.id,
        url: value.url,
        created_at: value.created_at,
      };
}

function allInventoriesComplete(inventories) {
  return Object.values(inventories).every((value) => value === true);
}

function selectTerminalOutcome(artifacts) {
  if (artifacts.length === 0) {
    return { selected: null, conflict: null, unstable: null };
  }
  const latestTime = artifacts.reduce((latest, artifact) =>
    compareTimestamp(artifact.created_at, latest) > 0
      ? artifact.created_at
      : latest,
  artifacts[0].created_at);
  const latest = artifacts.filter((artifact) => artifact.created_at === latestTime);
  if (new Set(latest.map(({ channel }) => channel)).size > 1) {
    const unstable = latest
      .filter((artifact) => !artifact.stable)
      .sort(compareIdsByArtifact)
      .at(-1) ?? null;
    return {
      selected: null,
      conflict: [...latest].sort(compareIdsByArtifact).at(-1),
      unstable,
    };
  }
  const precedence = new Map([
    ["terminal-clean", 0],
    ["terminal-findings", 1],
    ["malformed", 2],
  ]);
  const selectedPrecedence = Math.max(
    ...latest.map(({ kind }) => precedence.get(kind)),
  );
  const selected = latest
    .filter(({ kind }) => precedence.get(kind) === selectedPrecedence)
    .sort(compareIdsByArtifact)
    .at(-1);
  return {
    selected,
    conflict: null,
    unstable: selected.stable ? null : selected,
  };
}

function compareIdsByArtifact(left, right) {
  return compareIds(left.id, right.id);
}

function compareEvidence(left, right) {
  return compareTimestamp(left.created_at, right.created_at) || compareIds(left.id, right.id);
}

function compareTimestamp(left, right) {
  return Date.parse(left) - Date.parse(right);
}

function compareIds(left, right) {
  const leftId = BigInt(left);
  const rightId = BigInt(right);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}
