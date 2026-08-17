import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  MAX_EXACT_STATUS_WRITES,
  PRIVATE_INCONCLUSIVE_AFTER_MS,
  PRIVATE_RECONCILIATION_INTERVAL_MS,
  PUBLIC_INITIAL_WAIT_MS,
  PUBLIC_NO_START_CONFIRMATION_MS,
  PUBLIC_POST_REQUEST_WAIT_MS,
  V2_SCHEDULER_SCHEMA,
  V2_SCHEDULER_SCHEMA_VERSION,
  V2_SCHEDULER_DECISIONS,
  planV2Actions,
} from "../packages/action/src/v2/scheduler.mjs";
import { V2_DECISIONS } from "../packages/action/src/v2/schema.mjs";

const START = "2026-08-13T08:00:00.000Z";
const EPOCH_ID = "repo:1:base:head:merge";
const DIGEST_A = `sha256:${"a".repeat(64)}`;
const SHA_A = "a".repeat(40);

function at(milliseconds) {
  return new Date(Date.parse(START) + milliseconds).toISOString();
}

function snapshot(overrides = {}) {
  return {
    epoch_id: EPOCH_ID,
    decision: "pending",
    complete: true,
    snapshot_id: "snapshot-1",
    snapshot_fingerprint: "snapshot-fingerprint-1",
    observed_at: START,
    provider_activity_fingerprint: "activity-1",
    no_start_candidate: null,
    run_id: "1001",
    run_attempt: 1,
    ...overrides,
  };
}

function automaticRequest(overrides = {}) {
  return {
    state: "available",
    generation_index: 1,
    recovery_authority: null,
    intent_id: null,
    intent_persisted_at: null,
    effect_attempted_at: null,
    ...overrides,
  };
}

function recoveryAuthority(priorGenerationIndex = 1) {
  return {
    prior_generation_id: `automatic:${priorGenerationIndex}`,
    finding_ids: ["finding-1"],
    closure_ids: ["closure-1"],
    closure_observed_at: at(PUBLIC_INITIAL_WAIT_MS - 1),
  };
}

test("a proved prior findings generation schedules only the immediate next generation", () => {
  const plan = planV2Actions(input({
    public_wait_supported: false,
    now: at(PUBLIC_INITIAL_WAIT_MS),
    evaluation: snapshot({
      decision: "findings",
      observed_at: at(PUBLIC_INITIAL_WAIT_MS),
    }),
    epoch: {
      controlled_request: controlledRequest(at(PUBLIC_INITIAL_WAIT_MS - 2)),
      automatic_request: automaticRequest({
        generation_index: 2,
        recovery_authority: recoveryAuthority(1),
      }),
    },
  }));

  assert.deepEqual(plan.actions.map((action) => action.kind), [
    "publish_status",
    "persist_auto_request_intent",
    "post_review_request",
  ]);
  const persist = actionsOfKind(plan, "persist_auto_request_intent")[0];
  const post = actionsOfKind(plan, "post_review_request")[0];
  assert.match(persist.intent_id, /automatic:2/u);
  assert.match(persist.idempotency_key, /automatic:2/u);
  assert.match(post.idempotency_key, /automatic:2/u);

  assert.throws(
    () => planV2Actions(input({
      epoch: {
        controlled_request: null,
        automatic_request: automaticRequest({
          generation_index: 4,
          recovery_authority: recoveryAuthority(3),
        }),
      },
    })),
    /generation_index/u,
  );
  for (const closureObservedAt of [
    new Date(Date.parse(START) - 1).toISOString(),
    at(PUBLIC_INITIAL_WAIT_MS + 1),
  ]) {
    assert.throws(
      () => planV2Actions(input({
        now: at(PUBLIC_INITIAL_WAIT_MS),
        epoch: {
          controlled_request: controlledRequest(
            at(PUBLIC_INITIAL_WAIT_MS - 2),
          ),
          automatic_request: automaticRequest({
            generation_index: 2,
            recovery_authority: {
              ...recoveryAuthority(1),
              closure_observed_at: closureObservedAt,
            },
          }),
        },
      })),
      /within the current review epoch/u,
    );
  }
});

function controlledRequest(boundAt, overrides = {}) {
  return {
    request_id: "1001",
    bound_at: boundAt,
    binding_record_oid: "b".repeat(40),
    binding_receipt_digest: DIGEST_A,
    ...overrides,
  };
}

function input(overrides = {}) {
  const base = {
    schema: V2_SCHEDULER_SCHEMA,
    schema_version: V2_SCHEDULER_SCHEMA_VERSION,
    trigger: "initial",
    now: START,
    public_wait_supported: true,
    status_target_mode: "test-merge-with-head-sentinel",
    epoch: {
      id: EPOCH_ID,
      started_at: START,
      controlled_request: null,
      automatic_request: automaticRequest(),
    },
    evaluation: snapshot(),
    complete_snapshots: [],
    status: {
      exact_sha_context_count: 0,
      latest_idempotency_key: null,
    },
    applied_action_keys: [],
    wait_completions: [],
  };
  return {
    ...base,
    ...overrides,
    epoch: {
      ...base.epoch,
      ...(overrides.epoch || {}),
    },
    status: {
      ...base.status,
      ...(overrides.status || {}),
    },
  };
}

function waitCompletion(stage, deadline, overrides = {}) {
  const generationIndex = overrides.generation_index ?? 1;
  const withoutDigest = {
    schema: "codex-review-gate-public-wait-completion-v2",
    schema_version: 1,
    repository: { owner: "example", name: "repo" },
    pull_request: { number: 7 },
    head_ref_oid: SHA_A,
    epoch_id: EPOCH_ID,
    generation_index: generationIndex,
    stage,
    deadline,
    completed_at: deadline,
    environment: {
      name: `codex-review-gate-${stage}-15m`,
      id: "101",
      wait_timer_rule_id: "201",
      wait_timer_minutes: 15,
    },
    trusted_workflow: {
      repository: "Joey-Tools/codex-review-gate-action",
      path: ".github/workflows/codex-review-gate.yml",
      sha: SHA_A,
    },
    run: {
      run_id: "1001",
      run_attempt: 1,
      wait_job_id: `${stage}-wait`,
      continuation_job_id: `after-${stage}`,
    },
    source_observation_record_oid: "b".repeat(40),
    stage_nonce: "c".repeat(64),
    ...overrides,
  };
  delete withoutDigest.receipt_digest;
  return {
    ...withoutDigest,
    receipt_digest: digestCanonical(
      "codex-review-gate-v2-public-wait-completion",
      withoutDigest,
    ),
  };
}

function digestCanonical(domain, value) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0${canonicalJson(value)}`, "utf8")
    .digest("hex")}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function actionsOfKind(plan, kind) {
  return plan.actions.filter((action) => action.kind === kind);
}

function onlyAction(plan, kind) {
  assert.equal(plan.actions.length, 1);
  assert.equal(plan.actions[0].kind, kind);
  return plan.actions[0];
}

test("exports a closed, versioned, point-in-time plan", () => {
  assert.equal(V2_SCHEDULER_DECISIONS, V2_DECISIONS);
  const plan = planV2Actions(input({ evaluation: null }));

  assert.deepEqual(Object.keys(plan), [
    "schema",
    "schema_version",
    "actions",
    "due_at",
    "required_wait",
    "automatic_retry_stopped",
    "event_wakeup_hints_are_advisory",
    "freshness_assurance",
  ]);
  assert.equal(plan.schema, "codex-review-gate-scheduler-v2");
  assert.equal(plan.schema_version, 1);
  assert.equal(plan.due_at, null);
  assert.equal(plan.event_wakeup_hints_are_advisory, true);
  assert.equal(plan.freshness_assurance, "point-in-time");
  assert.equal(onlyAction(plan, "evaluate_snapshot").reason, "initial-snapshot");
});

test("rejects unknown input, nested, and action-state fields", () => {
  assert.throws(
    () => planV2Actions({ ...input(), surprise: true }),
    /closed schema.*unknown: surprise/,
  );
  assert.throws(
    () => planV2Actions(input({ epoch: { surprise: true } })),
    /epoch must use its closed schema.*unknown: surprise/,
  );
  assert.throws(
    () => planV2Actions(input({
      epoch: { automatic_request: automaticRequest({ state: "posted" }) },
    })),
    /automatic_request.state is not closed/,
  );
});

test("wait completion authority is closed, fresh, unique, and phase-specific", () => {
  const deadline = at(PUBLIC_INITIAL_WAIT_MS);
  assert.throws(
    () => planV2Actions(input({
      now: deadline,
      wait_completions: [waitCompletion("public-initial", deadline, {
        completed_at: at(PUBLIC_INITIAL_WAIT_MS - 1),
      })],
    })),
    /completed_at precedes its deadline/u,
  );
  assert.throws(
    () => planV2Actions(input({
      now: deadline,
      wait_completions: [waitCompletion("public-initial", deadline, {
        trusted_workflow: {
          repository: "example/forged-controller",
          path: ".github/workflows/codex-review-gate.yml",
          sha: SHA_A,
        },
      })],
    })),
    /unsupported trusted workflow/u,
  );
  const postReceipt = waitCompletion("public-post-request", deadline);
  const wrongPhase = planV2Actions(input({
    now: deadline,
    wait_completions: [postReceipt],
  }));
  assert.deepEqual(wrongPhase.actions, []);
  assert.equal(wrongPhase.due_at, deadline);
  assert.throws(
    () => planV2Actions(input({
      now: deadline,
      wait_completions: [postReceipt, structuredClone(postReceipt)],
    })),
    /digest- and phase-unique/u,
  );
  const valid = waitCompletion("public-initial", deadline);
  const cases = [
    [
      waitCompletion("public-initial", deadline, {
        completed_at: at(PUBLIC_INITIAL_WAIT_MS + 1),
      }),
      /completed_at follows its authority boundary/u,
    ],
    [
      waitCompletion("public-initial", deadline, {
        epoch_id: "another-epoch",
      }),
      /belongs to another epoch/u,
    ],
    [
      waitCompletion("public-initial", deadline, {
        generation_index: 2,
      }),
      /belongs to a future generation/u,
    ],
    [
      {
        ...valid,
        receipt_digest:
          `${valid.receipt_digest.slice(0, -1)}${valid.receipt_digest.endsWith("0") ? "1" : "0"}`,
      },
      /receipt_digest does not bind its content/u,
    ],
  ];
  for (const [completion, pattern] of cases) {
    assert.throws(
      () => planV2Actions(input({
        now: deadline,
        wait_completions: [completion],
      })),
      pattern,
    );
  }
  assert.throws(
    () => planV2Actions(input({
      now: at(PUBLIC_INITIAL_WAIT_MS + PUBLIC_POST_REQUEST_WAIT_MS),
      wait_completions: [
        waitCompletion(
          "public-post-request",
          at(PUBLIC_INITIAL_WAIT_MS + PUBLIC_POST_REQUEST_WAIT_MS),
        ),
        valid,
      ],
    })),
    /completion-time ordered/u,
  );
});

test("public orchestration waits 15 minutes before a fresh pre-request evaluation", () => {
  const initial = planV2Actions(input());
  assert.equal(initial.due_at, at(PUBLIC_INITIAL_WAIT_MS));
  assert.deepEqual(initial.required_wait, {
    stage: "public-initial",
    deadline: at(PUBLIC_INITIAL_WAIT_MS),
  });
  assert.deepEqual(initial.actions, []);
  assert.equal(initial.automatic_retry_stopped, false);

  const due = planV2Actions(input({ now: at(PUBLIC_INITIAL_WAIT_MS) }));
  assert.equal(due.due_at, at(PUBLIC_INITIAL_WAIT_MS));
  assert.deepEqual(due.required_wait, {
    stage: "public-initial",
    deadline: at(PUBLIC_INITIAL_WAIT_MS),
  });
  assert.deepEqual(due.actions, []);

  const completed = planV2Actions(input({
    now: at(PUBLIC_INITIAL_WAIT_MS),
    wait_completions: [waitCompletion(
      "public-initial",
      at(PUBLIC_INITIAL_WAIT_MS),
    )],
  }));
  assert.equal(completed.due_at, null);
  assert.equal(completed.required_wait, null);
  assert.deepEqual(completed.actions.map((action) => action.kind), [
    "publish_status",
    "evaluate_snapshot",
  ]);
  assert.equal(
    completed.actions.at(-1).reason,
    "public-initial-wait-complete",
  );
});

test("a fresh pending public snapshot consumes one reservation before one non-retried POST", () => {
  const plan = planV2Actions(input({
    now: at(PUBLIC_INITIAL_WAIT_MS),
    evaluation: snapshot({
      snapshot_id: "snapshot-after-initial-wait",
      snapshot_fingerprint: "snapshot-after-initial-wait-fingerprint",
      observed_at: at(PUBLIC_INITIAL_WAIT_MS),
    }),
    wait_completions: [waitCompletion(
      "public-initial",
      at(PUBLIC_INITIAL_WAIT_MS),
    )],
  }));

  assert.equal(plan.due_at, at(PUBLIC_INITIAL_WAIT_MS + PUBLIC_POST_REQUEST_WAIT_MS));
  assert.deepEqual(plan.required_wait, {
    stage: "public-post-request",
    deadline: at(PUBLIC_INITIAL_WAIT_MS + PUBLIC_POST_REQUEST_WAIT_MS),
  });
  assert.equal(plan.automatic_retry_stopped, true);
  assert.deepEqual(plan.actions.map((action) => action.kind), [
    "publish_status",
    "persist_auto_request_intent",
    "post_review_request",
  ]);
  const persist = actionsOfKind(plan, "persist_auto_request_intent")[0];
  const post = actionsOfKind(plan, "post_review_request")[0];
  assert.equal(persist.consumes_automatic_reservation, true);
  assert.equal(post.depends_on_idempotency_key, persist.idempotency_key);
  assert.equal(post.record_attempt_before_effect, true);
  assert.equal(post.retry_limit, 0);
});

test("a persisted request intent can perform its one effect but an attempted effect is never retried", () => {
  const persisted = planV2Actions(input({
    now: at(PUBLIC_INITIAL_WAIT_MS),
    evaluation: snapshot({ observed_at: at(PUBLIC_INITIAL_WAIT_MS) }),
    epoch: {
      automatic_request: automaticRequest({
        state: "intent-persisted",
        intent_id: "auto-request:intent-1",
        intent_persisted_at: at(PUBLIC_INITIAL_WAIT_MS),
      }),
    },
    wait_completions: [waitCompletion(
      "public-initial",
      at(PUBLIC_INITIAL_WAIT_MS),
    )],
  }));
  assert.equal(actionsOfKind(persisted, "post_review_request").length, 1);
  assert.equal(actionsOfKind(persisted, "post_review_request")[0].retry_limit, 0);

  const attempted = planV2Actions(input({
    now: at(PUBLIC_INITIAL_WAIT_MS + 1),
    evaluation: snapshot({ observed_at: at(PUBLIC_INITIAL_WAIT_MS) }),
    epoch: {
      automatic_request: automaticRequest({
        state: "effect-attempted",
        intent_id: "auto-request:intent-1",
        intent_persisted_at: at(PUBLIC_INITIAL_WAIT_MS),
        effect_attempted_at: at(PUBLIC_INITIAL_WAIT_MS),
      }),
    },
    wait_completions: [waitCompletion(
      "public-initial",
      at(PUBLIC_INITIAL_WAIT_MS),
    )],
  }));
  assert.equal(actionsOfKind(attempted, "post_review_request").length, 0);
  assert.equal(attempted.due_at, at(PUBLIC_INITIAL_WAIT_MS + PUBLIC_POST_REQUEST_WAIT_MS));
});

test("public orchestration waits another 15 minutes after the controlled request", () => {
  const requestAt = at(PUBLIC_INITIAL_WAIT_MS);
  const waiting = planV2Actions(input({
    now: at(PUBLIC_INITIAL_WAIT_MS + 5 * 60 * 1000),
    evaluation: snapshot({ observed_at: at(PUBLIC_INITIAL_WAIT_MS) }),
    epoch: {
      controlled_request: controlledRequest(requestAt),
      automatic_request: automaticRequest({
        state: "effect-attempted",
        intent_id: "auto-request:intent-1",
        intent_persisted_at: requestAt,
        effect_attempted_at: requestAt,
      }),
    },
  }));
  assert.equal(waiting.due_at, at(PUBLIC_INITIAL_WAIT_MS + PUBLIC_POST_REQUEST_WAIT_MS));
  assert.equal(actionsOfKind(waiting, "evaluate_snapshot").length, 0);

  const due = planV2Actions(input({
    now: at(PUBLIC_INITIAL_WAIT_MS + PUBLIC_POST_REQUEST_WAIT_MS),
    evaluation: snapshot({ observed_at: at(PUBLIC_INITIAL_WAIT_MS) }),
    epoch: {
      controlled_request: controlledRequest(requestAt),
      automatic_request: automaticRequest({
        state: "effect-attempted",
        intent_id: "auto-request:intent-1",
        intent_persisted_at: requestAt,
        effect_attempted_at: requestAt,
      }),
    },
  }));
  assert.equal(
    due.due_at,
    at(PUBLIC_INITIAL_WAIT_MS + PUBLIC_POST_REQUEST_WAIT_MS),
  );
  assert.deepEqual(due.actions, []);

  const completed = planV2Actions(input({
    now: at(PUBLIC_INITIAL_WAIT_MS + PUBLIC_POST_REQUEST_WAIT_MS),
    evaluation: snapshot({ observed_at: at(PUBLIC_INITIAL_WAIT_MS) }),
    epoch: {
      controlled_request: controlledRequest(requestAt),
      automatic_request: automaticRequest({
        state: "effect-attempted",
        intent_id: "auto-request:intent-1",
        intent_persisted_at: requestAt,
        effect_attempted_at: requestAt,
      }),
    },
    wait_completions: [waitCompletion(
      "public-post-request",
      at(PUBLIC_INITIAL_WAIT_MS + PUBLIC_POST_REQUEST_WAIT_MS),
    )],
  }));
  assert.equal(completed.due_at, null);
  assert.equal(
    actionsOfKind(completed, "evaluate_snapshot")[0].reason,
    "public-post-request-wait-complete",
  );
});

test("provider event wakeups are opportunistic and never replace the due timer", () => {
  const plan = planV2Actions(input({
    trigger: "provider-event",
    now: at(5 * 60 * 1000),
    evaluation: null,
  }));
  assert.equal(onlyAction(plan, "evaluate_snapshot").reason, "opportunistic-provider-event");
  assert.equal(plan.event_wakeup_hints_are_advisory, true);

  const pending = planV2Actions(input({
    trigger: "provider-event",
    now: at(5 * 60 * 1000),
    evaluation: snapshot({ observed_at: at(5 * 60 * 1000) }),
  }));
  assert.equal(pending.due_at, at(PUBLIC_INITIAL_WAIT_MS));
});

test("schedule and provider wakeups cannot consume an expired deadline alone", () => {
  for (const trigger of ["schedule", "provider-event"]) {
    const plan = planV2Actions(input({
      trigger,
      now: at(PUBLIC_INITIAL_WAIT_MS),
      evaluation: snapshot({
        snapshot_id: `snapshot-${trigger}-at-deadline`,
        observed_at: at(PUBLIC_INITIAL_WAIT_MS),
      }),
    }));
    assert.deepEqual(plan.actions, [], trigger);
    assert.equal(plan.due_at, at(PUBLIC_INITIAL_WAIT_MS), trigger);
  }
});

test("manual dispatch is evaluate-only and cannot publish or request", () => {
  const before = planV2Actions(input({ trigger: "manual", evaluation: null }));
  assert.deepEqual(before.actions.map((action) => action.kind), ["evaluate_snapshot"]);
  assert.equal(before.actions[0].mode, "evaluate-only");
  assert.equal(before.due_at, null);

  const after = planV2Actions(input({
    trigger: "manual",
    evaluation: snapshot({ decision: "clean" }),
  }));
  assert.deepEqual(after.actions, []);
  assert.equal(after.due_at, null);
});

test("not-selected is terminal and cannot publish, request, or schedule follow-up", () => {
  const plan = planV2Actions(input({
    evaluation: snapshot({ decision: "not-selected" }),
  }));
  assert.deepEqual(plan.actions, []);
  assert.equal(plan.due_at, null);
  assert.equal(plan.automatic_retry_stopped, true);
});

test("no-start cannot skip the initial public wait without a controlled request", () => {
  const observedAt = at(
    PUBLIC_INITIAL_WAIT_MS + PUBLIC_POST_REQUEST_WAIT_MS,
  );
  const noStartDeadline = at(
    PUBLIC_INITIAL_WAIT_MS + PUBLIC_POST_REQUEST_WAIT_MS +
      PUBLIC_NO_START_CONFIRMATION_MS,
  );
  const evaluation = snapshot({
    decision: "skipped-unavailable",
    snapshot_id: "pre-request-no-start",
    snapshot_fingerprint: "pre-request-no-start-fingerprint",
    observed_at: observedAt,
    no_start_candidate: {
      artifact_id: "issue-comment-pre-request",
      artifact_digest: DIGEST_A,
      scope_fingerprint: "pre-request-scope",
      lifecycle_fingerprint: "pre-request-lifecycle",
      first_seen_at: at(PUBLIC_INITIAL_WAIT_MS + 1),
    },
  });
  for (const waitCompletions of [
    [],
    [waitCompletion("public-no-start", noStartDeadline)],
  ]) {
    const plan = planV2Actions(input({
      now: noStartDeadline,
      evaluation,
      wait_completions: waitCompletions,
    }));
    assert.deepEqual(plan.actions, []);
    assert.deepEqual(plan.required_wait, {
      stage: "public-initial",
      deadline: at(PUBLIC_INITIAL_WAIT_MS),
    });
    assert.equal(plan.due_at, at(PUBLIC_INITIAL_WAIT_MS));
  }
});

test("no-start needs a second independent stable snapshot at least 15 minutes later", () => {
  const requestAt = at(PUBLIC_INITIAL_WAIT_MS);
  const firstObservedAt = at(PUBLIC_INITIAL_WAIT_MS + PUBLIC_POST_REQUEST_WAIT_MS);
  const candidate = {
    artifact_id: "issue-comment-9001",
    artifact_digest: DIGEST_A,
    scope_fingerprint: "scope-1",
    lifecycle_fingerprint: "open-unmerged-base-head-merge",
    first_seen_at: at(PUBLIC_INITIAL_WAIT_MS + 1),
  };
  const first = snapshot({
    decision: "skipped-unavailable",
    snapshot_id: "no-start-1",
    snapshot_fingerprint: "no-start-snapshot-1",
    observed_at: firstObservedAt,
    provider_activity_fingerprint: "no-provider-activity",
    no_start_candidate: candidate,
  });
  const epoch = {
    controlled_request: controlledRequest(requestAt),
    automatic_request: automaticRequest({
      state: "effect-attempted",
      intent_id: "auto-request:intent-1",
      intent_persisted_at: requestAt,
      effect_attempted_at: requestAt,
    }),
  };

  const waiting = planV2Actions(input({
    now: firstObservedAt,
    evaluation: first,
    epoch,
  }));
  assert.deepEqual(waiting.actions, []);
  assert.deepEqual(waiting.required_wait, {
    stage: "public-post-request",
    deadline: firstObservedAt,
  });
  assert.equal(waiting.due_at, firstObservedAt);

  const postRequestCompletion = waitCompletion(
    "public-post-request",
    firstObservedAt,
  );
  const noStartWaiting = planV2Actions(input({
    now: firstObservedAt,
    evaluation: first,
    epoch,
    wait_completions: [postRequestCompletion],
  }));
  assert.deepEqual(noStartWaiting.actions, []);
  assert.equal(
    noStartWaiting.due_at,
    at(PUBLIC_INITIAL_WAIT_MS + PUBLIC_POST_REQUEST_WAIT_MS + PUBLIC_NO_START_CONFIRMATION_MS),
  );
  assert.deepEqual(noStartWaiting.required_wait, {
    stage: "public-no-start",
    deadline: at(
      PUBLIC_INITIAL_WAIT_MS + PUBLIC_POST_REQUEST_WAIT_MS +
        PUBLIC_NO_START_CONFIRMATION_MS,
    ),
  });

  const secondObservedAt = at(
    PUBLIC_INITIAL_WAIT_MS + PUBLIC_POST_REQUEST_WAIT_MS + PUBLIC_NO_START_CONFIRMATION_MS,
  );
  const second = snapshot({
    decision: "skipped-unavailable",
    snapshot_id: "no-start-2",
    snapshot_fingerprint: "no-start-snapshot-2",
    observed_at: secondObservedAt,
    provider_activity_fingerprint: "no-provider-activity",
    no_start_candidate: candidate,
  });
  const laterStageCannotSkipPostRequest = planV2Actions(input({
    now: secondObservedAt,
    evaluation: second,
    complete_snapshots: [first],
    epoch,
    wait_completions: [waitCompletion(
      "public-no-start",
      secondObservedAt,
    )],
  }));
  assert.deepEqual(laterStageCannotSkipPostRequest.actions, []);
  assert.deepEqual(laterStageCannotSkipPostRequest.required_wait, {
    stage: "public-post-request",
    deadline: firstObservedAt,
  });

  const confirmed = planV2Actions(input({
    now: secondObservedAt,
    evaluation: second,
    complete_snapshots: [first],
    epoch,
    wait_completions: [
      postRequestCompletion,
      waitCompletion("public-no-start", secondObservedAt),
    ],
  }));
  const published = onlyAction(confirmed, "publish_status");
  assert.equal(published.decision, "skipped-unavailable");
  assert.equal(published.required_write_slots, 1);
});

test("no-start confirmation restarts when provider activity or bound artifact state changes", () => {
  const requestAt = at(PUBLIC_INITIAL_WAIT_MS);
  const first = snapshot({
    decision: "blocked-configuration",
    snapshot_id: "no-start-1",
    snapshot_fingerprint: "no-start-snapshot-1",
    observed_at: at(30 * 60 * 1000),
    provider_activity_fingerprint: "activity-before",
    no_start_candidate: {
      artifact_id: "issue-comment-9001",
      artifact_digest: DIGEST_A,
      scope_fingerprint: "scope-1",
      lifecycle_fingerprint: "lifecycle-1",
      first_seen_at: at(PUBLIC_INITIAL_WAIT_MS + 1),
    },
  });
  const current = {
    ...first,
    snapshot_id: "no-start-2",
    snapshot_fingerprint: "no-start-snapshot-2",
    observed_at: at(45 * 60 * 1000),
    provider_activity_fingerprint: "activity-after",
  };
  const plan = planV2Actions(input({
    now: at(45 * 60 * 1000),
    evaluation: current,
    complete_snapshots: [first],
    epoch: {
      controlled_request: controlledRequest(requestAt),
      automatic_request: automaticRequest({
        state: "effect-attempted",
        intent_id: "auto-request:intent-1",
        intent_persisted_at: requestAt,
        effect_attempted_at: requestAt,
      }),
    },
    wait_completions: [waitCompletion(
      "public-post-request",
      at(PUBLIC_INITIAL_WAIT_MS + PUBLIC_POST_REQUEST_WAIT_MS),
    )],
  }));
  assert.deepEqual(actionsOfKind(plan, "publish_status"), []);
  assert.equal(plan.due_at, at(60 * 60 * 1000));
});

test("private planning uses two-hour reconciliation without treating it as an SLA", () => {
  const plan = planV2Actions(input({
    public_wait_supported: false,
    trigger: "initial",
  }));
  assert.equal(plan.due_at, at(PRIVATE_RECONCILIATION_INTERVAL_MS));
  assert.deepEqual(plan.actions.map((action) => action.kind), [
    "publish_status",
    "persist_auto_request_intent",
    "post_review_request",
  ]);

  const lateSchedule = planV2Actions(input({
    public_wait_supported: false,
    trigger: "schedule",
    now: at(3 * 60 * 60 * 1000),
    evaluation: null,
  }));
  assert.equal(onlyAction(lateSchedule, "evaluate_snapshot").reason, "scheduled-reconciliation");
  assert.equal(lateSchedule.due_at, null);
});

test("private six-hour fallback requires two independent complete snapshots", () => {
  assert.equal(PRIVATE_INCONCLUSIVE_AFTER_MS, 6 * 60 * 60 * 1000);
  const requestAt = at(PUBLIC_INITIAL_WAIT_MS);
  const deadlineAt = at(PUBLIC_INITIAL_WAIT_MS + PRIVATE_INCONCLUSIVE_AFTER_MS);
  const first = snapshot({
    snapshot_id: "private-snapshot-1",
    snapshot_fingerprint: "private-fingerprint-1",
    observed_at: at(2 * 60 * 60 * 1000),
    run_id: "1001",
  });
  const current = snapshot({
    snapshot_id: "private-snapshot-2",
    snapshot_fingerprint: "private-fingerprint-2",
    observed_at: deadlineAt,
    run_id: "1002",
  });
  const epoch = { controlled_request: controlledRequest(requestAt) };

  const one = planV2Actions(input({
    public_wait_supported: false,
    trigger: "schedule",
    now: deadlineAt,
    evaluation: current,
    epoch,
  }));
  assert.deepEqual(actionsOfKind(one, "publish_status"), []);
  assert.equal(
    one.due_at,
    at(PUBLIC_INITIAL_WAIT_MS + PRIVATE_INCONCLUSIVE_AFTER_MS +
      PRIVATE_RECONCILIATION_INTERVAL_MS),
  );

  const two = planV2Actions(input({
    public_wait_supported: false,
    trigger: "schedule",
    now: deadlineAt,
    evaluation: current,
    complete_snapshots: [first],
    epoch,
  }));
  const inconclusive = onlyAction(two, "publish_status");
  assert.equal(inconclusive.decision, "inconclusive");
  assert.equal(inconclusive.reason, "inconclusive-timeout");
  assert.equal(inconclusive.required_write_slots, 2);
  assert.equal(two.automatic_retry_stopped, true);

  const sameRun = planV2Actions(input({
    public_wait_supported: false,
    trigger: "schedule",
    now: deadlineAt,
    evaluation: current,
    complete_snapshots: [{ ...first, run_id: current.run_id, run_attempt: 2 }],
    epoch,
  }));
  assert.deepEqual(actionsOfKind(sameRun, "publish_status"), []);
});

test("private inconclusive cannot publish before the six-hour double-snapshot gate", () => {
  const requestAt = at(PUBLIC_INITIAL_WAIT_MS);
  const deadlineAt = at(PUBLIC_INITIAL_WAIT_MS + PRIVATE_INCONCLUSIVE_AFTER_MS);
  const early = planV2Actions(input({
    public_wait_supported: false,
    now: at(4 * 60 * 60 * 1000),
    evaluation: snapshot({
      decision: "inconclusive",
      observed_at: at(4 * 60 * 60 * 1000),
    }),
    epoch: { controlled_request: controlledRequest(requestAt) },
  }));
  assert.equal(actionsOfKind(early, "publish_status")[0].decision, "pending");
  assert.equal(early.due_at, at(6 * 60 * 60 * 1000));

  const atDeadlineWithoutHistory = planV2Actions(input({
    public_wait_supported: false,
    now: deadlineAt,
    evaluation: snapshot({
      decision: "inconclusive",
      snapshot_id: "deadline-inconclusive",
      observed_at: deadlineAt,
    }),
    epoch: { controlled_request: controlledRequest(requestAt) },
  }));
  assert.deepEqual(actionsOfKind(atDeadlineWithoutHistory, "publish_status"), []);
});

test("private timeout starts at the controlled request, never at epoch start", () => {
  const requestAt = at(5 * 60 * 60 * 1000);
  const beforeRequestDeadline = planV2Actions(input({
    public_wait_supported: false,
    trigger: "schedule",
    now: at(6 * 60 * 60 * 1000),
    evaluation: snapshot({
      decision: "inconclusive",
      snapshot_id: "long-pre-request-wait",
      observed_at: at(6 * 60 * 60 * 1000),
      run_id: "2001",
    }),
    epoch: { controlled_request: controlledRequest(requestAt) },
  }));
  assert.equal(onlyAction(beforeRequestDeadline, "publish_status").decision, "pending");
  assert.doesNotMatch(
    JSON.stringify(beforeRequestDeadline),
    /inconclusive-timeout/u,
  );

  const deadlineAt = at(11 * 60 * 60 * 1000);
  const first = snapshot({
    snapshot_id: "post-request-run-1",
    observed_at: at(7 * 60 * 60 * 1000),
    run_id: "2001",
  });
  const current = snapshot({
    snapshot_id: "post-request-run-2",
    observed_at: deadlineAt,
    run_id: "2002",
  });
  const timedOut = planV2Actions(input({
    public_wait_supported: false,
    trigger: "schedule",
    now: deadlineAt,
    evaluation: current,
    complete_snapshots: [first],
    epoch: { controlled_request: controlledRequest(requestAt) },
  }));
  const publish = onlyAction(timedOut, "publish_status");
  assert.equal(publish.decision, "inconclusive");
  assert.equal(publish.reason, "inconclusive-timeout");
});

test("late trustworthy evidence recovers after the private inconclusive deadline", () => {
  const lateClean = snapshot({
    decision: "clean",
    snapshot_id: "late-clean",
    snapshot_fingerprint: "late-clean-fingerprint",
    observed_at: at(8 * 60 * 60 * 1000),
  });
  const plan = planV2Actions(input({
    public_wait_supported: false,
    trigger: "schedule",
    now: lateClean.observed_at,
    evaluation: lateClean,
    epoch: {
      automatic_request: automaticRequest({
        state: "effect-attempted",
        intent_id: "auto-request:intent-1",
        intent_persisted_at: START,
        effect_attempted_at: START,
      }),
    },
  }));
  assert.equal(onlyAction(plan, "publish_status").decision, "clean");
  assert.equal(plan.automatic_retry_stopped, true);
  assert.equal(plan.due_at, at(10 * 60 * 60 * 1000));
});

test("schedule still evaluates an already-successful open epoch", () => {
  const plan = planV2Actions(input({
    public_wait_supported: false,
    trigger: "schedule",
    now: at(4 * 60 * 60 * 1000),
    evaluation: null,
    epoch: {
      automatic_request: automaticRequest({
        state: "effect-attempted",
        intent_id: "auto-request:intent-1",
        intent_persisted_at: START,
        effect_attempted_at: START,
      }),
    },
  }));
  assert.equal(onlyAction(plan, "evaluate_snapshot").reason, "scheduled-reconciliation");
});

test("status publication is idempotent and exact sha/context counts fail closed", () => {
  const clean = snapshot({ decision: "clean" });
  const first = planV2Actions(input({
    public_wait_supported: false,
    evaluation: clean,
  }));
  const publish = onlyAction(first, "publish_status");
  assert.equal(publish.required_write_slots, 1);

  const duplicate = planV2Actions(input({
    public_wait_supported: false,
    evaluation: clean,
    status: { latest_idempotency_key: publish.idempotency_key },
  }));
  assert.deepEqual(duplicate.actions, []);

  const oneSlot = planV2Actions(input({
    public_wait_supported: false,
    evaluation: snapshot({ decision: "findings" }),
    status: { exact_sha_context_count: MAX_EXACT_STATUS_WRITES - 1 },
  }));
  const ledger = onlyAction(oneSlot, "record_head_ledger");
  assert.equal(ledger.decision, "blocked-input");
  assert.equal(ledger.reason, "status-cap-exhausted");
  assert.equal(ledger.required_write_slots, 2);
  assert.equal(oneSlot.automatic_retry_stopped, true);

  const exhausted = planV2Actions(input({
    public_wait_supported: false,
    evaluation: snapshot({ decision: "findings" }),
    status: { exact_sha_context_count: MAX_EXACT_STATUS_WRITES },
  }));
  assert.equal(onlyAction(exhausted, "record_head_ledger").reason, "status-cap-exhausted");

  const lastPendingSlot = planV2Actions(input({
    public_wait_supported: false,
    epoch: {
      automatic_request: automaticRequest({
        state: "effect-attempted",
        intent_id: "auto-request:intent-1",
        intent_persisted_at: START,
        effect_attempted_at: START,
      }),
    },
    status: { exact_sha_context_count: MAX_EXACT_STATUS_WRITES - 1 },
  }));
  assert.equal(onlyAction(lastPendingSlot, "publish_status").required_write_slots, 1);
  assert.equal(lastPendingSlot.due_at, at(PRIVATE_RECONCILIATION_INTERVAL_MS));

  const lastCleanSlot = planV2Actions(input({
    public_wait_supported: false,
    evaluation: clean,
    status: { exact_sha_context_count: MAX_EXACT_STATUS_WRITES - 1 },
  }));
  assert.equal(onlyAction(lastCleanSlot, "publish_status").required_write_slots, 1);

  for (const decision of [
    "findings",
    "blocked-configuration",
    "blocked-input",
  ]) {
    const negative = planV2Actions(input({
      public_wait_supported: false,
      evaluation: snapshot({ decision }),
    }));
    assert.equal(
      onlyAction(negative, "publish_status").required_write_slots,
      2,
      `${decision} must reserve the potential-merge and head-sentinel writes`,
    );
  }
});

test("head mode authorizes only non-success sentinel writes", () => {
  const clean = planV2Actions(input({
    public_wait_supported: false,
    status_target_mode: "head",
    evaluation: snapshot({ decision: "clean" }),
  }));
  assert.deepEqual(actionsOfKind(clean, "publish_status"), []);

  const findings = planV2Actions(input({
    public_wait_supported: false,
    status_target_mode: "head",
    evaluation: snapshot({ decision: "findings" }),
    status: { exact_sha_context_count: MAX_EXACT_STATUS_WRITES - 1 },
  }));
  assert.equal(onlyAction(findings, "publish_status").required_write_slots, 1);
});

test("an applied action key suppresses a duplicate declarative effect", () => {
  const first = planV2Actions(input({
    public_wait_supported: false,
    evaluation: snapshot({ decision: "findings" }),
  }));
  const key = first.actions[0].idempotency_key;
  const second = planV2Actions(input({
    public_wait_supported: false,
    evaluation: snapshot({ decision: "findings" }),
    applied_action_keys: [key],
  }));
  assert.deepEqual(second.actions, []);
});
