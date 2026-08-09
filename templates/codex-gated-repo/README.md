# Codex-Gated Repository Template

This template starts a repository with the Codex review gate workflow already on
the default branch. It is intentionally language-neutral; add project-specific CI,
tests, release workflows, and licensing after creating a repository from it.

## Included

- `.github/workflows/codex-review-gate.yml`
- `.gitignore`
- this README

The workflow writes the `codex/review-gate` status check and requests a controlled
Codex review marker for each ready pull request head. It calls the centrally
deployed reusable workflow at
`JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1`.
That floating selector is the intentional pre-execution trust boundary; post-run
consumers must bind the server-resolved called workflow to a trusted-signer,
immutable compatible v1.x.y release and its provenance-v2 tree.

## After Creating a Repository

1. Add the project source, CI workflow, tests, and license.
2. Review the workflow's privileged event and permission boundary; do not add
   caller or pull-request checkout steps to the reusable calling job.
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

- `CODEX_REVIEW_GATE_AUTO_RETRY=false`: disables scheduled retry jobs before a
  runner is allocated.
- `CODEX_REVIEW_GATE_EVENT_MODE`: `standard`, `comment-only`, or `full`.
- `CODEX_REVIEW_GATE_BOT_LOGINS`: comma-separated additional Codex bot logins.

Action v1 still accepts the legacy `completion-signal-buffer-seconds`,
`failed-findings-recovery`, and `failed-findings-recovery-mode` inputs for
schema compatibility, but they are inert. Do not expose repository variables
for them or rely on them to change verdict, timeout, or request orchestration.

The reusable job runs on the fixed GitHub-hosted `ubuntu-slim` runner. The
caller cannot select a self-hosted runner or override the called workflow's
repository, ref, checkout path, or runtime tree.
