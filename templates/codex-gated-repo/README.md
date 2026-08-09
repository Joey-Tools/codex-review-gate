# Codex-Gated Repository Template

This template starts a repository with the Codex review gate workflow already on
the default branch. It is intentionally language-neutral; add project-specific CI,
tests, release workflows, and licensing after creating a repository from it.

## Included

- `.github/workflows/codex-review-gate.yml`
- `.gitignore`
- this README

The workflow writes the `codex/review-gate` status check and requests a controlled
Codex review marker for each ready pull request head. Before enabling the workflow,
replace `<v1.4.0-action-commit-sha>` with the exact 40-character action-repository
commit published in the v1.4.0 release notes. Floating `@v1.4` and `@v1` aliases
are convenience-only and are not canonical pins for this privileged
`pull_request_target` workflow.

## After Creating a Repository

1. Add the project source, CI workflow, tests, and license.
2. Replace the action release placeholder with the published exact 40-SHA.
3. Confirm `.github/workflows/codex-review-gate.yml` is present on the default
   branch before requiring the status check.
4. Enable the required status check with the bootstrap helper from
   `JoeyTeng/codex-review-gate`:

```bash
node scripts/bootstrap-codex-review-gate.mjs --repo OWNER/REPO
node scripts/bootstrap-codex-review-gate.mjs --repo OWNER/REPO --apply
```

The helper defaults to dry-run. It refuses to require `codex/review-gate` until
the workflow exists on the repository default branch.

## Optional Repository Variables

- `CODEX_REVIEW_GATE_RUNNER_LABELS`: JSON runner label array. Defaults to
  `["ubuntu-slim"]`; use `["ubuntu-latest"]` when `ubuntu-slim` is unavailable.
- `CODEX_REVIEW_GATE_AUTO_RETRY=false`: disables scheduled retry jobs before a
  runner is allocated.
- `CODEX_REVIEW_GATE_EVENT_MODE`: `standard`, `comment-only`, or `full`.
- `CODEX_REVIEW_GATE_BOT_LOGINS`: comma-separated additional Codex bot logins.
- `CODEX_REVIEW_GATE_COMPLETION_SIGNAL_BUFFER_SECONDS`: clean completion buffer.
- `CODEX_REVIEW_GATE_FAILED_FINDINGS_RECOVERY`: set to `false` to disable
  same-head recovery after resolved Codex findings.
- `CODEX_REVIEW_GATE_FAILED_FINDINGS_RECOVERY_MODE`: `head` or `fresh`.
