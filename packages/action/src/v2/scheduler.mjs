import { createHash } from "node:crypto";

import { V2_DECISIONS, V2_STATUS_TARGET_MODES } from "./schema.mjs";

export const V2_SCHEDULER_SCHEMA = "codex-review-gate-scheduler-v2";
export const V2_SCHEDULER_SCHEMA_VERSION = 1;

export const PUBLIC_INITIAL_WAIT_MS = 15 * 60 * 1000;
export const PUBLIC_POST_REQUEST_WAIT_MS = 15 * 60 * 1000;
export const PUBLIC_NO_START_CONFIRMATION_MS = 15 * 60 * 1000;
export const PRIVATE_RECONCILIATION_INTERVAL_MS = 2 * 60 * 60 * 1000;
export const PRIVATE_INCONCLUSIVE_AFTER_MS = 6 * 60 * 60 * 1000;
export const MAX_EXACT_STATUS_WRITES = 1_000;

export const V2_SCHEDULER_TRIGGERS = Object.freeze([
  "initial",
  "timer",
  "schedule",
  "provider-event",
  "manual",
]);

export const V2_SCHEDULER_DECISIONS = V2_DECISIONS;

export const V2_SCHEDULER_ACTION_KINDS = Object.freeze([
  "evaluate_snapshot",
  "persist_auto_request_intent",
  "post_review_request",
  "publish_status",
  "record_head_ledger",
]);

const INPUT_KEYS = Object.freeze([
  "schema",
  "schema_version",
  "trigger",
  "now",
  "public_wait_supported",
  "status_target_mode",
  "epoch",
  "evaluation",
  "complete_snapshots",
  "status",
  "applied_action_keys",
]);
const EPOCH_KEYS = Object.freeze([
  "id",
  "started_at",
  "controlled_request",
  "automatic_request",
]);
const CONTROLLED_REQUEST_KEYS = Object.freeze([
  "request_id",
  "bound_at",
  "binding_record_oid",
  "binding_receipt_digest",
]);
const AUTOMATIC_REQUEST_KEYS = Object.freeze([
  "state",
  "intent_id",
  "intent_persisted_at",
  "effect_attempted_at",
]);
const SNAPSHOT_KEYS = Object.freeze([
  "epoch_id",
  "decision",
  "complete",
  "snapshot_id",
  "snapshot_fingerprint",
  "observed_at",
  "provider_activity_fingerprint",
  "no_start_candidate",
  "run_id",
  "run_attempt",
]);
const NO_START_KEYS = Object.freeze([
  "artifact_id",
  "artifact_digest",
  "scope_fingerprint",
  "lifecycle_fingerprint",
  "first_seen_at",
]);
const STATUS_KEYS = Object.freeze([
  "exact_sha_context_count",
  "latest_idempotency_key",
]);
const AUTOMATIC_REQUEST_STATES = new Set([
  "available",
  "intent-persisted",
  "effect-attempted",
]);
const DECISIONS = new Set(V2_SCHEDULER_DECISIONS);
const TRIGGERS = new Set(V2_SCHEDULER_TRIGGERS);
const NO_START_DECISIONS = new Set([
  "skipped-unavailable",
  "blocked-configuration",
]);
const SINGLE_STATUS_WRITE_DECISIONS = new Set([
  "pending",
  "clean",
  "skipped-unavailable",
]);
const STRICT_UTC_TIMESTAMP =
  /^(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d{1,3}))?Z$/u;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;

// These schemas are deliberately descriptive rather than executable JSON
// Schema documents. planV2Actions performs the same closed-key validation at
// runtime and rejects every unknown key before making a scheduling decision.
export const V2_SCHEDULER_INPUT_SCHEMA = Object.freeze({
  name: `${V2_SCHEDULER_SCHEMA}-input`,
  schema_version: V2_SCHEDULER_SCHEMA_VERSION,
  additional_properties: false,
  keys: INPUT_KEYS,
});
export const V2_SCHEDULER_OUTPUT_SCHEMA = Object.freeze({
  name: `${V2_SCHEDULER_SCHEMA}-output`,
  schema_version: V2_SCHEDULER_SCHEMA_VERSION,
  additional_properties: false,
  keys: Object.freeze([
    "schema",
    "schema_version",
    "actions",
    "due_at",
    "automatic_retry_stopped",
    "event_wakeup_hints_are_advisory",
    "freshness_assurance",
  ]),
});

/**
 * Produce effects for one immutable review epoch without sleeping, reading the
 * clock, accessing the network, or mutating caller state. `due_at` is the next
 * useful observation time. It is a coordination target, never a hard SLA.
 */
export function planV2Actions(rawInput) {
  const input = validateInput(rawInput);
  const nowMs = timestampMs(input.now, "now");
  const epochStartMs = timestampMs(input.epoch.started_at, "epoch.started_at");
  const applied = new Set(input.applied_action_keys);
  const actions = [];

  if (input.trigger === "manual") {
    if (!input.evaluation?.complete) {
      appendAction(
        actions,
        evaluateAction(input, "manual-evaluate-only", input.now),
        applied,
      );
    }
    return output({
      actions,
      dueAtMs: null,
      automaticRetryStopped: automaticRetryStopped(input, nowMs, epochStartMs),
    });
  }

  if (input.evaluation === null) {
    appendAction(
      actions,
      evaluateAction(input, evaluationReasonForTrigger(input.trigger), input.now),
      applied,
    );
    return output({
      actions,
      dueAtMs: null,
      automaticRetryStopped: automaticRetryStopped(input, nowMs, epochStartMs),
    });
  }

  const evaluation = input.evaluation;
  if (!evaluation.complete) {
    appendAction(
      actions,
      evaluateAction(input, "incomplete-snapshot-retry", input.now),
      applied,
    );
    return output({
      actions,
      dueAtMs: null,
      automaticRetryStopped: automaticRetryStopped(input, nowMs, epochStartMs),
    });
  }

  if (NO_START_DECISIONS.has(evaluation.decision) && evaluation.no_start_candidate !== null) {
    return planNoStartConfirmation(input, nowMs, epochStartMs, applied);
  }

  if (evaluation.decision === "not-selected") {
    return output({ actions, dueAtMs: null, automaticRetryStopped: true });
  }

  if (evaluation.decision !== "pending" &&
      evaluation.decision !== "inconclusive") {
    appendStatusOrCapLedger(actions, input, evaluation.decision, evaluation, applied);
    return output({
      actions,
      dueAtMs: input.public_wait_supported
        ? null
        : nextPrivateReconciliationMs(input, nowMs),
      automaticRetryStopped: true,
    });
  }

  if (input.public_wait_supported) {
    return planPublicPending(input, nowMs, epochStartMs, applied);
  }

  return planPrivatePending(input, nowMs, epochStartMs, applied);
}

function planPublicPending(input, nowMs, epochStartMs, applied) {
  const actions = [];
  const evaluationMs = timestampMs(input.evaluation.observed_at, "evaluation.observed_at");
  const initialDeadlineMs = epochStartMs + PUBLIC_INITIAL_WAIT_MS;

  if (evaluationMs < initialDeadlineMs) {
    appendStatusOrCapLedger(actions, input, "pending", input.evaluation, applied);
    if (hasStatusCapLedger(actions)) {
      return output({ actions, dueAtMs: null, automaticRetryStopped: true });
    }
    if (nowMs < initialDeadlineMs) {
      return output({
        actions,
        dueAtMs: initialDeadlineMs,
        automaticRetryStopped: automaticRetryStopped(input, nowMs, epochStartMs) ||
          actions.some((action) => action.kind === "record_head_ledger"),
      });
    }
    appendAction(
      actions,
      evaluateAction(input, "public-initial-wait-complete", iso(initialDeadlineMs)),
      applied,
    );
    return output({
      actions,
      dueAtMs: null,
      automaticRetryStopped: false,
    });
  }

  const requestWaitOriginMs = requestWaitOrigin(input);
  if (requestWaitOriginMs !== null) {
    const resultDeadlineMs = requestWaitOriginMs + PUBLIC_POST_REQUEST_WAIT_MS;
    appendStatusOrCapLedger(actions, input, "pending", input.evaluation, applied);
    if (hasStatusCapLedger(actions)) {
      return output({ actions, dueAtMs: null, automaticRetryStopped: true });
    }
    if (evaluationMs < resultDeadlineMs) {
      if (nowMs < resultDeadlineMs) {
        return output({
          actions,
          dueAtMs: resultDeadlineMs,
          automaticRetryStopped: true,
        });
      }
      appendAction(
        actions,
        evaluateAction(input, "public-post-request-wait-complete", iso(resultDeadlineMs)),
        applied,
      );
      return output({
        actions,
        dueAtMs: null,
        automaticRetryStopped: true,
      });
    }

    appendStatusOrCapLedger(
      actions,
      input,
      input.evaluation.decision === "inconclusive" ? "inconclusive" : "pending",
      input.evaluation,
      applied,
    );
    return output({ actions, dueAtMs: null, automaticRetryStopped: true });
  }

  if (input.epoch.automatic_request.state === "available") {
    const requiredSlots = requiredStatusWriteSlots("pending", input.status_target_mode);
    if (remainingStatusSlots(input) < requiredSlots) {
      appendCapLedger(actions, input, applied, requiredSlots);
      return output({ actions, dueAtMs: null, automaticRetryStopped: true });
    }

    appendStatusOrCapLedger(actions, input, "pending", input.evaluation, applied);
    appendAutomaticRequestActions(actions, input, applied);
    return output({
      actions,
      dueAtMs: nowMs + PUBLIC_POST_REQUEST_WAIT_MS,
      automaticRetryStopped: true,
    });
  }

  // An intent is durable before its only POST effect. A later invocation may
  // finish that effect, but an effect-attempted request is never retried.
  if (input.epoch.automatic_request.state === "intent-persisted") {
    const requiredSlots = requiredStatusWriteSlots("pending", input.status_target_mode);
    if (remainingStatusSlots(input) < requiredSlots) {
      appendCapLedger(actions, input, applied, requiredSlots);
      return output({ actions, dueAtMs: null, automaticRetryStopped: true });
    }
    appendStatusOrCapLedger(actions, input, "pending", input.evaluation, applied);
    appendAction(actions, postRequestAction(input), applied);
    const originMs = timestampMs(
      input.epoch.automatic_request.intent_persisted_at,
      "epoch.automatic_request.intent_persisted_at",
    );
    return output({
      actions,
      dueAtMs: originMs + PUBLIC_POST_REQUEST_WAIT_MS,
      automaticRetryStopped: true,
    });
  }

  appendStatusOrCapLedger(actions, input, "pending", input.evaluation, applied);
  return output({ actions, dueAtMs: null, automaticRetryStopped: true });
}

function planPrivatePending(input, nowMs, epochStartMs, applied) {
  const actions = [];
  const requestBoundMs = controlledRequestBoundMs(input);
  const deadlineMs = requestBoundMs === null
    ? null
    : requestBoundMs + PRIVATE_INCONCLUSIVE_AFTER_MS;
  const evaluationMs = timestampMs(input.evaluation.observed_at, "evaluation.observed_at");
  const completeSnapshots = requestBoundMs === null
    ? []
    : postRequestIndependentCompleteSnapshots(input, requestBoundMs);

  if (deadlineMs !== null && nowMs >= deadlineMs) {
    const currentIsDeadlineSnapshot = evaluationMs >= deadlineMs;
    if (currentIsDeadlineSnapshot && completeSnapshots.length >= 2) {
      appendStatusOrCapLedger(actions, input, "inconclusive", input.evaluation, applied, {
        deadlineDerived: true,
      });
      return output({
        actions,
        dueAtMs: nextPrivateReconciliationMs(input, nowMs),
        automaticRetryStopped: true,
      });
    }

    if (!currentIsDeadlineSnapshot) {
      appendAction(
        actions,
        evaluateAction(input, "private-six-hour-deadline", iso(deadlineMs)),
        applied,
      );
      return output({
        actions,
        dueAtMs: null,
        automaticRetryStopped: true,
      });
    }

    // A second independent complete snapshot must come from another run. A
    // schedule may arrive late without violating the contract.
    return output({
      actions,
      dueAtMs: evaluationMs + PRIVATE_RECONCILIATION_INTERVAL_MS,
      automaticRetryStopped: true,
    });
  }

  const automaticRequestAvailable =
    input.epoch.controlled_request === null &&
    input.epoch.automatic_request.state === "available";
  const requiredSlots = requiredStatusWriteSlots("pending", input.status_target_mode);
  if (remainingStatusSlots(input) < requiredSlots) {
    appendCapLedger(actions, input, applied, requiredSlots);
    return output({ actions, dueAtMs: null, automaticRetryStopped: true });
  }

  appendStatusOrCapLedger(actions, input, "pending", input.evaluation, applied);
  if (automaticRequestAvailable) {
    appendAutomaticRequestActions(actions, input, applied);
  } else if (input.epoch.automatic_request.state === "intent-persisted") {
    appendAction(actions, postRequestAction(input), applied);
  }

  return output({
    actions,
    dueAtMs: nextPrivateReconciliationMs(input, nowMs),
    automaticRetryStopped:
      automaticRequestAvailable ||
      input.epoch.controlled_request !== null ||
      input.epoch.automatic_request.state !== "available",
  });
}

function planNoStartConfirmation(input, nowMs, epochStartMs, applied) {
  const actions = [];
  const current = input.evaluation;
  const requestObservedMs = input.epoch.controlled_request === null
    ? null
    : timestampMs(input.epoch.controlled_request.bound_at,
      "epoch.controlled_request.bound_at");
  const firstSeenMs = timestampMs(
    current.no_start_candidate.first_seen_at,
    "evaluation.no_start_candidate.first_seen_at",
  );

  if (requestObservedMs === null || firstSeenMs <= requestObservedMs) {
    throw new TypeError(
      "a no-start candidate must first be seen after the controlled request",
    );
  }

  const currentMs = timestampMs(current.observed_at, "evaluation.observed_at");
  const matchingPrior = independentCompleteSnapshots(input)
    .filter((snapshot) => snapshot.snapshot_id !== current.snapshot_id)
    .filter((snapshot) => matchingNoStartSnapshot(snapshot, current))
    .filter((snapshot) => {
      const observedMs = timestampMs(snapshot.observed_at, "complete_snapshots[].observed_at");
      return observedMs >= requestObservedMs &&
        currentMs - observedMs >= PUBLIC_NO_START_CONFIRMATION_MS;
    })
    .sort((left, right) => timestampMs(right.observed_at, "snapshot.observed_at") -
      timestampMs(left.observed_at, "snapshot.observed_at"))[0];

  if (matchingPrior) {
    appendStatusOrCapLedger(actions, input, current.decision, current, applied);
    return output({
      actions,
      dueAtMs: input.public_wait_supported
        ? null
        : nextPrivateReconciliationMs(input, nowMs),
      automaticRetryStopped: true,
    });
  }

  const dueAtMs = currentMs + PUBLIC_NO_START_CONFIRMATION_MS;
  if (nowMs >= dueAtMs) {
    appendAction(
      actions,
      evaluateAction(input, "public-no-start-confirmation", iso(dueAtMs)),
      applied,
    );
    return output({ actions, dueAtMs: null, automaticRetryStopped: true });
  }
  return output({
    actions,
    dueAtMs: input.public_wait_supported
      ? dueAtMs
      : currentMs + PRIVATE_RECONCILIATION_INTERVAL_MS,
    automaticRetryStopped: true,
  });
}

function appendAutomaticRequestActions(actions, input, applied) {
  const intentId = automaticIntentId(input.epoch.id);
  const persistKey = `persist-auto-request-intent:${digest(intentId)}`;
  appendAction(actions, {
    kind: "persist_auto_request_intent",
    idempotency_key: persistKey,
    intent_id: intentId,
    consumes_automatic_reservation: true,
  }, applied);
  appendAction(actions, {
    kind: "post_review_request",
    idempotency_key: `post-review-request:${digest(intentId)}`,
    intent_id: intentId,
    depends_on_idempotency_key: persistKey,
    retry_limit: 0,
    record_attempt_before_effect: true,
  }, applied);
}

function postRequestAction(input) {
  const intentId = input.epoch.automatic_request.intent_id;
  return {
    kind: "post_review_request",
    idempotency_key: `post-review-request:${digest(intentId)}`,
    intent_id: intentId,
    depends_on_idempotency_key: `persist-auto-request-intent:${digest(intentId)}`,
    retry_limit: 0,
    record_attempt_before_effect: true,
  };
}

function appendStatusOrCapLedger(
  actions,
  input,
  decision,
  snapshot,
  applied,
  { deadlineDerived = false } = {},
) {
  const action = statusAction(input, decision, snapshot, { deadlineDerived });
  if (action.required_write_slots === 0) return;
  if (
    input.status.latest_idempotency_key === action.idempotency_key ||
    applied.has(action.idempotency_key)
  ) {
    return;
  }

  if (remainingStatusSlots(input) < action.required_write_slots) {
    appendCapLedger(actions, input, applied, action.required_write_slots);
    return;
  }
  actions.push(action);
}

function appendCapLedger(actions, input, applied, requiredSlots) {
  const action = {
    kind: "record_head_ledger",
    idempotency_key: `head-ledger:status-cap-exhausted:${digest(input.epoch.id)}`,
    decision: "blocked-input",
    reason: "status-cap-exhausted",
    exact_sha_context_count: input.status.exact_sha_context_count,
    required_write_slots: requiredSlots,
  };
  appendAction(actions, action, applied);
}

function statusAction(input, decision, snapshot, { deadlineDerived }) {
  const requiredWriteSlots = requiredStatusWriteSlots(decision, input.status_target_mode);
  return {
    kind: "publish_status",
    idempotency_key: statusIdempotencyKey(input, decision, snapshot, deadlineDerived),
    decision,
    reason: deadlineDerived ? "inconclusive-timeout" : "evaluation-decision",
    snapshot_id: snapshot.snapshot_id,
    required_write_slots: requiredWriteSlots,
  };
}

function requiredStatusWriteSlots(decision, statusTargetMode) {
  if (statusTargetMode === "head") {
    return ["clean", "skipped-unavailable"].includes(decision) ? 0 : 1;
  }
  return SINGLE_STATUS_WRITE_DECISIONS.has(decision) ? 1 : 2;
}

function statusIdempotencyKey(input, decision, snapshot, deadlineDerived = false) {
  const certificate = decision === "pending"
    ? `${input.epoch.id}:pending`
    : deadlineDerived
      ? `${input.epoch.id}:inconclusive-timeout`
      : `${input.epoch.id}:${decision}:${snapshot.snapshot_fingerprint}`;
  return `publish-status:${digest(certificate)}`;
}

function evaluateAction(input, reason, observationBoundary) {
  const mode = input.trigger === "manual" ? "evaluate-only" : "ordinary";
  return {
    kind: "evaluate_snapshot",
    idempotency_key: `evaluate:${digest(`${input.epoch.id}:${reason}:${observationBoundary}`)}`,
    mode,
    reason,
  };
}

function matchingNoStartSnapshot(left, right) {
  return left.complete &&
    NO_START_DECISIONS.has(left.decision) &&
    left.decision === right.decision &&
    left.no_start_candidate !== null &&
    left.no_start_candidate.artifact_id === right.no_start_candidate.artifact_id &&
    left.no_start_candidate.artifact_digest === right.no_start_candidate.artifact_digest &&
    left.no_start_candidate.scope_fingerprint === right.no_start_candidate.scope_fingerprint &&
    left.no_start_candidate.lifecycle_fingerprint === right.no_start_candidate.lifecycle_fingerprint &&
    left.no_start_candidate.first_seen_at === right.no_start_candidate.first_seen_at &&
    left.provider_activity_fingerprint === right.provider_activity_fingerprint;
}

function independentCompleteSnapshots(input) {
  const snapshots = [...input.complete_snapshots, input.evaluation]
    .filter((snapshot) => snapshot?.complete && snapshot.epoch_id === input.epoch.id)
    .sort((left, right) => timestampMs(left.observed_at, "snapshot.observed_at") -
      timestampMs(right.observed_at, "snapshot.observed_at"));
  const unique = new Map();
  for (const snapshot of snapshots) {
    unique.set(snapshot.snapshot_id, snapshot);
  }
  return [...unique.values()];
}

function postRequestIndependentCompleteSnapshots(input, requestBoundMs) {
  const snapshots = independentCompleteSnapshots(input)
    .filter((snapshot) =>
      timestampMs(snapshot.observed_at, "snapshot.observed_at") > requestBoundMs);
  const independentRuns = new Map();
  for (const snapshot of snapshots) {
    if (!independentRuns.has(snapshot.run_id)) {
      independentRuns.set(snapshot.run_id, snapshot);
    }
  }
  return [...independentRuns.values()];
}

function nextPrivateReconciliationMs(input, nowMs) {
  const complete = independentCompleteSnapshots(input);
  const anchorMs = complete.length > 0
    ? timestampMs(complete.at(-1).observed_at, "snapshot.observed_at")
    : nowMs;
  return Math.max(nowMs, anchorMs) + PRIVATE_RECONCILIATION_INTERVAL_MS;
}

function requestWaitOrigin(input) {
  if (input.epoch.controlled_request !== null) {
    return timestampMs(input.epoch.controlled_request.bound_at,
      "epoch.controlled_request.bound_at");
  }
  if (input.epoch.automatic_request.effect_attempted_at !== null) {
    return timestampMs(
      input.epoch.automatic_request.effect_attempted_at,
      "epoch.automatic_request.effect_attempted_at",
    );
  }
  return null;
}

function automaticRetryStopped(input, nowMs, epochStartMs) {
  return input.epoch.controlled_request !== null ||
    input.epoch.automatic_request.state !== "available" ||
    input.status.exact_sha_context_count >= MAX_EXACT_STATUS_WRITES;
}

function controlledRequestBoundMs(input) {
  return input.epoch.controlled_request === null
    ? null
    : timestampMs(input.epoch.controlled_request.bound_at,
      "epoch.controlled_request.bound_at");
}

function remainingStatusSlots(input) {
  return MAX_EXACT_STATUS_WRITES - input.status.exact_sha_context_count;
}

function appendAction(actions, action, applied) {
  if (!applied.has(action.idempotency_key)) {
    actions.push(action);
  }
}

function hasStatusCapLedger(actions) {
  return actions.some((action) =>
    action.kind === "record_head_ledger" && action.reason === "status-cap-exhausted");
}

function output({ actions, dueAtMs, automaticRetryStopped }) {
  return {
    schema: V2_SCHEDULER_SCHEMA,
    schema_version: V2_SCHEDULER_SCHEMA_VERSION,
    actions,
    due_at: dueAtMs === null ? null : iso(dueAtMs),
    automatic_retry_stopped: automaticRetryStopped,
    event_wakeup_hints_are_advisory: true,
    freshness_assurance: "point-in-time",
  };
}

function evaluationReasonForTrigger(trigger) {
  switch (trigger) {
    case "provider-event":
      return "opportunistic-provider-event";
    case "schedule":
      return "scheduled-reconciliation";
    case "timer":
      return "timer-reconciliation";
    default:
      return "initial-snapshot";
  }
}

function automaticIntentId(epochId) {
  return `auto-request:${digest(epochId)}`;
}

function digest(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function iso(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function validateInput(input) {
  assertRecord(input, "scheduler input");
  assertClosedKeys(input, INPUT_KEYS, "scheduler input");
  if (input.schema !== V2_SCHEDULER_SCHEMA) {
    throw new TypeError(`schema must be exactly ${V2_SCHEDULER_SCHEMA}`);
  }
  if (input.schema_version !== V2_SCHEDULER_SCHEMA_VERSION) {
    throw new TypeError(`schema_version must be exactly ${V2_SCHEDULER_SCHEMA_VERSION}`);
  }
  if (!TRIGGERS.has(input.trigger)) {
    throw new TypeError("trigger is not a closed v2 scheduler trigger");
  }
  if (typeof input.public_wait_supported !== "boolean") {
    throw new TypeError("public_wait_supported must be boolean");
  }
  if (!V2_STATUS_TARGET_MODES.includes(input.status_target_mode)) {
    throw new TypeError("status_target_mode is not closed");
  }
  const nowMs = timestampMs(input.now, "now");

  assertRecord(input.epoch, "epoch");
  assertClosedKeys(input.epoch, EPOCH_KEYS, "epoch");
  assertNonEmptyString(input.epoch.id, "epoch.id");
  const epochStartMs = timestampMs(input.epoch.started_at, "epoch.started_at");
  if (epochStartMs > nowMs) {
    throw new TypeError("epoch.started_at cannot be later than now");
  }
  validateControlledRequest(input.epoch.controlled_request, epochStartMs, nowMs);
  validateAutomaticRequest(input.epoch.automatic_request, epochStartMs, nowMs);

  if (input.evaluation !== null) {
    validateSnapshot(input.evaluation, "evaluation", input.epoch.id, epochStartMs, nowMs);
  }
  if (!Array.isArray(input.complete_snapshots)) {
    throw new TypeError("complete_snapshots must be an array");
  }
  for (const [index, snapshot] of input.complete_snapshots.entries()) {
    validateSnapshot(
      snapshot,
      `complete_snapshots[${index}]`,
      input.epoch.id,
      epochStartMs,
      nowMs,
    );
    if (!snapshot.complete) {
      throw new TypeError(`complete_snapshots[${index}].complete must be true`);
    }
    if (input.evaluation !== null &&
        timestampMs(snapshot.observed_at, `complete_snapshots[${index}].observed_at`) >
          timestampMs(input.evaluation.observed_at, "evaluation.observed_at")) {
      throw new TypeError("complete_snapshots cannot be newer than evaluation");
    }
  }

  assertRecord(input.status, "status");
  assertClosedKeys(input.status, STATUS_KEYS, "status");
  if (!Number.isSafeInteger(input.status.exact_sha_context_count) ||
      input.status.exact_sha_context_count < 0 ||
      input.status.exact_sha_context_count > MAX_EXACT_STATUS_WRITES) {
    throw new TypeError(
      `status.exact_sha_context_count must be an integer from 0 to ${MAX_EXACT_STATUS_WRITES}`,
    );
  }
  optionalString(input.status.latest_idempotency_key, "status.latest_idempotency_key");
  if (!Array.isArray(input.applied_action_keys) ||
      input.applied_action_keys.some((value) => typeof value !== "string" || value.length === 0)) {
    throw new TypeError("applied_action_keys must contain only non-empty strings");
  }
  if (new Set(input.applied_action_keys).size !== input.applied_action_keys.length) {
    throw new TypeError("applied_action_keys must not contain duplicates");
  }
  return input;
}

function validateAutomaticRequest(request, epochStartMs, nowMs) {
  assertRecord(request, "epoch.automatic_request");
  assertClosedKeys(request, AUTOMATIC_REQUEST_KEYS, "epoch.automatic_request");
  if (!AUTOMATIC_REQUEST_STATES.has(request.state)) {
    throw new TypeError("epoch.automatic_request.state is not closed");
  }
  optionalString(request.intent_id, "epoch.automatic_request.intent_id");
  optionalTimestamp(request.intent_persisted_at, "epoch.automatic_request.intent_persisted_at");
  optionalTimestamp(request.effect_attempted_at, "epoch.automatic_request.effect_attempted_at");

  if (request.state === "available") {
    if (request.intent_id !== null || request.intent_persisted_at !== null ||
        request.effect_attempted_at !== null) {
      throw new TypeError("an available automatic request cannot have intent or attempt fields");
    }
    return;
  }
  if (request.intent_id === null || request.intent_persisted_at === null) {
    throw new TypeError("a consumed automatic request requires a persisted intent");
  }
  const persistedMs = timestampMs(
    request.intent_persisted_at,
    "epoch.automatic_request.intent_persisted_at",
  );
  if (persistedMs < epochStartMs || persistedMs > nowMs) {
    throw new TypeError("intent_persisted_at must be between epoch start and now");
  }
  if (request.state === "intent-persisted" && request.effect_attempted_at !== null) {
    throw new TypeError("intent-persisted cannot already have an effect attempt");
  }
  if (request.state === "effect-attempted") {
    if (request.effect_attempted_at === null) {
      throw new TypeError("effect-attempted requires effect_attempted_at");
    }
    const attemptedMs = timestampMs(
      request.effect_attempted_at,
      "epoch.automatic_request.effect_attempted_at",
    );
    if (attemptedMs < persistedMs || attemptedMs > nowMs) {
      throw new TypeError("effect_attempted_at must be between intent persistence and now");
    }
  }
}

function validateControlledRequest(request, epochStartMs, nowMs) {
  if (request === null) return;
  assertRecord(request, "epoch.controlled_request");
  assertClosedKeys(request, CONTROLLED_REQUEST_KEYS, "epoch.controlled_request");
  assertNonEmptyString(request.request_id, "epoch.controlled_request.request_id");
  const boundMs = timestampMs(request.bound_at, "epoch.controlled_request.bound_at");
  if (boundMs < epochStartMs || boundMs > nowMs) {
    throw new TypeError("epoch.controlled_request.bound_at must be between epoch start and now");
  }
  if (typeof request.binding_record_oid !== "string" ||
      !/^[0-9a-f]{40}$/u.test(request.binding_record_oid)) {
    throw new TypeError("epoch.controlled_request.binding_record_oid must be a full Git OID");
  }
  if (typeof request.binding_receipt_digest !== "string" ||
      !SHA256_DIGEST.test(request.binding_receipt_digest)) {
    throw new TypeError(
      "epoch.controlled_request.binding_receipt_digest must be a lowercase sha256 digest",
    );
  }
}

function validateSnapshot(snapshot, label, epochId, epochStartMs, nowMs) {
  assertRecord(snapshot, label);
  assertClosedKeys(snapshot, SNAPSHOT_KEYS, label);
  if (snapshot.epoch_id !== epochId) {
    throw new TypeError(`${label}.epoch_id must match epoch.id`);
  }
  if (!DECISIONS.has(snapshot.decision)) {
    throw new TypeError(`${label}.decision is not a closed v2 decision`);
  }
  if (typeof snapshot.complete !== "boolean") {
    throw new TypeError(`${label}.complete must be boolean`);
  }
  assertNonEmptyString(snapshot.snapshot_id, `${label}.snapshot_id`);
  assertNonEmptyString(snapshot.snapshot_fingerprint, `${label}.snapshot_fingerprint`);
  const observedMs = timestampMs(snapshot.observed_at, `${label}.observed_at`);
  if (observedMs < epochStartMs || observedMs > nowMs) {
    throw new TypeError(`${label}.observed_at must be between epoch start and now`);
  }
  assertNonEmptyString(
    snapshot.provider_activity_fingerprint,
    `${label}.provider_activity_fingerprint`,
  );
  if (typeof snapshot.run_id !== "string" || !/^[1-9][0-9]*$/u.test(snapshot.run_id)) {
    throw new TypeError(`${label}.run_id must be a positive decimal string`);
  }
  if (!Number.isSafeInteger(snapshot.run_attempt) || snapshot.run_attempt < 1) {
    throw new TypeError(`${label}.run_attempt must be a positive safe integer`);
  }
  if (snapshot.no_start_candidate !== null) {
    validateNoStartCandidate(snapshot.no_start_candidate, `${label}.no_start_candidate`, nowMs);
    if (timestampMs(
      snapshot.no_start_candidate.first_seen_at,
      `${label}.no_start_candidate.first_seen_at`,
    ) > observedMs) {
      throw new TypeError(`${label}.no_start_candidate.first_seen_at cannot follow observed_at`);
    }
  }
  if (snapshot.decision === "skipped-unavailable" && snapshot.no_start_candidate === null) {
    throw new TypeError(`${label}.skipped-unavailable requires a no_start_candidate`);
  }
}

function validateNoStartCandidate(candidate, label, nowMs) {
  assertRecord(candidate, label);
  assertClosedKeys(candidate, NO_START_KEYS, label);
  assertNonEmptyString(candidate.artifact_id, `${label}.artifact_id`);
  if (typeof candidate.artifact_digest !== "string" ||
      !SHA256_DIGEST.test(candidate.artifact_digest)) {
    throw new TypeError(`${label}.artifact_digest must be a lowercase sha256 digest`);
  }
  assertNonEmptyString(candidate.scope_fingerprint, `${label}.scope_fingerprint`);
  assertNonEmptyString(candidate.lifecycle_fingerprint, `${label}.lifecycle_fingerprint`);
  const firstSeenMs = timestampMs(candidate.first_seen_at, `${label}.first_seen_at`);
  if (firstSeenMs > nowMs) {
    throw new TypeError(`${label}.first_seen_at cannot be later than now`);
  }
}

function assertRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertClosedKeys(value, allowed, label) {
  const allowedSet = new Set(allowed);
  const keys = Object.keys(value);
  const unknown = keys.filter((key) => !allowedSet.has(key));
  const missing = allowed.filter((key) => !Object.hasOwn(value, key));
  if (unknown.length > 0 || missing.length > 0) {
    const details = [
      unknown.length > 0 ? `unknown: ${unknown.join(", ")}` : null,
      missing.length > 0 ? `missing: ${missing.join(", ")}` : null,
    ].filter(Boolean).join("; ");
    throw new TypeError(`${label} must use its closed schema (${details})`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function optionalString(value, label) {
  if (value !== null) {
    assertNonEmptyString(value, label);
  }
}

function optionalTimestamp(value, label) {
  if (value !== null) {
    timestampMs(value, label);
  }
}

function timestampMs(value, label) {
  const match = typeof value === "string" ? value.match(STRICT_UTC_TIMESTAMP) : null;
  if (match === null) {
    throw new TypeError(`${label} must be a strict UTC timestamp`);
  }
  const milliseconds = Date.parse(value);
  const normalized = `${match[1]}.${(match[2] || "").padEnd(3, "0")}Z`;
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== normalized) {
    throw new TypeError(`${label} must be a real UTC timestamp`);
  }
  return milliseconds;
}
