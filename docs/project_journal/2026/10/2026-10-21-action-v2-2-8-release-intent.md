---
id: 20261021-action-v228-release-intent
title: Action v2.2.8 Release Intent And Supersession
status: completed
created: 2026-10-21
updated: 2026-10-21
branch: wip/release-v2-2-8-runtime-recovery
pr:
supersedes: []
superseded_by:
---

# Action v2.2.8 Release Intent And Supersession

## Decision And Reasons

- Publish stable Action `2.2.8` from normally merged source master
  `2997cef6c7787a4e04bb6ada2235eec4f7f058b3`, including guidance PR
  [#133](https://github.com/Joey-Tools/codex-review-gate/pull/133) and runtime
  recovery PR [#135](https://github.com/Joey-Tools/codex-review-gate/pull/135).
  The latter's squash tree equals its reviewed feature tree and has the
  guidance merge as its sole parent.
- Joey authorised a fresh release PR if an empty commit or Update branch
  cannot recover the original intent
  [#134](https://github.com/Joey-Tools/codex-review-gate/pull/134). Published
  v2.2.7 turns its old hashless clean receipt into an unbound scoped error
  before head classification, so changing head does not reliably make that
  error historical. Its scoped-error supersession path does not accept the
  selected current-head attestation. Repeating review requests or pushing an
  empty commit is not a demonstrated recovery for this case.
- This later authority supersedes the earlier instruction to preserve #134
  during the runtime-fix phase. Replace it with one fresh intent and close
  #134 as superseded while preserving its comments, branch and history. Do
  not merge both intents, reuse its stale payload, manufacture a check pass,
  edit/delete provider evidence, or use bypass.
- The new runtime classification is deliberately non-positive: an otherwise
  valid official clean body with a completely missing commit marker remains
  malformed and cannot pass alone. Only a later eligible request and trusted,
  unedited exact-current-head clean can retire this narrow old error through
  the existing recovery witness. Findings, unresolved inline threads, bad or
  duplicate markers, invalid disclosures, edits, chronology, provenance,
  history, base epochs and snapshot-completeness constraints remain intact.
- Freeze target `JoeyTeng/codex-review-gate-action` / `refs/heads/master` at
  `0fddbcaeb54dcf4ab1e0aa47b2d1a39d7edcd1b1`, also the peeled signed
  `v2.2.7` and floating `v2` targets, with `previous_version: 2.2.7`.
  Authenticated preparation on 2026-10-21 confirmed the new `v2.2.8` tag and
  Release are absent and #134 is the only open competing release intent.
- Only the Action package version, release manifest and this journal change.
  Preserve schema 4, the v2.2 release contract, Node 24 entrypoint, signer,
  target ref, publisher controls, workflow permissions and runner selection.
  No HDR, protection, unrelated PR or consumer mutation belongs to this intent.

## Validation

- Independent immutable Git-blob inventory equals the real publisher's
  accepted manifest: Action tree `a70242b9598cf7a722ac75bc26353c9a242dbffb`,
  18 regular files and 969,565 bytes. The runtime payload includes #135;
  #134's old tree `a901e2e2d751b87ba65e8adc727753f13bff8ffa` is not reused.
- Node.js `v24.15.0`: all 360 selected v2 Action/runtime/workflow tests and
  four selected release-pipeline contracts passed, with zero failures,
  cancellations or skips. The latter cover schema-v2/v3/v4 candidates and the
  staged publisher credential ABI. `npm run check` and whitespace validation
  passed. The preceding runtime fix separately passed 852 relevant local
  tests before its normal exact-head merge; that is not a claim that this
  intent reran all 852 or the entire repository locally.
- Use remote-only GitHub Codex review and the intent's own current-head CI;
  no formal local review is part of this delivery. Local manifest and fixture
  validation is not proof of production publication or a deployed gate pass.

## Publication Boundary

- This entry records the completed release intent, not completed publication.
  Its normal protected-master push is the sole initial publisher trigger.
  Do not dispatch a duplicate initial run or retry an ambiguous mutation.
- Retain the existing staged publisher and mandatory human
  `marketplace-production` approval. Do not approve on Joey's behalf or change
  publisher controls to escape review. Independently verify immutable Release
  assets, provenance, signatures and the signed floating `v2` before declaring
  publication complete.

## Evidence

- [Hashless clean recovery and exact timestamp correction](2026-10-20-hashless-clean-recovery.md).
- [Same-PR recovery guidance](2026-10-20-same-pr-recovery-guidance.md).
- [Runtime fix clean receipt](https://github.com/Joey-Tools/codex-review-gate/pull/135#issuecomment-6302554281).
- [Canonical publication contract](../../../RELEASING.md).
