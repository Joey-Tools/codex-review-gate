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
  runV2Operation,
} from "../packages/action/src/v2/runner.mjs";

const HEAD = sha("b");
const MERGE = sha("c");
const TREE = sha("d");
const FINGERPRINT = digest("a");
const SERVER_TIME = "2026-08-13T12:00:00.000Z";

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
    scheduler_post_action: {
      kind: "post_review_request",
      intent_id: "scheduler-intent",
      retry_limit: 0,
      record_attempt_before_effect: true,
    },
  });

  assert.equal(reservation.body, V2_REQUEST_BODY);
  assert.equal(reservation.ordinal, 1);
  assert.equal(reservation.scheduler_intent_id, "scheduler-intent");
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
      scheduler_post_action: {
        kind: "post_review_request",
        intent_id: "scheduler-intent",
        retry_limit: 0,
        record_attempt_before_effect: true,
      },
    }),
    /consumed 3 automatic reservations/u,
  );
  assert.throws(
    () => prepareV2Request({
      snapshot,
      head_ledger: makeLedger(snapshot),
      scheduler_post_action: {
        kind: "post_review_request",
        intent_id: "scheduler-intent",
        retry_limit: 1,
        record_attempt_before_effect: true,
      },
    }),
    /retry-zero/u,
  );
});

test("automatic generation two requires a prior-generation recovery authority", () => {
  const snapshot = makeSnapshot();
  const ledger = makeLedger(snapshot, { automatic_request_count: 1 });
  const action = {
    kind: "post_review_request",
    intent_id: "scheduler-intent-2",
    retry_limit: 0,
    record_attempt_before_effect: true,
  };
  assert.throws(
    () => prepareV2Request({ snapshot, head_ledger: ledger, scheduler_post_action: action }),
    /recovery_authority/u,
  );
  const reservation = prepareV2Request({
    snapshot,
    head_ledger: ledger,
    scheduler_post_action: {
      ...action,
      recovery_authority: {
        prior_generation_id: "automatic:1",
        finding_ids: ["finding-1"],
        closure_ids: ["closure-1"],
        closure_observed_at: "2026-08-13T11:59:59.000Z",
      },
    },
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
    scheduler_post_action: {
      kind: "post_review_request",
      intent_id: "scheduler-intent",
      retry_limit: 0,
      record_attempt_before_effect: true,
    },
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
    scheduler_post_action: {
      kind: "post_review_request",
      intent_id: "scheduler-intent",
      retry_limit: 0,
      record_attempt_before_effect: true,
    },
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
