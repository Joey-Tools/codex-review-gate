---
id: 20261124-dependabot-review-support
title: Dependabot Pull Request Review Support
status: active
created: 2026-11-24
updated: 2026-11-24
branch: wip/dependabot-support
pr:
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
  produce a complete result; Node.js 20 CI remains a delivery check.
- Offline regressions cover a clean current head, stale clean evidence,
  findings, custom branch naming, the automatic request path, and rejection
  of other bot or out-of-scope targets. Mocked API results do not prove live
  review completion or provider entitlement.

## Next Steps

- Publish the reviewed runtime through the regular Action patch release.
  Existing canonical consumers of the floating `@v2` need no workflow edit.

## Evidence

- [BBDown-rust #135](https://github.com/Joey-Project/BBDown-rust/pull/135) was
  created by the official Dependabot account with a same-repository head.
  [Its v2.2.16 verifier](https://github.com/Joey-Project/BBDown-rust/actions/runs/45367481320/job/138352883019)
  rejected the bot author before reading review evidence. The example PR and
  its existing checks were not changed.
