# Codex Review Gate v2

Languages: [British English (en-GB)](README.md) | [简体中文 (zh-CN)](README.zh-CN.md)

Codex Review Gate reduces trusted OpenAI Codex review evidence for one pull
request to the required `codex/github-review-gate` commit status. Every run
rebuilds its decision from GitHub. A database, workflow artifact, sticky
comment or earlier run is never decision authority.

The public Action is released from
[`JoeyTeng/codex-review-gate-action`](https://github.com/JoeyTeng/codex-review-gate-action).
Canonical source, tests and release automation live in
[`Joey-Tools/codex-review-gate`](https://github.com/Joey-Tools/codex-review-gate).

## Install the complete consumer contract

Consumers use the floating major:

```yaml
- uses: JoeyTeng/codex-review-gate-action@v2
```

That step alone is not an installation. Copy the complete
[canonical workflow](https://github.com/Joey-Tools/codex-review-gate/blob/master/templates/codex-gated-repo/.github/workflows/codex-review-gate.yml)
and import the supplied
[disabled ruleset template](https://github.com/Joey-Tools/codex-review-gate/blob/master/templates/codex-gated-repo/rulesets/codex-review-gate.json).
The copied workflow owns triggers, typed dispatch inputs, permissions,
concurrency, runner-free event filtering and the stable status context. A
reusable workflow is not the v2 consumer ABI.

The ruleset must require all four server-side conditions:

- `codex/github-review-gate`, with expected source GitHub Actions;
- the branch is up to date;
- all review conversations are resolved; and
- non-fast-forward updates to the default branch are blocked.

Keep the imported ruleset disabled until a harmless canary has proved the
actual status source and complete wiring. The
[human-readable guide](https://github.com/Joey-Tools/codex-review-gate/blob/master/docs/install/human.md)
explains the installation to a person. The
[agent-executable guide](https://github.com/Joey-Tools/codex-review-gate/blob/master/docs/install/agent.md)
lets an agent perform that same installation for a person.

## Trigger contract

The canonical workflow has only these entries:

- `pull_request_target` with activity type `edited`, admitted only for an
  actual base-ref retarget back to the repository default branch;
- `issue_comment` with activity types `created` and `edited`; and
- `workflow_dispatch` for one explicitly selected pull request.

There is no cron, `repository_dispatch`, broad `pull_request` reset job or
writable automatic `pull_request_review` job. Review objects and reaction-only
completion are discovered by a later reconcile.

An automatic comment job is admitted before runner allocation only when both
the event sender and comment author are the exact Codex provider:
`chatgpt-codex-connector[bot]`, GitHub type `Bot`. The Action repeats identity
and scope checks after the runner starts. An edited Codex comment may invalidate
an earlier decision, which is why both `created` and `edited` are admitted.
The base-retarget job is likewise filtered before runner allocation: title,
body and other edits do not start a runner. A qualifying retarget immediately
replaces any persistent success on the unchanged head with pending.

Manual runs use the protected default-branch workflow. A feature-ref dispatch
is unsupported. The typed `workflow_dispatch` business inputs are:

| Input | Type | Contract |
| --- | --- | --- |
| `operation` | choice | `reconcile` or `begin-review`; defaults to `reconcile`. |
| `pr_number` | number | Required canonical positive PR number. Exactly one PR is processed. |
| `expected_head_sha` | string | Required full expected PR-head SHA. A stale run never follows a different head. |
| `request_comment_id` | string | Optional evidence-location hint; never authority. |
| `request_review` | boolean | Defaults to `true`; controls request posting for `begin-review`. |
| `limits_profile` | choice | `default` or `expanded`; defaults to `default`. |

Every dispatch value is untrusted and revalidated against GitHub. Inputs
cannot provide a verdict, provider identity, status context, stale override,
numeric resource limit or permission to skip a full reconcile. A hint may
allow an early stop only after the runtime proves that no newer relevant
evidence was skipped. GitHub exposes the typed numeric `pr_number` as a string
at the Action boundary; the Action still requires its canonical positive
decimal representation.

The Action step uses the corresponding underscore-named inputs:
`github_token`, `pr_number`, `expected_head_sha`, `operation`,
`request_comment_id`, `request_review` and `limits_profile`. `github_token` and
`pr_number` are required. A manual run must supply the full
`expected_head_sha`; the automatic comment path may leave it empty so the
runtime can bind the authoritative head at startup. Neither path may follow a
later head change.

## Operations

### `begin-review`

`begin-review` validates the exact PR and expected head, establishes pending
on that head, and by default posts a fresh exact `@codex review` request with
the canonical hidden binding. `request_review=false` only establishes pending;
it is an advanced best-effort option and does not add a dedicated cross-job
barrier.

Runs for the same PR are serialised with `cancel-in-progress: false`. GitHub can
still replace a not-yet-started pending workflow run, so observe the exact
`begin-review` run complete before treating it as a barrier or posting a
dependent request.

For the usual low-cost path, an agent may post exact `@codex review` directly
while other checks run and invoke GHA only when reconciliation is needed. Use
`begin-review` when the workflow must coordinate the pending transition and
request, including a deliberate same-head re-review after an earlier success.

### `reconcile`

`reconcile` first re-reads the selected PR. Only while its head equals the
bound expected head does it replace that exact SHA's gate status with pending
and collect evidence. It never retargets the run or writes the decision to a
new head. A later run must handle a changed head.

The reducer reads qualifying Codex top-level issue comments and pull-request
review bodies. Inline review threads are deliberately outside the reducer;
the ruleset's “all conversations resolved” requirement is their authority.

## Evidence semantics

A review generation begins with an exact, unedited `@codex review` request.
The visible first line is exact and contains no additional visible text. An
ordinary request author needs `write`, `maintain` or `admin` permission by
default; protected default-branch configuration may deliberately relax this
to `any`. A workflow-authored request additionally carries the canonical v2
hidden marker binding the full head SHA, current base repository/ref/SHA and
workflow run. Qualifying Codex findings block regardless of request-author
permission.

Every snapshot also reads the latest GitHub PR timeline
`BaseRefChangedEvent` or `BaseRefForcePushedEvent`. Positive request and clean
authority must be strictly newer than that base epoch; equal timestamps are
ambiguous and stay pending. A provider terminal payload does not identify the
request or base snapshot that produced it, so a PR with an observed base epoch
uses a deliberately narrower recovery rule: only a qualifying provider `+1`
attached directly to a strictly post-epoch, base-bound canonical workflow
request can supply positive clean authority or supersede an older finding.
Ordinary direct `@codex review` requests remain supported without a workflow
marker on PRs that have no base epoch. Findings remain conservative across the
epoch boundary, and an unlineaged terminal clean stays pending rather than
being guessed into the new generation.

Terminal clean text and a qualifying provider `+1` otherwise have equal clean
authority; the base-epoch lineage rule above is the deliberate exception.
When terminal evidence names a reviewed commit, it may use a full or short SHA.
A short SHA is accepted only when GitHub resolves it unambiguously to the
current PR head. For a pull-request review, the resolved SHA must also agree
with the review's native `commit_id`.

Any qualifying current-head non-inline finding blocks immediately. On the
same head, an older finding can be superseded only by:

1. a strictly newer authorised review generation; and
2. a later clean result bound to that generation and head.

An arbitrary later clean does not erase findings. Ambiguous order or binding
cannot pass. Historical findings remain visible in diagnostics.

## Stable clean and limits

A finding can decide failure from the first complete observation. Only a clean
candidate must survive two independent, fully paginated GitHub snapshots five
seconds apart. Each snapshot covers the fixed PR lifecycle, base and head; the
latest filtered base-change/force-push timeline epoch;
request IDs, revisions, authors and reactions; qualifying Codex comments and
reviews with their identities, times, actor/App identity and body digests;
reviewed-SHA resolution and native review `commit_id`; and pagination and
exact-refetch completeness.

The head and decision-relevant fingerprint must match across both reads. A
same-head request, edit, reaction or other relevant evidence change restarts
the stability window. A head/lifecycle mismatch makes the run stale. API,
pagination and cap failures are incomplete observations, never evidence of
stability. If no stable clean pair is available within the reconcile budget,
the gate stays pending for a later provider event or manual reconcile.

The reviewed profiles are fixed:

| Profile | Pages | Raw objects | API attempts | Snapshot | Request timeout | Reconcile budget |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `default` | 20 | 2,000 | 128 | 32 MiB | 10 s | 60 s |
| `expanded` | 100 | 10,000 | 512 | 64 MiB | 20 s | 300 s |
| hard ceiling | 1,000 | 20,000 | 2,048 | 64 MiB | 30 s | 720 s |

Page size is 100, one response is capped at 8 MiB, the inter-read delay is five
seconds and the job timeout is 14 minutes. A repository may persistently select
`expanded`. Temporary per-dispatch numeric overrides are not part of v2.0.

## Public result ABI

The Action exposes exactly four public outputs:

| Output | Values | Meaning |
| --- | --- | --- |
| `execution_health` | `healthy`, `unhealthy` | Whether the evaluator completed trustworthily. |
| `gate_outcome` | `success`, `failure`, `pending`, `not_applicable`, `unknown` | The review-gate decision. |
| `recovery_code` | closed set below | The safe next-action category. |
| `retry_safe` | boolean | Whether an immediate retry with identical inputs is a valid recovery action. |

The closed `recovery_code` set is:

```text
none
wait_provider
reconcile
fix_findings
request_clean_generation
retry_reconcile
wait_then_reconcile
use_expanded_limits
raise_protected_limit
refresh_head
repair_permissions
retry_begin
unsupported_target
```

Workflow conclusion reports execution health; the status on the expected PR
head reports gate outcome. Findings normally produce `healthy/failure`, not an
execution error. `unhealthy/success` is invalid. `status_projection` and the
finding counts are summary-only, not public Action outputs.

When they can be derived without another evidence query, the sticky diagnostic
and Actions summary report:

- `findings_unresolved`;
- `findings_resolved`;
- `findings_historical`;
- `findings_indeterminate`.

Incomplete API reads, pagination or cap hits make affected counts `unknown`,
never `0`. These counts cover only normalised non-inline reducer findings and
do not replace conversation-resolution enforcement.

See [DESIGN.md](DESIGN.md) for the authority and consistency model and
[COOKBOOK.md](COOKBOOK.md) for recovery procedures.

## Exact-head merge closure

A success is an observation, not a permanent lease. Immediately before merge,
an agent must dispatch `reconcile` with the exact current head and require all
of the following at one final read:

- Action result `healthy/success`;
- `codex/github-review-gate` success from GitHub Actions on that same head;
- the PR head remains unchanged;
- the branch is up to date;
- all review conversations are resolved; and
- the ruleset allows the merge.

If any item changes, stop and reconcile the new current state.

## Supported boundary

Stable v2.0 supports GitHub.com public and private repositories; ordinary
same-repository branches with an open, non-draft PR targeting the default
branch; GitHub-hosted Linux runners (`ubuntu-slim`, with `ubuntu-latest` as the
adopted fallback); and ordinary merge, squash and rebase methods.

It fails closed for GHES, forks, merge queues, non-default bases, drafts,
bot-owned PRs, self-hosted/Windows/macOS runners, and new operations on closed
or merged PRs.

The runtime is API-only. It does not check out or execute consumer/PR code,
upload artifacts, retain raw API payloads, or introduce a runtime GitHub App.
Diagnostics are best effort and never authority.

## v1 boundary

Existing v1 consumers remain valid until deliberately migrated. v2 does not
rewrite, republish or fall back to v1. A consumer may remove v1 and install v2
in one PR, then validate the installed `@v2` gate in a separate harmless PR
that is closed without merging.

## Feedback

Report public package issues at
[`JoeyTeng/codex-review-gate-action`](https://github.com/JoeyTeng/codex-review-gate-action/issues).
