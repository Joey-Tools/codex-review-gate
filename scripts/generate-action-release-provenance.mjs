#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  constants as fsConstants,
  realpathSync,
  statSync,
} from "node:fs";
import {
  link,
  lstat,
  mkdtemp,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RELEASE = "1.5.0";
const PROVENANCE_SCHEMA_VERSION = 2;
const PRODUCER_PROTOCOL_MAJOR = 1;
const RECEIPT_SCHEMA_VERSION = 1;
const DECISION_TABLE_SCHEMA_VERSION = 1;
const DECISION_POLICY_MAJOR = 1;
const DECISION_POLICY_VERSION = "1.4.0";
const SOURCE_REPOSITORY = "JoeyTeng/codex-review-gate";
const ACTION_REPOSITORY = "JoeyTeng/codex-review-gate-action";
const SOURCE_SUBTREE = "packages/action";
const REUSABLE_WORKFLOW_PATH = ".github/workflows/codex-review-gate.yml";
const REUSABLE_WORKFLOW_SELECTOR = "v1";
const REUSABLE_WORKFLOW_REF = "refs/tags/v1";
const REUSABLE_WORKFLOW_CHECKOUT_PATH = ".codex-review-gate-action";
const REUSABLE_WORKFLOW_LOCAL_ACTION_USE =
  `./${REUSABLE_WORKFLOW_CHECKOUT_PATH}`;
const REUSABLE_WORKFLOW_CANONICAL_REFERENCE =
  `${ACTION_REPOSITORY}/${REUSABLE_WORKFLOW_PATH}@${REUSABLE_WORKFLOW_SELECTOR}`;
const DEFAULT_STATUS_CONTEXT = "codex/review-gate";
const RECEIPT_SCHEMA_ID =
  "urn:joeyteng:codex-review-gate:producer-receipt:1";
const FROZEN_RECEIPT_SCHEMA_SHA256 =
  "89decfcabeeab817a975b1118498375c4eafe730b35e2cb9aa5c4abde6637b77";
const DECISION_TABLE_SCHEMA_ID =
  "urn:joeyteng:codex-review-gate:decision-table:1";
const FROZEN_ACTION_DEFINITION_SHA256 =
  "3b73835ec0e8dfb2305f0801ebaa7b3f9ea04e02c72392e822aabcd25d2093be";
const FROZEN_REUSABLE_WORKFLOW_SHA256 =
  "91720b868b972d947a65fa3cc408d8c866d83cf4d75032f6bfb597b014752bce";
const FROZEN_DECISION_TABLE_SHA256 =
  "3f0032df69e2015c1dfe198c20a141652b2dcaba520e8749a5d049d31ffd7ad3";
const PROVENANCE_SCHEMA_ID =
  "urn:joeyteng:codex-review-gate:release-provenance:2";
const CHECKOUT_SHA =
  "11d5960a326750d5838078e36cf38b85af677262";
const UPLOAD_ARTIFACT_SHA =
  "ea165f8d65b6e75b540449e92b4886f43607fa02";
const RUN_ATTEMPT_REQUIRED_EQUALITIES = Object.freeze([
  "id-equals-receipt-producer-run-id",
  "run_attempt-equals-receipt-producer-run-attempt",
  "repository-full_name-equals-receipt-producer-repository",
]);
const REFERENCED_WORKFLOW_REQUIRED_EQUALITIES = Object.freeze([
  `selected-path-equals-${REUSABLE_WORKFLOW_CANONICAL_REFERENCE}`,
  `selected-ref-equals-${REUSABLE_WORKFLOW_REF}`,
  "selected-sha-equals-receipt-producer-job-workflow_sha",
  "selected-sha-equals-validated-release-provenance-action-commit_oid",
  "selected-path-repository-and-file-equal-receipt-producer-job-workflow_repository-and-workflow_file_path",
]);
const CALLED_WORKFLOW_REQUIRED_EQUALITIES = Object.freeze([
  `receipt-producer-job-workflow_repository-equals-${ACTION_REPOSITORY}`,
  `receipt-producer-job-workflow_file_path-equals-${REUSABLE_WORKFLOW_PATH}`,
  `receipt-producer-job-workflow_ref-equals-${ACTION_REPOSITORY}/${REUSABLE_WORKFLOW_PATH}@${REUSABLE_WORKFLOW_REF}`,
  "receipt-producer-job-workflow_sha-is-lower-case-40-hex",
  "receipt-producer-job-workflow_sha-equals-validated-release-provenance-action-commit_oid",
  "receipt-producer-action-repository-equals-receipt-producer-job-workflow_repository",
  "receipt-producer-action-ref-equals-receipt-producer-job-workflow_sha",
  "receipt-producer-action-commit_sha-equals-receipt-producer-job-workflow_sha",
  "receipt-producer-action-immutable-is-true",
]);
const ARTIFACT_RUN_REQUIRED_EQUALITIES = Object.freeze([
  "artifact-api-workflow_run-id-equals-exact-run-attempt-id",
  "artifact-api-workflow_run-head_sha-equals-exact-run-attempt-head_sha",
]);
const STATUS_HEAD_REQUIRED_EQUALITIES = Object.freeze([
  "selected-receipt-status-head_sha-equals-current-pull-request-head_sha",
  "rest-status-list-request-ref-equals-current-pull-request-head_sha",
  "selected-graphql-status-context-commit-oid-equals-current-pull-request-head_sha",
  "selected-receipt-status-head_sha-equals-selected-graphql-status-context-commit-oid",
]);
const DISALLOWED_RUN_STATUS_HEAD_REQUIREMENTS = Object.freeze([
  "exact-run-attempt-head_sha-equals-selected-receipt-status-head_sha",
  "artifact-api-workflow_run-head_sha-equals-selected-receipt-status-head_sha",
  "exact-run-attempt-head_sha-equals-receipt-producer-environment-GITHUB_WORKFLOW_SHA",
  "receipt-producer-environment-GITHUB_WORKFLOW_SHA-equals-receipt-producer-job-workflow_sha",
]);
const POSITIVE_CONSUMER_REQUIREMENT = Object.freeze({
  operator: "all-of",
  execution: Object.freeze({
    result: "completed",
  }),
  selected_status: Object.freeze({
    membership: "unique-rest-record-and-receipt-status-member",
    rest_record_state: "success",
    receipt_member_state: "success",
  }),
});
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_SMALL_OBJECT_BYTES = 16 * 1024 * 1024;
const MAX_TREE_ENTRIES = 100_000;
const GIT_TIMEOUT_MS = 60_000;
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;
const SAFE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const PLACEHOLDER_PATTERN = /<[^<>]+>/;

const EXPECTED_TAGS = Object.freeze({
  immutable: "v1.5.0",
  minor: "v1.5",
  major: "v1",
});

const EXPECTED_DECISION_ROW_IDS = Object.freeze([
  "clean-current",
  "clean-ancestor",
  "clean-nonancestor",
  "clean-unknown-retryable",
  "clean-unknown-exhausted",
  "clean-binding-invalid",
  "finding-threadless-current",
  "finding-threadless-ancestor",
  "finding-threadless-nonancestor",
  "finding-threadless-unknown-retryable",
  "finding-threadless-unknown-exhausted",
  "finding-threadless-binding-invalid",
  "finding-thread-current-unresolved",
  "finding-thread-ancestor-unresolved",
  "finding-thread-current-resolved",
  "finding-thread-ancestor-resolved",
  "finding-thread-nonancestor",
  "finding-thread-unknown-retryable",
  "finding-thread-unknown-exhausted",
  "finding-thread-binding-invalid",
  "progress-current-scope",
  "malformed-deterministic",
  "transient-incomplete-retryable",
  "transient-incomplete-exhausted",
  "plus-one",
  "eyes",
  "nonancestor-only",
  "final-reread-instability",
  "overall-max-wait-expired",
]);

function usage() {
  return `Usage: node scripts/generate-action-release-provenance.mjs \\
  --source-repo <path> --source-repository ${SOURCE_REPOSITORY} \\
  --source-commit <40-sha> --source-default-ref refs/heads/master \\
  --action-repo <path> --action-repository ${ACTION_REPOSITORY} \\
  --action-commit <40-sha> --action-default-ref refs/heads/master \\
  --immutable-tag-ref refs/tags/v1.5.0 \\
  --minor-tag-ref refs/tags/v1.5 --major-tag-ref refs/tags/v1 \\
  --output <path>

The source and action commits must be the exact tips of the supplied default
refs. Production generation verifies all three annotated tag signatures.
Hermetic tests may additionally pass --test-only-skip-signature-verification,
but only with both test guard environment variables and repositories beneath
the operating-system temporary directory.`;
}

function parseArguments(argv) {
  const valueOptions = new Set([
    "--source-repo",
    "--source-repository",
    "--source-commit",
    "--source-default-ref",
    "--action-repo",
    "--action-repository",
    "--action-commit",
    "--action-default-ref",
    "--immutable-tag-ref",
    "--minor-tag-ref",
    "--major-tag-ref",
    "--output",
  ]);
  const options = {};
  let testOnlySkipSignatureVerification = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      return { help: true };
    }
    if (argument === "--test-only-skip-signature-verification") {
      if (testOnlySkipSignatureVerification) {
        throw new Error(`${argument} may be supplied only once`);
      }
      testOnlySkipSignatureVerification = true;
      continue;
    }
    if (!valueOptions.has(argument)) {
      throw new Error(`unknown argument: ${argument}`);
    }
    if (Object.hasOwn(options, argument)) {
      throw new Error(`${argument} may be supplied only once`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value`);
    }
    options[argument] = value;
    index += 1;
  }

  for (const option of valueOptions) {
    if (!Object.hasOwn(options, option)) {
      throw new Error(`missing required argument: ${option}`);
    }
  }
  if (
    testOnlySkipSignatureVerification &&
    (
      process.env.NODE_ENV !== "test" ||
      process.env.CODEX_REVIEW_GATE_RELEASE_PROVENANCE_TEST_ONLY !== "1"
    )
  ) {
    throw new Error(
      "--test-only-skip-signature-verification requires both explicit test guards",
    );
  }

  return {
    sourceRepo: options["--source-repo"],
    sourceRepository: options["--source-repository"],
    sourceCommit: options["--source-commit"],
    sourceDefaultRef: options["--source-default-ref"],
    actionRepo: options["--action-repo"],
    actionRepository: options["--action-repository"],
    actionCommit: options["--action-commit"],
    actionDefaultRef: options["--action-default-ref"],
    immutableTagRef: options["--immutable-tag-ref"],
    minorTagRef: options["--minor-tag-ref"],
    majorTagRef: options["--major-tag-ref"],
    output: options["--output"],
    testOnlySkipSignatureVerification,
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function boundedText(buffer, limit = 2_000) {
  const decoded = Buffer.isBuffer(buffer)
    ? buffer.toString("utf8")
    : String(buffer || "");
  return decoded.slice(0, limit).trim();
}

function gitEnvironment() {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (name.startsWith("GIT_")) {
      delete environment[name];
    }
  }
  return {
    ...environment,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
  };
}

function git(repo, args, { maxBuffer = MAX_GIT_OUTPUT_BYTES, allowFailure = false } = {}) {
  const result = spawnSync("git", ["--no-pager", "-C", repo, ...args], {
    encoding: null,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer,
    env: gitEnvironment(),
  });
  if (result.error) {
    throw new Error(`git ${args[0]} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0 && !allowFailure) {
    const detail = boundedText(result.stderr) || `exit ${result.status}`;
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
  return result;
}

function gitText(repo, args) {
  return git(repo, args, { maxBuffer: MAX_SMALL_OBJECT_BYTES }).stdout
    .toString("utf8")
    .trim();
}

let trustedGpgExecutable = null;

function resolveTrustedGpgExecutable() {
  if (trustedGpgExecutable) {
    return trustedGpgExecutable;
  }
  const path = process.env.PATH;
  if (!path) {
    throw new Error("PATH is empty; cannot resolve the trusted OpenPGP verifier");
  }
  for (const directory of path.split(delimiter)) {
    if (!directory || !isAbsolute(directory)) {
      continue;
    }
    const candidate = resolve(directory, "gpg");
    try {
      accessSync(candidate, fsConstants.X_OK);
      const resolved = realpathSync(candidate);
      if (!statSync(resolved).isFile()) {
        continue;
      }
      const probe = spawnSync(resolved, ["--version"], {
        encoding: "utf8",
        env: gitEnvironment(),
        timeout: 10_000,
        maxBuffer: 1 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (
        !probe.error &&
        probe.status === 0 &&
        /^gpg \(GnuPG\) [0-9]+\./.test(probe.stdout || "")
      ) {
        trustedGpgExecutable = resolved;
        return trustedGpgExecutable;
      }
    } catch {
      // Continue to the next absolute PATH entry.
    }
  }
  throw new Error("could not resolve an executable GnuPG OpenPGP verifier");
}

function assertExactSha(value, label) {
  if (!FULL_SHA_PATTERN.test(value)) {
    throw new Error(`${label} must be an exact lower-case 40-SHA`);
  }
}

function assertSafeRef(value, label) {
  if (
    !SAFE_REF_PATTERN.test(value) ||
    value.includes("..") ||
    value.includes("@{") ||
    value.includes("//") ||
    value.endsWith("/") ||
    PLACEHOLDER_PATTERN.test(value)
  ) {
    throw new Error(`${label} is not a safe explicit Git ref`);
  }
}

function assertExpectedTagRef(value, expected, label) {
  assertSafeRef(value, label);
  if (value !== `refs/tags/${expected}`) {
    throw new Error(`${label} must be the fully qualified refs/tags/${expected}`);
  }
}

function assertDefaultBranchRef(value, label) {
  assertSafeRef(value, label);
  if (value !== "refs/heads/master") {
    throw new Error(`${label} must be the proven canonical refs/heads/master`);
  }
}

function resolveExactCommit(repo, commit, label) {
  assertExactSha(commit, label);
  const resolved = gitText(repo, ["rev-parse", "--verify", `${commit}^{commit}`]);
  if (resolved !== commit) {
    throw new Error(`${label} did not resolve exactly to ${commit}`);
  }
  return resolved;
}

function resolveRefCommit(repo, ref, label) {
  assertSafeRef(ref, label);
  const resolved = gitText(repo, ["rev-parse", "--verify", `${ref}^{commit}`]);
  assertExactSha(resolved, `${label} resolved commit`);
  return resolved;
}

function resolveRefObject(repo, ref, label) {
  assertSafeRef(ref, label);
  const resolved = gitText(repo, ["rev-parse", "--verify", ref]);
  assertExactSha(resolved, `${label} resolved object`);
  return resolved;
}

function resolveTree(repo, revision, label) {
  const tree = gitText(repo, ["rev-parse", "--verify", `${revision}^{tree}`]);
  assertExactSha(tree, label);
  return tree;
}

function decodeUtf8(bytes, label) {
  try {
    const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!Buffer.from(value, "utf8").equals(bytes)) {
      throw new Error("UTF-8 round trip changed the bytes");
    }
    return value;
  } catch (error) {
    throw new Error(`${label} is not canonical UTF-8: ${error.message}`);
  }
}

function assertJsonHasNoDuplicateKeys(text, label) {
  let offset = 0;

  function fail(message) {
    throw new Error(`${label} ${message} at byte ${offset}`);
  }

  function skipWhitespace() {
    while (/[\t\n\r ]/.test(text[offset] || "")) {
      offset += 1;
    }
  }

  function parseString() {
    if (text[offset] !== '"') {
      fail("expected a JSON string");
    }
    const start = offset;
    offset += 1;
    while (offset < text.length) {
      const character = text[offset];
      if (character === '"') {
        offset += 1;
        return JSON.parse(text.slice(start, offset));
      }
      if (character === "\\") {
        offset += 1;
        const escape = text[offset];
        if (escape === "u") {
          const codePoint = text.slice(offset + 1, offset + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(codePoint)) {
            fail("contains an invalid Unicode escape");
          }
          offset += 5;
          continue;
        }
        if (!'"\\/bfnrt'.includes(escape || "")) {
          fail("contains an invalid escape");
        }
        offset += 1;
        continue;
      }
      if (character.charCodeAt(0) < 0x20) {
        fail("contains an unescaped control character");
      }
      offset += 1;
    }
    fail("contains an unterminated string");
  }

  function parseValue() {
    skipWhitespace();
    if (text[offset] === "{") {
      parseObject();
      return;
    }
    if (text[offset] === "[") {
      parseArray();
      return;
    }
    if (text[offset] === '"') {
      parseString();
      return;
    }
    const primitive = /^(?:-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null)/
      .exec(text.slice(offset));
    if (!primitive) {
      fail("contains an invalid value");
    }
    offset += primitive[0].length;
  }

  function parseArray() {
    offset += 1;
    skipWhitespace();
    if (text[offset] === "]") {
      offset += 1;
      return;
    }
    while (true) {
      parseValue();
      skipWhitespace();
      if (text[offset] === "]") {
        offset += 1;
        return;
      }
      if (text[offset] !== ",") {
        fail("expected an array comma or closing bracket");
      }
      offset += 1;
    }
  }

  function parseObject() {
    offset += 1;
    const keys = new Set();
    skipWhitespace();
    if (text[offset] === "}") {
      offset += 1;
      return;
    }
    while (true) {
      skipWhitespace();
      const key = parseString();
      if (keys.has(key)) {
        fail(`contains duplicate object key ${JSON.stringify(key)}`);
      }
      keys.add(key);
      skipWhitespace();
      if (text[offset] !== ":") {
        fail("expected an object colon");
      }
      offset += 1;
      parseValue();
      skipWhitespace();
      if (text[offset] === "}") {
        offset += 1;
        return;
      }
      if (text[offset] !== ",") {
        fail("expected an object comma or closing brace");
      }
      offset += 1;
    }
  }

  parseValue();
  skipWhitespace();
  if (offset !== text.length) {
    fail("contains trailing content");
  }
}

function parseLsTree(raw) {
  if (raw.length > 0 && raw[raw.length - 1] !== 0) {
    throw new Error("git ls-tree -r -z output is missing its final NUL byte");
  }
  const entries = [];
  let start = 0;
  const paths = new Set();
  while (start < raw.length) {
    const end = raw.indexOf(0, start);
    if (end < 0) {
      throw new Error("git ls-tree -r -z output contains an unterminated record");
    }
    const record = raw.subarray(start, end);
    const tab = record.indexOf(9);
    if (tab < 0) {
      throw new Error("git ls-tree record is missing its path separator");
    }
    const header = record.subarray(0, tab).toString("ascii");
    const match = /^(\d{6}) (blob|commit) ([0-9a-f]{40})$/.exec(header);
    if (!match) {
      throw new Error(`unsupported git ls-tree record header: ${header}`);
    }
    const [, mode, type, objectOid] = match;
    if (type !== "blob") {
      throw new Error(
        `published action tree contains unsupported non-blob leaf ${objectOid}`,
      );
    }
    const path = decodeUtf8(record.subarray(tab + 1), "published action path");
    if (!path || path.startsWith("/") || path.includes("\0")) {
      throw new Error("published action path is empty or absolute");
    }
    if (PLACEHOLDER_PATTERN.test(path)) {
      throw new Error(`published action path contains a placeholder: ${path}`);
    }
    if (paths.has(path)) {
      throw new Error(`published action tree repeats path: ${path}`);
    }
    paths.add(path);
    entries.push({ path, mode, type, blob_oid: objectOid });
    if (entries.length > MAX_TREE_ENTRIES) {
      throw new Error(`published action tree exceeds ${MAX_TREE_ENTRIES} entries`);
    }
    start = end + 1;
  }
  return entries;
}

function parseJson(raw, label) {
  try {
    const text = decodeUtf8(raw, label);
    assertJsonHasNoDuplicateKeys(text, label);
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function assertNoPlaceholders(value, path = "manifest") {
  if (typeof value === "string") {
    if (PLACEHOLDER_PATTERN.test(value)) {
      throw new Error(`${path} contains an unresolved placeholder`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoPlaceholders(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (PLACEHOLDER_PATTERN.test(key)) {
        throw new Error(`${path} contains an unresolved placeholder key`);
      }
      assertNoPlaceholders(entry, `${path}.${key}`);
    }
  }
}

function findEntry(entries, path) {
  const matches = entries.filter((entry) => entry.path === path);
  if (matches.length !== 1) {
    throw new Error(`published action tree must contain exactly one ${path}`);
  }
  return matches[0];
}

function readBlob(repo, oid, label) {
  const result = git(repo, ["cat-file", "blob", oid], {
    maxBuffer: MAX_SMALL_OBJECT_BYTES,
  });
  if (result.stdout.length >= MAX_SMALL_OBJECT_BYTES) {
    throw new Error(`${label} exceeds the ${MAX_SMALL_OBJECT_BYTES}-byte bound`);
  }
  return result.stdout;
}

function readTagObject(repo, oid, label) {
  const result = git(repo, ["cat-file", "tag", oid], {
    maxBuffer: MAX_SMALL_OBJECT_BYTES,
  });
  if (result.stdout.length >= MAX_SMALL_OBJECT_BYTES) {
    throw new Error(`${label} exceeds the ${MAX_SMALL_OBJECT_BYTES}-byte bound`);
  }
  return result.stdout;
}

function extractStatusContext(actionDefinition) {
  const lines = actionDefinition.split("\n");
  const inputKeys = lines.filter((line) => line === "inputs:");
  const contextKeys = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line === "  status-context:");
  if (inputKeys.length !== 1 || contextKeys.length !== 1) {
    throw new Error(
      "action.yml must contain exactly one inputs block and one inputs.status-context key",
    );
  }
  const start = contextKeys[0].index;
  const defaults = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [^ ]/.test(lines[index])) {
      break;
    }
    const match = /^    default: "([^"]+)"$/.exec(lines[index]);
    if (match) {
      defaults.push(match[1]);
    }
  }
  if (defaults.length !== 1) {
    throw new Error(
      "action.yml status-context must contain exactly one exact quoted default",
    );
  }
  return defaults[0];
}

function extractUploaderSha(actionDefinition) {
  const matches = [...actionDefinition.matchAll(
    /^\s*uses: actions\/upload-artifact@([0-9a-f]{40})(?:\s+#.*)?$/gm,
  )];
  if (matches.length !== 1) {
    throw new Error("action.yml must contain exactly one full-SHA upload-artifact step");
  }
  return matches[0][1];
}

function validateRuntimeExternalActionClosure(runtimeFiles) {
  const externalActions = [];
  const localActions = [];
  for (const runtimeFile of runtimeFiles) {
    const text = decodeUtf8(runtimeFile.raw, runtimeFile.release_path);
    for (const line of text.split(/\r?\n/)) {
      if (
        /(?:^|[\s:[{,])(?:&|\*)[A-Za-z0-9_-]+/.test(line) ||
        /(?:^|\s)<<\s*:/.test(line)
      ) {
        throw new Error(
          `${runtimeFile.release_path} contains a forbidden YAML anchor, alias, or merge key`,
        );
      }
      if (/^\s*\?/.test(line)) {
        throw new Error(
          `${runtimeFile.release_path} contains a forbidden complex YAML mapping key`,
        );
      }
      if (
        /(?:^|[,{]|-\s+)\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*')\s*:/.test(
          line,
        )
      ) {
        throw new Error(
          `${runtimeFile.release_path} contains a forbidden quoted YAML mapping key`,
        );
      }
      const canonicalUsesKey = /^\s*(?:-\s*)?uses\s*:/.test(line);
      const anyBareUsesKey = /(?:^|[,{]|-\s+)\s*uses\s*:/.test(line);
      if (anyBareUsesKey && !canonicalUsesKey) {
        throw new Error(
          `${runtimeFile.release_path} contains a non-canonical runtime uses mapping`,
        );
      }
      if (!canonicalUsesKey) {
        continue;
      }
      const match = /^\s*(?:-\s*)?uses:\s*([^\s#]+)(?:\s+#.*)?$/.exec(line);
      if (!match) {
        throw new Error(
          `${runtimeFile.release_path} contains a malformed runtime uses declaration`,
        );
      }
      const uses = match[1];
      if (uses.startsWith("./")) {
        localActions.push({
          release_path: runtimeFile.release_path,
          source_path: runtimeFile.source_path,
          uses,
        });
        continue;
      }
      const externalMatch = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([0-9a-f]{40})$/.exec(
        uses,
      );
      if (!externalMatch) {
        throw new Error(
          `${runtimeFile.release_path} contains a floating or unsupported external runtime uses: ${uses}`,
        );
      }
      externalActions.push({
        release_path: runtimeFile.release_path,
        source_path: runtimeFile.source_path,
        uses,
        repository: externalMatch[1],
        commit_sha: externalMatch[2],
      });
    }
  }

  const expected = [
    {
      release_path: REUSABLE_WORKFLOW_PATH,
      source_path: `${SOURCE_SUBTREE}/${REUSABLE_WORKFLOW_PATH}`,
      uses: `actions/checkout@${CHECKOUT_SHA}`,
      repository: "actions/checkout",
      commit_sha: CHECKOUT_SHA,
    },
    {
      release_path: "action.yml",
      source_path: `${SOURCE_SUBTREE}/action.yml`,
      uses: `actions/upload-artifact@${UPLOAD_ARTIFACT_SHA}`,
      repository: "actions/upload-artifact",
      commit_sha: UPLOAD_ARTIFACT_SHA,
    },
  ];
  if (!exactJsonEqual(externalActions, expected)) {
    throw new Error(
      "published runtime external actions do not equal the closed release closure",
    );
  }
  const expectedLocalActions = [
    {
      release_path: REUSABLE_WORKFLOW_PATH,
      source_path: `${SOURCE_SUBTREE}/${REUSABLE_WORKFLOW_PATH}`,
      uses: REUSABLE_WORKFLOW_LOCAL_ACTION_USE,
    },
  ];
  if (!exactJsonEqual(localActions, expectedLocalActions)) {
    throw new Error(
      "published runtime local action use does not equal the closed release binding",
    );
  }
  return { externalActions, localActions };
}

function validateReusableWorkflowCheckoutBindings(reusableWorkflow) {
  const lines = decodeUtf8(
    reusableWorkflow.raw,
    reusableWorkflow.release_path,
  ).split(/\r?\n/);
  const checkoutUse = `uses: actions/checkout@${CHECKOUT_SHA}`;
  const checkoutIndexes = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim().replace(/\s+#.*$/, "") === checkoutUse) {
      checkoutIndexes.push(index);
    }
  }
  if (checkoutIndexes.length !== 1) {
    throw new Error(
      "reusable workflow must contain exactly one exact source checkout step",
    );
  }
  const checkoutIndex = checkoutIndexes[0];
  const indentation = /^\s*/.exec(lines[checkoutIndex])[0].length;
  const expectedFollowingLines = [
    { indentation, text: "with:" },
    {
      indentation: indentation + 2,
      text: "repository: ${{ job.workflow_repository }}",
    },
    {
      indentation: indentation + 2,
      text: "ref: ${{ job.workflow_sha }}",
    },
    {
      indentation: indentation + 2,
      text: `path: ${REUSABLE_WORKFLOW_CHECKOUT_PATH}`,
    },
    { indentation: indentation + 2, text: "persist-credentials: false" },
  ];
  for (let offset = 0; offset < expectedFollowingLines.length; offset += 1) {
    const actualLine = lines[checkoutIndex + offset + 1];
    const expectedLine = expectedFollowingLines[offset];
    if (
      actualLine === undefined ||
      /^\s*/.exec(actualLine)[0].length !== expectedLine.indentation ||
      actualLine.trim() !== expectedLine.text
    ) {
      throw new Error(
        "reusable workflow source checkout bindings contradict the closed release contract",
      );
    }
  }
  return {
    uses: `actions/checkout@${CHECKOUT_SHA}`,
    repository: "${{ job.workflow_repository }}",
    ref: "${{ job.workflow_sha }}",
    path: REUSABLE_WORKFLOW_CHECKOUT_PATH,
    persist_credentials: false,
  };
}

function decisionRow(table, id) {
  const rows = table.evidence_rows.filter((row) => row?.id === id);
  if (rows.length !== 1) {
    throw new Error(`decision table must contain exactly one ${id} row`);
  }
  return rows[0];
}

function assertRow(table, id, expected) {
  const row = decisionRow(table, id);
  for (const [key, value] of Object.entries(expected)) {
    if (row[key] !== value) {
      throw new Error(`decision table row ${id}.${key} contradicts release policy`);
    }
  }
}

function exactJsonEqual(actual, expected) {
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((value, index) => exactJsonEqual(actual[index], value))
    );
  }
  if (expected !== null && typeof expected === "object") {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) {
      return false;
    }
    const actualKeys = Object.keys(actual).sort();
    const expectedKeys = Object.keys(expected).sort();
    return (
      JSON.stringify(actualKeys) === JSON.stringify(expectedKeys) &&
      expectedKeys.every((key) => exactJsonEqual(actual[key], expected[key]))
    );
  }
  return actual === expected;
}

function validateDecisionTable(table) {
  if (
    table?.schema !== DECISION_TABLE_SCHEMA_ID ||
    table?.schema_version !== DECISION_TABLE_SCHEMA_VERSION ||
    table?.policy_major !== DECISION_POLICY_MAJOR ||
    table?.policy_version !== DECISION_POLICY_VERSION
  ) {
    throw new Error("decision table identity contradicts compatibility policy 1.4.0");
  }
  if (!Array.isArray(table.evidence_rows)) {
    throw new Error("decision table is missing evidence_rows");
  }
  const actualIds = table.evidence_rows.map((row) => row?.id);
  if (
    actualIds.length !== EXPECTED_DECISION_ROW_IDS.length ||
    new Set(actualIds).size !== actualIds.length ||
    EXPECTED_DECISION_ROW_IDS.some((id) => !actualIds.includes(id))
  ) {
    throw new Error("decision table row set is not the closed release-1.4 set");
  }
  assertRow(table, "clean-current", {
    relation: "current",
    reducer_effect: "select-success-candidate",
    controlling_state: "success-after-final-stability",
  });
  assertRow(table, "clean-ancestor", {
    relation: "ancestor",
    reducer_effect: "audit-stale",
    controlling_state: "pending",
  });
  assertRow(table, "clean-nonancestor", {
    relation: "nonancestor",
    reducer_effect: "audit-ignore-and-reduce-remaining",
    controlling_state: "none",
  });
  assertRow(table, "finding-thread-current-unresolved", {
    reducer_effect: "blocking",
    controlling_state: "failure",
  });
  assertRow(table, "malformed-deterministic", {
    reducer_effect: "deterministic-evidence-error-no-review-post",
    controlling_state: "error",
  });
  assertRow(table, "transient-incomplete-retryable", {
    reducer_effect: "bounded-acquisition-or-reconciliation-retry-no-review-post",
    controlling_state: "pending",
  });
  assertRow(table, "transient-incomplete-exhausted", {
    reducer_effect: "evidence-error-no-review-post",
    controlling_state: "error",
  });
  assertRow(table, "final-reread-instability", {
    reducer_effect: "refuse-success-and-fail-closed",
    controlling_state: "error",
  });
  assertRow(table, "plus-one", {
    reducer_effect: "audit-only",
    controlling_state: "none",
  });
  if (
    !table.pass_scope?.includes("does not attest triple-review completion") ||
    table.orchestration?.initial_ack_seconds !== 300 ||
    table.orchestration?.ack_retry_cap_seconds !== 1800 ||
    table.orchestration?.result_deadline_seconds !== 3600 ||
    table.orchestration?.overall_max_wait_seconds !== 7200 ||
    !table.orchestration?.eyes_effect?.includes("without resetting or extending") ||
    !table.orchestration?.plus_one_effect?.startsWith("No pass") ||
    !table.final_success_stability?.must_confirm?.includes(
      "no applicable unresolved finding remains",
    )
  ) {
    throw new Error("decision table timers or final reread contradict release policy");
  }
  const precedence = table.status_precedence?.map((entry) => entry.state);
  if (JSON.stringify(precedence) !== JSON.stringify(["failure", "error", "success", "pending"])) {
    throw new Error("decision table outcome precedence contradicts fail-closed policy");
  }
  if (
    table.producer_receipt_boundary?.status_context !== DEFAULT_STATUS_CONTEXT ||
    table.producer_receipt_boundary?.status_create_api !==
      "POST /repos/{owner}/{repo}/statuses/{sha}" ||
    table.producer_receipt_boundary?.status_list_api !==
      "GET /repos/{owner}/{repo}/commits/{ref}/statuses" ||
    table.producer_receipt_boundary?.status_get_by_id_api !== null ||
    table.producer_receipt_boundary?.run_attempt_api !==
      "GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}" ||
    table.producer_receipt_boundary?.artifact_inventory_api !==
      "GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts" ||
    table.producer_receipt_boundary?.producer_protocol_major !==
      PRODUCER_PROTOCOL_MAJOR ||
    table.producer_receipt_boundary?.canonical_reusable_workflow_reference !==
      REUSABLE_WORKFLOW_CANONICAL_REFERENCE ||
    table.producer_receipt_boundary?.caller_selector !==
      REUSABLE_WORKFLOW_SELECTOR
  ) {
    throw new Error("decision table status or receipt contract contradicts release policy");
  }
  const positiveConsumerRequirement =
    table.producer_receipt_boundary?.positive_consumer_requirement;
  if (!exactJsonEqual(positiveConsumerRequirement, POSITIVE_CONSUMER_REQUIREMENT)) {
    throw new Error(
      "decision table positive consumer contract contradicts release policy",
    );
  }
  if (
    table.producer_receipt_boundary?.run_attempt_identity?.head_role !==
      "caller-workflow-event-commit" ||
    !exactJsonEqual(
      table.producer_receipt_boundary?.run_attempt_identity?.required_equalities,
      RUN_ATTEMPT_REQUIRED_EQUALITIES,
    ) ||
    !exactJsonEqual(
      table.producer_receipt_boundary?.artifact_run_association
        ?.required_equalities,
      ARTIFACT_RUN_REQUIRED_EQUALITIES,
    ) ||
    table.producer_receipt_boundary?.status_head_identity?.head_role !==
      "current-pull-request-head" ||
    !exactJsonEqual(
      table.producer_receipt_boundary?.status_head_identity?.required_equalities,
      STATUS_HEAD_REQUIRED_EQUALITIES,
    ) ||
    table.producer_receipt_boundary?.head_domain_separation
      ?.workflow_run_head_may_differ_from_status_and_pull_request_head !== true ||
    !exactJsonEqual(
      table.producer_receipt_boundary?.head_domain_separation
        ?.consumer_must_not_require,
      DISALLOWED_RUN_STATUS_HEAD_REQUIREMENTS,
    )
  ) {
    throw new Error(
      "decision table workflow-run and pull-request head binding contract contradicts release policy",
    );
  }
  if (
    !exactJsonEqual(
      table.producer_receipt_boundary?.run_attempt_identity
        ?.referenced_workflows,
      {
        field: "referenced_workflows",
        availability:
          "optional-nullable-upstream-but-required-non-null-for-this-reusable-workflow-contract",
        selection: "exactly-one-exact-called-workflow-member",
        expected_path: REUSABLE_WORKFLOW_CANONICAL_REFERENCE,
        expected_ref: REUSABLE_WORKFLOW_REF,
        required_equalities: [...REFERENCED_WORKFLOW_REQUIRED_EQUALITIES],
        rerun_resolution:
          "Validate referenced_workflows from the exact receipt run attempt; never substitute the current v1 target or evidence from another attempt.",
        tag_drift:
          "A later v1 move does not change the exact called-workflow SHA recorded for an earlier run attempt.",
        authority:
          "run-level-attempt-corroboration-only-no-job-callsite-or-receipt-cryptographic-binding",
      },
    )
  ) {
    throw new Error(
      "decision table exact-attempt referenced workflow contract contradicts release policy",
    );
  }
  if (
    !exactJsonEqual(
      table.producer_receipt_boundary?.called_workflow_authority,
      {
        availability: "github.com-only-job-context",
        repository: ACTION_REPOSITORY,
        workflow_file_path: REUSABLE_WORKFLOW_PATH,
        caller_selector: REUSABLE_WORKFLOW_SELECTOR,
        caller_ref: REUSABLE_WORKFLOW_REF,
        caller_identity_role:
          "producer.environment.GITHUB_WORKFLOW_REF/SHA-identifies-caller-workflow-file",
        called_job_identity_role:
          "producer.job.workflow_ref/SHA/repository/file_path-identifies-workflow-file-defining-current-job",
        required_equalities: [...CALLED_WORKFLOW_REQUIRED_EQUALITIES],
        caller_called_sha_domain_separation:
          "GITHUB_WORKFLOW_SHA identifies the caller workflow file and must not be required to equal producer.job.workflow_sha for a reusable invocation.",
      },
    )
  ) {
    throw new Error(
      "decision table called workflow authority contradicts release policy",
    );
  }
  if (
    !table.finding_closure?.strictly_later?.includes("validated updated_at") ||
    !table.finding_closure?.strictly_later?.includes(
      "issue-comment IDs never break that tie",
    ) ||
    !table.finding_closure?.strictly_later?.includes(
      "larger canonical numeric ID breaks an equal-time tie only within that review channel",
    )
  ) {
    throw new Error("decision table strict-later contract contradicts revision semantics");
  }
  assertNoPlaceholders(table, "decision_table");
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
    const value = line.slice(separator + 1);
    if (headers.has(key)) {
      throw new Error(`${expectedName} tag object repeats header ${key}`);
    }
    headers.set(key, value);
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
  const statusLines = statusText
    .split(/\r?\n/)
    .filter((line) => line.startsWith("[GNUPG:] "));
  const records = statusLines.map((line) => {
    const match = /^\[GNUPG:\] ([A-Z_]+)(?: (.*))?$/.exec(line);
    if (!match) {
      throw new Error(`${expectedName} emitted a malformed GnuPG status line`);
    }
    return { type: match[1], payload: match[2] || "" };
  });
  const rejectedTypes = new Set([
    "BADSIG",
    "ERRSIG",
    "EXPKEYSIG",
    "EXPSIG",
    "NO_PUBKEY",
    "REVKEYSIG",
  ]);
  if (records.some(({ type }) => rejectedTypes.has(type))) {
    throw new Error(`${expectedName} emitted a rejecting GnuPG signature status`);
  }
  const goodSignatures = records.filter(({ type }) => type === "GOODSIG");
  const validSignatures = records.filter(({ type }) => type === "VALIDSIG");
  if (goodSignatures.length !== 1 || validSignatures.length !== 1) {
    throw new Error(
      `${expectedName} must emit exactly one GOODSIG and one VALIDSIG status`,
    );
  }
  const keyId = goodSignatures[0].payload.split(" ", 1)[0].toUpperCase();
  const validSignatureFields = validSignatures[0].payload
    .trim()
    .split(/\s+/);
  const signingKeyFingerprint = validSignatureFields[0]?.toUpperCase();
  const primaryKeyFingerprint = validSignatureFields[9]?.toUpperCase();
  const keyIdOrFingerprintPattern = /^(?:[0-9A-F]{16}|[0-9A-F]{40}|[0-9A-F]{64})$/;
  const fingerprintPattern = /^(?:[0-9A-F]{40}|[0-9A-F]{64})$/;
  const goodSignatureIdentityMatches =
    keyId.length === 16
      ? signingKeyFingerprint?.endsWith(keyId)
      : signingKeyFingerprint === keyId;
  if (
    !keyIdOrFingerprintPattern.test(keyId) ||
    validSignatureFields.length !== 10 ||
    !fingerprintPattern.test(signingKeyFingerprint) ||
    !fingerprintPattern.test(primaryKeyFingerprint) ||
    !goodSignatureIdentityMatches
  ) {
    throw new Error(`${expectedName} emitted inconsistent GOODSIG/VALIDSIG identity`);
  }
  return {
    signingKeyFingerprint: signingKeyFingerprint.toLowerCase(),
    primaryKeyFingerprint: primaryKeyFingerprint.toLowerCase(),
  };
}

function verifyTag(
  repo,
  ref,
  expectedName,
  actionCommit,
  testOnlySkipSignatureVerification,
) {
  assertExpectedTagRef(ref, expectedName, `${expectedName} tag ref`);
  const refObjectOid = resolveRefObject(repo, ref, `${expectedName} tag ref`);
  const tagObjectOid = gitText(repo, ["rev-parse", "--verify", `${ref}^{tag}`]);
  assertExactSha(tagObjectOid, `${expectedName} tag object`);
  if (refObjectOid !== tagObjectOid) {
    throw new Error(`${expectedName} tag ref does not point directly to its tag object`);
  }
  const tagObjectType = gitText(repo, ["cat-file", "-t", tagObjectOid]);
  if (tagObjectType !== "tag") {
    throw new Error(`${expectedName} must resolve to an annotated tag object`);
  }
  parseDirectTagHeader(
    readTagObject(repo, tagObjectOid, `${expectedName} tag object`),
    expectedName,
    actionCommit,
  );
  const peeledCommitOid = resolveRefCommit(repo, ref, `${expectedName} tag`);
  if (peeledCommitOid !== actionCommit) {
    throw new Error(
      `${expectedName} peels to ${peeledCommitOid}, expected ${actionCommit}`,
    );
  }

  let signature;
  if (testOnlySkipSignatureVerification) {
    signature = {
      verified: false,
      method: "test-only-skip",
      signing_key_fingerprint: null,
      primary_key_fingerprint: null,
    };
  } else {
    const gpgExecutable = resolveTrustedGpgExecutable();
    const verification = git(repo, [
      "-c",
      "gpg.format=openpgp",
      "-c",
      `gpg.program=${gpgExecutable}`,
      "-c",
      `gpg.openpgp.program=${gpgExecutable}`,
      "verify-tag",
      "--raw",
      tagObjectOid,
    ], {
      maxBuffer: MAX_SMALL_OBJECT_BYTES,
      allowFailure: true,
    });
    if (verification.status !== 0) {
      const detail = boundedText(verification.stderr) || `exit ${verification.status}`;
      throw new Error(`${expectedName} signature verification failed: ${detail}`);
    }
    const fingerprints = parseVerifiedOpenPgpStatus(
      verification,
      expectedName,
    );
    signature = {
      verified: true,
      method: "git-verify-tag-openpgp-raw",
      signing_key_fingerprint: fingerprints.signingKeyFingerprint,
      primary_key_fingerprint: fingerprints.primaryKeyFingerprint,
    };
  }

  return {
    ref,
    annotated: true,
    tag_object_oid: tagObjectOid,
    peeled_commit_oid: peeledCommitOid,
    signature,
  };
}

async function canonicalRepoPath(path, label) {
  try {
    return await realpath(resolve(path));
  } catch (error) {
    throw new Error(`${label} is not an accessible repository path: ${error.message}`);
  }
}

async function assertTestOnlyRepositories(sourceRepo, actionRepo) {
  const temporaryRoot = await realpath(tmpdir());
  for (const [label, path] of [
    ["source repo", sourceRepo],
    ["action repo", actionRepo],
  ]) {
    const child = relative(temporaryRoot, path);
    if (!child || child.startsWith("..") || isAbsolute(child)) {
      throw new Error(
        `test-only signature skip requires ${label} beneath ${temporaryRoot}`,
      );
    }
  }
}

function criticalFile(repo, entries, path) {
  const entry = findEntry(entries, path);
  const raw = readBlob(repo, entry.blob_oid, path);
  return {
    release_path: path,
    source_path: `${SOURCE_SUBTREE}/${path}`,
    blob_oid: entry.blob_oid,
    raw_sha256: sha256(raw),
    raw,
  };
}

function committedFile(repo, commit, path, label) {
  const blobOid = gitText(repo, [
    "rev-parse",
    "--verify",
    `${commit}:${path}`,
  ]);
  assertExactSha(blobOid, `${label} blob`);
  if (gitText(repo, ["cat-file", "-t", blobOid]) !== "blob") {
    throw new Error(`${label} must resolve to a blob`);
  }
  const raw = readBlob(repo, blobOid, label);
  return {
    path,
    blob_oid: blobOid,
    raw_sha256: sha256(raw),
    raw,
  };
}

async function generateProvenance(options) {
  if (options.sourceRepository !== SOURCE_REPOSITORY) {
    throw new Error(`source repository must be ${SOURCE_REPOSITORY}`);
  }
  if (options.actionRepository !== ACTION_REPOSITORY) {
    throw new Error(`action repository must be ${ACTION_REPOSITORY}`);
  }
  const sourceRepo = await canonicalRepoPath(options.sourceRepo, "source repo");
  const actionRepo = await canonicalRepoPath(options.actionRepo, "action repo");
  assertDefaultBranchRef(options.sourceDefaultRef, "source default ref");
  assertDefaultBranchRef(options.actionDefaultRef, "action default ref");
  if (options.testOnlySkipSignatureVerification) {
    await assertTestOnlyRepositories(sourceRepo, actionRepo);
  }

  const sourceCommit = resolveExactCommit(
    sourceRepo,
    options.sourceCommit,
    "source commit",
  );
  const actionCommit = resolveExactCommit(
    actionRepo,
    options.actionCommit,
    "action commit",
  );
  const sourceDefaultCommit = resolveRefCommit(
    sourceRepo,
    options.sourceDefaultRef,
    "source default ref",
  );
  const actionDefaultCommit = resolveRefCommit(
    actionRepo,
    options.actionDefaultRef,
    "action default ref",
  );
  if (sourceDefaultCommit !== sourceCommit) {
    throw new Error("source commit is not the exact supplied default-ref tip");
  }
  if (actionDefaultCommit !== actionCommit) {
    throw new Error("action commit is not the exact supplied default-ref tip");
  }
  if (
    resolveRefObject(sourceRepo, options.sourceDefaultRef, "source default ref") !==
      sourceCommit ||
    resolveRefObject(actionRepo, options.actionDefaultRef, "action default ref") !==
      actionCommit
  ) {
    throw new Error("a default branch ref does not point directly to its release commit");
  }

  const sourceTree = resolveTree(sourceRepo, sourceCommit, "source commit tree");
  const sourceActionTree = gitText(sourceRepo, [
    "rev-parse",
    "--verify",
    `${sourceCommit}:${SOURCE_SUBTREE}`,
  ]);
  assertExactSha(sourceActionTree, "source packages/action tree");
  const sourceActionType = gitText(sourceRepo, ["cat-file", "-t", sourceActionTree]);
  if (sourceActionType !== "tree") {
    throw new Error(`${SOURCE_SUBTREE} does not resolve to a tree`);
  }
  const actionTree = resolveTree(actionRepo, actionCommit, "action commit tree");
  if (sourceActionTree !== actionTree) {
    throw new Error(
      `source ${SOURCE_SUBTREE} tree ${sourceActionTree} does not equal ` +
        `action root tree ${actionTree}`,
    );
  }

  const tags = {
    [EXPECTED_TAGS.immutable]: verifyTag(
      actionRepo,
      options.immutableTagRef,
      EXPECTED_TAGS.immutable,
      actionCommit,
      options.testOnlySkipSignatureVerification,
    ),
    [EXPECTED_TAGS.minor]: verifyTag(
      actionRepo,
      options.minorTagRef,
      EXPECTED_TAGS.minor,
      actionCommit,
      options.testOnlySkipSignatureVerification,
    ),
    v1: verifyTag(
      actionRepo,
      options.majorTagRef,
      EXPECTED_TAGS.major,
      actionCommit,
      options.testOnlySkipSignatureVerification,
    ),
  };
  const lsTreeArguments = ["ls-tree", "-r", "-z", "--full-tree", actionCommit];
  const rawLsTree = git(actionRepo, lsTreeArguments).stdout;
  const entries = parseLsTree(rawLsTree);
  if (entries.length === 0) {
    throw new Error("published action tree is empty");
  }

  const actionDefinition = criticalFile(actionRepo, entries, "action.yml");
  const reusableWorkflow = criticalFile(
    actionRepo,
    entries,
    REUSABLE_WORKFLOW_PATH,
  );
  const receiptSchema = criticalFile(
    actionRepo,
    entries,
    "producer-receipt.schema.json",
  );
  const decisionTable = criticalFile(actionRepo, entries, "decision-table.json");
  const actionPackage = criticalFile(actionRepo, entries, "package.json");
  if (actionDefinition.raw_sha256 !== FROZEN_ACTION_DEFINITION_SHA256) {
    throw new Error(
      "action.yml raw SHA-256 does not match the reviewed frozen runtime entrypoint",
    );
  }
  if (reusableWorkflow.raw_sha256 !== FROZEN_REUSABLE_WORKFLOW_SHA256) {
    throw new Error(
      "reusable workflow raw SHA-256 does not match the reviewed frozen runtime entrypoint",
    );
  }
  const sourcePackage = committedFile(
    sourceRepo,
    sourceCommit,
    "package.json",
    "source package.json",
  );

  const actionDefinitionText = decodeUtf8(
    actionDefinition.raw,
    "action.yml",
  );
  const statusContext = extractStatusContext(actionDefinitionText);
  const uploaderSha = extractUploaderSha(actionDefinitionText);
  const runtimeUses = validateRuntimeExternalActionClosure([
    reusableWorkflow,
    actionDefinition,
  ]);
  const sourceCheckoutBindings =
    validateReusableWorkflowCheckoutBindings(reusableWorkflow);
  if (statusContext !== DEFAULT_STATUS_CONTEXT) {
    throw new Error(`action.yml status context must be ${DEFAULT_STATUS_CONTEXT}`);
  }
  if (uploaderSha !== UPLOAD_ARTIFACT_SHA) {
    throw new Error(`action.yml uploader SHA must be ${UPLOAD_ARTIFACT_SHA}`);
  }

  const receiptSchemaJson = parseJson(
    receiptSchema.raw,
    "producer-receipt.schema.json",
  );
  if (
    receiptSchemaJson?.$id !== RECEIPT_SCHEMA_ID ||
    receiptSchemaJson?.properties?.schema?.const !== RECEIPT_SCHEMA_ID ||
    receiptSchemaJson?.properties?.schema_version?.const !==
      RECEIPT_SCHEMA_VERSION
  ) {
    throw new Error("producer receipt schema identity contradicts receipt v1");
  }
  if (receiptSchema.raw_sha256 !== FROZEN_RECEIPT_SCHEMA_SHA256) {
    throw new Error(
      "producer-receipt.schema.json raw SHA-256 does not match the reviewed frozen receipt v1 schema",
    );
  }
  const decisionTableJson = parseJson(decisionTable.raw, "decision-table.json");
  validateDecisionTable(decisionTableJson);
  if (decisionTable.raw_sha256 !== FROZEN_DECISION_TABLE_SHA256) {
    throw new Error(
      "decision-table.json raw SHA-256 does not match the reviewed frozen release policy",
    );
  }
  const actionPackageJson = parseJson(actionPackage.raw, "package.json");
  if (actionPackageJson?.version !== RELEASE) {
    throw new Error(`published action package version must be ${RELEASE}`);
  }
  const sourcePackageJson = parseJson(
    sourcePackage.raw,
    "source package.json",
  );
  if (sourcePackageJson?.version !== RELEASE) {
    throw new Error(`source package version must be ${RELEASE}`);
  }

  const manifest = {
    schema: PROVENANCE_SCHEMA_ID,
    schema_version: PROVENANCE_SCHEMA_VERSION,
    release: RELEASE,
    compatibility: {
      producer_protocol_major: PRODUCER_PROTOCOL_MAJOR,
      github_immutable_release_required: true,
      receipt_schema: {
        schema_id: RECEIPT_SCHEMA_ID,
        schema_version: RECEIPT_SCHEMA_VERSION,
      },
      decision_table: {
        schema_id: DECISION_TABLE_SCHEMA_ID,
        schema_version: DECISION_TABLE_SCHEMA_VERSION,
        policy_major: DECISION_POLICY_MAJOR,
        policy_version: DECISION_POLICY_VERSION,
      },
      called_workflow: {
        repository: ACTION_REPOSITORY,
        path: REUSABLE_WORKFLOW_PATH,
        caller_selector: REUSABLE_WORKFLOW_SELECTOR,
      },
    },
    source: {
      repository: SOURCE_REPOSITORY,
      default_ref: options.sourceDefaultRef,
      commit_oid: sourceCommit,
      tree_oid: sourceTree,
      action_subtree: {
        path: SOURCE_SUBTREE,
        tree_oid: sourceActionTree,
      },
      package: {
        path: sourcePackage.path,
        blob_oid: sourcePackage.blob_oid,
        raw_sha256: sourcePackage.raw_sha256,
        version: RELEASE,
      },
    },
    action: {
      repository: ACTION_REPOSITORY,
      default_ref: options.actionDefaultRef,
      commit_oid: actionCommit,
      tree_oid: actionTree,
      canonical_uses: `${ACTION_REPOSITORY}@${actionCommit}`,
    },
    runtime_closure: {
      called_workflow: {
        repository: ACTION_REPOSITORY,
        caller_selector: REUSABLE_WORKFLOW_SELECTOR,
        caller_reference: REUSABLE_WORKFLOW_CANONICAL_REFERENCE,
        immutable_reference:
          `${ACTION_REPOSITORY}/${REUSABLE_WORKFLOW_PATH}@${actionCommit}`,
        resolved_commit_oid: actionCommit,
        release_path: reusableWorkflow.release_path,
        source_path: reusableWorkflow.source_path,
        blob_oid: reusableWorkflow.blob_oid,
        raw_sha256: reusableWorkflow.raw_sha256,
      },
      source_checkout: sourceCheckoutBindings,
      local_action_use: runtimeUses.localActions[0],
      external_actions: runtimeUses.externalActions,
      external_action_set: "closed-exactly-two",
      floating_or_extra_external_uses_allowed: false,
    },
    tags,
    proofs: {
      source_subtree_equals_action_root: true,
      source_subtree_tree_oid: sourceActionTree,
      action_root_tree_oid: actionTree,
      all_tags_annotated: true,
      all_tags_peel_to_action_commit: true,
      all_tag_signatures_verified: !options.testOnlySkipSignatureVerification,
      production_signature_verification_required: true,
      revocation_freshness_checked: false,
      runtime_external_action_set_closed: true,
      release_asset_is_signed_attestation: false,
    },
    released_tree: {
      command: ["git", ...lsTreeArguments],
      raw_record_fields: ["mode", "type", "object_oid", "path"],
      raw_record_separators: ["SP", "SP", "TAB", "NUL"],
      raw_sha256: sha256(rawLsTree),
      entry_count: entries.length,
      entries,
    },
    critical_files: {
      action_package: {
        release_path: actionPackage.release_path,
        source_path: actionPackage.source_path,
        blob_oid: actionPackage.blob_oid,
        raw_sha256: actionPackage.raw_sha256,
        version: RELEASE,
      },
      action_definition: {
        release_path: actionDefinition.release_path,
        source_path: actionDefinition.source_path,
        blob_oid: actionDefinition.blob_oid,
        raw_sha256: actionDefinition.raw_sha256,
        frozen_admission_sha256: FROZEN_ACTION_DEFINITION_SHA256,
      },
      reusable_workflow: {
        release_path: reusableWorkflow.release_path,
        source_path: reusableWorkflow.source_path,
        blob_oid: reusableWorkflow.blob_oid,
        raw_sha256: reusableWorkflow.raw_sha256,
        frozen_admission_sha256: FROZEN_REUSABLE_WORKFLOW_SHA256,
        repository: ACTION_REPOSITORY,
        caller_selector: REUSABLE_WORKFLOW_SELECTOR,
        caller_reference: REUSABLE_WORKFLOW_CANONICAL_REFERENCE,
        immutable_reference:
          `${ACTION_REPOSITORY}/${REUSABLE_WORKFLOW_PATH}@${actionCommit}`,
      },
      producer_receipt_schema: {
        release_path: receiptSchema.release_path,
        source_path: receiptSchema.source_path,
        blob_oid: receiptSchema.blob_oid,
        raw_sha256: receiptSchema.raw_sha256,
        frozen_admission_sha256: FROZEN_RECEIPT_SCHEMA_SHA256,
        schema_id: RECEIPT_SCHEMA_ID,
        schema_version: RECEIPT_SCHEMA_VERSION,
      },
      decision_table: {
        release_path: decisionTable.release_path,
        source_path: decisionTable.source_path,
        blob_oid: decisionTable.blob_oid,
        raw_sha256: decisionTable.raw_sha256,
        frozen_admission_sha256: FROZEN_DECISION_TABLE_SHA256,
        immutable_url:
          `https://github.com/${ACTION_REPOSITORY}/blob/${actionCommit}/decision-table.json`,
        schema_id: DECISION_TABLE_SCHEMA_ID,
        schema_version: DECISION_TABLE_SCHEMA_VERSION,
        policy_major: DECISION_POLICY_MAJOR,
        policy_version: DECISION_POLICY_VERSION,
      },
    },
    contracts: {
      status: {
        default_context: DEFAULT_STATUS_CONTEXT,
        context_selection: "case-insensitive-latest-then-exact-spelling",
        creator: {
          login: "github-actions[bot]",
          type: "Bot",
        },
        target_url:
          "https://github.com/{owner}/{repo}/actions/runs/{run_id}/attempts/{run_attempt}",
        rest: {
          create: {
            method: "POST",
            route: "/repos/{owner}/{repo}/statuses/{sha}",
          },
          list: {
            method: "GET",
            route: "/repos/{owner}/{repo}/commits/{ref}/statuses",
          },
          get_by_id_available: false,
        },
        graphql_reread: {
          root: "node(id: $node_id)",
          expected_type: "StatusContext",
          node_id_source: "receipt.statuses[].node_id",
          required_fields: [
            "id",
            "context",
            "state",
            "description",
            "targetUrl",
            "createdAt",
            "creator.login",
            "creator.__typename",
            "commit.oid"
          ],
          state_mapping: {
            error: "ERROR",
            failure: "FAILURE",
            pending: "PENDING",
            success: "SUCCESS",
          },
        },
      },
      producer_receipt: {
        schema_id: RECEIPT_SCHEMA_ID,
        schema_version: RECEIPT_SCHEMA_VERSION,
        producer_protocol_major: PRODUCER_PROTOCOL_MAJOR,
        github_cloud_only: true,
        exact_called_workflow_sha_required: true,
        called_workflow_authority: {
          repository: ACTION_REPOSITORY,
          workflow_file_path: REUSABLE_WORKFLOW_PATH,
          caller_selector: REUSABLE_WORKFLOW_SELECTOR,
          caller_ref: REUSABLE_WORKFLOW_REF,
          caller_reference: REUSABLE_WORKFLOW_CANONICAL_REFERENCE,
          immutable_reference:
            `${ACTION_REPOSITORY}/${REUSABLE_WORKFLOW_PATH}@${actionCommit}`,
          accepted_resolved_sha: actionCommit,
          required_equalities: [...CALLED_WORKFLOW_REQUIRED_EQUALITIES],
          caller_identity_role:
            "producer.environment.GITHUB_WORKFLOW_REF/SHA-identifies-caller-workflow-file",
          called_job_identity_role:
            "producer.job.workflow_ref/SHA/repository/file_path-identifies-workflow-file-defining-current-job",
        },
        run_attempt_api: {
          method: "GET",
          route:
            "/repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}",
          head_role: "caller-workflow-event-commit",
          required_equalities: [...RUN_ATTEMPT_REQUIRED_EQUALITIES],
          referenced_workflows: {
            field: "referenced_workflows",
            availability:
              "optional-nullable-upstream-but-required-non-null-for-this-reusable-workflow-contract",
            selection: "exactly-one-exact-called-workflow-member",
            expected_path: REUSABLE_WORKFLOW_CANONICAL_REFERENCE,
            expected_ref: REUSABLE_WORKFLOW_REF,
            expected_sha: actionCommit,
            required_equalities: [...REFERENCED_WORKFLOW_REQUIRED_EQUALITIES],
            rerun_resolution:
              "exact-receipt-run-attempt-only-no-current-selector-substitution",
            tag_drift:
              "later-v1-movement-does-not-change-historical-attempt-sha",
            authority:
              "run-level-attempt-corroboration-only-no-job-callsite-or-receipt-cryptographic-binding",
          },
        },
        artifact_inventory_api: {
          method: "GET",
          route: "/repos/{owner}/{repo}/actions/runs/{run_id}/artifacts",
          inventory_scope: "run-level-fully-paginated",
          expected_name:
            "codex-review-gate-producer-receipt-{run_id}-{run_attempt}",
          expected_total_count: 1,
          expected_member: "codex-review-gate-producer-receipt.json",
          expected_zip_member_count: 1,
          required_metadata: [
            "id",
            "name",
            "url",
            "archive_download_url",
            "digest",
            "expired",
            "expires_at",
            "workflow_run.id",
            "workflow_run.head_sha"
          ],
          required_output_bindings: [
            "producer-receipt-artifact-id",
            "producer-receipt-artifact-url",
            "producer-receipt-artifact-digest"
          ],
          required_equalities: [
            "producer-receipt-artifact-id-equals-artifact-api-id",
            "producer-receipt-artifact-digest-equals-artifact-api-digest",
            "producer-receipt-artifact-url-equals-https://github.com/{owner}/{repo}/actions/runs/{run_id}/artifacts/{artifact_id}",
            ...ARTIFACT_RUN_REQUIRED_EQUALITIES,
            "artifact-api-name-equals-receipt-artifact-name",
            "artifact-api-expired-is-false"
          ],
        },
        accepted_execution_result_for_positive_decision: "completed",
        positive_consumer_requirement: {
          operator: POSITIVE_CONSUMER_REQUIREMENT.operator,
          execution: {
            ...POSITIVE_CONSUMER_REQUIREMENT.execution,
          },
          selected_status: {
            ...POSITIVE_CONSUMER_REQUIREMENT.selected_status,
          },
        },
        exact_workflow_bindings: [
          "GITHUB_WORKFLOW_REF",
          "GITHUB_WORKFLOW_SHA",
          "job.id",
          "job.workflow_ref",
          "job.workflow_sha",
          "job.workflow_repository",
          "job.workflow_file_path"
        ],
        exact_action_bindings: [
          "producer.action.repository-equals-producer.job.workflow_repository",
          "producer.action.ref-equals-producer.job.workflow_sha",
          "producer.action.commit_sha-equals-producer.job.workflow_sha",
          "producer.action.immutable-is-true"
        ],
        receipt_statuses: {
          scope: "run-level-ordered-multi-pull-request",
          head_role: "current-pull-request-head",
          required_head_equalities: [...STATUS_HEAD_REQUIRED_EQUALITIES],
          sequence: "contiguous-from-one",
          status_count: "equals-statuses-length",
          consumer_selection: [
            "exact-pull-request-number",
            "exact-current-head-sha",
            "latest-case-insensitive-logical-context",
            "exact-context-spelling",
            "exact-current-run-attempt-target-url"
          ],
        },
        head_domain_separation: {
          workflow_run_head_may_differ_from_status_and_pull_request_head: true,
          caller_workflow_sha_may_differ_from_called_workflow_sha: true,
          consumer_must_not_require: [
            ...DISALLOWED_RUN_STATUS_HEAD_REQUIREMENTS,
          ],
        },
        source_checkout: sourceCheckoutBindings,
        uploader: `actions/upload-artifact@${UPLOAD_ARTIFACT_SHA}`,
        authority: "run-bound-causal-consistency-evidence",
        provider_evidence_must_be_independently_revalidated: true,
        cryptographic_provenance_claimed: false,
      },
      decision_table: {
        schema_id: DECISION_TABLE_SCHEMA_ID,
        schema_version: DECISION_TABLE_SCHEMA_VERSION,
        policy_major: DECISION_POLICY_MAJOR,
        policy_version: DECISION_POLICY_VERSION,
        raw_sha256: decisionTable.raw_sha256,
      },
    },
  };
  if (
    resolveRefObject(sourceRepo, options.sourceDefaultRef, "source default ref") !==
      sourceCommit ||
    resolveRefObject(actionRepo, options.actionDefaultRef, "action default ref") !==
      actionCommit ||
    resolveRefObject(actionRepo, options.immutableTagRef, "v1.5.0 tag ref") !==
      tags[EXPECTED_TAGS.immutable].tag_object_oid ||
    resolveRefObject(actionRepo, options.minorTagRef, "v1.5 tag ref") !==
      tags[EXPECTED_TAGS.minor].tag_object_oid ||
    resolveRefObject(actionRepo, options.majorTagRef, "v1 tag ref") !==
      tags.v1.tag_object_oid
  ) {
    throw new Error("a release branch or tag ref changed during manifest generation");
  }
  assertNoPlaceholders(manifest);
  return manifest;
}

async function assertReleaseRefsStillStable(options, manifest) {
  const sourceRepo = await canonicalRepoPath(options.sourceRepo, "source repo");
  const actionRepo = await canonicalRepoPath(options.actionRepo, "action repo");
  if (
    resolveRefObject(sourceRepo, options.sourceDefaultRef, "source default ref") !==
      manifest.source.commit_oid ||
    resolveRefObject(actionRepo, options.actionDefaultRef, "action default ref") !==
      manifest.action.commit_oid ||
    resolveRefObject(actionRepo, options.immutableTagRef, "v1.5.0 tag ref") !==
      manifest.tags[EXPECTED_TAGS.immutable].tag_object_oid ||
    resolveRefObject(actionRepo, options.minorTagRef, "v1.5 tag ref") !==
      manifest.tags[EXPECTED_TAGS.minor].tag_object_oid ||
    resolveRefObject(actionRepo, options.majorTagRef, "v1 tag ref") !==
      manifest.tags.v1.tag_object_oid
  ) {
    throw new Error("a release branch or tag ref changed during manifest publication");
  }
}

export async function writeManifest(
  outputPath,
  manifest,
  { beforePublish, afterStagingValidation, finalPrePublish } = {},
) {
  const absoluteOutput = resolve(outputPath);
  await mkdir(dirname(absoluteOutput), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const stagingDirectory = await mkdtemp(`${absoluteOutput}.tmp-`);
  const temporary = join(stagingDirectory, "manifest");
  let temporaryHandle;
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
      throw new Error(
        "manifest staging directory is not an owner-private POSIX directory",
      );
    }
    temporaryHandle = await open(temporary, "wx", 0o600);
    await temporaryHandle.writeFile(bytes);
    await temporaryHandle.sync();
    if (beforePublish) {
      await beforePublish();
    }
    const handleIdentity = await temporaryHandle.stat({ bigint: true });
    const pathIdentity = await lstat(temporary, { bigint: true });
    const stagedBytes = await readFile(temporary);
    if (
      !handleIdentity.isFile() ||
      !pathIdentity.isFile() ||
      handleIdentity.dev !== pathIdentity.dev ||
      handleIdentity.ino !== pathIdentity.ino ||
      handleIdentity.mode !== pathIdentity.mode ||
      handleIdentity.uid !== pathIdentity.uid ||
      handleIdentity.gid !== pathIdentity.gid ||
      (handleIdentity.mode & 0o777n) !== 0o600n ||
      handleIdentity.size !== BigInt(bytes.length) ||
      !stagedBytes.equals(bytes)
    ) {
      throw new Error(
        "manifest staging object identity, access policy, or content changed",
      );
    }
    if (afterStagingValidation) {
      await afterStagingValidation();
    }
    if (finalPrePublish) {
      await finalPrePublish();
    }
    // The output path is a create-only publication boundary. Linking commits
    // the verified object from this invocation's owner-private staging directory
    // without replacing any existing path. Hostile code already running as the
    // same OS account remains outside this local publication boundary.
    try {
      await link(temporary, absoluteOutput);
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new Error(
          `output already exists; refusing to replace ${absoluteOutput}`,
          { cause: error },
        );
      }
      throw error;
    }
  } catch (error) {
    throw error;
  } finally {
    await temporaryHandle?.close();
    await rm(stagingDirectory, { recursive: true, force: true });
  }
  return { absoluteOutput, digest: sha256(bytes) };
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const manifest = await generateProvenance(options);
  const { absoluteOutput, digest } = await writeManifest(
    options.output,
    manifest,
    {
      beforePublish: () => assertReleaseRefsStillStable(options, manifest),
      finalPrePublish: () => assertReleaseRefsStillStable(options, manifest),
    },
  );
  process.stdout.write(`${absoluteOutput}\nsha256:${digest}\n`);
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    process.stderr.write(`error: ${error.message}\n`);
    process.exitCode = 1;
  });
}
