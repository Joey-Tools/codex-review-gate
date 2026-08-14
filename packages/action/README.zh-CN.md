# Codex Review Gate v2

语言：[British English (en-GB)](README.md) | [简体中文 (zh-CN)](README.zh-CN.md)

Codex Review Gate v2 是一个 trusted reusable GitHub workflow（受信任的可复用工作流）：
它归并完整的 Codex provider evidence snapshot，控制 review request 和 status effect，
并发布 `codex/github-review-gate` commit status。

公开 v2 release repository 是
[`Joey-Tools/codex-review-gate-action`](https://github.com/Joey-Tools/codex-review-gate-action)。
个人仓库 [`JoeyTeng/codex-review-gate-action`](https://github.com/JoeyTeng/codex-review-gate-action)
是冻结的 v1 archive，不是 v2 来源。

> [!CAUTION]
> 目前还不支持 production activation。Production controller-input assembler、
> durable scheduled dispatcher 与 automatic effect chain 已实现并通过本地门禁，
> 但 publication admission 和 live activation proof 仍是 P0 前置条件。在
> environment-wait preflight、必要 live canary、exact-SHA consumer rollout 与
> ruleset switch 完成前，不得把 `codex/github-review-gate` 加为 required check。
> 缺失或未经验证的 activation evidence 必须 fail closed。

## 支持的公开边界

普通 consumer 调用 trusted reusable workflow：

```yaml
jobs:
  codex-review-gate:
    uses: Joey-Tools/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v2
    with:
      pull-request: ${{ github.event.pull_request.number || github.event.issue.number || inputs.pull-request || '' }}
      controller-mode: ordinary
      observation-boundary: initial
```

`@v2` 是公开文档采用的 floating release alias（浮动发布别名）。Release pipeline
会解析并发布 immutable signed v2 commit；called workflow 则通过
`job.workflow_repository` 和 `job.workflow_sha` checkout 精确选中的 workflow
object。Consumer 把兼容的 v2 upgrade 委托给这个 release alias，不复制 runtime
文件，也不直接选择 composite Action。

上面的示例只是 interface specimen，不是 activation recipe。完整 production caller 是
已经 review 的 reconciliation graph；publication 后必须把其中每个 reusable call 都替换为
同一个已 admit 的 immutable release SHA，并满足[仓库激活](#仓库激活)中的前置条件。
Release package 内的 `.github/workflows/codex-review-gate-reconcile.yml` 只是
orchestration template/contract fixture，不是 central router；复制它不能证明可以安全
启用 production。

### 权限

Caller 提供以下 permission ceiling：

```yaml
permissions:
  contents: write
  id-token: write
  issues: write
  pull-requests: write
  statuses: write
```

Called workflow 无法提升 caller token 权限。`id-token: write` 与
`contents: write` 仅限 API-only controller jobs，用于给 protected Git ledger 的每条
record 绑定 exact workflow provenance，并推进专用 ledger ref。Trusted controller
拥有全部 mutation ordering，且不会 checkout 或执行 pull-request code。

## Composite Action 仅生成计划

`action.yml` 是给 trusted controller implementation 使用的低层 adapter。它可以读取
一份完整 snapshot 并生成 closed v2 plan，但刻意不会 post comment、写 commit status、
持久化 effect ledger、执行 public wait 或完成 gate。

不要把下面的写法当作 consumer gate：

```yaml
- uses: Joey-Tools/codex-review-gate-action@v2
```

即便 composite invocation 使用 exact SHA，它仍然只生成计划。在 trusted controller
按规定顺序校验、持久化并执行之前，所有 output 都只是不可直接执行的 plan。Composite
step 成功绝不等于 review gate 成功，也不得注册为 required status check。

Adapter inputs 刻意面向 controller：

| Input | 说明 |
| --- | --- |
| `github-token` | 仅用于完整 read transport 的 token。 |
| `pull-request` | Canonical positive pull-request number。 |
| `operation` | `prepare-request`、`bind-request` 或 `evaluate-only`。 |
| `status-target-mode` | 必填且无默认值：`head` 或 `test-merge-with-head-sentinel`。`head` 只能发布 non-success sentinel；clean/skipped terminal publication 会被 suppressed。 |
| `operation-input-path` | 位于 `RUNNER_TEMP` 的 controller-generated canonical JSON；拒绝 checkout 和 PR-controlled path。 |

Outputs 是 canonical rich public v2 report 和 effect plan 的 runner-temp path；
compact reducer result 仅供 controller 内部使用：`decision`、
`result-path`、`report-path`、`status-plan-path`、`reservation-path`、
`intent-path`、`binding-receipt-path`。它们不是证明 remote effect 已发生的 receipt。

## Reusable workflow inputs 和 outputs

公开 `workflow_call` 边界接受：

| Input | 默认值 | 说明 |
| --- | --- | --- |
| `pull-request` | empty | Pull-request number；只有 controller-owned scan 可以为空。 |
| `selection-policy` | none | 必填的 closed repository selection policy。 |
| `controller-mode` | `ordinary` | Trusted workflow family 选择的 closed route；consumer 不得自造 mode。 |
| `observation-boundary` | `initial` | Closed scheduler observation boundary；它绝不是 provider evidence。 |

Workflow 会报告 controller-owned outputs，例如 `decision`、`report-path`、
`status-plan-path`、request reservation/binding path、sticky/effect-ledger receipt
path、`due-at` 和 `wakeup-hints`。这些 path 属于 called job 的 `RUNNER_TEMP`，
是 controller evidence，不是跨 job artifact API。只有 controller 的精确 remote-effect
receipt 和 final status 能证明 effect 已执行。

## Scheduled scan 与 dispatch

Reconciliation schedule 只会为 trusted coordinator 选择 `scan-all-open`。Coordinator
会创建或恢复 protected candidate inventory，在投影前持久化唯一 active dispatch
reservation，并且只发布 canonical GitHub matrix；它不会把 diagnostic all-open-PR
listing 当作 dispatch authority。

Fan-out 被刻意串行化（`max-parallel: 1`、`fail-fast: false`）。每个 enabled row 只携带
controller 生成的 pull-request number 与原始 canonical `dispatch_binding`，不得重建、
替换或自行选择 candidate。Scheduled leg 在 lease acquisition 前从 durable ledger
rehydrate 该 binding，然后执行 ordinary closed controller protocol、无退款 release lease，
并 durable ack candidate。Crash 后只会暴露同一个 active row 或 closed recovery state，
不会静默重新 dispatch 已尝试的 candidate。Empty cycle 使用一个 disabled sentinel row，
因此不会 prepare pull-request command。

## v2 如何决策

Reducer 的 closed decisions 是：

- `not-selected`
- `pending`
- `clean`
- `findings`
- `inconclusive`
- `skipped-unavailable`
- `blocked-configuration`
- `blocked-input`

Positive completion 要求 snapshot 完整且稳定、review epoch 当前、server enforcement
兼容，并且 provider evidence 通过 closed v2 authority。可信 finding 即便在其他 inventory
不完整时仍是 negative evidence。缺失配置、不稳定 scope、不完整 pagination、malformed
evidence 或未证明的 activation 绝不会变成 clean。

Controller 以 test-merge commit 为主要 target，并在需要时使用 head sentinel。Commit
status 是 reducer/scheduler 生成、由 trusted controller 在 durable reservation 后执行的
effect。Joey-Tools reusable workflow 始终传入
`test-merge-with-head-sentinel`，consumer 不能通过 variable 选择 production 值；公开
plan adapter 保留 `head`，仅用于上述 closed non-success/suppressed compatibility
contract。Request path 是 retry-zero：单次 POST 前必须持久化 intent 和 attempt state，
ambiguous attempt 不得 replay。

## 仓库激活

在以下条件全部经过独立 review 和证明前，activation 保持 blocked：

1. 已 review 的 release 包含每个支持 event/scan route 的 closed command assembler、
   durable scheduled dispatcher 与 automatic effect protocol，且 admitted release tree
   与这些 byte 精确一致。
2. 仓库存在 v2 workflow family 要求的三个 public-wait environment，且每个都配置精确
   15 分钟 wait-timer rule：`codex-review-gate-public-initial-15m`、
   `codex-review-gate-public-post-request-15m`、
   `codex-review-gate-public-no-start-15m`。
3. Trusted Environment API preflight 证明这些 rule，live canary 证明 early release 无法
   authorize request 或 terminal effect。
4. Generated caller 使用 organization `@v2` reusable workflow、本文 permission ceiling
   和 controller-owned concurrency。
5. 只有 canary evidence 成功后，repository ruleset 才能 require 精确的
   `codex/github-review-gate` context。

Environment name 本身不会配置或证明 wait timer。Copied fixture、绿色 composite step，
或 creator 为 generic `github-actions[bot]` 的 status 都不是 activation proof。

## v1 archive 边界

Release subtree 刻意保留 v1 implementation file、`decision-table.json` 和
`producer-receipt.schema.json`，让 transferred history 和 frozen v1 contract 仍可检查。
它们是 legacy、major-isolated artefact：

- `decision-table.json` 只继续作为 v1 policy table 的 authority。
- `src/core.mjs`、`src/gate.mjs` 和 producer receipt v1 不是 v2 runtime entry point。
- v2 不存在选择 v1 的 selector、compatibility fallback 或 downgrade path。
- v2 target repository 不得包含任何 `v1*` branch 或 tag selector。
- v2 configuration/evidence failure 只能保持 blocked/inconclusive，绝不调用 legacy reducer。

个人仓库的现有 v1 consumer 继续留在 frozen archive。迁移是等 activation gate 闭合后安装
organization v2 reusable workflow；把个人 `@v1` 改成 organization composite reference
不是有效迁移。

## Package map

- `.github/workflows/codex-review-gate.yml`：trusted public v2 controller entry。
- `.github/workflows/codex-review-gate-reconcile.yml`：orchestration template 和
  contract fixture，不是 central router。
- `action.yml`：plan-only composite adapter。
- `src/v2/workflow-controller.mjs`：trusted effect-ordering controller runtime。
- `src/v2/action.mjs`：composite plan adapter。
- `src/v2/transport.mjs`、`projector.mjs`、`reducer.mjs`、`scheduler.mjs` 及相关模块：
  closed v2 evidence/planning pipeline。
- `src/core.mjs`、`src/gate.mjs`、`decision-table.json`、
  `producer-receipt.schema.json`：保留的 legacy v1 archive。
- [DESIGN.zh-CN.md](DESIGN.zh-CN.md)：trust、state 和 effect-ordering design。
- [COOKBOOK.zh-CN.md](COOKBOOK.zh-CN.md)：pre-activation validation 和 recovery recipe。

## 反馈和开发

公开 package 问题请报到
[`Joey-Tools/codex-review-gate-action`](https://github.com/Joey-Tools/codex-review-gate-action/issues)。
Canonical development 和 release automation 位于
[`Joey-Tools/codex-review-gate`](https://github.com/Joey-Tools/codex-review-gate)。
