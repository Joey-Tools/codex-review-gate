# Install Codex Review Gate v2

This guide is for a repository maintainer. The [agent runbook](agent.md)
describes the same installation as a deterministic execution checklist; it is
not a different installation mode. Both guides use the canonical assets under
`templates/codex-gated-repo/`.

The safe rollout has two pull requests:

1. one migration PR removes the v1 caller and installs the canonical v2
   workflow; and
2. after the migration merges, one separate harmless canary PR proves that the
   live default-branch workflow and ruleset work together.

The canary is closed without merging.

## What is installed

The consumer receives one thin workflow at
`.github/workflows/codex-review-gate.yml` and two final effective rules in
`.github/CODEOWNERS` protecting `/.github/workflows/` and
`/.github/CODEOWNERS`. The workflow calls the compatible floating major:

```yaml
uses: JoeyTeng/codex-review-gate-action@v2
```

Copy the canonical workflow unchanged. It owns the event and permission
boundary that an Action step cannot define:

- automatic wake-ups use only `issue_comment` activity types `created` and
  `edited`;
- before a runner is allocated, both the event sender and comment author must
  be the exact Codex bot, `chatgpt-codex-connector[bot]`, with GitHub type
  `Bot`;
- the only manual trigger is `workflow_dispatch`, and one run targets one pull
  request;
- manual dispatches must use the workflow from the repository's default
  branch;
- API-only work uses `ubuntu-slim` by default; the repository Actions variable
  `CODEX_REVIEW_GATE_USE_UBUNTU_LATEST=true` selects the sole supported
  fallback, `ubuntu-latest`;
- permissions are limited to `contents: read`, `issues: write`,
  `pull-requests: read`, and `statuses: write`.

By default, an ordinary human-authored `@codex review` request establishes a
new review generation only when its author currently has `write`, `maintain`,
or `admin` permission. A repository that intentionally accepts requests from
any commenter may set the protected Actions variable
`CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION=any`; every other value maps to
the safer `write` policy. This is wrapper-owned protected configuration, not a
public Action input. It never weakens Codex finding authority: every qualifying
finding remains blocking regardless of request-author permission.

The consumer workflow has no cron, `repository_dispatch`, broad automatic
`pull_request` reset, automatic `pull_request_review` job, runtime GitHub App,
or ledger. Its sole PR edit entry is the pre-runner-filtered default-branch
base-retarget reset. Evidence is rebuilt from the selected pull request when
the gate runs.

Choose one GitHub user as `CONTROL_PLANE_OWNER`. That account must have
`write`, `maintain`, or `admin` permission on the consumer repository. The
helper defaults to `@JoeyTeng`; pass a different user for every non-Joey
repository. The owner is deliberately explicit because GitHub's required-check
`integration_id: 15368` identifies the entire GitHub Actions App, not this one
workflow. CODEOWNERS plus Code Owner review prevents an ordinary workflow
change from becoming an alternative status writer.

The manual `workflow_dispatch` interface is:

| Input | Meaning |
| --- | --- |
| `operation` | `begin-review` or `reconcile` |
| `pr_number` | One open pull request number |
| `expected_head_sha` | The exact pull request head the run may evaluate |
| `request_comment_id` | Optional evidence-location hint |
| `request_review` | Whether `begin-review` posts the request; defaults to `true` |
| `limits_profile` | `default` or `expanded` |

These values help the Action locate and validate work; they never supply a
verdict. The Action step uses the exact underscore input names `github_token`,
`pr_number`, `expected_head_sha`, `operation`, `request_comment_id`,
`request_review`, and `limits_profile`. Its only public outputs are
`execution_health`, `gate_outcome`, `recovery_code`, and `retry_safe`. Finding
counts, when available, are diagnostics in the job summary and sticky comment,
not Action outputs.

## 1. Create and merge the migration PR

Use a clean checkout of `Joey-Tools/codex-review-gate` as `SOURCE_ROOT` and a
clean worktree of the consumer repository as `TARGET_ROOT`:

```bash
CONTROL_PLANE_OWNER=@JoeyTeng
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --prepare-worktree "$TARGET_ROOT" \
  --control-plane-owner "$CONTROL_PLANE_OWNER"
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --prepare-worktree "$TARGET_ROOT" \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --apply
```

The helper revalidates the target workflow parents at explicit checkpoints.
This is not an operation-bound filesystem sandbox: a hostile same-UID process
can still race path-based operations between checkpoints. Use a worktree whose
parent directories are not being concurrently modified by an untrusted
process, and do not bypass a reported safety failure with a manual copy.

The first command previews the change. The second copies the canonical
workflow byte for byte and merges a final managed block into
`.github/CODEOWNERS` without removing unrelated entries. If another workflow
still calls v1, inspect the paths reported by the helper and remove or
deactivate those callers in this same migration PR. One PR may remove v1,
install v2, and install the CODEOWNERS control plane.

If the repository currently uses `CODEOWNERS` at the repository root or under
`docs/`, the helper stops rather than creating `.github/CODEOWNERS` and
silently shadowing that policy. Move or merge all existing entries into
`.github/CODEOWNERS` in the same migration PR, then rerun the helper.

Review the consumer diff, run that repository's normal validation, and obtain
an independent approval from `CONTROL_PLANE_OWNER` before merging the
migration PR. This first approval is a manual trust-bootstrap gate: pull
requests use CODEOWNERS from the base branch, where the new rules are not yet
present, and the new ruleset is not active yet. Immediately before merge,
verify that the owner is not the PR author, that the owner's latest review is
`APPROVED` for the current full head SHA, and that the head has not changed
after that read. Future PRs that change the workflow or CODEOWNERS are enforced
by GitHub and require the same owner to approve the final head; stale approvals
are dismissed after a push. Do not manually reconstruct the workflow from
this guide, and do not activate the required check while the v2 workflow exists
only on a feature branch.

## 2. Stage the ruleset as Disabled

After the migration is present on the default branch, preview and apply remote
staging:

```bash
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER"
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --apply
```

Alternatively, import
`templates/codex-gated-repo/rulesets/codex-review-gate.json` through
**Settings -> Rules -> Rulesets -> New ruleset -> Import a ruleset**.

Before continuing, verify that the staged ruleset:

- targets the default branch and remains **Disabled**;
- requires `codex/github-review-gate` from expected source **GitHub Actions**
  (`integration_id: 15368`), not “Any source”;
- requires the branch to be up to date;
- requires Code Owner review and dismisses stale approvals; a new ruleset uses
  zero ordinary approvals, while the helper preserves any existing higher
  approval count;
- requires all review conversations to be resolved; and
- blocks non-fast-forward updates to the default branch; and
- has no bypass actors.

If an old ruleset still requires the v1 context, remove that requirement as
part of the migration. Keep the protection gap between staging and activation
limited to the canary work below.

## 3. Create and exercise the separate canary PR

Create a temporary branch from the merged default branch, make one harmless
reviewable change, and open a non-draft PR. Record its pull request number and
full current head SHA.

Normally, request the review directly on the PR:

```text
@codex review
```

This is the preferred path because it does not spend Actions minutes merely to
create the request. A later qualifying `created` or `edited` Codex bot comment
will wake the canonical workflow. If the provider result arrives only as a
review or reaction, or another recovery is needed, run a manual reconcile.

Commit statuses persist on a commit SHA; they do not expire when a review epoch
ends. A commit status has no PR identity, so parallel or duplicate PRs sharing
one head SHA would reuse and overwrite the same context and are unsupported.
There is deliberately no broad automatic `pull_request` reset job, because idle
PRs must not consume Actions minutes. The canonical workflow has only a narrow
`pull_request_target` `edited` path: an actual retarget back to the default
branch is filtered before runner allocation and changes the unchanged head's
old success to pending. Title/body-only edits do not start a runner. Before a
deliberate same-head re-review, run `begin-review` for that exact head so the
old success becomes pending before the fresh request is authoritative. A direct
comment alone cannot reset a persisting success.

After a base retarget or a detected base force-push epoch, always use
`begin-review` with `request_review=true`, then reconcile after Codex places a
qualifying `+1` directly on that canonical request. GitHub terminal clean
payloads do not identify the request/base snapshot that produced them, so in
this recovery mode a later terminal clean by itself deliberately remains
pending. Findings still block immediately.

Use `begin-review` instead when the old status must be changed to pending and
request creation must be coordinated in one workflow run. For example:

```bash
gh workflow run codex-review-gate.yml \
  --repo OWNER/REPO \
  -f operation=begin-review \
  -f pr_number=PR_NUMBER \
  -f expected_head_sha=FULL_HEAD_SHA \
  -f request_review=true \
  -f limits_profile=default
```

Do not add `--ref`. Omitting it selects the default-branch workflow. After
dispatch, locate the new run and read it back:

```bash
gh run list \
  --repo OWNER/REPO \
  --workflow codex-review-gate.yml \
  --event workflow_dispatch \
  --limit 10 \
  --json databaseId,event,headBranch,headSha,status,conclusion,url
```

Require the selected run's `event` to be `workflow_dispatch` and `headBranch`
to equal the repository's current default branch. A feature-branch run is
unsupported; do not use its result.

Before accepting the canary, reconcile its exact current head even if an
automatic bot-comment run already completed:

```bash
gh workflow run codex-review-gate.yml \
  --repo OWNER/REPO \
  -f operation=reconcile \
  -f pr_number=PR_NUMBER \
  -f expected_head_sha=FULL_HEAD_SHA \
  -f request_review=false \
  -f limits_profile=default
```

If the direct request comment ID was recorded, it may be supplied as the
optional `request_comment_id` input. It is only a hint; the Action still checks
the pull request and all relevant newer evidence.

The completed run reports execution health separately from the gate outcome.
Follow its `recovery_code` and summary next action. A finding is normally a
healthy gate failure, while an unhealthy execution requires recovery or a
retry; do not treat the two cases as equivalent.

For an unusually large PR, select the reviewed `expanded` profile on the next
manual run:

```bash
gh workflow run codex-review-gate.yml \
  --repo OWNER/REPO \
  -f operation=reconcile \
  -f pr_number=PR_NUMBER \
  -f expected_head_sha=FULL_HEAD_SHA \
  -f request_review=false \
  -f limits_profile=expanded
```

If a repository regularly needs that profile, set the persistent Actions
variable instead:

```bash
gh variable set CODEX_REVIEW_GATE_LIMITS_PROFILE \
  --repo OWNER/REPO \
  --body expanded
```

Only the named profiles are supported. Do not add numeric limit inputs.

Finally, re-read the PR and the exact-head status. Require all of the following:

- the PR head is still `FULL_HEAD_SHA`;
- the newest `codex/github-review-gate` status on that SHA is `success`;
- the status source is GitHub Actions (`github-actions[bot]`); and
- the run summary reports `execution_health=healthy` and
  `gate_outcome=success`.

If the head changes, record the new SHA, obtain review evidence for that head,
and reconcile again. Never accept success from an older commit.

## 4. Activate and close the canary

Only after the exact-head canary passes, preview and activate the ruleset:

```bash
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --activate \
  --canary-pr PR_NUMBER \
  --canary-head FULL_HEAD_SHA
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --apply \
  --activate \
  --canary-pr PR_NUMBER \
  --canary-head FULL_HEAD_SHA
```

Immediately before every ruleset write, including Disabled staging, the helper
re-reads the exact default-branch workflow inventory, CODEOWNERS errors, and
the named owner's repository permission. Before an active write it also
re-reads the canary lifecycle, base/head and exact-head status. After a write
it reads the exact ruleset and the complete consumer security snapshot back.
Confirm active enforcement, the same expected GitHub Actions source, strict
up-to-date, Code Owner review with stale approval dismissal, the new-ruleset
default of zero ordinary approvals without lowering an existing higher count,
conversation resolution, non-fast-forward default-branch protection, and an
explicitly empty `bypass_actors` array. Then close the canary without merging
it and delete only its temporary branch.

Installation is complete when the default branch contains the canonical `@v2`
workflow, the active ruleset has the expected source and protections, and the
closed-unmerged canary records an exact-head successful GitHub Actions status.
