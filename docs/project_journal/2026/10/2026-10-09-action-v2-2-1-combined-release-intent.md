---
id: 20261009-action-v221-combined-release-intent
title: Action v2.2.1 Combined Release Intent
status: active
created: 2026-10-09
updated: 2026-10-09
branch: codex/release-v2.2.1-combined
pr:
supersedes:
  - 20261009-action-v221-release-intent
superseded_by:
---

# Action v2.2.1 Combined Release Intent

## Decision and Scope

- Keep v2.2.1 as the selected version: `packages/action/package.json` already
  contains `2.2.1` and is unchanged. The exact immutable `v2.2.1` tag query was
  empty and the exact target release GET returned 404. Target `master` and the
  floating `v2` alias still resolve to `e1a097027698316ef4e35c0e2acea05de6c61fbf`
  (v2.2.0), so `previous_version: 2.2.0` remains correct and the version has
  not been consumed.
- This combined payload includes PR #113's User-authored canonical `@codex`
  marker recovery and actionable unblock guidance, plus PR #115's closed
  inline-parent official-disclosure compatibility. Source commit
  `880f99a1c02f10c2e5424cf361975dc35b2086e0` includes the merged #115 change
  (merged at 2026-10-09 20:20:41Z).
- The prior frozen source from PR #114 at `56a6769` does not include #115. Its
  publisher run `37981458822` is not a candidate for this combined payload.
  Before cancellation, `Publish signed release` was `waiting` with `steps=[]`;
  although the provider returned a `started_at` value, that is not evidence a
  privileged step ran. The cancellation API returned success, and a later GET
  reported `completed/cancelled`.
- Node 24, `src/v2/gate-runtime.mjs`, manifest schema 4, the v2.2 contract ABI,
  contract versions, target repository/ref, and signer identity remain
  unchanged. The release uses the existing staged publisher for
  `JoeyTeng/codex-review-gate-action`; its privileged stage still requires a
  human to approve the `marketplace-production` Environment.
- This intent does not include a manual Marketplace patch operation or a
  consumer workflow rollout. Publisher controls, workflows, signing, and
  release policy are unchanged.

## Frozen Baselines

- Target `master` was verified at
  `e1a097027698316ef4e35c0e2acea05de6c61fbf`; v2.2.0 remains the previous
  published release. The target remains
  `JoeyTeng/codex-review-gate-action` / `refs/heads/master`.
- The `packages/action` tree at source HEAD `880f99a1c02f10c2e5424cf361975dc35b2086e0`
  is `f574490db68b7db0af15c64d5b2fbae45fb16b47`, containing 18 regular files
  and 931,749 bytes. `release-manifest.json` records the bytewise-sorted path,
  type, Git mode, blob size, and SHA-256 for every file, derived from the exact
  Git blobs rather than a filesystem walk.
- Manifest schema 4 and contract versions remain
  `node24` / release schema 4 / status 2 / template 2 / baseline 3. The signer
  and all target fields, including `previous_version: 2.2.0`, are preserved.

## Validation

- Node v24.15.0 `npm run check` passed. All three release-contract tests
  passed: schema-v2 deterministic manifest, schema-v3 v2.1 Node 24/alias, and
  v2.2 schema-v4 optional-token coverage; no skips or failures were reported.
- The #115 parser/runtime repair passed 700 regression cases and 8 focused
  tests before landing. Those results do not establish production publication
  of the combined payload.
- The release inventory was derived from the current Git tree and exact blob
  bytes. Independent validation matched all 18 records and confirmed that
  other release controls were unchanged; project-journal validation passed.
  Exact committed-head planning, independent candidate comparison, assembly,
  and source binding are release-PR and staged-publisher gates; their receipts
  belong to those executions rather than a self-referential journal commit.
- One historical review wrapper `5473252139` was observed parsing
  `before=false` and `after=true`. That single observation is not full
  production validation; no claim is made that production PR #87 passes.
- Production publication, signed v2.2.1 release provenance, and the floating
  v2 alias remain unverified until the protected publisher runs after human
  Environment approval.

## Next Steps

- Use the exact combined intent and its admitted publisher run; do not reuse
  the superseded frozen PR #114 source or its cancelled run.
- After the required `marketplace-production` Environment approval, use the
  existing staged publisher for this exact intent and verify the target head,
  immutable release tag, provenance, and floating v2 alias.
- No Marketplace patch operation or consumer workflow rollout is part of this
  release intent.

## Evidence

- [Source PR #113](https://github.com/Joey-Tools/codex-review-gate/pull/113)
  and [source PR #115](https://github.com/Joey-Tools/codex-review-gate/pull/115)
  contain the combined runtime changes.
- [Superseded v2.2.1 intent](2026-10-09-action-v2-2-1-release-intent.md).
- [Published v2.2.0 predecessor](https://github.com/JoeyTeng/codex-review-gate-action/releases/tag/v2.2.0).
- Release contract and protected publication flow: `docs/RELEASING.md`.
- Combined release intent and frozen payload: `release-manifest.json`.
