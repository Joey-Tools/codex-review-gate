import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const action = readFileSync(
  new URL("../packages/action/action.yml", import.meta.url),
  "utf8",
);
const sourceConsumer = readFileSync(
  new URL("../.github/workflows/codex-review-gate.yml", import.meta.url),
  "utf8",
);
const templateConsumer = readFileSync(
  new URL(
    "../templates/codex-gated-repo/.github/workflows/codex-review-gate.yml",
    import.meta.url,
  ),
  "utf8",
);

const packageReusable = new URL(
  "../packages/action/.github/workflows/codex-review-gate.yml",
  import.meta.url,
);
const packageReconcile = new URL(
  "../packages/action/.github/workflows/codex-review-gate-reconcile.yml",
  import.meta.url,
);

const ACTION_INPUTS = [
  "github_token",
  "pr_number",
  "expected_head_sha",
  "operation",
  "request_comment_id",
  "request_review",
  "limits_profile",
];
const ACTION_OUTPUTS = [
  "execution_health",
  "gate_outcome",
  "recovery_code",
  "retry_safe",
];

test("v2 publishes one direct JavaScript Action and no reusable-workflow ABI", () => {
  assert.equal(existsSync(packageReusable), false);
  assert.equal(existsSync(packageReconcile), false);

  const inputs = yamlSection(action, "inputs", "outputs");
  assert.deepEqual(topLevelYamlKeys(inputs), ACTION_INPUTS);
  assert.match(yamlChildBlock(inputs, "github_token"), /^    required: true$/mu);
  assert.match(yamlChildBlock(inputs, "pr_number"), /^    required: true$/mu);
  assert.match(yamlChildBlock(inputs, "operation"), /^    default: reconcile$/mu);
  assert.match(yamlChildBlock(inputs, "request_review"), /^    default: "true"$/mu);
  assert.match(yamlChildBlock(inputs, "limits_profile"), /^    default: default$/mu);

  const outputs = yamlSection(action, "outputs", "runs");
  assert.deepEqual(topLevelYamlKeys(outputs), ACTION_OUTPUTS);
  for (const name of ACTION_OUTPUTS) {
    assert.match(yamlChildBlock(outputs, name), /^    description: /mu);
    assert.doesNotMatch(yamlChildBlock(outputs, name), /^    value:/mu);
  }

  const runs = action.slice(action.indexOf("\nruns:\n"));
  assert.deepEqual(topLevelYamlKeys(runs), ["using", "main"]);
  assert.match(runs, /^  using: node20$/mu);
  assert.match(runs, /^  main: src\/v2\/gate-runtime\.mjs$/mu);
  assert.doesNotMatch(
    runs,
    /composite|steps:|shell:|env:|src\/(?:gate|v2\/action)\.mjs|actions\/checkout|npm\s+(?:ci|install)|GITHUB_GRAPHQL_URL/u,
  );
});

test("v2 Action exposes only the closed operation, request, and limits-profile ABI", () => {
  const inputs = yamlSection(action, "inputs", "outputs");
  assert.deepEqual(topLevelYamlKeys(inputs), ACTION_INPUTS);
  assert.match(yamlChildBlock(inputs, "expected_head_sha"), /^    default: ""$/mu);
  assert.match(yamlChildBlock(inputs, "operation"), /^    default: reconcile$/mu);
  assert.match(yamlChildBlock(inputs, "request_comment_id"), /^    default: ""$/mu);
  assert.match(yamlChildBlock(inputs, "request_review"), /^    default: "true"$/mu);
  assert.match(yamlChildBlock(inputs, "limits_profile"), /^    default: default$/mu);
  assert.doesNotMatch(
    inputs,
    /^  (?:github-token|pull-request|request-review|max-pages|max-objects|temporary|status-target-mode|operation-input-path|V2_CONTROLLER_|V2_SELECTION_POLICY):/mu,
  );
});

test("source remains on v1 until the v2 alias exists", () => {
  assert.notEqual(sourceConsumer, templateConsumer);
  assert.match(
    sourceConsumer,
    /uses: JoeyTeng\/codex-review-gate-action\/\.github\/workflows\/codex-review-gate\.yml@v1/u,
  );
  assert.doesNotMatch(sourceConsumer, /codex-review-gate-action@v2/u);
});

test("canonical consumer starts runners only for manual dispatch, exact Codex comments, or base edits", () => {
  assert.match(templateConsumer, /^  pull_request_target:\n    types: \[edited\]$/mu);
  assert.match(templateConsumer, /^  issue_comment:\n    types: \[created, edited\]$/mu);
  assert.match(templateConsumer, /^  workflow_dispatch:$/mu);
  assert.doesNotMatch(
    templateConsumer,
    /^  (?:repository_dispatch|schedule|pull_request|pull_request_review|pull_request_review_comment):/mu,
  );

  assert.match(templateConsumer, /github\.event_name == 'workflow_dispatch'/u);
  assert.match(templateConsumer, /github\.ref_type == 'branch'/u);
  assert.match(
    templateConsumer,
    /github\.ref_name == github\.event\.repository\.default_branch/u,
  );
  assert.match(templateConsumer, /github\.event_name == 'issue_comment'/u);
  assert.match(templateConsumer, /github\.event\.action == 'created'/u);
  assert.match(templateConsumer, /github\.event\.action == 'edited'/u);
  assert.match(templateConsumer, /github\.event\.issue\.pull_request/u);
  assert.match(
    templateConsumer,
    /github\.event\.sender\.login == 'chatgpt-codex-connector\[bot\]'/u,
  );
  assert.match(templateConsumer, /github\.event\.sender\.type == 'Bot'/u);
  assert.match(
    templateConsumer,
    /github\.event\.comment\.user\.login == 'chatgpt-codex-connector\[bot\]'/u,
  );
  assert.match(templateConsumer, /github\.event\.comment\.user\.type == 'Bot'/u);
  assert.match(templateConsumer, /github\.event_name == 'pull_request_target'/u);
  assert.match(templateConsumer, /github\.event\.changes\.base\.ref\.from/u);
  assert.match(
    templateConsumer,
    /github\.event\.changes\.base\.ref\.from != github\.event\.pull_request\.base\.ref/u,
  );
  assert.match(
    templateConsumer,
    /github\.event\.pull_request\.base\.ref == github\.event\.repository\.default_branch/u,
  );

  const jobIfCount = templateConsumer.match(/^    if:/gmu)?.length ?? 0;
  assert.equal(jobIfCount, 1);
  assert.equal(templateConsumer.match(/^        if:/gmu)?.length ?? 0, 0);
});

test("manual dispatch exposes only the typed single-PR business inputs", () => {
  const dispatch = yamlSection(templateConsumer, "  workflow_dispatch", "permissions");
  assert.deepEqual(topLevelYamlKeys(yamlChildBlock(dispatch, "inputs", 4), 6), [
    "operation",
    "pr_number",
    "expected_head_sha",
    "request_comment_id",
    "request_review",
    "limits_profile",
  ]);
  assert.match(yamlChildBlock(dispatch, "operation", 6), /^        type: choice$/mu);
  assert.match(yamlChildBlock(dispatch, "pr_number", 6), /^        type: number$/mu);
  assert.match(yamlChildBlock(dispatch, "expected_head_sha", 6), /^        type: string$/mu);
  assert.match(yamlChildBlock(dispatch, "request_review", 6), /^        type: boolean$/mu);
  assert.match(yamlChildBlock(dispatch, "request_review", 6), /^        default: true$/mu);
  assert.match(yamlChildBlock(dispatch, "limits_profile", 6), /- default\n          - expanded/u);
  assert.doesNotMatch(templateConsumer, /batch|temporary|max_pages|max_objects|client_payload/u);
});

test("canonical consumer has the minimal permission, runner, and direct-action surface", () => {
  assert.match(
    templateConsumer,
    /^permissions:\n  contents: read\n  issues: write\n  pull-requests: read\n  statuses: write$/mu,
  );
  assert.match(
    templateConsumer,
    /group: codex-review-gate-\$\{\{ github\.repository \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.event\.issue\.number \|\| inputs\.pr_number \}\}/u,
  );
  assert.match(templateConsumer, /^  cancel-in-progress: false$/mu);
  assert.match(
    templateConsumer,
    /^    runs-on: \$\{\{ vars\.CODEX_REVIEW_GATE_USE_UBUNTU_LATEST == 'true' && 'ubuntu-latest' \|\| 'ubuntu-slim' \}\}$/mu,
  );
  assert.match(templateConsumer, /^    timeout-minutes: 14$/mu);
  assert.equal(
    (templateConsumer.match(/uses: JoeyTeng\/codex-review-gate-action@v2/gu) ?? [])
      .length,
    1,
  );
  assert.doesNotMatch(
    templateConsumer,
    /actions\/checkout|\.\/\.github\/workflows|secrets:\s*inherit|contents: write|pull-requests: write|id-token:/u,
  );
  assert.match(
    templateConsumer,
    /^          github_token: \$\{\{ github\.token \}\}$/mu,
  );
  assert.match(
    templateConsumer,
    /^        env:\n          CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION: \$\{\{ vars\.CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION == 'any' && 'any' \|\| 'write' \}\}$/mu,
  );
  assert.match(
    templateConsumer,
    /^          pr_number: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.pr_number \|\| github\.event_name == 'pull_request_target' && github\.event\.pull_request\.number \|\| github\.event\.issue\.number \}\}$/mu,
  );
  assert.match(
    templateConsumer,
    /^          expected_head_sha: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.expected_head_sha \|\| github\.event_name == 'pull_request_target' && github\.event\.pull_request\.head\.sha \|\| '' \}\}$/mu,
  );
  assert.match(
    templateConsumer,
    /^          operation: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.operation \|\| 'reconcile' \}\}$/mu,
  );
  assert.match(
    templateConsumer,
    /^          request_comment_id: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.request_comment_id \|\| github\.event_name == 'issue_comment' && github\.event\.comment\.id \|\| '' \}\}$/mu,
  );
  assert.match(
    templateConsumer,
    /^          request_review: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.operation == 'begin-review' && inputs\.request_review \|\| false \}\}$/mu,
  );
  assert.match(
    templateConsumer,
    /^          limits_profile: \$\{\{ \(\(github\.event_name == 'workflow_dispatch' && inputs\.limits_profile == 'expanded'\) \|\| vars\.CODEX_REVIEW_GATE_LIMITS_PROFILE == 'expanded'\) && 'expanded' \|\| 'default' \}\}$/mu,
  );
});

function yamlSection(source, startName, endName) {
  const start = source.indexOf(`${startName}:\n`);
  assert.notEqual(start, -1, `missing ${startName} section`);
  if (endName === "") return source.slice(start);
  const end = source.indexOf(`\n${endName}:\n`, start + startName.length + 2);
  assert.notEqual(end, -1, `missing ${endName} section after ${startName}`);
  return source.slice(start, end + 1);
}

function topLevelYamlKeys(source, indent = 2) {
  const pattern = new RegExp(`^ {${indent}}([A-Za-z0-9_-]+):(?:\\s|$)`, "gmu");
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

function yamlChildBlock(source, name, indent = 2) {
  const lines = source.split("\n");
  const header = `${" ".repeat(indent)}${name}:`;
  const start = lines.findIndex((line) => line === header);
  assert.notEqual(start, -1, `missing ${name} block`);
  let end = start + 1;
  while (
    end < lines.length &&
    (lines[end].trim() === "" || lines[end].startsWith(" ".repeat(indent + 2)))
  ) {
    end += 1;
  }
  return lines.slice(start, end).join("\n");
}
