---
id: 20261018-action-v226-release-intent
title: Action v2.2.6 Release Intent
status: completed
created: 2026-10-18
updated: 2026-10-18
branch: codex/release-v2.2.6
pr: https://github.com/Joey-Tools/codex-review-gate/pull/130
supersedes: []
superseded_by:
---

# Action v2.2.6 Release Intent

## Decision And Scope

- Select stable Action version `2.2.6`, following `2.2.5`, for the separately
  reviewed native inline-parent compatibility fix. Source PR
  [#129](https://github.com/Joey-Tools/codex-review-gate/pull/129) landed through
  normal exact-head squash merge as source `master` commit
  `728aa663b6ee5941616201333ba8c1ada77061c2`. Its full tree
  `c6347ee58642c0143ade57ca4c3198be1a7aeaf5` equals the reviewed head
  `02a98ac541d0fde323423e192b0e1c1be011094c`, and its only parent is
  `c4445c33fccfe8b2047e5c58064bef39eb0c2ce7`.
- The fix accepts the narrow known receipt with harmless separator whitespace
  and no duplicate body SHA only after an actual envelope is removed and the
  native submitted review supplies a full commit SHA. An enabled compatibility
  option alone is not authority. Explicit body/native SHA disagreement,
  unsupported payload, legacy defaults and unresolved-thread blocking retain
  their previous boundaries.
- The reproduced PR #128 failure was a historical receipt compatibility gap,
  not proof of a newly announced provider protocol. This release does not
  suppress arbitrary malformed artifacts or grant authority to controller
  summaries. The exact sample, reason and regression boundaries are recorded
  in the [source compatibility journal](2026-10-18-native-inline-parent-compat.md).
- Freeze target `JoeyTeng/codex-review-gate-action` / `refs/heads/master` at
  `be15152cf66c38f15129a899de25fbc4faf46c0e`, the peeled `v2.2.5` commit, with
  `previous_version: 2.2.5`. Authenticated preparation confirmed the target,
  published stable predecessor Release `415417242`, and absent `v2.2.6` tag.
  Schema 4, the v2.2 release contract, Node 24 entrypoint, contract versions,
  complete signer identity and all publisher controls remain unchanged.
- This intent changes only the Action package version, root release manifest
  and this journal. The complete post-bump Git-blob inventory is frozen before
  commit; publisher workflow/scripts/control tests are not changed. Source
  implementation and privileged release intent remain separate deliveries.

## Validation

- Source PR #129 passed all 1,198 local CI-core-inventory tests, syntax,
  canonical workflow lint and journal checks, plus complete exact-range secret
  admission without a local reviewer. Current-head official Codex clean, typed
  resolved conversation state and all 21 GitHub checks were stable before
  ordinary merge. Its one diagnostic verifier refresh followed actual thread
  resolution; no duplicate review request or bypass was used.
- The independent post-bump Git-blob inventory equals the manifest in full:
  Action tree `136704975a48f5b3f498034b8998d82d5d1229dd`, 18 regular files and
  952,242 bytes. Only the README, package version and core parser inventory
  entries differ from the published predecessor; all other manifest controls
  match the admitted source baseline. The publisher's real manifest validator
  also accepts the frozen schema-4 intent.
- On Node `v24.15.0`, all three selected schema-v2/v3/v4 release-pipeline contract
  tests passed, including the v2.2 optional-request-token contract. These are
  local fixture tests, not a production publication. `npm run check`, project
  journal validation and whitespace validation passed.
  Source-fix validation is not production publication evidence.

## Published Result

- Release-intent PR #130 landed normally as source commit
  `98a0ab4cfc3cc27b2046deefd6aa00e7017bb7be`; its normal manifest push started
  [publisher run 39110105204](https://github.com/Joey-Tools/codex-review-gate/actions/runs/39110105204),
  attempt 1. Human approval released the protected job. No duplicate initial
  dispatch, publication rerun, agent approval call or bypass was used.
- Immutable [Release v2.2.6](https://github.com/JoeyTeng/codex-review-gate-action/releases/tag/v2.2.6)
  is `416350861`. Release commit `c1d5fc87c73beef9882add0294cb582b54003fbd`
  contains the frozen Action tree and has the admitted `v2.2.5` target as its
  only parent. Full tag object `619df711a1267b09fa56cc9405cc7ad6a1df75c8`
  and floating `v2` object `54f179149d32c260647ace6cc4b3fae14da65fcb` both
  peel to that commit; all three GitHub signatures are verified and valid.
- The separate credential-free
  [public verifier job](https://github.com/Joey-Tools/codex-review-gate/actions/runs/39110105204/job/117639465127)
  verified asset/provenance bytes and OpenPGP signatures, completing with
  `verification_state=verified`, `verification_stage=complete`,
  `recovery_code=none`, `next_action=none`, the exact source SHA above and
  `observed_tag=v2.2.6`. Parent read-back independently corroborated target
  refs/tree/parent, signatures, immutable Release identity and its three assets.
- Publication is complete. Installer PR #128 uses this separately published
  runtime; its readiness workstream still does not authorize merging #128 or
  changing HDR/protection configuration.

## Evidence

- [Source fix PR #129](https://github.com/Joey-Tools/codex-review-gate/pull/129).
- [Current-head source clean](https://github.com/Joey-Tools/codex-review-gate/pull/129#issuecomment-6247057892).
- [Verified source gate](https://github.com/Joey-Tools/codex-review-gate/actions/runs/39106994268).
- [Published predecessor v2.2.5](https://github.com/JoeyTeng/codex-review-gate-action/releases/tag/v2.2.5).
- [Canonical release contract](../../../RELEASING.md).
