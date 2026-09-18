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
- 优先直接发 `@codex review`；只有 request creation 与更新 verifier attempt 需要
  controller 协调时才用 `begin-review`；
- 每个 exact-head review generation 只选择一个 request producer。只有该 head 上没有
  `request_review=true` 的 active controller `begin-review` 时，才优先 direct request。
  一旦该 run 已 dispatch、正在启动或已经发出 hidden marker，就不得再手动发送 direct
  `@codex review`。不确定 producer ownership 时，先读取 controller run、canonical marker、
  sticky diagnostic 与 provider evidence，再决定是否 mutation；
- limit profile 只允许通过 protected repository variable
  `CODEX_REVIEW_GATE_LIMITS_PROFILE` 选择 `default` 与 `expanded`，不得增加 dispatch
  或 numeric override；
- `CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION` 是 protected wrapper configuration：
  只有 exact `any` 覆盖默认 `write`，绝不把它新增为 Action input。
- 每次调用 bootstrap 都显式保留同一个 `CONTROL_PLANE_OWNER`。默认值是
  `@JoeyTeng`；非 Joey 仓库必须替换成自己的合格 GitHub user。

## Advanced：受控的 11 仓 organization handoff

只有当授权 scope 精确等于一个经过审阅、受共享 v1 organization ruleset 保护的 11 仓
cohort 时，才使用本执行路径。它不是可复用的 `allow-v1` 开关。下方普通 phases 仍拒绝
所有 v1 caller；advanced path 最终也必须让每个成员回到同一个 no-v1 contract。

增加以下 cohort inputs：

```text
HANDOFF_MANIFEST = reviewed JSON 的绝对路径
HANDOFF_SCHEMA = organization-review-gate-handoff-manifest/v1
V2_ORGANIZATION_RULESET_NAME = Must Pass Codex Review v2
COHORT_REPOSITORY_V2_RULESET_NAME = Must Pass Codex Review v2
```

Manifest 必须绑定 exact organization ID/node ID、旧 organization ruleset 的完整
snapshot、新 rule 的 name/ID、精确且有序的 11 个 repository slugs/numeric IDs/node IDs/
default branches、verifier/controller/temporary bridge 的 Git blob SHA 与 SHA-256、
effective CODEOWNERS identity、每个完整 Active repository v2 ruleset，以及全部 repository
legacy-cleanup before/after actions。每个 canary 必须把 exact open、non-draft、
same-repository PR 绑定到 current head/base/test-merge SHAs、v2 CheckRun/run/workflow/
attempt/job IDs，以及最新 successful legacy commit-status ID。任意字段不完整、member-set
不同、identity drift 或 unsupported surface 都必须停止。

按同目录 README 实例化
`templates/organization-review-gate-handoff/joey-tools-11-member-manifest.template.json`。
每个显式 placeholder 都必须来自 authoritative live evidence；不得合成缺失 ID 或 digest。
`stage` 之前唯一允许的不完整值，是 `v2_ruleset.id` 的 JSON literal `null`，因为 organization
v2 ruleset 此时尚不存在。其他 placeholder 或 incomplete field 必须 validation failure。
`stage` readback 成功后，只能使用 `next_manifest_update.v2_ruleset.id` 替换这个 `null`，
review 完整 manifest，并重新运行 `plan`。

因为 ambiguous POST 可能需要 no-receipt adoption，stage preview 前必须建立外部
organization-admin policy-mutation freeze，并保持到 apply、readback 与任何 recovery 完成。
Shared-rule activation 再建立一次 organization/repository admin freeze，从 preview 保持到
stable post-write readback。Repository-cleanup preview 前第三次建立 freeze，并连续保持到
完整 cleanup batch/readback、最终旧规则 preview/apply，以及另一次最终只读 verify receipt
capture/validation 全部完成。
这些 freeze 期间任何管理员都不得修改 organization/repository ruleset、classic branch
protection、condition、required check 或 bypass actor。第三次 freeze 期间还禁止任何 cohort
repository 被 rename、transfer、delete、改变 default branch，或在原 slug 被 replace/
re-create。这些是运营冻结，不是持续 API 锁。GitHub ruleset endpoint 没有 documented
conditional/CAS update，cleanup mutation API 也没有 repository-ID conditional/CAS write；
plan digest 与紧邻重读可以拒绝已观察到的 drift，却无法阻止最后 GET→PUT 或 repository
metadata read→write 区间的 racing write，这些区间由 freeze 覆盖。只能验证 manifest 绑定的
bypass actors，绝不能声称 runtime 会自动发现 snapshot 外新增的 actor。

严格按下列 state machine 执行：

1. 对每个 member，用 exact bridge profile 替换普通阶段 1 的 bootstrap calls：

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
   Code Owner review boundary 合并。

   Bridge 的可写 event envelope 是封闭的：只有 `pull_request_target` 的 `opened`、`reopened`、
   `synchronize`、`ready_for_review`，以及 `issue_comment` 的 `created`。它刻意排除
   `pull_request_review`：GitHub 会将该 workflow 绑定到 PR merge ref，而兼容 publisher 的
   `issues: write` authority 不能安全地在该 ref 执行。不得在 consumer repository 局部加回
   review trigger。temporary bridge 仍只是 compatibility status publisher；v2 manual reconcile
   不能刷新它的 v1 status。dual protection 仍生效时所需的 exact-run recovery 见阶段 3。
2. Reviewed repository ruleset name 精确为 `Must Pass Codex Review v2`，不是普通默认值
   `Must Pass Codex Review`。每个 member 只能沿用普通 runbook 的 canonical-file controls
   与阶段 2 Disabled repository-policy staging。每条 repository bootstrap preview/apply 都
   必须同时传入 `--ruleset-name "$COHORT_REPOSITORY_V2_RULESET_NAME"` 与
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
   GitHub Actions integration 为 `15368`，conditions 精确绑定 cohort/default branch，且
   bypass list 显式为空。不得从旧 organization rule 复制 `deletion`、
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
5. Preview 并 activate 新 organization rule：

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

   写入前 helper 必须证明 11 个 exact repository identities、三份 exact workflows、完整
   effective CODEOWNERS identities、Active repository v2 rulesets、open/non-draft/current-
   base canaries、exact v2 run/job receipts、latest successful legacy commit statuses、未变化
   的 repository legacy surfaces 与 exact old organization rule。成功 readback 才是双重
   保护 handoff point：shared v2 Active，同时 shared v1 仍 Active。

   只有 activation apply 返回成功的 post-write dual-enforcement readback 后，才可关闭且不
   合并每个 canary；`activate` 完成前绝不可关闭。之后的 `derive-cutover`、
   `apply-repository-cleanup` 与 `verify` 使用 post-activation cohort snapshots，不要求重新
   打开这些 PR，也不要求当前 default-branch head 等于历史 canary base。Canary receipt 只
   属于 activation-bound evidence；后续每轮都
   读取实时 default branch 并验证当前 control-plane/ruleset closure：exact repository
   identity、只含三份 canonical workflows 且没有额外 producer 的完整 regular-blob
   workflow inventory、exact CODEOWNERS、包含明确 boolean
   `can_approve_pull_request_reviews` 的 default-read Actions policy、Active repository/
   organization v2 rules、temporary bridge 与 cleanup state。
6. 只读推导 cutover transaction：

   ```bash
   HANDOFF_CUTOVER_PLAN="$(mktemp)"
   node "$SOURCE_ROOT/scripts/organization-review-gate-handoff.mjs" \
     --manifest "$HANDOFF_MANIFEST" \
     --mode derive-cutover > "$HANDOFF_CUTOVER_PLAN"
   jq . "$HANDOFF_CUTOVER_PLAN"
   ```

   审阅 manifest-bound `external_repository_actions`。每个 action 只可移除
   `codex/review-gate`；所有 non-legacy checks/strictness、ruleset identity/targets、bypass
   actors、`deletion`、`non_fast_forward` 与 unrelated rules 必须保留。不得手工执行 raw
   actions。开始连续覆盖 cleanup 至 final verify 的外部 policy-mutation freeze，再通过受控
   executor 先 preview 后执行：

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
   `verify`，除已列出的 policy mutations 外，还必须禁止 cohort repository rename、
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
7. Preview 并执行最终 organization cutover：

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

   `verify --apply` 是唯一可修改旧 organization ruleset 的 helper operation。它移除完整的
   legacy-only required-status rule；旧 ruleset 的 ID、name、conditions、enforcement、
   bypass actors、`deletion`、`non_fast_forward` 与其他所有 fields 必须保留。绝不删除旧
   ruleset。因为 mutating command 的 `applied-final-verified` boundary 之后 control plane
   仍可能 drift，外部 policy-mutation freeze 必须越过 apply/readback，一直保持到另一次最终
   只读 `verify` 完成。只接受顶层为
   `schema_version: "organization-review-gate-handoff-output/v1"`、`mode: "verify"`、
   `status: "final-verified"`、`applied: false`、`action: null`，并包含
   `final_closure_receipt.schema_version: 1` 与 lowercase 64-hex
   `final_closure_receipt_sha256` 的输出。Embedded receipt 必须绑定 organization、reviewed
manifest digest、final snapshot digest、legacy/v2 ruleset IDs/states 与按 canonical UTF-8 byte `full_name`
order 排列的 exact repository cohort：只能是固定、完整的 11 仓 cohort，不能是任意子集或扩大的 cohort。
top-level `plan_sha256` 必须精确绑定最终只读 `verify` plan（`mode`、manifest digest、snapshot
digest 与 `action: null`）。必须完整保留 `HANDOFF_FINAL_VERIFY` 中的 JSON output；单独提取
embedded receipt 不能作为 bootstrap 输入。

   只有该文件及 top-level shape 验证完成后，第三段 freeze 才结束。若本次读取 inconclusive
   或任何 bound policy 不一致，保留所有 bridges，修复 drift，并在 freeze 下重复最终只读
   verify。若 capture 之后到 removal preparation 之前发生了已知 organization/repository
   policy mutation，则丢弃旧 proof，在新的 freeze 下生成 fresh final read-only output；绝不
   用 `verify --apply` response 代替，也不复用已知 stale receipt。
8. 只有步骤 7 成功 closure 后，每个 member 才从 clean worktree 另开 bridge-removal PR：

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
`default_branch` 都和固定 11 仓 receipt cohort 中的一项精确相等。在 atomic bridge quarantine
rename 前的边界，它会先在 live-metadata query 前后各读取一次 `origin`，重新验证本地对象后，
再紧邻 rename 读取一次 `origin`。Rename 后、unlink 前，它会再次执行完整的 `origin` ->
live metadata identity/default-branch -> `origin` 检查，并重新验证 quarantine 中 admitted
file 的 object identity 与 canonical content。若该 remote binding check 失败，它会通过
no-clobber hard-link creation 尝试把同一 admitted bridge 恢复到 canonical path；若目标路径
已被占用或恢复后的验证失败，则 fail closed、绝不覆盖占用者，也不报告删除成功。这些是
point-in-time 的 remote binding 与 local identity/content checks，并非连续锁。不得编辑
receipt、切换 `origin` 或绕过这份 proof。

   Bridge absent 时，bridge-removal component 是 idempotent no-op；已有但 non-canonical
   的 bridge 会被拒绝。整个 command 也会强制 canonical verifier、controller 与 managed
   CODEOWNERS block；即使 bridge 已经 absent，`--apply` 仍会修复这些 surfaces 的 drift。
   Apply 前必须独立验证它们并检查 dry run；若提出 bridge removal 之外的变更，必须停止并
   处理或单独 review drift，不能把改动当作 bridge-only PR。合并后运行不带
   `--legacy-bridge` 的普通 bootstrap 与 inventory checks；任何残留 v1 caller 都是
   failure。

每个 authoritative helper success boundary 先读取一份完整 snapshot，等待 5 秒，再读一
份。Selected evidence 或 policy 不同就重新开始这一对读取；60 秒内始终得不到相同的一对，
结论就是 inconclusive，不允许下一次 write。除非变化后的 state 已重新 review，不得用新
推导的 apply digest 重试；恢复时绝不能 disable v2 或删除旧 organization rule。

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
  name `Codex Review Gate Controller`、exact Codex `issue_comment`
  `created`/`edited`，以及 default-branch `workflow_dispatch`。它刻意排除
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

Wrapper 把 protected repository variable
`CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION` 映射到 Action environment。Exact `any`
允许任意 permission 的普通 request author；其他值要求 `write`、`maintain` 或 `admin`。
它只影响 ordinary request 是否能建立 generation，不会让合格 finding 失去阻塞效力。

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
   合格 `issue_comment` `created` 或 `edited` event 才启动 controller workflow。Review 或
   reaction 本身没有自动 consumer job，需要时手动 reconcile。

   ### Dual-protection legacy-status recovery

   手动 v2 `reconcile` 只更新 `codex/github-review-gate`，绝不会写
   `codex/review-gate`。两个 context 仍同时 required 时，只由 review 或 reaction 承载的结果可能需要
   单独恢复 v1。首先只用 REST API 绑定一份完整的 current scope：`GET repos/$REPO` 必须仍返回
   `full_name=$REPO`；把它的 `default_branch` 绑定为 `DEFAULT_BRANCH`，并从对应的
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
   `repository.full_name` 与 `head_repository.full_name` 都等于 `$REPO`；
   `event=pull_request_target`；`head_sha=CANARY_HEAD`；且恰好一个 `pull_requests` entry 的 number、
   head repository/ref/SHA、base repository/ref/SHA 都等于完整已绑定 PR scope。matching nonterminal run
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

   只 rerun 这个 exact 已有 bridge run，不得改用其他 v1 workflow：

   ```bash
   gh api --hostname github.com \
     --method POST \
     "repos/$REPO/actions/runs/$LEGACY_RUN_ID/rerun"
   ```

   GitHub rerun 会保留触发原 run 的 `GITHUB_SHA` 与 `GITHUB_REF`；这正是 source run 必须已经
   绑定 exact feature head、而 embedded PR entry 另行绑定 current default-branch repository/ref/SHA
   的原因。POST 只能提交一次；HTTP 或 transport 结果若不能证明公开的 `201` response，则属于
   inconclusive，不得 replay。

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

   Authorized ordinary、无 marker request 上的 reactions 只表示 liveness；普通 request 上
   的 `+1` 不能独立产生 head-bound clean evidence。若 official Codex `eyes` reaction 或
   progress artifact 的时间与候选 terminal clean 相同或更晚，则 veto success。若该 liveness
   变化没有伴随后续合格 bot comment event，必须手动 dispatch exact-head `reconcile` 才能
   观察到它。

   在 predecessor-to-successor generation closure 中，与 successor request 同一时间戳的
   liveness 也无法排序，必须保持 predecessor open。原 gap 外的 evidence 不能修补它。
   只有每个歧义 predecessor 都显式绑定另一个 full head 时，新 head 才是有效 reset；若
   存在 ordinary、deleted 或其他 unbound predecessor，应新建 replacement PR，并在其中
   只运行一个 canonical review generation。

   把每条物理 request 都视为 generation boundary。没有 base epoch 时，unbound provider
   terminal evidence 只能闭合第一个 gap；只要前面已有物理 request，之后的每个 gap 和
   positive/superseding authority 都必须来自直接附着在对应 canonical request 上的合格
   `+1`。有 base epoch 时，每个 gap 都必须使用 direct `+1`。绝不能只按 timestamp 把
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
   - 若 reason 指出不可闭合的 historical gap，且其中含 ordinary、edited、malformed、
     denied、deleted 或其他 unbound predecessor，不得在该 PR/head 再发送 direct 或 controller
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

   同一 head 上绝不重叠 direct 与 controller producers。每条 request 都会开始一个 review
   generation，而 Codex terminal text 不携带 originating request ID。前一 generation 尚未
   terminal-closed 时出现新 request，v2 会刻意保留 unclosed lineage gap 并让 verifier
   保持 pending；原 predecessor-to-successor window 外到达的 evidence 不能修复已经发生的
   ordering。若每个歧义 predecessor 都 canonical 绑定到另一个 full head，生成一个有实际
   意义的新 head，只允许一个 canonical generation 运行。若存在 ordinary、edited、
   malformed、denied、deleted 或其他 unbound predecessor，应从目标 branch/commits 新建 replacement
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
   才能在 new head 继续。若 ordinary、edited、malformed、denied、deleted 或其他 unbound
   predecessor 留下不可闭合的 historical gap，应按上文改用 replacement PR。
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
   `base.sha=$DEFAULT_BRANCH_HEAD_SHA`。把该 feature-head CheckRun 绑定到 controller 报告的
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
   run/job/CheckRun、canonical `display_title`、唯一 PR head/base binding
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

   Plan 只能删除 `codex/review-gate`。如果这移除了 classic required-status policy 的最后
   item，则该 empty policy 及其 `strict` field 可消失；如果 ruleset status rule 因而变空，
   该 rule 可消失，而 dedicated legacy-only ruleset 只有在不剩其他 rule 时才可整体消失。
   这些是唯一 structural exceptions。必须精确保留 repository/default-head identity、
   workflow/CODEOWNERS inventory、owner permission、surviving classic policy 的全部 fields
   与 non-legacy checks（包括 `strict`/`app_id`），以及每个 retained ruleset 的 identity、
   conditions、bypass actors 与 unrelated rules。任何其他 delta 都不是获授权的 cleanup
   plan。
5. 只执行该已审阅 plan，作为另行授权的 legacy cleanup；write 后不得重新派生。
   Cleanup 或 readback 失败不能成为 disable/rollback v2 的理由；保留 complete Active v2
   gate，只运行 read-only diagnostics，并报告 exact remaining 或 indeterminate surface。
6. 使用已记录 ruleset name 与 externally recorded expected-state digest 运行专用只读
   post-cleanup closure。它读取两轮完整 security snapshot；两轮必须相同、都等于 expected
   digest、两个 legacy surfaces 均 clear，并且同一 exact complete v2 ruleset 仍 Active。
   因此 unrelated-policy change 与 cross-surface swap 都不能伪造 clear snapshot：

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
