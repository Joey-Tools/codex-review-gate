---
id: 20260518-9a806cf-release-automation
title: Action Release Automation
status: active
created: 2026-05-18
updated: 2026-05-18
branch: wip/action-release-automation
pr:
supersedes: []
superseded_by:
---

# Action Release Automation

## Summary
- Marketplace-facing documentation and metadata from the action repository backup branch have been mirrored back into `packages/action`.
- Source repository pushes to `master` can now validate `packages/action` and push the subtree split commit to `JoeyTeng/codex-review-gate-action:master` through GitHub Actions.
- Release tags and GitHub Releases remain deliberate manual or agent-driven steps after the synced action repository commit is validated.

## Current State
- `.github/workflows/sync-action-subtree.yml` runs on `master` pushes that touch the action package, the sync workflow, or the release split script.
- Manual workflow dispatch validates the split by default; setting `push_to_action_repo=true` pushes the split commit.
- The workflow pushes with the action repository deploy key over SSH. It prefers an `ACTION_REPO_DEPLOY_KEY` source-repository secret and also accepts the existing `ACTION_REPO_PUSH_TOKEN` secret name as a compatibility fallback for the private key.
- `scripts/release-action-subtree.sh` remains the local and CI entrypoint for checks, tests, subtree splitting, and publishing. Publishing is normally non-forced; the CI workflow passes `--force-if-equivalent-parent` so it may use `--force-with-lease` only when the remote branch tree exactly matches the computed split commit or its parent tree.

## Next Steps
- After this workflow lands, verify the first `Sync Action Subtree` run updates the action repository `master` to the new split commit.
- For an actual Marketplace release, validate the synced commit before creating or moving action repository release tags.

## Evidence
- Branch: `wip/action-release-automation`
- Workflow: `.github/workflows/sync-action-subtree.yml`
- Release docs: `docs/RELEASING.md`, `docs/RELEASING.zh-CN.md`
- Action package docs: `packages/action/README.md`, `packages/action/README.zh-CN.md`, `packages/action/action.yml`
