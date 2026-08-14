import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  V2TransportError,
  assertV2ProviderPreScopeArtifactHandle,
  assertV2ProviderPreScopeArtifactEqualsSnapshot,
  assertV2Snapshot,
  assertV2TransportSnapshotHandle,
  createV2GitHubTransport,
  getExactArtifact,
  loadV2ProviderPreScopeArtifact,
  projectV2TransportSnapshotForGitLedger,
  validateStatusTarget,
} from "../packages/action/src/v2/transport.mjs";

const API = "https://api.github.test";
const GRAPHQL = `${API}/graphql`;
const OWNER = "owner";
const REPO = "repo";
const PR = 7;
const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const MERGE = "c".repeat(40);
const TREE = "d".repeat(40);
const MERGE_BASE = "e".repeat(40);
const OLD_BASE_REF_OID = "f".repeat(40);
const SERVER_DATE = "Thu, 13 Aug 2026 12:00:00 GMT";

test("loads a complete closed snapshot and targets only the validated potential merge", async () => {
  const fake = createFakeGitHub({ checkRuns: [checkRun(501)] });
  const transport = createTransport(fake.fetch);
  const snapshot = await transport.loadSnapshot({
    owner: OWNER,
    repo: REPO,
    pullNumber: PR,
    artifactSelectors: [{ kind: "issue_comment", id: 101 }],
  });

  assert.equal(snapshot.schema_version, 2);
  assert.equal(snapshot.scope.base_ref_tip, BASE);
  assert.notEqual(snapshot.scope.base_ref_tip, OLD_BASE_REF_OID);
  assert.equal(snapshot.scope.head_ref_oid, HEAD);
  assert.equal(snapshot.scope.merge_base_sha, MERGE_BASE);
  assert.equal(snapshot.scope.potential_merge_oid, MERGE);
  assert.equal(snapshot.scope.potential_merge_tree, TREE);
  const expectedSnapshotBinding = {
    repository: { owner: OWNER, name: REPO },
    scope: {
      pull_request: { number: PR, node_id: "PR_node" },
      head_ref_oid: HEAD,
      base_ref_oid: BASE,
      potential_merge_commit_oid: MERGE,
    },
  };
  assert.equal(
    assertV2TransportSnapshotHandle(snapshot, expectedSnapshotBinding),
    snapshot,
  );
  assert.deepEqual(
    projectV2TransportSnapshotForGitLedger(snapshot, expectedSnapshotBinding),
    {
      snapshot,
      effective_limits: {
        max_pages: 1_000,
        page_size: 100,
        max_items: 20_000,
        max_response_bytes: 8 * 1024 * 1024,
        max_total_response_bytes: 64 * 1024 * 1024,
        max_requests: 2_048,
        max_artifact_selectors: 256,
        request_timeout_ms: 30_000,
      },
    },
  );
  for (const candidate of [structuredClone(snapshot), { ...snapshot }]) {
    assert.throws(
      () => assertV2TransportSnapshotHandle(candidate, expectedSnapshotBinding),
      (error) => error?.code === "UNTRUSTED_TRANSPORT_SNAPSHOT_HANDLE",
    );
  }
  assert.deepEqual(snapshot.scope.ordered_parent_oids, [BASE, HEAD]);
  assert.equal(snapshot.scope.merge_ref_oid, MERGE);
  assert.deepEqual(
    Object.keys(snapshot.scope_receipts.pre.endpoint_receipts),
    ["pull_request", "graphql", "compare", "merge_ref"],
  );
  assert.deepEqual(snapshot.scope_receipts.pre.endpoint_receipts.pull_request, {
    method: "GET",
    path: `/repos/${OWNER}/${REPO}/pulls/${PR}`,
    status: 200,
    server_time: "2026-08-13T12:00:00.000Z",
    raw_body_sha256: snapshot.scope_receipts.pre.endpoint_receipts
      .pull_request.raw_body_sha256,
  });
  assert.match(
    snapshot.scope_receipts.pre.endpoint_receipts.pull_request.raw_body_sha256,
    /^sha256:[0-9a-f]{64}$/u,
  );
  assert.deepEqual(
    {
      method: snapshot.scope_receipts.pre.endpoint_receipts.graphql.method,
      path: snapshot.scope_receipts.pre.endpoint_receipts.graphql.path,
      status: snapshot.scope_receipts.pre.endpoint_receipts.graphql.status,
    },
    { method: "POST", path: "/graphql", status: 200 },
  );
  assert.deepEqual(
    {
      method: snapshot.scope_receipts.pre.endpoint_receipts.compare.method,
      path: snapshot.scope_receipts.pre.endpoint_receipts.compare.path,
      status: snapshot.scope_receipts.pre.endpoint_receipts.compare.status,
    },
    {
      method: "GET",
      path: `/repos/${OWNER}/${REPO}/compare/${BASE}...${HEAD}`,
      status: 200,
    },
  );
  assert.deepEqual(
    {
      method: snapshot.scope_receipts.pre.endpoint_receipts.merge_ref.method,
      path: snapshot.scope_receipts.pre.endpoint_receipts.merge_ref.path,
      status: snapshot.scope_receipts.pre.endpoint_receipts.merge_ref.status,
    },
    {
      method: "GET",
      path: `/repos/${OWNER}/${REPO}/git/ref/pull/${PR}/merge`,
      status: 200,
    },
  );
  assert.equal(snapshot.pages.issue_comments.length, 1);
  assert.equal(snapshot.pages.reviews.length, 1);
  assert.equal(snapshot.pages.inline_comments.length, 1);
  assert.equal(snapshot.pages.threads.length, 1);
  assert.equal(snapshot.pages.reactions.issue.length, 1);
  assert.equal(snapshot.pages.reactions.issue_comments[0].reactions.length, 1);
  assert.equal(snapshot.pages.reactions.reviews[0].reactions.length, 1);
  assert.equal(snapshot.pages.reactions.reviews[0].reactions[0].content, "+1");
  assert.equal(snapshot.pages.reactions.inline_comments[0].reactions.length, 1);
  assert.equal(snapshot.service_start_observations.provider_app_slug, "chatgpt-codex-connector");
  assert.equal(snapshot.service_start_observations.head_sha, HEAD);
  assert.equal(snapshot.service_start_observations.stable, true);
  assert.equal(snapshot.service_start_observations.pre.check_runs.length, 1);
  assert.deepEqual(
    snapshot.service_start_observations.pre.check_runs[0],
    normalizedCheckRun(501),
  );
  assert.match(
    snapshot.service_start_observations.pre.page_receipts[0].raw_body_sha256,
    /^sha256:[0-9a-f]{64}$/,
  );
  assert.deepEqual(
    snapshot.pages.exact_artifacts[0].selector,
    { kind: "issue_comment", id: "101" },
  );
  const exact = getExactArtifact(snapshot, { kind: "issue_comment", id: 101 });
  assert.equal(exact.artifact.body, "issue comment 101");
  assert.equal(exact.artifact.author.login, "chatgpt-codex-connector[bot]");
  assert.equal(exact.artifact.app.id, "42");
  assert.equal(exact.response_server_time, "2026-08-13T12:00:00.000Z");
  assert.equal(
    exact.raw_body_sha256,
    `sha256:${createHash("sha256").update(JSON.stringify(issueComment(101))).digest("hex")}`,
  );
  assert.equal(snapshot.completeness.request_count, fake.calls.length);
  assert.equal(
    snapshot.completeness.server_date_headers,
    snapshot.completeness.request_count,
  );
  assert.ok(Object.isFrozen(snapshot));

  assert.deepEqual(validateStatusTarget(snapshot), {
    mode: "test-merge-with-head-sentinel",
    head_sentinel_sha: HEAD,
    terminal_sha: MERGE,
    validated: true,
  });
  assert.ok(
    fake.calls.some((call) =>
      call.path === `/repos/${OWNER}/${REPO}/compare/${BASE}...${HEAD}`),
  );
  assert.equal(
    fake.calls.filter((call) => call.path === `/repos/${OWNER}/${REPO}/git/ref/pull/${PR}/merge`).length,
    2,
  );
  assert.equal(
    fake.calls.filter((call) => call.path === `/repos/${OWNER}/${REPO}/pulls/${PR}`).length,
    2,
  );
  assert.equal(
    fake.calls.filter((call) => call.path === `/repos/${OWNER}/${REPO}/issues/comments/101`).length,
    1,
  );
  const checkRunCalls = fake.calls.filter(
    (call) => call.path === `/repos/${OWNER}/${REPO}/commits/${HEAD}/check-runs`,
  );
  assert.equal(checkRunCalls.length, 2);
  assert.ok(checkRunCalls.every((call) => call.query.filter === "all"));
});

test("transport authority projection rejects clones and relaxed private limits", async () => {
  const expected = {
    repository: { owner: OWNER, name: REPO },
    scope: {
      pull_request: { number: PR, node_id: "PR_node" },
      head_ref_oid: HEAD,
      base_ref_oid: BASE,
      potential_merge_commit_oid: MERGE,
    },
  };
  const ordinary = await createTransport(createFakeGitHub().fetch).loadSnapshot({
    owner: OWNER,
    repo: REPO,
    pullNumber: PR,
  });
  assert.throws(
    () => projectV2TransportSnapshotForGitLedger(
      structuredClone(ordinary),
      expected,
    ),
    (error) => error?.code === "UNTRUSTED_TRANSPORT_SNAPSHOT_HANDLE",
  );

  const relaxed = await createTransport(createFakeGitHub().fetch, {
    max_items: 20_001,
  }).loadSnapshot({
    owner: OWNER,
    repo: REPO,
    pullNumber: PR,
  });
  assert.throws(
    () => projectV2TransportSnapshotForGitLedger(relaxed, expected),
    (error) => error?.code === "TRANSPORT_LIMITS_RELAXED",
  );

  const tightened = await createTransport(createFakeGitHub().fetch, {
    max_items: 19_999,
  }).loadSnapshot({
    owner: OWNER,
    repo: REPO,
    pullNumber: PR,
  });
  assert.equal(
    projectV2TransportSnapshotForGitLedger(tightened, expected)
      .effective_limits.max_items,
    19_999,
  );
});

test("full scope endpoint receipts reject missing, extra, forged, and reordered fields", async () => {
  const snapshot = await createTransport(createFakeGitHub().fetch).loadSnapshot({
    owner: OWNER,
    repo: REPO,
    pullNumber: PR,
  });
  const scenarios = [
    {
      name: "missing endpoint",
      mutate(candidate) {
        delete candidate.scope_receipts.pre.endpoint_receipts.pull_request;
      },
    },
    {
      name: "extra endpoint",
      mutate(candidate) {
        candidate.scope_receipts.pre.endpoint_receipts.untrusted = null;
      },
    },
    {
      name: "wrong canonical path",
      mutate(candidate) {
        candidate.scope_receipts.pre.endpoint_receipts.pull_request.path =
          `/repos/${OWNER}/${REPO}/pulls/${PR + 1}`;
      },
    },
    {
      name: "wrong status",
      mutate(candidate) {
        candidate.scope_receipts.pre.endpoint_receipts.graphql.status = 404;
      },
    },
    {
      name: "wrong raw body digest",
      mutate(candidate) {
        candidate.scope_receipts.pre.endpoint_receipts.compare.raw_body_sha256 =
          `sha256:${"z".repeat(64)}`;
      },
    },
    {
      name: "regressed endpoint time",
      mutate(candidate) {
        candidate.scope_receipts.pre.endpoint_receipts.graphql.server_time =
          "2026-08-13T11:59:59.000Z";
      },
    },
    {
      name: "scope time not latest endpoint time",
      mutate(candidate) {
        candidate.scope_receipts.pre.server_time =
          "2026-08-13T12:00:01.000Z";
      },
    },
    {
      name: "missing conditional compare",
      mutate(candidate) {
        candidate.scope_receipts.pre.endpoint_receipts.compare = null;
      },
    },
    {
      name: "merge ref status contradicts value",
      mutate(candidate) {
        candidate.scope_receipts.pre.endpoint_receipts.merge_ref.status = 404;
      },
    },
  ];
  for (const scenario of scenarios) {
    const candidate = structuredClone(snapshot);
    scenario.mutate(candidate);
    assert.throws(
      () => assertV2Snapshot(candidate),
      { name: "TypeError" },
      scenario.name,
    );
  }
  assert.throws(
    () => assertV2TransportSnapshotHandle(
      structuredClone(snapshot),
      {
        repository: { owner: OWNER, name: REPO },
        scope: {
          pull_request: { number: PR, node_id: "PR_node" },
          head_ref_oid: HEAD,
          base_ref_oid: BASE,
          potential_merge_commit_oid: MERGE,
        },
      },
    ),
    (error) => error?.code === "UNTRUSTED_TRANSPORT_SNAPSHOT_HANDLE",
  );
});

test("provider pre-scope uses one native GET for each carrier and equals its full snapshot", async () => {
  const cases = [
    {
      selector: { kind: "issue_comment", id: 101 },
      path: `/repos/${OWNER}/${REPO}/issues/comments/101`,
    },
    {
      selector: { kind: "pull_request_review", id: 201 },
      path: `/repos/${OWNER}/${REPO}/pulls/${PR}/reviews/201`,
    },
    {
      selector: { kind: "inline_comment", id: 301 },
      path: `/repos/${OWNER}/${REPO}/pulls/comments/301`,
    },
  ];
  for (const { selector, path } of cases) {
    const fake = createFakeGitHub();
    const preScope = await loadProviderPreScope(fake.fetch, selector);

    assert.deepEqual(Object.keys(preScope), [
      "selector",
      "artifact",
      "response_server_time",
      "raw_body_sha256",
    ]);
    assert.deepEqual(preScope.selector, {
      ...selector,
      id: String(selector.id),
    });
    assert.deepEqual(preScope.artifact.author, expectedProviderActor());
    assert.deepEqual(preScope.artifact.app, expectedProviderApp());
    assert.equal(preScope.response_server_time, "2026-08-13T12:00:00.000Z");
    assert.match(preScope.raw_body_sha256, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(Object.isFrozen(preScope), true);
    assert.equal(Object.isSealed(preScope), true);
    assert.equal(Object.isFrozen(preScope.artifact), true);
    assert.equal(
      assertV2ProviderPreScopeArtifactHandle(
        preScope,
        expectedProviderPreScopeBinding(),
      ),
      preScope,
    );
    assert.equal(
      assertV2ProviderPreScopeArtifactHandle(preScope, {
        repository: { owner: OWNER, name: REPO },
        scope: {
          pull_request: { number: PR },
          head_ref_oid: HEAD,
        },
      }),
      preScope,
    );
    assert.deepEqual(fake.calls.map((call) => `${call.method} ${call.path}`), [
      `GET ${path}`,
    ]);

    const snapshot = await createTransport(fake.fetch).loadSnapshot({
      owner: OWNER,
      repo: REPO,
      pullNumber: PR,
      artifactSelectors: [selector],
    });
    assert.equal(
      assertV2ProviderPreScopeArtifactEqualsSnapshot(preScope, snapshot),
      true,
    );
    assert.throws(
      () => assertV2ProviderPreScopeArtifactEqualsSnapshot(
        preScope,
        structuredClone(snapshot),
      ),
      (error) => error?.code === "UNTRUSTED_TRANSPORT_SNAPSHOT_HANDLE",
    );
  }
});

test("provider pre-scope handle rejects clones, reconstructions, and non-exact bindings", async () => {
  const fake = createFakeGitHub();
  const handle = await loadProviderPreScope(
    fake.fetch,
    { kind: "issue_comment", id: 101 },
  );
  const expected = expectedProviderPreScopeBinding();
  for (const [label, value] of [
    ["structured clone", structuredClone(handle)],
    ["plain reconstruction", { ...handle }],
  ]) {
    assert.throws(
      () => assertV2ProviderPreScopeArtifactHandle(value, expected),
      (error) => {
        assert.equal(error instanceof V2TransportError, true, label);
        assert.equal(
          error.code,
          "UNTRUSTED_PROVIDER_PRE_SCOPE_ARTIFACT_HANDLE",
          label,
        );
        return true;
      },
    );
  }

  for (const [label, binding, code] of [
    [
      "repository",
      {
        ...expected,
        repository: { owner: OWNER, name: "other" },
      },
      "PROVIDER_PRE_SCOPE_HANDLE_BINDING_MISMATCH",
    ],
    [
      "pull request",
      {
        ...expected,
        scope: {
          ...expected.scope,
          pull_request: { number: PR + 1 },
        },
      },
      "PROVIDER_PRE_SCOPE_HANDLE_BINDING_MISMATCH",
    ],
    [
      "head",
      {
        ...expected,
        scope: { ...expected.scope, head_ref_oid: "9".repeat(40) },
      },
      "PROVIDER_PRE_SCOPE_HANDLE_BINDING_MISMATCH",
    ],
    [
      "provider actor",
      {
        ...expected,
        expected_provider: {
          ...expected.expected_provider,
          actor: { ...expected.expected_provider.actor, id: "9002" },
        },
      },
      "PROVIDER_PRE_SCOPE_HANDLE_PROVIDER_MISMATCH",
    ],
    [
      "provider app",
      {
        ...expected,
        expected_provider: {
          ...expected.expected_provider,
          app: { ...expected.expected_provider.app, id: "77" },
        },
      },
      "PROVIDER_PRE_SCOPE_HANDLE_PROVIDER_MISMATCH",
    ],
  ]) {
    assert.throws(
      () => assertV2ProviderPreScopeArtifactHandle(handle, binding),
      (error) => {
        assert.equal(error instanceof V2TransportError, true, label);
        assert.equal(error.code, code, label);
        return true;
      },
    );
  }

  for (const [label, binding, code] of [
    [
      "numeric actor id",
      {
        ...expected,
        expected_provider: {
          ...expected.expected_provider,
          actor: { ...expected.expected_provider.actor, id: 9001 },
        },
      },
      "PROVIDER_PRE_SCOPE_HANDLE_PROVIDER_MISMATCH",
    ],
    [
      "uppercase head",
      {
        ...expected,
        scope: { ...expected.scope, head_ref_oid: HEAD.toUpperCase() },
      },
      "PROVIDER_PRE_SCOPE_HANDLE_BINDING_MISMATCH",
    ],
  ]) {
    assert.throws(
      () => assertV2ProviderPreScopeArtifactHandle(handle, binding),
      (error) => {
        assert.equal(error instanceof V2TransportError, true, label);
        assert.equal(error.code, code, label);
        return true;
      },
    );
  }
  assert.throws(
    () => assertV2ProviderPreScopeArtifactHandle(handle, {
      ...expected,
      repository: { ...expected.repository, node_id: "R_repo" },
    }),
    { name: "TypeError" },
  );
});

test("provider pre-scope requires complete closed selector and provider identities", async () => {
  const fake = createFakeGitHub();
  const valid = providerPreScopeOptions(fake.fetch, {
    kind: "issue_comment",
    id: 101,
  });
  for (const [label, options] of [
    ["pull request", { ...valid, pullNumber: undefined }],
    ["head", { ...valid, headSha: undefined }],
    ["actor", { ...valid, expectedActor: undefined }],
    ["app", { ...valid, expectedApp: undefined }],
    ["closed actor", {
      ...valid,
      expectedActor: { ...valid.expectedActor, unexpected: true },
    }],
    ["closed app", {
      ...valid,
      expectedApp: { ...valid.expectedApp, unexpected: true },
    }],
  ]) {
    await assert.rejects(
      loadV2ProviderPreScopeArtifact(options),
      { name: "TypeError" },
      label,
    );
  }
  assert.equal(fake.calls.length, 0);
});

test("provider pre-scope rejects wrong PR, head, actor, app, and missing provider identities", async () => {
  const failures = [
    {
      name: "wrong PR",
      fake: createFakeGitHub(),
      selector: { kind: "issue_comment", id: 101 },
      options: { pullNumber: PR + 1 },
      code: "NONCANONICAL_ARTIFACT_URL",
    },
    {
      name: "wrong head",
      fake: createFakeGitHub(),
      selector: { kind: "pull_request_review", id: 201 },
      options: { headSha: "9".repeat(40) },
      code: "PROVIDER_ARTIFACT_HEAD_MISMATCH",
    },
    {
      name: "wrong actor",
      fake: createFakeGitHub({
        issueComments: [issueComment(101, { user: { ...actor(), id: 9002 } })],
      }),
      selector: { kind: "issue_comment", id: 101 },
      code: "PROVIDER_ARTIFACT_ACTOR_MISMATCH",
    },
    {
      name: "missing actor",
      fake: createFakeGitHub({
        issueComments: [issueComment(101, { user: null })],
      }),
      selector: { kind: "issue_comment", id: 101 },
      code: "PROVIDER_ARTIFACT_ACTOR_MISSING",
    },
    {
      name: "wrong app",
      fake: createFakeGitHub({
        issueComments: [issueComment(101, {
          performed_via_github_app: providerApp(77),
        })],
      }),
      selector: { kind: "issue_comment", id: 101 },
      code: "PROVIDER_ARTIFACT_APP_MISMATCH",
    },
    {
      name: "missing app",
      fake: createFakeGitHub({
        issueComments: [issueComment(101, { performed_via_github_app: null })],
      }),
      selector: { kind: "issue_comment", id: 101 },
      code: "PROVIDER_ARTIFACT_APP_MISSING",
    },
  ];
  for (const failure of failures) {
    await assert.rejects(
      loadProviderPreScope(
        failure.fake.fetch,
        failure.selector,
        failure.options,
      ),
      (error) => {
        assert.equal(error instanceof V2TransportError, true, failure.name);
        assert.equal(error.code, failure.code, failure.name);
        return true;
      },
    );
    assert.equal(failure.fake.calls.length, 1, failure.name);
  }
});

test("provider pre-scope rejects a deleted carrier and changed full-snapshot bytes", async () => {
  const deleted = createFakeGitHub({ issueComments: [] });
  await assert.rejects(
    loadProviderPreScope(
      deleted.fetch,
      { kind: "issue_comment", id: 101 },
    ),
    (error) => {
      assert.equal(error instanceof V2TransportError, true);
      assert.equal(error.code, "HTTP_ERROR");
      assert.equal(error.details.status, 404);
      return true;
    },
  );
  assert.equal(deleted.calls.length, 1);

  const wrongIssueHead = createFakeGitHub();
  const wrongIssueHeadPreScope = await loadProviderPreScope(
    wrongIssueHead.fetch,
    { kind: "issue_comment", id: 101 },
    { headSha: "9".repeat(40) },
  );
  const correctHeadSnapshot = await createTransport(wrongIssueHead.fetch).loadSnapshot({
    owner: OWNER,
    repo: REPO,
    pullNumber: PR,
    artifactSelectors: [{ kind: "issue_comment", id: 101 }],
  });
  assert.throws(
    () => assertV2ProviderPreScopeArtifactEqualsSnapshot(
      wrongIssueHeadPreScope,
      correctHeadSnapshot,
    ),
    (error) => {
      assert.equal(error instanceof V2TransportError, true);
      assert.equal(error.code, "TRANSPORT_SNAPSHOT_HANDLE_BINDING_MISMATCH");
      return true;
    },
  );

  const issueComments = [issueComment(101)];
  const changed = createFakeGitHub({ issueComments });
  const preScope = await loadProviderPreScope(
    changed.fetch,
    { kind: "issue_comment", id: 101 },
  );
  issueComments[0].body = "changed after provider pre-scope";
  const snapshot = await createTransport(changed.fetch).loadSnapshot({
    owner: OWNER,
    repo: REPO,
    pullNumber: PR,
    artifactSelectors: [{ kind: "issue_comment", id: 101 }],
  });
  assert.throws(
    () => assertV2ProviderPreScopeArtifactEqualsSnapshot(preScope, snapshot),
    (error) => {
      assert.equal(error instanceof V2TransportError, true);
      assert.equal(error.code, "PROVIDER_ARTIFACT_CHANGED");
      return true;
    },
  );
});

test("REST pagination continues past a full final page and loads every comment reaction page", async () => {
  const issueComments = [issueComment(101), issueComment(102)];
  const fake = createFakeGitHub({
    issueComments,
    reviews: [],
    inlineComments: [],
    threads: [],
    issueReactions: [],
    issueCommentReactions: new Map([
      ["101", []],
      ["102", []],
    ]),
  });
  const transport = createTransport(fake.fetch, {
    page_size: 1,
    max_pages: 20,
  });
  const snapshot = await transport.loadSnapshot({
    owner: OWNER,
    repo: REPO,
    pullNumber: PR,
  });

  assert.deepEqual(snapshot.pages.issue_comments.map((comment) => comment.id), ["101", "102"]);
  const commentPageCalls = fake.calls.filter(
    (call) => call.path === `/repos/${OWNER}/${REPO}/issues/${PR}/comments`,
  );
  assert.deepEqual(commentPageCalls.map((call) => call.query.page), ["1", "2", "3"]);
  assert.equal(snapshot.pages.reactions.issue_comments.length, 2);
  assertV2Snapshot(snapshot);
});

test("check-run discovery uses filter=all and fully paginates the exact current head", async () => {
  const fake = createFakeGitHub({
    checkRuns: [
      checkRun(501),
      checkRun(601, { app: checkRunApp(77, "unrelated-app") }),
      checkRun(502, { started_at: null }),
    ],
    reviews: [],
    inlineComments: [],
    threads: [],
    reviewReactions: new Map(),
    inlineCommentReactions: new Map(),
  });
  const snapshot = await createTransport(fake.fetch, {
    page_size: 1,
    max_pages: 20,
  }).loadSnapshot({ owner: OWNER, repo: REPO, pullNumber: PR });

  const observations = snapshot.service_start_observations;
  assert.equal(observations.stable, true);
  assert.equal(observations.pre.page_count, 3);
  assert.equal(observations.pre.total_check_runs, 3);
  assert.deepEqual(observations.pre.matching_app_ids, ["42"]);
  assert.deepEqual(observations.pre.check_runs.map((run) => run.id), ["501", "502"]);
  assert.equal(observations.pre.check_runs[1].started_at, null);
  assert.deepEqual(observations.pre.page_receipts.map((page) => page.item_count), [1, 1, 1]);
  const calls = fake.calls.filter(
    (call) => call.path === `/repos/${OWNER}/${REPO}/commits/${HEAD}/check-runs`,
  );
  assert.deepEqual(calls.map((call) => call.query.page), ["1", "2", "3", "1", "2", "3"]);
  assert.ok(calls.every((call) => call.query.filter === "all"));
});

test("check-run discovery drift is preserved as unstable evidence", async () => {
  const fake = createFakeGitHub({
    checkRuns: [checkRun(501, {
      status: "queued",
      conclusion: null,
      completed_at: null,
    })],
    checkRunMutator(discovery, runs) {
      if (discovery === 2) {
        runs[0].status = "in_progress";
      }
    },
  });
  const snapshot = await createTransport(fake.fetch).loadSnapshot({
    owner: OWNER,
    repo: REPO,
    pullNumber: PR,
  });

  assert.equal(snapshot.service_start_observations.pre.check_runs[0].status, "queued");
  assert.equal(snapshot.service_start_observations.post.check_runs[0].status, "in_progress");
  assert.equal(snapshot.service_start_observations.stable, false);
  assert.equal(snapshot.stability.service_start_observations_stable, false);
  assertV2Snapshot(snapshot);
});

test("scope drift between the pre and post receipts fails closed", async () => {
  const changedBase = "1".repeat(40);
  const fake = createFakeGitHub({
    scopeMutator(call, scope) {
      if (call === 2) {
        scope.repository.pullRequest.baseRef.target.oid = changedBase;
        scope.repository.pullRequest.potentialMergeCommit.parents.nodes[0].oid = changedBase;
      }
    },
  });
  const transport = createTransport(fake.fetch);

  await assert.rejects(
    transport.loadSnapshot({ owner: OWNER, repo: REPO, pullNumber: PR }),
    (error) => {
      assert.ok(error instanceof V2TransportError);
      assert.equal(error.code, "SCOPE_UNSTABLE");
      return true;
    },
  );
});

test("status target validation rejects a potential merge with the wrong ordered parents", async () => {
  const snapshot = structuredClone(await createTransport(createFakeGitHub().fetch).loadSnapshot({
    owner: OWNER,
    repo: REPO,
    pullNumber: PR,
  }));
  for (const target of [snapshot.scope, snapshot.scope_receipts.pre, snapshot.scope_receipts.post]) {
    target.ordered_parent_oids = [HEAD, BASE];
  }

  assert.deepEqual(validateStatusTarget(snapshot), {
    validated: false,
    blocked_reason: "potential-merge-parent-order-mismatch",
  });
});

test("status target validation rejects a merge ref that differs from the potential merge", async () => {
  const otherMerge = "2".repeat(40);
  const snapshot = structuredClone(await createTransport(createFakeGitHub().fetch).loadSnapshot({
    owner: OWNER,
    repo: REPO,
    pullNumber: PR,
  }));
  for (const target of [snapshot.scope, snapshot.scope_receipts.pre, snapshot.scope_receipts.post]) {
    target.merge_ref_oid = otherMerge;
  }

  assert.deepEqual(validateStatusTarget(snapshot), {
    validated: false,
    blocked_reason: "merge-ref-potential-merge-mismatch",
  });
});

test("status target validation rejects a potential merge equal to either parent", async () => {
  for (const parent of [BASE, HEAD]) {
    const snapshot = structuredClone(
      await createTransport(createFakeGitHub().fetch).loadSnapshot({
        owner: OWNER,
        repo: REPO,
        pullNumber: PR,
      }),
    );
    for (const target of [
      snapshot.scope,
      snapshot.scope_receipts.pre,
      snapshot.scope_receipts.post,
    ]) {
      target.potential_merge_oid = parent;
      target.merge_ref_oid = parent;
    }

    assert.deepEqual(validateStatusTarget(snapshot), {
      validated: false,
      blocked_reason: "potential-merge-equals-parent",
    });
  }
});

test("every response must carry a canonical GitHub server Date", async () => {
  const fake = createFakeGitHub({ omitDateOnRequest: 1 });
  const transport = createTransport(fake.fetch);

  await assert.rejects(
    transport.loadSnapshot({ owner: OWNER, repo: REPO, pullNumber: PR }),
    (error) => {
      assert.ok(error instanceof V2TransportError);
      assert.equal(error.code, "MISSING_SERVER_DATE");
      return true;
    },
  );
});

test("native artifact selectors reject arbitrary URLs before any fetch", async () => {
  const fake = createFakeGitHub();
  const transport = createTransport(fake.fetch);

  await assert.rejects(
    transport.loadSnapshot({
      owner: OWNER,
      repo: REPO,
      pullNumber: PR,
      artifactSelectors: [{
        kind: "issue_comment",
        id: 101,
        url: "https://attacker.example/artifact",
      }],
    }),
    /unsupported key url/,
  );
  assert.equal(fake.calls.length, 0);
});

test("manual actor permission receipts bind exact actor identity, endpoint, Date, and raw body", async () => {
  const fake = createFakeGitHub();
  const transport = createTransport(fake.fetch);
  const selector = { kind: "issue_comment", id: 101 };
  const snapshot = await transport.loadSnapshot({
    owner: OWNER,
    repo: REPO,
    pullNumber: PR,
    artifactSelectors: [selector],
    permissionSubjects: [selector],
  });

  const receipt = snapshot.permissions.actor_permissions[0];
  assert.equal(receipt.actor.id, "9001");
  assert.equal(receipt.actor.node_id, "BOT_codex");
  assert.equal(receipt.pre.permissions.push, true);
  assert.equal(receipt.pre.mapping_source, "user.permissions");
  assert.equal(receipt.assurance, "point-in-time-only");
  assert.equal(receipt.request_time_permission, "unproven");
  assert.equal(receipt.permission_aba_excluded, false);
  assert.equal(receipt.stable, true);
  assert.equal(receipt.pre.http_status, 200);
  assert.equal(
    receipt.pre.endpoint,
    `${API}/repos/${OWNER}/${REPO}/collaborators/` +
      "chatgpt-codex-connector%5Bbot%5D/permission",
  );
  assert.match(receipt.pre.raw_body_sha256, /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    fake.calls.filter((call) => call.path.endsWith("/permission")).length,
    2,
  );
});

test("actor permission drift across the point reads fails closed", async () => {
  const write = actorPermissionResponse();
  const read = actorPermissionResponse();
  read.permission = "read";
  read.role_name = "read";
  read.user.permissions = {
    admin: false,
    maintain: false,
    push: false,
    triage: true,
    pull: true,
  };
  const fake = createFakeGitHub({ actorPermissionResponses: [write, read] });
  const transport = createTransport(fake.fetch);
  const selector = { kind: "issue_comment", id: 101 };

  await assert.rejects(
    transport.loadSnapshot({
      owner: OWNER,
      repo: REPO,
      pullNumber: PR,
      artifactSelectors: [selector],
      permissionSubjects: [selector],
    }),
    (error) => {
      assert.ok(error instanceof V2TransportError);
      assert.equal(error.code, "ACTOR_PERMISSION_DRIFT");
      return true;
    },
  );
});

test("permission subjects must be exact-refetched native artifacts", async () => {
  const fake = createFakeGitHub();
  const transport = createTransport(fake.fetch);

  await assert.rejects(
    transport.loadSnapshot({
      owner: OWNER,
      repo: REPO,
      pullNumber: PR,
      permissionSubjects: [{ kind: "issue_comment", id: 101 }],
    }),
    /must also be an artifact selector/,
  );
  assert.equal(fake.calls.length, 0);
});

test("normalized snapshot validation is closed to unknown fields", async () => {
  const snapshot = structuredClone(await createTransport(createFakeGitHub().fetch).loadSnapshot({
    owner: OWNER,
    repo: REPO,
    pullNumber: PR,
  }));
  snapshot.scope.base_ref_oid = OLD_BASE_REF_OID;

  assert.throws(() => assertV2Snapshot(snapshot), /unsupported key base_ref_oid/);
});

test("aggregate item limits fail closed", async () => {
  const fake = createFakeGitHub({
    issueComments: [issueComment(101), issueComment(102)],
    reviews: [],
    inlineComments: [],
    threads: [],
    issueReactions: [],
  });
  const transport = createTransport(fake.fetch, {
    max_items: 1,
    max_artifact_selectors: 1,
  });

  await assert.rejects(
    transport.loadSnapshot({ owner: OWNER, repo: REPO, pullNumber: PR }),
    (error) => {
      assert.ok(error instanceof V2TransportError);
      assert.equal(error.code, "ITEM_LIMIT_EXCEEDED");
      return true;
    },
  );
});

test("streamed response bodies are stopped at the per-response byte ceiling", async () => {
  const comment = issueComment(101);
  comment.body = "x".repeat(10_000);
  const fake = createFakeGitHub({ issueComments: [comment] });
  const transport = createTransport(fake.fetch, {
    max_response_bytes: 2_048,
  });

  await assert.rejects(
    transport.loadSnapshot({ owner: OWNER, repo: REPO, pullNumber: PR }),
    (error) => {
      assert.ok(error instanceof V2TransportError);
      assert.equal(error.code, "RESPONSE_BYTE_LIMIT_EXCEEDED");
      return true;
    },
  );
});

test("server Date regression between any two requests fails closed", async () => {
  const fake = createFakeGitHub({
    serverDates: [
      "Thu, 13 Aug 2026 12:00:01 GMT",
      "Thu, 13 Aug 2026 12:00:00 GMT",
    ],
  });
  const transport = createTransport(fake.fetch);

  await assert.rejects(
    transport.loadSnapshot({ owner: OWNER, repo: REPO, pullNumber: PR }),
    (error) => {
      assert.ok(error instanceof V2TransportError);
      assert.equal(error.code, "SERVER_TIME_REGRESSED");
      return true;
    },
  );
});

function createTransport(fetch, limits = undefined) {
  return createV2GitHubTransport({
    fetch,
    token: "synthetic-test-token",
    restBaseUrl: API,
    graphqlUrl: GRAPHQL,
    ...(limits ? { limits } : {}),
  });
}

function providerPreScopeOptions(fetch, selector, overrides = {}) {
  return {
    fetch,
    token: "synthetic-test-token",
    restBaseUrl: API,
    owner: OWNER,
    repo: REPO,
    pullNumber: PR,
    headSha: HEAD,
    selector,
    expectedActor: expectedProviderActor(),
    expectedApp: expectedProviderApp(),
    ...overrides,
  };
}

function loadProviderPreScope(fetch, selector, overrides = {}) {
  return loadV2ProviderPreScopeArtifact(
    providerPreScopeOptions(fetch, selector, overrides),
  );
}

function createFakeGitHub(overrides = {}) {
  const state = {
    issueComments: overrides.issueComments ?? [issueComment(101)],
    reviews: overrides.reviews ?? [review(201)],
    inlineComments: overrides.inlineComments ?? [inlineComment(301)],
    threads: overrides.threads ?? [reviewThread(301)],
    issueReactions: overrides.issueReactions ?? [reaction(401, "+1")],
    issueCommentReactions: overrides.issueCommentReactions ?? new Map([
      ["101", [reaction(402, "eyes")]],
    ]),
    inlineCommentReactions: overrides.inlineCommentReactions ?? new Map([
      ["301", [reaction(403, "+1")]],
    ]),
    reviewReactions: overrides.reviewReactions ?? new Map([
      ["201", [graphqlReaction(404, "THUMBS_UP")]],
    ]),
    checkRuns: overrides.checkRuns ?? [],
    checkRunMutator: overrides.checkRunMutator ?? null,
    omitDateOnRequest: overrides.omitDateOnRequest ?? null,
    serverDates: overrides.serverDates ?? [],
    actorPermissionResponses: overrides.actorPermissionResponses ?? [
      actorPermissionResponse(),
      actorPermissionResponse(),
    ],
    scopeMutator: overrides.scopeMutator ?? null,
  };
  const calls = [];
  let scopeCalls = 0;
  let checkRunDiscoveries = 0;

  async function fetch(input, options = {}) {
    const url = new URL(String(input));
    const body = options.body ? JSON.parse(options.body) : null;
    const call = {
      method: String(options.method || "GET").toUpperCase(),
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      body,
    };
    calls.push(call);
    const responseNumber = calls.length;
    const responseDate = state.serverDates[responseNumber - 1] ?? SERVER_DATE;
    const headers = responseNumber === state.omitDateOnRequest ? {} : { Date: responseDate };

    if (url.pathname === "/graphql") {
      const query = String(body?.query || "");
      if (query.includes("CodexReviewGateV2Scope")) {
        scopeCalls += 1;
        const scope = scopePayload();
        state.scopeMutator?.(scopeCalls, scope);
        return jsonResponse({ data: scope }, 200, headers);
      }
      if (query.includes("CodexReviewGateV2ReviewThreadComments")) {
        const thread = state.threads.find((candidate) => candidate.id === body.variables.threadId);
        return jsonResponse({ data: { node: thread ?? null } }, 200, headers);
      }
      if (query.includes("CodexReviewGateV2ReviewReactions")) {
        const review = state.reviews.find(
          (candidate) => candidate.node_id === body.variables.reviewId,
        );
        const reactions = review
          ? state.reviewReactions.get(String(review.id)) ?? []
          : [];
        return jsonResponse({
          data: {
            node: review
              ? {
                  id: review.node_id,
                  fullDatabaseId: String(review.id),
                  reactions: graphqlPaginatedConnection(
                    reactions,
                    body.variables.after,
                    body.variables.pageSize,
                  ),
                }
              : null,
          },
        }, 200, headers);
      }
      if (query.includes("CodexReviewGateV2ReviewThreads")) {
        return jsonResponse({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: graphqlConnection(state.threads),
              },
            },
          },
        }, 200, headers);
      }
      return jsonResponse({ errors: [{ message: "unexpected query" }] }, 200, headers);
    }

    const repoPath = `/repos/${OWNER}/${REPO}`;
    if (url.pathname === `${repoPath}/pulls/${PR}`) {
      return jsonResponse({
        number: PR,
        node_id: "PR_node",
        url: `${API}${repoPath}/pulls/${PR}`,
        state: "open",
        merged: false,
        merged_at: null,
        mergeable: true,
        merge_commit_sha: MERGE,
        base: { ref: "main", sha: OLD_BASE_REF_OID },
        head: { ref: "feature", sha: HEAD },
      }, 200, headers);
    }
    if (url.pathname.startsWith(`${repoPath}/compare/`)) {
      const [base] = url.pathname.slice(`${repoPath}/compare/`.length).split("...");
      return jsonResponse({
        base_commit: { sha: base },
        merge_base_commit: { sha: MERGE_BASE },
      }, 200, headers);
    }
    if (url.pathname === `${repoPath}/git/ref/pull/${PR}/merge`) {
      return jsonResponse({
        ref: `refs/pull/${PR}/merge`,
        url: `${API}${repoPath}/git/refs/pull/${PR}/merge`,
        object: {
          type: "commit",
          sha: MERGE,
          url: `${API}${repoPath}/git/commits/${MERGE}`,
        },
      }, 200, headers);
    }
    if (url.pathname === `${repoPath}/issues/${PR}/comments`) {
      return paginatedResponse(state.issueComments, url, headers);
    }
    if (url.pathname === `${repoPath}/pulls/${PR}/reviews`) {
      return paginatedResponse(state.reviews, url, headers);
    }
    if (url.pathname === `${repoPath}/pulls/${PR}/comments`) {
      return paginatedResponse(state.inlineComments, url, headers);
    }
    if (url.pathname === `${repoPath}/issues/${PR}/reactions`) {
      return paginatedResponse(state.issueReactions, url, headers);
    }
    if (url.pathname === `${repoPath}/commits/${HEAD}/check-runs`) {
      if (url.searchParams.get("filter") !== "all") {
        return jsonResponse({ message: "filter=all required" }, 422, headers);
      }
      const page = Number(url.searchParams.get("page") || 1);
      if (page === 1) {
        checkRunDiscoveries += 1;
        state.checkRunMutator?.(checkRunDiscoveries, state.checkRuns);
      }
      return checkRunsPaginatedResponse(state.checkRuns, url, headers);
    }
    const actorPermissionMatch = url.pathname.match(
      new RegExp(`^${repoPath}/collaborators/([^/]+)/permission$`),
    );
    if (actorPermissionMatch) {
      const response = state.actorPermissionResponses.shift();
      return jsonResponse(response ?? { message: "not found" }, response ? 200 : 404, headers);
    }
    const issueReactionMatch = url.pathname.match(
      new RegExp(`^${repoPath}/issues/comments/([0-9]+)/reactions$`),
    );
    if (issueReactionMatch) {
      return paginatedResponse(
        state.issueCommentReactions.get(issueReactionMatch[1]) ?? [],
        url,
        headers,
      );
    }
    const inlineReactionMatch = url.pathname.match(
      new RegExp(`^${repoPath}/pulls/comments/([0-9]+)/reactions$`),
    );
    if (inlineReactionMatch) {
      return paginatedResponse(
        state.inlineCommentReactions.get(inlineReactionMatch[1]) ?? [],
        url,
        headers,
      );
    }
    const exactIssueMatch = url.pathname.match(
      new RegExp(`^${repoPath}/issues/comments/([0-9]+)$`),
    );
    if (exactIssueMatch) {
      const item = state.issueComments.find((candidate) => String(candidate.id) === exactIssueMatch[1]);
      return jsonResponse(item ?? { message: "not found" }, item ? 200 : 404, headers);
    }
    const exactReviewMatch = url.pathname.match(
      new RegExp(`^${repoPath}/pulls/${PR}/reviews/([0-9]+)$`),
    );
    if (exactReviewMatch) {
      const item = state.reviews.find((candidate) => String(candidate.id) === exactReviewMatch[1]);
      return jsonResponse(item ?? { message: "not found" }, item ? 200 : 404, headers);
    }
    const exactInlineMatch = url.pathname.match(
      new RegExp(`^${repoPath}/pulls/comments/([0-9]+)$`),
    );
    if (exactInlineMatch) {
      const item = state.inlineComments.find((candidate) => String(candidate.id) === exactInlineMatch[1]);
      return jsonResponse(item ?? { message: "not found" }, item ? 200 : 404, headers);
    }
    if (url.pathname === repoPath) {
      return jsonResponse({
        full_name: `${OWNER}/${REPO}`,
        url: `${API}${repoPath}`,
        role_name: "admin",
        permissions: {
          admin: true,
          maintain: true,
          push: true,
          triage: true,
          pull: true,
        },
      }, 200, headers);
    }
    return jsonResponse({ message: `unexpected route ${url.pathname}` }, 404, headers);
  }

  return { fetch, calls };
}

function scopePayload() {
  return {
    repository: {
      id: "R_repo",
      name: REPO,
      owner: { login: OWNER },
      pullRequest: {
        id: "PR_node",
        number: PR,
        state: "OPEN",
        merged: false,
        mergedAt: null,
        isDraft: false,
        mergeable: "MERGEABLE",
        baseRefName: "main",
        baseRefOid: OLD_BASE_REF_OID,
        baseRef: { name: "main", target: { oid: BASE } },
        headRefName: "feature",
        headRefOid: HEAD,
        headRef: { name: "feature", target: { oid: HEAD } },
        potentialMergeCommit: {
          oid: MERGE,
          tree: { oid: TREE },
          parents: {
            totalCount: 2,
            pageInfo: { hasNextPage: false, endCursor: "parent-2" },
            nodes: [{ oid: BASE }, { oid: HEAD }],
          },
        },
      },
    },
  };
}

function issueComment(id, overrides = {}) {
  return {
    id,
    node_id: `IC_${id}`,
    url: `${API}/repos/${OWNER}/${REPO}/issues/comments/${id}`,
    html_url: `https://github.com/${OWNER}/${REPO}/pull/${PR}#issuecomment-${id}`,
    issue_url: `${API}/repos/${OWNER}/${REPO}/issues/${PR}`,
    user: actor(),
    performed_via_github_app: providerApp(),
    author_association: "MEMBER",
    body: `issue comment ${id}`,
    created_at: "2026-08-13T11:00:00Z",
    updated_at: "2026-08-13T11:00:00Z",
    ...overrides,
  };
}

function review(id) {
  return {
    id,
    node_id: `PRR_${id}`,
    url: `${API}/repos/${OWNER}/${REPO}/pulls/${PR}/reviews/${id}`,
    html_url: `https://github.com/${OWNER}/${REPO}/pull/${PR}#pullrequestreview-${id}`,
    pull_request_url: `${API}/repos/${OWNER}/${REPO}/pulls/${PR}`,
    user: actor(),
    app: providerApp(),
    author_association: "MEMBER",
    body: "clean",
    state: "APPROVED",
    submitted_at: "2026-08-13T11:01:00Z",
    commit_id: HEAD,
  };
}

function inlineComment(id) {
  return {
    id,
    node_id: `PRRC_${id}`,
    pull_request_review_id: 201,
    url: `${API}/repos/${OWNER}/${REPO}/pulls/comments/${id}`,
    html_url: `https://github.com/${OWNER}/${REPO}/pull/${PR}#discussion_r${id}`,
    pull_request_url: `${API}/repos/${OWNER}/${REPO}/pulls/${PR}`,
    user: actor(),
    app: providerApp(),
    author_association: "MEMBER",
    body: "finding",
    path: "src/example.mjs",
    line: 10,
    start_line: null,
    side: "RIGHT",
    start_side: null,
    commit_id: HEAD,
    original_commit_id: HEAD,
    in_reply_to_id: null,
    created_at: "2026-08-13T11:02:00Z",
    updated_at: "2026-08-13T11:02:00Z",
  };
}

function reviewThread(databaseId) {
  return {
    id: `THREAD_${databaseId}`,
    isResolved: false,
    isOutdated: false,
    path: "src/example.mjs",
    line: 10,
    startLine: null,
    diffSide: "RIGHT",
    startDiffSide: null,
    comments: graphqlConnection([{
      id: `PRRC_${databaseId}`,
      fullDatabaseId: String(databaseId),
    }]),
  };
}

function reaction(id, content) {
  return {
    id,
    node_id: `REACTION_${id}`,
    content,
    created_at: "2026-08-13T11:03:00Z",
    user: actor(),
  };
}

function checkRun(id, overrides = {}) {
  return {
    id,
    node_id: `CHECK_RUN_${id}`,
    url: `${API}/repos/${OWNER}/${REPO}/check-runs/${id}`,
    name: "Codex review",
    head_sha: HEAD,
    status: "completed",
    conclusion: "success",
    started_at: "2026-08-13T11:04:00Z",
    completed_at: "2026-08-13T11:05:00Z",
    external_id: `provider-run-${id}`,
    details_url: `https://checks.github.test/runs/${id}`,
    app: checkRunApp(),
    ...overrides,
  };
}

function checkRunApp(id = 42, slug = "chatgpt-codex-connector") {
  return {
    id,
    node_id: `APP_${id}`,
    slug,
  };
}

function normalizedCheckRun(id) {
  return {
    id: String(id),
    node_id: `CHECK_RUN_${id}`,
    url: `${API}/repos/${OWNER}/${REPO}/check-runs/${id}`,
    name: "Codex review",
    head_sha: HEAD,
    status: "completed",
    conclusion: "success",
    started_at: "2026-08-13T11:04:00.000Z",
    completed_at: "2026-08-13T11:05:00.000Z",
    external_id: `provider-run-${id}`,
    details_url: `https://checks.github.test/runs/${id}`,
    app: {
      id: "42",
      node_id: "APP_42",
      slug: "chatgpt-codex-connector",
    },
  };
}

function graphqlReaction(id, content) {
  return {
    id: `REACTION_${id}`,
    databaseId: id,
    content,
    createdAt: "2026-08-13T11:03:00Z",
    user: {
      id: "BOT_codex",
      databaseId: 9001,
      login: "chatgpt-codex-connector[bot]",
    },
  };
}

function actor() {
  return {
    id: 9001,
    login: "chatgpt-codex-connector[bot]",
    type: "Bot",
    node_id: "BOT_codex",
  };
}

function providerApp(id = 42) {
  return {
    id,
    node_id: `APP_${id}`,
    slug: "chatgpt-codex-connector",
  };
}

function expectedProviderActor() {
  return {
    id: "9001",
    login: "chatgpt-codex-connector[bot]",
    type: "Bot",
    node_id: "BOT_codex",
  };
}

function expectedProviderApp() {
  return {
    id: "42",
    node_id: "APP_42",
    slug: "chatgpt-codex-connector",
  };
}

function expectedProviderPreScopeBinding() {
  return {
    repository: { owner: OWNER, name: REPO },
    scope: {
      pull_request: { number: PR },
      head_ref_oid: HEAD,
    },
    expected_provider: {
      actor: expectedProviderActor(),
      app: expectedProviderApp(),
    },
  };
}

function actorPermissionResponse() {
  return {
    permission: "write",
    role_name: "write",
    user: {
      ...actor(),
      permissions: {
        admin: false,
        maintain: false,
        push: true,
        triage: true,
        pull: true,
      },
    },
  };
}

function graphqlConnection(nodes) {
  return {
    nodes,
    pageInfo: {
      hasNextPage: false,
      endCursor: nodes.length > 0 ? `cursor-${nodes.length}` : null,
    },
  };
}

function graphqlPaginatedConnection(nodes, after, pageSize) {
  const start = after === null ? 0 : Number(String(after).slice("cursor-".length));
  const page = nodes.slice(start, start + pageSize);
  const end = start + page.length;
  return {
    totalCount: nodes.length,
    nodes: page,
    pageInfo: {
      hasNextPage: end < nodes.length,
      endCursor: page.length > 0 ? `cursor-${end}` : null,
    },
  };
}

function paginatedResponse(items, url, headers) {
  const perPage = Number(url.searchParams.get("per_page") || 30);
  const page = Number(url.searchParams.get("page") || 1);
  const start = (page - 1) * perPage;
  return jsonResponse(items.slice(start, start + perPage), 200, headers);
}

function checkRunsPaginatedResponse(items, url, headers) {
  const perPage = Number(url.searchParams.get("per_page") || 30);
  const page = Number(url.searchParams.get("page") || 1);
  const start = (page - 1) * perPage;
  const pageItems = items.slice(start, start + perPage);
  const nextPage = start + pageItems.length < items.length ? page + 1 : null;
  const nextHeaders = { ...headers };
  if (nextPage !== null) {
    const next = new URL(url);
    next.searchParams.set("page", String(nextPage));
    nextHeaders.Link = `<${next.href}>; rel="next"`;
  }
  return jsonResponse({ total_count: items.length, check_runs: pageItems }, 200, nextHeaders);
}

function jsonResponse(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}
