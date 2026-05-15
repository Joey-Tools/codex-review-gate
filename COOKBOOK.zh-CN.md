# Codex Review Gate Cookbook

语言：[British English (en-GB)](COOKBOOK.md) | [简体中文 (zh-CN)](COOKBOOK.zh-CN.md)

## 正常使用路径

该路径适用于 workflow 已合入 repository default branch，且 ruleset 已要求 `codex/review-gate` 的仓库。

1. 打开或更新一个 ready PR。
2. Workflow 写入 `codex/review-gate = pending`，并发布受控 `@codex review` marker。
3. 等待 Codex 回复。
4. 如果 Codex 发布 top-level clean completion comment，且没有 current-head Codex findings，gate 写入 `success`。
5. 如果 Codex 发布 unresolved current-head findings，gate 会写入 `failure`，或保持 pending 直到 finding path 被评估。

为了让信号最干净，建议关闭 Codex automatic review-on-push，只让 controlled marker 为当前 head 请求 review。

## Failed Findings 恢复

当 `codex/review-gate` 因 `failed_findings` 处于 `failure` 时，使用该路径。

1. 在代码中处理 finding，或确认该 finding 不需要代码修改。
2. 在 GitHub 中 resolve Codex review thread。
3. 请求一次新的 Codex review，例如发布 `@codex review`。
4. 当 Codex 之后发布 top-level clean completion comment 时，`issue_comment` workflow 会唤醒 gate。
5. 如果 `failed-findings-recovery` 已启用，且 PR 没有 unresolved 或 not-outdated current-head Codex findings，gate 会写入 `success`。

该恢复路径是 event-driven 的。它不会增加 polling 或 scheduled runner minutes。

## 恢复开关

`failed-findings-recovery` 默认启用。如果某个仓库希望 `failed_findings` 在 review threads resolved 之后仍必须通过新 commit 或 manual dispatch 恢复，可以关闭它。

```yaml
with:
  failed-findings-recovery: ${{ vars.CODEX_REVIEW_GATE_FAILED_FINDINGS_RECOVERY }}
```

把 `CODEX_REVIEW_GATE_FAILED_FINDINGS_RECOVERY=false` 设为 repository 或 organization variable，可以在 action 启动前关闭该路径。Runtime environments 也可以设置 `FAILED_FINDINGS_RECOVERY=false`；两者同时存在时 action input 优先生效。

## 手动恢复

当 event-driven recovery 被关闭、没有新的 Codex clean completion comment，或 operator 想明确重新评估某个 PR 时，使用 `workflow_dispatch`。

1. 打开 `Codex Review Gate` workflow。
2. 手动运行 workflow，并填写 PR number。
3. Gate 会重新加载当前 GitHub evidence，并从 sticky state 推进 state machine。

手动恢复仍然 fail-closed：如果仍有 unresolved current-head Codex findings，status 会保持或变成 `failure`。
