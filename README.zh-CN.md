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

- `.github/workflows/codex-review-gate.yml` 是只读 `pull_request` verifier；它在 PR
  test-merge SHA 上生成 GitHub-managed job CheckRun
  `codex/github-review-gate`，这就是 required signal。
- `.github/workflows/codex-review-gate-controller.yml` 是受保护 default branch 上的
  controller；它接收 exact Codex events 与 typed manual operations、创建 review request，
  并在需要 reconcile 时建立严格更新的 full verifier attempt。

两份 workflows 都调用兼容的 floating major：

```yaml
uses: JoeyTeng/codex-review-gate-action@v2
```

Copied workflows 分别负责 triggers、最小 permissions、独立 per-PR concurrency、typed
`workflow_dispatch`、runner 分配前的 exact Codex-bot filtering，以及受保护 repository
configuration。Action 仅访问 API，绝不 checkout 或执行 PR code。V2 没有 commit-status
bridge；只有 verifier 在 PR test-merge SHA 上的 native CheckRun 能满足 gate。

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

初次 infrastructure landing 期间，source repository 的 live v1 self-gate 会保留到
`@v2` alias 已发布。完整 staged flow、recovery states 与 protection baseline 见
[docs/RELEASING.zh-CN.md](docs/RELEASING.zh-CN.md)。
