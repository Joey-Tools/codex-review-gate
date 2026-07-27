# Codex Review Gate Cookbook

Languages: [British English (en-GB)](COOKBOOK.md) | [简体中文 (zh-CN)](COOKBOOK.zh-CN.md)

## Normal Path

Use this path after the workflow is merged to the repository default branch and `codex/review-gate` is required by the ruleset.

1. Open or update a ready PR.
2. The workflow writes `codex/review-gate = pending` and posts a controlled `@codex review` marker.
3. Wait for Codex to respond.
4. On the next complete run, the gate writes `success` when the latest official,
   trusted provider artifact matches the closed clean grammar, binds to the
   current head, and every historical thread-backed Codex finding is resolved.
5. If any historical thread-backed finding remains unresolved, the gate writes `failure` or stays pending until the finding path is evaluated. `isOutdated` alone does not resolve it.

For the clearest request flow, repositories may disable Codex automatic
review-on-push to reduce duplicate reviews. Automatic and controlled-marker
results are evaluated by the same provider-evidence rules; the marker does not
authorise either result.

## Failed Findings Recovery

Use this path when `codex/review-gate` is `failure` with `failed_findings`.

1. Address the finding in code or decide that the finding is not actionable.
2. Resolve the Codex review thread in GitHub.
3. Make sure an official clean artifact exists for the current head. If none
   exists, posting `@codex review` is the clearest way to request one.
4. Let a Codex comment or review event wake the gate, or run the workflow
   manually for the PR.
5. The gate rebuilds the complete evidence snapshot. It writes `success` when
   the latest official, trusted closed-grammar clean artifact is bound to the
   current head and every historical thread-backed finding is resolved.

This recovery path is event-driven. It does not add polling or scheduled runner minutes.

A marker deadline, closed marker state, baseline, or recovery cutoff cannot
reject an otherwise valid provider artifact. A clean artifact that arrives
after a marker deadline can pass on a later complete run.

## Deprecated Recovery Controls

The v1 inputs remain available so existing workflows and stored state continue
to load:

```yaml
with:
  failed-findings-recovery: ${{ vars.CODEX_REVIEW_GATE_FAILED_FINDINGS_RECOVERY }}
  failed-findings-recovery-mode: ${{ vars.CODEX_REVIEW_GATE_FAILED_FINDINGS_RECOVERY_MODE }}
```

`failed-findings-recovery`, `failed-findings-recovery-mode`, and their
repository-variable or environment equivalents are deprecated compatibility
controls. The action continues to accept and validate their v1 values, but
those values no longer change gate decisions or request orchestration. Legacy
fields already present in sticky state remain audit data. In particular,
`head`, `fresh`, a disabled recovery switch, and a recorded recovery cutoff
cannot make the latest valid current-head clean result pass or fail.

## Manual Recovery

Use `workflow_dispatch` when no provider event wakes the workflow or when an
operator wants to re-evaluate one PR explicitly.

1. Open the `Codex Review Gate` workflow.
2. Run it manually with the PR number.
3. The gate reloads current GitHub evidence and computes the result from the
   complete snapshot. Stored sticky state is used only to resume request
   orchestration.

Manual recovery remains fail-closed: an incomplete snapshot cannot pass, and
if any historical thread-backed Codex finding remains unresolved, the status
stays or becomes `failure`. Marker or recovery history does not veto a valid
latest current-head clean artifact.
