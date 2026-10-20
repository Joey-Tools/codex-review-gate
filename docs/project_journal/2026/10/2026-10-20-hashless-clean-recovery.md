---
id: 20261020-hashless-clean-recovery
title: Supersede An Earlier Hashless Clean Receipt
status: completed
created: 2026-10-20
updated: 2026-10-20
branch: wip/hashless-clean-recovery
pr:
supersedes: []
superseded_by:
---

# Supersede An Earlier Hashless Clean Receipt

## Evidence And Cause

- Source PR #134's original canonical request was followed by official,
  unedited [receipt 6298097004](https://github.com/Joey-Tools/codex-review-gate/pull/134#issuecomment-6298097004),
  which reports clean but omits its Reviewed commit marker. It cannot attest
  any commit and was correctly non-passing on its own.
- Joey explicitly authorised one fresh logical review round. Existing
  `begin-review` controller run 39478113977 produced exactly one canonical
  [request 6298601972](https://github.com/Joey-Tools/codex-review-gate/pull/134#issuecomment-6298601972)
  at 18:49:48 UTC. Official unedited [clean 6298648788](https://github.com/Joey-Tools/codex-review-gate/pull/134#issuecomment-6298648788)
  followed at 18:51:59 UTC and explicitly names `6f31392eeb`, matching head
  `6f31392eeb54f83d596a1fd92d60ae3b6a8a6716`. Complete observed inventories
  contained no formal reviews or review threads; all 20 ordinary CI checks
  succeeded.
- The automatic [native verifier attempt 4](https://github.com/Joey-Tools/codex-review-gate/actions/runs/39473808375/job/118820677562)
  still reported `healthy/pending/request_clean_generation`, citing the old
  receipt's `reviewed_commit_marker_invalid`. It used published v2.2.7 at
  `0fddbcaeb54dcf4ab1e0aa47b2d1a39d7edcd1b1`.
- The actual `/actions/runs/39473808375` endpoint retains original
  `created_at=2026-10-20T18:20:03Z`; its attempt-4 endpoint instead reports
  `created_at=2026-10-20T18:52:17Z`. Runtime deliberately uses the former, not
  `run_started_at` or the attempt timestamp. Both new request and clean satisfy
  the existing `T < R < C` rule. No time-rule relaxation is needed.
- The old malformed carrier enters the general scoped-error list, whose
  supersession path excludes the selected current-head-attestation clean.
  That leaves an otherwise valid fresh head-bound review unable to retire
  this particular earlier non-clean error.

## Decisions And Reasons

- Joey authorised a separate runtime fix PR and regression tests before
  continuing publication; the already merged guidance-only PR #133 remains
  separate. Do not manufacture a pass, delete/edit old provider comments,
  replace PR #134, or repeat the consumed review operation.
- Give only an otherwise valid official clean body with a completely missing
  commit marker a typed non-positive recovery classification. Check its
  conclusion, optional disclosure and absence of finding signals; a generic
  parse-error reason is insufficient because marker validation precedes
  disclosure validation.
- A later eligible request and independently trusted, unedited exact-current-
  head clean must satisfy the existing recovery witness before that earlier
  error can stop blocking. The old hashless receipt remains malformed, has
  no invented SHA and can never be the success basis.
- Preserve duplicate/invalid marker rejection, unknown or finding-bearing
  content, Bot/App provenance, chronology, edited/deleted history, base epochs,
  liveness, complete pagination, exact refetch and two stable snapshots.
  Unresolved findings and review threads remain independent blockers.
- Keep workflow events, permissions, request identity, runners, output ABI,
  package version and release manifest unchanged in this runtime fix.

## Validation

- Node.js v24.15.0: all 852 tests passed across the core parser, evidence
  budget, legacy runner/receipt, v2 Action/runtime/workflow and workflow
  security-contract suites, with zero failures, cancellations or skips.
  `npm run check` passed. This is a relevant local suite, not a claim that the
  entire repository's test discovery or every CI matrix shard ran locally.
- The focused parser/runtime tests also passed 3/3 after the parent matched
  the real `User` request identity, separate controller run IDs and short-SHA
  resolution, and added explicit bad-chronology and unresolved outdated
  inline-thread controls. They are a subset of the 852, not extra unique tests.
- The worker's earlier core/runtime suite passed 479/479 before those final
  parent fixture refinements. Initial run-ID fixture mismatch, confirmed
  product-red reproduction and one parser-edge failure logs were retained;
  the final relevant suite passed after the corrections.
- The positive fixture retains original run creation at 18:20:03 UTC alongside
  later `run_started_at=18:52:16Z`, proving that the original-run cutoff is
  preserved. Success uses only the later hash-bound clean. Missing witness,
  wrong/ambiguous head, invalid marker/footer/finding content, edits,
  chronology, provenance, deleted history, base epoch and unresolved findings
  or inline threads remain non-passing.
- This source fix uses remote-only GitHub Codex review; no formal local review
  was run. Local mocked regressions do not establish a deployed production
  pass or waive the required native check.

## Next Steps

- Refresh the separate v2.2.8 release intent from the normally merged fix,
  revalidate it, and retain mandatory human production approval.
