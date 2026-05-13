# Codex Review Gate

Languages: [English (en-GB)](README.md) | [简体中文 (zh-CN)](README.zh-CN.md)

`codex-review-gate` is a reusable GitHub Action that owns a deterministic `codex/review-gate` status check. It is designed for repositories that want a required status to stay pending or failing until Codex review output for the current PR head is clean.

Target repositories keep a thin workflow at `.github/workflows/codex-review-gate.yml`; the review state machine lives in this action.

## What It Checks

The runner implements a reaction-driven serialized marker flow:

- Runs under `pull_request_target` from the repository default branch.
- Writes the configured commit status, `codex/review-gate` by default, to the PR head SHA.
- Fails when current-head Codex inline review threads or review-body findings are unresolved and not outdated.
- Keeps a trusted sticky PR state comment with hidden metadata.
- Treats PR-open automatic review output as first-round baseline only.
- Serializes controlled `@codex review` marker comments.
- Treats Codex `eyes` reactions as liveness only.
- Retries unacknowledged markers after a 300 second ack timeout with exponential backoff capped at 1800 seconds and by the marker result timeout.
- Passes only after a new Codex PR-body `+1` reaction identity or Codex top-level completion comment appears after the active marker baseline and the current head has no Codex findings.
- Keeps unchanged old `+1` reactions pending or stalled instead of reusing them.

## Files

- `action.yml`: composite action wrapper for the runner.
- `src/gate.mjs`: GitHub Actions runner script.
- `src/core.mjs`: testable state and signal helpers.
- `DESIGN.md`: target signal model and state machine.

## Workflow Usage

```yaml
name: Codex Review Gate

on:
  pull_request_target:
    types: [opened, reopened, synchronize, ready_for_review]
  workflow_dispatch:
    inputs:
      pull_request:
        description: Pull request number to gate
        required: true
        type: number

permissions:
  contents: read
  issues: write
  pull-requests: write
  statuses: write

concurrency:
  group: codex-review-gate-${{ github.event.pull_request.number || github.event.inputs.pull_request || github.run_id }}
  cancel-in-progress: true

jobs:
  codex-review-gate:
    name: codex/review-gate runner
    runs-on: ubuntu-latest
    timeout-minutes: 130
    steps:
      - uses: JoeyTeng/codex-review-gate@v1
        with:
          github-token: ${{ github.token }}
          pull-request: ${{ github.event.pull_request.number || github.event.inputs.pull_request }}
          head-sha: ${{ github.event.pull_request.head.sha }}
```

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `github-token` | required | Token used to read PR review state, create comments, and write commit statuses. |
| `pull-request` | required | Pull request number to gate. |
| `head-sha` | empty | Expected PR head SHA. Leave empty for `workflow_dispatch` lookups. |
| `status-context` | `codex/review-gate` | Commit status context written by the gate. |
| `state-marker` | `codex-review-gate-state` | Hidden HTML marker used for the sticky state comment. |
| `marker-comment-marker` | `codex-review-gate-marker` | Hidden HTML marker used for controlled Codex request comments. |
| `max-wait-seconds` | `7200` | Overall maximum wait time before failing closed. |
| `marker-timeout-seconds` | `3600` | Time to wait for an acknowledged marker result before retrying. |
| `marker-ack-timeout-seconds` | `300` | Initial time to wait for Codex to acknowledge a marker before retrying. |
| `marker-ack-timeout-max-seconds` | `1800` | Maximum exponential backoff wait for unacknowledged markers. |
| `poll-interval-seconds` | `30` | Poll interval for GitHub PR review signals. |
| `bootstrap-grace-seconds` | `60` | Initial quiet period used to baseline PR-open automatic Codex review signals. |
| `codex-bot-logins` | `chatgpt-codex-connector,chatgpt-codex-connector[bot]` | Comma-separated GitHub logins accepted as Codex bot identities. |
| `trusted-comment-logins` | `github-actions[bot]` | Comma-separated GitHub logins trusted for gate state and marker comments. |

## Repository Setup

After the workflow is merged into the default branch and has run at least once, add `codex/review-gate` to the repository ruleset as a required status check. Use GitHub Actions as the source because the workflow writes the status with `GITHUB_TOKEN`.

Recommended rollout:

1. Merge the workflow into the repository default branch.
2. Open a follow-up test PR.
3. Confirm the workflow creates a current-head marker comment on `opened` and `synchronize`.
4. Confirm the gate can pass or fail with the current runner implementation.
5. Add `codex/review-gate` to the ruleset required status checks.

Do not require `codex/review-gate` before the workflow exists on the protected default branch. The first PR that introduces the workflow cannot fully self-test the `pull_request_target` path because GitHub Actions reads that workflow from the repository default branch.

## Operational Notes

- The workflow does not execute PR code.
- The workflow should have both `issues: write` and `pull-requests: write` so it can create PR conversation comments.
- For the cleanest signal, disable Codex automatic review-on-push and let the gate marker comment trigger the current-head review.
- The runner uses REST pull request comments plus GraphQL `reviewThreads` metadata to avoid treating resolved or outdated Codex inline threads as current findings.
- Review-body findings do not have resolvable review threads, so the runner matches them by `PullRequestReview.commit_id` and current-head blob links.
- Default timeouts are currently 2 hours overall, 5 minutes for first marker ack, 30 minutes maximum ack backoff capped by the marker result timeout, 1 hour per marker result, and 60 seconds bootstrap grace.
