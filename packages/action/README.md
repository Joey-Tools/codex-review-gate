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
binding input. A protected top-level `run-name` makes GitHub expose the exact
`codex-review-gate-verifier/<PR>/<current test-merge SHA>` as the run's
`display_title` for every verifier event. Each run's sole PR binding must contain the
current feature head and exact direct-base ref/SHA. For a native stack,
current metadata separately binds the trunk ref/SHA. These receipts bind a
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
Action can verify its own `pull_request` run's GitHub-server metadata,
including `created_at`, through
`GET /repos/{owner}/{repo}/actions/runs/{run_id}`. This permission is required
for private repositories. The run read binds native workflow identity and
current head/ref/test-merge scope and supports legacy request-bound recovery;
`created_at` is not a positive-evidence cutoff for a primary exact-head clean.
Update every installed consumer's byte-verified verifier workflow before
publishing a floating `v2` runtime that requires this read; an older workflow
without it fails closed rather than substituting unverified run metadata.

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
Actions App, not a particular workflow or unique producer. The ordinary
current-v2 installer exact-byte verifies both canonical workflows and uses a
best-effort scoped keyword scan of workflow source text for additional Codex
gate callers and uses of the reserved `codex/github-review-gate` signal.
Fragmented text, literal concatenations and simple local-variable forms are
scanned where possible; only explicit matches recognized by the scanner block
installation. Only detected candidates that
cannot be classified warn; unsupported literal forms may be missed, so no
warning does not prove the absence of another producer. Unrelated keywords
and contexts do not block installation. Plain-text references such as `echo`,
`jq` or artifact labels may appear as non-blocking reference warnings; they
are not treated as gate collisions. Unrelated workflow-local write permissions and opaque
workflow-local permission declarations are operator-trust warnings, not
installation blockers, and do not require unrelated publishers to be
isolated. The repository-wide `default_workflow_permissions=read` preflight
remains strict. Canonical workflow permissions, managed CODEOWNERS rules,
required Code Owner review, stale-approval dismissal, strict up-to-date policy,
no bypass actors and canary checks also remain strict. The scan does not
execute workflows, prove complete data flow, prevent malicious same-name
forgery, or establish a unique producer. Frozen historical organization
handoff, bridge-removal and source-only proof contracts remain strict.

See the [workflow scan risk boundary](https://github.com/Joey-Tools/codex-review-gate/blob/master/docs/install/workflow-scan-risk-boundary.md)
for accepted coverage limits and examples.

Keep the imported ruleset disabled until a harmless canary has proved the
actual native CheckRun source and complete wiring. The
[human-readable guide](https://github.com/Joey-Tools/codex-review-gate/blob/master/docs/install/human.md)
explains the installation to a person. The
[agent-executable guide](https://github.com/Joey-Tools/codex-review-gate/blob/master/docs/install/agent.md)
lets an agent perform that same installation for a person.

## Trigger contract

The canonical verifier has one entry:

- `pull_request` with activity types `opened`, `reopened`, `synchronize`,
  `ready_for_review`, GitHub-native `stacked`, and `edited` for both actual
  base-ref retargets and title/body-only edits. Every subscribed event runs
  the fixed required job `codex/github-review-gate` with the same canonical
  run title and performs a full current-evidence reconciliation.

Install this change by refreshing both canonical workflows, not by appending
`edited` to an older verifier's event list alone. The required job name stays
fixed and executes on every subscribed PR event; no skipped or dynamically
renamed job can satisfy the check. Title/body edits retain the same run title
and cannot themselves invalidate an existing current-head clean.

The `stacked` action is the immediate wake-up when a PR joins a native stack.
The released `@v2` runtime can validate the new scope, but an installed verifier
workflow must also include `stacked` in its activity types to receive that
wake-up. Existing four-action workflow copies remain usable; refresh them from
the canonical template to get immediate join-triggered verification. Five-action
copies already receive that event; both older profiles need the guarded
`edited` update for automatic base-retarget verification. The
`stacked` action supplements, and does not replace, `synchronize`.

The protected-default-branch controller has only these entries:

- `issue_comment` with activity type `created`;
- `workflow_run` with activity type `completed`, admitted for the canonical
  verifier's `pull_request` run when its PR association is empty or unique; and
- `workflow_dispatch` for one explicitly selected pull request.

There is no cron, `repository_dispatch`, `pull_request_target`, writable
automatic `pull_request_review` job, runtime GitHub App or status writer.
Review objects and reaction-only completion are discovered by a later
authoritative verifier reconcile.

A new diagnostic-only controller operation runs for each eligible completed
canonical verifier run, independently of the automatic-request variable. It
revalidates the exact verifier run/attempt and current PR/check scope before
writing a best-effort diagnostic snapshot. It does not scan provider evidence,
reconcile, rerun the verifier or request review. Snapshots are editable output,
not evidence or gate authority; stale run/scope reports are ignored. The
current native `codex/github-review-gate` CheckRun remains the required signal.
A metadata edit, completed rerun or ready event does not invalidate an
existing valid same-head clean. The normal failure-only, first-attempt
automatic request path may still run when current evidence is genuinely
missing; it is not a metadata-specific request path.
Each completion can allocate an extra controller runner and consume billable
minutes. The operation updates one strictly bound canonical Actions diagnostic
when exactly one exists, creates one when absent, and skips the write with a
warning when multiple diagnostics are present. It retains typed `unknown`
values in the hidden payload; the updated controller diagnostic format omits
visible unknown counts and thread detail and labels its body snapshot-only.

Automatic review requests remain off by default. The organisation or
repository Actions variable `CODEX_REVIEW_GATE_AUTO_REQUEST` must be exactly
`true`; an unset value disables the request path, and no other value authorises
a review request. GitHub Actions compares strings case-insensitively in the
operation selector, so a case variant such as `TRUE` can still select
`begin-review`; the runtime rejects it before posting. A repository value
overrides the organisation value. The existing request path remains limited to
a first-attempt failure (`run_attempt=1`) with a unique PR association. The
protected controller re-fetches the completed verifier and current eligible
same-repository, open, ready PR. It posts a canonical
request if no exact repository/PR/head/base match exists, or adopts an existing
match. The request is the entire automatic operation: there is no immediate
verifier rerun. A later exact Codex bot comment or protected manual
`reconcile` performs that rerun. This path may follow `opened`, `reopened`,
`synchronize`, `ready_for_review` when acceptable evidence is missing, or
native `stacked`, not just a push. A merge
conflict can
prevent the `pull_request` verifier from running; without that run there is no
automatic request, so resolve the conflict and use manual recovery if needed.
`workflow_run` keeps the writable controller on the protected default branch
without relying on the public-repository
[default `pull_request_target` event policy](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target).
No third workflow, new GitHub App or
ruleset is needed. For the Joey-Tools rollout, set the organisation variable's
selected-repository visibility first to only `codex-private-workflows` as a
canary, without a repository-level override, before expanding it.

For a verified base-ref retarget, the verifier binds the current head, direct
base, and test-merge tuple; the existing `workflow_run` controller revalidates
that scope before the opt-in path reuses or creates a canonical request.
Deduplication is scoped after the latest actual base-ref-change epoch and
requires the exact current head/base tuple, so a pre-epoch request cannot be
reused even if an A-to-B-to-A retarget returns to the same ref and SHA.
Duplicate verifier events within one epoch reuse the matching post-epoch
request. The primary pass evidence is a trusted, unedited top-level terminal
clean that explicitly names a SHA resolving uniquely to the current full PR
head; it is independent of controller/request attribution and the verifier
run's native `created_at`. If a base-ref-retarget epoch exists, the clean's
server timestamp must be strictly later than the latest actual retarget,
including the final transition of A-to-B-to-A. This is a recency floor, not
request-causality or base-SHA proof. Findings remain blocking under their
existing supersession rules; the clean itself does not silently erase them.
This policy retains the existing request-token configuration for opt-in
requests and describes source support; availability requires the corresponding
Action release and canonical workflow refresh. If retarget event evidence is
absent or invalid, or no matching verifier exists, the existing
draft-to-ready fallback remains available. This adds no
`issue_comment.edited` controller trigger, consumer rollout, release,
protection, or token-permission change.

If a completed run has no PR association in GitHub's run metadata, the
controller accepts only an empty association list and derives PR/test-merge
from the exact canonical verifier `display_title`. The internal `pr_number: 0`
sentinel is allowed only for `report-completion`; runtime revalidates the
derived PR and exact run/attempt/check scope. This fallback uses the
repository-scoped empty-suffix concurrency group rather than the normal
per-PR group, so a final point-in-time recheck does not guarantee complete
per-PR serialization. The diagnostic comment itself never authorises a merge.

Publish a compatible Action runtime before installing the controller update
that uses `report-completion`. Do not expose the operation to v2.1.6 or another
older runtime; it is not a manual dispatch option. Keep the runtime and
canonical workflow rollout aligned. This source repository is the self-hosting
exception because its controller changes in the same source PR: until the
Action release is available, its optional diagnostic controller run may fail
on the unsupported operation. The required verifier CheckRun and existing
manual operations remain unchanged; external consumers must remain
runtime-first.

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
The verifier requires a same-repository, open, ready PR whose direct base is
the current default branch, except for a GitHub-native stacked PR whose
authenticated stack metadata proves that its trunk is the repository's current
default branch. Arbitrary manually chained feature-base PRs, forks, and stacks
with another trunk remain unsupported. The PR's direct base ref/SHA and the
stack trunk ref/SHA are distinct bindings and are both checked with current
stack membership. Each PR receives its own gate; no lower PR's review result is
inherited and no stack merge is performed. The protected controller still
executes from the default branch.

A base-ref retarget is verified against the current head/base/test-merge tuple
before the protected controller can reuse or create a canonical request. A
title/body-only edit also runs the fixed required verifier job as a full
current-evidence reconciliation; its unchanged run title affects neither
evidence nor controller selection. A request from before
the latest actual base-ref-change epoch cannot satisfy retarget deduplication,
even if an A-to-B-to-A retarget returns to the same ref and SHA; duplicate
events in the same epoch reuse the matching post-epoch request. For the
primary pass path, a trusted, unedited top-level terminal clean with an
explicit SHA uniquely resolving to the current head may be reused regardless
of request or run creation time, but it must be later than the latest actual
base retarget when one exists. A base-scope event marker or run title never
supplies pass evidence. Findings remain subject to their existing
supersession rules. If event or matching verifier evidence is unavailable,
use the existing draft-to-ready fallback; a native rerun of an old verifier is
not a substitute.
Base-tip movement and trunk/membership drift are evaluated against their
separately bound current scope; do not assume every base advance invalidates
head-bound clean review evidence. GitHub's native `stacked` webhook
action is a `pull_request` activity type, not a top-level webhook event, and
must not be treated as a substitute for `synchronize`.

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
`request_comment_id`, `request_review` and `review_request_token`.
`github_token` and
`pr_number` are required. A manual run must supply the full
`expected_head_sha`; the automatic comment path may leave it empty so the
runtime can bind the authoritative head at startup. The automatic verifier-run
path supplies the upstream exact head, `begin-review`, and `request_review=true`.
No path may follow a later head change. Both Action steps receive `default` or
`expanded` only from the protected repository variable
`CODEX_REVIEW_GATE_LIMITS_PROFILE`; dispatch callers cannot override it.
The append-only v2.2 contract adds optional `review_request_token`. Empty input
preserves the existing bot-author request. A configured token is used only for
`GET /user` and the request-comment `POST` in request-enabled controller
`begin-review`; all other reads, refetches, sticky diagnostic writes and
canonical verifier reruns continue to use `github_token`. It is ignored
without calls outside that operation, including `reconcile` and
`request_review=false`. Invalid, expired or unauthorised configured tokens fail
clearly with no silent bot fallback. An uncertain POST gets only the existing
bounded read-only recovery, not another POST. Provider identity, comment
binding and canonical bot-reaction trust are unchanged.

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
same-run request binding. A newly created request reports `wait_provider`; an
adopted/duplicate request reports `reconcile` and says no new comment was
posted. Reconcile the exact head to consume any already-published clean or
surface missing/terminal evidence; adoption does not imply that the provider
is still running or has completed. An uncertain request POST remains
fail-closed; it does not make the required verifier CheckRun pass.

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
review bodies. It does not query inline review threads or decide conversation
resolution. The consumer ruleset must require “all conversations resolved” as
the independent server-side merge guard; a successful Action result is a
Codex-evidence pass, not proof that the PR is merge-ready.

## Evidence semantics

The primary pass path is one trusted, unedited top-level terminal clean whose
explicit reviewed-commit SHA resolves uniquely to the current full PR head.
This exact-head evidence is independent of request/controller attribution and
the verifier run's `created_at`; any verifier run that freshly reads it may
pass, subject to complete comment/review acquisition, exact refetches, stable
snapshots, current test-merge binding, and the existing finding rules. No
cross-run cache, artifact, or earlier run result is inherited; metadata-only
edits start another full current-evidence reconciliation. If GitHub's PR
timeline contains a verified base-ref-retarget epoch,
the clean's server timestamp must be strictly later than the latest actual
retarget, including an A-to-B-to-A sequence. A rerun, ready event, or
title/body metadata reconciliation may reuse the clean without starting a new
review request. The run's native workflow metadata remains mandatory for
execution and current-scope binding, but neither its creation time nor the
unchanged run title supplies clean authority. Legacy hashless and request/reaction
lineage remains a separate request-bound fallback; it cannot bypass the
retarget timestamp floor or finding supersession rules. The source describes
the next compatible Action behavior; existing consumers need its release and
the canonical workflow refresh before receiving it.

### Structured terminal clean comments

The top-level official clean issue-comment parser treats the conclusion,
the unique `**Reviewed commit:**` marker, and the optional official disclosure
as separate sections. The conclusion and existing bounded presentation
tagline grammar remain required; arbitrary praise or free-form trailing text
does not establish clean. Commit markers in quotes or code fences do not
provide head attestation. An unambiguous 7–40-character marker still has to
resolve to the exact current head under the ordinary request and snapshot
rules.

The optional trailing disclosure has one closed `<details>` block and one
`About Codex in GitHub` summary. Its supported setup, trigger, reaction, and
call-to-action blocks are parsed separately, so supported old/new introduction
and link forms and harmless whitespace changes do not require a whole-footer
byte match. Unknown prose, nested or unclosed blocks, duplicate summaries,
or extra trailing payload remain inconclusive. Finding-formatted content is
checked across the projected body, including the disclosure. This profile is
specific to top-level clean issue comments. Native inline-parent reviews use
their separate closed receipt grammar and native commit binding below.

The verifier's bounded CLI diagnostics and Actions Summary identify the
relevant carrier and parser stage/reason code, with available head-resolution
and request-selection context. They do not print raw comment bodies or tokens,
and diagnostic metadata never supplies pass authority. Unsupported provider
formatting is distinct from an actual unresolved finding; both remain
non-success outcomes until their respective recovery conditions are met.

### Hidden boundary comments

V2 ignores complete leading and trailing HTML comments in provider bodies
before applying the existing visible-body grammar. Comment names are not an
allowlist: the observed `codex-review-receipt:v1` and
`codex-code-review-finding:v1` markers, arbitrary names, repeated comments and
multiline boundary comments are presentation only. Blank separators are not
required. Comments alone cannot supply a terminal result.

This is a narrow boundary projection, not a full Markdown renderer. Interior
comments, arbitrary HTML, visible prose, code examples and unclosed comment
delimiters are not removed as wrappers. It does not hide visible findings,
weaken commit or provider binding, or resolve conversations. Raw bodies are
retained for edit detection, exact refetch and stable-snapshot fingerprints;
only the parser input changes. Legacy/default shared-parser behavior remains
unchanged.

### Native inline-parent review compatibility

A submitted official `COMMENTED` review can carry the known inline-parent
heading, introduction and closed disclosure without repeating `Reviewed commit`
in its body. In the v2 compatibility profile, the full native `commit_id`
supplies that binding; a missing or short native SHA is not sufficient. If a
body commit field is present, it must still agree with the native commit.
Extra finding payload or unsupported visible content is not silently discarded.
The V2 profile permits the body commit field to be absent only for this closed
inline-parent grammar with the full native commit binding. Adding or removing
hidden boundary comments does not enable or disable that authority. Legacy
callers using only the older known-envelope option retain their narrower rule.
Top-level clean issue comments still need their explicit body commit marker,
and provider identity and current-snapshot checks remain unchanged. Inline
conversation resolution is exclusively enforced by the installed ruleset;
recognising a non-inline parent receipt does not supply thread state.

### Diagnostic Codex activity summaries

An issue comment with the exact first-line marker
`<!-- codex-pull-request-review-summary -->` and the verified official Codex
Bot/App identity is a diagnostic activity summary, not review evidence. Its
body, status, SHA text, edits, or absence do not authorize or block the gate.
In particular, `Completed` is not terminal-clean evidence and cannot clear a
finding or resolve a review thread.

The diagnostic exemption requires the current body to retain the exact
first-line marker. Remembering a summary ID does not exempt a present comment
whose marker was removed or moved: it returns to ordinary provider-evidence
and edit-history checks, including fail-closed handling where history cannot
be proved. A real finding cannot inherit an earlier summary's exemption.
Likewise, adding the marker later cannot erase a non-summary carrier already
observed during the same acquisition or controller recovery attempt.

These identified summaries are excluded from request attribution, provider
activity, edit-history decision inputs, decision fingerprints, and targeted
comment rereads. They remain part of complete raw comment acquisition and its
pagination budgets; this exception does not waive API health or inventory
integrity. Their provider events are no-ops: they do not cause a targeted
reread or verifier rerun. Genuine clean/finding comments retain their existing
protections.
GitHub deletion events do not identify the deleted comment or include its
body, so an unknown deletion cannot safely be classified as a summary and
retains the existing fail-closed history guard. A missing summary in an
otherwise complete inventory is not itself a failure.

If a recognized summary arrives between the initial PR metadata read and the
opening complete comment inventory, a count mismatch may use one bounded PR
metadata reread. The reread must retain the exact core PR scope and match the
inventory's complete raw count; it supplies the opening count authority for
the ordinary closing inventory and metadata checks. Every non-summary comment
in that inventory is still evaluated. Unexplained count mismatches, subsequent
non-summary changes, and scope changes remain fail-closed or require a fresh
snapshot. A normal matching opening count adds no metadata request.

### Legacy request-bound lineage and recovery

The following request/reaction rules describe compatibility recovery paths,
not the primary pass policy above. A full-SHA top-level clean can pass without
these request-attribution rules; a hashless clean or a clean used to recover a
legacy request boundary remains subject to them. They do not relax the
independent rules for superseding non-inline findings.

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

The second form is a deliberately narrow minimal receipt outside the fresh
current-head recovery below. An additional or
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
cohort. Identified diagnostic summaries above are excluded rather than treated
as opaque provider activity. An earlier carrier may own the later clean; this
explicit exception—not merely a full-head
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

A legacy *request-bound clean recovery* lets a fresh review request and a
trusted current-head clean recover a legacy verifier path, without proving
that older review requests finished. It is secondary to the primary exact-head
clean rule above. With no base epoch, cutoff `T` is the
GitHub-server `created_at` of the original `pull_request` verifier run;
retries keep that same cutoff. With an observed base epoch, use the narrow
post-epoch form below. A witness consists of one eligible request `R`: either an exact,
unedited ordinary `@codex review` from a `User`, or a verified canonical
Actions request whose repository, PR, full head/base tuple, and workflow-run
marker match the selected PR and verifier scope. Both forms are followed by a
trusted, unedited top-level issue-comment terminal clean `C` that resolves
uniquely to the current full head SHA. The receipt order is strict:
`T < R < C`. `R` must be the latest physical request boundary before `C`,
and no request boundary may follow `C`. This is head attestation (the clean's
unique full-SHA binding covers the selected head, not request-to-result
causality); posting `R` does not prove Codex started.

Under the configured `any` request-author policy, a token-generated `User`
request may carry a canonical hidden marker. It remains an ordinary user
request, not a workflow-authored request or workflow authority. For this
recovery, marker metadata does not veto an otherwise eligible exact ordinary
request or establish its head binding; the later clean independently supplies
current-head attribution.

For an existing verifier after a base epoch, set
`T = max(original verifier created_at, latest base epoch)` and require strict
`T < R < C`. `R` may also be a token-generated, unedited `User` request with
the eligible ordinary request shape; alternatively it may be a verified,
unedited canonical Actions request whose full current scope and workflow-run
marker match. `C` must contain an explicit full or unambiguous short commit
reference that resolves uniquely to the selected current full head. This
clean attests which head was reviewed; it need not identify the exact request
comment that triggered the review. Keep the same latest-request-boundary,
no-request-after-clean, no-relevant-provider-activity-at-or-after-clean,
complete-inventory, exact-refetch and stable-snapshot guards. This narrowly
supplies a fresh head-attested witness for the legacy path; the current
primary path does not need a new request to close an old attribution gap. The
verifier; ordinary post-epoch lineage still requires an exact-current-tuple
canonical Actions request with a direct provider `+1`, and an unlineaged
terminal clean does not gain general authority. Older
requests remain in the complete inventory, but older request count, author
type, canonical markers, attribution gaps, and unsettled request reactions do
not invalidate this witness. Recovery does not mark those requests completed
or claim which request produced the clean. In particular, an attribution gap
left solely by an older request for a different head does not invalidate the
later, uniquely head-attested clean. Short SHAs are accepted only when GitHub
resolves them unambiguously to the selected full head SHA.

The conservative cutoff is not the exact PR `synchronize` time; Git commit
dates and unverified event timestamps are never fallbacks. This recovery does
not clear findings or unknown provider errors. Only the recognised earlier
service failure and an otherwise valid official clean receipt with a wholly
missing Reviewed commit marker may be superseded by a later eligible request
and its valid current-head recovery clean. A hashless receipt never supplies
positive authority or a guessed SHA. Duplicate/malformed markers, invalid
disclosure, extra unknown content and finding-bearing receipts do not qualify.
Recovery does not forgive edited, deleted,
scope-drifted or ambiguous evidence. It still requires complete
inventory, exact refetches and two stable snapshots. Historical request
liveness alone is not a veto: an older request's unclosed official `eyes`
cannot outweigh the later current-head attestation. Its reaction churn must
not invalidate stability either. Relevant new activity after the selected
clean, or a newer physical request boundary, still prevents success.
An eligible exact-head clean is refetched and evaluated in fresh stable
snapshots; no earlier verifier result is inherited. A missing primary clean
requires obtaining trusted top-level current-head clean evidence (after the
latest actual retarget, if any), not a new request solely to close a legacy
request gap. Request-bound `+1` and hashless compatibility behavior remains
separate. Posting a request alone is not success and does not guarantee Codex
starts. The legacy cutoff does not carry to a new verifier run ID.

Every snapshot also reads the latest GitHub PR timeline
`BaseRefChangedEvent` or `BaseRefForcePushedEvent`. Legacy request-bound clean
and request authority must be strictly newer than that base epoch; equal
timestamps are ambiguous and stay pending. The primary exact-head top-level
clean has a separate strict recency rule: its trusted server timestamp must be
later than the latest actual base-ref-retarget epoch, but it does not need a
post-epoch request or controller attribution. A provider terminal payload does
not identify the base snapshot that produced it, so legacy lineage on a PR with
an observed base epoch keeps its deliberately narrower rule: only a qualifying
provider `+1` attached directly to a strictly post-epoch, base-bound canonical
workflow request can advance that fallback or supersede an older finding.
Ordinary direct `@codex review` requests remain supported without a workflow
marker on PRs that have no base epoch. They can use either of the two first-
generation receipt forms above; those ordinary-lineage terminal receipts are
unavailable after a base epoch. Findings remain conservative across the epoch
boundary; a clean cannot be guessed into a new request-bound generation or
clear a finding by itself.

Apart from the primary exact-head clean and this legacy fallback, terminal
clean text and a qualifying provider `+1` have equal clean authority only for the first physical
generation of a no-base-epoch, single-flight lineage. For the one unique
default-`any` ordinary request that satisfies the
minimal receipt rule—or the recovery-only duplicate cohort above—the matching
official top-level issue-comment terminal clean can establish that first
generation and carry its clean authority. The exact closed `COMMENTED`
inline-parent form remains available only for the unique-request path. Other
pull-request review cleans remain ordinary evidence and cannot confirm a
default-`any` candidate.
The inline-parent form attests only the absence of a non-inline parent payload;
it does not attest thread resolution. Inline conversation state is not read by
the verifier and remains exclusively enforced by the installed ruleset.
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
directly on that request, except for the legacy request-bound clean recovery
above. An unbound terminal cannot prove whether it belongs
to the newer request or is a delayed or duplicate carrier from an older one;
it therefore cannot pass or supersede findings for the newer generation. With
a base epoch, ordinary successor lineage still requires an
exact-current-tuple canonical Actions request with a direct provider `+1`, and
a top-level terminal clean adds no authority. This does not broaden the
separately scoped legacy current-head recovery above: that witness
does not close arbitrary gaps or clear findings.

A same-or-later official `eyes` or provider activity signal no later than a
successor keeps the predecessor open; equality with the successor is
timestamp-ordering ambiguity, not proof of completion. Provider terminal
evidence may close the first gap only when the predecessor reaction inventory
is complete and no current `eyes` or provider activity follows that terminal
through the successor. Outside the legacy request-bound clean recovery, a later clean
cannot repair an already ambiguous gap.
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
for the top-level-clean-only duplicate cohort and fresh current-head recovery
defined above. After a direct-reaction
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
   Neither the primary exact-head clean nor the legacy clean fallback
   supersedes a finding by itself.

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

Acquisition batches selected request reactions in groups of at most eight,
with complete independent pagination for every nested connection, and folds
the latest base-event read into the first history response. Official reaction
accounts retain an independent REST ID/login/`Bot` binding in each fresh carrier
pass. Exact REST carrier refetches, opening/closing inventories and both stable
snapshots remain; no cached self-comparison replaces fresh GitHub evidence.

The head and decision-relevant fingerprint must match across both reads. A
same-head request, edit, reaction or other relevant evidence change restarts
the stability window. A head/lifecycle mismatch makes the run stale. API,
pagination and cap failures are incomplete observations, never evidence of
stability. If no stable clean pair is available within the reconcile budget,
the gate stays pending for a later provider event or manual reconcile.

The reviewed profiles are fixed:

| Profile | Pages | Raw objects | API attempts | Snapshot | Request timeout | Reconcile budget |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `default` | 100 | 2,000 | 128 | 32 MiB | 10 s | 60 s |
| `expanded` | 500 | 10,000 | 512 | 64 MiB | 20 s | 300 s |
| hard ceiling | 1,000 | 20,000 | 2,048 | 64 MiB | 30 s | 720 s |

Each complete snapshot has an aggregate page budget shared by its opening and
closing evidence reads. First pages count, including empty reaction inventories;
each fetched batched GraphQL pagination response counts once while all nested
raw objects still count against object capacity. Batch size, connection
completeness, byte, attempt and time caps remain enforced;
the limit is not a review-round count or a per-endpoint page limit. The default
page ceiling is raised without changing evidence selection or the other default
limits. `expanded` raises the page ceiling to 500 as well as the other capacities.
Default page exhaustion reports `use_expanded_limits` only when expanded raises
the effective ceiling. Expanded exhaustion, or protected custom caps that
expanded cannot improve, reports `raise_protected_limit`.
Larger budgets permit more reads when needed, not mandatory
extra reads or background polling. Existing floating `@v2` consumers receive the
new default after runtime publication; immutable version/SHA pins do not move.

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

Qualifying non-inline findings normally produce `healthy/failure`, not an
execution error. Inline review-thread state is not read by the Action and does
not affect this evidence verdict. The consumer ruleset must require all review
conversations to be resolved; that server-side rule independently blocks a
merge. A stable `healthy/success` is therefore a Codex-evidence pass, not a
claim that conversations are resolved or that the PR is merge-ready.
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
pending and not-applicable results, must follow its `recovery_code` and
concrete next action. `wait_provider` is used when this run newly posted a
request and a qualifying terminal result is not yet available; that code does
not by itself prove that the PR must be replaced. If an automatic
controller run adopted an existing request instead, it reports
`recovery_code=reconcile`: refresh the exact-head verifier to consume any
already-published clean or surface missing/terminal evidence. Adoption does
not imply that Codex is still running or has finished. For the primary pass
path, missing clean guidance is to obtain trusted current-head top-level clean
evidence (strictly after a real base retarget if one exists), not to post a
request solely to close an old request-attribution gap. Findings, edited or
deleted evidence, and applicable legacy recovery checks remain blockers.
This guidance never changes the pending verdict or waives evidence/history
checks.

When they can be derived without another evidence query, the sticky diagnostic
and Actions summary report:

- `findings_unresolved`;
- `findings_resolved`;
- `findings_historical`;
- `findings_indeterminate`.

For schema compatibility, thread diagnostics remain in the summary shape, but
the current verifier reports `review_threads.status: not_read` and
`resolved`, `unresolved`, and `total` as `unknown`. This is not a verified zero
and does not mean the Action checked thread state. The CLI JSON uses the same
compatibility field; it is not a public Action output. The consumer ruleset's
required conversation-resolution condition remains authoritative. Operators
must inspect and resolve PR conversations through GitHub's native review UI or
API; the Action does not scan, count, summarize, or block on inline threads.
Finding counts continue to cover only normalised non-inline findings.

For a blocking verifier result, the Actions Summary ends with a dedicated
`Steps to unblock: ...` line. CLI output prints the same final line after its
JSON diagnostic record. Detailed bounded evidence remains in the preceding
summary and logs; this final line is the most actionable user-facing output,
not a new result or authority signal. It reports only the current Codex evidence
and its recovery action; it never includes inline-thread counts or thread repair
steps. If GitHub's ruleset still blocks merge after a successful Action result,
inspect its native conversation-resolution condition and resolve the remaining
conversations without changing the head. A finding fix that changes the head
still needs fresh trusted review evidence for the new head. The job does not
perform any suggested repair or reconciliation automatically.

The Summary links to the current Actions run and provides a jump to `Steps to
unblock`. When the canonical native `codex/github-review-gate` verifier
already exits nonzero, it also emits one fixed GitHub Actions error
annotation linking to that run and directing the operator to its Summary. The
annotation contains no finding or provider prose. These links use the existing
repository, run ID, and server URL; invalid or mismatched navigation metadata
suppresses navigation without changing the verdict. This does not modify the
GitHub-managed PR check row or its Details URL, grant `checks: write`, or add
API reads. Success, controller or diagnostic-only results, and local CLI
invocations do not emit the annotation.

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

Current v2 releases support GitHub.com public and private repositories;
ordinary same-repository branches with an open, non-draft PR targeting the
default branch, plus GitHub-native stacked PRs whose authenticated stack
metadata binds the trunk to that default branch; Linux runners in GitHub-hosted or self-hosted environments; and
ordinary merge, squash and rebase methods. The default runner selection remains
`ubuntu-slim`, with `ubuntu-latest` as the adopted fallback. The installed
workflow's explicit `runs-on` expression remains authoritative; these defaults
apply only when its configured selection falls back to them.

It fails closed for GHES, forks, merge queues, arbitrary non-default bases,
manual feature-branch chains, and stacks with a non-default trunk, as well as drafts,
bot-owned PRs, Windows/macOS runners, and new operations on closed or merged
PRs.

Selecting a self-hosted Linux runner is an operator trust assumption: the
operator is responsible for the runner host and its isolation. The Action does
not attest to host integrity or isolation, and separate GitHub jobs do not
provide host isolation. The token-bearing controller host must be trusted. No
additional runner-specific trust flag, allowlist, host API, attestation, or
approval mechanism is required by the Action; this does not change any
separate workflow or environment approval requirements.

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
