---
id: 20260809-codex-review-gate-v1-5-0
title: Codex Review Gate v1.5 rollout
status: completed
created: 2026-08-09
updated: 2026-08-09
branch: codex/activate-v1-reusable
pr:
supersedes: []
superseded_by:
---

# Codex Review Gate v1.5 rollout

## Summary
- Version 1.5.0 packaged a reusable workflow in the canonical action subtree while retaining the existing direct composite Action interface and the complete 1.4 decision semantics. Its immutable release was published, but the live canary proved that its provenance contract incorrectly equated an annotated `@v1` selector's tag-object SHA with the peeled action commit, so consumers must fail closed rather than admit v1.5.0 through an erratum.
- Version 1.5.1 is the compatible repair. Producer protocol major 1, receipt schema v1, and decision policy 1.4 remain unchanged. The canonical source caller and copyable template now call `JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1` after the immutable release and replacement canary completed.
- The floating major selector is the centralized pre-execution trust boundary, while post-run admission resolves the GitHub-selected called-workflow object through the closed tag-object/action-commit candidate set and signed immutable release provenance.
- The source repository remains canonical. The action repository remains a strict `packages/action` subtree release, so compatible future v1.x upgrades require only source and release changes rather than caller or Skill edits.

## Reusable Workflow Authority
- GitHub's server-populated `job.workflow_repository`, `job.workflow_ref`, `job.workflow_sha`, and `job.workflow_file_path` fields identify the resolved called workflow. The v1.5.0 annotated-`@v1` canary observed the selected signed `v1` tag-object OID in `job.workflow_sha`; the frozen contract also admits the exact peeled action commit if GitHub reports that object. The reusable job checks out the exact selected object with a full-SHA-pinned `actions/checkout`, never caller or pull-request code.
- Checkout step `id: checkout` supplies the peeled action commit through the called-workflow-controlled binding `CODEX_REVIEW_GATE_CHECKED_OUT_ACTION_COMMIT_SHA: ${{ steps.checkout.outputs.commit }}`. It is not a `workflow_call` or caller input.
- The reusable workflow has no caller-controlled repository, ref, or runtime path input. It runs the local composite Action from the exact checked-out release tree, and every third-party Action in the packaged workflow is pinned to a full commit SHA.
- The caller owns event selection and grants the exact required permissions. The called workflow cannot elevate them, and its concurrency policy must not duplicate a caller group that could deadlock the caller and called jobs.
- Reusable mode fixes `runs-on: ubuntu-slim`; caller repository variables cannot select a self-hosted runner. The GitHub-hosted runner is a runtime trust root for checkout output, worktree, and receipt production, but receipt v1 remains non-cryptographic evidence. Direct composite runner configuration remains caller-owned.
- The direct composite Action remains available for backwards compatibility. Its immutable form continues to require an exact 40-SHA `uses` reference; the reusable mode derives its producer identity from the resolved called-workflow authority instead of caller-supplied values.
- Native action context retains structural priority: if either native repository/ref field is present, direct identity is recorded and the reusable checkout-commit environment is ignored. Reusable W/C binding applies only when both native fields are absent and the called job tuple is exact canonical.

## Receipt and Provenance Boundaries
- Producer receipt schema v1 remains byte-compatible and closed. In reusable mode, `W == job.workflow_sha == referenced_workflows[].sha == producer.action.ref` must match exactly one provenance candidate: current-live `W == T == tags.v1.tag_object_oid`, or future `W == C == action.commit_oid`. In both branches independently signed `T` must peel directly to `C == tags.v1.peeled_commit_oid == producer.action.commit_sha == provenance.action.commit_oid`; other object types, nested tags, and zero/multiple matches fail closed. Direct composite receipts retain `producer.action.ref == producer.action.commit_sha ==` the exact action commit SHA.
- Release provenance schema v2 machine-declares the producer protocol major, receipt schema identifier/version, decision-table schema and policy major, canonical called-workflow repository/path, and the `v1` caller selector. The reusable workflow is included in both `released_tree` and `critical_files`.
- Dynamic consumer admission matches `W` against exactly one declared `runtime_closure.called_workflow.workflow_sha_resolution.candidates` value, verifies independently signed `T` and its direct peel to checkout-bound `C`, and then verifies the immutable signed v1.x.y tag, action root tree, and matching release provenance. The consumer does not pin a particular v1.x release SHA.
- The receipt and GitHub status/artifact associations are closed consistency evidence, not a signature or OIDC attestation. Causal attribution assumes an independently trusted caller workflow revision and complete job graph plus the fixed GitHub-hosted runner. A same-run malicious sibling can race to create the attempt-named artifact and write a matching status, while `referenced_workflows` remains run-level evidence with no job/callsite/receipt binding. Without a dedicated App, OIDC proof, or job-scoped signed evidence, that caller boundary remains residual producer authority.
- This release does not introduce a retrospective revocation channel. Any later revocation mechanism is outside the v1.5 guarantee and must not be inferred from mutable aliases or release prose.

## Decision Compatibility
- The v1.4 decision semantics remain authoritative and unchanged: only strongly current-head-bound clean evidence can make the required status successful; applicable findings and evidence errors fail closed under their documented precedence.
- Ancestry scoping, exact thread closure, strict threadless supersession, bounded transient retries, acknowledgement/result/overall deadlines, audit-only `+1`, and final stable reread requirements remain unchanged.
- A compatible v1.x packaging or invocation change does not require a Skill update. A producer-receipt protocol major change or a breaking decision-policy change does.

## Validation Contract
- `npm run check` syntax-checks the runtime, release tooling, receipt tests, and the reusable workflow security-contract test; `npm test` executes the complete Node test suite.
- The reusable workflow tests cover direct and reusable identity derivation, tag-object/peeled-commit separation, the checkout-output-only commit binding, canonical repository/path/SHA binding, caller spoof rejection, exact self-checkout, floating-ref drift, rerun attempts, receipt cross-binding, permissions, and concurrency.
- The release-provenance tests cover schema v2 compatibility fields, complete released-tree and critical-file closure, source-subtree/action-root equality, signed tag peels, and manifest and raw-file digest stability.
- The release split gate remains responsible for source checks, the full test suite, action package checks, whitespace validation, and deterministic subtree split generation.

## Release Workflow
- Source repair PR #30 merged as signed source commit `e9a4a79866518ba07e9b0bf9df68dffdb02bfeef`, root tree `a1ad784d0262ba3767151f0ec8f63bbfd6319911`. Sync run `31334245087` published Action split commit `59eeda2af2a7baab3f3f15a59fbbaee015fa6c01`; source `packages/action` and Action root both have tree `8d909dd441b28b6915c46f60e8a144e64fd5268b`.
- The signed annotated immutable `v1.5.1` tag object is `f9201d016b0abd21403550c3bf8030eb0beb76b4`. Signed aliases `v1.5` (`ab610036500f2eacb483abd3a6c272fd86ce5dec`) and `v1` (`9e9f2377342805156afcb0724f501509ef4e444c`) advanced together through one atomic push with independent exact leases; all three directly peel to the Action commit and verify under trusted primary fingerprint `EFBBC913F49A5F6E0AF0D248F70246143DC28F32`.
- The immutable [v1.5.1 release](https://github.com/JoeyTeng/codex-review-gate-action/releases/tag/v1.5.1) contains exactly one provenance-v2 asset. Its SHA-256 is `db00a0b88be3cbff8956e6082544c418d7878f6b2a6405a0773af4eea5004fc8`; the complete 18-entry NUL-delimited release-tree manifest digest is `be4e780d1cf3b6874d246d2c4edd1451f7ca10442781dd99f8d37385d229dd46`.
- Replacement canary run `31335089862` completed successfully. Exact-attempt `referenced_workflows` and receipt both bound `W` to signed `v1` tag object `9e9f2377342805156afcb0724f501509ef4e444c`; checkout output and receipt bound `C` to Action commit `59eeda2af2a7baab3f3f15a59fbbaee015fa6c01`. Receipt artifact `9044075043` and status `51915533651` matched test PR #29 head and attempt URL. The unmerged test PR and both temporary canary branches were removed after evidence capture.
- Rollout remained two-phase: release and live canary completed before this separate source caller/template activation change.

## Completed Outcome
- The Action source/release boundary, reusable runtime, receipt identity, provenance v2 admission, immutable v1.5.1 release, alias transaction, and replacement canary are closed with exact evidence.
- The source self-gate and copyable template use the canonical reusable `@v1` caller without changing the event, permission, or repository-wide concurrency envelope.
- Compatible future v1.x Action-only releases may upgrade centrally under the same producer/receipt/policy majors and trusted-signer admission; breaking protocol or decision-policy changes still require coordinated caller and Skill work.

## Evidence
- Reusable workflow: `packages/action/.github/workflows/codex-review-gate.yml`
- Direct Action and runtime: `packages/action/action.yml`, `packages/action/src/gate.mjs`
- Receipt contract: `packages/action/producer-receipt.schema.json`, `test/producer-receipt.test.mjs`
- Invocation security contract: `test/workflow-security-contract.test.mjs`
- Decision contract: `packages/action/decision-table.json`, `test/core.test.mjs`, `test/gate-runner.test.mjs`
- Provenance tooling: `scripts/generate-action-release-provenance.mjs`, `test/release-provenance.test.mjs`
- Published but non-admissible reusable contract: `https://github.com/JoeyTeng/codex-review-gate-action/releases/tag/v1.5.0`
- First admitted reusable release: `https://github.com/JoeyTeng/codex-review-gate-action/releases/tag/v1.5.1`
- Replacement live canary: `https://github.com/JoeyTeng/codex-review-gate/actions/runs/31335089862`
- Release procedure: `scripts/release-action-subtree.sh`, `.github/workflows/sync-action-subtree.yml`, `docs/RELEASING.md`, `docs/RELEASING.zh-CN.md`

## Generative AI Disclosure

This workstream was implemented with OpenAI Codex assistance.
