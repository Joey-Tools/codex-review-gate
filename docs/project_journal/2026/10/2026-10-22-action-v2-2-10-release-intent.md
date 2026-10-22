---
id: 20261022-action-v2210-release-intent
title: Action v2.2.10 Explicit-Head Base-Epoch Recovery Release Intent
status: completed
created: 2026-10-22
updated: 2026-10-22
branch: wip/release-v2-2-10-head-clean-recovery
pr:
supersedes: []
superseded_by:
---

# Action v2.2.10 Explicit-Head Base-Epoch Recovery Release Intent

## Decision And Scope

- Publish stable Action `2.2.10` from normally merged source master
  `8aff6ab1f97d2a1b25588c048fc4c6f3f83915be`, including
  [recovery PR #140](https://github.com/Joey-Tools/codex-review-gate/pull/140).
  Its squash tree matches the reviewed feature tree, with the previous master
  as its sole parent. Official current-head clean, all 21 remote checks,
  complete conversations and stable scope passed before normal exact-head
  squash merge. No bypass or formal local review was used.
- Extend the existing explicit-current-head clean recovery to base retarget
  and force-push epochs. The eligible ordinary or token-authored request is
  followed by an official unedited clean whose full or unambiguous short SHA
  resolves uniquely to the current head. Do not require proof of which request
  caused that clean or promote User marker text to workflow authority.
- Preserve strict `T < R < C`, where `T` is the later of the original verifier
  creation and latest base epoch, along with finding, thread-resolution,
  history, pagination, exact-refetch and stable-snapshot guards. Canonical
  Actions and reaction-only scope bindings remain unchanged.
- Freeze target `JoeyTeng/codex-review-gate-action` / `refs/heads/master` at
  `35532b628ec4e308fcca582cea51ee1a766eb283`, the independently verified
  previous `v2.2.9` wrapper, with `previous_version: 2.2.9`. Fresh preparation
  reads found ten `v2.2.*` tags ending at `v2.2.9`, the unchanged signed
  floating `v2` object, no `v2.2.10` tag and no visible `v2.2.10` Release.
  The read-only preparation identity cannot prove absence of an inaccessible
  draft; privileged publisher preflight remains authoritative.
- Only package version, release manifest and this journal change. Preserve
  schema 4, v2.2 contract, Node 24 entrypoint, signer, target ref, publisher
  controls, consumer configuration and mandatory production approval.

## Validation

- The manifest's immutable Git-blob inventory was regenerated from the merged
  fix plus the package-version update: Action tree
  `d4b3b0e1e075966c0c5e6af0b03dc48e0587f856`, 18 regular files and 983,662
  bytes. No previous source tree, payload digest or target-parent value was
  copied forward as an unverified baseline.
- Node.js v24.15.0: all 856 affected core/runtime/workflow/security tests and
  four selected release-pipeline contracts passed, with zero failures,
  cancellations or skips. `npm run check`, journal and whitespace validation
  passed. This does not claim complete local bootstrap/publisher execution.
- Use the release intent's own current-head remote GitHub Codex review and CI;
  no formal local review is required. Local validation and the completed
  source fix do not prove publication or live consumer recovery.

## Publication Boundary

- This release intent is separate from publication. Its normal protected-
  master manifest push is the sole initial publisher trigger. Do not duplicate
  that run with dispatch or retry an ambiguous mutation.
- Keep human `marketplace-production` approval. Independently verify immutable
  Release metadata/assets/provenance/signatures and the signed floating `v2`
  after success, before claiming deployed availability or consumer recovery.
- Do not republish `2.2.9`, alter its immutable tags, change protection or
  mutate BBDown PR #116 as part of preparing this release intent.

## Evidence

- [Recovery decision and regression evidence](2026-10-22-base-epoch-head-clean-recovery.md).
- [Canonical publication contract](../../../RELEASING.md).
