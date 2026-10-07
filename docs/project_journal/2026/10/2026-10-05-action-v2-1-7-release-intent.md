---
id: 20261005-action-v217-release-intent
title: Action v2.1.7 Release Intent
status: completed
created: 2026-10-05
updated: 2026-10-07
branch: codex/release-v2.1.7
pr: https://github.com/Joey-Tools/codex-review-gate/pull/104
supersedes: []
superseded_by:
---

# Action v2.1.7 Release Intent

## Decision and rationale

- Joey approved merging the acquisition optimization and starting the next
  stable release. Combine source PRs
  [#101](https://github.com/Joey-Tools/codex-review-gate/pull/101),
  [#102](https://github.com/Joey-Tools/codex-review-gate/pull/102) and
  [#103](https://github.com/Joey-Tools/codex-review-gate/pull/103) in v2.1.7;
  do not publish intermediate releases for these slices.
- This intent changes package version and frozen payload metadata only.
  Publisher workflow/scripts, signing identity, permissions, events, runners,
  and release contracts remain unchanged. Local formal review remains waived
  for this session; current-head GitHub Codex review and required CI still apply.
- Follow the existing reviewed release-intent PR and staged publisher, not a
  direct local push to the publication repository. Only the final privileged
  job receives production credentials after JoeyTeng's Environment approval.

## Frozen baselines and scope

- Source baseline: #103 squash merge
  `473ccd9d5010eed1b2056238dca3d080984114d4`.
- Target repository: `JoeyTeng/codex-review-gate-action`; live target master
  observed as `26569f60ff81aa20ed1316cebb89daf37137ca05`.
- Target predecessor: v2.1.6, published 2026-10-03T14:22:36Z. Do not bless
  later target drift by silently changing this predecessor.
- Runtime payload includes the metadata-only completion-report operation,
  default 100 / expanded 500 pagination budgets with independent resource
  caps, and bounded reaction batching/base-event query consolidation.
  Evidence selection, full pagination, findings blocking and fresh stable
  snapshots remain mandatory.
- Frozen Action subtree: `12ca66f880101208f475f41b3266aad46f249692`;
  complete inventory contains 18 regular files and 866,400 payload bytes.
  The manifest was independently regenerated from staged Git tree/blob
  objects twice; both derivations and the tracked manifest are byte-identical.
- The completion-reporting controller still follows runtime-first deployment.
  Existing floating `@v2` consumers receive runtime changes on fresh runs;
  enabling the new completion observer in already installed repositories
  requires the separately documented controller-template update.

## Publication Outcome

- Source release-intent PR [#104](https://github.com/Joey-Tools/codex-review-gate/pull/104)
  merged as `5e63cd3312d3585a5b14d6fa1a7cc37d5c55a7ca`, subject
  `chore(release): prepare action v2.1.7`. Its merge was verified as an
  ancestor of fetched source master at
  `02bc718cd63724b991255ab5a8b9504aca597556`.
- Stable [v2.1.7](https://github.com/JoeyTeng/codex-review-gate-action/releases/tag/v2.1.7)
  was published at `2026-10-05T13:57:42Z` (release id `403771130`). The
  immutable `v2.1.7` tag peels to
  `9b05689ac64c1ef6847041544dc8aca795304534`.
- This release is the source-manifest predecessor to v2.1.8, observed before
  the floating alias advanced. The full `v2.1.7` tag remains at its immutable
  commit; floating `v2` now follows v2.1.8. See the
  [v2.1.8 release record](2026-10-06-action-v2-1-8-release-intent.md) and the
  [current consumer controller-completion wave](2026-10-07-v2-1-8-consumer-completion-v218.md).

## Evidence

- Local validation on Node v24.15.0: `npm run check`, `npm run test:v2`
  (296/296 passing), `git diff --check`, and project-journal validation passed.
- The release intent is `release-manifest.json` in source PR #104's merged
  commit; the publisher contract is `docs/RELEASING.md`.
- [Published stable release v2.1.7](https://github.com/JoeyTeng/codex-review-gate-action/releases/tag/v2.1.7).
- [Current stable release v2.1.8](https://github.com/JoeyTeng/codex-review-gate-action/releases/tag/v2.1.8).
- [Previous release](https://github.com/JoeyTeng/codex-review-gate-action/releases/tag/v2.1.6).
