---
id: 20261012-known-provider-failure-recovery
title: Known Provider Failure Recovery
status: active
created: 2026-10-12
updated: 2026-10-12
branch: codex/provider-failure-recovery
pr:
supersedes: []
superseded_by:
---

# Known Provider Failure Recovery

## Summary
- Recognise the observed official service-failure comment as a distinct non-clean artifact in v2, rather than an unknown malformed terminal.
- Allow only a later qualifying current-head request and clean witness to supersede that known failure. Keep genuine findings, unresolved review threads and unknown malformed evidence fail-closed.

## Evidence And Cause
- [BBDown-rust PR #100](https://github.com/Joey-Project/BBDown-rust/pull/100) has current head `fc6ca6ff34be4bb8e0c19749d2ad33553d20dc8a`, base `master` at `4648427e81cc822a091e7402671f20dec64fcc36`, and test-merge subject `4ea7291499ba03f0b601745c8533b7d2d21267fc`.
- The [v2.2.1 verifier job](https://github.com/Joey-Project/BBDown-rust/actions/runs/38251040407/job/114898264043), run attempt 4, executed healthily but reported `request_clean_generation`, `indeterminate=1`, and `unrecognized Codex terminal issue-comment format`. Both Rust/Windows checks passed and both review threads were resolved.
- The official [service-failure comment `6123667182`](https://github.com/Joey-Project/BBDown-rust/pull/100#issuecomment-6123667182) at `2026-10-12T11:49:22Z` has the exact retry heading, fenced `Unknown error`, and supported official disclosure; it carries no commit hash.
- A pure issue-comment parser replay on Node `v24.15.0`, using the frozen v2.2.1 action tree `f574490db68b7db0af15c64d5b2fbae45fb16b47`, classified only that comment as malformed. The two later [clean](https://github.com/Joey-Project/BBDown-rust/pull/100#issuecomment-6124608925) [comments](https://github.com/Joey-Project/BBDown-rust/pull/100#issuecomment-6124820433) parse correctly and each reports unique current-head short SHA `fc6ca6ff34`. This was not a full PR verifier replay.
- The existing current-head recovery clean cannot supersede general malformed evidence. Treating the old service failure as that general error category therefore leaves the PR blocked despite the later accepted clean.

## Decisions And Reasons
- Use an explicit v2 parser opt-in and a separate `provider-failure` artifact kind. The default/shared v1 parser profile stays unchanged; a failure never becomes positive clean evidence or a finding.
- Accept only the observed closed failure grammar and the existing official disclosure grammar, under exact Bot/App provenance, canonical timestamps, unedited carriers and normal refetch/stability checks. Unknown failure prose or extra content might hide a finding, so it is not ignored or treated as a known service failure.
- Reuse the exact selected current-head recovery witness instead of a broad error-clearing rule. Require `failure < request < clean`, unchanged head/base/test-merge scope, eligible request, exact current-head clean binding, complete inventory and two stable snapshots. A failure at or after the clean, an edited failure or missing witness remains non-passing.
- The narrow exception exists because a provider execution failure is not a substantive finding and should not permanently lock a PR after a later review succeeds. Genuine findings and independent unresolved-thread blocking are unaffected.
- Do not delete old comments, fabricate review completion, add events/permissions/cron, change request identity, or relax unknown malformed evidence. No new mutation or pass authority is inferred from the failure comment.
- Keep the four-output Action ABI and Node 24 runtime unchanged. Publish the runtime patch through a separate signed release intent and the existing human-approved privileged publisher stage.

## Validation
- Node `v24.15.0`: `npm run check` passed.
- The new parser and current-head recovery regressions failed before implementation and passed afterward. An additional focused run passed both updated tests, including missing-disclosure rejection and combined known-failure recovery with an unresolved thread or finding.
- The complete relevant suites passed all 777 tests with `node --test --test-concurrency=6 --test-reporter=spec test/core.test.mjs test/evidence-budget.test.mjs test/gate-runner.test.mjs test/producer-receipt.test.mjs test/v2-action.test.mjs test/v2-gate-runtime.test.mjs test/v2-workflow-contract.test.mjs`.
- `git diff --check` and project-journal validation passed. Neither these local regressions nor the pure-parser diagnosis above constitute a production pass claim.

## Next Steps
- Publish the patch through the existing release workflow, then verify the immutable version/assets and floating v2 alias.
- Reconcile BBDown-rust #100 on its then-current frozen scope and inspect the native verifier/check result, not the controller's diagnostic success.
