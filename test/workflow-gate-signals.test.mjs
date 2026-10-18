import assert from "node:assert/strict";
import test from "node:test";
import { inspectWorkflowGateSignals } from "../src/workflow-gate-signals.mjs";

// Synthetic token pool joey-private-v3; records bearer-a and api-key-a.
const syntheticAuthorizationCredentials = {
  bearer_token: "codex_synth_v1_bearer_a",
  api_key: "codex_synth_v1_api_key_a",
};

test("omits source text from blocking match excerpts", () => {
  const authorizationLines = [
    `check-context: codex/github-review-gate # Authorization: token ${syntheticAuthorizationCredentials.bearer_token}`,
    `check-context: codex/github-review-gate # AUTHORIZATION: Basic ${syntheticAuthorizationCredentials.api_key}`,
    `check-context: codex/github-review-gate # {\"authorization\": \"token ${syntheticAuthorizationCredentials.bearer_token}\"}`,
    `check-context: codex/github-review-gate # 'Authorization': 'Basic ${syntheticAuthorizationCredentials.api_key}'`,
    `check-context: codex/github-review-gate # {\"token\":\"${syntheticAuthorizationCredentials.bearer_token}\",\"password\":\"${syntheticAuthorizationCredentials.api_key}\"}`,
  ];

  for (const line of authorizationLines) {
    const result = inspectWorkflowGateSignals(line);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].kind, "reserved-status-context");
    assert.equal(result.matches[0].line, 1);
    assert.equal(result.matches[0].excerpt, "[source text omitted; inspect the reported workflow line]");
    assert.ok(!result.matches[0].excerpt.includes(syntheticAuthorizationCredentials.bearer_token));
    assert.ok(!result.matches[0].excerpt.includes(syntheticAuthorizationCredentials.api_key));
  }
});

test("omits source text from warning diagnostic excerpts", () => {
  const raw = `{"token":"${syntheticAuthorizationCredentials.bearer_token}","password":"${syntheticAuthorizationCredentials.api_key}"}${"x".repeat(4096)}`;
  const result = inspectWorkflowGateSignals(raw);
  const warning = result.warnings.find(({ kind }) => kind === "line-truncated");

  assert.ok(warning);
  assert.equal(warning.line, 1);
  assert.equal(warning.excerpt, "[source text omitted; inspect the reported workflow line]");
  assert.ok(!warning.excerpt.includes(syntheticAuthorizationCredentials.api_key));
});

test("finds literal reserved names and same-name status contexts", () => {
  const result = inspectWorkflowGateSignals(`
name: Maintenance workflow
jobs:
  publisher:
    name: "codex/github-review-gate"
    check-context: codex/github-review-gate
    steps:
      - run: echo ready
`);

  assert.deepEqual(
    result.matches.map(({ kind }) => kind),
    ["reserved-job-name", "reserved-status-context"],
  );
  assert.equal(result.warnings.length, 0);

  for (const content of [
    "jobs:\n    collision:\n        name: codex/github-review-gate",
    '"jobs":\n  "collision":\n    "name": codex/github-review-gate',
    "'jobs':\n    'collision':\n        'name': codex/github-review-gate",
  ]) {
    const indentedOrQuoted = inspectWorkflowGateSignals(content);
    assert.equal(indentedOrQuoted.matches.length, 1);
    assert.equal(indentedOrQuoted.matches[0].kind, "reserved-job-name");
  }
});

test("classifies reserved job names in reusable-only workflows", () => {
  const result = inspectWorkflowGateSignals([
    "on:",
    "  workflow_call:",
    "jobs:",
    "  internal:",
    "    name: codex/github-review-gate",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: echo reusable",
  ].join("\n"));

  assert.deepEqual(result.matches.map(({ kind }) => kind), ["reserved-job-name"]);
});

test("keeps indentless step display names out of job-name classification", () => {
  const result = inspectWorkflowGateSignals([
    "jobs:",
    "  display-only:",
    "    steps:",
    "    - name: codex/github-review-gate",
    "      run: echo ready",
    "  actual-collision:",
    "    name: codex/github-review-gate",
    "    steps:",
    "      - uses: JoeyTeng/codex-review-gate-action@v2",
  ].join("\n"));

  assert.deepEqual(
    result.matches.map(({ kind }) => kind),
    ["reserved-job-name", "codex-review-gate-action-caller"],
  );
  assert.equal(result.matches[0].line, 7);
  assert.equal(result.matches[1].line, 9);
});

test("keeps multiline quoted YAML content unclassified through its closing line", () => {
  const result = inspectWorkflowGateSignals([
    "jobs:",
    "  display-only:",
    "    name: 'safe display name",
    "        context: codex/github-review-gate",
    "        uses: JoeyTeng/codex-review-gate-action@v2",
    "        closing quote'",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: JoeyTeng/codex-review-gate-action@v2",
    "  actual-collision:",
    "    name: codex/github-review-gate",
  ].join("\n"));

  assert.deepEqual(
    result.matches.map(({ kind }) => kind),
    ["codex-review-gate-action-caller", "reserved-job-name"],
  );
  assert.equal(result.matches[0].line, 9);
  assert.equal(result.matches[1].line, 11);
  assert.ok(result.warnings.some(({ kind, line }) => kind === "unclassified-quoted-yaml-scalar" && line === 3));
});

test("does not scan quoted run scalar continuations as physical shell lines", () => {
  const result = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: 'echo harmless",
    "          gh api repos/o/r/check-runs -f name=codex/github-review-gate",
    "          closing quote'",
    "      - uses: JoeyTeng/codex-review-gate-action@v2",
  ].join("\n"));

  assert.deepEqual(result.matches.map(({ kind }) => kind), ["codex-review-gate-action-caller"]);
  assert.equal(result.matches[0].line, 7);
  assert.ok(result.warnings.some(({ kind, line }) => kind === "unclassified-quoted-yaml-scalar" && line === 4));
});

test("preserves YAML slash-slash scalar content when matching reserved job names", () => {
  const result = inspectWorkflowGateSignals([
    "jobs:",
    "  build:",
    "    name: codex/github-review-gate // Linux",
    "    runs-on: ubuntu-latest",
  ].join("\n"));

  assert.deepEqual(result.matches, []);
});

test("keeps YAML value punctuation and quoted scalar text out of field identity", () => {
  const quotedStepName = inspectWorkflowGateSignals([
    "jobs:",
    "  build:",
    "    steps:",
    `      - name: 'metadata, context: "codex/github-review-gate", end'`,
    "        run: echo ready",
  ].join("\n"));
  assert.deepEqual(quotedStepName.matches, []);
  assert.ok(quotedStepName.warnings.some(({ kind }) => kind === "reserved-status-context-reference"));

  for (const punctuation of [",", ";"]) {
    const punctuatedName = inspectWorkflowGateSignals([
      "jobs:",
      "  collision:",
      `    name: codex/github-review-gate${punctuation}`,
      "    runs-on: ubuntu-latest",
    ].join("\n"));
    assert.deepEqual(punctuatedName.matches, [], punctuation);
    assert.ok(
      punctuatedName.warnings.some(({ kind }) => kind === "reserved-status-context-reference"),
      punctuation,
    );
  }

  const flowName = inspectWorkflowGateSignals(
    "jobs: {build: {name: codex/github-review-gate, runs-on: ubuntu-latest}}",
  );
  assert.deepEqual(flowName.matches.map(({ kind }) => kind), ["reserved-job-name"]);
});

test("keeps YAML name and context values as scalars, not executable expressions", () => {
  const variableReference = inspectWorkflowGateSignals([
    "jobs:",
    "  build:",
    "    steps:",
    "      - run: |",
    "          GATE=codex/github-review-gate",
    "    name: GATE",
    "    check-context: GATE",
  ].join("\n"));
  assert.deepEqual(variableReference.matches, []);
  assert.ok(
    !variableReference.warnings.some(
      ({ kind, line }) => kind === "ambiguous-reserved-context" && [6, 7].includes(line),
    ),
  );

  const concatenation = inspectWorkflowGateSignals([
    "jobs:",
    "  build:",
    "    name: 'codex/github-' + 'review-gate'",
    "    check-context: 'codex/github-' + 'review-gate'",
  ].join("\n"));
  assert.deepEqual(concatenation.matches, []);
});

test("does not resolve a punctuated block YAML anchor as an exact scalar", () => {
  const result = inspectWorkflowGateSignals([
    "jobs:",
    "  first:",
    "    name: &gate codex/github-review-gate,",
    "  second:",
    "    name: *gate",
  ].join("\n"));

  assert.deepEqual(result.matches, []);
  assert.ok(result.warnings.some(({ kind }) => kind === "complex-yaml-scalar-anchor"));
  assert.ok(result.warnings.some(({ kind }) => kind === "unknown-yaml-scalar-alias"));
});

test("finds a reserved job name nested under a flow-style root mapping", () => {
  for (const content of [
    "{name: Other, jobs: {collision: {name: codex/github-review-gate}}}",
    "{name: Other, jobs: {\"collision\": {name: codex/github-review-gate}}}",
    "{name: Other, jobs: {'collision': {name: codex/github-review-gate}}}",
    "jobs:\n  collision: {name: codex/github-review-gate}",
    "jobs:\n  \"collision\": {name: codex/github-review-gate}",
    "jobs:\n  'collision': {name: codex/github-review-gate}",
  ]) {
    const nested = inspectWorkflowGateSignals(content);
    assert.equal(nested.matches.length, 1, content);
    assert.equal(nested.matches[0].kind, "reserved-job-name", content);
  }

  const direct = inspectWorkflowGateSignals("context: codex/github-review-gate");
  assert.equal(direct.matches.length, 1);
  assert.equal(direct.matches[0].kind, "reserved-status-context");

  assert.equal(
    inspectWorkflowGateSignals("context: check.name", { reservedCheckName: "check.name" }).matches.length,
    1,
  );
  assert.equal(
    inspectWorkflowGateSignals("context: checkXname", { reservedCheckName: "check.name" }).matches.length,
    0,
  );

  for (const content of [
    "jobs: {test: {name: codex/github-review-gate, permissions: {contents: read}, runs-on: ubuntu-latest}}",
    "jobs:\n  test: {name: codex/github-review-gate, permissions: {contents: read}}",
  ]) {
    const nestedProperties = inspectWorkflowGateSignals(content);
    assert.equal(nestedProperties.matches.length, 1, content);
    assert.equal(nestedProperties.matches[0].kind, "reserved-job-name", content);
  }
});

test("bounds flow collection traversal and warns without classifying overflow", () => {
  const nested = `{jobs: {test: {name: codex/github-review-gate, permissions: ${"{".repeat(9)}x${"}".repeat(9)}}}}`;
  const tooDeep = inspectWorkflowGateSignals(nested);
  assert.deepEqual(tooDeep.matches, []);
  assert.ok(tooDeep.warnings.some(({ kind }) => kind === "ambiguous-flow-structure"));

  const tooLong = inspectWorkflowGateSignals(
    `{jobs: {test: {name: codex/github-review-gate, metadata: '${"x".repeat(2100)}'}}}`,
  );
  assert.deepEqual(tooLong.matches, []);
  assert.ok(tooLong.warnings.some(({ kind }) => kind === "ambiguous-flow-structure"));
});

test("finds a reserved job name in a bounded folded scalar", () => {
  const result = inspectWorkflowGateSignals([
    "jobs:",
    "  collision:",
    "    name: >-",
    "      codex/github-review-gate",
    "    runs-on: ubuntu-slim",
  ].join("\n"));

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].kind, "reserved-job-name");
});

test("classifies the complete folded job name rather than matching body fragments", () => {
  const suffix = inspectWorkflowGateSignals([
    "jobs:",
    "  collision:",
    "    name: >-",
    "      codex/github-review-gate",
    "      (Linux)",
    "    runs-on: ubuntu-slim",
  ].join("\n"));
  assert.deepEqual(suffix.matches, []);

  const fragments = inspectWorkflowGateSignals([
    "jobs:",
    "  collision:",
    "    name: >-",
    "      codex/github-",
    "      review-gate",
    "    runs-on: ubuntu-slim",
  ].join("\n"));
  assert.deepEqual(fragments.matches, []);

  for (const body of [
    "      'codex/github-review-gate'",
    "      codex/github-review-gate # literal block text",
    "      codex/github-review-gate\n      ---",
  ]) {
    const literalText = inspectWorkflowGateSignals([
      "jobs:",
      "  collision:",
      "    name: >-",
      body,
      "    runs-on: ubuntu-slim",
    ].join("\n"));
    assert.deepEqual(literalText.matches, [], body);
  }
});

test("warns instead of classifying an over-budget folded job-name prefix", () => {
  const result = inspectWorkflowGateSignals([
    "jobs:",
    "  collision:",
    "    name: >-",
    "      codex/github-review-gate",
    "      first extra line",
    "      second extra line",
    "      third extra line",
    "      fourth extra line",
    "    runs-on: ubuntu-slim",
  ].join("\n"));

  assert.deepEqual(result.matches, []);
  assert.ok(result.warnings.some(({ kind }) => kind === "folded-job-name-limit"));
});

test("closes folded job-name state at dedent and document boundaries", () => {
  const result = inspectWorkflowGateSignals([
    "jobs:",
    "  first:",
    "    name: >-",
    "      codex/github-review-gate",
    "      (Linux)",
    "  second:",
    "    name: >-",
    "      codex/github-review-gate",
    "---",
    "jobs:",
    "  third:",
    "    name: >-",
    "      codex/github-review-gate",
  ].join("\n"));

  assert.deepEqual(
    result.matches.map(({ kind }) => kind),
    ["reserved-job-name", "reserved-job-name"],
  );

  const trailingBlank = inspectWorkflowGateSignals([
    "jobs:",
    "  collision:",
    "    name: >-",
    "      codex/github-review-gate",
    "",
    "    runs-on: ubuntu-slim",
  ].join("\n"));
  assert.equal(trailingBlank.matches.length, 1);
});

test("keeps default chomping and meaningful block-name spaces unclassified", () => {
  for (const indicator of ["|", ">", "|+", ">+"]) {
    const result = inspectWorkflowGateSignals(`jobs:\n  build:\n    name: ${indicator}\n      codex/github-review-gate\n    steps: []\n`);
    assert.deepEqual(result.matches, [], indicator);
    assert.ok(result.warnings.some(({ kind }) => kind === "folded-job-name-unclassified"));
  }
  for (const body of ["\n      codex/github-review-gate", "      codex/github-review-gate "]) {
    assert.deepEqual(inspectWorkflowGateSignals(`jobs:\n  build:\n    name: >-\n${body}\n    steps: []\n`).matches, []);
  }
  assert.equal(inspectWorkflowGateSignals("jobs:\n  build:\n    name: |-\n      codex/github-review-gate\n    steps: []\n").matches.length, 1);
});

test("does not execute non-run scalar values or inputs named run", () => {
  const scalarData = inspectWorkflowGateSignals([
    "jobs:", "  build:", "    steps:", "      - run: |", "          echo ready",
    "        env:", "          NOTE: |", "            context=codex/github-review-gate",
    "            curl -X POST " + "\\", "              -d '{\"name\":\"codex/github-review-gate\"}' " + "\\",
    "              https://api.github.com/repos/o/r/check-runs",
    "      - uses: example/action@v1", "        with:", "          run: |",
    "            gh api repos/o/r/check-runs -f name=codex/github-review-gate",
  ].join("\n"));
  assert.deepEqual(scalarData.matches, []);
});

test("keeps matrix expansion values as data without hiding a job named matrix", () => {
  const result = inspectWorkflowGateSignals([
    "jobs:", "  build:", "    strategy:", "      matrix:", "        include:",
    "          - context: codex/github-review-gate", "    steps: []", "  matrix:",
    "    name: codex/github-review-gate", "    steps: []",
  ].join("\n"));
  assert.deepEqual(result.matches.map(({ kind }) => kind), ["reserved-job-name"]);
});

test("leaves matrix job names unknown while retaining non-matrix names and action callers", () => {
  const result = inspectWorkflowGateSignals([
    "jobs:",
    "  matrixed:",
    "    name: codex/github-review-gate",
    "    strategy:",
    "      matrix:",
    "        os: [ubuntu-latest, windows-latest]",
    "    steps:",
    "      - uses: JoeyTeng/codex-review-gate-action@v2",
    "  control:",
    "    name: codex/github-review-gate",
  ].join("\n"));

  assert.deepEqual(
    result.matches.map(({ kind }) => kind),
    ["codex-review-gate-action-caller", "reserved-job-name"],
  );
  assert.equal(result.matches[1].line, 10);
  assert.ok(result.warnings.some(({ kind, line }) => kind === "matrix-job-name-unclassified" && line === 3));

  const flowMatrixName = inspectWorkflowGateSignals(
    "jobs: {matrixed: {name: codex/github-review-gate, strategy: {matrix: {os: [linux, windows]}}}}",
  );
  assert.deepEqual(flowMatrixName.matches, []);
  assert.ok(flowMatrixName.warnings.some(({ kind }) => kind === "matrix-job-name-unclassified"));
});

test("keeps nested env and reusable-job with matrix keys as warning-only coverage gaps", () => {
  const cases = [
    ["env data", [
      "jobs:",
      "  build:",
      "    name: codex/github-review-gate",
      "    env:",
      "      matrix: value",
      "    steps: []",
    ].join("\n")],
    ["reusable-job with input", [
      "jobs:",
      "  build:",
      "    name: codex/github-review-gate",
      "    uses: example/workflows/child.yml@main",
      "    with:",
      "      matrix: value",
    ].join("\n")],
  ];

  for (const [label, source] of cases) {
    const result = inspectWorkflowGateSignals(source);
    assert.deepEqual(result.matches, [], label);
    assert.ok(
      result.warnings.some(({ kind }) => kind === "matrix-job-name-unclassified"),
      label,
    );
  }
});

test("leaves command publishers unknown when YAML explicitly configures a shell", () => {
  const result = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    name: codex/github-review-gate",
    "    steps:",
    "      - shell: echo {0}",
    "        run: gh api repos/o/r/check-runs -f name=codex/github-review-gate",
    "      - run: |",
    "          curl -X POST \\",
    `            -d '{"name":"codex/github-review-gate"}' \\`,
    "            https://api.github.com/repos/o/r/check-runs",
    "      - uses: JoeyTeng/codex-review-gate-action@v2",
  ].join("\n"));

  assert.deepEqual(
    result.matches.map(({ kind }) => kind),
    ["reserved-job-name", "codex-review-gate-action-caller"],
  );
  assert.ok(result.warnings.some(({ kind, line }) => kind === "explicit-shell-configuration-unclassified" && line === 5));

  const implicitDefault = inspectWorkflowGateSignals(
    "run: gh api repos/o/r/check-runs -f name=codex/github-review-gate -f head_sha=0123456789abcdef0123456789abcdef01234567",
  );
  assert.deepEqual(implicitDefault.matches.map(({ kind }) => kind), ["reserved-check-run-name"]);

  const suppressedPublisherFlood = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - shell: echo {0}",
    ...Array.from(
      { length: 40 },
      () => "      - run: gh api repos/o/r/check-runs -f name=codex/github-review-gate",
    ),
    "      - uses: JoeyTeng/codex-review-gate-action@v2",
  ].join("\n"));
  assert.deepEqual(
    suppressedPublisherFlood.matches.map(({ kind }) => kind),
    ["codex-review-gate-action-caller"],
  );
  assert.ok(!suppressedPublisherFlood.warnings.some(({ kind }) => kind === "match-limit"));
});

test("keeps job-ID and env/with shell mentions as warning-only coverage gaps", () => {
  const publisher = "      - run: gh api repos/o/r/check-runs -f name=codex/github-review-gate";
  const cases = [
    ["job ID shell", ["jobs:", "  shell:", "    steps:", publisher].join("\n")],
    ["env shell data", [
      "jobs:",
      "  publish:",
      "    env:",
      "      shell: bash",
      "    steps:",
      publisher,
    ].join("\n")],
    ["step with shell input", [
      "jobs:",
      "  publish:",
      "    steps:",
      "      - uses: example/action@v1",
      "        with:",
      "          shell: bash",
      publisher,
    ].join("\n")],
  ];

  for (const [label, source] of cases) {
    const result = inspectWorkflowGateSignals(source);
    assert.deepEqual(result.matches, [], label);
    assert.ok(
      result.warnings.some(({ kind }) => kind === "explicit-shell-configuration-unclassified"),
      label,
    );
  }
});

test("never derives exact values or aliases from incomplete line and window text", () => {
  const longName = "jobs:\n  build:\n    name: codex/github-review-gate" + " ".repeat(4096) + "(Linux)\n";
  assert.deepEqual(inspectWorkflowGateSignals(longName).matches, []);
  const windowName = "jobs:\n  build:\n    name: codex/github-review-gate" + " ".repeat(2100) + "(Linux)\n";
  assert.deepEqual(inspectWorkflowGateSignals(windowName).matches, []);
  const unknownAssignment = [
    "jobs:", "  build:", "    steps:", "      - run: |", "          NAME=codex/github-review-gate",
    "          NAME=ordinary" + " ".repeat(4096), '          context="$NAME"',
  ].join("\n");
  assert.deepEqual(inspectWorkflowGateSignals(unknownAssignment).matches, []);
  const unknownAnchor = [
    "env: { ACTION: &gate JoeyTeng/codex-review-gate-action@v2 }",
    "env: { ACTION: &gate actions/checkout@v4 }" + " ".repeat(4096),
    "jobs:", "  build:", "    steps:", "      - uses: *gate",
  ].join("\n");
  assert.deepEqual(inspectWorkflowGateSignals(unknownAnchor).matches, []);
  const candidate = "context=codex/github-review-gate";
  const padding = "#" + "x".repeat(256 * 1024 - candidate.length - 2) + "\n";
  const clippedTail = inspectWorkflowGateSignals(padding + candidate + " (Linux)\n");
  assert.deepEqual(clippedTail.matches, []);
  assert.ok(clippedTail.warnings.some(({ kind }) => kind === "input-truncated"));
});

test("handles simple scalar anchors consistently on job names and context fields", () => {
  const anchored = inspectWorkflowGateSignals([
    "jobs:",
    "  publisher:",
    "    name: &job codex/github-review-gate",
    "    context: &context codex/github-review-gate",
  ].join("\n"));
  assert.deepEqual(
    anchored.matches.map(({ kind }) => kind),
    ["reserved-job-name", "reserved-status-context"],
  );

  const flow = inspectWorkflowGateSignals(
    "{context: &context codex/github-review-gate, jobs: {collision: {name: &job codex/github-review-gate}}}",
  );
  assert.deepEqual(
    flow.matches.map(({ kind }) => kind),
    ["reserved-job-name", "reserved-status-context"],
  );

  const folded = inspectWorkflowGateSignals([
    "jobs:",
    "  collision:",
    "    name: &job >-",
    "      codex/github-review-gate",
  ].join("\n"));
  assert.equal(folded.matches.length, 1);
  assert.equal(folded.matches[0].kind, "reserved-job-name");
});

test("finds literal action and legacy reusable-workflow callers", () => {
  const result = inspectWorkflowGateSignals([
    "jobs:",
    "  one:",
    "    steps:",
    "      - uses: JoeyTeng/codex-review-gate-action@v2",
    "      - uses: JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1",
    "      - uses: Joey-Tools/codex-review-gate/.github/workflows/codex-review-gate.yml@0123456789abcdef",
  ].join("\n"));

  assert.deepEqual(
    result.matches.map(({ kind }) => kind),
    [
      "codex-review-gate-action-caller",
      "codex-review-gate-action-caller",
      "legacy-codex-review-gate-caller",
    ],
  );

  const segmented = inspectWorkflowGateSignals([
    "jobs:",
    "  segmented:",
    "    steps:",
    "      - uses: 'JoeyTeng/' + 'codex-review-gate-action@v2'",
  ].join("\n"));
  assert.equal(segmented.matches.length, 1);
  assert.equal(segmented.matches[0].kind, "codex-review-gate-action-caller");

  const unrelatedSourceWorkflows = inspectWorkflowGateSignals([
    "jobs:",
    "  ci:",
    "    uses: Joey-Tools/codex-review-gate/.github/workflows/required-ci.yml@master",
    "  other:",
    "    uses: Joey-Tools/codex-review-gate/.github/workflows/reusable.yml@0123456789abcdef",
    "  action:",
    "    steps:",
    "      - uses: Joey-Tools/codex-review-gate@master",
  ].join("\n"));
  assert.deepEqual(unrelatedSourceWorkflows.matches, []);
  assert.ok(unrelatedSourceWorkflows.warnings.length > 0);
});

test("blocks only job and step uses selectors, warning on unrelated uses data", () => {
  const selectors = inspectWorkflowGateSignals([
    "jobs:",
    "  reusable:",
    "    uses: JoeyTeng/codex-review-gate-action@v2",
    "  steps:",
    "    steps:",
    "      - uses: JoeyTeng/codex-review-gate-action@v2",
  ].join("\n"));
  assert.equal(selectors.matches.length, 2);
  assert.ok(selectors.matches.every(({ kind }) => kind === "codex-review-gate-action-caller"));

  const flowJobSelector = inspectWorkflowGateSignals(
    "{jobs: {reusable: {uses: JoeyTeng/codex-review-gate-action@v2}}}",
  );
  assert.equal(flowJobSelector.matches.length, 1);
  assert.equal(flowJobSelector.matches[0].kind, "codex-review-gate-action-caller");

  const flowStepSelector = inspectWorkflowGateSignals(
    "{jobs: {build: {steps: [{uses: JoeyTeng/codex-review-gate-action@v2}]}}}",
  );
  assert.equal(flowStepSelector.matches.length, 1);
  assert.equal(flowStepSelector.matches[0].kind, "codex-review-gate-action-caller");

  for (const content of [
    "jobs: {build: {steps: [{name: gate, uses: JoeyTeng/codex-review-gate-action@v2, with: {uses: JoeyTeng/codex-review-gate-action@v1}}]}}",
    [
      "jobs:",
      "  build:",
      "    steps: [{name: gate, uses: JoeyTeng/codex-review-gate-action@v2, with: {uses: JoeyTeng/codex-review-gate-action@v1}}]",
    ].join("\n"),
  ]) {
    const laterStepSelector = inspectWorkflowGateSignals(content);
    assert.equal(laterStepSelector.matches.length, 1, content);
    assert.equal(laterStepSelector.matches[0].kind, "codex-review-gate-action-caller");
  }

  const data = inspectWorkflowGateSignals([
    "with: { uses: JoeyTeng/codex-review-gate-action@v2 }",
    "jobs:",
    "  build:",
    "    steps:",
    "      - name: metadata only",
    "        with: { uses: JoeyTeng/codex-review-gate-action@v2 }",
    "      - uses: actions/checkout@v4, with: { uses: JoeyTeng/codex-review-gate-action@v2 }",
    "{jobs: {build: {steps: [{uses: actions/checkout@v4, with: {uses: JoeyTeng/codex-review-gate-action@v2}}]}}}",
  ].join("\n"));
  assert.deepEqual(data.matches, []);
  assert.ok(data.warnings.some(({ kind }) => kind === "ambiguous-codex-review-gate-caller"));
});

test("keeps context-like keys inside block env, with, and outputs mappings as data", () => {
  const result = inspectWorkflowGateSignals([
    "env:",
    "  REVIEW_CONTEXT: codex/github-review-gate",
    "  check-name: codex/github-review-gate",
    "with:",
    "  context: codex/github-review-gate",
    "  check_name: codex/github-review-gate",
    "jobs:",
    "  build:",
    "    env:",
    "      status-context: codex/github-review-gate",
    "      check-name: codex/github-review-gate",
    "    with:",
    "      context: codex/github-review-gate",
    "      CHECK_NAME: codex/github-review-gate",
    "    outputs:",
    "      context: codex/github-review-gate",
    "      check-name: codex/github-review-gate",
    "    steps:",
    "      - run: echo data only",
    "        env:",
    "          context: codex/github-review-gate",
    "          check-name: codex/github-review-gate",
    "        with:",
    "          status-context: codex/github-review-gate",
    "          check_name: codex/github-review-gate",
    "          uses: JoeyTeng/codex-review-gate-action@v2",
  ].join("\n"));

  assert.deepEqual(result.matches, []);
});

test("keeps context-like keys inside bounded flow data mappings as data", () => {
  const result = inspectWorkflowGateSignals([
    "env: { REVIEW_CONTEXT: codex/github-review-gate, check-name: codex/github-review-gate }",
    "with: { context: codex/github-review-gate, check_name: codex/github-review-gate }",
    "jobs:",
    "  build:",
    "    env: &shared",
    "      status-context: codex/github-review-gate",
    "      context: codex/github-review-gate",
    "    with: &inputs { context: codex/github-review-gate, status-context: codex/github-review-gate }",
    "    outputs: { check-name: codex/github-review-gate }",
    "    secrets: { check_name: codex/github-review-gate }",
    "    strategy: { matrix: { context: codex/github-review-gate, include: { context: codex/github-review-gate } } }",
    "    container: { env: { context: codex/github-review-gate } }",
    "    services: { database: { env: { context: codex/github-review-gate } } }",
    "    defaults: { run: { context: codex/github-review-gate } }",
    "    strategy:",
    "      matrix:",
    "        context: codex/github-review-gate",
    "    container:",
    "      env:",
    "        context: codex/github-review-gate",
    "    services:",
    "      database:",
    "        env:",
    "          context: codex/github-review-gate",
    "    defaults:",
    "      run:",
    "        context: codex/github-review-gate",
    "    steps:",
    "      - run: echo data only",
    "        env: { context: codex/github-review-gate }",
    "        with: { status-context: codex/github-review-gate }",
    "  env:",
    "    name: codex/github-review-gate",
    "    steps:",
    "      - uses: JoeyTeng/codex-review-gate-action@v2",
    "  strategy:",
    "    name: codex/github-review-gate",
    "    steps:",
    "      - uses: JoeyTeng/codex-review-gate-action@v2",
    "  container:",
    "    name: codex/github-review-gate",
    "    steps:",
    "      - uses: JoeyTeng/codex-review-gate-action@v2",
    "  services:",
    "    name: codex/github-review-gate",
    "    steps:",
    "      - uses: JoeyTeng/codex-review-gate-action@v2",
    "  defaults:",
    "    name: codex/github-review-gate",
    "    steps:",
    "      - uses: JoeyTeng/codex-review-gate-action@v2",
    "  publish:",
    "    steps:",
    "      - run: gh api repos/o/r/check-runs -f name=codex/github-review-gate -f head_sha=0123456789abcdef0123456789abcdef01234567",
  ].join("\n"));

  assert.equal(
    result.matches.filter(({ kind }) => kind === "codex-review-gate-action-caller").length,
    5,
  );
  assert.equal(
    result.matches.filter(({ kind }) => kind === "reserved-job-name").length,
    5,
  );
  assert.equal(
    result.matches.filter(({ kind }) => kind === "reserved-check-run-name").length,
    1,
  );
  assert.equal(result.matches.length, 11, "data containers must not add publisher findings");

  const fullyInline = inspectWorkflowGateSignals(
    "jobs: { build: { env: { context: codex/github-review-gate }, name: codex/github-review-gate, steps: [{ uses: JoeyTeng/codex-review-gate-action@v2, with: { status-context: codex/github-review-gate } }] }, env: { name: codex/github-review-gate, uses: JoeyTeng/codex-review-gate-action@v2 } }",
  );
  assert.deepEqual(
    fullyInline.matches.map(({ kind }) => kind),
    ["codex-review-gate-action-caller", "reserved-job-name"],
  );
  const inlineDataOnly = inspectWorkflowGateSignals(
    "jobs: { build: { env: { context: codex/github-review-gate }, steps: [{ uses: actions/checkout@v4, with: { status-context: codex/github-review-gate } }] } }",
  );
  assert.deepEqual(inlineDataOnly.matches, []);
  const directField = inspectWorkflowGateSignals(
    "jobs: { build: { context: codex/github-review-gate, env: { context: codex/github-review-gate } } }",
  );
  assert.deepEqual(directField.matches.map(({ kind }) => kind), ["reserved-status-context"]);
});

test("keeps nested container env and reusable caller secrets values as data", () => {
  const result = inspectWorkflowGateSignals([
    "jobs:",
    "  build:",
    "    container:",
    "      env:",
    "        context: codex/github-review-gate",
    "        check-name: codex/github-review-gate",
    "    steps:",
    "      - run: echo data only",
    "  reusable:",
    "    uses: owner/repo/.github/workflows/reusable.yml@v1",
    "    secrets:",
    "      context: codex/github-review-gate",
    "      check-name: codex/github-review-gate",
  ].join("\n"));

  assert.deepEqual(result.matches, []);
});

test("keeps jobs named env or with eligible for actual gate callers", () => {
  const result = inspectWorkflowGateSignals([
    "jobs:",
    "  env:",
    "    steps:",
    "      - uses: JoeyTeng/codex-review-gate-action@v2",
    "  with:",
    "    steps:",
    "      - uses: JoeyTeng/codex-review-gate-action@v2",
    "  ordinary:",
    "    env:",
    "      REVIEW_CONTEXT: codex/github-review-gate",
    "    steps:",
    "      - run: echo data only",
    "        with:",
    "          CHECK_CONTEXT: codex/github-review-gate",
    "      - uses: JoeyTeng/codex-review-gate-action@v2",
  ].join("\n"));

  assert.deepEqual(
    result.matches.map(({ kind }) => kind),
    [
      "codex-review-gate-action-caller",
      "codex-review-gate-action-caller",
      "codex-review-gate-action-caller",
    ],
  );
});

test("keeps a job named outputs eligible for real gate signals", () => {
  const result = inspectWorkflowGateSignals([
    "jobs:",
    "  outputs:",
    "    name: codex/github-review-gate",
    "    outputs:",
    "      context: codex/github-review-gate",
    "    steps:",
    "      - uses: JoeyTeng/codex-review-gate-action@v2",
  ].join("\n"));

  assert.deepEqual(
    result.matches.map(({ kind }) => kind),
    ["reserved-job-name", "codex-review-gate-action-caller"],
  );
});

test("keeps data-map-like job IDs eligible for actual names and selectors", () => {
  const jobIds = ["env", "with", "outputs", "secrets"];
  const result = inspectWorkflowGateSignals([
    "jobs:",
    ...jobIds.flatMap((jobId) => [
      `  ${jobId}:`,
      "    name: codex/github-review-gate",
      "    steps:",
      "      - uses: JoeyTeng/codex-review-gate-action@v2",
    ]),
  ].join("\n"));

  assert.equal(
    result.matches.filter(({ kind }) => kind === "reserved-job-name").length,
    jobIds.length,
  );
  assert.equal(
    result.matches.filter(({ kind }) => kind === "codex-review-gate-action-caller").length,
    jobIds.length,
  );
});

test("ignores YAML-looking block scalar contents while retaining selectors and run publishers", () => {
  const selectors = inspectWorkflowGateSignals([
    "jobs:",
    "  build:",
    "    steps:",
    "      - run: |",
    '          "uses": JoeyTeng/codex-review-gate-action@v2',
    "          check-name: codex/github-review-gate",
    "        with:",
    "          script: >",
    "            uses: JoeyTeng/codex-review-gate-action@v2",
    "            context: codex/github-review-gate",
    "      - uses: JoeyTeng/codex-review-gate-action@v2",
  ].join("\n"));
  assert.deepEqual(
    selectors.matches.map(({ kind }) => kind),
    ["codex-review-gate-action-caller"],
  );

  const publishers = [
    [
      "gh api repos/example/repo/check-runs --method POST -f name=codex/github-review-gate -f head_sha=0123456789abcdef0123456789abcdef01234567",
      "reserved-check-run-name",
    ],
    [
      `curl -X POST -d '{"context":"codex/github-review-gate","state":"success"}' https://api.github.com/repos/o/r/statuses/$SHA`,
      "reserved-status-context",
    ],
  ];
  for (const [command, expectedKind] of publishers) {
    const result = inspectWorkflowGateSignals([
      "jobs:",
      "  publish:",
      "    steps:",
      "      - run: |",
      `          ${command}`,
    ].join("\n"));
    assert.deepEqual(result.matches.map(({ kind }) => kind), [expectedKind], command);
  }
});

test("finds a literal caller preceded by a simple YAML anchor", () => {
  const result = inspectWorkflowGateSignals([
    "jobs:",
    "  reuse:",
    "    steps:",
    "      - uses: &gate JoeyTeng/codex-review-gate-action@v2",
  ].join("\n"));
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].kind, "codex-review-gate-action-caller");
});

test("resolves bounded scalar aliases only within their YAML document", () => {
  const caller = inspectWorkflowGateSignals([
    "env: { ACTION: &gate JoeyTeng/codex-review-gate-action@v2 }",
    "jobs:",
    "  build:",
    "    steps:",
    "      - uses: *gate",
  ].join("\n"));
  assert.equal(caller.matches.length, 1);
  assert.equal(caller.matches[0].kind, "codex-review-gate-action-caller");

  const checkout = inspectWorkflowGateSignals([
    "env: { ACTION: &checkout actions/checkout@v4 }",
    "jobs:",
    "  build:",
    "    steps:",
    "      - uses: *checkout",
  ].join("\n"));
  assert.deepEqual(checkout.matches, []);
  assert.deepEqual(checkout.warnings, []);

  const unknown = inspectWorkflowGateSignals("uses: *missing");
  assert.deepEqual(unknown.matches, []);
  assert.ok(unknown.warnings.some(({ kind }) => kind === "unknown-yaml-scalar-alias"));

  const complex = inspectWorkflowGateSignals("uses: *known + suffix");
  assert.deepEqual(complex.matches, []);
  assert.ok(complex.warnings.some(({ kind }) => kind === "complex-yaml-scalar-alias"));

  const crossDocument = inspectWorkflowGateSignals([
    "env: { ACTION: &gate JoeyTeng/codex-review-gate-action@v2 }",
    "---",
    "uses: *gate",
  ].join("\n"));
  assert.deepEqual(crossDocument.matches, []);
  assert.ok(crossDocument.warnings.some(({ kind }) => kind === "unknown-yaml-scalar-alias"));

  const shellText = inspectWorkflowGateSignals([
    "env: { ACTION: &gate JoeyTeng/codex-review-gate-action@v2 }",
    "run: echo \"$gate\"",
  ].join("\n"));
  assert.deepEqual(shellText.matches, []);

  const replacedByFolded = inspectWorkflowGateSignals([
    "env: { ACTION: &gate JoeyTeng/codex-review-gate-action@v2 }",
    "env: { ACTION: &gate >- }",
    "uses: *gate",
  ].join("\n"));
  assert.deepEqual(replacedByFolded.matches, []);
  assert.ok(replacedByFolded.warnings.some(({ kind }) => kind === "complex-yaml-scalar-anchor"));
  assert.ok(replacedByFolded.warnings.some(({ kind }) => kind === "unknown-yaml-scalar-alias"));
});

test("warns instead of resolving anchors past the per-document cap", () => {
  const declarations = Array.from(
    { length: 33 },
    (_, index) => `env: { ACTION: &a${index} value${index} }`,
  );
  const result = inspectWorkflowGateSignals([...declarations, "uses: *a32"].join("\n"));
  assert.deepEqual(result.matches, []);
  assert.ok(result.warnings.some(({ kind }) => kind === "yaml-scalar-anchor-limit"));
  assert.ok(result.warnings.some(({ kind }) => kind === "unknown-yaml-scalar-alias"));
});

test("finds known caller literals on the next line of folded uses scalars", () => {
  const result = inspectWorkflowGateSignals([
    "jobs:",
    "  folded:",
    "    steps:",
    "      - uses: >-",
    "          JoeyTeng/codex-review-gate-action@v2",
    "      - uses: >",
    "          Joey-Tools/codex-review-gate/.github/workflows/codex-review-gate.yml@v1",
  ].join("\n"));

  assert.deepEqual(
    result.matches.map(({ kind }) => kind),
    ["codex-review-gate-action-caller", "legacy-codex-review-gate-caller"],
  );
});

test("keeps YAML scalar identity separate from executable literal tracking", () => {
  const yamlConcatenation = inspectWorkflowGateSignals(`context: 'codex/' + 'github-review-gate'`);
  assert.deepEqual(yamlConcatenation.matches, []);

  const variables = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: prefix='codex/'; suffix='github-review-gate'; context=\"$prefix$suffix\"",
  ].join("\r\n"));
  assert.deepEqual(variables.matches, []);

  const jsVariables = inspectWorkflowGateSignals([
    "const prefix = 'codex/';",
    "const suffix = 'github-review-gate';",
    "const context = prefix + suffix;",
  ].join("\n"));
  assert.deepEqual(jsVariables.matches, []);
  assert.deepEqual(
    inspectWorkflowGateSignals("run: context=codex/github-review-gate").matches,
    [],
  );

  const assignedPublisher = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: |",
    "          context=codex/github-review-gate",
    "          gh api repos/o/r/statuses/$SHA -f context=codex/github-review-gate -f state=success",
  ].join("\n"));
  assert.deepEqual(
    assignedPublisher.matches.map(({ kind }) => kind),
    ["reserved-status-context"],
  );

  for (const source of [
    'run: echo "x; context=codex/github-review-gate; y"',
    "run: echo 'x; context=codex/github-review-gate; y'",
    "run: echo x\\; context=codex/github-review-gate\\; y",
  ]) {
    assert.deepEqual(inspectWorkflowGateSignals(source).matches, [], source);
  }
});

test("finds exact CLI payload and inline JavaScript or JSON context literals", () => {
  const cli = inspectWorkflowGateSignals([
    "run: gh api repos/example/repo/statuses/$SHA -f context=CoDeX/GitHub-Review-Gate -f state=success",
    "run: gh api repos/example/repo/statuses/$SHA --field 'context=codex/github-review-gate' -f state=success",
    "run: gh api repos/o/r/statuses/$SHA --raw-field context=codex/github-review-gate -f state=success",
    "run: gh api repos/example/repo/statuses/$SHA -f context=codex/github-review-gate-extra -f state=success",
  ].join("\n"));
  assert.equal(cli.matches.length, 3);
  assert.ok(cli.matches.every(({ kind }) => kind === "reserved-status-context"));

  const dynamicState = inspectWorkflowGateSignals(
    "run: gh api repos/o/r/statuses/$SHA -f context=codex/github-review-gate -f state=$STATE",
  );
  assert.deepEqual(dynamicState.matches.map(({ kind }) => kind), ["reserved-status-context"]);

  const checkRunCase = inspectWorkflowGateSignals([
    "run: gh api repos/o/r/check-runs -f name=CoDeX/GitHub-Review-Gate -f head_sha=abc",
    "run: gh api repos/o/r/check-runs -f name=codex/github-review-gate -f head_sha=abc",
  ].join("\n"));
  assert.deepEqual(checkRunCase.matches.map(({ kind }) => kind), ["reserved-check-run-name"]);
  assert.equal(checkRunCase.matches[0].line, 2);

  const nonAsciiContext = inspectWorkflowGateSignals(
    "run: gh api repos/o/r/statuses/$SHA -f context=code\u212a/github-review-gate -f state=success",
    { reservedCheckName: "codek/github-review-gate" },
  );
  assert.deepEqual(nonAsciiContext.matches, [], "status identity does not use Unicode case folds");
  assert.deepEqual(inspectWorkflowGateSignals("jobs:\n  gate:\n    name: CoDeX/GitHub-Review-Gate").matches, []);

  const nonPublishers = inspectWorkflowGateSignals([
    "run: echo -f context=codex/github-review-gate",
    "run: jq -f context=codex/github-review-gate",
    "run: gh api repos/o/r/statuses/$SHA --method GET --raw-field context=codex/github-review-gate",
    "run: gh api repos/o/r/releases --raw-field context=codex/github-review-gate",
    "run: gh api repos/o/r/statuses/$SHA -f context=codex/github-review-gate",
    "run: gh api repos/o/r/statuses/$SHA -f context=codex/github-review-gate -f state=",
    "run: gh api repos/o/r/statuses/$SHA -f context=codex/github-review-gate -f State=success",
    "run: gh api repos/o/r/statuses/$SHA -f context=codex/github-review-gate -f state=success -f state=failure",
  ].join("\n"));
  assert.deepEqual(nonPublishers.matches, []);
  assert.equal(
    nonPublishers.warnings.filter(({ kind }) => kind === "reserved-status-context-reference").length,
    8,
  );

  const endpointMarkersInData = inspectWorkflowGateSignals([
    "run: gh api graphql -f 'query={ checkRuns # /check-runs /statuses/$SHA }' -f name=codex/github-review-gate",
    "run: gh api graphql -f 'query={ statuses # /statuses/$SHA /check-runs }' -f context=codex/github-review-gate",
    "run: gh api repos/o/r/releases -f note='/check-runs /statuses/$SHA' -f name=codex/github-review-gate",
    "run: gh api --header=example/check-runs graphql -f name=codex/github-review-gate",
  ].join("\n"));
  assert.deepEqual(endpointMarkersInData.matches, []);

  const inline = inspectWorkflowGateSignals([
    "check-name: codex/github-review-gate",
    `const payload = { context: "codex/github-review-gate" };`,
    `const payload = JSON.parse('{"context":"codex/github-review-gate"}');`,
  ].join("\n"));
  assert.equal(inline.matches.length, 2);
  assert.ok(
    inline.warnings.some(
      ({ kind, line }) => kind === "reserved-status-context-reference" && line === 3,
    ),
  );
});

test("filters literal API publishers for a known foreign repository only", () => {
  const cli = "run: gh api repos/other/repo/statuses/$SHA -f context=codex/github-review-gate -f state=success";
  const curl = `run: curl -X POST -d '{"context":"codex/github-review-gate","state":"success"}' https://api.github.com/repos/other/repo/statuses/$SHA`;
  const sameTarget = [
    "run: gh api repos/target/repo/statuses/$SHA -f context=codex/github-review-gate -f state=success",
    `run: curl -X POST -d '{"context":"codex/github-review-gate","state":"success"}' https://api.github.com/repos/TARGET/REPO/statuses/$SHA`,
  ].join("\n");
  assert.equal(
    inspectWorkflowGateSignals(sameTarget, { repositoryFullName: "target/repo" }).matches.length,
    2,
  );

  for (const source of [
    cli,
    curl,
    'run: gh api repos/other-owner/other-repo/check-runs -f name=codex/github-review-gate -f head_sha="$SHA"',
    `run: curl -X POST -d '{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}' https://api.github.com/repos/other/repo/check-runs`,
  ]) {
    assert.equal(
      inspectWorkflowGateSignals(source, { repositoryFullName: "target/repo" }).matches.length,
      0,
      source,
    );
    assert.equal(inspectWorkflowGateSignals(source).matches.length, 1, source);
  }

  for (const endpoint of [
    "repos/$OWNER/repo/statuses/$SHA",
    "repos/other%2Fowner/repo/statuses/$SHA",
  ]) {
    const unknownTarget = `run: gh api ${endpoint} -f context=codex/github-review-gate -f state=success`;
    assert.equal(
      inspectWorkflowGateSignals(unknownTarget, { repositoryFullName: "target/repo" }).matches.length,
      1,
      endpoint,
    );
  }
});

test("does not follow repository rename redirects when filtering known targets", () => {
  const currentSlug = inspectWorkflowGateSignals(
    `run: curl -L -X POST -d '{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}' https://api.github.com/repos/acme/new-name/check-runs`,
    { repositoryFullName: "acme/new-name" },
  );
  assert.deepEqual(currentSlug.matches.map(({ kind }) => kind), ["reserved-check-run-name"]);

  const oldSlug = inspectWorkflowGateSignals(
    `run: curl -L -X POST -d '{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}' https://api.github.com/repos/acme/old-name/check-runs`,
    { repositoryFullName: "acme/new-name" },
  );
  assert.deepEqual(oldSlug.matches, []);
});

test("keeps shell-function-shadowed literal CheckRun publishers blocking", () => {
  const result = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: |",
    "          gh() { :; }",
    "          gh api repos/o/r/check-runs -f name=codex/github-review-gate -f head_sha=0123456789abcdef0123456789abcdef01234567",
  ].join("\n"));

  assert.deepEqual(result.matches.map(({ kind }) => kind), ["reserved-check-run-name"]);
});

test("keeps quoted JSON.parse text inside a YAML step name warning-only", () => {
  const result = inspectWorkflowGateSignals([
    "jobs:",
    "  build:",
    "    steps:",
    `      - name: JSON.parse('{"context":"codex/github-review-gate"}')`,
    "        run: echo ready",
  ].join("\n"));

  assert.deepEqual(result.matches, []);
  assert.ok(result.warnings.some(({ kind }) => kind === "reserved-status-context-reference"));
});

test("limits CLI publisher fields and methods to the first shell command", () => {
  const firstCommandWriter = inspectWorkflowGateSignals(
    "run: gh api repos/o/r/check-runs -f name=codex/github-review-gate -f head_sha=0123456789abcdef0123456789abcdef01234567 && echo --method GET -f name=other",
  );
  assert.deepEqual(
    firstCommandWriter.matches.map(({ kind }) => kind),
    ["reserved-check-run-name"],
  );

  for (const command of [
    "run: gh api repos/o/r/check-runs -f head_sha=0123456789abcdef0123456789abcdef01234567 && echo -f name=codex/github-review-gate",
    "run: gh api repos/o/r/check-runs -f context=ordinary; echo -f context=codex/github-review-gate",
    "run: gh api repos/o/r/releases; gh api repos/o/r/check-runs -f name=codex/github-review-gate",
  ]) {
    assert.deepEqual(inspectWorkflowGateSignals(command).matches, [], command);
  }

  const quotedSeparators = inspectWorkflowGateSignals(
    "run: gh api graphql -f 'query={ checkRuns; statuses & other | fields }' -f context=codex/github-review-gate",
  );
  assert.deepEqual(quotedSeparators.matches, []);

  const quotedPayloadWriter = inspectWorkflowGateSignals(
    "run: gh api repos/o/r/statuses/$SHA -f note='first; second | third' --raw-field context=codex/github-review-gate -f state=success",
  );
  assert.deepEqual(
    quotedPayloadWriter.matches.map(({ kind }) => kind),
    ["reserved-status-context"],
  );
});

test("keeps CLI publisher fields on the supported GitHub host and inline body", () => {
  const explicitGitHub = inspectWorkflowGateSignals(
    "run: gh api repos/o/r/check-runs --hostname github.com -f name=codex/github-review-gate -f head_sha=0123456789abcdef0123456789abcdef01234567",
  );
  assert.equal(explicitGitHub.matches.length, 1);
  assert.equal(explicitGitHub.matches[0].kind, "reserved-check-run-name");

  const unsupportedHost = inspectWorkflowGateSignals(
    "run: gh api repos/o/r/check-runs --hostname ghe.example.com -f name=codex/github-review-gate -f head_sha=0123456789abcdef0123456789abcdef01234567",
  );
  assert.deepEqual(unsupportedHost.matches, []);

  const inputBodies = inspectWorkflowGateSignals([
    "run: gh api repos/o/r/check-runs --input body.json -f name=codex/github-review-gate -f head_sha=0123456789abcdef0123456789abcdef01234567",
    "run: gh api repos/o/r/statuses/$SHA --input=- --raw-field context=codex/github-review-gate",
  ].join("\n"));
  assert.deepEqual(inputBodies.matches, []);
});

test("leaves implicit-host CLI publishers unclassified when GH_HOST is mentioned", () => {
  const source = [
    "# GH_HOST can redirect the API host",
    "run: gh api repos/o/r/check-runs -f name=codex/github-review-gate -f head_sha=0123456789abcdef0123456789abcdef01234567",
    "run: gh api repos/o/r/check-runs --hostname github.com -f name=codex/github-review-gate -f head_sha=0123456789abcdef0123456789abcdef01234567",
  ].join("\n");
  const result = inspectWorkflowGateSignals(source);
  assert.deepEqual(result.matches.map(({ kind }) => kind), ["reserved-check-run-name"]);
  assert.equal(
    result.warnings.filter(({ kind }) => kind === "cli-host-override-unclassified").length,
    1,
  );
});

test("does not treat CLI query or fragment text as GitHub API route segments", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const fakeRoutes = [
    `run: gh api 'repos/o/r?probe/check-runs' -f name=codex/github-review-gate -f head_sha=${sha}`,
    `run: gh api 'repos/o?probe/r/check-runs' -f name=codex/github-review-gate -f head_sha=${sha}`,
    `run: gh api 'repos/o/r#fragment/check-runs' -f name=codex/github-review-gate -f head_sha=${sha}`,
    `run: gh api 'repos/o/r/check-runs?probe/check-runs' -f name=codex/github-review-gate -f head_sha=${sha}`,
    `run: gh api 'repos/o/r/check-runs#fragment/check-runs' -f name=codex/github-review-gate -f head_sha=${sha}`,
    "run: gh api 'repos/o?probe/r/statuses/$SHA' -f context=codex/github-review-gate -f state=success",
    "run: gh api 'repos/o/r#fragment/statuses/$SHA' -f context=codex/github-review-gate -f state=success",
    "run: gh api 'repos/o/r/statuses/$SHA?probe/statuses/$SHA' -f context=codex/github-review-gate -f state=success",
    "run: gh api 'repos/o/r/statuses/$SHA#fragment/statuses/$SHA' -f context=codex/github-review-gate -f state=success",
  ];

  for (const command of fakeRoutes) {
    const result = inspectWorkflowGateSignals(command);
    assert.deepEqual(result.matches, [], command);
    assert.ok(
      result.warnings.some(({ kind }) => kind === "reserved-status-context-reference"),
      command,
    );
  }

  for (const endpoint of [
    "repos/o/r/check-runs?probe=1",
    "repos/o/r/check-runs#fragment",
    "repos/o/r/statuses/$SHA?probe=1",
    "repos/o/r/statuses/$SHA#fragment",
  ]) {
    const result = inspectWorkflowGateSignals(
      `run: gh api '${endpoint}' -f name=codex/github-review-gate -f head_sha=${sha} -f context=codex/github-review-gate -f state=success`,
    );
    assert.deepEqual(result.matches, [], endpoint);
  }
});

test("leaves gh api repository placeholders unclassified only when GH_REPO is mentioned", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const placeholderPublishers = [
    `run: gh api 'repos/{owner}/{repo}/check-runs' -f name=codex/github-review-gate -f head_sha=${sha}`,
    `run: gh api 'repos/{owner}/repo/check-runs' -f name=codex/github-review-gate -f head_sha=${sha}`,
    `run: gh api 'repos/owner/{repo}/check-runs' -f name=codex/github-review-gate -f head_sha=${sha}`,
    "run: gh api 'repos/{owner}/{repo}/check-runs/123' --method PATCH -f name=codex/github-review-gate",
    "run: gh api 'repos/{owner}/{repo}/statuses/$SHA' -f context=codex/github-review-gate -f state=success",
  ];

  const withoutMention = inspectWorkflowGateSignals(placeholderPublishers.join("\n"));
  assert.deepEqual(
    withoutMention.matches.map(({ kind }) => kind),
    ["reserved-check-run-name", "reserved-check-run-name", "reserved-check-run-name", "reserved-check-run-name", "reserved-status-context"],
  );

  for (const mention of [
    "env:\n  GH_REPO: other/other",
    "# GH_REPO may override gh api placeholder routing",
    "env:\n  GH_REPO: $GH_REPO",
    "with:\n  note: GH_REPO is supplied by the runner",
  ]) {
    const result = inspectWorkflowGateSignals([mention, ...placeholderPublishers].join("\n"));
    assert.deepEqual(result.matches, [], mention);
    assert.equal(
      result.warnings.filter(({ kind }) => kind === "cli-repository-override-unclassified").length,
      1,
      mention,
    );
  }

  const literalEndpoints = inspectWorkflowGateSignals([
    "# GH_REPO may affect placeholder endpoints only",
    `run: gh api repos/example/repo/check-runs -f name=codex/github-review-gate -f head_sha=${sha}`,
    `run: gh api repos/another/repo/check-runs -f name=codex/github-review-gate -f head_sha=${sha}`,
    "run: gh api repos/example/repo/statuses/$SHA -f context=codex/github-review-gate -f state=success",
  ].join("\n"), { repositoryFullName: "example/repo" });
  assert.deepEqual(
    literalEndpoints.matches.map(({ kind }) => kind),
    ["reserved-check-run-name", "reserved-status-context"],
  );
});

test("matches a literal publisher in a statically false step without evaluating conditions", () => {
  const result = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - if: ${{ false }}",
    "        run: gh api repos/o/r/check-runs -f name=codex/github-review-gate -f head_sha=0123456789abcdef0123456789abcdef01234567",
  ].join("\n"));

  assert.deepEqual(result.matches.map(({ kind }) => kind), ["reserved-check-run-name"]);
});

test("finds a reserved CheckRun name only beside the explicit check-runs API", () => {
  const publisher = inspectWorkflowGateSignals(
    "run: gh api repos/example/repo/check-runs -f name=codex/github-review-gate -f head_sha=0123456789abcdef0123456789abcdef01234567",
  );
  assert.equal(publisher.matches.length, 1);
  assert.equal(publisher.matches[0].kind, "reserved-check-run-name");

  const rawField = inspectWorkflowGateSignals(
    "run: gh api repos/o/r/check-runs --raw-field name=codex/github-review-gate --raw-field head_sha=0123456789abcdef0123456789abcdef01234567",
  );
  assert.equal(rawField.matches.length, 1);
  assert.equal(rawField.matches[0].kind, "reserved-check-run-name");
  const typedShortField = inspectWorkflowGateSignals(
    'run: gh api repos/o/r/check-runs -F name=codex/github-review-gate -F head_sha="$GITHUB_SHA"',
  );
  assert.deepEqual(typedShortField.matches.map(({ kind }) => kind), ["reserved-check-run-name"]);

  const quotedEndpoint = inspectWorkflowGateSignals(
    "run: gh api '/repos/o/r/check-runs/123' --method PATCH -f name=codex/github-review-gate",
  );
  assert.equal(quotedEndpoint.matches.length, 1);
  assert.equal(quotedEndpoint.matches[0].kind, "reserved-check-run-name");

  const quotedEndpointPrefix = inspectWorkflowGateSignals(
    "run: gh api 'repos/o/r/check-runs'/123 -f name=codex/github-review-gate",
  );
  assert.deepEqual(quotedEndpointPrefix.matches, []);

  const explicitPost = inspectWorkflowGateSignals(
    "run: gh api repos/o/r/check-runs --method POST -f name=codex/github-review-gate -f head_sha=0123456789abcdef0123456789abcdef01234567",
  );
  assert.equal(explicitPost.matches[0].kind, "reserved-check-run-name");

  for (const method of ["--method PATCH", "--method=PATCH", "-X PATCH"]) {
    const updater = inspectWorkflowGateSignals(
      `run: gh api repos/o/r/check-runs/123 ${method} -f name=codex/github-review-gate`,
    );
    assert.equal(updater.matches.length, 1, method);
    assert.equal(updater.matches[0].kind, "reserved-check-run-name", method);
  }

  for (const checkRunId of ["abc", "0", "-1", "+1", "01", "1.5"]) {
    const unsupportedUpdater = inspectWorkflowGateSignals(
      `run: gh api repos/o/r/check-runs/${checkRunId} --method PATCH -f name=codex/github-review-gate`,
    );
    assert.deepEqual(unsupportedUpdater.matches, [], checkRunId);
  }

  for (const method of ["--method GET", "--method=GET", "-X GET", "--method HEAD"]) {
    const reader = inspectWorkflowGateSignals(
      `run: gh api repos/o/r/check-runs ${method} -f name=codex/github-review-gate -f head_sha=0123456789abcdef0123456789abcdef01234567`,
    );
    assert.deepEqual(reader.matches, [], method);
    assert.ok(reader.warnings.some(({ kind }) => kind === "reserved-status-context-reference"), method);
  }

  for (const methods of [
    "--method POST --method GET",
    "--method=POST --method=HEAD",
    "-X POST --method PATCH",
    "--method POST -XGET",
    "-XPOST -XGET",
  ]) {
    const ambiguous = inspectWorkflowGateSignals(
      `run: gh api repos/o/r/check-runs ${methods} -f name=codex/github-review-gate -f head_sha=0123456789abcdef0123456789abcdef01234567`,
    );
    assert.deepEqual(ambiguous.matches, [], methods);
    assert.ok(
      ambiguous.warnings.some(({ kind }) => kind === "reserved-status-context-reference"),
      methods,
    );
  }

  for (const methodLikeValue of [
    "run: gh api repos/o/r/check-runs -H 'X-Note: --method GET' -f name=codex/github-review-gate -f head_sha=0123456789abcdef0123456789abcdef01234567",
    "run: gh api repos/o/r/check-runs -f note=' --method GET' -f name=codex/github-review-gate -f head_sha=0123456789abcdef0123456789abcdef01234567",
    "run: gh api repos/o/r/check-runs/123 --method=PATCH -H 'X-Note: --method HEAD' -f name=codex/github-review-gate",
  ]) {
    const publisher = inspectWorkflowGateSignals(methodLikeValue);
    assert.deepEqual(
      publisher.matches.map(({ kind }) => kind),
      ["reserved-check-run-name"],
      methodLikeValue,
    );
  }

  const implicitItemPost = inspectWorkflowGateSignals(
    "run: gh api repos/o/r/check-runs/123 -f name=codex/github-review-gate",
  );
  assert.deepEqual(implicitItemPost.matches, []);
  const headerFieldText = inspectWorkflowGateSignals(
    "run: gh api repos/o/r/check-runs -H 'X-Note: -f name=codex/github-review-gate' -f other=value -f head_sha=0123456789abcdef0123456789abcdef01234567",
  );
  assert.deepEqual(headerFieldText.matches, []);
  const repeatedName = inspectWorkflowGateSignals(
    "run: gh api repos/o/r/check-runs -f name=codex/github-review-gate -f name=ordinary -f head_sha=0123456789abcdef0123456789abcdef01234567",
  );
  assert.deepEqual(repeatedName.matches, []);
  for (const source of [
    "run: gh api repos/o/r/check-runs -H '-f=name=codex/github-review-gate' -f other=value -f head_sha=0123456789abcdef0123456789abcdef01234567",
    "run: gh api repos/o/r/check-runs --jq '-f=name=codex/github-review-gate' -f other=value -f head_sha=0123456789abcdef0123456789abcdef01234567",
    "run: gh api repos/o/r/check-runs -f Name=codex/github-review-gate -f head_sha=0123456789abcdef0123456789abcdef01234567",
    "run: gh api repos/o/r/check-runs -f",
    "NAME=codex/github-review-gate\nrun: gh api repos/o/r/check-runs -f name='$NAME' -f head_sha=0123456789abcdef0123456789abcdef01234567",
    "NAME=codex/github-review-gate\nrun: gh api repos/o/r/check-runs -f name=$NAME -f head_sha=0123456789abcdef0123456789abcdef01234567",
    `run: gh api repos/o/r/check-runs -f "name=codex\\/github-review-gate" -f head_sha=0123456789abcdef0123456789abcdef01234567`,
  ]) {
    assert.deepEqual(inspectWorkflowGateSignals(source).matches, [], source);
  }

  const unrelated = inspectWorkflowGateSignals(
    "run: gh api repos/example/releases -f name=codex/github-review-gate -f head_sha=0123456789abcdef0123456789abcdef01234567",
  );
  assert.deepEqual(unrelated.matches, []);
  assert.ok(unrelated.warnings.some(({ kind }) => kind === "reserved-status-context-reference"));

  const blockScalar = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: |",
    "          gh api repos/example/repo/check-runs -f name=codex/github-review-gate -f head_sha=0123456789abcdef0123456789abcdef01234567",
  ].join("\n"));
  assert.equal(blockScalar.matches.length, 1);
  assert.equal(blockScalar.matches[0].kind, "reserved-check-run-name");
});

test("requires one nonempty supported head_sha field for CLI CheckRun creation", () => {
  const missingHeadSha = "run: gh api repos/o/r/check-runs -f name=codex/github-review-gate";
  for (const [label, source] of [
    ["missing", missingHeadSha],
    ["empty", `${missingHeadSha} -f head_sha=`],
    ["missing value", `${missingHeadSha} -f head_sha`],
    ["quoted empty", `${missingHeadSha} --raw-field 'head_sha='`],
    ["wrong key", `${missingHeadSha} -f sha=abc`],
    ["case-sensitive key", `${missingHeadSha} -f HEAD_SHA=0123456789abcdef0123456789abcdef01234567`],
    ["non-field prose", `${missingHeadSha} -H 'X-Note: head_sha=0123456789abcdef0123456789abcdef01234567'`],
    ["duplicate", `${missingHeadSha} -f head_sha=0123456789abcdef0123456789abcdef01234567 -F head_sha=def`],
  ]) {
    assert.deepEqual(inspectWorkflowGateSignals(source).matches, [], label);
  }
  for (const argument of [
    '-f head_sha="$GITHUB_SHA"',
    '-F head_sha="$GITHUB_SHA"',
    '--field head_sha="$GITHUB_SHA"',
    '--raw-field head_sha="$GITHUB_SHA"',
    '-f=head_sha="$GITHUB_SHA"',
    '-F=head_sha="$GITHUB_SHA"',
    '--field=head_sha="$GITHUB_SHA"',
    '--raw-field=head_sha="$GITHUB_SHA"',
    '-f head_sha=not-a-sha',
  ]) {
    assert.deepEqual(
      inspectWorkflowGateSignals(`${missingHeadSha} ${argument}`).matches.map(({ kind }) => kind),
      ["reserved-check-run-name"],
      `${argument}: presence only, not shell expansion or SHA validation`,
    );
  }
});

test("records source-only typed head_sha false positives as accepted behavior", () => {
  const checkRun = "run: gh api repos/o/r/check-runs -f name=codex/github-review-gate";
  for (const value of ["null", "true", "false", "12", "-12"]) {
    for (const argument of [
      `-F head_sha=${value}`,
      `-F=head_sha=${value}`,
      `--field head_sha=${value}`,
      `--field=head_sha=${value}`,
    ]) {
      assert.deepEqual(
        inspectWorkflowGateSignals(`${checkRun} ${argument}`).matches.map(({ kind }) => kind),
        ["reserved-check-run-name"],
        `${argument}: source-only accepted typed-field false positive`,
      );
    }
    for (const argument of [
      `-f head_sha=${value}`,
      `-f=head_sha=${value}`,
      `--raw-field head_sha=${value}`,
      `--raw-field=head_sha=${value}`,
    ]) {
      assert.deepEqual(
        inspectWorkflowGateSignals(`${checkRun} ${argument}`).matches.map(({ kind }) => kind),
        ["reserved-check-run-name"],
        `${argument}: raw-field text presence control`,
      );
    }
  }
});

test("skips known run blocks containing here-document-like text conservatively", () => {
  const heredoc = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: |",
    "          cat >config <<'EOF'",
    "          context=codex/github-review-gate",
    "          gh api repos/o/r/check-runs -f name=codex/github-review-gate -f head_sha=0123456789abcdef0123456789abcdef01234567",
    "          EOF",
  ].join("\n"));
  assert.deepEqual(heredoc.matches, []);
  assert.ok(heredoc.warnings.some(({ kind }) => kind === "unclassified-run-block"));
  assert.ok(heredoc.warnings.some(({ kind }) => kind === "reserved-status-context-reference"));

  const isolated = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: NAME=codex/github-review-gate",
    "      - run: |",
    "          cat <<EOF",
    "          ordinary data",
    "          EOF",
    '      - run: context="$NAME"',
  ].join("\n"));
  assert.deepEqual(isolated.matches, []);
  assert.ok(isolated.warnings.some(({ kind }) => kind === "unclassified-run-block"));

  const ordinaryRunBlock = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: |",
    "          gh api repos/o/r/check-runs -f name=codex/github-review-gate -f head_sha=0123456789abcdef0123456789abcdef01234567",
  ].join("\n"));
  assert.equal(ordinaryRunBlock.matches.length, 1);
  assert.equal(ordinaryRunBlock.matches[0].kind, "reserved-check-run-name");
});

test("keeps folded run blocks unclassified instead of scanning physical shell lines", () => {
  for (const indicator of [">", ">-", ">+"]) {
    const folded = inspectWorkflowGateSignals([
      "jobs:",
      "  publish:",
      "    steps:",
      `      - run: ${indicator}`,
      "          echo harmless",
      "          gh api repos/o/r/check-runs -f name=codex/github-review-gate -f head_sha=0123456789abcdef0123456789abcdef01234567",
    ].join("\n"));
    assert.deepEqual(folded.matches, [], indicator);
    assert.ok(folded.warnings.some(({ kind }) => kind === "unclassified-run-block"), indicator);
    assert.ok(
      folded.warnings.some(({ kind }) => kind === "reserved-status-context-reference"),
      indicator,
    );
  }

  const literal = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: |",
    "          gh api repos/o/r/check-runs -f name=codex/github-review-gate -f head_sha=0123456789abcdef0123456789abcdef01234567",
  ].join("\n"));
  assert.equal(literal.matches.length, 1);
  assert.equal(literal.matches[0].kind, "reserved-check-run-name");
});

test("finds inline JSON CheckRun POST names across common curl data flags", () => {
  const options = ["-d", "--data", "--data-raw", "--data-binary", "--json"];
  for (const option of options) {
    const result = inspectWorkflowGateSignals(
      `run: curl -X POST ${option} '{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}' https://api.github.com/repos/example/repo/check-runs`,
    );
    assert.equal(result.matches.length, 1, option);
    assert.equal(result.matches[0].kind, "reserved-check-run-name", option);
  }

  const nestedName = inspectWorkflowGateSignals(
    `run: curl -X POST -d '{"head_sha":"0123456789abcdef0123456789abcdef01234567","output":{"name":"codex/github-review-gate"}}' https://api.github.com/repos/o/r/check-runs`,
  );
  assert.deepEqual(nestedName.matches, []);

  const nonPublishers = inspectWorkflowGateSignals([
    `run: curl -X POST --data-urlencode '{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}' https://api.github.com/repos/example/repo/check-runs`,
    `run: echo "curl -X POST -d '{\"name\":\"codex/github-review-gate\"}' https://api.github.com/repos/example/repo/check-runs"`,
    `run: curl -X GET -d '{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}' https://api.github.com/repos/example/repo/check-runs`,
    `run: curl -X POST -d '{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}' https://api.github.com/repos/example/repo/releases`,
    `run: curl -X POST -d '{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}' https://api.github.com/repos/example/repo/releases; echo https://api.github.com/repos/example/repo/check-runs`,
    "run: jq '.name == \"codex/github-review-gate\"' payload.json",
    `run: curl -X POST -d '{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}'`,
    "run: echo https://api.github.com/repos/example/repo/check-runs",
  ].join("\n"));
  assert.deepEqual(nonPublishers.matches, []);
});

test("requires a nonempty top-level string head_sha for curl CheckRun creation", () => {
  for (const [label, fields] of [
    ["missing", {}],
    ["empty", { head_sha: "" }],
    ["null", { head_sha: null }],
    ["number", { head_sha: 12 }],
    ["boolean", { head_sha: true }],
    ["array", { head_sha: ["0123456789abcdef0123456789abcdef01234567"] }],
    ["object", { head_sha: { value: "0123456789abcdef0123456789abcdef01234567" } }],
    ["nested", { output: { head_sha: "0123456789abcdef0123456789abcdef01234567" } }],
    ["wrong key", { HEAD_SHA: "0123456789abcdef0123456789abcdef01234567" }],
  ]) {
    const payload = JSON.stringify({ name: "codex/github-review-gate", ...fields });
    const result = inspectWorkflowGateSignals(
      `run: curl -X POST -d '${payload}' https://api.github.com/repos/o/r/check-runs`,
    );
    assert.deepEqual(result.matches, [], label);
    assert.ok(result.warnings.some(({ kind }) => kind === "reserved-status-context-reference"), label);
  }
  const presenceOnly = inspectWorkflowGateSignals(
    `run: curl -X POST -d '{"name":"codex/github-review-gate","head_sha":"not-a-sha"}' https://api.github.com/repos/o/r/check-runs`,
  );
  assert.deepEqual(presenceOnly.matches.map(({ kind }) => kind), ["reserved-check-run-name"]);
});

test("preserves curl request-method case and rejects attached short-option equals rewrites", () => {
  const payload = `'{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}'`;
  const endpoint = "https://api.github.com/repos/o/r/check-runs";
  for (const command of [
    `curl -X post -d ${payload} ${endpoint}`,
    `curl --request post -d ${payload} ${endpoint}`,
    `curl --request=post --data=${payload} ${endpoint}`,
    `curl -X=POST -d ${payload} ${endpoint}`,
    `curl -X POST -d=${payload} ${endpoint}`,
  ]) {
    assert.deepEqual(inspectWorkflowGateSignals(`run: ${command}`).matches, [], command);
  }

  const attachedLongOptions = inspectWorkflowGateSignals(
    `run: curl --request=POST --data=${payload} ${endpoint}`,
  );
  assert.deepEqual(
    attachedLongOptions.matches.map(({ kind }) => kind),
    ["reserved-check-run-name"],
  );
});

test("uses curl URL operands rather than header or later-command text", () => {
  const headerUrl = inspectWorkflowGateSignals(
    `run: curl -X POST -H 'Link: https://api.github.com/repos/o/r/check-runs' -d '{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}' https://example.com/audit`,
  );
  assert.deepEqual(headerUrl.matches, []);

  const headerAccept = inspectWorkflowGateSignals(
    `run: curl -H 'Accept: application/vnd.github+json' -X POST -d '{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}' --url https://api.github.com/repos/o/r/check-runs`,
  );
  assert.equal(headerAccept.matches.length, 1);
  assert.equal(headerAccept.matches[0].kind, "reserved-check-run-name");

  const laterCommand = inspectWorkflowGateSignals(
    `run: curl -X POST -d '{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}' https://api.github.com/repos/o/r/releases && echo -H 'Link: https://api.github.com/repos/o/r/check-runs'`,
  );
  assert.deepEqual(laterCommand.matches, []);

  const unsupportedOption = inspectWorkflowGateSignals(
    `run: curl --config request.conf -X POST -d '{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}' https://api.github.com/repos/o/r/check-runs`,
  );
  assert.deepEqual(unsupportedOption.matches, []);

  const defaultPort = inspectWorkflowGateSignals(
    `run: curl -X POST -d '{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}' https://api.github.com:443/repos/o/r/check-runs`,
  );
  assert.equal(defaultPort.matches.length, 1);

  for (const target of [
    "http://api.github.com/repos/o/r/check-runs",
    "https://example.com/repos/o/r/check-runs",
    "https://user@api.github.com/repos/o/r/check-runs",
    "https://api.github.com:8443/repos/o/r/check-runs",
  ]) {
    const unsupportedTarget = inspectWorkflowGateSignals(
      `run: curl -X POST -d '{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}' ${target}`,
    );
    assert.deepEqual(unsupportedTarget.matches, [], target);
  }

  const multipleBodies = inspectWorkflowGateSignals(
    `run: curl -X POST -d '{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}' -d '{"status":"completed"}' https://api.github.com/repos/o/r/check-runs`,
  );
  assert.deepEqual(multipleBodies.matches, []);

  for (const target of [
    "https://api.github.com/repos/o/r/check-runs/123",
    "https://api.github.com/repos/o/r/statuses/$SHA/extra",
  ]) {
    const unsupportedRoute = inspectWorkflowGateSignals(
      `run: curl -X POST -d '{"name":"codex/github-review-gate","context":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}' ${target}`,
    );
    assert.deepEqual(unsupportedRoute.matches, [], target);
  }
});

test("does not classify curl publishers with a literal Host header override", () => {
  const headers = [
    "-H 'Host: forged.example'",
    "--header 'hOsT: api.github.com'",
    "-H 'Host:'",
    "--header 'HOST;'",
    "-H='Host: forged.example'",
    "--header='host: api.github.com'",
  ];
  for (const header of headers) {
    const result = inspectWorkflowGateSignals(
      `run: curl --http1.1 -X POST ${header} -d '{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}' https://api.github.com/repos/o/r/check-runs`,
    );
    assert.deepEqual(result.matches, [], header);
    assert.ok(
      result.warnings.some(({ kind }) => kind === "reserved-status-context-reference"),
      header,
    );
  }

  const ordinaryHeader = inspectWorkflowGateSignals(
    `run: curl --http1.1 -X POST --header 'Accept: application/vnd.github+json' -d '{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}' https://api.github.com/repos/o/r/check-runs`,
  );
  assert.equal(ordinaryHeader.matches.length, 1);
  assert.equal(ordinaryHeader.matches[0].kind, "reserved-check-run-name");
});

test("finds only explicit commit-status POST publishers in bounded curl commands", () => {
  const publisher = inspectWorkflowGateSignals(
    `run: curl -X POST -d '{"context":"CoDeX/GitHub-Review-Gate","state":"success"}' https://api.github.com/repos/o/r/statuses/$SHA`,
  );
  assert.equal(publisher.matches.length, 1);
  assert.equal(publisher.matches[0].kind, "reserved-status-context");

  const continued = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: |",
    "          curl -X POST \\",
    `            -d '{"context":"codex/github-review-gate","state":"success"}' \\`,
    "            https://api.github.com/repos/o/r/statuses/$SHA",
  ].join("\n"));
  assert.equal(continued.matches.length, 1);
  assert.equal(continued.matches[0].kind, "reserved-status-context");

  const missingState = inspectWorkflowGateSignals(
    `run: curl -X POST -d '{"context":"codex/github-review-gate"}' https://api.github.com/repos/o/r/statuses/$SHA`,
  );
  assert.deepEqual(missingState.matches, []);

  for (const payload of [
    { context: "codex/github-review-gate", state: "" },
    { context: "codex/github-review-gate", state: 1 },
    { context: "codex/github-review-gate", output: { state: "success" } },
    { context: "codex/github-review-gate", State: "success" },
  ]) {
    const invalidState = inspectWorkflowGateSignals(
      `run: curl -X POST -d '${JSON.stringify(payload)}' https://api.github.com/repos/o/r/statuses/$SHA`,
    );
    assert.deepEqual(invalidState.matches, [], JSON.stringify(payload));
  }
  const nonPublishers = inspectWorkflowGateSignals([
    `run: curl -X GET -d '{"context":"codex/github-review-gate"}' https://api.github.com/repos/o/r/statuses/$SHA`,
    `run: curl -X POST -d '{"context":"codex/github-review-gate"}' https://api.github.com/repos/o/r/releases`,
    `run: curl -X POST -d '{"context":"codex/github-review-gate"}' https://api.github.com/repos/o/r/releases; echo https://api.github.com/repos/o/r/statuses/$SHA`,
  ].join("\n"));
  assert.deepEqual(nonPublishers.matches, []);
});

test("joins only bounded backslash continuations inside a run block for curl publishers", () => {
  const publisher = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: |",
    "          curl -X POST \\",
    `            -d '{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}' \\`,
    "            https://api.github.com/repos/example/repo/check-runs",
  ].join("\n"));
  assert.equal(publisher.matches.length, 1);
  assert.equal(publisher.matches[0].kind, "reserved-check-run-name");

  const adjacentToken = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: |",
    "          curl -X POST\\",
    `          -d '{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}' \\`,
    "          https://api.github.com/repos/example/repo/check-runs",
  ].join("\n"));
  assert.deepEqual(adjacentToken.matches, [], "scalar indentation does not invent whitespace after POST");

  const preservedRelativeIndent = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: |",
    "          echo ready",
    "            curl -X POST\\",
    `            -d '{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}' \\`,
    "            https://api.github.com/repos/example/repo/check-runs",
  ].join("\n"));
  assert.deepEqual(preservedRelativeIndent.matches.map(({ kind }) => kind), ["reserved-check-run-name"]);

  const postBackslashSpace = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: |",
    "          curl -X POST \\ ",
    `            -d '{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}' \\`,
    "            https://api.github.com/repos/example/repo/check-runs",
  ].join("\n"));
  assert.deepEqual(postBackslashSpace.matches, [], "spaces after a backslash are not removed as a shell newline");
  assert.ok(postBackslashSpace.warnings.some(({ kind }) => kind === "continued-curl-command-unclosed"));

  const chained = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: |",
    "          curl -X POST \\",
    `            -d '{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}' \\`,
    "            https://api.github.com/repos/example/repo/releases; echo https://api.github.com/repos/example/repo/check-runs",
  ].join("\n"));
  assert.deepEqual(chained.matches, []);

  const unclosed = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: |",
    "          curl -X POST \\",
  ].join("\n"));
  assert.deepEqual(unclosed.matches, []);
  assert.ok(unclosed.warnings.some(({ kind }) => kind === "continued-curl-command-unclosed"));

  const singleQuotedBackslash = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: |",
    "          curl -X POST https://api.github.com/repos/o/r/check-runs -d '{\"name\":\"codex/github-review-gate\"}\\",
    "          ' ",
  ].join("\n"));
  assert.deepEqual(singleQuotedBackslash.matches, []);
  assert.ok(singleQuotedBackslash.warnings.some(({ kind }) => kind === "continued-curl-command-unclosed"));

  const doubleQuotedApostrophe = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: |",
    "          curl -X POST \\",
    `            -d '{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}' --header "X-Label: Joey's" \\`,
    "            https://api.github.com/repos/example/repo/check-runs",
  ].join("\n"));
  assert.equal(doubleQuotedApostrophe.matches.length, 1);
  assert.equal(doubleQuotedApostrophe.matches[0].kind, "reserved-check-run-name");

  const overBudget = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: |",
    "          curl -X POST \\",
    ...Array.from({ length: 16 }, (_, index) => `            --header X-Test-${index}: value \\`),
    `            -d '{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}' \\`,
    "            https://api.github.com/repos/example/repo/check-runs",
  ].join("\n"));
  assert.deepEqual(overBudget.matches, []);
  assert.ok(overBudget.warnings.some(({ kind }) => kind === "continued-curl-command-limit"));

  const splitAtStep = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: |",
    "          curl -X POST \\",
    "      - run: |",
    `          -d '{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}' \\`,
    "          https://api.github.com/repos/example/repo/check-runs",
  ].join("\n"));
  assert.deepEqual(splitAtStep.matches, []);

  const splitAtDocument = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: |",
    "          curl -X POST \\",
    "---",
    `-d '{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}' \\`,
    "https://api.github.com/repos/example/repo/check-runs",
  ].join("\n"));
  assert.deepEqual(splitAtDocument.matches, []);

  const followsOtherContinuation = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: |",
    "          echo placeholder \\",
    `          curl -X POST -d '{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}' https://api.github.com/repos/example/repo/check-runs`,
  ].join("\n"));
  assert.deepEqual(followsOtherContinuation.matches, []);
});

test("does not classify physical lines inside incomplete run-block shell commands", () => {
  const continuedEcho = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: |",
    "          echo harmless \\",
    "          gh api repos/o/r/check-runs -f name=codex/github-review-gate -f head_sha=0123456789abcdef0123456789abcdef01234567",
    "      - run: |",
    "          gh api repos/o/r/check-runs -f name=codex/github-review-gate -f head_sha=0123456789abcdef0123456789abcdef01234567",
  ].join("\n"));
  assert.equal(continuedEcho.matches.length, 1);
  assert.equal(continuedEcho.matches[0].kind, "reserved-check-run-name");
  assert.equal(continuedEcho.matches[0].line, 8);
  assert.ok(continuedEcho.warnings.some(({ kind }) => kind === "unclassified-run-block"));
  assert.ok(continuedEcho.warnings.some(({ kind }) => kind === "reserved-status-context-reference"));

  const openQuote = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: |",
    '          echo "harmless',
    "          gh api repos/o/r/check-runs -f name=codex/github-review-gate -f head_sha=0123456789abcdef0123456789abcdef01234567",
  ].join("\n"));
  assert.deepEqual(openQuote.matches, []);
  assert.ok(openQuote.warnings.some(({ kind }) => kind === "unclassified-run-block"));

  const uncertainCurlBlock = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: |",
    "          curl -X POST \\",
    `            -d '{"name":"codex/github-review-gate","head_sha":"0123456789abcdef0123456789abcdef01234567"}' \\`,
    "            https://api.github.com/repos/o/r/check-runs",
    '          echo "unfinished',
  ].join("\n"));
  assert.deepEqual(
    uncertainCurlBlock.matches,
    [],
    "a whole unknown run block must not retain provisional curl matches",
  );
  assert.ok(uncertainCurlBlock.warnings.some(({ kind }) => kind === "unclassified-run-block"));
});

test("keeps accepted ordinary-installer coverage examples warning-only", () => {
  // These exact examples are accepted warning-only cases, not a blanket guarantee for unsupported syntax.
  const acceptedGaps = [
    {
      issue: "4304322776",
      content: [
        "jobs:",
        "  publish:",
        "    steps:",
        "      - run: |",
        `          curl -d '{"name":"codex/github-review-gate"}' https://api.github.com/repos/o/r/check-runs`,
      ].join("\n"),
    },
    {
      issue: "4304322781",
      content: [
        "jobs:",
        "  build:",
        "    steps:",
        "      -",
        "        uses: JoeyTeng/codex-review-gate-action@v2",
      ].join("\n"),
    },
    {
      issue: "4304322783",
      content: [
        "jobs: {",
        "  collision: {",
        "    name: codex/github-review-gate",
        "  }",
        "}",
      ].join("\n"),
    },
    {
      issue: "4304322787",
      content: `jobs: {publish: {steps: [{run: curl -X POST -d '{"name":"codex/github-review-gate"}' https://api.github.com/repos/o/r/check-runs}]}}`,
    },
    {
      issue: "4304322790",
      content: [
        "jobs:",
        "  publish:",
        "    steps:",
        "      - run: >-",
        "          curl -X POST",
        `          -d '{"name":"codex/github-review-gate"}'`,
        "          https://api.github.com/repos/o/r/check-runs",
      ].join("\n"),
    },
    {
      issue: "4304322791",
      content: [
        "jobs:",
        "  publish:",
        "    steps:",
        `      - run: gh api repos/o/r/check-runs --method POST --input - <<< '{"name":"codex/github-review-gate"}'`,
      ].join("\n"),
    },
    {
      issue: "4304322794",
      content: [
        "jobs:",
        "  publish:",
        "    steps:",
        "      - uses: actions/github-script@v7",
        "        with:",
        "          script: |",
        '            github.rest.checks.create({name: "codex/github-review-gate", owner: "o", repo: "r", head_sha: "abc"})',
      ].join("\n"),
    },
    {
      issue: "4304433545",
      content: [
        "jobs:",
        "  build:",
        "    steps:",
        "      - { uses: JoeyTeng/codex-review-gate-action@v2 }",
      ].join("\n"),
    },
  ];

  for (const { issue, content } of acceptedGaps) {
    const result = inspectWorkflowGateSignals(content);
    assert.deepEqual(result.matches, [], issue);
    assert.ok(result.warnings.length > 0, `${issue} should remain visible as a warning`);
  }
});

test("keeps accepted quoted run and escaped name examples warning-only", () => {
  for (const source of [
    "run: 'gh api repos/o/r/check-runs -f name=codex/github-review-gate -f head_sha=$GITHUB_SHA'",
    'jobs:\n  collision:\n    name: "codex/github-review-\\u0067ate"\n',
  ]) {
    const result = inspectWorkflowGateSignals(source);
    assert.deepEqual(result.matches, [], source);
    assert.ok(result.warnings.length > 0, source);
  }
});

test("keeps accepted descriptor-redirection transport examples warning-only", () => {
  for (const source of [
    "run: gh api repos/o/r/check-runs 2>&1 -f name=codex/github-review-gate",
    "run: gh api repos/o/r/check-runs &>build.log -f name=codex/github-review-gate",
    `run: curl -X POST https://api.github.com/repos/o/r/check-runs 2>&1 -d '{"name":"codex/github-review-gate"}'`,
  ]) {
    const result = inspectWorkflowGateSignals(source);
    assert.deepEqual(result.matches, [], source);
    assert.ok(result.warnings.length > 0, source);
  }
});

test("keeps bare references and non-job names as warnings rather than blocking matches", () => {
  const result = inspectWorkflowGateSignals([
    "name: codex/github-review-gate",
    "run: echo codex/github-review-gate",
    `run: jq '.name == "codex/github-review-gate"' payload.json`,
    "with:",
    "  name: codex/github-review-gate",
    `const artifact = { name: "codex/github-review-gate" };`,
    "jobs:",
    "  build:",
    "    steps:",
    "      - name: codex/github-review-gate",
  ].join("\n"));

  assert.deepEqual(result.matches, []);
  assert.ok(result.warnings.filter(({ kind }) => kind === "reserved-status-context-reference").length >= 6);
});

test("does not confuse a neighboring context or generic gate keywords with the reserved name", () => {
  const result = inspectWorkflowGateSignals([
    "name: Build gate",
    "context: codex/github-review-gate-extra",
    "permissions:",
    "  contents: write",
    "  workflows: write",
    "jobs:",
    "  build:",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - run: echo codex gate",
  ].join("\n"));

  assert.deepEqual(result.matches, []);
  assert.deepEqual(result.warnings, []);
});

test("keeps ordinary other-workflow write permissions and checkout unrelated", () => {
  const result = inspectWorkflowGateSignals(`
permissions:
  actions: write
  contents: write
  pull-requests: write
  workflows: write
jobs:
  maintenance:
    steps:
      - uses: actions/checkout@v4
      - run: echo update
`);

  assert.deepEqual(result.matches, []);
});

test("warns on ambiguous fragments and readable dynamic contexts without blocking", () => {
  const result = inspectWorkflowGateSignals([
    `context: 'codex/' + unknownSuffix`,
    `context: \u0024{{ matrix.context }}`,
    "jobs:",
    "  dynamic:",
    `    name: \u0024{{ matrix.name }}`,
    `uses: \u0024{{ matrix.action }}`,
  ].join("\n"));

  assert.deepEqual(result.matches, []);
  assert.ok(result.warnings.some(({ kind }) => kind === "ambiguous-reserved-context"));
  assert.ok(result.warnings.some(({ kind }) => kind === "dynamic-context-not-confirmed"));
  assert.equal(
    result.warnings.some(({ kind }) => kind === "ambiguous-codex-review-gate-caller"),
    false,
  );
});

test("does not join local literals across step or job boundaries", () => {
  const result = inspectWorkflowGateSignals([
    "jobs:",
    "  first:",
    "    steps:",
    "      - run: prefix='codex/'",
    "      - run: suffix='github-review-gate'; context=\"$prefix$suffix\"",
    "  second:",
    "    steps:",
    "      - run: prefix='codex/'",
    "      - run: suffix='github-review-gate'; context=\"$prefix$suffix\"",
  ].join("\n"));

  assert.deepEqual(result.matches, []);

  const unrecognizedFirstStepFields = inspectWorkflowGateSignals([
    "jobs:",
    "  build:",
    "    steps:",
    "      - run: prefix='codex/'",
    "      - shell: bash",
    "        run: suffix='github-review-gate'",
    "      - working-directory: .",
    '        run: context="$prefix$suffix"',
  ].join("\n"));

  assert.deepEqual(unrecognizedFirstStepFields.matches, []);
});

test("ignores comment-only signals and CRLF is counted as one line break", () => {
  const result = inspectWorkflowGateSignals([
    "# context: codex/github-review-gate",
    "name: Build # reserved context: codex/github-review-gate",
    "context: codex/github-review-gate",
  ].join("\r\n"));

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].line, 3);
});

test("bounds long inputs and caps each findings collection", () => {
  const oversized = `${"# filler\n".repeat(40_000)}context: codex/github-review-gate`;
  const truncated = inspectWorkflowGateSignals(oversized);
  assert.equal(truncated.matches.length, 0);
  assert.ok(truncated.warnings.some(({ kind }) => kind === "input-truncated"));

  const many = inspectWorkflowGateSignals(
    Array.from({ length: 100 }, () => "context: codex/github-review-gate").join("\n"),
  );
  assert.equal(many.matches.length, 32);
  assert.ok(many.warnings.some(({ kind }) => kind === "match-limit"));

  const warningsBeforeMatch = inspectWorkflowGateSignals([
    ...Array.from({ length: 40 }, () => "name: ${{ matrix.name }}"),
    "context: codex/github-review-gate",
  ].join("\n"));
  assert.equal(warningsBeforeMatch.matches.length, 1);
  assert.ok(warningsBeforeMatch.warnings.length <= 33);
});
