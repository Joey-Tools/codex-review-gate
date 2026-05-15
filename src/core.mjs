export const STATUS_CONTEXT = process.env.STATUS_CONTEXT || "codex/review-gate";
export const STATE_MARKER = process.env.STATE_MARKER || "codex-review-gate-state";
export const MARKER_COMMENT = process.env.MARKER_COMMENT || "codex-review-gate-marker";
export const STATE_VERSION = 1;
export const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export const DEFAULT_CODEX_BOT_LOGINS = new Set([
  "chatgpt-codex-connector",
  "chatgpt-codex-connector[bot]",
]);

export const DEFAULT_TRUSTED_COMMENT_LOGINS = new Set(["github-actions[bot]"]);

export class GateFailure extends Error {
  constructor(state, description, message) {
    super(message);
    this.name = "GateFailure";
    this.state = state;
    this.description = description;
  }
}

export class NonJsonResponseError extends Error {
  constructor(description, text) {
    const preview = truncate(String(text || "").replace(/\s+/g, " ").trim(), 200) || "<empty>";
    super(`${description} returned a non-JSON response: ${preview}`);
    this.name = "NonJsonResponseError";
    this.preview = preview;
  }
}

export function parseLoginSet(raw, fallback) {
  if (!raw || !raw.trim()) {
    return new Set(fallback);
  }
  return new Set(
    raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

export function normalizeEventMode(raw) {
  const mode = raw || "standard";
  if (mode === "standard" || mode === "comment-only" || mode === "full") {
    return mode;
  }
  throw new Error("CODEX_REVIEW_GATE_EVENT_MODE must be exactly standard, comment-only, or full");
}

export function eventModeHandlesEvent(eventName, eventMode = "standard") {
  const mode = normalizeEventMode(eventMode);
  if (eventName === "pull_request_review") {
    return mode !== "comment-only";
  }
  if (eventName === "pull_request_review_comment") {
    return mode === "full";
  }
  return true;
}

export function eventMayHaveReadOnlyDependabotToken(eventName) {
  return new Set([
    "pull_request_target",
    "issue_comment",
    "pull_request_review",
    "pull_request_review_comment",
  ]).has(eventName || "");
}

export function pullRequestIsDependabot(pullRequest) {
  return pullRequest?.user?.login === "dependabot[bot]";
}

export function autoRetryEnabled(raw) {
  return String(raw || "").trim().toLowerCase() !== "false";
}

export function shouldFailFindingsBeforeMarker({ findingsCount, freshHeadMarkerAllowed }) {
  if (Number(findingsCount || 0) <= 0) {
    return false;
  }

  return !freshHeadMarkerAllowed;
}

export function shouldCreateFreshHeadMarker({
  allowCreateMarker,
  hasActiveMarker,
  headChanged,
  stateNeedsFreshMarker,
}) {
  return Boolean(allowCreateMarker && !hasActiveMarker && (headChanged || stateNeedsFreshMarker));
}

export function shouldSkipScheduledScanWithoutMarker({
  triggerKind,
  allowCreateMarker,
  dependabotScheduleRecovery,
  hasActiveMarker,
  headChanged,
  stateNeedsFreshMarker,
}) {
  return Boolean(
    triggerKind === "scan" &&
      !allowCreateMarker &&
      !dependabotScheduleRecovery &&
      !hasActiveMarker &&
      !headChanged &&
      !stateNeedsFreshMarker,
  );
}

export function hasTrustedGateStateOrMarker(comments, trustedLogins = DEFAULT_TRUSTED_COMMENT_LOGINS) {
  return Boolean(
    findLatestTrustedStateComment(comments, trustedLogins) ||
      findLatestTrustedMarkerComment(comments, trustedLogins),
  );
}

export function isRetryableHttpStatus(status) {
  return RETRYABLE_HTTP_STATUSES.has(Number(status));
}

export function restRequestRetryAllowed(method, path, status) {
  if (!isRetryableHttpStatus(status)) {
    return false;
  }

  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === "GET" || normalizedMethod === "PATCH") {
    return true;
  }

  return normalizedMethod === "POST" && path.includes("/statuses/");
}

export function retryAfterDelayMs(retryAfter, fallbackMs) {
  if (!retryAfter) {
    return fallbackMs;
  }

  const retryAfterSeconds = Number(retryAfter);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return retryAfterSeconds * 1000;
  }

  const retryAt = Date.parse(retryAfter);
  if (!Number.isNaN(retryAt)) {
    return Math.max(0, retryAt - Date.now());
  }

  return fallbackMs;
}

export function isCodexBot(login, botLogins = DEFAULT_CODEX_BOT_LOGINS) {
  return botLogins.has(login || "");
}

export function isTrustedCommentAuthor(login, trustedLogins = DEFAULT_TRUSTED_COMMENT_LOGINS) {
  return trustedLogins.has(login || "");
}

export function reactionIdentity(reaction) {
  if (!reaction) {
    return null;
  }

  return {
    id: String(reaction.id),
    content: reaction.content,
    createdAt: reaction.created_at,
    user: reaction.user?.login || "",
  };
}

export function issueCommentIdentity(comment) {
  if (!comment) {
    return null;
  }

  return {
    id: String(comment.id),
    createdAt: comment.created_at,
    user: comment.user?.login || "",
    url: comment.html_url || null,
  };
}

export function summarizeCodexReactions(reactions, botLogins = DEFAULT_CODEX_BOT_LOGINS) {
  return {
    plusOne: selectLatestCodexReaction(reactions, "+1", botLogins),
    eyes: selectLatestCodexReaction(reactions, "eyes", botLogins),
  };
}

export function summarizeCodexSignalReactions(
  issueReactions,
  markerCommentReactions,
  botLogins = DEFAULT_CODEX_BOT_LOGINS,
) {
  return summarizeCodexReactions(
    [...(issueReactions || []), ...(markerCommentReactions || [])],
    botLogins,
  );
}

export function selectLatestCodexReaction(reactions, content, botLogins = DEFAULT_CODEX_BOT_LOGINS) {
  const matches = reactions
    .filter((reaction) => reaction.content === content && isCodexBot(reaction.user?.login, botLogins))
    .map(reactionIdentity);

  matches.sort((left, right) => {
    const byCreatedAt = parseTimestamp(right.createdAt, "reaction creation time") -
      parseTimestamp(left.createdAt, "reaction creation time");
    if (byCreatedAt !== 0) {
      return byCreatedAt;
    }
    return Number(right.id) - Number(left.id);
  });

  return matches[0] || null;
}

export function selectLatestCodexCompletionComment(comments, botLogins = DEFAULT_CODEX_BOT_LOGINS) {
  const matches = comments
    .filter((comment) => isCodexCompletionComment(comment, botLogins))
    .map(issueCommentIdentity);

  matches.sort((left, right) => {
    const byCreatedAt = parseTimestamp(right.createdAt, "Codex issue comment creation time") -
      parseTimestamp(left.createdAt, "Codex issue comment creation time");
    if (byCreatedAt !== 0) {
      return byCreatedAt;
    }
    return Number(right.id) - Number(left.id);
  });

  return matches[0] || null;
}

export function isCodexCompletionComment(comment, botLogins = DEFAULT_CODEX_BOT_LOGINS) {
  if (!isCodexBot(comment?.user?.login, botLogins)) {
    return false;
  }

  return /^Codex Review\s*:/i.test(String(comment.body || "").trim());
}

export function sameReactionIdentity(left, right) {
  if (!left || !right) {
    return !left && !right;
  }
  return String(left.id) === String(right.id) && left.createdAt === right.createdAt;
}

export function sameIssueCommentIdentity(left, right) {
  if (!left || !right) {
    return !left && !right;
  }
  return String(left.id) === String(right.id) && left.createdAt === right.createdAt;
}

export function activeMarkerIsObsolete(activeMarker, statusHead) {
  return Boolean(activeMarker?.headSha && statusHead && activeMarker.headSha !== statusHead);
}

export function hasNewPlusOneTransition(baselinePlusOne, currentPlusOne, markerCreatedAt) {
  if (!currentPlusOne) {
    return false;
  }

  const currentCreatedAt = parseTimestamp(currentPlusOne.createdAt, "Codex +1 reaction creation time");
  const markerCreated = parseTimestamp(markerCreatedAt, "marker creation time");
  if (currentCreatedAt < markerCreated) {
    return false;
  }

  return !sameReactionIdentity(baselinePlusOne, currentPlusOne);
}

export function hasNewEyesTransition(baselineEyes, currentEyes, markerCreatedAt) {
  if (!currentEyes) {
    return false;
  }

  const currentCreatedAt = parseTimestamp(currentEyes.createdAt, "Codex eyes reaction creation time");
  const markerCreated = parseTimestamp(markerCreatedAt, "marker creation time");
  if (currentCreatedAt < markerCreated) {
    return false;
  }

  return !sameReactionIdentity(baselineEyes, currentEyes);
}

export function markerCanAcceptAckSignal(activeMarker) {
  return activeMarker?.state === "waiting_ack";
}

export function hasNewCompletionComment(
  baselineComment,
  currentComment,
  markerCreatedAt,
  { bufferSeconds = 0 } = {},
) {
  if (!currentComment) {
    return false;
  }

  const currentCreatedAt = parseTimestamp(currentComment.createdAt, "Codex completion comment creation time");
  const markerCreated = parseTimestamp(markerCreatedAt, "marker creation time");
  const minimumCreatedAt = markerCreated + Math.max(0, Number(bufferSeconds) || 0) * 1000;
  if (currentCreatedAt <= markerCreated || currentCreatedAt < minimumCreatedAt) {
    return false;
  }

  return !sameIssueCommentIdentity(baselineComment, currentComment);
}

export function hasNewReviewTransition(baselineReview, currentReview, markerCreatedAt) {
  if (!currentReview) {
    return false;
  }
  const submittedAt = parseTimestamp(currentReview.submittedAt, "Codex review submission time");
  const markerCreated = parseTimestamp(markerCreatedAt, "marker creation time");
  if (submittedAt <= markerCreated) {
    return false;
  }
  if (!baselineReview) {
    return true;
  }
  return String(baselineReview.id) !== String(currentReview.id) ||
    baselineReview.submittedAt !== currentReview.submittedAt;
}

export function markerAckTimeoutSecondsForHistory(history, headSha, baseSeconds, maxSeconds) {
  let timeoutSeconds = baseSeconds;
  for (const marker of [...(history || [])].reverse()) {
    if (marker.headSha !== headSha || (marker.outcome || marker.state) !== "missed_ack") {
      break;
    }
    timeoutSeconds = Math.min(timeoutSeconds * 2, maxSeconds);
  }
  return timeoutSeconds;
}

export function normalizeMarkerAckTimeoutSeconds({
  markerTimeoutSeconds,
  markerAckTimeoutSeconds,
  markerAckTimeoutMaxSeconds,
}) {
  const effectiveMaxSeconds = Math.min(markerAckTimeoutMaxSeconds, markerTimeoutSeconds);
  return {
    markerAckTimeoutSeconds: Math.min(markerAckTimeoutSeconds, effectiveMaxSeconds),
    markerAckTimeoutMaxSeconds: effectiveMaxSeconds,
  };
}

export function activeMarkerAckTimedOut(activeMarker, nowMs, fallbackAckTimeoutSeconds) {
  if (!activeMarker || activeMarker.state !== "waiting_ack") {
    return false;
  }

  const ackTimeoutSeconds = activeMarker.ackTimeoutSeconds || fallbackAckTimeoutSeconds;
  const markerAgeMs = nowMs - parseTimestamp(activeMarker.createdAt, "marker creation time");
  return markerAgeMs >= ackTimeoutSeconds * 1000;
}

export function markerTimeoutOutcome(activeMarker, nowMs = Date.now()) {
  if (activeMarker.maxWaitDeadlineAt && nowMs >= parseTimestamp(activeMarker.maxWaitDeadlineAt, "max wait deadline")) {
    return "max_wait";
  }
  if (
    activeMarker.state === "waiting_ack" &&
    activeMarker.ackDeadlineAt &&
    nowMs >= parseTimestamp(activeMarker.ackDeadlineAt, "marker ack deadline") &&
    (!activeMarker.nextRetryAt || nowMs >= parseTimestamp(activeMarker.nextRetryAt, "marker retry deadline"))
  ) {
    return "missed_ack";
  }
  if (
    activeMarker.state === "waiting_result" &&
    activeMarker.resultDeadlineAt &&
    nowMs >= parseTimestamp(activeMarker.resultDeadlineAt, "marker result deadline")
  ) {
    return "stalled";
  }
  return null;
}

export function codexAutoReviewLooksOngoing(reactions) {
  if (!reactions.eyes) {
    return false;
  }
  if (!reactions.plusOne) {
    return true;
  }

  return (
    parseTimestamp(reactions.eyes.createdAt, "Codex eyes reaction creation time") >
    parseTimestamp(reactions.plusOne.createdAt, "Codex +1 reaction creation time")
  );
}

export function decideBootstrapProgress({ startedAt, nowMs, graceSeconds, reactions }) {
  const graceEndsAt = addSeconds(startedAt, graceSeconds);
  const graceOpen = nowMs < parseTimestamp(graceEndsAt, "bootstrap grace deadline");
  const autoReviewLooksOngoing = codexAutoReviewLooksOngoing(reactions);

  if (graceOpen) {
    return {
      status: "open",
      startedAt,
      graceEndsAt,
      autoReviewLooksOngoing,
    };
  }

  return {
    status: "closed",
    startedAt,
    graceEndsAt,
    closedAt: isoNow(nowMs),
    closeReason: autoReviewLooksOngoing ? "bootstrap_superseded_ongoing" : "bootstrap_quiet",
    autoReviewLooksOngoing,
  };
}

export function collectCurrentHeadCodexFindings(
  reviewComments,
  reviews,
  headSha,
  botLogins = DEFAULT_CODEX_BOT_LOGINS,
  reviewThreads = [],
) {
  const reviewThreadByCommentId = buildReviewThreadIndex(reviewThreads);
  const comments = reviewComments.filter((comment) =>
    isCurrentHeadCodexInlineFinding(comment, headSha, botLogins, reviewThreadByCommentId),
  );

  const reviewBodyFindings = reviews
    .filter((review) => isCurrentHeadCodexReviewBodyFinding(review, headSha, botLogins))
    .map((review) => ({
      id: String(review.id),
      sample: codexReviewBodyFindingSample(review.body || "", headSha) ||
        `review ${review.id}`,
    }));

  const samples = [
    ...comments.map((comment) => {
      const location = [comment.path, comment.line || comment.original_line]
        .filter((part) => part !== null && part !== undefined)
        .join(":");
      return location || `review comment ${comment.id}`;
    }),
    ...reviewBodyFindings.map((finding) => finding.sample),
  ].slice(0, 3);

  const ids = [
    ...comments.map((comment) => String(comment.id)),
    ...reviewBodyFindings.map((finding) => `review:${finding.id}`),
  ];

  return {
    count: ids.length,
    ids,
    samples,
  };
}

export function buildReviewThreadIndex(reviewThreads = []) {
  const byCommentId = new Map();
  for (const thread of reviewThreads || []) {
    const comments = thread.comments?.nodes || [];
    for (const comment of comments) {
      const id = comment.databaseId ?? comment.id;
      if (id !== null && id !== undefined) {
        byCommentId.set(String(id), thread);
      }
    }
  }
  return byCommentId;
}

export function isCurrentHeadCodexInlineFinding(
  comment,
  headSha,
  botLogins = DEFAULT_CODEX_BOT_LOGINS,
  reviewThreadByCommentId = new Map(),
) {
  if (!isCodexBot(comment.user?.login, botLogins)) {
    return false;
  }
  if (comment.commit_id !== headSha && comment.original_commit_id !== headSha) {
    return false;
  }

  const thread = reviewThreadByCommentId.get(String(comment.id));
  if (thread?.isResolved || thread?.isOutdated) {
    return false;
  }

  return true;
}

export function isCurrentHeadCodexReviewBodyFinding(
  review,
  headSha,
  botLogins = DEFAULT_CODEX_BOT_LOGINS,
) {
  if (!isCodexBot(review.user?.login, botLogins)) {
    return false;
  }
  if (review.state !== "COMMENTED") {
    return false;
  }
  if (review.commit_id !== headSha) {
    return false;
  }

  const body = review.body || "";
  return body.includes("### 💡 Codex Review") && Boolean(codexReviewBodyFindingSample(body, headSha));
}

export function codexReviewBodyFindingSample(body, headSha) {
  const blobPattern = new RegExp(
    `/blob/${escapeRegExp(headSha)}/([^\\s)#]+)#L(\\d+)(?:-L\\d+)?`,
  );
  const match = body.match(blobPattern);
  if (!match) {
    return null;
  }

  const path = safeDecodeURIComponent(match[1]);
  const line = match[2];
  return `${path}:${line}`;
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function createInitialState({ now, statusHead, runUrl, reactions, findings }) {
  return normalizeState({
    version: STATE_VERSION,
    createdAt: now,
    updatedAt: now,
    statusHead,
    bootstrap: {
      status: "open",
      startedAt: now,
      baseline: reactions,
      currentHeadFindingIds: findings.ids,
    },
    activeMarker: null,
    history: [],
    lastStatus: {
      headSha: statusHead,
      state: "pending",
      updatedAt: now,
      runUrl,
    },
  });
}

export function stateFromRecoveredMarkerComment({
  markerComment,
  marker,
  now,
  statusHead,
  runUrl,
  reactions,
  findings,
}) {
  const recoveredMarker = {
    ...marker,
    id: String(markerComment.id),
    url: markerComment.html_url || marker.url || null,
    createdAt: markerComment.created_at || marker.createdAt,
    state: "state_lost",
    outcome: "state_lost",
    closedAt: now,
    recoveryReason: "missing_state_comment",
  };

  return normalizeState({
    version: STATE_VERSION,
    createdAt: now,
    updatedAt: now,
    statusHead,
    bootstrap: {
      status: "closed",
      startedAt: now,
      closedAt: now,
      closeReason: "state_lost_recovery",
      baseline: reactions || { plusOne: null, eyes: null },
      currentHeadFindingIds: findings?.ids || [],
    },
    activeMarker: null,
    history: [recoveredMarker],
    lastStatus: {
      headSha: statusHead,
      state: "pending",
      updatedAt: now,
      runUrl,
    },
  });
}

export function stateNeedsFreshMarkerAfterRecovery(state) {
  if (state?.activeMarker) {
    return false;
  }

  const history = state?.history || [];
  const latest = history[history.length - 1];
  return latest?.outcome === "state_lost";
}

export function stateNeedsFreshMarkerAfterMissingMarker(state, statusHead) {
  if (!state || state.activeMarker || !statusHead || state.statusHead !== statusHead) {
    return false;
  }
  if (state.lastStatus?.headSha !== statusHead || state.lastStatus?.state !== "pending") {
    return false;
  }

  const latestForHead = [...(state.history || [])]
    .reverse()
    .find((marker) => marker.headSha === statusHead);
  if (!latestForHead) {
    return true;
  }

  return new Set(["missed_ack", "stalled"]).has(latestForHead.outcome || latestForHead.state);
}

export function normalizeState(state) {
  return {
    ...state,
    version: STATE_VERSION,
    history: (state.history || []).slice(-20),
  };
}

export function closeActiveMarker(state, outcome, now, extra = {}) {
  if (!state.activeMarker) {
    return normalizeState(state);
  }

  const closedMarker = {
    ...state.activeMarker,
    state: outcome,
    outcome,
    closedAt: now,
    ...extra,
  };

  return normalizeState({
    ...state,
    updatedAt: now,
    activeMarker: null,
    history: [...(state.history || []), closedMarker],
  });
}

export function reconcileStateWithMarkerComment(state, markerComment, now) {
  const marker = markerComment ? markerFromComment(markerComment) : null;
  if (!marker || stateKnowsMarker(state, marker.id)) {
    return { state, changed: false };
  }

  if (state.activeMarker) {
    throw new GateFailure(
      "error",
      "Multiple controlled Codex markers need manual recovery",
      `Found trusted marker ${marker.id}, but state already tracks marker ${state.activeMarker.id}.`,
    );
  }

  return {
    changed: true,
    state: normalizeState({
      ...state,
      updatedAt: now,
      activeMarker: {
        ...marker,
        state: marker.state || "waiting_ack",
      },
    }),
  };
}

export function stateKnowsMarker(state, markerId) {
  if (!markerId) {
    return false;
  }
  if (String(state.activeMarker?.id || "") === String(markerId)) {
    return true;
  }
  return (state.history || []).some((marker) => String(marker.id || "") === String(markerId));
}

export function updateStateForStatus(state, { now, statusHead, runUrl, status }) {
  return normalizeState({
    ...state,
    updatedAt: now,
    statusHead,
    lastStatus: {
      headSha: statusHead,
      state: status,
      updatedAt: now,
      runUrl,
    },
  });
}

export function buildStateCommentBody(state) {
  const active = state.activeMarker;
  const summary = [
    "codex/review-gate state",
    "",
    `- head: \`${state.statusHead || "unknown"}\``,
    `- marker: \`${active ? `${active.state || "waiting"} for ${active.headSha}` : "none"}\``,
    `- updated: \`${state.updatedAt || "unknown"}\``,
  ];

  return `${summary.join("\n")}\n\n${buildHiddenJson(STATE_MARKER, normalizeState(state))}`;
}

export function parseStateCommentBody(body) {
  const parsed = parseHiddenJson(body, STATE_MARKER);
  return parsed ? normalizeState(parsed) : null;
}

export function buildMarkerCommentBody(marker) {
  const hidden = {
    version: STATE_VERSION,
    headSha: marker.headSha,
    runUrl: marker.runUrl,
    runId: marker.runId,
    runAttempt: marker.runAttempt,
    attempt: marker.attempt,
    baseline: marker.baseline,
    state: marker.state || "waiting_ack",
  };

  if (marker.ackTimeoutSeconds !== undefined) {
    hidden.ackTimeoutSeconds = marker.ackTimeoutSeconds;
  }
  for (const key of ["ackDeadlineAt", "resultDeadlineAt", "nextRetryAt", "headStartedAt", "maxWaitDeadlineAt"]) {
    if (marker[key] !== undefined) {
      hidden[key] = marker[key];
    }
  }

  return [
    "@codex review",
    "",
    "> [!NOTE]",
    "> This workflow is requesting a Codex generative AI review.",
    "> Codex may post AI-generated comments or reviews on this pull request.",
    "> Review and verify AI-generated output before relying on it for security, correctness, or merge decisions.",
    "",
    buildHiddenJson(MARKER_COMMENT, hidden),
  ].join("\n");
}

export function parseMarkerCommentBody(body) {
  const parsed = parseHiddenJson(body, MARKER_COMMENT);
  if (!parsed) {
    return null;
  }
  return {
    ...parsed,
    version: STATE_VERSION,
  };
}

export function findLatestTrustedStateComment(comments, trustedLogins = DEFAULT_TRUSTED_COMMENT_LOGINS) {
  return [...comments]
    .reverse()
    .find((comment) =>
      isTrustedCommentAuthor(comment.user?.login, trustedLogins) &&
      Boolean(parseStateCommentBody(comment.body || "")),
    ) || null;
}

export function findLatestTrustedMarkerComment(comments, trustedLogins = DEFAULT_TRUSTED_COMMENT_LOGINS) {
  return [...comments]
    .reverse()
    .find((comment) =>
      isTrustedCommentAuthor(comment.user?.login, trustedLogins) &&
      Boolean(parseMarkerCommentBody(comment.body || "")),
    ) || null;
}

export function markerFromComment(comment) {
  const marker = parseMarkerCommentBody(comment.body || "");
  if (!marker) {
    return null;
  }
  return {
    ...marker,
    id: String(comment.id),
    url: comment.html_url || null,
    createdAt: comment.created_at,
  };
}

export function buildHiddenJson(marker, value) {
  return `<!-- ${marker}\n${JSON.stringify(value, null, 2)}\n-->`;
}

export function parseHiddenJson(body, marker) {
  const pattern = new RegExp(`<!--\\s*${escapeRegExp(marker)}\\s*\\n([\\s\\S]*?)\\n\\s*-->`);
  const match = body.match(pattern);
  if (!match) {
    return null;
  }
  return JSON.parse(match[1]);
}

export function parseTimestamp(value, description) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`invalid ${description}: ${value}`);
  }
  return parsed;
}

export function isoNow(nowMs = Date.now()) {
  return new Date(nowMs).toISOString();
}

export function addSeconds(isoTimestamp, seconds) {
  return new Date(parseTimestamp(isoTimestamp, "timestamp") + seconds * 1000).toISOString();
}

export function truncate(value, maxLength) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

export function parseJsonResponseText(text, description) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new NonJsonResponseError(description, text);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
