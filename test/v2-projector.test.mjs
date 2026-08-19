import assert from "node:assert/strict";
import test from "node:test";

import {
  V2ProjectorError,
  V2_PROJECTOR_CONTROLLER_SCHEMA,
  deriveV2EvidenceRequest,
  deriveV2SelectionProjection,
  projectV2TransportSnapshots,
} from "../packages/action/src/v2/projector.mjs";
import {
  V2PublicReportProjectionError,
  projectV2AutomaticRequestRecoveryAuthority,
} from "../packages/action/src/v2/public-report-projector.mjs";
import { reduceV2Snapshot } from "../packages/action/src/v2/reducer.mjs";
import { V2_NO_START_BODIES } from "../packages/action/src/v2/schema.mjs";
import {
  V2_RUNNER_SCHEMA,
  assertV2AutomaticRequestRecoveryHandle,
  deriveV2EpochId,
  getV2AutomaticRecoveryArtifactBindingCandidateHandle,
  getV2AutomaticRequestRecoveryHandle,
  projectV2AutomaticRequestRecoveryForGitLedger,
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

test("bindings define request identity; unbound candidates require no-push proof", () => {
  const oldHead = "9".repeat(40);
  const requestComment = issueComment("301", {
    body: "@codex review",
    author: HUMAN,
    created_at: "2026-08-13T12:00:10.000Z",
    updated_at: "2026-08-13T12:00:10.000Z",
  });
  const oldPlusOne = reaction("401", "+1", "2026-08-13T12:00:30.000Z");
  const reactions = reactionInventory(
    [requestComment],
    new Map([[requestComment.id, [oldPlusOne]]]),
  );
  const discovery = snapshot({ issueComments: [requestComment], reactions });
  const controller = makeController({
    requestBindings: [{
      id: requestComment.id,
      kind: "automatic",
      base_oid: BASE,
      head_oid: oldHead,
      current_incarnation: false,
      controlled: true,
    }],
  });

  const evidenceRequest = deriveV2EvidenceRequest({
    discovery_snapshot: discovery,
    controller,
  });
  assert.deepEqual(evidenceRequest, {
    artifactSelectors: [],
    permissionSubjects: [],
  });

  const evidence = snapshot({
    issueComments: [requestComment],
    reactions,
    serverTime: "2026-08-13T12:01:00.000Z",
  });
  const projected = projectV2TransportSnapshots({
    discovery_snapshot: discovery,
    evidence_snapshot: evidence,
    controller,
  });
  assert.deepEqual(projected.requests, []);
  assert.deepEqual(projected.acknowledgements, []);

  const unboundEvidenceRequest = deriveV2EvidenceRequest({
    discovery_snapshot: discovery,
    controller: makeController(),
  });
  assert.deepEqual(unboundEvidenceRequest, {
    artifactSelectors: [{ kind: "issue_comment", id: requestComment.id }],
    permissionSubjects: [{ kind: "issue_comment", id: requestComment.id }],
  });
  const unboundEvidence = snapshot({
    issueComments: [requestComment],
    reactions,
    exactArtifacts: [exact("issue_comment", requestComment)],
    actorPermissions: [readOnlyActorPermission(
      requestComment.id,
      requestComment.author,
    )],
    serverTime: "2026-08-13T12:01:00.000Z",
  });
  const unboundProjected = projectV2TransportSnapshots({
    discovery_snapshot: discovery,
    evidence_snapshot: unboundEvidence,
    controller: makeController(),
  });
  assert.deepEqual(unboundProjected.requests, []);
  assert.deepEqual(unboundProjected.acknowledgements, []);

  const authorizedEvidence = snapshot({
    issueComments: [requestComment],
    reactions,
    exactArtifacts: [exact("issue_comment", requestComment)],
    actorPermissions: [
      actorPermission(requestComment.id, requestComment.author),
    ],
    serverTime: "2026-08-13T12:01:00.000Z",
  });
  assert.throws(
    () => projectV2TransportSnapshots({
      discovery_snapshot: discovery,
      evidence_snapshot: authorizedEvidence,
      controller: makeController(),
    }),
    (error) => error instanceof V2ProjectorError &&
      error.code === "REQUEST_BINDING_MISSING",
  );
});

test("unbound request candidates require stable actor-matched two-point authority",
  async (context) => {
    const candidate = issueComment("301", {
      body: "@codex review",
      author: HUMAN,
      created_at: "2026-08-13T12:00:10.000Z",
      updated_at: "2026-08-13T12:00:10.000Z",
    });
    const discovery = snapshot({ issueComments: [candidate] });
    const project = (actorPermissions) => projectV2TransportSnapshots({
      discovery_snapshot: discovery,
      evidence_snapshot: snapshot({
        issueComments: [candidate],
        exactArtifacts: [exact("issue_comment", candidate)],
        actorPermissions,
        serverTime: "2026-08-13T12:01:00.000Z",
      }),
      controller: makeController(),
    });

    await context.test("missing receipt", () => {
      assert.throws(
        () => project([]),
        (error) => error instanceof V2ProjectorError &&
          error.code === "MISSING_ACTOR_PERMISSION",
      );
    });

    await context.test("unstable receipt", () => {
      const permission = readOnlyActorPermission(candidate.id, candidate.author);
      permission.stable = false;
      assert.throws(
        () => project([permission]),
        (error) => error instanceof V2ProjectorError &&
          error.code === "PERMISSION_UNSTABLE",
      );
    });

    // Public projector entry points validate the closed transport schema first.
    // Their repeated actor/projection checks are defense-in-depth invariants.
    await context.test(
      "transport rejects actor differing from exact artifact author",
      () => {
        const permission = readOnlyActorPermission(candidate.id, candidate.author);
        const other = actor("77", "other", "User", "USER_other");
        permission.actor = structuredClone(other);
        permission.pre.actor = structuredClone(other);
        permission.post.actor = structuredClone(other);
        assert.throws(
          () => project([permission]),
          (error) => error instanceof V2ProjectorError &&
            error.code === "INVALID_TRANSPORT_SNAPSHOT" &&
            error.cause instanceof TypeError &&
            error.cause.message ===
              "snapshot.permissions.actor_permissions[0] permission actor must equal its exact artifact author",
        );
      },
    );

    await context.test(
      "transport rejects mixed pre/post permission projections",
      () => {
        const permission = readOnlyActorPermission(candidate.id, candidate.author);
        const authorized = actorPermission(candidate.id, candidate.author);
        permission.post = authorized.post;
        assert.throws(
          () => project([permission]),
          (error) => error instanceof V2ProjectorError &&
            error.code === "INVALID_TRANSPORT_SNAPSHOT" &&
            error.cause instanceof TypeError &&
            error.cause.message ===
              "snapshot.permissions.actor_permissions[0] pre/post permission projections differ",
        );
      },
    );
  });

test("current-head request bindings fail closed when their comment is absent or edited",
  async (context) => {
    const controller = makeController({
      requestBindings: [{
        id: "301",
        kind: "automatic",
        base_oid: BASE,
        head_oid: HEAD,
        current_incarnation: true,
        controlled: true,
      }],
      budget: {
        automatic_requests_on_head: 1,
        automatic_reservations_on_head: 1,
        manual_requests_in_epoch: 0,
      },
    });

    await context.test("absent comment", () => {
      assert.throws(
        () => deriveV2EvidenceRequest({
          discovery_snapshot: snapshot(),
          controller,
        }),
        (error) => error instanceof V2ProjectorError &&
          error.code === "REQUEST_BINDING_ORPHANED",
      );
    });

    await context.test("edited comment", () => {
      const edited = issueComment("301", {
        body: "@codex review",
        created_at: "2026-08-13T12:00:10.000Z",
        updated_at: "2026-08-13T12:00:20.000Z",
      });
      assert.throws(
        () => deriveV2EvidenceRequest({
          discovery_snapshot: snapshot({ issueComments: [edited] }),
          controller,
        }),
        (error) => error instanceof V2ProjectorError &&
          error.code === "REQUEST_BINDING_ORPHANED",
      );
    });
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

test("stable unauthorized address lookalikes are inert while authorized commands close findings",
  () => {
    const finding = issueComment("202", {
      body:
        "### 💡 Codex Review\n\n" +
        `- [P1] Fix the issue https://github.com/owner/repo/blob/${HEAD}/src/a.js#L1`,
      author: BOT,
      app: codexApp(),
      created_at: "2026-08-13T12:00:10.000Z",
      updated_at: "2026-08-13T12:00:10.000Z",
    });
    const outsider = issueComment("303", {
      body: `/codex-gate addressed ${finding.html_url}`,
      author: actor("77", "outsider", "User", "USER_outsider"),
      created_at: "2026-08-13T12:00:20.000Z",
      updated_at: "2026-08-13T12:00:20.000Z",
    });
    const nonUser = issueComment("304", {
      body: `/codex-gate addressed ${finding.html_url}`,
      author: BOT,
      app: codexApp(),
      created_at: "2026-08-13T12:00:25.000Z",
      updated_at: "2026-08-13T12:00:25.000Z",
    });
    const maintainer = issueComment("305", {
      body: `/codex-gate addressed ${finding.html_url}`,
      author: HUMAN,
      created_at: "2026-08-13T12:00:30.000Z",
      updated_at: "2026-08-13T12:00:30.000Z",
    });
    const outsiderPermission = readOnlyActorPermission(
      outsider.id,
      outsider.author,
    );
    const issueComments = [finding, outsider, nonUser, maintainer];
    const discovery = snapshot({ issueComments });
    const evidence = snapshot({
      issueComments,
      exactArtifacts: issueComments.map((comment) =>
        exact("issue_comment", comment)),
      actorPermissions: [
        outsiderPermission,
        actorPermission(nonUser.id, nonUser.author),
        actorPermission(maintainer.id, maintainer.author),
      ],
      serverTime: "2026-08-13T12:01:00.000Z",
    });

    const projected = projectV2TransportSnapshots({
      discovery_snapshot: discovery,
      evidence_snapshot: evidence,
      controller: makeController(),
    });

    assert.deepEqual(projected.acknowledgements, [{
      id: maintainer.id,
      kind: "addressed",
      request_id: null,
      finding_id: projected.artifacts[0].finding_ids[0],
      created_at: maintainer.created_at,
      commit_oid: HEAD,
      exact_provider: false,
      stable: true,
    }]);
  });

test("ignores an exact authorized address command for an authenticated earlier-head carrier", () => {
  const earlierHead = "9".repeat(40);
  const finding = issueComment("202", {
    body:
      "### 💡 Codex Review\n\n" +
      `- [P1] Earlier-head finding https://github.com/owner/repo/blob/${earlierHead}/src/a.js#L1`,
    author: BOT,
    app: codexApp(),
    created_at: "2026-08-13T12:00:10.000Z",
    updated_at: "2026-08-13T12:00:10.000Z",
  });
  const address = issueComment("303", {
    body: `/codex-gate addressed ${finding.html_url}`,
    author: HUMAN,
    created_at: "2026-08-13T12:00:30.000Z",
    updated_at: "2026-08-13T12:00:30.000Z",
  });
  const snapshotInput = { issueComments: [finding, address] };
  const discovery = snapshot(snapshotInput);
  const evidence = snapshot({
    ...snapshotInput,
    exactArtifacts: [
      exact("issue_comment", finding),
      exact("issue_comment", address),
    ],
    actorPermissions: [actorPermission(address.id, address.author)],
    serverTime: "2026-08-13T12:01:00.000Z",
  });

  const projected = projectV2TransportSnapshots({
    discovery_snapshot: discovery,
    evidence_snapshot: evidence,
    controller: makeController(),
  });

  assert.deepEqual(projected.artifacts, []);
  assert.deepEqual(projected.threads, []);
  assert.deepEqual(projected.acknowledgements, []);
});

test("historical address filtering preserves fail-closed target binding",
  async (context) => {
    const projectAddressFixture = ({ finding = null, review = null, targetUrl }) => {
      const address = issueComment("303", {
        body: `/codex-gate addressed ${targetUrl}`,
        author: HUMAN,
        created_at: "2026-08-13T12:00:30.000Z",
        updated_at: "2026-08-13T12:00:30.000Z",
      });
      const issueComments = [finding, address].filter((item) => item !== null);
      const reviews = review === null ? [] : [review];
      const discovery = snapshot({ issueComments, reviews });
      const evidence = snapshot({
        issueComments,
        reviews,
        exactArtifacts: [
          ...issueComments.map((item) => exact("issue_comment", item)),
          ...reviews.map((item) => exact("pull_request_review", item)),
        ],
        actorPermissions: [actorPermission(address.id, address.author)],
        serverTime: "2026-08-13T12:01:00.000Z",
      });
      return () => projectV2TransportSnapshots({
        discovery_snapshot: discovery,
        evidence_snapshot: evidence,
        controller: makeController(),
      });
    };

    await context.test("absent current-head target", () => {
      assert.throws(
        projectAddressFixture({
          targetUrl:
            "https://github.com/owner/repo/pull/7#issuecomment-202",
        }),
        (error) => error instanceof V2ProjectorError &&
          error.code === "ADDRESS_COMMAND_TARGET_INVALID",
      );
    });

    await context.test("wrong historical carrier URL", () => {
      const earlierHead = "9".repeat(40);
      const finding = issueComment("202", {
        body:
          "### 💡 Codex Review\n\n" +
          `- [P1] Earlier-head finding https://github.com/owner/repo/blob/${earlierHead}/src/a.js#L1`,
        author: BOT,
        app: codexApp(),
      });
      assert.throws(
        projectAddressFixture({
          finding,
          targetUrl:
            "https://github.com/owner/repo/pull/7#issuecomment-999",
        }),
        (error) => error instanceof V2ProjectorError &&
          error.code === "ADDRESS_COMMAND_TARGET_INVALID",
      );
    });

    await context.test("ambiguous current-head carrier identity", () => {
      const body =
        "### 💡 Codex Review\n\n" +
        `- [P1] Current finding https://github.com/owner/repo/blob/${HEAD}/src/a.js#L1`;
      const finding = issueComment("202", {
        body,
        author: BOT,
        app: codexApp(),
      });
      const review = terminalReview("202", {
        body,
        state: "COMMENTED",
        commit_id: HEAD,
      });
      assert.throws(
        projectAddressFixture({
          finding,
          review,
          targetUrl: finding.html_url,
        }),
        (error) => error instanceof V2ProjectorError &&
          error.code === "TOP_LEVEL_CARRIER_AMBIGUOUS",
      );
    });
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

test("provider reaction on an earlier request does not veto current no-start", () => {
  const prior = issueComment("300", {
    body: "@codex review",
    author: HUMAN,
    created_at: "2026-08-13T12:00:00.000Z",
    updated_at: "2026-08-13T12:00:00.000Z",
  });
  const current = issueComment("301", {
    body: "@codex review",
    author: HUMAN,
    created_at: "2026-08-13T12:05:00.000Z",
    updated_at: "2026-08-13T12:05:00.000Z",
  });
  const noStart = issueComment("401", {
    body: V2_NO_START_BODIES[0],
    author: BOT,
    app: codexApp(),
    created_at: "2026-08-13T12:05:30.000Z",
    updated_at: "2026-08-13T12:05:30.000Z",
  });
  const priorPlusOne = reaction("501", "+1", "2026-08-13T12:10:00.000Z");
  const reactions = reactionInventory(
    [prior, current, noStart],
    new Map([[prior.id, [priorPlusOne]]]),
  );
  const admission = controllerGenerationAdmission(prior, current);
  const controller = makeController({
    requestBindings: [
      {
        id: prior.id,
        kind: "automatic",
        base_oid: BASE,
        head_oid: HEAD,
        current_incarnation: false,
        controlled: true,
      },
      {
        id: current.id,
        kind: "automatic",
        base_oid: BASE,
        head_oid: HEAD,
        controlled: true,
      },
    ],
    generationAdmissions: [admission],
    budget: {
      automatic_requests_on_head: 2,
      automatic_reservations_on_head: 2,
      manual_requests_in_epoch: 0,
    },
  });
  controller.no_start_observations = [{
    request_id: current.id,
    carrier_selector: { kind: "issue_comment", id: noStart.id },
    first_seen_at: "2026-08-13T12:11:00.000Z",
    first_run_id: "1",
    confirmation_run_id: "2",
    request_run_id: "0",
  }];
  const discovery = snapshot({
    issueComments: [prior, current, noStart],
    reactions,
    serverTime: "2026-08-13T12:11:00.000Z",
  });
  const evidence = snapshot({
    issueComments: [prior, current, noStart],
    reactions,
    exactArtifacts: [
      exact("issue_comment", prior),
      exact("issue_comment", current),
      exact("issue_comment", noStart),
    ],
    serverTime: "2026-08-13T12:26:00.000Z",
  });

  const projected = projectV2TransportSnapshots({
    discovery_snapshot: discovery,
    evidence_snapshot: evidence,
    controller,
  });
  assert.equal(projected.no_start_observations.length, 1);
  assert.equal(projected.no_start_observations[0].request_id, current.id);
  assert.equal(reduceV2Snapshot(projected, {
    status_target_mode: "test-merge-with-head-sentinel",
    status_context: "codex/github-review-gate",
  }).decision, "skipped-unavailable");

  for (const [id, content, createdAt] of [
    ["502", "+1", current.created_at],
    ["503", "eyes", "2026-08-13T12:10:00.000Z"],
  ]) {
    const currentReaction = reaction(id, content, createdAt);
    const currentReactions = reactionInventory(
      [prior, current, noStart],
      new Map([[current.id, [currentReaction]]]),
    );
    const vetoed = projectV2TransportSnapshots({
      discovery_snapshot: snapshot({
        issueComments: [prior, current, noStart],
        reactions: currentReactions,
        serverTime: "2026-08-13T12:11:00.000Z",
      }),
      evidence_snapshot: snapshot({
        issueComments: [prior, current, noStart],
        reactions: currentReactions,
        exactArtifacts: [
          exact("issue_comment", prior),
          exact("issue_comment", current),
          exact("issue_comment", noStart),
        ],
        serverTime: "2026-08-13T12:26:00.000Z",
      }),
      controller,
    });
    assert.deepEqual(vetoed.no_start_observations, []);
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

test("runner mints an opaque recovery handle only for exact closed prior findings",
  async () => {
    const request = issueComment("301", {
      body: "@codex review",
      author: HUMAN,
      created_at: "2026-08-13T11:59:00.000Z",
      updated_at: "2026-08-13T11:59:00.000Z",
    });
    const parent = inlineParentReview("201");
    const inline = inlineFindingComment("310", parent.id);
    inline.created_at = parent.submitted_at;
    inline.updated_at = parent.submitted_at;
    const resolved = reviewThread("THREAD_310", inline, true);
    const controller = makeController({
      requestBindings: [{
        id: request.id,
        kind: "automatic",
        base_oid: BASE,
        head_oid: HEAD,
        controlled: true,
      }],
      artifactBindings: [{ id: parent.id, request_id: request.id }],
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
      serverTime: "2026-08-13T12:05:00.000Z",
    });
    const evidence = snapshot({
      issueComments: [request],
      reviews: [parent],
      inlineComments: [inline],
      threads: [resolved],
      exactArtifacts: [
        exact("issue_comment", request),
        exact("pull_request_review", parent),
        exact("inline_comment", inline),
      ],
      serverTime: "2026-08-13T12:20:00.000Z",
    });
    const input = runnerInput(evidence, controller);
    input.scheduling.epoch.controlled_request = {
      request_id: request.id,
      bound_at: request.created_at,
      binding_record_oid: "1".repeat(40),
      binding_receipt_digest: DIGEST,
    };
    input.scheduling.epoch.automatic_request = {
      state: "effect-attempted",
      generation_index: 1,
      recovery_authority: null,
      intent_id: "automatic:1:fixture",
      intent_persisted_at: request.created_at,
      effect_attempted_at: request.created_at,
    };
    const result = await runV2Operation(input, {
      transport: sequentialTransport(discovery, evidence),
      reduceSnapshot: reduceV2Snapshot,
    });
    assert.equal(result.decision, "findings");
    const handle = getV2AutomaticRequestRecoveryHandle(result);
    assert.equal(
      assertV2AutomaticRequestRecoveryHandle(handle, {
        runner_result: result,
      }),
      handle,
    );
    const proof = projectV2AutomaticRequestRecoveryForGitLedger(handle);
    assert.equal(proof.prior_generation_id, "automatic:1");
    assert.equal(proof.next_generation_id, "automatic:2");
    assert.equal(proof.prior_request_id, request.id);
    assert.equal(proof.finding_ids.length, 1);
    assert.deepEqual(proof.closure_ids, [resolved.id]);
    assert.equal(proof.same_review_epoch, true);
    const advancedInput = runnerInput(evidence, controller);
    advancedInput.scheduling.epoch.controlled_request = structuredClone(
      input.scheduling.epoch.controlled_request,
    );
    advancedInput.scheduling.epoch.automatic_request = {
      state: "available",
      generation_index: 2,
      recovery_authority: {
        prior_generation_id: proof.prior_generation_id,
        finding_ids: [...proof.finding_ids],
        closure_ids: [...proof.closure_ids],
        closure_observed_at: proof.closure_observed_at,
      },
      intent_id: null,
      intent_persisted_at: null,
      effect_attempted_at: null,
    };
    const advanced = await runV2Operation(advancedInput, {
      transport: sequentialTransport(discovery, evidence),
      reduceSnapshot: reduceV2Snapshot,
    });
    assert.equal(getV2AutomaticRequestRecoveryHandle(advanced), null);
    assert.equal(
      getV2AutomaticRecoveryArtifactBindingCandidateHandle(advanced),
      null,
    );
    assert.equal(
      JSON.stringify(result).includes(
        "codex-review-gate-runner-automatic-request-recovery-handle-v2",
      ),
      false,
    );
    assert.equal(JSON.stringify(result).includes("closure_ids"), false);
    assert.throws(
      () => getV2AutomaticRequestRecoveryHandle(structuredClone(result)),
      /exact runner result/u,
    );
    assert.throws(
      () => assertV2AutomaticRequestRecoveryHandle(structuredClone(handle)),
      /opaque recovery handle/u,
    );
  });

test("automatic recovery accepts one exact addressed top-level finding and emits a safe proof",
  async () => {
    const fixture = topLevelAutomaticRecoveryFixture();
    const result = await runAutomaticRecoveryFixture(fixture);
    const handle = getV2AutomaticRequestRecoveryHandle(result);
    const proof = projectV2AutomaticRequestRecoveryForGitLedger(handle);

    assert.equal(result.decision, "findings");
    assert.equal(proof.decision, "findings");
    assert.equal(proof.snapshot_fingerprint, result.reducer_report.snapshot_fingerprint);
    assert.equal(proof.review_epoch_id, deriveV2EpochId(fixture.evidence));
    assert.equal(proof.prior_generation_id, "automatic:1");
    assert.equal(proof.next_generation_id, "automatic:2");
    assert.equal(proof.finding_ids.length, 1);
    assert.equal(proof.closure_records[0].finding_id, proof.finding_ids[0]);
    assert.deepEqual(proof.closure_ids, [fixture.address.id]);
    assert.equal(proof.closure_records[0].finding_kind, "top-level");
    assert.equal(proof.same_review_epoch, true);
    assertSafeAutomaticRecoveryProof(proof);
  });

test("automatic recovery advances an earlier-base second generation after a same-head retarget",
  async () => {
    const retargetedBase = "9".repeat(40);
    const retargetedMergeBase = "8".repeat(40);
    const retargetedScope = {
      base_ref_tip: retargetedBase,
      merge_base_sha: retargetedMergeBase,
      ordered_parent_oids: [retargetedBase, HEAD],
    };
    const firstRequest = issueComment("301", {
      body: "@codex review",
      author: HUMAN,
      created_at: "2026-08-13T11:40:00.000Z",
      updated_at: "2026-08-13T11:40:00.000Z",
    });
    const firstFinding = issueComment("201", {
      body:
        "### 💡 Codex Review\n\n" +
        `- [P1] First generation https://github.com/owner/repo/blob/${HEAD}/src/a.js#L1`,
      author: BOT,
      app: codexApp(),
      created_at: "2026-08-13T11:45:00.000Z",
      updated_at: "2026-08-13T11:45:00.000Z",
    });
    const firstAddress = issueComment("401", {
      body: `/codex-gate addressed ${firstFinding.html_url}`,
      author: HUMAN,
      created_at: "2026-08-13T11:50:00.000Z",
      updated_at: "2026-08-13T11:50:00.000Z",
    });
    const secondRequest = issueComment("302", {
      body: "@codex review",
      author: HUMAN,
      created_at: "2026-08-13T11:55:00.000Z",
      updated_at: "2026-08-13T11:55:00.000Z",
    });
    const secondFinding = issueComment("202", {
      body:
        "### 💡 Codex Review\n\n" +
        `- [P1] Second generation https://github.com/owner/repo/blob/${HEAD}/src/b.js#L2`,
      author: BOT,
      app: codexApp(),
      created_at: "2026-08-13T12:00:10.000Z",
      updated_at: "2026-08-13T12:00:10.000Z",
    });
    const secondAddress = issueComment("402", {
      body: `/codex-gate addressed ${secondFinding.html_url}`,
      author: HUMAN,
      created_at: "2026-08-13T12:00:30.000Z",
      updated_at: "2026-08-13T12:00:30.000Z",
    });
    const issueComments = [
      firstFinding,
      secondFinding,
      firstRequest,
      secondRequest,
      firstAddress,
      secondAddress,
    ];
    const controller = makeController({
      requestBindings: [{
        id: firstRequest.id,
        kind: "automatic",
        base_oid: BASE,
        head_oid: HEAD,
        controlled: true,
        generation_id: "automatic:1",
        generation_kind: "automatic",
        generation_index: 1,
      }, {
        id: secondRequest.id,
        kind: "automatic",
        base_oid: BASE,
        head_oid: HEAD,
        controlled: true,
        generation_id: "automatic:2",
        generation_kind: "automatic",
        generation_index: 2,
      }],
      artifactBindings: [{
        id: firstFinding.id,
        request_id: firstRequest.id,
      }, {
        id: secondFinding.id,
        request_id: secondRequest.id,
      }],
      budget: {
        automatic_requests_on_head: 2,
        automatic_reservations_on_head: 2,
        manual_requests_in_epoch: 0,
      },
    });
    const discovery = snapshot({
      issueComments,
      scopeOverrides: retargetedScope,
      serverTime: "2026-08-13T12:05:00.000Z",
    });
    const evidence = snapshot({
      issueComments,
      exactArtifacts: issueComments.map((item) =>
        exact("issue_comment", item)),
      actorPermissions: [
        actorPermission(firstAddress.id, firstAddress.author),
        actorPermission(secondAddress.id, secondAddress.author),
      ],
      scopeOverrides: retargetedScope,
      serverTime: "2026-08-13T12:20:00.000Z",
    });
    const projected = projectV2TransportSnapshots({
      discovery_snapshot: discovery,
      evidence_snapshot: evidence,
      controller,
    });
    const report = reduceV2Snapshot(projected, {
      status_target_mode: "test-merge-with-head-sentinel",
      status_context: "codex/github-review-gate",
    });
    const proof = projectV2AutomaticRequestRecoveryAuthority({
      compact_report: report,
      reducer_input: projected,
      discovery_snapshot: discovery,
      evidence_snapshot: evidence,
      controller,
      controlled_request: {
        request_id: secondRequest.id,
        bound_at: secondRequest.created_at,
        binding_record_oid: "2".repeat(40),
        binding_receipt_digest: DIGEST,
      },
    });

    assert.equal(report.request_policy.status, "compliant");
    assert.equal(report.request_policy.selected_request_id, secondRequest.id);
    assert.equal(controller.request_bindings[1].base_oid, BASE);
    assert.equal(proof.prior_generation_id, "automatic:2");
    assert.equal(proof.next_generation_id, "automatic:3");
    assert.equal(proof.scope.base_oid, retargetedBase);
    assert.equal(proof.scope.merge_base_oid, retargetedMergeBase);
    assert.deepEqual(proof.closure_ids, [secondAddress.id]);
    assertSafeAutomaticRecoveryProof(proof);
    const secondGenerationInput = runnerInput(evidence, controller);
    secondGenerationInput.scheduling.epoch.controlled_request = {
      request_id: secondRequest.id,
      bound_at: secondRequest.created_at,
      binding_record_oid: "2".repeat(40),
      binding_receipt_digest: DIGEST,
    };
    secondGenerationInput.scheduling.epoch.automatic_request = {
      state: "effect-attempted",
      generation_index: 2,
      recovery_authority: {
        prior_generation_id: "automatic:1",
        finding_ids: [firstFinding.id],
        closure_ids: [firstAddress.id],
        closure_observed_at: firstAddress.created_at,
      },
      intent_id: "automatic:2:fixture",
      intent_persisted_at: secondRequest.created_at,
      effect_attempted_at: secondRequest.created_at,
    };
    const secondGenerationResult = await runV2Operation(
      secondGenerationInput,
      {
        transport: sequentialTransport(discovery, evidence),
        reduceSnapshot: reduceV2Snapshot,
        planActions: () => ({ actions: [] }),
      },
    );
    const secondGenerationHandle =
      getV2AutomaticRequestRecoveryHandle(secondGenerationResult);
    assert.notEqual(secondGenerationHandle, null);
    assert.equal(
      projectV2AutomaticRequestRecoveryForGitLedger(secondGenerationHandle)
        .prior_generation_id,
      "automatic:2",
    );

    const projectWithBetweenGenerationArtifact = (artifact) => {
      const poisonedComments = [...issueComments, artifact];
      const poisonedDiscovery = snapshot({
        issueComments: poisonedComments,
        scopeOverrides: retargetedScope,
        serverTime: "2026-08-13T12:05:00.000Z",
      });
      const poisonedEvidence = snapshot({
        issueComments: poisonedComments,
        exactArtifacts: poisonedComments.map((item) =>
          exact("issue_comment", item)),
        actorPermissions: [
          actorPermission(firstAddress.id, firstAddress.author),
          actorPermission(secondAddress.id, secondAddress.author),
        ],
        scopeOverrides: retargetedScope,
        serverTime: "2026-08-13T12:20:00.000Z",
      });
      const poisonedProjected = projectV2TransportSnapshots({
        discovery_snapshot: poisonedDiscovery,
        evidence_snapshot: poisonedEvidence,
        controller,
      });
      assert.equal(poisonedProjected.review_epoch.base_oid, retargetedBase);
      assert.equal(
        poisonedProjected.review_epoch.merge_base_oid,
        retargetedMergeBase,
      );
      const poisonedReport = reduceV2Snapshot(poisonedProjected, {
        status_target_mode: "test-merge-with-head-sentinel",
        status_context: "codex/github-review-gate",
      });
      assert.equal(poisonedReport.decision, "findings");
      return projectV2AutomaticRequestRecoveryAuthority({
        compact_report: poisonedReport,
        reducer_input: poisonedProjected,
        discovery_snapshot: poisonedDiscovery,
        evidence_snapshot: poisonedEvidence,
        controller,
        controlled_request: {
          request_id: secondRequest.id,
          bound_at: secondRequest.created_at,
          binding_record_oid: "2".repeat(40),
          binding_receipt_digest: DIGEST,
        },
      });
    };
    const betweenGenerationMalformed = issueComment("450", {
      body: "### 💡 Codex Review\n\nnot a closed finding",
      author: BOT,
      app: codexApp(),
      created_at: "2026-08-13T11:52:00.000Z",
      updated_at: "2026-08-13T11:52:00.000Z",
    });
    assert.equal(
      projectWithBetweenGenerationArtifact(betweenGenerationMalformed),
      null,
    );
    const unboundEarlierFinding = issueComment("451", {
      body:
        "### 💡 Codex Review\n\n" +
        `- [P1] Unbound predecessor finding https://github.com/owner/repo/blob/${HEAD}/src/c.js#L3`,
      author: BOT,
      app: codexApp(),
      created_at: "2026-08-13T11:43:00.000Z",
      updated_at: "2026-08-13T11:43:00.000Z",
    });
    assert.equal(
      projectWithBetweenGenerationArtifact(unboundEarlierFinding),
      null,
    );
  });

test("generation three findings do not mint a useless artifact-binding candidate",
  async () => {
    const requests = ["301", "302", "303"].map((id, index) =>
      issueComment(id, {
        body: "@codex review",
        author: HUMAN,
        created_at: `2026-08-13T11:${30 + index * 10}:00.000Z`,
        updated_at: `2026-08-13T11:${30 + index * 10}:00.000Z`,
      }));
    const findings = ["201", "202", "203"].map((id, index) =>
      issueComment(id, {
        body:
          "### 💡 Codex Review\n\n" +
          `- [P1] Generation ${index + 1} https://github.com/owner/repo/blob/${HEAD}/src/a.js#L${index + 1}`,
        author: BOT,
        app: codexApp(),
        created_at: `2026-08-13T11:${32 + index * 10}:00.000Z`,
        updated_at: `2026-08-13T11:${32 + index * 10}:00.000Z`,
      }));
    const addresses = ["401", "402"].map((id, index) =>
      issueComment(id, {
        body: `/codex-gate addressed ${findings[index].html_url}`,
        author: HUMAN,
        created_at: `2026-08-13T11:${34 + index * 10}:00.000Z`,
        updated_at: `2026-08-13T11:${34 + index * 10}:00.000Z`,
      }));
    const issueComments = [
      findings[0], addresses[0], requests[0], findings[1], addresses[1],
      requests[1], requests[2], findings[2],
    ];
    const controller = makeController({
      requestBindings: requests.map((request, index) => ({
        id: request.id,
        kind: "automatic",
        base_oid: BASE,
        head_oid: HEAD,
        controlled: true,
        generation_id: `automatic:${index + 1}`,
        generation_kind: "automatic",
        generation_index: index + 1,
      })),
      artifactBindings: findings.slice(0, 2).map((finding, index) => ({
        id: finding.id,
        request_id: requests[index].id,
      })),
      budget: {
        automatic_requests_on_head: 3,
        automatic_reservations_on_head: 3,
        manual_requests_in_epoch: 0,
      },
    });
    const discovery = snapshot({
      issueComments,
      serverTime: "2026-08-13T12:05:00.000Z",
    });
    const evidence = snapshot({
      issueComments,
      exactArtifacts: issueComments.map((item) =>
        exact("issue_comment", item)),
      actorPermissions: addresses.map((address) =>
        actorPermission(address.id, address.author)),
      serverTime: "2026-08-13T12:20:00.000Z",
    });
    const input = automaticRecoveryRunnerInput(
      evidence,
      controller,
      requests[2],
    );
    input.scheduling.epoch.automatic_request = {
      ...input.scheduling.epoch.automatic_request,
      generation_index: 3,
      intent_id: "automatic:3:fixture",
      recovery_authority: {
        prior_generation_id: "automatic:2",
        finding_ids: [findings[1].id],
        closure_ids: [addresses[1].id],
        closure_observed_at: addresses[1].created_at,
      },
    };
    const result = await runV2Operation(input, {
      transport: sequentialTransport(discovery, evidence),
      reduceSnapshot: reduceV2Snapshot,
    });
    assert.equal(result.decision, "findings");
    assert.equal(
      getV2AutomaticRecoveryArtifactBindingCandidateHandle(result),
      null,
    );
    assert.equal(getV2AutomaticRequestRecoveryHandle(result), null);
  });

test("automatic recovery requires the final raw inline thread to be resolved",
  async () => {
    const fixture = inlineAutomaticRecoveryFixture({ resolved: false });
    const result = await runAutomaticRecoveryFixture(fixture);
    assert.equal(result.decision, "findings");
    assert.equal(getV2AutomaticRequestRecoveryHandle(result), null);

    const projected = projectV2TransportSnapshots({
      discovery_snapshot: fixture.discovery,
      evidence_snapshot: fixture.evidence,
      controller: fixture.controller,
    });
    const forged = structuredClone(projected);
    forged.threads[0].is_resolved = true;
    forged.threads[0].resolution_observed_at = fixture.evidence.server_time;
    const forgedReport = reduceV2Snapshot(forged, {
      status_target_mode: "test-merge-with-head-sentinel",
      status_context: "codex/github-review-gate",
    });
    assert.equal(forgedReport.evidence_basis.kind, "terminal-findings");
    assert.equal(projectV2AutomaticRequestRecoveryAuthority({
      compact_report: forgedReport,
      reducer_input: forged,
      discovery_snapshot: fixture.discovery,
      evidence_snapshot: fixture.evidence,
      controller: fixture.controller,
      controlled_request: automaticRecoveryRunnerInput(
        fixture.evidence,
        fixture.controller,
        fixture.request,
      ).scheduling.epoch.controlled_request,
    }), null);
  });

test("automatic top-level recovery rejects incomplete or unstable raw authority",
  async (context) => {
    await context.test("missing exact finding artifact", async () => {
      const fixture = topLevelAutomaticRecoveryFixture();
      fixture.evidence.pages.exact_artifacts =
        fixture.evidence.pages.exact_artifacts.filter((receipt) =>
          receipt.selector.id !== fixture.finding.id);
      fixture.evidence.completeness.item_count -= 1;
      await assert.rejects(
        runAutomaticRecoveryFixture(fixture),
        (error) => error instanceof V2ProjectorError &&
          error.code === "MISSING_EXACT_ARTIFACT",
      );
    });

    await context.test("edited address body", async () => {
      const fixture = topLevelAutomaticRecoveryFixture({
        addressOverrides: { updated_at: "2026-08-13T12:00:31.000Z" },
      });
      await assert.rejects(
        runAutomaticRecoveryFixture(fixture),
        (error) => error instanceof V2ProjectorError &&
          error.code === "ADDRESS_COMMAND_EDITED",
      );
    });

    await context.test("authorized malformed address target", async () => {
      const fixture = topLevelAutomaticRecoveryFixture({
        addressOverrides: { body: "/codex-gate addressed not-a-url" },
      });
      await assert.rejects(
        runAutomaticRecoveryFixture(fixture),
        (error) => error instanceof V2ProjectorError &&
          error.code === "ADDRESS_COMMAND_TARGET_INVALID",
      );
    });

    await context.test("Bot address actor is inert", async () => {
      const fixture = topLevelAutomaticRecoveryFixture({
        addressOverrides: { author: BOT, app: codexApp() },
      });
      const result = await runAutomaticRecoveryFixture(fixture);
      assert.equal(result.decision, "findings");
      assert.equal(getV2AutomaticRequestRecoveryHandle(result), null);
    });

    await context.test("permission drift", async () => {
      const fixture = topLevelAutomaticRecoveryFixture({
        permissionMutator(permission) {
          permission.stable = false;
        },
      });
      await assert.rejects(
        runAutomaticRecoveryFixture(fixture),
        (error) => error instanceof V2ProjectorError &&
          error.code === "PERMISSION_UNSTABLE",
      );
    });

    await context.test(
      "transport rejects address actor differing from exact artifact author",
      async () => {
        const fixture = topLevelAutomaticRecoveryFixture({
          permissionMutator(permission) {
            const other = actor("77", "other", "User", "USER_other");
            permission.actor = structuredClone(other);
            permission.pre.actor = structuredClone(other);
            permission.post.actor = structuredClone(other);
          },
        });
        await assert.rejects(
          runAutomaticRecoveryFixture(fixture),
          (error) => error instanceof V2ProjectorError &&
            error.code === "INVALID_TRANSPORT_SNAPSHOT" &&
            error.cause instanceof TypeError &&
            error.cause.message ===
              "snapshot.permissions.actor_permissions[0] permission actor must equal its exact artifact author",
        );
      },
    );

    await context.test("missing permission receipt", async () => {
      const fixture = topLevelAutomaticRecoveryFixture();
      fixture.evidence.permissions.actor_permissions = [];
      await assert.rejects(
        runAutomaticRecoveryFixture(fixture),
        (error) => error instanceof V2ProjectorError &&
          error.code === "MISSING_ACTOR_PERMISSION",
      );
    });

    await context.test("closure does not strictly follow finding", async () => {
      const fixture = topLevelAutomaticRecoveryFixture({
        addressOverrides: {
          created_at: "2026-08-13T12:00:10.000Z",
          updated_at: "2026-08-13T12:00:10.000Z",
        },
      });
      await assert.rejects(
        runAutomaticRecoveryFixture(fixture),
        (error) => error instanceof V2ProjectorError &&
          error.code === "ADDRESS_COMMAND_NOT_LATER",
      );
    });
  });

test("automatic recovery rejects partial multi-finding closure and misbound findings",
  async (context) => {
    await context.test("one of two inline findings remains unresolved", async () => {
      const fixture = inlineAutomaticRecoveryFixture({
        resolved: true,
        secondResolved: false,
      });
      const result = await runAutomaticRecoveryFixture(fixture);
      assert.equal(result.decision, "findings");
      assert.equal(getV2AutomaticRequestRecoveryHandle(result), null);
    });

    await context.test("finding has null request_id", async () => {
      const fixture = inlineAutomaticRecoveryFixture({ artifactRequestId: null });
      const result = await runAutomaticRecoveryFixture(fixture);
      assert.equal(result.decision, "findings");
      assert.equal(getV2AutomaticRequestRecoveryHandle(result), null);
    });

    await context.test("forged reducer request binding is not authority", () => {
      const fixture = inlineAutomaticRecoveryFixture({ artifactRequestId: null });
      const projected = projectV2TransportSnapshots({
        discovery_snapshot: fixture.discovery,
        evidence_snapshot: fixture.evidence,
        controller: fixture.controller,
      });
      const forged = structuredClone(projected);
      const artifact = forged.artifacts.find((item) =>
        item.kind === "terminal-findings");
      assert.ok(artifact);
      artifact.request_id = fixture.request.id;
      const forgedReport = reduceV2Snapshot(forged, {
        status_target_mode: "test-merge-with-head-sentinel",
        status_context: "codex/github-review-gate",
      });
      assert.equal(forgedReport.decision, "findings");
      assert.equal(projectV2AutomaticRequestRecoveryAuthority({
        compact_report: forgedReport,
        reducer_input: forged,
        discovery_snapshot: fixture.discovery,
        evidence_snapshot: fixture.evidence,
        controller: fixture.controller,
        controlled_request: automaticRecoveryRunnerInput(
          fixture.evidence,
          fixture.controller,
          fixture.request,
        ).scheduling.epoch.controlled_request,
      }), null);
    });

    await context.test("forged reducer cannot omit an unresolved provider sibling", () => {
      const fixture = inlineAutomaticRecoveryFixture({
        resolved: true,
        secondResolved: false,
      });
      const projected = projectV2TransportSnapshots({
        discovery_snapshot: fixture.discovery,
        evidence_snapshot: fixture.evidence,
        controller: fixture.controller,
      });
      const forged = structuredClone(projected);
      const omittedFindingId = "thread:THREAD_311";
      const artifact = forged.artifacts.find((item) =>
        item.kind === "terminal-findings");
      assert.ok(artifact);
      artifact.finding_ids = artifact.finding_ids.filter((findingId) =>
        findingId !== omittedFindingId);
      forged.threads = forged.threads.filter((thread) =>
        thread.finding_id !== omittedFindingId);
      const forgedReport = reduceV2Snapshot(forged, {
        status_target_mode: "test-merge-with-head-sentinel",
        status_context: "codex/github-review-gate",
      });
      assert.equal(forgedReport.decision, "findings");
      assert.equal(projectV2AutomaticRequestRecoveryAuthority({
        compact_report: forgedReport,
        reducer_input: forged,
        discovery_snapshot: fixture.discovery,
        evidence_snapshot: fixture.evidence,
        controller: fixture.controller,
        controlled_request: automaticRecoveryRunnerInput(
          fixture.evidence,
          fixture.controller,
          fixture.request,
        ).scheduling.epoch.controlled_request,
      }), null);
    });

    await context.test("finding is bound to a different request", async () => {
      const manual = issueComment("300", {
        body: "@codex review",
        author: HUMAN,
        created_at: "2026-08-13T11:58:00.000Z",
        updated_at: "2026-08-13T11:58:00.000Z",
      });
      const fixture = inlineAutomaticRecoveryFixture({
        extraRequests: [manual],
        extraRequestBindings: [{
          id: manual.id,
          kind: "manual",
          base_oid: BASE,
          head_oid: HEAD,
          controlled: false,
          generation_id: "manual:1",
          generation_kind: "manual",
          generation_index: 1,
        }],
        actorPermissions: [actorPermission(manual.id, manual.author)],
        artifactRequestId: manual.id,
      });
      const result = await runAutomaticRecoveryFixture(fixture);
      assert.equal(result.decision, "findings");
      assert.equal(getV2AutomaticRequestRecoveryHandle(result), null);
    });

    await context.test("a later unbound terminal clean remains visible", async () => {
      const clean = issueComment("500", {
        body: CLEAN_BODY,
        author: BOT,
        app: codexApp(),
        created_at: "2026-08-13T12:10:00.000Z",
        updated_at: "2026-08-13T12:10:00.000Z",
      });
      const fixture = inlineAutomaticRecoveryFixture({
        extraRequests: [clean],
      });
      const result = await runAutomaticRecoveryFixture(fixture);
      assert.equal(result.decision, "findings");
      assert.equal(getV2AutomaticRequestRecoveryHandle(result), null);
    });

    await context.test("equal-time malformed terminal outranks findings", async () => {
      const malformed = issueComment("199", {
        body: "### 💡 Codex Review\n\nnot a closed finding",
        author: BOT,
        app: codexApp(),
        created_at: "2026-08-13T12:00:10.000Z",
        updated_at: "2026-08-13T12:00:10.000Z",
      });
      const fixture = topLevelAutomaticRecoveryFixture({
        extraIssueComments: [malformed],
      });
      const result = await runAutomaticRecoveryFixture(fixture);
      assert.equal(getV2AutomaticRequestRecoveryHandle(result), null);
    });

    await context.test("equal-time cross-channel findings are ambiguous", async () => {
      const topLevel = issueComment("202", {
        body:
          "### 💡 Codex Review\n\n" +
          `- [P1] Cross-channel https://github.com/owner/repo/blob/${HEAD}/src/a.js#L1`,
        author: BOT,
        app: codexApp(),
        created_at: "2026-08-13T12:00:00.000Z",
        updated_at: "2026-08-13T12:00:00.000Z",
      });
      const fixture = inlineAutomaticRecoveryFixture({
        extraRequests: [topLevel],
        extraArtifactBindings: [{
          id: topLevel.id,
          request_id: "301",
        }],
      });
      const result = await runAutomaticRecoveryFixture(fixture);
      assert.equal(getV2AutomaticRequestRecoveryHandle(result), null);
    });
  });

test("automatic recovery rejects ineligible controlled request generations",
  async (context) => {
    await context.test("uncontrolled request", async () => {
      const fixture = inlineAutomaticRecoveryFixture({
        requestBindingOverrides: { controlled: false },
      });
      const result = await runAutomaticRecoveryFixture(fixture);
      assert.equal(getV2AutomaticRequestRecoveryHandle(result), null);
    });

    await context.test("edited request", async () => {
      const fixture = inlineAutomaticRecoveryFixture({
        requestOverrides: { updated_at: "2026-08-13T11:59:01.000Z" },
      });
      await assert.rejects(
        runAutomaticRecoveryFixture(fixture),
        (error) => error instanceof V2ProjectorError &&
          error.code === "REQUEST_BINDING_ORPHANED",
      );
    });

    await context.test("forged compliant request policy is not authority", () => {
      const unprivilegedManual = issueComment("300", {
        body: "@codex review",
        author: HUMAN,
        created_at: "2026-08-13T11:50:00.000Z",
        updated_at: "2026-08-13T11:50:00.000Z",
      });
      const unprivilegedPermission = readOnlyActorPermission(
        unprivilegedManual.id,
        unprivilegedManual.author,
      );
      const fixture = topLevelAutomaticRecoveryFixture({
        extraIssueComments: [unprivilegedManual],
        extraRequestBindings: [{
          id: unprivilegedManual.id,
          kind: "manual",
          base_oid: BASE,
          head_oid: HEAD,
          controlled: false,
          generation_id: "manual:1",
          generation_kind: "manual",
          generation_index: 1,
        }],
        extraActorPermissions: [unprivilegedPermission],
      });
      const projected = projectV2TransportSnapshots({
        discovery_snapshot: fixture.discovery,
        evidence_snapshot: fixture.evidence,
        controller: fixture.controller,
      });
      const report = reduceV2Snapshot(projected, {
        status_target_mode: "test-merge-with-head-sentinel",
        status_context: "codex/github-review-gate",
      });
      assert.equal(report.decision, "findings");
      assert.equal(report.request_policy.status, "unknown");
      const forgedReport = structuredClone(report);
      forgedReport.request_policy.status = "compliant";
      assert.equal(projectV2AutomaticRequestRecoveryAuthority({
        compact_report: forgedReport,
        reducer_input: projected,
        discovery_snapshot: fixture.discovery,
        evidence_snapshot: fixture.evidence,
        controller: fixture.controller,
        controlled_request: automaticRecoveryRunnerInput(
          fixture.evidence,
          fixture.controller,
          fixture.request,
        ).scheduling.epoch.controlled_request,
      }), null);
    });

    await context.test("generation two without admitted generation one", async () => {
      const fixture = inlineAutomaticRecoveryFixture({
        requestBindingOverrides: {
          generation_id: "automatic:2",
          generation_kind: "automatic",
          generation_index: 2,
        },
      });
      const result = await runAutomaticRecoveryFixture(fixture);
      assert.equal(getV2AutomaticRequestRecoveryHandle(result), null);
    });

    await context.test("visible later unadmitted request", async () => {
      const later = issueComment("302", {
        body: "@codex review",
        author: HUMAN,
        created_at: "2026-08-13T12:04:00.000Z",
        updated_at: "2026-08-13T12:04:00.000Z",
      });
      const fixture = inlineAutomaticRecoveryFixture({
        extraRequests: [later],
        extraRequestBindings: [{
          id: later.id,
          kind: "automatic",
          base_oid: BASE,
          head_oid: HEAD,
          controlled: true,
          generation_id: "automatic:2",
          generation_kind: "automatic",
          generation_index: 2,
        }],
      });
      const result = await runAutomaticRecoveryFixture(fixture);
      assert.equal(result.decision, "findings");
      assert.equal(getV2AutomaticRequestRecoveryHandle(result), null);
    });

    await context.test("request budget does not admit the visible generation", async () => {
      const fixture = inlineAutomaticRecoveryFixture({
        budget: {
          automatic_requests_on_head: 0,
          automatic_reservations_on_head: 0,
          manual_requests_in_epoch: 0,
        },
      });
      await assert.rejects(
        runAutomaticRecoveryFixture(fixture),
        (error) => error instanceof V2PublicReportProjectionError &&
          error.code === "PUBLIC_REPORT_UNREPRESENTABLE",
      );
    });

    await context.test("duplicate generation identity", async () => {
      const duplicate = issueComment("302", {
        body: "@codex review",
        author: HUMAN,
        created_at: "2026-08-13T12:04:00.000Z",
        updated_at: "2026-08-13T12:04:00.000Z",
      });
      const fixture = inlineAutomaticRecoveryFixture({
        extraRequests: [duplicate],
        extraRequestBindings: [{
          id: duplicate.id,
          kind: "automatic",
          base_oid: BASE,
          head_oid: HEAD,
          controlled: true,
          generation_id: "automatic:1",
          generation_kind: "automatic",
          generation_index: 1,
        }],
      });
      const result = await runAutomaticRecoveryFixture(fixture);
      assert.equal(getV2AutomaticRequestRecoveryHandle(result), null);
    });
  });

test("automatic recovery review epoch follows repository, PR, and head across base retarget",
  async () => {
    const retargetedBase = "9".repeat(40);
    const retargetedMergeBase = "8".repeat(40);
    const fixture = inlineAutomaticRecoveryFixture({
      scopeOverrides: {
        base_ref_tip: retargetedBase,
        merge_base_sha: retargetedMergeBase,
        ordered_parent_oids: [retargetedBase, HEAD],
      },
    });
    const result = await runAutomaticRecoveryFixture(fixture);
    const proof = projectV2AutomaticRequestRecoveryForGitLedger(
      getV2AutomaticRequestRecoveryHandle(result),
    );
    assert.equal(fixture.controller.request_bindings[0].base_oid, BASE);
    assert.equal(proof.scope.base_oid, retargetedBase);
    assert.equal(proof.review_epoch_id, deriveV2EpochId(fixture.evidence));
    assert.equal(proof.same_review_epoch, true);
  });

test("automatic recovery does not cross a head epoch", async () => {
  const differentHead = "7".repeat(40);
  const fixture = inlineAutomaticRecoveryFixture({
    scopeOverrides: {
      head_ref_oid: differentHead,
      ordered_parent_oids: [BASE, differentHead],
    },
  });
  await assert.rejects(
    runAutomaticRecoveryFixture(fixture),
    (error) => error instanceof V2ProjectorError &&
      error.code === "ARTIFACT_GENERATION_BINDING_INVALID",
  );
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

test("projects durable same-head recovery admission across base retarget without positive evidence", () => {
  const prior = issueComment("201", {
    body: "@codex review",
    author: HUMAN,
    created_at: "2026-08-13T12:00:00.000Z",
    updated_at: "2026-08-13T12:00:00.000Z",
  });
  const next = issueComment("203", {
    body: "@codex review",
    author: HUMAN,
    created_at: "2026-08-13T12:05:00.000Z",
    updated_at: "2026-08-13T12:05:00.000Z",
  });
  const discovery = snapshot({ issueComments: [prior, next] });
  const evidence = snapshot({
    issueComments: [prior, next],
    exactArtifacts: [
      exact("issue_comment", prior),
      exact("issue_comment", next),
    ],
    serverTime: "2026-08-13T12:06:00.000Z",
  });
  const admission = controllerGenerationAdmission(prior, next);
  const controller = makeController({
    requestBindings: [
      {
        id: prior.id,
        kind: "automatic",
        base_oid: "9".repeat(40),
        head_oid: HEAD,
        controlled: true,
      },
      {
        id: next.id,
        kind: "automatic",
        base_oid: "9".repeat(40),
        head_oid: HEAD,
        controlled: true,
      },
    ],
    generationAdmissions: [admission],
    budget: {
      automatic_requests_on_head: 2,
      automatic_reservations_on_head: 2,
      manual_requests_in_epoch: 0,
    },
  });
  const projected = projectV2TransportSnapshots({
    discovery_snapshot: discovery,
    evidence_snapshot: evidence,
    controller,
  });
  assert.deepEqual(projected.generation_admissions, [admission]);

  const report = reduceV2Snapshot(projected, {
    status_target_mode: "test-merge-with-head-sentinel",
    status_context: "codex/github-review-gate",
  });
  assert.equal(report.decision, "pending");
  assert.equal(report.request_policy.status, "compliant");
  assert.equal(report.request_policy.selected_request_id, next.id);
  assert.equal(report.request_policy.generation_id, "automatic:2");
  assert.equal(report.provider_profile, "unknown");
  assert.equal(report.evidence_basis, null);

  for (const transitionServerTime of [prior.created_at, next.created_at]) {
    const invalid = structuredClone(controller);
    invalid.generation_admissions[0].transition_server_time =
      transitionServerTime;
    assert.throws(
      () => projectV2TransportSnapshots({
        discovery_snapshot: discovery,
        evidence_snapshot: evidence,
        controller: invalid,
      }),
      (error) => error instanceof V2ProjectorError &&
        error.code === "GENERATION_ADMISSION_LINEAGE_INVALID",
    );
  }
});

test("machine E2E keeps a raw unbound terminal clean non-authoritative", async () => {
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
  assert.equal(
    result.reducer_report.evidence_basis.scope_assurance,
    "artifact-publication-only",
  );
  assert.equal(result.decision, "inconclusive");
  assert.deepEqual(result.scheduler_plan.actions, []);
  assert.deepEqual(result.status_plan.writes, []);
  assert.equal(result.writes_performed, false);
});

test("machine E2E reduces a current-request-bound raw terminal clean without effects", async () => {
  const request = issueComment("201", {
    body: "@codex review",
    author: HUMAN,
    created_at: "2026-08-13T11:59:00.000Z",
    updated_at: "2026-08-13T11:59:00.000Z",
  });
  const clean = issueComment("202", {
    body: CLEAN_BODY,
    author: BOT,
    app: codexApp(),
  });
  const discovery = snapshot({ issueComments: [request, clean] });
  const cleanExact = exact("issue_comment", clean);
  const evidence = snapshot({
    issueComments: [request, clean],
    exactArtifacts: [
      exact("issue_comment", request),
      cleanExact,
    ],
    serverTime: "2026-08-13T12:01:00.000Z",
  });
  const controller = makeController({
    requestBindings: [{
      id: request.id,
      kind: "automatic",
      base_oid: BASE,
      head_oid: HEAD,
      controlled: true,
    }],
    artifactBindings: [richArtifactBinding(
      "issue_comment",
      clean,
      cleanExact,
      request.id,
    )],
    budget: {
      automatic_requests_on_head: 1,
      automatic_reservations_on_head: 1,
      manual_requests_in_epoch: 0,
    },
  });
  const transport = sequentialTransport(discovery, evidence);

  const result = await runV2Operation(
    runnerInput(evidence, controller),
    { transport, reduceSnapshot: reduceV2Snapshot },
  );

  assert.equal(result.reducer_report.provider_profile, "terminal-payload");
  assert.equal(result.reducer_report.evidence_basis.kind, "terminal-clean");
  assert.equal(result.report.provider_profile, "terminal-payload");
  assert.equal(result.report.evidence_basis.kind, "terminal-payload");
  assert.equal(result.report.selection.source, "active-ruleset");
  assert.equal(result.reducer_report.evidence_basis.authority_receipt.selected_request, null);
  assert.equal(result.reducer_report.evidence_basis.authority_receipt.selected_generation, null);
  assert.equal(result.reducer_report.evidence_basis.authority_receipt.recovery, null);
  assert.equal(result.report.evidence_basis.scope_assurance, "artifact-publication-only");
  assert.equal(result.decision, "inconclusive");
  assert.deepEqual(result.scheduler_plan.actions, []);
  assert.deepEqual(result.status_plan.writes, []);
  assert.equal(result.status_plan.suppression_reason, "evaluate-only");
  assert.equal(result.status_plan.suppressed_writes.length, 2);
  assert.equal(
    result.status_plan.suppressed_writes.every(({ state }) => state === "error"),
    true,
  );
  assert.equal(result.status_plan.terminal_cutover, false);
  assert.equal(result.writes_performed, false);
  assert.deepEqual(transport.calls[1].artifactSelectors, [
    { kind: "issue_comment", id: "201" },
    { kind: "issue_comment", id: "202" },
  ]);
});

test("machine E2E rejects raw terminal clean without current positive authority",
  async (context) => {
    const cases = [{
      name: "current request without artifact binding",
      requestBaseOid: BASE,
      bindingKind: "none",
    }, {
      name: "current request with legacy two-field artifact binding",
      requestBaseOid: BASE,
      bindingKind: "legacy",
    }, {
      name: "rich artifact bound to an earlier-base request",
      requestBaseOid: "9".repeat(40),
      bindingKind: "rich",
    }];

    for (const fixture of cases) {
      await context.test(fixture.name, async () => {
        const request = issueComment("201", {
          body: "@codex review",
          author: HUMAN,
          created_at: "2026-08-13T11:59:00.000Z",
          updated_at: "2026-08-13T11:59:00.000Z",
        });
        const clean = issueComment("202", {
          body: CLEAN_BODY,
          author: BOT,
          app: codexApp(),
        });
        const discovery = snapshot({ issueComments: [request, clean] });
        const cleanExact = exact("issue_comment", clean);
        const evidence = snapshot({
          issueComments: [request, clean],
          exactArtifacts: [
            exact("issue_comment", request),
            cleanExact,
          ],
          serverTime: "2026-08-13T12:01:00.000Z",
        });
        const controller = makeController({
          requestBindings: [{
            id: request.id,
            kind: "automatic",
            base_oid: fixture.requestBaseOid,
            head_oid: HEAD,
            controlled: true,
          }],
          artifactBindings: fixture.bindingKind === "none"
            ? []
            : fixture.bindingKind === "legacy"
              ? [{ id: clean.id, request_id: request.id }]
              : [richArtifactBinding(
                  "issue_comment",
                  clean,
                  cleanExact,
                  request.id,
                )],
          budget: {
            automatic_requests_on_head: 1,
            automatic_reservations_on_head: 1,
            manual_requests_in_epoch: 0,
          },
        });
        const transport = sequentialTransport(discovery, evidence);

        const result = await runV2Operation(
          runnerInput(evidence, controller),
          { transport, reduceSnapshot: reduceV2Snapshot },
        );

        assert.equal(
          result.reducer_report.request_policy.selected_request_id,
          request.id,
        );
        assert.equal(result.reducer_report.provider_profile, "terminal-payload");
        assert.equal(result.reducer_report.evidence_basis.kind, "terminal-clean");
        assert.equal(
          result.reducer_report.evidence_basis.scope_assurance,
          "artifact-publication-only",
        );
        assert.equal(
          result.reducer_report.evidence_basis.authority_receipt.selected_request,
          null,
        );
        assert.equal(result.report.provider_profile, "terminal-payload");
        assert.equal(result.report.evidence_basis.kind, "terminal-payload");
        assert.equal(result.report.evidence_basis.scope_assurance,
          "artifact-publication-only");
        assert.equal(result.decision, "inconclusive");
        assert.deepEqual(result.scheduler_plan.actions, []);
        assert.deepEqual(result.status_plan.writes, []);
        assert.equal(result.writes_performed, false);
      });
    }
  });

test("terminal-clean rich artifact binding rejects every closed commitment drift",
  async (context) => {
    const request = issueComment("201", {
      body: "@codex review",
      author: HUMAN,
      created_at: "2026-08-13T11:59:00.000Z",
      updated_at: "2026-08-13T11:59:00.000Z",
    });
    const clean = issueComment("202", {
      body: CLEAN_BODY,
      author: BOT,
      app: codexApp(),
      created_at: "2026-08-13T12:00:20.000Z",
      updated_at: "2026-08-13T12:00:20.000Z",
    });
    const cleanExact = exact("issue_comment", clean);
    const discovery = snapshot({ issueComments: [request, clean] });
    const evidence = snapshot({
      issueComments: [request, clean],
      exactArtifacts: [
        exact("issue_comment", request),
        cleanExact,
      ],
      serverTime: "2026-08-13T12:01:00.000Z",
    });
    const baseBinding = richArtifactBinding(
      "issue_comment",
      clean,
      cleanExact,
      request.id,
    );
    assert.equal(baseBinding.generation_id, "automatic:1");
    assert.equal(baseBinding.request_node_id, request.node_id);
    const cases = [{
      name: "selector kind",
      mutate(binding) { binding.artifact_selector.kind = "pull_request_review"; },
    }, {
      name: "selector and top-level id",
      mutate(binding) {
        binding.id = "203";
        binding.artifact_selector.id = "203";
      },
    }, {
      name: "artifact type",
      mutate(binding) { binding.artifact_type = "pull_request_review"; },
    }, {
      name: "artifact node id",
      mutate(binding) { binding.artifact_node_id = "IC_edited"; },
    }, {
      name: "artifact URL",
      mutate(binding) {
        binding.artifact_url =
          "https://github.com/owner/repo/pull/7#issuecomment-999";
      },
    }, {
      name: "artifact created time",
      mutate(binding) {
        binding.artifact_created_at = "2026-08-13T12:00:21.000Z";
      },
    }, {
      name: "raw body digest",
      mutate(binding) {
        binding.raw_body_sha256 = `sha256:${"1".repeat(64)}`;
      },
    }, {
      name: "actor",
      mutate(binding) { binding.actor.node_id = "BOT_edited"; },
    }, {
      name: "App",
      mutate(binding) { binding.app.node_id = "APP_edited"; },
    }, {
      name: "request id",
      mutate(binding) { binding.request_id = "999"; },
    }, {
      name: "generation id",
      changedField: "generation_id",
      mutate(binding) { binding.generation_id = "automatic:2"; },
    }, {
      name: "request node id",
      changedField: "request_node_id",
      mutate(binding) { binding.request_node_id = "IC_edited"; },
    }];

    for (const fixture of cases) {
      await context.test(fixture.name, () => {
        const binding = structuredClone(baseBinding);
        fixture.mutate(binding);
        if (fixture.changedField !== undefined) {
          assert.notEqual(
            binding[fixture.changedField],
            baseBinding[fixture.changedField],
          );
          const restored = structuredClone(binding);
          restored[fixture.changedField] = baseBinding[fixture.changedField];
          assert.deepEqual(restored, baseBinding);
        }
        assert.throws(
          () => projectV2TransportSnapshots({
            discovery_snapshot: discovery,
            evidence_snapshot: evidence,
            controller: makeController({
              requestBindings: [{
                id: request.id,
                kind: "automatic",
                base_oid: BASE,
                head_oid: HEAD,
                controlled: true,
              }],
              artifactBindings: [binding],
              budget: {
                automatic_requests_on_head: 1,
                automatic_reservations_on_head: 1,
                manual_requests_in_epoch: 0,
              },
            }),
          }),
          (error) => error instanceof V2ProjectorError &&
            error.code === "ARTIFACT_BINDING_RECEIPT_MISMATCH",
        );
      });
    }
  });

test("terminal-clean durable binding rejects edited, deleted, and wrong-provider carriers",
  async (context) => {
    const request = issueComment("201", {
      body: "@codex review",
      author: HUMAN,
      created_at: "2026-08-13T11:59:00.000Z",
      updated_at: "2026-08-13T11:59:00.000Z",
    });
    const original = issueComment("202", {
      body: CLEAN_BODY,
      author: BOT,
      app: codexApp(),
      created_at: "2026-08-13T12:00:20.000Z",
      updated_at: "2026-08-13T12:00:20.000Z",
    });
    const originalExact = exact("issue_comment", original);
    const binding = richArtifactBinding(
      "issue_comment",
      original,
      originalExact,
      request.id,
    );
    const controller = makeController({
      requestBindings: [{
        id: request.id,
        kind: "automatic",
        base_oid: BASE,
        head_oid: HEAD,
        controlled: true,
      }],
      artifactBindings: [binding],
      budget: {
        automatic_requests_on_head: 1,
        automatic_reservations_on_head: 1,
        manual_requests_in_epoch: 0,
      },
    });
    const cases = [{
      name: "stable carrier was edited after the durable receipt",
      carrier: {
        ...structuredClone(original),
        body: CLEAN_BODY.replace(
          "Didn't find any major issues.",
          "Didn't find any major issues. Chef's kiss.",
        ),
      },
      rawBodySha256: `sha256:${"2".repeat(64)}`,
    }, {
      name: "carrier was deleted",
      carrier: null,
      rawBodySha256: null,
    }, {
      name: "carrier no longer has the exact provider",
      carrier: {
        ...structuredClone(original),
        author: HUMAN,
        app: null,
      },
      rawBodySha256: DIGEST,
    }];

    for (const fixture of cases) {
      await context.test(fixture.name, () => {
        const issueComments = fixture.carrier === null
          ? [request]
          : [request, fixture.carrier];
        const exactArtifacts = [exact("issue_comment", request)];
        if (fixture.carrier !== null) {
          const receipt = exact("issue_comment", fixture.carrier);
          receipt.raw_body_sha256 = fixture.rawBodySha256;
          exactArtifacts.push(receipt);
        }
        const discovery = snapshot({ issueComments });
        const evidence = snapshot({
          issueComments,
          exactArtifacts,
          serverTime: "2026-08-13T12:01:00.000Z",
        });
        assert.throws(
          () => projectV2TransportSnapshots({
            discovery_snapshot: discovery,
            evidence_snapshot: evidence,
            controller,
          }),
          (error) => error instanceof V2ProjectorError &&
            error.code === "ARTIFACT_BINDING_RECEIPT_MISMATCH",
        );
      });
    }
  });

test("machine E2E rejects a same-head +1 bound to an earlier base", async () => {
  const request = issueComment("301", {
    body: "@codex review",
    author: HUMAN,
    created_at: "2026-08-13T12:00:10.000Z",
    updated_at: "2026-08-13T12:00:10.000Z",
  });
  const plusOne = reaction("401", "+1", "2026-08-13T12:00:30.000Z");
  const reactions = reactionInventory([request], new Map([[request.id, [plusOne]]]));
  const discovery = snapshot({ issueComments: [request], reactions });
  const evidence = snapshot({
    issueComments: [request],
    reactions,
    exactArtifacts: [exact("issue_comment", request)],
    serverTime: "2026-08-13T12:01:00.000Z",
  });
  const controller = makeController({
    requestBindings: [{
      id: request.id,
      kind: "automatic",
      base_oid: "9".repeat(40),
      head_oid: HEAD,
      controlled: true,
    }],
    budget: {
      automatic_requests_on_head: 1,
      automatic_reservations_on_head: 1,
      manual_requests_in_epoch: 0,
    },
  });
  const transport = sequentialTransport(discovery, evidence);

  const result = await runV2Operation(
    runnerInput(evidence, controller),
    { transport, reduceSnapshot: reduceV2Snapshot },
  );

  assert.equal(result.reducer_report.request_policy.status, "compliant");
  assert.equal(result.reducer_report.request_policy.selected_request_id, request.id);
  assert.equal(result.reducer_report.provider_profile, "unknown");
  assert.equal(result.reducer_report.evidence_basis, null);
  assert.equal(result.decision, "pending");
  assert.deepEqual(result.scheduler_plan.actions, []);
  assert.deepEqual(result.status_plan.writes, []);
  assert.equal(result.writes_performed, false);
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
  generationAdmissions = [],
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
      current_incarnation: true,
      ...binding,
    })),
    generation_admissions: generationAdmissions,
    artifact_bindings: artifactBindings,
    thread_resolution_observations: [],
    no_start_observations: [],
    final_reread: {
      required: true,
      assurance: "two-complete-point-in-time-snapshots",
    },
  };
}

function controllerGenerationAdmission(priorRequest, nextRequest, overrides = {}) {
  return {
    prior_generation_id: "automatic:1",
    next_generation_id: "automatic:2",
    prior_request_id: priorRequest.id,
    next_request_id: nextRequest.id,
    head_oid: HEAD,
    prior_request_binding_record_oid: "1".repeat(40),
    recovery_transition_record_oid: "2".repeat(40),
    recovery_transition_payload_digest: `sha256:${"2".repeat(64)}`,
    next_request_binding_record_oid: "3".repeat(40),
    next_request_binding_payload_digest: `sha256:${"3".repeat(64)}`,
    transition_server_time: "2026-08-13T12:04:00.000Z",
    ledger_order: {
      prior_request_binding_index: 10,
      recovery_transition_index: 11,
      next_request_binding_index: 12,
    },
    ...overrides,
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
          generation_index: 1,
          recovery_authority: null,
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
      wait_completions: [],
    },
    head_ledger: null,
    reservation: null,
    post_response: null,
  };
}

function automaticRecoveryRunnerInput(evidence, controller, request) {
  const input = runnerInput(evidence, controller);
  input.scheduling.epoch.controlled_request = {
    request_id: request.id,
    bound_at: request.created_at,
    binding_record_oid: "1".repeat(40),
    binding_receipt_digest: DIGEST,
  };
  input.scheduling.epoch.automatic_request = {
    state: "effect-attempted",
    generation_index: 1,
    recovery_authority: null,
    intent_id: "automatic:1:fixture",
    intent_persisted_at: request.created_at,
    effect_attempted_at: request.created_at,
  };
  return input;
}

async function runAutomaticRecoveryFixture(fixture) {
  return runV2Operation(
    automaticRecoveryRunnerInput(
      fixture.evidence,
      fixture.controller,
      fixture.request,
    ),
    {
      transport: sequentialTransport(fixture.discovery, fixture.evidence),
      reduceSnapshot: reduceV2Snapshot,
    },
  );
}

function inlineAutomaticRecoveryFixture({
  resolved = true,
  secondResolved = null,
  requestOverrides = {},
  requestBindingOverrides = {},
  extraRequests = [],
  extraRequestBindings = [],
  actorPermissions = [],
  artifactRequestId = "301",
  extraArtifactBindings = [],
  budget = null,
  scopeOverrides = {},
} = {}) {
  const request = issueComment("301", {
    body: "@codex review",
    author: HUMAN,
    created_at: "2026-08-13T11:59:00.000Z",
    updated_at: "2026-08-13T11:59:00.000Z",
    ...requestOverrides,
  });
  const parent = inlineParentReview("201");
  const inline = inlineFindingComment("310", parent.id);
  inline.created_at = "2026-08-13T12:00:00.000Z";
  inline.updated_at = inline.created_at;
  const threads = [reviewThread("THREAD_310", inline, resolved)];
  const inlineComments = [inline];
  if (secondResolved !== null) {
    const secondInline = inlineFindingComment("311", parent.id);
    secondInline.created_at = "2026-08-13T12:00:00.000Z";
    secondInline.updated_at = secondInline.created_at;
    inlineComments.push(secondInline);
    threads.push(reviewThread("THREAD_311", secondInline, secondResolved));
  }
  const issueComments = [request, ...extraRequests];
  const controller = makeController({
    requestBindings: [{
      id: request.id,
      kind: "automatic",
      base_oid: BASE,
      head_oid: HEAD,
      controlled: true,
      generation_id: "automatic:1",
      generation_kind: "automatic",
      generation_index: 1,
      ...requestBindingOverrides,
    }, ...extraRequestBindings],
    artifactBindings: [
      ...(artifactRequestId === null
        ? []
        : [{ id: parent.id, request_id: artifactRequestId }]),
      ...extraArtifactBindings,
    ],
    budget: budget ?? {
      automatic_requests_on_head: 1 + extraRequestBindings.filter(
        (binding) => binding.kind === "automatic",
      ).length,
      automatic_reservations_on_head: 1 + extraRequestBindings.filter(
        (binding) => binding.kind === "automatic",
      ).length,
      manual_requests_in_epoch: extraRequestBindings.filter(
        (binding) => binding.kind === "manual",
      ).length,
    },
  });
  const snapshotInput = {
    issueComments,
    reviews: [parent],
    inlineComments,
    threads,
    scopeOverrides,
  };
  const discovery = snapshot({
    ...snapshotInput,
    serverTime: "2026-08-13T12:05:00.000Z",
  });
  const evidence = snapshot({
    ...snapshotInput,
    exactArtifacts: [
      ...issueComments
        .filter((item) =>
          item.body !== "@codex review" ||
          controller.request_bindings.find((binding) => binding.id === item.id)
            ?.head_oid === (scopeOverrides.head_ref_oid ?? HEAD))
        .map((item) => exact("issue_comment", item)),
      exact("pull_request_review", parent),
      ...inlineComments.map((item) => exact("inline_comment", item)),
    ],
    actorPermissions,
    serverTime: "2026-08-13T12:20:00.000Z",
  });
  for (const value of [discovery, evidence]) {
    value.service_start_observations.head_sha = value.scope.head_ref_oid;
  }
  return {
    request,
    parent,
    inlineComments,
    threads,
    controller,
    discovery,
    evidence,
  };
}

function topLevelAutomaticRecoveryFixture({
  addressOverrides = {},
  permissionMutator = null,
  scopeOverrides = {},
  extraIssueComments = [],
  extraRequestBindings = [],
  extraActorPermissions = [],
  budget = null,
} = {}) {
  const request = issueComment("301", {
    body: "@codex review",
    author: HUMAN,
    created_at: "2026-08-13T11:59:00.000Z",
    updated_at: "2026-08-13T11:59:00.000Z",
  });
  const finding = issueComment("202", {
    body:
      "### 💡 Codex Review\n\n" +
      `- [P1] Fix the current-head issue https://github.com/owner/repo/blob/${HEAD}/src/a.js#L1`,
    author: BOT,
    app: codexApp(),
    created_at: "2026-08-13T12:00:10.000Z",
    updated_at: "2026-08-13T12:00:10.000Z",
  });
  const address = issueComment("303", {
    body: `/codex-gate addressed ${finding.html_url}`,
    author: HUMAN,
    created_at: "2026-08-13T12:00:30.000Z",
    updated_at: "2026-08-13T12:00:30.000Z",
    ...addressOverrides,
  });
  const permission = actorPermission(address.id, address.author);
  if (permissionMutator !== null) permissionMutator(permission);
  const controller = makeController({
    requestBindings: [{
      id: request.id,
      kind: "automatic",
      base_oid: BASE,
      head_oid: HEAD,
      controlled: true,
    }, ...extraRequestBindings],
    artifactBindings: [{ id: finding.id, request_id: request.id }],
    budget: budget ?? {
      automatic_requests_on_head: 1,
      automatic_reservations_on_head: 1,
      manual_requests_in_epoch: extraRequestBindings.filter(
        (binding) => binding.kind === "manual",
      ).length,
    },
  });
  const snapshotInput = {
    issueComments: [request, finding, address, ...extraIssueComments],
    scopeOverrides,
  };
  const discovery = snapshot({
    ...snapshotInput,
    serverTime: "2026-08-13T12:05:00.000Z",
  });
  const evidence = snapshot({
    ...snapshotInput,
    exactArtifacts: [
      exact("issue_comment", request),
      exact("issue_comment", finding),
      exact("issue_comment", address),
      ...extraIssueComments.map((item) => exact("issue_comment", item)),
    ],
    actorPermissions: [permission, ...extraActorPermissions],
    serverTime: "2026-08-13T12:20:00.000Z",
  });
  return {
    request,
    finding,
    address,
    permission,
    controller,
    discovery,
    evidence,
  };
}

function assertSafeAutomaticRecoveryProof(proof) {
  assert.equal(Object.isFrozen(proof), true);
  assert.equal(Object.isFrozen(proof.scope), true);
  assert.equal(Object.isFrozen(proof.closure_records), true);
  assert.deepEqual(Object.keys(proof).sort(), [
    "authority_digest",
    "closure_ids",
    "closure_observed_at",
    "closure_records",
    "decision",
    "evidence_snapshot_digest",
    "final_reread_sha256",
    "final_snapshot_server_time",
    "finding_ids",
    "finding_observed_at",
    "next_generation_id",
    "next_generation_index",
    "pagination_sha256",
    "prior_generation_id",
    "prior_generation_index",
    "prior_request_binding_receipt_digest",
    "prior_request_binding_record_oid",
    "prior_request_id",
    "reducer_input_digest",
    "reducer_report_digest",
    "review_epoch_id",
    "same_review_epoch",
    "schema",
    "schema_version",
    "scope",
    "scope_digest",
    "snapshot_fingerprint",
  ].sort());
  for (const record of proof.closure_records) {
    assert.equal(Object.isFrozen(record), true);
    assert.deepEqual(Object.keys(record).sort(), [
      "closure_authority_digest",
      "closure_id",
      "closure_server_time",
      "finding_artifact_id",
      "finding_id",
      "finding_kind",
      "finding_server_time",
    ].sort());
  }
  const serialized = JSON.stringify(proof);
  for (const forbidden of [
    "@codex review",
    "raw_body",
    "pages",
    "token",
    "authorization",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
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

function richArtifactBinding(kind, artifact, exactReceipt, requestId) {
  return {
    id: artifact.id,
    request_id: requestId,
    generation_id: "automatic:1",
    request_node_id: `IC_${requestId}`,
    artifact_selector: { kind, id: artifact.id },
    artifact_node_id: artifact.node_id,
    artifact_url: artifact.html_url,
    artifact_type: kind,
    artifact_created_at: kind === "pull_request_review"
      ? artifact.submitted_at
      : artifact.created_at,
    raw_body_sha256: exactReceipt.raw_body_sha256,
    actor: structuredClone(artifact.author),
    app: structuredClone(artifact.app),
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

function readOnlyActorPermission(subjectId, subjectActor) {
  const permission = actorPermission(subjectId, subjectActor);
  for (const receipt of [permission.pre, permission.post]) {
    receipt.effective_permission = "read";
    receipt.role_name = "read";
    receipt.permissions.admin = false;
    receipt.permissions.maintain = false;
    receipt.permissions.push = false;
    receipt.permissions.triage = false;
    receipt.permissions.pull = true;
  }
  return permission;
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
