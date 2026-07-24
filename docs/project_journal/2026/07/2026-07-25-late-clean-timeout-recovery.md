---
id: 20260725-late-clean-timeout-recovery
title: Late Clean Result After Marker Wait Closure
status: completed
created: 2026-07-25
updated: 2026-07-25
branch: wip/codex-review-gate-v1.3.3-late-clean
pr:
supersedes: []
superseded_by:
---

# Late Clean Result After Marker Wait Closure

## Summary
- Complete current review evidence is reconciled before marker wait deadlines.
- A stable authorised clean result is no longer overridden by a historical or newly reached wait timeout.
- A clean result observed after `missed_ack`, `stalled`, or `timed_out` may use the original trusted marker lineage without creating another review request.
- Optional clean taglines use closed benign stems with bounded punctuation variation, exact shortcodes, or bounded RGI emoji presentation.

## Current State
- Both package manifests identify the patch as v1.3.3.
- Closed-wait recovery requires the latest same-head historical marker to match the exact trusted live marker and requires a provider transition newer than the marker baseline and creation time.
- Historical wait outcomes remain audit records. `failed_findings`, `state_lost`, and `obsolete_head` are not accepted through this recovery path.
- Unresolved findings on a recoverable closed-wait lineage persist an exact `failed_findings` descendant before failure. Recovery-disabled and ordinary failed-findings event and close-time rules then apply; `fresh` records the exact rejected closed-wait clean and cutoff before any later replay.
- Timeout records preserve their source outcome so a `failed_findings` lineage cannot bypass its recovery switch, event, or cutoff requirements.
- A fresh head with unresolved findings still creates its controlled marker before recording canonical `failed_findings`; resolving the thread can then continue through the ordinary provider signal path without a manual dispatch.
- Final validation reloads the complete evidence snapshot and revalidates the same authorisation kind before writing success.
- The exact clean lead, provider identity, unique reviewed-commit marker, official disclosure, and finding-signal priority remain evidence boundaries. A same-line tagline is presentation only: known stems accept one final `.`, `!`, or `?`, exact observed shortcodes remain supported, and one to eight exact RGI emoji graphemes may be used without prose. Unknown prose fails closed and cannot supply clean or finding evidence.

## Evidence
- Hagemony workflow run `30112606266` loaded action commit `11d400902175edd773340dc9ec00f8dd421feff7`, selected the official current-head clean comment, but wrote `Timed out waiting for Codex review signal` before reconciliation.
- The affected head is `3722827ead17cab8bfe97763b87674acc5806570`; official clean issue comment `5072022127` is newer than its trusted request marker and binds the reviewed short SHA to that exact head.
- Bootstrap PR #23 added the exact observed `Keep them coming!` variant to the trusted v1.3.2 finite grammar and was squash-merged as `2a3c65bf2c99c055cce78f2459a3feccd526384b`; its synchronized action subtree is `f2b53c53145bff3a43baf6f53388dba2feea937c`.
- The final v1.3.3 worktree passes `npm run check`, the complete `npm test -- --test-reporter=dot` suite, `git diff --check`, and project-journal validation.
- The structural tagline update passes focused `core` and `gate-runner` tests, `npm run check`, and `git diff --check`; the gate-runner clean fixture uses the supported punctuation variant `Keep them coming!`.
- The closed-wait findings-lineage regressions cover recovery-disabled and normal-timestamp `head`/`fresh` behavior: both modes retain the ordinary close-time block, while `fresh` also records the exact triggering clean and rejection cutoff. The 31-test focused gate slice, `npm run check`, `git diff --check`, and project-journal validation pass with Node v24.15.0 and npm 11.12.1.
