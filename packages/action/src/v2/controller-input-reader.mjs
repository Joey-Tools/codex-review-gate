import {
  chdir,
  cwd,
  execPath,
  platform,
} from "node:process";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  writeSync,
} from "node:fs";
import {
  basename,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

const RUNNER_TEMP_DESCRIPTOR = 3;
const INPUT_DESCRIPTOR = 4;
const FILE_TYPE_MASK = 0o170000n;
const FAILURE_PREFIX = "CODEX_CONTROLLER_READER_";
const MAX_OPERATION_INPUT_BYTES = 1024 * 1024;

class ReaderFailure extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.code = code;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

function main() {
  try {
    const [
      rootPath,
      selectedPath,
      maxBytesText,
      selectedSizeText,
      ...extraArguments
    ] = process.argv.slice(2);
    if (extraArguments.length !== 0) {
      throw failure(
        "INVALID_REQUEST",
        "isolated controller input reader received unexpected arguments",
      );
    }
    assertSupportedPlatform();
    assertInitialProcessState();
    const rootComponents = absoluteDirectoryComponents(rootPath);
    const inputComponents = selectedInputComponents(rootPath, selectedPath);
    const maxBytes = canonicalPositiveInteger(maxBytesText, "maximum input byte count");
    const selectedSize = canonicalPositiveInteger(
      selectedSizeText,
      "selected input byte count",
    );
    if (selectedSize > maxBytes) {
      throw failure(
        "INVALID_REQUEST",
        "selected input byte count exceeds the maximum input byte count",
      );
    }

    let anchoredRootStat;
    try {
      anchoredRootStat = fstatSync(RUNNER_TEMP_DESCRIPTOR, { bigint: true });
    } catch (error) {
      throw failure("UNREADABLE", "inherited RUNNER_TEMP descriptor is unreadable", {
        cause: error,
      });
    }
    if (!anchoredRootStat.isDirectory()) {
      throw failure(
        "ACCESS_POLICY",
        "inherited RUNNER_TEMP descriptor must identify a directory",
      );
    }

    let currentDirectoryStat;
    for (const component of rootComponents) {
      currentDirectoryStat = enterDirectory(component, "RUNNER_TEMP path component");
    }
    assertSameDirectoryObject(
      anchoredRootStat,
      currentDirectoryStat,
      "RUNNER_TEMP directory object changed during anchored traversal",
    );

    const leafName = inputComponents.at(-1);
    for (const component of inputComponents.slice(0, -1)) {
      enterDirectory(component, "operation-input-path parent");
    }
    const bytes = readStableInheritedLeaf(leafName, maxBytes, selectedSize);
    writeAll(1, bytes);
  } catch (error) {
    const code = error instanceof ReaderFailure ? error.code : "INTERNAL";
    writeAll(2, Buffer.from(`${FAILURE_PREFIX}${code}\n`, "ascii"));
    process.exitCode = 1;
  }
}

function failure(code, message, options) {
  return new ReaderFailure(code, message, options);
}

function assertSupportedPlatform() {
  if (!["darwin", "linux"].includes(platform)) {
    throw failure(
      "UNSUPPORTED",
      "isolated controller input reading requires linux or darwin",
    );
  }
  for (const name of ["O_NOFOLLOW", "O_DIRECTORY", "O_NONBLOCK"]) {
    const value = fsConstants[name];
    if (!Number.isInteger(value) || value <= 0) {
      throw failure(
        "UNSUPPORTED",
        `isolated controller input reading requires ${name}`,
      );
    }
  }
}

function assertInitialProcessState() {
  if (!isAbsolute(execPath) || cwd() !== sep) {
    throw failure(
      "INVALID_REQUEST",
      "isolated controller input reader must start from the filesystem root",
    );
  }
}

function absoluteDirectoryComponents(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !isAbsolute(value) ||
    resolve(value) !== value ||
    basename(value) === "" ||
    value.includes("\0")
  ) {
    throw failure(
      "INVALID_REQUEST",
      "isolated RUNNER_TEMP path must be canonical and absolute",
    );
  }
  const components = value.slice(sep.length).split(sep);
  if (components.some((component) => !isCanonicalComponent(component))) {
    throw failure(
      "INVALID_REQUEST",
      "isolated RUNNER_TEMP path has a non-canonical component",
    );
  }
  return components;
}

function selectedInputComponents(rootPath, selectedPath) {
  if (
    typeof selectedPath !== "string" ||
    selectedPath.length === 0 ||
    !isAbsolute(selectedPath) ||
    resolve(selectedPath) !== selectedPath ||
    basename(selectedPath) === "" ||
    selectedPath.includes("\0")
  ) {
    throw failure(
      "INVALID_REQUEST",
      "isolated operation-input-path must be canonical and absolute",
    );
  }
  const value = relative(rootPath, selectedPath);
  if (
    value === "" ||
    value === ".." ||
    value.startsWith(`..${sep}`) ||
    isAbsolute(value)
  ) {
    throw failure(
      "INVALID_REQUEST",
      "isolated operation-input-path must descend from RUNNER_TEMP",
    );
  }
  const components = value.split(sep);
  if (components.some((component) => !isCanonicalComponent(component))) {
    throw failure(
      "INVALID_REQUEST",
      "isolated operation-input-path has a non-canonical component",
    );
  }
  return components;
}

function isCanonicalComponent(value) {
  return value !== "" && value !== "." && value !== "..";
}

function canonicalPositiveInteger(value, label) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) {
    throw failure(
      "INVALID_REQUEST",
      `${label} must be a canonical positive integer`,
    );
  }
  const integer = Number(value);
  if (!Number.isSafeInteger(integer)) {
    throw failure("INVALID_REQUEST", `${label} exceeds the safe integer range`);
  }
  if (integer > MAX_OPERATION_INPUT_BYTES) {
    throw failure("INVALID_REQUEST", `${label} exceeds the isolated reader cap`);
  }
  return integer;
}

function enterDirectory(component, label) {
  let descriptor;
  try {
    descriptor = openSync(
      component,
      fsConstants.O_RDONLY |
        fsConstants.O_NONBLOCK |
        fsConstants.O_DIRECTORY |
        fsConstants.O_NOFOLLOW,
    );
  } catch (error) {
    throw pathOperationFailure(error, `${label} could not be opened`);
  }

  try {
    let openedStat;
    try {
      openedStat = fstatSync(descriptor, { bigint: true });
    } catch (error) {
      throw failure("UNREADABLE", `${label} became unreadable after open`, {
        cause: error,
      });
    }
    if (!openedStat.isDirectory()) {
      throw failure("ACCESS_POLICY", `${label} must identify a directory`);
    }
    try {
      chdir(component);
    } catch (error) {
      throw pathOperationFailure(error, `${label} could not become the current directory`);
    }
    let currentStat;
    try {
      currentStat = lstatSync(".", { bigint: true, throwIfNoEntry: false });
    } catch (error) {
      throw failure("UNREADABLE", `${label} became unreadable after traversal`, {
        cause: error,
      });
    }
    if (currentStat === undefined) {
      throw failure("MISSING", `${label} became missing after it was opened`);
    }
    assertSameDirectoryObject(
      openedStat,
      currentStat,
      `${label} directory object changed between open and traversal`,
    );
    return currentStat;
  } finally {
    closeSync(descriptor);
  }
}

function assertSameDirectoryObject(left, right, message) {
  if (
    !left.isDirectory() ||
    !right.isDirectory() ||
    left.dev !== right.dev ||
    left.ino !== right.ino ||
    fileType(left) !== fileType(right)
  ) {
    throw failure("IDENTITY", message);
  }
}

function pathOperationFailure(error, message) {
  if (error !== null && typeof error === "object") {
    if (error.code === "ENOENT") {
      return failure("MISSING", message, { cause: error });
    }
    if (["EACCES", "EPERM"].includes(error.code)) {
      return failure("UNREADABLE", message, { cause: error });
    }
    if (["ELOOP", "ENOTDIR"].includes(error.code)) {
      return failure("ACCESS_POLICY", message, { cause: error });
    }
  }
  return failure("UNREADABLE", message, { cause: error });
}

export function readStableInheritedLeaf(leafName, maxBytes, selectedSize) {
  const descriptor = INPUT_DESCRIPTOR;
  try {
    let openedStat;
    try {
      openedStat = fstatSync(descriptor, { bigint: true });
    } catch (error) {
      throw failure("UNREADABLE", "operation-input-path became unreadable after open", {
        cause: error,
      });
    }
    assertInputFileAccessPolicy(openedStat);
    const size = Number(openedStat.size);
    if (
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      size > maxBytes ||
      size !== selectedSize
    ) {
      throw failure(
        size !== selectedSize ? "CONTENT" : "SIZE_LIMIT",
        "inherited operation-input-path size differs from the selected size",
      );
    }

    const initialPathStat = relativeLeafStat(leafName, "before read");
    assertInputFileAccessPolicy(initialPathStat);
    assertSameObject(
      openedStat,
      initialPathStat,
      "operation-input-path was replaced before read",
    );
    assertSelectedSize(initialPathStat, selectedSize, "before read");

    const first = readExact(descriptor, size);
    const second = readExact(descriptor, size);
    if (!first.equals(second)) {
      throw failure("CONTENT", "operation-input-path content changed while it was read");
    }

    let finalOpenedStat;
    try {
      finalOpenedStat = fstatSync(descriptor, { bigint: true });
    } catch (error) {
      throw failure("UNREADABLE", "opened input object became unreadable", {
        cause: error,
      });
    }
    assertInputFileAccessPolicy(finalOpenedStat);
    assertSameObject(openedStat, finalOpenedStat, "opened input object was replaced");
    assertSelectedSize(finalOpenedStat, selectedSize, "while it was read");

    const finalPathStat = relativeLeafStat(leafName, "after read");
    assertInputFileAccessPolicy(finalPathStat);
    assertSameObject(openedStat, finalPathStat, "operation-input-path was replaced after open");
    assertSelectedSize(finalPathStat, selectedSize, "after read");
    return first;
  } finally {
    closeSync(descriptor);
  }
}

function relativeLeafStat(leafName, phase) {
  let stat;
  try {
    stat = lstatSync(leafName, { bigint: true, throwIfNoEntry: false });
  } catch (error) {
    throw failure("UNREADABLE", `operation-input-path became unreadable ${phase}`, {
      cause: error,
    });
  }
  if (stat === undefined) {
    throw failure("MISSING", `operation-input-path became missing ${phase}`);
  }
  return stat;
}

function assertSelectedSize(stat, selectedSize, phase) {
  if (stat.size !== BigInt(selectedSize)) {
    throw failure("CONTENT", `operation-input-path size changed ${phase}`);
  }
}

function assertInputFileAccessPolicy(stat) {
  if (!stat.isFile()) {
    throw failure("ACCESS_POLICY", "operation-input-path must identify a regular file");
  }
  if (stat.nlink !== 1n) {
    throw failure("ACCESS_POLICY", "operation-input-path must not be hard linked");
  }
  if ((Number(stat.mode) & 0o022) !== 0) {
    throw failure(
      "ACCESS_POLICY",
      "operation-input-path must not be group or world writable",
    );
  }
}

function assertSameObject(left, right, message) {
  if (
    left.dev !== right.dev ||
    left.ino !== right.ino ||
    fileType(left) !== fileType(right)
  ) {
    throw failure("IDENTITY", message);
  }
}

function fileType(stat) {
  return stat.mode & FILE_TYPE_MASK;
}

function readExact(descriptor, size) {
  const buffer = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    let count;
    try {
      count = readSync(descriptor, buffer, offset, size - offset, offset);
    } catch (error) {
      throw failure("UNREADABLE", "operation-input-path became unreadable during read", {
        cause: error,
      });
    }
    if (count === 0) {
      throw failure("CONTENT", "operation-input-path was truncated during read");
    }
    offset += count;
  }
  return buffer;
}

function writeAll(descriptor, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const count = writeSync(descriptor, bytes, offset, bytes.length - offset);
    if (count === 0) {
      throw failure("INTERNAL", "isolated controller input reader made no output progress");
    }
    offset += count;
  }
}
