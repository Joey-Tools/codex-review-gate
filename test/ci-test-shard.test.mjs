import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as shardTestSupport from "./support/ci-test-shard.mjs";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const bootstrapTestRelativePath = "test/bootstrap.test.mjs";
const releaseTestRelativePath = "test/v2-release-pipeline.test.mjs";
const shardAdapterIdentifier = ["create", "Sharded", "Test"].join("");
const removedTestAliasIdentifier = [
  "create",
  "Shard",
  "Adapter",
  "For",
  "Tests",
].join("");
const shardEnvironmentIdentifier = [
  "CODEX",
  "REVIEW",
  "GATE",
  "RELEASE",
  "TEST",
  "SHARD",
].join("_");
const bootstrapShardEnvironmentIdentifier = [
  "CODEX",
  "REVIEW",
  "GATE",
  "BOOTSTRAP",
  "TEST",
  "SHARD",
].join("_");
const createShardAdapterForContractTests = (
  shardTestSupport[shardAdapterIdentifier]
);
const { parseTestShard, testShardSelects } = shardTestSupport;
const ciWorkflow = readFileSync(
  join(repositoryRoot, ".github", "workflows", "ci.yml"),
  "utf8",
);
const testFileSources = readTestFileSources(repositoryRoot);
const bootstrapTestSource = testFileSources.get(bootstrapTestRelativePath);
const releaseTestSource = testFileSources.get(releaseTestRelativePath);
assert.equal(
  typeof bootstrapTestSource,
  "string",
  `${bootstrapTestRelativePath} must exist in the test inventory`,
);
assert.equal(
  typeof releaseTestSource,
  "string",
  `${releaseTestRelativePath} must exist in the test inventory`,
);
const coreTestRelativePaths = [
  "test/ci-test-shard.test.mjs",
  "test/core.test.mjs",
  "test/evidence-budget.test.mjs",
  "test/gate-runner.test.mjs",
  "test/organization-review-gate-handoff.test.mjs",
  "test/producer-receipt.test.mjs",
  "test/release-provenance.test.mjs",
  "test/required-ci-workflow.test.mjs",
  "test/v2-action.test.mjs",
  "test/v2-gate-runtime.test.mjs",
  "test/v2-workflow-contract.test.mjs",
  "test/workflow-security-contract.test.mjs",
];
const expectedSuites = [
  ["bootstrap 1/4", "bootstrap", "1/4", "off"],
  ["bootstrap 2/4", "bootstrap", "2/4", "off"],
  ["bootstrap 3/4", "bootstrap", "3/4", "off"],
  ["bootstrap 4/4", "bootstrap", "4/4", "off"],
  ["core", "core", "off", "off"],
  ["release 1/4", "release", "off", "1/4"],
  ["release 2/4", "release", "off", "2/4"],
  ["release 3/4", "release", "off", "3/4"],
  ["release 4/4", "release", "off", "4/4"],
];
const expectedReleaseSynchronousTestCalls = 103;
const expectedReleaseRegistrationCount = 159;
const expectedReleaseShardDistribution = [40, 40, 40, 39];
const expectedBootstrapSynchronousTestCalls = 164;
const expectedBootstrapShardDistribution = [41, 41, 41, 41];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function readTestFileSources(root) {
  const sources = new Map();

  function visit(directory) {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const relativePath = relative(root, path).split(sep).join("/");
      if (entry.isSymbolicLink() && entry.name.endsWith(".test.mjs")) {
        throw new Error(
          `test inventory cannot contain a symbolic-link test file: ${relativePath}`,
        );
      }
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile() && entry.name.endsWith(".test.mjs")) {
        sources.set(relativePath, readFileSync(path, "utf8"));
      }
    }
  }

  visit(join(root, "test"));
  return sources;
}

function assertShardIdentifierOwnership(sources) {
  for (const [identifier, expectedOwners] of [
    [shardAdapterIdentifier, [bootstrapTestRelativePath, releaseTestRelativePath]],
    [shardEnvironmentIdentifier, [releaseTestRelativePath]],
    [bootstrapShardEnvironmentIdentifier, [bootstrapTestRelativePath]],
    [removedTestAliasIdentifier, []],
  ]) {
    const owners = [...sources]
      .filter(([, source]) => source.includes(identifier))
      .map(([path]) => path);
    assert.deepEqual(
      owners,
      expectedOwners,
      `${identifier} has invalid test owners; found: ${owners.join(", ")}`,
    );
  }
}

function parseCiJobs(source) {
  const jobsMarker = /^jobs:\s*$/mu.exec(source);
  assert.ok(jobsMarker, "CI workflow must contain a jobs mapping");
  const jobsStart = jobsMarker.index + jobsMarker[0].length;
  const jobsSource = source.slice(jobsStart);
  const matches = [
    ...jobsSource.matchAll(/^  ([A-Za-z_][A-Za-z0-9_-]*):\s*$/gmu),
  ];
  assert.ok(matches.length > 0, "CI workflow must contain jobs");
  return new Map(matches.map((match, index) => {
    const start = jobsStart + match.index;
    const end = index + 1 < matches.length
      ? jobsStart + matches[index + 1].index
      : source.length;
    return [match[1], { source: source.slice(start, end), start, end }];
  }));
}

function namedStep(jobSource, name) {
  const marker = `      - name: ${name}\n`;
  assert.equal(
    jobSource.split(marker).length - 1,
    1,
    `job must contain exactly one ${name} step`,
  );
  const start = jobSource.indexOf(marker);
  const nextStep = /^      - /gmu;
  nextStep.lastIndex = start + marker.length;
  const nextMatch = nextStep.exec(jobSource);
  return jobSource.slice(start, nextMatch?.index ?? jobSource.length).trimEnd();
}

function matrixRootEntries(jobSource) {
  const markers = [...jobSource.matchAll(/^      matrix:\s*$/gmu)];
  assert.equal(markers.length, 1, "job must contain exactly one matrix mapping");
  const matrixStart = markers[0].index + markers[0][0].length;
  const remainingSource = jobSource.slice(matrixStart);
  const nextPeer = /^ {0,6}\S/gmu.exec(remainingSource);
  const matrixSource = remainingSource.slice(0, nextPeer?.index);
  return matrixSource.split("\n").filter((line) => (
    /^ {8}\S/u.test(line) && !/^ {8}#/u.test(line)
  ));
}

function assertCiJobContract(jobId, jobSource, nodeVersion, displayVersion) {
  assert.match(
    jobSource,
    new RegExp(
      `^    name: CI shard / Node\\.js${displayVersion} / \\$\\{\\{ matrix\\.suite\\.name \\}\\}$`,
      "mu",
    ),
    `${jobId} must expose the stable per-cell check name`,
  );
  assert.equal(
    [...jobSource.matchAll(/^    runs-on: (.+)$/gmu)].map((match) => match[1]).join(),
    "ubuntu-latest",
    `${jobId} must run on ubuntu-latest`,
  );
  assert.equal(
    [...jobSource.matchAll(/^    timeout-minutes: (.+)$/gmu)]
      .map((match) => match[1])
      .join(),
    "14",
    `${jobId} must bound every test shard`,
  );
  assert.equal(
    [...jobSource.matchAll(/^      fail-fast: (.+)$/gmu)].map((match) => match[1]).join(),
    "false",
    `${jobId} must preserve all matrix results`,
  );
  assert.deepEqual(
    matrixRootEntries(jobSource),
    ["        suite:"],
    `${jobId} matrix must contain only the canonical suite key`,
  );
  assert.deepEqual(
    [...jobSource.matchAll(
      /^          - name: (.+)\n            kind: (bootstrap|core|release)\n            bootstrap_test_shard: "([^"]+)"\n            release_test_shard: "([^"]+)"$/gmu,
    )].map((match) => [match[1], match[2], match[3], match[4]]),
    expectedSuites,
    `${jobId} must contain every bounded bootstrap, core, and release shard`,
  );
  assert.deepEqual(
    [...jobSource.matchAll(/^          node-version: "([^"]+)"$/gmu)].map(
      (match) => match[1],
    ),
    [nodeVersion],
    `${jobId} must bind setup-node to its declared Node version`,
  );

  assert.equal(
    namedStep(jobSource, "Run bootstrap test shard"),
    [
      "      - name: Run bootstrap test shard",
      "        if: ${{ matrix.suite.kind == 'bootstrap' }}",
      "        env:",
      `          ${bootstrapShardEnvironmentIdentifier}: `
        + "${{ matrix.suite.bootstrap_test_shard }}",
      "        run: node --test --test-concurrency=1 test/bootstrap.test.mjs",
    ].join("\n"),
    `${jobId} bootstrap shard contract drifted`,
  );
  assert.equal(
    namedStep(jobSource, "Run syntax and core tests"),
    [
      "      - name: Run syntax and core tests",
      "        if: ${{ matrix.suite.kind == 'core' }}",
      "        run: |",
      "          npm run check",
      `          node --test --test-concurrency=1 ${coreTestRelativePaths.join(" ")}`,
    ].join("\n"),
    `${jobId} non-bootstrap core contract drifted`,
  );
  assert.equal(
    namedStep(jobSource, "Run release pipeline shard"),
    [
      "      - name: Run release pipeline shard",
      "        if: ${{ matrix.suite.kind == 'release' }}",
      "        env:",
      `          ${shardEnvironmentIdentifier}: `
        + "${{ matrix.suite.release_test_shard }}",
      "        run: node --test test/v2-release-pipeline.test.mjs",
    ].join("\n"),
    `${jobId} release cell contract drifted`,
  );
}

function assertCiWorkflowContract(source) {
  const jobs = parseCiJobs(source);
  assert.deepEqual(
    [...jobs.keys()],
    ["test-node-20", "test-node-24"],
    "CI workflow must contain only the two declared Node matrix jobs",
  );
  assertCiJobContract("test-node-20", jobs.get("test-node-20").source, "20", "");
  assertCiJobContract("test-node-24", jobs.get("test-node-24").source, "24", " 24");
  assert.deepEqual(
    [...testFileSources.keys()].sort(),
    [
      bootstrapTestRelativePath,
      ...coreTestRelativePaths,
      releaseTestRelativePath,
    ].sort(),
    "the CI test inventory must assign every discoverable test file exactly once",
  );
  assert.doesNotMatch(source, /\bneeds:|\balways\(\)|aggregate/u);
}

function mutateCiJob(source, jobId, original, replacement) {
  const job = parseCiJobs(source).get(jobId);
  assert.ok(job, `missing fixture job ${jobId}`);
  assert.equal(
    job.source.split(original).length - 1,
    1,
    `${jobId} mutation fixture must occur exactly once`,
  );
  const mutatedJob = job.source.replace(original, replacement);
  return `${source.slice(0, job.start)}${mutatedJob}${source.slice(job.end)}`;
}

function assertReleaseRegistrationContract(source) {
  assert.deepEqual(
    source.split("\n").filter((line) => (
      line.includes("./support/ci-test-shard.mjs")
    )),
    [
      `import { ${shardAdapterIdentifier} } from "./support/ci-test-shard.mjs";`,
    ],
    "release suite must import the canonical shard adapter without an alias",
  );
  assert.deepEqual(
    source.split("\n").filter((line) => line.includes("node:test")),
    ['import nodeTest from "node:test";'],
    "release suite must use exactly one canonical node:test import",
  );
  assert.equal([...source.matchAll(/\bnodeTest\b/gu)].length, 2);
  assert.equal(
    [...source.matchAll(new RegExp(
      `\\b${escapeRegExp(shardAdapterIdentifier)}\\b`,
      "gu",
    ))].length,
    2,
  );
  assert.match(
    source,
    new RegExp(
      `const test = ${escapeRegExp(shardAdapterIdentifier)}\\(`
        + `\\s*nodeTest,\\s*process\\.env\\.${escapeRegExp(shardEnvironmentIdentifier)},`
        + "\\s*\"release pipeline\",\\s*\\);",
      "u",
    ),
  );
  assert.equal(
    [...source.matchAll(/^\s*test\(/gmu)].length,
    expectedReleaseSynchronousTestCalls,
  );
  assert.doesNotMatch(
    source,
    /\b(?:describe|it|suite)\s*(?:\(|\.|\[)|\b(?:nodeTest|test)\s*(?:\.(?:only|skip|todo)|\[)|\bt\.test\s*\(|\b(?:only|skip|todo)\s*:/mu,
    "release suite contains an unsupported registration form",
  );
  assert.doesNotMatch(
    source,
    /(?:^|[;\n])\s*(?:(?:const|let|var)\s+)?[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*test\s*(?:;|$)/mu,
    "release suite must not alias the canonical test adapter",
  );
  assert.match(
    source,
    new RegExp(
      `assert\\.equal\\(\\s*test\\.registeredCount,\\s*${expectedReleaseRegistrationCount},`
        + '\\s*"release pipeline shard registration inventory drift",?\\s*\\)',
      "u",
    ),
  );
}

function assertBootstrapRegistrationContract(source) {
  assert.deepEqual(
    source.split("\n").filter((line) => (
      line.includes("./support/ci-test-shard.mjs")
    )),
    [
      `import { ${shardAdapterIdentifier} } from "./support/ci-test-shard.mjs";`,
    ],
    "bootstrap suite must import the canonical shard adapter without an alias",
  );
  assert.deepEqual(
    source.split("\n").filter((line) => line.includes("node:test")),
    ['import nodeTest from "node:test";'],
    "bootstrap suite must use exactly one canonical node:test import",
  );
  assert.equal([...source.matchAll(/\bnodeTest\b/gu)].length, 2);
  assert.equal(
    [...source.matchAll(new RegExp(
      `\\b${escapeRegExp(shardAdapterIdentifier)}\\b`,
      "gu",
    ))].length,
    2,
  );
  assert.match(
    source,
    new RegExp(
      `const test = ${escapeRegExp(shardAdapterIdentifier)}\\(`
        + `\\s*nodeTest,\\s*process\\.env\\.${escapeRegExp(bootstrapShardEnvironmentIdentifier)},`
        + "\\s*\"bootstrap\",\\s*\\);",
      "u",
    ),
  );
  assert.equal(
    [...source.matchAll(/^\s*test\(/gmu)].length,
    expectedBootstrapSynchronousTestCalls,
  );
  assert.doesNotMatch(
    source,
    /^\s*(?:describe|it|suite)\s*(?:\(|\.|\[)|\b(?:nodeTest|test)\s*(?:\.(?:only|skip|todo)|\[)|\b(?:nodeTest|test)\s*\([^\n]*\b(?:only|skip|todo)\s*:|\bt\.test\s*\(/mu,
    "bootstrap suite contains an unsupported registration form",
  );
  assert.doesNotMatch(
    source,
    /(?:^|[;\n])\s*(?:(?:const|let|var)\s+)?[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*test\s*(?:;|$)/mu,
    "bootstrap suite must not alias the canonical test adapter",
  );
  assert.match(
    source,
    new RegExp(
      `assert\\.equal\\(\\s*test\\.registeredCount,\\s*${expectedBootstrapSynchronousTestCalls},`
        + '\\s*"bootstrap test shard registration inventory drift",?\\s*\\)',
      "u",
    ),
  );
}

test("release test shards partition every ordinal exactly once", () => {
  const shards = ["1/4", "2/4", "3/4", "4/4"].map(parseTestShard);
  assert.deepEqual(
    shards.map((shard) => (
      Array.from({ length: expectedReleaseRegistrationCount }, (_, ordinal) => ordinal)
        .filter((ordinal) => testShardSelects(shard, ordinal))
        .length
    )),
    expectedReleaseShardDistribution,
  );
  for (let ordinal = 0; ordinal < 257; ordinal += 1) {
    assert.equal(
      shards.filter((shard) => testShardSelects(shard, ordinal)).length,
      1,
      `ordinal ${ordinal}`,
    );
  }
  assert.equal(testShardSelects(parseTestShard(undefined), 0), true);
  assert.equal(testShardSelects(parseTestShard("off"), 0), false);
});

test("bootstrap test shards partition every ordinal exactly once", () => {
  const shards = ["1/4", "2/4", "3/4", "4/4"].map(parseTestShard);
  assert.deepEqual(
    shards.map((shard) => (
      Array.from({ length: expectedBootstrapSynchronousTestCalls }, (_, ordinal) => ordinal)
        .filter((ordinal) => testShardSelects(shard, ordinal))
        .length
    )),
    expectedBootstrapShardDistribution,
  );
  for (let ordinal = 0; ordinal < expectedBootstrapSynchronousTestCalls; ordinal += 1) {
    assert.equal(
      shards.filter((shard) => testShardSelects(shard, ordinal)).length,
      1,
      `bootstrap ordinal ${ordinal}`,
    );
  }
});

test("release test shard parsing rejects malformed or unsafe partitions", () => {
  for (const value of [
    "0/4",
    "1/0",
    "5/4",
    "",
    "1",
    "1 / 4",
    "9007199254740992/9007199254740992",
  ]) {
    assert.throws(() => parseTestShard(value), /invalid test shard/u, value);
  }
  assert.throws(
    () => testShardSelects(parseTestShard("1/4"), -1),
    /non-negative safe integer/u,
  );
});

test("the sharded test adapter preserves options and marks excluded tests", () => {
  const calls = [];
  const baseTest = (...arguments_) => {
    calls.push(arguments_);
    return arguments_[0];
  };
  const sharded = createShardAdapterForContractTests(baseTest, "2/2", "fixture");
  const first = () => {};
  const second = () => {};
  const third = () => {};

  sharded("first", first);
  sharded("second", { timeout: 1000 }, second);
  sharded("third", third);

  assert.deepEqual(calls[0].slice(0, 2), [
    "first",
    { skip: "fixture excluded by CI shard 2/2" },
  ]);
  assert.equal(calls[0][2], first);
  assert.deepEqual(calls[1], ["second", { timeout: 1000 }, second]);
  assert.deepEqual(calls[2].slice(0, 2), [
    "third",
    { skip: "fixture excluded by CI shard 2/2" },
  ]);
  assert.equal(calls[2][2], third);
  assert.equal(sharded.registeredCount, 3);
});

test("the sharded test adapter rejects inventory-escaping options", () => {
  for (const shard of ["1/1", "off"]) {
    for (const option of ["only", "skip", "todo"]) {
      const sharded = createShardAdapterForContractTests(
        () => {},
        shard,
        "fixture",
      );
      assert.throws(
        () => sharded("unsupported", { [option]: true }, () => {}),
        new RegExp(`does not support the ${option} option`, "u"),
      );
      assert.equal(sharded.registeredCount, 0);
    }
  }
});

test("the shard support module exposes no alternate factory alias", () => {
  assert.deepEqual(
    Object.entries(shardTestSupport)
      .filter(([name, value]) => (
        name !== shardAdapterIdentifier
          && value === createShardAdapterForContractTests
      ))
      .map(([name]) => name),
    [],
  );
});

test("reading registeredCount seals direct and aliased parent registrations", () => {
  let parentCallback;
  const baseTest = (name, optionsOrFunction, maybeFunction) => {
    if (name === "parent") {
      parentCallback = maybeFunction ?? optionsOrFunction;
    }
    return name;
  };
  const sharded = createShardAdapterForContractTests(
    baseTest,
    "1/1",
    "fixture",
  );
  const alias = sharded;

  sharded("parent", () => {
    alias("late child", () => {});
  });

  assert.equal(sharded.registeredCount, 1);
  assert.equal(typeof parentCallback, "function");
  assert.throws(
    () => sharded("late direct", () => {}),
    /fixture shard inventory is sealed/u,
  );
  assert.throws(
    () => parentCallback(),
    /fixture shard inventory is sealed/u,
  );
  assert.equal(sharded.registeredCount, 1);
});

test("the release suite exposes one closed synchronous shard inventory", () => {
  assert.equal(
    [...releaseTestSource.matchAll(new RegExp(
      escapeRegExp(shardEnvironmentIdentifier),
      "gu",
    ))].length,
    1,
  );
  assertReleaseRegistrationContract(releaseTestSource);
});

test("the bootstrap suite exposes one closed synchronous shard inventory", () => {
  assert.equal(
    [...bootstrapTestSource.matchAll(new RegExp(
      escapeRegExp(bootstrapShardEnvironmentIdentifier),
      "gu",
    ))].length,
    1,
  );
  assertBootstrapRegistrationContract(bootstrapTestSource);
});

test("only declared suites own shard adapter and environment identifiers", () => {
  assertShardIdentifierOwnership(testFileSources);
  const disallowedPath = [...testFileSources.keys()].find((path) => (
    path !== releaseTestRelativePath && path !== bootstrapTestRelativePath
  ));
  assert.ok(disallowedPath, "test inventory must contain an unsharded test file");

  for (const identifier of [
    shardAdapterIdentifier,
    shardEnvironmentIdentifier,
    bootstrapShardEnvironmentIdentifier,
    removedTestAliasIdentifier,
  ]) {
    const mutatedSources = new Map(testFileSources);
    mutatedSources.set(
      disallowedPath,
      `${mutatedSources.get(disallowedPath)}\nvoid ${identifier};\n`,
    );
    assert.throws(
      () => assertShardIdentifierOwnership(mutatedSources),
      new RegExp(escapeRegExp(disallowedPath), "u"),
      identifier,
    );
  }
});

test("test inventory fails closed on discoverable symbolic-link test files", (t) => {
  const root = mkdtempSync(join(tmpdir(), "ci-test-shard-inventory-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const testDirectory = join(root, "test");
  const target = join(root, "external-target.mjs");
  mkdirSync(testDirectory);
  writeFileSync(target, "export {};\n", "utf8");
  symlinkSync(target, join(testDirectory, "linked.test.mjs"));

  assert.throws(
    () => readTestFileSources(root),
    /symbolic-link test file: test\/linked\.test\.mjs/u,
  );
});

test("CI validates every bootstrap, core, and release matrix cell per Node job", () => {
  assertCiWorkflowContract(ciWorkflow);
});

test("CI contract rejects per-job condition, matrix, environment, or command drift", () => {
  for (const jobId of ["test-node-20", "test-node-24"]) {
    for (const [original, replacement] of [
      [
        "if: ${{ matrix.suite.kind == 'release' }}",
        "if: ${{ matrix.suite.kind == 'core' }}",
      ],
      [
        `${shardEnvironmentIdentifier}: `
          + "${{ matrix.suite.release_test_shard }}",
        `${shardEnvironmentIdentifier}: "off"`,
      ],
      [
        "run: node --test test/v2-release-pipeline.test.mjs",
        "run: node --test --test-concurrency=1 test/bootstrap.test.mjs",
      ],
      [
        "bootstrap_test_shard: \"4/4\"",
        "bootstrap_test_shard: \"off\"",
      ],
      [
        "if: ${{ matrix.suite.kind == 'bootstrap' }}",
        "if: ${{ matrix.suite.kind == 'release' }}",
      ],
      [
        `${bootstrapShardEnvironmentIdentifier}: `
          + "${{ matrix.suite.bootstrap_test_shard }}",
        `${bootstrapShardEnvironmentIdentifier}: "off"`,
      ],
    ]) {
      assert.throws(
        () => assertCiWorkflowContract(
          mutateCiJob(ciWorkflow, jobId, original, replacement),
        ),
        undefined,
        `${jobId}: ${original}`,
      );
    }
  }
});

test("CI contract rejects every non-suite matrix key in each Node job", () => {
  for (const jobId of ["test-node-20", "test-node-24"]) {
    for (const extraMatrixEntry of [
      "        platform: [ubuntu-latest]\n",
      "        include: []\n",
      "        exclude: []\n",
      "        \"include\": []\n",
    ]) {
      assert.throws(
        () => assertCiWorkflowContract(mutateCiJob(
          ciWorkflow,
          jobId,
          "      matrix:\n",
          `      matrix:\n${extraMatrixEntry}`,
        )),
        /matrix must contain only the canonical suite key/u,
        `${jobId}: ${extraMatrixEntry.trim()}`,
      );
    }
  }
});

test("release registration contract rejects alternate or suppressed tests", () => {
  const canonicalImport = `import { ${shardAdapterIdentifier} } from "./support/ci-test-shard.mjs";`;
  const aliasedFactorySource = releaseTestSource
    .replace(
      canonicalImport,
      `import { ${shardAdapterIdentifier} as buildShardedTest } from "./support/ci-test-shard.mjs";`,
    )
    .replace(
      `const test = ${shardAdapterIdentifier}(`,
      "const test = buildShardedTest(",
    );
  for (const mutatedSource of [
    releaseTestSource.replace(
      'import nodeTest from "node:test";',
      'import nodeTest, { it } from "node:test";',
    ),
    `${releaseTestSource}\ndescribe("unsharded", () => {});\n`,
    releaseTestSource.replace(/^test\(/mu, "test.skip("),
    releaseTestSource.replace(/^test\(([^\n]+), \(t\) => \{/mu, "test($1, { skip: true }, (t) => {"),
    `${releaseTestSource}\nconst alternateTest = test;\n`,
    aliasedFactorySource,
  ]) {
    assert.throws(() => assertReleaseRegistrationContract(mutatedSource));
  }
});

test("bootstrap registration contract rejects alternate or suppressed tests", () => {
  const canonicalImport = `import { ${shardAdapterIdentifier} } from "./support/ci-test-shard.mjs";`;
  const aliasedFactorySource = bootstrapTestSource
    .replace(
      canonicalImport,
      `import { ${shardAdapterIdentifier} as buildShardedTest } from "./support/ci-test-shard.mjs";`,
    )
    .replace(
      `const test = ${shardAdapterIdentifier}(`,
      "const test = buildShardedTest(",
    );
  for (const [fixtureIndex, mutatedSource] of [
    bootstrapTestSource.replace(
      'import nodeTest from "node:test";',
      'import nodeTest, { it } from "node:test";',
    ),
    `${bootstrapTestSource}\nnodeTest("unsharded", () => {});\n`,
    `${bootstrapTestSource}\ndescribe("unsharded", () => {});\n`,
    bootstrapTestSource.replace(/^test\(/mu, "test.skip("),
    bootstrapTestSource.replace(/^test\(([^,\n]+), /mu, "test($1, { skip: true }, "),
    `${bootstrapTestSource}\nconst alternateTest = test;\n`,
    aliasedFactorySource,
  ].entries()) {
    assert.throws(
      () => assertBootstrapRegistrationContract(mutatedSource),
      undefined,
      `bootstrap registration fixture ${fixtureIndex}`,
    );
  }
});
