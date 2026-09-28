---
id: 20260928-inline-parent-clean-receipt
title: V2 Inline Parent Clean Receipt Repair
status: active
created: 2026-09-28
updated: 2026-09-28
branch: wip/resolved-inline-clean
pr:
supersedes: []
superseded_by:
---

# V2 Inline Parent Clean Receipt Repair

## Summary

- Joey authorized a lightweight v2 semantic repair after the live organization
  rollout exposed an unreachable closure: a policy-only Codex inline finding
  could be resolved under the installed ruleset, while its exact-head
  `COMMENTED` review parent still could not supply the terminal clean receipt
  needed by the required v2 check.
- The repair admits one deliberately narrow parent-only receipt. It does not
  move inline thread evaluation into the runtime.

## Adopted Boundary

- An official Codex Bot, exact-head, unedited `COMMENTED` inline-parent review
  may be a non-inline terminal-clean receipt only when its fixed closed grammar
  validates: the canonical heading, a `Reviewed commit` reference that matches
  the native `commit_id`, and the canonical official disclosure. The parent
  cannot carry a non-inline finding payload.
- This is available only to the single, exact, unedited default-`any` ordinary
  request in a no-base-epoch, single-flight lineage. A generic PR review clean,
  multiple or ambiguous requests/boundaries, a base epoch, an edited carrier,
  or ambiguous identity, ordering, or head binding remains fail-closed.
- The runtime does not query or interpret inline review threads, their child
  comments, or their resolved status. Those values do not contribute to v2
  finding counts or the decision fingerprint. The accepted review parent is
  ordinary parent-level provider evidence; the installed ruleset remains the
  sole authority for `all conversations resolved`.

## Current State

- This is a narrow receipt-classification change, not a transfer of inline
  thread enforcement from GitHub rulesets into the Action.
- Local validation completed for the frozen source candidate: `npm run check`,
  `npm run test:v2`, `node --test test/release-provenance.test.mjs`, and the
  schema-v3 Node24 release-pipeline regression all passed.
- No package publication or rollout reconciliation result is asserted by this
  journal entry.

## Next Steps

- Follow the normal review and release procedures, then run the retained
  consumers' exact-head reconciles against the published floating `v2` alias.

## Evidence

- The active v2 rollout encountered policy-only inline findings whose resolved
  conversations could satisfy the ruleset but could not produce a v2 clean
  receipt under the prior parent-review exclusion.
- Related rollout state: `docs/project_journal/2026/09/2026-09-18-organization-v2-handoff.md`.
