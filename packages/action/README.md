# Codex Review Gate

Languages: [British English (en-GB)](README.md) | [简体中文 (zh-CN)](README.zh-CN.md)

## QuickStart

1. Copy the workflow in [Workflow Usage](#workflow-usage) to `.github/workflows/codex-review-gate.yml`.
2. Replace `<v1.4.0-action-commit-sha>` with the exact 40-hex action-repository
   commit published in the v1.4.0 release notes/provenance manifest, use
   `JoeyTeng/codex-review-gate-action@<v1.4.0-action-commit-sha>`, merge it to
   the default branch, then open a follow-up test PR.
3. After `codex/review-gate` behaves as expected, add it as a required status check. For recovery recipes, see the [cookbook](COOKBOOK.md).

`codex-review-gate` is a reusable GitHub Action that owns a deterministic
`codex/review-gate` status check. It passes only from a complete evidence
snapshot when the latest official, trusted provider artifact is a
closed-grammar clean result bound to the current PR head and every
blocking Codex finding is cleared. Here, pass means only that this required
commit status is `success`; it never attests a named triple review or the PR's
overall merge readiness.

Target repositories keep a thin workflow at `.github/workflows/codex-review-gate.yml`; the review state machine lives in this action.

## Generative AI Notice

> [!NOTE]
> This action requests and evaluates Codex generative AI review output. It keeps controlled `@codex review` marker comments minimal for reliable command parsing, and writes this disclosure to the GitHub Actions step summary when it requests a review. Codex may respond with AI-generated comments or reviews on the pull request. Review and verify AI-generated output before relying on it for security, correctness, or merge decisions.
>
> The action itself does not execute pull request code. It coordinates GitHub comments, reviews, reactions, and commit statuses so repository maintainers can make Codex review a required branch-protection signal.

## What It Checks

The runner implements event-driven evidence reconciliation with a serialized
marker flow for requesting reviews:

- Runs under `pull_request_target` from the repository default branch.
- Writes the configured commit status, `codex/review-gate` by default, to the PR head SHA.
- Passes only from a complete, stable evidence reduction when the selected
  official trusted clean artifact binds strongly to the current head and no
  current-head or ancestor finding remains blocking. This is only the verdict
  of the required `codex/review-gate` status, never proof of triple review or
  merge readiness.
- Treats `isOutdated` and `isResolved` independently. An exact joined review
  thread for a current-head or ancestor finding remains blocking until its
  authoritative `isResolved` value is exactly `true`; a later clean result
  cannot supersede it.
- Recognises unthreaded top-level finding comments from exact repository and
  full-SHA blob links. An older same-head or ancestor unthreaded finding is
  superseded only by the strictly later selected current-head clean artifact.
  A finding proven to be on a non-ancestor is retained for audit but removed
  from the reduction, which is then recomputed. For issue comments,
  `created_at` and `updated_at` must be canonical, with
  `updated_at >= created_at`, and `updated_at` is the revision time. Because
  REST issue-comment timestamps have one-second granularity, two issue comments
  in the same revision second are always ambiguous; even
  `created_at == updated_at` cannot prove no same-second edit, and IDs never
  break that tie. Same-time pull-request reviews may use the larger canonical
  ID only within the review channel; cross-channel ties remain ambiguous.
- Treats a clean bound to a proven ancestor as stale audit evidence and a clean
  bound to a proved non-ancestor as audit-only evidence removed before
  re-reduction. Only an ancestry relationship still unknown after bounded
  retry writes stable `error` with `ancestry-unverified`.
- Validates official provider identity and strong commit binding. A clean
  issue comment contains exactly one `Reviewed commit` marker. A pull request
  review binds through its native full `commit_id`, and any reviewed-commit
  hash in its body must agree with that value.
- Accepts clean results only through a closed provider grammar; finding-shaped content takes precedence over a clean-looking lead or `APPROVED` state.
- Treats a configured provider's `Codex Review` comment, with an optional Markdown heading and emoji, as a broad terminal candidate. An exact valid one-line `in progress` / `still in progress` artifact, with an optional period or colon plus one to 160 metadata characters, keeps the existing marker and deadline pending without acknowledging, resetting, extending, or reposting it. A candidate such as `completed` is deterministically malformed and writes `error` rather than being ignored.
- Rebuilds a complete evidence snapshot on every reconciliation. Historical
  `pending` or `error` states and closed wait outcomes are audit-only. A
  transient incomplete API or pagination attempt stops blocking only after a
  complete current snapshot is rebuilt; malformed, identity, schema, and
  commit parsing/binding errors still present in that snapshot remain global
  blockers and cannot be superseded by a later clean.
- Bounds each PR's evidence work to 64 MiB and 1,024 fetch attempts shared across snapshots and retries, with an 8 MiB streaming cap per response, 20,000 items per snapshot, and concurrency of four for HTTP and review-thread completion.
- Keeps a trusted sticky PR state comment with hidden metadata.
- Serializes controlled `@codex review` marker comments.
- Keeps controlled marker comments minimal and writes the generative AI review disclosure to the GitHub Actions step summary.
- Treats `+1` reactions as audit-only signals with no verdict authority.
  `eyes` is liveness-only: it may move `waiting_ack` to `waiting_result`, but
  it neither passes the gate nor extends any deadline.
- Uses scheduled or manual resume runs to retry unacknowledged or stalled markers.
- Fails closed when the current reconciliation cannot load or validate all
  required evidence. Transient acquisition or reconciliation faults receive
  bounded retries and then write stable `error`; deterministic malformed,
  identity, schema, commit-binding, or `ancestry-unverified` faults write
  `error` after their required bounded check.
- Gives a confirmed current-head or ancestor finding precedence over a
  simultaneous evidence error: the status remains `failure`, and its summary
  mentions the evidence issue. `error` is used only when no confirmed blocking
  finding is available.
- Reconciles complete review evidence before applying marker wait deadlines.
  Marker deadlines close or retry waits; they do not set an acceptance window
  for provider artifacts. A valid current-head clean artifact created after a
  marker deadline can pass on a later complete run.
- Uses sticky state, controlled markers, baselines, deadlines, recovery mode,
  and status history only for request orchestration, retry, liveness, audit,
  and idempotency. None of them authorises or rejects provider evidence.
- Before success, caches the newest same-context live status and its producer,
  re-reads PR lifecycle and head, re-reads complete evidence, and repeats the
  reduction. The head, PR state, complete evidence, and selected result must be
  stable across final validation before the success write. The final reduction
  certificate binds each selected or applicable issue-comment carrier's
  `created_at`, `updated_at`, and carrier digest.
- In receipt mode, always POSTs the computed status from the current run
  attempt so the receipt can bind the new REST response. Outside receipt mode,
  it may deduplicate only when the newest same-context record has the desired
  state and comes from exact `github-actions[bot]` / `Bot`.
- Migrates legacy marker and recovery fields for orchestration continuity
  without using them as provider-evidence authority.
- Accepts deprecated failed-findings recovery inputs for v1 interface
  compatibility; their values no longer change gate decisions or request
  orchestration.
- Evaluates official automatic-review and controlled-request output under the
  same identity, closed-grammar, current-head, and complete-snapshot rules.

## Files

- `action.yml`: composite action wrapper for the runner.
- `src/gate.mjs`: GitHub Actions runner script.
- `src/core.mjs`: testable state and signal helpers.
- `decision-table.json`: machine-readable authoritative reducer policy for
  `policy_version: 1.4.0`.
- `producer-receipt.schema.json`: producer receipt v1 JSON Schema.
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
      - id: gate
        uses: JoeyTeng/codex-review-gate-action@<v1.4.0-action-commit-sha>
        with:
          github-token: ${{ github.token }}
          pull-request: ${{ github.event.pull_request.number || github.event.issue.number || github.event.inputs.pull_request }}
          head-sha: ${{ github.event.pull_request.head.sha || '' }}
          event-mode: ${{ vars.CODEX_REVIEW_GATE_EVENT_MODE }}
          codex-bot-logins: ${{ vars.CODEX_REVIEW_GATE_BOT_LOGINS }}
          completion-signal-buffer-seconds: ${{ vars.CODEX_REVIEW_GATE_COMPLETION_SIGNAL_BUFFER_SECONDS }}
```

The placeholder is intentional in source documentation because the exact
action-repository split commit does not exist until source merge and sync. The
v1.4.0 release notes and release provenance manifest publish its exact 40-SHA.
Replace the placeholder before merging this workflow. Floating `@v1.4` and
`@v1` remain convenience aliases only and are never the canonical or
provenance-bearing invocation.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `github-token` | required | Token used to read PR review state, create comments, and write commit statuses. |
| `pull-request` | empty | Pull request number to gate. Leave empty for event payload routing or open-PR scans. |
| `head-sha` | empty | Deprecated compatibility input. Event-driven runs load the current PR head from GitHub. |
| `status-context` | `codex/review-gate` | Commit status context written by the gate. |
| `state-marker` | `codex-review-gate-state` | Hidden HTML marker used for the sticky state comment. |
| `marker-comment-marker` | `codex-review-gate-marker` | Hidden HTML marker used for controlled Codex request comments. |
| `max-wait-seconds` | `7200` | Overall marker wait budget used for retry and liveness orchestration. |
| `marker-timeout-seconds` | `3600` | Time to wait for an acknowledged marker result before retrying. |
| `marker-ack-timeout-seconds` | `300` | Initial time to wait for Codex to acknowledge a marker before retrying. |
| `marker-ack-timeout-max-seconds` | `1800` | Maximum exponential backoff wait for unacknowledged markers. |
| `completion-signal-buffer-seconds` | `30` | Deprecated v1 interface-compatibility input. Accepted values no longer change gate decisions or request orchestration. |
| `failed-findings-recovery` | empty | Deprecated v1 interface-compatibility switch. Accepted values no longer change gate decisions or request orchestration. |
| `failed-findings-recovery-mode` | empty | Deprecated v1 interface-compatibility input. `head` and `fresh` no longer change gate decisions or request orchestration. |
| `event-mode` | empty | Event mode override: exactly `standard`, `comment-only`, or `full`. Empty falls back to `CODEX_REVIEW_GATE_EVENT_MODE` or `standard`. |
| `poll-interval-seconds` | `30` | Deprecated compatibility input. Event-driven runs do not poll. |
| `bootstrap-grace-seconds` | `60` | Deprecated compatibility input. Event-driven runs create controlled markers directly. |
| `bootstrap-timeout-seconds` | `3600` | Deprecated compatibility input. Bootstrap now closes after the grace period and starts a controlled marker. |
| `codex-bot-logins` | `chatgpt-codex-connector,chatgpt-codex-connector[bot]` | Comma-separated GitHub logins accepted as Codex bot identities. |
| `trusted-comment-logins` | `github-actions[bot]` | Comma-separated GitHub logins trusted for gate state and marker comments. |

## Outputs

On an exact-40-SHA GitHub.com invocation that finalizes and uploads a producer
receipt, the composite exposes the following values. With the sample step ID,
read them as `steps.gate.outputs.<output-name>`.

| Output | Description |
| --- | --- |
| `producer-receipt-artifact-id` | GitHub artifact ID for this exact run attempt's receipt. |
| `producer-receipt-artifact-url` | Web URL ending in `/actions/runs/<run_id>/artifacts/<artifact_id>` for that artifact; this is not the REST artifact `.url`. |
| `producer-receipt-artifact-digest` | Raw 64-hex SHA-256 digest reported by the exact-pinned receipt upload step. This is an integrity checksum, not a signature or attestation. |

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

## Invocation Provenance

The canonical workflow pins
`JoeyTeng/codex-review-gate-action@<exact-action-repository-40-sha>`.
Floating `@v1.4` and `@v1` aliases are convenience-only. The Workflow Run API
can identify the workflow revision that ran, but it cannot prove the resolved
action commit behind a floating `uses` reference.

A Commit Status record's target head, `context`, `creator`, and `target_url`
are consistency evidence only. They are not invocation provenance: a workflow
with `statuses: write` can reproduce the status context and target URL, and
may use the same generic `github-actions[bot]` creator.

Commit Status is per repository SHA and context, not per pull request. Open PRs
that share a head SHA share the same status and branch-protection signal. The
status therefore cannot prove PR isolation; the selected receipt `statuses[]`
entry's PR number and independently reduced provider evidence must both match
the selected current PR.

On GitHub.com, an exact-40-SHA composite invocation emits producer receipt v1
under [`producer-receipt.schema.json`](producer-receipt.schema.json). It binds
`GITHUB_WORKFLOW_REF/SHA`, GitHub.com's `job.workflow_ref`, `workflow_sha`,
`workflow_repository`, and `workflow_file_path` contexts, plus
`github.action_repository/ref`. Only an exact 40-SHA action ref yields
`immutable: true`; floating or local invocations yield an unusable
`immutable: false` receipt. Job workflow fields and this receipt contract are
GitHub.com-only.

Receipt mode uses the attempt-specific
`/actions/runs/<run_id>/attempts/<attempt>` target URL. Each receipt-enabled
`setCommitStatusIfNeeded` forces a POST from that attempt and records the REST
response ID, node ID, exact echoed fields, creator, full head, and PR. A scan
receipt may contain several ordered statuses. Only `completed` or `failed`
receipts are eligible for one action-level, `overwrite: false` upload attempt
per finalized run attempt through exact-pinned
`actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02`
(`v4.6.2`). The producer does not claim exactly-once artifact creation;
consumer inventory must prove exactly one. The attempt-specific path is the
Workflow Run request endpoint and status target. Workflow Run response
`url`/`html_url` fields remain base-run resource URLs and are not required to
equal that attempt URL.

Any consuming review or readiness skill must:

1. Query the Artifact API for the exact run, attempt-specific receipt name,
   and require `total_count == 1`. When outputs are available, match the REST
   ID to the output ID; construct
   `<server>/<repository>/actions/runs/<run_id>/artifacts/<artifact_id>` and
   match that web URL to the output instead of comparing REST artifact `.url`.
   Require REST `.digest` to equal `sha256:` plus the raw 64-hex output digest,
   then verify the download digest, exactly one expected file, and the v1
   schema.
2. The receipt schema permits finalized `completed` and `failed` results, but
   a positive review or readiness decision must require
   `execution.result == completed`; a `failed` receipt remains audit evidence
   only. Also require the current repository, exact run/attempt/target, exact
   expected workflow/job fields, and the expected action repository and
   40-SHA with `immutable: true`. Fetch the attempt through the attempt-specific
   Workflow Run request endpoint; do not require its response `url` or
   `html_url` to be attempt-specific.
3. REST-list statuses for the exact current head, select the case-insensitive
   logical context's latest record, then require the exact configured context
   spelling (`codex/review-gate` by default) and creator
   `github-actions[bot]` with type `Bot`. Select the unique matching receipt
   `statuses[]` member for the current PR—not necessarily the last member—and
   match its PR number, `id`, `node_id`, head, context, state, target URL, and
   `creator`. A positive decision requires exact `status.state == success` for
   the selected REST record and receipt member; that selected creator must
   independently be exact `github-actions[bot]` with type `Bot`. Missing or
   non-unique membership
   fails closed.
4. Re-read the node as GraphQL `StatusContext` and require exact context, state,
   target URL, and head across the receipt, REST, and GraphQL node; retain the
   receipt/run/current-state action SHA and workflow/job bindings. Require its
   creator independently to be exactly `github-actions[bot]` with type `Bot`;
   creator agreement alone is insufficient. A `StatusContext` does not supply
   PR isolation.
5. Independently reload and reduce provider evidence for the same PR named by
   the selected receipt member. The receipt does not prove clean evidence or
   merge readiness.
6. Immediately before readiness consumption, final-REST-list the exact-head
   statuses and require the case-insensitive logical latest to remain the same
   REST ID/node ID with the exact context. Stably re-read PR head/lifecycle,
   exact run-attempt metadata, and the run-level artifact inventory queried
   with the attempt-specific name, which must still contain exactly one
   artifact; every binding and the
   independently reduced provider snapshot must remain stable. Changes receive
   bounded retry and then fail closed.

Status POST and artifact upload are not atomic, and artifacts can expire or be
deleted. Upload failure, Artifact API absence or multiplicity, unfinished
execution, no matching status, or any invalid receipt fails closed even if a
status exists. Receipt v1 is causal producer evidence only and never replaces
independent provider reduction. Its digest is integrity evidence, not a
cryptographic signature, OIDC attestation, or content-addressed storage
guarantee. Exact creator checks remain spoofable with `statuses: write`; only
the validated receipt/run chain adds causal consistency. These point-in-time
re-reads do not eliminate TOCTOU or make a per-SHA/context status prove a
PR-specific fact. See
[DESIGN.md](DESIGN.md#invocation-provenance-boundary) for the full contract.

## Operational Notes

- The workflow does not execute PR code.
- The workflow should have both `issues: write` and `pull-requests: write` so it can create PR conversation comments.
- For the clearest request flow, repositories may disable Codex automatic
  review-on-push to reduce duplicate reviews. Automatic and controlled-marker
  results are evaluated by the same provider-evidence rules; the marker does
  not authorise either result.
- The runner fully paginates REST comments, reviews, inline comments, and GraphQL review threads before it can pass.
- Official REST evidence must come from an accepted Bot identity. Top-level issue comments also require the official `chatgpt-codex-connector` GitHub App by default.
- REST evidence IDs must be positive safe integers; GraphQL opaque and `fullDatabaseId` fields must use their canonical string forms. Duplicate provider, review, inline-comment, or thread identities fail closed, including on resolved threads.
- Reviews bind through the native full `PullRequestReview.commit_id`; any
  reviewed-commit hash present in the review body must agree with it. Inline
  comments bind through their parent review and `original_commit_id`, not
  GitHub's mutable relocated `commit_id`.
- A reconciled inline comment lets its `COMMENTED` parent use the closed official inline-review wrapper without blob links in the wrapper body. The wrapper's reviewed-commit marker must still match the parent's full `commit_id`; unknown parent bodies fail closed.
- Top-level clean comments must contain exactly one reviewed-commit marker. A
  short marker must resolve uniquely through the repository commit API to the
  full current-head SHA.
- The closed clean structure requires the exact issue-comment lead and then permits either no tagline or one nonempty, trimmed, same-line presentation tagline separated by exactly one ASCII space and bounded to 160 UTF-16 code units. A tagline must be one known stem—`Nice work`, `Chef's kiss`, `What shall we delve into next`, `Already looking forward to the next diff`, `Keep them coming`, `Swish`, `Another round soon, please`, `Breezy`, `Can't wait for the next one`, `More of your lovely PRs please`, `Bravo`, `Keep it up`, `Delightful`, `Hooray`, or `You're on a roll`—plus exactly one final `.`, `!`, or `?`; exact `:rocket:`, `:tada:`, or `:+1:`; or one to eight exact RGI emoji graphemes, adjacent or separated by one ASCII space. Every unknown prose tagline fails closed, whether positive, actionable, or contradictory. The tagline is presentation only and never supplies clean or finding evidence. The comment still requires exactly one 10- or 40-hex reviewed-commit line and either no suffix or the exact official disclosure. An `APPROVED` review must be empty, exact `Looks good.`, or have a unique exact final `No findings.` optionally after one summary of at most 240 characters. That summary must begin with exact `Coverage:` or `Review coverage:` and continue with a comma/`and`-separated list of backtick-wrapped identifier or path tokens matching `[A-Za-z0-9_./:@+-]+`, with only an optional final period; verb-led and other prose are rejected. A whole normalized target equal to `P0`–`P3`, `S0`–`S3`, `critical`, `high`, `medium`, `low`, `finding`, `findings`, `blocker`, `blocking`, `found`, `detected`, `data-loss`, or `auth-bypass` is rejected, but those words inside a real path or identifier are not blanket-rejected. Finding signals always win.
- Review-body and unthreaded top-level findings must use exact `github.com` links for the gated owner and repository with a full commit SHA. Unknown or conflicting current formats fail closed.
- An exact joined thread containing a current-head or ancestor finding stops
  blocking only when authoritative `isResolved` is exactly `true`;
  `isOutdated` and a later clean result do not close it. An older threadless
  same-head or ancestor finding is superseded only by the strictly later
  selected current-head clean. A proved non-ancestor finding is audit-only and
  is removed before the evidence is reduced again. Issue comments require
  canonical `created_at` and `updated_at`, with `updated_at >= created_at` and
  `updated_at` as revision time. Two issue comments in the same revision second
  are always ambiguous: `created_at == updated_at` cannot prove no same-second
  edit, so IDs never break the tie. Same-time pull-request reviews retain the
  canonical ID tie-break only within the review channel; cross-channel ties
  remain ambiguous.
- A clean bound to a proven ancestor is stale audit evidence. A clean bound to
  a proved non-ancestor is audit-only and removed before re-reduction; only an
  unknown relationship after bounded retry writes stable
  `ancestry-unverified` error.
- Ancestor checks validate the documented REST commit-comparison fields and their closed relationship/count matrix against the exact 40-hex `base...head` request. The unpaginated `commits` list must have `min(ahead_by, 250)` unique full-SHA entries, exclude the base and merge-base commits, and bind its nonempty final entry to the requested head. Checks ignore undocumented `head_commit`, perform no extra head-commit GET, and fail closed on any schema or relationship contradiction. An unknown relationship receives bounded retry and then a stable `error` described as `ancestry-unverified`.
- Sticky state, controlled markers, baselines, deadlines, recovery mode, and
  status history support request orchestration, retry, liveness, audit, and
  idempotency only. They neither authorise nor reject provider evidence. A
  rerun reconstructs current evidence and can reassert `success` over a later
  stale `pending` or `error` status, including from a valid clean artifact
  created after an earlier marker deadline.
- The optional status-deduplication GET is independent best-effort work: 100 statuses per page, at most 10 pages or 1,000 items, 1 MiB per response, 4 MiB total, and 16 fetch attempts. It selects the first (newest) same-context record before checking producer identity. Failure or exhaustion becomes `readFailed` and does not taint review evidence. Receipt mode always POSTs the current attempt's computed status; outside receipt mode, `readFailed` also causes a direct POST.
- A review-evidence budget failure aborts active evidence requests and becomes
  `error` after bounded retry. When loads expose both an evidence issue and a
  confirmed blocking finding, `failure` wins and its summary mentions the
  evidence issue; without a confirmed finding, the evidence issue writes
  `error`.
- Retryable REST and GraphQL responses honour valid `Retry-After` delays up to 10 seconds. Longer delays stop immediately, while missing or malformed values use bounded fallback retries; the header never expands the existing retry-safe method/status set.
- Older short-SHA clean results are resolved lazily only when an older unthreaded finding's supersession depends on them.
- Transient acquisition and reconciliation faults, including evidence-budget
  exhaustion, use bounded retry and then write stable `error`. Deterministic
  malformed, provider schema, identity, commit-binding, or ancestry conflicts
  also write `error` and exit non-zero when no confirmed finding controls the
  mixed result.
- Default retry and liveness windows remain exactly 300 seconds for initial
  acknowledgement, 1,800 seconds for maximum acknowledgement backoff, 3,600
  seconds for an acknowledged result, and 7,200 seconds overall. `eyes` only
  changes `waiting_ack` to `waiting_result`; it does not reset or extend any
  deadline. The recommended schedule checks retry deadlines every 2 hours.
  These windows do not limit provider-artifact validity.

## Feedback and Reporting

Use [GitHub issues](https://github.com/JoeyTeng/codex-review-gate-action/issues) to report action bugs, bad gate behaviour, documentation gaps, or Marketplace listing issues. If a pull request receives problematic AI-generated review content, use GitHub's normal reporting and feedback tools for that specific comment or review, and include a link in an issue when it is relevant to this action's gate behaviour.

## Source and Development

This repository is the Marketplace release package. Development, CI, and self-gating workflows are maintained in [JoeyTeng/codex-review-gate](https://github.com/JoeyTeng/codex-review-gate).
