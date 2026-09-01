# Action 发布 publisher

本文档是 action v2 及后续版本的 canonical 发布合约。Source 与发布仓库固定为：

```text
source:  Joey-Tools/codex-review-gate
target:  JoeyTeng/codex-review-gate-action
```

Target 是既有 action 与 Marketplace 仓库；它保留 v1 历史和 selectors，同时接收
v2 及后续 release。已放弃的 `Joey-Tools/codex-review-gate-action` target 不属于本
合约。

本合约描述预期 publisher；它不声称当前已经存在 release intent，也不声称 release、
测试、Marketplace 更新或 production 安装已经完成。完整的已确认设计与理由记录在
[`docs/project_journal/2026/08/2026-08-25-action-v2-grilling-plan-019ff4f8.md`](project_journal/2026/08/2026-08-25-action-v2-grilling-plan-019ff4f8.md)。

## 交付顺序

Publisher infrastructure 与 release intent 必须通过不同变更落地：

1. 先合入并验证 publisher workflow、scripts、tests、documentation、repository
   rulesets、Environment、App installation 与 signing setup。
2. 之后通过另一个经过 review 的 PR，为一个 exact SemVer 新增或修改
   `release-manifest.json`。
3. Release-intent PR 进入受保护的 source `master` 后，运行 staged publisher，且只
   对 privileged `publish` job 做人工批准。

当前 infrastructure delivery 仅属于第 1 步：它不携带 release intent、不应触发
publication，也不表示任何 tag、GitHub Release、floating alias、Marketplace version
或 consumer installation 已经存在。Release-intent 变更不得同时修改 publisher
workflow/scripts 或其 control tests。这个拆分防止新引入的 privileged code 立即取得
production credentials 并发布自身。

## Release intent

在后续 release-intent PR 中出现时，`release-manifest.json` 才是 committed release
intent。每个 release PR 更新其中的 `version` 及 policy-bound release metadata；该
已 review 变更进入 source `master` 后，normal publisher 才启动。Workflow 从 SemVer 自动推导 immutable full
tag、prerelease/stable 状态、Release version，以及只供 stable release 使用的
floating major alias（例如 `v2`）。

不存在 `publish_v2` flag，也不接受人工提供的 version。未来 v3 及后续版本使用同一
规则。Recovery `workflow_dispatch` 可以选择需要 reconcile 的 exact committed
source SHA，但 version 仍必须来自该 SHA 中的 manifest。这个 SHA 是 recovery
binding，不是公开 consumer selector。

Publisher workflow 是 `.github/workflows/sync-action-subtree.yml`。Normal trigger
是改变 `release-manifest.json` 的 source `master` push。Recovery
`workflow_dispatch` 精确要求三个 inputs：

- `source_sha`：引入目标 manifest 的 exact lowercase 40-hex commit；
- `admission_run_id`：原始 admitted `master` push 的 positive Actions run ID；
- `admission_run_attempt`：持久化 admission plan 的 exact positive successful planning
  attempt。

Source checkout 前，dispatch 先通过 exact run-attempt 与 artifact REST identities，要求
原事件为 push、head branch/source SHA、workflow path 与 attempt 都精确匹配。随后要求该
run 恰有一个未过期的 `release-plan-<attempt>.json` artifact，且 server 返回 positive
artifact ID 与 `sha256:<64hex>` digest；workflow 按该 ID/run 下载，并要求 downloaded
file 匹配 REST digest。Publisher 最后还会从 Git 重新计算原 admission 与 plan，要求与
persisted JSON 完全一致。Identity、digest、manifest、history 或 Git recomputation 任一
缺失或不匹配都会在 publication 前拒绝。Dispatch 不能只从 `source_sha` 推断 admission、
自由重建 rejected admission，也不能替换成其他 run/attempt/artifact。

Dispatch 始终执行触发时 `github.sha` 所记录的 live source `master` workflow 与
publisher controls；绝不把旧 commit checkout 成可执行 release control。所选
`source_sha` 必须是 linear ancestor 上实际修改 `release-manifest.json` 的 commit。
该 source 冻结 release manifest 和完整 `packages/action` payload/tree。Recovery 必须先
按上述流程认证 persisted original push admission；旧 source commit 中的 publisher
controls 不必与 current controls 相同。只有 admission binding 成功后，本次 attempt 才
使用当前受保护 source `master` 的 control commit，重新生成绑定该 current control
inventory 的 plan、deterministic candidates A/B、publication plan，并重新取得
Environment approval。若 source `master` 或这些 controls 在本次 plan 创建后发生
变化，publication 会在 App token 签发和任何 durable mutation 之前 fail closed，且
必须重新 materialize 并批准。更晚 release intent 不得 leapfrog 较旧的 partial
release；较旧 source 只能 reconcile 并恢复其 exact canonical prefix。Recovery 绝不
接受 mismatched frozen payload 或 remote publication state。

Manifest 还绑定 source path、target repository/branch 与预期 signing identity。
Publisher 在任何写入前都会用 release policy 和当前 remote state 验证 manifest。
不得通过编辑 baseline 来认可意外 remote drift。

Frozen v2.0 release line 记录
`release_contract=codex-review-gate-action-v2.0-contract-v1`。Plan、candidate、
publication-plan 与 published provenance schemas 依次是
`codex-review-gate-action-release-plan-v2`、
`codex-review-gate-action-candidate-v2`、
`codex-review-gate-action-publication-plan-v2` 与
`codex-review-gate-action-release-provenance-v2`，schema version 都是 2。Published
provenance 会选择这套 frozen contract 执行 historical verification；publisher 后续演进
不得用 newer schema 重新解释 v2.0 artifacts。

## Workflow stages 与权限边界

专用 publisher 在 source repository 中运行，包含以下 logical stages：

| Stage | 权限 | 合约 |
| --- | --- | --- |
| `plan` | 无特权 | 检查 exact source commit、manifest、SemVer、reachability、release policy 与 immutable target-parent policy。 |
| `candidate-a` | 无特权 | 在 clean runner 独立 materialize 并上传 candidate A，记录 tree、inventory、modes、sizes 与 SHA-256 digests。 |
| `candidate-b` | 无特权 | 在另一个 clean runner 独立 materialize 并上传 candidate B。 |
| `source-validation` | 无特权 | 两份 candidate 冻结后，在五个 clean runners 上用一个 core cell 和四个 Release-test shards 验证 exact source commit。 |
| `assemble` | 无特权 | 要求两份 candidates byte-identical，并产出 canonical candidate bundle。 |
| `publication-plan` | 无特权 | 批准前重建并验证 publication plan 与 candidate，不上传任何 privileged material。 |
| `publish` | 有特权 | Environment 人工批准后重新验证全部状态并执行 signed remote publication。 |
| `verify` | 无特权 | 重新读取公开 refs 与 Release state，并报告观察结果。 |

轻量的无特权 `plan`、`candidate-a`、`candidate-b`、`assemble`、
`publication-plan` 与 `verify` jobs 使用 `ubuntu-slim` 与 14 分钟 timeout。
GitHub 对这个单核 runner 另有 15 分钟硬上限，所以 exact-source tests 在
`source-validation` matrix 的五个 `ubuntu-24.04` runners 上运行：一个 core cell 和
四个 Release-test shards，每个 cell 的 timeout 都是 14 分钟，并设置
`fail-fast: false`。这替代了首次 live RC 中两次各自超过 17 分钟的串行完整套件验证，
同时保留独立 candidate construction。privileged `publish` job 继续使用
`ubuntu-24.04` 与既有 30 分钟 timeout。

只有 `publish` 绑定 `marketplace-production` Environment。尽管保留了历史名称，它
实际代表 production publication credentials 与人工批准边界，并不表示 workflow 会
发布或验证 Marketplace。初始 policy 要求 reviewer `JoeyTeng`、保持 **Prevent
self-review** disabled、禁用 administrator bypass、只允许 source branch `master`，且
approval 最多 pending 30 天。在批准前：

- publisher App token 与 signing key 都不可用；
- 任何 job 都不能写 target repository 或 GitHub Release；
- candidate artifact 不含 credential 或 signing-key material。

Artifacts 只是 jobs 之间的 transport，不是 ledger，也不是权威发布证据。`plan`
artifact 保留 90 天；candidate A/B artifacts（`candidate-a` 和 `candidate-b`）保留 1
天。Assembled canonical candidate 与 publication plan artifacts 各保留 35 天，覆盖
Environment 最长 30 天的 approval wait。它们是 `publish` 需要的两份 frozen inputs。
原 push run 的 90-day plan 同时是 exact dispatch recovery 使用的 bounded persisted
admission；不存在单独名为或被分类为 admission artifact 的 artifact。只有 exact
run/attempt/artifact REST binding、downloaded-byte SHA-256 verification 与 Git
recomputation 都成功时才接受它，不能只信任 artifact display name。权威状态仍是
committed manifest 与重新读取的 Git/Release state。

等待 Required reviewer 批准期间，GitHub 不会为受保护 job 分配 runner，该等待也不
消耗 billable runner time。平台上限是 30 天，并非无限等待。若批准被拒绝、取消或
过期，任何 privileged step 都尚未运行。只要原 90-day push-plan artifact 仍可用，就可
携带其 exact `source_sha`、`admission_run_id` 与 `admission_run_attempt` dispatch，认证该
admission、在届时当前受保护 controls 下重新 materialize，并申请新的批准。只有新 plan
创建后的 drift 才会使该 attempt 失效。一旦原 admission plan 过期或不可用，recovery
fail closed，必须创建新的 reviewed release intent；workflow 不承诺无限 replay。批准后
privileged runner 的 timeout 是 30 分钟；Environment 等待发生在该 runner time
分配之前。

## Publisher identities 与 secrets

唯一 remote writer 是 private GitHub App：

```text
JoeyTeng/codex-review-gate-action-publisher
App ID:          4700530
Client ID:       Iv23liW83xfaR85dKJD3
installation ID: 156186692
```

它只安装在 `JoeyTeng/codex-review-gate-action`。签发 credential 前，privileged job
先 checkout 受保护的 source control、下载并安全解包 assembled artifact，并重复 exact
admission validation；之后才使用 allowlisted 官方
`actions/create-github-app-token@v3` Action 即时签发 installation token。请求只点名
target repository，并明确把 token 收紧为 Administration read 与 Contents write。
Trusted source-repository generator 是 private key 唯一的另一个 consumer：它只为
`GET /app/installations/{installation_id}` 在内存生成 RS256 App JWT，其中
`iat = now - 60`、`exp = now + 540`，`iss` 等于配置的 App client ID。该 JWT 绝不
写入 file、`GITHUB_ENV`、artifact、output、summary 或 log。独立的 installation
token 读取 `GET /installation/repositories`，绑定 expected App identity 与 sole target
repository，并且是唯一暴露给 Git 的 credential。它不得跨 jobs 传递、嵌入 remote
URL、存入 artifact 或打印。Checkout 使用 `persist-credentials: false`。Git 只通过
owner-private 的临时 `GIT_ASKPASS` helper 取得该 token，并且 helper 只作用于 exact
target repository。Post step 撤销 token 是 best effort；若 runner 被强制终止，token
expiry 是剩余边界。

Publisher workflow 中每个 `uses:` dependency 都必须是 allowlisted GitHub-official
Action，并使用 floating major（例如 `@v4`），绝不使用 `@main`。我们明确接受
patch-level upstream drift，以便自动取得官方修复。若未来改成 immutable SHA pins，
则必须在 `Joey-Tools/codex-review-gate` 配置 Dependabot，避免漏掉重要更新。Major
alias 升级仍需普通 reviewed infrastructure PR，且不得与 release-intent 变更同时落地。

Installed App 授予隐含的 `Metadata: read`、`Contents: read/write` 与
`Administration: read`。Publisher 为其 one-repository installation token 只请求
Administration read 与 Contents write；它不需要 Workflows write。

`marketplace-production` Environment 提供：

```text
RELEASE_PUBLISHER_APP_OWNER=JoeyTeng
RELEASE_PUBLISHER_APP_SLUG=codex-review-gate-action-publisher
RELEASE_PUBLISHER_APP_CLIENT_ID=Iv23liW83xfaR85dKJD3
RELEASE_PUBLISHER_APP_PRIVATE_KEY=<environment secret>
```

Private key 只在 credential-free admission 成功后的 privileged `publish` job 内存在。
它会提供给 official token Action 以签发 installation token；另一次、也是唯一额外
用途，是直接提供给 trusted generator，在内存构造上述短期 JWT 来读取 App
installation identity。Private key 绝不持久化，也绝不通过 `GITHUB_ENV`、artifact、
output、summary 或 log 暴露。

Publication commits、immutable tags 与 floating aliases 使用专用
`JoeyTeng-Codex <codex@mahane.me>` key 签名：

```text
primary fingerprint: AD403DAB5377F9FA0F7D775EC2844D3367B8A71B
signing subkey:       4DD48552DDEAF6D961769DD4A49827EC48984E2C
secret:               RELEASE_SIGNING_GPG_PRIVATE_SUBKEY
```

Secret 只包含 signing subkey material，不包含 unrestricted primary secret key。
它没有 passphrase，因此 `RELEASE_SIGNING_GPG_PASSPHRASE` 应保持不存在，而不是配置
为空 secret。 `publish` 将其导入 owner-private 临时 `GNUPGHOME`，要求 pinned
primary/signing fingerprints，执行固定 sign/verify probe，并在结束后销毁 keyring。
公开 encryption-only subkey metadata 无害；额外可用的 secret signing、encryption
或 authentication subkey 会被拒绝。

Current signer inventory 是 live access-policy 与 content boundary。它绑定 pinned
primary fingerprint、pinned signing-subkey fingerprint 与 exact raw public
certificate，但刻意不绑定 GitHub GPG-key REST object ID。每个 durable
mutation fence 都必须重新读取并验证这组 live primary/subkey/certificate，
尤其是最终 immutable Release publication fence。既有 commit 或 tag 的 GitHub
persistent verification result 只能证明该 object 的 signature state；它不能
替代 pinned signer 仍存在于 current account inventory 的证明。

显式的 `--test-enforce-live-signer-policy` seam 只供测试，并受双重
environment gate 约束：必须同时存在
`CODEX_REVIEW_GATE_RELEASE_PROVENANCE_TEST_ONLY=1` 与 `NODE_ENV=test`。它还只能与
`--publish` 以及 production-shaped GitHub Release path 组合；若同时使用 filesystem
`--test-release-dir` path，则直接拒绝。启用后，test path 会执行真实的 GitHub
inventory validator，并在 production fences 把它导出的 raw certificate 与 approved
certificate 逐字节比较。Production 不存在 signer-policy skip path。

首次写入前，just-in-time token 必须证明属于 expected Publisher App installation 与
唯一 target repository；target rulesets 随后只把该 App 作为 publication bypass
identity。GPG identity 是写入 publication Git objects 的 author、committer 与 signer，
其 signatures 在发布后仍可独立验证。

不得过度解读之后的 GitHub state checks：ref、commit、signature 与 Release readback
可以证明最终 objects 与当前 repository state，但 GitHub 不提供可证明某个已接受 ref
update 当时由哪个 token push 的 immutable historical receipt。因此 post-write
verification 不得声称重建了历史 Publisher App pusher attribution。

## Target rulesets

Repository rules 提供两个不同性质，不能合并成一套可被整体 bypass 的 ruleset：

1. `publisher-master-update` 限制 `refs/heads/master` updates，只给 Publisher
   App `always` bypass。它回答“谁可以发布”。
2. `master-integrity` 要求 signed commits 与 linear history，阻止 force pushes
   并限制 deletion，且没有 bypass actor。它回答“包括 Publisher App 在内的发布者
   可以发布什么”。

当前已验证的 rule IDs 是：`publisher-master-update` 为 `16454474`，
`master-integrity` 为 `21461558`。这些 ID 只属于 read-back evidence，不能替代对
各规则 name、target、enforcement state、rules 与 bypass actors 的验证。

Tag protection 使用两套互不重叠的 rulesets：

1. `freeze-v1-tags` 覆盖 `refs/tags/v1` 与 `refs/tags/v1.*`，没有 bypass actor，
   因而 v1 tags 的冻结不依赖 publisher code。
2. `publisher-v2-plus-tags` 覆盖 `refs/tags/v*`，但排除上述两类 v1 patterns；只有
   Publisher App 获得 `always` bypass，用于创建 signed immutable full tags 与推进
   signed major aliases。

两套 rulesets 都会按各自职责限制 create、update 与 delete，并阻止未授权 force
updates。Publisher 在首次 target write 前还会 fail closed：任何 invocation 都不得
修改 v1 tag、v1 GitHub Release 或其 asset。Ruleset IDs 仅是 informational
read-back evidence；publisher 必须验证 name、target、enforcement、ref conditions、
rules 与 bypass actors。

Repository administrators 仍能编辑 rulesets；这种 configuration-control authority
不能由 repository-hosted workflow 消除。因此 `publish` 在获批后、首次写入前还会
重新读取 exact named rules、ref conditions、enforcement state 与 bypass actors。

## Candidate 与 signed release commit

`candidate-a` 和 `candidate-b` 从同一个 exact source commit 开始，但彼此独立运行。
每个 job 在单独的 clean runner 上 materialize、pack 并 upload candidate。只有两次
upload 都成功后，`source-validation` matrix 才会在另外五个 clean runners 上创建
detached exact-source worktrees。Core cell 运行 `npm run check` 与所有非 Release tests；
四个 Release cells 分割完整 Release-pipeline inventory。Matrix 保留所有 cell 结果，
而 `assemble` 依赖整个 matrix，因此任一 cell 失败或缺失都会阻止发布。Validation jobs
不下载 candidate artifacts，所以 source test 无法修改已经上传的 candidate。两份独立
builder 与之后的 byte-identical comparison 继续保证 candidate independence。每份
candidate 都产出 canonical inventory 与 digests。Inventory 按 Git path bytes 排序，记录每个 entry 的 type、Git
mode、logical size 与 SHA-256 content digest。只允许明确列出的
`src/v2/gate-runtime.mjs` v2 runtime module；任何 retired v2 module 回流都会阻止
candidate construction。`assemble` 要求两份 payloads 与所有 identity
records byte-identical，然后分别从 frozen manifest/source payload 与本次 attempt 的
current-control inventory 重建并
绑定两份 candidate。因此，即使两份 artifacts 被相同方式篡改，也无法进入
Environment approval boundary。Candidate directory 必须恰好包含 `candidate.json` 与
声明的 regular-file archive；读取内容前就会拒绝额外 entry、directory 与 symlink。
Candidate construction 还会在唯一 canonical prefix 下解包最终 archive，并要求其
path/type/mode/size/SHA-256 inventory 与 frozen Git tree exact 相等；committed
`export-ignore` 或 `export-subst` attributes 不能静默改变实际发布的 payload。

`publish` 只把 assembled candidate 当作 data。它重新验证 artifact ID/basename、
archive digest、path/type/mode/size ceilings、完整 inventory 与 rebuilt Git tree，
并且绝不执行 candidate content。

Immutable plan 刻意不记录 live observed target-master snapshot。Manual retry 合法看到的
可能是原 parent、已发布 wrapper 或更晚 verified release；若把这一 observation 写进
plan，会造成 candidate/provenance bytes 漂移。相反，`target_master_before` 只绑定 frozen
manifest 的 `target.expected_head`；每个 unprivileged 与 privileged stage 都会 exact
重新绑定该字段，而 `publish` 会在首次 mutation 前单独读取并 reconcile live target。

Candidate payload 及其 Git tree 是 deterministic 的。Final release commit 有意不在
这个 deterministic byte boundary 内，因为其 parent、timestamp 与 signature 只能在
批准后确定。 `publish` 构造一个 signed wrapper commit：

```text
tree:       verified candidate tree
parent:     frozen manifest 的 target.expected_head
author:     JoeyTeng-Codex <codex@mahane.me>
committer:  JoeyTeng-Codex <codex@mahane.me>
signature:  4DD48552DDEAF6D961769DD4A49827EC48984E2C
```

Commit message 记录 release version、source repository、full source commit 与
release-manifest digest。Raw subtree-split commit 只作为证明 tree equality 的
证据，不会被推送为 target `master`。

Wrapper 恰好只有一个 parent。Publisher 从重新读取的 exact parent 开始，以普通
non-force fast-forward push 推进 `master`。若 target `master` 已移动，本次 run
停止并 reconcile；不得改写 history 或恢复 equivalent-tree force-push 路径。Retry
若发现预期 signed commit 已发布，应验证并沿用它，不得因新的 timestamp/signature
再造第二个 release commit。

## Publication order

批准后，在任何 target ref 或 Release mutation 前先执行一个 fail-closed
publication-input preflight。它从 frozen manifest 与 source tree 重建 expected plan，
并 exact 重新绑定 version/prerelease/tag policy、`target_master_before`、
`previous_version`、完整 signer identity、repositories/refs、source tree、payload
inventory、immutable control inventory 与 candidate archive bytes。该 control
inventory 是本次 plan 冻结的 current-control inventory，并非旧 source commit 的
controls。Preflight 也重新读取 live source `master`，判断 target writes 是否仍有
资格。随后 `publish` 再次检查 target
head、rulesets、existing tags 与 existing Release，并按以下顺序执行：

普通 durable mutation fence 会在 mutation 的紧邻位置重新验证 live source、
effective rulesets 与 current signer。更强的有序序列——先完成 governing policy
reads，再执行 final exact object boundary——只在 immutable Release publication 与
major-alias mutation 两个 critical irreversible fences 强制执行。两个 fence 都会
fresh 重读 immutable-Release policy；cached first-mutation result 不能证明这些较晚
fence 当时的 policy。特别是，发布 immutable Release 之前，publisher 必须先完成
source/ruleset/current-signer fence 和显式 immutable-Release-policy re-read，再对
frozen draft Release ID、其完整 asset inventory 与 tag binding 做一次 final exact
read。之后它使用 direct REST `PATCH` 向该 frozen Release ID 提交 exact intended
metadata。不得使用 `gh release edit`，因为该 convenience command 的实现可能在
publisher 最终 boundary 之后执行 hidden read。

GitHub REST `2026-03-10` endpoint 规定：immutable Releases 已启用时才返回 `200`，
已禁用时返回 `404`。因此 `404` 归为 `blocked_conflict` /
`immutable-release-policy-disabled`；其他 API 或读取失败归为 `inconclusive` /
`immutable-release-policy-unreadable`。`200` body 仍须按 extensible object 做 schema
validation：documented fields `enabled` 与 `enforced_by_owner` 都必须是 boolean，
`enabled` 必须为 `true`；`enforced_by_owner=false` 和 additive response fields 仍然
有效。Response 不是 object、缺少 documented field 或字段类型错误，都会在
protected write 前 fail closed。

1. 构造并在本地验证 signed single-parent wrapper commit。
2. 在不 force 的情况下 fast-forward target `master`，然后重新读取 exact commit、
   parent、tree 与 GitHub signature result。这证明 accepted Git state，不证明 immutable
   historical pusher attribution；Publisher App identity 已在写入前通过 minted
   credential 与 effective rulesets 绑定。
3. 在不 force 的情况下创建 signed annotated immutable full tag `v<version>`。
   它直接指向 wrapper commit，永不移动或删除。重新读取 exact tag object、peeled
   commit、commit tree 与 GitHub signature result。Publisher identity 在首次写入前
   通过 minted token 实际输出的 App slug 与 installation ID、target scope 及
   effective rulesets 完成绑定。
4. 由 Publisher App 枚举完整分页 GitHub Release inventory；该 push-authorized
   身份可以看见 drafts。要求 outer page array 非空（空 repository 的合法结果是
   `[[]]`）、所有 ID 都是全局唯一的 safe positive integer，并且 exact tag 只能有
   0 或 1 个匹配。已有 draft 按 inventory 中的 ID 恢复。只有 immutable full tag 在
   invocation 开始时不存在、并且同一 invocation 以 non-force push 创建该 tag 后精确读回
   tag object 与 peeled commit，fresh invocation 才获得 draft-create 权限；create 前仍须
   用两份稳定 complete inventory 证明 exact-tag Release absence。Publisher 在该
   invocation 中只发送一次 create request；它捕获 status 但不把 status 当作
   authoritative，并且无论 status 如何都再取得两份稳定 complete inventory。若其中唯一
   发现一个 Release，就冻结其 ID 并继续，即使 GitHub 已应用 request 后 create response
   丢失也可自动恢复。Request 后稳定 absence 归为 `inconclusive` /
   `release-creation-unknown`，该 invocation 绝不再次 create。若 invocation 开始时 full
   tag 已存在，而稳定 complete inventory 中没有 exact-tag Release，则 publisher 返回
   `inconclusive` / `release-create-attempt-unknown`，且不发送任何 create request。随后向
   已选择的对象上传 release assets、canonical
   provenance、checksums 与 detached provenance signature，但只能使用 numeric-ID
   `uploads.github.com/repos/{owner}/{repo}/releases/{frozen_id}/assets` endpoint，绝不
   使用会重新按 tag 解析对象的 upload command。每个 response 必须返回 positive safe
   asset ID、exact name 与 `uploaded` state，之后才可由 by-ID Release boundary admit。
   已上传 prefix asset 只有在通过其 frozen asset ID raw-read 并完成 bytes 对比后才能
   复用；exact-source recovery 不会通过 tag-resolving command 下载这些资产。
5. 完成 governing policy reads，再执行上述最终 exact draft Release、asset 与
   tag boundary。通过对 frozen Release ID 发送携带 exact metadata 的 direct
   `PATCH` 完成发布，然后验证 immutable published Release。
6. 仅对 stable version，先采集 live alias binding 的两份 neutral canonical raw
   observations A 与 B，并在解读 tag shape 或 expected policy 之前比较它们。
   只有 A 与 B 相等后，才验证 absent creation boundary 或 annotated
   direct/peeled binding，并把 exact previously observed tag object 绑定为 update
   lease。然后运行最终 source/ruleset/current-signer policy
   fence，显式重读 immutable-Release policy，并捕获一份 fresh exact immutable
   Release/asset/full-tag boundary。然后创建 signed annotated floating major tag
   （例如 `v2`），或使用 exact lease 更新。Alias 只能在 version history
   中向前移动。
7. 采集并比较 mutation 后 alias 的 neutral canonical raw observations A 与 B。
   A 与 B 不同归为 `inconclusive` / `remote-state-changed`。A 与 B 相等时，
   再验证稳定 binding 是 annotated tag，且其 direct object 与 peeled commit
   exact 匹配 planned state；malformed 或 lightweight tag，或其他稳定 binding，归为
   `blocked_conflict` / `malformed-major-alias-target`。然后重读 immutable
   Release/asset/full-tag boundary，
   必须与 pre-alias boundary 相同。Prerelease 在 alias mutation 之前停止，
   绝不修改 `v2`。

在 pre-mutation 或 post-mutation alias boundary，命令或 canonical raw projection
不可读都归为 `inconclusive` / `remote-read-inconclusive`。

单次 publisher invocation 完成 inventory 对象发现后，每个 exact Release boundary 同样
采用 raw-first A/B。
它对 `/releases/{frozen_id}` 与 immutable full-tag `ls-remote` binding 各读取两份
neutral canonical observations，先比较它们，要求每个 response 的 `.id` 都与 path
中的 frozen ID 完全一致，然后才做 structural 与 expected-policy validation。ID
endpoint 的 `404` 或其他 unreadable 结果绝不在该 invocation 内授权重新绑定或重建。
后续 exact-source retry 没有可持久化的 Release-ID ledger：它重新执行 full reconcile；
若 complete inventory 选出唯一 exact-tag object，就为新的 invocation 冻结该 ID。若
invocation 开始时 immutable full tag 已存在，稳定 absence 不授权重建 Release；这个已有
tag 是持久化的跨 run create-attempt fence，retry 会以
`release-create-attempt-unknown` 停止。Trusted-owner boundary 禁止跨 attempt 删除或替换
对象；publisher 不声称跨 run 的历史 ID 连续性。它只产生以下 closed classification：

- API、`ls-remote` 或 canonical raw projection 不可读：
  `inconclusive` / `remote-read-inconclusive`；
- raw observations A 与 B 不同：`inconclusive` / `remote-state-changed`；
- 稳定但 malformed 或 lightweight 的 tag，或稳定 Release metadata、author、asset、
  tag、frozen-draft 或 planned-state mismatch：
  `blocked_conflict` / `immutable-release-mismatch`。

这个 raw-first 顺序是刻意的：若在比较 A 与 B 之前就用 expected policy 验证任一
observation，稳定的错误状态可能被伪装成 transient read failure。

Fresh draft creation 不是例外。它的 expected-absence boundary 依次读取 complete
paginated inventory A、raw full-tag binding A、complete inventory B 与 raw full-tag
binding B。它先比较两组 canonical raw observations，再验证 inventory completeness 与
exact-tag mapping。稳定的 0 match 才是 absence；该 boundary 上稳定出现 exact-tag
match 或 A/B drift 都归为 `inconclusive` / `remote-state-changed`。同一 exact tag 被多个
不同 ID claim，归为 `blocked_conflict` / `duplicate-release-tag`。Outer `[]`、malformed
pages、unsafe ID、重复 numeric ID（包括 pagination overlap）或任一 unreadable page 都
属于不完整证据，归为 `inconclusive` / `remote-read-inconclusive`。Post-create discovery
无论 create command 的 exit status 如何都执行，并重复同样的两份 complete
inventory/tag observations。若 exact tag 唯一匹配，就冻结 positive numeric ID，并在同一
invocation 内安全恢复丢失的 response。若稳定 absence，则归为 `inconclusive` /
`release-creation-unknown`：eventual visibility 不能证明第二次 create 安全，因此该
invocation 会停止且不再次 create。后续 invocation 若在启动时已经存在 immutable full
tag，也不会发出 create：稳定的 Release absence 归为 `inconclusive` /
`release-create-attempt-unknown`。相同的 `source_sha`/admission inputs 或新的 Environment
approval 都不会重置这个跨 run fence。因此，tag push 之后、create 之前发生 crash，或者
create request 在 GitHub 可见地 apply 之前失败，都需要明确 review 的人工介入；普通
dispatch 不得重试 create。若 response 丢失，但 complete inventory 发现唯一合格 draft，
则仍可自动采用并恢复。不可读、drift、malformed 或 duplicate observation
仍使用上述 closed classifications。Pre-create 与 post-create tag A/B boundaries 也必须
exact 相等。两个 inventory boundary 都保持 raw-first，避免 ambiguous create result、
incomplete 或 torn enumeration 授权重复 create 或 object selection。

GitHub 的接口语义要求做出这个区分。REST
[release-by-tag endpoint](https://docs.github.com/en/rest/releases/releases?apiVersion=2026-03-10#get-a-release-by-tag-name)
只返回 published Release，因此它的 `404` 不能证明 draft 不存在；
[complete Release list](https://docs.github.com/en/rest/releases/releases?apiVersion=2026-03-10#list-releases)
会向具有 push access 的调用者返回 drafts。GitHub CLI 自己的
[`FetchRelease`](https://github.com/cli/cli/blob/trunk/pkg/cmd/release/shared/fetch.go#L179-L259)
也会分别查找 published-by-tag 与 draft candidates，然后通过 `/releases/{id}` 读取选中的
draft。Publisher 遵循同一 identity rule，但不依赖 porcelain：inventory 必须选出唯一
numeric ID，所有 mutable/draft boundary 继续固定在该 ID；只有 already-published
Release 的 public verification 才使用 release-by-tag。

Asset upload 同样是绑定 object identity 的 mutation。Nonzero upload result，或者
zero-exit response 为空、malformed、包含 unsafe asset ID、返回不同 asset name，或未
报告 `state=uploaded`，都归为 `inconclusive` /
`release-asset-upload-unknown`：bytes 可能已经写入 frozen Release。Exact-source
POST 返回成功后，publisher 先捕获 frozen by-ID Release boundary，并要求 returned asset
ID 属于该对象；随后使用 binary media type 通过 `/releases/assets/{asset_id}` 直接读取
bytes，并与 intended file 比较。这个 post-upload path 绝不按 tag 重新解析 Release。GET
失败或 bytes mismatch 同样归为 `release-asset-upload-unknown`，因为 mutation 已经发生。
当前 invocation 内的 recovery 不会 rebind；下一次 exact-source retry 从 complete inventory
重新冻结当时唯一的 exact-tag object，并依赖 trusted-owner no-replacement contract。

GitHub 文档说明，upload `502` 可能留下一个空的 `starter` asset。Retry 只允许 neutral
inventory 接纳该 state，以比较其 typed identity 与 content fields；它不代表 completed
asset。自动恢复严格限制为 selected mutable draft 上正好一个 `starter`，且必须由 Publisher
App 上传、使用 planned `application/octet-stream`、size 为 0、digest 为空、name 属于
expected inventory，并且正好占据 verified uploaded canonical prefix 的下一个 slot。Asset
name 与 numeric ID 都必须唯一，其中 asset ID 在完整 inventory 内也必须全局唯一。完成
final policy fence 后，publisher 立即取得 fresh stable by-ID A/B boundary，要求它与已选择
boundary 完全相同，随后只对该 frozen asset ID 发出一次 unconditional DELETE。无论 DELETE
返回 `204`、`404`、network failure 还是 response loss，都再通过 stable frozen-ID boundary
reconcile；只有 exact starter ID 已消失且其他 protected fields 全部不变，publication 才能
继续。否则返回 `inconclusive` / `starter-asset-deletion-unknown`，且本 invocation 不会发出
第二次 DELETE。Uploaded、nonzero、wrong-name、wrong-slot、wrong-uploader、
wrong-content-type 或未绑定的 asset 永远不会被删除。

Asset DELETE endpoint 没有 state-predicate compare-and-swap，因此最后一次 GET 到 DELETE
之间仍存在 client 无法消除的小窗口。安全自动恢复依赖 trusted-owner/single-writer 部署边界，
以及 GitHub 文档所描述的 empty `starter` terminal orphan 形状；该窗口内出现其他 Release
writer 会违反部署契约。

GitHub 官方 Release REST endpoint 没有为这个 `PATCH` 提供受支持的
conditional compare-and-swap precondition；publisher 不依赖 undocumented conditional
headers。因此，最终 draft/asset/tag read 与 publish `PATCH` 之间的微小
窗口无法由 client 消除。Workflow concurrency 可串行化 publisher runs，但不能
串行化独立 Release writer。因此 deployment contract 规定 private Publisher App
是唯一 automated Release writer，并把 repository owner `JoeyTeng` 明确视为 trusted
manual writer。任何其他 concurrent Release writer 都违反 deployment contract。如果
post-publication readback 检测到 mismatch，publication 必须保持 blocked，不得声称
可以自动恢复。Direct `PATCH` nonzero，或者 zero-exit response 为空、malformed 或返回
不同 Release ID，都归为 `inconclusive` / `release-publication-unknown`，因为 mutation
可能已生效。Reconcile 必须使用同一 exact source，从 complete inventory 重新选出当时唯一
的 exact-tag object，并证明其 draft state 仍是 valid prefix，或 exact Release 已经
immutable；不得盲目换用另一 version，也不得声称跨 run ID continuity。Deterministic
post-publication mismatch 仍保持 blocked。

本合约没有 `v2.0` alias。Floating alias 不建立单独 GitHub Release；Release 只
属于 immutable full-version tags。Stable release admit 后，consumer 使用
`JoeyTeng/codex-review-gate-action@v2`，后续 v2 patch 无需修改每一个 consumer
repository。

Provenance 至少绑定 release intent、exact source commit/subtree、candidate tree 与
完整 payload inventory、wrapper commit/parent、signing identity、immutable tag
object、assets 及观察到的 target state；它不包含 self-referential digest。
Floating alias 结果属于 mutable post-publication state，不伪造进已经 immutable 的
provenance。

## Verification 与 admission

`verify` 不绑定 Environment，也没有 publisher/signing secrets。它会
重新公开读取 target `master`、immutable tag/peeled commit、signatures、Release
immutability/assets，以及 stable release 的 floating alias。Actions summary 必须列出
observed state 和一个 closed recovery result：verification 完成时为
`recovery_code=none`；任一 required state 不完整、冲突或无法证明时，则为一个
supported non-success recovery code 及其 exact next action。Summary 不得遗漏 recovery
result，也不得改用开放式的“自行猜测如何修复”指示。

Public verification 的 initial 与 final Release-view metadata 都通过 direct REST
release-by-tag endpoint 获取，并遵循 GitHub REST `2026-03-10` contract。它把
Historical completed-Release by-tag reads 也显式使用同一 API version。它把 `draft`、
`prerelease`、`tag_name`、`name` 与 `body` 投影成用于比较的 closed view。Initial 与
final complete Release inventories 使用和 publication 相同的 structural validator：
outer 至少一页、每页为 array、所有 ID 都是 positive safe numeric ID 且全局唯一。
Outer `[]`、malformed pages 或重复 ID 都是不完整证据，归为 `inconclusive` /
`remote-read-inconclusive`。Documented REST HTTP 404 会按对应阶段归类为 Release
missing 或 disappeared；其他 API failure 归为 inconclusive。Verification 绝不从
`gh release view` porcelain stderr 推断 HTTP status。

每个 full SemVer（包括每个 prerelease、minor 与 patch version）都获得 immutable full
tag 与 immutable GitHub Release。Marketplace 是完全独立的 manual out-of-band
operator task，并且只适用于每个 major 的第一个 stable release：`v2.0.0`、未来的
`v3.0.0`，以此类推。人工操作员在对应 Release 页面使用 Action Marketplace
Release UI 发布该 major 的初始 listing version。Minor 与 patch release 不需要任何
Marketplace 操作。

Publisher 永不等待 Marketplace、不读取 Marketplace 状态，也不以 Marketplace 作为
success gate。Marketplace 不会创建或解析 floating `v2` Git ref。我们接受的取舍是：
Marketplace listing 可能在整个 v2 生命周期都显示 `v2.0.0`，同时 signed `v2` alias
继续推进到更新的 immutable releases。

Consumer rollout 前，full tag 必须可用、stable `v2` 必须 peel 到同一个已 admit
commit，且 immutable Release/provenance 必须匹配。对于每个 major 的第一个 stable
release，独立 Marketplace UI 操作可以在 publisher success 之后完成；它既不是
machine read-back evidence，也不是 publisher admission condition。专用 immutable-tag
与 floating-alias canary jobs 已延期，不属于 v2.0
publication 或 rollout gates。下文的 manual default-branch RC admission bridge 复用现有
consumer workflows，不是这些已延期的 dedicated canary jobs。Prerelease 永远不是
production selector，也不移动 `v2`。

### Stable v2.0 RC admission bridge

发布 stable `v2.0.0` 前，必须先发布一个 immutable `v2.0.0-rc.N` full tag，
并在指定 test consumer repository 中证明一次完整 live gate loop。不得修改
production bootstrap `@v2` templates 及其 normal floating selectors；应使用以下经
owner-reviewed 的短期 default-branch bridge：

该 bridge 必须手工准备；不得给 production bootstrap 增加 RC override，也不得为这个
临时 admission exercise 启用 production v2 ruleset。两次短期 default-branch change
由 test repository 已有保护与 required owner review 约束。

1. 在指定 test consumer 中打开一个 selector-only PR，只把已安装的两份 canonical
   workflows（verifier 与 controller）中的 Action selectors 从 `@v2` 替换为 exact
   immutable `@v2.0.0-rc.N`。由 repository owner review，然后合入受保护的 default
   branch。
2. 从已更新的 default branch 创建一个独立 harmless test PR；对其 exact head 跑完
   normal `begin-review` 和 `reconcile` path，包括 required Codex evidence 与 final gate
   result。
3. 记录 harmless test PR 的 exact head、controller 与 verifier run IDs 或 URLs，以及
   resolved tag `v2.0.0-rc.N`。Live gate 成功后，关闭该 harmless test PR，不要合并。
4. 打开并合并一个 forward PR，移除临时 bridge，并恢复两份 default-branch
   workflows 的 exact pre-bridge bytes。若原状态包含 canonical production verifier 与
   controller，两者 selectors 都恢复为 `@v2`；否则删除 temporary RC workflows，不得
   把 immutable RC selector 留在默认分支。

PR-local wrapper 不合格：trusted verifier 与 controller（包括 controller 的 manual
dispatch contract）从 default branch 加载。Non-default dispatch 同样不受支持，也不产生
admission evidence。这个临时合入的 selector bridge 是对现有 consumer contract 的
manual use，不是 publisher-integrated immutable-tag canary、floating-alias canary、
dedicated canary job 或 canary orchestrator。

## Reconcile、retry 与 cancellation

Publication 是一系列 remote operations，不是一个 cross-service transaction。每次
privileged retry 都先 full reconcile：

- manifest 与 exact source commit；
- 当前 target `master` 及 ancestry；
- 预期 wrapper commit 与 full tag object；
- draft/published Release state 及每个 asset digest；
- stable release 的 floating alias；
- effective branch/tag rulesets；
- current pinned signer 的 primary/subkey/raw-certificate inventory。

Reconcile 必须返回恰好一种 remote-state classification：`fresh`、
`resumable_partial`、`already_complete`、`superseded`、`blocked_conflict` 或
`inconclusive`。它只能复用与 signer/parent/tree/digest exact 匹配、且属于 canonical
publication sequence 的有效 prefix。每次 durable write 都必须重新读取；较旧的
partial release 会阻止较新的 release leapfrog。

Fully paginated Release inventory 的稳定性 fingerprint 使用 closed、
decision-relevant projection：它绑定 Release/asset object identity、tag 与 lifecycle
policy、immutable metadata、asset digest/byte metadata，以及 author/uploader identity；
刻意排除 `assets[].download_count`、timestamps 与 profile URL 等 observational/decorative API
字段。Projection 会 canonicalize Release/page 与 asset array ordering，因此单纯的 pagination
placement 或 response order 不会被视为 mutation，同时仍保留全部 protected values，先做
A/B 比较再解释 policy。Reconcile 下载 asset 本身就可能改变 download counter，但不会改变任何受保护
的发布属性；若把该计数视为状态 mutation，verifier 会让自己的稳定 snapshot 失效。

Exact 已完成步骤经过验证后沿用；缺失的下一步只有在该 mutation contract 允许时才能
恢复。Draft Release creation 是例外：一旦 immutable full tag 跨 invocation 已存在，稳定
Release absence 就返回 `release-create-attempt-unknown`，并要求经过明确 review 的人工
恢复，而不是再次运行普通 dispatch。Conflicting tag、commit、
signature、Release asset、意外 target advance 或 unknown state 都应 fail closed，
并在 summary 给出具体 recovery。Publisher 不删除或改写 immutable full tag/Release，
不 force-push `master`，也不把 major alias 向后移动。Immutable conflict 的
recovery 是经过 review 的 forward release，通常为新 patch version。

每次 attempt 的 immutable plan 都绑定 frozen release intent、该 attempt 使用的
current protected control commit 与完整 control-file digests。若短期 candidate、
assembled-candidate 或 publication-plan artifact 过期或不可用，但原 90-day push-plan
admission 仍有效，则 exact three-input dispatch 可以认证该 persisted admission，在届时
当前受保护 controls 下独立 rematerialize 两份 candidates，构造新的 plan/publication
plan，并重新取得 Environment approval。新 run 在任何写入前仍必须 classify 并
reconcile 每个 remote object；它只能恢复 exact valid prefix，否则以
`blocked_conflict` 或 `inconclusive` 停止。若原 push-plan admission 过期或不可用，
recovery 必须 fail closed 并创建新的 reviewed release intent，不得只从 Git 重建
admission。若 durable immutable conflict 无法 reconcile，应保留现场用于 diagnosis，
并通过经过 review 的更高版本 forward repair。只有这个更高版本可以历史性恢复较旧
代码；floating alias 在 version history 中永不向后移动。

Workflow-level concurrency 合约为：

```yaml
concurrency:
  group: codex-review-gate-action-release
  cancel-in-progress: false
```

`false` 是刻意选择，并应由 workflow static tests 保护。较新的 run 不得在推进
`master`、创建 immutable tag、发布 Release 与更新 alias 之间自动终止 active
release。Cancellation 不会回滚这些 remote writes；runner 被强制终止时，App token
撤销也只是 best effort。Pending run 可以被后来的 pending run 替换，active run
保持不受打断。Owner 仍可在检查 remote state 后主动取消，但后续 run 必须先 full
reconcile 才能继续。

## 初始 v2 scope 与延期事项

初始 v2 publication 刻意沿用 v1-like operational simplicity：一个 source-hosted
publisher、两次 deterministic candidate builds、一个受保护 publication stage 和
一个 unprivileged public-verification stage。它不把旧 pre-activation controller、
三组 Environment wait jobs、scheduled consumer scan、专用 immutable-tag 或
floating-alias canary jobs，以及独立 canary orchestrator 引入 release
prerequisites。

Stable `v2.0.0` admission 还要求先发布 `v2.0.0-rc.N`，并在指定 test
consumer repository 中执行上文 default-branch RC admission bridge。RC 只使用
immutable full tag，不推进 `v2`。Selector-only bridge PR 需临时合入，使两份 trusted
default-branch workflows 都能解析 RC；独立 harmless test PR 在成功后关闭且不合并，
然后用 forward PR 恢复两份 workflows 的 exact pre-bridge bytes：只有原本就有
canonical production verifier 与 controller 时，两者 selectors 才都恢复为 `@v2`；
否则删除 temporary RC workflows。普通 post-installation `@v2` consumer canary 仍与
publisher 分离。

以下事项明确延期，不得将其表述为已经完成，也不得静默升级为当前合约：

- 专用 immutable-tag 与 floating-alias canary jobs，包括更丰富的
  multi-repository 或 multi-phase canary orchestration；
- Marketplace publication automation 与 machine-verifiable admission；
- 针对每种 partial GitHub Release failure mode 的详细 rollback/forward-recovery
  automation；
- release/runtime soft limits 的可选临时数值覆盖。

对于尚未实现的 edge，应停止、保留 observed state，并使用已 review 的 forward
recovery；不得弱化 ruleset 或修改 immutable history。

## 历史 v1 证据

以下内容只作为 historical evidence 保留，不是 live v2 publisher contract：

- v1 发布在 `JoeyTeng/codex-review-gate-action`，因此 v2 保留既有 Marketplace
  listing，而不是从第二个 repository 发布；
- 已记录的 pre-v2 target `master` 是
  `59eeda2af2a7baab3f3f15a59fbbaee015fa6c01`，tree 是
  `8d909dd441b28b6915c46f60e8a144e64fd5268b`；
- 已记录的 `v1.5.1` annotated tag object 是
  `f9201d016b0abd21403550c3bf8030eb0beb76b4`；v1.1.0 至 v1.5.1
  release refs/assets 仍属于 target 历史状态；
- 已记录的 v1 `master` 是 unsigned raw subtree-split commit，而经过验证的
  `v1.5.1` annotated release tag 具有 valid GPG signature；v1 还使用 manual
  release evidence 与 SSH deploy-key publication path。

这些事实只解释 migration checks，不授予当前 authority。v1 refs 保持冻结；v2 使用
Publisher App、signed wrapper commits、committed SemVer intent、immutable
full-version Releases 与 floating `v2` selector。
