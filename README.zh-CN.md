# Codex Review Gate 源码仓库

语言：[British English (en-GB)](README.md) | [简体中文 (zh-CN)](README.zh-CN.md)

本仓库是 Codex Review Gate 的 canonical source。可发布的 JavaScript Action package 位于
`packages/action/`，release 会 materialize 到现有 Marketplace 仓库
[`JoeyTeng/codex-review-gate-action`](https://github.com/JoeyTeng/codex-review-gate-action)。

## 目录

- `packages/action/`：完整 Action release subtree，包括 root `action.yml` 与 JavaScript
  runtime；
- `templates/codex-gated-repo/`：canonical copied consumer workflow 与 Disabled
  importable ruleset；
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

V2 consumer 把
`templates/codex-gated-repo/.github/workflows/codex-review-gate.yml` 复制到目标仓库的
同一路径。Wrapper 调用兼容的 floating major：

```yaml
uses: JoeyTeng/codex-review-gate-action@v2
```

Copied wrapper 负责 triggers、最小 permissions、per-PR concurrency、typed
`workflow_dispatch`、runner 分配前的 exact Codex-bot filtering，以及受保护 repository
configuration。Action 仅访问 API，绝不 checkout 或执行 PR code。

Required status 是 `codex/github-review-gate`。Importable ruleset 把它绑定到 GitHub
Actions（`integration_id: 15368`），要求 branch up to date、all review conversations
resolved、阻止 default-branch non-fast-forward updates，并且没有 bypass actors。
不支持 “Any source”。

安装请读[人类指南](docs/install/human.zh-CN.md)或
[Agent 执行手册](docs/install/agent.zh-CN.md)。两者执行同一套 two-PR rollout：一个
migration PR 移除 v1 并安装 v2，然后用独立无害 canary PR 证明 live gate，最后关闭
canary、不合并。

## Bootstrap

先 dry run，再显式 apply 到 consumer worktree：

```bash
node scripts/bootstrap-codex-review-gate.mjs \
  --prepare-worktree /path/to/consumer
node scripts/bootstrap-codex-review-gate.mjs \
  --prepare-worktree /path/to/consumer \
  --apply
```

Canonical workflow 进入 consumer 默认分支后，以 Disabled 状态 stage ruleset：

```bash
node scripts/bootstrap-codex-review-gate.mjs --repo OWNER/REPO
node scripts/bootstrap-codex-review-gate.mjs --repo OWNER/REPO --apply
```

Activation 必须绑定 successful exact-head canary，并重新读取 evidence 与写入后的
ruleset：

```bash
node scripts/bootstrap-codex-review-gate.mjs \
  --repo OWNER/REPO \
  --apply \
  --activate \
  --canary-pr PR_NUMBER \
  --canary-head FULL_HEAD_SHA
```

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
