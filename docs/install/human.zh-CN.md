# 安装 Codex Review Gate v2

本文面向仓库维护者。[Agent 执行手册](agent.zh-CN.md)把同一套安装流程写成
确定性的执行清单，并不是另一种安装模式。两份指南都使用
`templates/codex-gated-repo/` 下的 canonical assets。

普通单仓 rollout 使用两个 PR：

1. 一个 migration PR 同时移除 v1 caller、安装两份 canonical v2 workflows；
2. migration 合并后，另开一个无害 canary PR 验证默认分支 workflow 与 ruleset。

Canary 验证完成后关闭、不合并。

固定 11 仓组织级 handoff 是唯一允许 migration PR 暂不移除 v1 的受控例外。修改该
cohort 的任何成员前，必须先阅读下方 advanced section。

## 安装内容

完整安装包含三个必需 asset groups：

1. canonical read-only verifier `.github/workflows/codex-review-gate.yml`，以及受保护
   default branch 上的 controller
   `.github/workflows/codex-review-gate-controller.yml`；
2. 以 `templates/codex-gated-repo/rulesets/codex-review-gate.json` 为基础的 repository
   ruleset；
3. 最终生效的 `.github/CODEOWNERS`：其中两条受管规则必须使用一个显式指定的
   `CONTROL_PLANE_OWNER` 保护 `/.github/workflows/` 与 `/.github/CODEOWNERS`。

Ruleset 必须要求 Code Owner review，并在 push 后 dismiss stale approvals。两份
workflows 都使用兼容的 floating major：

```yaml
uses: JoeyTeng/codex-review-gate-action@v2
```

不得把该 selector 替换成 prerelease。唯一例外是 release operator 在
[`RELEASING.zh-CN.md`](../RELEASING.zh-CN.md) 中定义的 temporary RC admission bridge，
包括 installed-consumer 与 fresh fixture 两种形态；两者都不是 consumer installation。

必须逐字复制两份 canonical workflows。Action step 无法定义的不同 event 与 permission
边界由它们分别负责：

- read-only verifier 只接受 `pull_request` 的 `opened`、`reopened`、`synchronize`
  与 `ready_for_review`；它在 exact PR feature-head SHA 上的 native
  `codex/github-review-gate` CheckRun 是 required signal；
- controller 自动 wake-up 只接受 `issue_comment` 的 `created` 与 `edited`。它刻意不订阅
  `pull_request_review`：GitHub 把该 event 绑定到 PR merge ref，而 controller 保留了狭窄的
  write authority。只由 review 或 reaction 携带的 Codex 结果因此必须走受保护 default branch
  的手动 `reconcile`；
- runner 分配前，event sender 与 comment author 都必须精确等于
  `chatgpt-codex-connector[bot]`，GitHub type 必须是 `Bot`；
- 唯一手动入口是 `workflow_dispatch`，每次只处理一个 PR；
- 手动 run 必须使用仓库默认分支上的 workflow；
- API-only job 默认使用 `ubuntu-slim`；仅当该 runner 不可用时，repository Actions
  variable `CODEX_REVIEW_GATE_USE_UBUNTU_LATEST=true` 才选择 `ubuntu-latest`；
- verifier 只有 evidence read permissions；controller 才有创建 request 与 rerun exact
  verifier 所需的窄 `issues: write` 与 `actions: write`。两者都没有
  `statuses: write` 或 `checks: write`。

默认情况下，普通用户发出的 `@codex review` 只有在 author 当前拥有 `write`、
`maintain` 或 `admin` 权限时，才能建立新的 review generation。若仓库明确接受任意
commenter 的 request，可以把受保护 repository Actions variable 设置为
`CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION=any`；其他任何值都映射为更安全的
`write` policy。这是 wrapper-owned protected configuration，不是 public Action input。
它不会削弱 finding authority：任何合格 Codex finding 仍然阻塞。

Consumer workflows 没有 cron、`repository_dispatch`、`pull_request_target`、自动
`pull_request_review` writer、runtime GitHub App、status bridge 或 ledger。evidence
由所选 verifier 从 PR 重建。

合格的普通、无 marker `@codex review` request 上的 reactions 只作为 provider liveness
evidence 读取。普通 request 上的 `+1` 不能独立产生 head-bound clean evidence。若 official
Codex `eyes` reaction 或 progress artifact 与候选 terminal clean 同时或更晚，则说明 review
activity 仍然有效并 veto success。Reaction 变化本身不会启动 consumer job，因此需要等待
后续合格 bot comment 触发，或手动 dispatch exact-head `reconcile`。
在 predecessor-to-successor generation closure 中，与 successor request 同一时间戳的
liveness 也无法排序，必须保持 predecessor open。
一旦出现第二个物理 request boundary，unbound terminal 就无法证明自己属于新 request，
而不是旧 flight 的延迟结果。没有 base epoch 时，provider terminal evidence 只能闭合
第一个 gap；之后的每个 gap 和新 generation 的 clean authority，都必须来自直接附着在
对应 canonical request 上的合格 `+1`。有 base epoch 时，每个 gap 都必须如此。若旧 gap
已经无法在原始窗口内闭合，必须先区分 physical boundary 与 positive authority：edited、
malformed、wrong-author、denied 或 stale-base request 可以保留为 boundary，但没有
authority。只有每个歧义 predecessor 都显式绑定另一个 full head 时，新 head 才能恢复。
若存在 ordinary、deleted 或其他 unbound predecessor，应新建 replacement PR，只运行
一个 canonical producer；验证 replacement 后关闭旧歧义 PR。
显式 commit-bound progress 直接归入对应 head；所有 unbound progress 都保留在 current
inventory，因为邻近 request timestamp 不能证明来源。edited terminal 还会产生从创建到
terminal revision 的 unbound unknown-activity interval。provider terminal 只有在
predecessor reaction inventory 完整，且从该 terminal 到 successor 没有当前 `eyes` 或
provider activity 时，才能闭合第一个 gap。

先选择一个 GitHub user 作为 `CONTROL_PLANE_OWNER`；该账号必须对 consumer repository
拥有 `write`、`maintain` 或 `admin` 权限。Helper 默认使用 `@JoeyTeng`，所有非 Joey
仓库都必须显式换成自己的合格 owner。之所以需要这层独立控制面，是因为 required check
的 `integration_id: 15368` 只标识整个 GitHub Actions App，并不能标识任一 workflow；
exact-byte 与 complete-inventory checks、CODEOWNERS、Code Owner review、stale
dismissal、strict freshness、no bypass actors 与 canary collision readback 共同构成
adopted compound boundary。

手动 `workflow_dispatch` 接口是：

| Input | 含义 |
| --- | --- |
| `operation` | `begin-review` 或 `reconcile` |
| `pr_number` | 一个 open PR number |
| `expected_head_sha` | 本次 run 唯一允许评估的 exact PR head |
| `request_comment_id` | 可选的 evidence 定位 hint |
| `request_review` | `begin-review` 是否发 request，默认 `true` |

这些值只帮助 Action 定位与验证，不提供 verdict。Action step 的 underscore inputs 是
`github_token`、`pr_number`、`expected_head_sha`、`operation`、
`request_comment_id` 与 `request_review`。两份 Action steps 只从受保护 repository
variable `CODEX_REVIEW_GATE_LIMITS_PROFILE` 派生 `limits_profile`；公开 outputs 只有
`execution_health`、`gate_outcome`、`recovery_code` 与 `retry_safe`。Finding counts
只出现在 summary 与 sticky diagnostic，不是 outputs。

## Advanced：固定 11 仓组织 cohort 的受控 handoff

只有在一个已明确批准的 organization cohort 的 default branches 全部受同一条共享 v1
organization ruleset 保护时，才使用这个流程。它不是通用的 `allow-v1` 安装模式。下方
编号章节中的普通单仓流程，以及每个 cohort member 的最终状态，仍然拒绝所有 v1 caller。

Handoff 刻意把不同保护职责分开：

- 每个仓库都安装完整的 v2 repository ruleset，继续承担本文定义的 strict up-to-date、
  Code Owner、stale-review、resolved-conversation 与 non-fast-forward 要求；
- 新建名为 `Must Pass Codex Review v2` 的 organization ruleset，只对精确 11 个成员要求
  source-bound strict `codex/github-review-gate`；
- 旧 organization ruleset 在 installation、canary proof、v2 activation 与 repository-level
  v1 cleanup 全程保持 Active，同时保留 `deletion`、`non_fast_forward` 与唯一的
  `codex/review-gate` status rule；
- 旧 organization ruleset 永不删除。最终 cutover 只移除其中完整的 legacy-only
  required-status rule；其 identity、targets、enforcement、bypass actors、`deletion`、
  `non_fast_forward` 与其他所有绑定字段必须不变。

这笔 transaction 的 source of truth 是一份经过审阅、schema 为
`organization-review-gate-handoff-manifest/v1` 的 JSON manifest。它绑定 organization
identity、旧 organization ruleset 的 exact snapshot、新 ruleset 的 name 与 ID、精确且有序
的 11 个 repository identities、三份 workflow 的 blob/content hashes、effective
CODEOWNERS identity、每个完整 Active repository v2 ruleset，以及每个 repository-level
legacy cleanup 的 before/after snapshots。每个 canary entry 把 open、non-draft、
same-repository PR 绑定到 exact current head/base/test-merge SHAs、v2 CheckRun 及其 workflow
run/attempt/job identities，以及最新 successful legacy commit-status ID。成员缺失、额外或
顺序变化都会 hard fail。

从
`templates/organization-review-gate-handoff/joey-tools-11-member-manifest.template.json`
开始，并遵循同目录 README。每一个显式 placeholder 都必须替换为 live、reviewed
evidence；不得推测缺失 identity。`stage` 之前唯一允许的不完整值，是
`v2_ruleset.id` 的 JSON literal `null`，因为该 organization ruleset 此时尚不存在。其他
placeholder 或不完整值都会被拒绝。`stage` readback 成功后，只能用返回的 organization
ruleset ID 替换这个 `null`，并重新 review 完整 manifest。

每个成员的 migration PR 安装 canonical v2 verifier/controller，以及固定路径
`.github/workflows/codex-review-gate-legacy-bridge.yml` 下唯一允许的 temporary bridge：

```bash
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --prepare-worktree "$TARGET_ROOT" \
  --legacy-bridge \
  --control-plane-owner "$CONTROL_PLANE_OWNER"
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --prepare-worktree "$TARGET_ROOT" \
  --legacy-bridge \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --apply
```

`--legacy-bridge` 只接受这个固定路径和 canonical exact bytes，不允许任意 v1 workflow。
Bridge 存在期间，每条 repository bootstrap staging 与 activation command 都必须保留该
flag。Cohort 的 repository ruleset name 精确为
`Must Pass Codex Review v2`，不是普通 installer 默认的 `Must Pass Codex Review`；每个
repository bootstrap call 都必须用 `--ruleset-name` 传入这个 distinct name。

Bridge 的可写 event envelope 是封闭的：只有 `pull_request_target` 的 `opened`、`reopened`、
`synchronize`、`ready_for_review`，以及 `issue_comment` 的 `created`。它刻意排除
`pull_request_review`：GitHub 会将该 workflow 绑定到 PR merge ref，而兼容 publisher 的
`issues: write` authority 不能安全地在该 ref 执行。不得在 consumer repository 局部加回
review trigger。temporary bridge 仍只是 compatibility status publisher；v2 manual reconcile
不能刷新它的 v1 status。dual protection 仍生效时所需的 exact-run recovery 见第 3 节。

普通指南只能沿用于 canonical files preparation、control-plane review，以及把完整
repository v2 policy 暂存为 **Disabled**；不得沿用其中的 legacy cleanup 或 canary-close
步骤。Migration 合并后，用 `--legacy-bridge` 暂存 distinct Disabled repository rule；再
创建无害 open、non-draft canary，证明 exact-head/test-merge v2 CheckRun 与最新 successful
`codex/review-gate` bridge commit status，并用同一 distinct name/bridge profile activate
repository rule。Shared organization rule 完成 activation 且 dual-enforcement readback 成功
之前，canary 必须保持 open。把 current bound evidence 写入 manifest；11 个 entries 全部
满足条件前不得开始 organization activation。

Organization helper 总是 preview-first；每个有写入的 apply 都必须使用对应 live preview
输出的 exact `plan_sha256`。因为失败的 stage POST 可能需要 no-receipt recovery，从 stage
preview 开始就必须建立外部 organization-admin policy-mutation freeze，并保持到 apply、
readback 与任何 recovery 全部完成：

```bash
HANDOFF_MANIFEST=/absolute/path/to/reviewed-handoff-manifest.json

node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode plan

HANDOFF_STAGE_PREVIEW="$(mktemp)"
node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode stage > "$HANDOFF_STAGE_PREVIEW"
HANDOFF_STAGE_PLAN_SHA256="$(jq -er \
  '.plan_sha256 | select(test("^[0-9a-f]{64}$"))' \
  "$HANDOFF_STAGE_PREVIEW")"
node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode stage \
  --apply \
  --expected-plan-sha256 "$HANDOFF_STAGE_PLAN_SHA256"
```

`stage` 只创建 exact Disabled、v2-only organization ruleset。把返回的
`next_manifest_update.v2_ruleset.id` 绑定进经审阅的 manifest，然后重新运行 `plan`。当
11 个 open、non-draft、current-base canaries、canonical workflows、temporary bridges、
Active repository v2 rulesets 与仍未 cleanup 的 legacy surfaces 都精确匹配 manifest
后，再 preview 并启用共享 ruleset：

如果 `stage --apply` 的 POST 可能已经到达 GitHub 后失败，helper 会先尝试一次只读
reconcile；返回 `applied-recovered` 与 `next_manifest_update` 就是已验证成功。如果进程被
中断或仍报告 unknown outcome，则不得重跑 POST。保持 `v2_ruleset.id` 为 `null`，使用显式
只读恢复入口：

```bash
node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode stage \
  --recover-created-v2
```

该选项不能与 `--apply` 或 plan digest 一起使用。只有精确存在一个同名 organization
ruleset、其内容等于 canonical Disabled v2 payload，且旧 organization rule 仍处于 exact
before-state 时，它才返回 `next_manifest_update`。Candidate 不存在、存在多个、已经 Active，
或 source/payload 有任何 drift 都会 fail closed；恢复过程绝不重发 POST。完整 recovery read
期间必须保持外部 organization-admin policy-mutation freeze，避免被收养的唯一对象在该边界
内变化。

```bash
HANDOFF_ACTIVATE_PREVIEW="$(mktemp)"
node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode activate > "$HANDOFF_ACTIVATE_PREVIEW"
HANDOFF_ACTIVATE_PLAN_SHA256="$(jq -er \
  '.plan_sha256 | select(test("^[0-9a-f]{64}$"))' \
  "$HANDOFF_ACTIVATE_PREVIEW")"
node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode activate \
  --apply \
  --expected-plan-sha256 "$HANDOFF_ACTIVATE_PLAN_SHA256"
```

运行对应 activation preview 前，建立外部 organization/repository admin policy-mutation
freeze，并保持到 apply 与 stable post-write readback 全部完成。该区间内任何管理员都不得
修改 organization/repository rulesets、classic branch protection、conditions、required
checks 或 bypass actors。GitHub ruleset update endpoint 没有 documented conditional/CAS；
digest 与紧邻读回能发现更早或更晚的 drift，却无法让最后一次 GET→PUT 区间具有原子性。
Helper 验证 manifest 绑定的 exact bypass lists，但不能自动发现或保留 snapshot 外并发加入
的 actor。

Activation readback 成功时才到达双重保护 handoff point：11 个成员都具备完整 repository
v2 policy，共享 v2-only organization rule 已 Active，而旧 organization v1 rule 仍 Active。
只有 helper 完成该 post-write dual-enforcement proof 后，才可关闭且不合并每个 canary；
`activate` 完成前绝不可关闭。之后的 `derive-cutover`、`apply-repository-cleanup` 与 `verify`
使用 post-activation cohort snapshots，不要求重新打开已关闭的 canary，也不要求当前
default-branch head 继续等于历史 canary base。Canary receipt 只证明 activation boundary；
activation 后 helper 改为读取每个 repository 的实时 default branch，并验证当前
control-plane/ruleset closure：exact repository identity、完整 regular-blob workflow
inventory（仅有三份 canonical files，没有额外 producer）、exact CODEOWNERS、default-read
Actions policy（包含明确 boolean `can_approve_pull_request_reviews`）、Active repository 与
organization v2 rules、temporary bridge，以及当前 cleanup state。

接着只读推导 repository-level cleanup：

```bash
HANDOFF_CUTOVER_PLAN="$(mktemp)"
node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode derive-cutover > "$HANDOFF_CUTOVER_PLAN"
jq . "$HANDOFF_CUTOVER_PLAN"
```

审阅输出中的 `external_repository_actions`：每项只能移除 `codex/review-gate`，manifest
绑定的 non-legacy checks、strictness、repository ruleset identity、conditions、bypass
actors、`deletion`、`non_fast_forward` 与 unrelated rules 必须全部保留。不得手工执行 raw
actions。从这次 cleanup preview 开始建立外部 organization/repository admin
policy-and-target-identity freeze，并连续保持到 cleanup apply/readback、之后的 `verify`
preview/apply，以及最终 stable readback 全部完成；通过受控 executor 执行：

```bash
HANDOFF_CLEANUP_PREVIEW="$(mktemp)"
node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode apply-repository-cleanup > "$HANDOFF_CLEANUP_PREVIEW"
HANDOFF_CLEANUP_PLAN_SHA256="$(jq -er \
  '.plan_sha256 | select(test("^[0-9a-f]{64}$"))' \
  "$HANDOFF_CLEANUP_PREVIEW")"
node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode apply-repository-cleanup \
  --apply \
  --expected-plan-sha256 "$HANDOFF_CLEANUP_PLAN_SHA256"
```

这是运营冻结，不是持续的 repository 或 API 锁。除上述 policy fields 外，从本次 cleanup
preview 到最终只读 `verify` 完成，operator 还必须禁止任何 cohort repository 被 rename、
transfer、delete、改变 default branch，或在原 slug 被 replace/re-create。GitHub cleanup
mutation API 不提供 repository-ID conditional/CAS write；这段 freeze 覆盖最后一次
repository metadata read 到 write 之间的区间。

每次 cleanup surface read（包括 initial classification、正常 readback 与 error
reconciliation）前，executor 都会读取 GitHub repository metadata，并要求 manifest-bound
`full_name`、`id`、`node_id` 与 `default_branch` 精确相等。若该项仍需写入，它会在紧邻
mutation 前再次执行相同的 identity check，再围绕 surface-specific write 要求 exact
`expected_before` 与 `expected_after` policy snapshots。`id`/`node_id` 绑定 repository
object，`full_name` 绑定 expected route 并暴露 rename、transfer 或 slug reuse，
`default_branch` 绑定 branch selector；snapshots 保护选定的 policy content。无关 metadata
churn 不视为这两类属性发生变化。Identity 无法读取或 mismatch 时，batch 会在观测点立即
停止：pre-mutation mismatch 不会写当前 action，之后也不再执行任何 mutation。稳定的
before/after mixed state 是安全续跑点：已经 after 的项目是 no-op，只有仍为 before 的项目
进入新 plan。如果 mutation 返回 error 或结果 unknown，executor 会先进行 narrow read-only
reconcile；exact after 表示已完成，before、drift 或无法读取则停止整个 batch。随后在 freeze
下生成新 preview、review live state；绝不盲目重放旧 mutation 或旧 plan digest。

只有全部 repository cleanup surfaces 都匹配各自 exact `expected_after` snapshots，才可
移除旧 organization status rule：

```bash
HANDOFF_VERIFY_PREVIEW="$(mktemp)"
node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode verify > "$HANDOFF_VERIFY_PREVIEW"
HANDOFF_VERIFY_PLAN_SHA256="$(jq -er \
  '.plan_sha256 | select(test("^[0-9a-f]{64}$"))' \
  "$HANDOFF_VERIFY_PREVIEW")"
node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode verify \
  --apply \
  --expected-plan-sha256 "$HANDOFF_VERIFY_PLAN_SHA256"
HANDOFF_FINAL_VERIFY=/absolute/path/to/final-read-only-verify.json
node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode verify > "$HANDOFF_FINAL_VERIFY"
jq -e '
  .schema_version == "organization-review-gate-handoff-output/v1" and
  .mode == "verify" and
  .status == "final-verified" and
  .applied == false and
  .action == null and
  .final_closure_receipt.schema_version == 1 and
  (.final_closure_receipt_sha256 | test("^[0-9a-f]{64}$"))
' "$HANDOFF_FINAL_VERIFY"
HANDOFF_FINAL_CLOSURE_RECEIPT_SHA256="$(jq -er \
  '.final_closure_receipt_sha256 | select(test("^[0-9a-f]{64}$"))' \
  "$HANDOFF_FINAL_VERIFY")"
```

`verify --apply` 是唯一会修改旧 organization ruleset 的 helper mode。它移除完整的
legacy-only required-status rule，而不是删除旧 ruleset。它返回的
`applied-final-verified` 不能作为 bridge removal 的 authorization：在这次 write/readback
boundary 之后，organization 或 repository control plane 仍可能发生 drift。Repository
cleanup 前开始的外部 policy-mutation freeze 必须连续保持到另一次最终只读 `verify` 完成
stable two-snapshot readback，并验证保存的输出。该只读结果顶层必须是
`schema_version: "organization-review-gate-handoff-output/v1"`、`mode: "verify"`、
`status: "final-verified"`、`applied: false`、`action: null`；同时包含
schema version 1 的 `final_closure_receipt`，绑定 organization、reviewed manifest digest、
final snapshot digest、legacy/v2 ruleset IDs/states 与按 canonical UTF-8 byte `full_name` order 排列的
固定、完整 11 仓 cohort；它不接受任意子集或扩大的 cohort。其 top-level `plan_sha256` 必须精确绑定最终只读
`verify` plan（`mode`、manifest digest、snapshot digest 与 `action: null`）；
`final_closure_receipt_sha256` 绑定 canonical embedded receipt。必须完整保留 `HANDOFF_FINAL_VERIFY`
中的 **整份 verify JSON 输出**，不能只保存嵌套 receipt。

这第三段 freeze 可以在完整输出被捕获且验证后结束。如果只读 verify inconclusive、任何
bound policy 不一致，或 capture 后到准备 bridge removal 之前发生了已知 organization/
repository policy mutation，则保留所有 bridges，修复 drift，并在新的 freeze 下重新生成
最终只读 verify 输出；绝不能用 `verify --apply` response 或旧 receipt 代替。

每个 authoritative success boundary 先读取一份完整 snapshot，等待 5 秒后再读
一份。若 selected evidence 或 policy 不一致，就重新开始这一对读取；60 秒内始终得不到
相同的一对时结论为 inconclusive，不允许下一次 write。

Closure 完成后，每个成员另开一个 PR，移除 canonical bridge：

```bash
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --prepare-worktree "$TARGET_ROOT" \
  --remove-legacy-bridge \
  --final-closure-receipt "$HANDOFF_FINAL_VERIFY" \
  --expected-final-closure-receipt-sha256 \
  "$HANDOFF_FINAL_CLOSURE_RECEIPT_SHA256" \
  --control-plane-owner "$CONTROL_PLANE_OWNER"
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --prepare-worktree "$TARGET_ROOT" \
  --remove-legacy-bridge \
  --final-closure-receipt "$HANDOFF_FINAL_VERIFY" \
  --expected-final-closure-receipt-sha256 \
  "$HANDOFF_FINAL_CLOSURE_RECEIPT_SHA256" \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --apply
```

尽管参数名是 `--final-closure-receipt`，它接收的是完整的最终只读 verify JSON 文件。
Bootstrap 会验证 terminal top-level fields、重新计算 canonical embedded receipt digest、比对
显式 expected SHA-256、解析 worktree 中无歧义的 GitHub `origin`，并从 GitHub 读取当前
repository metadata。它要求 `full_name`、`id`、`node_id` 与 `default_branch` 都与固定 11 仓
receipt cohort 中的一项精确相等。在 atomic bridge quarantine rename 前的边界，它会先在
live-metadata query 前后各读取一次 `origin`，重新验证本地对象后，再紧邻 rename 读取一次
`origin`。Rename 后、unlink 前，它会再次执行完整的 `origin` -> live metadata
identity/default-branch -> `origin` 检查，并重新验证 quarantine 中 admitted file 的 object
identity 与 canonical content。若该 remote binding recheck 失败，它会通过 no-clobber
hard-link creation 尝试把同一 admitted bridge 恢复到 canonical path；若目标路径已被占用或
恢复后的验证失败，则 fail closed、绝不覆盖占用者，也不报告删除成功。因此，已观测到的
同名重建、repository transfer、default-branch drift、metadata 不可读或其他 mismatch 都不能
授权 unlink；其他 cohort 或 repository 的 receipt 也无法授权删除。这些是 point-in-time 的
remote binding 与 local identity/content checks，并非连续锁。
不得编辑 receipt 或 retarget `origin` 来绕过这份 proof。

Bridge 已经 absent 时，bridge-removal component 是 idempotent no-op；已有但
non-canonical 的 bridge 则会被拒绝，不会删除未知文件。整个 command 同时也是 canonical
local installer：即使没有 bridge 可移除，使用 `--apply` 时仍会修复 drifted verifier/
controller bytes 或 managed CODEOWNERS block。执行前必须从 clean worktree 开始，并先验证
这三个 surfaces；若 dry run 提出 bridge removal 之外的变更，必须停止并单独处理或 review
drift，不能把该 PR 描述为 bridge-only。这些 PR 合并后，重新运行不带
`--legacy-bridge` 的普通 validation；每个仓库都必须满足最终 no-v1 contract。

## 1. 创建并合并 migration PR

修改 consumer worktree 前，先做只读 preflight：

```bash
REPO=OWNER/REPO
DEFAULT_BRANCH="$(gh api --hostname github.com \
  "repos/$REPO" \
  --jq '.default_branch')"
DEFAULT_WORKFLOW_PERMISSIONS="$(gh api --hostname github.com \
  "repos/$REPO/actions/permissions/workflow" \
  --jq '.default_workflow_permissions')"
test -n "$DEFAULT_BRANCH"
test "$DEFAULT_WORKFLOW_PERMISSIONS" = read
```

permissions 读取缺失、失败或不是 `read` 时必须停止。修改该 repository setting 不属于
本次安装的隐含授权；应另行取得授权，把 default workflow permissions 设为 read-only，
读回 endpoint 后再重复 preflight。

把 `Joey-Tools/codex-review-gate` 的干净 checkout 记为 `SOURCE_ROOT`，consumer 的
干净 worktree 记为 `TARGET_ROOT`：

```bash
CONTROL_PLANE_OWNER=@JoeyTeng
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --prepare-worktree "$TARGET_ROOT" \
  --control-plane-owner "$CONTROL_PLANE_OWNER"
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --prepare-worktree "$TARGET_ROOT" \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --apply
```

Helper 会在显式 checkpoint 重新验证 workflow parent 的 object identity 与 access
policy。但这不是 operation-bound filesystem sandbox：恶意 same-UID process 仍可能在
checkpoint 之间 race path-based operation。只在这些 parent 不会被不可信进程并发修改时
运行；遇到 safety failure 不得改用手工复制绕过。

第一条命令预览，第二条逐字复制两份 canonical workflows，并在保留其他 entries 的同时把受管
control-plane block 合并到 `.github/CODEOWNERS` 的最终有效位置。若 helper 报告其他 v1
caller，只检查它列出的路径，并在同一个 migration PR 中移除或停用精确 legacy job。
一个 PR 可以同时移除 v1、安装 v2 与 CODEOWNERS 控制面。

如果仓库当前使用根目录 `CODEOWNERS` 或 `docs/CODEOWNERS`，helper 会停止，避免新建
`.github/CODEOWNERS` 后静默遮蔽旧 policy。请在同一个 migration PR 中把原有 entries
完整移动或合并到 `.github/CODEOWNERS`，再重跑 helper。

审核 consumer diff、运行该仓库自己的验证，但在准备好下述 canonical inventory snapshot
之前不要请求 approval。随后取得 `CONTROL_PLANE_OWNER` 对这个 PR 的独立批准后再合并。
第一次批准是 manual trust-bootstrap gate：PR 使用 base branch 的
CODEOWNERS，而新规则此时还没有进入 base，ruleset 也未启用。合并立即前必须确认 owner
不是 PR author、owner 最新 review 是绑定 current full head SHA 的 `APPROVED`，并在读取
后再次确认 head 未变。以后修改 workflow 或 CODEOWNERS 的 PR 会由 GitHub 强制同一
owner 批准最终 head；push 新 commit 会让旧批准失效。V2 workflow 尚未进入默认分支时，
不要启用 required check。

这个 migration PR 是 manual trust bootstrap，不是它自己的 v2 canary。它合入后，任何在
安装前已经打开的 PR 都必须先为 current head/base/test-merge scope 建立 fresh verifier，v2
才能成为 required：push 新 head、reopen，或使用文档中的 draft-to-ready transition。controller
`reconcile` 可以 rerun 已存在的 exact verifier，但刻意不能从任意 pre-installation PR 创建它。

使用 tracked executable
`$SOURCE_ROOT/scripts/build-legacy-review-gate-inventory.sh`。它精确接收 repository、
expected default branch 和 output path 三个参数，并负责 fail-fast schema validation、
canonical sorting、cleanup 与 digest output。Pre-approval 与 final transaction 必须调用这
同一个 reviewed executable，不得从文档重建实现。请求 owner approval 前执行 helper，并把
canonical JSON 与打印的 SHA-256 一并记录进 approval snapshot：

```bash
APPROVAL_INVENTORY_DIR="$(mktemp -d)"
APPROVAL_INVENTORY="$APPROVAL_INVENTORY_DIR/legacy-inventory.json"
LEGACY_INVENTORY_SHA256="$("$SOURCE_ROOT/scripts/build-legacy-review-gate-inventory.sh" \
  "$REPO" "$DEFAULT_BRANCH" "$APPROVAL_INVENTORY")"
LEGACY_INVENTORY_SHA256="${LEGACY_INVENTORY_SHA256#LEGACY_INVENTORY_SHA256=}"
printf 'LEGACY_INVENTORY_SHA256=%s\n' "$LEGACY_INVENTORY_SHA256"
```

该 inventory 绑定 exact repository slug、numeric repository ID、opaque node ID 与
default branch；每个 matching active/inherited ruleset 的
ID、name、source、enforcement、target、conditions、完整 `bypass_actors` 与完整 `rules`；
包含全部 parameters 的完整 matching effective `required_status_checks` rule；以及 classic
parent 的完整 required-status object（包括 `strict` 与每个 check 的 producer `app_id`）或
显式 `null`。Shell helper 与 runtime 使用同一 Node canonicalizer，因此 approval 与
enforcement 会 hash 完全相同的 bytes。Hash 前会排序语义无序的 bypass actors、required checks、classic
contexts/checks 与 conditions `include`/`exclude` sets。即使仓库没有 legacy requirement，
canonical empty inventory 仍绑定 repository 与 default branch，因此也会得到 digest。API
response 或 schema 不完整属于 inconclusive；任何 digest drift 都 fail closed，不能视为
legacy absent。HTTP success 的空 body 或 JSON `null` 也属于 inconclusive；只有明确识别的
absence response 才会 canonicalize 为 `null`。

保留 exact-head read 得到的 `MIGRATION_HEAD` 与 owner-approved snapshot，并让全部 legacy
requirements 保持 active 直到 merge。把已记录 digest 从外部传为
`LEGACY_INVENTORY_SHA256`；transaction 不提供默认值。下方每次远端 staging/activation 的
preview 与 apply 都必须复用同一个跨进程 baseline，从 Disabled stage、canary、activation
write 一直贯穿 exact Active readback；新 helper process 不会建立新 baseline。

最终 gate 与 merge 必须处在同一个 fail-fast transaction 中。唯一 mutation 前，它会刷新
legacy inventory、default branch、PR base/head/state、authenticated actor 与完整 owner-review
inventory。使用一个 repository-approved merge method：

```bash
(
  set -euo pipefail

  MIGRATION_PR=PR_NUMBER
  MIGRATION_HEAD=FULL_HEAD_SHA_FROM_APPROVAL_SNAPSHOT
  MERGE_METHOD=REPOSITORY_APPROVED_METHOD
  CONTROL_PLANE_LOGIN="${CONTROL_PLANE_OWNER#@}"
  case "$MERGE_METHOD" in
    merge|squash|rebase) ;;
    *) printf 'unsupported or unset repository merge method\n' >&2; exit 1 ;;
  esac
  TXN_DIR="$(mktemp -d)"
  PR_STATE="$TXN_DIR/pr.json"
  FINAL_REVIEW_PAGES="$TXN_DIR/reviews.json"
  MERGE_BODY="$TXN_DIR/merge-body.json"
  MERGE_RESPONSE="$TXN_DIR/merge-response.json"
  POST_MERGE_STATE="$TXN_DIR/post-merge.json"
  LEGACY_INVENTORY="$TXN_DIR/legacy-inventory.json"
  cleanup() {
    rm -f "$PR_STATE" "$FINAL_REVIEW_PAGES" "$MERGE_BODY" \
      "$MERGE_RESPONSE" "$POST_MERGE_STATE" "$LEGACY_INVENTORY"
    rmdir "$TXN_DIR" 2>/dev/null || true
  }
  trap cleanup EXIT
  trap 'exit 130' HUP INT TERM

  DEFAULT_BRANCH_FRESH="$(gh api --hostname github.com \
    "repos/$REPO" --jq '.default_branch')"
  test "$DEFAULT_BRANCH_FRESH" = "$DEFAULT_BRANCH"
  "$SOURCE_ROOT/scripts/build-legacy-review-gate-inventory.sh" \
    "$REPO" "$DEFAULT_BRANCH_FRESH" "$LEGACY_INVENTORY" > /dev/null
  FRESH_LEGACY_INVENTORY_SHA256="$(node -e '
    const crypto=require("node:crypto"); const fs=require("node:fs");
    process.stdout.write(crypto.createHash("sha256")
      .update(fs.readFileSync(process.argv[1])).digest("hex"));' "$LEGACY_INVENTORY")"
  test "$FRESH_LEGACY_INVENTORY_SHA256" = \
    "${LEGACY_INVENTORY_SHA256:?external approval-snapshot digest is required}"

  gh pr view "$MIGRATION_PR" --repo "github.com/$REPO" \
    --json author,baseRefName,headRefOid,state,isDraft > "$PR_STATE"
  jq -e --arg base "$DEFAULT_BRANCH_FRESH" --arg head "$MIGRATION_HEAD" \
    --arg owner "$CONTROL_PLANE_LOGIN" \
    '.baseRefName == $base and .headRefOid == $head and .state == "OPEN" and (.isDraft | not)
     and (((.author.login // "") | ascii_downcase) != ($owner | ascii_downcase))' \
    "$PR_STATE"
  CURRENT_ACTOR="$(gh api --hostname github.com user --jq '.login')"
  jq -ne --arg actor "$CURRENT_ACTOR" --arg owner "$CONTROL_PLANE_LOGIN" \
    '($actor | ascii_downcase) == ($owner | ascii_downcase)'
  gh api --hostname github.com --paginate --slurp \
    "repos/$REPO/pulls/$MIGRATION_PR/reviews?per_page=100" \
    > "$FINAL_REVIEW_PAGES"
  jq -e --arg owner "$CONTROL_PLANE_LOGIN" --arg head "$MIGRATION_HEAD" \
    '[.[][] | select((((.user.login? // "") | ascii_downcase) == ($owner | ascii_downcase)) and .user.type == "User")]
     | sort_by([.submitted_at, .id]) | last
     | .state == "APPROVED" and ((.commit_id | ascii_downcase) == ($head | ascii_downcase))' \
    "$FINAL_REVIEW_PAGES"

  jq -n --arg sha "$MIGRATION_HEAD" --arg method "$MERGE_METHOD" \
    '{sha:$sha, merge_method:$method}' > "$MERGE_BODY"
  gh api --hostname github.com --method PUT \
    "repos/$REPO/pulls/$MIGRATION_PR/merge" \
    --input "$MERGE_BODY" > "$MERGE_RESPONSE"
  jq -e '.merged == true' "$MERGE_RESPONSE"
  test "$(gh api --hostname github.com "repos/$REPO" --jq '.default_branch')" = \
    "$DEFAULT_BRANCH_FRESH"
  gh pr view "$MIGRATION_PR" --repo "github.com/$REPO" \
    --json baseRefName,headRefOid,state,mergedAt > "$POST_MERGE_STATE"
  jq -e --arg base "$DEFAULT_BRANCH_FRESH" --arg head "$MIGRATION_HEAD" \
    '.state == "MERGED" and .mergedAt != null and .baseRefName == $base
     and ((.headRefOid | ascii_downcase) == ($head | ascii_downcase))' \
    "$POST_MERGE_STATE"
)
```

所有 precondition command 都位于 synchronous merge mutation 前；API、`jq`、`test`、
pagination、parse、actor、base、head、state 或 review 任一失败都会退出，trap 会清理全部
temporary files。REST endpoint 只能即时 merge 或失败（包括 405/409），不会把 PR 入队。
不得使用 `gh pr merge`、auto-merge、merge queue 或 admin bypass。GitHub 仍没有同时覆盖
review state 与 head 的 atomic compare-and-swap，所以 actor 硬校验要求 trusted owner 在
fresh review readback 后立即执行 direct merge；只重读 head 不足以闭环。

Merge 后立即重读 current default、exact base/head 与 merged lifecycle 全部成功后，仍须让
inventory 中全部 legacy requirements 保持 active。另建一个 Disabled v2 ruleset，在 legacy
gate 继续阻塞 merge 的状态下运行 canary，再 activate v2 并精确读回完整 Active policy。只有
这个 Active readback 成功后，才可按另行授权的 cleanup 删除 legacy，并读回 ruleset 与
classic 两个 surfaces。短暂双重要求是预期状态；任何“两边都不要求”的窗口都不允许。

合并后读回 PR，确认确已 merged；刷新默认分支的干净 checkout，再次逐字节比较已安装
workflow 与 canonical template，并读回最终有效的 CODEOWNERS block 与显式 owner。

## 2. 以 Disabled 状态暂存 ruleset

Migration 已在默认分支后，预览并执行远端 staging：

```bash
V2_RULESET_NAME="Must Pass Codex Review"
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --expected-legacy-inventory-sha256 \
  "${LEGACY_INVENTORY_SHA256}"
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --expected-legacy-inventory-sha256 \
  "${LEGACY_INVENTORY_SHA256}" \
  --apply
```

也可以通过 **Settings -> Rules -> Rulesets -> New ruleset -> Import a ruleset** 导入
`templates/codex-gated-repo/rulesets/codex-review-gate.json`。

继续前确认 ruleset：

- 保持 **Disabled**；新建 ruleset 只覆盖 default branch。若 existing 同名 ruleset 已有
  更广 targets，helper 会原样保留其 include/exclude conditions；必须核对并确认每一个额外
  target 都符合预期；
- 要求 expected source **GitHub Actions**（`integration_id: 15368`）发布的
  `codex/github-review-gate`，不接受 “Any source”；
- 要求 branch up to date；
- 要求 Code Owner review，push 后 dismiss stale approvals；新 ruleset 的普通 approving
  review count 为 0，helper 会保留既有更高 count；
- 要求所有 review conversations resolved；
- 阻止 default branch 的 non-fast-forward update；
- `bypass_actors` 明确为空。

每次 preview 与 apply 都会用同一个 owner-approved digest 比较完整 canonical dual-surface
inventory。Repository、default branch、ruleset policy 或 classic producer binding 的任何
漂移，以及 API/schema 不完整，都属于 inconclusive 并 fail closed。

Helper 会同时在 effective repository rulesets 与 classic branch protection required
status contexts 中检查 legacy `codex/review-gate`。Disabled staging、canary、activation 与
exact Active readback 全程都必须保留这些 active legacy requirements。Helper 允许这个
fail-closed overlap，且绝不修改 classic protection 或 separately managed legacy ruleset。
若 active legacy/incomplete ruleset 已占用选定的 v2 ruleset name，helper 会在任何 write 前
拒绝；请在 staging 前把 `V2_RULESET_NAME` 改成 distinct name，并在 staging、activation 与
final probe 中始终传同一变量。Legacy inventory 无法读取或 schema malformed，或任何变化
使完整 canonical inventory 不再匹配 owner-approved digest 时，都属于 inconclusive，不能
当作 absent。本阶段不得删除任何 legacy requirement。

## 3. 创建并运行独立 canary PR

从已合并的默认分支创建临时分支，做一个无害且可 review 的变更，开 non-draft PR，并记录
PR number 与完整 current head SHA。还要绑定稍后唯一允许删除的 same-repository head
ref；canary 跑完后不得只根据 branch name 重新推断：

```bash
CANARY_HEAD="$(gh api --hostname github.com \
  "repos/$REPO/pulls/$CANARY_PR" --jq '.head.sha')"
CANARY_HEAD_REPO="$(gh api --hostname github.com \
  "repos/$REPO/pulls/$CANARY_PR" --jq '.head.repo.full_name')"
CANARY_HEAD_REF="$(gh api --hostname github.com \
  "repos/$REPO/pulls/$CANARY_PR" --jq '.head.ref')"
test "${#CANARY_HEAD}" -eq 40
test "$CANARY_HEAD_REPO" = "$REPO"
test -n "$CANARY_HEAD_REF"
```

通常直接在 PR 发：

```text
@codex review
```

GitHub 可能把这条单行 direct request 保存为末尾恰好一个 LF 或 CRLF；这两种存储
形式与精确的 `@codex review` 等价。不得接受或发送其他空白、可见文字或 hidden comment。
这条路径不会为了创建 request 消耗 Actions minutes。后续满足条件的 Codex bot
`issue_comment` `created` 或 `edited` event 会启动 controller，由它建立严格更新的 full
verifier attempt；若结果只出现在 review 或 reaction，或者需要恢复，再手动 reconcile。

### Dual-protection legacy-status recovery

手动 v2 `reconcile` 只刷新 `codex/github-review-gate`，绝不会写
`codex/review-gate`。两个 context 仍同时 required 时，只由 review 或 reaction 承载的结果可能需要单独
恢复 v1。先重新读取 PR，并绑定其 number、current `CANARY_HEAD`、base repository 与 default branch。在
Actions 中只选择当前 `Codex Review Gate Legacy Bridge` workflow 的一个既有 run。它的 REST object
必须同时满足：`event` 等于 `pull_request_target`、解析后的 workflow path 为
`.github/workflows/codex-review-gate-legacy-bridge.yml`（可选 GitHub `@ref` suffix 不属于 path）、
`head_sha` 等于 `CANARY_HEAD`，以及恰好一个 `pull_requests` entry 指向该 PR，且其中 head
repository 与 SHA 都等于已绑定值。记录它的 `id` 与正数 `run_attempt`；任何 ambiguity 都是 stop
condition。

只 rerun 这个 exact 已有 bridge run，不得改用其他 v1 workflow：

```bash
gh api --hostname github.com \
  --method POST \
  "repos/$REPO/actions/runs/$LEGACY_RUN_ID/rerun"
```

GitHub rerun 会保留原 run 的 `GITHUB_SHA` 与 `GITHUB_REF`；这正是所选 run 必须已经绑定该 exact
PR head 的原因。POST 后重读 PR 与 run，要求 run identity/scope 不变、`run_attempt` 恰好为
`LEGACY_RUN_ATTEMPT + 1`、terminal 为 `success`，并要求 complete status inventory 中最新 eligible
`codex/review-gate` status 在仍为 current 的 `CANARY_HEAD` 上是 `success`。timeout、attempt 未变、
attempt 跳跃、PR/head 改变或 candidate 不唯一均为 inconclusive：不得再次提交 POST。

若没有 eligible bridge run（包括超出 GitHub rerun window），将 PR 转成 draft 后再标记 ready，
以创建新的 `pull_request_target` lifecycle run。重新绑定 PR scope 后从本选择步骤开始。不得为了
恢复 v1 加入 `workflow_dispatch`、review event、cron 或新的 status writer。

GitHub 把 verifier run/job/CheckRun 记录在 exact PR feature-head SHA 上，而不是
test-merge SHA 上。canonical `pull_request` verifier 仍在 `refs/pull/N/merge` 上执行；Action
内部严格检查 `GITHUB_REF`、`GITHUB_SHA`、event PR head/base 范围，以及其 test-merge 与
runtime SHA 相同的 fresh PR read。受保护的 top-level `run-name` 还让 GitHub 把 exact
`codex-review-gate-verifier/<PR>/<current test-merge SHA>` 暴露为 `display_title`；run
唯一的 PR binding 必须携带 current feature head 与 default-branch base SHA。因此
successful feature-head CheckRun 会在执行语义上绑定 exact current test-merge。为了避免 idle PR 消耗
minutes，没有 cron 或可写 review event。verifier 在 `opened`、`reopened`、
`synchronize` 与 `ready_for_review` 上启动；controller 与 verifier 使用独立 per-PR
concurrency namespace。若要对同一 head deliberate re-review，先运行 `begin-review`，
读回新 request 并观察严格更新的 verifier attempt。单独发 comment 不会 atomically
invalidate 旧 success。

事件校验仅限 PR head/base 的 SHA、ref 与 repository；其 `merge_commit_sha` 可以缺失或来自
历史快照，明确不作为 binding input。

若 base retarget 后 current exact head/base/test-merge scope 没有 verifier，遵循
`create_verifier_run`：ready PR 先转为 draft 再 mark ready；already-draft PR 直接 mark
ready。确认 current exact head/base/test-merge scope 出现新的 `ready_for_review` verifier 后再
reconcile。rerun 旧 verifier 不是有效 retarget recovery。

base retarget 或检测到 base force-push epoch 后，必须使用
`request_review=true` 的 `begin-review`；等 Codex 在该 canonical request 上直接留下
合格 `+1` 后再 reconcile。GitHub terminal clean payload 不会标明产生它的 request/base
snapshot，因此在这个 recovery mode 中，单独的 later terminal clean 会有意保持
pending。finding 仍会立即阻塞。

需要协调 fresh request 与更新 verifier attempt 时，使用默认 `request_review=true` 的
`begin-review`：

```bash
gh workflow run codex-review-gate-controller.yml \
  --repo "github.com/$REPO" \
  -f operation=begin-review \
  -f pr_number=PR_NUMBER \
  -f expected_head_sha=FULL_HEAD_SHA \
  -f request_review=true
```

不要增加 feature ref。省略 ref 才会选择默认分支 workflow。Dispatch 后读取新 run：

```bash
gh run list \
  --repo "github.com/$REPO" \
  --workflow codex-review-gate-controller.yml \
  --event workflow_dispatch \
  --limit 10 \
  --json databaseId,event,headBranch,headSha,status,conclusion,url
```

要求 `event=workflow_dispatch`，且 `headBranch` 等于当前默认分支。不要接受 feature-branch
run。

最终接受 canary 前，即使自动 run 已完成，也要 reconcile exact current head：

```bash
gh workflow run codex-review-gate-controller.yml \
  --repo "github.com/$REPO" \
  -f operation=reconcile \
  -f pr_number=PR_NUMBER \
  -f expected_head_sha=FULL_HEAD_SHA \
  -f request_review=false
```

已记录 direct request comment ID 时，可以增加可选的 `request_comment_id`；它只是 hint，
Action 仍会检查所有 newer relevant evidence。

完成的 run 会分别报告 execution health 与 gate outcome。任何非 success 情况都必须按
`recovery_code` 与 summary 的 next action 操作。Finding 通常是 healthy gate failure；
unhealthy execution 是恢复问题，不是 finding verdict。`healthy/pending` 同样是 fail-closed：
它表示本次 run 安全地无法授权 success。只有 `recovery_code=wait_provider` 是纯等待；其他
code 都必须先执行 summary 指定的具体动作，再做后续 exact-head reconcile。

超大 PR 只有在 summary 报告 `use_expanded_limits` 时，才设置受保护 repository
variable `CODEX_REVIEW_GATE_LIMITS_PROFILE=expanded`。随后重读 exact head 并运行一次
scoped controller reconcile。manual dispatch 没有 limits-profile 或 numeric override。

最后重新读取 PR、verifier attempt 与 exact feature-head CheckRun，并同时要求：

- PR head 仍是 `FULL_HEAD_SHA`；
- PR base 与 test-merge SHA 未变；
- controller 已建立严格更新的 verifier attempt，且该 exact feature-head SHA 上唯一
  canonical `codex/github-review-gate` CheckRun 是 `success`；
- 该 verifier run 通过 merge-ref environment、event head/base scope（不使用 event
  `merge_commit_sha`）与 fresh PR read 绑定 unchanged current test-merge；
- CheckRun expected source 是 GitHub Actions；
- summary 是 `execution_health=healthy` 与 `gate_outcome=success`。

Head 变化后先停止并重读 summary 与完整 physical lineage；不得接受旧 commit 的 success，
也不得自动在同一 PR 启动 generation。只有每个歧义 predecessor 都显式绑定不同 full head
时，才能在 new head 继续。若 ordinary、edited、malformed、denied、deleted 或其他 unbound
predecessor 留下不可闭合 gap，必须使用 replacement PR。

## 4. 启用 ruleset 并关闭 canary

只有 exact-head canary 已 pass，才预览并启用：

```bash
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --expected-legacy-inventory-sha256 \
  "${LEGACY_INVENTORY_SHA256}" \
  --activate \
  --canary-pr PR_NUMBER \
  --canary-head FULL_HEAD_SHA
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --expected-legacy-inventory-sha256 \
  "${LEGACY_INVENTORY_SHA256}" \
  --apply \
  --activate \
  --canary-pr PR_NUMBER \
  --canary-head FULL_HEAD_SHA
```

每一次 ruleset write（包括 Disabled staging）之前，helper 都会重新读取 exact
default-branch workflow inventory、CODEOWNERS errors 与指定 owner 的 repository
permission；active write 前还会重新读取 canary lifecycle、base/head/test-merge SHA、
exact verifier run/job/CheckRun、exact canonical `display_title`、唯一 PR head/base
binding 与 collision inventory。Write 后会读回 exact ruleset 与
完整 consumer security snapshot。每条 staging、activation 与 final probe command 都必须
传入已记录的同一个 `V2_RULESET_NAME`。确认 active
enforcement、相同 GitHub Actions source、strict up-to-date、Code Owner review、push 后
dismiss stale approvals、新 ruleset 的普通 approval count 默认为 0 且不降低既有更高
count、conversation resolution、default-branch non-fast-forward protection，以及显式空
`bypass_actors`。

只有 exact Active readback 成功后，才从完整 pre-cleanup security snapshot 派生唯一可接受
的 cleanup state。该 read-only command 首先要求 current legacy inventory 等于原
owner-approved digest；stdout 只含一个 deterministic JSON object：

```bash
POST_CLEANUP_PLAN="$(mktemp)"
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --expected-legacy-inventory-sha256 \
  "${LEGACY_INVENTORY_SHA256}" \
  --derive-post-cleanup-plan > "$POST_CLEANUP_PLAN"
jq . "$POST_CLEANUP_PLAN"
EXPECTED_POST_CLEANUP_SECURITY_SHA256="$(jq -er \
  '.expected_post_cleanup_security_sha256 |
   select(test("^[0-9a-f]{64}$"))' \
  "$POST_CLEANUP_PLAN")"
```

授权 cleanup 前审阅该 plan。它只能删除 `codex/review-gate`。如果这移除了 classic
required-status policy 的最后 item，则该 empty policy 及其 `strict` field 可消失；ruleset
status rule 因而变空时该 rule 可消失，而 dedicated legacy-only ruleset 只有在不剩其他
rule 时才可整体消失。这些是唯一 structural exceptions。Repository/default-head identity、
workflow/CODEOWNERS inventory、owner permission、surviving classic policy 的全部 fields
与 non-legacy checks（包括 `strict`/`app_id`），以及每个 retained ruleset 的 identity、
conditions、bypass actors 与 unrelated rules 都必须精确保留。

只执行该已审阅 plan 作为另行授权的 legacy cleanup；之后使用相同 selected name 与记录的
expected digest 运行只读 post-cleanup closure。它读取两轮完整 security snapshot，要求
两轮完全相同、都等于 expected digest、两个 legacy surfaces 均 clear，并绑定同一 exact
complete Active v2 policy：

```bash
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --verify-post-cleanup \
  --expected-post-cleanup-security-sha256 \
  "${EXPECTED_POST_CLEANUP_SECURITY_SHA256}"
```

Cleanup 后不得重新派生。任何 cleanup/readback/verification failure 或 inconclusive 都必须
保持 v2 Active，只运行 read-only diagnostics，并报告 exact remaining 或 indeterminate
state；不得 disable/rollback v2 来制造 closure。

随后关闭 canary，但不 merge，也不在 close 命令使用 `--delete-branch`。先证明
closed-unmerged PR 仍携带已记录的 head repository、ref 与 OID，再用 Git exact-OID lease
让 deletion 与最后一次 remote-ref comparison 保持 atomic：

```bash
(
  set -euo pipefail
  trap 'printf "%s\n" "Canary cleanup did not prove completion. Do not issue an unconditional delete; inspect and report the exact PR/ref scope." >&2' ERR

  gh pr close "$CANARY_PR" --repo "github.com/$REPO"
  CANARY_CLOSED_STATE="$(gh api --hostname github.com \
    "repos/$REPO/pulls/$CANARY_PR")"
  jq -e \
    --arg repo "$CANARY_HEAD_REPO" \
    --arg ref "$CANARY_HEAD_REF" \
    --arg sha "$CANARY_HEAD" \
    '.state == "closed" and .merged_at == null and
     .head.repo.full_name == $repo and .head.ref == $ref and .head.sha == $sha' \
    <<< "$CANARY_CLOSED_STATE" > /dev/null

  CANARY_REMOTE="https://github.com/$CANARY_HEAD_REPO.git"
  REMOTE_CANARY_HEAD="$(git ls-remote --refs "$CANARY_REMOTE" \
    "refs/heads/$CANARY_HEAD_REF" |
    awk 'NR == 1 { print $1 } END { if (NR != 1) exit 1 }')"
  test "$REMOTE_CANARY_HEAD" = "$CANARY_HEAD"
  git push \
    --force-with-lease="refs/heads/$CANARY_HEAD_REF:$CANARY_HEAD" \
    "$CANARY_REMOTE" \
    ":refs/heads/$CANARY_HEAD_REF"
  POST_DELETE_REMOTE_CANARY="$(git ls-remote --refs "$CANARY_REMOTE" \
    "refs/heads/$CANARY_HEAD_REF")"
  test -z "$POST_DELETE_REMOTE_CANARY"
)
```

PR identity、remote OID 或 lease 不匹配时立即停止并报告，保持 branch 不动；不得用
unconditional delete 代替 leased deletion。Leased push 前发现 mismatch 时 branch 保持
不动；post-push read failure 时 deletion outcome 为 unknown。

默认分支含两份 canonical `@v2` workflows、ruleset active 且完整、两个 legacy surfaces
都已读回不含 `codex/review-gate`，且 closed-unmerged canary 在 current feature-head SHA
留下 exact successful native CheckRun、该 run 绑定 unchanged current default-branch
base/test-merge 的 canonical run-name receipt 与 PR binding 后，安装才算完成。
