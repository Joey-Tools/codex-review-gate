# 安装 Codex Review Gate v2

本文面向仓库维护者。[Agent 执行手册](agent.zh-CN.md)把同一套安装流程写成
确定性的执行清单，并不是另一种安装模式。两份指南都使用
`templates/codex-gated-repo/` 下的 canonical assets。

安全 rollout 使用两个 PR：

1. 一个 migration PR 同时移除 v1 caller、安装两份 canonical v2 workflows；
2. migration 合并后，另开一个无害 canary PR 验证默认分支 workflow 与 ruleset。

Canary 验证完成后关闭、不合并。

## 安装内容

完整安装包含三个必需 asset groups：

1. canonical read-only verifier `.github/workflows/codex-review-gate.yml`，以及受保护
   default branch 上的 controller
   `.github/workflows/codex-review-gate-controller.yml`；
2. 以 `templates/codex-gated-repo/rulesets/codex-review-gate.json` 为基础的 repository
   ruleset；
3. 最终生效的 `.github/CODEOWNERS`：其中两条受管规则必须使用一个显式指定的
   `CONTROL_PLANE_OWNER` 保护 `/.github/workflows/` 与 `/.github/CODEOWNERS`。

Ruleset 必须要求 Code Owner review，并在 push 后 dismiss stale approvals。两份
workflows 都使用兼容的 floating major：

```yaml
uses: JoeyTeng/codex-review-gate-action@v2
```

必须逐字复制两份 canonical workflows。Action step 无法定义的不同 event 与 permission
边界由它们分别负责：

- read-only verifier 只接受 `pull_request` 的 `opened`、`reopened`、`synchronize`
  与 `ready_for_review`；它在 exact PR feature-head SHA 上的 native
  `codex/github-review-gate` CheckRun 是 required signal；
- controller 自动 wake-up 只接受 `issue_comment` 的 `created` 与 `edited`；
- runner 分配前，event sender 与 comment author 都必须精确等于
  `chatgpt-codex-connector[bot]`，GitHub type 必须是 `Bot`；
- 唯一手动入口是 `workflow_dispatch`，每次只处理一个 PR；
- 手动 run 必须使用仓库默认分支上的 workflow；
- API-only job 默认使用 `ubuntu-slim`；仅当该 runner 不可用时，repository Actions
  variable `CODEX_REVIEW_GATE_USE_UBUNTU_LATEST=true` 才选择 `ubuntu-latest`；
- verifier 只有 evidence read permissions；controller 才有创建 request 与 rerun exact
  verifier 所需的窄 `issues: write` 与 `actions: write`。两者都没有
  `statuses: write` 或 `checks: write`。

默认情况下，普通用户发出的 `@codex review` 只有在 author 当前拥有 `write`、
`maintain` 或 `admin` 权限时，才能建立新的 review generation。若仓库明确接受任意
commenter 的 request，可以把受保护 repository Actions variable 设置为
`CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION=any`；其他任何值都映射为更安全的
`write` policy。这是 wrapper-owned protected configuration，不是 public Action input。
它不会削弱 finding authority：任何合格 Codex finding 仍然阻塞。

Consumer workflows 没有 cron、`repository_dispatch`、`pull_request_target`、自动
`pull_request_review` writer、runtime GitHub App、status bridge 或 ledger。evidence
由所选 verifier 从 PR 重建。

合格的普通、无 marker `@codex review` request 上的 reactions 只作为 provider liveness
evidence 读取。普通 request 上的 `+1` 不能独立产生 head-bound clean evidence。若 official
Codex `eyes` reaction 或 progress artifact 与候选 terminal clean 同时或更晚，则说明 review
activity 仍然有效并 veto success。Reaction 变化本身不会启动 consumer job，因此需要等待
后续合格 bot comment 触发，或手动 dispatch exact-head `reconcile`。

先选择一个 GitHub user 作为 `CONTROL_PLANE_OWNER`；该账号必须对 consumer repository
拥有 `write`、`maintain` 或 `admin` 权限。Helper 默认使用 `@JoeyTeng`，所有非 Joey
仓库都必须显式换成自己的合格 owner。之所以需要这层独立控制面，是因为 required check
的 `integration_id: 15368` 只标识整个 GitHub Actions App，并不能标识任一 workflow；
exact-byte 与 complete-inventory checks、CODEOWNERS、Code Owner review、stale
dismissal、strict freshness、no bypass actors 与 canary collision readback 共同构成
adopted compound boundary。

手动 `workflow_dispatch` 接口是：

| Input | 含义 |
| --- | --- |
| `operation` | `begin-review` 或 `reconcile` |
| `pr_number` | 一个 open PR number |
| `expected_head_sha` | 本次 run 唯一允许评估的 exact PR head |
| `request_comment_id` | 可选的 evidence 定位 hint |
| `request_review` | `begin-review` 是否发 request，默认 `true` |

这些值只帮助 Action 定位与验证，不提供 verdict。Action step 的 underscore inputs 是
`github_token`、`pr_number`、`expected_head_sha`、`operation`、
`request_comment_id` 与 `request_review`。两份 Action steps 只从受保护 repository
variable `CODEX_REVIEW_GATE_LIMITS_PROFILE` 派生 `limits_profile`；公开 outputs 只有
`execution_health`、`gate_outcome`、`recovery_code` 与 `retry_safe`。Finding counts
只出现在 summary 与 sticky diagnostic，不是 outputs。

## 1. 创建并合并 migration PR

修改 consumer worktree 前，先做只读 preflight：

```bash
REPO=OWNER/REPO
DEFAULT_BRANCH="$(gh repo view "$REPO" \
  --json defaultBranchRef \
  --jq '.defaultBranchRef.name')"
DEFAULT_WORKFLOW_PERMISSIONS="$(gh api \
  "repos/$REPO/actions/permissions/workflow" \
  --jq '.default_workflow_permissions')"
test -n "$DEFAULT_BRANCH"
test "$DEFAULT_WORKFLOW_PERMISSIONS" = read
```

permissions 读取缺失、失败或不是 `read` 时必须停止。修改该 repository setting 不属于
本次安装的隐含授权；应另行取得授权，把 default workflow permissions 设为 read-only，
读回 endpoint 后再重复 preflight。

把 `Joey-Tools/codex-review-gate` 的干净 checkout 记为 `SOURCE_ROOT`，consumer 的
干净 worktree 记为 `TARGET_ROOT`：

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

Helper 会在显式 checkpoint 重新验证 workflow parent 的 object identity 与 access
policy。但这不是 operation-bound filesystem sandbox：恶意 same-UID process 仍可能在
checkpoint 之间 race path-based operation。只在这些 parent 不会被不可信进程并发修改时
运行；遇到 safety failure 不得改用手工复制绕过。

第一条命令预览，第二条逐字复制两份 canonical workflows，并在保留其他 entries 的同时把受管
control-plane block 合并到 `.github/CODEOWNERS` 的最终有效位置。若 helper 报告其他 v1
caller，只检查它列出的路径，并在同一个 migration PR 中移除或停用精确 legacy job。
一个 PR 可以同时移除 v1、安装 v2 与 CODEOWNERS 控制面。

如果仓库当前使用根目录 `CODEOWNERS` 或 `docs/CODEOWNERS`，helper 会停止，避免新建
`.github/CODEOWNERS` 后静默遮蔽旧 policy。请在同一个 migration PR 中把原有 entries
完整移动或合并到 `.github/CODEOWNERS`，再重跑 helper。

审核 consumer diff、运行该仓库自己的验证，但在准备好下述 canonical inventory snapshot
之前不要请求 approval。随后取得 `CONTROL_PLANE_OWNER` 对这个 PR 的独立批准后再合并。
第一次批准是 manual trust-bootstrap gate：PR 使用 base branch 的
CODEOWNERS，而新规则此时还没有进入 base，ruleset 也未启用。合并立即前必须确认 owner
不是 PR author、owner 最新 review 是绑定 current full head SHA 的 `APPROVED`，并在读取
后再次确认 head 未变。以后修改 workflow 或 CODEOWNERS 的 PR 会由 GitHub 强制同一
owner 批准最终 head；push 新 commit 会让旧批准失效。V2 workflow 尚未进入默认分支时，
不要启用 required check。

使用 tracked executable
`$SOURCE_ROOT/scripts/build-legacy-review-gate-inventory.sh`。它精确接收 repository、
expected default branch 和 output path 三个参数，并负责 fail-fast schema validation、
canonical sorting、cleanup 与 digest output。Pre-approval 与 final transaction 必须调用这
同一个 reviewed executable，不得从文档重建实现。请求 owner approval 前执行 helper，并把
canonical JSON 与打印的 SHA-256 一并记录进 approval snapshot：

```bash
APPROVAL_INVENTORY_DIR="$(mktemp -d)"
APPROVAL_INVENTORY="$APPROVAL_INVENTORY_DIR/legacy-inventory.json"
LEGACY_INVENTORY_SHA256="$("$SOURCE_ROOT/scripts/build-legacy-review-gate-inventory.sh" \
  "$REPO" "$DEFAULT_BRANCH" "$APPROVAL_INVENTORY")"
LEGACY_INVENTORY_SHA256="${LEGACY_INVENTORY_SHA256#LEGACY_INVENTORY_SHA256=}"
printf 'LEGACY_INVENTORY_SHA256=%s\n' "$LEGACY_INVENTORY_SHA256"
```

该 inventory 绑定 repository、default branch、每个 matching active/inherited ruleset 的
identity、conditions、enforcement、target 与完整 `bypass_actors`，以及包含全部 parameters 的
完整 matching effective `required_status_checks` rule；它还绑定 classic parent 的完整
required-status object（包括 `strict`）或显式 `null`。Hash 前会排序语义无序的 bypass
actors、required checks、classic contexts/checks 与 conditions `include`/`exclude` sets。
保留 exact-head read 得到的 `MIGRATION_HEAD` 与 owner-approval snapshot，
并让全部 legacy requirements 保持 active 直到 merge。把已记录 digest 从外部传为
`LEGACY_INVENTORY_SHA256`；transaction 不提供默认值。

最终 gate 与 merge 必须处在同一个 fail-fast transaction 中。唯一 mutation 前，它会刷新
legacy inventory、default branch、PR base/head/state、authenticated actor 与完整 owner-review
inventory。使用一个 repository-approved merge method：

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

所有 precondition command 都位于 synchronous merge mutation 前；API、`jq`、`test`、
pagination、parse、actor、base、head、state 或 review 任一失败都会退出，trap 会清理全部
temporary files。REST endpoint 只能即时 merge 或失败（包括 405/409），不会把 PR 入队。
不得使用 `gh pr merge`、auto-merge、merge queue 或 admin bypass。GitHub 仍没有同时覆盖
review state 与 head 的 atomic compare-and-swap，所以 actor 硬校验要求 trusted owner 在
fresh review readback 后立即执行 direct merge；只重读 head 不足以闭环。

只有 merge 后立即重读 current default、exact base/head 与 merged lifecycle 全部成功，才按
另行授权的 plan 删除 inventory 中全部 legacy requirements，并读回 ruleset
与 classic surfaces。这个短暂 staged window 可能继续阻塞新 PR，但不会 fail open；随后才
以 Disabled stage v2、运行 canary、再 activate。

合并后读回 PR，确认确已 merged；刷新默认分支的干净 checkout，再次逐字节比较已安装
workflow 与 canonical template，并读回最终有效的 CODEOWNERS block 与显式 owner。

## 2. 以 Disabled 状态暂存 ruleset

Migration 已在默认分支后，预览并执行远端 staging：

```bash
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER"
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --apply
```

也可以通过 **Settings -> Rules -> Rulesets -> New ruleset -> Import a ruleset** 导入
`templates/codex-gated-repo/rulesets/codex-review-gate.json`。

继续前确认 ruleset：

- 保持 **Disabled**；新建 ruleset 只覆盖 default branch。若 existing 同名 ruleset 已有
  更广 targets，helper 会原样保留其 include/exclude conditions；必须核对并确认每一个额外
  target 都符合预期；
- 要求 expected source **GitHub Actions**（`integration_id: 15368`）发布的
  `codex/github-review-gate`，不接受 “Any source”；
- 要求 branch up to date；
- 要求 Code Owner review，push 后 dismiss stale approvals；新 ruleset 的普通 approving
  review count 为 0，helper 会保留既有更高 count；
- 要求所有 review conversations resolved；
- 阻止 default branch 的 non-fast-forward update；
- `bypass_actors` 明确为空。

Helper 会同时在 effective repository rulesets 与 classic branch protection required
status contexts 中检查 legacy `codex/review-gate`。若其他 active 或 inherited ruleset
仍要求 v1，必须显式移除。若 classic branch protection 仍要求该 context，helper 会 fail
closed 且绝不修改 classic policy；应在 repository settings 中人工移除，读回 classic
protection 后再重跑 helper。Classic-protection response 无法读取或 schema malformed 时是
inconclusive，不能当作 absent。Staging 与 activation 之间的 protection gap 只用于下述
canary。

## 3. 创建并运行独立 canary PR

从已合并的默认分支创建临时分支，做一个无害且可 review 的变更，开 non-draft PR，并记录
PR number 与完整 current head SHA。

通常直接在 PR 发：

```text
@codex review
```

这条路径不会为了创建 request 消耗 Actions minutes。后续满足条件的 Codex bot
`issue_comment` `created` 或 `edited` event 会启动 controller，由它建立严格更新的 full
verifier attempt；若结果只出现在 review 或 reaction，或者需要恢复，再手动 reconcile。

GitHub 把 verifier run/job/CheckRun 记录在 exact PR feature-head SHA 上，而不是
test-merge SHA 上。canonical `pull_request` verifier 仍在 `refs/pull/N/merge` 上执行；Action
内部严格检查 `GITHUB_REF`、`GITHUB_SHA`、event PR head/base/test-merge SHAs 与 fresh PR
read。因此 successful feature-head CheckRun 会在执行语义上绑定 exact current
test-merge。为了避免 idle PR 消耗
minutes，没有 cron 或可写 review event。verifier 在 `opened`、`reopened`、
`synchronize` 与 `ready_for_review` 上启动；controller 与 verifier 使用独立 per-PR
concurrency namespace。若要对同一 head deliberate re-review，先运行 `begin-review`，
读回新 request 并观察严格更新的 verifier attempt。单独发 comment 不会 atomically
invalidate 旧 success。

若 base retarget 后 current exact head/base/test-merge scope 没有 verifier，遵循
`create_verifier_run`：ready PR 先转为 draft 再 mark ready；already-draft PR 直接 mark
ready。确认 current exact head/base/test-merge scope 出现新的 `ready_for_review` verifier 后再
reconcile。rerun 旧 verifier 不是有效 retarget recovery。

base retarget 或检测到 base force-push epoch 后，必须使用
`request_review=true` 的 `begin-review`；等 Codex 在该 canonical request 上直接留下
合格 `+1` 后再 reconcile。GitHub terminal clean payload 不会标明产生它的 request/base
snapshot，因此在这个 recovery mode 中，单独的 later terminal clean 会有意保持
pending。finding 仍会立即阻塞。

需要协调 fresh request 与更新 verifier attempt 时，使用默认 `request_review=true` 的
`begin-review`：

```bash
gh workflow run codex-review-gate-controller.yml \
  --repo OWNER/REPO \
  -f operation=begin-review \
  -f pr_number=PR_NUMBER \
  -f expected_head_sha=FULL_HEAD_SHA \
  -f request_review=true
```

不要增加 feature ref。省略 ref 才会选择默认分支 workflow。Dispatch 后读取新 run：

```bash
gh run list \
  --repo OWNER/REPO \
  --workflow codex-review-gate-controller.yml \
  --event workflow_dispatch \
  --limit 10 \
  --json databaseId,event,headBranch,headSha,status,conclusion,url
```

要求 `event=workflow_dispatch`，且 `headBranch` 等于当前默认分支。不要接受 feature-branch
run。

最终接受 canary 前，即使自动 run 已完成，也要 reconcile exact current head：

```bash
gh workflow run codex-review-gate-controller.yml \
  --repo OWNER/REPO \
  -f operation=reconcile \
  -f pr_number=PR_NUMBER \
  -f expected_head_sha=FULL_HEAD_SHA \
  -f request_review=false
```

已记录 direct request comment ID 时，可以增加可选的 `request_comment_id`；它只是 hint，
Action 仍会检查所有 newer relevant evidence。

完成的 run 会分别报告 execution health 与 gate outcome。任何非 success 情况都必须按
`recovery_code` 与 summary 的 next action 操作。Finding 通常是 healthy gate failure；
unhealthy execution 是恢复问题，不是 finding verdict。`healthy/pending` 同样是 fail-closed：
它表示本次 run 安全地无法授权 success。只有 `recovery_code=wait_provider` 是纯等待；其他
code 都必须先执行 summary 指定的具体动作，再做后续 exact-head reconcile。

超大 PR 只有在 summary 报告 `use_expanded_limits` 时，才设置受保护 repository
variable `CODEX_REVIEW_GATE_LIMITS_PROFILE=expanded`。随后重读 exact head 并运行一次
scoped controller reconcile。manual dispatch 没有 limits-profile 或 numeric override。

最后重新读取 PR、verifier attempt 与 exact feature-head CheckRun，并同时要求：

- PR head 仍是 `FULL_HEAD_SHA`；
- PR base 与 test-merge SHA 未变；
- controller 已建立严格更新的 verifier attempt，且该 exact feature-head SHA 上唯一
  canonical `codex/github-review-gate` CheckRun 是 `success`；
- 该 verifier run 通过 merge-ref environment、event scope 与 fresh PR read 绑定 unchanged
  current test-merge；
- CheckRun expected source 是 GitHub Actions；
- summary 是 `execution_health=healthy` 与 `gate_outcome=success`。

Head 变化后必须为新 head 取得 evidence 并重新 reconcile；不得接受旧 commit 的 success。

## 4. 启用 ruleset 并关闭 canary

只有 exact-head canary 已 pass，才预览并启用：

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

每一次 ruleset write（包括 Disabled staging）之前，helper 都会重新读取 exact
default-branch workflow inventory、CODEOWNERS errors 与指定 owner 的 repository
permission；active write 前还会重新读取 canary lifecycle、base/head/test-merge SHA、
exact verifier run/job/CheckRun 与 collision inventory。Write 后会读回 exact ruleset 与
完整 consumer security snapshot。确认 active
enforcement、相同 GitHub Actions source、strict up-to-date、Code Owner review、push 后
dismiss stale approvals、新 ruleset 的普通 approval count 默认为 0 且不降低既有更高
count、conversation resolution、default-branch non-fast-forward protection，以及显式空
`bypass_actors`。然后关闭 canary、不合并，只删除临时 branch。

默认分支含两份 canonical `@v2` workflows、ruleset active 且完整、closed-unmerged
canary 在 current feature-head SHA 留下 exact successful native CheckRun，且该 run 绑定
unchanged current test-merge 后，安装才算完成。
