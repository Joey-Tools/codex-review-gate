---
id: 20261019-action-v227-release-intent
title: Action v2.2.7 Release Intent
status: completed
created: 2026-10-19
updated: 2026-10-19
branch: wip/release-v2.2.7
pr:
supersedes: []
superseded_by:
---

# Action v2.2.7 Release Intent

## Decision And Scope

- Select stable Action version `2.2.7`, following `2.2.6`, to publish the Linux
  self-hosted runtime correction from source PR
  [#131](https://github.com/Joey-Tools/codex-review-gate/pull/131). Its normal
  exact-head squash merge is source commit
  `04d6fee0b62aa7e58cee8f4c1d19da5b3151cc24`. Its full tree
  `a262812550f658bf44d7d61b0d2a0e5946770e45` equals the reviewed feature head
  `e88b90fce6e6a11ea68fddec64be098947573042`; its only parent is
  `6e88159e44c9888ca58e6a429cb9e571df1481c8`.
- Both verifier and controller accept Linux environments identified as
  `github-hosted` or `self-hosted`. Selecting self-hosted is the operator's
  trust decision, not host attestation or isolation proof. No trust flag,
  allowlist, host-registration lookup or extra runner-specific approval is
  introduced. Windows/macOS, missing or unknown runner environments and all
  other admission/evidence/permission boundaries remain unchanged. Existing
  workflow, environment and repository approvals are not waived.
- Freeze target `JoeyTeng/codex-review-gate-action` / `refs/heads/master` at
  `c1d5fc87c73beef9882add0294cb582b54003fbd`, also the peeled immutable
  `v2.2.6` and floating `v2` target, with `previous_version: 2.2.6`.
  Authenticated preparation confirmed predecessor Release `416350861` is
  immutable, non-draft and stable, and the `v2.2.7` tag and Release are absent.
- This intent changes only the Action package version, root release manifest
  and this journal. Preserve schema 4, the v2.2 release contract, Node 24
  entrypoint, signer identity, target repository/ref and publisher controls.
  The package inventory also carries already-merged installer-scan support and
  security documentation since the prior release; no installer implementation
  is added to the Action payload.

## Validation

- Source PR #131 passed 1,033 unique selected local tests, syntax, journal and
  whitespace checks, signed-commit verification and complete exact-range
  secret admission without a local reviewer. Current-head official Codex clean,
  complete conversation evidence and all 21 Node.js 20/24 GitHub checks were
  stable before normal merge. The automatic controller refreshed the verifier;
  the parent sent no review request, rerun or dispatch, and used no bypass.
- Independent post-bump Git-blob inventory equals the complete manifest:
  Action tree `af839b59181ea52b6acb409ebb3253085fd1e6ba`, 18 regular files and
  959,975 bytes. The two READMEs, two design documents, SECURITY, package
  version and v2 runtime entries differ from the published predecessor; all
  other manifest controls match the source baseline.
- The publisher's real manifest reader accepted this exact schema-4 intent.
  On Node.js `v24.15.0`, all three selected schema-v2/v3/v4 release-pipeline
  contract tests passed without failures, cancellations or skips, including
  the v2.2 optional-request-token ABI. `npm run check`, journal validation and
  whitespace validation passed. Fixture tests and manifest checks are not
  production publication evidence, and no local formal review is part of the
  remote-only route.

## Publication Boundary

- This entry records the completed release intent, not a claim that production
  publication or a live self-hosted run has completed. The reviewed manifest's
  normal protected-master push is the sole initial publisher trigger.
- Use the existing staged source publisher. Human `marketplace-production`
  approval remains mandatory. Do not dispatch a duplicate initial run, approve
  on Joey's behalf, change publisher controls, or blindly retry an ambiguous
  mutation. Independently verify immutable Release assets/provenance/signatures
  and the signed floating `v2` alias before consumer rollout.
- Return to HDR-streaming PR #363's separate exact-head approval, legacy-gate
  and deployment boundaries only after publication; this intent does not
  change its workflows, runner selection or protection.

## Evidence

- [Source runtime fix and detailed validation](2026-10-19-linux-self-hosted-runtime.md).
- [Source clean review](https://github.com/Joey-Tools/codex-review-gate/pull/131#issuecomment-6262549127).
- [Source native verifier](https://github.com/Joey-Tools/codex-review-gate/actions/runs/39219455820).
- [Published predecessor](https://github.com/JoeyTeng/codex-review-gate-action/releases/tag/v2.2.6).
- [Canonical publication contract](../../../RELEASING.md).
