# Security Policy

Report security issues privately by using GitHub's private vulnerability reporting for this repository when available, or by contacting the repository owner through GitHub.

Do not include sensitive repository data, private source code, or secrets in public issues.

## Installation trust boundary

This Action coordinates Codex review requests and reduces evidence into the
native `codex/github-review-gate` verifier CheckRun. GitHub records the verifier
run/job/CheckRun against the exact PR feature-head SHA. The verifier executes
on `refs/pull/N/merge` and strictly validates
`GITHUB_REF`, `GITHUB_SHA`, event head/base/test-merge SHAs and a fresh PR read,
while the protected top-level `run-name` produces an exact
`codex-review-gate-verifier/<PR>/<current test-merge SHA>` `display_title`.
Activation also binds the run's sole PR record to the current feature head and
default-branch base SHA. Together these receipts bind success to the exact
current test-merge without claiming that the CheckRun itself is attached to
that merge SHA.
Install the complete three-asset-group contract: both canonical workflows, the
managed `.github/CODEOWNERS` control plane, and the supplied ruleset. Use the canonical
`bootstrap-codex-review-gate.mjs` helper with an explicit
`--control-plane-owner @USER`; do not reconstruct either workflow or managed
rules by hand. The helper's two final effective CODEOWNERS rules must protect
`/.github/workflows/` and `/.github/CODEOWNERS`, and the named GitHub user must
have `write`, `maintain` or `admin` repository permission.

The first migration PR contains the canonical verifier, canonical controller
and CODEOWNERS. Keep
every active or inherited legacy `codex/review-gate` requirement through the
merge. Before merge, the owner approval snapshot records a canonical read-only legacy
inventory SHA-256; the final fail-fast transaction must rebuild the same strict
inventory and match that external digest. The digest binds repository/default
branch, each matching ruleset's full identity, source, enforcement, target,
conditions, `bypass_actors`, `rules`, and effective `required_status_checks`
rule, plus the complete classic required-status object including every check's
producer `app_id`. Even an empty legacy inventory has a repository/branch-bound
digest. Incomplete API/schema data or any drift fails closed. The transaction
must prove the current actor is the named owner and that owner's latest
exact-head review remains approved, then call
the synchronous exact-SHA merge endpoint. Approval and head stability alone do
not close bootstrap trust. After merge, immediately reread the current default
and require the PR's merged lifecycle, base, and head to remain the exact
approved scope. A failed readback keeps every legacy requirement active. Only
after success, stage a separate supplied v2 ruleset as Disabled while legacy
remains active, prove it with a canary, then activate and read back the complete
Active policy with no bypass actors. Every pre-cleanup stage/activation preview
and apply must explicitly reuse that same owner-approved digest across
processes through the exact Active readback. Only then may separately
authorised cleanup remove the inventoried legacy requirements. Immediately
before cleanup, read-only `--derive-post-cleanup-plan` requires the same
external owner-approved legacy-inventory digest through
`--expected-legacy-inventory-sha256`, verifies the pre-state
against it, and derives a canonical expected state from the complete security
snapshot. It may remove only `codex/review-gate`; an emptied status rule may be
removed, as may an emptied classic required-status policy; a whole dedicated
legacy-only ruleset may be deleted only when no other rule remains. Those are
the only structural exceptions. Repository/default head, workflow/CODEOWNERS
inventory, owner permission, every field/non-legacy check including `strict`
and `app_id` in a surviving classic policy, and every retained ruleset's
identity, conditions, bypass actors, and unrelated rules must remain exact. The
plan exports an expected post-cleanup security SHA-256. Read-only
`--verify-post-cleanup`
requires that external digest through
`--expected-post-cleanup-security-sha256` and accepts only two identical complete security
rounds that both match it, prove both legacy surfaces clear, and prove the same
complete v2 policy Active. Any inconclusive derivation, cleanup readback, or
verification keeps v2 Active and requires read-only diagnosis; never disable
or roll back v2 in response.
The active ruleset requires Code Owner review and stale-approval dismissal.
Required-check `integration_id: 15368` identifies the entire GitHub Actions App,
not either workflow. Exact-byte verification of both workflows, fail-closed
inventory of reserved-name producers and relevant write authority, CODEOWNERS,
Code Owner review, stale dismissal, strict up-to-date policy, no bypass actors
and canary collision readback form one compound control-plane boundary. Do not
describe this as cryptographic single-workflow provenance.

## Runtime boundary

Retain the verifier's closed `pull_request` activity types `opened`, `reopened`,
`synchronize` and `ready_for_review`. It is read-only and has no authoritative
write API. Retain the controller's closed `issue_comment` `created`/`edited`
and default-branch-only `workflow_dispatch` entries, exact pre-runner Codex
sender/author filtering, and narrow `actions: write` plus `issues: write`
surface. Neither workflow receives `statuses: write`, `checks: write`, contents
write, pull-request write or OIDC authority. There is no `pull_request_target`,
cron, runtime GitHub App, webhook or durable ledger.

Only the verifier job's GitHub-managed CheckRun on the exact current PR
feature-head SHA is the protected signal. Its success is valid only when the
run's merge-ref environment, event scope and fresh PR read bind it to unchanged
head, base and test-merge SHAs. The controller may create or adopt a
review request and request one full rerun, but it cannot supply a verdict or
rewrite that CheckRun. It must bind baseline attempt `A`, observe exact attempt
`A+1` and its unique canonical job/CheckRun, and fail closed on ambiguous or
invisible rerun state. Direct commit-status projection and its old ambiguous
POST recovery are removed.

Every verifier performs an authoritative full scan of GitHub evidence. Manual
selectors and event IDs are untrusted hints only: they may stop a backward scan
early only after proving that no newer relevant evidence was skipped. Only a
stable, fully paginated `healthy/success` may conclude the verifier successfully;
pending, findings, unsupported scope, cancellation, timeout and unhealthy
execution all remain blocking. Actions summaries give one closed
`recovery_code` and concrete next action; `create_verifier_run` means use the
documented draft-to-ready lifecycle recovery before reconciling again.
`retry_safe` only says whether an immediate identical-input retry is a valid
recovery action; it never weakens a blocking result.

Treat pull request text and metadata as untrusted. Neither workflow may check
out or execute pull request or consumer repository code. An agent-driven merge
must establish a strictly newer exact-current verifier result, reread unchanged
head/base/test-merge and ruleset allowance, then merge with exact-head
compare-and-swap. A direct human UI merge outside that closure is unsupported.
