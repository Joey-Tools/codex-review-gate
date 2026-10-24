---
id: 20261024-stacked-pr-support
title: GitHub Native Stacked PR Support
status: completed
created: 2026-10-24
updated: 2026-10-24
branch: wip/stacked-pr-support
pr:
supersedes: []
superseded_by:
---

# GitHub Native Stacked PR Support

## Decision And Boundary

- Ordinary same-repository PRs still target the current default branch. The
  only non-default direct-base exception is a GitHub-native stack whose
  authenticated metadata binds its trunk to that default branch. Manual
  feature-base chains, forks and stacks with another trunk remain unsupported.
- Bind the PR's direct base ref/SHA separately from stack trunk ref/SHA, and
  revalidate current stack identity/position and trunk without treating a
  size-only increase above this PR as scope drift. Every stack PR retains its
  own gate; no lower-PR review inheritance or automatic stack merge is added.
- Keep controller execution and installed control-plane ownership/ruleset
  protection rooted on the default branch; the read-only verifier still runs
  against the PR test merge. GitHub carries native stack trunk protection to each
  layer. Runtime `@v2` support and immediate join wake-up are separate: the
  latter requires the canonical verifier workflow's native `stacked` action;
  existing four-action workflow copies remain usable until refreshed.
- No consumer rollout is included. Historical installation, canary and
  handoff receipts remain unchanged.

## Validation

- Parent-owned full bootstrap integration shards exited successfully: 43, 43,
  43 and 42 unique callbacks (171 total), with zero failures or cancellations.
  The logs are `.codex-local/stacked-bootstrap-full-1-of-4.log` through
  `stacked-bootstrap-full-4-of-4.log`.
- Node.js 24.15.0 runtime-focused validation passed 16/16 tests. The final
  combined core/v2/receipt/workflow/security/scanner/CI-contract run passed
  967/967 tests, with zero failures, cancellations or skips. Together with the
  bootstrap partitions, 1,138 tests passed. `npm run check`, project-journal
  validation and `git diff --check` also passed.
- The wider run exposed obsolete bootstrap registration/distribution
  assertions after adding the compatibility regression. Both inventory
  assertions now retain exact coverage for 171 callbacks and the partition
  distribution 43/43/43/42; they were not disabled. Earlier failed logs are
  retained alongside the final pass in the task-local evidence directory.
- These are local/fixture-backed checks, not a claim of a live native-stack
  canary or downstream deployment.

## Next Steps

- Source implementation is the completed state represented by this note.
  Action publication is tracked by its separate release intent; this note
  neither claims deployment nor schedules a consumer rollout.
