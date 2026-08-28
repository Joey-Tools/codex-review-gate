# Agent 安装执行手册：Codex Review Gate v2

本文供 coding agent 代替仓库维护者执行安装。它是[人类指南](human.zh-CN.md)的
确定性执行版本，不是另一套安装设计。必须复制 canonical assets，不得从示例重写
任一 consumer workflow。

必须安装并验证三个完整必需 asset groups：canonical verifier/controller workflows、repository ruleset 与
最终有效的 `.github/CODEOWNERS`。CODEOWNERS 中两条受管规则必须指向同一个显式
`CONTROL_PLANE_OWNER`；ruleset 必须要求 Code Owner review，并在 push 后 dismiss stale
approvals。`integration_id: 15368` 标识的是整个 GitHub Actions App，不是任一 workflow，
因此不能替代两份 workflow byte verification 与 CODEOWNERS 控制面。

## 输入与停止条件

先解析并记录：

```text
SOURCE_ROOT = Joey-Tools/codex-review-gate 的干净 checkout
TARGET_ROOT = 已授权 consumer repository worktree
REPO = TARGET_ROOT 对应的 OWNER/REPO
DEFAULT_BRANCH = consumer repository default branch
INSTALL_BRANCH = migration PR branch
MIGRATION_PR = migration PR 创建后的编号
CONTROL_PLANE_OWNER = 对 REPO 有 write、maintain 或 admin 的一个 @USER
```

目标未授权、`TARGET_ROOT` 有无关 dirty changes、无法证明默认分支，或仓库不在支持的
GitHub.com/default-branch PR scope 时停止。

保持以下不变量：

- 一个 migration PR 可以同时移除 v1、安装 v2；
- migration 合并后才创建独立 canary PR；
- canary 最后关闭、不合并；
- 每次 manual run 只处理一个 PR 与一个 exact expected head；
- `workflow_dispatch` 是唯一 manual entry；
- 使用不带 feature ref 的 `gh workflow run`，随后 read back 并证明 run 来自
  `DEFAULT_BRANCH`；
- 优先直接发 `@codex review`；只有 request creation 与更新 verifier attempt 需要
  controller 协调时才用 `begin-review`；
- limit profile 只允许通过 protected repository variable
  `CODEX_REVIEW_GATE_LIMITS_PROFILE` 选择 `default` 与 `expanded`，不得增加 dispatch
  或 numeric override；
- `CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION` 是 protected wrapper configuration：
  只有 exact `any` 覆盖默认 `write`，绝不把它新增为 Action input。
- 每次调用 bootstrap 都显式保留同一个 `CONTROL_PLANE_OWNER`。默认值是
  `@JoeyTeng`；非 Joey 仓库必须替换成自己的合格 GitHub user。

## 阶段 1：准备并合并 migration PR

1. 读取默认分支：

   ```bash
   DEFAULT_BRANCH="$(gh repo view "$REPO" \
     --json defaultBranchRef \
     --jq '.defaultBranchRef.name')"
   test -n "$DEFAULT_BRANCH"
   ```

2. 修改 worktree 前，对 repository default workflow permissions 做只读 preflight：

   ```bash
   DEFAULT_WORKFLOW_PERMISSIONS="$(gh api \
     "repos/$REPO/actions/permissions/workflow" \
     --jq '.default_workflow_permissions')"
   test "$DEFAULT_WORKFLOW_PERMISSIONS" = read
   ```

   值缺失、无法读取或不是 `read` 时必须停止。不得在本次安装中静默修改；应另行取得授权，
   把 repository default workflow permissions 设为 read-only，读回该 endpoint 后从这个
   preflight 重新开始。

3. 在 `TARGET_ROOT` 从最新 `DEFAULT_BRANCH` 创建 `INSTALL_BRANCH`。
4. 预览并应用两份 canonical workflows：

   ```bash
   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --prepare-worktree "$TARGET_ROOT" \
     --control-plane-owner "$CONTROL_PLANE_OWNER"
   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --prepare-worktree "$TARGET_ROOT" \
     --control-plane-owner "$CONTROL_PLANE_OWNER" \
     --apply
   ```

   Helper 会在显式 checkpoint 重新验证 target workflow parents。这不是
   operation-bound filesystem sandbox：恶意 same-UID process 仍可能在 checkpoint
   之间 race path-based operation。出现 safety failure 时停止，不得改用手工复制；只有
   确认不可信进程无法并发修改这些 parents 时才继续。

   若 helper 报告根目录 `CODEOWNERS` 或 `docs/CODEOWNERS`，停止并在同一个 PR 中把所有
   既有 entries 移动或合并进 `.github/CODEOWNERS`，然后重跑。不得让高优先级新文件
   遮蔽尚未合并的旧 policy。

5. Helper 若报告其他 v1 caller，只检查它列出的 paths。整个文件专用于 v1 时才删除；
   否则只移除或停用 legacy job。重复 preview，直到无 v1 caller。
6. 证明两份 workflow bytes 等于各自 canonical template，并读取最终有效的 CODEOWNERS
   rules：

   ```bash
   cmp \
     "$SOURCE_ROOT/templates/codex-gated-repo/.github/workflows/codex-review-gate.yml" \
     "$TARGET_ROOT/.github/workflows/codex-review-gate.yml"
   cmp \
     "$SOURCE_ROOT/templates/codex-gated-repo/.github/workflows/codex-review-gate-controller.yml" \
     "$TARGET_ROOT/.github/workflows/codex-review-gate-controller.yml"
   tail -n 4 "$TARGET_ROOT/.github/CODEOWNERS"
   ```

7. 要求 CODEOWNERS suffix 只用 `CONTROL_PLANE_OWNER` 保护
   `/.github/workflows/` 与 `/.github/CODEOWNERS`。审核完整 diff、运行 consumer 必需
   验证、commit、push，并开一个 migration PR。它可以同时包含 v1 removal、v2
   installation 与 CODEOWNERS merge。
8. 请求 owner approval 前，运行 tracked executable
   `$SOURCE_ROOT/scripts/build-legacy-review-gate-inventory.sh`。它精确接收 repository、
   expected default branch 与 output path 三个参数；不得从本指南重建实现。捕获 digest：

   ```bash
   APPROVAL_INVENTORY_DIR="$(mktemp -d)"
   APPROVAL_INVENTORY="$APPROVAL_INVENTORY_DIR/legacy-inventory.json"
   LEGACY_INVENTORY_SHA256="$("$SOURCE_ROOT/scripts/build-legacy-review-gate-inventory.sh" \
     "$REPO" "$DEFAULT_BRANCH" "$APPROVAL_INVENTORY")"
   LEGACY_INVENTORY_SHA256="${LEGACY_INVENTORY_SHA256#LEGACY_INVENTORY_SHA256=}"
   printf 'LEGACY_INVENTORY_SHA256=%s\n' "$LEGACY_INVENTORY_SHA256"
   ```

   把 canonical JSON 与打印的 SHA-256 一并记录进 approval snapshot，并让全部 inventoried
   legacy requirements 保持 active 直到 migration merge。
9. 把第一次批准视为 manual trust-bootstrap gate。Base branch 此时还没有新的
   CODEOWNERS rules，ruleset 也尚未建立，所以 GitHub 无法替你强制这次 owner approval。
   要求 `CONTROL_PLANE_OWNER` 与 PR author 不同，然后证明该 owner 的最新 review 是绑定
   current head 的 `APPROVED`：

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

   `jq -e` 失败、owner 与 PR author 相同、head 漂移，或该 owner 的后续 review 不是
   exact-head approval 时停止；不得依赖 prose 或 stale UI indication 合并。
10. 保留第 9 步的 exact `MIGRATION_HEAD` 与 approval snapshot。进入 transaction 前，完成并
   保留全部 legacy requirements 到 merge 完成，使后续失败仍 fail closed。Owner approval
   第 8 步已用 canonical generator 生成只读 inventory，并把 SHA-256 写入 approval snapshot；它绑定
   repository/default branch；每个 matching ruleset 的 identity、conditions、enforcement、
   target 与完整 `bypass_actors`；包含全部 parameters 的完整 matching effective
   `required_status_checks` rule；以及 classic required statuses（包括 `strict`）或显式
   null。Hash 前会排序语义无序的 bypass/check/context arrays 与 conditions
   include/exclude sets。Digest 必须从外部传为 `LEGACY_INVENTORY_SHA256`，没有默认值。

   在一个 fail-fast transaction 中执行 final gate 与唯一 merge mutation：

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

   所有 precondition 都在 synchronous merge mutation 前；API、`jq`、`test`、pagination、
   parse、actor、base、head、state 或 review 任一失败都会退出，trap 清理 temporary files。
   REST endpoint 只能即时 merge 或失败（包括 405/409），不能 enqueue。不得使用
   `gh pr merge`、auto-merge、merge queue 或 admin bypass。Current actor 必须是 trusted
   owner，并在 fresh review readback 后立即 direct merge；GitHub 没有 review-state-plus-head
   atomic CAS，只重读 head 不足以闭环。

   只有 merge 后立即重读 current default、exact base/head 与 merged lifecycle 全部成功，
   才执行另行授权的 removal plan，并读回两个 legacy surfaces。这个短暂 staged
   window 可能继续阻塞新 PR，但不会 fail open；随后以 Disabled stage v2、跑 canary、再
   activate。

11. 读回 merge，随后 fetch 默认分支，对 merged file 重做 byte comparison，并重新读取最终
   有效的 CODEOWNERS block 与显式 owner：

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

合并后的两份 canonical workflows contract 必须是：

- `JoeyTeng/codex-review-gate-action@v2`；
- verifier path `.github/workflows/codex-review-gate.yml`、workflow name
  `Codex Review Gate Verifier`、`pull_request` types `opened`、`reopened`、
  `synchronize`、`ready_for_review`，以及 exact PR feature-head SHA 上的 required job
  `codex/github-review-gate`；
- controller path `.github/workflows/codex-review-gate-controller.yml`、workflow
  name `Codex Review Gate Controller`、exact Codex `issue_comment`
  `created`/`edited`，以及 default-branch `workflow_dispatch`；
- runner 前精确校验 sender 与 author 为
  `chatgpt-codex-connector[bot]`、type `Bot`；
- manual trigger 只有 `workflow_dispatch`，inputs 为 `operation`、`pr_number`、
  `expected_head_sha`、可选 `request_comment_id`、默认 `true` 的
  `request_review`；没有 dispatch limits profile；
- 默认 `ubuntu-slim`，只有
  `CODEX_REVIEW_GATE_USE_UBUNTU_LATEST=true` 选择 `ubuntu-latest`；
- verifier/controller 使用独立 concurrency namespaces；verifier latest-wins cancel，
  controller operations 不 cancel；
- 没有 cron、`repository_dispatch`、`pull_request_target`、可写
  `pull_request_review`、status bridge、runtime App 或 ledger。

controller Action step 的 underscore inputs 只有 `github_token`、`pr_number`、
`expected_head_sha`、`operation`、`request_comment_id` 与 `request_review`。两份 Action
steps 从 protected repository variable `CODEX_REVIEW_GATE_LIMITS_PROFILE` 派生
`limits_profile=default|expanded`；public outputs 只有 `execution_health`、`gate_outcome`、
`recovery_code` 与 `retry_safe`。Finding counts 仅是 summary/sticky diagnostics。

Wrapper 把 protected repository variable
`CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION` 映射到 Action environment。Exact `any`
允许任意 permission 的普通 request author；其他值要求 `write`、`maintain` 或 `admin`。
它只影响 ordinary request 是否能建立 generation，不会让合格 finding 失去阻塞效力。

## 阶段 2：暂存并验证 Disabled ruleset

Canonical workflow 已进入 `DEFAULT_BRANCH` 后执行：

```bash
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo "$REPO" \
  --control-plane-owner "$CONTROL_PLANE_OWNER"
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo "$REPO" \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --apply
```

重新读取 repository rulesets，要求唯一目标 ruleset 满足：

```text
target coverage: 新建 ruleset 只覆盖 default branch；existing 同名 ruleset 若已有更广 targets，其 include/exclude conditions 会原样保留并必须核对
enforcement: disabled
required context: codex/github-review-gate
expected source: GitHub Actions
expected source integration_id: 15368
strict up-to-date: true
code-owner review: true
dismiss stale reviews on push: true
ordinary approving review count: 新 ruleset 为 0；既有更高 count 保留
all review conversations resolved: true
non-fast-forward default-branch updates blocked: true
bypass actors: explicit empty array
```

对于 existing 同名 ruleset，必须确认它覆盖 `DEFAULT_BRANCH`，再检查每一个被保留的额外
include/exclude target 是否符合预期。不得把更广 targets 的既有 coverage 误报成 helper
已将其收窄到默认分支。

要求 helper 的 legacy inventory 同时覆盖 effective repository rulesets 与 classic branch
protection required-status contexts。若 active inherited 或另一受管 ruleset 仍要求
`codex/review-gate`，报告 exact blocker 并停止。若 classic branch protection 要求该
context，停止并通过另行授权的 repository settings 人工移除；helper 必须 fail closed，
绝不能改写 classic protection。重跑前读回 classic policy；API 或 schema failure 必须视为
inconclusive，不能当作 absent。Canary pass 前不得 activate。

## 阶段 3：创建独立 canary PR

1. 从已合并 `DEFAULT_BRANCH` 创建临时分支与一个无害可 review 变更，push 并开 non-draft
   PR。
2. 读取权威 scope，把 exact `headRefOid` 记录为完整 head SHA：

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

3. 优先发送 exact request。这个路径不需要仅为了请求 review 而分配 gate runner：

   ```bash
   REQUEST_COMMENT_ID="$(gh api \
     --method POST \
     "repos/$REPO/issues/$CANARY_PR/comments" \
     -f body='@codex review' \
     --jq '.id')"
   test -n "$REQUEST_COMMENT_ID"
   ```

   不要增加 prose。Caller-authored event 会被 pre-runner bot filter 跳过，Codex bot 之后的
   合格 `issue_comment` `created` 或 `edited` event 才启动 controller workflow。Review 或
   reaction 本身没有自动 consumer job，需要时手动 reconcile。

   Authorized ordinary、无 marker request 上的 reactions 只表示 liveness；普通 request 上
   的 `+1` 不能独立产生 head-bound clean evidence。若 official Codex `eyes` reaction 或
   progress artifact 的时间与候选 terminal clean 相同或更晚，则 veto success。若该 liveness
   变化没有伴随后续合格 bot comment event，必须手动 dispatch exact-head `reconcile` 才能
   观察到它。

   选择这个低成本路径前，识别 GitHub 记录在 exact current PR feature-head SHA 上的原生
   `codex/github-review-gate` verifier run/job/CheckRun，并要求该 run 绑定 current test-merge。
   Workflow 刻意没有 cron 或可写 review event。若
   当前 exact scope 已有成功 verifier，而 caller 需要 deliberate same-head re-review，
   先执行第 4 步 `begin-review` 并要求严格更新的 verifier attempt。不能依靠 direct
   comment 原子化地使旧 success 失效。

   若 base retarget 后 current exact head/base/test-merge scope 没有 verifier，按
   `create_verifier_run` 恢复：ready PR 先转 draft 再标记 ready；already-draft PR 直接标记
   ready。Reconcile 前必须要求该 exact scope 出现新的 `ready_for_review` verifier；
   rerun 旧 event 不是有效的 retarget recovery。

   如果 controller summary 报告 base epoch、base retarget 或
   `request_clean_generation`，不要用 direct path 恢复。执行第 4 步并保持
   `request_review=true`，等 Codex 在生成的 canonical request 上直接留下合格 `+1`
   后再 reconcile。在这个 mode 中，later terminal clean 不能证明 request/base
   lineage，不得视为 pass；findings 仍始终阻塞。

4. 只有 controller 必须协调 fresh request 和 newer verifier attempt 时，才使用
   `begin-review`，并且不传 `--ref`：

   ```bash
   DISPATCHED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
   gh workflow run codex-review-gate-controller.yml \
     --repo "$REPO" \
     -f operation=begin-review \
     -f pr_number="$CANARY_PR" \
     -f expected_head_sha="$CANARY_HEAD" \
     -f request_review=true
   ```

   `request_review=true` 是默认值，但 agent 执行时仍显式传入。
   `request_review=false` 是高级 best-effort path。若使用，先等该 controller run 完成，
   再发 fresh direct request。

5. 每次 dispatch 后只列出 `DISPATCHED_AT` 之后的新 run：

   ```bash
   gh run list \
     --repo "$REPO" \
     --workflow codex-review-gate-controller.yml \
     --event workflow_dispatch \
     --created ">=$DISPATCHED_AT" \
     --limit 20 \
     --json databaseId,event,headBranch,headSha,status,conclusion,createdAt,url
   ```

   根据时间与 exact PR/head summary 识别刚 dispatch 的 run。并发候选导致身份不明确时
   停止，不得猜测或再次 dispatch。要求 `event=workflow_dispatch` 且
   `headBranch=$DEFAULT_BRANCH`；记录 run ID、URL 与 default-branch `headSha`，拒绝
   feature-ref run。

## 阶段 4：reconcile exact head

1. 刷新 `CANARY_HEAD`。发生变化时，为新 head 取得 review evidence 后再继续。
2. 执行 final exact-head reconcile：

   ```bash
   DISPATCHED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
   gh workflow run codex-review-gate-controller.yml \
     --repo "$REPO" \
     -f operation=reconcile \
     -f pr_number="$CANARY_PR" \
     -f expected_head_sha="$CANARY_HEAD" \
     -f request_review=false
   ```

   有 direct request ID 时可加
   `-f request_comment_id="$REQUEST_COMMENT_ID"`。它只是定位 hint，不提供 authority。重复
   run readback，证明使用 `DEFAULT_BRANCH`。

3. 等待选中的 run 完成，记录：

   ```text
   execution_health
   gate_outcome
   recovery_code
   retry_safe
   ```

   任何非 success result 都按 `recovery_code` 与 summary 的 concrete next action 操作。
   Finding 通常产生 healthy failure；unhealthy execution 是恢复问题，不是 finding
   verdict。`healthy/pending` 是 fail-closed，不能授权 success。只有 `wait_provider` 是
   纯等待；其他 recovery code 都必须先执行指定动作，再进行后续 exact-head reconcile。
   可推导时，
   `findings_unresolved`、`findings_resolved`、`findings_historical` 与
   `findings_indeterminate` 只出现在 summary/sticky diagnostic。

4. Summary 要求 larger reviewed profile 时，只持久设置受保护的具名 repository profile：

   ```bash
   gh variable set CODEX_REVIEW_GATE_LIMITS_PROFILE \
     --repo "$REPO" \
     --body expanded
   ```

   随后刷新 `CANARY_HEAD`，并 dispatch 一次 scoped controller reconcile。Manual dispatch
   没有 profile input。不得增加 page/object/attempt/timeout 等 numeric input。

5. `ubuntu-slim` 不可用时，只允许：

   ```bash
   gh variable set CODEX_REVIEW_GATE_USE_UBUNTU_LATEST \
     --repo "$REPO" \
     --body true
   ```

## 阶段 5：证明 canary、启用保护并清理

1. 重新读取 PR，要求仍 open、non-draft、base 为 `DEFAULT_BRANCH`，head 仍为
   `CANARY_HEAD`。
2. 读取当前 exact test-merge SHA 与 exact feature-head 上的原生 CheckRun：

   ```bash
   DEFAULT_BRANCH_HEAD_SHA="$(gh api \
     "repos/$REPO/branches/$DEFAULT_BRANCH" \
     --jq '.commit.sha')"
   CANARY_TEST_MERGE_SHA="$(gh api \
     "repos/$REPO/pulls/$CANARY_PR" \
     --jq '.merge_commit_sha')"
   test -n "$DEFAULT_BRANCH_HEAD_SHA"
   test -n "$CANARY_TEST_MERGE_SHA"
   gh api --paginate --slurp \
     "repos/$REPO/commits/$CANARY_HEAD/check-runs?check_name=codex%2Fgithub-review-gate&filter=latest&per_page=100" \
     --jq '[.[].check_runs[] | {id, status, conclusion, head_sha, app: .app.id, details_url}]'
   ```

   要求 current canonical verifier CheckRun 恰好一个，
   `head_sha=$CANARY_HEAD`、GitHub Actions App ID 为 `15368`、
   `conclusion=success`。canonical `pull_request` verifier 在 `refs/pull/N/merge` 上执行；
   Action 内部严格校验 `GITHUB_REF`、`GITHUB_SHA`、event PR head/base/test-merge SHAs 与
   fresh PR read。要求该 run 的 exact `display_title` 为
   `codex-review-gate-verifier/$CANARY_PR/$CANARY_TEST_MERGE_SHA`，且唯一
   `pull_requests` binding 含 current feature head 与
   `base.sha=$DEFAULT_BRANCH_HEAD_SHA`。把该 feature-head CheckRun 绑定到 controller 报告的
   strictly newer verifier attempt，并要求该 attempt 在执行语义上绑定
   `CANARY_TEST_MERGE_SHA`。
   Verifier summary 还必须报告 `execution_health=healthy`、`gate_outcome=success`。当前
   head、base 或 test-merge SHA 任一变化都会使结果失效。

3. 带 canary scope 预览并启用：

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

   对于 active ruleset，Helper 必须在 mutation 立即前重读 authority，随后才执行 POST/PUT。
   该重读包括 canary lifecycle、base/head、test-merge SHA、exact feature-head verifier
   run/job/CheckRun、canonical `display_title`、唯一 PR head/base binding
   与 collision inventory，以及 exact default-branch workflow inventory、
   CODEOWNERS errors 与 owner permission；并在 write 后
   读回 exact ruleset 与完整 consumer security snapshot。要求 active default-branch
   enforcement、
   `codex/github-review-gate`、`integration_id: 15368`、strict up-to-date、all
   Code Owner review、push 后 dismiss stale approvals、新 ruleset 的普通 approving count
   默认为 0 且不降低既有更高 count、
   conversations resolved、default-branch non-fast-forward protection，以及显式空
   bypass actors。

4. 重跑普通 probe，要求 active policy no-op 且无 v1 caller：

   ```bash
   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --repo "$REPO" \
     --control-plane-owner "$CONTROL_PLANE_OWNER"
   ```

5. 关闭 canary、不合并，并只删除临时 branch：

   ```bash
   gh pr close "$CANARY_PR" --repo "$REPO" --delete-branch
   gh pr view "$CANARY_PR" \
     --repo "$REPO" \
     --json state,mergedAt
   ```

   要求 `state=CLOSED`、`mergedAt=null`。

6. 报告 migration PR、closed-unmerged canary PR、两份 canonical workflow paths、active
   ruleset ID、successful canary exact feature head、bound default-branch
   base/test-merge SHA、canonical run-name receipt 与 verifier run URL，以及持久 profile、
   runner 或 request-author-policy variables。

本流程没有 cron recovery loop。Bot event 丢失，或 evidence 只通过 review/reaction 到达
时，对该 PR dispatch 一个 exact-head `reconcile`，并执行它报告的恢复动作。
