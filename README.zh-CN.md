# Codex Review Gate 源码仓库

语言：[British English (en-GB)](README.md) | [简体中文 (zh-CN)](README.zh-CN.md)

本仓库是 Codex Review Gate 的 canonical source。可发布的 JavaScript Action package 位于
`packages/action/`，release 会 materialize 到现有 Marketplace 仓库
[`JoeyTeng/codex-review-gate-action`](https://github.com/JoeyTeng/codex-review-gate-action)。

## 目录

- `packages/action/`：完整 Action release subtree，包括 root `action.yml` 与 JavaScript
  runtime；
- `templates/codex-gated-repo/`：两份 canonical copied consumer workflows 与
  Disabled importable ruleset；
- `src/bootstrap.mjs` 与 `scripts/bootstrap-codex-review-gate.mjs`：本地安装和远端
  ruleset staging/activation helper；
- `docs/install/`：同一安装流程的人类可读指南与 agent 可执行版本，均提供中英文；
- `test/`：source、runtime、workflow、installer 与 publisher contract tests；
- `.github/workflows/`：source CI、self-gating 与 staged publisher；
- `docs/RELEASING.zh-CN.md`：完整 publisher 与 repository-protection contract。

## 开发

在仓库 root 运行：

```bash
npm run check
npm test
```

V2 Action、bootstrap helper 与 release contract 也有 focused commands：

```bash
npm run check:v2
npm run test:v2
npm run test:bootstrap
npm run test:release-provenance
```

## Consumer 模型

V2 consumer 把两份 canonical workflows 复制到目标仓库的相同路径：

- `.github/workflows/codex-review-gate.yml` 是只读 `pull_request` verifier；它在 exact
  PR feature-head SHA 上生成 GitHub-managed job CheckRun
  `codex/github-review-gate`，这就是 required signal。Workflow 仍在
  `refs/pull/N/merge` 上执行，并通过严格的 environment、event 与 fresh-read 校验，把
  CheckRun 绑定到 unchanged current head/base/test-merge scope。
- `.github/workflows/codex-review-gate-controller.yml` 是受保护 default branch 上的
  controller；它接收 exact Codex events 与 typed manual operations、创建 review request，
  并在需要 reconcile 时建立严格更新的 full verifier attempt。它还会在 eligible verifier
  run 完成后记录 best-effort diagnostic snapshot。显式启用后，同一份 controller 也可在
  canonical verifier 失败后请求评审；无需第三份 workflow。

自动请求默认关闭。把 organisation 或 repository Actions variable
`CODEX_REVIEW_GATE_AUTO_REQUEST` 设为精确的小写 `true` 才能授权请求；未设置时会跳过
自动 controller job，其他值均不能发出请求。GitHub Actions 的 job 条件不区分字符串大小写，
因此 `TRUE` 等大小写变体仍可能分配 controller runner，但 runtime 会在发帖前拒绝。
repository 值会覆盖 organisation 值。`opened`、`reopened`、`synchronize` 或
`ready_for_review` 触发 verifier 后，一次完成且失败的 run 可以让受保护 controller
处理 same-repository、open、ready、以当前 default branch 为 base 且 head 仍精确匹配的
PR。它校验该 run，可能发送或采用当前 scope 的 canonical `@codex review` request；
结果不确定时保持 pending。
自动路径不会立即 rerun verifier；之后由 Codex bot comment 或受保护的 manual
`reconcile` 处理结果。如果 merge conflict 阻止 verifier 运行，就不会触发自动请求；
应先解决冲突，必要时再使用 manual recovery。Joey-Tools rollout 应先把 organisation
variable 的 selected-repository visibility 仅设为 `codex-private-workflows` 作为
canary，不设置 repository-level override；通过后再扩大范围。

Append-only v2.2 controller contract 可选接收独立的 `review_request_token`，仅用于
`begin-review` 请求中的认证用户身份查询与请求 comment 创建。留空保留当前
GitHub Actions bot 行为。它不替换 `github_token`：PR/scope/evidence 读取、request refetch、sticky
diagnostic 写入及 canonical verifier rerun 仍使用正常 workflow token。现有 consumer 必须显式在
controller Action step 传入
`review_request_token: ${{ secrets.CODEX_REVIEW_GATE_REQUEST_TOKEN }}`；仅创建该 secret 不会自动启用或发现它。
配置与凭据建议见[安装指南](docs/install/human.zh-CN.md#可选的-review-request-用户-token)。

受保护的 `workflow_run` completion path 会在 canonical verifier 完成后运行仅用于诊断的
operation，包括成功的 rerun，以及自动请求关闭时的完成事件。既有自动 request 行为保持不变：
只有 PR association 唯一的首次失败、且 opt-in variable 精确匹配时，才使用
`begin-review` 并请求评审。其他 eligible completion 不会扫描 provider evidence、reconcile、
rerun verifier 或发送 request。额外的 controller run 会消耗可计费 runner minutes。
Snapshot 是可编辑的诊断输出，不是 review evidence 或 gate authority；过时 run/scope 的
snapshot 会被忽略。当前 native `codex/github-review-gate` CheckRun 仍是 required signal。

偶尔 GitHub run metadata 没有 PR association 时，controller 只接受空 association list，并从
exact canonical verifier `display_title` 派生 PR/test-merge binding。此时内部传入的
`pr_number: 0` 是 sentinel；runtime 写入前会重读并校验 exact current PR、run、attempt 和
CheckRun。该事件会落入 repository-scoped 的空后缀 concurrency group，而不是通常的
PR-specific group，因此最终的 point-in-time revalidation（写入前瞬时重验）不能保证与该 PR
的所有其他 controller run 全局串行。这个 snapshot 永远不会使 PR 获得 mergeability。

按顺序 rollout：先发布支持 `report-completion` 的 Action runtime，再向 consumer 安装匹配的
canonical controller workflow。不要让此 operation 暴露给 v2.1.6 等较旧 runtime；公开的手动
dispatch 仍仅允许 `reconcile` 与 `begin-review`。
本源码仓库是 self-hosting 例外，因为其 controller workflow 与源码 PR 一起变更：兼容的
Action release 可用前，旧 runtime 可能因不认识该 operation 而使可选的 diagnostic controller
run 失败。但这不会改变 required verifier CheckRun，也不影响现有手动 `reconcile`/
`begin-review` operations。外部 consumer 仍必须先 runtime、后 workflow。

两份 workflows 都调用兼容的 floating major：

```yaml
uses: JoeyTeng/codex-review-gate-action@v2
```

Copied workflows 分别负责 triggers、最小 permissions、独立 per-PR concurrency、typed
`workflow_dispatch`、runner 分配前的 exact Codex-bot filtering，以及受保护 repository
configuration。Action 仅访问 API，绝不 checkout 或执行 PR code。V2 没有 commit-status
bridge；只有 verifier 在 feature-head SHA 上、且执行语义绑定 current test-merge 的
native CheckRun 能满足 gate。

Required CheckRun 是 `codex/github-review-gate`。Importable ruleset 把它绑定到 GitHub
Actions（`integration_id: 15368`），要求 branch up to date、all review conversations
resolved、阻止 default-branch non-fast-forward updates，并且没有 bypass actors。
不支持 “Any source”。

安装请读[人类指南](docs/install/human.zh-CN.md)或
[Agent 执行手册](docs/install/agent.zh-CN.md)。两者执行同一套 two-PR rollout：一个
migration PR 移除 v1 并安装 v2，然后用独立无害 canary PR 证明 live gate，最后关闭
canary、不合并。

## Bootstrap

先选择一个对 consumer repository 拥有 `write`、`maintain` 或 `admin` 权限的
control-plane owner，再 dry run 并显式 apply 到 consumer worktree。Generic
quickstart 的每个阶段都必须显式传入同一个 owner：

```bash
CONTROL_PLANE_OWNER=@USER
node scripts/bootstrap-codex-review-gate.mjs \
  --prepare-worktree /path/to/consumer \
  --control-plane-owner "$CONTROL_PLANE_OWNER"
node scripts/bootstrap-codex-review-gate.mjs \
  --prepare-worktree /path/to/consumer \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --apply
```

这个 quickstart 只完成 local preparation，不能授权或替代完整
[人类安装指南](docs/install/human.zh-CN.md)与
[Agent 执行手册](docs/install/agent.zh-CN.md)中的 repository-side preconditions、trusted-owner
synchronous merge transaction、legacy protection inventory、canary 与 activation
readbacks。不得只依据这个缩略示例执行 merge 或 activation。

Helper 默认的 `@JoeyTeng` 只适用于 Joey-owned repositories。其他仓库必须显式提供
自己的合格 `@USER`；generic installation 不得依赖这个默认值。后续 repository staging、
canary 与 activation 必须通过上面的某一份完整指南继续。

## 发布模型

Publisher infrastructure 必须先单独合并并通过 review，不能与 release intent 同一个
变更获取生产凭证。之后另开 PR，为一个 exact source commit 增加 deterministic
`release-manifest.json`。Source-repository publisher 会先验证并独立 materialize Action
两次；只有 privileged `publish` job 会进入 `marketplace-production` Environment，并等待
human approval。

批准后，publisher 使用窄范围安装的
`JoeyTeng/codex-review-gate-action-publisher` GitHub App 与专用 OpenPGP signing subkey，
创建 signed single-parent release commit、signed immutable full-version tag、immutable
GitHub Release、signed provenance assets；stable release 才会向前推进 `v2` 这样的
floating major alias。每个 durable object 都会 read back；partial state 只能按已验证
prefix 恢复，不能删除或 force-overwrite immutable history。

每个 SemVer 都有 immutable full tag 与 GitHub Release。Marketplace publication 只在每个
major 的第一个 stable release 手工 out-of-band 执行一次（从 `v2.0.0` 开始）；minor 与
patch release 只推进 `@v2`，不再操作 Marketplace。现有 v1 tags 与 consumers 保持有效且
冻结，直到各 consumer 主动 migration。

已发布的 `v2.1.0` payload 声明 `runs.using: node24`，floating `v2` alias 也解析到这份
immutable release。它不会追溯改变冻结的 v2.0 release contract，也不会自行授权删除 v1
bridge。

Importable template 与 helper 默认的 `full` ruleset profile 仍是普通 consumer 的
contract。只有 `Joey-Tools/codex-review-gate` 自身迁移可以显式在 remote 阶段使用
`--ruleset-profile status-only`，并搭配 `--legacy-bridge` 与独立的
`Must Pass Codex Review v2` rule。该新 rule 只增加 strict v2 status context；现有
source rule 继续保留 deletion、non-fast-forward、pull-request conditions 与 required
review-thread resolution。其 CODEOWNERS/owner projection 是 source control-plane ownership
与 drift detection 的 receipt material，不是实际强制的 Code Owner approval 或 stale-review
policy。
它不是通用 consumer 或 cohort template。source repository 使用 canonical v2 verifier 和
controller；其 repository-local v1 required status 和 temporary legacy bridge 均已退休。
该 bridge 已由独立的 source-only executor 使用已明确批准的 closure receipt SHA-256
`d7c3faee465b6af7325252fe70c2462be6c9e908885c976055e8d608ccb2c963`，并在每个本地 mutation
boundary 对 fresh two-round GitHub evidence 重新绑定成功后删除。已发布的 `v2.1.0` payload
与 closed-unmerged 历史 canary `#74` 仍只是证据输入，绝不是可独立使用的删除授权。source-only
executor 不可用于普通 consumer，也不得对当前 source default branch 重跑：它要求 exact
canonical bridge file，缺失即拒绝。安装指南中保留的历史 source-only flow 仅供审计和未来刻意
重新引入 bridge 时参考；它不影响 canonical bridge template 或 active cohort 的独立 cleanup。
删除 YAML 只能阻止普通的新 dispatch，不能承诺 GitHub 无法 rerun 历史 Actions run。历史
source-only flow 见 [人类安装指南](docs/install/human.zh-CN.md)；publisher recovery states 与
release-protection baseline 见 [docs/RELEASING.zh-CN.md](docs/RELEASING.zh-CN.md)。
