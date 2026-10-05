---
id: 20261005-action-v217-release-intent
title: Action v2.1.7 Release Intent
status: active
created: 2026-10-05
updated: 2026-10-05
branch: codex/release-v2.1.7
pr:
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

## Next steps

- Merge the reviewed release intent. Its `release-manifest.json` change on
  source master automatically starts `sync-action-subtree.yml`.
- Require the credential-free plan, two independent candidates, complete
  source-validation matrix, assembled candidate and publication plan to pass.
- JoeyTeng approves `marketplace-production` only for that admitted frozen
  source. Do not mint credentials or publish from a local operator session.
- Confirm immutable v2.1.7, the stable `v2` alias, signed provenance and public
  readback before reporting publication complete. No consumer installation
  or successful historical-run rerun is implied by release preparation.

## Evidence

- Local validation on Node v24.15.0: `npm run check`, `npm run test:v2`
  (296/296 passing), `git diff --check`, and project-journal validation passed.
  Final committed-head publisher admission and candidate checks are required
  before opening the intent PR; their output belongs to the PR evidence, not
  a claim that production publication has already completed.
- [Previous release](https://github.com/JoeyTeng/codex-review-gate-action/releases/tag/v2.1.6).
- Release intent: `release-manifest.json`.
- Publisher contract: `docs/RELEASING.md`.
