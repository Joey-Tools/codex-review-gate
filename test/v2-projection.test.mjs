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

test("preserves legacy v1 terminal scope only as audit history and writes strict current scope", () => {
  const legacy = makeLegacyV1ArtifactProjection();
  const parsedLegacy = parseStickyAuditProjection(legacy.body);
  const legacyFindings = makeLegacyV1ArtifactProjection({
    kind: "terminal-findings",
    decision: "findings",
  });

  assert.deepEqual(parsedLegacy, legacy.metadata);
  assert.deepEqual(
    parseStickyAuditProjection(legacyFindings.body),
    legacyFindings.metadata,
  );
  assert.equal(
    parsedLegacy.edit_log[0].snapshot.evidence_scope_assurance,
    "whole-pr-contractual",
  );

  const currentReport = makeReducerReport({ decision: "inconclusive" });
  currentReport.provider_profile = "terminal-payload";
  currentReport.evidence_basis = {
    kind: "terminal-clean",
    scope_assurance: "artifact-publication-only",
    artifact_id: "12345",
    summary: "accepted provider-authored terminal clean publication",
    authority_receipt: authorityReceipt({ selectedRequest: null }),
  };
  const current = buildStickyAuditProjection({
    reducer_report: currentReport,
    scope: SCOPE,
    edit: makeEdit({
      timestamp: "2026-08-13T10:01:00.000Z",
      run_id: "778",
      run_attempt: 2,
    }),
    prior_projection: parsedLegacy,
  });

  assert.equal(current.metadata.current_sequence, 2);
  assert.equal(current.metadata.edit_log[0].snapshot.decision, "clean");
  assert.equal(
    current.metadata.edit_log[0].snapshot.evidence_scope_assurance,
    "whole-pr-contractual",
  );
  assert.equal(current.metadata.edit_log[1].snapshot.decision, "inconclusive");
  assert.equal(
    current.metadata.edit_log[1].snapshot.evidence_scope_assurance,
    "artifact-publication-only",
  );
  assert.match(current.body, /Decision: <code>inconclusive<\/code>/u);
  assert.deepEqual(parseStickyAuditProjection(current.body), current.metadata);

  const invalidCurrentReport = structuredClone(currentReport);
  invalidCurrentReport.evidence_basis.scope_assurance = "whole-pr-contractual";
  assert.throws(
    () => buildStickyAuditProjection({
      reducer_report: invalidCurrentReport,
      scope: SCOPE,
      edit: makeEdit(),
    }),
    /terminal-clean must use artifact-publication-only/u,
  );
});

test("preserves exact legacy v1 malformed and unresolved artifact bytes only as audit history", () => {
  const fixedFixtures = [
    {
      kind: "malformed-evidence",
      decision: "inconclusive",
      body_base64: [
        "IyMgQ29kZXggR2l0SHViIHJldmlldyBnYXRlCgotIERlY2lzaW9uOiA8Y29kZT5pbmNvbmNsdXNpdmU8L2NvZGU+Ci0gU2VsZWN0",
        "aW9uOiA8Y29kZT5zZWxlY3RlZDwvY29kZT4gKDxjb2RlPmV4cGxpY2l0PC9jb2RlPikKLSBSZWFzb246IHNlbGVjdGVkIGN1cnJl",
        "bnQtaGVhZCBwcm92aWRlciBldmlkZW5jZQotIFNlcnZlciBlbmZvcmNlbWVudDogPGNvZGU+ZW5mb3JjZWQ8L2NvZGU+Ci0gUmVx",
        "dWVzdCBwb2xpY3k6IDxjb2RlPmNvbXBsaWFudDwvY29kZT4KLSBQcm92aWRlciBwcm9maWxlOiA8Y29kZT50ZXJtaW5hbC1wYXls",
        "b2FkPC9jb2RlPgotIFByb3ZpZGVyIGlucHV0IGxpbmVhZ2U6IDxjb2RlPnVuYXZhaWxhYmxlPC9jb2RlPgotIEV2aWRlbmNlIGJh",
        "c2lzOiA8Y29kZT5tYWxmb3JtZWQtZXZpZGVuY2U8L2NvZGU+ICg8Y29kZT53aG9sZS1wci1jb250cmFjdHVhbDwvY29kZT4pCi0g",
        "UHVsbCByZXF1ZXN0IGxpZmVjeWNsZTogPGNvZGU+b3BlbjwvY29kZT4KLSBNZXJnZSBiYXNlOiA8Y29kZT5hYWFhYWFhYWFhYWFh",
        "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhPC9jb2RlPgotIE1lcmdlIHBhcmVudHM6IDxjb2RlPmFhYWFhYWFhYWFhYWFhYWFh",
        "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWEgYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYjwvY29kZT4KLSBU",
        "ZXN0LW1lcmdlOiA8Y29kZT5jY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjPC9jb2RlPgotIFN0YXR1cyB0",
        "YXJnZXQ6IDxjb2RlPmNvZGV4L2dpdGh1Yi1yZXZpZXctZ2F0ZTwvY29kZT4gYXQgPGNvZGU+Y2NjY2NjY2NjY2NjY2NjY2NjY2Nj",
        "Y2NjY2NjY2NjY2NjY2NjY2NjYzwvY29kZT4KLSBTbmFwc2hvdDogPGNvZGU+c2hhMjU2OjExMTExMTExMTExMTExMTExMTExMTEx",
        "MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE8L2NvZGU+Ci0gQXVkaXQgZWRpdDogPGNvZGU+IzE8L2Nv",
        "ZGU+IGF0IDxjb2RlPjIwMjYtMDgtMTNUMTA6MDA6MDAuMDAwWjwvY29kZT4gYnkgPGNvZGU+Z2l0aHViLWFjdGlvbnNbYm90XTwv",
        "Y29kZT4KClRoaXMgc3RpY2t5IGNvbW1lbnQgaXMgYW4gYXVkaXQgcHJvamVjdGlvbiBvbmx5OyBpdCBpcyBuZXZlciByZXZpZXct",
        "Z2F0ZSBpbnB1dC4KSXRzIGluLWNvbW1lbnQgZWRpdCBoaXN0b3J5IGlzIGFwcGVuZC1vbmx5IHdoZW4gcHJlc2VydmVkLCBidXQg",
        "aXMgbm90IGltbXV0YWJsZSBvciBkZWxldGlvbi1yZXNpc3RhbnQuCgo8IS0tIGNvZGV4LXJldmlldy1nYXRlLXN0aWNreS12Mgpl",
        "eUpqZFhKeVpXNTBYM05sY1hWbGJtTmxJam94TENKbFpHbDBYMnh2WnlJNlczc2laV1JwZENJNmV5SmhZM1J2Y2w5c2IyZHBiaUk2",
        "SW1kcGRHaDFZaTFoWTNScGIyNXpXMkp2ZEYwaUxDSnlkVzVmWVhSMFpXMXdkQ0k2TVN3aWNuVnVYMmxrSWpvaU56YzNJaXdpZEds",
        "dFpYTjBZVzF3SWpvaU1qQXlOaTB3T0MweE0xUXhNRG93TURvd01DNHdNREJhSW4wc0ltVnVkSEo1WDJoaGMyZ2lPaUp6YUdFeU5U",
        "WTZZamt6WmpjeE5tRmhPVEl6TVRrM09XUm1Zak0zT1dWaE4yRTFNVGszTXpoak1tTmtOak0wTVRnME9HTTJNVEEzWW1JNE16YzFP",
        "R000TlRFeU5XWTVOaUlzSW5CeVpYWnBiM1Z6WDJWdWRISjVYMmhoYzJnaU9tNTFiR3dzSW5ObGNYVmxibU5sSWpveExDSnpibUZ3",
        "YzJodmRDSTZleUpoY0hCZlltOTFibVFpT25SeWRXVXNJbUpoYzJWZmMyaGhJam9pWVdGaFlXRmhZV0ZoWVdGaFlXRmhZV0ZoWVdG",
        "aFlXRmhZV0ZoWVdGaFlXRmhZV0ZoWVdGaFlTSXNJbU52Ym5SeWIyeHNaWEpmWVhaaGFXeGhZbXhsSWpwMGNuVmxMQ0prWldOcGMy",
        "bHZiaUk2SW1sdVkyOXVZMngxYzJsMlpTSXNJbVYyYVdSbGJtTmxYMkpoYzJselgydHBibVFpT2lKdFlXeG1iM0p0WldRdFpYWnBa",
        "R1Z1WTJVaUxDSmxkbWxrWlc1alpWOXpZMjl3WlY5aGMzTjFjbUZ1WTJVaU9pSjNhRzlzWlMxd2NpMWpiMjUwY21GamRIVmhiQ0lz",
        "SW1aeVpYTm9ibVZ6YzE5aGMzTjFjbUZ1WTJVaU9pSndiMmx1ZEMxcGJpMTBhVzFsSWl3aVoyVnVaWEpoZEdsdmJsOXBaQ0k2SW1G",
        "MWRHOXRZWFJwWXpveElpd2laMlZ1WlhKaGRHbHZibDlwYm1SbGVDSTZNU3dpWjJWdVpYSmhkR2x2Ymw5cmFXNWtJam9pWVhWMGIy",
        "MWhkR2xqSWl3aWFHVmhaRjl6YUdFaU9pSmlZbUppWW1KaVltSmlZbUppWW1KaVltSmlZbUppWW1KaVltSmlZbUppWW1KaVltSmlZ",
        "bUppSWl3aWJXVnlaMlZmWW1GelpWOXphR0VpT2lKaFlXRmhZV0ZoWVdGaFlXRmhZV0ZoWVdGaFlXRmhZV0ZoWVdGaFlXRmhZV0Zo",
        "WVdGaFlXRmhJaXdpYldWeVoyVmZjR0Z5Wlc1MFgzTm9ZWE1pT2xzaVlXRmhZV0ZoWVdGaFlXRmhZV0ZoWVdGaFlXRmhZV0ZoWVdG",
        "aFlXRmhZV0ZoWVdGaFlXRmhZU0lzSW1KaVltSmlZbUppWW1KaVltSmlZbUppWW1KaVltSmlZbUppWW1KaVltSmlZbUppWW1KaVlt",
        "SWlYU3dpYldWeVoyVmZjbVZtWDNOb1lTSTZJbU5qWTJOalkyTmpZMk5qWTJOalkyTmpZMk5qWTJOalkyTmpZMk5qWTJOalkyTmpZ",
        "Mk5qWTJNaUxDSnRaWEpuWldGaWJHVWlPaUpOUlZKSFJVRkNURVVpTENKd1pYSnRhWE56YVc5dVgyRmlZVjlsZUdOc2RXUmxaQ0k2",
        "Ym5Wc2JDd2ljR1Z5YldsemMybHZibDloYzNOMWNtRnVZMlVpT201MWJHd3NJbkJ5YjNacFpHVnlYMmx1Y0hWMFgyeHBibVZoWjJV",
        "aU9pSjFibUYyWVdsc1lXSnNaU0lzSW5CeWIzWnBaR1Z5WDNCeWIyWnBiR1VpT2lKMFpYSnRhVzVoYkMxd1lYbHNiMkZrSWl3aWNI",
        "VnNiRjl5WlhGMVpYTjBYMnhwWm1WamVXTnNaU0k2SW05d1pXNGlMQ0p3ZFd4c1gzSmxjWFZsYzNSZmJuVnRZbVZ5SWpvME1pd2lj",
        "bVZ3YjNKMFgzTmphR1Z0WVY5MlpYSnphVzl1SWpveUxDSnlaWEJ2Y25SZmMyaGhNalUySWpvaWMyaGhNalUyT2prek5qSXpOV0l4",
        "WTJGaFpXSTNPREpsWW1aaE1UVXlOVGd6WmpRellqVTVZelUxTXpCaFpEWTFZbUV6WVRZellXWmxaRGc1WlRWa04yUTBaV1UxWlRJ",
        "aUxDSnlaWEJ2YzJsMGIzSjVYMmxrSWpvaVVsOXlaWEJ2SWl3aWNtVnhkV1Z6ZEY5d2IyeHBZM2xmY21WaGMyOXVJam9pYjI1bElH",
        "TnZiblJ5YjJ4c1pXUWdaWGhoWTNRdGMyTnZjR1VnY21WeGRXVnpkQ0lzSW5KbGNYVmxjM1JmY0c5c2FXTjVYM04wWVhSMWN5STZJ",
        "bU52YlhCc2FXRnVkQ0lzSW5KbGNYVmxjM1JmZEdsdFpWOXdaWEp0YVhOemFXOXVJanB1ZFd4c0xDSnlkV3hsYzJWMFgyTnZiWEJo",
        "ZEdsaWJHVWlPblJ5ZFdVc0luSjFiR1Z6WlhSZmNtVnhkV2x5WldRaU9uUnlkV1VzSW5ObGJHVmpkR1ZrWDNKbGNYVmxjM1JmYVdR",
        "aU9pSTVPRGMyTlRRek1qRWlMQ0p6Wld4bFkzUnBiMjVmYVc1MFpXNTBJam9pWlhod2JHbGphWFFpTENKelpXeGxZM1JwYjI1ZmNt",
        "VmhjMjl1SWpvaWMyVnNaV04wWldRZ1kzVnljbVZ1ZEMxb1pXRmtJSEJ5YjNacFpHVnlJR1YyYVdSbGJtTmxJaXdpYzJWc1pXTjBh",
        "Vzl1WDNOMFlYUjFjeUk2SW5ObGJHVmpkR1ZrSWl3aWMyVnlkbVZ5WDJWdVptOXlZMlZ0Wlc1MFgzTjBZWFIxY3lJNkltVnVabTl5",
        "WTJWa0lpd2ljMjVoY0hOb2IzUmZabWx1WjJWeWNISnBiblFpT2lKemFHRXlOVFk2TVRFeE1URXhNVEV4TVRFeE1URXhNVEV4TVRF",
        "eE1URXhNVEV4TVRFeE1URXhNVEV4TVRFeE1URXhNVEV4TVRFeE1URXhNVEV4TVRFeE1URXhNVEV4TVNJc0luTjBZWFIxYzE5amIy",
        "NTBaWGgwSWpvaVkyOWtaWGd2WjJsMGFIVmlMWEpsZG1sbGR5MW5ZWFJsSWl3aWMzUmhkSFZ6WDNSaGNtZGxkRjl0YjJSbElqb2lk",
        "R1Z6ZEMxdFpYSm5aUzEzYVhSb0xXaGxZV1F0YzJWdWRHbHVaV3dpTENKemRHRjBkWE5mZEdGeVoyVjBYM05vWVNJNkltTmpZMk5q",
        "WTJOalkyTmpZMk5qWTJOalkyTmpZMk5qWTJOalkyTmpZMk5qWTJOalkyTmpZMk1pTENKMFpYTjBYMjFsY21kbFgzTm9ZU0k2SW1O",
        "alkyTmpZMk5qWTJOalkyTmpZMk5qWTJOalkyTmpZMk5qWTJOalkyTmpZMk5qWTJOalkyTWlMQ0owWlhOMFgyMWxjbWRsWDNSeVpX",
        "VmZjMmhoSWpvaU5EUTBORFEwTkRRME5EUTBORFEwTkRRME5EUTBORFEwTkRRME5EUTBORFEwTkRRME5EUTBOQ0lzSW5kdmNtdG1i",
        "RzkzWDJOdmJYQmhkR2xpYkdVaU9uUnlkV1VzSW5kdmNtdG1iRzkzWDNCeVpYTmxiblFpT25SeWRXVjlmVjBzSW1ocGMzUnZjbmxm",
        "YzJWdFlXNTBhV056SWpwN0ltbHVkR1ZuY21sMGVWOXNhVzFwZENJNkltNXZkQzFwYlcxMWRHRmliR1V0YjNJdFpHVnNaWFJwYjI0",
        "dGNtVnphWE4wWVc1MElpd2liVzlrWld3aU9pSmhjSEJsYm1RdGIyNXNlUzEzYVhSb2FXNHRjM1JwWTJ0NUxXVmthWFJ6SW4wc0lu",
        "TmphR1Z0WVNJNkltTnZaR1Y0TFhKbGRtbGxkeTFuWVhSbExYTjBhV05yZVMxMk1pSXNJbk5qYUdWdFlWOTJaWEp6YVc5dUlqb3hM",
        "Q0p6WTI5d1pTSTZleUp3ZFd4c1gzSmxjWFZsYzNSZmJtOWtaVjlwWkNJNklsQlNYMnQzUkU5RmVHRnRjR3hsSWl3aWNtVndiM05w",
        "ZEc5eWVWOXViMlJsWDJsa0lqb2lVbDlyWjBSUFJYaGhiWEJzWlNKOWZRPT0KLS0+Cg==",
      ].join(""),
      body_bytes: 4399,
      entry_hash: "sha256:b93f716aa9231979dfb379ea7a519738c2cd6341848c6107bb83758c85125f96",
      body_sha256: "sha256:f20c3fad67c378c03574b6e1e06ff0cb968015603705bb1ad8dbe65ecf6094c9",
      binding_sha256: "sha256:a214b8e210798a1b3242be0866ca689bf96e3af973c9d1caddb85a14423259cc",
    },
    {
      kind: "unresolved-inline-finding",
      decision: "findings",
      body_base64: [
        "IyMgQ29kZXggR2l0SHViIHJldmlldyBnYXRlCgotIERlY2lzaW9uOiA8Y29kZT5maW5kaW5nczwvY29kZT4KLSBTZWxlY3Rpb246",
        "IDxjb2RlPnNlbGVjdGVkPC9jb2RlPiAoPGNvZGU+ZXhwbGljaXQ8L2NvZGU+KQotIFJlYXNvbjogc2VsZWN0ZWQgY3VycmVudC1o",
        "ZWFkIHByb3ZpZGVyIGV2aWRlbmNlCi0gU2VydmVyIGVuZm9yY2VtZW50OiA8Y29kZT5lbmZvcmNlZDwvY29kZT4KLSBSZXF1ZXN0",
        "IHBvbGljeTogPGNvZGU+Y29tcGxpYW50PC9jb2RlPgotIFByb3ZpZGVyIHByb2ZpbGU6IDxjb2RlPnRlcm1pbmFsLXBheWxvYWQ8",
        "L2NvZGU+Ci0gUHJvdmlkZXIgaW5wdXQgbGluZWFnZTogPGNvZGU+dW5hdmFpbGFibGU8L2NvZGU+Ci0gRXZpZGVuY2UgYmFzaXM6",
        "IDxjb2RlPnVucmVzb2x2ZWQtaW5saW5lLWZpbmRpbmc8L2NvZGU+ICg8Y29kZT53aG9sZS1wci1jb250cmFjdHVhbDwvY29kZT4p",
        "Ci0gUHVsbCByZXF1ZXN0IGxpZmVjeWNsZTogPGNvZGU+b3BlbjwvY29kZT4KLSBNZXJnZSBiYXNlOiA8Y29kZT5hYWFhYWFhYWFh",
        "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhPC9jb2RlPgotIE1lcmdlIHBhcmVudHM6IDxjb2RlPmFhYWFhYWFhYWFhYWFh",
        "YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWEgYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYjwvY29kZT4K",
        "LSBUZXN0LW1lcmdlOiA8Y29kZT5jY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjPC9jb2RlPgotIFN0YXR1",
        "cyB0YXJnZXQ6IDxjb2RlPmNvZGV4L2dpdGh1Yi1yZXZpZXctZ2F0ZTwvY29kZT4gYXQgPGNvZGU+Y2NjY2NjY2NjY2NjY2NjY2Nj",
        "Y2NjY2NjY2NjY2NjY2NjY2NjY2NjYzwvY29kZT4KLSBTbmFwc2hvdDogPGNvZGU+c2hhMjU2OjExMTExMTExMTExMTExMTExMTEx",
        "MTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTE8L2NvZGU+Ci0gQXVkaXQgZWRpdDogPGNvZGU+IzE8",
        "L2NvZGU+IGF0IDxjb2RlPjIwMjYtMDgtMTNUMTA6MDA6MDAuMDAwWjwvY29kZT4gYnkgPGNvZGU+Z2l0aHViLWFjdGlvbnNbYm90",
        "XTwvY29kZT4KClRoaXMgc3RpY2t5IGNvbW1lbnQgaXMgYW4gYXVkaXQgcHJvamVjdGlvbiBvbmx5OyBpdCBpcyBuZXZlciByZXZp",
        "ZXctZ2F0ZSBpbnB1dC4KSXRzIGluLWNvbW1lbnQgZWRpdCBoaXN0b3J5IGlzIGFwcGVuZC1vbmx5IHdoZW4gcHJlc2VydmVkLCBi",
        "dXQgaXMgbm90IGltbXV0YWJsZSBvciBkZWxldGlvbi1yZXNpc3RhbnQuCgo8IS0tIGNvZGV4LXJldmlldy1nYXRlLXN0aWNreS12",
        "MgpleUpqZFhKeVpXNTBYM05sY1hWbGJtTmxJam94TENKbFpHbDBYMnh2WnlJNlczc2laV1JwZENJNmV5SmhZM1J2Y2w5c2IyZHBi",
        "aUk2SW1kcGRHaDFZaTFoWTNScGIyNXpXMkp2ZEYwaUxDSnlkVzVmWVhSMFpXMXdkQ0k2TVN3aWNuVnVYMmxrSWpvaU56YzNJaXdp",
        "ZEdsdFpYTjBZVzF3SWpvaU1qQXlOaTB3T0MweE0xUXhNRG93TURvd01DNHdNREJhSW4wc0ltVnVkSEo1WDJoaGMyZ2lPaUp6YUdF",
        "eU5UWTZaak0xT0RrMlptRTJNakk0WkdVNU0yRTFZVFU1WWprd01XUTNPR0ZtTlRNeE16QmxZamc0TlRVek5XSTROR1pqTnpsalpH",
        "TTNaVFl5WTJNNVl6STBOaUlzSW5CeVpYWnBiM1Z6WDJWdWRISjVYMmhoYzJnaU9tNTFiR3dzSW5ObGNYVmxibU5sSWpveExDSnpi",
        "bUZ3YzJodmRDSTZleUpoY0hCZlltOTFibVFpT25SeWRXVXNJbUpoYzJWZmMyaGhJam9pWVdGaFlXRmhZV0ZoWVdGaFlXRmhZV0Zo",
        "WVdGaFlXRmhZV0ZoWVdGaFlXRmhZV0ZoWVdGaFlTSXNJbU52Ym5SeWIyeHNaWEpmWVhaaGFXeGhZbXhsSWpwMGNuVmxMQ0prWldO",
        "cGMybHZiaUk2SW1acGJtUnBibWR6SWl3aVpYWnBaR1Z1WTJWZlltRnphWE5mYTJsdVpDSTZJblZ1Y21WemIyeDJaV1F0YVc1c2FX",
        "NWxMV1pwYm1ScGJtY2lMQ0psZG1sa1pXNWpaVjl6WTI5d1pWOWhjM04xY21GdVkyVWlPaUozYUc5c1pTMXdjaTFqYjI1MGNtRmpk",
        "SFZoYkNJc0ltWnlaWE5vYm1WemMxOWhjM04xY21GdVkyVWlPaUp3YjJsdWRDMXBiaTEwYVcxbElpd2laMlZ1WlhKaGRHbHZibDlw",
        "WkNJNkltRjFkRzl0WVhScFl6b3hJaXdpWjJWdVpYSmhkR2x2Ymw5cGJtUmxlQ0k2TVN3aVoyVnVaWEpoZEdsdmJsOXJhVzVrSWpv",
        "aVlYVjBiMjFoZEdsaklpd2lhR1ZoWkY5emFHRWlPaUppWW1KaVltSmlZbUppWW1KaVltSmlZbUppWW1KaVltSmlZbUppWW1KaVlt",
        "SmlZbUppWW1KaUlpd2liV1Z5WjJWZlltRnpaVjl6YUdFaU9pSmhZV0ZoWVdGaFlXRmhZV0ZoWVdGaFlXRmhZV0ZoWVdGaFlXRmhZ",
        "V0ZoWVdGaFlXRmhZV0ZoSWl3aWJXVnlaMlZmY0dGeVpXNTBYM05vWVhNaU9sc2lZV0ZoWVdGaFlXRmhZV0ZoWVdGaFlXRmhZV0Zo",
        "WVdGaFlXRmhZV0ZoWVdGaFlXRmhZV0ZoWVNJc0ltSmlZbUppWW1KaVltSmlZbUppWW1KaVltSmlZbUppWW1KaVltSmlZbUppWW1K",
        "aVltSmlZbUlpWFN3aWJXVnlaMlZmY21WbVgzTm9ZU0k2SW1OalkyTmpZMk5qWTJOalkyTmpZMk5qWTJOalkyTmpZMk5qWTJOalky",
        "TmpZMk5qWTJOalkyTWlMQ0p0WlhKblpXRmliR1VpT2lKTlJWSkhSVUZDVEVVaUxDSndaWEp0YVhOemFXOXVYMkZpWVY5bGVHTnNk",
        "V1JsWkNJNmJuVnNiQ3dpY0dWeWJXbHpjMmx2Ymw5aGMzTjFjbUZ1WTJVaU9tNTFiR3dzSW5CeWIzWnBaR1Z5WDJsdWNIVjBYMnhw",
        "Ym1WaFoyVWlPaUoxYm1GMllXbHNZV0pzWlNJc0luQnliM1pwWkdWeVgzQnliMlpwYkdVaU9pSjBaWEp0YVc1aGJDMXdZWGxzYjJG",
        "a0lpd2ljSFZzYkY5eVpYRjFaWE4wWDJ4cFptVmplV05zWlNJNkltOXdaVzRpTENKd2RXeHNYM0psY1hWbGMzUmZiblZ0WW1WeUlq",
        "bzBNaXdpY21Wd2IzSjBYM05qYUdWdFlWOTJaWEp6YVc5dUlqb3lMQ0p5WlhCdmNuUmZjMmhoTWpVMklqb2ljMmhoTWpVMk9tSmhN",
        "bUV6TkdNeE5UaGpZekZoWmpCa1lUaGxPV1JoTXpjeE0yUmtZVE14WlROa04yRm1OalE1WmpsbE16QXlPREppWXpreVptWmtZamhr",
        "TkRRNU56QWlMQ0p5WlhCdmMybDBiM0o1WDJsa0lqb2lVbDl5WlhCdklpd2ljbVZ4ZFdWemRGOXdiMnhwWTNsZmNtVmhjMjl1SWpv",
        "aWIyNWxJR052Ym5SeWIyeHNaV1FnWlhoaFkzUXRjMk52Y0dVZ2NtVnhkV1Z6ZENJc0luSmxjWFZsYzNSZmNHOXNhV041WDNOMFlY",
        "UjFjeUk2SW1OdmJYQnNhV0Z1ZENJc0luSmxjWFZsYzNSZmRHbHRaVjl3WlhKdGFYTnphVzl1SWpwdWRXeHNMQ0p5ZFd4bGMyVjBY",
        "Mk52YlhCaGRHbGliR1VpT25SeWRXVXNJbkoxYkdWelpYUmZjbVZ4ZFdseVpXUWlPblJ5ZFdVc0luTmxiR1ZqZEdWa1gzSmxjWFZs",
        "YzNSZmFXUWlPaUk1T0RjMk5UUXpNakVpTENKelpXeGxZM1JwYjI1ZmFXNTBaVzUwSWpvaVpYaHdiR2xqYVhRaUxDSnpaV3hsWTNS",
        "cGIyNWZjbVZoYzI5dUlqb2ljMlZzWldOMFpXUWdZM1Z5Y21WdWRDMW9aV0ZrSUhCeWIzWnBaR1Z5SUdWMmFXUmxibU5sSWl3aWMy",
        "VnNaV04wYVc5dVgzTjBZWFIxY3lJNkluTmxiR1ZqZEdWa0lpd2ljMlZ5ZG1WeVgyVnVabTl5WTJWdFpXNTBYM04wWVhSMWN5STZJ",
        "bVZ1Wm05eVkyVmtJaXdpYzI1aGNITm9iM1JmWm1sdVoyVnljSEpwYm5RaU9pSnphR0V5TlRZNk1URXhNVEV4TVRFeE1URXhNVEV4",
        "TVRFeE1URXhNVEV4TVRFeE1URXhNVEV4TVRFeE1URXhNVEV4TVRFeE1URXhNVEV4TVRFeE1URXhNVEV4TVRFeE1TSXNJbk4wWVhS",
        "MWMxOWpiMjUwWlhoMElqb2lZMjlrWlhndloybDBhSFZpTFhKbGRtbGxkeTFuWVhSbElpd2ljM1JoZEhWelgzUmhjbWRsZEY5dGIy",
        "UmxJam9pZEdWemRDMXRaWEpuWlMxM2FYUm9MV2hsWVdRdGMyVnVkR2x1Wld3aUxDSnpkR0YwZFhOZmRHRnlaMlYwWDNOb1lTSTZJ",
        "bU5qWTJOalkyTmpZMk5qWTJOalkyTmpZMk5qWTJOalkyTmpZMk5qWTJOalkyTmpZMk5qWTJNaUxDSjBaWE4wWDIxbGNtZGxYM05v",
        "WVNJNkltTmpZMk5qWTJOalkyTmpZMk5qWTJOalkyTmpZMk5qWTJOalkyTmpZMk5qWTJOalkyTmpZMk1pTENKMFpYTjBYMjFsY21k",
        "bFgzUnlaV1ZmYzJoaElqb2lORFEwTkRRME5EUTBORFEwTkRRME5EUTBORFEwTkRRME5EUTBORFEwTkRRME5EUTBORFEwTkNJc0lu",
        "ZHZjbXRtYkc5M1gyTnZiWEJoZEdsaWJHVWlPblJ5ZFdVc0luZHZjbXRtYkc5M1gzQnlaWE5sYm5RaU9uUnlkV1Y5ZlYwc0ltaHBj",
        "M1J2Y25sZmMyVnRZVzUwYVdOeklqcDdJbWx1ZEdWbmNtbDBlVjlzYVcxcGRDSTZJbTV2ZEMxcGJXMTFkR0ZpYkdVdGIzSXRaR1Zz",
        "WlhScGIyNHRjbVZ6YVhOMFlXNTBJaXdpYlc5a1pXd2lPaUpoY0hCbGJtUXRiMjVzZVMxM2FYUm9hVzR0YzNScFkydDVMV1ZrYVhS",
        "ekluMHNJbk5qYUdWdFlTSTZJbU52WkdWNExYSmxkbWxsZHkxbllYUmxMWE4wYVdOcmVTMTJNaUlzSW5OamFHVnRZVjkyWlhKemFX",
        "OXVJam94TENKelkyOXdaU0k2ZXlKd2RXeHNYM0psY1hWbGMzUmZibTlrWlY5cFpDSTZJbEJTWDJ0M1JFOUZlR0Z0Y0d4bElpd2lj",
        "bVZ3YjNOcGRHOXllVjl1YjJSbFgybGtJam9pVWw5clowUlBSWGhoYlhCc1pTSjlmUT09Ci0tPgo=",
      ].join(""),
      body_bytes: 4406,
      entry_hash: "sha256:f35896fa6228de93a5a59b901d78af53130eb885535b84fc79cdc7e62cc9c246",
      body_sha256: "sha256:a8732722740b7fdba561dd8a8ae64cf8a22f3da24c268d2b4650a556b01b0efa",
      binding_sha256: "sha256:848f435a9f656330615f242d670eb36a4ad558ffda2f1a020029abd8bf9db909",
    },
  ];

  for (const fixed of fixedFixtures) {
    const legacyBodyBytes = Buffer.from(fixed.body_base64, "base64");
    const legacyBody = legacyBodyBytes.toString("utf8");
    assert.equal(legacyBodyBytes.toString("base64"), fixed.body_base64);
    assert.equal(legacyBodyBytes.length, fixed.body_bytes);
    assert.equal(digestExactRawStickyBody(legacyBodyBytes), fixed.body_sha256);

    const parsed = parseStickyAuditProjection(legacyBody);
    assert.notEqual(parsed, null);
    assert.equal(parsed.schema_version, 1);
    assert.equal(parsed.edit_log[0].entry_hash, fixed.entry_hash);
    assert.equal(parsed.edit_log[0].snapshot.evidence_basis_kind, fixed.kind);
    assert.equal(
      parsed.edit_log[0].snapshot.evidence_scope_assurance,
      "whole-pr-contractual",
    );

    const legacyBinding = bindStickyCommentRawDigest(
      stickyBindingArgs(legacyBodyBytes),
    );
    assert.equal(legacyBinding.raw_body_bytes, fixed.body_bytes);
    assert.equal(legacyBinding.raw_body_sha256, fixed.body_sha256);
    assert.equal(legacyBinding.binding_sha256, fixed.binding_sha256);
    assert.equal(verifyStickyCommentRawDigest(legacyBinding, legacyBodyBytes), true);
    assert.equal(verifyStickyCommentRawDigest(legacyBinding, `${legacyBody}\n`), false);

    const currentReport = makeCurrentArtifactReport(fixed.kind, fixed.decision);
    const continued = buildStickyAuditProjection({
      reducer_report: currentReport,
      scope: SCOPE,
      edit: makeEdit({
        timestamp: "2026-08-13T10:01:00.000Z",
        run_id: "778",
        run_attempt: 2,
      }),
      prior_projection: parsed,
    });
    assert.equal(continued.metadata.current_sequence, 2);
    assert.equal(
      continued.metadata.edit_log[0].snapshot.evidence_scope_assurance,
      "whole-pr-contractual",
    );
    assert.equal(
      continued.metadata.edit_log[1].snapshot.evidence_scope_assurance,
      "artifact-publication-only",
    );
    assert.deepEqual(parseStickyAuditProjection(continued.body), continued.metadata);
    const continuedBinding = bindStickyCommentRawDigest(
      stickyBindingArgs(continued.body),
    );
    assert.equal(continuedBinding.raw_body_sha256, continued.body_sha256);
    assert.equal(
      verifyStickyCommentRawDigest(continuedBinding, continued.body),
      true,
    );

    const invalidCurrent = structuredClone(currentReport);
    invalidCurrent.evidence_basis.scope_assurance = "whole-pr-contractual";
    assert.throws(
      () => buildStickyAuditProjection({
        reducer_report: invalidCurrent,
        scope: SCOPE,
        edit: makeEdit(),
        prior_projection: parsed,
      }),
      new RegExp(`${fixed.kind} must use artifact-publication-only`, "u"),
    );

    const forgedPositive = structuredClone(currentReport);
    forgedPositive.decision = "clean";
    assert.throws(
      () => buildStickyAuditProjection({
        reducer_report: forgedPositive,
        scope: SCOPE,
        edit: makeEdit(),
        prior_projection: parsed,
      }),
      /decision clean has an incompatible provider profile|decision clean has an incompatible evidence basis/u,
    );

    const neutral = buildStickyAuditProjection({
      reducer_report: makeReducerReport({ decision: "pending" }),
      scope: SCOPE,
      edit: makeEdit({
        timestamp: "2026-08-13T10:02:00.000Z",
        run_id: "779",
        run_attempt: 3,
      }),
      prior_projection: parsed,
    });
    assert.equal(neutral.metadata.edit_log[1].snapshot.decision, "pending");
    assert.equal(neutral.metadata.edit_log[1].snapshot.evidence_basis_kind, null);
    assert.equal(neutral.metadata.edit_log[1].snapshot.evidence_scope_assurance, null);
  }
});

test("rejects hash-valid whole-pr legacy scope outside the fixed artifact allowlist", () => {
  const overbroadLegacy = makeLegacyV1ArtifactProjection({
    kind: "unknown-terminal",
    decision: "inconclusive",
  });

  assert.equal(parseStickyAuditProjection(overbroadLegacy.body), null);
  assert.throws(
    () => buildStickyAuditProjection({
      reducer_report: makeReducerReport({ decision: "pending" }),
      scope: SCOPE,
      edit: makeEdit(),
      prior_projection: overbroadLegacy.metadata,
    }),
    /evidence scope assurance does not match its basis kind/u,
  );
  assert.throws(
    () => bindStickyCommentRawDigest(
      stickyBindingArgs(overbroadLegacy.body),
    ),
    /not a canonical sticky audit projection/u,
  );
});

test("projects a reducer-owned stable terminal input blocker without rejecting its provider profile", () => {
  const request = {
    id: "1001",
    url: "https://github.com/owner/repo/pull/42#issuecomment-1001",
    kind: "automatic",
    body: "@codex review",
    created_at: "2026-08-13T12:00:00Z",
    updated_at: "2026-08-13T12:00:00Z",
    controlled: true,
    stable: true,
    base_oid: sha("a"),
    head_oid: sha("b"),
    current_incarnation: true,
    actor_permission: null,
    generation_id: "automatic:1",
    generation_kind: "automatic",
    generation_index: 1,
  };
  const input = makeReducerInputSnapshot();
  input.review_epoch = {
    ...input.review_epoch,
    merge_oid: null,
    merge_tree_oid: null,
    merge_parents: [],
    merge_ref_oid: null,
    mergeable: "CONFLICTING",
  };
  input.requests = [request];
  input.artifacts = [{
    id: "2001",
    url: "https://github.com/owner/repo/pull/42#issuecomment-2001",
    kind: "terminal-clean",
    channel: "issue-comment",
    request_id: request.id,
    created_at: "2026-08-13T12:10:00Z",
    commit_oid: sha("b"),
    stable: true,
    finding_ids: [],
  }];
  input.budget = {
    automatic_requests_on_head: 1,
    automatic_reservations_on_head: 1,
    manual_requests_in_epoch: 0,
  };
  for (const [providerProfile, acknowledgements] of [
    ["terminal-payload", []],
    ["mixed", [{
      id: "3001",
      kind: "plus-one",
      request_id: request.id,
      finding_id: null,
      created_at: "2026-08-13T12:15:00Z",
      commit_oid: sha("b"),
      exact_provider: true,
      stable: true,
    }]],
  ]) {
    const report = reduceV2Snapshot({ ...input, acknowledgements }, {
      status_target_mode: "test-merge-with-head-sentinel",
      status_context: "codex/github-review-gate",
    });

    assert.equal(report.decision, "blocked-input");
    assert.equal(report.provider_profile, providerProfile);
    assert.equal(report.evidence_basis.kind, "input");
    assert.equal(report.status_target.sha, null);
    const projection = buildStickyAuditProjection({
      reducer_report: report,
      scope: SCOPE,
      edit: makeEdit(),
    });
    assert.equal(projection.metadata.edit_log[0].snapshot.decision, "blocked-input");
    assert.equal(projection.metadata.edit_log[0].snapshot.evidence_basis_kind, "input");
  }
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
    scope_assurance: "artifact-publication-only",
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
    provider_profile: decision === "pending" ? "unknown" : "thumbs-up-clean",
    provider_input_lineage: "unavailable",
    evidence_basis: decision === "pending"
      ? null
      : {
          kind: "thumbs-up-clean",
          scope_assurance: "whole-pr-contractual",
          artifact_id: "12345",
          summary: "accepted request-bound exact-provider +1",
          authority_receipt: authorityReceipt({ selectedArtifact: null }),
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

function makeCurrentArtifactReport(kind, decision) {
  const report = makeReducerReport({ decision });
  report.provider_profile = "terminal-payload";
  report.evidence_basis = {
    kind,
    scope_assurance: "artifact-publication-only",
    artifact_id: "12345",
    summary: `accepted current ${kind} artifact publication`,
    authority_receipt: authorityReceipt(),
  };
  return report;
}

function makeLegacyV1ArtifactProjection({
  kind = "terminal-clean",
  decision = "clean",
} = {}) {
  const legacyReport = makeReducerReport();
  legacyReport.decision = decision;
  legacyReport.provider_profile = "terminal-payload";
  legacyReport.evidence_basis = {
    kind,
    scope_assurance: "whole-pr-contractual",
    artifact_id: "12345",
    summary: `accepted provider-authored ${kind} publication`,
    authority_receipt: authorityReceipt(),
  };
  const seed = buildStickyAuditProjection({
    reducer_report: makeReducerReport(),
    scope: SCOPE,
    edit: makeEdit(),
  });
  const metadata = structuredClone(seed.metadata);
  const entry = metadata.edit_log[0];
  entry.snapshot.decision = legacyReport.decision;
  entry.snapshot.provider_profile = legacyReport.provider_profile;
  entry.snapshot.evidence_basis_kind = legacyReport.evidence_basis.kind;
  entry.snapshot.evidence_scope_assurance = legacyReport.evidence_basis.scope_assurance;
  entry.snapshot.report_sha256 = hashLengthPrefixed(
    "codex-review-gate-reducer-report-v2",
    [canonicalJson(legacyReport)],
  );
  entry.entry_hash = hashLengthPrefixed(
    "codex-review-gate-sticky-edit-v2",
    [
      SCOPE.repository_node_id,
      SCOPE.pull_request_node_id,
      entry.snapshot.test_merge_sha,
      canonicalJson({
        sequence: entry.sequence,
        edit: entry.edit,
        snapshot: entry.snapshot,
        previous_entry_hash: entry.previous_entry_hash,
      }),
    ],
  );
  const encoded = Buffer.from(canonicalJson(metadata), "utf8").toString("base64");
  const body = seed.body
    .replace(
      "Decision: <code>clean</code>",
      `Decision: <code>${decision}</code>`,
    )
    .replace(
      "Provider profile: <code>thumbs-up-clean</code>",
      "Provider profile: <code>terminal-payload</code>",
    )
    .replace(
      "Evidence basis: <code>thumbs-up-clean</code>",
      `Evidence basis: <code>${kind}</code>`,
    )
    .replace(encodedMetadata(seed.body), encoded);
  return { body, metadata };
}

function stickyBindingArgs(raw_body) {
  return {
    raw_body,
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
    generation_admissions: [],
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

function hashLengthPrefixed(domain, fields) {
  const hash = createHash("sha256");
  const domainBytes = Buffer.from(domain, "utf8");
  hash.update(`${domainBytes.length}:`);
  hash.update(domainBytes);
  hash.update("\0");
  for (const field of fields) {
    const bytes = Buffer.from(String(field), "utf8");
    hash.update(`${bytes.length}:`);
    hash.update(bytes);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}
