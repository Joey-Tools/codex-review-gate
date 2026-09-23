---
id: 20260918-organization-v2-handoff
title: Organization v2 Cohort Handoff
status: active
created: 2026-09-18
updated: 2026-09-23
branch: codex/organization-v2-handoff
pr:
supersedes: []
superseded_by:
---

# Organization v2 Cohort Handoff

## Summary

- Stable Action `v2.0.1` and the floating `v2` alias are published from
  `JoeyTeng/codex-review-gate-action`. This workstream implements and carries
  out the user-approved organization-wide transition from the inherited v1
  required status to v2.
- The active v2 cohort (the fixed, complete set of repositories migrated
  together) has exactly 10 members. `Joey-Tools` organization ruleset
  `16590367`, `Must Pass Codex Review`, retains its original 11-member legacy
  selector so its `deletion` and `non_fast_forward` protection still applies to
  archived `codex-waited-delivery`; that archived repository is not an active
  v2 member and must not receive migration, canary, cleanup, receipt, or bridge
  removal work.
- The source repository `Joey-Tools/codex-review-gate` is deliberately outside
  that active 10-member cohort. Its separate repository ruleset `16410326`
  still requires `codex/review-gate` as a temporary v1 self-gate; it was not
  selected by either organization ruleset or by the eight repository-local
  cleanup surfaces. A dedicated source bootstrap must stage and activate a
  separate v2 rule, then remove only that independent v1 status requirement
  before v1 can be retired from the source repository.
- This is not a broad relaxation of the ordinary installer. It adds a separate,
  auditable temporary-bridge profile and a manifest-bound organization handoff
  transaction. The normal completed-installation contract continues to reject
  every v1 caller.

## Adopted Transition Contract

- The existing organization ruleset remains active throughout the preparation
  phase. Its repository selector, `deletion`, `non_fast_forward`, bypass
  configuration, and every other non-v1 rule remain unchanged.
- A separate organization ruleset is staged disabled, then activated only after
  complete cohort proof. It contains exactly one strict required-status rule:
  `codex/github-review-gate` from GitHub Actions integration `15368`; it has
  no bypass actors. It deliberately does not duplicate deletion,
  non-fast-forward, or pull-request policy from the old ruleset.
- Every cohort member receives canonical v2 verifier/controller workflows,
  CODEOWNERS control-plane coverage, its repository v2 policy, and the exact
  temporary legacy bridge. The bridge is constrained to an approved path and
  byte-for-byte template; it may emit only the legacy v1 context and cannot
  become another v2 producer.
- Each member must prove both the native v2 exact-head/test-merge CheckRun and
  the legacy v1 required status while the old organization rule is still
  active. A member with a compatibility or history-only legacy surface is not
  silently exempted.
- The v1 status is an availability proof for the temporary bridge, not the
  security authority for cutover: the inherited v1 required-status rule has no
  integration binding, and a commit-status `target_url` is writer-supplied
  metadata. The v2 CheckRun bound to GitHub Actions integration `15368` is the
  authoritative security proof.
- Unlike an ordinary completed single-repository canary, each cohort canary
  remains open and non-draft until the organization activation evidence is
  complete. This is required so the handoff can bind the current default-base
  test merge rather than a closed PR's historical result; it is then closed
  unmerged.
- After all 10 active members are in that state, the new organization rule is
  active and read back across the full cohort. This intentionally creates a
  temporary
  dual-protection interval.
- The eight active repository-local legacy required-status entries are then
  removed by the controlled `apply-repository-cleanup` mode. Each
  snapshot-bound action
  binds exact manifest `full_name`, `id`, `node_id`, and `default_branch`
  before every surface read and again immediately before any needed mutation,
  then performs exact-before comparison, the surface-specific mutation, and
  exact-after readback while preserving every other rule. The metadata tuple
  protects repository object identity/default-branch selection; the surface
  snapshots protect selected policy content. Unreadable or mismatched identity
  stops the batch at observation; a pre-mutation mismatch emits no current
  write, and no later mutation runs. A stable mixture of before/after items is
  resumable and plans only the remaining before-state items. Only after their
  readback and a full cohort pre-cutover snapshot may the old organization
  ruleset be updated.
- The sole old-rule cutover mutation is a `PUT` to the existing ruleset ID that
  removes its `codex/review-gate` required-status rule. It never deletes the
  ruleset. Two complete, stable cohort snapshots must show that every member is
  covered by v2 and that all old non-v1 policy is unchanged.
- The mutating `verify --apply` response does not authorize bridge removal.
  While the final policy-mutation freeze remains active, a separate read-only
  `verify` must return top-level
  `schema_version: organization-review-gate-handoff-output/v2`, `mode: verify`,
  `status: final-verified`, `applied: false`, and `action: null`. Its
  `final_closure_receipt.schema_version: 2` binds the organization, reviewed
  manifest digest, final snapshot digest, terminal legacy/v2 ruleset
  identities/states, and the exact active repository cohort in canonical
  UTF-8-byte `full_name` order. The receipt is valid only for that complete
  fixed 10-member active cohort, never a subset or expanded active set; the
top-level `plan_sha256` must bind its final read-only `verify` plan exactly,
and the receipt's canonical SHA-256 is the explicit removal proof.
- Removal of each temporary bridge is a later, separate PR phase. The local
  bootstrap accepts only the complete final read-only verify JSON, its exact
  embedded-receipt SHA-256, an unambiguous GitHub `origin`, and live GitHub
repository metadata that exactly match one receipt entry's `full_name`, `id`,
`node_id`, and `default_branch`. At the pre-rename boundary it reads `origin`
before and after the metadata lookup, repeats the local object checks, then
reads `origin` once more immediately before the atomic bridge quarantine
rename. After the rename and before unlink, it repeats the complete `origin`
to live metadata identity/default-branch to `origin` check and revalidates the
quarantined object's identity and canonical content. Remote-binding failure
attempts a no-clobber hard-link restoration of that same admitted bridge; an
occupied canonical path or failed verification stops without overwrite or
removal success. These are point-in-time checks, not a continuous lock.
This returns consumers to the ordinary no-v1-caller installation contract after
the global cutover is closed.

## Current State

- Source tooling implements the temporary bridge, cohort handoff transaction,
  receipt-bound bridge removal, and their operator-facing guides. Source PR
  `#54` merged as `5442b851200b6dd1fc85f88f0e2861f64d043906`: it corrects the
  controller to the required PR-scoped comment authority and hardens the
  handoff/bridge proof boundaries.
- Release PR `#55` merged as `149769eac4b51df023a0edb79ad4a611d7a3edc3`,
  updating the `v2.0.1` package and release manifest. The stable `v2.0.1`
  package and floating `v2` alias are published; the release republishes the
  already-reviewed `DESIGN.md` correction with its matching package version
  and makes no runtime-code change.
- Ten active cohort default branches have migrated to the canonical v2 verifier,
  controller, CODEOWNERS coverage, and temporary v1 bridge. Repository-local
  v2 rulesets are Active. Organization ruleset `23787657`, `Must Pass Codex
  Review v2`, is Active with the integration-bound
  `codex/github-review-gate` status. Legacy organization ruleset `16590367`
  remains Active only to retain `deletion` and `non_fast_forward`; its v1
  `codex/review-gate` required-status rule has been removed.
- The completed policy mutation covers only the old organization rule and the
  fixed active cohort: all eight repository-local legacy cleanup surfaces now
  require only `test`. It did not change the source repository's independent
  local ruleset `16410326`, which remains a temporary `codex/review-gate` v1
  self-gate pending a dedicated source bootstrap. The source repository is not
  a hidden eleventh cohort member or a ninth cleanup surface.
- The initial read-only inventory found that all 11 originally selected members
  inherited old organization rule `16590367`; nine additionally retained a
  repository-level legacy `codex/review-gate` requirement. Later bootstrap and
  canary facts are recorded below and supersede the then-open
  compatibility/history exception status.
- `codex-waited-delivery` is archived and explicitly outside this cohort. Its
  workspace retirement tombstone is therefore not a migration blocker, and
  the workstream must not restore a mirror or create a migration PR for it.
- The published historical handoff format is immutable: `manifest/v1`,
  `output/v1`, and receipt schema `1` mean an exact 11-member closure. The
  active 10-member contract therefore uses `manifest/v2`, `output/v2`, and
  receipt schema `2`. Bootstrap accepts only exact same-version pairs.
  Historical schema-1 receipts retain their published JSON shape and canonical
  digest validation for auditability, but authorize no new bridge-removal
  write. A schema-2 receipt instead carries `manifest_repositories`, derived
  from the reviewed active manifest, and the stable observed `repositories`;
  both canonical identity lists must match entry by entry before producer or
  consumer admission. Bridge removal is authorized only from the
  manifest-derived list, never from the observed list or the old 11-member
  ruleset selector. This avoids silently redefining published 11-member
  evidence while keeping the archived repository outside the current mutation
  scope. A canonical final organization closure receipt has not yet been
  minted, so temporary bridge removal remains unauthorized even though the v1
  required status has been removed from the old organization rule and every
  active-cohort repository-local cleanup surface.
- The current source hardening makes the retained archive exception explicit in
  the unshipped `manifest/v2`: `legacy_ruleset.legacy_only_repository` binds
  `Joey-Tools/codex-waited-delivery` by `slug`, numeric `id`, `node_id`,
  `default_branch`, and `archived: true`. The legacy selector is valid only
  when it contains the ordered 10 active IDs plus that one archived ID exactly
  once. The archived identity must not overlap an active member. It remains
  outside the v2 payload, repository cleanup, final receipt, and bridge-removal
  scope.
- The reason for this schema tightening is to prevent a selector that merely
  has 11 unique IDs from substituting an arbitrary eleventh repository and
  silently removing `codex-waited-delivery`'s retained `deletion` and
  `non_fast_forward` protection. Post-activation/cutover stable snapshots will
  read the archive's live `full_name`, `id`, `node_id`, `default_branch`, and
  `archived` flag; the helper rereads the same identity immediately before the
  legacy-ruleset `PUT`. An unreadable response, mismatch, same-slug
  replacement, default-branch drift, or `archived: false` is fail closed and
  sends no cutover mutation.
- Regression coverage rejects malformed or overlapping archive descriptors, an
  arbitrary selector eleventh ID, archive identity drift or an unreadable
  archive immediately before cutover, and asserts that each such failure sends
  zero legacy-ruleset `PUT` requests. It also preserves the separate assertions
  that the v2 payload and final receipt contain only the active 10-member
  cohort.
- The second P1 receipt-binding repair makes a schema-2 receipt prove the same
  active cohort twice: `manifest_repositories` comes only from the reviewed
  manifest, while `repositories` comes from the stable final observation. Both
  lists contain canonical `{full_name,id,node_id,default_branch}` identities,
  and are rejected unless they are exactly equal. Consumer bridge removal reads
  only `manifest_repositories` as its authorization set. This prevents a
  digest-valid observed list from expanding or replacing the manifest-approved
  cohort at the consumer boundary.
- The current rollout adds a defense-in-depth hard rejection in both schema-2
  receipt lists for `Joey-Tools/codex-waited-delivery` by case-insensitive slug,
  numeric ID `1242512099`, or node ID `R_kgDOSg864w`. Slug detects same-slug
  replacement, rename, or transfer; ID and node ID bind the persistent GitHub
  object. The regression plan includes a synchronously altered dual-list
  receipt with a fresh digest and asserts that consumer admission fails before
  any local mutation. This does not alter schema-1's historical bytes or
  digest semantics.

### Execution Update — 2026-09-18

- Nine bridge-preserving migration PRs have merged. They install the canonical
  v2 verifier/controller, the managed CODEOWNERS block, and the canonical
  legacy bridge without changing any required-status policy:
  - `codex-private-workflows#193` at `ce5e5c878fa7d1dca184ab4ad1ae3ddc9007d466`;
  - `codex-apple-notes-toolkit#6` at `ecef723883234044a88347ba4caf8a38e322aeb0`;
  - `codex-personal-sync#22` at `7ebca9cb392b2621ff3cd487b21e744953b3afd0`;
  - `codex-rollout-backup#8` at `1233a535ec36cdc00b7dcd6f249a60be1383f91c`;
  - `codex-debug-triage#9` at `d3c610fcc39ce90d190f6e510f417aa68c01bd91`;
  - `codex-project-journal#7` at `58216c543a50051c16e01f9017a7cb65a7a64de3`;
  - `codex-toolbox#33` at `a8df72542fa89411f8aa75687cdb90eb979b8e01`;
  - `codex-workflow-hygiene#77` at `feb9bc110a7f3e077a89c50b15c89265a38e333c`; and
  - `codex-review-workflows#115` at `0be747dff940b36bd7b61712e435c6105a718555`.
- The corresponding Private Overlay Release completed successfully in run
  `35378848456`. `codex-waited-delivery` is archived and out of cohort, not
  waiting for a workspace mirror. The retrospective-history bootstrap
  `codex-session-retrospective-history#7` has merged at `53c9a165…`; its
  follow-up canary `#8` passed both v2 and legacy proof, then closed unmerged.
- Eight harmless, unmerged canary PRs were created for the merged public
  consumers. Their default-branch `begin-review` controller dispatches all
  failed at the same marker-comment POST: `403 Resource not accessible by
  integration`, despite the runner reporting `issues: write` and
  `pull-requests: read`. The observed failure alone does not prove which
  permission boundary caused it.
- Source PR `#54` applies the documented alternative as a strictly
  narrower PR-only authority: it removes `issues: write` and changes
  `pull-requests: read` to `pull-requests: write`. The controller targets only
  pull-request conversation comments, for which GitHub accepts that write
  permission. Repository Actions default permission remains `read`, and
  `can_approve_pull_request_reviews` remains `false`. No new Action package
  release is needed because this is a copied consumer-workflow template change,
  not an `@v2` runtime change. The patch also rebinds bridge removal to the
  live repository identity at each destructive boundary and strengthens the
  cohort helper's workflow/ref, effective-rule pagination, and manifest
  identity checks. Its legacy-status admission now resolves the active
  canonical temporary bridge workflow identity from a complete Actions workflow
  inventory, then drains both that independent writer and the retained old
  producer workflow before and after the commit-status pagination horizon
  readback.
- Current-head GitHub Codex review initially found that the writer drain
  omitted three documented nonterminal Actions run states: `requested`,
  `waiting`, and `pending`. A retained producer or bridge in any of those
  states can later resume and overwrite `codex/review-gate`. The first repair
  queried all five states separately, but the follow-up review found that this
  itself was racy: one run can advance between independently timed filtered
  requests and be absent from every result.
- That source change instead reads one complete unfiltered
  `actions/workflows/{id}/runs?per_page=100` inventory for each independently
  identified writer, then accepts only `status=completed` rows locally. It
  rejects every documented nonterminal state (`requested`, `waiting`,
  `pending`, `queued`, `in_progress`) and any unknown or missing state. This
  prevents a state transition from moving a writer between separate filter
  buckets. The unfiltered endpoint deliberately has no `status`, `head_sha`,
  `created`, or other search filter, so it does not use GitHub's documented
  1,000-result filtered-search ceiling. The existing 60-second and 8 MiB
  read budgets remain fail-closed if a complete inventory cannot be obtained.
- The independent local Terra/high review additionally found that the first
  regression test reused the production status list, so deleting a state could
  shrink the drain, fake endpoints, and assertions together. The test now
  freezes the exact five literal statuses separately; it verifies local
  rejection of each state, rejects unknown states, preserves pagination,
  count, and duplicate-ID fail-closed checks, permits completed historical
  rows including a 1,001-row inventory, and asserts that activation uses only
  the exact unfiltered endpoint for both writers. This deliberately guards the
  production/test boundary and the no-filter invariant together.
- Joey selected `GPT-5.6 Terra` with `high` thinking for subsequent independent
  local Codex review lanes in this workstream. The local review of this repair
  uses that profile; this is a reviewer-profile choice, not part of the
  consumer runtime or published Action contract.
- An installation PR is an intentional manual trust bootstrap. Its new
  controller exists only on the PR head, while `issue_comment` and
  `workflow_dispatch` consume the default-branch workflow. The initial v2
  verifier can therefore fail closed before a terminal provider result without
  constituting an Action defect. After merge, a separate harmless canary PR
  supplies the authoritative current-head v2 and v1 proof used by organization
  activation.
- The writable controller intentionally excludes `pull_request_review` and
  `pull_request_review_comment`. GitHub binds both event families to the PR
  merge ref; a controller carrying `actions: write` and `pull-requests: write`
  must remain a protected-default-branch workflow. Review- or reaction-only
  provider evidence is instead consumed by the typed default-branch manual
  `reconcile` path. This preserves the single-producer and pre-runner trust
  boundary without adding a runtime App, status writer, or cron.
- A migration-review bridge run on `codex-review-workflows#115` demonstrated
  the same merge-ref boundary in practice: run `35355124380` failed its
  `issues: write` audit-comment POST with `403 Resource not accessible by
  integration` and wrote `codex/review-gate=error`. The canonical bridge now
  removes `pull_request_review` from its closed trigger envelope, while
  retaining only `pull_request_target` lifecycle events and
  `issue_comment: created`; an exact rerun of the pre-existing trusted
  default-branch publisher (`35353747519`) restored the current v1 success.
  Every open migration PR must be re-bootstrapped to the corrected canonical
  bridge bytes before it is eligible to merge.
- During dual enforcement, manual v2 `reconcile` can refresh only the native
  `codex/github-review-gate` CheckRun and must never write the legacy status.
  Review- or reaction-only evidence therefore recovers v1 only from a complete,
  stable paginated inventory of the current active bridge workflow. Selection
  binds the current repository/default-branch ref and SHA, canonical bridge
  bytes at that SHA, the current PR head/base tuple, the feature-head-bound
  `pull_request_target` run, and its exact workflow identity. Duplicate run IDs,
  a pagination cap, or a changed page-1 horizon are inconclusive. Exactly one
  eligible run may be rerun; more than one stops, while only cardinality zero
  permits draft-to-ready before selection restarts. The same recovery binding
  set is revalidated immediately before and after the one POST. That sole POST
  must preserve an explicit HTTP `201` receipt; a transport result or response
  that cannot prove `201` is inconclusive and must not be replayed. Success
  requires exactly the next run attempt and a new current-head
  `codex/review-gate=success` status ID from `github-actions[bot]`, not an older
  success. This recovery never adds a writable review event or `workflow_dispatch`.
- Before an organization v2 rule is activated, every pre-existing open PR
  must also have a fresh verifier on its current head/base/test-merge scope.
  A new push, reopen, or documented draft-to-ready transition creates that
  verifier; controller reconcile can only rerun an already-existing exact
  verifier and deliberately cannot synthesize a new pull-request event.
- Joey confirmed the original policy order: the new organization ruleset has
  v2 as its sole required status context; the old ruleset retains deletion and
  non-fast-forward protection until the planned, receipt-bound removal of its
  v1 context. The 2026-09-23 execution update records Joey's later,
  scope-limited switch-first exception to that final ordering: it removed only
  the v1 status rule after narrow exact API readback, preserved the old
  non-status protections, and did not authorize bridge removal.
- Activation also requires a durable independent control-plane Codeowner path.
  The managed `/.github/**` owner currently names `@JoeyTeng`, while some
  cohort repositories have no other writable principal. That does not block
  ordinary pull requests or this bridge preparation, but it would prevent a
  future control-plane PR authored by that account from receiving the required
  distinct Codeowner approval. Do not activate the v2 repository policy until
  a separately authorized writable reviewer path has been selected for every
  affected repository.
- The frozen implementation and documentation diff then received an independent
  `GPT-5.6 Terra` review at `high` thinking with no actionable findings. Its
  completed validation evidence is `npm run check`, bootstrap suite 119/119,
  organization suite 136/136, `git diff --check`, and project-journal
  validation. A local unsharded `npm test` attempt was bounded after twenty
  minutes and is deliberately not recorded as passing: it had no failure
  assertion output but ended incomplete inside the heavy release-pipeline
  file. The repository's native CI-equivalent `1/4` through `4/4`
  release-pipeline shards subsequently each exited zero, covering every
  sharded release-pipeline test exactly once; the separately interrupted
  `v2-workflow-contract` and `workflow-security-contract` files also passed
  independently (8/8 and 41/41).
- The reviewed result is committed as signed source commit
  `53c49bfbb3cb76f83bd598f17b3329b09beddf2d` and delivered for GitHub review
  as source PR #56. Local signature verification could confirm the embedded
  OpenPGP signature packet and the available signing subkey, but the current
  keyboxd service reported no public key for trust verification; this host-side
  keyboxd mismatch does not change the signed commit bytes or its GitHub
  review scope.

### Current-head review follow-up — 2026-09-18

- GitHub Codex review `5252527795` on source handoff commit
  `91fcd5ec710925973ad9e04f3d468836f09f8d6a` found three additional
  fail-closed boundaries in the legacy-status admission helper. The repaired
  helper deliberately makes no claim that GitHub exposes an atomic snapshot
  across Actions runs and commit statuses.
- Each retained producer/temporary bridge writer is now scanned with explicit
  unfiltered `per_page=100&page=N` requests. The scanner validates every page
  incrementally, preserves the per-process 8 MiB response ceiling, retains
  only `{id, run_attempt}` execution identity plus pagination metadata, and
  rejects nonterminal/unknown statuses, duplicate run IDs, page/count drift,
  or incomplete pages. It no longer asks `gh --paginate --slurp` to aggregate
  an arbitrary history of full workflow-run objects into one bounded stdout.
  A 701-run fixture with more than 8 MiB of aggregate opaque payload proves
  the page-at-a-time path while each individual response stays bounded.
- Legacy compatibility status admission now uses the bounded quiescence
  protocol `D0 -> S0 -> D1 -> S1`: two complete terminal writer execution
  epochs (`D`, bound by workflow ID and sorted `{id, run_attempt}`) bracket two
  independently page-1-stable full commit-status projections (`S`). Both
  decision-relevant projections must be equal before the tool accepts the
  latter status. A completed new run or same-run rerun after `S0` therefore
  cannot leave an old success eligible for the organization-policy write. A
  finite read-only protocol cannot rule out a writer beginning after `S1`; the
  existing stable cohort pair and immediate pre-mutation revalidation remain
  the bounded fail-closed defense for that tail rather than an invented
  barrier.
- The temporary bridge identity selection now rejects duplicate Actions
  workflow IDs and re-reads the first page of its complete Actions workflow
  inventory before selecting the bridge. A changed horizon retries once and
  then stops inconclusive, preventing pagination shifts from hiding another
  historical legacy-status writer. Dedicated regressions cover duplicate IDs,
  page-horizon drift, the >8 MiB aggregate history, and a same-ID
  `run_attempt` change coupled to a later legacy-status failure.
- The subsequent independent Terra/high review found that page-at-a-time
  history reads could accidentally turn the existing 60-second per-`gh`
  process timeout into an unbounded whole-scan duration: each page could first
  wait for an API slot and then receive a new 60-second child-process budget.
  Every complete retained-producer or bridge scan now starts one monotonic
  60-second deadline. That same absolute deadline is passed to each unfiltered
  page read; the API-slot wait and the `gh` child both recompute and consume
  only its remaining time. A page returned at or after the deadline is
  inconclusive even if it is the final page. This bounds a scan without
  claiming an atomic GitHub snapshot or changing the separate `D0 -> S0 -> D1
  -> S1` evidence semantics.
- The scan also rejects histories beyond its fixed 100,000-entry / 1,000-page
  hard resource boundary before it stores their compact execution identities.
  These are source-handoff memory/request bounds, deliberately distinct from
  consumer reconcile limit profiles. Tests cover a virtual-clock final-page
  overrun, the real `gh` child inheriting the remaining deadline, and immediate
  fail-closed rejection of an oversized declared inventory.

### Execution Update — 2026-09-21

- Source PR `#56` merged as
  `fd3a5e351017a2ea5a46ed5bc7a26af3b510f999`. Under the owner-approved
  per-repository legacy-inventory digests, all ten active cohort repositories
  now have a canonical `Must Pass Codex Review v2` repository ruleset in
  Disabled enforcement, with a full canonical readback. The inherited v1
  requirements and the old organization ruleset are unchanged.
- The first retrospective-history canary, `codex-session-retrospective-history#9`,
  was closed unmerged because its root `CANARY.md` violates that repository's
  retained-artifact validator. Its remote branch was deleted only after the
  closed PR and exact branch object ID were verified. Replacement canary `#10`
  is open and non-draft at feature head
  `022df4b432745d6d2ca409615a473a370ad09517`, against default-branch base
  `53c9a16545147be15c8a5330c5397304a3edb332` and test merge
  `c28d2b507b94408013ee84ee8cdccb00d0c1920e`.
- That replacement has one exact direct `@codex review` request, a current
  Codex terminal-clean comment, a successful native v2 CheckRun from GitHub
  Actions integration `15368`, and a successful legacy v1
  `codex/review-gate` status. The legacy bridge's `ubuntu-slim` job waited in
  the hosted-runner queue for about ten minutes before it ran; the wait was
  scheduling delay rather than billable execution and did not change the
  selected runner policy.
- A read-only activation preview for `#10` made no ruleset write, but exposed a
  source helper/API-shape mismatch: `GET /repos/{owner}/{repo}/actions/runs/{id}`
  returned the embedded `pull_requests[0].head.repo` and `.base.repo` as
  minimal `{id,name,url}` references without `full_name`. The helper had
  required that unavailable field and therefore rejected valid live canary
  evidence.
- The correction keeps the identity boundary fail closed: the previously bound
  repository ID from `GET /repos/$REPO` is now required on the top-level
  Actions-run repository objects and on both embedded head/base repository
  references. It does not treat a missing `full_name` as an empty or matching
  value. Tests use the observed minimal REST shape and reject missing or
  mismatched top-level IDs plus mismatched embedded head/base repository IDs.
  The four installation guides record this contract so future implementations
  do not reintroduce the full-name assumption.
- Organization activation remains blocked until this source correction is
  reviewed and merged, its read-only preview succeeds for open canary `#10`,
  and the other nine active repositories obtain their own current-base,
  dual-protection canary evidence.

### Execution Update — 2026-09-21 (continued)

- Source PR `#57` merged as
  `b39418241c4f38aee88bcfd8c8173cb6da4697f0`, correcting the observed
  minimal embedded repository shape without weakening the ID identity binding.
  All ten active repositories subsequently supplied the required current-head,
  dual-protection canary evidence; their repository-level v2 rulesets are
  Active.
- A first organization-level read-only `plan` then succeeded with legacy rule
  `16590367` still at its exact before snapshot. Source PR `#58` merged as
  `19247a26686e97efc53530e08a75ce72ca5c6727`, making the organization-selector
  comparison tolerate GitHub's readback-only numeric ordering while retaining
  selector membership and multiplicity exactly.
- The reviewed stage preview (`plan_sha256`
  `cddce84189dd7b187c58bb22e4be495782ddc17270b29a75c76673c80142fefc`) was
  then applied and created organization ruleset `23787657`,
  `Must Pass Codex Review v2`, in
  Disabled enforcement. The POST payload was bound to exactly the ten active
  repository IDs, has no bypass actor, and requires only
  `codex/github-review-gate` from GitHub Actions integration `15368` with
  strict up-to-date policy. The old v1 organization rule was not modified.
- The following `activate` preview made no write and stopped at the repository
  cleanup readback boundary. Live `GET /repos/{owner}/{repo}/rulesets/{id}`
  responses for all eight legacy cleanup surfaces retain the exact same rules,
  checks, and parameters as their frozen snapshots, but reorder both the
  top-level `rules` collection and the unique required-status rule's
  `required_status_checks` collection. The manifest continues to retain its
  owner-reviewed write order.
- The pending source correction therefore compares only those two observed
  readback collections as full-element multisets for repository cleanup
  classification. It neither deduplicates nor normalizes any other field or
  array; rule/check addition, removal, replacement, repetition, context
  spelling, parameter, or integration-ID drift remains fail closed. Manifest
  validation, plan digests, and every mutation payload retain their original
  exact ordering. Disabled organization rule `23787657` must remain Disabled
  until this correction is merged and a fresh activation preview succeeds.

### Execution Update — 2026-09-22

- Source PR `#59` merged as
  `83eaf9166302e8b50df47628ab3d5ad8ad0ba91b`, completing the narrow
  repository-ruleset readback ordering correction. The organization v2
  ruleset `23787657` remains Disabled; no activation, cleanup, old-rule
  cutover, or bridge removal was performed by that correction.
- Live measurement of the retained verifier history in
  `Joey-Tools/codex-private-workflows` found 2,133 executions across 22
  unfiltered `per_page=100&page=N` pages. Two independent full inventories
  completed in 72.946 seconds and 76.608 seconds. The prior uniform 60-second
  scan deadline would therefore reject a healthy private repository before
  the organization activation proof could begin.
- The manifest now uses schema `v3` so that the new authority and capacity
  boundary cannot be silently omitted from an older reviewed `v2` manifest.
  It binds a per-repository legacy-writer scan timeout (300 seconds only for
  the measured private history; 60 seconds elsewhere), a 900-second bounded
  `D0 -> S0 -> D1 -> S1` legacy-evidence stabilization window, and separate
  1,200-second repository-evidence, 120-second scheduler-snapshot, and
  120-second organization-evidence phase budgets. The activation preflight and
  both scheduler snapshots surrounding drain each independently use the
  snapshot bound. A successful round is bounded by the explicit topology
  `2,100 + 2 * 120 + max(120, ceil(10 / 2) * 1,200) = 8,340` seconds: scheduler
  drain and its two snapshots complete first, then organization evidence runs
  in parallel with five two-repository waves. The reviewed 9,000-second round
  cap retains 660 seconds of intentional slack; the 18,005-second stable pair
  is two rounds plus the five-second read interval. The round/pair limits are
  capacity bounds, not a wall-clock budget for the complete `activate --apply`
  operation: preview and post-write readback establish a stable pair, while
  immediate revalidation is deliberately limited to one round. The published
  output/receipt wire format remains `output/v2` / receipt schema `2`, whose
  manifest digest binds the reviewed v3 input.
- A fresh formal GPT-5.6 Terra review found that the earlier 7,200-second
  calculation treated complete repository and organization control-plane reads
  as an unproven 600-second margin. It also lacked bounded workflow-inventory
  admission, so it could not prove a whole-round upper bound under a growing
  control plane. The correction gives each scheduler snapshot, repository
  evidence read, and organization evidence read its own enforced deadline, and
  limits workflow YAML inventory, Actions workflow inventory, and local
  repository ruleset inventory to 32 entries each. Exceeding a cap fails closed;
  this deliberately does not claim a hard upper bound on paginated HTTP request
  count, because the phase deadline is the wall-clock bound. The correction
  prevents an unbounded scan from holding the scheduler `disabled_manually` or
  allowing repeated scheduler execution drift to undermine the stable epoch
  proof.
- The deployment manifest may raise reviewed soft limits only within 1,800
  seconds per repository, 300 seconds per scheduler snapshot, 600 seconds for
  organization evidence, 15,000 seconds per round, and 30,005 seconds per
  stable pair. Any raised configuration must continue to satisfy the topology
  formula; these are reviewed manifest fields rather than ad hoc CLI inputs.
- The parallel evidence boundary now has an explicit convergence contract.
  Scheduler evidence completes first; organization evidence and repository
  evidence then run concurrently. If either branch fails, the helper preserves
  the first observed failure as the returned error, but waits for the sibling
  branch and every repository worker already started in that phase to finish
  before returning it. This deliberately may delay an early organization error
  until the remaining bounded repository phase expires or completes. It is a
  fail-closed trade-off: returning early would let stale pagination or
  repository scans continue issuing API work while the caller starts a later
  stable-read retry, and would let asynchronous work survive into test cleanup.
  The convergence wait establishes that the prior round has no remaining
  started reader before recovery or another stable read may begin.
- A follow-up Terra review made the first-failure boundary inside the bounded
  repository mapper explicit. Waiting for that mapper's aggregate promise to
  reject is too late: a same-wave worker can still be draining when a later
  organization failure arrives, incorrectly replacing the earlier repository
  failure. The mapper now reports its first caught worker error to the shared
  converger immediately, stops acquiring further repository items, and still
  waits for every already-started worker and the sibling organization branch
  before returning that original error. Regression coverage makes repository
  worker 0 fail first, delays worker 1's completion, and delays the
  organization failure until later; it requires the repository error to win,
  proves worker 1 settled before return, and proves the failed round emitted no
  mutation. This preserves both diagnostic causality and the no-overlapping-
  scans recovery boundary.
- A pre-commit audit found that applying only the two-round pair deadline
  would still let either constituent round consume the whole pair. The helper
  therefore applies `coverage_round_timeout_ms` independently to each round
  inside the pair as well as to immediate revalidation, with the pair deadline
  retained as the outer cap. Together with the phase-local deadlines, this
  preserves the stated scheduler/drain and parallel-evidence capacity boundary,
  avoids unnecessarily extending the `disabled_manually` interval, and fails
  closed before a second round starts when the first round exceeds its own cap.
- The measured private repository has one separately bound workflow,
  `Scheduled Private Overlay Sync Release` (Actions workflow `281807666`,
  `.github/workflows/scheduled-sync-release.yml`). It schedules overlay-sync
  PR work; that work can cause the verifier or temporary bridge to create a
  new execution while the activation reader is proving their terminal epochs.
  The handoff therefore uses the explicit, preview-first sequence
  `quiesce-scheduler -> activate -> restore-scheduler`. Quiesce changes only
  that exact manifest-bound workflow to `disabled_manually`, waits normally
  for already-started runs rather than cancelling them, and proves a stable
  complete unfiltered scheduler epoch before activation starts a fresh
  coverage read. It never disables either the v2 verifier or the legacy
  bridge.
- Scheduler drain has a separately bound 2,100-second budget (the workflow's
  30-minute job limit plus room for normal completion). An interruption or
  failure intentionally leaves `disabled_manually` visible rather than
  guessing at an enable. The operator receives an explicit recovery code and
  must use a fresh preview of `restore-scheduler` after inspecting whether the
  interrupted activation reached dual enforcement. The first activation
  scheduler preflight and every scheduler state snapshot are independently
  subject to the 120-second snapshot cap, so even a transient preflight read
  failure reports the reconcile path instead of bypassing recovery guidance.
  There is no durable operation ledger: GitHub state plus a fresh complete
  readback remains the recovery authority.

### Review Follow-up — 2026-09-22

- Current-head review found two post-activation correctness gaps. First, the
  reviewed maximum 15,000-second coverage round could not coexist with the
  former 30,000-second stable-pair maximum, despite the required formula of
  two rounds plus the five-second interval. The validated pair maximum is now
  30,005 seconds, so the documented and enforceable capacity range agrees.
- Second, post-activation `derive-cutover`, `apply-repository-cleanup`, and
  `verify` had retained the scheduler source descriptor but had not required a
  fresh live Actions state of `active`. Each stable post-activation snapshot
  now contains that exact scheduler identity/source/state and rejects
  `disabled_manually` with
  `recovery_code=activation-scheduler-restore-required`. This makes a skipped
  or failed restore a proved fail-closed boundary before later legacy cleanup
  or old-rule cutover, rather than an operator convention. Immediate
  revalidation also compares this state before a mutation, and final
  `verify --apply` rereads the same scheduler identity/source/state as
  `active` directly before its legacy-ruleset `PUT`.
- Regression coverage exercises all three blocked modes, the live workflow
  reread, no-write behavior, active-state fixture requirements, scheduler
  drift after the stable pair, and the jointly valid capacity endpoints.
  `npm run check`, the complete organization-handoff test suite, `git diff
  --check`, and project-journal validation passed for this correction.

## Failure And Recovery Boundary

The following is the original fail-closed execution contract. The 2026-09-23
Execution Update and Current State above take precedence for the already
completed organization cutover: the final stable readers became inconclusive,
then Joey explicitly authorized the narrow exact API recovery recorded there.
That exception did not weaken the policy payload, alter the frozen cohort, or
authorize any bridge removal. All future mutations still require their own
fresh preview/readback and applicable freeze; this historical contract is not
evidence that a prior freeze remains in force.

- Any changed selector, active or legacy-only repository identity/default
  branch/archive state, workflow bytes, bridge bytes, complete workflow
  inventory, Actions default token permission, repository policy, canary
  evidence, old-rule fingerprint, or incomplete API response is inconclusive
  and prevents the next mutation. The legacy selector must be exactly the
  ordered active 10 IDs plus its one manifest-bound archived-only ID, rather
  than an arbitrary 11-member set. The workflow
  inventory admits only the three canonical files and rejects any extra v1/v2
  caller, related writer, nested workflow tree, symlink, submodule, or other
  non-regular entry; default workflow permission must be `read`.
- Ordinary non-activation cohort snapshots consist of two complete reads
  separated by five seconds and retain the 60-second bound. Activation uses
  three manifest-bound scopes instead: one complete legacy-writer inventory
  may take the repository's 60- or 300-second budget; `D0 -> S0 -> D1 -> S1`
  may retry known run/pagination/epoch instability for at most 900 seconds.
  Each complete repository evidence read has a 1,200-second cap; each
  scheduler snapshot (including activation preflight) and organization evidence
  read has a 120-second cap. One full activation coverage round has a
  9,000-second manifest-bound cap over the explicit 8,340-second topology:
  2,100 seconds of scheduler drain, two 120-second snapshots, then the maximum
  of a 120-second organization read and five 1,200-second two-repository
  waves. Its two-read stable pair has 18,005 seconds; immediate pre-write
  revalidation receives only the one-round cap. Workflow YAML, Actions workflow,
  and local ruleset inventories each admit at most 32 entries; an excess is
  fail closed, while phase deadlines—not a claimed fixed pagination page
  count—bound their wall-clock read. A changed fingerprint restarts the
  relevant pair, but malformed responses, unknown run states, policy/identity
  mismatch, and a bad legacy status remain immediate fail-closed errors. These
  scopes are not the total wall-clock allowance for preview, revalidation, and
  post-write readback. The comparisons protect selected policy/evidence
  content, not benign transport metadata.
- Before activation, the manifest-bound private overlay scheduler must be
  explicitly quiesced and read back as `disabled_manually`; its complete
  unfiltered run inventory must reach two equal terminal epochs. No `status`,
  `head_sha`, `event`, `created`, or other run filter is used, because
  independently timed filtered lists cannot prove one atomic drained epoch.
  The tool never cancels an already-started scheduler run. A quiesce or
  activation failure leaves the scheduler disabled for explicit operator
  reconciliation; `restore-scheduler` is a separate preview/apply action and
  never writes the organization v2 rule.
- Activation requires the live open/non-draft canary evidence through its
  post-write dual-enforcement readback. Once that readback succeeds, later
  derive/cleanup/verify snapshots deliberately omit the closed canary
  lifecycle and do not require the default-branch head to remain at the
  historical canary base. They reread the live default branch and retain the
  current repository identity, complete regular-blob workflow inventory,
  canonical workflow/CODEOWNERS bytes, default-read Actions policy including
  an explicit boolean `can_approve_pull_request_reviews`, bridge, v2 rulesets,
  and cleanup-state closure.
- Every post-activation/cutover stable snapshot also rereads the one
  manifest-bound scheduler and requires its live Actions workflow state to be
  `active`. This makes scheduler restoration a proved precondition rather than
  a procedural convention: a skipped or failed restore cannot leave the
  scheduler `disabled_manually` while later derive/cleanup/verify operations
  remove legacy protection or issue final closure. A disabled scheduler returns
  `recovery_code=activation-scheduler-restore-required`; the operator runs a
  fresh `restore-scheduler` preview/apply, confirms its active readback, and
  starts a fresh blocked post-activation preview. The stable snapshot includes
  this exact workflow identity/source/state, so revalidation also rejects an
  observed transition back to disabled before a later mutation. Final
  `verify --apply` rereads that same scheduler identity/source/state as
  `active` immediately before sending its legacy-ruleset `PUT`.
- Each post-activation/cutover stable snapshot separately binds the
  manifest-declared archived-only repository from live GitHub metadata:
  `full_name`, `id`, `node_id`, `default_branch`, and `archived: true` must all
  match. That observation preserves the old rule's non-status protections for
  the archive; it never adds the archive to v2 coverage or final receipt
  membership.
- The operator holds an external organization-admin policy-mutation freeze
  from stage preview through apply, readback, and any recovery. A second
  organization/repository-admin freeze covers activation preview through its
  stable post-write readback. A third begins before repository-cleanup preview
  and remains continuous through cleanup apply/readback, final-cutover
  preview/apply, and a separate final read-only verify receipt capture and
  validation. During that third interval no cohort repository may be renamed,
  transferred, deleted, have its default branch changed, or be replaced or
  re-created at its original slug, no ruleset, classic branch-protection,
  condition, required-check, or bypass-actor mutation is allowed, and the
  restored manifest-bound scheduler must not be separately disabled. This is
  an operational freeze, not a continuous lock. The helper checks exact
  manifest-bound repository identity/default branch and bypass lists; it does
  not automatically discover an actor added outside the snapshot.
- Before the old organization-rule `PUT`, the helper repeats the complete
  cohort revalidation and then rereads both the old rule's writable identity
  and the archived-only repository, plus the restored scheduler's exact
  identity/source/`active` state, directly adjacent to the write. GitHub's
  ruleset update endpoint has no conditional compare-and-swap contract. Plan
  digests and readback detect observed drift, but cannot prevent or reconstruct
  an external update overwritten in the final GET-to-PUT interval. A missing,
  mismatched, no-longer-archived, or non-active scheduler observation blocks
  the `PUT`.
- Schema-2 final-closure receipt admission validates the manifest-derived
  `manifest_repositories` and stable observed `repositories` as independent
  canonical 10-member identity lists, then requires exact equality before the
  consumer uses only the former to authorize a bridge removal. Either list
  rejects the current archived legacy-only repository by slug, ID, or node ID;
  a receipt that alters both lists and refreshes its digest still fails before
  any local consumer mutation. Schema 1 remains readable and digest-valid only
  as historical evidence and returns no bridge-removal authorization.
- A potentially successful but unacknowledged stage POST is never replayed.
  The apply path first attempts one read-only reconciliation and may return
  `applied-recovered`; interrupted or still-unknown outcomes use the explicit
  read-only `stage --recover-created-v2` path. It can bind only one unique
  same-name candidate whose source and complete writable state exactly match
  the canonical Disabled v2 payload while the old rule remains at its
  before-state; absent, multiple, Active, or drifted candidates stop. The
  recovery read requires an external organization-admin policy-mutation freeze.
- Repository cleanup accepts a stable before/after mixture and plans only
  still-before items. Each action binds exact repository identity/default
  branch before every surface read and immediately before a needed mutation;
  each mutation is also preceded by exact-before validation and followed by
  exact-after readback. An error or unknown write result triggers an immediate
  narrow read-only reconciliation: exact after is complete, while before,
  identity or policy drift, or an unreadable result stops the batch for a fresh
  reviewed preview. It never blindly replays the old request or digest. GitHub
  exposes no repository-ID conditional/CAS mutation, so the operational freeze
  covers the final metadata-read-to-write gap.
- The third freeze may end only after the complete final read-only verify JSON
  and its canonical receipt digest are captured. An inconclusive final read,
  bound-policy drift, or a known policy mutation before bridge-removal
  preparation leaves every bridge installed. Recovery is to restore the
  manifest-bound closure and mint a fresh final read-only receipt under a new
  freeze; neither the `verify --apply` response nor a known-stale receipt may be
  substituted.
- A partial activation remains fail closed: the old v1 rule stays active and
  the new v2 rule is not used as evidence to remove v1. The transaction does
  not automatically delete or weaken either rule.
- The organization handoff manifest is evidence for a bounded API transaction,
  not a durable decision ledger. GitHub remains the authority; each recovery
  reruns the full readback before continuing.

## Execution Update — 2026-09-23

- Source PR `#60`, `Bound organization handoff evidence capacity`, merged as
  `75e4fa865b42ef542b0d5fef98bb117e4dee99aa`. It made the per-repository
  legacy-writer capacity and scheduler-quiescence topology explicit.
- The manifest-bound scheduler
  `Joey-Tools/codex-private-workflows` workflow `281807666` was quiesced with
  plan digest `13c8eff0100d25df862cf8ca14beee8595998e499bd872af50006edc35c7d1c9`.
  Its drain readback covered 557 terminal executions over six pages and left
  the workflow `disabled_manually`.
- An activation preview then completed for all 10 active repositories with
  plan digest `21bac5593ea35a7c47d105d31f15f880ba4326b10a248285ab163028ce3eee27`.
  A later apply attempt stopped at its immediate revalidation and reported no
  mutation; a direct follow-up read nevertheless found organization v2 already
  Active. Under Joey's explicit switch-first direction, the rollout accepted
  that observed dual-protection state rather than continuing a provenance
  investigation. The scheduler was restored through the exact
  `restore-scheduler` plan
  `6a41324ee0d05d8a7109e6b916db6e9b8651ec47334c8b91e7ed40fc7fdfdd4e` and
  read back Active.
- The normal post-restore cleanup and final-verify stable readers each became
  inconclusive at their 60-second two-snapshot boundary. The cleanup executor
  had already performed its per-item exact mutation/readback work; a direct
  follow-up GET confirmed all eight repository-local legacy rulesets were in
  their expected-after state: only `test` remained required, while
  `deletion` and `non_fast_forward` stayed Active.
- Under the same explicit direction, the final organization cutover used a
  narrow exact API recovery: GET the old ruleset, compare its complete writable
  policy to the manifest's expected-before state, remove only its required
  status rule, PUT, then require both the response and a second GET to equal
  the expected-after state. The comparison normalizes only GitHub's numeric
  ordering of organization repository selector IDs, matching the helper's
  existing organization-ruleset comparison; every other policy field remains
  exact. The result payload digest was
  `cd027a58a8042cef30496bc91310ba0d6ac30047a2172d399b1a2cd315fb3350` and
  preserved exactly `deletion` and `non_fast_forward`.
- Final direct readback confirmed: v2 organization rule Active with only
  `codex/github-review-gate`; old organization rule Active with no required
  status rule and only `deletion`/`non_fast_forward`; scheduler Active; and all
  eight affected repository rulesets requiring only `test`. This direct
  cutover scope did not include or mutate the source repository's independent
  local ruleset `16410326`, which remains a temporary v1 self-gate until a
  dedicated source bootstrap supplies its v2 replacement.

## Execution Update — 2026-09-23 (source bootstrap)

- `Joey-Tools/codex-review-gate` now carries the canonical v2 verifier and
  controller, the exact temporary v1 bridge, and canonical workflow
  CODEOWNERS ownership. The source `State Machine CI` keeps its required
  `Review gate state machine` check name while using a static non-reserved
  prefix, so bootstrap admission cannot mistake it for the v2 CheckRun.
- This change deliberately does not mutate source repository ruleset
  `16410326`: it continues to require legacy `codex/review-gate` while the
  bridge preserves that producer. A separately authorized source policy stage
  must create and activate a status-only v2 rule, then remove only the legacy
  status rule from `16410326`, retaining its other protections.
- The explicit remote-only `--ruleset-profile status-only` is reserved in the
  helper for this exact source repository; all ordinary consumers retain the
  default `full` profile and importable template. Its selected rule is exactly
  one strict, GitHub-Actions-bound `codex/github-review-gate` check with no
  bypass actors or other rules. The profile treats GitHub's
  `do_not_enforce_on_create: false` readback default as canonical and refuses
  to repair any extra rule, context, bypass actor, or branch-condition drift.
- The existing read-only cleanup derivation and verification are profile-aware
  for this narrow source rule. Their derived state removes only
  `codex/review-gate` from the old rule and compares every remaining security
  field across stable snapshots, so deletion, non-fast-forward, and
  pull-request/CODEOWNERS protections cannot be silently lost.
- The source controller admits only an exact Codex-bot `issue_comment`
  `created` event before allocating a runner. An edited comment cannot restart
  reconciliation automatically; operators use protected manual `reconcile`,
  and base-retarget recovery remains draft-to-ready followed by a fresh
  verifier. This implements the final event-cost and race boundary without
  weakening the comment-author/sender checks.
- The source-only profile treats an omitted API
  `do_not_enforce_on_create` field as the documented `false` default only for
  its otherwise exact status-only shape. Every create, update, activation, and
  cleanup comparison uses that same semantic normalization; `true`, extra
  rules/contexts, bypass actors, or branch-condition drift still fail closed.
- Remote `status-only` now requires `--legacy-bridge` at CLI admission while
  the source-local v1 requirement exists. It cannot stage a v2 replacement
  after an unobserved bridge deletion and strand the old required status with
  no writer. The source self-install test also inventories every
  `.github/workflows/` file and rejects an additional v1/v2 caller, status
  writer, or reserved v2 CheckRun producer.
- The source is not in the fixed active organization cohort. Its later bridge
  removal requires a source-local closure proof; the organization schema-2
  receipt cannot authorize it.

## Next Steps

1. Keep the temporary legacy bridges installed. Before any active-cohort
   bridge-removal PR, obtain a fresh applicable policy-mutation freeze and
   repair or extend the post-activation stable-reader path enough to mint the
   canonical schema-2 final read-only closure receipt against the now-cut-over
   state. That receipt cannot authorize a source-local bridge outside the
   frozen cohort.
2. Treat the cohort v1 status transition as complete: do not restore
   `codex/review-gate` in the old organization rule or on any fixed active
   cohort repository. The old organization ruleset intentionally remains Active
   only for deletion and non-fast-forward protection, including the archived
   legacy-only repository.
3. Stage and activate a status-only v2 rule for `Joey-Tools/codex-review-gate`,
   verify its source-local canary, then remove only the independent source
   ruleset `16410326` v1 status requirement while preserving its non-status
   protections. This source-local exception is outside the frozen 10-member
   cohort and must not be used to expand the organization closure receipt or
   bridge-removal scope.
4. If a durable provenance record is needed, investigate the observed v2
   activation separately; it is not required for the currently verified policy
   state and was intentionally deferred by the switch-first decision.

## Evidence

- Stable release: `https://github.com/JoeyTeng/codex-review-gate-action/releases/tag/v2.0.1`
- Old organization ruleset: `Joey-Tools` ruleset `16590367`, read through
  `GET /orgs/Joey-Tools/rulesets/16590367` on 2026-09-18.
- Prior v2 decisions and implementation ledger:
  `docs/project_journal/2026/08/2026-08-25-action-v2-grilling-plan-019ff4f8.md`.
- Current delivery validation: after the current-head review follow-up,
  `npm run check` passed and the complete
  `test/organization-review-gate-handoff.test.mjs` suite completed
  successfully. Earlier dedicated v2 workflow-contract and workflow-security
  validation remain recorded above. `git diff --check` and project-journal
  validation passed after this checkpoint was updated.
