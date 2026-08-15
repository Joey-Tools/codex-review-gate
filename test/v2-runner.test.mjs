import assert from "node:assert/strict";
import test from "node:test";

import {
  V2_HEAD_LEDGER_SCHEMA,
  V2_REQUEST_BODY,
  V2_RUNNER_SCHEMA,
  bindV2Request,
  buildV2StatusPlan,
  buildV2AttemptReceipt,
  deriveV2EpochId,
  prepareV2Request,
  projectV2RunnerCandidateSuppressionEvidence,
  runV2Operation,
} from "../packages/action/src/v2/runner.mjs";
import {
  createV2GitHubTransport,
} from "../packages/action/src/v2/transport.mjs";

const HEAD = sha("b");
const MERGE = sha("c");
const TREE = sha("d");
const FINGERPRINT = digest("a");
const SERVER_TIME = "2026-08-13T12:00:00.000Z";

function schedulerPostAction(generationIndex = 1, overrides = {}) {
  const generationId = `automatic:${generationIndex}`;
  return {
    kind: "post_review_request",
    idempotency_key: `post-review-request:${generationId}:${digest("a")}`,
    intent_id: `auto-request:${generationId}:${digest("b")}`,
    generation_id: generationId,
    generation_index: generationIndex,
    recovery_authority: null,
    depends_on_idempotency_key:
      `persist-auto-request-intent:${generationId}:${digest("c")}`,
    retry_limit: 0,
    record_attempt_before_effect: true,
    ...overrides,
  };
}

test("test-merge status planning writes pending only to head and terminal only to merge", () => {
  const target = {
    mode: "test-merge-with-head-sentinel",
    head_sentinel_sha: HEAD,
    terminal_sha: MERGE,
    validated: true,
    head_sentinel_receipt: {
      sha: HEAD,
      context: "codex/github-review-gate",
      state: "pending",
      status_id: "9001",
      observed_at: "2026-08-13T11:59:59.000Z",
    },
  };
  const pending = buildV2StatusPlan({
    decision: "pending",
    status_target_mode: target.mode,
    status_context: "codex/github-review-gate",
    target,
    snapshot_fingerprint: FINGERPRINT,
  });
  assert.deepEqual(
    pending.writes.map(({ role, sha, state }) => ({ role, sha, state })),
    [{ role: "head-sentinel", sha: HEAD, state: "pending" }],
  );
  assert.equal(pending.terminal_cutover, false);

  const clean = buildV2StatusPlan({
    decision: "clean",
    status_target_mode: target.mode,
    status_context: "codex/github-review-gate",
    target,
    snapshot_fingerprint: FINGERPRINT,
  });
  assert.deepEqual(
    clean.writes.map(({ role, sha, state }) => ({ role, sha, state })),
    [{ role: "primary-terminal", sha: MERGE, state: "success" }],
  );
  assert.equal(clean.terminal_cutover, true);
  assert.equal(clean.writes.some((write) => write.sha === HEAD && write.state === "success"), false);

  const findings = buildV2StatusPlan({
    decision: "findings",
    status_target_mode: target.mode,
    status_context: "codex/github-review-gate",
    target,
    snapshot_fingerprint: FINGERPRINT,
  });
  assert.deepEqual(
    findings.writes.map(({ role, sha, state }) => ({ role, sha, state })),
    [
      { role: "primary-terminal", sha: MERGE, state: "failure" },
      { role: "head-sentinel", sha: HEAD, state: "failure" },
    ],
  );

  const inconclusive = buildV2StatusPlan({
    decision: "inconclusive",
    status_target_mode: target.mode,
    status_context: "codex/github-review-gate",
    target,
    snapshot_fingerprint: FINGERPRINT,
  });
  assert.equal(inconclusive.writes[0].state, "error");
  assert.equal(inconclusive.writes[1].state, "error");

  const skipped = buildV2StatusPlan({
    decision: "skipped-unavailable",
    status_target_mode: target.mode,
    status_context: "codex/github-review-gate",
    target,
    snapshot_fingerprint: FINGERPRINT,
  });
  assert.deepEqual(
    skipped.writes.map(({ sha, state }) => ({ sha, state })),
    [{ sha: MERGE, state: "success" }],
  );

  const notSelected = buildV2StatusPlan({
    decision: "not-selected",
    status_target_mode: target.mode,
    status_context: "codex/github-review-gate",
    target,
    snapshot_fingerprint: FINGERPRINT,
  });
  assert.deepEqual(notSelected.writes, []);
});

test("invalid test-merge target cannot manufacture a terminal merge verdict", () => {
  const plan = buildV2StatusPlan({
    decision: "clean",
    status_target_mode: "test-merge-with-head-sentinel",
    status_context: "codex/github-review-gate",
    target: {
      validated: false,
      blocked_reason: "potential-merge-unavailable",
      head_sentinel_sha: HEAD,
    },
    snapshot_fingerprint: FINGERPRINT,
  });
  assert.equal(plan.terminal_cutover, false);
  assert.deepEqual(
    plan.writes.map(({ role, sha, state }) => ({ role, sha, state })),
    [{ role: "head-sentinel", sha: HEAD, state: "error" }],
  );
});

test("positive test-merge publication requires a prior non-success head sentinel receipt", () => {
  const target = {
    mode: "test-merge-with-head-sentinel",
    head_sentinel_sha: HEAD,
    terminal_sha: MERGE,
    validated: true,
  };
  const missing = buildV2StatusPlan({
    decision: "clean",
    status_target_mode: target.mode,
    status_context: "codex/github-review-gate",
    target,
    snapshot_fingerprint: FINGERPRINT,
  });
  assert.deepEqual(
    missing.writes.map(({ sha, state }) => ({ sha, state })),
    [{ sha: HEAD, state: "error" }],
  );
  const successReceipt = buildV2StatusPlan({
    decision: "skipped-unavailable",
    status_target_mode: target.mode,
    status_context: "codex/github-review-gate",
    target: {
      ...target,
      head_sentinel_receipt: {
        sha: HEAD,
        context: "codex/github-review-gate",
        state: "success",
        status_id: "9002",
        observed_at: SERVER_TIME,
      },
    },
    snapshot_fingerprint: FINGERPRINT,
  });
  assert.deepEqual(
    successReceipt.writes.map(({ sha, state }) => ({ sha, state })),
    [{ sha: HEAD, state: "error" }],
  );
  assert.equal(successReceipt.writes.some((write) => write.sha === HEAD && write.state === "success"), false);
});

test("prepare creates a consumed retry-zero reservation without posting", () => {
  const snapshot = makeSnapshot();
  const reservation = prepareV2Request({
    snapshot,
    head_ledger: makeLedger(snapshot),
    scheduler_post_action: schedulerPostAction(),
  });

  assert.equal(reservation.body, V2_REQUEST_BODY);
  assert.equal(reservation.ordinal, 1);
  assert.equal(reservation.scheduler_intent_id, schedulerPostAction().intent_id);
  assert.match(reservation.attempt_id, /^v2-attempt:[0-9a-f]{64}$/u);
  assert.equal(reservation.automatic, true);
  assert.equal(reservation.consumed, true);
  assert.equal(reservation.epoch_head_sha, HEAD);
  assert.match(reservation.intent_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(reservation.reservation_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(reservation), true);

  assert.throws(
    () => prepareV2Request({
      snapshot,
      head_ledger: makeLedger(snapshot, { automatic_request_count: 3 }),
      scheduler_post_action: schedulerPostAction(),
    }),
    /consumed 3 automatic reservations/u,
  );
  assert.throws(
    () => prepareV2Request({
      snapshot,
      head_ledger: makeLedger(snapshot),
      scheduler_post_action: schedulerPostAction(1, { retry_limit: 1 }),
    }),
    /retry-zero/u,
  );
});

test("automatic generation two requires a prior-generation recovery authority", () => {
  const snapshot = makeSnapshot();
  const ledger = makeLedger(snapshot, { automatic_request_count: 1 });
  const action = schedulerPostAction(2);
  assert.throws(
    () => prepareV2Request({ snapshot, head_ledger: ledger, scheduler_post_action: action }),
    /recovery_authority/u,
  );
  const reservation = prepareV2Request({
    snapshot,
    head_ledger: ledger,
    scheduler_post_action: schedulerPostAction(2, {
      recovery_authority: {
        prior_generation_id: "automatic:1",
        finding_ids: ["finding-1"],
        closure_ids: ["closure-1"],
        closure_observed_at: "2026-08-13T11:59:59.000Z",
      },
    }),
  });
  assert.equal(reservation.generation_id, "automatic:2");
  assert.equal(reservation.generation_index, 2);
  assert.equal(reservation.recovery_authority.prior_generation_id, "automatic:1");
});

test("bind requires exact 201, exact request body, stable scope, and exact refetch", () => {
  const snapshot = makeSnapshot();
  const reservation = prepareV2Request({
    snapshot,
    head_ledger: makeLedger(snapshot),
    scheduler_post_action: schedulerPostAction(),
  });
  const postResponse = makePostResponse(reservation);
  const artifact = normalizedCreatedComment();
  const receipt = bindV2Request({
    reservation,
    post_response: postResponse,
    snapshot,
    scheduler_automatic_request: attemptedSchedulerState(reservation),
    binding_ledger: makeLedger(snapshot, { automatic_request_count: 1 }),
    exact_artifact: {
      selector: { kind: "issue_comment", id: "501" },
      artifact,
      response_server_time: "2026-08-13T12:00:02.000Z",
      raw_body_sha256: digest("b"),
    },
  });

  assert.equal(receipt.post_response.status, 201);
  assert.equal(receipt.post_response.body, V2_REQUEST_BODY);
  assert.equal(receipt.post_response.created_at, receipt.post_response.updated_at);
  assert.equal(receipt.post_refetch.artifact_id, "501");
  assert.equal(receipt.pre_scope_digest, receipt.post_scope_digest);
  assert.equal(receipt.non_replayable_effect_policy, "retry-zero-no-reclaim");
  assert.deepEqual(receipt.ledger_update.next_ledger.bound_attempt_ids, [reservation.attempt_id]);
  assert.match(receipt.receipt_digest, /^sha256:[0-9a-f]{64}$/u);

  assert.throws(
    () => bindV2Request({
      reservation,
      post_response: { ...postResponse, status: 200 },
      snapshot,
      scheduler_automatic_request: attemptedSchedulerState(reservation),
      binding_ledger: makeLedger(snapshot, { automatic_request_count: 1 }),
      exact_artifact: {
        selector: { kind: "issue_comment", id: "501" },
        artifact,
        response_server_time: "2026-08-13T12:00:02.000Z",
        raw_body_sha256: digest("b"),
      },
    }),
    /exact HTTP 201/u,
  );
  assert.throws(
    () => bindV2Request({
      reservation,
      post_response: postResponse,
      snapshot: makeSnapshot({ base: sha("e") }),
      scheduler_automatic_request: attemptedSchedulerState(reservation),
      binding_ledger: makeLedger(
        makeSnapshot({ base: sha("e") }),
        { automatic_request_count: 1 },
      ),
      exact_artifact: {
        selector: { kind: "issue_comment", id: "501" },
        artifact,
        response_server_time: "2026-08-13T12:00:02.000Z",
        raw_body_sha256: digest("b"),
      },
    }),
    /scope changed/u,
  );
  assert.throws(
    () => bindV2Request({
      reservation,
      post_response: postResponse,
      snapshot,
      scheduler_automatic_request: attemptedSchedulerState(reservation),
      binding_ledger: makeLedger(snapshot, { automatic_request_count: 1 }),
      exact_artifact: {
        selector: { kind: "issue_comment", id: "501" },
        artifact: { ...artifact, body: "@codex review edited" },
        response_server_time: "2026-08-13T12:00:02.000Z",
        raw_body_sha256: digest("b"),
      },
    }),
    /field body/u,
  );
});

test("bind rejects replay, missing attempt authority, and post-hoc causal ordering", () => {
  const snapshot = makeSnapshot();
  const reservation = prepareV2Request({
    snapshot,
    head_ledger: makeLedger(snapshot),
    scheduler_post_action: schedulerPostAction(),
  });
  const postResponse = makePostResponse(reservation);
  const exactArtifact = {
    selector: { kind: "issue_comment", id: "501" },
    artifact: normalizedCreatedComment(),
    response_server_time: "2026-08-13T12:00:02.000Z",
    raw_body_sha256: digest("b"),
  };

  assert.throws(
    () => bindV2Request({
      reservation,
      post_response: postResponse,
      snapshot,
      scheduler_automatic_request: attemptedSchedulerState(reservation),
      binding_ledger: makeLedger(snapshot, {
        automatic_request_count: 1,
        bound_attempt_ids: [reservation.attempt_id],
      }),
      exact_artifact: exactArtifact,
    }),
    /already has a durable binding/u,
  );
  assert.throws(
    () => bindV2Request({
      reservation,
      post_response: postResponse,
      snapshot,
      scheduler_automatic_request: {
        state: "intent-persisted",
        generation_index: reservation.generation_index,
        recovery_authority: reservation.recovery_authority,
        intent_id: reservation.scheduler_intent_id,
        intent_persisted_at: reservation.created_at,
        effect_attempted_at: null,
      },
      binding_ledger: makeLedger(snapshot, { automatic_request_count: 1 }),
      exact_artifact: exactArtifact,
    }),
    /does not prove the reserved effect attempt/u,
  );

  const lateAttempt = buildV2AttemptReceipt({
    reservation,
    recorded_at: "2026-08-13T12:00:02.000Z",
  });
  assert.throws(
    () => bindV2Request({
      reservation,
      post_response: { ...postResponse, attempt: lateAttempt },
      snapshot,
      scheduler_automatic_request: {
        ...attemptedSchedulerState(reservation),
        effect_attempted_at: lateAttempt.recorded_at,
      },
      binding_ledger: makeLedger(snapshot, { automatic_request_count: 1 }),
      exact_artifact: exactArtifact,
    }),
    /request times must order reservation/u,
  );
});

test("evaluate-only loads discovery and exact-evidence snapshots without mutation actions", async () => {
  const snapshot = makeSnapshot();
  const calls = [];
  const input = makeRunnerInput({ operation: "evaluate-only", snapshot });
  const output = await runV2Operation(input, {
    transport: {
      async loadSnapshot(request) {
        calls.push(request);
        return snapshot;
      },
    },
    reduceSnapshot: () => makeReducerReport(snapshot, "clean"),
    ...fakeProjectionDependencies(),
  });

  assert.deepEqual(calls, [
    {
      owner: "owner",
      repo: "repo",
      pullNumber: 42,
      artifactSelectors: [],
    },
    {
      owner: "owner",
      repo: "repo",
      pullNumber: 42,
      artifactSelectors: [],
      permissionSubjects: [],
    },
  ]);
  assert.equal(output.operation, "evaluate-only");
  assert.equal(output.decision, "clean");
  assert.deepEqual(output.scheduler_plan.actions, []);
  assert.deepEqual(output.status_plan.writes, []);
  assert.equal(output.status_plan.suppression_reason, "evaluate-only");
  assert.deepEqual(
    output.status_plan.suppressed_writes.map(({ sha, state }) => ({ sha, state })),
    [{ sha: MERGE, state: "success" }],
  );
  assert.equal(output.writes_performed, false);
  assert.equal(output.reservation, null);
  assert.equal(output.binding_receipt, null);
});

test("prepare can publish an automatic decision without inventing a request", async () => {
  const snapshot = makeSnapshot();
  const input = makeRunnerInput({ operation: "prepare-request", snapshot });
  input.head_ledger = makeLedger(snapshot);
  const output = await runV2Operation(input, {
    transport: { async loadSnapshot() { return snapshot; } },
    reduceSnapshot: () => makeReducerReport(snapshot, "clean"),
    ...fakeProjectionDependencies(),
    planActions: () => ({
      actions: [{
        kind: "publish_status",
        decision: "clean",
        required_write_slots: 1,
      }],
    }),
  });
  assert.equal(output.reservation, null);
  assert.equal(output.post_intent, null);
  assert.deepEqual(
    output.status_plan.writes.map(({ sha, state }) => ({ sha, state })),
    [{ sha: MERGE, state: "success" }],
  );
  assert.equal(output.scheduler_evaluation.decision, "clean");
});

test("candidate suppression evidence requires an exact prepare result and live transport snapshots", async () => {
  const fixture = makeSnapshot();
  const input = makeRunnerInput({ operation: "prepare-request", snapshot: fixture });
  input.head_ledger = makeLedger(fixture);
  const expectedScheduling = structuredClone(input.scheduling);
  const expectedHeadLedger = structuredClone(input.head_ledger);
  const liveTransport = createRunnerLiveTransport();
  const liveSnapshots = [];
  const output = await runV2Operation(input, {
    transport: {
      async loadSnapshot(request) {
        const snapshot = await liveTransport.loadSnapshot(request);
        liveSnapshots.push(snapshot);
        return snapshot;
      },
    },
    reduceSnapshot: (snapshot) => makeReducerReport(snapshot, "clean"),
    ...fakeProjectionDependencies(),
    planActions: () => {
      input.scheduling.run_identity.run_attempt = 98;
      return { actions: [] };
    },
  });

  assert.equal(liveSnapshots.length, 2);
  input.scheduling.run_identity.run_attempt = 99;
  input.head_ledger.automatic_request_count = 3;
  const projection = projectV2RunnerCandidateSuppressionEvidence(output);
  assert.deepEqual(Object.keys(projection), [
    "schema",
    "schema_version",
    "repository",
    "pull_request",
    "scope",
    "input_scheduling",
    "input_head_ledger",
    "controller_digest",
    "public_report_authority_digest",
    "discovery",
    "evidence",
    "result",
    "projection_digest",
  ]);
  assert.equal(
    projection.schema,
    "codex-review-gate-runner-candidate-suppression-evidence-v2",
  );
  assert.equal(projection.schema_version, 1);
  assert.deepEqual(projection.repository, {
    owner: "owner",
    name: "repo",
    node_id: "R_repo",
  });
  assert.deepEqual(projection.pull_request, {
    number: 42,
    node_id: "PR_node",
  });
  assert.deepEqual(projection.scope, {
    head_ref_oid: HEAD,
    base_ref_oid: sha("a"),
    potential_merge_commit_oid: MERGE,
    lifecycle: {
      state: "OPEN",
      merged: false,
      merged_at: null,
      is_draft: false,
    },
  });
  assert.deepEqual(projection.input_scheduling, expectedScheduling);
  assert.deepEqual(projection.input_head_ledger, expectedHeadLedger);
  assert.match(projection.controller_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(
    projection.public_report_authority_digest,
    /^sha256:[0-9a-f]{64}$/u,
  );
  for (const [index, snapshotProjection] of
    [projection.discovery, projection.evidence].entries()) {
    assert.equal(snapshotProjection.observed_at, SERVER_TIME);
    assert.match(snapshotProjection.snapshot_digest, /^sha256:[0-9a-f]{64}$/u);
    assert.deepEqual(snapshotProjection.completeness, {
      request_count: liveSnapshots[index].completeness.request_count,
      item_count: liveSnapshots[index].completeness.item_count,
      response_bytes: liveSnapshots[index].completeness.response_bytes,
      server_date_headers:
        liveSnapshots[index].completeness.server_date_headers,
    });
    assert.equal(snapshotProjection.effective_limits.max_items, 20_000);
    assert.equal(snapshotProjection.effective_limits.max_requests, 2_048);
  }
  assert.deepEqual(projection.result.scheduler_evaluation,
    output.scheduler_evaluation);
  assert.deepEqual(projection.result.scheduler_plan, output.scheduler_plan);
  assert.deepEqual(projection.result.status_plan, output.status_plan);
  assert.equal(projection.result.decision, output.decision);
  assert.equal(
    projection.result.snapshot_fingerprint,
    output.reducer_report.snapshot_fingerprint,
  );
  assert.equal(
    projection.result.provider_activity_fingerprint,
    output.scheduler_evaluation.provider_activity_fingerprint,
  );
  assert.match(projection.projection_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(Object.isFrozen(projection), true);

  assert.throws(
    () => projectV2RunnerCandidateSuppressionEvidence(
      structuredClone(output),
    ),
    (error) =>
      error.code === "UNTRUSTED_RUNNER_CANDIDATE_SUPPRESSION_RESULT",
  );

  const plainInput = makeRunnerInput({
    operation: "prepare-request",
    snapshot: fixture,
  });
  plainInput.head_ledger = makeLedger(fixture);
  const plainOutput = await runV2Operation(plainInput, {
    transport: { async loadSnapshot() { return fixture; } },
    reduceSnapshot: (snapshot) => makeReducerReport(snapshot, "clean"),
    ...fakeProjectionDependencies(),
    planActions: () => ({ actions: [] }),
  });
  assert.throws(
    () => projectV2RunnerCandidateSuppressionEvidence(plainOutput),
    (error) => error.code === "UNTRUSTED_TRANSPORT_SNAPSHOT_HANDLE",
  );

  const evaluateInput = makeRunnerInput({
    operation: "evaluate-only",
    snapshot: fixture,
  });
  const evaluateOutput = await runV2Operation(evaluateInput, {
    transport: { async loadSnapshot() { return fixture; } },
    reduceSnapshot: (snapshot) => makeReducerReport(snapshot, "clean"),
    ...fakeProjectionDependencies(),
    planActions: () => ({ actions: [] }),
  });
  assert.throws(
    () => projectV2RunnerCandidateSuppressionEvidence(evaluateOutput),
    (error) => error.code === "RUNNER_CANDIDATE_SUPPRESSION_OPERATION_REQUIRED",
  );
});

test("candidate suppression exact-result brand never crosses mutable authority intrinsics", async () => {
  const fixture = makeSnapshot();
  const input = makeRunnerInput({
    operation: "prepare-request",
    snapshot: fixture,
  });
  input.head_ledger = makeLedger(fixture);
  const setDescriptor = Object.getOwnPropertyDescriptor(
    WeakMap.prototype,
    "set",
  );
  const freezeDescriptor = Object.getOwnPropertyDescriptor(Object, "freeze");
  const cloneDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "structuredClone",
  );
  const originalSet = setDescriptor.value;
  const originalFreeze = freezeDescriptor.value;
  const originalClone = cloneDescriptor.value;
  let capturedSet = null;
  let capturedFreezeBinding = null;
  let capturedInputClone = false;
  Object.defineProperty(WeakMap.prototype, "set", {
    ...setDescriptor,
    value(key, value) {
      if (value !== null && typeof value === "object" &&
          Object.hasOwn(value, "input") &&
          Object.hasOwn(value, "discovery_snapshot") &&
          Object.hasOwn(value, "evidence_snapshot")) {
        capturedSet = { map: this, binding: value };
      }
      return Reflect.apply(originalSet, this, [key, value]);
    },
  });
  Object.defineProperty(Object, "freeze", {
    ...freezeDescriptor,
    value(value) {
      if (value !== null && typeof value === "object" &&
          Object.hasOwn(value, "input") &&
          Object.hasOwn(value, "discovery_snapshot") &&
          Object.hasOwn(value, "evidence_snapshot")) {
        capturedFreezeBinding = value;
        return value;
      }
      return Reflect.apply(originalFreeze, Object, [value]);
    },
  });
  Object.defineProperty(globalThis, "structuredClone", {
    ...cloneDescriptor,
    value(value, options) {
      const clone = Reflect.apply(originalClone, globalThis, [value, options]);
      if (value === input) {
        capturedInputClone = true;
        clone.scheduling.run_identity.run_attempt = 999;
      }
      return clone;
    },
  });
  let output;
  try {
    output = await runV2Operation(input, {
      transport: createRunnerLiveTransport(),
      reduceSnapshot: (snapshot) => makeReducerReport(snapshot, "clean"),
      ...fakeProjectionDependencies(),
      planActions: () => ({ actions: [] }),
    });
  } finally {
    Object.defineProperty(WeakMap.prototype, "set", setDescriptor);
    Object.defineProperty(Object, "freeze", freezeDescriptor);
    Object.defineProperty(globalThis, "structuredClone", cloneDescriptor);
  }

  const clone = structuredClone(output);
  if (capturedSet !== null) {
    Reflect.apply(originalSet, capturedSet.map, [clone, capturedSet.binding]);
  }
  assert.throws(
    () => projectV2RunnerCandidateSuppressionEvidence(clone),
    (error) =>
      error.code === "UNTRUSTED_RUNNER_CANDIDATE_SUPPRESSION_RESULT",
  );
  assert.equal(capturedSet, null, "private binding set must stay lexical");
  assert.equal(
    capturedFreezeBinding,
    null,
    "private binding freeze must stay lexical",
  );
  assert.equal(capturedInputClone, false, "private input clone must stay lexical");

  const getDescriptor = Object.getOwnPropertyDescriptor(
    WeakMap.prototype,
    "get",
  );
  const originalGet = getDescriptor.value;
  let capturedGetMap = null;
  Object.defineProperty(WeakMap.prototype, "get", {
    ...getDescriptor,
    value(key) {
      if (key === output) {
        capturedGetMap = this;
      }
      return Reflect.apply(originalGet, this, [key]);
    },
  });
  try {
    projectV2RunnerCandidateSuppressionEvidence(output);
  } finally {
    Object.defineProperty(WeakMap.prototype, "get", getDescriptor);
  }
  assert.equal(capturedGetMap, null, "private binding get must stay lexical");
});

test("candidate suppression evidence rejects inconsistent results and relaxed transport limits", async () => {
  const fixture = makeSnapshot();
  for (const scenario of [
    {
      mutate(evaluation) { evaluation.decision = "pending"; },
      code: "RUNNER_CANDIDATE_SUPPRESSION_RESULT_MISMATCH",
    },
    {
      mutate(evaluation) {
        evaluation.snapshot_fingerprint = digest("e");
      },
      code: "RUNNER_CANDIDATE_SUPPRESSION_RESULT_MISMATCH",
    },
    {
      mutate(evaluation) { evaluation.complete = false; },
      code: "RUNNER_CANDIDATE_SUPPRESSION_COMPLETE_EVIDENCE_REQUIRED",
    },
  ]) {
    const input = makeRunnerInput({
      operation: "prepare-request",
      snapshot: fixture,
    });
    input.head_ledger = makeLedger(fixture);
    const output = await runV2Operation(input, {
      transport: { async loadSnapshot() { return fixture; } },
      reduceSnapshot: (snapshot) => makeReducerReport(snapshot, "clean"),
      ...fakeProjectionDependencies(),
      planActions(schedulerInput) {
        scenario.mutate(schedulerInput.evaluation);
        return { actions: [] };
      },
    });
    assert.throws(
      () => projectV2RunnerCandidateSuppressionEvidence(output),
      (error) => error.code === scenario.code,
    );
  }

  const relaxedInput = makeRunnerInput({
    operation: "prepare-request",
    snapshot: fixture,
  });
  relaxedInput.head_ledger = makeLedger(fixture);
  const relaxedOutput = await runV2Operation(relaxedInput, {
    transport: createRunnerLiveTransport({ max_items: 20_001 }),
    reduceSnapshot: (snapshot) => makeReducerReport(snapshot, "clean"),
    ...fakeProjectionDependencies(),
    planActions: () => ({ actions: [] }),
  });
  assert.throws(
    () => projectV2RunnerCandidateSuppressionEvidence(relaxedOutput),
    (error) => error.code === "TRANSPORT_LIMITS_RELAXED",
  );
});

test("prepare preserves one durable intent for the ledger recovery builder", async () => {
  const snapshot = makeSnapshot();
  const postAction = schedulerPostAction(1);
  const input = makeRunnerInput({ operation: "prepare-request", snapshot });
  input.head_ledger = makeLedger(snapshot, { automatic_request_count: 1 });
  input.scheduling.epoch.automatic_request = {
    state: "intent-persisted",
    generation_index: 1,
    recovery_authority: null,
    intent_id: postAction.intent_id,
    intent_persisted_at: "2026-08-13T11:59:59.000Z",
    effect_attempted_at: null,
  };
  const dependencies = {
    transport: { async loadSnapshot() { return snapshot; } },
    reduceSnapshot: () => makeReducerReport(snapshot, "pending"),
    ...fakeProjectionDependencies(),
    planActions: () => ({ actions: [postAction] }),
  };
  const output = await runV2Operation(input, dependencies);
  assert.deepEqual(output.scheduler_plan.actions, [postAction]);
  assert.equal(output.reservation, null);
  assert.equal(output.post_intent, null);
  assert.equal(output.writes_performed, false);

  await assert.rejects(
    runV2Operation(input, {
      ...dependencies,
      planActions: () => ({ actions: [schedulerPostAction(2)] }),
    }),
    (error) => error.code === "SCHEDULER_GENERATION_MISMATCH",
  );
});

test("scheduler suppression and reducer epoch binding remain authoritative", async () => {
  const snapshot = makeSnapshot();
  const input = makeRunnerInput({ operation: "prepare-request", snapshot });
  input.head_ledger = makeLedger(snapshot);
  const suppressed = await runV2Operation(input, {
    transport: { async loadSnapshot() { return snapshot; } },
    reduceSnapshot: () => makeReducerReport(snapshot, "clean"),
    ...fakeProjectionDependencies(),
    planActions: () => ({ actions: [] }),
  });
  assert.deepEqual(suppressed.status_plan.writes, []);
  assert.equal(
    suppressed.status_plan.suppression_reason,
    "scheduler-did-not-authorize-publication",
  );
  await assert.rejects(
    runV2Operation(input, {
      transport: { async loadSnapshot() { return snapshot; } },
      reduceSnapshot: () => {
        const report = makeReducerReport(snapshot, "clean");
        report.review_epoch.merge_base_oid = sha("e");
        return report;
      },
      ...fakeProjectionDependencies(),
      planActions: () => ({ actions: [] }),
    }),
    /belongs to another review epoch/u,
  );
});

test("head mode evaluates but never publishes a terminal success to head", async () => {
  const snapshot = makeSnapshot();
  const input = makeRunnerInput({ operation: "evaluate-only", snapshot });
  input.status_target_mode = "head";
  input.scheduling.status_target_mode = "head";
  let transportCalled = false;
  const result = await runV2Operation(input, {
    transport: {
      async loadSnapshot() {
        transportCalled = true;
        return snapshot;
      },
    },
    reduceSnapshot: () => makeReducerReport(snapshot, "clean", "head"),
    ...fakeProjectionDependencies(),
    planActions: () => ({ actions: [] }),
  });
  assert.equal(transportCalled, true);
  assert.equal(result.reducer_report.status_target.sha, HEAD);
  assert.deepEqual(result.status_plan.writes, []);
  assert.equal(result.status_plan.terminal_cutover, false);
  assert.equal(
    result.status_plan.suppression_reason,
    "suppressed-unsupported-terminal-target",
  );

  const findingPlan = buildV2StatusPlan({
    decision: "findings",
    status_target_mode: "head",
    status_context: "codex/github-review-gate",
    target: { validated: true, terminal_sha: HEAD },
    snapshot_fingerprint: FINGERPRINT,
  });
  assert.deepEqual(
    findingPlan.writes.map(({ role, sha, state }) => ({ role, sha, state })),
    [{ role: "head-sentinel", sha: HEAD, state: "failure" }],
  );
  assert.equal(findingPlan.terminal_cutover, false);

  const invalidFindingPlan = buildV2StatusPlan({
    decision: "findings",
    status_target_mode: "test-merge-with-head-sentinel",
    status_context: "codex/github-review-gate",
    target: {
      validated: false,
      blocked_reason: "potential-merge-unavailable",
      head_sentinel_sha: HEAD,
      terminal_sha: null,
    },
    snapshot_fingerprint: FINGERPRINT,
  });
  assert.deepEqual(
    invalidFindingPlan.writes.map(({ role, sha, state }) => ({ role, sha, state })),
    [{ role: "head-sentinel", sha: HEAD, state: "failure" }],
  );
  assert.equal(invalidFindingPlan.terminal_cutover, false);
});

function createRunnerLiveTransport(limits = undefined) {
  return createV2GitHubTransport({
    fetch: createRunnerTransportFetch(),
    // review helper synthetic-token pool joey-private-v3: bearer-b
    token: "JoeyPrivateV3BearerSlotB7Q9M3X5",
    restBaseUrl: "https://api.github.test",
    graphqlUrl: "https://api.github.test/graphql",
    ...(limits === undefined ? {} : { limits }),
  });
}

function createRunnerTransportFetch() {
  const repoPath = "/repos/owner/repo";
  const responseHeaders = {
    Date: "Thu, 13 Aug 2026 12:00:00 GMT",
    "Content-Type": "application/json",
  };
  const respond = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
  return async (input, options = {}) => {
    const url = new URL(String(input));
    const body = options.body === undefined
      ? null
      : JSON.parse(String(options.body));
    if (url.pathname === "/graphql") {
      const query = String(body?.query ?? "");
      if (query.includes("CodexReviewGateV2Scope")) {
        return respond({
          data: {
            repository: {
              id: "R_repo",
              name: "repo",
              owner: { login: "owner" },
              pullRequest: {
                id: "PR_node",
                number: 42,
                state: "OPEN",
                merged: false,
                mergedAt: null,
                isDraft: false,
                mergeable: "MERGEABLE",
                baseRefName: "main",
                baseRefOid: sha("a"),
                baseRef: { name: "main", target: { oid: sha("a") } },
                headRefName: "feature",
                headRefOid: HEAD,
                headRef: { name: "feature", target: { oid: HEAD } },
                potentialMergeCommit: {
                  oid: MERGE,
                  tree: { oid: TREE },
                  parents: {
                    totalCount: 2,
                    pageInfo: {
                      hasNextPage: false,
                      endCursor: "parent-2",
                    },
                    nodes: [{ oid: sha("a") }, { oid: HEAD }],
                  },
                },
              },
            },
          },
        });
      }
      if (query.includes("CodexReviewGateV2ReviewThreads")) {
        return respond({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  nodes: [],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          },
        });
      }
      return respond({ errors: [{ message: "unexpected query" }] });
    }
    if (url.pathname === `${repoPath}/pulls/42`) {
      return respond({
        number: 42,
        node_id: "PR_node",
        url: `https://api.github.test${repoPath}/pulls/42`,
        state: "open",
        merged: false,
        merged_at: null,
        mergeable: true,
        merge_commit_sha: MERGE,
        base: { ref: "main", sha: sha("a") },
        head: { ref: "feature", sha: HEAD },
      });
    }
    if (url.pathname === `${repoPath}/compare/${sha("a")}...${HEAD}`) {
      return respond({
        base_commit: { sha: sha("a") },
        merge_base_commit: { sha: sha("a") },
      });
    }
    if (url.pathname === `${repoPath}/git/ref/pull/42/merge`) {
      return respond({
        ref: "refs/pull/42/merge",
        url: `https://api.github.test${repoPath}/git/refs/pull/42/merge`,
        object: {
          type: "commit",
          sha: MERGE,
          url: `https://api.github.test${repoPath}/git/commits/${MERGE}`,
        },
      });
    }
    if ([
      `${repoPath}/issues/42/comments`,
      `${repoPath}/pulls/42/reviews`,
      `${repoPath}/pulls/42/comments`,
      `${repoPath}/issues/42/reactions`,
    ].includes(url.pathname)) {
      return respond([]);
    }
    if (url.pathname === `${repoPath}/commits/${HEAD}/check-runs`) {
      return respond({ total_count: 0, check_runs: [] });
    }
    if (url.pathname === repoPath) {
      return respond({
        full_name: "owner/repo",
        url: `https://api.github.test${repoPath}`,
        role_name: "admin",
        permissions: {
          admin: true,
          maintain: true,
          push: true,
          triage: true,
          pull: true,
        },
      });
    }
    return respond({ message: `unexpected route ${url.pathname}` }, 404);
  };
}

function makeRunnerInput({ operation, snapshot }) {
  return {
    schema: V2_RUNNER_SCHEMA,
    schema_version: 1,
    operation,
    status_target_mode: "test-merge-with-head-sentinel",
    status_context: "codex/github-review-gate",
    snapshot_request: { owner: "owner", repo: "repo", pull_number: 42 },
    controller: {},
    public_report_authority: {
      schema: "codex-review-gate-public-selection-authority-v2",
      schema_version: 1,
      repository_node_id: snapshot.repository.node_id,
      pull_request_node_id: snapshot.pull_request.node_id,
      head_ref_oid: snapshot.scope.head_ref_oid,
      selection: {
        selected: true,
        intent: "explicit",
        mode: "explicit",
        source: "user-explicit",
      },
      server_enforcement: "enforced",
      authority_receipt_digest: digest("f"),
    },
    scheduling: {
      trigger: operation === "evaluate-only" ? "manual" : "initial",
      public_wait_supported: true,
      status_target_mode: "test-merge-with-head-sentinel",
      run_identity: { run_id: "7001", run_attempt: 1 },
      epoch: {
        id: deriveV2EpochId(snapshot),
        started_at: "2026-08-13T11:00:00.000Z",
        controlled_request: null,
        automatic_request: {
          state: "available",
          generation_index: 1,
          recovery_authority: null,
          intent_id: null,
          intent_persisted_at: null,
          effect_attempted_at: null,
        },
      },
      complete_snapshots: [],
      status: {
        exact_sha_context_count: 0,
        latest_idempotency_key: null,
        head_sentinel_receipt: {
          sha: HEAD,
          context: "codex/github-review-gate",
          state: "pending",
          status_id: "9001",
          observed_at: "2026-08-13T11:59:59.000Z",
        },
      },
      applied_action_keys: [],
      no_start_candidate: null,
    },
    head_ledger: null,
    reservation: null,
    post_response: null,
  };
}

function fakeProjectionDependencies() {
  return {
    deriveEvidenceRequest: () => ({
      artifactSelectors: [],
      permissionSubjects: [],
    }),
    projectSnapshots: ({ evidence_snapshot: snapshot }) => ({
      ...snapshot,
      complete: true,
    }),
    projectPublicReport: ({ compact_report: report }) => ({
      schema_version: 2,
      decision: report.decision,
    }),
  };
}

function makeLedger(snapshot, overrides = {}) {
  return {
    schema: V2_HEAD_LEDGER_SCHEMA,
    schema_version: 1,
    repository_node_id: snapshot.repository.node_id,
    pull_request_node_id: snapshot.pull_request.node_id,
    head_ref_oid: snapshot.scope.head_ref_oid,
    automatic_request_count: 0,
    exact_sha_context_count: 0,
    latest_status_idempotency_key: null,
    bound_attempt_ids: [],
    observed_at: "2026-08-13T11:59:59.000Z",
    ...overrides,
  };
}

function makeReducerReport(
  snapshot,
  decision,
  statusTargetMode = "test-merge-with-head-sentinel",
) {
  const cleanArtifact = {
    id: "2001",
    url: `https://github.com/owner/repo/pull/${snapshot.pull_request.number}#issuecomment-2001`,
    created_at: "2026-08-13T11:59:59.000Z",
  };
  const cleanBasis = {
    kind: "terminal-clean",
    scope_assurance: "whole-pr-contractual",
    artifact_id: cleanArtifact.id,
    summary: "Exact terminal clean fixture",
    authority_receipt: {
      selected_request: null,
      selected_artifact: cleanArtifact,
      pagination_sha256: FINGERPRINT,
      final_reread_sha256: FINGERPRINT,
      recovery: null,
      selected_generation: null,
    },
  };
  return {
    schema_version: 2,
    selection: { status: "selected", intent: "explicit", reason: "test" },
    server_enforcement: {
      status: "enforced",
      controller_available: true,
      workflow_present: true,
      workflow_compatible: true,
      ruleset_required: true,
      ruleset_compatible: true,
      app_bound: true,
    },
    review_epoch: {
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
      lifecycle: "open",
    },
    request_policy: {
      status: "compliant",
      selected_request_id: null,
      reason: "test",
      permission_assurance: null,
      request_time_permission: null,
      permission_aba_excluded: null,
      generation_id: null,
      generation_kind: null,
      generation_index: null,
    },
    provider_input_lineage: "unavailable",
    provider_profile: decision === "clean" ? "terminal-payload" : "unknown",
    evidence_basis: decision === "clean" ? cleanBasis : null,
    status_target: {
      mode: statusTargetMode,
      sha: statusTargetMode === "head"
        ? snapshot.scope.head_ref_oid
        : snapshot.scope.potential_merge_oid,
      context: "codex/github-review-gate",
    },
    decision,
    freshness_assurance: "point-in-time",
    snapshot_fingerprint: FINGERPRINT,
  };
}

function makeSnapshot({ base = sha("a") } = {}) {
  const scope = {
    base_ref_name: "main",
    base_ref_tip: base,
    head_ref_name: "feature",
    head_ref_oid: HEAD,
    merge_base_sha: base,
    potential_merge_oid: MERGE,
    potential_merge_tree: TREE,
    ordered_parent_oids: [base, HEAD],
    merge_ref_oid: MERGE,
    mergeable: "MERGEABLE",
  };
  const scopeReceipt = {
    repository_owner: "owner",
    repository_name: "repo",
    repository_node_id: "R_repo",
    pull_request_number: 42,
    pull_request_node_id: "PR_node",
    pull_request_state: "OPEN",
    pull_request_merged: false,
    pull_request_merged_at: null,
    pull_request_is_draft: false,
    ...scope,
    ordered_parent_oids: [...scope.ordered_parent_oids],
    server_time: SERVER_TIME,
  };
  const completeScopeReceipt = scopeReceiptWithEndpointEvidence(scopeReceipt);
  return {
    schema_version: 2,
    repository: { owner: "owner", name: "repo", node_id: "R_repo" },
    pull_request: {
      number: 42,
      node_id: "PR_node",
      state: "OPEN",
      merged: false,
      merged_at: null,
      is_draft: false,
    },
    server_time: SERVER_TIME,
    scope,
    pages: {
      issue_comments: [],
      reviews: [],
      inline_comments: [],
      threads: [],
      reactions: { issue: [], issue_comments: [], reviews: [], inline_comments: [] },
      exact_artifacts: [],
    },
    permissions: makePermissions(),
    service_start_observations: makeServiceStartObservations(),
    scope_receipts: {
      pre: completeScopeReceipt,
      post: structuredClone(completeScopeReceipt),
    },
    completeness: {
      all_pages_loaded: true,
      issue_comments: true,
      reviews: true,
      inline_comments: true,
      threads: true,
      reactions: true,
      permissions: true,
      exact_artifacts: true,
      service_start_observations: true,
      request_count: 1,
      item_count: 0,
      response_bytes: 1,
      server_date_headers: 1,
    },
    stability: {
      scope_stable: true,
      server_time_monotonic: true,
      service_start_observations_stable: true,
    },
  };
}

function scopeReceiptWithEndpointEvidence(receipt) {
  const repoPath = `/repos/${receipt.repository_owner}/` +
    `${receipt.repository_name}`;
  const endpointReceipt = (method, path, status = 200) => ({
    method,
    path,
    status,
    server_time: receipt.server_time,
    raw_body_sha256: digest("e"),
  });
  return {
    ...structuredClone(receipt),
    endpoint_receipts: {
      pull_request: endpointReceipt(
        "GET",
        `${repoPath}/pulls/${receipt.pull_request_number}`,
      ),
      graphql: endpointReceipt("POST", "/graphql"),
      compare:
        receipt.base_ref_tip === null || receipt.head_ref_oid === null
          ? null
          : endpointReceipt(
            "GET",
            `${repoPath}/compare/${receipt.base_ref_tip}...` +
              `${receipt.head_ref_oid}`,
          ),
      merge_ref: endpointReceipt(
        "GET",
        `${repoPath}/git/ref/pull/${receipt.pull_request_number}/merge`,
        receipt.merge_ref_oid === null ? 404 : 200,
      ),
    },
  };
}

function makePostResponse(reservation) {
  return {
    status: 201,
    server_time: "2026-08-13T12:00:01.000Z",
    attempt: buildV2AttemptReceipt({
      reservation,
      recorded_at: reservation.created_at,
    }),
    raw_body: JSON.stringify({
      id: 501,
      node_id: "IC_501",
      url: "https://api.github.test/repos/owner/repo/issues/comments/501",
      html_url: "https://github.com/owner/repo/pull/42#issuecomment-501",
      issue_url: "https://api.github.test/repos/owner/repo/issues/42",
      user: { id: 1001, login: "github-actions[bot]", type: "Bot", node_id: "BOT_actions" },
      performed_via_github_app: {
        id: 15368,
        slug: "github-actions",
        node_id: "APP_actions",
      },
      body: V2_REQUEST_BODY,
      created_at: "2026-08-13T12:00:01.000Z",
      updated_at: "2026-08-13T12:00:01.000Z",
    }),
  };
}

function attemptedSchedulerState(reservation) {
  return {
    state: "effect-attempted",
    generation_index: reservation.generation_index,
    recovery_authority: reservation.recovery_authority,
    intent_id: reservation.scheduler_intent_id,
    intent_persisted_at: reservation.created_at,
    effect_attempted_at: reservation.created_at,
  };
}

function makePermissions() {
  const capability = (responseServerTime, rawBodyCharacter) => ({
    capability_kind: "authenticated-transport-token",
    admin: true,
    maintain: true,
    push: true,
    triage: true,
    pull: true,
    role_name: "admin",
    endpoint: "https://api.github.test/repos/owner/repo",
    http_status: 200,
    response_server_time: responseServerTime,
    raw_body_sha256: digest(rawBodyCharacter),
  });
  return {
    transport_capabilities: {
      stable: true,
      pre: capability("2026-08-13T11:59:59.000Z", "a"),
      post: capability(SERVER_TIME, "b"),
    },
    actor_permissions: [],
  };
}

function makeServiceStartObservations() {
  const receipt = {
    server_time: SERVER_TIME,
    page_count: 1,
    total_check_runs: 0,
    matching_app_ids: [],
    check_runs: [],
    page_receipts: [{
      page: 1,
      item_count: 0,
      total_count: 0,
      response_server_time: SERVER_TIME,
      raw_body_sha256: digest("c"),
    }],
  };
  return {
    provider_app_slug: "chatgpt-codex-connector",
    head_sha: HEAD,
    pre: receipt,
    post: structuredClone(receipt),
    stable: true,
  };
}

function normalizedCreatedComment() {
  return {
    id: "501",
    node_id: "IC_501",
    url: "https://api.github.test/repos/owner/repo/issues/comments/501",
    html_url: "https://github.com/owner/repo/pull/42#issuecomment-501",
    issue_url: "https://api.github.test/repos/owner/repo/issues/42",
    author: {
      id: "1001",
      login: "github-actions[bot]",
      type: "Bot",
      node_id: "BOT_actions",
    },
    app: { id: "15368", slug: "github-actions", node_id: "APP_actions" },
    author_association: "MEMBER",
    body: V2_REQUEST_BODY,
    created_at: "2026-08-13T12:00:01.000Z",
    updated_at: "2026-08-13T12:00:01.000Z",
  };
}

function sha(character) {
  return character.repeat(40);
}

function digest(character) {
  return `sha256:${character.repeat(64)}`;
}
