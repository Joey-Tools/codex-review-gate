# Agent 安装执行手册：Codex Review Gate v2

本文供 coding agent 代替仓库维护者执行安装。它是[人类指南](human.zh-CN.md)的
确定性执行版本，不是另一套安装设计。必须复制 canonical assets，不得从示例重写
任一 consumer workflow。

必须安装并验证三个完整必需 asset groups：canonical verifier/controller workflows、repository ruleset 与
最终有效的 `.github/CODEOWNERS`。CODEOWNERS 中两条受管规则必须指向同一个显式
`CONTROL_PLANE_OWNER`；ruleset 必须要求 Code Owner review，并在 push 后 dismiss stale
approvals。`integration_id: 15368` 标识的是整个 GitHub Actions App，不是任一 workflow，
因此不能替代两份 workflow byte verification 与 CODEOWNERS 控制面。

## 输入与停止条件

先解析并记录：

```text
SOURCE_ROOT = Joey-Tools/codex-review-gate 的干净 checkout
TARGET_ROOT = 已授权 consumer repository worktree
REPO = TARGET_ROOT 对应的 OWNER/REPO
DEFAULT_BRANCH = consumer repository default branch
INSTALL_BRANCH = migration PR branch
MIGRATION_PR = migration PR 创建后的编号
CONTROL_PLANE_OWNER = 对 REPO 有 write、maintain 或 admin 的一个 @USER
V2_RULESET_NAME = 选定的 v2 ruleset name；默认 "Must Pass Codex Review"
```

目标未授权、`TARGET_ROOT` 有无关 dirty changes、无法证明默认分支，或仓库不在支持的
GitHub.com/default-branch PR scope 时停止。

保持以下不变量：

- 普通单仓流程中，一个 migration PR 可以同时移除 v1、安装 v2；
- migration 合并后才创建独立 canary PR；
- canary 最后关闭、不合并；
- 每次 manual run 只处理一个 PR 与一个 exact expected head；
- `workflow_dispatch` 是唯一 manual entry；
- 使用不带 feature ref 的 `gh workflow run`，随后 read back 并证明 run 来自
  `DEFAULT_BRANCH`；
- 优先把直接发 `@codex review` 作为 provider-side attempt；它不授予 provider capability，
  也不保证 Codex 会启动。只有 request creation 与更新 verifier attempt 需要 controller
  协调时才用 `begin-review`；
- 每个 exact-head review generation 只选择一个 request producer。只有该 head 上没有
  `request_review=true` 的 active controller `begin-review` 时，才优先 direct request。
  一旦该 run 已 dispatch、正在启动或已经发出 hidden marker，就不得再手动发送 direct
  `@codex review`。不确定 producer ownership 时，先读取 controller run、canonical marker、
  sticky diagnostic 与 provider evidence，再决定是否 mutation；
- limit profile 只允许通过 protected repository variable
  `CODEX_REVIEW_GATE_LIMITS_PROFILE` 选择 `default` 与 `expanded`，不得增加 dispatch
  或 numeric override；
- canonical workflow 固定 `CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION=any`。不要给普通
  consumer workflow 新增 repository variable、Action input 或 strict policy；`write` 仅保留给
  将来可读取 collaborator permission 的 nonstandard verifier identity。
- 每次调用 bootstrap 都显式保留同一个 `CONTROL_PLANE_OWNER`。默认值是
  `@JoeyTeng`；非 Joey 仓库必须替换成自己的合格 GitHub user。

## 窄范围 source repository self-hosting 例外

只有 `REPO` 精确等于 `Joey-Tools/codex-review-gate`、且任务就是迁移该 source repository
自身时才使用此路径。它不是普通 consumer 或 repository-level cohort 的替代安装模式：其他任何
位置仍必须使用 importable template 与 bootstrap 默认的 `full` profile。

1. 用 canonical v2 verifier、controller 与 exact temporary legacy bridge 准备 source
   migration PR。source worktree preparation 必须传 `--legacy-bridge`；不要在那里传
   `--ruleset-profile status-only`，因为该 profile 只允许用于 remote stage。
2. 在 source 现有 legacy rule 保持 Active 时合并该 PR。记录 owner-approved 的
   `LEGACY_INVENTORY_SHA256`；不得编造或替换其值。
3. 在 remote 暂存独立的 Disabled source rule，并保留 temporary bridge 和 exact legacy
   inventory boundary：

   ```bash
   REPO="Joey-Tools/codex-review-gate"
   CONTROL_PLANE_OWNER=@JoeyTeng
   V2_RULESET_NAME="Must Pass Codex Review v2"
   # Set this from the owner-approved legacy inventory snapshot.
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

4. 每一条后续 remote canary activation、read-only cleanup derivation/verification invocation
   都必须继续带上 `--ruleset-name "$V2_RULESET_NAME"`、
   `--ruleset-profile status-only` 与 `--legacy-bridge`。这个 source exception 不能回退到
   默认 `full` profile。legacy required status 仍存在时，CLI 会拒绝未带 `--legacy-bridge` 的
   这个 source-only profile，避免 bridge 漂移后让 `codex/review-gate` 没有 producer。验证新 rule 只包含 strict、GitHub-Actions-bound 的
   `codex/github-review-gate` requirement。它必须是第二条 rule：现有 source rule 保留
   deletion、non-fast-forward、pull-request 与相关 CODEOWNERS protection。在独立 canary
   通过且 source-specific rule 激活后，legacy v1 status 与 v2 CheckRun 都必须继续 required，
   直到 owner-approved cleanup action 只移除 legacy requirement、且 post-cleanup proof
   成功。不得移除或扩大 legacy protection。
5. 不得用 organization schema-2 final-closure receipt 删除该 source bridge。没有单独授权、
   已记录的 source-local closure proof 时必须停止。
6. source-only v2 rule 已被精确证明为 Active 后，用同一 `status-only` profile 与 bridge
   派生并审阅 source-local cleanup plan。必须保持 plan 的 raw UTF-8 bytes 不变；其 SHA-256
   是显式 approval input。plan 还绑定 exact owner-approved legacy-inventory SHA-256，因此
   执行时必须再次提供同一 digest，不能替换成之后的 inventory approval。普通 consumer
   不可使用此路径：

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

7. source plan 不得含 classic mutation，且必须只含 retained legacy ruleset 的一个
   `remove-legacy-check-only` action。先 preview，只有在单独记录授权后才增加 `--apply`：

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

   executor 会在唯一 PUT 前重新派生最终两轮完整 pre-cleanup closure、要求其与 admitted plan
   canonical equality，然后紧贴 PUT 前读取 exact legacy target 与 selected v2 ruleset、比较二者
   完整 writable projection。GitHub 没有 ruleset-update CAS（compare-and-swap，即把读取与写入
   绑定为原子前置条件），所以这些读取只能检测已经观察到的 drift，不能排除最终 API gap 中的
   administrator change。必须在 final derivation、exact reads、PUT、readback 与 closure 的全程
   实施另行授权的外部 single-writer policy freeze；无法维持该 freeze 时不得 apply。它读回 exact
   after-state，并自动运行两轮 closure。PUT/readback/closure 失败时可能已经完成：不得 replay、
   不得 mutation classic protection、不得移除 bridge、不得 disable/overwrite v2。保留 Active v2；
   只使用下面的 read-only proof 与 exact ruleset inspection，再单独授权 repair：

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

## Advanced：活动 v2 10 仓 organization handoff

只有当授权 scope 精确等于一个经过审阅、受共享 v1 organization ruleset 保护的活动 v2 10 仓
cohort 时，才使用本执行路径。旧 v1 rule 仍保留其原始 11 仓 legacy selector。它不是可复用的
`allow-v1` 开关。除了上面单独记录的 source self-hosting 例外，下方普通 phases 仍拒绝所有
v1 caller；advanced path 最终也必须让每个活动成员回到同一个 no-v1 contract。

`Joey-Tools/codex-waited-delivery` 已归档且仅属于 legacy。它留在旧 rule 的原始 11 仓
selector 中，使 `deletion` 和 `non_fast_forward` 在 cutover 后仍受保护。它不需要 v2
installation、canary、repository cleanup、final-closure receipt membership 或 bridge removal。
Manifest 在 `legacy_ruleset.legacy_only_repository` 中绑定这一唯一例外的精确 `slug`、numeric
`id`、`node_id`、`default_branch` 与 `archived: true`。旧 selector 只能包含按顺序排列的 10 个
活动 ID，以及该 identity 的 ID 一次；未知的第 11 个 ID、重复项或与活动 cohort 的 identity
overlap 都必须拒绝，否则归档仓的保护可能被静默重定向。

增加以下 cohort inputs：

```text
HANDOFF_MANIFEST = reviewed JSON 的绝对路径
HANDOFF_SCHEMA = organization-review-gate-handoff-manifest/v3
V2_ORGANIZATION_RULESET_NAME = Must Pass Codex Review v2
COHORT_REPOSITORY_V2_RULESET_NAME = Must Pass Codex Review v2
```

Manifest 必须绑定 exact organization ID/node ID、旧 organization ruleset 的完整 snapshot、其
原始 11 仓 selector 与固定 archived-only repository identity、新 rule 的 name/ID、精确且有序
的 10 个活动 repository slugs/numeric IDs/node IDs/default branches、verifier/controller/
temporary bridge 的 Git blob SHA 与 SHA-256、effective CODEOWNERS identity、每个完整 Active
repository v2 ruleset，以及每个活动 repository legacy-cleanup before/after action。每个 canary 必须把 exact open、
non-draft、same-repository PR 绑定到 current head/base/test-merge SHAs、v2 CheckRun/run/
workflow/attempt/job IDs，以及最新 successful legacy commit-status ID。Version 3 还绑定单个
repository 的 legacy-evidence window、完整 repository-evidence、scheduler-snapshot 与
organization-evidence phase capacities、full-cohort coverage-round capacity、two-round
coverage-stability capacity、每个 repository 的 `legacy_writer_scan_timeout_ms`，以及唯一一份
`scheduler_quiescence` descriptor。该 descriptor 只允许属于
`Joey-Tools/codex-private-workflows` 的
`.github/workflows/scheduled-sync-release.yml`，并绑定 workflow ID、source blob/SHA-256、
initial `active` state 与 drain timeout。任意字段不完整、活动成员集不同、identity drift、
意外的 scheduler descriptor 或 unsupported surface 都必须停止。

精确的 `activation` keys 是 `legacy_evidence_stability_timeout_ms`、
`repository_evidence_timeout_ms`、`scheduler_snapshot_timeout_ms`、
`organization_evidence_timeout_ms`、`coverage_round_timeout_ms` 与
`coverage_stability_timeout_ms`。它们是 manifest-bound 的 plan input，绝不是临时 CLI override。

这是当前的 v2 handoff 路径。此前已签发的 v1 output 与 schema-1 receipt 只构成历史 11 仓
closure evidence；不得用它为本 cohort 执行 installation、staging、activation、cleanup 或
bridge removal。其已经发布的 JSON shape 与 canonical receipt digest 仍会为历史审计而严格
验证，但 schema 1 不授权任何新的 bridge removal。

按同目录 README 实例化
`templates/organization-review-gate-handoff/joey-tools-10-member-manifest.template.json`。
每个显式 placeholder 都必须来自 authoritative live evidence；不得合成缺失 ID 或 digest。
`stage` 之前唯一允许的不完整值，是 `v2_ruleset.id` 的 JSON literal `null`，因为 organization
v2 ruleset 此时尚不存在。其他 placeholder 或 incomplete field 必须 validation failure。
`stage` readback 成功后，只能使用 `next_manifest_update.v2_ruleset.id` 替换这个 `null`，
review 完整 manifest，并重新运行 `plan`。

因为 ambiguous POST 可能需要 no-receipt adoption，stage preview 前必须建立外部
organization-admin policy-mutation freeze，并保持到 apply、readback 与任何 recovery 完成。
Scheduler quiesce preview 前再建立一次 organization/repository admin freeze，保持到 fresh
shared-rule activation preview/apply、stable post-write readback 与 scheduler restore readback
全部完成。两条显式 quiesce/restore command 之间，已绑定 scheduler 必须保持
`disabled_manually`。Repository-cleanup preview 前第三次建立 freeze，并连续保持到
完整 cleanup batch/readback、最终旧规则 preview/apply，以及另一次最终只读 verify receipt
capture/validation 全部完成。
这些 freeze 期间任何管理员都不得修改 organization/repository ruleset、classic branch
protection、condition、required check 或 bypass actor；第二、第三次 freeze 期间也禁止任何人单独
enable/disable 已绑定 scheduler。第三次 freeze 期间还禁止任何活动 cohort
repository 被 rename、transfer、delete、改变 default branch，或在原 slug 被 replace/
re-create。这些是运营冻结，不是持续 API 锁。GitHub ruleset endpoint 没有 documented
conditional/CAS update，cleanup mutation API 也没有 repository-ID conditional/CAS write；
plan digest 与紧邻重读可以拒绝已观察到的 drift，却无法阻止最后 GET→PUT 或 repository
metadata read→write 区间的 racing write，这些区间由 freeze 覆盖。只能验证 manifest 绑定的
bypass actors，绝不能声称 runtime 会自动发现 snapshot 外新增的 actor。

每个 post-activation/cutover stable snapshot 还必须重新读取 manifest-bound scheduler，并要求其
live Actions workflow state 为 `active`，然后才从 GitHub 读取 archived-only repository，并将
`full_name`、`id`、`node_id`、`default_branch` 与 `archived: true` 同 manifest 精确比对。旧规则
cutover `PUT` 前，必须与旧 ruleset 一起紧邻复读该 identity，并复读 exact manifest-bound scheduler，
要求它仍为 `active` 且与 stable snapshot 未发生变化。读取失败、same-slug replacement、
identity/default-branch drift 或 `archived: false` 都是 inconclusive，绝不能发送 cutover write；
这份 proof 不会使归档仓成为 v2、receipt 或 bridge-removal member。若 scheduler restore 被跳过或
失败，`derive-cutover`、`apply-repository-cleanup` 与 `verify` 都以
`recovery_code=activation-scheduler-restore-required` fail closed；先运行新的
`restore-scheduler` preview/apply，确认 active readback，再重新开始被阻断的 preview。

严格按下列 state machine 执行：

1. 对每个活动 cohort member，用 exact bridge profile 替换普通阶段 1 的 bootstrap calls：

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

   这只安装固定的 canonical
   `.github/workflows/codex-review-gate-legacy-bridge.yml`，不会放宽其他 v1 caller 的
   inventory 检查。Organization cutover 被验证完成前，每次 remote repository bootstrap
   invocation 都必须保留 `--legacy-bridge`。Migration 仍使用普通流程相同的 exact-head
   Code Owner review boundary 合并。不得对已归档、仅属于 legacy 的 repository 运行这条路径。

   Bridge 的可写 event envelope 是封闭的：只有 `pull_request_target` 的 `opened`、`reopened`、
   `synchronize`、`ready_for_review`，以及 `issue_comment` 的 `created`。它刻意排除
   `pull_request_review`：GitHub 会将该 workflow 绑定到 PR merge ref，而兼容 publisher 的
   `issues: write` authority 不能安全地在该 ref 执行。不得在 consumer repository 局部加回
   review trigger。temporary bridge 仍只是 compatibility status publisher；v2 manual reconcile
   不能刷新它的 v1 status。dual protection 仍生效时所需的 exact-run recovery 见阶段 3。
2. Reviewed repository ruleset name 精确为 `Must Pass Codex Review v2`，不是普通默认值
   `Must Pass Codex Review`。每个活动 cohort member 只能沿用普通 runbook 的 canonical-file
   controls 与阶段 2 Disabled repository-policy staging。每条 repository bootstrap
   preview/apply 都必须同时传入 `--ruleset-name "$COHORT_REPOSITORY_V2_RULESET_NAME"` 与
   `--legacy-bridge`；不得进入普通 cleanup 或 canary-close 步骤。

   Disabled rule 读回后，再创建 cohort canary。沿用普通 evidence mechanics，以及阶段 5
   中仅 repository activation 的部分：证明 exact successful `codex/github-review-gate`
   CheckRun 及 canonical current-test-merge workflow run/job receipt，并证明最新
   `codex/review-gate` bridge commit status 在同一 feature head 上为 success；随后用同一个
   distinct name 与 bridge profile activate 完整 repository v2 rule。在普通 legacy cleanup
   前停止。记录所有 bound IDs，并让 canary 保持 open、non-draft、same-repository、
   current-base，直到 shared organization activation 被证明。旧 organization v1 rule 与
   所有 repository legacy requirements 必须仍然存在。
3. 完成并独立审阅 `HANDOFF_MANIFEST`，运行只读 organization plan：

   ```bash
   node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
     --manifest "$HANDOFF_MANIFEST" \
     --mode plan
   ```

4. Preview 并创建 Disabled v2-only organization ruleset。Apply 必须使用对应 preview 的
   exact digest：

   ```bash
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

   Payload 必须只包含一条 source-bound strict `codex/github-review-gate` requirement，
   GitHub Actions integration 为 `15368`，conditions 精确绑定活动 10 仓 cohort/default
   branch，且 bypass list 显式为空。不得从旧 organization rule 复制 `deletion`、
   `non_fast_forward` 或 pull-request rules。把返回的
   `next_manifest_update.v2_ruleset.id` 绑定进 reviewed manifest，并在继续前重新运行
   `plan`。

   如果 POST 可能已经提交后失败，helper 会先尝试一次只读 reconcile；返回
   `applied-recovered` 与 `next_manifest_update` 就是已验证成功。如果进程被中断或仍报告
   unknown outcome，则不得重复 `stage --apply`。保持 `v2_ruleset.id: null`，运行只读恢复
   入口：

   ```bash
   node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
     --manifest "$HANDOFF_MANIFEST" \
     --mode stage \
     --recover-created-v2
   ```

   `--recover-created-v2` 不得与 `--apply` 或 digest 合用。只有唯一一个同名规则的 source
   与完整 writable payload 精确等于 canonical Disabled v2，且旧 organization rule 仍在
   exact before-state 时，才可输出 `next_manifest_update`。Candidate 不存在、多个、已
   Active 或有 drift 都是停止条件。完整 recovery read 期间必须保持外部
   organization-admin policy-mutation freeze；绝不重发 POST。
5. 在任何 activation proof 前，先 preview 并 quiesce 唯一的 manifest-bound private
   scheduler。它只限于 `Joey-Tools/codex-private-workflows` 的
   `.github/workflows/scheduled-sync-release.yml`，不得禁用 v2 verifier 或 temporary legacy
   bridge。Drain 读取完整且不带 filter 的 run inventory（不得带 `status`、`head_sha`、event 或
   creation-time filter）。不得取消已启动的 run；等待两份相同且全部 terminal 的 inventory。

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

   只有返回 `applied-drained` 才继续。Disable 后失败会刻意保留 scheduler
   `disabled_manually`。读取输出的 `recovery_code`，不得重放结果不明的 PUT；通过 fresh
   preview reconcile exact manifest-bound scheduler state。Failed quiesce 或 activation 后，helper
   绝不会自动 restore scheduler。
6. 从**重新建立的** post-quiesce coverage snapshot preview 并 activate 新 organization
   rule。绝不复用 quiesce 前读取的 coverage evidence：

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

   写入前 helper 必须证明 10 个活动 exact repository identities、三份 exact canonical workflows
   与 manifest-bound quiesced scheduler、完整 effective CODEOWNERS identities、Active repository
   v2 rulesets、open/non-draft/current-
   base canaries、exact v2 run/job receipts、latest successful legacy commit statuses、未变化
   的活动 repository legacy surfaces 与 exact old organization rule。成功 readback 才是双重
   保护 handoff point：shared v2 Active，同时 shared v1 仍以原始 11 仓 legacy selector
   保持 Active。

   只有 `activate` 完成，且步骤 7 已在成功的 post-write dual-enforcement readback 后 restore
   scheduler，才可关闭 canary。之后的 `derive-cutover`、
   `apply-repository-cleanup` 与 `verify` 使用 post-activation active-cohort snapshots，不要求
   重新打开这些 PR，也不要求当前 default-branch head 等于历史 canary base。Canary receipt 只
   属于 activation-bound evidence；后续每轮都读取每个活动 repository 的实时 default branch
   并验证当前 control-plane/ruleset closure：exact repository identity、包含三份 canonical
   workflows、单独 manifest-bound scheduler 且没有额外 producer 的完整 regular-blob workflow
   inventory、exact CODEOWNERS、
包含明确 boolean `can_approve_pull_request_reviews` 的 default-read Actions policy、Active
repository/organization v2 rules、temporary bridge、cleanup state 与单独 manifest-bound scheduler 的
live `active` state。
7. `activate --apply` 返回成功的 dual-enforcement readback 后，preview 并 restore scheduler。
   这是一条有独立 plan digest 的单独 mutation；在先判断 interrupted activation 是否到达 dual
   enforcement 后，它也是唯一的正常 recovery operation。

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

   Enable outcome 不确定时不得重放；先 reconcile exact workflow state，并遵循其
   `recovery_code`。
8. 只读推导 cutover transaction：

   ```bash
   HANDOFF_CUTOVER_PLAN="$(mktemp)"
   node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
     --manifest "$HANDOFF_MANIFEST" \
     --mode derive-cutover > "$HANDOFF_CUTOVER_PLAN"
   jq . "$HANDOFF_CUTOVER_PLAN"
   ```

   审阅 manifest-bound `external_repository_actions`。每个 action 只覆盖活动 cohort，且只可
   移除 `codex/review-gate`；已归档、仅属于 legacy 的 repository 没有 cleanup action。所有
   non-legacy checks/strictness、ruleset identity/targets、bypass actors、`deletion`、
   `non_fast_forward` 与 unrelated rules 必须保留。不得手工执行 raw actions。开始连续覆盖
   cleanup 至 final verify 的外部 policy-mutation freeze，再通过受控 executor 先 preview 后执行：

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

   这是运营冻结，不是持续的 repository 或 API 锁。从 cleanup preview 到最终只读
   `verify`，除已列出的 policy mutations 外，还必须禁止活动 cohort repository rename、
   transfer、delete、default-branch change，以及在原 slug replace/re-create repository。
   GitHub cleanup mutation API 没有 repository-ID conditional/CAS write；这段 freeze 覆盖
   最后一次 repository metadata read 到 write 之间的区间。

   每次 cleanup surface GET（包括 initial classification、正常 readback 与 error
   reconciliation）前，都必须读取 live GitHub metadata，并要求 manifest-bound `full_name`、
   `id`、`node_id` 与 `default_branch` 精确相等。若该项仍需写入，则在紧邻 mutation 前
   重复 identity check，要求 exact `expected_before`，执行 surface-specific mutation，最后
   要求 exact `expected_after` readback。`id`/`node_id` 绑定 repository object；`full_name`
   绑定 expected route 并暴露 rename、transfer 或 slug reuse；`default_branch` 绑定 branch
   selector。Snapshots 保护选定的 policy content；无关 metadata churn 应忽略。Identity 无法
   读取或 mismatch 时，batch 会在观测点立即停止：pre-mutation mismatch 不会写当前
   action，之后也不再执行任何 mutation。稳定的 before/after mixed state 可以安全续跑：
   已经 after 的项目是 no-op，新 preview 只计划仍为 before 的项目。Mutation 返回 error 或
   结果 unknown 时，executor 必须先做 narrow read-only reconcile；exact after 表示完成，
   before、drift 或无法读取则停止整个 batch。在 freeze 下生成新 preview 并 review 该
   state；绝不盲目重放旧 request 或 digest。任一 action 未达到 exact `expected_after` 时，
   不得进入 organization cutover。
9. Preview 并执行最终 organization cutover：

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

   `verify --apply` 是唯一可修改旧 organization ruleset 的 helper operation。它移除完整的
   legacy-only required-status rule；旧 ruleset 的 ID、name、conditions 中的原始 11 仓
   selector、enforcement、bypass actors、`deletion`、`non_fast_forward` 与其他所有 fields
   必须保留。绝不删除旧 ruleset。因为 mutating command 的 `applied-final-verified` boundary
   之后 control plane 仍可能 drift，外部 policy-mutation freeze 必须越过 apply/readback，一直
   保持到另一次最终只读 `verify` 完成。只接受顶层为
   `schema_version: "organization-review-gate-handoff-output/v2"`、`mode: "verify"`、
   `status: "final-verified"`、`applied: false`、`action: null`，并包含
   `final_closure_receipt.schema_version: 2` 与 lowercase 64-hex
   `final_closure_receipt_sha256` 的输出。Embedded receipt 必须绑定 organization、reviewed
   manifest digest、final snapshot digest、legacy/v2 ruleset IDs/states 与按 canonical UTF-8
   byte `full_name` order 排列的 exact repository cohort 两次：`manifest_repositories` 从
   reviewed manifest 派生，`repositories` 是 stable observed identity list。两者都含
   `full_name`、`id`、`node_id` 与 `default_branch`，并且必须逐项完全一致；只能是固定、完整的
   10 仓活动 v2 cohort，不能是任意子集或扩大的活动 cohort。对于当前 rollout，任一 list 只要按
   case-insensitive slug、numeric ID 或 node ID 命中已归档的
   `Joey-Tools/codex-waited-delivery` 就会被拒绝，因此归档仓不能进入 active receipt list。
   独立的旧 selector 仍是原始 11 仓，但不赋予 final-closure receipt membership 或
   bridge-removal authority。top-level `plan_sha256` 必须精确绑定最终只读 `verify` plan
   （`mode`、manifest digest、snapshot digest 与 `action: null`）。必须完整保留
   `HANDOFF_FINAL_VERIFY` 中的 JSON output；单独提取 embedded receipt 不能作为 bootstrap 输入。

   只有该文件及 top-level shape 验证完成后，第三段 freeze 才结束。若本次读取 inconclusive
   或任何 bound policy 不一致，保留所有 bridges，修复 drift，并在 freeze 下重复最终只读
   verify。若 capture 之后到 removal preparation 之前发生了已知 organization/repository
   policy mutation，则丢弃旧 proof，在新的 freeze 下生成 fresh final read-only output；绝不
   用 `verify --apply` response 代替，也不复用已知 stale receipt。
10. 只有步骤 9 成功 closure 后，每个活动 cohort member 才从 clean worktree 另开
   bridge-removal PR。不得为已归档、仅属于 legacy 的 repository 创建此类 PR：

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

   虽然 option 名称是 singular `--final-closure-receipt`，它接收的是完整的最终只读 verify
   output。Bootstrap 会验证 terminal top-level fields、重新计算 canonical embedded receipt
   digest、比对显式 expected SHA-256、解析 target worktree 中无歧义的 GitHub `origin`，并从
GitHub 读取 live repository metadata。它要求 `full_name`、`id`、`node_id` 与
`default_branch` 都和固定 10 仓 manifest-derived `manifest_repositories` cohort 中的一项精确
相等。Observed `repositories` list 会独立验证完全相等，但不是 authorization source。已归档、
仅属于 legacy 的 repository 被刻意排除，因此不能授权 bridge removal。在 atomic bridge
quarantine rename 前的边界，它会先在 live-metadata query 前后各读取一次 `origin`，重新验证
本地对象后，再紧邻 rename 读取一次 `origin`。Rename 后、unlink 前，它会再次执行完整的 `origin` -> live
metadata identity/default-branch -> `origin` 检查，并重新验证 quarantine 中 admitted file 的
object identity 与 canonical content。若该 remote binding check 失败，它会通过 no-clobber
hard-link creation 尝试把同一 admitted bridge 恢复到 canonical path；若目标路径已被占用或
恢复后的验证失败，则 fail closed、绝不覆盖占用者，也不报告删除成功。这些是 point-in-time 的
remote binding 与 local identity/content checks，并非连续锁。不得编辑 receipt、切换 `origin`
或绕过这份 proof。

   Bridge absent 时，bridge-removal component 是 idempotent no-op；已有但 non-canonical
   的 bridge 会被拒绝。整个 command 也会强制 canonical verifier、controller 与 managed
   CODEOWNERS block；即使 bridge 已经 absent，`--apply` 仍会修复这些 surfaces 的 drift。
   Apply 前必须独立验证它们并检查 dry run；若提出 bridge removal 之外的变更，必须停止并
   处理或单独 review drift，不能把改动当作 bridge-only PR。合并后运行不带
   `--legacy-bridge` 的普通 bootstrap 与 inventory checks；任何残留 v1 caller 都是
   failure。

普通 authoritative helper success boundary 先读取一份完整 snapshot，等待 5 秒，再读一份。
Selected evidence 或 policy 不同就重新开始这一对读取。Activation 改用 manifest-bound capacity
contract，不使用通用 60 秒上限：单个 repository 的 legacy evidence 为 900 秒；每次完整
repository-evidence read 为 1,200 秒；每次 scheduler snapshot（包括 activation preflight）为
120 秒；organization evidence 为 120 秒。一次 full-cohort coverage round 的 cap 是 9,000
秒。其成功 topology 的明确上界为 8,340 秒：
`2,100 + 2 * 120 + max(120, ceil(10 / 2) * 1,200)`。Scheduler drain 与其两次 state
snapshots 先完成；随后 organization evidence 与五个两 repository evidence waves 并行。剩余
660 秒是有意保留的 slack。two-round stable pair 的 cap 是 18,005 秒：两次 round 加 5 秒
interval。Pre-write 与 post-write stable coverage 同时使用两层约束：每个 coverage round 独立
受 round cap 限制，完整 pair 受 pair cap 限制；immediate revalidation 只使用 round cap。
这样可防止单轮过长耗尽 pair budget，并延长 scheduler 的 `disabled_manually` 状态。每次
scheduler snapshot、repository-evidence read 与 organization-evidence read 都有独立强制的
deadline。

Scheduler evidence 完成后，organization 与 repository branches 并行运行。任一 branch failure
时，保留最先观察到的 error，但先等待另一 branch 与所有已启动的 repository workers 完成后才返回。
因此，早期的 organization failure 可能等待 repository phase 的剩余有界 timeout；这项有意的
fail-closed draining 防止 stale reads 与后续 recovery attempt 重叠。

Workflow YAML inventory、Actions workflow inventory 与 local repository ruleset inventory 各有
32-entry hard admission cap。超出上限即为 inconclusive 并 fail closed。不要从这个 admission
cap 推导 paginated GitHub read 具有固定数量的 HTTP pagination requests；其 wall-clock boundary
是 phase deadline。经过 review 的 deployment manifest 可以提高 soft limits，但只能分别提高到
每 repository 1,800 秒、每 scheduler snapshot 300 秒、organization evidence 600 秒、每 round
15,000 秒、每 stable pair 30,005 秒以内，并仍必须满足 topology formula。这些是 upper capacity
limits，不是 `activate` 的总 wall-clock，也不表示 GitHub Actions minutes free；正常执行会在
实际读取结束时完成。任何 capacity limit 都不允许 incomplete pagination 或改变后的 execution
epoch。Deadline 到期或 evidence 改变时，结论为 inconclusive、不允许下一次 write；读取
`recovery_code` 后再运行对应 fresh preview。恢复时绝不能 disable v2 或删除旧 organization rule。

## 阶段 1：准备并合并 migration PR

1. 读取默认分支：

   ```bash
   DEFAULT_BRANCH="$(gh api --hostname github.com \
     "repos/$REPO" \
     --jq '.default_branch')"
   test -n "$DEFAULT_BRANCH"
   ```

2. 修改 worktree 前，对 repository default workflow permissions 做只读 preflight：

   ```bash
   DEFAULT_WORKFLOW_PERMISSIONS="$(gh api --hostname github.com \
     "repos/$REPO/actions/permissions/workflow" \
     --jq '.default_workflow_permissions')"
   test "$DEFAULT_WORKFLOW_PERMISSIONS" = read
   ```

   值缺失、无法读取或不是 `read` 时必须停止。不得在本次安装中静默修改；应另行取得授权，
   把 repository default workflow permissions 设为 read-only，读回该 endpoint 后从这个
   preflight 重新开始。

3. 在 `TARGET_ROOT` 从最新 `DEFAULT_BRANCH` 创建 `INSTALL_BRANCH`。
4. 预览并应用两份 canonical workflows：

   ```bash
   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --prepare-worktree "$TARGET_ROOT" \
     --control-plane-owner "$CONTROL_PLANE_OWNER"
   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --prepare-worktree "$TARGET_ROOT" \
     --control-plane-owner "$CONTROL_PLANE_OWNER" \
     --apply
   ```

   Helper 会在显式 checkpoint 重新验证 target workflow parents。这不是
   operation-bound filesystem sandbox：恶意 same-UID process 仍可能在 checkpoint
   之间 race path-based operation。出现 safety failure 时停止，不得改用手工复制；只有
   确认不可信进程无法并发修改这些 parents 时才继续。

   若 helper 报告根目录 `CODEOWNERS` 或 `docs/CODEOWNERS`，停止并在同一个 PR 中把所有
   既有 entries 移动或合并进 `.github/CODEOWNERS`，然后重跑。不得让高优先级新文件
   遮蔽尚未合并的旧 policy。

5. Helper 若报告其他 v1 caller，只检查它列出的 paths。整个文件专用于 v1 时才删除；
   否则只移除或停用 legacy job。重复 preview，直到无 v1 caller。
6. 证明两份 workflow bytes 等于各自 canonical template，并读取最终有效的 CODEOWNERS
   rules：

   ```bash
   cmp \
     "$SOURCE_ROOT/templates/codex-gated-repo/.github/workflows/codex-review-gate.yml" \
     "$TARGET_ROOT/.github/workflows/codex-review-gate.yml"
   cmp \
     "$SOURCE_ROOT/templates/codex-gated-repo/.github/workflows/codex-review-gate-controller.yml" \
     "$TARGET_ROOT/.github/workflows/codex-review-gate-controller.yml"
   tail -n 4 "$TARGET_ROOT/.github/CODEOWNERS"
   ```

7. 要求 CODEOWNERS suffix 只用 `CONTROL_PLANE_OWNER` 保护
   `/.github/workflows/` 与 `/.github/CODEOWNERS`。审核完整 diff、运行 consumer 必需
   验证、commit、push，并开一个 migration PR。它可以同时包含 v1 removal、v2
   installation 与 CODEOWNERS merge。
8. 请求 owner approval 前，运行 tracked executable
   `$SOURCE_ROOT/scripts/build-legacy-review-gate-inventory.sh`。它精确接收 repository、
   expected default branch 与 output path 三个参数；不得从本指南重建实现。捕获 digest：

   ```bash
   APPROVAL_INVENTORY_DIR="$(mktemp -d)"
   APPROVAL_INVENTORY="$APPROVAL_INVENTORY_DIR/legacy-inventory.json"
   LEGACY_INVENTORY_SHA256="$("$SOURCE_ROOT/scripts/build-legacy-review-gate-inventory.sh" \
     "$REPO" "$DEFAULT_BRANCH" "$APPROVAL_INVENTORY")"
   LEGACY_INVENTORY_SHA256="${LEGACY_INVENTORY_SHA256#LEGACY_INVENTORY_SHA256=}"
   printf 'LEGACY_INVENTORY_SHA256=%s\n' "$LEGACY_INVENTORY_SHA256"
   ```

   把 canonical JSON 与打印的 SHA-256 一并记录进 approval snapshot，并让全部 inventoried
   legacy requirements 保持 active 直到 migration merge。
9. 把第一次批准视为 manual trust-bootstrap gate。Base branch 此时还没有新的
   CODEOWNERS rules，ruleset 也尚未建立，所以 GitHub 无法替你强制这次 owner approval。
   要求 `CONTROL_PLANE_OWNER` 与 PR author 不同，然后证明该 owner 的最新 review 是绑定
   current head 的 `APPROVED`：

   ```bash
   CONTROL_PLANE_LOGIN="${CONTROL_PLANE_OWNER#@}"
   MIGRATION_HEAD="$(gh pr view "$MIGRATION_PR" \
     --repo "github.com/$REPO" \
     --json headRefOid,state,isDraft \
     --jq 'if .state == "OPEN" and (.isDraft | not) then .headRefOid else error("migration PR is not open and ready") end')"
   REVIEW_PAGES="$(mktemp)"
   gh api --hostname github.com --paginate --slurp \
     "repos/$REPO/pulls/$MIGRATION_PR/reviews?per_page=100" \
     > "$REVIEW_PAGES"
   jq -e \
     --arg owner "$CONTROL_PLANE_LOGIN" \
     --arg head "$MIGRATION_HEAD" \
     '[.[][] | select((((.user.login? // "") | ascii_downcase) == ($owner | ascii_downcase)) and .user.type == "User")]
      | sort_by([.submitted_at, .id])
      | last
      | .state == "APPROVED" and ((.commit_id | ascii_downcase) == ($head | ascii_downcase))' \
     "$REVIEW_PAGES"
   rm -f "$REVIEW_PAGES"
   test "$(gh pr view "$MIGRATION_PR" --repo "github.com/$REPO" --json headRefOid --jq .headRefOid)" = "$MIGRATION_HEAD"
   ```

   `jq -e` 失败、owner 与 PR author 相同、head 漂移，或该 owner 的后续 review 不是
   exact-head approval 时停止；不得依赖 prose 或 stale UI indication 合并。
   这个 migration PR 是 manual trust bootstrap，不是它自己的 v2 canary。合入后，所有
   pre-existing open PR 都必须先为 current head/base/test-merge scope 建立 fresh verifier，v2
   才能成为 required：push 新 head、reopen，或使用文档中的 draft-to-ready transition。
   `reconcile` 可以 rerun 已存在的 exact verifier，但刻意不能为任意 pre-installation PR 创建它。
10. 保留第 9 步的 exact `MIGRATION_HEAD` 与 approval snapshot。进入 transaction 前，完成并
   保留全部 legacy requirements 到 merge 完成，使后续失败仍 fail closed。Owner approval
   第 8 步已用 canonical generator 生成只读 inventory，并把 SHA-256 写入 approval snapshot；它绑定
   exact repository slug、numeric repository ID、opaque node ID 与 default branch；每个 matching ruleset 的 ID、name、source、enforcement、
   target、conditions、完整 `bypass_actors` 与完整 `rules`；包含全部 parameters 的完整
   matching effective `required_status_checks` rule；以及完整 classic required-status
   object（包括 `strict` 与每个 check 的 producer `app_id`）或显式 null。Producer 与 runtime
   调用同一 Node canonicalizer。Hash 前会排序
   语义无序的 bypass/check/context arrays 与 conditions include/exclude sets。即使 legacy
   inventory 为空，也会得到绑定该 repository/default branch 的 digest。API response 或
   schema 不完整属于 inconclusive，任何 drift 都 fail closed。HTTP success 的空 body 或
   JSON `null` 也属于 inconclusive；只有明确识别的 absence response 才会 canonicalize 为
   null。Digest 必须从外部传为
   `LEGACY_INVENTORY_SHA256`，没有默认值。从 Disabled staging、canary、activation write
   一直到 exact Active readback，每次 preview/apply 都必须跨进程复用同一个
   owner-approved baseline；新 helper process 不得建立新 baseline。

   在一个 fail-fast transaction 中执行 final gate 与唯一 merge mutation：

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

   所有 precondition 都在 synchronous merge mutation 前；API、`jq`、`test`、pagination、
   parse、actor、base、head、state 或 review 任一失败都会退出，trap 清理 temporary files。
   REST endpoint 只能即时 merge 或失败（包括 405/409），不能 enqueue。不得使用
   `gh pr merge`、auto-merge、merge queue 或 admin bypass。Current actor 必须是 trusted
   owner，并在 fresh review readback 后立即 direct merge；GitHub 没有 review-state-plus-head
   atomic CAS，只重读 head 不足以闭环。

   Merge 后立即重读 current default、exact base/head 与 merged lifecycle 全部成功后，仍须
   保持两个 legacy surfaces active。另建 Disabled v2 ruleset，在 legacy 继续阻塞 merge 时
   跑 canary，再 activate v2 并精确读回完整 Active policy。只有之后才执行另行授权的
   legacy removal plan，并读回两个 legacy surfaces。短暂双重 enforcement 是预期状态；
   zero enforcement 禁止出现。

11. 读回 merge，随后 fetch 默认分支，对 merged file 重做 byte comparison，并重新读取最终
   有效的 CODEOWNERS block 与显式 owner：

   ```bash
   gh pr view "$MIGRATION_PR" \
     --repo "github.com/$REPO" \
     --json state,mergedAt,headRefOid \
     | jq -e --arg head "$MIGRATION_HEAD" \
       '.state == "MERGED" and .mergedAt != null and ((.headRefOid | ascii_downcase) == ($head | ascii_downcase))'
   git -C "$TARGET_ROOT" fetch origin "$DEFAULT_BRANCH"
   MERGED_VERIFIER="$(mktemp)"
   MERGED_CONTROLLER="$(mktemp)"
   git -C "$TARGET_ROOT" show \
     "FETCH_HEAD:.github/workflows/codex-review-gate.yml" \
     > "$MERGED_VERIFIER"
   cmp \
     "$SOURCE_ROOT/templates/codex-gated-repo/.github/workflows/codex-review-gate.yml" \
     "$MERGED_VERIFIER"
   git -C "$TARGET_ROOT" show \
     "FETCH_HEAD:.github/workflows/codex-review-gate-controller.yml" \
     > "$MERGED_CONTROLLER"
   cmp \
     "$SOURCE_ROOT/templates/codex-gated-repo/.github/workflows/codex-review-gate-controller.yml" \
     "$MERGED_CONTROLLER"
   rm -f "$MERGED_VERIFIER" "$MERGED_CONTROLLER"
   git -C "$TARGET_ROOT" show \
     "FETCH_HEAD:.github/CODEOWNERS" \
     | tail -n 4
   ```

合并后的两份 canonical workflows contract 必须是：

- `JoeyTeng/codex-review-gate-action@v2`；prerelease selector 绝不是
  installation value。唯一例外是 [`RELEASING.zh-CN.md`](../RELEASING.zh-CN.md)
  中 release operator 使用的 temporary RC admission bridge，包括 installed-consumer 与
  fresh-fixture 两种形态；两者都不是 installation 或 activation path；
- verifier path `.github/workflows/codex-review-gate.yml`、workflow name
  `Codex Review Gate Verifier`、`pull_request` types `opened`、`reopened`、
  `synchronize`、`ready_for_review`，以及 exact PR feature-head SHA 上的 required job
  `codex/github-review-gate`；
- controller path `.github/workflows/codex-review-gate-controller.yml`、workflow
  name `Codex Review Gate Controller`、exact Codex `issue_comment` `created`，以及
  default-branch `workflow_dispatch`。编辑既有 comment 不会分配 runner；需要重新评估时走受保护的
  手动 `reconcile`。它刻意排除
  `pull_request_review`：GitHub 将 review event 绑定到 PR merge ref，因此具有狭窄 write
  authority 的 controller 不得在该 ref 执行。只由 review 或 reaction 承载的 evidence 必须通过
  受保护 default branch dispatch reconcile；
- runner 前精确校验 sender 与 author 为
  `chatgpt-codex-connector[bot]`、type `Bot`；
- manual trigger 只有 `workflow_dispatch`，inputs 为 `operation`、`pr_number`、
  `expected_head_sha`、可选 `request_comment_id`、默认 `true` 的
  `request_review`；没有 dispatch limits profile；
- 默认 `ubuntu-slim`，只有
  `CODEX_REVIEW_GATE_USE_UBUNTU_LATEST=true` 选择 `ubuntu-latest`；
- verifier/controller 使用独立 concurrency namespaces；verifier latest-wins cancel，
  controller operations 不 cancel；
- 没有 cron、`repository_dispatch`、`pull_request_target`、可写
  `pull_request_review`、status bridge、runtime App 或 ledger。

controller Action step 的 underscore inputs 只有 `github_token`、`pr_number`、
`expected_head_sha`、`operation`、`request_comment_id` 与 `request_review`。两份 Action
steps 从 protected repository variable `CODEX_REVIEW_GATE_LIMITS_PROFILE` 派生
`limits_profile=default|expanded`；public outputs 只有 `execution_health`、`gate_outcome`、
`recovery_code` 与 `retry_safe`。Finding counts 仅是 summary/sticky diagnostics。

Canonical workflow 直接设定
`CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION=any`：它让 verifier 接受已观察到的 exact
ordinary request author 作为 candidate，且不查询 collaborator permission。只有 official
Codex Bot 在同一 comment 上直接添加严格晚于当前 revision 的 `eyes` 或 `+1` receipt，它才
成为 generation boundary。这不授予 commenter 调用 Codex 的权限，也不保证 Codex 会启动；
provider-side eligibility 与 delivery 独立决定，未确认 candidate 不能抢占既有 clean。不要把
nonstandard `write`/`maintain`/`admin` policy 加入普通 consumer：它需要 verifier identity
可读取 collaborator permission，而 bundled
read-only verifier token 无法可靠做到。该设置不会让合格 finding 失去阻塞效力。

## 阶段 2：暂存并验证 Disabled ruleset

Canonical workflow 已进入 `DEFAULT_BRANCH` 后执行：

```bash
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo "$REPO" \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --expected-legacy-inventory-sha256 \
  "${LEGACY_INVENTORY_SHA256}"
node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
  --repo "$REPO" \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --ruleset-name "$V2_RULESET_NAME" \
  --expected-legacy-inventory-sha256 \
  "${LEGACY_INVENTORY_SHA256}" \
  --apply
```

重新读取 repository rulesets，要求唯一目标 ruleset 满足：

```text
target coverage: 新建 ruleset 只覆盖 default branch；existing 同名 ruleset 若已有更广 targets，其 include/exclude conditions 会原样保留并必须核对
enforcement: disabled
required context: codex/github-review-gate
expected source: GitHub Actions
expected source integration_id: 15368
strict up-to-date: true
code-owner review: true
dismiss stale reviews on push: true
ordinary approving review count: 新 ruleset 为 0；既有更高 count 保留
all review conversations resolved: true
non-fast-forward default-branch updates blocked: true
bypass actors: explicit empty array
```

对于 existing 同名 ruleset，必须确认它覆盖 `DEFAULT_BRANCH`，再检查每一个被保留的额外
include/exclude target 是否符合预期。不得把更广 targets 的既有 coverage 误报成 helper
已将其收窄到默认分支。

要求 helper 的 legacy inventory 同时覆盖 effective repository rulesets 与 classic branch
protection required-status contexts。Disabled staging、canary、activation 与 exact Active
readback 全程保留每一个 active inherited、separately managed 或 classic
`codex/review-gate` requirement。每次 preview 与 apply 都必须使用同一个 owner-approved
digest 比较完整 canonical dual-surface inventory；repository/default branch 漂移、任何
ruleset policy 或 classic producer 变化，以及 API/schema 不完整，都属于 inconclusive 并
fail closed。Helper 必须允许这个 overlap，且不得修改这些 legacy
surfaces。若 active legacy/incomplete ruleset 已占用选定的 v2 name，必须在无 write 状态下
停止并选定 distinct `V2_RULESET_NAME`。每一条 staging、activation 与 final probe command
都已传入这个变量，绝不可省略。API/schema failure 或 overlap drift
必须视为 inconclusive，不能当作 absent。Canary pass 前不得 activate；v2 Active readback
前不得删除 legacy。

## 阶段 3：创建独立 canary PR

1. 从已合并 `DEFAULT_BRANCH` 创建临时分支与一个无害可 review 变更，push 并开 non-draft
   PR。
2. 读取权威 scope，把 exact `headRefOid` 记录为完整 head SHA：

   ```bash
   CANARY_PR="$(gh pr view CANARY_SELECTOR \
     --repo "github.com/$REPO" \
     --json number \
     --jq '.number')"
   CANARY_BASE="$(gh pr view "$CANARY_PR" \
     --repo "github.com/$REPO" \
     --json baseRefName \
     --jq '.baseRefName')"
   CANARY_HEAD="$(gh pr view "$CANARY_PR" \
     --repo "github.com/$REPO" \
     --json headRefOid \
     --jq '.headRefOid')"
   CANARY_HEAD_REPO="$(gh api --hostname github.com \
     "repos/$REPO/pulls/$CANARY_PR" \
     --jq '.head.repo.full_name')"
   CANARY_HEAD_REF="$(gh api --hostname github.com \
     "repos/$REPO/pulls/$CANARY_PR" \
     --jq '.head.ref')"
   test "$CANARY_BASE" = "$DEFAULT_BRANCH"
   test "${#CANARY_HEAD}" -eq 40
   test "$CANARY_HEAD_REPO" = "$REPO"
   test -n "$CANARY_HEAD_REF"
   ```

3. 优先发送 exact request。这个路径不需要仅为了请求 review 而分配 gate runner：

   ```bash
   REQUEST_COMMENT_ID="$(gh api --hostname github.com \
     --method POST \
     "repos/$REPO/issues/$CANARY_PR/comments" \
     -f body='@codex review' \
     --jq '.id')"
   test -n "$REQUEST_COMMENT_ID"
   ```

   发送前必须证明 `CANARY_HEAD` 上没有已经 active 的 `request_review=true` controller
   `begin-review`，也不存在 matching canonical hidden marker。不得让这个低成本路径与
   controller-owned request 发生 race。

   GitHub 可能把这条单行 direct request 保存为末尾恰好一个 LF 或 CRLF；这两种存储
   形式与精确的 `@codex review` 等价。不得接受或发送其他空白、可见文字或 hidden comment。
   Caller-authored event 会被 pre-runner bot filter 跳过，Codex bot 之后的
   合格 `issue_comment` `created` event 才启动 controller workflow。编辑既有 comment 不会启动它，
   需要重新评估时手动 reconcile。Review 或 reaction 本身没有自动 consumer job。把这个
   direct comment 只当作 candidate，直到 official Codex Bot 在同一条 comment 上直接添加
   严格 post-revision 的 `eyes` 或 `+1` reaction；PR 其他位置的 terminal 不能代替该 receipt。

   ### Dual-protection legacy-status recovery

   手动 v2 `reconcile` 只更新 `codex/github-review-gate`，绝不会写
   `codex/review-gate`。两个 context 仍同时 required 时，只由 review 或 reaction 承载的结果可能需要
   单独恢复 v1。首先只用 REST API 绑定一份完整的 current scope：`GET repos/$REPO` 必须仍返回
   `full_name=$REPO` 与正数 `id`；把该 ID 绑定为 `REPOSITORY_ID`，把它的
   `default_branch` 绑定为 `DEFAULT_BRANCH`，并从对应的
   `GET repos/$REPO/branches/$DEFAULT_BRANCH` 响应绑定 `DEFAULT_BRANCH_HEAD_SHA`。fresh
   `GET repos/$REPO/pulls/$CANARY_PR` 响应必须 open、non-draft、same-repository；其 head
   repository/ref/SHA 必须等于 `$REPO`、`CANARY_HEAD_REF` 与 `CANARY_HEAD`，base
   repository/ref/SHA 必须等于 `$REPO`、`DEFAULT_BRANCH` 与 `DEFAULT_BRANCH_HEAD_SHA`。

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
   canonical JSON（包括 `total_count` 与有序 runs）和捕获的第一页相同。pagination horizon 发生变化会
   使整次 read 无效；应从 scope binding 重新开始，不能混用两个 horizon 的 pages。

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
   `$DEFAULT_BRANCH` 或 `refs/heads/$DEFAULT_BRANCH`，其他 path/ref 一律拒绝。bare form 之所以可接受，
   是因为独立的 PR base repository/ref/SHA、feature-head `head_sha`、active workflow identity 与 exact
   bridge bytes 已补齐 ref binding。

   上述 repository、branch、PR、workflow、canonical bytes 与稳定分页 inventory 合称完整
   **recovery binding set**（candidate selection 以及 write 前后都必须复验的全部状态）。按完整 eligible
   集合的 cardinality 分类：恰好一个 candidate 才可继续，并把它的 `id` 与 `run_attempt` 分别绑定为
   `LEGACY_RUN_ID` 和 `LEGACY_RUN_ATTEMPT`。多于一个即使其中一个更新也仍是 inconclusive，必须 stop，
   不得选择 latest。只有完整稳定读取后的 cardinality zero 才允许下方 draft-to-ready fallback。缺失
   字段、pagination cap、重复 ID、horizon drift 或 scope 无法读取都属于 inconclusive，绝不等于 zero。

   在 write 前一刻，重复读取 repository、default-branch head、PR、active workflow、exact bridge bytes、
   完整 run pagination、duplicate-ID check 与 page-1 horizon reread；要求同一个完整 recovery binding
   set，且唯一 candidate 仍具有相同 `LEGACY_RUN_ID` 与 `LEGACY_RUN_ATTEMPT`。同时完整分页并稳定复读
   `GET repos/$REPO/commits/$CANARY_HEAD/statuses?per_page=100`，拒绝重复 status ID，记录所有 pre-POST
   status IDs 及当前 reverse-chronological 顺序中的第一个 exact-context `codex/review-gate` status。
   这是最终 pre-POST recovery binding-set read。

   只 rerun 这个 exact 已有 bridge run，不得改用其他 v1 workflow。write 前先把
   `LEGACY_RERUN_RECEIPT` 设为 operator 保留的、该 transaction 专用且尚不存在的路径。保留这个
   exact path；不得另选新路径重试 mutation。no-clobber response-file creation 会阻止这个 block 静默覆盖
   先前的 receipt：

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

   GitHub rerun 会保留触发原 run 的 `GITHUB_SHA` 与 `GITHUB_REF`；这正是 source run 必须已经
   绑定 exact feature head、而 embedded PR entry 另行绑定 current default-branch repository/ref/SHA
   的原因。`--include` 会让保留的 response 以 HTTP status line 开头，固定 API-version header 则避免
   API version negotiation 改变该 request。parser 接受 HTTP/1.1、HTTP/2 与 HTTP/3 输出的 status token，
   提取第二个 field，并强制它精确等于 `201`。即使 receipt partial 或 empty，也要把它作为
   inconclusive attempt 的 evidence 保留；它绝不能证明 success。`gh` 非零退出、第一行缺失或
   malformed、非 `201` status，或任何其他 transport uncertainty 都属于 inconclusive：保留 receipt，
   绝不再次提交 POST。POST 只能提交一次。

   POST 后轮询该 exact run ID 直到 terminal，然后重新验证同一个 recovery binding set，并重复完整稳定
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

   未确认 default-`any` ordinary、无 marker request 上，official 直接且严格 post-revision
   的 `eyes` 或 `+1` reaction 首先是 receipt：它把 candidate 升级为 boundary。升级后
   reactions 才只表示 liveness；普通 request 上的 `+1` 不能独立产生 head-bound clean
   evidence。若 official Codex `eyes` reaction 或 progress artifact 的时间与候选 terminal
   clean 相同或更晚，则 veto success。若该 liveness 变化没有伴随后续合格 bot comment event，
   必须手动 dispatch exact-head `reconcile` 才能观察到它。

   在 predecessor-to-successor generation closure 中，与 successor request 同一时间戳的
   liveness 也无法排序，必须保持 predecessor open。原 gap 外的 evidence 不能修补它。
   只有每个歧义 predecessor 都显式绑定另一个 full head 时，新 head 才是有效 reset；若
   未确认 default-`any` ordinary candidate 不是 predecessor。若存在 provider-confirmed
   ordinary、deleted 或其他 unbound predecessor，应新建 replacement PR，并在其中只运行一个
   canonical review generation。

   把每条物理 request（未确认 default-`any` ordinary candidate 除外）都视为 generation
   boundary。没有 base epoch 时，unbound provider terminal evidence 只能闭合第一个 gap；
   只要前面已有物理 request，之后的每个 gap 和 positive/superseding authority 都必须来自
   直接附着在对应 canonical request 上的合格 `+1`。有 base epoch 时，每个 gap 都必须使用
   direct `+1`。绝不能只按 timestamp 把
   later terminal 归给新 generation；它可能是旧 flight 的延迟或重复 carrier。每条可能
   触发 provider 的 request shape 都是物理 boundary，即使它 edited、malformed、
   wrong-author、denied 或 stale-base；这些条件只移除 positive authority，不移除可能的
   provider flight。显式 commit-bound progress 直接归入对应 head；所有 unbound progress
   都保留在 current inventory。edited terminal 还会产生从创建到 terminal revision 的
   unbound unknown-activity interval。provider terminal 只有在 predecessor reactions 已
   完整读取，且从 terminal 到 successor 没有当前 `eyes` 或 provider activity 时，才能
   闭合第一个 gap。

   选择这个低成本路径前，识别 GitHub 记录在 exact current PR feature-head SHA 上的原生
   `codex/github-review-gate` verifier run/job/CheckRun，并要求该 run 绑定 current test-merge。
   Workflow 刻意没有 cron 或可写 review event。若
   当前 exact scope 已有成功 verifier，而 caller 需要 deliberate same-head re-review，
   先执行第 4 步 `begin-review` 并要求严格更新的 verifier attempt。不能依靠 direct
   comment 原子化地使旧 success 失效。

   若 base retarget 后 current exact head/base/test-merge scope 没有 verifier，按
   `create_verifier_run` 恢复：ready PR 先转 draft 再标记 ready；already-draft PR 直接标记
   ready。Reconcile 前必须要求该 exact scope 出现新的 `ready_for_review` verifier；
   rerun 旧 event 不是有效的 retarget recovery。

   如果 controller summary 报告 base epoch、base retarget 或
   `request_clean_generation`，不能仅凭该 code 就发送 request；先读取具体 reason、lineage
   和链接的 request objects：

   - 若已存在可恢复的 latest/current canonical request，只缺少可归因 clean，则留在原 PR
     与 exact head，等待 Codex 直接在 summary 指定的 request 上留下合格 `+1`，再
     reconcile；另发 request 只会增加不必要的物理 boundary。
   - 若 reason 表明不存在合适的 latest/current canonical generation，且没有不可闭合的
     historical unbound predecessor gap，则只执行一次第 4 步并保持
     `request_review=true`；要求生成的 request 上出现合格 direct `+1` 后再 reconcile。
   - 若存在 historical gap，但每个歧义 predecessor 都显式绑定另一个 full head，则创建
     一个有实际意义的新 head，并在其中只运行一个 canonical generation。
   - 若 reason 指出不可闭合的 historical gap，且其中含 provider-confirmed ordinary、edited、
     malformed、denied、deleted 或其他 unbound predecessor，不得在该 PR/head 再发送 direct 或 controller
     request，也不能依赖仅修改 commit 来 reset。应从目标 branch/commits 新建 replacement
     PR，只运行一个 canonical producer；验证通过后关闭旧歧义 PR。

   在这些 mode 中，later terminal clean 不能证明 request/base lineage，不得视为 pass；
   findings 仍始终阻塞。

4. 只有 controller 必须协调 fresh request 和 newer verifier attempt 时，才使用
   `begin-review`。下面的 command block 只用于上述可恢复的原 PR 分支；若存在不可闭合的
   historical unbound predecessor gap，不得对该 PR 执行。运行时不传 `--ref`：

   ```bash
   DISPATCHED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
   gh workflow run codex-review-gate-controller.yml \
     --repo "github.com/$REPO" \
     -f operation=begin-review \
     -f pr_number="$CANARY_PR" \
     -f expected_head_sha="$CANARY_HEAD" \
     -f request_review=true
   ```

   `request_review=true` 是默认值，但 agent 执行时仍显式传入。
   `request_review=false` 是高级 best-effort path。若使用，先等该 controller run 完成，
   再发 fresh direct request。

   同一 head 上绝不重叠 direct 与 controller producers。每条 provider-confirmed request 才会
   开始一个 review generation，而 Codex terminal text 不携带 originating request ID。前一 generation 尚未
   terminal-closed 时出现新 request，v2 会刻意保留 unclosed lineage gap 并让 verifier
   保持 pending；原 predecessor-to-successor window 外到达的 evidence 不能修复已经发生的
   ordering。若每个歧义 predecessor 都 canonical 绑定到另一个 full head，生成一个有实际
   意义的新 head，只允许一个 canonical generation 运行。未确认 default-`any` ordinary candidate
   不是 predecessor。若存在 provider-confirmed ordinary、edited、malformed、denied、deleted 或其他
   unbound predecessor，应从目标 branch/commits 新建 replacement
   PR，只运行一个 canonical generation；验证通过后关闭旧歧义 PR。

5. 每次 dispatch 后只列出 `DISPATCHED_AT` 之后的新 run：

   ```bash
   gh run list \
     --repo "github.com/$REPO" \
     --workflow codex-review-gate-controller.yml \
     --event workflow_dispatch \
     --created ">=$DISPATCHED_AT" \
     --limit 20 \
     --json databaseId,event,headBranch,headSha,status,conclusion,createdAt,url
   ```

   根据时间与 exact PR/head summary 识别刚 dispatch 的 run。并发候选导致身份不明确时
   停止，不得猜测或再次 dispatch。要求 `event=workflow_dispatch` 且
   `headBranch=$DEFAULT_BRANCH`；记录 run ID、URL 与 default-branch `headSha`，拒绝
   feature-ref run。

## 阶段 4：reconcile exact head

1. 刷新 `CANARY_HEAD`。发生变化时先停止，重读 summary 与完整 physical lineage；不得自动在
   同一 PR 启动另一 generation。只有每个歧义 predecessor 都显式绑定不同 full head 时，
   才能在 new head 继续。未确认 default-`any` ordinary candidate 不是 predecessor。若
   provider-confirmed ordinary、edited、malformed、denied、deleted 或其他 unbound predecessor
   留下不可闭合的 historical gap，应按上文改用 replacement PR。
2. 执行 final exact-head reconcile：

   ```bash
   DISPATCHED_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
   gh workflow run codex-review-gate-controller.yml \
     --repo "github.com/$REPO" \
     -f operation=reconcile \
     -f pr_number="$CANARY_PR" \
     -f expected_head_sha="$CANARY_HEAD" \
     -f request_review=false
   ```

   有 direct request ID 时可加
   `-f request_comment_id="$REQUEST_COMMENT_ID"`。它只是定位 hint，不提供 authority。重复
   run readback，证明使用 `DEFAULT_BRANCH`。

3. 等待选中的 run 完成，记录：

   ```text
   execution_health
   gate_outcome
   recovery_code
   retry_safe
   ```

   任何非 success result 都按 `recovery_code` 与 summary 的 concrete next action 操作。
   Finding 通常产生 healthy failure；unhealthy execution 是恢复问题，不是 finding
   verdict。`healthy/pending` 是 fail-closed，不能授权 success。只有 `wait_provider` 是
   纯等待；其他 recovery code 都必须先执行指定动作，再进行后续 exact-head reconcile。
   可推导时，
   `findings_unresolved`、`findings_resolved`、`findings_historical` 与
   `findings_indeterminate` 只出现在 summary/sticky diagnostic。

4. Summary 要求 larger reviewed profile 时，只持久设置受保护的具名 repository profile：

   ```bash
   gh variable set CODEX_REVIEW_GATE_LIMITS_PROFILE \
     --repo "github.com/$REPO" \
     --body expanded
   ```

   随后刷新 `CANARY_HEAD`，并 dispatch 一次 scoped controller reconcile。Manual dispatch
   没有 profile input。不得增加 page/object/attempt/timeout 等 numeric input。

5. `ubuntu-slim` 不可用时，只允许：

   ```bash
   gh variable set CODEX_REVIEW_GATE_USE_UBUNTU_LATEST \
     --repo "github.com/$REPO" \
     --body true
   ```

## 阶段 5：证明 canary、启用保护并清理

1. 重新读取 PR，要求仍 open、non-draft、base 为 `DEFAULT_BRANCH`，head 仍为
   `CANARY_HEAD`。
2. 读取当前 exact test-merge SHA 与 exact feature-head 上的原生 CheckRun：

   ```bash
   DEFAULT_BRANCH_URI="$(jq -rn --arg value "$DEFAULT_BRANCH" '$value | @uri')"
   DEFAULT_BRANCH_HEAD_SHA="$(gh api --hostname github.com \
     "repos/$REPO/branches/$DEFAULT_BRANCH_URI" \
     --jq '.commit.sha')"
   CANARY_TEST_MERGE_SHA="$(gh api --hostname github.com \
     "repos/$REPO/pulls/$CANARY_PR" \
     --jq '.merge_commit_sha')"
   test -n "$DEFAULT_BRANCH_HEAD_SHA"
   test -n "$CANARY_TEST_MERGE_SHA"
   gh api --hostname github.com --paginate --slurp \
     "repos/$REPO/commits/$CANARY_HEAD/check-runs?check_name=codex%2Fgithub-review-gate&filter=latest&per_page=100" \
     --jq '[.[].check_runs[] | {id, status, conclusion, head_sha, app: .app.id, details_url}]'
   ```

   要求 current canonical verifier CheckRun 恰好一个，
   `head_sha=$CANARY_HEAD`、GitHub Actions App ID 为 `15368`、
   `conclusion=success`。canonical `pull_request` verifier 在 `refs/pull/N/merge` 上执行；
   Action 内部严格校验 `GITHUB_REF`、`GITHUB_SHA`、event PR head/base 范围，以及其
   test-merge 与 runtime SHA 相同的 fresh PR read。事件校验仅限 head/base 的 SHA、ref 与
   repository；event `merge_commit_sha` 可以缺失或来自历史快照，明确不作为 binding input。
   要求该 run 的 exact `display_title` 为
   `codex-review-gate-verifier/$CANARY_PR/$CANARY_TEST_MERGE_SHA`，且唯一
   `pull_requests` binding 含 current feature head 与
   `base.sha=$DEFAULT_BRANCH_HEAD_SHA`，且两个嵌套 repository ID 都等于从 `GET repos/$REPO` 获得的
   current repository ID。把该 feature-head CheckRun 绑定到 controller 报告的
   strictly newer verifier attempt，并要求该 attempt 在执行语义上绑定
   `CANARY_TEST_MERGE_SHA`。
   Verifier summary 还必须报告 `execution_health=healthy`、`gate_outcome=success`。当前
   head、base 或 test-merge SHA 任一变化都会使结果失效。

3. 带 canary scope 预览并启用：

   ```bash
   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --repo "$REPO" \
     --control-plane-owner "$CONTROL_PLANE_OWNER" \
     --ruleset-name "$V2_RULESET_NAME" \
     --expected-legacy-inventory-sha256 \
     "${LEGACY_INVENTORY_SHA256}" \
     --activate \
     --canary-pr "$CANARY_PR" \
     --canary-head "$CANARY_HEAD"
   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --repo "$REPO" \
     --control-plane-owner "$CONTROL_PLANE_OWNER" \
     --ruleset-name "$V2_RULESET_NAME" \
     --expected-legacy-inventory-sha256 \
     "${LEGACY_INVENTORY_SHA256}" \
     --apply \
     --activate \
     --canary-pr "$CANARY_PR" \
     --canary-head "$CANARY_HEAD"
   ```

   对于 active ruleset，Helper 必须在 mutation 立即前重读 authority，随后才执行 POST/PUT。
   该重读包括 canary lifecycle、base/head、test-merge SHA、exact feature-head verifier
   run/job/CheckRun、canonical `display_title`、唯一 PR head/base binding（包括 Actions-run
   top-level `run.repository.id`、`run.head_repository.id` 以及嵌套 repository ID 都必须等于 current repository ID）
   与 collision inventory，以及 exact default-branch workflow inventory、
   CODEOWNERS errors 与 owner permission；并在 write 后
   读回 exact ruleset 与完整 consumer security snapshot。要求 active default-branch
   enforcement、
   `codex/github-review-gate`、`integration_id: 15368`、strict up-to-date、all
   Code Owner review、push 后 dismiss stale approvals、新 ruleset 的普通 approving count
   默认为 0 且不降低既有更高 count、
   conversations resolved、default-branch non-fast-forward protection，以及显式空
   bypass actors。

4. 只有第 3 步已证明 exact complete Active v2 ruleset，才从完整 pre-cleanup security
   snapshot 派生唯一可接受的 cleanup state。该 read-only mode 首先要求 current legacy
   inventory 等于原 owner-approved digest。stdout 只含一个 deterministic JSON object；在
   任何 external write 前保存并审阅：

   ```bash
   POST_CLEANUP_PLAN="$(mktemp)"
   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --repo "$REPO" \
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

   这个 legacy cleanup plan 只能删除 `codex/review-gate`。如果这移除了 classic required-status policy 的最后
   item，则该 empty policy 及其 `strict` field 可消失；如果 ruleset status rule 因而变空，
   该 rule 可消失，而 dedicated legacy-only ruleset 只有在不剩其他 rule 时才可整体消失。
   这些是唯一 structural exceptions。必须精确保留 repository/default-head identity、
   workflow/CODEOWNERS inventory、owner permission、surviving classic policy 的全部 fields
   与 non-legacy checks（包括 `strict`/`app_id`），以及每个 retained ruleset 的 identity、
   conditions、bypass actors 与 unrelated rules。任何其他 delta 都不是获授权的 cleanup
   plan。
5. 只可通过适用于该 policy 的、另行授权的 executor 执行已审阅 plan。上方窄范围 source
   exception 中的 source-only executor 不得用于普通 consumer。任何 write 后不得重新派生。
   cleanup 或 readback 失败不构成 disable/rollback v2 的授权：保留 Active v2，只运行
   policy-specific read-only diagnostics，并报告 exact remaining 或 indeterminate surface。
6. 可以使用已记录 ruleset name 与 externally recorded expected-state digest 运行专用只读
   post-cleanup closure，作为 independent evidence 或 recovery diagnosis。它读取两轮完整
   security snapshot；两轮必须相同、都等于 expected digest、两个 legacy surfaces 均 clear，
   并且同一 exact complete v2 ruleset 仍 Active。因此 unrelated-policy change 与
   cross-surface swap 都不能伪造 clear snapshot：

   ```bash
   node "$SOURCE_ROOT/scripts/bootstrap-codex-review-gate.mjs" \
     --repo "$REPO" \
     --control-plane-owner "$CONTROL_PLANE_OWNER" \
     --ruleset-name "$V2_RULESET_NAME" \
     --verify-post-cleanup \
     --expected-post-cleanup-security-sha256 \
     "${EXPECTED_POST_CLEANUP_SECURITY_SHA256}"
   ```

   Inconclusive 时保持 v2 Active，只运行 read-only diagnostics；不得 disable/rollback 以
   制造 closure pass。
7. 关闭 canary、不合并。关闭操作本身不得让 `gh` 删除 branch；先证明 closed PR 仍绑定已
   记录的 head repository、ref 与 OID，再用 atomic exact-OID lease 删除该 remote ref：

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

   Remote OID missing/different、PR head identity 改变或 lease failure 都属于
   inconclusive。Leased push 前发现 mismatch 时 branch 保持不动；post-push read failure
   时 deletion outcome 为 unknown。停止并报告 observed scope；不得改用 unconditional
   ref deletion 重试。

8. 报告 migration PR、closed-unmerged canary PR、两份 canonical workflow paths、active
   ruleset ID、successful canary exact feature head、bound default-branch
   base/test-merge SHA、canonical run-name receipt、verifier run URL 与 final dual-surface
   reviewed cleanup-plan digest、final two-round security closure、legacy inventory
   readback，以及持久 profile、runner 或 request-author-policy variables。

本流程没有 cron recovery loop。Bot event 丢失，或 evidence 只通过 review/reaction 到达
时，对该 PR dispatch 一个 exact-head `reconcile`，并执行它报告的恢复动作。
