import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createShardedTest,
  parseTestShard,
  testShardSelects,
} from "./support/ci-test-shard.mjs";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const ciWorkflow = readFileSync(
  join(repositoryRoot, ".github", "workflows", "ci.yml"),
  "utf8",
);
const releaseTestPath = join(repositoryRoot, "test", "v2-release-pipeline.test.mjs");
const releaseTestSource = readFileSync(releaseTestPath, "utf8");

test("release test shards partition every ordinal exactly once", () => {
  const shards = ["1/4", "2/4", "3/4", "4/4"].map(parseTestShard);
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
  const sharded = createShardedTest(baseTest, "2/2", "fixture");
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

test("the release suite exposes one closed synchronous shard inventory", () => {
  assert.equal(
    [...releaseTestSource.matchAll(/CODEX_REVIEW_GATE_RELEASE_TEST_SHARD/gu)]
      .length,
    1,
  );
  assert.equal([...releaseTestSource.matchAll(/\bnodeTest\b/gu)].length, 2);
  assert.doesNotMatch(
    releaseTestSource,
    /\b(?:nodeTest|test)\.(?:only|skip|todo)\b|\bt\.test\s*\(/u,
  );
  assert.match(
    releaseTestSource,
    /assert\.equal\(\s*test\.registeredCount,\s*131,\s*"release pipeline shard registration inventory drift",?\s*\)/u,
  );
});

test("CI runs four uniquely named release shards per Node version", () => {
  assert.deepEqual(
    [...ciWorkflow.matchAll(/^\s+release-test-shard: "([^"]+)"$/gmu)].map(
      (match) => match[1],
    ),
    [
      "off",
      "1/4",
      "2/4",
      "3/4",
      "4/4",
      "off",
      "1/4",
      "2/4",
      "3/4",
      "4/4",
    ],
  );
  assert.deepEqual(
    [...ciWorkflow.matchAll(/^\s+node-version: "([^"]+)"$/gmu)].map(
      (match) => match[1],
    ),
    ["20", "24"],
  );
  assert.match(ciWorkflow, /fail-fast: false/u);
  assert.match(
    ciWorkflow,
    /CODEX_REVIEW_GATE_RELEASE_TEST_SHARD: \$\{\{ matrix\.suite\.release-test-shard \}\}/u,
  );
  assert.match(
    ciWorkflow,
    /run: node --test test\/v2-release-pipeline\.test\.mjs/u,
  );
  assert.equal(
    [...ciWorkflow.matchAll(/^\s+npm test -- --test-concurrency=1$/gmu)]
      .length,
    2,
  );
  assert.match(
    ciWorkflow,
    /name: CI shard \/ Node\.js \/ \$\{\{ matrix\.suite\.name \}\}/u,
  );
  assert.match(
    ciWorkflow,
    /name: CI shard \/ Node\.js 24 \/ \$\{\{ matrix\.suite\.name \}\}/u,
  );
  assert.doesNotMatch(ciWorkflow, /\bneeds:|\balways\(\)|aggregate/u);
});
