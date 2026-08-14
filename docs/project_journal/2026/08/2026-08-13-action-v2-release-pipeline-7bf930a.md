---
id: 20260813-7bf930a-action-v2-release-pipeline
title: Action v2 Release Pipeline
status: blocked
created: 2026-08-13
updated: 2026-08-14
branch: wip/codex-review-v2
pr:
supersedes: [20260518-9a806cf-release-automation]
superseded_by:
---

# Action v2 Release Pipeline

## Summary
- The source release path is closed to `Joey-Tools/codex-review-gate-action` and the fixed v2.0.0 release only.
- The personal `JoeyTeng/codex-review-gate-action` repository is a read-only frozen v1 archive whose complete recorded ref/object and master-tree baseline must remain unchanged.

## Current State
- Matching `master` pushes validate but never publish. Only a manual `publish_v2=true` dispatch through protected environment `action-v2-release` may write the target.
- A manual `publish_v2=true` request outside exact `Joey-Tools/codex-review-gate@refs/heads/master` runs an unprivileged rejection job and fails the workflow; it cannot finish green with both validation and publication skipped. Validate-only/manual-false requests and the exact-master publication path retain their separate closed conditions.
- Publication uses an HTTPS-only `ACTION_REPO_PUSH_TOKEN_V2` interface, a policy-bound OpenPGP key, and one atomic non-force push of target `master`, `v2.0.0`, `v2.0`, and `v2`.
- Provenance binds exact repositories, complete split and all-head DAGs, all target/frozen refs, all three direct annotated tag objects and one signing identity, the complete released tree, and the v2 public/reusable/controller identities.
- Root and action package metadata are closed to version `2.0.0` and the exact `Joey-Tools/codex-review-gate` / `Joey-Tools/codex-review-gate-action` Git URLs. Provenance binds both package blob identities.
- Root `package.json` is an explicit `master` push trigger for read-only release validation, so a source package-identity change cannot bypass the release contract.
- Runtime provenance dynamically includes every canonical regular non-symlink direct `src/v2/*.mjs` entry in byte order plus the exact evidence-authority policy blob identity and digest. Source-only Required-CI workflows are excluded from the split and runtime identity.
- Focused local fixtures verify initial publication and exact-state idempotent rerun against independent bare target/frozen repositories.
- A 2026-08-13 read-only `git ls-remote --refs` re-read matched both recorded live baselines exactly: the new target still has three heads and zero tags, and all 27 frozen personal refs/OIDs are unchanged.
- Publication and activation are separate fail-closed phases. The source-root caller remains on the frozen personal repository's `@v1` throughout publication; this workstream has not changed that caller, a required context, or any external consumer.
- Activation may consume only the exact lowercase 40-hex action commit admitted from the published v2 provenance after remote commit, tag-object, direct-peel, signature, ref inventory, graph, tree, and artifact verification. Production rejects personal-repository, `@v1`, every `@v2*`, branch, tag, symbolic, short, different-SHA, and other floating selectors.
- The complete activation unit is the four-controller reconciliation graph pinned to one immutable release SHA, with its exact permissions and `joey-default` policy, repository-wide schedule/concurrency, three protected 15-minute wait environments, closed reusable inputs, and `codex/github-review-gate` status context. The schedule leg now durably builds or resumes the candidate inventory, reserves one controller-owned batch before exposing a canonical matrix, serialises raw dispatch bindings through `max-parallel: 1`, acknowledges released candidates exactly once, and recovers incomplete work without caller-selected or repeated dispatch.

## Blockers
- The source repository does not currently expose `ACTION_REPO_PUSH_TOKEN_V2`; the only listed repository secret is the retired `ACTION_REPO_PUSH_TOKEN`. Organization-secret visibility could not be verified because the current identity received HTTP 403.
- `ACTION_RELEASE_SIGNING_PRIVATE_KEY_V2` and `ACTION_RELEASE_SIGNING_FINGERPRINT_V2` are not currently configured or verified.
- The target `master` and `v2*` ruleset/maintenance policy, including the selected token's narrow bypass or maintenance role, remains external configuration that must be proved before publication.
- The source v2 runtime/reusable workflow must complete its own review and full gate before the release workflow is dispatched.
- No v2 target publication, provenance admission, live canary, consumer deployment, environment-rule verification, or required-context switch has been performed by this local work.

## Next Steps
- Configure and independently verify the protected environment, fine-grained PAT or GitHub App credential, OpenPGP signing identity, and target ruleset without weakening tag immutability.
- Complete the integrated v2 runtime and full source test/review gate.
- Re-run read-only `scripts/release-action-subtree.sh --check`, then manually approve exactly one fixed v2.0.0 publication only when every publication blocker is closed. Keep the source-root `@v1` caller and its required context unchanged.
- After publication, independently download and verify the exact provenance and remote v2 commit/tags/signatures before admitting its 40-hex action commit as the sole production selector.
- In a separate reviewed activation, configure and API-verify all three exact 15-minute environment rules, deploy the complete exact-SHA graph to a non-required live canary, and prove the released workflow identity, waits, receipts, and `codex/github-review-gate` status.
- Only after a passing canary, deploy the byte-equivalent production graph, add and prove the v2 required context, then remove the legacy required context and retire the v1 caller after the rollback window. Treat that as one required-context ruleset/branch-protection switch. Roll back in reverse authority order: restore/retain v1, re-prove its required context, remove v2 requiredness, then remove the v2 graph.

## Evidence
- Baseline: `docs/release/action-v2-repository-baselines.json`
- Runbook: `docs/RELEASING.md`, `docs/RELEASING.zh-CN.md`
- Pipeline: `.github/workflows/sync-action-subtree.yml`, `scripts/release-action-subtree.sh`
- Provenance generator: `scripts/generate-action-release-provenance.mjs`
- Tests: `test/release-provenance.test.mjs`, `test/v2-release-pipeline.test.mjs`
