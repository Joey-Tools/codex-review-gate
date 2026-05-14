# Codex Review Gate

语言：[British English (en-GB)](README.md) | [简体中文 (zh-CN)](README.zh-CN.md)

`codex-review-gate` 是一个可复用 GitHub Action，负责提供 deterministic `codex/review-gate` status check。它适用于希望把 required status 保持为 pending 或 failing，直到当前 PR head 的 Codex review output 干净为止的仓库。

目标仓库只需要在 `.github/workflows/codex-review-gate.yml` 保留一个薄 workflow；review state machine 位于这个 action 内。

## 它检查什么

Runner 实现了 event-driven serialized marker flow：

- 通过 repository default branch 上的 `pull_request_target` 运行。
- 把配置的 commit status 写到 PR head SHA；默认是 `codex/review-gate`。
- 当 current-head Codex inline review threads 或 review-body findings 未 resolved 且未 outdated 时失败。
- 用 hidden metadata 维护一个可信 sticky PR state comment。
- 串行维护受控 `@codex review` marker comments。
- 把 Codex reactions 只作为诊断信号。
- 用 scheduled 或 manual resume runs 重试未 ack 或 stalled 的 markers。
- 只有在 active marker 之后出现 Codex top-level completion comment 或 `APPROVED` review，且当前 head 没有 Codex findings 时才通过。
- 如果误开 PR-open automatic review，也只有 active controlled marker 之后的输出能通过最终 current-head validation。

## 文件

- `action.yml`: runner 的 composite action wrapper。
- `src/gate.mjs`: GitHub Actions runner script。
- `src/core.mjs`: 可测试的 state 和 signal helpers。
- `DESIGN.md`: 目标 signal model 和 state machine。

## 高级运行模型

Event-driven review gate 的状态机、自动重试开关、runner minutes 成本模型和手动恢复行为见 [DESIGN.md](DESIGN.md)。

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
      - uses: JoeyTeng/codex-review-gate@v1
        with:
          github-token: ${{ github.token }}
          pull-request: ${{ github.event.inputs.pull_request }}
          event-mode: ${{ vars.CODEX_REVIEW_GATE_EVENT_MODE }}
          codex-bot-logins: ${{ vars.CODEX_REVIEW_GATE_BOT_LOGINS }}
          completion-signal-buffer-seconds: ${{ vars.CODEX_REVIEW_GATE_COMPLETION_SIGNAL_BUFFER_SECONDS }}
```

## 本仓库的自托管 Gate

本 action 仓库也在 `.github/workflows/codex-review-gate.yml` 中为自己的 PR 启用了 `codex/review-gate`。因为该 workflow 是 privileged `pull_request_target` automation，它会 checkout `github.event.repository.default_branch`，再通过 `uses: ./` 调用可信 default branch 上的本地 action；不会运行 PR 提供的 action 代码，也不依赖可移动 release tag。

与任何首次启用一样，引入该 workflow 的 PR 要等 workflow 合入 default branch 后，才能完整验证 `pull_request_target` 路径。

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
| `completion-signal-buffer-seconds` | `60` | Marker 创建后至少等待多少秒，才接受 Codex top-level clean completion comment。设为 `0` 可关闭 buffer。 |
| `event-mode` | empty | Event mode override：精确小写 `standard`、`comment-only` 或 `full`。留空时使用 `CODEX_REVIEW_GATE_EVENT_MODE` 或 `standard`。 |
| `poll-interval-seconds` | `30` | Deprecated compatibility input。Event-driven runs 不轮询。 |
| `bootstrap-grace-seconds` | `60` | Deprecated compatibility input。Event-driven runs 会直接创建 controlled marker。 |
| `codex-bot-logins` | `chatgpt-codex-connector,chatgpt-codex-connector[bot]` | 视为 Codex bot identities 的 GitHub logins，逗号分隔。 |
| `trusted-comment-logins` | `github-actions[bot]` | 可信 gate state 和 marker comments 的 GitHub logins，逗号分隔。 |

## 仓库设置

Workflow 合入 default branch 并至少运行一次后，把 `codex/review-gate` 加到仓库 ruleset 的 required status check。Source 选择 GitHub Actions，因为 status 由 workflow 的 `GITHUB_TOKEN` 写入。

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
- Runner 同时使用 REST pull request comments 和 GraphQL `reviewThreads` metadata，避免把已 resolved 或 outdated 的 Codex inline threads 当成当前 findings。
- Review-body findings 没有可 resolve 的 review threads，所以 runner 通过 `PullRequestReview.commit_id` 和 current-head blob links 匹配它们。
- 当前默认 timeout 是 overall 2 小时、首次 marker ack 5 分钟、ack 退避上限 30 分钟且不超过 marker result timeout、每个 marker result 1 小时。推荐 schedule 示例每 2 小时检查一次 retry deadlines。
