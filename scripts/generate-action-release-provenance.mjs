#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash, createPrivateKey, sign as signBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const SOURCE_REPOSITORY = "Joey-Tools/codex-review-gate";
const SOURCE_PATH = "packages/action";
const TARGET_REPOSITORY = "JoeyTeng/codex-review-gate-action";
const TARGET_BRANCH = "master";
const PRIMARY_FINGERPRINT = "AD403DAB5377F9FA0F7D775EC2844D3367B8A71B";
const SIGNING_SUBKEY_FINGERPRINT = "4DD48552DDEAF6D961769DD4A49827EC48984E2C";
const V2_0_RELEASE_MANIFEST_SCHEMA = "urn:joey-tools:codex-review-gate:release-manifest:2";
const RELEASE_CONTRACT_ID = "codex-review-gate-action-v2.0-contract-v1";
const V2_0_RELEASE_PLAN_SCHEMA = "codex-review-gate-action-release-plan-v2";
const V2_0_RELEASE_CANDIDATE_SCHEMA = "codex-review-gate-action-candidate-v2";
const V2_0_PUBLICATION_PLAN_SCHEMA = "codex-review-gate-action-publication-plan-v2";
const V2_0_RELEASE_PROVENANCE_SCHEMA = "codex-review-gate-action-release-provenance-v2";
const V2_0_PUSH_ADMISSION_SCHEMA = "codex-review-gate-action-push-admission-v1";
const V2_0_CONTRACT_VERSIONS = Object.freeze({
  toolchain: "node20",
  release_schema: 2,
  status: 2,
  template: 2,
  baseline: 3,
});
const V2_0_ENTRYPOINT_POLICY = Object.freeze({
  metadata_path: "action.yml",
  using: "node20",
  main: "src/v2/gate-runtime.mjs",
});
const MAX_TRANSPORT_BYTES = 64 * 1024 * 1024;
const MAX_TRANSPORT_FILE_BYTES = 32 * 1024 * 1024;
const MAX_TRANSPORT_ENTRIES = 4096;
const MAX_GITHUB_APP_INSTALLATION_RESPONSE_BYTES = 1024 * 1024;
const V2_0_CONTROL_PATH_LIST = Object.freeze([
  ".github/workflows/required-ci-router.yml",
  ".github/workflows/required-ci.yml",
  ".github/workflows/sync-action-subtree.yml",
  "docs/release/action-v2-repository-baselines.json",
  "package.json",
  "scripts/generate-action-release-provenance.mjs",
  "scripts/release-action-subtree.sh",
  "test/release-provenance.test.mjs",
  "test/required-ci-workflow.test.mjs",
  "test/v2-release-pipeline.test.mjs",
].sort((left, right) => Buffer.from(left).compare(Buffer.from(right))));
const V2_0_RUNTIME_MODULE_PATHS = Object.freeze([
  "src/v2/gate-runtime.mjs",
]);
const V2_0_SIGNER_POLICY = Object.freeze({
  name: "JoeyTeng-Codex",
  email: "codex@mahane.me",
  primary_fingerprint: PRIMARY_FINGERPRINT,
  signing_subkey_fingerprint: SIGNING_SUBKEY_FINGERPRINT,
});

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

// Published contracts are append-only. Historical verification selects one
// from the signed provenance schema instead of applying the active publisher
// policy retroactively to immutable releases.
const RELEASE_CONTRACT_V2_0 = deepFreeze({
  id: RELEASE_CONTRACT_ID,
  source_repository: SOURCE_REPOSITORY,
  source_path: SOURCE_PATH,
  target_repository: TARGET_REPOSITORY,
  target_branch: TARGET_BRANCH,
  action_package_repository: "git+https://github.com/JoeyTeng/codex-review-gate-action.git",
  manifest: {
    schema: V2_0_RELEASE_MANIFEST_SCHEMA,
    schema_version: 2,
    contract_versions: { ...V2_0_CONTRACT_VERSIONS },
  },
  plan: { schema: V2_0_RELEASE_PLAN_SCHEMA, schema_version: 2 },
  candidate: { schema: V2_0_RELEASE_CANDIDATE_SCHEMA, schema_version: 2 },
  publication_plan: { schema: V2_0_PUBLICATION_PLAN_SCHEMA, schema_version: 2 },
  provenance: { schema: V2_0_RELEASE_PROVENANCE_SCHEMA, schema_version: 2 },
  entrypoint: { ...V2_0_ENTRYPOINT_POLICY },
  signer: { ...V2_0_SIGNER_POLICY },
  runtime_paths: [...V2_0_RUNTIME_MODULE_PATHS],
  control_paths: [...V2_0_CONTROL_PATH_LIST],
  executable_control_paths: [
    "scripts/generate-action-release-provenance.mjs",
    "scripts/release-action-subtree.sh",
  ],
  archive_encoder: "canonical-ustar-gzip-store-v1",
  semver_policy: "canonical-semver-v2-plus-v1",
  push_admission: {
    schema: V2_0_PUSH_ADMISSION_SCHEMA,
    schema_version: 1,
    event: "push",
  },
  floating_alias_modes: {
    create: { requires_before: false },
    "force-with-lease": { requires_before: true },
    "already-current": { requires_before: true },
    superseded: { requires_before: true },
  },
});
const HISTORICAL_RELEASE_CONTRACTS = new Map([
  [`${V2_0_RELEASE_PROVENANCE_SCHEMA}:2`, RELEASE_CONTRACT_V2_0],
]);
const HISTORICAL_PLAN_CONTRACTS = new Map([
  [`${V2_0_RELEASE_PLAN_SCHEMA}:2`, RELEASE_CONTRACT_V2_0],
]);
const HISTORICAL_CANDIDATE_CONTRACTS = new Map([
  [`${V2_0_RELEASE_CANDIDATE_SCHEMA}:2`, RELEASE_CONTRACT_V2_0],
]);
const CURRENT_RELEASE_CONTRACT = RELEASE_CONTRACT_V2_0;

function releaseContractFor(record, registry, label) {
  const contract = registry.get(`${record?.schema}:${record?.schema_version}`);
  if (contract === undefined) fail(`unsupported ${label} schema`);
  return contract;
}

function fail(message) {
  throw new Error(message);
}

function git(repo, args, options = {}) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function gitBytes(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function createGitHubAppJwt({ clientId, privateKey, now = Math.floor(Date.now() / 1000) }) {
  if (!/^[A-Za-z0-9._-]{8,128}$/u.test(clientId ?? "")) {
    fail("GitHub App client ID is malformed");
  }
  if (!Number.isSafeInteger(now) || now <= 0) fail("GitHub App JWT time is invalid");
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== "rsa") fail("GitHub App private key must be RSA");
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 540, iss: clientId })).toString("base64url");
  const unsigned = `${header}.${payload}`;
  const signature = signBytes("RSA-SHA256", Buffer.from(unsigned), key).toString("base64url");
  return `${unsigned}.${signature}`;
}

export async function readGitHubAppInstallation({
  clientId,
  privateKey,
  installationId,
  now = Math.floor(Date.now() / 1000),
  fetchImpl = globalThis.fetch,
}) {
  if (!/^[1-9][0-9]*$/u.test(String(installationId ?? ""))) {
    fail("GitHub App installation ID is malformed");
  }
  if (typeof fetchImpl !== "function") fail("GitHub App installation HTTP client is unavailable");
  const jwt = createGitHubAppJwt({ clientId, privateKey, now });
  const endpoint = `https://api.github.com/app/installations/${installationId}`;
  const response = await fetchImpl(endpoint, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${jwt}`,
      "User-Agent": "codex-review-gate-action-publisher",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (response?.status !== 200) {
    fail(`GitHub App installation request failed with HTTP ${response?.status ?? "unknown"}`);
  }
  const declaredLength = response.headers?.get?.("content-length");
  if (declaredLength !== null && declaredLength !== undefined) {
    if (!/^(0|[1-9][0-9]*)$/u.test(declaredLength) || Number(declaredLength) > MAX_GITHUB_APP_INSTALLATION_RESPONSE_BYTES) {
      fail("GitHub App installation response exceeds the byte limit");
    }
  }
  let responseBytes;
  if (typeof response.body?.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_GITHUB_APP_INSTALLATION_RESPONSE_BYTES) {
        await reader.cancel();
        fail("GitHub App installation response exceeds the byte limit");
      }
      chunks.push(Buffer.from(value));
    }
    responseBytes = Buffer.concat(chunks, size);
  } else {
    const text = await response.text();
    responseBytes = Buffer.from(text);
    if (responseBytes.byteLength > MAX_GITHUB_APP_INSTALLATION_RESPONSE_BYTES) {
      fail("GitHub App installation response exceeds the byte limit");
    }
  }
  let installation;
  try {
    installation = JSON.parse(responseBytes.toString("utf8"));
  } catch {
    fail("GitHub App installation response is not valid JSON");
  }
  if (installation === null || typeof installation !== "object" || Array.isArray(installation)) {
    fail("GitHub App installation response must be a JSON object");
  }
  return installation;
}

function canonicalComparable(value) {
  if (Array.isArray(value)) return value.map(canonicalComparable);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
        .map((key) => [key, canonicalComparable(value[key])]),
    );
  }
  return value;
}

function sameCanonicalValue(left, right) {
  return JSON.stringify(canonicalComparable(left)) === JSON.stringify(canonicalComparable(right));
}

function hasExactKeys(value, expected) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    sameCanonicalValue(Object.keys(value).sort(), [...expected].sort());
}

function createOnly(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  const descriptor = openSync(path, "wx", 0o600);
  try {
    writeFileSync(descriptor, bytes);
  } finally {
    // writeFileSync does not close an explicitly supplied descriptor.
    closeSync(descriptor);
  }
}

function parseSemverAnyV1(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u.exec(version);
  if (!match) fail(`release version is not canonical SemVer: ${version}`);
  if (match[4]?.split(".").some((identifier) => /^0\d+$/u.test(identifier))) {
    fail(`release version is not canonical SemVer: ${version}`);
  }
  const exactInteger = (value) => {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : BigInt(value);
  };
  const major = exactInteger(match[1]);
  return Object.freeze({
    version,
    major,
    minor: exactInteger(match[2]),
    patch: exactInteger(match[3]),
    prerelease: match[4] ?? null,
    immutableTag: `v${version}`,
    majorAlias: match[4] === undefined ? `v${match[1]}` : null,
  });
}

function parseSemverV1(version) {
  const parsed = parseSemverAnyV1(version);
  if (BigInt(parsed.major) < 2n) fail("new v1 releases are forbidden");
  return parsed;
}

function comparePrerelease(left, right) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    if (leftParts[index] === undefined) return -1;
    if (rightParts[index] === undefined) return 1;
    if (leftParts[index] === rightParts[index]) continue;
    const leftNumeric = /^\d+$/u.test(leftParts[index]);
    const rightNumeric = /^\d+$/u.test(rightParts[index]);
    if (leftNumeric && rightNumeric) {
      return BigInt(leftParts[index]) < BigInt(rightParts[index]) ? -1 : 1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftParts[index] < rightParts[index] ? -1 : 1;
  }
  return 0;
}

function compareSemverV1(leftVersion, rightVersion) {
  const left = parseSemverAnyV1(leftVersion);
  const right = parseSemverAnyV1(rightVersion);
  for (const field of ["major", "minor", "patch"]) {
    const leftInteger = BigInt(left[field]);
    const rightInteger = BigInt(right[field]);
    if (leftInteger !== rightInteger) return leftInteger < rightInteger ? -1 : 1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

function parseSemverForContract(version, contract) {
  if (contract.semver_policy === "canonical-semver-v2-plus-v1") return parseSemverV1(version);
  fail(`release contract ${contract.id} has no frozen SemVer parser`);
}

function compareSemverForContract(leftVersion, rightVersion, contract) {
  if (contract.semver_policy === "canonical-semver-v2-plus-v1") {
    return compareSemverV1(leftVersion, rightVersion);
  }
  fail(`release contract ${contract.id} has no frozen SemVer comparator`);
}

export function parseSemver(version) {
  return parseSemverForContract(version, CURRENT_RELEASE_CONTRACT);
}

export function compareSemver(leftVersion, rightVersion) {
  return compareSemverForContract(leftVersion, rightVersion, CURRENT_RELEASE_CONTRACT);
}

function validateReleaseManifest(manifest, contract = CURRENT_RELEASE_CONTRACT) {
  if (!hasExactKeys(manifest, [
    "$schema",
    "schema_version",
    "version",
    "contract_versions",
    "source",
    "target",
    "files",
    "entrypoint",
    "signer",
  ])) fail("release manifest field set differs from schema v2 policy");
  if (
    manifest.$schema !== contract.manifest.schema ||
    manifest.schema_version !== contract.manifest.schema_version
  ) {
    fail("unsupported release manifest schema");
  }
  if (
    !hasExactKeys(manifest.contract_versions, Object.keys(contract.manifest.contract_versions)) ||
    !sameCanonicalValue(manifest.contract_versions, contract.manifest.contract_versions)
  ) {
    fail("release manifest contract versions differ from policy");
  }
  if (
    !hasExactKeys(manifest.source, ["repository", "path", "tree"]) ||
    manifest.source.repository !== contract.source_repository ||
    manifest.source.path !== contract.source_path ||
    !/^[0-9a-f]{40}$/u.test(manifest.source.tree ?? "")
  ) {
    fail("release manifest source repository/path/tree differs from policy");
  }
  if (
    !hasExactKeys(manifest.target, ["repository", "ref", "expected_head", "previous_version"])
  ) fail("release manifest target field set differs from policy");
  if (
    manifest.target?.repository !== contract.target_repository ||
    manifest.target?.ref !== `refs/heads/${contract.target_branch}`
  ) {
    fail("release manifest target repository/ref differs from policy");
  }
  if (!/^[0-9a-f]{40}$/u.test(manifest.target?.expected_head ?? "")) {
    fail("release manifest expected_target_head must be a full SHA-1 object ID");
  }
  if (typeof manifest.target?.previous_version !== "string") {
    fail("release manifest target.previous_version is required");
  }
  validatePayloadInventory(manifest.files, contract);
  if (
    !hasExactKeys(manifest.entrypoint, Object.keys(contract.entrypoint)) ||
    !sameCanonicalValue(manifest.entrypoint, contract.entrypoint)
  ) {
    fail("release manifest action entrypoint differs from policy");
  }
  const actionMetadata = manifest.files.find((record) => record.path === contract.entrypoint.metadata_path);
  const runtime = manifest.files.find((record) => record.path === contract.entrypoint.main);
  if (
    actionMetadata?.type !== "file" || actionMetadata.mode !== "100644" ||
    runtime?.type !== "file" || runtime.mode !== "100644"
  ) {
    fail("release manifest must declare regular non-executable action metadata and v2 runtime files");
  }
  if (
    !hasExactKeys(manifest.signer, Object.keys(contract.signer)) ||
    !sameCanonicalValue(manifest.signer, contract.signer)
  ) {
    fail("release manifest signer identity differs from policy");
  }
  const release = parseSemverForContract(manifest.version, contract);
  if (compareSemverForContract(manifest.version, manifest.target.previous_version, contract) <= 0) {
    fail("release manifest version must advance target.previous_version");
  }
  return Object.freeze({ ...manifest, release });
}

export function readReleaseManifest(path) {
  return validateReleaseManifest(readJson(path), CURRENT_RELEASE_CONTRACT);
}

function readReleaseManifestAt(repo, sourceCommit, contract = CURRENT_RELEASE_CONTRACT) {
  let manifest;
  try {
    manifest = JSON.parse(gitBytes(repo, ["show", `${sourceCommit}:release-manifest.json`]).toString("utf8"));
  } catch (error) {
    fail(`frozen release manifest is missing or invalid JSON: ${error.message}`);
  }
  return validateReleaseManifest(manifest, contract);
}

function decodeGitPath(bytes) {
  let path;
  try {
    path = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("release inventory paths must be valid UTF-8");
  }
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((component) => component === "" || component === "." || component === "..") ||
    /[\u0000-\u001f\u007f]/u.test(path)
  ) {
    fail(`release inventory contains an unsafe path: ${JSON.stringify(path)}`);
  }
  return path;
}

function parseLsTree(raw) {
  const entries = [];
  for (const row of raw.subarray(0, raw.at(-1) === 0 ? -1 : undefined).toString("binary").split("\0")) {
    if (row.length === 0) continue;
    const bytes = Buffer.from(row, "binary");
    const separators = [];
    for (let index = 0; index < bytes.length && separators.length < 3; index += 1) {
      if (bytes[index] === 0x09) separators.push(index);
    }
    if (separators.length !== 3) fail("git tree inventory row is malformed");
    entries.push({
      mode: bytes.subarray(0, separators[0]).toString("ascii"),
      objectType: bytes.subarray(separators[0] + 1, separators[1]).toString("ascii"),
      objectId: bytes.subarray(separators[1] + 1, separators[2]).toString("ascii"),
      path: decodeGitPath(bytes.subarray(separators[2] + 1)),
    });
  }
  return entries;
}

function inventoryRecord(repo, entry) {
  if (entry.objectType !== "blob" || !/^[0-9a-f]{40,64}$/u.test(entry.objectId)) {
    fail(`release inventory rejects submodules and non-blob entries: ${entry.path}`);
  }
  if (!["100644", "100755"].includes(entry.mode)) {
    fail(`release inventory rejects symlinks, submodules, and special files: ${entry.path}`);
  }
  const bytes = gitBytes(repo, ["cat-file", "blob", entry.objectId]);
  return {
    path: entry.path,
    type: "file",
    mode: entry.mode,
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function readPayloadTree(repo, sourceCommit, contract = CURRENT_RELEASE_CONTRACT) {
  const raw = gitBytes(repo, [
    "ls-tree",
    "-rz",
    "--full-tree",
    "--format=%(objectmode)%x09%(objecttype)%x09%(objectname)%x09%(path)",
    `${sourceCommit}:${contract.source_path}`,
  ]);
  const entries = parseLsTree(raw)
    .sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
  const inventory = entries.map((entry) => inventoryRecord(repo, entry));
  validatePayloadInventory(inventory, contract);
  return { entries, inventory };
}

function readPayloadInventory(repo, sourceCommit, contract = CURRENT_RELEASE_CONTRACT) {
  return readPayloadTree(repo, sourceCommit, contract).inventory;
}

function readTarText(field, label) {
  const nul = field.indexOf(0);
  const used = nul === -1 ? field : field.subarray(0, nul);
  if (nul !== -1 && field.subarray(nul).some((byte) => byte !== 0)) {
    fail(`release tar ${label} has non-zero bytes after its terminator`);
  }
  let value;
  try {
    value = new TextDecoder("utf-8", { fatal: true }).decode(used);
  } catch {
    fail(`release tar ${label} must be valid UTF-8`);
  }
  return value;
}

function readTarOctal(field, label) {
  const value = field.toString("ascii").replace(/\0.*$/u, "").trim();
  if (!/^[0-7]+$/u.test(value)) fail(`release tar ${label} is not canonical octal`);
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail(`release tar ${label} is out of range`);
  return parsed;
}

function canonicalTarPath(header) {
  const name = readTarText(header.subarray(0, 100), "name");
  const prefix = readTarText(header.subarray(345, 500), "prefix");
  let path = prefix === "" ? name : `${prefix}/${name}`;
  if (path === "." || path === "./") return ".";
  while (path.startsWith("./")) path = path.slice(2);
  if (path.endsWith("/")) path = path.slice(0, -1);
  decodeGitPath(Buffer.from(path, "utf8"));
  return path;
}

function parseTarEntries(bytes, { maxBytes = MAX_TRANSPORT_BYTES } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength > maxBytes) {
    fail("release tar exceeds its bounded byte budget");
  }
  const entries = [];
  const names = new Set();
  let offset = 0;
  let zeroBlocks = 0;
  while (offset + 512 <= bytes.byteLength) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      zeroBlocks += 1;
      offset += 512;
      if (zeroBlocks >= 2) break;
      continue;
    }
    if (zeroBlocks !== 0) fail("release tar contains data after a partial end marker");
    const expectedChecksum = readTarOctal(header.subarray(148, 156), "checksum");
    let actualChecksum = 0;
    for (let index = 0; index < header.length; index += 1) {
      actualChecksum += index >= 148 && index < 156 ? 0x20 : header[index];
    }
    if (actualChecksum !== expectedChecksum) fail("release tar header checksum is invalid");
    const magic = header.subarray(257, 263).toString("binary");
    if (magic !== "ustar\0" && magic !== "ustar ") fail("release tar must use the ustar format");
    const path = canonicalTarPath(header);
    if (names.has(path)) fail(`release tar contains a duplicate path: ${path}`);
    names.add(path);
    const typeByte = header[156];
    const type = typeByte === 0 || typeByte === 0x30 ? "file" : typeByte === 0x35 ? "directory" : null;
    if (type === null) fail(`release tar rejects links and special entries: ${path}`);
    const size = readTarOctal(header.subarray(124, 136), "size");
    if (type === "directory" && size !== 0) fail(`release tar directory has content bytes: ${path}`);
    if (size > MAX_TRANSPORT_FILE_BYTES) fail(`release tar entry exceeds its byte budget: ${path}`);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.byteLength) fail(`release tar entry is truncated: ${path}`);
    const mode = readTarOctal(header.subarray(100, 108), "mode");
    entries.push({ path, type, mode, bytes: bytes.subarray(dataStart, dataEnd) });
    if (entries.length > MAX_TRANSPORT_ENTRIES) fail("release tar exceeds its entry budget");
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  if (zeroBlocks < 2 || bytes.subarray(offset).some((byte) => byte !== 0)) {
    fail("release tar end marker is missing or followed by non-zero data");
  }
  return entries;
}

function writeTarTextField(header, offset, length, value, label) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength > length) fail(`release tar ${label} exceeds its ustar field`);
  bytes.copy(header, offset);
}

function writeTarOctalField(header, offset, length, value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`release tar ${label} is out of range`);
  const digits = value.toString(8);
  if (digits.length > length - 1) fail(`release tar ${label} exceeds its ustar field`);
  header.write(`${digits.padStart(length - 1, "0")}\0`, offset, length, "ascii");
}

function splitUstarPath(path) {
  const bytes = Buffer.from(path, "utf8");
  if (bytes.byteLength <= 100) return { name: path, prefix: "" };
  const components = path.split("/");
  for (let index = components.length - 1; index > 0; index -= 1) {
    const prefix = components.slice(0, index).join("/");
    const name = components.slice(index).join("/");
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix };
    }
  }
  fail(`release tar path exceeds the canonical ustar path fields: ${path}`);
}

function canonicalTarHeader({ path, mode, size, type }) {
  const header = Buffer.alloc(512);
  const { name, prefix } = splitUstarPath(path);
  writeTarTextField(header, 0, 100, name, "name");
  writeTarOctalField(header, 100, 8, mode, "mode");
  writeTarOctalField(header, 108, 8, 0, "uid");
  writeTarOctalField(header, 116, 8, 0, "gid");
  writeTarOctalField(header, 124, 12, size, "size");
  writeTarOctalField(header, 136, 12, 0, "mtime");
  header.fill(0x20, 148, 156);
  header[156] = type === "directory" ? 0x35 : 0x30;
  writeTarTextField(header, 257, 6, "ustar\0", "magic");
  writeTarTextField(header, 263, 2, "00", "version");
  writeTarTextField(header, 345, 155, prefix, "prefix");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const checksumDigits = checksum.toString(8);
  if (checksumDigits.length > 6) fail("release tar checksum exceeds its ustar field");
  header.write(`${checksumDigits.padStart(6, "0")}\0 `, 148, 8, "ascii");
  return header;
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function gzipStored(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.byteLength > MAX_TRANSPORT_BYTES) {
    fail("release archive exceeds its bounded byte budget");
  }
  const chunks = [Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff])];
  for (let offset = 0; offset < bytes.byteLength;) {
    const length = Math.min(65_535, bytes.byteLength - offset);
    const final = offset + length === bytes.byteLength;
    const framing = Buffer.alloc(5);
    framing[0] = final ? 0x01 : 0x00;
    framing.writeUInt16LE(length, 1);
    framing.writeUInt16LE((~length) & 0xffff, 3);
    chunks.push(framing, bytes.subarray(offset, offset + length));
    offset += length;
  }
  const trailer = Buffer.alloc(8);
  trailer.writeUInt32LE(crc32(bytes), 0);
  trailer.writeUInt32LE(bytes.byteLength >>> 0, 4);
  chunks.push(trailer);
  return Buffer.concat(chunks);
}

function encodeCanonicalReleaseArchiveV1(files, archiveRootName) {
  decodeGitPath(Buffer.from(archiveRootName, "utf8"));
  if (!Array.isArray(files) || files.length === 0) {
    fail("canonical release archive requires a non-empty file list");
  }
  const ordered = [...files].sort((left, right) =>
    Buffer.from(left.path ?? "").compare(Buffer.from(right.path ?? "")));
  const names = new Set();
  let tarSize = 512 + 1024;
  const chunks = [canonicalTarHeader({
    path: `${archiveRootName}/`,
    mode: 0o755,
    size: 0,
    type: "directory",
  })];
  for (const file of ordered) {
    decodeGitPath(Buffer.from(file.path ?? "", "utf8"));
    if (names.has(file.path)) fail(`canonical release archive contains a duplicate path: ${file.path}`);
    names.add(file.path);
    if (file.mode !== "100644" || !Buffer.isBuffer(file.bytes)) {
      fail(`canonical release archive file differs from payload policy: ${file.path}`);
    }
    if (file.bytes.byteLength > MAX_TRANSPORT_FILE_BYTES) {
      fail(`canonical release archive entry exceeds its byte budget: ${file.path}`);
    }
    tarSize += 512 + Math.ceil(file.bytes.byteLength / 512) * 512;
    if (tarSize > MAX_TRANSPORT_BYTES) fail("canonical release archive exceeds its byte budget");
    const path = `${archiveRootName}/${file.path}`;
    chunks.push(canonicalTarHeader({ path, mode: 0o644, size: file.bytes.byteLength, type: "file" }));
    chunks.push(file.bytes);
    const padding = (512 - (file.bytes.byteLength % 512)) % 512;
    if (padding !== 0) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipStored(Buffer.concat(chunks));
}

export function encodeCanonicalReleaseArchive(
  files,
  archiveRootName,
  encoder = CURRENT_RELEASE_CONTRACT.archive_encoder,
) {
  if (encoder === "canonical-ustar-gzip-store-v1") {
    return encodeCanonicalReleaseArchiveV1(files, archiveRootName);
  }
  fail(`unsupported canonical release archive encoder: ${encoder}`);
}

function readArchivePayloadInventory(archivePath, archiveRootName) {
  let uncompressed;
  try {
    uncompressed = gunzipSync(readFileSync(archivePath), { maxOutputLength: MAX_TRANSPORT_BYTES });
  } catch (error) {
    fail(`release archive gzip stream is invalid or oversized: ${error.message}`);
  }
  const prefix = `${archiveRootName}/`;
  const entries = parseTarEntries(uncompressed);
  const files = [];
  for (const entry of entries) {
    if (entry.path === archiveRootName && entry.type === "directory") continue;
    if (!entry.path.startsWith(prefix)) fail("release archive contains a path outside its canonical root");
    if (entry.type === "directory") continue;
    const path = entry.path.slice(prefix.length);
    decodeGitPath(Buffer.from(path, "utf8"));
    files.push({
      path,
      type: "file",
      mode: entry.mode === 0o644 ? "100644" : entry.mode === 0o755 ? "100755" : String(entry.mode),
      size: entry.bytes.byteLength,
      sha256: createHash("sha256").update(entry.bytes).digest("hex"),
    });
  }
  files.sort((left, right) => Buffer.from(left.path).compare(Buffer.from(right.path)));
  return files;
}

export function extractCandidateTransport({ archivePath, outputDir }) {
  const bytes = readFileSync(archivePath);
  const entries = parseTarEntries(bytes);
  const files = entries.filter((entry) => entry.type === "file");
  if (files.length !== 2 || entries.some((entry) => entry.type === "directory" && entry.path !== ".")) {
    fail("candidate transport must contain exactly two root regular files");
  }
  if (files.some((entry) => basename(entry.path) !== entry.path || entry.mode !== 0o600)) {
    fail("candidate transport files must be root-scoped mode-0600 regular files");
  }
  if (!files.some((entry) => entry.path === "candidate.json")) {
    fail("candidate transport is missing candidate.json");
  }
  if (existsSync(outputDir)) fail("candidate transport output directory already exists");
  mkdirSync(outputDir, { recursive: false, mode: 0o700 });
  try {
    for (const entry of files) {
      writeFileSync(join(outputDir, entry.path), entry.bytes, { flag: "wx", mode: 0o600 });
    }
    verifyCandidate(outputDir);
  } catch (error) {
    rmSync(outputDir, { recursive: true, force: true });
    throw error;
  }
  return true;
}

function readControlInventory(repo, controlCommit, contract = CURRENT_RELEASE_CONTRACT) {
  return contract.control_paths.map((path) => {
    const raw = gitBytes(repo, [
      "ls-tree",
      "-z",
      "--full-tree",
      "--format=%(objectmode)%x09%(objecttype)%x09%(objectname)%x09%(path)",
      controlCommit,
      "--",
      path,
    ]);
    const entries = parseLsTree(raw);
    if (entries.length === 0) return { path, present: false };
    if (entries.length !== 1 || entries[0].path !== path) fail(`control inventory is ambiguous: ${path}`);
    return { ...inventoryRecord(repo, entries[0]), present: true };
  });
}

function validatePayloadInventory(inventory, contract = CURRENT_RELEASE_CONTRACT) {
  if (!Array.isArray(inventory) || inventory.length === 0) fail("release payload inventory must be a non-empty array");
  let previous = null;
  for (const record of inventory) {
    if (!hasExactKeys(record, ["path", "type", "mode", "size", "sha256"])) {
      fail("release payload inventory record shape differs from policy");
    }
    decodeGitPath(Buffer.from(record.path, "utf8"));
    if (record.path.startsWith(".github/workflows/")) {
      fail(`release payload rejects workflow definitions: ${record.path}`);
    }
    if (
      record.type !== "file" ||
      record.mode !== "100644" ||
      !Number.isSafeInteger(record.size) ||
      record.size < 0 ||
      !/^[0-9a-f]{64}$/u.test(record.sha256 ?? "")
    ) {
      fail(`release payload inventory metadata is invalid: ${record.path ?? "<unknown>"}`);
    }
    if (previous !== null && Buffer.from(previous).compare(Buffer.from(record.path)) >= 0) {
      fail("release payload inventory paths must be unique and canonical byte-sorted");
    }
    previous = record.path;
  }
  const actualRuntimePaths = discoverV2RuntimeModulePaths(
    Object.fromEntries(inventory.map((record) => [record.path, record])),
  );
  if (!sameCanonicalValue(actualRuntimePaths, contract.runtime_paths)) {
    fail(`released v2 runtime module closure differs from policy: ${actualRuntimePaths.join(", ")}`);
  }
  return inventory;
}

function nulDelimitedInventoryDigest(inventory, contract = CURRENT_RELEASE_CONTRACT) {
  validatePayloadInventory(inventory, contract);
  const hash = createHash("sha256");
  for (const record of inventory) {
    for (const field of [record.path, record.type, record.mode, String(record.size), record.sha256]) {
      hash.update(field, "utf8");
      hash.update("\0", "binary");
    }
  }
  return hash.digest("hex");
}

function validateControlInventory(inventory, contract = CURRENT_RELEASE_CONTRACT) {
  if (!Array.isArray(inventory) || inventory.length !== contract.control_paths.length) {
    fail("release control inventory is incomplete");
  }
  for (let index = 0; index < contract.control_paths.length; index += 1) {
    const record = inventory[index];
    if (record?.path !== contract.control_paths[index] || typeof record.present !== "boolean") {
      fail("release control inventory paths differ from policy");
    }
    if (record.present === false) {
      if (!hasExactKeys(record, ["path", "present"])) fail(`absent control inventory record is malformed: ${record.path}`);
      continue;
    }
    if (!hasExactKeys(record, ["path", "type", "mode", "size", "sha256", "present"])) {
      fail(`present control inventory record is malformed: ${record.path}`);
    }
    const expectedMode = contract.executable_control_paths.includes(record.path) ? "100755" : "100644";
    decodeGitPath(Buffer.from(record.path, "utf8"));
    if (
      record.type !== "file" ||
      record.mode !== expectedMode ||
      !Number.isSafeInteger(record.size) ||
      record.size < 0 ||
      !/^[0-9a-f]{64}$/u.test(record.sha256 ?? "")
    ) {
      fail(`publisher control metadata differs from policy: ${record.path}`);
    }
  }
  return inventory;
}

function changedPaths(repo, parent, commit) {
  const raw = gitBytes(repo, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", parent, commit]);
  if (raw.length === 0) return [];
  return raw
    .subarray(0, raw.at(-1) === 0 ? -1 : undefined)
    .toString("binary")
    .split("\0")
    .filter(Boolean)
    .map((path) => decodeGitPath(Buffer.from(path, "binary")));
}

function isPublisherControlPath(path, contract = CURRENT_RELEASE_CONTRACT) {
  return contract.control_paths.includes(path) || path.startsWith(".github/workflows/");
}

function requireLinearRange(repo, ancestor, descendant) {
  try {
    git(repo, ["merge-base", "--is-ancestor", ancestor, descendant]);
  } catch {
    fail(`recovery_code=source-not-current-master-ancestor; ${ancestor} is not an ancestor of ${descendant}`);
  }
  const commits = git(repo, ["rev-list", "--reverse", "--ancestry-path", `${ancestor}..${descendant}`])
    .split("\n")
    .filter(Boolean);
  let previous = ancestor;
  for (const commit of commits) {
    const parents = git(repo, ["show", "-s", "--format=%P", commit]).split(/\s+/u).filter(Boolean);
    if (parents.length !== 1 || parents[0] !== previous) {
      fail("recovery_code=nonlinear-release-control-range; release/control ancestry must be linear");
    }
    previous = commit;
  }
  if (previous !== descendant) fail("recovery_code=incomplete-release-control-range; release/control ancestry is incomplete");
  return commits;
}

function validatePushAdmission(admission, contract = CURRENT_RELEASE_CONTRACT) {
  if (
    !hasExactKeys(admission, [
      "schema",
      "schema_version",
      "event",
      "before_commit",
      "after_commit",
      "landing_commits",
    ]) ||
    admission.schema !== contract.push_admission.schema ||
    admission.schema_version !== contract.push_admission.schema_version ||
    admission.event !== contract.push_admission.event ||
    !/^[0-9a-f]{40}$/u.test(admission.before_commit ?? "") ||
    !/^[0-9a-f]{40}$/u.test(admission.after_commit ?? "") ||
    admission.before_commit === admission.after_commit ||
    !Array.isArray(admission.landing_commits) ||
    admission.landing_commits.length === 0 ||
    admission.landing_commits.some((commit) => !/^[0-9a-f]{40}$/u.test(commit)) ||
    new Set(admission.landing_commits).size !== admission.landing_commits.length ||
    admission.landing_commits.at(-1) !== admission.after_commit
  ) {
    fail("release push admission record differs from policy");
  }
  return admission;
}

function expectedPushAdmission(repo, beforeCommit, afterCommit, contract = CURRENT_RELEASE_CONTRACT) {
  if (!/^[0-9a-f]{40}$/u.test(beforeCommit) || !/^[0-9a-f]{40}$/u.test(afterCommit)) {
    fail("push admission before/after commits must be full SHA-1 object IDs");
  }
  const landingCommits = requireLinearRange(repo, beforeCommit, afterCommit);
  if (landingCommits.length === 0) fail("release push admission range must be non-empty");
  let previous = beforeCommit;
  for (const commit of landingCommits) {
    const forbidden = changedPaths(repo, previous, commit)
      .filter((path) => isPublisherControlPath(path, contract));
    if (forbidden.length > 0) {
      fail(`recovery_code=publisher-control-landing; push landing changed publisher controls: ${forbidden.join(", ")}`);
    }
    previous = commit;
  }
  return validatePushAdmission({
    schema: contract.push_admission.schema,
    schema_version: contract.push_admission.schema_version,
    event: contract.push_admission.event,
    before_commit: beforeCommit,
    after_commit: afterCommit,
    landing_commits: landingCommits,
  }, contract);
}

function assertControlClosure(repo, sourceCommit, controlCommit, contract = CURRENT_RELEASE_CONTRACT) {
  const parents = git(repo, ["show", "-s", "--format=%P", sourceCommit]).split(/\s+/u).filter(Boolean);
  if (parents.length !== 1) fail("release intent commit must have exactly one parent");
  const parent = parents[0];
  let parentManifestObject = null;
  try {
    parentManifestObject = git(repo, ["rev-parse", `${parent}:release-manifest.json`]);
  } catch {
    // Introducing the first manifest is a release-intent change. The control
    // co-change check below still has priority for the infrastructure commit.
  }
  const currentManifestObject = git(repo, ["rev-parse", `${sourceCommit}:release-manifest.json`]);
  if (parentManifestObject === currentManifestObject) {
    fail("recovery_code=source-not-release-intent; source_sha must be the commit that changes release-manifest.json");
  }
  const intentControls = changedPaths(repo, parent, sourceCommit)
    .filter((path) => isPublisherControlPath(path, contract));
  if (intentControls.length > 0) {
    fail(`recovery_code=publisher-control-closure; release intent and publisher controls changed together: ${intentControls.join(", ")}`);
  }
  // Exact-source recovery deliberately runs under the current protected
  // publisher controls, even when later release intents exist. Eligibility is
  // decided separately against live master: a superseded intent may only
  // complete a proved canonical partial prefix and cannot start new history.
  requireLinearRange(repo, sourceCommit, controlCommit);
}

function parseActionMetadataSubset(source) {
  if (
    !source.endsWith("\n") ||
    source.includes("\r") ||
    source.includes("\t") ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u0085\u2028\u2029]/u.test(source)
  ) {
    fail("root action.yml must use canonical UTF-8 text with LF indentation and no control characters");
  }
  const root = Object.create(null);
  const stack = [{ indent: -2, mapping: root }];
  const parseScalar = (raw, lineNumber) => {
    if (raw.length === 0) fail(`root action.yml line ${lineNumber} has an empty scalar`);
    if (raw.startsWith('"')) {
      let value;
      try {
        value = JSON.parse(raw);
      } catch {
        fail(`root action.yml line ${lineNumber} has an invalid quoted scalar`);
      }
      if (typeof value !== "string") fail(`root action.yml line ${lineNumber} must be a string scalar`);
      return Object.freeze({ nodeType: "scalar", raw, value });
    }
    if (
      /^[\-?:,\[\]{}#&*!|>'"%@`]/u.test(raw) ||
      /[\[\]{}]/u.test(raw) ||
      /(?:^|\s)[&*!][^\s]/u.test(raw) ||
      /\s#/u.test(raw) ||
      /:\s/u.test(raw) ||
      ["null", "Null", "NULL", "~", ".nan", ".NaN", ".NAN", ".inf", ".Inf", ".INF"].includes(raw)
    ) {
      fail(`root action.yml line ${lineNumber} uses YAML syntax outside the closed metadata subset`);
    }
    const value = raw === "true" ? true : raw === "false" ? false : raw;
    return Object.freeze({ nodeType: "scalar", raw, value });
  };

  for (const [index, line] of source.split("\n").entries()) {
    const lineNumber = index + 1;
    if (line === "") continue;
    if (line === "---" || line === "...") {
      fail("root action.yml must contain exactly one implicit YAML document");
    }
    const indent = /^ */u.exec(line)[0].length;
    if (indent % 2 !== 0 || indent > 4) {
      fail(`root action.yml line ${lineNumber} has invalid mapping indentation`);
    }
    const content = line.slice(indent);
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/u.exec(content);
    if (!match) fail(`root action.yml line ${lineNumber} is outside the closed mapping-only subset`);
    const key = match[1];
    const suffix = match[2];
    while (stack.at(-1).indent >= indent) stack.pop();
    const parent = stack.at(-1);
    if (!parent || parent.indent !== indent - 2) {
      fail(`root action.yml line ${lineNumber} skips or escapes its mapping level`);
    }
    if (Object.hasOwn(parent.mapping, key)) {
      fail(`root action.yml contains duplicate key ${key}`);
    }
    if (suffix === "") {
      const mapping = Object.create(null);
      parent.mapping[key] = mapping;
      stack.push({ indent, mapping });
    } else {
      if (!suffix.startsWith(" ") || suffix.startsWith("  ")) {
        fail(`root action.yml line ${lineNumber} must use one space before a scalar`);
      }
      parent.mapping[key] = parseScalar(suffix.slice(1), lineNumber);
    }
  }
  return root;
}

function requireMetadataKeys(mapping, expected, label) {
  if (
    mapping === null ||
    typeof mapping !== "object" ||
    mapping.nodeType === "scalar" ||
    !sameCanonicalValue(Object.keys(mapping).sort(), [...expected].sort())
  ) {
    fail(`${label} keys differ from the closed Action metadata policy`);
  }
}

function metadataScalar(mapping, key, label) {
  const value = mapping?.[key];
  if (value?.nodeType !== "scalar") fail(`${label}.${key} must be a scalar`);
  return value;
}

function validateActionMetadataV2_0(bytes) {
  if (![...bytes].every((byte) => byte === 0x0a || (byte >= 0x20 && byte <= 0x7e))) {
    fail("root action.yml must contain only printable ASCII bytes and LF line endings");
  }
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("root action.yml must be valid UTF-8");
  }
  const metadata = parseActionMetadataSubset(source);
  requireMetadataKeys(metadata, ["name", "description", "author", "branding", "inputs", "outputs", "runs"], "root action.yml");
  if (
    metadataScalar(metadata, "name", "root action.yml").raw !== "Codex Review Gate" ||
    metadataScalar(metadata, "author", "root action.yml").raw !== "JoeyTeng" ||
    typeof metadataScalar(metadata, "description", "root action.yml").value !== "string" ||
    metadataScalar(metadata, "description", "root action.yml").value.length === 0
  ) {
    fail("root Action identity differs from policy");
  }

  requireMetadataKeys(metadata.branding, ["icon", "color"], "root action.yml.branding");
  if (
    metadataScalar(metadata.branding, "icon", "root action.yml.branding").raw !== "shield" ||
    metadataScalar(metadata.branding, "color", "root action.yml.branding").raw !== "blue"
  ) {
    fail("root Action branding differs from policy");
  }

  const inputPolicy = Object.freeze({
    github_token: { required: "true" },
    pr_number: { required: "true" },
    expected_head_sha: { required: "false", default: '\"\"' },
    operation: { required: "false", default: "reconcile" },
    request_comment_id: { required: "false", default: '\"\"' },
    request_review: { required: "false", default: '\"true\"' },
    limits_profile: { required: "false", default: "default" },
  });
  requireMetadataKeys(metadata.inputs, Object.keys(inputPolicy), "root action.yml.inputs");
  for (const [name, policy] of Object.entries(inputPolicy)) {
    const input = metadata.inputs[name];
    requireMetadataKeys(input, ["description", "required", ...(policy.default === undefined ? [] : ["default"])], `root action.yml.inputs.${name}`);
    if (
      typeof metadataScalar(input, "description", `root action.yml.inputs.${name}`).value !== "string" ||
      metadataScalar(input, "description", `root action.yml.inputs.${name}`).value.length === 0 ||
      metadataScalar(input, "required", `root action.yml.inputs.${name}`).raw !== policy.required ||
      (policy.default !== undefined && metadataScalar(input, "default", `root action.yml.inputs.${name}`).raw !== policy.default)
    ) {
      fail(`root Action input ${name} differs from policy`);
    }
  }

  const outputNames = ["execution_health", "gate_outcome", "recovery_code", "retry_safe"];
  requireMetadataKeys(metadata.outputs, outputNames, "root action.yml.outputs");
  for (const name of outputNames) {
    requireMetadataKeys(metadata.outputs[name], ["description"], `root action.yml.outputs.${name}`);
    const description = metadataScalar(metadata.outputs[name], "description", `root action.yml.outputs.${name}`);
    if (typeof description.value !== "string" || description.value.length === 0) {
      fail(`root Action output ${name} must have a non-empty description`);
    }
  }

  requireMetadataKeys(metadata.runs, ["using", "main"], "root action.yml.runs");
  if (
    metadataScalar(metadata.runs, "using", "root action.yml.runs").raw !== "node20" ||
    metadataScalar(metadata.runs, "main", "root action.yml.runs").raw !== "src/v2/gate-runtime.mjs"
  ) {
    fail("root action.yml entrypoint differs from the manifest JavaScript Action policy");
  }
  return true;
}

export function validateActionMetadata(bytes, contract = CURRENT_RELEASE_CONTRACT) {
  if (contract.id === RELEASE_CONTRACT_V2_0.id) return validateActionMetadataV2_0(bytes);
  fail(`release contract ${contract.id} has no frozen Action metadata validator`);
}

function expectedReleasePlan({
  repo,
  sourceCommit,
  controlCommit,
  pushAdmission,
  contract = CURRENT_RELEASE_CONTRACT,
}) {
  validatePushAdmission(pushAdmission, contract);
  if (pushAdmission.after_commit !== sourceCommit) {
    fail("release push admission does not bind the exact source commit");
  }
  const manifestBytes = gitBytes(repo, ["show", `${sourceCommit}:release-manifest.json`]);
  const manifest = readReleaseManifestAt(repo, sourceCommit, contract);
  assertControlClosure(repo, sourceCommit, controlCommit, contract);
  const executionControlFiles = readControlInventory(repo, controlCommit, contract);
  const sourceTree = git(repo, ["rev-parse", `${sourceCommit}:${contract.source_path}`]);
  if (sourceTree !== manifest.source.tree) {
    fail("release manifest source.tree differs from the exact Action subtree");
  }
  const payloadFiles = readPayloadInventory(repo, sourceCommit, contract);
  if (!sameCanonicalValue(payloadFiles, manifest.files)) {
    fail("release manifest file inventory differs from the exact Action subtree");
  }
  validateActionMetadata(
    gitBytes(repo, ["show", `${sourceCommit}:${contract.source_path}/${contract.entrypoint.metadata_path}`]),
    contract,
  );
  const actionPackage = JSON.parse(git(repo, ["show", `${sourceCommit}:${contract.source_path}/package.json`]));
  if (actionPackage.version !== manifest.version) {
    fail("release manifest version must equal packages/action/package.json version");
  }
  if (actionPackage.repository?.url !== contract.action_package_repository) {
    fail("released action package repository metadata differs from target repository");
  }
  return {
    schema: contract.plan.schema,
    schema_version: contract.plan.schema_version,
    release_contract: contract.id,
    push_admission: pushAdmission,
    version: manifest.version,
    immutable_tag: manifest.release.immutableTag,
    major_alias: manifest.release.majorAlias,
    prerelease: manifest.release.prerelease !== null,
    source_repository: contract.source_repository,
    source_commit: sourceCommit,
    source_path: contract.source_path,
    source_tree: sourceTree,
    manifest_sha256: createHash("sha256").update(manifestBytes).digest("hex"),
    release_intent_commit: sourceCommit,
    control_repository: contract.source_repository,
    control_commit: controlCommit,
    control_files: executionControlFiles,
    target_repository: contract.target_repository,
    target_branch: contract.target_branch,
    target_master_before: manifest.target.expected_head,
    previous_version: manifest.target.previous_version,
    signer: { ...manifest.signer },
  };
}

function recoverPushAdmission(repo, sourceCommit, admissionPlanPath) {
  const admittedPlan = validatePlan(readJson(admissionPlanPath));
  if (
    admittedPlan.release_contract !== CURRENT_RELEASE_CONTRACT.id ||
    admittedPlan.source_commit !== sourceCommit ||
    admittedPlan.push_admission.after_commit !== sourceCommit
  ) {
    fail("persisted push admission does not bind the requested exact source commit");
  }
  const expectedAdmission = expectedPushAdmission(
    repo,
    admittedPlan.push_admission.before_commit,
    sourceCommit,
    CURRENT_RELEASE_CONTRACT,
  );
  const originalControlCommit = git(repo, ["rev-parse", "--verify", `${admittedPlan.control_commit}^{commit}`]);
  const expectedOriginalPlan = expectedReleasePlan({
    repo,
    sourceCommit,
    controlCommit: originalControlCommit,
    pushAdmission: expectedAdmission,
    contract: CURRENT_RELEASE_CONTRACT,
  });
  if (!sameCanonicalValue(admittedPlan, expectedOriginalPlan)) {
    fail("persisted push admission plan differs from the original exact source and controls");
  }
  return expectedAdmission;
}

export function createReleasePlan({
  repo,
  sourceRef,
  controlRef = sourceRef,
  admissionBeforeRef,
  admissionPlanPath,
}) {
  const sourceCommit = git(repo, ["rev-parse", "--verify", `${sourceRef}^{commit}`]);
  const controlCommit = git(repo, ["rev-parse", "--verify", `${controlRef}^{commit}`]);
  if ((admissionBeforeRef === undefined) === (admissionPlanPath === undefined)) {
    fail("release planning requires exactly one push admission source");
  }
  const pushAdmission = admissionPlanPath === undefined
    ? expectedPushAdmission(
      repo,
      git(repo, ["rev-parse", "--verify", `${admissionBeforeRef}^{commit}`]),
      sourceCommit,
      CURRENT_RELEASE_CONTRACT,
    )
    : recoverPushAdmission(repo, sourceCommit, admissionPlanPath);
  return expectedReleasePlan({ repo, sourceCommit, controlCommit, pushAdmission });
}

export function validatePlan(plan, contract = releaseContractFor(
  plan,
  HISTORICAL_PLAN_CONTRACTS,
  "release plan",
)) {
  if (plan.schema !== contract.plan.schema || plan.schema_version !== contract.plan.schema_version) {
    fail("candidate uses an unsupported release plan");
  }
  if (!hasExactKeys(plan, [
    "schema",
    "schema_version",
    "release_contract",
    "push_admission",
    "version",
    "immutable_tag",
    "major_alias",
    "prerelease",
    "source_repository",
    "source_commit",
    "source_path",
    "source_tree",
    "manifest_sha256",
    "release_intent_commit",
    "control_repository",
    "control_commit",
    "control_files",
    "target_repository",
    "target_branch",
    "target_master_before",
    "previous_version",
    "signer",
  ])) {
    fail("release plan field set differs from policy");
  }
  const release = parseSemverForContract(plan.version, contract);
  if (plan.release_contract !== contract.id) {
    fail("release plan contract differs from policy");
  }
  validatePushAdmission(plan.push_admission, contract);
  if (
    plan.immutable_tag !== release.immutableTag ||
    plan.major_alias !== release.majorAlias ||
    plan.prerelease !== (release.prerelease !== null)
  ) {
    fail("release plan tags do not match SemVer policy");
  }
  if (
    plan.source_repository !== contract.source_repository ||
    plan.control_repository !== contract.source_repository ||
    plan.target_repository !== contract.target_repository
  ) {
    fail("release plan repository identity differs from policy");
  }
  for (const field of ["source_commit", "source_tree", "release_intent_commit", "control_commit", "target_master_before"]) {
    if (!/^[0-9a-f]{40}$/u.test(plan[field] ?? "")) fail(`release plan ${field} must be a full SHA-1 object ID`);
  }
  if (plan.release_intent_commit !== plan.source_commit) fail("release intent commit must equal source commit");
  if (plan.push_admission.after_commit !== plan.source_commit) {
    fail("release plan push admission must end at the exact source commit");
  }
  if (!/^[0-9a-f]{64}$/u.test(plan.manifest_sha256 ?? "")) fail("release plan manifest digest is invalid");
  if (plan.source_path !== contract.source_path || plan.target_branch !== contract.target_branch) {
    fail("release plan source path or target branch differs from policy");
  }
  if (compareSemverForContract(plan.version, plan.previous_version, contract) <= 0) {
    fail("release plan does not advance previous_version");
  }
  if (
    !hasExactKeys(plan.signer, Object.keys(contract.signer)) ||
    !sameCanonicalValue(plan.signer, contract.signer)
  ) {
    fail("release plan signer differs from policy");
  }
  validateControlInventory(plan.control_files, contract);
  return plan;
}

function exactRefCondition(ruleset, expectedInclude, expectedExclude = []) {
  const include = ruleset.conditions?.ref_name?.include;
  const exclude = ruleset.conditions?.ref_name?.exclude;
  return sameCanonicalValue(include, expectedInclude) && sameCanonicalValue(exclude, expectedExclude);
}

function exactPublisherBypass(ruleset) {
  const actors = ruleset.bypass_actors;
  return Array.isArray(actors) &&
    actors.length === 1 &&
    actors[0]?.actor_id === 4700530 &&
    actors[0]?.actor_type === "Integration" &&
    actors[0]?.bypass_mode === "always";
}

function exactRuleTypes(ruleset, requiredTypes) {
  const types = (ruleset.rules ?? []).map((rule) => rule.type);
  const present = new Set(types);
  return types.length === requiredTypes.length &&
    present.size === requiredTypes.length &&
    requiredTypes.every((type) => present.has(type));
}

export function validatePublisherRulesets(rulesets) {
  if (!Array.isArray(rulesets)) fail("publisher ruleset snapshot must be an array");
  const active = rulesets.filter((ruleset) => ruleset.enforcement === "active");
  const expectedNames = new Set([
    "publisher-master-update",
    "master-integrity",
    "freeze-v1-tags",
    "publisher-v2-plus-tags",
  ]);
  if (
    active.length !== expectedNames.size ||
    new Set(active.map((ruleset) => ruleset.name)).size !== expectedNames.size ||
    active.some((ruleset) => !expectedNames.has(ruleset.name))
  ) {
    fail("active target rulesets must be exactly the four adopted publisher rulesets");
  }
  const publisherMaster = active.find((ruleset) => ruleset.name === "publisher-master-update");
  if (
    publisherMaster?.target !== "branch" ||
    !exactRefCondition(publisherMaster, ["refs/heads/master"]) ||
    !exactPublisherBypass(publisherMaster) ||
    !exactRuleTypes(publisherMaster, ["update"])
  ) {
    fail("publisher-master-update must actively protect only master updates with the sole publisher App bypass");
  }

  const masterIntegrity = active.find((ruleset) => ruleset.name === "master-integrity");
  if (
    masterIntegrity?.target !== "branch" ||
    !exactRefCondition(masterIntegrity, ["refs/heads/master"]) ||
    !Array.isArray(masterIntegrity.bypass_actors) ||
    masterIntegrity.bypass_actors.length !== 0 ||
    !exactRuleTypes(masterIntegrity, [
      "required_signatures",
      "required_linear_history",
      "deletion",
      "non_fast_forward",
    ])
  ) {
    fail("master-integrity must actively enforce signed linear undeletable non-force-push master history without bypass actors");
  }

  const freezeV1 = active.find((ruleset) => ruleset.name === "freeze-v1-tags");
  if (
    freezeV1?.target !== "tag" ||
    !exactRefCondition(freezeV1, ["refs/tags/v1", "refs/tags/v1.*"]) ||
    !Array.isArray(freezeV1.bypass_actors) ||
    freezeV1.bypass_actors.length !== 0 ||
    !exactRuleTypes(freezeV1, ["creation", "update", "deletion", "non_fast_forward"])
  ) {
    fail("freeze-v1-tags must freeze refs/tags/v1 and refs/tags/v1.* without bypass actors");
  }

  const publisherV2Plus = active.find((ruleset) => ruleset.name === "publisher-v2-plus-tags");
  if (
    publisherV2Plus?.target !== "tag" ||
    !exactRefCondition(
      publisherV2Plus,
      ["refs/tags/v*"],
      ["refs/tags/v1", "refs/tags/v1.*"],
    ) ||
    !exactPublisherBypass(publisherV2Plus) ||
    !exactRuleTypes(publisherV2Plus, ["creation", "update", "deletion", "non_fast_forward"])
  ) {
    fail("publisher-v2-plus-tags must protect v2+ tags with the sole publisher App bypass and exact v1 exclusions");
  }
  return true;
}

function stableReleaseAssetProjection(release, {
  allowStarterAssets = false,
  requirePublisherUploader = false,
} = {}) {
  if (!Array.isArray(release?.assets)) fail("GitHub Release asset snapshot must contain an assets array");
  const names = new Set();
  const ids = new Set();
  const snapshot = release.assets.map((asset) => {
    if (
      !Number.isSafeInteger(asset.id) ||
      asset.id <= 0 ||
      ids.has(asset.id) ||
      typeof asset.node_id !== "string" ||
      asset.node_id.length === 0 ||
      typeof asset.name !== "string" ||
      basename(asset.name) !== asset.name ||
      names.has(asset.name) ||
      !(
        asset.state === "uploaded" ||
        (allowStarterAssets && asset.state === "starter")
      ) ||
      typeof asset.content_type !== "string" ||
      !Number.isSafeInteger(asset.size) ||
      asset.size < 0 ||
      !(
        asset.digest === null ||
        asset.digest === undefined ||
        /^sha256:[0-9a-f]{64}$/u.test(asset.digest)
      ) ||
      typeof asset.created_at !== "string" ||
      typeof asset.updated_at !== "string" ||
      typeof asset.url !== "string" ||
      typeof asset.browser_download_url !== "string" ||
      typeof asset.uploader?.login !== "string" ||
      asset.uploader.login.length === 0 ||
      (asset.uploader?.type !== "Bot" && asset.uploader?.type !== "User") ||
      !Number.isSafeInteger(asset.uploader?.id) ||
      asset.uploader.id <= 0 ||
      typeof asset.uploader?.node_id !== "string" ||
      asset.uploader.node_id.length === 0
    ) {
      fail(`GitHub Release asset metadata differs from policy: ${asset?.name ?? "<unknown>"}`);
    }
    if (
      requirePublisherUploader &&
      (
        asset.uploader.login !== "codex-review-gate-action-publisher[bot]" ||
        asset.uploader.type !== "Bot"
      )
    ) {
      fail(`GitHub Release asset metadata differs from policy: ${asset.name}`);
    }
    names.add(asset.name);
    ids.add(asset.id);
    return {
      id: asset.id,
      node_id: asset.node_id,
      name: asset.name,
      state: asset.state,
      content_type: asset.content_type,
      size: asset.size,
      digest: asset.digest ?? null,
      created_at: asset.created_at,
      updated_at: asset.updated_at,
      url: asset.url,
      browser_download_url: asset.browser_download_url,
      uploader: {
        id: asset.uploader.id,
        node_id: asset.uploader.node_id,
        login: asset.uploader.login,
        type: asset.uploader.type,
      },
    };
  });
  snapshot.sort((left, right) =>
    Buffer.from(left.name).compare(Buffer.from(right.name)) ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
  return snapshot;
}

export function canonicalReleaseAssetSnapshot(release) {
  return canonicalJson(stableReleaseAssetProjection(release, {
    requirePublisherUploader: true,
  }));
}

export function canonicalNeutralReleaseInventorySnapshot(pages) {
  if (!Array.isArray(pages) || pages.length === 0 || !pages.every(Array.isArray)) {
    fail("GitHub Release inventory must be a nonempty paginated array of arrays");
  }
  const releaseIds = new Set();
  const assetIds = new Set();
  const snapshot = pages.flat().map((release) => {
    if (
      release === null || typeof release !== "object" || Array.isArray(release) ||
      release.author === null || typeof release.author !== "object" ||
      Array.isArray(release.author) || !Array.isArray(release.assets)
    ) {
      fail("GitHub Release inventory shape cannot be projected safely");
    }
    if (Number.isSafeInteger(release.id) && release.id > 0) {
      if (releaseIds.has(release.id)) fail(`GitHub Release inventory repeats id: ${release.id}`);
      releaseIds.add(release.id);
    }
    const assets = release.assets.map((asset) => {
      if (
        asset === null || typeof asset !== "object" || Array.isArray(asset) ||
        asset.uploader === null || typeof asset.uploader !== "object" ||
        Array.isArray(asset.uploader)
      ) {
        fail("GitHub Release asset shape cannot be projected safely");
      }
      if (Number.isSafeInteger(asset.id) && asset.id > 0) {
        if (assetIds.has(asset.id)) fail(`GitHub Release inventory repeats asset id: ${asset.id}`);
        assetIds.add(asset.id);
      }
      return {
        id: asset.id,
        node_id: asset.node_id,
        name: asset.name,
        state: asset.state,
        content_type: asset.content_type,
        size: asset.size,
        digest: asset.digest ?? null,
        url: asset.url,
        browser_download_url: asset.browser_download_url,
        uploader: {
          id: asset.uploader.id,
          node_id: asset.uploader.node_id,
          login: asset.uploader.login,
          type: asset.uploader.type,
        },
      };
    });
    assets.sort((left, right) => Buffer.from(canonicalJson(left)).compare(
      Buffer.from(canonicalJson(right)),
    ));
    return {
      id: release.id,
      node_id: release.node_id,
      tag_name: release.tag_name,
      name: release.name,
      body: release.body,
      target_commitish: release.target_commitish,
      prerelease: release.prerelease,
      draft: release.draft,
      immutable: release.immutable,
      author: {
        id: release.author.id,
        node_id: release.author.node_id,
        login: release.author.login,
        type: release.author.type,
      },
      assets,
    };
  });
  snapshot.sort((left, right) => Buffer.from(canonicalJson(left)).compare(
    Buffer.from(canonicalJson(right)),
  ));
  return canonicalJson(snapshot);
}

export function canonicalReleaseInventorySnapshot(pages) {
  if (!Array.isArray(pages) || !pages.every(Array.isArray)) {
    fail("GitHub Release inventory must be a paginated array of arrays");
  }
  const allAssetIds = new Set();
  const snapshot = pages.flat().map((release) => {
    if (
      !Number.isSafeInteger(release?.id) || release.id <= 0 ||
      typeof release.node_id !== "string" || release.node_id.length === 0 ||
      typeof release.tag_name !== "string" || release.tag_name.length === 0 ||
      !(release.name === null || typeof release.name === "string") ||
      !(release.body === null || typeof release.body === "string") ||
      typeof release.target_commitish !== "string" || release.target_commitish.length === 0 ||
      typeof release.prerelease !== "boolean" ||
      typeof release.draft !== "boolean" ||
      typeof release.immutable !== "boolean" ||
      !Number.isSafeInteger(release.author?.id) || release.author.id <= 0 ||
      typeof release.author?.node_id !== "string" || release.author.node_id.length === 0 ||
      typeof release.author?.login !== "string" || release.author.login.length === 0 ||
      (release.author?.type !== "Bot" && release.author?.type !== "User")
    ) {
      fail(`GitHub Release inventory metadata is malformed: ${release?.tag_name ?? "<unknown>"}`);
    }
    const assets = stableReleaseAssetProjection(release, { allowStarterAssets: true })
      .map(({ created_at: _createdAt, updated_at: _updatedAt, ...asset }) => asset);
    for (const asset of assets) {
      if (allAssetIds.has(asset.id)) {
        fail(`GitHub Release inventory repeats asset id: ${asset.id}`);
      }
      allAssetIds.add(asset.id);
    }
    return {
      id: release.id,
      node_id: release.node_id,
      tag_name: release.tag_name,
      name: release.name,
      body: release.body,
      target_commitish: release.target_commitish,
      prerelease: release.prerelease,
      draft: release.draft,
      immutable: release.immutable,
      author: {
        id: release.author.id,
        node_id: release.author.node_id,
        login: release.author.login,
        type: release.author.type,
      },
      assets,
    };
  });
  snapshot.sort((left, right) =>
    Buffer.from(left.tag_name).compare(Buffer.from(right.tag_name)) ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
  return canonicalJson(snapshot);
}

export function canonicalReleaseBoundarySnapshot(release, {
  tag,
  body,
  prerelease,
  draft,
  immutable,
  allowStarterAssets = false,
}) {
  if (
    !Number.isSafeInteger(release?.id) || release.id <= 0 ||
    typeof release.node_id !== "string" || release.node_id.length === 0 ||
    release.tag_name !== tag ||
    release.name !== tag ||
    release.body !== body ||
    typeof release.target_commitish !== "string" || release.target_commitish.length === 0 ||
    release.prerelease !== prerelease ||
    release.draft !== draft ||
    release.immutable !== immutable ||
    !Number.isSafeInteger(release.author?.id) || release.author.id <= 0 ||
    typeof release.author?.node_id !== "string" || release.author.node_id.length === 0 ||
    release.author?.login !== "codex-review-gate-action-publisher[bot]" ||
    release.author?.type !== "Bot"
  ) {
    fail("GitHub Release boundary metadata or author differs from policy");
  }
  const assets = stableReleaseAssetProjection(release, {
    allowStarterAssets,
    requirePublisherUploader: true,
  }).map(({ created_at: _createdAt, updated_at: _updatedAt, ...asset }) => asset);
  return canonicalJson({
    release: {
      id: release.id,
      node_id: release.node_id,
      tag_name: release.tag_name,
      name: release.name,
      body: release.body,
      target_commitish: release.target_commitish,
      prerelease: release.prerelease,
      draft: release.draft,
      immutable: release.immutable,
      author: {
        id: release.author.id,
        node_id: release.author.node_id,
        login: release.author.login,
        type: release.author.type,
      },
    },
    assets,
  });
}

function parseSecretKeyInventory(colonText) {
  const records = [];
  let current = null;
  for (const line of colonText.split("\n")) {
    const fields = line.split(":");
    if (fields[0] === "sec" || fields[0] === "ssb") {
      current = {
        kind: fields[0],
        validity: fields[1] ?? "",
        expiresAt: fields[6] ?? "",
        capabilities: fields[11] ?? "",
        secretMarker: fields[14] ?? "",
        fingerprint: null,
        keygrip: null,
      };
      records.push(current);
    } else if (fields[0] === "fpr" && current?.fingerprint === null) {
      current.fingerprint = (fields[9] ?? "").toUpperCase();
    } else if (fields[0] === "grp" && current?.keygrip === null) {
      current.keygrip = (fields[9] ?? "").toUpperCase();
    }
  }
  return records;
}

function parsePublicKeyInventory(colonText) {
  const records = [];
  let current = null;
  for (const line of colonText.split("\n")) {
    const fields = line.split(":");
    if (fields[0] === "pub" || fields[0] === "sub") {
      current = {
        kind: fields[0],
        validity: fields[1] ?? "",
        expiresAt: fields[6] ?? "",
        capabilities: fields[11] ?? "",
        fingerprint: null,
      };
      records.push(current);
    } else if (fields[0] === "fpr" && current?.fingerprint === null) {
      current.fingerprint = (fields[9] ?? "").toUpperCase();
    }
  }
  return records;
}

export function validateGitHubSigningKeyInventory(keys, {
  primaryFingerprint = PRIMARY_FINGERPRINT,
  signingFingerprint = SIGNING_SUBKEY_FINGERPRINT,
} = {}) {
  if (!Array.isArray(keys)) fail("GitHub GPG key response must be an array");
  const expectedPrimary = primaryFingerprint.toUpperCase();
  const expectedSigning = signingFingerprint.toUpperCase();
  const primaryKeyId = expectedPrimary.slice(-16);
  const signingKeyId = expectedSigning.slice(-16);
  const selected = keys.filter((key) => key?.key_id?.toUpperCase() === primaryKeyId);
  if (selected.length !== 1) {
    fail("GitHub GPG key response must contain exactly one pinned primary key");
  }
  const primary = selected[0];
  if (
    !Number.isSafeInteger(primary.id) ||
    primary.primary_key_id !== null ||
    primary.revoked !== false ||
    primary.expires_at !== null ||
    primary.can_sign !== true ||
    typeof primary.raw_key !== "string" ||
    !primary.raw_key.startsWith("-----BEGIN PGP PUBLIC KEY BLOCK-----") ||
    !primary.raw_key.trimEnd().endsWith("-----END PGP PUBLIC KEY BLOCK-----") ||
    !Array.isArray(primary.subkeys)
  ) {
    fail("pinned GitHub primary GPG key metadata differs from release policy");
  }
  const signingSubkeys = primary.subkeys.filter(
    (subkey) => subkey?.key_id?.toUpperCase() === signingKeyId,
  );
  if (signingSubkeys.length !== 1) {
    fail("GitHub GPG key response must contain exactly one pinned signing subkey");
  }
  const signingSubkey = signingSubkeys[0];
  if (
    !Number.isSafeInteger(signingSubkey.id) ||
    signingSubkey.primary_key_id !== primary.id ||
    signingSubkey.revoked !== false ||
    signingSubkey.expires_at !== null ||
    signingSubkey.can_sign !== true
  ) {
    fail("pinned GitHub signing subkey metadata differs from release policy");
  }

  const publicHome = mkdtempSync(join(tmpdir(), "codex-review-gate-public-key-preflight-"));
  try {
    chmodSync(publicHome, 0o700);
    const colonText = execFileSync("gpg", [
      "--batch",
      "--homedir", publicHome,
      "--with-colons",
      "--with-subkey-fingerprint",
      "--import-options", "show-only",
      "--dry-run",
      "--import",
    ], {
      encoding: "utf8",
      input: primary.raw_key,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const records = parsePublicKeyInventory(colonText);
    const primaryRecords = records.filter((record) => record.kind === "pub");
    const signingRecords = records.filter(
      (record) => record.kind === "sub" && record.fingerprint === expectedSigning,
    );
    if (
      primaryRecords.length !== 1 ||
      primaryRecords[0].fingerprint !== expectedPrimary ||
      ["r", "e", "d", "i"].includes(primaryRecords[0].validity) ||
      !["", "0"].includes(primaryRecords[0].expiresAt) ||
      signingRecords.length !== 1 ||
      ["r", "e", "d", "i"].includes(signingRecords[0].validity) ||
      !["", "0"].includes(signingRecords[0].expiresAt) ||
      !signingRecords[0].capabilities.toLowerCase().includes("s")
    ) {
      fail("GitHub raw public key does not contain the valid non-expiring pinned signing identity");
    }
  } finally {
    rmSync(publicHome, { recursive: true, force: true });
  }
  return primary.raw_key;
}

export function validateSigningKeyHome({
  gnupgHome,
  primaryFingerprint = PRIMARY_FINGERPRINT,
  signingFingerprint = SIGNING_SUBKEY_FINGERPRINT,
}) {
  const home = resolve(gnupgHome);
  const expectedPrimary = primaryFingerprint.toUpperCase();
  const expectedSigning = signingFingerprint.toUpperCase();
  const colonText = execFileSync("gpg", [
    "--batch",
    "--homedir", home,
    "--with-colons",
    "--with-keygrip",
    "--with-subkey-fingerprint",
    "--list-secret-keys",
  ], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const records = parseSecretKeyInventory(colonText);
  const primaryRecords = records.filter((record) => record.kind === "sec");
  if (
    primaryRecords.length !== 1 ||
    primaryRecords[0].fingerprint !== expectedPrimary ||
    primaryRecords[0].secretMarker !== "#" ||
    ["r", "e", "d", "i"].includes(primaryRecords[0].validity) ||
    !["", "0"].includes(primaryRecords[0].expiresAt) ||
    primaryRecords[0].capabilities.includes("D")
  ) {
    fail("release keyring must contain one valid non-expiring pinned primary key with no primary secret material");
  }
  const availableSecrets = records.filter((record) => record.secretMarker !== "#");
  if (
    availableSecrets.length !== 1 ||
    availableSecrets[0].kind !== "ssb" ||
    availableSecrets[0].fingerprint !== expectedSigning ||
    availableSecrets[0].secretMarker !== "+" ||
    !availableSecrets[0].capabilities.toLowerCase().includes("s") ||
    ["r", "e", "d", "i"].includes(availableSecrets[0].validity) ||
    !["", "0"].includes(availableSecrets[0].expiresAt) ||
    availableSecrets[0].capabilities.includes("D")
  ) {
    fail("release keyring secret material must be exactly one valid non-expiring pinned signing subkey");
  }
  if (records.some((record) => !record.fingerprint || !record.keygrip)) {
    fail("release keyring fingerprint or keygrip inventory is incomplete");
  }
  const privateDirectory = join(home, "private-keys-v1.d");
  const privateEntries = readdirSync(privateDirectory).sort();
  const expectedPrivateEntry = `${availableSecrets[0].keygrip}.key`;
  if (privateEntries.length !== 1 || privateEntries[0] !== expectedPrivateEntry) {
    fail("release keyring private material inventory must contain only the pinned signing subkey keygrip");
  }

  const probeDirectory = mkdtempSync(join(tmpdir(), "codex-review-gate-signing-probe-"));
  try {
    const messagePath = join(probeDirectory, "message.txt");
    const signaturePath = join(probeDirectory, "message.txt.asc");
    writeFileSync(messagePath, "codex-review-gate release signing preflight v1\n", {
      flag: "wx",
      mode: 0o600,
    });
    execFileSync("gpg", [
      "--batch",
      "--yes",
      "--homedir", home,
      "--armor",
      "--detach-sign",
      "--local-user", `${expectedSigning}!`,
      "--output", signaturePath,
      messagePath,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    const verifyStatus = execFileSync("gpg", [
      "--batch",
      "--homedir", home,
      "--status-fd=1",
      "--verify", signaturePath,
      messagePath,
    ], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    parseVerifiedOpenPgpStatus(
      { status: 0, stdout: verifyStatus },
      "release signing probe",
      {
        primaryFingerprint: expectedPrimary,
        signingFingerprint: expectedSigning,
      },
    );
  } finally {
    rmSync(probeDirectory, { recursive: true, force: true });
  }
  return true;
}

function validatePlanAgainstSource({ repo, sourceRef, controlRef, plan }) {
  const contract = releaseContractFor(plan, HISTORICAL_PLAN_CONTRACTS, "release plan");
  validatePlan(plan, contract);
  const sourceCommit = git(repo, ["rev-parse", "--verify", `${sourceRef}^{commit}`]);
  const controlCommit = git(repo, ["rev-parse", "--verify", `${controlRef}^{commit}`]);
  const pushAdmission = expectedPushAdmission(
    repo,
    plan.push_admission.before_commit,
    sourceCommit,
    contract,
  );
  const expected = expectedReleasePlan({ repo, sourceCommit, controlCommit, pushAdmission, contract });
  if (!sameCanonicalValue(plan, expected)) {
    fail("release plan differs from the exact frozen manifest, source, or publisher controls");
  }
  return { sourceCommit, controlCommit, expected };
}

function assertLiveSourceClosure(
  repo,
  sourceCommit,
  controlCommit,
  liveMasterCommit,
  contract = CURRENT_RELEASE_CONTRACT,
) {
  const sourceRange = requireLinearRange(repo, sourceCommit, liveMasterCommit);
  const controlRange = requireLinearRange(repo, controlCommit, liveMasterCommit);
  // A post-plan control change always invalidates the approval, even when the
  // same live range also contains a later release intent. Supersession may
  // authorize completion of a proved partial prefix; control drift may not.
  for (const commit of controlRange) {
    const parent = git(repo, ["show", "-s", "--format=%P", commit]);
    const forbidden = changedPaths(repo, parent, commit)
      .filter((path) => isPublisherControlPath(path, contract));
    if (forbidden.length > 0) {
      fail(`recovery_code=publisher-control-drift; live source master changed publisher controls during approval: ${forbidden.join(", ")}`);
    }
  }
  for (const commit of sourceRange) {
    const parent = git(repo, ["show", "-s", "--format=%P", commit]);
    const changed = changedPaths(repo, parent, commit);
    if (changed.includes("release-manifest.json")) {
      fail("recovery_code=release-intent-superseded; a later release intent replaced the frozen source");
    }
  }
}

function validateCandidatePayload(payload, plan, contract = CURRENT_RELEASE_CONTRACT) {
  if (!hasExactKeys(payload, ["tree", "inventory_sha256", "files"]) || payload.tree !== plan.source_tree) {
    fail("release candidate payload does not bind the planned source tree");
  }
  validatePayloadInventory(payload.files, contract);
  if (payload.inventory_sha256 !== nulDelimitedInventoryDigest(payload.files, contract)) {
    fail("release candidate NUL-delimited inventory digest differs from its file records");
  }
  return payload;
}

export function buildCandidate({ repo, sourceRef, controlRef, planPath, outputDir }) {
  const rawPlan = readJson(planPath);
  const contract = releaseContractFor(rawPlan, HISTORICAL_PLAN_CONTRACTS, "release plan");
  const plan = validatePlan(rawPlan, contract);
  const effectiveControlRef = controlRef ?? plan.control_commit;
  const { sourceCommit } = validatePlanAgainstSource({
    repo,
    sourceRef,
    controlRef: effectiveControlRef,
    plan,
  });
  const sourceTree = git(repo, ["rev-parse", `${sourceCommit}:${contract.source_path}`]);
  if (sourceCommit !== plan.source_commit || sourceTree !== plan.source_tree) {
    fail("candidate source differs from the immutable release plan");
  }
  if (existsSync(outputDir)) fail("candidate output directory already exists");
  mkdirSync(outputDir, { recursive: false, mode: 0o700 });
  const archiveName = `codex-review-gate-action-${plan.immutable_tag}.tar.gz`;
  const archiveRootName = `codex-review-gate-action-${plan.immutable_tag}`;
  const archivePath = join(outputDir, archiveName);
  if (contract.archive_encoder !== "canonical-ustar-gzip-store-v1") {
    fail(`release contract ${contract.id} has no frozen archive encoder`);
  }
  const payloadTree = readPayloadTree(repo, sourceCommit, contract);
  const payloadFiles = payloadTree.inventory;
  const archiveFiles = payloadTree.entries.map((entry) => ({
    path: entry.path,
    mode: entry.mode,
    bytes: gitBytes(repo, ["cat-file", "blob", entry.objectId]),
  }));
  const compressed = encodeCanonicalReleaseArchive(
    archiveFiles,
    archiveRootName,
    contract.archive_encoder,
  );
  writeFileSync(archivePath, compressed, { flag: "wx", mode: 0o600 });
  const archivedPayloadFiles = readArchivePayloadInventory(archivePath, archiveRootName);
  if (!sameCanonicalValue(archivedPayloadFiles, payloadFiles)) {
    fail("release archive payload differs from the exact frozen Git-tree inventory");
  }
  const candidate = {
    schema: contract.candidate.schema,
    schema_version: contract.candidate.schema_version,
    plan,
    payload: {
      tree: sourceTree,
      inventory_sha256: nulDelimitedInventoryDigest(payloadFiles, contract),
      files: payloadFiles,
    },
    archive: {
      name: archiveName,
      sha256: sha256File(archivePath),
      size: readFileSync(archivePath).byteLength,
    },
  };
  writeFileSync(join(outputDir, "candidate.json"), canonicalJson(candidate), { flag: "wx", mode: 0o600 });
  return candidate;
}

export function verifyCandidate(candidateDir) {
  const entries = readdirSync(candidateDir, { withFileTypes: true })
    .sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
  if (entries.length !== 2 || !entries.some((entry) => entry.name === "candidate.json")) {
    fail("release candidate directory must contain candidate.json and exactly one archive");
  }
  for (const entry of entries) {
    if (!entry.isFile() || !lstatSync(join(candidateDir, entry.name)).isFile()) {
      fail(`release candidate entry must be a regular file: ${entry.name}`);
    }
  }
  const candidate = readJson(join(candidateDir, "candidate.json"));
  const contract = releaseContractFor(candidate, HISTORICAL_CANDIDATE_CONTRACTS, "release candidate");
  if (!hasExactKeys(candidate, ["schema", "schema_version", "plan", "payload", "archive"])) {
    fail("release candidate field set differs from policy");
  }
  validatePlan(candidate.plan, contract);
  validateCandidatePayload(candidate.payload, candidate.plan, contract);
  if (!hasExactKeys(candidate.archive, ["name", "sha256", "size"])) {
    fail("release candidate archive record differs from policy");
  }
  if (basename(candidate.archive?.name ?? "") !== candidate.archive?.name) fail("invalid candidate archive name");
  const archivePath = join(candidateDir, candidate.archive.name);
  if (candidate.archive.name !== `codex-review-gate-action-${candidate.plan.immutable_tag}.tar.gz`) {
    fail("candidate archive name differs from release policy");
  }
  if (sha256File(archivePath) !== candidate.archive.sha256) fail("candidate archive digest mismatch");
  if (readFileSync(archivePath).byteLength !== candidate.archive.size) fail("candidate archive size mismatch");
  const expectedNames = ["candidate.json", candidate.archive.name]
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  if (!sameCanonicalValue(entries.map((entry) => entry.name), expectedNames)) {
    fail("release candidate directory contains an unexpected entry");
  }
  return candidate;
}

export function validateCandidateAgainstSource({
  candidateDir,
  repo,
  sourceRef,
  controlRef,
}) {
  const candidate = verifyCandidate(candidateDir);
  const { sourceCommit, controlCommit } = validatePlanAgainstSource({
    repo,
    sourceRef,
    controlRef,
    plan: candidate.plan,
  });
  const scratch = mkdtempSync(join(tmpdir(), "codex-review-gate-publication-preflight-"));
  try {
    const planPath = join(scratch, "release-plan.json");
    writeFileSync(planPath, canonicalJson(candidate.plan), { flag: "wx", mode: 0o600 });
    const expectedDir = join(scratch, "candidate");
    const expected = buildCandidate({
      repo,
      sourceRef: sourceCommit,
      controlRef: controlCommit,
      planPath,
      outputDir: expectedDir,
    });
    if (
      !sameCanonicalValue(candidate, expected) ||
      !readFileSync(join(candidateDir, candidate.archive.name)).equals(
        readFileSync(join(expectedDir, expected.archive.name)),
      )
    ) {
      fail("release candidate is not the deterministic output of the exact frozen source and controls");
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return { sourceCommit, controlCommit };
}

export function validatePublicationInput({
  candidateDir,
  repo,
  sourceRef,
  controlRef,
  liveMasterRef,
}) {
  const candidate = verifyCandidate(candidateDir);
  const contract = releaseContractFor(candidate, HISTORICAL_CANDIDATE_CONTRACTS, "release candidate");
  const { sourceCommit, controlCommit } = validateCandidateAgainstSource({
    candidateDir,
    repo,
    sourceRef,
    controlRef,
  });
  const liveMasterCommit = git(repo, ["rev-parse", "--verify", `${liveMasterRef}^{commit}`]);
  try {
    assertLiveSourceClosure(repo, sourceCommit, controlCommit, liveMasterCommit, contract);
    return { write_eligible: true, recovery_code: null, reason: null };
  } catch (error) {
    if (!/recovery_code=(?:publisher-control-drift|release-intent-superseded|source-not-current-master-ancestor|nonlinear-release-control-range|incomplete-release-control-range)/u.test(error.message)) {
      throw error;
    }
    const recoveryCode = /recovery_code=([^;]+)/u.exec(error.message)?.[1] ?? "publisher-control-drift";
    return {
      write_eligible: false,
      recovery_code: recoveryCode,
      reason: error.message,
    };
  }
}

function expectedPublicationPlan({
  candidateDir,
  repo,
  sourceRef,
  controlRef,
  liveMasterRef,
}) {
  const candidate = verifyCandidate(candidateDir);
  const contract = releaseContractFor(candidate, HISTORICAL_CANDIDATE_CONTRACTS, "release candidate");
  const { sourceCommit, controlCommit } = validateCandidateAgainstSource({
    candidateDir,
    repo,
    sourceRef,
    controlRef,
  });
  const liveMasterCommit = git(repo, ["rev-parse", "--verify", `${liveMasterRef}^{commit}`]);
  const admission = validatePublicationInput({
    candidateDir,
    repo,
    sourceRef: sourceCommit,
    controlRef: controlCommit,
    liveMasterRef: liveMasterCommit,
  });
  return {
    schema: contract.publication_plan.schema,
    schema_version: contract.publication_plan.schema_version,
    source_commit: sourceCommit,
    control_commit: controlCommit,
    live_source_master: liveMasterCommit,
    version: candidate.plan.version,
    immutable_tag: candidate.plan.immutable_tag,
    candidate: {
      candidate_json_sha256: sha256File(join(candidateDir, "candidate.json")),
      archive_name: candidate.archive.name,
      archive_sha256: candidate.archive.sha256,
      archive_size: candidate.archive.size,
      source_tree: candidate.plan.source_tree,
      manifest_sha256: candidate.plan.manifest_sha256,
    },
    write_eligible: admission.write_eligible,
    recovery_code: admission.recovery_code,
    reason: admission.reason,
  };
}

export function createPublicationPlan(options) {
  return expectedPublicationPlan(options);
}

export function validatePublicationPlan({ publicationPlanPath, ...options }) {
  const actual = readJson(publicationPlanPath);
  const expected = expectedPublicationPlan(options);
  if (!sameCanonicalValue(actual, expected)) {
    fail("publication plan differs from the exact candidate, frozen source, controls, or live source master");
  }
  return expected;
}

function parseGitObject(bytes, label) {
  const separator = bytes.indexOf(Buffer.from("\n\n"));
  if (separator < 0) fail(`${label} has no header/message separator`);
  let headerText;
  let message;
  try {
    headerText = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, separator));
    message = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(separator + 2));
  } catch {
    fail(`${label} is not canonical UTF-8`);
  }
  const fields = Object.create(null);
  let active = null;
  for (const line of headerText.split("\n")) {
    if (line.startsWith(" ")) {
      if (active !== "gpgsig") fail(`${label} has an invalid continued header`);
      continue;
    }
    const split = line.indexOf(" ");
    if (split <= 0 || split === line.length - 1) fail(`${label} has a malformed header`);
    active = line.slice(0, split);
    (fields[active] ??= []).push(line.slice(split + 1));
  }
  return { fields, message };
}

function exactOne(fields, name, label) {
  if (fields[name]?.length !== 1) fail(`${label} must contain exactly one ${name} header`);
  return fields[name][0];
}

function requireExactObjectHeaders(fields, required, optional, label) {
  const requiredNames = new Set(required);
  const allowedNames = new Set([...required, ...optional]);
  const actual = Object.keys(fields);
  if (
    actual.some((name) => !allowedNames.has(name)) ||
    [...requiredNames].some((name) => fields[name] === undefined)
  ) {
    fail(`${label} headers differ from the closed release-object policy`);
  }
  for (const name of actual) {
    if (fields[name].length !== 1) {
      fail(`${label} contains duplicate ${name} headers`);
    }
  }
}

function validateReleaseIdentity(value, label, contract = CURRENT_RELEASE_CONTRACT) {
  const expectedPrefix = `${contract.signer.name} <${contract.signer.email}> `;
  if (!value.startsWith(expectedPrefix) || !/^[0-9]+ [+-][0-9]{4}$/u.test(value.slice(expectedPrefix.length))) {
    fail(`${label} identity differs from release policy`);
  }
}

function hasExactTagMessage(message, expected) {
  if (message === expected) return true;
  if (!message.startsWith(expected)) return false;
  const signature = message.slice(expected.length);
  return (
    signature.startsWith("-----BEGIN PGP SIGNATURE-----\n") &&
    signature.endsWith("-----END PGP SIGNATURE-----\n") &&
    !signature.includes("\r") &&
    [...signature].every((character) => character === "\n" || (character >= " " && character <= "~")) &&
    signature.indexOf("-----BEGIN PGP SIGNATURE-----") === signature.lastIndexOf("-----BEGIN PGP SIGNATURE-----") &&
    signature.indexOf("-----END PGP SIGNATURE-----") === signature.lastIndexOf("-----END PGP SIGNATURE-----")
  );
}

export function validateTargetReleaseObjects({
  targetRepo,
  plan,
  releaseCommit,
  fullTagObject,
}) {
  const contract = releaseContractFor(plan, HISTORICAL_PLAN_CONTRACTS, "release plan");
  validatePlan(plan, contract);
  if (!targetRepo) fail("target repository is required for published object verification");
  const releaseSubject = `Release codex-review-gate-action ${plan.immutable_tag}`;
  const expectedCommitMessage = `${releaseSubject}\n\nSource: ${contract.source_repository}@${plan.source_commit}\nManifest-SHA256: ${plan.manifest_sha256}\n`;
  const expectedTagMessage = `${releaseSubject}\n`;
  if (
    git(targetRepo, ["cat-file", "-t", releaseCommit]) !== "commit" ||
    git(targetRepo, ["cat-file", "-t", fullTagObject]) !== "tag" ||
    git(targetRepo, ["rev-parse", `refs/tags/${plan.immutable_tag}`]) !== fullTagObject
  ) {
    fail("published immutable tag does not identify the exact annotated tag object");
  }

  const commitObject = parseGitObject(
    gitBytes(targetRepo, ["cat-file", "commit", releaseCommit]),
    "published release commit",
  );
  requireExactObjectHeaders(
    commitObject.fields,
    ["tree", "parent", "author", "committer"],
    ["gpgsig"],
    "published release commit",
  );
  const wrapperParent = exactOne(
    commitObject.fields,
    "parent",
    "published release commit",
  );
  if (
    exactOne(commitObject.fields, "tree", "published release commit") !== plan.source_tree ||
    wrapperParent !== plan.target_master_before ||
    commitObject.message !== expectedCommitMessage
  ) {
    fail("published release commit tree, sole parent, or exact source/manifest message differs from provenance");
  }
  validateReleaseIdentity(
    exactOne(commitObject.fields, "author", "published release commit"),
    "published release commit author",
    contract,
  );
  validateReleaseIdentity(
    exactOne(commitObject.fields, "committer", "published release commit"),
    "published release commit committer",
    contract,
  );
  let previousCommit;
  try {
    previousCommit = git(targetRepo, [
      "rev-parse",
      "--verify",
      `refs/tags/v${plan.previous_version}^{}`,
    ]);
    if (git(targetRepo, ["cat-file", "-t", previousCommit]) !== "commit") {
      fail("published release previous_version tag does not fully peel to a commit");
    }
  } catch {
    fail("published release previous_version tag is missing or does not fully peel to a commit");
  }
  if (previousCommit !== wrapperParent) {
    fail("published release previous_version tag does not identify the wrapper sole parent");
  }

  const tagObject = parseGitObject(
    gitBytes(targetRepo, ["cat-file", "tag", fullTagObject]),
    "published immutable tag",
  );
  requireExactObjectHeaders(
    tagObject.fields,
    ["object", "type", "tag", "tagger"],
    [],
    "published immutable tag",
  );
  if (
    exactOne(tagObject.fields, "object", "published immutable tag") !== releaseCommit ||
    exactOne(tagObject.fields, "type", "published immutable tag") !== "commit" ||
    exactOne(tagObject.fields, "tag", "published immutable tag") !== plan.immutable_tag ||
    !hasExactTagMessage(tagObject.message, expectedTagMessage)
  ) {
    fail("published immutable tag object fields or exact message differ from provenance");
  }
  validateReleaseIdentity(
    exactOne(tagObject.fields, "tagger", "published immutable tag"),
    "published immutable tagger",
    contract,
  );
  return true;
}

export function verifyPublishedAssets({
  assetDir,
  repo,
  targetRepo,
  sourceRef,
  releaseCommit,
  fullTagObject,
}) {
  if (!/^[0-9a-f]{40}$/u.test(releaseCommit) || !/^[0-9a-f]{40}$/u.test(fullTagObject)) {
    fail("published release commit and tag object must be full SHA-1 object IDs");
  }
  const sourceCommit = git(repo, ["rev-parse", "--verify", `${sourceRef}^{commit}`]);
  const manifestBytes = gitBytes(repo, ["show", `${sourceCommit}:release-manifest.json`]);
  const provenancePath = join(assetDir, "release-provenance.json");
  const provenanceSignaturePath = join(assetDir, "release-provenance.json.asc");
  const provenance = readJson(provenancePath);
  const contract = releaseContractFor(
    provenance,
    HISTORICAL_RELEASE_CONTRACTS,
    "published provenance",
  );
  const sourceTree = git(repo, ["rev-parse", `${sourceCommit}:${contract.source_path}`]);
  if (
    provenance.schema !== contract.provenance.schema ||
    provenance.schema_version !== contract.provenance.schema_version ||
    !hasExactKeys(provenance, [
      "schema",
      "schema_version",
      "plan",
      "payload",
      "manifest",
      "workflow",
      "target",
      "signatures",
      "alias_transition",
      "archive",
    ])
  ) {
    fail("unsupported published provenance schema");
  }
  const plan = validatePlan(provenance.plan, contract);
  validateCandidatePayload(provenance.payload, plan, contract);
  if (
    plan.source_commit !== sourceCommit ||
    plan.source_tree !== sourceTree ||
    plan.manifest_sha256 !== createHash("sha256").update(manifestBytes).digest("hex") ||
    provenance.manifest?.sha256 !== plan.manifest_sha256 ||
    provenance.manifest?.source_commit !== sourceCommit ||
    provenance.manifest?.version !== plan.version ||
    provenance.target?.repository !== contract.target_repository ||
    provenance.target?.branch !== contract.target_branch ||
    provenance.target?.parent !== plan.target_master_before ||
    provenance.target?.commit !== releaseCommit ||
    provenance.target?.tree !== sourceTree ||
    provenance.target?.immutable_tag !== plan.immutable_tag ||
    provenance.target?.immutable_tag_object !== fullTagObject
  ) {
    fail("published provenance differs from the exact source or release objects");
  }
  validateTargetReleaseObjects({ targetRepo, plan, releaseCommit, fullTagObject });
  if (
    provenance.workflow?.repository !== contract.source_repository ||
    provenance.workflow?.workflow_sha !== plan.control_commit ||
    provenance.workflow?.workflow_ref !== `${contract.source_repository}/.github/workflows/sync-action-subtree.yml@refs/heads/master` ||
    !/^[1-9][0-9]*$/u.test(provenance.workflow?.run_id ?? "") ||
    !Number.isSafeInteger(provenance.workflow?.run_attempt) ||
    provenance.workflow.run_attempt < 1
  ) {
    fail("published provenance workflow/run identity differs from policy");
  }
  const expectedSignature = (object) => ({
    object,
    primary_fingerprint: contract.signer.primary_fingerprint,
    signing_subkey_fingerprint: contract.signer.signing_subkey_fingerprint,
  });
  if (
    !sameCanonicalValue(provenance.signatures?.commit, expectedSignature(releaseCommit)) ||
    !sameCanonicalValue(provenance.signatures?.immutable_tag, expectedSignature(fullTagObject)) ||
    !sameCanonicalValue(provenance.signatures?.provenance, {
      path: "release-provenance.json",
      detached_signature: "release-provenance.json.asc",
      primary_fingerprint: contract.signer.primary_fingerprint,
      signing_subkey_fingerprint: contract.signer.signing_subkey_fingerprint,
    })
  ) {
    fail("published provenance signature bindings differ from policy");
  }
  const release = parseSemverForContract(plan.version, contract);
  if (release.majorAlias === null) {
    if (!sameCanonicalValue(provenance.alias_transition, {
      name: null,
      before: null,
      target_commit: null,
      target_version: null,
      mode: "not-applicable",
    }) || provenance.signatures.floating_alias !== null) {
      fail("prerelease provenance must not declare a floating alias transition");
    }
  } else if (
    provenance.alias_transition?.name !== release.majorAlias ||
    !(provenance.alias_transition.before === null || /^[0-9a-f]{40}$/u.test(provenance.alias_transition.before)) ||
    provenance.alias_transition.target_commit !== releaseCommit ||
    provenance.alias_transition.target_version !== plan.version ||
    !sameCanonicalValue(
      provenance.signatures.floating_alias,
      {
        required: true,
        primary_fingerprint: contract.signer.primary_fingerprint,
        signing_subkey_fingerprint: contract.signer.signing_subkey_fingerprint,
      },
    )
  ) {
    fail("stable provenance floating-alias transition differs from policy");
  }
  if (release.majorAlias !== null) {
    validateFloatingAliasMode(
      provenance.alias_transition.mode,
      provenance.alias_transition.before,
      contract,
    );
  }
  if (!existsSync(provenanceSignaturePath) || readFileSync(provenanceSignaturePath).byteLength === 0) {
    fail("published provenance detached signature is missing or empty");
  }

  const scratch = mkdtempSync(join(tmpdir(), "codex-review-gate-public-verify-"));
  try {
    const manifestPath = join(scratch, "release-manifest.json");
    writeFileSync(manifestPath, manifestBytes, { flag: "wx", mode: 0o600 });
    const manifest = validateReleaseManifest(readJson(manifestPath), contract);
    if (
      manifest.version !== plan.version ||
      manifest.target.expected_head !== plan.target_master_before ||
      manifest.target.previous_version !== plan.previous_version ||
      JSON.stringify(manifest.signer) !== JSON.stringify(plan.signer)
    ) {
      fail("published provenance differs from the source release manifest");
    }
    const actionPackage = JSON.parse(git(repo, ["show", `${sourceCommit}:${contract.source_path}/package.json`]));
    if (
      actionPackage.version !== manifest.version ||
      actionPackage.repository?.url !== contract.action_package_repository
    ) {
      fail("published action package metadata differs from the release manifest");
    }

    const planPath = join(scratch, "release-plan.json");
    writeFileSync(planPath, canonicalJson(plan), { flag: "wx", mode: 0o600 });
    const expectedDir = join(scratch, "expected-candidate");
    buildCandidate({
      repo,
      sourceRef: sourceCommit,
      controlRef: plan.control_commit,
      planPath,
      outputDir: expectedDir,
    });
    const expectedCandidate = readJson(join(expectedDir, "candidate.json"));
    if (!sameCanonicalValue(provenance.payload, expectedCandidate.payload)) {
      fail("published provenance payload inventory differs from the exact source tree");
    }
    const archiveName = `codex-review-gate-action-${plan.immutable_tag}.tar.gz`;
    const archivePath = join(assetDir, archiveName);
    if (
      provenance.archive?.name !== archiveName ||
      provenance.archive.sha256 !== sha256File(archivePath) ||
      provenance.archive.size !== readFileSync(archivePath).byteLength ||
      !readFileSync(archivePath).equals(readFileSync(join(expectedDir, archiveName)))
    ) {
      fail("published archive is not the deterministic archive of the exact source tree");
    }
    const expectedAssets = [archiveName, "release-provenance.json", "release-provenance.json.asc"]
      .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
    const actualAssets = readdirSync(assetDir).sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
    if (!sameCanonicalValue(actualAssets, expectedAssets)) fail("published release asset inventory differs from policy");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return true;
}

function optionalObjectId(value, label) {
  if (value === "none" || value === null || value === undefined || value === "") return null;
  if (!/^[0-9a-f]{40}$/u.test(value)) fail(`${label} must be none or a full SHA-1 object ID`);
  return value;
}

function validateFloatingAliasMode(mode, before, contract) {
  const policy = contract.floating_alias_modes[mode];
  if (
    policy === undefined ||
    !hasExactKeys(policy, ["requires_before"]) ||
    typeof policy.requires_before !== "boolean" ||
    (before !== null) !== policy.requires_before
  ) {
    fail("stable provenance alias transition mode/object relationship differs from policy");
  }
}

export function finalizeProvenance({
  candidateDir,
  releaseCommit,
  fullTagObject,
  releaseParent,
  aliasName,
  aliasBefore,
  aliasMode,
  workflowRef,
  workflowRunId,
  workflowRunAttempt,
  outputDir,
}) {
  const candidate = verifyCandidate(candidateDir);
  const contract = releaseContractFor(candidate, HISTORICAL_CANDIDATE_CONTRACTS, "release candidate");
  if (
    !/^[0-9a-f]{40}$/u.test(releaseCommit) ||
    !/^[0-9a-f]{40}$/u.test(fullTagObject) ||
    !/^[0-9a-f]{40}$/u.test(releaseParent)
  ) {
    fail("release parent, commit, and full tag object must be full SHA-1 object IDs");
  }
  const before = optionalObjectId(aliasBefore, "alias before object");
  const release = parseSemverForContract(candidate.plan.version, contract);
  const canonicalAliasName = aliasName === "none" || aliasName === "" ? null : aliasName;
  if (release.majorAlias === null) {
    if (canonicalAliasName !== null || before !== null || aliasMode !== "not-applicable") {
      fail("prerelease provenance cannot declare a floating alias transition");
    }
  } else if (
    canonicalAliasName !== release.majorAlias
  ) {
    fail("stable provenance requires the exact floating-major alias transition");
  }
  if (release.majorAlias !== null) validateFloatingAliasMode(aliasMode, before, contract);
  if (workflowRef !== `${contract.source_repository}/.github/workflows/sync-action-subtree.yml@refs/heads/master`) {
    fail("release provenance workflow_ref differs from policy");
  }
  if (!/^[1-9][0-9]*$/u.test(workflowRunId) || !/^[1-9][0-9]*$/u.test(workflowRunAttempt)) {
    fail("release provenance workflow run identity is invalid");
  }
  if (existsSync(outputDir)) fail("release provenance output directory already exists");
  mkdirSync(outputDir, { recursive: false, mode: 0o700 });
  const sourceArchive = join(candidateDir, candidate.archive.name);
  const outputArchive = join(outputDir, candidate.archive.name);
  copyFileSync(sourceArchive, outputArchive, constants.COPYFILE_EXCL);
  const signatureBinding = (object) => ({
    object,
    primary_fingerprint: contract.signer.primary_fingerprint,
    signing_subkey_fingerprint: contract.signer.signing_subkey_fingerprint,
  });
  const provenance = {
    schema: contract.provenance.schema,
    schema_version: contract.provenance.schema_version,
    plan: candidate.plan,
    payload: candidate.payload,
    manifest: {
      sha256: candidate.plan.manifest_sha256,
      source_commit: candidate.plan.source_commit,
      version: candidate.plan.version,
    },
    workflow: {
      repository: contract.source_repository,
      workflow_ref: workflowRef,
      workflow_sha: candidate.plan.control_commit,
      run_id: workflowRunId,
      run_attempt: Number(workflowRunAttempt),
    },
    target: {
      repository: contract.target_repository,
      branch: contract.target_branch,
      parent: releaseParent,
      commit: releaseCommit,
      tree: candidate.plan.source_tree,
      immutable_tag: candidate.plan.immutable_tag,
      immutable_tag_object: fullTagObject,
    },
    signatures: {
      commit: signatureBinding(releaseCommit),
      immutable_tag: signatureBinding(fullTagObject),
      floating_alias: canonicalAliasName === null ? null : {
        required: true,
        primary_fingerprint: contract.signer.primary_fingerprint,
        signing_subkey_fingerprint: contract.signer.signing_subkey_fingerprint,
      },
      provenance: {
        path: "release-provenance.json",
        detached_signature: "release-provenance.json.asc",
        primary_fingerprint: contract.signer.primary_fingerprint,
        signing_subkey_fingerprint: contract.signer.signing_subkey_fingerprint,
      },
    },
    alias_transition: {
      name: canonicalAliasName,
      before,
      target_commit: canonicalAliasName === null ? null : releaseCommit,
      target_version: canonicalAliasName === null ? null : candidate.plan.version,
      mode: aliasMode,
    },
    archive: candidate.archive,
  };
  const provenancePath = join(outputDir, "release-provenance.json");
  createOnly(provenancePath, canonicalJson(provenance));
  return { provenance, assets: [outputArchive, provenancePath] };
}

export function parseVerifiedOpenPgpStatus(result, expectedName, {
  primaryFingerprint = PRIMARY_FINGERPRINT,
  signingFingerprint = SIGNING_SUBKEY_FINGERPRINT,
} = {}) {
  if (result?.status !== 0) fail(`${expectedName} signature verification failed`);
  const expectedPrimary = primaryFingerprint.toUpperCase();
  const expectedSigning = signingFingerprint.toUpperCase();
  const lines = String(result.stdout ?? "").split("\n");
  const rejected = new Set([
    "BADARMOR",
    "BADSIG",
    "ERRSIG",
    "ERROR",
    "EXPKEYSIG",
    "EXPSIG",
    "FAILURE",
    "KEYEXPIRED",
    "KEYREVOKED",
    "NODATA",
    "NO_PUBKEY",
    "REVKEYSIG",
    "SIGEXPIRED",
  ]);
  for (const line of lines) {
    const status = line.match(/^\[GNUPG:\] ([A-Z_]+)/u)?.[1];
    if (status && rejected.has(status)) fail(`${expectedName} carries a rejected OpenPGP status: ${status}`);
  }
  const good = lines.filter((line) => line.startsWith("[GNUPG:] GOODSIG "));
  const valid = lines.filter((line) => line.startsWith("[GNUPG:] VALIDSIG "));
  if (good.length !== 1 || valid.length !== 1) {
    fail(`${expectedName} must have exactly one GOODSIG and one VALIDSIG OpenPGP status`);
  }
  const goodFields = good[0].split(/\s+/u);
  const fields = valid[0].split(/\s+/u);
  const primary = (fields.at(-1) ?? "").toUpperCase();
  const signing = (fields[2] ?? "").toUpperCase();
  const keyId = (goodFields[2] ?? "").toUpperCase();
  if (
    primary !== expectedPrimary ||
    signing !== expectedSigning ||
    keyId !== expectedSigning.slice(-16) ||
    fields[5] !== "0"
  ) {
    fail(`${expectedName} signature does not match release signer policy`);
  }
  return { primaryFingerprint: primary, signingFingerprint: signing };
}

export function discoverV2RuntimeModulePaths(tree) {
  return Object.keys(tree)
    .filter((path) => path.startsWith("src/v2/"))
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}

export async function writeManifest(output, manifest, { overwrite = false } = {}) {
  const absoluteOutput = resolve(output);
  mkdirSync(dirname(absoluteOutput), { recursive: true });
  const bytes = canonicalJson(manifest);
  writeFileSync(absoluteOutput, bytes, { flag: overwrite ? "w" : "wx", mode: 0o600 });
  return { absoluteOutput, digest: createHash("sha256").update(bytes).digest("hex") };
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index];
    const value = rest[index + 1];
    if (!name?.startsWith("--") || value === undefined) fail(`invalid argument: ${name ?? "<missing>"}`);
    options[name.slice(2)] = value;
  }
  return { command, options };
}

function required(options, name) {
  if (!options[name]) fail(`--${name} is required`);
  return options[name];
}

async function main(argv) {
  const { command, options } = parseArguments(argv);
  if (command === "plan") {
    const repo = resolve(required(options, "repo"));
    const sourceRef = required(options, "source-ref");
    const testOnlyImplicitAdmission =
      options["admission-before"] === undefined &&
      options["admission-plan"] === undefined &&
      process.env.CODEX_REVIEW_GATE_RELEASE_PROVENANCE_TEST_ONLY === "1" &&
      process.env.NODE_ENV === "test";
    const plan = createReleasePlan({
      repo,
      sourceRef,
      controlRef: required(options, "control-ref"),
      admissionBeforeRef: testOnlyImplicitAdmission ? `${sourceRef}^` : options["admission-before"],
      admissionPlanPath: options["admission-plan"] === undefined
        ? undefined
        : resolve(options["admission-plan"]),
    });
    writeFileSync(required(options, "output"), canonicalJson(plan), { flag: "wx", mode: 0o600 });
    return;
  }
  if (command === "candidate") {
    buildCandidate({
      repo: resolve(required(options, "repo")),
      sourceRef: required(options, "source-ref"),
      controlRef: required(options, "control-ref"),
      planPath: resolve(required(options, "plan")),
      outputDir: resolve(required(options, "output-dir")),
    });
    return;
  }
  if (command === "verify-candidate") {
    verifyCandidate(resolve(required(options, "candidate")));
    return;
  }
  if (command === "verify-candidate-source") {
    validateCandidateAgainstSource({
      repo: resolve(required(options, "repo")),
      sourceRef: required(options, "source-ref"),
      controlRef: required(options, "control-ref"),
      candidateDir: resolve(required(options, "candidate")),
    });
    return;
  }
  if (command === "extract-transport") {
    extractCandidateTransport({
      archivePath: resolve(required(options, "archive")),
      outputDir: resolve(required(options, "output-dir")),
    });
    return;
  }
  if (command === "publication-plan") {
    const plan = createPublicationPlan({
      repo: resolve(required(options, "repo")),
      sourceRef: required(options, "source-ref"),
      controlRef: required(options, "control-ref"),
      liveMasterRef: required(options, "live-master-ref"),
      candidateDir: resolve(required(options, "candidate")),
    });
    writeFileSync(required(options, "output"), canonicalJson(plan), { flag: "wx", mode: 0o600 });
    return;
  }
  if (command === "verify-publication-plan") {
    const plan = validatePublicationPlan({
      publicationPlanPath: resolve(required(options, "publication-plan")),
      repo: resolve(required(options, "repo")),
      sourceRef: required(options, "source-ref"),
      controlRef: required(options, "control-ref"),
      liveMasterRef: required(options, "live-master-ref"),
      candidateDir: resolve(required(options, "candidate")),
    });
    process.stdout.write(canonicalJson({
      write_eligible: plan.write_eligible,
      recovery_code: plan.recovery_code,
      reason: plan.reason,
    }));
    return;
  }
  if (command === "preflight-publication") {
    const status = validatePublicationInput({
      repo: resolve(required(options, "repo")),
      sourceRef: required(options, "source-ref"),
      controlRef: required(options, "control-ref"),
      liveMasterRef: required(options, "live-master-ref"),
      candidateDir: resolve(required(options, "candidate")),
    });
    process.stdout.write(canonicalJson(status));
    return;
  }
  if (command === "finalize") {
    finalizeProvenance({
      candidateDir: resolve(required(options, "candidate")),
      releaseCommit: required(options, "release-commit"),
      fullTagObject: required(options, "full-tag-object"),
      releaseParent: required(options, "release-parent"),
      aliasName: required(options, "alias-name"),
      aliasBefore: required(options, "alias-before"),
      aliasMode: required(options, "alias-mode"),
      workflowRef: required(options, "workflow-ref"),
      workflowRunId: required(options, "workflow-run-id"),
      workflowRunAttempt: required(options, "workflow-run-attempt"),
      outputDir: resolve(required(options, "output-dir")),
    });
    return;
  }
  if (command === "compare-semver") {
    process.stdout.write(`${compareSemver(required(options, "left"), required(options, "right"))}\n`);
    return;
  }
  if (command === "verify-rulesets") {
    validatePublisherRulesets(readJson(resolve(required(options, "input"))));
    return;
  }
  if (command === "snapshot-release-assets") {
    process.stdout.write(canonicalReleaseAssetSnapshot(readJson(resolve(required(options, "input")))));
    return;
  }
  if (command === "snapshot-release-inventory") {
    const pages = readJson(resolve(required(options, "input")));
    process.stdout.write(options.neutral === "true"
      ? canonicalNeutralReleaseInventorySnapshot(pages)
      : canonicalReleaseInventorySnapshot(pages));
    return;
  }
  if (command === "snapshot-release-boundary") {
    process.stdout.write(canonicalReleaseBoundarySnapshot(
      readJson(resolve(required(options, "input"))),
      {
        tag: required(options, "tag"),
        body: required(options, "body"),
        prerelease: required(options, "prerelease") === "true",
        draft: required(options, "draft") === "true",
        immutable: required(options, "immutable") === "true",
        allowStarterAssets: options["allow-starter"] === "true",
      },
    ));
    return;
  }
  if (command === "verify-signing-key") {
    validateSigningKeyHome({ gnupgHome: resolve(required(options, "gnupg-home")) });
    return;
  }
  if (command === "verify-github-signing-key") {
    const rawKey = validateGitHubSigningKeyInventory(
      readJson(resolve(required(options, "input"))),
    );
    createOnly(resolve(required(options, "output-public-key")), rawKey);
    return;
  }
  if (command === "verify-published-assets") {
    verifyPublishedAssets({
      assetDir: resolve(required(options, "asset-dir")),
      repo: resolve(required(options, "repo")),
      targetRepo: resolve(required(options, "target-repo")),
      sourceRef: required(options, "source-ref"),
      releaseCommit: required(options, "release-commit"),
      fullTagObject: required(options, "full-tag-object"),
    });
    return;
  }
  if (command === "verify-openpgp-status") {
    parseVerifiedOpenPgpStatus({
      status: 0,
      stdout: readFileSync(resolve(required(options, "input")), "utf8"),
    }, required(options, "name"));
    return;
  }
  if (command === "github-app-installation") {
    const privateKey = process.env.RELEASE_PUBLISHER_APP_PRIVATE_KEY;
    if (!privateKey) fail("RELEASE_PUBLISHER_APP_PRIVATE_KEY is required");
    const installation = await readGitHubAppInstallation({
      clientId: required(options, "client-id"),
      privateKey,
      installationId: required(options, "installation-id"),
    });
    createOnly(resolve(required(options, "output")), canonicalJson(installation));
    return;
  }
  fail("expected plan, candidate, verify-candidate, verify-candidate-source, extract-transport, publication-plan, verify-publication-plan, preflight-publication, finalize, compare-semver, verify-rulesets, snapshot-release-assets, snapshot-release-inventory, snapshot-release-boundary, verify-signing-key, verify-github-signing-key, verify-published-assets, verify-openpgp-status, or github-app-installation command");
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}
