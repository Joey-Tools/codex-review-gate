---
id: 20261009-gate-unblock-guidance
title: Gate Unblock Guidance
status: completed
created: 2026-10-09
updated: 2026-10-13
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
- The final line is instructional only: it does not change the four-output Action ABI, perform reconciliation, or promise that the next evaluation passes. The original October 9 source change did not alter the v2.2.0 version, release intent, publication, permissions, events, or polling behavior; the October 13 presentation refinement likewise contains no version or release-intent change.
- The October 13 presentation refinement foregrounds known unresolved blockers
  in the authoritative verifier's Summary while retaining the underlying
  technical reason. Summary locations use the already collected review-thread
  path, first-comment URL and outdated marker; no comment body or new GraphQL
  field is requested. The existing five-hint cap remains a display cap, not a
  scan cap, and the Summary explicitly states shown and omitted counts.
- Non-inline finding counts remain distinct from all-author review-thread
  counts. Incomplete or unread inventories remain unknown and do not lend stale
  locations the authority of a current complete scan. A controller's
  diagnostic-only observation remains labelled as a snapshot, not a new gate
  verdict. The reducer, raw report reason, recovery codes, machine outputs,
  fingerprints, snapshot guards, and final unblock instruction are unchanged.
- The motivating verifier for [macos-edr-virtual-display-fixture PR #22](https://github.com/Joey-Project/macos-edr-virtual-display-fixture/pull/22)
  reported healthy execution but pending evidence attribution on v2.2.1,
  alongside a complete 27-thread inventory with 3 unresolved and 24 resolved.
  Its main reason described lineage rather than those visible repair actions.
  These are the historical failed-snapshot counts, not a claim about the
  closed PR's current resolution. Linked replacement PR #24 subsequently
  passed its native gate and merged; the presentation refinement neither
  reopens nor reruns either PR.

## Next Steps
- Keep any runtime publication in the existing separate, explicitly approved release process; this workstream contains no version or release-intent change.

## Evidence
- [PR #34](https://github.com/Joey-Tools/codex-personal-sync/pull/34), [attempt 3 job 113910440095 in run 37954130655](https://github.com/Joey-Tools/codex-personal-sync/actions/runs/37954130655/job/113910440095).
- [Request comment 6084271279](https://github.com/Joey-Tools/codex-personal-sync/pull/34#issuecomment-6084271279); [current-head clean comment 6084355624](https://github.com/Joey-Tools/codex-personal-sync/pull/34#issuecomment-6084355624).
- [PR #22 failed verifier job](https://github.com/Joey-Project/macos-edr-virtual-display-fixture/actions/runs/38414395956/job/115360171376); [replacement PR #24](https://github.com/Joey-Project/macos-edr-virtual-display-fixture/pull/24).

## Validation

### Original October 9 Change

- `git diff --check` and the project-journal validator passed for this source worktree.
- Node `v24.15.0`: `npm run check` passed.
- The complete v2 Action/runtime/workflow-contract and workflow-security suites passed: 375 tests, no failures or skips.
- The PR #34-shaped regression covers the recorded request/clean IDs and timing: unresolved threads block, resolving them allows the eligible current-head clean to pass, mismatched base binding is rejected, and uncertain provider evidence remains fail-closed.
- Output regressions cover separate thread/finding counts, retained independent recovery actions, unknown incomplete counts, the summary's final instruction, and the CLI's context-preserving, redacted plain-text final line.

### October 13 Presentation Refinement

- Node `v24.15.0`: `npm run check` passed.
- The complete v2 Action/runtime/workflow-contract and workflow-security suites passed: 384 tests, no failures or skips.
- Twelve focused presentation and collection tests passed, including the pending-lineage case with unresolved threads, known non-inline findings plus threads, the unchanged unhealthy reason, single-thread wording, explicit hint truncation, Markdown-safe paths, all-resolved and incomplete inventories, and diagnostic-only observations.
- The representative unresolved-thread integration case still performs exactly two existing review-thread GraphQL reads; the query and snapshot acquisition code are unchanged.
- `git diff --check` and the project-journal validator passed. No version, release intent, production deployment, PR rerun, or state transition is part of this presentation-only change.
