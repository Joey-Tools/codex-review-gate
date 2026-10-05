---
id: 20261005-batched-snapshot
title: Batched Snapshot Acquisition
status: active
created: 2026-10-05
updated: 2026-10-05
branch: codex/batched-snapshot
pr:
supersedes: []
superseded_by:
---

# Batched Snapshot Acquisition

## Decision and rationale

- Joey approved a separate acquisition-optimization PR after the default
  pagination-capacity PR [#102](https://github.com/Joey-Tools/codex-review-gate/pull/102).
  Publish both changes together with merged diagnostic-completion PR #101
  in one subsequent runtime release, rather than publishing intermediate
  versions for each source PR.
- Issue comments are already acquired as complete lists and inspected locally.
  The optimization targets fragmented network acquisition and demonstrably
  redundant reads, not evidence selection, request-generation semantics, or
  permission/event/runner changes.
- Preserve fresh GitHub observations, complete nested pagination, repository
  and PR scope binding, provider identity, reaction timing, finding resolution,
  history-change detection, and fail-closed behavior. Reusing a cached evidence
  set for both stability observations cannot prove GitHub stayed unchanged.
- Preserve finite page, object, API-attempt, byte, and time budgets. Batch
  transport must not hide incomplete nested connections or make reaction
  acquisition unbounded. Measure request-count savings in regression fixtures.

## Delivery boundaries

- Local formal review is waived for this session; use exact-current-head
  GitHub PR Codex review and required CI.
- Keep #102 limited to capacity and recovery guidance. That PR merged as
  `3e71136a7842e50f5fcd045686a002857d3284c5`. This follow-up retains the
  default 100 / expanded 500 page caps and is integrated with that master tip
  before its final validation and PR creation.
- Do not publish until both source PRs have passed their gates and merged.
  Existing floating `@v2` consumers receive the runtime improvements on fresh
  runs after publication; immutable pins and historical run outcomes do not move.

## Next steps

- Use current-head GitHub PR Codex review and the required CI matrix.
- Use the existing approved release workflow for the
  combined runtime without adding new release machinery.

## Implementation checkpoints

- Combined latest-base-event acquisition into the first comment-history
  response using a conditional `baseEpochTimelineItems` alias. Later history
  pages do not repeat that acquisition. Existing history/base-epoch latches,
  exact REST refetches, opening/closing inventories and the stable-pair
  protocol remain intact.
- Selected request reactions now use fixed batches of at most eight exact
  issue-comment nodes, each with 100 reactions per independent connection
  page. Bind REST comment node/database IDs, repository ID/name and PR number;
  require stable total counts, unique reaction IDs and advancing cursors.
- GraphQL returns the official bot's reaction author as `User`. Each fresh
  carrier pass observing that account uses one independent REST lookup of its
  exact login, requires `Bot`, and binds its database ID. No identity cache
  spans snapshots, no suffix inference supplies provenance, and unrelated
  actors never inherit bot authority. A failed identity lookup is fail-closed.
- Preserve already observed valid provider reactions before reporting later
  partial-response, pagination or budget errors. Each physical GraphQL
  pagination response counts once; every nested raw object still consumes the
  object budget. Response bytes, attempts, deadlines and batch size stay finite.
- The measured nine-request fixture uses two GraphQL batches per carrier
  inventory, or four reaction-batch requests across one snapshot's fresh
  opening and closing inventories, versus 18 former REST first-page reaction
  GETs. A normal two-snapshot stable pair therefore uses eight such batches,
  not four. Official reactions additionally require one REST identity read per
  carrier pass. These are fixture counts, not a universal total API guarantee.
- Exact REST carrier refetches, missing-pending-review confirmations, finding
  scans and two fresh five-second-separated snapshots remain mandatory.
  Do not reuse a cached snapshot or drop historical request reactions.
- Regression coverage includes nested pagination, scope and account binding,
  count/cursor drift, late activity, partial/oversized response latches, and
  default `101 > 100` / expanded `501 > 500` fail-closed budget exhaustion.

## Validation

- Implementation-worker checkpoint on Node v24.15.0: focused reaction,
  base-epoch and page-budget regressions passed 25/25; `npm run test:v2`
  passed 296/296; `npm run check` and `git diff --check` passed.
- Full-repository and cross-version coverage remains the required CI matrix's
  responsibility. No full `npm test` or local formal reviewer was run for this
  optimization. Bounded validation artifacts stay host-local.
