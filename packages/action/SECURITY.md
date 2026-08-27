# Security Policy

Report security issues privately by using GitHub's private vulnerability reporting for this repository when available, or by contacting the repository owner through GitHub.

Do not include sensitive repository data, private source code, or secrets in public issues.

## Installation trust boundary

This Action coordinates Codex review requests and reduces evidence into the
native `codex/github-review-gate` verifier CheckRun on the PR test-merge SHA.
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
inventory and match that external digest. It includes complete ruleset
`bypass_actors` and the complete matching effective `required_status_checks`
rule with every parameter, not merely one matching check. The transaction must prove the current actor is the named
owner and that owner's latest exact-head review remains approved, then call
the synchronous exact-SHA merge endpoint. Approval and head stability alone do
not close bootstrap trust. After merge, immediately reread the current default
and require the PR's merged lifecycle, base, and head to remain the exact
approved scope. A failed readback keeps every legacy requirement active. Only
after success, remove and read back the inventoried legacy requirements under
separate authorization. Stage the
supplied ruleset only after merge as
Disabled, prove it with a canary, then activate it with no bypass actors.
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
test-merge SHA is the protected signal. The controller may create or adopt a
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
