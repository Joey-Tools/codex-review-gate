---
id: 20260725-c9498f-clean-tagline-grammar
title: Official Clean Tagline Grammar
status: completed
created: 2026-07-25
updated: 2026-07-25
branch: wip/codex-review-gate-v1.3.2-clean-grammar
pr:
supersedes: []
superseded_by:
---

# Official Clean Tagline Grammar

## Summary
- The v1.3.1 closed clean-result grammar rejected an official current-head Codex clean comment because its provider tagline was not in the exact allowlist.
- The allowlist now includes every exact tagline observed in the authenticated consumer-migration sample while continuing to reject arbitrary prose and near matches.
- PR #22 later produced two authenticated official clean comments with the exact `Keep them coming!` tagline; the trusted default-branch parser rejected both because only `Keep them coming.` was allowlisted.
- Finding-formatted content still takes precedence over the clean lead and remains malformed evidence.

## Current State
- Both package manifests identify the patch as v1.3.2.
- Core parsing tests cover all observed exact taglines, including both `Keep them coming.` and `Keep them coming!`, and a punctuation near miss.
- State-machine fixtures use the live `Another round soon, please!` variant, including reasserting success over stale status history without creating a new review request.
- English and Chinese consumer documentation records the expanded closed grammar.

## Next Steps
- Merge the canonical source PR after the normal review and admission gates.
- Publish the tested action subtree as immutable `v1.3.2`, then move `v1.3` and `v1`.
- Re-run the Hagemony gate against its existing official clean artifact; do not request another review.

## Evidence
- Hagemony workflow run `30109249823` downloaded action commit `ef41b938a6c57a8a1adde44baaabd29eb8ee4df6` and rejected the previously unknown tagline.
- Hagemony official issue comment `5072022127` binds reviewed commit `3722827ead` to current head `3722827ead17cab8bfe97763b87674acc5806570`.
- The migration sample contains 25 authenticated official clean comments and 15 distinct taglines; 11 exact variants were absent from v1.3.1.
- PR #22 contains two authenticated official clean comments whose exact tagline is `Keep them coming!`; the trusted parser rejected both before the candidate parser-policy change could run.
