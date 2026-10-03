---
id: 20260930-head-clean-review-recovery
title: Current-Head Clean Review Recovery
status: completed
created: 2026-09-30
updated: 2026-10-03
branch:
pr:
supersedes: []
superseded_by:
---

# Current-Head Clean Review Recovery

## Decision

- Define the new current-head clean recovery as a head-attestation witness
  (the clean resolves to the selected current head, without proving which
  request caused it), not request/response causal attribution. It applies only
  without a base epoch. `T` is the GitHub-server `created_at` for the original `pull_request`
  verifier run, fixed across retries of that run ID; it is not the exact
  `synchronize` time. Do not substitute commit dates or unverified event
  timestamps.
- The witness is one eligible request `R`: either an exact, unedited ordinary
  `@codex review` from a `User`, or a verified, unedited canonical Actions
  request whose repository, PR, full head/base tuple, and workflow-run marker
  match the selected PR/verifier scope. It is followed by a trusted, unedited
  top-level issue-comment terminal clean `C` whose resolved full SHA uniquely
  equals the current PR head. Require strict `T < R < C`; `R` must be the
  latest physical request boundary before `C`, and no request boundary may
  follow `C`. The timestamps
  and SHA attest freshness and head scope, not that `R` caused `C` or started
  Codex.
- Keep all pre-`T` ordinary requests in the complete lineage audit, but ignore
  attribution gaps attached only to those historical requests for this
  witness. Do not rewrite those requests as resolved or as proven old-head
  work. An older request's official `eyes` without its own later `+1` remains
  unsettled and blocks under existing liveness rules. Findings, provider
  errors, unknown/edited/deleted/forged boundaries, scope drift, other live
  activity, exact-refetch failures and incomplete inventory remain blocking;
  the recovery does not supersede or clear findings/errors.
- A base epoch remains on its existing path: only an exact-current-tuple
  canonical Actions request with a direct provider `+1` can provide the
  required later authority. A top-level terminal clean does not extend the
  new head-attestation exception past a base epoch.
- Every PR review thread must be resolved in both stable snapshots, regardless
  of author, outdated flag, or reviewed head. The installed ruleset's
  `all conversations resolved` requirement remains an independent server-side
  guard. Thread IDs and `isResolved` enter the snapshot fingerprint; no nested
  thread comments are scanned for findings.
- Thread reads use paginated GraphQL `reviewThreads(first: 100, after: $cursor)`.
  Require complete, non-overlapping pages, consistent `totalCount`, valid
  page/cursor structure, and a unique ID count equal to the reported total.
  Cycles, duplicates, malformed/partial pages, GraphQL errors, caps, or count
  mismatches fail closed. Two stable reads are not an atomic GitHub guarantee;
  count/ID checks and stability reduce, but do not eliminate, cross-page
  visibility races. Report review-thread status (`not_read`, `complete`, or
  `incomplete`) and counts separately from non-inline finding counts; counts
  are numeric only when complete, otherwise `unknown`, not zero. Thread
  diagnostics remain additive and preserve primary finding, authorization,
  budget, replacement-PR, or begin-delivery recovery instructions; only a
  complete read with unresolved threads blocks an otherwise-qualified clean.
  When Codex evidence is not yet qualified, preserve its request/wait/fix
  recovery as primary and add thread resolution plus reconcile as follow-up.
  If stable-snapshot convergence later exhausts, mark the inventory
  incomplete and redact unresolved, resolved, and total counts, including
  counts retained from an earlier complete snapshot. Include at most five
  unresolved paths and first-comment URLs when available.

## Incident Context

- The debug-triage #20 evidence had an older ordinary request and an old-head
  parent review that prevented the duplicate-cohort exception. A later trusted
  current-head clean with zero finding counts still remained `wait_provider`:
  zero findings did not prove request attribution or resolve outstanding
  provider liveness. The prior narrow recovery also required an exact-current-
  head top-level clean before the run cutoff, so that history did not qualify.
- The new exception addresses only that head-attestation gap. It does not make
  the provider result causal, clear findings/errors, forgive unresolved
  threads, or waive existing liveness and full-snapshot checks.

## Rollout Dependency

- The canonical read-only verifier needs `actions: read` to fetch its own
  Actions run `created_at`, including in private repositories. Update all
  installed consumer verifier workflows before publishing a floating `v2`
  runtime that requires this read. An older workflow fails closed.

## Next Steps

- No implementation work remains in this workstream. Consumer updates, package
  version/release changes, and organization rollout or repository-visibility
  expansion are separate work and require separate approval. The change adds no
  permission, workflow event, cron schedule, or GitHub App.

## Evidence

- Original narrow-rule baseline: `08c4448`.
- Head-attestation and complete-thread implementation base:
  `8f19ae307eb461c9bda6a25346746ac4ab518491`.
- Runtime/tests: `packages/action/src/v2/gate-runtime.mjs` and
  `test/v2-gate-runtime.test.mjs`; focused review-thread/recovery tests passed.
- Validation: runtime/test `node --check`, focused tests, documentation
  `git diff --check`, and project-journal validation passed.
