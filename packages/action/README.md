# Codex Review Gate

Languages: [British English (en-GB)](README.md) | [简体中文 (zh-CN)](README.zh-CN.md)

## QuickStart

1. Copy the thin caller in [Workflow Usage](#workflow-usage) to
   `.github/workflows/codex-review-gate.yml`.
2. Keep its canonical reusable-workflow reference at
   `JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1`,
   merge it to the default branch, then open a follow-up test PR.
3. After `codex/review-gate` behaves as expected, add it as a required status check. For recovery recipes, see the [cookbook](COOKBOOK.md).

> [!IMPORTANT]
> v1.5.1 is the first admitted v1.5 baseline. v1.5.2 adds the targeted
> scheduled-scan semantic downgrade selected by
> `codex_review_gate_trigger: scheduled-target-v1`. Downstream repositories must
> not enable the sentinel scheduler until the immutable v1.5.2 release and
> provenance asset are published, the `v1.5` and `v1` aliases are verified, and
> a live canary passes. The sentinel only selects a capability-reducing route;
> it is not source authentication or provenance.

`codex-review-gate` is a reusable GitHub workflow backed by a composite Action.
It owns a deterministic
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
- `.github/workflows/codex-review-gate.yml`: canonical GitHub.com reusable
  workflow, including the trusted event filters and exact self-checkout.
- `src/gate.mjs`: GitHub Actions runner script.
- `src/core.mjs`: testable state and signal helpers.
- `decision-table.json`: machine-readable authoritative reducer policy for
  `policy_major: 1` and `policy_version: 1.4.0`.
- `producer-receipt.schema.json`: producer receipt v1 JSON Schema.
- `DESIGN.md`: target signal model, state machine, and GHA cost model.
- `COOKBOOK.md`: normal operating path and failure recovery recipes.

## Advanced Operation

For the event-driven review-gate design, state machine, automatic retry controls, **GHA cost model**, and recovery behaviour, see [DESIGN.md](DESIGN.md). For operator recipes, see [COOKBOOK.md](COOKBOOK.md).

The advanced design uses repository or organisation variables for controls that must take effect before a runner is allocated. For example, `CODEX_REVIEW_GATE_AUTO_RETRY=false` can skip scheduled retry jobs at the job `if` layer. Runtime `env` values are still useful for action behaviour after a job has started, but they cannot prevent GitHub Actions from assigning a runner.

A scheduler may fan out one PR at a time through `workflow_dispatch` by passing a
positive `pull_request` input together with the reserved
`codex_review_gate_trigger: scheduled-target-v1` event input. This selects the
stricter scheduled-scan semantics (`allowCreateMarker: false`) for that PR and
lets all status writers share a per-PR concurrency group. The reserved value is
not source authentication or provenance: a manual caller can supply it, but it
only removes capabilities compared with the ordinary manual recovery path.
Do not add it to `action.yml`; the runtime reads it from the authenticated
GitHub event payload.

The current source-root direct workflow defaults to `ubuntu-slim`. Direct
composite callers may set `CODEX_REVIEW_GATE_RUNNER_LABELS` to a JSON array such
as `["self-hosted","linux","x64","codex-review-gate"]`; the canonical reusable
workflow below deliberately ignores that variable and stays on `ubuntu-slim`.

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
  workflow_dispatch:
    inputs:
      pull_request:
        description: Pull request number to gate
        required: true
        type: string
      codex_review_gate_trigger:
        description: Reserved for scheduled per-PR dispatch
        required: false
        type: string

permissions:
  contents: read
  issues: write
  pull-requests: write
  statuses: write

concurrency:
  group: codex-review-gate-${{ github.repository }}-${{ github.event.pull_request.number || github.event.issue.number || github.event.inputs.pull_request }}
  cancel-in-progress: false

jobs:
  codex-review-gate:
    name: codex/review-gate runner
    uses: JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1
```

The main caller deliberately keeps the per-PR event set, permission ceiling,
and per-PR concurrency group. Put a periodic scan in a separate schedule-only
dispatcher that invokes this workflow once per PR with the reserved value;
never let a repository-global scan write statuses concurrently with this
per-PR caller. The reusable workflow owns the trusted job filters, runner
selection, timeout, exact called-repository checkout, and composite step. A
reusable-workflow calling job cannot contain `runs-on` or `steps`. Do not
duplicate the caller's concurrency group in
the called workflow; keep that cross-run serialisation boundary caller-side.

The called workflow receives the caller's `GITHUB_TOKEN` permissions and
cannot elevate them, so no `secrets: inherit` is needed. The four read/write
permissions above are the supported ceiling. The called workflow never checks
out the pull request or executes its code.

Reusable mode fixes `runs-on: ubuntu-slim`. Caller repository variables cannot
select a self-hosted or otherwise different runner, so the GitHub-hosted runner
is part of the trusted boundary for checkout output, worktree, and receipt
production. Direct composite mode remains caller-owned and may keep its
existing runner configuration. The GitHub-hosted boundary still is not a
cryptographic signature, OIDC attestation, or content-addressed storage proof.

Reusable receipt attribution also assumes that the caller workflow revision
and its complete job graph are independently trusted. A same-run malicious
sibling job can race to create the attempt-named artifact and write a matching
status before the called job completes. Exact-attempt `referenced_workflows` is
run-level corroboration and does not bind one job, callsite, or receipt.
Therefore the validated chain supplies causal consistency only inside the
trusted-caller plus fixed-hosted-runner boundary; it is not job-scoped
cryptographic attribution.

Floating `@v1` is the intentional, centralised pre-execution trust boundary:
release policy permits moving it only to a compatible v1.x release. It is not
post-run immutable provenance. Let `W` be the exact selected workflow object in
`job.workflow_sha`, the matching exact-attempt `referenced_workflows[].sha`, and
receipt `producer.action.ref`; let `C` be the checkout output commit, receipt
`producer.action.commit_sha`, and provenance `action.commit_oid`; and let `T` be
the independently signed `tags.v1.tag_object_oid`. The v1.5.0 live canary
observed `W == T`, but the closed contract also admits a future `W == C` shape.
Consumers require exactly one of those two candidates, always verify that `T`
peels directly to `C`, and do not pin a v1.5 SHA in this caller or in a consuming
Skill.

## Inputs

These are the direct composite Action inputs. The canonical reusable caller
does not expose them as `workflow_call` inputs; it derives routing from the
caller event and the documented repository or organisation variables.

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

On a supported GitHub.com invocation that finalises and uploads a producer
receipt, the reusable workflow exports these values as job-call outputs and
the direct composite exposes the same values as step outputs. With a direct
step ID of `gate`, read them as `steps.gate.outputs.<output-name>`.

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

After the rollout gate above, the canonical GitHub.com caller uses
`JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1`.
This floating major alias is the intentional centralised pre-execution trust
boundary: moving it upgrades all callers to a compatible v1.x release. It is
not post-run immutable provenance. In the current live shape, post-run
admission verifies the exact signed `v1` tag-object OID selected in
`job.workflow_sha` and its peel to the admitted action commit. The closed
resolution contract below also admits a future exact-action-commit shape;
neither the caller nor a consuming Skill pins the v1.5 SHA.

Inside the called job, `github.workflow_ref` and `github.workflow_sha` still
identify the caller workflow. The called implementation is identified by the
GitHub.com-only `job.workflow_repository`, `job.workflow_file_path`,
`job.workflow_ref`, and `job.workflow_sha` fields. The SHA field identifies the
selected workflow object. The v1.5.0 canary observed the annotated `v1` tag
object; the closed contract also admits the peeled action commit when GitHub
reports that exact object instead. The reusable workflow checks out the exact
selected object with a full-SHA-pinned `actions/checkout`,
`repository: ${{ job.workflow_repository }}`, and
`ref: ${{ job.workflow_sha }}`. The `checkout` step's official `commit` output
is the peeled action commit and reaches the local composite only as
`CODEX_REVIEW_GATE_CHECKED_OUT_ACTION_COMMIT_SHA: ${{ steps.checkout.outputs.commit }}`,
never a `workflow_call` or caller input. A bare checkout would select the caller
repository, so the trusted workflow never performs one and never checks out or
executes pull-request code.

The direct composite form remains compatible when it uses
`JoeyTeng/codex-review-gate-action@<exact-lower-case-40-sha>`. It is the
required fallback on GitHub Enterprise Server, where the reusable-workflow
`job.workflow_*` identity is unavailable. A floating direct composite
reference is non-authoritative, and a failed reusable validation must not be
opportunistically downgraded to direct mode. The receipt-based positive
provenance path remains GitHub.com-only; GHES fallback preserves direct gate
operation, not this receipt-backed admission claim.

A Commit Status record's target head, `context`, `creator`, and `target_url`
are consistency evidence only. They are not invocation provenance: a workflow
with `statuses: write` can reproduce the status context and target URL, and
may use the same generic `github-actions[bot]` creator.

Commit Status is per repository SHA and context, not per pull request. Open PRs
that share a head SHA share the same status and branch-protection signal. The
status therefore cannot prove PR isolation; the selected receipt `statuses[]`
entry's PR number and independently reduced provider evidence must both match
the selected current PR.

On GitHub.com, both supported forms emit producer receipt v1 under
[`producer-receipt.schema.json`](producer-receipt.schema.json). For the
canonical reusable tuple—exact action repository, workflow file, `refs/tags/v1`
job ref, and lower-case 40-hex `job.workflow_sha`—the producer maps that exact
selected workflow object OID to `producer.action.ref`. It independently maps the
full-SHA-pinned checkout step's official `commit` output to
`producer.action.commit_sha` and sets `immutable: true`; the checkout commit
must be the admitted action commit. The called workflow controls that
environment binding and exposes no caller input for it. Native action context
has structural priority: if either `github.action_repository` or
`github.action_ref` is present, the producer records that direct context and
ignores the reusable checkout-commit environment. Such a direct identity is
immutable only when its action ref is an exact lower-case 40-SHA. The reusable
W/C mapping is considered only when both native fields are absent and the job
tuple is exact canonical. A near-canonical tuple never upgrades identity or
supplies a fallback; with no native context it produces unusable
`immutable: false` action identity.

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

Any consuming review or readiness Skill must preserve four separate SHA
domains: the caller workflow definition (`github.workflow_sha`), the exact API
run-attempt head (`head_sha`), the called workflow's selected object identity
(`job.workflow_sha`), and the current pull-request/status head. None may be
substituted for another. Specifically, do not require the exact run-attempt
`head_sha` or Artifact API `workflow_run.head_sha` to equal the selected
receipt status head; do not require that run-attempt head to equal
`GITHUB_WORKFLOW_SHA`; and do not require `GITHUB_WORKFLOW_SHA` to equal
`job.workflow_sha`. The caller workflow SHA identifies the caller workflow
revision in a called workflow. Their authoritative machine-readable contract
is `producer_receipt_boundary` in
[`decision-table.json`](decision-table.json). The Skill must:

1. Query the Artifact API for the exact run, attempt-specific receipt name,
   and require `total_count == 1`. When outputs are available, match the REST
   ID to the output ID; construct
   `<server>/<repository>/actions/runs/<run_id>/artifacts/<artifact_id>` and
   match that web URL to the output instead of comparing REST artifact `.url`.
   Require REST `.digest` to equal `sha256:` plus the raw 64-hex output digest,
   then verify the download digest, exactly one expected file, and the v1
   schema.
2. The receipt schema permits finalised `completed` and `failed` results, but
   a positive review or readiness decision must require
   `execution.result == completed`; a `failed` receipt remains audit evidence
   only. Also require the current repository, exact run/attempt/target, caller
   workflow fields, and one explicitly selected structural mode. Reusable mode
   requires the exact canonical job tuple, action repository,
   `producer.action.ref == job.workflow_sha`, the independently bound checkout
   commit in `producer.action.commit_sha`, and `immutable: true`; direct mode
   requires the expected action repository and exact lower-case 40-SHA with
   action ref and commit SHA equal and `immutable: true`.
3. Fetch the attempt through
   `GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt}`; do not
   require its response `url` or `html_url` to be attempt-specific. Require the
   Artifact API record's `workflow_run.id` and `workflow_run.head_sha` to equal
   that response's `id` and `head_sha`. In reusable mode, require the optional,
   nullable `referenced_workflows` array to be present and contain exactly one
   entry matching the canonical repository/workflow path and v1 call. Let its
   required `sha`, `job.workflow_sha`, and receipt `producer.action.ref` be
   `W`; its `ref` must be present and equal `refs/tags/v1`. Require `W` to equal
   exactly one declared value in
   `runtime_closure.called_workflow.workflow_sha_resolution.candidates`, with
   each candidate value equal to its declared provenance field. The only
   admitted branches are current-live `W == T`, where `T ==
   tags.v1.tag_object_oid`, and future `W == C`, where `C ==
   action.commit_oid`. In both branches require the independently signed `T` to
   peel directly to `C`, and require `tags.v1.peeled_commit_oid ==
   action.commit_oid == producer.action.commit_sha`. Other object types, nested
   tag peels, and zero or multiple candidate matches fail closed. This is
   run-attempt-level corroboration only: GitHub exposes no entry-to-job or
   entry-to-receipt mapping and no cryptographic binding. Missing, null,
   malformed, or non-unique evidence fails closed.
4. In reusable mode, enumerate release candidates through the fully paginated GitHub Releases
   API and require exactly one published, immutable, non-draft,
   non-prerelease `v1.x.y` release whose trusted-signer tag peels to `C`, whose
   single provenance asset has the compatible closed schema/majors and
   `action.commit_oid == C`, and whose workflow-SHA candidate set contains `W`
   exactly once. Zero or multiple matching releases or assets fail closed.
   Require the independently signed annotated `v1` tag object `T` to peel
   directly to the same `C`, even in the future `W == C` branch. Verify both
   tags with a trusted primary signer fingerprint, plus the manifest's action
   root tree and critical-file bindings, receipt schema v1, and a compatible
   policy with `policy_major == 1`. Never infer a historical run from the
   current `v1` target. Canonical reusable callers accept compatible v1.x Action-only
   upgrades without a caller or Skill edit; direct callers must update their
   exact pin. A protocol or policy major change requires a coordinated Skill
   update.
5. In the current-PR/status head domain, REST-list statuses with the request
   `ref` equal to the exact current PR head; the selected status must come from
   that exact-head response. Select the case-insensitive logical context's
   latest record, then require the exact configured context spelling
   (`codex/review-gate` by default) and creator
   `github-actions[bot]` with type `Bot`. Select the unique matching receipt
   `statuses[]` member for the current PR—not necessarily the last member—and
   require its `head_sha` to equal that exact current PR head. Match its PR
   number, `id`, `node_id`, context, state, target URL, and `creator` to the
   selected REST record. A positive decision requires exact
   `status.state == success` for the selected REST record and receipt member;
   that selected creator must independently be exact `github-actions[bot]`
   with type `Bot`. Missing or non-unique membership fails closed.
6. Re-read the node as GraphQL `StatusContext` and require exact context, state,
   and target URL across the selected receipt status, REST record, and GraphQL
   node. Require `StatusContext.commit.oid` to equal the exact current PR head
   and therefore the selected receipt status `head_sha`; retain the
   receipt/run/current-state called SHA and workflow/job bindings. Require its
   creator independently to be exactly `github-actions[bot]` with type `Bot`;
   creator agreement alone is insufficient. A `StatusContext` does not supply
   PR isolation. The caller workflow, run-attempt, called implementation, and
   current PR/status SHA domains may legitimately differ; never invent an
   equality between them.
7. Independently reload and reduce provider evidence for the same PR named by
   the selected receipt member. The receipt does not prove clean evidence or
   merge readiness.
8. Immediately before readiness consumption, final-REST-list the exact-head
   statuses and require the case-insensitive logical latest to remain the same
   REST ID/node ID with the exact context. Stably re-read PR head/lifecycle,
   exact run-attempt metadata, and the run-level artifact inventory queried
   with the attempt-specific name, which must still contain exactly one
   artifact; every binding and the
   independently reduced provider snapshot must remain stable. Changes receive
   bounded retry and then fail closed.

The trusted-signer and release checks above are point-in-time evidence. They do
not guarantee that a key, signature, tag, or release was never revoked or will
remain unrevoked. A consumer that needs revocation freshness or historical
revocation guarantees must define and enforce that separate policy.

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
