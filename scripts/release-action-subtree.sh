#!/usr/bin/env bash
set -euo pipefail

prefix="packages/action"
remote=""
branch="master"
push=false

usage() {
  cat <<'USAGE'
Usage: scripts/release-action-subtree.sh [--remote <name-or-url>] [--branch <branch>] [--push]

Validate the source repository and compute the git subtree split commit for
packages/action. With --push, push that split commit to the selected remote
branch. Tags are intentionally left as an explicit release step.
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
  echo "==> Pushing split commit to $remote:$branch"
  git push "$remote" "$split_commit:refs/heads/$branch"
else
  echo
  echo "To publish the split commit:"
  echo "  scripts/release-action-subtree.sh --remote <remote> --branch $branch --push"
fi
