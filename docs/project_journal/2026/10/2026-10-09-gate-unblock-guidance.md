---
id: 20261009-gate-unblock-guidance
title: Gate Unblock Guidance
status: completed
created: 2026-10-09
updated: 2026-10-09
branch: codex/gate-unblock-guidance
pr:
supersedes: []
superseded_by:
---

# Gate Unblock Guidance

## Summary
- The verifier's blocking output ends with actionable `Steps to unblock` guidance, while detailed bounded evidence remains in the summary body and logs.
- Current-head clean recovery accepts only an eligible, exact-scope request followed by an independently trusted clean bound to the current full head; request markers do not grant workflow authority.

## Current State
- The v2.2.0 token-generated request is a user-authored ordinary request under the configured `any` author policy. Its hidden canonical marker may make it a current-head recovery candidate only when `repositoryId`, `prNumber`, `headSha`, `baseSha`, `baseRef`, and `baseRepositoryId` exactly match the selected PR and verifier scope. It remains subject to the existing authorized-User and provider-confirmation checks; it is not workflow provenance or head-bound authority.
- On [codex-personal-sync PR #34](https://github.com/Joey-Tools/codex-personal-sync/pull/34), the original verifier run was created at 15:45:43Z. User request comment `6084271279` followed at 15:46:24Z; trusted clean comment `6084355624` followed at 15:51:34Z with short SHA `2b02532e1d`, which resolves to current full head `2b02532e1d7995ec3cabffa9acdac3fec86ee341`. Attempt 3 still reported `request_clean_generation` and old request IDs `6081765588` / `6081984535`.
- The diagnosed compatibility defect is specific: the collector correctly classified the marker-bearing `User` request as an ordinary request, but the current-head ordinary-witness branch accepted only the bare `@codex review` form. It therefore fell back to the old-lineage recovery error. The scoped fix admits the exact marker as an ordinary witness candidate without treating it as a canonical Actions request; the exact cause is documented, but does not waive unrelated evidence guards.
- The current-head witness does not require older requests to finish or an older official `eyes` reaction to receive its own closing `+1`. Pre-`C` provider activity alone does not prove an older flight must finish first. Historical requests remain in the audit, while findings, provider errors, malformed or edited evidence, scope drift, incomplete pagination/refetches, instability, base epochs, relevant activity at/after `C`, and later request boundaries remain fail-closed.
- PR review-thread counts are independent from non-inline finding counts. A complete nonzero thread inventory blocks success regardless of thread author, head, or outdated status and leads the final unblock steps; incomplete collection is `unknown`, not zero. A later read found all 12 threads resolved, but that does not reconstruct the full inventory at attempt 3; Joey reported comment `4231450567` unresolved then, but the job snapshot did not independently establish that past state.
- The final line is instructional only: it does not change the four-output Action ABI, perform reconciliation, or promise that the next evaluation passes. This source change does not alter the v2.2.0 version, release intent, publication, permissions, events, or polling behavior.

## Next Steps
- Keep any runtime publication in the existing separate, explicitly approved release process; this workstream contains no version or release-intent change.

## Evidence
- [PR #34](https://github.com/Joey-Tools/codex-personal-sync/pull/34), [attempt 3 job 113910440095 in run 37954130655](https://github.com/Joey-Tools/codex-personal-sync/actions/runs/37954130655/job/113910440095).
- [Request comment 6084271279](https://github.com/Joey-Tools/codex-personal-sync/pull/34#issuecomment-6084271279); [current-head clean comment 6084355624](https://github.com/Joey-Tools/codex-personal-sync/pull/34#issuecomment-6084355624).

## Validation
- `git diff --check` and the project-journal validator passed for this source worktree.
- Node `v24.15.0`: `npm run check` passed.
- The complete v2 Action/runtime/workflow-contract and workflow-security suites passed: 375 tests, no failures or skips.
- The PR #34-shaped regression covers the recorded request/clean IDs and timing: unresolved threads block, resolving them allows the eligible current-head clean to pass, mismatched base binding is rejected, and uncertain provider evidence remains fail-closed.
- Output regressions cover separate thread/finding counts, retained independent recovery actions, unknown incomplete counts, the summary's final instruction, and the CLI's context-preserving, redacted plain-text final line.
