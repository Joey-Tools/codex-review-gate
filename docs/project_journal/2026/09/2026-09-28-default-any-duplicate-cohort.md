---
id: 20260928-default-any-duplicate-cohort
title: Default-Any Duplicate Cohort Recovery
status: active
created: 2026-09-28
updated: 2026-09-28
branch: wip/default-any-receipt-cohort
pr:
supersedes: []
superseded_by:
---

# Default-Any Duplicate Cohort Recovery

## Summary

- PR #83 contains two ordinary direct `@codex review` requests followed by an
  official current-head terminal clean, then one canonical controller request
  and a second official current-head terminal clean. Both terminal messages
  carry the uniquely resolvable short SHA `b4506b1a41`.
- The deployed v2 reducer preserved the first two unconfirmed requests as
  physical-only boundaries because one terminal receipt could not be uniquely
  attributed to either. Their unresolved predecessor gap then rejected the
  later canonical clean, even though no provider finding or activity remained.

## Adopted Change

- Add a recovery-only duplicate cohort: exactly two strictly time-ordered,
  unedited, same-author ordinary default-`any` requests may be coalesced only
  when a single unedited official top-level current-head clean follows both,
  no base epoch exists, neither request has an official direct receipt, and no
  other provider artifact or provider error appears through the closure.
- With no successor, the second ordinary request becomes the sole confirmed
  generation. With one strictly later exact current head/base-bound canonical
  workflow request, both ordinary boundaries are coalesced before that
  canonical generation. The original comment inventory remains in the stable
  snapshot fingerprint, so concurrent additions force a reread rather than
  silently disappearing from evidence.

## Deliberate Rejections

- The exception excludes inline-parent receipts, a third or same-time request,
  another author, any edit, base epochs, any official direct `eyes`/`+1`,
  provider progress/errors, findings, stale or competing canonical successors,
  and ambiguous short-SHA resolution.
- Agents and users must not intentionally create duplicate direct requests.
  This is passive recovery of immutable historical evidence, not a producer
  protocol or a relaxation of finding blocking.

## Validation

- Focused runtime tests cover the same-author short-SHA closure, the full
  duplicate-to-canonical sequence, absence of the second canonical clean, and
  competing requests, activity, direct reactions, canonical predecessors, and
  base epochs.
- The broader current-head/default-any and finding-blocking tests remain part
  of the local validation gate before this branch is reviewed and merged.

## Next Steps

- Merge this clean-PR repair together with the release-validation control
  change, then dispatch the already admitted frozen v2.1.1 source release.
- Publish the semantic repair itself in a later patch release; do not mutate
  the frozen v2.1.1 source boundary.
