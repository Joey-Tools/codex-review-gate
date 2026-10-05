---
id: 20261004-diagnostic-completion-update
title: V2 Diagnostic Completion Updates
status: active
created: 2026-10-04
updated: 2026-10-05
branch: codex/diagnostic-completion-update
pr: https://github.com/Joey-Tools/codex-review-gate/pull/101
supersedes: []
superseded_by:
---

# V2 Diagnostic Completion Updates

## Decision and rationale

- Joey approved replacing the confusing controller `pending` display with an
  explicitly scoped diagnostic snapshot and updating it after verifier
  completion. A request-observation snapshot must not imply a current gate
  outcome. The required verifier check and its summary remain authoritative.
- Reuse the existing `workflow_run: completed` subscription and controller
  permissions. Extend pre-run admission to eligible verifier completions,
  including reruns and completions when automatic requests are disabled.
  Preserve the first-failure opt-in automatic-request behavior separately.
- Keep the existing runner expression unchanged: `ubuntu-slim` by default,
  with the existing organization/repository variable override to
  `ubuntu-latest`. Completion reporting starts a lightweight controller job;
  it introduces no background waiting but is not zero additional minutes.
- A completion-only controller operation observes the exact canonical
  verifier run/attempt/check and current PR head/base/test-merge scope. It
  updates only a diagnostic comment. It must not rerun or dispatch a workflow,
  request a review, rescan provider findings, or write a required check/status.
  Stale or ambiguous completion evidence must not publish a pass display.
- Include visible scope, run/attempt linkage, and completion time. Do not
  present unread counts as findings or infer zero findings from a successful
  check. Pending text clearly identifies an observation, not live status.
- Permit strictly canonical Actions diagnostic comments to be edited without
  interpreting those edits as review requests or provider evidence. Preserve
  the immutability requirements for real workflow-authored review requests and
  fail closed on malformed or spoofed diagnostic markers.
- GitHub returned an empty `pull_requests` association for the real successful
  BBDown rerun. Completion reporting accepts a narrow missing-association
  fallback: derive the PR and test-merge SHA from the anchored existing
  canonical run-name, then independently verify the actual PR, run, attempt,
  check, and current scope. Do not infer a PR from an arbitrary branch or SHA.
  The existing automatic-request path still requires its original association.
- Keep the existing concurrency expression: known-PR events serialize per PR;
  association-empty completion events share the repository-scoped fallback.
  These fallback events do not share the known-PR event group. Immediate
  pre-write revalidation reduces stale-result overwrites but is not an atomic
  lock over PR changes. A comment remains a timestamped head/run-bound
  snapshot, not merge authorization. No resolver job or new run-name format is
  introduced solely for diagnostic serialization.

## Delivery sequence

1. Deliver runtime, canonical controller, bootstrap contracts, tests, and
   user-facing documentation without altering the release manifest.
2. Publish the updated runtime through the established release-intent and
   Environment-approval process before deploying the new controller inputs.
3. Update installed consumers from the canonical template, then confirm one
   completed verifier updates its diagnostic without creating another verifier
   run. Do not silently expand the installed repository cohort.

The source repository's own controller is updated alongside the template. From
source merge until the compatible runtime is published, its completion-only
diagnostic job may fail on the old runtime's unknown operation. This job is not
a required merge check; the read-only verifier and existing manual `reconcile`
and `begin-review` operations remain unchanged. External consumers still follow
the runtime-first deployment order above.

## Evidence

- Source baseline: `fa695f1` (merged source PR #100, v2.1.6 selection).
- [BBDown-rust PR #82 diagnostic](https://github.com/Joey-Project/BBDown-rust/pull/82#issuecomment-5982703805)
  remained pending at 2026-10-04 17:44:19 UTC although verifier run
  `37218963206`, attempt 2, finished successfully at 17:44:40 UTC for head
  `da0b528653055a512dca6b01ebe2fd4fd4778383`.
- The v2.1.6 baseline creates a first diagnostic and never edits it; its
  edited diagnostic markers become invalid request boundaries. The changes
  in this workstream replace both baseline behaviors as described below.
- Local formal review is explicitly disabled for this session by Joey. PR
  review uses exact `@codex review`; delivery validation remains required.

## Implementation and validation

- Added the workflow-run-only `report-completion` operation, canonical
  completion metadata verification, and a best-effort unique-comment update.
  Ordinary controller operations remain create-only. Canonical diagnostic
  timestamp edits do not create review-generation barriers; actual review
  requests retain their existing immutability requirements.
- Initial and completed diagnostic observations visibly include their
  head/run/attempt/time scope and point to PR Checks as the authority. Unread
  finding/thread counts remain typed `unknown` in the hidden payload but are
  omitted from the visible diagnostic, not converted to zero.
- Initial implementation, Node v24.15.0: `npm run check` passed. The frozen runtime/action suite
  passed all 273 tests, with no skipped or failed tests. Workflow/security
  contracts passed (8 and 43 tests); the bootstrap exact-canonical-workflow
  contract passed as a focused test. Source/template verifier and controller
  workflows passed actionlint v1.7.12. `git diff --check` passed.
- A full repository test invocation reached its 600-second deadline and is
  incomplete, not passed. An earlier combined contract invocation also reached
  its 180-second deadline. The initial PR head `0658fb5` subsequently passed
  all 20 CI/state-machine checks; its required Codex gate failed on the P1
  described below. Every new head still requires fresh CI and review evidence.
  The focused local results above do not claim full-suite success.
- Completion reporting uses bounded metadata reads, not provider reconciliation.
  A typical single-page path is estimated at about 17 GET requests and at most
  one comment write; pagination and retries can increase reads. Comment-write
  failures do not change the authoritative required check.
- Runtime publication, external consumer rollout, and a real completion canary
  remain next steps under the delivery sequence above. No release manifest,
  consumer repository, or existing PR comment was changed during implementation.

## PR review correction

- PR #101's P1 identified a pre-run admission mismatch: GitHub workflow-run
  payloads can qualify `path` with `@ref`, while the new controller guard
  accepted only the bare verifier filename. That could skip both completion
  reporting and eligible automatic requests before a runner started.
- Accept the exact canonical path or its canonical `@` prefix, matching the
  existing runtime validator. Synchronize the source workflow, consumer
  template, and current bootstrap contract without changing historical
  handoff constants. Similar filenames, directories, and other workflows
  remain rejected. Runner, events, permissions, and concurrency are unchanged.
- Regression tests cover bare paths, `@master`, and `@refs/pull/17/merge`,
  rejected lookalikes, bootstrap rejection of a widened prefix, and qualified
  paths through both completion reporting and automatic requests.
- Node v24.15.0: syntax checks and all 326 affected runtime/action/workflow/security
  tests passed; the exact canonical bootstrap test passed. The four
  source/template workflows passed actionlint v1.7.12. Full-repository local
  tests were not repeated; the PR CI matrix supplies that broader coverage.
