---
id: 20261006-action-v218-release-intent
title: Action v2.1.8 Release Intent
status: completed
created: 2026-10-06
updated: 2026-10-07
branch: codex/release-v2.1.8
pr: https://github.com/Joey-Tools/codex-review-gate/pull/107
supersedes: []
superseded_by:
---

# Action v2.1.8 Release Intent

## Decision and Scope

- Joey approved the next stable release after source
  [PR #106](https://github.com/Joey-Tools/codex-review-gate/pull/106) merged.
  This separate intent changes only the Action package version, frozen
  release manifest, and this journal. Publisher workflows/scripts, production
  permissions, signing identity, Node 24 runtime, and release contracts remain
  unchanged.
- The payload makes official Codex activity summaries diagnostic-only and
  permits a fresh eligible request followed by a trusted unambiguous
  current-head clean to recover old unfinished request lineage. Actual
  findings, all unresolved review threads, base-epoch requirements, provider
  provenance, and complete stable snapshots remain enforced. The detailed
  policy and rationale are in
  [the head-attested recovery journal](2026-10-06-head-attested-clean-recovery.md).
- Use the existing reviewed release-intent PR and staged publisher, never a
  local push to the publication repository. Only the privileged publish stage
  receives production credentials after Environment approval. Local formal
  review is waived for this session; current-head GitHub Codex review and
  source CI remain required. This intent does not reinstate a bypass rule.

## Frozen Baselines

- Source baseline: #106 squash merge
  `2548b76103361611c27034cba4f6eb524aeb4094`.
- Publication repository: `JoeyTeng/codex-review-gate-action`.
  Master, the stable `v2` alias, and immutable `v2.1.7` were observed resolving
  to `9b05689ac64c1ef6847041544dc8aca795304534`.
- Predecessor: stable v2.1.7, published 2026-10-05T13:57:42Z. Unexpected target
  drift must be investigated, not silently blessed by changing the baseline.
- Frozen `packages/action` tree:
  `6ebca340db6301b36dac6643d444d2d0052e5eb4`; complete inventory contains
  18 regular files and 898,196 bytes. Two regenerations from the staged Git
  tree/blob objects produced byte-identical manifests.

## Validation and Publication Gates

- Node v24.15.0: the relevant Action, v2 runtime, canonical workflow-contract,
  and core suites passed 442/442 tests with no skips or cancellations.
  `npm run check` passed. Journal and whitespace checks are performed before
  the signed landing commit.
- Validate the exact committed-head push admission, release plan, and two
  locally materialized candidates before opening the release intent. Local
  candidate checks do not replace the publisher's independent clean runners,
  complete source-validation matrix, or production remote-state checks.
- Source PR #107 merged by squash as
  `02bc718cd63724b991255ab5a8b9504aca597556`.
- Publisher run
  [37525310070](https://github.com/Joey-Tools/codex-review-gate/actions/runs/37525310070),
  attempt 1, completed successfully with all 16 jobs.
- The public immutable release
  [v2.1.8](https://github.com/JoeyTeng/codex-review-gate-action/releases/tag/v2.1.8)
  is published (release id `405151294`, not draft or prerelease) at
  `2026-10-06T21:21:22Z`. Publication `master`, `v2.1.8`, and floating `v2`
  peel to `299c0fde3cdd921e8d756f792edc056afb0f2ec9`. The published payload
  tree is `6ebca340db6301b36dac6643d444d2d0052e5eb4`; its manifest SHA-256 is
  `4fedd9246da2d16a647c0ff84c00edafe2406979363f9d2d4f8bda41a39454ed`.
- Fresh `@v2` runs receive this release; existing check results are not
  automatically refreshed. The separate consumer controller-completion wave
  completed across its 11 existing consumers; its final receipts are in
  [the v2.1.8 consumer journal](2026-10-07-v2-1-8-consumer-completion-v218.md).

## Evidence

- [Published stable release](https://github.com/JoeyTeng/codex-review-gate-action/releases/tag/v2.1.8).
- [Previous stable release](https://github.com/JoeyTeng/codex-review-gate-action/releases/tag/v2.1.7).
- Intent: `release-manifest.json`; publisher contract: `docs/RELEASING.md`.
