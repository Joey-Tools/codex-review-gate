---
id: 20261006-head-attested-clean-recovery
title: Fresh Head-Attested Clean Recovery
status: completed
created: 2026-10-06
updated: 2026-10-06
branch: codex/official-summary-diagnostics
pr: https://github.com/Joey-Tools/codex-review-gate/pull/106
supersedes: []
superseded_by:
---

# Fresh Head-Attested Clean Recovery

## Decision and Reason

- On PRs without a base epoch, an eligible fresh request `R` followed by a
  trusted unedited top-level official clean comment `C` may recover the gate
  when `C` uniquely resolves to the selected current head. Full and
  unambiguous short SHAs are accepted. The head attestation answers which
  commit was reviewed; proving which old request caused that result is not
  necessary for this recovery.
- Keep the original verifier run's GitHub-server `created_at` cutoff `T`,
  fixed across retries, and require strict `T < R < C`. `R` must be the latest
  physical request boundary before `C`; a newer request or relevant later
  provider activity still prevents success. Do not substitute commit dates
  or add timing APIs. A recovery request posted now for an existing verifier
  naturally satisfies the run-cutoff requirement.
- Do not restrict this recovery by historical request count, ordinary versus
  canonical predecessors, or predecessor attribution gaps. Do not require an
  older request's official `eyes` to acquire its own closing `+1` before the
  later exact-head clean can pass. Keep the historical inventory, without
  falsely labelling its requests completed. Historical request reaction churn
  must not indirectly veto the same witness through stability comparison.
  Valid nonterminal provider activity before the selected clean is also not
  proof that an older flight must finish first; activity at or after that
  clean remains relevant. This does not exempt malformed or edited carriers.
- This selectively supersedes the predecessor-completion restrictions in
  [the earlier recovery journal](../09/2026-09-30-head-clean-review-recovery.md),
  not its independent finding, base, or acquisition contracts. Keep actual
  findings, provider errors, edited/deleted or ambiguous evidence guards,
  complete pagination, exact refetches, and two stable snapshots. All PR review
  threads must be resolved in both snapshots. This recovery itself does not
  supersede non-inline findings.
- Preserve the existing direct-`+1` supersession route when a current-head
  finding requires it. Preliminary evidence selection must retain historical
  reaction fingerprints whenever such a finding exists; deciding that route
  only after reaction acquisition is too late if its history was already
  discarded. An additional positive receipt does not disable a qualifying
  head-attested clean when no current-head finding needs the old route.
- After an observed base epoch, retain the exact-current-head/base canonical
  request plus directly attached official provider `+1` rule. This change
  grants no new authority to a top-level clean after a base epoch.
- Controller diagnostic summaries remain non-authoritative. A canonical
  workflow-authored `@codex review` is still a real request, not a diagnostic.
  No events, permissions, runner settings, cron schedules, or GitHub Apps are
  added.

## Recovery and Delivery

- For an existing verifier without a base epoch, post a fresh `@codex review`,
  wait for a subsequent current-head clean, and resolve outstanding findings
  and threads. The existing eligible provider event requests the verifier
  rerun; manual `reconcile` is available if event delivery fails. No empty
  commit is required. Posting the request does not guarantee Codex starts.
- This source change does not update the already-published runtime. Publish
  it through the separately reviewed next release intent after source merge;
  consumers using `@v2` then receive the updated runtime on new runs.
- Append the implementation to PR #106 and obtain new exact-head remote
  review evidence. The owner's previously planned one-time bypass is not
  delegated to this implementation task.

## Validation

- Node v24.15.0: the relevant Action, v2 runtime, canonical workflow-contract,
  and core suites passed 442/442 tests, with no skipped or cancelled tests.
  Coverage includes multiple historical ordinary/canonical requests, old
  unclosed reactions and reaction churn, fresh-request guidance, ambiguous or
  edited latest carriers, post-clean activity, all unresolved threads, base
  epochs, actual findings, normal finding supersession, and historical reaction
  acquisition integrity when the finding path is retained.
- `npm run check`, `git diff --check`, and project-journal validation passed.
  These checks are scoped local validation, not a claimed whole-repository
  test pass; the required CI remains the full-repository gate.
- The source implementation is complete in this change. Remote exact-head
  review, source landing, and the separate release intent remain delivery
  gates tracked on PR #106; completing this journal does not claim publication.
