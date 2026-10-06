import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
import { fileURLToPath } from "node:url";

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
const CODEX_PULL_REQUEST_REVIEW_SUMMARY_MARKER =
  "<!-- codex-pull-request-review-summary -->";
const CODEX_BOT_DATABASE_ID = 90_510;
const HUMAN_DATABASE_ID = 90_511;
const V2_RUNTIME_PATH = fileURLToPath(
  new URL("../packages/action/src/v2/gate-runtime.mjs", import.meta.url),
);

test("normalizers, profiles, result vocabulary, and production constants are closed", (context) => {
  assert.equal(normalizeV2Operation(undefined), "reconcile");
  assert.equal(normalizeV2Operation("begin-review"), "begin-review");
  assert.equal(normalizeV2Operation("report-completion"), "report-completion");
  assert.throws(() => normalizeV2Operation("scan"), /reconcile, begin-review, or report-completion/u);
  assert.equal(normalizeV2RequestReview(undefined), true);
  assert.equal(normalizeV2RequestReview("TRUE"), true);
  assert.equal(normalizeV2RequestReview("false"), false);
  assert.throws(() => normalizeV2RequestReview("1"), /true or false/u);
  assert.equal(normalizeV2LimitsProfile(""), "default");
  assert.equal(normalizeV2LimitsProfile("expanded"), "expanded");
  assert.throws(() => normalizeV2LimitsProfile("custom"), /default or expanded/u);
  assert.deepEqual(V2_LIMITS_PROFILES.default, {
    maxPages: 100,
    maxObjects: 2_000,
    maxAttempts: 128,
    maxSnapshotBytes: 32 * 1024 * 1024,
    requestTimeoutMs: 10_000,
    reconcileBudgetMs: 60_000,
  });
  assert.deepEqual(V2_LIMITS_PROFILES.expanded, {
    maxPages: 500,
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
  const incompleteReport = buildV2GateReport({
    executionHealth: "healthy",
    gateOutcome: "pending",
    recoveryCode: "wait_provider",
    reviewThreads: {
      status: "incomplete",
      unresolved: 1,
      resolved: 2,
      total: 3,
    },
  });
  assert.deepEqual(incompleteReport.reviewThreads, {
    status: "incomplete",
    unresolved: "unknown",
    resolved: "unknown",
    total: "unknown",
    diagnostics: [],
  });
  const incompleteEnvironment = runtimeEnvironment(context, {
    suffix: "incomplete-thread-count-normalization",
  });
  appendV2GateSummary(incompleteEnvironment.GITHUB_STEP_SUMMARY, incompleteReport, {
    prNumber: PR,
    headSha: HEAD,
  });
  const incompleteSummary = readFileSync(
    incompleteEnvironment.GITHUB_STEP_SUMMARY,
    "utf8",
  );
  assert.match(
    incompleteSummary,
    /Review threads: unknown unresolved, unknown resolved, unknown total/u,
  );
  const incompleteSticky = buildV2StickyCommentBody(incompleteReport, {
    prNumber: PR,
    headSha: HEAD,
  });
  assert.match(
    incompleteSticky,
    /Review threads: unknown unresolved, unknown resolved, unknown total\./u,
  );
  const incompleteHidden = /^<!-- (\{.*\}) -->$/mu.exec(incompleteSticky);
  assert.ok(incompleteHidden, "sticky report includes its machine-readable payload");
  assert.deepEqual(JSON.parse(incompleteHidden[1]).reviewThreads, {
    unresolved: "unknown",
    resolved: "unknown",
    total: "unknown",
    status: "incomplete",
    diagnostics: [],
  });
});

test("review-thread inventory uses non-overlapping 100-node pages until complete", async (context) => {
  const threads = Array.from({ length: 201 }, (_, index) => reviewThread({
    id: `PRRT_node_${index + 1}`,
  }));
  const github = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
    reviewThreads: threads,
  });
  const environment = runtimeEnvironment(context, {
    suffix: "review-thread-pages",
  });
  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 0, result.report.reason);
  assert.equal(result.report.gateOutcome, "success");
  const pages = github.calls.filter(({ method, path, body }) =>
    method === "POST" && path === "/graphql" &&
    body?.query?.includes("CodexReviewGateReviewThreads")
  );
  assert.equal(pages.length % 3, 0);
  for (let index = 0; index < pages.length; index += 3) {
    assert.deepEqual(pages.slice(index, index + 3).map(({ body }) => body.variables.cursor), [
      null,
      "review-thread:100",
      "review-thread:200",
    ]);
  }
  for (const { body } of pages) {
    assert.deepEqual(body.variables, {
      owner: OWNER,
      repo: REPO,
      number: PR,
      cursor: body.variables.cursor,
    });
    assert.match(body.query, /reviewThreads\(\s*first:\s*100/su);
    assert.match(body.query, /isResolved/u);
    assert.match(body.query, /isOutdated/u);
    assert.doesNotMatch(body.query, /nodes\s*\{\s*id\s+isResolved\s+path\s+url/u);
  }
});

test("unresolved outdated and human-authored review threads remain blocking", async (context) => {
  const github = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
    reviewThreads: [
      reviewThread({ id: "PRRT_old", isResolved: false, isOutdated: true }),
      reviewThread({
        id: "PRRT_human",
        isResolved: false,
        path: "docs/design.md",
        url: `https://github.com/${REPOSITORY}/pull/${PR}#discussion_human`,
      }),
    ],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "review-thread-blockers",
  });
  const { result } = await runGate(environment, github);

  assert.equal(result.report.executionHealth, "healthy");
  assert.notEqual(result.report.gateOutcome, "success");
  assert.equal(result.report.reviewThreads.unresolved, 2);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("resolved review threads are counted without preventing a clean gate", async (context) => {
  const github = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
    reviewThreads: [
      reviewThread({ id: "PRRT_resolved", isResolved: true }),
      reviewThread({ id: "PRRT_outdated-resolved", isResolved: true, isOutdated: true }),
    ],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "review-thread-resolved-count",
  });
  const { result } = await runGate(environment, github);

  assert.equal(result.report.gateOutcome, "success", result.report.reason);
  assert.deepEqual(result.report.reviewThreads, {
    status: "complete",
    unresolved: 0,
    resolved: 2,
    total: 2,
    diagnostics: [],
  });
});

test("an empty review-thread connection is complete and reports zero inventory", async (context) => {
  const github = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "review-thread-empty-inventory",
  });
  const { result } = await runGate(environment, github);

  assert.equal(result.report.gateOutcome, "success", result.report.reason);
  assert.deepEqual(result.report.reviewThreads, {
    status: "complete",
    unresolved: 0,
    resolved: 0,
    total: 0,
    diagnostics: [],
  });
});

test("review-thread resolution and reopening changes across snapshots fail closed", async (context) => {
  for (const [suffix, before, after] of [
    ["resolved-then-reopened", true, false],
    ["unresolved-then-resolved", false, true],
  ]) {
    const github = createGitHubMock({
      issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
      reviewThreads: [reviewThread({ id: `PRRT_stability_${suffix}` })],
      reviewThreadResponseMutator: (response, { snapshotIndex }) => {
        response.body.data.repository.pullRequest.reviewThreads.nodes[0].isResolved =
          snapshotIndex % 2 === 0 ? before : after;
        return response;
      },
    });
    const environment = runtimeEnvironment(context, {
      suffix: `review-thread-stability-${suffix}`,
    });
    const { result } = await runGate(environment, github);

    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(
      github.statusWrites.some(({ state }) => state === "success"),
      false,
      suffix,
    );
  }
});

test("unstable review-thread inventory hides counts from the prior complete snapshot", async (context) => {
  const resolvedThread = reviewThread({
    id: "PRRT_unstable_pending_counts",
    isResolved: true,
  });
  const github = createGitHubMock({
    issueComments: [ordinaryRequest(), cleanIssueComment(HEAD)],
    reviewThreads: [resolvedThread],
    reviewThreadResponseMutator: (response, { snapshotIndex }) => {
      response.body.data.repository.pullRequest.reviewThreads.nodes[0].id =
        `PRRT_unstable_pending_${snapshotIndex}`;
      return response;
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "unstable-pending-thread-counts",
  });
  const { result } = await runGate(environment, github, {
    stabilityWindowMs: 5,
  });

  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.deepEqual(
    [
      result.report.reviewThreads.unresolved,
      result.report.reviewThreads.resolved,
      result.report.reviewThreads.total,
    ],
    ["unknown", "unknown", "unknown"],
  );
  assert.equal(result.report.reviewThreads.status, "incomplete");

  const summary = readFileSync(environment.GITHUB_STEP_SUMMARY, "utf8");
  assert.match(summary, /Review threads: unknown unresolved, unknown resolved, unknown total/u);
  assert.match(summary, /Review-thread inventory: incomplete/u);
});

test("a review-thread resolution transition may pass after stable convergence", async (context) => {
  const unresolved = reviewThread({ id: "PRRT_converges", isResolved: false });
  const resolved = { ...unresolved, isResolved: true };
  const github = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
    reviewThreadSnapshots: [[unresolved], [resolved], [resolved], [resolved]],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "review-thread-stable-convergence",
  });
  const { result } = await runGate(environment, github);

  assert.equal(result.report.gateOutcome, "success", result.report.reason);
});

test("same-count thread identity swaps remain unstable", async (context) => {
  const github = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
    reviewThreads: [reviewThread({ id: "PRRT_identity_seed", isResolved: true })],
    reviewThreadResponseMutator: (response, { snapshotIndex }) => {
      response.body.data.repository.pullRequest.reviewThreads.nodes[0].id =
        `PRRT_identity_${snapshotIndex}`;
      return response;
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "review-thread-id-fingerprint-instability",
  });
  const { result } = await runGate(environment, github);

  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("incomplete review-thread GraphQL histories fail closed", async (context) => {
  const malformed = (response) => {
    response.body.data.repository.pullRequest.reviewThreads.nodes[0].id = "";
    return response;
  };
  const nullConnection = (response) => {
    response.body.data.repository.pullRequest.reviewThreads = null;
    return response;
  };
  const partialErrors = (response) => {
    response.body.errors = [{ message: "synthetic partial thread inventory" }];
    return response;
  };
  const repeatedCursor = (response, { cursor }) => {
    const connection = response.body.data.repository.pullRequest.reviewThreads;
    connection.pageInfo.hasNextPage = true;
    connection.pageInfo.endCursor = cursor;
    return response;
  };
  const underCount = (response) => {
    const connection = response.body.data.repository.pullRequest.reviewThreads;
    connection.totalCount = connection.nodes.length + 1;
    return response;
  };
  const emptyNextPage = (response) => {
    const connection = response.body.data.repository.pullRequest.reviewThreads;
    connection.nodes = [];
    connection.pageInfo.hasNextPage = true;
    connection.pageInfo.endCursor = "review-thread:empty";
    return response;
  };
  const repositoryMismatch = (response) => {
    response.body.data.repository.nameWithOwner = "someone-else/repo";
    return response;
  };
  const pullRequestMismatch = (response) => {
    response.body.data.repository.pullRequest.number = PR + 1;
    return response;
  };
  const cases = [
    ["malformed node identity", malformed],
    ["null connection", nullConnection],
    ["partial GraphQL errors", partialErrors],
    ["repeated cursor", repeatedCursor],
    ["totalCount under-count", underCount],
    ["empty next page", emptyNextPage],
    ["repository mismatch", repositoryMismatch],
    ["pull request number mismatch", pullRequestMismatch],
  ];

  for (const [label, mutator] of cases) {
    const github = createGitHubMock({
      issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
      reviewThreads: [reviewThread()],
      reviewThreadResponseMutator: (response, contextValue) =>
        mutator(structuredClone(response), contextValue),
    });
    const environment = runtimeEnvironment(context, {
      suffix: `review-thread-incomplete-${label.replaceAll(" ", "-")}`,
    });
    const { result } = await runGate(environment, github);
    assert.notEqual(result.report.gateOutcome, "success", label);
    assert.deepEqual(
      [
        result.report.reviewThreads.unresolved,
        result.report.reviewThreads.resolved,
        result.report.reviewThreads.total,
      ],
      ["unknown", "unknown", "unknown"],
      label,
    );
    assert.equal(result.report.reviewThreads.status, "incomplete", label);
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, label);
  }
});

test("review-thread totals must stay stable across pages", async (context) => {
  const github = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
    reviewThreads: Array.from({ length: 101 }, (_, index) => reviewThread({
      id: `PRRT_total_${index + 1}`,
    })),
    reviewThreadResponseMutator: (response, { cursor }) => {
      if (cursor === null) return response;
      response.body.data.repository.pullRequest.reviewThreads.totalCount += 1;
      return response;
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "review-thread-totalcount-drift",
  });
  const { result } = await runGate(environment, github);

  assert.notEqual(result.report.gateOutcome, "success");
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("duplicate review-thread IDs and inventory budget exhaustion fail closed", async (context) => {
  const duplicateGithub = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
    reviewThreads: Array.from({ length: 101 }, (_, index) => reviewThread({
      id: index === 0 || index === 100
        ? "PRRT_duplicate_across_pages"
        : `PRRT_unique_${index}`,
    })),
  });
  const duplicateEnvironment = runtimeEnvironment(context, {
    suffix: "review-thread-duplicate-id",
  });
  const duplicate = await runGate(duplicateEnvironment, duplicateGithub);
  assert.notEqual(duplicate.result.report.gateOutcome, "success");
  assert.equal(
    duplicateGithub.statusWrites.some(({ state }) => state === "success"),
    false,
  );

  const budgetGithub = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
    reviewThreads: Array.from({ length: 2_001 }, (_, index) => reviewThread({
      id: `PRRT_budget_${index + 1}`,
    })),
  });
  const budgetEnvironment = runtimeEnvironment(context, {
    suffix: "review-thread-budget-exhaustion",
  });
  const budget = await runGate(budgetEnvironment, budgetGithub);
  assert.notEqual(budget.result.report.gateOutcome, "success");
  assert.equal(budgetGithub.statusWrites.some(({ state }) => state === "success"), false);
});

test("review-thread permission failure keeps permission repair as the primary action", async (context) => {
  const github = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
    requestInterceptor: ({ method, path, body }) =>
      method === "POST" && path === "/graphql" &&
        body?.query?.includes("CodexReviewGateReviewThreads")
        ? jsonResponse({ message: "synthetic review-thread permission failure" }, 403)
        : undefined,
  });
  const environment = runtimeEnvironment(context, {
    suffix: "review-thread-permission-primary-action",
  });
  const { result } = await runGate(environment, github);

  assert.notEqual(result.report.gateOutcome, "success");
  assert.equal(result.report.reviewThreads.status, "incomplete");
  assert.deepEqual(
    [
      result.report.reviewThreads.unresolved,
      result.report.reviewThreads.resolved,
      result.report.reviewThreads.total,
    ],
    ["unknown", "unknown", "unknown"],
  );
  assert.equal(result.report.recoveryCode, "repair_permissions");
  assert.match(
    readFileSync(environment.GITHUB_STEP_SUMMARY, "utf8"),
    /Next action: Repair the canonical workflow permissions or installation/u,
  );
  assert.ok(github.calls.some(({ method, path, body }) =>
    method === "POST" && path === "/graphql" &&
    body?.query?.includes("CodexReviewGateReviewThreads")
  ));
});

test("review-thread inventory budget exhaustion keeps expanded limits as the primary action", async (context) => {
  const github = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
    reviewThreads: Array.from({ length: 2_001 }, (_, index) => reviewThread({
      id: `PRRT_primary_budget_${index + 1}`,
    })),
  });
  const environment = runtimeEnvironment(context, {
    suffix: "review-thread-budget-primary-action",
  });
  const { result } = await runGate(environment, github);

  assert.notEqual(result.report.gateOutcome, "success");
  assert.equal(result.report.reviewThreads.status, "incomplete");
  assert.deepEqual(
    [
      result.report.reviewThreads.unresolved,
      result.report.reviewThreads.resolved,
      result.report.reviewThreads.total,
    ],
    ["unknown", "unknown", "unknown"],
  );
  assert.equal(result.report.recoveryCode, "use_expanded_limits");
  assert.match(result.report.reason, /soft limit exceeded.*pull-request review threads/iu);
  assert.match(
    readFileSync(environment.GITHUB_STEP_SUMMARY, "utf8"),
    /Next action: Rerun reconcile.*limits\\_profile=expanded.*Review-thread inventory is incomplete/isu,
  );

  const protectedBudgetGithub = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
    reviewThreads: Array.from({ length: 10_001 }, (_, index) => reviewThread({
      id: `PRRT_protected_budget_${index + 1}`,
    })),
  });
  const protectedBudgetEnvironment = runtimeEnvironment(context, {
    suffix: "review-thread-protected-budget-primary-action",
    limitsProfile: "expanded",
  });
  const protectedBudget = await runGate(protectedBudgetEnvironment, protectedBudgetGithub);

  assert.notEqual(protectedBudget.result.report.gateOutcome, "success");
  assert.equal(protectedBudget.result.report.reviewThreads.status, "incomplete");
  assert.equal(protectedBudget.result.report.recoveryCode, "raise_protected_limit");
  assert.match(
    readFileSync(protectedBudgetEnvironment.GITHUB_STEP_SUMMARY, "utf8"),
    /Next action: Review the evidence volume and raise the protected runtime limit before reconciling.*Review-thread inventory is incomplete/isu,
  );
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

test("REST PENDING reviews with omitted submitted_at block pass without reducing draft findings", async (context) => {
  const pendingReview = {
    id: 403,
    state: "PENDING",
    body: "",
    commit_id: HEAD,
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#pullrequestreview-403`,
    user: HUMAN,
    app: null,
    performed_via_github_app: null,
  };
  const providerPendingReview = {
    id: 405,
    state: "PENDING",
    body: [
      "### 💡 Codex Review",
      "",
      `https://github.com/${REPOSITORY}/blob/${HEAD}/src/pending-finding.mjs#L1`,
    ].join("\n"),
    commit_id: HEAD,
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#pullrequestreview-405`,
    user: CODEX_BOT,
    app: null,
    performed_via_github_app: CODEX_APP,
  };
  const github = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
    reviews: [pendingReview, providerPendingReview],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "pending-review-omitted-submitted-at",
  });
  const { result } = await runGate(environment, github);

  assert.equal(Object.hasOwn(providerPendingReview, "submitted_at"), false);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_provider");
  assert.match(result.report.reason, /official Codex pull-request review remains pending/iu);
  assert.deepEqual(result.report.counts, {
    unresolved: 0,
    resolved: 0,
    historical: 0,
    indeterminate: 0,
  });
  assert.ok(github.calls.some((call) =>
    call.method === "GET" &&
    call.path === `/repos/${REPOSITORY}/pulls/${PR}/reviews/${providerPendingReview.id}`
  ));
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("a provider PENDING submission restarts stability before a terminal clean can pass", async (context) => {
  const request = ordinaryRequest();
  const terminal = approvedReview(HEAD, {
    id: 405,
    submitted_at: "2026-08-25T08:02:00Z",
  });
  const pending = pendingReviewFrom(terminal);
  const github = createGitHubMock({
    issueComments: [request],
    reviewSnapshots: [[pending], [terminal], [terminal], [terminal]],
    reactionsByCommentId: new Map([[String(request.id), [reaction({
      content: "eyes",
      created_at: "2026-08-25T08:01:00Z",
    })]]]),
  });
  const environment = runtimeEnvironment(context, {
    suffix: "pending-review-submission-stability",
  });
  const { result, sleeps } = await runGate(environment, github);

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "success");
  assert.equal(result.report.recoveryCode, "none");
  assert.equal(sleeps.length, 2);
});

test("a provider PENDING submission during exact refetch retries before evaluating a terminal finding", async (context) => {
  const terminal = findingReview(HEAD, {
    id: 406,
    submitted_at: "2026-08-25T08:02:00Z",
  });
  const pending = pendingReviewFrom(terminal);
  let exactReads = 0;
  const github = createGitHubMock({
    issueComments: [workflowRequest()],
    reviewSnapshots: [[pending], [terminal], [terminal]],
    reviewRefetchMutator: (review) => {
      exactReads += 1;
      return exactReads === 1 ? terminal : review;
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "pending-review-submission-exact-refetch",
  });
  const { result, sleeps } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "failure");
  assert.equal(result.report.recoveryCode, "fix_findings");
  assert.deepEqual(result.report.counts, {
    unresolved: 1,
    resolved: 0,
    historical: 0,
    indeterminate: 0,
  });
  assert.equal(sleeps.length, 1);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("an exact pending-to-terminal transition does not poison a lagging review list", async (context) => {
  const terminal = findingReview(HEAD, {
    id: 409,
    submitted_at: "2026-08-25T08:02:00Z",
  });
  const pending = pendingReviewFrom(terminal);
  let exactReads = 0;
  const github = createGitHubMock({
    issueComments: [workflowRequest()],
    reviewSnapshots: [[pending], [pending], [terminal], [terminal]],
    reviewRefetchMutator: (review) => {
      exactReads += 1;
      return exactReads === 1 ? terminal : review;
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "pending-review-lagging-list-after-exact-submission",
  });
  const { result, sleeps } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "failure");
  assert.equal(result.report.recoveryCode, "fix_findings");
  assert.deepEqual(result.report.counts, {
    unresolved: 1,
    resolved: 0,
    historical: 0,
    indeterminate: 0,
  });
  assert.equal(sleeps.length, 2);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("a provider PENDING draft update restarts stability before a terminal finding is evaluated", async (context) => {
  const terminal = findingReview(HEAD, {
    id: 410,
    submitted_at: "2026-08-25T08:03:00Z",
  });
  const pending = pendingReviewFrom(terminal, {
    body: "Initial Codex draft body.",
  });
  const editedPending = {
    ...pending,
    body: "Updated Codex draft body.",
  };
  const github = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
    reviewSnapshots: [[pending], [editedPending], [terminal], [terminal]],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "pending-review-draft-update",
  });
  const { result, sleeps } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "failure");
  assert.equal(result.report.recoveryCode, "fix_findings");
  assert.deepEqual(result.report.counts, {
    unresolved: 1,
    resolved: 0,
    historical: 0,
    indeterminate: 0,
  });
  assert.equal(sleeps.length, 1);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("an exact provider PENDING draft update retries until the review list converges", async (context) => {
  const terminal = findingReview(HEAD, {
    id: 414,
    submitted_at: "2026-08-25T08:03:00Z",
  });
  const pending = pendingReviewFrom(terminal, {
    body: "Initial Codex draft body.",
  });
  const editedPending = {
    ...pending,
    body: "Updated Codex draft body.",
  };
  let exactReads = 0;
  const github = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
    reviewSnapshots: [[pending], [editedPending], [terminal], [terminal]],
    reviewRefetchMutator: (review) => {
      exactReads += 1;
      return exactReads === 1 ? editedPending : review;
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "pending-review-draft-update-exact-refetch",
  });
  const { result, sleeps } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "failure");
  assert.equal(result.report.recoveryCode, "fix_findings");
  assert.deepEqual(result.report.counts, {
    unresolved: 1,
    resolved: 0,
    historical: 0,
    indeterminate: 0,
  });
  assert.equal(sleeps.length, 2);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("a disappearing provider PENDING review remains blocking until exact deletion is confirmed twice", async (context) => {
  const pending = pendingReviewFrom(approvedReview(HEAD, {
    id: 411,
    submitted_at: "2026-08-25T08:03:00Z",
  }));
  const github = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
    reviews: [],
    reviewSnapshots: [[pending], [], [], [], [], []],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "pending-review-exact-deletion-confirmation",
  });
  const { result, sleeps } = await runGate(environment, github);

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "success");
  assert.equal(result.report.recoveryCode, "none");
  assert.equal(sleeps.length, 3);
  assert.equal(
    github.calls.filter(({ method, path }) =>
      method === "GET" &&
      path === `/repos/${REPOSITORY}/pulls/${PR}/reviews/${pending.id}`
    ).length,
    3,
  );
});

test("a temporarily omitted provider PENDING review cannot release an earlier clean", async (context) => {
  const pending = pendingReviewFrom(approvedReview(HEAD, {
    id: 412,
    submitted_at: "2026-08-25T08:03:00Z",
  }));
  let exactReads = 0;
  const github = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
    reviews: [],
    reviewSnapshots: [[pending], [], [], []],
    requestInterceptor: ({ method, path }) => {
      if (
        method === "GET" &&
        path === `/repos/${REPOSITORY}/pulls/${PR}/reviews/${pending.id}` &&
        exactReads++ > 0
      ) {
        return jsonResponse(pending);
      }
      return undefined;
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "pending-review-list-omission",
  });
  const { result } = await runGate(environment, github, {
    stabilityWindowMs: 4,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("a provider PENDING review that reappears after confirmed deletion becomes live again", async (context) => {
  const pending = pendingReviewFrom(approvedReview(HEAD, {
    id: 413,
    submitted_at: "2026-08-25T08:03:00Z",
  }));
  const github = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
    reviews: [],
    reviewSnapshots: [[pending], [], [], [pending], [pending]],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "pending-review-reappearance-after-deletion",
  });
  const { result } = await runGate(environment, github, {
    stabilityWindowMs: 4,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_provider");
  assert.match(result.report.reason, /official Codex pull-request review remains pending/iu);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("only an untimestamped PENDING review can move to a submitted terminal state", async (context) => {
  for (const {
    suffix,
    terminalState,
    pendingFrom,
  } of [
    {
      suffix: "pending-with-submitted-at",
      terminalState: "APPROVED",
      pendingFrom: (terminal) => ({
        ...terminal,
        state: "PENDING",
        submitted_at: "2026-08-25T08:01:00Z",
      }),
    },
    {
      suffix: "pending-to-dismissed",
      terminalState: "DISMISSED",
      pendingFrom: pendingReviewFrom,
    },
    {
      suffix: "pending-commit-drift",
      terminalState: "APPROVED",
      pendingFrom: (terminal) => pendingReviewFrom(terminal, { commit_id: BASE }),
    },
  ]) {
    const request = ordinaryRequest();
    const terminal = approvedReview(HEAD, {
      id: suffix === "pending-with-submitted-at" ? 407 : 408,
      state: terminalState,
      submitted_at: "2026-08-25T08:02:00Z",
    });
    const pending = pendingFrom(terminal);
    const github = createGitHubMock({
      issueComments: [request],
      reviewSnapshots: [[pending], [terminal], [terminal]],
      reactionsByCommentId: new Map([[String(request.id), [reaction({
        content: "eyes",
        created_at: "2026-08-25T08:01:00Z",
      })]]]),
    });
    const environment = runtimeEnvironment(context, {
      suffix: `pending-review-invalid-transition-${suffix}`,
    });
    const { result } = await runGate(environment, github);

    assert.equal(result.exitCode, 1);
    assert.equal(result.report.executionHealth, "unhealthy");
    assert.equal(result.report.gateOutcome, "pending");
    assert.equal(result.report.recoveryCode, "wait_then_reconcile");
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
  }
});

test("a terminal review with omitted submitted_at remains fail-closed", async (context) => {
  const malformedTerminalReview = {
    id: 404,
    state: "APPROVED",
    body: "",
    commit_id: HEAD,
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#pullrequestreview-404`,
    user: HUMAN,
    app: null,
    performed_via_github_app: null,
  };
  const github = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
    reviews: [malformedTerminalReview],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "terminal-review-omitted-submitted-at",
  });
  const { result } = await runGate(environment, github);

  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
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

  const globallyDuplicated = buildV2ReactionCleanArtifacts(requests, new Map([
    ["101", [reaction({ id: 205, created_at: "2026-08-25T08:01:00Z" })]],
    ["102", [reaction({ id: 205, created_at: "2026-08-25T08:02:00Z" })]],
  ]));
  assert.equal(globallyDuplicated.artifacts.length, 0);
  assert.match(globallyDuplicated.errors[0], /identity 205 appears more than once/u);
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
  const deletedCommentCalls = github.calls.filter(({ path, body }) =>
    path === "/graphql" && body?.query?.includes("CodexReviewGateDeletedComments")
  );
  assert.equal(deletedCommentCalls.length, 4);
  const baseEpochCalls = deletedCommentCalls.filter(({ body }) =>
    body.variables.includeBaseEpoch === true
  );
  assert.equal(baseEpochCalls.length, 4);
  for (const { body } of baseEpochCalls) {
    assert.match(body.query, /BASE_REF_CHANGED_EVENT/u);
    assert.match(body.query, /BASE_REF_FORCE_PUSHED_EVENT/u);
    assert.match(body.query, /timelineItems\(\s*last: 1/su);
  }
  for (const { body } of deletedCommentCalls) {
    assert.deepEqual(body.variables, {
      owner: OWNER,
      repo: REPO,
      number: PR,
      cursor: null,
      commentCursor: null,
      includeDeleted: true,
      includeComments: true,
      includeBaseEpoch: true,
    });
    assert.match(body.query, /totalCount/u);
    assert.match(body.query, /databaseId:\s*fullDatabaseId/u);
    assert.match(body.query, /\bbody\b/u);
    assert.match(body.query, /lastEditedAt/u);
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
    issueComments: [ordinaryRequest({ user: READER }), findingIssueComment(HEAD)],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "finding-output-persistence-failure",
  });
  environment.CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION = "write";
  mkdirSync(environment.GITHUB_OUTPUT);

  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "failure");
  assert.equal(result.report.recoveryCode, "fix_findings");
  assert.equal(result.report.retrySafe, false);
  assert.equal(result.report.requiresReplacementPr, true);
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
  assert.match(summary, /replacement PR/iu);
  assert.match(summary, /Failed to persist the v2 gate report/iu);
});

test("output failure preserves replacement-required pending lineage", async (context) => {
  const generationB = workflowRequest({
    id: 102,
    body: canonicalRequestBody(HEAD, { runId: "124" }),
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const github = createGitHubMock({
    issueComments: [workflowRequest(), generationB],
    reactionsByCommentId: new Map([["102", [reaction({
      id: 652,
      created_at: "2026-08-25T08:03:00Z",
    })]]]),
  });
  const environment = runtimeEnvironment(context, {
    suffix: "pending-replacement-output-persistence-failure",
  });
  mkdirSync(environment.GITHUB_OUTPUT);

  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "unknown");
  assert.equal(result.report.recoveryCode, "repair_permissions");
  assert.equal(result.report.retrySafe, false);
  assert.equal(result.report.requiresReplacementPr, true);
  const summary = readFileSync(environment.GITHUB_STEP_SUMMARY, "utf8");
  assert.match(summary, /Failed to persist the v2 gate report/iu);
  assert.match(summary, /do not add another review boundary on the original PR/iu);
  assert.match(summary, /requires a replacement PR/iu);
  assert.match(summary, /exactly one canonical review generation/iu);
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
    const sticky = github.stickyCreates[0];
    assert.match(
      sticky,
      /Verifier run 7001 attempt 2 https:\/\/github\.com\/owner\/repo\/actions\/runs\/7001 was observed at /u,
      action,
    );
    const observedAt = /was observed at (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z);/u.exec(sticky)?.[1];
    assert.ok(observedAt, action);
    const summary = readFileSync(environment.GITHUB_STEP_SUMMARY, "utf8");
    assert.match(summary, /Verifier attempt: \*\*2\*\*/u, action);
    assert.ok(summary.includes(`Observation time: **${observedAt}**`), action);
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

test("recognized summary issue_comment events are no-ops before targeted refetch", async (context) => {
  for (const action of ["created", "edited"]) {
    for (const readback of ["missing", "changed"]) {
      const summary = officialReviewSummaryComment({
        id: action === "created" ? 304 : 305,
        created_at: "2026-08-25T08:02:00Z",
        updated_at: action === "edited"
          ? "2026-08-25T08:03:00Z"
          : "2026-08-25T08:02:00Z",
      });
      const github = createGitHubMock({
        requestInterceptor: ({ method, path }) => {
          if (
            method !== "GET" ||
            path !== `/repos/${REPOSITORY}/issues/comments/${summary.id}`
          ) {
            return undefined;
          }
          if (readback === "missing") {
            return jsonResponse({ message: "comment was removed" }, 404);
          }
          return jsonResponse({
            ...summary,
            body: `${summary.body}\nchanged after the event payload`,
          });
        },
      });
      const environment = runtimeEnvironment(context, {
        suffix: `summary-event-${action}-${readback}`,
        eventName: "issue_comment",
        expectedHeadSha: "",
        requestReview: "false",
        requestCommentId: String(summary.id),
        event: issueCommentEvent(action, summary),
      });
      const { result } = await runGate(environment, github);

      assert.equal(result.exitCode, 0, `${action}/${readback}: ${result.report.reason}`);
      assert.equal(result.report.executionHealth, "healthy", `${action}/${readback}`);
      assert.equal(result.report.gateOutcome, "not_applicable", `${action}/${readback}`);
      assert.deepEqual(github.rerunRequests, [], `${action}/${readback}`);
      assert.equal(
        github.calls.some(({ method, path }) =>
          method === "GET" && path === `/repos/${REPOSITORY}/issues/comments/${summary.id}`
        ),
        false,
        `${action}/${readback}: recognized summary was directly refetched`,
      );
      assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
    }
  }
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
      hasRequestReactionGraphQlCall(github, ordinary.id),
      true,
      `${suffix}: pre-epoch ordinary request reactions remain negative liveness evidence`,
    );
  }
});

test("same-second base-epoch requests remain physical without gaining positive authority", async (context) => {
  const epoch = baseRefChangedEvent();
  const generationB = workflowRequest({
    id: 102,
    body: canonicalRequestBody(HEAD, { runId: "124" }),
    created_at: "2026-08-25T08:10:00Z",
    updated_at: "2026-08-25T08:10:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const physicalOnlyAtEpoch = ordinaryRequest({
    id: 101,
    user: ACTIONS_BOT,
    created_at: epoch.createdAt,
    updated_at: epoch.createdAt,
  });
  const ambiguousGitHub = createGitHubMock({
    baseEpoch: epoch,
    issueComments: [physicalOnlyAtEpoch, generationB],
    reactionsByCommentId: new Map([["102", [reaction({
      id: 500,
      created_at: "2026-08-25T08:11:00Z",
    })]]]),
  });
  const ambiguousEnvironment = runtimeEnvironment(context, {
    suffix: "base-epoch-same-second-physical-only",
  });
  const { result: ambiguous } = await runGate(ambiguousEnvironment, ambiguousGitHub);
  assert.equal(ambiguous.exitCode, 1);
  assert.equal(ambiguous.report.gateOutcome, "pending");
  assert.equal(ambiguous.report.recoveryCode, "request_clean_generation");
  assert.match(ambiguous.report.reason, /earlier request 101.*newer request 102/iu);
  assert.equal(ambiguousGitHub.statusWrites.some(({ state }) => state === "success"), false);

  const canonicalAtEpoch = workflowRequest({
    id: 101,
    created_at: epoch.createdAt,
    updated_at: epoch.createdAt,
  });
  const historicallyClosedGitHub = createGitHubMock({
    baseEpoch: epoch,
    issueComments: [canonicalAtEpoch, generationB],
    reactionsByCommentId: new Map([
      ["101", [reaction({ id: 501, created_at: "2026-08-25T08:06:00Z" })]],
      ["102", [reaction({ id: 502, created_at: "2026-08-25T08:11:00Z" })]],
    ]),
  });
  const historicallyClosedEnvironment = runtimeEnvironment(context, {
    suffix: "base-epoch-same-second-historical-direct-closure",
  });
  const { result: historicallyClosed } = await runGate(
    historicallyClosedEnvironment,
    historicallyClosedGitHub,
  );
  assert.equal(historicallyClosed.exitCode, 0);
  assert.equal(historicallyClosed.report.gateOutcome, "success");
  assert.match(historicallyClosed.report.reason, /request-reaction 502/u);
  assert.equal(
    hasRequestReactionGraphQlCall(historicallyClosedGitHub, 101),
    true,
  );
});

test("a pre-epoch same-head request can veto a later direct clean with post-epoch eyes", async (context) => {
  const epoch = baseRefChangedEvent();
  const generationB = workflowRequest({
    id: 102,
    body: canonicalRequestBody(HEAD, { runId: "124" }),
    created_at: "2026-08-25T08:10:00Z",
    updated_at: "2026-08-25T08:10:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const scenarios = [
    ["canonical-before-clean", workflowRequest({
      id: 101,
      created_at: "2026-08-25T08:04:00Z",
      updated_at: "2026-08-25T08:04:00Z",
    }), "2026-08-25T08:10:30Z", 510],
    ["canonical-after-clean", workflowRequest({
      id: 101,
      created_at: "2026-08-25T08:04:00Z",
      updated_at: "2026-08-25T08:04:00Z",
    }), "2026-08-25T08:12:00Z", 512],
    ["ordinary-before-clean", ordinaryRequest({
      id: 101,
      created_at: "2026-08-25T08:04:00Z",
      updated_at: "2026-08-25T08:04:00Z",
    }), "2026-08-25T08:10:30Z", 514],
  ];
  for (const [suffix, generationA, eyesAt, eyesId] of scenarios) {
    const github = createGitHubMock({
      baseEpoch: epoch,
      issueComments: [generationA, generationB],
      reactionsByCommentId: new Map([
        ["101", [reaction({
          id: eyesId,
          content: "eyes",
          created_at: eyesAt,
        })]],
        ["102", [reaction({
          id: eyesId + 1,
          created_at: "2026-08-25T08:11:00Z",
        })]],
      ]),
    });
    const environment = runtimeEnvironment(context, {
      suffix: `pre-epoch-request-post-epoch-eyes-veto-${suffix}`,
    });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "wait_provider", suffix);
    assert.match(result.report.reason, /review is still in progress/iu, suffix);
    assert.equal(
      hasRequestReactionGraphQlCall(github, 101),
      true,
      `${suffix}: pre-epoch requests retain a complete post-epoch liveness inventory`,
    );
    assert.equal(
      github.statusWrites.some(({ state }) => state === "success"),
      false,
      suffix,
    );
  }
});

test("duplicate reaction identities across pre-epoch and current inventories block", async (context) => {
  const epoch = baseRefChangedEvent();
  const preEpoch = ordinaryRequest({
    created_at: "2026-08-25T08:04:00Z",
    updated_at: "2026-08-25T08:04:00Z",
  });
  const current = workflowRequest({
    id: 102,
    body: canonicalRequestBody(HEAD, { runId: "124" }),
    created_at: "2026-08-25T08:10:00Z",
    updated_at: "2026-08-25T08:10:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const github = createGitHubMock({
    baseEpoch: epoch,
    issueComments: [preEpoch, current],
    reactionsByCommentId: new Map([
      ["101", [reaction({
        id: 520,
        content: "eyes",
        created_at: "2026-08-25T08:09:00Z",
      })]],
      ["102", [reaction({ id: 520, created_at: "2026-08-25T08:11:00Z" })]],
    ]),
  });
  const environment = runtimeEnvironment(context, {
    suffix: "global-reaction-identity-duplicate",
  });
  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.match(result.report.reason, /repeated official Codex identity 520/iu);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("a cross-request +1 tied with the selected clean cannot settle older eyes", async (context) => {
  const generationA = workflowRequest();
  const generationB = workflowRequest({
    id: 102,
    body: canonicalRequestBody(HEAD, { runId: "124" }),
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const github = createGitHubMock({
    issueComments: [generationA, generationB],
    reactionsByCommentId: new Map([
      ["101", [
        reaction({ id: 521, created_at: "2026-08-25T08:01:00Z" }),
        reaction({ id: 522, content: "eyes", created_at: "2026-08-25T08:02:30Z" }),
        reaction({ id: 523, created_at: "2026-08-25T08:03:00Z" }),
      ]],
      ["102", [reaction({ id: 524, created_at: "2026-08-25T08:03:00Z" })]],
    ]),
  });
  const environment = runtimeEnvironment(context, {
    suffix: "cross-request-plus-one-tied-with-clean",
  });
  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_provider");
  assert.match(result.report.reason, /review is still in progress/iu);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("the only canonical request at the base epoch cannot gain authority from its own +1", async (context) => {
  const epoch = baseRefChangedEvent();
  const request = workflowRequest({
    created_at: epoch.createdAt,
    updated_at: epoch.createdAt,
  });
  const github = createGitHubMock({
    baseEpoch: epoch,
    issueComments: [request],
    reactionsByCommentId: new Map([["101", [reaction({
      id: 512,
      created_at: "2026-08-25T08:06:00Z",
    })]]]),
  });
  const environment = runtimeEnvironment(context, {
    suffix: "only-canonical-request-at-base-epoch",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "request_clean_generation");
  assert.equal(result.report.requiresReplacementPr, false);
  assert.match(result.report.reason, /strictly newer than base epoch/iu);
  assert.equal(
    hasRequestReactionGraphQlCall(github, 101),
    true,
  );
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
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

  const nextGeneration = workflowRequest({
    id: 102,
    body: canonicalRequestBody(HEAD, { runId: "124" }),
    created_at: "2026-08-25T08:12:00Z",
    updated_at: "2026-08-25T08:12:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const firstGenerationTerminal = cleanIssueComment(HEAD, {
    id: 203,
    created_at: "2026-08-25T08:11:00Z",
    updated_at: "2026-08-25T08:11:00Z",
  });
  const providerGapAfterEpochGitHub = createGitHubMock({
    baseEpoch: epoch,
    issueComments: [generation, firstGenerationTerminal, nextGeneration],
    reactionsByCommentId: new Map([["102", [reaction({
      id: 503,
      created_at: "2026-08-25T08:15:00Z",
    })]]]),
  });
  const providerGapAfterEpochEnvironment = runtimeEnvironment(context, {
    suffix: "base-epoch-provider-terminal-cannot-close-first-gap",
  });
  const { result: providerGapAfterEpoch } = await runGate(
    providerGapAfterEpochEnvironment,
    providerGapAfterEpochGitHub,
  );
  assert.equal(providerGapAfterEpoch.exitCode, 1);
  assert.equal(providerGapAfterEpoch.report.gateOutcome, "pending");
  assert.equal(providerGapAfterEpoch.report.recoveryCode, "request_clean_generation");
  assert.match(providerGapAfterEpoch.report.reason, /earlier request 101.*newer request 102/iu);
  assert.equal(
    providerGapAfterEpochGitHub.statusWrites.some(({ state }) => state === "success"),
    false,
  );

  const directChainAfterEpochGitHub = createGitHubMock({
    baseEpoch: epoch,
    issueComments: [generation, firstGenerationTerminal, nextGeneration],
    reactionsByCommentId: new Map([
      ["101", [reaction({ id: 504, created_at: "2026-08-25T08:11:30Z" })]],
      ["102", [reaction({ id: 505, created_at: "2026-08-25T08:15:00Z" })]],
    ]),
  });
  const directChainAfterEpochEnvironment = runtimeEnvironment(context, {
    suffix: "base-epoch-all-generations-directly-closed",
  });
  const { result: directChainAfterEpoch } = await runGate(
    directChainAfterEpochEnvironment,
    directChainAfterEpochGitHub,
  );
  assert.equal(directChainAfterEpoch.exitCode, 0);
  assert.equal(directChainAfterEpoch.report.gateOutcome, "success");
  assert.match(directChainAfterEpoch.report.reason, /request-reaction 505/u);

  const ordinaryBoundary = ordinaryRequest({
    id: 102,
    created_at: "2026-08-25T08:12:00Z",
    updated_at: "2026-08-25T08:12:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const crossedBoundaryGitHub = createGitHubMock({
    baseEpoch: epoch,
    issueComments: [generation, ordinaryBoundary],
    reactionsByCommentId: new Map([[String(generation.id), [reaction({
      id: 502,
      created_at: "2026-08-25T08:15:00Z",
    })]]]),
  });
  const crossedBoundaryEnvironment = runtimeEnvironment(context, {
    suffix: "base-epoch-direct-reaction-after-ordinary-boundary",
  });
  const { result: crossedBoundary } = await runGate(
    crossedBoundaryEnvironment,
    crossedBoundaryGitHub,
  );
  assert.equal(crossedBoundary.report.gateOutcome, "success", crossedBoundary.report.reason);
  assert.equal(crossedBoundary.report.recoveryCode, "none");
});

test("same-head old-base requests remain physical after a base epoch without positive authority", async (context) => {
  const epoch = baseRefChangedEvent();
  const generationA = workflowRequest({
    id: 101,
    created_at: "2026-08-25T08:10:00Z",
    updated_at: "2026-08-25T08:10:00Z",
  });
  const oldBaseGeneration = workflowRequest({
    id: 102,
    body: canonicalRequestBody(HEAD, {
      baseSha: OLD_HEAD,
      baseRef: "release",
      baseRepositoryId: "999",
      runId: "124",
    }),
    created_at: "2026-08-25T08:12:00Z",
    updated_at: "2026-08-25T08:12:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const generationC = workflowRequest({
    id: 103,
    body: canonicalRequestBody(HEAD, { runId: "125" }),
    created_at: "2026-08-25T08:14:00Z",
    updated_at: "2026-08-25T08:14:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-103`,
  });

  const unclosedGitHub = createGitHubMock({
    baseEpoch: epoch,
    issueComments: [generationA, oldBaseGeneration, generationC],
    reactionsByCommentId: new Map([
      ["101", [reaction({ id: 560, created_at: "2026-08-25T08:11:00Z" })]],
      ["103", [reaction({ id: 562, created_at: "2026-08-25T08:15:00Z" })]],
    ]),
  });
  const unclosedEnvironment = runtimeEnvironment(context, {
    suffix: "base-epoch-old-base-physical-gap",
  });
  const { result: unclosed } = await runGate(unclosedEnvironment, unclosedGitHub);
  assert.equal(unclosed.exitCode, 1);
  assert.equal(unclosed.report.gateOutcome, "pending");
  assert.equal(unclosed.report.recoveryCode, "request_clean_generation");
  assert.match(unclosed.report.reason, /earlier request 102.*newer request 103/iu);
  assert.equal(
    hasRequestReactionGraphQlCall(unclosedGitHub, 102),
    true,
    "the authorized same-head old-base request needs a complete reaction inventory",
  );

  const historicalClosureGitHub = createGitHubMock({
    baseEpoch: epoch,
    issueComments: [generationA, oldBaseGeneration, generationC],
    reactionsByCommentId: new Map([
      ["101", [reaction({ id: 560, created_at: "2026-08-25T08:11:00Z" })]],
      ["102", [reaction({ id: 561, created_at: "2026-08-25T08:13:00Z" })]],
      ["103", [reaction({ id: 562, created_at: "2026-08-25T08:15:00Z" })]],
    ]),
  });
  const historicalClosureEnvironment = runtimeEnvironment(context, {
    suffix: "base-epoch-old-base-historical-closure",
  });
  const { result: historicalClosure } = await runGate(
    historicalClosureEnvironment,
    historicalClosureGitHub,
  );
  assert.equal(historicalClosure.exitCode, 0);
  assert.equal(historicalClosure.report.gateOutcome, "success");
  assert.match(historicalClosure.report.reason, /request-reaction 562/u);

  const lateHistoricalEyesGitHub = createGitHubMock({
    baseEpoch: epoch,
    issueComments: [generationA, oldBaseGeneration, generationC],
    reactionsByCommentId: new Map([
      ["101", [reaction({ id: 560, created_at: "2026-08-25T08:11:00Z" })]],
      ["102", [
        reaction({ id: 561, created_at: "2026-08-25T08:13:00Z" }),
        reaction({
          id: 563,
          content: "eyes",
          created_at: "2026-08-25T08:16:00Z",
        }),
      ]],
      ["103", [reaction({ id: 562, created_at: "2026-08-25T08:15:00Z" })]],
    ]),
  });
  const lateHistoricalEyesEnvironment = runtimeEnvironment(context, {
    suffix: "base-epoch-old-base-late-eyes",
  });
  const { result: lateHistoricalEyes } = await runGate(
    lateHistoricalEyesEnvironment,
    lateHistoricalEyesGitHub,
  );
  assert.equal(lateHistoricalEyes.exitCode, 1);
  assert.equal(lateHistoricalEyes.report.gateOutcome, "pending");
  assert.equal(lateHistoricalEyes.report.recoveryCode, "wait_provider");
  assert.match(lateHistoricalEyes.report.reason, /review is still in progress/u);
  assert.equal(
    lateHistoricalEyesGitHub.statusWrites.some(({ state }) => state === "success"),
    false,
  );

  const noAuthorityGitHub = createGitHubMock({
    baseEpoch: epoch,
    issueComments: [generationA, oldBaseGeneration],
    reactionsByCommentId: new Map([
      ["101", [reaction({ id: 560, created_at: "2026-08-25T08:11:00Z" })]],
      ["102", [reaction({ id: 561, created_at: "2026-08-25T08:13:00Z" })]],
    ]),
  });
  const noAuthorityEnvironment = runtimeEnvironment(context, {
    suffix: "base-epoch-old-base-no-positive-authority",
  });
  const { result: noAuthority } = await runGate(noAuthorityEnvironment, noAuthorityGitHub);
  assert.equal(noAuthority.exitCode, 1);
  assert.equal(noAuthority.report.gateOutcome, "pending");
  assert.equal(noAuthority.report.recoveryCode, "request_clean_generation");
  assert.equal(noAuthority.report.requiresReplacementPr, false);
  assert.equal(noAuthorityGitHub.statusWrites.some(({ state }) => state === "success"), false);
});

test("same-head stale-base requests preserve a physical gap without a base epoch", async (context) => {
  const generationA = workflowRequest({ id: 101 });
  const staleBaseGeneration = workflowRequest({
    id: 102,
    body: canonicalRequestBody(HEAD, {
      baseSha: OLD_HEAD,
      baseRef: "release",
      baseRepositoryId: "999",
      runId: "124",
    }),
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const generationC = workflowRequest({
    id: 103,
    body: canonicalRequestBody(HEAD, { runId: "125" }),
    created_at: "2026-08-25T08:04:00Z",
    updated_at: "2026-08-25T08:04:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-103`,
  });
  const github = createGitHubMock({
    issueComments: [generationA, staleBaseGeneration, generationC],
    reactionsByCommentId: new Map([
      ["101", [reaction({ id: 520, created_at: "2026-08-25T08:01:00Z" })]],
      ["103", [reaction({ id: 522, created_at: "2026-08-25T08:05:00Z" })]],
    ]),
  });
  const environment = runtimeEnvironment(context, {
    suffix: "no-epoch-stale-base-physical-gap",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "request_clean_generation");
  assert.match(result.report.reason, /earlier request 102.*newer request 103/iu);
  assert.equal(
    hasRequestReactionGraphQlCall(github, 102),
    true,
  );
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
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

test("a base epoch observed in a failed snapshot must reappear or advance before stability recovers", async (context) => {
  const epochE = baseRefChangedEvent({
    id: "BRE_failed_snapshot_E",
    createdAt: "2026-08-25T07:00:00Z",
  });
  const epochF = baseRefForcePushedEvent({
    id: "BRFPE_failed_snapshot_F",
    createdAt: "2026-08-25T07:30:00Z",
  });
  for (const [suffix, baseEpochSequence, shouldSucceed] of [
    ["missing", [epochE, null, null], false],
    ["reappears", [epochE, null, epochE, epochE], true],
    ["strictly-newer", [epochE, epochF, epochF], true],
    ["older-then-reappears", [epochF, epochE, epochF, epochF], true],
  ]) {
    let reviewReads = 0;
    const github = createGitHubMock({
      issueComments: [workflowRequest()],
      reactionsByCommentId: new Map([["101", [reaction()]]]),
      baseEpochSequence,
      requestInterceptor: ({ method, path }) => {
        if (
          method === "GET" &&
          path === `/repos/${REPOSITORY}/pulls/${PR}/reviews` &&
          reviewReads++ === 0
        ) {
          return jsonResponse({ message: "synthetic sibling carrier failure" }, 502);
        }
        return undefined;
      },
    });
    const environment = runtimeEnvironment(context, {
      suffix: `failed-snapshot-base-epoch-${suffix}`,
    });

    const { result } = await runGate(environment, github, {
      stabilityWindowMs: 8,
    });

    if (shouldSucceed) {
      assert.equal(result.exitCode, 0, suffix);
      assert.equal(result.report.executionHealth, "healthy", suffix);
      assert.equal(result.report.gateOutcome, "success", suffix);
      assert.equal(result.report.recoveryCode, "none", suffix);
    } else {
      assert.equal(result.exitCode, 1, suffix);
      assert.equal(result.report.executionHealth, "unhealthy", suffix);
      assert.equal(result.report.gateOutcome, "pending", suffix);
      assert.equal(result.report.recoveryCode, "wait_then_reconcile", suffix);
      assert.match(
        result.report.reason,
        /base-epoch (?:filteredCount decreased|event .*disappeared)/iu,
        suffix,
      );
      assert.equal(
        github.statusWrites.some(({ state }) => state === "success"),
        false,
        suffix,
      );
    }
  }
});

test("base-epoch identity conflicts permanently poison the run", async (context) => {
  const epoch = baseRefChangedEvent({
    id: "BRE_failed_snapshot_changed",
    createdAt: "2026-08-25T07:00:00Z",
  });
  const changed = {
    ...epoch,
    currentRefName: "conflicting-base-ref",
  };
  const ambiguous = baseRefForcePushedEvent({
    id: "BRFPE_failed_snapshot_ambiguous",
    createdAt: epoch.createdAt,
  });
  for (const [suffix, conflict, expectedReason] of [
    ["fingerprint-change", changed,
      /previously observed base-epoch event BRE_failed_snapshot_changed changed/iu],
    ["ambiguous-order", ambiguous,
      /base-epoch events .* have ambiguous ordering/iu],
  ]) {
    let reviewReads = 0;
    const github = createGitHubMock({
      issueComments: [workflowRequest()],
      reactionsByCommentId: new Map([["101", [reaction()]]]),
      baseEpochSequence: [epoch, conflict, epoch, epoch],
      requestInterceptor: ({ method, path }) => {
        if (
          method === "GET" &&
          path === `/repos/${REPOSITORY}/pulls/${PR}/reviews` &&
          reviewReads++ === 0
        ) {
          return jsonResponse({ message: "synthetic sibling carrier failure" }, 502);
        }
        return undefined;
      },
    });
    const environment = runtimeEnvironment(context, {
      suffix: `failed-snapshot-base-epoch-${suffix}`,
    });

    const { result } = await runGate(environment, github, {
      stabilityWindowMs: 6,
    });

    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.executionHealth, "unhealthy", suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "wait_then_reconcile", suffix);
    assert.match(result.report.reason, expectedReason, suffix);
    assert.equal(
      github.statusWrites.some(({ state }) => state === "success"),
      false,
      suffix,
    );
  }
});

test("a deleted-comment inventory change can stabilize only as pending", async (context) => {
  for (const [suffix, deletedCommentAuthor] of [
    ["user", { __typename: "User", login: HUMAN.login }],
    ["github-actions", { __typename: "Bot", login: ACTIONS_BOT.login }],
  ]) {
    const deleted = deletedCommentEvent({
      id: `CDE_dynamic_${suffix}`,
      deletedCommentAuthor,
    });
    const github = createGitHubMock({
      issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
      deletedCommentEventSnapshots: [[], [deleted], [deleted], [deleted]],
    });
    const environment = runtimeEnvironment(context, {
      suffix: `deleted-comment-snapshot-change-${suffix}`,
    });
    const { result, sleeps } = await runGate(environment, github, {
      stabilityWindowMs: 4,
    });
    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.executionHealth, "healthy", suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "request_clean_generation", suffix);
    assert.match(result.report.reason, new RegExp(`deleted:CDE_dynamic_${suffix}`, "iu"), suffix);
    assert.deepEqual(sleeps, [1], suffix);
    assert.equal(
      github.statusWrites.some(({ state }) => state === "success"),
      false,
      suffix,
    );
  }
});

test("a pre-epoch deletion does not force replacement after a new request-bound clean", async (context) => {
  const epoch = baseRefChangedEvent({ createdAt: "2026-08-25T08:05:00Z" });
  const generation = workflowRequest({
    created_at: "2026-08-25T08:10:00Z",
    updated_at: "2026-08-25T08:10:00Z",
  });
  const github = createGitHubMock({
    baseEpoch: epoch,
    issueComments: [generation],
    reviews: [findingReview(HEAD, {
      id: 401,
      submitted_at: "2026-08-25T08:11:00Z",
    })],
    reactionsByCommentId: new Map([["101", [reaction({
      id: 531,
      created_at: "2026-08-25T08:12:00Z",
    })]]]),
    deletedCommentEvents: [deletedCommentEvent({
      id: "CDE_pre_epoch",
      createdAt: "2026-08-25T07:00:00Z",
    })],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "pre-epoch-deletion-does-not-force-replacement",
  });
  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.gateOutcome, "failure");
  assert.equal(result.report.recoveryCode, "fix_findings");
  assert.equal(result.report.counts.unresolved, 1);
  assert.equal(result.report.requiresReplacementPr, false);
  const summary = readFileSync(environment.GITHUB_STEP_SUMMARY, "utf8");
  assert.match(summary, /Fix the unresolved Codex findings/u);
  assert.match(summary, /request a new review generation/iu);
  assert.doesNotMatch(summary, /replacement PR/iu);
});

test("a temporarily missing deleted-comment identity can recover in a complete stable inventory", async (context) => {
  const deleted = deletedCommentEvent({
    id: "CDE_restored_A",
    createdAt: "2026-08-25T07:00:00Z",
  });
  const replacement = deletedCommentEvent({
    id: "CDE_restored_B",
    createdAt: "2026-08-25T07:01:00Z",
  });
  const github = createGitHubMock({
    baseEpoch: baseRefChangedEvent({ createdAt: "2026-08-25T07:30:00Z" }),
    issueComments: [workflowRequest()],
    reactionsByCommentId: new Map([["101", [reaction()]]]),
    deletedCommentEventSnapshots: [
      [deleted],
      [replacement],
      [deleted, replacement],
      [deleted, replacement],
    ],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "deleted-comment-restored-stable-inventory",
  });

  const { result } = await runGate(environment, github, {
    stabilityWindowMs: 6,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "success");
  assert.equal(result.report.recoveryCode, "none");
});

test("a continuously missing deleted-comment identity prevents a stable snapshot", async (context) => {
  const deleted = deletedCommentEvent({
    id: "CDE_irreversible",
    createdAt: "2026-08-25T07:00:00Z",
  });
  const replacement = deletedCommentEvent({
    id: "CDE_replacement",
    createdAt: "2026-08-25T07:01:00Z",
  });
  const github = createGitHubMock({
    baseEpoch: baseRefChangedEvent({ createdAt: "2026-08-25T07:30:00Z" }),
    issueComments: [workflowRequest()],
    reactionsByCommentId: new Map([["101", [reaction()]]]),
    deletedCommentEventSnapshots: [
      [deleted],
      [replacement],
      [replacement],
      [replacement],
    ],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "deleted-comment-cannot-disappear",
  });
  const { result } = await runGate(environment, github, {
    stabilityWindowMs: 4,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.match(result.report.reason, /CDE_irreversible.*disappeared/iu);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("a changed fingerprint for the same deleted-comment identity permanently poisons the run", async (context) => {
  const deleted = deletedCommentEvent({
    id: "CDE_changed_fingerprint",
    createdAt: "2026-08-25T07:00:00Z",
  });
  const changed = {
    ...deleted,
    actor: { __typename: "User", login: "conflicting-actor" },
  };
  const github = createGitHubMock({
    baseEpoch: baseRefChangedEvent({ createdAt: "2026-08-25T07:30:00Z" }),
    issueComments: [workflowRequest()],
    reactionsByCommentId: new Map([["101", [reaction()]]]),
    deletedCommentEventSnapshots: [
      [deleted],
      [changed],
      [deleted],
      [deleted],
    ],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "deleted-comment-fingerprint-change-poison",
  });

  const { result } = await runGate(environment, github, {
    stabilityWindowMs: 4,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.match(
    result.report.reason,
    /deleted-comment (?:event CDE_changed_fingerprint actor|event CDE_changed_fingerprint changed)/iu,
  );
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("a deleted event seen before a later pagination failure remains latched", async (context) => {
  const first = deletedCommentEvent({ id: "CDE_partial_page_1" });
  const second = deletedCommentEvent({
    id: "CDE_partial_page_2",
    createdAt: "2026-08-25T08:03:00Z",
  });
  const replacement = deletedCommentEvent({
    id: "CDE_partial_page_replacement",
    createdAt: "2026-08-25T08:04:00Z",
  });
  const github = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
    deletedCommentEventSnapshots: [
      [first, second],
      [first, replacement],
      [first, replacement],
      [first, replacement],
    ],
    deletedCommentPageSize: 1,
    deletedCommentResponseMutator: (response, { cursor, snapshotIndex }) => {
      if (snapshotIndex !== 0 || cursor !== "deleted-comment:1") return response;
      const mutated = structuredClone(response);
      const connection = mutated.data.repository.pullRequest.timelineItems;
      connection.pageInfo = {
        hasNextPage: true,
        endCursor: null,
      };
      return mutated;
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "partial-deleted-comment-page-latch",
  });
  const { result } = await runGate(environment, github, {
    stabilityWindowMs: 4,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.match(result.report.reason, /CDE_partial_page_2.*disappeared/iu);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("an incomplete deleted-comment page permanently latches its observed inventory lower bound", async (context) => {
  const first = deletedCommentEvent({ id: "CDE_count_floor_1" });
  const github = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
    deletedCommentEventSnapshots: [[first], [first], [first]],
    deletedCommentPageSize: 1,
    deletedCommentResponseMutator: (response, { cursor, snapshotIndex }) => {
      if (snapshotIndex !== 0 || cursor !== null) return response;
      const mutated = structuredClone(response);
      const connection = mutated.data.repository.pullRequest.timelineItems;
      connection.totalCount = 2;
      connection.filteredCount = 2;
      connection.pageInfo = {
        hasNextPage: true,
        endCursor: "deleted-comment:1",
      };
      return mutated;
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "partial-deleted-comment-count-floor",
  });

  const { result } = await runGate(environment, github, {
    stabilityWindowMs: 4,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.match(
    result.report.reason,
    /deleted-comment inventory lower bound decreased from 2 to 1/iu,
  );
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("a later deletion page latches its consumed-plus-remaining inventory lower bound", async (context) => {
  const first = deletedCommentEvent({ id: "CDE_later_floor_1" });
  const second = deletedCommentEvent({
    id: "CDE_later_floor_2",
    createdAt: "2026-08-25T08:03:00Z",
  });
  const github = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
    deletedCommentEventSnapshots: [
      [first, second],
      [first, second],
      [first, second],
      [first, second],
    ],
    deletedCommentPageSize: 1,
    deletedCommentResponseMutator: (response, { cursor, snapshotIndex }) => {
      if (snapshotIndex !== 0 || cursor !== "deleted-comment:1") return response;
      const mutated = structuredClone(response);
      const connection = mutated.data.repository.pullRequest.timelineItems;
      connection.totalCount = 3;
      connection.filteredCount = 2;
      connection.pageInfo = {
        hasNextPage: true,
        endCursor: "deleted-comment:2",
      };
      return mutated;
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "later-page-deleted-comment-count-floor",
  });

  const { result } = await runGate(environment, github, {
    stabilityWindowMs: 4,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.match(
    result.report.reason,
    /deleted-comment inventory lower bound decreased from 3 to 2/iu,
  );
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("an identity-less malformed deleted event cannot be forgotten when its count drops", async (context) => {
  const malformed = deletedCommentEvent({ id: null });
  const github = createGitHubMock({
    issueComments: [workflowRequest()],
    reactionsByCommentId: new Map([["101", [reaction()]]]),
    deletedCommentEventSnapshots: [[malformed], [], [], []],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "malformed-deleted-event-cannot-disappear",
  });
  const { result } = await runGate(environment, github, {
    stabilityWindowMs: 4,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.match(
    result.report.reason,
    /deleted-comment inventory lower bound decreased from 1 to 0/iu,
  );
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("deleted-comment ordering is stable for distinct locale-equivalent IDs", async (context) => {
  const composed = deletedCommentEvent({ id: "é" });
  const decomposed = deletedCommentEvent({ id: "e\u0301" });
  const github = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
    deletedCommentEventSnapshots: [
      [composed, decomposed],
      [decomposed, composed],
    ],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "deleted-comment-strict-id-order",
  });
  const { result, sleeps } = await runGate(environment, github, {
    stabilityWindowMs: 1,
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.deepEqual(sleeps, []);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("deleted-comment GraphQL pagination preserves a second-page boundary", async (context) => {
  const old = deletedCommentEvent({
    id: "CDE_old",
    createdAt: "2026-08-25T07:00:00Z",
  });
  const late = deletedCommentEvent({
    id: "CDE_late",
    createdAt: "2026-08-25T08:02:00Z",
  });
  const github = createGitHubMock({
    issueComments: [workflowRequest()],
    reactionsByCommentId: new Map([["101", [reaction({
      id: 530,
      created_at: "2026-08-25T08:01:00Z",
    })]]]),
    deletedCommentEvents: [old, late],
    deletedCommentPageSize: 1,
  });
  const environment = runtimeEnvironment(context, {
    suffix: "deleted-comment-second-page",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "request_clean_generation");
  assert.match(result.report.reason, /deleted:CDE_late/iu);
  const calls = github.calls.filter(({ path, body }) =>
    path === "/graphql" && body?.query?.includes("CodexReviewGateDeletedComments")
  );
  assert.equal(calls.every(({ body }) => body.query.includes("totalCount")), true);
  assert.deepEqual(calls.map(({ body }) => body.variables.cursor), [
    null,
    "deleted-comment:1",
    null,
    "deleted-comment:1",
  ]);
  assert.deepEqual(calls.map(({ body }) =>
    body.variables.includeBaseEpoch === true
  ), [true, false, true, false]);
  assert.equal(calls[1].body.variables.includeBaseEpoch, undefined);
  assert.equal(calls[3].body.variables.includeBaseEpoch, undefined);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("deleted-comment inventory uses filteredCount independently of timeline totalCount", async (context) => {
  const filteredCounts = [];
  const github = createGitHubMock({
    issueComments: [workflowRequest()],
    reactionsByCommentId: new Map([["101", [reaction()]]]),
    deletedCommentResponseMutator: (response) => {
      const mutated = structuredClone(response);
      const connection = mutated.data.repository.pullRequest.timelineItems;
      connection.totalCount = 12;
      filteredCounts.push(connection.filteredCount);
      return mutated;
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "timeline-total-independent-from-deletions",
  });

  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "success");
  assert.deepEqual(filteredCounts, [0, 0, 0, 0]);
});

test("deleted-comment pagination consumes decreasing filteredCount with stable timeline total", async (context) => {
  const events = [
    deletedCommentEvent({ id: "CDE_filtered_1" }),
    deletedCommentEvent({ id: "CDE_filtered_2", createdAt: "2026-08-25T08:03:00Z" }),
  ];
  const observedPages = [];
  const github = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
    deletedCommentEvents: events,
    deletedCommentPageSize: 1,
    deletedCommentResponseMutator: (response, { cursor }) => {
      const mutated = structuredClone(response);
      const connection = mutated.data.repository.pullRequest.timelineItems;
      connection.totalCount = 12;
      observedPages.push([cursor, connection.filteredCount, connection.pageCount]);
      return mutated;
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "deletion-filtered-count-decreases",
  });

  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.deepEqual(observedPages, [
    [null, 2, 1],
    ["deleted-comment:1", 1, 1],
    [null, 2, 1],
    ["deleted-comment:1", 1, 1],
  ]);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("deleted-comment pagination rejects cross-page timeline totalCount drift", async (context) => {
  const events = [
    deletedCommentEvent({ id: "CDE_timeline_total_1" }),
    deletedCommentEvent({ id: "CDE_timeline_total_2", createdAt: "2026-08-25T08:03:00Z" }),
  ];
  const github = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
    deletedCommentEvents: events,
    deletedCommentPageSize: 1,
    deletedCommentResponseMutator: (response, { cursor }) => {
      const mutated = structuredClone(response);
      mutated.data.repository.pullRequest.timelineItems.totalCount =
        cursor === null ? 12 : 13;
      return mutated;
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "deletion-timeline-total-drift",
  });

  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.match(result.report.reason, /timeline total count changed/iu);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("deleted-comment pagination rejects duplicate events and cursor loops", async (context) => {
  const events = [
    deletedCommentEvent({ id: "CDE_page_1" }),
    deletedCommentEvent({ id: "CDE_page_2", createdAt: "2026-08-25T08:03:00Z" }),
    deletedCommentEvent({ id: "CDE_page_3", createdAt: "2026-08-25T08:04:00Z" }),
  ];
  const cases = [
    ["duplicate-event", (response, { cursor }) => {
      if (cursor !== "deleted-comment:1") return response;
      const mutated = structuredClone(response);
      mutated.data.repository.pullRequest.timelineItems.nodes = [structuredClone(events[0])];
      return mutated;
    }, /appeared more than once/iu],
    ["cursor-loop", (response, { cursor }) => {
      const mutated = structuredClone(response);
      const connection = mutated.data.repository.pullRequest.timelineItems;
      if (cursor === null) {
        connection.pageInfo.endCursor = "deleted-comment:loop";
      } else if (cursor === "deleted-comment:loop") {
        connection.filteredCount = 2;
        connection.nodes = [structuredClone(events[1])];
        connection.pageCount = 1;
        connection.pageInfo = {
          hasNextPage: true,
          endCursor: "deleted-comment:loop",
        };
      }
      return mutated;
    }, /repeated a cursor/iu],
  ];
  for (const [suffix, mutate, expectedReason] of cases) {
    const github = createGitHubMock({
      issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
      deletedCommentEvents: events,
      deletedCommentPageSize: 1,
      deletedCommentResponseMutator: mutate,
    });
    const environment = runtimeEnvironment(context, {
      suffix: `deleted-comment-pagination-${suffix}`,
    });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.executionHealth, "unhealthy", suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.match(result.report.reason, expectedReason, suffix);
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, suffix);
  }
});

test("incomplete deleted-comment GraphQL connections fail closed", async (context) => {
  const cases = [
    ["total-count", (connection) => { delete connection.totalCount; }],
    ["filtered-count", (connection) => { delete connection.filteredCount; }],
    ["page-info", (connection) => { delete connection.pageInfo; }],
    ["page-info-end-cursor", (connection) => { delete connection.pageInfo.endCursor; }],
    ["nodes", (connection) => { delete connection.nodes; }],
    ["inventory-count", (connection) => { connection.filteredCount = 1; }],
    ["has-next-count", (connection) => {
      connection.totalCount = 1;
      connection.filteredCount = 1;
      connection.pageInfo.hasNextPage = false;
    }],
  ];
  for (const [suffix, mutate] of cases) {
    const github = createGitHubMock({
      issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
      deletedCommentResponseMutator: (response) => {
        const mutated = structuredClone(response);
        mutate(mutated.data.repository.pullRequest.timelineItems);
        return mutated;
      },
    });
    const environment = runtimeEnvironment(context, {
      suffix: `deleted-comment-${suffix}-incomplete`,
    });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.executionHealth, "unhealthy", suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "wait_then_reconcile", suffix);
    assert.equal(result.report.retrySafe, false, suffix);
    assert.match(result.report.reason, /deleted-comment.*incomplete|inconsistent/iu, suffix);
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, suffix);
  }
});

test("a one-read incomplete GraphQL history connection can recover after two complete snapshots", async (context) => {
  for (const [suffix, mutate] of [
    ["deleted", (pullRequest) => { delete pullRequest.timelineItems.totalCount; }],
    ["comments", (pullRequest) => { delete pullRequest.comments.totalCount; }],
  ]) {
    const github = createGitHubMock({
      issueComments: [workflowRequest()],
      reactionsByCommentId: new Map([["101", [reaction()]]]),
      deletedCommentResponseMutator: (response, { snapshotIndex }) => {
        if (snapshotIndex !== 0) return response;
        const mutated = structuredClone(response);
        mutate(mutated.data.repository.pullRequest);
        return mutated;
      },
    });
    const environment = runtimeEnvironment(context, {
      suffix: `one-read-incomplete-${suffix}-history`,
    });

    const { result } = await runGate(environment, github, {
      stabilityWindowMs: 4,
    });

    assert.equal(result.exitCode, 0, suffix);
    assert.equal(result.report.executionHealth, "healthy", suffix);
    assert.equal(result.report.gateOutcome, "success", suffix);
    assert.equal(result.report.recoveryCode, "none", suffix);
  }
});

test("identity-less malformed history nodes can recover to same-count complete inventories", async (context) => {
  const epoch = baseRefChangedEvent();
  const currentRequest = workflowRequest({
    created_at: "2026-08-25T08:10:00Z",
    updated_at: "2026-08-25T08:10:00Z",
  });
  const malformedDeletion = deletedCommentEvent({
    id: null,
    createdAt: "2026-08-25T07:00:00Z",
  });
  const validDeletion = deletedCommentEvent({
    id: "CDE_recovered_same_count",
    createdAt: "2026-08-25T07:00:00Z",
  });
  const cases = [
    [
      "issue-comment-node",
      createGitHubMock({
        issueComments: [workflowRequest()],
        reactionsByCommentId: new Map([["101", [reaction()]]]),
        deletedCommentResponseMutator: (response, { snapshotIndex }) => {
          if (snapshotIndex !== 0) return response;
          const mutated = structuredClone(response);
          mutated.data.repository.pullRequest.comments.nodes = [null];
          return mutated;
        },
      }),
    ],
    [
      "deleted-comment-node",
      createGitHubMock({
        baseEpoch: epoch,
        issueComments: [currentRequest],
        reactionsByCommentId: new Map([["101", [reaction({
          id: 598,
          created_at: "2026-08-25T08:11:00Z",
        })]]]),
        deletedCommentEventSnapshots: [
          [malformedDeletion],
          [validDeletion],
          [validDeletion],
          [validDeletion],
        ],
      }),
    ],
  ];

  for (const [suffix, github] of cases) {
    const environment = runtimeEnvironment(context, {
      suffix: `recover-identity-less-history-${suffix}`,
    });

    const { result } = await runGate(environment, github, {
      stabilityWindowMs: 4,
    });

    assert.equal(result.exitCode, 0, suffix);
    assert.equal(result.report.executionHealth, "healthy", suffix);
    assert.equal(result.report.gateOutcome, "success", suffix);
    assert.equal(result.report.recoveryCode, "none", suffix);
  }
});

test("a malformed GraphQL comment can recover when the same raw identity becomes complete", async (context) => {
  const github = createGitHubMock({
    issueComments: [workflowRequest()],
    reactionsByCommentId: new Map([["101", [reaction()]]]),
    deletedCommentResponseMutator: (response, { snapshotIndex }) => {
      if (snapshotIndex !== 0) return response;
      const mutated = structuredClone(response);
      delete mutated.data.repository.pullRequest.comments.nodes[0].body;
      return mutated;
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "raw-comment-identity-same-id-upgrade",
  });

  const { result } = await runGate(environment, github, {
    stabilityWindowMs: 4,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "success");
  assert.equal(result.report.recoveryCode, "none");
});

test("a malformed GraphQL comment raw identity cannot be replaced at the same count", async (context) => {
  const github = createGitHubMock({
    issueComments: [workflowRequest()],
    reactionsByCommentId: new Map([["101", [reaction()]]]),
    deletedCommentResponseMutator: (response, { snapshotIndex }) => {
      const mutated = structuredClone(response);
      const node = mutated.data.repository.pullRequest.comments.nodes[0];
      if (snapshotIndex === 0) {
        delete node.body;
      } else {
        node.databaseId = "102";
      }
      return mutated;
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "raw-comment-identity-same-count-replacement",
  });

  const { result } = await runGate(environment, github, {
    stabilityWindowMs: 4,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.match(
    result.report.reason,
    /previously observed issue-comment raw identity 101 disappeared/iu,
  );
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("malformed history nodes cannot retract schema-valid facts for the same raw identity", async (context) => {
  const oldDeletion = deletedCommentEvent({
    id: "CDE_partial_fact",
    createdAt: "2026-08-25T07:00:00Z",
  });
  const cases = [
    ["comment-body", createGitHubMock({
      issueComments: [workflowRequest()],
      reactionsByCommentId: new Map([["101", [reaction()]]]),
      deletedCommentResponseMutator: (response, { snapshotIndex }) => {
        if (snapshotIndex !== 1) return response;
        const mutated = structuredClone(response);
        const node = mutated.data.repository.pullRequest.comments.nodes[0];
        node.body = `${node.body}\nconflicting partial body`;
        delete node.createdAt;
        return mutated;
      },
    }), /issue-comment 101 body changed/iu],
    ["comment-edit-timestamp", createGitHubMock({
      issueComments: [workflowRequest()],
      reactionsByCommentId: new Map([["101", [reaction()]]]),
      deletedCommentResponseMutator: (response, { snapshotIndex }) => {
        if (snapshotIndex !== 1) return response;
        const mutated = structuredClone(response);
        const node = mutated.data.repository.pullRequest.comments.nodes[0];
        node.updatedAt = "2026-08-25T08:01:00Z";
        delete node.body;
        return mutated;
      },
    }), /issue-comment 101 updatedAt changed/iu],
    ["deleted-comment-actor", createGitHubMock({
      issueComments: [workflowRequest()],
      reactionsByCommentId: new Map([["101", [reaction()]]]),
      deletedCommentEvents: [oldDeletion],
      deletedCommentResponseMutator: (response, { snapshotIndex }) => {
        if (snapshotIndex !== 1) return response;
        const mutated = structuredClone(response);
        const node = mutated.data.repository.pullRequest.timelineItems.nodes[0];
        node.actor.login = "conflicting-actor";
        delete node.deletedCommentAuthor;
        return mutated;
      },
    }), /deleted-comment event CDE_partial_fact actor changed/iu],
  ];

  for (const [suffix, github, expectedReason] of cases) {
    const environment = runtimeEnvironment(context, {
      suffix: `partial-history-fact-${suffix}`,
    });

    const { result } = await runGate(environment, github, {
      stabilityWindowMs: 4,
    });

    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.executionHealth, "unhealthy", suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "wait_then_reconcile", suffix);
    assert.match(result.report.reason, expectedReason, suffix);
    assert.equal(
      github.statusWrites.some(({ state }) => state === "success"),
      false,
      suffix,
    );
  }
});

test("top-level GraphQL failures permanently latch identical history identity duplicates", async (context) => {
  const oldDeletion = deletedCommentEvent({
    id: "CDE_duplicate_envelope",
    createdAt: "2026-08-25T07:00:00Z",
  });
  for (const [suffix, github, expectedReason] of [
    ["issue-comment", createGitHubMock({
      issueComments: [workflowRequest()],
      reactionsByCommentId: new Map([["101", [reaction()]]]),
      deletedCommentResponseMutator: (response, { snapshotIndex }) => {
        if (snapshotIndex !== 0) return response;
        const mutated = structuredClone(response);
        const connection = mutated.data.repository.pullRequest.comments;
        connection.nodes.push(structuredClone(connection.nodes[0]));
        mutated.errors = [{ message: "synthetic partial GraphQL failure" }];
        return mutated;
      },
    }), /issue-comment 101 appeared more than once/iu],
    ["deleted-comment", createGitHubMock({
      issueComments: [workflowRequest()],
      reactionsByCommentId: new Map([["101", [reaction()]]]),
      deletedCommentEvents: [oldDeletion],
      deletedCommentResponseMutator: (response, { snapshotIndex }) => {
        if (snapshotIndex !== 0) return response;
        const mutated = structuredClone(response);
        const connection = mutated.data.repository.pullRequest.timelineItems;
        connection.nodes.push(structuredClone(connection.nodes[0]));
        mutated.errors = [{ message: "synthetic partial GraphQL failure" }];
        return mutated;
      },
    }), /deleted-comment event CDE_duplicate_envelope appeared more than once/iu],
  ]) {
    const environment = runtimeEnvironment(context, {
      suffix: `top-level-identical-duplicate-${suffix}`,
    });

    const { result } = await runGate(environment, github, {
      stabilityWindowMs: 4,
    });

    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.executionHealth, "unhealthy", suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "wait_then_reconcile", suffix);
    assert.match(result.report.reason, expectedReason, suffix);
    assert.equal(
      github.statusWrites.some(({ state }) => state === "success"),
      false,
      suffix,
    );
  }
});

test("run latches protect provider reviews without poisoning on unrelated human review state", async (context) => {
  const humanReview = findingReview(HEAD, {
    id: 900,
    state: "CHANGES_REQUESTED",
    body: "Human reviewer requested a change.",
    user: HUMAN,
    app: null,
    performed_via_github_app: null,
  });
  const dismissedHumanReview = {
    ...humanReview,
    state: "DISMISSED",
  };
  const github = createGitHubMock({
    issueComments: [workflowRequest()],
    reviewSnapshots: [
      [humanReview],
      [dismissedHumanReview],
      [dismissedHumanReview],
      [dismissedHumanReview],
    ],
    reactionsByCommentId: new Map([["101", [reaction()]]]),
  });
  const environment = runtimeEnvironment(context, {
    suffix: "human-review-state-outside-provider-latch",
  });

  const { result } = await runGate(environment, github, {
    stabilityWindowMs: 4,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "success");
});

test("review identity tombstones prevent a human review from becoming a Codex carrier", async (context) => {
  const humanReview = findingReview(HEAD, {
    id: 901,
    state: "COMMENTED",
    body: "Human review comment.",
    user: HUMAN,
    app: null,
    performed_via_github_app: null,
  });
  const providerReview = approvedReview(HEAD, { id: 901 });
  const github = createGitHubMock({
    issueComments: [workflowRequest()],
    reviewSnapshots: [
      [humanReview],
      [providerReview],
      [providerReview],
      [providerReview],
    ],
    reactionsByCommentId: new Map([["101", [reaction()]]]),
  });
  const environment = runtimeEnvironment(context, {
    suffix: "human-review-cannot-become-provider-carrier",
  });

  const { result } = await runGate(environment, github, {
    stabilityWindowMs: 4,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.match(result.report.reason, /review-identity issue-comment 901 changed/iu);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("reaction tombstones allow unrelated human or official ordinary reactions to disappear", async (context) => {
  const plusOne = reaction();
  for (const [suffix, user] of [
    ["human", HUMAN],
    ["official-ordinary", CODEX_BOT],
  ]) {
    const heart = reaction({
      id: 590,
      content: "heart",
      user,
    });
    const github = createGitHubMock({
      issueComments: [workflowRequest()],
      reactionSnapshotsByCommentId: new Map([["101", [
        [plusOne, heart],
        [plusOne],
        [plusOne],
        [plusOne],
      ]]]),
    });
    const environment = runtimeEnvironment(context, {
      suffix: `${suffix}-reaction-outside-provider-presence-latch`,
    });

    const { result } = await runGate(environment, github, {
      stabilityWindowMs: 4,
    });

    assert.equal(result.exitCode, 0, suffix);
    assert.equal(result.report.executionHealth, "healthy", suffix);
    assert.equal(result.report.gateOutcome, "success", suffix);
  }
});

test("reaction identity tombstones prevent ordinary reactions from becoming authority", async (context) => {
  for (const [suffix, initialReaction] of [
    ["human-heart", reaction({ id: 594, content: "heart", user: HUMAN })],
    ["official-heart", reaction({ id: 594, content: "heart" })],
    ["official-plus-one", reaction({ id: 594, content: "+1" })],
  ]) {
    const laterReaction = suffix === "official-plus-one"
      ? reaction({ id: 594, content: "heart" })
      : reaction({ id: 594, content: "+1" });
    const github = createGitHubMock({
      issueComments: [workflowRequest()],
      reactionSnapshotsByCommentId: new Map([["101", [
        [reaction({ id: 501 }), initialReaction],
        [reaction({ id: 501 }), laterReaction],
        [reaction({ id: 501 }), laterReaction],
        [reaction({ id: 501 }), laterReaction],
      ]]]),
    });
    const environment = runtimeEnvironment(context, {
      suffix: `reaction-identity-transition-${suffix}`,
    });

    const { result } = await runGate(environment, github, {
      stabilityWindowMs: 4,
    });

    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.executionHealth, "unhealthy", suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "wait_then_reconcile", suffix);
    assert.match(result.report.reason, /reaction-identity issue-comment 594 changed/iu, suffix);
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, suffix);
  }
});

test("batched request reactions require exact comment and parent identities", async (context) => {
  const malformedResponses = [
    ["missing-alias-node", (response) => { response.data.comment0 = null; }],
    ["wrong-node-id", (response) => { response.data.comment0.id = "IC_test_999"; }],
    ["wrong-database-id", (response) => { response.data.comment0.databaseId = "999"; }],
    ["wrong-pull-request", (response) => {
      response.data.comment0.pullRequest.number = PR + 1;
    }],
    ["wrong-repository-id", (response) => {
      response.data.comment0.pullRequest.repository.databaseId = "999";
    }],
    ["wrong-repository-name", (response) => {
      response.data.comment0.pullRequest.repository.nameWithOwner = "other/repo";
    }],
  ];

  for (const [suffix, mutate] of malformedResponses) {
    const request = ordinaryRequest();
    const github = createGitHubMock({
      issueComments: [request],
      reactionsByCommentId: new Map([[String(request.id), [reaction({ user: HUMAN })]]]),
      reactionGraphQlResponseMutator: (response) => {
        mutate(response);
        return response;
      },
    });
    const environment = runtimeEnvironment(context, {
      suffix: `reaction-comment-binding-${suffix}`,
    });
    const { result } = await runGate(environment, github);

    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.executionHealth, "unhealthy", suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "wait_then_reconcile", suffix);
    assert.match(result.report.reason, /exact issue-comment, repository, and pull-request identity/iu, suffix);
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, suffix);
    assert.equal(hasRequestReactionRestRead(github, request.id), false, suffix);
  }
});

test("batched reaction pages reject count drift and non-advancing cursors", async (context) => {
  const cases = [
    ["incomplete-count", 1, (response) => {
      response.data.comment0.reactions.totalCount = 2;
    }, /pagination was incomplete/iu],
    ["drifting-count", 2, (response, { variables }) => {
      if (variables.reactionCursor0 !== null) {
        response.data.comment0.reactions.totalCount += 1;
      }
    }, /total count changed while paging/iu],
    ["repeated-cursor", 3, (response, { variables }) => {
      if (variables.reactionCursor0 !== null) {
        response.data.comment0.reactions.pageInfo.endCursor =
          variables.reactionCursor0;
      }
    }, /pagination repeated a cursor/iu],
  ];

  for (const [suffix, reactionCount, mutate, expectedReason] of cases) {
    const request = ordinaryRequest();
    const github = createGitHubMock({
      issueComments: [request],
      reactionsByCommentId: new Map([[String(request.id), Array.from(
        { length: reactionCount },
        (_, index) => reaction({ id: 21_000 + index, user: HUMAN }),
      )]]),
      reactionGraphQlPageSize: 1,
      reactionGraphQlResponseMutator: (response, metadata) => {
        mutate(response, metadata);
        return response;
      },
    });
    const environment = runtimeEnvironment(context, {
      suffix: `reaction-pagination-${suffix}`,
    });
    const { result } = await runGate(environment, github);

    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.executionHealth, "unhealthy", suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "wait_then_reconcile", suffix);
    assert.match(result.report.reason, expectedReason, suffix);
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, suffix);
    assert.equal(hasRequestReactionRestRead(github, request.id), false, suffix);
  }
});

test("nested reaction and author objects still consume the snapshot object budget", async (context) => {
  const request = ordinaryRequest();
  const github = createGitHubMock({
    issueComments: [request],
    reactionsByCommentId: new Map([[String(request.id), Array.from(
      { length: 500 },
      (_, index) => reaction({ id: 23_000 + index, user: HUMAN }),
    )]]),
    reactionGraphQlPageSize: 100,
  });
  const environment = runtimeEnvironment(context, { suffix: "reaction-nested-object-budget" });
  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "use_expanded_limits");
  assert.match(result.report.reason, /Evidence object soft limit exceeded.*2000/iu);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("official reaction authors are bound to one fresh REST account read per carrier pass", async (context) => {
  const request = ordinaryRequest();
  const github = createGitHubMock({
    issueComments: [request],
    reactionsByCommentId: new Map([[String(request.id), [reaction()]]]),
  });
  const environment = runtimeEnvironment(context, { suffix: "reaction-official-actor-binding" });
  await runGate(environment, github);

  const reactionCalls = requestReactionGraphQlCalls(github);
  const accountReads = github.calls.filter(({ method, path }) =>
    method === "GET" && path === `/users/${encodeURIComponent(CODEX_BOT.login)}`
  );
  assert.equal(reactionCalls.length, 2, "one complete inventory has opening and closing carrier passes");
  assert.equal(accountReads.length, 2, "no official actor identity is cached across fresh carrier passes");
});

test("a nonofficial GraphQL Bot typename receives no inferred provider authority", async (context) => {
  const request = ordinaryRequest();
  const github = createGitHubMock({
    issueComments: [request],
    reactionsByCommentId: new Map([[String(request.id), [reaction({
      user: { login: "review-request-app[bot]", type: "Bot" },
    })]]]),
  });
  const environment = runtimeEnvironment(context, { suffix: "reaction-nonofficial-typename" });
  const { result } = await runGate(environment, github);

  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_provider");
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
  assert.equal(
    github.calls.some(({ method, path }) =>
      method === "GET" && path === `/users/${encodeURIComponent(CODEX_BOT.login)}`
    ),
    false,
    "nonofficial GraphQL actors do not trigger or inherit official account attribution",
  );
});

test("official reaction account and GraphQL actor mismatches fail closed", async (context) => {
  const cases = [
    ["rest-account-type", { id: CODEX_BOT_DATABASE_ID, login: CODEX_BOT.login, type: "User" }, null],
    ["graphql-account-id", null, (response) => {
      response.data.comment0.reactions.nodes[0].user.databaseId =
        String(CODEX_BOT_DATABASE_ID + 1);
    }],
  ];
  for (const [suffix, officialReactionAccount, mutate] of cases) {
    const request = ordinaryRequest();
    const github = createGitHubMock({
      issueComments: [request],
      reactionsByCommentId: new Map([[String(request.id), [reaction()]]]),
      officialReactionAccount,
      reactionGraphQlResponseMutator: mutate
        ? (response) => { mutate(response); return response; }
        : null,
    });
    const environment = runtimeEnvironment(context, {
      suffix: `reaction-official-identity-${suffix}`,
    });
    const { result } = await runGate(environment, github);

    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.executionHealth, "unhealthy", suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "wait_then_reconcile", suffix);
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, suffix);
    assert.equal(
      github.calls.filter(({ method, path }) =>
        method === "GET" && path === `/users/${encodeURIComponent(CODEX_BOT.login)}`
      ).length,
      4,
      suffix,
    );
  }
});

test("visible official reactions stay latched when a batched response later errors and disappears", async (context) => {
  const request = ordinaryRequest();
  let responses = 0;
  const github = createGitHubMock({
    issueComments: [request],
    reactionSnapshotsByCommentId: new Map([[String(request.id), [
      [
        reaction(),
        reaction({ id: 22_002, content: "eyes", created_at: "2026-08-25T08:02:00Z" }),
      ],
      [reaction()],
      [reaction()],
      [reaction()],
    ]]]),
    reactionGraphQlResponseMutator: (response) => {
      responses += 1;
      if (responses === 1) response.errors = [{ message: "synthetic partial reaction batch" }];
      return response;
    },
  });
  const environment = runtimeEnvironment(context, { suffix: "reaction-batch-partial-graphql-error" });
  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.match(result.report.reason, /reaction-rest:101.*22002.*disappeared/iu);
  assert.ok(responses > 1, "the first partial response is followed by fresh inventories");
  assert.equal(hasRequestReactionRestRead(github, request.id), false);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("valid reaction identities preceding an oversized GraphQL page remain latched", async (context) => {
  const request = ordinaryRequest();
  const oversizedPage = [
    reaction(),
    reaction({ id: 22_102, content: "eyes", created_at: "2026-08-25T08:02:00Z" }),
    ...Array.from({ length: 99 }, (_, index) => reaction({
      id: 22_200 + index,
      content: "heart",
      user: HUMAN,
    })),
  ];
  const github = createGitHubMock({
    issueComments: [request],
    reactionSnapshotsByCommentId: new Map([[String(request.id), [
      oversizedPage,
      [reaction()],
      [reaction()],
      [reaction()],
    ]]]),
    reactionGraphQlPageSize: 101,
  });
  const environment = runtimeEnvironment(context, { suffix: "oversized-reaction-page-latch" });
  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.match(result.report.reason, /reaction-rest:101.*22102.*disappeared/iu);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
  assert.equal(hasRequestReactionRestRead(github, request.id), false);
});

test("GraphQL User-typed Codex reactions require and accept exact REST Bot binding", async (context) => {
  const github = createGitHubMock({
    issueComments: [workflowRequest()],
    reactionsByCommentId: new Map([["101", [
      reaction(),
      reaction({
        id: 592,
        content: "eyes",
        created_at: "2026-08-25T08:02:00Z",
        user: { ...CODEX_BOT, type: "User" },
      }),
    ]]]),
  });
  const environment = runtimeEnvironment(context, {
    suffix: "invalid-provider-reaction-provenance",
  });

  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.gateOutcome, "pending");
  assert.match(result.report.reason, /review is still in progress/iu);
  assert.equal(result.report.counts.indeterminate, 0);
  assert.equal(
    github.calls.filter(({ method, path }) =>
      method === "GET" && path === `/users/${encodeURIComponent(CODEX_BOT.login)}`
    ).length,
    2,
  );
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("invalid-provenance Codex reactions remain protected run evidence", async (context) => {
  const wrongTypeEyes = reaction({
    id: 593,
    content: "eyes",
    created_at: "2026-08-25T08:02:00Z",
    user: { ...CODEX_BOT, type: "User" },
  });
  for (const [suffix, github, expectedReason] of [
    [
      "disappearing",
      createGitHubMock({
        issueComments: [workflowRequest()],
        reactionSnapshotsByCommentId: new Map([["101", [
          [reaction(), wrongTypeEyes],
          [reaction()],
          [reaction()],
          [reaction()],
        ]]]),
      }),
      /reaction-rest:101.*593.*disappeared/iu,
    ],
    [
      "mixed-provenance-duplicate",
      createGitHubMock({
        issueComments: [workflowRequest()],
        reactionsByCommentId: new Map([["101", [
          wrongTypeEyes,
          reaction({
            id: 593,
            content: "+1",
            created_at: "2026-08-25T08:03:00Z",
          }),
        ]]]),
      }),
      /repeated official Codex identity 593/iu,
    ],
  ]) {
    const environment = runtimeEnvironment(context, {
      suffix: `invalid-provider-reaction-${suffix}`,
    });

    const { result } = await runGate(environment, github, {
      stabilityWindowMs: 4,
    });

    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.executionHealth, "unhealthy", suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "wait_then_reconcile", suffix);
    assert.match(result.report.reason, expectedReason, suffix);
    assert.equal(
      github.statusWrites.some(({ state }) => state === "success"),
      false,
      suffix,
    );
  }
});

test("a provider reaction observed before a later-page failure remains latched", async (context) => {
  const plusOne = reaction();
  const eyes = reaction({
    id: 502,
    content: "eyes",
    created_at: "2026-08-25T08:02:00Z",
  });
  const humanHearts = Array.from({ length: 100 }, (_, index) => reaction({
    id: 600 + index,
    content: "heart",
    created_at: "2026-08-25T08:03:00Z",
    user: HUMAN,
  }));
  const duplicateHumanTail = reaction({
    id: 600,
    content: "heart",
    created_at: "2026-08-25T08:03:00Z",
    user: HUMAN,
  });
  const github = createGitHubMock({
    issueComments: [workflowRequest()],
    reactionSnapshotsByCommentId: new Map([["101", [
      [plusOne, eyes, ...humanHearts.slice(0, 98), duplicateHumanTail],
      [plusOne, ...humanHearts],
      [plusOne, ...humanHearts],
      [plusOne, ...humanHearts],
    ]]]),
  });
  const environment = runtimeEnvironment(context, {
    suffix: "partial-provider-reaction-page-latch",
  });

  const { result } = await runGate(environment, github, {
    stabilityWindowMs: 4,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.match(result.report.reason, /reaction-rest:101.*502.*disappeared/iu);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("GraphQL issue-comment edit inventory paginates completely within the default budget", async (context) => {
  const comments = [
    workflowRequest(),
    ...Array.from({ length: 200 }, (_, index) => genericComment(1_000 + index)),
  ];
  const github = createGitHubMock({
    issueComments: comments,
    reactionsByCommentId: new Map([["101", [reaction()]]]),
  });
  const environment = runtimeEnvironment(context, {
    suffix: "graphql-comment-edit-pagination",
  });
  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.gateOutcome, "success");
  const calls = github.calls.filter(({ path, body }) =>
    path === "/graphql" && body?.query?.includes("CodexReviewGateDeletedComments")
  );
  assert.equal(calls.length, 12);
  assert.deepEqual(calls.map(({ body }) => body.variables.commentCursor), [
    null,
    "issue-comment:100",
    "issue-comment:200",
    null,
    "issue-comment:100",
    "issue-comment:200",
    null,
    "issue-comment:100",
    "issue-comment:200",
    null,
    "issue-comment:100",
    "issue-comment:200",
  ]);
  assert.deepEqual(calls.slice(0, 3).map(({ body }) => body.variables.includeDeleted), [
    true,
    false,
    false,
  ]);
  for (const { body } of calls) {
    assert.match(body.query, /comments\(\s*first:\s*100/su);
    assert.match(body.query, /databaseId:\s*fullDatabaseId/u);
    assert.match(body.query, /lastEditedAt/u);
  }
});

test("GraphQL issue-comment edit pagination and REST reconciliation fail closed", async (context) => {
  const first = workflowRequest();
  const second = genericComment(102);
  const third = genericComment(103);
  const cases = [
    ["total-count-drift", 1, (response, { commentCursor }) => {
      if (commentCursor !== "issue-comment:1") return response;
      const mutated = structuredClone(response);
      const connection = mutated.data.repository.pullRequest.comments;
      connection.totalCount = 4;
      connection.pageInfo = {
        hasNextPage: true,
        endCursor: "issue-comment:2",
      };
      return mutated;
    }, /(?:total count changed|issue-comment totalCount decreased from 4 to 3)/iu],
    ["cursor-loop", 1, (response, { commentCursor }) => {
      const mutated = structuredClone(response);
      const connection = mutated.data.repository.pullRequest.comments;
      if (commentCursor === null) {
        connection.pageInfo.endCursor = "issue-comment:loop";
      } else if (commentCursor === "issue-comment:loop") {
        connection.nodes = [issueCommentEditGraphQlNode(second)];
        connection.pageInfo = {
          hasNextPage: true,
          endCursor: "issue-comment:loop",
        };
      }
      return mutated;
    }, /pagination repeated a cursor/iu],
    ["cross-page-duplicate", 1, (response, { commentCursor }) => {
      if (commentCursor !== "issue-comment:1") return response;
      const mutated = structuredClone(response);
      mutated.data.repository.pullRequest.comments.nodes = [
        issueCommentEditGraphQlNode(first),
      ];
      return mutated;
    }, /issue-comment 101 appeared more than once/iu],
    ["has-next-count", 1, (response, { commentCursor }) => {
      if (commentCursor !== null) return response;
      const mutated = structuredClone(response);
      mutated.data.repository.pullRequest.comments.pageInfo = {
        hasNextPage: false,
        endCursor: null,
      };
      return mutated;
    }, /edit connection was incomplete or inconsistent/iu],
    ["missing-full-id", 100, (response) => {
      const mutated = structuredClone(response);
      delete mutated.data.repository.pullRequest.comments.nodes[0].databaseId;
      return mutated;
    }, /edit metadata was incomplete or inconsistent/iu],
    ["missing-rest-mapping", 100, (response) => {
      const mutated = structuredClone(response);
      mutated.data.repository.pullRequest.comments.nodes[1].databaseId = "999";
      return mutated;
    }, /REST and GraphQL.*did not match/iu],
    ["body-skew", 100, (response) => {
      const mutated = structuredClone(response);
      mutated.data.repository.pullRequest.comments.nodes[0].body += " stale";
      return mutated;
    }, /REST and GraphQL.*did not match/iu],
  ];

  for (const [suffix, pageSize, mutate, expectedReason] of cases) {
    const github = createGitHubMock({
      issueComments: [first, second, third],
      reactionsByCommentId: new Map([["101", [reaction()]]]),
      deletedCommentPageSize: pageSize,
      deletedCommentResponseMutator: mutate,
    });
    const environment = runtimeEnvironment(context, {
      suffix: `graphql-comment-edit-${suffix}`,
    });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.executionHealth, "unhealthy", suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "wait_then_reconcile", suffix);
    assert.match(result.report.reason, expectedReason, suffix);
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, suffix);
  }
});

test("an edit observed on a later failing GraphQL page remains latched", async (context) => {
  const edited = genericComment(102);
  edited.last_edited_at = "2026-08-25T07:00:00.500Z";
  edited.graphql_updated_at = "2026-08-25T07:00:00.500Z";
  const github = createGitHubMock({
    issueCommentSnapshots: [
      [workflowRequest(), edited],
      [workflowRequest()],
      [workflowRequest()],
      [workflowRequest()],
    ],
    reactionsByCommentId: new Map([["101", [reaction()]]]),
    deletedCommentPageSize: 1,
    deletedCommentResponseMutator: (response, { commentCursor, snapshotIndex }) => {
      if (snapshotIndex !== 0 || commentCursor !== "issue-comment:1") return response;
      const mutated = structuredClone(response);
      const connection = mutated.data.repository.pullRequest.comments;
      connection.totalCount = 3;
      connection.pageInfo = {
        hasNextPage: true,
        endCursor: "issue-comment:2",
      };
      return mutated;
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "partial-issue-comment-edit-page-latch",
  });
  const { result } = await runGate(environment, github, {
    stabilityWindowMs: 4,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.match(
    result.report.reason,
    /(?:edit metadata.*102.*(?:disappeared|moved backwards)|issue-comment totalCount decreased from 3 to 1|Previously observed graphql issue-comment 102 disappeared)/iu,
  );
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("a conflicting duplicate GraphQL comment permanently poisons reconciliation", async (context) => {
  const conflicting = findingIssueComment(HEAD, {
    id: 101,
    created_at: "2026-08-25T08:00:00Z",
    updated_at: "2026-08-25T08:00:00Z",
  });
  const github = createGitHubMock({
    issueCommentSnapshots: [
      [workflowRequest(), genericComment(102)],
      [workflowRequest()],
      [workflowRequest()],
      [workflowRequest()],
    ],
    reactionsByCommentId: new Map([["101", [reaction()]]]),
    deletedCommentPageSize: 1,
    deletedCommentResponseMutator: (response, { commentCursor, snapshotIndex }) => {
      if (snapshotIndex !== 0 || commentCursor !== "issue-comment:1") return response;
      const mutated = structuredClone(response);
      mutated.data.repository.pullRequest.comments.nodes = [
        issueCommentEditGraphQlNode(conflicting),
      ];
      return mutated;
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "conflicting-graphql-comment-duplicate",
  });
  const { result } = await runGate(environment, github, {
    stabilityWindowMs: 4,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.match(result.report.reason, /issue-comment 101 changed across paginated inventory/iu);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("an identical duplicate GraphQL comment permanently poisons reconciliation", async (context) => {
  const github = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
    deletedCommentPageSize: 1,
    deletedCommentResponseMutator: (response, { commentCursor, snapshotIndex }) => {
      if (snapshotIndex !== 0 || commentCursor !== "issue-comment:1") return response;
      const mutated = structuredClone(response);
      mutated.data.repository.pullRequest.comments.nodes = [
        issueCommentEditGraphQlNode(workflowRequest()),
      ];
      return mutated;
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "identical-graphql-comment-duplicate",
  });

  const { result } = await runGate(environment, github, {
    stabilityWindowMs: 4,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.match(result.report.reason, /issue-comment 101 appeared more than once/iu);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("an observed comment identity cannot disappear from a later complete inventory", async (context) => {
  const phantom = genericComment(999);
  const github = createGitHubMock({
    issueCommentSnapshots: [
      [workflowRequest(), phantom],
      [workflowRequest(), cleanIssueComment(HEAD)],
      [workflowRequest(), cleanIssueComment(HEAD)],
    ],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "invalid-page-comment-id-latch",
  });

  const { result } = await runGate(environment, github, {
    stabilityWindowMs: 4,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.match(result.report.reason, /(?:rest|graphql) issue-comment 999 disappeared/iu);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("all visible history evidence is latched before any combined response failure", async (context) => {
  const edited = workflowRequest({
    last_edited_at: "2026-08-25T08:00:00.500Z",
    graphql_updated_at: "2026-08-25T08:00:00.500Z",
  });
  const unedited = workflowRequest({ last_edited_at: null });
  for (const [suffix, mutate, expectedReason] of [
    ["deleted-connection", (response) => {
      delete response.data.repository.pullRequest.timelineItems.totalCount;
    }, /(?:edit metadata.*101.*(?:disappeared|moved backwards)|issue-comment 101 updatedAt changed)/iu],
    ["top-level-errors", (response) => {
      response.errors = [{ message: "synthetic partial GraphQL failure" }];
    }, /(?:edit metadata.*101.*(?:disappeared|moved backwards)|issue-comment 101 updatedAt changed)/iu],
  ]) {
    const github = createGitHubMock({
      issueCommentSnapshots: [
        [edited],
        [unedited],
        [unedited],
        [unedited],
      ],
      reactionsByCommentId: new Map([["101", [reaction()]]]),
      deletedCommentResponseMutator: (response, { snapshotIndex }) => {
        if (snapshotIndex !== 0) return response;
        const mutated = structuredClone(response);
        mutate(mutated);
        return mutated;
      },
    });
    const environment = runtimeEnvironment(context, {
      suffix: `combined-comment-history-${suffix}`,
    });
    const { result } = await runGate(environment, github, {
      stabilityWindowMs: 4,
    });
    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.executionHealth, "unhealthy", suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "wait_then_reconcile", suffix);
    assert.match(result.report.reason, expectedReason, suffix);
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, suffix);
  }
});

test("REST and GraphQL comment conflicts permanently poison the stability run", async (context) => {
  const clean = cleanIssueComment(HEAD, {
    id: 201,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
  });
  const finding = findingIssueComment(HEAD, {
    id: 201,
    created_at: clean.created_at,
    updated_at: clean.updated_at,
  });
  const github = createGitHubMock({
    issueComments: [workflowRequest(), clean],
    deletedCommentResponseMutator: (response, { snapshotIndex }) => {
      if (snapshotIndex !== 0) return response;
      const mutated = structuredClone(response);
      const node = mutated.data.repository.pullRequest.comments.nodes.find(
        ({ databaseId }) => databaseId === "201",
      );
      node.body = finding.body;
      return mutated;
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "rest-graphql-comment-conflict-poison",
  });

  const { result } = await runGate(environment, github, {
    stabilityWindowMs: 4,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.match(
    result.report.reason,
    /REST and GraphQL issue-comment metadata did not match for 201/iu,
  );
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("an exact-refetch comment conflict permanently poisons the stability run", async (context) => {
  const clean = cleanIssueComment(HEAD, {
    id: 201,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
  });
  const finding = findingIssueComment(HEAD, {
    id: 201,
    created_at: clean.created_at,
    updated_at: clean.updated_at,
  });
  let providerRefetches = 0;
  const github = createGitHubMock({
    issueComments: [workflowRequest(), clean],
    commentRefetchMutator: (comment) => {
      if (String(comment.id) !== "201") return comment;
      providerRefetches += 1;
      return providerRefetches === 1 ? finding : comment;
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "exact-refetch-comment-conflict-poison",
  });

  const { result } = await runGate(environment, github, {
    stabilityWindowMs: 4,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.match(
    result.report.reason,
    /Previously observed rest issue-comment 201 changed/iu,
  );
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("comment reconciliation latches conflicts even when another carrier read fails", async (context) => {
  const clean = cleanIssueComment(HEAD);
  const finding = findingIssueComment(HEAD, {
    id: clean.id,
    created_at: clean.created_at,
    updated_at: clean.updated_at,
  });
  let reviewReads = 0;
  const github = createGitHubMock({
    issueComments: [workflowRequest(), clean],
    requestInterceptor: ({ method, path }) => {
      if (
        method === "GET" &&
        path === `/repos/${REPOSITORY}/pulls/${PR}/reviews` &&
        reviewReads < 3
      ) {
        reviewReads += 1;
        return jsonResponse({ message: "synthetic review read failure" }, 502);
      }
      return undefined;
    },
    deletedCommentResponseMutator: (response, { snapshotIndex }) => {
      if (snapshotIndex !== 0) return response;
      const mutated = structuredClone(response);
      const node = mutated.data.repository.pullRequest.comments.nodes.find(
        ({ databaseId }) => databaseId === String(clean.id),
      );
      node.body = finding.body;
      return mutated;
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "parallel-carrier-failure-comment-conflict",
  });

  const { result } = await runGate(environment, github, {
    stabilityWindowMs: 4,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.match(
    result.report.reason,
    /REST and GraphQL issue-comment metadata did not match for 201/iu,
  );
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("REST issue-comment pagination latches valid earlier-page carriers before failure", async (context) => {
  const firstPage = [
    workflowRequest(),
    findingIssueComment(HEAD, {
      id: 201,
      created_at: "2026-08-25T08:01:00Z",
      updated_at: "2026-08-25T08:01:00Z",
    }),
    ...Array.from({ length: 98 }, (_, index) => genericComment(1_000 + index)),
  ];
  const stable = [workflowRequest(), cleanIssueComment(HEAD)];
  const github = createGitHubMock({
    issueCommentSnapshots: [
      [...firstPage, workflowRequest()],
      stable,
      stable,
    ],
    reactionsByCommentId: new Map([["101", [reaction()]]]),
    deletedCommentResponseMutator: (response) => {
      const mutated = structuredClone(response);
      mutated.data.repository.pullRequest.comments = {
        totalCount: stable.length,
        nodes: stable.map(issueCommentEditGraphQlNode),
        pageInfo: { hasNextPage: false, endCursor: null },
      };
      return mutated;
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "rest-partial-page-carrier-latch",
  });

  const { result } = await runGate(environment, github, {
    stabilityWindowMs: 4,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.match(
    result.report.reason,
    /pull-request issue comments contains duplicate identity 101/iu,
  );
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("review exact-refetch conflicts permanently poison the stability run", async (context) => {
  const finding = findingReview(HEAD, {
    id: 401,
    submitted_at: "2026-08-25T08:01:00Z",
  });
  let exactReads = 0;
  const github = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
    reviewSnapshots: [[finding], [], []],
    reviewRefetchMutator: (review) => {
      exactReads += 1;
      return exactReads === 1
        ? { ...review, state: "APPROVED", body: "Synthetic changed exact review" }
        : review;
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "review-exact-refetch-conflict-poison",
  });

  const { result } = await runGate(environment, github, {
    stabilityWindowMs: 4,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.match(result.report.reason, /review-rest issue-comment 401 changed/iu);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("a PR-count mismatch cannot forget a newly visible physical boundary", async (context) => {
  const physicalOnly = ordinaryRequest({
    id: 102,
    user: ACTIONS_BOT,
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const github = createGitHubMock({
    issueCommentSnapshots: [
      [workflowRequest(), physicalOnly],
      [workflowRequest()],
      [workflowRequest()],
    ],
    pullRequestOverrides: { comments: 1 },
    reactionsByCommentId: new Map([["101", [reaction()]]]),
  });
  const environment = runtimeEnvironment(context, {
    suffix: "pr-count-physical-boundary-latch",
  });

  const { result } = await runGate(environment, github, {
    stabilityWindowMs: 4,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.match(
    result.report.reason,
    /(?:issue-comment totalCount decreased from 2 to 1|issue-comment 102 disappeared)/iu,
  );
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
    const request = ordinaryRequest();
    const github = createGitHubMock({
      issueComments: [request, cleanIssueComment(HEAD)],
      reactionsByCommentId: new Map([[String(request.id), [reaction({
        content: "eyes",
        created_at: "2026-08-25T08:00:30Z",
      })]]]),
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
  const request = ordinaryRequest();
  const github = createGitHubMock({
    issueComments: [request, cleanIssueComment(HEAD)],
    reactionsByCommentId: new Map([[String(request.id), [reaction({
      content: "eyes",
      created_at: "2026-08-25T08:00:30Z",
    })]]]),
    baseEpochResponseMutator: (response) => ({
      ...response,
      data: {
        ...response.data,
        repository: {
          ...response.data.repository,
          pullRequest: {
            ...response.data.repository.pullRequest,
            baseEpochTimelineItems: {
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

test("pull_request verifier fails closed for altered launch or target bindings", async (context) => {
  const successRequest = ordinaryRequest();
  const successEvidence = [successRequest, cleanIssueComment(HEAD)];
  const successReactions = new Map([[String(successRequest.id), [reaction({
    content: "eyes",
    created_at: "2026-08-25T08:00:30Z",
  })]]]);
  const bindingReason =
    "The pull_request verifier is not bound to the exact current PR head, base, and " +
    "test-merge commit";
  const controlGitHub = createGitHubMock({
    issueComments: successEvidence,
    reactionsByCommentId: successReactions,
  });
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
      expectedReason: `${bindingReason}: runtime_merge_sha`,
      expectedReadCount: 2,
    },
    {
      label: "github-ref",
      mutateEnvironment: (environment) => { environment.GITHUB_REF = "refs/heads/main"; },
      expectedReason: `${bindingReason}: runtime_merge_ref`,
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
      expectedReason: `${bindingReason}: event_base_sha`,
      expectedReadCount: 2,
    },
    {
      label: "event-base-ref",
      mutateEvent: (event) => { event.pull_request.base.ref = "release"; },
      expectedReason: `${bindingReason}: event_base_ref`,
      expectedReadCount: 2,
    },
    {
      label: "event-head-ref",
      mutateEvent: (event) => { event.pull_request.head.ref = "replacement"; },
      expectedReason: `${bindingReason}: event_head_ref`,
      expectedReadCount: 2,
    },
    {
      label: "event-base-repository",
      mutateEvent: (event) => {
        event.pull_request.base.repo.full_name = "other/repository";
      },
      expectedReason: "pull_request trigger did not satisfy the exact read-only verifier contract",
      expectedReadCount: 0,
    },
    {
      label: "event-head-repository",
      mutateEvent: (event) => {
        event.pull_request.head.repo.full_name = "other/repository";
      },
      expectedReason: "pull_request trigger did not satisfy the exact read-only verifier contract",
      expectedReadCount: 0,
    },
    {
      label: "fresh-head",
      githubOptions: { pullRequestOverrides: { head: { sha: NEXT_HEAD } } },
      expectedReason: `${bindingReason}: current_head_sha`,
      expectedReadCount: 2,
    },
    {
      label: "fresh-head-ref",
      githubOptions: { pullRequestOverrides: { head: { ref: "replacement" } } },
      expectedReason: `${bindingReason}: event_head_ref`,
      expectedReadCount: 2,
    },
    {
      label: "fresh-fork",
      githubOptions: {
        pullRequestOverrides: { head: { repo: { full_name: "other/repository" } } },
      },
      expectedReason: "Action v2 does not support fork pull requests",
      expectedReadCount: 2,
    },
    {
      label: "fresh-base",
      githubOptions: { pullRequestOverrides: { base: { sha: NEXT_HEAD } } },
      expectedReason: `${bindingReason}: event_base_sha`,
      expectedReadCount: 2,
    },
    {
      label: "fresh-nondefault-base",
      githubOptions: { pullRequestOverrides: { base: { ref: "release" } } },
      expectedReason:
        "Action v2 requires the repository default branch as the pull-request base",
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
    const github = createGitHubMock({
      issueComments: successEvidence,
      reactionsByCommentId: successReactions,
      ...scenario.githubOptions,
    });
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

test("pull_request verifier accepts an unavailable or historical event test-merge SHA", async (context) => {
  const successRequest = ordinaryRequest();
  const successEvidence = [successRequest, cleanIssueComment(HEAD)];
  const successReactions = new Map([[String(successRequest.id), [reaction({
    content: "eyes",
    created_at: "2026-08-25T08:00:30Z",
  })]]]);
  for (const [label, mergeCommitSha] of [
    ["missing", null],
    ["historical", NEXT_HEAD],
  ]) {
    const event = pullRequestEvent();
    event.pull_request.merge_commit_sha = mergeCommitSha;
    const environment = runtimeEnvironment(context, {
      suffix: `pull-request-event-test-merge-${label}`,
      event,
    });
    const github = createGitHubMock({
      issueComments: successEvidence,
      reactionsByCommentId: successReactions,
    });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 0, label);
    assert.equal(result.report.gateOutcome, "success", label);
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

test("pull_request verifier fails closed when the fresh PR has no test-merge SHA", async (context) => {
  const bindingReason =
    "The pull_request verifier is not bound to the exact current PR head, base, and " +
    "test-merge commit: current_test_merge_sha, runtime_merge_sha";
  const github = createGitHubMock({ pullRequestOverrides: { merge_commit_sha: null } });
  const environment = runtimeEnvironment(context, { suffix: "missing-fresh-test-merge" });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "not_applicable");
  assert.equal(result.report.recoveryCode, "refresh_head");
  assert.equal(result.report.reason, bindingReason);
  assert.deepEqual(github.statusWrites, []);
  assert.deepEqual(github.requestBodies, []);
  assert.deepEqual(github.rerunRequests, []);
  assert.deepEqual(github.stickyCreates, []);
  assert.deepEqual(github.stickyPatches, []);
});

test("test-merge drift between complete snapshots invalidates verifier success", async (context) => {
  const request = ordinaryRequest();
  const github = createGitHubMock({
    issueComments: [request, cleanIssueComment(HEAD)],
    reactionsByCommentId: new Map([[String(request.id), [reaction({
      content: "eyes",
      created_at: "2026-08-25T08:00:30Z",
    })]]]),
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

test("a prior clean cannot satisfy a newly created current-head verifier until a fresh request and clean arrive", async (context) => {
  const cutoff = "2026-08-25T08:10:00Z";
  const prior = [ordinaryRequest(), cleanIssueComment(HEAD)];
  const selfVerifierRun = verifierSelfRun({ created_at: cutoff });
  const initialGitHub = createGitHubMock({
    issueComments: prior,
    selfVerifierRun,
  });
  const initialEnvironment = runtimeEnvironment(context, {
    suffix: "verifier-prior-clean-before-cutoff",
  });
  const { result: initial } = await runGate(initialEnvironment, initialGitHub);
  assert.equal(initial.exitCode, 1);
  assert.equal(initial.report.gateOutcome, "pending");
  assert.notEqual(initial.report.recoveryCode, "none");
  assert.deepEqual(initialGitHub.statusWrites, []);
  assert.ok(initialGitHub.calls.some(({ method, path }) =>
    method === "GET" && path === `/repos/${REPOSITORY}/actions/runs/123`
  ));

  const recoveredGitHub = createGitHubMock({
    issueComments: [
      ...prior,
      recoveryRequest(),
      recoveryClean(),
    ],
    selfVerifierRun,
  });
  const recoveredEnvironment = runtimeEnvironment(context, {
    suffix: "verifier-fresh-clean-after-cutoff",
  });
  const { result: recovered } = await runGate(recoveredEnvironment, recoveredGitHub);
  assert.equal(recovered.exitCode, 0, recovered.report.reason);
  assert.equal(recovered.report.executionHealth, "healthy");
  assert.equal(recovered.report.gateOutcome, "success");
  assert.equal(recovered.report.recoveryCode, "none");
  assert.deepEqual(recoveredGitHub.statusWrites, []);
});

test("a new-head top-level clean recovers across multiple pre-run boundaries and an old parent review", async (context) => {
  const cutoff = "2026-08-25T08:10:00Z";
  const oldRequests = [
    ordinaryRequest({
      id: 501,
      created_at: "2026-08-25T07:30:00Z",
      updated_at: "2026-08-25T07:30:00Z",
    }),
    ordinaryRequest({
      id: 502,
      created_at: "2026-08-25T07:40:00Z",
      updated_at: "2026-08-25T07:40:00Z",
    }),
    ordinaryRequest({
      id: 503,
      created_at: "2026-08-25T07:50:00Z",
      updated_at: "2026-08-25T07:50:00Z",
    }),
  ];
  const oldParent = inlineParentReview(OLD_HEAD, {
    id: 504,
    submitted_at: "2026-08-25T08:00:00Z",
  });
  const github = createGitHubMock({
    issueComments: [...oldRequests, recoveryRequest(), recoveryClean()],
    reviews: [oldParent],
    reviewThreads: [reviewThread({ id: "PRRT_recovered", isResolved: true })],
    selfVerifierRun: verifierSelfRun({ created_at: cutoff }),
  });
  const environment = runtimeEnvironment(context, {
    suffix: "post-run-current-head-clean-recovery",
  });
  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 0, result.report.reason);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "success");
  assert.equal(result.report.recoveryCode, "none");
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("a pre-run request's unclosed eyes activity blocks current-head clean recovery", async (context) => {
  const oldRequest = ordinaryRequest({
    id: 511,
    created_at: "2026-08-25T07:50:00Z",
    updated_at: "2026-08-25T07:50:00Z",
  });
  const github = createGitHubMock({
    issueComments: [oldRequest, recoveryRequest(), recoveryClean()],
    reactionsByCommentId: new Map([[String(oldRequest.id), [reaction({
      content: "eyes",
      created_at: "2026-08-25T07:51:00Z",
    })]]]),
    selfVerifierRun: verifierSelfRun({ created_at: "2026-08-25T08:10:00Z" }),
  });
  const environment = runtimeEnvironment(context, {
    suffix: "post-run-recovery-preserves-old-eyes",
  });
  const { result } = await runGate(environment, github);

  assert.equal(result.report.executionHealth, "healthy");
  assert.notEqual(result.report.gateOutcome, "success");
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("current-head clean recovery preserves findings and provider provenance errors", async (context) => {
  const cutoff = "2026-08-25T08:10:00Z";
  const cases = [
    {
      suffix: "current-head-finding",
      comments: [
        ordinaryRequest({
          id: 561,
          created_at: "2026-08-25T07:50:00Z",
          updated_at: "2026-08-25T07:50:00Z",
        }),
        recoveryRequest(),
        findingIssueComment(HEAD, {
          id: 562,
          created_at: "2026-08-25T08:11:30Z",
          updated_at: "2026-08-25T08:11:30Z",
        }),
        recoveryClean(),
      ],
    },
    {
      suffix: "provider-provenance-error",
      comments: [
        ordinaryRequest({
          id: 563,
          created_at: "2026-08-25T07:50:00Z",
          updated_at: "2026-08-25T07:50:00Z",
        }),
        recoveryRequest(),
        opaqueProviderIssueComment({
          id: 564,
          created_at: "2026-08-25T08:11:30Z",
          updated_at: "2026-08-25T08:11:30Z",
          performed_via_github_app: { slug: "untrusted-app" },
        }),
        recoveryClean(),
      ],
    },
  ];

  for (const { suffix, comments } of cases) {
    const github = createGitHubMock({
      issueComments: comments,
      selfVerifierRun: verifierSelfRun({ created_at: cutoff }),
    });
    const environment = runtimeEnvironment(context, {
      suffix: `post-run-recovery-preserved-${suffix}`,
    });
    const { result } = await runGate(environment, github);
    assert.notEqual(result.report.gateOutcome, "success", suffix);
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, suffix);
  }
});

test("an APPROVED review cannot replace a post-run current-head top-level clean", async (context) => {
  const github = createGitHubMock({
    issueComments: [ordinaryRequest({
      id: 521,
      created_at: "2026-08-25T07:50:00Z",
      updated_at: "2026-08-25T07:50:00Z",
    }), recoveryRequest()],
    reviews: [approvedReview(HEAD, {
      id: 522,
      submitted_at: "2026-08-25T08:12:00Z",
    })],
    selfVerifierRun: verifierSelfRun({ created_at: "2026-08-25T08:10:00Z" }),
  });
  const environment = runtimeEnvironment(context, {
    suffix: "post-run-recovery-approved-not-comment-clean",
  });
  const { result } = await runGate(environment, github);

  assert.notEqual(result.report.gateOutcome, "success");
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("an inline-parent review cannot replace a post-run current-head top-level clean", async (context) => {
  const github = createGitHubMock({
    issueComments: [
      ordinaryRequest({
        id: 523,
        created_at: "2026-08-25T07:50:00Z",
        updated_at: "2026-08-25T07:50:00Z",
      }),
      recoveryRequest(),
    ],
    reviews: [inlineParentReview(HEAD, {
      id: 524,
      submitted_at: "2026-08-25T08:12:00Z",
    })],
    selfVerifierRun: verifierSelfRun({ created_at: "2026-08-25T08:10:00Z" }),
  });
  const environment = runtimeEnvironment(context, {
    suffix: "post-run-recovery-inline-parent-not-comment-clean",
  });
  const { result } = await runGate(environment, github);

  assert.notEqual(result.report.gateOutcome, "success");
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("a post-run canonical Actions request recovers only for the exact current tuple", async (context) => {
  const cutoff = "2026-08-25T08:10:00Z";
  const exact = workflowRequest({
    id: 531,
    body: canonicalRequestBody(),
    created_at: "2026-08-25T08:11:00Z",
    updated_at: "2026-08-25T08:11:00Z",
  });
  const clean = recoveryClean();
  const github = createGitHubMock({
    issueComments: [exact, clean],
    selfVerifierRun: verifierSelfRun({ created_at: cutoff }),
  });
  const environment = runtimeEnvironment(context, {
    suffix: "post-run-exact-canonical-request",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.report.gateOutcome, "success", result.report.reason);

  const staleBaseRequest = workflowRequest({
    id: 532,
    body: canonicalRequestBody(HEAD, { baseSha: OLD_HEAD }),
    created_at: "2026-08-25T08:11:00Z",
    updated_at: "2026-08-25T08:11:00Z",
  });
  const staleBaseGithub = createGitHubMock({
    issueComments: [staleBaseRequest, clean],
    selfVerifierRun: verifierSelfRun({ created_at: cutoff }),
  });
  const staleBaseEnvironment = runtimeEnvironment(context, {
    suffix: "post-run-canonical-stale-base",
  });
  const { result: staleBase } = await runGate(staleBaseEnvironment, staleBaseGithub);
  assert.notEqual(staleBase.report.gateOutcome, "success");
  assert.equal(staleBaseGithub.statusWrites.some(({ state }) => state === "success"), false);

  const postEpochGithub = createGitHubMock({
    issueComments: [exact, clean],
    baseEpoch: baseRefChangedEvent({ createdAt: "2026-08-25T08:05:00Z" }),
    selfVerifierRun: verifierSelfRun({ created_at: cutoff }),
  });
  const postEpochEnvironment = runtimeEnvironment(context, {
    suffix: "post-run-canonical-after-base-epoch-needs-direct-receipt",
  });
  const { result: postEpoch } = await runGate(postEpochEnvironment, postEpochGithub);
  assert.notEqual(postEpoch.report.gateOutcome, "success");
  assert.equal(postEpochGithub.statusWrites.some(({ state }) => state === "success"), false);
});

test("current-head clean recovery requires strict verifier, request, and clean ordering", async (context) => {
  const cutoff = "2026-08-25T08:10:00Z";
  const cases = [
    {
      suffix: "request-equals-cutoff",
      request: recoveryRequest({
        created_at: cutoff,
        updated_at: cutoff,
      }),
      clean: recoveryClean(),
    },
    {
      suffix: "clean-equals-request",
      request: recoveryRequest(),
      clean: recoveryClean({
        created_at: "2026-08-25T08:11:00Z",
        updated_at: "2026-08-25T08:11:00Z",
      }),
    },
    {
      suffix: "clean-equals-cutoff",
      request: recoveryRequest({
        created_at: "2026-08-25T08:09:00Z",
        updated_at: "2026-08-25T08:09:00Z",
      }),
      clean: recoveryClean({
        created_at: cutoff,
        updated_at: cutoff,
      }),
    },
  ];

  for (const { suffix, request, clean } of cases) {
    const github = createGitHubMock({
      issueComments: [
        ordinaryRequest({
          id: 541,
          created_at: "2026-08-25T07:30:00Z",
          updated_at: "2026-08-25T07:30:00Z",
        }),
        ordinaryRequest({
          id: 542,
          created_at: "2026-08-25T07:40:00Z",
          updated_at: "2026-08-25T07:40:00Z",
        }),
        ordinaryRequest({
          id: 543,
          created_at: "2026-08-25T07:50:00Z",
          updated_at: "2026-08-25T07:50:00Z",
        }),
        request,
        clean,
      ],
      selfVerifierRun: verifierSelfRun({ created_at: cutoff }),
    });
    const environment = runtimeEnvironment(context, {
      suffix: `post-run-recovery-order-${suffix}`,
    });
    const { result } = await runGate(environment, github);
    assert.notEqual(result.report.gateOutcome, "success", suffix);
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, suffix);
  }
});

test("edited recovery carriers, ambiguous SHAs, and same-time activity fail closed", async (context) => {
  const cutoff = "2026-08-25T08:10:00Z";
  const currentRequest = recoveryRequest();
  const currentClean = recoveryClean();
  const cases = [
    {
      suffix: "edited-request",
      comments: [
        ordinaryRequest({
          id: 551,
          created_at: "2026-08-25T07:50:00Z",
          updated_at: "2026-08-25T07:50:00Z",
        }),
        { ...currentRequest, updated_at: "2026-08-25T08:11:30Z" },
        currentClean,
      ],
    },
    {
      suffix: "edited-clean",
      comments: [
        ordinaryRequest({
          id: 552,
          created_at: "2026-08-25T07:50:00Z",
          updated_at: "2026-08-25T07:50:00Z",
        }),
        currentRequest,
        { ...currentClean, updated_at: "2026-08-25T08:13:00Z" },
      ],
    },
    {
      suffix: "same-time-provider-progress",
      comments: [
        ordinaryRequest({
          id: 553,
          created_at: "2026-08-25T07:50:00Z",
          updated_at: "2026-08-25T07:50:00Z",
        }),
        currentRequest,
        currentClean,
        progressIssueComment({
          id: 554,
          created_at: currentClean.created_at,
          updated_at: currentClean.created_at,
        }),
      ],
    },
    {
      suffix: "same-time-opaque-activity",
      comments: [
        ordinaryRequest({
          id: 555,
          created_at: "2026-08-25T07:50:00Z",
          updated_at: "2026-08-25T07:50:00Z",
        }),
        currentRequest,
        currentClean,
        opaqueProviderIssueComment({
          id: 556,
          created_at: currentClean.created_at,
          updated_at: currentClean.created_at,
        }),
      ],
    },
  ];

  const ambiguousClean = recoveryClean({
    body: `Codex Review: Didn't find any major issues.\n\n**Reviewed commit:** \`${HEAD.slice(0, 10)}\``,
  });
  cases.push({
    suffix: "ambiguous-clean-sha",
    comments: [
      ordinaryRequest({
        id: 557,
        created_at: "2026-08-25T07:50:00Z",
        updated_at: "2026-08-25T07:50:00Z",
      }),
      currentRequest,
      ambiguousClean,
    ],
    commitResolution: () => ({ status: 422, message: "short SHA is ambiguous" }),
  });
  cases.push({
    suffix: "deleted-post-run-boundary",
    comments: [
      ordinaryRequest({
        id: 558,
        created_at: "2026-08-25T07:50:00Z",
        updated_at: "2026-08-25T07:50:00Z",
      }),
      currentRequest,
      currentClean,
    ],
    deletedEvents: [deletedCommentEvent({
      id: "CDE_post_run_boundary",
      createdAt: "2026-08-25T08:11:30Z",
    })],
  });
  cases.push({
    suffix: "ordinary-request-after-base-epoch",
    comments: [
      ordinaryRequest({
        id: 559,
        created_at: "2026-08-25T07:50:00Z",
        updated_at: "2026-08-25T07:50:00Z",
      }),
      currentRequest,
      currentClean,
    ],
    baseEpoch: baseRefChangedEvent({ createdAt: "2026-08-25T08:05:00Z" }),
  });
  cases.push({
    suffix: "later-request-after-clean",
    comments: [
      ordinaryRequest({
        id: 560,
        created_at: "2026-08-25T07:50:00Z",
        updated_at: "2026-08-25T07:50:00Z",
      }),
      currentRequest,
      currentClean,
      ordinaryRequest({
        id: 565,
        created_at: "2026-08-25T08:13:00Z",
        updated_at: "2026-08-25T08:13:00Z",
      }),
    ],
  });

  for (const { suffix, comments, commitResolution, deletedEvents, baseEpoch } of cases) {
    const github = createGitHubMock({
      issueComments: comments,
      commitResolution,
      deletedCommentEvents: deletedEvents,
      baseEpoch,
      selfVerifierRun: verifierSelfRun({ created_at: cutoff }),
    });
    const environment = runtimeEnvironment(context, {
      suffix: `post-run-recovery-unsafe-${suffix}`,
    });
    const { result } = await runGate(environment, github);
    assert.notEqual(result.report.gateOutcome, "success", suffix);
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, suffix);
  }
});

test("a pre-run issue-comment clean cannot be bypassed by a pre-run APPROVED review", async (context) => {
  const request = ordinaryRequest();
  const review = approvedReview(HEAD, {
    submitted_at: "2026-08-25T08:05:00Z",
  });
  const requestAcknowledgement = new Map([[String(request.id), [reaction({
    content: "eyes",
    created_at: "2026-08-25T08:00:30Z",
  })]]]);
  const selfVerifierRun = verifierSelfRun({ created_at: "2026-08-25T08:10:00Z" });

  const reviewOnlyGitHub = createGitHubMock({
    issueComments: [request],
    reviews: [review],
    reactionsByCommentId: requestAcknowledgement,
    selfVerifierRun,
  });
  const reviewOnlyEnvironment = runtimeEnvironment(context, {
    suffix: "pre-run-approved-review-first-generation",
  });
  const { result: reviewOnly } = await runGate(reviewOnlyEnvironment, reviewOnlyGitHub);
  assert.equal(reviewOnly.exitCode, 0, reviewOnly.report.reason);
  assert.equal(reviewOnly.report.gateOutcome, "success");

  const mixedGitHub = createGitHubMock({
    issueComments: [request, cleanIssueComment(HEAD)],
    reviews: [review],
    reactionsByCommentId: requestAcknowledgement,
    selfVerifierRun,
  });
  const mixedEnvironment = runtimeEnvironment(context, {
    suffix: "pre-run-comment-plus-approved-review",
  });
  const { result: mixed } = await runGate(mixedEnvironment, mixedGitHub);
  assert.equal(mixed.exitCode, 1);
  assert.equal(mixed.report.executionHealth, "healthy");
  assert.equal(mixed.report.gateOutcome, "pending", mixed.report.reason);
  assert.notEqual(mixed.report.recoveryCode, "none");
  assert.deepEqual(mixedGitHub.statusWrites, []);
});

test("an earlier canonical workflow request may close the historical generation before ordinary recovery", async (context) => {
  const github = createGitHubMock({
    issueComments: [
      workflowRequest({ body: canonicalRequestBody(HEAD, { runId: "122" }) }),
      cleanIssueComment(HEAD),
      recoveryRequest(),
      recoveryClean(),
    ],
    selfVerifierRun: verifierSelfRun({ created_at: "2026-08-25T08:10:00Z" }),
  });
  const environment = runtimeEnvironment(context, { suffix: "recovery-canonical-prior-request" });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 0, result.report.reason);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "success");
  assert.equal(result.report.recoveryCode, "none");
  assert.deepEqual(github.statusWrites, []);
});

test("a historical canonical request with the wrong base tuple cannot authorize clean recovery", async (context) => {
  for (const [suffix, baseOverride] of [
    ["base-sha", { baseSha: OLD_HEAD }],
    ["base-ref", { baseRef: "release" }],
    ["base-repository", { baseRepositoryId: REPO_ID + 1 }],
  ]) {
    const priorRequest = workflowRequest({
      body: canonicalRequestBody(HEAD, { runId: "122", ...baseOverride }),
    });
    const github = createGitHubMock({
      issueComments: [priorRequest, cleanIssueComment(HEAD), recoveryRequest(), recoveryClean()],
      selfVerifierRun: verifierSelfRun({ created_at: "2026-08-25T08:10:00Z" }),
    });
    const environment = runtimeEnvironment(context, { suffix: `recovery-wrong-${suffix}` });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.gateOutcome, "pending", `${suffix}: ${result.report.reason}`);
    assert.deepEqual(github.statusWrites, [], suffix);
  }
});

test("verifier clean recovery needs both a fresh request and a newer clean", async (context) => {
  const prior = [ordinaryRequest(), cleanIssueComment(HEAD)];
  const cases = [
    ["no-new-request", [...prior, recoveryClean()]],
    ["old-head-clean", [...prior, recoveryRequest(), recoveryClean({
      body: cleanIssueComment(OLD_HEAD).body,
    })]],
    ["non-provider-clean", [...prior, recoveryRequest(), recoveryClean({ user: HUMAN })]],
  ];
  for (const [suffix, issueComments] of cases) {
    const github = createGitHubMock({
      issueComments,
      selfVerifierRun: verifierSelfRun({ created_at: "2026-08-25T08:10:00Z" }),
    });
    const environment = runtimeEnvironment(context, { suffix: `recovery-${suffix}` });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, `${suffix}: ${result.report.reason}`);
    assert.notEqual(result.report.gateOutcome, "success", suffix);
    assert.deepEqual(github.statusWrites, [], suffix);
  }
});

test("an exact canonical second request can recover after a pre-run generation", async (context) => {
  const canonical = workflowRequest({
    id: 301,
    body: canonicalRequestBody(HEAD, { runId: "124" }),
    created_at: "2026-08-25T08:11:00Z",
    updated_at: "2026-08-25T08:11:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-301`,
  });
  const github = createGitHubMock({
    issueComments: [ordinaryRequest(), cleanIssueComment(HEAD), canonical, recoveryClean()],
    selfVerifierRun: verifierSelfRun({ created_at: "2026-08-25T08:10:00Z" }),
  });
  const environment = runtimeEnvironment(context, {
    suffix: "recovery-canonical-second-request",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 0, result.report.reason);
  assert.equal(result.report.gateOutcome, "success");
  assert.equal(result.report.recoveryCode, "none");
});

test("a post-run ordinary request without a new clean waits without requiring a replacement PR", async (context) => {
  const github = createGitHubMock({
    issueComments: [ordinaryRequest(), cleanIssueComment(HEAD), recoveryRequest()],
    selfVerifierRun: verifierSelfRun({ created_at: "2026-08-25T08:10:00Z" }),
  });
  const environment = runtimeEnvironment(context, { suffix: "recovery-wait-for-new-clean" });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_provider", result.report.reason);
  assert.equal(result.report.requiresReplacementPr, false);
  assert.deepEqual(github.statusWrites, []);
});

test("unresolved threads stay additive unless Codex evidence otherwise qualifies for success", async (context) => {
  const cutoff = "2026-08-25T08:10:00Z";
  const unresolvedThread = reviewThread({
    id: "PRRT_primary_codex_recovery",
    isResolved: false,
    path: "src/review.mjs",
    url: `https://github.com/${REPOSITORY}/pull/${PR}#discussion_primary`,
  });
  const cases = [
    {
      suffix: "prerun-clean",
      issueComments: [
        ordinaryRequest(),
        cleanIssueComment(HEAD, {
          created_at: "2026-08-25T08:02:00Z",
          updated_at: "2026-08-25T08:02:00Z",
        }),
      ],
      expectedRecovery: "request_clean_generation",
      expectedReason: /current-head Codex clean predates this verifier run/u,
    },
    {
      suffix: "postrun-request-awaiting-result",
      issueComments: [ordinaryRequest(), cleanIssueComment(HEAD), recoveryRequest()],
      expectedRecovery: "wait_provider",
      expectedReason: /new @codex review request exists.*no qualifying.*terminal clean/u,
    },
    {
      suffix: "no-terminal-result",
      issueComments: [],
      expectedRecovery: "wait_provider",
      expectedReason: /No complete Codex terminal result is bound to the current head/u,
    },
  ];

  for (const scenario of cases) {
    const github = createGitHubMock({
      issueComments: scenario.issueComments,
      reviewThreads: [unresolvedThread],
      selfVerifierRun: verifierSelfRun({ created_at: cutoff }),
    });
    const environment = runtimeEnvironment(context, {
      suffix: `unresolved-thread-${scenario.suffix}`,
    });
    const { result } = await runGate(environment, github);

    assert.equal(result.report.executionHealth, "healthy", scenario.suffix);
    assert.equal(result.report.gateOutcome, "pending", scenario.suffix);
    assert.equal(result.report.recoveryCode, scenario.expectedRecovery, scenario.suffix);
    assert.match(result.report.reason, scenario.expectedReason, scenario.suffix);
    const summary = readFileSync(environment.GITHUB_STEP_SUMMARY, "utf8");
    assert.match(summary, /Also resolve all 1 unresolved pull-request review thread/u);
    assert.match(summary, /then reconcile the exact current head/u);
  }

  const qualifyingGitHub = createGitHubMock({
    issueComments: recoveryEvidence(),
    reviewThreads: [unresolvedThread],
    selfVerifierRun: verifierSelfRun({ created_at: cutoff }),
  });
  const qualifyingEnvironment = runtimeEnvironment(context, {
    suffix: "unresolved-thread-otherwise-qualifying-clean",
  });
  const { result: qualifying } = await runGate(qualifyingEnvironment, qualifyingGitHub);
  assert.equal(qualifying.report.gateOutcome, "pending");
  assert.equal(qualifying.report.recoveryCode, "wait_then_reconcile");
  assert.match(qualifying.report.reason, /GitHub reports 1 unresolved pull-request review thread/u);
  assert.match(
    readFileSync(qualifyingEnvironment.GITHUB_STEP_SUMMARY, "utf8"),
    /Resolve all 1 unresolved pull-request review thread.*dispatch reconcile/u,
  );
});

test("verifier clean recovery requires request and terminal to be strictly after their boundaries", async (context) => {
  const cases = [
    ["request-before-cutoff", "2026-08-25T08:09:00Z", "2026-08-25T08:12:00Z"],
    ["request-at-cutoff", "2026-08-25T08:10:00Z", "2026-08-25T08:12:00Z"],
    ["clean-before-cutoff", "2026-08-25T08:11:00Z", "2026-08-25T08:09:00Z"],
    ["clean-at-cutoff", "2026-08-25T08:11:00Z", "2026-08-25T08:10:00Z"],
    ["clean-at-request", "2026-08-25T08:11:00Z", "2026-08-25T08:11:00Z"],
  ];
  for (const [suffix, requestAt, cleanAt] of cases) {
    const github = createGitHubMock({
      issueComments: [
        ordinaryRequest(),
        cleanIssueComment(HEAD),
        recoveryRequest({ created_at: requestAt, updated_at: requestAt }),
        recoveryClean({ created_at: cleanAt, updated_at: cleanAt }),
      ],
      selfVerifierRun: verifierSelfRun({ created_at: "2026-08-25T08:10:00Z" }),
    });
    const environment = runtimeEnvironment(context, { suffix: `recovery-time-${suffix}` });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, `${suffix}: ${result.report.reason}`);
    assert.notEqual(result.report.gateOutcome, "success", suffix);
    assert.deepEqual(github.statusWrites, [], suffix);
  }
});

test("verifier clean recovery rejects missing or malformed exact-run metadata", async (context) => {
  const cases = [
    ["missing-created-at", verifierSelfRun({ created_at: undefined })],
    ["malformed-created-at", verifierSelfRun({ created_at: "not-a-timestamp" })],
  ];
  for (const [suffix, selfVerifierRun] of cases) {
    const github = createGitHubMock({
      issueComments: recoveryEvidence(),
      selfVerifierRun,
    });
    const environment = runtimeEnvironment(context, { suffix: `recovery-run-${suffix}` });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, `${suffix}: ${result.report.reason}`);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "wait_then_reconcile", suffix);
    assert.deepEqual(github.statusWrites, [], suffix);
  }
});

test("verifier clean recovery rejects a self-run bound to an older feature head", async (context) => {
  const github = createGitHubMock({
    issueComments: recoveryEvidence(),
    selfVerifierRun: verifierSelfRun({
      created_at: "2026-08-25T08:10:00Z",
      head_sha: OLD_HEAD,
    }),
  });
  const environment = runtimeEnvironment(context, { suffix: "recovery-run-old-head" });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.notEqual(result.report.gateOutcome, "success");
  assert.deepEqual(github.statusWrites, []);
});

test("edited recovery carriers cannot turn an earlier clean into verifier success", async (context) => {
  const cases = [
    ["prior-clean", [
      ordinaryRequest(),
      cleanIssueComment(HEAD, { updated_at: "2026-08-25T08:01:01Z" }),
      recoveryRequest(),
      recoveryClean(),
    ]],
    ["new-request", recoveryEvidence({
      request: recoveryRequest({ updated_at: "2026-08-25T08:11:01Z" }),
    })],
    ["new-clean", recoveryEvidence({
      clean: recoveryClean({ updated_at: "2026-08-25T08:12:01Z" }),
    })],
  ];
  for (const [suffix, issueComments] of cases) {
    const github = createGitHubMock({
      issueComments,
      selfVerifierRun: verifierSelfRun({ created_at: "2026-08-25T08:10:00Z" }),
    });
    const environment = runtimeEnvironment(context, { suffix: `recovery-edited-${suffix}` });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, suffix);
    assert.notEqual(result.report.gateOutcome, "success", suffix);
    assert.deepEqual(github.statusWrites, [], suffix);
  }
});

test("later findings and provider activity veto a recovered verifier clean", async (context) => {
  const cases = [
    ["finding", {
      issueComments: [...recoveryEvidence(), findingIssueComment(HEAD, {
        id: 501,
        created_at: "2026-08-25T08:13:00Z",
        updated_at: "2026-08-25T08:13:00Z",
        html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-501`,
      })],
    }],
    ["eyes", {
      issueComments: recoveryEvidence(),
      reactionsByCommentId: new Map([["301", [reaction({
        id: 601,
        content: "eyes",
        created_at: "2026-08-25T08:13:00Z",
      })]]]),
    }],
    ["ambiguous-provider-comment", {
      issueComments: [...recoveryEvidence(), opaqueProviderIssueComment({
        id: 501,
        created_at: "2026-08-25T08:13:00Z",
        updated_at: "2026-08-25T08:13:00Z",
        html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-501`,
      })],
    }],
    ["malformed-provider-result", {
      issueComments: [...recoveryEvidence(), cleanIssueComment(HEAD, {
        id: 501,
        body: "Codex Review: Didn't find any major issues.",
        created_at: "2026-08-25T08:13:00Z",
        updated_at: "2026-08-25T08:13:00Z",
        html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-501`,
      })],
    }],
  ];
  for (const [suffix, githubOptions] of cases) {
    const github = createGitHubMock({
      ...githubOptions,
      selfVerifierRun: verifierSelfRun({ created_at: "2026-08-25T08:10:00Z" }),
    });
    const environment = runtimeEnvironment(context, { suffix: `recovery-later-${suffix}` });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, suffix);
    assert.notEqual(result.report.gateOutcome, "success", suffix);
    assert.deepEqual(github.statusWrites, [], suffix);
  }
});

test("post-run clean recovery does not supersede an unresolved finding before the new request", async (context) => {
  const [priorRequest, priorClean, newRequest, newClean] = recoveryEvidence();
  const finding = findingIssueComment(HEAD, {
    id: 251,
    created_at: "2026-08-25T08:05:00Z",
    updated_at: "2026-08-25T08:05:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-251`,
  });
  const github = createGitHubMock({
    issueComments: [priorRequest, priorClean, finding, newRequest, newClean],
    selfVerifierRun: verifierSelfRun({ created_at: "2026-08-25T08:10:00Z" }),
  });
  const environment = runtimeEnvironment(context, { suffix: "recovery-prior-unresolved-finding" });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "failure");
  assert.equal(result.report.recoveryCode, "fix_findings");
  assert.equal(result.report.counts.unresolved, 1);
  assert.equal(result.report.counts.resolved, 0);
  assert.deepEqual(github.statusWrites, []);
});

test("historical clean settles old-request eyes only when the eyes preceded that clean", async (context) => {
  for (const [suffix, eyesAt, expectedOutcome] of [
    ["before-historical-clean", "2026-08-25T08:00:30Z", "success"],
    ["at-historical-clean", "2026-08-25T08:01:00Z", "pending"],
    ["after-historical-clean", "2026-08-25T08:05:00Z", "pending"],
  ]) {
    const github = createGitHubMock({
      issueComments: recoveryEvidence(),
      reactionsByCommentId: new Map([["101", [reaction({
        id: 601,
        content: "eyes",
        created_at: eyesAt,
      })]]]),
      selfVerifierRun: verifierSelfRun({ created_at: "2026-08-25T08:10:00Z" }),
    });
    const environment = runtimeEnvironment(context, { suffix: `recovery-old-eyes-${suffix}` });
    const { result } = await runGate(environment, github);
    assert.equal(result.report.executionHealth, "healthy", suffix);
    assert.equal(result.report.gateOutcome, expectedOutcome, `${suffix}: ${result.report.reason}`);
    assert.equal(result.exitCode, expectedOutcome === "success" ? 0 : 1, suffix);
    assert.deepEqual(github.statusWrites, [], suffix);
  }
});

test("verifier clean recovery does not reopen ambiguous request lineage", async (context) => {
  const thirdRequest = ordinaryRequest({
    id: 501,
    created_at: "2026-08-25T08:13:00Z",
    updated_at: "2026-08-25T08:13:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-501`,
  });
  const cases = [
    ["unclosed-prior-gap", {
      issueComments: [
        workflowRequest({ body: canonicalRequestBody(HEAD, { runId: "122" }) }),
        recoveryRequest(),
        recoveryClean(),
      ],
    }],
    ["third-request", { issueComments: [...recoveryEvidence(), thirdRequest] }],
    ["base-epoch", {
      issueComments: recoveryEvidence(),
      baseEpoch: baseRefChangedEvent(),
    }],
  ];
  for (const [suffix, githubOptions] of cases) {
    const github = createGitHubMock({
      ...githubOptions,
      selfVerifierRun: verifierSelfRun({ created_at: "2026-08-25T08:10:00Z" }),
    });
    const environment = runtimeEnvironment(context, { suffix: `recovery-lineage-${suffix}` });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, suffix);
    assert.notEqual(result.report.gateOutcome, "success", suffix);
    assert.deepEqual(github.statusWrites, [], suffix);
  }
});

test("additional pre-run clean carriers do not invalidate the current-head witness", async (context) => {
  const github = createGitHubMock({
    issueComments: [
      ordinaryRequest(),
      cleanIssueComment(HEAD),
      cleanIssueComment(HEAD, {
        id: 202,
        created_at: "2026-08-25T08:02:00Z",
        updated_at: "2026-08-25T08:02:00Z",
        html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-202`,
      }),
      recoveryRequest(),
      recoveryClean(),
    ],
    selfVerifierRun: verifierSelfRun({ created_at: "2026-08-25T08:10:00Z" }),
  });
  const environment = runtimeEnvironment(context, {
    suffix: "recovery-additional-pre-run-clean",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 0, result.report.reason);
  assert.equal(result.report.gateOutcome, "success");
});

test("default-any ordinary requests accept an official terminal clean receipt", async (context) => {
  const terminal = cleanIssueComment(HEAD, {
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  for (const [suffix, body] of [
    ["ordinary-terminal-no-eol", "@codex review"],
    ["ordinary-terminal-lf", "@codex review\n"],
    ["ordinary-terminal-crlf", "@codex review\r\n"],
  ]) {
    const ordinary = ordinaryRequest({ body });
    const terminalGitHub = createGitHubMock({ issueComments: [ordinary, terminal] });
    const terminalEnvironment = runtimeEnvironment(context, { suffix });
    const { result: terminalResult } = await runGate(terminalEnvironment, terminalGitHub);
    assert.equal(terminalResult.exitCode, 0, suffix);
    assert.equal(terminalResult.report.gateOutcome, "success", suffix);
    assert.equal(terminalResult.report.recoveryCode, "none", suffix);
    assert.equal(
      terminalGitHub.calls.some((call) => call.path.endsWith(`/commits/${HEAD}`)),
      false,
      suffix,
    );
    assert.equal(
      hasRequestReactionGraphQlCall(terminalGitHub, ordinary.id),
      true,
      suffix,
    );
  }

  const shortReceiptRequest = ordinaryRequest({ id: 102, user: READER });
  const shortReceipt = cleanIssueComment(HEAD.slice(0, 10), {
    id: 202,
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const shortReceiptGitHub = createGitHubMock({
    issueComments: [shortReceiptRequest, shortReceipt],
  });
  const shortReceiptEnvironment = runtimeEnvironment(context, {
    suffix: "ordinary-terminal-short-sha-receipt",
  });
  const { result: shortReceiptResult } = await runGate(
    shortReceiptEnvironment,
    shortReceiptGitHub,
  );
  assert.equal(shortReceiptResult.exitCode, 0);
  assert.equal(shortReceiptResult.report.gateOutcome, "success");
  assert.equal(shortReceiptResult.report.recoveryCode, "none");
  assert.equal(
    shortReceiptGitHub.calls.some((call) =>
      call.path.endsWith(`/commits/${HEAD.slice(0, 10)}`)
    ),
    true,
  );

  const ordinary = ordinaryRequest();

  const acknowledgedGitHub = createGitHubMock({
    issueComments: [ordinary, terminal],
    reactionsByCommentId: new Map([[String(ordinary.id), [reaction({
      content: "eyes",
      created_at: "2026-08-25T08:01:00Z",
    })]]]),
  });
  const acknowledgedEnvironment = runtimeEnvironment(context, {
    suffix: "ordinary-official-acknowledgement",
  });
  const { result: acknowledgedResult } = await runGate(
    acknowledgedEnvironment,
    acknowledgedGitHub,
  );
  assert.equal(acknowledgedResult.report.gateOutcome, "success");

  const plusOneAcknowledgedGitHub = createGitHubMock({
    issueComments: [ordinary, terminal],
    reactionsByCommentId: new Map([[String(ordinary.id), [reaction({
      content: "+1",
      created_at: "2026-08-25T08:01:00Z",
    })]]]),
  });
  const plusOneAcknowledgedEnvironment = runtimeEnvironment(context, {
    suffix: "ordinary-official-plus-one-acknowledgement",
  });
  const { result: plusOneAcknowledgedResult } = await runGate(
    plusOneAcknowledgedEnvironment,
    plusOneAcknowledgedGitHub,
  );
  assert.equal(plusOneAcknowledgedResult.report.gateOutcome, "success");

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
  assert.equal(untrustedEyesResult.exitCode, 0);
  assert.equal(untrustedEyesResult.report.gateOutcome, "success");
  assert.equal(untrustedEyesResult.report.recoveryCode, "none");

  const reactionGitHub = createGitHubMock({
    issueComments: [ordinary],
    reactionsByCommentId: new Map([[String(ordinary.id), [reaction()]]]),
  });
  const reactionEnvironment = runtimeEnvironment(context, { suffix: "ordinary-reaction" });
  const { result: reactionResult } = await runGate(reactionEnvironment, reactionGitHub);
  assert.equal(reactionResult.report.gateOutcome, "pending");
  assert.equal(
    hasRequestReactionGraphQlCall(reactionGitHub, ordinary.id),
    true,
  );
});

test("a terminal clean receipt cannot uniquely satisfy multiple default-any requests", async (context) => {
  const first = ordinaryRequest({ id: 101, user: READER });
  const second = ordinaryRequest({
    id: 102,
    user: HUMAN,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const terminal = cleanIssueComment(HEAD, {
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const github = createGitHubMock({ issueComments: [first, second, terminal] });
  const environment = runtimeEnvironment(context, {
    suffix: "multiple-default-any-terminal-receipt",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_provider");
  assert.equal(result.report.requiresReplacementPr, true);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("a same-author pair of plain default-any requests can recover through one exact-head clean", async (context) => {
  const first = ordinaryRequest({ id: 101, user: HUMAN });
  const second = ordinaryRequest({
    id: 102,
    user: HUMAN,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const terminal = cleanIssueComment(HEAD.slice(0, 10), {
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const github = createGitHubMock({ issueComments: [first, second, terminal] });
  const environment = runtimeEnvironment(context, {
    suffix: "same-author-default-any-duplicate-cohort",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.gateOutcome, "success");
  assert.equal(result.report.recoveryCode, "none");
  assert.equal(result.report.requiresReplacementPr, false);
  assert.equal(
    github.calls.some((call) => call.path.endsWith(`/commits/${HEAD.slice(0, 10)}`)),
    true,
  );
});

test("an unbound top-level Codex progress before a duplicate cohort vetoes its clean receipt", async (context) => {
  const priorProgress = {
    id: 200,
    body: "Codex Review still in progress.",
    created_at: "2026-08-25T07:59:00Z",
    updated_at: "2026-08-25T07:59:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-200`,
    user: CODEX_BOT,
    performed_via_github_app: CODEX_APP,
  };
  const first = ordinaryRequest({ id: 101, user: HUMAN });
  const second = ordinaryRequest({
    id: 102,
    user: HUMAN,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const terminal = cleanIssueComment(HEAD, {
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const github = createGitHubMock({
    issueComments: [priorProgress, first, second, terminal],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "duplicate-cohort-prior-unbound-progress",
  });
  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("an opaque official top-level Codex activity before a duplicate cohort vetoes its clean receipt", async (context) => {
  const priorOpaqueActivity = opaqueProviderIssueComment({
    created_at: "2026-08-25T07:59:00Z",
    updated_at: "2026-08-25T07:59:00Z",
  });
  const first = ordinaryRequest({ id: 101, user: HUMAN });
  const second = ordinaryRequest({
    id: 102,
    user: HUMAN,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const terminal = cleanIssueComment(HEAD, {
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const github = createGitHubMock({
    issueComments: [priorOpaqueActivity, first, second, terminal],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "duplicate-cohort-prior-opaque-provider-activity",
  });
  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("opaque official top-level Codex activity in every duplicate-cohort exclusive window vetoes its clean receipt", async (context) => {
  const first = ordinaryRequest({ id: 101, user: HUMAN });
  const second = ordinaryRequest({
    id: 102,
    user: HUMAN,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const closure = cleanIssueComment(HEAD, {
    id: 201,
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const successor = workflowRequest({
    id: 103,
    body: canonicalRequestBody(HEAD, { runId: "103" }),
    created_at: "2026-08-25T08:03:00Z",
    updated_at: "2026-08-25T08:03:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-103`,
  });
  const cases = [
    [
      "first-second",
      [
        first,
        opaqueProviderIssueComment({
          id: 202,
          created_at: "2026-08-25T08:00:30Z",
          updated_at: "2026-08-25T08:00:30Z",
          html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-202`,
        }),
        second,
        closure,
      ],
      new Map(),
    ],
    [
      "second-closure",
      [
        first,
        second,
        opaqueProviderIssueComment({
          id: 202,
          created_at: "2026-08-25T08:01:30Z",
          updated_at: "2026-08-25T08:01:30Z",
          html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-202`,
        }),
        closure,
      ],
      new Map(),
    ],
    [
      "closure-successor",
      [
        first,
        second,
        closure,
        opaqueProviderIssueComment({
          id: 202,
          created_at: "2026-08-25T08:02:30Z",
          updated_at: "2026-08-25T08:02:30Z",
          html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-202`,
        }),
        successor,
      ],
      new Map([[String(successor.id), [reaction({
        id: 650,
        created_at: "2026-08-25T08:03:30Z",
      })]]]),
    ],
  ];

  for (const [suffix, comments, reactionsByCommentId] of cases) {
    const github = createGitHubMock({
      issueComments: comments,
      reactionsByCommentId,
    });
    const environment = runtimeEnvironment(context, {
      suffix: `duplicate-cohort-opaque-${suffix}`,
    });
    const { result } = await runGate(environment, github);

    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.executionHealth, "healthy", suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, suffix);
  }
});

test("a non-official opaque comment before a duplicate cohort does not veto its clean receipt", async (context) => {
  const priorNonProviderComment = opaqueProviderIssueComment({
    user: HUMAN,
    performed_via_github_app: null,
    created_at: "2026-08-25T07:59:00Z",
    updated_at: "2026-08-25T07:59:00Z",
  });
  const first = ordinaryRequest({ id: 101, user: HUMAN });
  const second = ordinaryRequest({
    id: 102,
    user: HUMAN,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const terminal = cleanIssueComment(HEAD, {
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const github = createGitHubMock({
    issueComments: [priorNonProviderComment, first, second, terminal],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "duplicate-cohort-prior-non-provider-activity",
  });
  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "success");
  assert.equal(result.report.recoveryCode, "none");
});

test("a safely bound historical terminal clean before a duplicate cohort does not veto its clean receipt", async (context) => {
  const historicalClean = cleanIssueComment("c".repeat(40), {
    id: 200,
    created_at: "2026-08-25T07:59:00Z",
    updated_at: "2026-08-25T07:59:00Z",
  });
  const first = ordinaryRequest({ id: 101, user: HUMAN });
  const second = ordinaryRequest({
    id: 102,
    user: HUMAN,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const terminal = cleanIssueComment(HEAD, {
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const github = createGitHubMock({
    issueComments: [historicalClean, first, second, terminal],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "duplicate-cohort-prior-historical-clean",
  });
  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "success");
  assert.equal(result.report.recoveryCode, "none");
});

test("an edited full-bound historical clean before a duplicate cohort vetoes its clean receipt", async (context) => {
  const editedHistoricalClean = cleanIssueComment("c".repeat(40), {
    id: 200,
    created_at: "2026-08-25T07:59:00Z",
    updated_at: "2026-08-25T07:59:30Z",
  });
  const first = ordinaryRequest({ id: 101, user: HUMAN });
  const second = ordinaryRequest({
    id: 102,
    user: HUMAN,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const terminal = cleanIssueComment(HEAD, {
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const github = createGitHubMock({
    issueComments: [editedHistoricalClean, first, second, terminal],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "duplicate-cohort-prior-edited-historical-clean",
  });
  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("a malformed top-level Codex progress before a duplicate cohort vetoes its clean receipt", async (context) => {
  const malformedPriorProgress = {
    id: 200,
    body: "Codex Review still in progress.\nstatus=queued",
    created_at: "2026-08-25T07:59:00Z",
    updated_at: "2026-08-25T07:59:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-200`,
    user: CODEX_BOT,
    performed_via_github_app: CODEX_APP,
  };
  const first = ordinaryRequest({ id: 101, user: HUMAN });
  const second = ordinaryRequest({
    id: 102,
    user: HUMAN,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const terminal = cleanIssueComment(HEAD, {
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const github = createGitHubMock({
    issueComments: [malformedPriorProgress, first, second, terminal],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "duplicate-cohort-prior-malformed-progress",
  });
  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("a closed same-author duplicate cohort cannot block one later canonical generation", async (context) => {
  const first = ordinaryRequest({ id: 101, user: HUMAN });
  const second = ordinaryRequest({
    id: 102,
    user: HUMAN,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const firstClean = cleanIssueComment(HEAD.slice(0, 10), {
    id: 201,
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const canonical = workflowRequest({
    id: 103,
    created_at: "2026-08-25T08:03:00Z",
    updated_at: "2026-08-25T08:03:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-103`,
  });
  const lateClean = cleanIssueComment(HEAD.slice(0, 10), {
    id: 202,
    created_at: "2026-08-25T08:04:00Z",
    updated_at: "2026-08-25T08:04:00Z",
  });
  const github = createGitHubMock({
    issueComments: [first, second, firstClean, canonical, lateClean],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "duplicate-cohort-before-canonical-generation",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "request_clean_generation");
  assert.equal(result.report.requiresReplacementPr, false);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);

  const directGitHub = createGitHubMock({
    issueComments: [first, second, firstClean, canonical, lateClean],
    reactionsByCommentId: new Map([[String(canonical.id), [reaction({
      id: 650,
      created_at: "2026-08-25T08:04:30Z",
    })]]]),
  });
  const directEnvironment = runtimeEnvironment(context, {
    suffix: "duplicate-cohort-canonical-direct-clean",
  });
  const { result: direct } = await runGate(directEnvironment, directGitHub);
  assert.equal(direct.exitCode, 0);
  assert.equal(direct.report.gateOutcome, "success");
  assert.equal(direct.report.recoveryCode, "none");

  const priorFinding = findingReview(HEAD, {
    id: 401,
    submitted_at: "2026-08-25T07:59:00Z",
  });
  const findingGitHub = createGitHubMock({
    issueComments: [first, second, firstClean, canonical, lateClean],
    reviews: [priorFinding],
  });
  const findingEnvironment = runtimeEnvironment(context, {
    suffix: "duplicate-cohort-late-clean-cannot-supersede-finding",
  });
  const { result: finding } = await runGate(findingEnvironment, findingGitHub);
  assert.equal(finding.exitCode, 1);
  assert.equal(finding.report.gateOutcome, "failure");
  assert.equal(finding.report.counts.unresolved, 1);
  assert.equal(finding.report.counts.resolved, 0);
  assert.equal(findingGitHub.statusWrites.some(({ state }) => state === "success"), false);

  const incompleteGitHub = createGitHubMock({
    issueComments: [first, second, firstClean, canonical],
  });
  const incompleteEnvironment = runtimeEnvironment(context, {
    suffix: "duplicate-cohort-canonical-awaits-terminal",
  });
  const { result: incomplete } = await runGate(incompleteEnvironment, incompleteGitHub);
  assert.notEqual(incomplete.report.gateOutcome, "success");
  assert.equal(incomplete.report.recoveryCode, "wait_provider");
});

test("duplicate-cohort recovery stays fail-closed when provider activity separates its closure from a canonical successor", async (context) => {
  const first = ordinaryRequest({ id: 101, user: HUMAN });
  const second = ordinaryRequest({
    id: 102,
    user: HUMAN,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const closure = cleanIssueComment(HEAD, {
    id: 201,
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const canonical = workflowRequest({
    id: 103,
    body: canonicalRequestBody(HEAD, { runId: "103" }),
    created_at: "2026-08-25T08:04:00Z",
    updated_at: "2026-08-25T08:04:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-103`,
  });
  const cases = [
    [
      "competing-clean",
      cleanIssueComment(HEAD, {
        id: 202,
        created_at: "2026-08-25T08:03:00Z",
        updated_at: "2026-08-25T08:03:00Z",
      }),
    ],
    [
      "competing-progress",
      progressIssueComment({
        id: 203,
        created_at: "2026-08-25T08:03:00Z",
        updated_at: "2026-08-25T08:03:00Z",
      }),
    ],
  ];

  for (const [suffix, competingArtifact] of cases) {
    const github = createGitHubMock({
      issueComments: [first, second, closure, competingArtifact, canonical],
      reactionsByCommentId: new Map([[String(canonical.id), [reaction({
        id: 650,
        created_at: "2026-08-25T08:04:30Z",
      })]]]),
    });
    const environment = runtimeEnvironment(context, {
      suffix: `duplicate-cohort-successor-${suffix}`,
    });
    const { result } = await runGate(environment, github);

    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.executionHealth, "healthy", suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "request_clean_generation", suffix);
    assert.equal(result.report.requiresReplacementPr, true, suffix);
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, suffix);
  }
});

test("duplicate-cohort recovery globally rejects a provider error outside its artifact window", async (context) => {
  const invalidProviderBeforePair = cleanIssueComment(HEAD, {
    id: 200,
    performed_via_github_app: { slug: "wrong-provider" },
    created_at: "2026-08-25T07:59:00Z",
    updated_at: "2026-08-25T07:59:00Z",
  });
  const first = ordinaryRequest({ id: 101, user: HUMAN });
  const second = ordinaryRequest({
    id: 102,
    user: HUMAN,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const closure = cleanIssueComment(HEAD, {
    id: 201,
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const canonical = workflowRequest({
    id: 103,
    body: canonicalRequestBody(HEAD, { runId: "103" }),
    created_at: "2026-08-25T08:03:00Z",
    updated_at: "2026-08-25T08:03:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-103`,
  });
  const github = createGitHubMock({
    issueComments: [invalidProviderBeforePair, first, second, closure, canonical],
    reactionsByCommentId: new Map([[String(canonical.id), [reaction({
      id: 651,
      created_at: "2026-08-25T08:03:30Z",
    })]]]),
  });
  const environment = runtimeEnvironment(context, {
    suffix: "duplicate-cohort-provider-error-outside-window",
  });
  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "request_clean_generation");
  assert.equal(result.report.requiresReplacementPr, true);
  assert.equal(result.report.counts.indeterminate > 0, true);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("duplicate-cohort closure rejects provider errors, invalid provenance, and findings in its window", async (context) => {
  const first = ordinaryRequest({ id: 101, user: HUMAN });
  const second = ordinaryRequest({
    id: 102,
    user: HUMAN,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const closure = cleanIssueComment(HEAD.slice(0, 10), {
    id: 201,
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const invalidProvider = cleanIssueComment(HEAD, {
    id: 202,
    performed_via_github_app: { slug: "wrong-provider" },
    created_at: "2026-08-25T08:01:30Z",
    updated_at: "2026-08-25T08:01:30Z",
  });
  const invalidReaction = reaction({
    id: "not-a-positive-id",
    content: "eyes",
    created_at: "2026-08-25T08:01:30Z",
  });
  const errorCases = [
    [
      "provider-reaction-error",
      createGitHubMock({
        issueComments: [first, second, closure],
        reactionsByCommentId: new Map([[String(first.id), [invalidReaction]]]),
      }),
      { executionHealth: "unhealthy", recoveryCode: "wait_then_reconcile" },
    ],
    [
      "invalid-provider-provenance",
      createGitHubMock({ issueComments: [first, second, invalidProvider, closure] }),
      { executionHealth: "healthy", indeterminate: true },
    ],
  ];
  for (const [suffix, github, expected] of errorCases) {
    const environment = runtimeEnvironment(context, {
      suffix: `duplicate-cohort-${suffix}`,
    });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.executionHealth, expected.executionHealth, suffix);
    assert.notEqual(result.report.gateOutcome, "success", suffix);
    if (expected.recoveryCode) {
      assert.equal(result.report.recoveryCode, expected.recoveryCode, suffix);
    }
    if (expected.indeterminate) {
      assert.equal(result.report.counts.indeterminate > 0, true, suffix);
    }
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, suffix);
  }

  const findingGitHub = createGitHubMock({
    issueComments: [first, second, findingIssueComment(HEAD, {
      id: 203,
      created_at: "2026-08-25T08:01:30Z",
      updated_at: "2026-08-25T08:01:30Z",
    }), closure],
  });
  const findingEnvironment = runtimeEnvironment(context, {
    suffix: "duplicate-cohort-window-finding",
  });
  const { result: finding } = await runGate(findingEnvironment, findingGitHub);
  assert.equal(finding.exitCode, 1);
  assert.equal(finding.report.gateOutcome, "failure");
  assert.equal(finding.report.counts.unresolved, 1);
  assert.equal(finding.report.counts.resolved, 0);
  assert.equal(findingGitHub.statusWrites.some(({ state }) => state === "success"), false);
});

test("duplicate-cohort recovery rejects ambiguous or malformed successors before a late raw clean", async (context) => {
  const first = ordinaryRequest({ id: 101, user: HUMAN });
  const second = ordinaryRequest({
    id: 102,
    user: HUMAN,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const closure = cleanIssueComment(HEAD.slice(0, 10), {
    id: 201,
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const lateClean = cleanIssueComment(HEAD.slice(0, 10), {
    id: 202,
    created_at: "2026-08-25T08:04:00Z",
    updated_at: "2026-08-25T08:04:00Z",
  });
  const successorAt = (id, createdAt, overrides = {}) => workflowRequest({
    id,
    body: canonicalRequestBody(HEAD, { runId: String(id) }),
    created_at: createdAt,
    updated_at: createdAt,
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-${id}`,
    ...overrides,
  });
  const cases = [
    [
      "same-time-pair",
      [ordinaryRequest({
        id: 102,
        user: HUMAN,
        created_at: first.created_at,
        updated_at: first.updated_at,
        html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
      })],
      [],
    ],
    ["same-time-successor", [second], [successorAt(103, closure.created_at)]],
    [
      "wrong-base-successor",
      [second],
      [successorAt(104, "2026-08-25T08:03:00Z", {
        body: canonicalRequestBody(HEAD, { baseSha: "b".repeat(40), runId: "104" }),
      })],
    ],
    [
      "noncanonical-successor",
      [second],
      [ordinaryRequest({
        id: 105,
        user: HUMAN,
        created_at: "2026-08-25T08:03:00Z",
        updated_at: "2026-08-25T08:03:00Z",
        html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-105`,
      })],
    ],
    [
      "edited-successor",
      [second],
      [successorAt(106, "2026-08-25T08:03:00Z", {
        updated_at: "2026-08-25T08:03:30Z",
        last_edited_at: "2026-08-25T08:03:30Z",
      })],
    ],
    [
      "multiple-successors",
      [second],
      [
        successorAt(107, "2026-08-25T08:03:00Z"),
        successorAt(108, "2026-08-25T08:03:30Z"),
      ],
    ],
  ];
  for (const [suffix, pair, successors] of cases) {
    const github = createGitHubMock({
      issueComments: [first, ...pair, closure, ...successors, lateClean],
    });
    const environment = runtimeEnvironment(context, {
      suffix: `duplicate-cohort-${suffix}`,
    });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, suffix);
    assert.notEqual(result.report.gateOutcome, "success", suffix);
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, suffix);
  }
});

test("reverse opening and closing duplicate-cohort snapshots stay fail-closed and stable", async (context) => {
  const first = ordinaryRequest({ id: 101, user: HUMAN });
  const second = ordinaryRequest({
    id: 102,
    user: HUMAN,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const closure = cleanIssueComment(HEAD.slice(0, 10), {
    id: 201,
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const successor = workflowRequest({
    id: 103,
    body: canonicalRequestBody(HEAD, { runId: "103" }),
    created_at: "2026-08-25T08:03:00Z",
    updated_at: "2026-08-25T08:03:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-103`,
  });
  const lateClean = cleanIssueComment(HEAD.slice(0, 10), {
    id: 202,
    created_at: "2026-08-25T08:04:00Z",
    updated_at: "2026-08-25T08:04:00Z",
  });
  const forward = [first, second, closure, successor, lateClean];
  const reverse = [...forward].reverse();
  const outcomes = [];
  for (const [suffix, snapshots] of [
    ["forward-reverse", [forward, reverse]],
    ["reverse-forward", [reverse, forward]],
  ]) {
    const github = createGitHubMock({ issueCommentSnapshots: snapshots });
    const environment = runtimeEnvironment(context, {
      suffix: `duplicate-cohort-${suffix}`,
    });
    const { result } = await runGate(environment, github, { stabilityWindowMs: 1 });
    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.executionHealth, "healthy", suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "request_clean_generation", suffix);
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, suffix);
    outcomes.push([
      result.report.executionHealth,
      result.report.gateOutcome,
      result.report.recoveryCode,
      result.report.requiresReplacementPr,
    ]);
  }
  assert.deepEqual(outcomes[0], outcomes[1]);
});

test("a duplicate default-any cohort remains fail-closed when it has competing activity", async (context) => {
  const first = ordinaryRequest({ id: 101, user: HUMAN });
  const second = ordinaryRequest({
    id: 102,
    user: HUMAN,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const terminal = cleanIssueComment(HEAD, {
    created_at: "2026-08-25T08:03:00Z",
    updated_at: "2026-08-25T08:03:00Z",
  });
  const third = ordinaryRequest({
    id: 103,
    user: HUMAN,
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-103`,
  });
  const progress = progressIssueComment({
    id: 204,
    created_at: "2026-08-25T08:02:30Z",
    updated_at: "2026-08-25T08:02:30Z",
  });
  const editedOverlap = cleanIssueComment(HEAD, {
    id: 205,
    created_at: "2026-08-25T07:59:00Z",
    updated_at: "2026-08-25T08:01:30Z",
  });
  const cases = [
    ["third-plain-request", [first, second, third, terminal], new Map()],
    ["intervening-provider-activity", [first, second, progress, terminal], new Map()],
    ["overlapping-edited-provider-activity", [editedOverlap, first, second, terminal], new Map()],
    ["direct-official-reaction", [first, second, terminal], new Map([[String(first.id), [reaction({
      content: "eyes",
      created_at: "2026-08-25T08:01:30Z",
    })]]])],
    ["same-time-official-reaction", [first, second, terminal], new Map([[String(first.id), [reaction({
      content: "eyes",
      created_at: first.created_at,
    })]]])],
  ];
  for (const [suffix, issueComments, reactionsByCommentId] of cases) {
    const github = createGitHubMock({ issueComments, reactionsByCommentId });
    const environment = runtimeEnvironment(context, {
      suffix: `duplicate-cohort-${suffix}`,
    });
    const { result } = await runGate(environment, github);
    assert.notEqual(result.report.gateOutcome, "success", suffix);
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, suffix);
  }

  const canonicalBeforeClosure = workflowRequest({
    id: 104,
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-104`,
  });
  const canonicalGitHub = createGitHubMock({
    issueComments: [first, second, canonicalBeforeClosure, terminal],
  });
  const canonicalEnvironment = runtimeEnvironment(context, {
    suffix: "duplicate-cohort-canonical-before-closure",
  });
  const { result: canonicalResult } = await runGate(canonicalEnvironment, canonicalGitHub);
  assert.notEqual(canonicalResult.report.gateOutcome, "success");

  const baseEpochGitHub = createGitHubMock({
    baseEpoch: baseRefChangedEvent({ createdAt: "2026-08-25T07:59:00Z" }),
    issueComments: [first, second, terminal],
  });
  const baseEpochEnvironment = runtimeEnvironment(context, {
    suffix: "duplicate-cohort-base-epoch",
  });
  const { result: baseEpochResult } = await runGate(baseEpochEnvironment, baseEpochGitHub);
  assert.notEqual(baseEpochResult.report.gateOutcome, "success");
});

test("a previous-head request does not make a current default-any terminal receipt ambiguous", async (context) => {
  const current = ordinaryRequest({ user: READER });
  const previousHead = workflowRequest({
    id: 102,
    body: canonicalRequestBody(OLD_HEAD, { runId: "124" }),
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const terminal = cleanIssueComment(HEAD, {
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const github = createGitHubMock({ issueComments: [current, previousHead, terminal] });
  const environment = runtimeEnvironment(context, {
    suffix: "old-head-does-not-ambiguate-default-any-terminal-receipt",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.gateOutcome, "success");
  assert.equal(result.report.recoveryCode, "none");
  assert.equal(result.report.requiresReplacementPr, false);
});

test("a base epoch rejects a default-any terminal clean receipt", async (context) => {
  const request = ordinaryRequest({ user: READER });
  const terminal = cleanIssueComment(HEAD, {
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const github = createGitHubMock({
    baseEpoch: baseRefChangedEvent({ createdAt: "2026-08-25T07:59:00Z" }),
    issueComments: [request, terminal],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "default-any-terminal-receipt-base-epoch",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "request_clean_generation");
  assert.equal(result.report.requiresReplacementPr, true);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("a generic pull-request review clean cannot promote a default-any request", async (context) => {
  const request = ordinaryRequest({ user: READER });
  const review = approvedReview(HEAD, {
    submitted_at: "2026-08-25T08:02:00Z",
  });
  const github = createGitHubMock({
    issueComments: [request],
    reviews: [review],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "default-any-review-clean-is-not-receipt",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_provider");
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("a closed Codex inline-parent review can promote one default-any request with clear threads", async (context) => {
  const request = ordinaryRequest({ user: READER });
  const review = inlineParentReview(HEAD, {
    submitted_at: "2026-08-25T08:02:00Z",
  });
  const github = createGitHubMock({
    issueComments: [request],
    reviews: [review],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "default-any-inline-parent-terminal-receipt",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.gateOutcome, "success");
  assert.equal(result.report.recoveryCode, "none");
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
  assert.deepEqual(result.report.reviewThreads, {
    status: "complete",
    unresolved: 0,
    resolved: 0,
    total: 0,
    diagnostics: [],
  });
  const threadInventoryQuery = github.calls.find(({ path, body }) =>
    path === "/graphql" && /reviewThreads/iu.test(String(body?.query || ""))
  );
  assert.ok(threadInventoryQuery, "the gate must inspect the complete review-thread inventory");
  assert.doesNotMatch(
    threadInventoryQuery.body.query,
    /comments\s*\([^)]*\)\s*\{[\s\S]*?\bbody\b/u,
    "thread inspection may fetch only a minimal diagnostic URL, not comment bodies",
  );
});

test("an inline-parent receipt fails closed when an eligibility predicate is not met", async (context) => {
  const request = ordinaryRequest({ user: READER });
  const valid = inlineParentReview(HEAD, {
    submitted_at: "2026-08-25T08:02:00Z",
  });
  const cases = [
    ["non-official-bot", { ...valid, user: { login: "other-reviewer[bot]", type: "Bot" } }],
    ["wrong-app", {
      ...valid,
      app: { slug: "other-reviewer" },
      performed_via_github_app: { slug: "other-reviewer" },
    }],
    ["non-commented", { ...valid, state: "APPROVED" }],
    ["same-request-revision", {
      ...valid,
      submitted_at: "2026-08-25T08:00:00Z",
    }],
    ["pre-request-revision", {
      ...valid,
      submitted_at: "2026-08-25T07:59:59Z",
    }],
    ["old-native-head", inlineParentReview(OLD_HEAD, {
      submitted_at: "2026-08-25T08:02:00Z",
    })],
    ["reviewed-native-head-mismatch", {
      ...valid,
      commit_id: OLD_HEAD,
    }],
    ["non-closed-grammar", {
      ...valid,
      body: `${valid.body}\nUnexpected terminal content`,
    }],
  ];

  for (const [suffix, review] of cases) {
    const github = createGitHubMock({
      issueComments: [request],
      reviews: [review],
    });
    const environment = runtimeEnvironment(context, {
      suffix: `default-any-inline-parent-receipt-${suffix}`,
    });
    const { result } = await runGate(environment, github);
    assert.notEqual(result.report.gateOutcome, "success", suffix);
    assert.equal(
      github.statusWrites.some(({ state }) => state === "success"),
      false,
      suffix,
    );
  }
});

test("a seven-character inline-parent reviewed commit remains bound by its native full head", async (context) => {
  const request = ordinaryRequest({ user: READER });
  const standard = inlineParentReview(HEAD, {
    submitted_at: "2026-08-25T08:02:00Z",
  });
  const review = {
    ...standard,
    body: standard.body.replace(HEAD.slice(0, 10), HEAD.slice(0, 7)),
  };
  const github = createGitHubMock({
    issueComments: [request],
    reviews: [review],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "default-any-inline-parent-seven-character-reviewed-commit",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.gateOutcome, "success");
  assert.equal(result.report.recoveryCode, "none");
});

test("a closed Codex inline-parent review cannot uniquely satisfy multiple default-any requests", async (context) => {
  const first = ordinaryRequest({ id: 101, user: READER });
  const second = ordinaryRequest({
    id: 102,
    user: HUMAN,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const review = inlineParentReview(HEAD, {
    submitted_at: "2026-08-25T08:02:00Z",
  });
  const github = createGitHubMock({
    issueComments: [first, second],
    reviews: [review],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "multiple-default-any-inline-parent-terminal-receipt",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_provider");
  assert.equal(result.report.requiresReplacementPr, true);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("a closed inline-parent review cannot cross a later canonical physical boundary", async (context) => {
  const first = ordinaryRequest({ id: 101, user: READER });
  const laterCanonical = workflowRequest({
    id: 102,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const review = inlineParentReview(HEAD, {
    submitted_at: "2026-08-25T08:02:00Z",
  });
  const github = createGitHubMock({
    issueComments: [first, laterCanonical],
    reviews: [review],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "inline-parent-later-canonical-physical-boundary",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.requiresReplacementPr, true);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("a closed Codex inline-parent review cannot promote default-any after a base epoch", async (context) => {
  const request = ordinaryRequest({ user: READER });
  const review = inlineParentReview(HEAD, {
    submitted_at: "2026-08-25T08:02:00Z",
  });
  const github = createGitHubMock({
    baseEpoch: baseRefChangedEvent({ createdAt: "2026-08-25T07:59:00Z" }),
    issueComments: [request],
    reviews: [review],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "default-any-inline-parent-terminal-receipt-base-epoch",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "request_clean_generation");
  assert.equal(result.report.requiresReplacementPr, true);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("a terminal finding still blocks a default-any request", async (context) => {
  const request = ordinaryRequest({ user: READER });
  const finding = findingIssueComment(HEAD, {
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const github = createGitHubMock({ issueComments: [request, finding] });
  const environment = runtimeEnvironment(context, {
    suffix: "default-any-terminal-finding",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.gateOutcome, "failure");
  assert.equal(result.report.recoveryCode, "fix_findings");
  assert.equal(result.report.counts.unresolved, 1);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("a terminal clean receipt preempts an established generation only fail-closed", async (context) => {
  const generation = workflowRequest({
    created_at: "2026-08-25T08:00:00Z",
    updated_at: "2026-08-25T08:00:00Z",
  });
  const unacknowledged = ordinaryRequest({
    id: 102,
    user: READER,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const clean = cleanIssueComment(HEAD, {
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const github = createGitHubMock({
    issueComments: [generation, unacknowledged, clean],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "unacknowledged-default-any-cannot-preempt",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "request_clean_generation");
  assert.match(result.report.reason, /request 101.*request 102/u);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
  assert.equal(
    github.calls.some((call) => /\/collaborators\/[^/]+\/permission$/u.test(call.path)),
    false,
  );
});

test("an official receipt promotes a default-any candidate into a new generation", async (context) => {
  const generation = workflowRequest({
    created_at: "2026-08-25T08:00:00Z",
    updated_at: "2026-08-25T08:00:00Z",
  });
  const clean = cleanIssueComment(HEAD, {
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
  });
  const candidate = ordinaryRequest({
    id: 102,
    user: READER,
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const acknowledgedGitHub = createGitHubMock({
    issueComments: [generation, clean, candidate],
    reactionsByCommentId: new Map([[String(candidate.id), [reaction({
      content: "eyes",
      created_at: "2026-08-25T08:03:00Z",
    })]]]),
  });
  const acknowledgedEnvironment = runtimeEnvironment(context, {
    suffix: "default-any-official-receipt-preempts",
  });
  const { result: acknowledged } = await runGate(
    acknowledgedEnvironment,
    acknowledgedGitHub,
  );
  assert.equal(acknowledged.exitCode, 1);
  assert.equal(acknowledged.report.gateOutcome, "pending");
  assert.equal(acknowledged.report.recoveryCode, "wait_provider");

  const laterClean = cleanIssueComment(HEAD, {
    id: 202,
    created_at: "2026-08-25T08:04:00Z",
    updated_at: "2026-08-25T08:04:00Z",
  });
  const settledGitHub = createGitHubMock({
    issueComments: [generation, clean, candidate, laterClean],
    reactionsByCommentId: new Map([[String(candidate.id), [reaction({
      content: "eyes",
      created_at: "2026-08-25T08:03:00Z",
    })]]]),
  });
  const settledEnvironment = runtimeEnvironment(context, {
    suffix: "default-any-official-receipt-settled",
  });
  const { result: settled } = await runGate(settledEnvironment, settledGitHub);
  assert.equal(settled.exitCode, 1);
  assert.equal(settled.report.gateOutcome, "pending");
  assert.equal(settled.report.recoveryCode, "request_clean_generation");
  assert.match(settled.report.reason, /cannot be uniquely attributed/u);
});

test("request-author write policy is opt-in and the default any policy skips collaborator lookup", async (context) => {
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
  environment.CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION = "write";
  const { result } = await runGate(environment, github);
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(
    hasRequestReactionGraphQlCall(github, request.id),
    false,
  );

  const forbiddenGitHub = createGitHubMock({
    issueComments: [request, terminal],
    requestInterceptor: ({ method, path }) =>
      method === "GET" &&
      path === `/repos/${REPOSITORY}/collaborators/${READER.login}/permission`
        ? jsonResponse({ message: "Must have push access to view collaborator permission" }, 403)
        : undefined,
  });
  const forbiddenEnvironment = runtimeEnvironment(context, { suffix: "permission-403" });
  forbiddenEnvironment.CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION = "write";
  const { result: forbiddenResult } = await runGate(forbiddenEnvironment, forbiddenGitHub);
  assert.equal(forbiddenResult.exitCode, 1);
  assert.equal(forbiddenResult.report.executionHealth, "unhealthy");
  assert.equal(forbiddenResult.report.gateOutcome, "pending");
  assert.equal(forbiddenResult.report.recoveryCode, "repair_permissions");
  assert.equal(forbiddenGitHub.statusWrites.some(({ state }) => state === "success"), false);

  const defaultGitHub = createGitHubMock({
    issueComments: [request, terminal],
    reactionsByCommentId: new Map([[String(request.id), [reaction({
      content: "eyes",
      created_at: "2026-08-25T08:01:00Z",
    })]]]),
  });
  const defaultEnvironment = runtimeEnvironment(context, { suffix: "permission-default-any" });
  const { result: defaultResult } = await runGate(defaultEnvironment, defaultGitHub);
  assert.equal(defaultResult.report.gateOutcome, "success");
  assert.equal(
    defaultGitHub.calls.some((call) => /\/collaborators\/[^/]+\/permission$/u.test(call.path)),
    false,
  );
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
  ambiguousEnvironment.CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION = "write";
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
      path === `/repos/${REPOSITORY}/issues/comments/${deniedU.id}`
    ) || hasRequestReactionGraphQlCall(ambiguousGitHub, deniedU.id),
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
  lateFindingEnvironment.CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION = "write";
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
  directRecoveryEnvironment.CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION = "write";
  const { result: directRecovery } = await runGate(
    directRecoveryEnvironment,
    directRecoveryGitHub,
  );
  assert.equal(directRecovery.exitCode, 1);
  assert.equal(directRecovery.report.gateOutcome, "pending");
  assert.equal(directRecovery.report.recoveryCode, "request_clean_generation");
  assert.match(directRecovery.report.reason, /earlier request 101.*newer request 102/iu);

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
  staleDirectEnvironment.CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION = "write";
  const { result: staleDirect } = await runGate(staleDirectEnvironment, staleDirectGitHub);
  assert.equal(staleDirect.exitCode, 1);
  assert.equal(staleDirect.report.gateOutcome, "pending");
  assert.equal(staleDirect.report.recoveryCode, "request_clean_generation");
  assert.match(staleDirect.report.reason, /newer request 102 already existed/iu);

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
  refreshedDirectEnvironment.CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION = "write";
  const { result: refreshedDirect } = await runGate(
    refreshedDirectEnvironment,
    refreshedDirectGitHub,
  );
  assert.equal(refreshedDirect.exitCode, 1);
  assert.equal(refreshedDirect.report.gateOutcome, "pending");
  assert.equal(refreshedDirect.report.recoveryCode, "request_clean_generation");
  assert.match(refreshedDirect.report.reason, /newer request 102 already existed/iu);
});

test("provider-triggerable invalid request shapes remain physical-only boundaries", async (context) => {
  const generationA = workflowRequest({ id: 101 });
  const terminalA = cleanIssueComment(HEAD, {
    id: 201,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
  });
  const generationC = workflowRequest({
    id: 103,
    body: canonicalRequestBody(HEAD, { runId: "125" }),
    created_at: "2026-08-25T08:03:00Z",
    updated_at: "2026-08-25T08:03:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-103`,
  });
  const invalidRequests = [
    ["canonical-wrong-author", workflowRequest({
      id: 102,
      user: HUMAN,
      created_at: "2026-08-25T08:02:00Z",
      updated_at: "2026-08-25T08:02:00Z",
    })],
    ["canonical-edited", workflowRequest({
      id: 102,
      created_at: "2026-08-25T08:01:30Z",
      updated_at: "2026-08-25T08:02:00Z",
    })],
    ["canonical-malformed-envelope", workflowRequest({
      id: 102,
      body: canonicalRequestBody().replace('"version":2', '"version":3'),
      created_at: "2026-08-25T08:02:00Z",
      updated_at: "2026-08-25T08:02:00Z",
    })],
    ["canonical-wrong-hidden-marker", workflowRequest({
      id: 102,
      body: canonicalRequestBody().replace(
        "codex-review-gate-request-v2",
        "codex-review-gate-request-v1",
      ),
      created_at: "2026-08-25T08:02:00Z",
      updated_at: "2026-08-25T08:02:00Z",
    })],
    ["canonical-extra-hidden-comment", workflowRequest({
      id: 102,
      body: `${canonicalRequestBody()}\n<!-- unrelated hidden metadata -->`,
      created_at: "2026-08-25T08:02:00Z",
      updated_at: "2026-08-25T08:02:00Z",
    })],
    ["canonical-crlf-envelope", workflowRequest({
      id: 102,
      body: canonicalRequestBody().replaceAll("\n", "\r\n"),
      created_at: "2026-08-25T08:02:00Z",
      updated_at: "2026-08-25T08:02:00Z",
    })],
    ["canonical-unclosed-hidden-comment", workflowRequest({
      id: 102,
      body: canonicalRequestBody().replace("-->", ""),
      created_at: "2026-08-25T08:02:00Z",
      updated_at: "2026-08-25T08:02:00Z",
    })],
    ["canonical-invalid-repository", workflowRequest({
      id: 102,
      body: canonicalRequestBody(HEAD, { repositoryId: "999", runId: "124" }),
      created_at: "2026-08-25T08:02:00Z",
      updated_at: "2026-08-25T08:02:00Z",
    })],
    ["bare-edited", ordinaryRequest({
      id: 102,
      created_at: "2026-08-25T08:01:30Z",
      updated_at: "2026-08-25T08:02:00Z",
    })],
    ["bare-leading-space", ordinaryRequest({
      id: 102,
      body: " @codex review",
      created_at: "2026-08-25T08:02:00Z",
      updated_at: "2026-08-25T08:02:00Z",
    })],
    ["bare-trailing-tab", ordinaryRequest({
      id: 102,
      body: "@codex review\t",
      created_at: "2026-08-25T08:02:00Z",
      updated_at: "2026-08-25T08:02:00Z",
    })],
    ["bare-terminal-cr", ordinaryRequest({
      id: 102,
      body: "@codex review\r",
      created_at: "2026-08-25T08:02:00Z",
      updated_at: "2026-08-25T08:02:00Z",
    })],
    ["bare-two-terminal-lf", ordinaryRequest({
      id: 102,
      body: "@codex review\n\n",
      created_at: "2026-08-25T08:02:00Z",
      updated_at: "2026-08-25T08:02:00Z",
    })],
    ["bare-two-terminal-crlf", ordinaryRequest({
      id: 102,
      body: "@codex review\r\n\r\n",
      created_at: "2026-08-25T08:02:00Z",
      updated_at: "2026-08-25T08:02:00Z",
    })],
    ["bare-hidden-comment", ordinaryRequest({
      id: 102,
      body: "@codex review<!-- unrelated hidden metadata -->",
      created_at: "2026-08-25T08:02:00Z",
      updated_at: "2026-08-25T08:02:00Z",
    })],
    ["bare-extra-visible-content", ordinaryRequest({
      id: 102,
      body: "@codex review\nPlease review the implementation.",
      created_at: "2026-08-25T08:02:00Z",
      updated_at: "2026-08-25T08:02:00Z",
    })],
    ["bare-bot", ordinaryRequest({
      id: 102,
      user: ACTIONS_BOT,
      created_at: "2026-08-25T08:02:00Z",
      updated_at: "2026-08-25T08:02:00Z",
    })],
    ["focused-review-command", ordinaryRequest({
      id: 102,
      body: "@codex review for issues in security-sensitive code",
      created_at: "2026-08-25T08:02:00Z",
      updated_at: "2026-08-25T08:02:00Z",
    })],
  ];

  for (const [suffix, invalidRequest] of invalidRequests) {
    const github = createGitHubMock({
      issueComments: [generationA, terminalA, invalidRequest, generationC],
      reactionsByCommentId: new Map([["103", [reaction({
        id: 550,
        created_at: "2026-08-25T08:04:00Z",
      })]]]),
    });
    const environment = runtimeEnvironment(context, { suffix });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "request_clean_generation", suffix);
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, suffix);
    assert.equal(
      github.calls.some(({ path }) =>
        path === `/repos/${REPOSITORY}/issues/comments/102`
      ) || hasRequestReactionGraphQlCall(github, 102),
      false,
      `${suffix}: physical-only boundaries must not consume exact-refetch or reaction budget`,
    );
  }

  for (const [suffix, invalidRequest] of invalidRequests.filter(([name]) =>
    name === "canonical-wrong-author" || name === "focused-review-command"
  )) {
    const github = createGitHubMock({
      issueComments: [generationA, terminalA, invalidRequest],
    });
    const environment = runtimeEnvironment(context, {
      suffix: `${suffix}-after-clean`,
    });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "request_clean_generation", suffix);
    assert.match(result.report.reason, /predates newer physical review request 102/iu, suffix);
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, suffix);
  }

  const mention = genericComment(102);
  mention.body = "Please ask @codex review when the branch is ready.";
  mention.created_at = "2026-08-25T08:02:00Z";
  mention.updated_at = "2026-08-25T08:02:00Z";
  const nonExactGitHub = createGitHubMock({
    issueComments: [generationA, terminalA, mention],
  });
  const nonExactEnvironment = runtimeEnvironment(context, {
    suffix: "non-exact-review-mention-is-not-a-boundary",
  });
  const { result: nonExact } = await runGate(nonExactEnvironment, nonExactGitHub);
  assert.equal(nonExact.exitCode, 0);
  assert.equal(nonExact.report.gateOutcome, "success");

  const visibleTrailer = workflowRequest({
    id: 102,
    body: `${canonicalRequestBody()}\nVisible trailer`,
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const visibleTrailerGitHub = createGitHubMock({
    issueComments: [generationA, terminalA, visibleTrailer],
  });
  const visibleTrailerEnvironment = runtimeEnvironment(context, {
    suffix: "visible-envelope-trailer-is-a-physical-boundary",
  });
  const { result: visibleTrailerResult } = await runGate(
    visibleTrailerEnvironment,
    visibleTrailerGitHub,
  );
  assert.equal(visibleTrailerResult.exitCode, 1);
  assert.equal(visibleTrailerResult.report.gateOutcome, "pending");
  assert.equal(visibleTrailerResult.report.recoveryCode, "request_clean_generation");
  assert.equal(
    visibleTrailerGitHub.calls.some(({ path }) =>
      path === `/repos/${REPOSITORY}/issues/comments/102`
    ) || hasRequestReactionGraphQlCall(visibleTrailerGitHub, 102),
    false,
  );
});

test("exact Codex provider carriers never become request generations", async (context) => {
  const generationA = workflowRequest();
  const generationB = workflowRequest({
    id: 102,
    body: canonicalRequestBody(HEAD, { runId: "124" }),
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const providerComment = ordinaryRequest({
    id: 201,
    user: CODEX_BOT,
    performed_via_github_app: CODEX_APP,
    created_at: "2026-08-25T08:00:30Z",
    updated_at: "2026-08-25T08:00:30Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-201`,
  });
  const providerReview = findingReview(HEAD, {
    id: 401,
    body: "@codex review",
    submitted_at: "2026-08-25T08:00:30Z",
  });
  for (const [suffix, extraComments, reviews] of [
    ["issue-comment", [providerComment], []],
    ["pull-request-review", [], [providerReview]],
  ]) {
    const github = createGitHubMock({
      issueComments: [generationA, ...extraComments, generationB],
      reviews,
      reactionsByCommentId: new Map([
        ["101", [reaction({ id: 680, created_at: "2026-08-25T08:01:00Z" })]],
        ["102", [reaction({ id: 681, created_at: "2026-08-25T08:03:00Z" })]],
      ]),
    });
    const environment = runtimeEnvironment(context, {
      suffix: `exact-provider-not-request-${suffix}`,
    });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 0, suffix);
    assert.equal(result.report.gateOutcome, "success", suffix);
    assert.equal(result.report.counts.indeterminate, 1, suffix);
    assert.equal(result.report.requiresReplacementPr, false, suffix);
    assert.match(result.report.reason, /request-reaction 681/u, suffix);
    if (suffix === "issue-comment") {
      assert.equal(
        github.calls.some(({ path }) =>
          path === `/repos/${REPOSITORY}/issues/comments/201`
        ),
        true,
      );
      assert.equal(
        hasRequestReactionGraphQlCall(github, 201),
        false,
      );
    } else {
      assert.equal(
        github.calls.some(({ path }) =>
          path === `/repos/${REPOSITORY}/pulls/${PR}/reviews/401`
        ),
        true,
      );
    }
  }
});

test("edited-away trusted request comments remain unknown physical boundaries", async (context) => {
  const generationA = workflowRequest({ id: 101 });
  const terminalA = cleanIssueComment(HEAD, {
    id: 201,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
  });
  for (const [suffix, user, body] of [
    ["human", HUMAN, "The review request was edited away."],
    ["github-actions", ACTIONS_BOT, "The review request was edited away."],
    [
      "github-actions-forged-sticky",
      ACTIONS_BOT,
      `Old diagnostic\n\n<!-- ${V2_STICKY_MARKER} -->\n<!-- {} -->`,
    ],
    [
      "other-app-bot",
      { id: 77, login: "review-request-app[bot]", type: "Bot" },
      "The app review request was edited away.",
    ],
  ]) {
    const editedAway = genericComment(102);
    Object.assign(editedAway, {
      body,
      created_at: "2026-08-25T08:00:30Z",
      updated_at: "2026-08-25T08:02:00Z",
      user,
    });
    const github = createGitHubMock({
      issueComments: [generationA, terminalA, editedAway],
    });
    const environment = runtimeEnvironment(context, {
      suffix: `edited-away-request-${suffix}`,
    });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "request_clean_generation", suffix);
    assert.match(result.report.reason, /predates newer physical review request 102/iu, suffix);
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, suffix);
    assert.equal(
      github.calls.some(({ path }) =>
        path === `/repos/${REPOSITORY}/issues/comments/102`
      ) || hasRequestReactionGraphQlCall(github, 102),
      false,
      `${suffix}: unknown history stays physical-only without extra API fan-out`,
    );
  }
});

test("canonical Actions sticky diagnostics stay outside physical lineage after a timestamp update", async (context) => {
  const generationA = workflowRequest({ id: 101 });
  const terminalA = cleanIssueComment(HEAD, {
    id: 201,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
  });
  const canonicalBody = canonicalStickyComment({ id: 102 }).body;
  const nonStringHeadBody = canonicalBody.replace(
    `"headSha":"${BASE}"`,
    `"headSha":["${BASE}"]`,
  );
  const cases = [
    {
      suffix: "forged-marker",
      comment: stickyComment({
        id: 102,
        created_at: "2026-08-25T08:02:00Z",
        updated_at: "2026-08-25T08:02:00Z",
      }),
    },
    {
      suffix: "edited-canonical",
      comment: canonicalStickyComment({
        id: 102,
        created_at: "2026-08-25T08:00:30Z",
        updated_at: "2026-08-25T08:02:00Z",
      }),
      expectedOutcome: "success",
    },
    {
      suffix: "wrong-actions-provenance",
      comment: genericComment(102),
    },
    {
      suffix: "canonical-crlf",
      comment: canonicalStickyComment({
        id: 102,
        body: canonicalBody.replaceAll("\n", "\r\n"),
        created_at: "2026-08-25T08:02:00Z",
        updated_at: "2026-08-25T08:02:00Z",
      }),
    },
    {
      suffix: "canonical-bare-cr",
      comment: canonicalStickyComment({
        id: 102,
        body: canonicalBody.replaceAll("\n", "\r"),
        created_at: "2026-08-25T08:02:00Z",
        updated_at: "2026-08-25T08:02:00Z",
      }),
    },
    {
      suffix: "canonical-non-string-head",
      comment: canonicalStickyComment({
        id: 102,
        body: nonStringHeadBody,
        created_at: "2026-08-25T08:02:00Z",
        updated_at: "2026-08-25T08:02:00Z",
      }),
    },
  ];
  Object.assign(cases[2].comment, {
    body: canonicalBody,
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
    user: HUMAN,
  });

  for (const { suffix, comment, expectedOutcome = "pending" } of cases) {
    const github = createGitHubMock({
      issueComments: [generationA, terminalA, comment],
    });
    const environment = runtimeEnvironment(context, {
      suffix: `sticky-physical-boundary-${suffix}`,
    });
    const { result } = await runGate(environment, github);
    if (expectedOutcome === "success") {
      assert.equal(result.exitCode, 0, suffix);
      assert.equal(result.report.executionHealth, "healthy", suffix);
      assert.equal(result.report.gateOutcome, "success", suffix);
      continue;
    }
    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "request_clean_generation", suffix);
    assert.equal(result.report.requiresReplacementPr, true, suffix);
    assert.match(
      result.report.reason,
      /physical review request 102|immutable canonical Actions provenance/iu,
      suffix,
    );
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, suffix);
  }
});

test("opt-in write policy caches permissions and avoids exact-refetch DoS", async (context) => {
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
  deniedEnvironment.CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION = "write";
  const { result: deniedResult } = await runGate(deniedEnvironment, deniedGitHub);
  assert.equal(deniedResult.exitCode, 1);
  assert.equal(deniedResult.report.executionHealth, "healthy");
  assert.equal(deniedResult.report.gateOutcome, "pending");
  assert.equal(deniedResult.report.recoveryCode, "wait_provider");
  assert.equal(deniedResult.report.requiresReplacementPr, true);
  const deniedSummary = readFileSync(deniedEnvironment.GITHUB_STEP_SUMMARY, "utf8");
  assert.match(deniedSummary, /Do not add another review boundary on the original PR/iu);
  assert.match(deniedSummary, /Open a replacement PR/iu);
  assert.match(deniedSummary, /exactly one canonical review generation/iu);
  assert.doesNotMatch(deniedSummary, /Wait for Codex to publish a terminal result/iu);
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
      hasRequestReactionGraphQlCall(deniedGitHub, denied.id),
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
  authoritativeEnvironment.CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION = "write";
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
    /earlier request 101 had no qualifying settled closure before newer request 102/iu,
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
  assert.equal(directlyBound.exitCode, 1);
  assert.equal(directlyBound.report.gateOutcome, "pending");
  assert.equal(directlyBound.report.recoveryCode, "request_clean_generation");
  assert.match(directlyBound.report.reason, /earlier request 101.*newer request 102/iu);

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
  assert.equal(earlierDirectBinding.exitCode, 1);
  assert.equal(earlierDirectBinding.report.gateOutcome, "pending");
  assert.equal(earlierDirectBinding.report.recoveryCode, "request_clean_generation");
  assert.match(earlierDirectBinding.report.reason, /earlier request 101.*newer request 102/iu);

  const progressAfterPredecessorCleanGitHub = createGitHubMock({
    issueComments: [
      generationA,
      progressIssueComment({
        id: 204,
        created_at: "2026-08-25T08:01:30Z",
        updated_at: "2026-08-25T08:01:30Z",
      }),
      generationB,
      delayedCleanFromA,
    ],
    reactionsByCommentId: new Map([
      ["101", [reaction({ id: 510, created_at: "2026-08-25T08:01:00Z" })]],
      ["102", [reaction({ id: 511, created_at: "2026-08-25T08:05:00Z" })]],
    ]),
  });
  const progressAfterPredecessorCleanEnvironment = runtimeEnvironment(context, {
    suffix: "prior-generation-direct-plus-one-followed-by-progress",
  });
  const { result: progressAfterPredecessorClean } = await runGate(
    progressAfterPredecessorCleanEnvironment,
    progressAfterPredecessorCleanGitHub,
  );
  assert.equal(progressAfterPredecessorClean.exitCode, 1);
  assert.equal(progressAfterPredecessorClean.report.gateOutcome, "pending");
  assert.equal(
    progressAfterPredecessorClean.report.recoveryCode,
    "request_clean_generation",
  );
  assert.match(
    progressAfterPredecessorClean.report.reason,
    /earlier request 101.*newer request 102/iu,
  );

  const eyesAtSuccessorBoundaryGitHub = createGitHubMock({
    issueComments: [generationA, generationB, delayedCleanFromA],
    reactionsByCommentId: new Map([
      ["101", [
        reaction({ id: 520, created_at: "2026-08-25T08:01:00Z" }),
        reaction({
          id: 521,
          content: "eyes",
          created_at: generationB.created_at,
        }),
      ]],
    ]),
  });
  const eyesAtSuccessorBoundaryEnvironment = runtimeEnvironment(context, {
    suffix: "prior-plus-one-eyes-at-successor-boundary",
  });
  const { result: eyesAtSuccessorBoundary } = await runGate(
    eyesAtSuccessorBoundaryEnvironment,
    eyesAtSuccessorBoundaryGitHub,
  );
  assert.equal(eyesAtSuccessorBoundary.exitCode, 1);
  assert.equal(eyesAtSuccessorBoundary.report.gateOutcome, "pending");
  assert.equal(
    eyesAtSuccessorBoundary.report.recoveryCode,
    "request_clean_generation",
  );

  const progressAtSuccessorBoundaryGitHub = createGitHubMock({
    issueComments: [
      generationA,
      progressIssueComment({
        id: 205,
        created_at: generationB.created_at,
        updated_at: generationB.updated_at,
      }),
      generationB,
      delayedCleanFromA,
    ],
    reactionsByCommentId: new Map([
      ["101", [reaction({ id: 522, created_at: "2026-08-25T08:01:00Z" })]],
    ]),
  });
  const progressAtSuccessorBoundaryEnvironment = runtimeEnvironment(context, {
    suffix: "prior-plus-one-progress-at-successor-boundary",
  });
  const { result: progressAtSuccessorBoundary } = await runGate(
    progressAtSuccessorBoundaryEnvironment,
    progressAtSuccessorBoundaryGitHub,
  );
  assert.equal(progressAtSuccessorBoundary.exitCode, 1);
  assert.equal(progressAtSuccessorBoundary.report.gateOutcome, "pending");
  assert.equal(
    progressAtSuccessorBoundary.report.recoveryCode,
    "request_clean_generation",
  );

  const oldHeadBoundary = workflowRequest({
    id: 102,
    body: canonicalRequestBody(OLD_HEAD, { runId: "124" }),
    created_at: "2026-08-25T08:01:15Z",
    updated_at: "2026-08-25T08:01:15Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const currentGenerationB = workflowRequest({
    id: 103,
    body: canonicalRequestBody(HEAD, { runId: "125" }),
    created_at: generationB.created_at,
    updated_at: generationB.updated_at,
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-103`,
  });
  const oldHeadProgressGitHub = createGitHubMock({
    issueComments: [
      generationA,
      oldHeadBoundary,
      progressIssueComment({
        id: 206,
        created_at: "2026-08-25T08:01:30Z",
        updated_at: "2026-08-25T08:01:45Z",
      }),
      currentGenerationB,
      delayedCleanFromA,
    ],
    reactionsByCommentId: new Map([
      ["101", [reaction({ id: 523, created_at: "2026-08-25T08:01:00Z" })]],
      ["103", [reaction({ id: 528, created_at: "2026-08-25T08:05:00Z" })]],
    ]),
  });
  const oldHeadProgressEnvironment = runtimeEnvironment(context, {
    suffix: "unbound-progress-near-old-head-stays-current",
  });
  const { result: oldHeadProgress } = await runGate(
    oldHeadProgressEnvironment,
    oldHeadProgressGitHub,
  );
  assert.equal(oldHeadProgress.exitCode, 1);
  assert.equal(oldHeadProgress.report.gateOutcome, "pending");
  assert.equal(oldHeadProgress.report.recoveryCode, "request_clean_generation");
  assert.match(oldHeadProgress.report.reason, /earlier request 101.*newer request 103/iu);
  assert.equal(
    oldHeadProgressGitHub.statusWrites.some(({ state }) => state === "success"),
    false,
  );

  const progressAtCurrentSuccessorGitHub = createGitHubMock({
    issueComments: [
      generationA,
      oldHeadBoundary,
      progressIssueComment({
        id: 208,
        created_at: currentGenerationB.created_at,
        updated_at: currentGenerationB.updated_at,
      }),
      currentGenerationB,
      delayedCleanFromA,
    ],
    reactionsByCommentId: new Map([
      ["101", [reaction({ id: 526, created_at: "2026-08-25T08:01:00Z" })]],
      ["103", [reaction({ id: 529, created_at: "2026-08-25T08:05:00Z" })]],
    ]),
  });
  const progressAtCurrentSuccessorEnvironment = runtimeEnvironment(context, {
    suffix: "old-head-progress-at-current-successor-boundary",
  });
  const { result: progressAtCurrentSuccessor } = await runGate(
    progressAtCurrentSuccessorEnvironment,
    progressAtCurrentSuccessorGitHub,
  );
  assert.equal(progressAtCurrentSuccessor.exitCode, 1);
  assert.equal(progressAtCurrentSuccessor.report.gateOutcome, "pending");
  assert.equal(
    progressAtCurrentSuccessor.report.recoveryCode,
    "request_clean_generation",
  );
  assert.equal(progressAtCurrentSuccessor.report.counts.indeterminate, 1);
  assert.match(
    progressAtCurrentSuccessor.report.reason,
    /earlier request 101.*newer request 103/iu,
  );
  assert.equal(
    progressAtCurrentSuccessorGitHub.statusWrites.some(({ state }) => state === "success"),
    false,
  );

  const progressAtOldHeadBoundaryGitHub = createGitHubMock({
    issueComments: [
      generationA,
      progressIssueComment({
        id: 209,
        created_at: oldHeadBoundary.created_at,
        updated_at: oldHeadBoundary.updated_at,
      }),
      oldHeadBoundary,
      currentGenerationB,
      delayedCleanFromA,
    ],
    reactionsByCommentId: new Map([
      ["101", [reaction({ id: 527, created_at: "2026-08-25T08:01:00Z" })]],
      ["103", [reaction({ id: 530, created_at: "2026-08-25T08:05:00Z" })]],
    ]),
  });
  const progressAtOldHeadBoundaryEnvironment = runtimeEnvironment(context, {
    suffix: "progress-at-old-head-boundary",
  });
  const { result: progressAtOldHeadBoundary } = await runGate(
    progressAtOldHeadBoundaryEnvironment,
    progressAtOldHeadBoundaryGitHub,
  );
  assert.equal(progressAtOldHeadBoundary.exitCode, 1);
  assert.equal(progressAtOldHeadBoundary.report.gateOutcome, "pending");
  assert.equal(
    progressAtOldHeadBoundary.report.recoveryCode,
    "request_clean_generation",
  );
  assert.equal(
    progressAtOldHeadBoundaryGitHub.statusWrites.some(({ state }) => state === "success"),
    false,
  );

  const currentHeadMiddleBoundary = workflowRequest({
    id: 102,
    body: canonicalRequestBody(HEAD, { runId: "124" }),
    created_at: "2026-08-25T08:01:15Z",
    updated_at: "2026-08-25T08:01:15Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const currentHeadProgressGitHub = createGitHubMock({
    issueComments: [
      generationA,
      currentHeadMiddleBoundary,
      progressIssueComment({
        id: 207,
        created_at: "2026-08-25T08:01:30Z",
        updated_at: "2026-08-25T08:01:30Z",
      }),
      currentGenerationB,
      delayedCleanFromA,
    ],
    reactionsByCommentId: new Map([
      ["101", [reaction({ id: 524, created_at: "2026-08-25T08:01:00Z" })]],
      ["102", [reaction({ id: 525, created_at: "2026-08-25T08:01:20Z" })]],
      ["103", [reaction({ id: 531, created_at: "2026-08-25T08:05:00Z" })]],
    ]),
  });
  const currentHeadProgressEnvironment = runtimeEnvironment(context, {
    suffix: "current-head-progress-vetoes-current-lineage",
  });
  const { result: currentHeadProgress } = await runGate(
    currentHeadProgressEnvironment,
    currentHeadProgressGitHub,
  );
  assert.equal(currentHeadProgress.exitCode, 1);
  assert.equal(currentHeadProgress.report.gateOutcome, "pending");
  assert.equal(
    currentHeadProgress.report.recoveryCode,
    "request_clean_generation",
  );
  assert.match(
    currentHeadProgress.report.reason,
    /earlier request 102.*newer request 103/iu,
  );

  const oldHeadAfterCurrentBoundary = workflowRequest({
    id: 104,
    body: canonicalRequestBody(OLD_HEAD, { runId: "126" }),
    created_at: "2026-08-25T08:03:00Z",
    updated_at: "2026-08-25T08:03:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-104`,
  });
  const editedProgressAcrossHeadBoundariesGitHub = createGitHubMock({
    issueComments: [
      generationA,
      currentGenerationB,
      progressIssueComment({
        id: 210,
        created_at: currentGenerationB.created_at,
        updated_at: "2026-08-25T08:03:30Z",
      }),
      oldHeadAfterCurrentBoundary,
      delayedCleanFromA,
    ],
    reactionsByCommentId: new Map([
      ["101", [reaction({ id: 535, created_at: "2026-08-25T08:01:00Z" })]],
      ["103", [reaction({ id: 536, created_at: "2026-08-25T08:05:00Z" })]],
    ]),
  });
  const editedProgressAcrossHeadBoundariesEnvironment = runtimeEnvironment(context, {
    suffix: "edited-progress-crosses-current-and-old-head-boundaries",
  });
  const { result: editedProgressAcrossHeadBoundaries } = await runGate(
    editedProgressAcrossHeadBoundariesEnvironment,
    editedProgressAcrossHeadBoundariesGitHub,
  );
  assert.equal(editedProgressAcrossHeadBoundaries.exitCode, 1);
  assert.equal(editedProgressAcrossHeadBoundaries.report.gateOutcome, "pending");
  assert.equal(
    editedProgressAcrossHeadBoundaries.report.recoveryCode,
    "request_clean_generation",
  );
  assert.match(
    editedProgressAcrossHeadBoundaries.report.reason,
    /earlier request 101.*newer request 103/iu,
  );
  assert.equal(
    editedProgressAcrossHeadBoundariesGitHub.statusWrites.some(
      ({ state }) => state === "success",
    ),
    false,
  );

  const intervalCurrentBoundary = workflowRequest({
    id: 105,
    body: canonicalRequestBody(HEAD, { runId: "127" }),
    created_at: "2026-08-25T08:01:45Z",
    updated_at: "2026-08-25T08:01:45Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-105`,
  });
  const intervalOldBoundary = workflowRequest({
    id: 106,
    body: canonicalRequestBody(OLD_HEAD, { runId: "128" }),
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-106`,
  });
  const intervalCurrentSuccessor = workflowRequest({
    id: 107,
    body: canonicalRequestBody(HEAD, { runId: "129" }),
    created_at: "2026-08-25T08:03:00Z",
    updated_at: "2026-08-25T08:03:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-107`,
  });
  const editedProgressOldCurrentOldGitHub = createGitHubMock({
    issueComments: [
      generationA,
      oldHeadBoundary,
      progressIssueComment({
        id: 211,
        created_at: "2026-08-25T08:01:30Z",
        updated_at: "2026-08-25T08:02:30Z",
      }),
      intervalCurrentBoundary,
      intervalOldBoundary,
      intervalCurrentSuccessor,
    ],
    reactionsByCommentId: new Map([
      ["101", [reaction({ id: 537, created_at: "2026-08-25T08:01:00Z" })]],
      ["105", [reaction({ id: 538, created_at: "2026-08-25T08:02:45Z" })]],
      ["107", [reaction({ id: 539, created_at: "2026-08-25T08:04:00Z" })]],
    ]),
  });
  const editedProgressOldCurrentOldEnvironment = runtimeEnvironment(context, {
    suffix: "edited-progress-crosses-old-current-old-window",
  });
  const { result: editedProgressOldCurrentOld } = await runGate(
    editedProgressOldCurrentOldEnvironment,
    editedProgressOldCurrentOldGitHub,
  );
  assert.equal(editedProgressOldCurrentOld.exitCode, 1);
  assert.equal(editedProgressOldCurrentOld.report.gateOutcome, "pending");
  assert.equal(
    editedProgressOldCurrentOld.report.recoveryCode,
    "request_clean_generation",
  );
  assert.match(
    editedProgressOldCurrentOld.report.reason,
    /earlier request 101.*newer request 105/iu,
  );
  assert.equal(
    editedProgressOldCurrentOldGitHub.statusWrites.some(
      ({ state }) => state === "success",
    ),
    false,
  );

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
  assert.equal(predecessorClosed.exitCode, 1);
  assert.equal(predecessorClosed.report.gateOutcome, "pending");
  assert.equal(
    predecessorClosed.report.recoveryCode,
    "request_clean_generation",
  );
  assert.match(predecessorClosed.report.reason, /cannot be uniquely attributed.*request 102/iu);
  assert.equal(
    predecessorClosedGitHub.statusWrites.some(({ state }) => state === "success"),
    false,
  );

  const predecessorAndLatestDirectGitHub = createGitHubMock({
    issueComments: [generationA, generationB, delayedCleanFromA],
    reactionsByCommentId: new Map([
      ["101", [reaction({ id: 532, created_at: "2026-08-25T08:01:00Z" })]],
      ["102", [reaction({ id: 533, created_at: "2026-08-25T08:05:00Z" })]],
    ]),
  });
  const predecessorAndLatestDirectEnvironment = runtimeEnvironment(context, {
    suffix: "all-overlapping-generations-directly-closed",
  });
  const { result: predecessorAndLatestDirect } = await runGate(
    predecessorAndLatestDirectEnvironment,
    predecessorAndLatestDirectGitHub,
  );
  assert.equal(predecessorAndLatestDirect.exitCode, 0);
  assert.equal(predecessorAndLatestDirect.report.gateOutcome, "success");
  assert.match(predecessorAndLatestDirect.report.reason, /request-reaction 533/u);

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
  assert.equal(providerClosed.exitCode, 1);
  assert.equal(providerClosed.report.gateOutcome, "pending");
  assert.equal(providerClosed.report.recoveryCode, "request_clean_generation");
  assert.match(providerClosed.report.reason, /cannot be uniquely attributed.*request 102/iu);

  const providerFirstGapDirectLatestGitHub = createGitHubMock({
    issueComments: [
      generationA,
      completedGenerationA,
      generationB,
      delayedCleanFromA,
    ],
    reactionsByCommentId: new Map([["102", [reaction({
      id: 534,
      created_at: "2026-08-25T08:05:00Z",
    })]]]),
  });
  const providerFirstGapDirectLatestEnvironment = runtimeEnvironment(context, {
    suffix: "provider-first-gap-direct-latest",
  });
  const { result: providerFirstGapDirectLatest } = await runGate(
    providerFirstGapDirectLatestEnvironment,
    providerFirstGapDirectLatestGitHub,
  );
  assert.equal(providerFirstGapDirectLatest.exitCode, 0);
  assert.equal(providerFirstGapDirectLatest.report.gateOutcome, "success");
  assert.match(providerFirstGapDirectLatest.report.reason, /request-reaction 534/u);

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

test("unbound terminal carriers cannot cross overlapping generations", async (context) => {
  const generationA = workflowRequest({ id: 101 });
  const terminalA = cleanIssueComment(HEAD, {
    id: 201,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
  });
  const generationB = workflowRequest({
    id: 102,
    body: canonicalRequestBody(HEAD, { runId: "124" }),
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const delayedTerminalA = cleanIssueComment(HEAD, {
    id: 203,
    created_at: "2026-08-25T08:03:00Z",
    updated_at: "2026-08-25T08:03:00Z",
  });

  const ambiguousLatestGitHub = createGitHubMock({
    issueComments: [generationA, terminalA, generationB, delayedTerminalA],
  });
  const ambiguousLatestEnvironment = runtimeEnvironment(context, {
    suffix: "unbound-terminal-cannot-satisfy-second-generation",
  });
  const { result: ambiguousLatest } = await runGate(
    ambiguousLatestEnvironment,
    ambiguousLatestGitHub,
  );
  assert.equal(ambiguousLatest.exitCode, 1);
  assert.equal(ambiguousLatest.report.gateOutcome, "pending");
  assert.equal(ambiguousLatest.report.recoveryCode, "request_clean_generation");
  assert.match(ambiguousLatest.report.reason, /cannot be uniquely attributed.*request 102/iu);
  assert.equal(
    ambiguousLatestGitHub.statusWrites.some(({ state }) => state === "success"),
    false,
  );

  const findingA = findingIssueComment(HEAD, {
    id: 202,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
  });
  const ambiguousSupersessionGitHub = createGitHubMock({
    issueComments: [generationA, findingA, generationB, delayedTerminalA],
  });
  const ambiguousSupersessionEnvironment = runtimeEnvironment(context, {
    suffix: "unbound-terminal-cannot-supersede-finding-for-second-generation",
  });
  const { result: ambiguousSupersession } = await runGate(
    ambiguousSupersessionEnvironment,
    ambiguousSupersessionGitHub,
  );
  assert.equal(ambiguousSupersession.exitCode, 1);
  assert.equal(ambiguousSupersession.report.gateOutcome, "failure");
  assert.equal(ambiguousSupersession.report.recoveryCode, "fix_findings");
  assert.equal(ambiguousSupersession.report.counts.unresolved, 1);
  assert.equal(ambiguousSupersession.report.counts.resolved, 0);
  assert.equal(
    ambiguousSupersessionGitHub.statusWrites.some(({ state }) => state === "success"),
    false,
  );

  const directLatestGitHub = createGitHubMock({
    issueComments: [generationA, terminalA, generationB, delayedTerminalA],
    reactionsByCommentId: new Map([["102", [reaction({
      id: 540,
      created_at: "2026-08-25T08:03:30Z",
    })]]]),
  });
  const directLatestEnvironment = runtimeEnvironment(context, {
    suffix: "first-provider-gap-and-direct-latest-recover",
  });
  const { result: directLatest } = await runGate(
    directLatestEnvironment,
    directLatestGitHub,
  );
  assert.equal(directLatest.exitCode, 0);
  assert.equal(directLatest.report.gateOutcome, "success");
  assert.match(directLatest.report.reason, /request-reaction 540/u);

  const generationC = workflowRequest({
    id: 103,
    body: canonicalRequestBody(HEAD, { runId: "125" }),
    created_at: "2026-08-25T08:04:00Z",
    updated_at: "2026-08-25T08:04:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-103`,
  });
  const threeGenerationGitHub = createGitHubMock({
    issueComments: [
      generationA,
      terminalA,
      generationB,
      delayedTerminalA,
      generationC,
    ],
    reactionsByCommentId: new Map([["103", [reaction({
      id: 541,
      created_at: "2026-08-25T08:05:00Z",
    })]]]),
  });
  const threeGenerationEnvironment = runtimeEnvironment(context, {
    suffix: "delayed-terminal-cannot-close-second-of-three-generations",
  });
  const { result: threeGeneration } = await runGate(
    threeGenerationEnvironment,
    threeGenerationGitHub,
  );
  assert.equal(threeGeneration.exitCode, 1);
  assert.equal(threeGeneration.report.gateOutcome, "pending");
  assert.equal(threeGeneration.report.recoveryCode, "request_clean_generation");
  assert.match(threeGeneration.report.reason, /earlier request 102.*newer request 103/iu);
  assert.equal(
    threeGenerationGitHub.statusWrites.some(({ state }) => state === "success"),
    false,
  );

  const threeGenerationRecoveredGitHub = createGitHubMock({
    issueComments: [
      generationA,
      terminalA,
      generationB,
      delayedTerminalA,
      generationC,
    ],
    reactionsByCommentId: new Map([
      ["102", [reaction({ id: 542, created_at: "2026-08-25T08:03:30Z" })]],
      ["103", [reaction({ id: 543, created_at: "2026-08-25T08:05:00Z" })]],
    ]),
  });
  const threeGenerationRecoveredEnvironment = runtimeEnvironment(context, {
    suffix: "each-later-generation-directly-closed",
  });
  const { result: threeGenerationRecovered } = await runGate(
    threeGenerationRecoveredEnvironment,
    threeGenerationRecoveredGitHub,
  );
  assert.equal(threeGenerationRecovered.exitCode, 0);
  assert.equal(threeGenerationRecovered.report.gateOutcome, "success");
  assert.match(threeGenerationRecovered.report.reason, /request-reaction 543/u);

  const directFirstGapGitHub = createGitHubMock({
    issueComments: [generationA, generationB, delayedTerminalA, generationC],
    reactionsByCommentId: new Map([
      ["101", [reaction({ id: 544, created_at: "2026-08-25T08:01:00Z" })]],
      ["103", [reaction({ id: 545, created_at: "2026-08-25T08:05:00Z" })]],
    ]),
  });
  const directFirstGapEnvironment = runtimeEnvironment(context, {
    suffix: "direct-first-gap-does-not-rearm-unbound-terminal",
  });
  const { result: directFirstGap } = await runGate(
    directFirstGapEnvironment,
    directFirstGapGitHub,
  );
  assert.equal(directFirstGap.exitCode, 1);
  assert.equal(directFirstGap.report.gateOutcome, "pending");
  assert.equal(directFirstGap.report.recoveryCode, "request_clean_generation");
  assert.match(directFirstGap.report.reason, /earlier request 102.*newer request 103/iu);
  assert.equal(
    directFirstGapGitHub.statusWrites.some(({ state }) => state === "success"),
    false,
  );
});

test("provider first-gap closure requires a quiet terminal-to-successor window", async (context) => {
  const generationA = workflowRequest({ id: 101 });
  const terminalEarly = cleanIssueComment(HEAD, {
    id: 201,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
  });
  const generationB = workflowRequest({
    id: 102,
    body: canonicalRequestBody(HEAD, { runId: "124" }),
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const latestReaction = new Map([["102", [reaction({
    id: 570,
    created_at: "2026-08-25T08:03:00Z",
  })]]]);

  const eyesGitHub = createGitHubMock({
    issueComments: [generationA, terminalEarly, generationB],
    reactionsByCommentId: new Map([
      ["101", [reaction({
        id: 571,
        content: "eyes",
        created_at: "2026-08-25T08:01:30Z",
      })]],
      ...latestReaction,
    ]),
  });
  const eyesEnvironment = runtimeEnvironment(context, {
    suffix: "provider-gap-post-terminal-eyes",
  });
  const { result: eyes } = await runGate(eyesEnvironment, eyesGitHub);
  assert.equal(eyes.exitCode, 1);
  assert.equal(eyes.report.gateOutcome, "pending");
  assert.equal(eyes.report.recoveryCode, "request_clean_generation");

  for (const [suffix, progressAt] of [
    ["provider-gap-post-terminal-progress", "2026-08-25T08:01:30Z"],
    ["provider-gap-same-time-progress", "2026-08-25T08:01:00Z"],
  ]) {
    const github = createGitHubMock({
      issueComments: [
        generationA,
        terminalEarly,
        progressIssueComment({
          id: 204,
          created_at: progressAt,
          updated_at: progressAt,
        }),
        generationB,
      ],
      reactionsByCommentId: latestReaction,
    });
    const environment = runtimeEnvironment(context, { suffix });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "request_clean_generation", suffix);
  }

  const terminalLate = cleanIssueComment(HEAD, {
    id: 202,
    created_at: "2026-08-25T08:01:45Z",
    updated_at: "2026-08-25T08:01:45Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-202`,
  });
  const laterTerminalGitHub = createGitHubMock({
    issueComments: [
      generationA,
      terminalEarly,
      progressIssueComment({
        id: 204,
        created_at: "2026-08-25T08:01:30Z",
        updated_at: "2026-08-25T08:01:30Z",
      }),
      terminalLate,
      generationB,
    ],
    reactionsByCommentId: latestReaction,
  });
  const laterTerminalEnvironment = runtimeEnvironment(context, {
    suffix: "provider-gap-later-terminal-recovery",
  });
  const { result: laterTerminal } = await runGate(
    laterTerminalEnvironment,
    laterTerminalGitHub,
  );
  assert.equal(laterTerminal.exitCode, 0);
  assert.equal(laterTerminal.report.gateOutcome, "success");
  assert.match(laterTerminal.report.reason, /request-reaction 570/u);

  const physicalOnlyA = ordinaryRequest({ id: 101, user: ACTIONS_BOT });
  const incompleteInventoryGitHub = createGitHubMock({
    issueComments: [physicalOnlyA, terminalEarly, generationB],
    reactionsByCommentId: latestReaction,
  });
  const incompleteInventoryEnvironment = runtimeEnvironment(context, {
    suffix: "provider-gap-incomplete-predecessor-reactions",
  });
  const { result: incompleteInventory } = await runGate(
    incompleteInventoryEnvironment,
    incompleteInventoryGitHub,
  );
  assert.equal(incompleteInventory.exitCode, 1);
  assert.equal(incompleteInventory.report.gateOutcome, "pending");
  assert.equal(incompleteInventory.report.recoveryCode, "request_clean_generation");
  assert.equal(
    hasRequestReactionGraphQlCall(incompleteInventoryGitHub, 101),
    false,
  );
});

test("a later provider clean can supersede an earlier direct candidate", async (context) => {
  const generation = workflowRequest({ id: 101 });
  const laterTerminal = cleanIssueComment(HEAD, {
    id: 201,
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const github = createGitHubMock({
    issueComments: [generation, laterTerminal],
    reactionsByCommentId: new Map([["101", [reaction({
      id: 575,
      created_at: "2026-08-25T08:01:00Z",
    })]]]),
  });
  const environment = runtimeEnvironment(context, {
    suffix: "later-provider-clean-after-direct-candidate",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.gateOutcome, "success");
  assert.match(result.report.reason, /issue-comment 201/u);
});

test("direct gap closure treats provider terminal activity as live work", async (context) => {
  const epoch = baseRefChangedEvent();
  const generationA = workflowRequest({
    id: 101,
    created_at: "2026-08-25T08:10:00Z",
    updated_at: "2026-08-25T08:10:00Z",
  });
  const providerTerminal = cleanIssueComment(HEAD, {
    id: 201,
    created_at: "2026-08-25T08:11:30Z",
    updated_at: "2026-08-25T08:11:30Z",
  });
  const generationB = workflowRequest({
    id: 102,
    body: canonicalRequestBody(HEAD, { runId: "124" }),
    created_at: "2026-08-25T08:12:00Z",
    updated_at: "2026-08-25T08:12:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const github = createGitHubMock({
    baseEpoch: epoch,
    issueComments: [generationA, providerTerminal, generationB],
    reactionsByCommentId: new Map([
      ["101", [reaction({ id: 580, created_at: "2026-08-25T08:11:00Z" })]],
      ["102", [reaction({ id: 581, created_at: "2026-08-25T08:13:00Z" })]],
    ]),
  });
  const environment = runtimeEnvironment(context, {
    suffix: "direct-gap-post-clean-provider-terminal",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "request_clean_generation");
  assert.match(result.report.reason, /earlier request 101.*newer request 102/iu);
});

test("edited terminal carriers preserve their unknown pre-edit activity interval", async (context) => {
  const generationA = workflowRequest({ id: 101 });
  const generationB = workflowRequest({
    id: 102,
    body: canonicalRequestBody(HEAD, { runId: "124" }),
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const editedAfterBoundary = cleanIssueComment(HEAD, {
    id: 201,
    created_at: "2026-08-25T08:01:30Z",
    updated_at: "2026-08-25T08:03:00Z",
  });
  const crossedBoundaryGitHub = createGitHubMock({
    issueComments: [generationA, editedAfterBoundary, generationB],
    reactionsByCommentId: new Map([
      ["101", [reaction({ id: 590, created_at: "2026-08-25T08:01:00Z" })]],
      ["102", [reaction({ id: 591, created_at: "2026-08-25T08:04:00Z" })]],
    ]),
  });
  const crossedBoundaryEnvironment = runtimeEnvironment(context, {
    suffix: "edited-terminal-crosses-successor-boundary",
  });
  const { result: crossedBoundary } = await runGate(
    crossedBoundaryEnvironment,
    crossedBoundaryGitHub,
  );
  assert.equal(crossedBoundary.exitCode, 1);
  assert.equal(crossedBoundary.report.gateOutcome, "pending");
  assert.equal(crossedBoundary.report.recoveryCode, "request_clean_generation");
  assert.match(crossedBoundary.report.reason, /earlier request 101.*newer request 102/iu);

  const editedBeforeBoundary = cleanIssueComment(HEAD, {
    id: 201,
    created_at: "2026-08-25T08:00:30Z",
    updated_at: "2026-08-25T08:01:30Z",
  });
  const ownEndpointGitHub = createGitHubMock({
    issueComments: [generationA, editedBeforeBoundary, generationB],
    reactionsByCommentId: new Map([["102", [reaction({
      id: 592,
      created_at: "2026-08-25T08:03:00Z",
    })]]]),
  });
  const ownEndpointEnvironment = runtimeEnvironment(context, {
    suffix: "edited-terminal-own-endpoint-has-no-clean-authority",
  });
  const { result: ownEndpoint } = await runGate(ownEndpointEnvironment, ownEndpointGitHub);
  assert.equal(ownEndpoint.exitCode, 1);
  assert.equal(ownEndpoint.report.gateOutcome, "pending");
  assert.equal(ownEndpoint.report.recoveryCode, "request_clean_generation");
  assert.match(ownEndpoint.report.reason, /earlier request 101.*newer request 102/iu);

  const otherCarrierSameTimeGitHub = createGitHubMock({
    issueComments: [
      generationA,
      editedBeforeBoundary,
      progressIssueComment({
        id: 204,
        created_at: "2026-08-25T08:01:30Z",
        updated_at: "2026-08-25T08:01:30Z",
      }),
      generationB,
    ],
    reactionsByCommentId: new Map([["102", [reaction({
      id: 593,
      created_at: "2026-08-25T08:03:00Z",
    })]]]),
  });
  const otherCarrierSameTimeEnvironment = runtimeEnvironment(context, {
    suffix: "edited-terminal-does-not-ignore-other-carrier-endpoint",
  });
  const { result: otherCarrierSameTime } = await runGate(
    otherCarrierSameTimeEnvironment,
    otherCarrierSameTimeGitHub,
  );
  assert.equal(otherCarrierSameTime.exitCode, 1);
  assert.equal(otherCarrierSameTime.report.gateOutcome, "pending");
  assert.equal(otherCarrierSameTime.report.recoveryCode, "request_clean_generation");
});

test("an edited provider clean cannot erase an unobservable same-generation finding", async (context) => {
  const generation = workflowRequest({ id: 101 });
  const editedClean = cleanIssueComment(HEAD, {
    id: 201,
    created_at: "2026-08-25T08:00:30Z",
    updated_at: "2026-08-25T08:01:30Z",
  });
  const github = createGitHubMock({
    issueComments: [generation, editedClean],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "edited-clean-cannot-hide-prior-finding",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "request_clean_generation");
  assert.equal(result.report.counts.indeterminate > 0, true);
  assert.match(result.report.reason, /unobservable prior body history/iu);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("malformed and unresolved carriers keep a provider-closed gap live", async (context) => {
  const generationA = workflowRequest({ id: 101 });
  const providerClean = cleanIssueComment(HEAD, {
    id: 201,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
  });
  const generationB = workflowRequest({
    id: 102,
    body: canonicalRequestBody(HEAD, { runId: "124" }),
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const cases = [
    ["malformed", cleanIssueComment(HEAD, {
      id: 202,
      body: "Codex Review: Didn't find any major issues.",
      created_at: "2026-08-25T08:01:30Z",
      updated_at: "2026-08-25T08:01:30Z",
    }), null],
    ["unresolved", cleanIssueComment(HEAD.slice(0, 10), {
      id: 202,
      created_at: "2026-08-25T08:01:30Z",
      updated_at: "2026-08-25T08:01:30Z",
    }), () => ({ status: 422, message: "short SHA is ambiguous" })],
  ];
  for (const [suffix, badCarrier, commitResolution] of cases) {
    const github = createGitHubMock({
      issueComments: [generationA, providerClean, badCarrier, generationB],
      reactionsByCommentId: new Map([["102", [reaction({
        id: suffix === "malformed" ? 600 : 601,
        created_at: "2026-08-25T08:03:00Z",
      })]]]),
      commitResolution,
    });
    const environment = runtimeEnvironment(context, {
      suffix: `provider-clean-gap-${suffix}-activity`,
    });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "request_clean_generation", suffix);
    assert.equal(result.report.counts.indeterminate, 2, suffix);
    assert.match(result.report.reason, /earlier request 101.*newer request 102/iu, suffix);
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, suffix);
  }
});

test("malformed and unresolved carriers keep a direct post-epoch gap live", async (context) => {
  const epoch = baseRefChangedEvent();
  const generationA = workflowRequest({
    id: 101,
    created_at: "2026-08-25T08:10:00Z",
    updated_at: "2026-08-25T08:10:00Z",
  });
  const generationB = workflowRequest({
    id: 102,
    body: canonicalRequestBody(HEAD, { runId: "124" }),
    created_at: "2026-08-25T08:12:00Z",
    updated_at: "2026-08-25T08:12:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const cases = [
    ["malformed", cleanIssueComment(HEAD, {
      id: 202,
      body: "Codex Review: Didn't find any major issues.",
      created_at: "2026-08-25T08:11:30Z",
      updated_at: "2026-08-25T08:11:30Z",
    }), null],
    ["unresolved", cleanIssueComment(HEAD.slice(0, 10), {
      id: 202,
      created_at: "2026-08-25T08:11:30Z",
      updated_at: "2026-08-25T08:11:30Z",
    }), () => ({ status: 422, message: "short SHA is ambiguous" })],
  ];
  for (const [suffix, badCarrier, commitResolution] of cases) {
    const github = createGitHubMock({
      baseEpoch: epoch,
      issueComments: [generationA, badCarrier, generationB],
      reactionsByCommentId: new Map([
        ["101", [reaction({ id: 610, created_at: "2026-08-25T08:11:00Z" })]],
        ["102", [reaction({ id: 611, created_at: "2026-08-25T08:13:00Z" })]],
      ]),
      commitResolution,
    });
    const environment = runtimeEnvironment(context, {
      suffix: `base-epoch-direct-gap-${suffix}-activity`,
    });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "request_clean_generation", suffix);
    assert.equal(result.report.counts.indeterminate, 2, suffix);
    assert.match(result.report.reason, /earlier request 101.*newer request 102/iu, suffix);
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, suffix);
  }
});

test("a superseded edited malformed error still blocks its historical activity interval", async (context) => {
  const generationA = workflowRequest({ id: 101 });
  const editedMalformed = cleanIssueComment(HEAD, {
    id: 201,
    body: "Codex Review: Didn't find any major issues.",
    created_at: "2026-08-25T08:00:30Z",
    updated_at: "2026-08-25T08:01:30Z",
  });
  const generationB = workflowRequest({
    id: 102,
    body: canonicalRequestBody(HEAD, { runId: "124" }),
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const github = createGitHubMock({
    issueComments: [generationA, editedMalformed, generationB],
    reactionsByCommentId: new Map([
      ["101", [reaction({ id: 620, created_at: "2026-08-25T08:01:00Z" })]],
      ["102", [reaction({ id: 621, created_at: "2026-08-25T08:03:00Z" })]],
    ]),
  });
  const environment = runtimeEnvironment(context, {
    suffix: "edited-malformed-superseded-but-gap-live",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "request_clean_generation");
  assert.equal(result.report.counts.indeterminate, 2);
  assert.match(result.report.reason, /earlier request 101.*newer request 102/iu);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("a pre-generation edited clean is neither generation clean nor finding supersession", async (context) => {
  const generation = workflowRequest({
    id: 101,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
  });
  const editedClean = cleanIssueComment(HEAD, {
    id: 201,
    created_at: "2026-08-25T08:00:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const pendingGitHub = createGitHubMock({
    issueComments: [editedClean, generation],
  });
  const pendingEnvironment = runtimeEnvironment(context, {
    suffix: "pre-generation-edited-clean-not-generation-clean",
  });
  const { result: pending } = await runGate(pendingEnvironment, pendingGitHub);
  assert.equal(pending.exitCode, 1);
  assert.equal(pending.report.gateOutcome, "pending");
  assert.equal(pending.report.recoveryCode, "request_clean_generation");
  assert.equal(pendingGitHub.statusWrites.some(({ state }) => state === "success"), false);

  const findingGitHub = createGitHubMock({
    issueComments: [editedClean, generation],
    reviews: [findingReview(HEAD, {
      id: 401,
      submitted_at: "2026-08-25T07:59:00Z",
    })],
  });
  const findingEnvironment = runtimeEnvironment(context, {
    suffix: "pre-generation-edited-clean-not-finding-supersession",
  });
  const { result: finding } = await runGate(findingEnvironment, findingGitHub);
  assert.equal(finding.exitCode, 1);
  assert.equal(finding.report.gateOutcome, "failure");
  assert.equal(finding.report.recoveryCode, "fix_findings");
  assert.equal(finding.report.counts.unresolved, 1);
  assert.equal(finding.report.counts.resolved, 0);
  assert.equal(findingGitHub.statusWrites.some(({ state }) => state === "success"), false);
});

test("GraphQL lastEditedAt makes same-second request history physical-only", async (context) => {
  const sameSecondEdit = "2026-08-25T08:02:00.500Z";
  const editedAwayCases = [
    ["actions", workflowRequest({
      id: 102,
      body: "The request was edited away",
      created_at: "2026-08-25T08:02:00Z",
      updated_at: "2026-08-25T08:02:00Z",
      last_edited_at: sameSecondEdit,
      graphql_updated_at: sameSecondEdit,
      html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
    })],
    ["other-app-bot", workflowRequest({
      id: 102,
      body: `Forged diagnostic\n\n<!-- ${V2_STICKY_MARKER} -->`,
      created_at: "2026-08-25T08:02:00Z",
      updated_at: "2026-08-25T08:02:00Z",
      last_edited_at: sameSecondEdit,
      graphql_updated_at: sameSecondEdit,
      html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
      user: { login: "other-app[bot]", type: "Bot" },
      app: { slug: "other-app" },
    })],
  ];
  for (const [suffix, editedAway] of editedAwayCases) {
    const github = createGitHubMock({
      issueComments: [workflowRequest(), editedAway],
      reactionsByCommentId: new Map([["101", [reaction({
        id: 660,
        created_at: "2026-08-25T08:01:00Z",
      })]]]),
    });
    const environment = runtimeEnvironment(context, {
      suffix: `same-second-edited-away-${suffix}`,
    });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "request_clean_generation", suffix);
    assert.equal(result.report.requiresReplacementPr, true, suffix);
    assert.match(result.report.reason, /unobservable prior body history|newer request 102/iu, suffix);
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, suffix);
  }

  const editedCanonical = workflowRequest({
    last_edited_at: "2026-08-25T08:00:00.500Z",
    graphql_updated_at: "2026-08-25T08:00:00.500Z",
  });
  const canonicalGitHub = createGitHubMock({
    issueComments: [editedCanonical],
    reactionsByCommentId: new Map([["101", [reaction()]]]),
  });
  const canonicalEnvironment = runtimeEnvironment(context, {
    suffix: "same-second-edited-canonical-request",
  });
  const { result: canonical } = await runGate(canonicalEnvironment, canonicalGitHub);
  assert.equal(canonical.exitCode, 1);
  assert.equal(canonical.report.gateOutcome, "pending");
  assert.equal(canonical.report.requiresReplacementPr, true);
  assert.match(canonical.report.reason, /invalid binding/iu);
  assert.equal(hasRequestReactionGraphQlCall(canonicalGitHub, 101), false);
});

test("a same-second edited provider terminal has no positive or superseding authority", async (context) => {
  const generation = workflowRequest();
  const editedClean = cleanIssueComment(HEAD, {
    id: 201,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
    last_edited_at: "2026-08-25T08:01:00.500Z",
    graphql_updated_at: "2026-08-25T08:01:00.500Z",
  });
  const github = createGitHubMock({
    issueComments: [generation, editedClean],
    reviews: [findingReview(HEAD, {
      id: 401,
      submitted_at: "2026-08-25T08:00:30Z",
    })],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "same-second-edited-provider-clean",
  });
  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.gateOutcome, "failure");
  assert.equal(result.report.recoveryCode, "fix_findings");
  assert.equal(result.report.counts.unresolved, 1);
  assert.equal(result.report.counts.resolved, 0);
  assert.match(result.report.reason, /edited Codex clean|evidence warning/iu);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("observed issue-comment edit metadata cannot disappear during reconciliation", async (context) => {
  const edited = genericComment(102);
  edited.last_edited_at = "2026-08-25T08:00:00.500Z";
  edited.graphql_updated_at = "2026-08-25T08:00:00.500Z";
  const unedited = genericComment(102);
  unedited.last_edited_at = null;
  const github = createGitHubMock({
    issueCommentSnapshots: [
      [workflowRequest(), edited],
      [workflowRequest(), unedited],
      [workflowRequest(), unedited],
      [workflowRequest(), unedited],
      [workflowRequest(), unedited],
    ],
    reactionsByCommentId: new Map([["101", [reaction()]]]),
  });
  const environment = runtimeEnvironment(context, {
    suffix: "issue-comment-edit-metadata-latch",
  });
  const { result } = await runGate(environment, github, {
    stabilityWindowMs: 4,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.match(
    result.report.reason,
    /(?:edit metadata.*102.*disappeared|REST and GraphQL issue-comment metadata did not match for 102|Previously observed graphql issue-comment 102 changed)/iu,
  );
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("an updatedAt edit proof cannot roll back to an unedited snapshot", async (context) => {
  const edited = genericComment(102);
  edited.updated_at = "2026-08-25T07:00:01Z";
  edited.last_edited_at = null;
  const unedited = genericComment(102);
  unedited.last_edited_at = null;
  const github = createGitHubMock({
    issueCommentSnapshots: [
      [workflowRequest(), edited],
      [workflowRequest(), unedited],
      [workflowRequest(), unedited],
      [workflowRequest(), unedited],
      [workflowRequest(), unedited],
    ],
    reactionsByCommentId: new Map([["101", [reaction()]]]),
  });
  const environment = runtimeEnvironment(context, {
    suffix: "issue-comment-updated-at-edit-latch",
  });
  const { result } = await runGate(environment, github, {
    stabilityWindowMs: 4,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.match(
    result.report.reason,
    /(?:edit metadata.*102.*(?:disappeared|moved backwards)|rest issue-comment 102 changed)/iu,
  );
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("older-request eyes block a later gap and finding supersession across requests", async (context) => {
  const generationA = workflowRequest({ id: 101 });
  const generationB = workflowRequest({
    id: 102,
    body: canonicalRequestBody(HEAD, { runId: "124" }),
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:01:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const generationC = workflowRequest({
    id: 103,
    body: canonicalRequestBody(HEAD, { runId: "125" }),
    created_at: "2026-08-25T08:04:00Z",
    updated_at: "2026-08-25T08:04:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-103`,
  });
  const reactionsByCommentId = new Map([
    ["101", [
      reaction({ id: 630, created_at: "2026-08-25T08:00:30Z" }),
      reaction({ id: 631, content: "eyes", created_at: "2026-08-25T08:03:00Z" }),
    ]],
    ["102", [reaction({ id: 632, created_at: "2026-08-25T08:02:00Z" })]],
    ["103", [reaction({ id: 633, created_at: "2026-08-25T08:05:00Z" })]],
  ]);
  const gapGitHub = createGitHubMock({
    issueComments: [generationA, generationB, generationC],
    reactionsByCommentId,
  });
  const gapEnvironment = runtimeEnvironment(context, {
    suffix: "cross-request-eyes-block-later-gap",
  });
  const { result: gap } = await runGate(gapEnvironment, gapGitHub);
  assert.equal(gap.exitCode, 1);
  assert.equal(gap.report.gateOutcome, "pending");
  assert.equal(gap.report.recoveryCode, "request_clean_generation");
  assert.match(gap.report.reason, /earlier request 102.*newer request 103/iu);
  assert.equal(gapGitHub.statusWrites.some(({ state }) => state === "success"), false);

  const findingGitHub = createGitHubMock({
    issueComments: [generationA, generationB, generationC],
    reviews: [findingReview(HEAD, {
      id: 401,
      submitted_at: "2026-08-25T08:02:30Z",
    })],
    reactionsByCommentId,
  });
  const findingEnvironment = runtimeEnvironment(context, {
    suffix: "cross-request-eyes-block-finding-supersession",
  });
  const { result: finding } = await runGate(findingEnvironment, findingGitHub);
  assert.equal(finding.exitCode, 1);
  assert.equal(finding.report.gateOutcome, "failure");
  assert.equal(finding.report.counts.unresolved, 1);
  assert.equal(finding.report.counts.resolved, 0);
  assert.equal(findingGitHub.statusWrites.some(({ state }) => state === "success"), false);
});

test("clean selection falls back only to a qualifying later provider candidate", async (context) => {
  const oldFinding = findingReview(HEAD, {
    id: 401,
    submitted_at: "2026-08-25T07:59:00Z",
  });
  const generation = workflowRequest({ id: 101 });
  const reactionsByCommentId = new Map([["101", [
    reaction({ id: 640, created_at: "2026-08-25T08:01:00Z" }),
    reaction({ id: 641, content: "eyes", created_at: "2026-08-25T08:01:30Z" }),
  ]]]);
  const providerClean = cleanIssueComment(HEAD, {
    id: 201,
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const qualifyingGitHub = createGitHubMock({
    issueComments: [generation, providerClean],
    reviews: [oldFinding],
    reactionsByCommentId,
  });
  const qualifyingEnvironment = runtimeEnvironment(context, {
    suffix: "fallback-to-qualifying-provider-clean",
  });
  const { result: qualifying } = await runGate(
    qualifyingEnvironment,
    qualifyingGitHub,
  );
  assert.equal(qualifying.exitCode, 0);
  assert.equal(qualifying.report.gateOutcome, "success");
  assert.equal(qualifying.report.counts.unresolved, 0);
  assert.equal(qualifying.report.counts.resolved, 1);
  assert.match(qualifying.report.reason, /issue-comment 201/u);

  const editedFallback = cleanIssueComment(HEAD, {
    id: 201,
    created_at: "2026-08-25T07:58:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const nonqualifyingGitHub = createGitHubMock({
    issueComments: [editedFallback, generation],
    reviews: [oldFinding],
    reactionsByCommentId,
  });
  const nonqualifyingEnvironment = runtimeEnvironment(context, {
    suffix: "edited-provider-fallback-is-not-qualifying",
  });
  const { result: nonqualifying } = await runGate(
    nonqualifyingEnvironment,
    nonqualifyingGitHub,
  );
  assert.equal(nonqualifying.exitCode, 1);
  assert.equal(nonqualifying.report.gateOutcome, "failure");
  assert.equal(nonqualifying.report.counts.unresolved, 1);
  assert.equal(nonqualifying.report.counts.resolved, 0);
  assert.equal(nonqualifyingGitHub.statusWrites.some(({ state }) => state === "success"), false);
});

test("same-run request siblings preserve every physical generation gap", async (context) => {
  const siblingA = workflowRequest({ id: 101 });
  const siblingB = workflowRequest({
    id: 102,
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const github = createGitHubMock({
    issueComments: [siblingA, siblingB],
    reactionsByCommentId: new Map([["102", [reaction({
      id: 512,
      created_at: "2026-08-25T08:03:00Z",
    })]]]),
  });
  const environment = runtimeEnvironment(context, { suffix: "same-run-physical-gap" });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "request_clean_generation");
  assert.match(result.report.reason, /earlier request 101.*newer request 102/iu);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("a globally duplicated reaction identity cannot authorize the latest generation", async (context) => {
  const generationA = workflowRequest({ id: 101 });
  const generationB = workflowRequest({
    id: 102,
    body: canonicalRequestBody(HEAD, { runId: "124" }),
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const github = createGitHubMock({
    issueComments: [
      generationA,
      cleanIssueComment(HEAD, {
        id: 202,
        created_at: "2026-08-25T08:01:00Z",
        updated_at: "2026-08-25T08:01:00Z",
      }),
      generationB,
    ],
    reactionsByCommentId: new Map([
      ["101", [reaction({ id: 513, created_at: "2026-08-25T08:01:30Z" })]],
      ["102", [reaction({ id: 513, created_at: "2026-08-25T08:03:00Z" })]],
    ]),
  });
  const environment = runtimeEnvironment(context, { suffix: "global-reaction-id-duplicate" });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_then_reconcile");
  assert.match(result.report.reason, /repeated official Codex identity 513/iu);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("short Reviewed commit is accepted only through GitHub unambiguous resolution", async (context) => {
  const request = ordinaryRequest();
  const short = HEAD.slice(0, 10);
  const terminal = cleanIssueComment(short, {
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const requestAcknowledgement = new Map([[String(request.id), [reaction({
    content: "eyes",
    created_at: "2026-08-25T08:01:00Z",
  })]]]);
  const github = createGitHubMock({
    issueComments: [request, terminal],
    reactionsByCommentId: requestAcknowledgement,
  });
  const environment = runtimeEnvironment(context, { suffix: "short-resolved" });
  const { result } = await runGate(environment, github);
  assert.equal(result.report.gateOutcome, "success");
  assert.ok(github.calls.some((call) => call.path.endsWith(`/commits/${short}`)));

  const ambiguousGitHub = createGitHubMock({
    issueComments: [request, terminal],
    reactionsByCommentId: requestAcknowledgement,
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
    reactionsByCommentId: requestAcknowledgement,
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
  const request = ordinaryRequest();
  const requestAcknowledgement = new Map([[String(request.id), [reaction({
    content: "eyes",
    created_at: "2026-08-25T08:01:00Z",
  })]]]);
  const resolvedGitHub = createGitHubMock({
    issueComments: [request],
    reviews: [approvedReview(short)],
    reactionsByCommentId: requestAcknowledgement,
  });
  const resolvedEnvironment = runtimeEnvironment(context, { suffix: "approved-short" });
  const { result: resolved } = await runGate(resolvedEnvironment, resolvedGitHub);
  assert.equal(resolved.report.gateOutcome, "success");
  assert.ok(resolvedGitHub.calls.some((call) => call.path.endsWith(`/commits/${short}`)));

  const ambiguousGitHub = createGitHubMock({
    issueComments: [request],
    reviews: [approvedReview(short)],
    reactionsByCommentId: requestAcknowledgement,
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

test("finding supersession requires a strictly newer authorized generation and request-bound clean", async (context) => {
  const first = ordinaryRequest({ id: 101 });
  const second = workflowRequest({
    id: 102,
    body: canonicalRequestBody(HEAD, { runId: "124" }),
    created_at: "2026-08-25T08:10:00Z",
    updated_at: "2026-08-25T08:10:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const clean = cleanIssueComment(HEAD, {
    id: 203,
    created_at: "2026-08-25T08:15:00Z",
    updated_at: "2026-08-25T08:15:00Z",
  });
  const github = createGitHubMock({
    issueComments: [first, second, clean],
    reviews: [findingReview(HEAD, { submitted_at: "2026-08-25T08:05:00Z" })],
    reactionsByCommentId: new Map([["102", [reaction({
      id: 550,
      created_at: "2026-08-25T08:15:30Z",
    })]]]),
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
  const laterGeneration = workflowRequest({
    id: 102,
    body: canonicalRequestBody(HEAD, { runId: "124" }),
    created_at: "2026-08-25T08:10:00Z",
    updated_at: "2026-08-25T08:10:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
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
    reactionsByCommentId: new Map([["102", [reaction({
      id: 551,
      created_at: "2026-08-25T08:15:30Z",
    })]]]),
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
  const request = ordinaryRequest();
  const github = createGitHubMock({
    issueComments: [
      request,
      cleanIssueComment(HEAD, {
        created_at: "2026-08-25T08:10:00Z",
        updated_at: "2026-08-25T08:10:00Z",
      }),
    ],
    reviews: [findingReview(OLD_HEAD, { submitted_at: "2026-08-25T08:05:00Z" })],
    reactionsByCommentId: new Map([[String(request.id), [reaction({
      content: "eyes",
      created_at: "2026-08-25T08:01:00Z",
    })]]]),
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
    reactionsByCommentId: new Map([[String(generation.id), [reaction({
      content: "eyes",
      created_at: "2026-08-25T08:12:00Z",
    })]]]),
  });
  const environment = runtimeEnvironment(context, { suffix: "historical-malformed" });
  const { result } = await runGate(environment, github);
  assert.equal(result.report.gateOutcome, "success");
  assert.equal(result.report.counts.indeterminate, 2);
});

test("invalid provider provenance remains activity in the generation quiet window", async (context) => {
  const generationA = workflowRequest();
  const generationB = workflowRequest({
    id: 102,
    body: canonicalRequestBody(HEAD, { runId: "124" }),
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const cases = [
    ["official-login-wrong-app-comment", {
      issueComments: [cleanIssueComment(HEAD, {
        id: 201,
        performed_via_github_app: { slug: "wrong-provider" },
        created_at: "2026-08-25T08:01:30Z",
        updated_at: "2026-08-25T08:01:30Z",
      })],
      reviews: [],
    }],
    ["secondary-official-app-signal-comment", {
      issueComments: [cleanIssueComment(HEAD, {
        id: 201,
        user: { login: "wrong-provider[bot]", type: "Bot" },
        app: { slug: "wrong-provider" },
        performed_via_github_app: CODEX_APP,
        created_at: "2026-08-25T08:01:30Z",
        updated_at: "2026-08-25T08:01:30Z",
      })],
      reviews: [],
    }],
    ["official-app-signal-review", {
      issueComments: [],
      reviews: [findingReview(HEAD, {
        id: 401,
        user: { login: "wrong-provider[bot]", type: "Bot" },
        app: CODEX_APP,
        submitted_at: "2026-08-25T08:01:30Z",
      })],
    }],
  ];
  for (const [suffix, carrier] of cases) {
    const github = createGitHubMock({
      issueComments: [generationA, ...carrier.issueComments, generationB],
      reviews: carrier.reviews,
      reactionsByCommentId: new Map([
        ["101", [reaction({ id: 670, created_at: "2026-08-25T08:01:00Z" })]],
        ["102", [reaction({ id: 671, created_at: "2026-08-25T08:03:00Z" })]],
      ]),
    });
    const environment = runtimeEnvironment(context, {
      suffix: `invalid-provider-quiet-window-${suffix}`,
    });
    const { result } = await runGate(environment, github);
    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "request_clean_generation", suffix);
    assert.equal(result.report.counts.indeterminate, 2, suffix);
    assert.match(result.report.reason, /earlier request 101.*newer request 102/iu, suffix);
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, suffix);
  }
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
    reactionsByCommentId: new Map([[String(generation.id), [reaction({
      content: "eyes",
      created_at: "2026-08-25T08:12:00Z",
    })]]]),
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

test("official review summary comments are diagnostic-only regardless of status, table, or SHA", async (context) => {
  const summaries = [
    ["completed-current-head", officialReviewSummaryComment({ id: 290 })],
    ["unknown-status-missing-sha", officialReviewSummaryComment({
      id: 291,
      status: "Unknown status",
      reviewedSha: "",
    })],
    ["ambiguous-short-sha", officialReviewSummaryComment({
      id: 292,
      reviewedSha: HEAD.slice(0, 7),
    })],
    ["malformed-table-and-footer", officialReviewSummaryComment({
      id: 293,
      body: [
        CODEX_PULL_REQUEST_REVIEW_SUMMARY_MARKER,
        "",
        "Status: maybe-complete",
        "| malformed table without a separator",
        "Reviewed commit: `not-a-sha`",
      ].join("\n"),
    })],
  ];

  for (const [suffix, summary] of summaries) {
    const github = createGitHubMock({
      issueComments: [workflowRequest(), summary, cleanIssueComment(HEAD)],
      reviewThreads: [reviewThread({
        id: `PRRT_official_summary_${summary.id}`,
        isResolved: true,
      })],
      commitResolution: () => ({ status: 422, message: "short SHA is ambiguous" }),
    });
    const environment = runtimeEnvironment(context, {
      suffix: `official-summary-diagnostic-only-${suffix}`,
    });
    const { result } = await runGate(environment, github);

    assert.equal(result.exitCode, 0, `${suffix}: ${result.report.reason}`);
    assert.equal(result.report.executionHealth, "healthy", suffix);
    assert.equal(result.report.gateOutcome, "success", suffix);
    assert.equal(result.report.recoveryCode, "none", suffix);
    assert.equal(result.report.counts.indeterminate, 0, suffix);
    assert.equal(result.report.reviewThreads.unresolved, 0, suffix);
    assert.equal(result.report.reviewThreads.resolved, 1, suffix);
    assert.equal(
      github.calls.some(({ method, path }) =>
        method === "GET" && path === `/repos/${REPOSITORY}/issues/comments/${summary.id}`
      ),
      false,
      `${suffix}: summary comment was directly refetched`,
    );
    assert.equal(hasRequestReactionGraphQlCall(github, summary.id), false, suffix);
    assert.equal(
      github.calls.some(({ path }) => path.startsWith(`/repos/${REPOSITORY}/commits/`)),
      false,
      `${suffix}: summary SHA was resolved as a commit`,
    );
  }
});

test("a completed official summary without a terminal clean remains pending", async (context) => {
  const summary = officialReviewSummaryComment({
    id: 294,
    status: "Completed",
    reviewedSha: HEAD,
  });
  const github = createGitHubMock({ issueComments: [workflowRequest(), summary] });
  const environment = runtimeEnvironment(context, {
    suffix: "official-summary-is-not-a-clean",
  });
  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.notEqual(result.report.recoveryCode, "none");
  assert.equal(result.report.counts.unresolved, 0);
  assert.equal(result.report.counts.indeterminate, 0);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
  assert.equal(
    github.calls.some(({ method, path }) =>
      method === "GET" && path === `/repos/${REPOSITORY}/issues/comments/${summary.id}`
    ),
    false,
  );
});

test("summary creation, edits, and disappearance do not destabilize complete snapshots", async (context) => {
  const request = workflowRequest();
  const clean = cleanIssueComment(HEAD);
  const summaryCreated = officialReviewSummaryComment({
    id: 295,
    created_at: "2026-08-25T08:01:30Z",
    updated_at: "2026-08-25T08:01:30Z",
  });
  const summaryEdited = officialReviewSummaryComment({
    id: summaryCreated.id,
    status: "Unknown",
    reviewedSha: "",
    created_at: summaryCreated.created_at,
    updated_at: "2026-08-25T08:03:00Z",
  });
  const github = createGitHubMock({
    issueCommentSnapshots: [
      [request, clean],
      [request, clean, summaryCreated],
      [request, clean, summaryEdited],
      [request, clean],
    ],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "official-summary-snapshot-churn",
  });
  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 0, result.report.reason);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "success");
  assert.equal(result.report.recoveryCode, "none");
  assert.equal(
    github.calls.filter(({ method, path }) =>
      method === "GET" && path === `/repos/${REPOSITORY}/issues/${PR}/comments`
    ).length,
    4,
    "all opening/closing inventories across the two outer stabilization rounds were read",
  );
  assert.equal(
    github.calls.some(({ method, path }) =>
      method === "GET" && path === `/repos/${REPOSITORY}/issues/comments/${summaryCreated.id}`
    ),
    false,
    "recognized summary was not directly refetched while present",
  );
  assert.equal(hasRequestReactionGraphQlCall(github, summaryCreated.id), false);
});

test("trusted summary transport omissions do not change complete comment inventories", async (context) => {
  const request = workflowRequest();
  const clean = cleanIssueComment(HEAD);
  const summary = officialReviewSummaryComment({
    id: 306,
    created_at: "2026-08-25T08:00:30Z",
    updated_at: "2026-08-25T08:00:30Z",
  });

  const omittedFromHistory = createGitHubMock({
    issueComments: [request, summary, clean],
    deletedCommentResponseMutator: (response, { commentCursor, includeComments, snapshotIndex }) => {
      if (!includeComments || commentCursor !== null || snapshotIndex === 0) {
        return response;
      }
      const mutated = structuredClone(response);
      const connection = mutated.data.repository.pullRequest.comments;
      connection.nodes = connection.nodes.filter(
        ({ databaseId }) => String(databaseId) !== String(summary.id),
      );
      connection.totalCount = connection.nodes.length;
      connection.pageInfo = { hasNextPage: false, endCursor: null };
      return mutated;
    },
  });
  const omittedEnvironment = runtimeEnvironment(context, {
    suffix: "official-summary-graphql-omission",
  });
  const { result: omittedResult } = await runGate(omittedEnvironment, omittedFromHistory);
  assert.equal(omittedResult.exitCode, 0, omittedResult.report.reason);
  assert.equal(omittedResult.report.gateOutcome, "success");
  assert.equal(omittedResult.report.counts.indeterminate, 0);
  assert.equal(omittedFromHistory.statusWrites.some(({ state }) => state === "success"), false);

  const historyOnly = createGitHubMock({
    issueCommentSnapshots: [
      [request, summary, clean],
      [request, clean],
      [request, clean],
    ],
    deletedCommentResponseMutator: (response, { commentCursor, includeComments, snapshotIndex }) => {
      if (!includeComments || commentCursor !== null || snapshotIndex === 0) {
        return response;
      }
      const mutated = structuredClone(response);
      const connection = mutated.data.repository.pullRequest.comments;
      if (!connection.nodes.some(({ databaseId }) =>
        String(databaseId) === String(summary.id)
      )) {
        connection.nodes.push(issueCommentEditGraphQlNode(summary));
        connection.totalCount = connection.nodes.length;
        connection.pageInfo = { hasNextPage: false, endCursor: null };
      }
      return mutated;
    },
  });
  const historyOnlyEnvironment = runtimeEnvironment(context, {
    suffix: "official-summary-known-id-history-only",
  });
  const { result: historyOnlyResult } = await runGate(historyOnlyEnvironment, historyOnly);
  assert.equal(historyOnlyResult.exitCode, 0, historyOnlyResult.report.reason);
  assert.equal(historyOnlyResult.report.executionHealth, "healthy");
  assert.equal(historyOnlyResult.report.gateOutcome, "success");
  assert.equal(historyOnlyResult.report.counts.indeterminate, 0);
  assert.equal(historyOnly.statusWrites.some(({ state }) => state === "success"), false);

  const unknownHistorySummary = officialReviewSummaryComment({
    id: 308,
    created_at: "2026-08-25T08:00:45Z",
    updated_at: "2026-08-25T08:00:45Z",
  });
  const graphQlOnly = createGitHubMock({
    issueComments: [request, clean],
    deletedCommentResponseMutator: (response, { commentCursor, includeComments }) => {
      if (!includeComments || commentCursor !== null) return response;
      const mutated = structuredClone(response);
      const connection = mutated.data.repository.pullRequest.comments;
      if (!connection.nodes.some(({ databaseId }) =>
        String(databaseId) === String(unknownHistorySummary.id)
      )) {
        connection.nodes.push(issueCommentEditGraphQlNode(unknownHistorySummary));
        connection.totalCount = connection.nodes.length;
        connection.pageInfo = { hasNextPage: false, endCursor: null };
      }
      return mutated;
    },
  });
  const graphQlOnlyEnvironment = runtimeEnvironment(context, {
    suffix: "official-summary-new-graphql-only-id",
  });
  const { result: graphQlOnlyResult } = await runGate(graphQlOnlyEnvironment, graphQlOnly);
  assert.notEqual(graphQlOnlyResult.report.gateOutcome, "success");
  assert.equal(graphQlOnly.statusWrites.some(({ state }) => state === "success"), false);
});

test("summary activity does not make canonical second-request recovery ambiguous", async (context) => {
  const secondRequest = workflowRequest({
    id: 301,
    body: canonicalRequestBody(HEAD, { runId: "124" }),
    created_at: "2026-08-25T08:11:00Z",
    updated_at: "2026-08-25T08:11:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-301`,
  });
  const summary = officialReviewSummaryComment({
    id: 296,
    status: "Completed",
    reviewedSha: HEAD.slice(0, 7),
    created_at: "2026-08-25T08:11:30Z",
    updated_at: "2026-08-25T08:11:30Z",
  });

  for (const includeSummary of [false, true]) {
    const comments = [ordinaryRequest(), cleanIssueComment(HEAD), secondRequest];
    if (includeSummary) comments.push(summary);
    comments.push(recoveryClean());
    const github = createGitHubMock({
      issueComments: comments,
      selfVerifierRun: verifierSelfRun({ created_at: "2026-08-25T08:10:00Z" }),
    });
    const environment = runtimeEnvironment(context, {
      suffix: `official-summary-canonical-recovery-${includeSummary ? "with" : "without"}`,
    });
    const { result } = await runGate(environment, github);

    assert.equal(result.exitCode, 0, `${includeSummary}: ${result.report.reason}`);
    assert.equal(result.report.executionHealth, "healthy", String(includeSummary));
    assert.equal(result.report.gateOutcome, "success", String(includeSummary));
    assert.equal(result.report.recoveryCode, "none", String(includeSummary));
    if (includeSummary) {
      assert.equal(
        github.calls.some(({ method, path }) =>
          method === "GET" && path === `/repos/${REPOSITORY}/issues/comments/${summary.id}`
        ),
        false,
      );
      assert.equal(hasRequestReactionGraphQlCall(github, summary.id), false);
    }
  }
});

test("summary provenance cannot hide provider errors or override unresolved threads", async (context) => {
  const forgedSummaries = [
    ["wrong-app", {
      user: CODEX_BOT,
      app: null,
      performed_via_github_app: { slug: "untrusted-app" },
    }],
    ["wrong-author", {
      user: { login: "lookalike-reviewer[bot]", type: "Bot" },
      app: CODEX_APP,
      performed_via_github_app: CODEX_APP,
    }],
  ];

  for (const [suffix, identity] of forgedSummaries) {
    const forged = officialReviewSummaryComment({
      id: suffix === "wrong-app" ? 297 : 298,
      ...identity,
      created_at: "2026-08-25T08:02:00Z",
      updated_at: "2026-08-25T08:02:00Z",
    });
    const github = createGitHubMock({
      issueComments: [
        workflowRequest(),
        forged,
        cleanIssueComment(HEAD, {
          id: 203,
          created_at: "2026-08-25T08:05:00Z",
          updated_at: "2026-08-25T08:05:00Z",
        }),
      ],
    });
    const environment = runtimeEnvironment(context, {
      suffix: `official-summary-invalid-provenance-${suffix}`,
    });
    const { result } = await runGate(environment, github);

    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.counts.indeterminate > 0, true, suffix);
    assert.match(result.report.reason, /invalid Bot\/App provenance/iu, suffix);
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, suffix);
  }

  const editedFinding = findingIssueComment(HEAD, {
    id: 299,
    created_at: "2026-08-25T08:01:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const editedClean = cleanIssueComment(HEAD, {
    id: 300,
    created_at: "2026-08-25T08:03:00Z",
    updated_at: "2026-08-25T08:04:00Z",
  });
  const findingSummary = officialReviewSummaryComment({
    id: 302,
    created_at: "2026-08-25T08:00:30Z",
    updated_at: "2026-08-25T08:00:30Z",
  });
  const findingGitHub = createGitHubMock({
    issueComments: [workflowRequest(), findingSummary, editedFinding, editedClean],
  });
  const findingEnvironment = runtimeEnvironment(context, {
    suffix: "official-summary-edited-finding-protection",
  });
  const { result: findingResult } = await runGate(findingEnvironment, findingGitHub);
  assert.notEqual(findingResult.report.gateOutcome, "success");
  assert.equal(
    findingResult.report.counts.unresolved > 0 ||
      findingResult.report.counts.indeterminate > 0,
    true,
    findingResult.report.reason,
  );
  assert.equal(findingGitHub.statusWrites.some(({ state }) => state === "success"), false);

  const threadSummary = officialReviewSummaryComment({
    id: 303,
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
  });
  const threadGitHub = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD), threadSummary],
    reviewThreads: [reviewThread({ id: "PRRT_summary_unresolved", isResolved: false })],
  });
  const threadEnvironment = runtimeEnvironment(context, {
    suffix: "official-summary-unresolved-thread-protection",
  });
  const { result: threadResult } = await runGate(threadEnvironment, threadGitHub);
  assert.notEqual(threadResult.report.gateOutcome, "success");
  assert.equal(threadResult.report.reviewThreads.unresolved, 1);
  assert.equal(threadGitHub.statusWrites.some(({ state }) => state === "success"), false);
});

test("a trusted summary ID cannot waive current REST provenance drift", async (context) => {
  const trusted = officialReviewSummaryComment({
    id: 307,
    created_at: "2026-08-25T08:00:30Z",
    updated_at: "2026-08-25T08:00:30Z",
  });
  const provenanceDrift = {
    ...trusted,
    app: null,
    performed_via_github_app: null,
  };
  const request = workflowRequest();
  const clean = cleanIssueComment(HEAD);
  const github = createGitHubMock({
    issueCommentSnapshots: [
      [request, trusted, clean],
      [request, provenanceDrift, clean],
      [request, provenanceDrift, clean],
    ],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "official-summary-provenance-drift",
  });
  const { result } = await runGate(environment, github);

  assert.notEqual(result.report.gateOutcome, "success");
  assert.equal(
    result.report.counts.indeterminate > 0 || result.report.gateOutcome === "failure",
    true,
    result.report.reason,
  );
  assert.match(result.report.reason, /invalid Bot\/App provenance/iu);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("review carrier failures stay handled while REST issue-comment inventory is delayed", async (context) => {
  const cases = [
    {
      suffix: "review-list",
      rejects: ({ method, path }) =>
        method === "GET" && path === `/repos/${REPOSITORY}/pulls/${PR}/reviews`,
    },
    {
      suffix: "review-threads",
      rejects: ({ method, path, body }) =>
        method === "POST" && path === "/graphql" &&
        body?.query?.includes("CodexReviewGateReviewThreads"),
    },
  ];

  for (const { suffix, rejects } of cases) {
    const events = [];
    let delayedInventories = 0;
    let rejectedReads = 0;
    const github = createGitHubMock({
      issueComments: [workflowRequest()],
      requestInterceptor: async (request) => {
        if (request.method === "GET" &&
            request.path === `/repos/${REPOSITORY}/issues/${PR}/comments` &&
            delayedInventories++ === 0) {
          events.push("inventory-started");
          await new Promise((resolve) => setTimeout(resolve, 25));
          events.push("inventory-finished");
          return undefined;
        }
        if (rejects(request)) {
          rejectedReads += 1;
          events.push("carrier-rejected");
          return jsonResponse({ message: `synthetic ${suffix} failure` }, 502);
        }
        return undefined;
      },
    });
    const environment = runtimeEnvironment(context, {
      suffix: `delayed-comments-${suffix}-rejection`,
    });
    const { result } = await runGate(environment, github);

    assert.ok(rejectedReads > 0, suffix);
    assert.ok(events.indexOf("inventory-started") >= 0, suffix);
    assert.ok(events.indexOf("carrier-rejected") < events.indexOf("inventory-finished"), suffix);
    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.executionHealth, "unhealthy", suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(github.statusWrites.some(({ state }) => state === "success"), false, suffix);
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

test("default page budget completes snapshots with more than twenty aggregate pages", async (context) => {
  const historicalRequests = Array.from({ length: 5 }, (_, index) =>
    ordinaryRequest({
      id: 1_000 + index,
      created_at: `2026-08-25T07:0${index}:00Z`,
      updated_at: `2026-08-25T07:0${index}:00Z`,
      html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-${1_000 + index}`,
    }));
  const requestComments = [...historicalRequests, workflowRequest()];
  const reactionsByCommentId = new Map(requestComments.map((comment) => [
    String(comment.id),
    Array.from({ length: 25 }, (_, index) => reaction({
      id: comment.id * 100 + index,
      user: HUMAN,
      created_at: "2026-08-25T07:00:00Z",
    })),
  ]));
  const github = createGitHubMock({
    issueComments: [
      ...historicalRequests,
      workflowRequest(),
      cleanIssueComment(HEAD),
    ],
    reactionsByCommentId,
    reactionGraphQlPageSize: 1,
  });
  const environment = runtimeEnvironment(context, { suffix: "default-page-budget-over-20" });
  const { result } = await runGate(environment, github);
  const reactionPages = requestReactionGraphQlCalls(github);

  assert.equal(result.exitCode, 0, result.report.reason);
  assert.equal(result.report.gateOutcome, "success", result.report.reason);
  assert.equal(reactionPages.length, 100, "25 nested pages across four fresh carrier passes");
  assert.ok(reactionPages.length > 20, `expected >20 physical reaction pages, got ${reactionPages.length}`);
  for (const { body } of reactionPages) {
    assert.ok(
      Object.keys(body.variables).filter((key) => /^nodeId\d+$/u.test(key)).length <= 8,
      "each reaction request remains within the fixed batch size",
    );
  }
  const requestIds = new Set(requestComments.map(({ id }) => String(id)));
  assert.equal(
    github.calls.filter(({ method, path }) =>
      method === "GET" && [...requestIds].some((id) =>
        path === `/repos/${REPOSITORY}/issues/comments/${id}/reactions`
      )
    ).length,
    0,
    "selected requests no longer cause one REST reaction GET per request page",
  );
});

test("request reaction reads batch nine exact comments into two measured GraphQL calls per carrier inventory", async (context) => {
  const requests = Array.from({ length: 9 }, (_, index) => {
    const id = 101 + index;
    return ordinaryRequest({
      id,
      created_at: `2026-08-25T08:${String(index).padStart(2, "0")}:00Z`,
      updated_at: `2026-08-25T08:${String(index).padStart(2, "0")}:00Z`,
      html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-${id}`,
    });
  });
  const reactionsByCommentId = new Map(requests.map(({ id }) => [String(id), [
    reaction({
      id: 20_000 + id,
      user: HUMAN,
      created_at: "2026-08-25T09:00:00Z",
    }),
  ]]));
  const github = createGitHubMock({ issueComments: requests, reactionsByCommentId });
  const environment = runtimeEnvironment(context, { suffix: "batched-nine-requests" });
  const { result } = await runGate(environment, github);
  const reactionCalls = requestReactionGraphQlCalls(github);

  assert.notEqual(result.report.gateOutcome, "success");
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
  assert.equal(
    reactionCalls.length,
    4,
    "two batched reads in each of two fresh carrier inventories",
  );
  const callsPerComment = new Map(requests.map(({ id }) => [String(id), 0]));
  for (const { body } of reactionCalls) {
    const nodeIds = Object.entries(body.variables || {})
      .filter(([name]) => /^nodeId\d+$/u.test(name))
      .map(([, value]) => value);
    assert.ok(nodeIds.length > 0 && nodeIds.length <= 8);
    for (const nodeId of nodeIds) {
      const id = nodeId.replace(/^IC_test_/u, "");
      callsPerComment.set(id, (callsPerComment.get(id) || 0) + 1);
    }
  }
  assert.deepEqual([...callsPerComment.values()], Array(9).fill(2));
  const requestIds = new Set(requests.map(({ id }) => String(id)));
  assert.equal(
    github.calls.filter(({ method, path }) =>
      method === "GET" && [...requestIds].some((id) =>
        path === `/repos/${REPOSITORY}/issues/comments/${id}/reactions`
      )
    ).length,
    0,
    "the former nine-by-two independent REST first-page reads are gone",
  );
  assert.ok(reactionCalls.length < requests.length * 2);
});

test("expanded page budget completes snapshots with more than one hundred aggregate pages", async (context) => {
  const github = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
    reactionsByCommentId: new Map([["101", Array.from({ length: 30 }, (_, index) =>
      reaction({
        id: 7_000 + index,
        user: HUMAN,
        created_at: "2026-08-25T07:00:00Z",
      }))]]),
    reactionGraphQlPageSize: 1,
  });
  const environment = runtimeEnvironment(context, {
    suffix: "expanded-page-budget-over-100",
    limitsProfile: "expanded",
  });
  const { result } = await runGate(environment, github);
  const reactionPages = requestReactionGraphQlCalls(github);

  assert.equal(result.exitCode, 0, result.report.reason);
  assert.equal(result.report.gateOutcome, "success", result.report.reason);
  assert.equal(reactionPages.length, 120, "30 nested pages across four fresh carrier passes");
  assert.ok(reactionPages.length > 100, `expected >100 physical reaction pages, got ${reactionPages.length}`);
});

test("default page-budget exhaustion recommends expanded limits without writing success", async (context) => {
  const github = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
    reactionsByCommentId: new Map([["101", Array.from({ length: 101 }, (_, index) =>
      reaction({ id: 8_000 + index, user: HUMAN }))]]),
    reactionGraphQlPageSize: 1,
  });
  const environment = runtimeEnvironment(context, { suffix: "default-page-budget-exhausted" });
  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "use_expanded_limits");
  assert.match(result.report.reason, /101.*100|100.*101/u);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
});

test("expanded page-budget exhaustion reports the protected limit without writing success", async (context) => {
  const github = createGitHubMock({
    issueComments: [workflowRequest(), cleanIssueComment(HEAD)],
    reactionsByCommentId: new Map([["101", Array.from({ length: 501 }, (_, index) =>
      reaction({ id: 9_000 + index, user: HUMAN }))]]),
    reactionGraphQlPageSize: 1,
  });
  const environment = runtimeEnvironment(context, {
    suffix: "expanded-page-budget-exhausted",
    limitsProfile: "expanded",
  });
  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "raise_protected_limit");
  assert.match(result.report.reason, /501.*500|500.*501/u);
  assert.equal(github.statusWrites.some(({ state }) => state === "success"), false);
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

test("report-completion is an exact diagnostic-only snapshot and upserts one sticky comment", async (context) => {
  for (const [runConclusion, checkConclusion, expectedOutcome] of [
    ["success", "success", "success"],
    ["failure", "failure", "failure"],
    ["cancelled", "cancelled", "failure"],
  ]) {
    const fixture = completionRuntimeFixture({ runConclusion, checkConclusion });
    const environment = runtimeEnvironment(context, {
      suffix: `report-completion-${runConclusion}`,
      operation: "report-completion",
      eventName: "workflow_run",
      requestReview: "false",
      prNumber: 0,
      event: fixture.event,
    });

    const { result, sleeps } = await runGate(environment, fixture.github);

    assert.equal(result.exitCode, 0, runConclusion);
    assert.equal(result.report.executionHealth, "healthy", runConclusion);
    assert.equal(result.report.gateOutcome, expectedOutcome, runConclusion);
    assert.deepEqual(result.report.counts, {
      unresolved: "unknown",
      resolved: "unknown",
      historical: "unknown",
      indeterminate: "unknown",
    });
    assert.equal(result.report.reviewThreads.status, "not_read");
    assert.deepEqual(sleeps, []);
    assert.deepEqual(fixture.github.requestBodies, []);
    assert.deepEqual(fixture.github.rerunRequests, []);
    assert.deepEqual(fixture.github.statusWrites, []);
    assert.equal(fixture.github.stickyCreates.length, 1);
    assert.equal(fixture.github.stickyPatches.length, 0);
    const sticky = fixture.github.stickyCreates[0];
    assert.match(sticky, /Diagnostic-only verifier observation/u);
    assert.match(sticky, /not the current gating result/u);
    assert.match(sticky, /PR Checks and verifier summary are authoritative/u);
    assert.match(sticky, /Exact head: `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`/u);
    assert.match(sticky, /Verifier run 7001 attempt 2 https:\/\/github\.com\/owner\/repo\/actions\/runs\/7001/u);
    assert.match(sticky, /completed at 2026-10-04T10:15:30Z/u);
    assert.doesNotMatch(sticky, /Findings:|Review threads:|unknown unresolved/u);
    assert.doesNotMatch(sticky, /@codex review/u);
    assert.equal(
      fixture.github.calls.some(({ path }) =>
        path === "/graphql" || path.includes("/reviews") || path.includes("/reactions")
      ),
      false,
      runConclusion,
    );
    const summary = readFileSync(environment.GITHUB_STEP_SUMMARY, "utf8");
    assert.match(summary, /diagnostic-only snapshot, not the current gating result/u);
    assert.match(summary, /Verifier attempt: \*\*2\*\*/u);
    assert.match(summary, /Observation time: \*\*2026-10-04T10:15:30Z\*\*/u);
    assert.doesNotMatch(summary, /Findings: unknown|Review threads: unknown/u);
  }
});

test("report-completion accepts the canonical verifier path qualified by a ref", async (context) => {
  const path = `.github/workflows/codex-review-gate.yml@refs/pull/${PR}/merge`;
  const fixture = completionRuntimeFixture({
    currentRunOverrides: { path },
    attemptOverrides: { path },
    eventRunOverrides: { path },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "report-completion-qualified-verifier-path",
    operation: "report-completion",
    eventName: "workflow_run",
    requestReview: "false",
    prNumber: 0,
    event: fixture.event,
  });

  const { result } = await runGate(environment, fixture.github);

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.gateOutcome, "success");
  assert.equal(fixture.github.stickyCreates.length, 1);
  assert.deepEqual(fixture.github.rerunRequests, []);
  assert.deepEqual(fixture.github.requestBodies, []);
});

test("report-completion does not infer a pass from missing or nonunique required checks", async (context) => {
  for (const [suffix, jobCount] of [["missing", 0], ["nonunique", 2]]) {
    const fixture = completionRuntimeFixture({ jobCount });
    const environment = runtimeEnvironment(context, {
      suffix: `report-completion-${suffix}-check`,
      operation: "report-completion",
      eventName: "workflow_run",
      requestReview: "false",
      prNumber: 0,
      event: fixture.event,
    });

    const { result } = await runGate(environment, fixture.github);

    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.counts.unresolved, "unknown", suffix);
    assert.equal(result.report.reviewThreads.status, "not_read", suffix);
    assert.equal(fixture.github.stickyCreates.length, 1, suffix);
    assert.deepEqual(fixture.github.stickyPatches, [], suffix);
    assert.equal(
      fixture.github.calls.some(({ path }) => path.includes("/check-runs/")),
      false,
      suffix,
    );
    assert.match(fixture.github.stickyCreates[0], /not the current gating result/u);
    assert.doesNotMatch(fixture.github.stickyCreates[0], /Findings:|Review threads:/u);
  }
});

test("report-completion patches one old canonical diagnostic but never trusts a malformed marker", async (context) => {
  const historical = canonicalStickyComment({ id: 301 });
  const fixture = completionRuntimeFixture({
    issueComments: [historical],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "report-completion-patch-old",
    operation: "report-completion",
    eventName: "workflow_run",
    requestReview: "false",
    prNumber: 0,
    event: fixture.event,
  });

  const { result } = await runGate(environment, fixture.github);

  assert.equal(result.report.gateOutcome, "success");
  assert.equal(fixture.github.stickyCreates.length, 0);
  assert.equal(fixture.github.stickyPatches.length, 1);
  assert.equal(fixture.github.stickyPatches[0].id, "301");
  assert.match(fixture.github.stickyPatches[0].body, /Diagnostic-only verifier observation/u);
  assert.doesNotMatch(fixture.github.stickyPatches[0].body, /Findings:|Review threads:/u);

  const malformed = {
    ...historical,
    body: historical.body.replace(
      `\n\n<!-- ${V2_STICKY_MARKER} -->`,
      `\n\nEdited visible presentation\n\n<!-- ${V2_STICKY_MARKER} -->`,
    ),
  };
  const malformedFixture = completionRuntimeFixture({ issueComments: [malformed] });
  const malformedEnvironment = runtimeEnvironment(context, {
    suffix: "report-completion-malformed-marker",
    operation: "report-completion",
    eventName: "workflow_run",
    requestReview: "false",
    prNumber: 0,
    event: malformedFixture.event,
  });
  const { result: malformedResult } = await runGate(
    malformedEnvironment,
    malformedFixture.github,
  );
  assert.equal(malformedResult.report.gateOutcome, "success");
  assert.deepEqual(malformedFixture.github.stickyCreates, []);
  assert.deepEqual(malformedFixture.github.stickyPatches, []);

  const associated = completionRuntimeFixture({
    pullRequests: verifierRun().pull_requests,
  });
  const associatedEnvironment = runtimeEnvironment(context, {
    suffix: "report-completion-associated-repo-ref",
    operation: "report-completion",
    eventName: "workflow_run",
    requestReview: "false",
    event: associated.event,
  });
  const { result: associatedResult } = await runGate(
    associatedEnvironment,
    associated.github,
  );
  assert.equal(associatedResult.report.gateOutcome, "success");
  assert.equal(associated.github.stickyCreates.length, 1);
});

test("report-completion rejects dispatch and does not persist a stale head/base/attempt", async (context) => {
  const dispatchGithub = createGitHubMock();
  const dispatchEnvironment = runtimeEnvironment(context, {
    suffix: "report-completion-dispatch-rejected",
    operation: "report-completion",
    eventName: "workflow_dispatch",
    requestReview: "false",
  });
  const { result: dispatch } = await runGate(dispatchEnvironment, dispatchGithub);
  assert.equal(dispatch.report.gateOutcome, "not_applicable");
  assert.deepEqual(dispatchGithub.calls, []);

  const staleCases = [
    ["head", { pullRequestSequence: [{}, { head: { sha: NEXT_HEAD } }] }],
    ["base", { pullRequestSequence: [{}, { base: { sha: NEXT_HEAD } }] }],
  ];
  for (const [suffix, githubOptions] of staleCases) {
    const fixture = completionRuntimeFixture(githubOptions);
    const environment = runtimeEnvironment(context, {
      suffix: `report-completion-stale-${suffix}`,
      operation: "report-completion",
      eventName: "workflow_run",
      requestReview: "false",
      prNumber: 0,
      event: fixture.event,
    });
    const { result } = await runGate(environment, fixture.github);
    assert.equal(result.report.gateOutcome, "not_applicable", suffix);
    assert.deepEqual(fixture.github.stickyCreates, [], suffix);
    assert.deepEqual(fixture.github.stickyPatches, [], suffix);
    assert.deepEqual(fixture.github.requestBodies, [], suffix);
    assert.deepEqual(fixture.github.rerunRequests, [], suffix);
  }

  const oldSuccess = completionRuntimeFixture({
    currentRunOverrides: {
      run_attempt: 3,
      status: "in_progress",
      conclusion: null,
      updated_at: "2026-10-04T10:20:00Z",
    },
  });
  const oldSuccessEnvironment = runtimeEnvironment(context, {
    suffix: "report-completion-stale-attempt",
    operation: "report-completion",
    eventName: "workflow_run",
    requestReview: "false",
    prNumber: 0,
    event: oldSuccess.event,
  });
  const { result: staleAttempt } = await runGate(oldSuccessEnvironment, oldSuccess.github);
  assert.equal(staleAttempt.report.gateOutcome, "not_applicable");
  assert.deepEqual(oldSuccess.github.stickyCreates, []);
  assert.deepEqual(oldSuccess.github.stickyPatches, []);
});

test("failed first-attempt workflow_run requests Codex once without rerunning the verifier", async (context) => {
  const github = createGitHubMock();
  const environment = runtimeEnvironment(context, {
    suffix: "auto-request-first-attempt",
    eventName: "workflow_run",
    operation: "begin-review",
  });

  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_provider");
  assert.deepEqual(github.requestBodies, [canonicalRequestBody()]);
  assert.deepEqual(github.rerunRequests, []);
  assert.equal(github.stickyCreates.length, 0);
  assert.ok(github.calls.some(({ method, path }) =>
    method === "GET" &&
    path === `/repos/${REPOSITORY}/actions/workflows/codex-review-gate.yml`
  ));
  assert.ok(github.calls.some(({ method, path }) =>
    method === "GET" && path === `/repos/${REPOSITORY}/actions/runs/7001`
  ));
});

test("auto request accepts the canonical verifier path qualified by a ref", async (context) => {
  const path = `.github/workflows/codex-review-gate.yml@refs/pull/${PR}/merge`;
  const run = verifierRun({ path });
  const github = createGitHubMock({
    verifierRuns: [run],
    verifierRunAttempts: [run],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "auto-request-qualified-verifier-path",
    eventName: "workflow_run",
    operation: "begin-review",
    event: workflowRunEvent(run),
  });

  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.gateOutcome, "pending");
  assert.deepEqual(github.requestBodies, [canonicalRequestBody()]);
  assert.deepEqual(github.rerunRequests, []);
});

test("auto request requires the exact lowercase true repository-variable mapping", async (context) => {
  for (const value of ["true", "TRUE", "True", "false", "", undefined]) {
    const github = createGitHubMock();
    const environment = runtimeEnvironment(context, {
      suffix: `auto-request-variable-${value ?? "unset"}`,
      eventName: "workflow_run",
      operation: "begin-review",
    });
    if (value === undefined) {
      delete environment.CODEX_REVIEW_GATE_AUTO_REQUEST;
    } else {
      environment.CODEX_REVIEW_GATE_AUTO_REQUEST = value;
    }

    const { result } = await runGate(environment, github);

    if (value === "true") {
      assert.equal(result.exitCode, 0);
      assert.equal(result.report.executionHealth, "healthy");
      assert.equal(result.report.gateOutcome, "pending");
      assert.deepEqual(github.requestBodies, [canonicalRequestBody()]);
    } else {
      assert.equal(result.exitCode, 1, String(value));
      assert.equal(result.report.gateOutcome, "not_applicable", String(value));
      assert.equal(result.report.recoveryCode, "unsupported_target", String(value));
      assert.deepEqual(github.calls, [], String(value));
      assert.deepEqual(github.requestBodies, [], String(value));
    }
    assert.deepEqual(github.rerunRequests, [], String(value));
  }
});

test("auto request adopts an exact-head/base canonical marker from another run", async (context) => {
  const github = createGitHubMock({
    issueComments: [workflowRequest({
      body: canonicalRequestBody(HEAD, { runId: "77" }),
    })],
    verifierRuns: [verifierRun({
      run_attempt: 2,
      status: "in_progress",
      conclusion: null,
    })],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "auto-request-cross-run-adoption",
    eventName: "workflow_run",
    operation: "begin-review",
  });

  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.gateOutcome, "pending");
  assert.match(result.report.reason, /review request 101 is adopted/iu);
  assert.deepEqual(github.requestBodies, []);
  assert.deepEqual(github.rerunRequests, []);
});

test("auto request adopts multiple cross-run markers without a third request", async (context) => {
  const github = createGitHubMock({
    issueComments: [
      workflowRequest({ id: 101, body: canonicalRequestBody(HEAD, { runId: "77" }) }),
      workflowRequest({ id: 102, body: canonicalRequestBody(HEAD, { runId: "88" }) }),
    ],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "auto-request-cross-run-duplicates",
    eventName: "workflow_run",
    operation: "begin-review",
  });

  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_provider");
  assert.equal(result.report.retrySafe, false);
  assert.match(result.report.reason, /review request 101 is duplicates/iu);
  assert.deepEqual(github.requestBodies, []);
  assert.deepEqual(github.rerunRequests, []);
});

test("auto request rejects stale PR head and same-head base movement", async (context) => {
  for (const [suffix, pullRequestOverrides] of [
    ["head", { head: { sha: NEXT_HEAD } }],
    ["base-sha", { base: { sha: NEXT_HEAD } }],
  ]) {
    const github = createGitHubMock({ pullRequestOverrides });
    const environment = runtimeEnvironment(context, {
      suffix: `auto-request-stale-${suffix}`,
      eventName: "workflow_run",
      operation: "begin-review",
    });

    const { result } = await runGate(environment, github);

    assert.equal(result.exitCode, suffix === "head" ? 1 : 0, suffix);
    assert.equal(result.report.gateOutcome, "not_applicable", suffix);
    assert.equal(result.report.recoveryCode, "refresh_head", suffix);
    assert.deepEqual(github.requestBodies, [], suffix);
    assert.deepEqual(github.rerunRequests, [], suffix);
  }
});

test("auto request rechecks branch and default-base scope immediately before POST", async (context) => {
  for (const [suffix, options] of [
    ["head-ref", { pullRequestSequence: [{}, { head: { ref: "replaced" } }] }],
    ["default-branch", { repositorySequence: [{}, { default_branch: "release" }] }],
  ]) {
    const github = createGitHubMock(options);
    const environment = runtimeEnvironment(context, {
      suffix: `auto-request-pre-post-${suffix}`,
      eventName: "workflow_run",
      operation: "begin-review",
    });

    const { result } = await runGate(environment, github);

    assert.equal(result.exitCode, 0, suffix);
    assert.equal(result.report.gateOutcome, "not_applicable", suffix);
    assert.equal(result.report.recoveryCode, "refresh_head", suffix);
    assert.deepEqual(github.requestBodies, [], suffix);
    assert.deepEqual(github.rerunRequests, [], suffix);
  }
});

test("auto request requires a protected default-branch controller launch", async (context) => {
  const github = createGitHubMock();
  const environment = runtimeEnvironment(context, {
    suffix: "auto-request-unprotected-launch",
    eventName: "workflow_run",
    operation: "begin-review",
  });
  environment.GITHUB_REF = "refs/heads/feature";

  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.gateOutcome, "not_applicable");
  assert.equal(result.report.recoveryCode, "unsupported_target");
  assert.deepEqual(github.requestBodies, []);
  assert.deepEqual(github.rerunRequests, []);
});

test("auto request rejects wrong event source and non-first verifier attempts", async (context) => {
  for (const [suffix, event] of [
    ["wrong-action", workflowRunEvent(verifierRun(), { action: "requested" })],
    ["wrong-event", workflowRunEvent(verifierRun({ event: "push" }))],
    ["not-failure", workflowRunEvent(verifierRun({ conclusion: "success" }))],
    ["rerun-attempt", workflowRunEvent(verifierRun({ run_attempt: 2 }))],
    ["wrong-workflow", workflowRunEvent(verifierRun({ path: ".github/workflows/other.yml" }))],
    ["wrong-repository", workflowRunEvent(verifierRun({
      repository: { id: 9, full_name: "other/repo" },
    }))],
    ["two-prs", workflowRunEvent(verifierRun({
      pull_requests: [verifierRun().pull_requests[0], {
        ...verifierRun().pull_requests[0],
        number: PR + 1,
      }],
    }))],
    ["wrong-pr", workflowRunEvent(verifierRun({
      pull_requests: [{ ...verifierRun().pull_requests[0], number: PR + 1 }],
    }))],
  ]) {
    const github = createGitHubMock();
    const environment = runtimeEnvironment(context, {
      suffix: `auto-request-invalid-${suffix}`,
      eventName: "workflow_run",
      operation: "begin-review",
      event,
    });

    const { result } = await runGate(environment, github);

    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.gateOutcome, "not_applicable", suffix);
    assert.deepEqual(github.requestBodies, [], suffix);
    assert.deepEqual(github.rerunRequests, [], suffix);
  }
});

test("auto request refetch rejects changed workflow, run, and PR association", async (context) => {
  for (const [suffix, options] of [
    ["workflow-id", {
      requestInterceptor: ({ method, path }) =>
        method === "GET" &&
        path === `/repos/${REPOSITORY}/actions/workflows/codex-review-gate.yml`
          ? jsonResponse({
              id: 6002,
              name: "Codex Review Gate Verifier",
              path: ".github/workflows/codex-review-gate.yml",
            })
          : undefined,
    }],
    ["run-workflow-id", { verifierRuns: [verifierRun({ workflow_id: 6002 })] }],
    ["run-source", { verifierRuns: [verifierRun({ event: "push" })] }],
    ["first-attempt-success", {
      verifierRunAttempts: [verifierRun({ conclusion: "success" })],
    }],
    ["current-merge-changed", {
      pullRequestOverrides: { merge_commit_sha: NEXT_HEAD },
    }],
    ["live-association-advanced", { verifierRuns: [verifierRun({
      pull_requests: [{
        ...verifierRun().pull_requests[0],
        head: { ...verifierRun().pull_requests[0].head, sha: NEXT_HEAD },
      }],
    })] }],
    ["run-base-ref", { verifierRuns: [verifierRun({
      pull_requests: [{
        ...verifierRun().pull_requests[0],
        base: { ...verifierRun().pull_requests[0].base, ref: "release" },
      }],
    })] }],
    ["run-base-repository", { verifierRuns: [verifierRun({
      pull_requests: [{
        ...verifierRun().pull_requests[0],
        base: {
          ...verifierRun().pull_requests[0].base,
          repo: { id: 9, full_name: "other/repo" },
        },
      }],
    })] }],
    ["run-base-repository-url", { verifierRuns: [verifierRun({
      pull_requests: [{
        ...verifierRun().pull_requests[0],
        base: {
          ...verifierRun().pull_requests[0].base,
          repo: {
            ...verifierRun().pull_requests[0].base.repo,
            url: "https://api.github.com/repos/other/repo",
          },
        },
      }],
    })] }],
  ]) {
    const github = createGitHubMock(options);
    const environment = runtimeEnvironment(context, {
      suffix: `auto-request-refetch-${suffix}`,
      eventName: "workflow_run",
      operation: "begin-review",
    });

    const { result } = await runGate(environment, github);

    assert.equal(result.exitCode, 0, suffix);
    assert.equal(result.report.gateOutcome, "not_applicable", suffix);
    assert.deepEqual(github.requestBodies, [], suffix);
    assert.deepEqual(github.rerunRequests, [], suffix);
  }
});

test("auto request preserves an exact failed attempt 1 across same-run retries", async (context) => {
  for (const [suffix, latestAttempt] of [
    ["running", { run_attempt: 2, status: "in_progress", conclusion: null }],
    ["failed", { run_attempt: 2, status: "completed", conclusion: "failure" }],
  ]) {
    const github = createGitHubMock({
      verifierRuns: [verifierRun(latestAttempt)],
    });
    const environment = runtimeEnvironment(context, {
      suffix: `auto-request-same-run-${suffix}`,
      eventName: "workflow_run",
      operation: "begin-review",
    });

    const { result } = await runGate(environment, github);

    assert.equal(result.exitCode, 0, suffix);
    assert.equal(result.report.executionHealth, "healthy", suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.deepEqual(github.requestBodies, [canonicalRequestBody()], suffix);
    assert.deepEqual(github.rerunRequests, [], suffix);
    assert.ok(github.calls.some(({ method, path }) =>
      method === "GET" &&
      path === `/repos/${REPOSITORY}/actions/runs/7001/attempts/1`
    ), suffix);
  }
});

test("auto request fails closed when a later same-run attempt succeeds or is inconclusive", async (context) => {
  for (const [suffix, latestAttempt] of [
    ["success", { run_attempt: 2, status: "completed", conclusion: "success" }],
    ["cancelled", { run_attempt: 2, status: "completed", conclusion: "cancelled" }],
    ["timed-out", { run_attempt: 2, status: "completed", conclusion: "timed_out" }],
    ["unknown-status", { run_attempt: 2, status: "unknown", conclusion: null }],
  ]) {
    const github = createGitHubMock({
      verifierRuns: [verifierRun(latestAttempt)],
    });
    const environment = runtimeEnvironment(context, {
      suffix: `auto-request-same-run-${suffix}`,
      eventName: "workflow_run",
      operation: "begin-review",
    });

    const { result } = await runGate(environment, github);

    assert.equal(result.exitCode, 0, suffix);
    assert.equal(result.report.gateOutcome, "not_applicable", suffix);
    assert.deepEqual(github.requestBodies, [], suffix);
    assert.deepEqual(github.rerunRequests, [], suffix);
  }
});

test("late failed workflow_run cannot request after a newer same-head verifier", async (context) => {
  const github = createGitHubMock({
    verifierRuns: [
      verifierRun(),
      verifierRun({ id: 7002, run_number: 42, conclusion: "success" }),
    ],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "auto-request-superseded",
    eventName: "workflow_run",
    operation: "begin-review",
  });

  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.gateOutcome, "not_applicable");
  assert.match(result.report.reason, /no longer the current canonical verifier/iu);
  assert.deepEqual(github.requestBodies, []);
  assert.deepEqual(github.rerunRequests, []);
});

test("newer verifier appearing only in the pre-POST inventory suppresses auto request", async (context) => {
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
      return jsonResponse(inventoryReads === 1
        ? { total_count: 1, workflow_runs: [verifierRun()] }
        : {
            total_count: 2,
            workflow_runs: [
              verifierRun(),
              verifierRun({ id: 7002, run_number: 42, conclusion: "success" }),
            ],
          });
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "auto-request-pre-post-newer-run",
    eventName: "workflow_run",
    operation: "begin-review",
  });

  const { result } = await runGate(environment, github);

  assert.equal(inventoryReads, 2);
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.gateOutcome, "not_applicable");
  assert.equal(result.report.recoveryCode, "refresh_head");
  assert.match(result.report.reason, /no longer the current canonical verifier/iu);
  assert.deepEqual(github.requestBodies, []);
  assert.deepEqual(github.rerunRequests, []);
});

test("unknown auto-request POST is adopted only on exact readback and never reruns", async (context) => {
  for (const [suffix, postUnknownReread, expectedExit] of [
    ["visible", "visible", 0],
    ["hidden", "hidden", 1],
  ]) {
    const github = createGitHubMock({ postUnknownAfterCreate: true, postUnknownReread });
    const environment = runtimeEnvironment(context, {
      suffix: `auto-request-post-unknown-${suffix}`,
      eventName: "workflow_run",
      operation: "begin-review",
    });

    const { result } = await runGate(environment, github);

    assert.equal(result.exitCode, expectedExit, suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, expectedExit === 0 ? "wait_provider" : "retry_begin");
    assert.equal(result.report.retrySafe, false, suffix);
    assert.equal(github.requestBodies.length, 1, suffix);
    assert.deepEqual(github.rerunRequests, [], suffix);
    assert.deepEqual(github.stickyCreates, [], suffix);
  }
});

test("unknown auto POST can adopt another run's visible exact-scope marker without retry", async (context) => {
  const github = createGitHubMock({
    postUnknownAfterCreate: true,
    postUnknownReread: "hidden",
    postUnknownConcurrentComments: [workflowRequest({
      body: canonicalRequestBody(HEAD, { runId: "77" }),
    })],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "auto-request-unknown-other-run-visible",
    eventName: "workflow_run",
    operation: "begin-review",
  });

  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.executionHealth, "healthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_provider");
  assert.equal(result.report.retrySafe, false);
  assert.match(result.report.reason, /review request 101 is adopted-after-unknown/iu);
  assert.deepEqual(github.requestBodies, [canonicalRequestBody()]);
  assert.deepEqual(github.rerunRequests, []);
});

test("begin-review does not adopt an existing same-second edited canonical request", async (context) => {
  const edited = workflowRequest({
    last_edited_at: "2026-08-25T08:00:00.500Z",
    graphql_updated_at: "2026-08-25T08:00:00.500Z",
  });
  const github = createGitHubMock({ issueComments: [edited] });
  const environment = runtimeEnvironment(context, {
    suffix: "begin-existing-same-second-edit",
    operation: "begin-review",
  });

  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "wait_provider");
  assert.deepEqual(github.requestBodies, [canonicalRequestBody()]);
  assert.equal(
    github.calls.some(({ path, body }) =>
      path === "/graphql" &&
      body?.query?.includes("CodexReviewGateDeletedComments") &&
      body.query.includes("lastEditedAt")
    ),
    true,
  );
});

for (const [suffix, postUnknownAfterCreate] of [
  ["created-refetch", false],
  ["unknown-post-reread", true],
]) {
  test(`begin-review rejects a same-second edited request on ${suffix}`, async (context) => {
    const github = createGitHubMock({
      postUnknownAfterCreate,
      createdCommentOverrides: {
        last_edited_at: "2026-08-25T09:00:00.500Z",
        graphql_updated_at: "2026-08-25T09:00:00.500Z",
      },
    });
    const environment = runtimeEnvironment(context, {
      suffix: `begin-same-second-edit-${suffix}`,
      operation: "begin-review",
    });

    const { result } = await runGate(environment, github);

    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.executionHealth, "unhealthy", suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "retry_begin", suffix);
    assert.equal(result.report.retrySafe, false, suffix);
    assert.equal(github.requestBodies.length, 1, suffix);
    assert.equal(
      github.calls.some(({ path, body }) =>
        path === "/graphql" &&
        body?.query?.includes("CodexReviewGateDeletedComments") &&
        body.query.includes("lastEditedAt")
      ),
      true,
      suffix,
    );
  });
}

test("begin-review cannot forget an edit observed before post-verification fallback", async (context) => {
  const editedAt = "2026-08-25T09:00:00.500Z";
  const github = createGitHubMock({
    deletedCommentResponseMutator: (response, { snapshotIndex }) => {
      if (snapshotIndex !== 1) return response;
      const mutated = structuredClone(response);
      const created = mutated.data.repository.pullRequest.comments.nodes.find(
        ({ databaseId }) => databaseId === "10000",
      );
      if (created) {
        created.updatedAt = editedAt;
        created.lastEditedAt = editedAt;
      }
      return mutated;
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "begin-post-verification-edit-rollback",
    operation: "begin-review",
  });

  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "retry_begin");
  assert.equal(result.report.retrySafe, false);
  assert.equal(github.requestBodies.length, 1);
  assert.match(
    result.report.reason,
    /(?:edit metadata.*10000.*moved backwards|(?:graphql )?issue-comment 10000 (?:changed|updatedAt changed))/iu,
  );
});

test("begin-review cannot replace a previously observed deletion identity", async (context) => {
  const first = deletedCommentEvent({ id: "CDE_begin_E" });
  const replacement = deletedCommentEvent({
    id: "CDE_begin_F",
    createdAt: "2026-08-25T08:03:00Z",
  });
  for (const [suffix, options] of [
    ["post-create-history", {}],
    ["known-post-fallback", { failDirectHistory: true }],
    ["unknown-post-fallback", { postUnknownAfterCreate: true }],
  ]) {
    let historyRequests = 0;
    const github = createGitHubMock({
      deletedCommentEventSnapshots: [
        [first],
        [replacement],
        [replacement],
        [replacement],
      ],
      postUnknownAfterCreate: options.postUnknownAfterCreate === true,
      requestInterceptor: options.failDirectHistory
        ? ({ method, path, body }) => {
            if (
              method !== "POST" ||
              path !== "/graphql" ||
              !body?.query?.includes("CodexReviewGateDeletedComments")
            ) {
              return undefined;
            }
            historyRequests += 1;
            if (historyRequests >= 2 && historyRequests <= 4) {
              return jsonResponse({ message: "synthetic history transport failure" }, 502);
            }
            return undefined;
          }
        : null,
    });
    const environment = runtimeEnvironment(context, {
      suffix: `begin-deletion-identity-${suffix}`,
      operation: "begin-review",
    });

    const { result } = await runGate(environment, github);

    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.executionHealth, "unhealthy", suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "retry_begin", suffix);
    assert.equal(result.report.retrySafe, false, suffix);
    assert.equal(github.requestBodies.length, 1, suffix);
    assert.match(
      result.report.reason,
      /CDE_begin_E.*disappeared from later inventory/iu,
      suffix,
    );
  }
});

test("begin-review latches identical history duplicates before a top-level GraphQL failure", async (context) => {
  const oldDeletion = deletedCommentEvent({
    id: "CDE_begin_duplicate",
    createdAt: "2026-08-25T07:00:00Z",
  });
  for (const [suffix, options, expectedReason] of [
    ["issue-comment", {}, /issue-comment 10000 appeared more than once/iu],
    ["deleted-comment", {
      deletedCommentEvents: [oldDeletion],
    }, /deleted-comment event CDE_begin_duplicate appeared more than once/iu],
  ]) {
    const github = createGitHubMock({
      ...options,
      deletedCommentResponseMutator: (response, { snapshotIndex }) => {
        if (snapshotIndex !== 1) return response;
        const mutated = structuredClone(response);
        const connection = suffix === "issue-comment"
          ? mutated.data.repository.pullRequest.comments
          : mutated.data.repository.pullRequest.timelineItems;
        connection.nodes.push(structuredClone(connection.nodes[0]));
        mutated.errors = [{ message: "synthetic partial GraphQL failure" }];
        return mutated;
      },
    });
    const environment = runtimeEnvironment(context, {
      suffix: `begin-identical-history-duplicate-${suffix}`,
      operation: "begin-review",
    });

    const { result } = await runGate(environment, github);

    assert.equal(result.exitCode, 1, suffix);
    assert.equal(result.report.executionHealth, "unhealthy", suffix);
    assert.equal(result.report.gateOutcome, "pending", suffix);
    assert.equal(result.report.recoveryCode, "retry_begin", suffix);
    assert.equal(result.report.retrySafe, false, suffix);
    assert.equal(github.requestBodies.length, 1, suffix);
    assert.match(result.report.reason, expectedReason, suffix);
  }
});

test("begin-review latches created exact-refetch content before history transport failure", async (context) => {
  let historyRequests = 0;
  let createdRefetches = 0;
  const github = createGitHubMock({
    commentRefetchMutator: (comment) => {
      if (String(comment.id) !== "10000") return comment;
      createdRefetches += 1;
      return createdRefetches === 1
        ? { ...comment, body: "synthetic tampered created request" }
        : comment;
    },
    requestInterceptor: ({ method, path, body }) => {
      if (
        method !== "POST" ||
        path !== "/graphql" ||
        !body?.query?.includes("CodexReviewGateDeletedComments")
      ) {
        return undefined;
      }
      historyRequests += 1;
      if (historyRequests >= 2 && historyRequests <= 4) {
        return jsonResponse({ message: "synthetic history transport failure" }, 502);
      }
      return undefined;
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "begin-created-refetch-before-history-failure",
    operation: "begin-review",
  });

  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "retry_begin");
  assert.equal(result.report.retrySafe, false);
  assert.equal(github.requestBodies.length, 1);
  assert.match(
    result.report.reason,
    /Previously observed rest issue-comment 10000 changed/iu,
  );
});

test("begin-review cannot replace a known created id with another same-run marker", async (context) => {
  const tamperedCreated = workflowRequest({
    id: 10_000,
    body: "synthetic tampered created request",
    created_at: "2026-08-25T09:00:00Z",
    updated_at: "2026-08-25T09:00:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-10000`,
  });
  const alternate = workflowRequest({
    id: 10_001,
    created_at: "2026-08-25T09:00:01Z",
    updated_at: "2026-08-25T09:00:01Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-10001`,
  });
  let historyRequests = 0;
  const github = createGitHubMock({
    issueCommentSnapshots: [
      [],
      [tamperedCreated, alternate],
      [tamperedCreated, alternate],
    ],
    pullRequestOverrides: { comments: 0 },
    commentRefetchMutator: (comment) =>
      String(comment.id) === "10000" ? tamperedCreated : comment,
    requestInterceptor: ({ method, path, body }) => {
      if (
        method !== "POST" ||
        path !== "/graphql" ||
        !body?.query?.includes("CodexReviewGateDeletedComments")
      ) {
        return undefined;
      }
      historyRequests += 1;
      if (historyRequests >= 2 && historyRequests <= 4) {
        return jsonResponse({ message: "synthetic history transport failure" }, 502);
      }
      return undefined;
    },
  });
  const environment = runtimeEnvironment(context, {
    suffix: "begin-created-id-cannot-be-substituted",
    operation: "begin-review",
  });

  const { result } = await runGate(environment, github);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.executionHealth, "unhealthy");
  assert.equal(result.report.gateOutcome, "pending");
  assert.equal(result.report.recoveryCode, "retry_begin");
  assert.equal(result.report.retrySafe, false);
  assert.equal(github.requestBodies.length, 1);
  assert.match(result.report.reason, /POST visibility remains unknown/iu);
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
    {
      suffix: "begin-created-final-scope-closed",
      options: {
        pullRequestSequence: [{}, {}, { state: "closed" }],
      },
    },
    {
      suffix: "begin-created-final-scope-draft",
      options: {
        pullRequestSequence: [{}, {}, { draft: true }],
      },
    },
    {
      suffix: "begin-created-final-scope-test-merge-changed",
      options: {
        pullRequestSequence: [{}, {}, { merge_commit_sha: NEXT_HEAD }],
      },
    },
    {
      suffix: "begin-created-final-scope-base-changed",
      options: {
        pullRequestSequence: [{}, {}, { base: { sha: NEXT_HEAD } }],
      },
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
    const summary = readFileSync(environment.GITHUB_STEP_SUMMARY, "utf8");
    assert.match(summary, /Wait for the exact same-run request marker to settle/u, suffix);
    assert.doesNotMatch(summary, /Retry the identical exact-head begin-review invocation/u, suffix);
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
  assert.equal(unknown.report.executionHealth, "healthy");
  assert.equal(unknown.report.gateOutcome, "not_applicable");
  assert.equal(unknown.report.recoveryCode, "refresh_head");
  assert.equal(unknown.report.retrySafe, false);
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

test("canonical sticky diagnostics remain immutable and never multiply", async (context) => {
  const lowerIdButNewer = canonicalStickyComment({
    id: 301,
    created_at: "2026-08-25T09:00:00Z",
    updated_at: "2026-08-25T09:00:00Z",
  });
  const higherIdButOlder = canonicalStickyComment({
    id: 302,
    created_at: "2026-08-25T07:00:00Z",
    updated_at: "2026-08-25T07:00:00Z",
  });
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
  assert.deepEqual(github.stickyPatches, []);
  assert.equal(github.stickyCreates.length, 0);
  assert.equal(warnings.length, 1);
  assert.equal(
    warnings[0],
    "Found 2 canonical v2 sticky diagnostics; preserving them without mutation",
  );
  assert.equal(warnings[0].length < 160, true);
  assert.equal(github.calls.some(({ method }) => method === "DELETE"), false);
});

test("controller diagnostics cannot edit themselves into later review boundaries", async (context) => {
  const historicalSticky = canonicalStickyComment({
    id: 301,
    stickyHeadSha: BASE,
    created_at: "2026-08-25T07:30:00Z",
    updated_at: "2026-08-25T07:30:00Z",
  });
  const github = createGitHubMock({
    issueComments: [workflowRequest(), historicalSticky],
    reactionsByCommentId: new Map([["101", [reaction()]]]),
  });
  const controllerEnvironment = runtimeEnvironment(context, {
    suffix: "immutable-sticky-controller",
    eventName: "workflow_dispatch",
  });
  const { result: controller } = await runGate(controllerEnvironment, github);
  assert.equal(controller.exitCode, 0);
  assert.equal(controller.report.gateOutcome, "pending");
  assert.deepEqual(github.stickyPatches, []);
  assert.equal(github.stickyCreates.length, 0);

  const verifierEnvironment = runtimeEnvironment(context, {
    suffix: "immutable-sticky-verifier",
  });
  const { result: verifier } = await runGate(verifierEnvironment, github);
  assert.equal(verifier.exitCode, 0);
  assert.equal(verifier.report.executionHealth, "healthy");
  assert.equal(verifier.report.gateOutcome, "success");
  assert.equal(verifier.report.counts.indeterminate, 0);
  assert.equal(verifier.report.requiresReplacementPr, false);
  assert.match(verifier.report.reason, /request-reaction 501/u);
  assert.deepEqual(github.stickyPatches, []);
  assert.equal(github.stickyCreates.length, 0);
});

test("sticky creation fresh-reads after a stale controller comment snapshot", async (context) => {
  const request = workflowRequest();
  const interveningSticky = canonicalStickyComment({
    id: 301,
    created_at: "2026-08-25T08:30:00Z",
    updated_at: "2026-08-25T08:30:00Z",
  });
  const github = createGitHubMock({
    issueComments: [request],
    issueCommentSnapshots: [
      [request],
      [request, interveningSticky],
    ],
  });
  const environment = runtimeEnvironment(context, {
    suffix: "fresh-sticky-create-suppression",
    operation: "begin-review",
  });
  const { result } = await runGate(environment, github);
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.gateOutcome, "pending");
  assert.deepEqual(github.requestBodies, []);
  assert.deepEqual(github.stickyPatches, []);
  assert.equal(github.stickyCreates.length, 0);
  assert.equal(
    github.calls.filter(({ method, path }) =>
      method === "GET" && path === `/repos/${REPOSITORY}/issues/${PR}/comments`
    ).length,
    2,
  );
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

test("review-thread paths use code-span delimiters beyond embedded backticks", (context) => {
  const paths = [
    "src/internal`tick.mjs",
    "`leading-backtick.mjs",
    "trailing-backtick.mjs`",
    "src/multiple``runs```inside.mjs",
    "src/`[active](https://attacker.example)<script>@codex review</script>`",
  ];
  const report = buildV2GateReport({
    executionHealth: "healthy",
    gateOutcome: "pending",
    reason: "Unresolved review threads",
    recoveryCode: "wait_then_reconcile",
    reviewThreads: {
      status: "complete",
      unresolved: paths.length,
      resolved: 0,
      total: paths.length,
      diagnostics: paths.map((path) => ({ path, isOutdated: false, url: null })),
    },
  });
  const sticky = buildV2StickyCommentBody(report, {
    prNumber: PR,
    headSha: HEAD,
  });
  const environment = runtimeEnvironment(context, { suffix: "thread-path-code-spans" });
  appendV2GateSummary(environment.GITHUB_STEP_SUMMARY, report, {
    prNumber: PR,
    headSha: HEAD,
  });
  const summary = readFileSync(environment.GITHUB_STEP_SUMMARY, "utf8");

  // Verify source-level CommonMark code-span framing; this fixture does not invoke GitHub's renderer.
  for (const path of paths) {
    const longestRun = Math.max(0, ...[...path.matchAll(/`+/gu)].map(([run]) => run.length));
    const delimiter = "`".repeat(longestRun + 1);
    const framedPath = `${delimiter} ${path} ${delimiter}`;
    for (const output of [summary, sticky]) {
      assert.ok(output.includes(framedPath), `path is enclosed by a longer delimiter: ${path}`);
      assert.ok(
        delimiter.length > longestRun,
        `delimiter cannot close inside the path: ${path}`,
      );
    }
  }
});

test("recovery diagnostics route request-clean and finding fixes by proven lineage", async (context) => {
  const generationB = workflowRequest({
    id: 102,
    body: canonicalRequestBody(HEAD, { runId: "124" }),
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const replacementGitHub = createGitHubMock({
    issueComments: [workflowRequest({ id: 101 }), generationB],
    reactionsByCommentId: new Map([["102", [reaction({
      id: 650,
      created_at: "2026-08-25T08:03:00Z",
    })]]]),
  });
  const replacementEnvironment = runtimeEnvironment(context, {
    suffix: "recovery-lineage-replacement-pr",
  });
  const { result: replacement } = await runGate(
    replacementEnvironment,
    replacementGitHub,
  );

  const epoch = baseRefChangedEvent();
  const currentRequest = workflowRequest({
    id: 101,
    created_at: "2026-08-25T08:10:00Z",
    updated_at: "2026-08-25T08:10:00Z",
  });
  const directGitHub = createGitHubMock({
    baseEpoch: epoch,
    issueComments: [currentRequest, cleanIssueComment(HEAD, {
      id: 201,
      created_at: "2026-08-25T08:15:00Z",
      updated_at: "2026-08-25T08:15:00Z",
    })],
  });
  const directEnvironment = runtimeEnvironment(context, {
    suffix: "recovery-lineage-existing-current-request",
  });
  const { result: direct } = await runGate(directEnvironment, directGitHub);

  const generationGitHub = createGitHubMock({ baseEpoch: epoch });
  const generationEnvironment = runtimeEnvironment(context, {
    suffix: "recovery-lineage-create-one-generation",
  });
  const { result: generation } = await runGate(generationEnvironment, generationGitHub);

  const physicalOnlyRequest = ordinaryRequest({
    id: 102,
    user: ACTIONS_BOT,
    created_at: "2026-08-25T08:01:30Z",
    updated_at: "2026-08-25T08:01:30Z",
  });
  const generationC = workflowRequest({
    id: 103,
    body: canonicalRequestBody(HEAD, { runId: "125" }),
    created_at: "2026-08-25T08:03:00Z",
    updated_at: "2026-08-25T08:03:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-103`,
  });
  const findingGapGitHub = createGitHubMock({
    issueComments: [
      workflowRequest({ id: 101 }),
      physicalOnlyRequest,
      progressIssueComment({
        id: 202,
        created_at: "2026-08-25T08:02:30Z",
        updated_at: "2026-08-25T08:02:30Z",
      }),
      generationC,
    ],
    reviews: [findingReview(HEAD, {
      id: 401,
      submitted_at: "2026-08-25T08:02:00Z",
    })],
    reactionsByCommentId: new Map([["103", [reaction({
      id: 651,
      created_at: "2026-08-25T08:04:00Z",
    })]]]),
  });
  const findingGapEnvironment = runtimeEnvironment(context, {
    suffix: "recovery-finding-with-unclosable-lineage",
  });
  const { result: findingGap } = await runGate(
    findingGapEnvironment,
    findingGapGitHub,
  );
  assert.equal(findingGap.report.gateOutcome, "failure");
  assert.equal(findingGap.report.recoveryCode, "fix_findings");
  assert.equal(findingGap.report.requiresReplacementPr, true);

  const diagnostics = (result, environment) => [
    readFileSync(environment.GITHUB_STEP_SUMMARY, "utf8"),
    buildV2StickyCommentBody(result.report, { prNumber: PR, headSha: HEAD }),
  ];
  assert.equal(replacement.report.requiresReplacementPr, true);
  for (const diagnostic of diagnostics(replacement, replacementEnvironment)) {
    assert.match(diagnostic, /do not add another review boundary on the original PR/iu);
    assert.match(diagnostic, /historical lineage cannot be closed safely/iu);
    assert.match(diagnostic, /replacement PR/iu);
    assert.doesNotMatch(diagnostic, /structured lineage is safe to extend/iu);
  }
  for (const [result, environment] of [
    [direct, directEnvironment],
    [generation, generationEnvironment],
  ]) {
    assert.equal(result.report.requiresReplacementPr, false);
    for (const diagnostic of diagnostics(result, environment)) {
      assert.match(diagnostic, /reported request lineage/iu);
      assert.match(diagnostic, /latest current canonical request/iu);
      assert.match(diagnostic, /qualifying direct \+1/iu);
      assert.match(diagnostic, /structured lineage is safe to extend/iu);
      assert.match(diagnostic, /create exactly one canonical generation/iu);
      assert.doesNotMatch(diagnostic, /replacement PR/iu);
    }
  }
  for (const diagnostic of diagnostics(findingGap, findingGapEnvironment)) {
    assert.match(diagnostic, /fix the unresolved Codex findings/iu);
    assert.match(diagnostic, /do not request another generation on the original PR/iu);
    assert.match(diagnostic, /unclosable historical lineage/iu);
    assert.match(diagnostic, /open a replacement PR with the fixes/iu);
    assert.match(diagnostic, /exactly one canonical review generation/iu);
  }
});

test("finding recovery distinguishes authorized ordinary and latest physical-only boundaries", async (context) => {
  const authorizedGitHub = createGitHubMock({
    issueComments: [ordinaryRequest(), findingIssueComment(HEAD)],
  });
  const authorizedEnvironment = runtimeEnvironment(context, {
    suffix: "finding-authorized-ordinary-boundary",
  });
  const { result: authorized } = await runGate(
    authorizedEnvironment,
    authorizedGitHub,
  );

  assert.equal(authorized.report.gateOutcome, "failure");
  assert.equal(authorized.report.recoveryCode, "fix_findings");
  assert.equal(authorized.report.requiresReplacementPr, false, authorized.report.reason);
  const authorizedSummary = readFileSync(
    authorizedEnvironment.GITHUB_STEP_SUMMARY,
    "utf8",
  );
  assert.match(authorizedSummary, /request a new review generation/iu);
  assert.doesNotMatch(authorizedSummary, /replacement PR/iu);

  const physicalOnly = ordinaryRequest({
    id: 102,
    user: ACTIONS_BOT,
    created_at: "2026-08-25T08:02:00Z",
    updated_at: "2026-08-25T08:02:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-102`,
  });
  const physicalGitHub = createGitHubMock({
    issueComments: [
      workflowRequest(),
      findingIssueComment(HEAD, {
        id: 201,
        created_at: "2026-08-25T08:01:00Z",
        updated_at: "2026-08-25T08:01:00Z",
      }),
      physicalOnly,
    ],
  });
  const physicalEnvironment = runtimeEnvironment(context, {
    suffix: "finding-latest-physical-only-boundary",
  });
  physicalEnvironment.CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION = "write";
  const { result: physical } = await runGate(
    physicalEnvironment,
    physicalGitHub,
  );

  assert.equal(physical.report.gateOutcome, "failure");
  assert.equal(physical.report.recoveryCode, "fix_findings");
  assert.equal(physical.report.requiresReplacementPr, true);
  const physicalSummary = readFileSync(
    physicalEnvironment.GITHUB_STEP_SUMMARY,
    "utf8",
  );
  assert.match(physicalSummary, /fix the unresolved Codex findings/iu);
  assert.match(physicalSummary, /replacement PR/iu);
  assert.doesNotMatch(physicalSummary, /request a new review generation/iu);
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

test("direct Action CLI redacts configured token and Bearer values from its report", (context) => {
  for (const [tokenName, token] of [
    ["GITHUB_TOKEN", "cli-github-token-secret"],
    ["INPUT_GITHUB_TOKEN", "cli-input-token-secret"],
  ]) {
    const environment = runtimeEnvironment(context, { suffix: tokenName });
    delete environment.GITHUB_TOKEN;
    delete environment.INPUT_GITHUB_TOKEN;
    environment[tokenName] = token;
    environment.GITHUB_EVENT_NAME = `invalid-token=${token} Bearer ${token}`;
    const childEnvironment = { ...process.env, ...environment };
    delete childEnvironment.GITHUB_TOKEN;
    delete childEnvironment.INPUT_GITHUB_TOKEN;
    childEnvironment[tokenName] = token;
    const child = spawnSync(process.execPath, [V2_RUNTIME_PATH], {
      encoding: "utf8",
      env: childEnvironment,
    });

    assert.equal(child.status, 1, child.stderr);
    const reports = child.stderr
      .split("\n")
      .filter((line) => line.startsWith("[codex-review-gate] "));
    assert.equal(reports.length, 1, child.stderr);
    const report = JSON.parse(reports[0].slice("[codex-review-gate] ".length));
    assert.deepEqual(report, {
      execution_health: "unhealthy",
      gate_outcome: "not_applicable",
      recovery_code: "unsupported_target",
      retry_safe: false,
      findings: {
        unresolved: "unknown",
        resolved: "unknown",
        historical: "unknown",
        indeterminate: "unknown",
      },
      reason: "Unsupported v2 runtime event: invalid-token=[REDACTED] Bearer [REDACTED]",
    });
    assert.equal(child.stderr.includes(token), false, child.stderr);
    assert.match(child.stderr, /\[REDACTED\]/u);
  }
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

function officialReviewSummaryComment({
  id = 290,
  status = "Completed",
  reviewedSha = HEAD,
  body = [
    CODEX_PULL_REQUEST_REVIEW_SUMMARY_MARKER,
    "## Codex Pull Request Review Summary",
    "",
    "| Review | Status | Reviewed commit |",
    "| --- | --- | --- |",
    `| 1 | ${status} | ${reviewedSha ? `\`${reviewedSha}\`` : ""} |`,
    "",
    `Footer: ${status}${reviewedSha ? ` for \`${reviewedSha}\`` : ""}.`,
  ].join("\n"),
  created_at = "2026-08-25T08:00:30Z",
  updated_at = created_at,
  ...overrides
} = {}) {
  return {
    id,
    body,
    created_at,
    updated_at,
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-${id}`,
    user: CODEX_BOT,
    app: CODEX_APP,
    performed_via_github_app: CODEX_APP,
    ...overrides,
  };
}

function recoveryRequest(overrides = {}) {
  return ordinaryRequest({
    id: 301,
    created_at: "2026-08-25T08:11:00Z",
    updated_at: "2026-08-25T08:11:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-301`,
    ...overrides,
  });
}

function recoveryClean(overrides = {}) {
  return cleanIssueComment(HEAD, {
    id: 401,
    created_at: "2026-08-25T08:12:00Z",
    updated_at: "2026-08-25T08:12:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-401`,
    ...overrides,
  });
}

function recoveryEvidence({ request = recoveryRequest(), clean = recoveryClean() } = {}) {
  return [ordinaryRequest(), cleanIssueComment(HEAD), request, clean];
}

function opaqueProviderIssueComment(overrides = {}) {
  return {
    id: 200,
    body: "Codex has started reviewing this pull request.",
    created_at: "2026-08-25T07:59:00Z",
    updated_at: "2026-08-25T07:59:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-200`,
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

function inlineParentReview(commitRef = HEAD, overrides = {}) {
  return {
    id: 403,
    state: "COMMENTED",
    body: [
      "### 💡 Codex Review",
      "",
      "Here are some automated review suggestions for this pull request.",
      "",
      `**Reviewed commit:** \`${commitRef.slice(0, 10)}\``,
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
    ].join("\n"),
    commit_id: commitRef,
    submitted_at: "2026-08-25T08:05:00Z",
    html_url: `https://github.com/${REPOSITORY}/pull/${PR}#pullrequestreview-403`,
    user: CODEX_BOT,
    app: CODEX_APP,
    performed_via_github_app: CODEX_APP,
    ...overrides,
  };
}

function pendingReviewFrom(review, overrides = {}) {
  const pending = {
    ...review,
    ...overrides,
    state: "PENDING",
  };
  delete pending.submitted_at;
  return pending;
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

function canonicalStickyComment({
  stickyHeadSha = BASE,
  stickyReport = buildV2GateReport({
    executionHealth: "healthy",
    gateOutcome: "pending",
    reason: "Historical gate diagnostic",
    recoveryCode: "wait_provider",
  }),
  ...overrides
} = {}) {
  return stickyComment({
    body: buildV2StickyCommentBody(stickyReport, {
      prNumber: PR,
      headSha: stickyHeadSha,
    }),
    ...overrides,
  });
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
    workflow_id: 6001,
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
    repository: { id: REPO_ID, full_name: REPOSITORY },
    head_repository: { id: REPO_ID, full_name: REPOSITORY },
    pull_requests: [{
      number: PR,
      head: { sha: HEAD, repo: {
        id: REPO_ID,
        name: REPO,
        url: `https://api.github.com/repos/${REPOSITORY}`,
      } },
      base: {
        sha: BASE,
        ref: "main",
        repo: {
          id: REPO_ID,
          name: REPO,
          url: `https://api.github.com/repos/${REPOSITORY}`,
        },
      },
    }],
    ...overrides,
  };
}

function verifierSelfRun(overrides = {}) {
  return verifierRun({
    id: 123,
    run_number: 40,
    status: "in_progress",
    conclusion: null,
    created_at: "2026-08-25T07:59:00Z",
    html_url: `https://github.com/${REPOSITORY}/actions/runs/123`,
    ...overrides,
  });
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

function verifierCheckRun({
  status = "queued",
  conclusion = null,
  completed_at = null,
  ...overrides
} = {}) {
  return {
    id: 9001,
    name: V2_REQUIRED_CHECK_NAME,
    head_sha: HEAD,
    status,
    conclusion,
    completed_at,
    app: { id: 15_368, slug: "github-actions" },
    ...overrides,
  };
}

function runtimeEnvironment(context, {
  suffix = "default",
  operation = "reconcile",
  eventName = operation === "begin-review" ? "workflow_dispatch" : "pull_request",
  prNumber = PR,
  requestReview = eventName === "workflow_dispatch" || eventName === "workflow_run"
    ? "true"
    : "false",
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
    ...(eventName === "workflow_run" && operation === "begin-review"
      ? { CODEX_REVIEW_GATE_AUTO_REQUEST: "true" }
      : {}),
    GITHUB_REPOSITORY: REPOSITORY,
    PR_NUMBER: String(prNumber),
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
      : eventName === "workflow_run"
        ? workflowRunEvent()
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

function workflowRunEvent(run = verifierRun(), overrides = {}) {
  return {
    action: "completed",
    repository: { id: REPO_ID, full_name: REPOSITORY, default_branch: "main" },
    workflow_run: structuredClone(run),
    ...overrides,
  };
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

function completionRuntimeFixture({
  runAttempt = 2,
  runConclusion = "success",
  checkStatus = "completed",
  checkConclusion = runConclusion,
  jobCount = 1,
  pullRequests = [],
  issueComments = [],
  pullRequestSequence = null,
  currentRunOverrides = {},
  attemptOverrides = {},
  eventRunOverrides = {},
} = {}) {
  const completedAt = "2026-10-04T10:15:30Z";
  const sourceRun = verifierRun({
    run_attempt: runAttempt,
    status: "completed",
    conclusion: runConclusion,
    updated_at: completedAt,
    pull_requests: structuredClone(pullRequests),
  });
  const currentRun = { ...sourceRun, ...currentRunOverrides };
  const attemptRun = { ...sourceRun, ...attemptOverrides };
  const github = createGitHubMock({
    issueComments,
    pullRequestSequence,
    verifierRuns: [currentRun],
    verifierRunAttempts: [attemptRun],
    verifierAttemptStatus: checkStatus,
    requestInterceptor: ({ method, path }) => {
      if (
        method === "GET" &&
        path === `/repos/${REPOSITORY}/commits/${TEST_MERGE}`
      ) {
        return jsonResponse({
          sha: TEST_MERGE,
          parents: [{ sha: BASE }, { sha: HEAD }],
        });
      }
      if (
        method === "GET" &&
        path === `/repos/${REPOSITORY}/actions/runs/7001/attempts/${runAttempt}/jobs`
      ) {
        const jobs = Array.from({ length: jobCount }, (_, index) => verifierJob({
          id: 8_001 + index,
          runId: 7_001,
          runAttempt,
          status: checkStatus,
          conclusion: checkConclusion,
          check_run_url:
            `https://api.github.com/repos/${REPOSITORY}/check-runs/${9_001 + index}`,
        }));
        return jsonResponse({ total_count: jobs.length, jobs });
      }
      const check = /^\/repos\/owner\/repo\/check-runs\/(\d+)$/u.exec(path);
      if (method === "GET" && check) {
        return jsonResponse(verifierCheckRun({
          id: Number(check[1]),
          status: checkStatus,
          conclusion: checkConclusion,
          completed_at: checkStatus === "completed" ? completedAt : null,
        }));
      }
      return undefined;
    },
  });
  return {
    github,
    event: workflowRunEvent({ ...sourceRun, ...eventRunOverrides }),
    completedAt,
    sourceRun,
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

function requestReactionGraphQlCalls(github) {
  return github.calls.filter(({ method, path, body }) =>
    method === "POST" &&
    path === "/graphql" &&
    body?.query?.includes("CodexReviewGateRequestReactions")
  );
}

function hasRequestReactionGraphQlCall(github, commentId, nodeId = `IC_test_${commentId}`) {
  return requestReactionGraphQlCalls(github).some(({ body }) =>
    Object.entries(body.variables || {}).some(([name, value]) =>
      /^nodeId\d+$/u.test(name) && value === nodeId
    )
  );
}

function hasRequestReactionRestRead(github, commentId) {
  return github.calls.some(({ method, path }) =>
    method === "GET" &&
    path === `/repos/${REPOSITORY}/issues/comments/${commentId}/reactions`
  );
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
  reactionGraphQlPageSize = 100,
  reactionGraphQlResponseMutator = null,
  officialReactionAccount = null,
  pullRequestOverrides = {},
  pullRequestSequence = null,
  repositoryOverrides = {},
  repositorySequence = null,
  baseEpoch = null,
  baseEpochSequence = null,
  baseEpochResponseMutator = null,
  deletedCommentEvents = [],
  deletedCommentEventSnapshots = null,
  deletedCommentResponseMutator = null,
  deletedCommentPageSize = 100,
  reviewThreads = [],
  reviewThreadSnapshots = null,
  reviewThreadResponseMutator = null,
  reviewThreadPageSize = 100,
  permissionByLogin = new Map([[HUMAN.login, "write"]]),
  permissionMissingLogins = new Set(),
  commitResolution = null,
  commentRefetchMutator = null,
  reviewRefetchMutator = null,
  postUnknownAfterCreate = false,
  postUnknownReread = "visible",
  postUnknownConcurrentComments = [],
  createdCommentOverrides = {},
  verifierRuns = [verifierRun()],
  verifierRunAttempts = [verifierRun()],
  selfVerifierRun = verifierSelfRun(),
  verifierAttemptStatus = "queued",
  verifierRerunAdvances = true,
  verifierRerunAttemptDelta = 1,
  verifierRerunStatus = 201,
  requestInterceptor = null,
} = {}) {
  const comments = issueComments.map(testIssueCommentWithNodeId);
  const commentSnapshots = issueCommentSnapshots?.map((snapshotComments) =>
    snapshotComments.map(testIssueCommentWithNodeId)) || null;
  const reviewList = reviews.map((value) => structuredClone(value));
  const reviewSnapshotList = reviewSnapshots?.map((snapshotReviews) =>
    snapshotReviews.map((value) => structuredClone(value))) || null;
  const deletedComments = deletedCommentEvents.map((value) => structuredClone(value));
  const deletedCommentSnapshots = deletedCommentEventSnapshots?.map((snapshotEvents) =>
    snapshotEvents.map((value) => structuredClone(value))) || null;
  const reviewThreadList = reviewThreads.map((value) => structuredClone(value));
  const reviewThreadSnapshotList = reviewThreadSnapshots?.map((snapshotThreads) =>
    snapshotThreads.map((value) => structuredClone(value))) || null;
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
  let deletedCommentSnapshotIndex = 0;
  let reviewThreadSnapshotIndex = 0;
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

  function currentDeletedCommentEvents() {
    if (!deletedCommentSnapshots) return deletedComments;
    return deletedCommentSnapshots[
      Math.min(deletedCommentSnapshotIndex, deletedCommentSnapshots.length - 1)
    ] || [];
  }

  function currentReviewThreads() {
    if (!reviewThreadSnapshotList) return reviewThreadList;
    return reviewThreadSnapshotList[
      Math.min(reviewThreadSnapshotIndex, reviewThreadSnapshotList.length - 1)
    ] || [];
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

    if (
      method === "GET" &&
      path === `/users/${encodeURIComponent(CODEX_BOT.login)}`
    ) {
      return jsonResponse(officialReactionAccount || {
        id: CODEX_BOT_DATABASE_ID,
        login: CODEX_BOT.login,
        type: "Bot",
      });
    }
    if (method === "GET" && path === `/repos/${REPOSITORY}`) {
      return jsonResponse(repository());
    }
    if (method === "GET" && path === `/repos/${REPOSITORY}/pulls/${PR}`) {
      return jsonResponse(pullRequest());
    }
    if (
      method === "GET" &&
      path === `/repos/${REPOSITORY}/actions/workflows/codex-review-gate.yml`
    ) {
      return jsonResponse({
        id: 6001,
        name: "Codex Review Gate Verifier",
        path: ".github/workflows/codex-review-gate.yml",
      });
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
    const exactAttempt = /^\/repos\/owner\/repo\/actions\/runs\/(\d+)\/attempts\/(\d+)$/u.exec(path);
    if (method === "GET" && exactAttempt) {
      const attempt = Number(exactAttempt[2]);
      const run = verifierRunAttempts.find((value) =>
        String(value.id) === exactAttempt[1] && value.run_attempt === attempt
      );
      if (!run) return jsonResponse({ message: "not found" }, 404);
      return jsonResponse(structuredClone(run));
    }
    const exactRun = /^\/repos\/owner\/repo\/actions\/runs\/(\d+)$/u.exec(path);
    if (method === "GET" && exactRun) {
      const run = String(selfVerifierRun?.id) === exactRun[1]
        ? selfVerifierRun
        : verifierRuns.find((value) => String(value.id) === exactRun[1]);
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
    if (
      method === "POST" &&
      path === "/graphql" &&
      body?.query?.includes("CodexReviewGateReviewThreads")
    ) {
      const cursor = body.variables?.cursor ?? null;
      const threads = currentReviewThreads();
      const response = reviewThreadGraphQlResponse(threads, {
        cursor,
        pageSize: reviewThreadPageSize,
      });
      const mutated = typeof reviewThreadResponseMutator === "function"
        ? reviewThreadResponseMutator(response, {
            cursor,
            snapshotIndex: reviewThreadSnapshotIndex,
          })
        : response;
      if (!response.hasNext) reviewThreadSnapshotIndex += 1;
      return jsonResponse(mutated.body || mutated);
    }
    if (
      method === "POST" &&
      path === "/graphql" &&
      body?.query?.includes("CodexReviewGateRequestReactions")
    ) {
      const response = requestReactionGraphQlResponse({
        variables: body.variables || {},
        comments: activeComments,
        reactionsByCommentId,
        reactionSnapshotsByCommentId,
        reactionSnapshotIndexes,
        pageSize: reactionGraphQlPageSize,
      });
      return jsonResponse(
        typeof reactionGraphQlResponseMutator === "function"
          ? reactionGraphQlResponseMutator(response, {
              variables: body.variables || {},
              calls: [...calls],
            })
          : response,
      );
    }
    if (
      method === "POST" &&
      path === "/graphql" &&
      body?.query?.includes("CodexReviewGateDeletedComments")
    ) {
      const cursor = body.variables?.cursor ?? null;
      const events = currentDeletedCommentEvents();
      const includeBaseEpoch = body.variables?.includeBaseEpoch === true;
      const selectedBaseEpoch = includeBaseEpoch
        ? baseEpochSequence
          ? baseEpochSequence[Math.min(baseEpochIndex, baseEpochSequence.length - 1)]
          : baseEpoch
        : null;
      if (includeBaseEpoch) baseEpochIndex += 1;
      const response = deletedCommentGraphQlResponse(events, {
        cursor,
        commentCursor: body.variables?.commentCursor ?? null,
        comments: activeComments,
        includeDeleted: body.variables?.includeDeleted !== false,
        includeComments: body.variables?.includeComments !== false,
        includeBaseEpoch,
        baseEpochEvent: selectedBaseEpoch,
        pageSize: deletedCommentPageSize,
      });
      const baseEpochMutated = includeBaseEpoch &&
          typeof baseEpochResponseMutator === "function"
        ? baseEpochResponseMutator(response.body)
        : response.body;
      const mutated = typeof deletedCommentResponseMutator === "function"
        ? deletedCommentResponseMutator(baseEpochMutated, {
            cursor,
            commentCursor: body.variables?.commentCursor ?? null,
            includeDeleted: body.variables?.includeDeleted !== false,
            includeComments: body.variables?.includeComments !== false,
            snapshotIndex: deletedCommentSnapshotIndex,
          })
        : baseEpochMutated;
      if (!response.hasNext) deletedCommentSnapshotIndex += 1;
      return jsonResponse(mutated);
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
        node_id: `IC_test_${nextCommentId}`,
        body: body.body,
        created_at: "2026-08-25T09:00:00Z",
        updated_at: "2026-08-25T09:00:00Z",
        html_url: `https://github.com/${REPOSITORY}/pull/${PR}#issuecomment-${nextCommentId}`,
        user: ACTIONS_BOT,
        app: null,
        performed_via_github_app: null,
        ...structuredClone(createdCommentOverrides),
      };
      nextCommentId += 1;
      comments.push(created);
      activeComments = comments;
      unknownPostCommentId = String(created.id);
      if (body.body.startsWith("@codex review")) requestBodies.push(body.body);
      if (body.body.includes(`<!-- ${V2_STICKY_MARKER} -->`)) stickyCreates.push(body.body);
      if (postUnknownAfterCreate && !unknownPostUsed && body.body.startsWith("@codex review")) {
        comments.push(...postUnknownConcurrentComments.map(testIssueCommentWithNodeId));
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

function reviewThreadGraphQlResponse(threads, { cursor = null, pageSize = 100 } = {}) {
  const match = cursor === null ? null : /^review-thread:(\d+)$/u.exec(String(cursor));
  const start = match ? Number(match[1]) : 0;
  const size = Math.max(1, Number(pageSize) || 1);
  const nodes = threads.slice(start, start + size).map((thread) => structuredClone(thread));
  const nextOffset = start + nodes.length;
  const hasNextPage = nextOffset < threads.length;
  return {
    body: {
      data: {
        repository: {
          nameWithOwner: REPOSITORY,
          pullRequest: {
            number: PR,
            reviewThreads: {
              totalCount: threads.length,
              nodes,
              pageInfo: {
                hasNextPage,
                endCursor: hasNextPage ? `review-thread:${nextOffset}` : null,
              },
            },
          },
        },
      },
    },
    hasNext: hasNextPage,
  };
}

function reviewThread(overrides = {}) {
  const url = `https://github.com/${REPOSITORY}/pull/${PR}#discussion_r1`;
  return {
    id: "PRRT_node_1",
    isResolved: true,
    path: "src/example.mjs",
    isOutdated: false,
    comments: { nodes: [{ url, author: { ...HUMAN } }] },
    ...overrides,
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

function testIssueCommentWithNodeId(value) {
  const comment = structuredClone(value);
  if (!Object.hasOwn(comment, "node_id")) {
    comment.node_id = `IC_test_${comment.id}`;
  }
  return comment;
}

function requestReactionGraphQlResponse({
  variables,
  comments,
  reactionsByCommentId,
  reactionSnapshotsByCommentId,
  reactionSnapshotIndexes,
  pageSize = 100,
}) {
  const data = {};
  const indexes = Object.keys(variables)
    .flatMap((key) => /^nodeId(\d+)$/u.exec(key)?.[1] ?? [])
    .map(Number)
    .sort((left, right) => left - right);
  for (const index of indexes) {
    const nodeId = variables[`nodeId${index}`];
    const comment = comments.find((value) => value.node_id === nodeId);
    if (!comment) {
      data[`comment${index}`] = null;
      continue;
    }
    const id = String(comment.id);
    const snapshots = reactionSnapshotsByCommentId.get(id);
    const snapshotIndex = reactionSnapshotIndexes.get(id) || 0;
    const values = snapshots
      ? snapshots[Math.min(snapshotIndex, snapshots.length - 1)] || []
      : reactionsByCommentId.get(id) || [];
    const rawCursor = variables[`reactionCursor${index}`] ?? null;
    const cursorMatch = rawCursor === null
      ? null
      : new RegExp(`^reaction:${id}:(\\d+)$`, "u").exec(String(rawCursor));
    const start = cursorMatch ? Number(cursorMatch[1]) : 0;
    const size = Math.max(1, Number(pageSize) || 1);
    const pageReactions = values.slice(start, start + size);
    const nextOffset = start + pageReactions.length;
    const hasNextPage = nextOffset < values.length;
    data[`comment${index}`] = {
      __typename: "IssueComment",
      id: comment.node_id,
      databaseId: String(comment.id),
      pullRequest: {
        number: PR,
        repository: {
          databaseId: REPO_ID,
          nameWithOwner: REPOSITORY,
        },
      },
      reactions: {
        totalCount: values.length,
        nodes: pageReactions.map(graphQlReactionNode),
        pageInfo: {
          hasNextPage,
          endCursor: hasNextPage ? `reaction:${id}:${nextOffset}` : null,
        },
      },
    };
    if (snapshots && !hasNextPage) {
      reactionSnapshotIndexes.set(id, snapshotIndex + 1);
    }
  }
  return { data };
}

function graphQlReactionNode(value) {
  const contentByRestValue = {
    "+1": "THUMBS_UP",
    "-1": "THUMBS_DOWN",
    confused: "CONFUSED",
    eyes: "EYES",
    heart: "HEART",
    hooray: "HOORAY",
    laugh: "LAUGH",
    rocket: "ROCKET",
  };
  const official = value.user?.login === CODEX_BOT.login;
  return {
    databaseId: String(value.id),
    content: contentByRestValue[value.content],
    createdAt: value.created_at,
    user: {
      __typename: value.user?.type === "Bot" ? "User" : value.user?.type,
      databaseId: official
        ? CODEX_BOT_DATABASE_ID
        : value.user?.login === HUMAN.login
          ? HUMAN_DATABASE_ID
          : 90_512,
      login: value.user?.login,
    },
  };
}

function deletedCommentGraphQlResponse(events, {
  cursor = null,
  commentCursor = null,
  comments = [],
  includeDeleted = true,
  includeComments = true,
  includeBaseEpoch = false,
  baseEpochEvent = null,
  pageSize = 100,
} = {}) {
  const match = cursor === null
    ? null
    : /^deleted-comment:(\d+)$/u.exec(String(cursor));
  const start = match ? Number(match[1]) : 0;
  const size = Math.max(1, Number(pageSize) || 1);
  const nodes = events.slice(start, start + size).map((event) => structuredClone(event));
  const nextOffset = start + nodes.length;
  const deletedHasNext = includeDeleted && nextOffset < events.length;
  const commentMatch = commentCursor === null
    ? null
    : /^issue-comment:(\d+)$/u.exec(String(commentCursor));
  const commentStart = commentMatch ? Number(commentMatch[1]) : 0;
  const commentNodes = comments
    .slice(commentStart, commentStart + size)
    .map((comment) => issueCommentEditGraphQlNode(comment));
  const commentNextOffset = commentStart + commentNodes.length;
  const commentsHaveNext = includeComments && commentNextOffset < comments.length;
  const pullRequest = { number: PR };
  if (includeBaseEpoch) {
    pullRequest.baseEpochTimelineItems =
      baseEpochGraphQlResponse(baseEpochEvent)
        .data.repository.pullRequest.timelineItems;
  }
  if (includeDeleted) {
    pullRequest.timelineItems = {
      totalCount: events.length,
      filteredCount: Math.max(0, events.length - start),
      pageCount: nodes.length,
      nodes,
      pageInfo: {
        hasNextPage: deletedHasNext,
        endCursor: deletedHasNext ? `deleted-comment:${nextOffset}` : null,
      },
    };
  }
  if (includeComments) {
    pullRequest.comments = {
      totalCount: comments.length,
      nodes: commentNodes,
      pageInfo: {
        hasNextPage: commentsHaveNext,
        endCursor: commentsHaveNext ? `issue-comment:${commentNextOffset}` : null,
      },
    };
  }
  return {
    body: {
      data: {
        repository: {
          nameWithOwner: REPOSITORY,
          pullRequest,
        },
      },
    },
    hasNext: deletedHasNext || commentsHaveNext,
  };
}

function issueCommentEditGraphQlNode(comment) {
  const hasExplicitLastEditedAt = Object.hasOwn(comment, "last_edited_at");
  const lastEditedAt = hasExplicitLastEditedAt
    ? comment.last_edited_at
    : comment.created_at === comment.updated_at
      ? null
      : comment.updated_at;
  const updatedAt = comment.graphql_updated_at ||
    (isCanonicalTestTimestamp(lastEditedAt) &&
        Date.parse(lastEditedAt) > Date.parse(comment.updated_at)
      ? lastEditedAt
      : comment.updated_at);
  return {
    databaseId: String(comment.id),
    body: comment.graphql_body ?? comment.body,
    createdAt: comment.created_at,
    updatedAt,
    lastEditedAt,
  };
}

function isCanonicalTestTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
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

function deletedCommentEvent(overrides = {}) {
  return {
    __typename: "CommentDeletedEvent",
    id: "CDE_kwDOExample1",
    createdAt: "2026-08-25T08:02:00Z",
    actor: { __typename: "User", login: HUMAN.login },
    deletedCommentAuthor: { __typename: "User", login: HUMAN.login },
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
