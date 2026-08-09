import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatorPath = join(
  repositoryRoot,
  "scripts",
  "generate-action-release-provenance.mjs",
);
const decisionTablePath = join(
  repositoryRoot,
  "packages",
  "action",
  "decision-table.json",
);
const SOURCE_REPOSITORY = "JoeyTeng/codex-review-gate";
const ACTION_REPOSITORY = "JoeyTeng/codex-review-gate-action";
const RECEIPT_SCHEMA_ID =
  "urn:joeyteng:codex-review-gate:producer-receipt:1";
const UPLOAD_ARTIFACT_SHA =
  "ea165f8d65b6e75b540449e92b4886f43607fa02";
const testEnvironment = {
  ...process.env,
  CODEX_REVIEW_GATE_RELEASE_PROVENANCE_TEST_ONLY: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_TERMINAL_PROMPT: "0",
  NODE_ENV: "test",
};

function git(repo, args, { encoding = "utf8", input } = {}) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding,
    env: testEnvironment,
    input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
}

function gitText(repo, args, options = {}) {
  return git(repo, args, options).trim();
}

function initialiseRepository(path) {
  mkdirSync(path, { recursive: true });
  git(path, ["init", "-q", "--initial-branch=master"]);
  git(path, ["config", "user.name", "Release Fixture"]);
  git(path, ["config", "user.email", "release-fixture@example.invalid"]);
  git(path, ["config", "commit.gpgSign", "false"]);
  git(path, ["config", "tag.gpgSign", "false"]);
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function writeActionFixture(
  destination,
  {
    duplicateStatusContext = false,
    nonUtf8Path = false,
    placeholder = false,
    weakenDecisionPolicy = false,
    weakenPositiveConsumerRequirement = false,
  } = {},
) {
  const statusContextBlock = duplicateStatusContext
    ? `  status-context:\n    default: "codex/review-gate"\n  status-context:\n    default: "codex/review-gate"`
    : `  status-context:\n    default: "codex/review-gate"`;
  writeText(
    join(destination, "action.yml"),
    `name: Release fixture
inputs:
${statusContextBlock}
runs:
  using: composite
  steps:
    - name: Upload fixture
      uses: actions/upload-artifact@${UPLOAD_ARTIFACT_SHA}
`,
  );
  writeJson(join(destination, "package.json"), {
    name: "codex-review-gate-action",
    version: "1.4.0",
    private: true,
  });
  writeJson(join(destination, "producer-receipt.schema.json"), {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: RECEIPT_SCHEMA_ID,
    type: "object",
    additionalProperties: false,
    properties: {
      schema: { const: RECEIPT_SCHEMA_ID },
      schema_version: { const: 1 },
    },
  });
  if (placeholder || weakenDecisionPolicy || weakenPositiveConsumerRequirement) {
    const table = JSON.parse(readFileSync(decisionTablePath, "utf8"));
    if (placeholder) {
      table["<unresolved-release-placeholder>"] = "test-only-bad-key";
    }
    if (weakenDecisionPolicy) {
      table.evidence_rows.find(({ id }) => id === "clean-current").precondition =
        "weakened-test-only-precondition";
    }
    if (weakenPositiveConsumerRequirement) {
      table.producer_receipt_boundary.positive_consumer_requirement
        .selected_status.receipt_member_state = "pending";
    }
    writeJson(join(destination, "decision-table.json"), table);
  } else {
    copyFileSync(decisionTablePath, join(destination, "decision-table.json"));
  }
  writeText(join(destination, "src", "gate.mjs"), "export const fixture = true;\n");
  writeText(
    join(destination, "notes", "line\nbreak\tname.txt"),
    "NUL-safe path fixture\n",
  );
  void nonUtf8Path;
}

function stageNonUtf8Path(repo, prefix) {
  const blobOid = gitText(repo, ["hash-object", "-w", "--stdin"], {
    input: "invalid UTF-8 path fixture\n",
  });
  const rawPath = Buffer.concat([
    Buffer.from(`${prefix}notes/non-utf8-`, "utf8"),
    Buffer.from([0xff]),
  ]);
  const indexRecord = Buffer.concat([
    Buffer.from(`100644 blob ${blobOid}\t`, "ascii"),
    rawPath,
    Buffer.from([0]),
  ]);
  git(repo, ["update-index", "--add", "-z", "--index-info"], {
    encoding: null,
    input: indexRecord,
  });
  const index = git(repo, ["ls-files", "-z"], { encoding: null });
  assert.notEqual(index.indexOf(0xff), -1, `raw path was not staged: ${index.toString("hex")}`);
}

function commitAll(repo, message, { nonUtf8Prefix = null } = {}) {
  git(repo, ["add", "."]);
  if (nonUtf8Prefix !== null) {
    stageNonUtf8Path(repo, nonUtf8Prefix);
  }
  git(repo, ["commit", "-q", "-m", message]);
  return gitText(repo, ["rev-parse", "HEAD"]);
}

function createFixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "codex-review-gate-provenance-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourceRepo = join(root, "source");
  const actionRepo = join(root, "action");
  initialiseRepository(sourceRepo);
  initialiseRepository(actionRepo);

  writeJson(join(sourceRepo, "package.json"), {
    name: "codex-review-gate-source",
    version: "1.4.0",
    private: true,
  });
  writeActionFixture(join(sourceRepo, "packages", "action"), options);
  const sourceCommit = commitAll(sourceRepo, "source release", {
    nonUtf8Prefix: options.nonUtf8Path ? "packages/action/" : null,
  });

  writeActionFixture(actionRepo, options);
  const actionCommit = commitAll(actionRepo, "action split", {
    nonUtf8Prefix: options.nonUtf8Path ? "" : null,
  });
  for (const name of ["v1.4.0", "v1.4", "v1"]) {
    git(actionRepo, ["tag", "-a", name, actionCommit, "-m", `fixture ${name}`]);
  }

  return { root, sourceRepo, sourceCommit, actionRepo, actionCommit };
}

function generatorArguments(fixture, output, { testOnlySkip = true } = {}) {
  const arguments_ = [
    generatorPath,
    "--source-repo",
    fixture.sourceRepo,
    "--source-repository",
    SOURCE_REPOSITORY,
    "--source-commit",
    fixture.sourceCommit,
    "--source-default-ref",
    "refs/heads/master",
    "--action-repo",
    fixture.actionRepo,
    "--action-repository",
    ACTION_REPOSITORY,
    "--action-commit",
    fixture.actionCommit,
    "--action-default-ref",
    "refs/heads/master",
    "--immutable-tag-ref",
    "refs/tags/v1.4.0",
    "--minor-tag-ref",
    "refs/tags/v1.4",
    "--major-tag-ref",
    "refs/tags/v1",
    "--output",
    output,
  ];
  if (testOnlySkip) {
    arguments_.push("--test-only-skip-signature-verification");
  }
  return arguments_;
}

function runGenerator(args, environment = testEnvironment) {
  return spawnSync(process.execPath, args, {
    encoding: "utf8",
    env: environment,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("decision table freezes the release-1.4 verdict and receipt boundary", () => {
  const raw = readFileSync(decisionTablePath);
  const table = JSON.parse(raw.toString("utf8"));
  assert.equal(table.schema, "urn:joeyteng:codex-review-gate:decision-table:1");
  assert.equal(table.schema_version, 1);
  assert.equal(table.policy_version, "1.4.0");
  assert.deepEqual(
    table.status_precedence.map(({ state }) => state),
    ["failure", "error", "success", "pending"],
  );
  const rows = new Map(table.evidence_rows.map((row) => [row.id, row]));
  assert.equal(rows.size, table.evidence_rows.length);
  assert.equal(rows.get("clean-current").controlling_state, "success-after-final-stability");
  assert.equal(rows.get("clean-nonancestor").reducer_effect, "audit-ignore-and-reduce-remaining");
  assert.equal(rows.get("finding-thread-current-unresolved").precondition.endsWith("exactly false"), true);
  assert.equal(rows.get("finding-thread-current-resolved").precondition.endsWith("exactly true"), true);
  assert.equal(rows.get("final-reread-instability").controlling_state, "error");
  assert.equal(rows.get("overall-max-wait-expired").controlling_state, "failure");
  assert.equal(rows.has("progress-nonancestor"), false);
  assert.equal(rows.get("plus-one").controlling_state, "none");
  assert.match(table.finding_closure.strictly_later, /validated updated_at/);
  assert.match(table.finding_closure.strictly_later, /issue-comment IDs never break that tie/);
  assert.match(
    table.finding_closure.strictly_later,
    /larger canonical numeric ID breaks an equal-time tie only within that review channel/,
  );
  assert.equal(table.orchestration.initial_ack_seconds, 300);
  assert.equal(table.orchestration.ack_retry_cap_seconds, 1800);
  assert.equal(table.orchestration.result_deadline_seconds, 3600);
  assert.equal(table.orchestration.overall_max_wait_seconds, 7200);
  assert.equal(
    table.producer_receipt_boundary.run_attempt_api,
    "GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}",
  );
  assert.equal(
    table.producer_receipt_boundary.artifact_inventory_api,
    "GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts",
  );
  assert.equal(table.producer_receipt_boundary.status_get_by_id_api, null);
  assert.deepEqual(
    table.producer_receipt_boundary.positive_consumer_requirement,
    {
      operator: "all-of",
      execution: {
        result: "completed",
      },
      selected_status: {
        membership: "unique-rest-record-and-receipt-status-member",
        rest_record_state: "success",
        receipt_member_state: "success",
      },
    },
  );
  assert.doesNotMatch(raw.toString("utf8"), /<[^<>]+>/);
});

test("generator emits deterministic complete post-merge provenance", (t) => {
  const fixture = createFixture(t);
  const firstOutput = join(fixture.root, "v1.4.0-release-provenance.json");
  const first = runGenerator(generatorArguments(fixture, firstOutput));
  assert.equal(first.status, 0, first.stderr);

  const firstBytes = readFileSync(firstOutput);
  assert.match(first.stdout, new RegExp(`sha256:${digest(firstBytes)}`));
  const manifest = JSON.parse(firstBytes.toString("utf8"));
  const sourceActionTree = gitText(fixture.sourceRepo, [
    "rev-parse",
    `${fixture.sourceCommit}:packages/action`,
  ]);
  const actionTree = gitText(fixture.actionRepo, [
    "rev-parse",
    `${fixture.actionCommit}^{tree}`,
  ]);
  assert.equal(manifest.source.commit_oid, fixture.sourceCommit);
  assert.equal(manifest.source.action_subtree.tree_oid, sourceActionTree);
  assert.equal(manifest.action.commit_oid, fixture.actionCommit);
  assert.equal(manifest.action.tree_oid, actionTree);
  assert.equal(sourceActionTree, actionTree);
  assert.equal(manifest.proofs.source_subtree_equals_action_root, true);
  assert.equal(manifest.proofs.all_tag_signatures_verified, false);
  assert.equal(manifest.proofs.production_signature_verification_required, true);
  assert.equal(manifest.proofs.release_asset_is_signed_attestation, false);
  assert.equal(
    manifest.action.canonical_uses,
    `${ACTION_REPOSITORY}@${fixture.actionCommit}`,
  );
  assert.deepEqual(
    Object.values(manifest.tags).map((entry) => entry.peeled_commit_oid),
    [fixture.actionCommit, fixture.actionCommit, fixture.actionCommit],
  );
  assert.ok(
    Object.values(manifest.tags).every(
      (entry) => entry.annotated && entry.signature.method === "test-only-skip",
    ),
  );

  const rawTree = git(
    fixture.actionRepo,
    ["ls-tree", "-r", "-z", "--full-tree", fixture.actionCommit],
    { encoding: null },
  );
  assert.equal(manifest.released_tree.raw_sha256, digest(rawTree));
  assert.equal(
    manifest.released_tree.entry_count,
    manifest.released_tree.entries.length,
  );
  assert.ok(
    manifest.released_tree.entries.every(
      ({ mode, type, blob_oid }) =>
        /^[0-7]{6}$/.test(mode) &&
        type === "blob" &&
        /^[0-9a-f]{40}$/.test(blob_oid),
    ),
  );
  assert.ok(
    manifest.released_tree.entries.some(
      ({ path }) => path === "notes/line\nbreak\tname.txt",
    ),
  );
  for (const critical of Object.values(manifest.critical_files)) {
    const rawBlob = git(
      fixture.actionRepo,
      ["cat-file", "blob", critical.blob_oid],
      { encoding: null },
    );
    assert.equal(critical.raw_sha256, digest(rawBlob));
  }
  assert.equal(
    manifest.critical_files.decision_table.immutable_url,
    `https://github.com/${ACTION_REPOSITORY}/blob/${fixture.actionCommit}/decision-table.json`,
  );
  assert.equal(
    manifest.critical_files.decision_table.policy_version,
    "1.4.0",
  );
  assert.equal(
    manifest.critical_files.decision_table.frozen_admission_sha256,
    digest(readFileSync(decisionTablePath)),
  );
  assert.equal(
    manifest.contracts.producer_receipt.run_attempt_api.route,
    "/repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}",
  );
  assert.equal(
    manifest.contracts.producer_receipt.artifact_inventory_api.route,
    "/repos/{owner}/{repo}/actions/runs/{run_id}/artifacts",
  );
  assert.equal(
    manifest.contracts.producer_receipt.receipt_statuses.scope,
    "run-level-ordered-multi-pull-request",
  );
  assert.equal(
    manifest.contracts.producer_receipt.accepted_execution_result_for_positive_decision,
    "completed",
  );
  assert.deepEqual(
    manifest.contracts.producer_receipt.positive_consumer_requirement,
    {
      operator: "all-of",
      execution: {
        result: "completed",
      },
      selected_status: {
        membership: "unique-rest-record-and-receipt-status-member",
        rest_record_state: "success",
        receipt_member_state: "success",
      },
    },
  );
  assert.deepEqual(
    manifest.contracts.producer_receipt.artifact_inventory_api.required_output_bindings,
    [
      "producer-receipt-artifact-id",
      "producer-receipt-artifact-url",
      "producer-receipt-artifact-digest",
    ],
  );
  assert.equal(
    manifest.contracts.producer_receipt.artifact_inventory_api.expected_zip_member_count,
    1,
  );
  assert.ok(
    manifest.contracts.producer_receipt.artifact_inventory_api.required_metadata.includes(
      "digest",
    ),
  );
  assert.ok(
    manifest.contracts.producer_receipt.artifact_inventory_api.required_equalities.includes(
      "producer-receipt-artifact-id-equals-artifact-api-id",
    ),
  );
  assert.equal(manifest.contracts.status.rest.get_by_id_available, false);

  const secondOutput = join(fixture.root, "second-provenance.json");
  const second = runGenerator(generatorArguments(fixture, secondOutput));
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(readFileSync(secondOutput), firstBytes);
});

test("production generation rejects unsigned annotated tags", (t) => {
  const fixture = createFixture(t);
  const output = join(fixture.root, "unsigned.json");
  const result = runGenerator(
    generatorArguments(fixture, output, { testOnlySkip: false }),
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /signature verification failed/);
  assert.equal(existsSync(output), false);
});

test("production signature verification ignores a malicious repo-local GPG program", (t) => {
  const fixture = createFixture(t);
  const fakeGpg = join(fixture.root, "fake-gpg");
  writeText(
    fakeGpg,
    `#!/bin/sh
printf '%s\n' '[GNUPG:] GOODSIG 0123456789ABCDEF Fake Signer'
printf '%s\n' '[GNUPG:] VALIDSIG 0000000000000000000000000123456789ABCDEF 2026-08-09 0 0 0 0 0 0 00 0000000000000000000000000123456789ABCDEF'
exit 0
`,
  );
  chmodSync(fakeGpg, 0o755);
  git(fixture.actionRepo, ["config", "gpg.program", fakeGpg]);
  git(fixture.actionRepo, ["config", "gpg.openpgp.program", fakeGpg]);

  const output = join(fixture.root, "malicious-gpg.json");
  const result = runGenerator(
    generatorArguments(fixture, output, { testOnlySkip: false }),
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /signature verification failed/);
  assert.equal(existsSync(output), false);
});

test("generation rejects a semantic mutation that preserves decision row IDs", (t) => {
  const fixture = createFixture(t, { weakenDecisionPolicy: true });
  const output = join(fixture.root, "weakened-policy.json");
  const result = runGenerator(generatorArguments(fixture, output));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not match the reviewed frozen release policy/);
  assert.equal(existsSync(output), false);
});

test("generation rejects a weakened positive consumer status requirement", (t) => {
  const fixture = createFixture(t, {
    weakenPositiveConsumerRequirement: true,
  });
  const output = join(fixture.root, "weakened-positive-consumer.json");
  const result = runGenerator(generatorArguments(fixture, output));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /positive consumer contract contradicts release policy/);
  assert.equal(existsSync(output), false);
});

test("generation rejects a release tree that differs from the source subtree", (t) => {
  const fixture = createFixture(t);
  writeText(join(fixture.actionRepo, "unexpected.txt"), "not in source subtree\n");
  const actionCommit = commitAll(fixture.actionRepo, "divergent action tree");
  const output = join(fixture.root, "divergent.json");
  const result = runGenerator(
    generatorArguments({ ...fixture, actionCommit }, output),
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not equal action root tree/);
});

test("generation rejects nested tags and unresolved placeholders", async (t) => {
  await t.test("nested annotated tag", () => {
    const fixture = createFixture(t);
    git(fixture.actionRepo, [
      "tag",
      "-a",
      "v1.4.0-inner",
      fixture.actionCommit,
      "-m",
      "inner fixture",
    ]);
    git(fixture.actionRepo, [
      "tag",
      "-f",
      "-a",
      "v1.4.0",
      "refs/tags/v1.4.0-inner",
      "-m",
      "nested fixture",
    ]);
    const result = runGenerator(
      generatorArguments(fixture, join(fixture.root, "nested.json")),
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must be a direct annotated tag/);
  });

  await t.test("placeholder in decision table", () => {
    const fixture = createFixture(t, { placeholder: true });
    const result = runGenerator(
      generatorArguments(fixture, join(fixture.root, "placeholder.json")),
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /contains an unresolved placeholder/);
  });
});

test("generation rejects duplicate YAML keys and non-UTF8 release paths", async (t) => {
  await t.test("duplicate status-context", () => {
    const fixture = createFixture(t, { duplicateStatusContext: true });
    const result = runGenerator(
      generatorArguments(fixture, join(fixture.root, "duplicate-yaml.json")),
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /exactly one inputs block and one inputs\.status-context/);
  });

  await t.test("non-UTF8 path", () => {
    const fixture = createFixture(t, { nonUtf8Path: true });
    const rawTree = git(
      fixture.actionRepo,
      ["ls-tree", "-r", "-z", "--full-tree", fixture.actionCommit],
      { encoding: null },
    );
    assert.notEqual(
      rawTree.indexOf(0xff),
      -1,
      `fixture must contain a raw 0xff path byte: ${rawTree.toString("hex")}`,
    );
    const result = runGenerator(
      generatorArguments(fixture, join(fixture.root, "non-utf8.json")),
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /published action path is not canonical UTF-8/);
  });
});
