# Codex Review Gate v2 Cookbook

Languages: [British English (en-GB)](COOKBOOK.md) | [简体中文 (zh-CN)](COOKBOOK.zh-CN.md)

This cookbook starts after the complete canonical verifier and controller
[workflow bundle](https://github.com/Joey-Tools/codex-review-gate/tree/master/templates/codex-gated-repo/.github/workflows),
the managed `.github/CODEOWNERS` control plane, and the disabled
[ruleset template](https://github.com/Joey-Tools/codex-review-gate/blob/master/templates/codex-gated-repo/rulesets/codex-review-gate.json)
have been installed. For installation and canary activation, use the
[human-readable guide](https://github.com/Joey-Tools/codex-review-gate/blob/master/docs/install/human.md)
or let an agent follow the
[agent-executable guide](https://github.com/Joey-Tools/codex-review-gate/blob/master/docs/install/agent.md).

## Command variables

The examples use:

```bash
REPO="OWNER/REPO"
PR_NUMBER="123"
WORKFLOW="codex-review-gate-controller.yml"
```

Read the exact current head immediately before each dispatch:

```bash
HEAD_SHA="$(gh pr view "$PR_NUMBER" --repo "$REPO" --json headRefOid --jq .headRefOid)"
```

Do not reuse that value after a push, update-branch operation, base change,
close/reopen transition or any uncertainty about PR state.

Each dispatch handles one PR. To recover several PRs, invoke separate runs with
each PR's independently read head.

## Choose the path

### Ordinary low-cost review

When the exact head is not already carrying a success that must be invalidated,
the normal agent path is:

1. read the open PR and exact current head;
2. post a comment whose complete visible content is exact `@codex review`;
3. let Codex publish its evidence without occupying an Actions runner;
4. dispatch `reconcile` for that exact head; and
5. follow the summary until the final exact-head merge closure passes.

Prefer a task-scoped body file with `gh pr comment --body-file` so shell quoting
cannot add visible text. Do not construct the workflow-owned hidden marker by
hand; the `begin-review` operation owns that form.

An ordinary request author's default minimum permission is `write`, `maintain`
or `admin`, unless protected default-branch configuration deliberately selects
`any`.

### Workflow-coordinated review

Use `begin-review` when the controller must own the
request, including a deliberate same-head re-review after an earlier success:

```bash
gh workflow run "$WORKFLOW" \
  --repo "$REPO" \
  -f operation=begin-review \
  -f pr_number="$PR_NUMBER" \
  -f expected_head_sha="$HEAD_SHA" \
  -f request_review=true
```

Observe that exact controller run establish and read back the strictly newer
verifier attempt before relying on it. The same-PR controller concurrency group
uses `cancel-in-progress: false`, but concurrency is not a mutation fence.

The advanced form:

```bash
gh workflow run "$WORKFLOW" \
  --repo "$REPO" \
  -f operation=begin-review \
  -f pr_number="$PR_NUMBER" \
  -f expected_head_sha="$HEAD_SHA" \
  -f request_review=false
```

does not post. It is best effort and adds no dedicated barrier. Post the new
exact `@codex review` only after the exact controller run completes.

### Reconcile one exact head

After Codex evidence arrives, or whenever a recovery instruction says to
reconcile:

```bash
gh workflow run "$WORKFLOW" \
  --repo "$REPO" \
  -f operation=reconcile \
  -f pr_number="$PR_NUMBER" \
  -f expected_head_sha="$HEAD_SHA"
```

`request_comment_id` may be supplied as a locator hint when the summary or
provider event identifies the relevant request. It never supplies a verdict or
permits a partial negative-evidence scan:

```bash
gh workflow run "$WORKFLOW" \
  --repo "$REPO" \
  -f operation=reconcile \
  -f pr_number="$PR_NUMBER" \
  -f expected_head_sha="$HEAD_SHA" \
  -f request_comment_id="$REQUEST_COMMENT_ID"
```

Never pass `--ref`, use `repository_dispatch`, or supply ad-hoc numeric limit
inputs. Omitting the ref selects the protected default-branch workflow. Read
the created run back and reject it unless its `headBranch` is the current
default branch.

## Ordinary agent loop

1. Prove the target is an open, non-draft, same-repository PR to the default
   branch and read its exact head.
2. If a new review generation is needed, choose direct exact
   `@codex review` or `begin-review` as described above.
3. Wait for Codex. Do not create a cron or repeated blind request loop.
4. Dispatch `reconcile` for the exact head.
5. Read the four Action outputs and the Actions summary:
   `execution_health`, `gate_outcome`, `recovery_code`, `retry_safe`.
6. Always follow the one concrete `recovery_code` action in the summary. Only
   `wait_provider` is a pure wait. Do not infer clean from zero counts, a
   pending result or a sticky comment.
7. When the result reaches `healthy/success`, perform the exact-head merge
   closure below immediately before merge.

If the head changes at any step, stop. Read the new current head and begin a
fresh generation/reconcile as appropriate. A stale run never follows or writes
its decision to the new head.

## Interpret results

| Result | Meaning | Operator action |
| --- | --- | --- |
| `healthy/success` | Stable complete current-head clean evidence was proved. | Perform the final verifier/head/ruleset reread; merge only if all still match. |
| `healthy/failure` | Qualifying findings were proved. | Follow finding links, fix or obtain an authorised newer clean generation, then reconcile. |
| `unhealthy/failure` | Findings were proved but execution or final result handling also failed. | Keep the findings blocking, repair the named execution boundary and reconcile. |
| `healthy/pending` | Evaluation completed safely, but current state cannot authorise success yet. | Follow `recovery_code`; wait without another action only for `wait_provider`. |
| `unhealthy/pending` | API, pagination, cap or stability execution is incomplete. | Follow the recovery code; do not treat it as no findings. |
| `healthy/not_applicable` | A delayed automatic event no longer applies. | Usually no action; reconcile the current head if a gate decision is still needed. |
| `unhealthy/not_applicable` | The manual target is invalid or unsupported. | Correct the target or use a supported scope; do not bypass the ruleset. |
| `unhealthy/unknown` | No trusted state could be read. | Repair access/execution, reread the PR, then use the summary's recovery action. |

Every pending result remains blocking; `healthy/pending` is not a weak
success.

`unhealthy/success` is never legal. `healthy/pending` is not a weak success. A
workflow failure describes evaluator health, not a Codex finding. A normal run
with `gate_outcome=failure` means the evaluator worked and the merge must
remain blocked.

Require the unique canonical verifier run/job/CheckRun recorded against the
exact current PR feature-head SHA. The verifier still executes on
`refs/pull/N/merge`; strict
`GITHUB_REF`/`GITHUB_SHA`, event-scope and fresh-PR checks bind its success to
the unchanged current head, base and test-merge. A controller CheckRun binds the default-branch commit and is not the
required signal. The controller must observe a strictly newer verifier attempt
and its unique job/CheckRun; ambiguous rerun state stays blocking. Commit-status
projection and the status-POST recovery path have been removed.

`retry_safe=true` means an immediate rerun with identical inputs is a valid
recovery action. It does not mean success is likely or that the runtime may
skip evidence. When false, first perform the head refresh, permission repair,
provider wait or finding change named by `recovery_code`.

## Recovery codes

| Code | Safe next action |
| --- | --- |
| `none` | No evaluator recovery is required; perform exact-head merge closure. |
| `wait_provider` | Wait for Codex to publish terminal evidence; do not spam requests. |
| `reconcile` | Reread the exact current head and run one scoped reconcile. |
| `fix_findings` | Fix the reported current findings, separately resolve inline conversations, obtain later head-bound clean evidence, then reconcile. |
| `request_clean_generation` | Request a strictly newer authorised generation for the same head and wait for clean bound to it; an arbitrary later clean is insufficient. |
| `retry_reconcile` | Retry the same exact-head reconcile when `retry_safe` permits it. |
| `wait_then_reconcile` | Let GitHub/Codex settle, reread the head, then reconcile. |
| `use_expanded_limits` | Set protected repository variable `CODEX_REVIEW_GATE_LIMITS_PROFILE=expanded`, then reconcile the same exact head. |
| `raise_protected_limit` | The reviewed profiles are insufficient; change the protected product/configuration limit through ordinary review rather than supplying an ad-hoc number. |
| `refresh_head` | Read the authoritative current head and start a fresh operation; never make the stale run follow it. |
| `repair_permissions` | Restore both canonical workflow permission boundaries or the named access boundary, then reconcile. |
| `retry_begin` | Not immediately retry-safe: wait for the exact same-run marker to settle, then rerun the original workflow run only if it remains absent; do not dispatch a new generation or blindly post duplicates. |
| `unsupported_target` | Move to a documented supported scope or leave the gate blocked. |
| `create_verifier_run` | If ready, convert the PR to draft and mark it ready again; if already draft, mark it ready. Verify a new `ready_for_review` verifier for the exact current head/base/test-merge scope, then reconcile. |

The summary is authoritative for the concrete reason and object links within
the code category. The table does not authorise guessing around missing data.

## Finding accounting and supersession

When derivable without another evidence query, the summary and best-effort
sticky report:

- `findings_unresolved` — admitted current unresolved non-inline findings;
- `findings_resolved` — admitted resolved findings in the reducer model;
- `findings_historical` — superseded or otherwise historical findings retained
  for audit;
- `findings_indeterminate` — findings whose current classification cannot be
  safely resolved.

An incomplete API read, page set or capped scan makes affected values
`unknown`, never zero. Counts are diagnostic only. Inline conversations are
not counted; the ruleset's “all conversations resolved” requirement owns them.

Any qualifying current-head non-inline finding blocks immediately. It is not a
permanent lease: on the same head it may be superseded, but only by a strictly
newer authorised `@codex review` generation followed by clean bound to that
generation and head. An unrelated later clean, an edited request or ambiguous
ordering cannot erase it.

If the finding is real, fix it and use `fix_findings`. If the code does not need
to change but the finding is obsolete or inapplicable, use
`request_clean_generation`. In both cases, reconcile after the later provider
result; resolving an inline conversation alone does not change reducer state.

Terminal clean text and a qualifying provider `+1` otherwise carry equal clean
authority. The exception is a PR with an observed base epoch: only a qualifying
`+1` directly on the latest post-epoch, base-bound canonical request can pass
or supersede a finding; unlineaged terminal clean remains pending.

Ordinary request reactions are liveness signals only; ordinary `+1` cannot
head-bind clean. Same-time/later official `eyes`/progress from Codex prevents
candidate clean from completing. Reaction-only changes do not start an
automatic run; use a later provider event or manual reconcile to observe them.

## Stable-snapshot recovery

Only a clean candidate pays for two independent, fully paginated GitHub reads
five seconds apart. A same-head request, edit, reaction or other
decision-relevant change restarts the pair. A changed head or lifecycle makes
the run stale. API, pagination and cap failures make the read incomplete.

If the stability budget ends before two matching clean snapshots, expect
`unhealthy/pending` with `wait_then_reconcile`:

1. stop changing PR/provider evidence;
2. let GitHub and Codex settle;
3. reread the exact current head; and
4. dispatch one scoped reconcile.

Do not delete provider evidence, weaken the required status or treat an
unstable read as clean.

## Large PRs and profiles

Start with the protected repository default profile. If the summary reports
`use_expanded_limits`, set the reviewed profile as a repository variable
without modifying either canonical workflow:

```bash
gh variable set CODEX_REVIEW_GATE_LIMITS_PROFILE \
  --repo "$REPO" \
  --body expanded
```

Then reread the exact head and run one scoped controller `reconcile`. The
manual dispatch deliberately has no `limits_profile` input.

Do not edit the canonical wrapper, and do not add temporary `max_pages`,
`max_objects` or other numeric dispatch inputs. If even `expanded` is
insufficient, follow `raise_protected_limit` and change the protected limit
through the product's ordinary review/release path.

## Short-SHA evidence

Provider terminal evidence may name a short reviewed SHA. Runtime asks GitHub
to resolve it within the relevant PR scope:

- one unambiguous match equal to current head can bind the evidence;
- no match remains unbound;
- multiple matches are indeterminate and cannot pass; and
- a pull-request review must also have native `commit_id` equal to the resolved
  current head.

Do not edit provider evidence merely to expand a prefix. If it is ambiguous or
bound to another commit, request a new current-head generation.

## Sticky diagnostic recovery

The sticky is a best-effort report, not a receipt. If it is missing, edited,
duplicated or stale:

1. leave provider evidence intact;
2. reread the current head;
3. run one exact-head reconcile; and
4. trust the new verifier CheckRun and summary reconstructed from GitHub.

Sticky write failure does not clear findings. Runtime may update the oldest
canonical diagnostic and warn about later duplicates, but it never needs to
delete duplicates to decide the gate.

## Exact-head merge closure

Immediately before merge:

1. reread the PR's current head;
2. dispatch controller `reconcile` with that exact SHA;
3. observe the strictly newer verifier attempt and its unique canonical
   `codex/github-review-gate` CheckRun on the current feature-head SHA, with
   that verifier run bound to the current test-merge;
4. require `execution_health=healthy`, `gate_outcome=success` and a successful
   verifier conclusion;
5. reread unchanged PR head, base and test-merge SHA;
6. require branch up to date and all conversations resolved; and
7. require the ruleset to allow the intended merge.

If the head or any gate changes, do not merge; repeat the closure for the new
state. Otherwise merge immediately with an exact-head compare-and-swap such as
`gh pr merge --match-head-commit "$HEAD_SHA"`. Stable snapshots do not lock the
PR after the run; direct human UI merge outside this closure is unsupported.

## Migrating from v1

Use one migration PR to remove the v1 caller and install both canonical v2
workflows plus managed CODEOWNERS. Keep every inventoried legacy requirement
active through the migration merge. Bind the canonical read-only legacy inventory SHA-256 in
the owner approval snapshot, then require a fresh strict inventory with that
same external digest. It includes complete ruleset `bypass_actors` and the
complete matching effective `required_status_checks` rule with every parameter,
not merely one matching check. Then require the owner as current actor, the owner's latest exact-head
approval and the synchronous exact-SHA merge. Immediately reread the current
default and require merged lifecycle, base, and head to remain the exact
approved scope. A failed readback keeps all legacy requirements active; only
success permits separately authorised legacy removal and readback.
Do not treat approval plus a head reread
as sufficient, and do not replace v1 with only a bare `uses: ...@v2` step.

After the installation PR merges:

1. confirm the inventoried legacy requirements were removed and read back;
2. stage the supplied ruleset as Disabled with no bypass actors;
3. open a separate harmless canary PR;
4. exercise the ordinary `@v2` review/reconcile path;
5. verify the exact canonical verifier run, native feature-head CheckRun bound
   to the unchanged head/base/test-merge scope,
   freshness and conversation enforcement with no same-name collision;
6. activate the validated ruleset; and
7. close the canary PR without merging.

If the canary fails, repair through ordinary forward Git history. Do not move
the `v2` release alias backwards and do not weaken the ruleset to manufacture a
pass.
