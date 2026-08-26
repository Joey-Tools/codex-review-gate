import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = join(repositoryRoot, ".github", "workflows", "sync-action-subtree.yml");
const releaseScript = join(repositoryRoot, "scripts", "release-action-subtree.sh");
const generator = join(repositoryRoot, "scripts", "generate-action-release-provenance.mjs");
const baselinePath = join(repositoryRoot, "docs", "release", "action-v2-repository-baselines.json");
const actionMetadata = readFileSync(join(repositoryRoot, "packages", "action", "action.yml"), "utf8");
const PRIMARY = "AD403DAB5377F9FA0F7D775EC2844D3367B8A71B";
const SUBKEY = "4DD48552DDEAF6D961769DD4A49827EC48984E2C";
const RELEASE_WORKFLOW_REF =
  "Joey-Tools/codex-review-gate/.github/workflows/sync-action-subtree.yml@refs/heads/master";
const SYNTHETIC_TOKEN_FIXTURE = Object.freeze({
  catalog: "joey-private-v3",
  id: "access-a",
  value: "codex_synth_v1_access_a",
});
const executionEnv = {
  ...process.env,
  CODEX_REVIEW_GATE_RELEASE_PROVENANCE_TEST_ONLY: "1",
  GIT_ASKPASS: "/usr/bin/false",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  // These tests invoke the publisher directly. Bind its production workflow
  // identity and remove host-owned output/credentials instead of inheriting
  // the unrelated workflow hosting the tests.
  GH_TOKEN: "",
  GITHUB_OUTPUT: "",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_RUN_ID: "1",
  GITHUB_TOKEN: "",
  GITHUB_WORKFLOW_REF: RELEASE_WORKFLOW_REF,
  NODE_ENV: "test",
  PUBLISHER_TOKEN: "",
  RELEASE_PUBLISHER_TOKEN: "",
};

function run(file, args, options = {}) {
  return execFileSync(file, args, {
    encoding: "utf8",
    env: executionEnv,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function invoke(file, args, options = {}) {
  return spawnSync(file, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: { ...executionEnv, ...options.env },
    maxBuffer: 64 * 1024 * 1024,
  });
}

function git(repo, args) {
  return run("git", ["-C", repo, ...args]);
}

function gitBytes(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: null,
    env: executionEnv,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function writeJson(path, value) {
  write(path, `${JSON.stringify(value, null, 2)}\n`);
}

function commit(repo, message) {
  git(repo, ["add", "--all"]);
  git(repo, ["commit", "-q", "-m", message]);
  return git(repo, ["rev-parse", "HEAD"]);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function inventoryDigest(files) {
  const hash = createHash("sha256");
  for (const file of files) {
    for (const field of [file.path, file.type, file.mode, String(file.size), file.sha256]) {
      hash.update(field, "utf8");
      hash.update("\0", "binary");
    }
  }
  return hash.digest("hex");
}

function stagedActionSnapshot(source) {
  git(source, ["add", "--", "packages/action"]);
  const indexTree = git(source, ["write-tree"]);
  const tree = git(source, ["rev-parse", `${indexTree}:packages/action`]);
  const files = gitBytes(source, [
    "ls-tree",
    "-rz",
    "--full-tree",
    "--format=%(objectmode)%x09%(objecttype)%x09%(objectname)%x09%(path)",
    tree,
  ])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const [mode, type, object, ...pathParts] = line.split("\t");
      const path = pathParts.join("\t");
      assert.equal(mode, "100644", path);
      assert.equal(type, "blob", path);
      const bytes = gitBytes(source, ["cat-file", "blob", object]);
      return { path, type: "file", mode, size: bytes.byteLength, sha256: sha256(bytes) };
    })
    .sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
  return { tree, files };
}

function releaseManifest(version, snapshot, expectedHead, previousVersion) {
  return {
    $schema: "urn:joey-tools:codex-review-gate:release-manifest:2",
    schema_version: 2,
    version,
    contract_versions: {
      toolchain: "node20",
      release_schema: 2,
      status: 2,
      template: 2,
      baseline: 3,
    },
    source: {
      repository: "Joey-Tools/codex-review-gate",
      path: "packages/action",
      tree: snapshot.tree,
    },
    target: {
      repository: "JoeyTeng/codex-review-gate-action",
      ref: "refs/heads/master",
      expected_head: expectedHead,
      previous_version: previousVersion,
    },
    files: snapshot.files,
    entrypoint: {
      metadata_path: "action.yml",
      using: "node20",
      main: "src/v2/gate-runtime.mjs",
    },
    signer: {
      name: "JoeyTeng-Codex",
      email: "codex@mahane.me",
      primary_fingerprint: PRIMARY,
      signing_subkey_fingerprint: SUBKEY,
    },
  };
}

function writeActionPayload(source, version) {
  const actionRoot = join(source, "packages", "action");
  write(
    join(actionRoot, "action.yml"),
    actionMetadata,
  );
  writeJson(join(actionRoot, "package.json"), {
    name: "codex-review-gate-action",
    version,
    type: "module",
    repository: {
      type: "git",
      url: "git+https://github.com/JoeyTeng/codex-review-gate-action.git",
    },
  });
  write(
    join(actionRoot, "src", "v2", "gate-runtime.mjs"),
    `export const releaseVersion = ${JSON.stringify(version)};\n`,
  );
}

function writeReleaseIntent(source, version, expectedHead, previousVersion) {
  writeActionPayload(source, version);
  const snapshot = stagedActionSnapshot(source);
  writeJson(
    join(source, "release-manifest.json"),
    releaseManifest(version, snapshot, expectedHead, previousVersion),
  );
  return commit(source, `Release intent ${version}`);
}

function fixture(t, version = "2.0.0") {
  const root = mkdtempSync(join(tmpdir(), "action-release-pipeline-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const targetWork = join(root, "target-work");
  const target = join(root, "target.git");
  const source = join(root, "source");
  const releases = join(root, "releases");

  mkdirSync(targetWork);
  git(targetWork, ["init", "-q", "--initial-branch=master"]);
  git(targetWork, ["config", "user.name", "Legacy Publisher"]);
  git(targetWork, ["config", "user.email", "legacy@example.invalid"]);
  write(join(targetWork, "action.yml"), "name: Legacy action\n");
  const initialTarget = commit(targetWork, "Release v1.5.1");
  git(targetWork, ["tag", "-a", "v1.5.1", initialTarget, "-m", "Release v1.5.1"]);
  run("git", ["clone", "-q", "--bare", targetWork, target]);

  mkdirSync(source);
  git(source, ["init", "-q", "--initial-branch=master"]);
  git(source, ["config", "user.name", "Source Fixture"]);
  git(source, ["config", "user.email", "source@example.invalid"]);
  mkdirSync(join(source, "scripts"), { recursive: true });
  copyFileSync(releaseScript, join(source, "scripts", "release-action-subtree.sh"));
  copyFileSync(generator, join(source, "scripts", "generate-action-release-provenance.mjs"));
  chmodSync(join(source, "scripts", "release-action-subtree.sh"), 0o755);
  chmodSync(join(source, "scripts", "generate-action-release-provenance.mjs"), 0o755);
  write(join(source, ".github", "workflows", "sync-action-subtree.yml"), "name: fixture control\n");
  writeJson(join(source, "package.json"), { type: "module" });
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  baseline.initial_target_master = initialTarget;
  baseline.latest_legacy_release_commit = initialTarget;
  writeJson(join(source, "docs", "release", "action-v2-repository-baselines.json"), baseline);

  writeActionPayload(source, "2.0.0-rc.0");
  const bootstrapSnapshot = stagedActionSnapshot(source);
  writeJson(
    join(source, "release-manifest.json"),
    releaseManifest("2.0.0-rc.0", bootstrapSnapshot, initialTarget, "1.5.1"),
  );
  commit(source, "Install release controls");

  const sourceCommit = writeReleaseIntent(source, version, initialTarget, "1.5.1");
  return { root, target, source, releases, initialTarget, sourceCommit };
}

function releaseArgs(state, ...args) {
  return [
    join(state.source, "scripts", "release-action-subtree.sh"),
    ...args,
    "--test-target-url",
    state.target,
  ];
}

function buildAssembledCandidate(
  state,
  { sourceCommit = state.sourceCommit, controlCommit = sourceCommit, label = "initial" } = {},
) {
  const suffix = `${sourceCommit.slice(0, 12)}-${label}`;
  const plan = join(state.root, `plan-${suffix}.json`);
  const a = join(state.root, `candidate-a-${suffix}`);
  const b = join(state.root, `candidate-b-${suffix}`);
  const assembled = join(state.root, `assembled-${suffix}`);
  const publicationPlan = join(state.root, `publication-plan-${suffix}.json`);
  run("bash", releaseArgs(
    state,
    "--plan",
    "--source-ref",
    sourceCommit,
    "--control-ref",
    controlCommit,
    "--output",
    plan,
  ), { cwd: state.source });
  for (const outputDir of [a, b]) {
    run("bash", releaseArgs(
      state,
      "--build-candidate",
      "--source-ref",
      sourceCommit,
      "--control-ref",
      controlCommit,
      "--plan-file",
      plan,
      "--output-dir",
      outputDir,
    ), { cwd: state.source });
  }
  assert.deepEqual(readFileSync(join(a, "candidate.json")), readFileSync(join(b, "candidate.json")));
  run("bash", releaseArgs(
    state,
    "--assemble",
    "--source-ref",
    sourceCommit,
    "--control-ref",
    controlCommit,
    "--candidate-a",
    a,
    "--candidate-b",
    b,
    "--output-dir",
    assembled,
  ), { cwd: state.source });
  run("bash", releaseArgs(
    state,
    "--publication-plan",
    "--source-ref",
    sourceCommit,
    "--control-ref",
    controlCommit,
    "--candidate",
    assembled,
    "--output",
    publicationPlan,
  ), { cwd: state.source });
  run("bash", releaseArgs(
    state,
    "--verify-publication-plan",
    "--source-ref",
    sourceCommit,
    "--control-ref",
    controlCommit,
    "--candidate",
    assembled,
    "--publication-plan-file",
    publicationPlan,
  ), { cwd: state.source });
  return { plan, a, b, assembled, publicationPlan, sourceCommit, controlCommit };
}

function publishCandidate(state, built) {
  const output = run("bash", releaseArgs(
    state,
    "--publish",
    "--source-ref",
    built.sourceCommit,
    "--control-ref",
    built.controlCommit,
    "--candidate",
    built.assembled,
    "--publication-plan-file",
    built.publicationPlan,
    "--test-release-dir",
    state.releases,
    "--test-skip-signatures",
  ), { cwd: state.source });
  assert.equal(
    [...output.matchAll(/(?:^|\n)reconcile_state=[a-z_]+(?=\n|$)/gu)].length,
    1,
    `successful publish must emit exactly one reconcile state\n${output}`,
  );
  assert.deepEqual(
    [...output.matchAll(/recovery_code=([a-z0-9-]+)/gu)].map((match) => match[1]),
    ["none"],
    `successful publish must emit exactly one closed no-op recovery code\n${output}`,
  );
  return output;
}

function invokePublish(state, built, options = {}) {
  const result = invoke("bash", releaseArgs(
    state,
    "--publish",
    "--source-ref",
    built.sourceCommit,
    "--control-ref",
    built.controlCommit,
    "--candidate",
    built.assembled,
    "--publication-plan-file",
    built.publicationPlan,
    ...(options.testRelease === false
      ? ["--test-skip-signatures"]
      : ["--test-release-dir", state.releases, "--test-skip-signatures"]),
  ), { cwd: state.source, env: options.env });
  assert.equal(
    [...result.stdout.matchAll(/(?:^|\n)reconcile_state=[a-z_]+(?=\n|$)/gu),
      ...result.stderr.matchAll(/(?:^|\n)reconcile_state=[a-z_]+(?=\n|$)/gu)].length,
    1,
    `publish must emit exactly one reconcile state\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  const recoveryCodes = [
    ...result.stdout.matchAll(/recovery_code=([a-z0-9-]+)/gu),
    ...result.stderr.matchAll(/recovery_code=([a-z0-9-]+)/gu),
  ].map((match) => match[1]);
  assert.equal(
    recoveryCodes.length,
    1,
    `publish must emit exactly one recovery code\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  if (result.status === 0) assert.deepEqual(recoveryCodes, ["none"]);
  return result;
}

function advanceIntent(state, version, expectedHead, previousVersion) {
  git(state.source, ["switch", "-q", "master"]);
  const sourceCommit = writeReleaseIntent(state.source, version, expectedHead, previousVersion);
  state.sourceCommit = sourceCommit;
  return sourceCommit;
}

function releaseAssets(state, tag) {
  return run("find", [
    join(state.releases, tag),
    "-mindepth",
    "1",
    "-maxdepth",
    "1",
    "-type",
    "f",
    "-exec",
    "basename",
    "{}",
    ";",
  ]).split("\n").filter(Boolean).sort();
}

function createTagBeforeMaster(state, built) {
  const work = join(state.root, "out-of-order-target");
  run("git", ["clone", "-q", state.target, work]);
  git(work, ["config", "user.name", "JoeyTeng-Codex"]);
  git(work, ["config", "user.email", "codex@mahane.me"]);
  git(work, ["fetch", "-q", "--no-tags", state.source, built.sourceCommit]);
  const candidate = JSON.parse(readFileSync(join(built.assembled, "candidate.json"), "utf8"));
  const manifestBytes = gitBytes(state.source, ["show", `${built.sourceCommit}:release-manifest.json`]);
  const tag = `v${candidate.plan.version}`;
  const subject = `Release codex-review-gate-action ${tag}`;
  const body = `${subject}\n\nSource: Joey-Tools/codex-review-gate@${built.sourceCommit}\nManifest-SHA256: ${sha256(manifestBytes)}\n`;
  const releaseCommit = execFileSync(
    "git",
    ["-C", work, "commit-tree", candidate.plan.source_tree, "-p", state.initialTarget],
    {
      encoding: "utf8",
      env: {
        ...executionEnv,
        GIT_AUTHOR_NAME: "JoeyTeng-Codex",
        GIT_AUTHOR_EMAIL: "codex@mahane.me",
        GIT_COMMITTER_NAME: "JoeyTeng-Codex",
        GIT_COMMITTER_EMAIL: "codex@mahane.me",
      },
      input: body,
      stdio: ["pipe", "pipe", "pipe"],
    },
  ).trim();
  git(work, ["tag", "-a", tag, releaseCommit, "-m", subject]);
  git(work, ["push", "-q", "origin", `refs/tags/${tag}:refs/tags/${tag}`]);
  return { releaseCommit, tag };
}

function replaceAliasWithNestedTag(state, alias, fullTag) {
  const work = join(state.root, `nested-${alias}`);
  run("git", ["clone", "-q", state.target, work]);
  git(work, ["config", "user.name", "JoeyTeng-Codex"]);
  git(work, ["config", "user.email", "codex@mahane.me"]);
  git(work, ["tag", "-f", "-a", alias, fullTag, "-m", `Codex Review Gate Action ${alias}`]);
  const object = git(work, ["rev-parse", `refs/tags/${alias}`]);
  const direct = git(work, ["cat-file", "tag", object]).split("\n").find((line) => line.startsWith("object "))?.slice(7);
  assert.equal(git(work, ["cat-file", "-t", direct]), "tag", "fixture must be a tag-to-tag alias");
  git(state.target, ["fetch", "-q", work, object]);
  git(state.target, ["update-ref", `refs/tags/${alias}`, object]);
  return object;
}

function fakeGithubEnvironment(state, mutationPhase) {
  const fakeBin = join(state.root, `fake-gh-${mutationPhase}`);
  const fakeGh = join(fakeBin, "gh");
  const fakeState = join(state.root, `fake-gh-state-${mutationPhase}`);
  mkdirSync(fakeBin, { recursive: true });
  mkdirSync(join(fakeState, "assets"), { recursive: true });
  writeJson(join(fakeState, "state.json"), {
    exists: false,
    draft: true,
    immutable: false,
    prerelease: false,
    tag: "v2.0.0",
    name: "v2.0.0",
    body: "",
    latest: null,
    next_asset_id: 1,
    mutation_done: false,
    assets: [],
  });
  write(fakeGh, `#!/usr/bin/env node
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";

const args = process.argv.slice(2);
const root = process.env.FAKE_GH_STATE;
const statePath = join(root, "state.json");
const assetsDir = join(root, "assets");
const phase = process.env.FAKE_GH_MUTATION_PHASE;
const readState = () => JSON.parse(readFileSync(statePath, "utf8"));
const save = (state) => writeFileSync(statePath, JSON.stringify(state, null, 2) + "\\n");
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
};
const fail404 = () => {
  process.stderr.write("HTTP 404: Not Found\\n");
  process.exit(1);
};
const digest = (bytes) => "sha256:" + createHash("sha256").update(bytes).digest("hex");
const assetRecord = (state, name, id, created = "2026-08-26T00:00:00Z") => {
  const bytes = readFileSync(join(assetsDir, name));
  return {
    id,
    node_id: "asset-" + id,
    name,
    state: "uploaded",
    content_type: "application/octet-stream",
    size: bytes.byteLength,
    digest: digest(bytes),
    created_at: created,
    updated_at: state.mutation_done && name === "release-provenance.json" ? "2026-08-26T00:00:01Z" : created,
    url: "https://api.invalid/assets/" + id,
    browser_download_url: "https://download.invalid/" + name,
    uploader: {
      id: 4700530,
      node_id: "publisher-app",
      login: "codex-review-gate-action-publisher[bot]",
      type: "Bot",
    },
  };
};
const releaseApi = (state) => ({
  id: 1,
  node_id: "release-1",
  tag_name: state.tag,
  name: state.name,
  body: state.body,
  target_commitish: "master",
  prerelease: state.prerelease,
  draft: state.draft,
  immutable: state.immutable,
  author: {
    id: 4700530,
    node_id: "publisher-app",
    login: "codex-review-gate-action-publisher[bot]",
    type: "Bot",
  },
  assets: state.assets.map((asset) => assetRecord(state, asset.name, asset.id)),
});
const mutateProvenance = (state) => {
  if (state.mutation_done) return state;
  const name = "release-provenance.json";
  const path = join(assetsDir, name);
  writeFileSync(path, readFileSync(path, "utf8") + "replaced-after-upload\\n");
  const record = state.assets.find((asset) => asset.name === name);
  if (record) record.id = state.next_asset_id++;
  state.mutation_done = true;
  save(state);
  return state;
};

if (args[0] === "api") {
  const endpoint = args.slice(1).find((arg) => arg.startsWith("repos/"));
  const jq = option("--jq");
  let state = readState();
  if (endpoint?.endsWith("/releases?per_page=100")) {
    process.stdout.write(JSON.stringify([state.exists ? [releaseApi(state)] : []]) + "\\n");
    process.exit(0);
  }
  if (endpoint.endsWith("/releases/latest")) {
    if (!state.latest) fail404();
    process.stdout.write(state.latest + "\\n");
    process.exit(0);
  }
  if (endpoint.includes("/releases/tags/")) {
    if (!state.exists) fail404();
    if (jq === ".author.login") {
      process.stdout.write("codex-review-gate-action-publisher[bot]\\n");
      process.exit(0);
    }
    if (jq === ".immutable") {
      process.stdout.write(String(state.immutable) + "\\n");
      if (phase === "after-immutable") mutateProvenance(state);
      process.exit(0);
    }
    process.stdout.write(JSON.stringify(releaseApi(state)) + "\\n");
    process.exit(0);
  }
  process.stderr.write("unsupported fake gh api: " + endpoint + "\\n");
  process.exit(2);
}

if (args[0] === "release" && args[1] === "view") {
  const state = readState();
  if (!state.exists) fail404();
  if (option("--jq") === ".assets[].name") {
    process.stdout.write(state.assets.map((asset) => asset.name).sort().join("\\n") + (state.assets.length ? "\\n" : ""));
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({
    isDraft: state.draft,
    isPrerelease: state.prerelease,
    tagName: state.tag,
    name: state.name,
    body: state.body,
    assets: releaseApi(state).assets,
  }) + "\\n");
  process.exit(0);
}

if (args[0] === "release" && args[1] === "create") {
  const state = readState();
  state.exists = true;
  state.draft = true;
  state.immutable = false;
  state.prerelease = args.includes("--prerelease");
  state.tag = args[2];
  state.name = option("--title");
  state.body = option("--notes");
  save(state);
  process.exit(0);
}

if (args[0] === "release" && args[1] === "upload") {
  const state = readState();
  const source = args[3];
  const name = basename(source);
  copyFileSync(source, join(assetsDir, name));
  state.assets.push({ name, id: state.next_asset_id++ });
  save(state);
  process.exit(0);
}

if (args[0] === "release" && args[1] === "download") {
  const state = readState();
  const pattern = option("--pattern");
  const destination = option("--dir");
  mkdirSync(destination, { recursive: true });
  const selected = pattern === "*" ? state.assets : state.assets.filter((asset) => asset.name === pattern);
  for (const asset of selected) copyFileSync(join(assetsDir, asset.name), join(destination, asset.name));
  process.exit(selected.length > 0 ? 0 : 1);
}

if (args[0] === "release" && args[1] === "edit") {
  let state = readState();
  if (phase === "before-immutable") state = mutateProvenance(state);
  state.draft = false;
  state.immutable = true;
  state.latest = args.includes("--latest") ? state.tag : state.latest;
  save(state);
  process.exit(0);
}

process.stderr.write("unsupported fake gh call: " + args.join(" ") + "\\n");
process.exit(2);
`);
  chmodSync(fakeGh, 0o755);
  return {
    FAKE_GH_MUTATION_PHASE: mutationPhase,
    FAKE_GH_STATE: fakeState,
    PATH: `${fakeBin}:${executionEnv.PATH}`,
  };
}

test("publisher fixtures isolate the host workflow identity and credentials", () => {
  const observed = JSON.parse(run(process.execPath, [
    "-e",
    "process.stdout.write(JSON.stringify({ workflowRef: process.env.GITHUB_WORKFLOW_REF, runId: process.env.GITHUB_RUN_ID, runAttempt: process.env.GITHUB_RUN_ATTEMPT, output: process.env.GITHUB_OUTPUT, tokens: [process.env.GH_TOKEN, process.env.GITHUB_TOKEN, process.env.PUBLISHER_TOKEN, process.env.RELEASE_PUBLISHER_TOKEN] }))",
  ]));
  assert.deepEqual(observed, {
    workflowRef: RELEASE_WORKFLOW_REF,
    runId: "1",
    runAttempt: "1",
    output: "",
    tokens: ["", "", "", ""],
  });
});

test("workflow and publisher expose the adopted staged ABI and scoped credentials", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  const publisher = readFileSync(releaseScript, "utf8");
  const help = run("bash", [releaseScript, "--help"], { cwd: repositoryRoot });

  for (const mode of [
    "--plan",
    "--build-candidate",
    "--assemble",
    "--publication-plan",
    "--verify-publication-plan",
    "--publish",
    "--verify-published",
  ]) {
    assert.ok(help.includes(mode), mode);
  }
  assert.match(workflow, /plan:[\s\S]*candidate-a:[\s\S]*candidate-b:[\s\S]*assemble:[\s\S]*publication_plan:[\s\S]*publish:[\s\S]*verify:/u);
  assert.match(workflow, /publication_plan:[\s\S]*runs-on: ubuntu-slim/u);
  assert.match(workflow, /publish:[\s\S]*environment: marketplace-production/u);
  assert.ok(
    workflow.indexOf("Revalidate publication plan before minting credentials") <
      workflow.indexOf("Validate live release signing certificate before minting credentials") &&
      workflow.indexOf("Validate live release signing certificate before minting credentials") <
        workflow.indexOf("Create least-privilege publisher token"),
  );
  assert.match(workflow, /--verify-publication-plan[\s\S]*--publication-plan-file/u);
  assert.match(workflow, /--publish[\s\S]*--publication-plan-file/u);
  assert.doesNotMatch(workflow, /^\s*uses:\s*[^\s]+@(?:main|master|[0-9a-f]{40})/mu);
  for (const line of workflow.split("\n").filter((value) => /^\s*-?\s*uses:/u.test(value))) {
    assert.match(line, /@v[1-9][0-9]*$/u, line);
  }

  assert.doesNotMatch(workflow, /GIT_ASKPASS:\s*\$\{\{\s*steps\.publisher-token/u);
  assert.doesNotMatch(workflow, /GIT_ASKPASS=.*>>\s*"\$GITHUB_ENV"/u);
  assert.match(workflow, /RELEASE_TARGET_ASKPASS: \$\{\{ runner\.temp \}\}\/release-target-askpass/u);
  assert.doesNotMatch(workflow, /gh api installation\s*>/u);
  assert.match(workflow, /github-app-installation[\s\S]*--client-id "\$APP_CLIENT_ID"[\s\S]*--installation-id "\$ACTUAL_INSTALLATION_ID"[\s\S]*--output "\$installation_file"/u);
  assert.match(
    workflow,
    /RELEASE_PUBLISHER_APP_PRIVATE_KEY="\$app_private_key"[\s\S]*github-app-installation/u,
  );
  assert.doesNotMatch(workflow, /GH_TOKEN="\$app_jwt"|Authorization:\s*token/u);
  assert.match(
    workflow,
    /GH_TOKEN="\$installation_token" gh api installation\/repositories/u,
  );
  assert.doesNotMatch(workflow, /(?:APP_PRIVATE_KEY|app_jwt).*GITHUB_ENV/u);
  assert.match(workflow, /RELEASE_PUBLISHER_TOKEN: \$\{\{ steps\.publisher-token\.outputs\.token \}\}/u);
  assert.doesNotMatch(workflow, /^\s+(?:GH_TOKEN|PUBLISHER_TOKEN): \$\{\{ steps\.publisher-token\.outputs\.token \}\}/mu);
  assert.match(workflow, /Username for 'https:\/\/github\.com\/JoeyTeng\/codex-review-gate-action\.git'/u);
  assert.match(workflow, /Password for 'https:\/\/x-access-token@github\.com\/JoeyTeng\/codex-review-gate-action\.git'/u);
  assert.match(
    publisher,
    /set \+x[\s\S]*set \+v[\s\S]*set \+a[\s\S]*release_target_askpass="\$\{RELEASE_TARGET_ASKPASS:-\}"[\s\S]*export -n publisher_token release_target_askpass[\s\S]*unset RELEASE_TARGET_ASKPASS GIT_ASKPASS SSH_ASKPASS[\s\S]*readonly publisher_token release_target_askpass/u,
  );
  assert.match(
    publisher,
    /target_git_push\(\)[\s\S]*push_argv=\([^\n]*credential\.helper=[\s\S]*credential\.useHttpPath=true[\s\S]*http\.extraHeader=[\s\S]*"\$target_url" "\$refspec"\)[\s\S]*GIT_ASKPASS="\$release_target_askpass"[\s\S]*GIT_CONFIG_GLOBAL=\/dev\/null[\s\S]*GIT_CONFIG_NOSYSTEM=1[\s\S]*PUBLISHER_TOKEN="\$publisher_token"[\s\S]*command git "\$\{push_argv\[@\]\}"/u,
  );
  assert.match(publisher, /source_live_master\(\)[\s\S]*source_git ls-remote/u);
  assert.doesNotMatch(publisher, /readonly manifest=|\[\[ -f "\$manifest"/u);
  assert.match(publisher, /git cat-file -e "\$source_commit:release-manifest\.json"/u);
  assert.match(
    publisher,
    /fetch --quiet --force --no-write-fetch-head[\s\S]*'\+refs\/tags\/\*:refs\/tags\/\*'/u,
  );
  assert.match(
    publisher,
    /gh api --paginate --slurp[\s\S]*releases\?per_page=100[\s\S]*audit_release_inventory[\s\S]*audit_release_history/u,
  );
  assert.match(
    publisher,
    /verify-published[\s\S]*gh api users\/JoeyTeng-Codex\/gpg_keys[\s\S]*verify-github-signing-key[\s\S]*gpg --batch --import/u,
  );
  assert.match(
    publisher,
    /git\(\)[\s\S]*unset GH_TOKEN GITHUB_TOKEN PUBLISHER_TOKEN RELEASE_PUBLISHER_TOKEN[\s\S]*GIT_CONFIG_GLOBAL=\/dev\/null GIT_CONFIG_NOSYSTEM=1[\s\S]*command git -c credential\.helper= -c credential\.useHttpPath=true[\s\S]*http\.https:\/\/github\.com\/\.extraheader=/u,
  );
  assert.match(publisher, /prewrite-target-audit[\s\S]*audit_release_inventory[\s\S]*audit_release_history[\s\S]*initial_remote_ref_fingerprint/u);
  assert.ok(
    publisher.indexOf('[[ "$prewrite_ref_fingerprint_cloned" == "$initial_remote_ref_fingerprint" ]]') <
      publisher.indexOf('audit_release_inventory "$initial_release_inventory_fingerprint"'),
    "prewrite namespace drift must become inconclusive before semantic history audit",
  );
  assert.match(publisher, /audit_release_inventory\(\)[\s\S]*expected_fingerprint[\s\S]*remote-state-changed/u);
  assert.match(publisher, /is_v2_plus_major_alias "\$tag"[\s\S]*floating-alias-release/u);
  assert.match(
    publisher,
    /direct_annotated_tag_commit\(\)[\s\S]*cat-file tag "\$object"[\s\S]*direct_type[\s\S]*cat-file -t "\$direct_object"[\s\S]*== "commit"/u,
  );
  assert.match(
    publisher,
    /final_github_keys=.*final-prewrite[\s\S]*publisher_gh api users\/JoeyTeng-Codex\/gpg_keys[\s\S]*verify-github-signing-key[\s\S]*cmp -- "\$RUNNER_TEMP\/release-signing-public-key\.asc" "\$final_public_key"[\s\S]*target_git_push/u,
  );
  assert.match(
    publisher,
    /capture_absent_release_boundary[\s\S]*pre-create[\s\S]*post-create[\s\S]*before-upload-[\s\S]*after-upload-[\s\S]*pre-publish[\s\S]*post-publish[\s\S]*pre-alias[\s\S]*post-alias/u,
  );
  assert.match(workflow, /outputs:[\s\S]*reconcile_state: \$\{\{ steps\.reconcile\.outputs\.reconcile_state \}\}[\s\S]*id: reconcile/u);
  assert.match(workflow, /verify:[\s\S]*if: \$\{\{ needs\.publish\.outputs\.reconcile_state != 'superseded' \}\}/u);
});

test("malformed publish invocations still emit exactly one closed state and recovery code", (t) => {
  const state = fixture(t);
  for (const arguments_ of [
    ["--publish"],
    ["--publish", "--candidate"],
    ["--publish", "--unknown-publisher-option"],
    ["--publish", "--publish"],
  ]) {
    const result = invoke("bash", [join(state.source, "scripts", "release-action-subtree.sh"), ...arguments_], {
      cwd: state.source,
    });
    assert.notEqual(result.status, 0, arguments_.join(" "));
    const combined = `${result.stdout}\n${result.stderr}`;
    assert.equal(
      [...combined.matchAll(/(?:^|\n)reconcile_state=(?:fresh|resumable_partial|already_complete|superseded|blocked_conflict|inconclusive)(?=\n|$)/gu)].length,
      1,
      `${arguments_.join(" ")}\n${combined}`,
    );
    assert.equal(
      [...combined.matchAll(/recovery_code=[a-z0-9-]+/gu)].length,
      1,
      `${arguments_.join(" ")}\n${combined}`,
    );
  }
});

test("publisher disables inherited shell tracing before reading credentials", () => {
  const result = invoke("bash", [releaseScript, "--help"], {
    cwd: repositoryRoot,
    env: {
      RELEASE_PUBLISHER_TOKEN: SYNTHETIC_TOKEN_FIXTURE.value,
      RELEASE_TARGET_ASKPASS: "/private/tmp/codex-review-gate-synthetic-askpass",
      SHELLOPTS: "allexport:verbose:xtrace",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, new RegExp(SYNTHETIC_TOKEN_FIXTURE.value, "u"));
  assert.doesNotMatch(result.stderr, /(?:publisher_token|release_target_askpass)=/u);
  assert.equal(SYNTHETIC_TOKEN_FIXTURE.catalog, "joey-private-v3");
  assert.equal(SYNTHETIC_TOKEN_FIXTURE.id, "access-a");
});

test("target pushes command-scope the approved synthetic credential through askpass", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state);
  const fakeBin = join(state.root, "askpass-bin");
  const fakeGit = join(fakeBin, "git");
  const askpass = join(state.root, "target-askpass");
  const askpassLog = join(state.root, "askpass.log");
  mkdirSync(fakeBin);
  write(fakeGit, `#!/bin/sh
set -eu
is_push=false
for argument in "$@"; do
  [ "$argument" = push ] && is_push=true
done
if [ "$is_push" = true ]; then
  [ -n "\${GIT_ASKPASS:-}" ] || { printf '%s\n' push-without-askpass >> "$ASKPASS_LOG"; exit 96; }
  [ -z "\${publisher_token:-}\${release_target_askpass:-}" ] || { printf '%s\n' push-observed-lowercase-credential >> "$ASKPASS_LOG"; exit 95; }
  [ "\${GIT_CONFIG_GLOBAL:-}" = /dev/null ]
  [ "\${GIT_CONFIG_NOSYSTEM:-}" = 1 ]
  arguments=" $* "
  case "$arguments" in *" -c credential.helper= "*) ;; *) exit 94 ;; esac
  case "$arguments" in *" -c credential.useHttpPath=true "*) ;; *) exit 94 ;; esac
  case "$arguments" in *" -c http.extraHeader= "*) ;; *) exit 94 ;; esac
  username="$("$GIT_ASKPASS" "Username for 'https://github.com/JoeyTeng/codex-review-gate-action.git': ")"
  password="$("$GIT_ASKPASS" "Password for 'https://x-access-token@github.com/JoeyTeng/codex-review-gate-action.git': ")"
  [ "$username" = x-access-token ]
  [ "$password" = "$PUBLISHER_TOKEN" ]
  printf '%s\n' push-with-askpass >> "$ASKPASS_LOG"
elif [ -n "\${PUBLISHER_TOKEN:-}\${GH_TOKEN:-}\${GITHUB_TOKEN:-}\${RELEASE_PUBLISHER_TOKEN:-}\${RELEASE_TARGET_ASKPASS:-}\${GIT_ASKPASS:-}\${publisher_token:-}\${release_target_askpass:-}" ]; then
  printf '%s\n' non-push-observed-publisher-credential >> "$ASKPASS_LOG"
  exit 98
elif [ -n "\${GIT_ASKPASS:-}" ]; then
  printf '%s\n' non-push-observed-askpass >> "$ASKPASS_LOG"
  exit 97
fi
exec "$REAL_GIT" "$@"
`);
  chmodSync(fakeGit, 0o755);
write(askpass, `#!/bin/sh
set -eu
[ "\${CODEX_RELEASE_TARGET_URL:-}" = "$EXPECTED_TARGET_URL" ]
prompt="\${1:-}"
prompt="\${prompt% }"
case "$prompt" in
  "Username for 'https://github.com/JoeyTeng/codex-review-gate-action.git':") printf '%s\n' x-access-token ;;
  "Password for 'https://x-access-token@github.com/JoeyTeng/codex-review-gate-action.git':")
    [ "\${PUBLISHER_TOKEN:-}" = "${SYNTHETIC_TOKEN_FIXTURE.value}" ]
    printf '%s\n' "$PUBLISHER_TOKEN"
    ;;
  *) exit 1 ;;
esac
`);
  chmodSync(askpass, 0o700);

  const result = invokePublish(state, built, {
    env: {
      ASKPASS_LOG: askpassLog,
      CODEX_REVIEW_GATE_TEST_ENFORCE_ASKPASS: "1",
      EXPECTED_TARGET_URL: state.target,
      GIT_ASKPASS: "",
      PATH: `${fakeBin}:${executionEnv.PATH}`,
      PUBLISHER_TOKEN: SYNTHETIC_TOKEN_FIXTURE.value,
      REAL_GIT: run("which", ["git"]),
      RELEASE_TARGET_ASKPASS: askpass,
      SHELLOPTS: "allexport",
      publisher_token: SYNTHETIC_TOKEN_FIXTURE.value,
      release_target_askpass: askpass,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(SYNTHETIC_TOKEN_FIXTURE.catalog, "joey-private-v3");
  assert.equal(SYNTHETIC_TOKEN_FIXTURE.id, "access-a");
  assert.deepEqual(readFileSync(askpassLog, "utf8").trim().split("\n"), [
    "push-with-askpass",
    "push-with-askpass",
    "push-with-askpass",
  ]);
});

test("target askpass rejects a remote URL other than the actual target", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state);
  const fakeBin = join(state.root, "rejecting-askpass-bin");
  const fakeGit = join(fakeBin, "git");
  const askpass = join(state.root, "rejecting-target-askpass");
  const askpassLog = join(state.root, "rejecting-askpass.log");
  mkdirSync(fakeBin);
  write(fakeGit, `#!/bin/sh
set -eu
is_push=false
for argument in "$@"; do
  [ "$argument" = push ] && is_push=true
done
if [ "$is_push" = true ]; then
  "$GIT_ASKPASS" 'Username for target'
  exit 98
fi
[ -z "\${GIT_ASKPASS:-}" ]
exec "$REAL_GIT" "$@"
`);
  chmodSync(fakeGit, 0o755);
  write(askpass, `#!/bin/sh
set -eu
if [ "\${CODEX_RELEASE_TARGET_URL:-}" != "$EXPECTED_TARGET_URL" ]; then
  printf '%s\n' rejected-remote-url >> "$ASKPASS_LOG"
  exit 1
fi
case "\${1:-}" in
  *Username*) printf '%s\n' x-access-token ;;
  *Password*) printf '%s\n' "$PUBLISHER_TOKEN" ;;
  *) exit 1 ;;
esac
`);
  chmodSync(askpass, 0o700);

  const result = invokePublish(state, built, {
    env: {
      ASKPASS_LOG: askpassLog,
      CODEX_REVIEW_GATE_TEST_ENFORCE_ASKPASS: "1",
      EXPECTED_TARGET_URL: `${state.target}.different`,
      GIT_ASKPASS: "",
      PATH: `${fakeBin}:${executionEnv.PATH}`,
      PUBLISHER_TOKEN: SYNTHETIC_TOKEN_FIXTURE.value,
      REAL_GIT: run("which", ["git"]),
      RELEASE_TARGET_ASKPASS: askpass,
    },
  });
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(askpassLog, "utf8"), "rejected-remote-url\n");
  assert.equal(git(state.target, ["rev-parse", "refs/heads/master"]), state.initialTarget);
  assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2.0.0"]));
  assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2"]));
});

test("target askpass rejects a non-canonical Git credential prompt", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state, { label: "wrong-prompt" });
  const fakeBin = join(state.root, "wrong-prompt-bin");
  const fakeGit = join(fakeBin, "git");
  const askpass = join(state.root, "wrong-prompt-askpass");
  const askpassLog = join(state.root, "wrong-prompt.log");
  mkdirSync(fakeBin);
  write(fakeGit, `#!/bin/sh
set -eu
is_push=false
for argument in "$@"; do
  [ "$argument" = push ] && is_push=true
done
if [ "$is_push" = true ]; then
  "$GIT_ASKPASS" "Username for 'https://github.com/JoeyTeng/not-the-release-target.git': "
  exit 98
fi
[ -z "\${GIT_ASKPASS:-}" ]
exec "$REAL_GIT" "$@"
`);
  chmodSync(fakeGit, 0o755);
  write(askpass, `#!/bin/sh
set -eu
[ "\${CODEX_RELEASE_TARGET_URL:-}" = "$EXPECTED_TARGET_URL" ]
prompt="\${1:-}"
prompt="\${prompt% }"
case "$prompt" in
  "Username for 'https://github.com/JoeyTeng/codex-review-gate-action.git':") printf '%s\n' x-access-token ;;
  "Password for 'https://x-access-token@github.com/JoeyTeng/codex-review-gate-action.git':") printf '%s\n' "$PUBLISHER_TOKEN" ;;
  *) printf '%s\n' rejected-prompt >> "$ASKPASS_LOG"; exit 1 ;;
esac
`);
  chmodSync(askpass, 0o700);

  const result = invokePublish(state, built, {
    env: {
      ASKPASS_LOG: askpassLog,
      CODEX_REVIEW_GATE_TEST_ENFORCE_ASKPASS: "1",
      EXPECTED_TARGET_URL: state.target,
      GIT_ASKPASS: "",
      PATH: `${fakeBin}:${executionEnv.PATH}`,
      PUBLISHER_TOKEN: SYNTHETIC_TOKEN_FIXTURE.value,
      REAL_GIT: run("which", ["git"]),
      RELEASE_TARGET_ASKPASS: askpass,
    },
  });
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(askpassLog, "utf8"), "rejected-prompt\n");
  assert.equal(git(state.target, ["rev-parse", "refs/heads/master"]), state.initialTarget);
  assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2.0.0"]));
  assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2"]));
});

for (const stagedRemoteFailure of ["wrong-origin", "pushurl", "credential-config"]) {
  test(`target push rejects staged ${stagedRemoteFailure} before invoking askpass`, (t) => {
    const state = fixture(t);
    const built = buildAssembledCandidate(state, { label: stagedRemoteFailure });
    const fakeBin = join(state.root, `${stagedRemoteFailure}-bin`);
    const fakeGit = join(fakeBin, "git");
    const askpass = join(state.root, `${stagedRemoteFailure}-askpass`);
    const transportLog = join(state.root, `${stagedRemoteFailure}-transport.log`);
    const askpassLog = join(state.root, `${stagedRemoteFailure}-askpass.log`);
    mkdirSync(fakeBin);
    write(fakeGit, `#!/bin/sh
set -eu
arguments=" $* "
case "$arguments" in
  *" config --local --get-all remote.origin.url "*)
    if [ "$STAGED_REMOTE_FAILURE" = wrong-origin ]; then
      printf '%s\n' reported-wrong-origin >> "$TRANSPORT_LOG"
      printf '%s\n' "$EXPECTED_TARGET_URL.different"
      exit 0
    fi
    ;;
  *" config --local --get-regexp ^remote\\..*\\.pushurl$ "*)
    if [ "$STAGED_REMOTE_FAILURE" = pushurl ]; then
      printf '%s\n' reported-pushurl >> "$TRANSPORT_LOG"
      printf '%s\n' "remote.origin.pushurl $EXPECTED_TARGET_URL.different"
      exit 0
    fi
    ;;
  *" config --local --get-regexp ^(credential\\..*|http\\..*\\.extraheader|http\\.extraheader)$ "*)
    if [ "$STAGED_REMOTE_FAILURE" = credential-config ]; then
      printf '%s\n' reported-credential-config >> "$TRANSPORT_LOG"
      printf '%s\n' "credential.helper malicious-helper"
      exit 0
    fi
    ;;
esac
is_push=false
for argument in "$@"; do
  [ "$argument" = push ] && is_push=true
done
if [ "$is_push" = true ]; then
  printf '%s\n' push-attempted >> "$TRANSPORT_LOG"
  if [ -n "\${GIT_ASKPASS:-}\${PUBLISHER_TOKEN:-}" ]; then
    printf '%s\n' credential-exposed-to-push >> "$TRANSPORT_LOG"
  fi
  exit 95
fi
exec "$REAL_GIT" "$@"
`);
    chmodSync(fakeGit, 0o755);
    write(askpass, `#!/bin/sh
set -eu
printf '%s\n' askpass-invoked >> "$ASKPASS_LOG"
exit 96
`);
    chmodSync(askpass, 0o700);

    const result = invokePublish(state, built, {
      env: {
        ASKPASS_LOG: askpassLog,
        CODEX_REVIEW_GATE_TEST_ENFORCE_ASKPASS: "1",
        EXPECTED_TARGET_URL: state.target,
        GIT_ASKPASS: "",
        PATH: `${fakeBin}:${executionEnv.PATH}`,
        PUBLISHER_TOKEN: SYNTHETIC_TOKEN_FIXTURE.value,
        REAL_GIT: run("which", ["git"]),
        RELEASE_TARGET_ASKPASS: askpass,
        STAGED_REMOTE_FAILURE: stagedRemoteFailure,
        TRANSPORT_LOG: transportLog,
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /reconcile_state=blocked_conflict/u);
    assert.match(result.stderr, /recovery_code=publisher-execution-failure/u);
    assert.equal(readFileSync(transportLog, "utf8"), `reported-${stagedRemoteFailure}\n`);
    assert.equal(existsSync(askpassLog), false);
    assert.equal(git(state.target, ["rev-parse", "refs/heads/master"]), state.initialTarget);
    assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2.0.0"]));
    assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2"]));
  });
}

test("schema-v2 manifest produces deterministic node20 candidates with a NUL inventory digest", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state);
  const manifest = JSON.parse(git(state.source, ["show", `${state.sourceCommit}:release-manifest.json`]));
  const baseline = JSON.parse(readFileSync(join(state.source, "docs", "release", "action-v2-repository-baselines.json"), "utf8"));
  const candidate = JSON.parse(readFileSync(join(built.assembled, "candidate.json"), "utf8"));

  assert.equal(manifest.schema_version, 2);
  assert.equal(manifest.$schema, "urn:joey-tools:codex-review-gate:release-manifest:2");
  assert.equal(manifest.contract_versions.baseline, 3);
  assert.equal(baseline.schema_version, 3);
  assert.equal(baseline.$schema, "urn:joey-tools:codex-review-gate:action-release-baseline:3");
  assert.deepEqual(manifest.entrypoint, {
    metadata_path: "action.yml",
    using: "node20",
    main: "src/v2/gate-runtime.mjs",
  });
  assert.equal(candidate.plan.source_tree, manifest.source.tree);
  assert.deepEqual(candidate.payload.files, manifest.files);
  assert.equal(candidate.payload.inventory_sha256, inventoryDigest(candidate.payload.files));
  assert.deepEqual(readFileSync(join(built.a, "candidate.json")), readFileSync(join(built.b, "candidate.json")));
  assert.deepEqual(
    readFileSync(join(built.a, candidate.archive.name)),
    readFileSync(join(built.b, candidate.archive.name)),
  );
  assert.equal(candidate.payload.files.filter((entry) => entry.path.startsWith("src/v2/")).length, 1);
  assert.equal(candidate.payload.files.find((entry) => entry.path === "src/v2/gate-runtime.mjs")?.mode, "100644");
});

test("candidate transport is validated before extraction and rejects symlinks", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state);
  const transport = join(state.root, "candidate.tar");
  run("tar", ["--format=ustar", "-cf", transport, "-C", built.assembled, "."], {
    env: { ...executionEnv, COPYFILE_DISABLE: "1" },
  });
  const extracted = join(state.root, "extracted");
  run("node", [generator, "extract-transport", "--archive", transport, "--output-dir", extracted]);
  assert.deepEqual(readFileSync(join(extracted, "candidate.json")), readFileSync(join(built.assembled, "candidate.json")));

  const unsafe = join(state.root, "unsafe");
  mkdirSync(unsafe);
  const candidate = JSON.parse(readFileSync(join(built.assembled, "candidate.json"), "utf8"));
  symlinkSync(join(built.assembled, "candidate.json"), join(unsafe, "candidate.json"));
  copyFileSync(join(built.assembled, candidate.archive.name), join(unsafe, candidate.archive.name));
  const unsafeTransport = join(state.root, "unsafe.tar");
  run("tar", ["--format=ustar", "-cf", unsafeTransport, "-C", unsafe, "."], {
    env: { ...executionEnv, COPYFILE_DISABLE: "1" },
  });
  const result = invoke("node", [
    generator,
    "extract-transport",
    "--archive",
    unsafeTransport,
    "--output-dir",
    join(state.root, "unsafe-extracted"),
  ]);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /release tar rejects links and special entries: candidate\.json|exactly two root regular files|root-scoped mode-0600 regular files/u,
  );
});

test("publication plan is mandatory, candidate-bound, and verified before publication", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state);
  const missing = invoke("bash", releaseArgs(
    state,
    "--publish",
    "--source-ref",
    built.sourceCommit,
    "--control-ref",
    built.controlCommit,
    "--candidate",
    built.assembled,
    "--test-release-dir",
    state.releases,
    "--test-skip-signatures",
  ), { cwd: state.source });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /requires --candidate and --publication-plan-file/u);

  const plan = JSON.parse(readFileSync(built.publicationPlan, "utf8"));
  plan.candidate.archive_sha256 = "0".repeat(64);
  writeJson(built.publicationPlan, plan);
  const tampered = invokePublish(state, built);
  assert.notEqual(tampered.status, 0);
  assert.match(tampered.stderr, /recovery_code=publication-input-preflight/u);
  assert.equal(git(state.target, ["rev-parse", "refs/heads/master"]), state.initialTarget);
  assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2.0.0"]));
});

test("fresh stable publication verifies the immutable Release before advancing its alias", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state);
  const output = publishCandidate(state, built);
  assert.match(output, /reconcile_state=fresh/u);

  const releaseCommit = git(state.target, ["rev-parse", "refs/tags/v2.0.0^{}"]);
  assert.equal(git(state.target, ["rev-parse", "refs/heads/master"]), releaseCommit);
  assert.equal(git(state.target, ["rev-parse", "refs/tags/v2^{}"]), releaseCommit);
  assert.equal(git(state.target, ["show", "-s", "--format=%P", releaseCommit]), state.initialTarget);
  assert.equal(git(state.target, ["rev-parse", `${releaseCommit}^{tree}`]), git(state.source, ["rev-parse", `${state.sourceCommit}:packages/action`]));
  assert.deepEqual(releaseAssets(state, "v2.0.0"), [
    "codex-review-gate-action-v2.0.0.tar.gz",
    "immutable",
    "prerelease",
    "published",
    "release-provenance.json",
    "release-provenance.json.asc",
  ]);
});

test("an already-complete release is a byte-stable no-op on rerun", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state);
  publishCandidate(state, built);
  const before = {
    master: git(state.target, ["rev-parse", "refs/heads/master"]),
    full: git(state.target, ["rev-parse", "refs/tags/v2.0.0"]),
    alias: git(state.target, ["rev-parse", "refs/tags/v2"]),
    provenance: readFileSync(join(state.releases, "v2.0.0", "release-provenance.json")),
  };
  const output = publishCandidate(state, built);
  assert.match(output, /reconcile_state=already_complete/u);
  assert.equal(git(state.target, ["rev-parse", "refs/heads/master"]), before.master);
  assert.equal(git(state.target, ["rev-parse", "refs/tags/v2.0.0"]), before.full);
  assert.equal(git(state.target, ["rev-parse", "refs/tags/v2"]), before.alias);
  assert.deepEqual(readFileSync(join(state.releases, "v2.0.0", "release-provenance.json")), before.provenance);
});

test("a complete immutable Release with a missing alias resumes only the alias", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state);
  publishCandidate(state, built);
  const master = git(state.target, ["rev-parse", "refs/heads/master"]);
  const full = git(state.target, ["rev-parse", "refs/tags/v2.0.0"]);
  git(state.target, ["update-ref", "-d", "refs/tags/v2"]);

  const output = publishCandidate(state, built);
  assert.match(output, /reconcile_state=resumable_partial/u);
  assert.equal(git(state.target, ["rev-parse", "refs/heads/master"]), master);
  assert.equal(git(state.target, ["rev-parse", "refs/tags/v2.0.0"]), full);
  assert.equal(git(state.target, ["rev-parse", "refs/tags/v2^{}"]), master);
});

test("a nested annotated floating alias is rejected instead of recursively peeled", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state, { label: "nested-alias" });
  publishCandidate(state, built);
  const master = git(state.target, ["rev-parse", "refs/heads/master"]);
  const full = git(state.target, ["rev-parse", "refs/tags/v2.0.0"]);
  const nested = replaceAliasWithNestedTag(state, "v2", "v2.0.0");

  const result = invokePublish(state, built);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reconcile_state=blocked_conflict/u);
  assert.match(result.stderr, /major alias must be an annotated tag that directly targets a commit|malformed-major-alias-target/u);
  assert.equal(git(state.target, ["rev-parse", "refs/heads/master"]), master);
  assert.equal(git(state.target, ["rev-parse", "refs/tags/v2.0.0"]), full);
  assert.equal(git(state.target, ["rev-parse", "refs/tags/v2"]), nested);
});

test("a published Release that is not immutable blocks alias recovery", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state);
  publishCandidate(state, built);
  git(state.target, ["update-ref", "-d", "refs/tags/v2"]);
  rmSync(join(state.releases, "v2.0.0", "immutable"));

  const result = invokePublish(state, built);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reconcile_state=blocked_conflict/u);
  assert.match(result.stderr, /published test Release is incomplete or mutable/u);
  assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2"]));
});

test("an older partial release blocks a newer release from leapfrogging", (t) => {
  const state = fixture(t);
  const first = buildAssembledCandidate(state);
  publishCandidate(state, first);
  const firstCommit = git(state.target, ["rev-parse", "refs/tags/v2.0.0^{}"]);
  rmSync(join(state.releases, "v2.0.0", "immutable"));

  advanceIntent(state, "2.0.1", firstCommit, "2.0.0");
  const second = buildAssembledCandidate(state, { label: "next" });
  const result = invokePublish(state, second);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reconcile_state=blocked_conflict/u);
  assert.match(result.stderr, /recovery_code=older-partial-release/u);
  assert.equal(git(state.target, ["rev-parse", "refs/heads/master"]), firstCommit);
  assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2.0.1"]));
});

test("a historical partial release blocks a newer version even when the immediate predecessor is complete", (t) => {
  const state = fixture(t);
  const first = buildAssembledCandidate(state, { label: "historical-first" });
  publishCandidate(state, first);
  const firstCommit = git(state.target, ["rev-parse", "refs/tags/v2.0.0^{}"]);

  advanceIntent(state, "2.0.1", firstCommit, "2.0.0");
  const second = buildAssembledCandidate(state, { label: "historical-second" });
  publishCandidate(state, second);
  const secondCommit = git(state.target, ["rev-parse", "refs/tags/v2.0.1^{}"]);
  rmSync(join(state.releases, "v2.0.0", "immutable"));

  advanceIntent(state, "2.0.2", secondCommit, "2.0.1");
  const third = buildAssembledCandidate(state, { label: "historical-third" });
  const result = invokePublish(state, third);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reconcile_state=blocked_conflict/u);
  assert.match(result.stderr, /recovery_code=older-partial-release/u);
  assert.equal(git(state.target, ["rev-parse", "refs/heads/master"]), secondCommit);
  assert.equal(git(state.target, ["rev-parse", "refs/tags/v2^{}"]), secondCommit);
  assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2.0.2"]));
});

test("an independently inventoried Release without a full tag blocks publication", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state, { label: "release-without-tag" });
  const orphanRelease = join(state.releases, "v2.0.1");
  mkdirSync(orphanRelease, { recursive: true });
  write(join(orphanRelease, "prerelease"), "false\n");

  const result = invokePublish(state, built);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reconcile_state=blocked_conflict/u);
  assert.match(result.stderr, /recovery_code=release-without-full-tag/u);
  assert.equal(git(state.target, ["rev-parse", "refs/heads/master"]), state.initialTarget);
  assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2.0.0"]));
});

test("an unreachable remote full tag is discovered and blocks later publication", (t) => {
  const state = fixture(t);
  const first = buildAssembledCandidate(state, { label: "unreachable-first" });
  publishCandidate(state, first);
  const firstCommit = git(state.target, ["rev-parse", "refs/heads/master"]);

  advanceIntent(state, "2.1.0", firstCommit, "2.0.0");
  const second = buildAssembledCandidate(state, { label: "unreachable-second" });
  publishCandidate(state, second);
  const secondCommit = git(state.target, ["rev-parse", "refs/heads/master"]);
  assert.notEqual(secondCommit, firstCommit);
  git(state.target, ["update-ref", "refs/heads/master", firstCommit, secondCommit]);

  advanceIntent(state, "2.2.0", firstCommit, "2.0.0");
  const later = buildAssembledCandidate(state, { label: "unreachable-later" });
  const result = invokePublish(state, later);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reconcile_state=blocked_conflict/u);
  assert.match(result.stderr, /recovery_code=out-of-order-release-prefix/u);
  assert.equal(git(state.target, ["rev-parse", "refs/heads/master"]), firstCommit);
  assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2.2.0"]));
});

test("a later complete release classifies an old unpublished intent as superseded", (t) => {
  const state = fixture(t, "2.0.1");
  const oldSource = state.sourceCommit;
  advanceIntent(state, "2.1.0", state.initialTarget, "1.5.1");
  const later = buildAssembledCandidate(state, { label: "later" });
  publishCandidate(state, later);
  const laterMaster = git(state.target, ["rev-parse", "refs/heads/master"]);
  const old = buildAssembledCandidate(state, {
    sourceCommit: oldSource,
    controlCommit: state.sourceCommit,
    label: "old-current-plan",
  });

  const result = invokePublish(state, old);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /reconcile_state=superseded/u);
  assert.equal(git(state.target, ["rev-parse", "refs/heads/master"]), laterMaster);
  assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2.0.1"]));
});

test("an old unpublished intent rejects a rolled-back alias behind the highest complete stable release", (t) => {
  const state = fixture(t, "2.0.1");
  const oldSource = state.sourceCommit;

  advanceIntent(state, "2.1.0", state.initialTarget, "1.5.1");
  const firstLater = buildAssembledCandidate(state, { label: "unpublished-rollback-first-later" });
  publishCandidate(state, firstLater);
  const firstLaterCommit = git(state.target, ["rev-parse", "refs/tags/v2.1.0^{}"]);
  const firstLaterAliasObject = git(state.target, ["rev-parse", "refs/tags/v2"]);

  advanceIntent(state, "2.2.0", firstLaterCommit, "2.1.0");
  const highest = buildAssembledCandidate(state, { label: "unpublished-rollback-highest" });
  publishCandidate(state, highest);
  const highestCommit = git(state.target, ["rev-parse", "refs/tags/v2.2.0^{}"]);
  git(state.target, ["update-ref", "refs/tags/v2", firstLaterAliasObject]);

  const refsBefore = git(state.target, ["show-ref"]);
  const old = buildAssembledCandidate(state, {
    sourceCommit: oldSource,
    controlCommit: state.sourceCommit,
    label: "unpublished-rollback-old",
  });
  const result = invokePublish(state, old);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reconcile_state=blocked_conflict/u);
  assert.match(result.stderr, /recovery_code=older-partial-release/u);
  assert.match(result.stderr, /highest complete stable release v2\.2\.0/u);
  assert.equal(git(state.target, ["show-ref"]), refsBefore);
  assert.equal(git(state.target, ["rev-parse", "refs/heads/master"]), highestCommit);
  assert.equal(git(state.target, ["rev-parse", "refs/tags/v2^{}"]), firstLaterCommit);
  assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2.0.1"]));
});

test("an old exact-source rerun never recreates a missing alias behind a completed newer stable release", (t) => {
  const state = fixture(t);
  const oldSource = state.sourceCommit;
  const first = buildAssembledCandidate(state, { label: "no-rollback-first" });
  publishCandidate(state, first);
  const firstCommit = git(state.target, ["rev-parse", "refs/tags/v2.0.0^{}"]);

  advanceIntent(state, "2.1.0", firstCommit, "2.0.0");
  const newer = buildAssembledCandidate(state, { label: "no-rollback-newer" });
  publishCandidate(state, newer);
  const newerCommit = git(state.target, ["rev-parse", "refs/tags/v2.1.0^{}"]);
  git(state.target, ["update-ref", "-d", "refs/tags/v2"]);

  const old = buildAssembledCandidate(state, {
    sourceCommit: oldSource,
    controlCommit: oldSource,
    label: "no-rollback-old-rerun",
  });
  const result = invokePublish(state, old);
  if (result.status === 0) {
    assert.match(result.stdout, /reconcile_state=superseded/u);
  } else {
    assert.match(result.stderr, /reconcile_state=blocked_conflict/u);
    assert.match(result.stderr, /recovery_code=older-partial-release/u);
  }
  assert.equal(git(state.target, ["rev-parse", "refs/heads/master"]), newerCommit);
  assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2"]));
});

test("an old rerun cannot accept a rolled-back alias when a newer same-major release is complete", (t) => {
  const state = fixture(t);
  const oldSource = state.sourceCommit;
  const first = buildAssembledCandidate(state, { label: "rolled-back-alias-first" });
  publishCandidate(state, first);
  const firstCommit = git(state.target, ["rev-parse", "refs/tags/v2.0.0^{}"]);
  const firstAliasObject = git(state.target, ["rev-parse", "refs/tags/v2"]);

  advanceIntent(state, "2.1.0", firstCommit, "2.0.0");
  const newer = buildAssembledCandidate(state, { label: "rolled-back-alias-newer" });
  publishCandidate(state, newer);
  const newerCommit = git(state.target, ["rev-parse", "refs/tags/v2.1.0^{}"]);
  git(state.target, ["update-ref", "refs/tags/v2", firstAliasObject]);
  assert.equal(git(state.target, ["rev-parse", "refs/tags/v2^{}"]), firstCommit);

  const refsBefore = git(state.target, ["show-ref"]);
  const releasesBefore = Object.fromEntries(["v2.0.0", "v2.1.0"].flatMap((tag) =>
    releaseAssets(state, tag).map((name) => [
      `${tag}/${name}`,
      sha256(readFileSync(join(state.releases, tag, name))),
    ])));
  const old = buildAssembledCandidate(state, {
    sourceCommit: oldSource,
    controlCommit: state.sourceCommit,
    label: "rolled-back-alias-old-rerun",
  });
  const result = invokePublish(state, old);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /reconcile_state=already_complete/u);
  if (result.status === 0) {
    assert.match(result.stdout, /reconcile_state=superseded/u);
  } else {
    assert.match(result.stderr, /reconcile_state=blocked_conflict/u);
  }
  assert.equal(git(state.target, ["show-ref"]), refsBefore);
  assert.deepEqual(Object.fromEntries(["v2.0.0", "v2.1.0"].flatMap((tag) =>
    releaseAssets(state, tag).map((name) => [
      `${tag}/${name}`,
      sha256(readFileSync(join(state.releases, tag, name))),
    ]))), releasesBefore);
  assert.equal(git(state.target, ["rev-parse", "refs/heads/master"]), newerCommit);
  assert.equal(git(state.target, ["rev-parse", "refs/tags/v2^{}"]), firstCommit);
});

test("an unreadable GitHub Release snapshot is inconclusive and performs no durable write", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state);
  const fakeBin = join(state.root, "fake-bin");
  mkdirSync(fakeBin);
  const fakeGh = join(fakeBin, "gh");
  write(fakeGh, "#!/bin/sh\necho 'simulated remote read failure' >&2\nexit 1\n");
  chmodSync(fakeGh, 0o755);

  const result = invokePublish(state, built, {
    testRelease: false,
    env: { PATH: `${fakeBin}:${executionEnv.PATH}` },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reconcile_state=inconclusive/u);
  assert.match(result.stderr, /recovery_code=remote-read-inconclusive/u);
  assert.equal(git(state.target, ["rev-parse", "refs/heads/master"]), state.initialTarget);
  assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2.0.0"]));
});

test("prewrite namespace drift becomes inconclusive before malformed history can write", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state, { label: "prewrite-namespace-drift" });
  const fakeBin = join(state.root, "prewrite-drift-bin");
  const fakeGit = join(fakeBin, "git");
  const mutationMarker = join(state.root, "prewrite-drift-mutated");
  const realGit = run("which", ["git"]);
  mkdirSync(fakeBin);
  write(fakeGit, `#!/bin/sh
for argument in "$@"; do
  case "$argument" in
    *prewrite-target-audit*)
      if [ ! -e "$MUTATION_MARKER" ]; then
        "$REAL_GIT" --git-dir="$MUTATION_TARGET" update-ref refs/tags/v2.9.9 "$MUTATION_COMMIT" || exit $?
        : > "$MUTATION_MARKER"
      fi
      ;;
  esac
done
exec "$REAL_GIT" "$@"
`);
  chmodSync(fakeGit, 0o755);

  const result = invokePublish(state, built, {
    env: {
      MUTATION_COMMIT: state.initialTarget,
      MUTATION_MARKER: mutationMarker,
      MUTATION_TARGET: state.target,
      PATH: `${fakeBin}:${executionEnv.PATH}`,
      REAL_GIT: realGit,
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reconcile_state=inconclusive/u);
  assert.match(result.stderr, /recovery_code=remote-state-changed/u);
  assert.equal(existsSync(mutationMarker), true);
  assert.equal(git(state.target, ["rev-parse", "refs/heads/master"]), state.initialTarget);
  assert.equal(git(state.target, ["cat-file", "-t", "refs/tags/v2.9.9"]), "commit");
  assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2.0.0"]));
  assert.equal(existsSync(join(state.releases, "v2.0.0")), false);
});

for (const mutationPhase of ["before-immutable", "after-immutable"]) {
  test(`same-name provenance replacement ${mutationPhase} blocks the floating alias`, (t) => {
    const state = fixture(t);
    const built = buildAssembledCandidate(state, { label: mutationPhase });
    const result = invokePublish(state, built, {
      testRelease: false,
      env: fakeGithubEnvironment(state, mutationPhase),
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /reconcile_state=(?:blocked_conflict|inconclusive)/u);
    const fakeState = JSON.parse(readFileSync(join(state.root, `fake-gh-state-${mutationPhase}`, "state.json"), "utf8"));
    assert.equal(fakeState.mutation_done, true);
    assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2"]));
  });
}

test("a full version tag published before target master is an out-of-order hard conflict", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state, { label: "tag-before-master" });
  const { releaseCommit } = createTagBeforeMaster(state, built);
  assert.equal(git(state.target, ["rev-parse", "refs/tags/v2.0.0^{}"]), releaseCommit);
  assert.equal(git(state.target, ["rev-parse", "refs/heads/master"]), state.initialTarget);

  const result = invokePublish(state, built);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reconcile_state=blocked_conflict/u);
  assert.equal(git(state.target, ["rev-parse", "refs/heads/master"]), state.initialTarget);
  assert.equal(git(state.target, ["rev-parse", "refs/tags/v2.0.0^{}"]), releaseCommit);
  assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2"]));
});

test("future two-digit majors receive their own floating alias", (t) => {
  const state = fixture(t, "10.0.0");
  const built = buildAssembledCandidate(state);
  publishCandidate(state, built);
  const releaseCommit = git(state.target, ["rev-parse", "refs/tags/v10.0.0^{}"]);
  assert.equal(git(state.target, ["rev-parse", "refs/tags/v10^{}"]), releaseCommit);
  assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v1"]));
});

test("huge SemVer majors never overflow or round the floating alias", (t) => {
  const version = "9007199254740993.0.0";
  const exactAlias = "v9007199254740993";
  const state = fixture(t, version);
  const built = buildAssembledCandidate(state, { label: "huge-major" });
  publishCandidate(state, built);
  const releaseCommit = git(state.target, ["rev-parse", `refs/tags/v${version}^{}`]);
  assert.equal(git(state.target, ["rev-parse", `refs/tags/${exactAlias}^{}`]), releaseCommit);
  assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v9007199254740992"]));
});

test("exact-source rematerialization can recover an old alias after source master advances", (t) => {
  const state = fixture(t);
  const oldSource = state.sourceCommit;
  const first = buildAssembledCandidate(state, { label: "first" });
  publishCandidate(state, first);
  const oldRelease = git(state.target, ["rev-parse", "refs/tags/v2.0.0^{}"]);
  const firstArchive = readFileSync(join(first.assembled, "codex-review-gate-action-v2.0.0.tar.gz"));
  git(state.target, ["update-ref", "-d", "refs/tags/v2"]);

  advanceIntent(state, "2.1.0", oldRelease, "2.0.0");
  const currentControl = state.sourceCommit;
  const recovered = buildAssembledCandidate(state, {
    sourceCommit: oldSource,
    controlCommit: currentControl,
    label: "recovered",
  });
  assert.deepEqual(
    readFileSync(join(recovered.assembled, "codex-review-gate-action-v2.0.0.tar.gz")),
    firstArchive,
  );
  const publicationPlan = JSON.parse(readFileSync(recovered.publicationPlan, "utf8"));
  assert.equal(publicationPlan.source_commit, oldSource);
  assert.equal(publicationPlan.control_commit, currentControl);
  assert.equal(publicationPlan.live_source_master, state.sourceCommit);
  assert.equal(publicationPlan.write_eligible, false);

  const output = publishCandidate(state, recovered);
  assert.match(output, /reconcile_state=resumable_partial/u);
  assert.equal(git(state.target, ["rev-parse", "refs/tags/v2^{}"]), oldRelease);
  assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2.1.0"]));
});

test("exact-source recovery reads the frozen manifest when current control has no root manifest", (t) => {
  const state = fixture(t);
  const oldSource = state.sourceCommit;
  const first = buildAssembledCandidate(state, { label: "manifestless-control-first" });
  publishCandidate(state, first);
  const releaseCommit = git(state.target, ["rev-parse", "refs/tags/v2.0.0^{}"]);
  git(state.target, ["update-ref", "-d", "refs/tags/v2"]);

  rmSync(join(state.source, "release-manifest.json"));
  const currentControl = commit(state.source, "Remove completed release intent manifest");
  assert.equal(existsSync(join(state.source, "release-manifest.json")), false);
  const recovered = buildAssembledCandidate(state, {
    sourceCommit: oldSource,
    controlCommit: currentControl,
    label: "manifestless-control-recovered",
  });
  const plan = JSON.parse(readFileSync(recovered.publicationPlan, "utf8"));
  assert.equal(plan.source_commit, oldSource);
  assert.equal(plan.control_commit, currentControl);
  assert.equal(plan.live_source_master, currentControl);
  assert.equal(plan.write_eligible, false);

  const output = publishCandidate(state, recovered);
  assert.match(output, /reconcile_state=resumable_partial/u);
  assert.equal(git(state.target, ["rev-parse", "refs/tags/v2^{}"]), releaseCommit);
});

test("exact-source recovery fails closed when publisher controls drift", (t) => {
  const state = fixture(t);
  const oldSource = state.sourceCommit;
  const first = buildAssembledCandidate(state, { label: "control-drift-first" });
  publishCandidate(state, first);
  const releaseCommit = git(state.target, ["rev-parse", "refs/tags/v2.0.0^{}"]);
  git(state.target, ["update-ref", "-d", "refs/tags/v2"]);
  const targetRefsBefore = git(state.target, ["show-ref"]);
  const releaseBytesBefore = Object.fromEntries(releaseAssets(state, "v2.0.0").map((name) => [
    name,
    sha256(readFileSync(join(state.releases, "v2.0.0", name))),
  ]));

  write(join(state.source, "README.md"), "Source advanced without changing release controls.\n");
  const approvedControl = commit(state.source, "Advance source without changing release controls");
  const recovered = buildAssembledCandidate(state, {
    sourceCommit: oldSource,
    controlCommit: approvedControl,
    label: "control-drift-recovered",
  });
  assert.deepEqual(
    readFileSync(join(recovered.assembled, "codex-review-gate-action-v2.0.0.tar.gz")),
    readFileSync(join(first.assembled, "codex-review-gate-action-v2.0.0.tar.gz")),
  );
  const plan = JSON.parse(readFileSync(recovered.publicationPlan, "utf8"));
  assert.equal(plan.source_commit, oldSource);
  assert.equal(plan.control_commit, approvedControl);
  assert.equal(plan.live_source_master, approvedControl);

  write(join(state.source, ".github", "workflows", "required-ci.yml"), "name: Drifted release control\n");
  const driftedControl = writeReleaseIntent(state.source, "2.1.0", releaseCommit, "2.0.0");
  assert.equal(git(state.source, ["ls-remote", state.source, "refs/heads/master"]).split("\t")[0], driftedControl);

  const result = invokePublish(state, recovered);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /publisher-control-drift|publication-input-preflight/u);
  assert.equal(git(state.target, ["show-ref"]), targetRefsBefore);
  assert.deepEqual(Object.fromEntries(releaseAssets(state, "v2.0.0").map((name) => [
    name,
    sha256(readFileSync(join(state.releases, "v2.0.0", name))),
  ])), releaseBytesBefore);
  assert.equal(git(state.target, ["rev-parse", "refs/heads/master"]), releaseCommit);
  assert.equal(git(state.target, ["rev-parse", "refs/tags/v2.0.0^{}"]), releaseCommit);
  assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2"]));
});

test("prereleases publish only the full immutable tag", (t) => {
  const state = fixture(t, "2.0.0-rc.1");
  const built = buildAssembledCandidate(state);
  const output = publishCandidate(state, built);
  assert.match(output, /reconcile_state=fresh/u);
  assert.equal(git(state.target, ["cat-file", "-t", "refs/tags/v2.0.0-rc.1"]), "tag");
  assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2"]));
  assert.equal(readFileSync(join(state.releases, "v2.0.0-rc.1", "prerelease"), "utf8"), "true\n");
});
