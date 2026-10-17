# Codex Review Gate v2 Consumer Template

This directory contains the canonical consumer-side assets:

- `.github/workflows/codex-review-gate.yml` is the read-only pull-request
  verifier that calls `JoeyTeng/codex-review-gate-action@v2`;
- `.github/workflows/codex-review-gate-controller.yml` is the protected
  default-branch controller that admits Codex events, reports completed
  verifier diagnostics, optionally requests review after a failed verifier
  run, and precisely reruns the verifier when reconciliation is needed;
- `.github/CODEOWNERS` is the default control-plane ownership file; replace
  `@JoeyTeng` with one GitHub user that has `write`, `maintain`, or `admin`
  permission when installing outside Joey-owned repositories;
- `rulesets/codex-review-gate.json` is the default-branch ruleset, shipped with
  enforcement disabled.

Copy both workflows unchanged. The verifier runs for pull-request `opened`,
`reopened`, `synchronize`, and `ready_for_review` events and emits the sole
required native CheckRun. The controller provides `issue_comment`
`created` bot filtering before runner allocation, an opt-in `workflow_run`
`completed` entry for the canonical verifier's `pull_request` runs, and the sole manual entry
point, `workflow_dispatch`. One manual run targets one PR and exact expected
head. Neither workflow has cron, `repository_dispatch`, `pull_request_target`,
an automatic `pull_request_review` job, a runtime GitHub App, or a ledger.

Every eligible completed verifier run uses the controller's diagnostic-only
`report-completion` operation, independently of the automatic-request variable.
It refreshes one strictly bound canonical Actions diagnostic, creates one when
absent, or skips the write with a warning when duplicates exist. Its editable
snapshot is not review evidence or gate authority; stale run/scope snapshots
are ignored, and the native verifier CheckRun remains the required signal.
This adds a billable controller runner after each eligible completion.

Automatic requests are disabled unless the organisation or repository Actions
variable `CODEX_REVIEW_GATE_AUTO_REQUEST` is exactly lowercase `true`. An unset
value disables only the request path; diagnostic completion still runs. Other
values cannot authorise a review request. GitHub Actions compares strings
case-insensitively in the selector, so a case variant such as `TRUE` can still
select `begin-review`, but the runtime rejects it before posting. A repository
value overrides the organisation value. The existing request path is unchanged:
only a uniquely associated first-attempt failure (`run_attempt=1`) uses
`begin-review`; the controller revalidates the exact current PR/head/base. For
an open, ready, same-repository PR targeting the current default branch, it may
post a canonical request if no current-scope match exists or adopt an existing
match; uncertain outcomes remain pending. The automatic path is request-only:
it does not immediately rerun the verifier. A later Codex bot comment or
protected manual `reconcile` processes the provider result. This may follow any
of the four verifier PR events above, not just `synchronize`. If a merge
conflict prevents the verifier from running, no automatic request is possible;
resolve the conflict and use manual recovery if needed. For the Joey-Tools rollout,
set the organisation variable's selected-repository visibility first to only
`codex-private-workflows`, without a repository-level override, then expand
after its canary succeeds. No new
GitHub App or ruleset is required.

The completion path filter reduces unnecessary runners but is not a
case-sensitive identity boundary: GitHub expression comparisons and
`startsWith`/`endsWith` ignore case. A case-variant lookalike may allocate a
controller runner. The published Action validates the event path
case-sensitively and, for a supported target, verifies the fixed canonical
workflow ID and actual run/attempt before completion-report side effects.
No PR code is executed, and runner admission does not authorize writes,
review requests, verifier reruns, or a gate pass.

If GitHub omits the PR association from a completed run, the workflow accepts
only an empty association list and the runtime derives the PR/test-merge from
the exact canonical verifier `display_title`. The internal `pr_number: 0`
sentinel is limited to `report-completion`. Known PR, issue, and manual inputs
retain their existing PR-scoped concurrency group. An association-empty
completion uses `workflow_run.id`, with `github.run_id` as a final fallback,
so these runs have per-run groups rather than one shared empty group. This does
not serialize completions by their runtime-derived PR. The runtime rechecks the
exact current PR, run, attempt, and CheckRun immediately before the
diagnostic-only metadata write; that point-in-time check is not an atomic lock
or gate authority. The snapshot never makes the PR mergeable.

The v2.1.7 Action release predates this controller-template hardening, so
consumers installed from that release still have the prior broad qualified-path
guard and shared empty-association group. The source bootstrap accepts only
that exact previous controller for upgrade and writes the updated template.
This change does not alter the published Action runtime, payload, or release
manifest; no new Action release is needed. Runtime-first ordering still applies
to any consumer that has not yet installed a runtime supporting
`report-completion`.

The controller's sole `pull-requests: write` permission posts its canonical
request marker and diagnostic snapshot only on a PR. GitHub's issue-comment endpoints
accept that permission for a PR, so the controller does not receive `issues:
write`, contents, checks, statuses, or OIDC write authority.

Both canonical workflows use the effective organization- or repository-level
Actions variable `CODEX_REVIEW_GATE_RUNNER_LABELS` when set. Its value must be
valid JSON that decodes to one runner-label string or a non-empty array of
literal runner labels. For example, this repository-scoped value selects a
dedicated HDR Linux runner:

```bash
gh variable set CODEX_REVIEW_GATE_RUNNER_LABELS \
  --repo "github.com/$REPO" \
  --body '["self-hosted","Linux","X64","hdr-streaming-linux"]'
```

This variable takes precedence over the legacy
`CODEX_REVIEW_GATE_USE_UBUNTU_LATEST=true` fallback. If neither is set, both
workflows use `ubuntu-slim`. Runner labels do not register or discover a runner,
alter branch protections, grant credentials or permissions, or change workflow
event filters or permission declarations.
Organization-variable visibility determines which
repositories receive the selection. Setting a variable alone does not update
an already installed consumer: update both workflow files to the new
`runs-on` expression. This needs no Action runtime release.

The shared runner selection also affects the controller, which has
`actions: write` and `pull-requests: write`, and may receive the optional
`CODEX_REVIEW_GATE_REQUEST_TOKEN` secret. Treat the variable and self-hosted
host as trusted operator-controlled configuration. The exact workflow digest
does not bind variable values or host state, and separate GitHub jobs do not
provide host isolation. Any host that can receive the controller token must be
trusted; use dedicated or ephemeral trusted runners for token-bearing jobs.

Limits are selected only through the `default` or `expanded` profile; a
repository that regularly needs the latter may set
`CODEX_REVIEW_GATE_LIMITS_PROFILE=expanded`. There are no numeric limit
overrides.

Ordinary review-request authors are admitted as candidates at any repository
permission by default. This is only the gate's generation-attribution policy:
an exact ordinary request becomes a boundary only after the official Codex Bot
directly attaches a strictly post-revision `eyes` or `+1` receipt to that same
comment. It does not grant the commenter permission to invoke or control Codex
review; GitHub and Codex still decide whether a provider review starts. An
unconfirmed candidate cannot preempt or invalidate an existing clean.
Canonical workflows set
`CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION=any` directly and do not expose it
as a repository variable or Action input. The strict `write`/`maintain`/`admin`
path is reserved for a nonstandard future verifier identity that can read
GitHub collaborator permissions; do not add it to an ordinary consumer
workflow. Qualifying Codex findings remain blocking in either mode.

The ruleset template requires `codex/github-review-gate` from expected source
GitHub Actions (`integration_id: 15368`), a branch that is up to date, and all
review conversations resolved. Integration ID 15368 identifies the whole
GitHub Actions App, not this workflow or a unique producer. The compound
control plane therefore exact-byte verifies both default-branch workflows,
rejects noncanonical reserved-name producers and unreviewed relevant write authority,
requires Code Owner review for `.github/workflows/` and
`.github/CODEOWNERS`, and dismisses stale approvals. The template's ordinary
approval count is zero, so ordinary business-code PRs do not require a human
approval; the bootstrap helper preserves an existing higher approval count.
It has no bypass actors. Keep it disabled until the live canary succeeds.

Repositories with an unrelated commit-status producer may explicitly retain
its `statuses: write` permission using the bootstrap helper's repeatable
`--reviewed-status-writer .github/workflows/FILE.yml@SHA256` option. The
workflow must first isolate status writers in explicit job-level
`statuses: write` jobs with self-contained inline Bash steps. Workflow-level
permissions stay read-only. The publisher `runs-on` may be a literal
runner-label string, a literal label array, or the exact
`fromJSON(vars.<NAME>_RUNNER_LABELS || '<JSON array>')` form. The variable name
must match `[A-Z][A-Z0-9_]*_RUNNER_LABELS`, and the fallback must be a non-empty
JSON array of string labels. When set, the variable value must also be valid
JSON resolving to a label string or non-empty label array. For example:

```yaml
runs-on: ${{ fromJSON(vars.HDR_STREAMING_LINUX_RUNNER_LABELS || '["self-hosted","Linux","X64","hdr-streaming-linux"]') }}
```

Do not use arbitrary runner expressions. Privileged jobs cannot use actions,
checkouts, artifacts, repository scripts, containers, services, or inherited
executable defaults. PR-executing test jobs keep read-only tokens.
Each privileged job contains one literal Bash `run: |` step, `shell: bash`,
and step-level `env` clearing `BASH_ENV`/`ENV` and passing
`GH_TOKEN: ${{ github.token }}`. Use step env for metadata; literal `needs`,
`if`, job outputs and one step ID support the metadata handoff.
The control-plane owner reviews every publisher's runner selector, inline code
and non-gate context: use trusted metadata and GitHub job results, never execute
PR-produced text or downloaded mutable/unprotected code. Structural admission
is not a static proof of arbitrary shell behavior; a workflow digest does not
bind variable values or self-hosted host state, and separate jobs do not provide
host isolation. Use dedicated or ephemeral trusted runners for token-bearing
publishers. A workflow digest also cannot bind future changes to an unprotected
dependency. Each declared file
must match that SHA-256 of its UTF-8 bytes at every inventory read and must
have exactly `statuses: write` among the policy's relevant write permissions.
Gate callers, the reserved native job name, and additional `actions`, `checks`,
`issues`, or `pull-requests` write authority remain forbidden. Missing,
changed, duplicate, canonical-path, or no-longer-status-writing declarations
fail closed. Repeat the same declarations through local preview/apply,
remote staging/activation, and full-profile cleanup verification; no
declaration is learned or persisted automatically. Existing canonical CODEOWNERS
coverage and independent owner review still apply. Initial admission
rejects `--legacy-bridge` together with this option because later bridge
removal keeps a frozen policy. Historical
organization handoff/bridge-removal and source-only proofs do not accept
this exception.

Activation also stops if it would silently make unrelated existing CODEOWNERS
patterns newly approval-gated. Explicitly review that policy expansion, split
or remove the unrelated patterns, or establish an equivalent Code Owner policy
before activating.

Prefer the bootstrap helper over copying the default CODEOWNERS file. Its
`--control-plane-owner @USER` option preserves unrelated entries, appends the
two protected rules as the final effective rules, and verifies after merge that
GitHub accepts the file and the named user still has write access. The option
defaults to `@JoeyTeng`; non-Joey repositories must pass their own eligible
owner in local preparation, staging, and activation commands.
If the repository already has root `CODEOWNERS` or `docs/CODEOWNERS`, the
helper stops so a new `.github/CODEOWNERS` cannot silently shadow it. Merge or
move those entries into the higher-precedence file in the same migration PR.

The installation helper revalidates the identity and access policy of the
target workflow parent directories at explicit checkpoints. This is not an
operation-bound filesystem sandbox: a hostile same-UID process can still race
path-based file operations between checkpoints. Run it only in a worktree whose
parent directories are not being concurrently modified by an untrusted
process; do not bypass a reported safety failure with a manual copy.

Before the migration approval, record the canonical legacy-inventory SHA-256.
It binds repository/default branch, each matching ruleset's complete identity,
source, enforcement, target, conditions, bypass actors, rules, and effective
required-status rule, plus the complete classic required-status object and
every check producer `app_id`. Even an empty legacy inventory has a bound
digest. Incomplete API/schema data or any drift fails closed. Explicitly pass
that same owner-approved digest to every pre-cleanup stage/activation preview
and apply, across processes, through the exact Active readback.

Rollout order:

1. use one migration PR to remove v1, install both canonical v2 workflows, and
   install or merge the control-plane CODEOWNERS rules;
2. obtain an independent approval from the named control-plane owner;
3. merge that exact reviewed head while every inventoried v1 requirement
   remains active, then reread the merged/default/head scope while keeping the
   legacy requirement active;
4. import or stage a separate v2 ruleset as Disabled; if an active legacy or
   incomplete ruleset occupies the selected name, choose a distinct v2 ruleset
   name instead of disabling or replacing the legacy ruleset;
5. with the legacy gate still active, create a separate harmless PR, request
   `@codex review`, and reconcile its
   exact head when needed;
6. verify exactly one successful native `codex/github-review-gate` verifier
   run/job/CheckRun recorded against the exact current PR feature-head SHA and
   require its exact `display_title` to be
   `codex-review-gate-verifier/<PR>/<current test-merge SHA>` and its sole PR
   binding to contain the current feature head and default-branch base SHA,
   with no same-name legacy commit status or competing CheckRun; the verifier
   executes on `refs/pull/N/merge` and validates `GITHUB_REF`, `GITHUB_SHA`, the
   event scope and a fresh PR read, so the CheckRun itself does not belong to
   the test-merge SHA;
7. read back the unchanged disabled ruleset and control plane, activate it,
   and read the complete Active policy back exactly;
8. only after that Active readback, run read-only
   `--derive-post-cleanup-plan` on the complete pre-cleanup security snapshot;
   pass the same external owner-approved legacy-inventory digest as
   `--expected-legacy-inventory-sha256` and require
   the current pre-state to match it; review the canonical plan, which may
   remove only `codex/review-gate`; an emptied status rule may be removed and a
   whole dedicated legacy-only ruleset only when no other rule remains; an
   emptied classic required-status policy may also disappear; require exact
   preservation of repository/default head, workflow/CODEOWNERS inventory,
   owner permission, all fields/non-legacy checks including `strict`/`app_id`
   in a surviving classic policy, and every retained ruleset's identity,
   conditions, bypass actors, and unrelated rules; then
   record `expected_post_cleanup_security_sha256`;
9. perform the separately authorised legacy cleanup, then run read-only
   `--verify-post-cleanup --expected-post-cleanup-security-sha256 <digest>`;
   require two identical complete security rounds that both match the external
   digest, prove both ruleset and classic legacy surfaces clear, and re-read
   the same complete Active v2 policy; and
10. close the canary without merging, verify its recorded head
    repository/ref/OID, and lease-delete only that still-exact temporary ref.

After v2 is written Active, any inconclusive cleanup or verification keeps it
Active. Use read-only diagnostics; never disable or roll back v2 in response.

Installation documentation:

- Human guide: `docs/install/human.md`
- Human guide (Simplified Chinese): `docs/install/human.zh-CN.md`
- Agent execution guide: `docs/install/agent.md`
- Agent execution guide (Simplified Chinese): `docs/install/agent.zh-CN.md`
