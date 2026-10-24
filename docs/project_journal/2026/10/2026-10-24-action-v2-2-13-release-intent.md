---
id: 20261024-action-v2213-release-intent
title: Action v2.2.13 Head-Bound Clean Release Intent
status: completed
created: 2026-10-24
updated: 2026-10-24
branch: wip/release-v2-2-13
pr:
supersedes: []
superseded_by:
---

# Action v2.2.13 Head-Bound Clean Release Intent

## Decision And Scope

- Prepare stable Action `2.2.13` from normally merged source
  `9b304959e290a665e1d2f17a3950effa46e617bb`, including
  [head-bound clean and non-skipping verifier PR #146](https://github.com/Joey-Tools/codex-review-gate/pull/146).
  The squash tree equals the reviewed head's tree and has a valid GitHub
  signature. Current-head Codex clean, all 21 remote checks, complete
  conversations and stable final rereads passed before normal exact-head merge.
- Prefer trustworthy exact-head clean independently of request/controller
  attribution or a newly created verifier's time. Preserve the actual latest
  retarget epoch, provider PENDING/edit-history safety, non-inline findings,
  provenance and legacy request-bound evidence. Request-only history receives
  the current-head recovery path without changing pending/failure verdicts.
- Inline conversation enforcement belongs to the required native GitHub rule;
  Action thread counts are unknown rather than an invented verified zero.
  Current bilingual documentation records that installation prerequisite.
- Floating `@v2` gains runtime changes only after verified publication. The
  fixed always-executed six-event verifier requires canonical consumer YAML
  refresh; updating the alias cannot rewrite installed workflows. Consumer
  mutation and the bounded diskplan PR33 canary are separate follow-up work.
- Freeze `JoeyTeng/codex-review-gate-action` / `refs/heads/master` at the
  independently verified v2.2.12 wrapper
  `09893298a72fc1d42ee8b8904ff0e68ab2f428ef`, with `previous_version: 2.2.12`.
  Exact target-master/floating-ref/latest-stable reads agree and the v2.2.13
  tag is absent. This is not an inventory proving inaccessible drafts absent;
  the publisher's complete remote-state reconcile remains authoritative.
- Change only package version, generated manifest and this journal. Preserve
  schema 4, v2.2 input policy, Node 24, signer, publisher controls, protection
  and mandatory human production approval. No formal local review is required.

## Validation

- Generate the payload inventory from an immutable package-version-only staged
  root: Action tree `089880d41ddf1030959a40f4fad42b7576316221`, 18 regular files,
  1,007,687 bytes. Independent Git-blob size/mode/SHA-256 validation and unchanged
  release-control/package-version-only comparisons pass.
- Node.js 24.15.0: the complete 15-file core set passes 1310/1310. Five
  historical/current release-contract cases pass separately, covering frozen
  Node 20, Node 24 and the v2.2 optional input policy: 1315 distinct local
  tests, zero failures, cancellations or skips. `npm run check` passes. This
  does not claim a complete local bootstrap or full release-suite run.
- The release intent still requires its own current-head remote Codex review,
  complete CI, policy/conversation evidence and final stable reread.

## Publication Boundary

- The protected-master manifest push is the sole initial publisher trigger;
  do not duplicate it with dispatch or retry an ambiguous mutation.
- Keep human `marketplace-production` approval. Independently verify immutable
  Release metadata/assets, exact-source archive, provenance, pinned signatures
  and signed floating `v2` before declaring the new runtime available.
- No privileged publisher execution, production publication, consumer update,
  protection change or live canary is claimed by this release intent.

## Next Steps

- None within the completed release-intent preparation. Normal reviewed merge,
  the original push-triggered publisher, human production approval and
  independent publication verification retain their separate gates.

## Evidence

- [Implementation decisions and validation](2026-10-24-head-bound-clean-verifier.md).
- [Canonical publication contract](../../../RELEASING.md).
