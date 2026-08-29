# Codex Review Gate v2 Design

Languages: [British English (en-GB)](DESIGN.md) | [简体中文 (zh-CN)](DESIGN.zh-CN.md)

## Goal

v2 supplies a low-cost, fail-closed native required CheckRun for one pull request at a
time. It must not report success while qualifying Codex findings are present,
while evidence is incomplete or unstable, or after the selected PR head has
changed. It favours recovery from GitHub's current state over durable private
state and tolerates small at-least-once duplicates when uncertainty follows a
write.

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

The Action is not a second conversation resolver or branch-protection system.

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
          - require two stable snapshots for clean
                                |
                                v
 native CheckRun codex/github-review-gate on exact feature head
                                |
                                v
 ruleset: expected source + Code Owner review + stale dismissal
          + up to date + conversations resolved + no force-push

Codex issue_comment created/edited       protected workflow_dispatch
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
event does not.

GitHub records the verifier run/job/native CheckRun against the exact PR
feature-head SHA even though the canonical `pull_request` workflow executes on
`refs/pull/N/merge`. Inside the Action, `GITHUB_REF` and `GITHUB_SHA` must match
that merge ref and the event test-merge SHA; the event head/base/test-merge
values must also match a fresh PR read. The protected top-level `run-name`
provides a second receipt: the run `display_title` must be
`codex-review-gate-verifier/<PR>/<current test-merge SHA>`, and its sole PR
binding must carry the current feature head and default-branch base SHA. This
is the execution binding that lets a successful feature-head CheckRun prove
evaluation of the exact current test-merge. The CheckRun itself does not
belong to the test-merge SHA.

The controller admits `issue_comment` `created`/`edited` and default-branch
`workflow_dispatch`. Comment admission checks both event sender and comment
author against exact login `chatgpt-codex-connector[bot]` and exact type `Bot`
before runner allocation. The Action revalidates the admitted event because
the two checks protect different boundaries.

The only manual entry is `workflow_dispatch` using the protected default-
branch workflow. The manual inputs are closed and typed as documented in
[README.md](README.md). A feature-ref dispatch is unsupported. Same-repository
writers with the native repository and Actions permission to dispatch are an
explicit trust boundary; v2 does not maintain a hard-coded actor allowlist.

There is no cron, `repository_dispatch`, `pull_request_target` or writable
automatic `pull_request_review` job. The absence of cron avoids
billable no-op runs in private repositories. Review-object and reaction
changes that do not create or edit a qualifying issue comment converge through
manual reconcile.

All runtime jobs are API-only. They do not check out or execute consumer or PR
code. The verifier is read-only. The controller alone receives the narrow
mutation surface needed to create requests and rerun the exact verifier:

```yaml
permissions:
  actions: write
  checks: read
  contents: read
  issues: write
  pull-requests: read
```

Neither workflow receives statuses/checks/content/PR write or OIDC authority.
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
barrier. After exact request readback, the controller establishes a newer full
verifier attempt.

A logical workflow-authored request attempt is bound to repository ID, PR,
expected head and `GITHUB_RUN_ID`. A rerun may adopt its own exact, unedited,
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

Agents normally start Codex directly with exact `@codex review` when the check
is not already passing, avoiding an Actions runner while other checks run.
`begin-review` remains the coordinated path, especially for a deliberate
same-head re-review that must establish a newer verifier generation.

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
`github-actions[bot]` marker comment qualifies. Runtime updates the oldest
canonical duplicate when possible, warns without deleting extras and may
recreate a deleted diagnostic. Missing, edited, duplicate or unwritable sticky
state cannot change a gate decision.

### Admitted evidence

The reducer consumes qualifying Codex top-level issue comments and pull-request
review bodies. It does not treat inline review threads or conversation
resolution as reducer authority; the installed ruleset owns that condition.

Provider carriers must bind exact bot identity. Similar names, copied text or
user-authored claims have no authority. A finding's severity label does not
affect blocking: any qualifying finding blocks.

### Review generations

An authorised generation begins only with an exact, unedited
`@codex review` request. Its first visible line is exact and there is no other
visible text. By default, an ordinary request author must have `write`,
`maintain` or `admin` repository permission. Protected default-branch
configuration may deliberately set the threshold to `any`. A workflow-authored
request additionally needs the exact v2 marker binding the full head and run.

The permission threshold protects generation resets, not negative evidence.
Qualifying provider findings block regardless of the request author's
permission.

Terminal clean text and a qualifying provider `+1` are equal clean carriers
only for the first physical generation of a no-base-epoch, single-flight
lineage. Every physical request comment is a generation boundary, including
same-run duplicate hidden markers. Without a base epoch, provider terminal
evidence strictly between the first request and its successor may close only
that first gap. Every later predecessor-to-successor gap, and positive or
superseding authority for any generation with a physical predecessor, requires
a qualifying `+1` directly on that request. Provider terminal payloads have no
originating request ID, so a later carrier could be delayed or duplicated from
any older generation; stable snapshots cannot make that attribution unique.
After a base epoch, provider terminal evidence cannot close even the first gap.

Official `eyes` or provider progress at or after a request-bound `+1` and no
later than the successor keeps the predecessor open. Equality with the
successor is ambiguous at GitHub's timestamp precision and therefore cannot
prove that review activity ended before the new generation. A clean bound to
the latest request cannot bypass an earlier unclosed gap, and evidence arriving
after the successor cannot retroactively repair that gap.

Progress with one unambiguous commit binding is scoped directly to that head.
Unbound edited progress is a carrier interval from its immutable creation time
through its current revision time. It may be excluded as historical only when
both endpoints are canonically ordered and every physical request boundary
from the strictly earlier origin through the revision uniquely binds the same
different full head. No origin, an ordinary or conflicting boundary, a head
transition inside the interval, or a boundary equal to either endpoint remains
fail-closed in the current-head inventory. This filters provably old-head
progress without guessing edited or same-time activity away.

After any observed base epoch, terminal payloads cannot prove which
request/base snapshot produced them. In that degraded lineage mode, only a
qualifying `+1` directly attached to the latest strictly post-epoch,
base-bound canonical workflow request is a positive or superseding carrier.
An unlineaged terminal clean remains diagnostic evidence and cannot pass or
clear a finding. This is a deliberate fail-closed exception to carrier parity.
Ordinary request reactions are provider-liveness signals only; ordinary `+1`
cannot head-bind clean. Same-time/later official `eyes`/progress from Codex
vetoes candidate clean evidence. Because reaction changes do not trigger the
consumer workflow, a later provider event or manual reconcile must observe the
settled state.
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
   above: an unbound terminal only when it is the first no-base-epoch physical
   generation, otherwise a qualifying request-bound `+1`.

An unrelated later clean cannot clear the finding. Ambiguous temporal order,
generation binding or head binding remains failure or inconclusive. A
superseded finding remains historical evidence for diagnostic accounting; it
is not erased from GitHub.

This asymmetry admits recovery from an obsolete or inapplicable finding without
letting positive evidence mask a finding silently.

## Complete snapshots and stable success

A “snapshot” is one independent, fully paginated set of GitHub API reads used
to decide the fixed PR/head scope. It includes:

- PR identity, lifecycle, base and head;
- the latest filtered `BaseRefChangedEvent` or `BaseRefForcePushedEvent` from
  the PR timeline;
- review-request IDs, revisions, authors and candidate reactions;
- qualifying Codex top-level comments and review bodies, including IDs,
  timestamps, actor/App identity and body digests;
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
strict environment/event/fresh-read validation binds success to the unchanged
head, base and test-merge. The controller's CheckRun is bound to the default-branch commit and
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
or diagnostic comments after an unknown write result. Duplicate diagnostics
may be folded, but physical review requests remain separate conservative
generation boundaries. They never authorise selection of a convenient clean
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
