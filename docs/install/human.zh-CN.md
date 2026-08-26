# 安装 Codex Review Gate v2

本文面向仓库维护者。[Agent 执行手册](agent.zh-CN.md)把同一套安装流程写成
确定性的执行清单，并不是另一种安装模式。两份指南都使用
`templates/codex-gated-repo/` 下的 canonical assets。

安全 rollout 使用两个 PR：

1. 一个 migration PR 同时移除 v1 caller、安装 canonical v2 workflow；
2. migration 合并后，另开一个无害 canary PR 验证默认分支 workflow 与 ruleset。

Canary 验证完成后关闭、不合并。

## 安装内容

Consumer 安装一个 thin workflow `.github/workflows/codex-review-gate.yml`，并在
`.github/CODEOWNERS` 加入两条最终生效的规则，保护 `/.github/workflows/` 与
`/.github/CODEOWNERS`。Workflow 使用兼容的 floating major：

```yaml
uses: JoeyTeng/codex-review-gate-action@v2
```

必须逐字复制 canonical workflow。Action step 无法定义的 event 与 permission 边界由
wrapper 负责：

- 自动 wake-up 只接受 `issue_comment` 的 `created` 与 `edited`；
- runner 分配前，event sender 与 comment author 都必须精确等于
  `chatgpt-codex-connector[bot]`，GitHub type 必须是 `Bot`；
- 唯一手动入口是 `workflow_dispatch`，每次只处理一个 PR；
- 手动 run 必须使用仓库默认分支上的 workflow；
- API-only job 默认使用 `ubuntu-slim`；仅当该 runner 不可用时，repository Actions
  variable `CODEX_REVIEW_GATE_USE_UBUNTU_LATEST=true` 才选择 `ubuntu-latest`；
- permissions 仅为 `contents: read`、`issues: write`、`pull-requests: read` 与
  `statuses: write`。

默认情况下，普通用户发出的 `@codex review` 只有在 author 当前拥有 `write`、
`maintain` 或 `admin` 权限时，才能建立新的 review generation。若仓库明确接受任意
commenter 的 request，可以把受保护 repository Actions variable 设置为
`CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION=any`；其他任何值都映射为更安全的
`write` policy。这是 wrapper-owned protected configuration，不是 public Action input。
它不会削弱 finding authority：任何合格 Codex finding 仍然阻塞。

Consumer workflow 没有 cron、`repository_dispatch`、宽泛的自动 `pull_request`
reset、自动 `pull_request_review` writer job、runtime GitHub App 或 ledger。唯一 PR
edit 入口是在 runner 前筛选的 default-branch base-retarget reset。每次运行都从选中的
PR 重新构建 evidence。

先选择一个 GitHub user 作为 `CONTROL_PLANE_OWNER`；该账号必须对 consumer repository
拥有 `write`、`maintain` 或 `admin` 权限。Helper 默认使用 `@JoeyTeng`，所有非 Joey
仓库都必须显式换成自己的合格 owner。之所以需要这层独立控制面，是因为 required check
的 `integration_id: 15368` 只标识整个 GitHub Actions App，并不能标识这一份 workflow；
CODEOWNERS 与 Code Owner review 可阻止普通 workflow 变更成为另一个 status writer。

手动 `workflow_dispatch` 接口是：

| Input | 含义 |
| --- | --- |
| `operation` | `begin-review` 或 `reconcile` |
| `pr_number` | 一个 open PR number |
| `expected_head_sha` | 本次 run 唯一允许评估的 exact PR head |
| `request_comment_id` | 可选的 evidence 定位 hint |
| `request_review` | `begin-review` 是否发 request，默认 `true` |
| `limits_profile` | `default` 或 `expanded` |

这些值只帮助 Action 定位与验证，不提供 verdict。Action step 的 underscore inputs 是
`github_token`、`pr_number`、`expected_head_sha`、`operation`、
`request_comment_id`、`request_review` 与 `limits_profile`；公开 outputs 只有
`execution_health`、`gate_outcome`、`recovery_code` 与 `retry_safe`。Finding counts
只出现在 summary 与 sticky diagnostic，不是 outputs。

## 1. 创建并合并 migration PR

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

第一条命令预览，第二条逐字复制 canonical workflow，并在保留其他 entries 的同时把受管
control-plane block 合并到 `.github/CODEOWNERS` 的最终有效位置。若 helper 报告其他 v1
caller，只检查它列出的路径，并在同一个 migration PR 中移除或停用精确 legacy job。
一个 PR 可以同时移除 v1、安装 v2 与 CODEOWNERS 控制面。

如果仓库当前使用根目录 `CODEOWNERS` 或 `docs/CODEOWNERS`，helper 会停止，避免新建
`.github/CODEOWNERS` 后静默遮蔽旧 policy。请在同一个 migration PR 中把原有 entries
完整移动或合并到 `.github/CODEOWNERS`，再重跑 helper。

审核 consumer diff、运行该仓库自己的验证，并取得 `CONTROL_PLANE_OWNER` 对这个 PR 的
独立批准后再合并。第一次批准是 manual trust-bootstrap gate：PR 使用 base branch 的
CODEOWNERS，而新规则此时还没有进入 base，ruleset 也未启用。合并立即前必须确认 owner
不是 PR author、owner 最新 review 是绑定 current full head SHA 的 `APPROVED`，并在读取
后再次确认 head 未变。以后修改 workflow 或 CODEOWNERS 的 PR 会由 GitHub 强制同一
owner 批准最终 head；push 新 commit 会让旧批准失效。V2 workflow 尚未进入默认分支时，
不要启用 required check。

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

- 只覆盖默认分支并保持 **Disabled**；
- 要求 expected source **GitHub Actions**（`integration_id: 15368`）发布的
  `codex/github-review-gate`，不接受 “Any source”；
- 要求 branch up to date；
- 要求 Code Owner review，push 后 dismiss stale approvals；新 ruleset 的普通 approving
  review count 为 0，helper 会保留既有更高 count；
- 要求所有 review conversations resolved；
- 阻止 default branch 的 non-fast-forward update；
- `bypass_actors` 明确为空。

若其他 active 或 inherited ruleset 仍要求 v1 context，先显式解决该 blocker。Staging 与
activation 之间的 protection gap 只用于下述 canary。

## 3. 创建并运行独立 canary PR

从已合并的默认分支创建临时分支，做一个无害且可 review 的变更，开 non-draft PR，并记录
PR number 与完整 current head SHA。

通常直接在 PR 发：

```text
@codex review
```

这条路径不会为了创建 request 消耗 Actions minutes。后续满足条件的 Codex bot
`issue_comment` `created` 或 `edited` event 会启动 workflow；若结果只出现在 review 或
reaction，或者需要恢复，再手动 reconcile。

Commit status 会按 commit SHA 持久存在，不会随 review epoch 自动过期。Commit status
不包含 PR identity；共享同一个 head SHA 的 parallel/duplicate PR 会复用并覆盖同一
context，因此不受支持。为了避免 idle PR 消耗 minutes，workflow 刻意没有宽泛的自动
`pull_request` reset job。canonical workflow 只有一个狭窄的
`pull_request_target` `edited` path：实际 retarget 回 default branch 时会在 runner
allocation 前筛选，并把 unchanged head 上的旧 success 改为 pending；仅 title/body edit
不会启动 runner。若要对已经 success 的同一 head deliberate re-review，先对 exact head
运行 `begin-review`，让旧 success 变成 pending，再建立 fresh request。单独发 comment
不会清除已持久化的 success。

base retarget 或检测到 base force-push epoch 后，必须使用
`request_review=true` 的 `begin-review`；等 Codex 在该 canonical request 上直接留下
合格 `+1` 后再 reconcile。GitHub terminal clean payload 不会标明产生它的 request/base
snapshot，因此在这个 recovery mode 中，单独的 later terminal clean 会有意保持
pending。finding 仍会立即阻塞。

需要协调 pending 与 fresh request 时，使用默认 `request_review=true` 的
`begin-review`：

```bash
gh workflow run codex-review-gate.yml \
  --repo OWNER/REPO \
  -f operation=begin-review \
  -f pr_number=PR_NUMBER \
  -f expected_head_sha=FULL_HEAD_SHA \
  -f request_review=true \
  -f limits_profile=default
```

不要增加 feature ref。省略 ref 才会选择默认分支 workflow。Dispatch 后读取新 run：

```bash
gh run list \
  --repo OWNER/REPO \
  --workflow codex-review-gate.yml \
  --event workflow_dispatch \
  --limit 10 \
  --json databaseId,event,headBranch,headSha,status,conclusion,url
```

要求 `event=workflow_dispatch`，且 `headBranch` 等于当前默认分支。不要接受 feature-branch
run。

最终接受 canary 前，即使自动 run 已完成，也要 reconcile exact current head：

```bash
gh workflow run codex-review-gate.yml \
  --repo OWNER/REPO \
  -f operation=reconcile \
  -f pr_number=PR_NUMBER \
  -f expected_head_sha=FULL_HEAD_SHA \
  -f request_review=false \
  -f limits_profile=default
```

已记录 direct request comment ID 时，可以增加可选的 `request_comment_id`；它只是 hint，
Action 仍会检查所有 newer relevant evidence。

完成的 run 会分别报告 execution health 与 gate outcome。按 `recovery_code` 和 summary 的
next action 操作。Finding 通常是 healthy gate failure；unhealthy execution 是恢复问题，
不是 finding verdict。

超大 PR 只有在 summary 指示时才用 `expanded`：

```bash
gh workflow run codex-review-gate.yml \
  --repo OWNER/REPO \
  -f operation=reconcile \
  -f pr_number=PR_NUMBER \
  -f expected_head_sha=FULL_HEAD_SHA \
  -f request_review=false \
  -f limits_profile=expanded
```

若仓库长期需要该 profile，设置
`CODEX_REVIEW_GATE_LIMITS_PROFILE=expanded`。不要增加 numeric limit inputs。

最后重新读取 PR 与 exact-head status，并同时要求：

- PR head 仍是 `FULL_HEAD_SHA`；
- 该 SHA 上最新 `codex/github-review-gate` 是 `success`；
- status creator 是 `github-actions[bot]`；
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
permission；active write 前还会重新读取 canary lifecycle、base/head 与 exact-head
status。Write 后会读回 exact ruleset 与完整 consumer security snapshot。确认 active
enforcement、相同 GitHub Actions source、strict up-to-date、Code Owner review、push 后
dismiss stale approvals、新 ruleset 的普通 approval count 默认为 0 且不降低既有更高
count、conversation resolution、default-branch non-fast-forward protection，以及显式空
`bypass_actors`。然后关闭 canary、不合并，只删除临时 branch。

默认分支含 canonical `@v2` workflow、ruleset active 且完整、closed-unmerged canary 留下
exact-head successful GitHub Actions status 后，安装才算完成。
