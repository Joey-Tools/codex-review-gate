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
在 predecessor-to-successor generation closure 中，与 successor request 同一时间戳的
liveness 也无法排序，必须保持 predecessor open。
一旦出现第二个物理 request boundary，unbound terminal 就无法证明自己属于新 request，
而不是旧 flight 的延迟结果。没有 base epoch 时，provider terminal evidence 只能闭合
第一个 gap；之后的每个 gap 和新 generation 的 clean authority，都必须来自直接附着在
对应 canonical request 上的合格 `+1`。有 base epoch 时，每个 gap 都必须如此。若旧 gap
已经无法在原始窗口内闭合，必须先区分 physical boundary 与 positive authority：edited、
malformed、wrong-author、denied 或 stale-base request 可以保留为 boundary，但没有
authority。只有每个歧义 predecessor 都显式绑定另一个 full head 时，新 head 才能恢复。
若存在 ordinary、deleted 或其他 unbound predecessor，应新建 replacement PR，只运行
一个 canonical producer；验证 replacement 后关闭旧歧义 PR。
显式 commit-bound progress 直接归入对应 head；所有 unbound progress 都保留在 current
inventory，因为邻近 request timestamp 不能证明来源。edited terminal 还会产生从创建到
terminal revision 的 unbound unknown-activity interval。provider terminal 只有在
predecessor reaction inventory 完整，且从该 terminal 到 successor 没有当前 `eyes` 或
provider activity 时，才能闭合第一个 gap。

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
DEFAULT_BRANCH="$(gh api --hostname github.com \
  "repos/$REPO" \
  --jq '.default_branch')"
DEFAULT_WORKFLOW_PERMISSIONS="$(gh api --hostname github.com \
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

该 inventory 绑定 exact repository slug、numeric repository ID、opaque node ID 与
default branch；每个 matching active/inherited ruleset 的
ID、name、source、enforcement、target、conditions、完整 `bypass_actors` 与完整 `rules`；
包含全部 parameters 的完整 matching effective `required_status_checks` rule；以及 classic
parent 的完整 required-status object（包括 `strict` 与每个 check 的 producer `app_id`）或
显式 `null`。Shell helper 与 runtime 使用同一 Node canonicalizer，因此 approval 与
enforcement 会 hash 完全相同的 bytes。Hash 前会排序语义无序的 bypass actors、required checks、classic
contexts/checks 与 conditions `include`/`exclude` sets。即使仓库没有 legacy requirement，
canonical empty inventory 仍绑定 repository 与 default branch，因此也会得到 digest。API
response 或 schema 不完整属于 inconclusive；任何 digest drift 都 fail closed，不能视为
legacy absent。HTTP success 的空 body 或 JSON `null` 也属于 inconclusive；只有明确识别的
absence response 才会 canonicalize 为 `null`。

保留 exact-head read 得到的 `MIGRATION_HEAD` 与 owner-approved snapshot，并让全部 legacy
requirements 保持 active 直到 merge。把已记录 digest 从外部传为
`LEGACY_INVENTORY_SHA256`；transaction 不提供默认值。下方每次远端 staging/activation 的
preview 与 apply 都必须复用同一个跨进程 baseline，从 Disabled stage、canary、activation
write 一直贯穿 exact Active readback；新 helper process 不会建立新 baseline。

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

  DEFAULT_BRANCH_FRESH="$(gh api --hostname github.com \
    "repos/$REPO" --jq '.default_branch')"
  test "$DEFAULT_BRANCH_FRESH" = "$DEFAULT_BRANCH"
  "$SOURCE_ROOT/scripts/build-legacy-review-gate-inventory.sh" \
    "$REPO" "$DEFAULT_BRANCH_FRESH" "$LEGACY_INVENTORY" > /dev/null
  FRESH_LEGACY_INVENTORY_SHA256="$(node -e '
    const crypto=require("node:crypto"); const fs=require("node:fs");
    process.stdout.write(crypto.createHash("sha256")
      .update(fs.readFileSync(process.argv[1])).digest("hex"));' "$LEGACY_INVENTORY")"
  test "$FRESH_LEGACY_INVENTORY_SHA256" = \
    "${LEGACY_INVENTORY_SHA256:?external approval-snapshot digest is required}"

  gh pr view "$MIGRATION_PR" --repo "github.com/$REPO" \
    --json author,baseRefName,headRefOid,state,isDraft > "$PR_STATE"
  jq -e --arg base "$DEFAULT_BRANCH_FRESH" --arg head "$MIGRATION_HEAD" \
    --arg owner "$CONTROL_PLANE_LOGIN" \
    '.baseRefName == $base and .headRefOid == $head and .state == "OPEN" and (.isDraft | not)
     and (((.author.login // "") | ascii_downcase) != ($owner | ascii_downcase))' \
    "$PR_STATE"
  CURRENT_ACTOR="$(gh api --hostname github.com user --jq '.login')"
  jq -ne --arg actor "$CURRENT_ACTOR" --arg owner "$CONTROL_PLANE_LOGIN" \
    '($actor | ascii_downcase) == ($owner | ascii_downcase)'
  gh api --hostname github.com --paginate --slurp \
    "repos/$REPO/pulls/$MIGRATION_PR/reviews?per_page=100" \
    > "$FINAL_REVIEW_PAGES"
  jq -e --arg owner "$CONTROL_PLANE_LOGIN" --arg head "$MIGRATION_HEAD" \
    '[.[][] | select((((.user.login? // "") | ascii_downcase) == ($owner | ascii_downcase)) and .user.type == "User")]
     | sort_by([.submitted_at, .id]) | last
     | .state == "APPROVED" and ((.commit_id | ascii_downcase) == ($head | ascii_downcase))' \
    "$FINAL_REVIEW_PAGES"

  jq -n --arg sha "$MIGRATION_HEAD" --arg method "$MERGE_METHOD" \
    '{sha:$sha, merge_method:$method}' > "$MERGE_BODY"
  gh api --hostname github.com --method PUT \
    "repos/$REPO/pulls/$MIGRATION_PR/merge" \
    --input "$MERGE_BODY" > "$MERGE_RESPONSE"
  jq -e '.merged == true' "$MERGE_RESPONSE"
  test "$(gh api --hostname github.com "repos/$REPO" --jq '.default_branch')" = \
    "$DEFAULT_BRANCH_FRESH"
  gh pr view "$MIGRATION_PR" --repo "github.com/$REPO" \
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

Merge 后立即重读 current default、exact base/head 与 merged lifecycle 全部成功后，仍须让
inventory 中全部 legacy requirements 保持 active。另建一个 Disabled v2 ruleset，在 legacy
gate 继续阻塞 merge 的状态下运行 canary，再 activate v2 并精确读回完整 Active policy。只有
这个 Active readback 成功后，才可按另行授权的 cleanup 删除 legacy，并读回 ruleset 与
classic 两个 surfaces。短暂双重要求是预期状态；任何“两边都不要求”的窗口都不允许。

合并后读回 PR，确认确已 merged；刷新默认分支的干净 checkout，再次逐字节比较已安装
workflow 与 canonical template，并读回最终有效的 CODEOWNERS block 与显式 owner。

## 2. 以 Disabled 状态暂存 ruleset

Migration 已在默认分支后，预览并执行远端 staging：

```bash
V2_RULESET_NAME="Must Pass Codex Review"
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --expected-legacy-inventory-sha256 \
  "${LEGACY_INVENTORY_SHA256}"
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --expected-legacy-inventory-sha256 \
  "${LEGACY_INVENTORY_SHA256}" \
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

每次 preview 与 apply 都会用同一个 owner-approved digest 比较完整 canonical dual-surface
inventory。Repository、default branch、ruleset policy 或 classic producer binding 的任何
漂移，以及 API/schema 不完整，都属于 inconclusive 并 fail closed。

Helper 会同时在 effective repository rulesets 与 classic branch protection required
status contexts 中检查 legacy `codex/review-gate`。Disabled staging、canary、activation 与
exact Active readback 全程都必须保留这些 active legacy requirements。Helper 允许这个
fail-closed overlap，且绝不修改 classic protection 或 separately managed legacy ruleset。
若 active legacy/incomplete ruleset 已占用选定的 v2 ruleset name，helper 会在任何 write 前
拒绝；请在 staging 前把 `V2_RULESET_NAME` 改成 distinct name，并在 staging、activation 与
final probe 中始终传同一变量。Legacy inventory 无法读取或 schema malformed，或任何变化
使完整 canonical inventory 不再匹配 owner-approved digest 时，都属于 inconclusive，不能
当作 absent。本阶段不得删除任何 legacy requirement。

## 3. 创建并运行独立 canary PR

从已合并的默认分支创建临时分支，做一个无害且可 review 的变更，开 non-draft PR，并记录
PR number 与完整 current head SHA。还要绑定稍后唯一允许删除的 same-repository head
ref；canary 跑完后不得只根据 branch name 重新推断：

```bash
CANARY_HEAD="$(gh api --hostname github.com \
  "repos/$REPO/pulls/$CANARY_PR" --jq '.head.sha')"
CANARY_HEAD_REPO="$(gh api --hostname github.com \
  "repos/$REPO/pulls/$CANARY_PR" --jq '.head.repo.full_name')"
CANARY_HEAD_REF="$(gh api --hostname github.com \
  "repos/$REPO/pulls/$CANARY_PR" --jq '.head.ref')"
test "${#CANARY_HEAD}" -eq 40
test "$CANARY_HEAD_REPO" = "$REPO"
test -n "$CANARY_HEAD_REF"
```

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
read。受保护的 top-level `run-name` 还让 GitHub 把 exact
`codex-review-gate-verifier/<PR>/<current test-merge SHA>` 暴露为 `display_title`；run
唯一的 PR binding 必须携带 current feature head 与 default-branch base SHA。因此
successful feature-head CheckRun 会在执行语义上绑定 exact current test-merge。为了避免 idle PR 消耗
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
  --repo "github.com/$REPO" \
  -f operation=begin-review \
  -f pr_number=PR_NUMBER \
  -f expected_head_sha=FULL_HEAD_SHA \
  -f request_review=true
```

不要增加 feature ref。省略 ref 才会选择默认分支 workflow。Dispatch 后读取新 run：

```bash
gh run list \
  --repo "github.com/$REPO" \
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
  --repo "github.com/$REPO" \
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

Head 变化后先停止并重读 summary 与完整 physical lineage；不得接受旧 commit 的 success，
也不得自动在同一 PR 启动 generation。只有每个歧义 predecessor 都显式绑定不同 full head
时，才能在 new head 继续。若 ordinary、edited、malformed、denied、deleted 或其他 unbound
predecessor 留下不可闭合 gap，必须使用 replacement PR。

## 4. 启用 ruleset 并关闭 canary

只有 exact-head canary 已 pass，才预览并启用：

```bash
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --expected-legacy-inventory-sha256 \
  "${LEGACY_INVENTORY_SHA256}" \
  --activate \
  --canary-pr PR_NUMBER \
  --canary-head FULL_HEAD_SHA
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --expected-legacy-inventory-sha256 \
  "${LEGACY_INVENTORY_SHA256}" \
  --apply \
  --activate \
  --canary-pr PR_NUMBER \
  --canary-head FULL_HEAD_SHA
```

每一次 ruleset write（包括 Disabled staging）之前，helper 都会重新读取 exact
default-branch workflow inventory、CODEOWNERS errors 与指定 owner 的 repository
permission；active write 前还会重新读取 canary lifecycle、base/head/test-merge SHA、
exact verifier run/job/CheckRun、exact canonical `display_title`、唯一 PR head/base
binding 与 collision inventory。Write 后会读回 exact ruleset 与
完整 consumer security snapshot。每条 staging、activation 与 final probe command 都必须
传入已记录的同一个 `V2_RULESET_NAME`。确认 active
enforcement、相同 GitHub Actions source、strict up-to-date、Code Owner review、push 后
dismiss stale approvals、新 ruleset 的普通 approval count 默认为 0 且不降低既有更高
count、conversation resolution、default-branch non-fast-forward protection，以及显式空
`bypass_actors`。

只有 exact Active readback 成功后，才从完整 pre-cleanup security snapshot 派生唯一可接受
的 cleanup state。该 read-only command 首先要求 current legacy inventory 等于原
owner-approved digest；stdout 只含一个 deterministic JSON object：

```bash
POST_CLEANUP_PLAN="$(mktemp)"
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --expected-legacy-inventory-sha256 \
  "${LEGACY_INVENTORY_SHA256}" \
  --derive-post-cleanup-plan > "$POST_CLEANUP_PLAN"
jq . "$POST_CLEANUP_PLAN"
EXPECTED_POST_CLEANUP_SECURITY_SHA256="$(jq -er \
  '.expected_post_cleanup_security_sha256 |
   select(test("^[0-9a-f]{64}$"))' \
  "$POST_CLEANUP_PLAN")"
```

授权 cleanup 前审阅该 plan。它只能删除 `codex/review-gate`。如果这移除了 classic
required-status policy 的最后 item，则该 empty policy 及其 `strict` field 可消失；ruleset
status rule 因而变空时该 rule 可消失，而 dedicated legacy-only ruleset 只有在不剩其他
rule 时才可整体消失。这些是唯一 structural exceptions。Repository/default-head identity、
workflow/CODEOWNERS inventory、owner permission、surviving classic policy 的全部 fields
与 non-legacy checks（包括 `strict`/`app_id`），以及每个 retained ruleset 的 identity、
conditions、bypass actors 与 unrelated rules 都必须精确保留。

只执行该已审阅 plan 作为另行授权的 legacy cleanup；之后使用相同 selected name 与记录的
expected digest 运行只读 post-cleanup closure。它读取两轮完整 security snapshot，要求
两轮完全相同、都等于 expected digest、两个 legacy surfaces 均 clear，并绑定同一 exact
complete Active v2 policy：

```bash
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --verify-post-cleanup \
  --expected-post-cleanup-security-sha256 \
  "${EXPECTED_POST_CLEANUP_SECURITY_SHA256}"
```

Cleanup 后不得重新派生。任何 cleanup/readback/verification failure 或 inconclusive 都必须
保持 v2 Active，只运行 read-only diagnostics，并报告 exact remaining 或 indeterminate
state；不得 disable/rollback v2 来制造 closure。

随后关闭 canary，但不 merge，也不在 close 命令使用 `--delete-branch`。先证明
closed-unmerged PR 仍携带已记录的 head repository、ref 与 OID，再用 Git exact-OID lease
让 deletion 与最后一次 remote-ref comparison 保持 atomic：

```bash
(
  set -euo pipefail
  trap 'printf "%s\n" "Canary cleanup did not prove completion. Do not issue an unconditional delete; inspect and report the exact PR/ref scope." >&2' ERR

  gh pr close "$CANARY_PR" --repo "github.com/$REPO"
  CANARY_CLOSED_STATE="$(gh api --hostname github.com \
    "repos/$REPO/pulls/$CANARY_PR")"
  jq -e \
    --arg repo "$CANARY_HEAD_REPO" \
    --arg ref "$CANARY_HEAD_REF" \
    --arg sha "$CANARY_HEAD" \
    '.state == "closed" and .merged_at == null and
     .head.repo.full_name == $repo and .head.ref == $ref and .head.sha == $sha' \
    <<< "$CANARY_CLOSED_STATE" > /dev/null

  CANARY_REMOTE="https://github.com/$CANARY_HEAD_REPO.git"
  REMOTE_CANARY_HEAD="$(git ls-remote --refs "$CANARY_REMOTE" \
    "refs/heads/$CANARY_HEAD_REF" |
    awk 'NR == 1 { print $1 } END { if (NR != 1) exit 1 }')"
  test "$REMOTE_CANARY_HEAD" = "$CANARY_HEAD"
  git push \
    --force-with-lease="refs/heads/$CANARY_HEAD_REF:$CANARY_HEAD" \
    "$CANARY_REMOTE" \
    ":refs/heads/$CANARY_HEAD_REF"
  POST_DELETE_REMOTE_CANARY="$(git ls-remote --refs "$CANARY_REMOTE" \
    "refs/heads/$CANARY_HEAD_REF")"
  test -z "$POST_DELETE_REMOTE_CANARY"
)
```

PR identity、remote OID 或 lease 不匹配时立即停止并报告，保持 branch 不动；不得用
unconditional delete 代替 leased deletion。Leased push 前发现 mismatch 时 branch 保持
不动；post-push read failure 时 deletion outcome 为 unknown。

默认分支含两份 canonical `@v2` workflows、ruleset active 且完整、两个 legacy surfaces
都已读回不含 `codex/review-gate`，且 closed-unmerged canary 在 current feature-head SHA
留下 exact successful native CheckRun、该 run 绑定 unchanged current default-branch
base/test-merge 的 canonical run-name receipt 与 PR binding 后，安装才算完成。
