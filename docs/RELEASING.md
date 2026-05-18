# Releasing the Action Package

The Marketplace repository is a subtree split of `packages/action`. Keep every file that must appear at the root of `JoeyTeng/codex-review-gate-action` inside that directory.

## Preconditions

- The source repository is on the release commit.
- `packages/action/package.json` contains the release version.
- The action remote is configured, for example:

```bash
git remote add action git@github.com:JoeyTeng/codex-review-gate-action.git
```

## Validate and Split

From the source repository root:

```bash
npm run release:split
```

The script runs the source checks, action package checks, tests, and whitespace validation, then prints the subtree split commit.

To also push the split commit to the action repository default branch:

```bash
scripts/release-action-subtree.sh --remote action --branch master --push
```

## Tags

Action consumer tags must point at commits in the action repository history, not source-repository commits. After validating the pushed action repository commit, create or update release tags in the action repository deliberately.

For a patch release, push the immutable patch tag first:

```bash
git push action <split-commit>:refs/tags/v1.2.1
```

Move compatibility tags such as `v1.2` and `v1` only after confirming that the action repository default branch points at the intended split commit.

## Why Subtree

`packages/action` is a stable package boundary whose contents are complete as a repository root. That makes `git subtree split --prefix=packages/action` a direct release operation. Tests, CI workflows, and source-repository coordination stay outside the published action package.
