import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire, syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { setImmediate as liveSetImmediate } from "node:timers";

import {
  V2_WORKFLOW_PREFLIGHT_INTEGRATION_ID,
  V2_WORKFLOW_PREFLIGHT_LEDGER_REF,
  V2_WORKFLOW_PREFLIGHT_OIDC_AUDIENCE,
  V2_WORKFLOW_PREFLIGHT_SCHEMA,
  V2_WORKFLOW_PREFLIGHT_STATUS_CONTEXT,
  V2WorkflowPreflightError,
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
const RESPONSE_BYTE_CAP = 2 * 1024 * 1024;
const RESPONSE_CHUNK_CAP = 4_096;
const OPERATION_BYTE_CAP = 16 * 1024 * 1024;
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
  contentLength = "actual",
  jsonSpacing = 0,
  link = null,
  rawBytes = null,
  bodyChunkCount = 1,
  onBodyCancel = null,
  onReaderCancel = null,
} = {}) {
  const raw = typeof body === "string"
    ? body
    : JSON.stringify(body, null, jsonSpacing);
  const bytes = rawBytes === null ? Buffer.from(raw, "utf8") : Buffer.from(rawBytes);
  const decoded = bytes.toString("utf8");
  return {
    status,
    headers: {
      get(name) {
        if (name.toLowerCase() === "date") return date;
        if (name.toLowerCase() === "content-type") {
          return contentType;
        }
        if (name.toLowerCase() === "content-length") {
          if (contentLength === null) return null;
          return contentLength === "actual"
            ? String(bytes.byteLength)
            : String(contentLength);
        }
        if (name.toLowerCase() === "link") return link;
        return null;
      },
    },
    body: {
      cancel() {
        return onBodyCancel?.();
      },
      getReader() {
        let emitted = 0;
        return {
          async read() {
            if (emitted >= bodyChunkCount) {
              return { done: true, value: undefined };
            }
            emitted += 1;
            return {
              done: false,
              value: emitted === bodyChunkCount
                ? Uint8Array.from(bytes)
                : new Uint8Array(),
            };
          },
          cancel() {
            return onReaderCancel?.();
          },
          releaseLock() {},
        };
      },
    },
    async text() {
      return decoded;
    },
  };
}

function paginationLink(path, relations) {
  const separator = path.includes("?") ? "&" : "?";
  return relations.map(([relation, page]) =>
    `<https://api.github.test${path}${separator}per_page=100&page=${page}>; rel="${relation}"`
  ).join(", ");
}

function nextPageLink(path, page) {
  return paginationLink(path, [["next", page]]);
}

function paddedJsonBytes(value, byteLength) {
  const encoded = Buffer.from(JSON.stringify(value), "utf8");
  assert.ok(encoded.byteLength <= byteLength);
  return Buffer.concat([
    encoded,
    Buffer.alloc(byteLength - encoded.byteLength, 0x20),
  ]);
}

async function captureFixtureResponses(fixture) {
  const captures = [];
  await load({
    async fetch(url, init) {
      const value = await fixture.fetch(url, init);
      captures.push({
        url,
        status: value.status,
        date: value.headers.get("date"),
        contentType: value.headers.get("content-type"),
        link: value.headers.get("link"),
        rawBytes: Buffer.from(await value.text(), "utf8"),
      });
      return value;
    },
  });
  return captures;
}

function replayResponsesAtTotalBytes(captures, totalBytes, {
  contentLength = "1",
  onBodyCancel = null,
  onReaderCancel = null,
} = {}) {
  const baseTotal = captures.reduce(
    (sum, capture) => sum + capture.rawBytes.byteLength,
    0,
  );
  assert.ok(baseTotal <= totalBytes);
  let remainingPadding = totalBytes - baseTotal;
  const responses = captures.map((capture) => {
    const padding = Math.min(
      remainingPadding,
      RESPONSE_BYTE_CAP - capture.rawBytes.byteLength,
    );
    remainingPadding -= padding;
    return {
      ...capture,
      rawBytes: Buffer.concat([
        capture.rawBytes,
        Buffer.alloc(padding, 0x20),
      ]),
    };
  });
  assert.equal(remainingPadding, 0);
  let requestIndex = 0;
  return {
    async fetch(url) {
      const capture = responses[requestIndex];
      assert.notEqual(capture, undefined);
      requestIndex += 1;
      assert.equal(url, capture.url);
      return response(capture.status, "", {
        date: capture.date,
        contentType: capture.contentType,
        contentLength,
        link: capture.link,
        onBodyCancel,
        onReaderCancel,
        rawBytes: capture.rawBytes,
      });
    },
    assertComplete() {
      assert.equal(requestIndex, responses.length);
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

async function rejectsCode(promise, code, message = undefined) {
  await assert.rejects(promise, (error) => {
    assert.equal(error?.name, "V2WorkflowPreflightError");
    assert.equal(error?.code, code);
    return true;
  }, message);
}

function drainCleanupTasks() {
  return new Promise((resolve) => globalThis.setImmediate(resolve));
}

async function rejectsHostileReadResult(label, makeReadResult) {
  let requestSignal = null;
  let reads = 0;
  let readerCancels = 0;
  let releases = 0;
  let bodyCancels = 0;
  const neverSettles = new Promise(() => {});
  await rejectsCode(load({
    async fetch(_url, init) {
      requestSignal = init.signal;
      return {
        status: 200,
        headers: responseHeaders(2),
        body: {
          cancel() {
            bodyCancels += 1;
            return neverSettles;
          },
          getReader() {
            return {
              async read() {
                reads += 1;
                return makeReadResult();
              },
              cancel() {
                readerCancels += 1;
                return neverSettles;
              },
              releaseLock() {
                releases += 1;
                return neverSettles;
              },
            };
          },
        },
      };
    },
  }), "HTTP_UNREADABLE", label);
  assert.equal(reads, 1, label);
  await drainCleanupTasks();
  assert.equal(readerCancels, 1, label);
  assert.equal(releases, 1, label);
  assert.equal(bodyCancels, 1, label);
  assert.equal(requestSignal?.aborted, false, label);
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
  const rulesPath = "/repos/acme/widget/rules/branches/main";
  const pageOne = Array.from({ length: 100 }, (_, index) =>
    effectiveRule(`filler_${index}`, 1000 + index));
  const fixture = makeFixture({
    intercept(url) {
      if (url.pathname !== rulesPath) return null;
      const page = Number(url.searchParams.get("page"));
      return {
        status: 200,
        body: page === 1
          ? pageOne
          : [statusRule(2000), workflowPinRule(2001)],
        link: page === 1 ? nextPageLink(rulesPath, 2) : null,
      };
    },
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

test("follows a short effective-rule page when Link declares a next page", async () => {
  const rulesPath = "/repos/acme/widget/rules/branches/main";
  await rejectsCode(
    load(makeFixture({
      intercept(url) {
        if (url.pathname !== rulesPath) return null;
        const page = Number(url.searchParams.get("page"));
        return {
          status: 200,
          body: page === 1
            ? [statusRule(), workflowPinRule()]
            : [statusRule(12)],
          link: page === 1 ? nextPageLink(rulesPath, 2) : null,
        };
      },
    })),
    "RULESET_AMBIGUOUS",
  );
});

test("follows Link before rejecting a second exact ledger ruleset", async () => {
  const inventoryPath = "/repos/acme/widget/rulesets?includes_parents=true";
  const duplicateRuleset = {
    ...structuredClone(bootstrapRuleset()),
    id: 31,
    name: "Codex ledger protection duplicate",
  };
  await rejectsCode(load(makeFixture({
    rulesetDetails: new Map([
      ["30", bootstrapRuleset()],
      ["31", duplicateRuleset],
    ]),
    intercept(url) {
      if (url.pathname !== "/repos/acme/widget/rulesets") return null;
      const page = Number(url.searchParams.get("page"));
      return {
        status: 200,
        body: page === 1 ? [bootstrapRuleset()] : [duplicateRuleset],
        link: page === 1 ? nextPageLink(inventoryPath, 2) : null,
      };
    },
  })), "LEDGER_BOOTSTRAP_INELIGIBLE");
});

test("rejects invalid pagination scope before a second page fetch", async () => {
  const rulesPath = "/repos/acme/widget/rules/branches/main";
  const canonicalNext = nextPageLink(rulesPath, 2);
  const invalidLinks = [
    ["malformed", "not-a-link"],
    ["loop", nextPageLink(rulesPath, 1)],
    [
      "cross-origin",
      canonicalNext.replace(
        "https://api.github.test",
        "https://pagination.example",
      ),
    ],
    [
      "path drift",
      canonicalNext.replace(
        "/rules/branches/main",
        "/rules/branches/release",
      ),
    ],
    ["query drift", canonicalNext.replace("per_page=100", "per_page=99")],
    ["page drift", nextPageLink(rulesPath, 3)],
  ];
  for (const [label, link] of invalidLinks) {
    const paginationFetches = [];
    const fixture = makeFixture({
      intercept(url) {
        if (url.pathname !== rulesPath) return null;
        paginationFetches.push(url.href);
        const page = Number(url.searchParams.get("page"));
        return {
          status: 200,
          body: [effectiveRule(`scope_filler_${page}`, 4000 + page)],
          link: page === 1 ? link : null,
        };
      },
    });
    await rejectsCode(
      load(fixture),
      "PAGINATION_INCOMPLETE",
      label,
    );
    const expectedFirstPage =
      `https://api.github.test${rulesPath}?per_page=100&page=1`;
    assert.deepEqual(paginationFetches, [expectedFirstPage], label);
    const firstPageIndex = fixture.calls.findIndex(
      ({ url }) => url.href === expectedFirstPage,
    );
    assert.notEqual(firstPageIndex, -1, label);
    assert.equal(fixture.calls.length, firstPageIndex + 1, label);
  }
});

test("fails closed when a promised last page disappears or changes", async () => {
  const rulesPath = "/repos/acme/widget/rules/branches/main";
  const cases = [
    ["missing page-two Link", null],
    ["changed page-two last", paginationLink(rulesPath, [["last", 2]])],
  ];
  for (const [label, pageTwoLink] of cases) {
    const fetchedPages = [];
    await rejectsCode(load(makeFixture({
      intercept(url) {
        if (url.pathname !== rulesPath) return null;
        const page = Number(url.searchParams.get("page"));
        fetchedPages.push(page);
        return {
          status: 200,
          body: [effectiveRule(`last_filler_${page}`, 5000 + page)],
          link: page === 1
            ? paginationLink(rulesPath, [["next", 2], ["last", 3]])
            : pageTwoLink,
        };
      },
    })), "PAGINATION_INCOMPLETE", label);
    assert.deepEqual(fetchedPages, [1, 2], label);
  }
});

test("accepts one consistent promised last page through page three", async () => {
  const rulesPath = "/repos/acme/widget/rules/branches/main";
  const fetchedPages = [];
  const receipt = await load(makeFixture({
    intercept(url) {
      if (url.pathname !== rulesPath) return null;
      const page = Number(url.searchParams.get("page"));
      fetchedPages.push(page);
      return {
        status: 200,
        body: page === 3
          ? [statusRule(), workflowPinRule()]
          : [effectiveRule(`consistent_last_filler_${page}`, 5100 + page)],
        link: page === 1
          ? paginationLink(rulesPath, [["next", 2], ["last", 3]])
          : page === 2
          ? paginationLink(rulesPath, [["next", 3], ["last", 3]])
          : paginationLink(rulesPath, [["last", 3]]),
      };
    },
  }));
  assert.equal(receipt.ruleset.required, true);
  assert.deepEqual(fetchedPages, [1, 2, 3]);
});

test("accepts page twenty as terminal and rejects a page twenty-one link", async () => {
  const rulesPath = "/repos/acme/widget/rules/branches/main";
  const expectedUrls = Array.from({ length: 20 }, (_, index) =>
    `https://api.github.test${rulesPath}?per_page=100&page=${index + 1}`
  );
  const makeTwentyPageFixture = (continuePastCap) => {
    const fetchedUrls = [];
    const fixture = makeFixture({
      intercept(url) {
        if (url.pathname !== rulesPath) return null;
        fetchedUrls.push(url.href);
        const page = Number(url.searchParams.get("page"));
        return {
          status: 200,
          body: page === 20
            ? [statusRule(), workflowPinRule()]
            : [effectiveRule(`page_cap_filler_${page}`, 6000 + page)],
          link: page < 20
            ? nextPageLink(rulesPath, page + 1)
            : continuePastCap ? nextPageLink(rulesPath, 21) : null,
        };
      },
    });
    return { fixture, fetchedUrls };
  };

  const terminal = makeTwentyPageFixture(false);
  const receipt = await load(terminal.fixture);
  assert.equal(receipt.ruleset.required, true);
  assert.deepEqual(terminal.fetchedUrls, expectedUrls);

  const overflow = makeTwentyPageFixture(true);
  await rejectsCode(load(overflow.fixture), "PAGINATION_INCOMPLETE");
  assert.deepEqual(overflow.fetchedUrls, expectedUrls);
});

test("enforces the streamed response-byte cap despite absent or low Content-Length", async () => {
  const ledgerPath =
    "/repos/acme/widget/branches/codex-review-gate-ledger-v2";
  const exactBytes = paddedJsonBytes(
    { message: "Not Found" },
    RESPONSE_BYTE_CAP,
  );
  const exactReceipt = await load(makeFixture({
    ledgerPresent: false,
    intercept(url) {
      if (url.pathname !== ledgerPath) return null;
      return {
        status: 404,
        rawBytes: exactBytes,
        contentLength: null,
      };
    },
  }));
  assert.equal(
    exactReceipt.endpoint_receipts.find(
      (endpoint) => endpoint.path === ledgerPath,
    )?.raw_body_sha256,
    `sha256:${createHash("sha256").update(exactBytes).digest("hex")}`,
  );

  const overCapBytes = paddedJsonBytes(
    { message: "Not Found" },
    RESPONSE_BYTE_CAP + 1,
  );
  for (const contentLength of [null, String(RESPONSE_BYTE_CAP)]) {
    let readerCancels = 0;
    let bodyCancels = 0;
    await rejectsCode(load(makeFixture({
      ledgerPresent: false,
      intercept(url) {
        if (url.pathname !== ledgerPath) return null;
        return {
          status: 404,
          rawBytes: overCapBytes,
          contentLength,
          onReaderCancel() {
            readerCancels += 1;
            return new Promise(() => {});
          },
          onBodyCancel() {
            bodyCancels += 1;
            return new Promise(() => {});
          },
        };
      },
    })), "HTTP_UNREADABLE");
    await drainCleanupTasks();
    assert.equal(readerCancels, 1);
    assert.equal(bodyCancels, 1);
  }
});

test("rejects noncanonical or oversized Content-Length before reading", async () => {
  const ledgerPath =
    "/repos/acme/widget/branches/codex-review-gate-ledger-v2";
  for (const contentLength of [
    "01",
    "+1",
    "1 ",
    String(RESPONSE_BYTE_CAP + 1),
  ]) {
    let readerCancels = 0;
    let bodyCancels = 0;
    await rejectsCode(load(makeFixture({
      ledgerPresent: false,
      intercept(url) {
        if (url.pathname !== ledgerPath) return null;
        return {
          status: 404,
          body: { message: "Not Found" },
          contentLength,
          onReaderCancel() {
            readerCancels += 1;
          },
          onBodyCancel() {
            bodyCancels += 1;
            return new Promise(() => {});
          },
        };
      },
    })), "HTTP_UNREADABLE");
    await drainCleanupTasks();
    assert.equal(readerCancels, 0);
    assert.equal(bodyCancels, 1);
  }
});

test("counts empty chunks against the response chunk cap at 4096 plus one", async () => {
  const ledgerPath =
    "/repos/acme/widget/branches/codex-review-gate-ledger-v2";
  const rawBytes = Buffer.from('{"message":"Not Found"}', "utf8");
  await load(makeFixture({
    ledgerPresent: false,
    intercept(url) {
      if (url.pathname !== ledgerPath) return null;
      return {
        status: 404,
        rawBytes,
        contentLength: null,
        bodyChunkCount: RESPONSE_CHUNK_CAP,
      };
    },
  }));

  let readerCancels = 0;
  let bodyCancels = 0;
  await rejectsCode(load(makeFixture({
    ledgerPresent: false,
    intercept(url) {
      if (url.pathname !== ledgerPath) return null;
      return {
        status: 404,
        rawBytes,
        contentLength: "1",
        bodyChunkCount: RESPONSE_CHUNK_CAP + 1,
        onReaderCancel() {
          readerCancels += 1;
          return new Promise(() => {});
        },
        onBodyCancel() {
          bodyCancels += 1;
          return new Promise(() => {});
        },
      };
    },
  })), "HTTP_UNREADABLE");
  await drainCleanupTasks();
  assert.equal(readerCancels, 1);
  assert.equal(bodyCancels, 1);
});

test("enforces the aggregate response-byte cap from actual streamed bytes", async () => {
  const captures = await captureFixtureResponses(makeFixture());
  const exactReplay = replayResponsesAtTotalBytes(
    captures,
    OPERATION_BYTE_CAP,
    { contentLength: "actual" },
  );
  await load(exactReplay);
  exactReplay.assertComplete();

  for (const [contentLength, expectedReaderCancels] of [
    [null, 1],
    ["1", 1],
    ["actual", 0],
  ]) {
    let readerCancels = 0;
    let bodyCancels = 0;
    const overCapReplay = replayResponsesAtTotalBytes(
      captures,
      OPERATION_BYTE_CAP + 1,
      {
        contentLength,
        onReaderCancel() {
          readerCancels += 1;
          return new Promise(() => {});
        },
        onBodyCancel() {
          bodyCancels += 1;
          return new Promise(() => {});
        },
      },
    );
    await rejectsCode(load(overCapReplay), "HTTP_UNREADABLE");
    await drainCleanupTasks();
    assert.equal(readerCancels, expectedReaderCancels);
    assert.equal(bodyCancels, 1);
  }
});

test("binds exact valid UTF-8 response bytes and rejects malformed UTF-8", async () => {
  const ledgerPath =
    "/repos/acme/widget/branches/codex-review-gate-ledger-v2";
  const legalBytes = Buffer.from(
    '{ "message" : "Not \\u0046\\uFEFFound" }\n',
    "utf8",
  );
  const legalJson = legalBytes.toString("utf8");
  assert.equal(JSON.parse(legalJson).message, "Not F\uFEFFound");
  assert.notEqual(JSON.stringify(JSON.parse(legalJson)), legalJson);
  const legalFixture = makeFixture({
    ledgerPresent: false,
    intercept(url) {
      if (url.pathname === ledgerPath) {
        return { status: 404, rawBytes: legalBytes };
      }
      return null;
    },
  });
  const receipt = await load(legalFixture);
  const ledgerReceipt = receipt.endpoint_receipts.find(
    (endpoint) => endpoint.path === ledgerPath,
  );
  assert.equal(
    ledgerReceipt?.raw_body_sha256,
    `sha256:${createHash("sha256").update(legalBytes).digest("hex")}`,
  );

  const leadingBomBytes = Buffer.concat([
    Buffer.from([0xEF, 0xBB, 0xBF]),
    Buffer.from('{"message":"Not Found"}', "utf8"),
  ]);
  await rejectsCode(
    load(makeFixture({
      ledgerPresent: false,
      intercept(url) {
        if (url.pathname === ledgerPath) {
          return { status: 404, rawBytes: leadingBomBytes };
        }
        return null;
      },
    })),
    "HTTP_UNREADABLE",
  );

  const prefix = Buffer.from('{"message":"Not Found ', "utf8");
  const suffix = Buffer.from('"}', "utf8");
  const malformedBytes = Buffer.concat([
    prefix,
    Buffer.from([0x80]),
    suffix,
  ]);
  await rejectsCode(
    load(makeFixture({
      ledgerPresent: false,
      intercept(url) {
        if (url.pathname === ledgerPath) {
          return { status: 404, rawBytes: malformedBytes };
        }
        return null;
      },
    })),
    "HTTP_UNREADABLE",
  );
});

test("workflow preflight deadline bounds a stalled fetch", {
  timeout: 2_000,
}, async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let requestSignal = null;
  const operation = load({
    fetch(_url, init) {
      requestSignal = init.signal;
      return new Promise(() => {});
    },
  });
  try {
    for (let index = 0; index < 10 && requestSignal === null; index += 1) {
      await Promise.resolve();
    }
    assert.notEqual(requestSignal, null);
    const rejection = rejectsCode(operation, "HTTP_UNREADABLE");
    context.mock.timers.tick(15_000);
    await rejection;
    await drainCleanupTasks();
    assert.equal(requestSignal.aborted, true);
  } finally {
    context.mock.timers.reset();
  }
});

test("workflow preflight deadline bounds a stalled response-body read", {
  timeout: 2_000,
}, async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let requestSignal = null;
  let readStarted = false;
  let cancelCalled = false;
  const operation = load({
    async fetch(_url, init) {
      requestSignal = init.signal;
      return {
        status: 200,
        headers: responseHeaders(2),
        body: {
          getReader() {
            return {
              read() {
                readStarted = true;
                return new Promise(() => {});
              },
              cancel() {
                cancelCalled = true;
                return Promise.resolve();
              },
              releaseLock() {},
            };
          },
        },
      };
    },
  });
  try {
    for (let index = 0; index < 10 && !readStarted; index += 1) {
      await Promise.resolve();
    }
    assert.equal(readStarted, true);
    const rejection = rejectsCode(operation, "HTTP_UNREADABLE");
    context.mock.timers.tick(15_000);
    await rejection;
    await drainCleanupTasks();
    assert.equal(requestSignal?.aborted, true);
    assert.equal(cancelCalled, true);
  } finally {
    context.mock.timers.reset();
  }
});

test("workflow preflight settles deadline failure before next-turn hostile cleanup", {
  timeout: 2_000,
}, async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const neverSettles = new Promise(() => {});
  const cleanupEvents = [];
  const cleanupObservedErrors = [];
  let caught = null;
  let requestSignal = null;
  let readStarted = false;
  let abortReason = null;
  let abortReasonMessage = null;
  let abortReasonPrototype = null;
  let abortReasonWasError = false;
  let readerCancelThis = null;
  let readerReleaseThis = null;
  let bodyCancelThis = null;
  const observeCleanup = (event) => {
    cleanupEvents.push(event);
    cleanupObservedErrors.push(caught);
  };
  let reader;
  reader = {
    read() {
      readStarted = true;
      return neverSettles;
    },
    get cancel() {
      observeCleanup("reader cancel getter");
      return function cancel() {
        observeCleanup("reader cancel call");
        readerCancelThis = this;
        throw new Error("synthetic reader cancel failure");
      };
    },
    get releaseLock() {
      observeCleanup("reader release getter");
      return function releaseLock() {
        observeCleanup("reader release call");
        readerReleaseThis = this;
        return neverSettles;
      };
    },
  };
  let body;
  body = {
    get cancel() {
      observeCleanup("body cancel getter");
      return function cancel() {
        observeCleanup("body cancel call");
        bodyCancelThis = this;
        throw new Error("synthetic body cancel failure");
      };
    },
    getReader() {
      return reader;
    },
  };
  const operation = load({
    async fetch(_url, init) {
      requestSignal = init.signal;
      requestSignal.addEventListener("abort", () => {
        observeCleanup("abort listener");
        abortReason = requestSignal.reason;
        abortReasonMessage = abortReason.message;
        abortReasonPrototype = Object.getPrototypeOf(abortReason);
        abortReasonWasError = abortReason instanceof Error;
        abortReason.name = "HostileCleanupReason";
        abortReason.message = "mutated cleanup reason";
        abortReason.code = "HOSTILE";
        abortReason.details = { mutated: true };
        abortReason.cause = { mutated: true };
        Object.setPrototypeOf(abortReason, null);
        return neverSettles;
      }, { once: true });
      return {
        status: 200,
        headers: responseHeaders(1),
        body,
      };
    },
  });
  const authoritativeRejection = operation.then(
    () => assert.fail("expected the stalled request to reject"),
    (error) => {
      caught = error;
      return error;
    },
  );
  try {
    for (let index = 0; index < 10 && !readStarted; index += 1) {
      await Promise.resolve();
    }
    assert.equal(readStarted, true);
    context.mock.timers.tick(15_000);
    const authoritativeError = await authoritativeRejection;
    assert.equal(authoritativeError, caught);
    assert.equal(caught?.name, "V2WorkflowPreflightError");
    assert.equal(caught?.code, "HTTP_UNREADABLE");
    assert.equal(caught?.details, null);
    assert.equal(caught instanceof V2WorkflowPreflightError, true);
    assert.equal(caught?.cause instanceof Error, true);
    const caughtPrototype = Object.getPrototypeOf(caught);
    const caughtMessage = caught.message;
    const caughtCause = caught.cause;
    const caughtCausePrototype = Object.getPrototypeOf(caughtCause);
    const caughtCauseName = caughtCause.name;
    const caughtCauseMessage = caughtCause.message;
    assert.deepEqual(cleanupEvents, []);
    assert.equal(requestSignal?.aborted, false);

    await drainCleanupTasks();

    assert.deepEqual(cleanupEvents, [
      "abort listener",
      "reader cancel getter",
      "reader cancel call",
      "reader release getter",
      "reader release call",
      "body cancel getter",
      "body cancel call",
    ]);
    assert.equal(
      cleanupObservedErrors.every((error) => error === authoritativeError),
      true,
    );
    assert.equal(requestSignal?.aborted, true);
    assert.equal(requestSignal?.reason, abortReason);
    assert.notEqual(abortReason, authoritativeError);
    assert.notEqual(abortReason, caughtCause);
    assert.equal(abortReasonWasError, true);
    assert.equal(abortReasonPrototype, Error.prototype);
    assert.match(abortReasonMessage, / cleanup after deadline$/u);
    assert.equal(abortReason?.name, "HostileCleanupReason");
    assert.equal(abortReason?.code, "HOSTILE");
    assert.equal(readerCancelThis, reader);
    assert.equal(readerReleaseThis, reader);
    assert.equal(bodyCancelThis, body);
    assert.equal(Object.getPrototypeOf(authoritativeError), caughtPrototype);
    assert.equal(caughtPrototype, V2WorkflowPreflightError.prototype);
    assert.equal(authoritativeError.name, "V2WorkflowPreflightError");
    assert.equal(authoritativeError.code, "HTTP_UNREADABLE");
    assert.equal(authoritativeError.message, caughtMessage);
    assert.equal(authoritativeError.details, null);
    assert.equal(authoritativeError.cause, caughtCause);
    assert.equal(Object.getPrototypeOf(caughtCause), caughtCausePrototype);
    assert.equal(caughtCause.name, caughtCauseName);
    assert.equal(caughtCause.message, caughtCauseMessage);
  } finally {
    context.mock.timers.reset();
  }
});

test("workflow preflight retains its initialized scheduler after builtin poisoning", {
  timeout: 2_000,
}, async (context) => {
  await drainCleanupTasks();
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const require = createRequire(import.meta.url);
  const cjsTimers = require("node:timers");
  const originalSetImmediate = cjsTimers.setImmediate;
  assert.equal(liveSetImmediate, originalSetImmediate);
  let poisonCalls = 0;
  function poisonedSetImmediate() {
    poisonCalls += 1;
    throw new Error("synthetic poisoned setImmediate");
  }
  const neverSettles = new Promise(() => {});
  const cleanupObservedSettlement = [];
  let authoritativeSettled = false;
  let requestSignal = null;
  let readStarted = false;
  let deadlineAborts = 0;
  let readerCancels = 0;
  let readerReleases = 0;
  let bodyCancels = 0;
  try {
    cjsTimers.setImmediate = poisonedSetImmediate;
    syncBuiltinESMExports();
    assert.equal(liveSetImmediate, poisonedSetImmediate);

    const operation = load({
      async fetch(_url, init) {
        requestSignal = init.signal;
        requestSignal.addEventListener("abort", () => {
          deadlineAborts += 1;
          cleanupObservedSettlement.push(authoritativeSettled);
        }, { once: true });
        return {
          status: 200,
          headers: responseHeaders(1),
          body: {
            cancel() {
              bodyCancels += 1;
              cleanupObservedSettlement.push(authoritativeSettled);
              return neverSettles;
            },
            getReader() {
              return {
                read() {
                  readStarted = true;
                  return neverSettles;
                },
                cancel() {
                  readerCancels += 1;
                  cleanupObservedSettlement.push(authoritativeSettled);
                  return neverSettles;
                },
                releaseLock() {
                  readerReleases += 1;
                  cleanupObservedSettlement.push(authoritativeSettled);
                  return neverSettles;
                },
              };
            },
          },
        };
      },
    });
    const authoritativeRejection = operation.then(
      () => assert.fail("expected the stalled request to reject"),
      (error) => {
        authoritativeSettled = true;
        return error;
      },
    );
    for (let index = 0; index < 10 && !readStarted; index += 1) {
      await Promise.resolve();
    }
    assert.equal(readStarted, true);
    context.mock.timers.tick(15_000);
    const authoritativeError = await authoritativeRejection;
    assert.equal(authoritativeError?.name, "V2WorkflowPreflightError");
    assert.equal(authoritativeError?.code, "HTTP_UNREADABLE");
    assert.equal(poisonCalls, 0);
    assert.equal(requestSignal?.aborted, false);
    assert.equal(deadlineAborts, 0);
    assert.equal(readerCancels, 0);
    assert.equal(readerReleases, 0);
    assert.equal(bodyCancels, 0);

    await drainCleanupTasks();

    assert.equal(poisonCalls, 0);
    assert.equal(requestSignal?.aborted, true);
    assert.equal(deadlineAborts, 1);
    assert.equal(readerCancels, 1);
    assert.equal(readerReleases, 1);
    assert.equal(bodyCancels, 1);
    assert.deepEqual(cleanupObservedSettlement, [true, true, true, true]);
  } finally {
    cjsTimers.setImmediate = originalSetImmediate;
    syncBuiltinESMExports();
    context.mock.timers.reset();
  }
  assert.equal(cjsTimers.setImmediate, originalSetImmediate);
  assert.equal(liveSetImmediate, originalSetImmediate);
});

test("workflow preflight never awaits a non-settling reader cancellation", {
  timeout: 2_000,
}, async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let cancelCalled = false;
  let requestSignal = null;
  let deadlineAborts = 0;
  const operation = load({
    async fetch(_url, init) {
      requestSignal = init.signal;
      requestSignal.addEventListener("abort", () => {
        deadlineAborts += 1;
      });
      return {
        status: 200,
        headers: responseHeaders(1),
        body: {
          getReader() {
            return {
              async read() {
                return { done: false, value: "not bytes" };
              },
              cancel() {
                cancelCalled = true;
                return new Promise(() => {});
              },
              releaseLock() {},
            };
          },
        },
      };
    },
  });
  try {
    await rejectsCode(operation, "HTTP_UNREADABLE");
    await drainCleanupTasks();
    assert.equal(cancelCalled, true);
    assert.equal(requestSignal?.aborted, false);
    assert.equal(deadlineAborts, 0);
    context.mock.timers.tick(15_000);
    assert.equal(requestSignal?.aborted, false);
    assert.equal(deadlineAborts, 0);
  } finally {
    context.mock.timers.reset();
  }
});

test("workflow preflight cleans up invalid reader shapes and throwing read getters", {
  timeout: 2_000,
}, async () => {
  const readerFactories = [
    ["invalid reader shape", ({ cancel, releaseLock }) => ({
      read: null,
      cancel,
      releaseLock,
    })],
    ["throwing read getter", ({ cancel, releaseLock }) => ({
      get read() {
        throw new Error("synthetic read getter failure");
      },
      cancel,
      releaseLock,
    })],
  ];
  for (const [label, makeReader] of readerFactories) {
    let requestSignal = null;
    let readerCancels = 0;
    let releases = 0;
    let bodyCancels = 0;
    const neverSettles = new Promise(() => {});
    await rejectsCode(load({
      async fetch(_url, init) {
        requestSignal = init.signal;
        return {
          status: 200,
          headers: responseHeaders(1),
          body: {
            cancel() {
              bodyCancels += 1;
              return neverSettles;
            },
            getReader() {
              return makeReader({
                cancel() {
                  readerCancels += 1;
                  return neverSettles;
                },
                releaseLock() {
                  releases += 1;
                },
              });
            },
          },
        };
      },
    }), "HTTP_UNREADABLE", label);
    await drainCleanupTasks();
    assert.equal(readerCancels, 1, label);
    assert.equal(releases, 1, label);
    assert.equal(bodyCancels, 1, label);
    assert.equal(requestSignal?.aborted, false, label);
  }
});

test("workflow preflight rejects accessor-backed stream read results", {
  timeout: 2_000,
}, async () => {
  let doneGetterCalls = 0;
  await rejectsHostileReadResult("stateful done getter", () =>
    Object.defineProperties({}, {
      done: {
        enumerable: true,
        get() {
          doneGetterCalls += 1;
          return doneGetterCalls > 1;
        },
      },
      value: { enumerable: true, value: undefined },
    })
  );
  assert.equal(doneGetterCalls, 0);

  let valueGetterCalls = 0;
  await rejectsHostileReadResult("value getter", () =>
    Object.defineProperties({}, {
      done: { enumerable: true, value: false },
      value: {
        enumerable: true,
        get() {
          valueGetterCalls += 1;
          return new Uint8Array([0x5B, 0x5D]);
        },
      },
    })
  );
  assert.equal(valueGetterCalls, 0);
});

test("workflow preflight rejects terminal fragments and non-byte chunks", {
  timeout: 2_000,
}, async () => {
  for (const [label, readResult] of [
    [
      "terminal bytes",
      { done: true, value: new Uint8Array([0x5B, 0x5D]) },
    ],
    ["non-byte chunk", { done: false, value: "[]" }],
  ]) {
    await rejectsHostileReadResult(label, () => readResult);
  }
});

test("workflow preflight accounts and parses a Uint8Array by its internal bytes", {
  timeout: 2_000,
}, async () => {
  const rulesPath = "/repos/acme/widget/rules/branches/main";
  const targetUrl =
    `https://api.github.test${rulesPath}?per_page=100&page=1`;
  const fixture = makeFixture();
  const fetchedUrls = [];
  const hostileChunk = new Uint8Array([0x5B, 0x5D, 0x58]);
  Object.defineProperty(hostileChunk, "byteLength", {
    configurable: true,
    value: 2,
  });
  let reads = 0;
  let readerCancels = 0;
  let releases = 0;
  let bodyCancels = 0;
  const neverSettles = new Promise(() => {});
  await rejectsCode(load({
    async fetch(url, init) {
      fetchedUrls.push(url);
      if (url !== targetUrl) return fixture.fetch(url, init);
      return {
        status: 200,
        headers: responseHeaders(3),
        body: {
          cancel() {
            bodyCancels += 1;
            return neverSettles;
          },
          getReader() {
            return {
              async read() {
                reads += 1;
                return reads === 1
                  ? { done: false, value: hostileChunk }
                  : { done: true, value: undefined };
              },
              cancel() {
                readerCancels += 1;
                return neverSettles;
              },
              releaseLock() {
                releases += 1;
                return neverSettles;
              },
            };
          },
        },
      };
    },
  }), "HTTP_UNREADABLE");
  assert.equal(reads, 2);
  await drainCleanupTasks();
  assert.equal(releases, 1);
  assert.equal(readerCancels, 0);
  assert.equal(bodyCancels, 0);
  assert.equal(fetchedUrls.at(-1), targetUrl);
});

test("workflow preflight rejects a fetch settled after its monotonic deadline", {
  timeout: 2_000,
}, async (context) => {
  let monotonicNow = 100;
  context.mock.method(performance, "now", () => monotonicNow);
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const fixture = makeFixture();
  let firstRequest = true;
  let resolveFetch = null;
  let requestSignal = null;
  let lateResponseCancelled = false;
  const operation = load({
    fetch(url, init) {
      if (!firstRequest) return fixture.fetch(url, init);
      firstRequest = false;
      requestSignal = init.signal;
      const readyResponse = fixture.fetch(url, init);
      return new Promise((resolve) => {
        resolveFetch = () => {
          void readyResponse.then((value) => {
            value.body.cancel = () => {
              lateResponseCancelled = true;
              return Promise.resolve();
            };
            resolve(value);
          });
        };
      });
    },
  });
  try {
    for (let index = 0; index < 10 && resolveFetch === null; index += 1) {
      await Promise.resolve();
    }
    assert.notEqual(resolveFetch, null);
    const rejection = rejectsCode(operation, "HTTP_UNREADABLE");
    monotonicNow += 15_000;
    resolveFetch();
    await rejection;
    await drainCleanupTasks();
    assert.equal(requestSignal?.aborted, true);
    assert.equal(lateResponseCancelled, true);
  } finally {
    context.mock.timers.reset();
  }
});

test("workflow preflight rejects a body read settled after its monotonic deadline", {
  timeout: 2_000,
}, async (context) => {
  let monotonicNow = 100;
  context.mock.method(performance, "now", () => monotonicNow);
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const fixture = makeFixture();
  let firstRequest = true;
  let resolveRead = null;
  let requestSignal = null;
  let readerCancelled = false;
  const operation = load({
    async fetch(url, init) {
      requestSignal = init.signal;
      const value = await fixture.fetch(url, init);
      if (!firstRequest) return value;
      firstRequest = false;
      const bytes = Buffer.from(await value.text(), "utf8");
      let emitted = false;
      value.body.getReader = () => ({
        read() {
          if (emitted) {
            return Promise.resolve({ done: true, value: undefined });
          }
          emitted = true;
          return new Promise((resolve) => {
            resolveRead = () => resolve({
              done: false,
              value: Uint8Array.from(bytes),
            });
          });
        },
        cancel() {
          readerCancelled = true;
          return Promise.resolve();
        },
        releaseLock() {},
      });
      return value;
    },
  });
  try {
    for (let index = 0; index < 10 && resolveRead === null; index += 1) {
      await Promise.resolve();
    }
    assert.notEqual(resolveRead, null);
    const rejection = rejectsCode(operation, "HTTP_UNREADABLE");
    monotonicNow += 15_000;
    resolveRead();
    await rejection;
    await drainCleanupTasks();
    assert.equal(requestSignal?.aborted, true);
    assert.equal(readerCancelled, true);
  } finally {
    context.mock.timers.reset();
  }
});

test("workflow preflight rechecks its monotonic deadline after JSON decoding", {
  timeout: 2_000,
}, async (context) => {
  let monotonicNow = 100;
  context.mock.method(performance, "now", () => monotonicNow);
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const originalParse = JSON.parse;
  let advanced = false;
  context.mock.method(JSON, "parse", (...args) => {
    const value = originalParse(...args);
    if (!advanced) {
      advanced = true;
      monotonicNow += 15_000;
    }
    return value;
  });
  const fixture = makeFixture();
  let requestSignal = null;
  try {
    await rejectsCode(load({
      fetch(url, init) {
        requestSignal ??= init.signal;
        return fixture.fetch(url, init);
      },
    }), "HTTP_UNREADABLE");
    assert.equal(advanced, true);
    await drainCleanupTasks();
    assert.equal(requestSignal?.aborted, true);
  } finally {
    context.mock.timers.reset();
  }
});

test("workflow preflight revalidates a completed capture before clearing its timer", {
  timeout: 2_000,
}, async (context) => {
  let afterParse = false;
  const afterParseTimes = [];
  context.mock.method(performance, "now", () => {
    if (!afterParse) return 100;
    const value = afterParseTimes.length < 2 ? 100 : 15_100;
    afterParseTimes.push(value);
    return value;
  });
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const originalParse = JSON.parse;
  context.mock.method(JSON, "parse", (...args) => {
    const value = originalParse(...args);
    afterParse = true;
    return value;
  });
  const fixture = makeFixture();
  let requestSignal = null;
  let deadlineAborts = 0;
  try {
    await rejectsCode(load({
      fetch(url, init) {
        requestSignal ??= init.signal;
        requestSignal.addEventListener("abort", () => {
          deadlineAborts += 1;
        }, { once: true });
        return fixture.fetch(url, init);
      },
    }), "HTTP_UNREADABLE");
    assert.deepEqual(afterParseTimes, [100, 100, 15_100]);
    await drainCleanupTasks();
    assert.equal(requestSignal?.aborted, true);
    assert.equal(deadlineAborts, 1);
  } finally {
    context.mock.timers.reset();
  }
});

test("workflow preflight captures status once before its final deadline fence", {
  timeout: 2_000,
}, async (context) => {
  let monotonicNow = 100;
  context.mock.method(performance, "now", () => monotonicNow);
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const fixture = makeFixture();
  let firstResponse = true;
  let statusReads = 0;
  let firstRequestSignal = null;
  let deadlineAborts = 0;
  try {
    await load({
      async fetch(url, init) {
        const value = await fixture.fetch(url, init);
        if (!firstResponse) return value;
        firstResponse = false;
        firstRequestSignal = init.signal;
        firstRequestSignal.addEventListener("abort", () => {
          deadlineAborts += 1;
        });
        const status = value.status;
        Object.defineProperty(value, "status", {
          configurable: true,
          get() {
            statusReads += 1;
            if (statusReads === 4) monotonicNow += 15_000;
            return status;
          },
        });
        return value;
      },
    });
    assert.equal(statusReads, 1);
    assert.equal(monotonicNow, 100);
    assert.equal(firstRequestSignal?.aborted, false);
    assert.equal(deadlineAborts, 0);
    context.mock.timers.tick(15_000);
    assert.equal(firstRequestSignal?.aborted, false);
    assert.equal(deadlineAborts, 0);
  } finally {
    context.mock.timers.reset();
  }
});

function responseHeaders(contentLength) {
  return {
    get(name) {
      if (name.toLowerCase() === "date") return DATE;
      if (name.toLowerCase() === "content-type") return "application/json";
      if (name.toLowerCase() === "content-length") return String(contentLength);
      return null;
    },
  };
}
