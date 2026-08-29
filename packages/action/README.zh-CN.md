# Codex Review Gate v2

语言：[British English (en-GB)](README.md) | [简体中文 (zh-CN)](README.zh-CN.md)

Codex Review Gate 把单个 PR 上可信的 OpenAI Codex review 证据归约为 native required
CheckRun `codex/github-review-gate`。GitHub 把 verifier run/job/CheckRun 记录在 exact PR
feature-head SHA 上。canonical
`pull_request` verifier 仍在 `refs/pull/N/merge` 上执行；Action 内部严格校验
`GITHUB_REF`、`GITHUB_SHA`、event head/base/test-merge SHAs 和 fresh PR read。受保护的
top-level `run-name` 还会让 GitHub 把
`codex-review-gate-verifier/<PR>/<current test-merge SHA>` 暴露为 run 的 exact
`display_title`；activation 同时要求 run 唯一的 PR binding 含 current feature head 与
default-branch base SHA。这些 receipts 把 successful feature-head CheckRun 绑定到 exact
current test-merge，但 CheckRun 本身并不挂在 test-merge SHA 上。每次 verifier run 都从
GitHub 重建决策；数据库、workflow artifact、sticky comment、controller run 或旧
verifier 都不是决策 authority。

公开 Action 从
[`JoeyTeng/codex-review-gate-action`](https://github.com/JoeyTeng/codex-review-gate-action)
发布；canonical source、测试和发布自动化位于
[`Joey-Tools/codex-review-gate`](https://github.com/Joey-Tools/codex-review-gate)。

## 安装完整消费者契约

消费者使用 floating major：

```yaml
- uses: JoeyTeng/codex-review-gate-action@v2
```

仅有这个 step 不算完成安装。完整安装包含三个完整必需资产组：

- 完整 two-workflow bundle：只读
  [canonical verifier](https://github.com/Joey-Tools/codex-review-gate/blob/master/templates/codex-gated-repo/.github/workflows/codex-review-gate.yml)
  与受保护 default branch 上的
  [canonical controller](https://github.com/Joey-Tools/codex-review-gate/blob/master/templates/codex-gated-repo/.github/workflows/codex-review-gate-controller.yml)；
- `.github/CODEOWNERS` 受管控制面，其最后生效的两条规则分别保护
  `/.github/workflows/` 与 `/.github/CODEOWNERS`；
- 附带的
  [disabled ruleset 模板](https://github.com/Joey-Tools/codex-review-gate/blob/master/templates/codex-gated-repo/rulesets/codex-review-gate.json)。

请使用 canonical
[`bootstrap-codex-review-gate.mjs`](https://github.com/Joey-Tools/codex-review-gate/blob/master/scripts/bootstrap-codex-review-gate.mjs)
helper 安装，并始终显式传入 `--control-plane-owner @USER`；不要手工重建 workflow
或受管 CODEOWNERS rules。所选 owner 必须是对 consumer repository 拥有 `write`、
`maintain` 或 `admin` 权限的 GitHub user。第一次 installation PR 合并前，必须取得该
owner 的独立 exact-head approval。首次 migration PR 只包含两份 canonical workflows 与
CODEOWNERS，不在其中修改 ruleset。合并前移除所有 legacy `codex/review-gate`
requirement 并不安全；应保留旧保护，把 canonical read-only legacy inventory
SHA-256 绑定进 owner approval snapshot，并在 final transaction fresh 重建、精确匹配。
Digest 绑定 repository/default branch、每个 matching ruleset 的完整 identity、source、
enforcement、target、conditions、`bypass_actors` 与 `rules`、完整 effective
`required_status_checks` rule，以及包括每个 check producer `app_id` 的完整 classic
required-status object。即使 legacy inventory 为空，也有绑定 repository/branch 的 digest；
API/schema 不完整或任何 drift 都 fail closed。
随后要求 authenticated actor 就是该 owner、fresh 重读 owner exact-head approval，并调用
synchronous exact-SHA merge endpoint。Merge 后先立即重读 current default，并要求 PR
确已 merged、base/head 仍精确等于 approved scope；readback 失败时保留全部 legacy
requirements active。Readback 成功后仍保留 legacy，另把 supplied v2 ruleset 以 Disabled
stage，通过无害 canary 证明，再 activate 并精确读回完整 Active policy。Cleanup 前每次
stage/activation preview 与 apply 都必须跨进程显式复用同一个 owner-approved digest，直到
该 Active readback。只有之后才可在单独授权下删除 inventoried legacy requirements；
cleanup 前先运行只读 `--derive-post-cleanup-plan`，携带同一个 external owner-approved
legacy-inventory digest（`--expected-legacy-inventory-sha256`），对完整 security snapshot
验证该 baseline，再派生 canonical、
human-reviewable plan 与外部 expected post-cleanup security SHA-256；唯一允许的 delta 是删除
`codex/review-gate`。只有 emptied classic required-status policy、emptied ruleset status
rule，以及不剩任何 rule 的 dedicated legacy-only ruleset 可以消失。Repository/default
head、workflow/CODEOWNERS inventory、owner permission、surviving classic policy 的全部
fields/non-legacy checks（包括 `strict`/`app_id`），以及每个 retained ruleset 的 identity、
conditions、bypass actors 与 unrelated rules 必须精确保留。另行授权 cleanup 后，只读
`--verify-post-cleanup` 必须通过 `--expected-post-cleanup-security-sha256` 携带该 external
digest，并且只有两轮相同的完整 security
snapshot 都匹配 expected digest、两个 legacy surfaces 均 clear 且同一 complete v2 policy
仍 Active 才通过。Derivation、cleanup 或 verification inconclusive 时保留 v2 Active，只运行
read-only diagnostics；不得 disable 或 rollback v2。
仅有 approval 与 head reread 不足以闭环。

复制的 workflows 分别负责 triggers、typed dispatch inputs、permissions、独立
concurrency namespace 与 runner 启动前事件过滤。verifier 的 GitHub-managed job
CheckRun 是稳定 required signal。reusable workflow 与 commit-status bridge 都不是 v2
consumer ABI。

ruleset 必须同时要求以下服务器端条件：

- `codex/github-review-gate`，expected source 为 GitHub Actions；
- branch up to date；
- 对受保护 workflow 与 CODEOWNERS paths 要求 Code Owner review；
- push 后 dismiss stale approvals；
- 所有 review conversations 均已 resolved；
- 禁止 default branch 的 non-fast-forward updates；
- bypass actors 为空。

GitHub required check 的 `integration_id: 15368` 只标识整个 GitHub Actions App
（the entire GitHub Actions App），不能只标识任一 workflow。两份 canonical workflow
exact-byte verification、fail-closed workflow inventory、受管 CODEOWNERS、required Code
Owner review、stale-approval dismissal、strict up-to-date、no bypass actors 与 canary
collision checks 共同构成 compound control-plane boundary；这不是单一 workflow 的
cryptographic proof。

在无害 canary 证明实际 native CheckRun source 和完整接线前，保持导入的 ruleset disabled。
[人类可读指南](https://github.com/Joey-Tools/codex-review-gate/blob/master/docs/install/human.zh-CN.md)
向人解释安装流程；
[agent 可执行指南](https://github.com/Joey-Tools/codex-review-gate/blob/master/docs/install/agent.zh-CN.md)
让 agent 代替人执行同一套安装。

## Trigger 契约

canonical verifier 只有一个入口：

- activity types 为 `opened`、`reopened`、`synchronize` 与 `ready_for_review` 的
  `pull_request`。

受保护 default branch 上的 controller 只有以下入口：

- activity types 为 `created` 和 `edited` 的 `issue_comment`；
- 为单个明确指定 PR 运行的 `workflow_dispatch`。

没有 cron、`repository_dispatch`、`pull_request_target`、可写自动
`pull_request_review` job、runtime GitHub App 或 status writer。review objects 和
reaction-only completion 由之后的 authoritative verifier reconcile 发现。

只有 event sender 和 comment author 都是 exact Codex provider
`chatgpt-codex-connector[bot]`、GitHub type `Bot` 时，自动 comment job 才会在
runner 分配前被 admit。Action 在 runner 启动后再次校验 identity 和 scope。
edited Codex comment 可能使旧决策失效，所以 `created` 与 `edited` 都必须 admit。
verifier 会在 PR 不是 same-repository、open、ready 或 current-default-base 时 fail
closed。`pull_request.edited` 被明确排除，所以 base retarget 不会生成 current verifier。
对于 ready PR，先转为 draft 再 mark ready；对于已经是 draft 的 PR，直接 mark ready。
新的 `ready_for_review` event 会为新的 exact head/base/test-merge scope 创建 verifier；native rerun
旧 event 不能代替这一步。

manual run 使用受保护 default branch 上的 workflow；feature-ref dispatch 不受
支持。typed `workflow_dispatch` business inputs 是：

| Input | 类型 | 契约 |
| --- | --- | --- |
| `operation` | choice | `reconcile` 或 `begin-review`；默认为 `reconcile`。 |
| `pr_number` | number | 必填 canonical positive PR number；每次只处理一个 PR。 |
| `expected_head_sha` | string | 必填完整 expected PR-head SHA；stale run 绝不跟随不同 head。 |
| `request_comment_id` | string | 可选 evidence-location hint；绝不是 authority。 |
| `request_review` | boolean | 默认为 `true`；控制 `begin-review` 是否发送 request。 |

所有 dispatch values 都是不可信输入，必须与 GitHub 重新校验。inputs 不能提供
verdict、provider identity、required-check result、stale override、limits profile、
数值型 resource limit，或跳过 full reconcile 的权限。只有在 runtime 证明没有跳过任何更新的相关
证据后，hint 才能帮助 early stop。GitHub 在 Action boundary 会把 typed numeric
`pr_number` 暴露为 string；Action 仍要求其为 canonical positive decimal
representation。

controller Action step 使用对应的 underscore 命名 inputs：`github_token`、`pr_number`、
`expected_head_sha`、`operation`、`request_comment_id` 与 `request_review`。
`github_token` 与 `pr_number` 必填。manual run 必须提供完整
`expected_head_sha`；自动 comment 路径可以留空，让 runtime 在启动时绑定
authoritative head。两条路径都不能跟随之后发生的 head change。两份 Action steps 只从
受保护 repository variable `CODEX_REVIEW_GATE_LIMITS_PROFILE` 获得 `default` 或
`expanded`；dispatch caller 不能覆盖该值。

## Operations

### `begin-review`

`begin-review` 校验 exact PR 和 expected head，并默认创建或安全采用一条带 canonical
hidden binding 的 fresh exact `@codex review` request。它先精确读回该 request，再请求
exact current verifier 的 full rerun。`request_review=false` 是 advanced best-effort
option，不会增加专用 barrier。

同一 PR 的 controller runs 使用 `cancel-in-progress: false` 串行化。controller 记录
verifier attempt `A`、要求没有 competing canonical attempt、只请求一次 full rerun，
并必须观察 exact attempt `A+1` 及其唯一 canonical job/CheckRun。POST 不确定或新 attempt
不可见时仍保持 blocking；concurrency 只是 scheduling，不是 mutation fence。

普通低成本路径中，agent 可以在其他 checks 运行时直接发送 exact
`@codex review`，只在需要 reconcile 时调用 GHA。workflow 必须协调 pending
transition 和 request 时使用 `begin-review`；这也包括旧 success 后的 deliberate
same-head re-review。

### `reconcile`

`reconcile` 重读所选 PR，并定位 native CheckRun 挂在 current feature head、run 绑定
current test-merge 的唯一 canonical verifier。
随后使用同一套 baseline/rerun/readback handshake 建立严格更新的 full verifier attempt。
controller 不提供 verdict，也不改写 CheckRun；只有只读 verifier 收集证据，其 native job
conclusion 承载 required result。

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

terminal clean 文本和符合条件的 provider `+1`，只有在没有 base epoch、single-flight
lineage 的第一个物理 generation 中才具有相同 clean authority。每条物理 request
comment 都是 generation boundary，同一次 workflow run 的 duplicate hidden markers
也不例外。没有 base epoch 时，严格位于第一个 request 与后继 request 之间的 provider
terminal evidence 只能闭合第一个 gap。之后的每个 gap，以及任何前面已有物理 request
的 generation 所需 positive clean/superseding authority，都必须来自直接附着于该
request 的合格 `+1`。terminal payload 没有 originating request ID，无法证明它属于
新 request，还是旧 generation 的延迟或重复 carrier，因此不能让新 generation pass
或 supersede findings。出现 base epoch 后，连第一个 gap 也必须使用 request-bound
`+1`。

同一个或更晚的 official `eyes`/provider progress 如果不晚于后继 boundary，会让前一个
generation 保持 open；与后继 boundary 同时属于 timestamp-ordering ambiguity，不能
证明 review 已经完成。最新 request 的 clean 不能跨过更早的 unclosed gap，后继
boundary 之后才到达的 evidence 也不能倒推修复该 gap。带有单一、无歧义 commit
binding 的 progress 会直接归入对应 head。unbound edited progress 被视为从
`created_at` 到当前 revision time 的闭区间；只有两个端点及区间内每条物理 boundary
始终唯一绑定到同一个其他 full head 时，才能作为 historical 排除。缺少 origin、
ordinary/conflicting boundary、区间内 head transition，或任一端点与 boundary 同时，
都必须在 current-head inventory 中保持 fail-closed。
ordinary request reactions 仅用于 provider liveness；ordinary `+1` 本身不能
head-bind clean。same-time/later official `eyes`/progress from Codex 会 veto candidate
clean，因为 review activity 尚未被证明 terminal。reaction-only change 没有 automatic
workflow event，必须由 later provider event or manual reconcile 重新观察。
terminal evidence 指定 reviewed commit 时，可以使用 full 或 short SHA。只有
GitHub 能把 short SHA 无歧义解析为 current PR head 时才接受；对于 PR review，
resolved SHA 还必须与 review 原生 `commit_id` 一致。

任何符合条件的 current-head non-inline finding 都会立即阻塞。在同一个 head 上，
旧 finding 只有同时满足以下条件才能被 supersede：

1. 存在严格更新的 authorised review generation；
2. 随后出现符合上述 lineage rule、绑定该 generation 和 head 的 clean result：只有
   no-base-epoch 的第一个 generation 可以使用 unbound terminal，其他情况必须使用
   合格的 request-bound `+1`。

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
create_verifier_run
```

finding 通常得到 `healthy/failure`，而不是 execution error；`unhealthy/success` 非法。
在 verifier workflow 中，只有被证明稳定的 `healthy/success` 可以成功结束；findings、
pending evidence、unsupported scope、cancel、timeout 与全部 unhealthy 结果都保持
blocking。required verifier CheckRun 属于 exact current PR feature-head SHA；它的
`pull_request` run 在 `refs/pull/N/merge` 上执行，Action 的 environment/event/fresh-read
校验把 success 绑定到 unchanged head、base 与 test-merge。controller 的
CheckRun 绑定 default-branch commit，绝不是 required PR signal。
direct status projection 与 `status_projection` 已删除。finding counts 仍只出现在 summary，
不是 public Action outputs。

`healthy/pending` 不能安全授权 success，即使 evaluator 已可信地完成执行；它不是
弱化的 success。每一种结果（包括 pending 与 not-applicable）都必须按自己的
`recovery_code` 前进；only `wait_provider` 是无需 repair 或 reconcile 的 pure wait。

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
current head dispatch controller `reconcile`，观察严格更新的 verifier attempt 与其唯一
canonical CheckRun，并在一次 final read 中同时要求：

- Action result 为 `healthy/success`；
- exact current feature-head SHA 上来自 canonical verifier 的
  `codex/github-review-gate` 为 success，且该 run 绑定同一个 current test-merge；
- PR head、base 与 test-merge SHA 保持不变；
- branch up to date；
- 所有 review conversations 均已 resolved；
- ruleset 允许 merge。

任一项变化都必须停止，并对新的 current state 重新 reconcile。否则立刻用以下
exact-head compare-and-swap 完成 merge：

```bash
gh pr merge "$PR_NUMBER" \
  --repo "github.com/$REPO" \
  --match-head-commit "$HEAD_SHA"
```

跳过此 closure 的 direct human UI merge 不受支持。

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
