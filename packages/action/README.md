# Codex Review Gate

Languages: [British English (en-GB)](README.md) | [简体中文 (zh-CN)](README.zh-CN.md)

## QuickStart

1. Copy the workflow in [Workflow Usage](#workflow-usage) to `.github/workflows/codex-review-gate.yml`.
2. Use `JoeyTeng/codex-review-gate-action@v1.2`, merge it to the default branch, then open a follow-up test PR.
3. After `codex/review-gate` behaves as expected, add it as a required status check. For recovery recipes, see the [cookbook](COOKBOOK.md).

`codex-review-gate` is a reusable GitHub Action that owns a deterministic `codex/review-gate` status check. It is designed for repositories that want a required status to stay pending or failing until Codex review output for the current PR head is clean.

Target repositories keep a thin workflow at `.github/workflows/codex-review-gate.yml`; the review state machine lives in this action.

## Generative AI Notice

> [!NOTE]
> This action requests and evaluates Codex generative AI review output. It keeps controlled `@codex review` marker comments minimal for reliable command parsing, and writes this disclosure to the GitHub Actions step summary when it requests a review. Codex may respond with AI-generated comments or reviews on the pull request. Review and verify AI-generated output before relying on it for security, correctness, or merge decisions.
>
> The action itself does not execute pull request code. It coordinates GitHub comments, reviews, reactions, and commit statuses so repository maintainers can make Codex review a required branch-protection signal.

## What It Checks

The runner implements an event-driven serialized marker flow:

- Runs under `pull_request_target` from the repository default branch.
- Writes the configured commit status, `codex/review-gate` by default, to the PR head SHA.
- Fails when current-head Codex inline review threads or review-body findings are unresolved and not outdated.
- Keeps a trusted sticky PR state comment with hidden metadata.
- Serializes controlled `@codex review` marker comments.
- Keeps controlled marker comments minimal and writes the generative AI review disclosure to the GitHub Actions step summary.
- Treats Codex reactions as diagnostic signals only; `eyes` reactions on the active marker comment count as liveness, not pass.
- Uses scheduled or manual resume runs to retry unacknowledged or stalled markers.
- Passes only after a Codex top-level clean completion comment or `APPROVED` review appears after the active marker and the current head has no Codex findings. Top-level completion comments must also satisfy the configured completion signal buffer.
- Recovers from `failed_findings` after maintainers resolve Codex findings and a later Codex clean completion comment confirms the current head is clean.
- Ignores PR-open automatic review output unless it appears after the active controlled marker and passes final current-head validation.

## Files

- `action.yml`: composite action wrapper for the runner.
- `src/gate.mjs`: GitHub Actions runner script.
- `src/core.mjs`: testable state and signal helpers.
- `DESIGN.md`: target signal model, state machine, and GHA cost model.
- `COOKBOOK.md`: normal operating path and failure recovery recipes.

## Advanced Operation

For the event-driven review-gate design, state machine, automatic retry controls, **GHA cost model**, and recovery behaviour, see [DESIGN.md](DESIGN.md). For operator recipes, see [COOKBOOK.md](COOKBOOK.md).

The advanced design uses repository or organisation variables for controls that must take effect before a runner is allocated. For example, `CODEX_REVIEW_GATE_AUTO_RETRY=false` can skip scheduled retry jobs at the job `if` layer. Runtime `env` values are still useful for action behaviour after a job has started, but they cannot prevent GitHub Actions from assigning a runner.

The workflow example defaults to `ubuntu-slim`. Set `CODEX_REVIEW_GATE_RUNNER_LABELS` to a JSON array such as `["self-hosted","linux","x64","codex-review-gate"]` to run the gate on a self-hosted runner.

## Workflow Usage

```yaml
name: Codex Review Gate

on:
  pull_request_target:
    types: [opened, reopened, synchronize, ready_for_review]
  issue_comment:
    types: [created]
  pull_request_review:
    types: [submitted]
  pull_request_review_comment:
    types: [created]
  schedule:
    - cron: "0 */2 * * *"
  workflow_dispatch:
    inputs:
      pull_request:
        description: Optional pull request number to gate
        required: false
        type: string

permissions:
  contents: read
  issues: write
  pull-requests: write
  statuses: write

concurrency:
  group: codex-review-gate-${{ github.repository }}
  cancel-in-progress: false

jobs:
  codex-review-gate:
    name: codex/review-gate runner
    if: >-
      ${{
        (github.event_name != 'schedule' || vars.CODEX_REVIEW_GATE_AUTO_RETRY != 'false') &&
        (github.event_name != 'pull_request_target' ||
          github.event.pull_request.user.login != 'dependabot[bot]') &&
        (github.event_name != 'issue_comment' ||
          github.event.issue.user.login != 'dependabot[bot]') &&
        (github.event_name != 'pull_request_review' ||
          github.event.pull_request.user.login != 'dependabot[bot]') &&
        (github.event_name != 'pull_request_review_comment' ||
          github.event.pull_request.user.login != 'dependabot[bot]') &&
        (github.event_name != 'issue_comment' ||
          (github.event.issue.pull_request &&
            (contains(format(',chatgpt-codex-connector,chatgpt-codex-connector[bot],{0},',
              vars.CODEX_REVIEW_GATE_BOT_LOGINS), format(',{0},', github.event.comment.user.login)) ||
             contains(format(',chatgpt-codex-connector,chatgpt-codex-connector[bot],{0},',
              vars.CODEX_REVIEW_GATE_BOT_LOGINS), format(', {0},', github.event.comment.user.login))))) &&
        (github.event_name != 'pull_request_review' ||
          (vars.CODEX_REVIEW_GATE_EVENT_MODE != 'comment-only' &&
            github.event.pull_request.head.repo.full_name == github.event.pull_request.base.repo.full_name &&
            (contains(format(',chatgpt-codex-connector,chatgpt-codex-connector[bot],{0},',
              vars.CODEX_REVIEW_GATE_BOT_LOGINS), format(',{0},', github.event.review.user.login)) ||
             contains(format(',chatgpt-codex-connector,chatgpt-codex-connector[bot],{0},',
              vars.CODEX_REVIEW_GATE_BOT_LOGINS), format(', {0},', github.event.review.user.login))))) &&
        (github.event_name != 'pull_request_review_comment' ||
          (vars.CODEX_REVIEW_GATE_EVENT_MODE == 'full' &&
            github.event.pull_request.head.repo.full_name == github.event.pull_request.base.repo.full_name &&
            (contains(format(',chatgpt-codex-connector,chatgpt-codex-connector[bot],{0},',
              vars.CODEX_REVIEW_GATE_BOT_LOGINS), format(',{0},', github.event.comment.user.login)) ||
             contains(format(',chatgpt-codex-connector,chatgpt-codex-connector[bot],{0},',
              vars.CODEX_REVIEW_GATE_BOT_LOGINS), format(', {0},', github.event.comment.user.login)))))
      }}
    runs-on: ${{ fromJSON(vars.CODEX_REVIEW_GATE_RUNNER_LABELS || '["ubuntu-slim"]') }}
    timeout-minutes: 15
    steps:
      - uses: JoeyTeng/codex-review-gate-action@v1.2
        with:
          github-token: ${{ github.token }}
          pull-request: ${{ github.event.pull_request.number || github.event.issue.number || github.event.inputs.pull_request }}
          head-sha: ${{ github.event.pull_request.head.sha || '' }}
          event-mode: ${{ vars.CODEX_REVIEW_GATE_EVENT_MODE }}
          codex-bot-logins: ${{ vars.CODEX_REVIEW_GATE_BOT_LOGINS }}
          completion-signal-buffer-seconds: ${{ vars.CODEX_REVIEW_GATE_COMPLETION_SIGNAL_BUFFER_SECONDS }}
          failed-findings-recovery: ${{ vars.CODEX_REVIEW_GATE_FAILED_FINDINGS_RECOVERY }}
          failed-findings-recovery-mode: ${{ vars.CODEX_REVIEW_GATE_FAILED_FINDINGS_RECOVERY_MODE }}
```

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `github-token` | required | Token used to read PR review state, create comments, and write commit statuses. |
| `pull-request` | empty | Pull request number to gate. Leave empty for event payload routing or open-PR scans. |
| `head-sha` | empty | Deprecated compatibility input. Event-driven runs load the current PR head from GitHub. |
| `status-context` | `codex/review-gate` | Commit status context written by the gate. |
| `state-marker` | `codex-review-gate-state` | Hidden HTML marker used for the sticky state comment. |
| `marker-comment-marker` | `codex-review-gate-marker` | Hidden HTML marker used for controlled Codex request comments. |
| `max-wait-seconds` | `7200` | Overall maximum wait time before failing closed. |
| `marker-timeout-seconds` | `3600` | Time to wait for an acknowledged marker result before retrying. |
| `marker-ack-timeout-seconds` | `300` | Initial time to wait for Codex to acknowledge a marker before retrying. |
| `marker-ack-timeout-max-seconds` | `1800` | Maximum exponential backoff wait for unacknowledged markers. |
| `completion-signal-buffer-seconds` | `30` | Minimum seconds after a marker before accepting a Codex top-level clean completion comment. Set to `0` to disable the extra buffer; same-second comments are still rejected. |
| `failed-findings-recovery` | empty | Whether a later Codex clean completion comment can recover `failed_findings` after Codex findings are resolved. Empty defaults to enabled; set to `false` to disable. Can be supplied with `CODEX_REVIEW_GATE_FAILED_FINDINGS_RECOVERY` via `vars` or with the runtime `FAILED_FINDINGS_RECOVERY` environment variable; the input takes precedence. |
| `failed-findings-recovery-mode` | empty | Recovery mode for the enabled `failed_findings` recovery path. Empty defaults to `head`; set to `fresh` to require a clean completion comment created after any rejected recovery attempt that still saw current-head findings. Can be supplied with `CODEX_REVIEW_GATE_FAILED_FINDINGS_RECOVERY_MODE` via `vars` or with the runtime `FAILED_FINDINGS_RECOVERY_MODE` environment variable; the input takes precedence. |
| `event-mode` | empty | Event mode override: exactly `standard`, `comment-only`, or `full`. Empty falls back to `CODEX_REVIEW_GATE_EVENT_MODE` or `standard`. |
| `poll-interval-seconds` | `30` | Deprecated compatibility input. Event-driven runs do not poll. |
| `bootstrap-grace-seconds` | `60` | Deprecated compatibility input. Event-driven runs create controlled markers directly. |
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
- If the gate fails with `failed_findings`, resolve the Codex review threads, then request or wait for a Codex top-level clean completion comment. The default `head` recovery mode can re-evaluate a same-head clean comment after findings are resolved; `fresh` mode requires a clean comment created after any rejected recovery attempt that still saw findings.
- Default timeouts are currently 2 hours overall, 5 minutes for first marker ack, 30 minutes maximum ack backoff capped by the marker result timeout, and 1 hour per marker result. The recommended schedule example checks retry deadlines every 2 hours.

## Feedback and Reporting

Use [GitHub issues](https://github.com/JoeyTeng/codex-review-gate-action/issues) to report action bugs, bad gate behaviour, documentation gaps, or Marketplace listing issues. If a pull request receives problematic AI-generated review content, use GitHub's normal reporting and feedback tools for that specific comment or review, and include a link in an issue when it is relevant to this action's gate behaviour.

## Source and Development

This repository is the Marketplace release package. Development, CI, and self-gating workflows are maintained in [JoeyTeng/codex-review-gate](https://github.com/JoeyTeng/codex-review-gate).
