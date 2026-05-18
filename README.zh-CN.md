# Codex Review Gate Source

语言：[British English (en-GB)](README.md) | [简体中文 (zh-CN)](README.zh-CN.md)

本仓库是 Codex Review Gate 的源码工作区。GitHub Action package 位于 [packages/action](packages/action/README.zh-CN.md)，该目录也是发布到 [JoeyTeng/codex-review-gate-action](https://github.com/JoeyTeng/codex-review-gate-action) 的 subtree 边界。

## 目录结构

- `packages/action/`: 完整 Marketplace action package。发布仓库的 root 由这个目录生成。
- `test/`: 源码仓库里的 action state machine 和 GitHub runner 测试。
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

## 发布模型

发布仓库不再通过从源码仓库 root 手工复制 allowlist 维护。`packages/action` 是固定 subtree 边界。使用 `scripts/release-action-subtree.sh` 校验源码树，并计算发布到 action 仓库的 split commit。

完整流程见 [docs/RELEASING.zh-CN.md](docs/RELEASING.zh-CN.md)。
