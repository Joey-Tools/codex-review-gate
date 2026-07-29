---
id: 20260727-provider-evidence-authority
title: Provider Evidence Authority
status: completed
created: 2026-07-27
updated: 2026-07-27
branch: wip/codex-review-gate-v1.3.5-markerless-clean
pr:
supersedes: []
superseded_by:
---

# Provider Evidence Authority

## Summary
- Release v1.3.5 makes the complete current evidence snapshot the sole source of the gate decision.
- Success requires the latest official, trusted provider artifact to match the closed clean grammar, bind the current PR head, and coexist with no unresolved historical thread-backed Codex finding.
- Sticky state, controlled markers, baselines, deadlines, recovery mode, and status history are limited to request orchestration, retry, liveness, audit, and idempotency.

## Current State
- Both package manifests identify the patch as v1.3.5.
- Marker and recovery lineage no longer authorise or reject provider artifacts.
- Marker deadlines close or retry waits but do not create provider-artifact acceptance windows; a valid current-head clean artifact created after a deadline can pass on a later complete run.
- Deprecated v1 completion-buffer and failed-findings recovery inputs remain available for interface compatibility; accepted values no longer change gate decisions or request orchestration.
- English and Simplified Chinese action metadata, README, design, and cookbook documentation describe the same authority boundary.

## Validation
- `npm run check` passed.
- `npm test -- --test-reporter=dot` passed.
- `git diff --check` passed.
- Project-journal validation passed.
- The regression suite covers markerless and post-deadline clean acceptance while retaining complete-snapshot, provider-identity, current-head binding, unresolved-finding, and final-reload failure modes.

## Evidence
- `packages/action/DESIGN.md`
- `packages/action/DESIGN.zh-CN.md`
- `packages/action/action.yml`
- `packages/action/README.md`
- `packages/action/README.zh-CN.md`
- `packages/action/COOKBOOK.md`
- `packages/action/COOKBOOK.zh-CN.md`

## Generative AI Disclosure

This workstream was implemented with OpenAI Codex assistance.
