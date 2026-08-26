# Agent Installation Runbook: Codex Review Gate v2

Use this runbook when a coding agent installs v2 for a repository maintainer.
It is the executable form of the [human guide](human.md), not an alternative
installation design. Copy the canonical assets; never reconstruct the consumer
workflow from examples in this document.

## Inputs and stop conditions

Resolve these values first:

```text
SOURCE_ROOT = clean checkout of Joey-Tools/codex-review-gate
TARGET_ROOT = authorised consumer-repository worktree
REPO = OWNER/REPO for TARGET_ROOT
DEFAULT_BRANCH = consumer repository default branch
INSTALL_BRANCH = branch for the migration PR
MIGRATION_PR = migration PR number after it is opened
CONTROL_PLANE_OWNER = one @USER with write, maintain, or admin on REPO
```

Stop before writing when the target is not authorised, unrelated work makes
`TARGET_ROOT` dirty, the default branch cannot be proved, or the repository is
outside the supported GitHub.com/default-branch PR scope.

Maintain these invariants:

- one migration PR may remove v1 and install v2;
- the canary is a separate PR created after the migration merges;
- close the canary without merging it;
- every manual run targets one PR and one exact expected head;
- `workflow_dispatch` is the sole manual entry point;
- invoke `gh workflow run` without `--ref`, then read the created run back and
  prove that it used `DEFAULT_BRANCH`;
- prefer direct `@codex review`; use `begin-review` only when pending and
  request creation need workflow coordination;
- use only `default` and `expanded` limit profiles, never numeric overrides.
- treat `CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION` as protected wrapper
  configuration: unset or any value other than exact `any` means `write`;
  never add it as an Action input.
- keep `CONTROL_PLANE_OWNER` explicit in every bootstrap invocation. It
  defaults to `@JoeyTeng`, but a non-Joey repository must substitute its own
  eligible GitHub user.

## Phase 1: prepare and merge one migration PR

1. Resolve and record the default branch:

   ```bash
   DEFAULT_BRANCH="$(gh repo view "$REPO" \
     --json defaultBranchRef \
     --jq '.defaultBranchRef.name')"
   test -n "$DEFAULT_BRANCH"
   ```

2. Create `INSTALL_BRANCH` from the latest `DEFAULT_BRANCH` in `TARGET_ROOT`.
3. Preview and apply the canonical consumer workflow:

   ```bash
   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --prepare-worktree "$TARGET_ROOT" \
     --control-plane-owner "$CONTROL_PLANE_OWNER"
   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --prepare-worktree "$TARGET_ROOT" \
     --control-plane-owner "$CONTROL_PLANE_OWNER" \
     --apply
   ```

   The helper revalidates the target workflow parents at explicit checkpoints.
   This is not an operation-bound filesystem sandbox: a hostile same-UID
   process can still race path-based operations between checkpoints. Stop on a
   safety failure; never replace the helper with a manual copy. Proceed only
   when untrusted processes cannot concurrently modify those parent
   directories.

   If the helper reports a root `CODEOWNERS` or `docs/CODEOWNERS`, stop and
   move or merge every existing entry into `.github/CODEOWNERS` in this same
   PR. Rerun the helper; never allow the new higher-precedence file to shadow
   an unmerged policy.

4. If the helper reports other v1 callers, inspect only the reported workflow
   paths. Remove a file only when it is dedicated to v1; otherwise remove or
   deactivate the legacy job. Repeat the preview until no v1 caller remains.
5. Prove that the installed workflow exactly matches the template, then read
   the final effective CODEOWNERS rules:

   ```bash
   cmp \
     "$SOURCE_ROOT/templates/codex-gated-repo/.github/workflows/codex-review-gate.yml" \
     "$TARGET_ROOT/.github/workflows/codex-review-gate.yml"
   tail -n 4 "$TARGET_ROOT/.github/CODEOWNERS"
   ```

6. Require the CODEOWNERS suffix to protect `/.github/workflows/` and
   `/.github/CODEOWNERS` with only `CONTROL_PLANE_OWNER`. Review the complete
   diff, run the consumer repository's required checks, commit, push, and open
   one migration PR. The PR may contain v1 removal, v2 installation, and the
   CODEOWNERS merge.
7. Treat the first approval as a manual trust-bootstrap gate. The base branch
   does not yet contain the new CODEOWNERS rules and the new ruleset is still
   absent, so GitHub cannot enforce this first owner approval for you. Require
   `CONTROL_PLANE_OWNER` to be different from the PR author, then prove that
   the owner's latest review is an `APPROVED` review bound to the current head:

   ```bash
   CONTROL_PLANE_LOGIN="${CONTROL_PLANE_OWNER#@}"
   MIGRATION_HEAD="$(gh pr view "$MIGRATION_PR" \
     --repo "$REPO" \
     --json headRefOid,state,isDraft \
     --jq 'if .state == "OPEN" and (.isDraft | not) then .headRefOid else error("migration PR is not open and ready") end')"
   REVIEW_PAGES="$(mktemp)"
   gh api --paginate --slurp \
     "repos/$REPO/pulls/$MIGRATION_PR/reviews?per_page=100" \
     > "$REVIEW_PAGES"
   jq -e \
     --arg owner "$CONTROL_PLANE_LOGIN" \
     --arg head "$MIGRATION_HEAD" \
     '[.[][] | select((((.user.login? // "") | ascii_downcase) == ($owner | ascii_downcase)) and .user.type == "User")]
      | sort_by([.submitted_at, .id])
      | last
      | .state == "APPROVED" and ((.commit_id | ascii_downcase) == ($head | ascii_downcase))' \
     "$REVIEW_PAGES"
   rm -f "$REVIEW_PAGES"
   test "$(gh pr view "$MIGRATION_PR" --repo "$REPO" --json headRefOid --jq .headRefOid)" = "$MIGRATION_HEAD"
   ```

   Stop if `jq -e` fails, the owner is the PR author, the head changes, or a
   later owner review is not an exact-head approval. Do not merge on prose or
   a stale UI indication.
8. Merge the migration PR only after that final readback. Refresh
   `DEFAULT_BRANCH`, then repeat the byte
   comparison against the merged default-branch checkout.

The canonical workflow must have this contract after the merge:

- `JoeyTeng/codex-review-gate-action@v2`;
- automatic execution only for exact Codex `issue_comment` `created`/`edited`
  and actual `pull_request_target` base-ref retargets back to the default branch;
- exact pre-runner sender and author checks for
  `chatgpt-codex-connector[bot]` with type `Bot`;
- `workflow_dispatch` as the only manual trigger, with `operation`,
  `pr_number`, `expected_head_sha`, optional `request_comment_id`,
  `request_review` defaulting to `true`, and `limits_profile` restricted to
  `default` or `expanded`;
- `ubuntu-slim` by default, with only
  `CODEX_REVIEW_GATE_USE_UBUNTU_LATEST=true` selecting `ubuntu-latest`;
- no cron, `repository_dispatch`, broad `pull_request` reset,
  `pull_request_review`, runtime App, or ledger.

The wrapper maps protected repository variable
`CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION` into the Action environment.
Exact `any` accepts an ordinary request author at any repository permission;
otherwise the runtime requires `write`, `maintain`, or `admin`. This setting
affects only which ordinary request may establish a generation. It never makes
a qualifying Codex finding non-blocking.

The Action step must use underscore input names:
`github_token`, `pr_number`, `expected_head_sha`, `operation`,
`request_comment_id`, `request_review`, and `limits_profile`. Its public outputs
are exactly `execution_health`, `gate_outcome`, `recovery_code`, and
`retry_safe`. Treat finding counts as summary/sticky diagnostics, never as
outputs.

## Phase 2: stage and verify the disabled ruleset

Run staging only after the canonical workflow is on `DEFAULT_BRANCH`:

```bash
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo "$REPO" \
  --control-plane-owner "$CONTROL_PLANE_OWNER"
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo "$REPO" \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --apply
```

The expected staged object is
`templates/codex-gated-repo/rulesets/codex-review-gate.json`. Re-read the
repository rulesets and require exactly one intended gate ruleset with all of
these properties:

```text
target: default branch
enforcement: disabled
required context: codex/github-review-gate
expected source: GitHub Actions
expected source integration_id: 15368
strict up-to-date: true
code-owner review: true
dismiss stale reviews on push: true
ordinary approving review count: 0 for a new ruleset; preserve any existing higher count
all review conversations resolved: true
non-fast-forward default-branch updates blocked: true
bypass actors: empty
```

Stop on any active inherited or separately managed v1 required status. Report
the exact ruleset instead of silently creating a second active policy. Do not
activate v2 before the canary passes.

## Phase 3: create the separate canary PR

1. From the merged `DEFAULT_BRANCH`, create a temporary branch with one
   harmless, reviewable change. Push it and open a non-draft PR.
2. Record the authoritative PR number, base, and full head SHA:

   ```bash
   CANARY_PR="$(gh pr view CANARY_SELECTOR \
     --repo "$REPO" \
     --json number \
     --jq '.number')"
   CANARY_BASE="$(gh pr view "$CANARY_PR" \
     --repo "$REPO" \
     --json baseRefName \
     --jq '.baseRefName')"
   CANARY_HEAD="$(gh pr view "$CANARY_PR" \
     --repo "$REPO" \
     --json headRefOid \
     --jq '.headRefOid')"
   test "$CANARY_BASE" = "$DEFAULT_BRANCH"
   test "${#CANARY_HEAD}" -eq 40
   ```

3. Prefer a direct exact request. This path does not allocate a gate runner
   merely to ask for review:

   ```bash
   REQUEST_COMMENT_ID="$(gh api \
     --method POST \
     "repos/$REPO/issues/$CANARY_PR/comments" \
     -f body='@codex review' \
     --jq '.id')"
   test -n "$REQUEST_COMMENT_ID"
   ```

   Do not add prose to the request. A qualifying Codex bot `issue_comment`
   `created` or `edited` event will wake the installed workflow. A review or
   reaction alone does not have an automatic consumer job; use manual
   `reconcile` when a later evaluation is needed.

   Before choosing this zero-run path, query the exact `headRefOid` commit's
   `codex/github-review-gate` statuses. Commit statuses persist on a commit SHA
   and have no PR identity. Parallel or duplicate PRs that share one head SHA
   would reuse and overwrite the same context; that shape is unsupported. The
   workflow deliberately has no broad automatic `pull_request` reset job. Its
   narrow `pull_request_target` `edited` path starts only for an actual retarget
   back to the default branch and makes the unchanged head pending; unrelated
   edits are skipped before runner allocation. If this exact head already has a
   successful gate and the caller needs a deliberate same-head re-review, use
   step 4 `begin-review` first. Do not rely on a direct comment to invalidate
   the old success.

   If the status summary reports a base epoch, base retarget, or
   `request_clean_generation`, do not use this zero-run path as the recovery.
   Dispatch step 4 with `request_review=true`, wait for a qualifying Codex `+1`
   directly on the generated canonical request, and then reconcile. A later
   terminal clean is not request/base-lineage proof in this mode and must not be
   treated as a pass; findings remain blocking.

4. Use `begin-review` instead of step 3 only when the workflow must first set
   pending and coordinate a fresh request. Dispatch it without `--ref`:

   ```bash
   DISPATCHED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
   gh workflow run codex-review-gate.yml \
     --repo "$REPO" \
     -f operation=begin-review \
     -f pr_number="$CANARY_PR" \
     -f expected_head_sha="$CANARY_HEAD" \
     -f request_review=true \
     -f limits_profile=default
   ```

   `request_review=true` is the default, but pass it explicitly in an agent
   run. `request_review=false` is an advanced best-effort pending-only path; if
   used, wait for that run to complete before posting a new direct request.

5. After every manual dispatch, wait for GitHub to index the run and list only
   runs created after `DISPATCHED_AT`:

   ```bash
   gh run list \
     --repo "$REPO" \
     --workflow codex-review-gate.yml \
     --event workflow_dispatch \
     --created ">=$DISPATCHED_AT" \
     --limit 20 \
     --json databaseId,event,headBranch,headSha,status,conclusion,createdAt,url
   ```

   Identify the just-dispatched run from its time and exact PR/head summary.
   If concurrent candidates make the identity ambiguous, stop and inspect them;
   do not guess or dispatch again. Require `event=workflow_dispatch` and
   `headBranch=$DEFAULT_BRANCH`. Record its run ID, URL, and default-branch
   `headSha`. Reject a feature-ref run.

## Phase 4: reconcile the exact head and interpret the result

1. Refresh `CANARY_HEAD`. If it changed, replace the recorded value and obtain
   review evidence for the new head before continuing.
2. Dispatch a final exact-head reconcile without `--ref`:

   ```bash
   DISPATCHED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
   gh workflow run codex-review-gate.yml \
     --repo "$REPO" \
     -f operation=reconcile \
     -f pr_number="$CANARY_PR" \
     -f expected_head_sha="$CANARY_HEAD" \
     -f request_review=false \
     -f limits_profile=default
   ```

   When a direct request ID is available, add
   `-f request_comment_id="$REQUEST_COMMENT_ID"`. It is a location hint, not
   authority. Repeat the Phase 3 run readback and again prove
   `headBranch=$DEFAULT_BRANCH`.

3. Wait for the selected run to finish. Read its job summary and record the
   four outputs:

   ```text
   execution_health
   gate_outcome
   recovery_code
   retry_safe
   ```

   Follow the summary's concrete next action. Findings normally produce a
   healthy failing gate; an unhealthy execution is a recovery problem, not a
   finding verdict. When derivable, `findings_unresolved`,
   `findings_resolved`, `findings_historical`, and `findings_indeterminate`
   appear only in the summary and sticky diagnostic.

4. If the summary directs use of the larger reviewed profile, repeat the same
   reconcile with:

   ```bash
   -f limits_profile=expanded
   ```

   Do not add page, object, attempt, timeout, or other numeric inputs. If this
   repository regularly requires the larger profile, persist only the named
   profile:

   ```bash
   gh variable set CODEX_REVIEW_GATE_LIMITS_PROFILE \
     --repo "$REPO" \
     --body expanded
   ```

5. If `ubuntu-slim` is unavailable for this repository, select the only
   supported runner fallback:

   ```bash
   gh variable set CODEX_REVIEW_GATE_USE_UBUNTU_LATEST \
     --repo "$REPO" \
     --body true
   ```

   Do not add an arbitrary runner-label input or variable.

## Phase 5: prove the canary and activate protection

1. Re-read the pull request. Require it to remain open, non-draft, based on
   `DEFAULT_BRANCH`, and still at `CANARY_HEAD`.
2. Read the exact commit status:

   ```bash
   gh api "repos/$REPO/commits/$CANARY_HEAD/status" \
     --jq '[.statuses[] | select(.context == "codex/github-review-gate")] | max_by(.id) | {state, context, creator: .creator.login, target_url}'
   ```

   Require the newest exact-context status to be `success` and its creator to
   be `github-actions[bot]`. Also require the selected run summary to report
   `execution_health=healthy` and `gate_outcome=success`. A different current
   head invalidates the result.

3. Preview and apply activation:

   ```bash
   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --repo "$REPO" \
     --control-plane-owner "$CONTROL_PLANE_OWNER" \
     --activate \
     --canary-pr "$CANARY_PR" \
     --canary-head "$CANARY_HEAD"
   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --repo "$REPO" \
     --control-plane-owner "$CONTROL_PLANE_OWNER" \
     --apply \
     --activate \
     --canary-pr "$CANARY_PR" \
     --canary-head "$CANARY_HEAD"
   ```

4. The helper must re-read the exact default-branch workflow inventory,
   CODEOWNERS errors, and owner permission immediately before every ruleset
   POST or PUT. Re-read the ruleset. Require active default-branch enforcement, exact
   context `codex/github-review-gate`, expected GitHub Actions source
   `integration_id: 15368`, strict up-to-date, Code Owner review, stale-review
   dismissal, the new-ruleset default of zero ordinary approvals without
   lowering any existing higher count, all conversations resolved, and
   non-fast-forward default-branch protection, and an explicitly empty
   `bypass_actors` array. Treat a missing or non-array value as incomplete, not
   as empty.
5. Re-run the plain remote probe and require no drift or remaining v1 caller:

   ```bash
   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --repo "$REPO" \
     --control-plane-owner "$CONTROL_PLANE_OWNER"
   ```

6. Close the canary without merging and delete only its temporary branch:

   ```bash
   gh pr close "$CANARY_PR" --repo "$REPO" --delete-branch
   gh pr view "$CANARY_PR" \
     --repo "$REPO" \
     --json state,mergedAt
   ```

   Require `state=CLOSED` and `mergedAt=null`.

7. Report the migration PR, closed-unmerged canary PR, canonical workflow path,
   active ruleset ID, exact successful canary head and run URL, and any
   persistent profile or runner-fallback variables.

There is no scheduled recovery loop. If a bot event is missed or evidence
arrives only through a review/reaction, dispatch one exact-head `reconcile` for
that PR and follow its reported recovery action.
