import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  V2_HARD_LIMITS,
  V2_LIMITS_PROFILES,
  V2_OUTPUT_KEYS,
  V2_REACTION_FETCH_CONCURRENCY,
  V2_RECOVERY_CODES,
  V2_REQUIRED_CHECK_NAME,
  V2_STABILITY_INTERVAL_MS,
  V2_STABILITY_WINDOW_MS,
  V2_STICKY_MARKER,
  appendV2GateSummary,
  buildCanonicalV2ReviewRequestBody,
  buildV2GateReport,
  buildV2ReactionCleanArtifacts,
  buildV2StickyCommentBody,
  canonicalV2RequestComments,
  normalizeV2LimitsProfile,
  normalizeV2Operation,
  normalizeV2RequestReview,
  parseCanonicalV2ReviewRequestBody,
  runV2GateCli,
  waitForStableV2Snapshot,
} from "../packages/action/src/v2/gate-runtime.mjs";

const OWNER = "owner";
const REPO = "repo";
const REPOSITORY = `${OWNER}/${REPO}`;
const PR = 17;
const REPO_ID = 424_242;
const HEAD = "a".repeat(40);
const NEXT_HEAD = "d".repeat(40);
const BASE = "b".repeat(40);
const TEST_MERGE = "e".repeat(40);
const OLD_HEAD = "c".repeat(40);
const CODEX_BOT = { login: "chatgpt-codex-connector[bot]", type: "Bot" };
const ACTIONS_BOT = { login: "github-actions[bot]", type: "Bot" };
const HUMAN = { login: "joey", type: "User" };
const READER = { login: "reader", type: "User" };
const CODEX_APP = { slug: "chatgpt-codex-connector" };

test("normalizers, profiles, result vocabulary, and production constants are closed", () => {
  assert.equal(normalizeV2Operation(undefined), "reconcile");
  assert.equal(normalizeV2Operation("begin-review"), "begin-review");
  assert.throws(() => normalizeV2Operation("scan"), /reconcile or begin-review/u);
  assert.equal(normalizeV2RequestReview(undefined), true);
  assert.equal(normalizeV2RequestReview("TRUE"), true);
  assert.equal(normalizeV2RequestReview("false"), false);
  assert.throws(() => normalizeV2RequestReview("1"), /true or false/u);
  assert.equal(normalizeV2LimitsProfile(""), "default");
  assert.equal(normalizeV2LimitsProfile("expanded"), "expanded");
  assert.throws(() => normalizeV2LimitsProfile("custom"), /default or expanded/u);
  assert.deepEqual(V2_LIMITS_PROFILES.default, {
    maxPages: 20,
    maxObjects: 2_000,
    maxAttempts: 128,
    maxSnapshotBytes: 32 * 1024 * 1024,
    requestTimeoutMs: 10_000,
    reconcileBudgetMs: 60_000,
  });
  assert.deepEqual(V2_LIMITS_PROFILES.expanded, {
    maxPages: 100,
    maxObjects: 10_000,
    maxAttempts: 512,
    maxSnapshotBytes: 64 * 1024 * 1024,
    requestTimeoutMs: 20_000,
    reconcileBudgetMs: 300_000,
  });
  assert.deepEqual(V2_HARD_LIMITS, {
    maxPages: 1_000,
    maxObjects: 20_000,
    maxAttempts: 2_048,
    maxSnapshotBytes: 64 * 1024 * 1024,
    requestTimeoutMs: 30_000,
    reconcileBudgetMs: 720_000,
  });
  assert.equal(V2_STABILITY_INTERVAL_MS, 5_000);
  assert.equal(V2_STABILITY_WINDOW_MS, 60_000);
  assert.equal(V2_REACTION_FETCH_CONCURRENCY, 4);
  assert.deepEqual(V2_OUTPUT_KEYS, [
    "execution_health",
    "gate_outcome",
    "recovery_code",
    "retry_safe",
  ]);
  assert.deepEqual([...V2_RECOVERY_CODES].sort(), [
    "create_verifier_run",
    "fix_findings",
    "none",
    "raise_protected_limit",
    "reconcile",
    "refresh_head",
    "repair_permissions",
    "request_clean_generation",
    "retry_begin",
    "retry_reconcile",
    "unsupported_target",
    "use_expanded_limits",
    "wait_provider",
    "wait_then_reconcile",
  ]);
  assert.throws(() => buildV2GateReport({
    executionHealth: "unhealthy",
    gateOutcome: "success",
    recoveryCode: "none",
  }), /unhealthy\/success/u);
  assert.throws(() => buildV2GateReport({
    executionHealth: "healthy",
    gateOutcome: "pending",
    recoveryCode: "invented",
  }), /closed v2 set/u);
  assert.equal(buildV2GateReport({
    executionHealth: "unhealthy",
    gateOutcome: "pending",
    recoveryCode: "retry_begin",
  }).retrySafe, false);
  assert.equal(buildV2GateReport({
    executionHealth: "unhealthy",
    gateOutcome: "pending",
    recoveryCode: "retry_reconcile",
  }).retrySafe, true);
});

test("canonical workflow request binds repository, PR, head, base epoch, and run exactly", () => {
  const body = canonicalRequestBody();
  assert.equal(
    body,
    `@codex review\n\n<!-- codex-review-gate-request-v2\n` +
      `{"baseRef":"main","baseRepositoryId":"${REPO_ID}","baseSha":"${BASE}",` +
      `"headSha":"${HEAD}","prNumber":"${PR}","repositoryId":"${REPO_ID}",` +
      `"runId":"123","version":2}\n-->`,
  );
  assert.deepEqual(parseCanonicalV2ReviewRequestBody(body), {
    version: 2,
    repositoryId: String(REPO_ID),
    prNumber: String(PR),
    headSha: HEAD,
    baseSha: BASE,
    baseRef: "main",
    baseRepositoryId: String(REPO_ID),
    runId: "123",
  });
  for (const invalid of [
    `${body}\n`,
    body.replace(HEAD, HEAD.slice(0, 10)),
    body.replace('"runId":"123"', '"runId":"0123"'),
    body.replace("@codex review", "Please @codex review"),
  ]) {
    assert.equal(parseCanonicalV2ReviewRequestBody(invalid), null);
  }
  assert.throws(() => canonicalRequestBody(HEAD.toUpperCase()), /full lowercase SHA/u);
  assert.throws(() => canonicalRequestBody(HEAD.slice(0, 10)), /full lowercase SHA/u);
  assert.throws(
    () => canonicalRequestBody(HEAD, { baseSha: BASE.slice(0, 10) }),
    /base must be one full lowercase SHA/u,
  );
  assert.equal(canonicalV2RequestComments([workflowRequest({ user: HUMAN })]).length, 0);
  assert.equal(canonicalV2RequestComments([workflowRequest({
    updated_at: "2026-08-25T08:00:01Z",
  })]).length, 0);
  assert.equal(canonicalV2RequestComments([workflowRequest()]).length, 1);
});

test("qualifying +1 is strict, head-bound, and vetoed by same-or-later eyes", () => {
  const request = workflowRequest();
  const requests = canonicalV2RequestComments([request]);
  const valid = buildV2ReactionCleanArtifacts(requests, new Map([["101", [
    reaction({ id: 201, created_at: "2026-08-25T08:01:00Z" }),
  ]]]));
  assert.equal(valid.errors.length, 0);
  assert.equal(valid.artifacts.length, 1);
  assert.equal(valid.artifacts[0].headSha, HEAD);

  const equal = buildV2ReactionCleanArtifacts(requests, new Map([["101", [
    reaction({ id: 202, created_at: "2026-08-25T08:00:00Z" }),
  ]]]));
  assert.equal(equal.artifacts.length, 0);
  assert.match(equal.errors[0], /not strictly after/u);

  const vetoed = buildV2ReactionCleanArtifacts(requests, new Map([["101", [
    reaction({ id: 203, created_at: "2026-08-25T08:01:00Z" }),
    reaction({ id: 204, content: "eyes", created_at: "2026-08-25T08:01:00Z" }),
  ]]]));
  assert.equal(vetoed.artifacts.length, 0);
  assert.equal(vetoed.livenessVetoed, true);
  assert.equal(canonicalV2RequestComments([ordinaryRequest()]).length, 0);
});

test("snapshot stability requires two adjacent complete fingerprints within one deadline", async () => {
  const sequence = [snapshot("one"), snapshot("two"), snapshot("two")];
  let clock = 0;
  const sleeps = [];
  const stable = await waitForStableV2Snapshot({
    loadSnapshot: async () => sequence.shift(),
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      clock += milliseconds;
    },
    now: () => clock,
    intervalMs: 5,
    windowMs: 20,
  });
  assert.equal(stable.kind, "stable");
  assert.equal(stable.loads, 3);
  assert.deepEqual(sleeps, [5, 5]);

  let load = 0;
  clock = 0;
  const unstable = await waitForStableV2Snapshot({
    loadSnapshot: async () => snapshot(String(load++)),
    sleep: async (milliseconds) => { clock += milliseconds; },
    now: () => clock,
    intervalMs: 5,
    windowMs: 15,
  });
  assert.equal(unstable.kind, "unstable");
  assert.equal(unstable.loads, 3);
});

test("pull_request verifier publishes exact outputs and succeeds only for stable clean evidence", async (context) => {
  const github = createGitHubMock({
    issueComments: [workflowRequest()],
    reactionsByCommentId: new Map([["101", [reaction()]]]),
  });
  const environment = runtimeEnvironment(context);
  const { result, sleeps } = await runGate(environment, github);

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "success");
  assert.equal(result.report.recoveryCode, "none");
  assert.equal(result.report.retrySafe, false);
  assert.deepEqual(github.statusWrites, []);
  assert.deepEqual(sleeps, [1]);
  assert.deepEqual(readOutputs(environment.GITHUB_OUTPUT), {
    execution_health: "healthy",
    gate_outcome: "success",
    recovery_code: "none",
    retry_safe: "false",
  });
  const summary = readFileSync(environment.GITHUB_STEP_SUMMARY, "utf8");
  assert.match(summary, /0 unresolved, 0 resolved, 0 historical, 0 indeterminate/u);
  assert.match(summary, new RegExp(TEST_MERGE, "u"));
  assert.equal(github.stickyCreates.length, 0);
  const baseEpochCalls = github.calls.filter(({ path }) => path === "/graphql");
  assert.equal(baseEpochCalls.length, 4);
  for (const { body } of baseEpochCalls) {
    assert.deepEqual(body.variables, { owner: OWNER, repo: REPO, number: PR });
    assert.match(body.query, /BASE_REF_CHANGED_EVENT/u);
    assert.match(body.query, /BASE_REF_FORCE_PUSHED_EVENT/u);
    assert.match(body.query, /timelineItems\(\s*last: 1/su);
  }
});

test("output persistence failure leaves one authoritative unhealthy summary", async (context) => {
  const github = createGitHubMock({
    issueComments: [workflowRequest()],
    reactionsByCommentId: new Map([["101", [reaction()]]]),
  });
  const environment = runtimeEnvironment(context, { suffix: "output-persistence-failure" });
  mkdirSync(environment.GITHUB_OUTPUT);

  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "unknown");
  assert.equal(result.report.recoveryCode, "repair_permissions");
  assert.equal(result.report.retrySafe, false);
  const summary = readFileSync(environment.GITHUB_STEP_SUMMARY, "utf8");
  assert.equal(summary.match(/^## Codex GitHub Review Gate$/gmu)?.length, 1);
  assert.equal(summary.match(/Execution health: \*\*unhealthy\*\*/gu)?.length, 1);
  assert.doesNotMatch(summary, /Execution health: \*\*healthy\*\*/u);
  assert.doesNotMatch(summary, /Gate outcome: \*\*success\*\*/u);
  assert.match(summary, /Failed to persist the v2 gate report/iu);
});

test("output failure preserves a proven finding verdict and recovery", async (context) => {
  const github = createGitHubMock({
    issueComments: [ordinaryRequest(), findingIssueComment(HEAD)],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "finding-output-persistence-failure",
  });
  mkdirSync(environment.GITHUB_OUTPUT);

  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "failure");
  assert.equal(result.report.recoveryCode, "fix_findings");
  assert.equal(result.report.retrySafe, false);
  assert.deepEqual(result.report.counts, {
    unresolved: 1,
    resolved: 0,
    historical: 0,
    indeterminate: 0,
  });
  const summary = readFileSync(environment.GITHUB_STEP_SUMMARY, "utf8");
  assert.equal(summary.match(/^## Codex GitHub Review Gate$/gmu)?.length, 1);
  assert.equal(summary.match(/Execution health: \*\*unhealthy\*\*/gu)?.length, 1);
  assert.doesNotMatch(summary, /Execution health: \*\*healthy\*\*/u);
  assert.match(summary, /Gate outcome: \*\*failure\*\*/u);
  assert.match(summary, /Recovery code: `fix_findings`/u);
  assert.match(summary, /1 unresolved, 0 resolved, 0 historical, 0 indeterminate/u);
  assert.match(summary, /Fix the unresolved Codex findings/iu);
  assert.match(summary, /Failed to persist the v2 gate report/iu);
});

test("the JavaScript Action reads INPUT_* values without composite env bridging", async (context) => {
  const github = createGitHubMock({ issueComments: [workflowRequest()] });
  const environment = runtimeEnvironment(context);
  for (const [internal, actionInput] of [
    ["GITHUB_TOKEN", "INPUT_GITHUB_TOKEN"],
    ["PR_NUMBER", "INPUT_PR_NUMBER"],
    ["EXPECTED_HEAD_SHA", "INPUT_EXPECTED_HEAD_SHA"],
    ["OPERATION_INPUT", "INPUT_OPERATION"],
    ["REQUEST_COMMENT_ID", "INPUT_REQUEST_COMMENT_ID"],
    ["REQUEST_REVIEW_INPUT", "INPUT_REQUEST_REVIEW"],
    ["LIMITS_PROFILE", "INPUT_LIMITS_PROFILE"],
  ]) {
    environment[actionInput] = environment[internal];
    delete environment[internal];
  }
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_provider");
});

test("issue_comment created and edited require exact sender and author before verifier rerun", async (context) => {
  for (const action of ["created", "edited"]) {
    const terminal = cleanIssueComment(HEAD, { id: action === "created" ? 201 : 202 });
    const github = createGitHubMock({
      issueComments: [ordinaryRequest(), terminal],
    });
    const environment = runtimeEnvironment(context, {
      suffix: `provider-${action}`,
      eventName: "issue_comment",
      expectedHeadSha: "",
      requestReview: "false",
      requestCommentId: String(terminal.id),
      event: issueCommentEvent(action, terminal),
    });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 0, action);
    assert.equal(result.report.executionHealth, "healthy", action);
    assert.equal(result.report.gateOutcome, "pending", action);
    assert.deepEqual(github.rerunRequests, ["7001"], action);
    assert.equal(github.stickyCreates.length, 1, action);
  }

  const terminal = cleanIssueComment(HEAD);
  const environment = runtimeEnvironment(context, {
    suffix: "provider-wrong-sender",
    eventName: "issue_comment",
    expectedHeadSha: "",
    requestReview: "false",
    requestCommentId: String(terminal.id),
    event: issueCommentEvent("created", terminal, { sender: HUMAN }),
  });
  const result = await runV2GateCli({
    environment,
    fetchImpl: async () => { throw new Error("fetch must not run"); },
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.report.reason, /sender\/author contract/u);
  assert.equal(result.report.recoveryCode, "unsupported_target");
  assert.equal(result.report.retrySafe, false);
});

test("repository_dispatch is rejected before any GitHub API request", async (context) => {
  const environment = runtimeEnvironment(context, {
    eventName: "repository_dispatch",
    event: { action: "codex-review-gate", client_payload: { pull_request: PR } },
  });
  const result = await runV2GateCli({
    environment,
    fetchImpl: async () => { throw new Error("fetch must not run"); },
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.report.reason, /Unsupported v2 runtime event: repository_dispatch/u);
  assert.equal(result.report.recoveryCode, "unsupported_target");
  assert.equal(result.report.retrySafe, false);
});

test("invalid manual expected head is unhealthy/not_applicable and writes no status", async (context) => {
  const github = createGitHubMock({ pullRequestOverrides: { head: { sha: NEXT_HEAD } } });
  const environment = runtimeEnvironment(context, { eventName: "workflow_dispatch" });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "not_applicable");
  assert.equal(result.report.recoveryCode, "refresh_head");
  assert.deepEqual(github.statusWrites, []);
});

test("stale provider event is healthy/not_applicable and writes no status", async (context) => {
  const terminal = cleanIssueComment(HEAD);
  const github = createGitHubMock({
    issueComments: [terminal],
    pullRequestOverrides: { head: { sha: NEXT_HEAD } },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "stale-provider",
    eventName: "issue_comment",
    expectedHeadSha: "",
    requestReview: "false",
    requestCommentId: String(terminal.id),
    event: issueCommentEvent("created", terminal),
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "not_applicable");
  assert.equal(result.report.recoveryCode, "refresh_head");
  assert.deepEqual(github.statusWrites, []);
});

test("stale provider finding is rejected before any current-head status write", async (context) => {
  const terminal = findingIssueComment(HEAD);
  const github = createGitHubMock({
    issueComments: [terminal],
    pullRequestOverrides: { head: { sha: NEXT_HEAD } },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "stale-provider-finding",
    eventName: "issue_comment",
    expectedHeadSha: "",
    requestReview: "false",
    requestCommentId: String(terminal.id),
    event: issueCommentEvent("created", terminal),
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "not_applicable");
  assert.equal(result.report.recoveryCode, "refresh_head");
  assert.deepEqual(github.statusWrites, []);
  assert.deepEqual(github.stickyCreates, []);
  assert.deepEqual(github.stickyPatches, []);
  assert.equal(
    github.calls.some(({ path }) => path.endsWith(`/issues/${PR}/comments`)),
    false,
  );
  assert.equal(
    github.calls.some(({ path }) => path.endsWith(`/pulls/${PR}/reviews`)),
    false,
  );
});

test("a head change after pending never retargets status or evidence", async (context) => {
  const github = createGitHubMock({
    issueComments: [workflowRequest()],
    pullRequestSequence: [
      {},
      { head: { sha: NEXT_HEAD } },
    ],
  });
  const environment = runtimeEnvironment(context);
  const { result } = await runGate(environment, github);
  assert.equal(result.report.gateOutcome, "not_applicable");
  assert.equal(result.report.recoveryCode, "refresh_head");
  assert.deepEqual(github.statusWrites, []);
  assert.equal(github.calls.some((call) => call.path.includes(NEXT_HEAD)), false);
  assert.deepEqual(github.stickyCreates, []);
  assert.deepEqual(github.stickyPatches, []);
});

test("reconcile pins the initial default branch and base ref across every snapshot", async (context) => {
  const evidence = [
    ordinaryRequest(),
    cleanIssueComment(HEAD, {
      created_at: "2026-08-25T08:02:00Z",
      updated_at: "2026-08-25T08:02:00Z",
    }),
  ];
  const retargeted = createGitHubMock({
    issueComments: evidence,
    pullRequestSequence: [
      {},
      {},
      { base: { sha: BASE, ref: "release" } },
    ],
  });
  const retargetedEnvironment = runtimeEnvironment(context, {
    suffix: "base-ref-retarget",
  });
  const { result: retargetedResult } = await runGate(
    retargetedEnvironment,
    retargeted,
    { stabilityWindowMs: 3 },
  );
  assert.equal(retargetedResult.report.executionHealth, "unhealthy");
  assert.equal(retargetedResult.report.gateOutcome, "pending");
  assert.equal(retargetedResult.report.recoveryCode, "wait_then_reconcile");
  assert.equal(retargeted.statusWrites.some(({ state }) => state === "success"), false);

  const renamedTogether = createGitHubMock({
    issueComments: evidence,
    repositorySequence: [
      {},
      {},
      { default_branch: "release" },
    ],
    pullRequestSequence: [
      {},
      {},
      { base: { sha: BASE, ref: "release" } },
    ],
  });
  const renamedEnvironment = runtimeEnvironment(context, {
    suffix: "default-and-base-ref-rename",
  });
  const { result: renamedResult } = await runGate(
    renamedEnvironment,
    renamedTogether,
    { stabilityWindowMs: 3 },
  );
  assert.equal(renamedResult.report.executionHealth, "unhealthy");
  assert.equal(renamedResult.report.gateOutcome, "pending");
  assert.equal(renamedResult.report.recoveryCode, "wait_then_reconcile");
  assert.equal(renamedTogether.statusWrites.some(({ state }) => state === "success"), false);
});

test("reconcile pins head ref, head repository, and base SHA throughout a snapshot", async (context) => {
  const evidence = [ordinaryRequest(), cleanIssueComment(HEAD)];
  for (const [suffix, closingMutation] of [
    ["head-ref-drift", { head: { ref: "renamed-feature" } }],
    ["head-repository-drift", {
      head: { repo: { id: 99, full_name: "owner/replacement" } },
    }],
    ["base-sha-drift", { base: { sha: "e".repeat(40) } }],
  ]) {
    const github = createGitHubMock({
      issueComments: evidence,
      pullRequestSequence: [{}, {}, closingMutation],
    });
    const environment = runtimeEnvironment(context, { suffix });
    const { result } = await runGate(environment, github, { stabilityWindowMs: 1 });
    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "wait_then_reconcile", suffix);
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, suffix);
  }
});

test("latest base-ref timeline epoch invalidates older positive evidence on the same head", async (context) => {
  for (const [suffix, epoch] of [
    ["retarget-epoch", baseRefChangedEvent()],
    ["force-push-epoch", baseRefForcePushedEvent()],
  ]) {
    const ordinary = ordinaryRequest();
    const github = createGitHubMock({
      baseEpoch: epoch,
      issueComments: [
        ordinary,
        cleanIssueComment(HEAD, {
          created_at: "2026-08-25T08:02:00Z",
          updated_at: "2026-08-25T08:02:00Z",
        }),
      ],
    });
    const environment = runtimeEnvironment(context, { suffix });
    const { result } = await runGate(environment, github);
    assert.equal(result.report.executionHealth, "healthy", suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "request_clean_generation", suffix);
    assert.match(result.report.reason, /strictly newer than base epoch/u, suffix);
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, suffix);
    assert.equal(
      github.calls.some((call) => call.path.endsWith(`/${ordinary.id}/reactions`)),
      false,
      `${suffix}: ordinary requests are not generations after a base epoch`,
    );
  }
});

test("after a base epoch only a direct canonical-request +1 can recover clean", async (context) => {
  const epoch = baseRefChangedEvent();
  const generation = workflowRequest({
    created_at: "2026-08-25T08:10:00Z",
    updated_at: "2026-08-25T08:10:00Z",
  });
  const lateTerminalClean = cleanIssueComment(HEAD, {
    created_at: "2026-08-25T08:15:00Z",
    updated_at: "2026-08-25T08:15:00Z",
  });
  const lateCleanGitHub = createGitHubMock({
    baseEpoch: epoch,
    issueComments: [generation, lateTerminalClean],
  });
  const lateCleanEnvironment = runtimeEnvironment(context, {
    suffix: "base-epoch-unattributed-terminal-clean",
  });
  const { result: lateClean } = await runGate(lateCleanEnvironment, lateCleanGitHub);
  assert.equal(lateClean.report.gateOutcome, "pending");
  assert.equal(lateClean.report.recoveryCode, "request_clean_generation");
  assert.match(lateClean.report.reason, /cannot be attributed.*canonical request/u);
  assert.equal(lateCleanGitHub.statusWrites.some(({ state }) => state === "success"), false);

  const findingGitHub = createGitHubMock({
    baseEpoch: epoch,
    issueComments: [
      findingIssueComment(HEAD, {
        created_at: "2026-08-25T08:06:00Z",
        updated_at: "2026-08-25T08:06:00Z",
      }),
      generation,
      lateTerminalClean,
    ],
  });
  const findingEnvironment = runtimeEnvironment(context, {
    suffix: "base-epoch-late-clean-cannot-resolve-finding",
  });
  const { result: finding } = await runGate(findingEnvironment, findingGitHub);
  assert.equal(finding.report.gateOutcome, "failure");
  assert.equal(finding.report.counts.unresolved, 1);
  assert.equal(finding.report.counts.resolved, 0);
  assert.equal(findingGitHub.statusWrites.some(({ state }) => state === "success"), false);

  const reactionGitHub = createGitHubMock({
    baseEpoch: epoch,
    issueComments: [generation],
    reactionsByCommentId: new Map([[String(generation.id), [reaction({
      created_at: "2026-08-25T08:15:00Z",
    })]]]),
  });
  const reactionEnvironment = runtimeEnvironment(context, {
    suffix: "base-epoch-direct-reaction-recovered",
  });
  const { result: recovered } = await runGate(reactionEnvironment, reactionGitHub);
  assert.equal(recovered.report.gateOutcome, "success");
  assert.match(recovered.report.reason, /request-reaction/u);
});

test("base-bound workflow markers do not cross base commit epochs", async (context) => {
  const request = workflowRequest({
    body: canonicalRequestBody(HEAD, { baseSha: OLD_HEAD }),
    created_at: "2026-08-25T08:10:00Z",
    updated_at: "2026-08-25T08:10:00Z",
  });
  const github = createGitHubMock({
    issueComments: [
      request,
      cleanIssueComment(HEAD, {
        created_at: "2026-08-25T08:15:00Z",
        updated_at: "2026-08-25T08:15:00Z",
      }),
    ],
  });
  const environment = runtimeEnvironment(context, { suffix: "marker-base-mismatch" });
  const { result } = await runGate(environment, github);
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("a base epoch change between complete reads cannot publish success", async (context) => {
  const request = ordinaryRequest();
  const clean = cleanIssueComment(HEAD, {
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const epoch = baseRefChangedEvent();
  const github = createGitHubMock({
    issueComments: [request, clean],
    baseEpochSequence: [null, null, epoch, epoch],
  });
  const environment = runtimeEnvironment(context, { suffix: "base-epoch-snapshot-change" });
  const { result } = await runGate(environment, github, { stabilityWindowMs: 3 });
  assert.notEqual(result.report.gateOutcome, "success");
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("GraphQL base-epoch errors fail closed without publishing success", async (context) => {
  const github = createGitHubMock({
    issueComments: [ordinaryRequest(), cleanIssueComment(HEAD)],
    baseEpochResponseMutator: (response) => ({
      ...response,
      errors: [{ message: "synthetic timeline error" }],
    }),
  });
  const environment = runtimeEnvironment(context, { suffix: "base-epoch-graphql-error" });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.equal(result.report.retrySafe, false);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("semantic safe reads retry GraphQL and GET transport or decode failures", async (context) => {
  const cases = [
    {
      suffix: "graphql-http-retry",
      route: ({ method, path }) => method === "POST" && path === "/graphql",
      firstResponse: () => jsonResponse({ message: "synthetic GraphQL retry" }, 502),
    },
    {
      suffix: "graphql-transport-retry",
      route: ({ method, path }) => method === "POST" && path === "/graphql",
      firstResponse: () => { throw new Error("synthetic GraphQL transport failure"); },
    },
    {
      suffix: "get-body-retry",
      route: ({ method, path }) =>
        method === "GET" && path === `/repos/${REPOSITORY}`,
      firstResponse: () => failingBodyResponse("synthetic body stream failure"),
    },
    {
      suffix: "get-non-json-retry",
      route: ({ method, path }) =>
        method === "GET" && path === `/repos/${REPOSITORY}`,
      firstResponse: () => new Response("not json", { status: 200 }),
    },
  ];

  for (const { suffix, route, firstResponse } of cases) {
    let intercepted = false;
    const github = createGitHubMock({
      issueComments: [ordinaryRequest(), cleanIssueComment(HEAD)],
      requestInterceptor: (request) => {
        if (!intercepted && route(request)) {
          intercepted = true;
          return firstResponse();
        }
        return undefined;
      },
    });
    const environment = runtimeEnvironment(context, { suffix });
    const { result } = await runGate(environment, github);
    assert.equal(intercepted, true, suffix);
    assert.equal(result.exitCode, 0, suffix);
    assert.equal(result.report.gateOutcome, "success", suffix);
    assert.deepEqual(github.statusWrites, [], suffix);
  }
});

test("safe-read exhaustion is retry-safe but deterministic schema and size failures are not", async (context) => {
  const repositoryPath = `/repos/${REPOSITORY}`;
  for (const status of [401, 403]) {
    const github = createGitHubMock({
      requestInterceptor: ({ method, path }) =>
        method === "GET" && path === repositoryPath
          ? jsonResponse({ message: "synthetic permission failure" }, status)
          : undefined,
    });
    const environment = runtimeEnvironment(context, { suffix: `http-${status}` });
    const { result } = await runGate(environment, github);
    assert.equal(result.report.recoveryCode, "repair_permissions", String(status));
    assert.equal(result.report.retrySafe, false, String(status));
    assert.equal(
      github.calls.filter(({ method, path }) => method === "GET" && path === repositoryPath).length,
      1,
      String(status),
    );
  }

  const exhausted = createGitHubMock({
    requestInterceptor: ({ method, path }) =>
      method === "GET" && path === repositoryPath
        ? jsonResponse({ message: "synthetic transient failure" }, 502)
        : undefined,
  });
  const exhaustedEnvironment = runtimeEnvironment(context, {
    suffix: "safe-read-exhausted",
  });
  const { result: exhaustedResult } = await runGate(exhaustedEnvironment, exhausted);
  assert.equal(exhaustedResult.report.recoveryCode, "retry_reconcile");
  assert.equal(exhaustedResult.report.retrySafe, true);
  assert.equal(
    exhausted.calls.filter(({ method, path }) =>
      method === "GET" && path === repositoryPath
    ).length,
    3,
  );

  for (const [suffix, response] of [
    ["deterministic-schema", jsonResponse({ id: REPO_ID })],
    ["deterministic-size", new Response("x".repeat(8 * 1024 * 1024 + 1), { status: 200 })],
  ]) {
    let used = false;
    const github = createGitHubMock({
      requestInterceptor: ({ method, path }) => {
        if (!used && method === "GET" && path === repositoryPath) {
          used = true;
          return response;
        }
        return undefined;
      },
    });
    const environment = runtimeEnvironment(context, { suffix });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.retrySafe, false, suffix);
    assert.notEqual(result.report.recoveryCode, "retry_reconcile", suffix);
    assert.equal(
      github.calls.filter(({ method, path }) =>
        method === "GET" && path === repositoryPath
      ).length,
      1,
      suffix,
    );
  }
});

test("base-epoch GraphQL accepts unrelated timeline items with no filtered event", async (context) => {
  const github = createGitHubMock({
    issueComments: [ordinaryRequest(), cleanIssueComment(HEAD)],
    baseEpochResponseMutator: (response) => ({
      ...response,
      data: {
        ...response.data,
        repository: {
          ...response.data.repository,
          pullRequest: {
            ...response.data.repository.pullRequest,
            timelineItems: {
              totalCount: 13,
              filteredCount: 0,
              pageCount: 0,
              nodes: [],
            },
          },
        },
      },
    }),
  });
  const environment = runtimeEnvironment(context, {
    suffix: "base-epoch-unrelated-timeline-items",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.gateOutcome, "success");
});

test("pull_request verifier admits only the four canonical lifecycle actions", async (context) => {
  for (const action of ["opened", "reopened", "synchronize", "ready_for_review"]) {
    const github = createGitHubMock();
    const environment = runtimeEnvironment(context, {
      suffix: `pull-request-${action}`,
      event: pullRequestEvent(action),
    });
    const { result } = await runGate(environment, github);
    assert.equal(result.report.gateOutcome, "pending", action);
    assert.equal(result.report.recoveryCode, "wait_provider", action);
  }
});

test("pull_request edited is rejected before GitHub API access", async (context) => {
  const environment = runtimeEnvironment(context, {
    suffix: "pull-request-edited",
    event: pullRequestEvent("edited"),
  });
  const result = await runV2GateCli({
    environment,
    fetchImpl: async () => { throw new Error("fetch must not run"); },
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.report.reason, /read-only verifier contract/u);
});

test("pull_request verifier rejects every tampered launch binding", async (context) => {
  const successEvidence = [ordinaryRequest(), cleanIssueComment(HEAD)];
  const controlGitHub = createGitHubMock({ issueComments: successEvidence });
  const controlEnvironment = runtimeEnvironment(context, {
    suffix: "pull-request-binding-control",
  });
  const { result: control } = await runGate(controlEnvironment, controlGitHub);
  assert.equal(control.exitCode, 0);
  assert.equal(control.report.gateOutcome, "success");

  const cases = [
    {
      label: "github-sha",
      mutateEnvironment: (environment) => { environment.GITHUB_SHA = NEXT_HEAD; },
      expectedReason:
        "The pull_request verifier is not bound to the exact current PR head, base, and " +
        "test-merge commit",
      expectedReadCount: 2,
    },
    {
      label: "github-ref",
      mutateEnvironment: (environment) => { environment.GITHUB_REF = "refs/heads/main"; },
      expectedReason:
        "The pull_request verifier is not bound to the exact current PR head, base, and " +
        "test-merge commit",
      expectedReadCount: 2,
    },
    {
      label: "event-repository",
      mutateEvent: (event) => { event.repository.full_name = "other/repository"; },
      expectedReason: "pull_request trigger did not satisfy the exact read-only verifier contract",
      expectedReadCount: 0,
    },
    {
      label: "event-head",
      mutateEvent: (event) => { event.pull_request.head.sha = NEXT_HEAD; },
      expectedReason: "pull_request trigger did not satisfy the exact read-only verifier contract",
      expectedReadCount: 0,
    },
    {
      label: "event-base",
      mutateEvent: (event) => { event.pull_request.base.sha = NEXT_HEAD; },
      expectedReason:
        "The pull_request verifier is not bound to the exact current PR head, base, and " +
        "test-merge commit",
      expectedReadCount: 2,
    },
    {
      label: "operation",
      mutateEnvironment: (environment) => { environment.OPERATION_INPUT = "begin-review"; },
      expectedReason: "pull_request trigger did not satisfy the exact read-only verifier contract",
      expectedReadCount: 0,
    },
    {
      label: "request-review",
      mutateEnvironment: (environment) => { environment.REQUEST_REVIEW_INPUT = "true"; },
      expectedReason: "pull_request trigger did not satisfy the exact read-only verifier contract",
      expectedReadCount: 0,
    },
    {
      label: "request-comment",
      mutateEnvironment: (environment) => { environment.REQUEST_COMMENT_ID = "123"; },
      expectedReason: "pull_request trigger did not satisfy the exact read-only verifier contract",
      expectedReadCount: 0,
    },
  ];
  for (const scenario of cases) {
    const event = pullRequestEvent();
    scenario.mutateEvent?.(event);
    const environment = runtimeEnvironment(context, {
      suffix: `pull-request-binding-${scenario.label}`,
      event,
    });
    scenario.mutateEnvironment?.(environment);
    const github = createGitHubMock({ issueComments: successEvidence });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, scenario.label);
    assert.notEqual(result.report.gateOutcome, "success", scenario.label);
    assert.equal(result.report.reason, scenario.expectedReason, scenario.label);
    assert.equal(github.calls.length, scenario.expectedReadCount, scenario.label);
    assert.equal(
      github.calls.every(({ method }) => method === "GET"),
      true,
      scenario.label,
    );
    assert.deepEqual(github.statusWrites, [], scenario.label);
    assert.deepEqual(github.requestBodies, [], scenario.label);
    assert.deepEqual(github.rerunRequests, [], scenario.label);
    assert.deepEqual(github.stickyCreates, [], scenario.label);
    assert.deepEqual(github.stickyPatches, [], scenario.label);
  }
});

test("pull_request verifier rejects a changed test-merge commit without retargeting", async (context) => {
  const github = createGitHubMock({ pullRequestOverrides: { merge_commit_sha: NEXT_HEAD } });
  const environment = runtimeEnvironment(context, { suffix: "test-merge-drift" });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "not_applicable");
  assert.equal(result.report.recoveryCode, "refresh_head");
  assert.deepEqual(github.statusWrites, []);
});

test("test-merge drift between complete snapshots invalidates verifier success", async (context) => {
  const github = createGitHubMock({
    issueComments: [ordinaryRequest(), cleanIssueComment(HEAD)],
    pullRequestSequence: [
      {},
      {},
      {},
      { merge_commit_sha: NEXT_HEAD },
    ],
  });
  const environment = runtimeEnvironment(context, { suffix: "test-merge-between-snapshots" });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.notEqual(result.report.gateOutcome, "success");
  assert.equal(result.report.recoveryCode, "refresh_head");
  assert.deepEqual(github.statusWrites, []);
});

test("terminal clean without an authorized request generation cannot pass", async (context) => {
  const github = createGitHubMock({ issueComments: [cleanIssueComment(HEAD)] });
  const environment = runtimeEnvironment(context);
  const { result } = await runGate(environment, github);
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_provider");
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("ordinary writer request queries liveness reactions but never makes reaction-only clean head-bound", async (context) => {
  const ordinary = ordinaryRequest();
  const terminal = cleanIssueComment(HEAD, {
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const terminalGitHub = createGitHubMock({ issueComments: [ordinary, terminal] });
  const terminalEnvironment = runtimeEnvironment(context, { suffix: "ordinary-terminal" });
  const { result: terminalResult } = await runGate(terminalEnvironment, terminalGitHub);
  assert.equal(terminalResult.report.gateOutcome, "success");
  assert.equal(
    terminalGitHub.calls.some((call) => call.path.endsWith(`/commits/${HEAD}`)),
    false,
  );
  assert.equal(
    terminalGitHub.calls.some((call) => call.path.endsWith(`/${ordinary.id}/reactions`)),
    true,
  );

  for (const [suffix, createdAt] of [
    ["ordinary-active-same-time", "2026-08-25T08:02:00Z"],
    ["ordinary-active-later", "2026-08-25T08:03:00Z"],
  ]) {
    const activeGitHub = createGitHubMock({
      issueComments: [ordinary, terminal],
      reactionsByCommentId: new Map([[String(ordinary.id), [reaction({
        content: "eyes",
        created_at: createdAt,
      })]]]),
    });
    const activeEnvironment = runtimeEnvironment(context, { suffix });
    const { result: activeResult } = await runGate(activeEnvironment, activeGitHub);
    assert.equal(activeResult.report.gateOutcome, "pending", suffix);
    assert.equal(activeResult.report.recoveryCode, "wait_provider", suffix);
    assert.match(activeResult.report.reason, /review is still in progress/u, suffix);
  }

  const untrustedEyesGitHub = createGitHubMock({
    issueComments: [ordinary, terminal],
    reactionsByCommentId: new Map([[String(ordinary.id), [reaction({
      content: "eyes",
      created_at: "2026-08-25T08:03:00Z",
      user: HUMAN,
    })]]]),
  });
  const untrustedEyesEnvironment = runtimeEnvironment(context, {
    suffix: "ordinary-untrusted-eyes",
  });
  const { result: untrustedEyesResult } = await runGate(
    untrustedEyesEnvironment,
    untrustedEyesGitHub,
  );
  assert.equal(untrustedEyesResult.report.gateOutcome, "success");

  const reactionGitHub = createGitHubMock({
    issueComments: [ordinary],
    reactionsByCommentId: new Map([[String(ordinary.id), [reaction()]]]),
  });
  const reactionEnvironment = runtimeEnvironment(context, { suffix: "ordinary-reaction" });
  const { result: reactionResult } = await runGate(reactionEnvironment, reactionGitHub);
  assert.equal(reactionResult.report.gateOutcome, "pending");
  assert.equal(
    reactionGitHub.calls.some((call) => call.path.endsWith(`/${ordinary.id}/reactions`)),
    true,
  );
});

test("ordinary request author permission is enforced without letting a 404 commenter DoS", async (context) => {
  const request = ordinaryRequest({ user: READER });
  const terminal = cleanIssueComment(HEAD, {
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const github = createGitHubMock({
    issueComments: [request, terminal],
    permissionByLogin: new Map(),
    permissionMissingLogins: new Set([READER.login]),
  });
  const environment = runtimeEnvironment(context, { suffix: "permission-404" });
  const { result } = await runGate(environment, github);
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(
    github.calls.some((call) => call.path.endsWith(`/${request.id}/reactions`)),
    false,
  );

  const anyGitHub = createGitHubMock({ issueComments: [request, terminal] });
  const anyEnvironment = runtimeEnvironment(context, { suffix: "permission-any" });
  anyEnvironment.CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION = "any";
  const { result: anyResult } = await runGate(anyEnvironment, anyGitHub);
  assert.equal(anyResult.report.gateOutcome, "success");
});

test("a denied exact request remains a lineage boundary without granting clean authority", async (context) => {
  const authorizedA = ordinaryRequest({ id: 101 });
  const deniedU = ordinaryRequest({
    id: 102,
    user: READER,
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const delayedUnboundClean = cleanIssueComment(HEAD, {
    id: 203,
    created_at: "2026-08-25T08:03:00Z",
    updated_at: "2026-08-25T08:03:00Z",
  });
  const permissionByLogin = new Map([
    [HUMAN.login, "write"],
    [READER.login, "read"],
  ]);
  const ambiguousGitHub = createGitHubMock({
    issueComments: [authorizedA, deniedU, delayedUnboundClean],
    permissionByLogin,
  });
  const ambiguousEnvironment = runtimeEnvironment(context, {
    suffix: "denied-request-lineage-boundary",
  });
  const { result: ambiguous } = await runGate(ambiguousEnvironment, ambiguousGitHub);
  assert.equal(ambiguous.exitCode, 1);
  assert.equal(ambiguous.report.gateOutcome, "pending");
  assert.equal(ambiguous.report.recoveryCode, "request_clean_generation");
  assert.match(ambiguous.report.reason, /newer request 102 already existed/iu);
  assert.equal(
    ambiguousGitHub.statusWrites.some(({ state }) => state === "success"),
    false,
  );
  assert.equal(
    ambiguousGitHub.calls.some(({ path }) =>
      path === `/repos/${REPOSITORY}/issues/comments/${deniedU.id}` ||
      path === `/repos/${REPOSITORY}/issues/comments/${deniedU.id}/reactions`
    ),
    false,
    "the denied boundary remains read-only snapshot evidence without extra API fan-out",
  );

  const lateFindingGitHub = createGitHubMock({
    issueComments: [authorizedA, deniedU, delayedUnboundClean],
    reviews: [findingReview(HEAD, { submitted_at: "2026-08-25T08:04:00Z" })],
    permissionByLogin,
  });
  const lateFindingEnvironment = runtimeEnvironment(context, {
    suffix: "denied-request-late-finding",
  });
  const { result: lateFinding } = await runGate(
    lateFindingEnvironment,
    lateFindingGitHub,
  );
  assert.equal(lateFinding.exitCode, 1);
  assert.equal(lateFinding.report.gateOutcome, "failure");
  assert.equal(lateFinding.report.recoveryCode, "fix_findings");
  assert.equal(lateFinding.report.counts.unresolved, 1);
  assert.equal(lateFinding.report.counts.resolved, 0);

  const authorizedB = workflowRequest({
    id: 104,
    body: canonicalRequestBody(HEAD, { runId: "124" }),
    created_at: "2026-08-25T08:04:00Z",
    updated_at: "2026-08-25T08:04:00Z",
  });
  const directRecoveryGitHub = createGitHubMock({
    issueComments: [authorizedA, deniedU, delayedUnboundClean, authorizedB],
    reactionsByCommentId: new Map([["104", [reaction({
      id: 504,
      created_at: "2026-08-25T08:05:00Z",
    })]]]),
    permissionByLogin,
  });
  const directRecoveryEnvironment = runtimeEnvironment(context, {
    suffix: "denied-request-direct-authorized-recovery",
  });
  const { result: directRecovery } = await runGate(
    directRecoveryEnvironment,
    directRecoveryGitHub,
  );
  assert.equal(directRecovery.exitCode, 0);
  assert.equal(directRecovery.report.gateOutcome, "success");
  assert.match(directRecovery.report.reason, /request-reaction 504/u);

  const canonicalA = workflowRequest({
    id: 105,
    body: canonicalRequestBody(HEAD, { runId: "125" }),
  });
  const staleDirectGitHub = createGitHubMock({
    issueComments: [canonicalA, deniedU, delayedUnboundClean],
    reactionsByCommentId: new Map([["105", [reaction({
      id: 505,
      created_at: "2026-08-25T08:01:00Z",
    })]]]),
    permissionByLogin,
  });
  const staleDirectEnvironment = runtimeEnvironment(context, {
    suffix: "denied-request-after-direct-clean",
  });
  const { result: staleDirect } = await runGate(staleDirectEnvironment, staleDirectGitHub);
  assert.equal(staleDirect.exitCode, 1);
  assert.equal(staleDirect.report.gateOutcome, "pending");
  assert.equal(staleDirect.report.recoveryCode, "request_clean_generation");
  assert.match(staleDirect.report.reason, /predates later review-request boundary 102/iu);

  const refreshedDirectGitHub = createGitHubMock({
    issueComments: [canonicalA, deniedU, delayedUnboundClean],
    reactionsByCommentId: new Map([["105", [
      reaction({ id: 505, created_at: "2026-08-25T08:01:00Z" }),
      reaction({ id: 506, created_at: "2026-08-25T08:04:00Z" }),
    ]]]),
    permissionByLogin,
  });
  const refreshedDirectEnvironment = runtimeEnvironment(context, {
    suffix: "denied-request-before-refreshed-direct-clean",
  });
  const { result: refreshedDirect } = await runGate(
    refreshedDirectEnvironment,
    refreshedDirectGitHub,
  );
  assert.equal(refreshedDirect.exitCode, 0);
  assert.equal(refreshedDirect.report.gateOutcome, "success");
  assert.match(refreshedDirect.report.reason, /request-reaction 506/u);
});

test("authority filtering caches permissions and avoids exact-refetch DoS", async (context) => {
  const deniedRequests = Array.from({ length: 70 }, (_, index) => {
    const id = 1_000 + index;
    return ordinaryRequest({
      id,
      html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-${id}`,
      user: READER,
    });
  });
  const terminalClean = cleanIssueComment(HEAD, {
    id: 2_000,
    created_at: "2026-08-25T08:15:00Z",
    updated_at: "2026-08-25T08:15:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-2000`,
  });
  const deniedGitHub = createGitHubMock({
    issueComments: [...deniedRequests, terminalClean],
    permissionByLogin: new Map([[READER.login, "read"]]),
  });
  const deniedEnvironment = runtimeEnvironment(context, {
    suffix: "denied-request-refetch-budget",
  });
  const { result: deniedResult } = await runGate(deniedEnvironment, deniedGitHub);
  assert.equal(deniedResult.exitCode, 1);
  assert.equal(deniedResult.report.executionHealth, "healthy");
  assert.equal(deniedResult.report.gateOutcome, "pending");
  assert.equal(deniedGitHub.statusWrites.some(({ state }) => state === "success"), false);
  assert.equal(
    deniedGitHub.calls.filter(({ path }) =>
      path.includes(`/${READER.login}/`) && path.endsWith("/permission")
    ).length,
    2,
    "opening and closing each cache more than 61 denied requests in one permission lookup",
  );
  for (const denied of deniedRequests) {
    assert.equal(
      deniedGitHub.calls.some(({ path }) =>
        path === `/repos/${REPOSITORY}/issues/comments/${denied.id}`
      ),
      false,
      `denied request ${denied.id} must not be exact-refetched`,
    );
    assert.equal(
      deniedGitHub.calls.some(({ path }) =>
        path === `/repos/${REPOSITORY}/issues/comments/${denied.id}/reactions`
      ),
      false,
      `denied request ${denied.id} must not consume reaction budget`,
    );
  }
  assert.equal(
    deniedGitHub.calls.filter(({ path }) =>
      path === `/repos/${REPOSITORY}/issues/comments/${terminalClean.id}`
    ).length,
    2,
    "provider terminal evidence remains exact-refetched in opening and closing",
  );

  const canonical = workflowRequest({
    id: 2_001,
    created_at: "2026-08-25T08:10:00Z",
    updated_at: "2026-08-25T08:10:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-2001`,
  });
  const authorizedOrdinary = ordinaryRequest({
    id: 2_002,
    created_at: "2026-08-25T08:11:00Z",
    updated_at: "2026-08-25T08:11:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-2002`,
  });
  const providerProgress = progressIssueComment({
    id: 2_003,
    created_at: "2026-08-25T08:12:00Z",
    updated_at: "2026-08-25T08:12:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-2003`,
  });
  const authoritativeGitHub = createGitHubMock({
    issueComments: [canonical, authorizedOrdinary, providerProgress],
    permissionByLogin: new Map([[HUMAN.login, "write"]]),
  });
  const authoritativeEnvironment = runtimeEnvironment(context, {
    suffix: "authoritative-refetch-scope",
  });
  const { result: authoritativeResult } = await runGate(
    authoritativeEnvironment,
    authoritativeGitHub,
  );
  assert.equal(authoritativeResult.exitCode, 1);
  assert.equal(authoritativeResult.report.executionHealth, "healthy");
  assert.equal(authoritativeResult.report.gateOutcome, "pending");

  const permissionCalls = authoritativeGitHub.calls.filter(({ path }) =>
    path.includes("/collaborators/") && path.endsWith("/permission")
  );
  assert.equal(
    permissionCalls.filter(({ path }) => path.includes(`/${HUMAN.login}/`)).length,
    2,
    "the authorized login is queried once per opening and closing projection",
  );
  for (const expected of [canonical, authorizedOrdinary, providerProgress]) {
    assert.equal(
      authoritativeGitHub.calls.filter(({ path }) =>
        path === `/repos/${REPOSITORY}/issues/comments/${expected.id}`
      ).length,
      2,
      `authoritative comment ${expected.id} is exact-refetched in opening and closing`,
    );
  }
});

test("newer authorized generation prevents reuse of older canonical +1", async (context) => {
  const oldRequest = workflowRequest({ id: 101 });
  const newer = workflowRequest({
    id: 102,
    body: canonicalRequestBody(HEAD, { runId: "124" }),
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const github = createGitHubMock({
    issueComments: [oldRequest, newer],
    reactionsByCommentId: new Map([["101", [reaction()]]]),
  });
  const environment = runtimeEnvironment(context);
  const { result } = await runGate(environment, github);
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_provider");
});

test("a delayed terminal clean from generation A cannot satisfy overlapping generation B", async (context) => {
  const generationA = workflowRequest({ id: 101 });
  const generationB = workflowRequest({
    id: 102,
    body: canonicalRequestBody(HEAD, { runId: "124" }),
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const delayedCleanFromA = cleanIssueComment(HEAD.slice(0, 10), {
    id: 203,
    created_at: "2026-08-25T08:04:00Z",
    updated_at: "2026-08-25T08:04:00Z",
  });
  const overlappingReactions = new Map([
    ["101", [reaction({
      id: 501,
      content: "eyes",
      created_at: "2026-08-25T08:01:00Z",
    })]],
    ["102", [reaction({
      id: 502,
      content: "eyes",
      created_at: "2026-08-25T08:03:00Z",
    })]],
  ]);
  const ambiguousGitHub = createGitHubMock({
    issueComments: [generationA, generationB, delayedCleanFromA],
    reactionsByCommentId: overlappingReactions,
  });
  const ambiguousEnvironment = runtimeEnvironment(context, {
    suffix: "overlapping-generation-delayed-clean",
  });
  const { result: ambiguous } = await runGate(ambiguousEnvironment, ambiguousGitHub);
  assert.equal(ambiguous.exitCode, 1);
  assert.equal(ambiguous.report.gateOutcome, "pending");
  assert.equal(ambiguous.report.recoveryCode, "request_clean_generation");
  assert.equal(ambiguous.report.counts.indeterminate, 1);
  assert.match(
    ambiguous.report.reason,
    /earlier request 101 had no terminal provider result before newer request 102/iu,
  );
  assert.equal(
    ambiguousGitHub.statusWrites.some(({ state }) => state === "success"),
    false,
  );
  assert.ok(
    ambiguousGitHub.calls.some(({ path }) =>
      path.endsWith(`/commits/${HEAD.slice(0, 10)}`)
    ),
    "the short commit still resolves exactly before lineage admission",
  );

  const unresolvedFindingGitHub = createGitHubMock({
    issueComments: [generationA, generationB, delayedCleanFromA],
    reviews: [findingReview(HEAD, {
      submitted_at: "2026-08-25T07:59:00Z",
    })],
    reactionsByCommentId: overlappingReactions,
  });
  const unresolvedFindingEnvironment = runtimeEnvironment(context, {
    suffix: "overlapping-generation-preserves-finding",
  });
  const { result: unresolvedFinding } = await runGate(
    unresolvedFindingEnvironment,
    unresolvedFindingGitHub,
  );
  assert.equal(unresolvedFinding.exitCode, 1);
  assert.equal(unresolvedFinding.report.gateOutcome, "failure");
  assert.equal(unresolvedFinding.report.recoveryCode, "fix_findings");
  assert.equal(unresolvedFinding.report.counts.unresolved, 1);
  assert.equal(unresolvedFinding.report.counts.resolved, 0);
  assert.equal(
    unresolvedFindingGitHub.statusWrites.some(({ state }) => state === "success"),
    false,
  );

  const directlyBoundGitHub = createGitHubMock({
    issueComments: [generationA, generationB, delayedCleanFromA],
    reactionsByCommentId: new Map([
      ...overlappingReactions,
      ["102", [
        ...overlappingReactions.get("102"),
        reaction({ id: 503, created_at: "2026-08-25T08:05:00Z" }),
      ]],
    ]),
  });
  const directlyBoundEnvironment = runtimeEnvironment(context, {
    suffix: "overlapping-generation-direct-plus-one",
  });
  const { result: directlyBound } = await runGate(
    directlyBoundEnvironment,
    directlyBoundGitHub,
  );
  assert.equal(directlyBound.exitCode, 0);
  assert.equal(directlyBound.report.gateOutcome, "success");
  assert.match(directlyBound.report.reason, /request-reaction 503/u);

  const earlierDirectBindingGitHub = createGitHubMock({
    issueComments: [generationA, generationB, delayedCleanFromA],
    reactionsByCommentId: new Map([
      ["101", [reaction({
        id: 507,
        content: "eyes",
        created_at: "2026-08-25T08:01:00Z",
      })]],
      ["102", [
        reaction({
          id: 508,
          content: "eyes",
          created_at: "2026-08-25T08:02:30Z",
        }),
        reaction({ id: 509, created_at: "2026-08-25T08:03:00Z" }),
      ]],
    ]),
  });
  const earlierDirectBindingEnvironment = runtimeEnvironment(context, {
    suffix: "overlapping-generation-early-direct-plus-one",
  });
  const { result: earlierDirectBinding } = await runGate(
    earlierDirectBindingEnvironment,
    earlierDirectBindingGitHub,
  );
  assert.equal(earlierDirectBinding.exitCode, 0);
  assert.equal(earlierDirectBinding.report.gateOutcome, "success");
  assert.match(earlierDirectBinding.report.reason, /request-reaction 509/u);

  const predecessorClosedGitHub = createGitHubMock({
    issueComments: [generationA, generationB, delayedCleanFromA],
    reactionsByCommentId: new Map([
      ["101", [reaction({ id: 504, created_at: "2026-08-25T08:01:00Z" })]],
      ["102", [reaction({
        id: 505,
        content: "eyes",
        created_at: "2026-08-25T08:03:00Z",
      })]],
    ]),
  });
  const predecessorClosedEnvironment = runtimeEnvironment(context, {
    suffix: "prior-generation-direct-plus-one",
  });
  const { result: predecessorClosed } = await runGate(
    predecessorClosedEnvironment,
    predecessorClosedGitHub,
  );
  assert.equal(predecessorClosed.exitCode, 0);
  assert.equal(predecessorClosed.report.gateOutcome, "success");
  assert.match(predecessorClosed.report.reason, /issue-comment 203/u);

  const completedGenerationA = cleanIssueComment(HEAD, {
    id: 202,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
  });
  const providerClosedGitHub = createGitHubMock({
    issueComments: [
      generationA,
      completedGenerationA,
      generationB,
      delayedCleanFromA,
    ],
    reactionsByCommentId: new Map([["102", [reaction({
      id: 506,
      content: "eyes",
      created_at: "2026-08-25T08:03:00Z",
    })]]]),
  });
  const providerClosedEnvironment = runtimeEnvironment(context, {
    suffix: "prior-generation-provider-terminal",
  });
  const { result: providerClosed } = await runGate(
    providerClosedEnvironment,
    providerClosedGitHub,
  );
  assert.equal(providerClosed.exitCode, 0);
  assert.equal(providerClosed.report.gateOutcome, "success");
  assert.match(providerClosed.report.reason, /issue-comment 203/u);

  const equalBoundaryGitHub = createGitHubMock({
    issueComments: [
      generationA,
      cleanIssueComment(HEAD, {
        id: 202,
        created_at: generationB.created_at,
        updated_at: generationB.updated_at,
      }),
      generationB,
      delayedCleanFromA,
    ],
  });
  const equalBoundaryEnvironment = runtimeEnvironment(context, {
    suffix: "generation-lineage-equal-boundary",
  });
  const { result: equalBoundary } = await runGate(
    equalBoundaryEnvironment,
    equalBoundaryGitHub,
  );
  assert.equal(equalBoundary.exitCode, 1);
  assert.equal(equalBoundary.report.gateOutcome, "pending");
  assert.equal(equalBoundary.report.recoveryCode, "request_clean_generation");
});

test("short Reviewed commit is accepted only through GitHub unambiguous resolution", async (context) => {
  const request = ordinaryRequest();
  const short = HEAD.slice(0, 10);
  const terminal = cleanIssueComment(short, {
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const github = createGitHubMock({ issueComments: [request, terminal] });
  const environment = runtimeEnvironment(context, { suffix: "short-resolved" });
  const { result } = await runGate(environment, github);
  assert.equal(result.report.gateOutcome, "success");
  assert.ok(github.calls.some((call) => call.path.endsWith(`/commits/${short}`)));

  const ambiguousGitHub = createGitHubMock({
    issueComments: [request, terminal],
    commitResolution: () => ({ status: 422, message: "short SHA is ambiguous" }),
  });
  const ambiguousEnvironment = runtimeEnvironment(context, { suffix: "short-ambiguous" });
  const { result: ambiguous } = await runGate(ambiguousEnvironment, ambiguousGitHub);
  assert.equal(ambiguous.report.gateOutcome, "pending");
  assert.equal(ambiguous.report.recoveryCode, "request_clean_generation");
  assert.equal(ambiguous.report.counts.indeterminate > 0, true);

  const redirectedRef = NEXT_HEAD.slice(0, 10);
  const redirectedTerminal = cleanIssueComment(redirectedRef, {
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const redirectedGitHub = createGitHubMock({
    issueComments: [request, redirectedTerminal],
    commitResolution: () => ({ data: { sha: HEAD } }),
  });
  const redirectedEnvironment = runtimeEnvironment(context, {
    suffix: "short-branch-tag-redirect",
  });
  const { result: redirected } = await runGate(redirectedEnvironment, redirectedGitHub);
  assert.equal(redirected.report.gateOutcome, "pending");
  assert.equal(redirected.report.recoveryCode, "request_clean_generation");
  assert.equal(redirected.report.counts.indeterminate > 0, true);
  assert.equal(
    redirectedGitHub.calls.some((call) =>
      call.path.endsWith(`/commits/${redirectedRef}`)),
    true,
  );
});

test("approved review short commit also requires GitHub resolution and native commit agreement", async (context) => {
  const short = HEAD.slice(0, 10);
  const resolvedGitHub = createGitHubMock({
    issueComments: [ordinaryRequest()],
    reviews: [approvedReview(short)],
  });
  const resolvedEnvironment = runtimeEnvironment(context, { suffix: "approved-short" });
  const { result: resolved } = await runGate(resolvedEnvironment, resolvedGitHub);
  assert.equal(resolved.report.gateOutcome, "success");
  assert.ok(resolvedGitHub.calls.some((call) => call.path.endsWith(`/commits/${short}`)));

  const ambiguousGitHub = createGitHubMock({
    issueComments: [ordinaryRequest()],
    reviews: [approvedReview(short)],
    commitResolution: () => ({ status: 422, message: "short SHA is ambiguous" }),
  });
  const ambiguousEnvironment = runtimeEnvironment(context, {
    suffix: "approved-short-ambiguous",
  });
  const { result: ambiguous } = await runGate(ambiguousEnvironment, ambiguousGitHub);
  assert.equal(ambiguous.report.gateOutcome, "pending");
  assert.equal(ambiguous.report.recoveryCode, "request_clean_generation");
  assert.equal(ambiguous.report.counts.indeterminate > 0, true);
});

test("same-head finding remains blocking after clean from the same generation", async (context) => {
  const github = createGitHubMock({
    issueComments: [
      ordinaryRequest(),
      cleanIssueComment(HEAD, {
        created_at: "2026-08-25T08:06:00Z",
        updated_at: "2026-08-25T08:06:00Z",
      }),
    ],
    reviews: [findingReview(HEAD, { submitted_at: "2026-08-25T08:05:00Z" })],
  });
  const environment = runtimeEnvironment(context);
  const { result } = await runGate(environment, github);
  assert.equal(result.report.gateOutcome, "failure");
  assert.equal(result.report.recoveryCode, "fix_findings");
  assert.deepEqual(result.report.counts, {
    unresolved: 1,
    resolved: 0,
    historical: 0,
    indeterminate: 0,
  });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(github.statusWrites, []);
});

test("finding supersession requires a strictly newer authorized generation and later head-bound clean", async (context) => {
  const first = ordinaryRequest({ id: 101 });
  const second = ordinaryRequest({
    id: 102,
    created_at: "2026-08-25T08:10:00Z",
    updated_at: "2026-08-25T08:10:00Z",
  });
  const clean = cleanIssueComment(HEAD, {
    id: 203,
    created_at: "2026-08-25T08:15:00Z",
    updated_at: "2026-08-25T08:15:00Z",
  });
  const github = createGitHubMock({
    issueComments: [first, second, clean],
    reviews: [findingReview(HEAD, { submitted_at: "2026-08-25T08:05:00Z" })],
  });
  const environment = runtimeEnvironment(context, { suffix: "superseded" });
  const { result } = await runGate(environment, github);
  assert.equal(result.report.gateOutcome, "success");
  assert.deepEqual(result.report.counts, {
    unresolved: 0,
    resolved: 1,
    historical: 0,
    indeterminate: 0,
  });

  const noCleanGitHub = createGitHubMock({
    issueComments: [first, second],
    reviews: [findingReview(HEAD, { submitted_at: "2026-08-25T08:05:00Z" })],
  });
  const noCleanEnvironment = runtimeEnvironment(context, { suffix: "not-superseded" });
  const { result: noClean } = await runGate(noCleanEnvironment, noCleanGitHub);
  assert.equal(noClean.report.gateOutcome, "failure");
  assert.equal(noClean.report.counts.unresolved, 1);
});

test("a strict later generation can supersede an older cross-channel timestamp ambiguity", async (context) => {
  const laterGeneration = ordinaryRequest({
    id: 102,
    created_at: "2026-08-25T08:10:00Z",
    updated_at: "2026-08-25T08:10:00Z",
  });
  const laterClean = cleanIssueComment(HEAD, {
    id: 203,
    created_at: "2026-08-25T08:15:00Z",
    updated_at: "2026-08-25T08:15:00Z",
  });
  const github = createGitHubMock({
    issueComments: [
      ordinaryRequest(),
      findingIssueComment(HEAD, {
        created_at: "2026-08-25T08:05:00.100Z",
        updated_at: "2026-08-25T08:05:00.100Z",
      }),
      laterGeneration,
      laterClean,
    ],
    reviews: [findingReview(HEAD, { submitted_at: "2026-08-25T08:05:00.900Z" })],
  });
  const environment = runtimeEnvironment(context, { suffix: "old-channel-conflict" });
  const { result } = await runGate(environment, github);
  assert.equal(result.report.gateOutcome, "success");
  assert.deepEqual(result.report.counts, {
    unresolved: 0,
    resolved: 2,
    historical: 0,
    indeterminate: 1,
  });
});

test("a current cross-channel timestamp ambiguity cannot publish success", async (context) => {
  const issueClean = cleanIssueComment(HEAD, {
    created_at: "2026-08-25T08:05:00.100Z",
    updated_at: "2026-08-25T08:05:00.100Z",
  });
  const reviewClean = approvedReview(HEAD, {
    submitted_at: "2026-08-25T08:05:00.900Z",
  });
  const github = createGitHubMock({
    issueComments: [ordinaryRequest(), issueClean],
    reviews: [reviewClean],
  });
  const environment = runtimeEnvironment(context, { suffix: "current-channel-conflict" });
  const { result } = await runGate(environment, github);
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "request_clean_generation");
  assert.equal(result.report.counts.indeterminate, 1);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("historical findings are counted without being silently treated as current", async (context) => {
  const github = createGitHubMock({
    issueComments: [
      ordinaryRequest(),
      cleanIssueComment(HEAD, {
        created_at: "2026-08-25T08:10:00Z",
        updated_at: "2026-08-25T08:10:00Z",
      }),
    ],
    reviews: [findingReview(OLD_HEAD, { submitted_at: "2026-08-25T08:05:00Z" })],
  });
  const environment = runtimeEnvironment(context);
  const { result } = await runGate(environment, github);
  assert.equal(result.report.gateOutcome, "success");
  assert.equal(result.report.counts.historical, 1);
  assert.match(
    readFileSync(environment.GITHUB_STEP_SUMMARY, "utf8"),
    /1 historical/u,
  );
});

test("malformed provider terminal evidence is indeterminate and cannot pass", async (context) => {
  const malformed = cleanIssueComment(HEAD, {
    body: "Codex Review: Didn't find any major issues.",
  });
  const github = createGitHubMock({ issueComments: [ordinaryRequest(), malformed] });
  const environment = runtimeEnvironment(context);
  const { result } = await runGate(environment, github);
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "request_clean_generation");
  assert.equal(result.report.counts.indeterminate > 0, true);
});

test("older malformed and provider-identity errors become historical after a strict clean generation", async (context) => {
  const malformed = cleanIssueComment(HEAD, {
    id: 201,
    body: "Codex Review: Didn't find any major issues.",
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
  });
  const invalidProvider = cleanIssueComment(HEAD, {
    id: 202,
    performed_via_github_app: { slug: "wrong-provider" },
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const generation = ordinaryRequest({
    id: 103,
    created_at: "2026-08-25T08:10:00Z",
    updated_at: "2026-08-25T08:10:00Z",
  });
  const clean = cleanIssueComment(HEAD, {
    id: 203,
    created_at: "2026-08-25T08:15:00Z",
    updated_at: "2026-08-25T08:15:00Z",
  });
  const github = createGitHubMock({
    issueComments: [malformed, invalidProvider, generation, clean],
  });
  const environment = runtimeEnvironment(context, { suffix: "historical-malformed" });
  const { result } = await runGate(environment, github);
  assert.equal(result.report.gateOutcome, "success");
  assert.equal(result.report.counts.indeterminate, 2);
});

test("old-head malformed review errors can recover but current-generation provider errors cannot pass", async (context) => {
  const oldHeadMalformed = findingReview(OLD_HEAD, {
    id: 400,
    body: "Unrecognized terminal review body",
    submitted_at: "2026-08-25T08:01:00Z",
  });
  const oldHeadInvalidProvider = findingReview(OLD_HEAD, {
    id: 401,
    performed_via_github_app: { slug: "wrong-provider" },
    submitted_at: "2026-08-25T08:02:00Z",
  });
  const generation = ordinaryRequest({
    id: 103,
    created_at: "2026-08-25T08:10:00Z",
    updated_at: "2026-08-25T08:10:00Z",
  });
  const clean = cleanIssueComment(HEAD, {
    id: 203,
    created_at: "2026-08-25T08:15:00Z",
    updated_at: "2026-08-25T08:15:00Z",
  });
  const recoveredGitHub = createGitHubMock({
    issueComments: [generation, clean],
    reviews: [oldHeadMalformed, oldHeadInvalidProvider],
  });
  const recoveredEnvironment = runtimeEnvironment(context, {
    suffix: "old-head-malformed-recovered",
  });
  const { result: recovered } = await runGate(recoveredEnvironment, recoveredGitHub);
  assert.equal(recovered.report.gateOutcome, "success");
  assert.equal(recovered.report.counts.indeterminate, 2);

  const currentGenerationError = cleanIssueComment(HEAD, {
    id: 204,
    performed_via_github_app: { slug: "wrong-provider" },
    created_at: "2026-08-25T08:12:00Z",
    updated_at: "2026-08-25T08:12:00Z",
  });
  const blockedGitHub = createGitHubMock({
    issueComments: [generation, currentGenerationError, clean],
  });
  const blockedEnvironment = runtimeEnvironment(context, {
    suffix: "current-generation-provider-error",
  });
  const { result: blocked } = await runGate(blockedEnvironment, blockedGitHub);
  assert.equal(blocked.report.gateOutcome, "pending");
  assert.equal(blocked.report.recoveryCode, "request_clean_generation");
  assert.equal(blocked.report.counts.indeterminate, 1);
});

test("later eyes or progress prevents a clean from superseding an older finding", async (context) => {
  const generation = workflowRequest({
    id: 102,
    body: canonicalRequestBody(HEAD, { runId: "124" }),
    created_at: "2026-08-25T08:10:00Z",
    updated_at: "2026-08-25T08:10:00Z",
  });
  const clean = cleanIssueComment(HEAD, {
    id: 203,
    created_at: "2026-08-25T08:15:00Z",
    updated_at: "2026-08-25T08:15:00Z",
  });
  const finding = findingReview(HEAD, { submitted_at: "2026-08-25T08:05:00Z" });

  const eyesGitHub = createGitHubMock({
    issueComments: [generation, clean],
    reviews: [finding],
    reactionsByCommentId: new Map([["102", [reaction({
      id: 502,
      content: "eyes",
      created_at: "2026-08-25T08:16:00Z",
    })]]]),
  });
  const eyesEnvironment = runtimeEnvironment(context, { suffix: "supersession-eyes" });
  const { result: eyesResult } = await runGate(eyesEnvironment, eyesGitHub);
  assert.equal(eyesResult.report.gateOutcome, "failure");
  assert.equal(eyesResult.report.counts.unresolved, 1);
  assert.equal(eyesResult.report.counts.resolved, 0);

  const ordinaryGeneration = ordinaryRequest({
    id: 103,
    created_at: "2026-08-25T08:10:00Z",
    updated_at: "2026-08-25T08:10:00Z",
  });
  const ordinaryEyesGitHub = createGitHubMock({
    issueComments: [ordinaryGeneration, clean],
    reviews: [finding],
    reactionsByCommentId: new Map([[String(ordinaryGeneration.id), [reaction({
      id: 503,
      content: "eyes",
      created_at: "2026-08-25T08:16:00Z",
    })]]]),
  });
  const ordinaryEyesEnvironment = runtimeEnvironment(context, {
    suffix: "ordinary-supersession-eyes",
  });
  const { result: ordinaryEyesResult } = await runGate(
    ordinaryEyesEnvironment,
    ordinaryEyesGitHub,
  );
  assert.equal(ordinaryEyesResult.report.gateOutcome, "failure");
  assert.equal(ordinaryEyesResult.report.recoveryCode, "fix_findings");
  assert.equal(ordinaryEyesResult.report.counts.unresolved, 1);
  assert.equal(ordinaryEyesResult.report.counts.resolved, 0);

  const progressGitHub = createGitHubMock({
    issueComments: [generation, clean, progressIssueComment()],
    reviews: [finding],
  });
  const progressEnvironment = runtimeEnvironment(context, { suffix: "supersession-progress" });
  const { result: progressResult } = await runGate(progressEnvironment, progressGitHub);
  assert.equal(progressResult.report.gateOutcome, "failure");
  assert.equal(progressResult.report.counts.unresolved, 1);
  assert.equal(progressResult.report.counts.resolved, 0);
});

test("exact-refetch drift and continuously changing clean snapshots remain unhealthy pending", async (context) => {
  const request = ordinaryRequest();
  const clean = cleanIssueComment(HEAD, {
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const refetchGitHub = createGitHubMock({
    issueComments: [request, clean],
    commentRefetchMutator: (comment) => comment.id === clean.id
      ? { ...comment, body: `${comment.body}\nchanged` }
      : comment,
  });
  const refetchEnvironment = runtimeEnvironment(context, { suffix: "refetch-drift" });
  const { result: refetch } = await runGate(refetchEnvironment, refetchGitHub, {
    stabilityWindowMs: 3,
  });
  assert.equal(refetch.exitCode, 1);
  assert.equal(refetch.report.executionHealth, "unhealthy");
  assert.equal(refetch.report.gateOutcome, "pending");
  assert.equal(refetch.report.recoveryCode, "wait_then_reconcile");

  const changing = [1, 2, 3, 4].map((id) => [
    request,
    cleanIssueComment(HEAD, {
      id: 300 + id,
      created_at: `2026-08-25T08:0${id + 1}:00Z`,
      updated_at: `2026-08-25T08:0${id + 1}:00Z`,
    }),
  ]);
  const changingGitHub = createGitHubMock({ issueCommentSnapshots: changing });
  const changingEnvironment = runtimeEnvironment(context, { suffix: "changing-clean" });
  const { result: unstable } = await runGate(changingEnvironment, changingGitHub, {
    stabilityWindowMs: 3,
  });
  assert.equal(unstable.exitCode, 1);
  assert.equal(unstable.report.recoveryCode, "wait_then_reconcile");
  assert.equal(changingGitHub.statusWrites.some(({ state }) => state === "success"), false);
});

test("snapshot closing reread catches late reviews, reactions, and provider edits", async (context) => {
  const request = ordinaryRequest();
  const clean = cleanIssueComment(HEAD, {
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const cases = [
    {
      suffix: "closing-late-finding-review",
      github: createGitHubMock({
        issueComments: [request, clean],
        reviewSnapshots: [[], [findingReview(HEAD, {
          submitted_at: "2026-08-25T08:03:00Z",
        })]],
      }),
    },
    {
      suffix: "closing-later-eyes",
      github: createGitHubMock({
        issueComments: [request, clean],
        reactionSnapshotsByCommentId: new Map([[String(request.id), [[], [reaction({
          content: "eyes",
          created_at: "2026-08-25T08:03:00Z",
        })]]]]),
      }),
    },
    {
      suffix: "closing-provider-comment-edit",
      github: createGitHubMock({
        issueCommentSnapshots: [
          [request, clean],
          [request, {
            ...clean,
            body: `${clean.body}\n\nLate provider edit`,
            updated_at: "2026-08-25T08:03:00Z",
          }],
        ],
      }),
    },
  ];

  for (const { suffix, github } of cases) {
    const environment = runtimeEnvironment(context, { suffix });
    const { result } = await runGate(environment, github, { stabilityWindowMs: 1 });
    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.executionHealth, "unhealthy", suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "wait_then_reconcile", suffix);
    assert.equal(
      github.statusWrites.some(({ state }) => state === "success"),
      false,
      suffix,
    );
  }
});

test("fixed default and expanded profiles fail closed at aggregate snapshot caps", async (context) => {
  const defaultComments = Array.from({ length: 2_100 }, (_, index) =>
    genericComment(index + 1));
  const defaultGitHub = createGitHubMock({ issueComments: defaultComments });
  const defaultEnvironment = runtimeEnvironment(context, { suffix: "default-cap" });
  const { result: defaultResult } = await runGate(defaultEnvironment, defaultGitHub);
  assert.equal(defaultResult.exitCode, 1);
  assert.equal(defaultResult.report.executionHealth, "unhealthy");
  assert.equal(defaultResult.report.gateOutcome, "pending");
  assert.equal(defaultResult.report.recoveryCode, "use_expanded_limits");

  const expandedComments = Array.from({ length: 10_100 }, (_, index) =>
    genericComment(index + 1));
  const expandedGitHub = createGitHubMock({ issueComments: expandedComments });
  const expandedEnvironment = runtimeEnvironment(context, { suffix: "expanded-cap" });
  expandedEnvironment.LIMITS_PROFILE = "expanded";
  const { result: expandedResult } = await runGate(expandedEnvironment, expandedGitHub);
  assert.equal(expandedResult.exitCode, 1);
  assert.equal(expandedResult.report.recoveryCode, "raise_protected_limit");
});

test("unsupported scope is unhealthy/not_applicable and receives no status write", async (context) => {
  for (const [suffix, mockOptions, environmentOptions, mutateEnvironment] of [
    ["fork", { pullRequestOverrides: {
      head: { repo: { id: 99, full_name: "someone/fork" } },
    } }, {}],
    ["draft", { pullRequestOverrides: { draft: true } }, {}],
    ["base", { pullRequestOverrides: { base: { ref: "release" } } }, {}],
    ["ghes", {}, { serverUrl: "https://ghe.example.test" }],
    ["windows", {}, {}, (environment) => { environment.RUNNER_OS = "Windows"; }],
    ["self-hosted", {}, {}, (environment) => {
      environment.RUNNER_ENVIRONMENT = "self-hosted";
    }],
  ]) {
    const github = createGitHubMock(mockOptions);
    const environment = runtimeEnvironment(context, { suffix, ...environmentOptions });
    mutateEnvironment?.(environment);
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.executionHealth, "unhealthy", suffix);
    assert.equal(result.report.gateOutcome, "not_applicable", suffix);
    assert.equal(result.report.recoveryCode, "unsupported_target", suffix);
    assert.deepEqual(github.statusWrites, [], suffix);
  }
});

test("begin-review posts one exact same-run marker, adopts it on rerun, and supports request_review=false", async (context) => {
  const github = createGitHubMock();
  const environment = runtimeEnvironment(context, {
    suffix: "begin",
    operation: "begin-review",
  });
  assert.equal(environment.REQUEST_REVIEW_INPUT, "true");
  assert.equal(
    JSON.parse(readFileSync(environment.GITHUB_EVENT_PATH, "utf8")).inputs.request_review,
    true,
  );
  const { result } = await runGate(environment, github);
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_provider");
  assert.deepEqual(github.requestBodies, [canonicalRequestBody()]);
  assert.deepEqual(parseCanonicalV2ReviewRequestBody(github.requestBodies[0]), {
    version: 2,
    repositoryId: String(REPO_ID),
    prNumber: String(PR),
    headSha: HEAD,
    baseSha: BASE,
    baseRef: "main",
    baseRepositoryId: String(REPO_ID),
    runId: "123",
  });

  const rerunEnvironment = runtimeEnvironment(context, {
    suffix: "begin-rerun",
    operation: "begin-review",
  });
  const { result: rerun } = await runGate(rerunEnvironment, github);
  assert.equal(rerun.report.gateOutcome, "pending");
  assert.equal(github.requestBodies.length, 1);

  const disabledGitHub = createGitHubMock();
  const disabledEnvironment = runtimeEnvironment(context, {
    suffix: "begin-disabled",
    operation: "begin-review",
    requestReview: "false",
  });
  assert.equal(
    JSON.parse(readFileSync(disabledEnvironment.GITHUB_EVENT_PATH, "utf8"))
      .inputs.request_review,
    false,
  );
  const { result: disabled } = await runGate(disabledEnvironment, disabledGitHub);
  assert.equal(disabled.report.gateOutcome, "pending");
  assert.deepEqual(disabledGitHub.requestBodies, []);
});

test("unknown begin-review POST is reconciled by exact same-run reread without duplication", async (context) => {
  const github = createGitHubMock({ postUnknownAfterCreate: true });
  const environment = runtimeEnvironment(context, {
    suffix: "begin-unknown",
    operation: "begin-review",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_provider");
  assert.equal(result.report.retrySafe, false);
  assert.equal(github.requestBodies.length, 1);
});

for (const postUnknownReread of ["hidden", "failure"]) {
  test(`unknown begin-review POST with ${postUnknownReread} visibility is not immediately retry-safe`, async (context) => {
    const github = createGitHubMock({
      postUnknownAfterCreate: true,
      postUnknownReread,
    });
    const environment = runtimeEnvironment(context, {
      suffix: `begin-unknown-${postUnknownReread}`,
      operation: "begin-review",
    });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1);
    assert.equal(result.report.executionHealth, "unhealthy");
    assert.equal(result.report.gateOutcome, "pending");
    assert.equal(result.report.recoveryCode, "retry_begin");
    assert.equal(result.report.retrySafe, false);
    assert.equal(github.requestBodies.length, 1);
    assert.deepEqual(github.statusWrites, []);
    const summary = readFileSync(environment.GITHUB_STEP_SUMMARY, "utf8");
    assert.match(summary, /Wait for the exact same-run request marker to settle/u);
    assert.match(summary, /rerun the original workflow run/u);
    assert.doesNotMatch(summary, /Retry the identical begin-review invocation/u);
  });
}

test("begin-review pre-POST safe-read exhaustion is a safe retry of begin", async (context) => {
  let commentReads = 0;
  const github = createGitHubMock({
    requestInterceptor: ({ method, path }) => {
      if (
        method === "GET" &&
        path === `/repos/${REPOSITORY}/issues/${PR}/comments`
      ) {
        commentReads += 1;
        if (commentReads <= 3) {
          return jsonResponse({ message: "synthetic pre-POST read failure" }, 502);
        }
      }
      return undefined;
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "begin-pre-post-safe-read-exhausted",
    operation: "begin-review",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "retry_begin");
  assert.equal(result.report.retrySafe, true);
  assert.equal(github.requestBodies.length, 0);
  assert.equal(github.stickyCreates.length, 1);
  const summary = readFileSync(environment.GITHUB_STEP_SUMMARY, "utf8");
  for (const diagnostic of [summary, github.stickyCreates[0]]) {
    assert.match(diagnostic, /Retry the identical exact-head begin-review invocation/u);
    assert.doesNotMatch(diagnostic, /Wait for the exact same-run request marker/u);
  }
});

test("begin-review keeps every post-attempt verification failure retry-unsafe", async (context) => {
  const pullRequestPath = `/repos/${REPOSITORY}/pulls/${PR}`;
  const cases = [
    {
      suffix: "begin-unknown-scope-read-failure",
      options: (() => {
        let pullRequestReads = 0;
        return {
          postUnknownAfterCreate: true,
          requestInterceptor: ({ method, path }) => {
            if (method === "GET" && path === pullRequestPath) {
              pullRequestReads += 1;
              if (pullRequestReads >= 3) {
                return jsonResponse({ message: "synthetic final scope failure" }, 502);
              }
            }
            return undefined;
          },
        };
      })(),
    },
    {
      suffix: "begin-created-exact-refetch-failure",
      options: {
        requestInterceptor: ({ method, path }) => {
          if (
            method === "GET" &&
            /^\/repos\/owner\/repo\/issues\/comments\/10000$/u.test(path)
          ) {
            return jsonResponse({ message: "synthetic exact refetch failure" }, 502);
          }
          return undefined;
        },
      },
    },
    {
      suffix: "begin-created-exact-refetch-403",
      options: {
        requestInterceptor: ({ method, path }) => {
          if (
            method === "GET" &&
            /^\/repos\/owner\/repo\/issues\/comments\/10000$/u.test(path)
          ) {
            return jsonResponse({ message: "synthetic exact refetch denial" }, 403);
          }
          return undefined;
        },
      },
    },
    {
      suffix: "begin-created-final-scope-failure",
      options: (() => {
        let pullRequestReads = 0;
        return {
          requestInterceptor: ({ method, path }) => {
            if (method === "GET" && path === pullRequestPath) {
              pullRequestReads += 1;
              if (pullRequestReads >= 3) {
                return jsonResponse({ message: "synthetic final scope failure" }, 502);
              }
            }
            return undefined;
          },
        };
      })(),
    },
    {
      suffix: "begin-created-final-scope-403",
      options: (() => {
        let pullRequestReads = 0;
        return {
          requestInterceptor: ({ method, path }) => {
            if (method === "GET" && path === pullRequestPath) {
              pullRequestReads += 1;
              if (pullRequestReads >= 3) {
                return jsonResponse({ message: "synthetic final scope denial" }, 403);
              }
            }
            return undefined;
          },
        };
      })(),
    },
  ];

  for (const { suffix, options } of cases) {
    const github = createGitHubMock(options);
    const environment = runtimeEnvironment(context, {
      suffix,
      operation: "begin-review",
    });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.executionHealth, "unhealthy", suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "retry_begin", suffix);
    assert.equal(result.report.retrySafe, false, suffix);
    assert.equal(github.requestBodies.length, 1, suffix);
  }
});

test("begin-review terminal paths reread exact PR scope and never add stale diagnostics", async (context) => {
  const existingGitHub = createGitHubMock({
    issueComments: [workflowRequest()],
    pullRequestSequence: [{}, { head: { sha: NEXT_HEAD } }],
  });
  const existingEnvironment = runtimeEnvironment(context, {
    suffix: "begin-existing-stale",
    operation: "begin-review",
  });
  const { result: existing } = await runGate(existingEnvironment, existingGitHub);
  assert.equal(existing.report.gateOutcome, "not_applicable");
  assert.deepEqual(existingGitHub.requestBodies, []);
  assert.deepEqual(existingGitHub.stickyCreates, []);
  assert.deepEqual(existingGitHub.stickyPatches, []);

  const disabledGitHub = createGitHubMock({
    pullRequestSequence: [{}, { state: "closed" }],
  });
  const disabledEnvironment = runtimeEnvironment(context, {
    suffix: "begin-disabled-stale",
    operation: "begin-review",
    requestReview: "false",
  });
  const { result: disabled } = await runGate(disabledEnvironment, disabledGitHub);
  assert.equal(disabled.report.gateOutcome, "not_applicable");
  assert.deepEqual(disabledGitHub.requestBodies, []);
  assert.deepEqual(disabledGitHub.stickyCreates, []);

  const unknownGitHub = createGitHubMock({
    postUnknownAfterCreate: true,
    pullRequestSequence: [{}, {}, { head: { sha: NEXT_HEAD } }],
  });
  const unknownEnvironment = runtimeEnvironment(context, {
    suffix: "begin-unknown-stale",
    operation: "begin-review",
  });
  const { result: unknown } = await runGate(unknownEnvironment, unknownGitHub);
  assert.equal(unknown.report.gateOutcome, "not_applicable");
  assert.equal(unknownGitHub.requestBodies.length, 1);
  assert.deepEqual(unknownGitHub.stickyCreates, []);
  assert.deepEqual(unknownGitHub.stickyPatches, []);
});

test("healthy findings block the native verifier without any status projection", async (context) => {
  const github = createGitHubMock({
    issueComments: [ordinaryRequest(), findingIssueComment(HEAD)],
  });
  const environment = runtimeEnvironment(context, { suffix: "native-finding" });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "failure");
  assert.equal(result.report.recoveryCode, "fix_findings");
  assert.deepEqual(github.statusWrites, []);
  assert.equal(github.calls.some(({ path }) => path.includes("/statuses/")), false);
});

test("default UI reconcile ignores request_review after exact binding and reruns A+1", async (context) => {
  const github = createGitHubMock();
  const environment = runtimeEnvironment(context, {
    suffix: "manual-controller-rerun",
    eventName: "workflow_dispatch",
  });
  const event = JSON.parse(readFileSync(environment.GITHUB_EVENT_PATH, "utf8"));
  assert.equal(environment.OPERATION_INPUT, "reconcile");
  assert.equal(environment.REQUEST_REVIEW_INPUT, "true");
  assert.equal(event.inputs.operation, "reconcile");
  assert.equal(event.inputs.request_review, true);
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.deepEqual(github.rerunRequests, ["7001"]);
  assert.equal(
    github.calls.some(({ path }) =>
      path === `/repos/${REPOSITORY}/actions/runs/7001/attempts/2/jobs`
    ),
    true,
  );
  assert.equal(
    github.calls.some(({ path }) => path === `/repos/${REPOSITORY}/check-runs/9001`),
    true,
  );
  assert.deepEqual(github.statusWrites, []);
});

test("manual reconcile binds request_review before ignoring its business value", async (context) => {
  const environment = runtimeEnvironment(context, {
    suffix: "manual-controller-request-review-tamper",
    eventName: "workflow_dispatch",
    requestReview: "false",
    event: workflowDispatchEvent({ requestReview: true }),
  });
  const result = await runV2GateCli({
    environment,
    fetchImpl: async () => { throw new Error("fetch must not run"); },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.gateOutcome, "not_applicable");
  assert.equal(result.report.recoveryCode, "unsupported_target");
  assert.match(result.report.reason, /exact controller operation/u);
});

test("controller reports create_verifier_run when the current feature head has no verifier", async (context) => {
  const github = createGitHubMock({ verifierRuns: [] });
  const environment = runtimeEnvironment(context, {
    suffix: "missing-verifier",
    eventName: "workflow_dispatch",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "not_applicable");
  assert.equal(result.report.recoveryCode, "create_verifier_run");
  assert.equal(result.report.retrySafe, false);
  assert.deepEqual(github.rerunRequests, []);
  const summary = readFileSync(environment.GITHUB_STEP_SUMMARY, "utf8");
  assert.match(summary, /convert a ready PR to draft and mark it ready again/iu);
});

test("an unobservable verifier rerun remains fail-closed and is never posted twice", async (context) => {
  const github = createGitHubMock({ verifierRerunAdvances: false });
  const environment = runtimeEnvironment(context, {
    suffix: "unobservable-rerun",
    eventName: "workflow_dispatch",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.equal(result.report.retrySafe, false);
  assert.deepEqual(github.rerunRequests, ["7001"]);
});

test("post-rerun safe-read exhaustion is retry-unsafe for reconcile and begin-review", async (context) => {
  for (const operation of ["reconcile", "begin-review"]) {
    const github = createGitHubMock({
      requestInterceptor: ({ method, path }) => {
        if (
          method === "GET" &&
          path === `/repos/${REPOSITORY}/actions/runs/7001`
        ) {
          return jsonResponse({ message: "synthetic post-rerun read failure" }, 502);
        }
        return undefined;
      },
    });
    const environment = runtimeEnvironment(context, {
      suffix: `post-rerun-safe-read-${operation}`,
      operation,
      eventName: "workflow_dispatch",
    });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, operation);
    assert.equal(result.report.executionHealth, "unhealthy", operation);
    assert.equal(result.report.gateOutcome, "pending", operation);
    assert.equal(result.report.recoveryCode, "wait_then_reconcile", operation);
    assert.equal(result.report.retrySafe, false, operation);
    assert.match(result.report.reason, /may have been submitted/iu, operation);
    assert.deepEqual(github.rerunRequests, ["7001"], operation);
    assert.equal(github.requestBodies.length, operation === "begin-review" ? 1 : 0);
  }
});

test("controller requires the exact verifier display-title execution receipt", async (context) => {
  const missingTitle = verifierRun();
  delete missingTitle.display_title;
  for (const [suffix, run] of [
    ["missing", missingTitle],
    ["wrong", verifierRun({
      display_title: `codex-review-gate-verifier/${PR}/${NEXT_HEAD}`,
    })],
  ]) {
    const github = createGitHubMock({ verifierRuns: [run] });
    const environment = runtimeEnvironment(context, {
      suffix: `verifier-display-title-${suffix}`,
      eventName: "workflow_dispatch",
    });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, suffix);
    assert.notEqual(result.report.gateOutcome, "success", suffix);
    assert.equal(result.report.retrySafe, false, suffix);
    assert.deepEqual(github.rerunRequests, [], suffix);
  }

  const refetchGitHub = createGitHubMock({
    requestInterceptor: ({ method, path }) => {
      if (method === "GET" && path === `/repos/${REPOSITORY}/actions/runs/7001`) {
        return jsonResponse(verifierRun({
          run_attempt: 2,
          status: "queued",
          conclusion: null,
          display_title: `codex-review-gate-verifier/${PR}/${NEXT_HEAD}`,
        }));
      }
      return undefined;
    },
  });
  const refetchEnvironment = runtimeEnvironment(context, {
    suffix: "verifier-display-title-refetch",
    eventName: "workflow_dispatch",
  });
  const { result: refetchResult } = await runGate(refetchEnvironment, refetchGitHub);
  assert.equal(refetchResult.exitCode, 1);
  assert.equal(refetchResult.report.gateOutcome, "pending");
  assert.equal(refetchResult.report.recoveryCode, "wait_then_reconcile");
  assert.equal(refetchResult.report.retrySafe, false);
  assert.deepEqual(refetchGitHub.rerunRequests, ["7001"]);
});

test("controller binds REST run, job, and CheckRun to feature head while verifier launch uses test-merge", async (context) => {
  const verifierEnvironment = runtimeEnvironment(context, {
    suffix: "feature-head-rest-verifier-launch",
  });
  const { result: verifierResult } = await runGate(
    verifierEnvironment,
    createGitHubMock(),
  );
  assert.notEqual(verifierResult.report.gateOutcome, "success");
  assert.equal(verifierEnvironment.GITHUB_SHA, TEST_MERGE);
  assert.equal(verifierEnvironment.GITHUB_REF, `refs/pull/${PR}/merge`);
  assert.equal(verifierRun().head_sha, HEAD);
  assert.equal(verifierJob().head_sha, HEAD);
  assert.equal(verifierCheckRun().head_sha, HEAD);

  const github = createGitHubMock({
    verifierRuns: [verifierRun({
      head_sha: HEAD,
      path: `.github/workflows/codex-review-gate.yml@refs/pull/${PR}/merge`,
    })],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "head-associated-verifier-run",
    eventName: "workflow_dispatch",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(github.rerunRequests, ["7001"]);
  const inventoryCall = github.calls.find(({ path }) =>
    path === `/repos/${REPOSITORY}/actions/workflows/codex-review-gate.yml/runs`
  );
  assert.equal(inventoryCall.search.includes(`head_sha=${HEAD}`), true);
  assert.equal(inventoryCall.search.includes(`head_sha=${TEST_MERGE}`), false);
});

test("controller rejects verifier REST objects attached to the test-merge SHA", async (context) => {
  for (const fixture of ["run", "job", "check"]) {
    const github = createGitHubMock({
      verifierRuns: [verifierRun(fixture === "run" ? { head_sha: TEST_MERGE } : {})],
      requestInterceptor: ({ method, path }) => {
        if (
          fixture === "job" &&
          method === "GET" &&
          path === `/repos/${REPOSITORY}/actions/runs/7001/attempts/2/jobs`
        ) {
          return jsonResponse({
            total_count: 1,
            jobs: [verifierJob({ head_sha: TEST_MERGE })],
          });
        }
        if (
          fixture === "check" &&
          method === "GET" &&
          path === `/repos/${REPOSITORY}/check-runs/9001`
        ) {
          return jsonResponse(verifierCheckRun({ head_sha: TEST_MERGE }));
        }
        return undefined;
      },
    });
    const environment = runtimeEnvironment(context, {
      suffix: `test-merge-rest-${fixture}`,
      eventName: "workflow_dispatch",
    });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, fixture);
    assert.notEqual(result.report.gateOutcome, "success", fixture);
  }
});

test("controller never reruns an active verifier baseline", async (context) => {
  const github = createGitHubMock({
    verifierRuns: [verifierRun({ status: "in_progress", conclusion: null })],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "active-verifier-baseline",
    eventName: "workflow_dispatch",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.deepEqual(github.rerunRequests, []);
});

test("controller fails closed when verifier-run pagination repeats a boundary ID", async (context) => {
  const firstPage = Array.from({ length: 100 }, (_, index) =>
    verifierRun({
      id: 8_000 - index,
      run_number: 200 - index,
    })
  );
  const repeatedBoundary = {
    ...structuredClone(firstPage.at(-1)),
    status: "in_progress",
    conclusion: null,
  };
  const github = createGitHubMock({
    requestInterceptor: ({ method, path, url }) => {
      if (
        method !== "GET" ||
        path !== `/repos/${REPOSITORY}/actions/workflows/codex-review-gate.yml/runs`
      ) {
        return undefined;
      }
      if (url.searchParams.get("page") === "1") {
        const next = new URL(url);
        next.searchParams.set("page", "2");
        return jsonResponse(
          { total_count: 101, workflow_runs: firstPage },
          200,
          { link: `<${next.href}>; rel="next"` },
        );
      }
      return jsonResponse({
        total_count: 101,
        workflow_runs: [repeatedBoundary],
      });
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "verifier-run-pagination-churn",
    eventName: "workflow_dispatch",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.equal(result.report.retrySafe, false);
  assert.match(result.report.reason, /duplicate identity 7901 across paginated evidence/iu);
  assert.deepEqual(github.rerunRequests, []);
});

test("controller freezes verifier-run total_count across pages before rerun POST", async (context) => {
  const firstPage = Array.from({ length: 100 }, (_, index) =>
    verifierRun({
      id: 8_000 - index,
      run_number: 200 - index,
    })
  );
  const github = createGitHubMock({
    requestInterceptor: ({ method, path, url }) => {
      if (
        method !== "GET" ||
        path !== `/repos/${REPOSITORY}/actions/workflows/codex-review-gate.yml/runs`
      ) {
        return undefined;
      }
      if (url.searchParams.get("page") === "1") {
        const next = new URL(url);
        next.searchParams.set("page", "2");
        return jsonResponse(
          { total_count: 100, workflow_runs: firstPage },
          200,
          { link: `<${next.href}>; rel="next"` },
        );
      }
      return jsonResponse({
        total_count: 101,
        workflow_runs: [verifierRun({ id: 9_001, run_number: 300 })],
      });
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "verifier-run-total-count-drift",
    eventName: "workflow_dispatch",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.equal(result.report.retrySafe, false);
  assert.match(result.report.reason, /total_count changed across pages \(100 != 101\)/u);
  assert.deepEqual(github.rerunRequests, []);
});

test("controller rejects same-count verifier member replacement before rerun POST", async (context) => {
  let inventoryReads = 0;
  const github = createGitHubMock({
    requestInterceptor: ({ method, path }) => {
      if (
        method !== "GET" ||
        path !== `/repos/${REPOSITORY}/actions/workflows/codex-review-gate.yml/runs`
      ) {
        return undefined;
      }
      inventoryReads += 1;
      return jsonResponse({
        total_count: 1,
        workflow_runs: [inventoryReads === 1
          ? verifierRun()
          : verifierRun({
              id: 7_002,
              run_number: 42,
              status: "in_progress",
              conclusion: null,
            })],
      });
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "verifier-run-same-count-replacement",
    eventName: "workflow_dispatch",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.equal(result.report.retrySafe, false);
  assert.match(result.report.reason, /inventory changed between pre-rerun snapshots/iu);
  assert.equal(inventoryReads, 2);
  assert.deepEqual(github.rerunRequests, []);
});

test("second pre-rerun inventory snapshot preserves pagination churn checks", async (context) => {
  for (const fixture of ["duplicate", "total-count-drift"]) {
    let snapshot = 0;
    const secondSnapshotFirstPage = Array.from({ length: 100 }, (_, index) =>
      verifierRun({
        id: 8_000 - index,
        run_number: 200 - index,
      })
    );
    const github = createGitHubMock({
      requestInterceptor: ({ method, path, url }) => {
        if (
          method !== "GET" ||
          path !== `/repos/${REPOSITORY}/actions/workflows/codex-review-gate.yml/runs`
        ) {
          return undefined;
        }
        if (url.searchParams.get("page") === "1") {
          snapshot += 1;
          if (snapshot === 1) {
            return jsonResponse({ total_count: 1, workflow_runs: [verifierRun()] });
          }
          const next = new URL(url);
          next.searchParams.set("page", "2");
          return jsonResponse(
            {
              total_count: fixture === "duplicate" ? 101 : 100,
              workflow_runs: secondSnapshotFirstPage,
            },
            200,
            { link: `<${next.href}>; rel="next"` },
          );
        }
        return jsonResponse({
          total_count: 101,
          workflow_runs: [fixture === "duplicate"
            ? structuredClone(secondSnapshotFirstPage.at(-1))
            : verifierRun({ id: 9_001, run_number: 300 })],
        });
      },
    });
    const environment = runtimeEnvironment(context, {
      suffix: `second-verifier-inventory-${fixture}`,
      eventName: "workflow_dispatch",
    });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, fixture);
    assert.equal(result.report.gateOutcome, "pending", fixture);
    assert.equal(result.report.recoveryCode, "wait_then_reconcile", fixture);
    assert.equal(result.report.retrySafe, false, fixture);
    assert.match(
      result.report.reason,
      fixture === "duplicate" ? /duplicate identity/iu : /total_count changed/iu,
      fixture,
    );
    assert.equal(snapshot, 2, fixture);
    assert.deepEqual(github.rerunRequests, [], fixture);
  }
});

test("controller adopts an ambiguous rerun POST only after exact A+1 readback", async (context) => {
  const github = createGitHubMock({ verifierRerunStatus: 500 });
  const environment = runtimeEnvironment(context, {
    suffix: "ambiguous-rerun-observed",
    eventName: "workflow_dispatch",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.executionHealth, "healthy");
  assert.deepEqual(github.rerunRequests, ["7001"]);
  const rerunIndex = github.calls.findIndex(({ method, path }) =>
    method === "POST" && path === `/repos/${REPOSITORY}/actions/runs/7001/rerun`
  );
  assert.deepEqual(
    github.calls.slice(rerunIndex - 2, rerunIndex).map(({ method, path }) => [method, path]),
    [
      ["GET", `/repos/${REPOSITORY}/pulls/${PR}`],
      ["GET", `/repos/${REPOSITORY}/actions/workflows/codex-review-gate.yml/runs`],
    ],
    "the final PR scope and complete run inventory are the last reads before rerun POST",
  );
  const checkIndex = github.calls.findIndex(({ method, path }) =>
    method === "GET" && path === `/repos/${REPOSITORY}/check-runs/9001`
  );
  assert.deepEqual(
    github.calls.slice(checkIndex + 1, checkIndex + 3).map(({ method, path }) => [method, path]),
    [
      ["GET", `/repos/${REPOSITORY}/pulls/${PR}`],
      ["GET", `/repos/${REPOSITORY}/actions/workflows/codex-review-gate.yml/runs`],
    ],
    "the controller revalidates PR scope and current run inventory after observing A+1",
  );
});

test("controller rejects exact PR scope drift immediately before rerun POST", async (context) => {
  const driftCases = [
    ["head", { head: { sha: NEXT_HEAD } }],
    ["base", { base: { sha: NEXT_HEAD } }],
    ["test-merge", { merge_commit_sha: NEXT_HEAD }],
  ];
  for (const [label, drift] of driftCases) {
    const github = createGitHubMock({
      pullRequestSequence: [{}, {}, drift],
    });
    const environment = runtimeEnvironment(context, {
      suffix: `pre-rerun-post-${label}-drift`,
      eventName: "workflow_dispatch",
    });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 0, label);
    assert.equal(result.report.executionHealth, "healthy", label);
    assert.equal(result.report.gateOutcome, "not_applicable", label);
    assert.equal(result.report.recoveryCode, "refresh_head", label);
    assert.deepEqual(github.rerunRequests, [], label);
    assert.equal(
      github.calls.some(({ method, path }) =>
        method === "POST" && path.endsWith("/cancel")
      ),
      false,
      label,
    );
  }
});

test("controller keeps a submitted verifier running when PR scope drifts after A+1", async (context) => {
  const driftCases = [
    ["head", { head: { sha: NEXT_HEAD } }],
    ["base", { base: { sha: NEXT_HEAD } }],
    ["test-merge", { merge_commit_sha: NEXT_HEAD }],
  ];
  for (const [label, drift] of driftCases) {
    const github = createGitHubMock({
      pullRequestSequence: [{}, {}, {}, drift],
    });
    const environment = runtimeEnvironment(context, {
      suffix: `post-a-plus-one-${label}-drift`,
      eventName: "workflow_dispatch",
    });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, label);
    assert.equal(result.report.executionHealth, "unhealthy", label);
    assert.equal(result.report.gateOutcome, "pending", label);
    assert.equal(result.report.recoveryCode, "wait_then_reconcile", label);
    assert.equal(result.report.retrySafe, false, label);
    assert.match(result.report.reason, /may have been submitted/iu, label);
    assert.deepEqual(github.rerunRequests, ["7001"], label);
    assert.equal(
      github.calls.some(({ method, path }) =>
        method === "POST" && path.endsWith("/cancel")
      ),
      false,
      label,
    );
  }
});

test("controller rejects canonical run inventory drift before and after rerun submission", async (context) => {
  for (const phase of ["before-post", "after-a-plus-one"]) {
    let inventoryReads = 0;
    const github = createGitHubMock({
      requestInterceptor: ({ method, path }) => {
        if (
          method !== "GET" ||
          path !== `/repos/${REPOSITORY}/actions/workflows/codex-review-gate.yml/runs`
        ) {
          return undefined;
        }
        inventoryReads += 1;
        const driftRead = phase === "before-post" ? 3 : 4;
        if (inventoryReads !== driftRead) return undefined;
        return jsonResponse({
          total_count: 1,
          workflow_runs: [verifierRun({
            run_attempt: phase === "before-post" ? 1 : 2,
            status: phase === "before-post" ? "completed" : "queued",
            conclusion: phase === "before-post" ? "failure" : null,
            display_title: `codex-review-gate-verifier/${PR}/${NEXT_HEAD}`,
          })],
        });
      },
    });
    const environment = runtimeEnvironment(context, {
      suffix: `run-inventory-drift-${phase}`,
      eventName: "workflow_dispatch",
    });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, phase);
    assert.equal(result.report.executionHealth, "unhealthy", phase);
    assert.equal(result.report.gateOutcome, "pending", phase);
    assert.equal(result.report.recoveryCode, "wait_then_reconcile", phase);
    assert.equal(result.report.retrySafe, false, phase);
    assert.match(
      result.report.reason,
      phase === "before-post"
        ? /changed immediately before rerun POST/iu
        : /changed after observing the new attempt/iu,
      phase,
    );
    assert.deepEqual(
      github.rerunRequests,
      phase === "before-post" ? [] : ["7001"],
      phase,
    );
    assert.equal(
      github.calls.some(({ method, path }) =>
        method === "POST" && path.endsWith("/cancel")
      ),
      false,
      phase,
    );
  }
});

test("controller cross-checks exact A+1 immutable identity and explicit null conclusion", async (context) => {
  for (const fixture of ["run-number", "html-url", "missing-conclusion"]) {
    const github = createGitHubMock({
      requestInterceptor: ({ method, path, calls }) => {
        if (
          method !== "GET" ||
          path !== `/repos/${REPOSITORY}/actions/runs/7001` ||
          !calls.some(({ method: priorMethod, path: priorPath }) =>
            priorMethod === "POST" && priorPath.endsWith("/actions/runs/7001/rerun")
          )
        ) {
          return undefined;
        }
        const exact = verifierRun({
          run_attempt: 2,
          status: "queued",
          conclusion: null,
          ...(fixture === "run-number" ? { run_number: 42 } : {}),
          ...(fixture === "html-url"
            ? { html_url: `https://github.com/${REPOSITORY}/actions/runs/other` }
            : {}),
        });
        if (fixture === "missing-conclusion") delete exact.conclusion;
        return jsonResponse(exact);
      },
    });
    const environment = runtimeEnvironment(context, {
      suffix: `exact-a-plus-one-${fixture}`,
      eventName: "workflow_dispatch",
    });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, fixture);
    assert.equal(result.report.gateOutcome, "pending", fixture);
    assert.equal(result.report.recoveryCode, "wait_then_reconcile", fixture);
    assert.equal(result.report.retrySafe, false, fixture);
    assert.match(
      result.report.reason,
      fixture === "missing-conclusion" ? /became inconsistent/iu : /immutable run identity/iu,
      fixture,
    );
    assert.deepEqual(github.rerunRequests, ["7001"], fixture);
    assert.equal(
      github.calls.some(({ method, path }) =>
        method === "POST" && path.endsWith("/cancel")
      ),
      false,
      fixture,
    );
  }
});

test("controller preserves definite rerun rejection and completed-at-readback semantics", async (context) => {
  for (const status of [401, 403, 422]) {
    const github = createGitHubMock({ verifierRerunStatus: status });
    const environment = runtimeEnvironment(context, {
      suffix: `definite-rerun-rejection-${status}`,
      eventName: "workflow_dispatch",
    });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, String(status));
    assert.equal(result.report.gateOutcome, "pending", String(status));
    assert.equal(
      result.report.recoveryCode,
      status === 401 || status === 403 ? "repair_permissions" : "wait_then_reconcile",
      String(status),
    );
    assert.equal(result.report.retrySafe, false, String(status));
    assert.deepEqual(github.rerunRequests, ["7001"], String(status));
  }

  const completedGitHub = createGitHubMock({ verifierAttemptStatus: "completed" });
  const completedEnvironment = runtimeEnvironment(context, {
    suffix: "rerun-completed-at-readback",
    eventName: "workflow_dispatch",
  });
  const { result: completed } = await runGate(completedEnvironment, completedGitHub);
  assert.equal(completed.exitCode, 1);
  assert.equal(completed.report.gateOutcome, "pending");
  assert.equal(completed.report.recoveryCode, "wait_then_reconcile");
  assert.equal(completed.report.retrySafe, false);
  assert.match(completed.report.reason, /completed before the controller observed/iu);
  assert.deepEqual(completedGitHub.rerunRequests, ["7001"]);
});

test("controller rejects an A+2 jump as a competing rerun", async (context) => {
  const github = createGitHubMock({ verifierRerunAttemptDelta: 2 });
  const environment = runtimeEnvironment(context, {
    suffix: "competing-rerun-jump",
    eventName: "workflow_dispatch",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.retrySafe, false);
  assert.match(result.report.reason, /competing rerun/iu);
  assert.deepEqual(github.rerunRequests, ["7001"]);
});

test("controller requires one canonical job and the GitHub Actions CheckRun source", async (context) => {
  for (const fixture of ["duplicate-job", "wrong-check-source"]) {
    const github = createGitHubMock({
      requestInterceptor: ({ method, path }) => {
        if (
          fixture === "duplicate-job" &&
          method === "GET" &&
          path === `/repos/${REPOSITORY}/actions/runs/7001/attempts/2/jobs`
        ) {
          return jsonResponse({
            total_count: 2,
            jobs: [verifierJob(), verifierJob({ id: 8002 })],
          });
        }
        if (
          fixture === "wrong-check-source" &&
          method === "GET" &&
          path === `/repos/${REPOSITORY}/check-runs/9001`
        ) {
          return jsonResponse(verifierCheckRun({ app: { id: 1, slug: "other" } }));
        }
        return undefined;
      },
    });
    const environment = runtimeEnvironment(context, {
      suffix: fixture,
      eventName: "workflow_dispatch",
    });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, fixture);
    assert.equal(result.report.executionHealth, "unhealthy", fixture);
    assert.equal(result.report.gateOutcome, "pending", fixture);
    assert.deepEqual(github.rerunRequests, ["7001"], fixture);
  }
});

test("sticky diagnostics update the lowest-id duplicate and emit one bounded warning", async (context) => {
  const lowerIdButNewer = stickyComment({
    id: 301,
    created_at: "2026-08-25T09:00:00Z",
    updated_at: "2026-08-25T09:00:00Z",
  });
  const higherIdButOlder = stickyComment({ id: 302, created_at: "2026-08-25T07:00:00Z" });
  const github = createGitHubMock({
    issueComments: [workflowRequest(), higherIdButOlder, lowerIdButNewer],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "sticky-controller",
    eventName: "workflow_dispatch",
  });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...values) => { warnings.push(values.join(" ")); };
  let result;
  try {
    ({ result } = await runGate(environment, github));
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(github.stickyPatches.at(-1).id, "301");
  assert.equal(github.stickyCreates.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^Found 2 canonical v2 sticky diagnostics;/u);
  assert.match(warnings[0], /updating lowest-id comment 301$/u);
  assert.equal(warnings[0].length < 160, true);
  assert.equal(github.calls.some(({ method }) => method === "DELETE"), false);
});

test("summary and sticky diagnostics are bounded Markdown, HTML, and mention safe", (context) => {
  const reason = `<script>@codex review [unsafe](https://example.test) ${"x".repeat(4_000)}`;
  const report = buildV2GateReport({
    executionHealth: "healthy",
    gateOutcome: "pending",
    reason,
    recoveryCode: "request_clean_generation",
  });
  const sticky = buildV2StickyCommentBody(report, {
    prNumber: PR,
    headSha: HEAD,
  });
  const environment = runtimeEnvironment(context, { suffix: "safe-diagnostics" });
  appendV2GateSummary(environment.GITHUB_STEP_SUMMARY, report, {
    prNumber: PR,
    headSha: HEAD,
  });
  const summary = readFileSync(environment.GITHUB_STEP_SUMMARY, "utf8");
  for (const diagnostic of [sticky, summary]) {
    assert.doesNotMatch(diagnostic, /@codex review/iu);
    assert.doesNotMatch(diagnostic, /<script>/iu);
    assert.match(diagnostic, /&lt;script&gt;&#64;codex review/u);
    assert.equal(diagnostic.length < 5_000, true);
  }
});

test("untrusted finding excerpts cannot inject review requests, Markdown, or HTML into verifier summary", async (context) => {
  const injectedPath = encodeURIComponent(
    "<script>@codex review</script><!-- codex-review-gate:v2:diagnostic -->[link](x)",
  ).replace(/[!'()*]/gu, (character) =>
    `%${character.codePointAt(0).toString(16).toUpperCase()}`
  );
  const finding = findingIssueComment(HEAD, {
    body: [
      "### 💡 Codex Review",
      "",
      `https://github.com/${REPOSITORY}/blob/${HEAD}/${injectedPath}#L1`,
    ].join("\n"),
  });
  const github = createGitHubMock({ issueComments: [ordinaryRequest(), finding] });
  const environment = runtimeEnvironment(context, { suffix: "finding-injection" });
  const { result } = await runGate(environment, github);
  assert.equal(result.report.gateOutcome, "failure");
  assert.equal(github.stickyCreates.length, 0);
  const summary = readFileSync(environment.GITHUB_STEP_SUMMARY, "utf8");
  assert.doesNotMatch(summary, /@codex review/iu);
  assert.doesNotMatch(summary, /<script>|<\/script>|\[link\]\(x\)/iu);
  assert.match(summary, /&lt;script&gt;&#64;codex review&lt;\/script&gt;/u);
  assert.equal(summary.length < 5_000, true);
});

test("invalid configuration still emits exactly the public unhealthy output schema", async (context) => {
  const environment = runtimeEnvironment(context, { operation: "invalid" });
  const result = await runV2GateCli({
    environment,
    fetchImpl: async () => { throw new Error("fetch must not run"); },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "unknown");
  assert.equal(result.report.recoveryCode, "unsupported_target");
  assert.equal(result.report.retrySafe, false);
  assert.deepEqual(Object.keys(readOutputs(environment.GITHUB_OUTPUT)), V2_OUTPUT_KEYS);
});

function snapshot(fingerprint) {
  return { selfConsistent: true, headSha: HEAD, fingerprint };
}

function canonicalRequestBody(headSha = HEAD, overrides = {}) {
  return buildCanonicalV2ReviewRequestBody({
    repositoryId: REPO_ID,
    prNumber: PR,
    headSha,
    baseSha: BASE,
    baseRef: "main",
    baseRepositoryId: REPO_ID,
    runId: "123",
    ...overrides,
  });
}

function workflowRequest(overrides = {}) {
  return {
    id: 101,
    body: canonicalRequestBody(),
    created_at: "2026-08-25T08:00:00Z",
    updated_at: "2026-08-25T08:00:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-101`,
    user: ACTIONS_BOT,
    app: null,
    performed_via_github_app: null,
    ...overrides,
  };
}

function ordinaryRequest(overrides = {}) {
  return {
    id: 101,
    body: "@codex review",
    created_at: "2026-08-25T08:00:00Z",
    updated_at: "2026-08-25T08:00:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-101`,
    user: HUMAN,
    app: null,
    performed_via_github_app: null,
    ...overrides,
  };
}

function cleanIssueComment(commitRef = HEAD, overrides = {}) {
  return {
    id: 201,
    body: [
      "Codex Review: Didn't find any major issues.",
      "",
      `**Reviewed commit:** \`${commitRef}\``,
    ].join("\n"),
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-201`,
    user: CODEX_BOT,
    performed_via_github_app: CODEX_APP,
    ...overrides,
  };
}

function findingIssueComment(headSha = HEAD, overrides = {}) {
  return {
    id: 202,
    body: [
      "### 💡 Codex Review",
      "",
      `https://github.com/${REPOSITORY}/blob/${headSha}/src/finding.mjs#L1`,
    ].join("\n"),
    created_at: "2026-08-25T08:05:00Z",
    updated_at: "2026-08-25T08:05:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-202`,
    user: CODEX_BOT,
    performed_via_github_app: CODEX_APP,
    ...overrides,
  };
}

function findingReview(headSha = HEAD, overrides = {}) {
  return {
    id: 401,
    state: "COMMENTED",
    body: [
      "### 💡 Codex Review",
      "",
      `https://github.com/${REPOSITORY}/blob/${headSha}/src/finding.mjs#L1`,
    ].join("\n"),
    commit_id: headSha,
    submitted_at: "2026-08-25T08:05:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#pullrequestreview-401`,
    user: CODEX_BOT,
    app: null,
    performed_via_github_app: null,
    ...overrides,
  };
}

function approvedReview(commitRef = HEAD, overrides = {}) {
  return {
    id: 402,
    state: "APPROVED",
    body: `Coverage: \`${commitRef}\`.\n\nNo findings.`,
    commit_id: HEAD,
    submitted_at: "2026-08-25T08:05:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#pullrequestreview-402`,
    user: CODEX_BOT,
    app: null,
    performed_via_github_app: null,
    ...overrides,
  };
}

function progressIssueComment(overrides = {}) {
  return {
    id: 204,
    body: "Codex Review in progress",
    created_at: "2026-08-25T08:16:00Z",
    updated_at: "2026-08-25T08:16:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-204`,
    user: CODEX_BOT,
    performed_via_github_app: CODEX_APP,
    ...overrides,
  };
}

function reaction(overrides = {}) {
  return {
    id: 501,
    content: "+1",
    created_at: "2026-08-25T08:01:00Z",
    user: CODEX_BOT,
    ...overrides,
  };
}

function genericComment(id) {
  return {
    id,
    body: `Ordinary discussion ${id}`,
    created_at: "2026-08-25T07:00:00Z",
    updated_at: "2026-08-25T07:00:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-${id}`,
    user: HUMAN,
    app: null,
    performed_via_github_app: null,
  };
}

function stickyComment(overrides = {}) {
  return {
    id: 301,
    body: `Old diagnostic\n\n<!-- ${V2_STICKY_MARKER} -->\n<!-- {} -->`,
    created_at: "2026-08-25T08:00:00Z",
    updated_at: "2026-08-25T08:00:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-301`,
    user: ACTIONS_BOT,
    app: null,
    performed_via_github_app: null,
    ...overrides,
  };
}

function issueCommentEvent(action, comment, overrides = {}) {
  return {
    action,
    issue: {
      number: PR,
      pull_request: { url: `https://api.github.com/repos/${REPOSITORY}/pulls/${PR}` },
    },
    comment,
    sender: CODEX_BOT,
    repository: { full_name: REPOSITORY, default_branch: "main" },
    ...overrides,
  };
}

function pullRequestEvent(action = "synchronize", overrides = {}) {
  return {
    action,
    number: PR,
    pull_request: {
      number: PR,
      merge_commit_sha: TEST_MERGE,
      head: {
        sha: HEAD,
        ref: "feature",
        repo: { id: REPO_ID, full_name: REPOSITORY },
      },
      base: {
        sha: BASE,
        ref: "main",
        repo: { id: REPO_ID, full_name: REPOSITORY },
      },
    },
    sender: HUMAN,
    repository: {
      id: REPO_ID,
      full_name: REPOSITORY,
      default_branch: "main",
    },
    ...overrides,
  };
}

function verifierRun(overrides = {}) {
  return {
    id: 7001,
    run_number: 41,
    run_attempt: 1,
    event: "pull_request",
    path: ".github/workflows/codex-review-gate.yml",
    display_title: `codex-review-gate-verifier/${PR}/${TEST_MERGE}`,
    head_sha: HEAD,
    head_branch: "feature",
    status: "completed",
    conclusion: "failure",
    html_url: `https://github.com/${REPOSITORY}/actions/runs/7001`,
    pull_requests: [{
      number: PR,
      head: { sha: HEAD },
      base: { sha: BASE },
    }],
    ...overrides,
  };
}

function verifierJob({ runId = 7001, runAttempt = 2, status = "queued", ...overrides } = {}) {
  return {
    id: 8001,
    run_id: runId,
    run_attempt: runAttempt,
    name: V2_REQUIRED_CHECK_NAME,
    head_sha: HEAD,
    status,
    conclusion: null,
    check_run_url: `https://api.github.com/repos/${REPOSITORY}/check-runs/9001`,
    ...overrides,
  };
}

function verifierCheckRun({ status = "queued", ...overrides } = {}) {
  return {
    id: 9001,
    name: V2_REQUIRED_CHECK_NAME,
    head_sha: HEAD,
    status,
    conclusion: null,
    app: { id: 15_368, slug: "github-actions" },
    ...overrides,
  };
}

function runtimeEnvironment(context, {
  suffix = "default",
  operation = "reconcile",
  eventName = operation === "begin-review" ? "workflow_dispatch" : "pull_request",
  requestReview = eventName === "workflow_dispatch" ? "true" : "false",
  requestCommentId = "",
  limitsProfile = "default",
  expectedHeadSha = HEAD,
  event = null,
  serverUrl = "https://github.com",
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), `codex-review-gate-v2-${suffix}-`));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const environment = {
    GITHUB_TOKEN: "test-token",
    GITHUB_REPOSITORY: REPOSITORY,
    PR_NUMBER: String(PR),
    EXPECTED_HEAD_SHA: expectedHeadSha,
    OPERATION_INPUT: operation,
    REQUEST_COMMENT_ID: requestCommentId,
    REQUEST_REVIEW_INPUT: requestReview,
    LIMITS_PROFILE: limitsProfile,
    GITHUB_API_URL: serverUrl === "https://github.com"
      ? "https://api.github.com"
      : `${serverUrl}/api/v3`,
    GITHUB_SERVER_URL: serverUrl,
    GITHUB_RUN_ID: "123",
    GITHUB_SHA: eventName === "pull_request" ? TEST_MERGE : BASE,
    GITHUB_REF: eventName === "pull_request"
      ? `refs/pull/${PR}/merge`
      : "refs/heads/main",
    GITHUB_REF_TYPE: "branch",
    GITHUB_REF_NAME: "main",
    RUNNER_OS: "Linux",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_EVENT_NAME: eventName,
    GITHUB_EVENT_PATH: join(directory, "event.json"),
    GITHUB_OUTPUT: join(directory, "output"),
    GITHUB_STEP_SUMMARY: join(directory, "summary"),
  };
  writeFileSync(
    environment.GITHUB_EVENT_PATH,
    `${JSON.stringify(event || (eventName === "pull_request"
      ? pullRequestEvent()
      : workflowDispatchEvent({
          operation,
          expectedHeadSha,
          requestCommentId,
          requestReview: String(requestReview).toLowerCase() !== "false",
        })))}\n`,
    "utf8",
  );
  return environment;
}

function workflowDispatchEvent({
  operation = "reconcile",
  expectedHeadSha = HEAD,
  requestCommentId = "",
  requestReview = true,
} = {}) {
  return {
    ref: "refs/heads/main",
    repository: { full_name: REPOSITORY, default_branch: "main" },
    inputs: {
      operation,
      pr_number: String(PR),
      expected_head_sha: expectedHeadSha,
      request_comment_id: requestCommentId,
      request_review: requestReview,
    },
  };
}

async function runGate(environment, github, {
  stabilityIntervalMs = 1,
  stabilityWindowMs = 4,
} = {}) {
  let clock = 0;
  const sleeps = [];
  const result = await runV2GateCli({
    environment,
    fetchImpl: github.fetch,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      clock += milliseconds;
    },
    now: () => clock,
    stabilityIntervalMs,
    stabilityWindowMs,
  });
  return { result, sleeps };
}

function readOutputs(path) {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .trimEnd()
      .split("\n")
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function createGitHubMock({
  issueComments = [],
  issueCommentSnapshots = null,
  reviews = [],
  reviewSnapshots = null,
  reactionsByCommentId = new Map(),
  reactionSnapshotsByCommentId = new Map(),
  pullRequestOverrides = {},
  pullRequestSequence = null,
  repositoryOverrides = {},
  repositorySequence = null,
  baseEpoch = null,
  baseEpochSequence = null,
  baseEpochResponseMutator = null,
  permissionByLogin = new Map([[HUMAN.login, "write"]]),
  permissionMissingLogins = new Set(),
  commitResolution = null,
  commentRefetchMutator = null,
  reviewRefetchMutator = null,
  postUnknownAfterCreate = false,
  postUnknownReread = "visible",
  verifierRuns = [verifierRun()],
  verifierAttemptStatus = "queued",
  verifierRerunAdvances = true,
  verifierRerunAttemptDelta = 1,
  verifierRerunStatus = 201,
  requestInterceptor = null,
} = {}) {
  const comments = issueComments.map((value) => structuredClone(value));
  const commentSnapshots = issueCommentSnapshots?.map((snapshotComments) =>
    snapshotComments.map((value) => structuredClone(value))) || null;
  const reviewList = reviews.map((value) => structuredClone(value));
  const reviewSnapshotList = reviewSnapshots?.map((snapshotReviews) =>
    snapshotReviews.map((value) => structuredClone(value))) || null;
  const calls = [];
  const statusWrites = [];
  const requestBodies = [];
  const stickyCreates = [];
  const stickyPatches = [];
  const rerunRequests = [];
  let nextCommentId = 10_000;
  let commentSnapshotIndex = 0;
  let reviewSnapshotIndex = 0;
  let pullRequestIndex = 0;
  let repositoryIndex = 0;
  let baseEpochIndex = 0;
  const reactionSnapshotIndexes = new Map();
  let activeComments = comments;
  let activeReviews = reviewList;
  let unknownPostUsed = false;
  let unknownPostCommentId = "";
  let rerunRequested = false;

  function currentComments() {
    if (!commentSnapshots) return comments;
    return commentSnapshots[Math.min(commentSnapshotIndex, commentSnapshots.length - 1)] || [];
  }

  function currentReviews() {
    if (!reviewSnapshotList) return reviewList;
    return reviewSnapshotList[Math.min(reviewSnapshotIndex, reviewSnapshotList.length - 1)] || [];
  }

  function pullRequest() {
    const sequence = pullRequestSequence?.[
      Math.min(pullRequestIndex, pullRequestSequence.length - 1)
    ] || {};
    pullRequestIndex += 1;
    const headOverride = { ...(pullRequestOverrides.head || {}), ...(sequence.head || {}) };
    const baseOverride = { ...(pullRequestOverrides.base || {}), ...(sequence.base || {}) };
    const value = {
      number: PR,
      merge_commit_sha: TEST_MERGE,
      state: "open",
      draft: false,
      merged: false,
      merged_at: null,
      comments: currentComments().length,
      commits: 1,
      user: { ...HUMAN },
      head: {
        sha: HEAD,
        ref: "feature",
        repo: { id: REPO_ID, full_name: REPOSITORY },
        user: { ...HUMAN },
      },
      base: {
        sha: BASE,
        ref: "main",
        repo: { id: REPO_ID, full_name: REPOSITORY },
      },
      ...pullRequestOverrides,
      ...sequence,
    };
    value.head = {
      sha: HEAD,
      ref: "feature",
      user: { ...HUMAN, ...(pullRequestOverrides.head?.user || {}), ...(sequence.head?.user || {}) },
      ...headOverride,
      repo: {
        id: REPO_ID,
        full_name: REPOSITORY,
        ...(pullRequestOverrides.head?.repo || {}),
        ...(sequence.head?.repo || {}),
      },
    };
    value.base = {
      sha: BASE,
      ref: "main",
      ...baseOverride,
      repo: {
        id: REPO_ID,
        full_name: REPOSITORY,
        ...(pullRequestOverrides.base?.repo || {}),
        ...(sequence.base?.repo || {}),
      },
    };
    value.user = {
      ...HUMAN,
      ...(pullRequestOverrides.user || {}),
      ...(sequence.user || {}),
    };
    return value;
  }

  function repository() {
    const sequence = repositorySequence?.[
      Math.min(repositoryIndex, repositorySequence.length - 1)
    ] || {};
    repositoryIndex += 1;
    return {
      id: REPO_ID,
      full_name: REPOSITORY,
      fork: false,
      default_branch: "main",
      ...repositoryOverrides,
      ...sequence,
    };
  }

  const fetch = async (rawUrl, options = {}) => {
    const url = new URL(rawUrl);
    const path = url.pathname.replace(/^\/api\/v3(?=\/repos\/)/u, "");
    const method = options.method || "GET";
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ method, path, search: url.search, body });
    if (typeof requestInterceptor === "function") {
      const intercepted = await requestInterceptor({
        method,
        path,
        body,
        url,
        calls: [...calls],
      });
      if (intercepted !== undefined) return intercepted;
    }

    if (method === "GET" && path === `/repos/${REPOSITORY}`) {
      return jsonResponse(repository());
    }
    if (method === "GET" && path === `/repos/${REPOSITORY}/pulls/${PR}`) {
      return jsonResponse(pullRequest());
    }
    if (
      method === "GET" &&
      path === `/repos/${REPOSITORY}/actions/workflows/codex-review-gate.yml/runs`
    ) {
      return jsonResponse({
        total_count: verifierRuns.length,
        workflow_runs: verifierRuns.map((run) => ({
          ...structuredClone(run),
          run_attempt: rerunRequested && verifierRerunAdvances
            ? run.run_attempt + verifierRerunAttemptDelta
            : run.run_attempt,
          status: rerunRequested && verifierRerunAdvances
            ? verifierAttemptStatus
            : run.status,
          conclusion: rerunRequested && verifierRerunAdvances
            ? null
            : run.conclusion,
        })),
      });
    }
    const exactRun = /^\/repos\/owner\/repo\/actions\/runs\/(\d+)$/u.exec(path);
    if (method === "GET" && exactRun) {
      const run = verifierRuns.find((value) => String(value.id) === exactRun[1]);
      if (!run) return jsonResponse({ message: "not found" }, 404);
      return jsonResponse({
        ...structuredClone(run),
        run_attempt: rerunRequested && verifierRerunAdvances
          ? run.run_attempt + verifierRerunAttemptDelta
          : run.run_attempt,
        status: rerunRequested && verifierRerunAdvances
          ? verifierAttemptStatus
          : run.status,
        conclusion: rerunRequested && verifierRerunAdvances
          ? (verifierAttemptStatus === "completed" ? run.conclusion : null)
          : run.conclusion,
      });
    }
    const rerun = /^\/repos\/owner\/repo\/actions\/runs\/(\d+)\/rerun$/u.exec(path);
    if (method === "POST" && rerun) {
      rerunRequests.push(rerun[1]);
      rerunRequested = true;
      return verifierRerunStatus === 201
        ? new Response(null, { status: 201 })
        : jsonResponse({ message: "synthetic rerun failure" }, verifierRerunStatus);
    }
    const attemptJobs =
      /^\/repos\/owner\/repo\/actions\/runs\/(\d+)\/attempts\/(\d+)\/jobs$/u.exec(path);
    if (method === "GET" && attemptJobs) {
      const run = verifierRuns.find((value) => String(value.id) === attemptJobs[1]);
      if (!run) return jsonResponse({ message: "not found" }, 404);
      const attempt = Number(attemptJobs[2]);
      const job = verifierJob({
        runId: run.id,
        runAttempt: attempt,
        status: verifierAttemptStatus,
      });
      return jsonResponse({ total_count: 1, jobs: [job] });
    }
    if (method === "GET" && path === `/repos/${REPOSITORY}/check-runs/9001`) {
      return jsonResponse(verifierCheckRun({ status: verifierAttemptStatus }));
    }
    if (method === "POST" && path === "/graphql") {
      const selected = baseEpochSequence
        ? baseEpochSequence[Math.min(baseEpochIndex, baseEpochSequence.length - 1)]
        : baseEpoch;
      baseEpochIndex += 1;
      const response = baseEpochGraphQlResponse(selected);
      return jsonResponse(
        typeof baseEpochResponseMutator === "function"
          ? baseEpochResponseMutator(response)
          : response,
      );
    }
    if (method === "GET" && path === `/repos/${REPOSITORY}/issues/${PR}/comments`) {
      if (unknownPostUsed && postUnknownReread === "failure") {
        return jsonResponse({ message: "synthetic unknown POST reread failure" }, 500);
      }
      activeComments = currentComments();
      if (unknownPostUsed && postUnknownReread === "hidden") {
        activeComments = activeComments.filter(
          ({ id }) => String(id) !== unknownPostCommentId,
        );
      }
      const response = paginatedResponse(activeComments, url);
      if (!response.hasNext) commentSnapshotIndex += 1;
      return response.response;
    }
    if (method === "GET" && path === `/repos/${REPOSITORY}/pulls/${PR}/reviews`) {
      activeReviews = currentReviews();
      const response = paginatedResponse(activeReviews, url);
      if (!response.hasNext) reviewSnapshotIndex += 1;
      return response.response;
    }

    const exactComment = /^\/repos\/owner\/repo\/issues\/comments\/(\d+)$/u.exec(path);
    if (method === "GET" && exactComment) {
      const original = activeComments.find((value) => String(value.id) === exactComment[1]) ||
        comments.find((value) => String(value.id) === exactComment[1]);
      if (!original) return jsonResponse({ message: "not found" }, 404);
      const value = typeof commentRefetchMutator === "function"
        ? commentRefetchMutator(structuredClone(original))
        : original;
      return jsonResponse(value);
    }

    const exactReview = /^\/repos\/owner\/repo\/pulls\/17\/reviews\/(\d+)$/u.exec(path);
    if (method === "GET" && exactReview) {
      const original = activeReviews.find((value) => String(value.id) === exactReview[1]) ||
        reviewList.find((value) => String(value.id) === exactReview[1]);
      if (!original) return jsonResponse({ message: "not found" }, 404);
      const value = typeof reviewRefetchMutator === "function"
        ? reviewRefetchMutator(structuredClone(original))
        : original;
      return jsonResponse(value);
    }

    const reactions = /^\/repos\/owner\/repo\/issues\/comments\/(\d+)\/reactions$/u.exec(
      path,
    );
    if (method === "GET" && reactions) {
      const snapshots = reactionSnapshotsByCommentId.get(reactions[1]);
      const snapshotIndex = reactionSnapshotIndexes.get(reactions[1]) || 0;
      const values = snapshots
        ? snapshots[Math.min(snapshotIndex, snapshots.length - 1)] || []
        : reactionsByCommentId.get(reactions[1]) || [];
      const response = paginatedResponse(values, url);
      if (snapshots && !response.hasNext) {
        reactionSnapshotIndexes.set(reactions[1], snapshotIndex + 1);
      }
      return response.response;
    }

    const permission = /^\/repos\/owner\/repo\/collaborators\/([^/]+)\/permission$/u.exec(
      path,
    );
    if (method === "GET" && permission) {
      const login = decodeURIComponent(permission[1]);
      if (permissionMissingLogins.has(login)) {
        return jsonResponse({ message: "not found" }, 404);
      }
      return jsonResponse({ permission: permissionByLogin.get(login) || "read" });
    }

    const commit = /^\/repos\/owner\/repo\/commits\/([0-9a-f]{7,40})$/u.exec(path);
    if (method === "GET" && commit) {
      if (typeof commitResolution === "function") {
        const resolved = commitResolution(commit[1]);
        return jsonResponse(
          resolved?.data || { message: resolved?.message || "not found" },
          resolved?.status || (resolved?.data ? 200 : 404),
        );
      }
      return HEAD.startsWith(commit[1])
        ? jsonResponse({ sha: HEAD })
        : jsonResponse({ message: "not found" }, 404);
    }

    if (method === "POST" && path === `/repos/${REPOSITORY}/issues/${PR}/comments`) {
      const created = {
        id: nextCommentId,
        body: body.body,
        created_at: "2026-08-25T09:00:00Z",
        updated_at: "2026-08-25T09:00:00Z",
        html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-${nextCommentId}`,
        user: ACTIONS_BOT,
        app: null,
        performed_via_github_app: null,
      };
      nextCommentId += 1;
      comments.push(created);
      activeComments = comments;
      unknownPostCommentId = String(created.id);
      if (body.body.startsWith("@codex review")) requestBodies.push(body.body);
      if (body.body.includes(`<!-- ${V2_STICKY_MARKER} -->`)) stickyCreates.push(body.body);
      if (postUnknownAfterCreate && !unknownPostUsed && body.body.startsWith("@codex review")) {
        unknownPostUsed = true;
        return jsonResponse({ message: "synthetic unknown POST" }, 500);
      }
      return jsonResponse(created, 201);
    }

    if (method === "PATCH" && exactComment) {
      const target = comments.find((value) => String(value.id) === exactComment[1]);
      if (!target) return jsonResponse({ message: "not found" }, 404);
      target.body = body.body;
      target.updated_at = "2026-08-25T09:00:00Z";
      stickyPatches.push({ id: exactComment[1], body: body.body });
      return jsonResponse(target);
    }

    return jsonResponse({ message: `unexpected ${method} ${path}` }, 404);
  };

  return {
    fetch,
    calls,
    statusWrites,
    requestBodies,
    stickyCreates,
    stickyPatches,
    rerunRequests,
  };
}

function baseEpochGraphQlResponse(event = null) {
  return {
    data: {
      repository: {
        nameWithOwner: REPOSITORY,
        pullRequest: {
          number: PR,
          timelineItems: {
            filteredCount: event === null ? 0 : 1,
            pageCount: event === null ? 0 : 1,
            nodes: event === null ? [] : [structuredClone(event)],
          },
        },
      },
    },
  };
}

function baseRefChangedEvent(overrides = {}) {
  return {
    __typename: "BaseRefChangedEvent",
    id: "BRE_kwDOExample1",
    createdAt: "2026-08-25T08:05:00Z",
    previousRefName: "release",
    currentRefName: "main",
    actor: { __typename: "User", login: HUMAN.login },
    ...overrides,
  };
}

function baseRefForcePushedEvent(overrides = {}) {
  return {
    __typename: "BaseRefForcePushedEvent",
    id: "BRFPE_kwDOExample1",
    createdAt: "2026-08-25T08:05:00Z",
    beforeCommit: { oid: "e".repeat(40) },
    afterCommit: { oid: BASE },
    ref: { name: "main" },
    actor: { __typename: "User", login: HUMAN.login },
    ...overrides,
  };
}

function paginatedResponse(items, url) {
  const perPage = Number(url.searchParams.get("per_page") || "30");
  const page = Number(url.searchParams.get("page") || "1");
  const start = (page - 1) * perPage;
  const values = items.slice(start, start + perPage);
  const hasNext = start + values.length < items.length;
  const headers = {};
  if (hasNext) {
    const next = new URL(url);
    next.searchParams.set("per_page", String(perPage));
    next.searchParams.set("page", String(page + 1));
    headers.link = `<${next.href}>; rel="next"`;
  }
  return { response: jsonResponse(values, 200, headers), hasNext };
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function failingBodyResponse(message, status = 200) {
  return new Response(new ReadableStream({
    pull(controller) {
      controller.error(new Error(message));
    },
  }), { status });
}
