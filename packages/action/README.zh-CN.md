# Codex Review Gate

语言：[British English (en-GB)](README.md) | [简体中文 (zh-CN)](README.zh-CN.md)

## 快速开始

1. 把 [Workflow 用法](#workflow-用法) 中的薄 caller 复制到
   `.github/workflows/codex-review-gate.yml`。
2. 保持 canonical reusable-workflow reference 为
   `JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1`，合入
   default branch 后再开一个后续测试 PR。
3. 确认 `codex/review-gate` 行为符合预期后，把它加入 required status checks。恢复和排障 recipes 见 [cookbook](COOKBOOK.zh-CN.md)。

> [!IMPORTANT]
> Reusable caller 目前只是为 v1.5 rollout staged。Immutable v1.5.0 release 已存在，
> 但 live canary 证明其 commit-versus-tag-object admission contract 有误。Consumer
> 必须对 v1.5.0 fail closed，不存在 digest-keyed erratum。在兼容修复
> v1.5.1 与 provenance asset 发布、`v1.5` 和 `v1` aliases 验证且新 live canary 通过前，
> 不得在 source repository 或 template 中激活。Activation 必须放在独立的后续 PR；
> 此前继续使用 source 与 template 的现有 callers，不做修改。

`codex-review-gate` 是由 composite Action 支撑的 reusable GitHub workflow，负责提供
deterministic
`codex/review-gate` status check。只有完整 evidence snapshot 中 latest official trusted
provider artifact 符合封闭 clean grammar、绑定 current PR head，且所有 blocking
current-head 或 ancestor Codex findings 均已 cleared 时，gate 才会通过。这里的通过只表示本 required commit
status 为 `success`；它绝不证明 named triple review 已完成，也不证明 PR 整体
merge-ready。

目标仓库只需要在 `.github/workflows/codex-review-gate.yml` 保留一个薄 workflow；review state machine 位于这个 action 内。

## 生成式 AI 提醒

> [!NOTE]
> 这个 action 会请求并评估 Codex 生成式 AI review output。它会保持受控 `@codex review` marker comments 最小化，以便 command parsing 更可靠；请求 review 时，会把此 disclosure 写入 GitHub Actions step summary。Codex 可能会在 pull request 中回复 AI-generated comments 或 reviews。在把 AI-generated output 用于安全性、正确性或合并决策前，请先人工 review 和验证。
>
> Action 本身不会执行 pull request 代码。它只协调 GitHub comments、reviews、reactions 和 commit statuses，让仓库维护者可以把 Codex review 作为 required branch-protection signal。

## 它检查什么

Runner 会执行 event-driven evidence reconciliation；serialized marker flow 只负责请求
review：

- 通过 repository default branch 上的 `pull_request_target` 运行。
- 把配置的 commit status 写到 PR head SHA；默认是 `codex/review-gate`。
- 只有 complete 且 stable 的 evidence reduction 选出强绑定 current head 的 official
  trusted clean artifact，且 current-head 或 ancestor findings 均不再 blocking 时才通过。
  这只是 required `codex/review-gate` status 的 verdict，不是 triple review 或
  merge-readiness 证明。
- 分开处理 `isOutdated` 和 `isResolved`。Current-head 或 ancestor finding 所在的 exact
  joined review thread，只有 authoritative `isResolved` 精确为 `true` 时才解除阻塞；
  later clean result 不能 supersede 它。
- 通过精确 repository 和 full-SHA blob links 识别没有 thread 的 top-level finding
  comments。较早的 same-head 或 ancestor unthreaded finding，只有 strictly later
  selected current-head clean artifact 才能 supersede。已证明属于 non-ancestor 的 finding
  只保留作审计，会从 reduction 中移除并重新归约。Issue comment 的 `created_at` 与
  `updated_at` 必须 canonical，且 `updated_at >= created_at`，并以 `updated_at` 作为
  revision time。REST issue-comment timestamps 只有一秒粒度，因此两个 issue comments
  处于同一 revision second 时一律 ambiguous；即使 `created_at == updated_at` 也不能证明
  没有同秒 edit，ID 绝不打破该平局。Same-time pull-request reviews 只在 review channel
  内保留较大 canonical ID tie-break；cross-channel tie 仍 ambiguous。
- Clean 绑定 proven ancestor 时属于 stale audit evidence；绑定 proved non-ancestor 时只作
  审计，并在重新归约前移除。只有 ancestry relationship 经有界重试后仍 unknown，才写入
  带 `ancestry-unverified` 的稳定 `error`。
- 验证官方 provider identity 和强 commit binding。Clean issue comment 必须恰好包含一个
  `Reviewed commit` marker。Pull request review 以原生完整 `commit_id` 绑定；正文中若有
  reviewed-commit hash，必须与该值一致。
- 只通过封闭的 provider grammar 接受 clean result；finding-shaped content 的优先级高于看似 clean 的 lead 或 `APPROVED` state。
- 对 configured provider 以 `Codex Review` 开头且可带 optional Markdown heading 和 emoji 的 comment，先作为宽泛 terminal candidate。Exact valid one-line `in progress` / `still in progress` artifact 的末尾可以是句点，或冒号加 1–160 个 metadata 字符；它会在现有 marker 和 deadline 下保持 `pending`，不会 ACK、reset、延长 deadline 或 repost。`completed` 等 candidate 属于 deterministic malformed，会写 `error` 而不是被忽略。
- 每次 reconciliation 都重新构建完整 evidence snapshot。历史 `pending`、`error` states
  与已关闭 wait outcomes 只作审计。Transient API 读取不完整或 pagination attempt，只有
  重建出 complete current snapshot 后才停止阻塞；snapshot 中仍存在的 malformed、
  identity、schema、commit parsing/binding errors 属于 global blockers，later clean 不能
  supersede 它们。
- 把每个 PR 的 evidence work 限制为跨 snapshots 和 retries 共享的 64 MiB 与 1,024 次 fetch attempts；同时限制每个 response 流式读取最多 8 MiB、每个 snapshot 最多 20,000 items，以及 HTTP 和 review-thread 补全各最多四路并发。
- 用 hidden metadata 维护一个可信 sticky PR state comment。
- 串行维护受控 `@codex review` marker comments。
- 保持受控 marker comments 最小化，并把生成式 AI review 提示写入 GitHub Actions step summary。
- `+1` reactions 只作为 audit signals，不具备 verdict authority。`eyes` 只表示
  liveness：它可以把 `waiting_ack` 推进到 `waiting_result`，但既不会让 gate 通过，也
  不会延长任何 deadline。
- 用 scheduled 或 manual resume runs 重试未 ack 或 stalled 的 markers。
- 当前 reconciliation 无法加载或验证所有必要 evidence 时 fail closed。Transient
  acquisition 或 reconciliation fault 会先做有界重试，随后写入稳定的 `error`；
  deterministic malformed、identity、schema、commit-binding 或
  `ancestry-unverified` fault 则在所需有界检查后写 `error`。
- 已确认的 current-head 或 ancestor finding 与 evidence error 同时出现时，finding
  优先：status 保持 `failure`，summary 同时说明 evidence issue。只有不存在已确认的
  blocking finding 时才使用 `error`。
- 在应用 marker 等待 deadline 前先 reconcile 完整 review evidence。Marker deadline
  只负责结束或重试等待，不会为 provider artifact 设置 acceptance window。即使 valid
  current-head clean artifact 在 marker deadline 后才创建，后续完整运行仍可通过。
- Sticky state、controlled markers、baselines、deadlines、recovery mode 和 status
  history 只用于 request orchestration、retry、liveness、审计和幂等；它们都不能授权或
  拒绝 provider evidence。
- 写入 success 前，先缓存 same-context newest live status 及 producer，再重新读取 PR
  lifecycle、head 和 complete evidence，并再次执行 reduction。只有 head、PR state、
  完整 evidence 与 selected result 在 final validation 中保持 stable，才执行 success
  write。Final reduction certificate 会绑定每个 selected 或 applicable issue-comment
  carrier 的 `created_at`、`updated_at` 与 carrier digest。
- Receipt mode 总会从当前 run attempt POST computed status，使 receipt 可以绑定新的 REST
  response。Receipt mode 之外，只有同一 context 的 newest record 已是目标 state，且
  producer exact 为 `github-actions[bot]` / `Bot` 时才可 deduplicate。
- 迁移 legacy marker 和 recovery fields 只为保持 orchestration 连续性，不会把这些
  fields 当作 provider-evidence authority。
- 为保持 v1 interface compatibility，继续接受 deprecated failed-findings
  recovery inputs；其取值不再改变 gate decision 或 request orchestration。
- 对 official automatic-review output 与 controlled-request output 使用相同的 identity、
  封闭 grammar、current-head 和 complete-snapshot 规则。

## 文件

- `action.yml`: runner 的 composite action wrapper。
- `.github/workflows/codex-review-gate.yml`: canonical GitHub.com reusable
  workflow，包含可信 event filters 与 exact self-checkout。
- `src/gate.mjs`: GitHub Actions runner script。
- `src/core.mjs`: 可测试的 state 和 signal helpers。
- `decision-table.json`: `policy_major: 1`、`policy_version: 1.4.0` 的机器可读 authoritative reducer policy。
- `producer-receipt.schema.json`: producer receipt v1 JSON Schema。
- `DESIGN.md` / `DESIGN.zh-CN.md`: 目标 signal model、state machine 和 GHA 成本模型。
- `COOKBOOK.md` / `COOKBOOK.zh-CN.md`: 正常使用路径和 failure recovery recipes。

## 高级运行模型

Event-driven review gate 的状态机、自动重试开关、**GHA 成本模型 (cost model)** 和恢复行为见 [DESIGN.zh-CN.md](DESIGN.zh-CN.md)。操作 recipes 见 [COOKBOOK.zh-CN.md](COOKBOOK.zh-CN.md)。

高级设计中，需要在 runner 分配前生效的控制项应使用 repository 或 organization variables。例如，`CODEX_REVIEW_GATE_AUTO_RETRY=false` 可以在 job `if` 层跳过 scheduled retry job。Runtime `env` 仍可用于 job 启动后的 action 行为兼容，但不能阻止 GitHub Actions 分配 runner。

当前 source-root direct workflow 默认使用 `ubuntu-slim`。Direct composite caller 可以把
`CODEX_REVIEW_GATE_RUNNER_LABELS` 设成 JSON array，例如
`["self-hosted","linux","x64","codex-review-gate"]`；下面的 canonical reusable
workflow 刻意忽略该 variable，并固定使用 `ubuntu-slim`。

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
    uses: JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1
```

Caller 刻意保留完整 event set、permission ceiling 与 repository-wide concurrency group。
Reusable workflow 负责可信 job filters、runner selection、timeout、exact called-repository
checkout 与 composite step。调用 reusable workflow 的 job 不能再包含 `runs-on` 或
`steps`。不要在 called workflow 里重复 caller 的 repository-wide concurrency group；
cross-run serialisation boundary 应留在 caller 一侧。

Called workflow 取得 caller 的 `GITHUB_TOKEN` permissions，且不能提升权限，因此无需
`secrets: inherit`。上面的四项 read/write permissions 是支持的 ceiling。Called
workflow 绝不 checkout pull request，也不执行其代码。

Reusable mode 固定使用 `runs-on: ubuntu-slim`。Caller repository variables 不能选择
self-hosted 或其他 runner，因此 GitHub-hosted runner 是 checkout output、worktree 与
receipt production 的 trust boundary 一部分。Direct composite mode 仍由 caller 控制，
可以保留现有 runner 配置。该 GitHub-hosted boundary 仍不是 cryptographic signature、
OIDC attestation 或 content-addressed storage proof。

Reusable receipt attribution 还假设 caller workflow revision 及其完整 job graph 已被独立
信任。同一 run 中的 malicious sibling job 可在 called job 完成前抢先创建
attempt-named artifact，并写入 matching status。Exact-attempt `referenced_workflows` 只是
run-level corroboration，不绑定某个 job、callsite 或 receipt。因此已验证链只在
trusted-caller 加 fixed-hosted-runner boundary 内提供 causal consistency，不是 job-scoped
cryptographic attribution。

Floating `@v1` 是刻意设置的集中式 pre-execution trust boundary：action repository
的 release policy 只允许把它移动到兼容的 v1.x release。它不是 post-run immutable
provenance。以 `W` 表示 `job.workflow_sha`、matching exact-attempt
`referenced_workflows[].sha` 与 receipt `producer.action.ref` 中的 exact selected workflow
object；以 `C` 表示 checkout output commit、receipt `producer.action.commit_sha` 与
provenance `action.commit_oid`；以 `T` 表示 independently signed
`tags.v1.tag_object_oid`。v1.5.0 live canary 观察到 `W == T`，但封闭合同也接受
future `W == C` shape。Consumer 必须要求这两个 candidates 中恰好一个命中，
总是验证 `T` direct peel 到 `C`，且不在 caller 或消费 Skill 中 pin v1.5 SHA。

## Inputs

这些是 direct composite Action inputs。Canonical reusable caller 不把它们暴露为
`workflow_call` inputs；它从 caller event 与已记录的 repository 或 organization
variables 派生 routing。

| Input | 默认值 | 说明 |
| --- | --- | --- |
| `github-token` | required | 用于读取 PR review state、创建 comments、写 commit statuses 的 token。 |
| `pull-request` | empty | 要 gate 的 pull request number。留空时从 event payload 路由，或扫描 open PR。 |
| `head-sha` | empty | Deprecated compatibility input。Event-driven runs 会从 GitHub 读取当前 PR head。 |
| `status-context` | `codex/review-gate` | Gate 写入的 commit status context。 |
| `state-marker` | `codex-review-gate-state` | Sticky state comment 使用的 hidden HTML marker。 |
| `marker-comment-marker` | `codex-review-gate-marker` | Controlled Codex request comments 使用的 hidden HTML marker。 |
| `max-wait-seconds` | `7200` | 用于 retry 和 liveness orchestration 的整体 marker 等待预算。 |
| `marker-timeout-seconds` | `3600` | 已 ack marker 等待结果的时间，超时后重试。 |
| `marker-ack-timeout-seconds` | `300` | Codex ack marker 前的初始等待时间。 |
| `marker-ack-timeout-max-seconds` | `1800` | 未 ack marker 指数退避等待上限。 |
| `completion-signal-buffer-seconds` | `30` | Deprecated v1 interface-compatibility input；其取值不再改变 gate decision 或 request orchestration。 |
| `failed-findings-recovery` | empty | Deprecated v1 interface-compatibility switch；其取值不再改变 gate decision 或 request orchestration。 |
| `failed-findings-recovery-mode` | empty | Deprecated v1 interface-compatibility input；`head` 和 `fresh` 不再改变 gate decision 或 request orchestration。 |
| `event-mode` | empty | Event mode override：精确小写 `standard`、`comment-only` 或 `full`。留空时使用 `CODEX_REVIEW_GATE_EVENT_MODE` 或 `standard`。 |
| `poll-interval-seconds` | `30` | Deprecated compatibility input。Event-driven runs 不轮询。 |
| `bootstrap-grace-seconds` | `60` | Deprecated compatibility input。Event-driven runs 会直接创建 controlled marker。 |
| `bootstrap-timeout-seconds` | `3600` | Deprecated compatibility input。Bootstrap 会在 grace period 后关闭，并启动 controlled marker。 |
| `codex-bot-logins` | `chatgpt-codex-connector,chatgpt-codex-connector[bot]` | 视为 Codex bot identities 的 GitHub logins，逗号分隔。 |
| `trusted-comment-logins` | `github-actions[bot]` | 可信 gate state 和 marker comments 的 GitHub logins，逗号分隔。 |

## Outputs

Supported GitHub.com invocation finalized 并上传 producer receipt 后，reusable workflow
会把以下 values 暴露为 job-call outputs；direct composite 也会暴露同名 step outputs。
Direct step ID 为 `gate` 时，通过 `steps.gate.outputs.<output-name>` 读取。

| Output | 说明 |
| --- | --- |
| `producer-receipt-artifact-id` | 本 exact run attempt receipt 的 GitHub artifact ID。 |
| `producer-receipt-artifact-url` | 该 artifact 以 `/actions/runs/<run_id>/artifacts/<artifact_id>` 结尾的 web URL；它不是 REST artifact `.url`。 |
| `producer-receipt-artifact-digest` | Exact-pinned receipt upload step 报告的 raw 64-hex SHA-256 digest。它是 integrity checksum，不是 signature 或 attestation。 |

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

## Invocation Provenance

完成上面的 rollout gate 后，canonical GitHub.com caller 使用
`JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1`。
这个 floating major alias 是刻意设置的集中式 pre-execution trust boundary：移动它会把
所有 callers 升级到兼容的 v1.x release。它不是 post-run immutable provenance。
当前 live shape 中，post-run admission 会动态校验 `job.workflow_sha` 选中的 exact
signed `v1` tag-object OID 与其到 admitted action commit 的 peel。下文封闭 resolution
contract 也接受 future exact-action-commit shape；caller 与消费 Skill 都不 pin v1.5
SHA。

在 called job 内，`github.workflow_ref` 与 `github.workflow_sha` 仍标识 caller
workflow。Called implementation 由仅 GitHub.com 提供的 `job.workflow_repository`、
`job.workflow_file_path`、`job.workflow_ref` 与 `job.workflow_sha` 标识。Caller 使用
`@v1` 时，SHA field 标识 selected workflow object。v1.5.0 canary 观察到 annotated
`v1` tag object；若 GitHub 以后报告 exact peeled action commit，封闭合同也接受该
object。Reusable workflow 使用 full-SHA-pinned `actions/checkout`，并指定
`repository: ${{ job.workflow_repository }}` 与 `ref: ${{ job.workflow_sha }}`，以 checkout
自身 exact implementation。`checkout` step 的 official `commit` output 是 peeled action
commit，只能通过
`CODEX_REVIEW_GATE_CHECKED_OUT_ACTION_COMMIT_SHA: ${{ steps.checkout.outputs.commit }}`
传入 local composite，绝不能来自 `workflow_call` 或 caller input。Bare checkout 会选择
caller repository，因此可信 workflow
绝不使用 bare checkout，也绝不 checkout 或执行 pull-request code。

Direct composite form 继续兼容，但必须使用
`JoeyTeng/codex-review-gate-action@<exact-lower-case-40-sha>`。GitHub Enterprise Server
不提供 reusable-workflow `job.workflow_*` identity，因此必须使用该 fallback。Floating
direct composite reference 不具 authority；reusable validation 失败后禁止 opportunistic
downgrade 到 direct mode。Receipt-based positive provenance path 仍仅适用于 GitHub.com；
GHES fallback 保留 direct gate operation，不提供 receipt-backed admission claim。

Commit Status record 的 target head、`context`、`creator` 与 `target_url` 只属于
consistency evidence，不是 invocation provenance。任何持有 `statuses: write` 的 workflow
都能复现同一个 status context 和 target URL，也可能使用相同的 generic
`github-actions[bot]` creator。

Commit Status 按 repository SHA 与 context 建立，不按 pull request 隔离。Open PRs 共享
head SHA 时会共享同一个 status 与 branch-protection signal。因此 status 不能证明 PR
isolation；selected receipt `statuses[]` entry 的 PR number 与独立归约的 provider
evidence 都必须匹配 selected current PR。

在 GitHub.com 上，两种 supported form 都会按
[`producer-receipt.schema.json`](producer-receipt.schema.json) 生成 producer receipt v1。
对于 canonical reusable tuple——exact action repository、workflow file、
`refs/tags/v1` job ref 与 lower-case 40-hex `job.workflow_sha`——producer 会把该 exact
selected workflow object OID 映射为 `producer.action.ref`，并把 full-SHA-pinned checkout step 的
official `commit` output 独立映射为 `producer.action.commit_sha`，同时设
`immutable: true`。Checkout commit 必须是 admitted action commit。这个
environment binding 受 called workflow 控制，不暴露 caller input。Native action context
具有 structural priority：只要 `github.action_repository` 或 `github.action_ref` 任一存在，
producer 就记录该 direct context，并忽略 reusable checkout-commit environment。只有
action ref 是 exact lower-case 40-SHA 时，该 direct identity 才 immutable。只有两个 native
fields 都缺失且 job tuple exact canonical 时，才考虑 reusable W/C mapping。
Near-canonical tuple 绝不升级 identity，也不提供 fallback；没有 native context 时只会
产生不可用的 `immutable: false` action identity。

Receipt mode 使用 attempt-specific
`/actions/runs/<run_id>/attempts/<attempt>` target URL。每次 receipt-enabled
`setCommitStatusIfNeeded` 都强制从该 attempt POST，并记录 REST response ID、node ID、
exact echoed fields、creator、full head 与 PR。Scan receipt 可以包含多个 ordered
statuses。只有 `completed` 或 `failed` receipt 才具备 upload 资格；每个 finalized run
attempt 只执行一次 action-level、`overwrite: false` upload attempt，并使用 exact-pinned
`actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02`
（`v4.6.2`）。Producer 不声称 exactly-once artifact creation；consumer inventory 必须
证明 artifact 恰好一个。Attempt-specific path 是 Workflow Run request endpoint 和 status
target；Workflow Run response 的 `url`/`html_url` 仍是 base-run resource URL，不要求与
attempt URL 相等。

任何消费它的 review 或 readiness Skill 都必须保留四个独立 SHA domain：caller
workflow definition（`github.workflow_sha`）、exact API run-attempt head
（`head_sha`）、called workflow selected object identity（`job.workflow_sha`）以及 current
pull-request/status head。任何 domain 都不能替代另一个。尤其禁止要求 run-attempt
`head_sha` 或 Artifact API `workflow_run.head_sha` 等于 selected receipt status head；
禁止要求 run-attempt `head_sha` 等于 `GITHUB_WORKFLOW_SHA`；也禁止要求
`GITHUB_WORKFLOW_SHA` 等于 `job.workflow_sha`。在 called workflow 中，caller workflow
SHA 标识 caller workflow revision。它们的机器可读权威合同是
[`decision-table.json`](decision-table.json) 中的
`producer_receipt_boundary`；Skill 必须：

1. 用 Artifact API 查询 exact run 和 attempt-specific receipt name，并要求
   `total_count == 1`。Outputs 可用时，把 REST ID 与 output ID 比对；构造
   `<server>/<repository>/actions/runs/<run_id>/artifacts/<artifact_id>` web URL 后与 output
   比对，而不是直接比较 REST artifact `.url`。REST `.digest` 必须等于 `sha256:` 加 raw
   64-hex output digest；随后校验 download digest、恰好一个 expected file 与 v1 schema。
2. Receipt schema 允许 finalised `completed` 与 `failed` result，但 positive review 或
   readiness decision 必须要求 `execution.result == completed`；`failed` receipt 只能作为
   audit evidence。还要要求 current repository、exact run/attempt/target、caller
   workflow fields 与一个显式选定的 structural mode。Reusable mode 要求 exact canonical
   job tuple、action repository、`producer.action.ref == job.workflow_sha`、独立绑定的
   checkout commit in `producer.action.commit_sha`，以及 `immutable: true`；direct mode
   要求 expected action repository 与 exact lower-case 40-SHA，其 action ref 与 commit SHA
   相等，并且 `immutable: true`。
3. 通过 `GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt}` 取得
   attempt；不要求 response `url` 或 `html_url` 为 attempt-specific。Artifact API record
   的 `workflow_run.id` 与 `workflow_run.head_sha` 必须分别等于该 response 的 `id` 与
   `head_sha`。Reusable mode 还必须要求 optional、nullable `referenced_workflows` array
   实际存在，并恰好包含一个 matching canonical repository/workflow path 与 v1 call 的
   entry。将其 required `sha`、`job.workflow_sha` 与 receipt `producer.action.ref`
   定义为 `W`；其 `ref` 必须存在且等于 `refs/tags/v1`。要求 `W` 恰好等于
   `runtime_closure.called_workflow.workflow_sha_resolution.candidates` 中一个 declared
   value，每个 candidate value 必须等于它声明的 provenance field。只接受两个分支：
   current-live `W == T`，其中 `T == tags.v1.tag_object_oid`；或 future `W == C`，
   其中 `C == action.commit_oid`。两个分支都必须要求 independently signed `T`
   direct peel 到 `C`，并要求 `tags.v1.peeled_commit_oid == action.commit_oid ==
   producer.action.commit_sha`。其他 object type、nested tag peel、零个或多个 candidate
   match 都 fail closed。这只是 run-attempt-level
   corroboration：GitHub 没有提供 entry-to-job、entry-to-receipt mapping 或 cryptographic
   binding。Evidence 缺失、为 null、malformed 或不唯一时 fail closed。
4. Reusable mode 通过 fully paginated GitHub Releases API 枚举 release candidates，并要求恰好一个
   published、immutable、non-draft、non-prerelease `v1.x.y` release：其 trusted-signer tag
   peel 到 `C`，恰好一个 provenance asset 具有兼容的 closed schema/majors 与
   `action.commit_oid == C`，且 workflow-SHA candidate set 中恰好一次出现 `W`。零个或
   多个 matching releases/assets 都 fail closed。即使在 future `W == C` 分支，也要求
   independently signed annotated `v1` tag object `T` direct peel 到同一 `C`。校验两个
   tags 的 trusted primary signer fingerprint、manifest action root tree 与 critical-file
   bindings、receipt schema v1，以及 `policy_major == 1` 的兼容 policy。禁止通过当前
   `v1` target 反推历史 run。Canonical reusable caller 接受兼容的 v1.x Action-only
   upgrade 时无需修改 caller 或 Skill；direct caller 必须更新 exact pin。Protocol 或
   policy major 变化必须协调升级 Skill。
5. 在 current-PR/status head domain 中，通过 REST 列出 statuses 时，request
   `ref` 必须等于 exact current PR head；selected status 必须来自该
   exact-head response。以 case-insensitive logical context 选择 latest record；随后要求
   configured expected context 的 exact spelling（默认为
   `codex/review-gate`），并要求 creator 精确为 `github-actions[bot]` 且 type 为 `Bot`，
   再为 current PR 选择唯一 matching receipt `statuses[]` member；它不一定是最后一个
   member。其 `head_sha` 必须等于该 exact current PR head；同时精确比对其
   PR number、`id`、`node_id`、context、state、target URL 与 `creator`。Positive
   decision 要求 selected REST record 与 receipt member 都满足 exact
   `status.state == success`；该 selected creator 也必须独立为 exact
   `github-actions[bot]` / `Bot`。
   Membership 缺失或不唯一时 fail closed。
6. 通过 GraphQL 把该 node 重读为 `StatusContext`，要求 exact context、state 与
   target URL 在 selected receipt status、REST record 和 GraphQL node 之间一致。
   `StatusContext.commit.oid` 必须等于 exact current PR head，因此也必须等于
   selected receipt status `head_sha`；同时保留 receipt/run/current state 的 called SHA 与
   workflow/job bindings。GraphQL creator 还必须独立精确为
   `github-actions[bot]` 且 type 为 `Bot`；仅 creator 彼此一致并不充分。
   `StatusContext` 不提供 PR isolation。Caller workflow、run-attempt、called
   implementation 与 current PR/status SHA domains 可以合法地彼此不同；禁止臆造 domain
   之间的 equality。
7. 为 selected receipt member 指定的同一个 PR，独立重新加载并归约 provider evidence。
   Receipt 不证明 clean evidence 或 merge readiness。
8. Readiness 消费前，最后一次通过 REST 重列 exact-head statuses，并要求
   case-insensitive logical latest 仍是相同 REST ID/node ID 与 exact context。同时 stable
   re-read PR head/lifecycle、exact run-attempt metadata 和使用 attempt-specific name
   查询的 run-level artifact inventory；inventory 仍必须恰好一个 artifact，此前所有 bindings 与独立归约的
   provider snapshot 也必须保持 stable。发生变化时有界重试，随后 fail closed。

上述 trusted-signer 与 release checks 只是 point-in-time evidence。它们不保证 key、
signature、tag 或 release 从未被 revoke，也不保证以后保持 unrevoked。需要 revocation
freshness 或 historical revocation guarantee 的 consumer 必须另行定义并执行该 policy。

Status POST 与 artifact upload 不是 atomic，artifact 也可能过期或被删除。Upload
failure、Artifact API absence/multiplicity、unfinished execution、没有 matching status
或任一 invalid receipt，即使 status 存在也必须 fail closed。Receipt v1 只是 causal
producer evidence，绝不替代 provider evidence 的独立归约。其 digest 是 integrity
evidence，不是 cryptographic signature、OIDC attestation 或 content-addressed storage
guarantee。Exact creator checks 仍可被持有 `statuses: write` 的 workflow spoof；只有已
校验的 receipt/run chain 提供 causal consistency。这些 point-in-time re-reads 不能消除
TOCTOU，也不能让 per-SHA/context status 证明 PR-specific fact。完整合同见
[DESIGN.zh-CN.md](DESIGN.zh-CN.md#invocation-provenance-boundary)。

## 运行注意事项

- Workflow 不执行 PR 代码。
- Workflow token 应同时具备 `issues: write` 和 `pull-requests: write`，这样才能创建 PR conversation comments。
- 为了让 request flow 更清晰，仓库可以关闭 Codex automatic review-on-push，以减少重复
  reviews。Automatic 和 controlled-marker results 使用相同的 provider-evidence 规则；
  marker 不会授权其中任一结果。
- Runner 必须完整分页读取 REST comments、reviews、inline comments 和 GraphQL review threads，之后才可能通过。
- 官方 REST evidence 必须来自 accepted Bot identity。Top-level issue comments 默认还必须来自官方 `chatgpt-codex-connector` GitHub App。
- REST evidence IDs 必须是 positive safe integers；GraphQL opaque ID 与 `fullDatabaseId` 必须使用 canonical string form。Duplicate provider、review、inline-comment 或 thread identities 都会 fail closed，包括 resolved threads。
- Reviews 通过原生完整 `PullRequestReview.commit_id` 绑定；review body 中若出现
  reviewed-commit hash，必须与其一致。Inline comments 通过 parent review 和
  `original_commit_id` 绑定，不使用 GitHub 重定位后会变化的 `commit_id`。
- Inline comment 完成 reconciliation 后，其 `COMMENTED` parent 可以使用正文中不带 blob link 的封闭官方 inline-review wrapper。Wrapper 的 reviewed-commit marker 仍必须匹配 parent 的完整 `commit_id`；未知 parent body 继续 fail closed。
- Top-level clean comments 必须恰好包含一个 reviewed-commit marker。短 marker 必须经
  repository commit API 唯一解析为完整 current-head SHA。
- 封闭的 clean 结构要求 exact issue-comment lead；之后只能没有 tagline，或用恰好一个 ASCII space 分隔一个 nonempty、trimmed、同首行且最多 160 个 UTF-16 code units 的 presentation tagline。Tagline 必须是以下一种：已知 stem（`Nice work`、`Chef's kiss`、`What shall we delve into next`、`Already looking forward to the next diff`、`Keep them coming`、`Swish`、`Another round soon, please`、`Breezy`、`Can't wait for the next one`、`More of your lovely PRs please`、`Bravo`、`Keep it up`、`Delightful`、`Hooray` 或 `You're on a roll`）加恰好一个结尾 `.`、`!` 或 `?`；exact `:rocket:`、`:tada:` 或 `:+1:`；或一到八个 exact RGI emoji graphemes（相邻或以一个 ASCII space 分隔）。所有未知 prose 都 fail closed，无论是 positive、actionable 还是 contradictory。Tagline 只用于 presentation，绝不提供 clean 或 finding evidence。Comment 仍必须有且仅有一行 10 或 40 hex 的 reviewed-commit，并且只能没有 suffix 或带 exact official disclosure。`APPROVED` review 必须为空、exact `Looks good.`，或有唯一的 exact final `No findings.`，其前面可以有至多一行、最多 240 个字符的 summary。该 summary 必须以 exact `Coverage:` 或 `Review coverage:` 开头，后接以逗号和/或 `and` 分隔的 backtick-wrapped identifier/path tokens；token 只能匹配 `[A-Za-z0-9_./:@+-]+`，末尾只可选一个句点。整个 normalized target 若 exact 等于 `P0`–`P3`、`S0`–`S3`、`critical`、`high`、`medium`、`low`、`finding`、`findings`、`blocker`、`blocking`、`found`、`detected`、`data-loss` 或 `auth-bypass`，则拒绝；这些词出现在真实 path 或 identifier segment 中时不会被 blanket 拒绝。Verb-led 和其他 prose 均不接受。Finding signals 始终优先。
- Review-body 和没有 thread 的 top-level findings 必须使用 exact `github.com`、被 gate 的 owner/repository 和 full commit SHA links。当前格式未知或冲突时 fail closed。
- 包含 current-head 或 ancestor finding 的 exact joined thread，只有 authoritative
  `isResolved` 精确为 `true` 时才停止阻塞；`isOutdated` 或 later clean result 都不能
  关闭它。较早的 threadless same-head 或 ancestor finding，只有 strictly later selected
  current-head clean 才能 supersede。已证明属于 non-ancestor 的 finding 只作审计，并在
  evidence 重新归约前移除。Issue comment 必须同时有 canonical `created_at` 与
  `updated_at`，且 `updated_at >= created_at`，并以 `updated_at` 作为 revision time。两个
  issue comments 处于同一 revision second 时一律 ambiguous：`created_at == updated_at`
  不能证明没有同秒 edit，因此 ID 绝不打破该平局。Same-time pull-request reviews 只在
  review channel 内保留 canonical ID tie-break；cross-channel tie 仍 ambiguous。
- 绑定 proven ancestor 的 clean 属于 stale audit evidence；绑定 proved non-ancestor 的
  clean 只作审计，并在重新归约前移除。只有 unknown relationship 经有界重试后写入
  `ancestry-unverified` 的稳定 `error`。
- Ancestor checks 会对照 exact 40-hex `base...head` request，校验 documented REST commit-comparison fields 及其 closed relationship/count matrix。Unpaginated `commits` list 必须含有 `min(ahead_by, 250)` 个 unique full-SHA entries，排除 base 和 merge-base commits，且非空时 final entry 必须绑定 requested head。Checks 会忽略 undocumented `head_commit`，不会额外 GET head commit，并对任何 schema 或 relationship 矛盾 fail closed。Unknown relationship 会经过有界重试，随后写入描述为 `ancestry-unverified` 的稳定 `error`。
- Sticky state、controlled markers、baselines、deadlines、recovery mode 和 status
  history 只用于 request orchestration、retry、liveness、审计和幂等；它们不会授权或
  拒绝 provider evidence。Rerun 会重建当前 evidence，并可在更晚但 stale 的 `pending`
  或 `error` status 之后重新写入 `success`，包括采用早先 marker deadline 后才创建的
  valid clean artifact。
- Optional status-deduplication GET 使用独立的 best-effort 上限：每页 100 statuses、最多 10 页或 1,000 items、每个 response 1 MiB、总计 4 MiB、16 次 fetch attempts。它会先选择同一 context 的第一条（newest）record，再校验 producer identity；失败或超限只记为 `readFailed`，不污染 review evidence。Receipt mode 总会 POST 当前 attempt 的 computed status；receipt mode 之外，`readFailed` 也会触发 direct POST。
- Review-evidence budget failure 会广播 abort active evidence requests，并在有界重试后
  变为 `error`。Evidence issue 与已确认 blocking finding 同时出现时，`failure` 优先，
  且 summary 会提到 evidence issue；没有 confirmed finding 时，evidence issue 写
  `error`。
- Retryable REST/GraphQL response 会遵守不超过 10 秒的合法 `Retry-After`。更长 delay 立即停止，缺失或 malformed value 使用有界 fallback retries；该 header 不会扩展现有 retry-safe method/status 集合。
- 旧 short-SHA clean result 只在判定旧 unthreaded finding 是否被 supersede 时惰性解析。
- Transient acquisition 和 reconciliation faults（包括 evidence-budget exhaustion）会先
  做有界重试，再写入稳定 `error`。Deterministic malformed、provider schema、identity、
  commit-binding 或 ancestry conflict 在没有 confirmed finding 控制 mixed result 时也写
  `error`，并以非零状态退出。
- 默认 retry/liveness windows 保持精确不变：首次 acknowledgement 300 秒、最大
  acknowledgement backoff 1,800 秒、acknowledged result 3,600 秒、overall 7,200 秒。
  `eyes` 只把 `waiting_ack` 变为 `waiting_result`，不会 reset 或延长任何 deadline。
  推荐 schedule 每 2 小时检查 retry deadlines；这些 windows 不限制 provider-artifact
  validity。

## 反馈和报告

使用 [GitHub issues](https://github.com/JoeyTeng/codex-review-gate-action/issues) 报告 action bug、异常 gate 行为、文档缺口或 Marketplace listing 问题。如果 pull request 收到有问题的 AI-generated review content，请先使用 GitHub 对该 comment 或 review 的正常报告和反馈工具；如果它和本 action 的 gate 行为有关，再在 issue 中附上链接。

## Source 和开发

这个仓库是 Marketplace release package。开发、CI 和 self-gating workflows 维护在 [JoeyTeng/codex-review-gate](https://github.com/JoeyTeng/codex-review-gate)。
