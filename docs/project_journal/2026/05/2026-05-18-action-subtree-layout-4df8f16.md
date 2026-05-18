---
id: 20260518-4df8f16
title: Action Subtree Layout
status: completed
created: 2026-05-18
updated: 2026-05-18
branch: wip/subtree-action-package
pr:
supersedes: []
superseded_by:
---

# Action Subtree Layout

## Summary
- The action package now lives under `packages/action` so it can be published with `git subtree split --prefix=packages/action`.
- Source-only CI, tests, and self-gating workflows remain at the repository root.

## Current State
- `packages/action` contains the consumer-facing action package, runtime source, documentation, license, and Marketplace metadata.
- Root package scripts run source checks and tests against the relocated action package.
- `scripts/release-action-subtree.sh` validates a clean source commit and computes the split commit for the action repository.

## Next Steps
- Use `npm run release:split` from a clean release commit when preparing the next Marketplace release.
- Push and tag the resulting split commit in `JoeyTeng/codex-review-gate-action` after validating the action repository branch.

## Evidence
- Branch: `wip/subtree-action-package`
- Release docs: `docs/RELEASING.md`
- Release script: `scripts/release-action-subtree.sh`
