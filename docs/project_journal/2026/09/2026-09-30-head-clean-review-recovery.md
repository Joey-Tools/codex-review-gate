---
id: 20260930-head-clean-review-recovery
title: Current-Head Clean Review Recovery
status: active
created: 2026-09-30
updated: 2026-09-30
branch:
pr:
supersedes: []
superseded_by:
---

# Current-Head Clean Review Recovery

## Decision

- The current `pull_request` verifier run's GitHub-server `created_at` is the
  conservative cutoff for current-head top-level issue-comment clean evidence.
  It is not the exact PR `synchronize` timestamp; Git commit dates and
  unverified event times are not fallbacks. An official current-head top-level
  issue-comment terminal clean `C0` at or before that cutoff remains pending on
  its own. Without such a comment, an earlier `APPROVED` pull-request review
  still follows first-generation rules; with a pre-run `C0`, it cannot bypass
  pending.
- The narrow recovery requires no base epoch and exactly two relevant physical
  request boundaries. An earlier authorised request `R0` (ordinary or
  canonical) has its first-generation gap closed by official, unedited,
  current-head top-level issue-comment clean `C0` at or before the cutoff.
  A canonical `R0` must match the current head/base SHA, base ref and base
  repository identity; an old-base request is not eligible.
  A new independent, unedited ordinary `@codex review` issue comment `R1`
  must have both creation and revision strictly after the cutoff. A new
  official, unedited, current-head top-level issue-comment clean `C1` must
  follow strictly after `R1` (`C1.created_at > R1.updated_at`), with no later
  boundary or unclosed gap.
- Editing an old request, reusing `C0`, or substituting an inline-parent
  review cannot recover this case. A request comment alone does not prove
  Codex started; timestamps and head SHA establish ordering and scope, not
  causality from `R1` to `C1`. An official `eyes` on `R0` strictly before
  `C0` is settled by `C0` only for this recovery; one at or after `C0` blocks.
  This exception does not clear known findings,
  provider errors, liveness or ambiguous evidence. Complete inventory,
  exact refetches, two stable snapshots, and a later exact-head verifier run
  still gate success. Other multi-generation rules remain strict.
  The cutoff is fixed for attempts of one verifier run ID; a new PR event
  creates a new run and cutoff, so this recovery does not promise that
  `R1/C1` carries forward into a separate run.
  While `R1` has no `C1` yet, remain pending with `wait_provider`, not a
  replacement-PR instruction, when `C0` safely closed the prior gap.

## Rollout Dependency

- The canonical read-only verifier needs `actions: read` to fetch its own
  Actions run `created_at`, including in private repositories. Update all
  installed consumer verifier workflows before publishing a floating `v2`
  runtime that requires this read. An older workflow fails closed.

## Next Steps

- Complete the runtime, focused tests, and documentation validation for this
  narrow rule.
- Coordinate installed-consumer workflow updates before the floating release.

## Evidence

- Source baseline: `08c4448`.
