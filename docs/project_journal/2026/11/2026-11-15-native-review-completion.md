---
id: 20261115-native-review-completion
title: Reuse Optional Native Code Review Completion
status: completed
created: 2026-11-15
updated: 2026-11-15
branch: wip/native-review-state
pr:
supersedes: [20261006-official-summary-diagnostics]
superseded_by:
---

# Reuse Optional Native Code Review Completion

## Decision And Scope

- Joey requested the remaining review-friction improvement after the other
  four changes. Reuse authenticated native completion before sending another
  review request. Trigger/comment counts do not establish backend execution
  counts or charges; preserve existing in-flight canonical request adoption.
- A unique official Bot/App summary may additionally supply its immediately
  adjacent `codex-review-state:v1` JSON frame. Require the exact full current
  `code_review.commit_sha`, `status: completed`, and both findings booleans
  `false`. Display-only Completed, unknown versions, malformed frames and
  short SHAs remain diagnostic. Ordinary clean receipts need no frame.
- Supersede only the earlier blanket exclusion of this typed completion
  basis. Preserve the old diagnostic exemption and current-marker revocation
  for ordinary summaries, their count handling and all real carrier history.
- Exact-refetch the selected code-review state and carrier provenance and bind
  that projection into each complete acquisition and both stable snapshots.
  Display text and aggregate edit-clock churn are benign; selected-state
  changes restart acquisition, and identity/marker loss remains blocking.
- Authenticate the mutable body's current editor through an independently
  bound GraphQL IssueComment read: require the exact official Bot editor, or
  prove the original Bot body is unedited. A maintainer can edit a Bot-authored
  comment without changing its original author; original App provenance alone
  cannot authenticate the current frame. A live read of PR 150 confirms the
  actual GraphQL author/editor representation and selected body.
- This is head-only supplemental authority, never a physical request receipt.
  Do not use it to supersede current-head findings, opaque or edited provider
  evidence, unknown deletion history or request-generation gaps. A reused
  summary created before a base retarget cannot use an edit time to cross it.
  GitHub's separate conversation-resolution policy remains mandatory.
- A controller that finds this completion posts nothing and reruns only the
  protected verifier. It cannot publish a positive gate. Keep existing
  consumer events, permissions, variables, token scopes and request-only paths.
  Summary events stay diagnostic; existing manual reconcile remains available
  when no subscribed completion comment follows.

## Evidence And Validation

- Public [PR 150's official summary](https://github.com/Joey-Tools/codex-review-gate/pull/150#issuecomment-6564802861)
  contains the typed v1 frame for its exact head. Its
  [independent clean receipt](https://github.com/Joey-Tools/codex-review-gate/pull/150#issuecomment-6564826598)
  corroborates completion. Neither Completed prose nor a machine marker alone
  supplies the new authority.
- Replaying the new no-request regression against unchanged source
  `6e3e2dcd78f5b7e13a2b9019886f907a8f84efd0` fails as expected: the old gate
  remains pending despite the authenticated exact-head no-findings frame.
- Node.js 24.15.0: all 16 focused regressions and all 541 related
  v2/core/evidence-budget tests pass, without failures, cancellations or skips.
  Cases cover actual findings, pending
  reviews, identity/flags/SHA validation, competing summaries, exact-read
  mutation/deletion, retargets, current-editor authentication, benign display
  and edit-clock churn, observed-finding retention and controller request
  suppression. Header-position checks exclude quoted frames from authority.
- `npm run check`, project-journal validation and `git diff --check` pass.
- Release delivery remains separately reviewed and uses the installed
  released controls outside this candidate. Publication requires the normal
  release-intent and human production approval; no publication or live new-
  runtime consumer qualification is claimed by this implementation entry.
