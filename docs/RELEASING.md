# Releasing the Action Package

The Marketplace repository is a subtree split of `packages/action`. Keep every file that must appear at the root of `JoeyTeng/codex-review-gate-action` inside that directory.

## Preconditions

- The source repository is on the release commit.
- `packages/action/package.json` contains the release version.
- The source repository has an `ACTION_REPO_PUSH_TOKEN` secret when GitHub Actions should push the split commit automatically. Use a fine-grained token whose actor has write access to `JoeyTeng/codex-review-gate-action`; if the action repository requires pull requests for `master`, the actor must also be allowed to bypass that rule for direct release sync pushes.
- For local manual publishing, the action remote is configured, for example:

```bash
git remote add action git@github.com:JoeyTeng/codex-review-gate-action.git
```

## Automatic Default-Branch Sync

`.github/workflows/sync-action-subtree.yml` runs on pushes to `master` that touch `packages/action/**`, the sync workflow, or the release split script. It checks out full history, runs `scripts/release-action-subtree.sh --remote action --branch master --push --force-if-equivalent-parent`, and pushes only the computed subtree split commit to `JoeyTeng/codex-review-gate-action:master`.

The workflow does not create GitHub Releases and does not create or move tags. It normally uses a fast-forward push. It uses `--force-with-lease` only when the action repository branch is not an ancestor of the computed split commit and its tree exactly matches either the split commit tree or the split commit's parent tree, which covers equivalent subtree histories created by source-repository squash merges. If `ACTION_REPO_PUSH_TOKEN` is missing, the action repository rejects direct pushes, or the action repository branch has diverged in content, the workflow fails instead of forcing an unsafe update.

Manual workflow dispatch validates the split by default. Set `push_to_action_repo=true` only when you intentionally want the workflow to push the split commit.

## Manual Validate and Split

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
