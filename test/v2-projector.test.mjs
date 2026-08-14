import assert from "node:assert/strict";
import test from "node:test";

import {
  V2ProjectorError,
  V2_PROJECTOR_CONTROLLER_SCHEMA,
  deriveV2EvidenceRequest,
  deriveV2SelectionProjection,
  projectV2TransportSnapshots,
} from "../packages/action/src/v2/projector.mjs";
import { reduceV2Snapshot } from "../packages/action/src/v2/reducer.mjs";
import { V2_NO_START_BODIES } from "../packages/action/src/v2/schema.mjs";
import {
  V2_RUNNER_SCHEMA,
  deriveV2EpochId,
  runV2Operation,
} from "../packages/action/src/v2/runner.mjs";

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const MERGE_BASE = "c".repeat(40);
const MERGE = "d".repeat(40);
const TREE = "e".repeat(40);
const DIGEST = `sha256:${"f".repeat(64)}`;
const BOT = actor("9001", "chatgpt-codex-connector[bot]", "Bot", "BOT_codex");
const HUMAN = actor("42", "reviewer", "User", "USER_reviewer");
const CLEAN_BODY =
  "Codex Review: Didn't find any major issues.\n\n" +
  `**Reviewed commit:** \`${HEAD}\``;

test("projects a stable terminal-clean artifact discovered after an unrelated page-one item", () => {
  const unrelated = issueComment("101", { body: "ordinary comment", author: HUMAN });
  const clean = issueComment("202", {
    body: CLEAN_BODY,
    author: BOT,
    app: codexApp(),
    created_at: "2026-08-13T12:00:20.000Z",
    updated_at: "2026-08-13T12:00:20.000Z",
  });
  const discovery = snapshot({ issueComments: [unrelated, clean] });
  const controller = makeController();

  const request = deriveV2EvidenceRequest({
    discovery_snapshot: discovery,
    controller,
  });
  assert.deepEqual(request, {
    artifactSelectors: [{ kind: "issue_comment", id: "202" }],
    permissionSubjects: [],
  });

  const evidence = snapshot({
    issueComments: [unrelated, clean],
    exactArtifacts: [exact("issue_comment", clean)],
    serverTime: "2026-08-13T12:01:00.000Z",
  });
  const projected = projectV2TransportSnapshots({
    discovery_snapshot: discovery,
    evidence_snapshot: evidence,
    controller,
  });

  assert.equal(projected.complete, true);
  assert.equal(projected.scope_stable, true);
  assert.deepEqual(projected.artifacts, [{
    id: "202",
    url: "https://github.com/owner/repo/pull/7#issuecomment-202",
    kind: "terminal-clean",
    channel: "issue-comment",
    request_id: null,
    created_at: "2026-08-13T12:00:20.000Z",
    commit_oid: HEAD,
    stable: true,
    finding_ids: [],
  }]);
  assert.match(projected.snapshot_fingerprint, /^sha256:[0-9a-f]{64}$/u);
  assert.ok(Object.isFrozen(projected));
});

test("v2 terminal issue comments require exact Bot and App identity", () => {
  const cases = [
    ["exact identity", BOT, codexApp(), true],
    [
      "unbracketed login",
      actor("9001", "chatgpt-codex-connector", "Bot", "BOT_codex"),
      codexApp(),
      false,
    ],
    [
      "wrong type",
      actor("9001", "chatgpt-codex-connector[bot]", "User", "BOT_codex"),
      codexApp(),
      false,
    ],
    ["generic Bot", actor("9001", "generic[bot]", "Bot", "BOT_generic"), codexApp(), false],
    ["correct App with wrong user", HUMAN, codexApp(), false],
    ["wrong App", BOT, { id: "42", slug: "other-app", node_id: "APP_other" }, false],
    ["missing App", BOT, null, false],
  ];

  for (const [name, author, app, accepted] of cases) {
    const carrier = issueComment("202", {
      body: CLEAN_BODY,
      author,
      app,
      created_at: "2026-08-13T12:00:20.000Z",
      updated_at: "2026-08-13T12:00:20.000Z",
    });
    const discovery = snapshot({ issueComments: [carrier] });
    const evidence = snapshot({
      issueComments: [carrier],
      exactArtifacts: [exact("issue_comment", carrier)],
      serverTime: "2026-08-13T12:01:00.000Z",
    });
    const projected = projectV2TransportSnapshots({
      discovery_snapshot: discovery,
      evidence_snapshot: evidence,
      controller: makeController(),
    });
    assert.equal(
      projected.artifacts.some((artifact) => artifact.kind === "terminal-clean"),
      accepted,
      name,
    );
  }
});

test("v2 terminal reviews never accept login-or-App identity", () => {
  const cases = [
    ["exact identity", BOT, codexApp(), true],
    [
      "unbracketed login",
      actor("9001", "chatgpt-codex-connector", "Bot", "BOT_codex"),
      codexApp(),
      false,
    ],
    [
      "wrong type",
      actor("9001", "chatgpt-codex-connector[bot]", "User", "BOT_codex"),
      codexApp(),
      false,
    ],
    ["generic Bot", actor("9001", "generic[bot]", "Bot", "BOT_generic"), codexApp(), false],
    ["correct App with wrong user", HUMAN, codexApp(), false],
    ["wrong App", BOT, { id: "42", slug: "other-app", node_id: "APP_other" }, false],
    ["missing App", BOT, null, false],
  ];

  for (const [name, author, app, accepted] of cases) {
    const carrier = terminalReview("202", { author, app });
    const discovery = snapshot({ reviews: [carrier] });
    const evidenceRequest = deriveV2EvidenceRequest({
      discovery_snapshot: discovery,
      controller: makeController(),
    });
    const selected = evidenceRequest.artifactSelectors.some((selector) =>
      selector.kind === "pull_request_review" && selector.id === carrier.id);
    const evidence = snapshot({
      reviews: [carrier],
      exactArtifacts: selected ? [exact("pull_request_review", carrier)] : [],
      serverTime: "2026-08-13T12:01:00.000Z",
    });
    const projected = projectV2TransportSnapshots({
      discovery_snapshot: discovery,
      evidence_snapshot: evidence,
      controller: makeController(),
    });
    assert.equal(
      projected.artifacts.some((artifact) => artifact.kind === "terminal-clean"),
      accepted,
      name,
    );
  }
});

test("projects a manual exact request and its stable exact-provider +1", () => {
  const requestComment = issueComment("301", {
    body: "@codex review",
    author: HUMAN,
    created_at: "2026-08-13T12:00:10.000Z",
    updated_at: "2026-08-13T12:00:10.000Z",
  });
  const plusOne = reaction("401", "+1", "2026-08-13T12:00:30.000Z");
  const reactions = reactionInventory([requestComment], new Map([["301", [plusOne]]]));
  const discovery = snapshot({ issueComments: [requestComment], reactions });
  const controller = makeController({
    requestBindings: [{
      id: "301",
      kind: "manual",
      base_oid: BASE,
      head_oid: HEAD,
      controlled: false,
    }],
    budget: {
      automatic_requests_on_head: 0,
      automatic_reservations_on_head: 0,
      manual_requests_in_epoch: 1,
    },
  });
  const evidenceRequest = deriveV2EvidenceRequest({
    discovery_snapshot: discovery,
    controller,
  });
  assert.deepEqual(evidenceRequest.permissionSubjects, [
    { kind: "issue_comment", id: "301" },
  ]);

  const evidence = snapshot({
    issueComments: [requestComment],
    reactions,
    exactArtifacts: [exact("issue_comment", requestComment)],
    actorPermissions: [actorPermission("301", HUMAN)],
    serverTime: "2026-08-13T12:01:00.000Z",
  });
  const projected = projectV2TransportSnapshots({
    discovery_snapshot: discovery,
    evidence_snapshot: evidence,
    controller,
  });

  assert.equal(projected.requests[0].kind, "manual");
  assert.equal(projected.requests[0].actor_permission.initial.push, true);
  assert.deepEqual(projected.acknowledgements, [{
    id: "401",
    kind: "plus-one",
    request_id: "301",
    finding_id: null,
    created_at: "2026-08-13T12:00:30.000Z",
    commit_oid: HEAD,
    exact_provider: true,
    stable: true,
  }]);
});

test("v2 reactions require the exact bracketed Bot identity", () => {
  const requestComment = issueComment("301", {
    body: "@codex review",
    author: HUMAN,
  });
  const reactions = [
    reaction("401", "+1", "2026-08-13T12:00:30.000Z"),
    {
      ...reaction("402", "+1", "2026-08-13T12:00:31.000Z"),
      author: actor("9002", "chatgpt-codex-connector", "Bot", "BOT_unbracketed"),
    },
    {
      ...reaction("403", "+1", "2026-08-13T12:00:32.000Z"),
      author: actor("9003", "chatgpt-codex-connector[bot]", "User", "USER_wrong"),
    },
    {
      ...reaction("404", "+1", "2026-08-13T12:00:33.000Z"),
      author: actor("9004", "generic[bot]", "Bot", "BOT_generic"),
    },
  ];
  const inventory = reactionInventory(
    [requestComment],
    new Map([[requestComment.id, reactions]]),
  );
  const controller = makeController({
    requestBindings: [{
      id: requestComment.id,
      kind: "automatic",
      base_oid: BASE,
      head_oid: HEAD,
      controlled: true,
    }],
    budget: {
      automatic_requests_on_head: 1,
      automatic_reservations_on_head: 1,
      manual_requests_in_epoch: 0,
    },
  });
  const discovery = snapshot({ issueComments: [requestComment], reactions: inventory });
  const evidence = snapshot({
    issueComments: [requestComment],
    reactions: inventory,
    exactArtifacts: [exact("issue_comment", requestComment)],
    serverTime: "2026-08-13T12:01:00.000Z",
  });
  const projected = projectV2TransportSnapshots({
    discovery_snapshot: discovery,
    evidence_snapshot: evidence,
    controller,
  });
  assert.deepEqual(projected.acknowledgements.map(({ id }) => id), ["401"]);
});

test("fails closed when the final reread changes a late provider artifact", () => {
  const initial = issueComment("202", {
    body: CLEAN_BODY,
    author: BOT,
    app: codexApp(),
  });
  const changed = { ...initial, body: `${CLEAN_BODY} changed` };
  const discovery = snapshot({ issueComments: [initial] });
  const evidence = snapshot({
    issueComments: [changed],
    exactArtifacts: [exact("issue_comment", changed)],
    serverTime: "2026-08-13T12:01:00.000Z",
  });

  assert.throws(
    () => projectV2TransportSnapshots({
      discovery_snapshot: discovery,
      evidence_snapshot: evidence,
      controller: makeController(),
    }),
    (error) => error instanceof V2ProjectorError && error.code === "FINAL_REREAD_DRIFT",
  );
});

test("discovers a terminal artifact beyond the first inventory entry and requires exact refetch", () => {
  const ordinary = issueComment("100", { body: "first page equivalent", author: HUMAN });
  const clean = issueComment("999", {
    body: CLEAN_BODY,
    author: BOT,
    app: codexApp(),
  });
  const discovery = snapshot({ issueComments: [ordinary, clean] });
  const derived = deriveV2EvidenceRequest({
    discovery_snapshot: discovery,
    controller: makeController(),
  });
  assert.deepEqual(derived.artifactSelectors, [
    { kind: "issue_comment", id: "999" },
  ]);

  const evidence = snapshot({
    issueComments: [ordinary, clean],
    serverTime: "2026-08-13T12:01:00.000Z",
  });
  assert.throws(
    () => projectV2TransportSnapshots({
      discovery_snapshot: discovery,
      evidence_snapshot: evidence,
      controller: makeController(),
    }),
    (error) => error instanceof V2ProjectorError && error.code === "MISSING_EXACT_ARTIFACT",
  );
});

test("fails closed when a manual actor permission receipt reports drift", () => {
  const manual = issueComment("301", { body: "@codex review", author: HUMAN });
  const discovery = snapshot({ issueComments: [manual] });
  const controller = makeController({
    requestBindings: [{
      id: "301",
      kind: "manual",
      base_oid: BASE,
      head_oid: HEAD,
      controlled: false,
    }],
    budget: {
      automatic_requests_on_head: 0,
      automatic_reservations_on_head: 0,
      manual_requests_in_epoch: 1,
    },
  });
  const permission = actorPermission("301", HUMAN);
  permission.stable = false;
  const evidence = snapshot({
    issueComments: [manual],
    exactArtifacts: [exact("issue_comment", manual)],
    actorPermissions: [permission],
    serverTime: "2026-08-13T12:01:00.000Z",
  });

  assert.throws(
    () => projectV2TransportSnapshots({
      discovery_snapshot: discovery,
      evidence_snapshot: evidence,
      controller,
    }),
    (error) => error instanceof V2ProjectorError && error.code === "PERMISSION_UNSTABLE",
  );
});

test("fingerprint binds exact raw receipts beyond reducer-semantic evidence", () => {
  const clean = issueComment("202", {
    body: CLEAN_BODY,
    author: BOT,
    app: codexApp(),
  });
  const discovery = snapshot({ issueComments: [clean] });
  const first = snapshot({
    issueComments: [clean],
    exactArtifacts: [exact("issue_comment", clean)],
    serverTime: "2026-08-13T12:01:00.000Z",
  });
  const differentReceipt = exact("issue_comment", clean);
  differentReceipt.raw_body_sha256 = `sha256:${"1".repeat(64)}`;
  const second = snapshot({
    issueComments: [clean],
    exactArtifacts: [differentReceipt],
    serverTime: "2026-08-13T12:01:00.000Z",
  });
  const controller = makeController();

  const firstProjection = projectV2TransportSnapshots({
    discovery_snapshot: discovery,
    evidence_snapshot: first,
    controller,
  });
  const secondProjection = projectV2TransportSnapshots({
    discovery_snapshot: discovery,
    evidence_snapshot: second,
    controller,
  });

  assert.notEqual(
    firstProjection.snapshot_fingerprint,
    secondProjection.snapshot_fingerprint,
  );
  assert.deepEqual(firstProjection.artifacts, secondProjection.artifacts);
});

test("rejects controller no-start history that is not bound to an exact carrier", () => {
  const discovery = snapshot();
  const controller = makeController();
  controller.no_start_observations = [{
    request_id: "88",
    carrier_selector: { kind: "issue_comment", id: "99" },
    first_seen_at: "2026-08-13T12:00:00.000Z",
    first_run_id: "1",
    confirmation_run_id: "2",
    request_run_id: "0",
  }];

  const derived = deriveV2EvidenceRequest({ discovery_snapshot: discovery, controller });
  assert.deepEqual(derived.artifactSelectors, [
    { kind: "issue_comment", id: "99" },
  ]);
  assert.throws(() => projectV2TransportSnapshots({
    discovery_snapshot: discovery,
    evidence_snapshot: snapshot(),
    controller,
  }), /did not refetch issue_comment:99/i);
});

test("does not promote a short clean commit marker to exact head lineage", () => {
  const shortClean = issueComment("202", {
    body:
      "Codex Review: Didn't find any major issues.\n\n" +
      `**Reviewed commit:** \`${HEAD.slice(0, 10)}\``,
    author: BOT,
    app: codexApp(),
  });
  const discovery = snapshot({ issueComments: [shortClean] });
  const evidence = snapshot({
    issueComments: [shortClean],
    exactArtifacts: [exact("issue_comment", shortClean)],
    serverTime: "2026-08-13T12:01:00.000Z",
  });
  const projected = projectV2TransportSnapshots({
    discovery_snapshot: discovery,
    evidence_snapshot: evidence,
    controller: makeController(),
  });

  assert.deepEqual(projected.artifacts, []);
});

test("one exact write-authorized address command closes one aggregate top-level carrier", () => {
  const carrierUrl = "https://github.com/owner/repo/pull/7#issuecomment-202";
  const finding = issueComment("202", {
    html_url: carrierUrl,
    body:
      "### 💡 Codex Review\n\n" +
      `- [P1] First sample https://github.com/owner/repo/blob/${HEAD}/src/a.js#L1\n` +
      `- [P2] Second sample https://github.com/owner/repo/blob/${HEAD}/src/b.js#L2`,
    author: BOT,
    app: codexApp(),
    created_at: "2026-08-13T12:00:10.000Z",
    updated_at: "2026-08-13T12:00:10.000Z",
  });
  const address = issueComment("303", {
    html_url: "https://github.com/owner/repo/pull/7#issuecomment-303",
    body: `/codex-gate addressed ${carrierUrl}`,
    author: HUMAN,
    created_at: "2026-08-13T12:00:30.000Z",
    updated_at: "2026-08-13T12:00:30.000Z",
  });
  const discovery = snapshot({ issueComments: [finding, address] });
  const controller = makeController();
  const derived = deriveV2EvidenceRequest({
    discovery_snapshot: discovery,
    controller,
  });
  assert.deepEqual(derived.artifactSelectors, [
    { kind: "issue_comment", id: "202" },
    { kind: "issue_comment", id: "303" },
  ]);
  assert.deepEqual(derived.permissionSubjects, [
    { kind: "issue_comment", id: "303" },
  ]);
  const evidence = snapshot({
    issueComments: [finding, address],
    exactArtifacts: [
      exact("issue_comment", finding),
      exact("issue_comment", address),
    ],
    actorPermissions: [actorPermission("303", HUMAN)],
    serverTime: "2026-08-13T12:01:00.000Z",
  });

  const projected = projectV2TransportSnapshots({
    discovery_snapshot: discovery,
    evidence_snapshot: evidence,
    controller,
  });

  assert.equal(projected.artifacts.length, 1);
  assert.equal(projected.artifacts[0].finding_ids.length, 1);
  assert.equal(projected.threads.length, 1);
  assert.equal(projected.threads[0].kind, "top-level");
  assert.deepEqual(projected.acknowledgements, [{
    id: "303",
    kind: "addressed",
    request_id: null,
    finding_id: projected.artifacts[0].finding_ids[0],
    created_at: "2026-08-13T12:00:30.000Z",
    commit_oid: HEAD,
    exact_provider: false,
    stable: true,
  }]);
});

test("projects nullable, conflicting, and stale potential-merge facts as blocked input", () => {
  for (const scopeOverrides of [
    {
      potential_merge_oid: null,
      potential_merge_tree: null,
      ordered_parent_oids: [],
      merge_ref_oid: null,
      mergeable: "UNKNOWN",
    },
    {
      potential_merge_oid: null,
      potential_merge_tree: null,
      ordered_parent_oids: [],
      merge_ref_oid: null,
      mergeable: "CONFLICTING",
    },
    {
      merge_ref_oid: "9".repeat(40),
    },
    {
      ordered_parent_oids: [HEAD, BASE],
    },
  ]) {
    const discovery = snapshot({ scopeOverrides });
    const evidence = snapshot({
      scopeOverrides,
      serverTime: "2026-08-13T12:01:00.000Z",
    });
    const projected = projectV2TransportSnapshots({
      discovery_snapshot: discovery,
      evidence_snapshot: evidence,
      controller: makeController(),
    });
    const report = reduceV2Snapshot(projected, {
      status_target_mode: "test-merge-with-head-sentinel",
      status_context: "codex/github-review-gate",
    });
    assert.equal(report.decision, "blocked-input");
    assert.equal(report.status_target.sha, null);
  }
});

test("projects actual server facts without inventing workflow enforcement", () => {
  const incompatibleWorkflow = makeController();
  incompatibleWorkflow.selection.policy = "required-infrastructure-only";
  incompatibleWorkflow.server_enforcement.workflow.compatible = false;
  incompatibleWorkflow.server_enforcement.ruleset = {
    required: false,
    present: false,
    compatible: false,
    status_context: "codex/github-review-gate",
    expected_source: "",
    source_id: "",
  };
  incompatibleWorkflow.server_enforcement.app = {
    required: false,
    bound: false,
    source_matches: false,
  };
  const discovery = snapshot();
  const evidence = snapshot({ serverTime: "2026-08-13T12:01:00.000Z" });
  const incompatible = projectV2TransportSnapshots({
    discovery_snapshot: discovery,
    evidence_snapshot: evidence,
    controller: incompatibleWorkflow,
  });
  assert.deepEqual(incompatible.server_enforcement, {
    controller_available: true,
    workflow_present: true,
    workflow_compatible: false,
    ruleset_required: false,
    ruleset_compatible: false,
    app_bound: false,
  });
  assert.equal(incompatible.selection.eligible, true);
  assert.equal(reduceV2Snapshot(incompatible, {
    status_target_mode: "test-merge-with-head-sentinel",
    status_context: "codex/github-review-gate",
  }).decision, "blocked-configuration");

  const explicitNoInfrastructure = structuredClone(incompatibleWorkflow);
  explicitNoInfrastructure.selection.policy = "user-explicit";
  explicitNoInfrastructure.server_enforcement.workflow.present = false;
  explicitNoInfrastructure.server_enforcement.workflow.path = "";
  explicitNoInfrastructure.server_enforcement.workflow.revision = "";
  const explicit = projectV2TransportSnapshots({
    discovery_snapshot: discovery,
    evidence_snapshot: evidence,
    controller: explicitNoInfrastructure,
  });
  assert.equal(explicit.server_enforcement.workflow_present, false);
  assert.equal(explicit.selection.eligible, true);
  assert.equal(reduceV2Snapshot(explicit, {
    status_target_mode: "test-merge-with-head-sentinel",
    status_context: "codex/github-review-gate",
  }).decision, "pending");
});

test("selection policy cannot override live ruleset or caller-workflow precedence", () => {
  const policies = [
    "joey-default",
    "required-infrastructure-only",
    "user-explicit",
    "legacy-triple",
    "disabled",
  ];
  const requiredRuleset = structuredClone(makeController().server_enforcement);
  const callerWorkflow = structuredClone(requiredRuleset);
  callerWorkflow.ruleset = {
    required: false,
    present: false,
    compatible: false,
    status_context: "codex/github-review-gate",
    expected_source: "",
    source_id: "",
  };
  const noInfrastructure = structuredClone(callerWorkflow);
  noInfrastructure.workflow = {
    present: false,
    compatible: false,
    source: "trusted-reusable-workflow",
    path: "",
    revision: "",
  };

  for (const policy of policies) {
    const rulesetProjection = deriveV2SelectionProjection({
      selection_policy: policy,
      server_enforcement: requiredRuleset,
    });
    assert.deepEqual(rulesetProjection.public_selection, {
      selected: true,
      intent: "required",
      mode: "implicit",
      source: "active-ruleset",
    });
    assert.deepEqual(
      rulesetProjection.reducer_selection,
      {
        intent: "implicit",
        eligible: true,
        reason: "Required by the active server ruleset",
      },
    );

    const workflowProjection = deriveV2SelectionProjection({
      selection_policy: policy,
      server_enforcement: callerWorkflow,
    });
    assert.deepEqual(workflowProjection.public_selection, {
      selected: true,
      intent: "required",
      mode: "implicit",
      source: "workflow",
    });
  }

  const expectedWithoutInfrastructure = new Map([
    ["joey-default", [true, "required", "implicit", "joey-default", "implicit"]],
    ["user-explicit", [true, "explicit", "explicit", "user-explicit", "explicit"]],
    ["legacy-triple", [true, "explicit", "explicit", "legacy-triple", "explicit"]],
    ["required-infrastructure-only", [false, "none", "none", "none", "disabled"]],
    ["disabled", [false, "none", "none", "none", "disabled"]],
  ]);
  for (const policy of policies) {
    const projection = deriveV2SelectionProjection({
      selection_policy: policy,
      server_enforcement: noInfrastructure,
    });
    const [selected, intent, mode, source, reducerIntent] =
      expectedWithoutInfrastructure.get(policy);
    assert.deepEqual(projection.public_selection, {
      selected,
      intent,
      mode,
      source,
    });
    assert.equal(projection.reducer_selection.eligible, selected);
    assert.equal(projection.reducer_selection.intent, reducerIntent);
  }
  assert.throws(
    () => deriveV2SelectionProjection({
      selection_policy: "manual-route-means-explicit",
      server_enforcement: noInfrastructure,
    }),
    /selection_policy/u,
  );
});

test("projects an exact no-start carrier only after a later independent reread", () => {
  const request = issueComment("301", {
    body: "@codex review",
    author: HUMAN,
    created_at: "2026-08-13T12:00:00.000Z",
    updated_at: "2026-08-13T12:00:00.000Z",
  });
  const noStart = issueComment("401", {
    body: V2_NO_START_BODIES[0],
    author: BOT,
    app: codexApp(),
    created_at: "2026-08-13T12:00:30.000Z",
    updated_at: "2026-08-13T12:00:30.000Z",
  });
  const controller = makeController({
    requestBindings: [{
      id: request.id,
      kind: "automatic",
      base_oid: BASE,
      head_oid: HEAD,
      controlled: true,
    }],
    budget: {
      automatic_requests_on_head: 1,
      automatic_reservations_on_head: 1,
      manual_requests_in_epoch: 0,
    },
  });
  controller.no_start_observations = [{
    request_id: request.id,
    carrier_selector: { kind: "issue_comment", id: noStart.id },
    first_seen_at: "2026-08-13T12:01:00.000Z",
    first_run_id: "1",
    confirmation_run_id: "2",
    request_run_id: "0",
  }];
  const discovery = snapshot({
    issueComments: [request, noStart],
    serverTime: "2026-08-13T12:01:00.000Z",
  });
  const evidence = snapshot({
    issueComments: [request, noStart],
    exactArtifacts: [
      exact("issue_comment", request),
      exact("issue_comment", noStart),
    ],
    serverTime: "2026-08-13T12:16:00.000Z",
  });
  const projected = projectV2TransportSnapshots({
    discovery_snapshot: discovery,
    evidence_snapshot: evidence,
    controller,
  });
  assert.deepEqual(projected.no_start_observations, [{
    id: noStart.id,
    url: noStart.html_url,
    request_id: request.id,
    body: noStart.body,
    carrier_created_at: noStart.created_at,
    exact_provider: true,
    stable: true,
    first_seen_at: "2026-08-13T12:01:00.000Z",
    confirmed_at: "2026-08-13T12:16:00.000Z",
    first_run_id: "1",
    confirmation_run_id: "2",
    request_run_id: "0",
  }]);
  assert.equal(reduceV2Snapshot(projected, {
    status_target_mode: "test-merge-with-head-sentinel",
    status_context: "codex/github-review-gate",
  }).decision, "skipped-unavailable");
});

test("no-start rejects a correct App paired with the wrong REST user", () => {
  const setup = noStartFixture();
  setup.carrier.author = HUMAN;
  const discovery = snapshot({
    issueComments: [setup.request, setup.carrier],
    serverTime: "2026-08-13T12:01:00.000Z",
  });
  const evidence = snapshot({
    issueComments: [setup.request, setup.carrier],
    exactArtifacts: [
      exact("issue_comment", setup.request),
      exact("issue_comment", setup.carrier),
    ],
    serverTime: "2026-08-13T12:16:00.000Z",
  });
  assert.throws(
    () => projectV2TransportSnapshots({
      discovery_snapshot: discovery,
      evidence_snapshot: evidence,
      controller: setup.controller,
    }),
    (error) => error instanceof V2ProjectorError &&
      error.code === "NO_START_RECEIPT_MISMATCH",
  );
});

test("provider service activity at or after the request vetoes no-start", () => {
  const strictlyBefore = projectNoStartWithServiceRun({
    started_at: "2026-08-13T11:50:00.000Z",
    completed_at: "2026-08-13T11:59:59.000Z",
  });
  assert.equal(strictlyBefore.no_start_observations.length, 1);

  for (const times of [
    {
      started_at: "2026-08-13T11:50:00.000Z",
      completed_at: "2026-08-13T12:00:00.000Z",
    },
    {
      started_at: "2026-08-13T11:50:00.000Z",
      completed_at: "2026-08-13T12:01:00.000Z",
    },
    { started_at: null, completed_at: null },
  ]) {
    const projected = projectNoStartWithServiceRun(times);
    assert.deepEqual(projected.no_start_observations, []);
  }
});

test("service evidence rejects a non-exact provider App", () => {
  assert.throws(
    () => projectNoStartWithServiceRun({
      app: { id: "42", node_id: "APP_other", slug: "other-app" },
    }),
    /app\.slug must identify the selected service App/u,
  );
});

test("service-start inventory drift fails the final reread closed", () => {
  const setup = noStartFixture();
  const discovery = snapshot({
    issueComments: [setup.request, setup.carrier],
    serverTime: "2026-08-13T12:01:00.000Z",
    serviceStartObservations: serviceStartWithRun(
      "2026-08-13T12:01:00.000Z",
      serviceCheckRun({
        started_at: "2026-08-13T11:50:00.000Z",
        completed_at: "2026-08-13T11:59:59.000Z",
      }),
    ),
  });
  const evidence = snapshot({
    issueComments: [setup.request, setup.carrier],
    exactArtifacts: [
      exact("issue_comment", setup.request),
      exact("issue_comment", setup.carrier),
    ],
    serverTime: "2026-08-13T12:16:00.000Z",
  });
  assert.throws(
    () => projectV2TransportSnapshots({
      discovery_snapshot: discovery,
      evidence_snapshot: evidence,
      controller: setup.controller,
    }),
    (error) => error instanceof V2ProjectorError && error.code === "FINAL_REREAD_DRIFT",
  );
});

test("final resolved-thread observation is a conservative recovery barrier", () => {
  const parent = inlineParentReview("201");
  const inline = inlineFindingComment("310", parent.id);
  const resolved = reviewThread("THREAD_310", inline, true);
  const request = issueComment("301", {
    body: "@codex review",
    author: HUMAN,
    created_at: "2026-08-13T12:10:00.000Z",
    updated_at: "2026-08-13T12:10:00.000Z",
  });
  const plusOne = reaction("401", "+1", "2026-08-13T12:15:00.000Z");
  const reactions = reactionInventory(
    [request],
    new Map([[request.id, [plusOne]]]),
    [parent],
    [inline],
  );
  const controller = makeController({
    requestBindings: [{
      id: request.id,
      kind: "automatic",
      base_oid: BASE,
      head_oid: HEAD,
      controlled: true,
    }],
    budget: {
      automatic_requests_on_head: 1,
      automatic_reservations_on_head: 1,
      manual_requests_in_epoch: 0,
    },
  });
  const discovery = snapshot({
    issueComments: [request],
    reviews: [parent],
    inlineComments: [inline],
    threads: [resolved],
    reactions,
    serverTime: "2026-08-13T12:05:00.000Z",
  });
  const evidence = snapshot({
    issueComments: [request],
    reviews: [parent],
    inlineComments: [inline],
    threads: [resolved],
    reactions,
    exactArtifacts: [
      exact("issue_comment", request),
      exact("pull_request_review", parent),
      exact("inline_comment", inline),
    ],
    serverTime: "2026-08-13T12:20:00.000Z",
  });
  const projected = projectV2TransportSnapshots({
    discovery_snapshot: discovery,
    evidence_snapshot: evidence,
    controller,
  });
  assert.equal(projected.threads[0].is_resolved, true);
  assert.equal(
    projected.threads[0].resolution_observed_at,
    "2026-08-13T12:20:00.000Z",
  );
  const report = reduceV2Snapshot(projected, {
    status_target_mode: "test-merge-with-head-sentinel",
    status_context: "codex/github-review-gate",
  });
  assert.equal(report.decision, "findings");
});

test("inline evidence requires exact provider identity on its parent review", () => {
  const parent = inlineParentReview("201");
  parent.app = { id: "42", slug: "other-app", node_id: "APP_other" };
  const inline = inlineFindingComment("310", parent.id);
  const thread = reviewThread("THREAD_310", inline, false);
  const discovery = snapshot({
    reviews: [parent],
    inlineComments: [inline],
    threads: [thread],
  });
  const evidence = snapshot({
    reviews: [parent],
    inlineComments: [inline],
    threads: [thread],
    exactArtifacts: [
      exact("pull_request_review", parent),
      exact("inline_comment", inline),
    ],
    serverTime: "2026-08-13T12:01:00.000Z",
  });
  assert.throws(
    () => projectV2TransportSnapshots({
      discovery_snapshot: discovery,
      evidence_snapshot: evidence,
      controller: makeController(),
    }),
    (error) => error instanceof V2ProjectorError &&
      error.code === "INLINE_PARENT_NOT_CLOSED",
  );
});

test("machine E2E reduces a raw terminal clean without evaluate-only effects", async () => {
  const clean = issueComment("202", {
    body: CLEAN_BODY,
    author: BOT,
    app: codexApp(),
  });
  const discovery = snapshot({ issueComments: [clean] });
  const evidence = snapshot({
    issueComments: [clean],
    exactArtifacts: [exact("issue_comment", clean)],
    serverTime: "2026-08-13T12:01:00.000Z",
  });
  const transport = sequentialTransport(discovery, evidence);

  const result = await runV2Operation(
    runnerInput(evidence, makeController()),
    { transport, reduceSnapshot: reduceV2Snapshot },
  );

  assert.equal(result.reducer_report.provider_profile, "terminal-payload");
  assert.equal(result.reducer_report.evidence_basis.kind, "terminal-clean");
  assert.equal(result.report.provider_profile, "terminal-payload");
  assert.equal(result.report.evidence_basis.kind, "terminal-payload");
  assert.equal(result.report.selection.source, "active-ruleset");
  assert.equal(result.decision, "clean");
  assert.deepEqual(result.scheduler_plan.actions, []);
  assert.deepEqual(result.status_plan.writes, []);
  assert.equal(result.status_plan.suppression_reason, "evaluate-only");
  assert.equal(result.status_plan.suppressed_writes.length, 1);
  assert.equal(result.writes_performed, false);
  assert.deepEqual(transport.calls[1].artifactSelectors, [
    { kind: "issue_comment", id: "202" },
  ]);
});

test("machine E2E reduces a raw manual request plus exact-provider +1 as clean", async () => {
  const requestComment = issueComment("301", {
    body: "@codex review",
    author: HUMAN,
    created_at: "2026-08-13T12:00:10.000Z",
    updated_at: "2026-08-13T12:00:10.000Z",
  });
  const plusOne = reaction("401", "+1", "2026-08-13T12:00:30.000Z");
  const reactions = reactionInventory([requestComment], new Map([["301", [plusOne]]]));
  const discovery = snapshot({ issueComments: [requestComment], reactions });
  const evidence = snapshot({
    issueComments: [requestComment],
    reactions,
    exactArtifacts: [exact("issue_comment", requestComment)],
    actorPermissions: [actorPermission("301", HUMAN)],
    serverTime: "2026-08-13T12:01:00.000Z",
  });
  const controller = makeController({
    requestBindings: [{
      id: "301",
      kind: "manual",
      base_oid: BASE,
      head_oid: HEAD,
      controlled: false,
    }],
    budget: {
      automatic_requests_on_head: 0,
      automatic_reservations_on_head: 0,
      manual_requests_in_epoch: 1,
    },
  });
  const transport = sequentialTransport(discovery, evidence);

  const result = await runV2Operation(
    runnerInput(evidence, controller),
    { transport, reduceSnapshot: reduceV2Snapshot },
  );

  assert.equal(result.reducer_report.provider_profile, "thumbs-up-clean");
  assert.equal(result.reducer_report.evidence_basis.kind, "thumbs-up-clean");
  assert.equal(result.report.provider_profile, "thumbs-up-clean");
  assert.equal(result.report.evidence_basis.kind, "current-request-reaction");
  assert.equal(result.decision, "clean");
  assert.equal(result.reducer_report.request_policy.permission_assurance, "point-in-time-only");
  assert.deepEqual({
    permission_assurance: result.report.request_policy.permission_assurance,
    request_time_permission: result.report.request_policy.request_time_permission,
    permission_aba_excluded: result.report.request_policy.permission_aba_excluded,
  }, {
    permission_assurance: "point-in-time-only",
    request_time_permission: "unproven",
    permission_aba_excluded: false,
  });
  assert.deepEqual(result.scheduler_plan.actions, []);
  assert.deepEqual(result.status_plan.writes, []);
  assert.equal(result.status_plan.suppression_reason, "evaluate-only");
  assert.equal(result.status_plan.suppressed_writes.length, 1);
  assert.equal(result.writes_performed, false);
  assert.deepEqual(transport.calls[1].permissionSubjects, [
    { kind: "issue_comment", id: "301" },
  ]);
});

test("machine E2E keeps a conflicting merge target null and plans only a head error", async () => {
  const invalidTarget = {
    potential_merge_oid: null,
    potential_merge_tree: null,
    ordered_parent_oids: [],
    merge_ref_oid: null,
    mergeable: "CONFLICTING",
  };
  const discovery = snapshot({ scopeOverrides: invalidTarget });
  const evidence = snapshot({
    scopeOverrides: invalidTarget,
    serverTime: "2026-08-13T12:01:00.000Z",
  });
  const transport = sequentialTransport(discovery, evidence);

  const result = await runV2Operation(
    runnerInput(evidence, makeController()),
    { transport, reduceSnapshot: reduceV2Snapshot },
  );

  assert.equal(result.decision, "blocked-input");
  assert.equal(result.reducer_report.status_target.sha, null);
  assert.equal(result.report.status_target.potential_target_state, "conflicting");
  assert.equal(result.status_plan.writes.length, 0);
  assert.deepEqual(
    result.status_plan.suppressed_writes.map(({ role, sha, state }) => ({
      role,
      sha,
      state,
    })),
    [{ role: "head-sentinel", sha: HEAD, state: "error" }],
  );
});

function snapshot({
  issueComments = [],
  reviews = [],
  inlineComments = [],
  threads = [],
  reactions = null,
  exactArtifacts = [],
  actorPermissions = [],
  serviceStartObservations = null,
  scopeOverrides = {},
  serverTime = "2026-08-13T12:00:00.000Z",
} = {}) {
  const normalizedReactions = reactions ??
    reactionInventory(issueComments, new Map(), reviews, inlineComments);
  const pages = {
    issue_comments: structuredClone(issueComments),
    reviews: structuredClone(reviews),
    inline_comments: structuredClone(inlineComments),
    threads: structuredClone(threads),
    reactions: structuredClone(normalizedReactions),
    exact_artifacts: structuredClone(exactArtifacts),
  };
  const itemCount =
    pages.issue_comments.length +
    pages.reviews.length +
    pages.inline_comments.length +
    pages.threads.length +
    pages.threads.reduce((sum, thread) => sum + thread.comments.length, 0) +
    pages.reactions.issue.length +
    pages.reactions.issue_comments.reduce((sum, group) => sum + group.reactions.length, 0) +
    pages.reactions.reviews.reduce((sum, group) => sum + group.reactions.length, 0) +
    pages.reactions.inline_comments.reduce((sum, group) => sum + group.reactions.length, 0) +
    pages.exact_artifacts.length;
  const scope = {
    base_ref_name: "master",
    base_ref_tip: BASE,
    head_ref_name: "feature",
    head_ref_oid: HEAD,
    merge_base_sha: MERGE_BASE,
    potential_merge_oid: MERGE,
    potential_merge_tree: TREE,
    ordered_parent_oids: [BASE, HEAD],
    merge_ref_oid: MERGE,
    mergeable: "MERGEABLE",
    ...scopeOverrides,
  };
  const receipt = {
    repository_owner: "owner",
    repository_name: "repo",
    repository_node_id: "R_repo",
    pull_request_number: 7,
    pull_request_node_id: "PR_7",
    pull_request_state: "OPEN",
    pull_request_merged: false,
    pull_request_merged_at: null,
    pull_request_is_draft: false,
    ...scope,
    server_time: serverTime,
  };
  const serviceStart = serviceStartObservations ??
    emptyServiceStartObservations(serverTime);
  return {
    schema_version: 2,
    repository: { owner: "owner", name: "repo", node_id: "R_repo" },
    pull_request: {
      number: 7,
      node_id: "PR_7",
      state: "OPEN",
      merged: false,
      merged_at: null,
      is_draft: false,
    },
    server_time: serverTime,
    scope,
    pages,
    permissions: {
      transport_capabilities: {
        stable: true,
        pre: transportCapability(serverTime),
        post: transportCapability(serverTime),
      },
      actor_permissions: structuredClone(actorPermissions),
    },
    service_start_observations: structuredClone(serviceStart),
    scope_receipts: {
      pre: scopeReceiptWithEndpointEvidence({
        ...structuredClone(receipt),
        server_time: new Date(Date.parse(serverTime) - 1_000).toISOString(),
      }),
      post: scopeReceiptWithEndpointEvidence(receipt),
    },
    completeness: {
      all_pages_loaded: true,
      issue_comments: true,
      reviews: true,
      inline_comments: true,
      threads: true,
      reactions: true,
      permissions: true,
      exact_artifacts: true,
      service_start_observations: true,
      request_count: 1,
      item_count: itemCount +
        serviceStart.pre.total_check_runs +
        serviceStart.post.total_check_runs,
      response_bytes: 1,
      server_date_headers: 1,
    },
    stability: {
      scope_stable: true,
      service_start_observations_stable: serviceStart.stable,
      server_time_monotonic: true,
    },
  };
}

function scopeReceiptWithEndpointEvidence(receipt) {
  const repoPath = `/repos/${receipt.repository_owner}/` +
    `${receipt.repository_name}`;
  const endpointReceipt = (method, path, status = 200) => ({
    method,
    path,
    status,
    server_time: receipt.server_time,
    raw_body_sha256: DIGEST,
  });
  return {
    ...structuredClone(receipt),
    endpoint_receipts: {
      pull_request: endpointReceipt(
        "GET",
        `${repoPath}/pulls/${receipt.pull_request_number}`,
      ),
      graphql: endpointReceipt("POST", "/graphql"),
      compare:
        receipt.base_ref_tip === null || receipt.head_ref_oid === null
          ? null
          : endpointReceipt(
            "GET",
            `${repoPath}/compare/${receipt.base_ref_tip}...` +
              `${receipt.head_ref_oid}`,
          ),
      merge_ref: endpointReceipt(
        "GET",
        `${repoPath}/git/ref/pull/${receipt.pull_request_number}/merge`,
        receipt.merge_ref_oid === null ? 404 : 200,
      ),
    },
  };
}

function makeController({
  requestBindings = [],
  artifactBindings = [],
  budget = {
    automatic_requests_on_head: 0,
    automatic_reservations_on_head: 0,
    manual_requests_in_epoch: 0,
  },
} = {}) {
  return {
    schema: V2_PROJECTOR_CONTROLLER_SCHEMA,
    schema_version: 1,
    selection: { policy: "user-explicit" },
    server_enforcement: {
      workflow: {
        present: true,
        compatible: true,
        source: "trusted-reusable-workflow",
        path: ".github/workflows/review-gate.yml",
        revision: HEAD,
      },
      ruleset: {
        required: true,
        present: true,
        compatible: true,
        status_context: "codex/github-review-gate",
        expected_source: "github-actions",
        source_id: "15368",
      },
      app: { required: true, bound: true, source_matches: true },
    },
    budget,
    request_bindings: requestBindings.map((binding, index) => ({
      generation_id: `${binding.kind}:${index + 1}`,
      generation_kind: binding.kind,
      generation_index: index + 1,
      ...binding,
    })),
    artifact_bindings: artifactBindings,
    thread_resolution_observations: [],
    no_start_observations: [],
    final_reread: {
      required: true,
      assurance: "two-complete-point-in-time-snapshots",
    },
  };
}

function runnerInput(snapshotValue, controller) {
  return {
    schema: V2_RUNNER_SCHEMA,
    schema_version: 1,
    operation: "evaluate-only",
    status_target_mode: "test-merge-with-head-sentinel",
    status_context: "codex/github-review-gate",
    snapshot_request: { owner: "owner", repo: "repo", pull_number: 7 },
    controller,
    public_report_authority: {
      schema: "codex-review-gate-public-selection-authority-v2",
      schema_version: 1,
      repository_node_id: snapshotValue.repository.node_id,
      pull_request_node_id: snapshotValue.pull_request.node_id,
      head_ref_oid: snapshotValue.scope.head_ref_oid,
      selection: {
        selected: true,
        intent: "required",
        mode: "implicit",
        source: "active-ruleset",
      },
      server_enforcement: "enforced",
      authority_receipt_digest: DIGEST,
    },
    scheduling: {
      trigger: "manual",
      public_wait_supported: true,
      status_target_mode: "test-merge-with-head-sentinel",
      run_identity: { run_id: "7001", run_attempt: 1 },
      epoch: {
        id: deriveV2EpochId(snapshotValue),
        started_at: "2026-08-13T11:00:00.000Z",
        controlled_request: null,
        automatic_request: {
          state: "available",
          intent_id: null,
          intent_persisted_at: null,
          effect_attempted_at: null,
        },
      },
      complete_snapshots: [],
      status: {
        exact_sha_context_count: 0,
        latest_idempotency_key: null,
        head_sentinel_receipt: {
          sha: snapshotValue.scope.head_ref_oid,
          context: "codex/github-review-gate",
          state: "pending",
          status_id: "9001",
          observed_at: "2026-08-13T11:59:59.000Z",
        },
      },
      applied_action_keys: [],
      no_start_candidate: null,
    },
    head_ledger: null,
    reservation: null,
    post_response: null,
  };
}

function sequentialTransport(discovery, evidence) {
  const snapshots = [discovery, evidence];
  return {
    calls: [],
    async loadSnapshot(request) {
      this.calls.push(structuredClone(request));
      const next = snapshots.shift();
      if (next === undefined) {
        throw new Error("unexpected third transport snapshot");
      }
      return structuredClone(next);
    },
  };
}

function issueComment(id, overrides = {}) {
  return {
    id,
    node_id: `IC_${id}`,
    url: `https://api.github.test/repos/owner/repo/issues/comments/${id}`,
    html_url: `https://github.com/owner/repo/pull/7#issuecomment-${id}`,
    issue_url: "https://api.github.test/repos/owner/repo/issues/7",
    author: HUMAN,
    app: null,
    author_association: "MEMBER",
    body: "ordinary comment",
    created_at: "2026-08-13T12:00:10.000Z",
    updated_at: "2026-08-13T12:00:10.000Z",
    ...overrides,
  };
}

function inlineParentReview(id) {
  return {
    id,
    node_id: `PRR_${id}`,
    url: `https://api.github.test/repos/owner/repo/pulls/7/reviews/${id}`,
    html_url: `https://github.com/owner/repo/pull/7#pullrequestreview-${id}`,
    pull_request_url: "https://api.github.test/repos/owner/repo/pulls/7",
    author: BOT,
    app: codexApp(),
    author_association: "NONE",
    body: officialInlineParentBody(),
    state: "COMMENTED",
    submitted_at: "2026-08-13T12:00:00.000Z",
    commit_id: HEAD,
  };
}

function terminalReview(id, overrides = {}) {
  return {
    id,
    node_id: `PRR_${id}`,
    url: `https://api.github.test/repos/owner/repo/pulls/7/reviews/${id}`,
    html_url: `https://github.com/owner/repo/pull/7#pullrequestreview-${id}`,
    pull_request_url: "https://api.github.test/repos/owner/repo/pulls/7",
    author: BOT,
    app: codexApp(),
    author_association: "NONE",
    body: null,
    state: "APPROVED",
    submitted_at: "2026-08-13T12:00:20.000Z",
    commit_id: HEAD,
    ...overrides,
  };
}

function inlineFindingComment(id, parentId) {
  return {
    id,
    node_id: `PRRC_${id}`,
    pull_request_review_id: parentId,
    url: `https://api.github.test/repos/owner/repo/pulls/comments/${id}`,
    html_url: `https://github.com/owner/repo/pull/7#discussion_r${id}`,
    pull_request_url: "https://api.github.test/repos/owner/repo/pulls/7",
    author: BOT,
    app: codexApp(),
    author_association: "NONE",
    body: "Please fix this exact current-head issue.",
    path: "src/example.mjs",
    line: 10,
    start_line: null,
    side: "RIGHT",
    start_side: null,
    commit_id: HEAD,
    original_commit_id: HEAD,
    in_reply_to_id: null,
    created_at: "2026-08-13T12:00:01.000Z",
    updated_at: "2026-08-13T12:00:01.000Z",
  };
}

function reviewThread(id, comment, isResolved) {
  return {
    id,
    is_resolved: isResolved,
    is_outdated: false,
    path: comment.path,
    line: comment.line,
    start_line: comment.start_line,
    diff_side: comment.side,
    start_diff_side: comment.start_side,
    comments: [{ id: comment.node_id, database_id: comment.id }],
  };
}

function officialInlineParentBody() {
  return [
    "### 💡 Codex Review",
    "",
    "Here are some automated review suggestions for this pull request.",
    "",
    `**Reviewed commit:** \`${HEAD}\``,
    "",
    "<details> <summary>ℹ️ About Codex in GitHub</summary>",
    "<br/>",
    "",
    "Codex has been enabled to automatically review pull requests in this repo. Reviews are triggered when you",
    "- Open a pull request for review",
    "- Mark a draft as ready",
    '- Comment "@codex review".',
    "",
    "If Codex has suggestions, it will comment; otherwise it will react with 👍.",
    "",
    "When you [sign up for Codex through ChatGPT](https://openai.com/codex), Codex can also answer questions or update the PR, like \"@codex address that feedback\".",
    "",
    "</details>",
  ].join("\n");
}

function exact(kind, artifact) {
  return {
    selector: { kind, id: artifact.id },
    artifact: structuredClone(artifact),
    response_server_time: "2026-08-13T12:00:40.000Z",
    raw_body_sha256: DIGEST,
  };
}

function reaction(id, content, createdAt) {
  return {
    id,
    node_id: `REACTION_${id}`,
    content,
    created_at: createdAt,
    author: BOT,
  };
}

function reactionInventory(
  issueComments,
  issueReactionMap = new Map(),
  reviews = [],
  inlineComments = [],
) {
  return {
    issue: [],
    issue_comments: issueComments.map((comment) => ({
      subject_id: comment.id,
      reactions: structuredClone(issueReactionMap.get(comment.id) ?? []),
    })),
    reviews: reviews.map((review) => ({
      subject_id: review.id,
      reactions: [],
    })),
    inline_comments: inlineComments.map((comment) => ({
      subject_id: comment.id,
      reactions: [],
    })),
  };
}

function actorPermission(subjectId, subjectActor) {
  const receipt = {
    subject: { kind: "issue_comment", id: subjectId },
    actor: structuredClone(subjectActor),
    effective_permission: "write",
    role_name: "write",
    permissions: {
      admin: false,
      maintain: false,
      push: true,
      triage: true,
      pull: true,
    },
    mapping_source: "user.permissions",
    permission_assurance: "point-in-time-only",
    request_time_permission: "unproven",
    permission_aba_excluded: false,
    endpoint: "https://api.github.test/repos/owner/repo/collaborators/reviewer/permission",
    http_status: 200,
    response_server_time: "2026-08-13T12:00:30.000Z",
    raw_body_sha256: DIGEST,
  };
  return {
    subject: { kind: "issue_comment", id: subjectId },
    actor: structuredClone(subjectActor),
    assurance: "point-in-time-only",
    request_time_permission: "unproven",
    permission_aba_excluded: false,
    stable: true,
    pre: structuredClone(receipt),
    post: structuredClone(receipt),
  };
}

function transportCapability(serverTime) {
  return {
    capability_kind: "authenticated-transport-token",
    admin: false,
    maintain: false,
    push: true,
    triage: true,
    pull: true,
    role_name: "write",
    endpoint: "https://api.github.test/repos/owner/repo",
    http_status: 200,
    response_server_time: serverTime,
    raw_body_sha256: DIGEST,
  };
}

function emptyServiceStartObservations(serverTime) {
  const receipt = {
    server_time: serverTime,
    page_count: 1,
    total_check_runs: 0,
    matching_app_ids: [],
    check_runs: [],
    page_receipts: [{
      page: 1,
      item_count: 0,
      total_count: 0,
      response_server_time: serverTime,
      raw_body_sha256: DIGEST,
    }],
  };
  return {
    provider_app_slug: "chatgpt-codex-connector",
    head_sha: HEAD,
    pre: structuredClone(receipt),
    post: structuredClone(receipt),
    stable: true,
  };
}

function serviceCheckRun(overrides = {}) {
  return {
    id: "701",
    node_id: "CR_701",
    url: "https://api.github.test/repos/owner/repo/check-runs/701",
    name: "Codex",
    head_sha: HEAD,
    status: "completed",
    conclusion: "success",
    started_at: "2026-08-13T11:50:00.000Z",
    completed_at: "2026-08-13T11:59:59.000Z",
    external_id: null,
    details_url: null,
    app: {
      id: "42",
      node_id: "APP_codex",
      slug: "chatgpt-codex-connector",
    },
    ...overrides,
  };
}

function serviceStartWithRun(serverTime, run) {
  const runs = [structuredClone(run)];
  const receipt = {
    server_time: serverTime,
    page_count: 1,
    total_check_runs: 1,
    matching_app_ids: ["42"],
    check_runs: runs,
    page_receipts: [{
      page: 1,
      item_count: 1,
      total_count: 1,
      response_server_time: serverTime,
      raw_body_sha256: DIGEST,
    }],
  };
  return {
    provider_app_slug: "chatgpt-codex-connector",
    head_sha: HEAD,
    pre: structuredClone(receipt),
    post: structuredClone(receipt),
    stable: true,
  };
}

function noStartFixture() {
  const request = issueComment("301", {
    body: "@codex review",
    author: HUMAN,
    created_at: "2026-08-13T12:00:00.000Z",
    updated_at: "2026-08-13T12:00:00.000Z",
  });
  const carrier = issueComment("401", {
    body: V2_NO_START_BODIES[0],
    author: BOT,
    app: codexApp(),
    created_at: "2026-08-13T12:00:30.000Z",
    updated_at: "2026-08-13T12:00:30.000Z",
  });
  const controller = makeController({
    requestBindings: [{
      id: request.id,
      kind: "automatic",
      base_oid: BASE,
      head_oid: HEAD,
      controlled: true,
    }],
    budget: {
      automatic_requests_on_head: 1,
      automatic_reservations_on_head: 1,
      manual_requests_in_epoch: 0,
    },
  });
  controller.no_start_observations = [{
    request_id: request.id,
    carrier_selector: { kind: "issue_comment", id: carrier.id },
    first_seen_at: "2026-08-13T12:01:00.000Z",
    first_run_id: "1",
    confirmation_run_id: "2",
    request_run_id: "0",
  }];
  return { request, carrier, controller };
}

function projectNoStartWithServiceRun(times) {
  const setup = noStartFixture();
  const run = serviceCheckRun(times);
  const discovery = snapshot({
    issueComments: [setup.request, setup.carrier],
    serverTime: "2026-08-13T12:01:00.000Z",
    serviceStartObservations: serviceStartWithRun(
      "2026-08-13T12:01:00.000Z",
      run,
    ),
  });
  const evidence = snapshot({
    issueComments: [setup.request, setup.carrier],
    exactArtifacts: [
      exact("issue_comment", setup.request),
      exact("issue_comment", setup.carrier),
    ],
    serverTime: "2026-08-13T12:16:00.000Z",
    serviceStartObservations: serviceStartWithRun(
      "2026-08-13T12:16:00.000Z",
      run,
    ),
  });
  return projectV2TransportSnapshots({
    discovery_snapshot: discovery,
    evidence_snapshot: evidence,
    controller: setup.controller,
  });
}

function actor(id, login, type, nodeId) {
  return { id, login, type, node_id: nodeId };
}

function codexApp() {
  return { id: "15368", slug: "chatgpt-codex-connector", node_id: "APP_codex" };
}
