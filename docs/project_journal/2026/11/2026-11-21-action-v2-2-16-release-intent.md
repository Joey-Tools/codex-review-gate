---
id: 20261121-action-v2216-release-intent
title: Action v2.2.16 PR Body Reaction Release Intent
status: completed
created: 2026-11-21
updated: 2026-11-21
branch: wip/release-v2-2-16
pr:
supersedes: []
superseded_by:
---

# Action v2.2.16 PR Body Reaction Release Intent

## Decision And Scope

- Prepare stable Action `2.2.16` from
  [normally merged implementation #154](https://github.com/Joey-Tools/codex-review-gate/pull/154)
  at `2574688b9960e6f49a590a2b7bcc19629213860f`. Its tree matches the
  exact reviewed head. Current-head Codex clean, resolved conversation state,
  exact required checks and both Node.js CI matrices passed before squash.
- The verifier can corroborate a completed exact-head Code Review with an
  official PR-body thumbs-up, including after a base retarget when the
  completion is provably later than the retarget. The observed unedited clean
  Security Review receipt is neutral, not positive Code Review evidence.
  Preserve existing pass paths, events, permissions and policy.
- Freeze target `JoeyTeng/codex-review-gate-action` master at
  `4531d128f00a8b8f9ac2a3864623b3b8401df2f6`, independently observed as the
  verified target of both signed `v2.2.15` and signed `v2`. The current fixed
  release is immutable; `v2.2.16` was absent.
- Change only package version, the deterministic release manifest and this
  journal. The release workflow, contracts and human production approval do
  not change.

## Evidence And Publication

- The implementation retains 548 passing scoped tests, including replay of
  the official summary and reaction with the prior clean Security Review receipt.
- The default-branch manifest push is the only initial publisher trigger.
  Keep human `marketplace-production` approval, then independently verify
  the exact-source immutable release, asset/provenance bindings, and signed
  floating `v2`. Existing floating consumers pick up the published version on
  a later workflow execution, not retroactively in completed checks.
