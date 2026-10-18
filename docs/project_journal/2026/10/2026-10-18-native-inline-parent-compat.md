---
id: 20261018-native-inline-parent-compat
title: Native Inline Parent Review Compatibility
status: completed
created: 2026-10-18
updated: 2026-10-18
branch: codex/native-parent-review-compat
pr: https://github.com/Joey-Tools/codex-review-gate/pull/129
supersedes: []
superseded_by:
---

# Native Inline Parent Review Compatibility

## Evidence And Cause

- Installer PR #128 reached head `45b3a215cba71545efb40d0574817334c7a09371`
  with an unedited official clean comment explicitly naming that head, 20
  successful ordinary checks, and 81 completely read, resolved review threads.
  The required verifier run `39098522905`, attempt 2, still reported healthy
  pending evidence with `unrecognized Codex terminal pull-request-review format`.
- The precise historical carrier is official native review `5561123825`,
  submitted at `2026-10-18T02:33:10Z` and natively bound to old full SHA
  `d7a60ff5bb81ea0e01db092bccde0f1a54f0b433`. Its known receipt marker is
  followed by three newlines, the ordinary inline-parent heading/introduction,
  and the official disclosure, without a duplicate body commit line or finding
  payload. Other sampled modern parent wrappers include a body commit line.
- The parent recognizer required the redundant body field despite the native
  full SHA. Fallback parsing also removed exactly two newlines after the marker
  and retained another leading newline. This is a compatibility test gap, not
  proof of a newly announced provider format or a new unresolved finding.

## Decision And Boundary

- Normalize harmless separator whitespace after one exact, start-of-body known
  receipt marker only in the existing opt-in compatibility profile. Do not
  accept unknown or duplicate envelopes or strip arbitrary provider content.
- Permit the narrow native inline-parent wrapper to omit a duplicate body
  commit field only after an actual known envelope is removed and the submitted
  native review supplies a full SHA. Enabling the compatibility option alone
  is not proof of an envelope; an unwrapped review still needs its body SHA.
  Preserve explicit body/native commit agreement, closed wrapper/disclosure,
  trusted provider provenance and global unresolved-thread blocking. Default
  legacy callers and top-level clean issue-comment commit requirements remain
  unchanged; no new public input or result ABI is introduced.
- Do not suppress all malformed historical artifacts, manufacture a provider
  reaction, modify protection, or rerun unchanged evidence as an infrastructure
  workaround. This source fix is separate from installer PR #128 and from the
  later release-intent PR and protected publisher approval.

## Validation

- Node `v24.15.0`: the complete CI core file inventory passed in two independent
  local groups, 944 affected/action/legacy/workflow tests and 254 organization
  handoff tests (1,198 total, no failures, skips or cancellations). This includes
  all 134 core tests and 340 runtime tests. The initial serial attempt exceeded
  its 180-second local deadline; only the two completed reruns supply pass
  evidence.
- The exact historical three-newline/no-body-SHA receipt now permits a later
  current-head clean when threads are resolved. The same history with an
  unresolved old thread still blocks. Missing/short native SHA, duplicate
  or missing envelopes and extra finding payload remain non-success outcomes;
  the missing-envelope regression retains the full native SHA and a later
  current-head clean to verify that opt-in alone supplies no authority. Unit tests
  also retain malformed and conflicting body SHA rejection and default strict
  behavior.
- `npm run check`, project-journal validation, `git diff --check`, and actionlint
  for CI and both canonical consumer workflows passed. Whole-repository
  actionlint 1.7.12 still reports publisher action-catalog input diagnostics and
  existing SC2016 warnings, reproduced on the unchanged base workflow. No
  workflow is modified by this fix.

## Next Steps

- This entry records the completed source compatibility slice, not production
  publication or acceptance of installer PR #128. Remote review/CI readiness
  and merge state remain in the source PR until it lands normally.
- Publish the separately authorized patch with the existing staged publisher,
  then reconcile installer PR #128 and stop at merge-ready before its merge.

## Evidence

- [Historical native review](https://github.com/Joey-Tools/codex-review-gate/pull/128#pullrequestreview-5561123825).
- [Current-head clean](https://github.com/Joey-Tools/codex-review-gate/pull/128#issuecomment-6245880426).
- [Failed verifier attempt](https://github.com/Joey-Tools/codex-review-gate/actions/runs/39098522905/job/117591173429).
