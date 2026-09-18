# Project TODO

- [in_progress] Deliver the reviewed organization cohort handoff support, then
  stage and verify the 11 selected inherited-v1 repositories under dual v1/v2
  protection before the one-way v1 required-status cutover.
- [pending] Manually publish the first stable v2 major to GitHub Marketplace
  when the listing is ready; the immutable release and floating `v2` alias are
  already available to consumers.
- [deferred] Revisit temporary dispatch limit overrides, richer release-canary
  orchestration, Marketplace automation, and recovery automation beyond the
  required six-state partial-publication reconcile after v2.0 production
  evidence exists. Any automatic recovery for a pre-existing immutable tag
  with no visible Release must use a separately reviewed target-side one-shot
  attempt marker; a reusable dispatch boolean is not sufficient.
