# Codex Review Gate v2 Consumer Template

This directory contains the canonical consumer-side assets:

- `.github/workflows/codex-review-gate.yml` is the thin workflow that calls
  `JoeyTeng/codex-review-gate-action@v2`;
- `.github/CODEOWNERS` is the default control-plane ownership file; replace
  `@JoeyTeng` with one GitHub user that has `write`, `maintain`, or `admin`
  permission when installing outside Joey-owned repositories;
- `rulesets/codex-review-gate.json` is the default-branch ruleset, shipped with
  enforcement disabled.

Copy the workflow unchanged. It provides `issue_comment` `created`/`edited`
bot filtering before runner allocation and the sole manual entry point,
`workflow_dispatch`. One manual run targets one PR and exact expected head.
The workflow has no cron, `repository_dispatch`, automatic
`pull_request_review` job, runtime GitHub App, or ledger.

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
review conversations resolved. Because integration ID 15368 identifies the
entire GitHub Actions App rather than this one workflow, the ruleset also
requires Code Owner review and dismisses stale approvals. The template's
ordinary approval count is zero, so only PRs changing `.github/workflows/` or
`.github/CODEOWNERS` require the independent control-plane-owner approval; the
bootstrap helper preserves an existing higher approval count. It has no bypass
actors. Keep it disabled until the live canary succeeds.

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

Rollout order:

1. use one migration PR to remove v1, install the canonical v2 workflow, and
   install or merge the control-plane CODEOWNERS rules;
2. obtain an independent approval from the named control-plane owner;
3. merge that PR so the manual workflow exists on the default branch;
4. import or stage the ruleset as Disabled;
5. create a separate harmless PR, request `@codex review`, and reconcile its
   exact head when needed;
6. verify the successful `codex/github-review-gate` status was created by
   GitHub Actions on that exact head;
7. activate the ruleset; and
8. close the canary without merging it.

Installation documentation:

- Human guide: `docs/install/human.md`
- Human guide (Simplified Chinese): `docs/install/human.zh-CN.md`
- Agent execution guide: `docs/install/agent.md`
- Agent execution guide (Simplified Chinese): `docs/install/agent.zh-CN.md`
