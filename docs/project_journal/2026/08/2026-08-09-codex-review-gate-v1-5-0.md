---
id: 20260809-codex-review-gate-v1-5-0
title: Codex Review Gate v1.5.0
status: active
created: 2026-08-09
updated: 2026-08-09
branch: wip/codex-review-gate-1.5.0
pr:
supersedes: []
superseded_by:
---

# Codex Review Gate v1.5.0

## Summary
- Version 1.5.0 packages a reusable workflow in the canonical action subtree while retaining the existing direct composite Action interface and the complete 1.4 decision semantics.
- Consumers will call `JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1`; the floating major selector is the centralized pre-execution trust boundary, while post-run admission relies on the GitHub-resolved called-workflow commit and the signed immutable release provenance.
- The source repository remains canonical. The action repository remains a strict `packages/action` subtree release, so compatible future v1.x upgrades require only source and release changes rather than caller or Skill edits.

## Reusable Workflow Authority
- GitHub's server-populated `job.workflow_repository`, `job.workflow_ref`, `job.workflow_sha`, and `job.workflow_file_path` fields identify the resolved called workflow. The reusable job checks out that exact repository and commit with a full-SHA-pinned `actions/checkout`, never caller or pull-request code.
- The reusable workflow has no caller-controlled repository, ref, or runtime path input. It runs the local composite Action from the exact checked-out release tree, and every third-party Action in the packaged workflow is pinned to a full commit SHA.
- The caller owns event selection and grants the exact required permissions. The called workflow cannot elevate them, and its concurrency policy must not duplicate a caller group that could deadlock the caller and called jobs.
- The direct composite Action remains available for backwards compatibility. Its immutable form continues to require an exact 40-SHA `uses` reference; the reusable mode derives its producer identity from the resolved called-workflow authority instead of caller-supplied values.

## Receipt and Provenance Boundaries
- Producer receipt schema v1 remains byte-compatible and closed. Its existing caller, job-workflow, action, run-attempt, status, and artifact fields are sufficient: the reusable producer repository and commit are derived from the exact server-populated called-workflow tuple, while direct composite receipts retain their existing exact-action-SHA rules.
- Release provenance schema v2 machine-declares the producer protocol major, receipt schema identifier/version, decision-table schema and policy major, canonical called-workflow repository/path, and the `v1` caller selector. The reusable workflow is included in both `released_tree` and `critical_files`.
- Dynamic consumer admission resolves `job.workflow_sha` and the run-attempt API's `referenced_workflows`, then validates that exact commit against a trusted-signer immutable signed v1.x.y tag and matching release provenance. The consumer does not pin a particular v1.x release SHA.
- The receipt and GitHub status/artifact associations are closed consistency evidence, not a signature or OIDC attestation. Without a dedicated App, OIDC proof, or job-scoped signed evidence, a caller workflow with status and artifact write authority remains within the documented residual producer boundary.
- This release does not introduce a retrospective revocation channel. Any later revocation mechanism is outside the v1.5 guarantee and must not be inferred from mutable aliases or release prose.

## Decision Compatibility
- The v1.4 decision table remains authoritative and unchanged: only strongly current-head-bound clean evidence can make the required status successful; applicable findings and evidence errors fail closed under their documented precedence.
- Ancestry scoping, exact thread closure, strict threadless supersession, bounded transient retries, acknowledgement/result/overall deadlines, audit-only `+1`, and final stable reread requirements remain unchanged.
- A compatible v1.x packaging or invocation change does not require a Skill update. A producer-receipt protocol major change or a breaking decision-policy change does.

## Validation Contract
- `npm run check` syntax-checks the runtime, release tooling, receipt tests, and the reusable workflow security-contract test; `npm test` executes the complete Node test suite.
- The reusable workflow tests cover direct and reusable identity derivation, canonical repository/path/SHA binding, caller spoof rejection, exact self-checkout, floating-ref drift, rerun attempts, receipt cross-binding, permissions, and concurrency.
- The release-provenance tests cover schema v2 compatibility fields, complete released-tree and critical-file closure, source-subtree/action-root equality, signed tag peels, and manifest and raw-file digest stability.
- The release split gate remains responsible for source checks, the full test suite, action package checks, whitespace validation, and deterministic subtree split generation.

## Release Workflow
- The intended immutable release is the signed annotated `v1.5.0` tag, with signed `v1.5` and `v1` compatibility aliases updated through the existing release procedure only after the action subtree split is proven equal to the source subtree.
- Rollout is deliberately two-phase. The release PR adds and publishes the reusable workflow without switching the source repository's live caller or the copyable template. Only after the immutable v1.5.0 release, compatibility aliases, and a live `@v1` canary are verified may a separate activation PR change those callers. This prevents a source-merge window in which `v1` still resolves to v1.4 and the requested reusable-workflow path does not exist.
- Release evidence will record source and release commits and trees, the complete path/mode/blob manifest and digest, critical Git blob and raw SHA-256 digests, signed tag objects and peels, and the release provenance asset URL and digest.
- No pull request, merge, tag, alias movement, or GitHub Release is recorded as complete in this active journal entry until that operation has actually succeeded and its evidence has been captured.

## Next Steps
- Implement and test the reusable workflow, producer receipt v1 reusable binding, and release provenance v2 contracts.
- Complete the local delivery gate and fixed-range fresh-context review, then open the source pull request and resolve CI and current-head review findings.
- After source merge, publish the proven action subtree, sign and verify the immutable and compatibility tags, generate and attach provenance, run the documented post-release checks and live canary, and only then open the caller/template activation pull request.

## Evidence
- Reusable workflow: `packages/action/.github/workflows/codex-review-gate.yml`
- Direct Action and runtime: `packages/action/action.yml`, `packages/action/src/gate.mjs`
- Receipt contract: `packages/action/producer-receipt.schema.json`, `test/producer-receipt.test.mjs`
- Invocation security contract: `test/workflow-security-contract.test.mjs`
- Decision contract: `packages/action/decision-table.json`, `test/core.test.mjs`, `test/gate-runner.test.mjs`
- Provenance tooling: `scripts/generate-action-release-provenance.mjs`, `test/release-provenance.test.mjs`
- Release procedure: `scripts/release-action-subtree.sh`, `.github/workflows/sync-action-subtree.yml`, `docs/RELEASING.md`, `docs/RELEASING.zh-CN.md`

## Generative AI Disclosure

This workstream was implemented with OpenAI Codex assistance.
