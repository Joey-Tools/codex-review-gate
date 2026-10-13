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
- The release intent landed in source PR
  [#118](https://github.com/Joey-Tools/codex-review-gate/pull/118) as
  `45c5b37c66c99d1e6058df0b3f3648302f98937b`. The original protected master-push
  publisher run `38404550587`, attempt 1, completed all 14 unprivileged jobs,
  then failed after human approval at the live signing-certificate read.
- That fixed public API request was anonymous and returned HTTP 403 through
  all four curl attempts. The log did not retain response headers or body, so
  the exact rejection cause is unproved; rate limiting must not be reported
  as established fact. App token minting, signing-key import, and publication
  were skipped. Target master remained
  `1c15f87ace478865d965a1864743e5f0625e1a9b`; no v2.2.2 matching tag or Release
  existed in the subsequent authenticated reads.
- A separate publisher-control repair authenticates only that fixed public
  certificate GET with the existing read-only job token. The user-GPG endpoint
  supports App installation tokens without additional permissions. The
  expected signing identity, certificate validation, token-minting order,
  approval boundary, release manifest, and complete action payload remain
  unchanged. This repairs transport, not an observed App-key or GPG-signature
  failure.
- Neither source merging nor the control repair asserts that v2.2.2 is
  published or installed; production publication and native consumer
  verification remain pending.
- For the controls-only transport repair, Node `v24.15.0` `npm run check`,
  the focused staged-workflow regression, the pinned-certificate regression,
  all 43 workflow-security-contract tests, extracted-step `bash -n` and
  `shellcheck`, journal validation, and `git diff --check` passed. The new
  workflow assertion failed without step-local authentication before passing
  with it. An independent authenticated public-inventory read also passed
  the unchanged cryptographic certificate validator. No runtime private key
  was imported and none of these local results asserts production success.

## Next Steps

- Recover this original intent with `source_sha=45c5b37c66c99d1e6058df0b3f3648302f98937b`,
  `admission_run_id=38404550587`, and `admission_run_attempt=1`, after the
  independent publisher-control repair reaches protected source master.
  Authenticate the original persisted admission artifact; execute current
  master controls and rematerialize the publication plan and candidates.
  Do not rewrite the manifest baseline, mint a new release intent, rerun stale
  executable controls, or supply an existing-draft selector without a draft.
- Complete the recovery attempt's fresh human Environment approval and verify
  the immutable v2.2.2 tag, Release, assets, provenance, and floating `v2` alias.
- Reconcile BBDown-rust #100 on its then-current frozen scope and inspect the
  native verifier result; do not infer a consumer pass from local tests,
  controller success, or publisher success alone.

## Evidence

- [Source PR #117](https://github.com/Joey-Tools/codex-review-gate/pull/117)
  contains the reviewed and landed provider-failure recovery change.
- [Known provider-failure recovery workstream](2026-10-12-known-provider-failure-recovery.md).
- [Release contract and protected publication flow](../../../RELEASING.md).
- [Original v2.2.2 publisher run](https://github.com/Joey-Tools/codex-review-gate/actions/runs/38404550587).
- [GitHub user GPG-key endpoint](https://docs.github.com/en/rest/users/gpg-keys#list-gpg-keys-for-a-user).
