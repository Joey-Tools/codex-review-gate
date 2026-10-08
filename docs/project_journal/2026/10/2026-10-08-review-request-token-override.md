---
id: 20261008-review-request-token-override
title: Optional User Token for Review Request Creation
status: active
created: 2026-10-08
updated: 2026-10-08
branch: codex/review-request-token-override
pr:
supersedes: []
superseded_by:
---

# Optional User Token for Review Request Creation

## Decision and Reason

- The historical v2.0/v2.1 Action input ABI is frozen. Add the optional
  `review_request_token` only in an append-only v2.2 contract; retain Node 24
  and do not change the release manifest in the source implementation PR.
- Empty input preserves the existing `github-actions[bot]` request author.
  The configured credential is used only for authenticated `GET /user`
  identity and creation of the request comment in request-enabled controller
  `begin-review`. PR/scope/evidence reads, comment refetches, sticky diagnostic
  writes and canonical verifier reruns continue to use `github_token`.
- Ignore the input without calls for verifier, reconcile,
  report-completion/diagnostic operations and `begin-review` with
  `request_review=false`. Bind the actual returned user ID/login/type and
  refetched comment. Keep provider clean/finding identity and canonical
  bot-reaction trust unchanged. A configured invalid, expired or unauthorised
  credential fails clearly without bot fallback. An uncertain comment POST
  gets only the existing bounded read-only recovery, not another POST.
- One observed Actions-bot request quota failure and one same-head user request
  success motivate a configurable identity; this is one observation, not
  evidence that bot requests generally fail. Separate code paths preserve
  least use of the broader workflow token, but do not reduce a PAT's intrinsic
  authority: selected-repository secret visibility controls distribution only.
- Prefer a fine-grained PAT when organization membership supports it, scoped
  to one resource owner, selected repositories and Issues: write (or Pull
  requests: write). Outside collaborators may need a classic PAT; private-repo
  classic `repo` scope is broad and cannot be made comment-only. No workflow or
  admin scope is needed. An optional dedicated user can reduce inherited
  rights but still needs eligible OpenAI review integration/credits; a new
  account is not a request-start guarantee. Do not introduce a GitHub App
  workaround.
- Source implementation and release must land before the
  `Joey-Tools/codex-private-workflows` pilot. The existing consumer requires an
  explicit controller-step line; a named secret is not auto-discovered.
  Validate pilot author, comment binding, clean/finding behavior and gate
  result before considering wider rollout. Do not change publisher controls,
  release manifest, triggers, pre-runner filters or limits profile.

## Delivery

- The source slice adds the optional input, request-only client, exact User
  identity binding, installer compatibility, bilingual guidance and append-only
  publication contract. No package-version or release-intent bump is included.
- Exact known-success POST binding mismatches must not be recovered with a
  weaker login/type fingerprint. Unknown POST adoption refetches the exact
  comment with the normal workflow credential and validates author ID/login/
  type, body and scope. Existing history/transport failures retain their
  specific diagnostics and bounded read-only recovery; neither path reposts.
- Local validation passed: `npm run check`, journal validation, and 455/455
  core/Action/runtime/workflow-contract tests. Focused installer/security
  coverage passed 6/6 and the complete bootstrap suite passed 165/165. The
  combined bootstrap/security run exposed one stale public-input inventory
  assertion; after updating it, the complete security suite passed 43/43.
  Focused publication-contract coverage passed 5/5 plus the historical v2.0
  provenance/tag check. Full release pipeline results remain to be collected;
  these local results do not stand in for complete source PR CI or the pilot.
- Documentation describes the intended source capability and explicit pilot
  sequence. It does not claim the implementation is merged, released,
  deployed or validated in the pilot.
- Use remote GitHub `@codex review` only; no local review lane.

## Next Steps

- Implement and validate the Action input, controller-only credential use and
  fail-closed request recovery in the source repository.
- Complete source review and release through the existing protected release
  process.
- Only after release, make the one-line controller update and secret setup in
  the `codex-private-workflows` pilot; verify author, comment binding, clean/
  finding evidence and gate behavior before any expansion.

## Evidence

- [GitHub personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).
- [Create an issue comment](https://docs.github.com/en/rest/issues/comments#create-an-issue-comment).
- [GitHub Actions secrets reference](https://docs.github.com/en/actions/reference/security/secrets).
- [Using secrets in GitHub Actions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).
