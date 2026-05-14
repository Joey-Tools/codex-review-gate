import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import {
  activeMarkerAckTimedOut,
  activeMarkerIsObsolete,
  autoRetryEnabled,
  buildMarkerCommentBody,
  buildStateCommentBody,
  codexReviewBodyFindingSample,
  codexAutoReviewLooksOngoing,
  collectCurrentHeadCodexFindings,
  decideBootstrapProgress,
  eventModeHandlesEvent,
  findLatestTrustedMarkerComment,
  findLatestTrustedStateComment,
  hasNewCompletionComment,
  hasNewEyesTransition,
  hasNewPlusOneTransition,
  isCodexCompletionComment,
  isCurrentHeadCodexReviewBodyFinding,
  isRetryableHttpStatus,
  issueCommentIdentity,
  markerAckTimeoutSecondsForHistory,
  markerFromComment,
  NonJsonResponseError,
  normalizeEventMode,
  normalizeMarkerAckTimeoutSeconds,
  parseJsonResponseText,
  parseStateCommentBody,
  reconcileStateWithMarkerComment,
  reactionIdentity,
  restRequestRetryAllowed,
  retryAfterDelayMs,
  selectLatestCodexCompletionComment,
  shouldFailFindingsBeforeMarker,
  stateNeedsFreshMarkerAfterRecovery,
  stateFromRecoveredMarkerComment,
  summarizeCodexReactions,
  summarizeCodexSignalReactions,
} from "../src/core.mjs";

test("normalizes event mode configuration", () => {
  assert.equal(normalizeEventMode(""), "standard");
  assert.equal(normalizeEventMode("full"), "full");
  assert.equal(normalizeEventMode("comment-only"), "comment-only");
  assert.throws(() => normalizeEventMode(" FULL "), /exactly standard, comment-only, or full/);
  assert.throws(() => normalizeEventMode("reviews-only"), /exactly standard, comment-only, or full/);
});

test("filters optional workflow events by event mode", () => {
  assert.equal(eventModeHandlesEvent("issue_comment", "standard"), true);
  assert.equal(eventModeHandlesEvent("pull_request_review", "standard"), true);
  assert.equal(eventModeHandlesEvent("pull_request_review", "comment-only"), false);
  assert.equal(eventModeHandlesEvent("pull_request_review_comment", "standard"), false);
  assert.equal(eventModeHandlesEvent("pull_request_review_comment", "full"), true);
});

test("treats only explicit false as auto retry disabled", () => {
  assert.equal(autoRetryEnabled("false"), false);
  assert.equal(autoRetryEnabled(" FALSE "), false);
  assert.equal(autoRetryEnabled(""), true);
  assert.equal(autoRetryEnabled("0"), true);
});

test("reads status context and hidden marker names from process environment at import time", () => {
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import { STATUS_CONTEXT, STATE_MARKER, MARKER_COMMENT } from './src/core.mjs'; console.log(JSON.stringify({ STATUS_CONTEXT, STATE_MARKER, MARKER_COMMENT }));",
    ],
    {
      cwd: new URL("..", import.meta.url),
      env: {
        ...process.env,
        STATUS_CONTEXT: "custom/review-gate",
        STATE_MARKER: "custom-state-marker",
        MARKER_COMMENT: "custom-marker-comment",
      },
      encoding: "utf8",
    },
  );

  assert.deepEqual(JSON.parse(output), {
    STATUS_CONTEXT: "custom/review-gate",
    STATE_MARKER: "custom-state-marker",
    MARKER_COMMENT: "custom-marker-comment",
  });
});

test("does not reuse an unchanged +1 reaction", () => {
  const baseline = {
    id: "1",
    content: "+1",
    createdAt: "2026-04-26T10:00:00Z",
    user: "chatgpt-codex-connector[bot]",
  };

  assert.equal(
    hasNewPlusOneTransition(baseline, baseline, "2026-04-26T10:01:00Z"),
    false,
  );
});

test("requires the +1 transition to be after the marker", () => {
  const current = {
    id: "2",
    content: "+1",
    createdAt: "2026-04-26T10:00:00Z",
    user: "chatgpt-codex-connector[bot]",
  };

  assert.equal(
    hasNewPlusOneTransition(null, current, "2026-04-26T10:01:00Z"),
    false,
  );
});

test("accepts a new +1 identity after the marker", () => {
  const baseline = {
    id: "1",
    content: "+1",
    createdAt: "2026-04-26T10:00:00Z",
    user: "chatgpt-codex-connector[bot]",
  };
  const current = {
    id: "2",
    content: "+1",
    createdAt: "2026-04-26T10:05:00Z",
    user: "chatgpt-codex-connector[bot]",
  };

  assert.equal(
    hasNewPlusOneTransition(baseline, current, "2026-04-26T10:01:00Z"),
    true,
  );
});

test("accepts a same-second new +1 identity at the marker boundary", () => {
  const baseline = {
    id: "1",
    content: "+1",
    createdAt: "2026-04-26T10:01:00Z",
    user: "chatgpt-codex-connector[bot]",
  };
  const current = {
    id: "2",
    content: "+1",
    createdAt: "2026-04-26T10:01:00Z",
    user: "chatgpt-codex-connector[bot]",
  };

  assert.equal(
    hasNewPlusOneTransition(baseline, current, "2026-04-26T10:01:00Z"),
    true,
  );
  assert.equal(
    hasNewPlusOneTransition(current, current, "2026-04-26T10:01:00Z"),
    false,
  );
});

test("accepts a new Codex completion comment after the marker", () => {
  const baseline = {
    id: "1",
    createdAt: "2026-04-26T10:00:00Z",
    user: "chatgpt-codex-connector[bot]",
    url: "https://example.invalid/comments/1",
  };
  const current = {
    id: "2",
    createdAt: "2026-04-26T10:05:00Z",
    user: "chatgpt-codex-connector[bot]",
    url: "https://example.invalid/comments/2",
  };

  assert.equal(
    hasNewCompletionComment(baseline, current, "2026-04-26T10:01:00Z"),
    true,
  );
});

test("accepts a same-second new Codex completion comment at the marker boundary", () => {
  const baseline = {
    id: "1",
    createdAt: "2026-04-26T10:01:00Z",
    user: "chatgpt-codex-connector[bot]",
    url: "https://example.invalid/comments/1",
  };
  const current = {
    id: "2",
    createdAt: "2026-04-26T10:01:00Z",
    user: "chatgpt-codex-connector[bot]",
    url: "https://example.invalid/comments/2",
  };

  assert.equal(
    hasNewCompletionComment(baseline, current, "2026-04-26T10:01:00Z"),
    true,
  );
  assert.equal(
    hasNewCompletionComment(current, current, "2026-04-26T10:01:00Z"),
    false,
  );
});

test("starts marker ack timeout at the configured base", () => {
  assert.equal(markerAckTimeoutSecondsForHistory([], "head", 300, 1800), 300);
});

test("backs off marker ack timeout for consecutive missed acks on the same head", () => {
  const history = [];
  const observed = [];

  for (let index = 0; index < 5; index += 1) {
    observed.push(markerAckTimeoutSecondsForHistory(history, "head", 300, 1800));
    history.push({
      headSha: "head",
      outcome: "missed_ack",
    });
  }

  assert.deepEqual(observed, [300, 600, 1200, 1800, 1800]);
});

test("resets marker ack backoff after a different head or non-missed marker", () => {
  assert.equal(
    markerAckTimeoutSecondsForHistory(
      [
        { headSha: "head", outcome: "missed_ack" },
        { headSha: "other", outcome: "missed_ack" },
      ],
      "head",
      300,
      1800,
    ),
    300,
  );
  assert.equal(
    markerAckTimeoutSecondsForHistory(
      [
        { headSha: "head", outcome: "missed_ack" },
        { headSha: "head", outcome: "stalled" },
      ],
      "head",
      300,
      1800,
    ),
    300,
  );
});

test("caps default marker ack timeouts to shorter marker result timeout", () => {
  assert.deepEqual(
    normalizeMarkerAckTimeoutSeconds({
      markerTimeoutSeconds: 120,
      markerAckTimeoutSeconds: 300,
      markerAckTimeoutMaxSeconds: 1800,
    }),
    {
      markerAckTimeoutSeconds: 120,
      markerAckTimeoutMaxSeconds: 120,
    },
  );
});

test("keeps marker ack timeouts when they already fit within marker result timeout", () => {
  assert.deepEqual(
    normalizeMarkerAckTimeoutSeconds({
      markerTimeoutSeconds: 3600,
      markerAckTimeoutSeconds: 300,
      markerAckTimeoutMaxSeconds: 1800,
    }),
    {
      markerAckTimeoutSeconds: 300,
      markerAckTimeoutMaxSeconds: 1800,
    },
  );
});

test("times out only waiting-ack markers", () => {
  const createdAt = "2026-04-26T10:00:00Z";
  const nowMs = Date.parse("2026-04-26T10:05:00Z");

  assert.equal(
    activeMarkerAckTimedOut(
      { state: "waiting_ack", createdAt, ackTimeoutSeconds: 300 },
      nowMs,
      300,
    ),
    true,
  );
  assert.equal(
    activeMarkerAckTimedOut(
      { state: "waiting_result", createdAt, ackTimeoutSeconds: 300 },
      nowMs,
      300,
    ),
    false,
  );
});

test("uses fallback ack timeout for older active marker state", () => {
  assert.equal(
    activeMarkerAckTimedOut(
      { state: "waiting_ack", createdAt: "2026-04-26T10:00:00Z" },
      Date.parse("2026-04-26T10:05:00Z"),
      300,
    ),
    true,
  );
});

test("new eyes transition prevents marker ack timeout once state is waiting-result", () => {
  const activeMarker = {
    state: "waiting_ack",
    createdAt: "2026-04-26T10:00:00Z",
    ackTimeoutSeconds: 300,
  };
  const currentEyes = {
    id: "5",
    content: "eyes",
    createdAt: "2026-04-26T10:01:00Z",
    user: "chatgpt-codex-connector[bot]",
  };

  assert.equal(hasNewEyesTransition(null, currentEyes, activeMarker.createdAt), true);
  assert.equal(
    activeMarkerAckTimedOut(
      { ...activeMarker, state: "waiting_result", observedEyes: currentEyes },
      Date.parse("2026-04-26T10:05:00Z"),
      300,
    ),
    false,
  );
});

test("requires Codex completion comments to be after the marker", () => {
  const current = {
    id: "2",
    createdAt: "2026-04-26T10:00:00Z",
    user: "chatgpt-codex-connector[bot]",
    url: "https://example.invalid/comments/2",
  };

  assert.equal(
    hasNewCompletionComment(null, current, "2026-04-26T10:01:00Z"),
    false,
  );
});

test("detects active markers from obsolete heads", () => {
  assert.equal(activeMarkerIsObsolete({ headSha: "old" }, "new"), true);
  assert.equal(activeMarkerIsObsolete({ headSha: "new" }, "new"), false);
  assert.equal(activeMarkerIsObsolete(null, "new"), false);
});

test("treats eyes as liveness only after the marker", () => {
  const current = {
    id: "5",
    content: "eyes",
    createdAt: "2026-04-26T10:05:00Z",
    user: "chatgpt-codex-connector[bot]",
  };

  assert.equal(hasNewEyesTransition(null, current, "2026-04-26T10:01:00Z"), true);
});

test("accepts same-second eyes when the reaction identity changed", () => {
  const baseline = {
    id: "4",
    content: "eyes",
    createdAt: "2026-04-26T10:01:00Z",
    user: "chatgpt-codex-connector[bot]",
  };
  const current = {
    id: "5",
    content: "eyes",
    createdAt: "2026-04-26T10:01:00Z",
    user: "chatgpt-codex-connector[bot]",
  };

  assert.equal(hasNewEyesTransition(baseline, current, "2026-04-26T10:01:00Z"), true);
  assert.equal(hasNewEyesTransition(current, current, "2026-04-26T10:01:00Z"), false);
});

test("summarizes only Codex bot signal reactions", () => {
  const issueReactions = [
    { id: 1, content: "+1", created_at: "2026-04-26T10:00:00Z", user: { login: "octocat" } },
    {
      id: 2,
      content: "+1",
      created_at: "2026-04-26T10:01:00Z",
      user: { login: "chatgpt-codex-connector[bot]" },
    },
  ];
  const markerCommentReactions = [
    {
      id: 3,
      content: "eyes",
      created_at: "2026-04-26T10:02:00Z",
      user: { login: "chatgpt-codex-connector[bot]" },
    },
  ];

  assert.deepEqual(summarizeCodexReactions([...issueReactions, ...markerCommentReactions]), {
    plusOne: reactionIdentity(issueReactions[1]),
    eyes: reactionIdentity(markerCommentReactions[0]),
  });
  assert.deepEqual(summarizeCodexSignalReactions(issueReactions, markerCommentReactions), {
    plusOne: reactionIdentity(issueReactions[1]),
    eyes: reactionIdentity(markerCommentReactions[0]),
  });
});

test("selects only Codex bot top-level completion comments", () => {
  const comments = [
    {
      id: 1,
      created_at: "2026-04-26T10:00:00Z",
      html_url: "https://example.invalid/comments/1",
      body: "Codex Review: Didn't find any major issues.",
      user: { login: "octocat" },
    },
    {
      id: 2,
      created_at: "2026-04-26T10:01:00Z",
      html_url: "https://example.invalid/comments/2",
      body: "To use Codex here, create a Codex account and connect to github.",
      user: { login: "chatgpt-codex-connector[bot]" },
    },
    {
      id: 3,
      created_at: "2026-04-26T10:02:00Z",
      html_url: "https://example.invalid/comments/3",
      body: "Codex Review: Didn't find any major issues. Chef's kiss.",
      user: { login: "chatgpt-codex-connector[bot]" },
    },
  ];

  assert.equal(isCodexCompletionComment(comments[1]), false);
  assert.deepEqual(selectLatestCodexCompletionComment(comments), issueCommentIdentity(comments[2]));
});

test("retries only transient HTTP statuses", () => {
  assert.equal(isRetryableHttpStatus(504), true);
  assert.equal(isRetryableHttpStatus(502), true);
  assert.equal(isRetryableHttpStatus(422), false);
});

test("does not retry marker comment creation requests", () => {
  assert.equal(restRequestRetryAllowed("PATCH", "/repos/o/r/issues/comments/1", 504), true);
  assert.equal(restRequestRetryAllowed("GET", "/repos/o/r/pulls/1", 504), true);
  assert.equal(restRequestRetryAllowed("POST", "/repos/o/r/statuses/abc", 504), true);
  assert.equal(restRequestRetryAllowed("POST", "/repos/o/r/issues/1/comments", 504), false);
});

test("honors Retry-After response delays", () => {
  assert.equal(retryAfterDelayMs("2", 100), 2000);
  assert.equal(retryAfterDelayMs("invalid", 100), 100);
});

test("parses JSON response text and accepts empty response bodies", () => {
  assert.deepEqual(parseJsonResponseText("{\"ok\":true}", "GET /repos/o/r"), { ok: true });
  assert.equal(parseJsonResponseText("", "GET /repos/o/r"), null);
});

test("reports non-JSON response previews without raw SyntaxError text", () => {
  assert.throws(
    () => parseJsonResponseText("<!DOCTYPE html><title>Bad Gateway</title>", "GET /repos/o/r (502)"),
    (error) => {
      assert.equal(error instanceof NonJsonResponseError, true);
      assert.equal(error.name, "NonJsonResponseError");
      assert.match(error.message, /GET \/repos\/o\/r \(502\) returned a non-JSON response/);
      assert.match(error.preview, /<!DOCTYPE html>/);
      return true;
    },
  );
});

test("round-trips hidden state metadata", () => {
  const state = {
    version: 1,
    createdAt: "2026-04-26T10:00:00Z",
    updatedAt: "2026-04-26T10:01:00Z",
    statusHead: "abc123",
    bootstrap: { status: "closed" },
    activeMarker: null,
    history: [],
  };

  assert.deepEqual(parseStateCommentBody(buildStateCommentBody(state)), state);
});

test("ignores untrusted state comments", () => {
  const trustedBody = buildStateCommentBody({
    version: 1,
    createdAt: "2026-04-26T10:00:00Z",
    updatedAt: "2026-04-26T10:01:00Z",
    statusHead: "trusted",
    bootstrap: { status: "closed" },
    activeMarker: null,
    history: [],
  });
  const attackerBody = buildStateCommentBody({
    version: 1,
    createdAt: "2026-04-26T10:00:00Z",
    updatedAt: "2026-04-26T10:01:00Z",
    statusHead: "attacker",
    bootstrap: { status: "closed" },
    activeMarker: null,
    history: [],
  });

  const comment = findLatestTrustedStateComment([
    { id: 1, body: trustedBody, user: { login: "github-actions[bot]" } },
    { id: 2, body: attackerBody, user: { login: "octocat" } },
  ]);

  assert.equal(parseStateCommentBody(comment.body).statusHead, "trusted");
});

test("finds the latest trusted marker comment", () => {
  const markerBody = buildMarkerCommentBody({
    headSha: "abc123",
    runUrl: "https://example.invalid/runs/1",
    runId: "1",
    runAttempt: "1",
    attempt: 1,
    baseline: { plusOne: null, eyes: null },
    state: "waiting_ack",
  });

  const comment = findLatestTrustedMarkerComment([
    { id: 1, body: markerBody, created_at: "2026-04-26T10:00:00Z", user: { login: "octocat" } },
    {
      id: 2,
      body: markerBody,
      html_url: "https://example.invalid/comments/2",
      created_at: "2026-04-26T10:01:00Z",
      user: { login: "github-actions[bot]" },
    },
  ]);

  assert.deepEqual(markerFromComment(comment), {
    version: 1,
    headSha: "abc123",
    runUrl: "https://example.invalid/runs/1",
    runId: "1",
    runAttempt: "1",
    attempt: 1,
    baseline: { plusOne: null, eyes: null },
    state: "waiting_ack",
    id: "2",
    url: "https://example.invalid/comments/2",
    createdAt: "2026-04-26T10:01:00Z",
  });
});

test("persists marker ack timeout when present", () => {
  const markerBody = buildMarkerCommentBody({
    headSha: "abc123",
    runUrl: "https://example.invalid/runs/1",
    runId: "1",
    runAttempt: "1",
    attempt: 1,
    baseline: { plusOne: null, eyes: null },
    state: "waiting_ack",
    ackTimeoutSeconds: 300,
  });

  assert.equal(
    markerFromComment({
      id: 2,
      body: markerBody,
      created_at: "2026-04-26T10:01:00Z",
      user: { login: "github-actions[bot]" },
    }).ackTimeoutSeconds,
    300,
  );
});

test("collects only current-head Codex inline findings", () => {
  const comments = [
    {
      id: 10,
      path: "src/lib.rs",
      line: 7,
      commit_id: "head",
      user: { login: "chatgpt-codex-connector[bot]" },
    },
    {
      id: 11,
      path: "src/old.rs",
      line: 8,
      commit_id: "old",
      user: { login: "chatgpt-codex-connector[bot]" },
    },
    {
      id: 12,
      path: "src/human.rs",
      line: 9,
      commit_id: "head",
      user: { login: "octocat" },
    },
  ];

  assert.deepEqual(collectCurrentHeadCodexFindings(comments, [], "head"), {
    count: 1,
    ids: ["10"],
    samples: ["src/lib.rs:7"],
  });
});

test("ignores resolved and outdated current-head Codex inline threads", () => {
  const comments = [
    {
      id: 10,
      path: "src/resolved.rs",
      line: null,
      original_line: 7,
      commit_id: "head",
      original_commit_id: "old",
      user: { login: "chatgpt-codex-connector[bot]" },
    },
    {
      id: 11,
      path: "src/outdated.rs",
      line: null,
      original_line: 8,
      commit_id: "head",
      original_commit_id: "old",
      user: { login: "chatgpt-codex-connector[bot]" },
    },
    {
      id: 12,
      path: "src/active.rs",
      line: 9,
      commit_id: "head",
      original_commit_id: "head",
      user: { login: "chatgpt-codex-connector[bot]" },
    },
  ];
  const reviewThreads = [
    {
      id: "resolved-thread",
      isResolved: true,
      isOutdated: true,
      comments: { nodes: [{ databaseId: 10 }] },
    },
    {
      id: "outdated-thread",
      isResolved: false,
      isOutdated: true,
      comments: { nodes: [{ databaseId: 11 }] },
    },
    {
      id: "active-thread",
      isResolved: false,
      isOutdated: false,
      comments: { nodes: [{ databaseId: 12 }] },
    },
  ];

  assert.deepEqual(collectCurrentHeadCodexFindings(comments, [], "head", undefined, reviewThreads), {
    count: 1,
    ids: ["12"],
    samples: ["src/active.rs:9"],
  });
});

test("treats unmapped current-head Codex inline comments as findings", () => {
  const comments = [
    {
      id: 10,
      path: "src/lib.rs",
      line: 7,
      commit_id: "head",
      user: { login: "chatgpt-codex-connector[bot]" },
    },
  ];

  assert.deepEqual(collectCurrentHeadCodexFindings(comments, [], "head", undefined, []), {
    count: 1,
    ids: ["10"],
    samples: ["src/lib.rs:7"],
  });
});

test("collects current-head Codex review-body findings", () => {
  const body = [
    "### 💡 Codex Review",
    "",
    "https://github.com/owner/repo/blob/head/src/daemon.rs#L285-L290",
    "**<sub><sub>![P2 Badge](https://img.shields.io/badge/P2-yellow?style=flat)</sub></sub> Finding title**",
  ].join("\n");
  const reviews = [
    {
      id: 20,
      state: "COMMENTED",
      commit_id: "head",
      body,
      user: { login: "chatgpt-codex-connector[bot]" },
    },
    {
      id: 21,
      state: "COMMENTED",
      commit_id: "old",
      body: body.replace("/blob/head/", "/blob/old/"),
      user: { login: "chatgpt-codex-connector[bot]" },
    },
    {
      id: 22,
      state: "COMMENTED",
      commit_id: "head",
      body: "Codex Review: Didn't find any major issues. :+1:",
      user: { login: "chatgpt-codex-connector[bot]" },
    },
  ];

  assert.equal(isCurrentHeadCodexReviewBodyFinding(reviews[0], "head"), true);
  assert.equal(isCurrentHeadCodexReviewBodyFinding(reviews[1], "head"), false);
  assert.equal(isCurrentHeadCodexReviewBodyFinding(reviews[2], "head"), false);
  assert.equal(codexReviewBodyFindingSample(body, "head"), "src/daemon.rs:285");
  assert.deepEqual(collectCurrentHeadCodexFindings([], reviews, "head"), {
    count: 1,
    ids: ["review:20"],
    samples: ["src/daemon.rs:285"],
  });
});

test("combines inline and review-body Codex findings", () => {
  const comments = [
    {
      id: 10,
      path: "src/lib.rs",
      line: 7,
      commit_id: "head",
      user: { login: "chatgpt-codex-connector[bot]" },
    },
  ];
  const reviews = [
    {
      id: 20,
      state: "COMMENTED",
      commit_id: "head",
      body: [
        "### 💡 Codex Review",
        "",
        "https://github.com/owner/repo/blob/head/src/daemon.rs#L285-L290",
      ].join("\n"),
      user: { login: "chatgpt-codex-connector[bot]" },
    },
  ];

  assert.deepEqual(collectCurrentHeadCodexFindings(comments, reviews, "head"), {
    count: 2,
    ids: ["10", "review:20"],
    samples: ["src/lib.rs:7", "src/daemon.rs:285"],
  });
});

test("treats eyes newer than an old +1 as ongoing bootstrap activity", () => {
  assert.equal(
    codexAutoReviewLooksOngoing({
      plusOne: {
        id: "1",
        content: "+1",
        createdAt: "2026-04-26T10:00:00Z",
        user: "chatgpt-codex-connector[bot]",
      },
      eyes: {
        id: "2",
        content: "eyes",
        createdAt: "2026-04-26T10:05:00Z",
        user: "chatgpt-codex-connector[bot]",
      },
    }),
    true,
  );
});

test("treats +1 newer than eyes as closed bootstrap activity", () => {
  assert.equal(
    codexAutoReviewLooksOngoing({
      plusOne: {
        id: "2",
        content: "+1",
        createdAt: "2026-04-26T10:05:00Z",
        user: "chatgpt-codex-connector[bot]",
      },
      eyes: {
        id: "1",
        content: "eyes",
        createdAt: "2026-04-26T10:00:00Z",
        user: "chatgpt-codex-connector[bot]",
      },
    }),
    false,
  );
});

test("keeps bootstrap open only during the initial grace period", () => {
  assert.deepEqual(
    decideBootstrapProgress({
      startedAt: "2026-04-26T10:00:00Z",
      nowMs: Date.parse("2026-04-26T10:00:30Z"),
      graceSeconds: 60,
      reactions: {
        plusOne: null,
        eyes: {
          id: "1",
          content: "eyes",
          createdAt: "2026-04-26T10:00:10Z",
          user: "chatgpt-codex-connector[bot]",
        },
      },
    }),
    {
      status: "open",
      startedAt: "2026-04-26T10:00:00Z",
      graceEndsAt: "2026-04-26T10:01:00.000Z",
      autoReviewLooksOngoing: true,
    },
  );
});

test("closes bootstrap after grace even when an eyes reaction remains ongoing", () => {
  assert.deepEqual(
    decideBootstrapProgress({
      startedAt: "2026-04-26T10:00:00Z",
      nowMs: Date.parse("2026-04-26T10:01:01Z"),
      graceSeconds: 60,
      reactions: {
        plusOne: null,
        eyes: {
          id: "1",
          content: "eyes",
          createdAt: "2026-04-26T10:00:10Z",
          user: "chatgpt-codex-connector[bot]",
        },
      },
    }),
    {
      status: "closed",
      startedAt: "2026-04-26T10:00:00Z",
      graceEndsAt: "2026-04-26T10:01:00.000Z",
      closedAt: "2026-04-26T10:01:01.000Z",
      closeReason: "bootstrap_superseded_ongoing",
      autoReviewLooksOngoing: true,
    },
  );
});

test("reconstructs an active marker when state was not patched after marker creation", () => {
  const markerBody = buildMarkerCommentBody({
    headSha: "abc123",
    runUrl: "https://example.invalid/runs/1",
    runId: "1",
    runAttempt: "1",
    attempt: 1,
    baseline: { plusOne: null, eyes: null },
    state: "waiting_ack",
  });
  const state = {
    version: 1,
    createdAt: "2026-04-26T10:00:00Z",
    updatedAt: "2026-04-26T10:00:00Z",
    statusHead: "abc123",
    bootstrap: { status: "closed" },
    activeMarker: null,
    history: [],
  };

  const reconciled = reconcileStateWithMarkerComment(
    state,
    {
      id: 2,
      body: markerBody,
      html_url: "https://example.invalid/comments/2",
      created_at: "2026-04-26T10:01:00Z",
      user: { login: "github-actions[bot]" },
    },
    "2026-04-26T10:02:00Z",
  );

  assert.equal(reconciled.changed, true);
  assert.equal(reconciled.state.activeMarker.id, "2");
  assert.equal(reconciled.state.activeMarker.headSha, "abc123");
});

test("does not reactivate a marker when the sticky state comment is missing", () => {
  const markerBody = buildMarkerCommentBody({
    headSha: "abc123",
    runUrl: "https://example.invalid/runs/1",
    runId: "1",
    runAttempt: "1",
    attempt: 1,
    baseline: { plusOne: null, eyes: null },
    state: "waiting_ack",
  });
  const state = stateFromRecoveredMarkerComment({
    markerComment: {
      id: 2,
      body: markerBody,
      html_url: "https://example.invalid/comments/2",
      created_at: "2026-04-26T10:01:00Z",
      user: { login: "github-actions[bot]" },
    },
    marker: {
      headSha: "abc123",
      runUrl: "https://example.invalid/runs/1",
      runId: "1",
      runAttempt: "1",
      attempt: 1,
      baseline: { plusOne: null, eyes: null },
      state: "waiting_ack",
    },
    now: "2026-04-26T10:02:00Z",
    statusHead: "abc123",
    runUrl: "https://example.invalid/runs/2",
    reactions: {
      plusOne: {
        id: "99",
        content: "+1",
        createdAt: "2026-04-26T10:01:30Z",
        user: "chatgpt-codex-connector[bot]",
      },
      eyes: null,
    },
    findings: { ids: ["finding-1"] },
  });

  assert.equal(state.activeMarker, null);
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].id, "2");
  assert.equal(state.history[0].outcome, "state_lost");
  assert.equal(stateNeedsFreshMarkerAfterRecovery(state), true);
  assert.equal(state.bootstrap.baseline.plusOne.id, "99");
  assert.deepEqual(state.bootstrap.currentHeadFindingIds, ["finding-1"]);
});

test("requires a fresh recovery marker only after state-loss recovery", () => {
  assert.equal(stateNeedsFreshMarkerAfterRecovery({ activeMarker: { id: "1" }, history: [] }), false);
  assert.equal(
    stateNeedsFreshMarkerAfterRecovery({
      activeMarker: null,
      history: [{ id: "1", outcome: "missed_ack" }],
    }),
    false,
  );
  assert.equal(
    stateNeedsFreshMarkerAfterRecovery({
      activeMarker: null,
      history: [{ id: "1", outcome: "state_lost" }],
    }),
    true,
  );
});

test("defers existing findings when a fresh-head marker is allowed", () => {
  assert.equal(
    shouldFailFindingsBeforeMarker({ findingsCount: 2, freshHeadMarkerAllowed: true }),
    false,
  );
  assert.equal(
    shouldFailFindingsBeforeMarker({ findingsCount: 2, freshHeadMarkerAllowed: false }),
    true,
  );
  assert.equal(
    shouldFailFindingsBeforeMarker({ findingsCount: 0, freshHeadMarkerAllowed: false }),
    false,
  );
});

test("fails closed when state and latest trusted marker disagree", () => {
  const markerBody = buildMarkerCommentBody({
    headSha: "def456",
    runUrl: "https://example.invalid/runs/2",
    runId: "2",
    runAttempt: "1",
    attempt: 2,
    baseline: { plusOne: null, eyes: null },
    state: "waiting_ack",
  });
  const state = {
    version: 1,
    createdAt: "2026-04-26T10:00:00Z",
    updatedAt: "2026-04-26T10:00:00Z",
    statusHead: "abc123",
    bootstrap: { status: "closed" },
    activeMarker: { id: "1", headSha: "abc123" },
    history: [],
  };

  assert.throws(
    () =>
      reconcileStateWithMarkerComment(
        state,
        {
          id: 2,
          body: markerBody,
          created_at: "2026-04-26T10:01:00Z",
          user: { login: "github-actions[bot]" },
        },
        "2026-04-26T10:02:00Z",
      ),
    /already tracks marker 1/,
  );
});
