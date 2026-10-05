---
id: 20261005-default-page-budget
title: Default Snapshot Page Budget
status: active
created: 2026-10-05
updated: 2026-10-05
branch: codex/default-page-budget
pr:
supersedes: []
superseded_by:
---

# Default Snapshot Page Budget

## Decision and rationale

- Joey requested a source PR raising the default budget so existing consumers
  can benefit without repository-by-repository variable changes. Raise only
  `default.maxPages` from 20 to 100; retain default object, API-attempt, byte,
  timeout, and reconcile-duration caps, the expanded profile, and hard ceilings.
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
  limits, or waive the remaining resource caps. `expanded` still raises other
  capacities; because its page ceiling is also 100, a page-cap hit must report
  `raise_protected_limit`, not recommend it as an ineffective pagination remedy.
  Preserve `use_expanded_limits` for other default capacity failures that the
  expanded profile can actually alleviate.

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

- Node v24.15.0: the final `npm run test:v2` passed all 285 tests, including
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
- After approval and source merge, publish one compatible runtime containing
  both this capacity correction and PR #101. Floating `@v2` consumers then
  obtain the new default on fresh runs; immutable version/SHA pins do not move.
  Do not claim historical completed failures changed or that a rerun already
  succeeded without new exact-head execution evidence.
- The existing runtime-first order still applies to the new completion-reporting
  controller template. This budget correction itself needs no consumer YAML
  migration.
