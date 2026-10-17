import assert from "node:assert/strict";
import test from "node:test";
import { inspectWorkflowGateSignals } from "../src/workflow-gate-signals.mjs";

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
    "      - uses: Joey-Tools/codex-review-gate/.github/workflows/reusable.yml@0123456789abcdef",
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

test("finds adjacent literals and simple local literal compositions", () => {
  const adjacent = inspectWorkflowGateSignals(`context: 'codex/' + 'github-review-gate'`);
  assert.equal(adjacent.matches.length, 1);
  assert.equal(adjacent.matches[0].kind, "reserved-status-context");

  const variables = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: prefix='codex/'; suffix='github-review-gate'; context=\"$prefix$suffix\"",
  ].join("\r\n"));
  assert.equal(variables.matches.length, 1);
  assert.equal(variables.matches[0].kind, "reserved-status-context");

  const jsVariables = inspectWorkflowGateSignals([
    "const prefix = 'codex/';",
    "const suffix = 'github-review-gate';",
    "const context = prefix + suffix;",
  ].join("\n"));
  assert.equal(jsVariables.matches.length, 1);
});

test("finds exact CLI payload and inline JavaScript or JSON context literals", () => {
  const cli = inspectWorkflowGateSignals([
    "run: gh api repos/example/check-runs -f context=codex/github-review-gate",
    "run: gh api repos/example/check-runs --field 'context=codex/github-review-gate'",
    "run: gh api repos/o/r/statuses/$SHA --raw-field context=codex/github-review-gate",
    "run: gh api repos/example/check-runs -f context=codex/github-review-gate-extra",
  ].join("\n"));
  assert.equal(cli.matches.length, 3);
  assert.ok(cli.matches.every(({ kind }) => kind === "reserved-status-context"));

  const inline = inspectWorkflowGateSignals([
    "check-name: codex/github-review-gate",
    `const payload = { context: "codex/github-review-gate" };`,
    `const payload = JSON.parse('{"context":"codex/github-review-gate"}');`,
  ].join("\n"));
  assert.equal(inline.matches.length, 3);
});

test("finds a reserved CheckRun name only beside the explicit check-runs API", () => {
  const publisher = inspectWorkflowGateSignals(
    "run: gh api repos/example/check-runs -f name=codex/github-review-gate",
  );
  assert.equal(publisher.matches.length, 1);
  assert.equal(publisher.matches[0].kind, "reserved-check-run-name");

  const rawField = inspectWorkflowGateSignals(
    "run: gh api repos/o/r/check-runs --raw-field name=codex/github-review-gate",
  );
  assert.equal(rawField.matches.length, 1);
  assert.equal(rawField.matches[0].kind, "reserved-check-run-name");

  const unrelated = inspectWorkflowGateSignals(
    "run: gh api repos/example/releases -f name=codex/github-review-gate",
  );
  assert.deepEqual(unrelated.matches, []);
  assert.ok(unrelated.warnings.some(({ kind }) => kind === "reserved-status-context-reference"));

  const blockScalar = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: |",
    "          gh api repos/example/check-runs -f name=codex/github-review-gate",
  ].join("\n"));
  assert.equal(blockScalar.matches.length, 1);
  assert.equal(blockScalar.matches[0].kind, "reserved-check-run-name");
});

test("finds inline JSON CheckRun POST names across common curl data flags", () => {
  const options = ["-d", "--data", "--data-raw", "--data-binary", "--data-urlencode", "--json"];
  for (const option of options) {
    const result = inspectWorkflowGateSignals(
      `run: curl -X POST ${option} '{"name":"codex/github-review-gate"}' https://api.github.com/repos/example/repo/check-runs`,
    );
    assert.equal(result.matches.length, 1, option);
    assert.equal(result.matches[0].kind, "reserved-check-run-name", option);
  }

  const nonPublishers = inspectWorkflowGateSignals([
    `run: echo "curl -X POST -d '{\"name\":\"codex/github-review-gate\"}' https://api.github.com/repos/example/repo/check-runs"`,
    `run: curl -X GET -d '{"name":"codex/github-review-gate"}' https://api.github.com/repos/example/repo/check-runs`,
    `run: curl -X POST -d '{"name":"codex/github-review-gate"}' https://api.github.com/repos/example/repo/releases`,
    `run: curl -X POST -d '{"name":"codex/github-review-gate"}' https://api.github.com/repos/example/repo/releases; echo https://api.github.com/repos/example/repo/check-runs`,
    "run: jq '.name == \"codex/github-review-gate\"' payload.json",
    `run: curl -X POST -d '{"name":"codex/github-review-gate"}'`,
    "run: echo https://api.github.com/repos/example/repo/check-runs",
  ].join("\n"));
  assert.deepEqual(nonPublishers.matches, []);
});

test("finds only explicit commit-status POST publishers in bounded curl commands", () => {
  const publisher = inspectWorkflowGateSignals(
    `run: curl -X POST -d '{"context":"codex/github-review-gate"}' https://api.github.com/repos/o/r/statuses/$SHA`,
  );
  assert.equal(publisher.matches.length, 1);
  assert.equal(publisher.matches[0].kind, "reserved-status-context");

  const continued = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: |",
    "          curl -X POST \\",
    `            -d '{"context":"codex/github-review-gate"}' \\`,
    "            https://api.github.com/repos/o/r/statuses/$SHA",
  ].join("\n"));
  assert.equal(continued.matches.length, 1);
  assert.equal(continued.matches[0].kind, "reserved-status-context");

  const nonPublishers = inspectWorkflowGateSignals([
    `run: curl -X GET -d '{"context":"codex/github-review-gate"}' https://api.github.com/repos/o/r/statuses/$SHA`,
    `run: curl -X POST -d '{"context":"codex/github-review-gate"}' https://api.github.com/repos/o/r/releases`,
    `run: curl -X POST -d '{"context":"codex/github-review-gate"}' https://api.github.com/repos/o/r/statuses/$SHA; echo done`,
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
    `            -d '{"name":"codex/github-review-gate"}' \\`,
    "            https://api.github.com/repos/example/repo/check-runs",
  ].join("\n"));
  assert.equal(publisher.matches.length, 1);
  assert.equal(publisher.matches[0].kind, "reserved-check-run-name");

  const chained = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: |",
    "          curl -X POST \\",
    `            -d '{"name":"codex/github-review-gate"}' \\`,
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

  const overBudget = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: |",
    "          curl -X POST \\",
    ...Array.from({ length: 16 }, (_, index) => `            --header X-Test-${index}: value \\`),
    `            -d '{"name":"codex/github-review-gate"}' \\`,
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
    `          -d '{"name":"codex/github-review-gate"}' \\`,
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
    `-d '{"name":"codex/github-review-gate"}' \\`,
    "https://api.github.com/repos/example/repo/check-runs",
  ].join("\n"));
  assert.deepEqual(splitAtDocument.matches, []);

  const followsOtherContinuation = inspectWorkflowGateSignals([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: |",
    "          echo placeholder \\",
    `          curl -X POST -d '{"name":"codex/github-review-gate"}' https://api.github.com/repos/example/repo/check-runs`,
  ].join("\n"));
  assert.deepEqual(followsOtherContinuation.matches, []);
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
  ];

  for (const { issue, content } of acceptedGaps) {
    const result = inspectWorkflowGateSignals(content);
    assert.deepEqual(result.matches, [], issue);
    assert.ok(result.warnings.length > 0, `${issue} should remain visible as a warning`);
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
