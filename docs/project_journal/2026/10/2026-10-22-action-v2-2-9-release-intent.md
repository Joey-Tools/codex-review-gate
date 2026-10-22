---
id: 20261022-action-v229-release-intent
title: Action v2.2.9 Provider Boundary Comment Release Intent
status: completed
created: 2026-10-22
updated: 2026-10-22
branch: wip/release-v2-2-9-boundary-comments
pr:
supersedes: []
superseded_by:
---

# Action v2.2.9 Provider Boundary Comment Release Intent

## Decision And Scope

- Publish stable Action `2.2.9` from normally merged source master
  `f7cc095f16cdbc15e078ecb008b4517a4b179eba`, including
  [compatibility PR #138](https://github.com/Joey-Tools/codex-review-gate/pull/138).
  Its squash tree equals the reviewed feature tree, with the prior master as
  its sole parent. The exact-head remote clean and all 21 checks passed before
  normal squash merge; no bypass or formal local review was used.
- V2 ignores complete leading/trailing provider HTML comments rather than
  enumerating marker names. Preserve older valid bodies and legacy parser
  defaults, original raw evidence, visible findings, commit/request binding,
  unresolved threads and complete stable snapshots. No Markdown dependency,
  workflow/permission/runner change or broader recovery waiver is introduced.
- Freeze target `JoeyTeng/codex-review-gate-action` / `refs/heads/master` at
  `e258b4a750528a8437393a0e31b208455cec5413`, also the observed peeled signed
  `v2.2.8` and floating `v2` targets, with `previous_version: 2.2.8`.
  The authenticated preparation read found nine complete `v2.2.*` tags ending
  at `v2.2.8`, no `v2.2.9` tag and no visible `v2.2.9` Release. The preparation
  identity has target read access only; it does not prove absence of an
  inaccessible draft. Privileged publisher preflight remains authoritative.
- Only the Action package version, release manifest and this journal change.
  Preserve schema 4, the v2.2 contract, Node 24 entrypoint, signer, target ref,
  publisher controls, approval boundary and consumer configuration. Do not
  republish the already completed `2.2.8` or duplicate its publisher run.

## Validation

- Immutable Git-blob inventory matches the manifest reader: Action tree
  `1b35039db8bed68a331ea9e2c5448feb066ccbab`, 18 regular files and 977,991
  bytes. Inventory was recomputed from the merged fix plus the package-version
  update; old source-tree/digest/target-parent values were not reused.
- Node.js v24.15.0: all 361 selected V2 Action/runtime/workflow tests and four
  selected release-pipeline contracts passed, with zero failures, cancellations
  or skips. `npm run check` and whitespace validation passed. The source fix
  separately passed 855 affected tests; this intent does not claim to rerun
  complete repository discovery or the full local bootstrap/publisher suite.
- Use this intent's own current-head GitHub Codex review and CI, without a
  formal local review. Local validation is not a production publication or
  deployed consumer pass.

## Publication Boundary

- This records a completed release intent, not completed publication. The
  normal protected-master manifest push is the sole initial publisher trigger;
  do not dispatch another initial run or retry an ambiguous mutation.
- Retain mandatory human `marketplace-production` approval. Do not approve on
  Joey's behalf, change controls or use bypass. Independently verify immutable
  Release assets/provenance/signatures and the signed floating `v2` after the
  publisher succeeds, before claiming consumer availability or recovery.

## Evidence

- [Compatibility decisions and regression evidence](2026-10-22-provider-boundary-comments.md).
- [Canonical publication contract](../../../RELEASING.md).
