---
id: 20261014-action-v223-release-intent
title: Action v2.2.3 Release Intent
status: completed
created: 2026-10-14
updated: 2026-10-16
branch: codex/release-v2.2.3
pr: https://github.com/Joey-Tools/codex-review-gate/pull/121
supersedes: []
superseded_by:
---

# Action v2.2.3 Release Intent

## Summary

- Action v2.2.3 is published and independently verified after human approval.
  The reviewed unresolved-finding summary and unblock-navigation changes are
  available through the signed floating `v2` alias.

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
  schema-v4 optional-token coverage).
- Release-intent PR [#121](https://github.com/Joey-Tools/codex-review-gate/pull/121)
  had current-head official clean evidence, zero review/inline/thread findings,
  and all 21 checks successful. Ordinary head-bound squash merge produced
  signed source commit `8330b5347eb16a5c23ce26b52bddb43547c4f735`, with the
  reviewed tree and exact source parent. No bypass or duplicate initial
  dispatch was used.
- Normal master-push publisher run `38542325982`, attempt 1, completed all 16
  jobs successfully. Its 14 nonprivileged stages passed before human
  `marketplace-production` approval. `Publish signed release` and the independent
  `Verify published release` then succeeded; public verification reported
  `recovery_code=none`.
- Target wrapper `cb2ef6b16696bcd35906bc1b2efa24c76a767102` is signed, has the
  exact manifest action tree, and has only the frozen target baseline as parent.
  Signed tag objects `01c7cc6d434a557ef8fc6b6d4e3d019c598e6ac7` (`v2.2.3`)
  and `418ea0b10f0f08349ad5ff7d2b23c447f7e5cee7` (`v2`) both peel to that
  wrapper. Independent authenticated live metadata reads confirmed these
  bindings and valid signatures.
- Release `412718523` is stable, non-draft, immutable, and publisher-authored.
  Its three uploaded assets are the v2.2.3 archive, provenance, and detached
  provenance signature. Archive SHA-256 is
  `71310c31ac79df12acbb4bf7ce7832dd78714931976017fcea3977514f90e26f`.
  The unprivileged verifier checked public refs, assets, provenance, and
  signatures before the independent metadata readback.
- The final local snapshot comparison originally included unrelated embedded
  repository `size` statistics (7662 to 7669). The merge call incorrectly
  proceeded in the same orchestration after that local assertion failed.
  Exact selected scope, provider pages, findings, threads, reactions, and
  successful checks were unchanged. The local validator now compares the
  selected PR scope/lifecycle and retains full raw-file audit digests;
  corrected complete-snapshot and installed-contract validation passed.

## Next Steps

- No further production publication or consumer-selector change is required
  for this patch. Existing `@v2` references select the new signed release.
- The post-publication checkpoint is synchronized with the next focused source
  delivery; it does not create another v2.2.3 release intent, dispatch, or
  consumer workflow rerun.

## Evidence

- [Source PR #120](https://github.com/Joey-Tools/codex-review-gate/pull/120).
- [Release-intent PR #121](https://github.com/Joey-Tools/codex-review-gate/pull/121).
- [Successful publisher and verifier](https://github.com/Joey-Tools/codex-review-gate/actions/runs/38542325982).
- [Published v2.2.3](https://github.com/JoeyTeng/codex-review-gate-action/releases/tag/v2.2.3).
- [Unblock guidance workstream](2026-10-09-gate-unblock-guidance.md).
- [Published v2.2.2 baseline](https://github.com/JoeyTeng/codex-review-gate-action/releases/tag/v2.2.2).
- [Release contract and protected publication flow](../../../RELEASING.md).
