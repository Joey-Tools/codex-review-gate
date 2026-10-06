---
id: 20261006-action-v218-release-intent
title: Action v2.1.8 Release Intent
status: active
created: 2026-10-06
updated: 2026-10-06
branch: codex/release-v2.1.8
pr:
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
- The manifest change on source master automatically starts
  `sync-action-subtree.yml`. Approve `marketplace-production` only for its
  admitted frozen source, then confirm immutable v2.1.8, the stable `v2`
  alias, signed provenance, and public readback before reporting completion.
- Floating `@v2` consumers receive the runtime on fresh runs. Existing check
  results are not automatically refreshed; no new installation PR or consumer
  workflow change is required for this patch.

## Evidence

- [Previous stable release](https://github.com/JoeyTeng/codex-review-gate-action/releases/tag/v2.1.7).
- Intent: `release-manifest.json`; publisher contract: `docs/RELEASING.md`.
- PR-local review, CI, candidate validation, and approval status belong to
  the release PR and publisher run; this journal does not claim publication.
