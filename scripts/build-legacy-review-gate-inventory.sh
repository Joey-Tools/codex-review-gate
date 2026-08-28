#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 3 ]]; then
  printf 'usage: %s REPOSITORY EXPECTED_DEFAULT_BRANCH OUTPUT\n' "$0" >&2
  exit 64
fi

repository=$1
expected_default_branch=$2
output=$3
script_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
canonicalizer="$script_directory/canonicalize-legacy-review-gate-inventory.mjs"
test -f "$canonicalizer"
output_directory=$(dirname -- "$output")
test -d "$output_directory"

umask 077
inventory_directory=$(mktemp -d "${TMPDIR:-/tmp}/codex-review-gate-inventory.XXXXXX")
repository_metadata="$inventory_directory/repository.json"
repository_metadata_final="$inventory_directory/repository-final.json"
ruleset_pages="$inventory_directory/rulesets.json"
ruleset_details="$inventory_directory/ruleset-details.json"
ruleset_detail="$inventory_directory/ruleset-detail.json"
ruleset_next="$inventory_directory/ruleset-next.json"
classic_headers="$inventory_directory/classic.headers"
classic_error="$inventory_directory/classic.error"
classic_status="$inventory_directory/classic.json"
canonical_inventory="$inventory_directory/canonical.json"
output_staging=$(mktemp "$output_directory/.codex-review-gate-inventory.XXXXXX")

cleanup() {
  rm -f "$repository_metadata" "$repository_metadata_final" "$ruleset_pages" \
    "$ruleset_details" "$ruleset_detail" \
    "$ruleset_next" "$classic_headers" "$classic_error" \
    "$classic_status" "$canonical_inventory" "$output_staging"
  rmdir "$inventory_directory" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM

gh api --hostname github.com "repos/$repository" > "$repository_metadata"
jq -e --arg repository "$repository" '
  type == "object"
  and .full_name == $repository
  and (.id | type == "number" and floor == . and . > 0)
  and (.node_id | type == "string" and length > 0)
  and (.default_branch | type == "string" and length > 0)' \
  "$repository_metadata" > /dev/null
repository_id=$(jq -r '.id' "$repository_metadata")
repository_node_id=$(jq -r '.node_id' "$repository_metadata")
default_branch_fresh=$(jq -r '.default_branch' "$repository_metadata")
test "$default_branch_fresh" = "$expected_default_branch"
default_branch_uri=$(jq -rn --arg value "$default_branch_fresh" '$value | @uri')

gh api --hostname github.com --paginate --slurp \
  "repos/$repository/rules/branches/$default_branch_uri?per_page=100" \
  > "$ruleset_pages"

classic_endpoint="repos/$repository/branches/$default_branch_uri/protection/required_status_checks"
if gh api --hostname github.com --include --silent "$classic_endpoint" \
  > "$classic_headers" 2> "$classic_error"; then
  grep -Eq '^HTTP/[^ ]+ 200 ' "$classic_headers"
  gh api --hostname github.com "$classic_endpoint" > "$classic_status"
  jq -e 'type == "object"' "$classic_status" > /dev/null
else
  grep -Eq '^HTTP/[^ ]+ 404 ' "$classic_headers"
  grep -Eq '^gh: (Branch not protected|Required status checks not enabled) \(HTTP 404\)$' \
    "$classic_error"
  printf 'null\n' > "$classic_status"
fi

jq -e '
  type == "array"
  and length > 0
  and all(.[]; type == "array")
  and all(.[][];
    type == "object"
    and (.type | type == "string")
    and (.ruleset_id | type == "number")
    and (if .type == "required_status_checks" then
      (.parameters | type == "object")
      and (.parameters.strict_required_status_checks_policy | type == "boolean")
      and ((.parameters | has("do_not_enforce_on_create") | not)
        or (.parameters.do_not_enforce_on_create | type == "boolean"))
      and (.parameters.required_status_checks | type == "array")
      and all(.parameters.required_status_checks[];
        type == "object"
        and (.context | type == "string" and length > 0)
        and ((has("integration_id") | not)
          or (.integration_id | type == "number"
            and floor == . and . > 0)))
    else true end))' "$ruleset_pages" > /dev/null

jq -e '
  . == null or
  (type == "object"
   and (.strict | type == "boolean")
   and (.contexts | type == "array")
   and all(.contexts[]; type == "string" and length > 0)
   and (.checks | type == "array")
   and all(.checks[];
     type == "object"
     and (.context | type == "string" and length > 0)
     and has("app_id")
     and (.app_id == null or
       (.app_id | type == "number" and floor == . and (. == -1 or . > 0)))))' \
  "$classic_status" > /dev/null

printf '[]\n' > "$ruleset_details"
jq -r '[.[][]
  | select(.type == "required_status_checks")
  | select(any(.parameters.required_status_checks[];
      .context == "codex/review-gate"))
  | .ruleset_id] | unique | sort | .[]' "$ruleset_pages" \
  | while IFS= read -r ruleset_id; do
      gh api --hostname github.com \
        "repos/$repository/rulesets/$ruleset_id" > "$ruleset_detail"
      jq -e --argjson expected_id "$ruleset_id" '
        type == "object"
        and (.id | type == "number")
        and .id == $expected_id
        and (.name | type == "string")
        and (.source_type | type == "string")
        and (.source | type == "string")
        and (.enforcement | type == "string")
        and (.target | type == "string")
        and (.conditions | type == "object")
        and (.rules | type == "array")
        and all(.rules[];
          type == "object"
          and (.type | type == "string" and length > 0)
          and (if .type == "required_status_checks" then
            (.parameters | type == "object")
            and (.parameters.strict_required_status_checks_policy
              | type == "boolean")
            and ((.parameters | has("do_not_enforce_on_create") | not)
              or (.parameters.do_not_enforce_on_create | type == "boolean"))
            and (.parameters.required_status_checks | type == "array")
            and all(.parameters.required_status_checks[];
              type == "object"
              and (.context | type == "string" and length > 0)
              and ((has("integration_id") | not)
                or (.integration_id | type == "number"
                  and floor == . and . > 0)))
          else
            ((has("parameters") | not) or (.parameters | type == "object"))
          end))
        and any(.rules[];
          .type == "required_status_checks"
          and any(.parameters.required_status_checks[];
            .context == "codex/review-gate"))
        and ([.rules[] | select(.type == "required_status_checks")]
          | length == 1)
        and (.bypass_actors | type == "array")
        and (. as $ruleset | all(.bypass_actors[];
          type == "object"
          and (.actor_type | IN("Integration", "OrganizationAdmin",
            "RepositoryRole", "Team", "DeployKey", "EnterpriseOwner",
            "EnterpriseRole", "User"))
          and (.bypass_mode | IN("always", "pull_request", "exempt"))
          and (if .actor_type == "DeployKey" then
            .actor_id == null
          elif (.actor_type | IN("OrganizationAdmin", "EnterpriseOwner")) then
            (.actor_id == null or (.actor_id | type == "number"))
          else
            (.actor_id | type == "number")
          end)
          and (if .bypass_mode == "pull_request" then
            .actor_type != "DeployKey" and $ruleset.target == "branch"
          else true end)))' "$ruleset_detail" > /dev/null
      jq -s '.[0] + [.[1]]' "$ruleset_details" "$ruleset_detail" \
        > "$ruleset_next"
      mv "$ruleset_next" "$ruleset_details"
    done

gh api --hostname github.com "repos/$repository" > "$repository_metadata_final"
jq -e --arg repository "$repository" --arg branch "$default_branch_fresh" \
  --argjson repository_id "$repository_id" \
  --arg repository_node_id "$repository_node_id" '
  type == "object"
  and .full_name == $repository
  and .id == $repository_id
  and .node_id == $repository_node_id
  and .default_branch == $branch' "$repository_metadata_final" > /dev/null
final_branch_name=$(gh api --hostname github.com \
  "repos/$repository/branches/$default_branch_uri" --jq '.name')
test "$final_branch_name" = "$default_branch_fresh"

node "$canonicalizer" \
  "$repository" \
  "$repository_id" \
  "$repository_node_id" \
  "$default_branch_fresh" \
  "$ruleset_pages" \
  "$ruleset_details" \
  "$classic_status" > "$canonical_inventory"

cp "$canonical_inventory" "$output_staging"
mv "$output_staging" "$output"

inventory_sha256=$(node -e '
  const crypto = require("node:crypto");
  const fs = require("node:fs");
  process.stdout.write(crypto.createHash("sha256")
    .update(fs.readFileSync(process.argv[1])).digest("hex"));' "$output")
printf 'LEGACY_INVENTORY_SHA256=%s\n' "$inventory_sha256"
