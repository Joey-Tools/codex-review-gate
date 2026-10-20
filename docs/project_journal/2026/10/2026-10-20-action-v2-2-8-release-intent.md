---
id: 20261020-action-v228-release-intent
title: Action v2.2.8 Release Intent
status: completed
created: 2026-10-20
updated: 2026-10-20
branch: codex/release-v2-2-8
pr:
supersedes: []
superseded_by:
---

# Action v2.2.8 Release Intent

## Decision And Scope

- Select stable Action version `2.2.8`, following `2.2.7`, to publish the
  guidance-only correction from source PR
  [#133](https://github.com/Joey-Tools/codex-review-gate/pull/133). Its normal
  exact-head squash merge is `61865c336cdf459c6b8c81b1b85f421bfbfe155f`; its
  tree `fc9b3919de25571b1856d43713443d8a2f8947f6` equals the reviewed feature
  head `e6985c0a5748189a458578ebde152f9557418780`, with sole parent
  `42956759b59c0335e3a87bf7b37cca221a1bd069`.
- HDR-streaming #368 recovered on its unchanged head under existing v2.2.7:
  one explicitly authorized fresh eligible review request produced trusted
  unedited exact-head clean, then the installed controller automatically made
  the native gate pass with all six threads resolved. No replacement PR,
  commit, parent rerun/dispatch, bypass or protection change was needed.
- The patch changes recovery advice, not pass/block decisions. Prefer waiting
  for a running review or reconciling existing qualifying clean. A completed
  review with resolved findings may use one fresh eligible request only with
  intact unedited history and no base epoch, followed by trusted unedited
  exact-head clean. Findings and edited/deleted/unclosable history remain
  independently blocking. Preserve the actual replacement flag and all
  evidence, permission, request-authority and thread checks.
- Freeze target `JoeyTeng/codex-review-gate-action` / `refs/heads/master` at
  `0fddbcaeb54dcf4ab1e0aa47b2d1a39d7edcd1b1`, also the peeled immutable
  `v2.2.7` and floating `v2` target, with `previous_version: 2.2.7`.
  Authenticated preparation found no `v2.2.8` tag or competing open release
  intent. The publisher independently validates complete remote state before
  any publication write; the preparation snapshot does not waive that check.
- This intent changes only the Action package version, root release manifest
  and this journal. Preserve schema 4, contract versions, Node 24 entrypoint,
  signer, target repository/ref and all publisher controls.

## Validation Basis

- Source #133 passed 358 v2 tests and the separate 43-test documentation/security
  contract file on Node.js v24.15.0, syntax, journal, whitespace and signed
  complete-range checks. Its trustworthy current-head Codex clean, zero
  unresolved threads and all 21 Node.js 20/24 checks were stable before normal
  merge. No formal local review, parent review-request POST, rerun or dispatch
  was used for that source PR.
- The package inventory is generated from immutable Git blobs, not mutable
  worktree hashes: Action tree `a901e2e2d751b87ba65e8adc727753f13bff8ffa`,
  18 regular files, 965,687 bytes. The package version, v2 runtime recovery text
  and six packaged English/Chinese guides differ from the predecessor.
- The publisher's real manifest reader accepts this exact schema-4 manifest,
  which is byte-identical to the Git-blob-generated inventory. On Node.js
  v24.15.0, all four selected release manifest/tree/parent-peel/schema-v4
  contract tests and all 358 v2 tests pass without failures, cancellations or
  skips. `npm run check`, journal validation and whitespace checks pass.
  These local checks are not production publication or a Node.js 20 test run;
  remote review and CI remain independent gates, with no formal local review.

## Publication Boundary

- This journal records a release intent, not production publication. The
  reviewed manifest's protected-master push is the sole initial publisher
  trigger. Do not dispatch a duplicate initial run or blindly retry an
  ambiguous mutation.
- Use the established staged source publisher and mandatory human
  `marketplace-production` approval. Do not approve on Joey's behalf, change
  publisher controls, or use bypass. Independently verify immutable Release
  assets/provenance/signatures and the signed floating `v2` alias after
  publication. Existing `@v2` consumers obtain the patch on their next run;
  this intent authorizes no mass consumer mutation, rerun or protection change.

## Evidence

- [Recovery trial and source validation](2026-10-20-same-pr-recovery-guidance.md).
- [Current-head source clean](https://github.com/Joey-Tools/codex-review-gate/pull/133#issuecomment-6297767320).
- [Source native gate](https://github.com/Joey-Tools/codex-review-gate/actions/runs/39471572451/job/118798814718).
- [Published predecessor](https://github.com/JoeyTeng/codex-review-gate-action/releases/tag/v2.2.7).
- [Canonical publication contract](../../../RELEASING.md).
