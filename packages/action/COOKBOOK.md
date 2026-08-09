# Codex Review Gate Cookbook

Languages: [British English (en-GB)](COOKBOOK.md) | [简体中文 (zh-CN)](COOKBOOK.zh-CN.md)

## Normal Path

Use this path after the workflow is merged to the repository default branch and `codex/review-gate` is required by the ruleset.

1. Open or update a ready PR.
2. The workflow writes `codex/review-gate = pending` and posts a controlled `@codex review` marker.
3. Wait for Codex to respond.
4. On the next complete run, the gate re-reads the PR, head, and complete
   evidence and writes `success` only when the stable reduction selects an
   official trusted clean artifact strongly bound to the current head and no
   current-head or ancestor finding remains blocking.
5. If a confirmed current-head or ancestor finding remains, the gate writes
   `failure`. A simultaneous evidence issue is included in the failure summary;
   `error` is used only when no confirmed blocking finding exists.

For the clearest request flow, repositories may disable Codex automatic
review-on-push to reduce duplicate reviews. Automatic and controlled-marker
results are evaluated by the same provider-evidence rules; the marker does not
authorise either result.

`success` means only that this required commit status passed. It does not
attest a named triple review or the PR's overall merge readiness.
The authoritative machine-readable reducer policy is
[`decision-table.json`](decision-table.json), `policy_version: 1.4.0`.

Commit Status is per repository SHA/context, not per PR. Multiple open PRs
with the same head share the status and branch-protection signal, so the status
itself cannot prove PR isolation.

## Verify Action Provenance

Use this path when a review or readiness skill needs to rely on the gate. Keep
the run-attempt head domain separate from the current-PR/status head domain;
their authoritative machine-readable contract is `producer_receipt_boundary`
in [`decision-table.json`](decision-table.json):

1. Confirm the repository workflow pins
   `JoeyTeng/codex-review-gate-action@<exact-action-repository-40-sha>` using
   the value published in the release notes/provenance manifest. Reject
   floating `@v1.4` or `@v1` as provenance; they are convenience aliases.
2. For the exact run and attempt-specific name
   `codex-review-gate-producer-receipt-<run_id>-<attempt>`, query the Artifact
   API and require `total_count == 1`. A missing, expired, deleted, duplicate,
   or upload-failed artifact is a fail-closed result. This is a consumer
   inventory guarantee; the producer only makes one action-level,
   `overwrite: false` upload attempt for a finalized run attempt.
3. When outputs are available, match the REST artifact ID to the output ID.
   Construct
   `<server>/<repository>/actions/runs/<run_id>/artifacts/<artifact_id>` and
   match that web URL to the output; do not compare the REST artifact `.url`,
   which is an API URL. Require REST `.digest` to equal `sha256:` plus the raw
   64-hex output digest. Download the artifact, verify its digest, and require
   exactly one file named `codex-review-gate-producer-receipt.json`. Validate
   it against `producer-receipt.schema.json` at the root of the exact pinned
   published action commit; its path in this source repository is
   `packages/action/producer-receipt.schema.json`. Although the schema permits
   finalized `completed` and `failed` receipts, this positive path requires
   `execution.result == completed`; a `failed` receipt is audit-only for a
   positive decision.
4. Require GitHub.com, exact run/attempt/attempt-specific target URL, current
   repository, exact expected action repository and 40-SHA with
   `immutable: true`, and all expected environment/workflow/job fields. The
   `job.workflow_*` fields are GitHub.com-only. Fetch the attempt through the
   attempt-specific Workflow Run request endpoint; its response `url` and
   `html_url` remain base-run resource URLs and need not equal the
   attempt-specific status target. Within the run-attempt head domain, require
   the exact run-attempt response `head_sha` to equal
   `receipt.producer.environment.GITHUB_WORKFLOW_SHA`. Require the Artifact API
   record's `workflow_run.id` and `workflow_run.head_sha` to equal the exact
   run-attempt response `id` and `head_sha`, respectively.
5. Within the current-PR/status head domain, REST-list all Commit Status
   records with the request `ref` equal to the exact current PR head; the
   selected status must come from that exact-head response. Select the
   case-insensitive logical context's latest record, then require the exact
   configured context spelling (`codex/review-gate` by default) and creator
   `github-actions[bot]` with type `Bot`. Select the unique matching receipt
   `statuses[]` member for the current PR—not necessarily the last member—and
   require its `head_sha` to equal the exact current PR head. Require the same
   PR number, ID, node ID, context, state, target URL, and creator. A positive
   decision requires exact
   `status.state == success` for the selected REST record and receipt member.
   The selected member's creator must independently be exact
   `github-actions[bot]` with type `Bot`. Missing or non-unique membership
   fails closed.
6. Re-read that node as a GraphQL `StatusContext` and independently confirm the
   same exact context, state, and target URL. Require
   `StatusContext.commit.oid` to equal the exact current PR head and therefore
   the selected receipt status `head_sha`. Its creator must independently be
   exactly `github-actions[bot]` with type `Bot`; creator agreement alone is
   insufficient. The exact run-attempt/artifact `head_sha` may legitimately
   differ from this current PR/status head; never require equality between the
   two head domains.
7. Independently reload and reduce official provider evidence for the same PR
   named by the selected receipt member. Receipt v1 is causal producer evidence
   only; it does not prove clean evidence or replace provider reduction.
8. Immediately before readiness consumes the result, final-REST-list the
   exact-head statuses. The case-insensitive logical latest must remain the
   same REST ID/node ID with the exact context. Stably re-read PR
   head/lifecycle, exact run-attempt metadata, and the run-level artifact
   inventory queried with the attempt-specific name, which must still contain
   exactly one artifact; every
   binding and the independent provider reduction must remain stable. Changes
   receive bounded retry and then fail closed.

The status POST and artifact upload are not atomic, and artifacts can expire or
be deleted. Receipt v1 and its digest are not a cryptographic signature, OIDC
attestation, or content-addressed storage guarantee. Any unavailable or invalid
link in this chain fails closed. Exact creator checks remain spoofable with
`statuses: write`; only the validated receipt/run chain adds causal
consistency. These point-in-time checks do not eliminate TOCTOU or turn a
per-SHA/context status into PR-specific proof.

## Failed Findings Recovery

Use this path when `codex/review-gate` is `failure` with `failed_findings`.

1. Address the current-head or ancestor finding in code, or decide that it is
   not actionable.
2. For an exact joined review thread, resolve that thread in GitHub. Only its
   authoritative `isResolved` value being exactly `true` closes the finding;
   `isOutdated` and a later clean result do not.
3. Make sure a strongly bound official clean artifact exists for the current
   head. A clean issue comment needs exactly one `Reviewed commit` marker. A
   pull request review binds through its native full `commit_id`, and any body
   hash must agree. If no clean exists, posting `@codex review` is the clearest
   way to request one.
4. Let a Codex comment or review event wake the gate, or run the workflow
   manually for the PR.
5. The gate rebuilds and finally re-reads the complete evidence snapshot. It
   writes `success` only when the PR, head, complete evidence, and reduction
   remain stable and no blocking finding remains.

An older threadless same-head or ancestor finding is superseded only by the
strictly later selected current-head clean. A finding proven to be on a
non-ancestor is retained for audit, removed from the blocking set, and the
evidence is reduced again. If ancestry remains unknown after bounded retries,
the stable result is `error` with `ancestry-unverified`.

For issue comments, `updated_at` is the validated revision time. Two issue
comments in the same revision second are always ambiguous and fail closed;
`created_at == updated_at` cannot prove no same-second edit, so IDs never break
that tie. Same-time pull-request reviews may use the larger canonical ID only
within the review channel; cross-channel ties remain ambiguous.

This recovery path is event-driven. It does not add polling or scheduled runner minutes.

A marker deadline, closed marker state, baseline, or recovery cutoff cannot
reject an otherwise valid provider artifact. A clean artifact that arrives
after a marker deadline can pass on a later complete run.

## Waiting and Evidence Errors

- A valid `Codex Review in progress` or `still in progress` artifact keeps the
  gate pending under the existing marker and deadline. It does not acknowledge
  the marker, reset or extend a deadline, or cause a repost.
- `eyes` may move `waiting_ack` to `waiting_result` without extending a
  deadline. `+1` is audit-only and has no verdict authority.
- The unchanged defaults are 300 seconds for initial acknowledgement, 1,800
  seconds for maximum acknowledgement backoff, 3,600 seconds for an
  acknowledged result, and 7,200 seconds overall.
- Transient acquisition or reconciliation faults receive bounded retries and
  then write stable `error`. Deterministically malformed evidence also writes
  `error`. If a confirmed finding and an evidence error coexist, the result is
  `failure` and the summary mentions the evidence issue.

## Deprecated Recovery Controls

The v1 inputs remain available so existing workflows and stored state continue
to load:

```yaml
with:
  failed-findings-recovery: ${{ vars.CODEX_REVIEW_GATE_FAILED_FINDINGS_RECOVERY }}
  failed-findings-recovery-mode: ${{ vars.CODEX_REVIEW_GATE_FAILED_FINDINGS_RECOVERY_MODE }}
```

`failed-findings-recovery`, `failed-findings-recovery-mode`, and their
repository-variable or environment equivalents are deprecated compatibility
controls. The action continues to accept and validate their v1 values, but
those values no longer change gate decisions or request orchestration. Legacy
fields already present in sticky state remain audit data. In particular,
`head`, `fresh`, a disabled recovery switch, and a recorded recovery cutoff
cannot make the latest valid current-head clean result pass or fail.

## Manual Recovery

Use `workflow_dispatch` when no provider event wakes the workflow or when an
operator wants to re-evaluate one PR explicitly.

1. Open the `Codex Review Gate` workflow.
2. Run it manually with the PR number.
3. The gate reloads current GitHub evidence and computes the result from the
   complete snapshot. Stored sticky state is used only to resume request
   orchestration.

Manual recovery remains fail-closed: unstable or incomplete evidence cannot
pass. A confirmed current-head or ancestor finding remains `failure`; absent a
confirmed finding, evidence that cannot be acquired or reconciled after
bounded retries becomes `error`. Marker or recovery history does not veto an
otherwise valid stable current-head clean artifact.
