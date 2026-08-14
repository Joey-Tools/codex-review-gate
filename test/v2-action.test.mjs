import assert from "node:assert/strict";
import {
  chmodSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  canonicalActionJson,
  createReadOnlyGitHubFetch,
  executeV2Action,
  publicV2ActionResult,
  readControllerInputFile,
  writeV2ActionOutputs,
} from "../packages/action/src/v2/action.mjs";

const ACTION_YAML_URL = new URL("../packages/action/action.yml", import.meta.url);

test("plan adapter exposes only required closed v2 inputs and plan paths", () => {
  const action = readFileSync(ACTION_YAML_URL, "utf8");
  const inputs = yamlSection(action, "inputs", "outputs");
  assert.deepEqual(topLevelYamlKeys(inputs), [
    "github-token",
    "pull-request",
    "operation",
    "status-target-mode",
    "operation-input-path",
  ]);
  for (const inputName of topLevelYamlKeys(inputs)) {
    const block = yamlChildBlock(inputs, inputName);
    assert.match(block, /^    required: true$/mu);
    assert.doesNotMatch(block, /^    default:/mu);
  }
  assert.doesNotMatch(inputs, /^  status-context:/mu);
  assert.match(inputs, /prepare-request, bind-request, or evaluate-only/u);
  assert.match(inputs, /Closed mode: head or test-merge-with-head-sentinel/u);
  assert.match(inputs, /controller-generated canonical JSON/u);

  const outputs = yamlSection(action, "outputs", "runs");
  assert.deepEqual(topLevelYamlKeys(outputs), [
    "decision",
    "result-path",
    "report-path",
    "status-plan-path",
    "reservation-path",
    "intent-path",
    "binding-receipt-path",
  ]);
  const runs = action.slice(action.indexOf("\nruns:\n"));
  assert.match(runs, /node "\$GITHUB_ACTION_PATH\/src\/v2\/action\.mjs"/u);
  assert.doesNotMatch(runs, /actions\/upload-artifact|\bgh\b|\bcurl\b/u);
  assert.doesNotMatch(runs, /src\/gate\.mjs/u);
  assert.match(action, /never posts comments or commit statuses/u);
  assert.match(action, /does not\n  complete the gate by itself/u);
});

test("controller input requires canonical stable regular data below runner temp", (context) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codex-review-gate-v2-action-")));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const controllerDirectory = join(root, "controller");
  mkdirSync(controllerDirectory, { mode: 0o700 });
  const inputPath = join(controllerDirectory, "input.json");
  const value = { a: 1, z: [true, null] };
  writeFileSync(inputPath, canonicalActionJson(value), { mode: 0o600 });
  assert.deepEqual(readControllerInputFile(inputPath, root), value);

  const prettyPath = join(controllerDirectory, "pretty.json");
  writeFileSync(prettyPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  assert.throws(
    () => readControllerInputFile(prettyPath, root),
    /canonical sorted compact JSON/u,
  );

  const writablePath = join(controllerDirectory, "writable.json");
  writeFileSync(writablePath, canonicalActionJson(value), { mode: 0o600 });
  chmodSync(writablePath, 0o622);
  assert.throws(
    () => readControllerInputFile(writablePath, root),
    /group or world writable/u,
  );

  const symlinkPath = join(controllerDirectory, "input-link.json");
  symlinkSync(inputPath, symlinkPath);
  assert.throws(
    () => readControllerInputFile(symlinkPath, root),
    /cannot traverse a symlink/u,
  );

  const hardLinkPath = join(controllerDirectory, "input-hardlink.json");
  linkSync(inputPath, hardLinkPath);
  assert.throws(
    () => readControllerInputFile(inputPath, root),
    /must not be hard linked/u,
  );

  const outside = realpathSync(mkdtempSync(join(tmpdir(), "codex-review-gate-v2-outside-")));
  context.after(() => rmSync(outside, { recursive: true, force: true }));
  const outsidePath = join(outside, "input.json");
  writeFileSync(outsidePath, canonicalActionJson(value), { mode: 0o600 });
  assert.throws(
    () => readControllerInputFile(outsidePath, root),
    /descendant of RUNNER_TEMP/u,
  );
});

test("read-only transport guard admits REST GET and named v2 GraphQL queries only", async () => {
  const requests = [];
  const guardedFetch = createReadOnlyGitHubFetch(
    async (url, init) => {
      requests.push({ url: String(url), method: init?.method ?? "GET" });
      return { ok: true };
    },
    {
      restBaseUrl: "https://api.github.test",
      graphqlUrl: "https://api.github.test/graphql",
    },
  );

  await guardedFetch("https://api.github.test/repos/owner/repo", { method: "GET" });
  await guardedFetch("https://api.github.test/graphql", {
    method: "POST",
    body: JSON.stringify({
      query: "query CodexReviewGateV2Scope { viewer { login } }",
      variables: {},
    }),
  });
  assert.equal(requests.length, 2);
  await assert.rejects(
    guardedFetch("https://api.github.test/repos/owner/repo/issues/42/comments", {
      method: "POST",
      body: JSON.stringify({ body: "@codex review" }),
    }),
    /blocked a non-read/u,
  );
  await assert.rejects(
    guardedFetch("https://api.github.test/graphql", {
      method: "POST",
      body: JSON.stringify({
        query: "mutation CodexReviewGateV2Write { addComment(input: {}) { clientMutationId } }",
        variables: {},
      }),
    }),
    /blocked a non-read/u,
  );
  await assert.rejects(
    guardedFetch("https://attacker.invalid/repos/owner/repo", { method: "GET" }),
    /blocked a non-read/u,
  );
});

test("public Action results expose the canonical report but not the compact reducer report", () => {
  const publicReport = { schema_version: 2, decision: "clean" };
  const result = publicV2ActionResult({
    decision: "clean",
    report: publicReport,
    reducer_report: { schema_version: 2, decision: "clean", compact: true },
    writes_performed: false,
  });
  assert.deepEqual(result, {
    decision: "clean",
    report: publicReport,
    writes_performed: false,
  });
  assert.equal(Object.hasOwn(result, "reducer_report"), false);
  assert.throws(
    () => publicV2ActionResult({
      decision: "clean",
      report: publicReport,
      reducer_report: { decision: "clean" },
      scheduler_plan: { nested: { reducer_report: { decision: "pending" } } },
    }),
    /internal compact reducer report/u,
  );
});

test("Action report-path serializes only the canonical rich public report", (context) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codex-review-gate-v2-output-")));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const report = { schema_version: 2, decision: "clean", selection: { selected: true } };
  const outputs = writeV2ActionOutputs({
    decision: "clean",
    report,
    reducer_report: { schema_version: 2, decision: "clean", compact: true },
    status_plan: { writes: [] },
    reservation: null,
    post_intent: null,
    binding_receipt: null,
    writes_performed: false,
  }, root);

  assert.deepEqual(JSON.parse(readFileSync(outputs["report-path"], "utf8")), report);
  const publishedResult = JSON.parse(readFileSync(outputs["result-path"], "utf8"));
  assert.deepEqual(publishedResult.report, report);
  assert.equal(Object.hasOwn(publishedResult, "reducer_report"), false);
});

test("public Action accepts head mode and rejects values outside the two-mode enum", async () => {
  await assert.rejects(
    executeV2Action({
      V2_GITHUB_TOKEN: "synthetic-action-token",
      V2_PULL_REQUEST: "42",
      V2_OPERATION: "evaluate-only",
      V2_STATUS_TARGET_MODE: "head",
    }),
    /GITHUB_REPOSITORY/u,
  );
  await assert.rejects(
    executeV2Action({
      V2_GITHUB_TOKEN: "synthetic-action-token",
      V2_PULL_REQUEST: "42",
      V2_OPERATION: "evaluate-only",
      V2_STATUS_TARGET_MODE: "merge-head",
    }),
    /status-target-mode is not a closed v2 mode/u,
  );
});

function yamlSection(text, startName, endName) {
  const start = text.indexOf(`${startName}:\n`);
  const end = text.indexOf(`\n${endName}:\n`, start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return text.slice(start + startName.length + 2, end);
}

function topLevelYamlKeys(section) {
  return [...section.matchAll(/^  ([a-z][a-z0-9-]*):$/gmu)].map((match) => match[1]);
}

function yamlChildBlock(section, name) {
  const start = section.indexOf(`  ${name}:\n`);
  assert.notEqual(start, -1);
  const following = section.slice(start + name.length + 4);
  const next = following.search(/^  [a-z][a-z0-9-]*:$/mu);
  return next === -1 ? following : following.slice(0, next);
}
