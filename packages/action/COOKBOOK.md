# Codex Review Gate Cookbook

Languages: [British English (en-GB)](COOKBOOK.md) | [简体中文 (zh-CN)](COOKBOOK.zh-CN.md)

## Normal Path

Use this path after the workflow is merged to the repository default branch and `codex/review-gate` is required by the ruleset.

1. Open or update a ready PR.
2. The workflow writes `codex/review-gate = pending` and posts a controlled `@codex review` marker.
3. Wait for Codex to respond.
4. If Codex posts a clean top-level completion comment and no current-head Codex findings remain, the gate writes `success`.
5. If Codex posts unresolved current-head findings, the gate writes `failure` or stays pending until the finding path is evaluated.

For the cleanest signal, disable Codex automatic review-on-push and let the controlled marker request the review for the current head.

## Failed Findings Recovery

Use this path when `codex/review-gate` is `failure` with `failed_findings`.

1. Address the finding in code or decide that the finding is not actionable.
2. Resolve the Codex review thread in GitHub.
3. Request or wait for a same-head Codex clean result. Posting `@codex review` is the clearest way to create a fresh signal.
4. When Codex posts a top-level clean completion comment, the `issue_comment` workflow wakes the gate.
5. If `failed-findings-recovery` is enabled and the PR has no unresolved or not-outdated current-head Codex findings, the gate writes `success`.

This recovery path is event-driven. It does not add polling or scheduled runner minutes.

## Recovery Controls

`failed-findings-recovery` is enabled by default. Disable it when a repository wants `failed_findings` to require a new commit or manual dispatch even after review threads are resolved.

```yaml
with:
  failed-findings-recovery: ${{ vars.CODEX_REVIEW_GATE_FAILED_FINDINGS_RECOVERY }}
  failed-findings-recovery-mode: ${{ vars.CODEX_REVIEW_GATE_FAILED_FINDINGS_RECOVERY_MODE }}
```

Set `CODEX_REVIEW_GATE_FAILED_FINDINGS_RECOVERY=false` as a repository or organisation variable to disable it before the action starts. Runtime environments may also set `FAILED_FINDINGS_RECOVERY=false`; the action input takes precedence when both are set.

`failed-findings-recovery-mode` controls whether a same-head clean signal can be re-evaluated after a blocked recovery attempt:

- `head` is the default. If the latest branch head has a Codex clean completion comment and all current-head Codex findings are now resolved or outdated, a rerun of that same comment event may recover the status.
- `fresh` records the time of a recovery attempt that was rejected because findings still existed. Any clean completion comment created at or before that rejected attempt will not pass later; after resolving the findings, request a new Codex review and wait for a newer clean completion comment.

Use `head` when you want the gate to model the latest head-level Codex result. Use `fresh` when you want every resolved-findings recovery to be tied to a clean comment created after the blocked recovery attempt.

## Manual Recovery

Use `workflow_dispatch` when event-driven recovery is disabled, when no usable Codex clean completion comment arrives, or when an operator wants to re-evaluate one PR explicitly.

1. Open the `Codex Review Gate` workflow.
2. Run it manually with the PR number.
3. The gate reloads current GitHub evidence and advances the state machine from the stored sticky state.

Manual recovery remains fail-closed: if unresolved current-head Codex findings remain, the status stays or becomes `failure`.
