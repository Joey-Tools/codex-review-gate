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
import nodeTest from "node:test";
import { fileURLToPath } from "node:url";
import { createShardedTest } from "./support/ci-test-shard.mjs";

const test = createShardedTest(
  nodeTest,
  process.env.CODEX_REVIEW_GATE_RELEASE_TEST_SHARD,
  "release pipeline",
);

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = join(repositoryRoot, ".github", "workflows", "sync-action-subtree.yml");
const releaseScript = join(repositoryRoot, "scripts", "release-action-subtree.sh");
const generator = join(repositoryRoot, "scripts", "generate-action-release-provenance.mjs");
const baselinePath = join(repositoryRoot, "docs", "release", "action-v2-repository-baselines.json");
const actionMetadata = readFileSync(join(repositoryRoot, "packages", "action", "action.yml"), "utf8");
const PRIMARY = "AD403DAB5377F9FA0F7D775EC2844D3367B8A71B";
const SUBKEY = "4DD48552DDEAF6D961769DD4A49827EC48984E2C";
const RELEASE_SIGNING_PUBLIC_KEY = `-----BEGIN PGP PUBLIC KEY BLOCK-----

mDMEaowbyBYJKwYBBAHaRw8BAQdAY29ZomqF1Ca0db1zFK6QQSB5UR2wK+mh77cC
6i+Zobu0V0pvZXlUZW5nLUNvZGV4IChGb3IgSm9leS1Ub29scy9jb2RleC1yZXZp
ZXctZ2F0ZS1hY3Rpb24gcmVsZWFzZSBvbmx5KSA8Y29kZXhAbWFoYW5lLm1lPoiT
BBMWCgA7FiEErUA9q1N3+foPfXdewoRNM2e4pxsFAmqMG8gCGwMFCwkIBwICIgIG
FQoJCAsCBBYCAwECHgcCF4AACgkQwoRNM2e4pxtVLAD/UOjJDnO309VsRcwYlbi1
pPP0P+NZkR3HmrLN1bXd3wwA/3vjaTbZtEQGFifJCMbUDDPczkfXWa48wEbzyjif
3j8PtFVKb2V5VGVuZy1Db2RleCAoRm9yIEpvZXlUZW5nL2NvZGV4LXJldmlldy1n
YXRlLWFjdGlvbiByZWxlYXNlIG9ubHkpIDxjb2RleEBtYWhhbmUubWU+iJYEExYK
AD4CGwMFCwkIBwICIgIGFQoJCAsCBBYCAwECHgcCF4AWIQStQD2rU3f5+g99d17C
hE0zZ7inGwUCaow2kwIZAQAKCRDChE0zZ7inGyvAAQDUmwztSXWn+ImXcOWmmjKK
YY7zT3X6nbdLCeFPZO18nwD/ZTVvo5ge7Du/I2U6epsdq7DL0GsBfedO6l4pr8EC
9QG4OARqjBvIEgorBgEEAZdVAQUBAQdAlnj5jeGelfwd8nowsU4u2mN0634NiYdg
fvQVBu4mHHQDAQgHiHgEGBYKACAWIQStQD2rU3f5+g99d17ChE0zZ7inGwUCaowb
yAIbDAAKCRDChE0zZ7inG3R1AQDqu+hYRTHAevMyZ/iooJiYvkLMEk4ceDp7kq8y
oL/X6AEA5QgLb5O1yzywP2LZwr3h4EJ5JGomiqLg1i7pH/OIvwK4MwRqjCK+Fgkr
BgEEAdpHDwEBB0B6uJCtDIMdB8Ts7f2b6ZQ3tGoDJ0BF1DqNL3nbhTm4Z4jvBBgW
CgAgFiEErUA9q1N3+foPfXdewoRNM2e4pxsFAmqMIr4CGwIAgQkQwoRNM2e4pxt2
IAQZFgoAHRYhBE3UhVLd6vbZYXad1KSYJ+xImE4sBQJqjCK+AAoJEKSYJ+xImE4s
0e0A/1XDBldzpvb802mkYdXXzTdwUz8qLDuIYZFvzvLpLwo/AQCIY/AzytqOKItd
CipWc2AK9P8q4CxCSQgoEWLsh3JACfTSAP92wbpsxFL6QR++Z4EI1t0kePBYE2Uz
o9vhFyL26ME6bAEAi0DEqdr3gczrcwfU8JLBtGDNjLoX+yQjvBcZIJ6rgAs=
=sJtz
-----END PGP PUBLIC KEY BLOCK-----`;
const RELEASE_WORKFLOW_REF =
  "Joey-Tools/codex-review-gate/.github/workflows/sync-action-subtree.yml@refs/heads/master";
const SYNTHETIC_TOKEN_FIXTURE = Object.freeze({
  catalog: "joey-private-v3",
  id: "access-a",
  value: "codex_synth_v1_access_a",
});
const FAKE_PUBLISHER_BYPASS = [{
  actor_id: 4700530,
  actor_type: "Integration",
  bypass_mode: "always",
}];
const FAKE_PRODUCTION_RULESETS = [
  {
    id: 1,
    name: "publisher-master-update",
    enforcement: "active",
    target: "branch",
    conditions: { ref_name: { include: ["refs/heads/master"], exclude: [] } },
    bypass_actors: FAKE_PUBLISHER_BYPASS,
    rules: [{ type: "update" }],
  },
  {
    id: 2,
    name: "master-integrity",
    enforcement: "active",
    target: "branch",
    conditions: { ref_name: { include: ["refs/heads/master"], exclude: [] } },
    bypass_actors: [],
    rules: ["deletion", "non_fast_forward", "required_linear_history", "required_signatures"]
      .map((type) => ({ type })),
  },
  {
    id: 3,
    name: "freeze-v1-tags",
    enforcement: "active",
    target: "tag",
    conditions: { ref_name: { include: ["refs/tags/v1", "refs/tags/v1.*"], exclude: [] } },
    bypass_actors: [],
    rules: ["creation", "update", "deletion", "non_fast_forward"].map((type) => ({ type })),
  },
  {
    id: 4,
    name: "publisher-v2-plus-tags",
    enforcement: "active",
    target: "tag",
    conditions: {
      ref_name: {
        include: ["refs/tags/v*"],
        exclude: ["refs/tags/v1", "refs/tags/v1.*"],
      },
    },
    bypass_actors: FAKE_PUBLISHER_BYPASS,
    rules: ["creation", "update", "deletion", "non_fast_forward"].map((type) => ({ type })),
  },
];
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
let verificationInvocationCounter = 0;

function workflowJobBlock(workflow, jobName) {
  const marker = `  ${jobName}:\n`;
  const start = workflow.indexOf(marker, workflow.indexOf("\njobs:\n"));
  assert.notEqual(start, -1, `missing workflow job: ${jobName}`);
  const bodyStart = start + marker.length;
  const nextJobOffset = workflow
    .slice(bodyStart)
    .search(/^  [A-Za-z0-9_-]+:\s*$/mu);
  const end = nextJobOffset === -1 ? workflow.length : bodyStart + nextJobOffset;
  return workflow.slice(start, end);
}

function workflowStepBlock(job, stepName) {
  const marker = `      - name: ${stepName}\n`;
  const start = job.indexOf(marker);
  assert.notEqual(start, -1, `missing workflow step: ${stepName}`);
  const bodyStart = start + marker.length;
  const nextStepOffset = job
    .slice(bodyStart)
    .search(/^      - name: /mu);
  const end = nextStepOffset === -1 ? job.length : bodyStart + nextStepOffset;
  return job.slice(start, end);
}

function workflowRunScript(step) {
  const marker = "        run: |\n";
  const start = step.indexOf(marker);
  assert.notEqual(start, -1, "workflow step must contain a literal run script");
  return step
    .slice(start + marker.length)
    .split("\n")
    .map((line) => line.startsWith("          ") ? line.slice(10) : line)
    .join("\n");
}

function assertPublisherRepositoryScopeGuardFailsClosed(identityStep) {
  assert.doesNotMatch(identityStep, /^\s*continue-on-error:/mu);
  const observedScopeStart = identityStep.indexOf(
    "Publisher App repository scope observed (non-secret)",
  );
  const guardStart = identityStep.indexOf("          if ! jq -e \\", observedScopeStart);
  const guardEndMarker =
    "          printf '%s\\n' \"Publisher App repository scope check passed.\"";
  const guardEndStart = identityStep.indexOf(guardEndMarker, guardStart);
  assert.ok(observedScopeStart >= 0, "repository scope observation must precede the guard");
  assert.ok(guardStart > observedScopeStart, "repository scope guard must remain present");
  assert.ok(guardEndStart > guardStart, "repository scope success boundary must remain present");
  const scopeGuard = identityStep
    .slice(guardStart, guardEndStart + guardEndMarker.length)
    .split("\n")
    .map((line) => line.startsWith("          ") ? line.slice(10) : line)
    .join("\n");

  const root = mkdtempSync(join(tmpdir(), "release-publisher-scope-guard-"));
  try {
    const guardScript = join(root, "scope-guard.sh");
    writeFileSync(guardScript, `#!/usr/bin/env bash
set -euo pipefail
repository_scope_file="$1"
target_scope_marker="$2"
${scopeGuard}
printf '%s\\n' 'target-scoped publisher token entered' > "$target_scope_marker"
`);
    chmodSync(guardScript, 0o755);

    const validScope = {
      total_count: 1,
      returned_count: 1,
      target_shape_matches_expected: true,
      target_id_matches_expected: true,
      target_full_name_matches_expected: true,
    };
    for (const { label, scope, accepted } of [
      { label: "exact target-only installation", scope: validScope, accepted: true },
      {
        label: "more than one installed repository",
        scope: { ...validScope, total_count: 2, returned_count: 2 },
        accepted: false,
      },
      {
        label: "malformed target repository",
        scope: { ...validScope, target_shape_matches_expected: false },
        accepted: false,
      },
      {
        label: "wrong target repository ID",
        scope: { ...validScope, target_id_matches_expected: false },
        accepted: false,
      },
      {
        label: "wrong target repository full_name",
        scope: { ...validScope, target_full_name_matches_expected: false },
        accepted: false,
      },
      {
        label: "unexpected persisted projection field",
        scope: { ...validScope, unexpected: true },
        accepted: false,
      },
    ]) {
      const stem = label.replaceAll(/[^a-z0-9]+/gu, "-");
      const scopeFile = join(root, `${stem}.json`);
      const targetScopeMarker = join(root, `${stem}.target-token-entered`);
      writeFileSync(scopeFile, `${JSON.stringify(scope)}\n`);
      const result = invoke("bash", [guardScript, scopeFile, targetScopeMarker], { cwd: root });
      if (accepted) {
        assert.equal(result.status, 0, `${label}: ${result.stderr}`);
        assert.equal(existsSync(targetScopeMarker), true, label);
        assert.match(result.stdout, /Publisher App repository scope check passed\./u);
      } else {
        assert.notEqual(result.status, 0, label);
        assert.equal(existsSync(targetScopeMarker), false, label);
        assert.match(
          result.stderr,
          /Publisher App repository scope invariant failed; inspect the non-secret observed scope above\./u,
          label,
        );
        assert.doesNotMatch(result.stdout, /target-scoped publisher token entered/u, label);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function assertPublisherBindingAndWriterScopeFailClosed(bindingStep) {
  const bindingScriptBody = workflowRunScript(bindingStep);
  const root = mkdtempSync(join(tmpdir(), "release-publisher-binding-guard-"));
  try {
    const fakeBin = join(root, "bin");
    mkdirSync(fakeBin, { recursive: true });
    const fakeNode = join(fakeBin, "node");
    writeFileSync(fakeNode, `#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == scripts/generate-action-release-provenance.mjs ]]
[[ "$2" == github-app-installation-repository-scope ]]
shift 2
expected_repository_id=
expected_repository=
output=
while (( $# > 0 )); do
  case "$1" in
    --expected-repository-id) expected_repository_id="$2"; shift 2 ;;
    --expected-repository) expected_repository="$2"; shift 2 ;;
    --output) output="$2"; shift 2 ;;
    *) exit 94 ;;
  esac
done
[[ "$expected_repository_id" == 1239944216 ]]
[[ "$expected_repository" == JoeyTeng/codex-review-gate-action ]]
[[ -n "$output" ]]
[[ "\${RELEASE_PUBLISHER_APP_INSTALLATION_TOKEN:-}" == "$EXPECTED_SCOPED_TOKEN" ]]
cp "$FAKE_SCOPE_FIXTURE" "$output"
printf '%s\n' helper-entered > "$FAKE_HELPER_MARKER"
`);
    chmodSync(fakeNode, 0o755);
    const bindingScript = join(root, "binding-step.sh");
    writeFileSync(bindingScript, `#!/usr/bin/env bash
${bindingScriptBody}
[[ -z "\${SCOPED_INSTALLATION_TOKEN:-}" ]]
[[ -z "\${scoped_installation_token:-}" ]]
[[ -z "\${RELEASE_PUBLISHER_APP_INSTALLATION_TOKEN:-}" ]]
printf '%s\\n' 'Git authentication downstream entered' > "$DOWNSTREAM_MARKER"
`);
    chmodSync(bindingScript, 0o755);

    const canonicalSlug = "codex-review-gate-action-publisher";
    const installationId = "12345678";
    const validScope = {
      total_count: 1,
      returned_count: 1,
      target_shape_matches_expected: true,
      target_id_matches_expected: true,
      target_full_name_matches_expected: true,
    };
    for (const {
      label,
      env = {},
      scope = validScope,
      accepted,
      helperEntered,
      failurePattern,
    } of [
      {
        label: "bound writer token with exact target scope",
        accepted: true,
        helperEntered: true,
      },
      {
        label: "configured slug mismatch",
        env: { EXPECTED_APP_SLUG: "replacement-publisher" },
        accepted: false,
        helperEntered: false,
        failurePattern: /configured publisher slug/u,
      },
      {
        label: "inventory slug mismatch",
        env: { INVENTORY_APP_SLUG: "replacement-publisher" },
        accepted: false,
        helperEntered: false,
        failurePattern: /inventory token/u,
      },
      {
        label: "inventory installation ID mismatch",
        env: { INVENTORY_INSTALLATION_ID: "87654321" },
        accepted: false,
        helperEntered: false,
        failurePattern: /installation ID does not match the inventory token/u,
      },
      {
        label: "writer token resolves a replacement repository ID",
        scope: { ...validScope, target_id_matches_expected: false },
        accepted: false,
        helperEntered: true,
        failurePattern: /target-scoped repository scope invariant failed/u,
      },
      {
        label: "writer token resolves a non-canonical full name",
        scope: { ...validScope, target_full_name_matches_expected: false },
        accepted: false,
        helperEntered: true,
        failurePattern: /target-scoped repository scope invariant failed/u,
      },
      {
        label: "writer token is not exact singleton scope",
        scope: { ...validScope, total_count: 2, returned_count: 2 },
        accepted: false,
        helperEntered: true,
        failurePattern: /target-scoped repository scope invariant failed/u,
      },
    ]) {
      const stem = label.replaceAll(/[^a-z0-9]+/gu, "-");
      const caseRoot = join(root, stem);
      mkdirSync(caseRoot, { recursive: true });
      const scopeFixture = join(caseRoot, "scope.json");
      const helperMarker = join(caseRoot, "helper-entered");
      const downstreamMarker = join(caseRoot, "downstream-entered");
      writeFileSync(scopeFixture, `${JSON.stringify(scope)}\n`);
      const result = invoke("bash", [bindingScript], {
        cwd: root,
        env: {
          DOWNSTREAM_MARKER: downstreamMarker,
          EXPECTED_APP_SLUG: canonicalSlug,
          EXPECTED_SCOPED_TOKEN: SYNTHETIC_TOKEN_FIXTURE.value,
          FAKE_HELPER_MARKER: helperMarker,
          FAKE_SCOPE_FIXTURE: scopeFixture,
          INVENTORY_APP_SLUG: canonicalSlug,
          INVENTORY_INSTALLATION_ID: installationId,
          PATH: `${fakeBin}:${executionEnv.PATH}`,
          RUNNER_TEMP: caseRoot,
          SCOPED_APP_SLUG: canonicalSlug,
          SCOPED_INSTALLATION_ID: installationId,
          SCOPED_INSTALLATION_TOKEN: SYNTHETIC_TOKEN_FIXTURE.value,
          SHELLOPTS: "allexport:verbose:xtrace",
          ...env,
        },
      });
      const combined = `${result.stdout}\n${result.stderr}`;
      assert.doesNotMatch(combined, new RegExp(SYNTHETIC_TOKEN_FIXTURE.value, "u"), label);
      assert.equal(existsSync(helperMarker), helperEntered, label);
      if (accepted) {
        assert.equal(result.status, 0, `${label}: ${result.stderr}`);
        assert.equal(existsSync(downstreamMarker), true, label);
        assert.match(result.stdout, /target-scoped repository scope check passed\./u);
      } else {
        assert.notEqual(result.status, 0, label);
        assert.equal(existsSync(downstreamMarker), false, label);
        assert.match(result.stderr, failurePattern, label);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

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

function fixture(t, version = "2.0.0", { includeLegacyWorkflow = false } = {}) {
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
  if (includeLegacyWorkflow) {
    write(
      join(targetWork, ".github", "workflows", "codex-review-gate.yml"),
      "name: Legacy review gate\n",
    );
  }
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
    ...(options.enforceLiveSignerPolicy
      ? ["--test-enforce-live-signer-policy"]
      : []),
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

function invokeVerifyPublished(state, built, options = {}) {
  verificationInvocationCounter += 1;
  const githubOutput = join(state.root, `verify-published-${verificationInvocationCounter}.output`);
  write(githubOutput, "");
  const result = invoke("bash", releaseArgs(
    state,
    "--verify-published",
    "--source-ref",
    built.sourceCommit,
    "--control-ref",
    built.controlCommit,
    ...(options.testRelease === false
      ? []
      : ["--test-release-dir", state.releases]),
  ), {
    cwd: state.source,
    env: { ...options.env, GITHUB_OUTPUT: githubOutput },
  });
  const combined = `${result.stdout}\n${result.stderr}`;
  const output = readFileSync(githubOutput, "utf8");
  for (const field of [
    "verification_state",
    "verification_stage",
    "recovery_code",
    "next_action",
    "observed_source",
    "observed_tag",
  ]) {
    assert.equal(
      [...combined.matchAll(new RegExp(`(?:^|\\n)${field}=[^\\n]+(?=\\n|$)`, "gu"))].length,
      1,
      `public verification must emit exactly one ${field}\n${combined}`,
    );
    assert.equal(
      [...output.matchAll(new RegExp(`(?:^|\\n)${field}=[^\\n]+(?=\\n|$)`, "gu"))].length,
      1,
      `public verification output must contain exactly one ${field}\n${output}`,
    );
  }
  return Object.assign(result, { githubOutput: output });
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

function createReplacementAliasObject(state, alias) {
  const work = join(state.root, `replacement-${alias}`);
  run("git", ["clone", "-q", state.target, work]);
  git(work, ["config", "user.name", "JoeyTeng-Codex"]);
  git(work, ["config", "user.email", "codex@mahane.me"]);
  const commit = git(work, ["rev-parse", `refs/tags/${alias}^{}`]);
  git(work, ["tag", "-d", alias]);
  execFileSync(
    "git",
    ["-C", work, "tag", "-a", alias, commit, "-m", `Codex Review Gate Action ${alias}`],
    {
      env: { ...executionEnv, GIT_COMMITTER_DATE: "2031-01-02T03:04:05Z" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const object = git(work, ["rev-parse", `refs/tags/${alias}`]);
  assert.notEqual(object, git(state.target, ["rev-parse", `refs/tags/${alias}`]));
  assert.equal(git(work, ["rev-parse", `refs/tags/${alias}^{}`]), commit);
  git(state.target, ["fetch", "-q", work, object]);
  return { commit, object };
}

function createDetachedAliasObject(state, alias, commit = state.initialTarget) {
  const work = join(state.root, `detached-${alias}`);
  run("git", ["clone", "-q", state.target, work]);
  git(work, ["config", "user.name", "JoeyTeng-Codex"]);
  git(work, ["config", "user.email", "codex@mahane.me"]);
  execFileSync(
    "git",
    ["-C", work, "tag", "-a", alias, commit, "-m", `Codex Review Gate Action ${alias}`],
    {
      env: { ...executionEnv, GIT_COMMITTER_DATE: "2031-01-02T03:04:05Z" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const object = git(work, ["rev-parse", `refs/tags/${alias}`]);
  assert.equal(git(work, ["rev-parse", `refs/tags/${alias}^{}`]), commit);
  git(state.target, ["fetch", "-q", work, object]);
  return { commit, object };
}

function fakeGithubEnvironment(state, mutationPhase) {
  const fakeBin = join(state.root, `fake-gh-${mutationPhase}`);
  const fakeGh = join(fakeBin, "gh");
  const fakeState = join(state.root, `fake-gh-state-${mutationPhase}`);
  mkdirSync(fakeBin, { recursive: true });
  mkdirSync(join(fakeState, "assets"), { recursive: true });
  writeJson(join(fakeState, "state.json"), {
    exists: false,
    release_id: 987654321,
    draft: true,
    immutable: false,
    prerelease: false,
    tag: "v2.0.0",
    name: "v2.0.0",
    body: "",
    author_login: "codex-review-gate-action-publisher[bot]",
    asset_uploader_login: "codex-review-gate-action-publisher[bot]",
    latest: null,
    next_asset_id: 1,
    next_replacement_asset_id: 1000001,
    asset_upload_calls: 0,
    asset_upload_target_release_ids: [],
    asset_readback_calls: 0,
    asset_readback_ids: [],
    asset_readback_release_ids: [],
    asset_delete_attempts: 0,
    asset_delete_applied: 0,
    asset_delete_ids: [],
    asset_download_count: 0,
    asset_order_reversed: false,
    asset_timestamp_variant: false,
    observational_mutation_done: false,
    starter_predelete_fence_armed: false,
    replacement_release_assets: [],
    tag_resolution_release_id: null,
    mutation_done: false,
    metadata_mutation_done: false,
    poisoned_after_pre_publish_boundary: false,
    publish_patch_calls: 0,
    publish_patch_payload: null,
    patch_failures_before_apply: 0,
    patch_failures_after_apply: 0,
    release_edit_calls: 0,
    policy_mutation_done: false,
    immutable_policy_reads: 0,
    immutable_policy_enabled: mutationPhase !== "immutable-policy-disabled",
    final_publication_policy_read_complete: false,
    final_publication_boundary_reads: 0,
    raw_boundary_mutation_done: false,
    absent_boundary_api_reads: 0,
    release_api_reads: 0,
    release_id_reads: 0,
    release_inventory_reads: 0,
    release_create_calls: 0,
    post_create_inventory_reads: 0,
    release_download_reads: 0,
    release_view_reads: 0,
    ruleset_drift: false,
    signer_policy_reads: 0,
    call_trace: [],
    assets: [],
  });
  write(fakeGh, `#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const args = process.argv.slice(2);
const root = process.env.FAKE_GH_STATE;
const statePath = join(root, "state.json");
const assetsDir = join(root, "assets");
const phase = process.env.FAKE_GH_MUTATION_PHASE;
const productionRulesets = ${JSON.stringify(FAKE_PRODUCTION_RULESETS)};
if (process.env.FAKE_EXPECT_PINNED_GITHUB_HOST === "true") {
  const inheritedCredentials = [
    "GITHUB_TOKEN",
    "PUBLISHER_TOKEN",
    "RELEASE_PUBLISHER_TOKEN",
    "GH_ENTERPRISE_TOKEN",
    "GITHUB_ENTERPRISE_TOKEN",
  ].filter((name) => Object.hasOwn(process.env, name));
  if (
    process.env.GH_HOST !== "github.com" ||
    process.env.GH_TOKEN !== ${JSON.stringify(SYNTHETIC_TOKEN_FIXTURE.value)} ||
    inheritedCredentials.length !== 0
  ) {
    process.stderr.write(
      "publisher gh invocation inherited hostile host or credential state: " +
        JSON.stringify({
          ghHost: process.env.GH_HOST,
          publisherTokenMatches: process.env.GH_TOKEN === ${JSON.stringify(SYNTHETIC_TOKEN_FIXTURE.value)},
          inheritedCredentials,
        }) +
        "\\n",
    );
    process.exit(89);
  }
}
const readState = () => JSON.parse(readFileSync(statePath, "utf8"));
const save = (state) => writeFileSync(statePath, JSON.stringify(state, null, 2) + "\\n");
const appendTrace = (state, type, kind, details = {}) => {
  state.call_trace.push({
    sequence: state.call_trace.length + 1,
    type,
    kind,
    ...details,
  });
  save(state);
};
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
};
const fail404 = () => {
  process.stderr.write("HTTP 404: Not Found\\n");
  process.exit(1);
};
const failReleaseViewNotFound = () => {
  process.stderr.write("release not found\\n");
  process.exit(1);
};
const digest = (bytes) => "sha256:" + createHash("sha256").update(bytes).digest("hex");
const assetRecord = (state, name, id, created = "2026-08-26T00:00:00Z", options = {}) => {
  const assetPath = join(assetsDir, options.storage_name || name);
  const bytes = existsSync(assetPath) ? readFileSync(assetPath) : Buffer.alloc(0);
  const assetState = options.state || "uploaded";
  return {
    id,
    node_id: "asset-" + id,
    name,
    state: assetState,
    content_type: options.content_type || "application/octet-stream",
    size: options.size ?? bytes.byteLength,
    digest: options.digest !== undefined
      ? options.digest
      : assetState === "starter" ? null : digest(bytes),
    download_count: state.asset_download_count,
    created_at: created,
    updated_at: state.asset_timestamp_variant ||
      (state.mutation_done && name === "release-provenance.json")
      ? "2026-08-26T00:00:01Z"
      : created,
    url: "https://api.invalid/assets/" + id,
    browser_download_url: "https://download.invalid/" + name,
    uploader: {
      id: 4700530,
      node_id: "publisher-app",
      login: options.uploader_login || state.asset_uploader_login,
      type: "Bot",
    },
  };
};
const releaseApi = (state, options = {}) => ({
  id: options.id ?? state.release_id,
  node_id: options.node_id || "release-1",
  tag_name: state.tag,
  name: state.name,
  body: state.body,
  target_commitish: "master",
  prerelease: state.prerelease,
  draft: options.draft ?? state.draft,
  immutable: options.immutable ?? state.immutable,
  author: {
    id: 4700530,
    node_id: "publisher-app",
    login: state.author_login,
    type: "Bot",
  },
  assets: (state.asset_order_reversed
    ? [...(options.assets || state.assets)].reverse()
    : (options.assets || state.assets))
    .map((asset) => assetRecord(state, asset.name, asset.id, undefined, asset)),
});
const uploadReadbackStillPending = (state) =>
  state.asset_readback_calls < state.asset_upload_calls;
const tagResolvesToReplacement = (state) =>
  state.tag_resolution_release_id !== null && uploadReadbackStillPending(state);
const tagResolvedReleaseApi = (state) => tagResolvesToReplacement(state)
  ? releaseApi(state, {
      id: state.tag_resolution_release_id,
      node_id: "replacement-release",
      draft: false,
      immutable: true,
      assets: state.replacement_release_assets,
    })
  : releaseApi(state);
const releaseViewProjection =
  "{isDraft:.draft,isPrerelease:.prerelease,tagName:.tag_name,name:.name,body:.body}";
const signingKeyInventory = ({ revoked = false, replaceCertificate = false } = {}) => [{
  id: 5277815,
  primary_key_id: null,
  key_id: ${JSON.stringify(PRIMARY.slice(-16))},
  raw_key: ${JSON.stringify(RELEASE_SIGNING_PUBLIC_KEY)} + (replaceCertificate ? "\\n" : ""),
  revoked,
  expires_at: null,
  can_sign: true,
  subkeys: [{
    id: 5277817,
    primary_key_id: 5277815,
    key_id: ${JSON.stringify(SUBKEY.slice(-16))},
    revoked: false,
    expires_at: null,
    can_sign: true,
  }],
}];
const immutableReleasePolicy = (state) => {
  if (phase === "immutable-policy-additive-fields") {
    return {
      enabled: state.immutable_policy_enabled,
      enforced_by_owner: false,
      future_policy_field: "ignored",
    };
  }
  if (phase === "immutable-policy-missing-owner-field") {
    return { enabled: state.immutable_policy_enabled };
  }
  if (phase === "immutable-policy-enabled-wrong-type") {
    return { enabled: "true", enforced_by_owner: false };
  }
  if (phase === "immutable-policy-owner-wrong-type") {
    return { enabled: state.immutable_policy_enabled, enforced_by_owner: "false" };
  }
  return { enabled: state.immutable_policy_enabled, enforced_by_owner: false };
};
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

const apiEndpoint = args.slice(1).find((arg) =>
  arg.startsWith("repos/") || arg.startsWith("users/") ||
  arg.startsWith("https://uploads.github.com/"));
const requestedMethod = option("--method") || "GET";
const classifyRemoteCall = () => {
  if (args[0] === "api") {
    if (requestedMethod === "POST" &&
        apiEndpoint?.startsWith("https://uploads.github.com/")) {
      return "release-asset-upload";
    }
    if (requestedMethod === "PATCH" && /\\/releases\\/\\d+$/u.test(apiEndpoint || "")) {
      return "release-patch";
    }
    if (requestedMethod === "DELETE" &&
        /\\/releases\\/assets\\/\\d+$/u.test(apiEndpoint || "")) {
      return "release-asset-delete";
    }
    if (apiEndpoint?.endsWith("/immutable-releases")) return "immutable-policy-read";
    if (apiEndpoint === "users/JoeyTeng-Codex/gpg_keys") return "signer-policy-read";
    if (apiEndpoint?.endsWith("/rulesets")) return "ruleset-list-read";
    if (/\\/rulesets\\/\\d+$/u.test(apiEndpoint || "")) return "ruleset-detail-read";
    if (apiEndpoint?.endsWith("/releases?per_page=100")) return "release-list-read";
    if (apiEndpoint?.endsWith("/releases/latest")) return "latest-release-read";
    if (/\\/releases\\/assets\\/\\d+$/u.test(apiEndpoint || "")) {
      return "release-asset-read";
    }
    if (/\\/releases\\/\\d+$/u.test(apiEndpoint || "")) return "release-id-read";
    if (apiEndpoint?.includes("/releases/tags/") &&
        option("--jq") === releaseViewProjection) return "release-view";
    if (apiEndpoint?.includes("/releases/tags/")) return "release-tag-read";
    if (apiEndpoint?.includes("/commits/") || apiEndpoint?.includes("/git/tags/")) {
      return "signed-object-read";
    }
    return "other-api";
  }
  if (args[0] === "release" && args[1]) return "release-" + args[1];
  return "other-gh";
};
const invocationState = readState();
appendTrace(invocationState, "remote", classifyRemoteCall(), {
  method: requestedMethod,
  endpoint: apiEndpoint || null,
  draft: invocationState.draft,
  immutable: invocationState.immutable,
  mutation_done: invocationState.mutation_done,
  metadata_mutation_done: invocationState.metadata_mutation_done,
});

if (args[0] === "api") {
  const endpoint = apiEndpoint;
  const jq = option("--jq");
  let state = readState();
  const requireCurrentApiVersion = () => {
    if (!args.includes("X-GitHub-Api-Version: 2026-03-10")) {
      process.stderr.write("missing immutable-release API version header\\n");
      process.exit(2);
    }
  };
  const uploadUrl = endpoint?.startsWith("https://uploads.github.com/")
    ? new URL(endpoint)
    : null;
  const uploadMatch = uploadUrl?.pathname.match(
    /^\\/repos\\/JoeyTeng\\/codex-review-gate-action\\/releases\\/(\\d+)\\/assets$/u,
  );
  if (option("--method") === "POST" && uploadMatch) {
    requireCurrentApiVersion();
    if (!args.includes("Accept: application/vnd.github+json") ||
        !args.includes("Content-Type: application/octet-stream")) {
      process.stderr.write("asset upload is missing deterministic API headers\\n");
      process.exit(2);
    }
    const targetReleaseId = Number(uploadMatch[1]);
    const input = option("--input");
    const names = uploadUrl.searchParams.getAll("name");
    if (!Number.isSafeInteger(targetReleaseId) || targetReleaseId <= 0 ||
        targetReleaseId !== state.release_id || names.length !== 1 || !names[0] ||
        !input || input === "-") {
      process.stderr.write("asset upload did not bind a valid frozen Release id, name, and input\\n");
      process.exit(2);
    }
    if (phase === "asset-upload-failure-before-apply") {
      process.stderr.write("simulated asset upload failure before apply\\n");
      process.exit(1);
    }
    const name = names[0];
    if (phase === "asset-upload-tag-resolution-replaced") {
      if (state.tag_resolution_release_id === null) {
        state.tag_resolution_release_id = state.release_id + 1000;
      }
      const replacementStorageName =
        "replacement-" + state.tag_resolution_release_id + "-" + name;
      writeFileSync(
        join(assetsDir, replacementStorageName),
        "replacement Release asset for " + name + "\\n",
      );
      state.replacement_release_assets.push({
        name,
        id: state.next_replacement_asset_id++,
        release_id: state.tag_resolution_release_id,
        storage_name: replacementStorageName,
      });
    }
    if (phase === "asset-upload-502-starter" && state.asset_upload_calls === 0) {
      writeFileSync(join(assetsDir, name), Buffer.alloc(0));
      const id = state.next_asset_id++;
      state.assets.push({ name, id, release_id: targetReleaseId, state: "starter", size: 0 });
      state.asset_upload_calls += 1;
      state.asset_upload_target_release_ids.push(targetReleaseId);
      save(state);
      process.stderr.write("simulated 502 after GitHub created a starter asset\\n");
      process.exit(1);
    }
    copyFileSync(input, join(assetsDir, name));
    const id = state.next_asset_id++;
    state.assets.push({ name, id, release_id: targetReleaseId });
    state.asset_upload_calls += 1;
    state.asset_upload_target_release_ids.push(targetReleaseId);
    save(state);
    if (phase === "asset-upload-response-lost-after-apply") {
      process.stderr.write("simulated asset upload response loss after apply\\n");
      process.exit(1);
    }
    if (phase === "asset-upload-zero-exit-empty-response") process.exit(0);
    if (phase === "asset-upload-zero-exit-malformed-response") {
      process.stdout.write("{malformed-json\\n");
      process.exit(0);
    }
    if (phase === "asset-upload-zero-exit-wrong-id-response") {
      process.stdout.write(JSON.stringify({
        ...assetRecord(state, name, id),
        id: id + 1000,
      }) + "\\n");
      process.exit(0);
    }
    process.stdout.write(JSON.stringify(assetRecord(state, name, id)) + "\\n");
    process.exit(0);
  }
  if (endpoint === "users/JoeyTeng-Codex/gpg_keys") {
    state.signer_policy_reads += 1;
    const criticalFence = state.publish_patch_calls === 0 && state.immutable_policy_reads === 2
      ? "publication"
      : state.publish_patch_calls === 1 && state.immutable_policy_reads === 2
        ? "alias"
        : null;
    const trace = state.call_trace.at(-1);
    trace.signer_policy_read = state.signer_policy_reads;
    trace.critical_fence = criticalFence;
    save(state);
    const targetsCriticalFence = criticalFence !== null && phase.endsWith("-" + criticalFence);
    if (targetsCriticalFence && phase.startsWith("live-signer-api-unreadable-")) {
      process.stderr.write("simulated " + criticalFence + " signer inventory outage\\n");
      process.exit(1);
    }
    process.stdout.write(JSON.stringify(signingKeyInventory({
      revoked: targetsCriticalFence && phase.startsWith("live-signer-revoked-"),
      replaceCertificate:
        targetsCriticalFence && phase.startsWith("live-signer-cert-replacement-"),
    })) + "\\n");
    process.exit(0);
  }
  if (endpoint?.endsWith("/immutable-releases")) {
    requireCurrentApiVersion();
    state.immutable_policy_reads += 1;
    if ((phase === "starter-predelete-state-drift" ||
        phase === "starter-predelete-unrelated-drift") &&
        state.assets.some(({ state: assetState }) => assetState === "starter")) {
      state.starter_predelete_fence_armed = true;
    }
    if (state.immutable_policy_reads === 2) {
      state.final_publication_policy_read_complete = true;
    }
    if (phase === "immutable-policy-disabled-before-alias" &&
        state.immutable_policy_reads === 3) {
      state.immutable_policy_enabled = false;
      state.policy_mutation_done = true;
      appendTrace(state, "event", "alias-policy-window-mutation", {
        phase,
        immutable_policy_read: state.immutable_policy_reads,
      });
    }
    if (!state.immutable_policy_enabled) {
      save(state);
      fail404();
    }
    if (phase === "immutable-policy-api-unreadable") {
      save(state);
      process.stderr.write("simulated immutable-release policy API outage\\n");
      process.exit(1);
    }
    process.stdout.write(JSON.stringify(immutableReleasePolicy(state)) + "\\n");
    if (!state.policy_mutation_done && phase === "source-policy-drift") {
      execFileSync(process.env.REAL_GIT, [
        "-C",
        process.env.FAKE_SOURCE_REPOSITORY,
        "update-ref",
        "refs/heads/master",
        process.env.FAKE_SOURCE_DRIFT_COMMIT,
      ]);
      state.policy_mutation_done = true;
      save(state);
    } else if (!state.policy_mutation_done && phase === "ruleset-policy-drift") {
      state.ruleset_drift = true;
      state.policy_mutation_done = true;
      save(state);
    } else if (!state.policy_mutation_done &&
        phase === "source-drift-during-release-policy-read" &&
        state.immutable_policy_reads === 2) {
      execFileSync(process.env.REAL_GIT, [
        "-C",
        process.env.FAKE_SOURCE_REPOSITORY,
        "update-ref",
        "refs/heads/master",
        process.env.FAKE_SOURCE_DRIFT_COMMIT,
      ]);
      state.policy_mutation_done = true;
      save(state);
    } else if (!state.policy_mutation_done &&
        phase === "asset-drift-during-final-policy-read" &&
        state.immutable_policy_reads === 2) {
      state.poisoned_after_pre_publish_boundary = true;
      state.policy_mutation_done = true;
      appendTrace(state, "event", "policy-window-mutation", {
        phase,
        immutable_policy_read: state.immutable_policy_reads,
      });
      mutateProvenance(state);
    } else if (!state.policy_mutation_done &&
        phase === "metadata-drift-during-final-policy-read" &&
        state.immutable_policy_reads === 2) {
      state.body += "\\nreplaced-after-pre-publish-boundary";
      state.metadata_mutation_done = true;
      state.poisoned_after_pre_publish_boundary = true;
      state.policy_mutation_done = true;
      appendTrace(state, "event", "policy-window-mutation", {
        phase,
        immutable_policy_read: state.immutable_policy_reads,
      });
    } else if (!state.policy_mutation_done &&
        phase === "stable-invalid-author-before-final-boundary" &&
        state.immutable_policy_reads === 2) {
      state.author_login = "unexpected-release-writer[bot]";
      state.policy_mutation_done = true;
      appendTrace(state, "event", "policy-window-mutation", {
        phase,
        immutable_policy_read: state.immutable_policy_reads,
      });
    } else if (!state.policy_mutation_done &&
        phase === "stable-invalid-asset-before-final-boundary" &&
        state.immutable_policy_reads === 2) {
      state.asset_uploader_login = "unexpected-asset-writer[bot]";
      state.policy_mutation_done = true;
      appendTrace(state, "event", "policy-window-mutation", {
        phase,
        immutable_policy_read: state.immutable_policy_reads,
      });
    } else if (!state.policy_mutation_done &&
        phase === "stable-invalid-tag-before-final-boundary" &&
        state.immutable_policy_reads === 2) {
      state.tag = "v2.0.0-unexpected";
      state.policy_mutation_done = true;
      appendTrace(state, "event", "policy-window-mutation", {
        phase,
        immutable_policy_read: state.immutable_policy_reads,
      });
    } else if (!state.policy_mutation_done &&
        phase === "release-drift-during-alias-policy-read" &&
        state.immutable_policy_reads === 3) {
      state.policy_mutation_done = true;
      appendTrace(state, "event", "alias-policy-window-mutation", {
        phase,
        immutable_policy_read: state.immutable_policy_reads,
      });
      mutateProvenance(state);
    } else {
      save(state);
    }
    process.exit(0);
  }
  const releasePatchMatch = endpoint?.match(/\\/releases\\/(\\d+)$/u);
  if (option("--method") === "PATCH" && releasePatchMatch) {
    requireCurrentApiVersion();
    if (Number(releasePatchMatch[1]) !== state.release_id) {
      process.stderr.write("publish PATCH did not target the frozen numeric Release id\\n");
      process.exit(2);
    }
    const input = option("--input");
    if (!input || input === "-") {
      process.stderr.write("publish PATCH must use a frozen JSON input file\\n");
      process.exit(2);
    }
    let payload;
    try {
      payload = JSON.parse(readFileSync(input, "utf8"));
    } catch (error) {
      process.stderr.write("invalid publish PATCH JSON: " + error.message + "\\n");
      process.exit(2);
    }
    const expectedPayload = {
      body: state.body,
      draft: false,
      make_latest: state.prerelease ? "false" : "true",
      name: state.tag,
      prerelease: state.prerelease,
      tag_name: state.tag,
    };
    if (JSON.stringify(payload) !== JSON.stringify(expectedPayload)) {
      process.stderr.write(
        "publish PATCH payload mismatch: " +
          JSON.stringify({ expected: expectedPayload, actual: payload }) +
          "\\n",
      );
      process.exit(2);
    }
    if (phase === "patch-failure-before-apply") {
      state.patch_failures_before_apply += 1;
      save(state);
      process.stderr.write("simulated Release PATCH failure before apply\\n");
      process.exit(1);
    }
    state.publish_patch_calls += 1;
    state.publish_patch_payload = payload;
    state.draft = false;
    state.immutable = phase !== "post-publish-mutable";
    state.latest = payload.make_latest === "true" ? state.tag : state.latest;
    save(state);
    if (phase === "patch-response-lost-after-apply") {
      state.patch_failures_after_apply += 1;
      save(state);
      process.stderr.write("simulated Release PATCH response loss after apply\\n");
      process.exit(1);
    }
    if (phase === "patch-zero-exit-empty-response") {
      process.exit(0);
    }
    if (phase === "patch-zero-exit-malformed-response") {
      process.stdout.write("{malformed-json\\n");
      process.exit(0);
    }
    if (phase === "patch-zero-exit-wrong-id-response") {
      process.stdout.write(JSON.stringify({
        ...releaseApi(state),
        id: state.release_id + 1,
      }) + "\\n");
      process.exit(0);
    }
    process.stdout.write(JSON.stringify(releaseApi(state)) + "\\n");
    process.exit(0);
  }
  if (endpoint?.endsWith("/rulesets")) {
    requireCurrentApiVersion();
    process.stdout.write(JSON.stringify([productionRulesets.map(({ id, name, enforcement, target }) => ({
      id,
      name,
      enforcement,
      target,
    }))]) + "\\n");
    process.exit(0);
  }
  const rulesetMatch = endpoint?.match(/\\/rulesets\\/(\\d+)$/u);
  if (rulesetMatch) {
    requireCurrentApiVersion();
    const ruleset = productionRulesets.find(({ id }) => String(id) === rulesetMatch[1]);
    if (!ruleset) fail404();
    const markerDrift = process.env.FAKE_RULESET_DRIFT_MARKER &&
      existsSync(process.env.FAKE_RULESET_DRIFT_MARKER);
    const result = (state.ruleset_drift || markerDrift) && ruleset.id === 1
      ? { ...ruleset, enforcement: "disabled" }
      : ruleset;
    process.stdout.write(JSON.stringify(result) + "\\n");
    process.exit(0);
  }
  if (endpoint?.endsWith("/releases?per_page=100")) {
    requireCurrentApiVersion();
    state.release_inventory_reads += 1;
    if (!state.exists && phase.startsWith("absent-boundary-") &&
        process.env.FAKE_ABSENT_BOUNDARY_API_MARKER &&
        state.immutable_policy_reads > 0) {
      if (!existsSync(process.env.FAKE_ABSENT_BOUNDARY_API_MARKER)) {
        writeFileSync(process.env.FAKE_ABSENT_BOUNDARY_API_MARKER, "active\\n");
      }
      state.absent_boundary_api_reads += 1;
      const apiRead = state.absent_boundary_api_reads;
      save(state);
      if ((phase === "absent-boundary-api-unreadable-first" && apiRead === 1) ||
          (phase === "absent-boundary-api-unreadable-second" && apiRead === 2)) {
        process.stderr.write("simulated absent Release inventory outage\\n");
        process.exit(1);
      }
      if (phase === "absent-boundary-release-appears" && apiRead === 2) {
        state.exists = true;
        save(state);
      }
    }
    if (["release-inventory-outer-empty", "verify-release-inventory-outer-empty"].includes(phase)) {
      process.stdout.write("[]\\n");
      process.exit(0);
    }
    if (["release-inventory-duplicate-id", "verify-release-inventory-duplicate-id"].includes(phase)) {
      const repeated = releaseApi(state);
      process.stdout.write(JSON.stringify([[repeated], [repeated]]) + "\\n");
      process.exit(0);
    }
    if (phase === "release-inventory-duplicate-exact-tag") {
      const first = releaseApi(state);
      const second = { ...releaseApi(state), id: state.release_id + 1, node_id: "release-2" };
      process.stdout.write(JSON.stringify([[first, second]]) + "\\n");
      process.exit(0);
    }
    if (state.exists && state.release_create_calls > 0) {
      state.post_create_inventory_reads += 1;
      if (phase.startsWith("post-create-inventory-") &&
          state.post_create_inventory_reads === 2) {
        if (phase === "post-create-inventory-id-drift") {
          state.release_id += 1;
        } else if (phase === "post-create-inventory-release-disappears") {
          state.exists = false;
        }
      }
      save(state);
    }
    let pages;
    if (phase === "release-inventory-target-second-page") {
      pages = [[], state.exists ? [releaseApi(state)] : []];
    } else if (phase === "release-inventory-ordering-drift" && state.exists) {
      pages = state.release_inventory_reads % 2 === 0
        ? [[], [releaseApi(state)]]
        : [[releaseApi(state)], []];
    } else {
      pages = [state.exists ? [releaseApi(state)] : []];
    }
    save(state);
    process.stdout.write(JSON.stringify(pages) + "\\n");
    process.exit(0);
  }
  if (endpoint.endsWith("/releases/latest")) {
    if (!state.latest) fail404();
    process.stdout.write(state.latest + "\\n");
    if (["after-immutable", "stable-asset-replacement-before-final-boundary"].includes(phase) &&
        state.immutable && !state.mutation_done) {
      appendTrace(state, "event", "post-publish-boundary-mutation", { phase });
      mutateProvenance(state);
    }
    process.exit(0);
  }
  const assetReadMatch = endpoint?.match(/\\/releases\\/assets\\/(\\d+)$/u);
  if (assetReadMatch) {
    requireCurrentApiVersion();
    const assetId = Number(assetReadMatch[1]);
    const assetIndex = state.assets.findIndex(({ id }) => id === assetId);
    const asset = state.assets[assetIndex];
    if (requestedMethod === "DELETE") {
      if (!args.includes("Accept: application/vnd.github+json")) {
        process.stderr.write("starter deletion is missing the JSON API Accept header\\n");
        process.exit(2);
      }
      if (!Number.isSafeInteger(assetId) || assetId <= 0 || !asset) fail404();
      if (asset.release_id !== state.release_id) fail404();
      state.asset_delete_attempts += 1;
      state.asset_delete_ids.push(assetId);
      save(state);
      // GitHub's asset DELETE endpoint is unconditional and has no state
      // predicate. The production publisher, not this fake, must prove the
      // zero-byte starter precondition before issuing the request.
      if (phase === "starter-delete-failure-before-apply") {
        process.stderr.write("simulated starter deletion failure before apply\\n");
        process.exit(1);
      }
      state.assets.splice(assetIndex, 1);
      const assetPath = join(assetsDir, asset.name);
      if (existsSync(assetPath)) unlinkSync(assetPath);
      state.asset_delete_applied += 1;
      save(state);
      if (phase === "starter-delete-response-lost-after-apply") {
        process.stderr.write("simulated starter deletion response loss after apply\\n");
        process.exit(1);
      }
      if (phase === "starter-delete-404-after-apply") fail404();
      process.exit(0);
    }
    if (option("--method") !== null ||
        !args.includes("Accept: application/octet-stream")) {
      process.stderr.write("asset readback must use raw GET with deterministic headers\\n");
      process.exit(2);
    }
    if (!Number.isSafeInteger(assetId) || assetId <= 0 || !asset) fail404();
    if (asset.release_id !== state.release_id) fail404();
    state.asset_readback_calls += 1;
    state.asset_readback_ids.push(assetId);
    state.asset_readback_release_ids.push(state.release_id);
    save(state);
    if (phase === "asset-readback-failure") {
      process.stderr.write("simulated asset-ID readback failure\\n");
      process.exit(1);
    }
    if (phase === "asset-readback-byte-mismatch") {
      process.stdout.write(Buffer.concat([
        readFileSync(join(assetsDir, asset.name)),
        Buffer.from("mismatched-readback\\n"),
      ]));
      process.exit(0);
    }
    process.stdout.write(readFileSync(join(assetsDir, asset.name)));
    process.exit(0);
  }
  const releaseIdMatch = endpoint?.match(/\\/releases\\/(\\d+)$/u);
  if (releaseIdMatch) {
    requireCurrentApiVersion();
    if (!state.exists || Number(releaseIdMatch[1]) !== state.release_id) fail404();
    state.release_id_reads += 1;
    if (state.starter_predelete_fence_armed && !state.observational_mutation_done) {
      if (phase === "starter-predelete-state-drift") {
        const starter = state.assets.find(({ state: assetState }) => assetState === "starter");
        if (starter) starter.state = "uploaded";
      } else if (phase === "starter-predelete-unrelated-drift") {
        state.body += "\\nchanged-before-starter-delete";
      }
      state.observational_mutation_done = true;
    }
    save(state);
    if (phase === "release-id-boundary-404") fail404();
    if (state.final_publication_policy_read_complete && state.draft) {
      state.final_publication_boundary_reads += 1;
      save(state);
      if (phase === "pre-publication-boundary-unreadable" &&
          state.final_publication_boundary_reads === 1) {
        process.stderr.write("simulated final Release boundary outage\\n");
        process.exit(1);
      }
    }
    const response = releaseApi(state);
    if (phase === "release-id-boundary-wrong-id") response.id = state.release_id + 1;
    if (state.final_publication_policy_read_complete && state.draft &&
        (phase === "pre-publication-stable-schema-invalid" ||
          (phase === "pre-publication-valid-to-schema-invalid" &&
            state.final_publication_boundary_reads === 2))) {
      response.author.id = "not-a-number";
      if (phase === "pre-publication-valid-to-schema-invalid") {
        state.raw_boundary_mutation_done = true;
        save(state);
      }
    }
    process.stdout.write(JSON.stringify(response) + "\\n");
    if (!state.observational_mutation_done && state.assets.length > 1 &&
        phase === "release-boundary-download-count-drift") {
      state.asset_download_count += 1;
      state.observational_mutation_done = true;
      save(state);
    } else if (!state.observational_mutation_done && state.assets.length > 1 &&
        phase === "release-boundary-asset-order-drift") {
      state.asset_order_reversed = !state.asset_order_reversed;
      state.observational_mutation_done = true;
      save(state);
    } else if (!state.observational_mutation_done && state.assets.length > 1 &&
        phase === "release-boundary-timestamp-drift") {
      state.asset_timestamp_variant = true;
      state.observational_mutation_done = true;
      save(state);
    }
    if (state.draft && state.final_publication_boundary_reads === 1) {
      if (phase === "pre-publication-boundary-snapshot-changed") {
        state.raw_boundary_mutation_done = true;
        mutateProvenance(state);
      } else if (phase === "pre-publication-second-raw-metadata-drift") {
        state.body += "\\nchanged-between-raw-boundary-snapshots";
        state.raw_boundary_mutation_done = true;
        save(state);
      } else if (phase === "pre-publication-second-raw-tag-drift") {
        state.tag = "v2.0.0-changed-between-snapshots";
        state.raw_boundary_mutation_done = true;
        save(state);
      }
    }
    process.exit(0);
  }
  if (endpoint.includes("/releases/tags/")) {
    requireCurrentApiVersion();
    const resolvedRelease = tagResolvedReleaseApi(state);
    if (jq === releaseViewProjection) {
      state.release_view_reads += 1;
      const releaseViewNotFound =
        phase === "verify-final-view-404" && state.release_view_reads === 2;
      save(state);
      if (!state.exists || resolvedRelease.draft || releaseViewNotFound) fail404();
      process.stdout.write(JSON.stringify({
        isDraft: resolvedRelease.draft,
        isPrerelease: resolvedRelease.prerelease,
        tagName: resolvedRelease.tag_name,
        name: resolvedRelease.name,
        body: resolvedRelease.body,
      }) + "\\n");
      process.exit(0);
    }
    if (!state.exists || resolvedRelease.draft) fail404();
    state.release_api_reads += 1;
    const releaseApi404 =
      (phase === "verify-initial-api-404" && state.release_api_reads === 1) ||
      (phase === "verify-final-api-404" && state.release_api_reads === 2);
    save(state);
    if (releaseApi404) fail404();
    if (jq === ".author.login") {
      process.stdout.write(resolvedRelease.author.login + "\\n");
      process.exit(0);
    }
    if (jq === ".immutable") {
      process.stdout.write(String(resolvedRelease.immutable) + "\\n");
      if (phase === "after-immutable") mutateProvenance(state);
      process.exit(0);
    }
    process.stdout.write(JSON.stringify(resolvedRelease) + "\\n");
    process.exit(0);
  }
  if (endpoint.includes("/commits/") || endpoint.includes("/git/tags/")) {
    if (jq) {
      process.stdout.write("true valid\\n");
    } else {
      process.stdout.write(JSON.stringify({
        commit: { verification: { verified: true, reason: "valid" } },
        verification: { verified: true, reason: "valid" },
      }) + "\\n");
    }
    process.exit(0);
  }
  process.stderr.write("unsupported fake gh api: " + endpoint + "\\n");
  process.exit(2);
}

if (args[0] === "release" && args[1] === "view") {
  const state = readState();
  if (!state.exists) failReleaseViewNotFound();
  const resolvedRelease = tagResolvedReleaseApi(state);
  state.release_view_reads += 1;
  const releaseViewNotFound = phase === "verify-final-view-404" && state.release_view_reads === 2;
  save(state);
  if (releaseViewNotFound) failReleaseViewNotFound();
  if (option("--jq") === ".assets[].name") {
    process.stdout.write(
      resolvedRelease.assets.map((asset) => asset.name).sort().join("\\n") +
        (resolvedRelease.assets.length ? "\\n" : ""),
    );
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({
    isDraft: resolvedRelease.draft,
    isPrerelease: resolvedRelease.prerelease,
    tagName: resolvedRelease.tag_name,
    name: resolvedRelease.name,
    body: resolvedRelease.body,
    assets: resolvedRelease.assets,
  }) + "\\n");
  process.exit(0);
}

if (args[0] === "release" && args[1] === "create") {
  const state = readState();
  state.release_create_calls += 1;
  if (phase === "release-create-failure-before-apply") {
    save(state);
    process.stderr.write("simulated Release create failure before apply\\n");
    process.exit(1);
  }
  state.exists = true;
  state.draft = true;
  state.immutable = false;
  state.prerelease = args.includes("--prerelease");
  state.tag = args[2];
  state.name = option("--title");
  state.body = option("--notes");
  save(state);
  if (phase === "release-create-response-lost-after-apply") {
    process.stderr.write("simulated Release create response loss after apply\\n");
    process.exit(1);
  }
  process.exit(0);
}

if (args[0] === "release" && args[1] === "upload") {
  process.stderr.write("publisher must not resolve asset uploads by mutable tag name\\n");
  process.exit(2);
}

if (args[0] === "release" && args[1] === "download") {
  const state = readState();
  state.release_download_reads += 1;
  save(state);
  if (phase === "verify-download-404" && state.release_download_reads === 1) fail404();
  const pattern = option("--pattern");
  const destination = option("--dir");
  mkdirSync(destination, { recursive: true });
  const tagSelectedAssets = state.tag_resolution_release_id !== null &&
      uploadReadbackStillPending(state)
    ? state.replacement_release_assets
    : state.assets;
  const selected = pattern === "*"
    ? tagSelectedAssets
    : tagSelectedAssets.filter((asset) => asset.name === pattern);
  for (const asset of selected) {
    copyFileSync(
      join(assetsDir, asset.storage_name || asset.name),
      join(destination, asset.name),
    );
  }
  process.exit(selected.length > 0 ? 0 : 1);
}

if (args[0] === "release" && args[1] === "edit") {
  const state = readState();
  state.release_edit_calls += 1;
  save(state);
  process.stderr.write("publisher must not use gh release edit\\n");
  process.exit(2);
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

function danglingCommit(repo, parent, message) {
  const tree = git(repo, ["rev-parse", `${parent}^{tree}`]);
  return execFileSync(
    "git",
    ["-C", repo, "commit-tree", tree, "-p", parent],
    {
      encoding: "utf8",
      env: executionEnv,
      input: `${message}\n`,
      stdio: ["pipe", "pipe", "pipe"],
    },
  ).trim();
}

function driftAfterMasterPushEnvironment(state, githubEnvironment, kind) {
  const fakeBin = join(state.root, `post-master-${kind}-bin`);
  const fakeGit = join(fakeBin, "git");
  const mutationMarker = join(state.root, `post-master-${kind}.marker`);
  const rulesetDriftMarker = join(state.root, `post-master-${kind}.ruleset-drift`);
  const realGit = run("which", ["git"]);
  const sourceBefore = git(state.source, ["rev-parse", "refs/heads/master"]);
  const sourceDriftCommit = danglingCommit(
    state.source,
    sourceBefore,
    `Source drift after publisher master write (${kind})`,
  );
  mkdirSync(fakeBin);
  write(fakeGit, `#!/bin/sh
set -eu
master_push=false
for argument in "$@"; do
  case "$argument" in
    *:refs/heads/master) master_push=true ;;
  esac
done
"$REAL_GIT" "$@"
if [ "$master_push" = true ] && [ ! -e "$MUTATION_MARKER" ]; then
  : > "$MUTATION_MARKER"
  if [ "$DRIFT_KIND" = source ]; then
    "$REAL_GIT" -C "$DRIFT_SOURCE_REPOSITORY" update-ref refs/heads/master "$DRIFT_SOURCE_COMMIT"
  else
    : > "$RULESET_DRIFT_MARKER"
  fi
fi
`);
  chmodSync(fakeGit, 0o755);
  return {
    ...githubEnvironment,
    DRIFT_KIND: kind,
    DRIFT_SOURCE_COMMIT: sourceDriftCommit,
    DRIFT_SOURCE_REPOSITORY: state.source,
    FAKE_RULESET_DRIFT_MARKER: rulesetDriftMarker,
    MUTATION_MARKER: mutationMarker,
    PATH: `${fakeBin}:${githubEnvironment.PATH}`,
    REAL_GIT: realGit,
    RULESET_DRIFT_MARKER: rulesetDriftMarker,
  };
}

function aliasReadbackDriftEnvironment(
  state,
  githubEnvironment,
  phase,
  replacementAliasObject,
) {
  const fakeBin = join(state.root, `${phase}-bin`);
  const fakeGit = join(fakeBin, "git");
  const pushMarker = join(state.root, `${phase}-push.marker`);
  const firstReadMarker = join(state.root, `${phase}-first-read.marker`);
  const readCountFile = join(state.root, `${phase}-read-count`);
  mkdirSync(fakeBin);
  write(fakeGit, `#!/bin/sh
set -u
alias_push=false
alias_read=false
for argument in "$@"; do
  case "$argument" in
    *:refs/tags/v2) alias_push=true ;;
    refs/tags/v2|refs/tags/v2^\\{\\}) alias_read=true ;;
  esac
done

if [ "$alias_read" = true ] && [ -e "$ALIAS_PUSH_MARKER" ]; then
  read_count=0
  if [ -f "$ALIAS_READ_COUNT_FILE" ]; then
    read -r read_count < "$ALIAS_READ_COUNT_FILE"
  fi
  read_count=$((read_count + 1))
  printf '%s\\n' "$read_count" > "$ALIAS_READ_COUNT_FILE"
  case "$ALIAS_READBACK_PHASE" in
    command-failure-first)
      if [ "$read_count" -eq 1 ]; then exit 71; fi
      ;;
    command-failure-second)
      if [ "$read_count" -eq 2 ]; then exit 72; fi
      ;;
    stable-malformed-two-line)
      printf '%s\\t%s\\n%s\\t%s\\n' \\
        "$REPLACEMENT_ALIAS_OBJECT" refs/tags/v2 \\
        "$REPLACEMENT_ALIAS_COMMIT" refs/tags/v2-malformed
      exit 0
      ;;
    valid-then-shape-drift)
      if [ "$read_count" -eq 2 ]; then
        "$REAL_GIT" --git-dir="$MUTATION_TARGET" update-ref \\
          refs/tags/v2 "$REPLACEMENT_ALIAS_COMMIT"
      fi
      ;;
  esac
fi

status=0
"$REAL_GIT" "$@" || status=$?
if [ "$status" -eq 0 ] && [ "$alias_push" = true ]; then
  : > "$ALIAS_PUSH_MARKER"
  case "$ALIAS_READBACK_PHASE" in
    stable-mismatch|stable-malformed-two-line)
      "$REAL_GIT" --git-dir="$MUTATION_TARGET" update-ref \\
        refs/tags/v2 "$REPLACEMENT_ALIAS_OBJECT"
      ;;
    stable-lightweight)
      "$REAL_GIT" --git-dir="$MUTATION_TARGET" update-ref \\
        refs/tags/v2 "$REPLACEMENT_ALIAS_COMMIT"
      ;;
  esac
elif [ "$status" -eq 0 ] && [ "$alias_read" = true ] &&
    [ -e "$ALIAS_PUSH_MARKER" ] && [ ! -e "$ALIAS_FIRST_READ_MARKER" ]; then
  : > "$ALIAS_FIRST_READ_MARKER"
  if [ "$ALIAS_READBACK_PHASE" = changed-between-reads ]; then
    "$REAL_GIT" --git-dir="$MUTATION_TARGET" update-ref refs/tags/v2 "$REPLACEMENT_ALIAS_OBJECT"
  fi
fi
exit "$status"
`);
  chmodSync(fakeGit, 0o755);
  return {
    ...githubEnvironment,
    ALIAS_FIRST_READ_MARKER: firstReadMarker,
    ALIAS_PUSH_MARKER: pushMarker,
    ALIAS_READBACK_PHASE: phase,
    ALIAS_READ_COUNT_FILE: readCountFile,
    MUTATION_TARGET: state.target,
    PATH: `${fakeBin}:${githubEnvironment.PATH}`,
    REAL_GIT: run("which", ["git"]),
    REPLACEMENT_ALIAS_COMMIT: git(
      state.target,
      ["rev-parse", `${replacementAliasObject}^{}`],
    ),
    REPLACEMENT_ALIAS_OBJECT: replacementAliasObject,
  };
}

function absentBoundaryDriftEnvironment(
  state,
  githubEnvironment,
  phase,
  replacementTagObject,
) {
  const fakeBin = join(state.root, `${phase}-bin`);
  const fakeGit = join(fakeBin, "git");
  const apiMarker = join(state.root, `${phase}-api.marker`);
  const tagReadCountFile = join(state.root, `${phase}-tag-read-count`);
  mkdirSync(fakeBin);
  write(fakeGit, `#!/bin/sh
set -u
full_tag_read=false
for argument in "$@"; do
  case "$argument" in
    refs/tags/v2.0.0|refs/tags/v2.0.0^\\{\\}) full_tag_read=true ;;
  esac
done

tag_read=0
if [ "$full_tag_read" = true ] && [ -e "$ABSENT_BOUNDARY_API_MARKER" ]; then
  if [ -f "$ABSENT_TAG_READ_COUNT_FILE" ]; then
    read -r tag_read < "$ABSENT_TAG_READ_COUNT_FILE"
  fi
  tag_read=$((tag_read + 1))
  printf '%s\\n' "$tag_read" > "$ABSENT_TAG_READ_COUNT_FILE"
  case "$ABSENT_BOUNDARY_PHASE" in
    tag-unreadable-first)
      if [ "$tag_read" -eq 1 ]; then exit 73; fi
      ;;
    tag-unreadable-second)
      if [ "$tag_read" -eq 2 ]; then exit 74; fi
      ;;
    stable-mismatch)
      if [ "$tag_read" -eq 1 ]; then
        "$REAL_GIT" --git-dir="$MUTATION_TARGET" update-ref \\
          refs/tags/v2.0.0 "$REPLACEMENT_TAG_OBJECT"
      fi
      ;;
    stable-lightweight)
      if [ "$tag_read" -eq 1 ]; then
        "$REAL_GIT" --git-dir="$MUTATION_TARGET" update-ref \\
          refs/tags/v2.0.0 "$REPLACEMENT_TAG_COMMIT"
      fi
      ;;
  esac
fi

status=0
"$REAL_GIT" "$@" || status=$?
if [ "$status" -eq 0 ] && [ "$full_tag_read" = true ] &&
    [ "$ABSENT_BOUNDARY_PHASE" = tag-drift ] && [ "$tag_read" -eq 1 ]; then
  "$REAL_GIT" --git-dir="$MUTATION_TARGET" update-ref \\
    refs/tags/v2.0.0 "$REPLACEMENT_TAG_OBJECT"
fi
exit "$status"
`);
  chmodSync(fakeGit, 0o755);
  return {
    ...githubEnvironment,
    ABSENT_BOUNDARY_API_MARKER: apiMarker,
    ABSENT_BOUNDARY_PHASE: phase,
    ABSENT_TAG_READ_COUNT_FILE: tagReadCountFile,
    FAKE_ABSENT_BOUNDARY_API_MARKER: apiMarker,
    MUTATION_TARGET: state.target,
    PATH: `${fakeBin}:${githubEnvironment.PATH}`,
    REAL_GIT: run("which", ["git"]),
    REPLACEMENT_TAG_COMMIT: git(
      state.target,
      ["rev-parse", `${replacementTagObject}^{}`],
    ),
    REPLACEMENT_TAG_OBJECT: replacementTagObject,
  };
}

function liveSignerPolicyEnvironment(state, githubEnvironment, label) {
  const runnerTemp = join(state.root, `live-signer-${label}`);
  mkdirSync(runnerTemp, { mode: 0o700 });
  write(join(runnerTemp, "release-signing-public-key.asc"), RELEASE_SIGNING_PUBLIC_KEY);
  return {
    ...githubEnvironment,
    RUNNER_TEMP: runnerTemp,
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

test("release workflow assigns runners and timeout headroom by workload", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  assert.equal(workflow.match(/^    timeout-minutes: 30$/gmu)?.length ?? 0, 1);
  assert.equal(workflow.match(/^    timeout-minutes: 14$/gmu)?.length ?? 0, 7);
  for (const jobName of [
    "plan",
    "candidate-a",
    "candidate-b",
    "assemble",
    "publication_plan",
    "verify",
  ]) {
    const job = workflowJobBlock(workflow, jobName);
    assert.match(job, /^    runs-on: ubuntu-slim$/mu, jobName);
    assert.match(job, /^    timeout-minutes: 14$/mu, jobName);
    assert.doesNotMatch(job, /^    timeout-minutes: 30$/mu, jobName);
  }
  const sourceValidation = workflowJobBlock(workflow, "source-validation");
  assert.match(sourceValidation, /^    runs-on: ubuntu-24\.04$/mu);
  assert.match(sourceValidation, /^    timeout-minutes: 14$/mu);
  assert.doesNotMatch(sourceValidation, /^    timeout-minutes: 30$/mu);
  const publish = workflowJobBlock(workflow, "publish");
  assert.match(publish, /^    runs-on: ubuntu-24\.04$/mu);
  assert.match(publish, /^    timeout-minutes: 30$/mu);
  const releaseShardEnvironment = [
    "CODEX",
    "REVIEW",
    "GATE",
    "RELEASE",
    "TEST",
    "SHARD",
  ].join("_");
  const candidateA = workflowJobBlock(workflow, "candidate-a");
  const candidateB = workflowJobBlock(workflow, "candidate-b");
  const validation = workflowJobBlock(workflow, "source-validation");
  const assemble = workflowJobBlock(workflow, "assemble");

  for (const [jobName, job] of [
    ["candidate-a", candidateA],
    ["candidate-b", candidateB],
  ]) {
    assert.match(job, /Upload candidate [AB]/u, jobName);
    assert.doesNotMatch(job, /npm (?:run check|test)|git worktree add/u, jobName);
  }

  assert.match(validation, /^    name: Validate frozen source \/ \$\{\{ matrix\.suite\.name \}\}$/mu);
  assert.match(validation, /^    needs: \[candidate-a, candidate-b\]$/mu);
  const strategyStart = validation.indexOf("    strategy:\n");
  const stepsStart = validation.indexOf("    steps:\n");
  assert.ok(strategyStart !== -1 && stepsStart > strategyStart);
  assert.equal(
    validation.slice(strategyStart, stepsStart).trimEnd(),
    [
      "    strategy:",
      "      fail-fast: false",
      "      matrix:",
      "        suite:",
      "          - name: core",
      "            release_test_shard: \"off\"",
      "          - name: release 1/4",
      "            release_test_shard: \"1/4\"",
      "          - name: release 2/4",
      "            release_test_shard: \"2/4\"",
      "          - name: release 3/4",
      "            release_test_shard: \"3/4\"",
      "          - name: release 4/4",
      "            release_test_shard: \"4/4\"",
    ].join("\n"),
  );
  assert.match(
    validation,
    /git worktree add --detach "\$RUNNER_TEMP\/release-source" "\$RELEASE_SOURCE_SHA"/u,
  );
  const coreValidationStep = workflowStepBlock(
    validation,
    "Run checks and non-release tests",
  );
  assert.match(
    coreValidationStep,
    /^      - name: Run checks and non-release tests\n        if: \$\{\{ matrix\.suite\.release_test_shard == 'off' \}\}/mu,
  );
  assert.match(
    coreValidationStep,
    /^          cd "\$RUNNER_TEMP\/release-source"\n          npm run check\n          npm test -- --test-concurrency=1 --test-reporter=dot$/mu,
  );
  assert.ok(validation.includes(`${releaseShardEnvironment}: "off"`));
  const releaseShardStep = workflowStepBlock(validation, "Run release pipeline shard");
  assert.match(
    releaseShardStep,
    /^      - name: Run release pipeline shard\n        if: \$\{\{ matrix\.suite\.release_test_shard != 'off' \}\}/mu,
  );
  assert.match(
    releaseShardStep,
    /^          cd "\$RUNNER_TEMP\/release-source"\n          node --test --test-reporter=dot test\/v2-release-pipeline\.test\.mjs$/mu,
  );
  const matrixShardExpression = "${{ matrix." + "suite" + ".release_test_shard }}";
  assert.ok(validation.includes(
    `${releaseShardEnvironment}: ${matrixShardExpression}`,
  ));
  assert.match(assemble, /^    needs: \[candidate-a, candidate-b, source-validation\]$/mu);
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
  assert.match(workflow, /plan:[\s\S]*candidate-a:[\s\S]*candidate-b:[\s\S]*source-validation:[\s\S]*assemble:[\s\S]*publication_plan:[\s\S]*publish:[\s\S]*verify:/u);
  assert.match(workflow, /publication_plan:[\s\S]*runs-on: ubuntu-slim/u);
  assert.match(workflow, /publish:[\s\S]*environment: marketplace-production/u);
  assert.ok(
    workflow.indexOf("Build credential-free publication plan") <
      workflow.indexOf("Explain privileged-boundary rejection") &&
      workflow.indexOf("Explain privileged-boundary rejection") <
        workflow.indexOf("environment: marketplace-production"),
  );
  assert.match(
    publisher,
    /\.write_eligible == true and \.recovery_code == null and \.reason == null[\s\S]*\.write_eligible == false[\s\S]*release-intent-superseded[\s\S]*publication-admission-invalid[\s\S]*publication is not eligible for the privileged boundary/u,
  );
  assert.ok(
      workflow.indexOf("Revalidate publication plan before minting credentials") <
      workflow.indexOf("Validate live release signing certificate before minting credentials") &&
      workflow.indexOf("Validate live release signing certificate before minting credentials") <
        workflow.indexOf("Determine frozen target workflow-transition permission") &&
      workflow.indexOf("Determine frozen target workflow-transition permission") <
        workflow.indexOf("Validate Publisher App static configuration before inventory") &&
      workflow.indexOf("Validate Publisher App static configuration before inventory") <
        workflow.indexOf("Create inventory-only Publisher App token") &&
      workflow.indexOf("Create inventory-only Publisher App token") <
        workflow.indexOf("Validate Publisher App identity and full installation scope") &&
      workflow.indexOf("Validate Publisher App identity and full installation scope") <
        workflow.indexOf("Create target-scoped publisher token") &&
      workflow.indexOf("Create target-scoped publisher token") <
        workflow.indexOf("Bind and validate target-scoped publisher token") &&
      workflow.indexOf("Bind and validate target-scoped publisher token") <
        workflow.indexOf("Configure target-scoped ephemeral Git authentication") &&
      workflow.indexOf("Configure target-scoped ephemeral Git authentication") <
        workflow.indexOf("Reconcile release publication"),
  );
  assert.match(workflow, /--verify-publication-plan[\s\S]*--publication-plan-file/u);
  assert.match(workflow, /--publish[\s\S]*--publication-plan-file/u);
  assert.doesNotMatch(workflow, /^\s*uses:\s*[^\s]+@(?:main|master|[0-9a-f]{40})/mu);
  for (const line of workflow.split("\n").filter((value) => /^\s*-?\s*uses:/u.test(value))) {
    assert.match(line, /@v[1-9][0-9]*$/u, line);
  }
  assert.match(
    workflow,
    /Security policy: allowlisted GitHub-owned Actions intentionally follow[\s\S]*Moving[\s\S]*to immutable SHAs requires Dependabot and a separate policy change[\s\S]*uses: actions\/create-github-app-token@v3/u,
  );

  assert.doesNotMatch(workflow, /GIT_ASKPASS:\s*\$\{\{\s*steps\.publisher-token/u);
  assert.doesNotMatch(workflow, /GIT_ASKPASS=.*>>\s*"\$GITHUB_ENV"/u);
  assert.match(workflow, /RELEASE_TARGET_ASKPASS: \$\{\{ runner\.temp \}\}\/release-target-askpass/u);
  assert.doesNotMatch(workflow, /gh api installation\s*>/u);
  const publishJob = workflowJobBlock(workflow, "publish");
  const workflowTransitionStep = workflowStepBlock(
    publishJob,
    "Determine frozen target workflow-transition permission",
  );
  const preInventoryConfigurationStep = workflowStepBlock(
    publishJob,
    "Validate Publisher App static configuration before inventory",
  );
  const inventoryTokenStep = workflowStepBlock(
    publishJob,
    "Create inventory-only Publisher App token",
  );
  const identityStep = workflowStepBlock(
    publishJob,
    "Validate Publisher App identity and full installation scope",
  );
  const scopedTokenStep = workflowStepBlock(
    publishJob,
    "Create target-scoped publisher token",
  );
  const bindingStep = workflowStepBlock(
    publishJob,
    "Bind and validate target-scoped publisher token",
  );
  const configureAuthenticationStep = workflowStepBlock(
    publishJob,
    "Configure target-scoped ephemeral Git authentication",
  );
  const reconcileStep = workflowStepBlock(publishJob, "Reconcile release publication");
  const cleanupStep = workflowStepBlock(publishJob, "Remove ephemeral local credentials");
  const recoveryStep = workflowStepBlock(publishJob, "Explain publication recovery");

  assert.match(workflowTransitionStep, /id: publisher-workflow-transition/u);
  assert.match(workflowTransitionStep, /candidate_json="\$RUNNER_TEMP\/release-candidate\/candidate\.json"/u);
  assert.match(workflowTransitionStep, /baseline="docs\/release\/action-v2-repository-baselines\.json"/u);
  assert.match(workflowTransitionStep, /jq -er '\.plan\.target_master_before \| strings' "\$candidate_json"/u);
  assert.match(workflowTransitionStep, /jq -er '\.initial_target_master \| strings' "\$baseline"/u);
  assert.doesNotMatch(workflowTransitionStep, /publication_plan="\$RUNNER_TEMP\/publication-plan\.json"/u);
  assert.doesNotMatch(workflowTransitionStep, /jq -er '\.target_master_before'/u);
  assert.match(workflowTransitionStep, /assembled candidate has no valid frozen target master/u);
  assert.match(workflowTransitionStep, /repository baseline has no valid initial target master/u);
  assert.match(workflowTransitionStep, /requires_workflows_write=true/u);
  assert.match(workflowTransitionStep, /requires_workflows_write=false/u);
  assert.match(workflowTransitionStep, /target commit identities must be full SHA-1 values/u);
  assert.match(preInventoryConfigurationStep, /APP_OWNER: \$\{\{ vars\.RELEASE_PUBLISHER_APP_OWNER \}\}/u);
  assert.match(preInventoryConfigurationStep, /APP_SLUG: \$\{\{ vars\.RELEASE_PUBLISHER_APP_SLUG \}\}/u);
  assert.match(preInventoryConfigurationStep, /static configuration check passed before inventory token minting/u);
  assert.doesNotMatch(preInventoryConfigurationStep, /(?:PRIVATE_KEY|TOKEN|GITHUB_ENV|GITHUB_OUTPUT|GITHUB_STEP_SUMMARY)/u);
  assert.match(inventoryTokenStep, /id: publisher-inventory-token/u);
  assert.match(inventoryTokenStep, /uses: actions\/create-github-app-token@v3/u);
  assert.match(inventoryTokenStep, /owner: JoeyTeng/u);
  assert.match(inventoryTokenStep, /permission-metadata: read/u);
  assert.match(inventoryTokenStep, /skip-token-revoke: false/u);
  assert.doesNotMatch(inventoryTokenStep, /^          repositories:/mu);
  assert.deepEqual(
    [...inventoryTokenStep.matchAll(/^          (permission-[^:]+): (\S+)$/gmu)]
      .map((match) => [match[1], match[2]]),
    [["permission-metadata", "read"]],
  );
  assert.match(scopedTokenStep, /id: publisher-token/u);
  assert.match(scopedTokenStep, /uses: actions\/create-github-app-token@v3/u);
  assert.match(scopedTokenStep, /owner: JoeyTeng/u);
  assert.match(scopedTokenStep, /repositories: codex-review-gate-action/u);
  assert.match(scopedTokenStep, /skip-token-revoke: false/u);
  assert.deepEqual(
    [...scopedTokenStep.matchAll(/^          (permission-[^:]+): (\S+)$/gmu)]
      .map((match) => [match[1], match[2]]),
    [
      ["permission-administration", "read"],
      ["permission-contents", "write"],
      ["permission-metadata", "read"],
    ],
  );
  assert.match(
    scopedTokenStep,
    /permission-workflows: \$\{\{ steps\.publisher-workflow-transition\.outputs\.requires_workflows_write == 'true' && 'write' \|\| '' \}\}/u,
  );
  assert.doesNotMatch(scopedTokenStep, /^          permission-workflows: write$/mu);

  assert.match(identityStep, /ACTUAL_APP_SLUG: \$\{\{ steps\.publisher-inventory-token\.outputs\.app-slug \}\}/u);
  assert.match(identityStep, /ACTUAL_INSTALLATION_ID: \$\{\{ steps\.publisher-inventory-token\.outputs\.installation-id \}\}/u);
  assert.match(identityStep, /INVENTORY_INSTALLATION_TOKEN: \$\{\{ steps\.publisher-inventory-token\.outputs\.token \}\}/u);
  assert.match(identityStep, /PUBLISHER_WORKFLOW_TRANSITION: \$\{\{ steps\.publisher-workflow-transition\.outputs\.requires_workflows_write \}\}/u);
  assert.match(identityStep, /github-app-installation[\s\S]*--client-id "\$APP_CLIENT_ID"[\s\S]*--installation-id "\$ACTUAL_INSTALLATION_ID"[\s\S]*--output "\$installation_file"/u);
  assert.match(
    identityStep,
    /RELEASE_PUBLISHER_APP_PRIVATE_KEY="\$app_private_key"[\s\S]*github-app-installation/u,
  );
  assert.match(identityStep, /set \+x[\s\S]*set \+v[\s\S]*set \+a[\s\S]*app_private_key="\$APP_PRIVATE_KEY"/u);
  assert.match(identityStep, /Publisher App configuration invariant failed: expected owner JoeyTeng\./u);
  assert.match(identityStep, /Publisher App configuration invariant failed: expected canonical publisher slug\./u);
  assert.match(identityStep, /Publisher App token invariant failed: token app slug does not match the configured publisher slug\./u);
  assert.match(identityStep, /Publisher App token invariant failed: token output has no valid installation ID\./u);
  assert.match(identityStep, /Publisher App static configuration and token-output checks passed\./u);
  assert.match(identityStep, /Publisher App installation fetch starting\./u);
  assert.match(identityStep, /Publisher App installation fetch completed\./u);
  assert.match(identityStep, /Publisher App installation observed \(non-secret\): \$observed_installation/u);
  assert.match(identityStep, /Publisher App installation invariant failed; inspect the non-secret observed identity above\./u);
  assert.match(identityStep, /Publisher App installation metadata check passed\./u);
  assert.match(identityStep, /installation_id_matches_token_output: \(\.id == \$installation_id\)/u);
  assert.match(identityStep, /permission_workflows: permission_value\("workflows"\),/u);
  assert.match(identityStep, /workflow_transition_requires_write: \(\$requires_workflows_write == "true"\),/u);
  assert.match(identityStep, /permission_shape_matches_expected: \(\.permissions == \$expected_permissions\)/u);
  assert.match(identityStep, /case "\$PUBLISHER_WORKFLOW_TRANSITION" in/u);
  assert.match(identityStep, /expected_permissions='\{"administration":"read","contents":"write","metadata":"read","workflows":"write"\}'/u);
  assert.match(identityStep, /expected_permissions='\{"administration":"read","contents":"write","metadata":"read"\}'/u);
  assert.match(identityStep, /--argjson expected_permissions "\$expected_permissions"/u);
  assert.match(identityStep, /Publisher App non-transition policy expects no Workflows permission after completed RC readback\./u);
  assert.match(identityStep, /suspension_state:/u);
  assert.match(identityStep, /has\("suspended_at"\) and \.suspended_at == null/u);
  assert.doesNotMatch(identityStep, /suspended:\s*\(\.suspended_at != null\)/u);
  assert.doesNotMatch(identityStep, /permission_keys:|events: \(if/u);
  assert.match(identityStep, /Publisher App repository scope query starting\./u);
  assert.match(
    identityStep,
    /github-app-installation-repository-scope[\s\S]*--expected-repository-id 1239944216[\s\S]*--expected-repository "JoeyTeng\/codex-review-gate-action"[\s\S]*--output "\$repository_scope_file"/u,
  );
  assert.match(identityStep, /RELEASE_PUBLISHER_APP_INSTALLATION_TOKEN="\$inventory_installation_token"/u);
  assert.match(identityStep, /keys == \[[\s\S]*"returned_count"[\s\S]*"target_full_name_matches_expected"[\s\S]*"target_id_matches_expected"[\s\S]*"target_shape_matches_expected"[\s\S]*"total_count"[\s\S]*\]/u);
  assert.match(identityStep, /\.total_count == 1[\s\S]*\.returned_count == 1[\s\S]*\.target_shape_matches_expected == true[\s\S]*\.target_id_matches_expected == true[\s\S]*\.target_full_name_matches_expected == true/u);
  assert.doesNotMatch(identityStep, /\.repositories\b/u);
  assert.match(identityStep, /Publisher App repository scope observed \(non-secret\): \$observed_repository_scope/u);
  assert.match(identityStep, /Publisher App repository scope query completed\./u);
  assert.match(identityStep, /Publisher App repository scope invariant failed; inspect the non-secret observed scope above\./u);
  assert.match(identityStep, /Publisher App repository scope check passed\./u);
  assertPublisherRepositoryScopeGuardFailsClosed(identityStep);

  assert.match(bindingStep, /SCOPED_APP_SLUG: \$\{\{ steps\.publisher-token\.outputs\.app-slug \}\}/u);
  assert.match(bindingStep, /SCOPED_INSTALLATION_ID: \$\{\{ steps\.publisher-token\.outputs\.installation-id \}\}/u);
  assert.match(bindingStep, /SCOPED_INSTALLATION_TOKEN: \$\{\{ steps\.publisher-token\.outputs\.token \}\}/u);
  assert.match(bindingStep, /INVENTORY_APP_SLUG: \$\{\{ steps\.publisher-inventory-token\.outputs\.app-slug \}\}/u);
  assert.match(bindingStep, /INVENTORY_INSTALLATION_ID: \$\{\{ steps\.publisher-inventory-token\.outputs\.installation-id \}\}/u);
  assert.match(bindingStep, /scoped token app slug does not match the configured publisher slug/u);
  assert.match(bindingStep, /scoped token app slug does not match the inventory token/u);
  assert.match(bindingStep, /scoped token installation ID does not match the inventory token/u);
  assert.match(bindingStep, /Publisher App scoped-token binding check passed\./u);
  const bindingLines = bindingStep.split("\n");
  const scopedTokenCapture = bindingLines.findIndex((line) =>
    line.includes('scoped_installation_token="$SCOPED_INSTALLATION_TOKEN"'));
  assert.ok(scopedTokenCapture > 0, "binding step must capture the target-scoped token locally");
  for (const command of ["set +x", "set +v", "set +a"]) {
    const commandIndex = bindingLines.findIndex((line) => line.trim() === command);
    assert.ok(commandIndex >= 0 && commandIndex < scopedTokenCapture, `${command} must precede scoped-token capture`);
  }
  assert.match(bindingStep, /unset SCOPED_INSTALLATION_TOKEN/u);
  assert.match(bindingStep, /RELEASE_PUBLISHER_APP_INSTALLATION_TOKEN="\$scoped_installation_token"/u);
  assert.match(
    bindingStep,
    /github-app-installation-repository-scope[\s\S]*--expected-repository-id 1239944216[\s\S]*--expected-repository "JoeyTeng\/codex-review-gate-action"[\s\S]*--output "\$scoped_repository_scope_file"/u,
  );
  assert.match(bindingStep, /unset scoped_installation_token/u);
  assert.match(bindingStep, /Publisher App target-scoped repository scope observed \(non-secret\): \$observed_scoped_repository_scope/u);
  assert.match(bindingStep, /keys == \[[\s\S]*"returned_count"[\s\S]*"target_full_name_matches_expected"[\s\S]*"target_id_matches_expected"[\s\S]*"target_shape_matches_expected"[\s\S]*"total_count"[\s\S]*\]/u);
  assert.match(bindingStep, /\.total_count == 1[\s\S]*\.returned_count == 1[\s\S]*\.target_shape_matches_expected == true[\s\S]*\.target_id_matches_expected == true[\s\S]*\.target_full_name_matches_expected == true/u);
  assert.doesNotMatch(bindingStep, /\.repositories\b|\.full_name\b|temp_clone_token/u);
  assert.match(bindingStep, /Publisher App target-scoped repository scope invariant failed; inspect the non-secret observed scope above\./u);
  assert.match(bindingStep, /Publisher App target-scoped repository scope check passed\./u);
  assert.doesNotMatch(bindingStep, /^\s*continue-on-error:/mu);
  assertPublisherBindingAndWriterScopeFailClosed(bindingStep);
  assert.match(configureAuthenticationStep, /release-target-askpass/u);
  assert.match(reconcileStep, /RELEASE_PUBLISHER_TOKEN: \$\{\{ steps\.publisher-token\.outputs\.token \}\}/u);
  assert.doesNotMatch(
    reconcileStep,
    /(?:INVENTORY_INSTALLATION_TOKEN|SCOPED_INSTALLATION_TOKEN|RELEASE_PUBLISHER_APP_INSTALLATION_TOKEN)/u,
  );

  // The secret-bearing steps do not reference workflow output, environment, or
  // summary sinks at all. This catches both direct and local-variable writes.
  const secretBearingPublisherSteps = [
    inventoryTokenStep,
    identityStep,
    scopedTokenStep,
    bindingStep,
  ].join("\n");
  assert.doesNotMatch(secretBearingPublisherSteps, /\bGITHUB_(?:ENV|OUTPUT|STEP_SUMMARY)\b/u);
  const publishSinkLines = publishJob
    .split("\n")
    .filter((line) => /\bGITHUB_(?:ENV|OUTPUT|STEP_SUMMARY)\b/u.test(line))
    .map((line) => line.trim());
  assert.deepEqual(publishSinkLines, [
    "printf '%s\\n' 'requires_workflows_write=true' >> \"$GITHUB_OUTPUT\"",
    "printf '%s\\n' 'requires_workflows_write=false' >> \"$GITHUB_OUTPUT\"",
    "printf 'GNUPGHOME=%s\\n' \"$signing_home\" >> \"$GITHUB_ENV\"",
    "cat >> \"$GITHUB_STEP_SUMMARY\" <<'SUMMARY'",
  ]);
  assert.doesNotMatch(
    recoveryStep,
    /(?:APP_PRIVATE_KEY|INVENTORY_INSTALLATION_TOKEN|SCOPED_INSTALLATION_TOKEN|RELEASE_PUBLISHER_APP_PRIVATE_KEY|RELEASE_PUBLISHER_APP_INSTALLATION_TOKEN|app_private_key|inventory_installation_token|scoped_installation_token)/u,
  );
  assert.match(cleanupStep, /rm -f -- "\$RUNNER_TEMP\/publisher-installation\.json"/u);
  assert.match(cleanupStep, /rm -f -- "\$RUNNER_TEMP\/publisher-installation-repositories\.json"/u);
  assert.match(cleanupStep, /rm -f -- "\$RUNNER_TEMP\/publisher-target-installation-repositories\.json"/u);
  assert.match(workflow, /If the first failed step is `Validate Publisher App identity and[\s\S]*full installation scope` or `Bind and validate target-scoped[\s\S]*publisher token`/u);
  assert.match(recoveryStep, /scoped-token-binding, and target-token-scope/u);
  assert.match(workflow, /Inspect `reconcile_state` and `recovery_code` only when `Reconcile[\s\S]*release publication` started\./u);
  assert.doesNotMatch(workflow, /Inspect the first failure, `reconcile_state`, and `recovery_code`\./u);
  assert.doesNotMatch(workflow, /GH_TOKEN="\$app_jwt"|Authorization:\s*token/u);
  assert.doesNotMatch(workflow, /RELEASE_PUBLISHER_APP_INSTALLATION_TOKEN.*GITHUB_ENV/u);
  assert.doesNotMatch(workflow, /(?:APP_PRIVATE_KEY|app_jwt).*GITHUB_ENV/u);
  assert.match(workflow, /RELEASE_PUBLISHER_TOKEN: \$\{\{ steps\.publisher-token\.outputs\.token \}\}/u);
  assert.doesNotMatch(workflow, /^\s+(?:GH_TOKEN|PUBLISHER_TOKEN): \$\{\{ steps\.publisher-token\.outputs\.token \}\}/mu);
  assert.match(workflow, /Username for 'https:\/\/github\.com\/JoeyTeng\/codex-review-gate-action\.git'/u);
  assert.match(workflow, /Password for 'https:\/\/x-access-token@github\.com\/JoeyTeng\/codex-review-gate-action\.git'/u);
  assert.match(
    publisher,
    /set \+x[\s\S]*set \+v[\s\S]*set \+a[\s\S]*release_target_askpass="\$\{RELEASE_TARGET_ASKPASS:-\}"[\s\S]*export -n publisher_token release_target_askpass[\s\S]*unset GH_HOST GH_ENTERPRISE_TOKEN GITHUB_ENTERPRISE_TOKEN[\s\S]*unset RELEASE_TARGET_ASKPASS GIT_ASKPASS SSH_ASKPASS[\s\S]*readonly publisher_token release_target_askpass/u,
  );
  assert.match(
    publisher,
    /publisher_gh\(\) \{[\s\S]{0,240}env -u GITHUB_TOKEN -u PUBLISHER_TOKEN -u RELEASE_PUBLISHER_TOKEN[\s\\]*-u GH_ENTERPRISE_TOKEN -u GITHUB_ENTERPRISE_TOKEN[\s\\]*GH_HOST=github\.com GH_TOKEN="\$publisher_token" gh "\$@"[\s\S]{0,20}\}/u,
  );
  assert.match(
    workflow,
    /live_master_sha="\$\(env -u GH_ENTERPRISE_TOKEN -u GITHUB_ENTERPRISE_TOKEN[\s\\]*GH_HOST=github\.com gh api --hostname github\.com/u,
  );
  for (const line of workflow.split("\n").filter((value) =>
    /\bgh api\b/u.test(value) && !value.trimStart().startsWith("#")
  )) {
    assert.match(line, /gh api --hostname github\.com\b/u, line);
  }
  assert.equal(
    (workflow.match(/\bgh api --hostname github\.com\b/gu) ?? []).length,
    3,
    "every direct workflow gh API call must bind github.com explicitly",
  );
  assert.doesNotMatch(
    publisher,
    /^\s*(?!publisher_gh\b).*\bgh (?:api|release)\b/mu,
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
  assert.match(
    publisher,
    /require_immutable_release_policy\(\)[\s\S]*X-GitHub-Api-Version: 2026-03-10[\s\S]*immutable-releases[\s\S]*\(\.enabled \| type == "boolean"\)[\s\S]*\.enabled == true[\s\S]*\(\.enforced_by_owner \| type == "boolean"\)/u,
  );
  assert.match(
    publisher,
    /require_publication_mutation\(\)[\s\S]*require_immutable_release_policy first-mutation[\s\S]*verify_final_policy_fence "before-\$mutation_class"/u,
  );
  assert.match(
    publisher,
    /verify_live_release_signer_policy\(\)[\s\S]*is_test_environment && \[\[ "\$enforce_live_signer_policy_in_test" != true \]\][\s\S]*publisher_gh api users\/JoeyTeng-Codex\/gpg_keys[\s\S]*verify-github-signing-key[\s\S]*cmp -s -- "\$approved_public_key" "\$live_public_key"/u,
  );
  assert.match(
    publisher,
    /--test-enforce-live-signer-policy\)[\s\S]*require_test_environment[\s\S]*enforce_live_signer_policy_in_test=true[\s\S]*"\$mode" == "publish"[\s\S]*-z "\$test_release_dir"/u,
  );
  assert.match(
    publisher,
    /verify_final_policy_fence\(\)[\s\S]*preflight_live_source[\s\S]*verify_ruleset_policy_snapshot "\$label"[\s\S]*verify_live_release_signer_policy "\$label"/u,
  );
  const remoteTagReadStart = publisher.indexOf("  read_remote_full_tag_snapshot() {");
  const remoteTagReadEnd = publisher.indexOf(
    "\n  validate_remote_full_tag_snapshot() {",
    remoteTagReadStart,
  );
  assert.notEqual(remoteTagReadStart, -1, "missing remote full-tag snapshot reader");
  assert.notEqual(remoteTagReadEnd, -1, "missing remote full-tag snapshot reader end");
  const remoteTagRead = publisher.slice(remoteTagReadStart, remoteTagReadEnd);
  const tagLsRemote = remoteTagRead.indexOf("target_git ls-remote");
  const tagPostprocessGuard = remoteTagRead.indexOf("if ! printf '%s\\n'", tagLsRemote);
  const tagStripBlank = remoteTagRead.indexOf("| sed '/^$/d'", tagPostprocessGuard);
  const tagSort = remoteTagRead.indexOf("| LC_ALL=C sort", tagStripBlank);
  const tagPostprocessGuardEnd = remoteTagRead.indexOf("; then", tagSort);
  const tagUnreadable = remoteTagRead.indexOf(
    'return "$RELEASE_BOUNDARY_REMOTE_UNREADABLE"',
    tagPostprocessGuardEnd,
  );
  assert.ok(
    tagLsRemote !== -1 &&
      tagLsRemote < tagPostprocessGuard &&
      tagPostprocessGuard < tagStripBlank &&
      tagStripBlank < tagSort &&
      tagSort < tagPostprocessGuardEnd &&
      tagPostprocessGuardEnd < tagUnreadable,
    "tag-snapshot post-processing failures must map to the unreadable boundary status",
  );
  assert.match(
    publisher,
    /fail_release_boundary_capture\(\)[\s\S]*RELEASE_BOUNDARY_REMOTE_UNREADABLE[\s\S]*fail_reconcile inconclusive remote-read-inconclusive/u,
  );
  const boundaryCaptureStart = publisher.indexOf("  capture_release_boundary() {");
  const boundaryCaptureEnd = publisher.indexOf(
    "\n  fail_release_boundary_capture() {",
    boundaryCaptureStart,
  );
  assert.notEqual(boundaryCaptureStart, -1, "missing Release boundary capture helper");
  assert.notEqual(boundaryCaptureEnd, -1, "missing Release boundary capture helper end");
  const boundaryCapture = publisher.slice(boundaryCaptureStart, boundaryCaptureEnd);
  const firstRawRelease = boundaryCapture.indexOf("> \"$first_api\"");
  const firstRawTag = boundaryCapture.indexOf("read_remote_full_tag_snapshot", firstRawRelease);
  const secondRawRelease = boundaryCapture.indexOf("> \"$second_api\"");
  const secondRawTag = boundaryCapture.indexOf("read_remote_full_tag_snapshot", secondRawRelease);
  const firstCanonicalRelease = boundaryCapture.indexOf(
    'first_raw="$(snapshot_neutral_release_api',
  );
  const secondCanonicalRelease = boundaryCapture.indexOf(
    'second_raw="$(snapshot_neutral_release_api',
  );
  const rawStability = boundaryCapture.indexOf(
    '[[ "$first_raw" == "$second_raw" && "$first_tag_raw" == "$second_tag_raw" ]]',
  );
  const releasePolicyValidation = boundaryCapture.indexOf("snapshot-release-boundary");
  const tagPolicyValidation = boundaryCapture.indexOf("validate_remote_full_tag_snapshot");
  assert.ok(
    firstRawRelease !== -1 &&
      firstRawRelease < firstRawTag &&
      firstRawTag < secondRawRelease &&
      secondRawRelease < secondRawTag &&
      secondRawTag < firstCanonicalRelease &&
      firstCanonicalRelease < secondCanonicalRelease &&
      secondCanonicalRelease < rawStability &&
      rawStability < releasePolicyValidation &&
      releasePolicyValidation < tagPolicyValidation,
    "both complete Release/tag snapshots must be neutralized and compared before policy validation",
  );
  const absentBoundaryStart = publisher.indexOf("  capture_inventory_release_boundary() {");
  const absentBoundaryEnd = publisher.indexOf("\n  read_latest_release_tag() {", absentBoundaryStart);
  assert.notEqual(absentBoundaryStart, -1, "missing absent Release boundary helper");
  assert.notEqual(absentBoundaryEnd, -1, "missing absent Release boundary helper end");
  const absentBoundary = publisher.slice(absentBoundaryStart, absentBoundaryEnd);
  const firstPresence = absentBoundary.indexOf(
    'fetch_complete_release_inventory "$first_api" "$first_error"',
  );
  const firstAbsentTag = absentBoundary.indexOf(
    'first_tag_raw="$(read_remote_full_tag_snapshot)',
  );
  const secondPresence = absentBoundary.indexOf(
    'fetch_complete_release_inventory "$second_api" "$second_error"',
  );
  const secondAbsentTag = absentBoundary.indexOf(
    'second_tag_raw="$(read_remote_full_tag_snapshot)',
  );
  const absentRawStability = absentBoundary.indexOf(
    '[[ "$first_raw" == "$second_raw" && "$first_tag_raw" == "$second_tag_raw" ]]',
  );
  const stableAbsencePolicy = absentBoundary.indexOf(
    '[[ "$exact_state" == "absent" ]]',
  );
  const absentTagPolicy = absentBoundary.indexOf(
    'validate_remote_full_tag_snapshot "$second_tag_raw"',
  );
  assert.ok(
    firstPresence !== -1 &&
      firstPresence < firstAbsentTag &&
      firstAbsentTag < secondPresence &&
      secondPresence < secondAbsentTag &&
      secondAbsentTag < absentRawStability &&
      absentRawStability < absentTagPolicy &&
      absentTagPolicy < stableAbsencePolicy,
    "complete inventory and full-tag raw A/B reads must finish before exact-tag absence validation",
  );
  assert.match(
    boundaryCapture,
    /repos\/\$TARGET_REPOSITORY\/releases\/\$frozen_release_id[\s\S]*\.id == \$release_id/u,
    "all post-discovery Release boundaries must read and validate the frozen numeric id",
  );
  assert.doesNotMatch(
    publisher.slice(publisher.indexOf("reconcile_github_release() {")),
    /publisher_gh release upload/u,
    "asset upload must not re-resolve a mutable tag name",
  );
  assert.match(
    publisher.slice(publisher.indexOf("reconcile_github_release() {")),
    /https:\/\/uploads\.github\.com\/repos\/\$TARGET_REPOSITORY\/releases\/\$frozen_release_id\/assets\?name=\$encoded_name[\s\S]*--method POST[\s\S]*Content-Type: application\/octet-stream[\s\S]*--input "\$asset"/u,
    "asset upload must bind the frozen numeric Release id and raw asset input",
  );
  assert.match(
    publisher.slice(publisher.indexOf("reconcile_github_release() {")),
    /\.name == \$name and \.state == "uploaded"[\s\S]*9007199254740991/u,
    "asset upload must validate the returned asset identity and state",
  );
  assert.match(
    publisher,
    /read_public_release_view\(\)[\s\S]*X-GitHub-Api-Version: 2026-03-10[\s\S]*releases\/tags\/\$tag/u,
    "published public verification must pin the GitHub REST API version",
  );
  const githubReconcileStart = publisher.indexOf("reconcile_github_release() {");
  const githubReconcileEnd = publisher.indexOf(
    '\n}\n\nif [[ -n "$test_release_dir" ]]',
    githubReconcileStart,
  );
  assert.notEqual(githubReconcileStart, -1, "missing GitHub Release reconcile helper");
  assert.notEqual(githubReconcileEnd, -1, "missing GitHub Release reconcile helper end");
  const githubReconcile = publisher.slice(githubReconcileStart, githubReconcileEnd);
  const missingAssetUploadStart = githubReconcile.indexOf(
    'if [[ "${#missing_assets[@]}" -gt 0 ]]; then',
  );
  const missingAssetUploadEnd = githubReconcile.indexOf(
    '  asset_names="$(printf',
    missingAssetUploadStart,
  );
  const missingAssetUpload = githubReconcile.slice(
    missingAssetUploadStart,
    missingAssetUploadEnd,
  );
  assert.doesNotMatch(
    missingAssetUpload,
    /publisher_gh release download/u,
    "post-upload readback must not resolve a Release by tag",
  );
  assert.match(
    missingAssetUpload,
    /capture_release_boundary "after-upload-\$name"[\s\S]*Accept: application\/octet-stream[\s\S]*releases\/assets\/\$uploaded_asset_id[\s\S]*cmp -- "\$asset" "\$asset_readback"/u,
    "post-upload readback must validate the frozen by-ID boundary before raw asset-ID bytes",
  );
  assert.doesNotMatch(
    githubReconcile,
    /publisher_gh release view[\s\S]*HTTP\[\[:space:\]\]404/u,
    "fresh Release absence must be established through the API boundary, not porcelain stderr",
  );
  const publicationStart = publisher.indexOf(
    'if [[ "$current_draft" == "true" ]]; then\n    require_publication_mutation release-completion',
  );
  const publicationEnd = publisher.indexOf("  post_publish_release_api=", publicationStart);
  assert.notEqual(publicationStart, -1, "missing draft publication branch");
  assert.notEqual(publicationEnd, -1, "missing post-publication readback");
  const publication = publisher.slice(publicationStart, publicationEnd);
  const mutationFence = publication.indexOf("require_publication_mutation release-completion");
  const immutablePolicy = publication.indexOf("require_immutable_release_policy release-publication");
  const finalPolicy = publication.indexOf("verify_final_policy_fence before-release-publication");
  const finalBoundary = publication.indexOf(
    "capture_release_boundary pre-publication-mutation true false",
  );
  const finalBoundaryGuard = publication.indexOf(
    '[[ "$before_boundary" == "$current_boundary" ]] || {',
    finalBoundary,
  );
  const finalBoundaryEndMarker = "\n    }\n    release_id=";
  const finalBoundaryEnd = publication.indexOf(finalBoundaryEndMarker, finalBoundaryGuard);
  const frozenReleaseId = publication.indexOf("release_id=", finalBoundary);
  const payload = publication.indexOf("publication_payload=", frozenReleaseId);
  const directPatch = publication.indexOf("publisher_gh api", payload);
  assert.ok(
    mutationFence < immutablePolicy &&
      immutablePolicy < finalPolicy &&
      finalPolicy < finalBoundary &&
      finalBoundary < finalBoundaryGuard &&
      finalBoundaryGuard < finalBoundaryEnd &&
      finalBoundaryEnd < frozenReleaseId &&
      frozenReleaseId < payload &&
      payload < directPatch,
    "all live policy reads must finish before the final exact boundary and direct PATCH",
  );
  assert.match(
    publication,
    /\.release\.id \| select\(type == "number" and floor == \. and \. > 0\)[\s\S]*jq -cS -n[\s\S]*\{tag_name:\$tag_name,name:\$name,body:\$body,draft:false,prerelease:\$prerelease,make_latest:\$make_latest\}[\s\S]*publisher_gh api[\s\\]*--method PATCH[\s\\]*--header 'X-GitHub-Api-Version: 2026-03-10'[\s\\]*"repos\/\$TARGET_REPOSITORY\/releases\/\$release_id"[\s\\]*--input "\$publication_payload"/u,
  );
  const localOnlyAfterFinalBoundary = publication.slice(
    finalBoundaryEnd + "\n    }\n".length,
    directPatch,
  );
  const shellFunctions = [...publisher.matchAll(
    /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)\(\)[ \t]+\{/gmu,
  )]
    .map((match) => match[1])
    .filter((name) => name !== "fail_reconcile");
  for (const requiredFunction of [
    "publisher_gh",
    "capture_release_boundary",
    "read_remote_full_tag_snapshot",
  ]) {
    assert.ok(
      shellFunctions.includes(requiredFunction),
      `the no-remote-after-final-fence check must include ${requiredFunction}`,
    );
  }
  for (const remoteCapableWrapper of shellFunctions) {
    assert.doesNotMatch(
      localOnlyAfterFinalBoundary,
      new RegExp(`\\b${remoteCapableWrapper}\\b`, "u"),
      `${remoteCapableWrapper} must not run after the final boundary and before PATCH`,
    );
  }
  const networkCommands = ["gh", "curl", "wget", "ssh", "scp", "rsync", "nc"];
  for (const networkCommand of networkCommands) {
    assert.doesNotMatch(
      localOnlyAfterFinalBoundary,
      new RegExp(`(?:^|[;&|()\\s])(?:command\\s+)?${networkCommand}(?:\\s|$)`, "u"),
      `${networkCommand} must not run after the final boundary and before PATCH`,
    );
  }
  assert.doesNotMatch(publisher, /\brelease edit\b/u);
  assert.match(publisher.slice(publicationEnd), /\.draft == false and \.immutable == true/u);
  const aliasMutationStart = publisher.indexOf("    require_publication_mutation alias\n");
  const aliasImmutablePolicy = publisher.indexOf(
    "    require_immutable_release_policy alias-mutation\n",
    aliasMutationStart,
  );
  const aliasFinalBoundary = publisher.indexOf(
    "capture_release_boundary pre-alias-mutation false true",
    aliasImmutablePolicy,
  );
  const aliasBoundaryComparison = publisher.indexOf(
    '[[ "$pre_alias_boundary" == "$final_confirm_boundary" ]] || {',
    aliasFinalBoundary,
  );
  const aliasBoundaryEndMarker = '\n    fi\n    if [[ "$alias_mode" == "force-with-lease" ]]';
  const aliasBoundaryEnd = publisher.indexOf(aliasBoundaryEndMarker, aliasBoundaryComparison);
  const aliasPush = publisher.indexOf("      target_git_push", aliasBoundaryEnd);
  assert.ok(
    aliasMutationStart !== -1 &&
      aliasMutationStart < aliasImmutablePolicy &&
      aliasImmutablePolicy < aliasFinalBoundary &&
      aliasFinalBoundary < aliasBoundaryComparison &&
      aliasBoundaryComparison < aliasBoundaryEnd &&
      aliasBoundaryEnd < aliasPush,
    "alias source/ruleset/signer and immutable-policy reads must precede the final Release boundary and push",
  );
  const localOnlyAfterAliasBoundary = publisher.slice(
    aliasBoundaryEnd + "\n    fi\n".length,
    aliasPush,
  );
  for (const remoteCapableWrapper of shellFunctions) {
    assert.doesNotMatch(
      localOnlyAfterAliasBoundary,
      new RegExp(`\\b${remoteCapableWrapper}\\b`, "u"),
      `${remoteCapableWrapper} must not run after the final alias boundary and before push`,
    );
  }
  for (const networkCommand of networkCommands) {
    assert.doesNotMatch(
      localOnlyAfterAliasBoundary,
      new RegExp(`(?:^|[;&|()\\s])(?:command\\s+)?${networkCommand}(?:\\s|$)`, "u"),
      `${networkCommand} must not run after the final alias boundary and before push`,
    );
  }
  const assertStableBoundaryMismatchBlocked = (startNeedle, endNeedle, label) => {
    const start = publisher.indexOf(startNeedle);
    const end = publisher.indexOf(endNeedle, start + startNeedle.length);
    assert.notEqual(start, -1, `missing ${label} boundary`);
    assert.notEqual(end, -1, `missing ${label} boundary end`);
    const mismatchPath = publisher.slice(start, end);
    assert.match(
      mismatchPath,
      /fail_reconcile blocked_conflict immutable-release-mismatch/u,
      `${label} stable frozen-boundary mismatch must block`,
    );
    assert.doesNotMatch(
      mismatchPath,
      /fail_reconcile inconclusive remote-state-changed/u,
      `${label} stable frozen-boundary mismatch must not be classified as torn reads`,
    );
  };
  assertStableBoundaryMismatchBlocked(
    'published_boundary="$(capture_release_boundary post-publish false true)"',
    'current_boundary="$published_boundary"',
    "published",
  );
  assertStableBoundaryMismatchBlocked(
    'final_boundary="$(capture_release_boundary final-immutable false true)"',
    'final_release_api="$temporary_root/current-release-final-immutable.json"',
    "final immutable",
  );
  assertStableBoundaryMismatchBlocked(
    'final_confirm_boundary="$(capture_release_boundary final-confirm false true)"',
    '\n}\n\nif [[ -n "$test_release_dir" ]]',
    "final confirmation",
  );
  assertStableBoundaryMismatchBlocked(
    'pre_alias_boundary="$(capture_release_boundary pre-alias-mutation false true)"',
    '\n    fi\n    if [[ "$alias_mode"',
    "pre-alias",
  );
  assertStableBoundaryMismatchBlocked(
    'post_alias_boundary="$(capture_release_boundary post-alias false true)"',
    '\n  fi\n  if ! is_test_environment',
    "post-alias",
  );
  const aliasReadbackStart = publisher.indexOf(
    'alias_raw_after_a="$(read_remote_alias_snapshot)"',
  );
  const aliasReadbackEnd = publisher.indexOf(
    'remote_alias_object="$planned_alias_object"',
    aliasReadbackStart,
  );
  assert.notEqual(aliasReadbackStart, -1, "missing alias raw readback A");
  assert.notEqual(aliasReadbackEnd, -1, "missing alias readback classification end");
  const aliasReadback = publisher.slice(aliasReadbackStart, aliasReadbackEnd);
  assert.match(
    aliasReadback,
    /alias_raw_after_b[\s\S]*"\$alias_raw_after_a" == "\$alias_raw_after_b"[\s\S]*fail_reconcile inconclusive remote-state-changed/u,
  );
  assert.match(
    aliasReadback,
    /validate_remote_alias_snapshot "\$alias_raw_after_b"[\s\S]*fail_reconcile blocked_conflict malformed-major-alias-target[\s\S]*"\$alias_boundary_after" == "\$planned_alias_object"[\s\S]*fail_reconcile blocked_conflict malformed-major-alias-target/u,
  );
  assert.match(
    publisher,
    /read_remote_alias_snapshot\(\)[\s\S]*target_git ls-remote[\s\S]*return "\$RELEASE_BOUNDARY_REMOTE_UNREADABLE"[\s\S]*validate_remote_alias_snapshot\(\)/u,
  );
  const aliasValidatorStart = publisher.indexOf("  validate_remote_alias_snapshot() {");
  const aliasValidatorEnd = publisher.indexOf(
    '\n  if [[ "$alias_needs_push" == true ]]',
    aliasValidatorStart,
  );
  assert.notEqual(aliasValidatorStart, -1, "missing alias snapshot validator");
  assert.notEqual(aliasValidatorEnd, -1, "missing alias snapshot validator end");
  const aliasValidator = publisher.slice(aliasValidatorStart, aliasValidatorEnd);
  assert.match(aliasValidator, /"\$object" =~ \^\[0-9a-f\]\{40\}\$/u);
  assert.match(aliasValidator, /"\$count" == "2" && -n "\$direct" && -n "\$peeled"/u);
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
  const finalPrewriteSigner = publisher.indexOf(
    "verify_live_release_signer_policy final-prewrite",
  );
  assert.ok(
    finalPrewriteSigner !== -1 &&
      finalPrewriteSigner < publisher.indexOf("target_git_push ", finalPrewriteSigner),
    "the live signer policy must be revalidated before the first target write",
  );
  assert.match(
    publisher,
    /capture_inventory_release_boundary[\s\S]*pre-create absent[\s\S]*post-create any[\s\S]*before-upload-[\s\S]*after-upload-[\s\S]*pre-publication-mutation[\s\S]*post-publish[\s\S]*pre-alias-mutation[\s\S]*post-alias/u,
  );
  assert.match(workflow, /outputs:[\s\S]*reconcile_state: \$\{\{ steps\.reconcile\.outputs\.reconcile_state \}\}[\s\S]*id: reconcile/u);
  assert.match(workflow, /verify:[\s\S]*if: \$\{\{ needs\.publish\.outputs\.reconcile_state != 'superseded' \}\}/u);
  assert.match(
    workflow,
    /id: public-verification[\s\S]*Summarize closed public verification[\s\S]*Observed source:[\s\S]*Recovery code:[\s\S]*Next action:/u,
  );
  assert.match(
    workflow,
    /tuple="\$STEP_OUTCOME:\$VERIFICATION_STATE:\$RECOVERY_CODE:\$NEXT_ACTION:\$VERIFICATION_STAGE"[\s\S]*success:verified:none:none:complete[\s\S]*summary_valid=false[\s\S]*\[\[ "\$summary_valid" == true \]\]/u,
  );
  assert.doesNotMatch(workflow, /publish-next-version/u);
});

test("malformed publish invocations still emit exactly one closed state and recovery code", (t) => {
  const state = fixture(t);
  for (const arguments_ of [
    ["--publish"],
    ["--publish", "--candidate"],
    ["--publish", "--unknown-publisher-option"],
    ["--publish", "--publish"],
    ["--publish", "--verify-published"],
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

  const fakeBin = join(state.root, "contradictory-admission-bin");
  const fakeNode = join(fakeBin, "node");
  mkdirSync(fakeBin);
  write(fakeNode, `#!/bin/sh
set -eu
if [ "\${2:-}" = publication-plan ]; then
  output=
  while [ "$#" -gt 0 ]; do
    if [ "$1" = --output ]; then
      shift
      output="$1"
    fi
    shift
  done
  [ -n "$output" ]
  printf '%s\n' "$FAKE_PLAN_JSON" > "$output"
  exit 0
fi
exec "$REAL_NODE" "$@"
`);
  chmodSync(fakeNode, 0o755);
  for (const [label, fakePlan] of [
    ["eligible-with-conflict", {
      write_eligible: true,
      recovery_code: "publisher-control-drift",
      reason: "contradictory",
    }],
    ["invalid-with-superseded", {
      write_eligible: "invalid",
      recovery_code: "release-intent-superseded",
      reason: "contradictory",
    }],
  ]) {
    const contradictoryOutput = join(state.root, `publication-plan-${label}.json`);
    const contradictory = invoke("bash", releaseArgs(
      state,
      "--publication-plan",
      "--source-ref",
      built.sourceCommit,
      "--control-ref",
      built.controlCommit,
      "--candidate",
      built.assembled,
      "--output",
      contradictoryOutput,
    ), {
      cwd: state.source,
      env: {
        FAKE_PLAN_JSON: JSON.stringify(fakePlan),
        PATH: `${fakeBin}:${executionEnv.PATH}`,
        REAL_NODE: process.execPath,
      },
    });
    assert.notEqual(contradictory.status, 0, label);
    assert.match(contradictory.stderr, /recovery_code=publication-admission-invalid/u);
  }
});

test("credential-free publication admission rejects non-superseded control drift", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state, { label: "admission-before-drift" });
  write(join(state.source, ".github", "workflows", "required-ci.yml"), "name: Drifted publisher control\n");
  const driftedMaster = commit(state.source, "Drift publisher controls before admission");
  const rejectedPlan = join(state.root, "publication-plan-control-drift.json");

  const result = invoke("bash", releaseArgs(
    state,
    "--publication-plan",
    "--source-ref",
    built.sourceCommit,
    "--control-ref",
    built.controlCommit,
    "--candidate",
    built.assembled,
    "--output",
    rejectedPlan,
  ), { cwd: state.source });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /recovery_code=publisher-control-drift/u);
  const plan = JSON.parse(readFileSync(rejectedPlan, "utf8"));
  assert.equal(plan.live_source_master, driftedMaster);
  assert.equal(plan.write_eligible, false);
  assert.equal(plan.recovery_code, "publisher-control-drift");
  assert.equal(git(state.target, ["rev-parse", "refs/heads/master"]), state.initialTarget);
  assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2.0.0"]));
});

test("fresh stable publication verifies the immutable Release and replaces a legacy target workflow", (t) => {
  const state = fixture(t, "2.0.0", { includeLegacyWorkflow: true });
  assert.equal(
    git(state.target, ["cat-file", "-t", `${state.initialTarget}:.github/workflows/codex-review-gate.yml`]),
    "blob",
  );
  const built = buildAssembledCandidate(state);
  const output = publishCandidate(state, built);
  assert.match(output, /reconcile_state=fresh/u);

  const releaseCommit = git(state.target, ["rev-parse", "refs/tags/v2.0.0^{}"]);
  assert.equal(git(state.target, ["rev-parse", "refs/heads/master"]), releaseCommit);
  assert.equal(git(state.target, ["rev-parse", "refs/tags/v2^{}"]), releaseCommit);
  assert.equal(git(state.target, ["show", "-s", "--format=%P", releaseCommit]), state.initialTarget);
  assert.equal(git(state.target, ["rev-parse", `${releaseCommit}^{tree}`]), git(state.source, ["rev-parse", `${state.sourceCommit}:packages/action`]));
  assert.throws(() =>
    git(state.target, [
      "cat-file",
      "-e",
      `${releaseCommit}:.github/workflows/codex-review-gate.yml`,
    ]));
  assert.deepEqual(releaseAssets(state, "v2.0.0"), [
    "codex-review-gate-action-v2.0.0.tar.gz",
    "immutable",
    "prerelease",
    "published",
    "release-provenance.json",
    "release-provenance.json.asc",
  ]);
});

test("public verification emits one closed recovery tuple for success and key failure states", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state, { label: "verify-closed-tuples" });
  publishCandidate(state, built);
  const fullObject = git(state.target, ["rev-parse", "refs/tags/v2.0.0"]);
  const aliasObject = git(state.target, ["rev-parse", "refs/tags/v2"]);

  const success = invokeVerifyPublished(state, built);
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /verification_state=verified/u);
  assert.match(success.stdout, /verification_stage=complete/u);
  assert.match(success.stdout, /recovery_code=none/u);
  assert.match(success.stdout, /next_action=none/u);

  git(state.target, ["update-ref", "-d", "refs/tags/v2"]);
  const missingAlias = invokeVerifyPublished(state, built);
  assert.notEqual(missingAlias.status, 0);
  assert.match(missingAlias.stderr, /verification_state=blocked_conflict/u);
  assert.match(missingAlias.stderr, /recovery_code=major-alias-missing/u);
  assert.match(missingAlias.stderr, /next_action=reconcile-exact-source/u);
  git(state.target, ["update-ref", "refs/tags/v2", aliasObject]);

  replaceAliasWithNestedTag(state, "v2", "v2.0.0");
  const malformedAlias = invokeVerifyPublished(state, built);
  assert.notEqual(malformedAlias.status, 0);
  assert.match(malformedAlias.stderr, /verification_state=blocked_conflict/u);
  assert.match(malformedAlias.stderr, /recovery_code=published-state-mismatch/u);
  assert.match(malformedAlias.stderr, /next_action=investigate-published-state/u);
  git(state.target, ["update-ref", "refs/tags/v2", aliasObject]);

  rmSync(join(state.releases, "v2.0.0", "immutable"));
  const mutableRelease = invokeVerifyPublished(state, built);
  assert.notEqual(mutableRelease.status, 0);
  assert.match(mutableRelease.stderr, /verification_state=blocked_conflict/u);
  assert.match(mutableRelease.stderr, /recovery_code=mutable-release/u);
  assert.match(
    mutableRelease.stderr,
    /next_action=repair-immutable-release-and-reconcile/u,
  );
  write(join(state.releases, "v2.0.0", "immutable"), "");

  git(state.target, ["update-ref", "-d", "refs/tags/v2.0.0"]);
  const missingFullTag = invokeVerifyPublished(state, built);
  assert.notEqual(missingFullTag.status, 0);
  assert.match(missingFullTag.stderr, /verification_state=blocked_conflict/u);
  assert.match(missingFullTag.stderr, /recovery_code=immutable-tag-missing/u);
  assert.match(missingFullTag.stderr, /next_action=reconcile-exact-source/u);
  git(state.target, ["update-ref", "refs/tags/v2.0.0", fullObject]);

  const fakeBin = join(state.root, "verify-unreadable-bin");
  const fakeGh = join(fakeBin, "gh");
  mkdirSync(fakeBin);
  write(fakeGh, "#!/bin/sh\necho 'simulated public API outage' >&2\nexit 1\n");
  chmodSync(fakeGh, 0o755);
  const unreadable = invokeVerifyPublished(state, built, {
    testRelease: false,
    env: { PATH: `${fakeBin}:${executionEnv.PATH}` },
  });
  assert.notEqual(unreadable.status, 0);
  assert.match(unreadable.stderr, /verification_state=inconclusive/u);
  assert.match(unreadable.stderr, /recovery_code=release-api-unreadable/u);
  assert.match(unreadable.stderr, /next_action=retry-public-verification/u);
});

test("public verification rejects a rolled-back alias behind the highest complete stable release", (t) => {
  const state = fixture(t);
  const old = buildAssembledCandidate(state, { label: "public-highest-stable-old" });
  publishCandidate(state, old);
  const oldCommit = git(state.target, ["rev-parse", "refs/tags/v2.0.0^{}"]);

  advanceIntent(state, "2.1.0", oldCommit, "2.0.0");
  const middle = buildAssembledCandidate(state, { label: "public-highest-stable-middle" });
  publishCandidate(state, middle);
  const middleCommit = git(state.target, ["rev-parse", "refs/tags/v2.1.0^{}"]);
  const middleAliasObject = git(state.target, ["rev-parse", "refs/tags/v2"]);

  advanceIntent(state, "2.2.0", middleCommit, "2.1.0");
  const highest = buildAssembledCandidate(state, { label: "public-highest-stable-highest" });
  publishCandidate(state, highest);
  const highestCommit = git(state.target, ["rev-parse", "refs/tags/v2.2.0^{}"]);
  git(state.target, ["update-ref", "refs/tags/v2", middleAliasObject]);

  const result = invokeVerifyPublished(state, old);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /verification_state=blocked_conflict/u);
  assert.match(result.stderr, /recovery_code=published-state-mismatch/u);
  assert.match(result.stderr, /highest complete stable release v2\.2\.0/u);
  assert.equal(git(state.target, ["rev-parse", "refs/heads/master"]), highestCommit);
  assert.equal(git(state.target, ["rev-parse", "refs/tags/v2^{}"]), middleCommit);
});

test("public verification requires a later alias Release to pass complete asset and provenance validation", (t) => {
  const state = fixture(t);
  const old = buildAssembledCandidate(state, { label: "public-strong-later-old" });
  publishCandidate(state, old);
  const oldCommit = git(state.target, ["rev-parse", "refs/tags/v2.0.0^{}"]);

  advanceIntent(state, "2.1.0", oldCommit, "2.0.0");
  const later = buildAssembledCandidate(state, { label: "public-strong-later-new" });
  publishCandidate(state, later);
  const laterArchive = join(
    state.releases,
    "v2.1.0",
    "codex-review-gate-action-v2.1.0.tar.gz",
  );
  writeFileSync(laterArchive, Buffer.concat([
    readFileSync(laterArchive),
    Buffer.from("tampered-after-publication\n"),
  ]));

  const result = invokeVerifyPublished(state, old);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /verification_state=blocked_conflict/u);
  assert.match(result.stderr, /recovery_code=published-state-mismatch/u);
  assert.match(result.stderr, /later stable tag v2\.1\.0 is not a complete immutable release/u);
});

test("public verification binds the floating alias annotated-tag object across clone and readback", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state, { label: "public-alias-object-binding" });
  publishCandidate(state, built);
  const originalAliasObject = git(state.target, ["rev-parse", "refs/tags/v2"]);
  const { commit, object: replacementAliasObject } = createReplacementAliasObject(state, "v2");
  const fakeBin = join(state.root, "public-alias-object-binding-bin");
  const fakeGit = join(fakeBin, "git");
  const mutationMarker = join(state.root, "public-alias-object-binding-mutated");
  mkdirSync(fakeBin);
  write(fakeGit, `#!/bin/sh
set -eu
is_clone=false
for argument in "$@"; do
  [ "$argument" = clone ] && is_clone=true
done
"$REAL_GIT" "$@"
if [ "$is_clone" = true ] && [ ! -e "$MUTATION_MARKER" ]; then
  "$REAL_GIT" --git-dir="$MUTATION_TARGET" update-ref refs/tags/v2 "$REPLACEMENT_ALIAS_OBJECT"
  : > "$MUTATION_MARKER"
fi
`);
  chmodSync(fakeGit, 0o755);

  const result = invokeVerifyPublished(state, built, {
    env: {
      MUTATION_MARKER: mutationMarker,
      MUTATION_TARGET: state.target,
      PATH: `${fakeBin}:${executionEnv.PATH}`,
      REAL_GIT: run("which", ["git"]),
      REPLACEMENT_ALIAS_OBJECT: replacementAliasObject,
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /verification_state=blocked_conflict/u);
  assert.match(result.stderr, /recovery_code=published-state-mismatch/u);
  assert.match(result.stderr, /complete target tag namespace changed/u);
  assert.equal(existsSync(mutationMarker), true);
  assert.notEqual(replacementAliasObject, originalAliasObject);
  assert.equal(git(state.target, ["rev-parse", "refs/tags/v2"]), replacementAliasObject);
  assert.equal(git(state.target, ["rev-parse", "refs/tags/v2^{}"]), commit);
});

test("public verification treats a missing later alias Release as a deterministic conflict", (t) => {
  const state = fixture(t);
  const old = buildAssembledCandidate(state, { label: "verify-later-release-404-old" });
  publishCandidate(state, old);
  const oldCommit = git(state.target, ["rev-parse", "refs/tags/v2.0.0^{}"]);

  advanceIntent(state, "2.1.0", oldCommit, "2.0.0");
  const newer = buildAssembledCandidate(state, { label: "verify-later-release-404-newer" });
  publishCandidate(state, newer);

  const fakeBin = join(state.root, "verify-later-release-api-bin");
  const fakeGh = join(fakeBin, "gh");
  mkdirSync(fakeBin);
  write(fakeGh, `#!/bin/sh
if [ "\${FAKE_RELEASE_API_MODE:-}" = 404 ]; then
  echo 'gh: Not Found (HTTP 404)' >&2
else
  echo 'simulated public API outage' >&2
fi
exit 1
`);
  chmodSync(fakeGh, 0o755);
  const verifyEnv = { PATH: `${fakeBin}:${executionEnv.PATH}` };

  const missing = invokeVerifyPublished(state, old, {
    testRelease: false,
    env: { ...verifyEnv, FAKE_RELEASE_API_MODE: "404" },
  });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /verification_state=blocked_conflict/u);
  assert.match(missing.stderr, /recovery_code=published-state-mismatch/u);
  assert.match(missing.stderr, /next_action=investigate-published-state/u);

  const unreadable = invokeVerifyPublished(state, old, {
    testRelease: false,
    env: { ...verifyEnv, FAKE_RELEASE_API_MODE: "outage" },
  });
  assert.notEqual(unreadable.status, 0);
  assert.match(unreadable.stderr, /verification_state=inconclusive/u);
  assert.match(unreadable.stderr, /recovery_code=remote-read-inconclusive/u);
  assert.match(unreadable.stderr, /next_action=retry-public-verification/u);
});

test("public verification treats confirmed Release disappearance as a deterministic conflict", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state, { label: "verify-confirmed-release-404" });
  publishCandidate(state, built);
  const githubEnvironment = fakeGithubEnvironment(state, "public-verify-release-404");
  const fakeStatePath = join(
    state.root,
    "fake-gh-state-public-verify-release-404",
    "state.json",
  );
  const fakeAssets = join(dirname(fakeStatePath), "assets");
  const assetNames = releaseAssets(state, "v2.0.0").filter((name) =>
    !["immutable", "prerelease", "published"].includes(name));
  for (const name of assetNames) {
    copyFileSync(join(state.releases, "v2.0.0", name), join(fakeAssets, name));
  }
  const publishedState = JSON.parse(readFileSync(fakeStatePath, "utf8"));
  Object.assign(publishedState, {
    assets: assetNames.map((name, index) => ({ name, id: index + 1 })),
    body: `Signed release of Joey-Tools/codex-review-gate@${built.sourceCommit}.`,
    draft: false,
    exists: true,
    immutable: true,
    latest: "v2.0.0",
    name: "v2.0.0",
    next_asset_id: assetNames.length + 1,
    prerelease: false,
    tag: "v2.0.0",
  });
  writeJson(fakeStatePath, publishedState);

  for (const verificationFailure of [
    { phase: "verify-initial-api-404", expectedApiReads: 1, expectedViewReads: 0 },
    { phase: "verify-download-404", expectedApiReads: 1, expectedViewReads: 1 },
    { phase: "verify-final-view-404", expectedApiReads: 1, expectedViewReads: 2 },
    { phase: "verify-final-api-404", expectedApiReads: 2, expectedViewReads: 2 },
  ]) {
    const fakeState = JSON.parse(readFileSync(fakeStatePath, "utf8"));
    fakeState.release_api_reads = 0;
    fakeState.release_download_reads = 0;
    fakeState.release_view_reads = 0;
    writeJson(fakeStatePath, fakeState);

    const result = invokeVerifyPublished(state, built, {
      testRelease: false,
      env: { ...githubEnvironment, FAKE_GH_MUTATION_PHASE: verificationFailure.phase },
    });
    assert.notEqual(result.status, 0, `${verificationFailure.phase} must fail closed`);
    assert.match(result.stderr, /verification_state=blocked_conflict/u);
    assert.match(result.stderr, /recovery_code=published-state-mismatch/u);
    assert.match(result.stderr, /next_action=investigate-published-state/u);
    const observedState = JSON.parse(readFileSync(fakeStatePath, "utf8"));
    assert.equal(
      observedState.release_api_reads,
      verificationFailure.expectedApiReads,
      `${verificationFailure.phase} raw API read count`,
    );
    assert.equal(
      observedState.release_view_reads,
      verificationFailure.expectedViewReads,
      `${verificationFailure.phase} projected API read count`,
    );
  }
});

test("public verification rejects structurally inconclusive complete Release inventories", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state, { label: "verify-release-inventory-shape" });
  publishCandidate(state, built);
  const githubEnvironment = fakeGithubEnvironment(state, "verify-release-inventory-shape");
  const fakeStatePath = join(
    state.root,
    "fake-gh-state-verify-release-inventory-shape",
    "state.json",
  );
  const fakeAssets = join(dirname(fakeStatePath), "assets");
  const assetNames = releaseAssets(state, "v2.0.0").filter((name) =>
    !["immutable", "prerelease", "published"].includes(name));
  for (const name of assetNames) {
    copyFileSync(join(state.releases, "v2.0.0", name), join(fakeAssets, name));
  }
  const publishedState = JSON.parse(readFileSync(fakeStatePath, "utf8"));
  Object.assign(publishedState, {
    assets: assetNames.map((name, index) => ({ name, id: index + 1 })),
    body: `Signed release of Joey-Tools/codex-review-gate@${built.sourceCommit}.`,
    draft: false,
    exists: true,
    immutable: true,
    latest: "v2.0.0",
    name: "v2.0.0",
    next_asset_id: assetNames.length + 1,
    prerelease: false,
    tag: "v2.0.0",
  });
  writeJson(fakeStatePath, publishedState);

  for (const phase of [
    "verify-release-inventory-outer-empty",
    "verify-release-inventory-duplicate-id",
  ]) {
    const result = invokeVerifyPublished(state, built, {
      testRelease: false,
      env: { ...githubEnvironment, FAKE_GH_MUTATION_PHASE: phase },
    });
    assert.notEqual(result.status, 0, `${phase} must fail closed`);
    assert.match(result.stderr, /verification_state=inconclusive/u);
    assert.match(result.stderr, /recovery_code=remote-read-inconclusive/u);
    assert.match(result.stderr, /next_action=retry-public-verification/u);
  }
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

test("fake GitHub distinguishes API and release-view missing diagnostics", (t) => {
  const state = fixture(t);
  const env = fakeGithubEnvironment(state, "missing-release-diagnostics");
  const api = invoke("gh", [
    "api",
    "--header",
    "X-GitHub-Api-Version: 2026-03-10",
    "repos/JoeyTeng/codex-review-gate-action/releases/tags/v2.0.0",
  ], { env });
  const view = invoke("gh", [
    "release",
    "view",
    "v2.0.0",
    "--repo",
    "JoeyTeng/codex-review-gate-action",
    "--json",
    "isDraft",
  ], { env });

  assert.equal(api.status, 1);
  assert.match(api.stderr, /HTTP 404: Not Found/u);
  assert.doesNotMatch(api.stderr, /release not found/u);
  assert.equal(view.status, 1);
  assert.equal(view.stderr, "release not found\n");
  assert.doesNotMatch(view.stderr, /HTTP 404/u);

  const fakeStatePath = join(env.FAKE_GH_STATE, "state.json");
  const draftState = JSON.parse(readFileSync(fakeStatePath, "utf8"));
  draftState.exists = true;
  draftState.body = "Signed draft fixture.";
  writeJson(fakeStatePath, draftState);
  const draftByTag = invoke("gh", [
    "api",
    "--header",
    "X-GitHub-Api-Version: 2026-03-10",
    "repos/JoeyTeng/codex-review-gate-action/releases/tags/v2.0.0",
  ], { env });
  const draftInventory = invoke("gh", [
    "api",
    "--paginate",
    "--slurp",
    "--header",
    "X-GitHub-Api-Version: 2026-03-10",
    "repos/JoeyTeng/codex-review-gate-action/releases?per_page=100",
  ], { env });
  const draftById = invoke("gh", [
    "api",
    "--header",
    "X-GitHub-Api-Version: 2026-03-10",
    `repos/JoeyTeng/codex-review-gate-action/releases/${draftState.release_id}`,
  ], { env });
  assert.equal(draftByTag.status, 1);
  assert.match(draftByTag.stderr, /HTTP 404: Not Found/u);
  assert.equal(draftInventory.status, 0, draftInventory.stderr);
  assert.equal(JSON.parse(draftInventory.stdout)[0][0].draft, true);
  assert.equal(draftById.status, 0, draftById.stderr);
  assert.equal(JSON.parse(draftById.stdout).id, draftState.release_id);
  assert.equal(JSON.parse(draftById.stdout).draft, true);
});

test("fresh GitHub publication discovers and freezes its draft through complete inventories", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state, { label: "draft-inventory-fresh" });
  const githubEnvironment = fakeGithubEnvironment(state, "draft-inventory-fresh");
  const result = invokePublish(state, built, {
    testRelease: false,
    env: githubEnvironment,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /reconcile_state=fresh/u);
  const fakeState = JSON.parse(readFileSync(
    join(state.root, "fake-gh-state-draft-inventory-fresh", "state.json"),
    "utf8",
  ));
  assert.equal(fakeState.release_create_calls, 1);
  assert.equal(fakeState.draft, false);
  assert.equal(fakeState.immutable, true);
  assert.ok(fakeState.release_inventory_reads >= 2);
  assert.ok(
    fakeState.call_trace.some(
      ({ type, kind, draft }) => type === "remote" && kind === "release-id-read" && draft,
    ),
    "draft boundaries must use the frozen numeric Release id",
  );
  assert.equal(
    fakeState.call_trace.some(
      ({ type, kind, draft }) => type === "remote" && kind === "release-tag-read" && draft,
    ),
    false,
    "the published-only by-tag endpoint must not be used to read a draft",
  );
});

test("Release create failure before apply leaves later exact-source runs inconclusive", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state, { label: "release-create-failure-before-apply" });
  const githubEnvironment = fakeGithubEnvironment(state, "release-create-failure-before-apply");
  const failed = invokePublish(state, built, {
    testRelease: false,
    env: githubEnvironment,
  });

  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /reconcile_state=inconclusive/u);
  assert.match(failed.stderr, /recovery_code=release-creation-unknown/u);
  const failedState = JSON.parse(readFileSync(
    join(state.root, "fake-gh-state-release-create-failure-before-apply", "state.json"),
    "utf8",
  ));
  assert.equal(failedState.release_create_calls, 1, "one invocation must issue at most one create");
  assert.equal(failedState.exists, false);
  assert.equal(failedState.publish_patch_calls, 0);
  assert.equal(git(state.target, ["cat-file", "-t", "refs/tags/v2.0.0"]), "tag");
  assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2"]));

  const retry = invokePublish(state, built, {
    testRelease: false,
    env: { ...githubEnvironment, FAKE_GH_MUTATION_PHASE: "release-create-before-apply-retry" },
  });
  assert.notEqual(retry.status, 0);
  assert.match(retry.stderr, /reconcile_state=inconclusive/u);
  assert.match(retry.stderr, /recovery_code=release-create-attempt-unknown/u);
  const retriedState = JSON.parse(readFileSync(
    join(state.root, "fake-gh-state-release-create-failure-before-apply", "state.json"),
    "utf8",
  ));
  assert.equal(retriedState.release_create_calls, 1, "later runs must not repeat an unknown create");
  assert.equal(retriedState.exists, false);
  assert.equal(retriedState.publish_patch_calls, 0);
  assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2"]));
});

test("Release create response loss adopts the unique draft and exact-source retry never recreates it", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state, {
    label: "release-create-response-lost-after-apply",
  });
  const githubEnvironment = fakeGithubEnvironment(
    state,
    "release-create-response-lost-after-apply",
  );
  const recovered = invokePublish(state, built, {
    testRelease: false,
    env: githubEnvironment,
  });

  assert.equal(recovered.status, 0, recovered.stderr);
  assert.match(recovered.stdout, /reconcile_state=fresh/u);
  const recoveredStatePath = join(
    state.root,
    "fake-gh-state-release-create-response-lost-after-apply",
    "state.json",
  );
  const recoveredState = JSON.parse(readFileSync(recoveredStatePath, "utf8"));
  assert.equal(recoveredState.release_create_calls, 1, "response loss must not trigger a second create");
  assert.equal(recoveredState.draft, false);
  assert.equal(recoveredState.immutable, true);
  assert.equal(recoveredState.post_create_inventory_reads, 2);

  const retry = invokePublish(state, built, {
    testRelease: false,
    env: { ...githubEnvironment, FAKE_GH_MUTATION_PHASE: "release-create-completed-retry" },
  });
  assert.equal(retry.status, 0, retry.stderr);
  assert.match(retry.stdout, /reconcile_state=already_complete/u);
  const retriedState = JSON.parse(readFileSync(recoveredStatePath, "utf8"));
  assert.equal(retriedState.release_create_calls, 1, "exact-source retry must not recreate the Release");
});

test("an exact-source retry finds a pre-existing draft on the second inventory page", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state, { label: "draft-inventory-second-page" });
  const githubEnvironment = fakeGithubEnvironment(state, "draft-inventory-second-page");
  const first = invokePublish(state, built, {
    testRelease: false,
    env: { ...githubEnvironment, FAKE_GH_MUTATION_PHASE: "patch-failure-before-apply" },
  });
  assert.notEqual(first.status, 0);
  assert.match(first.stderr, /recovery_code=release-publication-unknown/u);

  const recovered = invokePublish(state, built, {
    testRelease: false,
    env: {
      ...githubEnvironment,
      FAKE_GH_MUTATION_PHASE: "release-inventory-target-second-page",
    },
  });
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.match(recovered.stdout, /reconcile_state=resumable_partial/u);
  const fakeState = JSON.parse(readFileSync(
    join(state.root, "fake-gh-state-draft-inventory-second-page", "state.json"),
    "utf8",
  ));
  assert.equal(fakeState.release_create_calls, 1, "retry must not create a second draft");
  assert.equal(fakeState.publish_patch_calls, 1);
  assert.ok(fakeState.release_id_reads > 0);
});

for (const inventoryFailure of [
  {
    phase: "release-inventory-outer-empty",
    state: "inconclusive",
    recoveryCode: "remote-read-inconclusive",
  },
  {
    phase: "release-inventory-duplicate-id",
    state: "inconclusive",
    recoveryCode: "remote-read-inconclusive",
  },
  {
    phase: "release-inventory-duplicate-exact-tag",
    state: "blocked_conflict",
    recoveryCode: "duplicate-release-tag",
  },
]) {
  test(`${inventoryFailure.phase} fails closed before any durable write`, (t) => {
    const state = fixture(t);
    const built = buildAssembledCandidate(state, { label: inventoryFailure.phase });
    const result = invokePublish(state, built, {
      testRelease: false,
      env: fakeGithubEnvironment(state, inventoryFailure.phase),
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`reconcile_state=${inventoryFailure.state}`, "u"));
    assert.match(result.stderr, new RegExp(`recovery_code=${inventoryFailure.recoveryCode}`, "u"));
    assert.equal(git(state.target, ["rev-parse", "refs/heads/master"]), state.initialTarget);
    assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2.0.0"]));
  });
}

for (const postCreateDrift of [
  "post-create-inventory-id-drift",
  "post-create-inventory-release-disappears",
]) {
  test(`${postCreateDrift} fails closed before draft mutation`, (t) => {
    const state = fixture(t);
    const built = buildAssembledCandidate(state, { label: postCreateDrift });
    const githubEnvironment = fakeGithubEnvironment(state, postCreateDrift);
    const result = invokePublish(state, built, {
      testRelease: false,
      env: githubEnvironment,
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /reconcile_state=inconclusive/u);
    assert.match(result.stderr, /recovery_code=remote-state-changed/u);
    const fakeState = JSON.parse(readFileSync(
      join(state.root, `fake-gh-state-${postCreateDrift}`, "state.json"),
      "utf8",
    ));
    assert.equal(fakeState.release_create_calls, 1);
    assert.equal(fakeState.post_create_inventory_reads, 2);
    assert.equal(fakeState.publish_patch_calls, 0);
    assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2"]));
  });
}

for (const frozenIdFailure of [
  {
    phase: "release-id-boundary-404",
    state: "inconclusive",
    recoveryCode: "remote-read-inconclusive",
  },
  {
    phase: "release-id-boundary-wrong-id",
    state: "blocked_conflict",
    recoveryCode: "immutable-release-mismatch",
  },
]) {
  test(`${frozenIdFailure.phase} never rebinds or recreates the draft`, (t) => {
    const state = fixture(t);
    const built = buildAssembledCandidate(state, { label: frozenIdFailure.phase });
    const githubEnvironment = fakeGithubEnvironment(state, frozenIdFailure.phase);
    const result = invokePublish(state, built, {
      testRelease: false,
      env: githubEnvironment,
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`reconcile_state=${frozenIdFailure.state}`, "u"));
    assert.match(result.stderr, new RegExp(`recovery_code=${frozenIdFailure.recoveryCode}`, "u"));
    const fakeState = JSON.parse(readFileSync(
      join(state.root, `fake-gh-state-${frozenIdFailure.phase}`, "state.json"),
      "utf8",
    ));
    assert.equal(fakeState.release_create_calls, 1);
    assert.equal(fakeState.publish_patch_calls, 0);
    assert.equal(fakeState.release_id, 987654321);
    assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2"]));
  });
}

for (const policyCase of [
  {
    label: "enabled true with owner enforcement false",
    phase: "immutable-policy-owner-not-enforced",
  },
  {
    label: "an additive response field",
    phase: "immutable-policy-additive-fields",
  },
]) {
  test(`immutable-release policy accepts ${policyCase.label}`, (t) => {
    const state = fixture(t);
    const built = buildAssembledCandidate(state, { label: policyCase.phase });
    const result = invokePublish(state, built, {
      testRelease: false,
      env: fakeGithubEnvironment(state, policyCase.phase),
    });

    assert.equal(result.status, 0, result.stderr);
    const fakeState = JSON.parse(readFileSync(
      join(state.root, `fake-gh-state-${policyCase.phase}`, "state.json"),
      "utf8",
    ));
    assert.equal(fakeState.immutable, true);
    assert.equal(fakeState.immutable_policy_reads, 3);
    const releaseCreate = fakeState.call_trace.findIndex(
      ({ type, kind }) => type === "remote" && kind === "release-create",
    );
    assert.notEqual(releaseCreate, -1);
    assert.equal(
      fakeState.call_trace
        .slice(0, releaseCreate)
        .some(({ type, kind }) => type === "remote" && kind === "release-view"),
      false,
      "fresh publication must not use gh release view to classify absence",
    );
    assert.notEqual(git(state.target, ["rev-parse", "refs/heads/master"]), state.initialTarget);
  });
}

test("disabled, invalid, or unreadable immutable-release policy responses fail closed", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state, { label: "immutable-policy-rejections" });

  for (const policyCase of [
    {
      label: "disabled HTTP 404",
      phase: "immutable-policy-disabled",
      state: "blocked_conflict",
      recoveryCode: "immutable-release-policy-disabled",
    },
    {
      label: "missing enforced_by_owner",
      phase: "immutable-policy-missing-owner-field",
      state: "blocked_conflict",
      recoveryCode: "immutable-release-policy-disabled",
    },
    {
      label: "enabled with the wrong type",
      phase: "immutable-policy-enabled-wrong-type",
      state: "blocked_conflict",
      recoveryCode: "immutable-release-policy-disabled",
    },
    {
      label: "enforced_by_owner with the wrong type",
      phase: "immutable-policy-owner-wrong-type",
      state: "blocked_conflict",
      recoveryCode: "immutable-release-policy-disabled",
    },
    {
      label: "non-404 API failure",
      phase: "immutable-policy-api-unreadable",
      state: "inconclusive",
      recoveryCode: "immutable-release-policy-unreadable",
    },
  ]) {
    const result = invokePublish(state, built, {
      testRelease: false,
      env: fakeGithubEnvironment(state, policyCase.phase),
    });

    assert.notEqual(result.status, 0, policyCase.label);
    assert.match(
      result.stderr,
      new RegExp(`reconcile_state=${policyCase.state}`, "u"),
      policyCase.label,
    );
    assert.match(
      result.stderr,
      new RegExp(`recovery_code=${policyCase.recoveryCode}`, "u"),
      policyCase.label,
    );
    const fakeState = JSON.parse(readFileSync(
      join(state.root, `fake-gh-state-${policyCase.phase}`, "state.json"),
      "utf8",
    ));
    assert.equal(fakeState.exists, false, policyCase.label);
    assert.deepEqual(fakeState.assets, [], policyCase.label);
    assert.equal(fakeState.immutable_policy_reads, 1, policyCase.label);
  }

  assert.equal(git(state.target, ["rev-parse", "refs/heads/master"]), state.initialTarget);
  assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2.0.0"]));
});

for (const releaseCase of [
  {
    label: "stable",
    version: "2.0.0",
    prerelease: false,
    makeLatest: "true",
    expectedLatest: "v2.0.0",
    majorAlias: "v2",
  },
  {
    label: "rc",
    version: "2.0.0-rc.1",
    prerelease: true,
    makeLatest: "false",
    expectedLatest: null,
    majorAlias: null,
  },
]) {
  test(`${releaseCase.label} publication PATCH binds the frozen Release id and payload`, (t) => {
    const state = fixture(t, releaseCase.version);
    const mutationPhase = `direct-release-patch-${releaseCase.label}`;
    const built = buildAssembledCandidate(state, { label: mutationPhase });
    const result = invokePublish(state, built, {
      testRelease: false,
      env: fakeGithubEnvironment(state, mutationPhase),
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /reconcile_state=fresh/u);
    const immutableTag = `v${releaseCase.version}`;
    const fakeState = JSON.parse(readFileSync(
      join(state.root, `fake-gh-state-${mutationPhase}`, "state.json"),
      "utf8",
    ));
    assert.equal(fakeState.exists, true);
    assert.equal(fakeState.draft, false);
    assert.equal(fakeState.immutable, true);
    assert.equal(fakeState.publish_patch_calls, 1);
    assert.equal(fakeState.release_edit_calls, 0);
    assert.deepEqual(fakeState.publish_patch_payload, {
      body: `Signed release of Joey-Tools/codex-review-gate@${built.sourceCommit}.`,
      draft: false,
      make_latest: releaseCase.makeLatest,
      name: immutableTag,
      prerelease: releaseCase.prerelease,
      tag_name: immutableTag,
    });
    assert.equal(fakeState.latest, releaseCase.expectedLatest);
    assert.equal(git(state.target, ["cat-file", "-t", `refs/tags/${immutableTag}`]), "tag");
    if (releaseCase.majorAlias) {
      assert.equal(
        git(state.target, ["cat-file", "-t", `refs/tags/${releaseCase.majorAlias}`]),
        "tag",
      );
    } else {
      assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2"]));
    }

    const remoteCalls = fakeState.call_trace.filter(({ type }) => type === "remote");
    const patchIndex = remoteCalls.findIndex(({ kind }) => kind === "release-patch");
    assert.notEqual(patchIndex, -1, "missing direct Release PATCH trace");
    assert.deepEqual(
      remoteCalls.slice(patchIndex - 2, patchIndex).map(({ kind }) => kind),
      ["release-id-read", "release-id-read"],
      "the final exact boundary's two GitHub reads must immediately precede PATCH",
    );
    for (const boundaryRead of remoteCalls.slice(patchIndex - 2, patchIndex)) {
      assert.equal(boundaryRead.draft, true);
      assert.equal(boundaryRead.immutable, false);
    }
    const immutablePolicyReads = remoteCalls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => call.kind === "immutable-policy-read");
    assert.equal(immutablePolicyReads.length, releaseCase.majorAlias ? 3 : 2);
    const immutablePolicyReadsBeforePatch = immutablePolicyReads
      .filter(({ index }) => index < patchIndex);
    assert.equal(immutablePolicyReadsBeforePatch.length, 2);
    assert.ok(
      immutablePolicyReadsBeforePatch.at(-1).index < patchIndex - 2,
      "all immutable-policy reads must precede the final exact boundary",
    );
    assert.equal(
      remoteCalls.slice(0, patchIndex).some(({ kind }) => kind === "release-edit"),
      false,
    );
  });
}

test("asset uploads keep the frozen Release id when tag resolution is replaced", (t) => {
  const state = fixture(t);
  const phase = "asset-upload-tag-resolution-replaced";
  const built = buildAssembledCandidate(state, { label: phase });
  const githubEnvironment = fakeGithubEnvironment(state, phase);
  const result = invokePublish(state, built, {
    testRelease: false,
    env: githubEnvironment,
  });

  assert.equal(result.status, 0, result.stderr);
  const fakeStatePath = join(state.root, `fake-gh-state-${phase}`, "state.json");
  const fakeState = JSON.parse(readFileSync(fakeStatePath, "utf8"));
  assert.equal(fakeState.asset_upload_calls, 3);
  assert.deepEqual(
    fakeState.asset_upload_target_release_ids,
    [fakeState.release_id, fakeState.release_id, fakeState.release_id],
  );
  assert.equal(fakeState.tag_resolution_release_id, fakeState.release_id + 1000);
  assert.equal(fakeState.replacement_release_assets.length, 3);
  assert.deepEqual(
    fakeState.replacement_release_assets.map(({ name }) => name).sort(),
    fakeState.assets.map(({ name }) => name).sort(),
  );
  assert.ok(
    fakeState.replacement_release_assets.every(
      ({ release_id: releaseId }) => releaseId === fakeState.tag_resolution_release_id,
    ),
  );
  assert.deepEqual(
    fakeState.replacement_release_assets
      .map(({ id }) => id)
      .filter((id) => fakeState.assets.some((asset) => asset.id === id)),
    [],
    "replacement and frozen Releases must have independent asset identities",
  );
  assert.equal(fakeState.asset_readback_calls, 3);
  assert.deepEqual(fakeState.asset_readback_ids, fakeState.assets.map(({ id }) => id));
  assert.deepEqual(
    fakeState.asset_readback_release_ids,
    [fakeState.release_id, fakeState.release_id, fakeState.release_id],
  );
  const uploadCalls = fakeState.call_trace.filter(
    ({ type, kind }) => type === "remote" && kind === "release-asset-upload",
  );
  assert.equal(uploadCalls.length, 3);
  for (const call of uploadCalls) {
    assert.match(
      call.endpoint,
      new RegExp(`/releases/${fakeState.release_id}/assets\\?name=`, "u"),
    );
  }
  for (const uploadCall of uploadCalls) {
    const uploadIndex = fakeState.call_trace.indexOf(uploadCall);
    const assetReadIndex = fakeState.call_trace.findIndex(
      ({ type, kind }, index) => index > uploadIndex &&
        type === "remote" && kind === "release-asset-read",
    );
    assert.ok(assetReadIndex > uploadIndex, "each upload must have an asset-ID readback");
    assert.equal(
      fakeState.call_trace.slice(uploadIndex + 1, assetReadIndex).some(
        ({ type, kind }) => type === "remote" &&
          ["release-download", "release-tag-read", "release-view"].includes(kind),
      ),
      false,
      "post-upload readback must not use any tag-resolving Release path",
    );
  }

  const pendingProbeState = {
    ...fakeState,
    asset_readback_calls: fakeState.asset_upload_calls - 1,
  };
  writeJson(fakeStatePath, pendingProbeState);
  const apiVersionArgs = ["--header", "X-GitHub-Api-Version: 2026-03-10"];
  const replacementByTag = invoke("gh", [
    "api",
    ...apiVersionArgs,
    "repos/JoeyTeng/codex-review-gate-action/releases/tags/v2.0.0",
  ], { env: githubEnvironment });
  assert.equal(replacementByTag.status, 0, replacementByTag.stderr);
  const replacementRelease = JSON.parse(replacementByTag.stdout);
  assert.equal(replacementRelease.id, fakeState.tag_resolution_release_id);
  assert.deepEqual(
    replacementRelease.assets.map(({ id }) => id),
    fakeState.replacement_release_assets.map(({ id }) => id),
  );

  const frozenById = invoke("gh", [
    "api",
    ...apiVersionArgs,
    `repos/JoeyTeng/codex-review-gate-action/releases/${fakeState.release_id}`,
  ], { env: githubEnvironment });
  assert.equal(frozenById.status, 0, frozenById.stderr);
  const frozenRelease = JSON.parse(frozenById.stdout);
  assert.equal(frozenRelease.id, fakeState.release_id);
  assert.deepEqual(
    frozenRelease.assets.map(({ id }) => id),
    fakeState.assets.map(({ id }) => id),
  );

  const probeAsset = fakeState.assets[0];
  const replacementProbeAsset = fakeState.replacement_release_assets.find(
    ({ name }) => name === probeAsset.name,
  );
  assert.ok(replacementProbeAsset);
  const replacementDownloadDir = join(state.root, "replacement-tag-download");
  const replacementDownload = invoke("gh", [
    "release",
    "download",
    "v2.0.0",
    "--repo",
    "JoeyTeng/codex-review-gate-action",
    "--pattern",
    probeAsset.name,
    "--dir",
    replacementDownloadDir,
  ], { env: githubEnvironment });
  assert.equal(replacementDownload.status, 0, replacementDownload.stderr);
  const replacementBytes = readFileSync(join(
    state.root,
    `fake-gh-state-${phase}`,
    "assets",
    replacementProbeAsset.storage_name,
  ));
  const frozenBytes = readFileSync(join(
    state.root,
    `fake-gh-state-${phase}`,
    "assets",
    probeAsset.name,
  ));
  assert.deepEqual(
    readFileSync(join(replacementDownloadDir, probeAsset.name)),
    replacementBytes,
  );
  assert.notEqual(sha256(replacementBytes), sha256(frozenBytes));

  const frozenAssetRead = invoke("gh", [
    "api",
    ...apiVersionArgs,
    "--header",
    "Accept: application/octet-stream",
    `repos/JoeyTeng/codex-review-gate-action/releases/assets/${probeAsset.id}`,
  ], { env: githubEnvironment });
  assert.equal(frozenAssetRead.status, 0, frozenAssetRead.stderr);
  const finalFakeState = JSON.parse(readFileSync(fakeStatePath, "utf8"));
  assert.equal(finalFakeState.asset_readback_release_ids.at(-1), fakeState.release_id);
});

for (const uploadFailure of [
  { phase: "asset-upload-failure-before-apply", appliedAssets: 0 },
  { phase: "asset-upload-response-lost-after-apply", appliedAssets: 1 },
  { phase: "asset-upload-zero-exit-empty-response", appliedAssets: 1 },
  { phase: "asset-upload-zero-exit-malformed-response", appliedAssets: 1 },
  { phase: "asset-upload-zero-exit-wrong-id-response", appliedAssets: 1 },
  { phase: "asset-readback-failure", appliedAssets: 1 },
  { phase: "asset-readback-byte-mismatch", appliedAssets: 1 },
]) {
  test(`${uploadFailure.phase} preserves an unknown mutation outcome`, (t) => {
    const state = fixture(t);
    const built = buildAssembledCandidate(state, { label: uploadFailure.phase });
    const githubEnvironment = fakeGithubEnvironment(state, uploadFailure.phase);
    const result = invokePublish(state, built, {
      testRelease: false,
      env: githubEnvironment,
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /reconcile_state=inconclusive/u);
    assert.match(result.stderr, /recovery_code=release-asset-upload-unknown/u);
    const fakeState = JSON.parse(readFileSync(
      join(state.root, `fake-gh-state-${uploadFailure.phase}`, "state.json"),
      "utf8",
    ));
    assert.equal(fakeState.assets.length, uploadFailure.appliedAssets);
    assert.equal(fakeState.publish_patch_calls, 0);
    assert.equal(fakeState.draft, true);
    assert.equal(fakeState.immutable, false);
    assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2"]));
    if (uploadFailure.phase === "asset-upload-response-lost-after-apply") {
      const selectedReleaseId = fakeState.release_id;
      const recovered = invokePublish(state, built, {
        testRelease: false,
        env: {
          ...githubEnvironment,
          FAKE_GH_MUTATION_PHASE: "asset-upload-exact-source-retry",
        },
      });
      assert.equal(recovered.status, 0, recovered.stderr);
      assert.match(recovered.stdout, /reconcile_state=resumable_partial/u);
      const recoveredState = JSON.parse(readFileSync(
        join(state.root, `fake-gh-state-${uploadFailure.phase}`, "state.json"),
        "utf8",
      ));
      assert.equal(recoveredState.release_id, selectedReleaseId);
      assert.equal(recoveredState.release_create_calls, 1);
      assert.equal(recoveredState.asset_upload_calls, 3);
      assert.equal(
        recoveredState.assets.filter(({ name }) =>
          name === "codex-review-gate-action-v2.0.0.tar.gz").length,
        1,
        "the exact-source retry must adopt the already-applied asset",
      );
      assert.equal(
        recoveredState.call_trace.some(
          ({ type, kind, draft }) =>
            type === "remote" && kind === "release-download" && draft,
        ),
        false,
        "draft prefix adoption must read bytes by frozen asset id, never by tag",
      );
      assert.equal(recoveredState.draft, false);
      assert.equal(recoveredState.immutable, true);
    }
  });
}

for (const phase of [
  "release-boundary-download-count-drift",
  "release-boundary-asset-order-drift",
  "release-boundary-timestamp-drift",
  "release-inventory-ordering-drift",
]) {
  test(`${phase} is neutral to protected Release state`, (t) => {
    const state = fixture(t);
    const built = buildAssembledCandidate(state, { label: phase });
    const githubEnvironment = fakeGithubEnvironment(state, phase);
    const result = invokePublish(state, built, {
      testRelease: false,
      env: githubEnvironment,
    });

    assert.equal(result.status, 0, result.stderr);
    const fakeState = JSON.parse(readFileSync(
      join(state.root, `fake-gh-state-${phase}`, "state.json"),
      "utf8",
    ));
    assert.equal(fakeState.draft, false);
    assert.equal(fakeState.immutable, true);
    if (phase !== "release-inventory-ordering-drift") {
      assert.equal(fakeState.observational_mutation_done, true);
    }
  });
}

test("a 502 starter is deleted by frozen asset id and exact-source retry is idempotent", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state, { label: "asset-upload-502-starter" });
  const githubEnvironment = fakeGithubEnvironment(state, "asset-upload-502-starter");
  const first = invokePublish(state, built, { testRelease: false, env: githubEnvironment });

  assert.notEqual(first.status, 0);
  assert.match(first.stderr, /recovery_code=release-asset-upload-unknown/u);
  const fakeStatePath = join(
    state.root,
    "fake-gh-state-asset-upload-502-starter",
    "state.json",
  );
  let fakeState = JSON.parse(readFileSync(fakeStatePath, "utf8"));
  assert.equal(fakeState.assets.length, 1);
  assert.equal(fakeState.assets[0].state, "starter");
  const frozenReleaseId = fakeState.release_id;

  const recovered = invokePublish(state, built, {
    testRelease: false,
    env: { ...githubEnvironment, FAKE_GH_MUTATION_PHASE: "starter-asset-recovery" },
  });
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.match(recovered.stdout, /reconcile_state=resumable_partial/u);
  fakeState = JSON.parse(readFileSync(fakeStatePath, "utf8"));
  assert.equal(fakeState.release_id, frozenReleaseId);
  assert.equal(fakeState.release_create_calls, 1);
  assert.equal(fakeState.asset_delete_attempts, 1);
  assert.equal(fakeState.asset_delete_applied, 1);
  assert.deepEqual(fakeState.asset_delete_ids, [1]);
  assert.equal(fakeState.assets.some(({ state: assetState }) => assetState === "starter"), false);
  assert.equal(fakeState.assets.every(({ release_id: owner }) => owner === frozenReleaseId), true);
  assert.equal(fakeState.asset_upload_calls, 4);

  const deleteAttempts = fakeState.asset_delete_attempts;
  const uploadCalls = fakeState.asset_upload_calls;
  const complete = invokePublish(state, built, {
    testRelease: false,
    env: { ...githubEnvironment, FAKE_GH_MUTATION_PHASE: "starter-idempotent-retry" },
  });
  assert.equal(complete.status, 0, complete.stderr);
  assert.match(complete.stdout, /reconcile_state=already_complete/u);
  fakeState = JSON.parse(readFileSync(fakeStatePath, "utf8"));
  assert.equal(fakeState.asset_delete_attempts, deleteAttempts);
  assert.equal(fakeState.asset_upload_calls, uploadCalls);
});

for (const phase of [
  "starter-delete-response-lost-after-apply",
  "starter-delete-404-after-apply",
]) {
  test(`${phase} reconciles the exact one-asset removal without a second DELETE`, (t) => {
    const state = fixture(t);
    const built = buildAssembledCandidate(state, { label: phase });
    const githubEnvironment = fakeGithubEnvironment(state, "asset-upload-502-starter");
    const first = invokePublish(state, built, { testRelease: false, env: githubEnvironment });
    assert.notEqual(first.status, 0);

    const recovered = invokePublish(state, built, {
      testRelease: false,
      env: { ...githubEnvironment, FAKE_GH_MUTATION_PHASE: phase },
    });
    assert.equal(recovered.status, 0, recovered.stderr);
    const fakeState = JSON.parse(readFileSync(
      join(state.root, "fake-gh-state-asset-upload-502-starter", "state.json"),
      "utf8",
    ));
    assert.equal(fakeState.asset_delete_attempts, 1);
    assert.equal(fakeState.asset_delete_applied, 1);
    assert.equal(fakeState.assets.some(({ state: assetState }) => assetState === "starter"), false);
  });
}

test("starter deletion failure before apply stays retryable and does not upload", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state, { label: "starter-delete-failure" });
  const githubEnvironment = fakeGithubEnvironment(state, "asset-upload-502-starter");
  const first = invokePublish(state, built, { testRelease: false, env: githubEnvironment });
  assert.notEqual(first.status, 0);
  const fakeStatePath = join(
    state.root,
    "fake-gh-state-asset-upload-502-starter",
    "state.json",
  );
  const before = JSON.parse(readFileSync(fakeStatePath, "utf8"));

  const failedDelete = invokePublish(state, built, {
    testRelease: false,
    env: {
      ...githubEnvironment,
      FAKE_GH_MUTATION_PHASE: "starter-delete-failure-before-apply",
    },
  });
  assert.notEqual(failedDelete.status, 0);
  assert.match(failedDelete.stderr, /recovery_code=starter-asset-deletion-unknown/u);
  const after = JSON.parse(readFileSync(fakeStatePath, "utf8"));
  assert.equal(after.asset_delete_attempts, 1);
  assert.equal(after.asset_delete_applied, 0);
  assert.equal(after.asset_upload_calls, before.asset_upload_calls);
  assert.equal(after.assets.filter(({ state: assetState }) => assetState === "starter").length, 1);
});

for (const phase of ["starter-predelete-state-drift", "starter-predelete-unrelated-drift"]) {
  test(`${phase} blocks before the unconditional DELETE`, (t) => {
    const state = fixture(t);
    const built = buildAssembledCandidate(state, { label: phase });
    const githubEnvironment = fakeGithubEnvironment(state, "asset-upload-502-starter");
    const first = invokePublish(state, built, { testRelease: false, env: githubEnvironment });
    assert.notEqual(first.status, 0);

    const result = invokePublish(state, built, {
      testRelease: false,
      env: { ...githubEnvironment, FAKE_GH_MUTATION_PHASE: phase },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /recovery_code=starter-asset-deletion-unknown/u);
    const fakeState = JSON.parse(readFileSync(
      join(state.root, "fake-gh-state-asset-upload-502-starter", "state.json"),
      "utf8",
    ));
    assert.equal(fakeState.asset_delete_attempts, 0);
  });
}

test("duplicate asset ids make the complete Release inventory inconclusive", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state, { label: "duplicate-starter-asset-id" });
  const githubEnvironment = fakeGithubEnvironment(state, "asset-upload-502-starter");
  const first = invokePublish(state, built, { testRelease: false, env: githubEnvironment });
  assert.notEqual(first.status, 0);
  const fakeStatePath = join(
    state.root,
    "fake-gh-state-asset-upload-502-starter",
    "state.json",
  );
  const fakeState = JSON.parse(readFileSync(fakeStatePath, "utf8"));
  const duplicateName = "release-provenance.json";
  writeFileSync(join(githubEnvironment.FAKE_GH_STATE, "assets", duplicateName), "duplicate");
  fakeState.assets.push({
    name: duplicateName,
    id: fakeState.assets[0].id,
    release_id: fakeState.release_id,
  });
  writeJson(fakeStatePath, fakeState);

  const result = invokePublish(state, built, {
    testRelease: false,
    env: { ...githubEnvironment, FAKE_GH_MUTATION_PHASE: "duplicate-starter-asset-id" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /recovery_code=remote-read-inconclusive/u);
  const after = JSON.parse(readFileSync(fakeStatePath, "utf8"));
  assert.equal(after.asset_delete_attempts, 0);
});

for (const mismatch of [
  "wrong-name",
  "wrong-slot",
  "nonzero",
  "wrong-digest",
  "wrong-content-type",
  "wrong-uploader",
]) {
  test(`a stable ${mismatch} starter is blocked and never deleted`, (t) => {
    const state = fixture(t);
    const built = buildAssembledCandidate(state, { label: `starter-${mismatch}` });
    const githubEnvironment = fakeGithubEnvironment(state, "asset-upload-502-starter");
    const first = invokePublish(state, built, { testRelease: false, env: githubEnvironment });
    assert.notEqual(first.status, 0);
    const fakeStatePath = join(
      state.root,
      "fake-gh-state-asset-upload-502-starter",
      "state.json",
    );
    const fakeState = JSON.parse(readFileSync(fakeStatePath, "utf8"));
    const starter = fakeState.assets[0];
    if (mismatch === "wrong-name") starter.name = "unexpected.bin";
    if (mismatch === "wrong-slot") starter.name = "release-provenance.json";
    if (mismatch === "nonzero") starter.size = 1;
    if (mismatch === "wrong-digest") starter.digest = `sha256:${"f".repeat(64)}`;
    if (mismatch === "wrong-content-type") starter.content_type = "text/plain";
    if (mismatch === "wrong-uploader") starter.uploader_login = "other-writer[bot]";
    writeJson(fakeStatePath, fakeState);

    const result = invokePublish(state, built, {
      testRelease: false,
      env: { ...githubEnvironment, FAKE_GH_MUTATION_PHASE: `starter-${mismatch}` },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /recovery_code=starter-asset-mismatch/u);
    const after = JSON.parse(readFileSync(fakeStatePath, "utf8"));
    assert.equal(after.asset_delete_attempts, 0);
  });
}

test("multiple starter assets are blocked before any unconditional DELETE", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state, { label: "multiple-starter-assets" });
  const githubEnvironment = fakeGithubEnvironment(state, "asset-upload-502-starter");
  const first = invokePublish(state, built, { testRelease: false, env: githubEnvironment });
  assert.notEqual(first.status, 0);
  const fakeStatePath = join(
    state.root,
    "fake-gh-state-asset-upload-502-starter",
    "state.json",
  );
  const fakeState = JSON.parse(readFileSync(fakeStatePath, "utf8"));
  const secondName = "release-provenance.json";
  writeFileSync(join(githubEnvironment.FAKE_GH_STATE, "assets", secondName), "");
  fakeState.assets.push({
    name: secondName,
    id: fakeState.next_asset_id++,
    release_id: fakeState.release_id,
    state: "starter",
    size: 0,
  });
  writeJson(fakeStatePath, fakeState);

  const result = invokePublish(state, built, {
    testRelease: false,
    env: { ...githubEnvironment, FAKE_GH_MUTATION_PHASE: "multiple-starter-assets" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /recovery_code=starter-asset-mismatch/u);
  const after = JSON.parse(readFileSync(fakeStatePath, "utf8"));
  assert.equal(after.asset_delete_attempts, 0);
  assert.equal(after.assets.filter(({ state: assetState }) => assetState === "starter").length, 2);
});

test("enforced live signer policy reaches both publication and alias critical fences", (t) => {
  const state = fixture(t);
  const label = "live-signer-valid";
  const built = buildAssembledCandidate(state, { label });
  const githubEnvironment = fakeGithubEnvironment(state, label);
  const result = invokePublish(state, built, {
    enforceLiveSignerPolicy: true,
    testRelease: false,
    env: liveSignerPolicyEnvironment(state, githubEnvironment, label),
  });

  assert.equal(result.status, 0, result.stderr);
  const fakeState = JSON.parse(readFileSync(
    join(state.root, `fake-gh-state-${label}`, "state.json"),
    "utf8",
  ));
  assert.equal(fakeState.publish_patch_calls, 1);
  assert.equal(fakeState.draft, false);
  assert.equal(fakeState.immutable, true);
  assert.equal(git(state.target, ["cat-file", "-t", "refs/tags/v2"]), "tag");
  const publicationFence = fakeState.call_trace.findIndex(
    ({ kind, critical_fence: criticalFence }) =>
      kind === "signer-policy-read" && criticalFence === "publication",
  );
  const patch = fakeState.call_trace.findIndex(({ kind }) => kind === "release-patch");
  const aliasFence = fakeState.call_trace.findIndex(
    ({ kind, critical_fence: criticalFence }) =>
      kind === "signer-policy-read" && criticalFence === "alias",
  );
  assert.ok(
    publicationFence !== -1 && publicationFence < patch && patch < aliasFence,
    "the enforced signer inventory must be valid immediately before PATCH and alias mutation",
  );
});

for (const signerFailure of [
  {
    phase: "live-signer-api-unreadable-publication",
    fence: "publication",
    state: "inconclusive",
    recoveryCode: "remote-read-inconclusive",
    expectedPatchCalls: 0,
  },
  {
    phase: "live-signer-revoked-publication",
    fence: "publication",
    state: "blocked_conflict",
    recoveryCode: "signing-key-policy-changed",
    expectedPatchCalls: 0,
  },
  {
    phase: "live-signer-api-unreadable-alias",
    fence: "alias",
    state: "inconclusive",
    recoveryCode: "remote-read-inconclusive",
    expectedPatchCalls: 1,
  },
  {
    phase: "live-signer-cert-replacement-alias",
    fence: "alias",
    state: "blocked_conflict",
    recoveryCode: "signing-key-policy-changed",
    expectedPatchCalls: 1,
  },
]) {
  test(`${signerFailure.phase} stops the next privileged mutation`, (t) => {
    const state = fixture(t);
    const built = buildAssembledCandidate(state, { label: signerFailure.phase });
    const githubEnvironment = fakeGithubEnvironment(state, signerFailure.phase);
    const result = invokePublish(state, built, {
      enforceLiveSignerPolicy: true,
      testRelease: false,
      env: liveSignerPolicyEnvironment(state, githubEnvironment, signerFailure.phase),
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`reconcile_state=${signerFailure.state}`, "u"));
    assert.match(
      result.stderr,
      new RegExp(`recovery_code=${signerFailure.recoveryCode}`, "u"),
    );
    const fakeState = JSON.parse(readFileSync(
      join(state.root, `fake-gh-state-${signerFailure.phase}`, "state.json"),
      "utf8",
    ));
    assert.equal(fakeState.publish_patch_calls, signerFailure.expectedPatchCalls);
    assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2"]));
    const criticalSignerRead = fakeState.call_trace.findIndex(
      ({ kind, critical_fence: criticalFence }) =>
        kind === "signer-policy-read" && criticalFence === signerFailure.fence,
    );
    assert.notEqual(criticalSignerRead, -1, `missing ${signerFailure.fence} signer fence`);
    const patchIndex = fakeState.call_trace.findIndex(({ kind }) => kind === "release-patch");
    if (signerFailure.fence === "publication") {
      assert.equal(patchIndex, -1);
    } else {
      assert.ok(patchIndex !== -1 && patchIndex < criticalSignerRead);
    }
  });
}

for (const patchFailure of [
  {
    phase: "patch-failure-before-apply",
    expectedDraftAfterFailure: true,
    expectedImmutableAfterFailure: false,
    failureCounter: "patch_failures_before_apply",
  },
  {
    phase: "patch-response-lost-after-apply",
    expectedDraftAfterFailure: false,
    expectedImmutableAfterFailure: true,
    failureCounter: "patch_failures_after_apply",
  },
]) {
  test(`${patchFailure.phase} is inconclusive and exact-source reconcile recovers`, (t) => {
    const state = fixture(t);
    const built = buildAssembledCandidate(state, { label: patchFailure.phase });
    const githubEnvironment = fakeGithubEnvironment(state, patchFailure.phase);
    const failed = invokePublish(state, built, {
      testRelease: false,
      env: githubEnvironment,
    });

    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /reconcile_state=inconclusive/u);
    assert.match(failed.stderr, /recovery_code=release-publication-unknown/u);
    assert.match(failed.stderr, /exact source SHA/u);
    let fakeState = JSON.parse(readFileSync(
      join(state.root, `fake-gh-state-${patchFailure.phase}`, "state.json"),
      "utf8",
    ));
    assert.equal(fakeState[patchFailure.failureCounter], 1);
    assert.equal(fakeState.draft, patchFailure.expectedDraftAfterFailure);
    assert.equal(fakeState.immutable, patchFailure.expectedImmutableAfterFailure);
    assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2"]));

    const recovered = invokePublish(state, built, {
      testRelease: false,
      env: { ...githubEnvironment, FAKE_GH_MUTATION_PHASE: "patch-recovery" },
    });
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.match(recovered.stdout, /reconcile_state=resumable_partial/u);
    fakeState = JSON.parse(readFileSync(
      join(state.root, `fake-gh-state-${patchFailure.phase}`, "state.json"),
      "utf8",
    ));
    assert.equal(fakeState[patchFailure.failureCounter], 1);
    assert.equal(fakeState.publish_patch_calls, 1);
    assert.equal(fakeState.release_edit_calls, 0);
    assert.equal(fakeState.draft, false);
    assert.equal(fakeState.immutable, true);
    assert.equal(git(state.target, ["cat-file", "-t", "refs/tags/v2"]), "tag");
  });
}

for (const responseFailure of [
  { label: "an empty body", phase: "patch-zero-exit-empty-response" },
  { label: "malformed JSON", phase: "patch-zero-exit-malformed-response" },
  { label: "a different numeric Release id", phase: "patch-zero-exit-wrong-id-response" },
]) {
  test(`zero-exit Release PATCH with ${responseFailure.label} is unknown and recoverable`, (t) => {
    const state = fixture(t);
    const built = buildAssembledCandidate(state, { label: responseFailure.phase });
    const githubEnvironment = fakeGithubEnvironment(state, responseFailure.phase);
    const failed = invokePublish(state, built, {
      testRelease: false,
      env: githubEnvironment,
    });

    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /reconcile_state=inconclusive/u);
    assert.match(failed.stderr, /recovery_code=release-publication-unknown/u);
    assert.match(failed.stderr, /response was missing or malformed/u);
    assert.match(failed.stderr, /exact source SHA/u);
    let fakeState = JSON.parse(readFileSync(
      join(state.root, `fake-gh-state-${responseFailure.phase}`, "state.json"),
      "utf8",
    ));
    assert.equal(fakeState.publish_patch_calls, 1);
    assert.equal(fakeState.release_edit_calls, 0);
    assert.equal(fakeState.draft, false);
    assert.equal(fakeState.immutable, true);
    assert.equal(fakeState.latest, "v2.0.0");
    assert.equal(git(state.target, ["cat-file", "-t", "refs/tags/v2.0.0"]), "tag");
    assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2"]));

    const recovered = invokePublish(state, built, {
      testRelease: false,
      env: {
        ...githubEnvironment,
        FAKE_GH_MUTATION_PHASE: "patch-zero-exit-response-recovery",
      },
    });

    assert.equal(recovered.status, 0, recovered.stderr);
    assert.match(recovered.stdout, /reconcile_state=resumable_partial/u);
    fakeState = JSON.parse(readFileSync(
      join(state.root, `fake-gh-state-${responseFailure.phase}`, "state.json"),
      "utf8",
    ));
    assert.equal(fakeState.publish_patch_calls, 1, "retry must prove the applied PATCH without repeating it");
    assert.equal(fakeState.release_edit_calls, 0);
    assert.equal(
      fakeState.call_trace.filter(
        ({ type, kind }) => type === "remote" && kind === "release-patch",
      ).length,
      1,
      "exact-source retry must not issue a second Release PATCH",
    );
    assert.equal(fakeState.tag, "v2.0.0");
    const releaseCommit = git(state.target, ["rev-parse", "refs/tags/v2.0.0^{}"]);
    assert.equal(git(state.target, ["rev-parse", "refs/tags/v2^{}"]), releaseCommit);
    assert.equal(git(state.target, ["rev-parse", "refs/heads/master"]), releaseCommit);
    assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2.0.1"]));
  });
}

test("mutable post-publication readback blocks the floating alias", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state, { label: "post-publish-mutable" });
  const hostileGithubEnvironment = fakeGithubEnvironment(state, "post-publish-mutable");
  const result = invokePublish(state, built, {
    testRelease: false,
    env: {
      ...hostileGithubEnvironment,
      FAKE_EXPECT_PINNED_GITHUB_HOST: "true",
      GH_ENTERPRISE_TOKEN: SYNTHETIC_TOKEN_FIXTURE.value,
      GITHUB_ENTERPRISE_TOKEN: SYNTHETIC_TOKEN_FIXTURE.value,
      GH_HOST: "hostile.invalid",
      RELEASE_PUBLISHER_TOKEN: SYNTHETIC_TOKEN_FIXTURE.value,
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reconcile_state=blocked_conflict/u);
  assert.match(result.stderr, /recovery_code=immutable-release-mismatch/u);
  const fakeState = JSON.parse(readFileSync(
    join(state.root, "fake-gh-state-post-publish-mutable", "state.json"),
    "utf8",
  ));
  assert.equal(fakeState.exists, true);
  assert.equal(fakeState.draft, false);
  assert.equal(fakeState.immutable, false);
  assert.equal(git(state.target, ["cat-file", "-t", "refs/tags/v2.0.0"]), "tag");
  assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2"]));
});

for (const policyDrift of ["source", "ruleset"]) {
  test(`${policyDrift} policy drift after the first write stops the partial prefix`, (t) => {
    const state = fixture(t);
    const built = buildAssembledCandidate(state, { label: `post-master-${policyDrift}-drift` });
    const githubEnvironment = fakeGithubEnvironment(state, `post-master-${policyDrift}-drift`);
    const result = invokePublish(state, built, {
      testRelease: false,
      env: driftAfterMasterPushEnvironment(state, githubEnvironment, policyDrift),
    });

    assert.notEqual(result.status, 0);
    if (policyDrift === "source") {
      assert.match(result.stderr, /reconcile_state=inconclusive/u);
      assert.match(result.stderr, /recovery_code=source-state-changed/u);
    } else {
      assert.match(result.stderr, /reconcile_state=blocked_conflict/u);
      assert.match(result.stderr, /recovery_code=publisher-ruleset-policy-changed/u);
    }
    assert.notEqual(git(state.target, ["rev-parse", "refs/heads/master"]), state.initialTarget);
    assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2.0.0"]));
    assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2"]));
    const fakeState = JSON.parse(readFileSync(
      join(state.root, `fake-gh-state-post-master-${policyDrift}-drift`, "state.json"),
      "utf8",
    ));
    assert.equal(fakeState.exists, false);
    assert.deepEqual(fakeState.assets, []);
  });
}

test("release-policy read drift is fenced again before draft publication", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state, { label: "pre-release-edit-source-drift" });
  const sourceBefore = git(state.source, ["rev-parse", "refs/heads/master"]);
  const sourceDriftCommit = danglingCommit(
    state.source,
    sourceBefore,
    "Source drift during immutable-policy read",
  );
  const githubEnvironment = fakeGithubEnvironment(
    state,
    "source-drift-during-release-policy-read",
  );
  const result = invokePublish(state, built, {
    testRelease: false,
    env: {
      ...githubEnvironment,
      FAKE_SOURCE_DRIFT_COMMIT: sourceDriftCommit,
      FAKE_SOURCE_REPOSITORY: state.source,
      REAL_GIT: run("which", ["git"]),
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reconcile_state=inconclusive/u);
  assert.match(result.stderr, /recovery_code=source-state-changed/u);
  const fakeState = JSON.parse(readFileSync(
    join(state.root, "fake-gh-state-source-drift-during-release-policy-read", "state.json"),
    "utf8",
  ));
  assert.equal(fakeState.immutable_policy_reads, 2);
  assert.equal(fakeState.exists, true);
  assert.equal(fakeState.draft, true);
  assert.equal(fakeState.immutable, false);
  assert.equal(git(state.target, ["cat-file", "-t", "refs/tags/v2.0.0"]), "tag");
  assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2"]));
});

for (const mutationPhase of [
  "asset-drift-during-final-policy-read",
  "metadata-drift-during-final-policy-read",
]) {
  test(`${mutationPhase} is rejected by the final pre-publication boundary`, (t) => {
    const state = fixture(t);
    const built = buildAssembledCandidate(state, { label: mutationPhase });
    const githubEnvironment = fakeGithubEnvironment(state, mutationPhase);
    const result = invokePublish(state, built, {
      testRelease: false,
      env: githubEnvironment,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /reconcile_state=blocked_conflict/u);
    assert.match(result.stderr, /recovery_code=immutable-release-mismatch/u);
    const fakeState = JSON.parse(readFileSync(
      join(state.root, `fake-gh-state-${mutationPhase}`, "state.json"),
      "utf8",
    ));
    assert.equal(fakeState.policy_mutation_done, true);
    assert.equal(fakeState.poisoned_after_pre_publish_boundary, true);
    assert.equal(fakeState.immutable_policy_reads, 2);
    assert.equal(
      mutationPhase === "asset-drift-during-final-policy-read"
        ? fakeState.mutation_done
        : fakeState.metadata_mutation_done,
      true,
    );
    assert.equal(fakeState.publish_patch_calls, 0);
    assert.equal(fakeState.release_edit_calls, 0);
    assert.equal(fakeState.draft, true);
    assert.equal(fakeState.immutable, false);
    assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2"]));

    const mutationTraceIndex = fakeState.call_trace.findIndex(
      ({ type, kind }) => type === "event" && kind === "policy-window-mutation",
    );
    assert.notEqual(mutationTraceIndex, -1, "missing policy-window mutation trace");
    const oldBoundaryReads = fakeState.call_trace
      .slice(0, mutationTraceIndex)
      .filter(({ type, kind }) => type === "remote" && kind === "release-id-read")
      .slice(-2);
    assert.equal(oldBoundaryReads.length, 2, "the old exact boundary must precede mutation");
    for (const boundaryRead of oldBoundaryReads) {
      assert.equal(boundaryRead.draft, true);
      assert.equal(boundaryRead.immutable, false);
      assert.equal(boundaryRead.mutation_done, false);
      assert.equal(boundaryRead.metadata_mutation_done, false);
    }
    const newBoundaryReads = fakeState.call_trace
      .slice(mutationTraceIndex + 1)
      .filter(({ type, kind }) => type === "remote" && kind === "release-id-read");
    assert.ok(newBoundaryReads.length >= 1, "the new final boundary must observe the mutation");
    if (mutationPhase === "asset-drift-during-final-policy-read") {
      assert.ok(newBoundaryReads.length >= 2, "stable asset drift must complete both boundary reads");
      assert.equal(newBoundaryReads[0].mutation_done, true);
      assert.equal(newBoundaryReads[1].mutation_done, true);
    } else {
      assert.equal(newBoundaryReads[0].metadata_mutation_done, true);
    }
    assert.equal(
      fakeState.call_trace.some(({ type, kind }) => type === "remote" && kind === "release-patch"),
      false,
      "the final boundary must reject the poisoned draft before PATCH",
    );

    if (mutationPhase === "asset-drift-during-final-policy-read") {
      // Counterfactual control: the removed sequence proceeded directly from
      // this poisoned post-policy state to publication. Replaying only that
      // PATCH against a copy proves it would have locked the replacement asset
      // into an immutable Release; the production path above did not PATCH.
      const legacyStateDir = join(state.root, "fake-gh-state-legacy-unfenced-control");
      const legacyAssetsDir = join(legacyStateDir, "assets");
      mkdirSync(legacyAssetsDir, { recursive: true });
      writeJson(join(legacyStateDir, "state.json"), fakeState);
      for (const asset of fakeState.assets) {
        copyFileSync(
          join(dirname(join(
            state.root,
            `fake-gh-state-${mutationPhase}`,
            "state.json",
          )), "assets", asset.name),
          join(legacyAssetsDir, asset.name),
        );
      }
      const legacyPayload = join(state.root, "legacy-unfenced-publication.json");
      writeJson(legacyPayload, {
        body: fakeState.body,
        draft: false,
        make_latest: "true",
        name: fakeState.tag,
        prerelease: fakeState.prerelease,
        tag_name: fakeState.tag,
      });
      const legacyPatch = invoke("gh", [
        "api",
        "--method",
        "PATCH",
        "--header",
        "X-GitHub-Api-Version: 2026-03-10",
        `repos/JoeyTeng/codex-review-gate-action/releases/${fakeState.release_id}`,
        "--input",
        legacyPayload,
      ], {
        env: { ...githubEnvironment, FAKE_GH_STATE: legacyStateDir },
      });
      assert.equal(legacyPatch.status, 0, legacyPatch.stderr);
      const legacyState = JSON.parse(readFileSync(
        join(legacyStateDir, "state.json"),
        "utf8",
      ));
      assert.equal(legacyState.poisoned_after_pre_publish_boundary, true);
      assert.equal(legacyState.publish_patch_calls, 1);
      assert.equal(legacyState.draft, false);
      assert.equal(legacyState.immutable, true);
    }
  });
}

for (const boundaryFailure of [
  {
    phase: "pre-publication-boundary-unreadable",
    state: "inconclusive",
    recoveryCode: "remote-read-inconclusive",
  },
  {
    phase: "pre-publication-boundary-snapshot-changed",
    state: "inconclusive",
    recoveryCode: "remote-state-changed",
  },
  {
    phase: "pre-publication-second-raw-metadata-drift",
    state: "inconclusive",
    recoveryCode: "remote-state-changed",
  },
  {
    phase: "pre-publication-second-raw-tag-drift",
    state: "inconclusive",
    recoveryCode: "remote-state-changed",
  },
  {
    phase: "pre-publication-stable-schema-invalid",
    state: "blocked_conflict",
    recoveryCode: "immutable-release-mismatch",
  },
  {
    phase: "pre-publication-valid-to-schema-invalid",
    state: "inconclusive",
    recoveryCode: "remote-state-changed",
  },
]) {
  test(`${boundaryFailure.phase} preserves the draft with precise classification`, (t) => {
    const state = fixture(t);
    const built = buildAssembledCandidate(state, { label: boundaryFailure.phase });
    const result = invokePublish(state, built, {
      testRelease: false,
      env: fakeGithubEnvironment(state, boundaryFailure.phase),
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`reconcile_state=${boundaryFailure.state}`, "u"));
    assert.match(
      result.stderr,
      new RegExp(`recovery_code=${boundaryFailure.recoveryCode}`, "u"),
    );
    const fakeState = JSON.parse(readFileSync(
      join(state.root, `fake-gh-state-${boundaryFailure.phase}`, "state.json"),
      "utf8",
    ));
    assert.equal(fakeState.final_publication_boundary_reads >= 1, true);
    assert.equal(fakeState.publish_patch_calls, 0);
    assert.equal(fakeState.draft, true);
    assert.equal(fakeState.immutable, false);
    assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2"]));
    if (boundaryFailure.phase === "pre-publication-stable-schema-invalid") {
      assert.equal(fakeState.final_publication_boundary_reads, 2);
      assert.equal(fakeState.raw_boundary_mutation_done, false);
      assert.match(
        result.stderr,
        /GitHub Release boundary metadata or author differs from policy/u,
      );
    }
    if (boundaryFailure.phase === "pre-publication-valid-to-schema-invalid") {
      assert.doesNotMatch(
        result.stderr,
        /GitHub Release boundary metadata or author differs from policy/u,
      );
    }
    if (boundaryFailure.recoveryCode === "remote-state-changed") {
      assert.equal(fakeState.final_publication_boundary_reads, 2);
      assert.equal(fakeState.raw_boundary_mutation_done, true);
      if (boundaryFailure.phase === "pre-publication-boundary-snapshot-changed") {
        assert.equal(fakeState.mutation_done, true);
      }
    }
  });
}

for (const absentBoundaryFailure of [
  {
    phase: "stable-mismatch",
    state: "blocked_conflict",
    recoveryCode: "immutable-release-mismatch",
    expectedApiReads: 2,
    expectedTagReads: 2,
  },
  {
    phase: "stable-lightweight",
    state: "blocked_conflict",
    recoveryCode: "immutable-release-mismatch",
    expectedApiReads: 2,
    expectedTagReads: 2,
  },
  {
    phase: "tag-drift",
    state: "inconclusive",
    recoveryCode: "remote-state-changed",
    expectedApiReads: 2,
    expectedTagReads: 2,
  },
  {
    phase: "api-unreadable-first",
    state: "inconclusive",
    recoveryCode: "remote-read-inconclusive",
    expectedApiReads: 1,
    expectedTagReads: 0,
  },
  {
    phase: "api-unreadable-second",
    state: "inconclusive",
    recoveryCode: "remote-read-inconclusive",
    expectedApiReads: 2,
    expectedTagReads: 1,
  },
  {
    phase: "tag-unreadable-first",
    state: "inconclusive",
    recoveryCode: "remote-read-inconclusive",
    expectedApiReads: 1,
    expectedTagReads: 1,
  },
  {
    phase: "tag-unreadable-second",
    state: "inconclusive",
    recoveryCode: "remote-read-inconclusive",
    expectedApiReads: 2,
    expectedTagReads: 2,
  },
  {
    phase: "release-appears",
    state: "inconclusive",
    recoveryCode: "remote-state-changed",
    expectedApiReads: 2,
    expectedTagReads: 2,
  },
]) {
  test(`fresh absent boundary ${absentBoundaryFailure.phase} is classified precisely`, (t) => {
    const state = fixture(t);
    const label = `absent-boundary-${absentBoundaryFailure.phase}`;
    const built = buildAssembledCandidate(state, { label });
    const replacement = createDetachedAliasObject(state, `replacement-${label}`);
    const githubEnvironment = fakeGithubEnvironment(state, label);
    const absentEnvironment = absentBoundaryDriftEnvironment(
      state,
      githubEnvironment,
      absentBoundaryFailure.phase,
      replacement.object,
    );
    const result = invokePublish(state, built, {
      testRelease: false,
      env: absentEnvironment,
    });

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      new RegExp(`reconcile_state=${absentBoundaryFailure.state}`, "u"),
    );
    assert.match(
      result.stderr,
      new RegExp(`recovery_code=${absentBoundaryFailure.recoveryCode}`, "u"),
    );
    const fakeState = JSON.parse(readFileSync(
      join(state.root, `fake-gh-state-${label}`, "state.json"),
      "utf8",
    ));
    assert.equal(fakeState.absent_boundary_api_reads, absentBoundaryFailure.expectedApiReads);
    const observedTagReads = existsSync(absentEnvironment.ABSENT_TAG_READ_COUNT_FILE)
      ? Number(readFileSync(absentEnvironment.ABSENT_TAG_READ_COUNT_FILE, "utf8").trim())
      : 0;
    assert.equal(observedTagReads, absentBoundaryFailure.expectedTagReads);
    assert.equal(fakeState.publish_patch_calls, 0);
    assert.equal(fakeState.release_edit_calls, 0);
    assert.equal(fakeState.exists, absentBoundaryFailure.phase === "release-appears");
    assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2"]));
  });
}

for (const stablePolicyMismatch of [
  {
    phase: "stable-invalid-author-before-final-boundary",
    changedField: "author_login",
  },
  {
    phase: "stable-invalid-asset-before-final-boundary",
    changedField: "asset_uploader_login",
  },
  {
    phase: "stable-invalid-tag-before-final-boundary",
    changedField: "tag",
  },
]) {
  test(`${stablePolicyMismatch.phase} is a stable policy mismatch`, (t) => {
    const state = fixture(t);
    const built = buildAssembledCandidate(state, { label: stablePolicyMismatch.phase });
    const result = invokePublish(state, built, {
      testRelease: false,
      env: fakeGithubEnvironment(state, stablePolicyMismatch.phase),
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /reconcile_state=blocked_conflict/u);
    assert.match(result.stderr, /recovery_code=immutable-release-mismatch/u);
    const fakeState = JSON.parse(readFileSync(
      join(state.root, `fake-gh-state-${stablePolicyMismatch.phase}`, "state.json"),
      "utf8",
    ));
    assert.equal(fakeState.policy_mutation_done, true);
    assert.equal(fakeState.final_publication_boundary_reads, 2);
    assert.equal(fakeState.raw_boundary_mutation_done, false);
    assert.notEqual(
      fakeState[stablePolicyMismatch.changedField],
      stablePolicyMismatch.changedField === "tag"
        ? "v2.0.0"
        : "codex-review-gate-action-publisher[bot]",
    );
    assert.equal(fakeState.publish_patch_calls, 0);
    assert.equal(fakeState.draft, true);
    assert.equal(fakeState.immutable, false);
    assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2"]));
  });
}

test("stable same-name asset replacement after publication is a frozen-boundary conflict", (t) => {
  const state = fixture(t);
  const phase = "stable-asset-replacement-before-final-boundary";
  const built = buildAssembledCandidate(state, { label: phase });
  const result = invokePublish(state, built, {
    testRelease: false,
    env: fakeGithubEnvironment(state, phase),
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reconcile_state=blocked_conflict/u);
  assert.match(result.stderr, /recovery_code=immutable-release-mismatch/u);
  const fakeState = JSON.parse(readFileSync(
    join(state.root, `fake-gh-state-${phase}`, "state.json"),
    "utf8",
  ));
  assert.equal(fakeState.mutation_done, true);
  assert.equal(fakeState.publish_patch_calls, 1);
  assert.equal(fakeState.draft, false);
  assert.equal(fakeState.immutable, true);
  assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2"]));
  const mutationIndex = fakeState.call_trace.findIndex(
    ({ type, kind }) => type === "event" && kind === "post-publish-boundary-mutation",
  );
  assert.notEqual(mutationIndex, -1);
  const readsAfterMutation = fakeState.call_trace
    .slice(mutationIndex + 1)
    .filter(({ type, kind }) => type === "remote" && kind === "release-id-read");
  assert.ok(readsAfterMutation.length >= 2);
  assert.equal(readsAfterMutation[0].mutation_done, true);
  assert.equal(readsAfterMutation[1].mutation_done, true);
});

test("same-name provenance replacement after immutability blocks the floating alias", (t) => {
  const state = fixture(t);
  const built = buildAssembledCandidate(state, { label: "after-immutable" });
  const result = invokePublish(state, built, {
    testRelease: false,
    env: fakeGithubEnvironment(state, "after-immutable"),
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reconcile_state=blocked_conflict/u);
  assert.match(result.stderr, /recovery_code=immutable-release-mismatch/u);
  const fakeState = JSON.parse(readFileSync(
    join(state.root, "fake-gh-state-after-immutable", "state.json"),
    "utf8",
  ));
  assert.equal(fakeState.mutation_done, true);
  assert.equal(fakeState.publish_patch_calls, 1);
  assert.equal(fakeState.release_edit_calls, 0);
  assert.equal(fakeState.draft, false);
  assert.equal(fakeState.immutable, true);
  assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2"]));
});

for (const aliasFenceFailure of [
  {
    phase: "immutable-policy-disabled-before-alias",
    state: "blocked_conflict",
    recoveryCode: "immutable-release-policy-disabled",
  },
  {
    phase: "release-drift-during-alias-policy-read",
    state: "blocked_conflict",
    recoveryCode: "immutable-release-mismatch",
  },
]) {
  test(`${aliasFenceFailure.phase} blocks the floating alias before push`, (t) => {
    const state = fixture(t);
    const built = buildAssembledCandidate(state, { label: aliasFenceFailure.phase });
    const result = invokePublish(state, built, {
      testRelease: false,
      env: fakeGithubEnvironment(state, aliasFenceFailure.phase),
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`reconcile_state=${aliasFenceFailure.state}`, "u"));
    assert.match(
      result.stderr,
      new RegExp(`recovery_code=${aliasFenceFailure.recoveryCode}`, "u"),
    );
    const fakeState = JSON.parse(readFileSync(
      join(state.root, `fake-gh-state-${aliasFenceFailure.phase}`, "state.json"),
      "utf8",
    ));
    assert.equal(fakeState.immutable_policy_reads, 3);
    assert.equal(fakeState.publish_patch_calls, 1);
    assert.equal(fakeState.draft, false);
    assert.equal(fakeState.immutable, true);
    assert.throws(() => git(state.target, ["rev-parse", "refs/tags/v2"]));
    const aliasMutation = fakeState.call_trace.find(
      ({ type, kind }) => type === "event" && kind === "alias-policy-window-mutation",
    );
    assert.equal(aliasMutation?.immutable_policy_read, 3);
    if (aliasFenceFailure.phase === "release-drift-during-alias-policy-read") {
      const mutationIndex = fakeState.call_trace.indexOf(aliasMutation);
      const finalAliasBoundaryReads = fakeState.call_trace
        .slice(mutationIndex + 1)
        .filter(({ type, kind }) => type === "remote" && kind === "release-id-read");
      assert.ok(finalAliasBoundaryReads.length >= 2);
      assert.equal(finalAliasBoundaryReads[0].mutation_done, true);
      assert.equal(finalAliasBoundaryReads[1].mutation_done, true);
    }
  });
}

for (const aliasReadbackFailure of [
  {
    phase: "changed-between-reads",
    state: "inconclusive",
    recoveryCode: "remote-state-changed",
  },
  {
    phase: "stable-mismatch",
    state: "blocked_conflict",
    recoveryCode: "malformed-major-alias-target",
  },
]) {
  test(`floating alias post-write ${aliasReadbackFailure.phase} is classified precisely`, (t) => {
    const state = fixture(t);
    const label = `alias-readback-${aliasReadbackFailure.phase}`;
    const built = buildAssembledCandidate(state, { label });
    const replacement = createDetachedAliasObject(state, "v2");
    const githubEnvironment = fakeGithubEnvironment(state, label);
    const aliasEnvironment = aliasReadbackDriftEnvironment(
      state,
      githubEnvironment,
      aliasReadbackFailure.phase,
      replacement.object,
    );
    const result = invokePublish(state, built, {
      testRelease: false,
      env: aliasEnvironment,
    });

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      new RegExp(`reconcile_state=${aliasReadbackFailure.state}`, "u"),
    );
    assert.match(
      result.stderr,
      new RegExp(`recovery_code=${aliasReadbackFailure.recoveryCode}`, "u"),
    );
    const fakeState = JSON.parse(readFileSync(
      join(state.root, `fake-gh-state-${label}`, "state.json"),
      "utf8",
    ));
    assert.equal(fakeState.publish_patch_calls, 1);
    assert.equal(fakeState.draft, false);
    assert.equal(fakeState.immutable, true);
    assert.equal(readFileSync(aliasEnvironment.ALIAS_READ_COUNT_FILE, "utf8").trim(), "2");
    assert.equal(git(state.target, ["rev-parse", "refs/tags/v2"]), replacement.object);
    assert.equal(git(state.target, ["rev-parse", "refs/tags/v2^{}"]), replacement.commit);
  });
}

for (const aliasRawFailure of [
  {
    phase: "stable-lightweight",
    state: "blocked_conflict",
    recoveryCode: "malformed-major-alias-target",
    expectedReads: 2,
  },
  {
    phase: "stable-malformed-two-line",
    state: "blocked_conflict",
    recoveryCode: "malformed-major-alias-target",
    expectedReads: 2,
  },
  {
    phase: "valid-then-shape-drift",
    state: "inconclusive",
    recoveryCode: "remote-state-changed",
    expectedReads: 2,
  },
  {
    phase: "command-failure-first",
    state: "inconclusive",
    recoveryCode: "remote-read-inconclusive",
    expectedReads: 1,
  },
  {
    phase: "command-failure-second",
    state: "inconclusive",
    recoveryCode: "remote-read-inconclusive",
    expectedReads: 2,
  },
]) {
  test(`floating alias raw readback ${aliasRawFailure.phase} is classified precisely`, (t) => {
    const state = fixture(t);
    const label = `alias-raw-readback-${aliasRawFailure.phase}`;
    const built = buildAssembledCandidate(state, { label });
    const replacement = createDetachedAliasObject(state, "v2");
    const githubEnvironment = fakeGithubEnvironment(state, label);
    const aliasEnvironment = aliasReadbackDriftEnvironment(
      state,
      githubEnvironment,
      aliasRawFailure.phase,
      replacement.object,
    );
    const result = invokePublish(state, built, {
      testRelease: false,
      env: aliasEnvironment,
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`reconcile_state=${aliasRawFailure.state}`, "u"));
    assert.match(
      result.stderr,
      new RegExp(`recovery_code=${aliasRawFailure.recoveryCode}`, "u"),
    );
    assert.equal(
      readFileSync(aliasEnvironment.ALIAS_READ_COUNT_FILE, "utf8").trim(),
      String(aliasRawFailure.expectedReads),
    );
    const fakeState = JSON.parse(readFileSync(
      join(state.root, `fake-gh-state-${label}`, "state.json"),
      "utf8",
    ));
    assert.equal(fakeState.publish_patch_calls, 1);
    assert.equal(fakeState.draft, false);
    assert.equal(fakeState.immutable, true);
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
  assert.equal(publicationPlan.recovery_code, "release-intent-superseded");

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

assert.equal(
  test.registeredCount,
  131,
  "release pipeline shard registration inventory drift",
);
