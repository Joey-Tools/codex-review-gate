import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { V2_STATUS_CONTEXT } from "./projection.mjs";
import { reduceV2Snapshot } from "./reducer.mjs";
import {
  V2_OPERATIONS,
  V2_STATUS_TARGET_MODES,
  runV2Operation,
} from "./runner.mjs";
import { createV2GitHubTransport } from "./transport.mjs";

export const MAX_OPERATION_INPUT_BYTES = 1024 * 1024;

const CONTROLLER_INPUT_READER_PATH = fileURLToPath(
  new URL("./controller-input-reader.mjs", import.meta.url),
);
const CONTROLLER_INPUT_READER_TIMEOUT_MILLISECONDS = 10_000;
const CONTROLLER_INPUT_READER_BUFFER_OVERHEAD = 64 * 1024;
const CONTROLLER_INPUT_READER_FAILURES = [
  ["UNSUPPORTED", "isolated controller input reading is unsupported"],
  ["INVALID_REQUEST", "isolated controller input reader rejected its fixed request"],
  ["MISSING", "operation-input-path or an anchored parent became missing during read"],
  ["UNREADABLE", "operation-input-path or an anchored parent became unreadable during read"],
  ["ACCESS_POLICY", "operation-input-path traversal violated its access policy"],
  ["IDENTITY", "operation-input-path or an anchored directory object identity changed during read"],
  ["CONTENT", "operation-input-path content changed during read"],
  ["SIZE_LIMIT", "operation-input-path violated its byte-size limit"],
  ["INTERNAL", "isolated controller input reader failed internally"],
].map(([code, message]) => [
  Buffer.from(`CODEX_CONTROLLER_READER_${code}\n`, "ascii"),
  message,
]);

const OPERATIONS = new Set(V2_OPERATIONS);
const STATUS_TARGET_MODES = new Set(V2_STATUS_TARGET_MODES);
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
const REPOSITORY_PATTERN = /^(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/u;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/u;

/**
 * Read controller input without allowing traversal to redirect to a different
 * directory object.
 *
 * Protected properties:
 * - access policy: the input suffix is resolved relative to the same held
 *   canonical RUNNER_TEMP directory object. At each observed stat, the leaf
 *   is regular, single-linked, and has no group/other write mode bit;
 * - object identity: directory and leaf lstat/fstat device, inode, and type
 *   must remain equal, and the parent-selected leaf descriptor stays held
 *   through the child read. A same-object symlink inserted during the
 *   open/chdir seam can be traversed, but cannot redirect to another object;
 * - content stability: two positioned reads from the same descriptor must be
 *   byte-identical, and every observed descriptor/path size must equal the
 *   parent-selected size. Benign timestamp changes alone are not evidence;
 * - representation integrity: the stable raw bytes must round-trip through
 *   UTF-8 exactly and be the unique canonical JSON plus one LF encoding.
 */
export function readControllerInputFile(
  inputPath,
  runnerTemp,
  { maxBytes = MAX_OPERATION_INPUT_BYTES } = {},
) {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes <= 0 ||
    maxBytes > MAX_OPERATION_INPUT_BYTES
  ) {
    throw new TypeError(
      `maxBytes must be an integer from 1 through ${MAX_OPERATION_INPUT_BYTES}`,
    );
  }
  assertIsolatedReaderCapabilities();
  const selectedPath = canonicalSelectedPath(inputPath, "operation-input-path");
  const selectedRoot = canonicalSelectedPath(runnerTemp, "RUNNER_TEMP");
  assertDescendant(selectedRoot, selectedPath);

  let rootDescriptor;
  try {
    rootDescriptor = openSync(
      selectedRoot,
      fsConstants.O_RDONLY |
        fsConstants.O_NONBLOCK |
        fsConstants.O_DIRECTORY |
        fsConstants.O_NOFOLLOW,
    );
  } catch (error) {
    throw runnerTempOpenFailure(error);
  }

  try {
    let openedRootStat;
    try {
      openedRootStat = fstatSync(rootDescriptor, { bigint: true });
    } catch (error) {
      throw new Error("opened RUNNER_TEMP directory became unreadable", { cause: error });
    }
    if (!openedRootStat.isDirectory()) {
      throw new Error("opened RUNNER_TEMP object must identify a directory");
    }

    const canonicalRoot = realpathSync(selectedRoot);
    if (canonicalRoot !== selectedRoot) {
      throw new Error("RUNNER_TEMP must itself be a canonical non-symlink path");
    }

    // This is an early diagnostic only. The child process's held-fd/cwd walk
    // below is the access-policy boundary for concurrent parent replacement.
    assertNoSymlinkComponents(canonicalRoot, selectedPath);
    const preflightInputStat = lstatSync(selectedPath, {
      bigint: true,
      throwIfNoEntry: false,
    });
    if (preflightInputStat === undefined) {
      throw new Error("operation-input-path does not exist");
    }
    assertInputFileAccessPolicy(preflightInputStat);

    let inputDescriptor;
    try {
      inputDescriptor = openSync(
        selectedPath,
        fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW,
      );
    } catch (error) {
      throw operationInputOpenFailure(error);
    }

    try {
      let openedInputStat;
      try {
        openedInputStat = fstatSync(inputDescriptor, { bigint: true });
      } catch (error) {
        throw new Error("opened operation-input-path became unreadable", { cause: error });
      }
      assertInputFileAccessPolicy(openedInputStat);
      assertSameInputObject(
        preflightInputStat,
        openedInputStat,
        "operation-input-path changed before open",
      );
      const selectedSize = Number(openedInputStat.size);
      if (!Number.isSafeInteger(selectedSize) || selectedSize <= 0 || selectedSize > maxBytes) {
        throw new Error(`operation-input-path must contain 1 through ${maxBytes} bytes`);
      }

      const result = spawnSync(
        process.execPath,
        [
          CONTROLLER_INPUT_READER_PATH,
          canonicalRoot,
          selectedPath,
          String(maxBytes),
          String(selectedSize),
        ],
        {
          cwd: sep,
          env: {},
          encoding: null,
          timeout: CONTROLLER_INPUT_READER_TIMEOUT_MILLISECONDS,
          killSignal: "SIGKILL",
          maxBuffer: maxBytes + CONTROLLER_INPUT_READER_BUFFER_OVERHEAD,
          shell: false,
          stdio: ["ignore", "pipe", "pipe", rootDescriptor, inputDescriptor],
          windowsHide: true,
        },
      );
      if (result.error !== undefined) {
        throw new Error("isolated controller input reader failed", { cause: result.error });
      }
      const success =
        result.status === 0 &&
        result.signal === null &&
        Buffer.isBuffer(result.stderr) &&
        result.stderr.length === 0;
      if (!success) {
        const classifiedMessage =
          result.status === 1 &&
          result.signal === null &&
          Buffer.isBuffer(result.stdout) &&
          result.stdout.length === 0 &&
          Buffer.isBuffer(result.stderr)
            ? controllerInputReaderFailureMessage(result.stderr)
            : undefined;
        throw new Error(
          classifiedMessage ?? "isolated controller input reader rejected operation-input-path",
        );
      }
      if (
        !Buffer.isBuffer(result.stdout) ||
        result.stdout.length !== selectedSize
      ) {
        throw new Error("isolated controller input reader returned invalid data");
      }
      return parseCanonicalControllerJson(result.stdout);
    } finally {
      closeSync(inputDescriptor);
    }
  } finally {
    closeSync(rootDescriptor);
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

function assertIsolatedReaderCapabilities() {
  if (!["darwin", "linux"].includes(process.platform)) {
    throw new Error("isolated controller input reading requires linux or darwin");
  }
  if (!isAbsolute(process.execPath) || !isAbsolute(CONTROLLER_INPUT_READER_PATH)) {
    throw new Error("isolated controller input reading requires absolute executables");
  }
  for (const name of ["O_NOFOLLOW", "O_DIRECTORY", "O_NONBLOCK"]) {
    const value = fsConstants[name];
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`isolated controller input reading requires ${name}`);
    }
  }
}

function runnerTempOpenFailure(error) {
  if (error !== null && typeof error === "object") {
    if (error.code === "ENOENT") {
      return new Error("RUNNER_TEMP became missing before open", { cause: error });
    }
    if (["EACCES", "EPERM"].includes(error.code)) {
      return new Error("RUNNER_TEMP became unreadable before open", { cause: error });
    }
    if (["ELOOP", "ENOTDIR"].includes(error.code)) {
      return new Error("RUNNER_TEMP traversal violated its directory access policy", {
        cause: error,
      });
    }
  }
  return new Error("RUNNER_TEMP could not be opened safely", { cause: error });
}

function operationInputOpenFailure(error) {
  if (error !== null && typeof error === "object") {
    if (error.code === "ENOENT") {
      return new Error("operation-input-path became missing before open", { cause: error });
    }
    if (["EACCES", "EPERM"].includes(error.code)) {
      return new Error("operation-input-path became unreadable before open", { cause: error });
    }
    if (["ELOOP", "ENOTDIR", "ENXIO"].includes(error.code)) {
      return new Error("operation-input-path violated its access policy before open", {
        cause: error,
      });
    }
  }
  return new Error("operation-input-path could not be opened safely", { cause: error });
}

function controllerInputReaderFailureMessage(stderr) {
  for (const [token, message] of CONTROLLER_INPUT_READER_FAILURES) {
    if (stderr.equals(token)) return message;
  }
  return undefined;
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

function assertSameInputObject(left, right, message) {
  if (
    left.dev !== right.dev ||
    left.ino !== right.ino ||
    (left.mode & 0o170000n) !== (right.mode & 0o170000n)
  ) {
    throw new Error(message);
  }
}

function parseCanonicalControllerJson(bytes) {
  const text = bytes.toString("utf8");
  if (!bytes.equals(Buffer.from(text, "utf8"))) {
    throw new Error("operation-input-path is not valid UTF-8 JSON");
  }
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
