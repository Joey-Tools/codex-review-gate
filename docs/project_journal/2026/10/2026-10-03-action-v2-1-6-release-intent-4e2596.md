---
id: 20261003-action-v216-4e2596
title: Action v2.1.6 Release Intent
status: active
created: 2026-10-03
updated: 2026-10-03
branch: codex/release-v2.1.6
pr:
supersedes: []
superseded_by:
---

# Action v2.1.6 Release Intent

## Summary

- Select the next stable Action release, v2.1.6, from the source state after
  merged successor PR #99. This release-intent change alters no publisher
  controls or consumer workflows.

## Current State

- The action package version and release manifest select v2.1.6, with target
  predecessor v2.1.5 at action commit
  `732faa96188bdb93c94556f32d1b041707b748a6`.
- The manifest binds staged Action subtree `b6f8c7927d222792015fd7e002d7fa069ea79e3c`
  and its complete 18-file inventory. The bounded derivation helper generated
  this inventory from Git tree/blob objects; its candidate matches the source
  manifest byte-for-byte.
- Publication and public readback are not complete yet.

## Next Steps

- After the release-intent change reaches the source default branch, let the
  release workflow validate the exact source/control commit and bind the
  actual default-branch push `before` SHA.
- JoeyTeng must approve the existing `marketplace-production` Environment
  before publisher writes.
- Confirm the immutable v2.1.6 release, v2 alias, and published provenance by
  public readback before marking this workstream complete.

## Evidence

- Source baseline: successor PR #99 merge `4e2596e3962cd7820e6965c2d38fecaa7fb490d0`.
- Target baseline: v2.1.5 Action commit
  `732faa96188bdb93c94556f32d1b041707b748a6`.
- Source release manifest: `release-manifest.json`.
