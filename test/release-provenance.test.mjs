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
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseVerifiedOpenPgpStatus,
  writeManifest,
} from "../scripts/generate-action-release-provenance.mjs";

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
const receiptSchemaPath = join(
  repositoryRoot,
  "packages",
  "action",
  "producer-receipt.schema.json",
);
const actionDefinitionPath = join(
  repositoryRoot,
  "packages",
  "action",
  "action.yml",
);
const SOURCE_REPOSITORY = "JoeyTeng/codex-review-gate";
const ACTION_REPOSITORY = "JoeyTeng/codex-review-gate-action";
const RELEASE = "1.5.0";
const PROVENANCE_SCHEMA_ID =
  "urn:joeyteng:codex-review-gate:release-provenance:2";
const RECEIPT_SCHEMA_ID =
  "urn:joeyteng:codex-review-gate:producer-receipt:1";
const DECISION_TABLE_SCHEMA_ID =
  "urn:joeyteng:codex-review-gate:decision-table:1";
const REUSABLE_WORKFLOW_PATH = ".github/workflows/codex-review-gate.yml";
const reusableWorkflowPath = join(
  repositoryRoot,
  "packages",
  "action",
  REUSABLE_WORKFLOW_PATH,
);
const REUSABLE_WORKFLOW_REFERENCE =
  `${ACTION_REPOSITORY}/${REUSABLE_WORKFLOW_PATH}@v1`;
const REUSABLE_WORKFLOW_CHECKOUT_PATH = ".codex-review-gate-action";
const REUSABLE_WORKFLOW_LOCAL_ACTION_USE =
  `./${REUSABLE_WORKFLOW_CHECKOUT_PATH}`;
const CHECKOUT_SHA =
  "11d5960a326750d5838078e36cf38b85af677262";
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

function replaceRequired(text, expected, replacement, label) {
  assert.notEqual(text.indexOf(expected), -1, `${label} fixture target is missing`);
  return text.replace(expected, replacement);
}

function writeActionFixture(
  destination,
  {
    duplicateStatusContext = false,
    nonUtf8Path = false,
    placeholder = false,
    conflateRunAndPullRequestHeads = false,
    anchorCheckoutAlias = false,
    extraExternalAction = false,
    flowExternalUse = false,
    floatingCheckout = false,
    mutateReceiptSchema = false,
    mutatePolicyMajor = false,
    mutateRerunContract = false,
    mutateTagDriftContract = false,
    wrongCalledPath = false,
    wrongCalledRef = false,
    wrongCalledRepository = false,
    wrongCalledShaBinding = false,
    wrongCheckoutPath = false,
    wrongCheckoutRef = false,
    wrongCheckoutRepository = false,
    wrongLocalActionUse = false,
    persistCheckoutCredentials = false,
    quotedExternalUse = false,
    weakenDecisionPolicy = false,
    weakenPositiveConsumerRequirement = false,
  } = {},
) {
  let actionDefinition = readFileSync(actionDefinitionPath, "utf8");
  if (duplicateStatusContext) {
    actionDefinition = replaceRequired(
      actionDefinition,
      "  status-context:\n",
      "  status-context:\n  status-context:\n",
      "duplicate status-context",
    );
  }
  writeText(
    join(destination, "action.yml"),
    actionDefinition,
  );
  let reusableWorkflow = readFileSync(reusableWorkflowPath, "utf8");
  const replacements = [
    [
      floatingCheckout,
      `actions/checkout@${CHECKOUT_SHA}`,
      "actions/checkout@v4",
      "floating checkout",
    ],
    [
      wrongCheckoutRepository,
      "repository: ${{ job.workflow_repository }}",
      "repository: ${{ github.repository }}",
      "checkout repository",
    ],
    [
      wrongCheckoutRef,
      "ref: ${{ job.workflow_sha }}",
      "ref: ${{ github.sha }}",
      "checkout ref",
    ],
    [
      wrongCheckoutPath,
      `path: ${REUSABLE_WORKFLOW_CHECKOUT_PATH}`,
      "path: .wrong-action-path",
      "checkout path",
    ],
    [
      persistCheckoutCredentials,
      "persist-credentials: false",
      "persist-credentials: true",
      "checkout credentials",
    ],
    [
      wrongLocalActionUse,
      `uses: ${REUSABLE_WORKFLOW_LOCAL_ACTION_USE}`,
      "uses: ./evil",
      "local action path",
    ],
  ];
  for (const [enabled, expected, replacement, label] of replacements) {
    if (enabled) {
      reusableWorkflow = replaceRequired(
        reusableWorkflow,
        expected,
        replacement,
        label,
      );
    }
  }
  if (anchorCheckoutAlias) {
    reusableWorkflow = replaceRequired(
      reusableWorkflow,
      "      - name: Check out exact called-workflow release\n",
      "      - &checkout-step\n        name: Check out exact called-workflow release\n",
      "checkout anchor",
    );
    reusableWorkflow += "      - *checkout-step\n";
  }
  if (extraExternalAction) {
    reusableWorkflow += `      - name: Unexpected external runtime dependency
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
`;
  }
  if (flowExternalUse) {
    reusableWorkflow +=
      "      - { uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 }\n";
  }
  if (quotedExternalUse) {
    reusableWorkflow +=
      "      - 'uses': actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020\n";
  }
  writeText(join(destination, REUSABLE_WORKFLOW_PATH), reusableWorkflow);
  writeJson(join(destination, "package.json"), {
    name: "codex-review-gate-action",
    version: RELEASE,
    private: true,
  });
  if (mutateReceiptSchema) {
    const schema = JSON.parse(readFileSync(receiptSchemaPath, "utf8"));
    schema.additionalProperties = true;
    writeJson(join(destination, "producer-receipt.schema.json"), schema);
  } else {
    copyFileSync(
      receiptSchemaPath,
      join(destination, "producer-receipt.schema.json"),
    );
  }
  if (
    placeholder ||
    conflateRunAndPullRequestHeads ||
    mutatePolicyMajor ||
    mutateRerunContract ||
    mutateTagDriftContract ||
    wrongCalledPath ||
    wrongCalledRef ||
    wrongCalledRepository ||
    wrongCalledShaBinding ||
    weakenDecisionPolicy ||
    weakenPositiveConsumerRequirement
  ) {
    const table = JSON.parse(readFileSync(decisionTablePath, "utf8"));
    if (placeholder) {
      table["<unresolved-release-placeholder>"] = "test-only-bad-key";
    }
    if (weakenDecisionPolicy) {
      table.evidence_rows.find(({ id }) => id === "clean-current").precondition =
        "weakened-test-only-precondition";
    }
    if (conflateRunAndPullRequestHeads) {
      table.producer_receipt_boundary.run_attempt_identity.required_equalities = [
        "id-equals-receipt-producer-run-id",
        "run_attempt-equals-receipt-producer-run-attempt",
        "repository-full_name-equals-receipt-producer-repository",
        "head_sha-equals-selected-receipt-status-head_sha",
      ];
    }
    if (weakenPositiveConsumerRequirement) {
      table.producer_receipt_boundary.positive_consumer_requirement
        .selected_status.receipt_member_state = "pending";
    }
    if (mutatePolicyMajor) {
      table.policy_major = 2;
    }
    if (mutateRerunContract) {
      table.producer_receipt_boundary.run_attempt_identity.referenced_workflows
        .rerun_resolution = "allow-current-v1-substitution";
    }
    if (mutateTagDriftContract) {
      table.producer_receipt_boundary.run_attempt_identity.referenced_workflows
        .tag_drift = "follow-current-v1-target";
    }
    if (wrongCalledRepository) {
      table.producer_receipt_boundary.called_workflow_authority.repository =
        "Mallory/codex-review-gate-action";
    }
    if (wrongCalledPath) {
      table.producer_receipt_boundary.called_workflow_authority
        .workflow_file_path = ".github/workflows/wrong.yml";
    }
    if (wrongCalledRef) {
      table.producer_receipt_boundary.run_attempt_identity.referenced_workflows
        .expected_ref = "refs/heads/v1";
    }
    if (wrongCalledShaBinding) {
      table.producer_receipt_boundary.run_attempt_identity.referenced_workflows
        .required_equalities[2] = "selected-sha-follows-current-v1-target";
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
    version: RELEASE,
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
  for (const name of ["v1.5.0", "v1.5", "v1"]) {
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
    "refs/tags/v1.5.0",
    "--minor-tag-ref",
    "refs/tags/v1.5",
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

test("decision table freezes the 1.4 verdict and 1.5 producer boundary", () => {
  const raw = readFileSync(decisionTablePath);
  const table = JSON.parse(raw.toString("utf8"));
  assert.equal(table.schema, DECISION_TABLE_SCHEMA_ID);
  assert.equal(table.schema_version, 1);
  assert.equal(table.policy_major, 1);
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
  assert.equal(table.producer_receipt_boundary.producer_protocol_major, 1);
  assert.equal(
    table.producer_receipt_boundary.canonical_reusable_workflow_reference,
    REUSABLE_WORKFLOW_REFERENCE,
  );
  assert.equal(table.producer_receipt_boundary.caller_selector, "v1");
  assert.deepEqual(
    table.producer_receipt_boundary.run_attempt_identity,
    {
      head_role: "caller-workflow-event-commit",
      required_equalities: [
        "id-equals-receipt-producer-run-id",
        "run_attempt-equals-receipt-producer-run-attempt",
        "repository-full_name-equals-receipt-producer-repository",
      ],
      referenced_workflows: {
        field: "referenced_workflows",
        availability:
          "optional-nullable-upstream-but-required-non-null-for-this-reusable-workflow-contract",
        selection: "exactly-one-exact-called-workflow-member",
        expected_path: REUSABLE_WORKFLOW_REFERENCE,
        expected_ref: "refs/tags/v1",
        required_equalities: [
          `selected-path-equals-${REUSABLE_WORKFLOW_REFERENCE}`,
          "selected-ref-equals-refs/tags/v1",
          "selected-sha-equals-receipt-producer-job-workflow_sha",
          "selected-sha-equals-validated-release-provenance-action-commit_oid",
          "selected-path-repository-and-file-equal-receipt-producer-job-workflow_repository-and-workflow_file_path",
        ],
        rerun_resolution:
          "Validate referenced_workflows from the exact receipt run attempt; never substitute the current v1 target or evidence from another attempt.",
        tag_drift:
          "A later v1 move does not change the exact called-workflow SHA recorded for an earlier run attempt.",
        authority:
          "run-level-attempt-corroboration-only-no-job-callsite-or-receipt-cryptographic-binding",
      },
    },
  );
  assert.deepEqual(
    table.producer_receipt_boundary.called_workflow_authority,
    {
      availability: "github.com-only-job-context",
      repository: ACTION_REPOSITORY,
      workflow_file_path: REUSABLE_WORKFLOW_PATH,
      caller_selector: "v1",
      caller_ref: "refs/tags/v1",
      caller_identity_role:
        "producer.environment.GITHUB_WORKFLOW_REF/SHA-identifies-caller-workflow-file",
      called_job_identity_role:
        "producer.job.workflow_ref/SHA/repository/file_path-identifies-workflow-file-defining-current-job",
      required_equalities: [
        `receipt-producer-job-workflow_repository-equals-${ACTION_REPOSITORY}`,
        `receipt-producer-job-workflow_file_path-equals-${REUSABLE_WORKFLOW_PATH}`,
        `receipt-producer-job-workflow_ref-equals-${ACTION_REPOSITORY}/${REUSABLE_WORKFLOW_PATH}@refs/tags/v1`,
        "receipt-producer-job-workflow_sha-is-lower-case-40-hex",
        "receipt-producer-job-workflow_sha-equals-validated-release-provenance-action-commit_oid",
        "receipt-producer-action-repository-equals-receipt-producer-job-workflow_repository",
        "receipt-producer-action-ref-equals-receipt-producer-job-workflow_sha",
        "receipt-producer-action-commit_sha-equals-receipt-producer-job-workflow_sha",
        "receipt-producer-action-immutable-is-true",
      ],
      caller_called_sha_domain_separation:
        "GITHUB_WORKFLOW_SHA identifies the caller workflow file and must not be required to equal producer.job.workflow_sha for a reusable invocation.",
    },
  );
  assert.equal(
    table.producer_receipt_boundary.head_domain_separation
      .workflow_run_head_may_differ_from_status_and_pull_request_head,
    true,
  );
  assert.deepEqual(
    table.producer_receipt_boundary.head_domain_separation
      .consumer_must_not_require,
    [
      "exact-run-attempt-head_sha-equals-selected-receipt-status-head_sha",
      "artifact-api-workflow_run-head_sha-equals-selected-receipt-status-head_sha",
      "exact-run-attempt-head_sha-equals-receipt-producer-environment-GITHUB_WORKFLOW_SHA",
      "receipt-producer-environment-GITHUB_WORKFLOW_SHA-equals-receipt-producer-job-workflow_sha",
    ],
  );
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

test("head domains separate run, caller, called workflow, and PR status", () => {
  const table = JSON.parse(readFileSync(decisionTablePath, "utf8"));
  const workflowRunHead = "1".repeat(40);
  const currentPullRequestHead = "2".repeat(40);
  const callerWorkflowSha = "3".repeat(40);
  const calledWorkflowSha = "4".repeat(40);
  const receipt = {
    producer: {
      environment: { GITHUB_WORKFLOW_SHA: callerWorkflowSha },
      job: { workflow_sha: calledWorkflowSha },
    },
    statuses: [{ head_sha: currentPullRequestHead }],
  };
  const exactRunAttempt = {
    head_sha: workflowRunHead,
    referenced_workflows: [{ sha: calledWorkflowSha }],
  };
  const artifact = { workflow_run: { head_sha: workflowRunHead } };
  const restStatusListRequest = { ref: currentPullRequestHead };
  const graphQlStatusContext = { commit: { oid: currentPullRequestHead } };

  assert.notEqual(exactRunAttempt.head_sha, callerWorkflowSha);
  assert.notEqual(callerWorkflowSha, calledWorkflowSha);
  assert.equal(
    exactRunAttempt.referenced_workflows[0].sha,
    receipt.producer.job.workflow_sha,
  );
  assert.equal(artifact.workflow_run.head_sha, exactRunAttempt.head_sha);
  assert.equal(receipt.statuses[0].head_sha, currentPullRequestHead);
  assert.equal(restStatusListRequest.ref, currentPullRequestHead);
  assert.equal(graphQlStatusContext.commit.oid, currentPullRequestHead);
  assert.notEqual(exactRunAttempt.head_sha, receipt.statuses[0].head_sha);
  assert.equal(
    table.producer_receipt_boundary.head_domain_separation
      .workflow_run_head_may_differ_from_status_and_pull_request_head,
    true,
  );
});

test("generator emits deterministic complete post-merge provenance", (t) => {
  const fixture = createFixture(t);
  const firstOutput = join(fixture.root, "v1.5.0-release-provenance.json");
  const first = runGenerator(generatorArguments(fixture, firstOutput));
  assert.equal(first.status, 0, first.stderr);

  const firstBytes = readFileSync(firstOutput);
  assert.match(first.stdout, new RegExp(`sha256:${digest(firstBytes)}`));
  const manifest = JSON.parse(firstBytes.toString("utf8"));
  assert.equal(manifest.schema, PROVENANCE_SCHEMA_ID);
  assert.equal(manifest.schema_version, 2);
  assert.equal(manifest.release, RELEASE);
  assert.deepEqual(manifest.compatibility, {
    producer_protocol_major: 1,
    github_immutable_release_required: true,
    receipt_schema: {
      schema_id: RECEIPT_SCHEMA_ID,
      schema_version: 1,
    },
    decision_table: {
      schema_id: DECISION_TABLE_SCHEMA_ID,
      schema_version: 1,
      policy_major: 1,
      policy_version: "1.4.0",
    },
    called_workflow: {
      repository: ACTION_REPOSITORY,
      path: REUSABLE_WORKFLOW_PATH,
      caller_selector: "v1",
    },
  });
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
  assert.equal(manifest.proofs.revocation_freshness_checked, false);
  assert.equal(manifest.proofs.runtime_external_action_set_closed, true);
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
      (entry) =>
        entry.annotated &&
        entry.signature.method === "test-only-skip" &&
        entry.signature.signing_key_fingerprint === null &&
        entry.signature.primary_key_fingerprint === null,
    ),
  );
  assert.deepEqual(Object.keys(manifest.tags), ["v1.5.0", "v1.5", "v1"]);
  const expectedSourceCheckout = {
    uses: `actions/checkout@${CHECKOUT_SHA}`,
    repository: "${{ job.workflow_repository }}",
    ref: "${{ job.workflow_sha }}",
    path: REUSABLE_WORKFLOW_CHECKOUT_PATH,
    persist_credentials: false,
  };
  assert.deepEqual(
    manifest.runtime_closure.source_checkout,
    expectedSourceCheckout,
  );
  assert.deepEqual(manifest.runtime_closure.local_action_use, {
    release_path: REUSABLE_WORKFLOW_PATH,
    source_path: `packages/action/${REUSABLE_WORKFLOW_PATH}`,
    uses: REUSABLE_WORKFLOW_LOCAL_ACTION_USE,
  });
  assert.deepEqual(manifest.runtime_closure.external_actions, [
    {
      release_path: REUSABLE_WORKFLOW_PATH,
      source_path: `packages/action/${REUSABLE_WORKFLOW_PATH}`,
      uses: `actions/checkout@${CHECKOUT_SHA}`,
      repository: "actions/checkout",
      commit_sha: CHECKOUT_SHA,
    },
    {
      release_path: "action.yml",
      source_path: "packages/action/action.yml",
      uses: `actions/upload-artifact@${UPLOAD_ARTIFACT_SHA}`,
      repository: "actions/upload-artifact",
      commit_sha: UPLOAD_ARTIFACT_SHA,
    },
  ]);
  assert.deepEqual(manifest.runtime_closure.called_workflow, {
    repository: ACTION_REPOSITORY,
    caller_selector: "v1",
    caller_reference: REUSABLE_WORKFLOW_REFERENCE,
    immutable_reference:
      `${ACTION_REPOSITORY}/${REUSABLE_WORKFLOW_PATH}@${fixture.actionCommit}`,
    resolved_commit_oid: fixture.actionCommit,
    release_path: REUSABLE_WORKFLOW_PATH,
    source_path: `packages/action/${REUSABLE_WORKFLOW_PATH}`,
    blob_oid: manifest.critical_files.reusable_workflow.blob_oid,
    raw_sha256: manifest.critical_files.reusable_workflow.raw_sha256,
  });

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
  assert.equal(manifest.critical_files.decision_table.policy_major, 1);
  assert.equal(
    manifest.critical_files.decision_table.frozen_admission_sha256,
    digest(readFileSync(decisionTablePath)),
  );
  assert.equal(
    manifest.critical_files.producer_receipt_schema.frozen_admission_sha256,
    digest(readFileSync(receiptSchemaPath)),
  );
  assert.equal(
    manifest.critical_files.action_definition.frozen_admission_sha256,
    digest(readFileSync(actionDefinitionPath)),
  );
  assert.equal(
    manifest.critical_files.reusable_workflow.frozen_admission_sha256,
    digest(readFileSync(reusableWorkflowPath)),
  );
  assert.equal(
    manifest.contracts.producer_receipt.run_attempt_api.route,
    "/repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}",
  );
  assert.deepEqual(
    manifest.contracts.producer_receipt.run_attempt_api.required_equalities,
    [
      "id-equals-receipt-producer-run-id",
      "run_attempt-equals-receipt-producer-run-attempt",
      "repository-full_name-equals-receipt-producer-repository",
    ],
  );
  assert.deepEqual(
    manifest.contracts.producer_receipt.run_attempt_api.referenced_workflows,
    {
      field: "referenced_workflows",
      availability:
        "optional-nullable-upstream-but-required-non-null-for-this-reusable-workflow-contract",
      selection: "exactly-one-exact-called-workflow-member",
      expected_path: REUSABLE_WORKFLOW_REFERENCE,
      expected_ref: "refs/tags/v1",
      expected_sha: fixture.actionCommit,
      required_equalities: [
        `selected-path-equals-${REUSABLE_WORKFLOW_REFERENCE}`,
        "selected-ref-equals-refs/tags/v1",
        "selected-sha-equals-receipt-producer-job-workflow_sha",
        "selected-sha-equals-validated-release-provenance-action-commit_oid",
        "selected-path-repository-and-file-equal-receipt-producer-job-workflow_repository-and-workflow_file_path",
      ],
      rerun_resolution:
        "exact-receipt-run-attempt-only-no-current-selector-substitution",
      tag_drift:
        "later-v1-movement-does-not-change-historical-attempt-sha",
      authority:
        "run-level-attempt-corroboration-only-no-job-callsite-or-receipt-cryptographic-binding",
    },
  );
  assert.equal(
    manifest.contracts.producer_receipt.called_workflow_authority.accepted_resolved_sha,
    fixture.actionCommit,
  );
  assert.deepEqual(
    manifest.contracts.producer_receipt.exact_action_bindings,
    [
      "producer.action.repository-equals-producer.job.workflow_repository",
      "producer.action.ref-equals-producer.job.workflow_sha",
      "producer.action.commit_sha-equals-producer.job.workflow_sha",
      "producer.action.immutable-is-true",
    ],
  );
  assert.deepEqual(
    manifest.contracts.producer_receipt.source_checkout,
    expectedSourceCheckout,
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
  assert.ok(
    manifest.contracts.producer_receipt.artifact_inventory_api.required_equalities.includes(
      "artifact-api-workflow_run-head_sha-equals-exact-run-attempt-head_sha",
    ),
  );
  assert.deepEqual(
    manifest.contracts.producer_receipt.receipt_statuses.required_head_equalities,
    [
      "selected-receipt-status-head_sha-equals-current-pull-request-head_sha",
      "rest-status-list-request-ref-equals-current-pull-request-head_sha",
      "selected-graphql-status-context-commit-oid-equals-current-pull-request-head_sha",
      "selected-receipt-status-head_sha-equals-selected-graphql-status-context-commit-oid",
    ],
  );
  assert.equal(
    manifest.contracts.producer_receipt.head_domain_separation
      .workflow_run_head_may_differ_from_status_and_pull_request_head,
    true,
  );
  assert.ok(
    !manifest.contracts.producer_receipt.run_attempt_api.required_equalities.includes(
      "head_sha-equals-receipt-producer-environment-GITHUB_WORKFLOW_SHA",
    ),
  );
  assert.equal(
    manifest.contracts.producer_receipt.head_domain_separation
      .caller_workflow_sha_may_differ_from_called_workflow_sha,
    true,
  );
  assert.deepEqual(
    manifest.contracts.producer_receipt.head_domain_separation
      .consumer_must_not_require,
    [
      "exact-run-attempt-head_sha-equals-selected-receipt-status-head_sha",
      "artifact-api-workflow_run-head_sha-equals-selected-receipt-status-head_sha",
      "exact-run-attempt-head_sha-equals-receipt-producer-environment-GITHUB_WORKFLOW_SHA",
      "receipt-producer-environment-GITHUB_WORKFLOW_SHA-equals-receipt-producer-job-workflow_sha",
    ],
  );
  assert.equal(manifest.contracts.status.rest.get_by_id_available, false);

  const secondOutput = join(fixture.root, "second-provenance.json");
  const second = runGenerator(generatorArguments(fixture, secondOutput));
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(readFileSync(secondOutput), firstBytes);
});

test("GnuPG status parser records distinct signing and primary fingerprints", () => {
  const signingKeyFingerprint = "1".repeat(40);
  const primaryKeyFingerprint = "2".repeat(40);
  const result = {
    stdout: Buffer.from(
      `[GNUPG:] GOODSIG ${signingKeyFingerprint} Release Signing Subkey\n` +
        `[GNUPG:] VALIDSIG ${signingKeyFingerprint} 2026-08-09 0 0 0 0 0 0 00 ${primaryKeyFingerprint}\n`,
      "utf8",
    ),
    stderr: Buffer.alloc(0),
  };
  assert.deepEqual(parseVerifiedOpenPgpStatus(result, "v1.5.0"), {
    signingKeyFingerprint,
    primaryKeyFingerprint,
  });

  for (const invalidLength of [41, 63]) {
    const invalidFingerprint = "3".repeat(invalidLength);
    assert.throws(
      () =>
        parseVerifiedOpenPgpStatus(
          {
            stdout: Buffer.from(
              "[GNUPG:] GOODSIG 3333333333333333 Invalid Length\n" +
                `[GNUPG:] VALIDSIG ${invalidFingerprint} 2026-08-09 0 0 0 0 0 0 00 ${primaryKeyFingerprint}\n`,
              "utf8",
            ),
            stderr: Buffer.alloc(0),
          },
          "invalid tag",
        ),
      /inconsistent GOODSIG\/VALIDSIG identity/,
    );
  }
});

test("final pre-publication ref-race failure publishes no manifest", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "codex-review-gate-publish-race-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, "release-provenance.json");
  const phases = [];

  await assert.rejects(
    writeManifest(
      output,
      { schema: PROVENANCE_SCHEMA_ID, schema_version: 2 },
      {
        beforePublish: () => {
          phases.push("before-publication");
          assert.equal(existsSync(output), false);
        },
        finalPrePublish: () => {
          phases.push("final-pre-publication");
          assert.equal(existsSync(output), false);
          throw new Error("simulated final pre-publication ref drift");
        },
      },
    ),
    /simulated final pre-publication ref drift/,
  );
  assert.deepEqual(phases, ["before-publication", "final-pre-publication"]);
  assert.equal(existsSync(output), false);
});

test("manifest publication never overwrites an existing output", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "codex-review-gate-existing-output-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, "release-provenance.json");
  const existing = Buffer.from("known-good-existing-manifest\n", "utf8");
  writeFileSync(output, existing, { mode: 0o600 });

  await assert.rejects(
    writeManifest(output, {
      schema: PROVENANCE_SCHEMA_ID,
      schema_version: 2,
    }),
    /output already exists; refusing to replace/,
  );
  assert.deepEqual(readFileSync(output), existing);
});

test("concurrent output creation is preserved instead of overwritten", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "codex-review-gate-concurrent-output-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, "release-provenance.json");
  const replacement = Buffer.from("concurrent-publisher-manifest\n", "utf8");

  await assert.rejects(
    writeManifest(
      output,
      { schema: PROVENANCE_SCHEMA_ID, schema_version: 2 },
      {
        finalPrePublish: () => {
          writeFileSync(output, replacement, { flag: "wx", mode: 0o600 });
        },
      },
    ),
    /output already exists; refusing to replace/,
  );
  assert.deepEqual(readFileSync(output), replacement);
});

test("same-process concurrent invocations cannot collide on private staging", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "codex-review-gate-concurrent-stage-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, "release-provenance.json");
  let releaseFirst;
  let reportFirstReady;
  const firstReady = new Promise((resolveReady) => {
    reportFirstReady = resolveReady;
  });
  const firstMayPublish = new Promise((resolvePublish) => {
    releaseFirst = resolvePublish;
  });

  const first = assert.rejects(
    writeManifest(
      output,
      { invocation: "first" },
      {
        finalPrePublish: async () => {
          reportFirstReady();
          await firstMayPublish;
        },
      },
    ),
    /output already exists; refusing to replace/,
  );
  await firstReady;

  const secondManifest = { invocation: "second" };
  await writeManifest(output, secondManifest);
  releaseFirst();
  await first;
  assert.deepEqual(
    JSON.parse(readFileSync(output, "utf8")),
    secondManifest,
  );
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

test("generation rejects a mutated receipt v1 schema", (t) => {
  const fixture = createFixture(t, { mutateReceiptSchema: true });
  const output = join(fixture.root, "mutated-receipt-schema.json");
  const result = runGenerator(generatorArguments(fixture, output));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /reviewed frozen receipt v1 schema/);
  assert.equal(existsSync(output), false);
});

test("generation rejects reusable workflow authority mutations", async (t) => {
  const cases = [
    {
      name: "policy major",
      options: { mutatePolicyMajor: true },
      pattern: /decision table identity contradicts compatibility policy/,
    },
    {
      name: "called repository",
      options: { wrongCalledRepository: true },
      pattern: /called workflow authority contradicts release policy/,
    },
    {
      name: "called path",
      options: { wrongCalledPath: true },
      pattern: /called workflow authority contradicts release policy/,
    },
    {
      name: "called ref",
      options: { wrongCalledRef: true },
      pattern: /exact-attempt referenced workflow contract contradicts release policy/,
    },
    {
      name: "called sha binding",
      options: { wrongCalledShaBinding: true },
      pattern: /exact-attempt referenced workflow contract contradicts release policy/,
    },
    {
      name: "tag drift",
      options: { mutateTagDriftContract: true },
      pattern: /exact-attempt referenced workflow contract contradicts release policy/,
    },
    {
      name: "rerun substitution",
      options: { mutateRerunContract: true },
      pattern: /exact-attempt referenced workflow contract contradicts release policy/,
    },
  ];
  for (const testCase of cases) {
    await t.test(testCase.name, () => {
      const fixture = createFixture(t, testCase.options);
      const output = join(fixture.root, `${testCase.name.replaceAll(" ", "-")}.json`);
      const result = runGenerator(generatorArguments(fixture, output));
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, testCase.pattern);
      assert.equal(existsSync(output), false);
    });
  }
});

test("generation rejects an open or mutated runtime closure", async (t) => {
  await t.test("floating external action", () => {
    const fixture = createFixture(t, { floatingCheckout: true });
    const output = join(fixture.root, "floating-runtime-action.json");
    const result = runGenerator(generatorArguments(fixture, output));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /reviewed frozen runtime entrypoint/);
    assert.equal(existsSync(output), false);
  });

  await t.test("extra pinned external action", () => {
    const fixture = createFixture(t, { extraExternalAction: true });
    const output = join(fixture.root, "extra-runtime-action.json");
    const result = runGenerator(generatorArguments(fixture, output));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /reviewed frozen runtime entrypoint/);
    assert.equal(existsSync(output), false);
  });

  const bindingMutations = [
    ["wrong checkout repository", { wrongCheckoutRepository: true }],
    ["wrong checkout ref", { wrongCheckoutRef: true }],
    ["wrong checkout path", { wrongCheckoutPath: true }],
    ["persisted checkout credentials", { persistCheckoutCredentials: true }],
  ];
  for (const [name, options] of bindingMutations) {
    await t.test(name, () => {
      const fixture = createFixture(t, options);
      const output = join(fixture.root, `${name.replaceAll(" ", "-")}.json`);
      const result = runGenerator(generatorArguments(fixture, output));
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /reviewed frozen runtime entrypoint/);
      assert.equal(existsSync(output), false);
    });
  }

  await t.test("wrong local action path", () => {
    const fixture = createFixture(t, { wrongLocalActionUse: true });
    const output = join(fixture.root, "wrong-local-action-path.json");
    const result = runGenerator(generatorArguments(fixture, output));
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /reviewed frozen runtime entrypoint/);
    assert.equal(existsSync(output), false);
  });

  const nonCanonicalYamlCases = [
    ["flow-style uses mapping", { flowExternalUse: true }],
    ["quoted uses mapping", { quotedExternalUse: true }],
    ["anchor alias step", { anchorCheckoutAlias: true }],
  ];
  for (const [name, options] of nonCanonicalYamlCases) {
    await t.test(name, () => {
      const fixture = createFixture(t, options);
      const output = join(fixture.root, `${name.replaceAll(" ", "-")}.json`);
      const result = runGenerator(generatorArguments(fixture, output));
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /reviewed frozen runtime entrypoint/);
      assert.equal(existsSync(output), false);
    });
  }
});

test("generation rejects a consumer contract that conflates workflow-run and PR heads", (t) => {
  const fixture = createFixture(t, {
    conflateRunAndPullRequestHeads: true,
  });
  const output = join(fixture.root, "conflated-run-pr-heads.json");
  const result = runGenerator(generatorArguments(fixture, output));
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /workflow-run and pull-request head binding contract contradicts release policy/,
  );
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
      "v1.5.0-inner",
      fixture.actionCommit,
      "-m",
      "inner fixture",
    ]);
    git(fixture.actionRepo, [
      "tag",
      "-f",
      "-a",
      "v1.5.0",
      "refs/tags/v1.5.0-inner",
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
    assert.match(result.stderr, /reviewed frozen runtime entrypoint/);
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
