# Codex Review Gate v2 Cookbook

语言：[British English (en-GB)](COOKBOOK.md) | [简体中文 (zh-CN)](COOKBOOK.zh-CN.md)

本 cookbook 从已经安装完整
[canonical workflow](https://github.com/Joey-Tools/codex-review-gate/blob/master/templates/codex-gated-repo/.github/workflows/codex-review-gate.yml)
和 disabled
[ruleset 模板](https://github.com/Joey-Tools/codex-review-gate/blob/master/templates/codex-gated-repo/rulesets/codex-review-gate.json)
的状态开始。安装和 canary activation 请使用
[人类可读指南](https://github.com/Joey-Tools/codex-review-gate/blob/master/docs/install/human.zh-CN.md)，
或者让 agent 遵循
[agent 可执行指南](https://github.com/Joey-Tools/codex-review-gate/blob/master/docs/install/agent.zh-CN.md)。

## 命令变量

示例使用：

```bash
REPO="OWNER/REPO"
PR_NUMBER="123"
DEFAULT_BRANCH="master"
WORKFLOW="codex-review-gate.yml"
```

每次 dispatch 前立即读取 exact current head：

```bash
HEAD_SHA="$(gh pr view "$PR_NUMBER" --repo "$REPO" --json headRefOid --jq .headRefOid)"
```

push、update-branch operation、base change、close/reopen transition，或 PR state 存在
任何不确定性之后，都不要复用该值。

每次 dispatch 只处理一个 PR。恢复多个 PR 时，分别读取每个 PR 的 head 并启动
独立 run。

## 选择路径

### 普通低成本 review

如果 exact head 上没有必须先失效的旧 success，普通 agent path 是：

1. 读取 open PR 和 exact current head；
2. 发送一条 complete visible content 只有 exact `@codex review` 的 comment；
3. 让 Codex 发布证据，不占用 Actions runner；
4. 为该 exact head dispatch `reconcile`；
5. 按 summary 前进，直到 final exact-head merge closure 通过。

优先使用 task-scoped body file 和 `gh pr comment --body-file`，避免 shell quoting
增加 visible text。不要手工构造 workflow-owned hidden marker；该形式由
`begin-review` operation 负责。

普通 request author 的默认最低权限是 `write`、`maintain` 或 `admin`，除非受保护的
default-branch configuration 明确选择 `any`。

### Workflow-coordinated review

workflow 必须先建立 pending 并拥有 request 时，使用 `begin-review`；这也包括旧
success 后的 deliberate same-head re-review：

```bash
gh workflow run "$WORKFLOW" \
  --repo "$REPO" \
  --ref "$DEFAULT_BRANCH" \
  -f operation=begin-review \
  -f pr_number="$PR_NUMBER" \
  -f expected_head_sha="$HEAD_SHA" \
  -f request_review=true \
  -f limits_profile=default
```

必须观察 exact run 完成，才能把 pending 视为 barrier。同一 PR concurrency group
使用 `cancel-in-progress: false`，但 GitHub 仍可能替换尚未启动的 pending run。

高级形式：

```bash
gh workflow run "$WORKFLOW" \
  --repo "$REPO" \
  --ref "$DEFAULT_BRANCH" \
  -f operation=begin-review \
  -f pr_number="$PR_NUMBER" \
  -f expected_head_sha="$HEAD_SHA" \
  -f request_review=false \
  -f limits_profile=default
```

只写 pending，不发送 request。它是 best effort，不增加专用 barrier。只有观察 exact
run 完成后，才发送新的 exact `@codex review`。

### Reconcile 一个 exact head

Codex evidence 到达后，或者 recovery instruction 要求 reconcile 时：

```bash
gh workflow run "$WORKFLOW" \
  --repo "$REPO" \
  --ref "$DEFAULT_BRANCH" \
  -f operation=reconcile \
  -f pr_number="$PR_NUMBER" \
  -f expected_head_sha="$HEAD_SHA" \
  -f limits_profile=default
```

summary 或 provider event 指出 relevant request 时，可以提供
`request_comment_id` 作为 locator hint。它绝不提供 verdict，也不能允许 partial
negative-evidence scan：

```bash
gh workflow run "$WORKFLOW" \
  --repo "$REPO" \
  --ref "$DEFAULT_BRANCH" \
  -f operation=reconcile \
  -f pr_number="$PR_NUMBER" \
  -f expected_head_sha="$HEAD_SHA" \
  -f request_comment_id="$REQUEST_COMMENT_ID" \
  -f limits_profile=default
```

绝不要使用 `repository_dispatch`、feature-ref dispatch 或 ad-hoc numeric limit
inputs。受支持 workflow 是 protected default branch 上的 typed
`workflow_dispatch`。

## 普通 agent loop

1. 证明 target 是指向 default branch 的 open、non-draft、same-repository PR，
   并读取其 exact head。
2. 需要新 review generation 时，按上文选择直接 exact `@codex review` 或
   `begin-review`。
3. 等待 Codex。不要创建 cron 或反复盲发 request loop。
4. 为 exact head dispatch `reconcile`。
5. 读取四个 Action outputs 和 Actions summary：`execution_health`、
   `gate_outcome`、`recovery_code`、`retry_safe`。
6. 执行 summary 中唯一具体 next action。不要根据 zero counts 或 sticky comment
   推断 clean。
7. 结果达到 `healthy/success` 后，在 merge 前立即执行 exact-head merge closure。

任一步骤中 head 发生变化都必须停止。读取 new current head，再按需开始 fresh
generation/reconcile。stale run 绝不跟随 new head，也不向它写入本次 decision。

## 解读结果

| Result | 含义 | Operator action |
| --- | --- | --- |
| `healthy/success` | 已证明稳定、完整的 current-head clean evidence。 | 执行 final status/head/ruleset 重读；全部仍匹配才 merge。 |
| `healthy/failure` | 已证明符合条件的 findings 并投射 failure。 | 按 finding links 修复，或取得 authorised newer clean generation，再 reconcile。 |
| `unhealthy/failure` | 已证明 findings，但 status projection 失败。 | 保持 findings 阻塞，修复 projection/permissions，再 reconcile。 |
| `healthy/pending` | 完整证据表示 provider 尚未 terminal。 | 等待 provider progress，再按指示 reconcile。 |
| `unhealthy/pending` | API、pagination、cap 或 stability execution 不完整。 | 按 recovery code 操作；绝不能把它解释为没有 findings。 |
| `healthy/not_applicable` | delayed automatic event 已不再适用。 | 通常无需操作；仍需 gate decision 时 reconcile current head。 |
| `unhealthy/not_applicable` | manual target 无效或不受支持。 | 修正 target 或使用 supported scope；不要 bypass ruleset。 |
| `unhealthy/unknown` | 无法读取或投射 trusted state。 | 修复 access/execution，重读 PR，再执行 summary recovery action。 |

`unhealthy/success` 永远不合法。workflow failure 描述 evaluator health，不表示
Codex finding。正常 run 的 `gate_outcome=failure` 表示 evaluator 正常工作，merge
必须继续阻塞。

`retry_safe=true` 表示使用相同 inputs 立即 rerun 是有效 recovery action。它不表示
success 可能性更高，也不允许 runtime 跳过证据。为 false 时，先完成
`recovery_code` 指定的 head refresh、permission repair、provider wait 或 finding
change。

## Recovery codes

| Code | 安全 next action |
| --- | --- |
| `none` | evaluator 无需恢复；执行 exact-head merge closure。 |
| `wait_provider` | 等待 Codex 发布 terminal evidence；不要 spam requests。 |
| `reconcile` | 重读 exact current head 并运行一次 scoped reconcile。 |
| `fix_findings` | 修复报告的 current findings，另行解决 inline conversations，取得 later head-bound clean evidence，再 reconcile。 |
| `request_clean_generation` | 为同一 head 请求严格更新的 authorised generation，并等待绑定它的 clean；任意 later clean 不够。 |
| `retry_reconcile` | `retry_safe` 允许时 retry 同一个 exact-head reconcile。 |
| `wait_then_reconcile` | 等待 GitHub/Codex settle，重读 head，再 reconcile。 |
| `use_expanded_limits` | 对同一 PR 使用 reviewed `limits_profile=expanded`；如果仓库经常需要，则在 wrapper 中持久选择该 profile。 |
| `raise_protected_limit` | reviewed profiles 仍不足；通过普通 review 修改 protected product/configuration limit，不得提供 ad-hoc number。 |
| `refresh_head` | 读取 authoritative current head 并开始 fresh operation；绝不让 stale run 跟随。 |
| `repair_permissions` | 恢复 canonical workflow permissions/status source 或报告的其他 access boundary，再 reconcile。 |
| `retry_begin` | 不可立即安全 retry：先等待 exact same-run marker 的可见性稳定；若仍不存在，只 rerun 原 workflow run；不要另行 dispatch generation 或盲目发送 duplicates。 |
| `unsupported_target` | 移至文档化 supported scope，或者保持 gate blocked。 |

summary 才是该 code category 内具体 reason 和 object links 的 authority。该表不允许
绕过 missing data 自行猜测。

## Finding 对账和 supersession

无需增加 evidence query 即可推导时，summary 与 best-effort sticky 会报告：

- `findings_unresolved`——admitted current unresolved non-inline findings；
- `findings_resolved`——reducer model 中 admitted resolved findings；
- `findings_historical`——为 audit 保留的 superseded 或其他 historical findings；
- `findings_indeterminate`——无法安全确定 current classification 的 findings。

API read、page set 不完整或 capped scan 会使受影响值为 `unknown`，绝不是 zero。
counts 只是 diagnostic。inline conversations 不计数；ruleset 的 “all
conversations resolved” 要求负责它们。

任何符合条件的 current-head non-inline finding 都会立即阻塞。它不是 permanent
lease：在同一 head 上可以被 supersede，但只能由严格更新的 authorised
`@codex review` generation 加上之后绑定该 generation/head 的 clean 完成。无关 later
clean、edited request 或 ambiguous ordering 都不能抹掉它。

finding 真实存在时，修复后使用 `fix_findings`。代码无需变化、finding 已 obsolete
或不适用时，使用 `request_clean_generation`。两种情况都要等待 later provider
result 后 reconcile；只解决 inline conversation 不会改变 reducer state。

## Stable-snapshot 恢复

只有 clean candidate 需要两次独立、fully paginated 的 GitHub reads，两次间隔 5 秒。
同一 head 上 request、edit、reaction 或其他 decision-relevant change 会重启 pair。
head 或 lifecycle change 会使 run stale。API、pagination 和 cap failure 会使 read
incomplete。

stability budget 结束前没有两次匹配 clean snapshots 时，应得到
`unhealthy/pending` 和 `wait_then_reconcile`：

1. 停止修改 PR/provider evidence；
2. 等待 GitHub 与 Codex settle；
3. 重读 exact current head；
4. dispatch 一次 scoped reconcile。

不要删除 provider evidence、削弱 required status，或把 unstable read 解释为 clean。

## 大型 PR 和 profiles

从 `limits_profile=default` 开始。summary 报告 `use_expanded_limits` 时，只重跑受
影响的 PR：

```bash
gh workflow run "$WORKFLOW" \
  --repo "$REPO" \
  --ref "$DEFAULT_BRANCH" \
  -f operation=reconcile \
  -f pr_number="$PR_NUMBER" \
  -f expected_head_sha="$HEAD_SHA" \
  -f limits_profile=expanded
```

如果大型 PR 对该仓库很常见，应通过 review 把 canonical wrapper default 持久改为
`expanded`，避免后续 operators 无限循环。不要增加临时 `max_pages`、
`max_objects` 或其他 numeric dispatch inputs。若 `expanded` 仍不足，遵循
`raise_protected_limit`，通过产品普通 review/release path 修改 protected limit。

## Short-SHA evidence

provider terminal evidence 可以指定 short reviewed SHA。runtime 会让 GitHub 在
relevant PR scope 内解析：

- 唯一无歧义 match 且等于 current head，可以绑定 evidence；
- 无 match 保持 unbound；
- 多个 matches 属于 indeterminate，不能 pass；
- PR review 的 native `commit_id` 还必须等于 resolved current head。

不要仅为了展开 prefix 而编辑 provider evidence。若它 ambiguous 或绑定其他 commit，
应请求新的 current-head generation。

## Sticky diagnostic 恢复

sticky 是 best-effort report，不是 receipt。如果它 missing、edited、duplicated 或
stale：

1. 保持 provider evidence 不变；
2. 重读 current head；
3. 运行一次 exact-head reconcile；
4. 信任从 GitHub 重建的新 status 与 summary。

sticky write failure 不会清除 findings。runtime 可以更新最旧 canonical diagnostic
并警告之后的 duplicates，但决定 gate 不需要删除 duplicates。

## Exact-head merge closure

merge 前立即：

1. 重读 PR current head；
2. 用该 exact SHA dispatch `reconcile`；
3. 要求 `execution_health=healthy` 且 `gate_outcome=success`；
4. 重读同一 unchanged SHA 上的 `codex/github-review-gate`，并验证其 expected source
   是 GitHub Actions；
5. 要求 branch up to date 且 all conversations resolved；
6. 要求 ruleset 允许目标 merge。

head 或任一 gate 发生变化时，不要 merge；为 new state 重复 closure。stable
snapshots 不会在 run 后锁定 PR。

## 从 v1 迁移

使用一个 installation PR 移除 v1，并安装完整 v2 workflow 和 disabled ruleset
template。不要只用裸 `uses: ...@v2` step 替换 v1 workflow call。

installation PR merge 后：

1. 另开一个无害 canary PR；
2. 运行普通 `@v2` review/reconcile path；
3. 验证 exact-head status source、freshness 和 conversation enforcement；
4. 激活已验证 ruleset；
5. 不 merge，直接关闭 canary PR。

canary 失败时，通过普通 forward Git history 修复。不要把 `v2` release alias 向后
移动，也不要削弱 ruleset 来制造 pass。
