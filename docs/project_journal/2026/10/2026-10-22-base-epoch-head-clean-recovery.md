---
id: 20261022-base-epoch-head-clean-recovery
title: Explicit-Head Clean Recovery After Base Epochs
status: completed
created: 2026-10-22
updated: 2026-10-22
branch: wip/pat-base-epoch-recovery
pr:
supersedes: []
superseded_by:
---

# Explicit-Head Clean Recovery After Base Epochs

## Evidence And Cause

- [BBDown-rust PR #116](https://github.com/Joey-Project/BBDown-rust/pull/116)
  was retargeted back to `master` at 2026-10-21T22:10:29Z. Its later unedited
  [request 6328429355](https://github.com/Joey-Project/BBDown-rust/pull/116#issuecomment-6328429355)
  at 22:58:34Z was authored by the configured `JoeyTeng-Codex` user token and
  contained the exact current head/base marker. Official unedited
  [clean 6328460609](https://github.com/Joey-Project/BBDown-rust/pull/116#issuecomment-6328460609)
  followed at 23:00:40Z and declared reviewed commit `4457d6deef`, matching
  full head `4457d6deefc21c93f67a45313469158f92e8ffc2`. All ten typed review
  threads were resolved in the complete diagnostic observation.
- [Verifier attempt 3](https://github.com/Joey-Project/BBDown-rust/actions/runs/39690208305/job/119747494841)
  actually used v2.2.9. It reported healthy execution, zero unresolved or
  indeterminate findings and ten resolved threads, but rejected the request
  after the base event and recommended a replacement PR.
- User-token request markers intentionally do not confer workflow provenance.
  The collector treats them as ordinary requests, while the post-base-event
  reducer previously admitted only head/base-bound Actions-bot generations
  and their direct provider reaction. The separate explicit-current-head clean
  recovery path also rejected any base epoch, so otherwise complete positive
  head evidence could not recover this PR.

## Decision And Reason

- Joey clarified that a trustworthy Codex conclusion's uniquely resolved
  current-head commit hash is the primary attribution basis. Ordinary and
  PAT-generated requests must not be rejected merely because the exact comment
  that caused the review cannot be proved. Hidden request metadata cannot
  replace, or veto, the provider's independent current-head attestation.
- Extend the existing current-head clean recovery witness, rather than
  promoting user markers to workflow authority or adding an actor allowlist,
  credentials, identity APIs, inputs or consumer workflow requirements.
- Preserve strict `T < R < C`, with
  `T = max(original verifier created_at, latest base epoch)` when an epoch
  exists. Without an epoch, keep the original verifier creation cutoff. The
  eligible unedited request `R` must be newer than both boundaries; the
  subsequent official unedited top-level clean `C` must explicitly and
  unambiguously resolve to the current full head. This proves the reviewed
  head, not the provider's internal base or exact request-to-review causality.
- Only that validated witness request/clean pair enters the post-epoch positive
  path. Ordinary/PAT request metadata remains non-authoritative; existing
  canonical Actions provenance and reaction-only bindings remain separate.
  A hashless or wrong-head result is not a substitute for explicit head proof.
- Keep actual findings, all unresolved review threads, later request/provider
  activity, edits/deletions and ambiguous history, complete pagination, exact
  refetches and two stable snapshots as independent guards. This recovery is
  not a general finding supersession or a blanket history waiver.
- This intentionally supersedes the base-epoch exclusion in
  [Fresh Head-Attested Clean Recovery](2026-10-06-head-attested-clean-recovery.md),
  while retaining its independent evidence and finding rules. It composes
  with the already supported
  [user-token request transport](2026-10-08-review-request-token-override.md)
  without changing the token's scope or use.
- Keep version, release manifest, workflow events, permissions, runners and
  protection unchanged in the source fix. Use remote GitHub Codex review only;
  no formal local review lane is added.

## Validation

- Node.js v24.15.0: all 804 tests across the six affected core, evidence-budget,
  gate-runner, producer-receipt, v2-action and v2-gate-runtime suites passed.
  All 52 v2-workflow and workflow-security contract tests also passed.
- The first full affected-runtime run passed 798/804; the six failures asserted
  the intentionally superseded marker/base-epoch restrictions. Updating those
  expectations preserved the separate stale Actions tuple, wrong-head,
  post-request epoch, edit, provenance, finding and unresolved-thread controls.
  The six focused cases and the complete rerun passed. Initial documentation
  contract failures were wording mismatches; the final 52-test rerun passed.
- Positive source fixtures cover ordinary requests, matching and stale User
  markers, canonical Actions requests, retarget and base force-push epochs.
  Negative controls keep requests before or equal to the latest cutoff,
  ambiguous/wrong-head cleans, unsafe history, findings and unresolved threads
  from gaining success. No new API query or workflow permission was added.
- `npm run check`, scoped journal validation and `git diff --check` passed.
  This is local source validation, not remote CI, publication or live consumer
  recovery proof. No formal local review or production replay was performed.

## Delivery Boundary

- Deliver the source fix independently of its subsequent patch release intent.
  Retain mandatory human `marketplace-production` approval and independently
  verify the signed full tag and floating `v2` before claiming deployment.
- The production PR observation is a diagnosis, not a new live passing check.
  Do not delete old evidence, bypass protection or require a replacement PR
  solely because the eligible request used an ordinary user token.
