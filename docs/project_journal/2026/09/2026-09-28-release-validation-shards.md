---
id: 20260928-release-validation-shards
title: Release Source Validation Shard Repair
status: active
created: 2026-09-28
updated: 2026-09-28
branch: wip/release-validation-shards
pr:
supersedes: []
superseded_by:
---

# Release Source Validation Shard Repair

## Summary

- The admitted `v2.1.1` source release run `36387695551` reached candidate
  validation successfully, then its single `core` source-validation cell hit
  the existing fourteen-minute job ceiling while running the full serial test
  discovery command. No test assertion, release-plan, signing, or publisher
  identity check failed.
- This repair changes only the release workflow's test scheduling. It restores
  the same bounded bootstrap, core, and release test partition already used by
  normal CI, rather than extending the timeout or dropping coverage.

## Adopted Change

- `source-validation` now has nine matrix cells: four bootstrap shards, one
  explicit core inventory, and four release-pipeline shards.
- The bootstrap and release adapters retain their existing four-way,
  mutually-exclusive registrations. The core cell runs the closed twelve-file
  inventory plus `npm run check`; it does not rediscover bootstrap or release
  suites serially.
- The release-pipeline contract test freezes the nine-cell matrix, commands,
  environment binding, and the absence of broad `npm test` discovery in the
  core cell. Thus a future edit cannot silently reintroduce the timeout-prone
  duplication.

## Recovery Boundary

- This control-only repair does not alter the frozen `v2.1.1` source intent,
  its release manifest, candidate payload, or original push admission. Once
  landed, the publisher workflow must be dispatched with the exact persisted
  admission for source commit `28ca4b54d6d41d86ca8105ab2b26261d2f2fa2fa` and
  run `36387695551`, attempt `1`.
- The dispatch remains subject to the workflow's existing live-control and
  immutable-admission validation; it cannot publish an arbitrary source.

## Next Steps

- Validate the repair, review and merge it, then dispatch the frozen `v2.1.1`
  admission through the normal privileged publication stage.
