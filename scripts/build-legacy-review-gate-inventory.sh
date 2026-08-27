#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 3 ]]; then
  printf 'usage: %s REPOSITORY EXPECTED_DEFAULT_BRANCH OUTPUT\n' "$0" >&2
  exit 64
fi

repository=$1
expected_default_branch=$2
output=$3
output_directory=$(dirname -- "$output")
test -d "$output_directory"

umask 077
inventory_directory=$(mktemp -d "${TMPDIR:-/tmp}/codex-review-gate-inventory.XXXXXX")
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
  rm -f "$ruleset_pages" "$ruleset_details" "$ruleset_detail" \
    "$ruleset_next" "$classic_headers" "$classic_error" \
    "$classic_status" "$canonical_inventory" "$output_staging"
  rmdir "$inventory_directory" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM

default_branch_fresh=$(gh repo view "$repository" \
  --json defaultBranchRef --jq '.defaultBranchRef.name')
test "$default_branch_fresh" = "$expected_default_branch"
default_branch_uri=$(jq -rn --arg value "$default_branch_fresh" '$value | @uri')

gh api --paginate --slurp \
  "repos/$repository/rules/branches/$default_branch_uri?per_page=100" \
  > "$ruleset_pages"

classic_endpoint="repos/$repository/branches/$default_branch_uri/protection/required_status_checks"
if gh api --include --silent "$classic_endpoint" \
  > "$classic_headers" 2> "$classic_error"; then
  grep -Eq '^HTTP/[^ ]+ 200 ' "$classic_headers"
  gh api "$classic_endpoint" > "$classic_status"
else
  grep -Eq '^HTTP/[^ ]+ 404 ' "$classic_headers"
  printf 'null\n' > "$classic_status"
fi

jq -e '
  type == "array"
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
        and (.context | type == "string")
        and ((has("integration_id") | not)
          or (.integration_id | type == "number")))
    else true end))' "$ruleset_pages" > /dev/null

jq -e '
  . == null or
  (type == "object"
   and (.strict | type == "boolean")
   and (.contexts | type == "array")
   and all(.contexts[]; type == "string")
   and (.checks | type == "array")
   and all(.checks[];
     type == "object" and (.context | type == "string")))' "$classic_status" > /dev/null

printf '[]\n' > "$ruleset_details"
jq -r '[.[][]
  | select(.type == "required_status_checks")
  | select(any(.parameters.required_status_checks[];
      .context == "codex/review-gate"))
  | .ruleset_id] | unique | sort | .[]' "$ruleset_pages" \
  | while IFS= read -r ruleset_id; do
      gh api "repos/$repository/rulesets/$ruleset_id" > "$ruleset_detail"
      jq -e '
        type == "object"
        and (.id | type == "number")
        and (.name | type == "string")
        and (.source_type | type == "string")
        and (.source | type == "string")
        and (.enforcement | type == "string")
        and (.target | type == "string")
        and (.conditions | type == "object")
        and (.rules | type == "array")
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

jq -S -c -n --arg repository "$repository" --arg branch "$default_branch_fresh" \
  --slurpfile effective "$ruleset_pages" \
  --slurpfile details "$ruleset_details" \
  --slurpfile classic "$classic_status" '
  def canonical_condition_value:
    if type == "array" then
      map(canonical_condition_value) | sort_by(tojson)
    elif type == "object" then
      to_entries
      | sort_by(.key)
      | map({key:.key, value:(.value | canonical_condition_value)})
      | from_entries
    else . end;
  def canonical_conditions: canonical_condition_value;
  def canonical_effective_rule:
    .parameters.required_status_checks |=
      sort_by([.context, (.integration_id // -1), tojson]);
  {repository:$repository, default_branch:$branch,
   rulesets: ([$details[0][] as $ruleset
     | $effective[0][][]
     | select(.ruleset_id == $ruleset.id and .type == "required_status_checks")
     | select(any(.parameters.required_status_checks[];
         .context == "codex/review-gate"))
     | {id:$ruleset.id, name:$ruleset.name,
        source_type:$ruleset.source_type, source:$ruleset.source,
        enforcement:$ruleset.enforcement, target:$ruleset.target,
        conditions:($ruleset.conditions | canonical_conditions),
        bypass_actors:($ruleset.bypass_actors
          | sort_by([.actor_type, (.actor_id // -1), .bypass_mode, tojson])),
        effective_required_status_checks_rule:(. | canonical_effective_rule)}]
     | sort_by([.id, .name, .source_type, .source,
                (.effective_required_status_checks_rule | tojson)])),
   classic_required_status_checks:($classic[0]
     | if . == null then null else
       .contexts |= sort
       | .checks |= sort_by([.context, (.app_id // -1), tojson])
       end)}' > "$canonical_inventory"

cp "$canonical_inventory" "$output_staging"
mv "$output_staging" "$output"

inventory_sha256=$(node -e '
  const crypto = require("node:crypto");
  const fs = require("node:fs");
  process.stdout.write(crypto.createHash("sha256")
    .update(fs.readFileSync(process.argv[1])).digest("hex"));' "$output")
printf 'LEGACY_INVENTORY_SHA256=%s\n' "$inventory_sha256"
