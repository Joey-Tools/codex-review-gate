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
3. Request a fresh Codex review, for example by posting `@codex review`.
4. When Codex later posts a top-level clean completion comment, the `issue_comment` workflow wakes the gate.
5. If `failed-findings-recovery` is enabled and the PR has no unresolved or not-outdated current-head Codex findings, the gate writes `success`.

This recovery path is event-driven. It does not add polling or scheduled runner minutes.

## Recovery Controls

`failed-findings-recovery` is enabled by default. Disable it when a repository wants `failed_findings` to require a new commit or manual dispatch even after review threads are resolved.

```yaml
with:
  failed-findings-recovery: ${{ vars.CODEX_REVIEW_GATE_FAILED_FINDINGS_RECOVERY }}
```

Set `CODEX_REVIEW_GATE_FAILED_FINDINGS_RECOVERY=false` as a repository or organisation variable to disable it before the action starts. Runtime environments may also set `FAILED_FINDINGS_RECOVERY=false`; the action input takes precedence when both are set.

## Manual Recovery

Use `workflow_dispatch` when event-driven recovery is disabled, when no fresh Codex clean completion comment arrives, or when an operator wants to re-evaluate one PR explicitly.

1. Open the `Codex Review Gate` workflow.
2. Run it manually with the PR number.
3. The gate reloads current GitHub evidence and advances the state machine from the stored sticky state.

Manual recovery remains fail-closed: if unresolved current-head Codex findings remain, the status stays or becomes `failure`.
