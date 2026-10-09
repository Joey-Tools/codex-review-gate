---
id: 20261009-action-v221-release-intent
title: Action v2.2.1 Release Intent
status: active
created: 2026-10-09
updated: 2026-10-09
branch: codex/release-v2.2.1
pr:
supersedes: []
superseded_by:
---

# Action v2.2.1 Release Intent

## Decision and Scope

- Source PR [#113](https://github.com/Joey-Tools/codex-review-gate/pull/113)
  landed as `58f5c7d241502d918bb3440f08c4ae5f36a837ac` after review of frozen
  source head `7e5855e`; all 21 source checks passed. This separate release
  intent selects that payload for v2.2.1 publication; it does not publish it.
- v2.2.1 fixes current-head recovery for a User-authored canonical review
  request marker. The marker is only an ordinary request candidate when its
  repository ID, PR number, head SHA, base SHA, base ref, and base repository
  ID match the current PR. It does not grant workflow authority or replace
  provider confirmation. Findings and unresolved full-PR review threads remain
  independent blockers, and gating output now keeps actionable unblock steps
  prominent while preserving detailed diagnostics.
- The Action remains Node 24 with `src/v2/gate-runtime.mjs`. Manifest schema 4
  and the append-only `codex-review-gate-action-v2.2-contract-v1` ABI remain
  unchanged, including the optional `review_request_token` input. The v2.0
  and v2.1 input inventories and historical release contracts stay frozen.
- Publication continues through the existing staged publisher to
  `JoeyTeng/codex-review-gate-action`. Its privileged stage remains gated by
  human approval of the `marketplace-production` Environment. Publisher
  controls, signing identity, permissions, and workflows are unchanged.
- No consumer update or production success is implied by this release intent.

## Frozen Baselines

- Target `master` was verified at
  `e1a097027698316ef4e35c0e2acea05de6c61fbf`; the previous published version is
  v2.2.0. Its immutable target release was published by the Publisher bot, and
  its signed tag resolves to that commit with a valid verified signature. The
  target repository/ref remain
  `JoeyTeng/codex-review-gate-action` / `refs/heads/master`.
- The post-bump `packages/action` Git tree is
  `5bc8e96f45d0fa709a53f1035e09e350b52c74cf`, containing 18 regular files and
  931,584 bytes. `release-manifest.json` records their bytewise-sorted paths,
  modes, sizes, and SHA-256 digests from Git blobs.
- Manifest schema 4 selects the v2.2 contract. Node 24 remains unchanged, as
  do status/template/baseline contract versions 2/2/3. The source repository
  and path, target repository/ref, and signer identity remain unchanged.

## Validation

- The release inventory was generated from the staged Git index tree and each
  payload blob, not from a filesystem walk. Only
  `packages/action/package.json` was staged to form that tree.
- Node v24.15.0 `npm run check` and the three focused v2.2 contract tests in
  `test/v2-release-pipeline.test.mjs` passed. The manifest tree and all 18
  inventory records were independently re-read from Git blobs and matched;
  project-journal validation passed. These checks do not replace
  committed-head planning and independent candidate materialization, and do
  not prove production publication.
- Production publication, signed v2.2.1 release provenance, and the floating
  v2 alias remain unverified until the protected publisher runs after
  Environment approval.

## Next Steps

- After this intent lands on protected source `master`, use the existing staged
  publisher for v2.2.1 after a human approves the `marketplace-production`
  Environment; verify the target head, immutable release tag, provenance, and
  floating v2 alias.
- After publication, existing `@v2` consumers receive the new runtime on their
  next run; no consumer workflow rollout is part of this release intent.

## Evidence

- [Source implementation PR #113](https://github.com/Joey-Tools/codex-review-gate/pull/113).
- [Published v2.2.0 predecessor](https://github.com/JoeyTeng/codex-review-gate-action/releases/tag/v2.2.0).
- Release contract and protected publication flow: `docs/RELEASING.md`.
- Release intent and frozen payload: `release-manifest.json`.
