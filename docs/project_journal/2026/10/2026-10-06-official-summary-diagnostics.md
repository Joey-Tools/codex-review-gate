---
id: 20261006-official-summary-diagnostics
title: Official Codex Summary Is Diagnostic Only
status: completed
created: 2026-10-06
updated: 2026-10-06
branch: codex/official-summary-diagnostics
pr: https://github.com/Joey-Tools/codex-review-gate/pull/106
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
- PR #106's subsequent P1 finding identified that an earlier summary ID could
  keep exempting a present Bot/App comment after its marker was removed.
  Require the marker on the current body, not only a remembered identity.
  Revoke the diagnostic exemption when an observed current carrier removes
  or moves the marker, and restore ordinary provider evidence/history checks.
  This prevents a new finding or opaque activity from inheriting a summary's
  earlier exemption while retaining diagnostic-only treatment for genuine
  marked summaries and independently explained transport omissions.
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
  accepted only when explained by the recognized summary-count delta.
- PR #106's Codex finding identified the initial metadata/opening-inventory
  race: a newly arrived summary could still exhaust stabilization before the
  first complete inventory supplied a trusted summary identity. On an opening
  mismatch with a recognized summary, allow one bounded metadata reread only
  when the core PR scope is unchanged and its raw count exactly matches the
  complete inventory. Bind that metadata as opening count authority; retain
  the ordinary closing count, fingerprint, history and scope checks. This
  avoids rejecting observed diagnostic-only activity without guessing which
  comment caused the initial delta. Every acquired non-summary comment still
  participates in the decision. The normal matching path adds no API request.
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
- On [PR #106's official summary](https://github.com/Joey-Tools/codex-review-gate/pull/106#issuecomment-6016735427),
  the same comment ID was updated across successive heads and manual requests.
  It reported Completed for `c03a2f0` while the corresponding Codex review
  contained [a P1 finding](https://github.com/Joey-Tools/codex-review-gate/pull/106#discussion_r4196023736).
  Completed therefore describes activity completion, not a clean conclusion.
- On 2026-10-06, the [official GitHub review guide](https://learn.chatgpt.com/docs/third-party/github)
  and [changelog](https://learn.chatgpt.com/docs/changelog) did not document a
  machine-readable summary contract, immutable request identity, or a
  Completed-to-clean guarantee. This is a bounded documentation observation,
  not a claim that no other provider contract exists. Keep the summary out of
  gate decisions; optional progress display must not become pass authority.

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
- Initial v2 Action, runtime, workflow-contract, and shared core tests passed
  431/431 using two local test processes. The summary-churn fixture completes
  with four REST inventories, without extra stabilization retries.
- After addressing PR #106's opening-count finding, the same final relevant
  suite passed 434/434 with no skipped or cancelled tests. Four focused
  summary/count regressions passed, and the strengthened scope-drift test
  independently passed. The regressions assert no normal-path extra metadata
  read, a bounded arrival-path reread, real-finding failure after a count retry,
  and rejection of changed head/base scope before accepting the opening count.
- Final `npm run check`, `git diff --check`, and project-journal validation
  passed.
- After addressing the marker-removal P1 finding, the relevant suite passed
  436/436 with no failures, skipped tests, or cancellations. Six focused
  summary/provenance/transport regressions also passed. The new regressions
  cover a remembered summary becoming a finding with the marker no longer
  on its first line, and an unmarked GraphQL history body appearing after a
  marked REST read; neither scenario writes a successful status.
- The final `npm test -- --test-concurrency=2` attempt was intentionally
  interrupted with exit 130 while the unchanged bootstrap/organization
  integration harness was still running. It is incomplete, not a passing
  full-repository result. Full CI validation remains a subsequent PR gate.
  A narrow process check found no remaining matching task/test processes.
- No local formal reviewer, consumer rollout, or publication was performed
  for the initial implementation. PR #106 subsequently entered the ordinary
  remote Codex review and required-CI fix loop.

## Next steps

- Handle PR delivery, full CI validation, and publication separately from
  this completed local implementation. Existing installed consumers do not
  receive this change until publication.
