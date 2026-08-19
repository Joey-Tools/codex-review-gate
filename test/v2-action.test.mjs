import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs, {
  chmodSync,
  closeSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  canonicalActionJson,
  createReadOnlyGitHubFetch,
  executeV2Action,
  publicV2ActionResult,
  readControllerInputFile,
  writeV2ActionOutputs,
} from "../packages/action/src/v2/action.mjs";

const ACTION_YAML_URL = new URL("../packages/action/action.yml", import.meta.url);
const SIZE_RACE_FIXTURE_PATH = fileURLToPath(
  new URL("../test-fixtures/controller-input-reader-size-race.mjs", import.meta.url),
);

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

  const fifoPath = join(controllerDirectory, "input.fifo");
  const fifoCreation = childProcess.spawnSync("/usr/bin/mkfifo", [fifoPath], {
    encoding: "utf8",
    env: {},
    shell: false,
  });
  assert.equal(fifoCreation.error, undefined);
  assert.equal(fifoCreation.status, 0);
  assert.throws(
    () => readControllerInputFile(fifoPath, root),
    /must identify a regular file/u,
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

test("controller input rejects malformed UTF-8 without rejecting a real replacement character", (context) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codex-review-gate-v2-utf8-")));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const controllerDirectory = join(root, "controller");
  mkdirSync(controllerDirectory, { mode: 0o700 });

  const malformedPath = join(controllerDirectory, "malformed.json");
  writeFileSync(malformedPath, Buffer.from([
    0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0x80, 0x22, 0x7d, 0x0a,
  ]), { mode: 0o600 });
  assert.throws(
    () => readControllerInputFile(malformedPath, root),
    /not valid UTF-8 JSON/u,
  );

  const replacementCharacterPath = join(controllerDirectory, "replacement.json");
  const replacementCharacterValue = { a: "\ufffd" };
  writeFileSync(
    replacementCharacterPath,
    canonicalActionJson(replacementCharacterValue),
    { mode: 0o600 },
  );
  assert.deepEqual(
    readControllerInputFile(replacementCharacterPath, root),
    replacementCharacterValue,
  );
});

test("controller input rejects a parent replacement after the parent preflight", (context) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codex-review-gate-v2-parent-race-")));
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "codex-review-gate-v2-parent-race-outside-")));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  context.after(() => rmSync(outside, { recursive: true, force: true }));

  const controllerDirectory = join(root, "controller");
  const originalControllerDirectory = join(root, "controller-original");
  const outsideControllerDirectory = join(outside, "controller");
  mkdirSync(controllerDirectory, { mode: 0o700 });
  mkdirSync(outsideControllerDirectory, { mode: 0o700 });
  const inputPath = join(controllerDirectory, "input.json");
  writeFileSync(inputPath, canonicalActionJson({ source: "A" }), { mode: 0o600 });
  writeFileSync(
    join(outsideControllerDirectory, "input.json"),
    canonicalActionJson({ source: "B" }),
    { mode: 0o600 },
  );

  const originalLstatSync = fs.lstatSync;
  let seamTriggered = false;
  fs.lstatSync = (...arguments_) => {
    const result = originalLstatSync(...arguments_);
    if (!seamTriggered && arguments_[0] === controllerDirectory) {
      seamTriggered = true;
      renameSync(controllerDirectory, originalControllerDirectory);
      symlinkSync(outsideControllerDirectory, controllerDirectory);
    }
    return result;
  };
  syncBuiltinESMExports();

  let rejection = null;
  try {
    readControllerInputFile(inputPath, root);
  } catch (error) {
    rejection = error;
  } finally {
    fs.lstatSync = originalLstatSync;
    syncBuiltinESMExports();
  }

  assert.equal(seamTriggered, true, "the parent replacement seam must execute");
  assert.ok(rejection instanceof Error, "the replaced parent must be rejected");
  assert.match(rejection.message, /violated its access policy|object identity changed/u);
});

test("controller input binds the selected leaf across a pathname replacement", (context) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codex-review-gate-v2-leaf-race-")));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const controllerDirectory = join(root, "controller");
  mkdirSync(controllerDirectory, { mode: 0o700 });
  const inputPath = join(controllerDirectory, "input.json");
  const displacedPath = join(controllerDirectory, "input-original.json");
  const replacementPath = join(controllerDirectory, "input-replacement.json");
  writeFileSync(inputPath, canonicalActionJson({ source: "A" }), { mode: 0o600 });
  writeFileSync(replacementPath, canonicalActionJson({ source: "B" }), { mode: 0o600 });

  const originalSpawnSync = childProcess.spawnSync;
  let seamTriggered = false;
  childProcess.spawnSync = (...arguments_) => {
    if (!seamTriggered) {
      seamTriggered = true;
      renameSync(inputPath, displacedPath);
      renameSync(replacementPath, inputPath);
    }
    return originalSpawnSync(...arguments_);
  };
  syncBuiltinESMExports();

  let rejection = null;
  try {
    readControllerInputFile(inputPath, root);
  } catch (error) {
    rejection = error;
  } finally {
    childProcess.spawnSync = originalSpawnSync;
    syncBuiltinESMExports();
  }

  assert.equal(seamTriggered, true, "the post-selection leaf replacement seam must execute");
  assert.ok(rejection instanceof Error, "the replaced selected leaf must be rejected");
  assert.match(rejection.message, /object identity changed/u);
});

test("controller input binds successful child output to the selected leaf size", (context) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codex-review-gate-v2-output-size-")));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const controllerDirectory = join(root, "controller");
  mkdirSync(controllerDirectory, { mode: 0o700 });
  const inputPath = join(controllerDirectory, "input.json");
  writeFileSync(inputPath, canonicalActionJson({ source: "A" }), { mode: 0o600 });

  const originalSpawnSync = childProcess.spawnSync;
  let seamTriggered = false;
  childProcess.spawnSync = () => {
    seamTriggered = true;
    return {
      error: undefined,
      signal: null,
      status: 0,
      stderr: Buffer.alloc(0),
      stdout: Buffer.from(canonicalActionJson({ source: "different-length" }), "utf8"),
    };
  };
  syncBuiltinESMExports();

  let rejection = null;
  try {
    readControllerInputFile(inputPath, root);
  } catch (error) {
    rejection = error;
  } finally {
    childProcess.spawnSync = originalSpawnSync;
    syncBuiltinESMExports();
  }

  assert.equal(seamTriggered, true, "the successful child output seam must execute");
  assert.ok(rejection instanceof Error, "a selected-size mismatch must be rejected");
  assert.match(rejection.message, /returned invalid data/u);
});

test("isolated leaf reader rejects a size mutation after its final descriptor stat", (context) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codex-review-gate-v2-size-race-")));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const inputPath = join(root, "input.json");
  const bytes = Buffer.from(canonicalActionJson({ source: "stable" }), "utf8");
  writeFileSync(inputPath, bytes, { mode: 0o600 });

  const descriptor = openSync(inputPath, "r");
  let result;
  try {
    result = childProcess.spawnSync(
      process.execPath,
      [
        SIZE_RACE_FIXTURE_PATH,
        "input.json",
        String(bytes.length + 16),
        String(bytes.length),
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {},
        maxBuffer: 64 * 1024,
        shell: false,
        stdio: ["ignore", "pipe", "pipe", "ignore", descriptor],
      },
    );
  } finally {
    closeSync(descriptor);
  }

  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "CONTENT\n");
});

test("controller input tolerates benign sibling churn and directory metadata changes", (context) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "codex-review-gate-v2-parent-churn-")));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const controllerDirectory = join(root, "controller");
  mkdirSync(controllerDirectory, { mode: 0o700 });
  const inputPath = join(controllerDirectory, "input.json");
  const value = { source: "stable" };
  writeFileSync(inputPath, canonicalActionJson(value), { mode: 0o600 });

  const originalLstatSync = fs.lstatSync;
  let seamTriggered = false;
  fs.lstatSync = (...arguments_) => {
    const result = originalLstatSync(...arguments_);
    if (!seamTriggered && arguments_[0] === controllerDirectory) {
      seamTriggered = true;
      const sibling = join(controllerDirectory, "sibling");
      mkdirSync(sibling, { mode: 0o700 });
      rmSync(sibling, { recursive: true });
      const timestamp = new Date(Date.now() - 2_000);
      utimesSync(controllerDirectory, timestamp, timestamp);
    }
    return result;
  };
  syncBuiltinESMExports();

  let actual;
  try {
    actual = readControllerInputFile(inputPath, root);
  } finally {
    fs.lstatSync = originalLstatSync;
    syncBuiltinESMExports();
  }

  assert.equal(seamTriggered, true, "the benign parent metadata seam must execute");
  assert.deepEqual(actual, value);
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
