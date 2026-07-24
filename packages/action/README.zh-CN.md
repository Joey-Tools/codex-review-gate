# Codex Review Gate

语言：[British English (en-GB)](README.md) | [简体中文 (zh-CN)](README.zh-CN.md)

## 快速开始

1. 把 [Workflow 用法](#workflow-用法) 中的 workflow 复制到 `.github/workflows/codex-review-gate.yml`。
2. 使用 `JoeyTeng/codex-review-gate-action@v1`，合入 default branch 后再开一个后续测试 PR。
3. 确认 `codex/review-gate` 行为符合预期后，把它加入 required status checks。恢复和排障 recipes 见 [cookbook](COOKBOOK.zh-CN.md)。

`codex-review-gate` 是一个可复用 GitHub Action，负责提供 deterministic `codex/review-gate` status check。它适用于希望把 required status 保持为 pending 或 failing，直到当前 PR head 的 Codex review output 干净为止的仓库。

目标仓库只需要在 `.github/workflows/codex-review-gate.yml` 保留一个薄 workflow；review state machine 位于这个 action 内。

## 生成式 AI 提醒

> [!NOTE]
> 这个 action 会请求并评估 Codex 生成式 AI review output。它会保持受控 `@codex review` marker comments 最小化，以便 command parsing 更可靠；请求 review 时，会把此 disclosure 写入 GitHub Actions step summary。Codex 可能会在 pull request 中回复 AI-generated comments 或 reviews。在把 AI-generated output 用于安全性、正确性或合并决策前，请先人工 review 和验证。
>
> Action 本身不会执行 pull request 代码。它只协调 GitHub comments、reviews、reactions 和 commit statuses，让仓库维护者可以把 Codex review 作为 required branch-protection signal。

## 它检查什么

Runner 实现了 event-driven serialized marker flow：

- 通过 repository default branch 上的 `pull_request_target` 运行。
- 把配置的 commit status 写到 PR head SHA；默认是 `codex/review-gate`。
- 只有 latest accepted Codex terminal result 明确绑定 current head、结果为 clean、由 trusted marker 或 recovery lineage 授权，且历史上所有 thread-backed Codex findings 均已 resolved 时才通过。
- 分开处理 `isOutdated` 和 `isResolved`。Outdated 但 unresolved 的 thread 仍会阻塞 gate。
- 通过精确 repository 和 full-SHA blob links 识别没有 thread 的 top-level finding comments；同一或更新 head 上更晚的 accepted clean result 会 supersede 这些 findings。
- 验证官方 provider identity，并把 reviews、inline comments 和 top-level results 绑定到其 reviewed commit。
- 只通过封闭的 provider grammar 接受 clean result；finding-shaped content 的优先级高于看似 clean 的 lead 或 `APPROVED` state。
- 对 configured provider 以 `Codex Review` 开头且可带 optional Markdown heading 和 emoji 的 comment，先作为宽泛 terminal candidate。Exact one-line `in progress` / `still in progress` message 会被忽略，末尾可以是句点，或冒号加 1–160 个 metadata 字符；较新的未知 candidate（例如 `completed`）则按 malformed/fail-closed 处理，而不会静默忽略。
- 每次 reconciliation 都重新构建完整 evidence snapshot。历史 `pending`、`error`，以及更早的 API、分页、身份或 commit 解析不完整结果只作审计，不会成为 sticky blockers。
- 把每个 PR 的 evidence work 限制为跨 snapshots 和 retries 共享的 64 MiB 与 1,024 次 fetch attempts；同时限制每个 response 流式读取最多 8 MiB、每个 snapshot 最多 20,000 items，以及 HTTP 和 review-thread 补全各最多四路并发。
- 用 hidden metadata 维护一个可信 sticky PR state comment。
- 串行维护受控 `@codex review` marker comments。
- 保持受控 marker comments 最小化，并把生成式 AI review 提示写入 GitHub Actions step summary。
- 把 Codex reactions 只作为诊断信号。
- 用 scheduled 或 manual resume runs 重试未 ack 或 stalled 的 markers。
- 当前 reconciliation 无法完整加载或校验所需 evidence 时 fail closed。暂时性读取重试耗尽写入 `pending`；确定性的 provider identity、schema 或 commit 冲突写入 `error`；两者都会使 workflow 失败。
- 如果 otherwise clean 的 current-head result 缺少 active-marker、精确 passed-marker reassertion 或 failed-findings recovery lineage 授权，则主动降为 `pending`。
- 写入 success 前，先缓存同一 context 的 newest live status 及其 producer，再验证 PR lifecycle 和 head，加载 final complete snapshot，并在需要时执行有界 whole-snapshot orphan reload；之后不再读取 status，只做 deduplication，并在需要时立即 POST success。
- 只有同一 context 的 newest record 已是目标 state，且 producer exact 为 `github-actions[bot]` / `Bot` 时才去重；external 或缺失 producer 不能让 gate 回退采用更旧的 trusted status。
- 只有 v1.2 passed marker 的 exact legacy result identity、trusted live marker、baseline 与当前 strict clean artifact 全部匹配时才安全升级；否则要求 fresh marker。
- 提供狭窄的 legacy `failed_findings` recovery：维护者 resolve 所有 thread-backed Codex findings 后，只有与 selected same-head clean result 精确匹配的 `issue_comment` event 才可使用；compatibility inputs 决定能否复用同一个 clean，或必须等待更新结果。
- 如果误开 PR-open automatic review，也只有 active controlled marker 之后的输出能通过最终 current-head validation。

## 文件

- `action.yml`: runner 的 composite action wrapper。
- `src/gate.mjs`: GitHub Actions runner script。
- `src/core.mjs`: 可测试的 state 和 signal helpers。
- `DESIGN.md` / `DESIGN.zh-CN.md`: 目标 signal model、state machine 和 GHA 成本模型。
- `COOKBOOK.md` / `COOKBOOK.zh-CN.md`: 正常使用路径和 failure recovery recipes。

## 高级运行模型

Event-driven review gate 的状态机、自动重试开关、**GHA 成本模型 (cost model)** 和恢复行为见 [DESIGN.zh-CN.md](DESIGN.zh-CN.md)。操作 recipes 见 [COOKBOOK.zh-CN.md](COOKBOOK.zh-CN.md)。

高级设计中，需要在 runner 分配前生效的控制项应使用 repository 或 organization variables。例如，`CODEX_REVIEW_GATE_AUTO_RETRY=false` 可以在 job `if` 层跳过 scheduled retry job。Runtime `env` 仍可用于 job 启动后的 action 行为兼容，但不能阻止 GitHub Actions 分配 runner。

Workflow 示例默认使用 `ubuntu-slim`。如果要使用 self-hosted runner，把 `CODEX_REVIEW_GATE_RUNNER_LABELS` 设成 JSON array，例如 `["self-hosted","linux","x64","codex-review-gate"]`。

## Workflow 用法

```yaml
name: Codex Review Gate

on:
  pull_request_target:
    types: [opened, reopened, synchronize, ready_for_review]
  issue_comment:
    types: [created]
  pull_request_review:
    types: [submitted]
  pull_request_review_comment:
    types: [created]
  schedule:
    - cron: "0 */2 * * *"
  workflow_dispatch:
    inputs:
      pull_request:
        description: Optional pull request number to gate
        required: false
        type: string

permissions:
  contents: read
  issues: write
  pull-requests: write
  statuses: write

concurrency:
  group: codex-review-gate-${{ github.repository }}
  cancel-in-progress: false

jobs:
  codex-review-gate:
    name: codex/review-gate runner
    if: >-
      ${{
        (github.event_name != 'schedule' || vars.CODEX_REVIEW_GATE_AUTO_RETRY != 'false') &&
        (github.event_name != 'pull_request_target' ||
          github.event.pull_request.user.login != 'dependabot[bot]') &&
        (github.event_name != 'issue_comment' ||
          github.event.issue.user.login != 'dependabot[bot]') &&
        (github.event_name != 'pull_request_review' ||
          github.event.pull_request.user.login != 'dependabot[bot]') &&
        (github.event_name != 'pull_request_review_comment' ||
          github.event.pull_request.user.login != 'dependabot[bot]') &&
        (github.event_name != 'issue_comment' ||
          (github.event.issue.pull_request &&
            (contains(format(',chatgpt-codex-connector,chatgpt-codex-connector[bot],{0},',
              vars.CODEX_REVIEW_GATE_BOT_LOGINS), format(',{0},', github.event.comment.user.login)) ||
             contains(format(',chatgpt-codex-connector,chatgpt-codex-connector[bot],{0},',
              vars.CODEX_REVIEW_GATE_BOT_LOGINS), format(', {0},', github.event.comment.user.login))))) &&
        (github.event_name != 'pull_request_review' ||
          (vars.CODEX_REVIEW_GATE_EVENT_MODE != 'comment-only' &&
            github.event.pull_request.head.repo.full_name == github.event.pull_request.base.repo.full_name &&
            (contains(format(',chatgpt-codex-connector,chatgpt-codex-connector[bot],{0},',
              vars.CODEX_REVIEW_GATE_BOT_LOGINS), format(',{0},', github.event.review.user.login)) ||
             contains(format(',chatgpt-codex-connector,chatgpt-codex-connector[bot],{0},',
              vars.CODEX_REVIEW_GATE_BOT_LOGINS), format(', {0},', github.event.review.user.login))))) &&
        (github.event_name != 'pull_request_review_comment' ||
          (vars.CODEX_REVIEW_GATE_EVENT_MODE == 'full' &&
            github.event.pull_request.head.repo.full_name == github.event.pull_request.base.repo.full_name &&
            (contains(format(',chatgpt-codex-connector,chatgpt-codex-connector[bot],{0},',
              vars.CODEX_REVIEW_GATE_BOT_LOGINS), format(',{0},', github.event.comment.user.login)) ||
             contains(format(',chatgpt-codex-connector,chatgpt-codex-connector[bot],{0},',
              vars.CODEX_REVIEW_GATE_BOT_LOGINS), format(', {0},', github.event.comment.user.login)))))
      }}
    runs-on: ${{ fromJSON(vars.CODEX_REVIEW_GATE_RUNNER_LABELS || '["ubuntu-slim"]') }}
    timeout-minutes: 15
    steps:
      - uses: JoeyTeng/codex-review-gate-action@v1
        with:
          github-token: ${{ github.token }}
          pull-request: ${{ github.event.pull_request.number || github.event.issue.number || github.event.inputs.pull_request }}
          head-sha: ${{ github.event.pull_request.head.sha || '' }}
          event-mode: ${{ vars.CODEX_REVIEW_GATE_EVENT_MODE }}
          codex-bot-logins: ${{ vars.CODEX_REVIEW_GATE_BOT_LOGINS }}
          completion-signal-buffer-seconds: ${{ vars.CODEX_REVIEW_GATE_COMPLETION_SIGNAL_BUFFER_SECONDS }}
```

## Inputs

| Input | 默认值 | 说明 |
| --- | --- | --- |
| `github-token` | required | 用于读取 PR review state、创建 comments、写 commit statuses 的 token。 |
| `pull-request` | empty | 要 gate 的 pull request number。留空时从 event payload 路由，或扫描 open PR。 |
| `head-sha` | empty | Deprecated compatibility input。Event-driven runs 会从 GitHub 读取当前 PR head。 |
| `status-context` | `codex/review-gate` | Gate 写入的 commit status context。 |
| `state-marker` | `codex-review-gate-state` | Sticky state comment 使用的 hidden HTML marker。 |
| `marker-comment-marker` | `codex-review-gate-marker` | Controlled Codex request comments 使用的 hidden HTML marker。 |
| `max-wait-seconds` | `7200` | Fail closed 前的整体最大等待时间。 |
| `marker-timeout-seconds` | `3600` | 已 ack marker 等待结果的时间，超时后重试。 |
| `marker-ack-timeout-seconds` | `300` | Codex ack marker 前的初始等待时间。 |
| `marker-ack-timeout-max-seconds` | `1800` | 未 ack marker 指数退避等待上限。 |
| `completion-signal-buffer-seconds` | `30` | Deprecated 但在 v1 仍生效的 compatibility input。Issue-comment clean result 除了 exact commit binding，还必须比 active marker 晚该 buffer。 |
| `failed-findings-recovery` | empty | Deprecated 但在 v1 仍生效的 switch，用于从 `failed_findings` 进入狭窄的 same-head、no-active-marker recovery。留空默认启用；`false` 关闭该路径。 |
| `failed-findings-recovery-mode` | empty | Deprecated 但在 v1 仍生效。`head` 可在 findings resolved 后复用同一个 qualifying clean；`fresh` 要求 clean 晚于已记录的 rejected recovery attempt。 |
| `event-mode` | empty | Event mode override：精确小写 `standard`、`comment-only` 或 `full`。留空时使用 `CODEX_REVIEW_GATE_EVENT_MODE` 或 `standard`。 |
| `poll-interval-seconds` | `30` | Deprecated compatibility input。Event-driven runs 不轮询。 |
| `bootstrap-grace-seconds` | `60` | Deprecated compatibility input。Event-driven runs 会直接创建 controlled marker。 |
| `bootstrap-timeout-seconds` | `3600` | Deprecated compatibility input。Bootstrap 会在 grace period 后关闭，并启动 controlled marker。 |
| `codex-bot-logins` | `chatgpt-codex-connector,chatgpt-codex-connector[bot]` | 视为 Codex bot identities 的 GitHub logins，逗号分隔。 |
| `trusted-comment-logins` | `github-actions[bot]` | 可信 gate state 和 marker comments 的 GitHub logins，逗号分隔。 |

## 仓库设置

Workflow 合入 default branch 并至少运行一次后，把 `codex/review-gate` 加到仓库 ruleset 的 required status check。Source 选择 GitHub Actions，因为 status 由 workflow 的 `GITHUB_TOKEN` 写入。

新仓库如果希望预装 gate workflow，可以直接从语言无关 GitHub template repository
`Joey-Tools/codex-gated-repo-template` 开始。源码仓库
`JoeyTeng/codex-review-gate` 也提供 `templates/codex-gated-repo` 和默认 dry-run
的 bootstrap helper，用于创建或更新 required repository ruleset：

```bash
node scripts/bootstrap-codex-review-gate.mjs --repo OWNER/REPO
node scripts/bootstrap-codex-review-gate.mjs --repo OWNER/REPO --apply
```

推荐启用顺序：

1. 先把 workflow 合入 repository default branch。
2. 再开一个后续测试 PR。
3. 确认 workflow 会在 `opened` 和 `synchronize` 时创建 current-head marker comment。
4. 确认 gate 能按当前 runner 实现通过或失败。
5. 再把 `codex/review-gate` 加到 ruleset required status checks。

不要在 workflow 进入 protected default branch 前就要求 `codex/review-gate`。引入 workflow 的第一个 PR 无法完整自测 `pull_request_target` 路径，因为 GitHub Actions 会从 repository default branch 读取该 workflow。

## 运行注意事项

- Workflow 不执行 PR 代码。
- Workflow token 应同时具备 `issues: write` 和 `pull-requests: write`，这样才能创建 PR conversation comments。
- 为了让信号最干净，建议关闭 Codex automatic review-on-push，只让 gate marker comment 触发 current-head review。
- Runner 必须完整分页读取 REST comments、reviews、inline comments 和 GraphQL review threads，之后才可能通过。
- 官方 REST evidence 必须来自 accepted Bot identity。Top-level issue comments 默认还必须来自官方 `chatgpt-codex-connector` GitHub App。
- REST evidence IDs 必须是 positive safe integers；GraphQL opaque ID 与 `fullDatabaseId` 必须使用 canonical string form。Duplicate provider、review、inline-comment 或 thread identities 都会 fail closed，包括 resolved threads。
- Reviews 通过完整 `PullRequestReview.commit_id` 绑定。Inline comments 通过 parent review 和 `original_commit_id` 绑定，不使用 GitHub 重定位后会变化的 `commit_id`。
- Inline comment 完成 reconciliation 后，其 `COMMENTED` parent 可以使用正文中不带 blob link 的封闭官方 inline-review wrapper。Wrapper 的 reviewed-commit marker 仍必须匹配 parent 的完整 `commit_id`；未知 parent body 继续 fail closed。
- Top-level clean comments 通过 reviewed-commit marker 绑定。短 marker 必须经 repository commit API 唯一解析为完整 current-head SHA。
- 封闭的 clean grammar 接受 exact issue-comment lead，并只允许以下 observed provider taglines：无 tagline、`Nice work!`、`Chef's kiss.`、`What shall we delve into next?`、`Already looking forward to the next diff.`、`Keep them coming.`、`Keep them coming!`、`:rocket:`、`:tada:`、`Swish.`、`Another round soon, please!`、`Breezy!`、`Can't wait for the next one!`、`More of your lovely PRs please.`、`Bravo.`、`Swish!`、`Keep it up!`、`Delightful!`、`Hooray!`、`You're on a roll.` 或 `:+1:`；之后必须有且仅有一行 reviewed-commit，并且只能没有 suffix 或带 exact official disclosure。`APPROVED` review 必须为空、exact `Looks good.`，或有唯一的 exact final `No findings.`，其前面可以有至多一行、最多 240 个字符的 summary。该 summary 必须以 exact `Coverage:` 或 `Review coverage:` 开头，后接以逗号和/或 `and` 分隔的 backtick-wrapped identifier/path tokens；token 只能匹配 `[A-Za-z0-9_./:@+-]+`，末尾只可选一个句点。整个 normalized target 若 exact 等于 `P0`–`P3`、`S0`–`S3`、`critical`、`high`、`medium`、`low`、`finding`、`findings`、`blocker`、`blocking`、`found`、`detected`、`data-loss` 或 `auth-bypass`，则拒绝；这些词出现在真实 path 或 identifier segment 中时不会被 blanket 拒绝。Verb-led 和其他 prose 均不接受。Finding signals 始终优先。
- Review-body 和没有 thread 的 top-level findings 必须使用 exact `github.com`、被 gate 的 owner/repository 和 full commit SHA links。当前格式未知或冲突时 fail closed。
- 期待 success 前，应 resolve 所有 thread-backed Codex findings；仅 `isOutdated` 不表示 resolved。同一 head 上更晚的 accepted clean result 可以 supersede 没有 thread 的 top-level finding。
- Sticky state 和 status history 只用于 orchestration、审计和幂等。Rerun 会重建当前 evidence，并可在更晚但 stale 的 `pending` 或 `error` status 之后重新写入 `success`。
- Optional status-deduplication GET 使用独立的 best-effort 上限：每页 100 statuses、最多 10 页或 1,000 items、每个 response 1 MiB、总计 4 MiB、16 次 fetch attempts。它会先选择同一 context 的第一条（newest）record，再校验 producer identity；失败或超限只记为 `readFailed`，不污染 review evidence，并使 action 直接 POST 已计算的 status。
- Review-evidence budget failure 会广播 abort active evidence requests。并发 loads 出现不同 failure 时，确定性的 non-`pending` error（包括 schema 或 identity conflict）优先于 budget 或 transient `pending`。
- Retryable REST/GraphQL response 会遵守不超过 10 秒的合法 `Retry-After`。更长 delay 立即停止，缺失或 malformed value 使用有界 fallback retries；该 header 不会扩展现有 retry-safe method/status 集合。
- 旧 short-SHA clean result 只在判定旧 unthreaded finding 是否被 supersede 时惰性解析。
- Evidence-budget exhaustion 属于暂时性不完整：action 写入 `pending` 并以非零状态退出。确定性的 provider schema、identity 或 commit-binding 冲突写入 `error`，也以非零状态退出。
- 当前默认 timeout 是 overall 2 小时、首次 marker ack 5 分钟、ack 退避上限 30 分钟且不超过 marker result timeout、每个 marker result 1 小时。推荐 schedule 示例每 2 小时检查一次 retry deadlines。

## 反馈和报告

使用 [GitHub issues](https://github.com/JoeyTeng/codex-review-gate-action/issues) 报告 action bug、异常 gate 行为、文档缺口或 Marketplace listing 问题。如果 pull request 收到有问题的 AI-generated review content，请先使用 GitHub 对该 comment 或 review 的正常报告和反馈工具；如果它和本 action 的 gate 行为有关，再在 issue 中附上链接。

## Source 和开发

这个仓库是 Marketplace release package。开发、CI 和 self-gating workflows 维护在 [JoeyTeng/codex-review-gate](https://github.com/JoeyTeng/codex-review-gate)。
