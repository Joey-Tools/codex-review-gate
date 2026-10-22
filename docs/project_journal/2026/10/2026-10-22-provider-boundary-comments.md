---
id: 20261022-provider-boundary-comments
title: Provider Boundary Comment Compatibility
status: completed
created: 2026-10-22
updated: 2026-10-22
branch: wip/provider-boundary-comments
pr:
supersedes: []
superseded_by:
---

# Provider Boundary Comment Compatibility

## Evidence And Cause

- [Telegram-Video-Downloader PR #50](https://github.com/Joey-Project/Telegram-Video-Downloader/pull/50)
  has a valid explicit-head [clean comment 6329108860](https://github.com/Joey-Project/Telegram-Video-Downloader/pull/50#issuecomment-6329108860)
  after its canonical request. Both observed review threads are resolved.
- Its older [native review 5607082812](https://github.com/Joey-Project/Telegram-Video-Downloader/pull/50#pullrequestreview-5607082812)
  starts with `<!-- codex-code-review-finding:v1 -->`. Published v2.2.8 parses
  this as an unrecognized terminal review rather than the underlying historical
  finding. The [native verifier log](https://github.com/Joey-Project/Telegram-Video-Downloader/actions/runs/39695108121/job/119552219169)
  reports `healthy/pending/request_clean_generation`, one indeterminate finding
  and two resolved threads. It does not identify a remaining unresolved thread.
- An offline parser probe of the exact retained review body reproduces the
  malformed classification. Removing only its leading marker in memory
  classifies the existing finding and preserves its native old-head binding.
  The current clean body already parses; its wording is not the cause.

## Decisions And Reasons

- Joey authorised complete arbitrary leading/trailing HTML-comment removal,
  not another marker-name allowlist, while retaining older supported formats.
  The V2 profile applies one shared parser projection to issue comments,
  native reviews, inline parents and approved-review commit-reference collection.
- Hidden boundary comments are presentation, not authority. Closed native
  inline-parent receipts bind through the full native `commit_id` independently
  of wrapper presence; top-level clean comments still need their explicit
  Reviewed commit field. Legacy/default shared-parser behavior and the older
  known-receipt-only option retain their existing rules.
- Keep the original body for identity, edit detection, exact refetch and
  stable-snapshot fingerprints. Visible findings, conflicting commit references,
  provider provenance, request chronology, hashless recovery and unresolved
  threads remain independently enforced. No historical finding is erased just
  because a later head exists.
- [GitHub's full review media](https://docs.github.com/en/rest/pulls/reviews)
  was inspected on the authenticated observed review. Its text/HTML fields
  expand the blob link into a source card and change the Markdown required by
  the current grammar, so they are not drop-in parser inputs.
- Existing Markdown AST packages were considered, but the Action has no
  runtime dependencies. This change keeps a bounded edge-comment projection
  rather than introducing a parser and distribution/bundling dependency for
  that narrow need. It does not claim to render arbitrary Markdown, remove
  interior comments or arbitrary HTML, or interpret visible code examples.
- Keep workflows, permissions, events, runners, versions, tags and release
  manifests unchanged in the source compatibility PR. Use remote GitHub Codex
  review only, without an additional formal local review.

## Validation

- The candidate parser was run against both exact retained REST bodies: the
  old native review is now a one-finding artifact on its original native SHA,
  the existing clean still resolves to its declared short commit reference,
  and both input objects' raw bodies are unchanged. The legacy parser profile
  still reproduces the old malformed classification. This is an offline
  parser probe, not a deployed reducer or GitHub check pass.
- Node.js v24.15.0: all 855 tests passed across the complete core parser,
  evidence-budget, legacy runner/receipt, V2 Action/runtime/workflow and
  workflow-security-contract suites. There were no failures, cancellations
  or skips. This is the affected suite, not complete repository discovery or
  a new local bootstrap/publisher run. `npm run check` passed.
- The PR #50-shaped runtime regression explicitly adapts repository, SHAs and
  chronology to the existing synthetic mock coordinates; it is not an exact
  production API replay. An older wrapped native finding, a later canonical
  request/clean and two resolved threads pass. Unresolved threads, a live
  current-head finding and a wrong visible clean SHA do not. Runtime lineage
  rules and the original-run cutoff are unchanged.
- Arbitrary/multiple/multiline/adjacent boundary comments, CRLF and harmless
  outer whitespace retain the older supported body grammar. Interior comments,
  fenced/indented/escaped examples, incomplete delimiters, visible findings
  and conflicting visible commit markers remain non-passing. Approved-review
  hidden SHA references do not cause resolution calls; visible conflicting
  references still block. Legacy/default tests preserve the old profile.
- An initial core/runtime run passed 479/482: two older V2 assertions still
  rejected newly admitted presentation wrappers, and the new runtime fixture
  initially disagreed with its mock trigger's head. Those test contracts and
  fixture coordinates were corrected without changing runtime admission or
  removing their meaningful negative controls. Failure and final-pass logs
  are retained locally. The final six focused tests are a subset of the 855.
- No formal local review was run. No deployed consumer recovery or publication
  is claimed by this source checkpoint.

## Next Steps

- Publish through a separate patch release intent with mandatory human production
  approval. Verify the signed full tag and floating `v2` before claiming that
  an installed consumer has the fix.
