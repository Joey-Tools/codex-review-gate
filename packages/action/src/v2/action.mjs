import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { V2_STATUS_CONTEXT } from "./projection.mjs";
import { reduceV2Snapshot } from "./reducer.mjs";
import {
  V2_OPERATIONS,
  V2_STATUS_TARGET_MODES,
  runV2Operation,
} from "./runner.mjs";
import { createV2GitHubTransport } from "./transport.mjs";

export const MAX_OPERATION_INPUT_BYTES = 1024 * 1024;

const OPERATIONS = new Set(V2_OPERATIONS);
const STATUS_TARGET_MODES = new Set(V2_STATUS_TARGET_MODES);
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
const REPOSITORY_PATTERN = /^(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/u;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/u;

/**
 * Read controller input without following replacement or aliasing paths.
 *
 * Protected properties:
 * - access policy: every selected path component is inside canonical
 *   RUNNER_TEMP, is not a symlink, and the final file is regular,
 *   single-linked, and not group/world writable;
 * - object identity: lstat/fstat device and inode must remain equal;
 * - content stability: two positioned reads from the same descriptor must be
 *   byte-identical. Benign timestamp changes alone are not mutation evidence.
 */
export function readControllerInputFile(
  inputPath,
  runnerTemp,
  { maxBytes = MAX_OPERATION_INPUT_BYTES } = {},
) {
  const selectedPath = canonicalSelectedPath(inputPath, "operation-input-path");
  const selectedRoot = canonicalSelectedPath(runnerTemp, "RUNNER_TEMP");
  const canonicalRoot = realpathSync(selectedRoot);
  if (canonicalRoot !== selectedRoot) {
    throw new Error("RUNNER_TEMP must itself be a canonical non-symlink path");
  }
  assertDescendant(canonicalRoot, selectedPath);
  assertNoSymlinkComponents(canonicalRoot, selectedPath);

  const pathStat = lstatSync(selectedPath, { bigint: true, throwIfNoEntry: false });
  if (pathStat === undefined) {
    throw new Error("operation-input-path does not exist");
  }
  assertInputFileAccessPolicy(pathStat);

  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  let descriptor;
  try {
    descriptor = openSync(selectedPath, fsConstants.O_RDONLY | noFollow);
  } catch (error) {
    throw new Error("operation-input-path could not be opened without following links", {
      cause: error,
    });
  }

  try {
    const openedStat = fstatSync(descriptor, { bigint: true });
    assertInputFileAccessPolicy(openedStat);
    assertSameObject(pathStat, openedStat, "operation-input-path changed before open");
    const size = Number(openedStat.size);
    if (!Number.isSafeInteger(size) || size <= 0 || size > maxBytes) {
      throw new Error(`operation-input-path must contain 1 through ${maxBytes} bytes`);
    }
    const first = readExact(descriptor, size);
    const second = readExact(descriptor, size);
    if (!first.equals(second)) {
      throw new Error("operation-input-path content changed while it was read");
    }
    const finalOpenedStat = fstatSync(descriptor, { bigint: true });
    assertInputFileAccessPolicy(finalOpenedStat);
    assertSameObject(openedStat, finalOpenedStat, "opened input object was replaced");
    if (finalOpenedStat.size !== openedStat.size) {
      throw new Error("operation-input-path size changed while it was read");
    }
    const finalPathStat = lstatSync(selectedPath, { bigint: true, throwIfNoEntry: false });
    if (finalPathStat === undefined) {
      throw new Error("operation-input-path became unreadable or missing after read");
    }
    assertInputFileAccessPolicy(finalPathStat);
    assertSameObject(openedStat, finalPathStat, "operation-input-path was replaced after open");
    return parseCanonicalControllerJson(first);
  } finally {
    closeSync(descriptor);
  }
}

export function canonicalActionJson(value) {
  return `${canonicalJson(value)}\n`;
}

export function createReadOnlyGitHubFetch(fetchImpl, { restBaseUrl, graphqlUrl }) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetch must be a function");
  }
  const rest = serviceUrl(restBaseUrl, "REST base URL");
  const graphql = serviceUrl(graphqlUrl, "GraphQL URL", { allowPath: true });
  return async (rawUrl, rawInit = {}) => {
    const url = new URL(rawUrl);
    const method = String(rawInit.method ?? "GET").toUpperCase();
    const restPath = rest.pathname === "/" ? "" : rest.pathname;
    const isRestTarget =
      url.origin === rest.origin &&
      (url.pathname === restPath || url.pathname.startsWith(`${restPath}/`));
    const isGraphqlTarget = url.href === graphql.href;
    if (method === "GET" && isRestTarget) {
      return fetchImpl(rawUrl, rawInit);
    }
    if (method === "POST" && isGraphqlTarget && isReadOnlyGraphqlBody(rawInit.body)) {
      return fetchImpl(rawUrl, rawInit);
    }
    throw new Error("plan-only Action blocked a non-read GitHub transport request");
  };
}

export async function executeV2Action(
  environment = process.env,
  dependencies = {},
) {
  const configuration = validateActionEnvironment(environment);
  const input = readControllerInputFile(
    configuration.input_path,
    configuration.runner_temp,
  );
  validateActionBinding(input, configuration);

  const guardedFetch = createReadOnlyGitHubFetch(
    dependencies.fetch ?? globalThis.fetch,
    {
      restBaseUrl: configuration.rest_base_url,
      graphqlUrl: configuration.graphql_url,
    },
  );
  const transport = dependencies.transport ?? createV2GitHubTransport({
    fetch: guardedFetch,
    token: configuration.github_token,
    restBaseUrl: configuration.rest_base_url.href,
    graphqlUrl: configuration.graphql_url.href,
  });
  const result = await runV2Operation(input, {
    transport,
    reduceSnapshot: dependencies.reduceSnapshot ?? reduceV2Snapshot,
    ...(dependencies.planActions === undefined
      ? {}
      : { planActions: dependencies.planActions }),
    ...(dependencies.deriveEvidenceRequest === undefined
      ? {}
      : { deriveEvidenceRequest: dependencies.deriveEvidenceRequest }),
    ...(dependencies.projectSnapshots === undefined
      ? {}
      : { projectSnapshots: dependencies.projectSnapshots }),
    ...(dependencies.projectPublicReport === undefined
      ? {}
      : { projectPublicReport: dependencies.projectPublicReport }),
    ...(dependencies.validateTarget === undefined
      ? {}
      : { validateTarget: dependencies.validateTarget }),
    ...(dependencies.getExactArtifact === undefined
      ? {}
      : { getExactArtifact: dependencies.getExactArtifact }),
  });
  if (result.writes_performed !== false) {
    throw new Error("plan-only Action received a runner result that performed writes");
  }

  const outputs = writeV2ActionOutputs(result, configuration.runner_temp);
  if (configuration.github_output !== null) {
    appendGitHubOutputs(configuration.github_output, outputs);
  }
  return { result, outputs };
}

function validateActionEnvironment(environment) {
  const githubToken = requiredEnvironment(environment, "V2_GITHUB_TOKEN");
  const pullRequestText = requiredEnvironment(environment, "V2_PULL_REQUEST");
  if (!POSITIVE_INTEGER_PATTERN.test(pullRequestText)) {
    throw new TypeError("pull-request must be a canonical positive integer");
  }
  const pullRequest = Number(pullRequestText);
  if (!Number.isSafeInteger(pullRequest)) {
    throw new TypeError("pull-request exceeds the safe integer range");
  }
  const operation = requiredEnvironment(environment, "V2_OPERATION");
  if (!OPERATIONS.has(operation)) {
    throw new TypeError("operation is not a closed v2 operation");
  }
  const statusTargetMode = requiredEnvironment(environment, "V2_STATUS_TARGET_MODE");
  if (!STATUS_TARGET_MODES.has(statusTargetMode)) {
    throw new TypeError("status-target-mode is not a closed v2 mode");
  }
  const [owner, repo, extra] = requiredEnvironment(environment, "GITHUB_REPOSITORY").split("/");
  if (extra !== undefined || !OWNER_PATTERN.test(owner ?? "") || !REPOSITORY_PATTERN.test(repo ?? "")) {
    throw new TypeError("GITHUB_REPOSITORY must be a canonical owner/repository pair");
  }
  const restBaseUrl = serviceUrl(
    requiredEnvironment(environment, "V2_REST_BASE_URL"),
    "V2_REST_BASE_URL",
  );
  const graphqlUrl = serviceUrl(
    requiredEnvironment(environment, "V2_GRAPHQL_URL"),
    "V2_GRAPHQL_URL",
    { allowPath: true },
  );
  return {
    github_token: githubToken,
    owner,
    repo,
    pull_request: pullRequest,
    operation,
    status_target_mode: statusTargetMode,
    input_path: requiredEnvironment(environment, "V2_OPERATION_INPUT_PATH"),
    runner_temp: requiredEnvironment(environment, "RUNNER_TEMP"),
    rest_base_url: restBaseUrl,
    graphql_url: graphqlUrl,
    github_output: optionalEnvironment(environment, "GITHUB_OUTPUT"),
  };
}

function validateActionBinding(input, configuration) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("operation input must be an object");
  }
  if (
    input.operation !== configuration.operation ||
    input.status_target_mode !== configuration.status_target_mode ||
    input.status_context !== V2_STATUS_CONTEXT
  ) {
    throw new Error("operation input does not match the fixed Action operation and status target");
  }
  if (
    input.snapshot_request?.owner !== configuration.owner ||
    input.snapshot_request?.repo !== configuration.repo ||
    input.snapshot_request?.pull_number !== configuration.pull_request
  ) {
    throw new Error("operation input does not match the current repository and pull request");
  }
}

export function writeV2ActionOutputs(result, runnerTemp) {
  const directory = join(
    runnerTemp,
    `codex-review-gate-v2-${randomBytes(12).toString("hex")}`,
  );
  mkdirSync(directory, { mode: 0o700 });
  const writeJson = (name, value) => {
    if (value === null) {
      return "";
    }
    const outputPath = join(directory, name);
    writeFileSync(outputPath, canonicalActionJson(value), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    return outputPath;
  };
  return Object.freeze({
    decision: result.decision,
    "result-path": writeJson("result.json", publicV2ActionResult(result)),
    "report-path": writeJson("report.json", result.report),
    "status-plan-path": writeJson("status-plan.json", result.status_plan),
    "reservation-path": writeJson("reservation.json", result.reservation),
    "intent-path": writeJson("post-intent.json", result.post_intent),
    "binding-receipt-path": writeJson("binding-receipt.json", result.binding_receipt),
  });
}

export function publicV2ActionResult(result) {
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    throw new TypeError("runner result must be an object");
  }
  assertNoInternalReducerReport(result, "runner result", { allowRoot: true });
  const { reducer_report: _internalReducerReport, ...publicResult } = result;
  return publicResult;
}

function assertNoInternalReducerReport(value, label, { allowRoot = false } = {}, depth = 0) {
  if (depth > 64) {
    throw new TypeError(`${label} exceeds the public Action output nesting cap`);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoInternalReducerReport(item, label, {}, depth + 1);
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (!allowRoot && Object.hasOwn(value, "reducer_report")) {
    throw new TypeError(`${label} contains an internal compact reducer report`);
  }
  for (const [key, child] of Object.entries(value)) {
    if (allowRoot && key === "reducer_report") continue;
    assertNoInternalReducerReport(child, label, {}, depth + 1);
  }
}

function appendGitHubOutputs(outputPath, outputs) {
  const lines = Object.entries(outputs).map(([name, value]) => {
    if (/\r|\n/u.test(value)) {
      throw new Error(`Action output ${name} contains a line break`);
    }
    return `${name}=${value}\n`;
  }).join("");
  appendFileSync(outputPath, lines, { encoding: "utf8" });
}

function canonicalSelectedPath(value, label) {
  if (typeof value !== "string" || value.length === 0 || !isAbsolute(value)) {
    throw new TypeError(`${label} must be a non-empty absolute path`);
  }
  const canonical = resolve(value);
  if (canonical !== value || basename(value) === "" || value.includes("\0")) {
    throw new TypeError(`${label} must already be a canonical absolute path`);
  }
  return canonical;
}

function assertDescendant(root, selectedPath) {
  const pathFromRoot = relative(root, selectedPath);
  if (
    pathFromRoot === "" ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error("operation-input-path must be a descendant of RUNNER_TEMP");
  }
}

function assertNoSymlinkComponents(root, selectedPath) {
  const components = relative(root, selectedPath).split(sep);
  let cursor = root;
  for (const [index, component] of components.entries()) {
    cursor = join(cursor, component);
    const stat = lstatSync(cursor, { bigint: true, throwIfNoEntry: false });
    if (stat === undefined) {
      throw new Error("operation-input-path or one of its parents does not exist");
    }
    if (stat.isSymbolicLink()) {
      throw new Error("operation-input-path cannot traverse a symlink");
    }
    if (index < components.length - 1 && !stat.isDirectory()) {
      throw new Error("operation-input-path parent components must be directories");
    }
  }
}

function assertInputFileAccessPolicy(stat) {
  if (!stat.isFile()) {
    throw new Error("operation-input-path must identify a regular file");
  }
  if (stat.nlink !== 1n) {
    throw new Error("operation-input-path must not be hard linked");
  }
  if ((Number(stat.mode) & 0o022) !== 0) {
    throw new Error("operation-input-path must not be group or world writable");
  }
}

function assertSameObject(left, right, message) {
  if (left.dev !== right.dev || left.ino !== right.ino) {
    throw new Error(message);
  }
}

function readExact(descriptor, size) {
  const buffer = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    const count = readSync(descriptor, buffer, offset, size - offset, offset);
    if (count === 0) {
      throw new Error("operation-input-path became unreadable during read");
    }
    offset += count;
  }
  return buffer;
}

function parseCanonicalControllerJson(bytes) {
  const text = bytes.toString("utf8");
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error("operation-input-path is not valid UTF-8 JSON", { cause: error });
  }
  if (text !== canonicalActionJson(value)) {
    throw new Error("operation-input-path must use canonical sorted compact JSON with one LF");
  }
  return value;
}

function isReadOnlyGraphqlBody(rawBody) {
  if (typeof rawBody !== "string" || rawBody.length === 0 || rawBody.length > MAX_OPERATION_INPUT_BYTES) {
    return false;
  }
  try {
    const parsed = JSON.parse(rawBody);
    return parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).sort().join(",") === "query,variables" &&
      typeof parsed.query === "string" &&
      parsed.query.trimStart().startsWith("query CodexReviewGateV2") &&
      parsed.variables !== null &&
      typeof parsed.variables === "object" &&
      !Array.isArray(parsed.variables);
  } catch {
    return false;
  }
}

function serviceUrl(value, label, { allowPath = false } = {}) {
  let url;
  try {
    url = value instanceof URL ? new URL(value.href) : new URL(value);
  } catch (error) {
    throw new TypeError(`${label} must be an absolute HTTPS URL`, { cause: error });
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (!allowPath && !["", "/", "/api/v3"].includes(url.pathname.replace(/\/$/u, "")))
  ) {
    throw new TypeError(`${label} must be a canonical credential-free HTTPS service URL`);
  }
  url.pathname = url.pathname.replace(/\/$/u, "");
  return url;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function requiredEnvironment(environment, name) {
  const value = environment[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} is required`);
  }
  return value;
}

function optionalEnvironment(environment, name) {
  const value = environment[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isMainModule() {
  return process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  executeV2Action().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`::error::${message.replace(/[\r\n%]/gu, " ")}\n`);
    process.exitCode = 1;
  });
}
