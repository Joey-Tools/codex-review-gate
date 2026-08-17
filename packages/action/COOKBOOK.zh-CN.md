# Codex Review Gate v2 Cookbook

语言：[British English (en-GB)](COOKBOOK.md) | [简体中文 (zh-CN)](COOKBOOK.zh-CN.md)

本文记录 v2 public boundary 和 pre-activation check，但不授权 production activation：
controller 与 scheduled dispatcher 已通过本地门禁，publication admission 和 live
activation proof 仍是 P0 前置条件。

## 选择正确入口

普通仓库的目标调用只能是 organization-owned trusted reusable workflow：

```yaml
jobs:
  codex-review-gate:
    uses: Joey-Tools/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v2
    with:
      pull-request: ${{ github.event.pull_request.number || github.event.issue.number || inputs.pull-request || '' }}
      selection-policy: joey-default
      controller-mode: ordinary
      observation-boundary: initial
```

Caller 只授予：

```yaml
permissions:
  contents: write
  id-token: write
  issues: write
  pull-requests: write
  statuses: write
```

`@v2` 是公开 release alias。Release pipeline 把它发布到 immutable signed v2 commit，
reusable workflow checkout 精确选中的 workflow object。不要替换成以下任一种：

```yaml
- uses: Joey-Tools/codex-review-gate-action@v2
- uses: JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1
```

第一种只是 plan adapter，第二种是冻结的个人 v1 archive；两者都不是 v2 consumer gate。

## Pre-activation checklist

在每一项都得到证明前，仓库保持 fail closed：

1. 已 review 的 release 包含所有启用 event/scan path 的完整 caller、closed controller
   input、durable scheduled dispatcher 与 automatic effect protocol。
2. Generated caller 选择 organization reusable workflow `@v2`，而不是 composite
   Action 或个人 archive。
3. 三个 public-wait environment 存在并配置精确 15 分钟 wait timer：
   `codex-review-gate-public-initial-15m`、
   `codex-review-gate-public-post-request-15m`、
   `codex-review-gate-public-no-start-15m`。
4. Trusted Environment API preflight 已读取并校验这些 protection rule；environment
   name 一致并不够。
5. Live canary 证明 server time 和 observation boundary 会拒绝 early environment
   release，且不会 authorize request 或 terminal write。
6. Controller-owned concurrency 对同一 repository、PR 和 review epoch 串行化 effect。
7. 前面所有检查成功前，ruleset 不得 require `codex/github-review-gate`。

Release package 中的 `codex-review-gate-reconcile.yml` 是用于校验 orchestration shape
的 template/contract fixture。它不是 hosted central router，也不是 production
activation evidence。

## 校验 scheduled fan-out

Schedule route 必须保持一个 protected coordinator，随后才是串行 matrix fan-out：

- 只有 coordinator 接收 `scan-all-open` 与空 pull-request；
- output 必须直接用 `fromJSON(needs.schedule-dispatch.outputs.matrix)` 解析；
- 每个 enabled row 传递 coordinator 的 pull-request number 与原始
  `dispatch_binding`，不能使用 caller selector，也不能重新编码对象；
- matrix 必须使用 `max-parallel: 1` 与 `fail-fast: false`；
- 每个 scheduled leg 必须先 rehydrate durable reservation，再 acquire lease，最后
  release 并且只 ack 该 candidate；
- empty inventory 输出一个 disabled sentinel；已经 attempt 的 candidate 必须进入
  recovery，不能再次进入 matrix。

如果 caller 自行枚举 open pull requests、从 input PR number 构建 row、用 `toJSON`
转换 binding、并行执行 scheduled rows，或遗漏 `matrix.enabled` step guard，必须拒绝。

## 校验 selected major

启用 generated caller 前，只检查它的 callsite 和 selected repository/ref：

```text
repository: Joey-Tools/codex-review-gate-action
workflow: .github/workflows/codex-review-gate.yml
release alias: v2
status context: codex/github-review-gate
```

如果 caller 引用 `JoeyTeng`、`@v1`、direct root Action、copied runtime file 或本地自造
controller mode，应拒绝 activation。

v2 repository 可以保留 `src/core.mjs`、`src/gate.mjs`、`decision-table.json` 和
`producer-receipt.schema.json`，因为其 history 包含 v1 archive；这些 path 不会选择
runtime。v2 target 不得有 `v1*` branch/tag selector，v2 controller 也不存在 fallback
到 v1 reducer 的 code path。

## 解读 adapter run

Composite adapter 接受一份 trusted、controller-generated operation input，并返回
`RUNNER_TEMP` 下的 file。它只用于实现或测试 controller。

普通 adapter result 可能包含：

- closed reducer `decision`；
- canonical rich public v2 report（compact reducer result 仅供内部使用）；
- status plan；
- request reservation 或 retry-zero intent；
- exact-201 binding plan。

这些结果不表示 GitHub 上已经存在 status、comment、sticky projection 或 ledger record。
不要把 adapter plan 暴露给后续 untrusted job、上传为 execution command，或把 green step
解释为 gate success。

如果 adapter 尝试 non-read transport 或报告已经执行 write，应把 invocation 视为 invalid。
Durable reservation、pre-effect attempt recording、单次 remote effect、response binding、
sticky projection 和 final status 都属于 trusted workflow controller，而不是 adapter。

## Manual evaluation

`evaluate-only` 是 controller-owned manual route。它不得 publish status 或 request review。
它可用于校验 projected snapshot，但 clean evaluation 不是 remote gate result，也无法满足
branch protection。

不要用 `evaluate-only` 绕过 activation gate 或制造 success status。等 assembler 受到支持
后，manual caller 仍必须由 trusted assembler 生成。

## 诊断常见 blocked outcome

### `blocked-configuration`

检查 trusted workflow selection、required ruleset/source binding、GitHub App binding、
public-wait environment 和 activation evidence。不要通过 composite 重试，也不要 fallback
到 v1。

### `blocked-input`

检查 PR lifecycle、精确 base/head/merge-base/test-merge epoch、canonical input schema 和
controller-generated path ownership。PR-controlled checkout file 不是有效 operation input。

### `inconclusive`

检查完整 pagination、scope stability、final reread、evidence grammar、request limit 和
durable controller history。在出现新的完整稳定 observation 前保留该 outcome，不得改写为
clean。

### `findings`

把 selected trustworthy finding 当作 blocking negative evidence。通过 provider-supported
review flow 解决 finding，再让后续 controller observation 重建完整 snapshot。不要编辑
controller state 来抹掉 finding。

### `pending`

只能通过 generated orchestration 跟随 `due-at` 和 `wakeup-hints`。它们是 scheduling
advice，不是 evidence。Public route 要求 configured environment wait 及随后的
server-time-bound observation；sleeping shell step 或立即 rerun 不等价。

### `skipped-unavailable`

这是 implicitly selected route 在 confirmed no-start outcome 下的 closed v2 decision，
不会授权 v1 fallback。Explicitly requested route 缺少 provider configuration 时应保持
blocked。

## Request-effect recovery

Review-request publication 是 retry-zero。Controller 在唯一一次 POST 前持久化 reservation、
intent 和 pre-effect attempt，再绑定 exact 201 response。如果 POST result ambiguous，
不得 rerun 或 reclaim effect；应保留 ledger 并从 authoritative effect identity 调查。

Commit-status 和 sticky-comment effect 同样在执行前预留到 durable effect ledger。
Repeated invocation 可以复用已经 bound 的 response，但不得 replay 已 attempted、未 bound
的 identity。

## Status 和 branch-protection check

Gate 变为 required 前，live canary 必须证明：

- terminal policy 指向预期 test-merge commit；
- 需要时存在 documented head sentinel；
- latest exact context 是 `codex/github-review-gate`；
- remote effect receipt 绑定预期 repository、PR、epoch 和 response；
- final reread 通过 terminal write 保持稳定；
- early 或 missing public wait 会 fail closed。

Generic `github-actions[bot]` creator、相同 context text、composite success 或
runner-temp report path 单独都不充分。

## 从 v1 迁移

在 v2 activation 得到支持前，不要原地编辑现有个人 `@v1` caller。保留 frozen v1
workflow，同时准备单独命名的 v2 generated caller 和 canary。只有所有 v2 前置条件成功
后，才能按明确 repository rollout plan 把 required check 迁移到
`codex/github-review-gate`。

绝不要把 v1 `decision-table.json` setting 复制到 v2 controller input。V1 table 只对
policy major 1 有 legacy authority；v2 selection、evidence、decision、scheduling 和
effect ledger 都由各自的 closed schema 控制。

Trust/state model 见 [DESIGN.zh-CN.md](DESIGN.zh-CN.md)，公开接口见
[README.zh-CN.md](README.zh-CN.md)。
