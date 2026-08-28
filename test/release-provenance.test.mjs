import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, verify as verifyBytes } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  buildCandidate,
  canonicalReleaseAssetSnapshot,
  canonicalReleaseInventorySnapshot,
  compareSemver,
  createGitHubAppJwt,
  createPublicationPlan,
  createReleasePlan,
  discoverV2RuntimeModulePaths,
  extractCandidateTransport,
  finalizeProvenance,
  parseSemver,
  parseVerifiedOpenPgpStatus,
  readGitHubAppInstallation,
  readReleaseManifest,
  validatePublicationPlan,
  validateGitHubSigningKeyInventory,
  validateActionMetadata,
  validatePublisherRulesets,
  validateSigningKeyHome,
  validateTargetReleaseObjects,
  verifyCandidate,
  verifyPublishedAssets,
  writeManifest,
} from "../scripts/generate-action-release-provenance.mjs";

const PRIMARY = "AD403DAB5377F9FA0F7D775EC2844D3367B8A71B";
const SUBKEY = "4DD48552DDEAF6D961769DD4A49827EC48984E2C";
const TARGET_HEAD = "59eeda2af2a7baab3f3f15a59fbbaee015fa6c01";
const WORKFLOW_REF =
  "Joey-Tools/codex-review-gate/.github/workflows/sync-action-subtree.yml@refs/heads/master";
const ACTION_METADATA = readFileSync(new URL("../packages/action/action.yml", import.meta.url), "utf8");
const PUBLISHER_WORKFLOW = readFileSync(
  new URL("../.github/workflows/sync-action-subtree.yml", import.meta.url),
  "utf8",
);
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
const APP_BYPASS = [{
  actor_id: 4700530,
  actor_type: "Integration",
  bypass_mode: "always",
}];

test("publisher identity preflight creates a short-lived RS256 App JWT", () => {
  const now = 1_800_000_000;
  const clientId = "Iv23liSyntheticPublisher";
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const token = createGitHubAppJwt({ clientId, privateKey, now });
  const parts = token.split(".");
  assert.equal(parts.length, 3);
  assert.deepEqual(JSON.parse(Buffer.from(parts[0], "base64url")), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(JSON.parse(Buffer.from(parts[1], "base64url")), {
    iat: now - 60,
    exp: now + 540,
    iss: clientId,
  });
  assert.equal(
    verifyBytes(
      "RSA-SHA256",
      Buffer.from(`${parts[0]}.${parts[1]}`),
      publicKey,
      Buffer.from(parts[2], "base64url"),
    ),
    true,
  );
  const changedClaims = Buffer.from(JSON.stringify({
    iat: now - 60,
    exp: now + 541,
    iss: clientId,
  })).toString("base64url");
  assert.equal(
    verifyBytes(
      "RSA-SHA256",
      Buffer.from(`${parts[0]}.${changedClaims}`),
      publicKey,
      Buffer.from(parts[2], "base64url"),
    ),
    false,
  );
});

test("publisher identity preflight requests installation detail with an in-memory Bearer JWT", async () => {
  const now = 1_800_000_000;
  const clientId = "Iv23liSyntheticPublisher";
  const installationId = "12345678";
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  let observed;
  const installation = await readGitHubAppInstallation({
    clientId,
    privateKey,
    installationId,
    now,
    fetchImpl: async (url, options) => {
      observed = { url, options };
      return {
        status: 200,
        text: async () => JSON.stringify({ id: Number(installationId), app_slug: "publisher" }),
      };
    },
  });
  assert.deepEqual(installation, { id: Number(installationId), app_slug: "publisher" });
  assert.equal(observed.url, `https://api.github.com/app/installations/${installationId}`);
  assert.equal(observed.options.method, "GET");
  assert.equal(observed.options.redirect, "error");
  assert.match(observed.options.headers.Authorization, /^Bearer [^.]+\.[^.]+\.[^.]+$/u);
  assert.doesNotMatch(observed.options.headers.Authorization, /^token /u);
  assert.equal(observed.options.headers["X-GitHub-Api-Version"], "2022-11-28");
});

test("publisher identity preflight rejects malformed App JWT inputs", () => {
  const { privateKey: rsaPrivateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const { privateKey: ecPrivateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  for (const clientId of ["short", "invalid client id", "x".repeat(129)]) {
    assert.throws(
      () => createGitHubAppJwt({ clientId, privateKey: rsaPrivateKey, now: 1_800_000_000 }),
      /client ID is malformed/u,
    );
  }
  for (const now of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => createGitHubAppJwt({ clientId: "Iv23liSyntheticPublisher", privateKey: rsaPrivateKey, now }),
      /JWT time is invalid/u,
    );
  }
  assert.throws(
    () => createGitHubAppJwt({
      clientId: "Iv23liSyntheticPublisher",
      privateKey: ecPrivateKey,
      now: 1_800_000_000,
    }),
    /private key must be RSA/u,
  );
});

test("publisher workflow keeps App JWT and installation-token authentication classes separate", () => {
  const tokenStep = PUBLISHER_WORKFLOW.match(
    /      - name: Create least-privilege publisher token\n(?<body>[\s\S]*?)(?=\n      - name: )/u,
  )?.groups?.body;
  const identityStep = PUBLISHER_WORKFLOW.match(
    /      - name: Validate publisher identity and repository scope\n(?<body>[\s\S]*?)(?=\n      - name: )/u,
  )?.groups?.body;
  assert.ok(tokenStep, "publisher token step must remain present");
  assert.ok(identityStep, "publisher identity step must remain present");
  assert.match(tokenStep, /uses: actions\/create-github-app-token@v3/u);
  assert.match(tokenStep, /client-id: \$\{\{ vars\.RELEASE_PUBLISHER_APP_CLIENT_ID \}\}/u);
  assert.match(tokenStep, /repositories: codex-review-gate-action/u);
  assert.deepEqual(
    [...tokenStep.matchAll(/^          (permission-[^:]+): (\S+)$/gmu)]
      .map((match) => [match[1], match[2]]),
    [
      ["permission-administration", "read"],
      ["permission-contents", "write"],
    ],
  );
  const identityLines = identityStep.split("\n");
  const appCommandIndex = identityLines.findIndex((line) =>
    line.includes("node scripts/generate-action-release-provenance.mjs github-app-installation"));
  assert.ok(appCommandIndex > 0, "bounded App-JWT command must remain present");
  assert.equal(
    identityLines[appCommandIndex - 1],
    '          RELEASE_PUBLISHER_APP_PRIVATE_KEY="$app_private_key" \\',
  );
  assert.equal(
    identityLines[appCommandIndex],
    "            node scripts/generate-action-release-provenance.mjs github-app-installation \\",
  );
  const executableIdentityStep = identityLines
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  assert.match(identityStep, /--client-id "\$APP_CLIENT_ID"/u);
  assert.doesNotMatch(executableIdentityStep, /app\/installations/u);
  assert.equal([...executableIdentityStep.matchAll(/\bgh api\b/gu)].length, 1);
  assert.match(
    identityStep,
    /env -u GH_ENTERPRISE_TOKEN -u GITHUB_ENTERPRISE_TOKEN[\s\\]*GH_HOST=github\.com GH_TOKEN="\$installation_token"[\s\\]*gh api --hostname github\.com installation\/repositories/u,
  );
});

function ruleset({
  name,
  target = "branch",
  include,
  exclude = [],
  bypass = [],
  ruleTypes,
}) {
  return {
    name,
    enforcement: "active",
    target,
    conditions: { ref_name: { include, exclude } },
    bypass_actors: bypass,
    rules: ruleTypes.map((type) => ({ type })),
  };
}

function productionRulesets() {
  return [
    ruleset({
      name: "publisher-master-update",
      include: ["refs/heads/master"],
      bypass: APP_BYPASS,
      ruleTypes: ["update"],
    }),
    ruleset({
      name: "master-integrity",
      include: ["refs/heads/master"],
      ruleTypes: [
        "deletion",
        "non_fast_forward",
        "required_linear_history",
        "required_signatures",
      ],
    }),
    ruleset({
      name: "freeze-v1-tags",
      target: "tag",
      include: ["refs/tags/v1", "refs/tags/v1.*"],
      ruleTypes: ["creation", "update", "deletion", "non_fast_forward"],
    }),
    ruleset({
      name: "publisher-v2-plus-tags",
      target: "tag",
      include: ["refs/tags/v*"],
      exclude: ["refs/tags/v1", "refs/tags/v1.*"],
      bypass: APP_BYPASS,
      ruleTypes: ["creation", "update", "deletion", "non_fast_forward"],
    }),
  ];
}

function inventoryRecord(path, sha256, size, mode = "100644") {
  return { path, type: "file", mode, size, sha256 };
}

function manifest({ version = "2.0.0", tree = "a".repeat(40), files, expectedHead = TARGET_HEAD } = {}) {
  const payloadFiles = files ?? [
    inventoryRecord("action.yml", "b".repeat(64), 85),
    inventoryRecord("package.json", "c".repeat(64), 180),
    inventoryRecord("src/v2/gate-runtime.mjs", "d".repeat(64), 32),
  ];
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
      tree,
    },
    target: {
      repository: "JoeyTeng/codex-review-gate-action",
      ref: "refs/heads/master",
      expected_head: expectedHead,
      previous_version: "1.5.1",
    },
    files: payloadFiles,
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

function releaseAsset(id, overrides = {}) {
  return {
    id,
    node_id: `RA_${id}`,
    name: "release-provenance.json",
    state: "uploaded",
    content_type: "application/json",
    size: 123,
    digest: `sha256:${"a".repeat(64)}`,
    created_at: "2026-08-25T12:00:00Z",
    updated_at: "2026-08-25T12:00:00Z",
    url: `https://api.github.com/repos/JoeyTeng/codex-review-gate-action/releases/assets/${id}`,
    browser_download_url:
      "https://github.com/JoeyTeng/codex-review-gate-action/releases/download/v2.0.0/release-provenance.json",
    uploader: {
      id: 4700530,
      node_id: "MDM6QXBwNDcwMDUzMA==",
      login: "codex-review-gate-action-publisher[bot]",
      type: "Bot",
    },
    ...overrides,
  };
}

function gpg(home, args, options = {}) {
  return execFileSync("gpg", ["--batch", "--homedir", home, ...args], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function keyFingerprints(home) {
  return gpg(home, ["--with-colons", "--with-subkey-fingerprint", "--list-secret-keys"])
    .split("\n")
    .filter((line) => line.startsWith("fpr:"))
    .map((line) => line.split(":")[9]);
}

function git(repo, args, options = {}) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function gitObjectBytes(repo, type, objectId) {
  return execFileSync("git", ["-C", repo, "cat-file", type, objectId], {
    encoding: null,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function writeRawGitObject(repo, type, bytes) {
  return execFileSync("git", [
    "-C", repo,
    "hash-object",
    "--literally",
    "-w",
    "-t", type,
    "--stdin",
  ], {
    encoding: "utf8",
    input: bytes,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function appendGitObjectHeader(source, header) {
  return source.replace("\n\n", `\n${header}\n\n`);
}

function duplicateGitObjectHeader(source, name) {
  const match = new RegExp(`^${name} .+$`, "mu").exec(source);
  assert.ok(match, `${name} header must be present in the fixture`);
  return source.replace(`${match[0]}\n`, `${match[0]}\n${match[0]}\n`);
}

function write(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

function writeJson(path, value) {
  write(path, `${JSON.stringify(value, null, 2)}\n`);
}

function replaceRootActionDescription(replacement) {
  const rootDescription = /^description:[^\r\n]*$/mu;
  assert.match(ACTION_METADATA, rootDescription, "root Action description fixture must exist");
  const replaced = ACTION_METADATA.replace(rootDescription, replacement);
  assert.notEqual(replaced, ACTION_METADATA, "root Action description fixture must change");
  return replaced;
}

function commit(repo, message) {
  git(repo, ["add", "--all"]);
  git(repo, ["commit", "-q", "-m", message]);
  return git(repo, ["rev-parse", "HEAD"]);
}

function payloadInventory(repo, ref) {
  const raw = execFileSync("git", [
    "-C", repo,
    "ls-tree",
    "-rz",
    "--full-tree",
    "--format=%(objectmode)%x09%(objecttype)%x09%(objectname)%x09%(path)",
    `${ref}:packages/action`,
  ], {
    encoding: null,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return raw
    .subarray(0, raw.at(-1) === 0 ? -1 : undefined)
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((row) => {
      const [mode, objectType, objectId, path] = row.split("\t");
      assert.equal(objectType, "blob");
      const bytes = execFileSync("git", ["-C", repo, "cat-file", "blob", objectId], {
        encoding: null,
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return inventoryRecord(
        path,
        createHash("sha256").update(bytes).digest("hex"),
        bytes.byteLength,
        mode,
      );
    })
    .sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
}

function nulInventoryDigest(records) {
  const hash = createHash("sha256");
  for (const record of records) {
    for (const field of [record.path, record.type, record.mode, String(record.size), record.sha256]) {
      hash.update(field, "utf8");
      hash.update("\0", "binary");
    }
  }
  return hash.digest("hex");
}

function releaseFixture(t, { version = "2.0.0" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "release-provenance-fixture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const targetRepo = join(root, "target");
  mkdirSync(targetRepo);
  git(targetRepo, ["init", "-q", "--initial-branch=master"]);
  git(targetRepo, ["config", "user.name", "JoeyTeng-Codex"]);
  git(targetRepo, ["config", "user.email", "codex@mahane.me"]);
  write(join(targetRepo, "action.yml"), "name: Legacy Action\n");
  const targetHead = commit(targetRepo, "Release codex-review-gate-action v1.5.1");
  git(targetRepo, ["tag", "-a", "v1.5.1", targetHead, "-m", "Release codex-review-gate-action v1.5.1"]);
  const repo = join(root, "source");
  mkdirSync(repo);
  git(repo, ["init", "-q", "--initial-branch=master"]);
  git(repo, ["config", "user.name", "Release Fixture"]);
  git(repo, ["config", "user.email", "release-fixture@example.invalid"]);
  write(join(repo, "packages", "action", "action.yml"), ACTION_METADATA);
  writeJson(join(repo, "packages", "action", "package.json"), {
    name: "codex-review-gate-action",
    version,
    type: "module",
    repository: {
      type: "git",
      url: "git+https://github.com/JoeyTeng/codex-review-gate-action.git",
    },
  });
  write(
    join(repo, "packages", "action", "src", "v2", "gate-runtime.mjs"),
    `export const version = ${JSON.stringify(version)};\n`,
  );
  const payloadCommit = commit(repo, "Install release payload");
  const tree = git(repo, ["rev-parse", `${payloadCommit}:packages/action`]);
  const files = payloadInventory(repo, payloadCommit);
  writeJson(join(repo, "release-manifest.json"), manifest({ version, tree, files, expectedHead: targetHead }));
  const sourceCommit = commit(repo, `Release intent ${version}`);
  const plan = createReleasePlan({ repo, sourceRef: sourceCommit, controlRef: sourceCommit });
  const planPath = join(root, "release-plan.json");
  writeJson(planPath, plan);
  const candidateDir = join(root, "candidate");
  const candidate = buildCandidate({
    repo,
    sourceRef: sourceCommit,
    controlRef: sourceCommit,
    planPath,
    outputDir: candidateDir,
  });
  return { root, repo, targetRepo, targetHead, sourceCommit, plan, candidateDir, candidate, tree, files };
}

function materializeTargetRelease(state, {
  tree = state.tree,
  parent = state.targetHead,
  sourceCommit = state.sourceCommit,
  manifestDigest = state.plan.manifest_sha256,
  tagTarget,
} = {}) {
  git(state.targetRepo, ["fetch", "-q", state.repo, state.sourceCommit]);
  const subject = `Release codex-review-gate-action ${state.plan.immutable_tag}`;
  const message = `${subject}\n\nSource: Joey-Tools/codex-review-gate@${sourceCommit}\nManifest-SHA256: ${manifestDigest}\n`;
  const releaseCommit = execFileSync("git", [
    "-C", state.targetRepo,
    "commit-tree", tree,
    "-p", parent,
  ], {
    encoding: "utf8",
    input: message,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "JoeyTeng-Codex",
      GIT_AUTHOR_EMAIL: "codex@mahane.me",
      GIT_COMMITTER_NAME: "JoeyTeng-Codex",
      GIT_COMMITTER_EMAIL: "codex@mahane.me",
    },
  }).trim();
  git(state.targetRepo, ["tag", "-f", "-a", state.plan.immutable_tag, tagTarget ?? releaseCommit, "-m", subject]);
  return {
    releaseCommit,
    fullTagObject: git(state.targetRepo, ["rev-parse", `refs/tags/${state.plan.immutable_tag}`]),
  };
}

function createCandidateTransport(state, path) {
  execFileSync("tar", [
    "--format=ustar",
    "-cf", path,
    "-C", state.candidateDir,
    "candidate.json",
    state.candidate.archive.name,
  ], { stdio: ["ignore", "pipe", "pipe"] });
}

test("SemVer policy emits only an immutable tag for prereleases", () => {
  assert.deepEqual(parseSemver("2.0.0-rc.1"), {
    version: "2.0.0-rc.1",
    major: 2,
    minor: 0,
    patch: 0,
    prerelease: "rc.1",
    immutableTag: "v2.0.0-rc.1",
    majorAlias: null,
  });
});

test("SemVer policy emits one floating alias for every future stable major", () => {
  assert.equal(parseSemver("3.4.5").majorAlias, "v3");
  assert.equal(parseSemver("10.0.0").majorAlias, "v10");
  assert.throws(() => parseSemver("1.9.0"), /new v1 releases are forbidden/u);
  assert.throws(() => parseSemver("v2.0.0"), /canonical SemVer/u);
});

test("SemVer comparison preserves huge canonical numeric components and aliases", () => {
  const lower = "9007199254740992";
  const higher = "9007199254740993";
  assert.equal(compareSemver(`${lower}.0.0`, `${higher}.0.0`), -1);
  assert.equal(compareSemver(`${higher}.0.0`, `${lower}.0.0`), 1);
  assert.equal(compareSemver(`2.${lower}.0`, `2.${higher}.0`), -1);
  assert.equal(compareSemver(`2.0.${lower}`, `2.0.${higher}`), -1);
  assert.equal(compareSemver(`2.0.0-${lower}`, `2.0.0-${higher}`), -1);
  assert.equal(parseSemver(`${higher}.0.0`).majorAlias, `v${higher}`);
});

test("publisher rulesets match the four-rule production contract", () => {
  assert.equal(validatePublisherRulesets(productionRulesets()), true);
  const unexpected = productionRulesets();
  unexpected.push(ruleset({
    name: "unexpected-active-rule",
    include: ["refs/heads/release"],
    ruleTypes: ["update"],
  }));
  assert.throws(() => validatePublisherRulesets(unexpected), /exactly the four adopted/u);
});

test("master integrity cannot grant a bypass or omit a required protection", () => {
  const withBypass = productionRulesets();
  withBypass[1].bypass_actors = APP_BYPASS;
  assert.throws(() => validatePublisherRulesets(withBypass), /master-integrity/u);
  const withoutSignatures = productionRulesets();
  withoutSignatures[1].rules = withoutSignatures[1].rules.filter(
    (rule) => rule.type !== "required_signatures",
  );
  assert.throws(() => validatePublisherRulesets(withoutSignatures), /master-integrity/u);
});

test("publisher master bypass is limited to default-branch updates", () => {
  const withoutUpdate = productionRulesets();
  withoutUpdate[0].rules = [];
  assert.throws(() => validatePublisherRulesets(withoutUpdate), /publisher-master-update/u);
  const withExtraRule = productionRulesets();
  withExtraRule[0].rules.push({ type: "required_status_checks" });
  assert.throws(() => validatePublisherRulesets(withExtraRule), /publisher-master-update/u);
  const defaultBranchToken = productionRulesets();
  defaultBranchToken[0].conditions.ref_name.include = ["~DEFAULT_BRANCH"];
  assert.throws(() => validatePublisherRulesets(defaultBranchToken), /publisher-master-update/u);
});

test("v1 is frozen without bypass while only v2-plus tags grant the App bypass", () => {
  const v1Bypass = productionRulesets();
  v1Bypass[2].bypass_actors = APP_BYPASS;
  assert.throws(() => validatePublisherRulesets(v1Bypass), /freeze-v1-tags/u);
  const missingV1Exclusion = productionRulesets();
  missingV1Exclusion[3].conditions.ref_name.exclude = [];
  assert.throws(() => validatePublisherRulesets(missingV1Exclusion), /publisher-v2-plus-tags/u);
  const broadV1Pattern = productionRulesets();
  broadV1Pattern[2].conditions.ref_name.include = ["refs/tags/v1*"];
  assert.throws(() => validatePublisherRulesets(broadV1Pattern), /freeze-v1-tags/u);
});

test("repository baseline v3 records the split tag protections", () => {
  const baseline = JSON.parse(readFileSync(
    new URL("../docs/release/action-v2-repository-baselines.json", import.meta.url),
    "utf8",
  ));
  assert.equal(baseline.schema_version, 3);
  assert.deepEqual(Object.keys(baseline.required_rulesets).sort(), [
    "freeze_v1_tags",
    "master_integrity",
    "publisher_master_update",
    "publisher_v2_plus_tags",
  ]);
  assert.equal(baseline.observed_ids_are_execution_dependencies, false);
});

test("manifest v2 binds baseline v3, exact inventory, signer, and Node.js entrypoint", () => {
  const root = mkdtempSync(join(tmpdir(), "release-manifest-v2-"));
  try {
    const path = join(root, "release-manifest.json");
    writeJson(path, manifest());
    const parsed = readReleaseManifest(path);
    assert.equal(parsed.release.majorAlias, "v2");
    assert.equal(parsed.contract_versions.baseline, 3);
    assert.deepEqual(parsed.entrypoint, {
      metadata_path: "action.yml",
      using: "node20",
      main: "src/v2/gate-runtime.mjs",
    });
    const composite = manifest();
    composite.entrypoint.using = "composite";
    writeJson(path, composite);
    assert.throws(() => readReleaseManifest(path), /action entrypoint differs/u);
    const changedTarget = manifest();
    changedTarget.target.repository = "Joey-Tools/codex-review-gate-action";
    writeJson(path, changedTarget);
    assert.throws(() => readReleaseManifest(path), /target repository\/ref/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release planning validates the real JavaScript Action and manifest tree", (t) => {
  const state = releaseFixture(t);
  assert.equal(state.plan.source_tree, state.tree);
  assert.deepEqual(state.candidate.payload.files, state.files);
  assert.equal(state.candidate.payload.inventory_sha256, nulInventoryDigest(state.files));
});

test("Action metadata parser admits only the closed node20 JavaScript schema", () => {
  assert.equal(validateActionMetadata(Buffer.from(ACTION_METADATA)), true);
  const replaceDescription = (replacement) => replaceRootActionDescription(replacement);
  const invalid = new Map([
    ["malformed flow scalar", replaceDescription("description: [")],
    ["duplicate key", ACTION_METADATA.replace("author: JoeyTeng\n", "author: JoeyTeng\nauthor: Mallory\n")],
    ["duplicate runs", ACTION_METADATA.replace("runs:\n", "runs:\n  using: node20\n  main: src/v2/gate-runtime.mjs\nruns:\n")],
    ["duplicate runs using", ACTION_METADATA.replace("  using: node20", "  using: node20\n  using: node20")],
    ["duplicate runs main", ACTION_METADATA.replace("  main: src/v2/gate-runtime.mjs", "  main: src/v2/gate-runtime.mjs\n  main: src/v2/gate-runtime.mjs")],
    ["unknown top-level key", `${ACTION_METADATA}unexpected: value\n`],
    ["anchor", replaceDescription("description: &desc Reconcile evidence.")],
    ["alias", replaceDescription("description: *desc")],
    ["tag", replaceDescription("description: !str Reconcile evidence.")],
    ["merge key", ACTION_METADATA.replace("  icon: shield\n", "  <<: *branding\n  icon: shield\n")],
    ["multiple documents", `---\n${ACTION_METADATA}`],
    ["block scalar", replaceDescription("description: |\n  Reconcile evidence.")],
    ["flow mapping", ACTION_METADATA.replace("branding:\n  icon: shield\n  color: blue", "branding: {icon: shield, color: blue}")],
    ["tab indentation", ACTION_METADATA.replace("  using: node20", "\tusing: node20")],
    ["control character", ACTION_METADATA.replace("author: JoeyTeng", "author: JoeyTeng\u0001")],
    ["NEL structural injection", replaceRootActionDescription(
      "description: harmless\u0085  runs:\u0085    using: node20",
    )],
    ["Unicode line separator indentation", ACTION_METADATA.replace("  using: node20", "\u2028\u2028using: node20")],
    ["Unicode paragraph separator indentation", ACTION_METADATA.replace("  main: src/v2/gate-runtime.mjs", "\u2029\u2029main: src/v2/gate-runtime.mjs")],
    ["non-breaking-space indentation", ACTION_METADATA.replace("  using: node20", "\u00a0\u00a0using: node20")],
    ["non-ASCII scalar", ACTION_METADATA.replace("author: JoeyTeng", "author: JoeyTéng")],
    ["extra lifecycle hook", ACTION_METADATA.replace(
      "  main: src/v2/gate-runtime.mjs",
      "  main: src/v2/gate-runtime.mjs\n  post: cleanup.mjs",
    )],
    ["unknown input", ACTION_METADATA.replace("inputs:\n", "inputs:\n  unexpected:\n    description: Unknown.\n    required: false\n")],
  ]);
  for (const [label, source] of invalid) {
    assert.throws(
      () => validateActionMetadata(Buffer.from(source)),
      /root action\.yml|root Action/u,
      label,
    );
  }
});

test("YAML alternate line breaks cannot create a parser-equivalent metadata override", () => {
  for (const separator of ["\u0085", "\u2028", "\u2029"]) {
    const injected = replaceRootActionDescription(
      `description: harmless${separator}runs:${separator}  using: composite${separator}  main: attacker.mjs`,
    );
    const lineFeedEquivalent = injected.replaceAll(separator, "\n");
    assert.match(lineFeedEquivalent, /^runs:\n  using: composite\n  main: attacker\.mjs$/mu);
    assert.throws(
      () => validateActionMetadata(Buffer.from(injected)),
      /root action\.yml/u,
      `alternate YAML line break U+${separator.codePointAt(0).toString(16).toUpperCase()}`,
    );
    assert.throws(
      () => validateActionMetadata(Buffer.from(lineFeedEquivalent)),
      /duplicate key runs/u,
      "the LF-equivalent structure must also fail closed",
    );
  }
});

test("release planning rejects a composite Action even when its manifest claims node20", (t) => {
  const root = mkdtempSync(join(tmpdir(), "release-composite-fixture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "source");
  mkdirSync(repo);
  git(repo, ["init", "-q", "--initial-branch=master"]);
  git(repo, ["config", "user.name", "Release Fixture"]);
  git(repo, ["config", "user.email", "release-fixture@example.invalid"]);
  write(join(repo, "packages", "action", "action.yml"), [
    "name: Composite",
    "runs:",
    "  using: composite",
    "  steps:",
    "    - shell: bash",
    "      run: true",
    "",
  ].join("\n"));
  writeJson(join(repo, "packages", "action", "package.json"), {
    name: "codex-review-gate-action",
    version: "2.0.0",
    repository: {
      type: "git",
      url: "git+https://github.com/JoeyTeng/codex-review-gate-action.git",
    },
  });
  write(join(repo, "packages", "action", "src", "v2", "gate-runtime.mjs"), "export {};\n");
  const payloadCommit = commit(repo, "Install composite payload");
  writeJson(join(repo, "release-manifest.json"), manifest({
    tree: git(repo, ["rev-parse", `${payloadCommit}:packages/action`]),
    files: payloadInventory(repo, payloadCommit),
  }));
  const sourceCommit = commit(repo, "Release intent");
  assert.throws(
    () => createReleasePlan({ repo, sourceRef: sourceCommit, controlRef: sourceCommit }),
    /closed mapping-only subset|JavaScript Action policy/u,
  );
});

test("candidate verification binds the NUL-delimited inventory digest", (t) => {
  const state = releaseFixture(t);
  assert.equal(state.candidate.payload.inventory_sha256, nulInventoryDigest(state.candidate.payload.files));
  const candidatePath = join(state.candidateDir, "candidate.json");
  const original = readFileSync(candidatePath, "utf8");
  const tampered = JSON.parse(original);
  tampered.payload.inventory_sha256 = "f".repeat(64);
  writeJson(candidatePath, tampered);
  assert.throws(() => verifyCandidate(state.candidateDir), /NUL-delimited inventory digest/u);
  writeFileSync(candidatePath, original);
  assert.equal(verifyCandidate(state.candidateDir).payload.inventory_sha256, nulInventoryDigest(state.files));
});

test("candidate transport extracts only the two exact root regular files", (t) => {
  const state = releaseFixture(t);
  const transport = join(state.root, "candidate.tar");
  createCandidateTransport(state, transport);
  const extracted = join(state.root, "extracted");
  assert.equal(extractCandidateTransport({ archivePath: transport, outputDir: extracted }), true);
  assert.deepEqual(readdirSync(extracted).sort(), [
    state.candidate.archive.name,
    "candidate.json",
  ].sort());
  const trailing = join(state.root, "candidate-trailing.tar");
  writeFileSync(trailing, Buffer.concat([readFileSync(transport), Buffer.from("unexpected")]), { flag: "wx" });
  assert.throws(
    () => extractCandidateTransport({ archivePath: trailing, outputDir: join(state.root, "trailing-output") }),
    /end marker|non-zero data/u,
  );
});

test("candidate transport rejects symlinks before reading their content", (t) => {
  const state = releaseFixture(t);
  const transportRoot = join(state.root, "symlink-transport");
  mkdirSync(transportRoot);
  symlinkSync(join(state.candidateDir, "candidate.json"), join(transportRoot, "candidate.json"));
  copyFileSync(join(state.candidateDir, state.candidate.archive.name), join(transportRoot, state.candidate.archive.name));
  chmodSync(join(transportRoot, state.candidate.archive.name), 0o600);
  const transport = join(state.root, "symlink-candidate.tar");
  execFileSync("tar", [
    "--format=ustar",
    "-cf", transport,
    "-C", transportRoot,
    "candidate.json",
    state.candidate.archive.name,
  ], { stdio: ["ignore", "pipe", "pipe"] });
  assert.throws(
    () => extractCandidateTransport({ archivePath: transport, outputDir: join(state.root, "symlink-output") }),
    /must contain exactly two root regular files|rejects links and special entries/u,
  );
});

test("publication plan rebinds the candidate and exact live source closure", (t) => {
  const state = releaseFixture(t);
  write(join(state.repo, "docs", "operator-note.md"), "Documentation-only recovery.\n");
  const liveMaster = commit(state.repo, "Document recovery");
  const publicationPlan = createPublicationPlan({
    candidateDir: state.candidateDir,
    repo: state.repo,
    sourceRef: state.sourceCommit,
    controlRef: state.sourceCommit,
    liveMasterRef: liveMaster,
  });
  assert.equal(publicationPlan.schema, "codex-review-gate-action-publication-plan-v1");
  assert.equal(publicationPlan.live_source_master, liveMaster);
  assert.equal(publicationPlan.write_eligible, true);
  assert.equal(publicationPlan.candidate.archive_sha256, state.candidate.archive.sha256);
  const planPath = join(state.root, "publication-plan.json");
  writeJson(planPath, publicationPlan);
  assert.deepEqual(validatePublicationPlan({
    publicationPlanPath: planPath,
    candidateDir: state.candidateDir,
    repo: state.repo,
    sourceRef: state.sourceCommit,
    controlRef: state.sourceCommit,
    liveMasterRef: liveMaster,
  }), publicationPlan);
  publicationPlan.candidate.archive_sha256 = "f".repeat(64);
  writeJson(planPath, publicationPlan);
  assert.throws(() => validatePublicationPlan({
    publicationPlanPath: planPath,
    candidateDir: state.candidateDir,
    repo: state.repo,
    sourceRef: state.sourceCommit,
    controlRef: state.sourceCommit,
    liveMasterRef: liveMaster,
  }), /publication plan differs/u);
});

test("publication plan fails closed when live master changes publisher controls", (t) => {
  const state = releaseFixture(t);
  write(join(state.repo, "test", "release-provenance.test.mjs"), "// changed control\n");
  const liveMaster = commit(state.repo, "Change publisher control");
  const publicationPlan = createPublicationPlan({
    candidateDir: state.candidateDir,
    repo: state.repo,
    sourceRef: state.sourceCommit,
    controlRef: state.sourceCommit,
    liveMasterRef: liveMaster,
  });
  assert.equal(publicationPlan.write_eligible, false);
  assert.equal(publicationPlan.recovery_code, "publisher-control-drift");
  assert.match(publicationPlan.reason, /publisher-control-drift/u);
});

test("provenance binds workflow, release objects, signatures, and alias transition", (t) => {
  const state = releaseFixture(t);
  const outputDir = join(state.root, "release-assets");
  const { releaseCommit, fullTagObject } = materializeTargetRelease(state);
  const result = finalizeProvenance({
    candidateDir: state.candidateDir,
    releaseCommit,
    fullTagObject,
    releaseParent: state.targetHead,
    aliasName: "v2",
    aliasBefore: "none",
    aliasMode: "create",
    workflowRef: WORKFLOW_REF,
    workflowRunId: "123456",
    workflowRunAttempt: "2",
    outputDir,
  });
  assert.equal(result.provenance.workflow.run_id, "123456");
  assert.equal(result.provenance.target.parent, state.targetHead);
  assert.deepEqual(result.provenance.alias_transition, {
    name: "v2",
    before: null,
    target_commit: releaseCommit,
    target_version: "2.0.0",
    mode: "create",
  });
  assert.deepEqual(result.provenance.signatures.provenance, {
    path: "release-provenance.json",
    detached_signature: "release-provenance.json.asc",
    primary_fingerprint: PRIMARY,
    signing_subkey_fingerprint: SUBKEY,
  });
  writeFileSync(join(outputDir, "release-provenance.json.asc"), "test-only detached signature\n", {
    flag: "wx",
    mode: 0o600,
  });
  assert.deepEqual(readdirSync(outputDir).sort(), [
    state.candidate.archive.name,
    "release-provenance.json",
    "release-provenance.json.asc",
  ].sort());
  assert.equal(verifyPublishedAssets({
    assetDir: outputDir,
    repo: state.repo,
    targetRepo: state.targetRepo,
    sourceRef: state.sourceCommit,
    releaseCommit,
    fullTagObject,
  }), true);
  const archivePath = join(outputDir, state.candidate.archive.name);
  const archiveBytes = readFileSync(archivePath);
  writeFileSync(archivePath, Buffer.concat([archiveBytes, Buffer.from("tampered")]), { flag: "w" });
  assert.throws(() => verifyPublishedAssets({
    assetDir: outputDir,
    repo: state.repo,
    targetRepo: state.targetRepo,
    sourceRef: state.sourceCommit,
    releaseCommit,
    fullTagObject,
  }), /deterministic archive/u);
  writeFileSync(archivePath, archiveBytes, { flag: "w" });
});

test("published provenance is cross-checked against actual wrapper and annotated tag objects", (t) => {
  const state = releaseFixture(t);
  const assertInvalid = (options, pattern) => {
    const objects = materializeTargetRelease(state, options);
    assert.throws(() => validateTargetReleaseObjects({
      targetRepo: state.targetRepo,
      plan: state.plan,
      ...objects,
    }), pattern);
  };

  assertInvalid({
    tree: git(state.targetRepo, ["rev-parse", `${state.targetHead}^{tree}`]),
  }, /tree, sole parent, or exact source\/manifest message/u);
  assertInvalid({
    parent: state.sourceCommit,
  }, /tree, sole parent, or exact source\/manifest message/u);
  assertInvalid({
    sourceCommit: "f".repeat(40),
  }, /tree, sole parent, or exact source\/manifest message/u);
  assertInvalid({
    manifestDigest: "e".repeat(64),
  }, /tree, sole parent, or exact source\/manifest message/u);

  const valid = materializeTargetRelease(state);
  const subject = `Release codex-review-gate-action ${state.plan.immutable_tag}`;
  git(state.targetRepo, ["tag", "-f", "-a", "nested-release-object", valid.releaseCommit, "-m", subject]);
  const nestedObject = git(state.targetRepo, ["rev-parse", "refs/tags/nested-release-object"]);
  git(state.targetRepo, ["tag", "-f", "-a", state.plan.immutable_tag, nestedObject, "-m", subject]);
  assert.throws(() => validateTargetReleaseObjects({
    targetRepo: state.targetRepo,
    plan: state.plan,
    releaseCommit: valid.releaseCommit,
    fullTagObject: git(state.targetRepo, ["rev-parse", `refs/tags/${state.plan.immutable_tag}`]),
  }), /tag object fields/u);
});

test("published release objects reject unknown or duplicate commit and tag headers", (t) => {
  const state = releaseFixture(t);
  const valid = materializeTargetRelease(state);
  const commitText = gitObjectBytes(
    state.targetRepo,
    "commit",
    valid.releaseCommit,
  ).toString("utf8");
  const tagText = gitObjectBytes(
    state.targetRepo,
    "tag",
    valid.fullTagObject,
  ).toString("utf8");
  const installTag = (source) => {
    const objectId = writeRawGitObject(state.targetRepo, "tag", Buffer.from(source));
    git(state.targetRepo, ["update-ref", `refs/tags/${state.plan.immutable_tag}`, objectId]);
    return objectId;
  };
  const tagForCommit = (commitId) => tagText.replace(
    /^object [0-9a-f]{40}$/mu,
    `object ${commitId}`,
  );
  const assertInvalidCommit = (source, pattern) => {
    const releaseCommit = writeRawGitObject(state.targetRepo, "commit", Buffer.from(source));
    const fullTagObject = installTag(tagForCommit(releaseCommit));
    assert.throws(() => validateTargetReleaseObjects({
      targetRepo: state.targetRepo,
      plan: state.plan,
      releaseCommit,
      fullTagObject,
    }), pattern);
  };

  assertInvalidCommit(
    appendGitObjectHeader(commitText, "encoding UTF-8"),
    /commit headers differ from the closed release-object policy/u,
  );
  assertInvalidCommit(
    duplicateGitObjectHeader(commitText, "author"),
    /duplicate author headers/u,
  );
  assertInvalidCommit(
    duplicateGitObjectHeader(commitText, "parent"),
    /duplicate parent headers/u,
  );

  const unknownTagObject = installTag(appendGitObjectHeader(tagText, "encoding UTF-8"));
  assert.throws(() => validateTargetReleaseObjects({
    targetRepo: state.targetRepo,
    plan: state.plan,
    releaseCommit: valid.releaseCommit,
    fullTagObject: unknownTagObject,
  }), /tag headers differ from the closed release-object policy/u);

  const duplicateTaggerObject = installTag(duplicateGitObjectHeader(tagText, "tagger"));
  assert.throws(() => validateTargetReleaseObjects({
    targetRepo: state.targetRepo,
    plan: state.plan,
    releaseCommit: valid.releaseCommit,
    fullTagObject: duplicateTaggerObject,
  }), /duplicate tagger headers/u);
});

test("published release object validation admits an attached annotated-tag signature block", (t) => {
  const state = releaseFixture(t);
  const valid = materializeTargetRelease(state);
  const tagText = gitObjectBytes(
    state.targetRepo,
    "tag",
    valid.fullTagObject,
  ).toString("utf8");
  const signedTagText = `${tagText}-----BEGIN PGP SIGNATURE-----\n\nsynthetic-test-signature\n-----END PGP SIGNATURE-----\n`;
  const fullTagObject = writeRawGitObject(
    state.targetRepo,
    "tag",
    Buffer.from(signedTagText),
  );
  git(state.targetRepo, [
    "update-ref",
    `refs/tags/${state.plan.immutable_tag}`,
    fullTagObject,
  ]);
  assert.equal(validateTargetReleaseObjects({
    targetRepo: state.targetRepo,
    plan: state.plan,
    releaseCommit: valid.releaseCommit,
    fullTagObject,
  }), true);
});

test("previous_version full-tag peel must equal the wrapper commit parent", (t) => {
  const state = releaseFixture(t);
  const valid = materializeTargetRelease(state);
  write(join(state.targetRepo, "legacy-drift.txt"), "unexpected prior release target\n");
  const driftedPrevious = commit(state.targetRepo, "Move historical release target");
  git(state.targetRepo, [
    "tag",
    "-f",
    "-a",
    `v${state.plan.previous_version}`,
    driftedPrevious,
    "-m",
    `Release codex-review-gate-action v${state.plan.previous_version}`,
  ]);
  assert.throws(() => validateTargetReleaseObjects({
    targetRepo: state.targetRepo,
    plan: state.plan,
    releaseCommit: valid.releaseCommit,
    fullTagObject: valid.fullTagObject,
  }), /previous_version tag does not identify the wrapper sole parent/u);
});

test("provenance rejects an invalid stable-alias transition", (t) => {
  const state = releaseFixture(t);
  assert.throws(() => finalizeProvenance({
    candidateDir: state.candidateDir,
    releaseCommit: "a".repeat(40),
    fullTagObject: "b".repeat(40),
    releaseParent: TARGET_HEAD,
    aliasName: "v2",
    aliasBefore: "none",
    aliasMode: "force-with-lease",
    workflowRef: WORKFLOW_REF,
    workflowRunId: "1",
    workflowRunAttempt: "1",
    outputDir: join(state.root, "bad-assets"),
  }), /mode\/object relationship/u);
});

test("public verification detects a same-name Release asset replacement", () => {
  const initial = canonicalReleaseAssetSnapshot({ assets: [releaseAsset(101)] });
  assert.equal(initial, canonicalReleaseAssetSnapshot({ assets: [releaseAsset(101)] }));
  assert.notEqual(initial, canonicalReleaseAssetSnapshot({
    assets: [releaseAsset(101, { digest: `sha256:${"f".repeat(64)}` })],
  }));
  const replacement = canonicalReleaseAssetSnapshot({
    assets: [releaseAsset(202, {
      node_id: "RA_202",
      created_at: "2026-08-25T12:05:00Z",
      updated_at: "2026-08-25T12:05:00Z",
      url: "https://api.github.com/repos/JoeyTeng/codex-review-gate-action/releases/assets/202",
    })],
  });
  assert.notEqual(initial, replacement);
  assert.throws(() => canonicalReleaseAssetSnapshot({
    assets: [releaseAsset(101, {
      uploader: { id: 1, node_id: "U_1", login: "other", type: "User" },
    })],
  }), /asset metadata differs from policy/u);
});

test("release inventory fingerprints only decision-relevant stable metadata", () => {
  const release = {
    id: 11,
    node_id: "RE_11",
    tag_name: "v1.5.1",
    name: "v1.5.1",
    body: "legacy release",
    target_commitish: "master",
    prerelease: false,
    draft: false,
    immutable: true,
    author: { id: 7, node_id: "U_7", login: "JoeyTeng", type: "User" },
    assets: [releaseAsset(101, {
      uploader: { id: 7, node_id: "U_7", login: "JoeyTeng", type: "User" },
      download_count: 0,
    })],
  };
  const secondRelease = {
    ...structuredClone(release),
    id: 12,
    node_id: "RE_12",
    tag_name: "v2.0.0",
    name: "v2.0.0",
    body: "current release",
    author: {
      id: 4700530,
      node_id: "MDM6QXBwNDcwMDUzMA==",
      login: "codex-review-gate-action-publisher[bot]",
      type: "Bot",
    },
    assets: [
      releaseAsset(103, { name: "release-provenance.json.asc" }),
      releaseAsset(102),
    ],
  };
  const initial = canonicalReleaseInventorySnapshot([[release], [secondRelease]]);
  const observationalChange = structuredClone(release);
  observationalChange.assets[0].download_count = 999;
  observationalChange.assets[0].uploader.avatar_url = "https://avatars.invalid/new";
  observationalChange.author.html_url = "https://github.com/JoeyTeng";
  assert.equal(
    initial,
    canonicalReleaseInventorySnapshot([[observationalChange], [secondRelease]]),
  );
  assert.equal(
    initial,
    canonicalReleaseInventorySnapshot([
      [
        { ...structuredClone(secondRelease), assets: [...secondRelease.assets].reverse() },
        structuredClone(observationalChange),
      ],
    ]),
  );
  const identityChange = structuredClone(release);
  identityChange.assets[0].id = 202;
  assert.notEqual(
    initial,
    canonicalReleaseInventorySnapshot([[identityChange], [secondRelease]]),
  );
  const policyChange = structuredClone(release);
  policyChange.draft = true;
  assert.notEqual(
    initial,
    canonicalReleaseInventorySnapshot([[policyChange], [secondRelease]]),
  );
  assert.throws(
    () => canonicalReleaseAssetSnapshot(release),
    /asset metadata differs from policy/u,
  );
});

test("OpenPGP status must bind the exact signing subkey and primary key", () => {
  const accepted = parseVerifiedOpenPgpStatus({
    status: 0,
    stdout: [
      `[GNUPG:] GOODSIG ${SUBKEY.slice(-16)} JoeyTeng-Codex`,
      `[GNUPG:] VALIDSIG ${SUBKEY} 2026-08-25 1800000000 0 4 0 22 8 00 ${PRIMARY}`,
      "",
    ].join("\n"),
  }, "release commit");
  assert.equal(accepted.primaryFingerprint, PRIMARY);
  assert.equal(accepted.signingFingerprint, SUBKEY);
  assert.throws(() => parseVerifiedOpenPgpStatus({
    status: 0,
    stdout: [
      `[GNUPG:] GOODSIG ${SUBKEY.slice(-16)} JoeyTeng-Codex`,
      `[GNUPG:] VALIDSIG ${PRIMARY} 2026-08-25 1800000000 0 4 0 22 8 00 ${PRIMARY}`,
      "",
    ].join("\n"),
  }, "tag"), /signer policy/u);
});

test("OpenPGP status rejects every negative signature state even with the expected VALIDSIG", () => {
  const good = `[GNUPG:] GOODSIG ${SUBKEY.slice(-16)} JoeyTeng-Codex`;
  const valid = `[GNUPG:] VALIDSIG ${SUBKEY} 2026-08-25 1800000000 0 4 0 22 8 00 ${PRIMARY}`;
  for (const negative of [
    `[GNUPG:] BADSIG ${SUBKEY.slice(-16)} JoeyTeng-Codex`,
    `[GNUPG:] ERRSIG ${SUBKEY.slice(-16)} 22 8 00 1800000000 9 ${SUBKEY}`,
    `[GNUPG:] REVKEYSIG ${SUBKEY} JoeyTeng-Codex`,
    `[GNUPG:] EXPKEYSIG ${SUBKEY} JoeyTeng-Codex`,
    `[GNUPG:] KEYEXPIRED 1800000000`,
    `[GNUPG:] KEYREVOKED`,
    `[GNUPG:] NO_PUBKEY ${SUBKEY.slice(-16)}`,
    `[GNUPG:] EXPSIG ${SUBKEY} JoeyTeng-Codex`,
    `[GNUPG:] FAILURE verify 33554433`,
    `[GNUPG:] ERROR verify 33554433`,
    `[GNUPG:] SIGEXPIRED 1800000000`,
  ]) {
    assert.throws(
      () => parseVerifiedOpenPgpStatus({
        status: 0,
        stdout: `${negative}\n${good}\n${valid}\n`,
      }, "detached provenance"),
      `must reject ${negative}`,
    );
  }
});

test("OpenPGP status accepts exactly one expected VALIDSIG", () => {
  const good = `[GNUPG:] GOODSIG ${SUBKEY.slice(-16)} JoeyTeng-Codex`;
  const valid = `[GNUPG:] VALIDSIG ${SUBKEY} 2026-08-25 1800000000 0 4 0 22 8 00 ${PRIMARY}`;
  assert.throws(() => parseVerifiedOpenPgpStatus({ status: 0, stdout: "" }, "release commit"),
    /exactly one GOODSIG and one VALIDSIG/u);
  assert.throws(() => parseVerifiedOpenPgpStatus({
    status: 0,
    stdout: `${good}\n${valid}\n${valid}\n`,
  }, "release commit"), /exactly one GOODSIG and one VALIDSIG/u);
  assert.throws(() => parseVerifiedOpenPgpStatus({
    status: 0,
    stdout: `${good}\n${valid}\n[GNUPG:] VALIDSIG ${PRIMARY} 2026-08-25 1800000000 0 4 0 22 8 00 ${PRIMARY}\n`,
  }, "release commit"), /exactly one GOODSIG and one VALIDSIG/u);
  assert.throws(() => parseVerifiedOpenPgpStatus({
    status: 0,
    stdout: `${good}\n${good}\n${valid}\n`,
  }, "release commit"), /exactly one GOODSIG and one VALIDSIG/u);
});

test("GitHub GPG inventory selects exactly one current pinned signing certificate", () => {
  const selected = {
    id: 5277815,
    primary_key_id: null,
    key_id: PRIMARY.slice(-16),
    raw_key: RELEASE_SIGNING_PUBLIC_KEY,
    revoked: false,
    expires_at: null,
    can_sign: true,
    subkeys: [{
      id: 5277817,
      primary_key_id: 5277815,
      key_id: SUBKEY.slice(-16),
      revoked: false,
      expires_at: null,
      can_sign: true,
    }],
  };
  const options = { primaryFingerprint: PRIMARY, signingFingerprint: SUBKEY };
  assert.equal(
    validateGitHubSigningKeyInventory([selected], options),
    RELEASE_SIGNING_PUBLIC_KEY,
  );

  for (const malformed of [null, {}, "unreadable", [null]]) {
    assert.throws(
      () => validateGitHubSigningKeyInventory(malformed, options),
      `must reject malformed GitHub GPG response: ${JSON.stringify(malformed)}`,
    );
  }
  assert.throws(() => validateGitHubSigningKeyInventory([], options));
  assert.throws(() => validateGitHubSigningKeyInventory([
    selected,
    { ...structuredClone(selected), id: 201 },
  ], options));

  const rejectMutation = (label, mutate) => {
    const inventory = [structuredClone(selected)];
    mutate(inventory[0]);
    assert.throws(
      () => validateGitHubSigningKeyInventory(inventory, options),
      `must reject GitHub GPG inventory with ${label}`,
    );
  };
  rejectMutation("revoked primary", (key) => { key.revoked = true; });
  rejectMutation("expiring primary", (key) => { key.expires_at = "2027-01-01T00:00:00Z"; });
  rejectMutation("non-signing primary", (key) => { key.can_sign = false; });
  rejectMutation("missing raw public key", (key) => { key.raw_key = null; });
  rejectMutation("mismatched primary key ID", (key) => { key.key_id = "0".repeat(16); });
  rejectMutation("missing signing subkey", (key) => { key.subkeys = []; });
  rejectMutation("duplicate signing subkey", (key) => {
    key.subkeys.push({ ...structuredClone(key.subkeys[0]), id: 103 });
  });
  rejectMutation("revoked signing subkey", (key) => { key.subkeys[0].revoked = true; });
  rejectMutation("expiring signing subkey", (key) => {
    key.subkeys[0].expires_at = "2027-01-01T00:00:00Z";
  });
  rejectMutation("non-signing subkey", (key) => { key.subkeys[0].can_sign = false; });
  rejectMutation("unlinked signing subkey", (key) => { key.subkeys[0].primary_key_id = 999; });
  rejectMutation("mismatched signing key ID", (key) => { key.subkeys[0].key_id = "0".repeat(16); });

  rejectMutation("raw key content mismatch", (key) => {
    key.raw_key = key.raw_key.replace("Y29ZomqF1Ca0", "Y29ZomqF1Ca1");
  });
});

test("release keyring requires one valid non-expiring signing secret subkey", (t) => {
  const root = mkdtempSync("/tmp/release-signing-keyring-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourceHome = join(root, "source");
  const validHome = join(root, "valid");
  mkdirSync(sourceHome, { mode: 0o700 });
  mkdirSync(validHome, { mode: 0o700 });
  gpg(sourceHome, [
    "--passphrase", "",
    "--quick-generate-key",
    "Release Pipeline Test <release-pipeline@example.invalid>",
    "ed25519", "cert", "0",
  ]);
  const [primary] = keyFingerprints(sourceHome);
  gpg(sourceHome, ["--passphrase", "", "--quick-add-key", primary, "ed25519", "sign", "0"]);
  gpg(sourceHome, ["--passphrase", "", "--quick-add-key", primary, "cv25519", "encr", "0"]);
  const [, signing, encryption] = keyFingerprints(sourceHome);
  const publicPath = join(root, "public.asc");
  const signingSecretPath = join(root, "signing-secret.asc");
  const encryptionSecretPath = join(root, "encryption-secret.asc");
  gpg(sourceHome, ["--armor", "--output", publicPath, "--export", primary]);
  gpg(sourceHome, [
    "--passphrase", "", "--armor", "--output", signingSecretPath,
    "--export-secret-subkeys", `${signing}!`,
  ]);
  gpg(sourceHome, [
    "--passphrase", "", "--armor", "--output", encryptionSecretPath,
    "--export-secret-subkeys", `${encryption}!`,
  ]);
  gpg(validHome, ["--import", publicPath]);
  gpg(validHome, ["--import", signingSecretPath]);
  assert.equal(validateSigningKeyHome({
    gnupgHome: validHome,
    primaryFingerprint: primary,
    signingFingerprint: signing,
  }), true);
  assert.throws(() => validateSigningKeyHome({
    gnupgHome: sourceHome,
    primaryFingerprint: primary,
    signingFingerprint: signing,
  }), /no primary secret material/u);
  gpg(validHome, ["--import", encryptionSecretPath]);
  assert.throws(() => validateSigningKeyHome({
    gnupgHome: validHome,
    primaryFingerprint: primary,
    signingFingerprint: signing,
  }), /exactly one valid non-expiring pinned signing subkey/u);
});

test("release keyring rejects even a still-valid key that carries an expiry", (t) => {
  const root = mkdtempSync("/tmp/release-expiring-keyring-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourceHome = join(root, "source");
  const strippedHome = join(root, "stripped");
  mkdirSync(sourceHome, { mode: 0o700 });
  mkdirSync(strippedHome, { mode: 0o700 });
  gpg(sourceHome, [
    "--passphrase", "",
    "--quick-generate-key",
    "Expiring Release Test <expiring-release@example.invalid>",
    "ed25519", "cert", "1d",
  ]);
  const [primary] = keyFingerprints(sourceHome);
  gpg(sourceHome, ["--passphrase", "", "--quick-add-key", primary, "ed25519", "sign", "1d"]);
  const [, signing] = keyFingerprints(sourceHome);
  const publicPath = join(root, "public.asc");
  const signingSecretPath = join(root, "signing-secret.asc");
  gpg(sourceHome, ["--armor", "--output", publicPath, "--export", primary]);
  gpg(sourceHome, [
    "--passphrase", "", "--armor", "--output", signingSecretPath,
    "--export-secret-subkeys", `${signing}!`,
  ]);
  gpg(strippedHome, ["--import", publicPath]);
  gpg(strippedHome, ["--import", signingSecretPath]);
  assert.throws(() => validateSigningKeyHome({
    gnupgHome: strippedHome,
    primaryFingerprint: primary,
    signingFingerprint: signing,
  }), /valid non-expiring pinned primary key/u);
});

test("runtime discovery admits only the declared v2 runtime module", () => {
  assert.deepEqual(discoverV2RuntimeModulePaths({
    "src/v2/gate-runtime.mjs": {},
    ".github/workflows/codex-review-gate.yml": {},
    "action.yml": {},
  }), ["src/v2/gate-runtime.mjs"]);
});

test("manifest writer is create-only and byte-stable", async () => {
  const root = mkdtempSync(join(tmpdir(), "release-provenance-write-"));
  try {
    const path = join(root, "release-provenance.json");
    const result = await writeManifest(path, { schema: "test", value: 2 });
    assert.match(result.digest, /^[0-9a-f]{64}$/u);
    assert.equal(readFileSync(path, "utf8"), '{\n  "schema": "test",\n  "value": 2\n}\n');
    await assert.rejects(() => writeManifest(path, { changed: true }), /EEXIST/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
