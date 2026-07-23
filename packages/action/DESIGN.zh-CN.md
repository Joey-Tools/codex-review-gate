# Codex Review Gate 高级设计

语言：[British English (en-GB)](DESIGN.md) | [简体中文 (zh-CN)](DESIGN.zh-CN.md)

## 目标

`codex/review-gate` 把受控 `@codex review` 请求转换成 deterministic commit status，并可被 branch protection 要求。只有 latest accepted Codex terminal result 为 clean、明确绑定当前 PR head，且历史上所有 thread-backed Codex findings 均已 resolved 时，gate 才会通过。

## Evidence Reconciliation

每次运行都会重新构建所需 GitHub evidence，而不会把 sticky state comment 或
commit-status history 当作判定来源。

结果优先级如下：

1. 当前 evidence snapshot 经过有界重试后仍不完整时，不得通过。暂时性的 API 或分页
   重试耗尽写入 `pending`；确定性的 provider identity、schema 或 commit 冲突写入
   `error`。两种结果都会使 workflow 失败。
2. 历史上任一 thread-backed Codex finding 仍 unresolved 时，写入 `failure`。
   `isOutdated` 绝不能代替 `isResolved`。
3. 所有 thread-backed findings 均已 resolved，且当前 head 的 latest accepted terminal
   result 为 clean 时，写入 `success`。
4. 当前 head 没有 accepted clean result 时，在 marker workflow 继续运行期间保持
   `pending`。

更早的 API 读取不完整、分页失败、无法识别的身份、commit 解析失败、`pending` status
或 `error` status 都只属于审计历史，不会覆盖更新且完整的 current-head clean result。
反过来，如果比 accepted clean result 更晚的 terminal-looking provider artifact 无法
通过身份、schema 或 commit binding 校验，即使存在较早的 clean result，当前运行仍
无法得出结论。

没有 thread 的 top-level issue-comment findings 不具备 GitHub resolution flag。它们会
保持 active，直到同一或更新 head 上更晚的 accepted clean result supersede 它们。

写入 `success` 前，action 会重新读取 PR lifecycle 和 head、选中的 terminal artifact，
以及完整分页的 findings snapshot。Latest live status 只用于避免重复写入；如果该读取
失败，action 仍会发布重新计算的 status；如果 live status 和计算结果不同，action 会
重新写入计算结果。

## 生成式 AI 提示

受控 marker comment 会刻意保持为最小的 `@codex review` command 加 hidden gate metadata，以便 Codex GitHub integration 可靠解析。Workflow 发布受控 marker 时，会改在 GitHub Actions step summary 中写出可见提示：workflow 正在请求 Codex 生成式 AI review，Codex 可能在 PR 中发布 AI 生成的 comments 或 reviews，维护者在把这些输出用于安全性、正确性或 merge 决策前，应先进行人工核验。

Gate 是 event-driven 的。Workflow runs 会创建 markers、triage Codex signals、恢复已存储状态，或处理 retry deadlines。它们不需要在 Codex review PR 时一直占用 runner。

## Workflow 形状

推荐 workflow 监听：

- `pull_request_target` 的 `opened`、`reopened`、`ready_for_review` 和 `synchronize`
- `issue_comment` 的 `created`
- `pull_request_review` 的 `submitted`
- `schedule` 用于自动 retry scans
- `workflow_dispatch` 用于手动恢复

`pull_request_review_comment` 是可选项。它属于 `full` event mode，适合希望最快 triage inline findings，并接受一个有大量 inline comments 的 PR 可能触发更多 workflow runs 的仓库。

Workflow 必须运行可信 default branch 上的 action code。它不能在 `pull_request_target` events 中 checkout 或执行 PR 提供的代码。

Workflow 应使用一个 repository-wide concurrency group，并设置 `cancel-in-progress: false`。Scheduled scans 可以修改任何 open PR，所以它们不能和 PR-specific Codex signal runs 并发运行。

## 配置控制项

Repository 和 organization variables 是需要在 runner 启动前影响 workflow routing 的选项的首选控制面。Runtime environment variables 仍作为兼容输入接受，但只能在 runner 已经启动后生效。

### `CODEX_REVIEW_GATE_AUTO_RETRY`

把这个 repository 或 organization variable 设为 `false`，即可禁用 scheduled retry work：

```yaml
jobs:
  codex-review-gate:
    if: ${{ github.event_name != 'schedule' || vars.CODEX_REVIEW_GATE_AUTO_RETRY != 'false' }}
```

如果目标是避免为 scheduled retries 分配 runner，这必须是 `vars` 值。普通 workflow 或 job `env` 可以被 action 在 job 启动后读取，但不能阻止 scheduled job 被发送到 runner。

### `CODEX_REVIEW_GATE_EVENT_MODE`

`CODEX_REVIEW_GATE_EVENT_MODE` 可以作为 repository variable、organization variable 或 workflow/job environment variable 提供。如果两者都提供，workflow 应把最明确的 runtime value 传给 action。

支持的模式：

- `standard`: 默认值。处理 Codex top-level comments 和 submitted pull request reviews。
- `comment-only`: 只把 Codex top-level comments 当作 completion signals。Codex findings 仍会通过让 status 保持 pending 来阻塞 branch protection，直到 scheduled 或 manual scan 评估它们。
- `full`: 处理 Codex top-level comments、submitted pull request reviews 和 individual pull request review comments。

这些值是精确的小写字符串，这样 workflow-level routing 和 action runtime validation 能保持一致。

### `CODEX_REVIEW_GATE_BOT_LOGINS`

当 Codex bot identity 和默认值不同时，可以提供 `CODEX_REVIEW_GATE_BOT_LOGINS` repository 或 organization variable。示例 workflow 在 job-level event filters 中使用这个 `vars` 值，让自定义 bot comments 和 reviews 可以在 runner 分配前唤醒 gate。Action 也通过 `codex-bot-logins` input 接受同一个 comma-separated value。

### `CODEX_REVIEW_GATE_COMPLETION_SIGNAL_BUFFER_SECONDS`

`CODEX_REVIEW_GATE_COMPLETION_SIGNAL_BUFFER_SECONDS` 和
`completion-signal-buffer-seconds` action input 是 deprecated compatibility
controls。v1 仍接受它们，但 v1.3 commit-bound terminal evidence 使用 exact head
binding，而不依赖 timing buffer。

`+1` reactions 在这个设计中是 diagnostic signals。它们在有用时会被记录，但不是主要 pass signal，因为 reactions 没有可靠的 workflow wake event。

`eyes` reactions 是 liveness signals。Gate 会检查 PR-body reactions 和 active marker comment 上的 reactions。它们会把 `WaitingAck` 推进到 `WaitingResult`，但不会让 gate 通过。

### `CODEX_REVIEW_GATE_FAILED_FINDINGS_RECOVERY`

`CODEX_REVIEW_GATE_FAILED_FINDINGS_RECOVERY` 可以作为 repository 或 organization
variable 提供，并通过 `failed-findings-recovery` 传给 action。Runtime
`FAILED_FINDINGS_RECOVERY` environment variable 也被支持。如果两者都存在，action
input 优先生效。留空或未设置时默认启用；把任一值设为 `false` 可关闭 legacy recovery
branch。

这个 switch 只控制 legacy history-based recovery branch，不能关闭 authoritative
commit-bound reconciliation：即使这个 compatibility switch 是 `false`，latest
accepted current-head clean result 加上历史所有 thread-backed findings 已 resolved，
仍会产生 `success`。

### `CODEX_REVIEW_GATE_FAILED_FINDINGS_RECOVERY_MODE`

`CODEX_REVIEW_GATE_FAILED_FINDINGS_RECOVERY_MODE`、
`failed-findings-recovery-mode` 和 `FAILED_FINDINGS_RECOVERY_MODE` 是 deprecated
compatibility controls。仍接受 `head` 和 `fresh`，但 commit-bound v1.3
reconciliation 会评估当前完整 evidence snapshot；仅因为较早 reconciliation 看到
unresolved findings，不会要求新的 provider result。

## GHA 成本模型 (cost model)

Happy path 通常使用两个短 job：

1. 一个 PR event 创建或刷新 state，写入 `pending`，并为当前 head 发布受控 `@codex review` marker。
2. 一个 Codex top-level completion comment 或 `APPROVED` review 唤醒 triage。Gate 会
   重新加载完整 evidence、确认 head 未变化、要求历史上所有 thread-backed findings 均已
   resolved，并写入计算出的 status。

Finding paths 取决于 event mode。在 `standard` mode 中，Codex submitted review 可以唤醒 triage 并写入 `failure`。在 `comment-only` mode 中，status 可能保持 `pending`，直到 scheduled 或 manual scan 观察到 findings。

Resolved-findings recovery path 不新增 scheduled job，也不引入 polling loop。
`failed_findings` 之后，维护者 resolve 所有 Codex review threads，再通过普通 provider
event、schedule 或 `workflow_dispatch` rerun gate。这个短 job 会重建常规 snapshot，
并在写入 `success` 前做 final validation reload。此前已接受的 current-head clean
result 仍可使用；历史上的 incomplete run 不会强制再次发起 Codex review。

默认 schedule 示例：

```yaml
on:
  schedule:
    - cron: "0 */2 * * *"
```

每个 scheduled run 在一个 job 中扫描 open PRs。它应跳过 draft、缺少 gate state，或
retry 尚未到期的 PR。已存储的 success 或 failure 并不能单独证明当前 readiness；
选中一个 PR 做 reconciliation 时，action 会重新构建其当前 evidence。Open PR 数量会
影响 API calls 和 wall-clock time，但不应为每个 PR 创建一个 job。

近似 scheduled runner minutes：

```text
monthly_minutes ~= ceil(avg_schedule_run_seconds / 60) * runs_per_month
runs_per_month ~= 30 * 24 * 60 / cron_interval_minutes
```

对 cost-sensitive private repositories，可以使用以下一个或多个选项：

- self-hosted runner
- 降低 schedule 频率
- `CODEX_REVIEW_GATE_AUTO_RETRY=false`
- `CODEX_REVIEW_GATE_EVENT_MODE=comment-only`

## 状态模型

Gate 用一个可信 sticky PR state comment 存储 hidden JSON metadata。这个 state 在 event
runs 之间协调 markers、retry deadlines、审计历史和幂等；它不是 authoritative review
evidence，也不能单独保留或恢复 successful gate result。

State 记录：

- 当前 tracked head SHA
- 最近写入的 status state、head 和 run URL，用于审计和幂等
- active marker ID、URL、head SHA、创建时间和 attempt number
- Codex comments、reviews 和 diagnostic reactions 的 marker baseline identities
- marker deadlines: `ackDeadlineAt`、`resultDeadlineAt`、`nextRetryAt`、`headStartedAt` 和 `maxWaitDeadlineAt`
- marker state: `waiting_ack`、`waiting_result`、`passed`、`failed_findings`、`missed_ack`、`stalled`、`timed_out`、`obsolete_head` 或 `state_lost`
- 用于 retry backoff 和 recovery 的 bounded marker history
- 为 v1 兼容而保留的 legacy failed-findings recovery fields

State comments 和 marker comments 只信任配置的 trusted authors。默认 trusted author 是 `github-actions[bot]`，匹配 repository workflow 的 `GITHUB_TOKEN` 路径。

## 状态机

Evidence reconciliation 的判定先于 marker orchestration：

```mermaid
flowchart TD
  load["Load complete current evidence"] --> complete{"Snapshot complete?"}
  complete -->|No, transient exhaustion| pendingError["Write pending; fail workflow"]
  complete -->|No, deterministic conflict| hardError["Write error; fail workflow"]
  complete -->|Yes| threads{"Any unresolved historical thread finding?"}
  threads -->|Yes| failed["Write failure"]
  threads -->|No| clean{"Latest accepted current-head result clean?"}
  clean -->|Yes| passed["Write or reassert success"]
  clean -->|No| pending["Keep pending and continue marker flow"]
```

下面的状态机负责协调 request markers 和 retry deadlines。任何到 `Passed` 的 transition
仍必须通过上面的完整 reconciliation；stored state 本身绝不能提供 pass decision。

```mermaid
flowchart TD
  start["Ready PR event / new commit"] --> pending["Write pending status"]
  pending --> marker["Create or refresh state and marker"]
  marker --> waitingAck["WaitingAck"]

  waitingAck -->|Codex APPROVED review| validatePass["Reconcile complete current evidence"]
  waitingAck -->|Codex top-level clean completion comment| validatePass
  validatePass -->|Current-head clean and all threads resolved| passed["Passed"]
  validatePass -->|Unresolved finding or stale head| failed["FailedFindings"]

  waitingAck -->|Codex submitted review| validateReview["Reconcile complete evidence"]
  validateReview -->|Findings exist| failed
  validateReview -->|No findings yet| waitingResult["WaitingResult"]

  waitingAck -->|ackDeadlineAt elapsed| missedAck["Close marker as missed_ack"]
  missedAck --> backoff["Apply same-head backoff"]
  backoff --> marker

  waitingResult -->|APPROVED review or completion comment| validatePass
  waitingResult -->|Current-head findings| failed
  waitingResult -->|resultDeadlineAt elapsed| stalled["Close marker as stalled"]
  stalled --> marker

  passed -->|New commit| pending
  failed -->|New commit| pending
  failed -->|Provider event, schedule, or manual rerun| validateRecovery["Reconcile complete current evidence"]
  validateRecovery -->|Current-head clean and all threads resolved| passed
  validateRecovery -->|Unresolved thread finding remains| failed
  validateRecovery -->|Evidence incomplete| pending
  waitingAck -->|Head changed| obsolete["Close marker as obsolete_head"]
  waitingResult -->|Head changed| obsolete
  obsolete --> pending

  start -->|Draft PR| draft["Keep pending; do not create marker"]
```

```text
NoState / Passed / FailedFindings
  on ready PR event or new commit:
    write pending
    create or refresh sticky state
    close obsolete active marker if present
    create @codex review marker for current head
    create the fresh-head marker even when an older unresolved finding already blocks pass
    set ackDeadlineAt, resultDeadlineAt, nextRetryAt, headStartedAt
    -> WaitingAck

WaitingAck
  on Codex APPROVED review after marker for the same head:
    reconcile current head, latest terminal result, and all historical thread findings
    -> Passed or FailedFindings

  on Codex top-level completion comment after marker:
    reconcile current head, latest terminal result, and all historical thread findings
    -> Passed or FailedFindings

  on Codex submitted review after marker for the same head:
    reconcile the complete evidence snapshot
    -> FailedFindings if findings exist
    -> WaitingResult otherwise

  on manual, rerun, or schedule when ackDeadlineAt elapsed:
    close active marker as missed_ack
    compute exponential backoff from same-head missed_ack history
    create retry marker when nextRetryAt is due
    -> WaitingAck

WaitingResult
  on Codex APPROVED review or top-level completion comment after marker:
    reconcile current head, latest terminal result, and all historical thread findings
    -> Passed or FailedFindings

  on an unresolved Codex finding:
    write failure
    close active marker as failed_findings
    -> FailedFindings

  on manual, rerun, or schedule when resultDeadlineAt elapsed:
    close active marker as stalled
    create retry marker
    -> WaitingAck

AnyState
  on draft PR:
    keep or write pending
    do not create a new marker

  on head change:
    close active marker as obsolete_head
    write pending for latest ready head
    create marker for latest ready head
    -> WaitingAck

FailedFindings
  on a provider event, schedule, rerun, or manual dispatch:
    rebuild the complete evidence snapshot
    require every historical thread-backed finding to be resolved
    require the latest accepted terminal result to be clean and bound to the current head
    revalidate head, terminal evidence, and findings before writing
    -> Passed if all requirements remain satisfied
    -> FailedFindings if an unresolved thread-backed finding remains
    -> Pending or Error if current evidence is incomplete
```

## Signal Rules

Accepted provider evidence 按 channel 校验：

- REST artifacts 必须来自 accepted login，且 `user.type == "Bot"`。使用默认 identity
  policy 时，官方 top-level issue comments 还必须满足
  `performed_via_github_app.slug == "chatgpt-codex-connector"`。
- Pull request review 通过完整 `commit_id` 绑定。Inline comment 通过 parent review 和
  `original_commit_id` 绑定；可变的 relocated inline `commit_id` 不是 provenance。
- Top-level clean result 必须匹配受支持的 clean format，并包含 reviewed-commit marker。
  短 marker 必须经 repository commit API 解析，并唯一对应完整 current-head SHA。
- Review-body 和没有 thread 的 top-level findings 通过精确
  `https://github.com/<owner>/<repository>/blob/<40-hex>/...` links 绑定。混合
  repositories、commits 或不受支持的当前格式都不会被接受。

Action 会完整分页读取 issue comments、reviews、inline comments、GraphQL review
threads 和 thread comments。Parent reviews、thread mappings、分页或 payload 冲突字段有
任一缺失时，当前运行会判为 incomplete，而不是 clean。

Thread-backed findings 属于历史 admission evidence。只有 `isResolved` 为 true 时，该
thread 才不再阻塞；`isOutdated` 本身没有 resolving effect。没有 thread 的 findings
保持 active，直到同一或更新 head 上更晚的 accepted clean result supersede 它们。

写入 `success` 前，action 会重新加载：

- PR lifecycle 和精确 current head
- 选中的 latest terminal provider artifact
- 完整 findings snapshot 和 thread resolution state

未知的未来 provider format 会使当前运行 fail closed。后续运行一旦能解析完整且更新的
current-head clean result，较早的 format error 或 incomplete API attempt 不会继续
sticky。

## Fork 和 Dependabot PRs

GitHub 文档说明，fork 和 Dependabot PRs 的非 `pull_request_target` PR review events 可能收到 read-only `GITHUB_TOKEN`；Dependabot 触发的 `pull_request_target`、review 和 comment events 也可能以 read-only token 运行。示例 workflow 因此会在 runner 分配前过滤 Dependabot event wakeups；如果用户 workflow 省略该 filter，action 也会 defensively 跳过同一路径。

Fork PR review events 是 opportunistic 的：如果当前 PR head 来自 fork，action 会跳过 `pull_request_review` 和 `pull_request_review_comment` writes，并依赖 top-level `issue_comment`、schedule 或 manual recovery。Dependabot PRs 依赖 schedule 或 manual recovery 来取得所有 write-capable progress。Scheduled scans 可以初始化没有 prior gate state 的 Dependabot PR，因为 per-event wakeups 被有意忽略。

## Retry 和 Recovery

`workflow_dispatch` 可以 target 一个 PR，也可以 scan open PRs。Rerun 应像 resume operation 一样工作：从 GitHub 重新加载当前 PR state，忽略 stale event head assumptions，并只根据当前 evidence 推进 state machine。

如果 sticky state comment 丢失但存在 trusted marker comment，gate 必须安全恢复：

1. 把 recovered marker 记录为 `state_lost`。
2. Baseline 当前可见的 Codex signals。
3. 不从 recovered marker 通过。
4. 创建 fresh marker，或因 unresolved finding 失败。

如果 sticky state comment 存在，但 marker creation 在 marker comment 被持久化前失败，scheduled recovery 会把 current-head pending state 视为需要 fresh marker。Marker 被关闭为 `missed_ack` 或 `stalled` 后，如果 replacement marker 发布失败，也使用同样的 retry rule。

Scheduled runs 处理 retry deadlines。它们应扫描 open PRs，只为 candidate PRs 加载 state，并推进 `nextRetryAt`、`ackDeadlineAt` 或 `resultDeadlineAt` 已经过期的 markers。

如果当前 reconciliation 对暂时性 API 或分页失败耗尽有界重试，gate 会向该 PR head
写入 `pending`，并使 workflow 失败。确定性的 provider identity、schema 或 commit
冲突会写入 `error` 并使 workflow 失败。这些 states 只描述当前运行；它们不会阻止后续
完整 reconciliation 写入 `success`。

同一个 head 上连续的 `missed_ack` outcomes 使用 exponential backoff。Head change 或任何非 `missed_ack` outcome 都会为新 marker 重置 ack backoff history。

`failed_findings` 之后，维护者 resolve 所有 Codex review threads，再通过普通 provider
event、schedule 或 `workflow_dispatch` rerun。无论 legacy recovery switch 如何设置，
此前已接受的 current-head clean result 都可以在 threads resolved 后再次
reconciliation。较早的 incomplete run 不要求新发起 Codex review；如果当前
reconciliation 仍不完整，则保持 non-success，直到一次完整运行成功。

## Branch Protection

Repository rulesets 应要求：

- `codex/review-gate` status check
- GitHub 原生 conversation-resolution protection，如果仓库希望 unresolved inline conversations 阻塞 merge

Status check 同时要求干净的 current-head Codex terminal result，以及所有历史
thread-backed Codex findings 已 resolved。Native conversation resolution 仍可作为独立
UI 和 branch-protection signal。
