# Codex Review Gate Source

Languages: [British English (en-GB)](README.md) | [简体中文 (zh-CN)](README.zh-CN.md)

This repository is the source workspace for Codex Review Gate. The GitHub Action
package lives in [packages/action](packages/action/README.md), and that
directory is the publishable subtree for
[JoeyTeng/codex-review-gate-action](https://github.com/JoeyTeng/codex-review-gate-action).

## Layout

- `packages/action/`: complete Marketplace action package. Its contents become
  the root of the release repository.
- `test/`: source-repository tests for the action state machine, GitHub runner,
  and repository bootstrap helper.
- `src/bootstrap.mjs`: shared logic for repository ruleset bootstrap.
- `scripts/bootstrap-codex-review-gate.mjs`: CLI helper for creating or updating
  repository rulesets that require `codex/review-gate`.
- `templates/codex-gated-repo/`: language-neutral starter repository with the
  gate workflow preinstalled.
- `.github/workflows/`: source-repository CI and self-gating workflows.
- `docs/RELEASING.md`: subtree split release procedure.

## Development

Run the source checks from the repository root:

```bash
npm run check
npm test
```

Run the action package check in isolation:

```bash
npm run check:action
```

Run only the bootstrap helper checks:

```bash
npm run check:bootstrap
npm run test:bootstrap
```

## Gated Repository Bootstrap

For new repositories, start from the language-neutral template source in
`templates/codex-gated-repo` or the GitHub template repository
[`Joey-Tools/codex-gated-repo-template`](https://github.com/Joey-Tools/codex-gated-repo-template).
The template keeps only the gate workflow and basic repository scaffolding; add
project-specific CI separately.

After the workflow exists on the target repository default branch, run the
bootstrap helper from this source repository. It defaults to dry-run, verifies
that `.github/workflows/codex-review-gate.yml` is a workflow file on the default
branch, and then creates or updates a repository ruleset requiring
`codex/review-gate` from the GitHub Actions source.

```bash
node scripts/bootstrap-codex-review-gate.mjs --repo OWNER/REPO
node scripts/bootstrap-codex-review-gate.mjs --repo OWNER/REPO --apply
```

Use `--integration-id any` only if the repository intentionally wants a required
status from any source instead of the GitHub Actions app.

## Release Model

The release repository is not maintained by copying a loose allowlist from the
source repository root. Instead, `packages/action` is the stable subtree
boundary. Use `scripts/release-action-subtree.sh` to validate the source tree
and compute the split commit for the action repository.

The canonical workflow pins the exact 40-hex commit in the action release
repository. Until the 1.4.0 subtree split exists, source documentation uses an
explicit placeholder:

```yaml
- uses: JoeyTeng/codex-review-gate-action@<v1.4.0-action-commit-sha>
```

The v1.4.0 release notes and release provenance manifest publish the exact
replacement after source merge and action-repository sync. Floating `@v1.4`
and `@v1` are convenience aliases only; they are never the canonical or
provenance-bearing reference.

`codex/review-gate` reports only this action's required commit-status result;
it does not attest a named triple review or overall merge readiness. See the
[action semantics](packages/action/README.md#what-it-checks) and
[evidence-reconciliation design](packages/action/DESIGN.md#evidence-reconciliation).
The v1 producer receipt supplies causal producer evidence for an exact pinned
invocation, but consumers must validate its run-attempt artifact and still
reduce provider evidence independently; see
[invocation provenance](packages/action/README.md#invocation-provenance).
Immutable tags such as `v1.4.0` and the existing `v1.3.x` releases remain
available for audits and rollbacks.

See [docs/RELEASING.md](docs/RELEASING.md) for the full release flow.
