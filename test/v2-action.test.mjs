import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ACTION_YAML_URL = new URL("../packages/action/action.yml", import.meta.url);

test("direct gate Action exposes the adopted production ABI and entrypoint", () => {
  const action = readFileSync(ACTION_YAML_URL, "utf8");
  const inputs = yamlSection(action, "inputs", "outputs");
  assert.deepEqual(topLevelYamlKeys(inputs), [
    "github_token",
    "pr_number",
    "expected_head_sha",
    "operation",
    "request_comment_id",
    "request_review",
    "limits_profile",
  ]);
  assert.match(yamlChildBlock(inputs, "github_token"), /^    required: true$/mu);
  assert.match(yamlChildBlock(inputs, "pr_number"), /^    required: true$/mu);
  assert.match(yamlChildBlock(inputs, "expected_head_sha"), /^    default: ""$/mu);
  assert.match(yamlChildBlock(inputs, "operation"), /^    required: false$/mu);
  assert.match(yamlChildBlock(inputs, "operation"), /^    default: reconcile$/mu);
  assert.match(yamlChildBlock(inputs, "request_review"), /^    default: "true"$/mu);
  assert.match(yamlChildBlock(inputs, "limits_profile"), /^    default: default$/mu);

  const outputs = yamlSection(action, "outputs", "runs");
  assert.deepEqual(topLevelYamlKeys(outputs), [
    "execution_health",
    "gate_outcome",
    "recovery_code",
    "retry_safe",
  ]);
  const runs = action.slice(action.indexOf("\nruns:\n"));
  assert.match(runs, /^  using: node20$/mu);
  assert.match(runs, /^  main: src\/v2\/gate-runtime\.mjs$/mu);
  assert.doesNotMatch(
    runs,
    /using: composite|steps:|actions\/(?:checkout|upload-artifact)|\bgh\b|\bcurl\b/u,
  );
  assert.doesNotMatch(outputs, /^    value:/mu);
});

function yamlSection(text, startName, endName) {
  const start = text.indexOf(`${startName}:\n`);
  const end = text.indexOf(`\n${endName}:\n`, start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return text.slice(start + startName.length + 2, end);
}

function topLevelYamlKeys(section) {
  return [...section.matchAll(/^  ([a-z][a-z0-9_-]*):$/gmu)].map((match) => match[1]);
}

function yamlChildBlock(section, name) {
  const start = section.indexOf(`  ${name}:\n`);
  assert.notEqual(start, -1);
  const following = section.slice(start + name.length + 4);
  const next = following.search(/^  [a-z][a-z0-9_-]*:$/mu);
  return next === -1 ? following : following.slice(0, next);
}
