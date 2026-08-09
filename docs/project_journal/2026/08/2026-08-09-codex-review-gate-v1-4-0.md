---
id: 20260809-codex-review-gate-v1-4-0
title: Codex Review Gate v1.4.0
status: active
created: 2026-08-09
updated: 2026-08-09
branch: wip/codex-review-gate-1.4.0
pr:
supersedes: []
superseded_by:
---

# Codex Review Gate v1.4.0

## Summary
- Version 1.4.0 freezes the required-check decision contract in `packages/action/decision-table.json`; a pass means only that `codex/review-gate` is successful for the exact current commit, not that triple review is complete or the pull request is otherwise merge-ready.
- The publishable action subtree includes a GitHub.com run-attempt producer receipt, an exact-pinned receipt uploader, and the inputs needed to generate a post-split release-provenance manifest.
- The source tree prepares the release contract and workflow. Tags, the canonical action-repository commit pin, provenance assets, and the GitHub Release remain deliberate post-split release operations.

## Frozen Decision Contract
- Clean evidence is eligible for success only with strong current-head commit binding. An issue-comment clean requires exactly one valid reviewed-commit marker that resolves uniquely to the full current head; a pull-request review uses its native full `commit_id`, and every reviewed-commit hash in the body must agree with that value.
- A clean bound to a proven ancestor is stale audit evidence and cannot itself pass the current head. Proven non-ancestor evidence is excluded as audit-only before the remaining evidence is reduced again. Unknown ancestry is retried only within the bounded acquisition budget and becomes `error:ancestry-unverified` when that budget is exhausted.
- Current-head and proven-ancestor findings remain applicable. A joined thread closes only when authoritative resolution for that exact thread has `isResolved === true`; `isOutdated` and later clean artifacts cannot close it. An older same-lineage threadless finding is superseded only by a strictly later, carrier-valid current-head clean artifact. Issue comments use validated `updated_at` revision time, but REST's second-granularity timestamps cannot prove that `created_at == updated_at` excludes a same-second edit. Two issue-comment artifacts in the same revision second are therefore always ambiguous and never use an ID tie-break. Pull-request reviews may use a larger canonical ID only for a same-time tie within the review channel; cross-channel equal-time ordering is an evidence error. Non-ancestor exclusion is scope filtering, not closure.
- Exact provider progress remains `pending`. Deterministically malformed evidence becomes `error`; recoverable acquisition or reconciliation failures remain `pending` only during bounded retries and become `error` after exhaustion. Neither path blindly posts a replacement review request.
- Applicable findings and evidence errors both block. A confirmed applicable finding controls the public `failure` result while the summary also reports any concurrent deterministic or exhausted transient error; without an applicable finding, such an error controls `error`. A clean or compact summary cannot hide a confirmed finding.
- The fixed orchestration windows are 300 seconds for initial acknowledgement, an exponential acknowledgement backoff capped at 1,800 seconds, a 3,600-second result deadline, and a 7,200-second overall maximum wait. `eyes` moves only `waiting_ack` to `waiting_result` and does not reset or extend the result deadline. `+1` is audit-only and cannot pass, acknowledge, reset, or extend anything.
- Before success, the gate re-reads PR lifecycle and the exact head, loads a final fully paginated provider/thread snapshot with bounded orphan reconciliation, and re-reduces provider identity, commit relations, findings, selected clean evidence, and the decision certificate. Any instability refuses success.

## Producer Receipt and Provenance
- `packages/action/producer-receipt.schema.json` defines schema v1 for a GitHub.com-only, per-run-attempt receipt. It binds workflow, job, action, run-attempt, and exact status-POST response identities; an action ref is immutable authority only when the raw ref is an exact lower-case 40-SHA.
- Receipt mode uploads `codex-review-gate-producer-receipt-{run_id}-{run_attempt}` with `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02` (`v4.6.2`), `overwrite: false`, and explicit artifact ID, URL, and digest outputs.
- A validated receipt is run-bound causal producer evidence. It is not a signature, OIDC attestation, cryptographic provenance proof, or content-addressed storage guarantee, and consumers must independently validate artifact/status membership and re-reduce provider evidence.
- The canonical consumer reference is `JoeyTeng/codex-review-gate-action@<exact-action-repository-40-sha>`. Source commits and the floating `v1.4` and `v1` tags are not canonical invocation-provenance pins.
- `scripts/generate-action-release-provenance.mjs` is a post-split generator. It requires exact source and action default-branch tips, equal source-subtree and action-root trees, and signed annotated `v1.4.0`, `v1.4`, and `v1` tags that peel to the action commit. Its manifest binds the complete action tree plus the receipt schema, decision table, status APIs, uploader commit, tag objects, and SHA-256 digests.

## Validation Contract
- `npm run check` covers the action and bootstrap syntax checks plus the state-machine, receipt, and fake-GitHub test sources; `npm test` executes the complete Node test suite.
- `test/core.test.mjs` and `test/gate-runner.test.mjs` cover strong binding, ancestry reduction, exact thread closure, strict threadless supersession, progress, malformed and transient outcomes, fixed deadlines, reaction authority, mixed-result precedence, and final-reread races.
- `test/producer-receipt.test.mjs` covers immutable and floating action refs, GitHub.com availability, status response capture, failed executions, malformed status responses, and mandatory workflow identity.
- `test/release-provenance.test.mjs` freezes the 1.4.0 decision-table boundary and exercises complete manifest generation, byte-change rejection, and source-subtree/action-tree divergence rejection.
- `npm run release:split` requires a clean source tree, runs source checks, tests, the isolated action package check, and commit whitespace validation, then computes the `packages/action` subtree split commit.

## Release Workflow
- `.github/workflows/sync-action-subtree.yml` is limited to validating or publishing the computed subtree split to `JoeyTeng/codex-review-gate-action:master`; it does not create or move tags and does not create a GitHub Release.
- The immutable signed annotated `v1.4.0` tag and signed `v1.4` compatibility tag must peel to the verified action split commit. Moving `v1` requires an exact remote tag-object lease; generic forced tag pushes are outside the release contract.
- Final release notes replace all action-pin placeholders only after the exact action-repository commit exists. The provenance manifest is generated and verified at that same post-split point, then shipped with the release notes from the immutable tag.

## Next Steps
- Complete the local delivery gate and fixed-range review for the 1.4.0 source change.
- Once a final source release commit and matching action subtree split exist, verify the exact action-repository commit and signed tag objects before generating the canonical provenance manifest.
- Publish release notes and the provenance asset only through the deliberate release procedure in `docs/RELEASING.md`.

## Evidence
- Frozen policy: `packages/action/decision-table.json`
- Receipt contract: `packages/action/producer-receipt.schema.json`, `packages/action/action.yml`, `test/producer-receipt.test.mjs`
- Provenance tooling: `scripts/generate-action-release-provenance.mjs`, `test/release-provenance.test.mjs`
- Gate implementation and tests: `packages/action/src/core.mjs`, `packages/action/src/gate.mjs`, `test/core.test.mjs`, `test/gate-runner.test.mjs`
- Release flow: `scripts/release-action-subtree.sh`, `.github/workflows/sync-action-subtree.yml`, `docs/RELEASING.md`, `docs/RELEASING.zh-CN.md`

## Generative AI Disclosure

This workstream was implemented with OpenAI Codex assistance.
