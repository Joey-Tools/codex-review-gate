# Codex Review Gate v2

Languages: [British English (en-GB)](README.md) | [简体中文 (zh-CN)](README.zh-CN.md)

Codex Review Gate reduces trusted OpenAI Codex review evidence for one pull
request to the native required CheckRun `codex/github-review-gate`. GitHub
records the verifier run/job/CheckRun against the exact PR feature-head SHA.
The canonical `pull_request` verifier still executes on
`refs/pull/N/merge`; inside the Action it strictly validates `GITHUB_REF`,
`GITHUB_SHA`, the event head/base scope, and a fresh PR read whose test-merge
matches the runtime SHA. Event validation is limited to head/base SHA, ref, and
repository; event `merge_commit_sha` may be missing or historical and is not a
binding input. A
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

The verifier's canonical workflow grants read-only `actions: read` so the
Action can read its own `pull_request` run's GitHub-server `created_at` from
`GET /repos/{owner}/{repo}/actions/runs/{run_id}`. This permission is required
for private repositories. Update every installed consumer's byte-verified
verifier workflow before publishing a floating `v2` runtime that requires this
read; an older workflow without it fails closed rather than using a Git commit
date or an unverified event timestamp.

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

- `issue_comment` with activity type `created`;
- `workflow_run` with activity type `completed`, admitted only for a failed
  first attempt (`run_attempt=1`) of the canonical `Codex Review Gate Verifier`
  `pull_request` workflow when the opt-in variable is enabled; and
- `workflow_dispatch` for one explicitly selected pull request.

There is no cron, `repository_dispatch`, `pull_request_target`, writable
automatic `pull_request_review` job, runtime GitHub App or status writer.
Review objects and reaction-only completion are discovered by a later
authoritative verifier reconcile.

Automatic review requests are off by default. The organisation or repository
Actions variable `CODEX_REVIEW_GATE_AUTO_REQUEST` must be exactly `true`;
an unset value skips the automatic controller job, and no other value
authorises a review request. GitHub Actions compares strings case-insensitively
in the job condition, so a case variant such as `TRUE` can still allocate a
controller runner; the runtime then rejects it before posting. A repository
value overrides the organisation value. The same controller re-fetches the
completed failed verifier and admits only its unique current-head PR
association for an open, ready, same-repository PR on the current default
base. It posts a canonical request if no exact repository/PR/head/base match
exists, or adopts an existing match. The request is the entire automatic
operation: there is no immediate verifier rerun. A later exact Codex bot
comment or protected manual `reconcile` performs that rerun. This path may
follow `opened`, `reopened`, `synchronize` or `ready_for_review`, not just a
push. A merge conflict can prevent the `pull_request` verifier from running;
without that run there is no automatic request, so resolve the conflict and
use manual recovery if needed. `workflow_run` keeps the writable controller
on the protected default branch without relying on the public-repository
[default `pull_request_target` event policy](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target).
No third workflow, new GitHub App or
ruleset is needed. For the Joey-Tools rollout, set the organisation variable's
selected-repository visibility first to only `codex-private-workflows` as a
canary, without a repository-level override, before expanding it.

The controller deliberately does not subscribe its `actions: write` and
`pull-requests: write` authority to `pull_request_review`: GitHub binds that
event to the PR merge ref. Keep writable controller execution on the protected
default branch, and use its typed default-branch `workflow_dispatch` reconcile
when a Codex result arrives only as a review or reaction.

An automatic comment job is admitted before runner allocation only when both
the event sender and comment author are the exact Codex provider:
`chatgpt-codex-connector[bot]`, GitHub type `Bot`. The Action repeats identity
and scope checks after the runner starts. An edited Codex comment does not
automatically start the canonical controller; use protected manual `reconcile`
for that recovery. The Action still parses an `edited` event for compatibility
with direct callers, but that is not a canonical automatic ingress.
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
runtime can bind the authoritative head at startup. The automatic verifier-run
path supplies the upstream exact head, `begin-review`, and `request_review=true`.
No path may follow a later head change. Both Action steps receive `default` or
`expanded` only from the protected repository variable
`CODEX_REVIEW_GATE_LIMITS_PROFILE`; dispatch callers cannot override it.

## Operations

### `begin-review`

`begin-review` validates the exact PR and expected head, and by default creates
or safely adopts a fresh exact `@codex review` request with the canonical
hidden binding. For manual dispatch, it reads that request back before
requesting a full rerun of the exact current verifier. `request_review=false`
is an advanced best-effort manual option and does not add a dedicated barrier.
For the opt-in automatic verifier-run trigger, `begin-review` always requests
review and returns after posting or adopting a current-scope canonical request;
it does not rerun the verifier. Automatic adoption can reuse a matching
request from an earlier controller run, while the manual path retains its
same-run request binding. An uncertain request POST remains fail-closed; it
does not make the required verifier CheckRun pass.

Controller runs for the same PR are serialised with `cancel-in-progress: false`.
For a rerun, the controller records verifier attempt `A`, requires no competing
canonical attempt, requests one full rerun, and must observe exact attempt
`A+1` plus its unique canonical job/CheckRun. An ambiguous POST or invisible
attempt remains blocking; concurrency is scheduling, not a mutation fence.

For the usual low-cost path, an agent may post exact `@codex review` directly
as a provider-side attempt while other checks run and invoke GHA only when
reconciliation is needed. The comment does not promise that Codex starts; its
eligibility and delivery remain provider-controlled. The gate waits for
official evidence and stays pending if none arrives. Under the canonical
`any` policy, a direct ordinary comment is only a candidate until Codex
directly acknowledges that exact comment; it cannot reset an already-passing
generation before then. Use `begin-review` when the workflow must coordinate
the pending transition and request, including a deliberate same-head re-review
after an earlier success.

### `reconcile`

`reconcile` re-reads the selected PR and locates exactly one canonical verifier
whose native CheckRun is on its current feature head and whose run is bound to
the current test-merge. It then uses the same baseline/rerun/readback
handshake to establish a strictly newer full verifier attempt. The controller
never supplies a verdict or rewrites a CheckRun; the read-only verifier alone
collects evidence and its native job conclusion carries the required result.

The reducer reads qualifying Codex top-level issue comments and pull-request
review bodies. Separately, each complete evidence snapshot reads every PR
review thread through GitHub GraphQL and requires all threads to be resolved.
The ruleset must still require “all conversations resolved” as an independent
server-side merge guard.

## Evidence semantics

A review generation begins with an exact, unedited `@codex review` request.
The visible first line is exact and contains no additional visible text. With
the default `any` policy, an ordinary request is admitted to the snapshot as a
candidate at any repository permission, not as an immediate generation
boundary. It can receive provider confirmation in either of two ways:

1. the official Codex Bot adds a directly attached, strictly post-revision
   `eyes` or `+1` receipt to that exact comment; or
2. only for one unique, exact, unedited ordinary request in a no-base-epoch,
   single-flight lineage, an unedited official terminal-clean receipt is
   strictly later than that request and unambiguously binds the current head.
   The admitted receipt forms are a top-level issue-comment clean and the
   exact closed `COMMENTED` Codex inline-parent review grammar.

The second form is a deliberately narrow minimal receipt. An additional or
ambiguous request or physical boundary, an edit to the request or terminal,
an unmatched terminal carrier, or ambiguous head/SHA binding leaves the gate
pending. Where that terminal names a reviewed SHA, a short SHA is accepted
only when GitHub resolves it unambiguously to the current PR head. Direct
same-comment official `eyes`/`+1` remains supported. This controls only gate
attribution; it does not grant the commenter permission to invoke or control
Codex review, does not make Codex start, and does not mean that every user can
cause a review. GitHub and Codex still decide whether a provider review starts.
An unconfirmed candidate with no terminal-clean contender cannot reset,
preempt, or invalidate an existing clean; an attempted terminal-clean receipt
that fails the narrow rule remains fail-closed and pending. Canonical workflows set
`CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION=any` directly and do not expose a
standard strict-policy setting. `write` (`write`, `maintain` or `admin`) is
reserved for a nonstandard future verifier identity allowed to read collaborator
permissions; the bundled read-only verifier token cannot reliably do so. A
workflow-authored request additionally carries the canonical v2 hidden marker
binding the full head SHA, current base repository/ref/SHA and workflow run.
Qualifying Codex findings block regardless of request-author permission.

One recovery-only exception prevents an already-settled duplicate pair from
permanently poisoning a later canonical generation. A *duplicate cohort* (a
fixed legacy pair, not a request pattern to produce) is accepted only with no
base epoch, exactly two strictly sequential, unedited exact default-`any`
ordinary (non-canonical-marker) `@codex review` requests from the same `User`
login, no official `eyes`/`+1` on either request, one unedited
official top-level issue-comment clean after both that resolves exactly to the
current head, no provider error in the snapshot, and every pre-pair official
top-level `issue-comment` provider artifact with a valid activity window vetoes
the cohort unless it is a safely classified historical terminal: kind `clean`
or `finding`, unedited, with no `orderingError`/`resolutionError`, and exactly
one full unambiguous SHA across `resolvedHeadSha` and `headSha`. This includes
any otherwise unknown or unclassified, malformed, progress, or nonterminal
official top-level `issue-comment`: with a valid activity window, it is opaque
provider activity (a blocker rather than clean evidence) and vetoes the
cohort. An earlier carrier may own the later clean; this explicit exception—not merely a full-head
binding—preserves safely classified historical terminals. No additional provider
artifact or opaque provider activity with a valid activity window may appear
from the first request through that clean (or, if present, through its sole
canonical successor). Opaque provider activity is an exclusion-only side
channel: it does not enter the ordinary reducer, liveness, finding, clean, or
count paths. The only permitted successor is one strictly later
canonical workflow request bound to the current full head/base tuple. With no
successor, the later ordinary request is confirmed and the earlier one is
coalesced. With that successor, the later ordinary request remains the
explicitly confirmed, already-closed predecessor: a raw terminal after the
canonical request cannot satisfy that successor, so the canonical generation needs its own
qualifying direct official `+1`. Inline-parent receipts, a third request,
different authors, edits, base epochs, reactions on either ordinary request,
provider progress/errors, a pre-pair official top-level `issue-comment`
provider artifact with a valid activity window unless it is the safely
classified historical-terminal exception above, findings, or any other
successor remain fail-closed. The exception requires every listed terminal
property; a historical terminal clean/finding is not preserved merely because
it has a full-head binding.
Agents must never intentionally create this pair; it only recovers one that
already exists in the immutable GitHub snapshot.

A separate *current-head clean recovery* handles a trusted clean that is
already on the current head but predates this verifier run. This recovery is
available only when there is no base epoch. The cutoff `T` is the GitHub-server
`created_at` of the original `pull_request` verifier run; retries keep that
same cutoff. A witness consists of one eligible request `R`: either an exact,
unedited ordinary `@codex review` from a `User`, or a verified canonical
Actions request whose repository, PR, full head/base tuple, and workflow-run
marker match the selected PR and verifier scope. Both forms are followed by a
trusted, unedited top-level issue-comment terminal clean `C` that resolves
uniquely to the current full head SHA. The receipt order is strict:
`T < R < C`. `R` must be the latest physical request boundary before `C`,
and no request boundary may follow `C`. This is head attestation (the clean's
unique full-SHA binding covers the selected head, not request-to-result
causality); posting `R` does not prove Codex started.
After a base epoch, this recovery does not apply: the existing rule still
requires an exact-current-tuple canonical Actions request with a direct
provider `+1`; a top-level terminal clean adds no authority. Older ordinary
requests before `T` remain in the full lineage audit, but attribution gaps
attached only to those historical requests do not invalidate this recovery
witness.

The conservative cutoff is not the exact PR `synchronize` time; Git commit
dates and unverified event timestamps are never fallbacks. This recovery does
not clear findings or provider errors, nor does it forgive edited, deleted,
scope-drifted, live or ambiguous evidence. It still requires complete
inventory, exact refetches and two stable snapshots. Recovery does not waive
unsettled provider liveness: for example, an older request's official `eyes`
without its own later `+1` remains blocking. Recovery success also requires
every review thread to be resolved in both stable snapshots; an unresolved
human-authored, outdated, or old-head thread still blocks. A later exact-head
verifier rerun after the provider comment or manual `reconcile` remains
required. The cutoff does not carry to a new verifier run ID.

Every snapshot also reads the latest GitHub PR timeline
`BaseRefChangedEvent` or `BaseRefForcePushedEvent`. Positive request and clean
authority must be strictly newer than that base epoch; equal timestamps are
ambiguous and stay pending. A provider terminal payload does not identify the
request or base snapshot that produced it, so a PR with an observed base epoch
uses a deliberately narrower recovery rule: only a qualifying provider `+1`
attached directly to a strictly post-epoch, base-bound canonical workflow
request can supply positive clean authority or supersede an older finding.
Ordinary direct `@codex review` requests remain supported without a workflow
marker on PRs that have no base epoch. They can use either of the two receipt
forms above, but the terminal form is unavailable after a base epoch. Findings
remain conservative across the epoch boundary, and an unlineaged terminal clean
stays pending rather than being guessed into the new generation.

Apart from current-head clean recovery, terminal clean text and a qualifying
provider `+1` have equal clean authority only for the first physical
generation of a no-base-epoch, single-flight lineage. For the one unique
default-`any` ordinary request that satisfies the
minimal receipt rule—or the recovery-only duplicate cohort above—the matching
official top-level issue-comment terminal clean can establish that first
generation and carry its clean authority. The exact closed `COMMENTED`
inline-parent form remains available only for the unique-request path. Other
pull-request review cleans remain ordinary evidence and cannot confirm a
default-`any` candidate.
The inline-parent form attests only the absence of a non-inline parent payload;
it does not itself attest thread resolution. The verifier independently reads
thread state, while the installed ruleset remains a separate authority requiring
all conversations to be resolved.
A qualifying finding is
independently blocking and never acts as a receipt. A candidate with no receipt
contender is not a physical boundary. A terminal-clean contender that fails a
narrow-condition check remains pending as a fail-closed physical-only boundary.
Every other provider-triggerable request-shaped comment is a physical
generation boundary, including duplicate hidden markers, edited or malformed
requests, and requests that fail authorisation. Boundary status records an
unknown provider flight; it does not grant positive authority. Under the
nonstandard `write` threshold, an otherwise valid ordinary request requires a
permission lookup, cached per author within each snapshot, before it can be
classified as denied. Once denied, it causes no reaction or exact-refetch fan-
out. Boundaries rejected earlier for invalid shape, author, or binding also
cause no permission, reaction, or exact-refetch fan-out. Every observed
`CommentDeletedEvent` is an unbound physical-only boundary because its body is
not recoverable; an unclosable historical gap containing one requires a
replacement PR. A same-head canonical request remains a boundary when its base
tuple is stale; only the exact current
head/base tuple grants authority. Without a base epoch, provider
terminal evidence strictly between the first request and its successor may
close only that first gap. Every later gap, and positive clean authority for any
generation that has a physical predecessor, requires a qualifying `+1`
directly on that request, except for the fresh current-head clean recovery
above. An unbound terminal cannot prove whether it belongs
to the newer request or is a delayed or duplicate carrier from an older one;
it therefore cannot pass or supersede findings for the newer generation. With
a base epoch, the current-head clean recovery does not apply: the existing
rule requires an exact-current-tuple canonical Actions request with a direct
provider `+1`, and a top-level terminal clean adds no authority.

A same-or-later official `eyes` or provider activity signal no later than a
successor keeps the predecessor open; equality with the successor is
timestamp-ordering ambiguity, not proof of completion. Provider terminal
evidence may close the first gap only when the predecessor reaction inventory
is complete and no current `eyes` or provider activity follows that terminal
through the successor. A later clean cannot repair an already ambiguous gap.
Explicitly commit-bound progress is scoped to that head. Every unbound progress
carrier remains in the current inventory: nearby request timestamps cannot
prove its originating flight or head. An edited terminal carrier additionally
contributes an unbound unknown-activity interval from `created_at` through its
terminal revision; only that carrier's own terminal endpoint is exempt from
self-veto when evaluating the same terminal.
For an unconfirmed default-`any` ordinary candidate, a direct official
post-revision `eyes` or `+1` first serves as its receipt and upgrades it into a
boundary. The only alternatives are the matching unedited official top-level
issue-comment terminal clean or exact closed `COMMENTED` Codex inline-parent
review strictly after the candidate under the unique no-base-epoch,
single-flight rule above. It cannot be used after a base epoch,
after a second or ambiguous request/boundary, after an edit, or when the
terminal's identity, ordering, or current-head binding is ambiguous, except
for the top-level-clean-only duplicate cohort defined above. After a direct-reaction
upgrade, ordinary request reactions are provider liveness signals only;
ordinary `+1` still cannot head-bind clean by itself. Same-time/later official
`eyes`/progress from Codex vetoes a candidate clean because review activity has
not been proved terminal. Reaction-only changes have no automatic workflow
event, so a later provider event or manual reconcile must observe them.
When terminal evidence names a reviewed commit, it may use a full or short SHA.
A short SHA is accepted only when GitHub resolves it unambiguously to the
current PR head. For a pull-request review, the resolved SHA must also agree
with the review's native `commit_id`.

Any qualifying current-head non-inline finding blocks immediately. On the
same head, an older finding can be superseded only by:

1. a strictly newer authorised review generation; and
2. a later clean result bound to that generation and head under the lineage
   rule above: a terminal clean only for the first no-base-epoch generation
   (and, for a default-`any` ordinary candidate, only when it satisfies the
   minimal terminal-receipt rule), otherwise a qualifying request-bound `+1`.
   Current-head clean recovery cannot supersede a finding.

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

Qualifying findings normally produce `healthy/failure`, not an execution
error. A complete review-thread inventory with unresolved threads produces
`healthy/pending` with `wait_then_reconcile`; it is also a gate decision, not an
execution error.
`unhealthy/success` is invalid. In the verifier workflow, only a proved stable
`healthy/success` may conclude successfully; findings, pending evidence,
unsupported scope, cancellation, timeout and every unhealthy result remain
blocking. The required verifier CheckRun belongs to the exact current PR
feature-head SHA. Its `pull_request` run executes on `refs/pull/N/merge`, and
the Action's runtime merge-ref, event head/base, and fresh-read checks bind success to the unchanged
head, base and test-merge. Its event checks bind head/base scope, never event
`merge_commit_sha`. The controller's CheckRun is attached to the default-branch commit
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

Review-thread diagnostics are reported separately from findings. The
`report.reviewThreads.status` is `not_read`, `complete`, or `incomplete`; only
`complete` has trusted numeric resolved/unresolved/total counts. Otherwise
counts are `unknown`, not verified zero. Thread diagnostics are additive and
must preserve the primary recovery instruction (including finding, permission,
budget, replacement-PR, or begin-delivery guidance); only a complete read that
finds unresolved threads calls for resolving them and running protected
exact-head manual `reconcile`. A new provider review request is not required
for that repair.

Incomplete API reads, pagination or cap hits make affected counts `unknown`,
never `0`. Finding counts cover only normalised non-inline findings; thread
counts cover GraphQL review-thread state. Neither summary replaces the
independent branch-protection conversation-resolution requirement.

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
