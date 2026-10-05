# Codex Review Gate v2 设计

语言：[British English (en-GB)](DESIGN.md) | [简体中文 (zh-CN)](DESIGN.zh-CN.md)

## 目标

v2 为单个 PR 提供低成本、fail-closed 的 native required CheckRun。存在符合条件的 Codex
finding、证据不完整或不稳定，或者所选 PR head 已变化时，它绝不能报告 success。
它优先从 GitHub 当前状态恢复，而不是依赖持久私有状态；write 结果不确定时，允许
少量 at-least-once duplicate。

现有 GitHub controls 保持各自原生职责：

- GitHub 保存 PR lifecycle、comments、reviews 和 reactions；
- 两份 copied consumer workflows 分别负责窄 event admission、permissions 和
  serialisation boundary；
- 受管 CODEOWNERS 与 Code Owner review 保护两份 workflows，作为 compound
  no-runtime-App control plane；
- Action 重建并归约 non-inline Codex evidence，并独立确认所有 PR review
  threads 均已 resolved；
- ruleset 要求 status、branch freshness、resolved conversations 和
  non-fast-forward protection；
- merge agent 通过 exact-current-head reconcile 和 final server-side reread 闭环。

Action 的 thread read 是独立的 fail-closed gate，不取代 ruleset 对 “all conversations
resolved” 的 server-side 要求。

## 架构和 trust boundaries

```text
pull_request opened/reopened/synchronize/ready_for_review
                                |
                                v
          copied read-only canonical verifier
                                |
          JoeyTeng/codex-review-gate-action@v2
          - bind PR head, base and test-merge SHA
          - validate refs/pull/N/merge, GITHUB_REF and GITHUB_SHA
          - refresh PR and require unchanged head/base/test-merge
          - fully paginate and reduce GitHub evidence
          - fully paginate PR review threads through GraphQL
          - require two stable snapshots for clean and resolved threads
                                |
                                v
 native CheckRun codex/github-review-gate on exact feature head
                                |
                                v
 ruleset: expected source + Code Owner review + stale dismissal
          + up to date + conversations resolved + no force-push

Codex issue_comment created               protected workflow_dispatch
                 |                                  |
                 +----------------------------------+
                                v
          copied protected-default-branch controller
          - exact pre-runner bot filter / typed inputs
          - create or adopt review request
          - establish and read back newer verifier attempt
                                |
                                +---- full rerun ----> verifier
                                +---- summary / best-effort sticky
```

受保护的 `workflow_run` completion ingress 也会在 canonical verifier 完成后进入同一
controller。只有现有的 opt-in 首次失败且 PR association 唯一的路径继续使用
`begin-review`；其他 eligible completion 使用 `report-completion` 输出 diagnostics，不会
rerun verifier。

### Consumer workflows

复制的 canonical verifier 与 controller 是可信 repository configuration，也是受支持的
consumer envelope。裸 Action step 无法负责 events、runner-admission filters、permissions、
typed dispatch 或 concurrency。

两份 workflows、受管 `.github/CODEOWNERS` 控制面与附带 ruleset 构成同一 installation
contract。canonical helper 安装两份 workflows，并写入最终生效的两条 CODEOWNERS rules，
分别保护 `/.github/workflows/` 与 `/.github/CODEOWNERS`；caller 必须通过
`--control-plane-owner @USER` 显式选择一位拥有 `write`、`maintain` 或 `admin`
权限的 GitHub user。第一次 installation PR 必须取得该 owner 对 exact current head
的 approval，因为尚未进入 base branch 的新 CODEOWNERS policy 不能自行强制 bootstrap；
但 approval 并不充分。旧保护保留到 merge；owner approval snapshot 绑定 canonical
read-only legacy inventory SHA-256，final transaction fresh 重建 strict inventory 并匹配该 external
digest。它绑定 repository/default branch、每个 matching ruleset 的完整 identity、source、
enforcement、target、conditions、`bypass_actors`、`rules` 与 effective
`required_status_checks` rule，以及包括每个 check producer `app_id` 的完整 classic
required-status object。Canonical empty inventory 仍有绑定 repository/branch 的 digest；
API/schema 不完整或任何 drift 都 fail closed。随后再证明 current actor
就是 owner、latest exact-head approval 仍有效，然后同步 merge
exact SHA。Merge 后先立即重读 current default，并要求 PR 的 merged lifecycle、base 与 head
仍精确等于 approved scope；失败时保留全部 legacy requirements active。只有成功后才按
fail-closed 顺序另建 Disabled v2 ruleset，同时继续保持 legacy active；经 canary 证明后
activate 并精确读回完整 Active policy，且没有 bypass actors。只有该 Active readback 成功，
才可按单独授权移除并读回 inventoried legacy requirements。Cleanup 前每次
stage/activation preview 与 apply 都必须跨进程显式复用同一个 owner-approved digest，直到
该 exact Active readback。Cleanup 前先使用只读 `--derive-post-cleanup-plan`，携带同一个
external owner-approved legacy-inventory digest（`--expected-legacy-inventory-sha256`），
对 pre-state 验证该 baseline，再从完整
security snapshot 派生 canonical expected state。其可审阅 plan 只能删除
`codex/review-gate`；status rule 变空时可删除该 rule，ruleset 只有在不剩其他 rule 时才可
删除；emptied classic required-status policy 也可消失。这些是唯一 structural exceptions。
Repository/default head、workflow/CODEOWNERS inventory、owner permission、surviving
classic policy 的全部 fields/non-legacy checks（包括 `strict`/`app_id`），以及每个
retained ruleset 的 identity、conditions、bypass actors 与 unrelated rules 必须精确保留。Plan 输出 expected
post-cleanup security SHA-256。最终只读
`--verify-post-cleanup` 不复用已经 stale 的 legacy digest，而是强制携带派生出的 expected
post-cleanup external digest（`--expected-post-cleanup-security-sha256`）；只有两轮相同的
完整 security snapshot
都匹配该 digest、两个 legacy surfaces 均 clear 且同一 complete v2 policy 仍 Active 才通过。
Post-write state inconclusive 时保持 v2 Active，只做 read-only diagnosis，绝不 disable 或
rollback。
Migration PR 只承载两份 workflows 与 CODEOWNERS。启用后，
Code Owner review 与 push 后 stale-approval dismissal 会保护后续变更。
required check 的 `integration_id: 15368` 标识整个 GitHub Actions App，因此单独使用它
不能证明 canonical verifier 产生了 CheckRun。exact bytes、完整 workflow inventory、
CODEOWNERS、Code Owner review、strict freshness、no bypass 与 canary collision readback
共同构成 adopted compound boundary。

verifier 只接收 `pull_request` `opened`、`reopened`、`synchronize` 与
`ready_for_review`，并在不是 same-repository、open、ready、default-base scope 时 fail
closed。`edited` 被明确排除：base retarget 后，ready PR 必须转为 draft 再 mark ready，
已经是 draft 的 PR 直接 mark ready。新的 `ready_for_review` event 会为 current exact
head/base/test-merge scope 创建 verifier；旧 event rerun 不能代替。这四种 event 产生的
failed verifier 都可能进入可选 `workflow_run` 路径。

GitHub 会把 verifier run/job/native CheckRun 记录在 exact PR feature-head SHA 上，尽管
canonical `pull_request` workflow 在 `refs/pull/N/merge` 上执行。Action 内部要求
`GITHUB_REF`、`GITHUB_SHA` 精确匹配该 merge ref 与 fresh PR test-merge SHA，并要求 event
head/base values 与 fresh PR read 一致。事件校验仅限 head/base 的 SHA、ref 与 repository；
event `merge_commit_sha` 可以缺失或来自历史快照，不作为 binding input。受保护的 top-level `run-name` 提供第二份
receipt：run `display_title` 必须是
`codex-review-gate-verifier/<PR>/<current test-merge SHA>`，其唯一 PR binding 还必须携带
current feature head 与 default-branch base SHA。这个 execution binding 使 successful
feature-head CheckRun 能证明它评估了 exact current test-merge；CheckRun 本身并不属于
test-merge SHA。

Verifier 通过 `GET /repos/{owner}/{repo}/actions/runs/{run_id}` 读取自身
`pull_request` Actions run，并要求 GitHub 服务器记录的 `created_at`。它是 current
run 中顶层 issue-comment clean 的保守 cutoff，并非精确的 `synchronize`
event time；不能回退到 Git
commit date 或未经校验的 event timestamp。因此 canonical verifier 需要只读
`actions: read`，private repository 也不例外。floating `v2` release 在依赖这次
读取前，必须先让已安装 consumer 更新 canonical permission；缺失权限时 fail closed。

controller 接收 `issue_comment` `created`、default-branch `workflow_dispatch`，以及 canonical
verifier `pull_request` event 的 `workflow_run` `completed` 路径。Completion path 接受空或唯一
PR association；多个 association 会被拒绝。comment
admission 在 runner 分配前，把 event sender 与 comment
author 都精确校验为 login `chatgpt-codex-connector[bot]`、type `Bot`。Action 在
admission 后再次校验，因为两次校验保护不同边界。edited Codex comment 需要受保护的
manual reconcile；runtime 为 direct caller 保留的 `edited` 兼容性不是 canonical
automatic ingress。

唯一 manual entry 是使用受保护 default-branch workflow 的 `workflow_dispatch`。
manual inputs 是 closed typed schema，详见 [README.zh-CN.md](README.zh-CN.md)。
feature-ref dispatch 不受支持。具有 native repository/Actions dispatch 权限的
same-repository writers 是明确 trust boundary；v2 不维护 hard-coded actor
allowlist。

没有 cron、`repository_dispatch`、`pull_request_target` 或可写自动
`pull_request_review` job。受保护的 `workflow_run` 路径遵守 public repository 不使用
`pull_request_target` 的 policy，同时不在可写 context 中运行 PR code。没有 cron 可以避免
private repositories 为 no-op run 支付费用。review-object/reaction change 以及符合条件 issue comment 的 edit，
除非创建新的符合条件 comment，均通过 manual reconcile 收敛。

所有 runtime jobs 都只调用 API，不 checkout 或执行 consumer/PR code。verifier
read-only；只有 controller 拥有创建 request 与 rerun exact verifier 所需的窄 mutation
surface：

```yaml
permissions:
  actions: write
  checks: read
  contents: read
  pull-requests: write
```

controller 只使用 `pull-requests: write` 来写 canonical request 与 diagnostic comment。
GitHub 的 issue-comment endpoint 对 PR 接受这项 permission；controller 从不面向独立
issue。两份 workflows 都没有 issues/statuses/checks/content write 或 OIDC authority，也
没有专用 runtime GitHub App。独立 publisher App 绝不安装到 consumer repository。

### Dispatch 与 Action inputs

`workflow_dispatch` 暴露 `operation`、`pr_number`、`expected_head_sha`、可选
`request_comment_id` 与 `request_review`。每个值都是不可信输入，
必须与 GitHub 重新校验。manual path 必须提供完整 expected SHA。自动
issue-comment path 可以不提供；runtime 会在启动时绑定 authoritative PR head。
两条路径都会在剩余运行期间冻结该 head。

controller Action 使用 underscore 命名 inputs：`github_token`、`pr_number`、
`expected_head_sha`、`operation`、`request_comment_id` 与 `request_review`。
公开 manual `operation` 仍只有 `reconcile|begin-review`；仅受保护
`workflow_run` ingress 可以选择内部的 `report-completion`，`request_review` 仍为 boolean。
verdicts、identities、status context、stale overrides、numeric limits 和
skip-reconcile controls 都不是 inputs。

两份 Action steps 只从受保护 repository variable
`CODEX_REVIEW_GATE_LIMITS_PROFILE` 派生 `limits_profile=default|expanded`；dispatch
没有 profile 或 numeric override。

只有解析后的 organisation/repository variable `CODEX_REVIEW_GATE_AUTO_REQUEST` 字面
精确等于 `true`，才授权自动 request；缺失或其他值都不能授权请求。但 GitHub Actions 的 job-level
表达式字符串比较不区分大小写，`TRUE` 等变体仍可能分配 runner；运行时在 request POST 前按
精确字符串比较并 fail-closed。该 variable 不是 dispatch 或 Action input。首个 canary 通过
`Joey-Tools` organisation variable 的
selected-repository visibility 仅向 `codex-private-workflows` opt in，不使用 repository-level
override；其他 consumers 默认关闭。此功能不新增 runtime App 或 ruleset。

`request_comment_id` 只是 locator hint。reducer 可以用它避免不必要的 backward
requests，但停止前必须证明全部更新的 relevant request、finding、progress
artifact、malformed artifact 和 conflict 都已对账。hint 绝不提供 evidence
authority。

## Operations 和 head binding

### `begin-review`

`begin-review` 校验所选 supported PR 和 bound head，并默认创建或安全采用一条带
canonical controller marker 的 fresh exact `@codex review` request。marker 绑定 v2
format、full head、当前 base
repository/ref/SHA 和 workflow run。
`request_review=false` 不发送 request；它是 best effort，不会创建专用 barrier。精确
读回 request 后，manual 与 issue-comment 入口会建立更新的 full verifier attempt。

issue-comment 或 manual workflow-authored request 的 logical attempt 绑定 repository
ID、PR、expected head 和 `GITHUB_RUN_ID`。rerun 可以采用自己的 exact、未编辑 matching marker。如果 POST
结果 unknown，runtime 会先重读 GitHub，而不是盲目重复发送。持续不确定时保持
pending，并报告 `retry_begin` 和 `retry_safe=false`：GitHub issue-comment creation
没有 idempotency key，failure 可见前 side effect 可能已经成功。caller 应等待 exact
same-run marker 的可见性稳定；若它仍不存在，只 rerun 原 workflow run。立即 retry
或另行 dispatch 都可能生成 duplicate generation。

同一 PR controllers 使用 `cancel-in-progress: false`。这会串行化 active writers，但
不能阻止 GitHub 替换尚未启动的 pending run。因此 caller 必须观察 exact
`begin-review` run 完成，才能把它视为 barrier 或发送依赖它的 request。

在 opt-in 自动路径之外，check 尚未通过时，agent 通常直接发送 exact
`@codex review`，作为低成本 provider-side attempt，从而在其他 checks 运行期间避免
Actions runner。该 comment 不授予 provider
capability，也不保证 delivery；缺少 official Codex evidence 时保持 pending。
`begin-review` 保留为 coordinated path，尤其适用于 deliberate same-head re-review：
它必须建立更新的 verifier generation。

### Verifier failure 后的 opt-in 自动 request

canonical `Codex Review Gate Verifier` 首次 attempt（`run_attempt=1`）failure 只是
trigger，不直接授权 review request。受保护的
`workflow_run` 路径重读已完成且失败的 verifier 与 PR，并要求 same-repository PR 仍然
open、ready、以 default branch 为 base，且 verifier 绑定的是 exact current head。
只有当前 repository/PR/head/base scope 没有 matching canonical request，才发送带
canonical marker 的 exact `@codex review`；证据缺失或有歧义时保持 blocking。POST
结果不确定时重读并保持 pending，不盲目发送第二条；跨 run 采用 marker 不保证严格
exactly-once。与 manual
same-run recovery 不同，自动路径可以采用 prior run 的 exact canonical marker，无须匹配
其 run ID；已有 match 会阻止对同一 scope 再次 POST。controller 仍使用
`begin-review` 和 `request_review=true`，但自动 trigger source 从可信 event 派生，
不新增 Action input。在这条路径中，request 精确读回后不会建立更新的 verifier
attempt，也不会调用 `reconcile`；后续 Codex bot `issue_comment` 或受保护 manual
dispatch 才执行 reconcile。如果 merge conflict 阻止 verifier 运行，就没有可消费的
`workflow_run` failure，必须 manual recovery。只有上述 variable 精确启用时，此功能才
生效。

### `report-completion`

除了保留的自动 request 路径外，每个 eligible canonical verifier completion 都选择
`report-completion`，包括成功的 rerun、failed/cancelled completion，以及未设置
`CODEX_REVIEW_GATE_AUTO_REQUEST` 时的 run。该 operation 只允许来自 `workflow_run`，没有
dispatch option。它会在写入 best-effort diagnostic snapshot 前重验 exact canonical
workflow/run/attempt、所选 PR 的 current head/base/test-merge scope、最新 exact-head verifier
run 与当前 CheckRun。它不会扫描 provider evidence、reconcile、rerun verifier 或请求评审。
每次 completion 会额外消耗可计费的 controller runner minutes。

GitHub 未提供 PR association 时，workflow 使用内部 sentinel `pr_number: 0`。Runtime 只在
association list 确实为空时接受该值，从 exact canonical dynamic `display_title` 解析 PR 与
test-merge SHA，并将解析结果绑定到 current PR 与 exact run scope。多个 PR association 会被拒绝；
旧的自动 `begin-review` 路径仍要求唯一 association，不使用此 fallback。

Diagnostic 是可编辑的 output projection，不是 review evidence 或 gate authority。过时的
run/scope snapshot 会被忽略；current successful native `codex/github-review-gate` CheckRun
仍是唯一 required signal。空 association event 会沿用现有 controller concurrency expression，
使 group 后缀为空并落入 repository-scoped group，而非通常的 PR number。Runtime 写前会进行
point-in-time recheck（写入前瞬时重验），但该 fallback 不保证与该 PR 的所有其他 controller
run 按 PR 完全串行。Snapshot 不能授权 merge。

必须先发布兼容的 Action runtime，再安装调用 `report-completion` 的 controller workflow；
不要让新 operation 暴露给 v2.1.6 或更旧 runtime。Action release 与 canonical workflow 应按顺序
对齐 rollout。本源码仓库是 self-hosting 例外，因为 controller workflow 与源码 PR 同时变更。
Action release 可用前，可选的 diagnostic controller run 可能因旧 runtime 不认识 operation
而失败；required verifier CheckRun 与现有 manual operations 不受影响。

### `reconcile`

manual reconcile 要求 caller 提供完整 `expected_head_sha`；automatic path 在启动时
绑定等价值。controller 重读 PR、定位 native CheckRun 挂在 current feature head 且 run
绑定 current test-merge 的唯一 canonical verifier、记录 baseline attempt `A`、证明没有 canonical attempt 正在 queued/running，
只请求一次 full rerun，并要求 exact attempt `A+1` 与其唯一 job/CheckRun 可见。attempt
jump、duplicate、POST ambiguous 或 inventory unreadable 都保持 blocking，绝不盲目重试。

verifier 使用 latest-generation single-flight 与 `cancel-in-progress: true`；cancelled run
不能满足 gate。stale verifier 不跟随不同 head/base/test-merge SHA。direct commit-status
projection 及其旧 mutation/readback state 已删除。

## Authority 模型

### GitHub 是 reconstructive source

每次 reconcile 都从 GitHub PR objects 重建 authority。没有 durable Git ledger、
Actions-artifact ledger、central controller、cached receipt 或 sticky-comment
authority。runtime 不上传 artifacts，也不保留 raw API payloads。

best-effort sticky diagnostic 只是 output projection。其 v2 marker 与 request
markers 不同，且不包含 `@codex review`。只有带匹配 PR binding 的严格 canonical
`github-actions[bot]` marker comment 才符合条件。`report-completion` 在写入前读取完整
issue-comment inventory：只有一条严格绑定 canonical diagnostic 时 PATCH 为新的 completion
snapshot；不存在时 POST；有多条时跳过写入并报告 bounded warning。只有
`report-completion` 会 PATCH 已有 diagnostic；其他 operation 在没有 diagnostic 时仍可新建一条，
但不会更新已有 comment。该 controller diagnostic 格式的可见内容省略 unknown counts 与 thread
detail，但 hidden payload 保留 `unknown` 类型；它说明自己是 snapshot 而非 current gate result，
并携带 PR/head、run/attempt/link/time 和 authoritative verifier CheckRun 摘要。旧的 canonical
payload（包括 v2.1.6 缺少 `reviewThreads` 的格式）仍可读取。

写入抑制范围比 evidence exemption 更宽。只有原始正文 exact canonical、hidden fields
类型正确、具有 official Actions provenance、timestamps canonical 且没有 edit proof 的
sticky，才能从 physical request lineage 中排除。edited、invalid、forged 或
wrong-provenance 的 marker-looking comment 都会 fail closed，成为 unbound
physical-only boundary。该 boundary 可能留下不可闭合的 historical gap，并要求
replacement PR；同时存在另一条 valid sticky 也不能使它变得 harmless。

### Admitted evidence

reducer 只消费符合条件的 Codex top-level issue comments 和 PR review bodies。
唯一的窄例外是：符合 fixed closed grammar（枚举式固定格式，而非自由文本猜测）的官方
exact-head `COMMENTED` inline-parent review 可作为 non-inline terminal-clean receipt；
runtime 仍只观察 immutable parent review，不从它的 child/thread 推导 receipt authority。
另外，每个完整 snapshot 都通过 GraphQL 读取所有 PR review threads，并要求每个
`isResolved` 均为 true。任何未解决 thread 都会阻塞，不论作者、outdated 状态或 reviewed
head；parent receipt 不会改变该要求。installed ruleset 仍提供独立的 server-side
conversation-resolution guard。

provider carriers 必须绑定 exact bot identity。相似 name、复制的文本或 user-authored
claim 都没有 authority。finding severity label 不影响 blocking：任何符合条件的
finding 都会阻塞。

GitHub REST 对 `PENDING` pull-request review 可能完全省略 `submitted_at`。这种 shape
仍会进入 identity、exact-refetch 和 snapshot-stability observation，但它是尚未提交的
draft，其 body 不会被 reducer 变成 provider finding 或 clean evidence。但它的存在本身是
liveness evidence：在 review 达到 stable terminal state 前，它会阻止 pass，甚至会阻止早于
该 draft 的 clean。之后提交的 terminal review 会按正常路径观察；inline conversations 仍是
ruleset condition。每个 terminal review state 仍必须有 canonical `submitted_at` timestamp，故
malformed terminal review 仍然 fail-closed。

raw `submitted_at` 缺失或为 `null` 的 `PENDING` draft，其 protected property 是 review ID、
provider actor/App provenance 与 commit binding；提交前 draft body 可以变化。body update 会
重新开始 snapshot stability；若仅在 exact refetch 中看到 update，则放弃该 snapshot，之后再
retry。它绝不成为 terminal evidence。stability latch 唯一允许的 draft-to-terminal lifecycle
必须保持上述 immutable binding，并变为带 canonical timestamp 的 `COMMENTED`、`APPROVED` 或
`CHANGES_REQUESTED` review。exact response 不会立即被保留为 terminal value，因为 list
endpoint 可能仍显示 `PENDING`；之后一个完整 snapshot 必须先从正常 list read 观察到 terminal
state。terminal review 之后仍须被一致观察，才能影响 decision。

完整 list 中缺少 `PENDING` review 不能直接当作 deletion。verifier 会 exact-fetch：仍为
pending 时继续保留 liveness lock；允许的 terminal state 则等待 normal-list convergence。只有
两次位于不同 complete-snapshot attempts 的 exact `404` 才确认 deletion；确认本身还会强制再读
一个完整 fresh snapshot，之后该 draft 才可能不再阻塞。draft 随后重新出现时，只有相同 ID、
actor/App 与 commit binding 仍匹配才重新进入 live 状态。任何 reversal、到 `DISMISSED` 的
transition、terminal-to-terminal drift，或 identity、App、commit-binding 的变化都继续
fail-closed。

### Review generations

authorised generation 只能由一条 exact、未编辑的 `@codex review` request 建立。
其 first visible line 必须 exact，且没有其他 visible text。默认 `any` policy 下，任意
repository permission 的 ordinary request author 只会作为未确认 candidate 被纳入。它有两类
provider confirmation：official Codex Bot 在同一 comment 上留下严格晚于 revision 的直接
`eyes` 或 `+1` reaction；或严格晚于 candidate 的未编辑 official terminal-clean receipt。第二类
只适用于没有 base epoch、single-flight lineage 中唯一一条 exact、未编辑的 ordinary request，且
terminal 必须无歧义绑定 current head。它可以是顶层 issue comment（PR 的普通评论，不是
pull-request review body）中的 clean，或官方 exact-head `COMMENTED` inline-parent review 的
closed grammar。inline-parent grammar 要求固定标题、`Reviewed commit` 与 native `commit_id` 的
匹配和固定 official disclosure；它只证明 parent 中不存在 non-inline finding payload，不证明
任何 child/thread 存在或已 resolved。
额外或 ambiguous request/physical boundary、任一 carrier 被编辑、terminal 不匹配，或 head/SHA binding 有歧义时，普通
candidate 路径都保持 pending；下述 duplicate cohort 与 current-head clean recovery
（恢复早于本次 verifier run 的同 head clean 的狭窄路径）分别是严格限定的第二条
boundary 例外。terminal 的 short SHA 只有被 GitHub 无歧义解析为 current PR head 才接受。
同一 comment 上 official `eyes`/`+1` 的直接 receipt 仍然受支持。这只是 gate attribution：
不授予 commenter 调用或控制 Codex review 的权限，不会使 Codex 启动，也不意味着每个用户
都能导致 review；provider 是否真正启动仍由 GitHub/Codex 决定。没有 terminal-clean contender
的未确认 candidate 不能 reset、抢占或使已建立的 clean 失效；尝试但未满足狭窄规则的
terminal-clean receipt 保持 fail-closed pending。canonical workflow 固定
`CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION=any`，不暴露 standard
strict-policy setting。更严格的 `write` threshold（`write`、`maintain` 或 `admin`）仅保留给
将来可读取 collaborator permission 的 nonstandard verifier identity；bundled read-only
verifier token 无法可靠做到。workflow-authored request 还需要 exact v2 marker，绑定 full
head 和 run。

唯一允许的 duplicate-request recovery 是 *duplicate cohort*（固定的历史两条请求对，不是
producer protocol）。它要求没有 base epoch，且恰好两条彼此严格顺序、未编辑、来自同一
`User` login 的 exact default-`any` ordinary（不带 canonical marker）`@codex review` request；两条都不能带 official direct `eyes`/`+1`。随后必须只有一条
未编辑 official 顶层 issue-comment clean，且它无歧义解析到 current PR head；整个 snapshot 不得有
provider error；每一个 pair 之前、具有有效 activity window 的 official 顶层 `issue-comment`
provider artifact 都会否决 cohort，除非它是已安全分类的 historical terminal：kind 为 `clean` 或
`finding`、未编辑、没有 `orderingError`/`resolutionError`，且跨 `resolvedHeadSha` 与 `headSha`
恰有一个完整、无歧义的 SHA。这也包括其他 unknown 或 unclassified、malformed、progress 或
nonterminal 的 official 顶层 `issue-comment`：只要具有有效 activity window，就属于不透明 provider
activity（只作阻塞，不作 clean 证据），并否决 cohort。较早的 carrier 仍可能是后来 clean 的来源；保留安全历史 terminal
依赖这条明确例外，而非仅有 full-head binding。从第一条 request 到该 clean（若存在唯一 canonical
successor，则到该 successor）之间不得出现任何额外的 provider artifact 或具有有效 activity window 的
不透明 provider activity。不透明 provider activity 仅是排除用的 side channel：不进入普通 reducer、
liveness、finding、clean 或计数路径。唯一可能的 successor 是一条严格
更晚、绑定 current 完整 head/base tuple 的 canonical workflow request。没有 successor 时，较晚
ordinary request 被确认、较早者被合并；有该 successor 时，较晚 ordinary request 保留为已确认、
已闭合的 predecessor；在 successor 之后出现的无绑定 terminal 不能令其 pass，只有该 successor
上的 official direct `+1` 可以。inline-parent receipt、第三条 request、另一 author、edit、base
epoch、两条 ordinary request 上的 reaction、provider activity/error、任一不属于上文安全
historical-terminal 例外且具有有效 activity window 的 pre-pair official 顶层 `issue-comment`
provider artifact、该 exclusive window 中额外的 provider artifact 或不透明 provider activity、finding
及任何其他 successor 均保持 fail-closed。该例外要求列出的每项 terminal
property；历史 terminal clean/finding 不能仅凭 full-head binding 被保留。此规则只恢复不可变的历史
pair；agent 不得主动创建。

另有 *current-head clean recovery*，仅在没有 base epoch 时允许用新鲜的 head-scoped witness
恢复已经指向 current head、但早于本次 verifier run 的可信 clean。cutoff `T` 是原始 `pull_request`
verifier run 的 GitHub-server `created_at`，并在同一 run ID 的 retries 中固定；它不是 PR
synchronize event 的精确时间。request `R` 可为一条符合条件、exact、未编辑的 ordinary
`@codex review`（`User` 作者），或一条已验证、未编辑的 canonical Actions request，其 repository、PR、
完整 head/base tuple 和 workflow-run marker 与所选 PR/verifier scope 完全匹配。随后必须有一条可信、未编辑的 top-level issue-comment terminal clean `C`，
其 resolved full SHA 唯一等于 current head。时间顺序严格为 `T < R < C`；`R` 必须是 `C`
之前最新的 physical request boundary，`C` 之后不能有新的 request boundary。这是 current-head
attestation（证明 clean 指向所选 current head，不证明 request 与 clean 的因果关系），而不是
因果匹配：timestamps 与 head binding 不证明 `R` 导致 `C`，也不证明发出
`R` 会启动 Codex。

`T` 之前的 ordinary requests 仍完整保留在 lineage audit 中。恢复见证只忽略附着于这些历史
request 的归因缺口，不删除或改写其历史状态。旧 request 上尚未由该 request 自身后续 `+1`
结清的 official `eyes` 仍按既有 liveness 规则阻塞。恢复不清除 findings 或 provider errors，
也不豁免 unknown、edited、deleted、forged、scope-drifted、live 或 ambiguous boundaries。仍须
完成 inventory、exact refetch 和两轮稳定 snapshot。新的 verifier run ID 使用自己的 cutoff，不
继承旧 witness。

permission threshold 保护 generation reset，不保护 negative evidence。符合条件的
provider findings 不受 request-author permission 影响，始终阻塞。finding 绝不充当最小
terminal receipt。generic pull-request review clean 不能充当该 receipt；只有上文限定的
official exact-head `COMMENTED` inline-parent closed grammar 是窄例外。

除上述 current-head clean recovery 外，terminal clean text 与符合条件的 provider
`+1`，只有在没有 base epoch、single-flight lineage 的第一个物理 generation 中才是
同等 clean carriers。物理 boundary 识别与
positive authority 必须分开；唯一例外是狭窄的 default-`any` terminal-clean receipt，可以
同时建立该第一个 generation 并携带其 clean authority；它必须是顶层 issue-comment terminal
clean，或上文限定的 official exact-head `COMMENTED` inline-parent closed grammar。后者只
观察 parent review，不能把 inline thread 或其 resolved 状态带入 reducer。
recovery-only duplicate cohort 是另一种额外的顶层 clean 情形：它只确认较晚 ordinary request，
不接受 inline-parent receipt，也不能确认 canonical successor。没有
terminal-clean contender 的未确认 default-`any` ordinary candidate 才不是 physical boundary。存在 terminal-clean contender 但未
满足狭窄 receipt 条件时，仍是 unresolved、fail-closed physical-only boundary。其他每条可能触发
provider 的 request-shaped comment 都恰好是一个 boundary，包括 duplicate marker，以及
edited、malformed、wrong-author 或 denied request。physical-only boundary 没有 binding 或
positive authority。在 nonstandard `write` threshold
下，形状合法的 ordinary request 必须先查询 author permission（同一 snapshot
内按 author 缓存），才能判定为 denied；判定后不再触发 reaction 或 exact-refetch
fan-out。更早因 shape、author 或 binding 无效而拒绝的 boundary，不触发 permission、
reaction 或 exact-refetch fan-out。每个已观察到的 `CommentDeletedEvent` 都在事件时间形成
unbound physical-only boundary，因为 GitHub 不提供可恢复正文，runtime 无法排除它曾是
provider-triggering request。该事件进入 stable fingerprint 与本次运行的不可逆 inventory；
若它留下不可闭合的 historical gap，同一 PR 的后续 evidence 无法修复，必须改用
replacement PR。绑定 current full head 的 canonical request 即使 base SHA/ref/repository
tuple 已旧，也仍是 boundary；exact current scope 只决定 authority，不能擦除物理
boundary。没有 base epoch 时，严格位于第一个 request 与后继 request 之间的 provider
terminal evidence 只能闭合第一个 gap。对于 default-`any` ordinary candidate，它也只能在
满足上述唯一 single-flight rule 时作为第一个 request 的最小 receipt。之后的每个
predecessor-to-successor gap，以及任何前面已有物理 request 的 generation 所需
positive/superseding authority，都必须来自直接附着于该 request 的合格 `+1`，
唯一相关例外是上文的新鲜 current-head clean recovery。provider
terminal payload 没有 originating request ID；后到的 carrier 可能来自任一旧 generation，
两个 stable snapshots 也无法使该归属唯一。出现 base epoch 后，current-head clean recovery 不适用：
现有规则要求 exact-current-tuple canonical Actions request 上的 direct provider `+1`，top-level
terminal clean 不增加 authority。

上文定义的 duplicate cohort 是该 ordinary 第二条 boundary 规则的另一条 recovery-only 例外：
它的一条顶层 clean 只闭合已经存在的两条 request cohort，不能闭合或为 canonical successor
提供 terminal-clean receipt。

如果 official `eyes` 或 provider activity 不早于 candidate closure 且不晚于后继
boundary，前一个 generation 仍保持 open。GitHub timestamp 精度下与任一端点同时都属于
ordering ambiguity。provider terminal 闭合第一个 gap 还要求 predecessor reaction
inventory 完整；若某个 boundary 的 reactions 被刻意跳过读取，就不能用 unbound terminal
闭合。绑定最新 request 的 clean 不能跨过更早的 unclosed gap；后继 boundary 之后才出现的
evidence 也不能倒推修复该 gap。

带有单一、无歧义 commit binding 的 progress 会直接归入对应 head。所有 unbound
progress carrier 都保留在 current-head inventory；邻近其 creation/revision 的 request
boundary 只能证明 ordering，不能证明 originating flight 或 head。edited provider
terminal 还会产生一个从 immutable creation 到 terminal revision 的 unbound unknown-
activity interval，因为 GitHub 不提供中间 body 历史。只有在评估同一 carrier 的同一
terminal 时，才豁免其 terminal endpoint 的 self-veto；该区间仍参与 predecessor-gap
liveness，也不能给其他 carrier 同样豁免。

一旦观察到 base epoch，terminal payload 无法证明它由哪个 request/base snapshot
产生；在这个降级 lineage mode 中，只有直接附着在最新且严格晚于 epoch、绑定当前
base 的 canonical workflow request 上的合格 `+1`，才能作为 positive 或
superseding carrier。无法归因的 terminal clean 只保留为 diagnostic evidence，不能
pass 或清除 finding。这是 carrier parity 的明确 fail-closed 例外。
未确认 default-`any` ordinary candidate 上，official 直接且严格 post-revision 的 `eyes`
或 `+1` 先是 receipt，用于把它升级为 boundary。唯一替代方式是在唯一、没有 base epoch、
single-flight rule 下，严格晚于 candidate 的匹配未编辑 official current-head 顶层
issue-comment terminal clean，或符合上文 closed grammar 的 official exact-head `COMMENTED`
inline-parent review。出现 base epoch、第二个或 ambiguous request/boundary、任何 edit，或 terminal 的
identity、ordering/head binding 有歧义时，该方式不可用。上文定义的 duplicate cohort 是第二条
boundary 情形的另一条 recovery-only 例外：它只接受已经存在的两条 request snapshot 和顶层
clean，绝不让 canonical successor 使用 terminal clean。升级后 ordinary request reactions
才仅用于 provider liveness；ordinary `+1` 不能 head-bind clean。same-time/later official
`eyes`/progress from Codex 会 veto candidate clean evidence。由于 reaction change 不触发
consumer workflow，必须由 later provider event or manual reconcile 观察 settled state。
terminal carrier 包含 reviewed commit
时，只有 GitHub 能把 full/abbreviated SHA 无歧义
解析为 current bound head 才接受。对于 PR review，resolved commit 还必须等于
native `commit_id`。没有 match 或存在多个 relevant match 的 short prefix 属于
indeterminate；runtime 绝不猜测，也不从无关 prose 中模糊提取方便的 token。

### Finding supersession

符合条件的 current-head finding 具有保守 precedence。在同一 head 上，旧
non-inline finding 只有同时证明以下两项时才被 supersede：

1. 存在严格更新的 authorised review generation；
2. 之后出现符合上述 lineage rule、属于该新 generation 且绑定该 head 的 clean：只有
   no-base-epoch 的第一个物理 generation 可以使用 terminal clean（对于 default-`any`
   ordinary candidate 还必须满足最小 terminal-receipt rule），其他情况必须使用合格的
   request-bound `+1`。current-head clean recovery 不能 supersede finding。

无关 later clean 不能清除 finding。temporal order、generation binding 或 head
binding 有歧义时，仍为 failure 或 inconclusive。superseded finding 会作为
historical evidence 保留在 diagnostic accounting 中，而不是从 GitHub 擦除。

这种不对称允许从 obsolete/inapplicable finding 恢复，同时不让 positive evidence
静默掩盖 finding。

## Complete snapshots 和 stable success

“snapshot” 是一组独立、fully paginated 的 GitHub API reads，用于判断固定 PR/head
scope。它包括：

- PR identity、lifecycle、base 和 head；
- PR timeline 中最新 filtered `BaseRefChangedEvent` 或
  `BaseRefForcePushedEvent`；
- review-request IDs、revisions、authors 和 candidate reactions；
- 符合条件的 Codex top-level comments/review bodies，包括 IDs、timestamps、
  actor/App identity 和 body digests；
- 每条 review thread 的 ID、resolution state 与分页完整性；
- reviewed-commit resolution 与 native review `commit_id`；
- collection completeness 与 exact-object refetch results。

thread comments/replies 不进入 diagnostic finding counts；但 thread IDs 与 resolution state
进入 fingerprint。若接受 inline-parent closed-grammar receipt，只有其 parent review 作为普通
provider carrier 进入 snapshot，其 child thread 是否 resolved 由上述独立 collection 判断；ruleset
也会独立执行对应 requirement。

### Review-thread completeness

每次 thread collection read 使用 GraphQL 的 `reviewThreads(first: 100, after: $cursor)` 查询完整枚举 PR
threads。决策 fingerprint 纳入每条 thread 的 `id` 与 `isResolved`；不会读取 nested thread
comments，也不会从其正文归约 findings。只要有任一未解决 thread 就不能 success，无论它是
人工编写、outdated 还是指向旧 head。在 GitHub 解决 open conversations 后，对同一 exact head
运行受保护的手动 `reconcile`；不需要重新请求 provider review。

该检查复用现有只读 verifier token 和 workflow triggers；不增加 permission、event、cron schedule
或 GitHub App。

分页必须完整且无重叠（跨页不重复 thread ID）：每页 `totalCount` 一致，item count 与 `pageInfo`/可用 count 相符，thread
ID 唯一且总 unique ID 数等于 `totalCount`，cursor/page shape 合法。cursor 循环、跨页重复 ID、
malformed 或 partial page、GraphQL error、cap hit 或 count mismatch 都代表 evidence 不完整，
fail closed。Clean 要求两轮 stable snapshots 中的 thread 集合和状态一致。这不是 atomic
GitHub snapshot：无重叠分页、count/ID 一致性与两轮稳定读取用于降低分页歧义，不声称服务端提供
atomic transaction。现有 snapshot protocol 在 decision-carrier reads 前后各读取一次；两轮 stable
snapshots 因此至少执行四次 thread pass，每次需要 `ceil(totalThreads / 100)` 页（空 connection
也至少读取一页），thread check 不额外增加 sweep。

摘要和 sticky diagnostic 通过独立 `reviewThreads` 节点报告 `status`、`unresolved`、`resolved`、
`total` 和 `diagnostics`，不混入四项 `findings` counts。`status` 为 `not_read`、`complete` 或
`incomplete`；只有完整 collection 的 counts 才是可信数字，`not_read` 或 `incomplete` 时三项均为
`unknown`。`not_read` 表示本次没有读取 thread evidence，不代表 PR 没有 thread；需要据此作出 thread
决策时，不完整 collection 仍 fail closed。最多提供五条未解决 thread 的 path 与首条 comment URL
（若可用）以便处理，outdated 标记仅供诊断。扫描使用既有 `default`/`expanded` limits profile 和
hard ceilings。

Thread diagnostics 只作补充，并保留 report 既有 recovery 优先级。特别是 `not_read` 不得用解决 thread
提示覆盖更具行动性的 finding、授权、预算、replacement-PR 或 begin-delivery recovery instruction。
只有完整 collection 确认存在未解决 thread 时，才给出“解决 thread 后 reconcile”的操作提示；thread
状态不得掩盖 findings、errors 或 report 的主要 recovery code。

fingerprint 是 snapshot 中每个 decision-relevant value 的 deterministic
representation。它只是两次 fresh reads 之间的 equality check，不是 durable
receipt。

GitHub 不提供 atomic cross-endpoint read。webhook delivery 可能先于 API visibility；
Codex 可能分开发出 request、review 和 terminal objects；pagination 也可能跨越
变化中的 server state。negative evidence 具有不对称性：符合条件的 finding 可以
立即得到证明，而 clean 必须有完整证据证明没有 blocker。

因此只有 clean candidate 使用 stability protocol：

1. 完整获取 snapshot A；
2. 等待 5 秒；
3. 独立完整获取 snapshot B；
4. 要求 fixed head 和 decision-relevant fingerprint 相同。

同一 head 上 relevant request、edit、reaction、comment/review change 或
exact-refetch change 会重启 stability window。head change、closure、merge 或
expected-head mismatch 会使 run stale 并停止 retarget。pagination、API 和 cap
failure 让 read incomplete，而不是“发生变化”。任何 incomplete 或 unstable
observation 都不能产生 success。

最新 base event 还是 evidence-epoch barrier。request generation 必须严格晚于它，
clean evidence 才能 pass；timestamp 相同属于歧义。由于 GitHub 没有暴露由 provider
认证的 request-to-terminal-payload lineage，epoch 后的 canonical request 必须在自己
的 comment 上取得合格 provider `+1`；单独的 later terminal clean 不能 pass。
workflow marker 直接绑定当前 base。findings 始终保守。
导入的 ruleset 阻止 default branch non-fast-forward update；strict up-to-date 处理会
扩大 required head 的普通 fast-forward movement。若管理员临时关闭这些保护后仍然
force-push，下一次 exact verifier 会从 timeline 重建并保持 blocking。V2 不宣称任意
provider activity 后可以 atomic invalidate 同 SHA 的旧 success；documented
exact-current merge closure 在不增加 webhook App 或 cron 的前提下提供 eventual boundary。

stability/reconcile budget 由 retries 共用。若到期仍没有 stable clean pair，
runtime 报告 `unhealthy/pending` 和 `wait_then_reconcile`；之后的 provider event 或
manual reconcile 会从 GitHub current state 重建。

## Resource profiles

每个 authoritative collection 都 fully paginate。cap hit 保持
`unhealthy/pending`，并报告 exact cap、stopping point 和安全 next action。它绝不把
truncated evidence 变成 success。

profiles 是 policy，不是任意 dispatch numbers：

| Profile | Pages | Raw objects | API attempts | Snapshot | Request timeout | Reconcile budget |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `default` | 100 | 2,000 | 128 | 32 MiB | 10 s | 60 s |
| `expanded` | 100 | 10,000 | 512 | 64 MiB | 20 s | 300 s |
| hard ceiling | 1,000 | 20,000 | 2,048 | 64 MiB | 30 s | 720 s |

分页上限在每个完整 snapshot 内累计，包含首尾证据读取以及每个 reactions endpoint
的第一页，不是单 endpoint 上限或 review 轮次限制。普通多轮审查 PR 即使评论很少，
也可能耗尽 20 页，因此默认值提高到 100，但不裁剪历史 reactions，不改变其他默认限制。
`expanded` 的分页上限同样是 100，因此分页超限必须报告 `raise_protected_limit`；
其他默认容量超限仍可按对应指标报告 `use_expanded_limits`。所有容量依然有限且
fail-closed。

page size 为 100，单个 response 上限 8 MiB，clean inter-read delay 为 5 秒，
workflow job timeout 为 14 分钟。确实存在大型 PR 的 repositories 可以通过受保护
repository variable `CODEX_REVIEW_GATE_LIMITS_PROFILE` 持久选择 reviewed `expanded`
profile。per-dispatch profile 与 numeric override 延期到 v2.0 之后。

## Result 和 projection 模型

public outputs 精确为：

```text
execution_health
gate_outcome
recovery_code
retry_safe
```

`execution_health` 是 `healthy|unhealthy`；`gate_outcome` 是
`success|failure|pending|not_applicable|unknown`；`retry_safe` 表示相同 inputs 的
immediate retry 是否为有效 recovery operation。closed recovery-code set 见
[README.zh-CN.md](README.zh-CN.md)。

合法 semantic combinations 是：

| Health/outcome | 含义 |
| --- | --- |
| `healthy/success` | 两次稳定完整 snapshots 证明 current-head clean。 |
| `healthy/failure` | 已证明符合条件的 findings。 |
| `unhealthy/failure` | 已证明 findings，但 execution 或 final result handling 同时失败。 |
| `healthy/pending` | evaluation 安全完成，但 current state 尚不能授权 success；必须遵循 `recovery_code`，只有 `wait_provider` 是 pure wait。 |
| `unhealthy/pending` | API、pagination、cap 或 stability execution 不完整。 |
| `healthy/not_applicable` | delayed automatic event 已 stale。 |
| `unhealthy/not_applicable` | manual target 无效或 scope 不受支持。 |
| `unhealthy/unknown` | 无法读取任何 trusted state。 |

每个 pending result 都继续阻塞；`healthy/pending` 不是弱化的 success。

`unhealthy/success` 被禁止。verifier job 只把 stable `healthy/success` 映射为成功的
native conclusion，其他 pair 全部映射为 blocking conclusion，从而区分普通 findings 与
evaluator failure。required verifier CheckRun 属于 exact current PR feature-head SHA；
它的 `pull_request` run 在 `refs/pull/N/merge` 上执行，严格的
runtime merge-ref、event head/base 与 fresh-read 校验把 success 绑定到 unchanged head、base 与 test-merge。
其中 event 部分仅绑定 PR head/base 范围，绝不使用其 `merge_commit_sha`。controller CheckRun 绑定 default-branch commit，绝不提供 required PR
result。direct status projection 与 `statusProjection` 已删除。

每个结果都必须结合自己的 `recovery_code` 解读；health/outcome pair 本身不是操作
指令。Only `wait_provider` 是 pure wait。

无需额外 evidence query 时，summary 和 sticky 会报告 `findings_unresolved`、`findings_resolved`、
`findings_historical` 与 `findings_indeterminate`。review-thread diagnostics 另放在
`report.reviewThreads`，分别包含 `unresolved`、`resolved`、`total` 和 `diagnostics`，不混入
`report.counts`。summary/sticky 独立列出三项 thread counts，并最多给出五条未解决 thread 的
path 与首条 comment URL（若可用）；outdated 标记只供诊断。thread 扫描不完整时三项 counts
均为 `unknown`，不能写成 zero。Findings counts 仍只涵盖 normalized non-inline findings；thread
counts 不是 public Action outputs。

summary 和 sticky 包含 bounded reason、recovery code 与具体 next action。必要时会
暴露 object identities、digests、bounded escaped excerpts 和 links，但绝不暴露
tokens、headers、raw payload dumps 或 untrusted workflow commands。

at-least-once recovery 在 write result unknown 后可能生成少量 duplicate requests、
verifier attempts 或 diagnostic comments。`report-completion` 在 update/create 前 fresh-read，
有多个 diagnostics 时原样保留并报告；它不 fold 或删除 comments。只有满足 exact official
canonical binding 的 sticky 才能获得狭窄的 physical-lineage exemption；不符合条件的
marker-looking duplicate 仍是 conservative boundary。被编辑或过时的 diagnostic 永远不是
review evidence。物理 review requests 同样保持为彼此独立的 generation boundaries。任何
duplicate 都不能授权选择一个方便的 clean 或漏掉 finding。

## Exact-head merge closure

stable A/B snapshots 只证明短暂 observation window，不会锁定 PR。merge 前，agent
必须：

1. 重读 exact current PR head；
2. 为该 exact head dispatch controller `reconcile`；
3. 观察严格更新的 verifier attempt，以及 current feature-head SHA 上唯一 canonical
   `codex/github-review-gate` CheckRun，并要求该 run 绑定 current test-merge；
4. 要求 Action output 为 `healthy/success` 且 verifier conclusion 成功；
5. 重读 unchanged PR head、base 与 test-merge SHA；
6. 要求 ruleset 确认 branch up to date、all conversations resolved 且 merge
   allowed。

任何 head 或 policy change 都必须重启该 closure。否则立刻用以下 exact-head
compare-and-swap merge：

```bash
gh pr merge "$PR_NUMBER" \
  --repo "github.com/$REPO" \
  --match-head-commit "$HEAD_SHA"
```

旧 success 绝不是 permanent review lease；跳过该 closure 的 direct human UI merge
不受支持。

## 支持边界和 non-goals

stable v2.0 支持 GitHub.com public/private repositories、从普通
same-repository branch 到 default branch 的 open non-draft PR、GitHub-hosted
Linux runners，以及普通 merge/squash/rebase methods。

GHES、forks、merge queues、non-default bases、drafts、bot-owned PRs、
self-hosted/Windows/macOS runners，以及对 closed/merged PR 发起的新 operation 都会
fail closed。

本设计不宣称：

- sticky diagnostics durable、unique 或 authoritative；
- 两次 snapshots 可以阻止 snapshot B 之后的变化；
- retries exactly once；
- ambiguous short SHA 可以通过猜测变安全；
- Action 会重复实现 branch freshness 或 conversation resolution；
- stale run 会跟随或修复 new head；
- required CheckRun 能提供超出 compound CODEOWNERS/inventory/canary boundary 的
  workflow provenance；
- release publisher App 提供 runtime authority。

## v1 隔离

v1 对尚未迁移的 consumers 保持 frozen 和 valid。v2 不读取 v1 state、不发布
compatibility selector、不修改 v1 refs，也不 fallback 到 v1 reducer。迁移在 pre-merge
canonical inventory fingerprint closure 后，用一个 PR 删除 v1 caller、安装 canonical v2
workflow 与 CODEOWNERS；合并后先完成 current-default 与 exact merged/base/head readback，
失败则保留 legacy。成功后也继续保持 legacy active，另把 v2 ruleset 以 Disabled stage，
用单独无害 canary 验证，再 activate 并读回完整 Active policy。只有之后才用只读 derived
plan 冻结 exact legacy-only removal 与 expected complete post-state；另行授权 cleanup 只
执行该 plan。两轮只读 closure 匹配 external expected-state digest、证明两个 legacy
surfaces clear，并证明 v2 仍 exact Active，之后才关闭 canary、不合并。任何 inconclusive
result 都保留 Active v2，只做 read-only diagnosis。
