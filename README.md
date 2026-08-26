# Codex Review Gate Source

Languages: [British English (en-GB)](README.md) | [简体中文 (zh-CN)](README.zh-CN.md)

This repository is the canonical source for Codex Review Gate. The publishable
JavaScript Action package lives under `packages/action/`; releases are
materialised into the existing Marketplace repository
[`JoeyTeng/codex-review-gate-action`](https://github.com/JoeyTeng/codex-review-gate-action).

## Layout

- `packages/action/`: complete Action release subtree, including the root
  `action.yml` and JavaScript runtime;
- `templates/codex-gated-repo/`: canonical copied consumer workflow and
  disabled importable ruleset;
- `src/bootstrap.mjs` and `scripts/bootstrap-codex-review-gate.mjs`: local
  installation and remote ruleset staging/activation helper;
- `docs/install/`: one human-readable installation guide and one
  agent-executable presentation of the same procedure, in English and
  Simplified Chinese;
- `test/`: source, runtime, workflow, installer and publisher contract tests;
- `.github/workflows/`: source CI, self-gating and the staged publisher;
- `docs/RELEASING.md`: complete publisher and repository-protection contract.

## Development

Run the source checks from the repository root:

```bash
npm run check
npm test
```

Focused commands are available for the v2 Action, bootstrap helper and release
contract:

```bash
npm run check:v2
npm run test:v2
npm run test:bootstrap
npm run test:release-provenance
```

## Consumer Model

V2 consumers copy
`templates/codex-gated-repo/.github/workflows/codex-review-gate.yml` into the
same path in their repository. The wrapper calls the compatible floating major:

```yaml
uses: JoeyTeng/codex-review-gate-action@v2
```

The copied wrapper owns triggers, minimal permissions, per-PR concurrency,
typed `workflow_dispatch`, exact pre-runner Codex-bot filtering and protected
repository configuration. The Action remains API-only: it never checks out or
executes pull-request code.

The required status is `codex/github-review-gate`. The importable ruleset binds
it to GitHub Actions (`integration_id: 15368`), requires the branch to be up to
date, requires all review conversations to be resolved, blocks
non-fast-forward default-branch updates and has no bypass actors. “Any source”
is not supported.

See [the human installation guide](docs/install/human.md) or
[the agent execution runbook](docs/install/agent.md). Both implement the same
two-PR rollout: one migration PR removes v1 and installs v2, then a separate
harmless canary PR proves the live gate and is closed unmerged.

## Bootstrap

Prepare a consumer worktree with a dry run followed by an explicit apply:

```bash
node scripts/bootstrap-codex-review-gate.mjs \
  --prepare-worktree /path/to/consumer
node scripts/bootstrap-codex-review-gate.mjs \
  --prepare-worktree /path/to/consumer \
  --apply
```

After the canonical workflow reaches the consumer default branch, stage the
ruleset as Disabled:

```bash
node scripts/bootstrap-codex-review-gate.mjs --repo OWNER/REPO
node scripts/bootstrap-codex-review-gate.mjs --repo OWNER/REPO --apply
```

Activation requires a successful exact-head canary and rereads both that
evidence and the written ruleset:

```bash
node scripts/bootstrap-codex-review-gate.mjs \
  --repo OWNER/REPO \
  --apply \
  --activate \
  --canary-pr PR_NUMBER \
  --canary-head FULL_HEAD_SHA
```

## Release Model

Publisher infrastructure lands and passes review before any release intent.
A separate PR then adds a deterministic `release-manifest.json` for one exact
source commit. The source-repository publisher validates and independently
materialises the Action twice before the privileged `publish` job enters the
`marketplace-production` Environment and waits for human approval.

The approved publisher uses the narrowly installed
`JoeyTeng/codex-review-gate-action-publisher` GitHub App and the dedicated
OpenPGP signing subkey. It creates a signed single-parent release commit, signed
immutable full-version tag, immutable GitHub Release, signed provenance assets
and, for a stable release only, a forward-moving floating major alias such as
`v2`. Every durable object is read back; partial state is reconciled without
deleting or force-overwriting immutable history.

Every SemVer gets its own immutable full tag and GitHub Release. Marketplace
publication is a manual out-of-band step only for the first stable release of a
major (beginning with `v2.0.0`); minor and patch releases advance `@v2` without
another Marketplace operation. Existing v1 tags and consumers remain valid and
frozen until each consumer is deliberately migrated.

During the initial infrastructure landing, the source repository's live v1
self-gate remains in place until the published `@v2` alias exists. See
[docs/RELEASING.md](docs/RELEASING.md) for the complete staged flow, recovery
states and protection baseline.
