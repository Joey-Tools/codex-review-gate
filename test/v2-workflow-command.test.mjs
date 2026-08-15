import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertV2WorkflowCommandHandle,
  digestV2WorkflowCommand,
  MAX_V2_WORKFLOW_DISPATCH_BINDING_BYTES,
  prepareV2WorkflowCommand,
  readV2WorkflowCommand,
  validateV2WorkflowCommand,
  validateV2WorkflowCommandStructure,
  V2_PUBLIC_WAIT_POLICY,
  V2_SELECTION_POLICIES,
  V2_SERVER_ENFORCEMENT_POLICY,
  V2_STATUS_CONTEXT,
  V2_STATUS_TARGET_MODE,
  V2_WORKFLOW_COMMAND_SCHEMA,
  V2_WORKFLOW_COMMAND_VERSION,
  V2_WORKFLOW_PATH,
  V2_WORKFLOW_RECEIPT_SOURCE,
} from "../packages/action/src/v2/workflow-command.mjs";

const SHA = "c".repeat(40);
const CALLER_SHA = "d".repeat(40);
const CONTROLLER_PATH = new URL(
  "../packages/action/src/v2/workflow-controller.mjs",
  import.meta.url,
);
const RECONCILE_WORKFLOW_PATH = new URL(
  "../packages/action/.github/workflows/codex-review-gate-reconcile.yml",
  import.meta.url,
);

function scheduledDispatchBinding(overrides = {}) {
  const candidate = {
    id: "7001",
    node_id: "PR_kwDOExample7",
    number: 7,
    created_at: "2026-08-13T11:59:00.000Z",
    head_ref_oid: "5".repeat(40),
    base_ref_oid: "6".repeat(40),
    observation_server_time: "2026-08-13T12:00:00.000Z",
    observation_raw_body_sha256: `sha256:${"7".repeat(64)}`,
    ...(overrides.candidate ?? {}),
  };
  return {
    generation_id: `candidate-dispatch:${"1".repeat(64)}`,
    cycle_id: `candidate-cycle:${"2".repeat(64)}`,
    inventory_digest: `sha256:${"3".repeat(64)}`,
    batch_index: 0,
    batch_count: 1,
    dispatch_digest: `sha256:${"4".repeat(64)}`,
    ...overrides,
    candidate,
  };
}

test("prepare publishes one canonical 0600 command bound to trusted and advisory inputs", async () => {
  await withFixture({
    eventName: "pull_request_target",
    event: { action: "opened", pull_request: { number: 7 } },
    route: "ordinary",
    pullRequest: "7",
  }, async ({ environment, inputPath, eventBytes }) => {
    const command = await prepareV2WorkflowCommand(environment);
    assert.equal(command.schema, V2_WORKFLOW_COMMAND_SCHEMA);
    assert.equal(command.schema_version, V2_WORKFLOW_COMMAND_VERSION);
    assert.equal(command.command, "run");
    assert.deepEqual(command.repository, { owner: "owner", name: "repo" });
    assert.deepEqual(command.pull_request, { number: 7 });
    assert.equal(command.dispatch_binding, null);
    assert.equal(command.selection_policy, "joey-default");
    assert.deepEqual(command.route, {
      operation: "ordinary",
      trigger: "initial",
      observation_boundary: "initial",
    });
    assert.equal(command.invocation.event_name, "pull_request_target");
    assert.equal(
      command.invocation.event_payload_sha256,
      sha256(eventBytes),
    );
    assert.deepEqual(command.workflow_receipt, {
      present: true,
      compatible: true,
      source: V2_WORKFLOW_RECEIPT_SOURCE,
      repository: "Joey-Tools/codex-review-gate-action",
      path: V2_WORKFLOW_PATH,
      revision: SHA,
      checkout_sha: SHA,
      caller_repository: "owner/repo",
      caller_workflow_ref:
        "owner/repo/.github/workflows/codex-review-gate-reconcile.yml@refs/heads/main",
      caller_workflow_sha: CALLER_SHA,
      status_context: V2_STATUS_CONTEXT,
      status_target_mode: V2_STATUS_TARGET_MODE,
    });
    assert.deepEqual(command.receipt_policy, {
      server_enforcement: V2_SERVER_ENFORCEMENT_POLICY,
      public_wait: V2_PUBLIC_WAIT_POLICY,
    });
    assert.deepEqual(V2_SELECTION_POLICIES, [
      "joey-default",
      "required-infrastructure-only",
      "user-explicit",
      "legacy-triple",
      "disabled",
    ]);

    const info = await lstat(inputPath);
    assert.equal(info.isFile(), true);
    assert.equal(info.nlink, 1);
    assert.equal(info.mode & 0o777, 0o600);
    assert.equal(
      await readFile(inputPath, "utf8"),
      `${canonicalJson(command)}\n`,
    );
    assert.deepEqual(await readV2WorkflowCommand(environment), command);
    assert.equal(Object.isFrozen(command.workflow_receipt), true);
    assert.match(digestV2WorkflowCommand(command), /^sha256:[0-9a-f]{64}$/u);
    assert.equal(assertV2WorkflowCommandHandle(command), command);
    assert.throws(
      () => digestV2WorkflowCommand(structuredClone(command)),
      /protected descriptor-backed command/u,
    );
    assert.throws(
      () => assertV2WorkflowCommandHandle(structuredClone(command)),
      /protected descriptor-backed command/u,
    );

    await assert.rejects(
      prepareV2WorkflowCommand(environment),
      /EEXIST|exist/u,
    );
  });
});

test("closed controller routes map to exact operations and triggers", async (t) => {
  const cases = [
    {
      name: "manual evaluate-only",
      eventName: "workflow_dispatch",
      event: { inputs: { "pull-request": "7" } },
      route: "evaluate-only",
      pullRequest: "7",
      boundary: "initial",
      expected: { operation: "evaluate-only", trigger: "manual" },
    },
    {
      name: "provider event hint",
      eventName: "issue_comment",
      event: { issue: { number: 7, pull_request: { url: "https://api.github.test/pr/7" } } },
      route: "provider-event-hint",
      pullRequest: "7",
      boundary: "initial",
      expected: { operation: "ordinary", trigger: "provider-event" },
    },
    {
      name: "scheduled all-open scan",
      eventName: "schedule",
      event: { schedule: "17 */2 * * *" },
      route: "scan-all-open",
      pullRequest: "",
      boundary: "initial",
      expected: { operation: "ordinary", trigger: "schedule" },
    },
    {
      name: "scheduled single-PR leg",
      eventName: "schedule",
      event: { schedule: "17 */2 * * *" },
      route: "ordinary",
      pullRequest: "7",
      boundary: "initial",
      dispatchBinding: canonicalJson(scheduledDispatchBinding()),
      expected: { operation: "ordinary", trigger: "schedule" },
      expectedDispatchBinding: scheduledDispatchBinding(),
    },
    {
      name: "timer observation",
      eventName: "pull_request_target",
      event: { pull_request: { number: 7 } },
      route: "ordinary",
      pullRequest: "7",
      boundary: "public-initial-wait-complete",
      expected: { operation: "ordinary", trigger: "timer" },
    },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      await withFixture(fixture, async ({ environment }) => {
        const command = await prepareV2WorkflowCommand(environment);
        assert.deepEqual(command.route, {
          ...fixture.expected,
          observation_boundary: fixture.boundary,
        });
        assert.equal(
          command.pull_request.number,
          fixture.pullRequest === "" ? null : 7,
        );
        assert.deepEqual(
          command.dispatch_binding,
          fixture.expectedDispatchBinding ?? null,
        );
        if (fixture.expectedDispatchBinding !== undefined) {
          assert.match(
            digestV2WorkflowCommand(command),
            /^sha256:[0-9a-f]{64}$/u,
          );
          const structuralClone = validateV2WorkflowCommandStructure(
            structuredClone(command),
          );
          assert.deepEqual(structuralClone, command);
          assert.throws(
            () => assertV2WorkflowCommandHandle(structuralClone),
            /protected descriptor-backed command/u,
          );
        }
      });
    });
  }
});

test("manual dispatch requires the pull-request selector accepted by evaluate-only", async () => {
  const reconcile = await readFile(RECONCILE_WORKFLOW_PATH, "utf8");
  assert.match(
    reconcile,
    /^      pull-request:\n        description: [^\n]+\n        required: true\n        type: string$/mu,
  );
  assert.doesNotMatch(
    reconcile,
    /^      pull-request:\n(?:        [^\n]+\n)*        default:/mu,
  );

  await withFixture({
    eventName: "workflow_dispatch",
    event: { inputs: {} },
    route: "evaluate-only",
    pullRequest: "",
  }, async ({ environment }) => {
    await assert.rejects(
      prepareV2WorkflowCommand(environment),
      /evaluate-only requires .* one explicit pull request/u,
    );
  });

  await withFixture({
    eventName: "workflow_dispatch",
    event: { inputs: { "pull-request": "7" } },
    route: "evaluate-only",
    pullRequest: "7",
  }, async ({ environment }) => {
    const command = await prepareV2WorkflowCommand(environment);
    assert.equal(command.pull_request.number, 7);
    assert.deepEqual(command.route, {
      operation: "evaluate-only",
      trigger: "manual",
      observation_boundary: "initial",
    });
  });
});

test("scheduled dispatch binding rejects missing, spurious, and selector-mismatched input", async (t) => {
  await t.test("missing", async () => {
    await withFixture({
      eventName: "schedule",
      event: { schedule: "17 */2 * * *" },
      route: "ordinary",
      pullRequest: "7",
      dispatchBinding: "",
    }, async ({ environment }) => {
      await assert.rejects(
        prepareV2WorkflowCommand(environment),
        /dispatch binding.*required|requires.*dispatch binding/u,
      );
    });
  });

  await t.test("spurious", async () => {
    await withFixture({
      eventName: "pull_request_target",
      event: { pull_request: { number: 7 } },
      route: "ordinary",
      pullRequest: "7",
      dispatchBinding: canonicalJson(scheduledDispatchBinding()),
    }, async ({ environment }) => {
      await assert.rejects(
        prepareV2WorkflowCommand(environment),
        /dispatch binding.*empty|must be null/u,
      );
    });
  });

  await t.test("mismatch", async () => {
    await withFixture({
      eventName: "schedule",
      event: { schedule: "17 */2 * * *" },
      route: "ordinary",
      pullRequest: "7",
      dispatchBinding: canonicalJson(scheduledDispatchBinding({
        candidate: { number: 8 },
      })),
    }, async ({ environment }) => {
      await assert.rejects(
        prepareV2WorkflowCommand(environment),
        /candidate.*trusted pull-request selector/u,
      );
    });
  });
});

test("dispatch binding environment is bounded, exact, canonical, and drift-resistant", async (t) => {
  const binding = scheduledDispatchBinding();
  const fixtureOptions = {
    eventName: "schedule",
    event: { schedule: "17 */2 * * *" },
    route: "ordinary",
    pullRequest: "7",
  };
  const invalidInputs = [
    ["malformed", "{"],
    ["noncanonical", JSON.stringify(binding)],
    ["NUL", `${canonicalJson(binding)}\0`],
    ["CR", `${canonicalJson(binding)}\r`],
    ["LF", `${canonicalJson(binding)}\n`],
    ["oversized", "x".repeat(MAX_V2_WORKFLOW_DISPATCH_BINDING_BYTES + 1)],
    ["extra key", canonicalJson({ ...binding, unexpected: true })],
    ["missing key", canonicalJson((({ dispatch_digest: _digest, ...rest }) =>
      rest)(binding))],
  ];
  assert.notEqual(JSON.stringify(binding), canonicalJson(binding));
  for (const [name, dispatchBinding] of invalidInputs) {
    await t.test(name, async () => {
      await withFixture({ ...fixtureOptions, dispatchBinding }, async ({ environment }) => {
        await assert.rejects(prepareV2WorkflowCommand(environment));
      });
    });
  }

  await t.test("environment drift", async () => {
    await withFixture({
      ...fixtureOptions,
      dispatchBinding: canonicalJson(binding),
    }, async ({ environment }) => {
      const command = await prepareV2WorkflowCommand(environment);
      const drifted = canonicalJson({
        ...binding,
        dispatch_digest: `sha256:${"8".repeat(64)}`,
      });
      assert.throws(
        () => validateV2WorkflowCommand(command, {
          ...environment,
          V2_CONTROLLER_DISPATCH_BINDING: drifted,
        }),
        /exact trusted environment bytes/u,
      );
      await assert.rejects(
        readV2WorkflowCommand({
          ...environment,
          V2_CONTROLLER_DISPATCH_BINDING: drifted,
        }),
        /exact trusted environment bytes/u,
      );
    });
  });

  await t.test("command drift", async () => {
    await withFixture({
      ...fixtureOptions,
      dispatchBinding: canonicalJson(binding),
    }, async ({ environment }) => {
      const command = await prepareV2WorkflowCommand(environment);
      assert.throws(
        () => validateV2WorkflowCommand({
          ...command,
          dispatch_binding: {
            ...command.dispatch_binding,
            dispatch_digest: `sha256:${"8".repeat(64)}`,
          },
        }, environment),
        /exact trusted environment bytes/u,
      );
    });
  });
});

test("route, selector, caller, and receipt-policy mismatches fail closed", async () => {
  await withFixture({
    eventName: "issue_comment",
    event: { issue: { number: 8, pull_request: { url: "https://api.github.test/pr/8" } } },
    route: "provider-event-hint",
    pullRequest: "7",
  }, async ({ environment }) => {
    await assert.rejects(
      prepareV2WorkflowCommand(environment),
      /does not match the trusted selector/u,
    );
  });

  await withFixture({
    eventName: "workflow_dispatch",
    event: { inputs: { "pull-request": "7" } },
    route: "ordinary",
    pullRequest: "7",
  }, async ({ environment }) => {
    await assert.rejects(
      prepareV2WorkflowCommand(environment),
      /matching closed controller route/u,
    );
  });

  await withFixture({
    eventName: "pull_request_target",
    event: { pull_request: { number: 7 } },
    route: "ordinary",
    pullRequest: "7",
  }, async ({ environment }) => {
    const command = await prepareV2WorkflowCommand(environment);
    assert.throws(
      () => validateV2WorkflowCommand({
        ...command,
        receipt_policy: {
          ...command.receipt_policy,
          public_wait: "repository-variable-says-ok",
        },
      }, environment),
      /closed live-API policy/u,
    );
    assert.throws(
      () => validateV2WorkflowCommand({
        ...command,
        workflow_receipt: {
          ...command.workflow_receipt,
          caller_workflow_sha: "e".repeat(40),
        },
      }, environment),
      /actual caller workflow identity/u,
    );
    assert.throws(
      () => validateV2WorkflowCommand({ ...command, unexpected: true }, environment),
      /keys are not exact/u,
    );
    assert.throws(
      () => validateV2WorkflowCommand({
        ...command,
        selection_policy: "manual-route-means-explicit",
      }, environment),
      /selection_policy/u,
    );
    assert.throws(
      () => validateV2WorkflowCommand(command, {
        ...environment,
        V2_SELECTION_POLICY: "user-explicit",
      }),
      /selection policy does not match/u,
    );
  });
});

test("reader rejects checkout paths, symlinks, hardlinks, loose mode, and event drift", async () => {
  await withFixture({
    eventName: "pull_request_target",
    event: { pull_request: { number: 7 } },
    route: "ordinary",
    pullRequest: "7",
  }, async ({ root, workspace, environment, inputPath, eventPath }) => {
    const command = await prepareV2WorkflowCommand(environment);

    const checkoutPath = join(workspace, "command.json");
    await writeFile(checkoutPath, `${canonicalJson(command)}\n`, { mode: 0o600 });
    await assert.rejects(
      readV2WorkflowCommand({
        ...environment,
        V2_CONTROLLER_INPUT_PATH: checkoutPath,
      }),
      /must resolve inside RUNNER_TEMP/u,
    );

    const linked = join(root, "runner-temp", "hardlinked.json");
    await link(inputPath, linked);
    await assert.rejects(
      readV2WorkflowCommand(environment),
      /one link/u,
    );
    await rm(linked);

    await chmod(inputPath, 0o644);
    await assert.rejects(
      readV2WorkflowCommand(environment),
      /mode 600/u,
    );
    await chmod(inputPath, 0o600);

    await writeFile(eventPath, JSON.stringify({ pull_request: { number: 8 } }));
    await assert.rejects(
      readV2WorkflowCommand(environment),
      /current advisory event bytes/u,
    );

    const symlinkPath = join(root, "runner-temp", "command-link.json");
    await symlink(inputPath, symlinkPath);
    await assert.rejects(
      readV2WorkflowCommand({
        ...environment,
        V2_CONTROLLER_INPUT_PATH: symlinkPath,
      }),
      /ordinary non-symlink/u,
    );
  });
});

test("subprocess preparation succeeds and production run remains fail-closed without live assembler", async () => {
  await withFixture({
    eventName: "pull_request_target",
    event: { pull_request: { number: 7 } },
    route: "ordinary",
    pullRequest: "7",
  }, async ({ environment, inputPath }) => {
    const prepared = spawnSync(
      process.execPath,
      [CONTROLLER_PATH.pathname, "prepare-command"],
      { env: { ...process.env, ...environment }, encoding: "utf8" },
    );
    assert.equal(prepared.status, 0, prepared.stderr);
    assert.equal((await lstat(inputPath)).isFile(), true);

    const run = spawnSync(
      process.execPath,
      [CONTROLLER_PATH.pathname, "run"],
      { env: { ...process.env, ...environment }, encoding: "utf8" },
    );
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /^::error::/u);
  });
});

async function withFixture(options, callback) {
  const root = await mkdtemp(join(tmpdir(), "codex-review-gate-v2-command-"));
  const runnerTemp = join(root, "runner-temp");
  const workspace = join(root, "workspace");
  await mkdir(runnerTemp);
  await mkdir(workspace);
  const inputPath = join(runnerTemp, "command.json");
  const eventPath = join(root, "event.json");
  const eventBytes = Buffer.from(JSON.stringify(options.event), "utf8");
  await writeFile(eventPath, eventBytes, { mode: 0o600 });
  const environment = {
    RUNNER_TEMP: runnerTemp,
    GITHUB_WORKSPACE: workspace,
    GITHUB_REPOSITORY: "owner/repo",
    GITHUB_EVENT_NAME: options.eventName,
    GITHUB_RUN_ID: "123456",
    GITHUB_RUN_ATTEMPT: "2",
    GITHUB_ACTOR_ID: "789",
    GITHUB_WORKFLOW_REF:
      "owner/repo/.github/workflows/codex-review-gate-reconcile.yml@refs/heads/main",
    GITHUB_WORKFLOW_SHA: CALLER_SHA,
    GITHUB_SHA: "9".repeat(40),
    V2_CONTROLLER_EVENT_PATH: eventPath,
    V2_CONTROLLER_INPUT_PATH: inputPath,
    V2_CONTROLLER_OUTPUT_PATH: join(runnerTemp, "output.json"),
    V2_CONTROLLER_ROUTE: options.route,
    V2_CONTROLLER_OBSERVATION_BOUNDARY: options.boundary ?? "initial",
    V2_CONTROLLER_PULL_REQUEST: options.pullRequest,
    V2_CONTROLLER_DISPATCH_BINDING: options.dispatchBinding ?? "",
    V2_SELECTION_POLICY: options.selectionPolicy ?? "joey-default",
    V2_STATUS_CONTEXT,
    V2_STATUS_TARGET_MODE,
    V2_EXPECTED_WORKFLOW_REPOSITORY: "Joey-Tools/codex-review-gate-action",
    V2_ACTUAL_WORKFLOW_REPOSITORY: "Joey-Tools/codex-review-gate-action",
    V2_EXPECTED_WORKFLOW_PATH: V2_WORKFLOW_PATH,
    V2_EXPECTED_WORKFLOW_SHA: SHA,
    V2_CHECKED_OUT_RELEASE_SHA: SHA,
    V2_PUBLIC_WAIT_PREFLIGHT_REQUIRED: "true",
    V2_PUBLIC_WAIT_MINUTES: "15",
    V2_PUBLIC_WAIT_ENVIRONMENT_INITIAL: "codex-review-gate-public-initial-15m",
    V2_PUBLIC_WAIT_ENVIRONMENT_POST_REQUEST:
      "codex-review-gate-public-post-request-15m",
    V2_PUBLIC_WAIT_ENVIRONMENT_NO_START:
      "codex-review-gate-public-no-start-15m",
  };
  try {
    await callback({
      root,
      runnerTemp,
      workspace,
      inputPath,
      eventPath,
      eventBytes,
      environment,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
