---
id: 20260813-7bf930a-action-v2-release-pipeline
title: Action v2 Release Pipeline
status: blocked
created: 2026-08-13
updated: 2026-08-16
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
- Candidate discovery re-reads every final shard receipt after the final inventory identity is known and requires the pre-final and final-point lifecycle projections to match semantically. Inventory or lifecycle drift triggers a fresh bounded rescan, while exhaustion remains a typed fail-closed result and never exposes a dispatch plan.
- Required status publication is a closed one-or-two-write semantic transaction that survives a new scheduler observation. Each write is persisted, posted, exactly re-fetched, and bound before the next slot is exposed; a durable intent with an uncertain response is permanently consumed and is never posted again.
- Automatic review recovery is closed to `automatic:1` → `automatic:2` → `automatic:3`: the controller consumes the opaque aggregate-binding candidate before another POST, durably commits stage 6 `artifact-binding` intent, stage 7 `artifact-binding-ready` intent, and stage 8 ready confirmation before one ordered full-batch safe GET, binds the batch in stage 9, fresh-rereads the tip, and then advances through the paired scheduler-state transition. If a fresh exact snapshot extends an already durable candidate prefix, the ledger freezes at most one ordered suffix transaction; a scheduled attempt drains the parent chain at stages 6/7/8/10 and the queued suffix at stages 9/11/12/13 under the unchanged 16-record cap before release and acknowledgement. `latest_append_receipt` always exposes the true reachable tip, every generation transition waits for all durable artifact transactions, stage 6/7/8 crash recovery resumes without a new reservation or public-effect replay, durable artifact responses resume without another point GET, generation 3 never mints generation 4, and every completed branch releases its lease.
- Public raw effect append APIs now validate once, retain one deep-frozen normalized snapshot, and reject every non-null effect identity before any Git write. All trusted effect producers use a closure-private append primitive, so accessor-driven check/use drift cannot replace a validated null-effect record while candidate, lease, status, request, and recovery producers retain their opaque admission bindings.
- The ledger now supports the closed `mature-quiescent-v1` checkpoint profile. It stores a content-addressed compressed raw replay seed, freshly reverifies every historical provenance JWT, separates physical epoch capacity and sequence from semantic replay length, and atomically publishes one checkpoint carrier plus the exact five-record continuation suffix through one protected ref CAS. Response-loss recovery, tamper rejection, current-open/legacy/compact continuation, and the bootstrap-only capacity boundary remain fail closed.
- Current-open v3 binds complete source, identity, lifecycle, selection, command, trigger, and D1/Dk dispatch authority. The command layer enforces canonical timestamps, exact nested schemas, individual 4 KiB bindings, and a canonical 4 KiB transport boundary; the controller enforces C2/C64 restart and acknowledgement ordering, 512/513 capacity boundaries, exact artifact-prefix record/OID stability, and the complete UTF-16LE `GITHUB_OUTPUT` cap before touching output bytes.
- The final local source gate is green: `npm test` passed 1,385/1,385 tests with zero failures in 2,028.468 seconds; `npm run check`, `git diff --check`, runtime/test-list closure checks, and debug/`.only`/`.skip` scans also passed. The dedicated Waited Required-CI module and discovery suites independently passed 322 and 383 tests, respectively, with final compile, Ruff, diff, and bytecode-clean checks green.

## Blockers
- The source repository does not currently expose `ACTION_REPO_PUSH_TOKEN_V2`; the only listed repository secret is the retired `ACTION_REPO_PUSH_TOKEN`. Organization-secret visibility could not be verified because the current identity received HTTP 403.
- `ACTION_RELEASE_SIGNING_PRIVATE_KEY_V2` and `ACTION_RELEASE_SIGNING_FINGERPRINT_V2` are not currently configured or verified.
- The target `master` and `v2*` ruleset/maintenance policy, including the selected token's narrow bypass or maintenance role, remains external configuration that must be proved before publication.
- The integrated v2 runtime and Waited Required-CI implementation have completed their local full gates, but signed commits, fresh formal review, PR review, and CI completion remain pending before any release workflow may be dispatched.
- No v2 target publication, provenance admission, live canary, consumer deployment, environment-rule verification, or required-context switch has been performed by this local work.

## Next Steps
- Configure and independently verify the protected environment, fine-grained PAT or GitHub App credential, OpenPGP signing identity, and target ruleset without weakening tag immutability.
- Create and verify the signed source and Waited Required-CI commits, complete fresh formal review over frozen committed ranges, and close the authorized PR/CI loops without touching unrelated PRs.
- Re-run read-only `scripts/release-action-subtree.sh --check`, then manually approve exactly one fixed v2.0.0 publication only when every publication blocker is closed. Keep the source-root `@v1` caller and its required context unchanged.
- After publication, independently download and verify the exact provenance and remote v2 commit/tags/signatures before admitting its 40-hex action commit as the sole production selector.
- In a separate reviewed activation, configure and API-verify all three exact 15-minute environment rules, deploy the complete exact-SHA graph to a non-required live canary, and prove the released workflow identity, waits, receipts, and `codex/github-review-gate` status.
- Only after a passing canary, deploy the byte-equivalent production graph, add and prove the v2 required context, then remove the legacy required context and retire the v1 caller after the rollback window. Treat that as one required-context ruleset/branch-protection switch. Roll back in reverse authority order: restore/retain v1, re-prove its required context, remove v2 requiredness, then remove the v2 graph.

## Evidence
- Baseline: `docs/release/action-v2-repository-baselines.json`
- Runbook: `docs/RELEASING.md`, `docs/RELEASING.zh-CN.md`
- Pipeline: `.github/workflows/sync-action-subtree.yml`, `scripts/release-action-subtree.sh`
- Provenance generator: `scripts/generate-action-release-provenance.mjs`
- Tests: `test/release-provenance.test.mjs`, `test/v2-release-pipeline.test.mjs`, `test/v2-persistent-frontier.test.mjs`, `test/v2-git-ledger.test.mjs`, `test/v2-workflow-command.test.mjs`, `test/v2-workflow-controller.test.mjs`
