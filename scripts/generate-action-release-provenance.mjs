#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  constants as fsConstants,
  realpathSync,
  statSync,
} from "node:fs";
import { mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const RELEASE = "1.4.0";
const SOURCE_REPOSITORY = "JoeyTeng/codex-review-gate";
const ACTION_REPOSITORY = "JoeyTeng/codex-review-gate-action";
const SOURCE_SUBTREE = "packages/action";
const DEFAULT_STATUS_CONTEXT = "codex/review-gate";
const RECEIPT_SCHEMA_ID =
  "urn:joeyteng:codex-review-gate:producer-receipt:1";
const DECISION_TABLE_SCHEMA_ID =
  "urn:joeyteng:codex-review-gate:decision-table:1";
const FROZEN_DECISION_TABLE_SHA256 =
  "11b2fbc6e5b2bd5c923ecbfb7c56b00a5189108291999f1aaefdb27b7b1f8196";
const PROVENANCE_SCHEMA_ID =
  "urn:joeyteng:codex-review-gate:release-provenance:1";
const UPLOAD_ARTIFACT_SHA =
  "ea165f8d65b6e75b540449e92b4886f43607fa02";
const RUN_ATTEMPT_REQUIRED_EQUALITIES = Object.freeze([
  "id-equals-receipt-producer-run-id",
  "run_attempt-equals-receipt-producer-run-attempt",
  "repository-full_name-equals-receipt-producer-repository",
  "head_sha-equals-receipt-producer-environment-GITHUB_WORKFLOW_SHA",
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
  immutable: "v1.4.0",
  minor: "v1.4",
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
  --immutable-tag-ref refs/tags/v1.4.0 \\
  --minor-tag-ref refs/tags/v1.4 --major-tag-ref refs/tags/v1 \\
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
    table?.schema_version !== 1 ||
    table?.policy_version !== RELEASE
  ) {
    throw new Error("decision table identity contradicts release 1.4.0");
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
    !table.producer_receipt_boundary?.floating_tags?.includes("never canonical") ||
    !table.producer_receipt_boundary?.canonical_action_reference_format?.includes(
      "exact lower-case 40-hex",
    )
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

function parseVerifiedOpenPgpStatus(result, expectedName) {
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
  const fingerprint = validSignatures[0].payload.split(" ", 1)[0].toUpperCase();
  if (
    !/^[0-9A-F]{16}$/.test(keyId) ||
    !/^[0-9A-F]{40,64}$/.test(fingerprint) ||
    !fingerprint.endsWith(keyId)
  ) {
    throw new Error(`${expectedName} emitted inconsistent GOODSIG/VALIDSIG identity`);
  }
  return fingerprint.toLowerCase();
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
      signer_fingerprint: null,
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
    const signerFingerprint = parseVerifiedOpenPgpStatus(
      verification,
      expectedName,
    );
    signature = {
      verified: true,
      method: "git-verify-tag-openpgp-raw",
      signer_fingerprint: signerFingerprint,
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
    "v1.4.0": verifyTag(
      actionRepo,
      options.immutableTagRef,
      EXPECTED_TAGS.immutable,
      actionCommit,
      options.testOnlySkipSignatureVerification,
    ),
    "v1.4": verifyTag(
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
  const receiptSchema = criticalFile(
    actionRepo,
    entries,
    "producer-receipt.schema.json",
  );
  const decisionTable = criticalFile(actionRepo, entries, "decision-table.json");
  const actionPackage = criticalFile(actionRepo, entries, "package.json");
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
    receiptSchemaJson?.properties?.schema_version?.const !== 1
  ) {
    throw new Error("producer receipt schema identity contradicts receipt v1");
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
    schema_version: 1,
    release: RELEASE,
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
    tags,
    proofs: {
      source_subtree_equals_action_root: true,
      source_subtree_tree_oid: sourceActionTree,
      action_root_tree_oid: actionTree,
      all_tags_annotated: true,
      all_tags_peel_to_action_commit: true,
      all_tag_signatures_verified: !options.testOnlySkipSignatureVerification,
      production_signature_verification_required: true,
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
      },
      producer_receipt_schema: {
        release_path: receiptSchema.release_path,
        source_path: receiptSchema.source_path,
        blob_oid: receiptSchema.blob_oid,
        raw_sha256: receiptSchema.raw_sha256,
        schema_id: RECEIPT_SCHEMA_ID,
        schema_version: 1,
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
        schema_version: 1,
        policy_version: RELEASE,
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
        github_cloud_only: true,
        exact_action_sha_required: true,
        run_attempt_api: {
          method: "GET",
          route:
            "/repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}",
          head_role: "caller-workflow-event-commit",
          required_equalities: [...RUN_ATTEMPT_REQUIRED_EQUALITIES],
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
          "producer.action.repository",
          "producer.action.ref",
          "producer.action.commit_sha",
          "producer.action.immutable-true"
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
          consumer_must_not_require: [
            ...DISALLOWED_RUN_STATUS_HEAD_REQUIREMENTS,
          ],
        },
        uploader: `actions/upload-artifact@${UPLOAD_ARTIFACT_SHA}`,
        authority: "run-bound-causal-consistency-evidence",
        provider_evidence_must_be_independently_revalidated: true,
        cryptographic_provenance_claimed: false,
      },
      decision_table: {
        schema_id: DECISION_TABLE_SCHEMA_ID,
        schema_version: 1,
        policy_version: RELEASE,
        raw_sha256: decisionTable.raw_sha256,
      },
    },
  };
  if (
    resolveRefObject(sourceRepo, options.sourceDefaultRef, "source default ref") !==
      sourceCommit ||
    resolveRefObject(actionRepo, options.actionDefaultRef, "action default ref") !==
      actionCommit ||
    resolveRefObject(actionRepo, options.immutableTagRef, "v1.4.0 tag ref") !==
      tags["v1.4.0"].tag_object_oid ||
    resolveRefObject(actionRepo, options.minorTagRef, "v1.4 tag ref") !==
      tags["v1.4"].tag_object_oid ||
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
    resolveRefObject(actionRepo, options.immutableTagRef, "v1.4.0 tag ref") !==
      manifest.tags["v1.4.0"].tag_object_oid ||
    resolveRefObject(actionRepo, options.minorTagRef, "v1.4 tag ref") !==
      manifest.tags["v1.4"].tag_object_oid ||
    resolveRefObject(actionRepo, options.majorTagRef, "v1 tag ref") !==
      manifest.tags.v1.tag_object_oid
  ) {
    throw new Error("a release branch or tag ref changed before manifest publication");
  }
}

async function writeManifest(outputPath, manifest, { beforePublish } = {}) {
  const absoluteOutput = resolve(outputPath);
  await mkdir(dirname(absoluteOutput), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const temporary = `${absoluteOutput}.tmp-${process.pid}`;
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    if (beforePublish) {
      await beforePublish();
    }
    await rename(temporary, absoluteOutput);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
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
