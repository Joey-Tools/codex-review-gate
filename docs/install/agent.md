# Agent Installation Runbook: Codex Review Gate v2

Use this runbook when a coding agent installs v2 for a repository maintainer.
It is the executable form of the [human guide](human.md), not an alternative
installation design. Copy the canonical assets; never reconstruct either
consumer workflow from examples in this document.

Install and verify all three required asset groups: the canonical verifier and
controller workflows, the repository ruleset, and the final effective
`.github/CODEOWNERS`. The two
managed CODEOWNERS rules must name the same explicit `CONTROL_PLANE_OWNER`,
and the ruleset must require Code Owner review with stale approvals dismissed
after a push. `integration_id: 15368` identifies the whole GitHub Actions App,
not either workflow, so it is not a substitute for the byte-verified workflows
and the CODEOWNERS control plane.

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
- prefer direct `@codex review`; use `begin-review` only when request creation
  and a newer verifier attempt need controller coordination;
- select only `default` and `expanded` through protected repository variable
  `CODEX_REVIEW_GATE_LIMITS_PROFILE`, never dispatch or numeric overrides.
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

2. Perform a read-only preflight of the repository's default workflow
   permissions before changing the worktree:

   ```bash
   DEFAULT_WORKFLOW_PERMISSIONS="$(gh api \
     "repos/$REPO/actions/permissions/workflow" \
     --jq '.default_workflow_permissions')"
   test "$DEFAULT_WORKFLOW_PERMISSIONS" = read
   ```

   A missing, unreadable, or non-`read` value is a stop condition. Do not
   silently change it as part of this installation. Obtain separate
   authorisation to set the default workflow permissions to read-only, then
   read the endpoint back and restart this preflight.

3. Create `INSTALL_BRANCH` from the latest `DEFAULT_BRANCH` in `TARGET_ROOT`.
4. Preview and apply both canonical consumer workflows:

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

5. If the helper reports other v1 callers, inspect only the reported workflow
   paths. Remove a file only when it is dedicated to v1; otherwise remove or
   deactivate the legacy job. Repeat the preview until no v1 caller remains.
6. Prove that both installed workflows exactly match the templates, then read
   the final effective CODEOWNERS rules:

   ```bash
   cmp \
     "$SOURCE_ROOT/templates/codex-gated-repo/.github/workflows/codex-review-gate.yml" \
     "$TARGET_ROOT/.github/workflows/codex-review-gate.yml"
   cmp \
     "$SOURCE_ROOT/templates/codex-gated-repo/.github/workflows/codex-review-gate-controller.yml" \
     "$TARGET_ROOT/.github/workflows/codex-review-gate-controller.yml"
   tail -n 4 "$TARGET_ROOT/.github/CODEOWNERS"
   ```

7. Require the CODEOWNERS suffix to protect `/.github/workflows/` and
   `/.github/CODEOWNERS` with only `CONTROL_PLANE_OWNER`. Review the complete
   diff, run the consumer repository's required checks, commit, push, and open
   one migration PR. The PR may contain v1 removal, v2 installation, and the
   CODEOWNERS merge.
8. Before requesting owner approval, run the tracked executable
   `$SOURCE_ROOT/scripts/build-legacy-review-gate-inventory.sh`. It accepts
   exactly repository, expected default branch, and output path; do not
   reconstruct it from this guide. Capture its digest output:

   ```bash
   APPROVAL_INVENTORY_DIR="$(mktemp -d)"
   APPROVAL_INVENTORY="$APPROVAL_INVENTORY_DIR/legacy-inventory.json"
   LEGACY_INVENTORY_SHA256="$("$SOURCE_ROOT/scripts/build-legacy-review-gate-inventory.sh" \
     "$REPO" "$DEFAULT_BRANCH" "$APPROVAL_INVENTORY")"
   LEGACY_INVENTORY_SHA256="${LEGACY_INVENTORY_SHA256#LEGACY_INVENTORY_SHA256=}"
   printf 'LEGACY_INVENTORY_SHA256=%s\n' "$LEGACY_INVENTORY_SHA256"
   ```

   Record the canonical JSON and printed SHA-256 in the approval snapshot.
   Keep every inventoried legacy requirement active through migration merge.
9. Treat the first approval as a manual trust-bootstrap gate. The base branch
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
10. Preserve the exact `MIGRATION_HEAD` and approval snapshot from step 9.
   Keep every legacy requirement active until merge so later failure remains
   fail closed. The canonical read-only inventory and its SHA-256 were recorded
   before owner approval by step 8.
   It binds repository/default branch; every matching ruleset's identity,
   conditions, enforcement, target and complete `bypass_actors`; the complete
   matching effective `required_status_checks` rule with all parameters; and
   classic required statuses (including `strict`) or explicit null. Before
   hashing, it sorts semantically unordered bypass/check/context arrays and
   condition include/exclude sets. Inject that digest externally
   as `LEGACY_INVENTORY_SHA256`; there is no default.

   Run the final gate and sole merge mutation in one fail-fast transaction:

   ```bash
   (
     set -euo pipefail
     MIGRATION_PR=PR_NUMBER
     MIGRATION_HEAD=FULL_HEAD_SHA_FROM_APPROVAL_SNAPSHOT
     MERGE_METHOD=REPOSITORY_APPROVED_METHOD
     CONTROL_PLANE_LOGIN="${CONTROL_PLANE_OWNER#@}"
     case "$MERGE_METHOD" in
       merge|squash|rebase) ;;
       *) printf 'unsupported or unset repository merge method\n' >&2; exit 1 ;;
     esac
     TXN_DIR="$(mktemp -d)"
     PR_STATE="$TXN_DIR/pr.json"
     FINAL_REVIEW_PAGES="$TXN_DIR/reviews.json"
     MERGE_BODY="$TXN_DIR/merge-body.json"
     MERGE_RESPONSE="$TXN_DIR/merge-response.json"
     POST_MERGE_STATE="$TXN_DIR/post-merge.json"
     LEGACY_INVENTORY="$TXN_DIR/legacy-inventory.json"
     cleanup() {
       rm -f "$PR_STATE" "$FINAL_REVIEW_PAGES" "$MERGE_BODY" \
         "$MERGE_RESPONSE" "$POST_MERGE_STATE" "$LEGACY_INVENTORY"
       rmdir "$TXN_DIR" 2>/dev/null || true
     }
     trap cleanup EXIT
     trap 'exit 130' HUP INT TERM

     DEFAULT_BRANCH_FRESH="$(gh repo view "$REPO" \
       --json defaultBranchRef --jq '.defaultBranchRef.name')"
     test "$DEFAULT_BRANCH_FRESH" = "$DEFAULT_BRANCH"
     "$SOURCE_ROOT/scripts/build-legacy-review-gate-inventory.sh" \
       "$REPO" "$DEFAULT_BRANCH_FRESH" "$LEGACY_INVENTORY" > /dev/null
     FRESH_LEGACY_INVENTORY_SHA256="$(node -e '
       const crypto=require("node:crypto"); const fs=require("node:fs");
       process.stdout.write(crypto.createHash("sha256")
         .update(fs.readFileSync(process.argv[1])).digest("hex"));' "$LEGACY_INVENTORY")"
     test "$FRESH_LEGACY_INVENTORY_SHA256" = \
       "${LEGACY_INVENTORY_SHA256:?external approval-snapshot digest is required}"

     gh pr view "$MIGRATION_PR" --repo "$REPO" \
       --json author,baseRefName,headRefOid,state,isDraft > "$PR_STATE"
     jq -e --arg base "$DEFAULT_BRANCH_FRESH" --arg head "$MIGRATION_HEAD" \
       --arg owner "$CONTROL_PLANE_LOGIN" \
       '.baseRefName == $base and .headRefOid == $head and .state == "OPEN" and (.isDraft | not)
        and (((.author.login // "") | ascii_downcase) != ($owner | ascii_downcase))' \
       "$PR_STATE"
     CURRENT_ACTOR="$(gh api user --jq '.login')"
     jq -ne --arg actor "$CURRENT_ACTOR" --arg owner "$CONTROL_PLANE_LOGIN" \
       '($actor | ascii_downcase) == ($owner | ascii_downcase)'
     gh api --paginate --slurp \
       "repos/$REPO/pulls/$MIGRATION_PR/reviews?per_page=100" \
       > "$FINAL_REVIEW_PAGES"
     jq -e --arg owner "$CONTROL_PLANE_LOGIN" --arg head "$MIGRATION_HEAD" \
       '[.[][] | select((((.user.login? // "") | ascii_downcase) == ($owner | ascii_downcase)) and .user.type == "User")]
        | sort_by([.submitted_at, .id]) | last
        | .state == "APPROVED" and ((.commit_id | ascii_downcase) == ($head | ascii_downcase))' \
       "$FINAL_REVIEW_PAGES"

     jq -n --arg sha "$MIGRATION_HEAD" --arg method "$MERGE_METHOD" \
       '{sha:$sha, merge_method:$method}' > "$MERGE_BODY"
     gh api --method PUT "repos/$REPO/pulls/$MIGRATION_PR/merge" \
       --input "$MERGE_BODY" > "$MERGE_RESPONSE"
     jq -e '.merged == true' "$MERGE_RESPONSE"
     test "$(gh repo view "$REPO" --json defaultBranchRef --jq '.defaultBranchRef.name')" = \
       "$DEFAULT_BRANCH_FRESH"
     gh pr view "$MIGRATION_PR" --repo "$REPO" \
       --json baseRefName,headRefOid,state,mergedAt > "$POST_MERGE_STATE"
     jq -e --arg base "$DEFAULT_BRANCH_FRESH" --arg head "$MIGRATION_HEAD" \
       '.state == "MERGED" and .mergedAt != null and .baseRefName == $base
        and ((.headRefOid | ascii_downcase) == ($head | ascii_downcase))' \
       "$POST_MERGE_STATE"
   )
   ```

   Every precondition precedes the synchronous merge mutation. Any API, `jq`,
   `test`, pagination, parse, actor, base, head, state, or review failure exits
   and the trap cleans the temporary files. The REST endpoint merges
   immediately or fails, including 405/409; it cannot enqueue. Do not use
   `gh pr merge`, auto-merge, merge queue, or admin bypass. The current actor
   must be the trusted owner and performs the direct merge immediately after
   fresh review readback; GitHub has no atomic review-state-plus-head CAS, and
   a head-only reread is insufficient.

   Only after the immediate post-merge current-default/base/head/merged readback
   succeeds, execute the separately authorised removal plan and
   read back both legacy surfaces. New PRs may remain blocked during this short
   staged window, but protection never fails open. Then stage v2 Disabled,
   canary it, and activate it.

11. Read the merge back, then fetch the default branch and repeat the byte
   comparison against the merged file. Also re-read the final effective
   CODEOWNERS block and explicit owner:

   ```bash
   gh pr view "$MIGRATION_PR" \
     --repo "$REPO" \
     --json state,mergedAt,headRefOid \
     | jq -e --arg head "$MIGRATION_HEAD" \
       '.state == "MERGED" and .mergedAt != null and ((.headRefOid | ascii_downcase) == ($head | ascii_downcase))'
   git -C "$TARGET_ROOT" fetch origin "$DEFAULT_BRANCH"
   MERGED_VERIFIER="$(mktemp)"
   MERGED_CONTROLLER="$(mktemp)"
   git -C "$TARGET_ROOT" show \
     "FETCH_HEAD:.github/workflows/codex-review-gate.yml" \
     > "$MERGED_VERIFIER"
   cmp \
     "$SOURCE_ROOT/templates/codex-gated-repo/.github/workflows/codex-review-gate.yml" \
     "$MERGED_VERIFIER"
   git -C "$TARGET_ROOT" show \
     "FETCH_HEAD:.github/workflows/codex-review-gate-controller.yml" \
     > "$MERGED_CONTROLLER"
   cmp \
     "$SOURCE_ROOT/templates/codex-gated-repo/.github/workflows/codex-review-gate-controller.yml" \
     "$MERGED_CONTROLLER"
   rm -f "$MERGED_VERIFIER" "$MERGED_CONTROLLER"
   git -C "$TARGET_ROOT" show \
     "FETCH_HEAD:.github/CODEOWNERS" \
     | tail -n 4
   ```

The canonical workflows must have this contract after the merge:

- `JoeyTeng/codex-review-gate-action@v2`;
- verifier path `.github/workflows/codex-review-gate.yml`, workflow name
  `Codex Review Gate Verifier`, `pull_request` types `opened`, `reopened`,
  `synchronize`, `ready_for_review`, and required job
  `codex/github-review-gate` on the exact PR feature-head SHA;
- controller path `.github/workflows/codex-review-gate-controller.yml`, workflow
  name `Codex Review Gate Controller`, exact Codex `issue_comment`
  `created`/`edited`, and default-branch `workflow_dispatch`;
- exact pre-runner sender and author checks for
  `chatgpt-codex-connector[bot]` with type `Bot`;
- `workflow_dispatch` as the only manual trigger, with `operation`,
  `pr_number`, `expected_head_sha`, optional `request_comment_id`,
  and `request_review` defaulting to `true`; no dispatch limits profile;
- `ubuntu-slim` by default, with only
  `CODEX_REVIEW_GATE_USE_UBUNTU_LATEST=true` selecting `ubuntu-latest`;
- separate verifier/controller concurrency namespaces; verifier latest-wins
  cancellation and non-cancelling controller operations;
- no cron, `repository_dispatch`, `pull_request_target`, writable
  `pull_request_review`, status bridge, runtime App, or ledger.

The wrapper maps protected repository variable
`CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION` into the Action environment.
Exact `any` accepts an ordinary request author at any repository permission;
otherwise the runtime requires `write`, `maintain`, or `admin`. This setting
affects only which ordinary request may establish a generation. It never makes
a qualifying Codex finding non-blocking.

The controller Action step must use underscore input names:
`github_token`, `pr_number`, `expected_head_sha`, `operation`,
`request_comment_id`, and `request_review`. Both Action steps derive
`limits_profile=default|expanded` from protected repository variable
`CODEX_REVIEW_GATE_LIMITS_PROFILE`. Their public outputs
are exactly `execution_health`, `gate_outcome`, `recovery_code`, and
`retry_safe`. Treat finding counts as summary/sticky diagnostics, never as
outputs.

## Phase 2: stage and verify the disabled ruleset

Run staging only after both canonical workflows are on `DEFAULT_BRANCH`:

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
target coverage: a new ruleset is exactly the default branch; an existing same-name branch ruleset may preserve broader include/exclude conditions, which must be reviewed explicitly
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

For an existing same-name ruleset, require that it covers `DEFAULT_BRANCH`,
then inspect every preserved additional include/exclude target and confirm it
is intended. Do not report broader preserved coverage as though the helper had
narrowed it to the default branch.

Require the helper's legacy inventory to cover both effective repository
rulesets and classic branch protection required-status contexts. Stop on any
active inherited or separately managed `codex/review-gate` requirement and
report the exact ruleset. If classic branch protection requires that context,
stop and remove it manually through separately authorised repository settings;
the helper must fail closed and must never rewrite classic protection. Re-read
the classic policy before rerunning. Treat an API or schema failure as
inconclusive, not absent. Do not activate v2 before the canary passes.

## Phase 3: create the separate canary PR

1. From the merged `DEFAULT_BRANCH`, create a temporary branch with one
   harmless, reviewable change. Push it and open a non-draft PR.
2. Record the authoritative PR number, base, and exact `headRefOid` as the full
   head SHA:

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

   Reactions on an authorized ordinary, unmarked request are liveness-only.
   An ordinary `+1` cannot independently create head-bound clean evidence. An
   official Codex `eyes` reaction or progress artifact whose timestamp is the
   same as or later than candidate terminal clean evidence vetoes success. If
   that liveness change arrives without a later qualifying bot comment event,
   dispatch a manual exact-head `reconcile` to observe it.

   Before choosing this low-cost path, identify the native
   `codex/github-review-gate` verifier run/job/CheckRun that GitHub records
   against the exact current PR feature-head SHA, and require that run to be
   bound to the current test-merge. The
   workflow deliberately has no cron or writable review event. If this exact
   scope already has a successful verifier and the caller needs a deliberate
   same-head re-review, use step 4 `begin-review` first and require a strictly
   newer verifier attempt. Do not rely on a direct comment to atomically
   invalidate the old success.

   If a base retarget leaves no verifier for the current exact
   head/base/test-merge scope, follow
   `create_verifier_run`: for a ready PR, convert it to draft and mark it ready
   again; for an already-draft PR, mark it ready. Require a new
   `ready_for_review` verifier for that exact scope before reconciling.
   Rerunning the old event is not valid retarget recovery.

   If the controller summary reports a base epoch, base retarget, or
   `request_clean_generation`, do not use this zero-run path as the recovery.
   Dispatch step 4 with `request_review=true`, wait for a qualifying Codex `+1`
   directly on the generated canonical request, and then reconcile. A later
   terminal clean is not request/base-lineage proof in this mode and must not be
   treated as a pass; findings remain blocking.

4. Use `begin-review` instead of step 3 only when the controller must coordinate
   a fresh request and newer verifier attempt. Dispatch it without `--ref`:

   ```bash
   DISPATCHED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
   gh workflow run codex-review-gate-controller.yml \
     --repo "$REPO" \
     -f operation=begin-review \
     -f pr_number="$CANARY_PR" \
     -f expected_head_sha="$CANARY_HEAD" \
     -f request_review=true
   ```

   `request_review=true` is the default, but pass it explicitly in an agent
   run. `request_review=false` is an advanced best-effort path; if used, wait
   for that controller run to complete before posting a new direct request.

5. After every manual dispatch, wait for GitHub to index the run and list only
   runs created after `DISPATCHED_AT`:

   ```bash
   gh run list \
     --repo "$REPO" \
     --workflow codex-review-gate-controller.yml \
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
   gh workflow run codex-review-gate-controller.yml \
     --repo "$REPO" \
     -f operation=reconcile \
     -f pr_number="$CANARY_PR" \
     -f expected_head_sha="$CANARY_HEAD" \
     -f request_review=false
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

   Follow `recovery_code` and the summary's concrete next action for every
   non-success result. Findings normally produce a healthy failing gate; an
   unhealthy execution is a recovery problem, not a finding verdict.
   `healthy/pending` is fail-closed and cannot authorize success. Only
   `wait_provider` is a pure wait; every other recovery code requires the
   named action before a later exact-head reconcile. When derivable,
   `findings_unresolved`,
   `findings_resolved`, `findings_historical`, and `findings_indeterminate`
   appear only in the summary and sticky diagnostic.

4. If the summary directs use of the larger reviewed profile, persist only the
   protected named repository profile:

   ```bash
   gh variable set CODEX_REVIEW_GATE_LIMITS_PROFILE \
     --repo "$REPO" \
     --body expanded
   ```

   Then refresh `CANARY_HEAD` and dispatch one scoped controller reconcile.
   Manual dispatch has no profile input. Do not add page, object, attempt,
   timeout, or other numeric inputs.

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
2. Read the exact current test-merge SHA and the native CheckRun on the exact
   feature head:

   ```bash
   CANARY_TEST_MERGE_SHA="$(gh api \
     "repos/$REPO/pulls/$CANARY_PR" \
     --jq '.merge_commit_sha')"
   test -n "$CANARY_TEST_MERGE_SHA"
   gh api "repos/$REPO/commits/$CANARY_HEAD/check-runs" \
     --jq '[.check_runs[] | select(.name == "codex/github-review-gate")] | map({id, status, conclusion, head_sha, app: .app.id, details_url})'
   ```

   Require exactly one current canonical verifier CheckRun with
   `head_sha=$CANARY_HEAD`, GitHub Actions App ID `15368`, and
   `conclusion=success`. The canonical `pull_request` verifier executes on
   `refs/pull/N/merge`; inside the Action it strictly validates `GITHUB_REF`,
   `GITHUB_SHA`, the event PR head/base/test-merge SHAs and a fresh PR read.
   Bind the feature-head CheckRun to the strictly newer verifier attempt
   reported by the controller and require that attempt to be execution-bound
   to `CANARY_TEST_MERGE_SHA`. Also require the verifier summary to report
   `execution_health=healthy` and `gate_outcome=success`. A different current
   head, base or test-merge SHA invalidates the result.

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

4. The helper must re-read the canary lifecycle, base, head, test-merge SHA,
   exact feature-head verifier run/job/CheckRun and collision inventory, plus the exact
   default-branch workflow inventory, CODEOWNERS errors, and
   owner permission immediately before every active ruleset POST or PUT. After
   the write, read back the exact ruleset and the complete consumer security
   snapshot. Require active default-branch enforcement, exact
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

7. Report the migration PR, closed-unmerged canary PR, both canonical workflow
   paths, active ruleset ID, exact successful canary feature head and bound
   test-merge SHA, plus the
   verifier run URL, and any
   persistent profile or runner-fallback variables.

There is no scheduled recovery loop. If a bot event is missed or evidence
arrives only through a review/reaction, dispatch one exact-head `reconcile` for
that PR and follow its reported recovery action.
