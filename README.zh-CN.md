# Codex Review Gate Source

语言：[British English (en-GB)](README.md) | [简体中文 (zh-CN)](README.zh-CN.md)

本仓库是 Codex Review Gate 的源码工作区。GitHub Action package 位于
[packages/action](packages/action/README.zh-CN.md)，该目录也是发布到
[JoeyTeng/codex-review-gate-action](https://github.com/JoeyTeng/codex-review-gate-action)
的 subtree 边界。

## 目录结构

- `packages/action/`: 完整 Marketplace action package。发布仓库的 root 由这个目录生成。
- `test/`: 源码仓库里的 action state machine、GitHub runner 和 repository bootstrap helper 测试。
- `src/bootstrap.mjs`: repository ruleset bootstrap 的共享逻辑。
- `scripts/bootstrap-codex-review-gate.mjs`: 创建或更新要求 `codex/review-gate` 的 repository ruleset 的 CLI helper。
- `templates/codex-gated-repo/`: 已预装 gate workflow 的语言无关 starter repository。
- `.github/workflows/`: 源码仓库 CI 和 self-gating workflows。
- `docs/RELEASING.zh-CN.md`: subtree split 发布流程。

## 开发

在 repository root 运行源码检查：

```bash
npm run check
npm test
```

单独检查 action package：

```bash
npm run check:action
```

只检查 bootstrap helper：

```bash
npm run check:bootstrap
npm run test:bootstrap
```

## Gated Repository Bootstrap

新仓库可以从 `templates/codex-gated-repo` 的语言无关 template source 开始，
或直接使用 GitHub template repository
[`Joey-Tools/codex-gated-repo-template`](https://github.com/Joey-Tools/codex-gated-repo-template)。
Template 只保留 gate workflow 和基础仓库脚手架；项目自己的 CI 需要单独添加。

目标仓库 default branch 上已有 workflow 后，从本源码仓库运行 bootstrap helper。
它默认 dry-run，会先确认 `.github/workflows/codex-review-gate.yml` 是 default branch
上的 workflow 文件，再创建或更新要求 GitHub Actions source 的 `codex/review-gate`
repository ruleset。

```bash
node scripts/bootstrap-codex-review-gate.mjs --repo OWNER/REPO
node scripts/bootstrap-codex-review-gate.mjs --repo OWNER/REPO --apply
```

只有在仓库刻意接受任意 source 的 required status 时，才使用 `--integration-id any`。

## 发布模型

发布仓库不再通过从源码仓库 root 手工复制 allowlist 维护。`packages/action` 是固定
subtree 边界。使用 `scripts/release-action-subtree.sh` 校验源码树，并计算发布到 action
仓库的 split commit。

Canonical GitHub.com workflow 通过兼容的 v1 selector，把 privileged job 委派给
集中部署的 reusable workflow：

```yaml
jobs:
  codex-review-gate:
    name: codex/review-gate runner
    uses: JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1
```

Floating `@v1` 是刻意设计的集中式执行前信任边界，并不是运行后的 immutable
provenance。Consumer 从 exact run attempt 解析 GitHub server 选中的 called-workflow
object，并且只有在受信 signer 签名的 compatible v1.x.y immutable release 及其完整
provenance-v2 tree/protocol bindings 全部通过后才接纳。这样 compatible v1.x Action
release 可以集中升级，不需要修改 caller 或 consuming Skill。

Direct composite interface 继续用于 GitHub Enterprise Server 和 immutable audit；应 pin
到 exact v1.5.1 Action release commit：

```yaml
- uses: JoeyTeng/codex-review-gate-action@59eeda2af2a7baab3f3f15a59fbbaee015fa6c01
```

`codex/review-gate` 只报告本 action 的 required commit-status 结果；它不证明 named
triple review 已完成，也不证明 PR 整体 merge-ready。完整约束见
[action 语义](packages/action/README.zh-CN.md#它检查什么)和
[evidence reconciliation 设计](packages/action/DESIGN.zh-CN.md#evidence-reconciliation)。
v1 producer receipt 为 exact direct 或 reusable invocation 提供 causal producer
evidence，但 consumer 必须校验 run-attempt artifact、called-workflow W/C mapping 与
signed immutable release provenance，然后继续独立归约 provider evidence；见
[invocation provenance](packages/action/README.zh-CN.md#invocation-provenance)。
`v1.5.1`、`v1.4.0` 等 immutable tags 与既有 `v1.3.x` releases 都会保留，供审计和回滚使用。

完整流程见 [docs/RELEASING.zh-CN.md](docs/RELEASING.zh-CN.md)。
