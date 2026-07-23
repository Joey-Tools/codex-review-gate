# Codex Review Gate Cookbook

语言：[British English (en-GB)](COOKBOOK.md) | [简体中文 (zh-CN)](COOKBOOK.zh-CN.md)

## 正常使用路径

该路径适用于 workflow 已合入 repository default branch，且 ruleset 已要求 `codex/review-gate` 的仓库。

1. 打开或更新一个 ready PR。
2. Workflow 写入 `codex/review-gate = pending`，并发布受控 `@codex review` marker。
3. 等待 Codex 回复。
4. 如果 Codex 发布 authorised current-head clean result，且历史上所有 thread-backed Codex findings 均已 resolved，gate 写入 `success`。
5. 如果历史上任一 thread-backed finding 仍 unresolved，gate 会写入 `failure`，或保持 pending 直到 finding path 被评估。`isOutdated` 本身不等于 resolved。

为了让信号最干净，建议关闭 Codex automatic review-on-push，只让 controlled marker 为当前 head 请求 review。

## Failed Findings 恢复

当 `codex/review-gate` 因 `failed_findings` 处于 `failure` 时，使用该路径。

1. 在代码中处理 finding，或确认该 finding 不需要代码修改。
2. 在 GitHub 中 resolve Codex review thread。
3. 请求或等待同一 head 的 Codex clean top-level issue comment。发布 `@codex review` 是创建 fresh signal 最清楚的方式。
4. 当 Codex 发布 top-level clean completion comment 时，`issue_comment` workflow 会唤醒 gate。
5. 如果 `failed-findings-recovery` 已启用、当前精确 `issue_comment` trigger 与 selected clean result 匹配、该 result 晚于 failed marker close time，且历史上所有 thread-backed findings 均已 resolved，gate 会写入 `success`。

该恢复路径是 event-driven 的。它不会增加 polling 或 scheduled runner minutes。

## 恢复开关

`failed-findings-recovery` 默认启用。如果仓库不希望使用狭窄的 same-head、no-active-marker issue-comment recovery path，可以关闭它。Active controlled-marker result 和对 previously passed marker 的 exact reassertion 不受影响。

```yaml
with:
  failed-findings-recovery: ${{ vars.CODEX_REVIEW_GATE_FAILED_FINDINGS_RECOVERY }}
  failed-findings-recovery-mode: ${{ vars.CODEX_REVIEW_GATE_FAILED_FINDINGS_RECOVERY_MODE }}
```

把 `CODEX_REVIEW_GATE_FAILED_FINDINGS_RECOVERY=false` 设为 repository 或 organization variable，可以在 action 启动前关闭该路径。Runtime environments 也可以设置 `FAILED_FINDINGS_RECOVERY=false`；两者同时存在时 action input 优先生效。

`failed-findings-recovery-mode` 控制一个 same-head clean signal 能否在 blocked recovery attempt 之后被重新评估：

- `head` 是默认值。如果历史上所有 thread-backed Codex findings 现在都已 resolved，rerun 精确匹配的 qualifying clean comment event 可以恢复 status。
- `fresh` 会记录一次因 findings 仍存在而被拒绝的 recovery attempt 时间。早于或等于该 rejected attempt 创建的 clean completion comments 之后都不能通过；resolve findings 后，需要请求新的 Codex review，并等待更新的 clean completion comment。

如果希望 gate 表达“最新 head 的 Codex review result 已经 clean”，使用 `head`。如果希望每次 resolved-findings recovery 都绑定到 blocked recovery attempt 之后创建的新 clean comment，使用 `fresh`。

## 手动恢复

当 event-driven recovery 被关闭、没有可用的 Codex clean completion comment，或 operator 想明确重新评估某个 PR 时，使用 `workflow_dispatch`。

1. 打开 `Codex Review Gate` workflow。
2. 手动运行 workflow，并填写 PR number。
3. Gate 会重新加载当前 GitHub evidence，并从 sticky state 推进 state machine。

手动恢复仍然 fail-closed：如果历史上任一 thread-backed Codex finding 仍 unresolved，status 会保持或变成 `failure`。Manual run 可以恢复 marker state，但不会直接使用 no-active-marker issue-comment recovery exception。
