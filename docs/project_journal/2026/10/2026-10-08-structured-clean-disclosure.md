---
id: 20261008-structured-clean-disclosure
title: Structured Clean Disclosure and Actionable Parser Diagnostics
status: active
created: 2026-10-08
updated: 2026-10-08
branch: codex/v219-structured-clean-parser
pr:
supersedes: []
superseded_by:
---

# Structured Clean Disclosure and Actionable Parser Diagnostics

## Decision and Reason

- Private-workflows PR #215 has an unedited official clean issue comment for
  current head `4acd56e77ac9de1632c9e74ba56cb054f397b2d2`. Published v2.1.8
  rejects the new official disclosure because it compares the whole footer to
  an older template. `Delightful!` is already supported and is not the cause.
  Replaying the published parser accepts the identical conclusion and commit
  marker when only the disclosure is removed.
- Parse the top-level conclusion, unique top-level reviewed-commit marker,
  and optional official disclosure separately. Preserve the existing bounded
  conclusion/tagline grammar and unambiguous short-SHA resolution; do not
  infer arbitrary natural-language clean or accept evidence inside a quote or
  code fence.
- Recognize a single trailing closed details/summary envelope and supported
  functional disclosure blocks rather than comparing the entire footer.
  Permit harmless whitespace and supported old/new setup/link forms. Unknown
  prose, mixed finding content, nested/unclosed or duplicate structures, and
  extra trailing payload remain non-success. Scanning the original body for
  finding signals prevents a recognized disclosure from hiding those signals.
- Structural HTML recognition alone cannot prove arbitrary prose harmless.
  Only supported content shapes qualify; this is not blanket footer immunity.
  Do not globally relax the shared disclosure helper, which also constrains
  inline-parent review receipts.
- Add bounded parser/carrier/head/request diagnostics to CLI and Actions
  Summary without raw bodies or tokens. Diagnostics describe acquired facts,
  never supply positive evidence, and require no new events, permissions,
  polling, or GitHub requests.
- Preserve provider identity, request eligibility, head binding, unresolved
  findings/threads, base epochs, complete pagination, refetch integrity and
  stable-snapshot gates. Official activity summaries remain diagnostic-only.

## Delivery

- Use a focused source fix PR and remote GitHub Codex review, with no local
  reviewer lane in this session. A separate release-intent PR will freeze
  v2.1.9 after source landing. Only the existing privileged publisher stage
  receives credentials following Environment approval.
- Keep release publisher controls, production rulesets, consumers, and their
  runner settings unchanged. New `@v2` runs obtain the release only after
  publication; old check results are not automatically rewritten.

## Validation

- The initial v2.1.8 diagnostic replay reproduced `malformed` for comment
  `6058871185`, and `clean` with marker `4acd56e77a` after removing only its
  disclosure. Replaying the actual unchanged carrier against this implementation
  returns `clean` with commit reference `4acd56e77a`.
- Node v24.15.0: core and the complete v2 Action/runtime/workflow suites passed
  449/449 tests; evidence-budget and workflow-security suites passed 49/49;
  required-CI contract tests passed 2/2. No skips or cancellations were
  reported. `npm run check`, journal validation, and `git diff --check` passed.
- Regressions preserve unresolved-thread blocking and reject unknown prose,
  embedded findings, unsupported tags, duplicate/nested envelopes and invalid
  commit markers. CLI and real Summary output retain safe carrier diagnostics
  without body fragments or unknown fields. Invalid disclosure diagnostics
  report marker length only; head resolution is explicitly not evaluated.
- Broader source/release compatibility validation remains owned by the existing
  CI matrix; the focused local results do not claim that matrix has passed.

## Next Steps

- Obtain current-head remote review and the source CI closure, then land the
  protected source fix.
- Freeze and publish the separately reviewed v2.1.9 release intent.
- Verify the published runtime and refresh the original PR's gate through its
  existing, explicitly authorized recovery path if the PR remains open.

## Evidence

- [Original clean comment](https://github.com/Joey-Tools/codex-private-workflows/pull/215#issuecomment-6058871185).
- [Failed verifier](https://github.com/Joey-Tools/codex-private-workflows/actions/runs/37747357524/job/113290990501).
- Published predecessor: [v2.1.8](https://github.com/JoeyTeng/codex-review-gate-action/releases/tag/v2.1.8).
- Approved design: Desktop task `019ff4f8-f42a-70f0-9472-94f5ca08fb77`.
