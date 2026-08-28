# Codex Review Gate v2 Consumer Template

This directory contains the canonical consumer-side assets:

- `.github/workflows/codex-review-gate.yml` is the read-only pull-request
  verifier that calls `JoeyTeng/codex-review-gate-action@v2`;
- `.github/workflows/codex-review-gate-controller.yml` is the protected
  default-branch controller that admits Codex events and precisely reruns the
  verifier;
- `.github/CODEOWNERS` is the default control-plane ownership file; replace
  `@JoeyTeng` with one GitHub user that has `write`, `maintain`, or `admin`
  permission when installing outside Joey-owned repositories;
- `rulesets/codex-review-gate.json` is the default-branch ruleset, shipped with
  enforcement disabled.

Copy both workflows unchanged. The verifier runs for pull-request `opened`,
`reopened`, `synchronize`, and `ready_for_review` events and emits the sole
required native CheckRun. The controller provides `issue_comment`
`created`/`edited` bot filtering before runner allocation and the sole manual
entry point, `workflow_dispatch`. One manual run targets one PR and exact
expected head. Neither workflow has cron, `repository_dispatch`, an automatic
`pull_request_review` job, a runtime GitHub App, or a ledger.

The default runner is `ubuntu-slim`. Set the repository Actions variable
`CODEX_REVIEW_GATE_USE_UBUNTU_LATEST=true` only when the supported
`ubuntu-latest` fallback is required. Limits are selected only through the
`default` or `expanded` profile; a repository that regularly needs the latter
may set `CODEX_REVIEW_GATE_LIMITS_PROFILE=expanded`. There are no numeric limit
overrides.

Ordinary review-request authors require repository `write`, `maintain`, or
`admin` permission by default. Protected repository variable
`CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION=any` deliberately relaxes only
that generation-author boundary; every other value maps to `write`, and
qualifying Codex findings remain blocking.

The ruleset template requires `codex/github-review-gate` from expected source
GitHub Actions (`integration_id: 15368`), a branch that is up to date, and all
review conversations resolved. Integration ID 15368 identifies the whole
GitHub Actions App, not this workflow or a unique producer. The compound
control plane therefore exact-byte verifies both default-branch workflows,
rejects noncanonical reserved-name producers and relevant write authority,
requires Code Owner review for `.github/workflows/` and
`.github/CODEOWNERS`, and dismisses stale approvals. The template's ordinary
approval count is zero, so ordinary business-code PRs do not require a human
approval; the bootstrap helper preserves an existing higher approval count.
It has no bypass actors. Keep it disabled until the live canary succeeds.

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
8. only after that Active readback, perform the separately authorised legacy
   cleanup; because cleanup changes the old digest, run the read-only
   `--verify-post-cleanup` mode without that digest to prove both ruleset and
   classic legacy surfaces clear and re-read the same complete Active v2
   policy; and
9. close the canary without merging it.

Installation documentation:

- Human guide: `docs/install/human.md`
- Human guide (Simplified Chinese): `docs/install/human.zh-CN.md`
- Agent execution guide: `docs/install/agent.md`
- Agent execution guide (Simplified Chinese): `docs/install/agent.zh-CN.md`
