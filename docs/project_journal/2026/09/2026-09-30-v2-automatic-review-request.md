---
id: 20260930-v2-automatic-review-request
title: V2 Opt-In Automatic Review Requests
status: active
created: 2026-09-30
updated: 2026-09-30
branch:
pr:
supersedes: []
superseded_by:
---

# V2 Opt-In Automatic Review Requests

## Decision and rationale

- Joey approved the opt-in `CODEX_REVIEW_GATE_AUTO_REQUEST` organization or
  repository variable for automatically
  requesting Codex review after a new eligible PR head reaches the v2 verifier,
  with the variable disabled by default. Repository variables may override the
  organization value. The rollout order is Action release, canonical workflow
  updates in previously installed Joey-Tools repositories, then organization
  variable enablement for `codex-private-workflows` first and later expansion.
- The existing `pull_request` verifier remains read-only and owns the required
  check. A protected `workflow_run: completed` controller receives its completed
  run, revalidates the canonical run and current PR/head/base, and requests a
  review only when the current scope has no matching canonical request. It does
  not immediately rerun the verifier: the completed-run event avoids the
  verifier/controller startup race, and the existing provider-comment or manual
  controller path performs later reconciliation.
- The automatic path covers an eligible current head after verifier runs for
  `opened`, `reopened`, `synchronize`, or `ready_for_review`; it is not a strict
  synchronize-only trigger. A conflicting PR for which GitHub cannot run the
  `pull_request` verifier has no automatic request and retains manual recovery.
- The `pull_request_target` alternative would directly observe synchronize,
  but GitHub's documented public-repository default event policy is scheduled
  to enforce restrictions on 2026-11-02 unless an applicable policy permits it.
  Fourteen of the fifteen currently installed, non-archived Joey-Tools v2
  controller repositories are public. The completed-verifier event avoids an
  additional organization event-policy dependency and never executes PR code.
- Automatic adoption of an existing request uses the exact repository, PR,
  head, base, and canonical hidden marker across controller runs. The manual
  begin-review path retains its original same-run semantics. An uncertain POST
  remains fail-closed; small duplicate requests are acceptable, but a finding
  must never be converted into a pass.
- GitHub Actions expression string comparisons are case-insensitive, so the
  job-level `vars.CODEX_REVIEW_GATE_AUTO_REQUEST == 'true'` condition alone
  also admits case variants such as `TRUE`. The controller passes the raw
  variable to the Action, whose runtime requires the exact lowercase string
  `true` before any GitHub API call. An incorrectly cased value can consume a
  runner start but cannot authorize a review request; tests cover both sides
  of this boundary.
- The verifier has a static workflow name but a dynamic `run-name`. Comparing
  `workflow_run.name` with the static name in the controller job condition
  suppressed eligible completions before a runner could start. Keep the static
  `on.workflow_run.workflows` subscription, remove that redundant comparison,
  and retain runtime canonical workflow ID/path/run and PR-scope verification.

## Delivery sequence

1. Implement, validate, review, and merge the Action runtime, canonical
   controller template, installer contract, tests, and documentation without
   changing the release manifest.
2. The separate release intent selects Action `v2.1.4` after the dynamic
   verifier run-name fix (#93), advancing the manifest from `v2.1.3` without
   changing publisher controls. Publish through the existing Environment
   approval boundary, then verify the floating `v2` alias points to the
   released runtime.
3. Update the canonical controller workflow in all fifteen previously
   installed, non-archived Joey-Tools repositories. Keep the variable unset,
   so the new job has no runner or write effect during installation.
4. Make the organization variable visible only to
   `Joey-Tools/codex-private-workflows` and set it to `true`. Validate one
   current-head PR without merging a test PR merely for the canary. Expand the
   selected-repository visibility only after the canary demonstrates the
   request and subsequent verifier reconciliation.

## Scope and recovery

- Installed controller cohort: `codex-apple-notes-toolkit`,
  `codex-debug-triage`, `codex-gated-repo-template`, `codex-host-workflows`,
  `codex-personal-sync`, `codex-private-workflows`,
  `codex-project-journal`, `codex-review-gate`,
  `codex-review-workflows`, `codex-rollout-backup`,
  `codex-session-retrospective`, `codex-session-retrospective-history`,
  `codex-toolbox`, `codex-workflow-hygiene`, and `codex-workspace`.
- `archify` and `codex-skill-friction-ledger` are not currently installed and
  are not silently added. Archived `codex-waited-delivery` remains excluded.
- A missing completed verifier, ambiguous PR association, stale head/base,
  failed run provenance, uncertain request POST, or provider silence never
  grants the required check. The existing exact-head manual begin-review and
  reconcile instructions remain the recovery path.

## Evidence

- `Joey-Tools/codex-private-workflows` PR #200 verifier run `36677721807`
  demonstrates that a new head currently reconciles without requesting a
  review.
- GitHub Actions documentation: `workflow_run` runs from the default branch
  with separately granted write permissions; the public
  `pull_request_target` default policy is documented at
  <https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target>.
