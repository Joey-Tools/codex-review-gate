import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  discoverV2RuntimeModulePaths,
  parseVerifiedOpenPgpStatus,
  writeManifest,
} from "../scripts/generate-action-release-provenance.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatorPath = join(
  repositoryRoot,
  "scripts",
  "generate-action-release-provenance.mjs",
);
const productionBaselinePath = join(
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
  "src/v2/controller-input-reader.mjs",
  "src/v2/effect-status-wal.mjs",
  "src/v2/git-ledger.mjs",
  "src/v2/persistent-frontier.mjs",
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
]);
const FIXTURE_EVIDENCE_AUTHORITY_POLICY = Object.freeze({
  schema: "github-codex-evidence-authority-v2",
  schema_version: 2,
  scope: "release-fixture",
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

function initialiseRepository(path) {
  mkdirSync(path, { recursive: true });
  git(path, ["init", "-q", "--initial-branch=master"]);
  git(path, ["config", "user.name", "Release Fixture"]);
  git(path, ["config", "user.email", "release-fixture@example.invalid"]);
  git(path, ["config", "commit.gpgSign", "false"]);
  git(path, ["config", "tag.gpgSign", "false"]);
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

function writeRefSnapshot(path, refs) {
  const lines = Object.entries(refs)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([ref, oid]) => `${oid}\t${ref}`);
  writeText(path, `${lines.join("\n")}\n`);
}

function copyCommitTree(sourceRepo, commit, destination) {
  const paths = git(sourceRepo, ["ls-tree", "-r", "-z", "--name-only", commit], {
    encoding: null,
  })
    .subarray(0, -1)
    .toString("utf8")
    .split("\0");
  for (const path of paths) {
    writeText(join(destination, path), git(sourceRepo, ["show", `${commit}:${path}`]));
  }
}

function writeV2ActionTree(
  repo,
  {
    actionPackageIdentity = ACTION_PACKAGE_IDENTITY,
    extraRuntimeModulePaths = [],
    omitEvidenceAuthorityPolicy = false,
  } = {},
) {
  writeText(
    join(repo, "action.yml"),
    `name: Codex Review Gate v2 Plan Adapter
runs:
  using: composite
  steps:
    - shell: bash
      run: node "$GITHUB_ACTION_PATH/src/v2/action.mjs"
`,
  );
  writeText(
    join(repo, ".github", "workflows", "codex-review-gate.yml"),
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
    join(repo, ".github", "workflows", "codex-review-gate-reconcile.yml"),
    `name: Codex Review Gate v2 Reconcile
on:
  workflow_dispatch:
jobs:
  reconcile:
    uses: ./.github/workflows/codex-review-gate.yml
`,
  );
  writeJson(join(repo, "package.json"), {
    ...actionPackageIdentity,
    type: "module",
  });
  const runtimeModulePaths = [
    ...EXPECTED_V2_RUNTIME_MODULE_PATHS,
    ...extraRuntimeModulePaths,
  ].sort(compareUtf8Paths);
  for (const path of runtimeModulePaths) {
    writeText(
      join(repo, path),
      `export const name = ${JSON.stringify(path)};\n`,
    );
  }
  if (!omitEvidenceAuthorityPolicy) {
    writeJson(
      join(repo, EVIDENCE_AUTHORITY_POLICY_PATH),
      FIXTURE_EVIDENCE_AUTHORITY_POLICY,
    );
  }
  // Retained files are history/runtime implementation details, not public v1 selectors.
  writeText(join(repo, "src", "core.mjs"), "export const legacyCore = true;\n");
  writeText(join(repo, "src", "gate.mjs"), "export const legacyGate = true;\n");
}

function createGeneratorFixture(t, actionTreeOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), "release-provenance-v2-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const actionRepo = join(root, "action");
  const sourceRepo = join(root, "source");
  initialiseRepository(actionRepo);

  const firstRootCommits = [];
  for (let index = 1; index <= 14; index += 1) {
    writeText(join(actionRepo, "history.txt"), `${index}\n`);
    firstRootCommits.push(commitAll(actionRepo, `action history ${index}`));
  }
  const baselineMaster = firstRootCommits.at(-1);
  const preSubtree = firstRootCommits[7];

  git(actionRepo, ["switch", "-q", "--orphan", "archive"]);
  let archiveHead;
  for (let index = 1; index <= 7; index += 1) {
    writeText(join(actionRepo, "archive.txt"), `${index}\n`);
    archiveHead = commitAll(actionRepo, `archive history ${index}`);
  }
  git(actionRepo, ["switch", "-q", "master"]);
  writeV2ActionTree(actionRepo, actionTreeOptions);
  const actionCommit = commitAll(actionRepo, "release v2.0.0");
  for (const tag of ["v2.0.0", "v2.0", "v2"]) {
    git(actionRepo, ["tag", "-a", tag, actionCommit, "-m", `fixture ${tag}`]);
  }

  initialiseRepository(sourceRepo);
  copyCommitTree(actionRepo, actionCommit, join(sourceRepo, "packages", "action"));
  writeJson(join(sourceRepo, "package.json"), {
    ...SOURCE_PACKAGE_IDENTITY,
    private: true,
    type: "module",
  });
  writeText(join(sourceRepo, "README.md"), "source fixture\n");
  for (const path of SOURCE_ONLY_REQUIRED_CI_PATHS) {
    writeText(join(sourceRepo, path), "name: Source-only required CI fixture\n");
  }
  const sourceCommit = commitAll(sourceRepo, "source release");

  const frozenRefs = {
    "refs/heads/master": baselineMaster,
  };
  const targetBaselineRefs = sortedObject({
    "refs/heads/archive/pre-subtree-release-candidate-2026-05-16": archiveHead,
    "refs/heads/master": baselineMaster,
    "refs/heads/pre-subtree-master-2026-05-18": preSubtree,
  });
  const targetRefs = sortedObject({
    ...targetBaselineRefs,
    "refs/heads/master": actionCommit,
    "refs/tags/v2": gitText(actionRepo, ["rev-parse", "refs/tags/v2"]),
    "refs/tags/v2.0": gitText(actionRepo, ["rev-parse", "refs/tags/v2.0"]),
    "refs/tags/v2.0.0": gitText(actionRepo, ["rev-parse", "refs/tags/v2.0.0"]),
  });
  const baselinePath = join(root, "baseline.json");
  const targetPath = join(root, "target.tsv");
  const frozenPath = join(root, "frozen.tsv");
  writeJson(baselinePath, {
    $schema: "urn:joey-tools:codex-review-gate:action-v2-repository-baselines:1",
    schema_version: 1,
    frozen_repository: {
      repository: "JoeyTeng/codex-review-gate-action",
      url: "file:///fixture/frozen.git",
      default_branch: "master",
      default_commit_oid: baselineMaster,
      default_tree_oid: gitText(actionRepo, ["rev-parse", `${baselineMaster}^{tree}`]),
      refs: sortedObject(frozenRefs),
    },
    target_repository: {
      repository: "Joey-Tools/codex-review-gate-action",
      url: "file:///fixture/target.git",
      default_branch: "master",
      default_commit_oid: baselineMaster,
      default_tree_oid: gitText(actionRepo, ["rev-parse", `${baselineMaster}^{tree}`]),
      head_commit_count: 21,
      head_root_count: 2,
      refs: targetBaselineRefs,
    },
    release: {
      version: "2.0.0",
      immutable_tag: "v2.0.0",
      aliases: ["v2.0", "v2"],
    },
  });
  writeRefSnapshot(targetPath, targetRefs);
  writeRefSnapshot(frozenPath, frozenRefs);
  return {
    root,
    actionRepo,
    sourceRepo,
    sourceCommit,
    actionCommit,
    baselinePath,
    targetPath,
    frozenPath,
    targetRefs,
  };
}

function runGenerator(fixture, output, overrides = {}) {
  const args = [
    generatorPath,
    "--source-repo",
    fixture.sourceRepo,
    "--source-ref",
    overrides.sourceRef ?? fixture.sourceCommit,
    "--action-repo",
    fixture.actionRepo,
    "--action-ref",
    fixture.actionCommit,
    "--target-refs",
    overrides.targetPath ?? fixture.targetPath,
    "--frozen-refs",
    fixture.frozenPath,
    "--baseline",
    fixture.baselinePath,
    "--output",
    output,
    "--test-only-skip-signatures",
  ];
  return spawnSync(process.execPath, args, {
    encoding: "utf8",
    env: { ...testEnvironment, ...overrides.env },
    maxBuffer: 64 * 1024 * 1024,
  });
}

test("release contract locks every live v2 runtime module in byte order", () => {
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

test("runtime module discovery fails closed on structural ambiguity", async (t) => {
  const regularEntries = EXPECTED_V2_RUNTIME_MODULE_PATHS.map((path) => ({
    path,
    mode: "100644",
    type: "blob",
  }));
  assert.deepEqual(
    discoverV2RuntimeModulePaths({ entries: [...regularEntries].reverse() }),
    EXPECTED_V2_RUNTIME_MODULE_PATHS,
  );

  await t.test("missing required entry", () => {
    assert.throws(
      () => discoverV2RuntimeModulePaths({
        entries: regularEntries.filter(({ path }) => path !== "src/v2/action.mjs"),
      }),
      /missing required v2 identity src\/v2\/action\.mjs/u,
    );
  });

  await t.test("symlinked module", () => {
    assert.throws(
      () => discoverV2RuntimeModulePaths({
        entries: regularEntries.map((entry) => entry.path === "src/v2/reducer.mjs"
          ? { ...entry, mode: "120000" }
          : entry),
      }),
      /must be a regular non-symlink Git blob/u,
    );
  });

  await t.test("duplicate path", () => {
    assert.throws(
      () => discoverV2RuntimeModulePaths({
        entries: [...regularEntries, { ...regularEntries[0] }],
      }),
      /duplicate path/u,
    );
  });

  await t.test("noncanonical module path", () => {
    assert.throws(
      () => discoverV2RuntimeModulePaths({
        entries: [
          ...regularEntries,
          { path: "src/v2/Not_Canonical.mjs", mode: "100644", type: "blob" },
        ],
      }),
      /noncanonical path/u,
    );
  });
});

test("production baseline freezes every old personal ref and the transferred target", () => {
  const baselineBytes = readFileSync(productionBaselinePath);
  assert.equal(
    createHash("sha256").update(baselineBytes).digest("hex"),
    "63dc08cdf35720a5659ec6e2557ac4a3f49c26be331f4b62d1cb3e402336df6a",
  );
  const baseline = JSON.parse(baselineBytes);
  assert.equal(baseline.frozen_repository.repository, "JoeyTeng/codex-review-gate-action");
  assert.equal(Object.keys(baseline.frozen_repository.refs).length, 27);
  assert.equal(
    baseline.frozen_repository.refs["refs/heads/master"],
    "59eeda2af2a7baab3f3f15a59fbbaee015fa6c01",
  );
  assert.equal(
    baseline.frozen_repository.default_tree_oid,
    "8d909dd441b28b6915c46f60e8a144e64fd5268b",
  );
  assert.equal(
    baseline.frozen_repository.refs["refs/tags/v1.5.1"],
    "f9201d016b0abd21403550c3bf8030eb0beb76b4",
  );
  assert.deepEqual(Object.keys(baseline.target_repository.refs), [
    "refs/heads/archive/pre-subtree-release-candidate-2026-05-16",
    "refs/heads/master",
    "refs/heads/pre-subtree-master-2026-05-18",
  ]);
  assert.equal(baseline.target_repository.head_commit_count, 21);
  assert.equal(baseline.target_repository.head_root_count, 2);
  assert.deepEqual(baseline.release, {
    version: "2.0.0",
    immutable_tag: "v2.0.0",
    aliases: ["v2.0", "v2"],
  });
});

test("GnuPG status parser binds signing and primary fingerprints", () => {
  const signing = "0123456789ABCDEF0123456789ABCDEF01234567";
  const primary = "89ABCDEF0123456789ABCDEF0123456789ABCDEF";
  const result = {
    stdout: Buffer.from(""),
    stderr: Buffer.from(
      `[GNUPG:] GOODSIG ${signing.slice(-16)} Release Fixture\n` +
        `[GNUPG:] VALIDSIG ${signing} 2026-08-13 1786579200 0 4 0 1 10 00 ${primary}\n`,
    ),
  };
  assert.deepEqual(parseVerifiedOpenPgpStatus(result, "v2.0.0"), {
    signingKeyFingerprint: signing.toLowerCase(),
    primaryKeyFingerprint: primary.toLowerCase(),
  });
  assert.deepEqual(
    parseVerifiedOpenPgpStatus(
      {
        stdout: Buffer.alloc(0),
        stderr: Buffer.from(
          `[GNUPG:] GOODSIG ${primary.slice(-16)} Release Fixture\n` +
            `[GNUPG:] VALIDSIG ${primary} 2026-08-13 1786579200 0 4 0 1 10 00\n`,
        ),
      },
      "v2-primary-key",
    ),
    {
      signingKeyFingerprint: primary.toLowerCase(),
      primaryKeyFingerprint: primary.toLowerCase(),
    },
  );
  assert.throws(
    () =>
      parseVerifiedOpenPgpStatus(
        {
          stdout: Buffer.from(""),
          stderr: Buffer.from(`[GNUPG:] BADSIG ${signing.slice(-16)} bad\n`),
        },
        "v2.0.0",
      ),
    /rejecting GnuPG signature status/,
  );
  for (const invalidLength of [41, 63]) {
    const invalidFingerprint = "3".repeat(invalidLength);
    assert.throws(
      () =>
        parseVerifiedOpenPgpStatus(
          {
            stdout: Buffer.from(""),
            stderr: Buffer.from(
              "[GNUPG:] GOODSIG 3333333333333333 Invalid Length\n" +
                `[GNUPG:] VALIDSIG ${invalidFingerprint} 2026-08-13 0 0 0 0 0 0 00 ${primary}\n`,
            ),
          },
          "v2.0.0",
        ),
      /inconsistent GOODSIG\/VALIDSIG identity/,
    );
  }
});

test("generator emits complete v2-only split, tag, tree, and frozen-ref provenance", (t) => {
  const fixture = createGeneratorFixture(t);
  const output = join(fixture.root, "provenance.json");
  const result = runGenerator(fixture, output);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(readFileSync(output, "utf8"));
  assert.equal(
    manifest.$schema,
    "urn:joey-tools:codex-review-gate:action-release-provenance:3",
  );
  assert.equal(manifest.source.commit_oid, fixture.sourceCommit);
  const sourcePackageBytes = readFileSync(
    join(fixture.sourceRepo, "package.json"),
  );
  const sourcePackageOid = gitText(fixture.sourceRepo, [
    "rev-parse",
    `${fixture.sourceCommit}:package.json`,
  ]);
  assert.deepEqual(manifest.source.package_identity, {
    role: "v2-source-package",
    path: "package.json",
    object_oid: sourcePackageOid,
    sha256: createHash("sha256").update(sourcePackageBytes).digest("hex"),
    name: SOURCE_PACKAGE_IDENTITY.name,
    version: SOURCE_PACKAGE_IDENTITY.version,
    repository_url: SOURCE_PACKAGE_IDENTITY.repository.url,
  });
  assert.equal(manifest.action.commit_oid, fixture.actionCommit);
  assert.equal(manifest.action.source_subtree_tree_equal, true);
  assert.deepEqual(manifest.release.selector_policy.admitted, ["v2.0.0", "v2.0", "v2"]);
  assert.equal(manifest.release.selector_policy.v1_refs_admitted, false);
  assert.equal(manifest.remote_state.target.no_v1_refs, true);
  assert.equal(manifest.remote_state.frozen_personal.all_refs_equal_recorded_baseline, true);
  assert.equal(manifest.history.transferred_initial_heads.commit_count, 21);
  assert.equal(manifest.history.transferred_initial_heads.root_count, 2);
  assert.equal(manifest.history.transferred_master_is_ancestor, true);
  assert.ok(manifest.history.release_split.commit_count >= 15);
  assert.ok(manifest.released_tree.entry_count >= 14);
  assert.equal(manifest.runtime_identity.public_entry.path, "action.yml");
  assert.equal(manifest.runtime_identity.reusable_workflow.path, ".github/workflows/codex-review-gate.yml");
  assert.equal(
    manifest.runtime_identity.reconciliation_workflow.path,
    ".github/workflows/codex-review-gate-reconcile.yml",
  );
  assert.equal(manifest.runtime_identity.controller.path, "src/v2/workflow-controller.mjs");
  assert.equal(manifest.runtime_identity.plan_adapter.path, "src/v2/action.mjs");
  assert.deepEqual(
    manifest.runtime_identity.runtime_modules.map(({ path }) => path),
    EXPECTED_V2_RUNTIME_MODULE_PATHS,
  );
  const policyBytes = readFileSync(
    join(fixture.actionRepo, EVIDENCE_AUTHORITY_POLICY_PATH),
  );
  const policySha256 = createHash("sha256").update(policyBytes).digest("hex");
  const policyTreeEntry = manifest.released_tree.entries.find(
    ({ path }) => path === EVIDENCE_AUTHORITY_POLICY_PATH,
  );
  assert.ok(policyTreeEntry);
  assert.deepEqual(manifest.runtime_identity.evidence_authority_policy, {
    role: "v2-evidence-authority-policy",
    path: EVIDENCE_AUTHORITY_POLICY_PATH,
    object_oid: policyTreeEntry.object_oid,
    sha256: policySha256,
    policy_digest: `sha256:${policySha256}`,
  });
  const actionPackageBytes = readFileSync(
    join(fixture.actionRepo, "package.json"),
  );
  const actionPackageTreeEntry = manifest.released_tree.entries.find(
    ({ path }) => path === "package.json",
  );
  assert.ok(actionPackageTreeEntry);
  assert.deepEqual(manifest.runtime_identity.package, {
    role: "v2-action-package",
    path: "package.json",
    object_oid: actionPackageTreeEntry.object_oid,
    sha256: createHash("sha256").update(actionPackageBytes).digest("hex"),
    name: ACTION_PACKAGE_IDENTITY.name,
    version: ACTION_PACKAGE_IDENTITY.version,
    repository_url: ACTION_PACKAGE_IDENTITY.repository.url,
  });
  const releasedPaths = new Set(
    manifest.released_tree.entries.map(({ path }) => path),
  );
  for (const path of SOURCE_ONLY_REQUIRED_CI_PATHS) {
    assert.equal(existsSync(join(fixture.sourceRepo, path)), true);
    assert.equal(releasedPaths.has(path), false);
  }
  assert.doesNotMatch(
    JSON.stringify(manifest.runtime_identity),
    /required-ci/u,
  );
  assert.equal(manifest.runtime_identity.legacy_files_policy.selector_compatibility_granted, false);
  for (const tag of ["v2.0.0", "v2.0", "v2"]) {
    assert.equal(manifest.tags[tag].direct, true);
    assert.equal(manifest.tags[tag].peeled_commit_oid, fixture.actionCommit);
    assert.equal(manifest.tags[tag].signature.method, "closed-test-only-skip");
  }
});

test("a newly added canonical v2 module cannot escape runtime identity", (t) => {
  const futureModulePath = "src/v2/zz-future-module.mjs";
  const fixture = createGeneratorFixture(t, {
    extraRuntimeModulePaths: [futureModulePath],
  });
  const output = join(fixture.root, "future-module-provenance.json");
  const result = runGenerator(fixture, output);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(readFileSync(output, "utf8"));
  assert.deepEqual(
    manifest.runtime_identity.runtime_modules.map(({ path }) => path),
    [...EXPECTED_V2_RUNTIME_MODULE_PATHS, futureModulePath].sort(compareUtf8Paths),
  );
});

test("generator rejects a missing evidence authority policy without publishing", (t) => {
  const fixture = createGeneratorFixture(t, {
    omitEvidenceAuthorityPolicy: true,
  });
  const output = join(fixture.root, "missing-policy-provenance.json");
  const result = runGenerator(fixture, output);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /missing required v2 identity github-codex-evidence-authority-v2\.json/u,
  );
  assert.equal(existsSync(output), false);
});

test("generator rejects stale source and action package identities", async (t) => {
  await t.test("source package", () => {
    const fixture = createGeneratorFixture(t);
    writeJson(join(fixture.sourceRepo, "package.json"), {
      ...SOURCE_PACKAGE_IDENTITY,
      version: "1.5.1",
      private: true,
      type: "module",
    });
    const staleSourceCommit = commitAll(fixture.sourceRepo, "stale source package");
    const output = join(fixture.root, "stale-source-package.json");
    const result = runGenerator(fixture, output, {
      sourceRef: staleSourceCommit,
    });
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /source package\.json must identify codex-review-gate-source@2\.0\.0/u,
    );
    assert.equal(existsSync(output), false);
  });

  await t.test("action package", () => {
    const fixture = createGeneratorFixture(t, {
      actionPackageIdentity: {
        ...ACTION_PACKAGE_IDENTITY,
        repository: {
          type: "git",
          url: "git+https://github.com/JoeyTeng/codex-review-gate-action.git",
        },
      },
    });
    const output = join(fixture.root, "stale-action-package.json");
    const result = runGenerator(fixture, output);
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /released package\.json must identify codex-review-gate-action@2\.0\.0/u,
    );
    assert.equal(existsSync(output), false);
  });
});

test("generator ignores ambient Git repository and config injection", (t) => {
  const fixture = createGeneratorFixture(t);
  const rogueRepository = join(fixture.root, "rogue");
  initialiseRepository(rogueRepository);
  writeText(join(rogueRepository, "rogue.txt"), "not the release repository\n");
  commitAll(rogueRepository, "rogue");
  const output = join(fixture.root, "ambient-git.json");
  const result = runGenerator(fixture, output, {
    env: {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.repositoryformatversion",
      GIT_CONFIG_VALUE_0: "99",
      GIT_DIR: join(rogueRepository, ".git"),
      GIT_WORK_TREE: rogueRepository,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(readFileSync(output, "utf8"));
  assert.equal(manifest.source.commit_oid, fixture.sourceCommit);
  assert.equal(manifest.action.commit_oid, fixture.actionCommit);
});

test("generator rejects any target v1 ref without publishing a manifest", (t) => {
  const fixture = createGeneratorFixture(t);
  const mutatedTarget = join(fixture.root, "target-v1.tsv");
  writeRefSnapshot(mutatedTarget, {
    ...fixture.targetRefs,
    "refs/tags/v1": fixture.actionCommit,
  });
  const output = join(fixture.root, "rejected.json");
  const result = runGenerator(fixture, output, { targetPath: mutatedTarget });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /differs from the frozen contract|v1 ref is forbidden/);
  assert.equal(existsSync(output), false);
});

test("generator rejects source/action tree mismatch without publishing", (t) => {
  const fixture = createGeneratorFixture(t);
  writeText(join(fixture.sourceRepo, "packages", "action", "extra.txt"), "changed\n");
  const changedSource = commitAll(fixture.sourceRepo, "mutate source tree");
  const output = join(fixture.root, "tree-mismatch.json");
  const result = runGenerator(fixture, output, { sourceRef: changedSource });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source packages\/action tree differs/);
  assert.equal(existsSync(output), false);
});

test("production generation cannot activate the signature bypass", (t) => {
  const fixture = createGeneratorFixture(t);
  const output = join(fixture.root, "production-bypass.json");
  const result = spawnSync(
    process.execPath,
    [
      generatorPath,
      "--source-repo",
      fixture.sourceRepo,
      "--source-ref",
      fixture.sourceCommit,
      "--action-repo",
      fixture.actionRepo,
      "--action-ref",
      fixture.actionCommit,
      "--target-refs",
      fixture.targetPath,
      "--frozen-refs",
      fixture.frozenPath,
      "--baseline",
      fixture.baselinePath,
      "--output",
      output,
      "--test-only-skip-signatures",
    ],
    {
      encoding: "utf8",
      env: { ...testEnvironment, CODEX_REVIEW_GATE_RELEASE_PROVENANCE_TEST_ONLY: "0" },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /closed test environment/);
  assert.equal(existsSync(output), false);
});

test("production rejects a rewritten repository freeze baseline", (t) => {
  const fixture = createGeneratorFixture(t);
  const baseline = JSON.parse(readFileSync(fixture.baselinePath, "utf8"));
  baseline.frozen_repository.refs["refs/heads/master"] = "f".repeat(40);
  writeJson(fixture.baselinePath, baseline);
  const output = join(fixture.root, "rewritten-baseline.json");
  const result = spawnSync(
    process.execPath,
    [
      generatorPath,
      "--source-repo",
      fixture.sourceRepo,
      "--source-ref",
      fixture.sourceCommit,
      "--action-repo",
      fixture.actionRepo,
      "--action-ref",
      fixture.actionCommit,
      "--target-refs",
      fixture.targetPath,
      "--frozen-refs",
      fixture.frozenPath,
      "--baseline",
      fixture.baselinePath,
      "--expected-signing-fingerprint",
      "A".repeat(40),
      "--output",
      output,
    ],
    {
      encoding: "utf8",
      env: {
        ...testEnvironment,
        CODEX_REVIEW_GATE_RELEASE_PROVENANCE_TEST_ONLY: "0",
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source release contract|permanent production freeze/);
  assert.equal(existsSync(output), false);
});

test("production generation rejects unsigned annotated tags", (t) => {
  const fixture = createGeneratorFixture(t);
  const output = join(fixture.root, "unsigned.json");
  const result = spawnSync(
    process.execPath,
    [
      generatorPath,
      "--source-repo",
      fixture.sourceRepo,
      "--source-ref",
      fixture.sourceCommit,
      "--action-repo",
      fixture.actionRepo,
      "--action-ref",
      fixture.actionCommit,
      "--target-refs",
      fixture.targetPath,
      "--frozen-refs",
      fixture.frozenPath,
      "--baseline",
      fixture.baselinePath,
      "--expected-signing-fingerprint",
      "A".repeat(40),
      "--output",
      output,
    ],
    { encoding: "utf8", env: testEnvironment },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /OpenPGP signature verification failed/);
  assert.equal(existsSync(output), false);
});

test("production signature verification ignores a malicious repo-local GPG program", (t) => {
  const fixture = createGeneratorFixture(t);
  const marker = join(fixture.root, "fake-gpg-ran");
  const fakeGpg = join(fixture.root, "fake-gpg");
  writeText(
    fakeGpg,
    `#!/bin/sh
printf 'ran\n' > ${JSON.stringify(marker)}
printf '%s\n' '[GNUPG:] GOODSIG 0123456789ABCDEF Fake Signer'
printf '%s\n' '[GNUPG:] VALIDSIG 0000000000000000000000000123456789ABCDEF 2026-08-13 0 0 0 0 0 0 00 0000000000000000000000000123456789ABCDEF'
exit 0
`,
    0o755,
  );
  git(fixture.actionRepo, ["config", "gpg.program", fakeGpg]);
  git(fixture.actionRepo, ["config", "gpg.openpgp.program", fakeGpg]);
  const output = join(fixture.root, "malicious-gpg.json");
  const result = spawnSync(
    process.execPath,
    [
      generatorPath,
      "--source-repo",
      fixture.sourceRepo,
      "--source-ref",
      fixture.sourceCommit,
      "--action-repo",
      fixture.actionRepo,
      "--action-ref",
      fixture.actionCommit,
      "--target-refs",
      fixture.targetPath,
      "--frozen-refs",
      fixture.frozenPath,
      "--baseline",
      fixture.baselinePath,
      "--expected-signing-fingerprint",
      "A".repeat(40),
      "--output",
      output,
    ],
    { encoding: "utf8", env: testEnvironment },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /OpenPGP signature verification failed/);
  assert.equal(existsSync(marker), false);
  assert.equal(existsSync(output), false);
});

test("final pre-publication audit failure publishes no manifest", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "manifest-pre-publish-race-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, "manifest.json");
  const phases = [];
  await assert.rejects(
    writeManifest(output, { release: "2.0.0" }, {
      beforePublish: async () => phases.push("before"),
      afterStagingValidation: async () => phases.push("staged"),
      finalPrePublish: async () => {
        phases.push("final");
        throw new Error("simulated final ref drift");
      },
    }),
    /simulated final ref drift/,
  );
  assert.deepEqual(phases, ["before", "staged", "final"]);
  assert.equal(existsSync(output), false);
});

test("writeManifest publishes a private create-only file with a stable digest", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "manifest-publication-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, "manifest.json");
  const manifest = { release: "2.0.0", commit: "a".repeat(40) };
  const result = await writeManifest(output, manifest);
  const bytes = readFileSync(output);
  assert.equal(result.absoluteOutput, output);
  assert.equal(result.digest, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(lstatSync(output).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(bytes), manifest);
});

test("writeManifest never overwrites an existing output", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "manifest-existing-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, "manifest.json");
  writeText(output, "keep me\n");
  await assert.rejects(
    writeManifest(output, { release: "2.0.0" }),
    /output already exists; refusing to replace/,
  );
  assert.equal(readFileSync(output, "utf8"), "keep me\n");
});

test("writeManifest preserves a concurrent winner at the create-only boundary", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "manifest-race-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, "manifest.json");
  await assert.rejects(
    writeManifest(output, { release: "2.0.0" }, {
      finalPrePublish: async () => writeFileSync(output, "winner\n"),
    }),
    /output already exists; refusing to replace/,
  );
  assert.equal(readFileSync(output, "utf8"), "winner\n");
});

test("writeManifest revalidates staged content immediately before linking", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "manifest-stage-mutate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, "manifest.json");
  await assert.rejects(
    writeManifest(output, { release: "2.0.0" }, {
      afterStagingValidation: async () => {
        const stagingName = readdirSync(root).find((name) =>
          name.startsWith("manifest.json.tmp-"));
        assert.ok(stagingName);
        const stagingPath = join(root, stagingName, "manifest");
        const intended = readFileSync(stagingPath);
        writeFileSync(stagingPath, Buffer.alloc(intended.length, "x"));
      },
    }),
    /manifest staging object content differs from the intended manifest/,
  );
  assert.equal(existsSync(output), false);
});

test("writeManifest retains a linked output after a post-link audit failure", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "manifest-post-link-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, "manifest.json");
  await assert.rejects(
    writeManifest(output, { release: "2.0.0" }, {
      afterLink: async () => {
        throw new Error("simulated audit failure");
      },
    }),
    /leaving the final output path untouched/,
  );
  assert.equal(JSON.parse(readFileSync(output, "utf8")).release, "2.0.0");
});

test("post-publication failure preserves this invocation's linked output for audit", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "manifest-post-publish-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, "manifest.json");
  const manifest = { release: "2.0.0", audit: true };
  const expected = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  let linkedIdentity;
  await assert.rejects(
    writeManifest(output, manifest, {
      afterPublish: async () => {
        linkedIdentity = lstatSync(output, { bigint: true });
        throw new Error("simulated post-publication ref drift");
      },
    }),
    /leaving the final output path untouched.*use a new output path for retry/,
  );
  const retainedIdentity = lstatSync(output, { bigint: true });
  assert.equal(retainedIdentity.dev, linkedIdentity.dev);
  assert.equal(retainedIdentity.ino, linkedIdentity.ino);
  assert.deepEqual(readFileSync(output), expected);
});

test("post-publication failure never removes a replacement output", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "manifest-post-replace-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, "manifest.json");
  const replacementPath = join(root, "replacement.json");
  const replacement = Buffer.from("replacement audit object\n");
  writeFileSync(replacementPath, replacement, { mode: 0o600 });
  await assert.rejects(
    writeManifest(output, { release: "2.0.0" }, {
      afterPublish: async () => {
        renameSync(replacementPath, output);
        throw new Error("simulated post-publication ref drift");
      },
    }),
    /leaving the final output path untouched.*use a new output path for retry/,
  );
  assert.deepEqual(readFileSync(output), replacement);
});

test("post-link identity validation preserves an early replacement", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "manifest-link-replace-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, "manifest.json");
  const replacementPath = join(root, "replacement.json");
  const replacement = Buffer.from("early replacement\n");
  writeFileSync(replacementPath, replacement, { mode: 0o600 });
  await assert.rejects(
    writeManifest(output, { release: "2.0.0" }, {
      afterLink: async () => renameSync(replacementPath, output),
    }),
    /leaving the final output path untouched.*use a new output path for retry/,
  );
  assert.deepEqual(readFileSync(output), replacement);
});

test("post-link validation rejects a silent same-object content mutation", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "manifest-link-mutate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, "manifest.json");
  const manifest = { release: "2.0.0", mutate: "after-link" };
  const intended = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const changed = Buffer.alloc(intended.length, "x");
  let linkedIdentity;
  await assert.rejects(
    writeManifest(output, manifest, {
      afterLink: async () => {
        linkedIdentity = lstatSync(output, { bigint: true });
        writeFileSync(output, changed);
      },
    }),
    /published manifest content differs from the intended manifest/,
  );
  const retainedIdentity = lstatSync(output, { bigint: true });
  assert.equal(retainedIdentity.dev, linkedIdentity.dev);
  assert.equal(retainedIdentity.ino, linkedIdentity.ino);
  assert.deepEqual(readFileSync(output), changed);
});

test("post-link failure distinguishes a moved final path from retained output", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "manifest-post-move-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, "manifest.json");
  const moved = join(root, "manifest.moved.json");
  const manifest = { release: "2.0.0", moved: true };
  await assert.rejects(
    writeManifest(output, manifest, {
      afterLink: async () => renameSync(output, moved),
    }),
    /leaving the final output path untouched.*use a new output path for retry/,
  );
  assert.equal(existsSync(output), false);
  assert.deepEqual(JSON.parse(readFileSync(moved, "utf8")), manifest);
});

test("post-publication failure never unlinks an in-place changed object", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "manifest-post-mutate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, "manifest.json");
  const manifest = { release: "2.0.0", mutate: true };
  const intended = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const changed = Buffer.alloc(intended.length, "x");
  let linkedIdentity;
  await assert.rejects(
    writeManifest(output, manifest, {
      afterPublish: async () => {
        linkedIdentity = lstatSync(output, { bigint: true });
        writeFileSync(output, changed);
        const changedIdentity = lstatSync(output, { bigint: true });
        assert.equal(changedIdentity.dev, linkedIdentity.dev);
        assert.equal(changedIdentity.ino, linkedIdentity.ino);
        throw new Error("simulated in-place mutation");
      },
    }),
    /leaving the final output path untouched.*use a new output path for retry/,
  );
  const retainedIdentity = lstatSync(output, { bigint: true });
  assert.equal(retainedIdentity.dev, linkedIdentity.dev);
  assert.equal(retainedIdentity.ino, linkedIdentity.ino);
  assert.deepEqual(readFileSync(output), changed);
});

test("final audit revalidation rejects a silent same-object content mutation", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "manifest-final-mutate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, "manifest.json");
  const manifest = { release: "2.0.0", mutate: "after-audit" };
  const intended = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const changed = Buffer.alloc(intended.length, "x");
  let linkedIdentity;
  await assert.rejects(
    writeManifest(output, manifest, {
      afterPublish: async () => {
        linkedIdentity = lstatSync(output, { bigint: true });
        writeFileSync(output, changed);
      },
    }),
    /published manifest after final audit content differs from the intended manifest/,
  );
  const retainedIdentity = lstatSync(output, { bigint: true });
  assert.equal(retainedIdentity.dev, linkedIdentity.dev);
  assert.equal(retainedIdentity.ino, linkedIdentity.ino);
  assert.deepEqual(readFileSync(output), changed);
});

test("same-process concurrent invocations cannot collide on private staging", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "manifest-concurrent-stage-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, "manifest.json");
  let releaseFirst;
  let reportFirstReady;
  const firstReady = new Promise((resolveReady) => {
    reportFirstReady = resolveReady;
  });
  const firstMayPublish = new Promise((resolvePublish) => {
    releaseFirst = resolvePublish;
  });
  const first = assert.rejects(
    writeManifest(output, { invocation: "first" }, {
      finalPrePublish: async () => {
        reportFirstReady();
        await firstMayPublish;
      },
    }),
    /output already exists; refusing to replace/,
  );
  await firstReady;
  const second = { invocation: "second" };
  await writeManifest(output, second);
  releaseFirst();
  await first;
  assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), second);
});

test("post-link staging cleanup failure preserves the primary audit error", async (t) => {
  if (typeof process.getuid !== "function" || process.getuid() === 0) {
    t.skip("permission-based staging cleanup fault requires a non-root POSIX user");
    return;
  }
  const root = mkdtempSync(join(tmpdir(), "manifest-cleanup-failure-"));
  t.after(() => {
    chmodSync(root, 0o700);
    rmSync(root, { recursive: true, force: true });
  });
  const output = join(root, "manifest.json");
  try {
    await assert.rejects(
      writeManifest(output, { release: "2.0.0" }, {
        afterPublish: async () => {
          chmodSync(root, 0o500);
          throw new Error("simulated post-publication ref drift");
        },
      }),
      (error) => {
        assert.ok(error instanceof AggregateError);
        assert.match(error.message, /simulated post-publication ref drift/);
        assert.match(error.message, /staging cleanup also failed/);
        assert.match(error.message, /leaving the final output path untouched/);
        assert.ok(error.errors.length >= 2);
        return true;
      },
    );
  } finally {
    chmodSync(root, 0o700);
  }
  assert.equal(existsSync(output), true);
});
