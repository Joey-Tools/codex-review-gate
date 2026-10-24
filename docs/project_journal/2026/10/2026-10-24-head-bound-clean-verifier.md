---
id: 20261024-head-bound-clean-verifier
title: Head-Bound Clean Evidence and Non-Skipping Verifier
status: completed
created: 2026-10-24
updated: 2026-10-24
branch: wip/head-bound-clean-verifier
pr:
supersedes: []
superseded_by:
---

# Head-Bound Clean Evidence and Non-Skipping Verifier

## Decisions and Reasons

- This updates the current policy documented by
  [fresh head-attested recovery](2026-10-06-head-attested-clean-recovery.md) and
  [base-retarget review](2026-10-24-base-retarget-review.md). Their historical
  implementation/validation records remain intact; the current rules below
  replace their own-run cutoff, request-attribution, metadata-skip and duplicate
  inline-inventory requirements, not unrelated provider or scope safeguards.
- A trustworthy official terminal clean explicitly bound to the current head
  answers which commit was reviewed. Its positive authority must not depend on
  proving which controller or ordinary review request caused it, nor on the
  creation time of a new verifier run. Repeated runs and draft-to-ready events
  must not expire that same-head clean merely because they create a new run.
- A real latest base-ref retarget remains a strict time boundary: the selected
  clean must follow it, including an A-to-B-to-A cycle. This is a temporal
  acceptance policy, not proof of the provider's internal base input.
- Keep provider identity, complete body classification, unambiguous short-SHA
  resolution, non-inline finding/error safety, complete relevant pagination,
  current PR/test-merge binding and two stable complete snapshots. A clean
  cannot silently erase a non-inline finding. Legacy reaction-only evidence
  remains request-bound rather than acquiring explicit-head authority.
- An actual official provider review in `PENDING` remains a liveness blocker;
  it is not equivalent to an old unfinished request comment. Selecting a direct
  head-attested clean must not bypass that existing provider-review safeguard.
- Edited non-summary provider progress retains the incomplete-history guard when
  existing edit metadata shows that an earlier decision-relevant body is not
  observable. Recognized controller diagnostics and official PR summaries remain
  nonblocking. This uses existing metadata, not another history API or interpreter.
- Acquire provider evidence before optional request-author/reaction work. When a
  direct clean suffices, skip that request-only fan-out; otherwise keep the legacy
  paths and their complete pagination/budget safeguards. Request-only lineage
  failures remain pending but can recommend a future exact-head clean without
  rebuilding old generations. This changes guidance, not positive authority.
- Enforcing GitHub conversation resolution owns all unresolved inline threads,
  including outdated/old-head and human-authored threads. Remove the duplicate
  Action thread inventory rather than spending queries to enforce the same rule.
  Installation must require that rule; runtime does not discover it via new API
  calls. Gate success is not a claim that all conversations or merge gates pass.
- One fixed required verifier job actually executes every subscribed event,
  including ordinary `edited`. A conditionally skipped required job can count as
  success, so metadata edits must reconcile evidence instead of skipping or
  returning event-only success. Keep runner configuration and ubuntu-slim default.
- Keep the original canonical run title and opt-in first-attempt failure request
  path. A title/body edit does not itself expire a valid clean or require another
  review, but genuinely insufficient evidence may still create or adopt a needed
  request under the existing AUTO_REQUEST policy. A proposed metadata-only title
  marker and automatic-request exclusion were withdrawn: a metadata run can
  supersede/cancel synchronize and would otherwise strand its first review.
  Do not expand cancelled-run or stale-run automatic-request authorization.
- Defer cross-run cache/artifact receipts. Reuse an existing eligible clean by
  reading current evidence, not by copying a historical job's success. Reliable
  cache validation/persistence has additional cost and is a separate optimization.

## Current State

- The source implementation, narrow installed-workflow migration, regression
  coverage and current English/Chinese installation and package documentation
  are complete. Historical frozen organization-handoff bytes and identities,
  controller admission/POST safety, permissions and runner configuration remain
  unchanged.
- Publishing and consumer installation are separate follow-up workstreams. This
  source change does not bump an Action version or release manifest, publish a
  tag, change protection, or claim production validation. The fixed non-skipping
  job requires installing the updated canonical YAML; floating `@v2` alone can
  update runtime behavior but cannot rewrite consumer workflows.
- Production environment approval remains human-owned. Independent publication
  verification precedes the bounded diskplan PR33 canary and retained consumer
  rollout; the earlier all-green BLOCKED observation is not attributed to SKIPPED.

## Next Steps

- None within this completed source-implementation workstream. Source delivery,
  separate release intent and consumer rollout retain their own review, CI,
  human approval and production-evidence gates.

## Evidence

- Parent-owned diagnosis: diskplan PR33 reused a pre-existing request after a new
  verifier creation boundary rejected its old same-head clean. This confirms a
  runtime consistency issue, not the cause of the earlier all-green BLOCKED state.
- Frozen starting source: 0746d53b8f5dc4851f6f3dfe63913d12cf53f807.
- Node.js 24.15.0: the complete 15-file core set passed 1310/1310 with zero
  failures, cancellations or skips (`core-full-02.log`). The full runtime file
  separately passed 361/361 (`runtime-parent-full-03.log`); it is a subset of
  the core count, not additional coverage.
- All four bootstrap integration shards passed 44, 43, 43 and 43 selected
  callbacks: 173 unique callbacks with complete/disjoint inventory assertions.
  The unchanged dependencies were validated separately from runtime edits.
- `npm run check`, paired workflow byte comparisons and whitespace checks pass.
  actionlint 1.7.12 passes with only its unsupported native `stacked` activity
  diagnostic ignored; an unrelated invalid-activity negative control still
  fails. No shell script or inline shell was changed.
- Earlier integration attempts exposed a real direct-clean/PENDING-review
  ordering regression and an edited-provider-progress history gap, plus obsolete
  request-lineage, no-longer-read thread and diagnostic-fixture assertions. The
  fixes preserve non-inline finding/error, provenance, retarget and legacy
  budget negatives. Failed and successful logs remain in host-local
  `head-clean-scope-evidence`; no failed attempt is counted as a pass.
- Three unchanged synthetic release-suite shards reached the local 840-second
  deadline without a test result (wrapper exit 124); shard four was not run.
  Those runs are incomplete, not passing or diagnosed code failures. Publisher
  workflow/script, provenance generator, release baseline, Action metadata,
  release-suite source and shard adapter are unchanged. Complete current-head
  Node.js 20/24 remote CI is required before merge/publication; local validation
  does not claim that coverage, an actual release or a consumer deployment.
