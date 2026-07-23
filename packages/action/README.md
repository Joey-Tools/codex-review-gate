# Codex Review Gate

Languages: [British English (en-GB)](README.md) | [简体中文 (zh-CN)](README.zh-CN.md)

## QuickStart

1. Copy the workflow in [Workflow Usage](#workflow-usage) to `.github/workflows/codex-review-gate.yml`.
2. Use `JoeyTeng/codex-review-gate-action@v1`, merge it to the default branch, then open a follow-up test PR.
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
- Passes only when the latest accepted Codex terminal result is bound to the current head, is clean, is authorised by trusted marker or recovery lineage, and every historical thread-backed Codex finding is resolved.
- Treats `isOutdated` and `isResolved` independently. An outdated but unresolved thread still blocks the gate.
- Recognises unthreaded top-level finding comments from exact repository and full-SHA blob links; a later accepted clean result for the same or newer head supersedes those findings.
- Validates official provider identity and binds reviews, inline comments, and top-level results to their reviewed commit.
- Accepts clean results only through a closed provider grammar; finding-shaped content takes precedence over a clean-looking lead or `APPROVED` state.
- Treats a configured provider's `Codex Review` comment, with an optional Markdown heading and emoji, as a broad terminal candidate. Exact one-line `in progress` / `still in progress` messages are ignored, with an optional period or colon plus one to 160 metadata characters; a newer unknown candidate such as `completed` is malformed and fail-closed rather than silently ignored.
- Rebuilds a complete evidence snapshot on every reconciliation. Historical `pending` or `error` states and earlier incomplete API, pagination, identity, or commit parsing attempts are audit data, not sticky blockers.
- Bounds each PR's evidence work to 64 MiB and 1,024 fetch attempts shared across snapshots and retries, with an 8 MiB streaming cap per response, 20,000 items per snapshot, and concurrency of four for HTTP and review-thread completion.
- Keeps a trusted sticky PR state comment with hidden metadata.
- Serializes controlled `@codex review` marker comments.
- Keeps controlled marker comments minimal and writes the generative AI review disclosure to the GitHub Actions step summary.
- Treats Codex reactions as diagnostic signals only; `eyes` reactions on the active marker comment count as liveness, not pass.
- Uses scheduled or manual resume runs to retry unacknowledged or stalled markers.
- Fails closed when the current reconciliation cannot load or validate all required evidence. Transient exhaustion produces `pending`; deterministic provider identity, schema, or commit conflicts produce `error`. Both fail the workflow.
- Demotes an otherwise clean current-head result to `pending` when active-marker, exact passed-marker reassertion, or failed-findings recovery lineage does not authorise it.
- Before success, caches the newest same-context live status and its producer, revalidates PR lifecycle and head, loads the final complete snapshot with a bounded whole-snapshot orphan reload when needed, then deduplicates without another read and immediately posts success if required.
- Reasserts the computed status unless that newest same-context record already has the desired state and comes from exact `github-actions[bot]` / `Bot`. An external or missing producer cannot expose an older trusted status as the deduplication candidate.
- Safely upgrades a v1.2 passed marker only when its exact legacy result identity, trusted live marker, baseline, and current strict clean artifact all match; otherwise it requires a fresh marker.
- Supports a narrow legacy `failed_findings` recovery from the exact matching same-head clean `issue_comment` event after every thread-backed Codex finding is resolved; the compatibility inputs control whether the same clean may be reused or a newer one is required.
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
      - uses: JoeyTeng/codex-review-gate-action@v1
        with:
          github-token: ${{ github.token }}
          pull-request: ${{ github.event.pull_request.number || github.event.issue.number || github.event.inputs.pull_request }}
          head-sha: ${{ github.event.pull_request.head.sha || '' }}
          event-mode: ${{ vars.CODEX_REVIEW_GATE_EVENT_MODE }}
          codex-bot-logins: ${{ vars.CODEX_REVIEW_GATE_BOT_LOGINS }}
          completion-signal-buffer-seconds: ${{ vars.CODEX_REVIEW_GATE_COMPLETION_SIGNAL_BUFFER_SECONDS }}
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
| `completion-signal-buffer-seconds` | `30` | Deprecated but operational v1 compatibility input. An issue-comment clean result must be newer than the active marker by this buffer as well as exactly commit-bound. |
| `failed-findings-recovery` | empty | Deprecated but operational switch for narrow same-head, no-active-marker recovery from `failed_findings`. Empty defaults to enabled; `false` disables this path. |
| `failed-findings-recovery-mode` | empty | Deprecated but operational v1 input. `head` may reuse the same qualifying clean after findings resolve; `fresh` requires a clean newer than a recorded rejected recovery attempt. |
| `event-mode` | empty | Event mode override: exactly `standard`, `comment-only`, or `full`. Empty falls back to `CODEX_REVIEW_GATE_EVENT_MODE` or `standard`. |
| `poll-interval-seconds` | `30` | Deprecated compatibility input. Event-driven runs do not poll. |
| `bootstrap-grace-seconds` | `60` | Deprecated compatibility input. Event-driven runs create controlled markers directly. |
| `bootstrap-timeout-seconds` | `3600` | Deprecated compatibility input. Bootstrap now closes after the grace period and starts a controlled marker. |
| `codex-bot-logins` | `chatgpt-codex-connector,chatgpt-codex-connector[bot]` | Comma-separated GitHub logins accepted as Codex bot identities. |
| `trusted-comment-logins` | `github-actions[bot]` | Comma-separated GitHub logins trusted for gate state and marker comments. |

## Repository Setup

After the workflow is merged into the default branch and has run at least once, add `codex/review-gate` to the repository ruleset as a required status check. Use GitHub Actions as the source because the workflow writes the status with `GITHUB_TOKEN`.

For new repositories, start from the language-neutral GitHub template repository
`Joey-Tools/codex-gated-repo-template` when you want the gate workflow
preinstalled. The source repository
`JoeyTeng/codex-review-gate` also ships `templates/codex-gated-repo` and a
dry-run bootstrap helper for creating or updating the required repository
ruleset:

```bash
node scripts/bootstrap-codex-review-gate.mjs --repo OWNER/REPO
node scripts/bootstrap-codex-review-gate.mjs --repo OWNER/REPO --apply
```

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
- The runner fully paginates REST comments, reviews, inline comments, and GraphQL review threads before it can pass.
- Official REST evidence must come from an accepted Bot identity. Top-level issue comments also require the official `chatgpt-codex-connector` GitHub App by default.
- REST evidence IDs must be positive safe integers; GraphQL opaque and `fullDatabaseId` fields must use their canonical string forms. Duplicate provider, review, inline-comment, or thread identities fail closed, including on resolved threads.
- Reviews bind through the full `PullRequestReview.commit_id`. Inline comments bind through their parent review and `original_commit_id`, not GitHub's mutable relocated `commit_id`.
- Top-level clean comments bind through their reviewed-commit marker. A short marker must resolve uniquely through the repository commit API to the full current-head SHA.
- The closed clean grammar accepts the exact issue-comment lead plus only these observed provider taglines: none, `Nice work!`, `Chef's kiss.`, `What shall we delve into next?`, `Already looking forward to the next diff.`, `Keep them coming.`, `:rocket:`, `:tada:`, or `Swish.` It then requires exactly one reviewed-commit line and either no suffix or the exact official disclosure. An `APPROVED` review must be empty, exact `Looks good.`, or have a unique exact final `No findings.` optionally after one summary of at most 240 characters. That summary must begin with exact `Coverage:` or `Review coverage:` and continue with a comma/`and`-separated list of backtick-wrapped identifier or path tokens matching `[A-Za-z0-9_./:@+-]+`, with only an optional final period; verb-led and other prose are rejected. A whole normalized target equal to `P0`–`P3`, `S0`–`S3`, `critical`, `high`, `medium`, `low`, `finding`, `findings`, `blocker`, `blocking`, `found`, `detected`, `data-loss`, or `auth-bypass` is rejected, but those words inside a real path or identifier are not blanket-rejected. Finding signals always win.
- Review-body and unthreaded top-level findings must use exact `github.com` links for the gated owner and repository with a full commit SHA. Unknown or conflicting current formats fail closed.
- Resolve every thread-backed Codex finding before expecting success. `isOutdated` alone is not resolution. A later accepted current-head clean result may supersede an unthreaded top-level finding.
- Sticky state and status history support orchestration, audit, and idempotency only. A rerun reconstructs current evidence and can reassert `success` over a later stale `pending` or `error` status.
- The optional status-deduplication GET is independent best-effort work: 100 statuses per page, at most 10 pages or 1,000 items, 1 MiB per response, 4 MiB total, and 16 fetch attempts. It selects the first (newest) same-context record before checking producer identity. Failure or exhaustion becomes `readFailed`, does not taint review evidence, and causes the action to POST its computed status directly.
- A review-evidence budget failure aborts active evidence requests. When concurrent loads fail differently, a deterministic non-`pending` error, including a schema or identity conflict, wins over budget or transient `pending`.
- Retryable REST and GraphQL responses honour valid `Retry-After` delays up to 10 seconds. Longer delays stop immediately, while missing or malformed values use bounded fallback retries; the header never expands the existing retry-safe method/status set.
- Older short-SHA clean results are resolved lazily only when an older unthreaded finding's supersession depends on them.
- Evidence-budget exhaustion is transient: the action writes `pending` and exits non-zero. Deterministic provider schema, identity, or commit-binding conflicts write `error` and also exit non-zero.
- Default timeouts are currently 2 hours overall, 5 minutes for first marker ack, 30 minutes maximum ack backoff capped by the marker result timeout, and 1 hour per marker result. The recommended schedule example checks retry deadlines every 2 hours.

## Feedback and Reporting

Use [GitHub issues](https://github.com/JoeyTeng/codex-review-gate-action/issues) to report action bugs, bad gate behaviour, documentation gaps, or Marketplace listing issues. If a pull request receives problematic AI-generated review content, use GitHub's normal reporting and feedback tools for that specific comment or review, and include a link in an issue when it is relevant to this action's gate behaviour.

## Source and Development

This repository is the Marketplace release package. Development, CI, and self-gating workflows are maintained in [JoeyTeng/codex-review-gate](https://github.com/JoeyTeng/codex-review-gate).
