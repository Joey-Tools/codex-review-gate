# Project TODO

- [pending] Finish and validate the confirmed v2 runtime, installation, and
  publisher infrastructure change without a live release intent.
- [pending] After infrastructure merges, submit a separate reviewed
  `v2.0.0-rc.N` release-intent change and complete the real-consumer RC gate.
- [pending] Prove target branch/tag rulesets, Environment approval, publisher App scope and GPG verification through read-back preflight.
- [pending] Publish a usable stable `v2.0.0`, machine-reconcile the immutable
  Release and floating `v2`, manually publish the major's first stable version
  to Marketplace out of band, then canary selected consumer installations.
- [deferred] Revisit temporary dispatch limit overrides, richer release-canary
  orchestration, Marketplace automation, and recovery automation beyond the
  required six-state partial-publication reconcile after v2.0 production
  evidence exists.
