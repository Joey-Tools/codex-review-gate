# Project TODO

## Current Organization Handoff Delivery

- [x] Complete the P1 receipt-binding repair and regression tests: a schema-2
  receipt's manifest-derived active list and stable observed list are
  canonically identical, and the current archived legacy-only repository is
  rejected from both lists by slug, ID, and node ID. Source validation passed:
  `npm run check`, bootstrap suite 119/119, and organization suite 136/136.
- [x] Update the manifest README, human/agent installation guides, project
  state, and handoff journal with the active-10 / legacy-selector-11 split,
  receipt-binding contract, archive boundary, and schema-1 audit-only
  compatibility.
- [x] Complete the frozen handoff-validation bundle: `npm run check`, bootstrap
  suite 119/119, organization suite 136/136, CI-equivalent release-pipeline
  shards `1/4` through `4/4`, `git diff --check`, and project journal
  validation have passed. The unsharded `npm test` attempt was bounded and is
  deliberately not treated as a passing result.
- [x] Complete a fresh final GPT-5.6 Terra review at high thinking on that
  frozen diff: it returned no actionable findings.
- [x] Create the signed source commit and delivery PR after validation and
  review pass: signed commit `53c49bf` is the head of source PR #56.
- [x] Add manifest-v3 bounded legacy-writer evidence and the explicit private
  overlay scheduler quiesce/activate/restore lifecycle, including recovery
  guidance, explicit per-phase capacity limits, and bounded inventory
  admission. This remains a source-helper hardening; it performs no
  organization-policy mutation by itself.
- [x] Apply the reviewed v3 phase-capacity contract and complete the
  quiesce-scheduler -> activate -> restore-scheduler cutover. The old
  organization rule no longer requires `codex/review-gate`, and all eight
  repository-local legacy cleanup surfaces in the fixed active 10-member cohort
  now require only `test`; the scheduler is Active again.
- [x] Merge the source-only plan-bound cleanup executor, derive and separately
  approve a fresh source-local plan, and remove only the v1
  `codex/review-gate` status rule from independent local ruleset `16410326`.
  Source status-only v2 ruleset `23927388` remains Active; exact readback and
  the two-round closure passed while preserving the bridge and every non-status
  protection. This source-local exception did not expand organization receipt
  or bridge-removal scope.
- [ ] Mint the canonical schema-2 final read-only closure receipt for the
  already-cut-over fixed active 10-member cohort with a credential that
  discloses explicit bypass arrays for every manifest-bound ruleset, then use
  it to authorize separate cohort temporary-bridge removal work. Keep every
  cohort bridge installed until the receipt exists and validates. This does not
  reopen the completed, separately authorized source-local bridge removal.
- [x] Complete the separate source-only bridge-removal flow for
  `Joey-Tools/codex-review-gate`: proof machinery landed first, then the merged
  default-branch helper derived the live source closure for historical Node 24
  canary `#74`. Its exact receipt SHA-256
  `d7c3faee465b6af7325252fe70c2462be6c9e908885c976055e8d608ccb2c963`
  received independent approval and was live-rebound before every local mutation
  boundary. The separate bridge-delete PR removes only the canonical source
  bridge; it does not alter rulesets, ordinary consumer templates, cohort scope,
  or the ability to rerun historical Actions runs. Do not rerun this completed
  source-only lifecycle against the current source default branch.

## Later

- [ ] Manually publish the first stable v2 major to GitHub Marketplace when the
  listing is ready; the immutable release and floating `v2` alias are already
  available to consumers.
- [ ] Revisit temporary dispatch limit overrides, richer release-canary
  orchestration, Marketplace automation, and recovery automation beyond the
  required six-state partial-publication reconcile after v2.0 production
  evidence exists. Any automatic recovery for a pre-existing immutable tag
  with no visible Release must use a separately reviewed target-side one-shot
  attempt marker; a reusable dispatch boolean is not sufficient.
