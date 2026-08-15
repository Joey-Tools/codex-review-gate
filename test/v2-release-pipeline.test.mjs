import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = join(repositoryRoot, ".github", "workflows", "sync-action-subtree.yml");
const rootCallerPath = join(
  repositoryRoot,
  ".github",
  "workflows",
  "codex-review-gate.yml",
);
const reconcileWorkflowPath = join(
  repositoryRoot,
  "packages",
  "action",
  ".github",
  "workflows",
  "codex-review-gate-reconcile.yml",
);
const reusableWorkflowPath = join(
  repositoryRoot,
  "packages",
  "action",
  ".github",
  "workflows",
  "codex-review-gate.yml",
);
const releaseRunbookPaths = Object.freeze([
  join(repositoryRoot, "docs", "RELEASING.md"),
  join(repositoryRoot, "docs", "RELEASING.zh-CN.md"),
]);
const releaseScriptPath = join(repositoryRoot, "scripts", "release-action-subtree.sh");
const generatorPath = join(repositoryRoot, "scripts", "generate-action-release-provenance.mjs");
const baselinePath = join(
  repositoryRoot,
  "docs",
  "release",
  "action-v2-repository-baselines.json",
);
const EVIDENCE_AUTHORITY_POLICY_PATH =
  "github-codex-evidence-authority-v2.json";
const SOURCE_PACKAGE_IDENTITY = Object.freeze({
  name: "codex-review-gate-source",
  version: "2.0.0",
  repository: {
    type: "git",
    url: "git+https://github.com/Joey-Tools/codex-review-gate.git",
  },
});
const ACTION_PACKAGE_IDENTITY = Object.freeze({
  name: "codex-review-gate-action",
  version: "2.0.0",
  repository: {
    type: "git",
    url: "git+https://github.com/Joey-Tools/codex-review-gate-action.git",
  },
});
const EXPECTED_V2_RUNTIME_MODULE_PATHS = Object.freeze([
  "src/v2/action.mjs",
  "src/v2/candidate-inventory.mjs",
  "src/v2/control-plane-receipt.mjs",
  "src/v2/effect-status-wal.mjs",
  "src/v2/git-ledger.mjs",
  "src/v2/projection.mjs",
  "src/v2/projector.mjs",
  "src/v2/public-report-projector.mjs",
  "src/v2/public-report.mjs",
  "src/v2/reducer.mjs",
  "src/v2/runner.mjs",
  "src/v2/scheduler.mjs",
  "src/v2/schema.mjs",
  "src/v2/transport.mjs",
  "src/v2/workflow-command.mjs",
  "src/v2/workflow-controller.mjs",
  "src/v2/workflow-preflight.mjs",
]);
const SOURCE_ONLY_REQUIRED_CI_PATHS = Object.freeze([
  ".github/workflows/required-ci.yml",
  ".github/workflows/required-ci-router.yml",
]);
const PRODUCTION_ACTION_REPOSITORY = "Joey-Tools/codex-review-gate-action";
const PRODUCTION_REUSABLE_PATH = ".github/workflows/codex-review-gate.yml";
const PRODUCTION_CHECKOUT_TARGET =
  "actions/checkout@11d5960a326750d5838078e36cf38b85af677262";
const RELEASED_SHA_FIXTURE = "0123456789abcdef0123456789abcdef01234567";
const REUSABLE_WORKFLOW_JOBS = Object.freeze([
  "codex-review-gate",
  "schedule-dispatch",
  "scheduled-pull-requests",
]);
const CONTROLLER_JOBS = Object.freeze([
  "initial",
  "after-public-initial",
  "after-public-post-request",
  "after-public-no-start",
]);
const WAIT_JOBS = Object.freeze([
  Object.freeze({
    name: "public-initial-wait",
    needs: "initial",
    wakeupSource: "initial",
    wakeupHint: "public-initial-wait",
    environment: "codex-review-gate-public-initial-15m",
  }),
  Object.freeze({
    name: "public-post-request-wait",
    needs: "after-public-initial",
    wakeupSource: "after-public-initial",
    wakeupHint: "public-post-request-wait",
    environment: "codex-review-gate-public-post-request-15m",
  }),
  Object.freeze({
    name: "public-no-start-wait",
    needs: "after-public-post-request",
    wakeupSource: "after-public-post-request",
    wakeupHint: "public-no-start-wait",
    environment: "codex-review-gate-public-no-start-15m",
  }),
]);
const REUSABLE_WAIT_ENVIRONMENTS = Object.freeze([
  Object.freeze({
    variable: "V2_PUBLIC_WAIT_ENVIRONMENT_INITIAL",
    value: "codex-review-gate-public-initial-15m",
  }),
  Object.freeze({
    variable: "V2_PUBLIC_WAIT_ENVIRONMENT_POST_REQUEST",
    value: "codex-review-gate-public-post-request-15m",
  }),
  Object.freeze({
    variable: "V2_PUBLIC_WAIT_ENVIRONMENT_NO_START",
    value: "codex-review-gate-public-no-start-15m",
  }),
]);
const FIXTURE_EVIDENCE_AUTHORITY_POLICY = Object.freeze({
  schema: "github-codex-evidence-authority-v2",
  schema_version: 2,
  scope: "release-pipeline-fixture",
});
const testEnvironment = {
  ...process.env,
  CODEX_REVIEW_GATE_RELEASE_PROVENANCE_TEST_ONLY: "1",
  GIT_ASKPASS: "/usr/bin/false",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  NODE_ENV: "test",
};

function git(repo, args, { encoding = "utf8" } = {}) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding,
    env: testEnvironment,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitText(repo, args) {
  return git(repo, args).trim();
}

function initialiseRepository(path, { bare = false } = {}) {
  mkdirSync(path, { recursive: true });
  git(path, bare
    ? ["init", "-q", "--bare"]
    : ["init", "-q", "--initial-branch=master"]);
  if (!bare) {
    git(path, ["config", "user.name", "Release Pipeline Fixture"]);
    git(path, ["config", "user.email", "pipeline-fixture@example.invalid"]);
    git(path, ["config", "commit.gpgSign", "false"]);
    git(path, ["config", "tag.gpgSign", "false"]);
  }
}

function writeText(path, value, mode) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
  if (mode !== undefined) chmodSync(path, mode);
}

function writeJson(path, value) {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function commitAll(repo, message) {
  git(repo, ["add", "--all"]);
  git(repo, ["commit", "-q", "-m", message]);
  return gitText(repo, ["rev-parse", "HEAD"]);
}

function sortedObject(entries) {
  return Object.fromEntries(
    Object.entries(entries).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function compareUtf8Paths(left, right) {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function liveV2RuntimeModulePaths() {
  const runtimeRoot = join(repositoryRoot, "packages", "action", "src", "v2");
  return readdirSync(runtimeRoot, { withFileTypes: true })
    .map((entry) => {
      assert.equal(
        entry.isFile(),
        true,
        `live v2 runtime entry must be a regular file: ${entry.name}`,
      );
      assert.match(
        entry.name,
        /^[a-z0-9]+(?:-[a-z0-9]+)*\.mjs$/u,
        `live v2 runtime entry must have a canonical module name: ${entry.name}`,
      );
      return `src/v2/${entry.name}`;
    })
    .sort(compareUtf8Paths);
}

function workflowJobNames(source) {
  const lines = source.split("\n");
  const jobsIndex = lines.findIndex((line) => line === "jobs:");
  assert.notEqual(jobsIndex, -1, "missing workflow jobs mapping");
  return lines.slice(jobsIndex + 1)
    .flatMap((line) => /^  ([A-Za-z0-9_-]+):\s*$/u.exec(line)?.[1] ?? []);
}

function workflowTriggerNames(source) {
  const match = /^on:\n([\s\S]*?)^permissions:/mu.exec(source);
  assert.ok(match, "missing closed workflow trigger section");
  return [...match[1].matchAll(/^  ([a-z_]+):$/gmu)]
    .map((trigger) => trigger[1]);
}

function workflowJobBlock(source, name) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === `  ${name}:`);
  assert.notEqual(start, -1, `missing workflow job ${name}`);
  let end = start + 1;
  while (end < lines.length && !/^  [A-Za-z0-9_-]+:\s*$/u.test(lines[end])) {
    end += 1;
  }
  return lines.slice(start, end).join("\n");
}

function workflowJobCondition(source, name) {
  const block = workflowJobBlock(source, name);
  const condition = /^    if: >-\n      \$\{\{\n([\s\S]*?)^      \}\}$/mu.exec(block)?.[1];
  assert.ok(condition, `missing closed workflow condition for ${name}`);
  return condition.replace(/\s+/gu, " ").trim();
}

function workflowCallInputBlock(source, name) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === `      ${name}:`);
  assert.notEqual(start, -1, `missing workflow_call input ${name}`);
  let end = start + 1;
  while (end < lines.length && lines[end].startsWith("        ")) {
    end += 1;
  }
  return lines.slice(start, end).join("\n");
}

function assertWorkflowCallInput(source, name, expected) {
  const block = workflowCallInputBlock(source, name);
  const fields = Object.fromEntries(
    block.split("\n").slice(1).map((line) => {
      const match = /^        ([a-z-]+): (.*)$/u.exec(line);
      assert.ok(match, `malformed workflow_call input field for ${name}`);
      return [match[1], match[2]];
    }),
  );
  assert.deepEqual(Object.keys(fields), [
    "description",
    "required",
    "type",
    ...(Object.hasOwn(expected, "default") ? ["default"] : []),
  ]);
  assert.equal(fields.required, expected.required);
  assert.equal(fields.type, expected.type);
  if (Object.hasOwn(expected, "default")) {
    assert.equal(fields.default, expected.default);
  }
}

function assertExactOccurrence(source, value, label) {
  assert.equal(
    source.split(value).length - 1,
    1,
    `${label} must occur exactly once`,
  );
}

function assertReusableWorkflowContract(reusable) {
  assert.deepEqual(workflowJobNames(reusable), REUSABLE_WORKFLOW_JOBS);
  const specs = [
    {
      name: "codex-review-gate",
      jobIf: "    if: inputs.controller-mode != 'scan-all-open'",
      timeout: "5",
      route: "${{ inputs.controller-mode }}",
      observationBoundary: "${{ inputs.observation-boundary }}",
      pullRequest: "${{ inputs.pull-request }}",
      dispatchBinding: '""',
      matrixGateCount: 0,
    },
    {
      name: "schedule-dispatch",
      jobIf: "    if: inputs.controller-mode == 'scan-all-open'",
      timeout: "15",
      route: "scan-all-open",
      observationBoundary: "initial",
      pullRequest: '""',
      dispatchBinding: '""',
      matrixGateCount: 0,
    },
    {
      name: "scheduled-pull-requests",
      jobIf: "    if: inputs.controller-mode == 'scan-all-open'",
      timeout: "5",
      route: "ordinary",
      observationBoundary: "initial",
      pullRequest: "${{ matrix.pull_request }}",
      dispatchBinding: "${{ matrix.dispatch_binding }}",
      matrixGateCount: 2,
    },
  ];

  for (const spec of specs) {
    const block = workflowJobBlock(reusable, spec.name);
    assertExactOccurrence(block, spec.jobIf, `${spec.name} route gate`);
    assertExactOccurrence(
      block,
      "    runs-on: ubuntu-slim",
      `${spec.name} runner`,
    );
    assertExactOccurrence(
      block,
      `    timeout-minutes: ${spec.timeout}`,
      `${spec.name} timeout`,
    );
    assertExactOccurrence(
      block,
      "      - name: Check out exact called-workflow release",
      `${spec.name} checkout step`,
    );
    assertExactOccurrence(
      block,
      `        uses: ${PRODUCTION_CHECKOUT_TARGET}`,
      `${spec.name} checkout action`,
    );
    assertExactOccurrence(
      block,
      "          repository: ${{ job.workflow_repository }}",
      `${spec.name} checkout repository`,
    );
    assertExactOccurrence(
      block,
      "          ref: ${{ job.workflow_sha }}",
      `${spec.name} checkout ref`,
    );
    assertExactOccurrence(
      block,
      "          path: .codex-review-gate-action",
      `${spec.name} checkout path`,
    );
    assertExactOccurrence(
      block,
      "          persist-credentials: false",
      `${spec.name} checkout credentials`,
    );
    assertExactOccurrence(
      block,
      "          V2_STATUS_CONTEXT: codex/github-review-gate",
      `${spec.name} status context`,
    );
    assertExactOccurrence(
      block,
      `          V2_CONTROLLER_ROUTE: ${spec.route}`,
      `${spec.name} controller route`,
    );
    assertExactOccurrence(
      block,
      `          V2_CONTROLLER_OBSERVATION_BOUNDARY: ${spec.observationBoundary}`,
      `${spec.name} observation boundary`,
    );
    assertExactOccurrence(
      block,
      `          V2_CONTROLLER_PULL_REQUEST: ${spec.pullRequest}`,
      `${spec.name} pull-request binding`,
    );
    assertExactOccurrence(
      block,
      `          V2_CONTROLLER_DISPATCH_BINDING: ${spec.dispatchBinding}`,
      `${spec.name} dispatch binding`,
    );
    assertExactOccurrence(
      block,
      '          V2_PUBLIC_WAIT_MINUTES: "15"',
      `${spec.name} public wait duration`,
    );
    for (const wait of REUSABLE_WAIT_ENVIRONMENTS) {
      assertExactOccurrence(
        block,
        `          ${wait.variable}: ${wait.value}`,
        `${spec.name} ${wait.value}`,
      );
    }
    assertExactOccurrence(
      block,
      '          test "$V2_CHECKED_OUT_RELEASE_SHA" = "$V2_EXPECTED_WORKFLOW_SHA"',
      `${spec.name} checked-out release verification`,
    );
    assert.equal(
      (block.match(/^        if: matrix\.enabled$/gmu) ?? []).length,
      spec.matrixGateCount,
      `${spec.name} must retain its exact matrix step gates`,
    );
  }

  const coordinator = workflowJobBlock(reusable, "schedule-dispatch");
  assertExactOccurrence(
    coordinator,
    "      matrix: ${{ steps.controller.outputs.matrix }}",
    "schedule coordinator matrix output",
  );
  assertExactOccurrence(
    coordinator,
    '          node "$GITHUB_WORKSPACE/.codex-review-gate-action/src/v2/workflow-controller.mjs" schedule-dispatch',
    "schedule coordinator command",
  );

  const scheduled = workflowJobBlock(reusable, "scheduled-pull-requests");
  assertExactOccurrence(
    scheduled,
    "    needs: schedule-dispatch",
    "scheduled fanout dependency",
  );
  assertExactOccurrence(
    scheduled,
    `    strategy:
      fail-fast: false
      max-parallel: 1
      matrix: \${{ fromJSON(needs.schedule-dispatch.outputs.matrix) }}`,
    "scheduled serial matrix topology",
  );
}

function renderProductionConsumer({
  repository = PRODUCTION_ACTION_REPOSITORY,
  selector = RELEASED_SHA_FIXTURE,
} = {}) {
  const template = readFileSync(reconcileWorkflowPath, "utf8");
  const localUse = "    uses: ./.github/workflows/codex-review-gate.yml";
  assert.equal(
    template.split(localUse).length - 1,
    CONTROLLER_JOBS.length,
    "released reconcile template must expose exactly four local controller calls",
  );
  return template.replaceAll(
    localUse,
    `    uses: ${repository}/${PRODUCTION_REUSABLE_PATH}@${selector}`,
  );
}

function assertProductionConsumerActivationContract({
  consumer,
  releasedSha,
  reusable = readFileSync(reusableWorkflowPath, "utf8"),
}) {
  assert.match(releasedSha, /^[0-9a-f]{40}$/u);
  const expectedUse = `${PRODUCTION_ACTION_REPOSITORY}/${PRODUCTION_REUSABLE_PATH}@${releasedSha}`;
  const useTargets = [...consumer.matchAll(/^    uses: (\S+)$/gmu)]
    .map((match) => match[1]);
  assert.deepEqual(
    useTargets,
    Array.from({ length: CONTROLLER_JOBS.length }, () => expectedUse),
    "every production controller call must use the same admitted release SHA",
  );
  assert.doesNotMatch(consumer, /JoeyTeng\/codex-review-gate-action/u);
  assert.doesNotMatch(consumer, /^    uses: \.\//gmu);

  assert.deepEqual(workflowJobNames(consumer), [
    "initial",
    "public-initial-wait",
    "after-public-initial",
    "public-post-request-wait",
    "after-public-post-request",
    "public-no-start-wait",
    "after-public-no-start",
  ]);
  assert.deepEqual(workflowTriggerNames(consumer), [
    "pull_request_target",
    "issue_comment",
    "pull_request_review",
    "pull_request_review_comment",
    "schedule",
    "workflow_dispatch",
  ]);
  assert.match(
    consumer,
    /^  pull_request_target:\n    types: \[opened, reopened, synchronize, ready_for_review\]$/mu,
  );
  assert.match(consumer, /^  issue_comment:\n    types: \[created, edited\]$/mu);
  assert.match(
    consumer,
    /^  pull_request_review:\n    types: \[submitted, edited, dismissed\]$/mu,
  );
  assert.match(
    consumer,
    /^  pull_request_review_comment:\n    types: \[created, edited, deleted\]$/mu,
  );
  assert.match(consumer, /^permissions: \{\}$/mu);
  assert.equal((consumer.match(/^permissions:/gmu) ?? []).length, 1);
  assert.match(consumer, /cron: "17 \*\/2 \* \* \*"/u);
  assert.match(
    consumer,
    /^  group: codex-review-gate-v2-\$\{\{ github\.repository \}\}$/mu,
  );
  assert.match(consumer, /^  cancel-in-progress: false$/mu);
  assert.match(
    consumer,
    /^      pull-request:\n        description: [^\n]+\n        required: true\n        type: string$/mu,
  );

  const exactControllerPermissions = [
    "    permissions:",
    "      contents: write",
    "      id-token: write",
    "      issues: write",
    "      pull-requests: write",
    "      statuses: write",
  ].join("\n");
  const pullRequestInput = "      pull-request: ${{ github.event.pull_request.number || github.event.issue.number || inputs.pull-request || '' }}";
  assert.equal(consumer.split(pullRequestInput).length - 1, CONTROLLER_JOBS.length);
  assert.equal(
    (consumer.match(/^      selection-policy: joey-default$/gmu) ?? []).length,
    CONTROLLER_JOBS.length,
  );
  const controllerBoundaries = new Map([
    ["initial", "initial"],
    ["after-public-initial", "public-initial-wait-complete"],
    ["after-public-post-request", "public-post-request-wait-complete"],
    ["after-public-no-start", "public-no-start-wait-complete"],
  ]);
  const controllerDependencies = new Map([
    ["initial", null],
    ["after-public-initial", "public-initial-wait"],
    ["after-public-post-request", "public-post-request-wait"],
    ["after-public-no-start", "public-no-start-wait"],
  ]);
  const initialRoute = "      controller-mode: ${{ github.event_name == 'workflow_dispatch' && 'evaluate-only' || github.event_name == 'schedule' && 'scan-all-open' || (github.event_name == 'issue_comment' || github.event_name == 'pull_request_review' || github.event_name == 'pull_request_review_comment') && 'provider-event-hint' || 'ordinary' }}";
  for (const name of CONTROLLER_JOBS) {
    const block = workflowJobBlock(consumer, name);
    assert.ok(
      block.includes(`${exactControllerPermissions}\n    uses: ${expectedUse}\n    with:`),
      `${name} must retain the exact controller permissions and immutable use`,
    );
    assert.equal(block.split(pullRequestInput).length - 1, 1);
    assert.equal((block.match(/^      selection-policy: joey-default$/gmu) ?? []).length, 1);
    const withSection = /\n    with:\n([\s\S]*)$/u.exec(block)?.[1];
    assert.ok(withSection, `${name} must expose one closed with mapping`);
    assert.deepEqual(
      [...withSection.matchAll(/^      ([a-z][a-z-]*): /gmu)]
        .map((match) => match[1]),
      ["pull-request", "selection-policy", "controller-mode", "observation-boundary"],
    );
    assert.doesNotMatch(block, /^    secrets:/gmu);
    if (name === "initial") {
      assert.equal(block.split(initialRoute).length - 1, 1);
      assert.doesNotMatch(block, /^    needs:/gmu);
    } else {
      assert.equal(
        (block.match(new RegExp(
          `^    needs: ${controllerDependencies.get(name)}$`,
          "mu",
        )) ?? []).length,
        1,
      );
      assert.equal((block.match(/^      controller-mode: ordinary$/gmu) ?? []).length, 1);
    }
    assert.equal(
      (block.match(new RegExp(
        `^      observation-boundary: ${controllerBoundaries.get(name)}$`,
        "mu",
      )) ?? []).length,
      1,
    );
  }

  for (const wait of WAIT_JOBS) {
    const block = workflowJobBlock(consumer, wait.name);
    assert.match(block, new RegExp(`^    needs: ${wait.needs}$`, "mu"));
    assert.ok(block.includes(
      "    if: ${{ needs." + wait.wakeupSource
      + ".outputs.wakeup-hints == '" + wait.wakeupHint + "' }}",
    ));
    assert.equal((block.match(/^    permissions: \{\}$/gmu) ?? []).length, 1);
    assert.equal((block.match(/^    runs-on: ubuntu-slim$/gmu) ?? []).length, 1);
    assert.equal((block.match(/^    timeout-minutes: 5$/gmu) ?? []).length, 1);
    assert.ok(block.includes(
      `    environment:\n      name: ${wait.environment}\n      deployment: false`,
    ));
    assert.doesNotMatch(block, /^\s+uses:|^\s+secrets:/gmu);
  }

  assertWorkflowCallInput(reusable, "pull-request", {
    required: "false",
    type: "string",
    default: "\"\"",
  });
  assertWorkflowCallInput(reusable, "selection-policy", {
    required: "true",
    type: "string",
  });
  assertWorkflowCallInput(reusable, "controller-mode", {
    required: "false",
    type: "string",
    default: "ordinary",
  });
  assertWorkflowCallInput(reusable, "observation-boundary", {
    required: "false",
    type: "string",
    default: "initial",
  });
  const inputSection = /^    inputs:\n([\s\S]*?)^    outputs:$/mu.exec(reusable)?.[1];
  assert.ok(inputSection, "reusable workflow must expose a closed input section");
  assert.deepEqual(
    [...inputSection.matchAll(/^      ([a-z][a-z-]*):$/gmu)]
      .map((match) => match[1]),
    ["pull-request", "selection-policy", "controller-mode", "observation-boundary"],
  );
  assert.match(
    reusable,
    /^permissions:\n  contents: write\n  id-token: write\n  issues: write\n  pull-requests: write\n  statuses: write\n\njobs:$/mu,
  );
  assertReusableWorkflowContract(reusable);
}

function writeV2ActionTree(sourceRepo) {
  const actionRoot = join(sourceRepo, "packages", "action");
  writeJson(join(sourceRepo, "package.json"), {
    ...SOURCE_PACKAGE_IDENTITY,
    private: true,
    type: "module",
  });
  writeText(
    join(actionRoot, "action.yml"),
    `name: Codex Review Gate v2 Plan Adapter
runs:
  using: composite
  steps:
    - shell: bash
      run: node "$GITHUB_ACTION_PATH/src/v2/action.mjs"
`,
  );
  writeText(
    join(actionRoot, ".github", "workflows", "codex-review-gate.yml"),
    `name: Codex Review Gate v2
on:
  workflow_call:
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - run: node "$GITHUB_WORKSPACE/.codex-review-gate-action/src/v2/workflow-controller.mjs" run
`,
  );
  writeText(
    join(actionRoot, ".github", "workflows", "codex-review-gate-reconcile.yml"),
    `name: Codex Review Gate v2 Reconcile
on:
  workflow_dispatch:
jobs:
  reconcile:
    uses: ./.github/workflows/codex-review-gate.yml
`,
  );
  writeJson(join(actionRoot, "package.json"), {
    ...ACTION_PACKAGE_IDENTITY,
    type: "module",
  });
  for (const path of EXPECTED_V2_RUNTIME_MODULE_PATHS) {
    writeText(
      join(actionRoot, path),
      `export const moduleName = ${JSON.stringify(path)};\n`,
    );
  }
  writeJson(
    join(actionRoot, EVIDENCE_AUTHORITY_POLICY_PATH),
    FIXTURE_EVIDENCE_AUTHORITY_POLICY,
  );
  writeText(join(actionRoot, "src", "core.mjs"), "export const retainedCore = true;\n");
  writeText(join(actionRoot, "src", "gate.mjs"), "export const retainedGate = true;\n");
  for (const path of SOURCE_ONLY_REQUIRED_CI_PATHS) {
    writeText(join(sourceRepo, path), "name: Source-only required CI fixture\n");
  }
}

function createPipelineFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "v2-release-pipeline-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourceRepo = join(root, "source");
  const archiveRepo = join(root, "archive");
  const targetRepo = join(root, "target.git");
  const frozenRepo = join(root, "frozen.git");
  initialiseRepository(sourceRepo);

  for (let index = 1; index <= 14; index += 1) {
    writeText(join(sourceRepo, "packages", "action", "history.txt"), `${index}\n`);
    writeText(join(sourceRepo, "source-history.txt"), `${index}\n`);
    commitAll(sourceRepo, `source action history ${index}`);
  }
  const baselineSourceCommit = gitText(sourceRepo, ["rev-parse", "HEAD"]);
  const baselineMaster = gitText(sourceRepo, [
    "subtree",
    "split",
    "--prefix=packages/action",
    baselineSourceCommit,
  ]);
  const firstRootCommits = gitText(sourceRepo, ["rev-list", "--reverse", baselineMaster]).split("\n");
  assert.equal(firstRootCommits.length, 14);
  const preSubtree = firstRootCommits[7];

  initialiseRepository(archiveRepo);
  let archiveHead;
  for (let index = 1; index <= 7; index += 1) {
    writeText(join(archiveRepo, "archive.txt"), `${index}\n`);
    archiveHead = commitAll(archiveRepo, `archive ${index}`);
  }

  initialiseRepository(targetRepo, { bare: true });
  initialiseRepository(frozenRepo, { bare: true });
  git(sourceRepo, ["push", "-q", targetRepo,
    `${baselineMaster}:refs/heads/master`,
    `${preSubtree}:refs/heads/pre-subtree-master-2026-05-18`,
  ]);
  git(archiveRepo, ["push", "-q", targetRepo,
    `${archiveHead}:refs/heads/archive/pre-subtree-release-candidate-2026-05-16`,
  ]);
  git(sourceRepo, ["push", "-q", frozenRepo, `${baselineMaster}:refs/heads/master`]);

  const fixtureBaselinePath = join(sourceRepo, "docs", "release", "action-v2-repository-baselines.json");
  const frozenRefs = sortedObject({
    "refs/heads/master": baselineMaster,
  });
  const targetRefs = sortedObject({
    "refs/heads/archive/pre-subtree-release-candidate-2026-05-16": archiveHead,
    "refs/heads/master": baselineMaster,
    "refs/heads/pre-subtree-master-2026-05-18": preSubtree,
  });
  const baselineTree = gitText(sourceRepo, ["rev-parse", `${baselineMaster}^{tree}`]);
  writeJson(fixtureBaselinePath, {
    $schema: "urn:joey-tools:codex-review-gate:action-v2-repository-baselines:1",
    schema_version: 1,
    frozen_repository: {
      repository: "JoeyTeng/codex-review-gate-action",
      url: frozenRepo,
      default_branch: "master",
      default_commit_oid: baselineMaster,
      default_tree_oid: baselineTree,
      refs: frozenRefs,
    },
    target_repository: {
      repository: "Joey-Tools/codex-review-gate-action",
      url: targetRepo,
      default_branch: "master",
      default_commit_oid: baselineMaster,
      default_tree_oid: baselineTree,
      head_commit_count: 21,
      head_root_count: 2,
      refs: targetRefs,
    },
    release: {
      version: "2.0.0",
      immutable_tag: "v2.0.0",
      aliases: ["v2.0", "v2"],
    },
  });
  mkdirSync(join(sourceRepo, "scripts"), { recursive: true });
  copyFileSync(releaseScriptPath, join(sourceRepo, "scripts", "release-action-subtree.sh"));
  copyFileSync(generatorPath, join(sourceRepo, "scripts", "generate-action-release-provenance.mjs"));
  chmodSync(join(sourceRepo, "scripts", "release-action-subtree.sh"), 0o755);
  writeV2ActionTree(sourceRepo);
  const sourceCommit = commitAll(sourceRepo, "prepare v2.0.0 release");
  return {
    root,
    sourceRepo,
    sourceCommit,
    targetRepo,
    frozenRepo,
    baselinePath: fixtureBaselinePath,
    frozenRefsBefore: gitText(frozenRepo, ["for-each-ref", "--format=%(objectname) %(refname)"]),
  };
}

function runRelease(fixture, output) {
  return spawnSync(
    join(fixture.sourceRepo, "scripts", "release-action-subtree.sh"),
    [
      "--publish",
      "--source-ref",
      fixture.sourceCommit,
      "--output",
      output,
      "--test-target-url",
      fixture.targetRepo,
      "--test-frozen-url",
      fixture.frozenRepo,
      "--test-baseline",
      fixture.baselinePath,
      "--test-skip-checks",
      "--test-skip-signatures",
    ],
    {
      cwd: fixture.sourceRepo,
      encoding: "utf8",
      env: testEnvironment,
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120_000,
    },
  );
}

test("workflow exposes only a manual, environment-gated HTTPS v2 publish interface", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  assert.match(workflow, /github\.repository == 'Joey-Tools\/codex-review-gate'/);
  assert.match(workflow, /publish_v2:/);
  assert.match(
    workflow,
    /github\.event_name != 'workflow_dispatch' \|\| !inputs\.publish_v2/,
  );
  assert.match(workflow, /environment: action-v2-release/);
  assert.match(workflow, /ACTION_REPO_PUSH_TOKEN_V2/);
  assert.match(workflow, /ACTION_RELEASE_SIGNING_PRIVATE_KEY_V2/);
  assert.match(workflow, /ACTION_RELEASE_SIGNING_FINGERPRINT_V2/);
  assert.match(
    workflow,
    /http\.https:\/\/github\.com\/Joey-Tools\/codex-review-gate-action\.git\.extraheader/,
  );
  assert.match(workflow, /--publish/);
  assert.match(workflow, /--check/);
  assert.equal(
    (workflow.match(/EXPECTED_SOURCE_COMMIT: \$\{\{ github\.sha \}\}/g) ?? []).length,
    2,
  );
  assert.doesNotMatch(workflow, /JoeyTeng\/codex-review-gate-action/);
  assert.doesNotMatch(workflow, /ACTION_REPO_DEPLOY_KEY|ACTION_REPO_PUSH_TOKEN(?!_V2)/);
  assert.doesNotMatch(workflow, /ssh-keyscan|GIT_SSH_COMMAND|git@github\.com/);
  assert.doesNotMatch(workflow, /force-with-lease|push --force/);
  assert.doesNotMatch(workflow, /^    needs: validate$/mu);
  assert.match(workflow, /persist-credentials: false/g);
});

test("invalid manual publish requests fail instead of producing an empty green run", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  assert.deepEqual(workflowJobNames(workflow), [
    "reject-invalid-publish",
    "validate",
    "publish",
  ]);
  const reject = workflowJobBlock(workflow, "reject-invalid-publish");
  assert.match(reject, /^    name: Reject invalid v2 publication request$/mu);
  assert.match(reject, /github\.event_name == 'workflow_dispatch'/u);
  assert.match(reject, /inputs\.publish_v2/u);
  assert.match(
    reject,
    /github\.repository != 'Joey-Tools\/codex-review-gate' \|\|\n\s+github\.ref != 'refs\/heads\/master'/u,
  );
  assert.match(reject, /^    permissions: \{\}$/mu);
  assert.match(reject, /^    runs-on: ubuntu-latest$/mu);
  assert.match(reject, /^          exit 1$/mu);
  assert.doesNotMatch(reject, /continue-on-error|actions\/checkout|ACTION_REPO_PUSH_TOKEN/u);
  assert.equal(
    workflowJobCondition(workflow, "reject-invalid-publish"),
    "github.event_name == 'workflow_dispatch' && inputs.publish_v2 && ( github.repository != 'Joey-Tools/codex-review-gate' || github.ref != 'refs/heads/master' )",
  );

  const validate = workflowJobBlock(workflow, "validate");
  assert.match(
    validate,
    /github\.event_name != 'workflow_dispatch' \|\| !inputs\.publish_v2/u,
  );
  assert.doesNotMatch(validate, /github\.ref == 'refs\/heads\/master'/u);
  assert.equal(
    workflowJobCondition(workflow, "validate"),
    "github.repository == 'Joey-Tools/codex-review-gate' && (github.event_name != 'workflow_dispatch' || !inputs.publish_v2)",
  );

  const publish = workflowJobBlock(workflow, "publish");
  assert.match(publish, /github\.event_name == 'workflow_dispatch'/u);
  assert.match(publish, /inputs\.publish_v2/u);
  assert.match(publish, /github\.repository == 'Joey-Tools\/codex-review-gate'/u);
  assert.match(publish, /github\.ref == 'refs\/heads\/master'/u);
  assert.equal(
    workflowJobCondition(workflow, "publish"),
    "github.event_name == 'workflow_dispatch' && inputs.publish_v2 && github.repository == 'Joey-Tools/codex-review-gate' && github.ref == 'refs/heads/master'",
  );
});

test("master validation runs when the root release package identity changes", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  const pushPaths = /^    paths:\n((?:      - [^\n]+\n)+)/mu.exec(workflow)?.[1];
  assert.ok(pushPaths, "release workflow must expose a master push path filter");
  const paths = pushPaths.trim().split("\n")
    .map((line) => line.replace(/^\s*- /u, ""));
  assert.deepEqual(paths, [
    ".github/workflows/sync-action-subtree.yml",
    "package.json",
    "packages/action/**",
    "scripts/generate-action-release-provenance.mjs",
    "scripts/release-action-subtree.sh",
    "docs/release/action-v2-repository-baselines.json",
  ]);
});

test("publication preserves the v1 root caller until a separate activation", () => {
  const rootCaller = readFileSync(rootCallerPath, "utf8");
  assert.equal(
    (rootCaller.match(
      /^    uses: JoeyTeng\/codex-review-gate-action\/\.github\/workflows\/codex-review-gate\.yml@v1$/gmu,
    ) ?? []).length,
    1,
  );
  assert.doesNotMatch(
    rootCaller,
    /Joey-Tools\/codex-review-gate-action|@(?:[0-9a-f]{40}|v2[^\s]*)/u,
  );

  for (const path of releaseRunbookPaths) {
    const runbook = readFileSync(path, "utf8");
    assert.match(runbook, /publication.*activation|Publication.*activation/su);
    assert.match(
      runbook,
      /JoeyTeng\/codex-review-gate-action\/\.github\/workflows\/codex-review-gate\.yml@v1/u,
    );
    assert.match(runbook, /RELEASE_SHA/u);
    assert.match(runbook, /\^\[0-9a-f\]\{40\}\$/u);
    assert.match(runbook, /live canary/iu);
    assert.match(runbook, /codex\/github-review-gate/u);
    assert.match(runbook, /rollback/iu);
    assert.match(runbook, /required-context ruleset\/branch-protection switch/u);
    for (const { environment } of WAIT_JOBS) {
      assert.match(runbook, new RegExp(environment, "u"));
    }
  }

  const english = readFileSync(releaseRunbookPaths[0], "utf8").replace(/\s+/gu, " ");
  const englishForward = [
    "Keep the legacy v1 caller enabled and keep its recorded required context",
    "Add `codex/github-review-gate` to the required contexts",
    "before removing the recorded legacy v1 required context",
    "Retire the legacy caller only after the rollback window closes",
  ].map((value) => english.indexOf(value));
  assert.ok(englishForward.every((index) => index >= 0));
  assert.deepEqual(englishForward, [...englishForward].sort((left, right) => left - right));
  assert.match(
    english,
    /Rollback uses the inverse authority order: first restore or retain the legacy v1 caller, then re-add and prove its required context, then remove the v2 required context, and only then disable or remove the v2 consumer graph\./u,
  );

  const chinese = readFileSync(releaseRunbookPaths[1], "utf8").replace(/\s+/gu, " ");
  const chineseForward = [
    "保持 legacy v1 caller enabled，并在 branch protection 中保留其已记录 required context",
    "先把 `codex/github-review-gate` 加入 required contexts",
    "再移除已记录 legacy v1 required context",
    "只有 rollback window 关闭后，才能退役 legacy caller",
  ].map((value) => chinese.indexOf(value));
  assert.ok(chineseForward.every((index) => index >= 0));
  assert.deepEqual(chineseForward, [...chineseForward].sort((left, right) => left - right));
  assert.match(
    chinese,
    /Rollback 必须使用相反的 authority order：先恢复或保留 legacy v1 caller，再重新加入\s+并证明它的 required context，然后移除 v2 required context，最后才 disable\/remove v2 consumer graph。/u,
  );
});

test("production activation accepts only the admitted exact release SHA", () => {
  assert.doesNotThrow(() => assertProductionConsumerActivationContract({
    consumer: renderProductionConsumer(),
    releasedSha: RELEASED_SHA_FIXTURE,
  }));

  const rejected = [
    {
      name: "personal repository at the exact SHA",
      repository: "JoeyTeng/codex-review-gate-action",
      selector: RELEASED_SHA_FIXTURE,
    },
    { name: "legacy major", selector: "v1" },
    { name: "v2 major", selector: "v2" },
    { name: "v2 minor", selector: "v2.0" },
    { name: "v2 immutable tag", selector: "v2.0.0" },
    { name: "default branch", selector: "master" },
    { name: "heads ref", selector: "refs/heads/master" },
    { name: "tags ref", selector: "refs/tags/v2.0.0" },
    { name: "short SHA", selector: RELEASED_SHA_FIXTURE.slice(0, 12) },
    { name: "upper-case SHA", selector: RELEASED_SHA_FIXTURE.toUpperCase() },
    { name: "digest selector", selector: `sha256:${RELEASED_SHA_FIXTURE}` },
    { name: "expression selector", selector: "${{ inputs.release-sha }}" },
    { name: "different full SHA", selector: "f".repeat(40) },
  ];
  for (const candidate of rejected) {
    assert.throws(
      () => assertProductionConsumerActivationContract({
        consumer: renderProductionConsumer(candidate),
        releasedSha: RELEASED_SHA_FIXTURE,
      }),
      undefined,
      candidate.name,
    );
  }
});

test("production activation locks the complete reconcile graph and reusable contract", () => {
  const consumer = renderProductionConsumer();
  assertProductionConsumerActivationContract({
    consumer,
    releasedSha: RELEASED_SHA_FIXTURE,
  });

  const mutations = [
    ["missing controller", workflowJobBlock(consumer, "after-public-no-start"), ""],
    ["wrong permission", "      statuses: write", "      statuses: read"],
    ["wrong selection policy", "      selection-policy: joey-default", "      selection-policy: arbitrary"],
    ["wrong schedule", '    - cron: "17 */2 * * *"', '    - cron: "*/5 * * * *"'],
    ["wrong concurrency", "  group: codex-review-gate-v2-${{ github.repository }}", "  group: codex-review-gate-v2-${{ github.repository }}-${{ github.event.pull_request.number }}"],
    ["cancel enabled", "  cancel-in-progress: false", "  cancel-in-progress: true"],
    ["wrong wait environment", "codex-review-gate-public-initial-15m", "codex-review-gate-public-initial-10m"],
    ["credentialed wait", "    permissions: {}", "    permissions:\n      contents: read"],
    ["wrong wait dependency", "    needs: public-initial-wait", "    needs: initial"],
    ["action-backed wait", '        run: ":"', "        uses: actions/checkout@v4"],
    ["wrong observation boundary", "      observation-boundary: public-post-request-wait-complete", "      observation-boundary: initial"],
  ];
  for (const [name, before, after] of mutations) {
    assert.ok(consumer.includes(before), `${name} mutation fixture must exist`);
    assert.throws(
      () => assertProductionConsumerActivationContract({
        consumer: consumer.replace(before, after),
        releasedSha: RELEASED_SHA_FIXTURE,
      }),
      undefined,
      name,
    );
  }

  const reusable = readFileSync(reusableWorkflowPath, "utf8");
  for (const [name, before, after] of [
    ["wrong status context", "V2_STATUS_CONTEXT: codex/github-review-gate", "V2_STATUS_CONTEXT: codex/review-gate"],
    ["wrong wait duration", 'V2_PUBLIC_WAIT_MINUTES: "15"', 'V2_PUBLIC_WAIT_MINUTES: "10"'],
    ["optional selection policy", "        required: true\n        type: string\n      controller-mode:", "        required: false\n        type: string\n      controller-mode:"],
    ["missing status permission", "  statuses: write", "  statuses: read"],
    ["mutable checkout ref", "ref: ${{ job.workflow_sha }}", "ref: v2"],
    [
      "ordinary dispatch binding",
      "V2_CONTROLLER_PULL_REQUEST: ${{ inputs.pull-request }}\n          V2_CONTROLLER_DISPATCH_BINDING: \"\"",
      "V2_CONTROLLER_PULL_REQUEST: ${{ inputs.pull-request }}\n          V2_CONTROLLER_DISPATCH_BINDING: ${{ inputs.pull-request }}",
    ],
    [
      "coordinator dispatch binding",
      "V2_CONTROLLER_ROUTE: scan-all-open\n          V2_CONTROLLER_OBSERVATION_BOUNDARY: initial\n          V2_CONTROLLER_PULL_REQUEST: \"\"\n          V2_CONTROLLER_DISPATCH_BINDING: \"\"",
      "V2_CONTROLLER_ROUTE: scan-all-open\n          V2_CONTROLLER_OBSERVATION_BOUNDARY: initial\n          V2_CONTROLLER_PULL_REQUEST: \"\"\n          V2_CONTROLLER_DISPATCH_BINDING: ${{ inputs.pull-request }}",
    ],
    [
      "scheduled raw dispatch binding",
      "V2_CONTROLLER_PULL_REQUEST: ${{ matrix.pull_request }}\n          V2_CONTROLLER_DISPATCH_BINDING: ${{ matrix.dispatch_binding }}",
      "V2_CONTROLLER_PULL_REQUEST: ${{ matrix.pull_request }}\n          V2_CONTROLLER_DISPATCH_BINDING: ${{ toJSON(matrix.dispatch_binding) }}",
    ],
    [
      "scheduled raw pull request",
      "V2_CONTROLLER_PULL_REQUEST: ${{ matrix.pull_request }}",
      "V2_CONTROLLER_PULL_REQUEST: ${{ toJSON(matrix.pull_request) }}",
    ],
    ["parallel scheduled fanout", "      max-parallel: 1", "      max-parallel: 2"],
    ["fail-fast scheduled fanout", "      fail-fast: false", "      fail-fast: true"],
    [
      "caller-selected scheduled matrix",
      "      matrix: ${{ fromJSON(needs.schedule-dispatch.outputs.matrix) }}",
      "      matrix: ${{ fromJSON(inputs.matrix) }}",
    ],
    [
      "ungated scheduled checkout",
      "      - name: Check out exact called-workflow release\n        if: matrix.enabled",
      "      - name: Check out exact called-workflow release\n        if: always()",
    ],
  ]) {
    assert.ok(reusable.includes(before), `${name} mutation fixture must exist`);
    assert.throws(
      () => assertProductionConsumerActivationContract({
        consumer,
        releasedSha: RELEASED_SHA_FIXTURE,
        reusable: reusable.replace(before, after),
      }),
      undefined,
      name,
    );
  }
});

test("release fixture locks every live v2 runtime module in byte order", () => {
  assert.deepEqual(
    liveV2RuntimeModulePaths(),
    EXPECTED_V2_RUNTIME_MODULE_PATHS,
  );
  for (const path of SOURCE_ONLY_REQUIRED_CI_PATHS) {
    assert.equal(
      existsSync(join(repositoryRoot, "packages", "action", path)),
      false,
      `${path} must remain outside the released action subtree`,
    );
  }
  for (const [path, expected] of [
    [join(repositoryRoot, "package.json"), SOURCE_PACKAGE_IDENTITY],
    [join(repositoryRoot, "packages", "action", "package.json"), ACTION_PACKAGE_IDENTITY],
  ]) {
    const actual = JSON.parse(readFileSync(path, "utf8"));
    assert.deepEqual(
      {
        name: actual.name,
        version: actual.version,
        repository: actual.repository,
      },
      expected,
    );
  }
});

test("release script has one fixed writable target and a read-only frozen repository", () => {
  const script = readFileSync(releaseScriptPath, "utf8");
  assert.match(script, /TARGET_REPOSITORY_URL="https:\/\/github\.com\/Joey-Tools\/codex-review-gate-action\.git"/);
  assert.match(script, /FROZEN_REPOSITORY_URL="https:\/\/github\.com\/JoeyTeng\/codex-review-gate-action\.git"/);
  assert.match(script, /git -C "\$stage_repo" push --atomic "\$target_url"/);
  assert.doesNotMatch(script, /push[^\n]*\$frozen_url|push[^\n]*FROZEN_REPOSITORY/);
  assert.doesNotMatch(script, /--force(?:-with-lease)?/);
  assert.doesNotMatch(script, /ACTION_REPO_DEPLOY_KEY|ACTION_REPO_PUSH_TOKEN(?!_V2)/);
  assert.match(script, /v2\.0\.0:refs\/tags\/v2\.0\.0/);
  assert.match(script, /v2\.0:refs\/tags\/v2\.0/);
  assert.match(script, /v2:refs\/tags\/v2/);
});

test("pipeline publishes one complete v2 DAG atomically and reruns idempotently", (t) => {
  const fixture = createPipelineFixture(t);
  const firstOutput = join(fixture.root, "v2.0.0-provenance.json");
  const first = runRelease(fixture, firstOutput);
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
  const firstManifest = JSON.parse(readFileSync(firstOutput, "utf8"));
  const remoteMaster = gitText(fixture.targetRepo, ["rev-parse", "refs/heads/master"]);
  assert.equal(firstManifest.action.commit_oid, remoteMaster);
  const sourcePackageBytes = readFileSync(
    join(fixture.sourceRepo, "package.json"),
  );
  assert.deepEqual(firstManifest.source.package_identity, {
    role: "v2-source-package",
    path: "package.json",
    object_oid: gitText(fixture.sourceRepo, [
      "rev-parse",
      `${fixture.sourceCommit}:package.json`,
    ]),
    sha256: createHash("sha256").update(sourcePackageBytes).digest("hex"),
    name: SOURCE_PACKAGE_IDENTITY.name,
    version: SOURCE_PACKAGE_IDENTITY.version,
    repository_url: SOURCE_PACKAGE_IDENTITY.repository.url,
  });
  assert.equal(firstManifest.history.transferred_initial_heads.commit_count, 21);
  assert.equal(firstManifest.history.transferred_initial_heads.root_count, 2);
  assert.equal(firstManifest.remote_state.target.no_v1_refs, true);
  assert.deepEqual(
    firstManifest.runtime_identity.runtime_modules.map(({ path }) => path),
    EXPECTED_V2_RUNTIME_MODULE_PATHS,
  );
  const policyBytes = readFileSync(
    join(
      fixture.sourceRepo,
      "packages",
      "action",
      EVIDENCE_AUTHORITY_POLICY_PATH,
    ),
  );
  const policySha256 = createHash("sha256").update(policyBytes).digest("hex");
  const policyTreeEntry = firstManifest.released_tree.entries.find(
    ({ path }) => path === EVIDENCE_AUTHORITY_POLICY_PATH,
  );
  assert.ok(policyTreeEntry);
  assert.deepEqual(firstManifest.runtime_identity.evidence_authority_policy, {
    role: "v2-evidence-authority-policy",
    path: EVIDENCE_AUTHORITY_POLICY_PATH,
    object_oid: policyTreeEntry.object_oid,
    sha256: policySha256,
    policy_digest: `sha256:${policySha256}`,
  });
  const actionPackageBytes = readFileSync(
    join(fixture.sourceRepo, "packages", "action", "package.json"),
  );
  const actionPackageTreeEntry = firstManifest.released_tree.entries.find(
    ({ path }) => path === "package.json",
  );
  assert.ok(actionPackageTreeEntry);
  assert.deepEqual(firstManifest.runtime_identity.package, {
    role: "v2-action-package",
    path: "package.json",
    object_oid: actionPackageTreeEntry.object_oid,
    sha256: createHash("sha256").update(actionPackageBytes).digest("hex"),
    name: ACTION_PACKAGE_IDENTITY.name,
    version: ACTION_PACKAGE_IDENTITY.version,
    repository_url: ACTION_PACKAGE_IDENTITY.repository.url,
  });
  const releasedPaths = new Set(
    firstManifest.released_tree.entries.map(({ path }) => path),
  );
  const targetPaths = new Set(
    gitText(fixture.targetRepo, ["ls-tree", "-r", "--name-only", remoteMaster])
      .split("\n"),
  );
  for (const path of SOURCE_ONLY_REQUIRED_CI_PATHS) {
    assert.equal(existsSync(join(fixture.sourceRepo, path)), true);
    assert.equal(releasedPaths.has(path), false);
    assert.equal(targetPaths.has(path), false);
  }
  assert.doesNotMatch(
    JSON.stringify(firstManifest.runtime_identity),
    /required-ci/u,
  );
  for (const tag of ["v2.0.0", "v2.0", "v2"]) {
    assert.equal(gitText(fixture.targetRepo, ["cat-file", "-t", `refs/tags/${tag}`]), "tag");
    assert.equal(gitText(fixture.targetRepo, ["rev-parse", `${tag}^{commit}`]), remoteMaster);
  }
  const refsAfterFirst = gitText(fixture.targetRepo, [
    "for-each-ref",
    "--format=%(objectname) %(refname)",
  ]);
  assert.doesNotMatch(refsAfterFirst, /refs\/(?:heads|tags)\/v1(?:[./-]|$)/);
  assert.equal(
    gitText(fixture.frozenRepo, ["for-each-ref", "--format=%(objectname) %(refname)"]),
    fixture.frozenRefsBefore,
  );

  const secondOutput = join(fixture.root, "v2.0.0-provenance-rerun.json");
  const second = runRelease(fixture, secondOutput);
  assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
  assert.match(second.stdout, /already has the exact immutable v2 release/);
  assert.equal(
    gitText(fixture.targetRepo, ["for-each-ref", "--format=%(objectname) %(refname)"]),
    refsAfterFirst,
  );
  assert.deepEqual(
    JSON.parse(readFileSync(secondOutput, "utf8")),
    firstManifest,
  );
});

test("first publication refuses an unrecorded target ref without any mutation", (t) => {
  const fixture = createPipelineFixture(t);
  const rogueCommit = gitText(fixture.sourceRepo, ["rev-parse", "HEAD"]);
  git(fixture.sourceRepo, [
    "push",
    "-q",
    fixture.targetRepo,
    `${rogueCommit}:refs/heads/rogue`,
  ]);
  const refsBefore = gitText(fixture.targetRepo, [
    "for-each-ref",
    "--format=%(objectname) %(refname)",
  ]);
  const output = join(fixture.root, "rejected-provenance.json");
  const result = runRelease(fixture, output);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exact recorded target and frozen baselines/);
  assert.equal(
    gitText(fixture.targetRepo, ["for-each-ref", "--format=%(objectname) %(refname)"]),
    refsBefore,
  );
  assert.equal(
    gitText(fixture.frozenRepo, ["for-each-ref", "--format=%(objectname) %(refname)"]),
    fixture.frozenRefsBefore,
  );
});

test("production test overrides fail closed", () => {
  const result = spawnSync(releaseScriptPath, ["--test-skip-signatures"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...testEnvironment,
      CODEX_REVIEW_GATE_RELEASE_PROVENANCE_TEST_ONLY: "0",
    },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /test-only release override requires/);
});

test("even the closed test interface cannot select the frozen repository for writes", () => {
  const result = spawnSync(
    releaseScriptPath,
    [
      "--test-target-url",
      "https://github.com/JoeyTeng/codex-review-gate-action.git",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: testEnvironment,
    },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /can never be a publication target/);
});

test("production baseline remains the only accepted live old-personal state", () => {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  assert.equal(baseline.frozen_repository.default_commit_oid, baseline.target_repository.default_commit_oid);
  assert.equal(baseline.frozen_repository.default_tree_oid, baseline.target_repository.default_tree_oid);
  assert.equal(Object.keys(baseline.target_repository.refs).length, 3);
  assert.equal(
    Object.keys(baseline.target_repository.refs).filter((ref) => ref.startsWith("refs/tags/")).length,
    0,
  );
});
