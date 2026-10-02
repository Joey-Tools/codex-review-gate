# Codex Review Gate v2 Design

Languages: [British English (en-GB)](DESIGN.md) | [简体中文 (zh-CN)](DESIGN.zh-CN.md)

## Goal

v2 supplies a low-cost, fail-closed native required CheckRun for one pull request at a
time. It must not report success while qualifying Codex findings or unresolved
review threads are present, while evidence is incomplete or unstable, or after
the selected PR head has changed. It favours recovery from GitHub's current
state over durable private state and tolerates small at-least-once duplicates
when uncertainty follows a write.

Existing GitHub controls keep their native responsibilities:

- GitHub stores PR lifecycle, comments, reviews and reactions;
- two copied consumer workflows own separate event admission, permissions and
  serialisation boundaries;
- managed CODEOWNERS plus Code Owner review protect both workflows as part of
  the compound no-runtime-App control plane;
- the Action reconstructs and reduces non-inline Codex evidence, and separately
  verifies that every PR review thread is resolved;
- the ruleset requires the status, branch freshness, resolved conversations
  and non-fast-forward protection; and
- the merge agent closes the loop with an exact-current-head reconcile and
  final server-side reread.

The Action's thread read is an independent fail-closed gate, not a replacement
for the ruleset's server-side “all conversations resolved” requirement.

## Architecture and trust boundaries

```text
pull_request opened/reopened/synchronize/ready_for_review
                                |
                                v
          copied read-only canonical verifier
                                |
          JoeyTeng/codex-review-gate-action@v2
          - bind PR head, base and test-merge SHA
          - validate refs/pull/N/merge, GITHUB_REF and GITHUB_SHA
          - refresh PR and require unchanged head/base/test-merge
          - fully paginate and reduce GitHub evidence
          - fully paginate PR review threads through GraphQL
          - require two stable snapshots for clean and resolved threads
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

An optional protected `workflow_run` ingress also reaches the same controller
after a canonical verifier completes with failure. It is request-only and does
not immediately rerun the verifier.

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

The verifier admits only `pull_request` `opened`, `reopened`, `synchronize` and
`ready_for_review`. It fails closed outside same-repository, open, ready,
default-base scope. `edited` is deliberately absent: after a base retarget, a
ready PR must be converted to draft and marked ready again, while an
already-draft PR is marked ready. The new `ready_for_review` event creates a
verifier for the current exact head/base/test-merge scope; rerunning the old
event does not. A failed verifier from any of these four admitted events can
feed the optional `workflow_run` ingress.

GitHub records the verifier run/job/native CheckRun against the exact PR
feature-head SHA even though the canonical `pull_request` workflow executes on
`refs/pull/N/merge`. Inside the Action, `GITHUB_REF` and `GITHUB_SHA` must match
that merge ref and the fresh PR test-merge SHA; the event head/base values must
also match a fresh PR read. Event validation is limited to head/base SHA, ref,
and repository: event `merge_commit_sha` may be missing or historical and is
not a binding input. The protected top-level `run-name`
provides a second receipt: the run `display_title` must be
`codex-review-gate-verifier/<PR>/<current test-merge SHA>`, and its sole PR
binding must carry the current feature head and default-branch base SHA. This
is the execution binding that lets a successful feature-head CheckRun prove
evaluation of the exact current test-merge. The CheckRun itself does not
belong to the test-merge SHA.

The verifier reads its own `pull_request` Actions run through
`GET /repos/{owner}/{repo}/actions/runs/{run_id}` and requires the
GitHub-server `created_at`. This is a conservative current-run cutoff for
top-level issue-comment clean evidence, not an exact `synchronize` event
time. There is no fallback to a Git commit date or unverified event
timestamp. The canonical verifier therefore needs read-only `actions: read`,
including in private repositories. Installed consumers must receive that
canonical permission before a floating `v2` release requires this read;
missing authority fails closed.

The controller admits `issue_comment` `created`, default-branch
`workflow_dispatch`, and the opt-in `workflow_run` `completed` path for a failed
canonical verifier. Comment admission checks both event sender and comment
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
`operation` is closed to `reconcile|begin-review`, and `request_review` is boolean.
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
and requires the same-repository PR to remain open, ready, on the default base
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
strict canonical comment from `github-actions[bot]` qualifies. Immediately
before writing, runtime reads the complete issue-comment inventory. It posts one
canonical diagnostic only when none exists; it never patches an existing
canonical diagnostic or posts a replacement while one exists. Multiple
canonical diagnostics are preserved untouched and diagnosed with a bounded
warning.

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
it is treated as a clean non-inline parent payload. Independently, each
complete snapshot reads every pull-request review thread via GraphQL and
requires every thread's `isResolved` value to be true. An unresolved thread
blocks regardless of author, outdated status, or reviewed head; parent review
receipts do not change that. The installed ruleset remains an independent
server-side conversation-resolution guard.

Provider carriers must bind exact bot identity. Similar names, copied text or
user-authored claims have no authority. A finding's severity label does not
affect blocking: any qualifying finding blocks.

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

A separate *current-head clean recovery* admits a fresh head-scoped witness
when a trusted clean is already on the current head but predates this verifier
run. This recovery is available only when there is no base epoch. Its cutoff
`T` is the GitHub-server `created_at` of the original `pull_request` verifier
run, fixed across attempts of that run ID; it is not the PR synchronize-event
time. A witness consists of one eligible request `R`: either an exact,
unedited ordinary `@codex review` from a `User`, or a verified, unedited
canonical Actions request whose repository, PR, full head/base tuple, and
workflow-run marker match the selected PR and verifier scope. Both forms are
followed by a trusted, unedited top-level issue-comment terminal clean `C`
whose resolved full SHA uniquely equals the current head. The order is strict:
`T < R < C`; `R` is the latest physical request boundary before `C`, and no
request boundary follows `C`. This is current-head attestation (the clean's
unique full-SHA binding covers the selected head, not request-to-result
causality); posting `R` does not prove Codex started.

Historical ordinary requests before `T` remain in the complete lineage audit.
Only attribution gaps attached to those historical requests may be ignored by
this witness; the history is neither deleted nor relabeled as resolved. An
older request's unresolved official `eyes` without its own later `+1` remains
blocking under existing liveness rules. The recovery does not clear findings
or provider errors and does not waive unknown, edited, deleted, forged,
scope-drifted, live or ambiguous boundaries. It requires complete inventory,
exact refetches and two stable snapshots. A new verifier run ID has a new
cutoff and cannot inherit the witness.

The permission threshold protects generation resets, not negative evidence.
Qualifying provider findings block regardless of the request author's
permission. A finding never serves as the minimal terminal receipt. The exact
closed Codex inline-parent form is a narrow receipt for its non-inline parent
payload only; it does not itself prove that its threads are resolved. Other
pull-request review cleans remain ordinary evidence and cannot be that receipt.

Apart from the current-head clean recovery above, terminal clean text and a
qualifying provider `+1` are equal clean carriers only for the first physical
generation of a no-base-epoch, single-flight lineage. Physical boundary
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
that attribution unique. After a base epoch, the current-head clean recovery
does not apply: existing rules require an exact-current-tuple canonical
Actions request with a direct provider `+1`, and a top-level terminal clean
adds no authority.

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
request/base snapshot produced them. In that degraded lineage mode, only a
qualifying `+1` directly attached to the latest strictly post-epoch,
base-bound canonical workflow request is a positive or superseding carrier.
An unlineaged terminal clean remains diagnostic evidence and cannot pass or
clear a finding. This is a deliberate fail-closed exception to carrier parity.
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
2. a later clean belongs to that newer generation under the lineage rule
   above: a terminal clean only when it is the first no-base-epoch physical
   generation (and, for a default-`any` ordinary candidate, meets the minimal
   terminal-receipt rule), otherwise a qualifying request-bound `+1`. The
   current-head clean recovery does not supersede a finding.

An unrelated later clean cannot clear the finding. Ambiguous temporal order,
generation binding or head binding remains failure or inconclusive. A
superseded finding remains historical evidence for diagnostic accounting; it
is not erased from GitHub.

This asymmetry admits recovery from an obsolete or inapplicable finding without
letting positive evidence mask a finding silently.

## Complete snapshots and stable success

### Review-thread completeness

Each thread collection read enumerates `reviewThreads(first: 100, after: $cursor)` until
GraphQL reports no next page. It retains each thread's identity and resolution
state (`id`, `isResolved`), with location metadata used only for concise
diagnostic links; it does not fetch nested thread comments or derive findings
from them. Any unresolved thread blocks success, including a human-authored,
outdated, or old-head thread. The `isOutdated` flag is diagnostic only and
never discounts an unresolved thread. Resolve open conversations on GitHub,
then use the protected exact-head manual `reconcile`; a new provider review
request is not needed.

This uses the existing read-only verifier token and workflow triggers; it adds
no permission, event, cron schedule, or GitHub App.

Pagination must be complete and non-overlapping (no thread ID is repeated
across pages). Require stable `totalCount`
across pages, each page's item count to agree with its `pageInfo` and available
count, unique thread IDs whose final count equals `totalCount`, and valid
cursor/page shapes. A cursor cycle, duplicate ID across pages, malformed or
partial page, GraphQL error, cap, or count mismatch is incomplete evidence and
fails closed. The deterministic snapshot fingerprint includes every thread's
`id` and `isResolved`; clean requires the same thread set and states in both
stable snapshots. This is not an atomic GitHub snapshot: non-overlap, count/ID
consistency, and the existing two stable reads reduce pagination ambiguity but
do not claim an atomic server-side transaction. The existing protocol brackets
decision-carrier reads with opening and closing reads; two stable snapshots
therefore perform at least four thread passes, each requiring
`ceil(totalThreads / 100)` pages (at least one page for an empty connection).
The thread check adds no extra sweep.

Summary and sticky diagnostics expose `report.reviewThreads` separately from
`report.counts`, with `status`, `unresolved`, `resolved`, `total`, and
`diagnostics`. `status` is `not_read`, `complete`, or `incomplete`. Counts are
numeric only for a complete collection; for `not_read` or `incomplete`, all
three are `unknown`. `not_read` means this run did not collect thread evidence,
not that the PR has zero threads. An incomplete collection remains fail-closed
where a thread decision is required.
They list the three thread counts separately from the four non-inline finding
counts and provide at most five unresolved-thread paths plus the first comment
URL when available. A partial read sets all three thread counts to `unknown`,
never verified zero. The configured `default`/`expanded` resource profile and
existing hard ceilings also bound thread pagination.

Thread diagnostics are additive and preserve the report's existing recovery
priority. In particular, `not_read` must not replace a more actionable finding,
authorization, budget, replacement-PR, or begin-delivery recovery instruction
with a thread-resolution hint. The resolve-threads-and-reconcile instruction
applies when a complete collection reports unresolved threads; thread status
does not mask findings, errors, or the report's primary recovery code.

A “snapshot” is one independent, fully paginated set of GitHub API reads used
to decide the fixed PR/head scope. It includes:

- PR identity, lifecycle, base and head;
- the latest filtered `BaseRefChangedEvent` or `BaseRefForcePushedEvent` from
  the PR timeline;
- review-request IDs, revisions, authors and candidate reactions;
- qualifying Codex top-level comments and review bodies, including IDs,
  timestamps, actor/App identity and body digests;
- every review thread's ID and resolution state, plus pagination completeness;
- reviewed-commit resolution and native review `commit_id`; and
- collection completeness and exact-object refetch results.

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

The latest base event is also an evidence-epoch barrier. A request generation
must be strictly newer than it before clean evidence can pass; equal timestamps
are ambiguous. Because GitHub does not expose provider-authenticated
request-to-terminal-payload lineage, a post-epoch canonical request must receive
its own qualifying provider `+1`; a later terminal clean alone cannot pass.
Workflow markers bind the current base directly. Findings remain conservative.
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
| `default` | 20 | 2,000 | 128 | 32 MiB | 10 s | 60 s |
| `expanded` | 100 | 10,000 | 512 | 64 MiB | 20 s | 300 s |
| hard ceiling | 1,000 | 20,000 | 2,048 | 64 MiB | 30 s | 720 s |

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
| `healthy/pending` | Evaluation completed safely, but current state cannot authorise success yet. Follow `recovery_code`; only `wait_provider` is a pure wait. |
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
pair is not an instruction by itself. Only `wait_provider` is a pure wait.

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

At-least-once recovery may create small duplicate requests, verifier attempts
or diagnostic comments after an unknown write result. The sticky writer does
not fold, patch or delete existing canonical diagnostics: it fresh-reads before
creation, leaves duplicates untouched and reports them. Only each exact,
unedited, official canonical sticky receives the narrow physical-lineage
exemption; a non-qualifying marker-looking duplicate remains a conservative
boundary. Physical review requests likewise remain separate generation
boundaries. No duplicate authorises selection of a convenient clean or omission
of a finding.

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

Stable v2.0 supports GitHub.com public and private repositories, an open
non-draft PR from an ordinary same-repository branch to the default branch,
GitHub-hosted Linux runners and ordinary merge/squash/rebase methods.

It fails closed for GHES, forks, merge queues, non-default bases, drafts,
bot-owned PRs, self-hosted/Windows/macOS runners and new operations on closed or
merged PRs.

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
