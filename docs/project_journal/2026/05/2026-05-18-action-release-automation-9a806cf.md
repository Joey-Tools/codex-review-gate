---
id: 20260518-9a806cf-release-automation
title: Action Release Automation
status: superseded
created: 2026-05-18
updated: 2026-08-13
branch: wip/action-release-automation
pr:
supersedes: []
superseded_by: 20260813-7bf930a-action-v2-release-pipeline
---

# Action Release Automation

## Summary
- Marketplace-facing documentation and metadata from the action repository backup branch have been mirrored back into `packages/action`.
- This entry records the retired v1-era source-to-personal-repository automation; it is not an active release path.

## Current State
- This v1 SSH/deploy-key automation is historical and has been superseded by `20260813-7bf930a-action-v2-release-pipeline`.
- The source pipeline no longer has any write path to `JoeyTeng/codex-review-gate-action`.

## Next Steps
- Follow the v2 workstream and `docs/RELEASING.md`; do not reactivate the retired SSH or force-with-lease flow.

## Evidence
- Branch: `wip/action-release-automation`
- Workflow: `.github/workflows/sync-action-subtree.yml`
- Release docs: `docs/RELEASING.md`, `docs/RELEASING.zh-CN.md`
- Action package docs: `packages/action/README.md`, `packages/action/README.zh-CN.md`, `packages/action/action.yml`
