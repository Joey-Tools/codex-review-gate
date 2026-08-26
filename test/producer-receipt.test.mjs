import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const actionDefinitionPath = join(repoRoot, "packages/action/action.yml");
const gatePath = join(repoRoot, "packages/action/src/gate.mjs");
const fakeFetchPath = join(repoRoot, "test/support/fake-github-fetch.mjs");
const receiptSchemaPath = join(
  repoRoot,
  "packages/action/producer-receipt.schema.json",
);

const HEAD_SHA = "01c3f9da03e7adfdcd4176cb927dc450436da8f4";
const ACTION_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const WORKFLOW_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const JOB_WORKFLOW_SHA = "cccccccccccccccccccccccccccccccccccccccc";
const PEELED_RELEASE_COMMIT_SHA =
  "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const OTHER_WORKFLOW_SHA = "dddddddddddddddddddddddddddddddddddddddd";
const RUN_ID = "24680";
const RUN_ATTEMPT = "7";
const RUN_URL =
  `https://github.com/owner/repo/actions/runs/${RUN_ID}/attempts/${RUN_ATTEMPT}`;
const WORKFLOW_REF =
  "owner/repo/.github/workflows/review.yml@refs/pull/1/merge";
const JOB_WORKFLOW_REF =
  "owner/workflows/.github/workflows/codex-review.yml@refs/heads/main";
const JOB_WORKFLOW_REPOSITORY = "owner/workflows";
const JOB_WORKFLOW_FILE_PATH = ".github/workflows/codex-review.yml";
const ACTION_REPOSITORY = "JoeyTeng/codex-review-gate-action";
const CANONICAL_REUSABLE_WORKFLOW_FILE_PATH =
  ".github/workflows/codex-review-gate.yml";
const CANONICAL_REUSABLE_WORKFLOW_REF =
  `${ACTION_REPOSITORY}/${CANONICAL_REUSABLE_WORKFLOW_FILE_PATH}@refs/tags/v1`;
const STATUS_CONTEXT = "codex/review-gate";

test("receipt records the immutable producer and forced current-head status POST", async () => {
  const receiptSchema = JSON.parse(await readFile(receiptSchemaPath, "utf8"));
  const { result, state, receipt, receiptRaw, output } = await runReceiptGate({
    mutateState(candidate) {
      candidate.commitStatuses.push({
        id: 9001,
        node_id: "SC_existingCurrentStatus",
        sha: HEAD_SHA,
        context: STATUS_CONTEXT,
        state: "pending",
        description: "Waiting for Codex review on controlled marker",
        target_url: RUN_URL,
        creator: { login: "github-actions[bot]", type: "Bot" },
      });
    },
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(receiptRaw.endsWith("\n"), true);
  assert.equal(output, "producer-receipt-finalized=true\n");

  const statusPosts = state.requestLog.filter((entry) =>
    entry.method === "POST" &&
      entry.path === `/repos/owner/repo/statuses/${HEAD_SHA}`
  );
  assert.equal(
    statusPosts.length,
    2,
    "receipt mode must POST each requested transition even when the exact status exists",
  );
  assert.deepEqual(statusPosts[0].body, {
    state: "pending",
    context: STATUS_CONTEXT,
    description: "Waiting for Codex review on controlled marker",
    target_url: RUN_URL,
  });
  assert.deepEqual(statusPosts[1].body, {
    state: "pending",
    context: STATUS_CONTEXT,
    description: "Waiting for a complete current-head Codex review result",
    target_url: RUN_URL,
  });
  assert.equal(state.statuses.length, 2);
  assert.equal(state.statuses[0].id, 1);
  assert.equal(state.statuses[0].node_id, "SC_kwDOCommitStatus1");
  assert.equal(state.statuses[1].id, 2);
  assert.equal(state.statuses[1].node_id, "SC_kwDOCommitStatus2");

  assert.equal(receipt.schema, receiptSchema.$id);
  assert.equal(receipt.schema, receiptSchema.properties.schema.const);
  assert.equal(
    receipt.schema_version,
    receiptSchema.properties.schema_version.const,
  );
  assert.deepEqual(receipt, {
    schema: "urn:joeyteng:codex-review-gate:producer-receipt:1",
    schema_version: 1,
    artifact: {
      name: `codex-review-gate-producer-receipt-${RUN_ID}-${RUN_ATTEMPT}`,
      file: "codex-review-gate-producer-receipt.json",
    },
    producer: {
      repository: "owner/repo",
      server_url: "https://github.com",
      run: {
        id: RUN_ID,
        attempt: RUN_ATTEMPT,
        target_url: RUN_URL,
      },
      environment: {
        GITHUB_WORKFLOW_REF: WORKFLOW_REF,
        GITHUB_WORKFLOW_SHA: WORKFLOW_SHA,
      },
      job: {
        id: "review-gate",
        workflow_ref: JOB_WORKFLOW_REF,
        workflow_sha: JOB_WORKFLOW_SHA,
        workflow_repository: JOB_WORKFLOW_REPOSITORY,
        workflow_file_path: JOB_WORKFLOW_FILE_PATH,
      },
      action: {
        repository: ACTION_REPOSITORY,
        ref: ACTION_SHA,
        commit_sha: ACTION_SHA,
        immutable: true,
      },
    },
    execution: {
      result: "completed",
      status_count: 2,
    },
    statuses: [
      {
        sequence: 1,
        id: "1",
        node_id: "SC_kwDOCommitStatus1",
        pull_request_number: 1,
        head_sha: HEAD_SHA,
        context: STATUS_CONTEXT,
        state: "pending",
        description: "Waiting for Codex review on controlled marker",
        target_url: RUN_URL,
        creator: {
          login: "github-actions[bot]",
          type: "Bot",
        },
      },
      {
        sequence: 2,
        id: "2",
        node_id: "SC_kwDOCommitStatus2",
        pull_request_number: 1,
        head_sha: HEAD_SHA,
        context: STATUS_CONTEXT,
        state: "pending",
        description: "Waiting for a complete current-head Codex review result",
        target_url: RUN_URL,
        creator: {
          login: "github-actions[bot]",
          type: "Bot",
        },
      },
    ],
  });
});

test("a floating action ref remains explicit and non-immutable", async () => {
  const { result, receipt, output } = await runReceiptGate({
    actionRef: "v1",
    eventName: "push",
    event: {},
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(output, "producer-receipt-finalized=true\n");
  assert.deepEqual(receipt.producer.action, {
    repository: ACTION_REPOSITORY,
    ref: "v1",
    commit_sha: null,
    immutable: false,
  });
  assert.deepEqual(receipt.execution, {
    result: "completed",
    status_count: 0,
  });
  assert.deepEqual(receipt.statuses, []);
});

test("a direct job preserves its exact action commit independently", async () => {
  const { result, receipt, output } = await runReceiptGate({
    actionRepository: ACTION_REPOSITORY,
    actionRef: ACTION_SHA,
    jobWorkflowRef: WORKFLOW_REF,
    jobWorkflowSha: WORKFLOW_SHA,
    jobWorkflowRepository: "owner/repo",
    jobWorkflowFilePath: ".github/workflows/review.yml",
    eventName: "push",
    event: {},
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(output, "producer-receipt-finalized=true\n");
  assert.equal(
    receipt.producer.job.workflow_ref,
    receipt.producer.environment.GITHUB_WORKFLOW_REF,
  );
  assert.equal(
    receipt.producer.job.workflow_sha,
    receipt.producer.environment.GITHUB_WORKFLOW_SHA,
  );
  assert.deepEqual(receipt.producer.action, {
    repository: ACTION_REPOSITORY,
    ref: ACTION_SHA,
    commit_sha: ACTION_SHA,
    immutable: true,
  });
  assert.notEqual(receipt.producer.action.commit_sha, WORKFLOW_SHA);
  assert.notEqual(receipt.producer.action.commit_sha, JOB_WORKFLOW_SHA);
});

test("the canonical v1 reusable workflow binds the tag object and peeled checkout commit separately", async () => {
  const { result, receipt, output } = await runReceiptGate({
    actionRepository: "",
    actionRef: "",
    checkedOutActionCommitSha: PEELED_RELEASE_COMMIT_SHA,
    jobWorkflowRef: CANONICAL_REUSABLE_WORKFLOW_REF,
    jobWorkflowSha: JOB_WORKFLOW_SHA,
    jobWorkflowRepository: ACTION_REPOSITORY,
    jobWorkflowFilePath: CANONICAL_REUSABLE_WORKFLOW_FILE_PATH,
    eventName: "push",
    event: {},
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(output, "producer-receipt-finalized=true\n");
  assert.deepEqual(receipt.producer.environment, {
    GITHUB_WORKFLOW_REF: WORKFLOW_REF,
    GITHUB_WORKFLOW_SHA: WORKFLOW_SHA,
  });
  assert.deepEqual(receipt.producer.job, {
    id: "review-gate",
    workflow_ref: CANONICAL_REUSABLE_WORKFLOW_REF,
    workflow_sha: JOB_WORKFLOW_SHA,
    workflow_repository: ACTION_REPOSITORY,
    workflow_file_path: CANONICAL_REUSABLE_WORKFLOW_FILE_PATH,
  });
  assert.deepEqual(receipt.producer.action, {
    repository: ACTION_REPOSITORY,
    ref: JOB_WORKFLOW_SHA,
    commit_sha: PEELED_RELEASE_COMMIT_SHA,
    immutable: true,
  });
  assert.notEqual(
    receipt.producer.action.ref,
    receipt.producer.action.commit_sha,
  );
});

test("a future canonical workflow commit SHA remains compatible when W equals C", async () => {
  const { result, receipt, output } = await runReceiptGate({
    actionRepository: "",
    actionRef: "",
    checkedOutActionCommitSha: PEELED_RELEASE_COMMIT_SHA,
    jobWorkflowRef: CANONICAL_REUSABLE_WORKFLOW_REF,
    jobWorkflowSha: PEELED_RELEASE_COMMIT_SHA,
    jobWorkflowRepository: ACTION_REPOSITORY,
    jobWorkflowFilePath: CANONICAL_REUSABLE_WORKFLOW_FILE_PATH,
    eventName: "push",
    event: {},
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(output, "producer-receipt-finalized=true\n");
  assert.deepEqual(receipt.producer.action, {
    repository: ACTION_REPOSITORY,
    ref: PEELED_RELEASE_COMMIT_SHA,
    commit_sha: PEELED_RELEASE_COMMIT_SHA,
    immutable: true,
  });
});

test("a rerun receipt rebinds the attempt while retaining W and C", async () => {
  const rerunAttempt = "8";
  const { result, receipt, output } = await runReceiptGate({
    actionRepository: "",
    actionRef: "",
    checkedOutActionCommitSha: PEELED_RELEASE_COMMIT_SHA,
    jobWorkflowRef: CANONICAL_REUSABLE_WORKFLOW_REF,
    jobWorkflowSha: JOB_WORKFLOW_SHA,
    jobWorkflowRepository: ACTION_REPOSITORY,
    jobWorkflowFilePath: CANONICAL_REUSABLE_WORKFLOW_FILE_PATH,
    runAttempt: rerunAttempt,
    eventName: "push",
    event: {},
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(output, "producer-receipt-finalized=true\n");
  assert.deepEqual(receipt.artifact, {
    name: `codex-review-gate-producer-receipt-${RUN_ID}-${rerunAttempt}`,
    file: "codex-review-gate-producer-receipt.json",
  });
  assert.deepEqual(receipt.producer.run, {
    id: RUN_ID,
    attempt: rerunAttempt,
    target_url:
      `https://github.com/owner/repo/actions/runs/${RUN_ID}/attempts/${rerunAttempt}`,
  });
  assert.equal(receipt.producer.job.workflow_sha, JOB_WORKFLOW_SHA);
  assert.equal(receipt.producer.action.ref, JOB_WORKFLOW_SHA);
  assert.equal(
    receipt.producer.action.commit_sha,
    PEELED_RELEASE_COMMIT_SHA,
  );
});

test("near-canonical reusable workflow tuples remain non-immutable", async (t) => {
  const scenarios = [
    {
      name: "repository case differs",
      jobWorkflowRepository: "joeyteng/codex-review-gate-action",
    },
    {
      name: "repository has trailing whitespace",
      jobWorkflowRepository: `${ACTION_REPOSITORY} `,
    },
    {
      name: "workflow path differs",
      jobWorkflowFilePath: ".github/workflows/review-gate.yml",
    },
    {
      name: "workflow path case differs",
      jobWorkflowFilePath: ".github/workflows/Codex-review-gate.yml",
    },
    {
      name: "workflow ref uses the shorthand tag",
      jobWorkflowRef:
        `${ACTION_REPOSITORY}/${CANONICAL_REUSABLE_WORKFLOW_FILE_PATH}@v1`,
    },
    {
      name: "workflow ref uses a branch",
      jobWorkflowRef:
        `${ACTION_REPOSITORY}/${CANONICAL_REUSABLE_WORKFLOW_FILE_PATH}@refs/heads/v1`,
    },
    {
      name: "workflow ref uses a minor tag",
      jobWorkflowRef:
        `${ACTION_REPOSITORY}/${CANONICAL_REUSABLE_WORKFLOW_FILE_PATH}@refs/tags/v1.4`,
    },
    {
      name: "workflow ref tag case differs",
      jobWorkflowRef:
        `${ACTION_REPOSITORY}/${CANONICAL_REUSABLE_WORKFLOW_FILE_PATH}@refs/tags/V1`,
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const { result, receipt, output } = await runReceiptGate({
        actionRepository: "",
        actionRef: "",
        checkedOutActionCommitSha: PEELED_RELEASE_COMMIT_SHA,
        jobWorkflowRef:
          scenario.jobWorkflowRef || CANONICAL_REUSABLE_WORKFLOW_REF,
        jobWorkflowSha: JOB_WORKFLOW_SHA,
        jobWorkflowRepository:
          scenario.jobWorkflowRepository || ACTION_REPOSITORY,
        jobWorkflowFilePath:
          scenario.jobWorkflowFilePath || CANONICAL_REUSABLE_WORKFLOW_FILE_PATH,
        eventName: "push",
        event: {},
      });

      assert.equal(result.code, 0, result.stderr);
      assert.equal(output, "producer-receipt-finalized=true\n");
      assert.deepEqual(receipt.producer.action, {
        repository: null,
        ref: null,
        commit_sha: null,
        immutable: false,
      });
    });
  }
});

test("canonical reusable workflow identity rejects malformed job SHAs", async (t) => {
  const scenarios = [
    ["upper-case", JOB_WORKFLOW_SHA.toUpperCase()],
    ["short", JOB_WORKFLOW_SHA.slice(0, -1)],
    ["padded", ` ${JOB_WORKFLOW_SHA}`],
  ];

  for (const [name, jobWorkflowSha] of scenarios) {
    await t.test(name, async () => {
      const { result, receiptRaw, output } = await runReceiptGate({
        actionRepository: "",
        actionRef: "",
        jobWorkflowRef: CANONICAL_REUSABLE_WORKFLOW_REF,
        jobWorkflowSha,
        jobWorkflowRepository: ACTION_REPOSITORY,
        jobWorkflowFilePath: CANONICAL_REUSABLE_WORKFLOW_FILE_PATH,
        eventName: "push",
        event: {},
      });

      assert.notEqual(result.code, 0);
      assert.match(
        result.stderr,
        /CODEX_REVIEW_GATE_JOB_WORKFLOW_SHA must be one lowercase full Git object ID/,
      );
      assert.equal(receiptRaw, null);
      assert.equal(output, "");
    });
  }
});

test("canonical reusable workflow identity requires a lower-case checkout commit", async (t) => {
  const scenarios = [
    [
      "missing",
      null,
      /CODEX_REVIEW_GATE_CHECKED_OUT_ACTION_COMMIT_SHA is required/,
    ],
    [
      "empty",
      "",
      /CODEX_REVIEW_GATE_CHECKED_OUT_ACTION_COMMIT_SHA is required/,
    ],
    [
      "upper-case",
      PEELED_RELEASE_COMMIT_SHA.toUpperCase(),
      /CODEX_REVIEW_GATE_CHECKED_OUT_ACTION_COMMIT_SHA must be one lowercase full commit SHA/,
    ],
    [
      "short",
      PEELED_RELEASE_COMMIT_SHA.slice(0, -1),
      /CODEX_REVIEW_GATE_CHECKED_OUT_ACTION_COMMIT_SHA must be one lowercase full commit SHA/,
    ],
    [
      "padded",
      ` ${PEELED_RELEASE_COMMIT_SHA}`,
      /CODEX_REVIEW_GATE_CHECKED_OUT_ACTION_COMMIT_SHA must be one lowercase full commit SHA/,
    ],
  ];

  for (const [name, checkedOutActionCommitSha, error] of scenarios) {
    await t.test(name, async () => {
      const { result, receiptRaw, output } = await runReceiptGate({
        actionRepository: "",
        actionRef: "",
        checkedOutActionCommitSha,
        jobWorkflowRef: CANONICAL_REUSABLE_WORKFLOW_REF,
        jobWorkflowSha: JOB_WORKFLOW_SHA,
        jobWorkflowRepository: ACTION_REPOSITORY,
        jobWorkflowFilePath: CANONICAL_REUSABLE_WORKFLOW_FILE_PATH,
        eventName: "push",
        event: {},
      });

      assert.notEqual(result.code, 0);
      assert.match(result.stderr, error);
      assert.equal(receiptRaw, null);
      assert.equal(output, "");
    });
  }
});

test("native action context takes precedence over a reusable-only checkout commit", async (t) => {
  const scenarios = [
    {
      name: "exact remote action",
      actionRepository: ACTION_REPOSITORY,
      actionRef: ACTION_SHA,
      expected: {
        repository: ACTION_REPOSITORY,
        ref: ACTION_SHA,
        commit_sha: ACTION_SHA,
        immutable: true,
      },
    },
    {
      name: "floating remote action",
      actionRepository: ACTION_REPOSITORY,
      actionRef: "v1",
      expected: {
        repository: ACTION_REPOSITORY,
        ref: "v1",
        commit_sha: null,
        immutable: false,
      },
    },
    {
      name: "repository-only partial action context",
      actionRepository: ACTION_REPOSITORY,
      actionRef: "",
      expected: {
        repository: ACTION_REPOSITORY,
        ref: null,
        commit_sha: null,
        immutable: false,
      },
    },
    {
      name: "exact-ref-only partial action context",
      actionRepository: "",
      actionRef: ACTION_SHA,
      expected: {
        repository: null,
        ref: ACTION_SHA,
        commit_sha: ACTION_SHA,
        immutable: true,
      },
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const { result, receipt } = await runReceiptGate({
        actionRepository: scenario.actionRepository,
        actionRef: scenario.actionRef,
        checkedOutActionCommitSha: PEELED_RELEASE_COMMIT_SHA,
        jobWorkflowRef: CANONICAL_REUSABLE_WORKFLOW_REF,
        jobWorkflowSha: JOB_WORKFLOW_SHA,
        jobWorkflowRepository: ACTION_REPOSITORY,
        jobWorkflowFilePath: CANONICAL_REUSABLE_WORKFLOW_FILE_PATH,
        eventName: "push",
        event: {},
      });

      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(receipt.producer.action, scenario.expected);
    });
  }
});

test("an ordinary local action does not inherit its job workflow identity", async () => {
  const { result, receipt } = await runReceiptGate({
    actionRepository: "",
    actionRef: "",
    eventName: "push",
    event: {},
  });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(receipt.producer.action, {
    repository: null,
    ref: null,
    commit_sha: null,
    immutable: false,
  });
});

test("canonical reusable identity keeps the caller workflow binding independent", async (t) => {
  const scenarios = [
    ["ref mismatch", { CODEX_REVIEW_GATE_WORKFLOW_REF: `${WORKFLOW_REF}-other` }],
    ["SHA mismatch", { CODEX_REVIEW_GATE_WORKFLOW_SHA: OTHER_WORKFLOW_SHA }],
  ];

  for (const [name, env] of scenarios) {
    await t.test(name, async () => {
      const { result, receiptRaw, output } = await runReceiptGate({
        actionRepository: "",
        actionRef: "",
        jobWorkflowRef: CANONICAL_REUSABLE_WORKFLOW_REF,
        jobWorkflowSha: JOB_WORKFLOW_SHA,
        jobWorkflowRepository: ACTION_REPOSITORY,
        jobWorkflowFilePath: CANONICAL_REUSABLE_WORKFLOW_FILE_PATH,
        eventName: "push",
        event: {},
        env,
      });

      assert.notEqual(result.code, 0);
      assert.match(
        result.stderr,
        /producer receipt workflow context did not match GITHUB_WORKFLOW_REF\/SHA/,
      );
      assert.equal(receiptRaw, null);
      assert.equal(output, "");
    });
  }
});

test("the live v2 direct runtime uses only the closed JavaScript Action ABI", async () => {
  const actionDefinition = await readFile(actionDefinitionPath, "utf8");
  const expectedInputs = [
    "github_token",
    "pr_number",
    "expected_head_sha",
    "operation",
    "request_comment_id",
    "request_review",
    "limits_profile",
  ];

  for (const input of expectedInputs) {
    assert.match(actionDefinition, new RegExp(`^  ${input}:$`, "mu"));
  }
  for (const legacyInput of [
    "github-token",
    "pull-request",
    "request-review",
    "max-pages",
    "max-objects",
  ]) {
    assert.doesNotMatch(actionDefinition, new RegExp(`^  ${legacyInput}:$`, "mu"));
  }
  assert.doesNotMatch(actionDefinition, /using:\s*composite|\n\s*steps:|\$\{\{/u);
  assert.match(
    actionDefinition,
    /runs:\n  using: node20\n  main: src\/v2\/gate-runtime\.mjs\n?$/u,
  );
});

test("the v2 action omits v1 receipts while the retained v1 gate disables them off GitHub.com", async () => {
  const actionDefinition = await readFile(actionDefinitionPath, "utf8");
  assert.doesNotMatch(actionDefinition, /CODEX_REVIEW_GATE_RECEIPT_PATH/u);
  assert.doesNotMatch(actionDefinition, /src\/gate\.mjs/u);
  assert.doesNotMatch(actionDefinition, /src\/v2\/action\.mjs/u);
  assert.match(actionDefinition, /src\/v2\/gate-runtime\.mjs/u);

  const { result, receiptRaw, output } = await runReceiptGate({
    actionRef: ACTION_SHA,
    eventName: "push",
    event: {},
    serverUrl: "https://github.enterprise.example",
    receiptEnabled: false,
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(receiptRaw, null);
  assert.equal(output, "");
});

test("action ref authority requires the exact raw lower-case 40-SHA", async () => {
  const paddedRef = ` ${ACTION_SHA} `;
  const { result, receipt } = await runReceiptGate({
    actionRef: paddedRef,
    eventName: "push",
    event: {},
  });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(receipt.producer.action, {
    repository: ACTION_REPOSITORY,
    ref: paddedRef,
    commit_sha: null,
    immutable: false,
  });
});

test("a failed gate finalizes a failed receipt with its status response", async () => {
  const { result, receipt, output } = await runReceiptGate({
    mutateState(candidate) {
      candidate.routeFaults["POST /repos/owner/repo/issues/1/comments"] = [
        {
          status: 400,
          body: { message: "fixture rejects the initial state comment" },
        },
        {
          status: 400,
          body: { message: "fixture rejects the marker comment" },
        },
      ];
    },
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /fixture rejects the marker comment/);
  assert.equal(output, "producer-receipt-finalized=true\n");
  assert.deepEqual(receipt.execution, {
    result: "failed",
    status_count: 1,
  });
  assert.deepEqual(
    {
      id: receipt.statuses[0].id,
      nodeId: receipt.statuses[0].node_id,
      pullRequestNumber: receipt.statuses[0].pull_request_number,
      headSha: receipt.statuses[0].head_sha,
      context: receipt.statuses[0].context,
      state: receipt.statuses[0].state,
      creator: receipt.statuses[0].creator,
    },
    {
      id: "1",
      nodeId: "SC_kwDOCommitStatus1",
      pullRequestNumber: 1,
      headSha: HEAD_SHA,
      context: STATUS_CONTEXT,
      state: "error",
      creator: { login: "github-actions[bot]", type: "Bot" },
    },
  );
});

test("malformed status POST responses cannot become causal receipt entries", async (t) => {
  const scenarios = [
    {
      name: "invalid id",
      mutation: { set: { id: 0 } },
      error: /safe positive id/,
    },
    {
      name: "missing id",
      mutation: { omit: ["id"] },
      error: /safe positive id/,
    },
    {
      name: "missing node_id",
      mutation: { omit: ["node_id"] },
      error: /omitted node_id/,
    },
    {
      name: "numeric node_id",
      mutation: { set: { node_id: 42 } },
      error: /omitted node_id/,
    },
    {
      name: "object node_id",
      mutation: { set: { node_id: { value: "SC_kwDOCommitStatus1" } } },
      error: /omitted node_id/,
    },
    {
      name: "missing creator",
      mutation: { omit: ["creator"] },
      error: /omitted creator identity/,
    },
    {
      name: "wrong-shaped creator",
      mutation: { set: { creator: ["github-actions[bot]", "Bot"] } },
      error: /omitted creator identity/,
    },
    {
      name: "numeric creator login",
      mutation: {
        set: { creator: { login: 42, type: "Bot" } },
      },
      error: /omitted creator identity/,
    },
    {
      name: "boolean creator type",
      mutation: {
        set: { creator: { login: "github-actions[bot]", type: true } },
      },
      error: /omitted creator identity/,
    },
    {
      name: "context echo mismatch",
      mutation: { set: { context: "codex/forged-context" } },
      error: /did not echo the requested status fields/,
    },
    {
      name: "state echo mismatch",
      mutation: { set: { state: "success" } },
      error: /did not echo the requested status fields/,
    },
    {
      name: "description echo mismatch",
      mutation: { set: { description: "forged description" } },
      error: /did not echo the requested status fields/,
    },
    {
      name: "target URL echo mismatch",
      mutation: { set: { target_url: "https://github.com/forged/status" } },
      error: /did not echo the requested status fields/,
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const { result, state, receipt, output } = await runReceiptGate({
        mutateState(candidate) {
          candidate.routeFaults[
            `POST /repos/owner/repo/statuses/${HEAD_SHA}`
          ] = [statusResponseFault(scenario.mutation)];
        },
      });

      assert.equal(result.code, 1);
      assert.match(result.stderr, scenario.error);
      assert.equal(output, "producer-receipt-finalized=true\n");
      assert.deepEqual(
        state.statuses.map((status) => status.body.state),
        ["pending", "error"],
      );
      assert.deepEqual(receipt.execution, {
        result: "failed",
        status_count: 1,
      });
      assert.deepEqual(
        receipt.statuses.map((status) => ({
          id: status.id,
          nodeId: status.node_id,
          state: status.state,
        })),
        [{ id: "2", nodeId: "SC_kwDOCommitStatus2", state: "error" }],
      );
      assert.equal(
        receipt.statuses.some((status) =>
          status.state === "pending" || status.state === "success"
        ),
        false,
      );
    });
  }
});

test("job workflow identity is mandatory before a receipt can be finalized", async (t) => {
  const names = [
    "CODEX_REVIEW_GATE_JOB_WORKFLOW_REF",
    "CODEX_REVIEW_GATE_JOB_WORKFLOW_SHA",
    "CODEX_REVIEW_GATE_JOB_WORKFLOW_REPOSITORY",
    "CODEX_REVIEW_GATE_JOB_WORKFLOW_FILE_PATH",
  ];

  for (const name of names) {
    for (const [mode, value] of [["missing", undefined], ["empty", ""]]) {
      await t.test(`${name} ${mode}`, async () => {
        const { result, receiptRaw, output } = await runReceiptGate({
          actionRef: "v1",
          eventName: "push",
          event: {},
          env: { [name]: value },
        });

        assert.notEqual(result.code, 0);
        assert.match(result.stderr, new RegExp(`${name} is required`));
        assert.equal(receiptRaw, null);
        assert.equal(output, "");
      });
    }
  }
});

async function runReceiptGate({
  actionRepository = ACTION_REPOSITORY,
  actionRef = ACTION_SHA,
  checkedOutActionCommitSha = null,
  jobWorkflowRef = JOB_WORKFLOW_REF,
  jobWorkflowSha = JOB_WORKFLOW_SHA,
  jobWorkflowRepository = JOB_WORKFLOW_REPOSITORY,
  jobWorkflowFilePath = JOB_WORKFLOW_FILE_PATH,
  runId = RUN_ID,
  runAttempt = RUN_ATTEMPT,
  eventName = "pull_request_target",
  event = {
    pull_request: { number: 1, head: { sha: HEAD_SHA } },
    repository: { default_branch: "master" },
  },
  receiptEnabled = true,
  serverUrl = "https://github.com",
  env = {},
  mutateState = () => {},
} = {}) {
  const workDir = await mkdtemp(join(tmpdir(), "codex-producer-receipt-test-"));
  const eventPath = join(workDir, "event.json");
  const statePath = join(workDir, "fake-github-state.json");
  const receiptPath = join(workDir, "codex-review-gate-producer-receipt.json");
  const outputPath = join(workDir, "github-output.txt");
  const summaryPath = join(workDir, "step-summary.md");
  const state = initialFakeGitHubState();
  mutateState(state);

  await writeFile(eventPath, JSON.stringify(event), "utf8");
  await writeFile(statePath, JSON.stringify(state, null, 2), "utf8");

  const childEnv = {
    ...cleanProcessEnv(),
    FAKE_GITHUB_STATE_PATH: statePath,
    GITHUB_TOKEN: "fake-token",
    GITHUB_REPOSITORY: "owner/repo",
    GITHUB_RUN_ID: runId,
    GITHUB_RUN_ATTEMPT: runAttempt,
    GITHUB_SERVER_URL: serverUrl,
    GITHUB_API_URL: "https://api.github.test",
    GITHUB_STEP_SUMMARY: summaryPath,
    GITHUB_OUTPUT: outputPath,
    GITHUB_EVENT_NAME: eventName,
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_WORKFLOW_REF: WORKFLOW_REF,
    GITHUB_WORKFLOW_SHA: WORKFLOW_SHA,
    GITHUB_JOB: "review-gate",
    CODEX_REVIEW_GATE_RECEIPT_PATH: receiptEnabled ? receiptPath : "",
    CODEX_REVIEW_GATE_ACTION_REPOSITORY: actionRepository,
    CODEX_REVIEW_GATE_ACTION_REF: actionRef,
    CODEX_REVIEW_GATE_WORKFLOW_REF: WORKFLOW_REF,
    CODEX_REVIEW_GATE_WORKFLOW_SHA: WORKFLOW_SHA,
    CODEX_REVIEW_GATE_JOB_WORKFLOW_REF: jobWorkflowRef,
    CODEX_REVIEW_GATE_JOB_WORKFLOW_SHA: jobWorkflowSha,
    CODEX_REVIEW_GATE_JOB_WORKFLOW_REPOSITORY: jobWorkflowRepository,
    CODEX_REVIEW_GATE_JOB_WORKFLOW_FILE_PATH: jobWorkflowFilePath,
    MARKER_ACK_TIMEOUT_SECONDS: "300",
    MARKER_ACK_TIMEOUT_MAX_SECONDS: "1800",
    MARKER_TIMEOUT_SECONDS: "3600",
    MAX_WAIT_SECONDS: "7200",
    COMPLETION_SIGNAL_BUFFER_SECONDS: "60",
  };
  if (checkedOutActionCommitSha !== null) {
    childEnv.CODEX_REVIEW_GATE_CHECKED_OUT_ACTION_COMMIT_SHA =
      checkedOutActionCommitSha;
  }
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) {
      delete childEnv[name];
    } else {
      childEnv[name] = value;
    }
  }

  try {
    const result = await runNode(
      ["--import", fakeFetchPath, gatePath],
      { cwd: repoRoot, env: childEnv },
    );
    const updatedState = JSON.parse(await readFile(statePath, "utf8"));
    const receiptRaw = await readOptionalFile(receiptPath);
    const output = await readOptionalFile(outputPath) || "";
    return {
      result,
      state: updatedState,
      receiptRaw,
      receipt: receiptRaw === null ? null : JSON.parse(receiptRaw),
      output,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function initialFakeGitHubState() {
  return {
    now: Date.parse("2026-05-14T10:01:00Z"),
    owner: "owner",
    repo: "repo",
    prNumber: 1,
    nextCommentId: 2000,
    pullLoads: 0,
    snapshotLoads: 0,
    snapshotHooks: [],
    pullHooks: [],
    statuses: [],
    commitStatuses: [],
    commitResolutions: {},
    compareResults: {},
    requestLog: [],
    routeFaults: {},
    issueComments: [],
    issueReactions: [],
    commentReactions: {},
    reviewComments: [],
    reviews: [],
    reviewThreads: [],
    pullRequest: {
      number: 1,
      state: "open",
      merged: false,
      merged_at: null,
      draft: false,
      user: { login: "octocat" },
      head: {
        sha: HEAD_SHA,
        repo: { full_name: "owner/repo" },
      },
      base: {
        repo: { full_name: "owner/repo" },
      },
    },
  };
}

function statusResponseFault({ set = {}, omit = [] }) {
  const body = {
    id: 1,
    node_id: "SC_kwDOCommitStatus1",
    state: "pending",
    context: STATUS_CONTEXT,
    description: "Waiting for Codex review on controlled marker",
    target_url: RUN_URL,
    creator: { login: "github-actions[bot]", type: "Bot" },
    ...set,
  };
  for (const name of omit) {
    delete body[name];
  }
  return {
    afterMutation: true,
    status: 201,
    body,
  };
}

async function readOptionalFile(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function cleanProcessEnv() {
  const names = [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "SystemRoot",
    "ComSpec",
    "PATHEXT",
  ];
  return Object.fromEntries(
    names
      .filter((name) => process.env[name])
      .map((name) => [name, process.env[name]]),
  );
}

function runNode(args, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}
