# Agent 安装执行手册：Codex Review Gate v2

本文供 coding agent 代替仓库维护者执行安装。它是[人类指南](human.zh-CN.md)的
确定性执行版本，不是另一套安装设计。必须复制 canonical assets，不得从示例重写
consumer workflow。

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
- 优先直接发 `@codex review`；只有 pending 与 request creation 需要协调时才用
  `begin-review`；
- limit profile 只允许 `default` 与 `expanded`，不得增加 numeric override；
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

2. 在 `TARGET_ROOT` 从最新 `DEFAULT_BRANCH` 创建 `INSTALL_BRANCH`。
3. 预览并应用 canonical workflow：

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

4. Helper 若报告其他 v1 caller，只检查它列出的 paths。整个文件专用于 v1 时才删除；
   否则只移除或停用 legacy job。重复 preview，直到无 v1 caller。
5. 证明 workflow bytes 等于 canonical template，并读取最终有效的 CODEOWNERS rules：

   ```bash
   cmp \
     "$SOURCE_ROOT/templates/codex-gated-repo/.github/workflows/codex-review-gate.yml" \
     "$TARGET_ROOT/.github/workflows/codex-review-gate.yml"
   tail -n 4 "$TARGET_ROOT/.github/CODEOWNERS"
   ```

6. 要求 CODEOWNERS suffix 只用 `CONTROL_PLANE_OWNER` 保护
   `/.github/workflows/` 与 `/.github/CODEOWNERS`。审核完整 diff、运行 consumer 必需
   验证、commit、push，并开一个 migration PR。它可以同时包含 v1 removal、v2
   installation 与 CODEOWNERS merge。
7. 把第一次批准视为 manual trust-bootstrap gate。Base branch 此时还没有新的
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
8. 只有上述 final readback 通过后才合并 migration PR。刷新 `DEFAULT_BRANCH`，并对已合并
   checkout 重做 byte comparison。

合并后的 canonical contract 必须是：

- `JoeyTeng/codex-review-gate-action@v2`；
- 自动入口只有 exact Codex `issue_comment` `created`/`edited`，以及实际 retarget 回
  default branch 的 `pull_request_target` base-ref edit；
- runner 前精确校验 sender 与 author 为
  `chatgpt-codex-connector[bot]`、type `Bot`；
- manual trigger 只有 `workflow_dispatch`，inputs 为 `operation`、`pr_number`、
  `expected_head_sha`、可选 `request_comment_id`、默认 `true` 的
  `request_review`，以及 `default`/`expanded` 的 `limits_profile`；
- 默认 `ubuntu-slim`，只有
  `CODEX_REVIEW_GATE_USE_UBUNTU_LATEST=true` 选择 `ubuntu-latest`；
- 没有 cron、`repository_dispatch`、宽泛的 `pull_request` reset、
  `pull_request_review` writer job、runtime App 或 ledger。

Action step 的 underscore inputs 只有 `github_token`、`pr_number`、
`expected_head_sha`、`operation`、`request_comment_id`、`request_review` 与
`limits_profile`；public outputs 只有 `execution_health`、`gate_outcome`、
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
target: default branch
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

若 active inherited 或另一受管 ruleset 仍要求 v1 status，报告 exact blocker 并停止，
不得静默创建第二个 active policy。Canary pass 前不得 activate。

## 阶段 3：创建独立 canary PR

1. 从已合并 `DEFAULT_BRANCH` 创建临时分支与一个无害可 review 变更，push 并开 non-draft
   PR。
2. 读取权威 scope：

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

3. 选择 zero-run direct path 前，查询 exact `headRefOid` 上的
   `codex/github-review-gate` status。Commit status 会按 commit SHA 持久存在，Commit
   status 不包含 PR identity；共享同一 head SHA 的 parallel/duplicate PR 会复用并覆盖
   context，这种形态不受支持。Workflow 刻意没有宽泛的自动 `pull_request` reset job；
   狭窄的 `pull_request_target` `edited` path 只在实际 retarget 回 default branch 时启动，
   并把 unchanged head 改为 pending，其他 edit 在 runner allocation 前跳过。

   若 exact head 尚无 success，优先发 exact request：

   ```bash
   REQUEST_COMMENT_ID="$(gh api \
     --method POST \
     "repos/$REPO/issues/$CANARY_PR/comments" \
     -f body='@codex review' \
     --jq '.id')"
   test -n "$REQUEST_COMMENT_ID"
   ```

   不要增加 prose。Caller-authored event 会被 pre-runner bot filter 跳过，Codex bot 之后的
   合格 `issue_comment` `created` 或 `edited` event 才启动 workflow。Review 或 reaction
   本身没有自动 writer job，需要时手动 reconcile。

   如果 status summary 报告 base epoch、base retarget 或
   `request_clean_generation`，不要用 zero-run path 恢复。执行第 4 步并保持
   `request_review=true`，等 Codex 在生成的 canonical request 上直接留下合格 `+1`
   后再 reconcile。在这个 mode 中，later terminal clean 不能证明 request/base
   lineage，不得视为 pass；findings 仍始终阻塞。

4. Exact head 已有 success，但需要 deliberate same-head re-review 时，先用
   `begin-review` 把 status 设为 pending 并协调 fresh request：

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

   `request_review=false` 是高级 best-effort pending-only path。若使用，先等该 run 完成，
   再发 fresh direct request。不要复用 reset 前的 request 或 clean evidence。

5. 每次 dispatch 后只列出 `DISPATCHED_AT` 之后的新 run：

   ```bash
   gh run list \
     --repo "$REPO" \
     --workflow codex-review-gate.yml \
     --event workflow_dispatch \
     --created ">=$DISPATCHED_AT" \
     --limit 20 \
     --json databaseId,event,headBranch,headSha,status,conclusion,createdAt,url
   ```

   并发候选导致身份不明确时停止，不得猜测或再次 dispatch。要求
   `event=workflow_dispatch` 且 `headBranch=$DEFAULT_BRANCH`；拒绝 feature-ref run。

## 阶段 4：reconcile exact head

1. 刷新 `CANARY_HEAD`。发生变化时，为新 head 取得 review evidence 后再继续。
2. 执行 final exact-head reconcile：

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

   按 summary 的 concrete next action 操作。Finding 通常产生 healthy failure；unhealthy
   execution 是恢复问题，不是 finding verdict。可推导时，
   `findings_unresolved`、`findings_resolved`、`findings_historical` 与
   `findings_indeterminate` 只出现在 summary/sticky diagnostic。

4. Summary 要求 larger reviewed profile 时，重复同一 reconcile 并使用：

   ```bash
   -f limits_profile=expanded
   ```

   不得增加 page/object/timeout 等 numeric input。仓库长期需要该 profile 时，只持久设置：

   ```bash
   gh variable set CODEX_REVIEW_GATE_LIMITS_PROFILE \
     --repo "$REPO" \
     --body expanded
   ```

5. `ubuntu-slim` 不可用时，只允许：

   ```bash
   gh variable set CODEX_REVIEW_GATE_USE_UBUNTU_LATEST \
     --repo "$REPO" \
     --body true
   ```

## 阶段 5：证明 canary、启用保护并清理

1. 重新读取 PR，要求仍 open、non-draft、base 为 `DEFAULT_BRANCH`，head 仍为
   `CANARY_HEAD`。
2. 读取 exact commit status：

   ```bash
   gh api "repos/$REPO/commits/$CANARY_HEAD/status" \
     --jq '[.statuses[] | select(.context == "codex/github-review-gate")] | max_by(.id) | {state, context, creator: .creator.login, target_url}'
   ```

   要求 newest exact-context status 为 `success`，creator 为 `github-actions[bot]`，且
   summary 是 `execution_health=healthy`、`gate_outcome=success`。

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

   Helper 必须在每次 ruleset POST/PUT 立即前重读 exact default-branch workflow
   inventory、CODEOWNERS errors 与 owner permission；active write 前还要重读 canary
   lifecycle、base/head 与 exact status，并在 write 后读回 ruleset。要求 active default-branch enforcement、
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

6. 报告 migration PR、closed-unmerged canary PR、canonical workflow path、active ruleset
   ID、successful canary exact head 与 run URL，以及持久 profile、runner 或
   request-author-policy variables。

本流程没有 cron recovery loop。Bot event 丢失，或 evidence 只通过 review/reaction 到达
时，对该 PR dispatch 一个 exact-head `reconcile`，并执行它报告的恢复动作。
