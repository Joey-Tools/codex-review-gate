---
id: 20261101-action-v2214-release-intent
title: Action v2.2.14 Fork-Owned Installation Release Intent
status: completed
created: 2026-11-01
updated: 2026-11-01
branch: wip/release-v2-2-14
pr:
supersedes: []
superseded_by:
---

# Action v2.2.14 Fork-Owned Installation Release Intent

## Decision And Scope

- Prepare stable Action `2.2.14` from normally merged source
  `e1a73e54e9513496d62a207472b5f5d3dd9ad6ee`, including
  [fork-owned internal PR support #149](https://github.com/Joey-Tools/codex-review-gate/pull/149).
  The signed squash tree equals the reviewed head's tree. Current-head Codex
  clean, all 22 remote checks, complete conversations and stable final rereads
  passed before normal exact-head merge without bypass.
- Permit an operator-maintained fork to own an installation for PRs whose
  head and base both match that fork's repository ID/full name. Keep boolean
  metadata validation, default/native-stack eligibility, exact head/base/test-
  merge binding and protected-controller boundaries. External fork PRs remain
  unsupported; upstream configuration is not inherited.
- Existing canonical consumers receive this runtime-only feature through
  floating `@v2` after verified publication; no event, permission, trust input,
  secret, App, protection or consumer-workflow change is part of this intent.
- Freeze `JoeyTeng/codex-review-gate-action` / `refs/heads/master` at the
  independently verified v2.2.13 wrapper
  `e965263162351e61ceb8cecc725f6327eab3a8c3`, with `previous_version: 2.2.13`.
  Fresh master/floating/latest-stable reads agree and v2.2.14's tag is absent.
  This does not prove inaccessible drafts absent; the publisher still owns
  complete remote-state reconciliation.
- Change only package version, generated manifest and this journal. Preserve
  schema 4, Node 24/v2.2 ABI, signer, publisher controls and mandatory human
  production approval. Use remote review only, not a formal local review.

## Validation

- Immutable version-only staged payload tree
  `1c6a2b7663399b7a14dceeccd33239caaf2dc13c` contains 18 regular files and
  1,009,810 bytes. Git-blob size/mode/SHA-256 inventory and unchanged release-
  control/package-version-only comparisons pass.
- Node.js 24.15.0: all 382 v2 tests and five historical/current release-contract
  cases pass, with zero failures, cancellations or skips. `npm run check`
  passes. The first contract selection targeted the wrong file and executed
  none of the selected callbacks; it is excluded from these counts, and the
  corrected `v2-release-pipeline` selection ran all five cases.
- The implementation's two complete 1315-test core runs belong to its source
  checkpoints, not an invented full rerun on this release head. No complete new
  local bootstrap or full release-suite run is claimed. This release intent
  still requires current-head remote Codex, complete Node.js 20/24 CI, current
  policy/conversation evidence and a final stable reread.
- Mocked API regressions are not a live fork canary or provider-entitlement
  proof. Operators still configure Actions, Codex and required settings in
  their own fork.

## Publication Boundary

- The protected-master manifest push is the sole initial publisher trigger;
  do not duplicate it with dispatch or retry an ambiguous mutation.
- Keep human `marketplace-production` approval. Independently verify the
  immutable Release, exact-source archive, assets/provenance, pinned signatures
  and signed floating `v2` before declaring the runtime published.
- No privileged publication, consumer installation, protection change or live
  canary is claimed by this release-intent preparation.

## Next Steps

- Normal reviewed merge, the original push-triggered publisher, human approval
  and independent publication verification retain their separate gates.

## Evidence

- [Implementation boundary and regression coverage](2026-11-01-fork-internal-installation.md).
- [Canonical publication contract](../../../RELEASING.md).
