---
id: 20260928-inline-parent-clean-receipt
title: V2 Inline Parent Clean Receipt Repair
status: completed
created: 2026-09-28
updated: 2026-09-28
branch: wip/resolved-inline-clean
pr: 82
supersedes: []
superseded_by:
---

# V2 Inline Parent Clean Receipt Repair

## Summary

- Joey authorized a lightweight v2 semantic repair after the live organization
  rollout exposed an unreachable closure: a policy-only Codex inline finding
  could be resolved under the installed ruleset, while its exact-head
  `COMMENTED` review parent still could not supply the terminal clean receipt
  needed by the required v2 check.
- The repair admits one deliberately narrow parent-only receipt. It does not
  move inline thread evaluation into the runtime.

## Adopted Boundary

- An official Codex Bot, exact-head, unedited `COMMENTED` inline-parent review
  may be a non-inline terminal-clean receipt only when its fixed closed grammar
  validates: the canonical heading, a `Reviewed commit` reference that matches
  the native `commit_id`, and the canonical official disclosure. The parent
  cannot carry a non-inline finding payload.
- This is available only to the single, exact, unedited default-`any` ordinary
  request in a no-base-epoch, single-flight lineage. A generic PR review clean,
  multiple or ambiguous requests/boundaries, a base epoch, an edited carrier,
  or ambiguous identity, ordering, or head binding remains fail-closed.
- The runtime does not query or interpret inline review threads, their child
  comments, or their resolved status. Those values do not contribute to v2
  finding counts or the decision fingerprint. The accepted review parent is
  ordinary parent-level provider evidence; the installed ruleset remains the
  sole authority for `all conversations resolved`.

## Completed Outcome

- PR #82 merged to `master` as
  `28ca4b54d6d41d86ca8105ab2b26261d2f2fa2fa`; this remains a narrow
  receipt-classification change, not a transfer of inline thread enforcement
  from GitHub rulesets into the Action.
- Review hardening added an end-to-end fail-closed matrix for non-official
  provenance, wrong App, non-`COMMENTED` state, non-later timestamps, old
  native head, mismatched reviewed/native head, and non-closed grammar. It
  also covers the independent later canonical physical-boundary veto and the
  accepted seven-character reviewed-commit prefix bound by the native full
  head. The successful inline-parent path asserts that the runtime makes no
  `reviewThreads` GraphQL query.
- The two package README variants now describe both admitted terminal-clean
  forms, so the generated Action payload documentation cannot imply that only
  a top-level issue comment may complete this narrow path.
- Validation for the amended candidate included `npm run check`, `npm run
  test:v2`, the focused inline-parent runtime tests, `node --test
  test/release-provenance.test.mjs`, and the schema-v3 Node24 release-pipeline
  regression. The release manifest was regenerated from the staged Action
  payload and independently matched its exact tree.
- Frozen source `28ca4b5` was published by completed release run `36410422637`
  as stable `v2.1.1`; immutable `v2.1.1` and floating `v2` both peel to action
  commit `2041f67c287a144c5b30de1f4c702a396535817d`.

## Follow-up Scope

- Consumer rollout and any remaining exact-head reconciles remain tracked by
  the organization handoff workstream; this completed repair does not assert
  their individual outcomes.

## Evidence

- The active v2 rollout encountered policy-only inline findings whose resolved
  conversations could satisfy the ruleset but could not produce a v2 clean
  receipt under the prior parent-review exclusion.
- Related rollout state: `docs/project_journal/2026/09/2026-09-18-organization-v2-handoff.md`.
