# Codex Review Gate

语言：[British English (en-GB)](README.md) | [简体中文 (zh-CN)](README.zh-CN.md)

`codex-review-gate` 是一个可复用 GitHub Action，负责提供 deterministic `codex/review-gate` status check。它适用于希望把 required status 保持为 pending 或 failing，直到当前 PR head 的 Codex review output 干净为止的仓库。

目标仓库只需要在 `.github/workflows/codex-review-gate.yml` 保留一个薄 workflow；review state machine 位于这个 action 内。

## 它检查什么

Runner 实现了 reaction-driven serialized marker flow：

- 通过 repository default branch 上的 `pull_request_target` 运行。
- 把配置的 commit status 写到 PR head SHA；默认是 `codex/review-gate`。
- 当 current-head Codex inline review threads 或 review-body findings 未 resolved 且未 outdated 时失败。
- 用 hidden metadata 维护一个可信 sticky PR state comment。
- 把 PR-open automatic review output 只当作第一轮 baseline。
- 串行维护受控 `@codex review` marker comments。
- 把 Codex `eyes` reactions 只视为 liveness。
- 对未被 ack 的 marker 在 300 秒后重试，并使用指数退避，最高封顶 1800 秒且不超过 marker result timeout。
- 只有在 active marker baseline 之后出现新的 Codex PR-body `+1` reaction identity 或 Codex top-level completion comment，且当前 head 没有 Codex findings 时才通过。
- 对未变化的旧 `+1` reactions 保持 pending 或 stalled，不复用它们。

## 文件

- `action.yml`: runner 的 composite action wrapper。
- `src/gate.mjs`: GitHub Actions runner script。
- `src/core.mjs`: 可测试的 state 和 signal helpers。
- `DESIGN.md`: 目标 signal model 和 state machine。

## Workflow 用法

```yaml
name: Codex Review Gate

on:
  pull_request_target:
    types: [opened, reopened, synchronize, ready_for_review]
  workflow_dispatch:
    inputs:
      pull_request:
        description: Pull request number to gate
        required: true
        type: number

permissions:
  contents: read
  issues: write
  pull-requests: write
  statuses: write

concurrency:
  group: codex-review-gate-${{ github.event.pull_request.number || github.event.inputs.pull_request || github.run_id }}
  cancel-in-progress: true

jobs:
  codex-review-gate:
    name: codex/review-gate runner
    runs-on: ubuntu-latest
    timeout-minutes: 130
    steps:
      - uses: JoeyTeng/codex-review-gate@v1
        with:
          github-token: ${{ github.token }}
          pull-request: ${{ github.event.pull_request.number || github.event.inputs.pull_request }}
          head-sha: ${{ github.event.pull_request.head.sha }}
```

## Inputs

| Input | 默认值 | 说明 |
| --- | --- | --- |
| `github-token` | required | 用于读取 PR review state、创建 comments、写 commit statuses 的 token。 |
| `pull-request` | required | 要 gate 的 pull request number。 |
| `head-sha` | empty | 期望的 PR head SHA。`workflow_dispatch` lookup 可留空。 |
| `status-context` | `codex/review-gate` | Gate 写入的 commit status context。 |
| `state-marker` | `codex-review-gate-state` | Sticky state comment 使用的 hidden HTML marker。 |
| `marker-comment-marker` | `codex-review-gate-marker` | Controlled Codex request comments 使用的 hidden HTML marker。 |
| `max-wait-seconds` | `7200` | Fail closed 前的整体最大等待时间。 |
| `marker-timeout-seconds` | `3600` | 已 ack marker 等待结果的时间，超时后重试。 |
| `marker-ack-timeout-seconds` | `300` | Codex ack marker 前的初始等待时间。 |
| `marker-ack-timeout-max-seconds` | `1800` | 未 ack marker 指数退避等待上限。 |
| `poll-interval-seconds` | `30` | GitHub PR review signals 的轮询间隔。 |
| `bootstrap-grace-seconds` | `60` | PR-open automatic Codex review signals 的初始 baseline 静默窗口。 |
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
- 当前默认 timeout 是 overall 2 小时、首次 marker ack 5 分钟、ack 退避上限 30 分钟且不超过 marker result timeout、每个 marker result 1 小时、bootstrap grace 60 秒。
