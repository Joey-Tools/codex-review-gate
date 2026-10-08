---
id: 20261008-action-v220-release-intent
title: Action v2.2.0 Release Intent
status: active
created: 2026-10-08
updated: 2026-10-08
branch: codex/release-v2.2.0
pr:
supersedes: []
superseded_by:
---

# Action v2.2.0 Release Intent

## Decision and Scope

- Source PR [#111](https://github.com/Joey-Tools/codex-review-gate/pull/111)
  landed by squash as `3526cfca40d8347e9a4fdf3970d2860e6084dfed` from source
  head `39187849f95a6719ff3882483427bd6b4d8bd114`; all 21 source checks
  succeeded. This separate release intent selects the new Action input for
  publication; it does not itself publish it.
- v2.2.0 adds the optional `review_request_token` input through the
  append-only `codex-review-gate-action-v2.2-contract-v1` ABI. Node 24 and
  `src/v2/gate-runtime.mjs` remain the entrypoint. The v2.0 and v2.1 input
  inventories and historical release contracts stay frozen. No persistent
  source bypass rule is introduced.
- Joey confirmed that the fine-grained PAT is configured under the
  `CODEX_REVIEW_GATE_REQUEST_TOKEN` organization secret in both Joey-Tools and
  Joey-Project. The secret value was not read, and this configuration does not
  expand the rollout beyond the named pilot.
- Publication continues through the existing staged publisher to
  `JoeyTeng/codex-review-gate-action`. Its privileged stage remains gated by
  human approval of the `marketplace-production` Environment. Publisher
  controls, signing identity, permissions, and workflows are unchanged.
- The consumer pilot remains
  `Joey-Tools/codex-private-workflows`, and begins only after source publication.
  No consumer update or production success is implied by this intent.

## Frozen Baselines

- Target `master` was frozen at
  `06aa4cde5bdc6b2956622ecf9fa6df4f915fb610`; the previous published version is
  v2.1.9. The target repository/ref remain
  `JoeyTeng/codex-review-gate-action` / `refs/heads/master`.
- The post-bump `packages/action` Git tree is
  `4c202c4d60bfdab1d8e623b5459dec9fc3b4a6a9`, containing 18 regular files and
  920,700 bytes. `release-manifest.json` records their bytewise-sorted paths,
  modes, sizes, and SHA-256 digests.
- Manifest schema 4 selects the v2.2 contract. Node 24 remains unchanged, as
  do status/template/baseline contract versions 2/2/3. The source repository
  and path, target repository/ref, and signer identity remain unchanged.

## Validation

- The source release intent is based on the Git tree produced after changing
  only `packages/action/package.json` to 2.2.0; the manifest inventory was
  extracted from those Git blobs rather than a filesystem walk.
- Node v24.15.0 `npm run check`, project-journal validation, and 3/3 focused
  schema-4, historical-contract, and optional-input-policy tests in
  `test/v2-release-pipeline.test.mjs` passed. The manifest inventory was
  re-read from Git blobs and compared with the recorded files. These checks do
  not prove production publication or replace committed-head planning and
  independent candidate materialization required before PR readiness.
- Production publication, signed release provenance, the immutable v2.2.0
  target tag, and the floating v2 alias remain unverified until the protected
  publisher runs after Environment approval.

## Next Steps

- Use the existing protected staged publisher for v2.2.0 after a human approves
  the `marketplace-production` Environment; verify the target head, immutable
  release tag, provenance, and floating v2 alias.
- Only after publication, run the narrow
  `Joey-Tools/codex-private-workflows` pilot. Verify request author identity,
  exact comment binding, clean/finding evidence, and gate behavior before
  considering any further rollout. Do not extend this pilot to Joey-Project.

## Evidence

- [Source implementation PR #111](https://github.com/Joey-Tools/codex-review-gate/pull/111).
- Release contract and protected publication flow: `docs/RELEASING.md`.
- Release intent and frozen payload: `release-manifest.json`.
