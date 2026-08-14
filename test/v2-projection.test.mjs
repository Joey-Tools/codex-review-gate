import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import test from "node:test";

import { reduceV2Snapshot } from "../packages/action/src/v2/reducer.mjs";
import {
  MAX_GENERATED_STICKY_COMMENT_BYTES,
  MAX_STICKY_COMMENT_BYTES,
  MAX_STICKY_EDIT_LOG_ENTRIES,
  STICKY_AUDIT_SCHEMA,
  STICKY_RAW_BINDING_SCHEMA,
  bindStickyCommentRawDigest,
  buildStickyAuditProjection,
  digestExactRawStickyBody,
  parseStickyAuditProjection,
  validateV2ReducerReport,
  verifyStickyCommentRawDigest,
} from "../packages/action/src/v2/projection.mjs";

const SCOPE = {
  repository_node_id: "R_kgDOExample",
  pull_request_node_id: "PR_kwDOExample",
};

test("projects deterministic reducer state without making sticky state authoritative", () => {
  const reducerReport = makeReducerReport({
    decision: "clean",
    selectionReason: "current reducer result --> remains data",
  });
  const inputCopy = structuredClone(reducerReport);
  const args = {
    reducer_report: reducerReport,
    scope: SCOPE,
    edit: makeEdit(),
  };

  const first = buildStickyAuditProjection(args);
  const second = buildStickyAuditProjection(args);

  assert.deepEqual(first, second);
  assert.deepEqual(reducerReport, inputCopy, "projection must not mutate reducer output");
  assert.equal(first.metadata.schema, STICKY_AUDIT_SCHEMA);
  assert.equal(first.metadata.schema_version, 1);
  assert.equal(first.metadata.current_sequence, 1);
  assert.equal(first.metadata.edit_log[0].snapshot.decision, "clean");
  assert.equal(
    first.metadata.history_semantics.model,
    "append-only-within-sticky-edits",
  );
  assert.equal(
    first.metadata.history_semantics.integrity_limit,
    "not-immutable-or-deletion-resistant",
  );
  assert.match(first.body, /audit projection only; it is never review-gate input/u);
  assert.match(first.body, /not immutable or deletion-resistant/u);
  assert.match(first.body, /Provider input lineage: <code>unavailable<\/code>/u);
  assert.match(first.body, /<code>whole-pr-contractual<\/code>/u);
  assert.doesNotMatch(first.body, /<details>/u);
  assert.doesNotMatch(first.body, /current reducer result --> remains data/u);
  assert.match(first.body, /current reducer result --&gt; remains data/u);
  assert.equal(countOccurrences(first.body, "<!-- codex-review-gate-sticky-v2\n"), 1);
  assert.equal(Buffer.byteLength(first.body, "utf8") <= MAX_GENERATED_STICKY_COMMENT_BYTES, true);
  assert.equal(
    first.body_sha256,
    `sha256:${createHash("sha256").update(Buffer.from(first.body, "utf8")).digest("hex")}`,
  );
  assert.deepEqual(parseStickyAuditProjection(first.body), first.metadata);
  assert.deepEqual(
    validateV2ReducerReport(reducerReport),
    first.metadata.edit_log[0].snapshot,
  );
});

test("appends validated prior projections and renders old states only as collapsed audit history", () => {
  const first = buildStickyAuditProjection({
    reducer_report: makeReducerReport({ decision: "pending" }),
    scope: SCOPE,
    edit: makeEdit(),
  });
  const originalEntries = structuredClone(first.metadata.edit_log);
  const second = buildStickyAuditProjection({
    reducer_report: makeReducerReport({
      decision: "clean",
      mergeSha: sha("d"),
      mergeTreeSha: sha("e"),
      snapshotFingerprint: digest("2"),
    }),
    scope: SCOPE,
    edit: makeEdit({
      timestamp: "2026-08-13T10:01:00.000Z",
      run_id: "778",
      run_attempt: 2,
    }),
    prior_projection: parseStickyAuditProjection(first.body),
  });

  assert.deepEqual(second.metadata.edit_log.slice(0, 1), originalEntries);
  assert.equal(second.metadata.current_sequence, 2);
  assert.equal(second.metadata.edit_log[1].sequence, 2);
  assert.equal(
    second.metadata.edit_log[1].previous_entry_hash,
    first.metadata.edit_log[0].entry_hash,
  );
  assert.equal(second.metadata.edit_log[1].snapshot.decision, "clean");
  assert.equal(second.metadata.edit_log[1].snapshot.test_merge_sha, sha("d"));
  assert.notEqual(
    second.metadata.edit_log[1].entry_hash,
    first.metadata.edit_log[0].entry_hash,
  );
  assert.match(second.body, /<details>/u);
  assert.match(second.body, /<summary>Prior audit projections \(1\)<\/summary>/u);
  assert.match(second.body, /decision <code>pending<\/code>/u);
  assert.deepEqual(parseStickyAuditProjection(second.body), second.metadata);

  assert.throws(
    () => buildStickyAuditProjection({
      reducer_report: makeReducerReport(),
      scope: { ...SCOPE, pull_request_node_id: "PR_other" },
      edit: makeEdit(),
      prior_projection: second.metadata,
    }),
    /different repository or pull request/u,
  );
});

test("rejects non-canonical, visibly edited, schema-open, and chain-broken sticky bodies", () => {
  const projection = buildStickyAuditProjection({
    reducer_report: makeReducerReport(),
    scope: SCOPE,
    edit: makeEdit(),
  });

  const visibleEdit = projection.body.replace(
    "Decision: <code>clean</code>",
    "Decision: <code>pending</code>",
  );
  assert.equal(parseStickyAuditProjection(visibleEdit), null);

  const extraMetadataKey = rewriteMetadata(projection.body, (metadata) => {
    metadata.unrecognized = true;
  });
  assert.equal(parseStickyAuditProjection(extraMetadataKey), null);

  const brokenSnapshotHash = rewriteMetadata(projection.body, (metadata) => {
    metadata.edit_log[0].snapshot.decision = "findings";
  });
  assert.equal(parseStickyAuditProjection(brokenSnapshotHash), null);

  const duplicateMarker = projection.body.replace(
    "## Codex GitHub review gate",
    "## Codex GitHub review gate\n<!-- codex-review-gate-sticky-v2\nAAAA\n-->",
  );
  assert.equal(parseStickyAuditProjection(duplicateMarker), null);

  const nonCanonicalMetadata = projection.body.replace(
    encodedMetadata(projection.body),
    Buffer.from(JSON.stringify(projection.metadata, null, 2), "utf8").toString("base64"),
  );
  assert.equal(parseStickyAuditProjection(nonCanonicalMetadata), null);
  assert.equal(
    parseStickyAuditProjection(`${"x".repeat(MAX_STICKY_COMMENT_BYTES)}${projection.body}`),
    null,
  );
});

test("enforces closed reducer, scope, edit, and target schemas", () => {
  const baseArgs = {
    reducer_report: makeReducerReport(),
    scope: SCOPE,
    edit: makeEdit(),
  };
  assert.throws(
    () => buildStickyAuditProjection({
      ...baseArgs,
      reducer_report: { ...baseArgs.reducer_report, sticky_state: { decision: "clean" } },
    }),
    /closed key set/u,
  );
  assert.throws(
    () => buildStickyAuditProjection({
      ...baseArgs,
      scope: { ...SCOPE, repository_name: "owner/repo" },
    }),
    /closed key set/u,
  );
  assert.throws(
    () => buildStickyAuditProjection({
      ...baseArgs,
      edit: { ...makeEdit(), note: "unbounded" },
    }),
    /closed key set/u,
  );
  assert.throws(
    () => buildStickyAuditProjection({
      ...baseArgs,
      reducer_report: makeReducerReport({ statusTargetSha: sha("f") }),
    }),
    /must be exactly/u,
  );
  const headModeReport = makeReducerReport({ statusTargetSha: sha("b") });
  headModeReport.status_target.mode = "head";
  const headModeProjection = buildStickyAuditProjection({
    ...baseArgs,
    reducer_report: headModeReport,
  });
  assert.equal(
    headModeProjection.metadata.edit_log[0].snapshot.status_target_mode,
    "head",
  );
  assert.equal(
    headModeProjection.metadata.edit_log[0].snapshot.status_target_sha,
    sha("b"),
  );
  assert.throws(
    () => buildStickyAuditProjection({
      ...baseArgs,
      edit: makeEdit({ timestamp: "2026-08-13T10:00:00+00:00" }),
    }),
    /canonical UTC timestamp/u,
  );
  assert.throws(
    () => buildStickyAuditProjection({
      ...baseArgs,
      reducer_report: makeReducerReport({ selectionReason: "bad\ud800unicode" }),
    }),
    /non-empty string/u,
  );
  for (const invalidDecision of ["success", "failure", "Clean"]) {
    assert.throws(
      () => buildStickyAuditProjection({
        ...baseArgs,
        reducer_report: makeReducerReport({ decision: invalidDecision }),
      }),
      /must be one of/u,
    );
  }
  assert.throws(
    () => buildStickyAuditProjection({
      ...baseArgs,
      reducer_report: {
        ...baseArgs.reducer_report,
        provider_profile: "terminal-payload",
        evidence_basis: null,
      },
    }),
    /incompatible evidence basis/u,
  );
  const configurationReport = makeReducerReport();
  configurationReport.selection.status = "blocked";
  configurationReport.server_enforcement.status = "not-enforced";
  configurationReport.server_enforcement.app_bound = false;
  configurationReport.request_policy.status = "not-applicable";
  configurationReport.request_policy.selected_request_id = null;
  configurationReport.request_policy.generation_id = null;
  configurationReport.request_policy.generation_kind = null;
  configurationReport.request_policy.generation_index = null;
  configurationReport.provider_profile = null;
  configurationReport.decision = "blocked-configuration";
  configurationReport.evidence_basis = {
    kind: "configuration",
    scope_assurance: "whole-pr-contractual",
    artifact_id: null,
    summary: "server enforcement configuration is invalid",
    authority_receipt: authorityReceipt({
      selectedRequest: null,
      selectedArtifact: null,
    }),
  };
  assert.equal(
    buildStickyAuditProjection({
      ...baseArgs,
      reducer_report: configurationReport,
    }).metadata.edit_log[0].snapshot.evidence_basis_kind,
    "configuration",
  );
  for (const malformedBasis of [
    {
      kind: "configuration",
      scope_assurance: "whole-pr-contractual",
      artifact_id: null,
      summary: "valid",
      extra: true,
    },
    {
      kind: "malformed-evidence",
      scope_assurance: null,
      artifact_id: "10",
      summary: "missing publication assurance",
    },
  ]) {
    const malformedReport = makeReducerReport();
    malformedReport.provider_profile = malformedBasis.kind === "configuration" ? null : "unknown";
    malformedReport.evidence_basis = malformedBasis;
    assert.throws(
      () => buildStickyAuditProjection({
        ...baseArgs,
        reducer_report: malformedReport,
      }),
      /closed key set|scope[_ ]assurance/u,
    );
  }
  const malformedTerminalReport = makeReducerReport();
  malformedTerminalReport.decision = "inconclusive";
  malformedTerminalReport.provider_profile = "mixed";
  malformedTerminalReport.evidence_basis = {
    kind: "malformed-evidence",
    scope_assurance: "whole-pr-contractual",
    artifact_id: "10",
    summary: "selected terminal-looking evidence is malformed",
    authority_receipt: authorityReceipt({
      selectedArtifact: authorityArtifact("10"),
    }),
  };
  assert.equal(
    buildStickyAuditProjection({
      ...baseArgs,
      reducer_report: malformedTerminalReport,
    }).metadata.edit_log[0].snapshot.evidence_basis_kind,
    "malformed-evidence",
  );

  const noStartReport = makeReducerReport({ decision: "skipped-unavailable" });
  noStartReport.provider_profile = "no-start-rejection";
  noStartReport.evidence_basis = {
    kind: "no-start-rejection",
    scope_assurance: "whole-pr-contractual",
    artifact_id: "12",
    summary: "accepted stable exact no-start response",
    authority_receipt: authorityReceipt({
      selectedArtifact: authorityArtifact("12"),
    }),
  };
  assert.equal(
    buildStickyAuditProjection({
      ...baseArgs,
      reducer_report: noStartReport,
    }).metadata.edit_log[0].snapshot.evidence_basis_kind,
    "no-start-rejection",
  );
});

test("projects the closed manual permission audit tuple without granting it authority", () => {
  const reducerReport = makeReducerReport();
  reducerReport.request_policy = {
    ...reducerReport.request_policy,
    status: "compliant",
    permission_assurance: "point-in-time-only",
    request_time_permission: "unproven",
    permission_aba_excluded: false,
  };
  const projection = buildStickyAuditProjection({
    reducer_report: reducerReport,
    scope: SCOPE,
    edit: makeEdit(),
  });
  const snapshot = projection.metadata.edit_log[0].snapshot;
  assert.equal(snapshot.permission_assurance, "point-in-time-only");
  assert.equal(snapshot.request_time_permission, "unproven");
  assert.equal(snapshot.permission_aba_excluded, false);
  assert.equal(snapshot.request_policy_status, "compliant");
  assert.deepEqual(parseStickyAuditProjection(projection.body), projection.metadata);

  reducerReport.request_policy.status = "warning";
  assert.equal(
    buildStickyAuditProjection({
      reducer_report: reducerReport,
      scope: SCOPE,
      edit: makeEdit(),
    }).metadata.edit_log[0].snapshot.request_policy_status,
    "warning",
  );

  reducerReport.request_policy.status = "not-applicable";
  assert.throws(
    () => buildStickyAuditProjection({
      reducer_report: reducerReport,
      scope: SCOPE,
      edit: makeEdit(),
    }),
    /cannot use a not-applicable request policy/u,
  );

  reducerReport.request_policy.status = "compliant";
  reducerReport.request_policy.permission_aba_excluded = true;
  assert.throws(
    () => buildStickyAuditProjection({
      reducer_report: reducerReport,
      scope: SCOPE,
      edit: makeEdit(),
    }),
    /must be false or null/u,
  );
});

test("accepts a real reducer report and binds its complete ordered review epoch", () => {
  const report = reduceV2Snapshot(makeReducerInputSnapshot(), {
    status_target_mode: "test-merge-with-head-sentinel",
    status_context: "codex/github-review-gate",
  });
  const snapshot = validateV2ReducerReport(report);

  assert.equal(report.decision, "pending");
  assert.equal(snapshot.repository_id, "R_repo");
  assert.equal(snapshot.base_sha, sha("a"));
  assert.equal(snapshot.head_sha, sha("b"));
  assert.equal(snapshot.merge_base_sha, sha("a"));
  assert.deepEqual(snapshot.merge_parent_shas, [sha("a"), sha("b")]);
  assert.equal(snapshot.pull_request_lifecycle, "open");
  assert.equal(snapshot.test_merge_sha, sha("c"));

  const projection = buildStickyAuditProjection({
    reducer_report: report,
    scope: SCOPE,
    edit: makeEdit(),
  });
  assert.deepEqual(projection.metadata.edit_log[0].snapshot, snapshot);
  assert.deepEqual(parseStickyAuditProjection(projection.body), projection.metadata);
});

test("preserves the complete in-comment prefix and fails closed instead of truncating history", () => {
  let projection = buildStickyAuditProjection({
    reducer_report: makeReducerReport(),
    scope: SCOPE,
    edit: makeEdit(),
  });
  let successfulEntries = 1;

  for (let sequence = 2; sequence <= MAX_STICKY_EDIT_LOG_ENTRIES + 1; sequence += 1) {
    const oldEntries = structuredClone(projection.metadata.edit_log);
    try {
      projection = buildStickyAuditProjection({
        reducer_report: makeReducerReport({
          decision: sequence % 2 === 0 ? "pending" : "clean",
          snapshotFingerprint: digest(sequence.toString(16).at(-1)),
        }),
        scope: SCOPE,
        edit: makeEdit({
          timestamp: `2026-08-13T10:${String(sequence).padStart(2, "0")}:00.000Z`,
          run_id: String(777 + sequence),
          run_attempt: sequence,
        }),
        prior_projection: projection.metadata,
      });
      successfulEntries = sequence;
      assert.deepEqual(projection.metadata.edit_log.slice(0, -1), oldEntries);
    } catch (error) {
      assert.match(
        error.message,
        /maximum|generated sticky audit comment|sticky metadata/u,
      );
      assert.deepEqual(projection.metadata.edit_log, oldEntries);
      break;
    }
  }

  assert.equal(successfulEntries > 1, true);
  assert.equal(successfulEntries <= MAX_STICKY_EDIT_LOG_ENTRIES, true);
  assert.equal(Buffer.byteLength(projection.body, "utf8") <= MAX_GENERATED_STICKY_COMMENT_BYTES, true);
  assert.deepEqual(parseStickyAuditProjection(projection.body), projection.metadata);
});

test("cross-binds exact canonical body bytes to repository, PR, epoch, and comment identity", () => {
  const projection = buildStickyAuditProjection({
    reducer_report: makeReducerReport(),
    scope: SCOPE,
    edit: makeEdit(),
  });
  const bindingArgs = {
    raw_body: projection.body,
    ...SCOPE,
    repository_id: "R_repo",
    pull_request_number: 42,
    base_sha: sha("a"),
    head_sha: sha("b"),
    merge_base_sha: sha("a"),
    test_merge_sha: sha("c"),
    test_merge_tree_sha: sha("4"),
    merge_parent_shas: [sha("a"), sha("b")],
    pull_request_lifecycle: "open",
    provider_input_lineage: "unavailable",
    comment_id: "90071992547409930001",
    comment_node_id: "IC_kwDOExample",
  };
  const binding = bindStickyCommentRawDigest(bindingArgs);

  assert.equal(binding.schema, STICKY_RAW_BINDING_SCHEMA);
  assert.equal(binding.schema_version, 1);
  assert.equal(binding.raw_body_bytes, Buffer.byteLength(projection.body, "utf8"));
  assert.equal(binding.raw_body_sha256, projection.body_sha256);
  assert.match(binding.binding_sha256, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(
    binding,
    bindStickyCommentRawDigest({
      ...bindingArgs,
      raw_body: Buffer.from(projection.body, "utf8"),
    }),
  );
  assert.equal(verifyStickyCommentRawDigest(binding, projection.body), true);
  assert.equal(verifyStickyCommentRawDigest(binding, `${projection.body}\n`), false);
  assert.equal(
    verifyStickyCommentRawDigest({ ...binding, comment_id: "90071992547409930002" }, projection.body),
    false,
  );
  assert.equal(
    verifyStickyCommentRawDigest({ ...binding, extra: true }, projection.body),
    false,
  );

  const changedComment = bindStickyCommentRawDigest({
    ...bindingArgs,
    comment_id: "90071992547409930002",
  });
  const changedCommentNode = bindStickyCommentRawDigest({
    ...bindingArgs,
    comment_node_id: "IC_kwDOOther",
  });
  assert.notEqual(changedComment.binding_sha256, binding.binding_sha256);
  assert.notEqual(changedCommentNode.binding_sha256, binding.binding_sha256);
  assert.equal(changedComment.raw_body_sha256, binding.raw_body_sha256);
  assert.equal(changedCommentNode.raw_body_sha256, binding.raw_body_sha256);

  for (const mismatch of [
    { repository_node_id: "R_other" },
    { repository_id: "R_other" },
    { pull_request_node_id: "PR_other" },
    { pull_request_number: 43 },
    { base_sha: sha("5") },
    { head_sha: sha("6") },
    { merge_base_sha: sha("5") },
    { test_merge_sha: sha("d") },
    { test_merge_tree_sha: sha("e") },
    { merge_parent_shas: [sha("b"), sha("a")] },
    { pull_request_lifecycle: "closed" },
  ]) {
    assert.throws(
      () => bindStickyCommentRawDigest({ ...bindingArgs, ...mismatch }),
      /does not match the supplied binding scope and review epoch/u,
    );
  }

  assert.notEqual(digestExactRawStickyBody("line\n"), digestExactRawStickyBody("line\r\n"));
  assert.throws(
    () => bindStickyCommentRawDigest({ ...bindingArgs, raw_body: "x".repeat(MAX_STICKY_COMMENT_BYTES + 1) }),
    /maximum/u,
  );
  assert.throws(
    () => bindStickyCommentRawDigest({ ...bindingArgs, raw_body: Buffer.from([0xff]) }),
    /encoded data was not valid|UTF-8/u,
  );
});

function makeReducerReport({
  decision = "clean",
  selectionReason = "selected current-head provider evidence",
  mergeSha = sha("c"),
  mergeTreeSha = sha("4"),
  statusTargetSha = mergeSha,
  snapshotFingerprint = digest("1"),
} = {}) {
  return {
    schema_version: 2,
    selection: {
      status: "selected",
      intent: decision === "clean" ? "explicit" : "implicit",
      reason: selectionReason,
    },
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
      repository_id: "R_repo",
      pull_request_number: 42,
      base_oid: sha("a"),
      head_oid: sha("b"),
      merge_base_oid: sha("a"),
      merge_oid: mergeSha,
      merge_tree_oid: mergeTreeSha,
      merge_parents: [sha("a"), sha("b")],
      merge_ref_oid: mergeSha,
      mergeable: "MERGEABLE",
      lifecycle: "open",
    },
    request_policy: {
      status: "compliant",
      selected_request_id: "987654321",
      reason: "one controlled exact-scope request",
      permission_assurance: null,
      request_time_permission: null,
      permission_aba_excluded: null,
      generation_id: "automatic:1",
      generation_kind: "automatic",
      generation_index: 1,
    },
    provider_profile: decision === "pending" ? "unknown" : "terminal-payload",
    provider_input_lineage: "unavailable",
    evidence_basis: decision === "pending"
      ? null
      : {
          kind: "terminal-clean",
          scope_assurance: "whole-pr-contractual",
          artifact_id: "12345",
          summary: "accepted current-scope terminal clean artifact",
          authority_receipt: authorityReceipt(),
        },
    status_target: {
      mode: "test-merge-with-head-sentinel",
      sha: statusTargetSha,
      context: "codex/github-review-gate",
    },
    decision,
    freshness_assurance: "point-in-time",
    snapshot_fingerprint: snapshotFingerprint,
  };
}

function makeReducerInputSnapshot() {
  return {
    schema_version: 2,
    observed_at: "2026-08-13T12:30:00Z",
    snapshot_fingerprint: digest("e"),
    complete: true,
    selection: {
      intent: "implicit",
      eligible: true,
      reason: "eligible current pull request",
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
      pull_request_number: 42,
      base_oid: sha("a"),
      head_oid: sha("b"),
      merge_base_oid: sha("a"),
      merge_oid: sha("c"),
      merge_tree_oid: sha("4"),
      merge_parents: [sha("a"), sha("b")],
      merge_ref_oid: sha("c"),
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
      pagination_sha256: digest("a"),
      final_reread_sha256: digest("f"),
    },
    budget: {
      automatic_requests_on_head: 0,
      automatic_reservations_on_head: 0,
      manual_requests_in_epoch: 0,
    },
  };
}

function authorityArtifact(id, {
  createdAt = "2026-08-13T10:00:30.000Z",
} = {}) {
  return {
    id,
    url: `https://github.com/owner/repo/pull/42#issuecomment-${id}`,
    created_at: createdAt,
  };
}

function authorityReceipt({
  selectedRequest = authorityArtifact("987654321", {
    createdAt: "2026-08-13T10:00:00.000Z",
  }),
  selectedArtifact = authorityArtifact("12345"),
  recovery = null,
} = {}) {
  return {
    selected_request: selectedRequest,
    selected_artifact: selectedArtifact,
    pagination_sha256: digest("a"),
    final_reread_sha256: digest("f"),
    recovery,
    selected_generation: selectedRequest === null ? null : {
      id: "automatic:1",
      kind: "automatic",
      index: 1,
    },
  };
}

function makeEdit(overrides = {}) {
  return {
    timestamp: "2026-08-13T10:00:00.000Z",
    actor_login: "github-actions[bot]",
    run_id: "777",
    run_attempt: 1,
    ...overrides,
  };
}

function sha(character) {
  return character.repeat(40);
}

function digest(character) {
  return `sha256:${character.repeat(64)}`;
}

function encodedMetadata(body) {
  const match = body.match(
    /\n\n<!-- codex-review-gate-sticky-v2\n([A-Za-z0-9+/]+={0,2})\n-->\n$/u,
  );
  assert.ok(match);
  return match[1];
}

function rewriteMetadata(body, mutate) {
  const encoded = encodedMetadata(body);
  const metadata = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  mutate(metadata);
  return body.replace(
    encoded,
    Buffer.from(canonicalJson(metadata), "utf8").toString("base64"),
  );
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}
