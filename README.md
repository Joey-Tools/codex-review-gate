# Codex Review Gate Source

Languages: [British English (en-GB)](README.md) | [简体中文 (zh-CN)](README.zh-CN.md)

This repository is the canonical source for Codex Review Gate. The publishable
JavaScript Action package lives under `packages/action/`; releases are
materialised into the existing Marketplace repository
[`JoeyTeng/codex-review-gate-action`](https://github.com/JoeyTeng/codex-review-gate-action).

## Layout

- `packages/action/`: complete Action release subtree, including the root
  `action.yml` and JavaScript runtime;
- `templates/codex-gated-repo/`: two canonical copied consumer workflows and
  a disabled importable ruleset;
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

V2 consumers copy both canonical workflows into the same paths in their
repository:

- `.github/workflows/codex-review-gate.yml` is the read-only `pull_request`
  verifier. Its GitHub-managed job CheckRun, `codex/github-review-gate`, is the
  required signal on the exact PR feature-head SHA. The workflow still executes
  on `refs/pull/N/merge` and binds that CheckRun to the unchanged current
  head/base/test-merge scope through strict runtime merge-ref and fresh-read
  validation. Event validation is limited to PR head/base SHA, ref, and
  repository; its `merge_commit_sha` may be missing or historical and is not a
  binding input.
- `.github/workflows/codex-review-gate-controller.yml` is the protected
  default-branch controller. It admits exact Codex events and typed manual
  operations, creates review requests, and establishes a strictly newer full
  verifier attempt when reconciliation is needed.

Both workflows call the compatible floating major:

```yaml
uses: JoeyTeng/codex-review-gate-action@v2
```

The copied workflows own separate triggers, minimal permissions, per-PR
concurrency namespaces, typed `workflow_dispatch`, exact pre-runner Codex-bot
filtering and protected repository configuration. The Action remains API-only:
it never checks out or executes pull-request code. There is no commit-status
bridge: only the verifier's native feature-head CheckRun, execution-bound to the
current test-merge, can satisfy the gate.

The required CheckRun is `codex/github-review-gate`. The importable ruleset
binds it to GitHub Actions (`integration_id: 15368`), requires the branch to be up to
date, requires all review conversations to be resolved, blocks
non-fast-forward default-branch updates and has no bypass actors. “Any source”
is not supported.

See [the human installation guide](docs/install/human.md) or
[the agent execution runbook](docs/install/agent.md). Both implement the same
two-PR rollout: one migration PR removes v1 and installs v2, then a separate
harmless canary PR proves the live gate and is closed unmerged.

## Bootstrap

Choose a control-plane owner with `write`, `maintain`, or `admin` permission,
then prepare a consumer worktree with a dry run followed by an explicit apply.
Keep that owner explicit at every phase of this generic quickstart:

```bash
CONTROL_PLANE_OWNER=@USER
node scripts/bootstrap-codex-review-gate.mjs \
  --prepare-worktree /path/to/consumer \
  --control-plane-owner "$CONTROL_PLANE_OWNER"
node scripts/bootstrap-codex-review-gate.mjs \
  --prepare-worktree /path/to/consumer \
  --control-plane-owner "$CONTROL_PLANE_OWNER" \
  --apply
```

This quickstart performs local preparation only. It does not authorize or
replace the repository-side preconditions, trusted-owner synchronous merge transaction,
legacy-protection inventory, canary, or activation readbacks in the complete
[human installation guide](docs/install/human.md) and
[agent execution runbook](docs/install/agent.md). Do not merge or activate from
this abbreviated example alone.

The helper default `@JoeyTeng` is only for Joey-owned repositories. Other
repositories must supply their own eligible `@USER`; do not rely on that
default in a generic installation. Continue with repository staging, canary and
activation only through one of the complete guides above.

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

The published `v2.1.0` payload declares `runs.using: node24`, and the floating
`v2` alias resolves to that immutable release. It does not retroactively change
the frozen v2.0 release contract or make a v1 bridge removable by itself.

The importable template and the helper's default `full` ruleset profile remain
the ordinary consumer contract. Only the `Joey-Tools/codex-review-gate` source
self-migration may explicitly stage remote `--ruleset-profile status-only`
with `--legacy-bridge` and the distinct `Must Pass Codex Review v2` rule. That
new rule adds only the strict v2 status context while the existing source rule
retains deletion, non-fast-forward, pull-request conditions, and required
review-thread resolution. Its CODEOWNERS/owner projection is receipt material
for source control-plane ownership and drift detection, not an enforced Code
Owner-approval or stale-review policy.
It is not a general consumer or cohort template. The source repository uses
the canonical v2 verifier and controller; its repository-local v1 required
status is retired while the exact temporary legacy bridge intentionally
remains. Its later physical bridge removal needs a separately derived,
source-only closure receipt whose exact SHA-256 receives independent approval.
The published `v2.1.0` payload and closed-unmerged historical canary `#74` are
evidence inputs only, never bridge-deletion authority; `#74` contributes its
exact PR/head/base/test-merge/CheckRun/run/job tuple. The receipt also binds a
fresh two-round live source closure. Before local deletion, the **same**
independently approved receipt (and exact SHA-256) must rebind equal to fresh
GitHub evidence. Drift stops the flow: derive a new receipt, review it, and
obtain a new independent approval before any later deletion attempt. The
source-only executor is unavailable to ordinary consumers. Deleting the YAML
stops ordinary new dispatches, but does not promise that GitHub cannot rerun a
historical Actions run. The receipt cannot be trusted as a standalone file, and
the organization schema-2 cohort receipt cannot authorize it. A proof-machinery
PR and the later bridge-delete PR remain deliberately separate. See the
[human installation guide](docs/install/human.md) for that source-only closure
flow, and [docs/RELEASING.md](docs/RELEASING.md) for publisher recovery states
and the release-protection baseline.
