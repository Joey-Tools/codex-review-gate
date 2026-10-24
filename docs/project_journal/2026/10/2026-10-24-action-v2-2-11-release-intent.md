---
id: 20261024-action-v2211-release-intent
title: Action v2.2.11 Native Stacked PR Release Intent
status: completed
created: 2026-10-24
updated: 2026-10-24
branch: wip/release-v2-2-11-native-stacks
pr:
supersedes: []
superseded_by:
---

# Action v2.2.11 Native Stacked PR Release Intent

## Decision And Scope

- Prepare stable Action `2.2.11` from normally merged source master
  `df8314f748031975d0b190e91f63cd2b395b1967`, including
  [native stack support PR #142](https://github.com/Joey-Tools/codex-review-gate/pull/142).
  The squash tree matches the exact reviewed head, with the previous master
  as its sole parent. Current-head trustworthy clean, all 21 remote checks,
  complete conversations and a byte-identical final scope reread passed before
  normal exact-head squash merge. No bypass or formal local review was used.
- Support ordinary default-base PRs and authenticated GitHub-native stacks
  whose trunk is the repository default branch. Keep each layer's head,
  direct base, test merge and review evidence independent. Manual feature-base
  chains, other trunks and forks remain unsupported.
- Existing `@v2` consumers gain runtime support after publication. Immediate
  native stack-join wake-up also requires refreshing the canonical verifier
  workflow to include `stacked`; exact older four-event installed workflows
  remain supported. No consumer rollout or live native-stack canary is claimed.
- Freeze target `JoeyTeng/codex-review-gate-action` / `refs/heads/master` at
  `16832f53d550df22d4747f23160b94c9959b1fbb`, the independently verified
  previous `v2.2.10` wrapper, with `previous_version: 2.2.10`. Complete visible
  preparation inventories covered 47 tags and 41 Releases. A fresh scoped
  reread confirmed the unchanged target head and signed floating `v2` object,
  no `v2.2.11` tag and no visible matching Release. This read-only identity
  cannot prove absence of an inaccessible draft; privileged publisher
  preflight remains authoritative.
- Change only package version, release manifest and this journal. Preserve
  schema 4, the v2.2 contract, Node 24 entrypoint, signer, publisher controls,
  target ref, protection and mandatory production approval.

## Validation

- Regenerate the immutable Git-blob inventory from the normally merged source
  plus only the package-version update: Action tree
  `4097c90039ec8c12804a8f441ccaa6b6d413c341`, 18 regular files and 991,792 bytes.
  Do not copy old payload digests or an unverified target parent forward.
- Node.js 24.15.0: the complete actual CI core file set passed 1,305/1,305 tests
  with four isolated file workers. Five separate historical/current release
  contracts passed, including frozen Node 20, Node 24 and v2.2 input policies;
  1,310 distinct tests passed, with zero failures, cancellations or skips.
  `npm run check` passed. This does not claim complete local bootstrap or
  privileged publisher execution.
- Require the release intent's own current-head remote GitHub Codex review,
  complete CI, policy/conversation evidence and final stable reread. Local
  validation and the merged feature do not prove publication or consumer use.

## Publication Boundary

- This release intent is separate from publication. Its protected-master
  manifest push is the sole initial publisher trigger; do not duplicate it
  with dispatch or retry an ambiguous mutation.
- Keep human `marketplace-production` approval. Independently verify immutable
  Release metadata, assets, provenance, pinned signatures, signed floating `v2`
  and a byte-identical exact-source archive rebuild before reporting available.
- Do not alter old immutable releases or tags, consumer repositories,
  protection, runtime contracts or publisher control code in this intent.

## Evidence

- [Native stack design and implementation](2026-10-24-stacked-pr-support.md).
- [Canonical publication contract](../../../RELEASING.md).
