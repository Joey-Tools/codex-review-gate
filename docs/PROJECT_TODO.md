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
- [ ] Create the signed source commit and delivery PR after validation and
  review pass.
- [ ] Deliver the merged source change, then continue the separately authorized
  10-repository dual-protection rollout and one-way v1 cutover.

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
