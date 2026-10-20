---
id: 20261020-same-pr-recovery-guidance
title: Same-PR Recovery Guidance
status: completed
created: 2026-10-20
updated: 2026-10-20
branch: codex/same-pr-recovery-guidance
pr:
supersedes: []
superseded_by:
---

# Same-PR Recovery Guidance

## Decision And Reason

- A missing current-head terminal clean must not be described as proof that a
  replacement PR is mandatory. Prefer waiting for an active review, or one
  fresh eligible review request after a completed review's findings have been
  resolved when the intact, unedited history qualifies for current-head clean
  recovery. Reconcile only after trusted unedited exact-head clean evidence.
- Keep actual evidence admission, request authority, history validation,
  `requiresReplacementPr`, finding/thread precedence and pass/block decisions
  unchanged. Conditional recovery advice cannot turn pending into success or
  waive edited, deleted, ambiguous or otherwise unclosable history. Genuine
  finding, permission and replacement requirements remain independent.
- This corrects recovery text and its English/Chinese documentation, not the
  provider parser, workflows, events, permissions, runner selection or policy.
  Deliver through a source fix PR followed by a separate reviewed patch release
  intent and the existing human production approval boundary.

## Production Trial

- Joey explicitly requested a same-PR trial before authorizing publication of
  the guidance correction. On HDR-streaming PR #368 the earlier native log was
  `healthy/pending/wait_provider` with no current-head clean and six resolved
  threads, but its final next action categorically required replacement.
- The parent posted exactly one new plain request
  [6296533781](https://github.com/Joey-Project/HDR-streaming/pull/368#issuecomment-6296533781)
  at 2026-10-20T17:04:59Z. Official unedited top-level clean
  [6296601393](https://github.com/Joey-Project/HDR-streaming/pull/368#issuecomment-6296601393)
  followed at 17:08:43Z and named `b88d52e5e0`, uniquely matching unchanged head
  `b88d52e5e09b2abb6592f69302a85a5a3187315a`.
- The installed controller automatically reconciled existing verifier run
  39451196170 attempt 3. Native
  [job 118768776931](https://github.com/Joey-Project/HDR-streaming/actions/runs/39451196170/job/118768776931)
  succeeded on that same head at 17:09:33Z. Its actual Action revision was the
  published v2.2.7 `0fddbcaeb54dcf4ab1e0aa47b2d1a39d7edcd1b1`; the log reported
  healthy/success/none, the new clean as its explicit success basis, and all six
  threads resolved with complete pagination.
- Independent complete observations before and after the successful run agreed
  on the exact head/base, clean and resolved conversations. Base remained
  `aed780ff567ac40e3166c8d0cc4df8ed72218659`. No replacement PR, commit,
  parent-triggered rerun/dispatch, bypass or protection mutation was needed.
  This proves same-PR gate recovery, not whole HDR PR readiness or a merge.

## Delivery Scope

- Runtime recovery text and targeted regressions are the only implementation
  changes. No formal local review is required; the source PR uses remote GitHub
  Codex review. Local tests and the final source validation remain separate.

## Validation

- On Node.js v24.15.0, all 358 Action, v2 runtime and workflow-contract tests
  passed with zero failures, cancellations or skips. The four selected tests
  also passed independently; they are a subset, not four additional unique
  tests. Existing same-PR clean success, ordinary wait, genuine replacement and
  finding/permission routes remain covered.
- The added real runtime fixture remains healthy/pending with exit code 1,
  `requiresReplacementPr=true` and no successful status write while both the
  Actions summary and sticky diagnostic present conditional same-PR recovery.
  The new text does not clear the flag or supply a positive review result.
- The initial full v2 run passed 356 of 358 tests. It exposed an obsolete
  diagnostic-string assertion and new advice exceeding the existing renderer
  ceiling. The text was shortened so its final history caveat remains complete;
  the ceiling and every verdict/flag assertion were preserved. Later targeted
  and final full-suite logs retain the correction evidence; the first targeted
  failure exists only in the tool record, not a separately retained file.
- `npm run check`, project-journal validation and `git diff --check` passed.
  These are scoped local checks, not a whole-repository or Node.js 20 pass.
  Required remote review/CI and the later separate release intent remain
  independent delivery gates, not claims made by this completed source slice.

## Documentation Contract Correction

- The first source checkpoint received a trustworthy current-head clean and a
  successful native review gate. Ordinary Node.js 20 and 24 core CI each failed
  the same documentation contract, which still required the old claim that
  `wait_provider` permits only a pure wait. This was an obsolete copy assertion,
  not an authentication, publisher or provider failure.
- Synchronize the packaged English/Chinese design and cookbook guidance with
  the conditional recovery advice, and replace only that obsolete assertion
  with positive recovery conditions and a guard against the old pure-wait
  wording. Preserve all reaction liveness, head binding, pending fail-closed and
  real replacement assertions. This closes a documentation/test omission
  without changing the recovery verdict, its flags or permission checks.
- The complete 43-test documentation/security contract file passes on Node.js
  v24.15.0. Five initial worker attempts passed 42/43 because new copy assertions
  were too sensitive to Markdown wrapping and mixed-language wording; the sixth
  passed 43/43. The final parent-owned assertions normalize whitespace and
  check independent recovery conditions rather than sentence layouts, and a
  further full 43/43 run passes. All attempt logs are retained. These were test
  matching corrections, not additional runtime defects.
