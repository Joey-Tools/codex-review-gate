---
id: 20261024-action-v2212-release-intent
title: Action v2.2.12 Base-Retarget Release Intent
status: completed
created: 2026-10-24
updated: 2026-10-24
branch: wip/release-v2-2-12-base-retarget
pr:
supersedes: []
superseded_by:
---

# Action v2.2.12 Base-Retarget Release Intent

## Decision And Scope

- Prepare stable Action `2.2.12` from normally merged source master
  `3e7ed72b9fb721043e0d563702eb1ebd64b9cdcd`, including
  [base-retarget support PR #144](https://github.com/Joey-Tools/codex-review-gate/pull/144).
  Its squash tree matches the exact reviewed feature head. Trustworthy
  current-head clean, all 21 remote checks, complete conversations and stable
  final rereads passed before normal exact-head merge; no bypass or formal
  local review was used.
- Retain v2.2.11 native-stack support and add the bounded base-retarget review
  epoch and request-deduplication fixes. Existing findings, stable snapshots
  and native-stack admission remain unchanged. Temporal current-head clean
  acceptance does not claim provider causality or attestation of a base SHA.
- Floating `@v2` consumers gain released runtime changes after publication.
  Automatic wake-up on native `stacked` and real base-retarget `edited` events
  requires refreshing the paired canonical verifier and controller workflows.
  Do not merely append `edited` to an old workflow: ignored edits need the
  non-required job name, noncanonical title and isolated concurrency guards.
- Freeze target `JoeyTeng/codex-review-gate-action` / `refs/heads/master` at
  `5cf6ad33bde7d4e9a6187d25049e6f5615533946`, the verified v2.2.11 wrapper,
  with `previous_version: 2.2.11`. Preparation covered 48 visible tags and 42
  Releases, unchanged signed `v2` and no v2.2.12 tag or visible Release. This
  read-only identity cannot prove inaccessible drafts absent; the privileged
  publisher preflight remains authoritative.
- Change only package version, release manifest and this journal. Preserve
  schema 4, the v2.2 contract, Node 24, signing identity, publisher controls,
  protection and mandatory human production approval.

## Validation

- Rebuild the Git-blob inventory from merged source plus only the package
  version change: Action tree `c6df1299ad65af61ac3b1657afc91df19894e71f`,
  18 regular files and 1,005,127 bytes. Independently validate file digests,
  modes, source binding and unchanged release controls.
- Node.js 24.15.0: the complete 15-file CI core set passes 1,308/1,308 with
  four file workers. Five separate historical/current release contracts pass,
  covering frozen Node 20, Node 24 and v2.2 input policy: 1,313 distinct tests,
  zero failures, cancellations or skips. `npm run check` passes. This does not
  claim privileged publisher execution or a complete local bootstrap run.
- Require the release intent's own current-head remote GitHub Codex review,
  complete CI, policy/conversation evidence and final stable reread.

## Publication And Follow-Up Boundary

- The protected-master manifest push is the sole initial publisher trigger;
  do not duplicate it with dispatch or retry an ambiguous mutation.
- Keep human `marketplace-production` approval. Independently verify immutable
  Release metadata, assets, provenance, pinned signatures, signed floating
  `v2` and a byte-identical exact-source archive before reporting available.
- After verified publication, perform a read-only consumer census to separate
  floating-runtime uptake from paired-workflow refresh needs. Consumer PRs,
  enrollment/protection changes and live canaries are not part of this intent.

## Evidence

- [Base-retarget implementation and limits](2026-10-24-base-retarget-review.md).
- [Canonical publication contract](../../../RELEASING.md).
