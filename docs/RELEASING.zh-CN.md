# 发布 Action Package

Marketplace 仓库是 `packages/action` 的 subtree split。任何需要出现在 `JoeyTeng/codex-review-gate-action` root 的文件，都应保留在这个目录内。

## 前置条件

- 源码仓库位于要发布的 commit。
- `packages/action/package.json` 已包含发布版本。
- action 仓库已配置 write-enabled deploy key，且源码仓库把 private key 存为 `ACTION_REPO_DEPLOY_KEY` secret。同步 workflow 也兼容既有 `ACTION_REPO_PUSH_TOKEN` secret 名称，可在当前 repo 配置迁移完成前继续用它保存 private key。
- 如果要本地手动发布，action remote 已配置，例如：

```bash
git remote add action git@github.com:JoeyTeng/codex-review-gate-action.git
```

## 自动同步 Default Branch

`.github/workflows/sync-action-subtree.yml` 会在 `master` push 且变更触及 `packages/action/**`、同步 workflow 或 release split 脚本时运行。它会 checkout 完整历史，执行 `scripts/release-action-subtree.sh --remote action --branch master --push --force-if-equivalent-parent`，只把计算出的 subtree split commit 推到 `JoeyTeng/codex-review-gate-action:master`。

该 workflow 不创建 GitHub Releases，也不创建或移动 tags。它通常使用 fast-forward push；只有当 action 仓库分支不是 computed split commit 的祖先、且该分支 tree 和 split commit tree 或 split commit 的 parent tree 完全一致时，才会使用 `--force-with-lease`，用于处理源码仓 squash merge 造成的等价 subtree histories。如果缺少 deploy-key secret、action 仓库拒绝 direct push，或 action 仓库分支内容已经偏离，workflow 会失败而不是执行不安全的强制更新。

Manual workflow dispatch 默认只校验 split。只有明确设置 `push_to_action_repo=true` 时，才会让 workflow 推送 split commit。

## 手动校验和 Split

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
