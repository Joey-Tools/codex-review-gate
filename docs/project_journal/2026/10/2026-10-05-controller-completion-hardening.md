---
id: 20261005-controller-completion-hardening
title: V2 Controller Completion Hardening
status: completed
created: 2026-10-05
updated: 2026-10-05
branch: codex/completion-controller-hardening
pr:
supersedes: []
superseded_by:
---

# V2 Controller Completion Hardening

## Decision and rationale

- Restrict the pre-runner verifier-completion path to the exact canonical
  workflow path or a qualified `@refs/pull/` path ending in `/merge`. This
  expression does not claim to validate a numeric PR number; runtime binding to
  the fixed canonical workflow ID, path, run, attempt, and PR remains the
  authority. Lookalike suffixes, non-merge pull refs, and backup paths are
  rejected before a runner starts.
- Preserve associated PR, issue, and manual-input concurrency groups. When a
  workflow-run association is empty, fall back to `workflow_run.id`, then
  `github.run_id`. Keep `cancel-in-progress: false`. These events serialize by
  run, not by a PR recovered later by runtime. The runtime's point-in-time
  recheck before the diagnostic metadata write is not an atomic lock, and the
  snapshot is not merge authority.
- Preserve the separate first-failure automatic-request contract. Completion
  reporting remains metadata-only and must not request a review, rerun or
  dispatch the verifier, scan provider evidence, or write required status.
- The [v2.1.7 Action release](https://github.com/JoeyTeng/codex-review-gate-action/releases/tag/v2.1.7)
  predates this controller-template hardening. Bootstrap admits only the exact
  previous canonical controller as installed upgrade input; current source
  validation and installation emit only the updated controller. A widened
  custom guard or concurrency group is not an upgrade alias. The controller
  changes do not alter the Action runtime, published payload, version,
  immutable tags, or release manifest.
- The [diagnostic completion source PR #101](https://github.com/Joey-Tools/codex-review-gate/pull/101)
  records the earlier diagnostic design and `@ref` compatibility correction.
  This entry refines its path admission and empty-association concurrency
  decisions for the current source template.

## Implementation

- Updated the source self-hosting controller and consumer template byte-for-
  byte. Tightened the workflow-run path filter and added run-ID concurrency
  fallbacks without changing events, permissions, runners, action inputs, or
  automatic-request conditions.
- Synchronized the bootstrap canonical validator, exact previous-controller
  upgrade recognition, workflow contracts, bootstrap regressions, and test
  shard registration distribution.
- Updated source and copyable installation guidance to describe PR-scoped
  groups, per-run fallback behavior, the point-in-time metadata recheck, and
  the v2.1.7 upgrade boundary.
- Local formal review is waived for this task. A source PR still requires its
  normal current-head GitHub review and CI before merge.

## Validation

- `node --test` focused v2 workflow and workflow-security contracts passed
  51/51. Focused bootstrap upgrade/inventory and shard-partition regressions
  passed 4/4. Node v24.15.0 syntax checks passed for the modified source and
  contract tests.
- `actionlint` v1.7.12 accepted both controller workflow copies. The source and
  template controllers compare byte-for-byte and both resolve to Git blob
  `c6290c800903303151cbfb34ca706463118b0d09`. `git diff --check` and project-
  journal validation passed.
- One broader combined test invocation reached its 120-second deadline and is
  incomplete, not passed. The bounded runner reported post-TERM process-group
  cleanup as unverified. A later exact-command `pgrep` found no matching Node
  test leader, but does not prove descendant cleanup; no global process scan or
  manual termination was used. The repository CI matrix remains responsible
  for broader coverage.
