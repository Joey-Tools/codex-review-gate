---
id: 20260725-7b31a2-compare-schema-bootstrap
title: GitHub Compare Schema Bootstrap
status: completed
created: 2026-07-25
updated: 2026-07-25
branch: wip/codex-review-gate-compare-schema-bootstrap
pr:
supersedes: []
superseded_by:
---

# GitHub Compare Schema Bootstrap

## Summary
- The REST 2022-11-28 commit-comparison schema does not document `head_commit`, so requiring that field made valid live responses fail closed.
- Ancestry validation now binds the exact 40-hex `base...head` request, validates the documented response fields and counts, validates every unpaginated commit-list entry before binding the final entry to the requested head, and applies a closed `ahead` / `identical` / `behind` / `diverged` relationship matrix.
- Undocumented `head_commit` data is ignored and no extra head-commit request is introduced.

## Current State
- Compare fixtures use documented counts and `commits` arrays without depending on `head_commit`.
- Runner regressions cover live-shaped valid `ahead`, valid non-ancestor `behind` and `diverged`, plus deterministic schema, count, commit-entry, terminal-head, merge-base, and relationship contradictions.
- English and Chinese action README and design documents record the fail-closed contract, and the complete local validation set passes.

## Next Steps
- None for this completed implementation slice.

## Evidence
- Frozen implementation base: `2a3c65bf2c99c055cce78f2459a3feccd526384b`.
- Node.js `v24.15.0` and npm `11.12.1` supplied the local validation runtime.
- Live REST comparisons over asymmetric divergent histories returned `diverged` for `ahead_by / behind_by` pairs `3 / 6`, `3 / 2`, and `2 / 1`; count magnitude did not reclassify either direction as `ahead` or `behind`.
- `npm run check` passed.
- Focused gate-runner compare and ancestry tests passed.
- `npm test -- --test-reporter=dot` passed the full 313-test suite.
- `git diff --check` and the bundled project-journal validator passed.
