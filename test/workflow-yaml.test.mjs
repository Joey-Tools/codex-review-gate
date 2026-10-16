import assert from "node:assert/strict";
import test from "node:test";
import {
  parseWorkflowYamlMapping,
  tokenizeWorkflowYaml,
} from "../src/workflow-yaml.mjs";

test("sequence block scalars stop before run-first sibling fields", () => {
  const tokens = tokenizeWorkflowYaml([
    "jobs:",
    "  publish:",
    "    steps:",
    "      - run: |",
    "          printf 'env: shell: uses: are literal body text'",
    "          uses: body-text-not-a-step",
    "        env:",
    "          BASH_ENV: ''",
    "        shell: bash",
    "        uses: actions/checkout@v4",
  ].join("\n"));
  const run = tokens.find((token) => token.text === "- run: |");
  assert.ok(run);
  assert.equal(run.indent, 6);
  assert.deepEqual(parseWorkflowYamlMapping(run), {
    key: "run",
    value: "|",
    sequence: true,
  });
  assert.equal(run.blockStyle, "|");
  assert.deepEqual(run.blockContent, [
    "          printf 'env: shell: uses: are literal body text'",
    "          uses: body-text-not-a-step",
  ]);
  assert.deepEqual(
    tokens.map((token) => token.text),
    [
      "jobs:",
      "publish:",
      "steps:",
      "- run: |",
      "env:",
      "BASH_ENV: ''",
      "shell: bash",
      "uses: actions/checkout@v4",
    ],
  );
});

test("ordinary mapping block scalars stop before same-indent sibling keys", () => {
  const tokens = tokenizeWorkflowYaml([
    "script: >-",
    "  literal mapping-like text: stays in body",
    "sibling: visible",
  ].join("\n"));
  assert.deepEqual(tokens[0].blockContent, [
    "  literal mapping-like text: stays in body",
  ]);
  assert.equal(tokens[1].text, "sibling: visible");
  assert.deepEqual(parseWorkflowYamlMapping(tokens[0]), {
    key: "script",
    value: ">-",
    sequence: false,
  });
});

test("blank lines remain in block content while next steps and jobs stay visible", () => {
  const tokens = tokenizeWorkflowYaml([
    "jobs:",
    "  first:",
    "    steps:",
    "      - run: |",
    "          printf first",
    "",
    "      - run: |",
    "          printf second",
    "  second:",
    "    name: visible",
  ].join("\n"));
  const first = tokens.find((token) => token.text === "- run: |");
  assert.deepEqual(first.blockContent, ["          printf first", ""]);
  assert.equal(tokens.filter((token) => token.text === "- run: |").length, 2);
  assert.equal(tokens.at(-2).text, "second:");
  assert.equal(tokens.at(-1).text, "name: visible");
});

test("supported block scalar markers retain their exact spelling", () => {
  for (const marker of [
    "|",
    "|-",
    "|+",
    "|2",
    "|+2",
    "|2+",
    ">",
    ">-",
    ">+",
    ">2",
    ">+2",
    ">2+",
  ]) {
    const [token] = tokenizeWorkflowYaml(`script: ${marker}\n  body`);
    assert.equal(token.blockStyle, marker, marker);
  }
});

test("input admission preserves BOM and CRLF support and rejects tabs and bare CR", () => {
  assert.equal(
    tokenizeWorkflowYaml("\uFEFFkey: value\r\nnext: value\r\n")[0].text,
    "key: value",
  );
  assert.throws(
    () => tokenizeWorkflowYaml("key: value\rnext: value"),
    /bare CR YAML line break/u,
  );
  assert.throws(
    () => tokenizeWorkflowYaml("key:\n\tchild: value"),
    /tab-indented YAML structure/u,
  );
  assert.throws(
    () => tokenizeWorkflowYaml(null),
    /workflow content must be text/u,
  );
  assert.deepEqual(
    tokenizeWorkflowYaml('\nkey: "quoted # hash" # comment\n\n').map((token) => token.text),
    ['key: "quoted # hash"'],
  );
  assert.equal(parseWorkflowYamlMapping(null), null);
  assert.equal(parseWorkflowYamlMapping({ text: "not a mapping" }), null);
});
