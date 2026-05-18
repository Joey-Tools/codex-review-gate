#!/usr/bin/env bash
set -euo pipefail

prefix="packages/action"
remote=""
branch="master"
push=false
force_if_equivalent_parent=false

usage() {
  cat <<'USAGE'
Usage: scripts/release-action-subtree.sh [--remote <name-or-url>] [--branch <branch>] [--push] [--force-if-equivalent-parent]

Validate the source repository and compute the git subtree split commit for
packages/action. With --push, push that split commit to the selected remote
branch. Tags are intentionally left as an explicit release step.

By default, publishing uses a normal fast-forward push. With
--force-if-equivalent-parent, the script may use --force-with-lease only when the
remote branch is not an ancestor of the split commit and the remote branch tree
matches the split commit's parent tree. This is intended for one-time recovery
from equivalent subtree histories, such as source-repository squash merges.
USAGE
}

while (($#)); do
  case "$1" in
    --remote)
      remote="${2:-}"
      if [[ -z "$remote" ]]; then
        echo "error: --remote requires a value" >&2
        exit 2
      fi
      shift 2
      ;;
    --branch)
      branch="${2:-}"
      if [[ -z "$branch" ]]; then
        echo "error: --branch requires a value" >&2
        exit 2
      fi
      shift 2
      ;;
    --push)
      push=true
      shift
      ;;
    --force-if-equivalent-parent)
      force_if_equivalent_parent=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if [[ ! -d "$prefix" ]]; then
  echo "error: missing subtree prefix: $prefix" >&2
  exit 1
fi

if [[ "$push" == true && -z "$remote" ]]; then
  echo "error: --push requires --remote" >&2
  exit 2
fi

if [[ "$force_if_equivalent_parent" == true && "$push" != true ]]; then
  echo "error: --force-if-equivalent-parent requires --push" >&2
  exit 2
fi

if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
  echo "error: release split requires a clean working tree; commit or stash changes first" >&2
  git status --short --untracked-files=all >&2
  exit 1
fi

echo "==> Running source checks"
npm run check

echo "==> Running source tests"
npm test

echo "==> Running action package check"
npm --prefix "$prefix" run check

echo "==> Checking latest commit whitespace"
git diff-tree --check --no-commit-id --root -r HEAD

echo "==> Computing subtree split for $prefix"
split_commit="$(git subtree split --prefix="$prefix")"

echo "Action package split commit: $split_commit"

if [[ "$push" == true ]]; then
  remote_ref="refs/heads/$branch"

  if [[ "$force_if_equivalent_parent" == true ]]; then
    remote_head="$(git ls-remote --heads "$remote" "$branch" | awk 'NR == 1 { print $1 }')"

    if [[ -z "$remote_head" ]]; then
      echo "==> Remote branch $remote_ref does not exist; pushing split commit to $remote:$branch"
      git push "$remote" "$split_commit:$remote_ref"
      exit 0
    fi

    git fetch --no-tags "$remote" "$remote_ref"

    if git merge-base --is-ancestor "$remote_head" "$split_commit"; then
      echo "==> Pushing split commit to $remote:$branch"
      git push "$remote" "$split_commit:$remote_ref"
      exit 0
    fi

    if git diff --quiet "$remote_head" "$split_commit"; then
      echo "==> Remote branch is tree-equivalent to the split commit; force-with-lease aligning $remote:$branch"
      git push --force-with-lease="$remote_ref:$remote_head" "$remote" "$split_commit:$remote_ref"
      exit 0
    fi

    if split_parent="$(git rev-parse "$split_commit^" 2>/dev/null)" && git diff --quiet "$remote_head" "$split_parent"; then
      echo "==> Remote branch is tree-equivalent to the split parent; force-with-lease pushing split commit to $remote:$branch"
      git push --force-with-lease="$remote_ref:$remote_head" "$remote" "$split_commit:$remote_ref"
      exit 0
    fi

    echo "error: remote $remote_ref at $remote_head is not an ancestor of $split_commit" >&2
    echo "error: remote tree also differs from the split parent; refusing to force update" >&2
    exit 1
  fi

  echo "==> Pushing split commit to $remote:$branch"
  git push "$remote" "$split_commit:$remote_ref"
else
  echo
  echo "To publish the split commit:"
  echo "  scripts/release-action-subtree.sh --remote <remote> --branch $branch --push"
fi
