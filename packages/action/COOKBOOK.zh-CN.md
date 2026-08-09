# Codex Review Gate Cookbook

语言：[British English (en-GB)](COOKBOOK.md) | [简体中文 (zh-CN)](COOKBOOK.zh-CN.md)

## 正常使用路径

该路径适用于 workflow 已合入 repository default branch，且 ruleset 已要求 `codex/review-gate` 的仓库。

1. 打开或更新一个 ready PR。
2. Workflow 写入 `codex/review-gate = pending`，并发布受控 `@codex review` marker。
3. 等待 Codex 回复。
4. 后续完整运行会重新读取 PR、head 和 complete evidence。只有 stable reduction 选出
   强绑定 current head 的 official trusted clean artifact，且 current-head 或 ancestor
   findings 均不再 blocking，gate 才写入 `success`。
5. 已确认的 current-head 或 ancestor finding 仍存在时，gate 写入 `failure`。如果同时
   存在 evidence issue，failure summary 会说明它；只有没有 confirmed blocking finding
   时才使用 `error`。

为了让 request flow 更清晰，仓库可以关闭 Codex automatic review-on-push，以减少重复
reviews。Automatic 和 controlled-marker results 使用相同的 provider-evidence 规则；
marker 不会授权其中任一结果。

`success` 只表示本 required commit status 通过，不证明 named triple review 已完成，也
不证明 PR 整体 merge-ready。
机器可读的 authoritative reducer policy 是
[`decision-table.json`](decision-table.json)，`policy_version: 1.4.0`。

Commit Status 按 repository SHA/context 建立，不按 PR 隔离。多个 open PR 若共享 head，
就会共享 status 与 branch-protection signal，因此 status 本身不能证明 PR isolation。

## 校验 Action Provenance

Review 或 readiness skill 需要依赖 gate 时，使用以下路径。必须把 run-attempt
head domain 与 current-PR/status head domain 分开校验；它们的机器可读权威合同是
[`decision-table.json`](decision-table.json) 中的
`producer_receipt_boundary`：

1. 确认 repository workflow 使用 release notes/provenance manifest 发布的值，pin
   `JoeyTeng/codex-review-gate-action@<exact-action-repository-40-sha>`。Floating
   `@v1.4` 或 `@v1` 只是 convenience aliases，不能作为 provenance。
2. 对 exact run 与 attempt-specific name
   `codex-review-gate-producer-receipt-<run_id>-<attempt>` 查询 Artifact API，并要求
   `total_count == 1`。Artifact missing、expired、deleted、duplicate 或 upload failed 都
   必须 fail closed。这是 consumer inventory guarantee；producer 对 finalized run
   attempt 只执行一次 action-level、`overwrite: false` upload attempt。
3. Outputs 可用时，把 REST artifact ID 与 output ID 比对。构造
   `<server>/<repository>/actions/runs/<run_id>/artifacts/<artifact_id>` web URL 后与 output
   比对；不得直接比较作为 API URL 的 REST artifact `.url`。REST `.digest` 必须等于
   `sha256:` 加 raw 64-hex output digest。下载 artifact、校验 digest，并要求其中恰好一个
   名为 `codex-review-gate-producer-receipt.json` 的文件。使用 exact pinned published
   action commit root 的 `producer-receipt.schema.json` 校验；它在本 source repository
   中的路径是 `packages/action/producer-receipt.schema.json`。Schema 虽允许 finalized
   `completed` 与 `failed` receipt，这条 positive path 仍必须要求
   `execution.result == completed`；`failed` receipt 对 positive decision 只能作为 audit。
4. 要求 GitHub.com、exact run/attempt/attempt-specific target URL、current repository 与
   exact expected action repository 和 40-SHA with `immutable: true`，以及所有
   expected environment/workflow/job fields。`job.workflow_*` fields 仅适用于 GitHub.com。
   通过 attempt-specific Workflow Run request endpoint 取得 attempt；response `url` 与
   `html_url` 仍是 base-run resource URLs，不必等于 attempt-specific status target。在
   run-attempt head domain 中，exact run-attempt response `head_sha` 必须等于
   `receipt.producer.environment.GITHUB_WORKFLOW_SHA`；Artifact API record 的
   `workflow_run.id` 与 `workflow_run.head_sha` 必须分别等于 exact run-attempt
   response 的 `id` 与 `head_sha`。
5. 在 current-PR/status head domain 中，通过 REST 列出所有 Commit Status records
   时，request `ref` 必须等于 exact current PR head；selected status 必须来自该
   exact-head response。选择 case-insensitive logical context 的 latest record；随后要求 configured expected
   context 的 exact spelling（默认为 `codex/review-gate`），并要求 creator 精确为
   `github-actions[bot]` 且 type 为 `Bot`。为 current PR 选择唯一 matching receipt
   `statuses[]` member；它不一定是最后一个 member。其 `head_sha` 必须等于
   exact current PR head；PR number、ID、node ID、context、state、target URL 与 creator
   必须全部相同。Positive decision 要求 selected
   REST record 与 receipt member 都满足 exact `status.state == success`，且 selected
   member 的 creator 也必须独立为 exact `github-actions[bot]` / `Bot`。Membership 缺失或
   不唯一时 fail closed。
6. 通过 GraphQL 把该 node 重读为 `StatusContext`，并独立确认相同的 exact context、
   state 与 target URL。`StatusContext.commit.oid` 必须等于 exact current PR head，
   因此也必须等于 selected receipt status `head_sha`。GraphQL creator 还必须独立精确为
   `github-actions[bot]` 且 type 为 `Bot`；仅 creator 彼此一致并不充分。
   Exact run-attempt/artifact `head_sha` 可以合法地与这个 current PR/status head 不同；
   禁止要求两个 head domain 相等。
7. 为 selected receipt member 指定的同一个 PR，独立重新加载并归约 official provider
   evidence。Receipt v1 只是 causal producer evidence；它不证明 clean evidence，也不
   替代 provider reduction。
8. Readiness 消费前，最后一次通过 REST 重列 exact-head statuses。Case-insensitive
   logical latest 必须仍是相同 REST ID/node ID 与 exact context。同时 stable re-read PR
   head/lifecycle、exact run-attempt metadata 与使用 attempt-specific name 查询的
   run-level artifact inventory；inventory 仍须恰好一个 artifact，所有 bindings 与独立 provider reduction 也必须保持
   stable。发生变化时有界重试，随后 fail closed。

Status POST 与 artifact upload 不是 atomic，artifact 也可能过期或被删除。Receipt v1
及其 digest 不是 cryptographic signature、OIDC attestation 或 content-addressed storage
guarantee。链路任一环不可用或无效时都必须 fail closed。Exact creator checks 仍可被
持有 `statuses: write` 的 workflow spoof；只有已校验的 receipt/run chain 提供 causal
consistency。这些 point-in-time checks 不能消除 TOCTOU，也不能把 per-SHA/context status
变成 PR-specific proof。

## Failed Findings 恢复

当 `codex/review-gate` 因 `failed_findings` 处于 `failure` 时，使用该路径。

1. 在代码中处理 current-head 或 ancestor finding，或确认它不需要代码修改。
2. 对 exact joined review thread，在 GitHub 中 resolve 该 thread。只有 authoritative
   `isResolved` 精确为 `true` 才能关闭 finding；`isOutdated` 和 later clean result 都
   不能关闭它。
3. 确认当前 head 已有 strongly bound official clean artifact。Clean issue comment 必须
   恰好包含一个 `Reviewed commit` marker；pull request review 通过原生完整
   `commit_id` 绑定，正文中的 hash 必须一致。如果没有 clean，发布 `@codex review` 是
   请求新 review 最清楚的方式。
4. 让 Codex comment/review event 唤醒 gate，或为该 PR 手动运行 workflow。
5. Gate 会重建并最终重新读取 complete evidence snapshot。只有 PR、head、complete
   evidence 和 reduction 均保持 stable，且不再有 blocking finding 时，才写入
   `success`。

较早的 threadless same-head 或 ancestor finding，只有 strictly later selected
current-head clean 才能 supersede。已证明属于 non-ancestor 的 finding 会保留作审计、从
blocking set 移除，再重新归约 evidence。Ancestry 经有界重试仍未知时，稳定结果为带
`ancestry-unverified` 的 `error`。

Issue comment 以 validated `updated_at` 作为 revision time。两个 issue comments 处于同一
revision second 时一律 ambiguous 并 fail closed；`created_at == updated_at` 不能证明没有
同秒 edit，因此 ID 绝不打破该平局。Same-time pull-request reviews 只在 review channel
内使用较大的 canonical ID；cross-channel tie 仍 ambiguous。

该恢复路径是 event-driven 的。它不会增加 polling 或 scheduled runner minutes。

Marker deadline、已关闭的 marker state、baseline 或 recovery cutoff 都不能拒绝其他方面
有效的 provider artifact。即使 clean artifact 在 marker deadline 后才到达，后续完整
运行仍可通过。

## 等待和 Evidence Errors

- Valid `Codex Review in progress` 或 `still in progress` artifact 会在现有 marker 和
  deadline 下保持 pending；它不会 acknowledge marker、reset 或延长 deadline，也不会
  触发 repost。
- `eyes` 可以把 `waiting_ack` 推进到 `waiting_result`，但不会延长 deadline。`+1` 只
  用于审计，不具备 verdict authority。
- 默认值保持不变：initial acknowledgement 300 秒、maximum acknowledgement backoff
  1,800 秒、acknowledged result 3,600 秒、overall 7,200 秒。
- Transient acquisition 或 reconciliation faults 会先经过有界重试，再写入稳定
  `error`。Deterministically malformed evidence 同样写 `error`。Confirmed finding 与
  evidence error 共存时，结果是 `failure`，且 summary 会说明 evidence issue。

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

手动恢复仍然 fail-closed：unstable 或 incomplete evidence 不能通过。Confirmed
current-head 或 ancestor finding 保持 `failure`；没有 confirmed finding 时，经过有界
重试仍无法取得或 reconcile 的 evidence 会变成 `error`。Marker 或 recovery history
不会 veto 其他方面 valid 且 stable 的 current-head clean artifact。
