---
id: 20261016-codex-receipt-envelope-v224
title: Codex Receipt Envelope Compatibility and v2.2.4
status: active
created: 2026-10-16
updated: 2026-10-16
branch: wip/codex-receipt-envelope
pr:
supersedes: []
superseded_by:
---

# Codex Receipt Envelope Compatibility and v2.2.4

## Summary

- Restore v2 terminal-comment recognition for the observed official leading
  `<!-- codex-review-receipt:v1 -->` envelope, without weakening the existing
  terminal grammar or treating a PR-level summary as authoritative.
- The source change and v2.2.4 release intent share one focused delivery.
  Production publication remains separately subject to human approval and
  independent verification; source delivery alone is not publication evidence.

## Evidence and Cause

- In [codex-review-workflows #139](https://github.com/Joey-Tools/codex-review-workflows/pull/139),
  the current head was `47a8ed27adf0c56adbf8a7cf787dda4e83555dac`.
  The complete gate snapshot reported zero findings and zero review threads,
  but `recovery_code=wait_provider` with no complete terminal result.
- The official Bot/App [clean comment](https://github.com/Joey-Tools/codex-review-workflows/pull/139#issuecomment-6203961403)
  already existed before the failing job and declared reviewed commit
  `47a8ed27ad`. Its first line was the exact receipt marker, followed by a
  blank line and the existing supported clean body and official disclosure.
  The explicit review request preceded that conclusion.
- The failing [job](https://github.com/Joey-Tools/codex-review-workflows/actions/runs/38819820299/job/116714704144)
  used published v2.2.3 wrapper `cb2ef6b16696bcd35906bc1b2efa24c76a767102`.
  Its first-line terminal detector saw the hidden marker instead of the
  terminal heading. An exact local reproduction returned no artifact for
  the original payload; removing only that leading marker and blank line
  allowed the existing parser to recognize the same inner clean body.
- This is an observed presentation-format compatibility gap, not a new
  provider guarantee, missing review, unresolved finding, or snapshot race.

## Decision and Scope

- Add an explicit opt-in compatibility option to the shared issue-comment
  parser, enabled only at the two v2 runtime call sites. Existing callers
  retain the default behavior.
- After existing line-ending normalization, unwrap exactly one standalone
  leading known receipt marker followed by a blank line. Do not generically
  strip HTML, infer cleanliness from a marker, or broaden the terminal grammar.
  Unknown, malformed, duplicate, misplaced and marker-only envelopes cannot
  supply clean authority.
- Preserve original carrier bodies and server metadata. Existing Bot/App
  provenance, edit checks, commit resolution, review-request ordering,
  complete snapshots, fingerprints and unresolved-finding guards still apply.
  Wrapped findings and recognized service failures retain non-clean semantics.
- The separate official PR-level summary, including its embedded state JSON,
  remains non-authoritative. No new events, permissions, inputs, outputs,
  consumer settings, rulesets or publisher controls are introduced.
- Select patch version `2.2.4`, previous version `2.2.3`, with target baseline
  `JoeyTeng/codex-review-gate-action` / `refs/heads/master` at
  `cb2ef6b16696bcd35906bc1b2efa24c76a767102`. Source preparation baseline is
  `8330b5347eb16a5c23ce26b52bddb43547c4f735`. Schema 4, v2.2 contracts,
  Node 24, publisher identity and release signer remain unchanged.
- Combining runtime changes with release intent is allowed by the existing
  release contract; publisher-control changes are not part of this delivery.
  Preserve the staged publisher, its non-cancelling concurrency, human
  `marketplace-production` approval and independent public verification.
- Stable publication advances signed floating `v2`; installed `@v2`
  consumers need no selector updates, extra Marketplace operation or
  dedicated patch canary. Do not rerun unrelated consumers as part of the fix.
- The previous v2.2.3 completion checkpoint is committed with this delivery;
  it records that existing release and does not request another publication.

## Validation

- Node `v24.15.0`: `npm run check` passed. All 525 affected tests passed with
  `node --test --test-concurrency=1 test/core.test.mjs
  test/v2-gate-runtime.test.mjs test/v2-action.test.mjs
  test/v2-workflow-contract.test.mjs test/workflow-security-contract.test.mjs`.
  The new focused cases first reproduced the defect and then passed.
- Regression coverage checks supported receipt bodies, unchanged legacy
  behavior, invalid envelopes, provenance/edit guards, non-clean outcomes,
  complete two-snapshot clean success and unresolved-thread blocking.
- Independent exact-blob validation matched all 18 regular action files and
  949,002 bytes against staged subtree
  `c88dcbd651a1bd30f92a40c286e0eec0332c646c`; unrelated manifest controls
  match the frozen baseline and only the action package version changed.
  The publisher's `readReleaseManifest` validator accepted the intent.
- All three selected deterministic release-contract tests passed: historical
  schema-v2, schema-v3 Node24/alias, and current schema-v4 optional-token
  coverage (`test/v2-release-pipeline.test.mjs`). Publisher-control files
  were not modified to accommodate this patch.
- Project-journal validation and `git diff --check` passed. Local regression
  checks are not remote-review, merge or production-publication evidence.

## Remaining Publication Boundary

- Use current-head remote Codex review and required CI; no local review is
  added. If the old installed gate cannot recognize its own new-format clean
  comment, stop for explicit human handling rather than changing protection,
  deploying candidate approval logic or fabricating evidence.
- After the protected source merge, use the existing master-push publisher;
  do not issue a duplicate initial dispatch. The privileged stage still needs
  human approval. Verify immutable v2.2.4 assets, provenance, signatures and
  floating `v2` before marking this workstream completed.

## References

- [Paired action design](../../../../packages/action/DESIGN.md).
- [Release contract](../../../RELEASING.md).
- [Completed v2.2.3 baseline](2026-10-14-action-v2-2-3-release-intent.md).
