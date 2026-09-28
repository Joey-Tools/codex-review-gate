---
id: 20260928-default-any-duplicate-cohort
title: Default-Any Duplicate Cohort Recovery
status: active
created: 2026-09-28
updated: 2026-09-28
branch: wip/default-any-duplicate-cohort-v212
pr:
supersedes: []
superseded_by:
---

# Default-Any Duplicate Cohort Recovery

## Summary

- Investigation of PR #83 identified the generic legacy shape that motivated
  this recovery: two ordinary direct `@codex review` requests may otherwise
  leave one terminal clean impossible to attribute. The narrow cohort below is
  deliberately not a recovery for PR #83 itself: that PR retained historical
  Codex findings and additional boundaries, so it required replacement PR #84
  with a new exact-head review timeline.
- This semantic repair was not included in #84 or in the completed `v2.1.1`
  release. It is a separate, forward-only patch and must not claim to alter
  the historical PR #83 decision.

## Adopted Change

- Add a recovery-only duplicate cohort: exactly two strictly time-ordered,
  unedited, same-author ordinary default-`any` requests may be coalesced only
  when a single unedited official top-level current-head clean follows both,
  no base epoch exists, neither request has an official direct receipt, and the
  snapshot contains no provider error anywhere. Other than the pair, no
  relevant physical request boundary may precede the closure clean, and at most
  one qualifying exact current head/base-bound canonical successor may follow
  it. The clean must be the only provider artifact from the first ordinary
  request through its revision; if that successor exists, the exclusive
  artifact window extends through the successor revision.
- With no successor, the second ordinary request becomes the sole confirmed
  generation and the first is coalesced. With one strictly later exact current
  head/base-bound canonical workflow request, the second ordinary request
  remains the explicitly confirmed, settled predecessor. A raw terminal after
  that canonical request cannot satisfy it; only a direct official `+1` on the
  canonical request can. The original comment inventory remains in the stable
  snapshot fingerprint, so concurrent additions force a reread rather than
  silently disappearing from evidence.

## Deliberate Rejections

- The exception excludes inline-parent receipts, a third or same-time request,
  another author, any edit, base epochs, any official direct `eyes`/`+1` on
  the ordinary pair, provider progress/errors, findings, stale or competing
  canonical successors, ambiguous short-SHA resolution, and any unbound raw
  terminal after an accepted canonical successor.
- Agents and users must not intentionally create duplicate direct requests.
  This is passive recovery of immutable historical evidence, not a producer
  protocol or a relaxation of finding blocking.

## Validation

- Focused runtime tests cover the same-author short-SHA closure, a late raw
  terminal that cannot pass a later canonical generation, the latter's direct
  `+1` recovery, finding supersession protection, and competing requests,
  activity, direct reactions, canonical predecessors, and base epochs.
- The broader current-head/default-any and finding-blocking tests remain part
  of the local validation gate before this branch is reviewed and merged.

## Next Steps

- Deliver this as an independent clean patch PR from current `master`.
- After merge, the already-frozen `v2.1.2` release intent becomes eligible for
  staged publisher approval. Until that protected release completes, `v2`
  remains at `v2.1.1`. Do not replay or dispatch the already completed
  `v2.1.1` admission.
