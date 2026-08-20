#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SOURCE_REPOSITORY = "Joey-Tools/codex-review-gate";
const ACTION_REPOSITORY = "Joey-Tools/codex-review-gate-action";
const FROZEN_REPOSITORY = "JoeyTeng/codex-review-gate-action";
const RELEASE_VERSION = "2.0.0";
const SOURCE_PACKAGE_NAME = "codex-review-gate-source";
const SOURCE_PACKAGE_REPOSITORY_URL =
  "git+https://github.com/Joey-Tools/codex-review-gate.git";
const ACTION_PACKAGE_NAME = "codex-review-gate-action";
const ACTION_PACKAGE_REPOSITORY_URL =
  "git+https://github.com/Joey-Tools/codex-review-gate-action.git";
const PACKAGE_MANIFEST_PATH = "package.json";
const RELEASE_TAGS = ["v2.0.0", "v2.0", "v2"];
const PROVENANCE_SCHEMA_ID =
  "urn:joey-tools:codex-review-gate:action-release-provenance:3";
const BASELINE_SCHEMA_ID =
  "urn:joey-tools:codex-review-gate:action-v2-repository-baselines:1";
const PRODUCTION_BASELINE_SHA256 =
  "63dc08cdf35720a5659ec6e2557ac4a3f49c26be331f4b62d1cb3e402336df6a";
const ACTION_PREFIX = "packages/action";
const ACTION_ENTRY_PATH = "action.yml";
const REUSABLE_WORKFLOW_PATH = ".github/workflows/codex-review-gate.yml";
const RECONCILE_WORKFLOW_PATH =
  ".github/workflows/codex-review-gate-reconcile.yml";
const CONTROLLER_PATH = "src/v2/workflow-controller.mjs";
const PLAN_ADAPTER_PATH = "src/v2/action.mjs";
const EVIDENCE_AUTHORITY_POLICY_PATH =
  "github-codex-evidence-authority-v2.json";
const V2_RUNTIME_DIRECTORY = "src/v2/";
const V2_RUNTIME_MODULE_PATTERN =
  /^src\/v2\/[a-z0-9]+(?:-[a-z0-9]+)*\.mjs$/u;
const REGULAR_BLOB_MODES = new Set(["100644", "100755"]);
const SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const FINGERPRINT_PATTERN = /^(?:[0-9A-F]{40}|[0-9A-F]{64})$/;
const MAX_GIT_OUTPUT = 128 * 1024 * 1024;
const MAX_TREE_ENTRIES = 10_000;
const MAX_TREE_BYTES = 256 * 1024 * 1024;
const TEST_ONLY_ENVIRONMENT =
  "CODEX_REVIEW_GATE_RELEASE_PROVENANCE_TEST_ONLY";
const TRUSTED_GIT_EXECUTABLE = "/usr/bin/git";

function usage() {
  return `Usage: node scripts/generate-action-release-provenance.mjs \\
  --source-repo <path> --source-ref <ref> \\
  --action-repo <path> --action-ref <ref> \\
  --target-refs <ls-remote.tsv> --frozen-refs <ls-remote.tsv> \\
  --baseline <baseline.json> --expected-signing-fingerprint <fingerprint> \\
  --output <path>

Generate the create-only v2.0.0 action release provenance manifest. The action
repository must already contain the complete subtree split and the direct,
signed annotated v2.0.0, v2.0, and v2 tag objects. Remote snapshots use exact
"<oid>\\t<ref>" lines from "git ls-remote --refs".

Use --verify-initial-baselines with --action-repo, --target-refs,
--frozen-refs, and --baseline to verify the read-only pre-release state without
creating tags or a manifest.

Use --verify-candidate with those inputs plus --source-repo, --source-ref,
--action-ref to verify the complete split DAG, tree equality, and v2 runtime
identity without creating tags or a manifest.

Production identities are closed to:
  source: ${SOURCE_REPOSITORY}
  target: ${ACTION_REPOSITORY}
  frozen read-only baseline: ${FROZEN_REPOSITORY}

Tests may add --test-only-skip-signatures only when
${TEST_ONLY_ENVIRONMENT}=1 and NODE_ENV=test.`;
}

function parseArguments(argv) {
  const options = {
    sourceRepository: SOURCE_REPOSITORY,
    actionRepository: ACTION_REPOSITORY,
    immutableTagRef: "refs/tags/v2.0.0",
    minorTagRef: "refs/tags/v2.0",
    majorTagRef: "refs/tags/v2",
    testOnlySkipSignatures: false,
    verifyInitialBaselines: false,
    verifyCandidate: false,
  };
  const valued = new Map([
    ["--source-repo", "sourceRepo"],
    ["--source-ref", "sourceRef"],
    ["--source-repository", "sourceRepository"],
    ["--action-repo", "actionRepo"],
    ["--action-ref", "actionRef"],
    ["--action-repository", "actionRepository"],
    ["--target-refs", "targetRefs"],
    ["--frozen-refs", "frozenRefs"],
    ["--baseline", "baseline"],
    ["--expected-signing-fingerprint", "expectedSigningFingerprint"],
    ["--immutable-tag-ref", "immutableTagRef"],
    ["--minor-tag-ref", "minorTagRef"],
    ["--major-tag-ref", "majorTagRef"],
    ["--output", "output"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--test-only-skip-signatures") {
      options.testOnlySkipSignatures = true;
      continue;
    }
    if (argument === "--verify-initial-baselines") {
      options.verifyInitialBaselines = true;
      continue;
    }
    if (argument === "--verify-candidate") {
      options.verifyCandidate = true;
      continue;
    }
    const key = valued.get(argument);
    if (!key) {
      throw new Error(`unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value`);
    }
    options[key] = value;
    index += 1;
  }
  if (options.help) {
    return options;
  }
  if (options.verifyInitialBaselines && options.verifyCandidate) {
    throw new Error("choose only one verification mode");
  }
  const requiredKeys = options.verifyInitialBaselines
    ? ["actionRepo", "targetRefs", "frozenRefs", "baseline"]
    : options.verifyCandidate
      ? [
          "sourceRepo",
          "sourceRef",
          "actionRepo",
          "actionRef",
          "targetRefs",
          "frozenRefs",
          "baseline",
        ]
    : [
        "sourceRepo",
        "sourceRef",
        "actionRepo",
        "actionRef",
        "targetRefs",
        "frozenRefs",
        "baseline",
        "output",
      ];
  for (const key of requiredKeys) {
    if (!options[key]) {
      throw new Error(`missing required option: ${key}`);
    }
  }
  if (options.sourceRepository !== SOURCE_REPOSITORY) {
    throw new Error(`source repository must be exactly ${SOURCE_REPOSITORY}`);
  }
  if (options.actionRepository !== ACTION_REPOSITORY) {
    throw new Error(`action repository must be exactly ${ACTION_REPOSITORY}`);
  }
  const closedTestEnvironment =
    process.env[TEST_ONLY_ENVIRONMENT] === "1" && process.env.NODE_ENV === "test";
  if (options.testOnlySkipSignatures && !closedTestEnvironment) {
    throw new Error("test-only signature bypass requires the closed test environment");
  }
  if (!closedTestEnvironment) {
    const productionBaseline = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "docs",
      "release",
      "action-v2-repository-baselines.json",
    );
    if (resolve(options.baseline) !== productionBaseline) {
      throw new Error("production baseline path is fixed to the source release contract");
    }
  }
  const expectedTagRefs = RELEASE_TAGS.map((tag) => `refs/tags/${tag}`);
  const actualTagRefs = [
    options.immutableTagRef,
    options.minorTagRef,
    options.majorTagRef,
  ];
  if (JSON.stringify(actualTagRefs) !== JSON.stringify(expectedTagRefs)) {
    throw new Error("release tag refs must be exactly v2.0.0, v2.0, and v2");
  }
  if ((options.verifyInitialBaselines || options.verifyCandidate) && options.testOnlySkipSignatures) {
    throw new Error("baseline and candidate verification do not accept signature bypass");
  }
  if (options.verifyInitialBaselines || options.verifyCandidate) {
    return options;
  }
  if (options.testOnlySkipSignatures) {
    if (
      process.env[TEST_ONLY_ENVIRONMENT] !== "1" ||
      process.env.NODE_ENV !== "test"
    ) {
      throw new Error("test-only signature bypass requires the closed test environment");
    }
    if (options.expectedSigningFingerprint) {
      throw new Error("test-only signature bypass cannot claim a signing fingerprint");
    }
  } else if (!options.expectedSigningFingerprint) {
    throw new Error("--expected-signing-fingerprint is required in production");
  }
  return options;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertSha(value, label) {
  if (!SHA_PATTERN.test(value)) {
    throw new Error(`${label} is not an exact Git object ID`);
  }
  return value;
}

function normalizeFingerprint(value, label) {
  const normalized = value.replaceAll(/\s+/g, "").toUpperCase();
  if (!FINGERPRINT_PATTERN.test(normalized)) {
    throw new Error(`${label} is not a full OpenPGP fingerprint`);
  }
  return normalized;
}

function git(repo, args, { allowFailure = false, input, maxBuffer } = {}) {
  const environment = {
    GIT_ASKPASS: "/usr/bin/false",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_GRAFT_FILE: "/dev/null",
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    LANG: "C",
    LC_ALL: "C",
    PAGER: "cat",
    PATH: "/usr/bin:/bin",
  };
  // Signature verification receives only the explicitly selected keyring.
  // No ambient Git repository, object-store, config-count, or executable
  // override is inherited into provenance queries.
  if (process.env.GNUPGHOME) environment.GNUPGHOME = process.env.GNUPGHOME;
  const result = spawnSync(
    TRUSTED_GIT_EXECUTABLE,
    [
      "--no-pager",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.attributesFile=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.commitGraph=false",
      "-c",
      "core.multiPackIndex=false",
      "-c",
      "color.ui=false",
      "-C",
      repo,
      ...args,
    ],
    {
      encoding: null,
      env: environment,
      input,
      maxBuffer: maxBuffer ?? MAX_GIT_OUTPUT,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    },
  );
  if (result.error) {
    throw result.error;
  }
  if (!allowFailure && result.status !== 0) {
    const detail = result.stderr.toString("utf8").trim();
    throw new Error(`git ${args[0]} failed${detail ? `: ${detail}` : ""}`);
  }
  return result;
}

function gitText(repo, args) {
  return git(repo, args).stdout.toString("utf8").trim();
}

async function canonicalRepoPath(path, label) {
  const canonical = await realpath(resolve(path));
  if (gitText(canonical, ["rev-parse", "--is-inside-work-tree"]) !== "true" &&
      gitText(canonical, ["rev-parse", "--is-bare-repository"]) !== "true") {
    throw new Error(`${label} is not a Git repository`);
  }
  return canonical;
}

function resolveObject(repo, ref, label) {
  return assertSha(gitText(repo, ["rev-parse", "--verify", ref]), label);
}

function resolveCommit(repo, ref, label) {
  return assertSha(gitText(repo, ["rev-parse", "--verify", `${ref}^{commit}`]), label);
}

async function readStableFile(path, label) {
  const absolute = resolve(path);
  const before = await lstat(absolute, { bigint: true });
  if (!before.isFile()) {
    throw new Error(`${label} must be a regular file`);
  }
  const bytes = await readFile(absolute);
  const middle = await lstat(absolute, { bigint: true });
  const confirmation = await readFile(absolute);
  const after = await lstat(absolute, { bigint: true });
  // Protected properties are path-bound object identity (dev/ino/type), access
  // policy (owner/group/mode), and exact content (size plus two equal reads).
  // Timestamps are mutation signals, not protected properties, so benign
  // metadata churn is accepted when these selected properties stay equal.
  for (const field of ["dev", "ino", "mode", "uid", "gid", "size"]) {
    if (before[field] !== middle[field] || before[field] !== after[field]) {
      throw new Error(`${label} object identity or access policy changed while reading`);
    }
  }
  if (!bytes.equals(confirmation) || BigInt(bytes.length) !== before.size) {
    throw new Error(`${label} content changed while reading`);
  }
  return {
    absolute,
    bytes,
    sha256: sha256(bytes),
    identity: {
      dev: before.dev.toString(),
      ino: before.ino.toString(),
      mode: before.mode.toString(),
      uid: before.uid.toString(),
      gid: before.gid.toString(),
      size: before.size.toString(),
    },
  };
}

function decodeUtf8(bytes, label) {
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!Buffer.from(decoded, "utf8").equals(bytes)) {
    throw new Error(`${label} is not canonical UTF-8`);
  }
  return decoded;
}

function assertSafeRefName(ref, label) {
  if (
    !ref.startsWith("refs/") ||
    /[\u0000-\u0020\u007f~^:?*[\\]/.test(ref) ||
    ref.includes("..") ||
    ref.includes("@{") ||
    ref.endsWith(".") ||
    ref.endsWith("/")
  ) {
    throw new Error(`${label} contains an invalid ref name: ${JSON.stringify(ref)}`);
  }
}

function parseRefSnapshot(stableFile, label) {
  const text = decodeUtf8(stableFile.bytes, label);
  const refs = {};
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
  for (const [index, line] of lines.entries()) {
    const match = /^([0-9a-f]{40}|[0-9a-f]{64})\t([^\t]+)$/.exec(line);
    if (!match) {
      throw new Error(`${label} line ${index + 1} is not an exact ls-remote record`);
    }
    const [, oid, ref] = match;
    assertSafeRefName(ref, `${label} line ${index + 1}`);
    if (Object.hasOwn(refs, ref)) {
      throw new Error(`${label} repeats ${ref}`);
    }
    refs[ref] = oid;
  }
  const sortedNames = Object.keys(refs).sort();
  if (JSON.stringify(Object.keys(refs)) !== JSON.stringify(sortedNames)) {
    throw new Error(`${label} must be bytewise sorted by ref name`);
  }
  return refs;
}

function assertPlainRefMap(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const names = Object.keys(value);
  if (JSON.stringify(names) !== JSON.stringify([...names].sort())) {
    throw new Error(`${label} keys must be bytewise sorted`);
  }
  for (const [ref, oid] of Object.entries(value)) {
    assertSafeRefName(ref, label);
    assertSha(oid, `${label}.${ref}`);
  }
}

function assertExactObject(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} differs from the frozen contract`);
  }
}

function parseBaseline(stableFile) {
  const closedTestEnvironment =
    process.env[TEST_ONLY_ENVIRONMENT] === "1" && process.env.NODE_ENV === "test";
  if (!closedTestEnvironment && stableFile.sha256 !== PRODUCTION_BASELINE_SHA256) {
    throw new Error("release baseline bytes differ from the permanent production freeze");
  }
  let baseline;
  try {
    baseline = JSON.parse(decodeUtf8(stableFile.bytes, "release baseline"));
  } catch (error) {
    throw new Error(`release baseline is not valid JSON: ${error.message}`);
  }
  if (
    baseline?.$schema !== BASELINE_SCHEMA_ID ||
    baseline?.schema_version !== 1 ||
    baseline?.frozen_repository?.repository !== FROZEN_REPOSITORY ||
    baseline?.target_repository?.repository !== ACTION_REPOSITORY ||
    baseline?.release?.version !== RELEASE_VERSION ||
    baseline?.release?.immutable_tag !== RELEASE_TAGS[0] ||
    JSON.stringify(baseline?.release?.aliases) !==
      JSON.stringify(RELEASE_TAGS.slice(1))
  ) {
    throw new Error("release baseline identity or v2 selector contract is invalid");
  }
  assertPlainRefMap(baseline.frozen_repository.refs, "frozen_repository.refs");
  assertPlainRefMap(baseline.target_repository.refs, "target_repository.refs");
  assertSha(
    baseline.frozen_repository.default_commit_oid,
    "frozen_repository.default_commit_oid",
  );
  assertSha(
    baseline.frozen_repository.default_tree_oid,
    "frozen_repository.default_tree_oid",
  );
  assertSha(
    baseline.target_repository.default_commit_oid,
    "target_repository.default_commit_oid",
  );
  assertSha(
    baseline.target_repository.default_tree_oid,
    "target_repository.default_tree_oid",
  );
  if (
    baseline.target_repository.head_commit_count !== 21 ||
    baseline.target_repository.head_root_count !== 2
  ) {
    throw new Error("target initial history cardinality differs from the transfer baseline");
  }
  return baseline;
}

function readBlob(repo, ref, path, label = path) {
  const result = git(repo, ["show", `${ref}:${path}`], { allowFailure: true });
  if (result.status !== 0) {
    throw new Error(`${label} is missing from the released action tree`);
  }
  return result.stdout;
}

function collectExactBlobIdentity(repo, commit, path, label) {
  const raw = git(
    repo,
    ["ls-tree", "-z", "--full-tree", commit, "--", path],
  ).stdout;
  if (raw.length === 0) {
    throw new Error(`${label} is missing`);
  }
  if (raw.at(-1) !== 0 || raw.subarray(0, -1).includes(0)) {
    throw new Error(`${label} does not resolve to exactly one Git tree entry`);
  }
  const record = raw.subarray(0, -1);
  const tab = record.indexOf(0x09);
  if (tab < 0) {
    throw new Error(`${label} has a malformed Git tree entry`);
  }
  const header = record.subarray(0, tab).toString("ascii");
  const match = /^(\d{6}) (blob) ([0-9a-f]{40}|[0-9a-f]{64})$/.exec(header);
  const actualPath = decodeUtf8(record.subarray(tab + 1), `${label} path`);
  if (!match || actualPath !== path || !REGULAR_BLOB_MODES.has(match[1])) {
    throw new Error(`${label} must be an exact regular non-symlink Git blob`);
  }
  const bytes = git(repo, ["cat-file", "blob", match[3]]).stdout;
  return {
    path,
    object_oid: match[3],
    sha256: sha256(bytes),
    bytes,
  };
}

function parsePackageIdentity(
  entry,
  { expectedName, expectedRepositoryUrl, label, role },
) {
  let packageManifest;
  try {
    packageManifest = JSON.parse(decodeUtf8(entry.bytes, label));
  } catch (error) {
    throw new Error(`${label} is invalid: ${error.message}`);
  }
  if (
    packageManifest?.name !== expectedName ||
    packageManifest?.version !== RELEASE_VERSION ||
    packageManifest?.repository?.type !== "git" ||
    packageManifest?.repository?.url !== expectedRepositoryUrl
  ) {
    throw new Error(
      `${label} must identify ${expectedName}@${RELEASE_VERSION} at ${expectedRepositoryUrl}`,
    );
  }
  return {
    role,
    path: entry.path,
    object_oid: entry.object_oid,
    sha256: entry.sha256,
    name: expectedName,
    version: RELEASE_VERSION,
    repository_url: expectedRepositoryUrl,
  };
}

function verifySourcePackageIdentity(repo, sourceCommit) {
  return parsePackageIdentity(
    collectExactBlobIdentity(
      repo,
      sourceCommit,
      PACKAGE_MANIFEST_PATH,
      "source package.json",
    ),
    {
      expectedName: SOURCE_PACKAGE_NAME,
      expectedRepositoryUrl: SOURCE_PACKAGE_REPOSITORY_URL,
      label: "source package.json",
      role: "v2-source-package",
    },
  );
}

function parseDirectTagHeader(raw, expectedName, actionCommit) {
  const text = decodeUtf8(raw, `${expectedName} tag object`);
  const headerEnd = text.indexOf("\n\n");
  if (headerEnd < 0) {
    throw new Error(`${expectedName} tag object is missing its header boundary`);
  }
  const headers = new Map();
  for (const line of text.slice(0, headerEnd).split("\n")) {
    const separator = line.indexOf(" ");
    if (separator < 1) {
      throw new Error(`${expectedName} tag object contains an invalid header`);
    }
    const key = line.slice(0, separator);
    if (headers.has(key)) {
      throw new Error(`${expectedName} tag object repeats header ${key}`);
    }
    headers.set(key, line.slice(separator + 1));
  }
  if (
    headers.get("object") !== actionCommit ||
    headers.get("type") !== "commit" ||
    headers.get("tag") !== expectedName
  ) {
    throw new Error(
      `${expectedName} must be a direct annotated tag for action commit ${actionCommit}`,
    );
  }
}

export function parseVerifiedOpenPgpStatus(result, expectedName) {
  const statusText = `${result.stdout.toString("utf8")}\n${result.stderr.toString("utf8")}`;
  const records = statusText
    .split(/\r?\n/)
    .filter((line) => line.startsWith("[GNUPG:] "))
    .map((line) => {
      const match = /^\[GNUPG:\] ([A-Z_]+)(?: (.*))?$/.exec(line);
      if (!match) {
        throw new Error(`${expectedName} emitted a malformed GnuPG status line`);
      }
      return { type: match[1], payload: match[2] ?? "" };
    });
  const rejecting = new Set([
    "BADSIG",
    "ERRSIG",
    "EXPKEYSIG",
    "EXPSIG",
    "NO_PUBKEY",
    "REVKEYSIG",
  ]);
  if (records.some(({ type }) => rejecting.has(type))) {
    throw new Error(`${expectedName} emitted a rejecting GnuPG signature status`);
  }
  const good = records.filter(({ type }) => type === "GOODSIG");
  const valid = records.filter(({ type }) => type === "VALIDSIG");
  if (good.length !== 1 || valid.length !== 1) {
    throw new Error(`${expectedName} must emit exactly one GOODSIG and one VALIDSIG status`);
  }
  const keyId = good[0].payload.split(" ", 1)[0].toUpperCase();
  const fields = valid[0].payload.trim().split(/\s+/);
  const signingKeyFingerprint = fields[0]?.toUpperCase();
  // GnuPG appends the primary fingerprint only when a signing subkey made the
  // signature. A primary-key signature uses the nine-field form, where the
  // signing and primary fingerprints are the same.
  const primaryKeyFingerprint =
    (fields.length === 10 ? fields[9] : fields.length === 9 ? fields[0] : undefined)
      ?.toUpperCase();
  const keyPattern = /^(?:[0-9A-F]{16}|[0-9A-F]{40}|[0-9A-F]{64})$/;
  const identityMatches =
    keyId.length === 16
      ? signingKeyFingerprint?.endsWith(keyId)
      : signingKeyFingerprint === keyId;
  if (
    (fields.length !== 9 && fields.length !== 10) ||
    !keyPattern.test(keyId) ||
    !FINGERPRINT_PATTERN.test(signingKeyFingerprint) ||
    !FINGERPRINT_PATTERN.test(primaryKeyFingerprint) ||
    !identityMatches
  ) {
    throw new Error(`${expectedName} emitted inconsistent GOODSIG/VALIDSIG identity`);
  }
  return {
    signingKeyFingerprint: signingKeyFingerprint.toLowerCase(),
    primaryKeyFingerprint: primaryKeyFingerprint.toLowerCase(),
  };
}

function resolveTrustedGpgExecutable() {
  for (const candidate of [
    "/usr/bin/gpg",
    "/opt/homebrew/bin/gpg",
    "/usr/local/bin/gpg",
  ]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error("no trusted fixed-path OpenPGP verifier is available");
}

function verifyTag(repo, ref, expectedName, actionCommit, skipSignatures) {
  const refObjectOid = resolveObject(repo, ref, `${expectedName} tag ref`);
  const tagObjectOid = resolveObject(repo, `${ref}^{tag}`, `${expectedName} tag object`);
  if (refObjectOid !== tagObjectOid) {
    throw new Error(`${expectedName} tag ref does not point directly to its tag object`);
  }
  if (gitText(repo, ["cat-file", "-t", tagObjectOid]) !== "tag") {
    throw new Error(`${expectedName} must resolve to an annotated tag object`);
  }
  parseDirectTagHeader(
    git(repo, ["cat-file", "tag", tagObjectOid]).stdout,
    expectedName,
    actionCommit,
  );
  const peeledCommitOid = resolveCommit(repo, ref, `${expectedName} peeled commit`);
  if (peeledCommitOid !== actionCommit) {
    throw new Error(`${expectedName} does not peel directly to ${actionCommit}`);
  }
  let signature;
  if (skipSignatures) {
    signature = {
      verified: false,
      method: "closed-test-only-skip",
      signing_key_fingerprint: null,
      primary_key_fingerprint: null,
    };
  } else {
    const gpg = resolveTrustedGpgExecutable();
    const verification = git(
      repo,
      [
        "-c",
        "gpg.format=openpgp",
        "-c",
        `gpg.program=${gpg}`,
        "-c",
        `gpg.openpgp.program=${gpg}`,
        "verify-tag",
        "--raw",
        tagObjectOid,
      ],
      { allowFailure: true, maxBuffer: 4 * 1024 * 1024 },
    );
    if (verification.status !== 0) {
      throw new Error(`${expectedName} OpenPGP signature verification failed`);
    }
    const fingerprints = parseVerifiedOpenPgpStatus(verification, expectedName);
    signature = {
      verified: true,
      method: "git-verify-tag-openpgp-raw",
      signing_key_fingerprint: fingerprints.signingKeyFingerprint,
      primary_key_fingerprint: fingerprints.primaryKeyFingerprint,
    };
  }
  return {
    ref,
    tag_object_oid: tagObjectOid,
    peeled_commit_oid: peeledCommitOid,
    object_type: "tag",
    target_type: "commit",
    direct: true,
    signature,
  };
}

function collectHistory(repo, starts, label) {
  if (starts.length === 0) {
    throw new Error(`${label} has no commit roots`);
  }
  const text = gitText(repo, ["rev-list", "--parents", "--topo-order", ...starts]);
  const commits = new Map();
  let edgeCount = 0;
  for (const line of text.split("\n")) {
    const [oid, ...parents] = line.split(" ");
    assertSha(oid, `${label} commit`);
    parents.forEach((parent) => assertSha(parent, `${label} parent`));
    if (commits.has(oid)) {
      throw new Error(`${label} emitted duplicate commit ${oid}`);
    }
    commits.set(oid, parents);
    edgeCount += parents.length;
  }
  for (const parents of commits.values()) {
    for (const parent of parents) {
      if (!commits.has(parent)) {
        throw new Error(`${label} is missing reachable parent ${parent}`);
      }
    }
  }
  const rows = [...commits.entries()]
    .map(([oid, parents]) => `${oid}${parents.map((parent) => ` ${parent}`).join("")}`)
    .sort();
  const roots = [...commits.entries()]
    .filter(([, parents]) => parents.length === 0)
    .map(([oid]) => oid)
    .sort();
  const oidBytes = starts[0]?.length === 64 ? 32 : 20;
  return {
    encoding: "bytewise-sorted '<commit> <parent>...' rows joined with LF",
    commit_count: commits.size,
    parent_edge_count: edgeCount,
    root_count: roots.length,
    root_commit_oids: roots,
    parent_graph_sha256: sha256(Buffer.from(`${rows.join("\n")}\n`, "ascii")),
    commit_set_sha256: sha256(
      Buffer.concat(
        [...commits.keys()]
          .sort()
          .map((oid) => Buffer.from(oid, "hex")),
        commits.size * oidBytes,
      ),
    ),
  };
}

export async function verifyInitialBaselines(options) {
  const actionRepo = await canonicalRepoPath(options.actionRepo, "action repo");
  const [targetFile, frozenFile, baselineFile] = await Promise.all([
    readStableFile(options.targetRefs, "target ref snapshot"),
    readStableFile(options.frozenRefs, "frozen ref snapshot"),
    readStableFile(options.baseline, "release baseline"),
  ]);
  const targetRefs = parseRefSnapshot(targetFile, "target ref snapshot");
  const frozenRefs = parseRefSnapshot(frozenFile, "frozen ref snapshot");
  const baseline = parseBaseline(baselineFile);
  assertExactObject(
    targetRefs,
    baseline.target_repository.refs,
    "initial Joey-Tools action refs",
  );
  assertExactObject(
    frozenRefs,
    baseline.frozen_repository.refs,
    "frozen personal repository refs",
  );
  for (const [label, repository] of [
    ["target", baseline.target_repository],
    ["frozen", baseline.frozen_repository],
  ]) {
    const tree = resolveObject(
      actionRepo,
      `${repository.default_commit_oid}^{tree}`,
      `${label} default tree`,
    );
    if (tree !== repository.default_tree_oid) {
      throw new Error(`${label} default tree differs from the recorded baseline`);
    }
  }
  const history = collectHistory(
    actionRepo,
    Object.entries(targetRefs)
      .filter(([ref]) => ref.startsWith("refs/heads/"))
      .map(([, oid]) => oid),
    "target initial head history",
  );
  if (
    history.commit_count !== baseline.target_repository.head_commit_count ||
    history.root_count !== baseline.target_repository.head_root_count
  ) {
    throw new Error("target initial head DAG differs from the recorded transfer baseline");
  }
  await Promise.all(
    [targetFile, frozenFile, baselineFile].map(async (expected) => {
      const current = await readStableFile(expected.absolute, expected.absolute);
      if (
        current.sha256 !== expected.sha256 ||
        JSON.stringify(current.identity) !== JSON.stringify(expected.identity)
      ) {
        throw new Error(`${expected.absolute} changed during baseline verification`);
      }
    }),
  );
  return {
    target_ref_count: Object.keys(targetRefs).length,
    frozen_ref_count: Object.keys(frozenRefs).length,
    target_history: history,
  };
}

export async function verifyCandidate(options) {
  const baselineResult = await verifyInitialBaselines(options);
  const sourceRepo = await canonicalRepoPath(options.sourceRepo, "source repo");
  const actionRepo = await canonicalRepoPath(options.actionRepo, "action repo");
  const baselineFile = await readStableFile(options.baseline, "release baseline");
  const baseline = parseBaseline(baselineFile);
  const sourceCommit = resolveCommit(sourceRepo, options.sourceRef, "source commit");
  const actionCommit = resolveCommit(actionRepo, options.actionRef, "action commit");
  const sourcePackageIdentity = verifySourcePackageIdentity(sourceRepo, sourceCommit);
  const sourceSubtree = resolveObject(
    sourceRepo,
    `${sourceCommit}:${ACTION_PREFIX}`,
    "source action subtree",
  );
  const actionTreeOid = resolveObject(actionRepo, `${actionCommit}^{tree}`, "action root tree");
  if (sourceSubtree !== actionTreeOid) {
    throw new Error("source packages/action tree differs from the candidate split root tree");
  }
  const ancestor = git(
    actionRepo,
    [
      "merge-base",
      "--is-ancestor",
      baseline.target_repository.default_commit_oid,
      actionCommit,
    ],
    { allowFailure: true },
  );
  if (ancestor.status !== 0) {
    throw new Error("candidate subtree split does not preserve the transferred master DAG");
  }
  const tree = collectTree(actionRepo, actionCommit);
  const runtimeIdentity = verifyRuntimeIdentity(actionRepo, actionCommit, tree);
  return {
    ...baselineResult,
    source_commit_oid: sourceCommit,
    action_commit_oid: actionCommit,
    root_tree_oid: actionTreeOid,
    split_history: collectHistory(actionRepo, [actionCommit], "candidate split history"),
    source_package_identity: sourcePackageIdentity,
    runtime_identity: runtimeIdentity,
  };
}

function collectTree(repo, commit) {
  const raw = git(repo, ["ls-tree", "-r", "-z", "--full-tree", "-l", commit]).stdout;
  const records = raw.subarray(0, raw.length === 0 ? 0 : -1).toString("binary").split("\0");
  if (records.length > MAX_TREE_ENTRIES) {
    throw new Error(`released action tree exceeds ${MAX_TREE_ENTRIES} entries`);
  }
  const entries = [];
  const paths = new Set();
  let totalBytes = 0;
  for (const recordBinary of records) {
    if (!recordBinary) continue;
    const record = Buffer.from(recordBinary, "binary");
    const tab = record.indexOf(0x09);
    if (tab < 0) throw new Error("released action tree emitted a malformed record");
    const header = record.subarray(0, tab).toString("ascii");
    const headerMatch = /^(\d{6}) (blob) ([0-9a-f]{40}|[0-9a-f]{64})\s+(\d+)$/.exec(header);
    if (!headerMatch) throw new Error("released action tree contains a non-blob entry");
    const pathBytes = record.subarray(tab + 1);
    const path = decodeUtf8(pathBytes, "released action path");
    if (path.startsWith("/") || path.split("/").includes("..")) {
      throw new Error(`released action tree contains unsafe path ${JSON.stringify(path)}`);
    }
    if (paths.has(path)) {
      throw new Error(`released action tree contains duplicate path ${JSON.stringify(path)}`);
    }
    paths.add(path);
    const size = Number(headerMatch[4]);
    totalBytes += size;
    if (!Number.isSafeInteger(size) || totalBytes > MAX_TREE_BYTES) {
      throw new Error(`released action tree exceeds ${MAX_TREE_BYTES} logical bytes`);
    }
    const bytes = git(repo, ["cat-file", "blob", headerMatch[3]], {
      maxBuffer: Math.max(size + 1024, 1024 * 1024),
    }).stdout;
    if (bytes.length !== size) {
      throw new Error(`${path} blob size changed while reading`);
    }
    entries.push({
      path,
      mode: headerMatch[1],
      type: headerMatch[2],
      object_oid: headerMatch[3],
      size,
      sha256: sha256(bytes),
    });
  }
  entries.sort((left, right) => compareUtf8Paths(left.path, right.path));
  return { entry_count: entries.length, logical_bytes: totalBytes, entries };
}

function compareUtf8Paths(left, right) {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function assertRegularBlobEntry(entry, label) {
  if (
    entry === null ||
    typeof entry !== "object" ||
    entry.type !== "blob" ||
    !REGULAR_BLOB_MODES.has(entry.mode)
  ) {
    throw new Error(`${label} must be a regular non-symlink Git blob`);
  }
}

export function discoverV2RuntimeModulePaths(tree) {
  if (tree === null || typeof tree !== "object" || !Array.isArray(tree.entries)) {
    throw new TypeError("released action tree entries must be an array");
  }
  const seen = new Set();
  const runtimeModulePaths = [];
  for (const [index, entry] of tree.entries.entries()) {
    if (entry === null || typeof entry !== "object" || typeof entry.path !== "string") {
      throw new TypeError(`released action tree entry ${index} has no canonical path`);
    }
    if (seen.has(entry.path)) {
      throw new Error(
        `released action tree contains duplicate path ${JSON.stringify(entry.path)}`,
      );
    }
    seen.add(entry.path);
    if (!entry.path.startsWith(V2_RUNTIME_DIRECTORY)) continue;
    if (!V2_RUNTIME_MODULE_PATTERN.test(entry.path)) {
      throw new Error(
        `released v2 runtime contains noncanonical path ${JSON.stringify(entry.path)}`,
      );
    }
    assertRegularBlobEntry(entry, `released v2 runtime ${entry.path}`);
    runtimeModulePaths.push(entry.path);
  }
  runtimeModulePaths.sort(compareUtf8Paths);
  for (const path of [PLAN_ADAPTER_PATH, CONTROLLER_PATH]) {
    if (!runtimeModulePaths.includes(path)) {
      throw new Error(`released action tree is missing required v2 identity ${path}`);
    }
  }
  return runtimeModulePaths;
}

function verifyRuntimeIdentity(repo, actionCommit, tree) {
  const runtimeModulePaths = discoverV2RuntimeModulePaths(tree);
  const entryByPath = new Map(tree.entries.map((entry) => [entry.path, entry]));
  for (const path of [
    ACTION_ENTRY_PATH,
    REUSABLE_WORKFLOW_PATH,
    RECONCILE_WORKFLOW_PATH,
    EVIDENCE_AUTHORITY_POLICY_PATH,
    PACKAGE_MANIFEST_PATH,
    ...runtimeModulePaths,
  ]) {
    const entry = entryByPath.get(path);
    if (entry === undefined) {
      throw new Error(`released action tree is missing required v2 identity ${path}`);
    }
    assertRegularBlobEntry(entry, `released v2 identity ${path}`);
  }
  const actionDefinition = decodeUtf8(
    readBlob(repo, actionCommit, ACTION_ENTRY_PATH),
    ACTION_ENTRY_PATH,
  );
  if (
    !actionDefinition.includes('node "$GITHUB_ACTION_PATH/src/v2/action.mjs"') ||
    actionDefinition.includes("src/gate.mjs")
  ) {
    throw new Error("action.yml does not select only the v2 controller");
  }
  const reusableWorkflow = decodeUtf8(
    readBlob(repo, actionCommit, REUSABLE_WORKFLOW_PATH),
    REUSABLE_WORKFLOW_PATH,
  );
  if (
    !/^\s*workflow_call:\s*$/m.test(reusableWorkflow) ||
    !reusableWorkflow.includes(
      'node "$GITHUB_WORKSPACE/.codex-review-gate-action/src/v2/workflow-controller.mjs" run',
    )
  ) {
    throw new Error("released reusable workflow identity is not closed to the v2 controller");
  }
  const reconcileWorkflow = decodeUtf8(
    readBlob(repo, actionCommit, RECONCILE_WORKFLOW_PATH),
    RECONCILE_WORKFLOW_PATH,
  );
  if (
    !reconcileWorkflow.includes(
      "./.github/workflows/codex-review-gate.yml",
    ) ||
    /JoeyTeng\/codex-review-gate-action/.test(reconcileWorkflow)
  ) {
    throw new Error("released reconciliation workflow is not closed to the local v2 reusable workflow");
  }
  const identity = (path, role) => {
    const entry = entryByPath.get(path);
    assertRegularBlobEntry(entry, `released v2 identity ${path}`);
    return {
      role,
      path,
      object_oid: entry.object_oid,
      sha256: entry.sha256,
    };
  };
  const evidenceAuthorityPolicy = identity(
    EVIDENCE_AUTHORITY_POLICY_PATH,
    "v2-evidence-authority-policy",
  );
  const actionPackageEntry = entryByPath.get(PACKAGE_MANIFEST_PATH);
  const actionPackageIdentity = parsePackageIdentity(
    {
      ...actionPackageEntry,
      bytes: readBlob(
        repo,
        actionCommit,
        PACKAGE_MANIFEST_PATH,
        "released package.json",
      ),
    },
    {
      expectedName: ACTION_PACKAGE_NAME,
      expectedRepositoryUrl: ACTION_PACKAGE_REPOSITORY_URL,
      label: "released package.json",
      role: "v2-action-package",
    },
  );
  return {
    public_entry: identity(ACTION_ENTRY_PATH, "plan-only-composite-entry"),
    reusable_workflow: identity(
      REUSABLE_WORKFLOW_PATH,
      "trusted-public-controller-entry",
    ),
    reconciliation_workflow: identity(
      RECONCILE_WORKFLOW_PATH,
      "trusted-v2-reconciliation-entry",
    ),
    controller: identity(CONTROLLER_PATH, "v2-workflow-controller"),
    plan_adapter: identity(PLAN_ADAPTER_PATH, "v2-plan-adapter-controller"),
    evidence_authority_policy: {
      ...evidenceAuthorityPolicy,
      policy_digest: `sha256:${evidenceAuthorityPolicy.sha256}`,
    },
    runtime_modules: runtimeModulePaths.map((path) =>
      identity(path, path === CONTROLLER_PATH ? "controller" : "v2-runtime-module"),
    ),
    package: actionPackageIdentity,
    package_version: RELEASE_VERSION,
    legacy_files_policy: {
      presence_may_be_required_by_split_history: true,
      selector_compatibility_granted: false,
      admitted_public_selectors: [...RELEASE_TAGS],
    },
  };
}

function stableState(options, sourceRepo, actionRepo, stableFiles) {
  return {
    source: resolveObject(sourceRepo, options.sourceRef, "source ref"),
    action: resolveObject(actionRepo, options.actionRef, "action ref"),
    tags: [options.immutableTagRef, options.minorTagRef, options.majorTagRef].map(
      (ref) => resolveObject(actionRepo, ref, ref),
    ),
    files: stableFiles.map((file) => ({
      path: file.absolute,
      sha256: file.sha256,
      identity: file.identity,
    })),
  };
}

async function assertStableFiles(stableFiles) {
  for (const expected of stableFiles) {
    const current = await readStableFile(expected.absolute, expected.absolute);
    if (
      current.sha256 !== expected.sha256 ||
      JSON.stringify(current.identity) !== JSON.stringify(expected.identity)
    ) {
      throw new Error(`${expected.absolute} changed during provenance publication`);
    }
  }
}

export async function generateProvenance(options) {
  const sourceRepo = await canonicalRepoPath(options.sourceRepo, "source repo");
  const actionRepo = await canonicalRepoPath(options.actionRepo, "action repo");
  const [targetFile, frozenFile, baselineFile] = await Promise.all([
    readStableFile(options.targetRefs, "target ref snapshot"),
    readStableFile(options.frozenRefs, "frozen ref snapshot"),
    readStableFile(options.baseline, "release baseline"),
  ]);
  const targetRefs = parseRefSnapshot(targetFile, "target ref snapshot");
  const frozenRefs = parseRefSnapshot(frozenFile, "frozen ref snapshot");
  const baseline = parseBaseline(baselineFile);
  assertExactObject(
    frozenRefs,
    baseline.frozen_repository.refs,
    "frozen personal repository refs",
  );

  const sourceCommit = resolveCommit(sourceRepo, options.sourceRef, "source commit");
  const actionCommit = resolveCommit(actionRepo, options.actionRef, "action commit");
  const sourcePackageIdentity = verifySourcePackageIdentity(sourceRepo, sourceCommit);
  const sourceSubtree = resolveObject(
    sourceRepo,
    `${sourceCommit}:${ACTION_PREFIX}`,
    "source action subtree",
  );
  const actionTreeOid = resolveObject(actionRepo, `${actionCommit}^{tree}`, "action root tree");
  if (sourceSubtree !== actionTreeOid) {
    throw new Error("source packages/action tree differs from the released split root tree");
  }
  if (
    resolveObject(
      actionRepo,
      `${baseline.frozen_repository.default_commit_oid}^{tree}`,
      "frozen default tree",
    ) !== baseline.frozen_repository.default_tree_oid
  ) {
    throw new Error("frozen personal repository master tree differs from its baseline");
  }

  const tagRefs = [options.immutableTagRef, options.minorTagRef, options.majorTagRef];
  const tags = {};
  for (let index = 0; index < RELEASE_TAGS.length; index += 1) {
    tags[RELEASE_TAGS[index]] = verifyTag(
      actionRepo,
      tagRefs[index],
      RELEASE_TAGS[index],
      actionCommit,
      options.testOnlySkipSignatures,
    );
  }
  if (!options.testOnlySkipSignatures) {
    const expectedFingerprint = normalizeFingerprint(
      options.expectedSigningFingerprint,
      "expected signing fingerprint",
    ).toLowerCase();
    const signatureIdentities = new Set(
      Object.values(tags).map((tag) =>
        `${tag.signature.signing_key_fingerprint}:${tag.signature.primary_key_fingerprint}`,
      ),
    );
    if (signatureIdentities.size !== 1) {
      throw new Error("v2 release tags do not share one signing identity");
    }
    for (const tag of Object.values(tags)) {
      if (tag.signature.primary_key_fingerprint !== expectedFingerprint) {
        throw new Error("v2 release tag primary fingerprint differs from policy");
      }
    }
  }

  const expectedTargetRefs = {
    ...baseline.target_repository.refs,
    "refs/heads/master": actionCommit,
    "refs/tags/v2": tags.v2.tag_object_oid,
    "refs/tags/v2.0": tags["v2.0"].tag_object_oid,
    "refs/tags/v2.0.0": tags["v2.0.0"].tag_object_oid,
  };
  const sortedExpectedTargetRefs = Object.fromEntries(
    Object.entries(expectedTargetRefs).sort(([left], [right]) => left.localeCompare(right)),
  );
  assertExactObject(
    targetRefs,
    sortedExpectedTargetRefs,
    "published Joey-Tools action refs",
  );
  for (const ref of Object.keys(targetRefs)) {
    if (/^refs\/(?:heads|tags)\/v1(?:[./-]|$)/.test(ref)) {
      throw new Error(`v1 ref is forbidden in the v2 action repository: ${ref}`);
    }
  }
  const baselineMaster = baseline.target_repository.default_commit_oid;
  const ancestor = git(actionRepo, [
    "merge-base",
    "--is-ancestor",
    baselineMaster,
    actionCommit,
  ], { allowFailure: true });
  if (ancestor.status !== 0) {
    throw new Error("v2 subtree split does not preserve the transferred master DAG");
  }

  const initialHistory = collectHistory(
    actionRepo,
    Object.entries(baseline.target_repository.refs)
      .filter(([ref]) => ref.startsWith("refs/heads/"))
      .map(([, oid]) => oid),
    "target initial head history",
  );
  if (
    initialHistory.commit_count !== baseline.target_repository.head_commit_count ||
    initialHistory.root_count !== baseline.target_repository.head_root_count
  ) {
    throw new Error("target initial head DAG differs from the recorded transfer baseline");
  }
  const splitHistory = collectHistory(actionRepo, [actionCommit], "v2 subtree split history");
  const publishedHistory = collectHistory(
    actionRepo,
    Object.entries(targetRefs)
      .filter(([ref]) => ref.startsWith("refs/heads/"))
      .map(([, oid]) => oid),
    "published target head history",
  );
  const tree = collectTree(actionRepo, actionCommit);
  const runtimeIdentity = verifyRuntimeIdentity(actionRepo, actionCommit, tree);

  const manifest = {
    $schema: PROVENANCE_SCHEMA_ID,
    schema_version: 3,
    release: {
      version: RELEASE_VERSION,
      immutable_tag: RELEASE_TAGS[0],
      signed_aliases: RELEASE_TAGS.slice(1),
      selector_policy: {
        admitted: [...RELEASE_TAGS],
        v1_refs_admitted: false,
        tags_are_direct_annotated_objects: true,
        every_tag_peels_to_action_commit: true,
      },
    },
    source: {
      repository: SOURCE_REPOSITORY,
      commit_oid: sourceCommit,
      package_identity: sourcePackageIdentity,
      subtree_prefix: ACTION_PREFIX,
      subtree_tree_oid: sourceSubtree,
    },
    action: {
      repository: ACTION_REPOSITORY,
      commit_oid: actionCommit,
      root_tree_oid: actionTreeOid,
      source_subtree_tree_equal: true,
    },
    tags,
    runtime_identity: runtimeIdentity,
    history: {
      algorithm: "git-rev-list-parents-full-reachable-closure",
      transferred_initial_heads: initialHistory,
      release_split: splitHistory,
      published_target_heads: publishedHistory,
      transferred_master_is_ancestor: true,
    },
    released_tree: tree,
    remote_state: {
      target: {
        repository: ACTION_REPOSITORY,
        ref_snapshot_sha256: targetFile.sha256,
        refs: targetRefs,
        no_v1_refs: true,
      },
      frozen_personal: {
        repository: FROZEN_REPOSITORY,
        access: "read-only-baseline-verification",
        ref_snapshot_sha256: frozenFile.sha256,
        refs: frozenRefs,
        default_commit_oid: baseline.frozen_repository.default_commit_oid,
        default_tree_oid: baseline.frozen_repository.default_tree_oid,
        all_refs_equal_recorded_baseline: true,
      },
      baseline_sha256: baselineFile.sha256,
    },
    publication_contract: {
      git_update: "single-atomic-non-force-push-of-master-and-three-tags",
      credential_secret: "ACTION_REPO_PUSH_TOKEN_V2",
      credential_transport: "https-extraheader",
      credential_minimum_permission: "contents:write-on-target-only",
      deploy_keys_supported: false,
      signing_key_secret: "ACTION_RELEASE_SIGNING_PRIVATE_KEY_V2",
      signing_fingerprint_secret: "ACTION_RELEASE_SIGNING_FINGERPRINT_V2",
      external_enforcement_required: [
        "target-master-ruleset-allows-only-authorized-maintenance-update",
        "target-v2-tags-are-create-only-and-deletion-protected",
        "workflow-credential-has-required-ruleset-bypass-or-maintenance-role",
      ],
      provenance_output: "create-only-local-file-and-workflow-artifact",
    },
  };

  const stableFiles = [targetFile, frozenFile, baselineFile];
  const initialState = stableState(options, sourceRepo, actionRepo, stableFiles);
  await assertStableFiles(stableFiles);
  assertExactObject(
    stableState(options, sourceRepo, actionRepo, stableFiles),
    initialState,
    "release refs",
  );
  return { manifest, stableFiles, initialState, sourceRepo, actionRepo };
}

function isSameStablePublication(identity, expectedIdentity, intendedSize) {
  return (
    identity.isFile() &&
    identity.dev === expectedIdentity.dev &&
    identity.ino === expectedIdentity.ino &&
    identity.mode === expectedIdentity.mode &&
    identity.uid === expectedIdentity.uid &&
    identity.gid === expectedIdentity.gid &&
    identity.size === intendedSize
  );
}

async function assertManifestPublication(
  path,
  expectedIdentity,
  intendedSize,
  intendedBytes,
  label,
) {
  const before = await lstat(path, { bigint: true });
  if (!isSameStablePublication(before, expectedIdentity, intendedSize)) {
    throw new Error(`${label} identity or access policy differs from staging object`);
  }
  const firstRead = await readFile(path);
  const middle = await lstat(path, { bigint: true });
  const secondRead = await readFile(path);
  const after = await lstat(path, { bigint: true });
  // The protected properties are object identity (dev/ino/type), access policy
  // (owner/group/mode), and exact intended content. Timestamp-only changes are
  // deliberately ignored; they are not evidence that a protected property moved.
  if (
    !isSameStablePublication(middle, expectedIdentity, intendedSize) ||
    !isSameStablePublication(after, expectedIdentity, intendedSize)
  ) {
    throw new Error(`${label} identity or access policy changed while validating`);
  }
  if (
    !firstRead.equals(intendedBytes) ||
    !secondRead.equals(intendedBytes) ||
    !firstRead.equals(secondRead)
  ) {
    throw new Error(`${label} content differs from the intended manifest`);
  }
}

export async function writeManifest(
  outputPath,
  manifest,
  { beforePublish, afterStagingValidation, finalPrePublish, afterLink, afterPublish } = {},
) {
  const absoluteOutput = resolve(outputPath);
  await mkdir(dirname(absoluteOutput), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const intendedSha256 = sha256(bytes);
  const intendedSize = BigInt(bytes.length);
  const stagingDirectory = await mkdtemp(`${absoluteOutput}.tmp-`);
  await chmod(stagingDirectory, 0o700);
  const temporary = join(stagingDirectory, "manifest");
  let temporaryHandle;
  let publicationLinked = false;
  let stagedIdentity;
  let operationError = null;
  try {
    const stagingIdentity = await lstat(stagingDirectory, { bigint: true });
    if (
      typeof process.getuid !== "function" ||
      typeof process.getgid !== "function" ||
      !stagingIdentity.isDirectory() ||
      (stagingIdentity.mode & 0o777n) !== 0o700n ||
      stagingIdentity.uid !== BigInt(process.getuid()) ||
      stagingIdentity.gid !== BigInt(process.getgid())
    ) {
      throw new Error("manifest staging directory is not an owner-private POSIX directory");
    }
    temporaryHandle = await open(temporary, "wx", 0o600);
    await temporaryHandle.writeFile(bytes);
    await temporaryHandle.sync();
    if (beforePublish) await beforePublish();
    stagedIdentity = await temporaryHandle.stat({ bigint: true });
    const pathIdentity = await lstat(temporary, { bigint: true });
    const stagedBytes = await readFile(temporary);
    if (
      !stagedIdentity.isFile() ||
      !pathIdentity.isFile() ||
      stagedIdentity.dev !== pathIdentity.dev ||
      stagedIdentity.ino !== pathIdentity.ino ||
      stagedIdentity.mode !== pathIdentity.mode ||
      stagedIdentity.uid !== pathIdentity.uid ||
      stagedIdentity.gid !== pathIdentity.gid ||
      (stagedIdentity.mode & 0o777n) !== 0o600n ||
      stagedIdentity.size !== intendedSize ||
      !stagedBytes.equals(bytes)
    ) {
      throw new Error("manifest staging object identity, access policy, or content changed");
    }
    if (afterStagingValidation) await afterStagingValidation();
    if (finalPrePublish) await finalPrePublish();
    await assertManifestPublication(
      temporary,
      stagedIdentity,
      intendedSize,
      bytes,
      "manifest staging object",
    );
    try {
      await link(temporary, absoluteOutput);
      publicationLinked = true;
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new Error(`output already exists; refusing to replace ${absoluteOutput}`, {
          cause: error,
        });
      }
      throw error;
    }
    if (afterLink) await afterLink();
    await assertManifestPublication(
      absoluteOutput,
      stagedIdentity,
      intendedSize,
      bytes,
      "published manifest",
    );
    if (afterPublish) await afterPublish();
    await assertManifestPublication(
      absoluteOutput,
      stagedIdentity,
      intendedSize,
      bytes,
      "published manifest after final audit",
    );
  } catch (error) {
    operationError = error;
  }

  const cleanupErrors = [];
  try {
    await temporaryHandle?.close();
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    await rm(stagingDirectory, { recursive: true, force: true });
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (publicationLinked && (operationError || cleanupErrors.length > 0)) {
    const primaryDetail = operationError
      ? `manifest publication failed after linking output (${operationError.message})`
      : "manifest staging cleanup failed after linking output";
    const cleanupDetail = cleanupErrors.length > 0
      ? `; staging cleanup also failed (${cleanupErrors
          .map((error) => error.message)
          .join("; ")})`
      : "";
    throw new AggregateError(
      [...(operationError ? [operationError] : []), ...cleanupErrors],
      `${primaryDetail}${cleanupDetail}; leaving the final output path untouched. ` +
        `Verify whether ${absoluteOutput} exists, isolate any retained object, ` +
        "and use a new output path for retry",
    );
  }
  if (operationError && cleanupErrors.length > 0) {
    throw new AggregateError(
      [operationError, ...cleanupErrors],
      `manifest generation failed (${operationError.message}); staging cleanup also failed ` +
        `(${cleanupErrors.map((error) => error.message).join("; ")})`,
    );
  }
  if (operationError) throw operationError;
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      `manifest staging cleanup failed (${cleanupErrors
        .map((error) => error.message)
        .join("; ")})`,
    );
  }
  return { absoluteOutput, digest: intendedSha256 };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (options.verifyInitialBaselines) {
    const result = await verifyInitialBaselines(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (options.verifyCandidate) {
    const result = await verifyCandidate(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const generated = await generateProvenance(options);
  const assertStable = async () => {
    await assertStableFiles(generated.stableFiles);
    assertExactObject(
      stableState(
        options,
        generated.sourceRepo,
        generated.actionRepo,
        generated.stableFiles,
      ),
      generated.initialState,
      "release refs",
    );
  };
  const { absoluteOutput, digest } = await writeManifest(options.output, generated.manifest, {
    beforePublish: assertStable,
    finalPrePublish: assertStable,
    afterPublish: assertStable,
  });
  process.stdout.write(`${absoluteOutput}\nsha256:${digest}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`error: ${error.message}\n`);
    process.exitCode = 1;
  });
}
