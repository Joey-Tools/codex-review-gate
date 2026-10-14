---
id: 20261014-action-v223-release-intent
title: Action v2.2.3 Release Intent
status: active
created: 2026-10-14
updated: 2026-10-14
branch: codex/release-v2.2.3
pr:
supersedes: []
superseded_by:
---

# Action v2.2.3 Release Intent

## Summary

- Select the merged, reviewed unresolved-finding summary and unblock-navigation
  change for action v2.2.3. This is a release-intent change only; production
  publication remains a separate, human-approved gate.

## Decision And Scope

- Source PR [#120](https://github.com/Joey-Tools/codex-review-gate/pull/120)
  landed on protected source `master` as signed commit
  `50a809370f2421c0600714e8e75c20d1d4cfc207`; its tree matches the reviewed
  head `d3e891d9788c6aaad6c33647ccc70476c262d582`. The source head had
  official current-head Codex clean evidence and all 21 checks passed.
- Healthy, fully scanned blocking summaries foreground known unresolved
  findings and include already collected thread hints. The raw evaluator
  reason remains available. Incomplete or diagnostic-only scans do not claim
  complete unresolved findings. Native verifier failures point to the current
  run's Summary and its Steps to Unblock guide, only after the Summary is
  written and after strict metadata validation.
- This is presentation and navigation, not a change to evidence precedence,
  reconciliation, check outcomes, recovery codes, API queries, fingerprints,
  events, permissions, or the four-output Action ABI. Controller comments
  remain non-authoritative. Publisher controls are unchanged.
- Select version `2.2.3`, with `previous_version: 2.2.2` and target baseline
  `JoeyTeng/codex-review-gate-action` / `refs/heads/master` at
  `a9678053b213bd33454c495ee40a9fb801a2d2a4`. Authenticated preparation reads
  confirmed the published stable v2.2.2 Release and its three assets, the target
  baseline, and the absence of a matching v2.2.3 tag. The manifest schema 4,
  v2.2 contract, Node 24 entrypoint, contract versions, and signer remain unchanged.
- The post-bump `packages/action` tree is
  `284a8247a46d47a09bc4fc82f6e8087b6c69cb53`, containing 18 regular files and
  946,440 bytes. The manifest records bytewise-sorted paths, Git modes, blob
  sizes, and SHA-256 digests from exact Git blobs, not a filesystem walk.
- The existing staged publisher and its `marketplace-production` Environment
  remain the publication boundary. Human approval is required only for the
  privileged stage. A successful stable patch advances the signed floating
  `v2` alias; installed `@v2` consumers need no selector updates. No new
  Marketplace registration, consumer rescan, or separate canary is required
  by the agreed patch-release workflow.

## Validation

- The source fix passed Node `v24.15.0` `npm run check` and all 388 affected
  action/runtime/workflow/security tests before source PR #120 merged. Those
  source-change results are not proof of production publication.
- For this release intent, independent verification matched all 18 inventory
  entries and 946,440 bytes against exact staged Git blobs and confirmed
  unrelated manifest/package controls are unchanged. The publisher's
  `readReleaseManifest` validator accepted the version, schema, entrypoint,
  previous version, and target baseline.
- Node `v24.15.0`: `npm run check` and all three deterministic release-contract
  tests passed (historical schema-v2, schema-v3 Node24/alias, and current
  schema-v4 optional-token coverage). Exact committed-head source validation
  and independent candidate construction remain publisher gates.

## Next Steps

- Complete the release-intent PR's current-head Codex review, required CI, and
  ordinary exact-head squash merge. The protected `master` manifest change
  starts the normal publisher; do not issue a duplicate initial dispatch.
- Complete the unprivileged publisher stages and obtain fresh human approval
  of `marketplace-production`. This journal does not assert a published tag,
  Release, assets, or successful production verification.
- Verify the immutable v2.2.3 tag, Release, assets, provenance, and signed
  floating `v2` alias before reporting publication complete. Recovery, if
  needed, must reuse the original intent and admission run under the documented
  exact-input recovery contract, without bypass or target-baseline rewriting.

## Evidence

- [Source PR #120](https://github.com/Joey-Tools/codex-review-gate/pull/120).
- [Unblock guidance workstream](2026-10-09-gate-unblock-guidance.md).
- [Published v2.2.2 baseline](https://github.com/JoeyTeng/codex-review-gate-action/releases/tag/v2.2.2).
- [Release contract and protected publication flow](../../../RELEASING.md).
