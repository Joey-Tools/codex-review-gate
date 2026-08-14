# Action v2 发布

公开 v2 action 是 `Joey-Tools/codex-review-gate` 中
`packages/action` 的完整 subtree split，发布目标为
`Joey-Tools/codex-review-gate-action`。本 pipeline 唯一支持的 release 是
`v2.0.0`，签名 aliases 是 `v2.0` 与 `v2`。

source repository 的任何 job 都不能写入
`JoeyTeng/codex-review-gate-action`。该 personal repository 是永久冻结的
v1 archive：既有 v1 consumer 以及每个 archived ref/object 均保持不变；source
release pipeline 只会对其已记录 baseline 做只读复核。

## Publication 与 activation 两阶段边界

本 runbook 包含两个彼此独立、fail-closed 的阶段。Phase 1 只发布并验证 action
repository；Phase 2 只有在 live canary 成功后，才安装 immutable production
consumer 并调整 branch protection。

整个 Phase 1 中，source-root caller
`.github/workflows/codex-review-gate.yml` 必须继续 exact 使用
`JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1`。
Release workflow 及其 publication change 都不得修改该 caller、安装 v2 reconcile
graph、切换 required status context 或声称 v2 已激活。成功 publication 只是进入
单独 review 的 activation phase 的一个输入。

## 封闭的 repository 与 ref 合约

机器可读的发布前 baseline 位于
`docs/release/action-v2-repository-baselines.json`。Production verification
还将其 exact SHA-256 固定为
`63dc08cdf35720a5659ec6e2557ac4a3f49c26be331f4b62d1cb3e402336df6a`；
编辑 baseline 不是 drift recovery 手段。

- 冻结 archive：`JoeyTeng/codex-review-gate-action` 的 27 条已记录 refs 与
  OIDs 必须完全不变；`master` 固定为
  `59eeda2af2a7baab3f3f15a59fbbaee015fa6c01`，tree 固定为
  `8d909dd441b28b6915c46f60e8a144e64fd5268b`。
- v2 target 首发前：`Joey-Tools/codex-review-gate-action` 必须只有已记录的
  3 个 heads、0 tags；这些 heads 可达 21 commits、2 roots。转移后的
  `master` 与冻结 archive 的 commit/tree 相同。
- v2 target 发布后：保留两个 archival heads；`master` 以正常 fast-forward
  推进到完整 split head；此外只能新增直接 annotated tags `v2.0.0`、
  `v2.0`、`v2`。
- 三个 v2 tags 必须由同一个 policy-bound OpenPGP primary key 签名，并直接
  peel 到新的 exact `master` commit。immutable tag 和 aliases 均不得移动、
  替换、删除、嵌套、退化成 lightweight tag 或 force-push。
- v2 target 不得出现 `refs/heads/v1*` 或 `refs/tags/v1*`。split history 或
  runtime 中保留 `src/core.mjs`、`src/gate.mjs` 并不授权 v1 selector。

Provenance manifest 绑定完整 parent graph、reachable commit-set digest、root 数、
parent edge 数、canonical graph digest、完整 release tree 中每个 blob 的 OID 与
SHA-256、source package identity，并绑定以下公开 v2 identities：

- source `package.json`：`codex-review-gate-source@2.0.0`，exact repository URL
  为 `git+https://github.com/Joey-Tools/codex-review-gate.git`；

- `action.yml`：plan-only composite entry；
- `.github/workflows/codex-review-gate.yml`：可信 public controller entry；
- `.github/workflows/codex-review-gate-reconcile.yml`：可信 reconciliation entry；
- `src/v2/workflow-controller.mjs`：v2 workflow controller；
- `src/v2/action.mjs`：plan-adapter controller；
- release tree 中自动发现的每个 direct、canonical-name、regular non-symlink
  `src/v2/*.mjs` module，并按 UTF-8 byte order 记录；
- `github-codex-evidence-authority-v2.json` 的 exact blob OID、SHA-256 与
  `sha256:<digest>` policy identity；
- action `package.json`：`codex-review-gate-action@2.0.0`，exact repository
  URL 为 `git+https://github.com/Joey-Tools/codex-review-gate-action.git`。

`src/v2/` 下任何 hidden、nested、非 `.mjs`、noncanonical、duplicate、symlink
或 special entry 都会拒绝 publication，不能静默逃逸 runtime identity。
Source-only Required-CI workflows 保持在 `packages/action` 之外，既不会 split
到 action repository，也不会进入 runtime identity。

## 必需的外部配置

以下控制全部存在前，publication 必须保持关闭：

1. 在 source repository 创建受保护 GitHub Actions environment
   `action-v2-release`，并要求人工批准。
2. 在该 environment 配置 `ACTION_REPO_PUSH_TOKEN_V2`。它必须是只作用于
   `Joey-Tools/codex-review-gate-action` 的 fine-grained PAT 或 GitHub App
   token，最小权限为 `Contents: write`。组织已禁用 deploy keys，本流程也不支持
   deploy key。
3. 配置 `ACTION_RELEASE_SIGNING_PRIVATE_KEY_V2` 与
   `ACTION_RELEASE_SIGNING_FINGERPRINT_V2`。Fingerprint 必须是完整 OpenPGP
   primary-key fingerprint；workflow 会拒绝任何不能 exact match 的导入。应使用
   专用 automation signing key，其受保护 secret material 能在 ephemeral runner
   上非交互签名；本 workflow 不提供 passphrase 或 pinentry interface。
4. 配置 target branch/ruleset，使该 token 具有已记录的 maintenance role 或
   狭窄 bypass，足以完成单次 `master` 更新；同时保护 `v2*` tags 不被更新或删除。
   若 token 无法满足 ruleset，publication 保持 blocked，不得临时弱化规则。

Token 只通过 runner-private Git config 的 HTTPS `extraheader` 传输，不嵌入 URL，
不作为 SSH deploy key，也不传给 release script。`actions/checkout` 使用
`persist-credentials: false`。

## 验证

匹配的 `master` push 只会运行只读验证；普通 push 不会发布到 action repository。
在 clean source checkout 中运行：

```bash
scripts/release-action-subtree.sh --check --source-ref HEAD
```

该命令运行 source/action checks 与 tests，计算完整 subtree split，重新读取两个
remote baselines，将 target heads 导入私有 bare staging repository，并验证：

- source `packages/action` tree 等于 split root tree；
- source/action package names、version `2.0.0` 与 exact Joey-Tools repository
  URLs 符合封闭 release identity；
- transferred target `master` 是 split head 的 ancestor；
- target initial heads 合计为 21 commits、2 roots；
- frozen personal repository 的每个已记录 ref 与 tree 未改变；
- public action、reusable workflow、controller、evidence-authority policy、
  package 与动态发现的 v2 module identities 封闭且完整。

任何 remote drift、部分 baseline、缺失 object、新 target 中的 v1 ref、runtime
identity mismatch、dirty source tree 或 test failure 都会拒绝运行。

## 首次发布

只有在 v2 runtime、reusable workflow、target ruleset、HTTPS credential 与签名
identity 都已独立 review 并闭合后，才可执行本节。

从 exact source `master` dispatch `Release Action Subtree v2`，并设置
`publish_v2=true`。受保护的 `action-v2-release` environment 是人工授权边界。
该 dispatch 会在同一个 publishing invocation 内执行 integrated validation，使
clean-tree 与 exact-commit boundary 不跨 jobs 分裂。Workflow 导入并绑定 signing
key 后运行：

```bash
scripts/release-action-subtree.sh \
  --publish \
  --source-ref "$GITHUB_SHA" \
  --output "$RUNNER_TEMP/codex-review-gate-action-v2.0.0-provenance.json"
```

脚本在 source refs 外部暂存 split 与 tags，生成 preflight manifest，然后用一次
atomic non-force push 提交：

```text
<split>:refs/heads/master
refs/tags/v2.0.0:refs/tags/v2.0.0
refs/tags/v2.0:refs/tags/v2.0
refs/tags/v2:refs/tags/v2
```

随后脚本重新读取两个 repositories，要求 refs 与 plan exact 一致，通过私有
create-only publication boundary 写入 manifest，再次重读两边。Workflow 将 exact
manifest 上传为 `codex-review-gate-action-v2.0.0-provenance` artifact。

GitHub atomic receive 只保护 target repository 内四条 refs 的共同更新，不会把
source 与 target 变成跨仓库 transaction。Frozen archive 从来不是 push target，并在
target 写入前后都经过复核。

## Publication 后 admission

不得从 local split、workflow run 的 source SHA 或任何 v2 tag 名称构造 production
consumer。必须从 exact successful publication run 下载 exact provenance artifact，
只有当其 `action.commit_oid` 匹配 `^[0-9a-f]{40}$`，且以下检查共同闭合时，才能将
该值 admit 为 `RELEASE_SHA`：

- publication run 使用预期 source `master` commit，并将上传 artifact 的 bytes 与
  SHA-256 保留为 activation evidence；
- target `master` exact 等于 `RELEASE_SHA`，manifest 的 released tree、runtime
  closure、repository identities 以及 source/action package identities 都能针对该
  commit 重新验证；
- remote `v2.0.0`、`v2.0`、`v2` 是 manifest-bound 的 exact direct annotated tag
  objects，均在独立可信的 primary fingerprint 下验签通过，并直接 peel 到
  `RELEASE_SHA`；
- target 完整 ref inventory 只有已 admit 的 post-publication state，同时 frozen
  personal repository 仍 exact 匹配其只读 baseline；
- fresh exact-state verification 不存在 ref、graph、tree、signature 或 provenance
  drift。

任一 mismatch 都会阻止 activation，不能授权 branch/tag selector、另一个 40-hex
object、修补后的 provenance file 或被移动的 release ref。

## Phase 2：immutable consumer activation

Activation 必须是单独 review 的变更。把已 admit 的 lower-case 40-hex
`RELEASE_SHA` 代入完整 consumer graph 中的每个 controller call：

```yaml
uses: Joey-Tools/codex-review-gate-action/.github/workflows/codex-review-gate.yml@<RELEASE_SHA>
```

`<RELEASE_SHA>` 只是文档记法，不能原样出现在 workflow 中。部署的 selector 必须与
已经 admit 的 `RELEASE_SHA` 逐字节相同。Production 必须拒绝 personal
`JoeyTeng` repository、`@v1`、所有 `@v2*` selectors（包括已签名 release tags）、
branch、tag、symbolic ref、short SHA，以及所有其他 floating 或不同 selector。

必须安装 released `.github/workflows/codex-review-gate-reconcile.yml` 所代表的
完整 graph，不能只摘取 initial job。Activation review 必须保留以下全部合约：

- 完整 event topology、`17 */2 * * *` schedule、repository-wide
  `codex-review-gate-v2-${{ github.repository }}` concurrency、
  `cancel-in-progress: false` 与 `pull-request` dispatch input；
- schedule route 的 `scan-all-open` coordinator、controller-owned durable
  candidate inventory/reservation 与 canonical matrix output；per-candidate job
  必须消费 `fromJSON(needs.schedule-dispatch.outputs.matrix)`，原样传递
  `dispatch_binding`，使用 `max-parallel: 1` 与 `fail-fast: false`，并用
  `matrix.enabled` gate 两个 steps；empty inventory 使用一个 disabled sentinel，
  后续 job 不得重新枚举或选择 caller-provided PR；
- exact 4 个 controller calls，全部 pin 到同一个 `RELEASE_SHA`，并分别具有 exact
  `contents: write`、`id-token: write`、`issues: write`、
  `pull-requests: write`、`statuses: write` permissions；
- `selection-policy: joey-default`、封闭的 initial route expression、后续
  `ordinary` routes、exact pull-request selector expression，以及 4 个
  `initial`/post-wait observation boundaries；
- exact 3 个 credential-free wait jobs，使用 `permissions: {}`、
  `runs-on: ubuntu-slim`、`timeout-minutes: 5`、`deployment: false`，环境名分别为
  `codex-review-gate-public-initial-15m`、
  `codex-review-gate-public-post-request-15m`、
  `codex-review-gate-public-no-start-15m`；
- released reusable workflow 的封闭 inputs、permissions、exact checkout binding，
  以及三个 trusted execution legs 各自 exact 的
  `V2_PUBLIC_WAIT_MINUTES: "15"` 与 `codex/github-review-gate` status context。

任何 canary 前，都必须通过已认证 Environment API 证明 consumer repository 中三个
named environments 全部存在，且每个 environment 都有且只有一个 exact 15-minute
`wait_timer` protection rule。Workflow 的 5-minute job timeout 不是 public wait；
该边界由 environment protection rule 提供。缺失、不可读、提前释放或非 15-minute
证据都会阻止 rollout。

以下步骤共同构成一次 required-context ruleset/branch-protection switch；其
forward order 必须是：

1. 保持 legacy v1 caller enabled，并在 branch protection 中保留其已记录 required
   context。配置三个 environment rules，再把完整 exact-SHA graph 部署到一个已批准的
   live canary consumer；此时 v2 context 还不能成为 required context。
2. 执行受支持的 event paths 与 waits。证明 selected workflow repository、
   `job.workflow_sha`、checkout commit、environment server-time boundaries、
   ledger/effect receipts 与产出的 `codex/github-review-gate` status 全部绑定
   `RELEASE_SHA` 和 canary head。Skipped、ambiguous 或只观察到部分证据的 run 都不是
   pass。
3. Canary 通过后，才把 byte-equivalent graph 部署到 production consumer，同时保持
   legacy v1 path 可用。先把 `codex/github-review-gate` 加入 required contexts，并用
   新的 ordinary pull request 证明其满足要求，再移除已记录 legacy v1 required
   context。只有 rollback window 关闭后，才能退役 legacy caller。

Rollback 必须使用相反的 authority order：先恢复或保留 legacy v1 caller，再重新加入
并证明它的 required context，然后移除 v2 required context，最后才 disable/remove v2
consumer graph。禁止通过移动/删除 v2 refs、把 consumer 改成 floating selector、弱化
environment wait 或重写 provenance 来 rollback。

## 重试与事故策略

Exact-state rerun 仅执行验证：要求三个 tag object IDs、签名、target `master`、
完整 refs、graph 与 tree 全部一致，然后产生新的 create-only provenance 文件；
它绝不重写 tag。

出现以下任一情况时，应停止且不得 repair push：

- 只存在部分 v2 tags；
- 任一 planned ref 不一致；
- `master` 无法从 transferred baseline fast-forward；
- v2 tag 是 lightweight、nested、unsigned、签名 identity 不同或 peel 到其他 commit；
- 新 target 出现 v1 head/tag；
- frozen repository 与 baseline 不一致；
- target rules 拒绝 atomic write。

保留日志以及任何已成功 link 的 provenance output 供审计。通过普通、已 review 的
source/runtime 或外部 policy 变更修复；不得 force-push、删除 tags、移动 aliases、
编辑 baseline 来认可 drift，也不得写入 frozen personal repository。

## 历史 v1 releases

v1.1.0 至 v1.5.1 refs 与 release assets 只保留在 frozen personal repository。
本 v2 generator 不重新解释或生成其 runtime provenance。既有 consumer URLs 继续
在那里解析；已激活的 v2 production caller 必须使用
`Joey-Tools/codex-review-gate-action` 与唯一已 admit 的 exact
`RELEASE_SHA`，不得使用 v2 tag 或 alias。
