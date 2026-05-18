# 发布 Action Package

Marketplace 仓库是 `packages/action` 的 subtree split。任何需要出现在 `JoeyTeng/codex-review-gate-action` root 的文件，都应保留在这个目录内。

## 前置条件

- 源码仓库位于要发布的 commit。
- `packages/action/package.json` 已包含发布版本。
- action remote 已配置，例如：

```bash
git remote add action git@github.com:JoeyTeng/codex-review-gate-action.git
```

## 校验和 Split

在源码仓库 root 运行：

```bash
npm run release:split
```

脚本会运行源码检查、action package 检查、测试和 whitespace validation，然后打印 subtree split commit。

如果要同时把 split commit 推到 action 仓库 default branch：

```bash
scripts/release-action-subtree.sh --remote action --branch master --push
```

## Tags

Action consumer tags 必须指向 action 仓库历史里的 commit，而不是源码仓库 commit。推送并校验 action 仓库 commit 后，再有意地创建或更新 release tags。

Patch release 先推不可变 patch tag：

```bash
git push action <split-commit>:refs/tags/v1.2.1
```

只有确认 action 仓库 default branch 指向预期 split commit 后，才移动 `v1.2`、`v1` 这类 compatibility tags。

## 为什么用 Subtree

`packages/action` 是稳定 package 边界，目录内容可以直接作为 repository root。因此 `git subtree split --prefix=packages/action` 就是直接的发布操作。测试、CI workflows 和源码仓库协作内容留在发布包之外。
