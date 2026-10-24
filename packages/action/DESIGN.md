# Codex Review Gate v2 Design

Languages: [British English (en-GB)](DESIGN.md) | [简体中文 (zh-CN)](DESIGN.zh-CN.md)

## Goal

v2 supplies a low-cost, fail-closed native required CheckRun for one pull
request at a time. It must not report success while qualifying Codex findings
are present, evidence is incomplete or unstable, or the selected PR head has
changed. Inline conversation resolution is a separate GitHub ruleset condition,
not part of the Action verdict. A successful Action result is a Codex-evidence
pass, not a claim that the PR is merge-ready. The Action favours recovery from
GitHub's current state over durable private state and tolerates small
at-least-once duplicates when uncertainty follows a write.

Existing GitHub controls keep their native responsibilities:

- GitHub stores PR lifecycle, comments, reviews and reactions;
- two copied consumer workflows own separate event admission, permissions and
  serialisation boundaries;
- managed CODEOWNERS plus Code Owner review protect both workflows as part of
  the compound no-runtime-App control plane;
- the Action reconstructs and reduces non-inline Codex evidence;
- the ruleset requires the status, branch freshness, resolved conversations
  and non-fast-forward protection; and
- the merge agent closes the loop with an exact-current-head reconcile and
  final server-side reread.

The Action does not query inline review threads or discover effective rulesets.
The supplied and installed ruleset must enforce “all conversations resolved”
server-side. Its rule remains a required merge protection even when the Action
reports evidence success.

## Architecture and trust boundaries

```text
pull_request opened/reopened/synchronize/ready_for_review/stacked
                                |
                                v
          copied read-only canonical verifier
                                |
          JoeyTeng/codex-review-gate-action@v2
          - bind PR head, base and test-merge SHA
          - validate refs/pull/N/merge, GITHUB_REF and GITHUB_SHA
          - refresh PR and require unchanged head/base/test-merge
          - fully paginate and reduce GitHub evidence
          - require two stable snapshots for a clean decision
                                |
                                v
 native CheckRun codex/github-review-gate on exact feature head
                                |
                                v
 ruleset: expected source + Code Owner review + stale dismissal
          + up to date + conversations resolved + no force-push

Codex issue_comment created               protected workflow_dispatch
                 |                                  |
                 +----------------------------------+
                                v
          copied protected-default-branch controller
          - exact pre-runner bot filter / typed inputs
          - create or adopt review request
          - establish and read back newer verifier attempt
                                |
                                +---- full rerun ----> verifier
                                +---- summary / best-effort sticky
```

The protected `workflow_run` completion ingress also reaches the same
controller for completed canonical verifier runs. Only the existing opted-in
first-attempt failure with one PR association remains `begin-review`; other
eligible completions use `report-completion` for diagnostics and do not rerun
the verifier.

### Consumer workflows

The copied canonical verifier and controller are trusted repository
configuration and form the supported consumer envelope. A bare Action step
cannot own events, runner-admission filters, permissions, typed dispatch or
concurrency.

The two workflows, managed `.github/CODEOWNERS` control plane and supplied ruleset
are one installation contract. The canonical helper installs both workflows and
the two final effective CODEOWNERS rules for `/.github/workflows/` and
`/.github/CODEOWNERS`; callers explicitly select a GitHub user with `write`,
`maintain` or `admin` permission as `--control-plane-owner @USER`. The first
installation PR needs that owner's exact-current-head approval because its new
base-branch CODEOWNERS policy cannot enforce its own bootstrap. That approval
is necessary but insufficient: keep legacy protection through merge, bind a
canonical read-only inventory SHA-256 into the approval snapshot, and require
the final transaction to rebuild the strict inventory and match that external
digest. It binds repository/default branch, each matching ruleset's complete
identity, source, enforcement, target, conditions, `bypass_actors`, `rules`,
and effective `required_status_checks` rule, plus the complete classic
required-status object including each check's producer `app_id`. A canonical
empty inventory still has a repository/branch-bound digest; incomplete
API/schema data or any drift fails closed. It then authenticates the owner as
current actor, rereads the latest exact-head approval, and synchronously merges
the exact SHA. Immediately after
merge, it rereads the current default and requires the PR's merged lifecycle,
base, and head to remain the exact approved scope. Failure preserves every
legacy requirement active. After success, a separate v2 ruleset is staged as
Disabled while legacy remains active, proved by canary, then activated and read
back with no bypass actors. Every pre-cleanup stage/activation preview and
apply explicitly reuses the same owner-approved digest across processes
through that exact Active readback. Only then may the separately authorised
plan remove the inventoried legacy requirements. Immediately before cleanup,
read-only `--derive-post-cleanup-plan` requires the same external
owner-approved legacy-inventory digest through
`--expected-legacy-inventory-sha256`, verifies the pre-state against it, and
derives a canonical expected state from the complete security snapshot. Its
reviewable plan may remove only `codex/review-gate`; an emptied status rule may
be removed, as may an emptied classic required-status policy; a whole dedicated
legacy-only ruleset may be deleted only when no other rule remains. Those are
the only structural exceptions. Repository/default head, workflow/CODEOWNERS
inventory, owner permission, every field/non-legacy check including `strict`
and `app_id` in a surviving classic policy, and every retained ruleset's
identity, conditions, bypass actors, and unrelated rules are preserved exactly.
The plan exports an expected post-cleanup security SHA-256. Final read-only
`--verify-post-cleanup` requires that external digest through
`--expected-post-cleanup-security-sha256` and accepts only two
identical complete security rounds that both match it, show both legacy
surfaces clear, and show the same complete v2 policy Active. Inconclusive
post-write state leaves v2 Active and permits only read-only diagnosis, never a
disable or rollback. The
migration PR carries both workflows plus CODEOWNERS. Once active,
Code Owner review and stale-approval dismissal protect
later changes. Required check `integration_id: 15368` denotes the entire GitHub
Actions App, so it is not by itself proof that the canonical verifier produced
the CheckRun. Exact bytes, complete workflow inventory, CODEOWNERS, Code Owner
review, strict freshness, no bypass and canary collision readback provide the
adopted compound boundary.

The verifier admits `pull_request` `opened`, `reopened`, `synchronize`,
`ready_for_review`, GitHub-native `stacked`, and all `edited` events. Every
subscribed event executes the fixed required job
`codex/github-review-gate`; no job is skipped or dynamically renamed to satisfy
the required check. All events retain the same canonical run title and perform
a full evidence reconciliation. A title/body-only edit does not invalidate an
existing valid current-head clean or demand a fresh review by itself; if clean
evidence is missing, the existing failure-only, first-attempt opt-in request
path may still ensure a request. The `stacked` action provides
immediate verification when a PR joins a native stack; it supplements and does
not replace `synchronize`. The `@v2` runtime accepts the new action, but an
installed four-action verifier workflow must be refreshed to include it for
that immediate wake-up. It requires same-repository, open, ready PRs whose direct
base is the current default branch, with one exception: authenticated GitHub
native stacked-PR metadata must bind the stack trunk to that same default
branch. It rejects arbitrary manual feature-base chains, forks, and stacks
with another trunk. The direct PR base ref/SHA and stack trunk ref/SHA are
distinct exact bindings, and current stack membership is revalidated. Each PR
has its own verifier; lower-PR review results are not inherited. The protected
controller and ruleset remain default-branch-rooted. For a verified base-ref
retarget, the optional `CODEX_REVIEW_GATE_AUTO_REQUEST=true` path revalidates
the current head/base/test-merge scope before reusing or creating a canonical
request. Deduplication uses the latest base epoch and exact current tuple, not
each verifier event, so duplicate events in one epoch reuse the post-epoch
request. The primary pass evidence is a trusted, unedited top-level terminal
clean whose explicit SHA uniquely resolves to the current full head; it is
independent of request/controller attribution and verifier-run `created_at`.
Its server timestamp must be strictly later than the latest actual base-ref
retarget epoch, including A-to-B-to-A. This recency floor does not prove
request causality or base-SHA coverage. Findings retain their existing
supersession rules; an exact-head clean alone does not erase one. Consumer
availability requires a corresponding Action release and canonical workflow
refresh. If the retarget event or current-scope verifier evidence is
unavailable, use the draft-to-ready fallback. GitHub's stack object exposes
stack number, size, position, and
base ref/SHA. The gate binds current stack identity/position and trunk ref/SHA;
a size-only increase when a PR is added above this one does not change its
scope. A failed verifier from any admitted event can
feed the optional `workflow_run` ingress.

GitHub records the verifier run/job/native CheckRun against the exact PR
feature-head SHA even though the canonical `pull_request` workflow executes on
`refs/pull/N/merge`. Inside the Action, `GITHUB_REF` and `GITHUB_SHA` must match
that merge ref and the fresh PR test-merge SHA; the event head/base values must
also match a fresh PR read. Event validation is limited to head/base SHA, ref,
and repository: event `merge_commit_sha` may be missing or historical and is
not a binding input. The protected top-level `run-name`
provides a second receipt: the run `display_title` must equal
`codex-review-gate-verifier/<PR>/<current test-merge SHA>` for every subscribed
event. Its sole PR binding must carry the current feature head and exact
direct-base ref/SHA. For a native stack, the current trunk ref/SHA is separately
validated. This
is the execution binding that lets a successful feature-head CheckRun prove
evaluation of the exact current test-merge. The CheckRun itself does not
belong to the test-merge SHA.

The verifier reads its own `pull_request` Actions run through
`GET /repos/{owner}/{repo}/actions/runs/{run_id}` and requires trusted native
run metadata, including the GitHub-server `created_at`. This read validates
workflow identity and current head/ref/test-merge scope and remains available
to legacy request-bound recovery and diagnostics; `created_at` is not a
positive-evidence cutoff for the primary exact-head clean. The canonical
verifier therefore needs read-only `actions: read`, including in private
repositories. Installed consumers must receive that canonical permission
before a floating `v2` release requires this read; missing authority fails
closed.

The controller admits `issue_comment` `created`, default-branch
`workflow_dispatch`, and `workflow_run` `completed` for the canonical verifier's
`pull_request` event. The completion path accepts an empty or unique PR
association; multiple associations are rejected. Comment admission checks both event sender and comment
author against exact login `chatgpt-codex-connector[bot]` and exact type `Bot`
before runner allocation. The Action revalidates the admitted event because
the two checks protect different boundaries. An edited Codex comment requires
a protected manual reconcile; direct runtime compatibility for `edited` is not
a canonical automatic ingress.

The only manual entry is `workflow_dispatch` using the protected default-
branch workflow. The manual inputs are closed and typed as documented in
[README.md](README.md). A feature-ref dispatch is unsupported. Same-repository
writers with the native repository and Actions permission to dispatch are an
explicit trust boundary; v2 does not maintain a hard-coded actor allowlist.

There is no cron, `repository_dispatch`, `pull_request_target` or writable
automatic `pull_request_review` job. The protected `workflow_run` path meets
the public-repository policy against `pull_request_target` without running PR
code in a writable context. The absence of cron avoids
billable no-op runs in private repositories. Review-object and reaction
changes, including edits to a qualifying issue comment, converge through manual
reconcile unless they create a new qualifying issue comment.

All runtime jobs are API-only. They do not check out or execute consumer or PR
code. The verifier is read-only. The controller alone receives the narrow
mutation surface needed to create requests and rerun the exact verifier:

```yaml
permissions:
  actions: write
  checks: read
  contents: read
  pull-requests: write
```

The controller uses its sole `pull-requests: write` permission for canonical
request and diagnostic comments. The GitHub issue-comment endpoints accept that
permission for a pull request; this controller never targets a standalone
issue. Neither workflow receives issues/statuses/checks/content write or OIDC
authority.
There is no dedicated runtime GitHub App. The separate publisher App is never
installed in a consumer repository.

### Dispatch and Action inputs

`workflow_dispatch` exposes `operation`, `pr_number`, `expected_head_sha`,
optional `request_comment_id` and `request_review`. Every
value is untrusted and revalidated against GitHub. The manual path requires a
full expected SHA. The automatic issue-comment path may omit it; runtime then
binds the authoritative PR head at startup. Both paths freeze that head for the
remainder of the run.

The controller Action uses underscore-named inputs `github_token`, `pr_number`,
`expected_head_sha`, `operation`, `request_comment_id` and `request_review`.
Manual `operation` choices remain `reconcile|begin-review`; the protected
`workflow_run` ingress alone may select internal `report-completion`, and
`request_review` remains boolean.
Verdicts, identities, status context, stale overrides, numeric limits and
skip-reconcile controls are not inputs.

Both Action steps derive `limits_profile=default|expanded` only from protected
repository variable `CODEX_REVIEW_GATE_LIMITS_PROFILE`. Dispatch has no profile
or numeric override.

The resolved organisation/repository variable `CODEX_REVIEW_GATE_AUTO_REQUEST`
authorises an automatic request only when its value is literally `true`.
Missing or any other value cannot authorise the request. The GitHub Actions
job-level expression compares strings case-insensitively, so `TRUE` may still
allocate a runner; the runtime checks the exact string before any request
POST and fails closed. This variable is not a dispatch or Action input. The
initial canary opt-in is `codex-private-workflows`, with other consumers off by
default: scope the `Joey-Tools` organisation variable to that selected
repository only, without a repository-level override. This adds no runtime
App or ruleset.

`request_comment_id` is only a locator hint. The reducer may use it to avoid
unnecessary backward requests, but must prove that every newer relevant
request, finding, progress artifact, malformed artifact and conflict has been
accounted for before stopping. A hint never supplies evidence authority.

## Operations and head binding

### `begin-review`

`begin-review` validates the selected supported PR and bound head, and by
default creates or safely adopts a fresh exact `@codex review` request with the
canonical controller marker. The marker binds
the v2 format, full head, current base repository/ref/SHA and workflow run.
`request_review=false` skips posting; it is best effort and creates no special
barrier. For manual and issue-comment entry, the controller establishes a newer
full verifier attempt after exact request readback.

An issue-comment or manual workflow-authored request attempt is bound to
repository ID, PR, expected head and `GITHUB_RUN_ID`. A rerun may adopt its own
exact, unedited,
matching marker. If the POST result is unknown, runtime first rereads GitHub;
it does not blindly repeat the request. Continued uncertainty keeps pending and
reports `retry_begin` with `retry_safe=false`, because GitHub issue-comment
creation has no idempotency key and the side effect may have succeeded before
the failure became visible. The caller waits for the exact same-run marker to
settle and, if it remains absent, reruns the original workflow run; an immediate
retry or distinct dispatch could create a duplicate generation.

Same-PR controllers use `cancel-in-progress: false`. This serialises active writers
but cannot prevent GitHub from replacing a not-yet-started pending run. A
caller therefore observes the exact `begin-review` run complete before treating
it as a barrier or posting a dependent request.

Outside the opt-in automatic path, agents normally make a low-cost provider-side
attempt with exact `@codex review` when the check is not already passing,
avoiding an Actions runner while other
checks run. The comment does not grant provider capability or guarantee
delivery; absent official Codex evidence remains pending. `begin-review`
remains the coordinated path, especially for a deliberate same-head re-review
that must establish a newer verifier generation.

### Opt-in automatic request after verifier failure

A failed first attempt (`run_attempt=1`) of the canonical
`Codex Review Gate Verifier` is a trigger, not authority for a review request.
The protected `workflow_run` path rereads the completed failed verifier and PR,
and requires the same-repository PR to remain open and ready, with a default-
branch direct base or an authenticated native-stack trunk bound to that branch,
and at the verifier's exact current head. It requests exact `@codex review`
with the canonical marker only when no matching canonical request already
exists for that repository/PR/head/base scope; missing or ambiguous evidence
remains blocking. An uncertain POST is reread and left pending without a blind
second POST; cross-run adoption is not an exactly-once guarantee. Unlike
manual same-run recovery, this automatic path may
adopt an existing exact canonical marker from a prior run without matching its
run ID; an existing match suppresses another POST for that scope. The controller uses
`begin-review` with `request_review=true`, but derives its automatic trigger
source from the event rather than a new Action
input. In this path, request readback completes without establishing a newer
verifier attempt or calling `reconcile`: a later Codex bot `issue_comment` or
protected manual dispatch performs that reconciliation. If a merge conflict
prevents the verifier from running, there is no `workflow_run` failure to
consume, so recovery is manual. The feature is off unless explicitly enabled
by the exact variable value above.

### `report-completion`

Every eligible canonical verifier completion other than the preserved
auto-request branch selects `report-completion`, including successful reruns,
failed/cancelled completions and runs when `CODEX_REVIEW_GATE_AUTO_REQUEST` is
unset. The operation is `workflow_run`-only and has no dispatch option. It
revalidates the exact canonical workflow/run/attempt, the selected PR's current
head/base/test-merge scope, the latest exact-head verifier run and its current
CheckRun before writing a best-effort diagnostic snapshot. It performs no
provider-evidence scan, reconciliation, verifier rerun or review request. The
extra controller run consumes billable runner minutes.

When GitHub supplies no PR association, the workflow passes `pr_number: 0` as
an internal sentinel. Runtime accepts it only for an empty association list,
parses the PR and test-merge SHA from the exact canonical dynamic `display_title`,
and binds that result to the current PR and exact run scope. A multi-PR
association is rejected; the old automatic `begin-review` path still requires
the unique association and does not use this fallback.

The diagnostic is an editable output projection, not review evidence or gate
authority. A stale run/scope snapshot is ignored; the current successful
native `codex/github-review-gate` CheckRun remains the only required signal.
For an empty-association event, the unchanged controller concurrency
expression has an empty repository-scoped suffix rather than the usual PR
number. Runtime performs a final point-in-time recheck before the write, but
this fallback does not guarantee per-PR serialization with every other
controller run. The snapshot cannot authorise a merge.

Publish the compatible Action runtime before installing a controller workflow
that calls `report-completion`; do not expose the operation to v2.1.6 or older
runtime code. Keep the Action release and canonical workflow rollout aligned.
The source repository is the self-hosting exception because its controller
workflow changes in the same source PR. Until the Action release is available,
the optional diagnostic controller run may fail on the unknown operation; the
required verifier CheckRun and existing manual operations are unchanged.

### `reconcile`

Manual reconcile requires the caller's full `expected_head_sha`; the automatic
path binds the equivalent value at startup. The controller rereads the PR,
locates exactly one canonical verifier whose native CheckRun is on the current
feature head and whose run is bound to the current test-merge, records
baseline attempt `A`, establishes that no canonical attempt is queued or
running, requests one full rerun, and requires exact attempt `A+1` plus its
unique job/CheckRun to become observable. A jump, duplicate, ambiguous POST or
unreadable inventory remains blocking and is never blindly retried.

The verifier is latest-generation single-flight with `cancel-in-progress:
true`; cancellation cannot satisfy the gate. A stale verifier never follows a
different head, base or test-merge SHA. Direct commit-status projection and its
old mutation/readback state are deleted.

## Authority model

### GitHub is the reconstructive source

Every reconcile rebuilds authority from GitHub PR objects. There is no durable
Git ledger, Actions-artifact ledger, central controller, cached receipt or
sticky-comment authority. Artifacts are not uploaded and raw API payloads are
not retained.

The best-effort sticky diagnostic is an output projection only. Its v2 marker
is distinct from request markers and contains no `@codex review`. Only a
strict canonical comment from `github-actions[bot]` with the matching PR
binding qualifies. The `report-completion` operation reads the complete
issue-comment inventory before writing: it patches the one strictly bound
canonical diagnostic when exactly one exists, posts one when none exists, and
skips the write with a bounded warning when multiple canonical diagnostics
exist. Only `report-completion` patches an existing diagnostic; another
operation may still create one when absent. The updated controller diagnostic
format omits visible unknown counts and thread detail while its hidden payload
preserves typed `unknown` fields; it labels itself as a snapshot rather than
the current gate result and includes the PR/head, run/attempt/link/time, and
authoritative verifier/Checks summary. Older canonical payloads, including the
v2.1.6 shape without `reviewThreads`, remain readable. An edited presentation
never becomes review evidence.

Write suppression is broader than the evidence exemption. Only an exact raw
canonical body with the required hidden-field types, official Actions
provenance, canonical timestamps and no edit proof is excluded from physical
request lineage. An edited, invalid, forged or wrong-provenance marker-looking
comment fails closed as an unbound physical-only boundary. Such a boundary can
leave an unclosable historical gap and require a replacement PR; another valid
sticky does not make the boundary harmless.

### Admitted evidence

The reducer consumes qualifying Codex top-level issue comments and pull-request
review bodies. A closed official `COMMENTED` inline-parent review may be a
terminal receipt only when its fixed grammar and native commit binding verify;
it is treated as a clean non-inline parent payload. The parent's informational
disclosure uses the same closed structural grammar as
clean issue comments, including the observed team-settings setup link and
shorter call to action. Presentation whitespace and these known wording
variants do not turn historical inline-parent wrappers into malformed findings.
Unknown prose, extra findings or links, mismatched commit references, and
invalid provider provenance remain blocking evidence; a historical parent
never supplies primary current-head clean authority. Primary pass evidence is
one trusted, unedited top-level terminal issue-comment whose explicit
reviewed-commit SHA resolves uniquely to the current full PR head. It needs no
controller/request attribution and no verifier-run `created_at` ordering, but
its server timestamp must be strictly later than the latest verified
base-ref-retarget epoch when one exists. Complete comment/review acquisition,
exact refetches, stable snapshots and current test-merge checks remain
mandatory. The Action does not query inline review threads; the installed
ruleset alone enforces server-side conversation resolution.

Provider carriers must bind exact bot identity. Similar names, copied text or
user-authored claims have no authority. A finding's severity label does not
affect blocking: any qualifying finding blocks.

The V2 provider parser profile projects away complete leading/trailing HTML
comments before parsing issue-comment, native review and inline-parent bodies.
It accepts arbitrary names, repeated or multiline boundary comments and does
not require a blank separator. Both the previously supported receipt marker
and the observed `<!-- codex-code-review-finding:v1 -->` finding marker are
decoration, not authority. Findings and known service failures retain their
non-clean meaning after projection. Comments supply no conclusion or binding;
native review states retain their existing independently validated semantics.
Interior comments, visible text, code examples, arbitrary HTML and incomplete
comment delimiters are not generally stripped. This is deliberately a boundary
compatibility layer, not a Markdown/HTML interpreter.

The shared parser opts into this profile explicitly; legacy/default callers
and the older known-receipt-only option retain their existing behavior.
Original carrier bodies and server metadata stay unchanged for identity,
edit, exact-refetch and fingerprint checks. Approved-review commit-reference
collection uses the same projection as its grammar, not hidden comment text.
All visible finding checks, Bot/App provenance, commit/request binding and
complete-snapshot guards remain required. The closed V2 inline-parent grammar
may omit a body commit field because the full native `commit_id` supplies its
binding, independent of whether a hidden wrapper is present. Top-level clean
issue comments still require their explicit body commit field. A historical
wrapped review is classified normally, not promoted to primary current-head
clean. Inline-thread state remains solely a ruleset condition.

[GitHub's review API](https://docs.github.com/en/rest/pulls/reviews) offers raw,
text and HTML bodies. An authenticated probe of the observed finding showed
that rendered fields expand its blob link into a source card and alter the
Markdown needed by the current grammar. They are not used as a replacement
carrier. The dependency-free Action keeps the narrow projection rather than
adding a Markdown AST parser and distribution dependency for edge comments.
The separate official PR-level summary and its embedded state remain
non-authoritative and cannot substitute for a qualifying terminal carrier.

An observed official service-failure issue comment is a separate non-clean
carrier, not a finding or a positive review result. Its closed grammar is the
exact `Something went wrong` retry heading, one fenced `Unknown error` detail,
and the required, already-admitted official disclosure. It retains the
normal Bot/App identity, canonical server-time, unedited-carrier, exact-refetch
and stability requirements. Extra prose, finding content, unknown links or
failure formats, edited carriers and invalid provenance remain fail-closed.

A known service failure ceases blocking only when it is strictly older than
an eligible current-head request `R` followed by a trusted current-head clean
`C`, using the same current-head witness rules below. The order is
`failure < R < C`; the failure itself never supplies clean authority or closes
a request. Without that later qualifying witness, or when the failure occurs
at or after the selected clean, it remains non-passing. This narrow exception
exists because an earlier provider execution failure must not become a
permanent malformed-finding lock after a later review succeeds. It does not
suppress unknown malformed evidence or provider findings, and it does not add
automatic review requests or recovery mutations.

GitHub REST may omit `submitted_at` entirely for a `PENDING` pull-request
review. It remains in identity, exact-refetch, and snapshot-stability
observation, but it is an unsubmitted draft and its body is not reduced into
provider finding or clean evidence. Its presence is nevertheless liveness
evidence: it blocks pass, including a clean that predates the draft, until the
review reaches a stable terminal state. A later submitted terminal review is
observed normally; inline conversations remain a ruleset condition. Every
terminal review state still needs a canonical `submitted_at` timestamp, so a
malformed terminal review remains fail-closed.

The protected property of an untimestamped `PENDING` draft is its review ID,
provider actor/App provenance, and commit binding; its draft body may change
before submission. A body update restarts snapshot stability and an update
observed only by exact refetch abandons that snapshot for a later retry. It
never becomes terminal evidence. The only draft-to-terminal lifecycle admitted
by the stability latch has that same immutable binding and becomes a
canonical-timestamped `COMMENTED`, `APPROVED`, or `CHANGES_REQUESTED` review.
The exact response is not retained as the terminal value, because the list
endpoint may still show `PENDING`; a later complete snapshot must first see
the terminal state through its normal list read. A terminal review must then
be observed consistently before it can affect the decision.

A `PENDING` review missing from a complete list is not presumed deleted. The
verifier exact-fetches it: a still-pending result retains the liveness lock and
a permitted terminal result waits for normal-list convergence. Only two exact
`404` observations in separate complete-snapshot attempts confirm deletion;
that confirmation itself forces another fresh complete snapshot before the
draft can cease blocking. If the draft reappears, it becomes live again only
when the same ID, actor/App and commit binding still match. Reversions,
`DISMISSED` transitions, terminal-to-terminal drift, or any identity, App or
commit-binding change remain fail-closed.

### Review generations

An authorised generation begins only with an exact, unedited
`@codex review` request. Its first visible line is exact and there is no other
visible text. Under the default `any` policy, an ordinary request author at any
repository permission is admitted only as an unconfirmed candidate. It can
receive provider confirmation either from an official Codex Bot `eyes` or `+1`
reaction directly attached strictly after that comment's revision, or from an
unedited official terminal-clean receipt strictly after the candidate. The
terminal form is allowed only for the one unique, exact, unedited ordinary
request in a no-base-epoch, single-flight lineage, and only when the terminal
unambiguously binds the current head. Its admitted carriers are a top-level
issue-comment clean and the exact closed `COMMENTED` Codex inline-parent review
grammar; generic pull-request reviews are not receipts. An additional or
ambiguous request or physical
boundary, an edit to either carrier, an unmatched terminal, or ambiguous
head/SHA binding leaves the state pending. A terminal short SHA is accepted
only when GitHub resolves it unambiguously to the current PR head. Direct
same-comment official `eyes`/`+1` remains supported. This is only gate
attribution: it does not grant the commenter permission to invoke or control
Codex review, does not make Codex start, and does not mean every user can cause
a review; actual provider start remains GitHub/Codex-controlled. An
unconfirmed candidate with no terminal-clean contender cannot reset, preempt,
or invalidate an established clean; an attempted terminal-clean receipt that
fails the narrow rule remains fail-closed and pending. Canonical workflows fix
`CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION=any` and do not expose a standard
strict-policy setting. The stricter `write` threshold (`write`, `maintain`, or
`admin`) is reserved for a nonstandard future verifier identity allowed to read
collaborator permissions; the bundled read-only verifier token cannot reliably
do so. A workflow-authored request additionally needs the exact v2 marker
binding the full head and run.

The only duplicate-request recovery is a *duplicate cohort* (a fixed legacy
pair, not a producer protocol). With no base epoch, it accepts exactly two
strictly sequential, unedited exact default-`any` ordinary
(non-canonical-marker) `@codex review` requests from the same `User` login only
if neither has an official direct `eyes`/`+1`, a single unedited official
top-level issue-comment clean after both resolves exactly to the current head,
there is no provider error in the snapshot, and every pre-pair official
top-level `issue-comment` provider artifact with a valid activity window vetoes
the cohort unless it is a safely classified historical terminal: kind `clean`
or `finding`, unedited, with no `orderingError`/`resolutionError`, and exactly
one full unambiguous SHA across `resolvedHeadSha` and `headSha`. This includes
any otherwise unknown or unclassified, malformed, progress, or nonterminal
official top-level `issue-comment`: with a valid activity window, it is opaque
provider activity (a blocker rather than clean evidence) and vetoes the
cohort. An earlier carrier may own the later clean; this explicit exception—not merely a full-head
binding—preserves safely classified historical terminals. From the first
request through that clean (or, if present, through its sole canonical
successor), no additional provider artifact or opaque provider activity with a
valid activity window may appear. Opaque provider activity is an exclusion-only
side channel: it does not enter the ordinary reducer, liveness, finding, clean,
or count paths. The only possible successor is one strictly later canonical
workflow request with the current full head/base tuple. Without a successor,
the later ordinary request is confirmed and the earlier one is coalesced; with
that successor, the later ordinary request remains the explicitly confirmed,
already-closed predecessor; an unbound terminal after the successor cannot
complete it, and only a direct official `+1` on the successor can do so.
Inline-parent receipts, a third request, another author, edits, base epochs,
reactions on either ordinary request, provider activity or errors, a pre-pair
official top-level `issue-comment` provider artifact with a valid activity
window unless it is the safely classified historical-terminal exception above,
an extra provider artifact or opaque provider activity in that exclusive window,
findings, and every other successor remain fail-closed. The exception requires
every listed terminal property; a historical terminal clean/finding is not
preserved merely because it has a full-head binding. This recovers an immutable
historical pair; agents must not deliberately create one.

The *legacy request-bound clean fallback* admits a fresh head-scoped witness
for compatibility recovery; it is secondary to the primary exact-head clean
rule above and is not required merely to reconcile an old request gap. Without
a base epoch, its cutoff `T` is the
GitHub-server `created_at` of
the original `pull_request` verifier run, fixed across attempts of that run
ID; it is not the PR synchronize-event time. A witness consists of one eligible
request `R`: either an exact,
unedited ordinary `@codex review` from a `User`, or a verified, unedited
canonical Actions request whose repository, PR, full head/base tuple, and
workflow-run marker match the selected PR and verifier scope. Both forms are
followed by a trusted, unedited top-level issue-comment terminal clean `C`
whose resolved full SHA uniquely equals the current head. The order is strict:
`T < R < C`; `R` is the latest physical request boundary before `C`, and no
request boundary follows `C`. This is current-head attestation (the clean's
unique full-SHA binding covers the selected head, not request-to-result
causality); posting `R` does not prove Codex started.

Under the configured `any` request-author policy, a token-generated `User`
request may carry a canonical hidden marker. It remains an ordinary user
request, not a workflow-authored request or workflow authority. For this
recovery, marker metadata does not veto an otherwise eligible exact ordinary
request or establish its head binding; the later clean independently supplies
current-head attribution. A canonical Actions request still requires its
verified current-scope and workflow-run binding.

Historical ordinary requests before `T` remain in the complete lineage audit.
An eligible witness may ignore their request-attribution gaps, including a gap
left by an older request for a different head, and does not require each older
request to acquire its own closing `+1`. This does not delete the history or
label those requests completed. Valid nonterminal provider activity before
`C` does not prove that an older flight must finish first; relevant activity at
or after `C`, or a newer request boundary, remains blocking. The recovery does
not clear findings or unknown provider errors. The explicitly recognised
older service-failure carrier above may be superseded. One other narrow
non-clean category is an otherwise valid official top-level clean receipt
whose Reviewed commit marker is completely absent. It remains malformed and
never gains a guessed commit binding or positive authority. Only a later
eligible request and its independently valid current-head recovery clean may
supersede that earlier missing-marker error. The conclusion, optional
disclosure, timestamps and official provenance must otherwise be valid, with
no finding content. Duplicate or malformed markers, invalid disclosure,
unknown extra content and other parse errors do not qualify. This does not waive unknown, edited,
deleted, forged, scope-drifted or ambiguous evidence. It requires complete
inventory, exact refetches and two stable snapshots. A new verifier run ID has
a new cutoff and cannot inherit the witness.

For an existing verifier whose history contains a base epoch, the same
head-attested recovery has a narrowly scoped post-epoch form. Set
`T = max(original verifier created_at, latest base epoch)` and require strict
`T < R < C`. `R` may be an exact,
unedited ordinary `@codex review` from an authorized `User`, a verified,
unedited canonical Actions request bound to the selected scope, or an unedited
token-generated `User` request with the eligible ordinary request shape;
hidden marker metadata neither grants workflow authority nor vetoes that
ordinary request. `C` must be a later,
trusted, unedited official top-level issue-comment clean with an explicit
commit reference that resolves uniquely to the selected current full head.
The request must be the latest physical boundary before `C`, and no later
request boundary may follow `C`. Relevant provider activity at or after `C`
remains blocking; nonterminal activity before `C` alone does not require an
older flight to finish. This is head
attribution, not request-to-clean causality: the clean identifies the reviewed
head, so it need not identify the triggering comment. This exception provides
a fresh current-head recovery for that existing verifier only. It does not
close arbitrary predecessor gaps, make unbound terminal payloads positive
lineage carriers, blanket-promote other unconfirmed ordinary candidates, or
supersede a finding. Complete pagination, exact refetches, two stable snapshots
and provider/history guards remain required. Inline-thread resolution is not
read by the Action and is enforced only by the installed ruleset.

The permission threshold protects generation resets, not negative evidence.
Qualifying provider findings block regardless of the request author's
permission. A finding never serves as the minimal terminal receipt. The exact
closed Codex inline-parent form is a narrow receipt for its non-inline parent
payload only; it does not itself prove that its threads are resolved. Other
pull-request review cleans remain ordinary evidence and cannot be that receipt.

Apart from the primary exact-head clean and this legacy fallback, terminal
clean text and a qualifying provider `+1` are equal clean carriers only for the
first physical generation of a no-base-epoch, single-flight lineage. Physical boundary
recognition is deliberately separate from positive authority, except that
the narrow default-`any` top-level issue-comment or
exact closed inline-parent terminal-clean receipt can establish that first
generation and carry its clean authority at the same time.
The recovery-only duplicate cohort is another narrow top-level-clean
variation: it confirms only its later ordinary request, never an inline-parent receipt or a
canonical successor.
An unconfirmed default-`any` ordinary candidate without a terminal-clean
contender is otherwise not a physical boundary. A terminal-clean contender
that cannot meet the narrow receipt conditions remains an unresolved,
fail-closed physical-only boundary. Every other provider-triggerable
request-shaped comment is one boundary, including same-run duplicate markers
and edited, malformed, wrong-author, or denied requests. Physical-only
boundaries are unbound and receive no positive authority. Under the
nonstandard `write` threshold, a
syntactically valid ordinary
request must undergo a permission lookup, cached per author within each
snapshot, before it can be classified as denied; once denied, it causes no
reaction or exact-refetch fan-out. Boundaries rejected earlier for invalid
shape, author, or binding cause no permission, reaction, or exact-refetch fan-
out. Every observed `CommentDeletedEvent` is an unbound physical-only boundary
at its event time because GitHub exposes no recoverable body with which to rule
out a provider-triggering request. It participates in the stable fingerprint
and current-run irreversible inventory; if it leaves an unclosable historical
gap, same-PR evidence cannot repair it and recovery requires a replacement PR.
A canonical request bound to the current full head remains a boundary when its
base SHA, ref, or repository tuple is stale; exact current scope is an
authority requirement, not a boundary-erasure rule. Without a base epoch,
provider terminal evidence strictly between the first request and its
successor may close only that first gap. For an ordinary default-`any`
candidate, it can also serve as that first request's minimal receipt only under
the unique single-flight rule above. Every later predecessor-to-successor gap,
and positive or superseding authority for any generation with a physical
predecessor, requires a qualifying `+1` directly on that request, except for
the fresh current-head clean recovery above. Provider
terminal payloads have no originating request ID, so a later carrier could be
delayed or duplicated from any older generation; stable snapshots cannot make
that attribution unique. For ordinary post-epoch lineage, existing rules
still require an exact-current-tuple canonical Actions request with a direct
provider `+1`, and a top-level terminal clean adds no authority. The separate
post-epoch current-head clean recovery above applies only to an already-
existing verifier's fresh head-attested witness; it is not a general lineage
exception.

The separately defined duplicate cohort is the only other recovery-only
exception to that ordinary second-boundary rule: its one top-level clean
closes the existing two-request cohort only. It cannot close, or supply a
terminal-clean receipt for, a canonical successor.

Official `eyes` or provider activity at or after a candidate closure and no
later than the successor keeps the predecessor open. Equality with either
endpoint is ambiguous at GitHub's timestamp precision. Provider-terminal
first-gap closure additionally requires a complete predecessor reaction
inventory; a boundary whose reactions were deliberately not loaded cannot be
closed by unbound terminal evidence. A clean bound to the latest request cannot
bypass an earlier unclosed gap, and evidence arriving after the successor
cannot retroactively repair that gap.

Progress with one unambiguous commit binding is scoped directly to that head.
Every unbound progress carrier remains in the current-head inventory. Request
boundaries near its creation or revision prove ordering only, not which flight
or head produced the carrier. An edited provider terminal also produces an
unbound unknown-activity interval from immutable creation through terminal
revision because GitHub exposes no intermediate body history. The same
carrier's terminal endpoint is exempt only from self-veto while evaluating
that terminal; the interval still participates in predecessor-gap liveness,
and no other carrier receives that exemption.

After any observed base epoch, terminal payloads cannot prove which
request/base snapshot produced them. In ordinary degraded-lineage evaluation,
only a qualifying `+1` directly attached to the latest strictly post-epoch,
base-bound canonical workflow request is a positive or superseding carrier.
An unlineaged terminal clean remains diagnostic evidence and cannot pass or
clear a finding. This is a deliberate fail-closed exception to carrier parity;
the separately specified post-epoch current-head recovery applies only to an
existing verifier's fresh head-attested witness and grants no lineage
authority.
For an unconfirmed default-`any` ordinary candidate, a direct official
post-revision `eyes` or `+1` is first a receipt that promotes it into a
boundary. For the ordinary single-flight candidate, the only alternative is
a matching unedited official current-head top-level issue-comment terminal
clean or exact closed `COMMENTED` inline-parent
review strictly after that candidate under the unique no-base-epoch,
single-flight rule. It is unavailable after a base epoch, after a second or
ambiguous request/boundary, after an edit, or when terminal identity, ordering,
or head binding is ambiguous. The separately defined duplicate cohort is the
other recovery-only exception to the second-boundary case: it accepts only an
already-existing two-request snapshot with a top-level clean and never makes a
canonical successor terminal-clean eligible. Afterwards, ordinary request reactions are
provider-liveness signals only; ordinary `+1` cannot head-bind clean. Same-time/later
official `eyes`/progress from Codex vetoes candidate clean evidence. Because
reaction changes do not trigger the consumer workflow, a later provider event
or manual reconcile must observe the settled state.
When a terminal carrier includes a reviewed commit, a full or abbreviated SHA
is accepted only if GitHub resolves it unambiguously to the current bound head.
For a pull-request review, the resolved commit must also equal native
`commit_id`. A short prefix with zero or multiple relevant matches is
indeterminate; runtime never guesses or loosely extracts a convenient token.

### Finding supersession

A qualifying current-head finding has conservative precedence. On the same
head, an older non-inline finding is superseded only when both of these are
proved:

1. a strictly newer authorised review generation exists; and
2. a later clean belongs to that newer generation under the legacy
   request-bound lineage rule above: a terminal clean only when it is the
   first no-base-epoch physical generation (and, for a default-`any` ordinary
   candidate, meets the minimal terminal-receipt rule), otherwise a qualifying
   request-bound `+1`. Neither the primary exact-head clean nor the legacy
   fresh-clean fallback silently supersedes a finding.

An unrelated later clean cannot clear the finding. Ambiguous temporal order,
generation binding or head binding remains failure or inconclusive. A
superseded finding remains historical evidence for diagnostic accounting; it
is not erased from GitHub.

This asymmetry admits recovery from an obsolete or inapplicable finding without
letting positive evidence mask a finding silently.

## Complete snapshots and stable success

### Inline conversation resolution

The Action does not query the GraphQL `reviewThreads` connection, inspect
inline comments, discover rulesets, or decide whether conversations are
resolved. Its diagnostic schema remains compatible: `review_threads.status` is
`not_read`, and `resolved`, `unresolved`, and `total` are `unknown`. These
values mean “not inspected,” never zero or a clean conversation inventory.
The report cannot block on, summarize, or make claims about human-authored,
outdated, old-head, or unresolved inline threads.

The installed GitHub ruleset must require all review conversations to be
resolved. GitHub, not the Action, enforces that merge condition for every
thread, including old-head, outdated, and human-authored threads. Operators
must inspect or resolve conversations through GitHub's native review UI or
API. The required status and conversation-resolution rule are independent:
Action success means only that current Codex evidence passed, not that the PR is
merge-ready. No ruleset discovery query or additional permission is added by
the Action.

The compatibility diagnostic fields are not public Action outputs. The current
run reports `review_threads.status: not_read` and `resolved`, `unresolved`, and
`total` as `unknown`; these values do not mean zero. It emits no thread
inventory, per-thread URL, location hint, count, or thread-based recovery step.
Finding diagnostics cover only normalised non-inline Codex findings. The
consumer ruleset remains responsible for all inline conversation state.

A “snapshot” is one independent, fully paginated set of GitHub API reads used
to decide the fixed PR/head scope. It includes:

- PR identity, lifecycle, base and head;
- the latest filtered `BaseRefChangedEvent` or `BaseRefForcePushedEvent` from
  the PR timeline;
- request/reaction lineage only when needed for a legacy fallback or
  non-inline finding supersession;
- qualifying Codex top-level comments and review bodies, including IDs,
  timestamps, actor/App identity and body digests;
- reviewed-commit resolution and native review `commit_id`; and
- collection completeness and exact-object refetch results.

### Bounded acquisition batching

Each carrier pass still acquires complete comments and reviews before local
selection. It reads the latest filtered base-event connection alongside the
first comment-history GraphQL page, rather than through a separate request.
Subsequent history pages retain independent deletion/comment cursors; they do
not repeatedly acquire the latest base event. Both history and epoch validators
retain their observed-change latches, including on partial responses.

Selected review-request reactions are acquired in bounded GraphQL batches,
with at most eight comment connections per response and 100 reactions per
connection page. Bind each comment's node and database IDs, repository and PR
to the complete REST inventory. Follow each unfinished connection independently
until its unique reaction count equals a stable `totalCount`; missing nodes,
GraphQL errors, repeated IDs/cursors, count drift and partial pages fail closed.
Never fall back to an incomplete REST or GraphQL inventory to produce success.

GraphQL represents the official Codex reaction account as `User`, so its
typename or `[bot]` login suffix cannot attest REST `Bot` provenance. Each fresh
carrier pass that observes an official reaction independently reads the exact
official account through REST, requires its canonical ID/login and `Bot` type,
and binds the GraphQL reaction author's database ID to that account. The
account observation is shared only inside that pass, never across snapshots.
Reaction IDs, times, provenance and history fingerprints feed the unchanged
reducer. Unrelated actor types cannot authorize review requests.

The page budget counts fetched pagination responses, including empty ones:
one combined GraphQL response consumes one page, not one page per nested
connection. Every nested raw object still counts against object capacity;
response-byte, total-byte, attempt, deadline and batch-size caps remain in
force. This lowers network fan-out without hiding unbounded evidence.

Exact REST comment/review refetches and missing-pending-review confirmation
remain mandatory. Opening and closing carrier inventories are still fresh
GitHub reads, and two complete snapshots still underpin stable success.
Batching is transport optimization, not an atomic GitHub transaction or a
comparison of a cached evidence set with itself.

The fingerprint is a deterministic representation of every decision-relevant
value in that snapshot. It is only an equality check between fresh reads, not
a durable receipt.

GitHub does not offer an atomic cross-endpoint read. Webhook delivery may lead
API visibility; Codex may publish request, review and terminal objects at
different times; and pagination may span changing server state. Negative
evidence is asymmetric: a qualifying finding can be proved immediately, while
clean requires complete evidence that no blocker exists.

Therefore only a clean candidate uses the stability protocol:

1. fetch snapshot A completely;
2. wait five seconds;
3. independently fetch snapshot B completely; and
4. require the same fixed head and decision-relevant fingerprint.

A relevant same-head request, edit, reaction, comment/review change or
exact-refetch change restarts the stability window. A head change, closure,
merge or expected-head mismatch makes the run stale and stops retargeting.
Pagination, API and cap failure make a read incomplete rather than “changed”.
No incomplete or unstable observation can produce success.

The latest observed actual base-ref-retarget event is an evidence-epoch
barrier for primary clean evidence: the top-level clean's server timestamp
must be strictly later than the latest retarget; equal timestamps are
ambiguous. This remains true after A-to-B-to-A, where the most recent retarget
sets the floor. It does not require a later request, controller attribution,
or verifier-run `created_at`. Legacy request-bound lineage keeps its stricter
post-epoch request and direct-`+1` conditions. Workflow metadata still binds
the current base directly, and findings remain conservative. The imported
ruleset blocks non-fast-forward
The imported ruleset blocks non-fast-forward
default-branch updates, and strict up-to-date handles ordinary fast-forward
movement that expands the required head. If an administrator temporarily
disables those protections and force-pushes anyway, the next exact verifier
reconstructs the timeline and remains blocking. V2 does not claim atomic
invalidation of an older same-SHA success after arbitrary provider activity;
the documented exact-current merge closure supplies that eventual boundary
without a webhook App or cron.

The stability/reconcile budget is shared across retries. If it expires without
a stable clean pair, runtime reports `unhealthy/pending` with
`wait_then_reconcile`; a later provider event or manual reconcile reconstructs
from current GitHub state.

## Resource profiles

Every authoritative collection is fully paginated. A cap hit remains
`unhealthy/pending` and reports the exact cap, stopping point and safe next
action. It never truncates evidence into success.

The profiles are policy, not arbitrary dispatch numbers:

| Profile | Pages | Raw objects | API attempts | Snapshot | Request timeout | Reconcile budget |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `default` | 100 | 2,000 | 128 | 32 MiB | 10 s | 60 s |
| `expanded` | 500 | 10,000 | 512 | 64 MiB | 20 s | 300 s |
| hard ceiling | 1,000 | 20,000 | 2,048 | 64 MiB | 30 s | 720 s |

The page cap is aggregate within each complete snapshot, including opening and
closing pagination responses and each reaction batch's first page. It is not a
per-endpoint cap or a review-round limit. Under the original per-comment REST
reaction acquisition, ordinary multi-round PRs could exhaust 20 pages despite
a small comment count, so the default now permits 100 pages. Batching reduces
actual responses without pruning historical reactions or changing other default
limits. The expanded profile permits 500 pages. Default page exhaustion uses
`use_expanded_limits` only when expanded raises the effective ceiling;
expanded exhaustion, or protected custom caps that expanded cannot improve,
requires `raise_protected_limit`. Every capacity remains finite and fail-closed;
a higher page ceiling does not waive attempt, object, byte or time caps.

Page size is 100, one response is capped at 8 MiB, the clean inter-read delay
is five seconds and the workflow job timeout is 14 minutes. Repositories with
legitimate large PRs may persistently select the reviewed `expanded` profile
through protected repository variable `CODEX_REVIEW_GATE_LIMITS_PROFILE`.
Per-dispatch profile and numeric overrides are deferred beyond v2.0.

## Result and projection model

The public outputs are exactly:

```text
execution_health
gate_outcome
recovery_code
retry_safe
```

`execution_health` is `healthy|unhealthy`; `gate_outcome` is
`success|failure|pending|not_applicable|unknown`; `retry_safe` says whether an
immediate identical-input retry is a valid recovery operation. The closed
recovery-code set is documented in [README.md](README.md).

Legal semantic combinations are:

| Health/outcome | Meaning |
| --- | --- |
| `healthy/success` | Two stable complete snapshots proved current-head clean. |
| `healthy/failure` | Qualifying findings were proved. |
| `unhealthy/failure` | Findings were proved but execution or final result handling also failed. |
| `healthy/pending` | Evaluation completed safely, but current state cannot authorise success yet. Follow `recovery_code`; `wait_provider` means no qualifying terminal result is yet available. |
| `unhealthy/pending` | API, pagination, cap or stability execution is incomplete. |
| `healthy/not_applicable` | A delayed automatic event is stale. |
| `unhealthy/not_applicable` | A manual target is invalid or the scope is unsupported. |
| `unhealthy/unknown` | No trusted state can be read. |

Every pending result remains blocking; `healthy/pending` is not a weak
success.

`unhealthy/success` is forbidden. The verifier job maps only a stable
`healthy/success` to a successful native conclusion. Every other pair maps to
a blocking conclusion, keeping ordinary findings distinct from evaluator
failure. The required verifier CheckRun belongs to the exact current PR
feature-head SHA. Its `pull_request` run executes on `refs/pull/N/merge`, and
strict runtime merge-ref, event head/base, and fresh-read validation binds success to the unchanged
head, base and test-merge. The event portion is limited to the PR head/base
scope, never its `merge_commit_sha`. The controller's CheckRun is bound to the default-branch commit and
never supplies the required PR result. Direct status projection and
`statusProjection` are deleted.

Every result is interpreted through its `recovery_code`; the health/outcome
pair is not an instruction by itself. `wait_provider` means this run newly
posted a review request and no qualifying terminal result is available yet; it
does not by itself prove that the PR must be replaced. If an automatic
controller adopted an existing request instead, it reports `reconcile` and
instructs an exact-head refresh to consume any published clean or surface
missing/terminal evidence. It does not infer that the provider is running or
finished. The primary pass path needs a trusted, unedited top-level clean whose
explicit SHA resolves uniquely to the current head; if a real base retarget was
observed, the clean must be strictly later than the latest retarget. It does
not require a new request or a post-run timestamp solely to close old request
gaps. Findings remain blocking until existing request-bound supersession rules
are met. A missing clean alone is not an unclosable-history verdict. Edited,
deleted or otherwise unclosable evidence still requires the indicated repair
or replacement path. This guidance never changes the pending verdict.

When no additional evidence query is needed, the summary and sticky report
`findings_unresolved`,
`findings_resolved`, `findings_historical` and `findings_indeterminate`.
Incomplete pagination, API failure or cap hits make affected values `unknown`,
not zero. These are diagnostics for normalised non-inline findings, not public
Action outputs or inline-thread authority.

Summary and sticky contain a bounded reason, recovery code and concrete next
action. They expose object identities, digests, bounded escaped excerpts and
links when useful, but never tokens, headers, raw payload dumps or untrusted
workflow commands.

For a blocking verifier result, the Actions Summary ends with a dedicated
`Steps to unblock: ...` line, and the CLI prints the same final line after its
JSON diagnostics. Detailed bounded evidence stays in the preceding summary
and logs; the final line is the most actionable user-facing output, not a new
result or authority signal. It reflects current Codex evidence and does not
include inline-thread counts or resolution steps. If GitHub still blocks merge
after the Action passes, inspect the ruleset's conversation-resolution
condition and resolve outstanding threads through GitHub without changing the
head. If fixing a non-inline finding changes the head, obtain fresh trusted
review evidence for that new head before reconciling. The displayed steps do
not promise a pass; the gate re-evaluates all remaining evidence and blockers.

At-least-once recovery may create small duplicate requests, verifier attempts
or diagnostic comments after an unknown write result. `report-completion`
fresh-reads before updating or creating the single diagnostic; it leaves
duplicates untouched and reports them. It never folds or deletes comments.
Only each exact, official canonical sticky with the required binding receives
the narrow physical-lineage exemption; a non-qualifying marker-looking
duplicate remains a conservative boundary. An edited or stale diagnostic is
never review evidence. Physical review requests likewise remain separate
generation boundaries. No duplicate authorises selection of a convenient clean
or omission of a finding.

## Exact-head merge closure

Stable A/B snapshots prove only a short observation window; they do not lock
the PR. Immediately before merge, an agent must:

1. reread the exact current PR head;
2. dispatch controller `reconcile` for that exact head;
3. observe the strictly newer verifier attempt and its unique canonical
   `codex/github-review-gate` CheckRun on the current feature-head SHA, with
   that run bound to the current test-merge;
4. require Action output `healthy/success` and a successful verifier conclusion;
5. reread unchanged PR head, base and test-merge SHA; and
6. require the ruleset to confirm branch up to date, all conversations
   resolved and merge allowed.

Any head or policy change restarts this closure. Otherwise merge immediately
with this exact-head compare-and-swap:

```bash
gh pr merge "$PR_NUMBER" \
  --repo "github.com/$REPO" \
  --match-head-commit "$HEAD_SHA"
```

A previous success is never a permanent review lease, and direct human UI
merge outside this closure is unsupported.

## Supported boundary and non-goals

Current v2 releases support GitHub.com public and private repositories, an open
non-draft PR from an ordinary same-repository branch to the default branch,
plus GitHub-native stacked PRs whose authenticated stack metadata binds their
trunk to that default branch, Linux runners in GitHub-hosted or self-hosted
environments, and ordinary
merge/squash/rebase methods. The default runner selection remains
`ubuntu-slim`, with `ubuntu-latest` as the adopted fallback. An installed
workflow's explicit `runs-on` expression remains authoritative; these defaults
apply only when its configured selection falls back to them.

It fails closed for GHES, forks, merge queues, arbitrary non-default bases,
manual feature-base chains and stacks with a non-default trunk, drafts,
bot-owned PRs, Windows/macOS runners and new operations on closed or merged
PRs. A selected self-hosted Linux runner is trusted by operator assumption;
the Action does not prove host integrity or isolation, and separate GitHub jobs
are not host isolation. The controller host must be trusted when it can receive
the controller token. No additional runner-specific trust flag, allowlist,
host API, attestation, or approval mechanism is required; this does not change
any separate workflow or environment approval requirements.

The design does not claim that:

- sticky diagnostics are durable, unique or authoritative;
- two snapshots prevent a change after snapshot B;
- retries are exactly once;
- an ambiguous short SHA can be made safe by guessing;
- the Action duplicates branch freshness or conversation resolution;
- a stale run follows or repairs a new head;
- the required CheckRun proves workflow provenance beyond the compound
  CODEOWNERS/inventory/canary boundary; or
- the release publisher App contributes runtime authority.

## v1 isolation

v1 remains frozen and valid for consumers that have not migrated. v2 does not
read v1 state, publish a compatibility selector, mutate v1 refs or fall back to
the v1 reducer. Migration removes the v1 caller and installs the canonical v2
workflow plus CODEOWNERS in one PR after the pre-merge canonical inventory
fingerprint closure. It keeps the inventoried legacy requirements active,
stages a separate v2 ruleset as Disabled, verifies it in a harmless canary PR,
then activates and reads the complete Active policy back. Only afterward does
the read-only derived plan freeze the exact legacy-only removal and expected
complete post-state. Separately authorised cleanup follows that plan; two-round
read-only closure matches the external expected-state digest, proves both
legacy surfaces clear, and proves v2 still exactly Active before the canary
closes unmerged. Any inconclusive result preserves Active v2 for read-only
diagnosis.
