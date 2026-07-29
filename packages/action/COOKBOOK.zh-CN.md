# Codex Review Gate Cookbook

语言：[British English (en-GB)](COOKBOOK.md) | [简体中文 (zh-CN)](COOKBOOK.zh-CN.md)

## 正常使用路径

该路径适用于 workflow 已合入 repository default branch，且 ruleset 已要求 `codex/review-gate` 的仓库。

1. 打开或更新一个 ready PR。
2. Workflow 写入 `codex/review-gate = pending`，并发布受控 `@codex review` marker。
3. 等待 Codex 回复。
4. 后续完整运行中，如果 latest official trusted provider artifact 符合封闭 clean
   grammar、绑定 current head，且历史上所有 thread-backed Codex findings 均已
   resolved，gate 会写入 `success`。
5. 如果历史上任一 thread-backed finding 仍 unresolved，gate 会写入 `failure`，或保持 pending 直到 finding path 被评估。`isOutdated` 本身不等于 resolved。

为了让 request flow 更清晰，仓库可以关闭 Codex automatic review-on-push，以减少重复
reviews。Automatic 和 controlled-marker results 使用相同的 provider-evidence 规则；
marker 不会授权其中任一结果。

## Failed Findings 恢复

当 `codex/review-gate` 因 `failed_findings` 处于 `failure` 时，使用该路径。

1. 在代码中处理 finding，或确认该 finding 不需要代码修改。
2. 在 GitHub 中 resolve Codex review thread。
3. 确认当前 head 已有 official clean artifact；如果没有，发布 `@codex review` 是请求
   新 review 最清楚的方式。
4. 让 Codex comment/review event 唤醒 gate，或为该 PR 手动运行 workflow。
5. Gate 会重建完整 evidence snapshot。当 latest official trusted closed-grammar clean
   artifact 绑定 current head，且历史上所有 thread-backed findings 均已 resolved 时，
   gate 会写入 `success`。

该恢复路径是 event-driven 的。它不会增加 polling 或 scheduled runner minutes。

Marker deadline、已关闭的 marker state、baseline 或 recovery cutoff 都不能拒绝其他方面
有效的 provider artifact。即使 clean artifact 在 marker deadline 后才到达，后续完整
运行仍可通过。

## Deprecated Recovery Controls

为了让现有 workflow 和 stored state 继续可加载，v1 inputs 仍然保留：

```yaml
with:
  failed-findings-recovery: ${{ vars.CODEX_REVIEW_GATE_FAILED_FINDINGS_RECOVERY }}
  failed-findings-recovery-mode: ${{ vars.CODEX_REVIEW_GATE_FAILED_FINDINGS_RECOVERY_MODE }}
```

`failed-findings-recovery`、`failed-findings-recovery-mode` 及对应的 repository
variable/environment 形式都是 deprecated compatibility controls。Action 会继续接受并
校验它们的 v1 取值，但这些取值不再改变 gate decision 或 request orchestration。
Sticky state 中已有的 legacy fields 仍作为 audit data 保留。尤其是 `head`、`fresh`、
关闭 recovery switch 或已记录 recovery cutoff，都不能决定 latest valid
current-head clean result 通过或失败。

## 手动恢复

当没有 provider event 唤醒 workflow，或 operator 想明确重新评估某个 PR 时，使用
`workflow_dispatch`。

1. 打开 `Codex Review Gate` workflow。
2. 手动运行 workflow，并填写 PR number。
3. Gate 会重新加载当前 GitHub evidence，并从完整 snapshot 计算结果；stored sticky
   state 只用于恢复 request orchestration。

手动恢复仍然 fail-closed：snapshot 不完整时不能通过；历史上任一 thread-backed Codex
finding 仍 unresolved 时，status 会保持或变成 `failure`。Marker 或 recovery history
不会 veto latest valid current-head clean artifact。
