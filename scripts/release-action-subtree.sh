#!/usr/bin/env bash
# Bash imports SHELLOPTS before executing this file. Disable inherited tracing,
# verbose input echo, and automatic export before any credential expansion.
set +x
set +v
set +a
set -euo pipefail

readonly SOURCE_REPOSITORY="Joey-Tools/codex-review-gate"
readonly SOURCE_URL="https://github.com/Joey-Tools/codex-review-gate.git"
readonly TARGET_REPOSITORY="JoeyTeng/codex-review-gate-action"
readonly TARGET_URL="https://github.com/JoeyTeng/codex-review-gate-action.git"
readonly TARGET_BRANCH="master"
readonly SOURCE_PATH="packages/action"
readonly SIGNING_SUBKEY="4DD48552DDEAF6D961769DD4A49827EC48984E2C"
readonly TEST_ONLY_ENVIRONMENT="CODEX_REVIEW_GATE_RELEASE_PROVENANCE_TEST_ONLY"

# Capture the workflow token into a non-exported shell variable, then remove
# every inherited credential name before any child process starts. Authenticated
# GitHub CLI calls and the single target push inject it only for that command.
if [[ -n "${RELEASE_PUBLISHER_TOKEN:-}" && -n "${GH_TOKEN:-}" &&
      "$RELEASE_PUBLISHER_TOKEN" != "$GH_TOKEN" ]]; then
  echo "error: conflicting publisher token inputs" >&2
  exit 2
fi
publisher_token="${RELEASE_PUBLISHER_TOKEN:-${GH_TOKEN:-${PUBLISHER_TOKEN:-${GITHUB_TOKEN:-}}}}"
release_target_askpass="${RELEASE_TARGET_ASKPASS:-}"
export -n publisher_token release_target_askpass
unset RELEASE_PUBLISHER_TOKEN GH_TOKEN GITHUB_TOKEN PUBLISHER_TOKEN
unset GH_HOST GH_ENTERPRISE_TOKEN GITHUB_ENTERPRISE_TOKEN
unset RELEASE_TARGET_ASKPASS GIT_ASKPASS SSH_ASKPASS
readonly publisher_token release_target_askpass
export GIT_TERMINAL_PROMPT=0

# Every ordinary Git invocation is credential-free and ignores inherited
# system/global helpers and HTTP authorization. target_git_push bypasses this
# wrapper only after validating the exact target/refspec and command-scopes the
# dedicated askpass token.
git() {
  (
    unset GH_TOKEN GITHUB_TOKEN PUBLISHER_TOKEN RELEASE_PUBLISHER_TOKEN
    unset RELEASE_TARGET_ASKPASS GIT_ASKPASS SSH_ASKPASS
    export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0
    command git -c credential.helper= -c credential.useHttpPath=true \
      -c http.extraHeader= -c http.https://github.com/.extraheader= "$@"
  )
}

mode=""
source_ref="HEAD"
control_ref=""
output=""
plan=""
output_dir=""
candidate_a=""
candidate_b=""
candidate=""
publication_plan_file=""
target_url="$TARGET_URL"
source_url="$SOURCE_URL"
test_release_dir=""
skip_signatures=false
enforce_live_signer_policy_in_test=false

usage() {
  cat <<'USAGE'
Usage: scripts/release-action-subtree.sh MODE [options]

Modes:
  --plan               Freeze manifest, source tree, and target-parent policy.
  --build-candidate     Create a deterministic action archive and receipt.
  --assemble            Require two candidates to be byte-identical.
  --publication-plan    Create a credential-free, exact-input publication plan.
  --verify-publication-plan
                        Rebuild and verify the publication plan before approval.
  --publish             Reconcile signed refs, Release assets, and major alias.
  --verify-published    Read back the public immutable release and alias.

Common options:
  --source-ref <sha>    Exact source commit (default: HEAD).
  --control-ref <sha>   Exact reviewed publisher-control commit.
  --output <path>       Create-only output for --plan.
  --plan-file <path>    Release plan for --build-candidate.
  --output-dir <path>   New output directory for candidate/assemble.
  --candidate-a <path> Candidate A for --assemble.
  --candidate-b <path> Candidate B for --assemble.
  --candidate <path>   Assembled candidate for --publish.
  --publication-plan-file <path>
                       Credential-free publication plan for verification/publish.
USAGE
}

is_test_environment() {
  [[ "${CODEX_REVIEW_GATE_RELEASE_PROVENANCE_TEST_ONLY:-}" == "1" && "${NODE_ENV:-}" == "test" ]]
}

require_test_environment() {
  if ! is_test_environment; then
    echo "error: test override requires ${TEST_ONLY_ENVIRONMENT}=1 and NODE_ENV=test" >&2
    exit 2
  fi
}

set_mode() {
  [[ -z "$mode" ]] || { echo "error: exactly one mode is required" >&2; exit 2; }
  mode="$1"
}

is_v2_plus_major() {
  local major="$1"
  [[ "$major" =~ ^(0|[1-9][0-9]*)$ && "$major" != "0" && "$major" != "1" ]]
}

temporary_root=""
reconcile_started=false
reconcile_state_emitted=""
reconcile_recovery_code_emitted=""
verification_started=false
verification_state_emitted=""
verification_recovery_code_emitted=""
verification_stage="initialization"
verification_observed_source="unknown"
verification_observed_tag="unknown"
for requested_argument in "$@"; do
  if [[ "$requested_argument" == "--publish" ]]; then
    reconcile_started=true
  elif [[ "$requested_argument" == "--verify-published" ]]; then
    verification_started=true
  fi
done

emit_reconcile_state() {
  local state="$1"
  local destination="${2:-stdout}"
  case "$state" in
    fresh|resumable_partial|already_complete|superseded|blocked_conflict|inconclusive) ;;
    *) echo "error: invalid reconcile state: $state" >&2; return 1 ;;
  esac
  [[ -z "$reconcile_state_emitted" ]] || {
    echo "error: reconcile state was already emitted as $reconcile_state_emitted" >&2
    return 1
  }
  reconcile_state_emitted="$state"
  if [[ "$destination" == "stderr" ]]; then
    printf 'reconcile_state=%s\n' "$state" >&2
  else
    printf 'reconcile_state=%s\n' "$state"
  fi
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf 'reconcile_state=%s\n' "$state" >> "$GITHUB_OUTPUT"
  fi
}

emit_recovery_code() {
  local code="$1"
  shift
  [[ "$code" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || {
    echo "error: invalid recovery code: $code" >&2
    return 1
  }
  [[ -z "$reconcile_recovery_code_emitted" ]] || {
    echo "error: recovery code was already emitted as $reconcile_recovery_code_emitted" >&2
    return 1
  }
  reconcile_recovery_code_emitted="$code"
  printf 'error: recovery_code=%s; %s\n' "$code" "$*" >&2
}

emit_success_recovery_code() {
  [[ -z "$reconcile_recovery_code_emitted" ]] || {
    echo "error: recovery code was already emitted as $reconcile_recovery_code_emitted" >&2
    return 1
  }
  reconcile_recovery_code_emitted="none"
  printf 'recovery_code=none; no recovery action is required\n'
}

fail_reconcile() {
  local state="$1"
  local code="$2"
  shift 2
  emit_reconcile_state "$state" stderr
  emit_recovery_code "$code" "$*"
  exit 1
}

emit_verification_result() {
  local state="$1"
  local code="$2"
  local stage="$3"
  local next_action="$4"
  local destination="${5:-stdout}"
  case "$state" in
    verified|blocked_conflict|inconclusive) ;;
    *) echo "error: invalid verification state: $state" >&2; return 1 ;;
  esac
  [[ "$code" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || {
    echo "error: invalid verification recovery code: $code" >&2
    return 1
  }
  case "$stage" in
    initialization|immutable-tag|floating-alias|immutable-release|complete) ;;
    *) echo "error: invalid verification stage: $stage" >&2; return 1 ;;
  esac
  case "$next_action" in
    none|reconcile-exact-source|repair-immutable-release-and-reconcile|investigate-published-state|retry-public-verification|repair-verifier-and-rerun) ;;
    *) echo "error: invalid verification next action: $next_action" >&2; return 1 ;;
  esac
  [[ "$verification_observed_source" == "unknown" ||
      "$verification_observed_source" =~ ^[0-9a-f]{40}$ ]] || {
    echo "error: invalid observed verification source" >&2
    return 1
  }
  [[ "$verification_observed_tag" == "unknown" ||
      "$verification_observed_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$ ]] || {
    echo "error: invalid observed verification tag" >&2
    return 1
  }
  [[ -z "$verification_state_emitted" && -z "$verification_recovery_code_emitted" ]] || {
    echo "error: verification result was already emitted" >&2
    return 1
  }
  verification_state_emitted="$state"
  verification_recovery_code_emitted="$code"
  if [[ "$destination" == "stderr" ]]; then
    printf 'verification_state=%s\nverification_stage=%s\nrecovery_code=%s\nnext_action=%s\nobserved_source=%s\nobserved_tag=%s\n' \
      "$state" "$stage" "$code" "$next_action" \
      "$verification_observed_source" "$verification_observed_tag" >&2
  else
    printf 'verification_state=%s\nverification_stage=%s\nrecovery_code=%s\nnext_action=%s\nobserved_source=%s\nobserved_tag=%s\n' \
      "$state" "$stage" "$code" "$next_action" \
      "$verification_observed_source" "$verification_observed_tag"
  fi
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf 'verification_state=%s\nverification_stage=%s\nrecovery_code=%s\nnext_action=%s\nobserved_source=%s\nobserved_tag=%s\n' \
      "$state" "$stage" "$code" "$next_action" \
      "$verification_observed_source" "$verification_observed_tag" >> "$GITHUB_OUTPUT"
  fi
}

fail_verification() {
  local state="$1"
  local code="$2"
  local stage="$3"
  local next_action="$4"
  shift 4
  echo "error: $*" >&2
  emit_verification_result "$state" "$code" "$stage" "$next_action" stderr
  exit 1
}

fail_published_state() {
  local stage="$1"
  shift
  fail_verification blocked_conflict published-state-mismatch "$stage" \
    investigate-published-state "$*"
}

on_exit() {
  local status=$?
  trap - EXIT
  if [[ "$reconcile_started" == true ]]; then
    if [[ "$status" != 0 ]]; then
      if [[ -z "$reconcile_state_emitted" ]]; then
        emit_reconcile_state blocked_conflict stderr
      fi
      if [[ -z "$reconcile_recovery_code_emitted" ]]; then
        emit_recovery_code publisher-execution-failure \
          "inspect the first error, repair the conflicting or unhealthy state, then reconcile the exact source SHA"
      fi
    else
      if [[ -z "$reconcile_state_emitted" ]]; then
        status=1
        emit_reconcile_state inconclusive stderr
        emit_recovery_code publisher-state-missing \
          "the publisher exited without a closed reconcile state; rerun the exact source SHA after repairing the workflow"
      elif [[ -z "$reconcile_recovery_code_emitted" ]]; then
        emit_success_recovery_code
      fi
    fi
  elif [[ "$verification_started" == true ]]; then
    if [[ "$status" != 0 ]]; then
      if [[ -z "$verification_state_emitted" ]]; then
        emit_verification_result inconclusive verification-execution-failure \
          "$verification_stage" repair-verifier-and-rerun stderr
      fi
    elif [[ -z "$verification_state_emitted" ]]; then
      status=1
      emit_verification_result inconclusive verification-state-missing \
        "$verification_stage" repair-verifier-and-rerun stderr
    fi
  fi
  if [[ -n "$temporary_root" && -d "$temporary_root" ]]; then
    rm -rf -- "$temporary_root"
  fi
  exit "$status"
}
trap on_exit EXIT

require_option_value() {
  local option="$1"
  local remaining="$2"
  local value="${3:-}"
  if ((remaining < 2)) || [[ -z "$value" ]]; then
    echo "error: $option requires a non-empty value" >&2
    exit 2
  fi
}

while (($#)); do
  case "$1" in
    --plan|--build-candidate|--assemble|--publication-plan|--verify-publication-plan|--publish|--verify-published)
      set_mode "${1#--}"
      shift
      ;;
    --source-ref)
      require_option_value "$1" "$#" "${2:-}"
      source_ref="$2"
      shift 2
      ;;
    --control-ref)
      require_option_value "$1" "$#" "${2:-}"
      control_ref="$2"
      shift 2
      ;;
    --output)
      require_option_value "$1" "$#" "${2:-}"
      output="$2"
      shift 2
      ;;
    --plan-file)
      require_option_value "$1" "$#" "${2:-}"
      plan="$2"
      shift 2
      ;;
    --output-dir)
      require_option_value "$1" "$#" "${2:-}"
      output_dir="$2"
      shift 2
      ;;
    --candidate-a)
      require_option_value "$1" "$#" "${2:-}"
      candidate_a="$2"
      shift 2
      ;;
    --candidate-b)
      require_option_value "$1" "$#" "${2:-}"
      candidate_b="$2"
      shift 2
      ;;
    --candidate)
      require_option_value "$1" "$#" "${2:-}"
      candidate="$2"
      shift 2
      ;;
    --publication-plan-file)
      require_option_value "$1" "$#" "${2:-}"
      publication_plan_file="$2"
      shift 2
      ;;
    --test-target-url)
      require_test_environment
      require_option_value "$1" "$#" "${2:-}"
      target_url="$2"
      shift 2
      ;;
    --test-source-url)
      require_test_environment
      require_option_value "$1" "$#" "${2:-}"
      source_url="$2"
      shift 2
      ;;
    --test-release-dir)
      require_test_environment
      require_option_value "$1" "$#" "${2:-}"
      test_release_dir="$2"
      shift 2
      ;;
    --test-skip-signatures)
      require_test_environment
      skip_signatures=true
      shift
      ;;
    --test-enforce-live-signer-policy)
      require_test_environment
      enforce_live_signer_policy_in_test=true
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

[[ -n "$mode" ]] || { usage >&2; exit 2; }
[[ -n "$control_ref" ]] || control_ref="$source_ref"
if [[ "$enforce_live_signer_policy_in_test" == true ]]; then
  [[ "$mode" == "publish" ]] || {
    echo "error: --test-enforce-live-signer-policy is valid only with --publish" >&2
    exit 2
  }
  [[ -z "$test_release_dir" ]] || {
    echo "error: --test-enforce-live-signer-policy requires the production-shaped GitHub Release path" >&2
    exit 2
  }
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
if is_test_environment && [[ "$source_url" == "$SOURCE_URL" ]]; then
  source_url="$repo_root"
fi
readonly generator="$repo_root/scripts/generate-action-release-provenance.mjs"
readonly baseline="$repo_root/docs/release/action-v2-repository-baselines.json"

[[ -f "$generator" && -f "$baseline" ]] || {
  echo "error: release generator or baseline is missing" >&2
  exit 1
}
if ! is_test_environment && [[ "$target_url" != "$TARGET_URL" ]]; then
  echo "error: production target repository is fixed" >&2
  exit 2
fi
if ! is_test_environment && [[ "$source_url" != "$SOURCE_URL" ]]; then
  echo "error: production source repository is fixed" >&2
  exit 2
fi

source_commit="$(git rev-parse --verify "${source_ref}^{commit}")"
control_commit="$(git rev-parse --verify "${control_ref}^{commit}")"
git cat-file -e "$source_commit:release-manifest.json" 2>/dev/null || {
  echo "error: frozen source commit does not contain release-manifest.json" >&2
  exit 1
}
if [[ -n "${EXPECTED_SOURCE_COMMIT:-}" && "$source_commit" != "$EXPECTED_SOURCE_COMMIT" ]]; then
  echo "error: source commit differs from the workflow-bound commit" >&2
  exit 1
fi
if [[ -n "${EXPECTED_CONTROL_COMMIT:-}" && "$control_commit" != "$EXPECTED_CONTROL_COMMIT" ]]; then
  echo "error: publisher control commit differs from the workflow-bound commit" >&2
  exit 1
fi

remote_master() {
  local result
  result="$(target_git ls-remote "$target_url" "refs/heads/$TARGET_BRANCH")"
  [[ "$(printf '%s\n' "$result" | sed '/^$/d' | wc -l | tr -d ' ')" == "1" ]] || {
    echo "error: target master is missing or ambiguous" >&2
    return 1
  }
  printf '%s\n' "${result%%[[:space:]]*}"
}

source_live_master() {
  local result
  result="$(source_git ls-remote "$source_url" "refs/heads/master")"
  [[ "$(printf '%s\n' "$result" | sed '/^$/d' | wc -l | tr -d ' ')" == "1" ]] || {
    echo "error: source master is missing or ambiguous" >&2
    return 1
  }
  printf '%s\n' "${result%%[[:space:]]*}"
}

credential_free_git() {
  git "$@"
}

source_git() {
  credential_free_git "$@"
}

target_git() {
  credential_free_git "$@"
}

publisher_gh() {
  env -u GITHUB_TOKEN -u PUBLISHER_TOKEN -u RELEASE_PUBLISHER_TOKEN \
    -u GH_ENTERPRISE_TOKEN -u GITHUB_ENTERPRISE_TOKEN \
    GH_HOST=github.com GH_TOKEN="$publisher_token" gh "$@"
}

target_git_push() {
  local lease_arg="" origin_urls push_urls sensitive_config refspec
  local -a push_argv
  if [[ "$target_url" != "$TARGET_URL" ]] && ! is_test_environment; then
    echo "error: target Git authentication is restricted to the canonical target repository" >&2
    return 1
  fi
  if [[ "$#" == 2 ]]; then
    lease_arg="$1"
    shift
  elif [[ "$#" != 1 ]]; then
    echo "error: target Git push accepts only one refspec and an optional exact lease" >&2
    return 1
  fi
  refspec="$1"
  origin_urls="$(target_git -C "$stage_repo" config --local --get-all remote.origin.url || true)"
  [[ "$(printf '%s\n' "$origin_urls" | sed '/^$/d' | wc -l | tr -d ' ')" == "1" &&
      "$origin_urls" == "$target_url" ]] || {
    echo "error: staged repository origin URL differs from the exact release target" >&2
    return 1
  }
  push_urls="$(target_git -C "$stage_repo" config --local --get-regexp '^remote\..*\.pushurl$' || true)"
  [[ -z "$push_urls" ]] || {
    echo "error: staged repository must not configure a separate remote push URL" >&2
    return 1
  }
  sensitive_config="$(target_git -C "$stage_repo" config --local --get-regexp \
    '^(credential\..*|http\..*\.extraheader|http\.extraheader)$' || true)"
  [[ -z "$sensitive_config" ]] || {
    echo "error: staged repository must not configure inherited credentials or HTTP authorization headers" >&2
    return 1
  }
  case "$refspec" in
    "$release_commit:refs/heads/$TARGET_BRANCH"|\
    "refs/tags/$immutable_tag:refs/tags/$immutable_tag"|\
    "refs/tags/$major_alias:refs/tags/$major_alias") ;;
    *) echo "error: target Git push refspec is outside the release allowlist" >&2; return 1 ;;
  esac
  if [[ -n "$lease_arg" ]]; then
    [[ -n "$major_alias" && "$refspec" == "refs/tags/$major_alias:refs/tags/$major_alias" &&
        "$lease_arg" == "--force-with-lease=refs/tags/$major_alias:$alias_before" ]] || {
      echo "error: target Git push lease differs from the verified floating-alias OID" >&2
      return 1
    }
  fi
  if [[ -n "$lease_arg" ]]; then
    push_argv=(-c credential.helper= -c credential.useHttpPath=true -c http.extraHeader= \
      -c http.https://github.com/.extraheader= -C "$stage_repo" push "$lease_arg" "$target_url" "$refspec")
  else
    push_argv=(-c credential.helper= -c credential.useHttpPath=true -c http.extraHeader= \
      -c http.https://github.com/.extraheader= -C "$stage_repo" push "$target_url" "$refspec")
  fi
  if is_test_environment; then
    if [[ "${CODEX_REVIEW_GATE_TEST_ENFORCE_ASKPASS:-}" == "1" ]]; then
      [[ -x "$release_target_askpass" && -n "$publisher_token" ]] || {
        echo "error: test target-scoped askpass mode requires an executable helper and synthetic token" >&2
        return 1
      }
      GIT_ASKPASS="$release_target_askpass" \
        GIT_CONFIG_GLOBAL=/dev/null \
        GIT_CONFIG_NOSYSTEM=1 \
        GIT_TERMINAL_PROMPT=0 \
        CODEX_RELEASE_TARGET_URL="$target_url" \
        PUBLISHER_TOKEN="$publisher_token" \
        command git "${push_argv[@]}"
      return
    fi
    command git "${push_argv[@]}"
    return
  fi
  [[ -x "$release_target_askpass" && -n "$publisher_token" ]] || {
    echo "error: target-scoped askpass and publisher token are required for target mutation" >&2
    return 1
  }
  GIT_ASKPASS="$release_target_askpass" \
    GIT_CONFIG_GLOBAL=/dev/null \
    GIT_CONFIG_NOSYSTEM=1 \
    GIT_TERMINAL_PROMPT=0 \
    CODEX_RELEASE_TARGET_URL="$TARGET_URL" \
    PUBLISHER_TOKEN="$publisher_token" \
    command git "${push_argv[@]}"
}

json_field() {
  node -e 'const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const keys=process.argv[2].split("."); let x=v; for(const k of keys)x=x?.[k]; if(x===null||x===undefined)process.exit(3); process.stdout.write(String(x));' "$1" "$2"
}

case "$mode" in
  plan)
    [[ -n "$output" && ! -e "$output" ]] || { echo "error: --plan requires a new --output path" >&2; exit 2; }
    node "$generator" plan \
      --repo "$repo_root" \
      --source-ref "$source_commit" \
      --control-ref "$control_commit" \
      --output "$output"
    exit 0
    ;;
  build-candidate)
    [[ -f "$plan" && -n "$output_dir" && ! -e "$output_dir" ]] || {
      echo "error: --build-candidate requires --plan and a new --output-dir" >&2
      exit 2
    }
    node "$generator" candidate \
      --repo "$repo_root" \
      --source-ref "$source_commit" \
      --control-ref "$control_commit" \
      --plan "$plan" \
      --output-dir "$output_dir"
    exit 0
    ;;
  assemble)
    [[ -d "$candidate_a" && -d "$candidate_b" && -n "$output_dir" && ! -e "$output_dir" ]] || {
      echo "error: --assemble requires two candidates and a new --output-dir" >&2
      exit 2
    }
    node "$generator" verify-candidate-source \
      --repo "$repo_root" \
      --source-ref "$source_commit" \
      --control-ref "$control_commit" \
      --candidate "$candidate_a"
    node "$generator" verify-candidate-source \
      --repo "$repo_root" \
      --source-ref "$source_commit" \
      --control-ref "$control_commit" \
      --candidate "$candidate_b"
    if ! diff -qr -- "$candidate_a" "$candidate_b" >/dev/null; then
      echo "error: independent release candidates are not byte-identical" >&2
      diff -qr -- "$candidate_a" "$candidate_b" >&2 || true
      exit 1
    fi
    mkdir -m 700 "$output_dir"
    cp -R "$candidate_a"/. "$output_dir"/
    exit 0
    ;;
  publication-plan)
    [[ -d "$candidate" && -n "$output" && ! -e "$output" ]] || {
      echo "error: --publication-plan requires --candidate and a new --output path" >&2
      exit 2
    }
    live_source_master="$(source_live_master)"
    [[ "$live_source_master" =~ ^[0-9a-f]{40}$ ]] || {
      echo "error: live source master is not a full SHA-1 object ID" >&2
      exit 1
    }
    source_git fetch --quiet --no-tags "$source_url" "$live_source_master"
    node "$generator" publication-plan \
      --repo "$repo_root" \
      --source-ref "$source_commit" \
      --control-ref "$control_commit" \
      --live-master-ref "$live_source_master" \
      --candidate "$candidate" \
      --output "$output"
    if ! jq -e '
        (type == "object") and
        ((.write_eligible == true and .recovery_code == null and .reason == null) or
         (.write_eligible == false and
          .recovery_code == "release-intent-superseded" and
          (.reason | type == "string" and length > 0)))
      ' "$output" >/dev/null; then
      publication_write_eligible="$(jq -r '.write_eligible | if type == "boolean" then tostring else "invalid" end' "$output" 2>/dev/null || true)"
      publication_recovery_code="$(jq -r '.recovery_code // ""' "$output" 2>/dev/null || true)"
      if [[ "$publication_write_eligible" != "false" ||
            ! "$publication_recovery_code" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ||
            "$publication_recovery_code" == "release-intent-superseded" ]]; then
        publication_recovery_code="publication-admission-invalid"
      fi
      echo "error: recovery_code=$publication_recovery_code; publication is not eligible for the privileged boundary" >&2
      exit 1
    fi
    exit 0
    ;;
  verify-publication-plan)
    [[ -d "$candidate" && -f "$publication_plan_file" ]] || {
      echo "error: --verify-publication-plan requires --candidate and --publication-plan-file" >&2
      exit 2
    }
    live_source_master="$(source_live_master)"
    [[ "$live_source_master" =~ ^[0-9a-f]{40}$ ]] || {
      echo "error: live source master is not a full SHA-1 object ID" >&2
      exit 1
    }
    source_git fetch --quiet --no-tags "$source_url" "$live_source_master"
    node "$generator" verify-publication-plan \
      --repo "$repo_root" \
      --source-ref "$source_commit" \
      --control-ref "$control_commit" \
      --live-master-ref "$live_source_master" \
      --candidate "$candidate" \
      --publication-plan "$publication_plan_file"
    exit 0
    ;;
esac

frozen_manifest_json="$(git cat-file blob "$source_commit:release-manifest.json")"
release_version="$(jq -er .version <<< "$frozen_manifest_json")"
immutable_tag="v${release_version}"
verification_observed_source="$source_commit"
verification_observed_tag="$immutable_tag"
if [[ "$release_version" == *-* ]]; then
  prerelease=true
  major_alias=""
else
  prerelease=false
  major_alias="v${release_version%%.*}"
fi

if [[ "$mode" == "verify-published" ]]; then
  verify_root="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/codex-review-gate-public-verify.XXXXXX")"
  temporary_root="$verify_root"
  verify_repo="$verify_root/target"
  assets_dir="$verify_root/assets"
  mkdir -m 700 "$assets_dir"

  verification_stage="immutable-tag"
  if ! initial_remote_tag_namespace="$(git ls-remote "$target_url" 'refs/tags/v*')"; then
    fail_verification inconclusive remote-read-inconclusive immutable-tag \
      retry-public-verification "complete target tag namespace could not be read"
  fi
  initial_remote_tag_namespace="$(printf '%s\n' "$initial_remote_tag_namespace" | LC_ALL=C sort)"

  remote_tag_binding_from_snapshot() {
    local snapshot="$1"
    local tag="$2"
    local lines direct peeled
    lines="$(printf '%s\n' "$snapshot" | awk -v direct_ref="refs/tags/$tag" \
      -v peeled_ref="refs/tags/$tag^{}" '$2 == direct_ref || $2 == peeled_ref')"
    [[ "$(printf '%s\n' "$lines" | sed '/^$/d' | wc -l | tr -d ' ')" == "2" ]] || return 1
    direct="$(printf '%s\n' "$lines" | awk -v ref="refs/tags/$tag" '$2 == ref {print $1}')"
    peeled="$(printf '%s\n' "$lines" | awk -v ref="refs/tags/$tag^{}" '$2 == ref {print $1}')"
    [[ "$direct" =~ ^[0-9a-f]{40}$ && "$peeled" =~ ^[0-9a-f]{40}$ ]] || return 1
    printf '%s\t%s\n' "$direct" "$peeled"
  }

  if ! remote_full_binding="$(remote_tag_binding_from_snapshot \
      "$initial_remote_tag_namespace" "$immutable_tag")"; then
    fail_verification blocked_conflict immutable-tag-missing immutable-tag \
      reconcile-exact-source "immutable tag is not published"
  fi
  IFS=$'\t' read -r full_tag_object full_commit <<< "$remote_full_binding"
  git clone --quiet "$target_url" "$verify_repo" || {
    fail_verification inconclusive remote-read-inconclusive immutable-tag \
      retry-public-verification "target repository could not be cloned"
  }
  if ! post_clone_remote_tag_namespace="$(git ls-remote "$target_url" 'refs/tags/v*')"; then
    fail_verification inconclusive remote-read-inconclusive immutable-tag \
      retry-public-verification "target tag namespace could not be re-read after clone"
  fi
  post_clone_remote_tag_namespace="$(printf '%s\n' "$post_clone_remote_tag_namespace" | LC_ALL=C sort)"
  [[ "$post_clone_remote_tag_namespace" == "$initial_remote_tag_namespace" ]] || {
    fail_published_state immutable-tag \
      "complete target tag namespace changed while the verifier cloned release objects"
  }
  public_direct_tag_commit() {
    local tag="$1"
    local expected_subject="$2"
    local object direct_object direct_type header_count tagger_header peeled
    object="$(git -C "$verify_repo" rev-parse "refs/tags/$tag" 2>/dev/null)" || return 1
    [[ "$(git -C "$verify_repo" cat-file -t "$object" 2>/dev/null)" == "tag" ]] || return 1
    direct_object="$(git -C "$verify_repo" cat-file tag "$object" | sed -n '1s/^object //p')"
    direct_type="$(git -C "$verify_repo" cat-file tag "$object" | sed -n '2s/^type //p')"
    [[ "$direct_object" =~ ^[0-9a-f]{40}$ && "$direct_type" == "commit" ]] || return 1
    [[ "$(git -C "$verify_repo" cat-file -t "$direct_object" 2>/dev/null)" == "commit" ]] || return 1
    header_count="$(git -C "$verify_repo" cat-file tag "$object" | awk '/^$/ {print NR - 1; exit}')"
    [[ "$header_count" == "4" ]] || return 1
    [[ "$(git -C "$verify_repo" cat-file tag "$object" | sed -n '3p')" == "tag $tag" ]] || return 1
    tagger_header="$(git -C "$verify_repo" cat-file tag "$object" | sed -n '4p')"
    [[ "$tagger_header" =~ ^tagger\ JoeyTeng-Codex\ \<codex@mahane\.me\>\ [0-9]+\ [+-][0-9]{4}$ ]] || return 1
    [[ "$(git -C "$verify_repo" for-each-ref --format='%(contents:subject)' "refs/tags/$tag")" == "$expected_subject" ]] || return 1
    [[ -z "$(git -C "$verify_repo" for-each-ref --format='%(contents:body)' "refs/tags/$tag")" ]] || return 1
    peeled="$(git -C "$verify_repo" rev-parse "refs/tags/$tag^{}")" || return 1
    [[ "$peeled" == "$direct_object" ]] || return 1
    printf '%s\n' "$direct_object"
  }

  public_api_error_is_http_404() {
    local error_file="$1"
    [[ -s "$error_file" ]] &&
      LC_ALL=C grep -Eq 'HTTP[[:space:]]+404([^0-9]|$)' "$error_file"
  }

  read_public_release_api() {
    local tag="$1"
    local output_file="$2"
    local error_file="$3"
    local api_status
    if publisher_gh api "repos/$TARGET_REPOSITORY/releases/tags/$tag" \
      > "$output_file" 2> "$error_file"; then
      return 0
    else
      api_status=$?
    fi
    if [[ "$api_status" != 0 ]] && public_api_error_is_http_404 "$error_file"; then
      return 44
    fi
    return 75
  }

  target_master="$(git -C "$verify_repo" rev-parse "origin/$TARGET_BRANCH" 2>/dev/null)" || {
    fail_published_state immutable-tag "target master is missing from the published repository"
  }
  [[ "$(git -C "$verify_repo" rev-parse "refs/tags/$immutable_tag")" == "$full_tag_object" ]] || {
    fail_published_state immutable-tag "immutable tag changed while public verification started"
  }
  [[ "$(public_direct_tag_commit "$immutable_tag" "Release codex-review-gate-action $immutable_tag")" == "$full_commit" ]] || {
    fail_published_state immutable-tag \
      "immutable release ref is not an exact annotated tag directly targeting its release commit"
  }
  source_tree="$(git rev-parse "$source_commit:$SOURCE_PATH")"
  planned_master="$(jq -er .target.expected_head <<< "$frozen_manifest_json")"
  manifest_digest="$(git cat-file blob "$source_commit:release-manifest.json" | shasum -a 256 | awk '{print $1}')"
  release_subject="Release codex-review-gate-action $immutable_tag"
  release_body="$(printf '%s\n\nSource: %s@%s\nManifest-SHA256: %s\n' "$release_subject" "$SOURCE_REPOSITORY" "$source_commit" "$manifest_digest")"
  [[ "$(git -C "$verify_repo" rev-parse "$full_commit^{tree}")" == "$source_tree" ]] || {
    fail_published_state immutable-tag "published release tree differs from the exact source subtree"
  }
  [[ "$(git -C "$verify_repo" show -s --format=%P "$full_commit")" == "$planned_master" ]] || {
    fail_published_state immutable-tag \
      "published release wrapper parent differs from target.expected_head"
  }
  [[ "$(git -C "$verify_repo" show -s --format=%an "$full_commit")" == "JoeyTeng-Codex" &&
      "$(git -C "$verify_repo" show -s --format=%ae "$full_commit")" == "codex@mahane.me" &&
      "$(git -C "$verify_repo" show -s --format=%cn "$full_commit")" == "JoeyTeng-Codex" &&
      "$(git -C "$verify_repo" show -s --format=%ce "$full_commit")" == "codex@mahane.me" &&
      "$(git -C "$verify_repo" show -s --format=%B "$full_commit")" == "$release_body" ]] || {
    fail_published_state immutable-tag \
      "published release wrapper identity or message differs from policy"
  }
  [[ "$(git -C "$verify_repo" for-each-ref --format='%(contents:subject)' "refs/tags/$immutable_tag")" == "$release_subject" ]] || {
    fail_published_state immutable-tag "immutable tag message differs from policy"
  }
  git -C "$verify_repo" merge-base --is-ancestor "$full_commit" "$target_master" || {
    fail_published_state immutable-tag \
      "target master does not contain the immutable release commit"
  }

  verify_public_signature() {
    local kind="$1"
    local object="$2"
    local status_file="$verify_root/${kind}-${object}.gpg-status"
    if [[ "$kind" == "commit" ]]; then
      git -C "$verify_repo" verify-commit --raw "$object" >/dev/null 2> "$status_file" || return 1
    else
      git -C "$verify_repo" verify-tag --raw "$object" >/dev/null 2> "$status_file" || return 1
    fi
    node "$generator" verify-openpgp-status --input "$status_file" --name "$kind $object"
  }

  public_full_stable_tag() {
    local tag="$1"
    local version major
    [[ "$tag" == v* ]] || return 1
    version="${tag#v}"
    [[ "$version" != *-* ]] || return 1
    major="${version%%.*}"
    [[ "$major" == "${release_version%%.*}" ]] || return 1
    is_v2_plus_major "$major" || return 1
    node "$generator" compare-semver --left "$version" --right "$version" >/dev/null 2>&1
  }

  public_release_inventory_snapshot() {
    local label="$1"
    local output_file="$2"
    local error_file="$3"
    local raw_file="$verify_root/release-inventory-${label}.json"
    if [[ -n "$test_release_dir" ]]; then
      if [[ ! -e "$test_release_dir" ]]; then
        printf '<absent>\n' > "$output_file"
        return 0
      fi
      [[ -d "$test_release_dir" ]] || return 1
      find "$test_release_dir" -mindepth 1 -maxdepth 2 -type f -print0 | \
        while IFS= read -r -d '' path; do
          printf '%s\t%s\n' "${path#"$test_release_dir"/}" \
            "$(shasum -a 256 "$path" | awk '{print $1}')"
        done | LC_ALL=C sort > "$output_file"
      return 0
    fi
    if ! publisher_gh api --paginate --slurp \
        "repos/$TARGET_REPOSITORY/releases?per_page=100" > "$raw_file" 2> "$error_file"; then
      public_api_error_is_http_404 "$error_file" && return 44
      return 75
    fi
    node "$generator" snapshot-release-inventory --input "$raw_file" > "$output_file" || return 1
  }

  public_release_tags_from_inventory() {
    local snapshot_file="$1"
    if [[ -n "$test_release_dir" ]]; then
      find "$test_release_dir" -mindepth 1 -maxdepth 1 -type d -exec basename {} \;
      return
    fi
    jq -r '.[].tag_name' "$snapshot_file"
  }

  validate_public_completed_release() {
    local tag="$1"
    local expected_source_ref="$2"
    local expected_tag_object="$3"
    local expected_release_commit="$4"
    local expected_assets actual_assets expected_prerelease expected_body
    local release_path release_assets_dir source_ref local_tag_object local_release_commit
    local initial_api initial_api_error final_api final_api_error api_status
    local initial_boundary final_boundary initial_view final_view view_error
    local provenance_status commit_verification tag_verification

    local_tag_object="$(git -C "$verify_repo" rev-parse "refs/tags/$tag" 2>/dev/null)" || return 1
    local_release_commit="$(public_direct_tag_commit \
      "$tag" "Release codex-review-gate-action $tag")" || return 1
    [[ "$local_tag_object" == "$expected_tag_object" &&
        "$local_release_commit" == "$expected_release_commit" ]] || return 1
    git -C "$verify_repo" merge-base --is-ancestor "$local_release_commit" "$target_master" || return 1

    expected_assets="$(printf '%s\n' \
      "codex-review-gate-action-${tag}.tar.gz" \
      "release-provenance.json" \
      "release-provenance.json.asc" | LC_ALL=C sort)"
    expected_prerelease=false
    [[ "${tag#v}" == *-* ]] && expected_prerelease=true
    release_assets_dir="$(mktemp -d "$verify_root/completed-release-${tag}.XXXXXX")" || return 75

    if [[ -n "$test_release_dir" ]]; then
      release_path="$test_release_dir/$tag"
      [[ -f "$release_path/published" ]] || return 44
      [[ -f "$release_path/immutable" ]] || return 45
      [[ -f "$release_path/prerelease" &&
          "$(cat "$release_path/prerelease")" == "$expected_prerelease" ]] || return 46
      actual_assets="$(find "$release_path" -mindepth 1 -maxdepth 1 -type f \
        ! -name prerelease ! -name published ! -name immutable -exec basename {} \; | LC_ALL=C sort)"
      [[ "$actual_assets" == "$expected_assets" ]] || return 1
      while IFS= read -r asset_name; do
        cp "$release_path/$asset_name" "$release_assets_dir/$asset_name" || return 75
      done <<< "$expected_assets"
    else
      initial_api="$verify_root/completed-release-${tag}-initial.json"
      initial_api_error="$verify_root/completed-release-${tag}-initial.err"
      if read_public_release_api "$tag" "$initial_api" "$initial_api_error"; then
        :
      else
        api_status=$?
        [[ "$api_status" != 44 ]] || return 47
        return "$api_status"
      fi
      [[ "$(jq -r .immutable "$initial_api")" == "true" ]] || return 45
      actual_assets="$(node "$generator" snapshot-release-assets --input "$initial_api" | \
        jq -r '.[].name' | LC_ALL=C sort)" || return 1
      [[ "$actual_assets" == "$expected_assets" ]] || return 1
      view_error="$verify_root/completed-release-${tag}-initial-view.err"
      if initial_view="$(publisher_gh release view "$tag" --repo "$TARGET_REPOSITORY" \
          --json isDraft,isPrerelease,tagName,name,body 2> "$view_error")"; then
        :
      elif public_api_error_is_http_404 "$view_error"; then
        return 47
      else
        return 75
      fi
      view_error="$verify_root/completed-release-${tag}-download.err"
      if publisher_gh release download "$tag" --repo "$TARGET_REPOSITORY" \
          --pattern '*' --dir "$release_assets_dir" 2> "$view_error"; then
        :
      elif public_api_error_is_http_404 "$view_error"; then
        return 47
      else
        return 75
      fi
    fi

    actual_assets="$(find "$release_assets_dir" -mindepth 1 -maxdepth 1 -type f \
      -exec basename {} \; | LC_ALL=C sort)"
    [[ "$actual_assets" == "$expected_assets" ]] || return 1
    source_ref="$(jq -er '.plan.source_commit | select(test("^[0-9a-f]{40}$"))' \
      "$release_assets_dir/release-provenance.json")" || return 1
    [[ -z "$expected_source_ref" || "$source_ref" == "$expected_source_ref" ]] || return 1
    if ! git -C "$repo_root" cat-file -e "$source_ref^{commit}" 2>/dev/null; then
      source_git -C "$repo_root" fetch --quiet --no-tags "$source_url" "$source_ref" || return 75
    fi
    node "$generator" verify-published-assets \
      --repo "$repo_root" \
      --target-repo "$verify_repo" \
      --source-ref "$source_ref" \
      --asset-dir "$release_assets_dir" \
      --release-commit "$local_release_commit" \
      --full-tag-object "$local_tag_object" || return 1

    if [[ -z "$test_release_dir" ]]; then
      expected_body="Signed release of $SOURCE_REPOSITORY@$source_ref."
      initial_boundary="$(node "$generator" snapshot-release-boundary \
        --input "$initial_api" \
        --tag "$tag" \
        --body "$expected_body" \
        --prerelease "$expected_prerelease" \
        --draft false \
        --immutable true)" || return 1
      [[ "$(printf '%s' "$initial_view" | jq -r .isDraft)" == "false" &&
          "$(printf '%s' "$initial_view" | jq -r .isPrerelease)" == "$expected_prerelease" &&
          "$(printf '%s' "$initial_view" | jq -r .tagName)" == "$tag" &&
          "$(printf '%s' "$initial_view" | jq -r .name)" == "$tag" &&
          "$(printf '%s' "$initial_view" | jq -r .body)" == "$expected_body" ]] || return 1
      if ! is_test_environment; then
        verify_public_signature tag "$tag" || return 1
        verify_public_signature commit "$local_release_commit" || return 1
        commit_verification="$(publisher_gh api \
          "repos/$TARGET_REPOSITORY/commits/$local_release_commit" \
          --jq '[.commit.verification.verified,.commit.verification.reason] | map(tostring) | join(" ")')" || return 75
        [[ "$commit_verification" == "true valid" ]] || return 1
        tag_verification="$(publisher_gh api \
          "repos/$TARGET_REPOSITORY/git/tags/$local_tag_object" \
          --jq '[.verification.verified,.verification.reason] | map(tostring) | join(" ")')" || return 75
        [[ "$tag_verification" == "true valid" ]] || return 1
        provenance_status="$verify_root/completed-release-${tag}.gpg-status"
        gpg --batch --status-fd=1 --verify \
          "$release_assets_dir/release-provenance.json.asc" \
          "$release_assets_dir/release-provenance.json" > "$provenance_status" 2>/dev/null || return 1
        node "$generator" verify-openpgp-status \
          --input "$provenance_status" \
          --name "completed release $tag provenance" || return 1
      fi

      view_error="$verify_root/completed-release-${tag}-final-view.err"
      if final_view="$(publisher_gh release view "$tag" --repo "$TARGET_REPOSITORY" \
          --json isDraft,isPrerelease,tagName,name,body 2> "$view_error")"; then
        :
      elif public_api_error_is_http_404 "$view_error"; then
        return 47
      else
        return 75
      fi
      [[ "$final_view" == "$initial_view" ]] || return 1
      final_api="$verify_root/completed-release-${tag}-final.json"
      final_api_error="$verify_root/completed-release-${tag}-final.err"
      if read_public_release_api "$tag" "$final_api" "$final_api_error"; then
        :
      else
        api_status=$?
        [[ "$api_status" != 44 ]] || return 47
        return "$api_status"
      fi
      final_boundary="$(node "$generator" snapshot-release-boundary \
        --input "$final_api" \
        --tag "$tag" \
        --body "$expected_body" \
        --prerelease "$expected_prerelease" \
        --draft false \
        --immutable true)" || return 1
      [[ "$final_boundary" == "$initial_boundary" ]] || return 1
    fi
    printf '%s\n' "$source_ref"
  }

  if ! is_test_environment; then
    export GNUPGHOME="$verify_root/gnupg"
    mkdir -m 700 "$GNUPGHOME"
    publisher_gh api users/JoeyTeng-Codex/gpg_keys > "$verify_root/github-signing-keys.json" || {
      fail_verification inconclusive remote-read-inconclusive immutable-tag \
        retry-public-verification "GitHub signing-key inventory could not be read"
    }
    node "$generator" verify-github-signing-key \
      --input "$verify_root/github-signing-keys.json" \
      --output-public-key "$verify_root/release-signing-public-key.asc" || {
      fail_published_state immutable-tag \
        "GitHub signing-key inventory differs from release signer policy"
    }
    gpg --batch --import "$verify_root/release-signing-public-key.asc" >/dev/null 2>&1
    verify_public_signature commit "$full_commit" || {
      fail_published_state immutable-tag "release commit signature is invalid"
    }
    verify_public_signature tag "$immutable_tag" || {
      fail_published_state immutable-tag "immutable tag signature is invalid"
    }
  fi

  public_has_other_stable_tag=false
  while IFS= read -r tag; do
    [[ "$tag" != "$immutable_tag" ]] || continue
    if public_full_stable_tag "$tag"; then
      public_has_other_stable_tag=true
      break
    fi
  done < <(printf '%s\n' "$initial_remote_tag_namespace" | \
    awk '$2 ~ /^refs\/tags\/v[^\^]+$/ {sub(/^refs\/tags\//, "", $2); print $2}')

  initial_release_inventory="$verify_root/release-inventory-initial.snapshot"
  initial_release_inventory_error="$verify_root/release-inventory-initial.err"
  if public_release_inventory_snapshot initial \
      "$initial_release_inventory" "$initial_release_inventory_error"; then
    :
  else
    inventory_status=$?
    if [[ "$inventory_status" == 75 ]]; then
      if [[ "$public_has_other_stable_tag" == true ]]; then
        fail_verification inconclusive remote-read-inconclusive floating-alias \
          retry-public-verification "complete GitHub Release inventory could not be read"
      fi
      fail_verification inconclusive release-api-unreadable immutable-release \
        retry-public-verification "GitHub Release inventory could not be read"
    fi
    fail_published_state immutable-release \
      "complete GitHub Release inventory is missing or malformed"
  fi

  stable_release_tags="$verify_root/stable-release-tags"
  stable_release_inventory_tags="$verify_root/stable-release-inventory-tags"
  : > "$stable_release_tags"
  : > "$stable_release_inventory_tags"
  printf '%s\n' "$immutable_tag" >> "$stable_release_tags"
  while IFS= read -r tag; do
    public_full_stable_tag "$tag" || continue
    printf '%s\n' "$tag" >> "$stable_release_tags"
  done < <(printf '%s\n' "$initial_remote_tag_namespace" | \
    awk '$2 ~ /^refs\/tags\/v[^\^]+$/ {sub(/^refs\/tags\//, "", $2); print $2}')
  while IFS= read -r tag; do
    if [[ "$tag" != "$immutable_tag" ]]; then
      public_full_stable_tag "$tag" || continue
    fi
    printf '%s\n' "$tag" >> "$stable_release_tags"
    printf '%s\n' "$tag" >> "$stable_release_inventory_tags"
  done < <(public_release_tags_from_inventory "$initial_release_inventory")
  if [[ -n "$(LC_ALL=C sort "$stable_release_inventory_tags" | uniq -d)" ]]; then
    fail_published_state immutable-release \
      "multiple GitHub Releases claim the same stable full-version tag"
  fi
  LC_ALL=C sort -u "$stable_release_tags" -o "$stable_release_tags"

  highest_stable_tag=""
  highest_stable_version=""
  highest_stable_tag_object=""
  highest_stable_commit=""
  highest_stable_ambiguous=false
  current_release_validated=false
  while IFS= read -r candidate_tag; do
    [[ -n "$candidate_tag" ]] || continue
    [[ "$(grep -Fxc -- "$candidate_tag" "$stable_release_inventory_tags")" == "1" ]] || {
      fail_published_state immutable-release \
        "stable full-version tag $candidate_tag does not have exactly one inventoried GitHub Release"
    }
    if ! candidate_binding="$(remote_tag_binding_from_snapshot \
        "$initial_remote_tag_namespace" "$candidate_tag")"; then
      fail_published_state floating-alias \
        "stable Release $candidate_tag is missing an exact annotated full-version tag binding"
    fi
    IFS=$'\t' read -r candidate_tag_object candidate_commit <<< "$candidate_binding"
    expected_candidate_source=""
    if [[ "$candidate_tag" == "$immutable_tag" ]]; then
      expected_candidate_source="$source_commit"
    fi
    if candidate_source="$(validate_public_completed_release \
        "$candidate_tag" "$expected_candidate_source" \
        "$candidate_tag_object" "$candidate_commit")"; then
      :
    else
      candidate_status=$?
      if [[ "$candidate_tag" == "$immutable_tag" ]]; then
        case "$candidate_status" in
          44)
            fail_verification blocked_conflict release-state-incomplete immutable-release \
              reconcile-exact-source "GitHub Release is missing or incomplete"
            ;;
          45)
            fail_verification blocked_conflict mutable-release immutable-release \
              repair-immutable-release-and-reconcile "published GitHub Release is mutable"
            ;;
          46)
            fail_verification blocked_conflict release-state-mismatch immutable-release \
              repair-immutable-release-and-reconcile "published GitHub Release state differs from policy"
            ;;
          75)
            fail_verification inconclusive release-api-unreadable immutable-release \
              retry-public-verification "GitHub Release state could not be read completely"
            ;;
          *)
            fail_published_state immutable-release \
              "GitHub Release is not a complete immutable release of the exact source"
            ;;
        esac
      fi
      if [[ "$candidate_status" == 75 ]]; then
        fail_verification inconclusive remote-read-inconclusive floating-alias \
          retry-public-verification "later GitHub Release $candidate_tag could not be read completely"
      fi
      fail_published_state floating-alias \
        "later stable tag $candidate_tag is not a complete immutable release"
    fi
    if [[ "$candidate_tag" == "$immutable_tag" ]]; then
      [[ "$candidate_source" == "$source_commit" ]] || {
        fail_published_state immutable-release \
          "GitHub Release provenance differs from the requested exact source"
      }
      current_release_validated=true
    fi
    candidate_version="${candidate_tag#v}"
    if [[ -z "$highest_stable_version" ]]; then
      highest_stable_tag="$candidate_tag"
      highest_stable_version="$candidate_version"
      highest_stable_tag_object="$candidate_tag_object"
      highest_stable_commit="$candidate_commit"
      highest_stable_ambiguous=false
    else
      stable_comparison="$(node "$generator" compare-semver \
        --left "$candidate_version" --right "$highest_stable_version")"
      if [[ "$stable_comparison" == "0" &&
            "$candidate_version" != "$highest_stable_version" ]]; then
        highest_stable_ambiguous=true
      fi
      if [[ "$stable_comparison" == "1" ]]; then
        highest_stable_tag="$candidate_tag"
        highest_stable_version="$candidate_version"
        highest_stable_tag_object="$candidate_tag_object"
        highest_stable_commit="$candidate_commit"
        highest_stable_ambiguous=false
      fi
    fi
  done < "$stable_release_tags"
  [[ "$current_release_validated" == true ]] || {
    fail_published_state immutable-release \
      "requested stable release is absent from the complete tag and Release inventories"
  }
  [[ -n "$highest_stable_tag" && -n "$highest_stable_tag_object" &&
      -n "$highest_stable_commit" ]] || {
    fail_published_state floating-alias \
      "no complete stable release exists for the requested major"
  }
  [[ "$highest_stable_ambiguous" == false ]] || {
    fail_published_state floating-alias \
      "stable release history has multiple distinct tags at the highest SemVer precedence"
  }

  alias_tag_object=""
  if [[ -n "$major_alias" ]]; then
    verification_stage="floating-alias"
    if ! remote_alias_binding="$(remote_tag_binding_from_snapshot \
        "$initial_remote_tag_namespace" "$major_alias")"; then
      fail_verification blocked_conflict major-alias-missing floating-alias \
        reconcile-exact-source "stable major alias is not published"
    fi
    IFS=$'\t' read -r alias_tag_object alias_commit <<< "$remote_alias_binding"
    [[ "$(git -C "$verify_repo" rev-parse "refs/tags/$major_alias" 2>/dev/null)" == "$alias_tag_object" &&
        "$(public_direct_tag_commit "$major_alias" "Codex Review Gate Action $major_alias")" == "$alias_commit" ]] || {
      fail_published_state floating-alias \
        "stable major alias tag object or peeled commit differs from the initial remote binding"
    }
    [[ "$(git -C "$verify_repo" for-each-ref --format='%(contents:subject)' "refs/tags/$major_alias")" == "Codex Review Gate Action $major_alias" ]] || {
      fail_published_state floating-alias "stable major alias message differs from policy"
    }
    git -C "$verify_repo" merge-base --is-ancestor "$alias_commit" "$target_master" || {
      fail_published_state floating-alias "target master does not contain the major alias commit"
    }
    [[ "$alias_commit" == "$highest_stable_commit" ]] || {
      fail_published_state floating-alias \
        "stable major alias does not target highest complete stable release $highest_stable_tag"
    }
    if ! is_test_environment; then
      verify_public_signature tag "$major_alias" || {
        fail_published_state floating-alias "major alias signature is invalid"
      }
    fi
  fi

  expected_assets="$(printf '%s\n' "codex-review-gate-action-${immutable_tag}.tar.gz" "release-provenance.json" "release-provenance.json.asc" | LC_ALL=C sort)"
  verification_stage="immutable-release"
  if [[ -n "$test_release_dir" ]]; then
    release_path="$test_release_dir/$immutable_tag"
    [[ -f "$release_path/published" && -f "$release_path/prerelease" ]] || {
      fail_verification blocked_conflict release-state-incomplete immutable-release \
        reconcile-exact-source "test release is not published with the expected state"
    }
    [[ -f "$release_path/immutable" ]] || {
      fail_verification blocked_conflict mutable-release immutable-release \
        repair-immutable-release-and-reconcile "published test Release is mutable"
    }
    [[ "$(cat "$release_path/prerelease")" == "$prerelease" ]] || {
      fail_verification blocked_conflict release-state-mismatch immutable-release \
        repair-immutable-release-and-reconcile "test Release prerelease state differs from policy"
    }
    for name in $expected_assets; do
      [[ -f "$release_path/$name" ]] || {
        fail_verification blocked_conflict release-state-incomplete immutable-release \
          reconcile-exact-source "published test Release is missing an expected asset"
      }
      cp "$release_path/$name" "$assets_dir/$name"
    done
  else
    expected_release_body="Signed release of $SOURCE_REPOSITORY@$source_commit."
    verification_release_view_error="$verify_root/release-view.err"
    if release_state="$(publisher_gh release view "$immutable_tag" --repo "$TARGET_REPOSITORY" --json isDraft,isPrerelease,tagName,name,body 2> "$verification_release_view_error")"; then
      :
    else
      release_view_status=$?
      if [[ "$release_view_status" != 0 ]] &&
        public_api_error_is_http_404 "$verification_release_view_error"; then
        fail_verification blocked_conflict release-state-missing immutable-release \
          reconcile-exact-source "GitHub Release is not published"
      fi
      fail_verification inconclusive release-api-unreadable immutable-release \
        retry-public-verification "GitHub Release state could not be read"
    fi
    [[ "$(printf '%s' "$release_state" | jq -r .isDraft)" == "false" ]] || {
      fail_verification blocked_conflict release-state-incomplete immutable-release \
        reconcile-exact-source "GitHub Release remains a draft"
    }
    [[ "$(printf '%s' "$release_state" | jq -r .isPrerelease)" == "$prerelease" ]] || {
      fail_published_state immutable-release "GitHub Release prerelease state differs from policy"
    }
    [[ "$(printf '%s' "$release_state" | jq -r .tagName)" == "$immutable_tag" &&
        "$(printf '%s' "$release_state" | jq -r .name)" == "$immutable_tag" &&
        "$(printf '%s' "$release_state" | jq -r .body)" == "$expected_release_body" ]] || {
      fail_published_state immutable-release "published GitHub Release metadata differs from policy"
    }
    initial_release_api="$verify_root/release-initial.json"
    initial_release_error="$verify_root/release-initial.err"
    if read_public_release_api "$immutable_tag" "$initial_release_api" "$initial_release_error"; then
      :
    else
      initial_release_status=$?
      if [[ "$initial_release_status" == 44 ]]; then
        fail_published_state immutable-release \
          "GitHub Release disappeared after its initial public view"
      fi
      fail_verification inconclusive release-api-unreadable immutable-release \
        retry-public-verification "GitHub Release API state could not be read"
    fi
    [[ "$(jq -r .author.login "$initial_release_api")" == "codex-review-gate-action-publisher[bot]" ]] || {
      fail_published_state immutable-release "published GitHub Release author differs from policy"
    }
    [[ "$(jq -r .immutable "$initial_release_api")" == "true" ]] || {
      fail_verification blocked_conflict mutable-release immutable-release \
        repair-immutable-release-and-reconcile "published GitHub Release is not immutable"
    }
    initial_asset_snapshot="$(node "$generator" snapshot-release-assets --input "$initial_release_api")" || {
      fail_published_state immutable-release "published GitHub Release asset metadata is malformed"
    }
    if ! commit_verification="$(publisher_gh api "repos/$TARGET_REPOSITORY/commits/$full_commit" --jq '[.commit.verification.verified,.commit.verification.reason] | map(tostring) | join(" ")')"; then
      fail_verification inconclusive release-api-unreadable immutable-release \
        retry-public-verification "release commit verification state could not be read"
    fi
    [[ "$commit_verification" == "true valid" ]] || {
      fail_published_state immutable-release "release commit signature is not verified by GitHub"
    }
    if ! tag_verification="$(publisher_gh api "repos/$TARGET_REPOSITORY/git/tags/$full_tag_object" --jq '[.verification.verified,.verification.reason] | map(tostring) | join(" ")')"; then
      fail_verification inconclusive release-api-unreadable immutable-release \
        retry-public-verification "immutable tag verification state could not be read"
    fi
    [[ "$tag_verification" == "true valid" ]] || {
      fail_published_state immutable-release "immutable tag signature is not verified by GitHub"
    }
    if [[ -n "$major_alias" ]]; then
      if ! alias_verification="$(publisher_gh api "repos/$TARGET_REPOSITORY/git/tags/$alias_tag_object" --jq '[.verification.verified,.verification.reason] | map(tostring) | join(" ")')"; then
        fail_verification inconclusive release-api-unreadable immutable-release \
          retry-public-verification "floating alias verification state could not be read"
      fi
      [[ "$alias_verification" == "true valid" ]] || {
        fail_published_state immutable-release "floating alias signature is not verified by GitHub"
      }
    fi
    actual_assets="$(printf '%s' "$initial_asset_snapshot" | jq -r '.[].name' | LC_ALL=C sort)"
    [[ "$actual_assets" == "$expected_assets" ]] || {
      fail_published_state immutable-release "published release asset inventory differs from policy"
    }
    release_download_error="$verify_root/release-download.err"
    if publisher_gh release download "$immutable_tag" --repo "$TARGET_REPOSITORY" \
      --pattern '*' --dir "$assets_dir" 2> "$release_download_error"; then
      :
    elif public_api_error_is_http_404 "$release_download_error"; then
      fail_published_state immutable-release \
        "GitHub Release disappeared before its assets could be downloaded"
    else
      fail_verification inconclusive release-api-unreadable immutable-release \
        retry-public-verification "published release assets could not be downloaded"
    fi
  fi
  actual_assets="$(find "$assets_dir" -mindepth 1 -maxdepth 1 -type f -exec basename {} \; | LC_ALL=C sort)"
  [[ "$actual_assets" == "$expected_assets" ]] || {
    fail_published_state immutable-release "downloaded release asset inventory differs from policy"
  }
  node "$generator" verify-published-assets \
    --repo "$repo_root" \
    --target-repo "$verify_repo" \
    --source-ref "$source_commit" \
    --asset-dir "$assets_dir" \
    --release-commit "$full_commit" \
    --full-tag-object "$full_tag_object" || {
    fail_published_state immutable-release \
      "published release assets or provenance differ from the exact source"
  }
  if ! is_test_environment; then
    provenance_status="$verify_root/provenance.gpg-status"
    gpg --batch --status-fd=1 --verify "$assets_dir/release-provenance.json.asc" "$assets_dir/release-provenance.json" > "$provenance_status" 2>/dev/null || {
      fail_published_state immutable-release \
        "detached release provenance signature verification failed"
    }
    node "$generator" verify-openpgp-status \
      --input "$provenance_status" \
      --name "release provenance" || {
      fail_published_state immutable-release \
        "detached release provenance signature does not match release signer policy"
    }
  fi
  if [[ -z "$test_release_dir" ]]; then
    final_release_view_error="$verify_root/release-final-view.err"
    if final_release_state="$(publisher_gh release view "$immutable_tag" --repo "$TARGET_REPOSITORY" --json isDraft,isPrerelease,tagName,name,body 2> "$final_release_view_error")"; then
      :
    elif public_api_error_is_http_404 "$final_release_view_error"; then
      fail_published_state immutable-release \
        "GitHub Release disappeared during public verification"
    else
      fail_verification inconclusive release-api-unreadable immutable-release \
        retry-public-verification "final GitHub Release state could not be read"
    fi
    [[ "$final_release_state" == "$release_state" ]] || {
      fail_published_state immutable-release \
        "GitHub Release metadata changed during public verification"
    }
    final_release_api="$verify_root/release-final.json"
    final_release_error="$verify_root/release-final.err"
    if read_public_release_api "$immutable_tag" "$final_release_api" "$final_release_error"; then
      :
    else
      final_release_status=$?
      if [[ "$final_release_status" == 44 ]]; then
        fail_published_state immutable-release \
          "GitHub Release disappeared during its final API readback"
      fi
      fail_verification inconclusive release-api-unreadable immutable-release \
        retry-public-verification "final GitHub Release API state could not be read"
    fi
    [[ "$(jq -r .immutable "$final_release_api")" == "true" ]] || {
      fail_verification blocked_conflict mutable-release immutable-release \
        repair-immutable-release-and-reconcile \
        "GitHub Release immutability changed during public verification"
    }
    if ! final_asset_snapshot="$(node "$generator" snapshot-release-assets --input "$final_release_api")"; then
      fail_published_state immutable-release \
        "final GitHub Release asset metadata is malformed"
    fi
    [[ "$final_asset_snapshot" == "$initial_asset_snapshot" ]] || {
      fail_published_state immutable-release \
        "GitHub Release asset identity or metadata changed during public verification"
    }
    [[ "$(jq -r .author.login "$final_release_api")" == "codex-review-gate-action-publisher[bot]" ]] || {
      fail_published_state immutable-release \
        "GitHub Release author changed during public verification"
    }
  fi
  final_release_inventory="$verify_root/release-inventory-final.snapshot"
  final_release_inventory_error="$verify_root/release-inventory-final.err"
  if public_release_inventory_snapshot final \
      "$final_release_inventory" "$final_release_inventory_error"; then
    :
  else
    final_inventory_status=$?
    if [[ "$final_inventory_status" == 75 ]]; then
      fail_verification inconclusive remote-read-inconclusive immutable-release \
        retry-public-verification "final complete GitHub Release inventory could not be read"
    fi
    fail_published_state immutable-release \
      "final complete GitHub Release inventory is missing or malformed"
  fi
  cmp -- "$initial_release_inventory" "$final_release_inventory" || {
    fail_published_state immutable-release \
      "complete GitHub Release inventory changed during public verification"
  }
  if ! final_remote_tag_namespace="$(git ls-remote "$target_url" 'refs/tags/v*')"; then
    fail_verification inconclusive remote-read-inconclusive immutable-release \
      retry-public-verification "final complete target tag namespace could not be read"
  fi
  final_remote_tag_namespace="$(printf '%s\n' "$final_remote_tag_namespace" | LC_ALL=C sort)"
  [[ "$final_remote_tag_namespace" == "$initial_remote_tag_namespace" ]] || {
    fail_published_state immutable-release \
      "complete target tag namespace changed during public verification"
  }
  if ! final_full="$(git ls-remote "$target_url" "refs/tags/$immutable_tag" "refs/tags/$immutable_tag^{}")"; then
    fail_verification inconclusive remote-read-inconclusive immutable-release \
      retry-public-verification "immutable tag final state could not be read"
  fi
  final_full_binding="$(remote_tag_binding_from_snapshot "$final_full" "$immutable_tag")" || {
    fail_published_state immutable-release \
      "immutable tag final state is missing or malformed"
  }
  [[ "$final_full_binding" == "$remote_full_binding" ]] || {
    fail_published_state immutable-release "immutable tag changed during public verification"
  }
  if [[ -n "$major_alias" ]]; then
    if ! final_alias="$(git ls-remote "$target_url" "refs/tags/$major_alias" "refs/tags/$major_alias^{}")"; then
      fail_verification inconclusive remote-read-inconclusive immutable-release \
        retry-public-verification "major alias final state could not be read"
    fi
    final_alias_binding="$(remote_tag_binding_from_snapshot "$final_alias" "$major_alias")" || {
      fail_published_state immutable-release \
        "major alias final state is missing or malformed"
    }
    [[ "$final_alias_binding" == "$remote_alias_binding" ]] || {
      fail_published_state immutable-release "major alias changed during public verification"
    }
  fi
  if ! final_master="$(remote_master)"; then
    fail_verification inconclusive remote-read-inconclusive immutable-release \
      retry-public-verification "target master final state could not be read"
  fi
  git -C "$verify_repo" fetch --quiet origin "$final_master" || {
    fail_verification inconclusive remote-read-inconclusive immutable-release \
      retry-public-verification "target master final object could not be fetched"
  }
  git -C "$verify_repo" merge-base --is-ancestor "$full_commit" "$final_master" || {
    fail_published_state immutable-release \
      "final target master no longer contains the immutable release"
  }
  verification_stage="complete"
  emit_verification_result verified none complete none
  exit 0
fi

[[ "$mode" == "publish" && -d "$candidate" && -f "$publication_plan_file" ]] || {
  echo "error: --publish requires --candidate and --publication-plan-file" >&2
  exit 2
}
preflight_live_source="$(json_field "$publication_plan_file" live_source_master)"
[[ "$preflight_live_source" =~ ^[0-9a-f]{40}$ ]] || {
  echo "error: publication plan live source master is invalid" >&2
  exit 1
}
if ! live_source_at_publish="$(source_live_master)"; then
  emit_reconcile_state inconclusive stderr
  emit_recovery_code remote-read-inconclusive "live source master could not be read"
  exit 1
fi
[[ "$live_source_at_publish" =~ ^[0-9a-f]{40}$ ]] || {
  emit_reconcile_state inconclusive stderr
  emit_recovery_code remote-read-inconclusive "live source master is malformed"
  exit 1
}
source_git fetch --quiet --no-tags "$source_url" "$live_source_at_publish"
if ! preflight_state="$(node "$generator" verify-publication-plan \
    --repo "$repo_root" \
    --source-ref "$source_commit" \
    --control-ref "$control_commit" \
    --live-master-ref "$live_source_at_publish" \
    --candidate "$candidate" \
    --publication-plan "$publication_plan_file")"; then
    emit_recovery_code publication-input-preflight "no target ref or Release write was attempted"
    exit 1
fi
preflight_write_eligible="$(jq -r .write_eligible <<< "$preflight_state")"
[[ "$preflight_write_eligible" == "true" || "$preflight_write_eligible" == "false" ]] || {
  echo "error: publication preflight returned an invalid write eligibility state" >&2
  exit 1
}
preflight_recovery_code="$(jq -r '.recovery_code // ""' <<< "$preflight_state")"
preflight_recovery_reason="$(jq -r '.reason // ""' <<< "$preflight_state")"
stale_completion_authorized=false
immutable_policy_preflight_complete=false
require_publication_mutation() {
  local mutation_class="$1"
  if [[ "$preflight_write_eligible" != "true" ]]; then
    if [[ "$stale_completion_authorized" != "true" ||
          ("$mutation_class" != "immutable-tag" &&
           "$mutation_class" != "release-completion" &&
           "$mutation_class" != "alias") ]]; then
      emit_recovery_code frozen-source-superseded "target mutation is forbidden for this frozen source"
      [[ -z "$preflight_recovery_reason" ]] || echo "error: $preflight_recovery_reason" >&2
      return 1
    fi
  fi
  if [[ "$immutable_policy_preflight_complete" != "true" ]]; then
    require_immutable_release_policy first-mutation
    immutable_policy_preflight_complete=true
  fi
  verify_final_policy_fence "before-$mutation_class"
  return 0
}
candidate_source="$(json_field "$candidate/candidate.json" plan.source_commit)"
candidate_tree="$(json_field "$candidate/candidate.json" plan.source_tree)"
candidate_version="$(json_field "$candidate/candidate.json" plan.version)"
planned_master="$(json_field "$candidate/candidate.json" plan.target_master_before)"
candidate_manifest_digest="$(json_field "$candidate/candidate.json" plan.manifest_sha256)"
previous_version="$(json_field "$candidate/candidate.json" plan.previous_version)"
[[ "$candidate_source" == "$source_commit" && "$candidate_version" == "$release_version" ]] || {
  echo "error: candidate does not match the source commit and manifest" >&2
  exit 1
}
[[ "$(git rev-parse "$source_commit:$SOURCE_PATH")" == "$candidate_tree" ]] || {
  echo "error: source subtree changed after candidate assembly" >&2
  exit 1
}
actual_manifest_digest="$(git cat-file blob "$source_commit:release-manifest.json" | shasum -a 256 | awk '{print $1}')"
[[ "$actual_manifest_digest" == "$candidate_manifest_digest" ]] || {
  echo "error: source release manifest differs from the assembled candidate" >&2
  exit 1
}

if ! is_test_environment; then
  [[ -n "$publisher_token" && -n "${GNUPGHOME:-}" ]] || {
    echo "error: publisher App token and isolated GNUPGHOME are required" >&2
    exit 1
  }
  node "$generator" verify-signing-key --gnupg-home "$GNUPGHOME" || {
    echo "error: release signing keyring violates the signing-subkey-only policy" >&2
    exit 1
  }
  [[ "${RELEASE_PUBLISHER_APP_OWNER:-}" == "JoeyTeng" && "${RELEASE_PUBLISHER_APP_SLUG:-}" == "codex-review-gate-action-publisher" ]] || {
    echo "error: publisher App owner/slug differs from release policy" >&2
    exit 1
  }
fi

temporary_root="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/codex-review-gate-release.XXXXXX")"
stage_repo="$temporary_root/target"
ruleset_snapshot_counter=0
immutable_policy_counter=0
signer_policy_counter=0

verify_live_release_signer_policy() {
  local label="$1"
  local github_keys github_keys_error live_public_key approved_public_key
  if is_test_environment && [[ "$enforce_live_signer_policy_in_test" != true ]]; then
    return 0
  fi
  signer_policy_counter=$((signer_policy_counter + 1))
  github_keys="$temporary_root/github-signing-keys-${signer_policy_counter}-${label}.json"
  github_keys_error="$temporary_root/github-signing-keys-${signer_policy_counter}-${label}.err"
  live_public_key="$temporary_root/release-signing-public-key-${signer_policy_counter}-${label}.asc"
  approved_public_key="${RUNNER_TEMP:-}/release-signing-public-key.asc"
  if ! publisher_gh api users/JoeyTeng-Codex/gpg_keys > "$github_keys" 2> "$github_keys_error"; then
    cat "$github_keys_error" >&2
    fail_reconcile inconclusive remote-read-inconclusive \
      "the live GitHub signing-key inventory could not be read at the $label policy fence"
  fi
  node "$generator" verify-github-signing-key \
    --input "$github_keys" \
    --output-public-key "$live_public_key" || {
    fail_reconcile blocked_conflict signing-key-policy-changed \
      "the release signing key is missing, revoked, expired, duplicated, or otherwise differs from policy at the $label policy fence"
  }
  [[ -n "${RUNNER_TEMP:-}" && -f "$approved_public_key" && ! -L "$approved_public_key" ]] || {
    fail_reconcile blocked_conflict signing-key-policy-changed \
      "the approved release signing certificate is unavailable at the $label policy fence"
  }
  cmp -s -- "$approved_public_key" "$live_public_key" || {
    fail_reconcile blocked_conflict signing-key-policy-changed \
      "the live release signing certificate content differs from the approved certificate at the $label policy fence"
  }
}

verify_ruleset_policy_snapshot() {
  local label="$1"
  local summary_file details_dir details_file ruleset_id
  [[ -z "$test_release_dir" ]] || return 0
  ruleset_snapshot_counter=$((ruleset_snapshot_counter + 1))
  summary_file="$temporary_root/rulesets-${ruleset_snapshot_counter}-${label}.json"
  details_dir="$temporary_root/ruleset-details-${ruleset_snapshot_counter}-${label}"
  details_file="$temporary_root/ruleset-details-${ruleset_snapshot_counter}-${label}.json"
  if ! publisher_gh api --paginate --slurp \
      --header 'X-GitHub-Api-Version: 2026-03-10' \
      "repos/$TARGET_REPOSITORY/rulesets" > "$summary_file"; then
    fail_reconcile inconclusive remote-read-inconclusive \
      "target rulesets could not be read at the $label policy fence; retry the exact source SHA"
  fi
  jq -e '
    type == "array" and
    ([flatten[] | .id] as $ids |
      ($ids | length) == 4 and
      ($ids | unique | length) == 4 and
      all($ids[]; type == "number" and . > 0))
  ' "$summary_file" >/dev/null || {
    fail_reconcile blocked_conflict publisher-ruleset-policy-changed \
      "the active target ruleset inventory differs from the exact four-ruleset baseline"
  }
  mkdir -m 700 "$details_dir"
  while IFS= read -r ruleset_id; do
    if ! publisher_gh api \
        --header 'X-GitHub-Api-Version: 2026-03-10' \
        "repos/$TARGET_REPOSITORY/rulesets/$ruleset_id" > "$details_dir/$ruleset_id.json"; then
      fail_reconcile inconclusive remote-read-inconclusive \
        "target ruleset $ruleset_id could not be read at the $label policy fence"
    fi
  done < <(jq -r 'flatten[] | .id' "$summary_file" | LC_ALL=C sort -n)
  jq -s '.' "$details_dir"/*.json > "$details_file"
  node "$generator" verify-rulesets --input "$details_file" || {
    fail_reconcile blocked_conflict publisher-ruleset-policy-changed \
      "effective target rulesets differ from the adopted publisher and integrity contract"
  }
}

verify_final_policy_fence() {
  local label="$1"
  local observed_source_master
  [[ -z "$test_release_dir" ]] || return 0
  if ! observed_source_master="$(source_live_master)"; then
    fail_reconcile inconclusive remote-read-inconclusive \
      "source master could not be read at the $label policy fence; retry the exact source SHA"
  fi
  [[ "$observed_source_master" == "$preflight_live_source" ]] || {
    fail_reconcile inconclusive source-state-changed \
      "source master moved after the publication plan; reconcile the partial prefix with the exact source SHA"
  }
  verify_ruleset_policy_snapshot "$label"
  verify_live_release_signer_policy "$label"
}

require_immutable_release_policy() {
  local label="$1"
  local policy_file
  [[ -z "$test_release_dir" ]] || return 0
  immutable_policy_counter=$((immutable_policy_counter + 1))
  policy_file="$temporary_root/immutable-releases-${immutable_policy_counter}-${label}.json"
  if ! publisher_gh api \
      --header 'X-GitHub-Api-Version: 2026-03-10' \
      "repos/$TARGET_REPOSITORY/immutable-releases" > "$policy_file"; then
    fail_reconcile inconclusive immutable-release-policy-unreadable \
      "target immutable-release policy could not be read before $label"
  fi
  jq -e 'type == "object" and keys == ["enabled"] and .enabled == true' \
    "$policy_file" >/dev/null || {
    fail_reconcile blocked_conflict immutable-release-policy-disabled \
      "target immutable releases must be enabled before any release mutation"
  }
}

if ! is_test_environment; then
  verify_ruleset_policy_snapshot initial
fi
git clone --quiet "$target_url" "$stage_repo"
git -C "$stage_repo" fetch --quiet --force --no-write-fetch-head \
  "$target_url" '+refs/tags/*:refs/tags/*'
git -C "$stage_repo" fetch --quiet --no-tags "$repo_root" "$source_commit"
git -C "$stage_repo" config user.name "JoeyTeng-Codex"
git -C "$stage_repo" config user.email "codex@mahane.me"
git -C "$stage_repo" config user.signingkey "${SIGNING_SUBKEY}!"
target_master="$(git -C "$stage_repo" rev-parse "origin/$TARGET_BRANCH")"
initial_master="$(json_field "$baseline" initial_target_master)"
git -C "$stage_repo" merge-base --is-ancestor "$initial_master" "$target_master" || {
  echo "error: target master no longer descends from the recorded v1 history" >&2
  exit 1
}

release_subject="Release codex-review-gate-action $immutable_tag"
release_body="$(printf '%s\n\nSource: %s@%s\nManifest-SHA256: %s\n' "$release_subject" "$SOURCE_REPOSITORY" "$source_commit" "$candidate_manifest_digest")"

verify_exact_signature() {
  local kind="$1"
  local object="$2"
  local status_file="$temporary_root/${kind}-${object}.gpg-status"
  if [[ "$kind" == "commit" ]]; then
    git -C "$stage_repo" verify-commit --raw "$object" >/dev/null 2> "$status_file" || return 1
  else
    git -C "$stage_repo" verify-tag --raw "$object" >/dev/null 2> "$status_file" || return 1
  fi
  node "$generator" verify-openpgp-status --input "$status_file" --name "$kind $object"
}

validate_release_commit() {
  local commit="$1"
  [[ "$(git -C "$stage_repo" rev-parse "$commit^{tree}")" == "$candidate_tree" ]] || return 1
  [[ "$(git -C "$stage_repo" show -s --format=%s "$commit")" == "$release_subject" ]] || return 1
  [[ "$(git -C "$stage_repo" show -s --format=%an "$commit")" == "JoeyTeng-Codex" ]] || return 1
  [[ "$(git -C "$stage_repo" show -s --format=%ae "$commit")" == "codex@mahane.me" ]] || return 1
  [[ "$(git -C "$stage_repo" show -s --format=%cn "$commit")" == "JoeyTeng-Codex" ]] || return 1
  [[ "$(git -C "$stage_repo" show -s --format=%ce "$commit")" == "codex@mahane.me" ]] || return 1
  [[ "$(git -C "$stage_repo" show -s --format=%P "$commit")" == "$planned_master" ]] || return 1
  [[ "$(git -C "$stage_repo" show -s --format=%B "$commit")" == "$release_body" ]] || return 1
  if [[ "$skip_signatures" != true ]]; then
    verify_exact_signature commit "$commit" || return 1
  fi
}

direct_annotated_tag_commit() {
  local tag="$1"
  local expected_subject="${2:-}"
  local object direct_object direct_type peeled header_count tagger_header
  object="$(git -C "$stage_repo" rev-parse "refs/tags/$tag" 2>/dev/null)" || return 1
  [[ "$(git -C "$stage_repo" cat-file -t "$object" 2>/dev/null)" == "tag" ]] || return 1
  direct_object="$(git -C "$stage_repo" cat-file tag "$object" | sed -n '1s/^object //p')"
  direct_type="$(git -C "$stage_repo" cat-file tag "$object" | sed -n '2s/^type //p')"
  [[ "$direct_object" =~ ^[0-9a-f]{40}$ && "$direct_type" == "commit" ]] || return 1
  [[ "$(git -C "$stage_repo" cat-file -t "$direct_object" 2>/dev/null)" == "commit" ]] || return 1
  header_count="$(git -C "$stage_repo" cat-file tag "$object" | awk '/^$/ {print NR - 1; exit}')"
  [[ "$header_count" == "4" ]] || return 1
  [[ "$(git -C "$stage_repo" cat-file tag "$object" | sed -n '1p')" == "object $direct_object" ]] || return 1
  [[ "$(git -C "$stage_repo" cat-file tag "$object" | sed -n '2p')" == "type commit" ]] || return 1
  [[ "$(git -C "$stage_repo" cat-file tag "$object" | sed -n '3p')" == "tag $tag" ]] || return 1
  tagger_header="$(git -C "$stage_repo" cat-file tag "$object" | sed -n '4p')"
  [[ "$tagger_header" =~ ^tagger\ JoeyTeng-Codex\ \<codex@mahane\.me\>\ [0-9]+\ [+-][0-9]{4}$ ]] || return 1
  [[ "$(git -C "$stage_repo" for-each-ref --format='%(tag)' "refs/tags/$tag")" == "$tag" ]] || return 1
  [[ "$(git -C "$stage_repo" for-each-ref --format='%(taggername)' "refs/tags/$tag")" == "JoeyTeng-Codex" ]] || return 1
  [[ "$(git -C "$stage_repo" for-each-ref --format='%(taggeremail)' "refs/tags/$tag")" == "<codex@mahane.me>" ]] || return 1
  if [[ -n "$expected_subject" ]]; then
    [[ "$(git -C "$stage_repo" for-each-ref --format='%(contents:subject)' "refs/tags/$tag")" == "$expected_subject" ]] || return 1
    [[ -z "$(git -C "$stage_repo" for-each-ref --format='%(contents:body)' "refs/tags/$tag")" ]] || return 1
  fi
  git -C "$stage_repo" cat-file -e "$direct_object^{commit}" 2>/dev/null || return 1
  peeled="$(git -C "$stage_repo" rev-parse "refs/tags/$tag^{}")" || return 1
  [[ "$peeled" == "$direct_object" ]] || return 1
  printf '%s\n' "$direct_object"
}

validate_superseding_release() {
  local tag="$1"
  local commit subject package_version package_repository body
  local body_line_count body_subject body_separator body_source body_manifest
  local -a parents
  subject="Release codex-review-gate-action $tag"
  commit="$(direct_annotated_tag_commit "$tag" "$subject")" || return 1
  read -r -a parents <<< "$(git -C "$stage_repo" show -s --format=%P "$commit")"
  [[ "${#parents[@]}" == 1 ]] || return 1
  [[ "$(git -C "$stage_repo" show -s --format=%an "$commit")" == "JoeyTeng-Codex" ]] || return 1
  [[ "$(git -C "$stage_repo" show -s --format=%ae "$commit")" == "codex@mahane.me" ]] || return 1
  [[ "$(git -C "$stage_repo" show -s --format=%cn "$commit")" == "JoeyTeng-Codex" ]] || return 1
  [[ "$(git -C "$stage_repo" show -s --format=%ce "$commit")" == "codex@mahane.me" ]] || return 1
  body="$(git -C "$stage_repo" show -s --format=%B "$commit")"
  body_line_count="$(printf '%s\n' "$body" | awk 'END {print NR}')"
  body_subject="$(printf '%s\n' "$body" | sed -n '1p')"
  body_separator="$(printf '%s\n' "$body" | sed -n '2p')"
  body_source="$(printf '%s\n' "$body" | sed -n '3p')"
  body_manifest="$(printf '%s\n' "$body" | sed -n '4p')"
  [[ "$body_line_count" == 4 && "$body_subject" == "$subject" && -z "$body_separator" ]] || return 1
  [[ "$body_source" =~ ^Source:\ Joey-Tools/codex-review-gate@[0-9a-f]{40}$ ]] || return 1
  [[ "$body_manifest" =~ ^Manifest-SHA256:\ [0-9a-f]{64}$ ]] || return 1
  git -C "$stage_repo" cat-file -e "$commit:action.yml" || return 1
  git -C "$stage_repo" cat-file -e "$commit:package.json" || return 1
  package_version="$(git -C "$stage_repo" show "$commit:package.json" | jq -r .version)"
  package_repository="$(git -C "$stage_repo" show "$commit:package.json" | jq -r .repository.url)"
  [[ "$package_version" == "${tag#v}" ]] || return 1
  [[ "$package_repository" == "git+https://github.com/JoeyTeng/codex-review-gate-action.git" ]] || return 1
  if [[ "$skip_signatures" != true ]]; then
    verify_exact_signature tag "$tag" || return 1
    verify_exact_signature commit "$commit" || return 1
  fi
}

release_asset_inventory_for_tag() {
  local tag="$1"
  printf '%s\n' \
    "codex-review-gate-action-${tag}.tar.gz" \
    "release-provenance.json" \
    "release-provenance.json.asc" | LC_ALL=C sort
}

validate_completed_release_state() {
  local tag="$1"
  local expected actual api_file error_file release_path asset_dir source_ref release_commit tag_object
  local provenance_status expected_prerelease expected_body
  expected="$(release_asset_inventory_for_tag "$tag")"
  if [[ -n "$test_release_dir" ]]; then
    release_path="$test_release_dir/$tag"
    [[ -f "$release_path/published" && -f "$release_path/immutable" ]] || return 1
    expected_prerelease=false
    [[ "${tag#v}" == *-* ]] && expected_prerelease=true
    [[ -f "$release_path/prerelease" && "$(cat "$release_path/prerelease")" == "$expected_prerelease" ]] || return 1
    actual="$(find "$release_path" -mindepth 1 -maxdepth 1 -type f \
      ! -name prerelease ! -name published ! -name immutable -exec basename {} \; | LC_ALL=C sort)"
    [[ "$actual" == "$expected" ]] || return 1
    asset_dir="$(mktemp -d "$temporary_root/completed-release-${tag}.XXXXXX")"
    while IFS= read -r asset_name; do
      cp "$release_path/$asset_name" "$asset_dir/$asset_name"
    done <<< "$expected"
    source_ref="$(jq -er '.plan.source_commit | select(test("^[0-9a-f]{40}$"))' "$asset_dir/release-provenance.json")" || return 1
    git cat-file -e "$source_ref^{commit}" || return 75
    release_commit="$(git -C "$stage_repo" rev-parse "refs/tags/$tag^{}")"
    tag_object="$(git -C "$stage_repo" rev-parse "refs/tags/$tag")"
    node "$generator" verify-published-assets \
      --repo "$repo_root" \
      --target-repo "$stage_repo" \
      --source-ref "$source_ref" \
      --asset-dir "$asset_dir" \
      --release-commit "$release_commit" \
      --full-tag-object "$tag_object" || return 1
    return 0
  fi
  api_file="$temporary_root/completed-release-${tag}.json"
  error_file="$temporary_root/completed-release-${tag}.err"
  if ! publisher_gh api "repos/$TARGET_REPOSITORY/releases/tags/$tag" > "$api_file" 2> "$error_file"; then
    cat "$error_file" >&2
    grep -Fq "HTTP 404" "$error_file" && return 1
    return 75
  fi
  actual="$(jq -r '.assets[].name' "$api_file" | LC_ALL=C sort)"
  [[ "$actual" == "$expected" ]] || return 1
  asset_dir="$(mktemp -d "$temporary_root/completed-release-${tag}.XXXXXX")"
  publisher_gh release download "$tag" --repo "$TARGET_REPOSITORY" --pattern '*' --dir "$asset_dir" || return 75
  source_ref="$(jq -er '.plan.source_commit | select(test("^[0-9a-f]{40}$"))' "$asset_dir/release-provenance.json")" || return 1
  expected_prerelease=false
  [[ "${tag#v}" == *-* ]] && expected_prerelease=true
  expected_body="Signed release of $SOURCE_REPOSITORY@$source_ref."
  node "$generator" snapshot-release-boundary \
    --input "$api_file" \
    --tag "$tag" \
    --body "$expected_body" \
    --prerelease "$expected_prerelease" \
    --draft false \
    --immutable true >/dev/null || return 1
  git cat-file -e "$source_ref^{commit}" || return 75
  release_commit="$(git -C "$stage_repo" rev-parse "refs/tags/$tag^{}")"
  tag_object="$(git -C "$stage_repo" rev-parse "refs/tags/$tag")"
  node "$generator" verify-published-assets \
    --repo "$repo_root" \
    --target-repo "$stage_repo" \
    --source-ref "$source_ref" \
    --asset-dir "$asset_dir" \
    --release-commit "$release_commit" \
    --full-tag-object "$tag_object" || return 1
  provenance_status="$temporary_root/completed-release-${tag}.gpg-status"
  gpg --batch --status-fd=1 --verify \
    "$asset_dir/release-provenance.json.asc" \
    "$asset_dir/release-provenance.json" > "$provenance_status" 2>/dev/null || return 1
  node "$generator" verify-openpgp-status \
    --input "$provenance_status" \
    --name "completed release $tag provenance"
}

require_completed_release_state() {
  local tag="$1"
  local conflict_code="$2"
  shift 2
  local status
  if validate_completed_release_state "$tag"; then
    return 0
  else
    status=$?
  fi
  if [[ "$status" == 75 ]]; then
    fail_reconcile inconclusive remote-read-inconclusive \
      "remote state for $tag could not be read completely; retry the exact source SHA"
  fi
  fail_reconcile blocked_conflict "$conflict_code" "$*"
}

is_v2_plus_full_tag() {
  local tag="$1"
  local version major
  [[ "$tag" == v* ]] || return 1
  version="${tag#v}"
  major="${version%%.*}"
  is_v2_plus_major "$major" || return 1
  node "$generator" compare-semver --left "$version" --right "$version" >/dev/null 2>&1
}

is_v2_plus_major_alias() {
  local tag="$1"
  local major
  [[ "$tag" == v* ]] || return 1
  major="${tag#v}"
  [[ "$major" != *.* && "$major" != *-* ]] || return 1
  is_v2_plus_major "$major"
}

validate_completed_stable_alias() {
  local tag="$1"
  local version="${tag#v}"
  local major="${version%%.*}"
  local alias="v${major}"
  local release_commit alias_commit alias_target_tag alias_target_version alias_target_commit
  [[ "$version" != *-* ]] || return 0
  release_commit="$(direct_annotated_tag_commit "$tag" "Release codex-review-gate-action $tag")" || return 1
  alias_commit="$(direct_annotated_tag_commit "$alias" "Codex Review Gate Action $alias")" || return 1
  [[ -n "$alias_commit" ]] || return 1
  [[ "$(git -C "$stage_repo" for-each-ref --format='%(contents:subject)' "refs/tags/$alias")" == "Codex Review Gate Action $alias" ]] || return 1
  if [[ "$skip_signatures" != true ]]; then
    verify_exact_signature tag "$alias" || return 1
  fi
  git -C "$stage_repo" merge-base --is-ancestor "$release_commit" "$alias_commit" || return 1
  while IFS= read -r alias_target_tag; do
    is_v2_plus_full_tag "$alias_target_tag" || continue
    alias_target_version="${alias_target_tag#v}"
    [[ "$alias_target_version" != *-* && "${alias_target_version%%.*}" == "$major" ]] || continue
    [[ "$(node "$generator" compare-semver --left "$alias_target_version" --right "$version")" != "-1" ]] || continue
    validate_superseding_release "$alias_target_tag" || continue
    alias_target_commit="$(direct_annotated_tag_commit "$alias_target_tag" "Release codex-review-gate-action $alias_target_tag")" || continue
    [[ "$alias_target_commit" == "$alias_commit" ]] || continue
    return 0
  done < <(git -C "$stage_repo" tag --points-at "$alias_commit" --list 'v*')
  return 1
}

later_same_major_stable_tag=""
later_same_major_stable_version=""
later_release_tag=""
later_release_version=""
release_inventory_fingerprint=""
remote_ref_fingerprint() {
  local snapshot
  snapshot="$(target_git ls-remote "$target_url" \
    "refs/heads/$TARGET_BRANCH" "refs/tags/*")" || return 1
  [[ -n "$snapshot" ]] || return 1
  printf '%s\n' "$snapshot" | LC_ALL=C sort | shasum -a 256 | awk '{print $1}'
}

audit_release_inventory() {
  local expected_fingerprint="${1:-}"
  local inventory_file inventory_snapshot entry tag duplicate_tags
  if [[ -n "$test_release_dir" ]]; then
    if [[ ! -e "$test_release_dir" ]]; then
      release_inventory_fingerprint="$(printf '<absent>\n' | shasum -a 256 | awk '{print $1}')"
      [[ -z "$expected_fingerprint" || "$release_inventory_fingerprint" == "$expected_fingerprint" ]] || {
        fail_reconcile inconclusive remote-state-changed \
          "the complete GitHub Release inventory changed during reconcile"
      }
      return
    fi
    [[ -d "$test_release_dir" ]] || {
      fail_reconcile blocked_conflict malformed-release-history \
        "test Release inventory is not a directory"
    }
    release_inventory_fingerprint="$(
      find "$test_release_dir" -type f -exec shasum -a 256 {} \; | LC_ALL=C sort |
        shasum -a 256 | awk '{print $1}'
    )"
    [[ -z "$expected_fingerprint" || "$release_inventory_fingerprint" == "$expected_fingerprint" ]] || {
      fail_reconcile inconclusive remote-state-changed \
        "the complete GitHub Release inventory changed during reconcile"
    }
    while IFS= read -r -d '' entry; do
      tag="${entry##*/}"
      if is_v2_plus_major_alias "$tag"; then
        fail_reconcile blocked_conflict floating-alias-release \
          "Release state $tag targets a floating major alias instead of an immutable full-version tag"
      fi
      is_v2_plus_full_tag "$tag" || continue
      git -C "$stage_repo" show-ref --verify --quiet "refs/tags/$tag" || {
        fail_reconcile blocked_conflict release-without-full-tag \
          "Release state $tag exists without its immutable full-version tag"
      }
    done < <(find "$test_release_dir" -mindepth 1 -maxdepth 1 -print0)
    return
  fi

  inventory_file="$temporary_root/github-releases.json"
  if ! publisher_gh api --paginate --slurp \
      "repos/$TARGET_REPOSITORY/releases?per_page=100" > "$inventory_file"; then
    fail_reconcile inconclusive remote-read-inconclusive \
      "the complete paginated GitHub Release inventory could not be read"
  fi
  jq -e '
    type == "array" and
    all(.[]; type == "array") and
    (flatten | all(.[]; type == "object" and (.id | type == "number") and (.tag_name | type == "string")))
  ' "$inventory_file" >/dev/null || {
    fail_reconcile inconclusive remote-read-inconclusive \
      "the paginated GitHub Release inventory is malformed or incomplete"
  }
  if ! inventory_snapshot="$(
    node "$generator" snapshot-release-inventory --input "$inventory_file"
  )"; then
    fail_reconcile inconclusive remote-read-inconclusive \
      "the paginated GitHub Release inventory could not be normalized"
  fi
  release_inventory_fingerprint="$(
    printf '%s\n' "$inventory_snapshot" | shasum -a 256 | awk '{print $1}'
  )"
  [[ -z "$expected_fingerprint" || "$release_inventory_fingerprint" == "$expected_fingerprint" ]] || {
    fail_reconcile inconclusive remote-state-changed \
      "the complete GitHub Release inventory changed during reconcile"
  }
  duplicate_tags="$(jq -r '
    flatten |
    sort_by(.tag_name) |
    group_by(.tag_name)[] |
    select(length != 1) |
    .[0].tag_name
  ' "$inventory_file")"
  while IFS= read -r tag; do
    [[ -n "$tag" ]] || continue
    is_v2_plus_full_tag "$tag" || continue
    fail_reconcile blocked_conflict duplicate-release-tag \
      "multiple GitHub Releases claim immutable tag $tag"
  done <<< "$duplicate_tags"
  while IFS= read -r -d '' tag; do
    if is_v2_plus_major_alias "$tag"; then
      fail_reconcile blocked_conflict floating-alias-release \
        "GitHub Release $tag targets a floating major alias instead of an immutable full-version tag"
    fi
    is_v2_plus_full_tag "$tag" || continue
    git -C "$stage_repo" show-ref --verify --quiet "refs/tags/$tag" || {
      fail_reconcile blocked_conflict release-without-full-tag \
        "GitHub Release $tag exists without its immutable full-version tag"
    }
  done < <(jq -j 'flatten[] | .tag_name, "\u0000"' "$inventory_file")
}

audit_release_history() {
  local tag version comparison commit major
  while IFS= read -r tag; do
    is_v2_plus_full_tag "$tag" || continue
    [[ "$tag" != "$immutable_tag" ]] || continue
    version="${tag#v}"
    comparison="$(node "$generator" compare-semver --left "$version" --right "$release_version")"
    validate_superseding_release "$tag" || {
      fail_reconcile blocked_conflict malformed-release-history \
        "release-history tag $tag is not a valid signed release wrapper"
    }
    commit="$(git -C "$stage_repo" rev-parse "refs/tags/$tag^{}")"
    git -C "$stage_repo" merge-base --is-ancestor "$commit" "$target_master" || {
      fail_reconcile blocked_conflict out-of-order-release-prefix \
        "release-history tag $tag is not contained in target master"
    }
    if [[ "$comparison" == "-1" ]]; then
      require_completed_release_state "$tag" older-partial-release \
        "older release $tag is not a complete immutable Release"
      continue
    fi
    require_completed_release_state "$tag" incomplete-superseding-release \
      "later release $tag is not a complete immutable Release"
    if [[ -z "$later_release_version" ||
          "$(node "$generator" compare-semver --left "$version" --right "$later_release_version")" == "1" ]]; then
      later_release_tag="$tag"
      later_release_version="$version"
    fi
    major="${version%%.*}"
    if [[ "$version" != *-* && "$major" == "${release_version%%.*}" ]]; then
      if [[ -z "$later_same_major_stable_version" ||
            "$(node "$generator" compare-semver --left "$version" --right "$later_same_major_stable_version")" == "1" ]]; then
        later_same_major_stable_tag="$tag"
        later_same_major_stable_version="$version"
      fi
    fi
  done < <(git -C "$stage_repo" tag --list 'v*')
}

initial_remote_ref_fingerprint="$(remote_ref_fingerprint)" || {
  fail_reconcile inconclusive remote-read-inconclusive \
    "the initial complete target ref namespace could not be fingerprinted"
}
audit_release_inventory
initial_release_inventory_fingerprint="$release_inventory_fingerprint"
audit_release_history

# A stable replay may be superseded only while its floating alias names the
# highest completed stable release in the same major. Checking this before the
# no-tag superseded exit prevents an older exact-source retry from accepting a
# rolled-back alias merely because some later release is complete.
if [[ -n "$major_alias" && -n "$later_same_major_stable_tag" ]]; then
  # audit_release_history already proved that this exact later full tag is a
  # complete, stable, same-major release. Keep alias shape/signature failures
  # distinct from the operational missing/rolled-back-alias recovery state.
  highest_stable_commit="$(direct_annotated_tag_commit \
    "$later_same_major_stable_tag" \
    "Release codex-review-gate-action $later_same_major_stable_tag")" || {
    fail_reconcile blocked_conflict malformed-release-history \
      "highest complete stable release $later_same_major_stable_tag is not an exact annotated tag directly targeting a commit"
  }
  if [[ "$skip_signatures" != true ]]; then
    verify_exact_signature tag "$later_same_major_stable_tag" || {
      fail_reconcile blocked_conflict malformed-release-history \
        "highest complete stable release $later_same_major_stable_tag has an invalid tag signature"
    }
  fi
  git -C "$stage_repo" show-ref --verify --quiet "refs/tags/$major_alias" || {
    fail_reconcile blocked_conflict older-partial-release \
      "floating alias $major_alias is missing behind highest complete stable release $later_same_major_stable_tag; reconcile that later release"
  }
  current_alias_commit="$(direct_annotated_tag_commit "$major_alias" "Codex Review Gate Action $major_alias")" || {
    fail_reconcile blocked_conflict malformed-major-alias-target \
      "floating alias $major_alias is not an annotated tag that directly targets a commit"
  }
  if [[ "$skip_signatures" != true ]]; then
    verify_exact_signature tag "$major_alias" || {
      fail_reconcile blocked_conflict malformed-major-alias-target \
        "floating alias $major_alias has an invalid tag signature"
    }
  fi
  [[ "$current_alias_commit" == "$highest_stable_commit" ]] || {
    fail_reconcile blocked_conflict older-partial-release \
      "floating alias $major_alias does not point at highest complete stable release $later_same_major_stable_tag; reconcile that later release instead of rolling the alias back"
  }
fi

full_exists=false
if git -C "$stage_repo" show-ref --verify --quiet "refs/tags/$immutable_tag"; then
  full_exists=true
  release_commit="$(direct_annotated_tag_commit "$immutable_tag" "$release_subject")" || {
    echo "error: immutable release ref must be an annotated tag that directly targets a commit" >&2
    exit 1
  }
  [[ "$(git -C "$stage_repo" for-each-ref --format='%(contents:subject)' "refs/tags/$immutable_tag")" == "$release_subject" ]] || {
    echo "error: immutable tag message conflicts with release policy" >&2
    exit 1
  }
  validate_release_commit "$release_commit" || { echo "error: immutable tag conflicts with release intent" >&2; exit 1; }
  if [[ "$skip_signatures" != true ]]; then
    verify_exact_signature tag "$immutable_tag" || { echo "error: immutable tag signature is invalid" >&2; exit 1; }
  fi
  git -C "$stage_repo" merge-base --is-ancestor "$release_commit" "$target_master" || {
    fail_reconcile blocked_conflict out-of-order-release-prefix \
      "immutable tag exists before target master contains its release commit"
  }
  if [[ "$target_master" != "$release_commit" && -z "$later_release_tag" ]]; then
    fail_reconcile blocked_conflict target-head-conflict \
      "target master advanced beyond this immutable tag without a verified later release"
  fi
  if [[ "$preflight_write_eligible" != "true" &&
        "$preflight_recovery_code" == "release-intent-superseded" ]]; then
    stale_completion_authorized=true
  fi
else
  release_commit=""
  if validate_release_commit "$target_master"; then
    release_commit="$target_master"
    if [[ "$preflight_write_eligible" != "true" &&
          "$preflight_recovery_code" == "release-intent-superseded" ]]; then
      stale_completion_authorized=true
    fi
  else
    if [[ "$target_master" != "$planned_master" ]]; then
      superseded=false
      while IFS= read -r existing_tag; do
        is_v2_plus_full_tag "$existing_tag" || continue
        existing_version="${existing_tag#v}"
        if [[ -n "$major_alias" && "$existing_version" == *-* ]]; then
          continue
        fi
        existing_commit="$(git -C "$stage_repo" rev-parse "refs/tags/$existing_tag^{}")"
        git -C "$stage_repo" merge-base --is-ancestor "$existing_commit" "$target_master" || continue
        if [[ "$(node "$generator" compare-semver --left "$existing_version" --right "$release_version")" == "1" ]]; then
          validate_superseding_release "$existing_tag" || {
            emit_recovery_code malformed-superseding-release "later tag $existing_tag is not a verified release wrapper"
            exit 1
          }
          validate_completed_stable_alias "$existing_tag" || {
            emit_reconcile_state blocked_conflict stderr
            emit_recovery_code older-partial-release "later stable tag $existing_tag has no complete forward alias"
            exit 1
          }
          superseded=true
          break
        fi
      done < <(git -C "$stage_repo" tag --list 'v*')
      if [[ "$superseded" == true ]]; then
        verify_final_policy_fence success-superseded
        emit_reconcile_state superseded
        echo "release_status=superseded; target history already contains a later immutable release"
        exit 0
      fi
      emit_recovery_code target-head-conflict "target advanced without this release or a later immutable release"
      exit 1
    fi
    previous_commit="$(git -C "$stage_repo" rev-parse "refs/tags/v${previous_version}^{}" 2>/dev/null || true)"
    [[ "$previous_commit" == "$planned_master" ]] || {
      echo "error: target.previous_version does not peel to expected_target_head" >&2
      exit 1
    }
    previous_major="${previous_version%%.*}"
    if is_v2_plus_major "$previous_major"; then
      validate_superseding_release "v${previous_version}" || {
        emit_reconcile_state blocked_conflict stderr
        emit_recovery_code older-partial-release "previous full version is not a valid signed release wrapper"
        exit 1
      }
      if [[ "$previous_version" != *-* ]]; then
        previous_alias="v${previous_major}"
        validate_completed_stable_alias "v${previous_version}" || {
          emit_reconcile_state blocked_conflict stderr
          emit_recovery_code older-partial-release "previous stable floating alias is malformed or does not directly target a complete stable release"
          exit 1
        }
        previous_alias_commit="$(direct_annotated_tag_commit "$previous_alias" "Codex Review Gate Action $previous_alias")" || true
        [[ "$previous_alias_commit" == "$planned_master" ]] || {
          emit_reconcile_state blocked_conflict stderr
          emit_recovery_code older-partial-release "previous stable floating alias is incomplete"
          exit 1
        }
      fi
    fi
    message_file="$temporary_root/commit-message"
    printf '%s\n' "$release_body" > "$message_file"
    export GIT_AUTHOR_NAME="JoeyTeng-Codex" GIT_AUTHOR_EMAIL="codex@mahane.me"
    export GIT_COMMITTER_NAME="JoeyTeng-Codex" GIT_COMMITTER_EMAIL="codex@mahane.me"
    if [[ "$skip_signatures" == true ]]; then
      release_commit="$(git -C "$stage_repo" commit-tree "$candidate_tree" -p "$target_master" < "$message_file")"
    else
      release_commit="$(git -C "$stage_repo" commit-tree "$candidate_tree" -p "$target_master" -S"${SIGNING_SUBKEY}!" < "$message_file")"
    fi
  fi
  if [[ "$skip_signatures" == true ]]; then
    git -C "$stage_repo" tag -a "$immutable_tag" "$release_commit" -m "$release_subject"
  else
    git -C "$stage_repo" tag -s -u "${SIGNING_SUBKEY}!" "$immutable_tag" "$release_commit" -m "$release_subject"
  fi
fi
if [[ "$skip_signatures" != true ]]; then
  validate_release_commit "$release_commit" || { echo "error: newly materialized release commit failed exact validation" >&2; exit 1; }
  verify_exact_signature tag "$immutable_tag" || { echo "error: newly materialized immutable tag failed exact validation" >&2; exit 1; }
fi
full_tag_object="$(git -C "$stage_repo" rev-parse "refs/tags/$immutable_tag")"

existing_assets_dir="$temporary_root/existing-release-assets"
mkdir -m 700 "$existing_assets_dir"
release_exists=false
release_complete=false
expected_release_assets="$(release_asset_inventory_for_tag "$immutable_tag")"
valid_release_asset_prefix() {
  local actual="$1"
  local archive="codex-review-gate-action-${immutable_tag}.tar.gz"
  [[ -z "$actual" ||
      "$actual" == "$archive" ||
      "$actual" == "$archive"$'\n'"release-provenance.json" ||
      "$actual" == "$expected_release_assets" ]]
}
if [[ -n "$test_release_dir" ]]; then
  release_path="$test_release_dir/$immutable_tag"
  if [[ -e "$release_path" ]]; then
    [[ -d "$release_path" ]] || {
      emit_reconcile_state blocked_conflict stderr
      echo "error: release state path is not a directory" >&2
      exit 1
    }
    release_exists=true
    [[ "$full_exists" == true ]] || {
      emit_reconcile_state blocked_conflict stderr
      emit_recovery_code release-before-tag "Release state exists before the immutable tag"
      exit 1
    }
    [[ -f "$release_path/prerelease" && "$(cat "$release_path/prerelease")" == "$prerelease" ]] || {
      emit_reconcile_state blocked_conflict stderr
      echo "error: existing test Release prerelease state conflicts" >&2
      exit 1
    }
    existing_asset_names="$(find "$release_path" -mindepth 1 -maxdepth 1 -type f \
      ! -name prerelease ! -name published ! -name immutable -exec basename {} \; | LC_ALL=C sort)"
    valid_release_asset_prefix "$existing_asset_names" || {
      emit_reconcile_state blocked_conflict stderr
      echo "error: existing test Release assets are not a canonical prefix" >&2
      exit 1
    }
    while IFS= read -r asset_name; do
      [[ -z "$asset_name" ]] && continue
      cp "$release_path/$asset_name" "$existing_assets_dir/$asset_name"
    done <<< "$existing_asset_names"
    if [[ -f "$release_path/published" ]]; then
      [[ -f "$release_path/immutable" && "$existing_asset_names" == "$expected_release_assets" ]] || {
        emit_reconcile_state blocked_conflict stderr
        echo "error: published test Release is incomplete or mutable" >&2
        exit 1
      }
      release_complete=true
    else
      [[ ! -e "$release_path/immutable" ]] || {
        emit_reconcile_state blocked_conflict stderr
        echo "error: draft test Release cannot be immutable" >&2
        exit 1
      }
    fi
  fi
else
  current_release_api="$temporary_root/current-release-prewrite.json"
  current_release_error="$temporary_root/current-release-prewrite.err"
  if publisher_gh api "repos/$TARGET_REPOSITORY/releases/tags/$immutable_tag" > "$current_release_api" 2> "$current_release_error"; then
    release_exists=true
  elif grep -Fq "HTTP 404" "$current_release_error"; then
    release_exists=false
  else
    cat "$current_release_error" >&2
    emit_reconcile_state inconclusive stderr
    emit_recovery_code remote-read-inconclusive "GitHub Release state could not be read"
    exit 1
  fi
  if [[ "$release_exists" == true ]]; then
    [[ "$full_exists" == true ]] || {
      emit_reconcile_state blocked_conflict stderr
      emit_recovery_code release-before-tag "GitHub Release exists before the immutable tag"
      exit 1
    }
    [[ "$(jq -r .tag_name "$current_release_api")" == "$immutable_tag" &&
        "$(jq -r .name "$current_release_api")" == "$immutable_tag" &&
        "$(jq -r .body "$current_release_api")" == "Signed release of $SOURCE_REPOSITORY@$source_commit." &&
        "$(jq -r .prerelease "$current_release_api")" == "$prerelease" &&
        "$(jq -r .author.login "$current_release_api")" == "codex-review-gate-action-publisher[bot]" ]] || {
      emit_reconcile_state blocked_conflict stderr
      echo "error: existing GitHub Release metadata or author conflicts" >&2
      exit 1
    }
    existing_asset_snapshot="$(node "$generator" snapshot-release-assets --input "$current_release_api")"
    existing_asset_names="$(printf '%s' "$existing_asset_snapshot" | jq -r '.[].name' | LC_ALL=C sort)"
    valid_release_asset_prefix "$existing_asset_names" || {
      emit_reconcile_state blocked_conflict stderr
      echo "error: existing GitHub Release assets are not a canonical prefix" >&2
      exit 1
    }
    while IFS= read -r asset_name; do
      [[ -z "$asset_name" ]] && continue
      publisher_gh release download "$immutable_tag" --repo "$TARGET_REPOSITORY" --pattern "$asset_name" --dir "$existing_assets_dir"
    done <<< "$existing_asset_names"
    if [[ "$(jq -r .draft "$current_release_api")" == "false" ]]; then
      [[ "$(jq -r .immutable "$current_release_api")" == "true" && "$existing_asset_names" == "$expected_release_assets" ]] || {
        emit_reconcile_state blocked_conflict stderr
        echo "error: published GitHub Release is incomplete or mutable" >&2
        exit 1
      }
      release_complete=true
    else
      [[ "$(jq -r .immutable "$current_release_api")" == "false" ]] || {
        emit_reconcile_state blocked_conflict stderr
        echo "error: draft GitHub Release unexpectedly reports immutable" >&2
        exit 1
      }
    fi
  fi
fi
if [[ -f "$existing_assets_dir/codex-review-gate-action-${immutable_tag}.tar.gz" ]]; then
  cmp "$candidate/$(json_field "$candidate/candidate.json" archive.name)" \
    "$existing_assets_dir/codex-review-gate-action-${immutable_tag}.tar.gz" || {
    emit_reconcile_state blocked_conflict stderr
    echo "error: existing Release archive conflicts with the exact candidate" >&2
    exit 1
  }
fi

if [[ "$full_exists" != true ]]; then
  [[ "$release_exists" != true ]] || {
    emit_reconcile_state blocked_conflict stderr
    emit_recovery_code release-before-tag "Release state exists before the immutable tag"
    exit 1
  }
fi

# Freeze and validate the complete floating-alias transition before the first
# durable write. The signed alias object itself is intentionally not part of
# immutable provenance because a crash after Release publication must remain
# recoverable on a later run.
alias_needs_push=false
alias_before="none"
planned_alias_object="none"
planned_alias_commit="none"
alias_mode="not-applicable"
if [[ -n "$major_alias" ]]; then
  if git -C "$stage_repo" show-ref --verify --quiet "refs/tags/$major_alias"; then
    old_alias_commit="$(direct_annotated_tag_commit "$major_alias" "Codex Review Gate Action $major_alias")" || {
      emit_reconcile_state blocked_conflict stderr
      echo "error: major alias must be an annotated tag that directly targets a commit" >&2
      exit 1
    }
    [[ "$(git -C "$stage_repo" for-each-ref --format='%(contents:subject)' "refs/tags/$major_alias")" == "Codex Review Gate Action $major_alias" ]] || {
      emit_reconcile_state blocked_conflict stderr
      echo "error: major alias message conflicts with release policy" >&2
      exit 1
    }
    alias_before="$(git -C "$stage_repo" rev-parse "refs/tags/$major_alias")"
    if [[ "$skip_signatures" != true ]]; then
      verify_exact_signature tag "$major_alias" || {
        emit_reconcile_state blocked_conflict stderr
        echo "error: existing major alias signature is invalid" >&2
        exit 1
      }
    fi
    if [[ "$old_alias_commit" == "$release_commit" ]]; then
      planned_alias_object="$alias_before"
      planned_alias_commit="$release_commit"
      alias_mode="already-current"
    elif git -C "$stage_repo" merge-base --is-ancestor "$release_commit" "$old_alias_commit"; then
      verified_later_alias_release=false
      verified_later_alias_tag=""
      while IFS= read -r alias_target_tag; do
        is_v2_plus_full_tag "$alias_target_tag" || continue
        alias_target_version="${alias_target_tag#v}"
        [[ "$alias_target_version" != *-* ]] || continue
        [[ "${alias_target_version%%.*}" == "${release_version%%.*}" ]] || continue
        [[ "$(node "$generator" compare-semver --left "$alias_target_version" --right "$release_version")" == "1" ]] || continue
        validate_superseding_release "$alias_target_tag" || continue
        [[ "$(direct_annotated_tag_commit "$alias_target_tag" "Release codex-review-gate-action $alias_target_tag")" == "$old_alias_commit" ]] || continue
        verified_later_alias_release=true
        verified_later_alias_tag="$alias_target_tag"
        break
      done < <(git -C "$stage_repo" tag --points-at "$old_alias_commit" --list 'v*')
      [[ "$verified_later_alias_release" == true ]] || {
        emit_reconcile_state blocked_conflict stderr
        emit_recovery_code malformed-major-alias-target "forward alias target is not a verified later complete release"
        exit 1
      }
      require_completed_release_state "$verified_later_alias_tag" incomplete-superseding-release \
        "floating alias $major_alias targets later tag $verified_later_alias_tag without a complete immutable Release"
      planned_alias_object="$alias_before"
      planned_alias_commit="$old_alias_commit"
      alias_mode="superseded"
    else
      git -C "$stage_repo" merge-base --is-ancestor "$old_alias_commit" "$release_commit" || {
        emit_reconcile_state blocked_conflict stderr
        echo "error: major alias movement is not forward-only" >&2
        exit 1
      }
      git -C "$stage_repo" tag -d "$major_alias" >/dev/null
      alias_mode="force-with-lease"
      alias_needs_push=true
    fi
  else
    alias_mode="create"
    alias_needs_push=true
  fi
  if [[ "$alias_needs_push" == true ]]; then
    if [[ "$skip_signatures" == true ]]; then
      git -C "$stage_repo" tag -a "$major_alias" "$release_commit" -m "Codex Review Gate Action $major_alias"
    else
      git -C "$stage_repo" tag -s -u "${SIGNING_SUBKEY}!" "$major_alias" "$release_commit" -m "Codex Review Gate Action $major_alias"
    fi
    planned_alias_object="$(git -C "$stage_repo" rev-parse "refs/tags/$major_alias")"
    planned_alias_commit="$release_commit"
    [[ "$(direct_annotated_tag_commit "$major_alias" "Codex Review Gate Action $major_alias")" == "$release_commit" ]] || {
      fail_reconcile blocked_conflict malformed-major-alias-target \
        "new floating alias is not an exact annotated tag directly targeting the release commit"
    }
    if [[ "$skip_signatures" != true ]]; then
      verify_exact_signature tag "$major_alias" || {
        fail_reconcile blocked_conflict malformed-major-alias-target \
          "new floating alias signature is invalid"
      }
    fi
  fi
fi

if [[ "$alias_mode" == "already-current" && "$release_complete" != true ]]; then
  fail_reconcile blocked_conflict out-of-order-release-prefix \
    "floating alias already points at this release before its immutable GitHub Release is complete"
elif [[ "$alias_mode" == "superseded" ]]; then
  if [[ "$release_complete" != true ]]; then
    emit_reconcile_state blocked_conflict stderr
    emit_recovery_code older-partial-release "a later alias exists while this release is incomplete"
    exit 1
  fi
  reconcile_state="superseded"
elif [[ "$release_complete" == true && "$alias_needs_push" == true ]]; then
  reconcile_state="resumable_partial"
elif [[ "$release_complete" == true ]]; then
  reconcile_state="already_complete"
elif [[ "$preflight_write_eligible" != "true" && "$stale_completion_authorized" != "true" ]]; then
  reconcile_state="superseded"
elif [[ "$target_master" == "$planned_master" && "$full_exists" != true && "$release_exists" != true ]]; then
  reconcile_state="fresh"
else
  reconcile_state="resumable_partial"
fi

# Materialize the exact Release asset set before any durable target mutation.
# A valid existing provenance prefix is authoritative for its original workflow
# run identity, so retries adopt those bytes instead of regenerating provenance
# with the current run ID/attempt.
assets_dir="$temporary_root/assets"
workflow_ref="${GITHUB_WORKFLOW_REF:-$SOURCE_REPOSITORY/.github/workflows/sync-action-subtree.yml@refs/heads/master}"
workflow_run_id="${GITHUB_RUN_ID:-1}"
workflow_run_attempt="${GITHUB_RUN_ATTEMPT:-1}"
existing_provenance="$existing_assets_dir/release-provenance.json"
existing_provenance_signature="$existing_assets_dir/release-provenance.json.asc"
if [[ -f "$existing_provenance" ]]; then
  mkdir -m 700 "$assets_dir"
  cp "$candidate/$(json_field "$candidate/candidate.json" archive.name)" \
    "$assets_dir/codex-review-gate-action-${immutable_tag}.tar.gz"
  cp "$existing_provenance" "$assets_dir/release-provenance.json"
  if [[ -f "$existing_provenance_signature" ]]; then
    cp "$existing_provenance_signature" "$assets_dir/release-provenance.json.asc"
  elif [[ "$skip_signatures" == true ]]; then
    printf 'test-only detached signature\n' > "$assets_dir/release-provenance.json.asc"
  else
    source_timestamp="$(git show -s --format=%ct "$source_commit")"
    gpg --batch --yes --armor --detach-sign \
      --faked-system-time "$source_timestamp" \
      --local-user "${SIGNING_SUBKEY}!" \
      --output "$assets_dir/release-provenance.json.asc" \
      "$assets_dir/release-provenance.json"
  fi
else
  node "$generator" finalize \
    --candidate "$candidate" \
    --release-commit "$release_commit" \
    --full-tag-object "$full_tag_object" \
    --release-parent "$planned_master" \
    --alias-name "${major_alias:-none}" \
    --alias-before "$alias_before" \
    --alias-mode "$alias_mode" \
    --workflow-ref "$workflow_ref" \
    --workflow-run-id "$workflow_run_id" \
    --workflow-run-attempt "$workflow_run_attempt" \
    --output-dir "$assets_dir"
  if [[ "$skip_signatures" == true ]]; then
    printf 'test-only detached signature\n' > "$assets_dir/release-provenance.json.asc"
  else
    source_timestamp="$(git show -s --format=%ct "$source_commit")"
    gpg --batch --yes --armor --detach-sign \
      --faked-system-time "$source_timestamp" \
      --local-user "${SIGNING_SUBKEY}!" \
      --output "$assets_dir/release-provenance.json.asc" \
      "$assets_dir/release-provenance.json"
  fi
fi
if ! node "$generator" verify-published-assets \
    --repo "$repo_root" \
    --target-repo "$stage_repo" \
    --source-ref "$source_commit" \
    --asset-dir "$assets_dir" \
    --release-commit "$release_commit" \
    --full-tag-object "$full_tag_object"; then
  emit_reconcile_state blocked_conflict stderr
  echo "error: existing Release provenance conflicts with the exact source or release objects" >&2
  exit 1
fi
if [[ "$skip_signatures" != true ]]; then
  provenance_status="$temporary_root/release-provenance.gpg-status"
  gpg --batch --status-fd=1 --verify \
    "$assets_dir/release-provenance.json.asc" \
    "$assets_dir/release-provenance.json" > "$provenance_status" 2>/dev/null || {
    emit_reconcile_state blocked_conflict stderr
    echo "error: existing release provenance detached signature is invalid" >&2
    exit 1
  }
  node "$generator" verify-openpgp-status \
    --input "$provenance_status" \
    --name "existing release provenance" || {
    emit_reconcile_state blocked_conflict stderr
    echo "error: existing release provenance signature identity differs from policy" >&2
    exit 1
  }
fi

# Take a second complete target snapshot immediately before the first durable
# mutation. Any concurrent change is recoverable by a fresh reconcile, so this
# run stays fail-closed and performs no write.
if ! live_source_before_write="$(source_live_master)"; then
  emit_reconcile_state inconclusive stderr
  emit_recovery_code remote-read-inconclusive "live source master could not be revalidated"
  exit 1
fi
[[ "$live_source_before_write" == "$live_source_at_publish" ]] || {
  emit_reconcile_state inconclusive stderr
  emit_recovery_code source-state-changed "live source master changed during reconcile; rematerialize and approve again"
  exit 1
}

# Re-enumerate the complete remote history in an independent credential-free
# audit clone immediately before the first durable write. The initial and final
# canonical ref/Release fingerprints must match, and the full inventory/history
# checks run again against only remotely published objects. This prevents a
# concurrent orphan Release, partial historical release, added/deleted tag, or
# rewritten ref from being hidden by the current-version point reads below.
prewrite_ref_fingerprint_before="$(remote_ref_fingerprint)" || {
  fail_reconcile inconclusive remote-read-inconclusive \
    "the complete target ref namespace could not be re-read before publication"
}
[[ "$prewrite_ref_fingerprint_before" == "$initial_remote_ref_fingerprint" ]] || {
  fail_reconcile inconclusive remote-state-changed \
    "the complete target ref namespace changed during reconcile"
}
prewrite_audit_repo="$temporary_root/prewrite-target-audit"
target_git clone --quiet --no-tags "$target_url" "$prewrite_audit_repo" || {
  fail_reconcile inconclusive remote-read-inconclusive \
    "the target history could not be cloned for the final full reconcile"
}
target_git -C "$prewrite_audit_repo" fetch --quiet --force --no-write-fetch-head \
  "$target_url" '+refs/tags/*:refs/tags/*' || {
  fail_reconcile inconclusive remote-read-inconclusive \
    "the complete remote tag namespace could not be fetched for the final full reconcile"
}
prewrite_ref_fingerprint_cloned="$(remote_ref_fingerprint)" || {
  fail_reconcile inconclusive remote-read-inconclusive \
    "the complete target ref namespace could not be confirmed before the final history audit"
}
[[ "$prewrite_ref_fingerprint_cloned" == "$initial_remote_ref_fingerprint" ]] || {
  fail_reconcile inconclusive remote-state-changed \
    "the complete target ref namespace changed before the final history audit"
}
saved_stage_repo="$stage_repo"
saved_target_master="$target_master"
saved_later_release_tag="$later_release_tag"
saved_later_release_version="$later_release_version"
saved_later_same_major_stable_tag="$later_same_major_stable_tag"
saved_later_same_major_stable_version="$later_same_major_stable_version"
stage_repo="$prewrite_audit_repo"
target_master="$(target_git -C "$prewrite_audit_repo" rev-parse "origin/$TARGET_BRANCH")"
later_release_tag=""
later_release_version=""
later_same_major_stable_tag=""
later_same_major_stable_version=""
audit_release_inventory "$initial_release_inventory_fingerprint"
prewrite_release_inventory_fingerprint="$release_inventory_fingerprint"
audit_release_history
[[ "$later_release_tag" == "$saved_later_release_tag" &&
    "$later_release_version" == "$saved_later_release_version" &&
    "$later_same_major_stable_tag" == "$saved_later_same_major_stable_tag" &&
    "$later_same_major_stable_version" == "$saved_later_same_major_stable_version" ]] || {
  fail_reconcile inconclusive remote-state-changed \
    "the verified release history changed during reconcile"
}
audit_release_inventory "$initial_release_inventory_fingerprint"
prewrite_release_inventory_fingerprint_after="$release_inventory_fingerprint"
prewrite_ref_fingerprint_after="$(remote_ref_fingerprint)" || {
  fail_reconcile inconclusive remote-read-inconclusive \
    "the complete target ref namespace could not be confirmed after the final full reconcile"
}
stage_repo="$saved_stage_repo"
target_master="$saved_target_master"
later_release_tag="$saved_later_release_tag"
later_release_version="$saved_later_release_version"
later_same_major_stable_tag="$saved_later_same_major_stable_tag"
later_same_major_stable_version="$saved_later_same_major_stable_version"
[[ "$initial_remote_ref_fingerprint" == "$prewrite_ref_fingerprint_before" &&
    "$prewrite_ref_fingerprint_before" == "$prewrite_ref_fingerprint_cloned" &&
    "$prewrite_ref_fingerprint_cloned" == "$prewrite_ref_fingerprint_after" &&
    "$initial_release_inventory_fingerprint" == "$prewrite_release_inventory_fingerprint" &&
    "$prewrite_release_inventory_fingerprint" == "$prewrite_release_inventory_fingerprint_after" ]] || {
  fail_reconcile inconclusive remote-state-changed \
    "the complete target ref or GitHub Release inventory changed during reconcile"
}

verify_live_release_signer_policy final-prewrite
if ! is_test_environment; then
  stable_release_api="$temporary_root/current-release-final-prewrite.json"
  stable_release_error="$temporary_root/current-release-final-prewrite.err"
  if [[ "$release_exists" == true ]]; then
    if ! publisher_gh api "repos/$TARGET_REPOSITORY/releases/tags/$immutable_tag" > "$stable_release_api" 2> "$stable_release_error"; then
      cat "$stable_release_error" >&2
      emit_reconcile_state inconclusive stderr
      emit_recovery_code remote-read-inconclusive "GitHub Release changed or became unreadable before the write phase"
      exit 1
    fi
    initial_release_identity="$(jq -Sc '{tag_name,name,body,prerelease,draft,immutable,author_login:.author.login}' "$current_release_api")"
    stable_release_identity="$(jq -Sc '{tag_name,name,body,prerelease,draft,immutable,author_login:.author.login}' "$stable_release_api")"
    stable_asset_snapshot="$(node "$generator" snapshot-release-assets --input "$stable_release_api")"
    [[ "$stable_release_identity" == "$initial_release_identity" && "$stable_asset_snapshot" == "$existing_asset_snapshot" ]] || {
      emit_reconcile_state inconclusive stderr
      emit_recovery_code remote-state-changed "GitHub Release metadata or asset identity changed during reconcile"
      exit 1
    }
  elif publisher_gh api "repos/$TARGET_REPOSITORY/releases/tags/$immutable_tag" > "$stable_release_api" 2> "$stable_release_error"; then
    emit_reconcile_state inconclusive stderr
    emit_recovery_code remote-state-changed "GitHub Release appeared during reconcile"
    exit 1
  elif ! grep -Fq "HTTP 404" "$stable_release_error"; then
    cat "$stable_release_error" >&2
    emit_reconcile_state inconclusive stderr
    emit_recovery_code remote-read-inconclusive "GitHub Release absence could not be revalidated"
    exit 1
  fi
fi
if ! current_remote_master="$(remote_master)"; then
  emit_reconcile_state inconclusive stderr
  emit_recovery_code remote-read-inconclusive "target master could not be revalidated"
  exit 1
fi
[[ "$current_remote_master" == "$target_master" ]] || {
  emit_reconcile_state inconclusive stderr
  emit_recovery_code remote-state-changed "target master changed during reconcile"
  exit 1
}
if ! remote_full_pre="$(git ls-remote "$target_url" "refs/tags/$immutable_tag" | awk 'NR == 1 {print $1}')"; then
  emit_reconcile_state inconclusive stderr
  emit_recovery_code remote-read-inconclusive "immutable tag could not be revalidated"
  exit 1
fi
if [[ "$full_exists" == true ]]; then
  [[ "$remote_full_pre" == "$full_tag_object" ]] || {
    emit_reconcile_state inconclusive stderr
    emit_recovery_code remote-state-changed "immutable tag changed during reconcile"
    exit 1
  }
else
  [[ -z "$remote_full_pre" ]] || {
    emit_reconcile_state inconclusive stderr
    emit_recovery_code remote-state-changed "immutable tag appeared during reconcile"
    exit 1
  }
fi
if [[ -n "$major_alias" ]]; then
  if ! remote_alias_pre="$(git ls-remote "$target_url" "refs/tags/$major_alias" | awk 'NR == 1 {print $1}')"; then
    emit_reconcile_state inconclusive stderr
    emit_recovery_code remote-read-inconclusive "floating alias could not be revalidated"
    exit 1
  fi
  if [[ "$alias_before" == "none" ]]; then
    [[ -z "$remote_alias_pre" ]] || {
      emit_reconcile_state inconclusive stderr
      emit_recovery_code remote-state-changed "floating alias appeared during reconcile"
      exit 1
    }
  else
    [[ "$remote_alias_pre" == "$alias_before" ]] || {
      emit_reconcile_state inconclusive stderr
      emit_recovery_code remote-state-changed "floating alias changed during reconcile"
      exit 1
    }
  fi
fi
if [[ "$reconcile_state" == "superseded" ]]; then
  verify_final_policy_fence success-superseded
  emit_reconcile_state "$reconcile_state"
  echo "release_status=superseded; no durable target write is required or permitted"
  exit 0
fi
need_master=false
if [[ "$current_remote_master" != "$release_commit" ]]; then
  if git -C "$stage_repo" merge-base --is-ancestor "$current_remote_master" "$release_commit"; then
    need_master=true
  elif ! git -C "$stage_repo" merge-base --is-ancestor "$release_commit" "$current_remote_master"; then
    echo "error: release commit is not a forward target-master update" >&2
    exit 1
  fi
fi
if [[ "$need_master" == true ]]; then
  require_publication_mutation master
  target_git_push "$release_commit:refs/heads/$TARGET_BRANCH"
  post_master="$(remote_master)"
  [[ "$post_master" == "$release_commit" ]]
fi
if ! is_test_environment; then
  commit_verification="$(publisher_gh api "repos/$TARGET_REPOSITORY/commits/$release_commit" --jq '[.commit.verification.verified,.commit.verification.reason] | map(tostring) | join(" ")')"
  [[ "$commit_verification" == "true valid" ]] || { echo "error: GitHub did not verify the release commit signature" >&2; exit 1; }
fi
if [[ "$full_exists" != true ]]; then
  [[ "$(remote_master)" == "$release_commit" ]] || {
    echo "error: target master readback must succeed before immutable tag creation" >&2
    exit 1
  }
  require_publication_mutation immutable-tag
  target_git_push "refs/tags/$immutable_tag:refs/tags/$immutable_tag"
  remote_full_object="$(git ls-remote "$target_url" "refs/tags/$immutable_tag" | awk 'NR == 1 {print $1}')"
  remote_full_commit="$(git ls-remote "$target_url" "refs/tags/$immutable_tag^{}" | awk 'NR == 1 {print $1}')"
  [[ "$remote_full_object" == "$full_tag_object" && "$remote_full_commit" == "$release_commit" ]]
fi

if ! is_test_environment; then
  tag_verification="$(publisher_gh api "repos/$TARGET_REPOSITORY/git/tags/$full_tag_object" --jq '[.verification.verified,.verification.reason] | map(tostring) | join(" ")')"
  [[ "$tag_verification" == "true valid" ]] || { echo "error: GitHub did not verify the immutable tag signature" >&2; exit 1; }
fi

reconcile_test_release() {
  local release_path="$test_release_dir/$immutable_tag"
  local was_published=false
  local expected_asset_names actual_existing_names asset name
  local -a missing_assets=()
  [[ -f "$release_path/published" ]] && was_published=true
  if [[ ! -d "$release_path" ]]; then
    require_publication_mutation release-completion
    mkdir -p "$release_path"
  fi
  expected_asset_names="$(find "$assets_dir" -mindepth 1 -maxdepth 1 -type f -exec basename {} \; | LC_ALL=C sort)"
  actual_existing_names="$(find "$release_path" -mindepth 1 -maxdepth 1 -type f ! -name prerelease ! -name published ! -name immutable -exec basename {} \; | LC_ALL=C sort)"
  while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    grep -Fqx -- "$name" <<< "$expected_asset_names" || {
      echo "error: test Release has unexpected asset: $name" >&2
      return 1
    }
  done <<< "$actual_existing_names"
  if [[ -e "$release_path/prerelease" ]]; then
    [[ "$(cat "$release_path/prerelease")" == "$prerelease" ]] || { echo "error: test Release prerelease state conflicts" >&2; return 1; }
  fi
  for asset in "$assets_dir"/*; do
    name="${asset##*/}"
    if [[ -e "$release_path/$name" ]]; then
      cmp -- "$asset" "$release_path/$name" || { echo "error: existing release asset conflicts: $name" >&2; return 1; }
    else
      [[ "$was_published" != true ]] || { echo "error: published test Release is missing asset: $name" >&2; return 1; }
      missing_assets+=("$asset")
    fi
  done
  if [[ "${#missing_assets[@]}" -gt 0 ]]; then
    for asset in "${missing_assets[@]}"; do
      require_publication_mutation release-completion
      cp "$asset" "$release_path/${asset##*/}"
    done
  fi
  if [[ ! -e "$release_path/prerelease" ]]; then
    require_publication_mutation release-completion
    printf '%s\n' "$prerelease" > "$release_path/prerelease"
  fi
  if [[ ! -e "$release_path/published" ]]; then
    require_publication_mutation release-completion
    : > "$release_path/published"
  fi
  if [[ ! -e "$release_path/immutable" ]]; then
    require_publication_mutation release-completion
    : > "$release_path/immutable"
  fi
  expected_test_inventory="$(printf '%s\n' "codex-review-gate-action-${immutable_tag}.tar.gz" "release-provenance.json" "release-provenance.json.asc" "prerelease" "published" "immutable" | LC_ALL=C sort)"
  actual_test_inventory="$(find "$release_path" -mindepth 1 -maxdepth 1 -type f -exec basename {} \; | LC_ALL=C sort)"
  [[ "$actual_test_inventory" == "$expected_test_inventory" ]] || { echo "error: test Release asset inventory differs from policy" >&2; return 1; }
}

readonly RELEASE_BOUNDARY_REMOTE_UNREADABLE=75
readonly RELEASE_BOUNDARY_STATE_CHANGED=76
readonly RELEASE_BOUNDARY_POLICY_MISMATCH=77
release_boundary_counter=0
reconcile_github_release() {
  local state asset_names asset name download_dir expected_asset_names
  local latest_before latest_after view_error
  local final_release_api final_confirm_api final_release_identity final_confirm_identity
  local final_asset_snapshot final_confirm_snapshot final_download_dir final_provenance_status
  local post_publish_release_api publication_payload publication_response publication_error
  local release_id release_make_latest
  local current_boundary before_boundary after_boundary published_boundary
  local absent_boundary created_boundary
  local -a missing_assets=()
  expected_release_body="Signed release of $SOURCE_REPOSITORY@$source_commit."

  read_remote_full_tag_snapshot() {
    local lines
    if ! lines="$(target_git ls-remote "$target_url" \
        "refs/tags/$immutable_tag" "refs/tags/$immutable_tag^{}")"; then
      return "$RELEASE_BOUNDARY_REMOTE_UNREADABLE"
    fi
    printf '%s\n' "$lines" | sed '/^$/d' | LC_ALL=C sort
  }

  validate_remote_full_tag_snapshot() {
    local lines="$1"
    local line object ref direct="" peeled="" count=0
    while IFS= read -r line; do
      [[ -n "$line" ]] || continue
      count=$((count + 1))
      [[ "$line" == *$'\t'* ]] || {
        echo "error: immutable tag binding is missing or malformed at the Release boundary" >&2
        return "$RELEASE_BOUNDARY_POLICY_MISMATCH"
      }
      object="${line%%$'\t'*}"
      ref="${line#*$'\t'}"
      [[ "$ref" != *$'\t'* && "$object" =~ ^[0-9a-f]{40}$ ]] || {
        echo "error: immutable tag binding is missing or malformed at the Release boundary" >&2
        return "$RELEASE_BOUNDARY_POLICY_MISMATCH"
      }
      case "$ref" in
        "refs/tags/$immutable_tag")
          [[ -z "$direct" ]] || return "$RELEASE_BOUNDARY_POLICY_MISMATCH"
          direct="$object"
          ;;
        "refs/tags/$immutable_tag^{}")
          [[ -z "$peeled" ]] || return "$RELEASE_BOUNDARY_POLICY_MISMATCH"
          peeled="$object"
          ;;
        *)
          return "$RELEASE_BOUNDARY_POLICY_MISMATCH"
          ;;
      esac
    done <<< "$lines"
    [[ "$count" == "2" && -n "$direct" && -n "$peeled" ]] || {
      echo "error: immutable tag binding is missing or malformed at the Release boundary" >&2
      return "$RELEASE_BOUNDARY_POLICY_MISMATCH"
    }
    [[ "$direct" == "$full_tag_object" && "$peeled" == "$release_commit" ]] || {
      echo "error: immutable tag binding differs from the approved Release boundary" >&2
      return "$RELEASE_BOUNDARY_POLICY_MISMATCH"
    }
    printf '%s\t%s\n' "$direct" "$peeled"
  }

  capture_release_boundary() {
    local label="$1"
    local expected_draft="$2"
    local expected_immutable="$3"
    local first_api second_api first_error second_error
    local first_inventory_input second_inventory_input first_raw second_raw
    local first_tag_raw second_tag_raw boundary_snapshot validated_tag status
    release_boundary_counter=$((release_boundary_counter + 1))
    first_api="$temporary_root/release-boundary-${release_boundary_counter}-${label}-a.json"
    second_api="$temporary_root/release-boundary-${release_boundary_counter}-${label}-b.json"
    first_error="$temporary_root/release-boundary-${release_boundary_counter}-${label}-a.err"
    second_error="$temporary_root/release-boundary-${release_boundary_counter}-${label}-b.err"
    first_inventory_input="$temporary_root/release-boundary-${release_boundary_counter}-${label}-a-inventory.json"
    second_inventory_input="$temporary_root/release-boundary-${release_boundary_counter}-${label}-b-inventory.json"
    if ! publisher_gh api "repos/$TARGET_REPOSITORY/releases/tags/$immutable_tag" > "$first_api" 2> "$first_error"; then
      cat "$first_error" >&2
      return "$RELEASE_BOUNDARY_REMOTE_UNREADABLE"
    fi
    if first_tag_raw="$(read_remote_full_tag_snapshot)"; then
      :
    else
      status=$?
      return "$status"
    fi
    if ! publisher_gh api "repos/$TARGET_REPOSITORY/releases/tags/$immutable_tag" > "$second_api" 2> "$second_error"; then
      cat "$second_error" >&2
      return "$RELEASE_BOUNDARY_REMOTE_UNREADABLE"
    fi
    if second_tag_raw="$(read_remote_full_tag_snapshot)"; then
      :
    else
      status=$?
      return "$status"
    fi

    # Compare complete neutral Release and tag projections before applying the
    # expected publication policy. This preserves a first-valid/second-drift
    # observation as remote state change instead of misclassifying the newer
    # snapshot as a stable policy conflict.
    if ! jq -cS '[[.]]' "$first_api" > "$first_inventory_input" ||
        ! jq -cS '[[.]]' "$second_api" > "$second_inventory_input" ||
        ! first_raw="$(node "$generator" snapshot-release-inventory --input "$first_inventory_input")" ||
        ! second_raw="$(node "$generator" snapshot-release-inventory --input "$second_inventory_input")"; then
      echo "error: GitHub Release boundary response could not be parsed as a complete canonical snapshot" >&2
      return "$RELEASE_BOUNDARY_REMOTE_UNREADABLE"
    fi
    [[ "$first_raw" == "$second_raw" && "$first_tag_raw" == "$second_tag_raw" ]] || {
      return "$RELEASE_BOUNDARY_STATE_CHANGED"
    }

    if ! boundary_snapshot="$(node "$generator" snapshot-release-boundary \
        --input "$second_api" \
        --tag "$immutable_tag" \
        --body "$expected_release_body" \
        --prerelease "$prerelease" \
        --draft "$expected_draft" \
        --immutable "$expected_immutable")"; then
      return "$RELEASE_BOUNDARY_POLICY_MISMATCH"
    fi
    if validated_tag="$(validate_remote_full_tag_snapshot "$second_tag_raw")"; then
      :
    else
      status=$?
      return "$status"
    fi
    jq -cn \
      --argjson boundary "$boundary_snapshot" \
      --arg object "${validated_tag%%$'\t'*}" \
      --arg commit "${validated_tag#*$'\t'}" \
      '$boundary + {tag:{object:$object,commit:$commit}}'
  }

  fail_release_boundary_capture() {
    local status="$1"
    local context="$2"
    case "$status" in
      "$RELEASE_BOUNDARY_REMOTE_UNREADABLE")
        fail_reconcile inconclusive remote-read-inconclusive \
          "$context could not be read completely; reconcile the same exact source SHA"
        ;;
      "$RELEASE_BOUNDARY_STATE_CHANGED")
        fail_reconcile inconclusive remote-state-changed \
          "$context changed between two complete canonical remote snapshots; reconcile the same exact source SHA"
        ;;
      "$RELEASE_BOUNDARY_POLICY_MISMATCH")
        fail_reconcile blocked_conflict immutable-release-mismatch \
          "$context deterministically differs from the approved metadata, author, asset, or tag policy"
        ;;
      *)
        fail_reconcile inconclusive release-boundary-verification-failed \
          "$context could not be classified safely; inspect the verifier and reconcile the same exact source SHA"
        ;;
    esac
  }

  read_remote_release_presence() {
    local output_file="$1"
    local error_file="$2"
    if publisher_gh api \
        "repos/$TARGET_REPOSITORY/releases/tags/$immutable_tag" > "$output_file" 2> "$error_file"; then
      printf 'present\n'
      return 0
    fi
    if grep -Fq "HTTP 404" "$error_file"; then
      printf 'absent\n'
      return 0
    fi
    cat "$error_file" >&2
    return "$RELEASE_BOUNDARY_REMOTE_UNREADABLE"
  }

  capture_absent_release_boundary() {
    local label="$1"
    local first_api second_api first_error second_error
    local first_presence second_presence first_tag_raw second_tag_raw
    local validated_tag status
    release_boundary_counter=$((release_boundary_counter + 1))
    first_api="$temporary_root/release-boundary-${release_boundary_counter}-${label}-a.json"
    second_api="$temporary_root/release-boundary-${release_boundary_counter}-${label}-b.json"
    first_error="$temporary_root/release-boundary-${release_boundary_counter}-${label}-a.err"
    second_error="$temporary_root/release-boundary-${release_boundary_counter}-${label}-b.err"
    if first_presence="$(read_remote_release_presence "$first_api" "$first_error")"; then
      :
    else
      status=$?
      return "$status"
    fi
    if first_tag_raw="$(read_remote_full_tag_snapshot)"; then
      :
    else
      status=$?
      return "$status"
    fi
    if second_presence="$(read_remote_release_presence "$second_api" "$second_error")"; then
      :
    else
      status=$?
      return "$status"
    fi
    if second_tag_raw="$(read_remote_full_tag_snapshot)"; then
      :
    else
      status=$?
      return "$status"
    fi
    [[ "$first_presence" == "$second_presence" && "$first_tag_raw" == "$second_tag_raw" ]] || {
      return "$RELEASE_BOUNDARY_STATE_CHANGED"
    }
    [[ "$second_presence" == "absent" ]] || {
      echo "error: GitHub Release is stably present at its expected-absence boundary" >&2
      return "$RELEASE_BOUNDARY_STATE_CHANGED"
    }
    if validated_tag="$(validate_remote_full_tag_snapshot "$second_tag_raw")"; then
      :
    else
      status=$?
      return "$status"
    fi
    jq -cn \
      --arg object "${validated_tag%%$'\t'*}" \
      --arg commit "${validated_tag#*$'\t'}" \
      '{release:"absent",assets:[],tag:{object:$object,commit:$commit}}'
  }

  read_latest_release_tag() {
    local snapshot="$1"
    local error_file="$temporary_root/latest-release-$snapshot.err"
    local tag
    if tag="$(publisher_gh api "repos/$TARGET_REPOSITORY/releases/latest" --jq .tag_name 2> "$error_file")"; then
      [[ -n "$tag" && "$tag" != *$'\n'* ]] || {
        echo "error: latest GitHub Release tag is empty or malformed" >&2
        return 1
      }
      printf '%s\n' "$tag"
      return 0
    fi
    if grep -Fq "HTTP 404" "$error_file"; then
      printf '%s\n' '<none>'
      return 0
    fi
    cat "$error_file" >&2
    echo "error: latest GitHub Release state could not be read" >&2
    return 1
  }
  latest_before="$(read_latest_release_tag before)"
  current_boundary=""
  view_error="$temporary_root/release-view-reconcile.err"
  if state="$(publisher_gh release view "$immutable_tag" --repo "$TARGET_REPOSITORY" --json isDraft,isPrerelease,tagName,name,body 2> "$view_error")"; then
    [[ "$(printf '%s' "$state" | jq -r .tagName)" == "$immutable_tag" ]] || return 1
    [[ "$(printf '%s' "$state" | jq -r .isPrerelease)" == "$prerelease" ]] || {
      echo "error: existing GitHub Release prerelease state conflicts" >&2
      return 1
    }
    [[ "$(printf '%s' "$state" | jq -r .name)" == "$immutable_tag" && "$(printf '%s' "$state" | jq -r .body)" == "$expected_release_body" ]] || {
      echo "error: existing GitHub Release title/body conflicts" >&2
      return 1
    }
  else
    if [[ "$release_exists" == true || ! -s "$view_error" || ! "$(cat "$view_error")" =~ HTTP[[:space:]]404 ]]; then
      cat "$view_error" >&2
      emit_recovery_code remote-read-inconclusive "GitHub Release could not be read during reconcile"
      return 1
    fi
    absent_boundary="$(capture_absent_release_boundary pre-create)" || {
      fail_release_boundary_capture "$?" "absent GitHub Release draft-create boundary"
    }
    require_publication_mutation release-completion
    create_args=(release create "$immutable_tag" --repo "$TARGET_REPOSITORY" --verify-tag --draft --title "$immutable_tag" --notes "$expected_release_body")
    [[ "$prerelease" == true ]] && create_args+=(--prerelease)
    publisher_gh "${create_args[@]}"
    created_boundary="$(capture_release_boundary post-create true false)" || {
      fail_release_boundary_capture "$?" "created draft GitHub Release boundary"
    }
    [[ "$(printf '%s' "$absent_boundary" | jq -Sc .tag)" == "$(printf '%s' "$created_boundary" | jq -Sc .tag)" ]] || {
      fail_reconcile inconclusive remote-state-changed \
        "immutable tag binding changed during draft creation; reconcile the same exact source SHA"
    }
    current_boundary="$created_boundary"
  fi
  if [[ -n "$current_boundary" ]]; then
    current_draft="$(printf '%s' "$current_boundary" | jq -r .release.draft)"
  else
    current_draft="$(printf '%s' "$state" | jq -r .isDraft)"
  fi
  [[ "$current_draft" == "true" || "$current_draft" == "false" ]] || return 1
  current_immutable=false
  [[ "$current_draft" == "false" ]] && current_immutable=true
  if [[ -z "$current_boundary" ]]; then
    current_boundary="$(capture_release_boundary initial "$current_draft" "$current_immutable")" || {
      fail_release_boundary_capture "$?" "initial GitHub Release mutation boundary"
    }
  fi
  asset_names="$(printf '%s' "$current_boundary" | jq -r '.assets[].name')"
  expected_asset_names="$(find "$assets_dir" -mindepth 1 -maxdepth 1 -type f -exec basename {} \; | LC_ALL=C sort)"
  while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    grep -Fqx -- "$name" <<< "$expected_asset_names" || {
      echo "error: GitHub Release has unexpected asset: $name" >&2
      return 1
    }
  done <<< "$asset_names"
  for asset in "$assets_dir"/*; do
    name="${asset##*/}"
    if grep -Fqx -- "$name" <<< "$asset_names"; then
      download_dir="$temporary_root/download-$name"
      mkdir "$download_dir"
      publisher_gh release download "$immutable_tag" --repo "$TARGET_REPOSITORY" --pattern "$name" --dir "$download_dir"
      cmp -- "$asset" "$download_dir/$name" || { echo "error: existing release asset conflicts: $name" >&2; return 1; }
    else
      [[ "$current_draft" == "true" ]] || {
        echo "error: published GitHub Release is missing asset: $name" >&2
        return 1
      }
      missing_assets+=("$asset")
    fi
  done
  before_boundary="$(capture_release_boundary pre-upload "$current_draft" "$current_immutable")" || {
    fail_release_boundary_capture "$?" "pre-upload GitHub Release boundary"
  }
  [[ "$before_boundary" == "$current_boundary" ]] || {
    fail_reconcile inconclusive remote-state-changed \
      "GitHub Release boundary changed before the upload phase; reconcile the same exact source SHA"
  }
  if [[ "${#missing_assets[@]}" -gt 0 ]]; then
    for asset in "${missing_assets[@]}"; do
      name="${asset##*/}"
      before_boundary="$(capture_release_boundary "before-upload-$name" true false)" || {
        fail_release_boundary_capture "$?" "GitHub Release boundary before uploading $name"
      }
      [[ "$before_boundary" == "$current_boundary" ]] || {
        fail_reconcile inconclusive remote-state-changed \
          "GitHub Release boundary changed before uploading $name; reconcile the same exact source SHA"
      }
      require_publication_mutation release-completion
      publisher_gh release upload "$immutable_tag" "$asset" --repo "$TARGET_REPOSITORY"
      download_dir="$temporary_root/download-uploaded-$name"
      mkdir "$download_dir"
      publisher_gh release download "$immutable_tag" --repo "$TARGET_REPOSITORY" --pattern "$name" --dir "$download_dir"
      cmp -- "$asset" "$download_dir/$name" || { echo "error: uploaded release asset failed readback: $name" >&2; return 1; }
      after_boundary="$(capture_release_boundary "after-upload-$name" true false)" || {
        fail_release_boundary_capture "$?" "GitHub Release boundary after uploading $name"
      }
      jq -e -n \
        --arg name "$name" \
        --argjson before "$current_boundary" \
        --argjson after "$after_boundary" \
        '$before.release == $after.release and $before.tag == $after.tag and
         all($before.assets[]; . as $old | any($after.assets[]; . == $old)) and
         ([ $after.assets[] | select(.name == $name) ] | length) == 1 and
         ($after.assets | length) == (($before.assets | length) + 1)' >/dev/null || {
        fail_reconcile inconclusive remote-state-changed \
          "GitHub Release boundary changed unexpectedly while uploading $name; reconcile the same exact source SHA"
      }
      current_boundary="$after_boundary"
    done
  fi
  asset_names="$(printf '%s' "$current_boundary" | jq -r '.assets[].name')"
  for asset in "$assets_dir"/*; do
    grep -Fqx -- "${asset##*/}" <<< "$asset_names" || return 1
  done
  [[ "$(printf '%s\n' "$asset_names" | LC_ALL=C sort)" == "$expected_asset_names" ]] || {
    echo "error: GitHub Release has unexpected assets" >&2
    return 1
  }
  if [[ "$current_draft" == "true" ]]; then
    require_publication_mutation release-completion
    require_immutable_release_policy release-publication
    verify_final_policy_fence before-release-publication
    before_boundary="$(capture_release_boundary pre-publication-mutation true false)" || {
      fail_release_boundary_capture "$?" "final draft GitHub Release publication boundary"
    }
    [[ "$before_boundary" == "$current_boundary" ]] || {
      fail_reconcile blocked_conflict immutable-release-mismatch \
        "the stable final draft GitHub Release identity, author, tag binding, or assets differ from the frozen publication boundary"
    }
    release_id="$(printf '%s' "$before_boundary" | jq -er \
      '.release.id | select(type == "number" and floor == . and . > 0)')" || {
      fail_reconcile blocked_conflict immutable-release-mismatch \
        "the frozen draft GitHub Release has an invalid numeric id"
    }
    release_make_latest=false
    if [[ "$prerelease" == false && "$preflight_write_eligible" == "true" ]]; then
      release_make_latest=true
    fi
    publication_payload="$temporary_root/release-publication-payload.json"
    publication_response="$temporary_root/release-publication-response.json"
    publication_error="$temporary_root/release-publication-response.err"
    jq -cS -n \
      --arg tag_name "$immutable_tag" \
      --arg name "$immutable_tag" \
      --arg body "$expected_release_body" \
      --argjson prerelease "$prerelease" \
      --arg make_latest "$release_make_latest" \
      '{tag_name:$tag_name,name:$name,body:$body,draft:false,prerelease:$prerelease,make_latest:$make_latest}' \
      > "$publication_payload"
    # GitHub's Release PATCH has no compare-and-swap primitive. Keep this
    # trusted-writer boundary adjacent to the mutation so only the unavoidable
    # GET-to-PATCH race remains; the strict post-readback still fails closed.
    if ! publisher_gh api \
        --method PATCH \
        --header 'X-GitHub-Api-Version: 2026-03-10' \
        "repos/$TARGET_REPOSITORY/releases/$release_id" \
        --input "$publication_payload" > "$publication_response" 2> "$publication_error"; then
      cat "$publication_error" >&2
      fail_reconcile inconclusive release-publication-unknown \
        "the direct GitHub Release publication PATCH failed and may have applied; reconcile the same exact source SHA"
    fi
    jq -e --argjson release_id "$release_id" \
      'type == "object" and .id == $release_id' "$publication_response" >/dev/null 2>&1 || {
      fail_reconcile inconclusive release-publication-unknown \
        "the direct GitHub Release publication PATCH response was missing or malformed; reconcile the same exact source SHA"
    }
  else
    before_boundary="$(capture_release_boundary pre-publish false true)" || {
      fail_release_boundary_capture "$?" "existing immutable GitHub Release pre-publish boundary"
    }
    [[ "$before_boundary" == "$current_boundary" ]] || {
      fail_reconcile blocked_conflict immutable-release-mismatch \
        "the stable immutable GitHub Release boundary differs from the frozen publication boundary"
    }
  fi
  post_publish_release_api="$temporary_root/current-release-post-publish.json"
  publisher_gh api "repos/$TARGET_REPOSITORY/releases/tags/$immutable_tag" > "$post_publish_release_api" || {
    fail_reconcile inconclusive remote-read-inconclusive \
      "published GitHub Release could not be read back after publication"
  }
  jq -e '.draft == false and .immutable == true' "$post_publish_release_api" >/dev/null || {
    fail_reconcile blocked_conflict immutable-release-mismatch \
      "published GitHub Release must report draft=false and immutable=true before alias advancement"
  }
  published_boundary="$(capture_release_boundary post-publish false true)" || {
    fail_release_boundary_capture "$?" "published immutable GitHub Release boundary"
  }
  jq -e -n \
    --argjson before "$current_boundary" \
    --argjson after "$published_boundary" \
    '($before.release | del(.draft,.immutable)) == ($after.release | del(.draft,.immutable)) and
     $before.assets == $after.assets and $before.tag == $after.tag and
     $after.release.draft == false and $after.release.immutable == true' >/dev/null || {
    fail_reconcile blocked_conflict immutable-release-mismatch \
      "published GitHub Release identity, author, tag binding, or assets differ from the frozen draft boundary"
  }
  current_boundary="$published_boundary"
  latest_after="$(read_latest_release_tag after)"
  if [[ "$preflight_write_eligible" == "true" && "$prerelease" != "true" ]]; then
    [[ "$latest_after" == "$immutable_tag" ]] || {
      fail_reconcile blocked_conflict immutable-release-mismatch \
        "fresh stable release did not become the latest GitHub Release"
    }
  else
    [[ "$latest_after" == "$latest_before" ]] || {
      fail_reconcile blocked_conflict immutable-release-mismatch \
        "stale or prerelease completion changed the latest GitHub Release"
    }
  fi

  # The alias is eligible only after a complete post-immutability readback.
  # Re-read exact metadata, download every final asset, verify deterministic
  # bytes and signed provenance, then prove the API snapshot stayed stable
  # across that verification. Asset names alone cannot detect replacement.
  final_boundary="$(capture_release_boundary final-immutable false true)" || {
    fail_release_boundary_capture "$?" "immutable GitHub Release boundary before final verification"
  }
  [[ "$final_boundary" == "$current_boundary" ]] || {
    fail_reconcile blocked_conflict immutable-release-mismatch \
      "the stable immutable GitHub Release identity, author, tag binding, or assets differ from the frozen published boundary"
  }
  final_release_api="$temporary_root/current-release-final-immutable.json"
  publisher_gh api "repos/$TARGET_REPOSITORY/releases/tags/$immutable_tag" > "$final_release_api" || {
    fail_reconcile inconclusive remote-read-inconclusive \
      "immutable GitHub Release metadata could not be read before alias advancement"
  }
  jq -e \
    --arg tag "$immutable_tag" \
    --arg body "$expected_release_body" \
    --argjson prerelease "$prerelease" \
    '.tag_name == $tag and .name == $tag and .body == $body and
     .prerelease == $prerelease and .draft == false and .immutable == true and
     .author.login == "codex-review-gate-action-publisher[bot]"' \
    "$final_release_api" >/dev/null || {
    fail_reconcile blocked_conflict immutable-release-mismatch \
      "final immutable GitHub Release metadata differs from policy"
  }
  final_release_identity="$(printf '%s' "$final_boundary" | jq -Sc .release)"
  final_asset_snapshot="$(printf '%s' "$final_boundary" | jq -Sc .assets)"
  asset_names="$(printf '%s' "$final_asset_snapshot" | jq -r '.[].name' | LC_ALL=C sort)"
  [[ "$asset_names" == "$expected_asset_names" ]] || {
    fail_reconcile blocked_conflict immutable-release-mismatch \
      "final immutable GitHub Release asset inventory differs from policy"
  }

  final_download_dir="$(mktemp -d "$temporary_root/final-immutable-assets.XXXXXX")"
  publisher_gh release download "$immutable_tag" --repo "$TARGET_REPOSITORY" --pattern '*' --dir "$final_download_dir" || {
    fail_reconcile inconclusive remote-read-inconclusive \
      "immutable GitHub Release assets could not be downloaded before alias advancement"
  }
  [[ "$(find "$final_download_dir" -mindepth 1 -maxdepth 1 -type f -exec basename {} \; | LC_ALL=C sort)" == "$expected_asset_names" ]] || {
    fail_reconcile blocked_conflict immutable-release-mismatch \
      "downloaded immutable GitHub Release asset inventory differs from policy"
  }
  for asset in "$assets_dir"/*; do
    name="${asset##*/}"
    cmp -- "$asset" "$final_download_dir/$name" || {
      fail_reconcile blocked_conflict immutable-release-mismatch \
        "immutable GitHub Release asset bytes differ from the approved publication set: $name"
    }
  done
  node "$generator" verify-published-assets \
    --repo "$repo_root" \
    --target-repo "$stage_repo" \
    --source-ref "$source_commit" \
    --asset-dir "$final_download_dir" \
    --release-commit "$release_commit" \
    --full-tag-object "$full_tag_object" || {
    fail_reconcile blocked_conflict immutable-release-mismatch \
      "final immutable GitHub Release assets or provenance differ from the exact source"
  }
  if [[ "$skip_signatures" != true ]]; then
    final_provenance_status="$temporary_root/final-immutable-provenance.gpg-status"
    gpg --batch --status-fd=1 --verify \
      "$final_download_dir/release-provenance.json.asc" \
      "$final_download_dir/release-provenance.json" > "$final_provenance_status" 2>/dev/null || {
      fail_reconcile blocked_conflict immutable-release-mismatch \
        "final immutable Release provenance signature is invalid"
    }
    node "$generator" verify-openpgp-status \
      --input "$final_provenance_status" \
      --name "final immutable release provenance" || {
      fail_reconcile blocked_conflict immutable-release-mismatch \
        "final immutable Release provenance signer differs from policy"
    }
  fi

  final_confirm_api="$temporary_root/current-release-final-confirm.json"
  publisher_gh api "repos/$TARGET_REPOSITORY/releases/tags/$immutable_tag" > "$final_confirm_api" || {
    fail_reconcile inconclusive remote-read-inconclusive \
      "immutable GitHub Release could not be re-read after asset verification"
  }
  final_confirm_boundary="$(capture_release_boundary final-confirm false true)" || {
    fail_release_boundary_capture "$?" "immutable GitHub Release boundary after asset verification"
  }
  final_confirm_identity="$(printf '%s' "$final_confirm_boundary" | jq -Sc .release)"
  final_confirm_snapshot="$(printf '%s' "$final_confirm_boundary" | jq -Sc .assets)"
  [[ "$final_confirm_boundary" == "$final_boundary" &&
      "$final_confirm_identity" == "$final_release_identity" &&
      "$final_confirm_snapshot" == "$final_asset_snapshot" ]] || {
    fail_reconcile blocked_conflict immutable-release-mismatch \
      "the stable immutable GitHub Release metadata or asset identity differs from the frozen final-verification boundary"
  }
}

if [[ -n "$test_release_dir" ]]; then
  reconcile_test_release
else
  reconcile_github_release
fi

if [[ -n "$major_alias" ]]; then
  if [[ -z "$test_release_dir" ]]; then
    pre_alias_boundary="$final_confirm_boundary"
  fi
  read_remote_alias_snapshot() {
    local lines
    if ! lines="$(target_git ls-remote "$target_url" \
        "refs/tags/$major_alias" "refs/tags/$major_alias^{}")"; then
      return "$RELEASE_BOUNDARY_REMOTE_UNREADABLE"
    fi
    printf '%s\n' "$lines" | sed '/^$/d' | LC_ALL=C sort
  }
  validate_remote_alias_snapshot() {
    local lines="$1"
    local line object ref direct="" peeled="" count=0
    if [[ -z "$lines" ]]; then
      printf 'absent\n'
      return 0
    fi
    while IFS= read -r line; do
      [[ -n "$line" ]] || continue
      count=$((count + 1))
      [[ "$line" == *$'\t'* ]] || return "$RELEASE_BOUNDARY_POLICY_MISMATCH"
      object="${line%%$'\t'*}"
      ref="${line#*$'\t'}"
      [[ "$ref" != *$'\t'* && "$object" =~ ^[0-9a-f]{40}$ ]] || {
        return "$RELEASE_BOUNDARY_POLICY_MISMATCH"
      }
      case "$ref" in
        "refs/tags/$major_alias")
          [[ -z "$direct" ]] || return "$RELEASE_BOUNDARY_POLICY_MISMATCH"
          direct="$object"
          ;;
        "refs/tags/$major_alias^{}")
          [[ -z "$peeled" ]] || return "$RELEASE_BOUNDARY_POLICY_MISMATCH"
          peeled="$object"
          ;;
        *)
          return "$RELEASE_BOUNDARY_POLICY_MISMATCH"
          ;;
      esac
    done <<< "$lines"
    [[ "$count" == "2" && -n "$direct" && -n "$peeled" ]] || {
      return "$RELEASE_BOUNDARY_POLICY_MISMATCH"
    }
    printf '%s\t%s\n' "$direct" "$peeled"
  }
  if [[ "$alias_needs_push" == true ]]; then
    alias_raw_before_a="$(read_remote_alias_snapshot)" || {
      fail_reconcile inconclusive remote-read-inconclusive \
        "floating alias raw binding could not be read immediately before mutation"
    }
    alias_raw_before_b="$(read_remote_alias_snapshot)" || {
      fail_reconcile inconclusive remote-read-inconclusive \
        "floating alias raw binding could not be confirmed immediately before mutation"
    }
    [[ "$alias_raw_before_a" == "$alias_raw_before_b" ]] || {
      fail_reconcile inconclusive remote-state-changed \
        "floating alias raw binding changed immediately before mutation"
    }
    alias_boundary_before="$(validate_remote_alias_snapshot "$alias_raw_before_b")" || {
      fail_reconcile blocked_conflict malformed-major-alias-target \
        "stable floating alias binding is malformed or is not an annotated tag immediately before mutation"
    }
    if [[ "$alias_before" == "none" ]]; then
      [[ "$alias_boundary_before" == "absent" ]] || {
        fail_reconcile inconclusive remote-state-changed \
          "floating alias appeared immediately before creation"
      }
    else
      [[ "$alias_boundary_before" == "$alias_before"$'\t'"$old_alias_commit" ]] || {
        fail_reconcile inconclusive remote-state-changed \
          "floating alias direct object or target changed immediately before update"
      }
    fi
    require_publication_mutation alias
    require_immutable_release_policy alias-mutation
    if [[ -z "$test_release_dir" ]]; then
      pre_alias_boundary="$(capture_release_boundary pre-alias-mutation false true)" || {
        fail_release_boundary_capture "$?" "final immutable GitHub Release boundary before alias mutation"
      }
      [[ "$pre_alias_boundary" == "$final_confirm_boundary" ]] || {
        fail_reconcile blocked_conflict immutable-release-mismatch \
          "the stable immutable GitHub Release identity, author, tag binding, or assets differ from the frozen pre-alias boundary"
      }
    fi
    if [[ "$alias_mode" == "force-with-lease" ]]; then
      target_git_push --force-with-lease="refs/tags/$major_alias:$alias_before" \
        "refs/tags/$major_alias:refs/tags/$major_alias"
    else
      target_git_push "refs/tags/$major_alias:refs/tags/$major_alias"
    fi
  fi
  alias_raw_after_a="$(read_remote_alias_snapshot)" || {
    fail_reconcile inconclusive remote-read-inconclusive \
      "floating alias raw binding could not be read after reconcile"
  }
  alias_raw_after_b="$(read_remote_alias_snapshot)" || {
    fail_reconcile inconclusive remote-read-inconclusive \
      "floating alias raw binding could not be confirmed after reconcile"
  }
  [[ "$alias_raw_after_a" == "$alias_raw_after_b" ]] || {
    fail_reconcile inconclusive remote-state-changed \
      "floating alias raw binding changed between post-mutation readbacks"
  }
  alias_boundary_after="$(validate_remote_alias_snapshot "$alias_raw_after_b")" || {
    fail_reconcile blocked_conflict malformed-major-alias-target \
      "stable floating alias binding is malformed or is not an annotated tag after reconcile"
  }
  [[ "$alias_boundary_after" == "$planned_alias_object"$'\t'"$planned_alias_commit" ]] || {
    fail_reconcile blocked_conflict malformed-major-alias-target \
      "stable floating alias direct object or target differs from the approved transition"
  }
  remote_alias_object="$planned_alias_object"
  if [[ -z "$test_release_dir" ]]; then
    post_alias_boundary="$(capture_release_boundary post-alias false true)" || {
      fail_release_boundary_capture "$?" "immutable GitHub Release boundary after alias reconcile"
    }
    [[ "$post_alias_boundary" == "$pre_alias_boundary" ]] || {
      fail_reconcile blocked_conflict immutable-release-mismatch \
        "the stable immutable GitHub Release identity, assets, or full-tag binding differ from the frozen alias-mutation boundary"
    }
  fi
  if ! is_test_environment; then
    alias_verification="$(publisher_gh api "repos/$TARGET_REPOSITORY/git/tags/$remote_alias_object" --jq '[.verification.verified,.verification.reason] | map(tostring) | join(" ")')"
    [[ "$alias_verification" == "true valid" ]] || { echo "error: GitHub did not verify the major alias signature" >&2; exit 1; }
  fi
fi

verify_final_policy_fence success-readback
emit_reconcile_state "$reconcile_state"
