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
`workflow_dispatch` 只接受一个 required `source_sha`：引入目标 manifest 的 exact
lowercase 40-hex commit。若该 source 不含 manifest、SHA 是 short/ambiguous，或 source
不在允许的受保护 history 中，workflow 会在 publication 前拒绝。

Dispatch 始终执行触发时 `github.sha` 所记录的 live source `master` workflow 与
publisher controls；绝不把旧 commit checkout 成可执行 release control。所选
`source_sha` 必须是 linear ancestor 上实际修改 `release-manifest.json` 的 commit。
该 source 冻结 release manifest 和完整 `packages/action` payload/tree。Recovery 不
要求旧 source commit 中的 publisher controls 与当前 controls 相同；每次 attempt 都
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

## Workflow stages 与权限边界

专用 publisher 在 source repository 中运行，包含以下 logical stages：

| Stage | 权限 | 合约 |
| --- | --- | --- |
| `plan` | 无特权 | 检查 exact source commit、manifest、SemVer、reachability、release policy 与 immutable target-parent policy。 |
| `candidate-a` | 无特权 | 在 clean runner 独立 materialize 并测试 candidate A，记录 tree、inventory、modes、sizes 与 SHA-256 digests。 |
| `candidate-b` | 无特权 | 在另一个 clean runner 独立 materialize 并测试 candidate B。 |
| `assemble` | 无特权 | 要求两份 candidates byte-identical，并产出 canonical candidate bundle。 |
| `publication-plan` | 无特权 | 批准前重建并验证 publication plan 与 candidate，不上传任何 privileged material。 |
| `publish` | 有特权 | Environment 人工批准后重新验证全部状态并执行 signed remote publication。 |
| `verify` | 无特权 | 重新读取公开 refs 与 Release state，并报告观察结果。 |

轻量的无特权 `plan`、`assemble`、`publication-plan` 与 `verify` jobs 使用
`ubuntu-slim` 与 14 分钟 timeout。GitHub 对这个单核 runner 另有 15 分钟硬上限，
所以低频但重型的 `candidate-a` 与 `candidate-b` 改用 `ubuntu-24.04` 与 30 分钟
timeout。仅完整测试套件在最后一个 release-pipeline test 完成前就已耗时约 755.6 秒，
`ubuntu-slim` 无法为 checkout、setup、candidate materialization、packaging 与 upload
留出足够余量。privileged `publish` job 也继续使用 `ubuntu-24.04` 与既有 30 分钟
timeout。

只有 `publish` 绑定 `marketplace-production` Environment。尽管保留了历史名称，它
实际代表 production publication credentials 与人工批准边界，并不表示 workflow 会
发布或验证 Marketplace。初始 policy 要求 reviewer `JoeyTeng`、保持 **Prevent
self-review** disabled、禁用 administrator bypass、只允许 source branch `master`，且
approval 最多 pending 30 天。在批准前：

- publisher App token 与 signing key 都不可用；
- 任何 job 都不能写 target repository 或 GitHub Release；
- candidate artifact 不含 credential 或 signing-key material。

Artifacts 只是 jobs 之间的 transport，不是 ledger，也不是权威发布证据。`plan`
artifact 与 candidate A/B artifacts（`candidate-a` 和 `candidate-b`）保留 1 天。
Assembled canonical candidate 与 publication plan artifacts 各保留 35 天，覆盖
Environment 最长 30 天的 approval wait。它们是 `publish` 需要的两份 frozen
inputs。`publication-plan` stage 会生成这份 plan；不存在单独名为或被分类为
admission artifact 的 artifact。Artifact display name 包含 workflow run ID 与
attempt；consumer 绑定 server-returned artifact ID 和经过验证的 exact basename，而
不是信任 display name。权威状态仍是 committed manifest 与重新读取的 Git/Release
state。

等待 Required reviewer 批准期间，GitHub 不会为受保护 job 分配 runner，该等待也不
消耗 billable runner time。平台上限是 30 天，并非无限等待。若批准被拒绝、取消或
过期，任何 privileged step 都尚未运行；dispatch 同一个 committed source SHA 即可
在届时当前受保护 controls 下重新构建 frozen payload、生成新的 plan 与 candidates
A/B，并申请新的批准。只有新 plan 创建后的 drift 才会使该 attempt 失效。批准后
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

App 是 pusher；GPG identity 是 author、committer 与 signer。GitHub 接受
publication commit 后，两种 identities 都必须复核。

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

`candidate-a` 和 `candidate-b` 从同一个 exact source commit 开始，但彼此独立运行。每个 job
先 materialize、pack 并 upload candidate，再在自己的 detached frozen-source worktree
中运行 `npm run check` 与完整 Node test suite。因此 source test 无法修改已上传的
candidate，而 test failure 仍会令 job 失败并阻止 assemble。每份 candidate 都产出
canonical inventory 与 digests。Inventory 按 Git path bytes 排序，记录每个 entry 的 type、Git
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

1. 构造并在本地验证 signed single-parent wrapper commit。
2. 在不 force 的情况下 fast-forward target `master`，然后重新读取 exact commit、
   parent、tree、App pusher 与 GitHub signature result。
3. 在不 force 的情况下创建 signed annotated immutable full tag `v<version>`。
   它直接指向 wrapper commit，永不移动或删除。重新读取 exact tag object、peeled
   commit、commit tree 与 GitHub signature result。Publisher identity 在首次写入前
   通过 minted token 实际输出的 App slug 与 installation ID、target scope 及
   effective rulesets 完成绑定。
4. 为 full tag 创建或恢复 draft GitHub Release，上传 release assets、canonical
   provenance、checksums 与 detached provenance signature。
5. 重新读取 draft tag binding 及每个 asset byte/digest，然后在 repository 的
   immutable-release policy 下发布 Release，并验证 immutable published Release。
6. 仅对 stable version，创建 signed annotated floating major tag（例如 `v2`），
   并对刚观察到的旧 tag object 使用 exact lease 更新。Alias 只能在 version history
   中向前移动。
7. 重新读取 alias。Prerelease 在此步骤前停止，绝不修改 `v2`。

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
- effective branch/tag rulesets。

Reconcile 必须返回恰好一种 remote-state classification：`fresh`、
`resumable_partial`、`already_complete`、`superseded`、`blocked_conflict` 或
`inconclusive`。它只能复用与 signer/parent/tree/digest exact 匹配、且属于 canonical
publication sequence 的有效 prefix。每次 durable write 都必须重新读取；较旧的
partial release 会阻止较新的 release leapfrog。

Fully paginated Release inventory 的稳定性 fingerprint 使用 closed、
decision-relevant projection：它绑定 Release/asset object identity、tag 与 lifecycle
policy、immutable metadata、asset digest/byte metadata，以及 author/uploader identity；
刻意排除 `assets[].download_count` 与 profile URL 等 observational/decorative API
字段。Reconcile 下载 asset 本身就可能改变 download counter，但不会改变任何受保护
的发布属性；若把该计数视为状态 mutation，verifier 会让自己的稳定 snapshot 失效。

Exact 已完成步骤经过验证后沿用；缺失的下一步可以恢复。Conflicting tag、commit、
signature、Release asset、意外 target advance 或 unknown state 都应 fail closed，
并在 summary 给出具体 recovery。Publisher 不删除或改写 immutable full tag/Release，
不 force-push `master`，也不把 major alias 向后移动。Immutable conflict 的
recovery 是经过 review 的 forward release，通常为新 patch version。

每次 attempt 的 immutable plan 都绑定 frozen release intent、该 attempt 使用的
current protected control commit 与完整 control-file digests。若 artifact 过期或不可
用，应重新 dispatch exact source SHA，在届时当前受保护 controls 下独立
rematerialize 两份 candidates，构造新的 plan/publication plan，并重新取得
Environment approval。新 run 在任何写入前仍必须 classify 并 reconcile 每个 remote
object；它只能恢复 exact valid prefix，否则以 `blocked_conflict` 或 `inconclusive`
停止。若 durable immutable conflict 无法 reconcile，应保留现场用于 diagnosis，并
通过经过 review 的更高版本 forward repair。只有这个更高版本可以历史性恢复较旧
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
