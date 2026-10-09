---
id: 20261009-inline-parent-disclosure-compatibility
title: Inline Parent Disclosure Compatibility
status: completed
created: 2026-10-09
updated: 2026-10-09
branch: codex/review-wrapper-compatibility
pr:
supersedes: []
superseded_by:
---

# Inline Parent Disclosure Compatibility

## Decision and Reason

- BBDown-rust PR #87 had a current-head clean comment and 13 resolved review
  threads, but its healthy v2.2.0 verifier reported five indeterminate entries
  with an exact-full-SHA-blob-link parsing error. An observed historical
  `COMMENTED` parent review used the normal suggestions wrapper, an agreeing
  short reviewed hash, and the newer official team-settings disclosure.
- The inline-parent parser accepted only the older exact disclosure text,
  while the clean issue-comment parser already accepted the newer closed
  structural form. That mismatch incorrectly routed informational parent
  wrappers into finding parsing. The separate v2.2.1 User request-marker fix
  does not clear those malformed artifacts.
- Reuse the existing closed structural disclosure grammar for inline-parent
  reviews. Keep the exact provider identity, review state, native full-SHA
  binding, matching reviewed hash, fixed suggestions lead, and rejection of
  extra or unknown content. This is parsing compatibility, not a blanket
  exemption for old or malformed reviews.
- Historical parents do not provide current-head clean authority. All full-PR
  review threads, including old/outdated threads, must still be resolved;
  actual non-inline findings and invalid provenance remain blockers.

## Delivery Boundary

- Implementation and regression coverage belong to a separate source PR.
  No consumer workflow, permissions, events, rulesets, runtime ABI, or version
  contract changes are needed for this compatibility fix.
- The queued v2.2.1 publisher is frozen to source commit
  `56a6769f2e06753920f3f6e72ddd9c42a1d04110`; it cannot include later code.
  Prepare a new frozen release intent after the fix lands to deliver both
  request attribution and disclosure compatibility through `@v2`.
- Local regression fixtures are not a complete offline replay or a production
  rerun of BBDown-rust PR #87. Production recovery must be verified after the
  combined payload is published.

## Validation

- Node v24.15.0 `npm run check` passed. The complete core parser, legacy
  state-machine, v2 runtime, and v2 Action suites ran with four-file concurrency:
  700 tests passed, with no failures, skips, or cancellations.
- The added parser and recovery regressions failed before the fix. Eight
  focused tests passed afterward, including historical wrapper recovery,
  unresolved old-thread blocking, missing-current-clean rejection, unknown
  content/link rejection, native/short commit mismatch, and the existing
  current-head inline-parent receipt behavior.
- The exact downloaded historical review `5473252139` was rejected by the
  frozen pre-fix parser and accepted by the new parser. This validates that
  carrier's grammar only, not the complete production PR gate outcome.
- Project-journal validation and `git diff --check` passed. Implementation
  was delegated to GPT-6 Luna Max; PR review remains remote-only.

## Evidence

- [BBDown-rust PR #87](https://github.com/Joey-Project/BBDown-rust/pull/87).
- [Failing verifier](https://github.com/Joey-Project/BBDown-rust/actions/runs/37979190874/job/113987152389).
- [Observed historical wrapper](https://github.com/Joey-Project/BBDown-rust/pull/87#pullrequestreview-5473252139).
- [Request-attribution fix #113](https://github.com/Joey-Tools/codex-review-gate/pull/113).
- [Frozen release intent #114](https://github.com/Joey-Tools/codex-review-gate/pull/114).
