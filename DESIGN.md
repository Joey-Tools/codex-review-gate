# Codex Review Gate Design

## Goal

`codex/review-gate` should give branch protection a deterministic commit status for Codex review, even though Codex GitHub review currently exposes signals as PR reactions, top-level comments, and inline review comments rather than a first-class check run.

The gate should fail closed. If the current head cannot be confidently associated with a clean Codex result, the status stays `pending` until timeout or becomes `failure`; it must not reuse an old clean signal.

The runner is packaged as a local composite action so this directory can later move to an independent repository with the same call shape.

## Observed Signals

- Codex inline PR review comments and Codex review-body findings are the strongest failure signals. Review-body findings carry a reviewed commit through the PR review API. Inline comments carry review-comment commit identity, but GitHub can remap REST `commit_id` on old comments that still appear in later diffs, so inline comments are active findings only when their GraphQL review thread is not `isResolved` and not `isOutdated`.
- Codex `eyes` reactions are liveness only. They mean Codex has likely accepted or started work, but they are not a pass signal.
- Codex `+1` reactions can be used as a clean/pass candidate only when the active reaction is new relative to the gate baseline. A pre-existing unchanged `+1` is not enough.
- Codex top-level comments after the active marker can be used as review-completion evidence. Their natural language wording is not authoritative and should not be parsed for pass/fail; the pass/fail decision still comes from whether current-head Codex findings exist.
- PR-open auto review is out of band. Its first `+1`, inline review comments, or review-body findings should be recorded as bootstrap baseline, not used to pass a later controlled review marker.

## State Model

The workflow should maintain one sticky PR comment with hidden state metadata. The state comment lets canceled, rerun, or later workflow runs share the same serialized view.

The state should record at least:

- `state_version`
- current tracked `head_sha`
- bootstrap status and timestamp
- active Codex PR-body `+1` reaction identity, including `id` and `created_at` when present
- active Codex `eyes` reaction identity when present
- active Codex top-level completion comment identity when present
- known Codex inline review-comment ids and review-body finding ids already counted as baseline
- outstanding marker comment id, marker head sha, marker creation time, and marker attempt number
- marker baseline `+1`, `eyes`, and top-level completion comment identities
- marker state: `waiting_ack`, `waiting_result`, `pass_candidate`, `missed_ack`, `stalled`, `passed`, or `failed`
- last status write head and run url

The script should also be able to reconstruct enough state from PR comments, reactions, and review comments if the sticky comment is missing. If reconstruction is ambiguous, fail closed or stay pending instead of passing. In particular, if the sticky state comment is missing but a trusted marker comment is still visible, that marker must not be reactivated as an active pass candidate. The safe recovery path records the marker as `state_lost`, baselines the currently visible reactions, and issues a fresh marker for the current head.

The current implementation trusts state and marker comments only from configured trusted authors. The default trusted author is `github-actions[bot]`, which matches the repository workflow's `GITHUB_TOKEN` path.

## Bootstrap Round

The first round has special handling because PR-open auto review may already be running without a gate-controlled marker.

On the first gate run for a PR:

1. Collect current Codex reactions, top-level comments, PR reviews, inline review comments, and GraphQL review-thread state.
2. Record all existing Codex `eyes`, `+1`, inline findings, and review-body findings as bootstrap baseline.
3. If current `HEAD_SHA` already has Codex findings, fail the current status.
4. Keep the gate pending only during a short bootstrap grace period, so PR-open auto review signals that are already visible can be recorded.
5. After the grace period, close bootstrap even if an old `eyes` reaction still looks ongoing, then create the first controlled `@codex review` marker for the current head. The controlled marker may supersede the out-of-band auto review.

The first out-of-band `+1` or review comments are only baseline evidence. They do not pass `codex/review-gate`.

## Controlled Marker Loop

After bootstrap, the gate enforces a serialized marker relationship:

1. At most one controlled `@codex review` marker is outstanding for the PR.
2. Before creating a marker, record the current active Codex `+1` reaction identity as the marker baseline.
3. Do not create another marker until the outstanding marker has either observed a new `+1` transition or timed out.
4. `eyes` after the marker moves the state to ongoing, but the status remains `pending`.
5. A pass candidate exists when the active Codex `+1` reaction is absent in the marker baseline and now present, its `id` / `created_at` changed after the marker baseline, or a new Codex top-level completion comment appears after the marker baseline.
6. A pre-existing unchanged `+1` is never reused for pass.
7. On a pass candidate, persist `pass_candidate` on the active marker before final validation so a rerun can recover the observed `+1`.
8. Re-fetch the PR and fail closed if `HEAD_SHA` changed.
9. Re-check Codex findings for the current head. If any exist, set `codex/review-gate=failure`.
10. If head is unchanged and current-head Codex findings are absent, set `codex/review-gate=success`, then close the active marker as `passed`.

If a push happens while a marker is outstanding, the new head should remain `pending`. The workflow should immediately close the old marker as `obsolete_head`, record the latest observed reaction identities, then baseline again and issue a fresh marker for the latest head. Later reactions attributable only to the obsolete marker must not pass the new head.

`After the marker` means the Codex signal must not be older than the marker comment. GitHub exposes reaction and comment timestamps with second-level granularity, so a signal with the same timestamp second as the marker is treated as a candidate only when its identity differs from the recorded baseline. An unchanged baseline identity is never reused.

Observed Codex behavior suggests that newer `@codex review` triggers can supersede earlier onflight reviews. Older marker comments may keep their `eyes` reaction even when their review never produces a completion. The gate therefore treats stale marker `eyes` as non-terminal evidence and relies on current-head review comments, current-head `+1` transitions, and explicit marker state instead of assuming every `eyes` has a matching completion.

## Missed Ack Retry

The gate separates "Codex did not acknowledge the marker" from "Codex acknowledged the marker but has not finished reviewing".

While a marker is still `waiting_ack`, the runner waits only for the marker's ack timeout. The default first timeout is 300 seconds. If no new Codex `eyes`, `+1`, or top-level completion comment appears in that window, the marker is closed as `missed_ack`, the latest visible Codex signals are recorded, and the runner immediately creates a fresh marker.

Consecutive `missed_ack` outcomes on the same head use exponential backoff to avoid comment spam: 300 seconds, 600 seconds, 1200 seconds, then a default cap of 1800 seconds. The effective ack timeout and cap are also capped by the marker result timeout, so existing workflows with shorter `marker-timeout-seconds` continue to use their shorter wait window. A head change or any non-`missed_ack` marker outcome resets this ack backoff.

Once Codex posts `eyes`, the marker moves to `waiting_result` and the fast ack retry no longer applies. That path uses the longer marker result timeout.

## Stalled Retry

Because a GitHub PR-body `+1` is an active reaction state rather than an append-only event stream, Codex may leave an old `+1` unchanged after a later clean review. In that case the gate cannot prove that the later review completed.

For that case:

1. Keep the status `pending` while the marker is within its wait window.
2. After a bounded timeout, such as one hour, mark the marker `stalled`.
3. Record the current reaction identities as the new baseline.
4. Issue a new controlled marker for the latest PR head.
5. The new marker still requires a `+1` transition after its own baseline.

This is retry, not pass. The unchanged old `+1` remains unusable.

## Branch Protection

The repository ruleset should require:

- the `codex/review-gate` status check
- GitHub's native "require conversations to be resolved" protection

Conversation resolution is intentionally separate from the status script. The status script decides whether Codex produced a clean current-head signal; branch protection decides whether human-visible review threads are resolved.

## Design Review

The strong parts are:

- Current-head Codex findings are deterministic enough to fail on when they are unresolved, non-outdated inline review threads or review-body findings with a commit-specific code link. The inline path cross-checks GraphQL thread state and paginates thread comment IDs to avoid treating resolved or outdated discussions as new current-head findings when REST `commit_id` is remapped.
- The pass path no longer depends on clean-summary wording.
- Old `+1` reactions are not reused.
- Serial markers avoid two controlled requests racing for the same visible `+1` transition.
- Pushes during an outstanding review do not cause an immediate new marker, which preserves the one-marker-at-a-time relationship.

The thin parts are:

- PR-body `+1` is not append-only. If GitHub keeps one active reaction per bot/content pair, there may be no new event for later clean reviews, so the gate can only stay pending and retry.
- Timeout retry weakens strict attribution. A very delayed old review that deletes/re-adds or otherwise updates the `+1`, or posts a top-level completion comment after a new marker, could be misattributed to the new marker. Observed Codex behavior suggests newer review triggers supersede older onflight reviews, and serial markers plus fresh baselines reduce the risk, but it cannot be eliminated without a Codex-provided token, commit id, or per-marker reaction target.
- Bootstrap is inherently weaker because PR-open auto review is not marker controlled. The first round treats existing signals as baseline only, waits for a short grace period, then starts a controlled marker even when a stale `eyes` reaction remains visible.
- If Codex stops emitting PR-body `+1` for clean reviews, the gate should stall rather than pass. That is fail-closed but may block merges until the signal model is revised.
- If Codex moves findings from review comments/review bodies to top-level issue comments, the current script would not classify them as findings. This is accepted for now and partially covered by requiring conversation resolution, but it is not a full substitute for a first-class Codex verdict.
- If GitHub review APIs omit or misreport commit ids, current-head finding detection becomes weaker. The implementation should prefer review/comment `commit_id` plus GraphQL review-thread state for inline comments, and treat ambiguous Codex findings conservatively when possible. If a current-head REST inline comment cannot be mapped to GraphQL thread metadata, it remains a finding.
- The sticky state comment can be edited or deleted. The implementation must reconstruct from GitHub state or fail closed, not silently restart and reuse old signals.
