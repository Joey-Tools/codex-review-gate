---
id: 20261121-pr-body-reaction-completion
title: Corroborate Native Completion With a PR Body Reaction
status: active
created: 2026-11-21
updated: 2026-11-21
branch: wip/pr-reaction-summary
pr:
supersedes: []
superseded_by:
---

# Corroborate Native Completion With a PR Body Reaction

## Decision And Scope

- Keep existing clean comments, native completions, and request-reaction
  decisions unchanged. If a native summary predates the latest base retarget,
  require the existing exact-head, typed no-findings state plus the explicit
  post-retarget Code Review completion time and a fresh official PR-body
  thumbs-up. Bind the reaction account to the authenticated summary author,
  not GitHub's reaction actor type label or an aggregate count.
- Paginate PR-body reactions within the existing evidence budget. Read back
  the selected summary and authenticate its current editor as before. Include
  the selected completion time and exact reaction in stable evidence. Do not
  use the aggregate edit clock, Security Review row, stale or human reactions,
  or a display-only result as positive proof.
- Preserve the finding, pending-review, history, and conversation guards.
  Completion after the retarget is a time floor, not a proof of coverage of a
  particular base SHA. Summary updates and reactions do not add a trigger;
  use existing reconcile if there is no new verifier event. The verifier
  already has Issues read permission; controller adoption is unchanged.

## Evidence And Next Steps

- [Observed provider summary](https://github.com/Joey-Project/print-layout/pull/1#issuecomment-7066243869)
  supplied the Code Review row and microsecond UTC timestamp format. The
  exact-head review observed there had findings and correctly does not qualify.
- Local regressions replay the observed shape with a clean state and a
  connector reaction, and cover pending results, mismatched head, stale
  evidence, human reactions, pagination, and changing snapshots.
- Node.js 24.15.0: all 547 affected v2, workflow-contract, core, and
  evidence-budget tests pass; syntax and journal checks pass. The unsharded
  full-suite attempt exceeded its local time budget and did not yield a verdict.
- Release and live consumer validation are separate from the source change.
