---
id: 20261124-dependabot-review-support
title: Dependabot Pull Request Review Support
status: completed
created: 2026-11-24
updated: 2026-11-24
branch: wip/dependabot-support
pr: https://github.com/Joey-Tools/codex-review-gate/pull/156
supersedes: []
superseded_by:
---

# Dependabot Pull Request Review Support

## Decisions and Reasons

- Admit PRs authored by the official GitHub Dependabot account when they meet
  the existing same-repository target checks. Use the REST PR author's type,
  login and numeric account ID, not the configurable branch name, event sender,
  commit author or a matching login alone.
- This is not a review bypass. A valid clean result must still cover the
  current head, and findings still block. Keep the exclusions for other bot
  authors, bot-owned head repositories, external fork PRs, drafts, merge queue
  branches and unqualified bases.
- The verifier remains read-only and does not execute PR code. Do not add
  permissions, secrets, event subscriptions or workflow paths. The controller
  still relies on its existing protected verifier-run checks and request opt-in.

## Validation

- On Node.js 24.15.0, syntax checks and all 551 tests in the v2 runtime,
  Action, workflow contract, core and evidence-budget files passed. The
  broader local CI selection exceeded its execution budget and did not
  produce a complete result. Both Node.js 20 and 24 CI matrices passed in
  [implementation PR #156](https://github.com/Joey-Tools/codex-review-gate/pull/156).
  The source squash commit `70b2d9bfaac5111d20ffa34695fb99b543d47c01`
  matches the tree of the exact reviewed head.
- Offline regressions cover a clean current head, stale clean evidence,
  findings, custom branch naming, the automatic request path, and rejection
  of other bot or out-of-scope targets. Mocked API results do not prove live
  review completion or provider entitlement.

## Release Intent

- The stable 2.2.17 intent packages that source, with the verified v2.2.16
  public parent `08bcbf6ec83f49819c8099cbe2704e7e2590a491`. The manifest and
  package version are the only non-journal changes in the intent.
- The default-branch manifest push starts the existing publisher. Human
  `marketplace-production` approval and independent verification of the
  immutable release and signed floating `v2` remain separate from source
  delivery. Existing floating consumers need no workflow edit.

## Evidence

- [BBDown-rust #135](https://github.com/Joey-Project/BBDown-rust/pull/135) was
  created by the official Dependabot account with a same-repository head.
  [Its v2.2.16 verifier](https://github.com/Joey-Project/BBDown-rust/actions/runs/45367481320/job/138352883019)
  rejected the bot author before reading review evidence. The example PR and
  its existing checks were not changed.
