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
import {
  validateV2GitLedgerCandidateDispatchBinding,
} from "../packages/action/src/v2/git-ledger.mjs";

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

function currentOpenScheduledDispatchBinding() {
  const sourceGenerationRecordOid = "a".repeat(40);
  const repository = {
    owner: "owner",
    name: "repo",
    id: "42",
    node_id: "R_repo",
    owner_id: "88",
  };
  const identity = {
    id: "7001",
    node_id: "PR_kwDOExample7",
    number: 7,
    created_at: "2026-08-13T11:59:00.000Z",
  };
  const lifecycleSeed = {
    state: "open",
    updated_at: "2026-08-13T12:00:00.000Z",
    draft: false,
    base: {
      ref: "main",
      sha: "6".repeat(40),
      repo: { id: "42", node_id: "R_base", full_name: "owner/repo" },
    },
    head: {
      ref: "feature",
      sha: "5".repeat(40),
      repo: { id: "42", node_id: "R_head", full_name: "owner/repo" },
    },
  };
  const identityDigest = currentOpenDigest(
    "codex-review-gate-v2-production-candidate-identity",
    identity,
  );
  const lifecycleSeedDigest = currentOpenDigest(
    "codex-review-gate-v2-production-candidate-lifecycle-seed",
    { identity, lifecycle_seed: lifecycleSeed },
  );
  const lifecycleGenerationId = currentOpenLifecycleGenerationId(
    repository,
    identityDigest,
  );
  const candidateWithoutDigest = {
    schema: "codex-review-gate-git-ledger-candidate-dispatch-selection-v2",
    schema_version: 2,
    source_generation_record_oid: sourceGenerationRecordOid,
    identity,
    identity_digest: identityDigest,
    lifecycle_seed: lifecycleSeed,
    lifecycle_seed_digest: lifecycleSeedDigest,
    lifecycle_generation_id: lifecycleGenerationId,
  };
  const candidate = {
    ...candidateWithoutDigest,
    selection_digest: ledgerDigest(
      "codex-review-gate-v2-current-open-dispatch-selection",
      {
        source_generation_record_oid: sourceGenerationRecordOid,
        identity_digest: identityDigest,
        lifecycle_seed_digest: lifecycleSeedDigest,
        lifecycle_generation_id:
          candidateWithoutDigest.lifecycle_generation_id,
      },
    ),
  };
  const withoutDigest = {
    schema: "codex-review-gate-git-ledger-candidate-dispatch-binding-v2",
    schema_version: 2,
    repository,
    generation_id: `candidate-dispatch:${"1".repeat(64)}`,
    cycle_id: `candidate-cycle:${"2".repeat(64)}`,
    candidate_source: {
      schema: "codex-review-gate-git-ledger-candidate-dispatch-source-v2",
      schema_version: 2,
      source_profile: "stable-graphql-current-open-v4",
      source_generation_id: `candidate-source:${"3".repeat(64)}`,
      source_generation_record_oid: sourceGenerationRecordOid,
      source_generation_digest: `sha256:${"4".repeat(64)}`,
      production_candidate_authority_digest: `sha256:${"5".repeat(64)}`,
      candidate_set_digest: `sha256:${"6".repeat(64)}`,
      source_current_open_semantic_digest: `sha256:${"7".repeat(64)}`,
      lifecycle_candidate_set_digest: `sha256:${"8".repeat(64)}`,
    },
    candidate_inventory_authority_digest: `sha256:${"9".repeat(64)}`,
    candidate_dispatch_authority_digest: `sha256:${"a".repeat(64)}`,
    inventory_digest: `sha256:${"b".repeat(64)}`,
    reservation_record_oid: "c".repeat(40),
    reservation_digest: `sha256:${"c".repeat(64)}`,
    dispatch_digest: `sha256:${"d".repeat(64)}`,
    batch_index: 0,
    batch_count: 1,
    candidate_index: 0,
    candidate,
  };
  return {
    ...withoutDigest,
    binding_digest: ledgerDigest(
      "codex-review-gate-v2-current-open-candidate-dispatch-binding",
      withoutDigest,
    ),
  };
}

function oversizedCurrentOpenScheduledDispatchBinding() {
  const binding = currentOpenScheduledDispatchBinding();
  binding.repository.node_id = "R".repeat(256);
  binding.candidate.identity.node_id = "I".repeat(256);
  binding.candidate.lifecycle_seed.base.ref = "b".repeat(255);
  binding.candidate.lifecycle_seed.base.repo.node_id = "B".repeat(256);
  binding.candidate.lifecycle_seed.base.repo.full_name = "b".repeat(256);
  binding.candidate.lifecycle_seed.head.ref = "h".repeat(255);
  binding.candidate.lifecycle_seed.head.repo.node_id = "H".repeat(256);
  binding.candidate.lifecycle_seed.head.repo.full_name = "h".repeat(256);
  resealCurrentOpenCandidateDigests(binding);
  resealCurrentOpenDispatchBinding(binding);
  return binding;
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

test("versioned current-open dispatch binding survives protected command publication", async () => {
  const binding = currentOpenScheduledDispatchBinding();
  assert.deepEqual(validateV2GitLedgerCandidateDispatchBinding(binding), binding);
  await withFixture({
    eventName: "schedule",
    event: { schedule: "17 */2 * * *" },
    route: "ordinary",
    pullRequest: "7",
    dispatchBinding: canonicalJson(binding),
  }, async ({ environment }) => {
    const command = await prepareV2WorkflowCommand(environment);
    assert.deepEqual(command.dispatch_binding, binding);
    assert.deepEqual(Object.keys(command.dispatch_binding).sort(), [
      "batch_count",
      "batch_index",
      "binding_digest",
      "candidate",
      "candidate_dispatch_authority_digest",
      "candidate_index",
      "candidate_inventory_authority_digest",
      "candidate_source",
      "cycle_id",
      "dispatch_digest",
      "generation_id",
      "inventory_digest",
      "repository",
      "reservation_digest",
      "reservation_record_oid",
      "schema",
      "schema_version",
    ]);
    assert.deepEqual(Object.keys(command.dispatch_binding.candidate_source).sort(), [
      "candidate_set_digest",
      "lifecycle_candidate_set_digest",
      "production_candidate_authority_digest",
      "schema",
      "schema_version",
      "source_current_open_semantic_digest",
      "source_generation_digest",
      "source_generation_id",
      "source_generation_record_oid",
      "source_profile",
    ]);
    assert.deepEqual(Object.keys(command.dispatch_binding.candidate).sort(), [
      "identity",
      "identity_digest",
      "lifecycle_generation_id",
      "lifecycle_seed",
      "lifecycle_seed_digest",
      "schema",
      "schema_version",
      "selection_digest",
      "source_generation_record_oid",
    ]);
    assert.deepEqual(
      validateV2WorkflowCommandStructure(structuredClone(command)),
      command,
    );
    assert.equal(Object.isFrozen(command.dispatch_binding.candidate_source), true);
    assert.equal(Object.isFrozen(command.dispatch_binding.candidate), true);
  });
});

test("structure validation rejects a canonical versioned dispatch binding over the byte cap", async () => {
  const binding = currentOpenScheduledDispatchBinding();
  const oversizedBinding = oversizedCurrentOpenScheduledDispatchBinding();
  const oversizedJson = canonicalJson(oversizedBinding);
  assert.ok(
    Buffer.byteLength(oversizedJson, "utf8") >
      MAX_V2_WORKFLOW_DISPATCH_BINDING_BYTES,
  );
  assert.equal(canonicalJson(JSON.parse(oversizedJson)), oversizedJson);
  await withFixture({
    eventName: "schedule",
    event: { schedule: "17 */2 * * *" },
    route: "ordinary",
    pullRequest: "7",
    dispatchBinding: canonicalJson(binding),
  }, async ({ environment }) => {
    const command = await prepareV2WorkflowCommand(environment);
    assert.throws(
      () => validateV2WorkflowCommandStructure({
        ...structuredClone(command),
        dispatch_binding: oversizedBinding,
      }),
      /workflow command\.dispatch_binding exceeds its 4096-byte bound/u,
    );
  });
});

test("versioned current-open dispatch binding rejects closed-schema and lineage substitutions", async (t) => {
  const cases = [
    {
      name: "binding digest tamper",
      mutate(binding) {
        binding.binding_digest = `sha256:${"f".repeat(64)}`;
      },
      pattern: /binding_digest is invalid/u,
    },
    {
      name: "extra top-level key",
      mutate(binding) {
        binding.unexpected = true;
      },
      pattern: /keys are not exact/u,
    },
    {
      name: "missing top-level key",
      mutate(binding) {
        delete binding.reservation_digest;
      },
      pattern: /keys are not exact/u,
    },
    {
      name: "unsupported top-level version",
      mutate(binding) {
        binding.schema_version = 3;
      },
      pattern: /keys are not exact/u,
    },
    {
      name: "legacy envelope with versioned candidate downgrade",
      createBinding() {
        const versioned = currentOpenScheduledDispatchBinding();
        return {
          generation_id: versioned.generation_id,
          cycle_id: versioned.cycle_id,
          inventory_digest: versioned.inventory_digest,
          batch_index: versioned.batch_index,
          batch_count: versioned.batch_count,
          dispatch_digest: versioned.dispatch_digest,
          candidate: versioned.candidate,
        };
      },
      pattern: /candidate keys are not exact/u,
    },
    {
      name: "extra source key",
      mutate(binding) {
        binding.candidate_source.unexpected = true;
      },
      pattern: /candidate_source keys are not exact/u,
    },
    {
      name: "missing source key",
      mutate(binding) {
        delete binding.candidate_source.source_generation_digest;
      },
      pattern: /candidate_source keys are not exact/u,
    },
    {
      name: "missing source schema version",
      mutate(binding) {
        delete binding.candidate_source.schema_version;
        resealCurrentOpenDispatchBinding(binding);
      },
      pattern: /candidate_source keys are not exact/u,
    },
    {
      name: "unsupported source schema version",
      mutate(binding) {
        binding.candidate_source.schema_version = 3;
        resealCurrentOpenDispatchBinding(binding);
      },
      pattern: /candidate_source schema or generation is invalid/u,
    },
    {
      name: "unsupported source profile",
      mutate(binding) {
        binding.candidate_source.source_profile = "legacy-rest";
      },
      pattern: /candidate_source schema or generation is invalid/u,
    },
    {
      name: "extra candidate key",
      mutate(binding) {
        binding.candidate.unexpected = true;
      },
      pattern: /candidate keys are not exact/u,
    },
    {
      name: "missing candidate key",
      mutate(binding) {
        delete binding.candidate.lifecycle_generation_id;
      },
      pattern: /candidate keys are not exact/u,
    },
    {
      name: "missing candidate schema version",
      mutate(binding) {
        delete binding.candidate.schema_version;
        resealCurrentOpenDispatchBinding(binding);
      },
      pattern: /candidate keys are not exact/u,
    },
    {
      name: "unsupported candidate schema version",
      mutate(binding) {
        binding.candidate.schema_version = 3;
        resealCurrentOpenDispatchBinding(binding);
      },
      pattern: /candidate schema is invalid/u,
    },
    {
      name: "candidate identity digest mismatch",
      mutate(binding) {
        binding.candidate.identity.node_id = "PR_kwDOExample8";
        resealCurrentOpenDispatchBinding(binding);
      },
      pattern: /identity_digest is invalid/u,
    },
    {
      name: "candidate selection digest mismatch",
      mutate(binding) {
        binding.candidate.selection_digest = `sha256:${"e".repeat(64)}`;
        resealCurrentOpenDispatchBinding(binding);
      },
      pattern: /selection_digest is invalid/u,
    },
    {
      name: "cross-source candidate substitution",
      mutate(binding) {
        binding.candidate.source_generation_record_oid = "e".repeat(40);
        resealCurrentOpenCandidateSelection(binding);
        resealCurrentOpenDispatchBinding(binding);
      },
      pattern: /changes its source generation/u,
    },
    {
      name: "lifecycle generation substitution",
      mutate(binding) {
        binding.candidate.lifecycle_generation_id =
          `candidate-lifecycle:${"f".repeat(64)}`;
        resealCurrentOpenCandidateSelection(binding);
        resealCurrentOpenDispatchBinding(binding);
      },
      pattern: /changes its lifecycle identity/u,
    },
    {
      name: "lifecycle seed substitution",
      mutate(binding) {
        binding.candidate.lifecycle_seed.head.sha = "e".repeat(40);
        resealCurrentOpenDispatchBinding(binding);
      },
      pattern: /lifecycle_seed_digest is invalid/u,
    },
    {
      name: "non-normalized identity timestamp spelling",
      mutate(binding) {
        binding.candidate.identity.created_at = "2026-08-13T11:59:00Z";
        resealCurrentOpenCandidateDigests(binding);
        resealCurrentOpenDispatchBinding(binding);
      },
      pattern: /normalized millisecond UTC form/u,
    },
    {
      name: "non-normalized lifecycle timestamp spelling",
      mutate(binding) {
        binding.candidate.lifecycle_seed.updated_at =
          "2026-08-13T12:00:00Z";
        resealCurrentOpenCandidateDigests(binding);
        resealCurrentOpenDispatchBinding(binding);
      },
      ledgerPattern: /canonical millisecond UTC representation/u,
      pattern: /normalized millisecond UTC form/u,
    },
    {
      name: "repository substitution",
      mutate(binding) {
        binding.repository.owner = "another-owner";
        binding.candidate.lifecycle_generation_id =
          currentOpenLifecycleGenerationId(
            binding.repository,
            binding.candidate.identity_digest,
          );
        resealCurrentOpenCandidateSelection(binding);
        resealCurrentOpenDispatchBinding(binding);
      },
      pattern: /repository does not match the workflow command repository/u,
    },
    {
      name: "candidate selector substitution",
      mutate(binding) {
        binding.candidate.identity.number = 8;
        resealCurrentOpenCandidateDigests(binding);
        resealCurrentOpenDispatchBinding(binding);
      },
      pattern: /candidate does not match the trusted pull-request selector/u,
    },
    {
      name: "candidate authority digest tamper",
      mutate(binding) {
        binding.candidate_inventory_authority_digest =
          `sha256:${"e".repeat(64)}`;
      },
      pattern: /binding_digest is invalid/u,
    },
    {
      name: "reservation identity tamper",
      mutate(binding) {
        binding.reservation_record_oid = "not-an-object-id";
      },
      pattern: /reservation_record_oid/u,
    },
    {
      name: "candidate index outside batch",
      mutate(binding) {
        binding.candidate_index = 64;
        resealCurrentOpenDispatchBinding(binding);
      },
      pattern: /batch identity is invalid/u,
    },
  ];

  for (const selected of cases) {
    await t.test(selected.name, async () => {
      const binding = selected.createBinding?.() ??
        currentOpenScheduledDispatchBinding();
      selected.mutate?.(binding);
      if (selected.ledgerPattern) {
        assert.throws(
          () => validateV2GitLedgerCandidateDispatchBinding(
            structuredClone(binding),
          ),
          selected.ledgerPattern,
        );
      }
      await withFixture({
        eventName: "schedule",
        event: { schedule: "17 */2 * * *" },
        route: "ordinary",
        pullRequest: "7",
        dispatchBinding: canonicalJson(binding),
      }, async ({ environment }) => {
        await assert.rejects(
          prepareV2WorkflowCommand(environment),
          selected.pattern,
        );
      });
    });
  }
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
  const oversizedBinding = oversizedCurrentOpenScheduledDispatchBinding();
  const oversizedDispatchBinding = canonicalJson(oversizedBinding);
  assert.ok(
    Buffer.byteLength(oversizedDispatchBinding, "utf8") >
      MAX_V2_WORKFLOW_DISPATCH_BINDING_BYTES,
  );
  assert.equal(
    canonicalJson(JSON.parse(oversizedDispatchBinding)),
    oversizedDispatchBinding,
  );
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
    [
      "oversized",
      oversizedDispatchBinding,
      /exceeds its 4096-byte bound/u,
    ],
    ["extra key", canonicalJson({ ...binding, unexpected: true })],
    ["missing key", canonicalJson((({ dispatch_digest: _digest, ...rest }) =>
      rest)(binding))],
    [
      "extra legacy candidate key",
      canonicalJson({
        ...binding,
        candidate: { ...binding.candidate, unexpected: true },
      }),
      /workflow command\.dispatch_binding\.candidate keys are not exact/u,
    ],
    [
      "missing legacy candidate key",
      canonicalJson({
        ...binding,
        candidate: (({ node_id: _nodeId, ...rest }) => rest)(
          binding.candidate,
        ),
      }),
      /workflow command\.dispatch_binding\.candidate keys are not exact/u,
    ],
  ];
  assert.notEqual(JSON.stringify(binding), canonicalJson(binding));
  for (const [name, dispatchBinding, pattern] of invalidInputs) {
    await t.test(name, async () => {
      await withFixture({ ...fixtureOptions, dispatchBinding }, async ({ environment }) => {
        if (pattern) {
          await assert.rejects(prepareV2WorkflowCommand(environment), pattern);
        } else {
          await assert.rejects(prepareV2WorkflowCommand(environment));
        }
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

test("reader rejects a leading UTF-8 BOM without rejecting U+FEFF in advisory data", async () => {
  await withFixture({
    eventName: "pull_request_target",
    event: { note: "legal \uFEFF data", pull_request: { number: 7 } },
    route: "ordinary",
    pullRequest: "7",
  }, async ({ environment, inputPath, eventBytes }) => {
    const command = await prepareV2WorkflowCommand(environment);
    assert.equal(command.invocation.event_payload_sha256, sha256(eventBytes));

    const commandBytes = await readFile(inputPath);
    await writeFile(
      inputPath,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), commandBytes]),
      { mode: 0o600 },
    );
    await assert.rejects(
      readV2WorkflowCommand(environment),
      /not exact JSON|canonical sorted compact JSON|not valid UTF-8/u,
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

function ledgerDigest(domain, value) {
  return sha256(`${domain}\0${canonicalJson(value)}`);
}

function currentOpenDigest(domain, value) {
  return sha256(`${domain}\n${canonicalJson(value)}\n`);
}

function resealCurrentOpenCandidateSelection(binding) {
  const candidate = binding.candidate;
  candidate.selection_digest = ledgerDigest(
    "codex-review-gate-v2-current-open-dispatch-selection",
    {
      source_generation_record_oid: candidate.source_generation_record_oid,
      identity_digest: candidate.identity_digest,
      lifecycle_seed_digest: candidate.lifecycle_seed_digest,
      lifecycle_generation_id: candidate.lifecycle_generation_id,
    },
  );
  return binding;
}

function resealCurrentOpenCandidateDigests(binding) {
  const candidate = binding.candidate;
  candidate.identity_digest = currentOpenDigest(
    "codex-review-gate-v2-production-candidate-identity",
    candidate.identity,
  );
  candidate.lifecycle_seed_digest = currentOpenDigest(
    "codex-review-gate-v2-production-candidate-lifecycle-seed",
    {
      identity: candidate.identity,
      lifecycle_seed: candidate.lifecycle_seed,
    },
  );
  candidate.lifecycle_generation_id = currentOpenLifecycleGenerationId(
    binding.repository,
    candidate.identity_digest,
  );
  return resealCurrentOpenCandidateSelection(binding);
}

function currentOpenLifecycleGenerationId(repository, identityDigest) {
  return `candidate-lifecycle:${ledgerDigest(
    "codex-review-gate-v2-current-open-lifecycle-generation",
    {
      repository: {
        owner: repository.owner,
        name: repository.name,
        id: repository.id,
        node_id: repository.node_id,
      },
      identity_digest: identityDigest,
    },
  ).slice("sha256:".length)}`;
}

function resealCurrentOpenDispatchBinding(binding) {
  const { binding_digest: _digest, ...withoutDigest } = binding;
  binding.binding_digest = ledgerDigest(
    "codex-review-gate-v2-current-open-candidate-dispatch-binding",
    withoutDigest,
  );
  return binding;
}
