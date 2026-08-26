# Codex Review Gate v2 设计

语言：[British English (en-GB)](DESIGN.md) | [简体中文 (zh-CN)](DESIGN.zh-CN.md)

## 目标

v2 为单个 PR 提供低成本、fail-closed 的 required status。存在符合条件的 Codex
finding、证据不完整或不稳定，或者所选 PR head 已变化时，它绝不能报告 success。
它优先从 GitHub 当前状态恢复，而不是依赖持久私有状态；write 结果不确定时，允许
少量 at-least-once duplicate。

现有 GitHub controls 保持各自原生职责：

- GitHub 保存 PR lifecycle、comments、reviews 和 reactions；
- consumer workflow 负责窄 event admission、permissions 和 serialisation；
- Action 重建并归约 non-inline Codex evidence；
- ruleset 要求 status、branch freshness、resolved conversations 和
  non-fast-forward protection；
- merge agent 通过 exact-current-head reconcile 和 final server-side reread 闭环。

Action 不是第二套 conversation resolver 或 branch-protection system。

## 架构和 trust boundaries

```text
eligible Codex issue_comment   qualifying base retarget   protected workflow_dispatch
             |                           |                           |
             +---------------------------+---------------------------+
                                v
                copied canonical consumer workflow
                - pre-runner identity filter
                - typed inputs and narrow permissions
                - one-PR concurrency
                                |
                                v
          JoeyTeng/codex-review-gate-action@v2 (API only)
                - bind one PR and expected head
                - write pending on that head
                - rebuild fully paginated evidence
                - reduce finding / clean / pending
                - require two stable snapshots for clean
                                |
                 +--------------+----------------+
                 v                               v
       codex/github-review-gate          summary + best-effort sticky
                 |
                 v
 ruleset: required status + up to date + conversations resolved + no force-push
```

### Consumer workflow

复制的 canonical workflow 是可信 repository configuration，也是受支持的 consumer
envelope。裸 Action step 无法负责 events、runner-admission filters、permissions、
typed dispatch 或 concurrency。

automatic admission 覆盖 `issue_comment` `created`/`edited` 和一个狭窄的
`pull_request_target` `edited` case。comment admission 在 runner 分配前，把 event
sender 与 comment author 都精确校验为 login
`chatgpt-codex-connector[bot]`、type `Bot`。base-edit admission 要求真实的
`changes.base.ref.from` transition，且 current base 是同仓库 default branch；仅
title/body edit 不分配 runner。Action 在 admission 后再次校验，因为两次校验保护
不同边界。

唯一 manual entry 是使用受保护 default-branch workflow 的 `workflow_dispatch`。
manual inputs 是 closed typed schema，详见 [README.zh-CN.md](README.zh-CN.md)。
feature-ref dispatch 不受支持。具有 native repository/Actions dispatch 权限的
same-repository writers 是明确 trust boundary；v2 不维护 hard-coded actor
allowlist。

没有 cron、`repository_dispatch`、宽泛的 `pull_request` reset job 或可写 status
的自动 `pull_request_review` job。没有 cron 可以避免 private repositories 为
no-op run 支付费用。未创建或编辑符合条件 issue comment 的
review-object/reaction change，通过 manual reconcile 收敛。

所有 runtime jobs 都只调用 API，不 checkout 或执行 consumer/PR code。permission
ceiling 是：

```yaml
permissions:
  contents: read
  issues: write
  pull-requests: read
  statuses: write
```

runtime 不需要 `actions: read`、checks/content/PR write、OIDC 或专用 GitHub App。
独立的 publisher App 绝不安装到 consumer repository。

### Dispatch 与 Action inputs

`workflow_dispatch` 暴露 `operation`、`pr_number`、`expected_head_sha`、可选
`request_comment_id`、`request_review` 和 `limits_profile`。每个值都是不可信输入，
必须与 GitHub 重新校验。manual path 必须提供完整 expected SHA。自动
issue-comment path 可以不提供；runtime 会在启动时绑定 authoritative PR head。
两条路径都会在剩余运行期间冻结该 head。

Action 使用 underscore 命名 inputs：`github_token`、`pr_number`、
`expected_head_sha`、`operation`、`request_comment_id`、`request_review` 和
`limits_profile`。`operation` closed to `reconcile|begin-review`，
`limits_profile` closed to `default|expanded`，`request_review` 是 boolean。
verdicts、identities、status context、stale overrides、numeric limits 和
skip-reconcile controls 都不是 inputs。

`request_comment_id` 只是 locator hint。reducer 可以用它避免不必要的 backward
requests，但停止前必须证明全部更新的 relevant request、finding、progress
artifact、malformed artifact 和 conflict 都已对账。hint 绝不提供 evidence
authority。

## Operations 和 head binding

### `begin-review`

`begin-review` 校验所选 supported PR 和 bound head，在该 exact SHA 上写 pending，
并默认发送带 canonical workflow marker 的 fresh exact
`@codex review` request。marker 绑定 v2 format、full head、当前 base
repository/ref/SHA 和 workflow run。
`request_review=false` 只执行 pending transition，不发送 request；它是 best effort，
不会创建专用 barrier。

workflow-authored request 的 logical attempt 绑定 repository ID、PR、expected head
和 `GITHUB_RUN_ID`。rerun 可以采用自己的 exact、未编辑 matching marker。如果 POST
结果 unknown，runtime 会先重读 GitHub，而不是盲目重复发送。持续不确定时保持
pending，并报告 `retry_begin` 和 `retry_safe=false`：GitHub issue-comment creation
没有 idempotency key，failure 可见前 side effect 可能已经成功。caller 应等待 exact
same-run marker 的可见性稳定；若它仍不存在，只 rerun 原 workflow run。立即 retry
或另行 dispatch 都可能生成 duplicate generation。

同一 PR writers 使用 `cancel-in-progress: false`。这会串行化 active writers，但
不能阻止 GitHub 替换尚未启动的 pending run。因此 caller 必须观察 exact
`begin-review` run 完成，才能把它视为 barrier 或发送依赖它的 request。

check 尚未通过时，agent 通常直接发送 exact `@codex review` 启动 Codex，从而在其他
checks 运行期间避免 Actions runner。`begin-review` 保留为 coordinated path，尤其
适用于 deliberate same-head re-review：它必须先使旧 success 失效。

### `reconcile`

manual reconcile 要求 caller 提供完整 `expected_head_sha`；automatic path 在启动时
绑定等价值。runtime 重读 PR，并且只有 head 仍等于该值时，才会在收集证据前把
该 SHA 的 gate status 改为 pending。pending 让中断的 recheck 保持 fail-closed，
并在 deliberate re-review 时使旧 success 失效。

stale run 绝不跟随不同 head，也绝不把结果投射到那里。head change 必须为 new
current head 启动 fresh invocation。这就是 status projection 保护的 property：
每个 decision 只属于 run 启动时明确提供或 authoritatively 绑定的 head。

## Authority 模型

### GitHub 是 reconstructive source

每次 reconcile 都从 GitHub PR objects 重建 authority。没有 durable Git ledger、
Actions-artifact ledger、central controller、cached receipt 或 sticky-comment
authority。runtime 不上传 artifacts，也不保留 raw API payloads。

best-effort sticky diagnostic 只是 output projection。其 v2 marker 与 request
markers 不同，且不包含 `@codex review`。只有 `github-actions[bot]` marker comment
符合条件。runtime 会尽量更新最旧的 canonical duplicate，保留并警告其他
duplicates，也可以重建被删除的 diagnostic。sticky 缺失、编辑、重复或不可写都不能
改变 gate decision。

### Admitted evidence

reducer 只消费符合条件的 Codex top-level issue comments 和 PR review bodies。
它不把 inline review threads 或 conversation resolution 视为 reducer authority；
installed ruleset 负责这个条件。

provider carriers 必须绑定 exact bot identity。相似 name、复制的文本或 user-authored
claim 都没有 authority。finding severity label 不影响 blocking：任何符合条件的
finding 都会阻塞。

### Review generations

authorised generation 只能由一条 exact、未编辑的 `@codex review` request 建立。
其 first visible line 必须 exact，且没有其他 visible text。普通 request author 默认
必须有 `write`、`maintain` 或 `admin` repository permission。受保护的
default-branch configuration 可以明确把 threshold 设为 `any`。workflow-authored
request 还需要 exact v2 marker，绑定 full head 和 run。

permission threshold 保护 generation reset，不保护 negative evidence。符合条件的
provider findings 不受 request-author permission 影响，始终阻塞。

通常情况下，terminal clean text 与符合条件的 provider `+1` 是同等 clean carriers。
一旦观察到 base epoch，terminal payload 无法证明它由哪个 request/base snapshot
产生；在这个降级 lineage mode 中，只有直接附着在最新且严格晚于 epoch、绑定当前
base 的 canonical workflow request 上的合格 `+1`，才能作为 positive 或
superseding carrier。无法归因的 terminal clean 只保留为 diagnostic evidence，不能
pass 或清除 finding。这是 carrier parity 的明确 fail-closed 例外。terminal
carrier 包含 reviewed commit 时，只有 GitHub 能把 full/abbreviated SHA 无歧义
解析为 current bound head 才接受。对于 PR review，resolved commit 还必须等于
native `commit_id`。没有 match 或存在多个 relevant match 的 short prefix 属于
indeterminate；runtime 绝不猜测，也不从无关 prose 中模糊提取方便的 token。

### Finding supersession

符合条件的 current-head finding 具有保守 precedence。在同一 head 上，旧
non-inline finding 只有同时证明以下两项时才被 supersede：

1. 存在严格更新的 authorised review generation；
2. 之后出现属于该新 generation、绑定该 head 的 terminal clean 或合格 `+1`，并满足
   上述 base-epoch direct-reaction rule。

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
- reviewed-commit resolution 与 native review `commit_id`；
- collection completeness 与 exact-object refetch results。

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
force-push，下一次 exact reconcile 会从 timeline 恢复 pending；但在不增加 push
listener、webhook App 或 cron 的 v2 边界内，无法实时 reset status。

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
| `default` | 20 | 2,000 | 128 | 32 MiB | 10 s | 60 s |
| `expanded` | 100 | 10,000 | 512 | 64 MiB | 20 s | 300 s |
| hard ceiling | 1,000 | 20,000 | 2,048 | 64 MiB | 30 s | 720 s |

page size 为 100，单个 response 上限 8 MiB，clean inter-read delay 为 5 秒，
workflow job timeout 为 14 分钟。确实存在大型 PR 的 repositories 可以持久选择
reviewed `expanded` profile。per-dispatch numeric override 延期到 v2.0 之后。

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
| `healthy/failure` | 已证明符合条件的 findings，并成功投射 failure status。 |
| `unhealthy/failure` | 已证明 findings，但 failure-status projection 失败。 |
| `healthy/pending` | provider evidence 尚未 terminal。 |
| `unhealthy/pending` | API、pagination、cap 或 stability execution 不完整。 |
| `healthy/not_applicable` | delayed automatic event 已 stale。 |
| `unhealthy/not_applicable` | manual target 无效或 scope 不受支持。 |
| `unhealthy/unknown` | 无法读取或投射任何 trusted state。 |

`unhealthy/success` 被禁止。workflow conclusion 表示 execution health；bound head
上的 commit status 表示 gate outcome。这样可把普通 findings 与 evaluator failure
分开。

`status_projection` 只出现在 summary。无需额外 evidence query 时，summary 和
sticky 还会报告 `findings_unresolved`、`findings_resolved`、
`findings_historical` 与 `findings_indeterminate`。pagination 不完整、API failure
或 cap hit 会使受影响值为 `unknown`，而不是 zero。这些只是 normalized
non-inline findings 的 diagnostics，不是 public Action outputs 或 inline-thread
authority。

summary 和 sticky 包含 bounded reason、recovery code 与具体 next action。必要时会
暴露 object identities、digests、bounded escaped excerpts 和 links，但绝不暴露
tokens、headers、raw payload dumps 或 untrusted workflow commands。

at-least-once recovery 在 write result unknown 后可能生成少量 duplicate requests、
statuses 或 diagnostic attempts。runtime 会保守地 fold/report duplicates；它们绝不
允许选择一个方便的 clean 或漏掉 finding。

## Exact-head merge closure

stable A/B snapshots 只证明短暂 observation window，不会锁定 PR。merge 前，agent
必须：

1. 重读 exact current PR head；
2. 为该 exact head dispatch `reconcile`；
3. 要求 Action output 为 `healthy/success`；
4. 重读同一 unchanged head 上、expected source 为 GitHub Actions 的
   `codex/github-review-gate`；
5. 要求 ruleset 确认 branch up to date、all conversations resolved 且 merge
   allowed。

任何 head 或 policy change 都必须重启该 closure。旧 success 绝不是 permanent
review lease。

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
- status 以 PR 而不是 commit SHA 为 scope；
- release publisher App 提供 runtime authority。

## v1 隔离

v1 对尚未迁移的 consumers 保持 frozen 和 valid。v2 不读取 v1 state、不发布
compatibility selector、不修改 v1 refs，也不 fallback 到 v1 reducer。迁移在一个
PR 中删除 v1 installation 并安装完整 v2 workflow/ruleset，再用单独的无害 canary
PR 验证 v2；该 canary 不 merge，直接关闭。
