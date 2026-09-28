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
  snapshot contains no provider error anywhere. Every pre-pair official
  top-level `issue-comment` provider artifact with a valid activity window
  vetoes the cohort unless it is a safely classified historical terminal: kind
  `clean` or `finding`, unedited, with no `orderingError`/`resolutionError`,
  and exactly one full unambiguous SHA across `resolvedHeadSha` and `headSha`.
  This includes any otherwise unknown or unclassified, malformed, progress, or
  nonterminal official top-level `issue-comment`: with a valid activity window,
  it is opaque provider activity (a blocker rather than clean evidence) and
  vetoes the cohort. An earlier carrier may own the later clean; this explicit
  exception—not merely a full-head binding—preserves safely classified historical
  terminals. Other
  than the pair, no relevant physical request boundary may precede the closure
  clean, and at most one qualifying exact current head/base-bound canonical
  successor may follow it. No additional provider artifact or opaque provider
  activity with a valid activity window may appear from the first ordinary
  request through the clean's revision; if that successor exists, the exclusive
  artifact window extends through the successor revision. Opaque provider
  activity is an exclusion-only side channel: it does not enter the ordinary
  reducer, liveness, finding, clean, or count paths.
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
  the ordinary pair, provider progress/errors, every pre-pair official
  top-level `issue-comment` provider artifact with a valid activity window
  except the safely classified historical-terminal exception above, findings,
  stale or competing canonical successors, ambiguous short-SHA resolution, and
  any unbound raw terminal after an accepted canonical successor.
- The historical-terminal exception requires every listed property; an artifact
  is not exempt merely because it has a full-head binding. The broad pre-pair
  veto exists because an earlier carrier may be the source of the later clean.
  Record this exact exception and reason here so future changes do not broaden
  it to any full-bound artifact or weaken the fail-closed attribution rule.
- P1 correction: opaque official top-level `issue-comment` activity is not a
  normal reducer artifact, so screening it only before the pair left a later
  apparent clean vulnerable to misattribution. Its valid activity window must
  veto the entire exclusive `first -> second -> closure -> successor` window;
  it must not acquire ordinary liveness, finding, clean, or counting meaning.
- Agents and users must not intentionally create duplicate direct requests.
  This is passive recovery of immutable historical evidence, not a producer
  protocol or a relaxation of finding blocking.

## Validation

- Focused runtime tests cover the same-author short-SHA closure, a late raw
  terminal that cannot pass a later canonical generation, the latter's direct
  `+1` recovery, finding supersession protection, and competing requests,
  activity, direct reactions, canonical predecessors, and base epochs.
- Focused P1 tests cover valid-window opaque provider activity in all three
  exclusive-window segments: first request -> second request, second request
  -> closure clean, and closure clean -> canonical successor. Each must keep
  the cohort pending and must not write success.
- The broader current-head/default-any and finding-blocking tests remain part
  of the local validation gate before this branch is reviewed and merged.

## Next Steps

- Deliver this as an independent clean patch PR from current `master`.
- After merge, the already-frozen `v2.1.2` release intent becomes eligible for
  staged publisher approval. Until that protected release completes, `v2`
  remains at `v2.1.1`. Do not replay or dispatch the already completed
  `v2.1.1` admission.
