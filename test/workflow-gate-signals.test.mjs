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
  const nested = inspectWorkflowGateSignals(
    "{name: Other, jobs: {collision: {name: codex/github-review-gate}}}",
  );
  assert.equal(nested.matches.length, 1);
  assert.equal(nested.matches[0].kind, "reserved-job-name");

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
    "run: gh api repos/example/check-runs -f context=codex/github-review-gate-extra",
  ].join("\n"));
  assert.equal(cli.matches.length, 2);
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

  const unrelated = inspectWorkflowGateSignals(
    "run: gh api repos/example/releases -f name=codex/github-review-gate",
  );
  assert.deepEqual(unrelated.matches, []);
  assert.ok(unrelated.warnings.some(({ kind }) => kind === "reserved-status-context-reference"));
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
