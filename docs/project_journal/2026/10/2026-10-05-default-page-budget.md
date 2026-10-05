---
id: 20261005-default-page-budget
title: Default Snapshot Page Budget
status: active
created: 2026-10-05
updated: 2026-10-05
branch: codex/default-page-budget
pr: https://github.com/Joey-Tools/codex-review-gate/pull/102
supersedes: []
superseded_by:
---

# Default Snapshot Page Budget

## Decision and rationale

- Joey requested a source PR raising the default budget so existing consumers
  can benefit without repository-by-repository variable changes. Raise
  `default.maxPages` from 20 to 100. Joey subsequently requested raising
  `expanded.maxPages` from 100 to 500 as well. Retain all other default and
  expanded object, API-attempt, byte, timeout and reconcile-duration caps,
  plus the existing hard ceilings.
- A complete snapshot shares one aggregate page budget across its opening and
  closing evidence inventories. First pages count, including short or empty
  reaction responses. This is not the number of review rounds or pages in one
  comment collection. Each complete snapshot gets its own budget; reconcile
  duration still bounds the overall stability loop.
- PR #200 in codex-private-workflows has only 13 issue comments but five
  ordinary unbound review requests plus one current-head canonical request.
  Historical ordinary-request reactions remain relevant to late provider
  activity and lineage validation. Do not prune them or weaken findings,
  identity, full-pagination, or stable-clean requirements to save page counts.
- Increasing capacity permits previously blocked reads, not fixed extra
  requests. It does not promise unlimited conversations, eliminate API rate
  limits, or waive the remaining resource caps. The initial 100/100 revision
  reported `raise_protected_limit` for both profiles' page exhaustion. The
  superseding 100/500 revision restores `use_expanded_limits` for default page
  exhaustion when expanded raises the effective ceiling; expanded exhaustion
  still requires `raise_protected_limit`. Protected custom caps that expanded
  cannot improve also retain `raise_protected_limit`. Preserve recovery guidance
  for other capacities and never discard unread evidence to pass.

## Evidence and scope

- Base: `250e2838bd5996a77c0d185f0f9b65423d8f201d`, including diagnostic
  completion source PR #101.
- [Consumer failure](https://github.com/Joey-Tools/codex-private-workflows/actions/runs/37218532090/job/111484766330?pr=200):
  default profile, `unhealthy/pending`, `use_expanded_limits`, and
  `Aggregate GitHub pagination limit exceeded while loading reactions for review request 5817276238: 21 > 20`.
- No consumer variable/workflow, permissions, event, runner, evidence selection,
  release manifest, or required-check semantics are changed by this source PR.
  Local formal review is waived by Joey; use current-head PR Codex review.

## Delivery

- Current 100/500 revision, Node v24.15.0: `npm run test:v2` passed 287/287,
  including four focused page-capacity regressions: default success above the
  former 20-page cap; expanded success above 100 aggregate pages; default
  `101 > 100` reporting `use_expanded_limits`; and expanded `501 > 500`
  reporting `raise_protected_limit`, with no success writes in either failure.
  The actual 501-page failure was not masked by the unchanged 512-attempt cap.
  Syntax checks and workflow/security contracts (51/51) passed; test artifacts
  remain host-local.
- Initial 100/100 revision `a0e6a3699d9c791ad9ae02edc15193b9a8236f62`,
  Node v24.15.0: `npm run test:v2` passed all 285 tests, including
  the new multi-request fixture above the old 20-page ceiling and both profiles'
  fail-closed `101 > 100` cases. Focused new tests passed 2/2. Workflow/security
  contracts passed 51/51 (the eight workflow cases overlap `test:v2`). Syntax
  checks and `git diff --check` passed; journal frontmatter validation passed.
- An unnecessary full `npm test` was interrupted after about 30 seconds and
  is incomplete, not passed. Its wrapper reported unverified process-group
  cleanup. A subsequent privileged read-only process inventory found no npm,
  test Node, or Python producer; this does not retroactively turn the interrupted
  test into a pass or prove the wrapper's complete descendant-cleanup contract.
  Full-repository coverage remains the required CI matrix's responsibility.
- After approval and source merges, publish one compatible runtime containing
  this capacity correction, PR #101 and the separately approved batched
  acquisition/redundant-read optimization. Floating `@v2` consumers then
  obtain the new default on fresh runs; immutable version/SHA pins do not move.
  Do not claim historical completed failures changed or that a rerun already
  succeeded without new exact-head execution evidence.
- The existing runtime-first order still applies to the new completion-reporting
  controller template. This budget correction itself needs no consumer YAML
  migration.
