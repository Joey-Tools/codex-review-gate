---
id: 20261115-action-v2215-release-intent
title: Action v2.2.15 Native Review Completion Release Intent
status: completed
created: 2026-11-15
updated: 2026-11-15
branch: wip/release-v2-2-15
pr:
supersedes: []
superseded_by:
---

# Action v2.2.15 Native Review Completion Release Intent

## Decision And Scope

- Prepare stable Action `2.2.15` from normally merged source
  `470d3ffc19411436d9845565c0311309985bb3ae`, including
  [authenticated native completion #151](https://github.com/Joey-Tools/codex-review-gate/pull/151).
  The squash tree equals the reviewed head's tree. Current-head Codex clean,
  all 22 remote checks, the resolved finding and stable final rereads passed
  before the normal exact-head merge, without bypass.
- Reuse completed native Code Review state only after current-head typed
  no-findings and exact carrier/editor authentication. Existing valid clean
  receipts retain priority; native state cannot erase real findings or history
  gaps. Controller adoption posts no additional review request and reruns only
  the protected verifier. Preserve in-flight request adoption and all consumer
  event subscriptions, permissions and public inputs.
- Freeze `JoeyTeng/codex-review-gate-action` / `refs/heads/master` at the
  independently observed v2.2.14 wrapper
  `20bec03fd7d5dc94f257a797859d1f3ed5fafcda`, with `previous_version: 2.2.14`.
  Current master and the locally peeled floating tag agree; the latest stable
  Release is immutable v2.2.14 and the intended v2.2.15 tag is absent. This does
  not establish that inaccessible drafts are absent; the publisher owns
  complete remote-state reconciliation.
- Change only package version, generated manifest and this journal. Preserve
  schema 4, Node 24/v2.2 ABI, signer, publisher controls and mandatory human
  production approval. Use remote-only review.

## Validation

- The staged Action subtree `b053aeb77188bf9e6885c7dec753795e3d4d1fac`
  contains 18 regular files and 1,024,920 bytes. Independent Git-blob
  size/mode/SHA-256 comparison matches the generated manifest. Its owning
  parser accepts the manifest, package metadata changes only its version,
  and release controls/tests remain unchanged.
- Node.js 24.15.0: five historical/current release-contract tests pass with no
  failures, cancellations or skips. `npm run check`, journal validation and
  `git diff --check` pass.
- All 543 related runtime tests passed on the implementation head, including
  the production-sized fullDatabaseId regression requested by independent
  review. This version-only intent does not change that runtime or claim a new
  complete local runtime/bootstrap/Release-suite run. The release PR retains
  its own current-head remote review and full Node.js 20/24 CI gates.

## Publication Boundary

- The protected-master manifest push is the sole initial publisher trigger;
  do not duplicate it with a dispatch or retry an ambiguous mutation.
- Keep human `marketplace-production` approval. Verify the immutable Release,
  exact-source archive, assets/provenance, pinned signatures and floating `v2`
  before declaring the runtime published. This intent makes no publication or
  live consumer-canary claim.
- This remote Action is outside the private overlay's source lock. No local
  skill installation or unrelated private-overlay release is required.

## Evidence

- [Implementation decision and tests](2026-11-15-native-review-completion.md).
- [Canonical publication contract](../../../RELEASING.md).
