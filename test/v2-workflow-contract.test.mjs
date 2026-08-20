import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const reusable = readFileSync(
  new URL("../packages/action/.github/workflows/codex-review-gate.yml", import.meta.url),
  "utf8",
);
const reconcile = readFileSync(
  new URL("../packages/action/.github/workflows/codex-review-gate-reconcile.yml", import.meta.url),
  "utf8",
);

const OUTPUTS = [
  "decision",
  "report-path",
  "status-plan-path",
  "reservation-path",
  "intent-path",
  "binding-receipt-path",
  "sticky-receipt-path",
  "ledger-receipt-path",
  "due-at",
  "wakeup-hints",
];

const CONTROLLER_JOBS = [
  "initial",
  "after-public-initial",
  "after-public-post-request",
  "after-public-no-start",
];

const WAIT_JOBS = [
  "public-initial-wait",
  "public-post-request-wait",
  "public-no-start-wait",
];

function jobBlock(source, name) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === `  ${name}:`);
  assert.notEqual(start, -1, `missing workflow job ${name}`);
  let end = start + 1;
  while (end < lines.length && !/^  [A-Za-z0-9_-]+:\s*$/u.test(lines[end])) {
    end += 1;
  }
  return lines.slice(start, end).join("\n");
}

function workflowJobNames(source) {
  const lines = source.split("\n");
  const jobs = lines.findIndex((line) => line === "jobs:");
  assert.notEqual(jobs, -1, "missing workflow jobs mapping");
  return lines.slice(jobs + 1)
    .flatMap((line) => /^  ([A-Za-z0-9_-]+):\s*$/u.exec(line)?.[1] ?? []);
}

function assertScheduleFanoutContract(source) {
  assert.deepEqual(workflowJobNames(source), [
    "codex-review-gate",
    "schedule-dispatch",
    "scheduled-pull-requests",
  ]);
  const ordinary = jobBlock(source, "codex-review-gate");
  const coordinator = jobBlock(source, "schedule-dispatch");
  const scheduled = jobBlock(source, "scheduled-pull-requests");
  assert.match(ordinary, /^    if: inputs\.controller-mode != 'scan-all-open'$/mu);
  assert.match(ordinary, /^    timeout-minutes: 10$/mu);
  assert.match(
    coordinator,
    /^    if: inputs\.controller-mode == 'scan-all-open'$/mu,
  );
  assert.match(coordinator, /^    timeout-minutes: 15$/mu);
  assert.match(coordinator, /workflow-controller\.mjs" schedule-dispatch/u);
  assert.doesNotMatch(coordinator, /\blist-open\b/u);
  assert.match(
    scheduled,
    /^    if: inputs\.controller-mode == 'scan-all-open'$/mu,
  );
  assert.match(scheduled, /^    needs: schedule-dispatch$/mu);
  assert.match(scheduled, /^    timeout-minutes: 10$/mu);
  assert.match(scheduled, /^      fail-fast: false$/mu);
  assert.match(scheduled, /^      max-parallel: 1$/mu);
  assert.match(
    scheduled,
    /^      matrix: \$\{\{ fromJSON\(needs\.schedule-dispatch\.outputs\.matrix\) \}\}$/mu,
  );
  assert.equal((scheduled.match(/^      - name:/gmu) ?? []).length, 2);
  assert.equal((scheduled.match(/^        if: matrix\.enabled$/gmu) ?? []).length, 2);
  assert.match(
    scheduled,
    /^          V2_CONTROLLER_PULL_REQUEST: \$\{\{ matrix\.pull_request \}\}$/mu,
  );
  assert.match(
    scheduled,
    /^          V2_CONTROLLER_DISPATCH_BINDING: \$\{\{ matrix\.dispatch_binding \}\}$/mu,
  );
  assert.doesNotMatch(scheduled, /toJSON\s*\(|\blist-open\b/u);
}

test("v2 reusable is a fixed exact-release trusted-controller boundary", () => {
  assert.match(reusable, /^name: Codex Review Gate v2$/mu);
  assert.match(reusable, /^  workflow_call:$/mu);
  assert.doesNotMatch(reusable, /^  (?:schedule|workflow_dispatch|issue_comment|pull_request_target):$/mu);
  assert.match(reusable, /runs-on: ubuntu-slim/u);
  assert.match(
    reusable,
    /uses: actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/u,
  );
  assert.match(reusable, /repository: \$\{\{ job\.workflow_repository \}\}/u);
  assert.match(reusable, /ref: \$\{\{ job\.workflow_sha \}\}/u);
  assert.match(reusable, /persist-credentials: false/u);
  assert.match(
    reusable,
    /workflow-controller\.mjs" prepare-command/u,
  );
  assert.match(
    reusable,
    /node "\$GITHUB_WORKSPACE\/\.codex-review-gate-action\/src\/v2\/workflow-controller\.mjs" run/u,
  );
  assert.match(reusable, /test -s "\$V2_CONTROLLER_OUTPUT_PATH"/u);
  assert.match(reusable, /GITHUB_REPOSITORY: \$\{\{ github\.repository \}\}/u);
  assert.match(reusable, /GITHUB_REF: \$\{\{ github\.ref \}\}/u);
  assert.match(reusable, /GITHUB_SHA: \$\{\{ github\.sha \}\}/u);
  assert.match(reusable, /GITHUB_WORKFLOW_REF: \$\{\{ github\.workflow_ref \}\}/u);
  assert.match(reusable, /GITHUB_WORKFLOW_SHA: \$\{\{ github\.workflow_sha \}\}/u);
  assert.match(
    reusable,
    /V2_CONTROLLER_INPUT_PATH: \$\{\{ runner\.temp \}\}\/codex-review-gate-v2-command\.json/u,
  );
  assert.doesNotMatch(reusable, /V2_CONTROLLER_INPUT_PATH: \$\{\{ github\.event_path \}\}/u);
  assert.doesNotMatch(reusable, /uses: \.\/\.codex-review-gate-action\s*$/mu);
  assert.doesNotMatch(reusable, /\b(?:head-sha|event-mode|producer-receipt)\b/u);
});

test("v2 reusable fixes the status target and exposes the canonical controller outputs", () => {
  assert.match(reusable, /V2_STATUS_CONTEXT: codex\/github-review-gate/u);
  assert.match(reusable, /V2_STATUS_TARGET_MODE: test-merge-with-head-sentinel/u);
  assert.match(
    reusable,
    /^      selection-policy:\n        description: [^\n]+\n        required: true\n        type: string\n      controller-mode:$/mu,
  );
  assert.match(reusable, /V2_SELECTION_POLICY: \$\{\{ inputs\.selection-policy \}\}/u);
  assert.match(reusable, /V2_PUBLIC_WAIT_PREFLIGHT_REQUIRED: "true"/u);
  assert.match(reusable, /V2_PUBLIC_WAIT_MINUTES: "15"/u);
  for (const output of OUTPUTS) {
    assert.match(reusable, new RegExp(`^      ${output}:`, "mu"));
    assert.match(
      reusable,
      new RegExp(`steps\\.controller\\.outputs\\.${output.replaceAll("-", "\\-")}`),
    );
  }
  assert.match(reusable, /^permissions:\n  contents: write\n  id-token: write\n  issues: write\n  pull-requests: write\n  statuses: write$/mu);
  assert.doesNotMatch(reusable, /\bsleep\b/u);
});

test("v2 reusable serializes durable schedule dispatch without caller-selected PRs", () => {
  assertScheduleFanoutContract(reusable);

  const ordinary = jobBlock(reusable, "codex-review-gate");
  assert.match(
    ordinary,
    /^    if: inputs\.controller-mode != 'scan-all-open'$/mu,
  );
  assert.match(ordinary, /^          V2_CONTROLLER_DISPATCH_BINDING: ""$/mu);

  const coordinator = jobBlock(reusable, "schedule-dispatch");
  assert.match(
    coordinator,
    /^    if: inputs\.controller-mode == 'scan-all-open'$/mu,
  );
  assert.match(coordinator, /^    runs-on: ubuntu-slim$/mu);
  assert.match(coordinator, /^    timeout-minutes: 15$/mu);
  assert.match(
    coordinator,
    /^      matrix: \$\{\{ steps\.controller\.outputs\.matrix \}\}$/mu,
  );
  assert.match(
    coordinator,
    /uses: actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/u,
  );
  assert.match(coordinator, /repository: \$\{\{ job\.workflow_repository \}\}/u);
  assert.match(coordinator, /ref: \$\{\{ job\.workflow_sha \}\}/u);
  assert.match(coordinator, /persist-credentials: false/u);
  assert.match(coordinator, /^          V2_CONTROLLER_ROUTE: scan-all-open$/mu);
  assert.match(coordinator, /^          V2_CONTROLLER_PULL_REQUEST: ""$/mu);
  assert.match(coordinator, /^          V2_CONTROLLER_DISPATCH_BINDING: ""$/mu);
  assert.match(coordinator, /workflow-controller\.mjs" prepare-command/u);
  assert.match(coordinator, /workflow-controller\.mjs" schedule-dispatch/u);
  assert.doesNotMatch(coordinator, /\blist-open\b/u);

  const scheduled = jobBlock(reusable, "scheduled-pull-requests");
  assert.match(
    scheduled,
    /^    if: inputs\.controller-mode == 'scan-all-open'$/mu,
  );
  assert.match(scheduled, /^    needs: schedule-dispatch$/mu);
  assert.match(scheduled, /^      fail-fast: false$/mu);
  assert.match(scheduled, /^      max-parallel: 1$/mu);
  assert.match(
    scheduled,
    /^      matrix: \$\{\{ fromJSON\(needs\.schedule-dispatch\.outputs\.matrix\) \}\}$/mu,
  );
  assert.equal((scheduled.match(/^      - name:/gmu) ?? []).length, 2);
  assert.equal((scheduled.match(/^        if: matrix\.enabled$/gmu) ?? []).length, 2);
  assert.match(
    scheduled,
    /uses: actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/u,
  );
  assert.match(scheduled, /repository: \$\{\{ job\.workflow_repository \}\}/u);
  assert.match(scheduled, /ref: \$\{\{ job\.workflow_sha \}\}/u);
  assert.match(scheduled, /persist-credentials: false/u);
  assert.match(scheduled, /^          V2_CONTROLLER_ROUTE: ordinary$/mu);
  assert.match(
    scheduled,
    /^          V2_CONTROLLER_PULL_REQUEST: \$\{\{ matrix\.pull_request \}\}$/mu,
  );
  assert.match(
    scheduled,
    /^          V2_CONTROLLER_DISPATCH_BINDING: \$\{\{ matrix\.dispatch_binding \}\}$/mu,
  );
  assert.match(scheduled, /workflow-controller\.mjs" prepare-command/u);
  assert.match(scheduled, /workflow-controller\.mjs" run/u);
  assert.doesNotMatch(scheduled, /toJSON\s*\(/u);
  assert.doesNotMatch(scheduled, /\blist-open\b/u);
  assert.equal((scheduled.match(/actions\/checkout@/gu) ?? []).length, 1);
});

test("v2 reusable rejects schedule topology and matrix authority drift", () => {
  const mutations = [
    reusable.replace("      max-parallel: 1", "      max-parallel: 2"),
    reusable.replace("      fail-fast: false", "      fail-fast: true"),
    reusable.replace("        if: matrix.enabled\n", ""),
    reusable.replace(
      "${{ matrix.dispatch_binding }}",
      "${{ toJSON(matrix.dispatch_binding) }}",
    ),
    reusable.replace("schedule-dispatch\n", "list-open\n"),
    reusable.replace(
      "${{ fromJSON(needs.schedule-dispatch.outputs.matrix) }}",
      "${{ fromJSON(inputs.pull-request) }}",
    ),
    reusable.replace(
      "V2_CONTROLLER_PULL_REQUEST: ${{ matrix.pull_request }}",
      "V2_CONTROLLER_PULL_REQUEST: ${{ inputs.pull-request }}",
    ),
    reusable.replace(
      "    if: inputs.controller-mode != 'scan-all-open'\n",
      "",
    ),
  ];
  for (const mutated of mutations) {
    assert.notEqual(mutated, reusable, "mutation fixture must change the workflow");
    assert.throws(() => assertScheduleFanoutContract(mutated));
  }
});

test("reconcile routes schedule, manual, and provider hints without treating events as evidence", () => {
  assert.match(reconcile, /cron: "17 \*\/2 \* \* \*"/u);
  assert.match(reconcile, /github\.event_name == 'workflow_dispatch' && 'evaluate-only'/u);
  assert.match(reconcile, /github\.event_name == 'schedule' && 'scan-all-open'/u);
  assert.match(reconcile, /'provider-event-hint'/u);
  assert.match(reconcile, /group: codex-review-gate-v2-\$\{\{ github\.repository \}\}/u);
  assert.doesNotMatch(reconcile, /group: codex-review-gate-v2[^\n]*pull_request/u);
  assert.match(reconcile, /cancel-in-progress: false/u);
  assert.doesNotMatch(reconcile, /\bsleep\b/u);
  assert.doesNotMatch(reconcile, /CODEX_REVIEW_GATE_AUTO_RETRY|codex\/review-gate runner/u);
});

test("reconcile isolates controller write authority from every public wait job", () => {
  assert.match(reconcile, /^permissions: \{\}$/mu);
  assert.equal((reconcile.match(/^permissions:/gmu) ?? []).length, 1);
  assert.deepEqual(workflowJobNames(reconcile), [
    "initial",
    "public-initial-wait",
    "after-public-initial",
    "public-post-request-wait",
    "after-public-post-request",
    "public-no-start-wait",
    "after-public-no-start",
  ]);

  const exactControllerPermissions = [
    "    permissions:",
    "      contents: write",
    "      id-token: write",
    "      issues: write",
    "      pull-requests: write",
    "      statuses: write",
  ].join("\n");
  assert.equal(
    (reconcile.match(/^    uses: \.\/\.github\/workflows\/codex-review-gate\.yml$/gmu) ?? [])
      .length,
    CONTROLLER_JOBS.length,
  );
  for (const name of CONTROLLER_JOBS) {
    const block = jobBlock(reconcile, name);
    assert.equal((block.match(/^    permissions:/gmu) ?? []).length, 1);
    assert.ok(
      block.includes(
        `${exactControllerPermissions}\n    uses: ./.github/workflows/codex-review-gate.yml`,
      ),
      `${name} must receive only the exact controller permissions`,
    );
    assert.match(block, /\n      selection-policy: joey-default(?:\n|$)/u);
    assert.equal((block.match(/selection-policy:/gu) ?? []).length, 1);
  }

  for (const name of WAIT_JOBS) {
    const block = jobBlock(reconcile, name);
    assert.equal((block.match(/^    permissions: \{\}$/gmu) ?? []).length, 1);
    assert.match(block, /\n    runs-on: ubuntu-slim(?:\n|$)/u);
    assert.match(block, /\n    timeout-minutes: 5(?:\n|$)/u);
    assert.match(block, /\n      deployment: false(?:\n|$)/u);
    assert.doesNotMatch(
      block,
      /actions\/(?:checkout|cache|upload-artifact|download-artifact)|\buses:|\bsecrets\s*:|\$\{\{\s*(?:secrets(?:\.|\[)|github(?:\.token|\[['"]token['"]\]))|\b(?:GITHUB_TOKEN|GH_TOKEN|ACTIONS_ID_TOKEN|authorization|credentials?)\b|id-token|OIDC/iu,
    );
  }
});

test("public waits are three deployment-free environment gates, never runner sleeps", () => {
  const waitNames = [
    "codex-review-gate-public-initial-15m",
    "codex-review-gate-public-post-request-15m",
    "codex-review-gate-public-no-start-15m",
  ];
  for (const name of waitNames) {
    assert.match(reconcile, new RegExp(`name: ${name}\\n      deployment: false`, "u"));
    assert.match(reusable, new RegExp(`V2_PUBLIC_WAIT_ENVIRONMENT_[A-Z_]+: ${name}`, "u"));
  }
  assert.match(reconcile, /must have an\n# exact 15-minute wait_timer protection rule/u);
  assert.match(reconcile, /Environment API preflight and live canary must/u);
  assert.match(reconcile, /missing, unreadable, or non-15-minute\n# evidence is a fail-closed rollout blocker/u);
  assert.equal((reconcile.match(/deployment: false/gu) ?? []).length, 3);
  assert.equal((reconcile.match(/runs-on: ubuntu-slim/gu) ?? []).length, 3);
  assert.equal((reconcile.match(/timeout-minutes: 5/gu) ?? []).length, 3);
  assert.match(reconcile, /observation-boundary: public-initial-wait-complete/u);
  assert.match(reconcile, /observation-boundary: public-post-request-wait-complete/u);
  assert.match(reconcile, /observation-boundary: public-no-start-wait-complete/u);
});
