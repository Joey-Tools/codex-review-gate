---
id: 20260727-legacy-late-marker-deadline-recovery
title: Legacy Late Marker Deadline Recovery
status: completed
created: 2026-07-27
updated: 2026-07-27
branch: wip/codex-review-gate-v1.3.4-legacy-late-marker
pr:
supersedes: []
superseded_by:
---

# Legacy Late Marker Deadline Recovery

## Summary
- Release v1.3.4 recognises one impossible legacy wait-budget shape: a trusted live marker whose persisted deadline predates that marker's own GitHub server creation time.
- That shape receives a new bounded window from the marker creation time plus the current maximum-wait control.
- Normal persisted deadlines, sticky-state drift protection, and legacy configuration-extension protection remain unchanged.

## Current State
- Both package manifests identify the patch as v1.3.4.
- Trusted live marker and sticky-state lineage fields must still match exactly before any provider result can be authorised.
- A matching persisted deadline that is earlier than the trusted marker creation time is ignored because it cannot describe that marker; the replacement deadline is derived only from the trusted marker creation time and the current maximum wait.
- A provider artifact created after the replacement window remains ineligible, so the compatibility path is finite and fail-closed.

## Evidence
- The regression matrix covers issue-comment and pull-request-review clean artifacts inside, exactly at, and outside a ten-minute replacement window.
- Boundary regressions keep a deadline equal to marker creation authoritative and keep a state-only pre-creation deadline as a fail-closed narrowing bound when the trusted live marker has no persisted deadline.
- Existing regressions continue to cover ordinary post-deadline rejection, sticky-state deadline drift, missing-deadline derivation, and resistance to maximum-wait configuration extension.

## Generative AI Disclosure

This workstream was implemented with OpenAI Codex assistance.
