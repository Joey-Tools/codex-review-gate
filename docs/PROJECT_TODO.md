# Project TODO

- [pending] Merge the separately reviewed stable `v2.0.0` release intent and
  complete its live publisher/App/GPG/ruleset/Environment preflight.
- [pending] Machine-reconcile the immutable stable Release, signatures, and
  floating `v2`; then manually publish the major's first stable version to
  Marketplace and canary selected consumer installations.
- [deferred] Revisit temporary dispatch limit overrides, richer release-canary
  orchestration, Marketplace automation, and recovery automation beyond the
  required six-state partial-publication reconcile after v2.0 production
  evidence exists. Any automatic recovery for a pre-existing immutable tag
  with no visible Release must use a separately reviewed target-side one-shot
  attempt marker; a reusable dispatch boolean is not sufficient.
