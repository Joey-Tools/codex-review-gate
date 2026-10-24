---
id: 20261024-baseretarget
title: Base-Retarget Review Auto Request
status: completed
created: 2026-10-24
updated: 2026-10-24
branch: wip/base-retarget-review
pr:
supersedes: []
superseded_by:
---

# Base-Retarget Review Auto Request

## Summary
- The canonical verifier and protected default-branch controller support a narrowly validated base-ref-retarget request path without changing the required-check or consumer-rollout model.

## Current State
- The verifier admits `pull_request.edited` only when `changes.base.ref.from` proves a real base-ref change; title/body-only edits are filtered before runner allocation. The controller's `issue_comment` wake-up remains `created` only.
- Ignored edits have non-required job names, noncanonical run titles and isolated verifier/controller concurrency groups. The paired templates prevent skipped jobs from publishing a required success or replacing pending eligible work; consumers must refresh both templates rather than only appending `edited` to a historical event list.
- Automatic request reuse or creation remains opt-in through exact `CODEX_REVIEW_GATE_AUTO_REQUEST=true` and the existing request-token configuration. Runtime revalidates current head/base/test-merge scope. Deduplication uses the latest base epoch and exact current head/base tuple; repeated verifier events in one epoch reuse the matching post-epoch request.
- A new request followed by a trusted, unedited top-level current-head clean whose short SHA resolves uniquely to that head and whose timestamp is later than the request can satisfy the narrow temporal acceptance policy when no unresolved finding remains and existing gates pass. This does not prove provider causality or attestation of a particular base SHA.
- Draft-to-ready remains the recovery path when retarget evidence or a matching verifier is unavailable, including for older consumer workflow templates without the filtered `edited` activity.
- A repeated retarget can have the same old/new ref pair while timeline visibility still lags. The frozen edited payload's canonical `pull_request.updated_at` is therefore a conservative lower bound for the observed timeline epoch, not a substitute event timestamp. Missing, older or inconsistent epoch evidence remains pending rather than admitting an earlier cycle's clean result.
- The source-tree work is complete, but consumer availability still requires a future Action release and canonical workflow refresh. No publication, consumer rollout, ruleset/protection, or token-permission change is part of this workstream.

## Next Steps
- None within this completed workstream; consumer rollout remains a separate, explicitly coordinated activity.

## Evidence
- Node.js 24.15.0: the complete 15-file CI core set passed 1308/1308, with zero failures, cancellations or skips (`.codex-local/base-retarget-core-full-02.log`). This includes runtime and focused workflow tests rather than adding to their counts.
- All four bootstrap integration shards passed 43 selected callbacks each: 172 unique callbacks, with the remaining 129 intentionally excluded in each shard (`.codex-local/base-retarget-bootstrap-1-of-4-01.log` through `4-of-4-01.log`). The inventory/distribution assertions were updated from 171 to the actual 172 callbacks, preserving complete partitioning.
- Node.js 24.15.0: the complete runtime and v2 Action test files passed 367/367, with zero failures, cancellations or skips (`.codex-local/base-retarget-runtime-full-01.log`). The focused 25/25 run is a subset, not an additional count.
- Earlier focused runs exposed stale fixture envelopes and metadata-only GraphQL reads hitting old history fault injections. The first complete core run also exposed two old static concurrency assertions. The fixtures/assertions were updated for their intended boundaries without relaxing the original permission, cancellation, frozen-byte or post-POST retry-safety assertions. Earlier failure logs remain in host-local task evidence.
- `npm run check` and whitespace validation passed. This is local/fixture-backed validation, not a live edited-event or native-stack canary, Action publication or consumer deployment.
- Canonical behavior and recovery guidance: `packages/action/README.md`, `packages/action/DESIGN.md`, and the matching human and agent installation guides.
