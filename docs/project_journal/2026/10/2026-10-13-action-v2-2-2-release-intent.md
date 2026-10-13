---
id: 20261013-action-v222-release-intent
title: Action v2.2.2 Release Intent
status: active
created: 2026-10-13
updated: 2026-10-13
branch: codex/release-v2.2.2
pr:
supersedes: []
superseded_by:
---

# Action v2.2.2 Release Intent

## Summary

- Select the merged, reviewed provider-failure recovery fix for action v2.2.2.
  This is a release-intent change only; it does not publish a tag or Release.

## Decision And Scope

- Source PR [#117](https://github.com/Joey-Tools/codex-review-gate/pull/117)
  landed on protected source `master` as signed commit
  `da69d3adae290ea3096d6da7196c8d25d9007c32`; its tree matches the reviewed
  head `8707337430d94815b1ab01534ebe4252c45d78ae`. The reviewed head had an
  official current-head Codex clean and all 21 checks passed.
- The fix recognizes only the closed, observed official Codex service-failure
  grammar as a distinct non-clean provider-failure artifact. Only a later
  qualifying request and trusted current-head clean, in failure < request <
  clean order and under the existing scope, ordering, and full-snapshot guards,
  can supersede that known failure. Unknown malformed evidence, genuine
  findings, and unresolved review threads remain blocking. The v1 parser
  default, four-output Action ABI, Node 24 runtime, and publisher controls are
  unchanged.
- Select version `2.2.2`, with `previous_version: 2.2.1` and target baseline
  `JoeyTeng/codex-review-gate-action` / `refs/heads/master` at
  `1c15f87ace478865d965a1864743e5f0625e1a9b`. The source manifest schema 4,
  v2.2 contract, Node 24 entrypoint, contract versions, and signer identity
  remain unchanged. No matching v2.2.2 tag or target Release existed when this
  intent was prepared.
- The post-bump `packages/action` tree is
  `037f73e7f8fcfd6fefbfeaa8b4e6c4fc632f5a22`, containing 18 regular files and
  938,028 bytes. The manifest inventory records each bytewise-sorted path,
  Git mode, blob size, and SHA-256 digest from the exact Git blobs.
- The existing staged publisher and its `marketplace-production` Environment
  remain the publication boundary. Human approval of the privileged publish
  job is still required; this intent does not alter publisher workflow,
  scripts, controls, or approval policy.

## Validation

- For the merged source fix, Node `v24.15.0` `npm run check` and the 777
  related source tests passed. These are source-change results, not validation
  of a production publication.
- The release inventory was generated from the staged `packages/action`
  Git subtree and exact blob bytes after staging only
  `packages/action/package.json`; it was not derived from a filesystem walk.
- Independent verification matched all 18 manifest entries and 938,028 bytes
  against exact Git blobs, and confirmed that unrelated manifest/package
  controls are unchanged. The publisher's own `readReleaseManifest` validator
  accepted version 2.2.2, schema 4 and the stated previous-version/target binding.
- Node `v24.15.0`: `npm run check` and all three deterministic release-contract
  tests passed (historical schema-v2, schema-v3 Node24/alias, and current schema-v4
  optional-token coverage). `git diff --check` and project-journal validation
  passed. Exact committed-head planning/candidate comparison is a later
  validation gate and is not self-asserted by this journal commit.
- This release intent does not assert that v2.2.2 has been published or
  installed. The protected publisher has not run for this intent, and native
  consumer verification remains pending.

## Next Steps

- Carry this exact release intent through the reviewed source-master path.
- After the committed intent is admitted by the staged publisher, complete its
  human-approved publish stage and verify the immutable v2.2.2 tag, Release,
  assets, provenance, and floating `v2` alias.
- Reconcile BBDown-rust #100 on its then-current frozen scope and inspect the
  native verifier result; do not infer a consumer pass from local tests,
  controller success, or publisher success alone.

## Evidence

- [Source PR #117](https://github.com/Joey-Tools/codex-review-gate/pull/117)
  contains the reviewed and landed provider-failure recovery change.
- [Known provider-failure recovery workstream](2026-10-12-known-provider-failure-recovery.md).
- [Release contract and protected publication flow](../../../RELEASING.md).
