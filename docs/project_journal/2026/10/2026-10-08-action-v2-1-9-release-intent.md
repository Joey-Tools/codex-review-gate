---
id: 20261008-action-v219-release-intent
title: Action v2.1.9 Release Intent
status: active
created: 2026-10-08
updated: 2026-10-08
branch: codex/release-v2.1.9
pr:
supersedes: []
superseded_by:
---

# Action v2.1.9 Release Intent

## Decision and Scope

- Joey requested a separate release PR after source
  [PR #109](https://github.com/Joey-Tools/codex-review-gate/pull/109) landed as
  `51c7ecb83304ba5a6d1c65b2efee1fafafc555d7`. The release intent changes only
  the package version, frozen manifest and this journal. Publisher controls,
  signing identity, Environment approval, permissions and runtime contracts
  are unchanged.
- v2.1.9 carries structured top-level clean-comment disclosure parsing and
  safe CLI/Actions Summary diagnostics. Supported official old/new footer
  blocks no longer require whole-footer byte equality. Unknown prose,
  invalid structures, actual findings and unresolved threads remain
  non-success. Provider identity, exact-head/request binding and the shared
  inline-parent grammar are preserved. Reasons and design are recorded in
  [the structured-disclosure journal](2026-10-08-structured-clean-disclosure.md).
- Use remote GitHub Codex review only. Joey will perform the exceptional source
  squash merge if the old published gate rejects a genuine current-head clean
  because of the footer this release fixes. The exception does not waive
  findings, replace provider review or introduce a persistent bypass rule.
- After protected source landing, use the existing staged publisher to
  `JoeyTeng/codex-review-gate-action`. Only its privileged stage receives
  production credentials following Environment approval. A release intent is
  not evidence that publication has completed.

## Frozen Baselines

- Publication `master`, stable `v2`, and immutable `v2.1.8` were observed
  resolving to `299c0fde3cdd921e8d756f792edc056afb0f2ec9`.
- Stable predecessor v2.1.8 is published, not draft or prerelease. Unexpected
  remote drift must be investigated rather than silently adopted.
- Frozen `packages/action` tree:
  `56db591dee48beba4ed73ba76e0e5dc52f99e7f2`; complete inventory has 18 regular
  files and 914,298 bytes. Two independent regenerations from staged Git
  tree/blob objects produced identical manifests. The final committed source
  must preserve this tree.
- Manifest schema 3, the v2.1 release contract, Node 24 Action runtime, GPG
  signer policy and floating-major alias policy are unchanged.

## Validation

- The existing manifest reader accepts the frozen v2.1.9 manifest and complete
  inventory. The source fix's actual PR #109 clean carrier is rejected by the
  old parser but accepted intact by the new parser; all 20 source CI checks
  other than the old required gate completed successfully before source merge.
- Node v24.15.0: core and complete v2 Action/runtime/workflow tests passed
  449/449 without skips or cancellations. `npm run check`, journal validation
  and whitespace checks passed. Committed-head planning and two-candidate
  materialization must pass before PR readiness.
- The existing source CI and publisher validation matrix remain independent
  gates; local candidate verification is not publication.

## Next Steps

- Complete release-intent validation and current-head remote review.
- Publish through the existing staged workflow following source landing and
  approval; verify immutable v2.1.9, target master and floating v2.
- Fresh `@v2` runs receive the new runtime after publication. Existing failed
  checks are not automatically rewritten; the original PR #215 may require
  its existing explicitly authorized recovery operation.

## Evidence

- [Source fix](https://github.com/Joey-Tools/codex-review-gate/pull/109).
- [Current-head clean](https://github.com/Joey-Tools/codex-review-gate/pull/109#issuecomment-6060212786).
- [Predecessor release](https://github.com/JoeyTeng/codex-review-gate-action/releases/tag/v2.1.8).
- Publication contract: `docs/RELEASING.md`; intent: `release-manifest.json`.
