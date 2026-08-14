import assert from "node:assert/strict";
import test from "node:test";

import {
  V2_WORKFLOW_PREFLIGHT_INTEGRATION_ID,
  V2_WORKFLOW_PREFLIGHT_LEDGER_REF,
  V2_WORKFLOW_PREFLIGHT_OIDC_AUDIENCE,
  V2_WORKFLOW_PREFLIGHT_SCHEMA,
  V2_WORKFLOW_PREFLIGHT_STATUS_CONTEXT,
  assertV2BlockedConfigurationWorkflowResultHandle,
  assertV2WorkflowGitLedgerHandoffHandle,
  assertV2WorkflowPreflightHandle,
  createV2BlockedConfigurationWorkflowResult,
  createV2GitHubWorkflowPreflight,
  createV2WorkflowGitLedgerHandoff,
} from "../packages/action/src/v2/workflow-preflight.mjs";
import {
  V2_GIT_LEDGER_OIDC_AUDIENCE,
  V2_GIT_LEDGER_OIDC_CLAIMS,
  digestV2GitLedgerStableCapabilityAuthorization,
  validateV2GitLedgerBootstrapInput,
} from
  "../packages/action/src/v2/git-ledger.mjs";
import {
  V2_PUBLIC_WAIT_POLICY,
  V2_SELECTION_POLICIES,
  V2_SERVER_ENFORCEMENT_POLICY,
} from
  "../packages/action/src/v2/workflow-command.mjs";

const CALLED_SHA = "a".repeat(40);
const CALLER_SHA = "b".repeat(40);
const LEDGER_SHA = "c".repeat(40);
const DATE = "Thu, 13 Aug 2026 12:00:00 GMT";
const REPOSITORY = "acme/widget";
const CALLER_PATH = ".github/workflows/caller.yml";
const SYNTHETIC_BEARER = Object.freeze({
  catalog_id: "bearer-a",
  value: "codex_synth_v1_bearer_a",
});
const ENVIRONMENTS = [
  ["initial", "codex-review-gate-public-initial-15m", 101, 201],
  ["post-request", "codex-review-gate-public-post-request-15m", 102, 202],
  ["no-start", "codex-review-gate-public-no-start-15m", 103, 203],
];

test("shares the single Git-ledger OIDC audience authority", () => {
  assert.equal(
    V2_WORKFLOW_PREFLIGHT_OIDC_AUDIENCE,
    V2_GIT_LEDGER_OIDC_AUDIENCE,
  );
});

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

function command({
  manual = false,
  selectionPolicy = "joey-default",
  scheduled = false,
  dispatchBinding = scheduled ? scheduledDispatchBinding() : null,
} = {}) {
  return {
    schema: "codex-review-gate-workflow-command-v2",
    schema_version: 1,
    command: "run",
    selection_policy: selectionPolicy,
    repository: { owner: "acme", name: "widget" },
    pull_request: { number: 7 },
    dispatch_binding: dispatchBinding,
    route: {
      operation: manual ? "evaluate-only" : "ordinary",
      trigger: manual ? "manual" : scheduled ? "schedule" : "initial",
      observation_boundary: "initial",
    },
    invocation: {
      event_name: manual
        ? "workflow_dispatch"
        : scheduled ? "schedule" : "pull_request_target",
      event_payload_sha256: `sha256:${"0".repeat(64)}`,
      run_id: "1",
      run_attempt: 1,
      actor_id: "1234",
    },
    workflow_receipt: {
      present: true,
      compatible: true,
      source: "trusted-reusable-workflow",
      repository: "Joey-Tools/codex-review-gate-action",
      path: ".github/workflows/codex-review-gate.yml",
      revision: CALLED_SHA,
      checkout_sha: CALLED_SHA,
      caller_repository: REPOSITORY,
      caller_workflow_ref: `${REPOSITORY}/${CALLER_PATH}@refs/heads/main`,
      caller_workflow_sha: CALLER_SHA,
      status_context: V2_WORKFLOW_PREFLIGHT_STATUS_CONTEXT,
      status_target_mode: "test-merge-with-head-sentinel",
    },
    receipt_policy: {
      server_enforcement: V2_SERVER_ENFORCEMENT_POLICY,
      public_wait: V2_PUBLIC_WAIT_POLICY,
    },
  };
}

function alteredCommand(value, mutate) {
  const clone = structuredClone(value);
  mutate(clone);
  return clone;
}

function effectiveRule(type, id, parameters = null) {
  return {
    type,
    enforcement: "active",
    ruleset_id: id,
    ruleset_name: `Rules ${id}`,
    ruleset_source_type: "Repository",
    ruleset_source: REPOSITORY,
    ...(parameters === null ? {} : { parameters }),
  };
}

function statusRule(id = 10, integrationId = V2_WORKFLOW_PREFLIGHT_INTEGRATION_ID) {
  return effectiveRule("required_status_checks", id, {
    required_status_checks: [{
      context: V2_WORKFLOW_PREFLIGHT_STATUS_CONTEXT,
      integration_id: integrationId,
    }],
  });
}

function workflowPinRule(id = 11, revision = CALLED_SHA) {
  return effectiveRule("workflows", id, {
    workflows: [{
      path: ".github/workflows/codex-review-gate.yml",
      ref: revision,
      repository_id: 900,
      sha: revision,
    }],
  });
}

function ledgerRules() {
  return [
    effectiveRule("deletion", 30),
    effectiveRule("non_fast_forward", 30),
  ];
}

function bootstrapRuleset({
  include = [V2_WORKFLOW_PREFLIGHT_LEDGER_REF],
  exclude = [],
  rules = [{ type: "deletion" }, { type: "non_fast_forward" }],
  bypassActors = [],
} = {}) {
  return {
    id: 30,
    name: "Codex ledger protection",
    target: "branch",
    source_type: "Repository",
    source: REPOSITORY,
    enforcement: "active",
    bypass_actors: bypassActors,
    conditions: { ref_name: { include, exclude } },
    rules,
  };
}

function makeFixture(overrides = {}) {
  const config = {
    visibility: "public",
    permissions: { admin: false, maintain: false, push: true, triage: true, pull: true },
    workflowStatus: 200,
    contentStatus: 200,
    workflowState: "active",
    usesRevision: CALLED_SHA,
    defaultRulePages: [[statusRule(), workflowPinRule()]],
    ledgerPresent: true,
    ledgerRulePages: [ledgerRules()],
    rulesetPages: [[bootstrapRuleset()]],
    rulesetDetails: new Map([["30", bootstrapRuleset()]]),
    environmentInventory: ENVIRONMENTS.map(([, name, id]) => ({ name, id })),
    environmentDetails: new Map(ENVIRONMENTS.map(([stage, name, id, ruleId]) => [
      name,
      {
        id,
        name,
        protection_rules: [{ id: ruleId, type: "wait_timer", wait_timer: 15 }],
        stage,
      },
    ])),
    intercept: null,
    repositoryOwner: { id: 77, login: "acme" },
    ...overrides,
  };
  const respond = (status, body, options = {}) => response(status, body, {
    date: config.responseDate ?? DATE,
    jsonSpacing: config.jsonSpacing ?? 0,
    ...options,
  });
  const calls = [];
  const fetch = async (urlValue, options) => {
    const url = new URL(urlValue);
    calls.push({ url, options });
    const intercepted = config.intercept?.(url, options);
    if (intercepted !== undefined && intercepted !== null) {
      return respond(intercepted.status, intercepted.body, intercepted);
    }
    const path = url.pathname;
    const page = Number(url.searchParams.get("page") ?? "1");
    if (path === "/repos/acme/widget") {
      return respond(200, {
        id: 42,
        full_name: REPOSITORY,
        node_id: "R_kgDOExample",
        visibility: config.visibility,
        private: config.visibility === "private",
        default_branch: "main",
        permissions: config.permissions,
        owner: config.repositoryOwner,
      });
    }
    if (path === "/repos/Joey-Tools/codex-review-gate-action") {
      return respond(200, {
        id: 900,
        node_id: "R_release",
        full_name: "Joey-Tools/codex-review-gate-action",
      });
    }
    if (path ===
        "/repos/Joey-Tools/codex-review-gate-action/contents/.github/workflows/codex-review-gate.yml") {
      const yaml = [
        "name: Codex Review Gate v2",
        "permissions:",
        "  contents: write",
        "  id-token: write",
        "  issues: write",
        "  pull-requests: write",
        "  statuses: write",
        "jobs:",
        "  gate:",
        "    runs-on: ubuntu-slim",
        "",
      ].join("\n");
      return respond(200, {
        type: "file",
        path: ".github/workflows/codex-review-gate.yml",
        encoding: "base64",
        content: Buffer.from(yaml).toString("base64"),
        sha: "e".repeat(40),
      });
    }
    if (path === "/apps/github-actions") {
      return respond(200, {
        id: 15368,
        node_id: "MDExOkludGVncmF0aW9uMTUzNjg=",
        slug: "github-actions",
      });
    }
    if (path === "/apps/chatgpt-codex-connector") {
      return respond(200, config.providerApp ?? {
        id: 1144995,
        node_id: "A_kwHOAOQ6Gs4AEXij",
        slug: "chatgpt-codex-connector",
      });
    }
    if (path === "/users/chatgpt-codex-connector%5Bbot%5D") {
      return respond(200, config.providerActor ?? {
        id: 199175422,
        node_id: "BOT_kgDOC98s_g",
        login: "chatgpt-codex-connector[bot]",
        type: "Bot",
      });
    }
    if (path === "/repos/acme/widget/actions/oidc/customization/sub") {
      return respond(200, {
        use_default: false,
        include_claim_keys: ["repo", "job_workflow_ref"],
      });
    }
    if (path === "/repos/acme/widget/actions/workflows/caller.yml") {
      return respond(config.workflowStatus, config.workflowStatus === 200 ? {
        id: 1,
        node_id: "W_example",
        path: CALLER_PATH,
        state: config.workflowState,
      } : { message: "Not Found" });
    }
    if (path === "/repos/acme/widget/contents/.github/workflows/caller.yml") {
      const yaml = [
        "name: caller",
        "jobs:",
        "  gate:",
        `    uses: Joey-Tools/codex-review-gate-action/.github/workflows/codex-review-gate.yml@${config.usesRevision}`,
        "",
      ].join("\n");
      return respond(config.contentStatus, config.contentStatus === 200 ? {
        type: "file",
        path: CALLER_PATH,
        encoding: "base64",
        content: Buffer.from(yaml).toString("base64"),
        sha: "d".repeat(40),
      } : { message: "Not Found" });
    }
    if (path === "/repos/acme/widget/rules/branches/main") {
      return respond(200, config.defaultRulePages[page - 1] ?? []);
    }
    if (path === "/repos/acme/widget/branches/codex-review-gate-ledger-v2") {
      return config.ledgerPresent
        ? respond(200, {
            name: "codex-review-gate-ledger-v2",
            commit: { sha: LEDGER_SHA },
          })
        : respond(404, { message: "Not Found" });
    }
    if (path === "/repos/acme/widget/rules/branches/codex-review-gate-ledger-v2") {
      return respond(200, config.ledgerRulePages[page - 1] ?? []);
    }
    if (path === "/repos/acme/widget/rulesets") {
      return respond(200, config.rulesetPages[page - 1] ?? []);
    }
    const rulesetMatch = path.match(/^\/repos\/acme\/widget\/rulesets\/([0-9]+)$/u);
    if (rulesetMatch !== null) {
      const detail = config.rulesetDetails.get(rulesetMatch[1]);
      return detail === undefined
        ? respond(404, { message: "Not Found" })
        : respond(200, detail);
    }
    if (path === "/repos/acme/widget/environments") {
      return respond(200, {
        total_count: config.environmentInventory.length,
        environments: config.environmentInventory,
      });
    }
    const environmentMatch = path.match(/^\/repos\/acme\/widget\/environments\/(.+)$/u);
    if (environmentMatch !== null) {
      const name = decodeURIComponent(environmentMatch[1]);
      const detail = config.environmentDetails.get(name);
      return detail === undefined
        ? respond(404, { message: "Not Found" })
        : respond(200, detail);
    }
    throw new Error(`unexpected fake request ${url.href}`);
  };
  return { fetch, calls };
}

function response(status, body, {
  date = DATE,
  contentType = "application/json; charset=utf-8",
  jsonSpacing = 0,
} = {}) {
  const raw = typeof body === "string"
    ? body
    : JSON.stringify(body, null, jsonSpacing);
  return {
    status,
    headers: {
      get(name) {
        if (name.toLowerCase() === "date") return date;
        if (name.toLowerCase() === "content-type") {
          return contentType;
        }
        if (name.toLowerCase() === "content-length") {
          return String(Buffer.byteLength(raw));
        }
        return null;
      },
    },
    async text() {
      return raw;
    },
  };
}

async function load(fixture, commandValue = command()) {
  return createV2GitHubWorkflowPreflight({
    fetch: fixture.fetch,
    token: SYNTHETIC_BEARER.value,
    repository: REPOSITORY,
    restBaseUrl: "https://api.github.test",
  }).load({ command: commandValue });
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.name, "V2WorkflowPreflightError");
    assert.equal(error?.code, code);
    return true;
  });
}

test("accepts one structurally closed scheduled pull-request leg", async () => {
  const fixture = makeFixture();
  const receipt = await load(fixture, command({ scheduled: true }));
  assert.equal(receipt.selection_policy, "joey-default");
  assert.ok(fixture.calls.length > 0);
});

test("rejects closed-command and dispatch-binding violations before the first API GET", async (t) => {
  const ordinary = command();
  const scheduled = command({ scheduled: true });
  const bindingWithoutDigest = structuredClone(scheduled.dispatch_binding);
  delete bindingWithoutDigest.dispatch_digest;
  const cases = [
    ["missing scheduled binding", command({
      scheduled: true,
      dispatchBinding: null,
    })],
    ["spurious ordinary binding", command({
      dispatchBinding: scheduledDispatchBinding(),
    })],
    ["selector mismatch", command({
      scheduled: true,
      dispatchBinding: scheduledDispatchBinding({ candidate: { number: 8 } }),
    })],
    ["pull-request shape", alteredCommand(ordinary, (value) => {
      value.pull_request = { number: 7, extra: true };
    })],
    ["pull-request number", alteredCommand(ordinary, (value) => {
      value.pull_request.number = 0;
    })],
    ["event payload digest", alteredCommand(ordinary, (value) => {
      value.invocation.event_payload_sha256 = `sha256:${"G".repeat(64)}`;
    })],
    ["observation boundary", alteredCommand(ordinary, (value) => {
      value.route.observation_boundary = "2026-08-13T12:00:00.000Z";
    })],
    ["receipt policy", alteredCommand(ordinary, (value) => {
      value.receipt_policy = { version: 1 };
    })],
    ["event-route relationship", alteredCommand(ordinary, (value) => {
      value.invocation.event_name = "workflow_dispatch";
    })],
    ["batch index", alteredCommand(scheduled, (value) => {
      value.dispatch_binding.batch_index = 1;
    })],
    ["batch count", alteredCommand(scheduled, (value) => {
      value.dispatch_binding.batch_count = 9;
    })],
    ["inventory digest", alteredCommand(scheduled, (value) => {
      value.dispatch_binding.inventory_digest = `sha256:${"G".repeat(64)}`;
    })],
    ["head oid", alteredCommand(scheduled, (value) => {
      value.dispatch_binding.candidate.head_ref_oid = "5".repeat(39);
    })],
    ["base oid", alteredCommand(scheduled, (value) => {
      value.dispatch_binding.candidate.base_ref_oid = "6".repeat(41);
    })],
    ["candidate timestamp", alteredCommand(scheduled, (value) => {
      value.dispatch_binding.candidate.created_at = "2026-08-13 11:59:00Z";
    })],
    ["candidate identity", alteredCommand(scheduled, (value) => {
      value.dispatch_binding.candidate.id = "01";
    })],
    ["extra binding key", alteredCommand(scheduled, (value) => {
      value.dispatch_binding.unexpected = true;
    })],
    ["missing binding key", command({
      scheduled: true,
      dispatchBinding: bindingWithoutDigest,
    })],
    ["extra command key", {
      ...ordinary,
      unexpected: true,
    }],
  ];

  for (const [name, value] of cases) {
    await t.test(name, async () => {
      const fixture = makeFixture();
      await rejectsCode(load(fixture, value), "INVALID_COMMAND");
      assert.equal(fixture.calls.length, 0);
    });
  }
});

function verifierInitialization(overrides = {}) {
  return {
    schema: "codex-review-gate-github-oidc-verifier-v2",
    schema_version: 1,
    discovery: {
      url: "https://token.actions.githubusercontent.com/.well-known/openid-configuration",
      server_time: "2026-08-13T12:00:00.000Z",
      raw_body_sha256: `sha256:${"1".repeat(64)}`,
      claims_supported: [...V2_GIT_LEDGER_OIDC_CLAIMS].sort(),
    },
    jwks: {
      url: "https://token.actions.githubusercontent.com/.well-known/jwks",
      server_time: "2026-08-13T12:00:00.000Z",
      raw_body_sha256: `sha256:${"2".repeat(64)}`,
    },
    initialized: true,
    ...overrides,
  };
}

test("loads one closed public preflight with raw endpoint receipts", async () => {
  const firstFixture = makeFixture();
  const first = await load(firstFixture);
  const second = await load(makeFixture());

  assert.equal(assertV2WorkflowPreflightHandle(first), first);
  assert.throws(
    () => assertV2WorkflowPreflightHandle(structuredClone(first)),
    (error) => error?.code === "UNTRUSTED_PREFLIGHT_HANDLE",
  );

  assert.equal(first.schema, V2_WORKFLOW_PREFLIGHT_SCHEMA);
  assert.equal(first.repository.visibility, "public");
  assert.equal(first.workflow.present, true);
  assert.equal(first.workflow.called_revision, CALLED_SHA);
  assert.equal(first.workflow.caller_workflow_sha, CALLER_SHA);
  assert.equal(first.ruleset.required, true);
  assert.equal(first.ruleset.source_id, "15368");
  assert.equal(first.app.bound, true);
  assert.equal(first.app.proves_exact_workflow_revision, true);
  assert.equal(first.repository.id, "42");
  assert.equal(first.identity_evidence.proves_current_token_identity, false);
  assert.equal(first.identity_evidence.oidc_provenance, null);
  assert.equal(first.selection_policy, "joey-default");
  assert.deepEqual(first.provider_identity_authority.actor, {
    id: "199175422",
    node_id: "BOT_kgDOC98s_g",
    login: "chatgpt-codex-connector[bot]",
    type: "Bot",
  });
  assert.deepEqual(first.provider_identity_authority.app, {
    id: "1144995",
    node_id: "A_kwHOAOQ6Gs4AEXij",
    slug: "chatgpt-codex-connector",
  });
  assert.equal(first.provider_identity_authority.catalog_version, 1);
  assert.match(
    first.provider_identity_authority.identity_digest,
    /^sha256:[0-9a-f]{64}$/u,
  );
  assert.equal(
    first.identity_evidence.oidc_binding_requirements.workflow_ref,
    `${REPOSITORY}/${CALLER_PATH}@refs/heads/main`,
  );
  assert.equal(
    first.identity_evidence.oidc_binding_requirements.workflow_sha,
    CALLER_SHA,
  );
  assert.equal(
    first.identity_evidence.oidc_binding_requirements.job_workflow_ref,
    "Joey-Tools/codex-review-gate-action/.github/workflows/" +
      `codex-review-gate.yml@${CALLED_SHA}`,
  );
  assert.equal(
    first.identity_evidence.oidc_binding_requirements.job_workflow_sha,
    CALLED_SHA,
  );
  assert.equal(first.identity_evidence.oidc_binding_requirements.repository_id, "42");
  assert.equal(first.identity_evidence.oidc_binding_requirements.ref, null);
  assert.equal(
    first.identity_evidence.oidc_binding_requirements.ref_source,
    "trusted-job-context-required",
  );
  assert.equal(first.public_wait.required, true);
  assert.equal(first.public_wait.configuration_compatible, true);
  assert.equal(first.public_wait.live_canary, null);
  assert.equal(first.public_wait.production_effects_authorized, false);
  assert.equal(first.public_wait.environments.length, 3);
  assert.equal(first.ledger_branch.present, true);
  assert.equal(first.ledger_branch.bootstrap_eligible, false);
  assert.equal(first.ledger_branch.protection_current, true);
  assert.equal(first.ledger_branch.current_attestation, false);
  assert.equal(
    first.ledger_branch.permission_evidence.proves_exact_contents_write,
    false,
  );
  assert.equal(first.git_ledger_capability_input.sealed, false);
  assert.equal(first.git_ledger_capability_input.bootstrap_eligible, true);
  assert.equal(
    first.git_ledger_capability_input.permissions.contents_write_requested,
    true,
  );
  assert.match(first.ledger_branch.protection_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(first.receipt_digest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(first.receipt_digest, second.receipt_digest);
  assert.equal(first.configuration_digest, second.configuration_digest);
  assert.equal(first.stability.configuration_digest, first.configuration_digest);
  assert.equal(first.stability.production_effects_authorized, false);
  assert.ok(first.endpoint_receipts.length >= 10);
  for (const endpoint of first.endpoint_receipts) {
    assert.equal(endpoint.method, "GET");
    assert.equal(endpoint.server_time, "2026-08-13T12:00:00.000Z");
    assert.match(endpoint.raw_body_sha256, /^sha256:[0-9a-f]{64}$/u);
  }
  for (const call of firstFixture.calls) {
    assert.equal(call.options.method, "GET");
    assert.equal(
      call.options.headers.Authorization,
      `Bearer ${SYNTHETIC_BEARER.value}`,
    );
  }
});

test("derives one branded validator-accepted restricted bootstrap handoff", async () => {
  const preflight = await load(makeFixture());
  const handoff = createV2WorkflowGitLedgerHandoff(preflight, {
    verifier_initialization: verifierInitialization(),
  });

  assert.equal(assertV2WorkflowGitLedgerHandoffHandle(handoff), handoff);
  assert.throws(
    () => assertV2WorkflowGitLedgerHandoffHandle(structuredClone(handoff)),
    (error) => error?.code === "UNTRUSTED_LEDGER_HANDOFF_HANDLE",
  );
  assert.equal(handoff.state, "bootstrap");
  assert.deepEqual(handoff.blockers, []);
  assert.equal(handoff.capability_receipt, null);
  assert.equal(handoff.repository.owner_id, "77");
  assert.deepEqual(
    handoff.repository_endpoint_receipt,
    preflight.repository_endpoint_receipt,
  );
  assert.equal(
    handoff.workflow_provenance_policy.repository_owner_id,
    preflight.repository.owner_id,
  );
  assert.equal(
    handoff.workflow_provenance_policy.subject_pattern,
    "repo:acme/widget:job_workflow_ref:Joey-Tools/" +
      `codex-review-gate-action/.github/workflows/codex-review-gate.yml@${CALLED_SHA}`,
  );
  assert.deepEqual(
    handoff.workflow_provenance_policy.allowed_event_names,
    [
      "issue_comment",
      "pull_request_review",
      "pull_request_review_comment",
      "pull_request_target",
      "schedule",
      "workflow_dispatch",
    ],
  );
  assert.deepEqual(
    validateV2GitLedgerBootstrapInput(handoff.bootstrap_input, {
      repository: handoff.repository,
      ledger_ref: handoff.ledger_ref,
    }),
    handoff.bootstrap_input,
  );
});

test("keeps stable capability authorization across live receipt churn", async () => {
  const firstPreflight = await load(makeFixture());
  const secondPreflight = await load(makeFixture({
    responseDate: "Thu, 13 Aug 2026 12:00:01 GMT",
    jsonSpacing: 2,
  }));
  const firstInitialization = verifierInitialization();
  const secondInitialization = structuredClone(firstInitialization);
  secondInitialization.discovery.server_time = "2026-08-13T12:00:01.000Z";
  secondInitialization.discovery.raw_body_sha256 = `sha256:${"3".repeat(64)}`;
  secondInitialization.jwks.server_time = "2026-08-13T12:00:01.000Z";
  secondInitialization.jwks.raw_body_sha256 = `sha256:${"4".repeat(64)}`;
  const first = createV2WorkflowGitLedgerHandoff(firstPreflight, {
    verifier_initialization: firstInitialization,
  });
  const second = createV2WorkflowGitLedgerHandoff(secondPreflight, {
    verifier_initialization: secondInitialization,
  });

  assert.equal(first.state, "bootstrap");
  assert.equal(second.state, "bootstrap");
  assert.notEqual(firstPreflight.receipt_digest, secondPreflight.receipt_digest);
  assert.notDeepEqual(
    first.bootstrap_input.repository_endpoint_receipt,
    second.bootstrap_input.repository_endpoint_receipt,
  );
  assert.notEqual(first.bootstrap_input.input_digest, second.bootstrap_input.input_digest);
  assert.equal(
    first.workflow_provenance_policy.subject_policy_receipt_digest,
    second.workflow_provenance_policy.subject_policy_receipt_digest,
  );
  assert.equal(
    first.workflow_provenance_policy.execution_policy_receipt_digest,
    second.workflow_provenance_policy.execution_policy_receipt_digest,
  );
  assert.equal(
    digestV2GitLedgerStableCapabilityAuthorization(first.bootstrap_input),
    digestV2GitLedgerStableCapabilityAuthorization(second.bootstrap_input),
  );
});

test("returns a typed closed handoff instead of guessing absent live OIDC material", async () => {
  const preflight = await load(makeFixture());
  const handoff = createV2WorkflowGitLedgerHandoff(preflight);
  assert.equal(handoff.state, "blocked");
  assert.deepEqual(handoff.blockers, ["oidc-verifier-initialization-required"]);
  assert.equal(handoff.workflow_provenance_policy, null);
  assert.equal(handoff.bootstrap_input, null);
  assert.equal(handoff.capability_receipt, null);
});

test("rejects default or drifted OIDC subject templates before ledger bootstrap", async () => {
  for (const body of [
    { use_default: true, include_claim_keys: [] },
    { use_default: false, include_claim_keys: ["repo", "ref"] },
    { use_default: false, include_claim_keys: ["job_workflow_ref", "repo"] },
  ]) {
    const preflight = await load(makeFixture({
      intercept(url) {
        if (url.pathname === "/repos/acme/widget/actions/oidc/customization/sub") {
          return { status: 200, body };
        }
        return null;
      },
    }));
    const handoff = createV2WorkflowGitLedgerHandoff(preflight, {
      verifier_initialization: verifierInitialization(),
    });
    assert.equal(handoff.state, "blocked");
    assert.deepEqual(handoff.blockers, ["oidc-subject-policy-incompatible"]);
  }
});

test("binds repository owner identity and the exact repository endpoint receipt", async () => {
  const fixture = makeFixture();
  const receipt = await createV2GitHubWorkflowPreflight({
    fetch: fixture.fetch,
    token: SYNTHETIC_BEARER.value,
    repository: REPOSITORY,
    restBaseUrl: "https://api.github.test",
  }).load({ command: command() });
  assert.equal(receipt.repository.owner_id, "77");
  assert.deepEqual(receipt.repository_endpoint_receipt, {
    method: "GET",
    path: "/repos/acme/widget",
    status: 200,
    server_time: "2026-08-13T12:00:00.000Z",
    raw_body_sha256: receipt.endpoint_receipts[0].raw_body_sha256,
  });
  assert.equal(receipt.git_ledger_capability_input.repository.owner_id, "77");
  assert.deepEqual(
    receipt.git_ledger_capability_input.repository_endpoint_receipt,
    receipt.repository_endpoint_receipt,
  );

  const missing = makeFixture({ repositoryOwner: null });
  await assert.rejects(
    createV2GitHubWorkflowPreflight({
      fetch: missing.fetch,
      token: SYNTHETIC_BEARER.value,
      repository: REPOSITORY,
      restBaseUrl: "https://api.github.test",
    }).load({ command: command() }),
    /repository response\.owner/u,
  );

  const mismatch = makeFixture({
    repositoryOwner: { id: 77, login: "other-owner" },
  });
  await assert.rejects(
    createV2GitHubWorkflowPreflight({
      fetch: mismatch.fetch,
      token: SYNTHETIC_BEARER.value,
      repository: REPOSITORY,
      restBaseUrl: "https://api.github.test",
    }).load({ command: command() }),
    (error) => error?.code === "REPOSITORY_MISMATCH",
  );
});

test("binds the pinned live Codex provider actor and App catalog", async () => {
  for (const override of [
    { providerActor: { id: 199175423, node_id: "BOT_kgDOC98s_g", login: "chatgpt-codex-connector[bot]", type: "Bot" } },
    { providerActor: { id: 199175422, node_id: "BOT_wrong", login: "chatgpt-codex-connector[bot]", type: "Bot" } },
    { providerActor: { id: 199175422, node_id: "BOT_kgDOC98s_g", login: "other[bot]", type: "Bot" } },
    { providerActor: { id: 199175422, node_id: "BOT_kgDOC98s_g", login: "chatgpt-codex-connector[bot]", type: "User" } },
    { providerApp: { id: 1144996, node_id: "A_kwHOAOQ6Gs4AEXij", slug: "chatgpt-codex-connector" } },
    { providerApp: { id: 1144995, node_id: "APP_wrong", slug: "chatgpt-codex-connector" } },
    { providerApp: { id: 1144995, node_id: "A_kwHOAOQ6Gs4AEXij", slug: "other-app" } },
  ]) {
    await rejectsCode(
      load(makeFixture(override)),
      "PROVIDER_IDENTITY_CATALOG_MISMATCH",
    );
  }

  await assert.rejects(
    load(makeFixture({
      intercept(url) {
        if (url.pathname === "/apps/chatgpt-codex-connector") {
          return { status: 200, body: { id: 1144995, node_id: "A_kwHOAOQ6Gs4AEXij" } };
        }
        return null;
      },
    })),
    /slug/u,
  );

  const baseline = await load(makeFixture());
  const bodyDrift = await load(makeFixture({
    providerApp: {
      id: 1144995,
      node_id: "A_kwHOAOQ6Gs4AEXij",
      slug: "chatgpt-codex-connector",
      updated_at: "2026-08-13T12:00:01Z",
    },
  }));
  const dateDrift = await load(makeFixture({
    responseDate: "Thu, 13 Aug 2026 12:00:01 GMT",
  }));
  for (const drifted of [bodyDrift, dateDrift]) {
    assert.deepEqual(
      drifted.provider_identity_authority.actor,
      baseline.provider_identity_authority.actor,
    );
    assert.deepEqual(
      drifted.provider_identity_authority.app,
      baseline.provider_identity_authority.app,
    );
    assert.equal(
      drifted.provider_identity_authority.catalog_digest,
      baseline.provider_identity_authority.catalog_digest,
    );
    assert.notEqual(
      drifted.provider_identity_authority.identity_digest,
      baseline.provider_identity_authority.identity_digest,
    );
  }

  for (const contentType of ["text/html", "application/json, application/json"] ) {
    await rejectsCode(
      load(makeFixture({
        intercept(url) {
          if (url.pathname === "/apps/chatgpt-codex-connector") {
            return {
              status: 200,
              contentType,
              body: {
                id: 1144995,
                node_id: "A_kwHOAOQ6Gs4AEXij",
                slug: "chatgpt-codex-connector",
              },
            };
          }
          return null;
        },
      })),
      "HTTP_UNREADABLE",
    );
  }
});

test("private repositories skip public waits and may have no required context", async () => {
  const fixture = makeFixture({
    visibility: "private",
    defaultRulePages: [[]],
  });
  const receipt = await load(fixture);

  assert.deepEqual(receipt.public_wait, {
    required: false,
    configuration_compatible: true,
    live_canary_required: false,
    live_canary: null,
    production_effects_authorized: false,
    environments: [],
  });
  assert.equal(receipt.ruleset.required, false);
  assert.equal(receipt.server_enforcement.ruleset.present, false);
  assert.equal(receipt.server_enforcement.app.required, false);
  assert.equal(
    fixture.calls.some(({ url }) => url.pathname.includes("/environments")),
    false,
  );
});

test("reads a required status context from page two", async () => {
  const pageOne = Array.from({ length: 100 }, (_, index) =>
    effectiveRule(`filler_${index}`, 1000 + index));
  const fixture = makeFixture({
    defaultRulePages: [pageOne, [statusRule(2000), workflowPinRule(2001)]],
  });
  const receipt = await load(fixture);

  assert.equal(receipt.ruleset.required, true);
  assert.ok(fixture.calls.some(({ url }) =>
    url.pathname.endsWith("/rules/branches/main") &&
    url.searchParams.get("page") === "2"));
});

test("accepts live effective rules without ruleset summary-only fields", async () => {
  const liveShape = [statusRule(), workflowPinRule(), ...ledgerRules()].map((rule) => {
    const { enforcement: _enforcement, ruleset_name: _name, ...live } = rule;
    return live;
  });
  const receipt = await load(makeFixture({
    defaultRulePages: [[liveShape[0], liveShape[1]]],
    ledgerRulePages: [[liveShape[2], liveShape[3]]],
  }));
  assert.equal(receipt.ruleset.required, true);
  assert.equal(receipt.ledger_branch.protection_current, true);
});

test("records live-proved caller workflow absence independently of route and selection policy", async () => {
  const absent = { workflowStatus: 404, contentStatus: 404 };
  for (const selectionPolicy of V2_SELECTION_POLICIES) {
    for (const manual of [false, true]) {
      const receipt = await load(
        makeFixture(absent),
        command({ manual, selectionPolicy }),
      );
      assert.equal(receipt.selection_policy, selectionPolicy);
      assert.equal(receipt.workflow.present, false);
      assert.equal(receipt.workflow.compatible, false);
      assert.equal(receipt.server_enforcement.workflow.present, false);
      const handoff = createV2WorkflowGitLedgerHandoff(receipt, {
        verifier_initialization: verifierInitialization(),
      });
      assert.equal(handoff.state, "bootstrap");
    }
  }
});

test("reports closed incompatible caller workflows but blocks ledger authority", async () => {
  for (const fixture of [
    makeFixture({ workflowState: "disabled_manually" }),
    makeFixture({ usesRevision: "e".repeat(40) }),
    makeFixture({ usesRevision: "not-a-release-sha" }),
    makeFixture({ contentStatus: 404 }),
  ]) {
    const receipt = await load(fixture);
    assert.equal(receipt.workflow.present, true);
    assert.equal(receipt.workflow.compatible, false);
    assert.equal(receipt.server_enforcement.workflow.present, true);
    assert.equal(receipt.server_enforcement.workflow.compatible, false);
    const handoff = createV2WorkflowGitLedgerHandoff(receipt, {
      verifier_initialization: verifierInitialization(),
    });
    assert.equal(handoff.state, "blocked");
    assert.deepEqual(handoff.blockers, ["caller-workflow-incompatible"]);
    assert.equal(handoff.bootstrap_input, null);
    const blocked = createV2BlockedConfigurationWorkflowResult({
      preflight_handle: receipt,
      handoff_handle: handoff,
    });
    assert.equal(
      assertV2BlockedConfigurationWorkflowResultHandle(blocked),
      blocked,
    );
    assert.equal(blocked.report.selection.source, "active-ruleset");
    assert.equal(blocked.report.server_enforcement, "not-enforced");
    assert.equal(blocked.report.review_epoch, null);
    assert.equal(blocked.report.status_target, null);
    assert.equal(blocked.report.provider_profile, null);
    assert.equal(blocked.report.evidence_basis, null);
    assert.equal(blocked.report.request_policy.status, "not-applicable");
    assert.deepEqual(blocked.status_plan.writes, []);
    assert.equal(blocked.public_effects_performed, 0);
    assert.throws(
      () => assertV2BlockedConfigurationWorkflowResultHandle(
        structuredClone(blocked),
      ),
      (error) => error?.code ===
        "UNTRUSTED_BLOCKED_CONFIGURATION_RESULT_HANDLE",
    );
  }
});

test("reports a closed incompatible required status rule but blocks ledger authority", async () => {
  const receipt = await load(makeFixture({
    defaultRulePages: [[statusRule(10, 99999), workflowPinRule()]],
  }));
  assert.equal(receipt.ruleset.required, true);
  assert.equal(receipt.ruleset.present, true);
  assert.equal(receipt.ruleset.compatible, false);
  assert.equal(receipt.server_enforcement.ruleset.required, true);
  assert.equal(receipt.server_enforcement.ruleset.compatible, false);
  const handoff = createV2WorkflowGitLedgerHandoff(receipt, {
    verifier_initialization: verifierInitialization(),
  });
  assert.equal(handoff.state, "blocked");
  assert.deepEqual(handoff.blockers, ["required-ruleset-incompatible"]);
  assert.equal(handoff.bootstrap_input, null);
  const blocked = createV2BlockedConfigurationWorkflowResult({
    preflight_handle: receipt,
    handoff_handle: handoff,
  });
  assert.equal(blocked.report.selection.source, "active-ruleset");
  assert.equal(blocked.report.decision, "blocked-configuration");
  assert.deepEqual(blocked.scheduler_plan.actions, []);
});

test("fails closed for ambiguous fixed status rules", async () => {
  await rejectsCode(
    load(makeFixture({
      defaultRulePages: [[statusRule(10), statusRule(12), workflowPinRule()]],
    })),
    "RULESET_AMBIGUOUS",
  );
});

test("reports missing or mismatched required workflow source pins", async () => {
  for (const fixture of [
    makeFixture({ defaultRulePages: [[statusRule()]] }),
    makeFixture({
      defaultRulePages: [[statusRule(), workflowPinRule(11, "e".repeat(40))]],
    }),
  ]) {
    const receipt = await load(fixture);
    assert.equal(receipt.ruleset.required, true);
    assert.equal(receipt.ruleset.compatible, false);
    assert.equal(receipt.ruleset.workflow_source_pin.compatible, false);
    const handoff = createV2WorkflowGitLedgerHandoff(receipt, {
      verifier_initialization: verifierInitialization(),
    });
    assert.equal(handoff.state, "blocked");
    assert.deepEqual(handoff.blockers, ["required-ruleset-incompatible"]);
  }
});

test("fails closed for ambiguous required workflow source pins", async () => {
  await rejectsCode(
    load(makeFixture({
      defaultRulePages: [[statusRule(), workflowPinRule(), workflowPinRule(12)]],
    })),
    "WORKFLOW_SOURCE_PIN_AMBIGUOUS",
  );
});

test("blocked configuration adapter rejects unrelated or caller-resealed handoffs", async () => {
  const absent = await load(makeFixture({
    workflowStatus: 404,
    contentStatus: 404,
    defaultRulePages: [[]],
  }));
  const bootstrap = createV2WorkflowGitLedgerHandoff(absent, {
    verifier_initialization: verifierInitialization(),
  });
  assert.equal(bootstrap.state, "bootstrap");
  assert.throws(
    () => createV2BlockedConfigurationWorkflowResult({
      preflight_handle: absent,
      handoff_handle: bootstrap,
    }),
    (error) => error?.code === "BLOCKED_CONFIGURATION_AUTHORITY_MISMATCH",
  );

  const incompatible = await load(makeFixture({
    workflowState: "disabled_manually",
  }));
  const blocked = createV2WorkflowGitLedgerHandoff(incompatible, {
    verifier_initialization: verifierInitialization(),
  });
  assert.throws(
    () => createV2BlockedConfigurationWorkflowResult({
      preflight_handle: incompatible,
      handoff_handle: structuredClone(blocked),
    }),
    (error) => error?.code === "UNTRUSTED_LEDGER_HANDOFF_HANDLE",
  );
});

test("returns a bootstrap-only receipt when rulesets protect the absent ledger ref", async () => {
  const fixture = makeFixture({ ledgerPresent: false });
  const receipt = await load(fixture);

  assert.equal(receipt.ledger_branch.present, false);
  assert.equal(receipt.ledger_branch.bootstrap_eligible, true);
  assert.equal(receipt.ledger_branch.head_sha, null);
  assert.equal(receipt.ledger_branch.protection_current, false);
  assert.equal(receipt.ledger_branch.current_attestation, false);
  assert.equal(receipt.ledger_branch.attestation_required, true);
  assert.ok(fixture.calls.some(({ url }) =>
    url.pathname.endsWith("/rulesets") &&
    url.searchParams.get("includes_parents") === "true"));
});

test("bootstrap requires exact, exclusion-free future-ref protection", async () => {
  for (const detail of [
    bootstrapRuleset({ include: ["refs/heads/other"] }),
    bootstrapRuleset({ include: ["~ALL"] }),
    bootstrapRuleset({ exclude: ["refs/heads/release/*"] }),
    bootstrapRuleset({ rules: [{ type: "deletion" }] }),
    bootstrapRuleset({ bypassActors: [{ actor_id: 1, actor_type: "Team" }] }),
  ]) {
    await rejectsCode(
      load(makeFixture({
        ledgerPresent: false,
        rulesetPages: [[detail]],
        rulesetDetails: new Map([["30", detail]]),
      })),
      "LEDGER_BOOTSTRAP_INELIGIBLE",
    );
  }
});

test("default-branch rules never substitute for exact ledger-ref protection", async () => {
  const defaultOnly = bootstrapRuleset({ include: ["refs/heads/main"] });
  await rejectsCode(
    load(makeFixture({
      ledgerPresent: false,
      defaultRulePages: [[
        statusRule(),
        workflowPinRule(),
        effectiveRule("deletion", 40),
        effectiveRule("non_fast_forward", 41),
      ]],
      rulesetPages: [[defaultOnly]],
      rulesetDetails: new Map([["30", defaultOnly]]),
    })),
    "LEDGER_BOOTSTRAP_INELIGIBLE",
  );
});

test("fails closed for missing or ambiguous live ledger protection", async () => {
  await rejectsCode(
    load(makeFixture({ ledgerRulePages: [[effectiveRule("deletion", 30)]] })),
    "LEDGER_BRANCH_UNPROTECTED",
  );
  await rejectsCode(
    load(makeFixture({
      ledgerRulePages: [[...ledgerRules(), effectiveRule("deletion", 31)]],
    })),
    "LEDGER_BRANCH_UNPROTECTED",
  );
  await rejectsCode(
    load(makeFixture({
      permissions: {
        admin: false,
        maintain: false,
        push: false,
        triage: true,
        pull: true,
      },
    })),
    "LEDGER_PERMISSION_UNPROVEN",
  );
});

test("fails closed for incompatible public wait inventories and timers", async () => {
  await rejectsCode(
    load(makeFixture({ environmentInventory: [] })),
    "PUBLIC_WAIT_INCOMPATIBLE",
  );
  const wrongTimer = makeFixture();
  const detail = structuredClone(
    wrongTimer.fetch === undefined ? null : ENVIRONMENTS,
  );
  assert.ok(detail);
  const changedDetails = new Map(ENVIRONMENTS.map(([stage, name, id, ruleId]) => [
    name,
    {
      id,
      name,
      protection_rules: [{
        id: ruleId,
        type: "wait_timer",
        wait_timer: stage === "initial" ? 14 : 15,
      }],
    },
  ]));
  await rejectsCode(
    load(makeFixture({ environmentDetails: changedDetails })),
    "PUBLIC_WAIT_INCOMPATIBLE",
  );
  await rejectsCode(
    load(makeFixture({
      environmentInventory: [
        ...ENVIRONMENTS.map(([, name, id]) => ({ name, id })),
        { name: ENVIRONMENTS[0][1], id: 999 },
      ],
    })),
    "PUBLIC_WAIT_INCOMPATIBLE",
  );
});

test("allows unrelated environments while retaining the complete inventory", async () => {
  const fixture = makeFixture({
    environmentInventory: [
      ...ENVIRONMENTS.map(([, name, id]) => ({ name, id })),
      { name: "production", id: 999 },
    ],
  });
  const receipt = await load(fixture);
  assert.equal(receipt.public_wait.inventory_count, 4);
  assert.deepEqual(receipt.public_wait.unrelated_environments, [{
    name: "production",
    id: "999",
  }]);
});

test("does not require an unsupported authenticated /user lookup", async () => {
  const fixture = makeFixture({
    intercept(url) {
      if (url.pathname === "/user") {
        return { status: 403, body: { message: "Forbidden" } };
      }
      return null;
    },
  });
  const receipt = await load(fixture);
  assert.equal(receipt.identity_evidence.proves_current_token_identity, false);
  assert.equal(fixture.calls.some(({ url }) => url.pathname === "/user"), false);
});

test("fails closed on unreadable API responses and incomplete pagination", async () => {
  await rejectsCode(
    load(makeFixture({
      intercept(url) {
        if (url.pathname.endsWith("/rules/branches/main")) {
          return { status: 403, body: { message: "Forbidden" } };
        }
        return null;
      },
    })),
    "HTTP_UNREADABLE",
  );

  const hundred = Array.from({ length: 100 }, (_, index) => ({
    id: 5000 + index,
    name: `environment-${index}`,
  }));
  await rejectsCode(
    load(makeFixture({
      environmentInventory: hundred,
      intercept(url) {
        if (url.pathname.endsWith("/environments")) {
          return {
            status: 200,
            body: {
              total_count: 101,
              environments: url.searchParams.get("page") === "1" ? hundred : [],
            },
          };
        }
        return null;
      },
    })),
    "PAGINATION_INCOMPLETE",
  );
});
