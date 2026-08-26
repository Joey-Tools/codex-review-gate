# Codex Review Gate v2

语言：[British English (en-GB)](README.md) | [简体中文 (zh-CN)](README.zh-CN.md)

Codex Review Gate 把单个 PR 上可信的 OpenAI Codex review 证据归约为 required
commit status `codex/github-review-gate`。每次运行都从 GitHub 重建决策；数据库、
workflow artifact、sticky comment 或旧运行都不是决策 authority。

公开 Action 从
[`JoeyTeng/codex-review-gate-action`](https://github.com/JoeyTeng/codex-review-gate-action)
发布；canonical source、测试和发布自动化位于
[`Joey-Tools/codex-review-gate`](https://github.com/Joey-Tools/codex-review-gate)。

## 安装完整消费者契约

消费者使用 floating major：

```yaml
- uses: JoeyTeng/codex-review-gate-action@v2
```

仅有这个 step 不算完成安装。请复制完整
[canonical workflow](https://github.com/Joey-Tools/codex-review-gate/blob/master/templates/codex-gated-repo/.github/workflows/codex-review-gate.yml)，
并导入附带的
[disabled ruleset 模板](https://github.com/Joey-Tools/codex-review-gate/blob/master/templates/codex-gated-repo/rulesets/codex-review-gate.json)。
复制的 workflow 负责 triggers、typed dispatch inputs、permissions、concurrency、
runner 启动前事件过滤和稳定 status context。reusable workflow 不是 v2 consumer
ABI。

ruleset 必须同时要求四个服务器端条件：

- `codex/github-review-gate`，expected source 为 GitHub Actions；
- branch up to date；
- 所有 review conversations 均已 resolved；
- 禁止 default branch 的 non-fast-forward updates。

在无害 canary 证明实际 status source 和完整接线前，保持导入的 ruleset disabled。
[人类可读指南](https://github.com/Joey-Tools/codex-review-gate/blob/master/docs/install/human.zh-CN.md)
向人解释安装流程；
[agent 可执行指南](https://github.com/Joey-Tools/codex-review-gate/blob/master/docs/install/agent.zh-CN.md)
让 agent 代替人执行同一套安装。

## Trigger 契约

canonical workflow 只有以下入口：

- activity type 为 `edited` 的 `pull_request_target`，且只允许实际 retarget 回
  repository default branch；
- activity types 为 `created` 和 `edited` 的 `issue_comment`；
- 为单个明确指定 PR 运行的 `workflow_dispatch`。

没有 cron、`repository_dispatch`、宽泛的 `pull_request` reset job 或可写 status
的自动 `pull_request_review` job。review objects 和 reaction-only completion 由
之后的 reconcile 发现。

只有 event sender 和 comment author 都是 exact Codex provider
`chatgpt-codex-connector[bot]`、GitHub type `Bot` 时，自动 comment job 才会在
runner 分配前被 admit。Action 在 runner 启动后再次校验 identity 和 scope。
edited Codex comment 可能使旧决策失效，所以 `created` 与 `edited` 都必须 admit。
base-retarget job 同样在 runner allocation 前筛选：title、body 或其他 edit 不会启动
runner。符合条件的 retarget 会立即把 unchanged head 上持久化的旧 success 改为 pending。

manual run 使用受保护 default branch 上的 workflow；feature-ref dispatch 不受
支持。typed `workflow_dispatch` business inputs 是：

| Input | 类型 | 契约 |
| --- | --- | --- |
| `operation` | choice | `reconcile` 或 `begin-review`；默认为 `reconcile`。 |
| `pr_number` | number | 必填 canonical positive PR number；每次只处理一个 PR。 |
| `expected_head_sha` | string | 必填完整 expected PR-head SHA；stale run 绝不跟随不同 head。 |
| `request_comment_id` | string | 可选 evidence-location hint；绝不是 authority。 |
| `request_review` | boolean | 默认为 `true`；控制 `begin-review` 是否发送 request。 |
| `limits_profile` | choice | `default` 或 `expanded`；默认为 `default`。 |

所有 dispatch values 都是不可信输入，必须与 GitHub 重新校验。inputs 不能提供
verdict、provider identity、status context、stale override、数值型 resource
limit，或跳过 full reconcile 的权限。只有在 runtime 证明没有跳过任何更新的相关
证据后，hint 才能帮助 early stop。GitHub 在 Action boundary 会把 typed numeric
`pr_number` 暴露为 string；Action 仍要求其为 canonical positive decimal
representation。

Action step 使用对应的 underscore 命名 inputs：`github_token`、`pr_number`、
`expected_head_sha`、`operation`、`request_comment_id`、`request_review` 和
`limits_profile`。`github_token` 与 `pr_number` 必填。manual run 必须提供完整
`expected_head_sha`；自动 comment 路径可以留空，让 runtime 在启动时绑定
authoritative head。两条路径都不能跟随之后发生的 head change。

## Operations

### `begin-review`

`begin-review` 校验 exact PR 和 expected head，在该 head 上建立 pending，并默认
发送一条带 canonical hidden binding 的 fresh exact `@codex review` request。
`request_review=false` 只建立 pending；这是 advanced best-effort option，不会增加
专用 cross-job barrier。

同一 PR 的 runs 使用 `cancel-in-progress: false` 串行化。GitHub 仍可能替换尚未
启动的 pending workflow run，所以必须观察 exact `begin-review` run 完成，才能把
它视为 barrier 或发送依赖它的 request。

普通低成本路径中，agent 可以在其他 checks 运行时直接发送 exact
`@codex review`，只在需要 reconcile 时调用 GHA。workflow 必须协调 pending
transition 和 request 时使用 `begin-review`；这也包括旧 success 后的 deliberate
same-head re-review。

### `reconcile`

`reconcile` 首先重读所选 PR。只有其 head 仍等于绑定的 expected head 时，它才会
把该 exact SHA 的 gate status 改为 pending 并收集证据。它绝不把本次运行重定向到
new head，也不向 new head 写入本次决策。head 变化必须由之后的新运行处理。

reducer 读取符合条件的 Codex top-level issue comments 和 PR review bodies。
inline review threads 有意留在 reducer 外；ruleset 的 “all conversations
resolved” 要求才是其 authority。

## Evidence 语义

review generation 始于一条 exact、未编辑的 `@codex review` request。visible first
line 必须 exact，且不得有其他 visible text。普通 request author 默认需要
`write`、`maintain` 或 `admin` 权限；受保护 default-branch configuration 可以明确
放宽为 `any`。workflow-authored request 还必须带 canonical v2 hidden marker，绑定
完整 head SHA、当前 base repository/ref/SHA 和 workflow run。符合条件的 Codex
findings 不受 request-author permission 影响，始终阻塞。

每个 snapshot 还读取 GitHub PR timeline 中最新的 `BaseRefChangedEvent` 或
`BaseRefForcePushedEvent`。positive request/clean authority 必须严格晚于该 base
epoch；timestamp 相同属于歧义，保持 pending。provider terminal payload 不会标明
产生它的 request 或 base snapshot，因此一旦 PR 出现过 base epoch，就采用更窄的
recovery rule：只有直接附着在 epoch 后、绑定当前 base 的 canonical workflow request
上的合格 provider `+1`，才能提供 positive clean authority 或 supersede 旧 finding。
没有 base epoch 的 PR 仍支持无需 workflow marker 的 ordinary direct
`@codex review`。findings 在 epoch boundary 两侧始终保守阻塞；无法归因的 terminal
clean 保持 pending，runtime 不会猜测它属于新 generation。

除此 base-epoch lineage 例外外，terminal clean 文本和符合条件的 provider `+1`
具有相同 clean authority。
terminal evidence 指定 reviewed commit 时，可以使用 full 或 short SHA。只有
GitHub 能把 short SHA 无歧义解析为 current PR head 时才接受；对于 PR review，
resolved SHA 还必须与 review 原生 `commit_id` 一致。

任何符合条件的 current-head non-inline finding 都会立即阻塞。在同一个 head 上，
旧 finding 只有同时满足以下条件才能被 supersede：

1. 存在严格更新的 authorised review generation；
2. 随后出现绑定该 generation 和 head 的 clean result。

任意更晚的 clean 不能抹掉 findings。ordering 或 binding 有歧义时不能 pass。
historical findings 仍保留在 diagnostics 中。

## 稳定 clean 和 limits

finding 可以由第一次完整 observation 直接判定 failure。只有 clean candidate 必须
通过两次独立、fully paginated 的 GitHub snapshots，两次间隔 5 秒。每个 snapshot
都覆盖固定 PR lifecycle、base 和 head，以及最新 filtered base-change/force-push
timeline epoch；request IDs、revisions、authors 与
reactions；符合条件的 Codex comments/reviews 的 identities、times、actor/App
identity 和 body digests；reviewed-SHA resolution 与原生 review `commit_id`；
以及 pagination 与 exact-refetch completeness。

两次读取之间，head 和 decision-relevant fingerprint 必须相同。同一 head 上新的
request、edit、reaction 或其他 relevant evidence change 会重启 stability window。
head/lifecycle mismatch 会使运行 stale。API、pagination 或 cap failure 是
incomplete observation，绝不是 stability 证据。若 reconcile budget 内无法得到
stable clean pair，gate 保持 pending，等待之后的 provider event 或 manual
reconcile。

reviewed profiles 固定如下：

| Profile | Pages | Raw objects | API attempts | Snapshot | Request timeout | Reconcile budget |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `default` | 20 | 2,000 | 128 | 32 MiB | 10 s | 60 s |
| `expanded` | 100 | 10,000 | 512 | 64 MiB | 20 s | 300 s |
| hard ceiling | 1,000 | 20,000 | 2,048 | 64 MiB | 30 s | 720 s |

page size 为 100，每个 response 上限为 8 MiB，inter-read delay 为 5 秒，job timeout
为 14 分钟。仓库可以持久选择 `expanded`。v2.0 不支持每次 dispatch 临时提供
任意数值 override。

## Public result ABI

Action 精确暴露四个 public outputs：

| Output | Values | 含义 |
| --- | --- | --- |
| `execution_health` | `healthy`、`unhealthy` | evaluator 是否可信地完成执行。 |
| `gate_outcome` | `success`、`failure`、`pending`、`not_applicable`、`unknown` | review-gate 决策。 |
| `recovery_code` | 下列 closed set | 安全 next-action 类别。 |
| `retry_safe` | boolean | 使用相同 inputs 立即 retry 是否是有效恢复操作。 |

`recovery_code` closed set 是：

```text
none
wait_provider
reconcile
fix_findings
request_clean_generation
retry_reconcile
wait_then_reconcile
use_expanded_limits
raise_protected_limit
refresh_head
repair_permissions
retry_begin
unsupported_target
```

workflow conclusion 报告 execution health；expected PR head 上的 status 报告 gate
outcome。finding 通常得到 `healthy/failure`，而不是 execution error。
`unhealthy/success` 非法。`status_projection` 与 finding counts 只出现在 summary，
不是 public Action outputs。

无需额外 evidence query 即可推导时，sticky diagnostic 和 Actions summary 会报告：

- `findings_unresolved`；
- `findings_resolved`；
- `findings_historical`；
- `findings_indeterminate`。

API 读取、pagination 不完整或 cap hit 会使受影响 counts 为 `unknown`，绝不能写成
`0`。这些 counts 只覆盖 normalized non-inline reducer findings，不能替代
conversation-resolution enforcement。

authority 和 consistency 模型见 [DESIGN.zh-CN.md](DESIGN.zh-CN.md)，恢复操作见
[COOKBOOK.zh-CN.md](COOKBOOK.zh-CN.md)。

## Exact-head merge closure

success 是一次 observation，不是永久 lease。merge 前，agent 必须立即用 exact
current head dispatch `reconcile`，并在一次 final read 中同时要求：

- Action result 为 `healthy/success`；
- 同一 head 上来自 GitHub Actions 的 `codex/github-review-gate` 为 success；
- PR head 保持不变；
- branch up to date；
- 所有 review conversations 均已 resolved；
- ruleset 允许 merge。

任一项变化都必须停止，并对新的 current state 重新 reconcile。

## 支持边界

stable v2.0 支持 GitHub.com public/private repositories；以 default branch 为 base
的 open、non-draft PR 及普通 same-repository branches；GitHub-hosted Linux
runners（优先 `ubuntu-slim`，采用 `ubuntu-latest` fallback）；以及普通 merge、
squash 和 rebase methods。

GHES、forks、merge queues、non-default bases、drafts、bot-owned PRs、
self-hosted/Windows/macOS runners，以及对 closed/merged PR 发起的新 operation 都会
fail closed。

runtime 只调用 API，不 checkout 或执行 consumer/PR code，不上传 artifacts，不保留
raw API payload，也不引入 runtime GitHub App。diagnostics 只是 best effort，绝不
是 authority。

## v1 边界

现有 v1 consumers 在明确迁移前保持有效。v2 不 rewrite、republish 或 fallback 到
v1。消费者可以在一个 PR 中移除 v1 并安装 v2，再用单独的无害 PR 验证已安装的
`@v2` gate；该 canary PR 验证后直接关闭，不 merge。

## 反馈

公开 package 问题请提交到
[`JoeyTeng/codex-review-gate-action`](https://github.com/JoeyTeng/codex-review-gate-action/issues)。
