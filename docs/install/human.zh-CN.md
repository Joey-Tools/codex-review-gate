# 安装 Codex Review Gate v2

本文面向仓库维护者。[Agent 执行手册](agent.zh-CN.md)把同一套安装流程写成
确定性的执行清单，并不是另一种安装模式。两份指南都使用
`templates/codex-gated-repo/` 下的 canonical assets。

普通单仓 rollout 使用两个 PR：

1. 一个 migration PR 同时移除 v1 caller、安装两份 canonical v2 workflows；
2. migration 合并后，另开一个无害 canary PR 验证默认分支 workflow 与 ruleset。

Canary 验证完成后关闭、不合并。

活动 v2 10 仓组织级 handoff 是针对 shared organization ruleset 的受控例外；旧 v1
organization ruleset 仍保留原始 11 仓 legacy selector。下方另有窄范围的 source repository
self-hosting 例外，它不属于该 cohort。修改任一例外 scope 前，必须先阅读对应 section。

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
- controller 自动 wake-up 只接受 `issue_comment` 的 `created`。编辑既有 comment 不会分配 runner；
  若该 edited carrier 需要重新评估，走受保护 default branch 的手动 `reconcile`。它刻意不订阅
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
  verifier 所需的窄 `pull-requests: write` 与 `actions: write`。它只面向 PR conversation
  comment；GitHub 的 issue-comment REST endpoint 对该目标接受 pull-request write。两者都
  没有 `issues: write`、`statuses: write`、`checks: write` 或 `contents: write`。

默认情况下，普通用户发出的 exact `@codex review` 在 `any` policy 下、任意 repository
permission 都只会作为 candidate 被纳入，而不是立刻成为 review-generation boundary。只有
official Codex Bot 在同一条 comment 上直接添加严格晚于当前 revision 的 `eyes` 或 `+1`
receipt，它才升级为 boundary。这是 gate attribution 决策，不是调用 Codex 的权限，也不保证
Codex 会启动；provider-side eligibility 与 delivery 独立决定。PR 其他位置后来出现的
terminal 或 progress carrier 不能建立该因果 receipt，所以未确认 candidate 不能抢占既有
clean。canonical workflow 直接设定
`CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION=any`；不要给普通 consumer 添加 repository
variable、public Action input 或 strict policy。`write`/`maintain`/`admin` path 仅保留给将来
可读取 collaborator permission 的 nonstandard verifier identity；bundled read-only verifier
token 无法可靠做到。它不会削弱 finding authority：任何合格 Codex finding 仍然阻塞。

Consumer workflows 没有 cron、`repository_dispatch`、`pull_request_target`、自动
`pull_request_review` writer、runtime GitHub App、status bridge 或 ledger。evidence
由所选 verifier 从 PR 重建。

未确认的普通、无 marker `@codex review` request 上，official Codex 直接添加且严格晚于
当前 revision 的 `eyes` 或 `+1` reaction 首先充当 receipt，把 candidate 升级为 boundary。
升级后 reactions 才作为 provider liveness evidence 读取。普通 request 上的 `+1` 仍不能
独立产生 head-bound clean evidence。若 official Codex `eyes` reaction 或 progress artifact
与候选 terminal clean 同时或更晚，则说明 review activity 仍然有效并 veto success。Reaction
变化本身不会启动 consumer job，因此需要等待后续合格 bot comment 触发，或手动 dispatch
exact-head `reconcile`。
在 predecessor-to-successor generation closure 中，与 successor request 同一时间戳的
liveness 也无法排序，必须保持 predecessor open。
一旦出现第二个物理 request boundary，unbound terminal 就无法证明自己属于新 request，
而不是旧 flight 的延迟结果。没有 base epoch 时，provider terminal evidence 只能闭合
第一个 gap；之后的每个 gap 和新 generation 的 clean authority，都必须来自直接附着在
对应 canonical request 上的合格 `+1`。有 base epoch 时，每个 gap 都必须如此。若旧 gap
已经无法在原始窗口内闭合，必须先区分 physical boundary 与 positive authority：edited、
malformed、wrong-author、denied 或 stale-base request 可以保留为 boundary，但没有
authority。只有每个歧义 predecessor 都显式绑定另一个 full head 时，新 head 才能恢复。
未确认 default-`any` ordinary candidate 不是 predecessor。若仍存在 provider-confirmed
ordinary、deleted 或其他 unbound predecessor，应新建 replacement PR，只运行一个 canonical
producer；验证 replacement 后关闭旧歧义 PR。
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

## 窄范围 source repository self-hosting 例外

此例外只适用于 `Joey-Tools/codex-review-gate` 迁移它自己的 default branch。它不会削弱
普通 consumer path：importable ruleset 与 bootstrap helper 默认的 `full` profile 仍适用于
所有普通 consumer 和每个 repository-level cohort installation。不得把此 profile 复制到通用
installation template。

先合并 source migration PR：它必须同时安装 exact canonical v2 verifier、controller 和
exact temporary legacy bridge，并保持 source 现有 legacy rule Active。之后才 remote 暂存这个
source-only v2 rule；`--ruleset-profile status-only` 只允许配合 `--repo`，不能传给
`--prepare-worktree`：

```bash
REPO="Joey-Tools/codex-review-gate"
CONTROL_PLANE_OWNER=@JoeyTeng
V2_RULESET_NAME="Must Pass Codex Review v2"
# Use the value recorded in the owner-approved legacy inventory snapshot.
LEGACY_INVENTORY_SHA256=OWNER_APPROVED_LEGACY_INVENTORY_SHA256

node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo "$REPO" \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --ruleset-profile status-only \
  --legacy-bridge \
  --expected-legacy-inventory-sha256 "$LEGACY_INVENTORY_SHA256"
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo "$REPO" \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --ruleset-profile status-only \
  --legacy-bridge \
  --expected-legacy-inventory-sha256 "$LEGACY_INVENTORY_SHA256" \
  --apply
```

在继续执行下方普通的 canary、activation 与 cleanup-proof sections 时，每一条后续 remote
invocation 都必须继续带上 `--ruleset-name "$V2_RULESET_NAME"`、
`--ruleset-profile status-only` 和 `--legacy-bridge`。这个 source exception 不能回退到默认
`full` profile。legacy required status 仍存在时，CLI 会拒绝未带 `--legacy-bridge` 的这个
source-only profile，避免 bridge 漂移后让 `codex/review-gate` 没有 producer。

新 rule 只包含 strict、GitHub-Actions-bound 的 `codex/github-review-gate` requirement。
它是第二条 rule：现有 source rule 继续负责 deletion、non-fast-forward、pull-request 与相关
CODEOWNERS protection。source-specific rule 激活后，legacy v1 status 与新 v2 CheckRun 会
双重保护 source。此阶段不得移除或扩大任何 legacy protection；只有经过独立 canary 与
owner-approved cleanup 后，才可以只移除 legacy status requirement。

不得使用 organization schema-2 final-closure receipt 删除 source 的 temporary bridge。
该 bridge 必须有单独记录的 source-local closure proof 与独立授权。

### Source-local legacy cleanup executor

source-only v2 rule 已被精确证明为 Active 后，用同一 source-only profile 与 bridge arguments
派生并审阅 source plan。该 executor 不对普通 consumer 开放。必须保持生成的 raw UTF-8 plan
bytes 不变：其 SHA-256 是 executor 的单独批准输入。plan 还记录 exact owner-approved
legacy-inventory SHA-256，因此执行时必须再次提供同一 digest，不能替换为之后的 inventory
approval。

```bash
POST_CLEANUP_PLAN="$(mktemp)"
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo "$REPO" \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --ruleset-profile status-only \
  --legacy-bridge \
  --expected-legacy-inventory-sha256 "$LEGACY_INVENTORY_SHA256" \
  --derive-post-cleanup-plan > "$POST_CLEANUP_PLAN"
jq . "$POST_CLEANUP_PLAN"
EXPECTED_POST_CLEANUP_SECURITY_SHA256="$(jq -er \
  '.expected_post_cleanup_security_sha256 |
   select(test("^[0-9a-f]{64}$"))' \
  "$POST_CLEANUP_PLAN")"
POST_CLEANUP_PLAN_SHA256="$(shasum -a 256 "$POST_CLEANUP_PLAN" |
  awk '{print $1}')"
```

source plan 不得有 classic mutation，且必须仅对 retained legacy ruleset 含一个
`remove-legacy-check-only` action。先 preview approved plan；只有在单独授权后才添加
`--apply`：

```bash
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo "$REPO" \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --ruleset-profile status-only \
  --legacy-bridge \
  --expected-legacy-inventory-sha256 "$LEGACY_INVENTORY_SHA256" \
  --apply-post-cleanup-plan "$POST_CLEANUP_PLAN" \
  --expected-post-cleanup-plan-sha256 "$POST_CLEANUP_PLAN_SHA256"

node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo "$REPO" \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --ruleset-profile status-only \
  --legacy-bridge \
  --expected-legacy-inventory-sha256 "$LEGACY_INVENTORY_SHA256" \
  --apply-post-cleanup-plan "$POST_CLEANUP_PLAN" \
  --expected-post-cleanup-plan-sha256 "$POST_CLEANUP_PLAN_SHA256" \
  --apply
```

executor 会在唯一 PUT 前重新派生最终两轮完整 pre-cleanup closure，要求其与 admitted plan
canonical equality，然后紧贴 PUT 前读取 exact legacy target 与 selected v2 ruleset、比较二者
完整 writable projection。GitHub 没有 ruleset-update CAS（compare-and-swap，即把读取与写入
绑定为原子前置条件），所以这些读取只能检测已经观察到的 drift，不能排除最终 API gap 中的
administrator change。必须在 final derivation、exact reads、PUT、readback 与 closure 的全程
实施另行授权的外部 single-writer policy freeze；无法维持该 freeze 时不得 apply。它读回 exact
after-state，且自动执行两轮 closure。PUT、readback 或 closure 失败时可能已经完成：不得 replay、
不得改变 classic protection、不得移除 bridge、不得 disable/overwrite v2。保持 Active v2；只运行
下方 read-only proof 与 exact ruleset inspection，之后再单独授权 repair：

```bash
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo "$REPO" \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --ruleset-profile status-only \
  --legacy-bridge \
  --verify-post-cleanup \
  --expected-post-cleanup-security-sha256 \
  "$EXPECTED_POST_CLEANUP_SECURITY_SHA256"
```

## Advanced：活动 v2 10 仓组织 cohort 的受控 handoff

只有在一个已明确批准的活动 v2 10 仓 organization cohort 的 default branches 全部受同一条
共享 v1 organization ruleset 保护时，才使用这个流程。原始 11 仓 legacy selector 独立保留。
它不是通用的 `allow-v1` 安装模式。下方编号章节中的普通单仓流程，以及每个活动 cohort
member 的最终状态，仍然拒绝所有 v1 caller。

`Joey-Tools/codex-waited-delivery` 已归档且仅属于 legacy selector。它保留在原始 11 仓
selector 中，使旧规则在最终 cutover 后仍为其保留 `deletion` 和 `non_fast_forward` 保护。
它不属于活动 v2 cohort，不需要 v2 installation、canary、repository-level cleanup、
final-closure receipt membership 或 bridge removal。
Manifest 必须在 `legacy_ruleset.legacy_only_repository` 中记录这一唯一例外的精确
`slug`、numeric `id`、`node_id`、`default_branch` 与 `archived: true`。旧 selector 只能包含
按顺序排列的 10 个活动 ID，以及该 identity 的 ID 一次；未知的第 11 个 ID 或与活动仓的
任何 identity overlap 都是 hard failure，从而不能意外把归档仓的保护重定向到别处。

Handoff 刻意把不同保护职责分开：

- 每个活动 cohort repository 都安装完整的 v2 repository ruleset，继续承担本文定义的
  strict up-to-date、
  Code Owner、stale-review、resolved-conversation 与 non-fast-forward 要求；
- 新建名为 `Must Pass Codex Review v2` 的 organization ruleset，只对精确 10 个活动成员要求
  source-bound strict `codex/github-review-gate`；
- 旧 organization ruleset 保留原始 11 仓 selector（包括仅属于 legacy 的已归档仓），并在
  活动 cohort 的 installation、canary proof、v2 activation 与 repository-level v1 cleanup
  全程保持 Active，同时保留 `deletion`、`non_fast_forward` 与唯一的 `codex/review-gate`
  status rule；
- 旧 organization ruleset 永不删除。最终 cutover 只移除其中完整的 legacy-only
  required-status rule；其 identity、targets、enforcement、bypass actors、`deletion`、
  `non_fast_forward` 与其他所有绑定字段必须不变。

这笔 transaction 的 source of truth 是一份经过审阅、schema 为
`organization-review-gate-handoff-manifest/v3` 的 JSON manifest。它绑定 organization
identity、旧 organization ruleset 的 exact snapshot、新 ruleset 的 name 与 ID、精确且有序
的 10 个活动 repository identities，以及原始 11 仓 legacy selector 和固定的 archived-only
repository identity；三份 workflow 的 blob/content hashes；effective CODEOWNERS identity；
每个完整 Active repository v2 ruleset；以及每个活动 repository-level legacy cleanup 的
before/after snapshots。每个 canary entry
把 open、non-draft、
same-repository PR 绑定到 exact current head/base/test-merge SHAs、v2 CheckRun 及其 workflow
run/attempt/job identities，以及最新 successful legacy commit-status ID。Version 3 还绑定单个
repository 的 legacy-evidence window、完整 repository-evidence、scheduler-snapshot 与
organization-evidence phase capacities、一次 full-cohort coverage-round capacity、two-round
coverage-stability capacity、每个 repository 的完整 legacy-writer scan budget，以及唯一一份
private scheduler descriptor。该 descriptor 只能属于
`Joey-Tools/codex-private-workflows` 的
`.github/workflows/scheduled-sync-release.yml`，并绑定 workflow ID、source blob/SHA-256、
required initial `active` state 与 drain budget。成员缺失、额外或顺序变化，或其他仓库上存在
scheduler descriptor，都会 hard fail。

精确的 `activation` fields 是 `legacy_evidence_stability_timeout_ms`、
`repository_evidence_timeout_ms`、`scheduler_snapshot_timeout_ms`、
`organization_evidence_timeout_ms`、`coverage_round_timeout_ms` 与
`coverage_stability_timeout_ms`；它们是 manifest-bound 的 plan input，不是临时 CLI override。

这是当前的 v2 handoff 路径。此前已签发的 v1 output 与 schema-1 receipt 只构成历史 11 仓
closure evidence；不得用它为本 cohort 执行 installation、stage、activation、cleanup 或
bridge removal。其已经发布的 JSON shape 与 canonical receipt digest 仍会为历史审计而严格
验证，但 schema 1 不授权任何新的 bridge removal。

从
`templates/organization-review-gate-handoff/joey-tools-10-member-manifest.template.json`
开始，并遵循同目录 README。每一个显式 placeholder 都必须替换为 live、reviewed
evidence；不得推测缺失 identity。`stage` 之前唯一允许的不完整值，是
`v2_ruleset.id` 的 JSON literal `null`，因为该 organization ruleset 此时尚不存在。其他
placeholder 或不完整值都会被拒绝。`stage` readback 成功后，只能用返回的 organization
ruleset ID 替换这个 `null`，并重新 review 完整 manifest。

每个活动 cohort member 的 migration PR 安装 canonical v2 verifier/controller，以及固定路径
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
不得对已归档、仅属于 legacy 的 repository 运行这条 bootstrap 路径。

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
之前，canary 必须保持 open。把 current bound evidence 写入 manifest；10 个活动 entries
全部满足条件前不得开始 organization activation。

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
10 个活动 open、non-draft、current-base canaries、canonical workflows、temporary bridges、
Active repository v2 rulesets 与仍未 cleanup 的 legacy surfaces 都精确匹配 manifest 后，
再 preview 并启用共享 ruleset：

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

开始 activation 前，先 quiesce 唯一的 manifest-bound private overlay scheduler。这是独立的
preview-first state transition；它只禁用 `Joey-Tools/codex-private-workflows` 中的
`.github/workflows/scheduled-sync-release.yml`，**不会**禁用 v2 verifier 或 temporary legacy
bridge。Scheduler 的 complete run inventory 不带 `status`、`head_sha`、event 或 creation-time
filter 读取。Disable 之前已经启动的 run 允许正常结束、绝不取消；只有两份完整且相同、均为
terminal 的 inventory 才能证明已经 drain。

```bash
HANDOFF_QUIESCE_PREVIEW="$(mktemp)"
node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode quiesce-scheduler > "$HANDOFF_QUIESCE_PREVIEW"
HANDOFF_QUIESCE_PLAN_SHA256="$(jq -er \
  '.plan_sha256 | select(test("^[0-9a-f]{64}$"))' \
  "$HANDOFF_QUIESCE_PREVIEW")"
node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode quiesce-scheduler \
  --apply \
  --expected-plan-sha256 "$HANDOFF_QUIESCE_PLAN_SHA256"
```

只有 `quiesce-scheduler` 返回 `applied-drained` 后，才运行下面这次**重新建立的** activation
preview 与 apply。不得复用 quiesce 前的任何 coverage read：

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

该命令返回成功的 dual-enforcement readback 后，显式 restore scheduler，并使用新的 preview
及其对应 digest：

```bash
HANDOFF_RESTORE_PREVIEW="$(mktemp)"
node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode restore-scheduler > "$HANDOFF_RESTORE_PREVIEW"
HANDOFF_RESTORE_PLAN_SHA256="$(jq -er \
  '.plan_sha256 | select(test("^[0-9a-f]{64}$"))' \
  "$HANDOFF_RESTORE_PREVIEW")"
node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
  --manifest "$HANDOFF_MANIFEST" \
  --mode restore-scheduler \
  --apply \
  --expected-plan-sha256 "$HANDOFF_RESTORE_PLAN_SHA256"
```

若 quiesce 或 activation 在 disable 之后失败，特意保留的 `disabled_manually` 状态就是 recovery
evidence。读取命令输出的 `recovery_code`，先确认是否已经到达 dual enforcement，再运行新的
preview；不得重放结果不明的 PUT。只有完成这一判断后，`restore-scheduler` 才是显式的 recovery
operation。若 disable 或 enable 的结果未知，必须先 reconcile exact manifest-bound scheduler
state。Failed quiesce 或 activation 后，helper 绝不会自动 restore scheduler。

运行对应 quiesce preview 前，建立外部 organization/repository admin policy-mutation freeze，
并保持到 scheduler restore readback 全部完成。该区间内任何管理员都不得修改
organization/repository rulesets、classic branch protection、conditions、required checks、
bypass actors，也不得单独 enable/disable 已绑定的 scheduler。GitHub ruleset update endpoint
没有 documented conditional/CAS；
digest 与紧邻读回能发现更早或更晚的 drift，却无法让最后一次 GET→PUT 区间具有原子性。
Helper 验证 manifest 绑定的 exact bypass lists，但不能自动发现或保留 snapshot 外并发加入
的 actor。

每个 post-activation 与 cutover stable snapshot 还会重新读取 manifest-bound scheduler，并要求其
live Actions workflow state 为 `active`，然后才从 GitHub 读取 archived-only repository，并要求返回的
`full_name`、`id`、`node_id`、`default_branch` 与 `archived: true` 都精确匹配 manifest。旧规则
cutover `PUT` 前，会与旧 ruleset 一起紧邻复读该 identity，并复读 exact manifest-bound scheduler，
要求它仍为 `active` 且与 stable snapshot 未发生变化。读取失败、同名 slug replacement、
identity/default-branch drift，或 archive flag 不再为 true 都是 inconclusive，不会发送 cutover
write；归档仓仍不会加入 v2、receipt 或 bridge-removal scope。若 scheduler restore 被跳过或失败，
`derive-cutover`、`apply-repository-cleanup` 与 `verify` 都以
`recovery_code=activation-scheduler-restore-required` fail closed；先运行新的 `restore-scheduler`
preview/apply，确认 active readback，再重新开始被阻断的 preview。

Activation readback 成功时才到达双重保护 handoff point：10 个活动成员都具备完整 repository
v2 policy，共享 v2-only organization rule 已 Active，而旧 organization v1 rule 仍以原始 11 仓
selector 保持 Active。只有 helper 完成该 post-write dual-enforcement proof **且**显式
scheduler restore 成功后，才可关闭且不合并每个活动 canary；`activate` 完成且 scheduler
恢复前绝不可关闭。之后的 `derive-cutover`、
`apply-repository-cleanup` 与 `verify` 使用 post-activation active-cohort snapshots，不要求
重新打开已关闭的 canary，也不要求当前 default-branch head 继续等于历史 canary base。Canary
receipt 只证明 activation boundary；activation 后 helper 改为读取每个活动 repository 的实时
default branch，并验证当前 control-plane/ruleset closure：exact repository identity、完整
regular-blob workflow inventory（三份 canonical files、单独 manifest-bound scheduler，且没有
额外 producer）、exact
CODEOWNERS、default-read Actions policy（包含明确 boolean
`can_approve_pull_request_reviews`）、Active repository 与 organization v2 rules、temporary
bridge、当前 cleanup state，以及单独 manifest-bound scheduler 的 live `active` state。

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
preview/apply，以及最终 stable readback 全部完成。第三次 freeze 期间，已 restore 的 scheduler
必须保持 `active`，任何管理员都不得单独 enable/disable 它；通过受控 executor 执行：

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
  .schema_version == "organization-review-gate-handoff-output/v2" and
  .mode == "verify" and
  .status == "final-verified" and
  .applied == false and
  .action == null and
  .final_closure_receipt.schema_version == 2 and
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
`schema_version: "organization-review-gate-handoff-output/v2"`、`mode: "verify"`、
`status: "final-verified"`、`applied: false`、`action: null`；同时包含
schema version 2 的 `final_closure_receipt`，绑定 organization、reviewed manifest digest、
final snapshot digest、legacy/v2 ruleset IDs/states 与按 canonical UTF-8 byte `full_name` order 排列的
固定、完整 10 仓活动 v2 cohort 的两份 identity list：schema-2 的
`manifest_repositories` 从 reviewed manifest 派生，`repositories` 是 stable observed identity
list。两者都以 canonical UTF-8 byte `full_name` order 列出 `full_name`、`id`、`node_id` 与
`default_branch`，并且逐项完全一致；它不接受任意子集或扩大的活动 cohort。对于当前 rollout，
任一 list 只要按 case-insensitive slug、numeric ID 或 node ID 命中已归档的
`Joey-Tools/codex-waited-delivery` 就会被拒绝，因此归档仓不能进入 active receipt list。旧规则的
独立 selector 仍是原始 11 仓，但不属于 receipt，也无权 bridge removal。其 top-level
`plan_sha256` 必须精确绑定最终只读 `verify` plan（`mode`、manifest digest、snapshot digest
与 `action: null`）；`final_closure_receipt_sha256` 绑定 canonical embedded receipt。必须完整
保留 `HANDOFF_FINAL_VERIFY` 中的 **整份 verify JSON 输出**，不能只保存嵌套 receipt。

这第三段 freeze 可以在完整输出被捕获且验证后结束。如果只读 verify inconclusive、任何
bound policy 不一致，或 capture 后到准备 bridge removal 之前发生了已知 organization/
repository policy mutation，则保留所有 bridges，修复 drift，并在新的 freeze 下重新生成
最终只读 verify 输出；绝不能用 `verify --apply` response 或旧 receipt 代替。

普通 authoritative success boundary 先读取一份完整 snapshot，等待 5 秒后再读一份。若
selected evidence 或 policy 不一致，就重新开始这一对读取。Activation 改用 manifest-bound
capacity contract，而不是通用的 60 秒上限：单个 repository 的 legacy evidence 为 900 秒；
每次完整 repository-evidence read 为 1,200 秒；每次 scheduler snapshot（包括 activation
preflight）为 120 秒；organization-evidence read 为 120 秒。一次 full-cohort coverage round
的 cap 是 9,000 秒。其成功 topology 的明确上界为 8,340 秒：
`2,100 + 2 * 120 + max(120, ceil(10 / 2) * 1,200)`。Scheduler drain 与其两次 state snapshot
先完成；随后 organization evidence 与五个两 repository evidence waves 并行。round cap 中
剩余的 660 秒是有意保留的 slack。two-round stable pair 的 cap 是 18,005 秒：两次 round 加
5 秒 interval。Pre-write 与 post-write stable coverage 同时受两层约束：其中每个 coverage
round 独立使用 round cap，完整 pair 使用 pair cap；immediate revalidation 只使用 round cap。
单轮上限避免一轮过长耗尽 pair budget，并让 scheduler 的 `disabled_manually` 状态超过其自身
容量。每次 scheduler snapshot、repository evidence read 与 organization read 都有独立强制的
deadline。

Scheduler evidence 完成后，organization 与 repository branches 并行运行。任一 branch failure
时，helper 保留最先观察到的 error，但会等待另一 branch 与所有已启动的 repository workers 完成
后才返回。因此，早期的 organization failure 可能等待 repository phase 的剩余有界 timeout；这是
有意的 fail-closed draining。

Workflow YAML inventory、Actions workflow inventory 与 local repository ruleset inventory 各有
32-entry hard admission cap。超出上限即为 inconclusive 并 fail closed。这里不声称 paginated
GitHub API endpoint 有固定数量的 HTTP requests；其 wall-clock boundary 是 phase deadline。经过
review 的 deployment manifest 可以提高 soft limits，但只能分别提高到每 repository 1,800 秒、
每 scheduler snapshot 300 秒、organization evidence 600 秒、每 round 15,000 秒、每 stable
pair 30,005 秒以内，并仍必须满足 topology formula。这些是 upper capacity limits，不是
`activate` 的总 wall-clock 时间，也不表示 GitHub Actions minutes free；正常路径在实际读取
完成时结束。任一 budget 都不允许 partial pagination 或改变后的 execution epoch。任一 deadline
到期或 evidence 变化时，结论均为 inconclusive，不允许下一次 write；读取 `recovery_code` 后
重新运行对应的 fresh preview。

Closure 完成后，每个活动 cohort member 另开一个 PR，移除 canonical bridge。不得为已归档、
仅属于 legacy 的 repository 创建此类 PR：

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
repository metadata。它要求 `full_name`、`id`、`node_id` 与 `default_branch` 都与固定 10 仓
manifest-derived `manifest_repositories` cohort 中的一项精确相等。Observed
`repositories` list 会独立验证完全相等，但不是 authorization source。已归档、仅属于 legacy 的
repository 被刻意排除，因此不能授权 bridge removal。在 atomic bridge quarantine rename 前的
边界，它会先在 live-metadata query 前后各读取一次 `origin`，重新验证本地对象后，再紧邻
rename 读取一次 `origin`。Rename 后、unlink 前，它会再次执行完整的 `origin` -> live metadata
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
这条路径不会为了创建 request 消耗 Actions minutes。在 official Codex Bot 直接在同一条
comment 上添加严格 post-revision 的 `eyes` 或 `+1` receipt 前，它只是 candidate，不能使既有
clean 失效。后续满足条件的 Codex bot `issue_comment` `created` event 会启动 controller，由它
建立严格更新的 full verifier attempt；编辑既有 comment 不会启动 controller，若该 carrier 需要
重新评估则手动 reconcile。若结果只出现在 review 或 reaction，或者需要恢复，也手动 reconcile。

### Dual-protection legacy-status recovery

手动 v2 `reconcile` 只刷新 `codex/github-review-gate`，绝不会写
`codex/review-gate`。两个 context 仍同时 required 时，只由 review 或 reaction 承载的结果可能需要单独
恢复 v1。首先只用 REST API 绑定一份完整的 current scope：`GET repos/$REPO` 必须仍返回
`full_name=$REPO` 与正数 `id`；把该 ID 绑定为 `REPOSITORY_ID`，把它的
`default_branch` 绑定为 `DEFAULT_BRANCH`，并从对应的
`GET repos/$REPO/branches/$DEFAULT_BRANCH` 响应绑定 `DEFAULT_BRANCH_HEAD_SHA`。fresh
`GET repos/$REPO/pulls/$CANARY_PR` 响应必须 open、non-draft、same-repository；其 head
repository/ref/SHA 必须等于 `$REPO`、`CANARY_HEAD_REF` 与 `CANARY_HEAD`，base repository/ref/SHA
必须等于 `$REPO`、`DEFAULT_BRANCH` 与 `DEFAULT_BRANCH_HEAD_SHA`。

用 `GET repos/$REPO/actions/workflows/codex-review-gate-legacy-bridge.yml` 解析 current bridge，
绑定它的正数 `LEGACY_WORKFLOW_ID`，再调用
`GET repos/$REPO/actions/workflows/$LEGACY_WORKFLOW_ID`。要求 ID 相同、path 精确为
`.github/workflows/codex-review-gate-legacy-bridge.yml`、`state=active`；display name 仅用于诊断，
不构成 identity。读取
`GET repos/$REPO/contents/.github/workflows/codex-review-gate-legacy-bridge.yml?ref=$DEFAULT_BRANCH_HEAD_SHA`，
要求 `type=file` 且 path 精确匹配，解码 base64 content，并与
`$SOURCE_ROOT/templates/codex-gated-repo/.github/workflows/codex-review-gate-legacy-bridge.yml`
逐 byte 相同。缺失、truncated、无法解码或内容不同都属于 inconclusive。

调用 `GET repos/$REPO/actions/workflows/$LEGACY_WORKFLOW_ID/runs`，查询参数固定为
`event=pull_request_target`、`head_sha=$CANARY_HEAD`、`exclude_pull_requests=false` 与
`per_page=100`，并跟完所有 pagination links。结果必须是完整分页 workflow-run inventory：每页
`total_count` 必须是相同的非负整数，每个非末页必须满 100 条，flatten 后的 run 数必须等于
`total_count`。malformed run、任何跨页重复 run ID，或触及 GitHub 对 filtered search 公开的
1,000-result ceiling，都不能证明空集合。完整读取后立即用完全相同的 query 重读 page 1，并要求其
canonical JSON（包括 `total_count` 与有序 runs）和捕获的第一页相同。pagination horizon 发生变化会使
整次 read 无效；应从 scope binding 重新开始，不能混用两个 horizon 的 pages。

在这份完整且稳定的 inventory 中，eligible run 的 API `created_at` 必须证明它仍处于 GitHub 公开的
30-day rerun window，且 run 已经 completed，并同时满足：正数 `workflow_id` 等于已绑定 ID；
`run_attempt` 为正数；
`repository.full_name` 与 `head_repository.full_name` 都等于 `$REPO`，且它们的 ID 都等于
`REPOSITORY_ID`；`event=pull_request_target`；`head_sha=CANARY_HEAD`；且恰好一个
`pull_requests` entry 的 number、head/base ref 和 SHA、以及嵌套 head/base repository ID 都等于完整已绑定
PR scope。Actions-run 中嵌套的 repository object 是最小的 `{id,name,url}` reference，可能没有
`full_name`；其正数 ID 必须等于 `REPOSITORY_ID`，不得把缺失的名字当作 match。matching nonterminal run
表示 pending，不能当作 candidate cardinality zero。在 run object 内，`DEFAULT_BRANCH_HEAD_SHA` 只由
`pull_requests[0].base.sha` 绑定；不得把 top-level `run.head_sha` 与 default-branch SHA 比较。
对于 `path`，接受 bare canonical path、GitHub 公开的
`<canonical-path>@<DEFAULT_BRANCH>` form，或等价的
`<canonical-path>@refs/heads/<DEFAULT_BRANCH>` form。解析 suffixed form 时，只移除已知的
canonical-path-plus-`@` prefix，并把全部非空 remainder 当作 ref；该 ref 必须精确等于
`$DEFAULT_BRANCH` 或 `refs/heads/$DEFAULT_BRANCH`，其他 path/ref 一律拒绝。bare form 之所以可接受，是
因为独立的 PR base repository/ref/SHA、feature-head `head_sha`、active workflow identity 与 exact bridge
bytes 已补齐 ref binding。

上述 repository、branch、PR、workflow、canonical bytes 与稳定分页 inventory 合称完整
**recovery binding set**（candidate selection 以及 write 前后都必须复验的全部状态）。按完整 eligible
集合的 cardinality 分类：恰好一个 candidate 才可继续，并把它的 `id` 与 `run_attempt` 分别绑定为
`LEGACY_RUN_ID` 和 `LEGACY_RUN_ATTEMPT`。多于一个即使其中一个更新也仍是 inconclusive，必须 stop，
不得选择 latest。只有完整稳定读取后的 cardinality zero 才允许下方 draft-to-ready fallback。缺失字段、
pagination cap、重复 ID、horizon drift 或 scope 无法读取都属于 inconclusive，绝不等于 zero。

在 write 前一刻，重复读取 repository、default-branch head、PR、active workflow、exact bridge bytes、
完整 run pagination、duplicate-ID check 与 page-1 horizon reread；要求同一个完整 recovery binding set，
且唯一 candidate 仍具有相同 `LEGACY_RUN_ID` 与 `LEGACY_RUN_ATTEMPT`。同时完整分页并稳定复读
`GET repos/$REPO/commits/$CANARY_HEAD/statuses?per_page=100`，拒绝重复 status ID，记录所有 pre-POST
status IDs 及当前 reverse-chronological 顺序中的第一个 exact-context `codex/review-gate` status。这是
最终 pre-POST recovery binding-set read。

只 rerun 这个 exact 已有 bridge run，不得改用其他 v1 workflow。write 前先把
`LEGACY_RERUN_RECEIPT` 设为 operator 保留的、该 transaction 专用且尚不存在的路径。保留这个 exact
path；不得另选新路径重试 mutation。no-clobber response-file creation 会阻止这个 block 静默覆盖先前的
receipt：

```bash
: "${LEGACY_RERUN_RECEIPT:?set an operator-retained recovery receipt path}"
if test ! -e "$LEGACY_RERUN_RECEIPT"; then
  :
else
  printf 'recovery receipt already exists; do not submit the POST: %s\n' \
    "$LEGACY_RERUN_RECEIPT" >&2
  exit 1
fi
if (
  umask 077
  set -C
  gh api --hostname github.com \
    --include \
    --header "X-GitHub-Api-Version: 2026-03-10" \
    --method POST \
    "repos/$REPO/actions/runs/$LEGACY_RUN_ID/rerun" \
    > "$LEGACY_RERUN_RECEIPT"
); then
  LEGACY_RERUN_GH_EXIT=0
else
  LEGACY_RERUN_GH_EXIT=$?
fi

LEGACY_RERUN_HTTP_VERSION=
LEGACY_RERUN_HTTP_STATUS=
if IFS=$' \t\r' read -r LEGACY_RERUN_HTTP_VERSION LEGACY_RERUN_HTTP_STATUS _ \
  < "$LEGACY_RERUN_RECEIPT"; then
  :
else
  printf 'rerun POST response is inconclusive; retain %s and do not replay\n' \
    "$LEGACY_RERUN_RECEIPT" >&2
  exit 1
fi
case "$LEGACY_RERUN_HTTP_VERSION" in
  HTTP/1.1|HTTP/2|HTTP/2.0|HTTP/3|HTTP/3.0) ;;
  *)
    printf 'rerun POST status line is inconclusive; retain %s and do not replay\n' \
      "$LEGACY_RERUN_RECEIPT" >&2
    exit 1
    ;;
esac
if test "$LEGACY_RERUN_GH_EXIT" -ne 0; then
  printf 'rerun POST did not prove HTTP 201; retain %s and do not replay\n' \
    "$LEGACY_RERUN_RECEIPT" >&2
  exit 1
fi
if test "$LEGACY_RERUN_HTTP_STATUS" = 201; then
  :
else
  printf 'rerun POST did not prove HTTP 201; retain %s and do not replay\n' \
    "$LEGACY_RERUN_RECEIPT" >&2
  exit 1
fi
printf 'recovery receipt retained at %s (HTTP %s)\n' \
  "$LEGACY_RERUN_RECEIPT" "$LEGACY_RERUN_HTTP_STATUS"
```

GitHub rerun 会保留原 run 的 `GITHUB_SHA` 与 `GITHUB_REF`；这正是所选 run 必须已经绑定该 exact
feature head、而 embedded PR entry 另行绑定 current default-branch repository/ref/SHA 的原因。
`--include` 会让保留的 response 以 HTTP status line 开头，固定 API-version header 则避免 API version
negotiation 改变该 request。parser 接受 HTTP/1.1、HTTP/2 与 HTTP/3 输出的 status token，提取第二个
field，并强制它精确等于 `201`。即使 receipt partial 或 empty，也要把它作为 inconclusive attempt 的
evidence 保留；它绝不能证明 success。`gh` 非零退出、第一行缺失或 malformed、非 `201` status，或任何
其他 transport uncertainty 都属于 inconclusive：保留 receipt，绝不再次提交 POST。POST 只能提交一次。

POST 后轮询该 exact run ID 直到 terminal，然后重复相同的完整 recovery binding-set read 与完整稳定
run enumeration。要求 repository、default branch/ref/SHA、PR head/base scope、active workflow
ID/path/state、canonical bridge bytes 与 sole eligible run ID 全部未变；该 run 现在必须满足
`run_attempt` 恰好等于 `LEGACY_RUN_ATTEMPT + 1`、`status=completed`、`conclusion=success`。最后完整分页
`GET repos/$REPO/commits/$CANARY_HEAD/statuses?per_page=100`，拒绝重复 status ID，以同样方式稳定复读
page-1 horizon，并要求 reverse-chronological 顺序中的第一个 exact-context `codex/review-gate` status
具有一个不在完整 pre-POST inventory 中的 ID、`state=success`、
`creator.login=github-actions[bot]` 与 `creator.type=Bot`，且 endpoint 仍绑定 current `CANARY_HEAD`。
旧 success 不能作为本次 rerun evidence。timeout、attempt 未变或跳跃、scope 改变、inventory 不稳定/
不完整或 candidate 不唯一均为 inconclusive：不得再次提交 POST。

只有完整稳定的 eligible set cardinality 为 zero（包括所有其他 matching run 均已超出 GitHub rerun
window）时，才可把 PR 转成 draft 后再标记 ready，以创建新的 `pull_request_target` lifecycle run。
重新绑定完整 recovery binding set 后从本选择步骤开始；不得复用先前的 zero 结果。不得为了恢复 v1
加入 `workflow_dispatch`、`pull_request_review`、`pull_request_review_comment`、cron 或新的 status
writer。

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
时，才能在 new head 继续。若 provider-confirmed ordinary、edited、malformed、denied、deleted
或其他 unbound predecessor 留下不可闭合 gap，必须使用 replacement PR；未确认 default-`any`
ordinary candidate 不会单独形成该 gap。

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
binding（包括 top-level `run.repository.id`、`run.head_repository.id` 以及嵌套 Actions-run
repository ID 都必须等于 current repository ID）与 collision inventory。Write 后会读回 exact ruleset 与
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

只使用适用且另行授权的 policy-specific executor 执行该已审阅 plan。上方 narrow source
exception 所记录的 source-only executor 不得用于 ordinary consumer。任何 write 后均不得
重新派生。cleanup/readback failure 不能成为 disable/rollback v2 的理由：必须保留 complete
Active v2 gate，只运行 policy-specific read-only diagnostics，并报告 exact remaining 或
indeterminate state。

随后使用相同 selected name 与记录的 expected digest 运行专用的只读 post-cleanup closure。
它读取两轮完整 security snapshot，要求两轮完全相同、都等于 expected digest、两个 legacy
surfaces 均 clear，并绑定同一 exact complete Active v2 policy：

```bash
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo OWNER/REPO \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --verify-post-cleanup \
  --expected-post-cleanup-security-sha256 \
  "${EXPECTED_POST_CLEANUP_SECURITY_SHA256}"
```

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
