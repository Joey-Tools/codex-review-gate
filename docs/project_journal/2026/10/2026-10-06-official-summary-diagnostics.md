---
id: 20261006-official-summary-diagnostics
title: Official Codex Summary Is Diagnostic Only
status: completed
created: 2026-10-06
updated: 2026-10-06
branch: codex/official-summary-diagnostics
pr:
supersedes: []
superseded_by:
---

# Official Codex Summary Is Diagnostic Only

## Decision and rationale

- Joey approved excluding official Codex activity summaries from every gate
  decision. The summary is not blocking evidence, so edits, missing summaries,
  status transitions, formatting changes, and missing or ambiguous SHA text
  must not create review failures. Do not introduce a closed summary-body
  grammar or require a summary to accompany a genuine clean receipt.
- Recognition requires the exact first-line reserved marker
  `<!-- codex-pull-request-review-summary -->` together with the existing
  exact official Bot/App provenance check. A matching marker alone does not
  grant an unrelated author authority or waive provider-provenance failures.
- Exclude recognized summaries from request-generation attribution, opaque
  provider activity, edit-history decision inputs, stability fingerprints,
  and exact targeted comment rereads. Do not count them as clean, findings,
  liveness, request boundaries, or finding supersession.
- Keep complete raw inventories, pagination and acquisition budgets, real
  terminal/finding edit protections, all review-thread resolution checks,
  merge-commit scope, and two independently acquired stable snapshots.
- An untyped GitHub deletion event contains no deleted comment ID/body/App
  binding. The runtime cannot prove that such an event deleted a summary,
  rather than a finding, and retains the existing fail-closed history guard.
  A summary missing from an otherwise complete inventory is not an error.
  Do not remove generic count-integrity guards to guess what disappeared.
- Bind summary IDs from the complete REST inventory before acquiring GraphQL
  comment history, because GraphQL history alone cannot supply App provenance.
  This changes acquisition order, not the number of requests or the number
  of independent snapshots. Preserve raw duplicate-ID and pagination checks
  while projecting summary bodies out of history comparison.
- Across opening and closing inventories, a PR comment-count delta is
  accepted only when explained by the recognized summary-count delta. The
  initial PR-metadata versus opening-inventory count guard remains intact:
  a change already spanning those reads may have no trustworthy prior
  identity from which to classify the missing comment.
- An admitted provider event for a recognized summary returns healthy and
  not applicable without targeted comment rereading or verifier rerun.

## Evidence

- On [tvOS-net-player #70](https://github.com/Joey-Project/tvOS-net-player/pull/70),
  official summary comment 6013343244 changed from Running to Completed.
  The distinct unedited clean comment 6013393490 bound the current head
  `b761f5c5fbf92ac733f187d8bb5ee4c92bb7a93c`.
- The v2.1.7 collector classified an edited unrecognized official summary as
  malformed provider evidence with unobservable prior body history. An
  unedited unrecognized summary could instead become opaque provider activity
  and veto otherwise valid request recovery. Neither classification is
  appropriate for a diagnostic-only carrier.
- Implementation starts from source master
  `d7e51cabd280187c6948ccb4231270ccf5cee54d`.

## Delivery boundaries

- This change implements runtime logic, regressions, and documentation only.
  It does not change consumer events, runners, permissions, rulesets, or the
  release procedure, and does not publish a new runtime.
- Local formal review remains waived for this session. Future PR delivery
  uses current-head GitHub Codex review and required CI, not a local substitute.
- Floating `@v2` consumers receive this behavior only after a separately
  approved runtime publication and a fresh workflow run.

## Validation

- Node v24.15.0: focused summary/acquisition regressions passed 10/10.
- Final v2 Action, runtime, workflow-contract, and shared core tests passed
  431/431 using two local test processes. The summary-churn fixture completes
  with four REST inventories, without extra stabilization retries.
- Final `npm run check`, `git diff --check`, and project-journal validation
  passed.
- The final `npm test -- --test-concurrency=2` attempt was intentionally
  interrupted with exit 130 while the unchanged bootstrap/organization
  integration harness was still running. It is incomplete, not a passing
  full-repository result. Full CI validation remains a subsequent PR gate.
  A narrow process check found no remaining matching task/test processes.
- No local formal reviewer, GitHub mutation, consumer rollout, or publication
  was performed for this implementation.

## Next steps

- Handle PR delivery, full CI validation, and publication separately from
  this completed local implementation. Existing installed consumers do not
  receive this change until publication.
