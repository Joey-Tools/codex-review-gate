#!/usr/bin/env bash
set -euo pipefail

readonly SOURCE_REPOSITORY="Joey-Tools/codex-review-gate"
readonly TARGET_REPOSITORY="Joey-Tools/codex-review-gate-action"
readonly TARGET_REPOSITORY_URL="https://github.com/Joey-Tools/codex-review-gate-action.git"
readonly FROZEN_REPOSITORY_URL="https://github.com/JoeyTeng/codex-review-gate-action.git"
readonly ACTION_PREFIX="packages/action"
readonly IMMUTABLE_TAG="v2.0.0"
readonly MINOR_ALIAS="v2.0"
readonly MAJOR_ALIAS="v2"
readonly TEST_ONLY_ENVIRONMENT="CODEX_REVIEW_GATE_RELEASE_PROVENANCE_TEST_ONLY"

mode="check"
source_ref="HEAD"
output=""
target_url="$TARGET_REPOSITORY_URL"
frozen_url="$FROZEN_REPOSITORY_URL"
baseline=""
skip_checks=false
skip_signatures=false

usage() {
  cat <<'USAGE'
Usage: scripts/release-action-subtree.sh [--check | --publish] [options]

Create and verify the complete packages/action subtree split for the fixed
v2.0.0 release. --check performs read-only remote baseline and candidate
verification. --publish additionally creates three direct signed annotated tags,
pushes master plus all tags atomically without force, re-reads both repositories,
and writes a create-only provenance manifest.

Options:
  --check                 Validate only (default; never writes a remote).
  --publish               Publish v2.0.0, v2.0, and v2 to the fixed target.
  --source-ref <ref>      Exact source commit to split (default: HEAD).
  --output <path>         Required create-only provenance path for --publish.
  -h, --help              Show this help.

Production --publish requires:
  ACTION_REPO_PUSH_AUTHENTICATED_V2=1
  ACTION_RELEASE_SIGNING_FINGERPRINT_V2=<full OpenPGP primary fingerprint>

The workflow configures ACTION_REPO_PUSH_TOKEN_V2 as an HTTPS extraheader. This
script never accepts a token, SSH key, force mode, alternate production target,
or any write path to the frozen personal repository.
USAGE
}

is_closed_test_environment() {
  [[ "${CODEX_REVIEW_GATE_RELEASE_PROVENANCE_TEST_ONLY:-}" == "1" && "${NODE_ENV:-}" == "test" ]]
}

require_test_environment() {
  if ! is_closed_test_environment; then
    echo "error: test-only release override requires ${TEST_ONLY_ENVIRONMENT}=1 and NODE_ENV=test" >&2
    exit 2
  fi
}

while (($#)); do
  case "$1" in
    --check)
      mode="check"
      shift
      ;;
    --publish)
      mode="publish"
      shift
      ;;
    --source-ref)
      source_ref="${2:-}"
      [[ -n "$source_ref" ]] || { echo "error: --source-ref requires a value" >&2; exit 2; }
      shift 2
      ;;
    --output)
      output="${2:-}"
      [[ -n "$output" ]] || { echo "error: --output requires a value" >&2; exit 2; }
      shift 2
      ;;
    --test-target-url)
      require_test_environment
      target_url="${2:-}"
      [[ -n "$target_url" ]] || { echo "error: --test-target-url requires a value" >&2; exit 2; }
      shift 2
      ;;
    --test-frozen-url)
      require_test_environment
      frozen_url="${2:-}"
      [[ -n "$frozen_url" ]] || { echo "error: --test-frozen-url requires a value" >&2; exit 2; }
      shift 2
      ;;
    --test-baseline)
      require_test_environment
      baseline="${2:-}"
      [[ -n "$baseline" ]] || { echo "error: --test-baseline requires a value" >&2; exit 2; }
      shift 2
      ;;
    --test-skip-checks)
      require_test_environment
      skip_checks=true
      shift
      ;;
    --test-skip-signatures)
      require_test_environment
      skip_signatures=true
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

if [[ -z "$baseline" ]]; then
  baseline="$repo_root/docs/release/action-v2-repository-baselines.json"
fi
readonly generator="$repo_root/scripts/generate-action-release-provenance.mjs"

if [[ ! -d "$ACTION_PREFIX" || ! -f "$baseline" || ! -f "$generator" ]]; then
  echo "error: action prefix, baseline, or provenance generator is missing" >&2
  exit 1
fi
if [[ "$mode" == "publish" && -z "$output" ]]; then
  echo "error: --publish requires --output" >&2
  exit 2
fi
if ! is_closed_test_environment; then
  if [[ "$target_url" != "$TARGET_REPOSITORY_URL" || "$frozen_url" != "$FROZEN_REPOSITORY_URL" ]]; then
    echo "error: production repository identities are fixed" >&2
    exit 2
  fi
  if [[ "$target_url" == *"@"* || "$target_url" != https://github.com/* ]]; then
    echo "error: production target must be credential-free GitHub HTTPS" >&2
    exit 2
  fi
fi
if [[ "$target_url" == "$frozen_url" || "$target_url" == *"JoeyTeng/codex-review-gate-action"* ]]; then
  echo "error: the frozen personal action repository can never be a publication target" >&2
  exit 2
fi
if [[ "$mode" == "publish" ]]; then
  if ! is_closed_test_environment; then
    if [[ "${ACTION_REPO_PUSH_AUTHENTICATED_V2:-}" != "1" ]]; then
      echo "error: ACTION_REPO_PUSH_AUTHENTICATED_V2=1 is required after configuring ACTION_REPO_PUSH_TOKEN_V2 HTTPS authentication" >&2
      exit 1
    fi
    if [[ -z "${ACTION_RELEASE_SIGNING_FINGERPRINT_V2:-}" ]]; then
      echo "error: ACTION_RELEASE_SIGNING_FINGERPRINT_V2 is required" >&2
      exit 1
    fi
  fi
fi

if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
  echo "error: action release requires a clean working tree" >&2
  git status --short --untracked-files=all >&2
  exit 1
fi

source_commit="$(git rev-parse --verify "${source_ref}^{commit}")"
head_commit="$(git rev-parse --verify 'HEAD^{commit}')"
if [[ "$source_commit" != "$head_commit" ]]; then
  echo "error: --source-ref must resolve to the checked-out HEAD" >&2
  exit 1
fi
if [[ -n "${EXPECTED_SOURCE_COMMIT:-}" && "$source_commit" != "$EXPECTED_SOURCE_COMMIT" ]]; then
  echo "error: checked-out source commit differs from the workflow event commit" >&2
  exit 1
fi

if [[ "$skip_checks" != true ]]; then
  echo "==> Running source checks and tests"
  npm run check
  npm test
  npm --prefix "$ACTION_PREFIX" run check
fi

git diff-tree --check --no-commit-id --root -r "$source_commit"

echo "==> Computing the complete $ACTION_PREFIX split DAG"
split_commit="$(git subtree split --prefix="$ACTION_PREFIX" "$source_commit")"
source_tree="$(git rev-parse "${source_commit}:${ACTION_PREFIX}")"
split_tree="$(git rev-parse "${split_commit}^{tree}")"
if [[ "$source_tree" != "$split_tree" ]]; then
  echo "error: subtree split root tree differs from the source prefix tree" >&2
  exit 1
fi

temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/codex-review-gate-action-v2.XXXXXX")"
cleanup() {
  rm -rf -- "$temporary_root"
}
trap cleanup EXIT

stage_repo="$temporary_root/action.git"
target_pre="$temporary_root/target-pre.tsv"
target_planned="$temporary_root/target-planned.tsv"
target_post="$temporary_root/target-post.tsv"
target_final="$temporary_root/target-final.tsv"
frozen_pre="$temporary_root/frozen-pre.tsv"
frozen_final="$temporary_root/frozen-final.tsv"
target_pre_push="$temporary_root/target-pre-push.tsv"
frozen_pre_push="$temporary_root/frozen-pre-push.tsv"
preflight_manifest="$temporary_root/preflight-provenance.json"

snapshot_remote() {
  local url="$1"
  local destination="$2"
  LC_ALL=C git ls-remote --refs "$url" | LC_ALL=C sort -k2,2 > "$destination"
}

snapshot_remote "$target_url" "$target_pre"
snapshot_remote "$frozen_url" "$frozen_pre"

git init --bare --quiet "$stage_repo"
git -C "$stage_repo" remote add target "$target_url"
git -C "$stage_repo" fetch --quiet --no-recurse-submodules target \
  '+refs/heads/*:refs/remotes/target/*' \
  '+refs/tags/*:refs/tags/*'
git push --quiet "$stage_repo" "$split_commit:refs/candidates/v2.0.0"

candidate_arguments=(
  --verify-candidate
  --source-repo "$repo_root"
  --source-ref "$source_commit"
  --source-repository "$SOURCE_REPOSITORY"
  --action-repo "$stage_repo"
  --action-ref refs/candidates/v2.0.0
  --action-repository "$TARGET_REPOSITORY"
  --target-refs "$target_pre"
  --frozen-refs "$frozen_pre"
  --baseline "$baseline"
)

if [[ "$mode" == "check" ]]; then
  node "$generator" "${candidate_arguments[@]}" >/dev/null
  printf 'verified v2 release candidate: source=%s split=%s tree=%s\n' \
    "$source_commit" "$split_commit" "$split_tree"
  exit 0
fi

existing_tag_count=0
for tag in "$IMMUTABLE_TAG" "$MINOR_ALIAS" "$MAJOR_ALIAS"; do
  if git -C "$stage_repo" show-ref --verify --quiet "refs/tags/$tag"; then
    existing_tag_count=$((existing_tag_count + 1))
  fi
done
if [[ "$existing_tag_count" != 0 && "$existing_tag_count" != 3 ]]; then
  echo "error: target contains a partial v2 tag set; refusing publication" >&2
  exit 1
fi

if [[ "$existing_tag_count" == 0 ]]; then
  if ! node "$generator" "${candidate_arguments[@]}" >/dev/null; then
    echo "error: first publication requires the exact recorded target and frozen baselines" >&2
    exit 1
  fi
  tag_arguments=(-a)
  if [[ "$skip_signatures" != true ]]; then
    tag_arguments=(-s -a)
  fi
  for tag in "$IMMUTABLE_TAG" "$MINOR_ALIAS" "$MAJOR_ALIAS"; do
    git -C "$stage_repo" \
      -c user.name="Joey-Tools release automation" \
      -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
      -c gpg.format=openpgp \
      -c "user.signingkey=${ACTION_RELEASE_SIGNING_FINGERPRINT_V2:-test-only}" \
      tag "${tag_arguments[@]}" "$tag" refs/candidates/v2.0.0 \
      -m "codex-review-gate-action $tag"
  done
fi

build_planned_snapshot() {
  local oid ref
  while IFS=$'\t' read -r oid ref; do
    if [[ "$ref" == "refs/heads/master" ]]; then
      printf '%s\t%s\n' "$split_commit" "$ref"
    elif [[ "$ref" != refs/tags/v2* ]]; then
      printf '%s\t%s\n' "$oid" "$ref"
    fi
  done < "$target_pre"
  for tag in "$IMMUTABLE_TAG" "$MINOR_ALIAS" "$MAJOR_ALIAS"; do
    printf '%s\trefs/tags/%s\n' \
      "$(git -C "$stage_repo" rev-parse --verify "refs/tags/$tag")" "$tag"
  done
}
build_planned_snapshot | LC_ALL=C sort -k2,2 > "$target_planned"

provenance_arguments=(
  --source-repo "$repo_root"
  --source-ref "$source_commit"
  --source-repository "$SOURCE_REPOSITORY"
  --action-repo "$stage_repo"
  --action-ref refs/candidates/v2.0.0
  --action-repository "$TARGET_REPOSITORY"
  --frozen-refs "$frozen_pre"
  --baseline "$baseline"
)
if [[ "$skip_signatures" == true ]]; then
  provenance_arguments+=(--test-only-skip-signatures)
else
  provenance_arguments+=(
    --expected-signing-fingerprint "$ACTION_RELEASE_SIGNING_FINGERPRINT_V2"
  )
fi

node "$generator" "${provenance_arguments[@]}" \
  --target-refs "$target_planned" \
  --output "$preflight_manifest" >/dev/null

if [[ "$existing_tag_count" == 0 ]]; then
  snapshot_remote "$target_url" "$target_pre_push"
  snapshot_remote "$frozen_url" "$frozen_pre_push"
  if ! cmp -s "$target_pre" "$target_pre_push"; then
    echo "error: target refs changed after preflight; refusing the atomic push" >&2
    exit 1
  fi
  if ! cmp -s "$frozen_pre" "$frozen_pre_push"; then
    echo "error: frozen personal repository refs changed after preflight" >&2
    exit 1
  fi
  echo "==> Atomically publishing master, v2.0.0, v2.0, and v2"
  git -C "$stage_repo" push --atomic "$target_url" \
    refs/candidates/v2.0.0:refs/heads/master \
    refs/tags/v2.0.0:refs/tags/v2.0.0 \
    refs/tags/v2.0:refs/tags/v2.0 \
    refs/tags/v2:refs/tags/v2
else
  if ! cmp -s "$target_pre" "$target_planned"; then
    echo "error: target is neither the exact initial baseline nor the exact published v2 state" >&2
    exit 1
  fi
  echo "==> Target already has the exact immutable v2 release; verifying without mutation"
fi

snapshot_remote "$target_url" "$target_post"
snapshot_remote "$frozen_url" "$frozen_final"
if ! cmp -s "$target_planned" "$target_post"; then
  echo "error: target refs differ from the atomically planned v2 state" >&2
  exit 1
fi
if ! cmp -s "$frozen_pre" "$frozen_final"; then
  echo "error: frozen personal repository refs changed during publication" >&2
  exit 1
fi

node "$generator" "${provenance_arguments[@]}" \
  --target-refs "$target_post" \
  --output "$output"

snapshot_remote "$target_url" "$target_final"
snapshot_remote "$frozen_url" "$frozen_final"
if ! cmp -s "$target_post" "$target_final"; then
  echo "error: target refs changed after provenance publication" >&2
  exit 1
fi
if ! cmp -s "$frozen_pre" "$frozen_final"; then
  echo "error: frozen personal repository refs changed after provenance publication" >&2
  exit 1
fi

printf 'published immutable v2 release: source=%s split=%s tree=%s provenance=%s\n' \
  "$source_commit" "$split_commit" "$split_tree" "$output"
