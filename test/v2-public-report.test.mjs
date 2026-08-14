import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  V2_PUBLIC_REPORT_AUTHORITY_DIGEST,
  V2_PUBLIC_REPORT_AUTHORITY_SHA256,
  V2_PUBLIC_REPORT_POLICY_DIGEST,
  V2_PUBLIC_REPORT_POLICY_SHA256,
  V2_PUBLIC_REPORT_SCHEMA,
  V2_PUBLIC_REPORT_SCHEMA_VERSION,
  assertV2PublicReport,
  validateV2PublicReport,
} from "../packages/action/src/v2/public-report.mjs";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const MERGE_BASE = "c".repeat(40);
const MERGE = "d".repeat(40);
const TREE = "e".repeat(40);
const DIGEST = `sha256:${"f".repeat(64)}`;
const REQUEST_URL = "https://github.com/owner/repo/pull/7#issuecomment-1001";
const ARTIFACT_URL = "https://github.com/owner/repo/pull/7#issuecomment-2001";

function report(overrides = {}) {
  const value = {
    schema_version: 2,
    snapshot_fingerprint: DIGEST,
    selection: {
      selected: true,
      intent: "required",
      mode: "implicit",
      source: "active-ruleset",
    },
    server_enforcement: "enforced",
    review_epoch: reviewEpoch(),
    request_policy: requestPolicy(),
    provider_profile: "unknown",
    provider_input_lineage: "unavailable",
    evidence_basis: null,
    status_target: statusTarget(),
    decision: "pending",
    freshness_assurance: "point-in-time",
  };
  return merge(value, overrides);
}

function reviewEpoch(overrides = {}) {
  return {
    host: "github.com",
    repository: "owner/repo",
    pull_request: 7,
    pr_state: "OPEN",
    pr_merged: false,
    pr_merged_at: null,
    base_ref: "main",
    live_base_ref_tip: BASE,
    head_ref: "feature",
    head_ref_oid: HEAD,
    pr_merge_base: MERGE_BASE,
    controlled_request_id: "1001",
    ...overrides,
  };
}

function requestPolicy(overrides = {}) {
  return {
    status: "compliant",
    warnings: [],
    warning_evidence: { legacy_triple_alias: null },
    request_id: "1001",
    request_url: REQUEST_URL,
    manual: false,
    generation_id: "automatic:1",
    generation_kind: "automatic",
    generation_index: 1,
    automatic_reservations_consumed_on_head: 1,
    manual_requests_in_review_epoch: 0,
    permission_assurance: null,
    request_time_permission: null,
    permission_aba_excluded: null,
    ...overrides,
  };
}

function emptyRequestPolicy(overrides = {}) {
  return requestPolicy({
    status: "not-applicable",
    request_id: null,
    request_url: null,
    generation_id: null,
    generation_kind: null,
    generation_index: null,
    automatic_reservations_consumed_on_head: 0,
    ...overrides,
  });
}

function observation(observedHttpDate, overrides = {}) {
  return {
    observed_http_date: observedHttpDate,
    pr_state: "OPEN",
    pr_merged: false,
    pr_merged_at: null,
    mergeable: "MERGEABLE",
    live_base_ref_tip: BASE,
    head_ref_oid: HEAD,
    pr_merge_base: MERGE_BASE,
    potential_merge_commit_oid: MERGE,
    potential_merge_commit_tree_oid: TREE,
    potential_merge_commit_parent_oids: [BASE, HEAD],
    merge_ref_oid: MERGE,
    ...overrides,
  };
}

function statusTarget(overrides = {}) {
  return {
    context: "codex/github-review-gate",
    mode: "test-merge-with-head-sentinel",
    live_base_ref_tip: BASE,
    head_ref_oid: HEAD,
    pr_merge_base: MERGE_BASE,
    potential_merge_commit_oid: MERGE,
    potential_merge_commit_tree_oid: TREE,
    potential_merge_commit_parent_oids: [BASE, HEAD],
    merge_ref_oid: MERGE,
    potential_target_state: "validated",
    head_sentinel_state: "pending",
    validation_receipt: {
      pre: observation("2026-08-13T12:00:00Z"),
      post: observation("2026-08-13T12:01:00Z"),
    },
    ...overrides,
  };
}

function headStatusTarget(overrides = {}) {
  const headObservation = (observedHttpDate) => ({
    observed_http_date: observedHttpDate,
    pr_state: "OPEN",
    pr_merged: false,
    pr_merged_at: null,
    live_base_ref_tip: BASE,
    head_ref_oid: HEAD,
    pr_merge_base: MERGE_BASE,
  });
  return {
    context: "codex/github-review-gate",
    mode: "head",
    live_base_ref_tip: BASE,
    head_ref_oid: HEAD,
    pr_merge_base: MERGE_BASE,
    potential_merge_commit_oid: null,
    potential_merge_commit_tree_oid: null,
    potential_merge_commit_parent_oids: null,
    merge_ref_oid: null,
    potential_target_state: "not-applicable",
    head_sentinel_state: "absent",
    validation_receipt: {
      pre: headObservation("2026-08-13T12:00:00Z"),
      post: headObservation("2026-08-13T12:01:00Z"),
    },
    ...overrides,
  };
}

function terminalBasis(overrides = {}) {
  return {
    kind: "terminal-payload",
    outcome: "clean",
    selected_ids: ["2001"],
    selected_urls: [ARTIFACT_URL],
    server_times: {
      request: null,
      selected: [{ id: "2001", server_time: "2026-08-13T12:10:00Z" }],
    },
    pagination_complete: true,
    final_reread_complete: true,
    scope_assurance: "whole-pr-contractual",
    provider_input_lineage: "unavailable",
    finding_recovery: null,
    authority_receipt: {
      selected_request: null,
      selected_artifact: {
        id: "2001",
        url: ARTIFACT_URL,
        created_at: "2026-08-13T12:10:00Z",
      },
      pagination_sha256: DIGEST,
      final_reread_sha256: DIGEST,
      recovery: null,
    },
    ...overrides,
  };
}

function stableInputBasis(overrides = {}) {
  return {
    kind: "stable-input-blocker",
    outcome: "blocked-input",
    selected_ids: [],
    selected_urls: [],
    server_times: { request: null, selected: [] },
    pagination_complete: true,
    final_reread_complete: true,
    scope_assurance: "whole-pr-contractual",
    provider_input_lineage: "unavailable",
    finding_recovery: null,
    authority_receipt: {
      selected_request: null,
      selected_artifact: null,
      pagination_sha256: DIGEST,
      final_reread_sha256: DIGEST,
      recovery: null,
    },
    ...overrides,
  };
}

function reactionBasis(overrides = {}) {
  return terminalBasis({
    kind: "current-request-reaction",
    outcome: "clean",
    selected_ids: ["3001"],
    selected_urls: [REQUEST_URL],
    server_times: {
      request: "2026-08-13T12:00:00Z",
      selected: [{ id: "3001", server_time: "2026-08-13T12:10:00Z" }],
    },
    finding_recovery: null,
    authority_receipt: {
      selected_request: {
        id: "1001",
        url: REQUEST_URL,
        created_at: "2026-08-13T12:00:00Z",
      },
      selected_artifact: null,
      pagination_sha256: DIGEST,
      final_reread_sha256: DIGEST,
      recovery: null,
    },
    ...overrides,
  });
}

function noStartBasis(overrides = {}) {
  const url = "https://github.com/owner/repo/pull/7#issuecomment-5001";
  return terminalBasis({
    kind: "stable-exact-no-start",
    outcome: "skipped-unavailable",
    selected_ids: ["5001"],
    selected_urls: [url],
    server_times: {
      request: "2026-08-13T12:00:00Z",
      selected: [{ id: "5001", server_time: "2026-08-13T12:00:30Z" }],
    },
    finding_recovery: null,
    authority_receipt: {
      selected_request: {
        id: "1001",
        url: REQUEST_URL,
        created_at: "2026-08-13T12:00:00Z",
      },
      selected_artifact: {
        id: "5001",
        url,
        created_at: "2026-08-13T12:00:30Z",
      },
      pagination_sha256: DIGEST,
      final_reread_sha256: DIGEST,
      recovery: null,
    },
    ...overrides,
  });
}

function recoveryBasis(overrides = {}) {
  const closureRecord = (findingId, closureId, findingUrl) => ({
    finding_id: findingId,
    finding_kind: "top-level",
    finding_url: findingUrl,
    finding_server_time: "2026-08-13T12:00:00Z",
    closure_evidence_id: closureId,
    closure_server_time: "2026-08-13T12:05:00Z",
    inline_final_is_resolved: null,
    top_level_exact_body: `/codex-gate addressed ${findingUrl}`,
    top_level_unedited: true,
    top_level_actor_stable: true,
    top_level_actor_permission: "write",
  });
  return terminalBasis({
    selected_ids: ["2001"],
    selected_urls: [ARTIFACT_URL],
    server_times: {
      request: "2026-08-13T12:07:00Z",
      selected: [{ id: "2001", server_time: "2026-08-13T12:10:00Z" }],
    },
    finding_recovery: {
      closure_records: [
        closureRecord("finding-1", "closure-1", ARTIFACT_URL),
        closureRecord(
          "finding-2",
          "closure-2",
          "https://github.com/owner/repo/pull/7#issuecomment-2002",
        ),
      ],
      new_generation_id: "automatic:2",
      new_request_id: "1001",
      new_request_server_time: "2026-08-13T12:07:00Z",
      later_clean_id: "2001",
      later_clean_server_time: "2026-08-13T12:10:00Z",
    },
    authority_receipt: {
      selected_request: {
        id: "1001",
        url: REQUEST_URL,
        created_at: "2026-08-13T12:07:00Z",
      },
      selected_artifact: {
        id: "2001",
        url: ARTIFACT_URL,
        created_at: "2026-08-13T12:10:00Z",
      },
      pagination_sha256: DIGEST,
      final_reread_sha256: DIGEST,
      recovery: {
        finding_ids: ["finding-1", "finding-2"],
        closure_ids: ["closure-1", "closure-2"],
        new_request_id: "1001",
        completion_id: "2001",
      },
    },
    ...overrides,
  });
}

function clone(value) {
  return structuredClone(value);
}

function merge(base, overrides) {
  const result = clone(base);
  for (const [key, value] of Object.entries(overrides)) {
    if (
      value !== null && typeof value === "object" && !Array.isArray(value) &&
      result[key] !== null && typeof result[key] === "object" && !Array.isArray(result[key])
    ) {
      result[key] = { ...result[key], ...clone(value) };
    } else {
      result[key] = clone(value);
    }
  }
  return result;
}

test("vendors the exact stable authority bytes and exports their digest", async () => {
  const bytes = await readFile(new URL(
    "../packages/action/github-codex-evidence-authority-v2.json",
    import.meta.url,
  ));
  const actual = createHash("sha256").update(bytes).digest("hex");
  assert.equal(actual, "29e07793900bb480278cee322746dde679ddcf3b18a8b7b82f552fec389291fc");
  assert.equal(V2_PUBLIC_REPORT_POLICY_SHA256, actual);
  assert.equal(V2_PUBLIC_REPORT_AUTHORITY_SHA256, actual);
  assert.equal(V2_PUBLIC_REPORT_POLICY_DIGEST, `sha256:${actual}`);
  assert.equal(V2_PUBLIC_REPORT_AUTHORITY_DIGEST, `sha256:${actual}`);
  assert.equal(V2_PUBLIC_REPORT_SCHEMA_VERSION, 2);
  assert.equal(V2_PUBLIC_REPORT_SCHEMA.schema_version, 2);
  assert(Object.isFrozen(V2_PUBLIC_REPORT_SCHEMA));
});

test("accepts a closed selected-pending public report and returns the same value", () => {
  const value = report();
  assert.equal(validateV2PublicReport(value), value);
  assert.equal(assertV2PublicReport, validateV2PublicReport);
});

test("accepts head mode only as a non-terminal status target", () => {
  const value = report({ status_target: headStatusTarget() });
  assert.equal(validateV2PublicReport(value), value);

  const terminalClean = report({
    provider_profile: "terminal-payload",
    evidence_basis: terminalBasis(),
    status_target: headStatusTarget(),
    decision: "clean",
  });
  assert.equal(validateV2PublicReport(terminalClean), terminalClean);

  const forgedPotential = report({
    status_target: headStatusTarget({
      potential_merge_commit_oid: MERGE,
      potential_target_state: "validated",
    }),
  });
  assert.throws(() => validateV2PublicReport(forgedPotential), /not-applicable/u);

  const forgedHeadSuccess = report({
    status_target: headStatusTarget({ head_sentinel_state: "success" }),
  });
  assert.throws(() => validateV2PublicReport(forgedHeadSuccess),
    /head_sentinel_state/u);
});

test("accepts the exact ten required fields without optional metadata", () => {
  const value = report();
  delete value.schema_version;
  delete value.snapshot_fingerprint;
  assert.equal(validateV2PublicReport(value), value);
  assert.deepEqual(Object.keys(value).sort(), [
    "decision", "evidence_basis", "freshness_assurance", "provider_input_lineage",
    "provider_profile", "request_policy", "review_epoch", "selection",
    "server_enforcement", "status_target",
  ]);
});

test("accepts terminal clean evidence with authority receipts", () => {
  const value = report({
    provider_profile: "terminal-payload",
    evidence_basis: terminalBasis(),
    decision: "clean",
  });
  assert.equal(validateV2PublicReport(value), value);
});

test("accepts request-bound reaction and no-start evidence only after its request", () => {
  const reaction = report({
    provider_profile: "thumbs-up-clean",
    evidence_basis: reactionBasis(),
    decision: "clean",
  });
  assert.equal(validateV2PublicReport(reaction), reaction);

  const noStart = report({
    provider_profile: "no-start-rejection",
    evidence_basis: noStartBasis(),
    decision: "skipped-unavailable",
  });
  assert.equal(validateV2PublicReport(noStart), noStart);

  for (const value of [reaction, noStart]) {
    const equalTime = clone(value);
    equalTime.evidence_basis.server_times.selected[0].server_time =
      equalTime.evidence_basis.server_times.request;
    if (equalTime.evidence_basis.authority_receipt.selected_artifact !== null) {
      equalTime.evidence_basis.authority_receipt.selected_artifact.created_at =
        equalTime.evidence_basis.server_times.request;
    }
    assert.throws(
      () => validateV2PublicReport(equalTime),
      /strictly after the request time/u,
    );
  }
});

test("accepts not-selected with nullable selected-only structures", () => {
  const value = report({
    selection: { selected: false, intent: "none", mode: "none", source: "none" },
    server_enforcement: "not-applicable",
    review_epoch: null,
    request_policy: emptyRequestPolicy(),
    provider_profile: null,
    status_target: null,
    decision: "not-selected",
  });
  assert.equal(validateV2PublicReport(value), value);
});

test("selection remains selected when an active required target is configuration-blocked", () => {
  const value = report({
    server_enforcement: "not-enforced",
    review_epoch: reviewEpoch({ controlled_request_id: null }),
    request_policy: emptyRequestPolicy(),
    provider_profile: null,
    status_target: statusTarget({
      potential_merge_commit_oid: null,
      potential_merge_commit_tree_oid: null,
      potential_merge_commit_parent_oids: null,
      merge_ref_oid: null,
      potential_target_state: "unavailable",
      head_sentinel_state: "error",
      validation_receipt: null,
    }),
    decision: "blocked-configuration",
  });
  assert.equal(validateV2PublicReport(value), value);
  assert.equal(value.selection.selected, true);

  const collapsed = clone(value);
  collapsed.selection = { selected: false, intent: "none", mode: "none", source: "none" };
  assert.throws(
    () => validateV2PublicReport(collapsed),
    /unselected server enforcement|unselected decision|authority-approved public report state/,
  );
});

test("rejects compact reducer reports rather than translating them", () => {
  const compact = {
    schema_version: 2,
    selection: { status: "selected", intent: "implicit", reason: "ruleset" },
    server_enforcement: { status: "enforced" },
    review_epoch: {},
    request_policy: {},
    provider_profile: "unknown",
    provider_input_lineage: "unavailable",
    evidence_basis: null,
    status_target: { mode: "test-merge-with-head-sentinel" },
    decision: "pending",
    freshness_assurance: "point-in-time",
    snapshot_fingerprint: DIGEST,
  };
  assert.throws(() => validateV2PublicReport(compact), /report.selection/);
});

test("rejects unknown or missing public top-level fields", () => {
  const extra = report();
  extra.internal_reason = "must not leak";
  assert.throws(() => validateV2PublicReport(extra), /unknown key internal_reason/);

  const missing = report();
  delete missing.decision;
  assert.throws(() => validateV2PublicReport(missing), /missing required key decision/);
});

test("rejects near-miss selection, state-matrix, and request-generation relations", () => {
  const badSelection = report({
    selection: { selected: true, intent: "required", mode: "explicit", source: "active-ruleset" },
  });
  assert.throws(() => validateV2PublicReport(badSelection), /authority-approved combination/);

  const badState = report({
    provider_profile: "terminal-payload",
    decision: "clean",
  });
  assert.throws(() => validateV2PublicReport(badState), /authority-approved public report state/);

  const badGeneration = report({
    request_policy: requestPolicy({ generation_id: "automatic:2" }),
  });
  assert.throws(() => validateV2PublicReport(badGeneration), /generation_index/);
});

test("rejects near-miss evidence ordering, profile, and outcome relations", () => {
  const wrongOrder = report({
    provider_profile: "terminal-payload",
    evidence_basis: terminalBasis({
      server_times: {
        request: null,
        selected: [{ id: "9999", server_time: "2026-08-13T12:10:00Z" }],
      },
    }),
    decision: "clean",
  });
  assert.throws(() => validateV2PublicReport(wrongOrder), /must equal "2001"/);

  const wrongOutcome = report({
    provider_profile: "terminal-payload",
    evidence_basis: terminalBasis({ outcome: "findings" }),
    decision: "clean",
  });
  assert.throws(() => validateV2PublicReport(wrongOutcome), /evidence_basis.outcome/);

  const wrongProfile = report({
    provider_profile: "thumbs-up-clean",
    evidence_basis: terminalBasis(),
    decision: "clean",
  });
  assert.throws(() => validateV2PublicReport(wrongProfile), /provider_profile/);

  const nonCanonicalId = report({
    provider_profile: "terminal-payload",
    evidence_basis: terminalBasis({
      selected_ids: ["02001"],
      server_times: {
        request: null,
        selected: [{ id: "02001", server_time: "2026-08-13T12:10:00Z" }],
      },
    }),
    decision: "clean",
  });
  assert.throws(() => validateV2PublicReport(nonCanonicalId), /selected_ids\[0\]/u);
});

test("binds every public artifact URL to the review epoch and object semantics", () => {
  const validReaction = report({
    provider_profile: "thumbs-up-clean",
    evidence_basis: reactionBasis(),
    decision: "clean",
  });
  assert.equal(validateV2PublicReport(validReaction), validReaction);
  assert.notEqual(
    validReaction.evidence_basis.selected_ids[0],
    validReaction.request_policy.request_id,
  );

  for (const requestUrl of [
    "https://github.com/other/repo/pull/7#issuecomment-1001",
    "https://github.com/owner/repo/pull/8#issuecomment-1001",
    "https://github.com/owner/repo/pull/7#issuecomment-9999",
    "https://github.com/owner/repo/pull/7#pullrequestreview-1001",
  ]) {
    const invalid = report({
      request_policy: requestPolicy({ request_url: requestUrl }),
    });
    assert.throws(
      () => validateV2PublicReport(invalid),
      /request_url (?:repository|pull request|fragment id|fragment kind)/u,
    );
  }

  for (const selectedUrl of [
    "https://github.com/other/repo/pull/7#issuecomment-2001",
    "https://github.com/owner/repo/pull/8#issuecomment-2001",
    "https://github.com/owner/repo/pull/7#issuecomment-2999",
    "https://github.com/owner/repo/pull/7#discussion_r2001",
  ]) {
    const basis = terminalBasis();
    basis.selected_urls[0] = selectedUrl;
    basis.authority_receipt.selected_artifact.url = selectedUrl;
    const invalid = report({
      provider_profile: "terminal-payload",
      evidence_basis: basis,
      decision: "clean",
    });
    assert.throws(
      () => validateV2PublicReport(invalid),
      /selected_urls\[0\] (?:repository|pull request|fragment id|fragment kind)/u,
    );
  }

  const recovery = report({
    provider_profile: "terminal-payload",
    evidence_basis: recoveryBasis(),
    request_policy: requestPolicy({
      generation_id: "automatic:2",
      generation_index: 2,
      automatic_reservations_consumed_on_head: 2,
    }),
    decision: "clean",
  });
  assert.equal(validateV2PublicReport(recovery), recovery);
  const wrongFindingScope = clone(recovery);
  wrongFindingScope.evidence_basis.finding_recovery.closure_records[0].finding_url =
    "https://github.com/other/repo/pull/7#issuecomment-2001";
  wrongFindingScope.evidence_basis.finding_recovery.closure_records[0].top_level_exact_body =
    "/codex-gate addressed https://github.com/other/repo/pull/7#issuecomment-2001";
  assert.throws(
    () => validateV2PublicReport(wrongFindingScope),
    /finding_url repository/u,
  );

  const wrongFindingKind = clone(recovery);
  wrongFindingKind.evidence_basis.finding_recovery.closure_records[0].finding_url =
    "https://github.com/owner/repo/pull/7#discussion_r2001";
  wrongFindingKind.evidence_basis.finding_recovery.closure_records[0].top_level_exact_body =
    "/codex-gate addressed https://github.com/owner/repo/pull/7#discussion_r2001";
  assert.throws(
    () => validateV2PublicReport(wrongFindingKind),
    /finding_url fragment kind/u,
  );
});

test("finding recovery requires one unique closure evidence id per finding", () => {
  const valid = report({
    provider_profile: "terminal-payload",
    evidence_basis: recoveryBasis(),
    request_policy: requestPolicy({
      generation_id: "automatic:2",
      generation_index: 2,
      automatic_reservations_consumed_on_head: 2,
    }),
    decision: "clean",
  });
  assert.equal(validateV2PublicReport(valid), valid);

  const duplicate = clone(valid);
  duplicate.evidence_basis.finding_recovery.closure_records[1]
    .closure_evidence_id = "closure-1";
  duplicate.evidence_basis.authority_receipt.recovery.closure_ids[1] =
    "closure-1";
  assert.throws(
    () => validateV2PublicReport(duplicate),
    /unique closure evidence id/u,
  );
});

test("rejects near-miss validated status target relations", () => {
  const wrongParents = report({
    status_target: statusTarget({ potential_merge_commit_parent_oids: [HEAD, BASE] }),
  });
  assert.throws(() => validateV2PublicReport(wrongParents), /validated merge parents/);

  const changedPost = report();
  changedPost.status_target.validation_receipt.post.merge_ref_oid = "9".repeat(40);
  assert.throws(() => validateV2PublicReport(changedPost), /merge_ref_oid/);

  const positiveWithoutTarget = report({
    provider_profile: "terminal-payload",
    evidence_basis: terminalBasis(),
    status_target: statusTarget({
      potential_merge_commit_oid: null,
      potential_merge_commit_tree_oid: null,
      potential_merge_commit_parent_oids: null,
      merge_ref_oid: null,
      potential_target_state: "stale",
      validation_receipt: null,
    }),
    decision: "clean",
  });
  assert.throws(() => validateV2PublicReport(positiveWithoutTarget), /positive decision target state/);

  const cleanWithoutSentinel = report({
    provider_profile: "terminal-payload",
    evidence_basis: terminalBasis(),
    status_target: statusTarget({ head_sentinel_state: "absent" }),
    decision: "clean",
  });
  assert.throws(
    () => validateV2PublicReport(cleanWithoutSentinel),
    /positive decision head_sentinel_state/u,
  );

  const skippedWithoutSentinel = report({
    provider_profile: "no-start-rejection",
    evidence_basis: noStartBasis(),
    status_target: statusTarget({ head_sentinel_state: "absent" }),
    decision: "skipped-unavailable",
  });
  assert.throws(
    () => validateV2PublicReport(skippedWithoutSentinel),
    /positive decision head_sentinel_state/u,
  );
});

test("pre-epoch blockers expose no epoch-derived provider or evidence state", () => {
  for (const decision of ["blocked-input", "blocked-configuration"]) {
    const value = report({
      server_enforcement: decision === "blocked-configuration"
        ? "not-enforced"
        : "enforced",
      review_epoch: null,
      request_policy: emptyRequestPolicy(),
      provider_profile: null,
      evidence_basis: null,
      status_target: null,
      decision,
    });
    assert.equal(validateV2PublicReport(value), value);
  }

  const forgedBasis = report({
    review_epoch: null,
    request_policy: emptyRequestPolicy(),
    provider_profile: null,
    evidence_basis: stableInputBasis(),
    status_target: null,
    decision: "blocked-input",
  });
  assert.throws(
    () => validateV2PublicReport(forgedBasis),
    /null epoch\/target requires a closed pre-epoch blocker/u,
  );
});

test("accepts the exact legacy alias warning on a pre-provider configuration block", () => {
  const legacy = report({
    selection: {
      selected: true,
      intent: "explicit",
      mode: "explicit",
      source: "legacy-triple",
    },
    server_enforcement: "not-enforced",
    review_epoch: reviewEpoch({ controlled_request_id: null }),
    request_policy: emptyRequestPolicy({
      warnings: ["legacy-triple-alias"],
      warning_evidence: { legacy_triple_alias: true },
    }),
    provider_profile: null,
    evidence_basis: null,
    status_target: statusTarget({
      potential_merge_commit_oid: null,
      potential_merge_commit_tree_oid: null,
      potential_merge_commit_parent_oids: null,
      merge_ref_oid: null,
      potential_target_state: "unavailable",
      head_sentinel_state: "error",
      validation_receipt: null,
    }),
    decision: "blocked-configuration",
  });
  assert.equal(validateV2PublicReport(legacy), legacy);
  assert.equal(legacy.request_policy.status, "not-applicable");
  assert.deepEqual(legacy.request_policy.warnings, ["legacy-triple-alias"]);

  const lifecycleBlocker = report({
    selection: structuredClone(legacy.selection),
    server_enforcement: "not-enforced",
    review_epoch: reviewEpoch({ controlled_request_id: null }),
    request_policy: emptyRequestPolicy({
      status: "unknown",
      warnings: ["legacy-triple-alias"],
      warning_evidence: { legacy_triple_alias: true },
    }),
    provider_profile: null,
    evidence_basis: stableInputBasis(),
    decision: "blocked-input",
  });
  assert.equal(validateV2PublicReport(lifecycleBlocker), lifecycleBlocker);
  assert.equal(lifecycleBlocker.request_policy.status, "unknown");

  const establishedNotApplicable = clone(lifecycleBlocker);
  establishedNotApplicable.request_policy.status = "not-applicable";
  assert.throws(
    () => validateV2PublicReport(establishedNotApplicable),
    /absent eligible request plane/u,
  );

  const missingWarning = clone(legacy);
  missingWarning.request_policy.warnings = [];
  missingWarning.request_policy.warning_evidence.legacy_triple_alias = null;
  assert.throws(
    () => validateV2PublicReport(missingWarning),
    /legacy-triple-alias warning count/,
  );

  const duplicateWarning = clone(legacy);
  duplicateWarning.request_policy.warnings.push("legacy-triple-alias");
  assert.throws(
    () => validateV2PublicReport(duplicateWarning),
    /must not contain duplicates/,
  );

  const warningAlias = clone(legacy);
  warningAlias.request_policy.warnings = ["legacy-triple"];
  assert.throws(
    () => validateV2PublicReport(warningAlias),
    /warnings\[0\]/,
  );

  const oldSelectionAlias = clone(legacy);
  oldSelectionAlias.selection.source = "legacy-triple-alias";
  assert.throws(
    () => validateV2PublicReport(oldSelectionAlias),
    /outside the closed authority enum/,
  );
});

test("forbids legacy alias warnings for every non-legacy selection shape", () => {
  const warning = {
    warnings: ["legacy-triple-alias"],
    warning_evidence: { legacy_triple_alias: true },
  };
  const userExplicit = report({
    selection: {
      selected: true,
      intent: "explicit",
      mode: "explicit",
      source: "user-explicit",
    },
    server_enforcement: "not-enforced",
    request_policy: requestPolicy({ status: "warning", ...warning }),
  });
  assert.throws(
    () => validateV2PublicReport(userExplicit),
    /non-legacy warning count/,
  );

  const implicit = report({
    request_policy: requestPolicy({ status: "warning", ...warning }),
  });
  assert.throws(
    () => validateV2PublicReport(implicit),
    /non-legacy warning count/,
  );

  const disabled = report({
    selection: { selected: false, intent: "none", mode: "none", source: "none" },
    server_enforcement: "not-applicable",
    review_epoch: null,
    request_policy: emptyRequestPolicy(warning),
    provider_profile: null,
    evidence_basis: null,
    status_target: null,
    decision: "not-selected",
  });
  assert.throws(
    () => validateV2PublicReport(disabled),
    /not-applicable warning count/,
  );

  const falseEvidence = report();
  falseEvidence.request_policy.warning_evidence.legacy_triple_alias = false;
  assert.throws(
    () => validateV2PublicReport(falseEvidence),
    /non-legacy warning evidence/,
  );
});

test("enforces the manual permission tuple", () => {
  const manualWithoutPermission = report({
    request_policy: requestPolicy({
      request_id: "1002",
      request_url: "https://github.com/owner/repo/pull/7#issuecomment-1002",
      manual: true,
      generation_id: "manual:1",
      generation_kind: "manual",
      generation_index: 1,
      manual_requests_in_review_epoch: 1,
    }),
    review_epoch: reviewEpoch({ controlled_request_id: "1002" }),
  });
  assert.throws(() => validateV2PublicReport(manualWithoutPermission), /manual request permission fields/);
});
