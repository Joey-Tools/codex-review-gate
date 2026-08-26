# Codex Review Gate v2 Design

Languages: [British English (en-GB)](DESIGN.md) | [简体中文 (zh-CN)](DESIGN.zh-CN.md)

## Goal

v2 supplies a low-cost, fail-closed required status for one pull request at a
time. It must not report success while qualifying Codex findings are present,
while evidence is incomplete or unstable, or after the selected PR head has
changed. It favours recovery from GitHub's current state over durable private
state and tolerates small at-least-once duplicates when uncertainty follows a
write.

Existing GitHub controls keep their native responsibilities:

- GitHub stores PR lifecycle, comments, reviews and reactions;
- the consumer workflow owns narrow event admission, permissions and
  serialisation;
- the Action reconstructs and reduces non-inline Codex evidence;
- the ruleset requires the status, branch freshness, resolved conversations
  and non-fast-forward protection; and
- the merge agent closes the loop with an exact-current-head reconcile and
  final server-side reread.

The Action is not a second conversation resolver or branch-protection system.

## Architecture and trust boundaries

```text
eligible Codex issue_comment   qualifying base retarget   protected workflow_dispatch
             |                           |                           |
             +---------------------------+---------------------------+
                                v
                copied canonical consumer workflow
                - pre-runner identity filter
                - typed inputs and narrow permissions
                - one-PR concurrency
                                |
                                v
          JoeyTeng/codex-review-gate-action@v2 (API only)
                - bind one PR and expected head
                - write pending on that head
                - rebuild fully paginated evidence
                - reduce finding / clean / pending
                - require two stable snapshots for clean
                                |
                 +--------------+----------------+
                 v                               v
       codex/github-review-gate          summary + best-effort sticky
                 |
                 v
 ruleset: required status + up to date + conversations resolved + no force-push
```

### Consumer workflow

The copied canonical workflow is trusted repository configuration and is the
supported consumer envelope. A bare Action step cannot own events,
runner-admission filters, permissions, typed dispatch or concurrency.

Automatic admission covers `issue_comment` `created`/`edited` and one narrow
`pull_request_target` `edited` case. Comment admission checks both event sender
and comment author against exact login `chatgpt-codex-connector[bot]` and exact
type `Bot` before runner allocation. Base-edit admission requires an actual
`changes.base.ref.from` transition whose current base is the same repository's
default branch. Title/body-only edits do not allocate a runner. The Action
revalidates the admitted event because the two checks protect different
boundaries.

The only manual entry is `workflow_dispatch` using the protected default-
branch workflow. The manual inputs are closed and typed as documented in
[README.md](README.md). A feature-ref dispatch is unsupported. Same-repository
writers with the native repository and Actions permission to dispatch are an
explicit trust boundary; v2 does not maintain a hard-coded actor allowlist.

There is no cron, `repository_dispatch`, broad `pull_request` reset job or
writable automatic `pull_request_review` job. The absence of cron avoids
billable no-op runs in private repositories. Review-object and reaction
changes that do not create or edit a qualifying issue comment converge through
manual reconcile.

All runtime jobs are API-only. They do not check out or execute consumer or PR
code. The permission ceiling is:

```yaml
permissions:
  contents: read
  issues: write
  pull-requests: read
  statuses: write
```

The runtime does not need `actions: read`, checks/content/PR write, OIDC or a
dedicated GitHub App. The separate publisher App is never installed in a
consumer repository.

### Dispatch and Action inputs

`workflow_dispatch` exposes `operation`, `pr_number`, `expected_head_sha`,
optional `request_comment_id`, `request_review` and `limits_profile`. Every
value is untrusted and revalidated against GitHub. The manual path requires a
full expected SHA. The automatic issue-comment path may omit it; runtime then
binds the authoritative PR head at startup. Both paths freeze that head for the
remainder of the run.

The Action uses underscore-named inputs `github_token`, `pr_number`,
`expected_head_sha`, `operation`, `request_comment_id`, `request_review` and
`limits_profile`. `operation` is closed to `reconcile|begin-review`,
`limits_profile` to `default|expanded`, and `request_review` is boolean.
Verdicts, identities, status context, stale overrides, numeric limits and
skip-reconcile controls are not inputs.

`request_comment_id` is only a locator hint. The reducer may use it to avoid
unnecessary backward requests, but must prove that every newer relevant
request, finding, progress artifact, malformed artifact and conflict has been
accounted for before stopping. A hint never supplies evidence authority.

## Operations and head binding

### `begin-review`

`begin-review` validates the selected supported PR and bound head, writes
pending on that exact SHA, and by default posts a fresh exact
`@codex review` request with the canonical workflow marker. The marker binds
the v2 format, full head, current base repository/ref/SHA and workflow run.
`request_review=false` performs the pending transition without posting; it is
best effort and creates no special barrier.

A logical workflow-authored request attempt is bound to repository ID, PR,
expected head and `GITHUB_RUN_ID`. A rerun may adopt its own exact, unedited,
matching marker. If the POST result is unknown, runtime first rereads GitHub;
it does not blindly repeat the request. Continued uncertainty keeps pending and
reports `retry_begin` with `retry_safe=false`, because GitHub issue-comment
creation has no idempotency key and the side effect may have succeeded before
the failure became visible. The caller waits for the exact same-run marker to
settle and, if it remains absent, reruns the original workflow run; an immediate
retry or distinct dispatch could create a duplicate generation.

Same-PR writers use `cancel-in-progress: false`. This serialises active writers
but cannot prevent GitHub from replacing a not-yet-started pending run. A
caller therefore observes the exact `begin-review` run complete before treating
it as a barrier or posting a dependent request.

Agents normally start Codex directly with exact `@codex review` when the check
is not already passing, avoiding an Actions runner while other checks run.
`begin-review` remains the coordinated path, especially for a deliberate
same-head re-review that must first invalidate an earlier success.

### `reconcile`

Manual reconcile requires the caller's full `expected_head_sha`; the automatic
path binds the equivalent value at startup. Runtime rereads the PR and, only
while the head still equals that value, replaces that SHA's gate status with
pending before collecting evidence. Pending makes an interrupted recheck
fail-closed and invalidates an earlier success during a deliberate re-review.

A stale run never follows a different head and never projects its result there.
A head change requires a fresh invocation with the new current head. This is
the protected property of status projection: every decision belongs only to
the head that was explicitly or authoritatively bound at run start.

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

Terminal clean text and a qualifying provider `+1` are normally equal clean
carriers. After any observed base epoch, terminal payloads cannot prove which
request/base snapshot produced them. In that degraded lineage mode, only a
qualifying `+1` directly attached to the latest strictly post-epoch,
base-bound canonical workflow request is a positive or superseding carrier.
An unlineaged terminal clean remains diagnostic evidence and cannot pass or
clear a finding. This is a deliberate fail-closed exception to carrier parity.
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
2. a later head-bound terminal clean or qualifying `+1` belongs to that newer
   generation, subject to the base-epoch direct-reaction rule above.

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
disables those protections and force-pushes anyway, the next exact reconcile
recovers to pending from the timeline, but v2 cannot reset the status in real
time without adding a push listener, webhook App or cron.

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
legitimate large PRs may persistently select the reviewed `expanded` profile.
Per-dispatch numeric overrides are deferred beyond v2.0.

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
| `healthy/failure` | Qualifying findings were proved and failure status was projected. |
| `unhealthy/failure` | Findings were proved but failure-status projection failed. |
| `healthy/pending` | Provider evidence is not terminal yet. |
| `unhealthy/pending` | API, pagination, cap or stability execution is incomplete. |
| `healthy/not_applicable` | A delayed automatic event is stale. |
| `unhealthy/not_applicable` | A manual target is invalid or the scope is unsupported. |
| `unhealthy/unknown` | No trusted state can be read or projected. |

`unhealthy/success` is forbidden. Workflow conclusion represents execution
health. The commit status on the bound head represents gate outcome. This
keeps ordinary findings distinct from evaluator failure.

`status_projection` is summary-only. When no additional evidence query is
needed, the summary and sticky also report `findings_unresolved`,
`findings_resolved`, `findings_historical` and `findings_indeterminate`.
Incomplete pagination, API failure or cap hits make affected values `unknown`,
not zero. These are diagnostics for normalised non-inline findings, not public
Action outputs or inline-thread authority.

Summary and sticky contain a bounded reason, recovery code and concrete next
action. They expose object identities, digests, bounded escaped excerpts and
links when useful, but never tokens, headers, raw payload dumps or untrusted
workflow commands.

At-least-once recovery may create small duplicate requests, statuses or
diagnostic attempts after an unknown write result. Duplicates are folded or
reported conservatively; they never authorise selection of a convenient clean
or omission of a finding.

## Exact-head merge closure

Stable A/B snapshots prove only a short observation window; they do not lock
the PR. Immediately before merge, an agent must:

1. reread the exact current PR head;
2. dispatch `reconcile` for that exact head;
3. require Action output `healthy/success`;
4. reread `codex/github-review-gate` from expected source GitHub Actions on the
   same unchanged head; and
5. require the ruleset to confirm branch up to date, all conversations
   resolved and merge allowed.

Any head or policy change restarts this closure. A previous success is never a
permanent review lease.

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
- a status is scoped to a PR rather than its commit SHA; or
- the release publisher App contributes runtime authority.

## v1 isolation

v1 remains frozen and valid for consumers that have not migrated. v2 does not
read v1 state, publish a compatibility selector, mutate v1 refs or fall back to
the v1 reducer. Migration removes the v1 installation and installs the complete
v2 workflow/ruleset in one PR, then verifies v2 in a separate harmless canary
PR that is closed unmerged.
