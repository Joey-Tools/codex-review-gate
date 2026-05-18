# Codex Review Gate Source

Languages: [British English (en-GB)](README.md) | [简体中文 (zh-CN)](README.zh-CN.md)

This repository is the source workspace for Codex Review Gate. The GitHub Action package lives in [packages/action](packages/action/README.md), and that directory is the publishable subtree for [JoeyTeng/codex-review-gate-action](https://github.com/JoeyTeng/codex-review-gate-action).

## Layout

- `packages/action/`: complete Marketplace action package. Its contents become the root of the release repository.
- `test/`: source-repository tests for the action state machine and GitHub runner.
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

## Release Model

The release repository is not maintained by copying a loose allowlist from the source repository root. Instead, `packages/action` is the stable subtree boundary. Use `scripts/release-action-subtree.sh` to validate the source tree and compute the split commit for the action repository.

See [docs/RELEASING.md](docs/RELEASING.md) for the full release flow.
