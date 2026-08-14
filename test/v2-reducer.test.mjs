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
    snapshot({
      server_enforcement: {
        controller_available: true,
        workflow_present: true,
        workflow_compatible: true,
        ruleset_required: false,
        ruleset_compatible: false,
        app_bound: false,
      },
      artifacts: [artifact("terminal-clean")],
    }),
    OPTIONS,
  );
  assert.equal(workflowOnly.decision, "clean");
  assert.equal(workflowOnly.server_enforcement.status, "not-enforced");

  const explicit = reduceV2Snapshot(
    snapshot({
      selection: { intent: "explicit", reason: "User explicitly selected review" },
      server_enforcement: {
        controller_available: true,
        workflow_present: false,
        workflow_compatible: false,
        ruleset_required: false,
        ruleset_compatible: false,
        app_bound: false,
      },
      artifacts: [artifact("terminal-clean")],
    }),
    OPTIONS,
  );
  assert.equal(explicit.decision, "clean");
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
  assert.equal(findings.status_target.sha, null);

  const clean = reduceV2Snapshot(snapshot({
    review_epoch: invalidEpoch,
    artifacts: [artifact("terminal-clean")],
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

test("accepts a stable latest terminal clean payload", () => {
  const report = reduceV2Snapshot(
    snapshot({ artifacts: [artifact("terminal-clean")] }),
    OPTIONS,
  );
  assert.equal(report.decision, "clean");
  assert.equal(report.provider_profile, "terminal-payload");
  assert.equal(report.provider_input_lineage, "unavailable");
  assert.equal(report.evidence_basis.kind, "terminal-clean");
  assert.equal(report.evidence_basis.scope_assurance, "whole-pr-contractual");
  assert.deepEqual(report.evidence_basis.authority_receipt, {
    selected_request: null,
    selected_artifact: {
      id: "2001",
      url: "https://github.com/owner/repo/pull/7#issuecomment-2001",
      created_at: "2026-08-13T12:10:00Z",
    },
    pagination_sha256: DIGEST,
    final_reread_sha256: DIGEST,
    recovery: null,
    selected_generation: null,
  });
});

test("does not accept a terminal artifact bound to another head", () => {
  const report = reduceV2Snapshot(
    snapshot({
      artifacts: [artifact("terminal-clean", { commit_oid: "9".repeat(40) })],
    }),
    OPTIONS,
  );
  assert.equal(report.decision, "pending");
  assert.equal(report.provider_profile, "unknown");
  assert.equal(report.evidence_basis, null);
});

test("keeps mixed reactions as audit evidence without shutting terminal clean", () => {
  const report = reduceV2Snapshot(
    snapshot({
      requests: [automaticRequest()],
      artifacts: [artifact("terminal-clean")],
      acknowledgements: [acknowledgement("plus-one")],
      budget: { automatic_requests_on_head: 1, automatic_reservations_on_head: 1 },
    }),
    OPTIONS,
  );
  assert.equal(report.decision, "clean");
  assert.equal(report.provider_profile, "mixed");
  assert.match(report.evidence_basis.summary, /audit evidence/);
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
});

test("same-channel equal-time terminals use kind precedence then positive id", () => {
  const latestClean = reduceV2Snapshot(
    snapshot({
      artifacts: [
        artifact("terminal-clean"),
        artifact("terminal-clean", { id: "2004" }),
      ],
    }),
    OPTIONS,
  );
  assert.equal(latestClean.decision, "clean");
  assert.equal(latestClean.evidence_basis.artifact_id, "2004");

  const findingsWin = reduceV2Snapshot(
    snapshot({
      artifacts: [
        artifact("terminal-clean"),
        artifact("terminal-findings", { id: "2004" }),
      ],
    }),
    OPTIONS,
  );
  assert.equal(findingsWin.decision, "findings");
  assert.equal(findingsWin.evidence_basis.artifact_id, "2004");

  const malformedWins = reduceV2Snapshot(
    snapshot({
      artifacts: [
        artifact("terminal-clean"),
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
    assert.equal(report.evidence_basis.artifact_id, artifact(kind).id);
    assert.equal(
      report.evidence_basis.authority_receipt.selected_artifact.id,
      artifact(kind).id,
    );
    assert.doesNotThrow(() => assertV2ReducerOutput(report));
  }
});

test("terminal stability is evaluated after canonical outcome selection", () => {
  const stableLatest = reduceV2Snapshot(
    snapshot({
      artifacts: [
        artifact("malformed", { stable: false }),
        artifact("terminal-clean", {
          id: "2003",
          created_at: "2026-08-13T12:20:00Z",
        }),
      ],
    }),
    OPTIONS,
  );
  assert.equal(stableLatest.decision, "clean");
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

test("stable terminal clean survives request admission and budget anomalies", () => {
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
  assert.equal(unadmittedReport.decision, "clean");
  assert.equal(unadmittedReport.request_policy.status, "unknown");
  assert.equal(
    unadmittedReport.evidence_basis.authority_receipt.selected_request,
    null,
  );

  const overLimitReport = reduceV2Snapshot(
    snapshot({
      artifacts: [artifact("terminal-clean")],
      budget: { manual_requests_in_epoch: 65 },
    }),
    OPTIONS,
  );
  assert.equal(overLimitReport.decision, "clean");
  assert.equal(overLimitReport.request_policy.status, "unknown");
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
  assert.equal(clean.decision, "clean");
  assert.equal(clean.provider_profile, "terminal-payload");
  assert.deepEqual(clean.evidence_basis.authority_receipt.recovery, {
    finding_ids: ["finding-1"],
    closure_ids: ["3003"],
    new_request_id: "1004",
    completion_id: "2003",
  });
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
  assert.equal(clean.decision, "clean");
});

test("accepts a unique controlled-request +1 and treats later eyes as liveness-only", () => {
  const input = snapshot({
    requests: [automaticRequest()],
    acknowledgements: [acknowledgement("plus-one")],
    budget: { automatic_requests_on_head: 1, automatic_reservations_on_head: 1 },
  });
  const clean = reduceV2Snapshot(input, OPTIONS);
  assert.equal(clean.decision, "clean");
  assert.equal(clean.provider_profile, "thumbs-up-clean");

  input.acknowledgements.push(
    acknowledgement("eyes", {
      created_at: "2026-08-13T12:16:00Z",
    }),
  );
  const stillClean = reduceV2Snapshot(input, OPTIONS);
  assert.equal(stillClean.decision, "clean");
  assert.equal(stillClean.provider_profile, "thumbs-up-clean");

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
  assert.equal(report.decision, "clean");
  assert.equal(report.request_policy.generation_id, "automatic:2");
  assert.deepEqual(report.evidence_basis.authority_receipt.selected_generation, {
    id: "automatic:2",
    kind: "automatic",
    index: 2,
  });
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
});
