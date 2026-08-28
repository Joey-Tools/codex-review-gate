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
const templateVerifier = readFileSync(
  new URL(
    "../templates/codex-gated-repo/.github/workflows/codex-review-gate.yml",
    import.meta.url,
  ),
  "utf8",
);
const templateController = readFileSync(
  new URL(
    "../templates/codex-gated-repo/.github/workflows/codex-review-gate-controller.yml",
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
  assert.notEqual(sourceConsumer, templateVerifier);
  assert.notEqual(sourceConsumer, templateController);
  assert.match(
    sourceConsumer,
    /uses: JoeyTeng\/codex-review-gate-action\/\.github\/workflows\/codex-review-gate\.yml@v1/u,
  );
  assert.doesNotMatch(sourceConsumer, /codex-review-gate-action@v2/u);
});

test("canonical verifier owns the native required CheckRun on selected pull-request events", () => {
  assert.match(
    templateVerifier,
    /^name: Codex Review Gate Verifier$/mu,
  );
  assert.equal(
    templateVerifier.match(/^run-name:/gmu)?.length ?? 0,
    1,
  );
  assert.match(
    templateVerifier,
    /^run-name: codex-review-gate-verifier\/\$\{\{ github\.event\.pull_request\.number \}\}\/\$\{\{ github\.sha \}\}$/mu,
  );
  assert.match(
    templateVerifier,
    /^  pull_request:\n    types: \[opened, reopened, synchronize, ready_for_review\]$/mu,
  );
  assert.doesNotMatch(
    templateVerifier,
    /^  (?:issue_comment|workflow_dispatch|pull_request_target|repository_dispatch|schedule|pull_request_review|pull_request_review_comment):/mu,
  );
  assert.match(templateVerifier, /^  codex-review-gate:$/mu);
  assert.match(templateVerifier, /^    name: codex\/github-review-gate$/mu);
  assert.equal(templateVerifier.match(/^    if:/gmu)?.length ?? 0, 0);
});

test("canonical controller starts runners only for default-branch dispatches or exact Codex comments", () => {
  assert.match(templateController, /^name: Codex Review Gate Controller$/mu);
  assert.match(templateController, /^  issue_comment:\n    types: \[created, edited\]$/mu);
  assert.match(templateController, /^  workflow_dispatch:$/mu);
  assert.doesNotMatch(
    templateController,
    /^  (?:pull_request|pull_request_target|repository_dispatch|schedule|pull_request_review|pull_request_review_comment):/mu,
  );

  assert.match(templateController, /github\.event_name == 'workflow_dispatch'/u);
  assert.match(templateController, /github\.ref_type == 'branch'/u);
  assert.match(
    templateController,
    /github\.ref_name == github\.event\.repository\.default_branch/u,
  );
  assert.match(templateController, /github\.event_name == 'issue_comment'/u);
  assert.match(templateController, /github\.event\.action == 'created'/u);
  assert.match(templateController, /github\.event\.action == 'edited'/u);
  assert.match(templateController, /github\.event\.issue\.pull_request/u);
  assert.match(
    templateController,
    /github\.event\.sender\.login == 'chatgpt-codex-connector\[bot\]'/u,
  );
  assert.match(templateController, /github\.event\.sender\.type == 'Bot'/u);
  assert.match(
    templateController,
    /github\.event\.comment\.user\.login == 'chatgpt-codex-connector\[bot\]'/u,
  );
  assert.match(templateController, /github\.event\.comment\.user\.type == 'Bot'/u);

  const jobIfCount = templateController.match(/^    if:/gmu)?.length ?? 0;
  assert.equal(jobIfCount, 1);
  assert.equal(templateController.match(/^        if:/gmu)?.length ?? 0, 0);
});

test("manual dispatch exposes only the typed single-PR business inputs", () => {
  const dispatch = yamlSection(templateController, "  workflow_dispatch", "permissions");
  assert.deepEqual(
    topLevelYamlKeys(yamlChildBlock(dispatch, "inputs", 4), 6),
    [
      "operation",
      "pr_number",
      "expected_head_sha",
      "request_comment_id",
      "request_review",
    ],
  );
  assert.match(yamlChildBlock(dispatch, "operation", 6), /^        type: choice$/mu);
  assert.match(yamlChildBlock(dispatch, "operation", 6), /^        default: reconcile$/mu);
  assert.match(yamlChildBlock(dispatch, "pr_number", 6), /^        type: number$/mu);
  assert.match(yamlChildBlock(dispatch, "expected_head_sha", 6), /^        type: string$/mu);
  assert.match(yamlChildBlock(dispatch, "request_review", 6), /^        type: boolean$/mu);
  assert.match(
    yamlChildBlock(dispatch, "request_review", 6),
    /^        description: .*ignored during reconcile$/mu,
  );
  assert.match(yamlChildBlock(dispatch, "request_review", 6), /^        default: true$/mu);
  assert.doesNotMatch(
    dispatch,
    /limits_profile|batch|temporary|max_pages|max_objects|client_payload/u,
  );
});

test("canonical verifier is read-only, latest-wins, and uses the direct Action", () => {
  assert.match(
    templateVerifier,
    /^permissions:\n  contents: read\n  issues: read\n  pull-requests: read$/mu,
  );
  assert.match(
    templateVerifier,
    /group: codex-review-gate-verifier-\$\{\{ github\.repository \}\}-\$\{\{ github\.event\.pull_request\.number \}\}/u,
  );
  assert.match(templateVerifier, /^  cancel-in-progress: true$/mu);
  assert.match(
    templateVerifier,
    /^    runs-on: \$\{\{ vars\.CODEX_REVIEW_GATE_USE_UBUNTU_LATEST == 'true' && 'ubuntu-latest' \|\| 'ubuntu-slim' \}\}$/mu,
  );
  assert.match(templateVerifier, /^    timeout-minutes: 14$/mu);
  assert.equal(
    (templateVerifier.match(/uses: JoeyTeng\/codex-review-gate-action@v2/gu) ?? [])
      .length,
    1,
  );
  assert.doesNotMatch(
    templateVerifier,
    /actions\/checkout|\.\/\.github\/workflows|secrets:\s*inherit|actions: write|checks: write|contents: write|issues: write|pull-requests: write|statuses:|id-token:/u,
  );
  assert.match(
    templateVerifier,
    /^          github_token: \$\{\{ github\.token \}\}$/mu,
  );
  assert.match(
    templateVerifier,
    /^        env:\n          CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION: \$\{\{ vars\.CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION == 'any' && 'any' \|\| 'write' \}\}$/mu,
  );
  assert.match(
    templateVerifier,
    /^          pr_number: \$\{\{ github\.event\.pull_request\.number \}\}$/mu,
  );
  assert.match(
    templateVerifier,
    /^          expected_head_sha: \$\{\{ github\.event\.pull_request\.head\.sha \}\}$/mu,
  );
  assert.match(templateVerifier, /^          operation: reconcile$/mu);
  assert.match(templateVerifier, /^          request_review: false$/mu);
  assert.match(
    templateVerifier,
    /^          limits_profile: \$\{\{ vars\.CODEX_REVIEW_GATE_LIMITS_PROFILE == 'expanded' && 'expanded' \|\| 'default' \}\}$/mu,
  );
});

test("canonical controller has only the adopted write authority and ledgerless inputs", () => {
  assert.match(
    templateController,
    /^permissions:\n  actions: write\n  checks: read\n  contents: read\n  issues: write\n  pull-requests: read$/mu,
  );
  assert.match(
    templateController,
    /group: codex-review-gate-controller-\$\{\{ github\.repository \}\}-\$\{\{ github\.event\.issue\.number \|\| inputs\.pr_number \}\}/u,
  );
  assert.match(templateController, /^  cancel-in-progress: false$/mu);
  assert.match(templateController, /^    name: codex\/review-gate-controller$/mu);
  assert.match(
    templateController,
    /^    runs-on: \$\{\{ vars\.CODEX_REVIEW_GATE_USE_UBUNTU_LATEST == 'true' && 'ubuntu-latest' \|\| 'ubuntu-slim' \}\}$/mu,
  );
  assert.match(templateController, /^    timeout-minutes: 14$/mu);
  assert.equal(
    (templateController.match(/uses: JoeyTeng\/codex-review-gate-action@v2/gu) ?? [])
      .length,
    1,
  );
  assert.doesNotMatch(
    templateController,
    /actions\/checkout|\.\/\.github\/workflows|secrets:\s*inherit|checks: write|contents: write|pull-requests: write|statuses:|id-token:/u,
  );
  assert.match(
    templateController,
    /^          pr_number: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.pr_number \|\| github\.event\.issue\.number \}\}$/mu,
  );
  assert.match(
    templateController,
    /^          expected_head_sha: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.expected_head_sha \|\| '' \}\}$/mu,
  );
  assert.match(
    templateController,
    /^          operation: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.operation \|\| 'reconcile' \}\}$/mu,
  );
  assert.match(
    templateController,
    /^          request_comment_id: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.request_comment_id \|\| github\.event\.comment\.id \}\}$/mu,
  );
  assert.match(
    templateController,
    /^          request_review: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.request_review \|\| false \}\}$/mu,
  );
  assert.match(
    templateController,
    /^          limits_profile: \$\{\{ vars\.CODEX_REVIEW_GATE_LIMITS_PROFILE == 'expanded' && 'expanded' \|\| 'default' \}\}$/mu,
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
