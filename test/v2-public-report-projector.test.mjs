import assert from "node:assert/strict";
import test from "node:test";

import {
  V2_PUBLIC_REPORT_SELECTION_AUTHORITY_SCHEMA,
  V2PublicReportProjectionError,
  projectV2PublicReport,
} from "../packages/action/src/v2/public-report-projector.mjs";
import {
  reduceV2Snapshot,
} from "../packages/action/src/v2/reducer.mjs";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const MERGE_BASE = "c".repeat(40);
const MERGE = "d".repeat(40);
const TREE = "e".repeat(40);
const DIGEST = `sha256:${"f".repeat(64)}`;
const OPTIONS = {
  status_target_mode: "test-merge-with-head-sentinel",
  status_context: "codex/github-review-gate",
};
const HEAD_OPTIONS = {
  ...OPTIONS,
  status_target_mode: "head",
};

test("projects a selected pending compact decision into the canonical rich report", () => {
  const input = reducerInput();
  const compact = reduceV2Snapshot(input, OPTIONS);
  const publicReport = projectV2PublicReport({
    compact_report: compact,
    reducer_input: input,
    evidence_snapshot: transportSnapshot(),
    selection_authority: selectionAuthority(),
    head_sentinel_receipt: null,
  });

  assert.equal(publicReport.decision, "pending");
  assert.deepEqual(publicReport.selection, {
    selected: true,
    intent: "required",
    mode: "implicit",
    source: "active-ruleset",
  });
  assert.equal(publicReport.server_enforcement, "enforced");
  assert.equal(publicReport.review_epoch.repository, "owner/repo");
  assert.equal(publicReport.status_target.potential_target_state, "validated");
  assert.equal(publicReport.status_target.head_sentinel_state, "absent");
  assert.equal(publicReport.evidence_basis, null);
  assert.ok(Object.isFrozen(publicReport));
});

test("projects head mode without advertising a terminal merge target", () => {
  const input = reducerInput();
  const compact = reduceV2Snapshot(input, HEAD_OPTIONS);
  const publicReport = projectV2PublicReport({
    compact_report: compact,
    reducer_input: input,
    evidence_snapshot: transportSnapshot(),
    selection_authority: selectionAuthority(),
    head_sentinel_receipt: null,
  });

  assert.equal(publicReport.status_target.mode, "head");
  assert.equal(publicReport.status_target.head_ref_oid, HEAD);
  assert.equal(publicReport.status_target.potential_target_state, "not-applicable");
  assert.equal(publicReport.status_target.potential_merge_commit_oid, null);
  assert.equal(publicReport.status_target.head_sentinel_state, "absent");
  assert.deepEqual(
    Object.keys(publicReport.status_target.validation_receipt.pre).sort(),
    [
      "head_ref_oid",
      "live_base_ref_tip",
      "observed_http_date",
      "pr_merge_base",
      "pr_merged",
      "pr_merged_at",
      "pr_state",
    ],
  );
});

test("head mode can report a clean decision without claiming a head success", () => {
  const input = reducerInput({ artifacts: [terminalCleanArtifact()] });
  const compact = reduceV2Snapshot(input, HEAD_OPTIONS);
  const publicReport = projectV2PublicReport({
    compact_report: compact,
    reducer_input: input,
    evidence_snapshot: transportSnapshot({ issueComments: [terminalCleanComment()] }),
    selection_authority: selectionAuthority(),
    head_sentinel_receipt: null,
  });

  assert.equal(publicReport.decision, "clean");
  assert.equal(publicReport.status_target.mode, "head");
  assert.equal(publicReport.status_target.head_sentinel_state, "absent");
  assert.equal(publicReport.status_target.potential_target_state, "not-applicable");
});

test("projects terminal clean only with exact selected artifact and a non-success head sentinel", () => {
  const clean = terminalCleanArtifact();
  const input = reducerInput({ artifacts: [clean] });
  const compact = reduceV2Snapshot(input, OPTIONS);
  const publicReport = projectV2PublicReport({
    compact_report: compact,
    reducer_input: input,
    evidence_snapshot: transportSnapshot({ issueComments: [terminalCleanComment()] }),
    selection_authority: selectionAuthority(),
    head_sentinel_receipt: sentinelReceipt(),
  });

  assert.equal(publicReport.decision, "clean");
  assert.equal(publicReport.provider_profile, "terminal-payload");
  assert.equal(publicReport.evidence_basis.kind, "terminal-payload");
  assert.deepEqual(publicReport.evidence_basis.selected_ids, ["2001"]);
  assert.deepEqual(publicReport.evidence_basis.selected_urls, [clean.url]);
  assert.equal(publicReport.status_target.head_sentinel_state, "pending");
});

test("projects malformed terminal conflicts with their computed provider profile", () => {
  const issue = terminalCleanArtifact();
  const review = {
    ...terminalCleanArtifact(),
    id: "2004",
    url: "https://github.com/owner/repo/pull/7#pullrequestreview-2004",
    channel: "pull-request-review",
  };
  const input = reducerInput({ artifacts: [issue, review] });
  const compact = reduceV2Snapshot(input, OPTIONS);
  assert.equal(compact.decision, "inconclusive");
  assert.equal(compact.provider_profile, "terminal-payload");
  const publicReport = projectV2PublicReport({
    compact_report: compact,
    reducer_input: input,
    evidence_snapshot: transportSnapshot({
      issueComments: [terminalCleanComment()],
      reviews: [terminalCleanReview()],
    }),
    selection_authority: selectionAuthority(),
    head_sentinel_receipt: null,
  });
  assert.equal(publicReport.provider_profile, "terminal-payload");
  assert.equal(publicReport.evidence_basis.kind, "malformed-terminal");
  assert.deepEqual(publicReport.evidence_basis.selected_ids, ["2004"]);
});

test("projects nonterminal instability as an artifact-free stable blocker", () => {
  const unstableRequest = {
    ...manualRequest(),
    stable: false,
  };
  const input = reducerInput({
    selection: { intent: "explicit", eligible: true, reason: "user explicit" },
    requests: [unstableRequest],
    budget: {
      automatic_requests_on_head: 0,
      automatic_reservations_on_head: 0,
      manual_requests_in_epoch: 1,
    },
  });
  const compact = reduceV2Snapshot(input, OPTIONS);
  assert.equal(compact.evidence_basis.kind, "stable-evidence-blocker");
  const publicReport = projectV2PublicReport({
    compact_report: compact,
    reducer_input: input,
    evidence_snapshot: transportSnapshot(),
    selection_authority: selectionAuthority({
      selection: {
        selected: true,
        intent: "explicit",
        mode: "explicit",
        source: "user-explicit",
      },
    }),
    head_sentinel_receipt: null,
  });
  assert.equal(publicReport.decision, "inconclusive");
  assert.equal(publicReport.evidence_basis.kind, "stable-evidence-blocker");
  assert.deepEqual(publicReport.evidence_basis.selected_ids, []);
  assert.equal(publicReport.evidence_basis.authority_receipt.selected_artifact, null);
});

test("projects a closed pre-epoch blocker with null epoch and status target", () => {
  const input = reducerInput();
  Object.assign(input.review_epoch, {
    base_oid: null,
    merge_base_oid: null,
    merge_oid: null,
    merge_tree_oid: null,
    merge_parents: [],
    merge_ref_oid: null,
    mergeable: "UNKNOWN",
  });
  const compact = reduceV2Snapshot(input, OPTIONS);
  const evidence = transportSnapshot();
  for (const value of [evidence.scope, evidence.scope_receipts.pre, evidence.scope_receipts.post]) {
    value.base_ref_tip = null;
    value.merge_base_sha = null;
    value.potential_merge_oid = null;
    value.potential_merge_tree = null;
    value.ordered_parent_oids = [];
    value.merge_ref_oid = null;
    value.mergeable = "UNKNOWN";
  }
  evidence.scope_receipts.pre = scopeReceiptWithEndpointEvidence(
    evidence.scope_receipts.pre,
  );
  evidence.scope_receipts.post = scopeReceiptWithEndpointEvidence(
    evidence.scope_receipts.post,
  );
  const publicReport = projectV2PublicReport({
    compact_report: compact,
    reducer_input: input,
    evidence_snapshot: evidence,
    selection_authority: selectionAuthority(),
    head_sentinel_receipt: null,
  });
  assert.equal(publicReport.selection.selected, true);
  assert.equal(publicReport.decision, "blocked-input");
  assert.equal(publicReport.provider_profile, null);
  assert.equal(publicReport.review_epoch, null);
  assert.equal(publicReport.status_target, null);
  assert.equal(publicReport.evidence_basis, null);
  assert.equal(publicReport.request_policy.status, "not-applicable");
});

test("keeps selection orthogonal to a configuration block", () => {
  const input = reducerInput({
    server_enforcement: {
      controller_available: true,
      workflow_present: true,
      workflow_compatible: false,
      ruleset_required: true,
      ruleset_compatible: true,
      app_bound: true,
    },
  });
  const compact = reduceV2Snapshot(input, OPTIONS);
  const authority = selectionAuthority({ server_enforcement: "not-enforced" });
  const publicReport = projectV2PublicReport({
    compact_report: compact,
    reducer_input: input,
    evidence_snapshot: transportSnapshot(),
    selection_authority: authority,
    head_sentinel_receipt: sentinelReceipt({ state: "error" }),
  });

  assert.equal(publicReport.selection.selected, true);
  assert.equal(publicReport.decision, "blocked-configuration");
  assert.equal(publicReport.server_enforcement, "not-enforced");
  assert.equal(publicReport.evidence_basis, null);
});

test("projects the exact legacy alias warning without rewriting a pre-provider status", () => {
  const input = reducerInput({
    selection: {
      intent: "explicit",
      eligible: true,
      reason: "legacy triple alias selected by trusted control plane",
    },
    server_enforcement: {
      controller_available: true,
      workflow_present: true,
      workflow_compatible: false,
      ruleset_required: true,
      ruleset_compatible: true,
      app_bound: true,
    },
  });
  const compact = reduceV2Snapshot(input, OPTIONS);
  assert.equal(compact.decision, "blocked-configuration");
  assert.equal(compact.request_policy.status, "not-applicable");

  const publicReport = projectV2PublicReport({
    compact_report: compact,
    reducer_input: input,
    evidence_snapshot: transportSnapshot(),
    selection_authority: selectionAuthority({
      selection: {
        selected: true,
        intent: "explicit",
        mode: "explicit",
        source: "legacy-triple",
      },
      server_enforcement: "not-enforced",
    }),
    head_sentinel_receipt: sentinelReceipt({ state: "error" }),
  });

  assert.equal(publicReport.request_policy.status, "not-applicable");
  assert.deepEqual(publicReport.request_policy.warnings, ["legacy-triple-alias"]);
  assert.deepEqual(publicReport.request_policy.warning_evidence, {
    legacy_triple_alias: true,
  });
});

test("derives legacy warnings only from the trusted selection authority", () => {
  const cases = [
    {
      input: reducerInput({
        selection: {
          intent: "explicit",
          eligible: true,
          reason: "legacy-triple-alias event text is not authority",
        },
      }),
      authority: selectionAuthority({
        selection: {
          selected: true,
          intent: "explicit",
          mode: "explicit",
          source: "user-explicit",
        },
      }),
    },
    {
      input: reducerInput({
        selection: {
          intent: "implicit",
          eligible: true,
          reason: "legacy-triple-alias event text is not authority",
        },
      }),
      authority: selectionAuthority(),
    },
    {
      input: reducerInput({
        selection: {
          intent: "disabled",
          eligible: false,
          reason: "legacy-triple-alias event text is not authority",
        },
      }),
      authority: selectionAuthority({
        selection: {
          selected: false,
          intent: "none",
          mode: "none",
          source: "none",
        },
        server_enforcement: "not-applicable",
      }),
    },
  ];

  for (const { input, authority } of cases) {
    const compact = reduceV2Snapshot(input, OPTIONS);
    const publicReport = projectV2PublicReport({
      compact_report: compact,
      reducer_input: input,
      evidence_snapshot: transportSnapshot(),
      selection_authority: authority,
      head_sentinel_receipt: null,
    });
    assert.deepEqual(publicReport.request_policy.warnings, []);
    assert.deepEqual(publicReport.request_policy.warning_evidence, {
      legacy_triple_alias: null,
    });
  }
});

test("allows a negative terminal report to plan its first non-success sentinel", () => {
  const input = reducerInput({
    server_enforcement: {
      controller_available: true,
      workflow_present: true,
      workflow_compatible: false,
      ruleset_required: true,
      ruleset_compatible: true,
      app_bound: true,
    },
  });
  const compact = reduceV2Snapshot(input, OPTIONS);
  const publicReport = projectV2PublicReport({
    compact_report: compact,
    reducer_input: input,
    evidence_snapshot: transportSnapshot(),
    selection_authority: selectionAuthority({
      server_enforcement: "not-enforced",
    }),
    head_sentinel_receipt: null,
  });

  assert.equal(publicReport.decision, "blocked-configuration");
  assert.equal(publicReport.status_target.head_sentinel_state, "absent");
});

test("preserves the manual point-read permission tuple for an exact +1 basis", () => {
  const request = manualRequest();
  const acknowledgement = plusOneAcknowledgement(request.id);
  const input = reducerInput({
    selection: { intent: "explicit", eligible: true, reason: "user explicit" },
    requests: [request],
    acknowledgements: [acknowledgement],
    budget: {
      automatic_requests_on_head: 0,
      automatic_reservations_on_head: 0,
      manual_requests_in_epoch: 1,
    },
  });
  const compact = reduceV2Snapshot(input, OPTIONS);
  const rawRequest = manualRequestComment();
  const publicReport = projectV2PublicReport({
    compact_report: compact,
    reducer_input: input,
    evidence_snapshot: transportSnapshot({
      issueComments: [rawRequest],
      issueReactionMap: new Map([[rawRequest.id, [providerReaction()]]]),
      actorPermissions: [manualPermissionReceipt(rawRequest)],
    }),
    selection_authority: selectionAuthority({
      selection: {
        selected: true,
        intent: "explicit",
        mode: "explicit",
        source: "user-explicit",
      },
    }),
    head_sentinel_receipt: sentinelReceipt(),
  });

  assert.equal(publicReport.provider_profile, "thumbs-up-clean");
  assert.equal(publicReport.evidence_basis.kind, "current-request-reaction");
  assert.deepEqual(publicReport.evidence_basis.selected_ids, ["3001"]);
  assert.deepEqual(publicReport.evidence_basis.selected_urls, [request.url]);
  assert.deepEqual({
    permission_assurance: publicReport.request_policy.permission_assurance,
    request_time_permission: publicReport.request_policy.request_time_permission,
    permission_aba_excluded: publicReport.request_policy.permission_aba_excluded,
  }, {
    permission_assurance: "point-in-time-only",
    request_time_permission: "unproven",
    permission_aba_excluded: false,
  });
  assert.equal(publicReport.review_epoch.controlled_request_id, null);
});

test("projects an unselected result without leaking selected-only structures", () => {
  const input = reducerInput({
    selection: { intent: "disabled", eligible: false, reason: "disabled" },
  });
  const compact = reduceV2Snapshot(input, OPTIONS);
  const publicReport = projectV2PublicReport({
    compact_report: compact,
    reducer_input: input,
    evidence_snapshot: transportSnapshot(),
    selection_authority: selectionAuthority({
      selection: { selected: false, intent: "none", mode: "none", source: "none" },
      server_enforcement: "not-applicable",
    }),
    head_sentinel_receipt: null,
  });

  assert.equal(publicReport.decision, "not-selected");
  assert.equal(publicReport.review_epoch, null);
  assert.equal(publicReport.status_target, null);
  assert.equal(publicReport.evidence_basis, null);
});

test("fails closed when a terminal result has no observed non-success head sentinel", () => {
  const input = reducerInput({ artifacts: [terminalCleanArtifact()] });
  const compact = reduceV2Snapshot(input, OPTIONS);
  assert.throws(
    () => projectV2PublicReport({
      compact_report: compact,
      reducer_input: input,
      evidence_snapshot: transportSnapshot({ issueComments: [terminalCleanComment()] }),
      selection_authority: selectionAuthority(),
      head_sentinel_receipt: null,
    }),
    (error) =>
      error instanceof V2PublicReportProjectionError &&
      error.code === "HEAD_SENTINEL_UNPROVEN",
  );
});

test("fails closed when GitHub Dates cannot prove a strictly later target reread", () => {
  const input = reducerInput();
  const compact = reduceV2Snapshot(input, OPTIONS);
  assert.throws(
    () => projectV2PublicReport({
      compact_report: compact,
      reducer_input: input,
      evidence_snapshot: transportSnapshot({
        preTime: "2026-08-13T12:30:00Z",
        postTime: "2026-08-13T12:30:00Z",
      }),
      selection_authority: selectionAuthority(),
      head_sentinel_receipt: null,
    }),
    (error) =>
      error instanceof V2PublicReportProjectionError &&
      error.code === "TARGET_REREAD_TIME_NOT_STRICT",
  );
});

test("rejects a selection source that contradicts sealed workflow and ruleset facts", () => {
  const input = reducerInput();
  const compact = reduceV2Snapshot(input, OPTIONS);
  assert.throws(
    () => projectV2PublicReport({
      compact_report: compact,
      reducer_input: input,
      evidence_snapshot: transportSnapshot(),
      selection_authority: selectionAuthority({
        selection: {
          selected: true,
          intent: "required",
          mode: "implicit",
          source: "workflow",
        },
        server_enforcement: "not-enforced",
      }),
      head_sentinel_receipt: null,
    }),
    (error) =>
      error instanceof V2PublicReportProjectionError &&
      error.code === "SELECTION_AUTHORITY_MISMATCH",
  );
});

function reducerInput(overrides = {}) {
  const input = {
    schema_version: 2,
    observed_at: "2026-08-13T12:30:00Z",
    snapshot_fingerprint: DIGEST,
    complete: true,
    selection: {
      intent: "implicit",
      eligible: true,
      reason: "selected by required ruleset",
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
  return { ...input, ...structuredClone(overrides) };
}

function terminalCleanArtifact() {
  return {
    id: "2001",
    url: "https://github.com/owner/repo/pull/7#issuecomment-2001",
    kind: "terminal-clean",
    channel: "issue-comment",
    request_id: null,
    created_at: "2026-08-13T12:10:00Z",
    commit_oid: HEAD,
    stable: true,
    finding_ids: [],
  };
}

function manualRequest() {
  return {
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
        actor: { id: "42", login: "reviewer", type: "User" },
        push: true,
      },
      final: {
        observed_at: "2026-08-13T12:20:00Z",
        actor: { id: "42", login: "reviewer", type: "User" },
        push: true,
      },
    },
    generation_id: "manual:1",
    generation_kind: "manual",
    generation_index: 1,
  };
}

function plusOneAcknowledgement(requestId) {
  return {
    id: "3001",
    kind: "plus-one",
    request_id: requestId,
    finding_id: null,
    created_at: "2026-08-13T12:10:00Z",
    commit_oid: HEAD,
    exact_provider: true,
    stable: true,
  };
}

function terminalCleanComment() {
  return {
    id: "2001",
    node_id: "IC_2001",
    url: "https://api.github.test/repos/owner/repo/issues/comments/2001",
    html_url: "https://github.com/owner/repo/pull/7#issuecomment-2001",
    issue_url: "https://api.github.test/repos/owner/repo/issues/7",
    author: {
      id: "9001",
      node_id: "BOT_codex",
      login: "chatgpt-codex-connector[bot]",
      type: "Bot",
    },
    app: { id: "15368", slug: "chatgpt-codex-connector", node_id: "APP_codex" },
    author_association: "NONE",
    body: "Codex Review: Didn't find any major issues.\n\n" +
      `**Reviewed commit:** \`${HEAD}\``,
    created_at: "2026-08-13T12:10:00Z",
    updated_at: "2026-08-13T12:10:00Z",
  };
}

function terminalCleanReview() {
  return {
    id: "2004",
    node_id: "PRR_2004",
    url: "https://api.github.test/repos/owner/repo/pulls/7/reviews/2004",
    html_url: "https://github.com/owner/repo/pull/7#pullrequestreview-2004",
    pull_request_url: "https://api.github.test/repos/owner/repo/pulls/7",
    author: {
      id: "9001",
      node_id: "BOT_codex",
      login: "chatgpt-codex-connector[bot]",
      type: "Bot",
    },
    app: { id: "15368", slug: "chatgpt-codex-connector", node_id: "APP_codex" },
    author_association: "NONE",
    body: "Codex Review: Didn't find any major issues.",
    state: "APPROVED",
    submitted_at: "2026-08-13T12:10:00Z",
    commit_id: HEAD,
  };
}

function manualRequestComment() {
  return {
    id: "1002",
    node_id: "IC_1002",
    url: "https://api.github.test/repos/owner/repo/issues/comments/1002",
    html_url: "https://github.com/owner/repo/pull/7#issuecomment-1002",
    issue_url: "https://api.github.test/repos/owner/repo/issues/7",
    author: {
      id: "42",
      node_id: "USER_reviewer",
      login: "reviewer",
      type: "User",
    },
    app: null,
    author_association: "MEMBER",
    body: "@codex review",
    created_at: "2026-08-13T12:00:00Z",
    updated_at: "2026-08-13T12:00:00Z",
  };
}

function providerReaction() {
  return {
    id: "3001",
    node_id: "REACTION_3001",
    content: "+1",
    created_at: "2026-08-13T12:10:00Z",
    author: {
      id: "9001",
      node_id: "BOT_codex",
      login: "chatgpt-codex-connector[bot]",
      type: "Bot",
    },
  };
}

function manualPermissionReceipt(comment) {
  const point = (serverTime) => ({
    subject: { kind: "issue_comment", id: comment.id },
    actor: structuredClone(comment.author),
    effective_permission: "write",
    role_name: "write",
    permissions: {
      admin: false,
      maintain: false,
      push: true,
      triage: true,
      pull: true,
    },
    mapping_source: "user.permissions",
    permission_assurance: "point-in-time-only",
    request_time_permission: "unproven",
    permission_aba_excluded: false,
    endpoint:
      "https://api.github.test/repos/owner/repo/collaborators/reviewer/permission",
    http_status: 200,
    response_server_time: serverTime,
    raw_body_sha256: DIGEST,
  });
  return {
    subject: { kind: "issue_comment", id: comment.id },
    actor: structuredClone(comment.author),
    assurance: "point-in-time-only",
    request_time_permission: "unproven",
    permission_aba_excluded: false,
    stable: true,
    pre: point("2026-08-13T12:01:00Z"),
    post: point("2026-08-13T12:20:00Z"),
  };
}

function selectionAuthority(overrides = {}) {
  return {
    schema: V2_PUBLIC_REPORT_SELECTION_AUTHORITY_SCHEMA,
    schema_version: 1,
    repository_node_id: "R_repo",
    pull_request_node_id: "PR_7",
    head_ref_oid: HEAD,
    selection: {
      selected: true,
      intent: "required",
      mode: "implicit",
      source: "active-ruleset",
    },
    server_enforcement: "enforced",
    authority_receipt_digest: DIGEST,
    ...structuredClone(overrides),
  };
}

function sentinelReceipt(overrides = {}) {
  return {
    sha: HEAD,
    context: "codex/github-review-gate",
    state: "pending",
    status_id: "9001",
    observed_at: "2026-08-13T12:20:00Z",
    ...overrides,
  };
}

function transportSnapshot({
  issueComments = [],
  reviews = [],
  issueReactionMap = new Map(),
  actorPermissions = [],
  preTime = "2026-08-13T12:29:00Z",
  postTime = "2026-08-13T12:30:00Z",
} = {}) {
  const scope = {
    base_ref_name: "main",
    base_ref_tip: BASE,
    head_ref_name: "feature",
    head_ref_oid: HEAD,
    merge_base_sha: MERGE_BASE,
    potential_merge_oid: MERGE,
    potential_merge_tree: TREE,
    ordered_parent_oids: [BASE, HEAD],
    merge_ref_oid: MERGE,
    mergeable: "MERGEABLE",
  };
  const scopeReceipt = (serverTime) => {
    const receipt = {
      repository_owner: "owner",
      repository_name: "repo",
      repository_node_id: "R_repo",
      pull_request_number: 7,
      pull_request_node_id: "PR_7",
      pull_request_state: "OPEN",
      pull_request_merged: false,
      pull_request_merged_at: null,
      pull_request_is_draft: false,
      ...structuredClone(scope),
      server_time: serverTime,
    };
    return scopeReceiptWithEndpointEvidence(receipt);
  };
  const exactArtifacts = issueComments.map((comment) => ({
    selector: { kind: "issue_comment", id: comment.id },
    artifact: structuredClone(comment),
    response_server_time: postTime,
    raw_body_sha256: DIGEST,
  })).concat(reviews.map((review) => ({
    selector: { kind: "pull_request_review", id: review.id },
    artifact: structuredClone(review),
    response_server_time: postTime,
    raw_body_sha256: DIGEST,
  })));
  const serviceReceipt = (serverTime) => ({
    server_time: serverTime,
    page_count: 1,
    total_check_runs: 0,
    matching_app_ids: [],
    check_runs: [],
    page_receipts: [{
      page: 1,
      item_count: 0,
      total_count: 0,
      response_server_time: serverTime,
      raw_body_sha256: DIGEST,
    }],
  });
  const capability = (serverTime) => ({
    capability_kind: "authenticated-transport-token",
    admin: true,
    maintain: true,
    push: true,
    triage: true,
    pull: true,
    role_name: "admin",
    endpoint: "https://api.github.test/repos/owner/repo",
    http_status: 200,
    response_server_time: serverTime,
    raw_body_sha256: DIGEST,
  });
  const reactionCount = [...issueReactionMap.values()]
    .reduce((count, reactions) => count + reactions.length, 0);
  const itemCount = issueComments.length + reviews.length + exactArtifacts.length + reactionCount;
  return {
    schema_version: 2,
    repository: { owner: "owner", name: "repo", node_id: "R_repo" },
    pull_request: {
      number: 7,
      node_id: "PR_7",
      state: "OPEN",
      merged: false,
      merged_at: null,
      is_draft: false,
    },
    server_time: postTime,
    scope,
    pages: {
      issue_comments: structuredClone(issueComments),
      reviews: structuredClone(reviews),
      inline_comments: [],
      threads: [],
      reactions: {
        issue: [],
        issue_comments: issueComments.map((comment) => ({
          subject_id: comment.id,
          reactions: structuredClone(issueReactionMap.get(comment.id) ?? []),
        })),
        reviews: reviews.map((review) => ({
          subject_id: review.id,
          reactions: [],
        })),
        inline_comments: [],
      },
      exact_artifacts: exactArtifacts,
    },
    permissions: {
      transport_capabilities: {
        stable: true,
        pre: capability(preTime),
        post: capability(postTime),
      },
      actor_permissions: structuredClone(actorPermissions),
    },
    service_start_observations: {
      provider_app_slug: "chatgpt-codex-connector",
      head_sha: HEAD,
      pre: serviceReceipt(preTime),
      post: serviceReceipt(postTime),
      stable: true,
    },
    scope_receipts: {
      pre: scopeReceipt(preTime),
      post: scopeReceipt(postTime),
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
      item_count: itemCount,
      response_bytes: 1,
      server_date_headers: 1,
    },
    stability: {
      scope_stable: true,
      service_start_observations_stable: true,
      server_time_monotonic: true,
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
    raw_body_sha256: DIGEST,
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
