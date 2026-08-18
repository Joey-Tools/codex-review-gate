import assert from "node:assert/strict";
import test from "node:test";

import {
  TERMINAL_V2_DECISIONS,
  V2_DECISIONS,
  V2_NO_START_BODIES,
  V2_PROVIDER_PROFILES,
  V2_REDUCER_INPUT_SCHEMA,
  V2_REDUCER_OUTPUT_SCHEMA,
  assertV2ReducerInput,
  assertV2ReducerOutput,
  reduceV2Snapshot,
} from "../packages/action/src/v2/reducer.mjs";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const MERGE = "c".repeat(40);
const TREE = "d".repeat(40);
const MERGE_BASE = "f".repeat(40);
const DIGEST = `sha256:${"e".repeat(64)}`;
const OPTIONS = {
  status_target_mode: "test-merge-with-head-sentinel",
  status_context: "codex/github-review-gate",
};

function snapshot(overrides = {}) {
  const value = {
    schema_version: 2,
    observed_at: "2026-08-13T12:30:00Z",
    snapshot_fingerprint: DIGEST,
    complete: true,
    selection: {
      intent: "implicit",
      eligible: true,
      reason: "Repository selected by the organization ruleset",
    },
    server_enforcement: {
      controller_available: true,
      workflow_present: true,
      workflow_compatible: true,
      ruleset_required: true,
      ruleset_compatible: true,
      app_bound: true,
    },
    review_epoch: {
      repository_id: "R_repo",
      pull_request_number: 7,
      base_oid: BASE,
      head_oid: HEAD,
      merge_base_oid: MERGE_BASE,
      merge_oid: MERGE,
      merge_tree_oid: TREE,
      merge_parents: [BASE, HEAD],
      merge_ref_oid: MERGE,
      mergeable: "MERGEABLE",
      lifecycle: "open",
    },
    scope_stable: true,
    inventories: {
      requests: true,
      artifacts: true,
      threads: true,
      acknowledgements: true,
      no_start: true,
    },
    requests: [],
    artifacts: [],
    threads: [],
    acknowledgements: [],
    no_start_observations: [],
    generation_admissions: [],
    evidence_authority: {
      pagination_sha256: DIGEST,
      final_reread_sha256: DIGEST,
    },
    budget: {
      automatic_requests_on_head: 0,
      automatic_reservations_on_head: 0,
      manual_requests_in_epoch: 0,
    },
  };
  return merge(value, overrides);
}

function automaticRequest(overrides = {}) {
  const value = {
    id: "1001",
    url: "https://github.com/owner/repo/pull/7#issuecomment-1001",
    kind: "automatic",
    body: "@codex review",
    created_at: "2026-08-13T12:00:00Z",
    updated_at: "2026-08-13T12:00:00Z",
    controlled: true,
    stable: true,
    base_oid: BASE,
    head_oid: HEAD,
    current_incarnation: true,
    actor_permission: null,
    generation_id: "automatic:1",
    generation_kind: "automatic",
    generation_index: 1,
    ...overrides,
  };
  value.url = overrides.url ??
    `https://github.com/owner/repo/pull/7#issuecomment-${value.id}`;
  return value;
}

function generationAdmission(prior, next, overrides = {}) {
  return {
    prior_generation_id: prior.generation_id,
    next_generation_id: next.generation_id,
    prior_request_id: prior.id,
    next_request_id: next.id,
    head_oid: HEAD,
    prior_request_binding_record_oid: "1".repeat(40),
    recovery_transition_record_oid: "2".repeat(40),
    recovery_transition_payload_digest: `sha256:${"2".repeat(64)}`,
    next_request_binding_record_oid: "3".repeat(40),
    next_request_binding_payload_digest: `sha256:${"3".repeat(64)}`,
    transition_server_time: "2026-08-13T12:04:00Z",
    ledger_order: {
      prior_request_binding_index: 10,
      recovery_transition_index: 11,
      next_request_binding_index: 12,
    },
    ...overrides,
  };
}

function manualRequest(overrides = {}) {
  const value = {
    id: "1002",
    url: "https://github.com/owner/repo/pull/7#issuecomment-1002",
    kind: "manual",
    body: "@codex review",
    created_at: "2026-08-13T12:00:00Z",
    updated_at: "2026-08-13T12:00:00Z",
    controlled: false,
    stable: true,
    base_oid: BASE,
    head_oid: HEAD,
    current_incarnation: true,
    actor_permission: {
      assurance: "point-in-time-only",
      request_time_permission: "unproven",
      permission_aba_excluded: false,
      initial: {
        observed_at: "2026-08-13T12:01:00Z",
        actor: { id: "501", login: "maintainer", type: "User" },
        push: true,
      },
      final: {
        observed_at: "2026-08-13T12:20:00Z",
        actor: { id: "501", login: "maintainer", type: "User" },
        push: true,
      },
    },
    generation_id: "manual:1",
    generation_kind: "manual",
    generation_index: 1,
    ...overrides,
  };
  value.url = overrides.url ??
    `https://github.com/owner/repo/pull/7#issuecomment-${value.id}`;
  return value;
}

function artifact(kind, overrides = {}) {
  const value = {
    id: kind === "terminal-clean" ? "2001" : "2002",
    url: `https://github.com/owner/repo/pull/7#issuecomment-${
      kind === "terminal-clean" ? "2001" : "2002"
    }`,
    kind,
    channel: "issue-comment",
    request_id: null,
    created_at: "2026-08-13T12:10:00Z",
    commit_oid: HEAD,
    stable: true,
    finding_ids: kind === "terminal-findings" ? ["finding-1"] : [],
    ...overrides,
  };
  value.url = overrides.url ??
    `https://github.com/owner/repo/pull/7#issuecomment-${value.id}`;
  return value;
}

function snapshotWithBoundTerminalClean(overrides = {}) {
  const request = automaticRequest();
  return snapshot(merge({
    requests: [request],
    artifacts: [artifact("terminal-clean", { request_id: request.id })],
    budget: {
      automatic_requests_on_head: 1,
      automatic_reservations_on_head: 1,
    },
  }, overrides));
}

function acknowledgement(kind, overrides = {}) {
  return {
    id: kind === "plus-one" ? "3001" : kind === "eyes" ? "3002" : "3003",
    kind,
    request_id: kind === "addressed" ? null : "1001",
    finding_id: kind === "addressed" ? "finding-1" : null,
    created_at: "2026-08-13T12:15:00Z",
    commit_oid: HEAD,
    exact_provider: kind !== "addressed",
    stable: true,
    ...overrides,
  };
}

function inlineThread(overrides = {}) {
  return {
    id: "4001",
    finding_id: "finding-1",
    kind: "inline",
    created_at: "2026-08-13T12:10:00Z",
    is_resolved: false,
    resolution_observed_at: null,
    stable: true,
    ...overrides,
  };
}

function noStart(overrides = {}) {
  const value = {
    id: "5001",
    url: "https://github.com/owner/repo/pull/7#issuecomment-5001",
    request_id: "1001",
    body: V2_NO_START_BODIES[0],
    carrier_created_at: "2026-08-13T12:00:30Z",
    exact_provider: true,
    stable: true,
    first_seen_at: "2026-08-13T12:01:00Z",
    confirmed_at: "2026-08-13T12:16:00Z",
    first_run_id: "6001",
    confirmation_run_id: "6002",
    request_run_id: "6000",
    ...overrides,
  };
  value.url = overrides.url ??
    `https://github.com/owner/repo/pull/7#issuecomment-${value.id}`;
  return value;
}

function merge(base, overrides) {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(overrides)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key])
    ) {
      result[key] = { ...result[key], ...value };
    } else {
      result[key] = value;
    }
  }
  return result;
}

test("exports a closed v2 schema and exact enum sets", () => {
  assert.equal(V2_REDUCER_INPUT_SCHEMA.schema_version, 2);
  assert.equal(V2_REDUCER_OUTPUT_SCHEMA.schema_version, 2);
  assert.deepEqual(V2_DECISIONS, [
    "not-selected",
    "pending",
    "clean",
    "findings",
    "inconclusive",
    "skipped-unavailable",
    "blocked-configuration",
    "blocked-input",
  ]);
  assert.deepEqual(V2_PROVIDER_PROFILES, [
    "terminal-payload",
    "thumbs-up-clean",
    "mixed",
    "no-start-rejection",
    "unknown",
    null,
  ]);
  assert.deepEqual(
    [...TERMINAL_V2_DECISIONS],
    [
      "clean",
      "findings",
      "inconclusive",
      "skipped-unavailable",
      "blocked-configuration",
      "blocked-input",
    ],
  );
});

test("rejects unknown input and output keys", () => {
  const input = snapshot();
  input.surprise = true;
  assert.throws(() => assertV2ReducerInput(input), /closed key set/);

  const report = reduceV2Snapshot(snapshot(), OPTIONS);
  report.surprise = true;
  assert.throws(() => assertV2ReducerOutput(report), /closed key set/);

  const missingChannel = artifact("terminal-clean");
  delete missingChannel.channel;
  assert.throws(
    () => assertV2ReducerInput(snapshot({ artifacts: [missingChannel] })),
    /closed key set/u,
  );
  assert.throws(
    () => assertV2ReducerInput(snapshot({
      artifacts: [artifact("terminal-clean", { channel: "review" })],
    })),
    /must be one of/u,
  );
});

test("rejects duplicate evidence identities instead of selecting one arbitrarily", () => {
  const request = automaticRequest();
  assert.throws(
    () => assertV2ReducerInput(snapshot({ requests: [request, structuredClone(request)] })),
    /duplicate id/,
  );
  assert.throws(
    () => assertV2ReducerInput(snapshot({
      threads: [inlineThread(), inlineThread({ id: "4002" })],
    })),
    /duplicate finding_id/,
  );
  assert.throws(
    () => assertV2ReducerInput(snapshot({
      artifacts: [
        artifact("terminal-findings"),
        artifact("terminal-findings", { id: "2004" }),
      ],
    })),
    /repeat finding_ids/,
  );
});

test("returns not-selected without evaluating provider evidence", () => {
  const report = reduceV2Snapshot(
    snapshot({ selection: { intent: "disabled", eligible: false, reason: "Opted out" } }),
    OPTIONS,
  );
  assert.equal(report.decision, "not-selected");
  assert.equal(report.selection.status, "not-selected");
  assert.equal(report.server_enforcement.status, "not-applicable");
  assert.equal(report.provider_profile, null);
  assert.equal(report.evidence_basis, null);
});

test("early non-provider decisions tolerate an unavailable test-merge target", () => {
  const unavailableTarget = {
    mergeable: "UNKNOWN",
    merge_oid: null,
    merge_tree_oid: null,
    merge_ref_oid: null,
    merge_parents: [],
  };
  for (const mergeable of ["CONFLICTING", "UNKNOWN"]) {
    const notSelected = reduceV2Snapshot(
      snapshot({
        selection: { intent: "disabled", eligible: false, reason: "Opted out" },
        review_epoch: { ...unavailableTarget, mergeable },
      }),
      OPTIONS,
    );
    assert.equal(notSelected.decision, "not-selected", mergeable);
    assert.equal(notSelected.status_target.sha, null, mergeable);

    const blockedConfiguration = reduceV2Snapshot(
      snapshot({
        review_epoch: { ...unavailableTarget, mergeable },
        server_enforcement: { app_bound: false },
      }),
      OPTIONS,
    );
    assert.equal(blockedConfiguration.decision, "blocked-configuration", mergeable);
    assert.equal(blockedConfiguration.status_target.sha, null, mergeable);
  }

  const forgedPending = reduceV2Snapshot(snapshot(), OPTIONS);
  Object.assign(forgedPending.review_epoch, unavailableTarget);
  forgedPending.status_target.sha = null;
  assert.throws(
    () => assertV2ReducerOutput(forgedPending),
    /null status target requires an input blocker or independent negative provider evidence/u,
  );

  const forgedNoStartBlock = reduceV2Snapshot(snapshot({
    selection: { intent: "explicit" },
    requests: [automaticRequest()],
    no_start_observations: [noStart()],
    budget: {
      automatic_requests_on_head: 1,
      automatic_reservations_on_head: 1,
    },
  }), OPTIONS);
  Object.assign(forgedNoStartBlock.review_epoch, unavailableTarget);
  forgedNoStartBlock.status_target.sha = null;
  assert.throws(
    () => assertV2ReducerOutput(forgedNoStartBlock),
    /null status target requires an input blocker or independent negative provider evidence/u,
  );
});

test("blocks an epoch that does not bind merge-base and ordered parents", () => {
  const report = reduceV2Snapshot(
    snapshot({ review_epoch: { merge_parents: [HEAD, BASE] } }),
    OPTIONS,
  );
  assert.equal(report.decision, "blocked-input");
  assert.equal(report.evidence_basis.kind, "input");
});

test("blocks a missing epoch foundation before provider evaluation in both target modes", () => {
  const modes = [
    OPTIONS,
    {
      status_target_mode: "head",
      status_context: "codex/github-review-gate",
    },
  ];
  for (const missing of ["base_oid", "merge_base_oid"]) {
    for (const options of modes) {
      const report = reduceV2Snapshot(
        snapshot({
          review_epoch: { [missing]: null },
          artifacts: [artifact("terminal-findings")],
        }),
        options,
      );
      assert.equal(report.selection.status, "selected");
      assert.equal(report.decision, "blocked-input");
      assert.equal(report.request_policy.status, "not-applicable");
      assert.equal(report.provider_profile, null);
      assert.equal(report.evidence_basis, null);
      assert.equal(
        report.status_target.sha,
        options.status_target_mode === "head" ? HEAD : null,
      );
      assert.doesNotThrow(() => assertV2ReducerOutput(report));
    }
  }

  const forged = reduceV2Snapshot(
    snapshot({ review_epoch: { merge_base_oid: null } }),
    {
      status_target_mode: "head",
      status_context: "codex/github-review-gate",
    },
  );
  forged.provider_profile = "unknown";
  assert.throws(
    () => assertV2ReducerOutput(forged),
    /requires a bound epoch foundation or the closed pre-provider blocker/u,
  );

  const forgedBoundEpoch = reduceV2Snapshot(
    snapshot({ review_epoch: { merge_ref_oid: "9".repeat(40) } }),
    OPTIONS,
  );
  forgedBoundEpoch.provider_profile = null;
  forgedBoundEpoch.evidence_basis = null;
  assert.throws(
    () => assertV2ReducerOutput(forgedBoundEpoch),
    /null blocked-input basis is reserved for the closed pre-provider epoch blocker/u,
  );
});

test("head status mode requires only the canonical epoch foundation", () => {
  const report = reduceV2Snapshot(
    snapshot({
      review_epoch: {
        merge_oid: null,
        merge_tree_oid: null,
        merge_ref_oid: null,
        merge_parents: [],
        mergeable: "UNKNOWN",
      },
    }),
    {
      status_target_mode: "head",
      status_context: "codex/github-review-gate",
    },
  );
  assert.equal(report.decision, "pending");
  assert.equal(report.provider_profile, "unknown");
  assert.equal(report.status_target.sha, HEAD);
  assert.doesNotThrow(() => assertV2ReducerOutput(report));
});

test("blocks missing server-side enforcement", () => {
  const report = reduceV2Snapshot(
    snapshot({ server_enforcement: { app_bound: false } }),
    OPTIONS,
  );
  assert.equal(report.decision, "blocked-configuration");
  assert.equal(report.server_enforcement.status, "not-enforced");
  assert.equal(report.evidence_basis.kind, "configuration");
});

test("blocks a required missing or incompatible ruleset without falsifying intent", () => {
  const report = reduceV2Snapshot(
    snapshot({
      server_enforcement: { ruleset_required: true, ruleset_compatible: false },
    }),
    OPTIONS,
  );
  assert.equal(report.decision, "blocked-configuration");
  assert.equal(report.server_enforcement.ruleset_required, true);
  assert.equal(report.server_enforcement.ruleset_compatible, false);
  assert.equal(report.server_enforcement.status, "not-enforced");
});

test("evaluates optional ruleset and explicit no-infrastructure selections as not-enforced", () => {
  const workflowOnly = reduceV2Snapshot(
    snapshotWithBoundTerminalClean({
      server_enforcement: {
        controller_available: true,
        workflow_present: true,
        workflow_compatible: true,
        ruleset_required: false,
        ruleset_compatible: false,
        app_bound: false,
      },
    }),
    OPTIONS,
  );
  assert.equal(workflowOnly.decision, "inconclusive");
  assert.equal(workflowOnly.server_enforcement.status, "not-enforced");

  const explicit = reduceV2Snapshot(
    snapshotWithBoundTerminalClean({
      selection: { intent: "explicit", reason: "User explicitly selected review" },
      server_enforcement: {
        controller_available: true,
        workflow_present: false,
        workflow_compatible: false,
        ruleset_required: false,
        ruleset_compatible: false,
        app_bound: false,
      },
    }),
    OPTIONS,
  );
  assert.equal(explicit.decision, "inconclusive");
  assert.equal(explicit.server_enforcement.status, "not-enforced");
});

test("projects invalid test-merge facts to a null blocked-input target", () => {
  for (const reviewEpoch of [
    { merge_oid: null, merge_tree_oid: null, merge_ref_oid: null, merge_parents: [] },
    { mergeable: "CONFLICTING", merge_oid: null, merge_tree_oid: null, merge_ref_oid: null, merge_parents: [] },
    { merge_ref_oid: "9".repeat(40) },
    { merge_parents: [HEAD, BASE] },
  ]) {
    const report = reduceV2Snapshot(snapshot({ review_epoch: reviewEpoch }), OPTIONS);
    assert.equal(report.decision, "blocked-input");
    assert.equal(report.status_target.sha, null);
    assert.doesNotThrow(() => assertV2ReducerOutput(report));
  }
});

test("invalid potential targets preserve independent terminal evidence", () => {
  const invalidEpoch = {
    mergeable: "CONFLICTING",
    merge_oid: null,
    merge_tree_oid: null,
    merge_ref_oid: null,
    merge_parents: [],
  };
  const findings = reduceV2Snapshot(snapshot({
    review_epoch: invalidEpoch,
    artifacts: [artifact("terminal-findings")],
  }), OPTIONS);
  assert.equal(findings.selection.status, "selected");
  assert.equal(findings.decision, "findings");
  assert.equal(findings.provider_profile, "terminal-payload");
  assert.equal(findings.evidence_basis.kind, "terminal-findings");
  assert.equal(
    findings.evidence_basis.scope_assurance,
    "artifact-publication-only",
  );
  assert.equal(findings.status_target.sha, null);

  const clean = reduceV2Snapshot(snapshotWithBoundTerminalClean({
    review_epoch: invalidEpoch,
  }), OPTIONS);
  assert.equal(clean.selection.status, "selected");
  assert.equal(clean.decision, "blocked-input");
  assert.equal(clean.provider_profile, "terminal-payload");
  assert.equal(clean.evidence_basis.kind, "input");
  assert.equal(clean.evidence_basis.artifact_id, "2001");
  assert.deepEqual(clean.evidence_basis.authority_receipt.selected_artifact, {
    id: "2001",
    url: "https://github.com/owner/repo/pull/7#issuecomment-2001",
    created_at: "2026-08-13T12:10:00Z",
  });
  assert.equal(clean.status_target.sha, null);
});

test("returns pending before a request for both public target modes", () => {
  const mergeReport = reduceV2Snapshot(snapshot(), OPTIONS);
  assert.equal(mergeReport.decision, "pending");
  assert.equal(mergeReport.status_target.sha, MERGE);
  assert.equal(mergeReport.request_policy.status, "compliant");

  const headReport = reduceV2Snapshot(snapshot(), {
    status_target_mode: "head",
    status_context: "codex/github-review-gate",
  });
  assert.equal(headReport.decision, "pending");
  assert.equal(headReport.status_target.mode, "head");
  assert.equal(headReport.status_target.sha, HEAD);
  assert.doesNotThrow(() => assertV2ReducerOutput(headReport));
});

test("accepts the sealed projector-shaped fixture with opaque transport identities", () => {
  const projected = snapshot({
    observed_at: "2026-08-13T12:30:00.000Z",
    review_epoch: {
      repository_id: "R_repo",
      merge_base_oid: MERGE_BASE,
      merge_parents: [BASE, HEAD],
    },
  });
  assert.doesNotThrow(() => assertV2ReducerInput(projected));
  const report = reduceV2Snapshot(projected, OPTIONS);
  assert.equal(report.review_epoch.repository_id, "R_repo");
  assert.equal(report.review_epoch.merge_base_oid, MERGE_BASE);
  assert.deepEqual(report.review_epoch.merge_parents, [BASE, HEAD]);
  assert.doesNotThrow(() => assertV2ReducerOutput(report));
});

test("retains a stable terminal clean payload as audit-only classification", () => {
  const report = reduceV2Snapshot(
    snapshotWithBoundTerminalClean(),
    OPTIONS,
  );
  assert.equal(report.decision, "inconclusive");
  assert.equal(report.provider_profile, "terminal-payload");
  assert.equal(report.provider_input_lineage, "unavailable");
  assert.equal(report.evidence_basis.kind, "terminal-clean");
  assert.equal(report.evidence_basis.scope_assurance, "artifact-publication-only");
  assert.equal(report.evidence_basis.artifact_id, "2001");
  assert.equal(report.evidence_basis.authority_receipt.selected_request, null);
  assert.equal(report.evidence_basis.authority_receipt.selected_generation, null);
  assert.equal(report.evidence_basis.authority_receipt.recovery, null);
});

test("terminal clean classification rejects request-generation lineage", () => {
  const report = reduceV2Snapshot(
    snapshotWithBoundTerminalClean(),
    OPTIONS,
  );
  const request = automaticRequest();
  report.evidence_basis.authority_receipt.selected_request = {
    id: request.id,
    url: request.url,
    created_at: request.created_at,
  };
  report.evidence_basis.authority_receipt.selected_generation = {
    id: request.generation_id,
    kind: request.generation_kind,
    index: request.generation_index,
  };

  assert.throws(
    () => assertV2ReducerOutput(report),
    /terminal clean classification lineage must be null/u,
  );
});

test("does not accept a terminal artifact bound to another head", () => {
  const report = reduceV2Snapshot(
    snapshotWithBoundTerminalClean({
      artifacts: [artifact("terminal-clean", {
        request_id: "1001",
        commit_oid: "9".repeat(40),
      })],
    }),
    OPTIONS,
  );
  assert.equal(report.decision, "pending");
  assert.equal(report.provider_profile, "unknown");
  assert.equal(report.evidence_basis, null);
});

test("same-head evidence from an earlier base cannot authorize the current review epoch",
  async (context) => {
    const priorBaseRequest = automaticRequest({ base_oid: "9".repeat(40) });
    const currentManualRequest = manualRequest();
    const laterPriorBaseManualRequest = manualRequest({
      id: "1004",
      base_oid: "9".repeat(40),
      created_at: "2026-08-13T12:05:00Z",
      updated_at: "2026-08-13T12:05:00Z",
      generation_id: "manual:2",
      generation_index: 2,
    });
    const cases = [
      {
        name: "terminal clean bound to an earlier-base request",
        input: snapshot({
          requests: [priorBaseRequest],
          artifacts: [artifact("terminal-clean", {
            request_id: priorBaseRequest.id,
          })],
          budget: {
            automatic_requests_on_head: 1,
            automatic_reservations_on_head: 1,
          },
        }),
        decision: "inconclusive",
        providerProfile: "terminal-payload",
        basisKind: "terminal-clean",
        selectedRequestId: priorBaseRequest.id,
      },
      {
        name: "unbound terminal clean",
        input: snapshot({
          artifacts: [artifact("terminal-clean")],
        }),
        decision: "inconclusive",
        providerProfile: "terminal-payload",
        basisKind: "terminal-clean",
      },
      {
        name: "unbound terminal clean cannot bypass a current request binding",
        input: snapshot({
          requests: [automaticRequest()],
          artifacts: [artifact("terminal-clean")],
          budget: {
            automatic_requests_on_head: 1,
            automatic_reservations_on_head: 1,
          },
        }),
        decision: "inconclusive",
        providerProfile: "terminal-payload",
        basisKind: "terminal-clean",
        selectedRequestId: "1001",
      },
      {
        name: "plus-one bound to an earlier-base request",
        input: snapshot({
          requests: [priorBaseRequest],
          acknowledgements: [acknowledgement("plus-one")],
          budget: {
            automatic_requests_on_head: 1,
            automatic_reservations_on_head: 1,
          },
        }),
        decision: "pending",
        providerProfile: "unknown",
      },
      {
        name: "no-start response bound to an earlier-base request",
        input: snapshot({
          requests: [priorBaseRequest],
          no_start_observations: [noStart()],
          budget: {
            automatic_requests_on_head: 1,
            automatic_reservations_on_head: 1,
          },
        }),
        decision: "pending",
        providerProfile: "unknown",
      },
      {
        name: "base ABA cannot revive an older current-base request",
        input: snapshot({
          selection: { intent: "explicit" },
          requests: [currentManualRequest, laterPriorBaseManualRequest],
          acknowledgements: [acknowledgement("plus-one", {
            request_id: currentManualRequest.id,
          })],
          budget: { manual_requests_in_epoch: 2 },
        }),
        decision: "pending",
        providerProfile: "unknown",
        selectedRequestId: laterPriorBaseManualRequest.id,
      },
      {
        name: "durable base ABA cannot revive a request from an earlier incarnation",
        input: snapshot({
          requests: [automaticRequest({ current_incarnation: false })],
          acknowledgements: [acknowledgement("plus-one")],
          budget: {
            automatic_requests_on_head: 1,
            automatic_reservations_on_head: 1,
          },
        }),
        decision: "pending",
        providerProfile: "unknown",
        selectedRequestId: "1001",
      },
    ];

    for (const fixture of cases) {
      await context.test(fixture.name, () => {
        const report = reduceV2Snapshot(fixture.input, OPTIONS);
        assert.equal(report.decision, fixture.decision);
        assert.equal(report.provider_profile, fixture.providerProfile);
        assert.equal(report.evidence_basis?.kind ?? null, fixture.basisKind ?? null);
        if (fixture.selectedRequestId !== undefined) {
          assert.equal(
            report.request_policy.selected_request_id,
            fixture.selectedRequestId,
          );
        }
      });
    }
  });

test("terminal clean classification remains outcome authority over a later current +1", () => {
  const report = reduceV2Snapshot(
    snapshot({
      requests: [automaticRequest()],
      artifacts: [artifact("terminal-clean")],
      acknowledgements: [
        acknowledgement("plus-one"),
        acknowledgement("eyes", { created_at: "2026-08-13T12:16:00Z" }),
      ],
      budget: { automatic_requests_on_head: 1, automatic_reservations_on_head: 1 },
    }),
    OPTIONS,
  );
  assert.equal(report.decision, "inconclusive");
  assert.equal(report.provider_profile, "mixed");
  assert.equal(report.evidence_basis.kind, "terminal-clean");
  assert.equal(report.evidence_basis.scope_assurance, "artifact-publication-only");
  assert.equal(report.evidence_basis.authority_receipt.selected_request, null);
});

test("current-bound terminal clean remains classification-only over current +1", () => {
  const report = reduceV2Snapshot(
    snapshot({
      requests: [automaticRequest()],
      artifacts: [artifact("terminal-clean", { request_id: "1001" })],
      acknowledgements: [acknowledgement("plus-one")],
      budget: { automatic_requests_on_head: 1, automatic_reservations_on_head: 1 },
    }),
    OPTIONS,
  );
  assert.equal(report.decision, "inconclusive");
  assert.equal(report.provider_profile, "mixed");
  assert.equal(report.evidence_basis.kind, "terminal-clean");
  assert.equal(report.evidence_basis.artifact_id, "2001");
  assert.equal(report.evidence_basis.authority_receipt.selected_request, null);
});

test("equal-time terminal carriers conflict only across different channels", () => {
  const report = reduceV2Snapshot(
    snapshot({
      artifacts: [
        artifact("terminal-clean"),
        artifact("terminal-clean", {
          id: "2004",
          channel: "pull-request-review",
        }),
      ],
    }),
    OPTIONS,
  );
  assert.equal(report.decision, "inconclusive");
  assert.equal(report.evidence_basis.kind, "malformed-evidence");
  assert.equal(
    report.evidence_basis.scope_assurance,
    "artifact-publication-only",
  );
});

test("same-channel equal-time terminals use kind precedence then positive id", () => {
  const latestClean = reduceV2Snapshot(
    snapshotWithBoundTerminalClean({
      artifacts: [
        artifact("terminal-clean", { request_id: "1001" }),
        artifact("terminal-clean", { id: "2004", request_id: "1001" }),
      ],
    }),
    OPTIONS,
  );
  assert.equal(latestClean.decision, "inconclusive");
  assert.equal(latestClean.evidence_basis.artifact_id, "2004");

  const findingsWin = reduceV2Snapshot(
    snapshotWithBoundTerminalClean({
      artifacts: [
        artifact("terminal-clean", { request_id: "1001" }),
        artifact("terminal-findings", { id: "2004" }),
      ],
    }),
    OPTIONS,
  );
  assert.equal(findingsWin.decision, "findings");
  assert.equal(findingsWin.evidence_basis.artifact_id, "2004");

  const malformedWins = reduceV2Snapshot(
    snapshotWithBoundTerminalClean({
      artifacts: [
        artifact("terminal-clean", { request_id: "1001" }),
        artifact("terminal-findings", { id: "2004" }),
        artifact("malformed", { id: "2005" }),
      ],
    }),
    OPTIONS,
  );
  assert.equal(malformedWins.decision, "inconclusive");
  assert.equal(malformedWins.evidence_basis.artifact_id, "2005");
});

test("an unstable canonically selected terminal carrier is unknown, never malformed", () => {
  for (const kind of ["terminal-clean", "terminal-findings", "malformed"]) {
    const report = reduceV2Snapshot(
      snapshot({ artifacts: [artifact(kind, { stable: false })] }),
      OPTIONS,
    );
    assert.equal(report.decision, "inconclusive");
    assert.equal(report.evidence_basis.kind, "unknown-terminal");
    assert.equal(
      report.evidence_basis.scope_assurance,
      "artifact-publication-only",
    );
    assert.equal(report.evidence_basis.artifact_id, artifact(kind).id);
    assert.equal(
      report.evidence_basis.authority_receipt.selected_artifact.id,
      artifact(kind).id,
    );
    assert.doesNotThrow(() => assertV2ReducerOutput(report));
  }
});

test("artifact-publication-only evidence binds its exact selected artifact identity", () => {
  const reports = [
    reduceV2Snapshot(
      snapshot({ artifacts: [artifact("malformed")] }),
      OPTIONS,
    ),
    reduceV2Snapshot(
      snapshot({ artifacts: [artifact("terminal-clean", { stable: false })] }),
      OPTIONS,
    ),
  ];

  for (const report of reports) {
    assert.equal(
      report.evidence_basis.scope_assurance,
      "artifact-publication-only",
    );
    const forged = structuredClone(report);
    forged.evidence_basis.artifact_id = null;
    forged.evidence_basis.authority_receipt.selected_artifact = null;
    assert.throws(
      () => assertV2ReducerOutput(forged),
      /must bind its exact selected artifact/u,
    );
  }
});

test("terminal stability is evaluated after canonical outcome selection", () => {
  const stableLatest = reduceV2Snapshot(
    snapshotWithBoundTerminalClean({
      artifacts: [
        artifact("malformed", { stable: false }),
        artifact("terminal-clean", {
          id: "2003",
          request_id: "1001",
          created_at: "2026-08-13T12:20:00Z",
        }),
      ],
    }),
    OPTIONS,
  );
  assert.equal(stableLatest.decision, "inconclusive");
  assert.equal(stableLatest.evidence_basis.kind, "terminal-clean");
  assert.equal(stableLatest.evidence_basis.artifact_id, "2003");

  const unstableLatest = reduceV2Snapshot(
    snapshot({
      artifacts: [
        artifact("terminal-clean"),
        artifact("malformed", {
          id: "2005",
          stable: false,
          created_at: "2026-08-13T12:20:00Z",
        }),
      ],
    }),
    OPTIONS,
  );
  assert.equal(unstableLatest.decision, "inconclusive");
  assert.equal(unstableLatest.evidence_basis.kind, "unknown-terminal");
  assert.equal(unstableLatest.evidence_basis.artifact_id, "2005");

  const stableMalformedWins = reduceV2Snapshot(
    snapshot({
      artifacts: [
        artifact("terminal-clean", { stable: false }),
        artifact("malformed", { id: "2005" }),
      ],
    }),
    OPTIONS,
  );
  assert.equal(stableMalformedWins.decision, "inconclusive");
  assert.equal(stableMalformedWins.evidence_basis.kind, "malformed-evidence");
  assert.equal(stableMalformedWins.evidence_basis.artifact_id, "2005");
});

test("terminal clean cannot bypass request admission and budget anomalies", () => {
  const unadmitted = automaticRequest({
    id: "1004",
    generation_id: "automatic:2",
    generation_index: 2,
  });
  const unadmittedReport = reduceV2Snapshot(
    snapshot({
      requests: [unadmitted],
      artifacts: [artifact("terminal-clean", { request_id: unadmitted.id })],
      budget: {
        automatic_requests_on_head: 1,
        automatic_reservations_on_head: 2,
      },
    }),
    OPTIONS,
  );
  assert.equal(unadmittedReport.decision, "inconclusive");
  assert.equal(unadmittedReport.request_policy.status, "unknown");
  assert.equal(unadmittedReport.provider_profile, "terminal-payload");
  assert.equal(unadmittedReport.evidence_basis.kind, "terminal-clean");

  const overLimitReport = reduceV2Snapshot(
    snapshotWithBoundTerminalClean({
      budget: { manual_requests_in_epoch: 65 },
    }),
    OPTIONS,
  );
  assert.equal(overLimitReport.decision, "inconclusive");
  assert.equal(overLimitReport.request_policy.status, "unknown");
  assert.equal(overLimitReport.provider_profile, "terminal-payload");
  assert.equal(overLimitReport.evidence_basis.kind, "terminal-clean");
  assert.match(overLimitReport.request_policy.reason, /64/u);
});

test("unaddressed findings veto a later terminal clean", () => {
  const report = reduceV2Snapshot(
    snapshot({
      artifacts: [
        artifact("terminal-findings"),
        artifact("terminal-clean", { id: "2003", created_at: "2026-08-13T12:20:00Z" }),
      ],
    }),
    OPTIONS,
  );
  assert.equal(report.decision, "findings");
  assert.equal(report.evidence_basis.kind, "terminal-findings");
});

test("trustworthy terminal findings remain blocking when a valid +1 also exists", () => {
  const report = reduceV2Snapshot(
    snapshot({
      requests: [automaticRequest()],
      artifacts: [artifact("terminal-findings", { request_id: "1001" })],
      acknowledgements: [acknowledgement("plus-one")],
      budget: {
        automatic_requests_on_head: 1,
        automatic_reservations_on_head: 1,
      },
    }),
    OPTIONS,
  );
  assert.equal(report.provider_profile, "mixed");
  assert.equal(report.decision, "findings");
  assert.equal(report.evidence_basis.kind, "terminal-findings");
});

test("top-level finding recovery requires human closure, a new request, and later clean", () => {
  const clean = reduceV2Snapshot(
    snapshot({
      artifacts: [
        artifact("terminal-findings", { request_id: "1001" }),
        artifact("terminal-clean", { id: "2003", request_id: "1004", created_at: "2026-08-13T12:25:00Z" }),
      ],
      threads: [{
        id: "top-level:2002:0",
        finding_id: "finding-1",
        kind: "top-level",
        created_at: "2026-08-13T12:10:00Z",
        is_resolved: false,
        resolution_observed_at: null,
        stable: true,
      }],
      acknowledgements: [acknowledgement("addressed", {
        created_at: "2026-08-13T12:15:00Z",
      })],
      requests: [automaticRequest(), automaticRequest({
        id: "1004",
        created_at: "2026-08-13T12:20:00Z",
        updated_at: "2026-08-13T12:20:00Z",
        generation_id: "automatic:2",
        generation_index: 2,
      })],
      budget: {
        automatic_requests_on_head: 2,
        automatic_reservations_on_head: 2,
      },
    }),
    OPTIONS,
  );
  assert.equal(clean.decision, "findings");
  assert.equal(clean.provider_profile, "terminal-payload");
  assert.equal(clean.evidence_basis.kind, "terminal-findings");
  assert.equal(clean.evidence_basis.authority_receipt.recovery, null);
});

test("finding recovery clean must bind the exact new selected request", () => {
  for (const requestId of [null, "1001"]) {
    const report = reduceV2Snapshot(
      snapshot({
        artifacts: [
          artifact("terminal-findings", { request_id: "1001" }),
          artifact("terminal-clean", {
            id: "2003",
            request_id: requestId,
            created_at: "2026-08-13T12:25:00Z",
          }),
        ],
        threads: [{
          id: "top-level:2002:0",
          finding_id: "finding-1",
          kind: "top-level",
          created_at: "2026-08-13T12:10:00Z",
          is_resolved: false,
          resolution_observed_at: null,
          stable: true,
        }],
        acknowledgements: [acknowledgement("addressed", {
          created_at: "2026-08-13T12:15:00Z",
        })],
        requests: [automaticRequest(), automaticRequest({
          id: "1004",
          created_at: "2026-08-13T12:20:00Z",
          updated_at: "2026-08-13T12:20:00Z",
          generation_id: "automatic:2",
          generation_index: 2,
        })],
        budget: {
          automatic_requests_on_head: 2,
          automatic_reservations_on_head: 2,
        },
      }),
      OPTIONS,
    );
    assert.equal(report.decision, "findings");
    assert.equal(report.evidence_basis.kind, "terminal-findings");
  }
});

test("closed historical findings can recover through an admitted new generation and later +1", () => {
  const prior = automaticRequest();
  const next = automaticRequest({
    id: "1004",
    created_at: "2026-08-13T12:20:00Z",
    updated_at: "2026-08-13T12:20:00Z",
    generation_id: "automatic:2",
    generation_index: 2,
  });
  const input = snapshot({
    requests: [prior, next],
    artifacts: [artifact("terminal-findings", { request_id: prior.id })],
    threads: [{
      id: "top-level:2002:0",
      finding_id: "finding-1",
      kind: "top-level",
      created_at: "2026-08-13T12:10:00Z",
      is_resolved: false,
      resolution_observed_at: null,
      stable: true,
    }],
    acknowledgements: [
      acknowledgement("addressed", { created_at: "2026-08-13T12:15:00Z" }),
      acknowledgement("plus-one", {
        request_id: next.id,
        created_at: "2026-08-13T12:25:00Z",
      }),
    ],
    budget: {
      automatic_requests_on_head: 2,
      automatic_reservations_on_head: 2,
    },
  });
  const report = reduceV2Snapshot(input, OPTIONS);
  assert.equal(report.decision, "clean");
  assert.equal(report.provider_profile, "thumbs-up-clean");
  assert.equal(report.evidence_basis.kind, "thumbs-up-clean");
  assert.deepEqual(report.evidence_basis.authority_receipt.recovery, {
    finding_ids: ["finding-1"],
    closure_ids: ["3003"],
    new_request_id: next.id,
    completion_id: "3001",
  });
  assert.equal(report.request_policy.selected_request_id, next.id);
  assert.doesNotThrow(() => assertV2ReducerOutput(report));

  const unclosed = structuredClone(input);
  unclosed.acknowledgements = unclosed.acknowledgements.filter(
    ({ kind }) => kind !== "addressed",
  );
  assert.equal(reduceV2Snapshot(unclosed, OPTIONS).decision, "findings");

  const currentGenerationFinding = structuredClone(input);
  currentGenerationFinding.generation_admissions = [generationAdmission(prior, next)];
  currentGenerationFinding.artifacts[0].request_id = next.id;
  currentGenerationFinding.artifacts[0].created_at = "2026-08-13T12:21:00Z";
  currentGenerationFinding.acknowledgements.find(
    ({ kind }) => kind === "addressed",
  ).created_at = "2026-08-13T12:22:00Z";
  const currentFindingReport = reduceV2Snapshot(currentGenerationFinding, OPTIONS);
  assert.equal(currentFindingReport.decision, "findings");
  assert.equal(currentFindingReport.provider_profile, "mixed");

  const oldBaseFinding = structuredClone(input);
  oldBaseFinding.requests[0].base_oid = "9".repeat(40);
  oldBaseFinding.requests[0].current_incarnation = false;
  oldBaseFinding.generation_admissions = [generationAdmission(prior, next)];
  const oldBaseReport = reduceV2Snapshot(oldBaseFinding, OPTIONS);
  assert.equal(oldBaseReport.decision, "clean");
  assert.equal(oldBaseReport.provider_profile, "thumbs-up-clean");
  assert.deepEqual(
    oldBaseReport.evidence_basis.authority_receipt.recovery,
    report.evidence_basis.authority_receipt.recovery,
  );

  const foreignHeadFinding = structuredClone(input);
  foreignHeadFinding.requests[0].head_oid = "8".repeat(40);
  foreignHeadFinding.requests[0].current_incarnation = false;
  foreignHeadFinding.generation_admissions = [generationAdmission(prior, next)];
  assert.throws(
    () => reduceV2Snapshot(foreignHeadFinding, OPTIONS),
    /must bind two observed requests on the current head/u,
  );
});

test("a superseded terminal clean does not block recovery of the canonically latest findings", () => {
  const prior = automaticRequest();
  const next = automaticRequest({
    id: "1004",
    created_at: "2026-08-13T12:20:00Z",
    updated_at: "2026-08-13T12:20:00Z",
    generation_id: "automatic:2",
    generation_index: 2,
  });
  const input = snapshot({
    requests: [prior, next],
    artifacts: [
      artifact("terminal-clean", {
        request_id: prior.id,
        created_at: "2026-08-13T12:05:00Z",
      }),
      artifact("terminal-findings", { request_id: prior.id }),
    ],
    threads: [{
      id: "top-level:2002:0",
      finding_id: "finding-1",
      kind: "top-level",
      created_at: "2026-08-13T12:10:00Z",
      is_resolved: false,
      resolution_observed_at: null,
      stable: true,
    }],
    acknowledgements: [
      acknowledgement("addressed", { created_at: "2026-08-13T12:15:00Z" }),
      acknowledgement("plus-one", {
        request_id: next.id,
        created_at: "2026-08-13T12:25:00Z",
      }),
    ],
    budget: {
      automatic_requests_on_head: 2,
      automatic_reservations_on_head: 2,
    },
  });
  const report = reduceV2Snapshot(input, OPTIONS);

  assert.equal(report.decision, "clean");
  assert.equal(report.provider_profile, "thumbs-up-clean");
  assert.equal(report.evidence_basis.kind, "thumbs-up-clean");
  assert.equal(report.evidence_basis.authority_receipt.selected_artifact, null);
  assert.deepEqual(report.evidence_basis.authority_receipt.recovery, {
    finding_ids: ["finding-1"],
    closure_ids: ["3003"],
    new_request_id: next.id,
    completion_id: "3001",
  });

  const equalTimeClean = structuredClone(input);
  equalTimeClean.artifacts.find(
    ({ kind }) => kind === "terminal-clean",
  ).created_at = "2026-08-13T12:10:00Z";
  assert.equal(reduceV2Snapshot(equalTimeClean, OPTIONS).decision, "findings");

  const unstableEarlierClean = structuredClone(input);
  unstableEarlierClean.artifacts.find(
    ({ kind }) => kind === "terminal-clean",
  ).stable = false;
  const unstableEarlierReport = reduceV2Snapshot(unstableEarlierClean, OPTIONS);
  assert.equal(unstableEarlierReport.request_policy.status, "compliant");
  assert.equal(unstableEarlierReport.request_policy.selected_request_id, next.id);
  assert.equal(unstableEarlierReport.decision, "findings");
  assert.equal(unstableEarlierReport.evidence_basis.kind, "terminal-findings");
  assert.equal(unstableEarlierReport.evidence_basis.authority_receipt.recovery, null);

  const latestClean = structuredClone(input);
  latestClean.artifacts.find(
    ({ kind }) => kind === "terminal-clean",
  ).created_at = "2026-08-13T12:11:00Z";
  assert.equal(reduceV2Snapshot(latestClean, OPTIONS).decision, "findings");

  const olderUnclosedFinding = structuredClone(input);
  olderUnclosedFinding.artifacts.push(artifact("terminal-findings", {
    id: "2004",
    request_id: prior.id,
    created_at: "2026-08-13T12:07:00Z",
    finding_ids: ["finding-0"],
  }));
  olderUnclosedFinding.threads.push({
    id: "top-level:2004:0",
    finding_id: "finding-0",
    kind: "top-level",
    created_at: "2026-08-13T12:07:00Z",
    is_resolved: false,
    resolution_observed_at: null,
    stable: true,
  });
  olderUnclosedFinding.generation_admissions = [generationAdmission(prior, next)];
  const olderUnclosedReport = reduceV2Snapshot(olderUnclosedFinding, OPTIONS);
  assert.equal(olderUnclosedReport.request_policy.status, "compliant");
  assert.equal(olderUnclosedReport.request_policy.selected_request_id, next.id);
  assert.equal(olderUnclosedReport.decision, "findings");
  assert.equal(olderUnclosedReport.evidence_basis.artifact_id, "2004");

  const latestCurrentFinding = structuredClone(input);
  latestCurrentFinding.artifacts.push(artifact("terminal-findings", {
    id: "2005",
    request_id: next.id,
    created_at: "2026-08-13T12:26:00Z",
    finding_ids: ["finding-2"],
  }));
  latestCurrentFinding.threads.push({
    id: "top-level:2005:0",
    finding_id: "finding-2",
    kind: "top-level",
    created_at: "2026-08-13T12:26:00Z",
    is_resolved: false,
    resolution_observed_at: null,
    stable: true,
  });
  const latestFindingReport = reduceV2Snapshot(latestCurrentFinding, OPTIONS);
  assert.equal(latestFindingReport.decision, "findings");
  assert.equal(latestFindingReport.evidence_basis.artifact_id, "2005");

  const noClosure = structuredClone(input);
  noClosure.acknowledgements = noClosure.acknowledgements.filter(
    ({ kind }) => kind !== "addressed",
  );
  assert.equal(reduceV2Snapshot(noClosure, OPTIONS).decision, "findings");

  const closureAtRequest = structuredClone(input);
  closureAtRequest.acknowledgements.find(
    ({ kind }) => kind === "addressed",
  ).created_at = next.created_at;
  closureAtRequest.generation_admissions = [generationAdmission(prior, next)];
  const closureAtRequestReport = reduceV2Snapshot(closureAtRequest, OPTIONS);
  assert.equal(closureAtRequestReport.request_policy.status, "compliant");
  assert.equal(closureAtRequestReport.request_policy.selected_request_id, next.id);
  assert.equal(closureAtRequestReport.decision, "findings");

  const completionAtRequest = structuredClone(input);
  completionAtRequest.acknowledgements.find(
    ({ kind }) => kind === "plus-one",
  ).created_at = next.created_at;
  assert.equal(reduceV2Snapshot(completionAtRequest, OPTIONS).decision, "findings");

  const terminalPrecedence = structuredClone(input);
  terminalPrecedence.artifacts = [artifact("terminal-clean", {
    request_id: next.id,
    created_at: "2026-08-13T12:22:00Z",
  })];
  terminalPrecedence.threads = [];
  terminalPrecedence.acknowledgements = terminalPrecedence.acknowledgements.filter(
    ({ kind }) => kind === "plus-one",
  );
  terminalPrecedence.generation_admissions = [generationAdmission(prior, next)];
  const terminalReport = reduceV2Snapshot(terminalPrecedence, OPTIONS);
  assert.equal(terminalReport.decision, "inconclusive");
  assert.equal(terminalReport.provider_profile, "mixed");
  assert.equal(terminalReport.evidence_basis.kind, "terminal-clean");
  assert.equal(terminalReport.evidence_basis.authority_receipt.recovery, null);
});

test("an admitted manual request can recover closed findings after automatic quota exhaustion", () => {
  const prior = automaticRequest();
  const manual = manualRequest({
    created_at: "2026-08-13T12:20:00Z",
    updated_at: "2026-08-13T12:20:00Z",
  });
  const input = snapshot({
    selection: { intent: "explicit" },
    requests: [prior, manual],
    artifacts: [artifact("terminal-findings", { request_id: prior.id })],
    threads: [{
      id: "top-level:2002:0",
      finding_id: "finding-1",
      kind: "top-level",
      created_at: "2026-08-13T12:10:00Z",
      is_resolved: false,
      resolution_observed_at: null,
      stable: true,
    }],
    acknowledgements: [
      acknowledgement("addressed", { created_at: "2026-08-13T12:15:00Z" }),
      acknowledgement("plus-one", {
        request_id: manual.id,
        created_at: "2026-08-13T12:25:00Z",
      }),
    ],
    budget: {
      automatic_requests_on_head: 1,
      automatic_reservations_on_head: 3,
      manual_requests_in_epoch: 1,
    },
  });

  const report = reduceV2Snapshot(input, OPTIONS);
  assert.equal(report.decision, "clean");
  assert.equal(report.provider_profile, "thumbs-up-clean");
  assert.equal(report.request_policy.generation_id, "manual:1");
  assert.deepEqual(report.evidence_basis.authority_receipt.recovery, {
    finding_ids: ["finding-1"],
    closure_ids: ["3003"],
    new_request_id: manual.id,
    completion_id: "3001",
  });

  const unclosed = structuredClone(input);
  unclosed.acknowledgements = unclosed.acknowledgements.filter(
    ({ kind }) => kind !== "addressed",
  );
  assert.equal(reduceV2Snapshot(unclosed, OPTIONS).decision, "findings");

  const wrongHeadRequest = structuredClone(input);
  wrongHeadRequest.requests.find(({ kind }) => kind === "manual").head_oid =
    "8".repeat(40);
  wrongHeadRequest.requests.find(({ kind }) => kind === "manual").current_incarnation =
    false;
  assert.equal(reduceV2Snapshot(wrongHeadRequest, OPTIONS).decision, "findings");

  const oldReaction = structuredClone(input);
  oldReaction.acknowledgements.find(
    ({ kind }) => kind === "plus-one",
  ).created_at = "2026-08-13T12:19:59Z";
  assert.equal(reduceV2Snapshot(oldReaction, OPTIONS).decision, "findings");
});

test("inline findings require a stable resolution observation followed by a new request", () => {
  const unresolved = reduceV2Snapshot(
    snapshot({
      artifacts: [artifact("terminal-findings")],
      threads: [inlineThread()],
    }),
    OPTIONS,
  );
  assert.equal(unresolved.decision, "findings");
  assert.equal(unresolved.evidence_basis.kind, "unresolved-inline-finding");

  const clean = reduceV2Snapshot(
    snapshot({
      artifacts: [
        artifact("terminal-findings", { request_id: "1001" }),
        artifact("terminal-clean", { id: "2003", request_id: "1004", created_at: "2026-08-13T12:25:00Z" }),
      ],
      threads: [
        inlineThread({
          is_resolved: true,
          resolution_observed_at: "2026-08-13T12:20:00Z",
        }),
      ],
      requests: [automaticRequest(), automaticRequest({
        id: "1004",
        created_at: "2026-08-13T12:21:00Z",
        updated_at: "2026-08-13T12:21:00Z",
        generation_id: "automatic:2",
        generation_index: 2,
      })],
      budget: {
        automatic_requests_on_head: 2,
        automatic_reservations_on_head: 2,
      },
    }),
    OPTIONS,
  );
  assert.equal(clean.decision, "findings");
});

test("accepts a unique controlled-request +1 only while no equal-or-later eyes exists", () => {
  const input = snapshot({
    requests: [automaticRequest()],
    acknowledgements: [acknowledgement("plus-one")],
    budget: { automatic_requests_on_head: 1, automatic_reservations_on_head: 1 },
  });
  const clean = reduceV2Snapshot(input, OPTIONS);
  assert.equal(clean.decision, "clean");
  assert.equal(clean.provider_profile, "thumbs-up-clean");

  const earlierEyes = reduceV2Snapshot(
    snapshot({
      requests: [automaticRequest()],
      acknowledgements: [
        acknowledgement("eyes", { created_at: "2026-08-13T12:14:00Z" }),
        acknowledgement("plus-one"),
      ],
      budget: { automatic_requests_on_head: 1, automatic_reservations_on_head: 1 },
    }),
    OPTIONS,
  );
  assert.equal(earlierEyes.decision, "clean");
  assert.equal(earlierEyes.provider_profile, "thumbs-up-clean");

  input.acknowledgements.push(
    acknowledgement("eyes", {
      created_at: "2026-08-13T12:16:00Z",
    }),
  );
  const laterEyes = reduceV2Snapshot(input, OPTIONS);
  assert.equal(laterEyes.decision, "pending");
  assert.equal(laterEyes.provider_profile, "unknown");
  assert.equal(laterEyes.evidence_basis, null);

  const equalTimeEyes = reduceV2Snapshot(
    snapshot({
      requests: [automaticRequest()],
      acknowledgements: [
        acknowledgement("plus-one"),
        acknowledgement("eyes", { created_at: "2026-08-13T12:15:00Z" }),
      ],
      budget: { automatic_requests_on_head: 1, automatic_reservations_on_head: 1 },
    }),
    OPTIONS,
  );
  assert.equal(equalTimeEyes.decision, "pending");
  assert.equal(equalTimeEyes.provider_profile, "unknown");
  assert.equal(equalTimeEyes.evidence_basis, null);

  const sameSecond = reduceV2Snapshot(
    snapshot({
      requests: [automaticRequest()],
      acknowledgements: [
        acknowledgement("plus-one", { created_at: "2026-08-13T12:00:00Z" }),
      ],
      budget: { automatic_requests_on_head: 1, automatic_reservations_on_head: 1 },
    }),
    OPTIONS,
  );
  assert.equal(sameSecond.decision, "pending");
});

test("reaction-only clean rejects selected artifact lineage", () => {
  const report = reduceV2Snapshot(
    snapshot({
      requests: [automaticRequest()],
      acknowledgements: [acknowledgement("plus-one")],
      budget: { automatic_requests_on_head: 1, automatic_reservations_on_head: 1 },
    }),
    OPTIONS,
  );
  report.evidence_basis.authority_receipt.selected_artifact = {
    id: "3001",
    url: "https://github.com/owner/repo/pull/7#issuecomment-3001",
    created_at: "2026-08-13T12:15:00Z",
  };

  assert.throws(
    () => assertV2ReducerOutput(report),
    /reaction clean authority selected artifact must be null/u,
  );
});

test("closed reducer output rejects mixed profile for reaction-only clean", () => {
  const clean = reduceV2Snapshot(
    snapshot({
      requests: [automaticRequest()],
      acknowledgements: [acknowledgement("plus-one")],
      budget: { automatic_requests_on_head: 1, automatic_reservations_on_head: 1 },
    }),
    OPTIONS,
  );
  assert.equal(clean.decision, "clean");
  assert.equal(clean.provider_profile, "thumbs-up-clean");

  const forged = structuredClone(clean);
  forged.provider_profile = "mixed";
  assert.throws(
    () => assertV2ReducerOutput(forged),
    /clean.*provider profile|provider profile.*evidence basis/u,
  );
});

test("an automatic generation after the first requires a proved finding-closure chain", () => {
  const latest = automaticRequest({
    id: "1003",
    created_at: "2026-08-13T12:05:00Z",
    updated_at: "2026-08-13T12:05:00Z",
    generation_id: "automatic:2",
    generation_index: 2,
  });
  const report = reduceV2Snapshot(
    snapshot({
      requests: [automaticRequest(), latest],
      acknowledgements: [acknowledgement("plus-one")],
      budget: {
        automatic_requests_on_head: 2,
        automatic_reservations_on_head: 2,
      },
    }),
    OPTIONS,
  );
  assert.equal(report.decision, "pending");
  assert.equal(report.request_policy.status, "unknown");
  assert.equal(report.request_policy.selected_request_id, "1001");
  assert.equal(report.request_policy.generation_id, "automatic:1");
});

test("durable recovery admission retains a retargeted generation without restoring positive evidence", () => {
  const prior = automaticRequest({ base_oid: "9".repeat(40) });
  const next = automaticRequest({
    id: "1003",
    base_oid: "9".repeat(40),
    created_at: "2026-08-13T12:05:00Z",
    updated_at: "2026-08-13T12:05:00Z",
    generation_id: "automatic:2",
    generation_index: 2,
  });
  const admitted = snapshot({
    requests: [prior, next],
    acknowledgements: [acknowledgement("plus-one", {
      request_id: next.id,
      created_at: "2026-08-13T12:10:00Z",
    })],
    generation_admissions: [generationAdmission(prior, next)],
    budget: {
      automatic_requests_on_head: 2,
      automatic_reservations_on_head: 2,
    },
  });
  assert.doesNotThrow(() => assertV2ReducerInput(admitted));

  const report = reduceV2Snapshot(admitted, OPTIONS);
  assert.equal(report.decision, "pending");
  assert.equal(report.request_policy.status, "compliant");
  assert.equal(report.request_policy.selected_request_id, next.id);
  assert.equal(report.request_policy.generation_id, "automatic:2");
  assert.equal(report.provider_profile, "unknown");
  assert.equal(report.evidence_basis, null);

  for (const transitionServerTime of [
    "2026-08-13T11:59:00Z",
    "2026-08-13T12:00:00Z",
  ]) {
    const nonCausal = structuredClone(admitted);
    nonCausal.generation_admissions[0].transition_server_time = transitionServerTime;
    const rejected = reduceV2Snapshot(nonCausal, OPTIONS);
    assert.equal(rejected.decision, "pending", transitionServerTime);
    assert.equal(rejected.request_policy.status, "unknown", transitionServerTime);
    assert.equal(rejected.request_policy.selected_request_id, prior.id, transitionServerTime);
    assert.equal(rejected.request_policy.generation_id, prior.generation_id, transitionServerTime);
  }
  for (const transitionServerTime of [
    "2026-08-13T12:05:00Z",
    "2026-08-13T12:06:00Z",
  ]) {
    const nonCausal = structuredClone(admitted);
    nonCausal.generation_admissions[0].transition_server_time = transitionServerTime;
    assert.throws(
      () => reduceV2Snapshot(nonCausal, OPTIONS),
      /transition must strictly precede its next request/u,
      transitionServerTime,
    );
  }

  const malformed = [
    (value) => {
      value.generation_admissions[0].unexpected = true;
    },
    (value) => {
      value.generation_admissions[0].head_oid = "8".repeat(40);
    },
    (value) => {
      value.generation_admissions[0].next_request_id = "9999";
    },
    (value) => {
      value.generation_admissions[0].ledger_order.recovery_transition_index = 12;
    },
    (value) => {
      value.generation_admissions[0].recovery_transition_payload_digest = "sha256:tampered";
    },
    (value) => {
      value.generation_admissions[0].prior_generation_id = "automatic:2";
      value.generation_admissions[0].next_generation_id = "automatic:3";
    },
  ];
  for (const mutate of malformed) {
    const value = structuredClone(admitted);
    mutate(value);
    assert.throws(() => assertV2ReducerInput(value));
  }
});

test("one durable recovery transition cannot authorize two generation advances", () => {
  const first = automaticRequest();
  const second = automaticRequest({
    id: "1003",
    created_at: "2026-08-13T12:05:00Z",
    updated_at: "2026-08-13T12:05:00Z",
    generation_id: "automatic:2",
    generation_index: 2,
  });
  const third = automaticRequest({
    id: "1004",
    created_at: "2026-08-13T12:10:00Z",
    updated_at: "2026-08-13T12:10:00Z",
    generation_id: "automatic:3",
    generation_index: 3,
  });
  const firstAdmission = generationAdmission(first, second);
  const secondAdmission = generationAdmission(second, third, {
    prior_request_binding_record_oid: firstAdmission.next_request_binding_record_oid,
    recovery_transition_record_oid: "4".repeat(40),
    recovery_transition_payload_digest: `sha256:${"4".repeat(64)}`,
    next_request_binding_record_oid: "5".repeat(40),
    next_request_binding_payload_digest: `sha256:${"5".repeat(64)}`,
    transition_server_time: "2026-08-13T12:09:00Z",
    ledger_order: {
      prior_request_binding_index: 12,
      recovery_transition_index: 13,
      next_request_binding_index: 14,
    },
  });
  const distinctTransitions = snapshot({
    requests: [first, second, third],
    generation_admissions: [firstAdmission, secondAdmission],
    budget: {
      automatic_requests_on_head: 3,
      automatic_reservations_on_head: 3,
    },
  });
  assert.doesNotThrow(() => assertV2ReducerInput(distinctTransitions));

  const reusedTransition = structuredClone(distinctTransitions);
  reusedTransition.generation_admissions[1].recovery_transition_record_oid =
    firstAdmission.recovery_transition_record_oid;
  reusedTransition.generation_admissions[1].recovery_transition_payload_digest =
    firstAdmission.recovery_transition_payload_digest;
  assert.throws(
    () => assertV2ReducerInput(reusedTransition),
    /repeats a durable generation admission identity/u,
  );
});

test("every extra request generation removes request-bound reaction authority", () => {
  const cases = [
    {
      name: "unclosed generation two",
      requests: [
        automaticRequest(),
        automaticRequest({
          id: "1003",
          generation_id: "automatic:2",
          generation_index: 2,
          created_at: "2026-08-13T12:05:00Z",
          updated_at: "2026-08-13T12:05:00Z",
        }),
      ],
      budget: {
        automatic_requests_on_head: 2,
        automatic_reservations_on_head: 2,
      },
    },
    {
      name: "generation gap before generation three",
      requests: [
        automaticRequest(),
        automaticRequest({
          id: "1004",
          generation_id: "automatic:3",
          generation_index: 3,
          created_at: "2026-08-13T12:06:00Z",
          updated_at: "2026-08-13T12:06:00Z",
        }),
      ],
      budget: {
        automatic_requests_on_head: 2,
        automatic_reservations_on_head: 3,
      },
    },
    {
      name: "duplicate generation identity",
      requests: [
        automaticRequest(),
        automaticRequest({
          id: "1005",
          created_at: "2026-08-13T12:07:00Z",
          updated_at: "2026-08-13T12:07:00Z",
        }),
      ],
      budget: {
        automatic_requests_on_head: 2,
        automatic_reservations_on_head: 2,
      },
    },
  ];

  for (const fixture of cases) {
    const report = reduceV2Snapshot(snapshot({
      requests: fixture.requests,
      acknowledgements: [acknowledgement("plus-one")],
      budget: fixture.budget,
    }), OPTIONS);
    assert.equal(report.decision, "pending", fixture.name);
    assert.equal(report.request_policy.status, "unknown", fixture.name);
    assert.notEqual(report.provider_profile, "thumbs-up-clean", fixture.name);
  }

  const findings = reduceV2Snapshot(snapshot({
    requests: cases[0].requests,
    artifacts: [artifact("terminal-findings")],
    acknowledgements: [acknowledgement("plus-one")],
    budget: cases[0].budget,
  }), OPTIONS);
  assert.equal(findings.request_policy.status, "unknown");
  assert.equal(findings.decision, "findings");
});

test("same-head base retarget does not refund or hide an earlier generation", () => {
  const prior = automaticRequest({ base_oid: "9".repeat(40) });
  const latest = automaticRequest({
    id: "1004",
    generation_id: "automatic:2",
    generation_index: 2,
    created_at: "2026-08-13T12:20:00Z",
    updated_at: "2026-08-13T12:20:00Z",
  });
  const report = reduceV2Snapshot(snapshot({
    requests: [prior, latest],
    artifacts: [
      artifact("terminal-findings", { request_id: prior.id }),
      artifact("terminal-clean", {
        id: "2003",
        request_id: latest.id,
        created_at: "2026-08-13T12:25:00Z",
      }),
    ],
    threads: [{
      id: "top-level:2002:0",
      finding_id: "finding-1",
      kind: "top-level",
      created_at: "2026-08-13T12:10:00Z",
      is_resolved: false,
      resolution_observed_at: null,
      stable: true,
    }],
    acknowledgements: [acknowledgement("addressed", {
      created_at: "2026-08-13T12:15:00Z",
    })],
    budget: { automatic_requests_on_head: 2, automatic_reservations_on_head: 2 },
  }), OPTIONS);
  assert.equal(report.decision, "findings");
  assert.equal(report.request_policy.generation_id, "automatic:2");
  assert.equal(report.evidence_basis.authority_receipt.selected_generation, null);
});

test("manual +1 exposes only the accepted weak permission assurances", () => {
  const request = manualRequest();
  const clean = reduceV2Snapshot(
    snapshot({
      selection: { intent: "explicit" },
      requests: [request],
      acknowledgements: [acknowledgement("plus-one", { request_id: request.id })],
      budget: { manual_requests_in_epoch: 1 },
    }),
    OPTIONS,
  );
  assert.equal(clean.decision, "clean");
  assert.deepEqual(
    {
      permission_assurance: clean.request_policy.permission_assurance,
      request_time_permission: clean.request_policy.request_time_permission,
      permission_aba_excluded: clean.request_policy.permission_aba_excluded,
    },
    {
      permission_assurance: "point-in-time-only",
      request_time_permission: "unproven",
      permission_aba_excluded: false,
    },
  );
  assert.equal(
    clean.evidence_basis.authority_receipt.selected_request.url,
    "https://github.com/owner/repo/pull/7#issuecomment-1002",
  );

  const drifted = structuredClone(request);
  drifted.actor_permission.final.actor.id = "502";
  const rejected = reduceV2Snapshot(
    snapshot({
      selection: { intent: "explicit" },
      requests: [drifted],
      acknowledgements: [acknowledgement("plus-one", { request_id: drifted.id })],
      budget: { manual_requests_in_epoch: 1 },
    }),
    OPTIONS,
  );
  assert.equal(rejected.decision, "pending");
  assert.equal(rejected.request_policy.status, "unknown");
});

test("recognizes only either exact no-start body after an independent 15-minute reread", () => {
  for (const body of V2_NO_START_BODIES) {
    const report = reduceV2Snapshot(
      snapshot({
        requests: [automaticRequest()],
        no_start_observations: [noStart({ body })],
        budget: { automatic_requests_on_head: 1, automatic_reservations_on_head: 1 },
      }),
      OPTIONS,
    );
    assert.equal(report.decision, "skipped-unavailable");
    assert.equal(report.provider_profile, "no-start-rejection");
    assert.equal(
      report.evidence_basis.authority_receipt.selected_artifact.url,
      "https://github.com/owner/repo/pull/7#issuecomment-5001",
    );
  }

  const tooSoon = reduceV2Snapshot(
    snapshot({
      requests: [automaticRequest()],
      no_start_observations: [
        noStart({ confirmed_at: "2026-08-13T12:15:59Z" }),
      ],
      budget: { automatic_requests_on_head: 1, automatic_reservations_on_head: 1 },
    }),
    OPTIONS,
  );
  assert.equal(tooSoon.decision, "pending");

  const carrierBeforeRequest = reduceV2Snapshot(
    snapshot({
      requests: [automaticRequest()],
      no_start_observations: [noStart({
        carrier_created_at: "2026-08-13T11:59:59Z",
      })],
      budget: { automatic_requests_on_head: 1, automatic_reservations_on_head: 1 },
    }),
    OPTIONS,
  );
  assert.equal(carrierBeforeRequest.decision, "pending");
});

test("no-start is blocked only by current-request provider activity in its causal window", () => {
  const prior = automaticRequest({
    base_oid: "9".repeat(40),
    current_incarnation: false,
  });
  const current = automaticRequest({
    id: "1004",
    created_at: "2026-08-13T12:20:00Z",
    updated_at: "2026-08-13T12:20:00Z",
    generation_id: "automatic:2",
    generation_index: 2,
  });
  const currentNoStart = noStart({
    request_id: current.id,
    carrier_created_at: "2026-08-13T12:20:30Z",
    first_seen_at: "2026-08-13T12:21:00Z",
    confirmed_at: "2026-08-13T12:36:00Z",
  });
  const baseInput = snapshot({
    requests: [prior, current],
    generation_admissions: [generationAdmission(prior, current)],
    no_start_observations: [currentNoStart],
    budget: {
      automatic_requests_on_head: 2,
      automatic_reservations_on_head: 2,
    },
  });

  const staleIncarnationActivity = structuredClone(baseInput);
  staleIncarnationActivity.acknowledgements = [
    acknowledgement("plus-one", {
      request_id: prior.id,
      created_at: "2026-08-13T12:15:00Z",
    }),
    acknowledgement("eyes", {
      request_id: prior.id,
      created_at: "2026-08-13T12:16:00Z",
    }),
  ];
  const staleReport = reduceV2Snapshot(staleIncarnationActivity, OPTIONS);
  assert.equal(staleReport.decision, "skipped-unavailable");
  assert.equal(staleReport.provider_profile, "no-start-rejection");
  assert.equal(staleReport.request_policy.selected_request_id, current.id);

  const earlyCurrentActivity = structuredClone(baseInput);
  earlyCurrentActivity.acknowledgements = [
    acknowledgement("plus-one", {
      request_id: current.id,
      created_at: "2026-08-13T12:19:00Z",
    }),
    acknowledgement("eyes", {
      request_id: current.id,
      created_at: "2026-08-13T12:19:30Z",
    }),
  ];
  assert.equal(
    reduceV2Snapshot(earlyCurrentActivity, OPTIONS).decision,
    "skipped-unavailable",
  );

  for (const createdAt of [
    "2026-08-13T12:20:00Z",
    "2026-08-13T12:21:00Z",
  ]) {
    const currentActivity = structuredClone(baseInput);
    currentActivity.acknowledgements = [acknowledgement("eyes", {
      request_id: current.id,
      created_at: createdAt,
    })];
    const blocked = reduceV2Snapshot(currentActivity, OPTIONS);
    assert.equal(blocked.decision, "pending", createdAt);
    assert.equal(blocked.provider_profile, "unknown", createdAt);
    assert.equal(blocked.evidence_basis, null, createdAt);
  }

  const terminal = structuredClone(staleIncarnationActivity);
  terminal.artifacts = [artifact("terminal-clean", { request_id: current.id })];
  const terminalReport = reduceV2Snapshot(terminal, OPTIONS);
  assert.equal(terminalReport.decision, "inconclusive");
  assert.equal(terminalReport.provider_profile, "mixed");
  assert.equal(terminalReport.evidence_basis.kind, "terminal-clean");
});

test("turns an exact no-start rejection into an explicit configuration block", () => {
  const report = reduceV2Snapshot(
    snapshot({
      selection: { intent: "explicit" },
      requests: [automaticRequest()],
      no_start_observations: [noStart()],
      budget: { automatic_requests_on_head: 1, automatic_reservations_on_head: 1 },
    }),
    OPTIONS,
  );
  assert.equal(report.decision, "blocked-configuration");
  assert.equal(report.evidence_basis.kind, "no-start-rejection");
});

test("no-start requires request, first-observation, and confirmation to be distinct ordered runs", () => {
  assert.throws(
    () => reduceV2Snapshot(
      snapshot({
        requests: [automaticRequest()],
        no_start_observations: [noStart({ request_run_id: "6001" })],
        budget: { automatic_requests_on_head: 1, automatic_reservations_on_head: 1 },
      }),
      OPTIONS,
    ),
    /three distinct ordered workflow runs/u,
  );
});

test("enforces visible automatic requests <= reservations <= 3 and caps manual epoch inventory", () => {
  const notDoubleCounted = reduceV2Snapshot(
    snapshot({
      budget: {
        automatic_requests_on_head: 1,
        automatic_reservations_on_head: 1,
      },
    }),
    OPTIONS,
  );
  assert.equal(notDoubleCounted.decision, "pending");

  const impossibleCounters = reduceV2Snapshot(
    snapshot({
      budget: {
        automatic_requests_on_head: 2,
        automatic_reservations_on_head: 1,
      },
    }),
    OPTIONS,
  );
  assert.equal(impossibleCounters.decision, "inconclusive");
  assert.match(impossibleCounters.evidence_basis.summary, /reservations/);

  const exhausted = reduceV2Snapshot(
    snapshot({ budget: { automatic_reservations_on_head: 3 } }),
    OPTIONS,
  );
  assert.equal(exhausted.decision, "inconclusive");
  assert.match(exhausted.evidence_basis.summary, /exhausted/);

  const manual = reduceV2Snapshot(
    snapshot({ budget: { manual_requests_in_epoch: 65 } }),
    OPTIONS,
  );
  assert.equal(manual.decision, "inconclusive");
  assert.match(manual.evidence_basis.summary, /64/);
});

test("fails closed on incomplete pagination, unstable scope, and malformed artifacts", () => {
  const incomplete = reduceV2Snapshot(
    snapshot({ inventories: { artifacts: false } }),
    OPTIONS,
  );
  assert.equal(incomplete.decision, "inconclusive");
  assert.equal(incomplete.evidence_basis.kind, "incomplete-snapshot");
  assert.equal(incomplete.evidence_basis.scope_assurance, "whole-pr-contractual");

  const unstable = reduceV2Snapshot(snapshot({ scope_stable: false }), OPTIONS);
  assert.equal(unstable.decision, "inconclusive");
  assert.equal(unstable.evidence_basis.kind, "unstable-scope");
  assert.equal(unstable.evidence_basis.scope_assurance, "whole-pr-contractual");

  const malformed = reduceV2Snapshot(
    snapshot({ artifacts: [artifact("malformed")] }),
    OPTIONS,
  );
  assert.equal(malformed.decision, "inconclusive");
  assert.equal(malformed.evidence_basis.kind, "malformed-evidence");
  assert.equal(
    malformed.evidence_basis.scope_assurance,
    "artifact-publication-only",
  );
});
