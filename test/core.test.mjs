import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import test from "node:test";

import {
  MAX_FINDING_ID_SAMPLES,
  MAX_STATE_COMMENT_BYTES,
  activeMarkerAckTimedOut,
  activeMarkerIsObsolete,
  autoRetryEnabled,
  buildMarkerCommentBody,
  buildStateCommentBody,
  codexReviewBodyFindingSample,
  codexAutoReviewLooksOngoing,
  collectCurrentHeadCodexFindings,
  collectUnresolvedCodexThreadFindings,
  codexInlineParentReviewBodyHasClosedGrammar,
  decideBootstrapProgress,
  eventMayHaveReadOnlyDependabotToken,
  eventModeHandlesEvent,
  failedFindingsRecoveryEnabled,
  findLatestTrustedMarkerComment,
  findLatestTrustedStateComment,
  hasTrustedGateStateOrMarker,
  hasNewCompletionComment,
  hasNewEyesTransition,
  hasNewPlusOneTransition,
  hasNewReviewTransition,
  isCodexCompletionComment,
  isCurrentHeadCodexReviewBodyFinding,
  isRetryableHttpStatus,
  issueCommentIdentity,
  markerAckTimeoutSecondsForHistory,
  markerCanAcceptAckSignal,
  markerFromComment,
  markerTimeoutOutcome,
  NonJsonResponseError,
  normalizeEventMode,
  normalizeFailedFindingsRecoveryMode,
  normalizeMarkerAckTimeoutSeconds,
  parseCodexIssueCommentArtifact,
  parseCodexIssueCommentTerminalHeading,
  parseCodexReviewArtifact,
  parseJsonResponseText,
  parseMarkerCommentBody,
  parseStateCommentBody,
  pullRequestIsDependabot,
  reconcileStateWithMarkerComment,
  reactionIdentity,
  restRequestRetryAllowed,
  retryAfterDelayMs,
  selectLatestCodexCompletionComment,
  shouldCreateFreshHeadMarker,
  shouldFailFindingsBeforeMarker,
  shouldSkipScheduledScanWithoutMarker,
  sortCodexArtifactsNewestFirst,
  stateNeedsFreshMarkerAfterMissingMarker,
  stateNeedsFreshMarkerAfterRecovery,
  stateFromRecoveredMarkerComment,
  summarizeFindingsForState,
  summarizeCodexReactions,
  summarizeCodexSignalReactions,
} from "../packages/action/src/core.mjs";

const FULL_SHA_A = "a".repeat(40);
const FULL_SHA_B = "b".repeat(40);
const LARGE_REVIEW_COMMENT_ID = 3634927460;
const LARGE_REVIEW_COMMENT_NODE_ID = "PRRC_kwDOReviewGate3634927460";

function reviewCommentNodeId(numericId) {
  return `PRRC_kwDOReviewGate${numericId}`;
}

function graphqlReviewComment(numericId, nodeId = reviewCommentNodeId(numericId)) {
  return {
    id: nodeId,
    fullDatabaseId: String(numericId),
  };
}

function liveCodexIssueComment(body, overrides = {}) {
  return {
    id: 101,
    body,
    created_at: "2026-07-23T08:00:00Z",
    html_url: "https://github.com/owner/repo/issues/1#issuecomment-101",
    user: {
      login: "chatgpt-codex-connector[bot]",
      type: "Bot",
    },
    performed_via_github_app: {
      slug: "chatgpt-codex-connector",
    },
    ...overrides,
  };
}

function liveCodexReview(overrides = {}) {
  return {
    id: 201,
    state: "APPROVED",
    commit_id: FULL_SHA_A,
    submitted_at: "2026-07-23T08:01:00Z",
    html_url: "https://github.com/owner/repo/pull/1#pullrequestreview-201",
    user: {
      login: "chatgpt-codex-connector[bot]",
      type: "Bot",
    },
    ...overrides,
  };
}

function officialCodexDisclosure() {
  return [
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

function parseCleanIssueCommentFirstLine(firstLine, { disclosure = false } = {}) {
  const lines = [
    firstLine,
    "",
    "**Reviewed commit:** `abcdef1234`",
  ];
  if (disclosure) {
    lines.push("", officialCodexDisclosure());
  }
  return parseCodexIssueCommentArtifact(
    liveCodexIssueComment(lines.join("\n")),
    { owner: "owner", repo: "repo" },
  );
}

function parseCleanTagline(tagline, options) {
  return parseCleanIssueCommentFirstLine(
    `Codex Review: Didn't find any major issues. ${tagline}`,
    options,
  );
}

function officialInlineParentReviewBody(commitRef = FULL_SHA_A.slice(0, 10)) {
  return [
    "### 💡 Codex Review",
    "",
    "Here are some automated review suggestions for this pull request.",
    "",
    `**Reviewed commit:** \`${commitRef}\``,
    "    ",
    "",
    officialCodexDisclosure(),
  ].join("\n");
}

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

test("treats Dependabot event wakeups as read-only token candidates", () => {
  assert.equal(eventMayHaveReadOnlyDependabotToken("pull_request_target"), true);
  assert.equal(eventMayHaveReadOnlyDependabotToken("issue_comment"), true);
  assert.equal(eventMayHaveReadOnlyDependabotToken("pull_request_review"), true);
  assert.equal(eventMayHaveReadOnlyDependabotToken("pull_request_review_comment"), true);
  assert.equal(eventMayHaveReadOnlyDependabotToken("schedule"), false);
  assert.equal(eventMayHaveReadOnlyDependabotToken("workflow_dispatch"), false);
});

test("detects Dependabot-authored pull requests", () => {
  assert.equal(pullRequestIsDependabot({ user: { login: "dependabot[bot]" } }), true);
  assert.equal(pullRequestIsDependabot({ user: { login: "octocat" } }), false);
  assert.equal(pullRequestIsDependabot({}), false);
});

test("treats only explicit false as auto retry disabled", () => {
  assert.equal(autoRetryEnabled("false"), false);
  assert.equal(autoRetryEnabled(" FALSE "), false);
  assert.equal(autoRetryEnabled(""), true);
  assert.equal(autoRetryEnabled("0"), true);
});

test("treats only explicit false as failed findings recovery disabled", () => {
  assert.equal(failedFindingsRecoveryEnabled("false"), false);
  assert.equal(failedFindingsRecoveryEnabled(" FALSE "), false);
  assert.equal(failedFindingsRecoveryEnabled(""), true);
  assert.equal(failedFindingsRecoveryEnabled("0"), true);
});

test("normalizes failed findings recovery mode configuration", () => {
  assert.equal(normalizeFailedFindingsRecoveryMode(""), "head");
  assert.equal(normalizeFailedFindingsRecoveryMode("head"), "head");
  assert.equal(normalizeFailedFindingsRecoveryMode(" fresh "), "fresh");
  assert.throws(
    () => normalizeFailedFindingsRecoveryMode("strict"),
    /exactly head or fresh/,
  );
});

test("reads status context and hidden marker names from process environment at import time", () => {
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import { STATUS_CONTEXT, STATE_MARKER, MARKER_COMMENT } from './packages/action/src/core.mjs'; console.log(JSON.stringify({ STATUS_CONTEXT, STATE_MARKER, MARKER_COMMENT }));",
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

test("rejects a same-second Codex completion comment at the marker boundary", () => {
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
    false,
  );
  assert.equal(
    hasNewCompletionComment(current, current, "2026-04-26T10:01:00Z"),
    false,
  );
});

test("requires Codex completion comments to satisfy the configured marker buffer", () => {
  const sameSecond = {
    id: "1",
    createdAt: "2026-04-26T10:01:00Z",
    user: "chatgpt-codex-connector[bot]",
    url: "https://example.invalid/comments/1",
  };
  const tooSoon = {
    id: "2",
    createdAt: "2026-04-26T10:01:59Z",
    user: "chatgpt-codex-connector[bot]",
    url: "https://example.invalid/comments/2",
  };
  const afterBuffer = {
    id: "3",
    createdAt: "2026-04-26T10:02:00Z",
    user: "chatgpt-codex-connector[bot]",
    url: "https://example.invalid/comments/3",
  };

  assert.equal(
    hasNewCompletionComment(null, sameSecond, "2026-04-26T10:01:00Z", { bufferSeconds: 0 }),
    false,
  );
  assert.equal(
    hasNewCompletionComment(null, tooSoon, "2026-04-26T10:01:00Z", { bufferSeconds: 60 }),
    false,
  );
  assert.equal(
    hasNewCompletionComment(null, afterBuffer, "2026-04-26T10:01:00Z", { bufferSeconds: 60 }),
    true,
  );
});

test("requires Codex reviews to be strictly after the marker", () => {
  const sameSecondReview = {
    id: "2",
    submittedAt: "2026-04-26T10:01:00Z",
  };
  const afterMarkerReview = {
    id: "3",
    submittedAt: "2026-04-26T10:01:01Z",
  };

  assert.equal(
    hasNewReviewTransition(null, sameSecondReview, "2026-04-26T10:01:00Z"),
    false,
  );
  assert.equal(
    hasNewReviewTransition(null, afterMarkerReview, "2026-04-26T10:01:00Z"),
    true,
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

test("max wait timeout takes precedence over marker retry outcomes", () => {
  assert.equal(
    markerTimeoutOutcome(
      {
        state: "waiting_ack",
        ackDeadlineAt: "2026-04-26T10:01:00Z",
        nextRetryAt: "2026-04-26T10:01:00Z",
        maxWaitDeadlineAt: "2026-04-26T10:02:00Z",
      },
      Date.parse("2026-04-26T10:03:00Z"),
    ),
    "max_wait",
  );
  assert.equal(
    markerTimeoutOutcome(
      {
        state: "waiting_result",
        resultDeadlineAt: "2026-04-26T10:01:00Z",
        maxWaitDeadlineAt: "2026-04-26T10:02:00Z",
      },
      Date.parse("2026-04-26T10:03:00Z"),
    ),
    "max_wait",
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

test("waiting-result markers do not consume repeated ack signals before stalled retry", () => {
  const activeMarker = {
    state: "waiting_result",
    createdAt: "2026-04-26T10:00:00Z",
    resultDeadlineAt: "2026-04-26T10:10:00Z",
    maxWaitDeadlineAt: "2026-04-26T12:00:00Z",
  };
  const eyes = {
    id: "1",
    content: "eyes",
    createdAt: "2026-04-26T10:01:00Z",
    user: "chatgpt-codex-connector[bot]",
  };
  const review = {
    id: "2",
    submittedAt: "2026-04-26T10:02:00Z",
  };

  assert.equal(markerTimeoutOutcome(activeMarker, Date.parse("2026-04-26T10:11:00Z")), "stalled");
  assert.equal(hasNewEyesTransition(null, eyes, activeMarker.createdAt), true);
  assert.equal(hasNewReviewTransition(null, review, activeMarker.createdAt), true);
  assert.equal(markerCanAcceptAckSignal(activeMarker), false);
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
  assert.equal(retryAfterDelayMs(" ", 100), 100);
  assert.equal(retryAfterDelayMs("-1", 100), 100);
  assert.equal(retryAfterDelayMs("1.5", 100), 100);
  assert.equal(retryAfterDelayMs("1e2", 100), 100);
  assert.equal(
    retryAfterDelayMs("Wed, 21 Oct 2015 07:28:00 GMT", 100),
    0,
  );
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

test("normalizes legacy finding ID arrays into a bounded deterministic audit summary", () => {
  const findingIds = Array.from(
    { length: 5_000 },
    (_, index) => `thread:thread-${String(index).padStart(5, "0")}`,
  );
  const state = {
    version: 1,
    createdAt: "2026-04-26T10:00:00Z",
    updatedAt: "2026-04-26T10:01:00Z",
    statusHead: "abc123",
    bootstrap: {
      status: "closed",
      currentHeadFindingIds: [...findingIds].reverse(),
    },
    activeMarker: null,
    history: [{
      id: "1",
      outcome: "failed_findings",
      currentHeadFindingIds: findingIds,
    }],
  };

  const body = buildStateCommentBody(state);
  const parsed = parseStateCommentBody(body);
  const expectedSummary = summarizeFindingsForState({ ids: findingIds });

  assert.equal(Buffer.byteLength(body, "utf8") <= MAX_STATE_COMMENT_BYTES, true);
  assert.equal("currentHeadFindingIds" in parsed.bootstrap, false);
  assert.equal("currentHeadFindingIds" in parsed.history[0], false);
  assert.deepEqual(parsed.bootstrap.currentHeadFindings, expectedSummary);
  assert.deepEqual(parsed.history[0].currentHeadFindings, expectedSummary);
  assert.equal(parsed.history[0].currentHeadFindings.count, findingIds.length);
  assert.equal(
    parsed.history[0].currentHeadFindings.sampleIds.length,
    MAX_FINDING_ID_SAMPLES,
  );
  assert.match(
    parsed.history[0].currentHeadFindings.idDigest,
    /^sha256:[0-9a-f]{64}$/,
  );
});

test("finding audit digests are independent of evidence ordering", () => {
  const forward = summarizeFindingsForState({
    ids: ["thread:charlie", "thread:alpha", "thread:bravo"],
  });
  const reverse = summarizeFindingsForState({
    ids: ["thread:bravo", "thread:alpha", "thread:charlie"],
  });

  assert.deepEqual(forward, reverse);
  assert.deepEqual(forward.sampleIds, [
    "thread:alpha",
    "thread:bravo",
    "thread:charlie",
  ]);
});

test("rejects state comments above the explicit serialized byte bound", () => {
  assert.throws(
    () => buildStateCommentBody({
      version: 1,
      createdAt: "2026-04-26T10:00:00Z",
      updatedAt: "2026-04-26T10:01:00Z",
      statusHead: "abc123",
      bootstrap: { status: "closed" },
      activeMarker: null,
      history: [],
      auditPadding: "x".repeat(MAX_STATE_COMMENT_BYTES),
    }),
    new RegExp(`maximum is ${MAX_STATE_COMMENT_BYTES}`),
  );
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

  assert.equal(markerBody.startsWith("@codex review\n\n<!-- codex-review-gate-marker"), true);
  assert.equal(markerBody.includes("[!NOTE]"), false);

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

test("rejects a marker comment with a missing or conflicting schema version", () => {
  const markerBody = buildMarkerCommentBody({
    headSha: "abc123",
    runUrl: "https://example.invalid/runs/1",
    runId: "1",
    runAttempt: "1",
    attempt: 1,
    baseline: { plusOne: null, eyes: null },
    state: "waiting_ack",
  });

  assert.equal(
    parseMarkerCommentBody(markerBody.replace('"version": 1', '"version": 2')),
    null,
  );
  assert.equal(
    parseMarkerCommentBody(markerBody.replace('  "version": 1,\n', "")),
    null,
  );

  const olderValid = {
    id: 1,
    body: markerBody,
    user: { login: "github-actions[bot]" },
  };
  const newerIncompatible = {
    id: 2,
    body: markerBody.replace('"version": 1', '"version": 2'),
    user: { login: "github-actions[bot]" },
  };
  assert.equal(
    findLatestTrustedMarkerComment([olderValid, newerIncompatible]),
    null,
  );
});

test("persists marker recovery fields when present", () => {
  const markerBody = buildMarkerCommentBody({
    headSha: "abc123",
    runUrl: "https://example.invalid/runs/1",
    runId: "1",
    runAttempt: "1",
    attempt: 1,
    baseline: { plusOne: null, eyes: null },
    state: "waiting_ack",
    ackTimeoutSeconds: 300,
    headStartedAt: "2026-04-26T10:00:00Z",
    maxWaitDeadlineAt: "2026-04-26T12:00:00Z",
  });
  const marker = markerFromComment({
    id: 2,
    body: markerBody,
    created_at: "2026-04-26T10:01:00Z",
    user: { login: "github-actions[bot]" },
  });

  assert.equal(marker.ackTimeoutSeconds, 300);
  assert.equal(marker.headStartedAt, "2026-04-26T10:00:00Z");
  assert.equal(marker.maxWaitDeadlineAt, "2026-04-26T12:00:00Z");
});

test("accepts a live-style clean Codex issue-comment artifact with a 10-character commit", () => {
  const artifact = parseCodexIssueCommentArtifact(
    liveCodexIssueComment([
      "Codex Review: Didn't find any major issues. Another round soon, please!",
      "",
      "**Reviewed commit:** `abcdef1234`",
    ].join("\n")),
    { owner: "owner", repo: "repo" },
  );

  assert.deepEqual(artifact, {
    source: "issue-comment",
    id: "101",
    createdAt: "2026-07-23T08:00:00Z",
    url: "https://github.com/owner/repo/issues/1#issuecomment-101",
    kind: "clean",
    commitRef: "abcdef1234",
  });
});

test("requires canonical positive integer IDs for provider terminal artifacts", () => {
  const invalidIds = [
    undefined,
    null,
    0,
    -1,
    1.5,
    "101",
    Number.MAX_SAFE_INTEGER + 1,
  ];

  for (const id of invalidIds) {
    const comment = liveCodexIssueComment([
      "Codex Review: Didn't find any major issues.",
      "",
      "**Reviewed commit:** `abcdef1234`",
    ].join("\n"), { id });
    const review = liveCodexReview({ id });
    for (const artifact of [
      parseCodexIssueCommentArtifact(comment, { owner: "owner", repo: "repo" }),
      parseCodexReviewArtifact(review, { owner: "owner", repo: "repo" }),
    ]) {
      assert.equal(artifact.kind, "malformed", String(id));
      assert.match(artifact.reason, /valid positive integer id/);
    }
  }
});

test("accepts observed and unknown benign clean taglines as presentation text", () => {
  for (const tagline of [
    "Nice work!",
    "Chef's kiss.",
    "What shall we delve into next?",
    "Already looking forward to the next diff.",
    "Keep them coming.",
    ":rocket:",
    ":tada:",
    "Swish.",
    "Another round soon, please!",
    "Breezy!",
    "Can't wait for the next one!",
    "More of your lovely PRs please.",
    "Bravo.",
    "Swish!",
    "Keep it up!",
    "Delightful!",
    "Hooray!",
    "You're on a roll.",
    ":+1:",
    "Keep them coming!",
    "Another round soon, please.",
    "Excellent—what's next?",
    "Ship-shape?",
    "Consider me impressed!",
    "Great work but the update is complete!",
    "Update complete!",
    "Change looks excellent!",
    "Fix landed—great work!",
    "太棒了！",
    "👩🏽‍💻 Ready for another round!",
    "🏳️‍🌈 Wonderful!",
    "👨‍❤️‍💋‍👨 Delightful!",
    "Cafe\u0301, ❤️ 1️⃣ ❤️‍🔥",
  ]) {
    const artifact = parseCleanTagline(tagline, { disclosure: true });
    assert.equal(artifact.kind, "clean", tagline);
  }
});

test("enforces clean tagline separator, trimming, and one-line structure", () => {
  const invalidFirstLines = [
    "Codex Review: Didn't find any major issues. ",
    "Codex Review: Didn't find any major issues.  Nice work!",
    "Codex Review: Didn't find any major issues.\tNice work!",
    "Codex Review: Didn't find any major issues.\u00A0Nice work!",
    "Codex Review: Didn't find any major issues. Nice work! ",
    "Codex Review: Didn't find any major issues. Nice\u00A0work!",
    "Codex Review: Didn't find any major issues. Nice\u2003work!",
    "Codex Review: Didn't find any major issues. Nice work!\nSecond line",
  ];

  for (const firstLine of invalidFirstLines) {
    assert.equal(
      parseCleanIssueCommentFirstLine(firstLine).kind,
      "malformed",
      JSON.stringify(firstLine),
    );
  }
});

test("enforces clean tagline UTF-16 and grapheme budgets", () => {
  const exactCodeUnitAndGraphemeLimit = `${"🚀".repeat(79)}a\u0301`;
  assert.equal(exactCodeUnitAndGraphemeLimit.length, 160);
  assert.equal(parseCleanTagline(exactCodeUnitAndGraphemeLimit).kind, "clean");

  const overCodeUnitLimit = `${exactCodeUnitAndGraphemeLimit}\u0301`;
  assert.equal(overCodeUnitLimit.length, 161);
  assert.equal(parseCleanTagline(overCodeUnitLimit).kind, "malformed");

  assert.equal(parseCleanTagline("a".repeat(80)).kind, "clean");
  assert.equal(parseCleanTagline("a".repeat(81)).kind, "malformed");
});

test("rejects unsafe Unicode scalars and format controls in clean taglines", () => {
  for (const tagline of [
    "Nice\u0000work!",
    "Nice\uE000work!",
    "Nice\uD800work!",
    "Nice\uDC00work!",
    "Nice\u202Ework!",
    "Nice\u2060work!",
    "Nice\u200Bwork!",
    "Nice\u200Dwork!",
    "😀‍😀 Nice work!",
    "❤︎‍🔥 Nice work!",
    "a\u034Fb",
    "\u3164",
    "\uFE0F",
    "\u0301",
    "\u0378",
  ]) {
    assert.equal(
      parseCleanTagline(tagline).kind,
      "malformed",
      JSON.stringify(tagline),
    );
  }

  assert.equal(
    parseCleanTagline("👩🏽‍💻 Ready for another round!").kind,
    "clean",
  );
});

test("rejects markup, URLs, commands, and schema tokens in clean taglines", () => {
  for (const tagline of [
    "**Nice work!**",
    "<strong>Nice work!</strong>",
    "[Nice work!](https://example.com)",
    "See https://example.com.",
    "See example.com/docs.",
    "`Nice work!`",
    "@codex review",
    "Coverage: `parser`.",
    "Reviewed commit: abcdef1234.",
    "No findings.",
  ]) {
    assert.equal(parseCleanTagline(tagline).kind, "malformed", tagline);
  }
});

test("rejects clearly actionable or contradictory clean taglines", () => {
  for (const tagline of [
    "Please fix the parser.",
    "Fix the parser.",
    "Update this parser.",
    "Verify it.",
    "Consider adding a regression test.",
    "The parser should be updated.",
    "One issue remains.",
    "Great work but please verify the fallback.",
  ]) {
    assert.equal(parseCleanTagline(tagline).kind, "malformed", tagline);
  }
});

test("accepts a CRLF clean issue comment with the official disclosure", () => {
  const artifact = parseCodexIssueCommentArtifact(
    liveCodexIssueComment([
      "Codex Review: Didn't find any major issues. Nice work!",
      "",
      "**Reviewed commit:** `abcdef1234`",
      "",
      officialCodexDisclosure(),
    ].join("\n").replace(/\n/g, "\r\n")),
    { owner: "owner", repo: "repo" },
  );

  assert.equal(artifact.kind, "clean");
  assert.equal(artifact.commitRef, "abcdef1234");
});

test("rejects contradictory or schema-drift content embedded in clean issue comments", () => {
  const cases = [
    [
      "Codex Review: Didn't find any major issues. Another round soon, please!",
      "",
      "**Reviewed commit:** `abcdef1234`",
      "",
      "### 💡 Codex Review",
    ].join("\n"),
    [
      "Codex Review: Didn't find any major issues. Breezy!",
      "",
      "**Reviewed commit:** `abcdef1234`",
      "",
      `https://github.com/owner/repo/blob/${FULL_SHA_A}/src/core.mjs`,
    ].join("\n"),
    [
      "Codex Review: Didn't find any major issues. Please fix the parser.",
      "",
      "**Reviewed commit:** `abcdef1234`",
    ].join("\n"),
    [
      "Codex Review: Didn't find any major issues. Chef's kiss.",
      "",
      "**Reviewed commit:** `abcdef1234`",
      "",
      officialCodexDisclosure().replace("</details>", "Please fix this.\n</details>"),
    ].join("\n"),
  ];

  for (const body of cases) {
    const artifact = parseCodexIssueCommentArtifact(
      liveCodexIssueComment(body),
      { owner: "owner", repo: "repo" },
    );
    assert.equal(artifact.kind, "malformed");
  }

  const findingPriority = parseCodexIssueCommentArtifact(
    liveCodexIssueComment(cases[0]),
    { owner: "owner", repo: "repo" },
  );
  assert.equal(
    findingPriority.reason,
    "clean Codex issue comment contains finding-formatted content",
  );
});

test("rejects official Codex issue comments with missing or wrong REST identity fields", () => {
  const body = [
    "Codex Review: Didn't find any major issues.",
    "",
    "**Reviewed commit:** `abcdef1234`",
  ].join("\n");
  const cases = [
    {
      name: "missing Bot type",
      overrides: {
        user: { login: "chatgpt-codex-connector[bot]" },
      },
      reason: /author is not a Bot/,
    },
    {
      name: "wrong Bot type",
      overrides: {
        user: { login: "chatgpt-codex-connector[bot]", type: "User" },
      },
      reason: /author is not a Bot/,
    },
    {
      name: "missing GitHub App",
      overrides: {
        performed_via_github_app: undefined,
      },
      reason: /is not bound to chatgpt-codex-connector/,
    },
    {
      name: "wrong GitHub App",
      overrides: {
        performed_via_github_app: { slug: "other-app" },
      },
      reason: /is not bound to chatgpt-codex-connector/,
    },
  ];

  for (const { name, overrides, reason } of cases) {
    const artifact = parseCodexIssueCommentArtifact(
      liveCodexIssueComment(body, overrides),
      { owner: "owner", repo: "repo" },
    );
    assert.equal(artifact.kind, "malformed", name);
    assert.match(artifact.reason, reason, name);
  }
});

test("accepts only exact 10- or 40-character clean issue-comment commit markers", () => {
  const parseMarker = (commitRef) => parseCodexIssueCommentArtifact(
    liveCodexIssueComment([
      "Codex Review: Didn't find any major issues.",
      "",
      `**Reviewed commit:** \`${commitRef}\``,
    ].join("\n")),
    { owner: "owner", repo: "repo" },
  );

  for (const length of [7, 9, ...Array.from({ length: 29 }, (_, index) => index + 11)]) {
    const artifact = parseMarker("a".repeat(length));
    assert.equal(artifact.kind, "malformed", `commit marker length ${length}`);
    assert.equal(
      artifact.reason,
      "clean Codex issue comment must contain exactly one Reviewed commit marker",
      `commit marker length ${length}`,
    );
  }

  assert.deepEqual(parseMarker(FULL_SHA_A), {
    source: "issue-comment",
    id: "101",
    createdAt: "2026-07-23T08:00:00Z",
    url: "https://github.com/owner/repo/issues/1#issuecomment-101",
    kind: "clean",
    commitRef: FULL_SHA_A,
  });
});

test("rejects clean issue comments with missing or conflicting commit markers", () => {
  const missing = parseCodexIssueCommentArtifact(
    liveCodexIssueComment("Codex Review: Didn't find any major issues."),
    { owner: "owner", repo: "repo" },
  );
  const conflicting = parseCodexIssueCommentArtifact(
    liveCodexIssueComment([
      "Codex Review: Didn't find any major issues.",
      "",
      "**Reviewed commit:** `aaaaaaaaaa`",
      "**Reviewed commit:** `bbbbbbbbbb`",
    ].join("\n")),
    { owner: "owner", repo: "repo" },
  );

  for (const artifact of [missing, conflicting]) {
    assert.equal(artifact.kind, "malformed");
    assert.equal(
      artifact.reason,
      "clean Codex issue comment must contain exactly one Reviewed commit marker",
    );
  }

  const splitAcrossLines = parseCodexIssueCommentArtifact(
    liveCodexIssueComment([
      "Codex Review: Didn't find any major issues.",
      "",
      "**Reviewed commit:**",
      "`abcdef1234`",
    ].join("\n")),
    { owner: "owner", repo: "repo" },
  );
  assert.equal(splitAcrossLines.kind, "malformed");

  const inlineTail = parseCodexIssueCommentArtifact(
    liveCodexIssueComment([
      "Codex Review: Didn't find any major issues.",
      "",
      "**Reviewed commit:** `abcdef1234` please fix this",
    ].join("\n")),
    { owner: "owner", repo: "repo" },
  );
  assert.equal(inlineTail.kind, "malformed");

  const missingBlankLine = parseCodexIssueCommentArtifact(
    liveCodexIssueComment([
      "Codex Review: Didn't find any major issues.",
      "**Reviewed commit:** `abcdef1234`",
    ].join("\n")),
    { owner: "owner", repo: "repo" },
  );
  assert.equal(missingBlankLine.kind, "malformed");
});

test("classifies noncanonical Codex terminal prefixes as malformed", () => {
  for (const body of [
    "codex review : unsupported terminal format",
    "Codex Review result: unsupported terminal format",
    "### 🤖 Codex Review outcome: unsupported terminal format",
    "Codex Review completed",
  ]) {
    const artifact = parseCodexIssueCommentArtifact(
      liveCodexIssueComment(body),
      { owner: "owner", repo: "repo" },
    );

    assert.equal(artifact.kind, "malformed", body);
    assert.equal(
      artifact.reason,
      "unrecognized Codex terminal issue-comment format",
      body,
    );
  }
});

test("recognizes complete leading emoji graphemes in Codex terminal headings", () => {
  const variants = [
    ["skin-tone modifier", "👍🏽"],
    ["regional-indicator flag", "🇺🇸"],
    ["tag flag", "🏴󠁧󠁢󠁥󠁮󠁧󠁿"],
    ["keycap", "1️⃣"],
    ["variation selector 16", "☀️"],
    ["variation selector 15", "☀︎"],
    ["ZWJ sequence", "👩🏽‍💻"],
  ];

  for (const [name, emoji] of variants) {
    const body = `### ${emoji} Codex Review outcome: unsupported terminal format`;
    assert.deepEqual(
      parseCodexIssueCommentTerminalHeading(body),
      {
        terminalLooking: true,
        progress: false,
      },
      name,
    );
    const artifact = parseCodexIssueCommentArtifact(
      liveCodexIssueComment(body),
      { owner: "owner", repo: "repo" },
    );
    assert.equal(artifact.kind, "malformed", name);
    assert.equal(
      artifact.reason,
      "unrecognized Codex terminal issue-comment format",
      name,
    );
  }
});

test("recognizes progress headings after complete leading emoji graphemes", () => {
  for (const emoji of [
    "👍🏽",
    "🇺🇸",
    "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    "1️⃣",
    "☀️",
    "☀︎",
    "👩🏽‍💻",
  ]) {
    assert.deepEqual(
      parseCodexIssueCommentTerminalHeading(
        `### ${emoji} Codex Review still in progress: run=123`,
      ),
      {
        terminalLooking: true,
        progress: true,
      },
      emoji,
    );
  }
});

test("does not treat a progress first line with a terminal body tail as progress", () => {
  const body = [
    "### 👍🏽 Codex Review in progress",
    "### 💡 Codex Review",
    `https://github.com/owner/repo/blob/${FULL_SHA_A}/src/core.mjs#L12`,
  ].join("\n");

  assert.deepEqual(
    parseCodexIssueCommentTerminalHeading(body),
    {
      terminalLooking: true,
      progress: false,
    },
  );
  const artifact = parseCodexIssueCommentArtifact(
    liveCodexIssueComment(body),
    { owner: "owner", repo: "repo" },
  );
  assert.equal(artifact.kind, "malformed");
});

test("does not let alternate line terminators hide a terminal body tail as progress", () => {
  for (const separator of [
    "\r",
    "\u000B",
    "\u000C",
    "\u0085",
    "\u2028",
    "\u2029",
  ]) {
    const body = [
      "Codex Review in progress: queued",
      "### 💡 Codex Review",
      `https://github.com/owner/repo/blob/${FULL_SHA_A}/src/core.mjs#L12`,
    ].join(separator);
    assert.deepEqual(
      parseCodexIssueCommentTerminalHeading(body),
      {
        terminalLooking: true,
        progress: false,
      },
      JSON.stringify(separator),
    );
    const artifact = parseCodexIssueCommentArtifact(
      liveCodexIssueComment(body),
      { owner: "owner", repo: "repo" },
    );
    assert.equal(artifact.kind, "malformed", JSON.stringify(separator));
  }
});

test("fails closed when an emoji-prefixed terminal heading exceeds parser caps", () => {
  for (const body of [
    `### ${"💡".repeat(80)} Codex Review outcome: unsupported`,
    `### ${"👩🏽‍💻".repeat(80)} Codex Review outcome: unsupported`,
    `### ${"🏴󠁧󠁢󠁥󠁮󠁧󠁿".repeat(80)} Codex Review outcome: unsupported`,
  ]) {
    assert.deepEqual(
      parseCodexIssueCommentTerminalHeading(body),
      {
        terminalLooking: true,
        progress: false,
      },
    );
    const artifact = parseCodexIssueCommentArtifact(
      liveCodexIssueComment(body),
      { owner: "owner", repo: "repo" },
    );
    assert.equal(artifact.kind, "malformed");
  }
});

test("fails closed when Markdown heading whitespace exhausts the parser window", () => {
  const body =
    `### ${" ".repeat(510)}💡 Codex Review outcome: unsupported terminal format`;

  assert.deepEqual(
    parseCodexIssueCommentTerminalHeading(body),
    {
      terminalLooking: true,
      progress: false,
    },
  );
  const artifact = parseCodexIssueCommentArtifact(
    liveCodexIssueComment(body),
    { owner: "owner", repo: "repo" },
  );
  assert.equal(artifact.kind, "malformed");
});

test("treats an unknown single heading decorator as terminal-looking malformed", () => {
  for (const decorator of [
    "⟦future-decorator⟧",
    "x".repeat(64),
    "x".repeat(65),
  ]) {
    const body =
      `### ${decorator} Codex Review outcome: unsupported terminal format`;
    assert.deepEqual(
      parseCodexIssueCommentTerminalHeading(body),
      {
        terminalLooking: true,
        progress: false,
      },
      `decorator length ${decorator.length}`,
    );
    const artifact = parseCodexIssueCommentArtifact(
      liveCodexIssueComment(body),
      { owner: "owner", repo: "repo" },
    );
    assert.equal(artifact.kind, "malformed");
    assert.equal(
      artifact.reason,
      "unrecognized Codex terminal issue-comment format",
    );
  }
});

test("ignores Codex progress prose that is not terminal-looking", () => {
  for (const body of [
    "Codex Review in progress",
    "Codex review still in progress.",
    "### 🤖 Codex Review in progress: run=123 status=queued",
  ]) {
    assert.equal(
      parseCodexIssueCommentArtifact(
        liveCodexIssueComment(body),
        { owner: "owner", repo: "repo" },
      ),
      null,
      body,
    );
  }
});

test("does not ignore unbounded Codex progress metadata", () => {
  const artifact = parseCodexIssueCommentArtifact(
    liveCodexIssueComment(`Codex Review in progress: ${"x".repeat(161)}`),
    { owner: "owner", repo: "repo" },
  );

  assert.equal(artifact.kind, "malformed");
  assert.equal(artifact.reason, "unrecognized Codex terminal issue-comment format");
});

test("accepts an exact-repository full-SHA Codex issue-comment finding", () => {
  const artifact = parseCodexIssueCommentArtifact(
    liveCodexIssueComment([
      "### 💡 Codex Review",
      "",
      `https://github.com/owner/repo/blob/${FULL_SHA_A}/src/lib%20name.rs#L12-L14`,
    ].join("\n")),
    { owner: "owner", repo: "repo" },
  );

  assert.deepEqual(artifact, {
    source: "issue-comment",
    id: "101",
    createdAt: "2026-07-23T08:00:00Z",
    url: "https://github.com/owner/repo/issues/1#issuecomment-101",
    kind: "finding",
    headSha: FULL_SHA_A,
    samples: ["src/lib name.rs:12"],
  });
});

test("rejects mixed or malformed Codex issue-comment finding links", () => {
  const cases = [
    {
      name: "mixed repository",
      links: [
        `https://github.com/owner/repo/blob/${FULL_SHA_A}/src/one.mjs#L1`,
        `https://github.com/other/repo/blob/${FULL_SHA_A}/src/two.mjs#L2`,
      ],
      reason: "Codex finding link targets a different repository",
    },
    {
      name: "mixed commit",
      links: [
        `https://github.com/owner/repo/blob/${FULL_SHA_A}/src/one.mjs#L1`,
        `https://github.com/owner/repo/blob/${FULL_SHA_B}/src/two.mjs#L2`,
      ],
      reason: "Codex finding links target conflicting commits",
    },
    {
      name: "short commit",
      links: ["https://github.com/owner/repo/blob/abcdef1234/src/one.mjs#L1"],
      reason: "Codex finding must contain only exact full-SHA github.com blob links",
    },
    {
      name: "malformed line anchor",
      links: [`https://github.com/owner/repo/blob/${FULL_SHA_A}/src/one.mjs#Lx`],
      reason: "Codex finding must contain only exact full-SHA github.com blob links",
    },
  ];

  for (const { name, links, reason } of cases) {
    const artifact = parseCodexIssueCommentArtifact(
      liveCodexIssueComment(["### 💡 Codex Review", "", ...links].join("\n")),
      { owner: "owner", repo: "repo" },
    );
    assert.equal(artifact.kind, "malformed", name);
    assert.equal(artifact.reason, reason, name);
  }
});

test("accepts a Bot-authored clean review bound to a full parent commit", () => {
  assert.deepEqual(
    parseCodexReviewArtifact(liveCodexReview(), { owner: "owner", repo: "repo" }),
    {
      source: "pull-request-review",
      id: "201",
      createdAt: "2026-07-23T08:01:00Z",
      url: "https://github.com/owner/repo/pull/1#pullrequestreview-201",
      kind: "clean",
      headSha: FULL_SHA_A,
    },
  );
});

test("recognizes only the closed official inline-parent review wrapper", () => {
  const review = liveCodexReview({
    state: "COMMENTED",
    body: officialInlineParentReviewBody(),
  });

  assert.equal(codexInlineParentReviewBodyHasClosedGrammar(review), true);
  assert.equal(
    codexInlineParentReviewBodyHasClosedGrammar({
      ...review,
      body: officialInlineParentReviewBody(FULL_SHA_B.slice(0, 10)),
    }),
    false,
  );
  assert.equal(
    codexInlineParentReviewBodyHasClosedGrammar({
      ...review,
      body: `${review.body}\nUnexpected terminal content`,
    }),
    false,
  );
  assert.equal(
    codexInlineParentReviewBodyHasClosedGrammar({
      ...review,
      body: "Unknown nonempty parent review body.",
    }),
    false,
  );
  assert.equal(
    codexInlineParentReviewBodyHasClosedGrammar({
      ...review,
      body: "### 💡 Codex Review",
    }),
    false,
  );
});

test("accepts only closed legacy or extended-clean APPROVED review bodies", () => {
  for (const body of [
    "Looks good.",
    "Coverage: `parseCodexIssueCommentArtifact`, `test/core.test.mjs`.\n\nNo findings.",
    "Review coverage: `error-paths` and `focused-tests`.\n\nNo findings.",
    "Coverage: `docs/high-level-design.md`, `test/findings.test.mjs`, and `src/low-level-api.mjs`.\n\nNo findings.",
    "Coverage: `critical_path`, `findingParser`, and `authenticator`.\n\nNo findings.",
  ]) {
    const artifact = parseCodexReviewArtifact(
      liveCodexReview({ body }),
      { owner: "owner", repo: "repo" },
    );
    assert.equal(artifact.kind, "clean", body);
  }
});

test("rejects contradictory content anywhere in APPROVED review bodies", () => {
  const cases = [
    `Reviewed the parser.\n### 💡 Codex Review\nNo findings.`,
    `Coverage: https://github.com/owner/repo/blob/${FULL_SHA_A}/src/core.mjs.\nNo findings.`,
    "Reviewed a race that drops writes.\nNo findings.",
    ...[
      "P0",
      "P1",
      "P2",
      "P3",
      "S0",
      "S1",
      "S2",
      "S3",
      "critical",
      "high",
      "medium",
      "low",
      "finding",
      "findings",
      "blocker",
      "blocking",
      "found",
      "detected",
      "data-loss",
      "auth-bypass",
    ].map((target) => `Coverage: \`${target}\`.\n\nNo findings.`),
    "![P2 Badge](https://img.shields.io/badge/P2-finding-yellow)\nNo findings.",
    "No findings.\nReviewed the parser.",
    "No findings.\nNo findings.",
  ];

  for (const body of cases) {
    const artifact = parseCodexReviewArtifact(
      liveCodexReview({ body }),
      { owner: "owner", repo: "repo" },
    );
    assert.equal(artifact.kind, "malformed", body);
  }
});

test("rejects clean Codex reviews with a wrong user type or short parent commit", () => {
  const wrongType = parseCodexReviewArtifact(
    liveCodexReview({
      user: { login: "chatgpt-codex-connector[bot]", type: "User" },
    }),
    { owner: "owner", repo: "repo" },
  );
  const shortCommit = parseCodexReviewArtifact(
    liveCodexReview({ commit_id: "abcdef1234" }),
    { owner: "owner", repo: "repo" },
  );

  assert.equal(wrongType.kind, "malformed");
  assert.equal(wrongType.reason, "configured Codex review author is not a Bot");
  assert.equal(shortCommit.kind, "malformed");
  assert.equal(shortCommit.reason, "Codex review is not bound to a full commit SHA");
});

test("rejects an APPROVED review whose body is finding-formatted", () => {
  const artifact = parseCodexReviewArtifact(
    liveCodexReview({
      state: "APPROVED",
      body: [
        "### 💡 Codex Review",
        "",
        `https://github.com/owner/repo/blob/${FULL_SHA_A}/src/lib.mjs#L7`,
      ].join("\n"),
    }),
    { owner: "owner", repo: "repo" },
  );

  assert.equal(artifact.kind, "malformed");
  assert.equal(
    artifact.reason,
    "Codex review state conflicts with its non-clean body",
  );
});

test("rejects a Codex review finding whose URL conflicts with the parent commit", () => {
  const artifact = parseCodexReviewArtifact(
    liveCodexReview({
      state: "COMMENTED",
      body: [
        "### 💡 Codex Review",
        "",
        `https://github.com/owner/repo/blob/${FULL_SHA_B}/src/lib.mjs#L7`,
      ].join("\n"),
    }),
    { owner: "owner", repo: "repo" },
  );

  assert.equal(artifact.kind, "malformed");
  assert.equal(
    artifact.reason,
    "Codex review finding links conflict with the parent review commit",
  );
});

test("sorts same-channel Codex artifacts by provider ID when timestamps tie", () => {
  const sorted = sortCodexArtifactsNewestFirst([
    {
      source: "issue-comment",
      id: "9",
      createdAt: "2026-07-23T08:00:00Z",
    },
    {
      source: "pull-request-review",
      id: "1",
      createdAt: "2026-07-23T08:01:00Z",
    },
    {
      source: "issue-comment",
      id: "10",
      createdAt: "2026-07-23T08:00:00Z",
    },
  ]);

  assert.deepEqual(sorted.map((artifact) => artifact.id), ["1", "10", "9"]);
});

test("retains historical unresolved Codex threads even when they are outdated", () => {
  const result = collectUnresolvedCodexThreadFindings(
    [
      {
        id: 301,
        node_id: reviewCommentNodeId(301),
        path: "src/history.mjs",
        original_line: 7,
        original_commit_id: FULL_SHA_B,
        pull_request_review_id: 401,
        user: {
          login: "chatgpt-codex-connector[bot]",
          type: "Bot",
        },
      },
    ],
    [
      liveCodexReview({
        id: 401,
        state: "COMMENTED",
        commit_id: FULL_SHA_B,
      }),
    ],
    [
      {
        id: "historical-thread",
        isResolved: false,
        isOutdated: true,
        path: "src/history.mjs",
        line: 7,
        comments: { nodes: [graphqlReviewComment(301)] },
      },
    ],
    undefined,
    FULL_SHA_A,
  );

  assert.deepEqual(result, {
    count: 1,
    ids: ["thread:historical-thread"],
    samples: ["src/history.mjs:7"],
    errors: [],
    transientErrors: [],
  });
});

test("matches unresolved Codex threads with review-comment IDs above signed 32-bit range", () => {
  const result = collectUnresolvedCodexThreadFindings(
    [
      {
        id: LARGE_REVIEW_COMMENT_ID,
        node_id: LARGE_REVIEW_COMMENT_NODE_ID,
        path: "src/large-id.mjs",
        line: 8,
        original_commit_id: FULL_SHA_A,
        pull_request_review_id: 402,
        user: {
          login: "chatgpt-codex-connector[bot]",
          type: "Bot",
        },
      },
    ],
    [
      liveCodexReview({
        id: 402,
        state: "COMMENTED",
      }),
    ],
    [
      {
        id: "large-id-thread",
        isResolved: false,
        comments: {
          nodes: [{
            id: LARGE_REVIEW_COMMENT_NODE_ID,
            fullDatabaseId: String(LARGE_REVIEW_COMMENT_ID),
          }],
        },
      },
    ],
    undefined,
    FULL_SHA_A,
  );

  assert.deepEqual(result, {
    count: 1,
    ids: ["thread:large-id-thread"],
    samples: ["src/large-id.mjs:8"],
    errors: [],
    transientErrors: [],
  });
});

test("rejects duplicate REST parent review IDs instead of applying last-wins mapping", () => {
  const result = collectUnresolvedCodexThreadFindings(
    [{
      id: 930,
      node_id: reviewCommentNodeId(930),
      path: "src/duplicate-parent.mjs",
      line: 8,
      original_commit_id: FULL_SHA_A,
      pull_request_review_id: 430,
      user: {
        login: "chatgpt-codex-connector[bot]",
        type: "Bot",
      },
    }],
    [
      liveCodexReview({
        id: 430,
        state: "COMMENTED",
        commit_id: FULL_SHA_A,
      }),
      liveCodexReview({
        id: 430,
        state: "COMMENTED",
        commit_id: FULL_SHA_B,
      }),
    ],
    [{
      id: "duplicate-parent-thread",
      isResolved: false,
      comments: { nodes: [graphqlReviewComment(930)] },
    }],
    undefined,
    FULL_SHA_A,
  );

  assert.equal(result.count, 1);
  assert.deepEqual(result.errors, [
    "REST review snapshot contains duplicate numeric id 430",
  ]);
});

test("requires canonical string GraphQL fullDatabaseId values even for resolved threads", () => {
  for (const fullDatabaseId of [930, "0930", "-1", "1.5"]) {
    const result = collectUnresolvedCodexThreadFindings(
      [{
        id: 930,
        node_id: reviewCommentNodeId(930),
        user: { login: "octocat", type: "User" },
      }],
      [],
      [{
        id: "resolved-id-schema-thread",
        isResolved: true,
        comments: {
          nodes: [{
            id: reviewCommentNodeId(930),
            fullDatabaseId,
          }],
        },
      }],
      undefined,
      FULL_SHA_A,
    );

    assert.equal(result.count, 0, String(fullDatabaseId));
    assert.deepEqual(result.errors, [
      `resolved review thread resolved-id-schema-thread contains GraphQL comment ` +
        `${reviewCommentNodeId(930)} without a valid fullDatabaseId`,
    ]);
  }
});

test("resolved historical threads still require complete trusted identities", () => {
  const result = collectUnresolvedCodexThreadFindings(
    [
      {
        id: 302,
        node_id: reviewCommentNodeId(302),
        path: "src/resolved.mjs",
        original_line: 8,
        original_commit_id: "old",
        pull_request_review_id: 999,
        user: { login: "chatgpt-codex-connector[bot]" },
      },
    ],
    [],
    [
      {
        id: "resolved-historical-thread",
        isResolved: true,
        isOutdated: true,
        comments: { nodes: [graphqlReviewComment(302)] },
      },
    ],
    undefined,
    FULL_SHA_A,
  );

  assert.deepEqual(result, {
    count: 0,
    ids: [],
    samples: [],
    errors: ["review comment 302 author is not a Bot"],
    transientErrors: [],
  });
});

test("requires unresolved inline findings to bind through full parent and original commits", () => {
  const result = collectUnresolvedCodexThreadFindings(
    [
      {
        id: 303,
        node_id: reviewCommentNodeId(303),
        path: "src/valid.mjs",
        line: 9,
        original_commit_id: FULL_SHA_A,
        pull_request_review_id: 403,
        user: {
          login: "chatgpt-codex-connector[bot]",
          type: "Bot",
        },
      },
      {
        id: 304,
        node_id: reviewCommentNodeId(304),
        path: "src/short.mjs",
        line: 10,
        original_commit_id: "abcdef1234",
        pull_request_review_id: 404,
        user: {
          login: "chatgpt-codex-connector[bot]",
          type: "Bot",
        },
      },
    ],
    [
      liveCodexReview({ id: 403 }),
      liveCodexReview({ id: 404 }),
    ],
    [
      {
        id: "valid-binding",
        isResolved: false,
        comments: { nodes: [graphqlReviewComment(303)] },
      },
      {
        id: "short-binding",
        isResolved: false,
        comments: { nodes: [graphqlReviewComment(304)] },
      },
    ],
    undefined,
    FULL_SHA_A,
  );

  assert.deepEqual(result, {
    count: 2,
    ids: ["thread:valid-binding", "thread:short-binding"],
    samples: ["src/valid.mjs:9", "src/short.mjs:10"],
    errors: ["review comment 304 is not bound through full commit SHAs"],
    transientErrors: [],
  });
});

test("reports missing current threads, missing parents, and conflicting inline commits", () => {
  const codexUser = {
    login: "chatgpt-codex-connector[bot]",
    type: "Bot",
  };
  const result = collectUnresolvedCodexThreadFindings(
    [
      {
        id: 305,
        node_id: reviewCommentNodeId(305),
        original_commit_id: FULL_SHA_A,
        pull_request_review_id: 405,
        user: codexUser,
      },
      {
        id: 306,
        node_id: reviewCommentNodeId(306),
        path: "src/missing-parent.mjs",
        line: 11,
        original_commit_id: FULL_SHA_B,
        pull_request_review_id: 999,
        user: codexUser,
      },
      {
        id: 307,
        node_id: reviewCommentNodeId(307),
        path: "src/conflict.mjs",
        line: 12,
        original_commit_id: FULL_SHA_A,
        pull_request_review_id: 407,
        user: codexUser,
      },
      {
        id: 308,
        node_id: reviewCommentNodeId(308),
        original_commit_id: FULL_SHA_B,
        pull_request_review_id: 408,
        user: codexUser,
      },
      {
        id: 309,
        node_id: reviewCommentNodeId(309),
        path: "src/invalid-parent.mjs",
        line: 13,
        original_commit_id: FULL_SHA_A,
        pull_request_review_id: null,
        user: codexUser,
      },
    ],
    [
      liveCodexReview({
        id: 407,
        commit_id: FULL_SHA_B,
      }),
    ],
    [
      {
        id: "missing-parent",
        isResolved: false,
        comments: { nodes: [graphqlReviewComment(306)] },
      },
      {
        id: "commit-conflict",
        isResolved: false,
        comments: { nodes: [graphqlReviewComment(307)] },
      },
      {
        id: "invalid-parent",
        isResolved: false,
        comments: { nodes: [graphqlReviewComment(309)] },
      },
    ],
    undefined,
    FULL_SHA_A,
  );

  assert.deepEqual(result, {
    count: 3,
    ids: ["thread:missing-parent", "thread:commit-conflict", "thread:invalid-parent"],
    samples: [
      "src/missing-parent.mjs:11",
      "src/conflict.mjs:12",
      "src/invalid-parent.mjs:13",
    ],
    errors: [
      "review comment 307 original commit conflicts with its parent review",
      "review comment 309 has no valid parent review id",
    ],
    transientErrors: [
      "review comment 305 has no loaded review thread",
      "review comment 306 has no loaded parent review",
      "review comment 308 has no loaded review thread",
    ],
  });
});

test("rejects unresolved GraphQL comments missing from the complete REST snapshot", () => {
  const result = collectUnresolvedCodexThreadFindings(
    [],
    [],
    [{
      id: "orphan-thread",
      isResolved: false,
      comments: { nodes: [graphqlReviewComment(901)] },
    }],
    undefined,
    FULL_SHA_A,
  );

  assert.deepEqual(result, {
    count: 0,
    ids: [],
    samples: [],
    errors: [],
    transientErrors: [
      `unresolved review thread orphan-thread contains GraphQL comment ` +
        `${reviewCommentNodeId(901)} ` +
        "missing from the complete REST review-comment snapshot",
    ],
  });
});

test("requires GraphQL review-thread isResolved to be exactly boolean", () => {
  const invalidValues = [undefined, null, 0, 1, "false", {}];
  const reviewThreads = invalidValues.map((isResolved, index) => ({
    id: `invalid-resolution-${index}`,
    ...(isResolved === undefined ? {} : { isResolved }),
    comments: { nodes: [] },
  }));

  const result = collectUnresolvedCodexThreadFindings(
    [],
    [],
    reviewThreads,
    undefined,
    FULL_SHA_A,
  );

  assert.equal(result.count, 0);
  assert.deepEqual(result.transientErrors, []);
  assert.deepEqual(
    result.errors,
    invalidValues.map(
      (_, index) =>
        `GraphQL review thread invalid-resolution-${index} ` +
        "has a non-boolean isResolved value",
    ),
  );
});

test("rejects conflicting opaque identities for the same REST and GraphQL full ID", () => {
  const restNodeId = reviewCommentNodeId(904);
  const graphqlNodeId = `${restNodeId}Conflict`;
  const result = collectUnresolvedCodexThreadFindings(
    [{
      id: 904,
      node_id: restNodeId,
      user: { login: "octocat", type: "User" },
    }],
    [],
    [{
      id: "opaque-conflict-thread",
      isResolved: false,
      comments: {
        nodes: [{
          id: graphqlNodeId,
          fullDatabaseId: "904",
        }],
      },
    }],
    undefined,
    FULL_SHA_A,
  );

  assert.deepEqual(result, {
    count: 0,
    ids: [],
    samples: [],
    errors: [
      `unresolved review thread opaque-conflict-thread maps GraphQL fullDatabaseId ` +
        `904 to opaque id ${graphqlNodeId}, but REST maps it to conflicting ` +
        `node_id ${restNodeId}`,
    ],
    transientErrors: [],
  });
});

test("rejects missing, duplicate, and conflicting GraphQL review-thread identities", () => {
  const duplicateThreadId = "PRRT_kwDOReviewGateDuplicate";
  const conflictingThreadId = "PRRT_kwDOReviewGateConflict";
  const result = collectUnresolvedCodexThreadFindings(
    [],
    [],
    [
      {
        id: null,
        isResolved: true,
        comments: { nodes: [] },
      },
      {
        id: duplicateThreadId,
        isResolved: true,
        comments: { nodes: [] },
      },
      {
        id: duplicateThreadId,
        isResolved: true,
        comments: { nodes: [] },
      },
      {
        id: conflictingThreadId,
        isResolved: true,
        isOutdated: false,
        comments: { nodes: [] },
      },
      {
        id: conflictingThreadId,
        isResolved: false,
        isOutdated: true,
        comments: { nodes: [] },
      },
    ],
    undefined,
    FULL_SHA_A,
  );

  assert.deepEqual(result, {
    count: 0,
    ids: [],
    samples: [],
    errors: [
      "GraphQL review-thread snapshot contains a thread without a valid opaque id",
      `GraphQL review-thread snapshot contains duplicate or conflicting thread id ` +
        duplicateThreadId,
      `GraphQL review-thread snapshot contains duplicate or conflicting thread id ` +
        conflictingThreadId,
    ],
    transientErrors: [],
  });
});

test("rejects REST review comments missing an opaque node identity", () => {
  const result = collectUnresolvedCodexThreadFindings(
    [{
      id: 901,
      user: { login: "octocat", type: "User" },
    }],
    [],
    [],
    undefined,
    FULL_SHA_A,
  );

  assert.deepEqual(result, {
    count: 0,
    ids: [],
    samples: [],
    errors: ["REST review-comment 901 is missing a valid opaque node_id"],
    transientErrors: [],
  });
});

test("rejects unresolved GraphQL comments missing opaque or full database identities", () => {
  const human = { login: "octocat", type: "User" };
  const result = collectUnresolvedCodexThreadFindings(
    [
      {
        id: 902,
        node_id: reviewCommentNodeId(902),
        user: human,
      },
      {
        id: 903,
        node_id: reviewCommentNodeId(903),
        user: human,
      },
    ],
    [],
    [{
      id: "missing-identities",
      isResolved: false,
      comments: {
        nodes: [
          {
            id: null,
            fullDatabaseId: "902",
          },
          {
            id: reviewCommentNodeId(903),
            fullDatabaseId: null,
          },
        ],
      },
    }],
    undefined,
    FULL_SHA_A,
  );

  assert.deepEqual(result, {
    count: 0,
    ids: [],
    samples: [],
    errors: [
      "unresolved review thread missing-identities contains a GraphQL comment " +
        "without a valid opaque id",
      `unresolved review thread missing-identities contains GraphQL comment ` +
        `${reviewCommentNodeId(903)} without a valid fullDatabaseId`,
    ],
    transientErrors: [],
  });
});

test("rejects duplicate REST numeric and opaque review-comment identities", () => {
  const human = { login: "octocat", type: "User" };
  const result = collectUnresolvedCodexThreadFindings(
    [
      {
        id: 910,
        node_id: reviewCommentNodeId(910),
        user: human,
      },
      {
        id: 910,
        node_id: reviewCommentNodeId(911),
        user: human,
      },
      {
        id: 912,
        node_id: reviewCommentNodeId(910),
        user: human,
      },
    ],
    [],
    [],
    undefined,
    FULL_SHA_A,
  );

  assert.deepEqual(result, {
    count: 0,
    ids: [],
    samples: [],
    errors: [
      "REST review-comment snapshot contains duplicate numeric id 910",
      `REST review-comment snapshot contains duplicate node_id ${reviewCommentNodeId(910)}`,
    ],
    transientErrors: [],
  });
});

test("rejects duplicate and conflicting GraphQL opaque and full identities", () => {
  const human = { login: "octocat", type: "User" };
  const result = collectUnresolvedCodexThreadFindings(
    [
      {
        id: 920,
        node_id: reviewCommentNodeId(920),
        user: human,
      },
      {
        id: 921,
        node_id: reviewCommentNodeId(921),
        user: human,
      },
    ],
    [],
    [
      {
        id: "thread-a",
        isResolved: false,
        comments: {
          nodes: [
            graphqlReviewComment(920),
            {
              id: reviewCommentNodeId(920),
              fullDatabaseId: "921",
            },
            {
              id: reviewCommentNodeId(921),
              fullDatabaseId: "920",
            },
          ],
        },
      },
      {
        id: "thread-b",
        isResolved: true,
        comments: {
          nodes: [
            {
              id: reviewCommentNodeId(920),
              fullDatabaseId: "922",
            },
            {
              id: reviewCommentNodeId(922),
              fullDatabaseId: "920",
            },
          ],
        },
      },
    ],
    undefined,
    FULL_SHA_A,
  );

  assert.deepEqual(result, {
    count: 0,
    ids: [],
    samples: [],
    errors: [
      `GraphQL review comment opaque id ${reviewCommentNodeId(920)} ` +
        "appears more than once in thread thread-a",
      "GraphQL review comment fullDatabaseId 920 appears more than once in thread thread-a",
      `unresolved review thread thread-a maps GraphQL comment ${reviewCommentNodeId(921)} ` +
        "fullDatabaseId 920 to conflicting REST numeric id 921",
      `GraphQL review comment opaque id ${reviewCommentNodeId(920)} ` +
        "appears in multiple review threads",
      "GraphQL review comment fullDatabaseId 920 appears in multiple review threads",
      `resolved review thread thread-b maps GraphQL fullDatabaseId 920 to opaque id ` +
        `${reviewCommentNodeId(922)}, but REST maps it to conflicting node_id ` +
        `${reviewCommentNodeId(920)}`,
    ],
    transientErrors: [],
  });
});

test("keeps fully mapped pure-human unresolved threads out of Codex findings", () => {
  const result = collectUnresolvedCodexThreadFindings(
    [{
      id: 903,
      node_id: reviewCommentNodeId(903),
      path: "src/human.mjs",
      line: 9,
      user: { login: "octocat", type: "User" },
    }],
    [],
    [{
      id: "human-thread",
      isResolved: false,
      comments: { nodes: [graphqlReviewComment(903)] },
    }],
    undefined,
    FULL_SHA_A,
  );

  assert.deepEqual(result, {
    count: 0,
    ids: [],
    samples: [],
    errors: [],
    transientErrors: [],
  });
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

test("ignores resolved but retains outdated unresolved current-head Codex inline threads", () => {
  const comments = [
    {
      id: 10,
      node_id: reviewCommentNodeId(10),
      path: "src/resolved.rs",
      line: null,
      original_line: 7,
      commit_id: "head",
      original_commit_id: "old",
      user: { login: "chatgpt-codex-connector[bot]" },
    },
    {
      id: 11,
      node_id: reviewCommentNodeId(11),
      path: "src/outdated.rs",
      line: null,
      original_line: 8,
      commit_id: "head",
      original_commit_id: "old",
      user: { login: "chatgpt-codex-connector[bot]" },
    },
    {
      id: 12,
      node_id: reviewCommentNodeId(12),
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
      comments: { nodes: [graphqlReviewComment(10)] },
    },
    {
      id: "outdated-thread",
      isResolved: false,
      isOutdated: true,
      comments: { nodes: [graphqlReviewComment(11)] },
    },
    {
      id: "active-thread",
      isResolved: false,
      isOutdated: false,
      comments: { nodes: [graphqlReviewComment(12)] },
    },
  ];

  assert.deepEqual(collectCurrentHeadCodexFindings(comments, [], "head", undefined, reviewThreads), {
    count: 2,
    ids: ["11", "12"],
    samples: ["src/outdated.rs:8", "src/active.rs:9"],
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
  assert.deepEqual(
    state.bootstrap.currentHeadFindings,
    summarizeFindingsForState({ ids: ["finding-1"] }),
  );
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

test("requires a fresh marker when pending state never got a marker", () => {
  const baseState = {
    statusHead: "head",
    activeMarker: null,
    history: [],
    lastStatus: {
      headSha: "head",
      state: "pending",
    },
  };

  assert.equal(stateNeedsFreshMarkerAfterMissingMarker(baseState, "head"), true);
  assert.equal(
    stateNeedsFreshMarkerAfterMissingMarker({
      ...baseState,
      history: [{ headSha: "head", outcome: "missed_ack" }],
    }, "head"),
    true,
  );
  assert.equal(
    stateNeedsFreshMarkerAfterMissingMarker({
      ...baseState,
      history: [{ headSha: "head", outcome: "passed" }],
    }, "head"),
    false,
  );
  assert.equal(
    stateNeedsFreshMarkerAfterMissingMarker({
      ...baseState,
      lastStatus: { headSha: "head", state: "failure" },
    }, "head"),
    false,
  );
});

test("scheduled scans continue when either trusted state or marker exists", () => {
  const markerBody = buildMarkerCommentBody({
    headSha: "abc123",
    runUrl: "https://example.invalid/runs/1",
    runId: "1",
    runAttempt: "1",
    attempt: 1,
    baseline: { plusOne: null, eyes: null },
    state: "waiting_ack",
  });
  const stateBody = buildStateCommentBody({
    version: 1,
    createdAt: "2026-04-26T10:00:00Z",
    updatedAt: "2026-04-26T10:00:00Z",
    statusHead: "abc123",
    bootstrap: { status: "closed" },
    activeMarker: null,
    history: [],
  });

  assert.equal(hasTrustedGateStateOrMarker([], new Set(["github-actions[bot]"])), false);
  assert.equal(
    hasTrustedGateStateOrMarker(
      [{ id: 1, body: stateBody, user: { login: "github-actions[bot]" } }],
      new Set(["github-actions[bot]"]),
    ),
    true,
  );
  assert.equal(
    hasTrustedGateStateOrMarker(
      [{ id: 2, body: markerBody, user: { login: "github-actions[bot]" } }],
      new Set(["github-actions[bot]"]),
    ),
    true,
  );
});

test("allows a fresh marker for no-state current-head findings", () => {
  assert.equal(
    shouldCreateFreshHeadMarker({
      allowCreateMarker: true,
      hasActiveMarker: false,
      headChanged: false,
      stateNeedsFreshMarker: true,
    }),
    true,
  );
  assert.equal(
    shouldCreateFreshHeadMarker({
      allowCreateMarker: true,
      hasActiveMarker: true,
      headChanged: true,
      stateNeedsFreshMarker: true,
    }),
    false,
  );
});

test("scheduled scans without markers still recover head changes", () => {
  assert.equal(
    shouldSkipScheduledScanWithoutMarker({
      triggerKind: "scan",
      allowCreateMarker: false,
      dependabotScheduleRecovery: false,
      hasActiveMarker: false,
      headChanged: false,
      stateNeedsFreshMarker: false,
    }),
    true,
  );
  assert.equal(
    shouldSkipScheduledScanWithoutMarker({
      triggerKind: "scan",
      allowCreateMarker: false,
      dependabotScheduleRecovery: false,
      hasActiveMarker: false,
      headChanged: true,
      stateNeedsFreshMarker: false,
    }),
    false,
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
