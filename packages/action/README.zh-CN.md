# Codex Review Gate v2

语言：[British English (en-GB)](README.md) | [简体中文 (zh-CN)](README.zh-CN.md)

Codex Review Gate 把单个 PR 上可信的 OpenAI Codex review 证据归约为 native required
CheckRun `codex/github-review-gate`。GitHub 把 verifier run/job/CheckRun 记录在 exact PR
feature-head SHA 上。canonical
`pull_request` verifier 仍在 `refs/pull/N/merge` 上执行；Action 内部严格校验
`GITHUB_REF`、`GITHUB_SHA`、event head/base 范围，以及其 test-merge 与 runtime SHA
相同的 fresh PR read。事件校验仅限 head/base 的 SHA、ref 与 repository；event
`merge_commit_sha` 可以缺失或来自历史快照，不作为 binding input。受保护的
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

Canonical verifier workflow 授予只读 `actions: read`，让 Action 能通过
`GET /repos/{owner}/{repo}/actions/runs/{run_id}` 读取自身 `pull_request` run
由 GitHub 服务器记录的 `created_at`。Private repository 必须具备此权限。
发布依赖该读取的 floating `v2` runtime 前，先更新所有已安装 consumer 中经逐字校验的
verifier workflow；缺少权限的旧 workflow 会 fail closed，不能回退使用 Git commit date
或未经校验的 event timestamp。

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

- activity type 为 `created` 的 `issue_comment`；
- activity type 为 `completed` 的 `workflow_run`，仅在启用 opt-in variable 且
  canonical `Codex Review Gate Verifier` `pull_request` workflow 的首次 attempt
  （`run_attempt=1`）失败时放行；
- 为单个明确指定 PR 运行的 `workflow_dispatch`。

没有 cron、`repository_dispatch`、`pull_request_target`、可写自动
`pull_request_review` job、runtime GitHub App 或 status writer。review objects 和
reaction-only completion 由之后的 authoritative verifier reconcile 发现。

自动评审请求默认关闭。organisation 或 repository Actions variable
`CODEX_REVIEW_GATE_AUTO_REQUEST` 必须精确等于小写 `true` 才能授权请求；未设置时会跳过
自动 controller job，其他值均不能发出请求。GitHub Actions 的 job 条件不区分字符串大小写，
因此 `TRUE` 等大小写变体仍可能分配 controller runner，但 runtime 会在发帖前拒绝。
repository 值覆盖 organisation 值。同一份 controller 重新读取已完成且失败的 verifier，
仅接受它唯一关联的 current-head PR；该 PR 必须 same-repository、open、ready，且以当前
default branch 为 base。只有 exact repository/PR/head/base scope 还没有匹配的
canonical request 时，才发送新请求；否则采用已有请求。自动操作至此结束，不会立即
rerun verifier。之后由 exact Codex bot comment 或受保护的 manual `reconcile` 发起
rerun。此路径可跟在 `opened`、`reopened`、`synchronize` 或 `ready_for_review`
之后，不限于 push。Merge conflict 可能阻止 `pull_request` verifier 运行；没有该 run
就不会自动请求，应先解决冲突，必要时再手动恢复。`workflow_run` 使可写 controller
保留在受保护 default branch 上，且不依赖 public repository 的
[`pull_request_target` 默认 event policy](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)。
无需第三份 workflow、新 GitHub App 或 ruleset。Joey-Tools rollout 应先
把 organisation variable 的 selected-repository visibility 仅设为
`codex-private-workflows`，不设置 repository-level override；canary 成功后再扩大范围。

只有 event sender 和 comment author 都是 exact Codex provider
`chatgpt-codex-connector[bot]`、GitHub type `Bot` 时，自动 comment job 才会在
runner 分配前被 admit。Action 在 runner 启动后再次校验 identity 和 scope。
edited Codex comment 不会自动启动 canonical controller；应使用受保护的 manual
`reconcile` 进行恢复。Action 为 direct caller 的兼容性仍可解析 `edited` event，
但这不是 canonical automatic ingress。
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
authoritative head。自动 verifier-run 路径传入 upstream exact head、`begin-review` 和
`request_review=true`。任何路径都不能跟随之后发生的 head change。两份 Action steps 只从
受保护 repository variable `CODEX_REVIEW_GATE_LIMITS_PROFILE` 获得 `default` 或
`expanded`；dispatch caller 不能覆盖该值。

## Operations

### `begin-review`

`begin-review` 校验 exact PR 和 expected head，并默认创建或安全采用一条带 canonical
hidden binding 的 fresh exact `@codex review` request。manual dispatch 会先精确读回
该 request，再请求 exact current verifier 的 full rerun。`request_review=false` 仅是
advanced best-effort manual option，不会增加专用 barrier。启用 opt-in 自动
verifier-run trigger 时，`begin-review` 必须请求评审，并在发送或采用 current-scope
canonical request 后结束，不会 rerun verifier。自动路径可以采用较早 controller run
留下的匹配 request；manual 路径仍只采用同一次 run 绑定的 request。不确定的 request
POST 保持 fail-closed，不会让 required verifier CheckRun 通过。

同一 PR 的 controller runs 使用 `cancel-in-progress: false` 串行化。执行 rerun 时，
controller 记录 verifier attempt `A`、要求没有 competing canonical attempt、只请求一次
full rerun，并必须观察 exact attempt `A+1` 及其唯一 canonical job/CheckRun。POST 不确定或新 attempt
不可见时仍保持 blocking；concurrency 只是 scheduling，不是 mutation fence。

普通低成本路径中，agent 可以在其他 checks 运行时直接发送 exact
`@codex review` 作为 provider-side attempt，只在需要 reconcile 时调用 GHA。该 comment
不保证 Codex 会启动；eligibility 与 delivery 仍由 provider 控制。gate 等待 official
evidence，若未到达则保持 pending。在 canonical `any` policy 下，direct ordinary comment
在 Codex 直接确认该 exact comment 前只是 candidate，不能重置已 passing 的 generation。
workflow 必须协调 pending transition 和 request 时使用 `begin-review`；这也包括旧 success
后的 deliberate same-head re-review。

### `reconcile`

`reconcile` 重读所选 PR，并定位 native CheckRun 挂在 current feature head、run 绑定
current test-merge 的唯一 canonical verifier。
随后使用同一套 baseline/rerun/readback handshake 建立严格更新的 full verifier attempt。
controller 不提供 verdict，也不改写 CheckRun；只有只读 verifier 收集证据，其 native job
conclusion 承载 required result。

reducer 读取符合条件的 Codex top-level issue comments 和 PR review bodies。
另外，每个完整 evidence snapshot 都通过 GitHub GraphQL 读取 PR 的全部 review
threads，并要求所有 thread 均已 resolved。ruleset 仍须独立要求 “all conversations
resolved”，作为 server-side merge guard。

## Evidence 语义

review generation 始于一条 exact、未编辑的 `@codex review` request。visible first
line 必须 exact，且不得有其他 visible text。默认 `any` policy 会把 ordinary request
author（任意 repository permission）纳入 snapshot 作为 candidate，而不是立刻视作
generation boundary。它有两类获得 provider confirmation 的方式：

1. official Codex Bot 在同一条 comment 上留下严格晚于当前 revision 的直接 `eyes` 或
   `+1` receipt；或
2. 仅限没有 base epoch、single-flight lineage 中唯一一条 exact、未编辑的 ordinary
   request：严格晚于该 request、无歧义绑定 current head 的未编辑 official
   terminal-clean receipt 可以是：
   - 顶层 issue comment（PR 的普通评论，不是 pull-request review body）中的 terminal
     clean；或
   - 官方 Codex Bot 的 `COMMENTED` PR review parent；它必须通过 closed grammar（固定标题、
     `Reviewed commit` 与 native `commit_id` 的无歧义匹配、以及固定官方 disclosure，
     而不是自由文本猜测）验证；它只证明 parent 没有 non-inline finding payload，不证明
     任何 child/thread 存在或已 resolved。

第二类是刻意收窄的最小 receipt。额外或 ambiguous request/physical boundary、request 或
terminal 被编辑、terminal carrier 不匹配，或 head/SHA binding 有歧义时，普通 candidate
路径都保持 pending；下述 duplicate cohort 与 current-head clean recovery
（恢复早于本次 verifier run 的同 head clean 的狭窄路径）分别是严格限定的第二条
boundary 例外。terminal 指定 reviewed SHA 时，short SHA 只有被 GitHub 无歧义解析为 current PR
head 才接受。同一 comment 上 official `eyes`/`+1` 的直接 receipt 仍然受支持。这只决定
gate 如何归因；不授予 commenter 调用或控制 Codex review 的权限，不会使 Codex 必然启动，
也不意味着任何用户都能让 review 启动。是否真的启动 provider review 仍由 GitHub 与 Codex
决定；没有 terminal-clean contender 的未确认 candidate 不能 reset、抢占或使既有 clean
失效；尝试但未满足狭窄规则的 terminal-clean receipt 保持 fail-closed pending。canonical workflow 直接固定
`CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION=any`，不会把它暴露成
standard strict-policy setting。`write` threshold（`write`、`maintain` 或 `admin`）仅保留给
将来具有 collaborator permission 读取能力的 nonstandard verifier identity；bundled
read-only verifier token 无法可靠完成这个读取。workflow-authored request 还必须带
canonical v2 hidden marker，绑定完整 head SHA、当前 base repository/ref/SHA 和 workflow
run。符合条件的 Codex findings 不受 request-author permission 影响，始终阻塞。

有一个仅用于恢复的例外，避免已经完成的重复对永久污染后续 canonical generation。这里的
*duplicate cohort*（固定的历史两条请求对，不是应主动生成的请求模式）只在以下条件同时成立时
接受：没有 base epoch；恰好两条彼此严格顺序、未编辑、exact default-`any` 的 ordinary
（不带 canonical marker）`@codex review` request，且来自同一 `User` login；两条都没有
official `eyes`/`+1`；之后有一条未编辑、official 的顶层 issue-comment clean，且无歧义解析到
current PR head；整个 snapshot 没有 provider error；每一个 pair 之前、具有有效 activity window 的
official 顶层 `issue-comment` provider artifact 都会否决 cohort，除非它是已安全分类的 historical
terminal：kind 为 `clean` 或 `finding`、未编辑、没有 `orderingError`/`resolutionError`，且跨
`resolvedHeadSha` 与 `headSha` 恰有一个完整、无歧义的 SHA。这也包括其他 unknown 或 unclassified、
malformed、progress 或 nonterminal 的 official 顶层 `issue-comment`：只要具有有效 activity window，
就属于不透明 provider activity（只作阻塞，不作 clean 证据），并否决 cohort。较早的 carrier 仍可能是后来 clean 的
来源；保留安全历史 terminal 依赖这条明确例外，而非仅有 full-head binding。从第一条 request 到该
clean（若存在唯一 canonical successor，则到该 successor）之间不得出现任何额外的 provider artifact
或具有有效 activity window 的不透明 provider activity。不透明 provider activity 仅是排除用的 side
channel：不进入普通 reducer、liveness、finding、clean 或计数路径。唯一允许的
后继只能是一条严格更晚、绑定 current 完整 head/base tuple
的 canonical workflow request。没有后继时，较晚的 ordinary request 被确认、较早的被合并；有该
后继时，较晚的 ordinary request 保留为已确认、已闭合的 predecessor，之后无绑定的 terminal 不能
令 successor pass，后者必须取得自身的 official direct `+1`。inline-parent receipt、第三条
request、不同 author、edit、base epoch、两条 ordinary request 上的 reaction、provider
progress/error、任一不属于上文安全 historical-terminal 例外且具有有效 activity window 的 pre-pair
official 顶层 `issue-comment` provider artifact、finding 或其他 successor 均保持 fail-closed。该例外
要求列出的每项 terminal property；历史 terminal clean/finding 不能仅凭 full-head binding 被保留。
agent 不得故意创建这类请求对；它只恢复 GitHub immutable snapshot 中已经存在的历史证据。

另有 *current-head clean recovery*，仅在没有 base epoch 时用于恢复已指向 current head、
但早于本次 verifier run 的可信 clean。cutoff `T` 是原始 `pull_request` verifier run 的 GitHub-server
`created_at`；同一 run 的 retries 固定使用该值。恢复见证由一条新鲜且符合条件、exact、未编辑的
request `R`：可为 `User` 发出的 exact、未编辑 ordinary `@codex review`，或一条已验证且未编辑的
canonical Actions request，其 repository、PR、完整 head/base tuple 和 workflow-run marker 与所选
PR/verifier scope 完全匹配。随后必须有一条可信、未编辑的 top-level issue-comment terminal clean，
且其 reviewed SHA 唯一解析为 current full head SHA。时间顺序必须严格为
`T < R < C`。`R` 必须是 `C` 之前最新的 physical request boundary，且 `C` 之后不能有
request boundary。这只是 head attestation（证明 clean 指向所选 current head，不证明 request
与 clean 的因果关系），不证明 `R` 导致 `C`，也不证明发出 `R` 会启动
Codex。`T` 之前的 ordinary requests 仍须接受完整 lineage audit；但只附着于这些历史 request
的归因缺口，不会单独使此恢复见证失效。旧 request 上尚未由其自身后续 `+1` 结清的 official
`eyes` 仍按现有 liveness 规则阻塞。

该保守 cutoff 不是 PR `synchronize` 的精确时间；Git commit date 和未经验证的 event timestamp
都不能作为 fallback。此恢复不能清除 finding 或 provider error，也不豁免 edited、deleted、scope
drift、live 或 ambiguous evidence。仍须完成 inventory、exact refetch 和两轮稳定 snapshot。
成功还要求两轮稳定 snapshot 中的所有 review thread 都已 resolved；GitHub 明确标为 resolved
的旧 head 或人工 thread 也可接受。provider comment 或手动 `reconcile` 之后仍须 rerun
exact-head verifier。新 verifier run ID 不继承这个 cutoff。

每个 snapshot 还读取 GitHub PR timeline 中最新的 `BaseRefChangedEvent` 或
`BaseRefForcePushedEvent`。positive request/clean authority 必须严格晚于该 base
epoch；timestamp 相同属于歧义，保持 pending。provider terminal payload 不会标明
产生它的 request 或 base snapshot，因此一旦 PR 出现过 base epoch，就采用更窄的
recovery rule：只有直接附着在 epoch 后、绑定当前 base 的 canonical workflow request
上的合格 provider `+1`，才能提供 positive clean authority 或 supersede 旧 finding。
没有 base epoch 的 PR 仍支持无需 workflow marker 的 ordinary direct
`@codex review`，可使用上述两种 receipt 方式；一旦出现 base epoch，terminal receipt
不再可用。findings 在 epoch boundary 两侧始终保守阻塞；无法归因的 terminal clean 保持
pending，runtime 不会猜测它属于新 generation。

除 current-head clean recovery 外，terminal clean 文本和符合条件的 provider `+1`，
只有在没有 base epoch、single-flight lineage 的第一个物理 generation 中才具有相同
clean authority。唯一符合最小 receipt rule
的 default-`any` ordinary request，其匹配的 official 顶层 issue-comment terminal clean，
或上文所定义的 official exact-head `COMMENTED` inline-parent closed-grammar review，
可以同时确认这个第一个 generation，并携带该 clean authority。后者不是 generic
pull-request review clean：任意不满足该固定 parent grammar 的 review 都不能确认
default-`any` candidate。recovery-only duplicate cohort 是另一种额外的顶层 clean 情形：它只
确认较晚的 ordinary request，不接受 inline-parent receipt；若存在 canonical successor，后者仍必须
取得自身的 direct official `+1`。符合条件的 finding 独立阻塞，绝不充当 receipt。
没有 receipt contender 的 candidate 不是 physical boundary。存在 terminal-clean contender
但未满足狭窄条件时，它以 fail-closed physical-only boundary 保持 pending。其他每条可能触发
provider 的 request-shaped comment 都是物理 generation boundary，包括 duplicate hidden
marker、edited/malformed request 和 authorisation 失败的 request。boundary 只表示可能存在
未知 provider flight，不授予 positive authority。在 nonstandard
`write` threshold 下，其他条件均合法的
ordinary request 必须先查询 permission（同一 snapshot 内按 author 缓存），才能判定为
denied；判定后不再触发 reaction 或 exact-refetch fan-out。更早因 shape、author 或 binding
无效而拒绝的 boundary，也不触发 permission、reaction 或 exact-refetch fan-out。每个已观察
到的 `CommentDeletedEvent` 都是 unbound physical-only boundary，因为其正文不可恢复；若它
处于不可闭合的 historical gap，必须使用 replacement PR。同一 head
的 canonical request 即使 base tuple 已旧，也仍是 boundary；只有 exact current head/base
tuple 才有 authority。没有 base epoch 时，严格位于第一个 request 与后继 request 之间的 provider
terminal evidence 只能闭合第一个 gap。之后的每个 gap，以及任何前面已有物理 request
的 generation 所需 positive clean/superseding authority，都必须来自直接附着于该
request 的合格 `+1`，唯一相关例外是上述新鲜 current-head clean recovery。terminal
payload 没有 originating request ID，无法证明它属于
新 request，还是旧 generation 的延迟或重复 carrier，因此不能让新 generation pass
或 supersede findings。出现 base epoch 后，current-head clean recovery 不适用：现有规则要求
exact-current-tuple canonical Actions request 上的 direct provider `+1`，top-level terminal clean
不会增加 authority。

同一个或更晚的 official `eyes`/provider activity 如果不晚于后继 boundary，会让前一个
generation 保持 open；与后继 boundary 同时属于 timestamp-ordering ambiguity，不能
证明 review 已经完成。最新 request 的 clean 不能跨过更早的 unclosed gap，后继
boundary 之后才到达的 evidence 也不能倒推修复该 gap。带有单一、无歧义 commit
binding 的 progress 会直接归入对应 head。所有 unbound progress 都必须保留在 current
inventory；邻近 request 的 timestamp 不能证明其 originating flight 或 head。edited
terminal carrier 还会产生一个从 `created_at` 到 terminal revision 的 unbound unknown-
activity interval；只有在评估同一 carrier 的同一 terminal 时，才豁免它自己的 terminal
endpoint，不能豁免其他 carrier。provider terminal 只有在 predecessor reaction inventory
完整，且从该 terminal 到 successor 没有当前 `eyes` 或 provider activity 时，才能闭合
第一个 gap。
未确认的 default-`any` ordinary candidate 上，official 直接且 post-revision 的 `eyes` 或
`+1` 先充当 receipt，把它升级为 boundary。替代方式是在上述唯一、没有 base epoch、
single-flight rule 下严格晚于 candidate 的匹配未编辑 official 顶层 issue-comment terminal clean，
或 exact closed `COMMENTED` Codex inline-parent review。出现 base epoch、第二个或
ambiguous request/boundary、任何 edit，或 terminal 的 identity、
ordering/current-head binding 有歧义时，都不能使用该方式。上文只接受顶层 clean 的 duplicate
cohort 是第二条 boundary 情形的另一条 recovery-only 例外：它只接受已经存在的两条 request
snapshot，不能让 canonical successor 使用 terminal clean。direct-reaction upgrade 后，
ordinary request reactions 才只用于 provider liveness；ordinary `+1` 本身仍不能
head-bind clean。same-time/later official `eyes`/progress from Codex 会 veto candidate
clean，因为 review activity 尚未被证明 terminal。reaction-only change 没有 automatic
workflow event，必须由 later provider event 或 manual reconcile 重新观察。
terminal evidence 指定 reviewed commit 时，可以使用 full 或 short SHA。只有
GitHub 能把 short SHA 无歧义解析为 current PR head 时才接受；对于 PR review，
resolved SHA 还必须与 review 原生 `commit_id` 一致。

任何符合条件的 current-head non-inline finding 都会立即阻塞。在同一个 head 上，
旧 finding 只有同时满足以下条件才能被 supersede：

1. 存在严格更新的 authorised review generation；
2. 随后出现符合上述 lineage rule、绑定该 generation 和 head 的 clean result：只有
   no-base-epoch 的第一个 generation 可以使用 terminal clean（对于 default-`any`
   ordinary candidate 还必须满足最小 terminal-receipt rule），其他情况必须使用合格的
   request-bound `+1`。current-head clean recovery 不能 supersede finding。

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

符合条件的 finding 通常得到 `healthy/failure`，而不是 execution error。完整的
review-thread 清单若仍有未解决项，则得到 `healthy/pending` 和
`wait_then_reconcile`；这也是 gate 决策，而非 execution error。`unhealthy/success` 非法。
在 verifier workflow 中，只有被证明稳定的 `healthy/success` 可以成功结束；findings、
pending evidence、unsupported scope、cancel、timeout 与全部 unhealthy 结果都保持
blocking。required verifier CheckRun 属于 exact current PR feature-head SHA；它的
`pull_request` run 在 `refs/pull/N/merge` 上执行，Action 的 runtime merge-ref、event head/base 与 fresh-read
校验把 success 绑定到 unchanged head、base 与 test-merge；event 部分只绑定 head/base
范围，绝不使用 event `merge_commit_sha`。controller 的
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

Review-thread diagnostics 独立于 findings。`report.reviewThreads.status` 为 `not_read`、`complete` 或
`incomplete`；只有 `complete` 时 resolved/unresolved/total 才是可信数字，否则均为 `unknown`，不能
当作已验证的 zero。Thread diagnostics 是补充信息，必须保留主要 recovery instruction（包括 finding、
permission、budget、replacement-PR 或 begin-delivery 指引）；只有完整读取确认存在未解决 thread 时，
才提示在 GitHub 解决 open conversations 并对同一 exact head 运行受保护的手动 `reconcile`。
该修复不需要重新请求 provider review。

API 读取、pagination 不完整、cap hit 或不稳定 thread state 会使受影响 counts 为 `unknown`，
绝不能写成 `0`。Finding counts 只覆盖 normalized non-inline findings；thread counts 来自
GraphQL review-thread state。两者都不能替代 branch-protection 对 conversation resolution 的独立要求。

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
