# Codex Review Gate v2

Languages: [British English (en-GB)](README.md) | [简体中文 (zh-CN)](README.zh-CN.md)

Codex Review Gate reduces trusted OpenAI Codex review evidence for one pull
request to the native required CheckRun `codex/github-review-gate`. GitHub
records the verifier run/job/CheckRun against the exact PR feature-head SHA.
The canonical `pull_request` verifier still executes on
`refs/pull/N/merge`; inside the Action it strictly validates `GITHUB_REF`,
`GITHUB_SHA`, the event head/base/test-merge SHAs and a fresh PR read. A
protected top-level `run-name` makes GitHub expose
`codex-review-gate-verifier/<PR>/<current test-merge SHA>` as the run's exact
`display_title`; activation also requires the run's sole PR binding to contain
the current feature head and default-branch base SHA. These receipts bind a
successful feature-head CheckRun to the exact current test-merge, even though
the CheckRun itself is not attached to the test-merge SHA. Every verifier run
rebuilds its decision from GitHub. A
database, workflow artifact, sticky comment, controller run or earlier
verifier is never decision authority.

The public Action is released from
[`JoeyTeng/codex-review-gate-action`](https://github.com/JoeyTeng/codex-review-gate-action).
Canonical source, tests and release automation live in
[`Joey-Tools/codex-review-gate`](https://github.com/Joey-Tools/codex-review-gate).

## Install the complete consumer contract

Consumers use the floating major:

```yaml
- uses: JoeyTeng/codex-review-gate-action@v2
```

That step alone is not an installation. The complete installation has three
required repository asset groups:

- the complete two-workflow bundle: the read-only
  [canonical verifier](https://github.com/Joey-Tools/codex-review-gate/blob/master/templates/codex-gated-repo/.github/workflows/codex-review-gate.yml)
  and protected-default-branch
  [canonical controller](https://github.com/Joey-Tools/codex-review-gate/blob/master/templates/codex-gated-repo/.github/workflows/codex-review-gate-controller.yml);
- a managed `.github/CODEOWNERS` control plane whose two final effective rules
  protect `/.github/workflows/` and `/.github/CODEOWNERS`; and
- the supplied
  [disabled ruleset template](https://github.com/Joey-Tools/codex-review-gate/blob/master/templates/codex-gated-repo/rulesets/codex-review-gate.json).

Install them with the canonical
[`bootstrap-codex-review-gate.mjs`](https://github.com/Joey-Tools/codex-review-gate/blob/master/scripts/bootstrap-codex-review-gate.mjs)
helper, always passing an explicit `--control-plane-owner @USER`. Do not
reconstruct the workflow or managed CODEOWNERS rules by hand. The selected
owner must be a GitHub user with `write`, `maintain` or `admin` permission on
the consumer repository. The first migration PR contains both canonical
workflows and CODEOWNERS, not the ruleset mutation. Before merging it, keep
every legacy requirement active, bind a canonical read-only legacy inventory
SHA-256 into the owner approval snapshot and require a fresh identical inventory
in the final transaction. The digest binds repository/default branch, each
matching ruleset's full identity, source, enforcement, target, conditions,
`bypass_actors`, and `rules`, its complete effective
`required_status_checks` rule, and the complete classic required-status object
including each check's producer `app_id`. Even an empty legacy inventory has a
repository/branch-bound digest. Incomplete API/schema data or any drift fails
closed. Then require the authenticated actor to be that owner, freshly reread
the owner's exact-head approval, and use the synchronous
exact-SHA merge endpoint. Immediately after merge, first reread the current
default branch and require the PR to be merged with base and head still exactly
the approved scope. If that readback fails, keep every legacy requirement
active. After it succeeds, keep legacy active, stage a separate supplied v2
ruleset as Disabled, prove it with a harmless canary, then activate and read
back the exact complete Active policy. Every pre-cleanup stage/activation
preview and apply must explicitly reuse the same owner-approved digest across
processes through that Active readback. Only afterward may separately
authorised cleanup remove the inventoried legacy requirements. Before cleanup,
read-only `--derive-post-cleanup-plan` requires the same external
owner-approved legacy-inventory digest through
`--expected-legacy-inventory-sha256`, verifies that baseline against a
complete security snapshot, and emits a canonical, human-reviewable plan plus
an external expected post-cleanup security SHA-256. The only admissible delta
removes `codex/review-gate`. An emptied classic required-status policy, an
emptied ruleset status rule, and a dedicated legacy-only ruleset left with no
rules are the only structures that may disappear. Repository/default head,
workflow/CODEOWNERS inventory, owner permission, every field/non-legacy check
including `strict` and `app_id` in a surviving classic policy, and every
retained ruleset's identity, conditions, bypass actors, and unrelated rules are
preserved exactly. After
the separately authorised cleanup, read-only `--verify-post-cleanup` requires
that external digest through `--expected-post-cleanup-security-sha256` and
accepts only two identical complete security rounds,
each matching the expected digest, showing both legacy surfaces clear and the
same complete v2 policy Active. An inconclusive derivation, cleanup, or
verification leaves v2 Active and calls only for read-only diagnostics; it is
never a reason to disable or roll back v2.
Approval plus a head reread alone is insufficient.

The copied workflows own separate triggers, typed dispatch inputs,
permissions, concurrency namespaces and runner-free event filtering. The
verifier's GitHub-managed job CheckRun is the stable required signal. A
reusable workflow and a commit-status bridge are not the v2 consumer ABI.

The ruleset must require all server-side conditions:

- `codex/github-review-gate`, with expected source GitHub Actions;
- the branch is up to date;
- Code Owner review for the protected workflow and CODEOWNERS paths;
- stale approvals are dismissed after a push;
- all review conversations are resolved; and
- non-fast-forward updates to the default branch are blocked; and
- bypass actors are empty.

GitHub's required-check `integration_id: 15368` identifies the entire GitHub
Actions App, not either workflow alone. Exact-byte verification of both
canonical workflows, fail-closed workflow inventory, the managed CODEOWNERS
rules, required Code Owner review, stale-approval dismissal, strict up-to-date
policy, no bypass actors and canary collision checks form one compound
control-plane boundary. This is not cryptographic proof of one workflow.

Keep the imported ruleset disabled until a harmless canary has proved the
actual native CheckRun source and complete wiring. The
[human-readable guide](https://github.com/Joey-Tools/codex-review-gate/blob/master/docs/install/human.md)
explains the installation to a person. The
[agent-executable guide](https://github.com/Joey-Tools/codex-review-gate/blob/master/docs/install/agent.md)
lets an agent perform that same installation for a person.

## Trigger contract

The canonical verifier has one entry:

- `pull_request` with activity types `opened`, `reopened`, `synchronize` and
  `ready_for_review`.

The protected-default-branch controller has only these entries:

- `issue_comment` with activity types `created` and `edited`; and
- `workflow_dispatch` for one explicitly selected pull request.

There is no cron, `repository_dispatch`, `pull_request_target`, writable
automatic `pull_request_review` job, runtime GitHub App or status writer.
Review objects and reaction-only completion are discovered by a later
authoritative verifier reconcile.

An automatic comment job is admitted before runner allocation only when both
the event sender and comment author are the exact Codex provider:
`chatgpt-codex-connector[bot]`, GitHub type `Bot`. The Action repeats identity
and scope checks after the runner starts. An edited Codex comment may invalidate
an earlier decision, which is why both `created` and `edited` are admitted.
The verifier fails closed unless the PR is same-repository, open, ready and
targets the current default branch. A base retarget does not create a current
verifier because `pull_request.edited` is intentionally absent. For a ready PR,
convert it to draft and mark it ready again; for an already-draft PR, mark it
ready. The resulting `ready_for_review` event creates a verifier for the new
exact head/base/test-merge scope. A native rerun of the old event is not a substitute.

Manual runs use the protected default-branch workflow. A feature-ref dispatch
is unsupported. The typed `workflow_dispatch` business inputs are:

| Input | Type | Contract |
| --- | --- | --- |
| `operation` | choice | `reconcile` or `begin-review`; defaults to `reconcile`. |
| `pr_number` | number | Required canonical positive PR number. Exactly one PR is processed. |
| `expected_head_sha` | string | Required full expected PR-head SHA. A stale run never follows a different head. |
| `request_comment_id` | string | Optional evidence-location hint; never authority. |
| `request_review` | boolean | Defaults to `true`; controls request posting for `begin-review`. |

Every dispatch value is untrusted and revalidated against GitHub. Inputs
cannot provide a verdict, provider identity, required-check result, stale
override, limits profile, numeric resource limit or permission to skip a full reconcile. A hint may
allow an early stop only after the runtime proves that no newer relevant
evidence was skipped. GitHub exposes the typed numeric `pr_number` as a string
at the Action boundary; the Action still requires its canonical positive
decimal representation.

The controller Action step uses the corresponding underscore-named inputs:
`github_token`, `pr_number`, `expected_head_sha`, `operation`,
`request_comment_id` and `request_review`. `github_token` and
`pr_number` are required. A manual run must supply the full
`expected_head_sha`; the automatic comment path may leave it empty so the
runtime can bind the authoritative head at startup. Neither path may follow a
later head change. Both Action steps receive `default` or `expanded` only from
the protected repository variable `CODEX_REVIEW_GATE_LIMITS_PROFILE`; dispatch
callers cannot override it.

## Operations

### `begin-review`

`begin-review` validates the exact PR and expected head, and by default creates
or safely adopts a fresh exact `@codex review` request with the canonical
hidden binding. It reads that request back before requesting a full rerun of
the exact current verifier. `request_review=false` is an advanced best-effort
option and does not add a dedicated barrier.

Controller runs for the same PR are serialised with `cancel-in-progress: false`.
The controller records verifier attempt `A`, requires no competing canonical
attempt, requests one full rerun, and must observe exact attempt `A+1` plus its
unique canonical job/CheckRun. An ambiguous POST or invisible attempt remains
blocking; concurrency is scheduling, not a mutation fence.

For the usual low-cost path, an agent may post exact `@codex review` directly
while other checks run and invoke GHA only when reconciliation is needed. Use
`begin-review` when the workflow must coordinate the pending transition and
request, including a deliberate same-head re-review after an earlier success.

### `reconcile`

`reconcile` re-reads the selected PR and locates exactly one canonical verifier
whose native CheckRun is on its current feature head and whose run is bound to
the current test-merge. It then uses the same baseline/rerun/readback
handshake to establish a strictly newer full verifier attempt. The controller
never supplies a verdict or rewrites a CheckRun; the read-only verifier alone
collects evidence and its native job conclusion carries the required result.

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

Terminal clean text and a qualifying provider `+1` have equal clean authority
only for the first physical generation of a no-base-epoch, single-flight
lineage. Every physical request comment is a generation boundary, including
duplicate hidden markers from one workflow run. Without a base epoch, provider
terminal evidence strictly between the first request and its successor may
close only that first gap. Every later gap, and positive clean authority for any
generation that has a physical predecessor, requires a qualifying `+1`
directly on that request. An unbound terminal cannot prove whether it belongs
to the newer request or is a delayed or duplicate carrier from an older one;
it therefore cannot pass or supersede findings for the newer generation. With
a base epoch, even the first gap requires request-bound `+1` evidence.

A same-or-later official `eyes` or provider progress signal no later than a
successor keeps the predecessor open; equality with the successor is
timestamp-ordering ambiguity, not proof of completion. A later clean cannot
repair an already ambiguous gap. Explicitly commit-bound progress is scoped to
that head. Unbound edited progress is treated as the closed carrier interval
from `created_at` through its current revision time. It is discarded as
historical only when that entire interval, including every intervening
physical boundary, uniquely remains on one different full head. Missing,
ordinary, conflicting, cross-head, or endpoint-same-time boundaries stay
fail-closed.
Ordinary request reactions are provider liveness signals only; ordinary `+1`
cannot head-bind clean by itself. Same-time/later official `eyes`/progress from
Codex vetoes a candidate clean because review activity has not been proved
terminal. Reaction-only changes have no automatic workflow event, so a later
provider event or manual reconcile must observe them.
When terminal evidence names a reviewed commit, it may use a full or short SHA.
A short SHA is accepted only when GitHub resolves it unambiguously to the
current PR head. For a pull-request review, the resolved SHA must also agree
with the review's native `commit_id`.

Any qualifying current-head non-inline finding blocks immediately. On the
same head, an older finding can be superseded only by:

1. a strictly newer authorised review generation; and
2. a later clean result bound to that generation and head under the lineage
   rule above: an unbound terminal only for the first no-base-epoch generation,
   otherwise a qualifying request-bound `+1`.

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
create_verifier_run
```

Findings normally produce `healthy/failure`, not an execution error.
`unhealthy/success` is invalid. In the verifier workflow, only a proved stable
`healthy/success` may conclude successfully; findings, pending evidence,
unsupported scope, cancellation, timeout and every unhealthy result remain
blocking. The required verifier CheckRun belongs to the exact current PR
feature-head SHA. Its `pull_request` run executes on `refs/pull/N/merge`, and
the Action's environment/event/fresh-read checks bind success to the unchanged
head, base and test-merge. The controller's CheckRun is attached to the default-branch commit
and is never the required PR signal. Direct status projection and
`status_projection` are deleted. Finding counts remain summary-only, not public
Action outputs.

`healthy/pending` cannot safely authorise success even when the evaluator
completed trustworthily; it is not a weak success. Every result, including
pending and not-applicable results, must follow its `recovery_code`. Only
`wait_provider` is a pure wait without another repair or reconcile action.

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
an agent must dispatch controller `reconcile` with the exact current head,
observe the strictly newer verifier attempt and its unique canonical CheckRun,
and require all of the following at one final read:

- Action result `healthy/success`;
- `codex/github-review-gate` success from the canonical verifier on the exact
  current feature-head SHA, from the run bound to the same current test-merge;
- the PR head, base and test-merge SHA remain unchanged;
- the branch is up to date;
- all review conversations are resolved; and
- the ruleset allows the merge.

If any item changes, stop and reconcile the new current state. Otherwise merge
immediately with this exact-head compare-and-swap:

```bash
gh pr merge "$PR_NUMBER" \
  --repo "github.com/$REPO" \
  --match-head-commit "$HEAD_SHA"
```

Direct human UI merge outside this closure is unsupported.

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
