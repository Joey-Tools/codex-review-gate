#!/usr/bin/env node

import { readFileSync } from "node:fs";

import {
  DEFAULT_CODEX_BOT_LOGINS,
  DEFAULT_TRUSTED_COMMENT_LOGINS,
  GateFailure,
  NonJsonResponseError,
  STATUS_CONTEXT,
  activeMarkerIsObsolete,
  addSeconds,
  autoRetryEnabled,
  buildMarkerCommentBody,
  buildStateCommentBody,
  closeActiveMarker,
  collectCurrentHeadCodexFindings,
  createInitialState,
  eventMayHaveReadOnlyDependabotToken,
  eventModeHandlesEvent,
  findLatestTrustedMarkerComment,
  findLatestTrustedStateComment,
  hasNewCompletionComment,
  hasNewEyesTransition,
  hasNewReviewTransition,
  isoNow,
  hasTrustedGateStateOrMarker,
  isCodexBot,
  isRetryableHttpStatus,
  markerAckTimeoutSecondsForHistory,
  markerCanAcceptAckSignal,
  markerFromComment,
  markerTimeoutOutcome,
  normalizeEventMode,
  normalizeState,
  normalizeMarkerAckTimeoutSeconds,
  parseLoginSet,
  parseJsonResponseText,
  parseStateCommentBody,
  parseTimestamp,
  pullRequestIsDependabot,
  reconcileStateWithMarkerComment,
  restRequestRetryAllowed,
  retryAfterDelayMs,
  selectLatestCodexCompletionComment,
  shouldCreateFreshHeadMarker,
  shouldFailFindingsBeforeMarker,
  shouldSkipScheduledScanWithoutMarker,
  stateNeedsFreshMarkerAfterMissingMarker,
  stateNeedsFreshMarkerAfterRecovery,
  stateFromRecoveredMarkerComment,
  summarizeCodexSignalReactions,
  truncate,
  updateStateForStatus,
} from "./core.mjs";

const config = readConfig();
const repo = parseRepo(config.repository);
const repoPath = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
const runUrl = `${config.serverUrl}/${repo.owner}/${repo.name}/actions/runs/${config.runId}`;
const REVIEW_THREADS_QUERY = `
  query CodexReviewGateReviewThreads(
    $owner: String!
    $repo: String!
    $number: Int!
    $after: String
  ) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            isResolved
            isOutdated
            path
            line
            comments(first: 100) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                databaseId
              }
            }
          }
        }
      }
    }
  }
`;
const REVIEW_THREAD_COMMENTS_QUERY = `
  query CodexReviewGateReviewThreadComments($threadId: ID!, $after: String) {
    node(id: $threadId) {
      ... on PullRequestReviewThread {
        comments(first: 100, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            databaseId
          }
        }
      }
    }
  }
`;

let activePrNumber = config.prNumber;
let statusSha = config.headSha;
let statusReady = false;
const MAX_REQUEST_ATTEMPTS = 4;

main().catch(async (error) => {
  const gateError =
    error instanceof GateFailure
      ? error
      : new GateFailure("error", "Codex review gate errored", error.message);

  if (statusSha && statusReady) {
    try {
      await setCommitStatus(gateError.state, gateError.description);
    } catch (statusError) {
      console.error(`failed to set final ${STATUS_CONTEXT} status: ${statusError.message}`);
    }
  }

  console.error(error.stack || error.message);
  process.exitCode = 1;
});

async function main() {
  const trigger = readTrigger();
  if (trigger.kind === "skip") {
    console.log(trigger.reason);
    return;
  }

  if (trigger.kind === "scan") {
    await scanOpenPullRequests(trigger);
    return;
  }

  await processPullRequest(trigger.prNumber, trigger);
}

function readTrigger() {
  const eventName = process.env.GITHUB_EVENT_NAME || "";
  const event = readEventPayload();
  if (config.prNumber && (!eventName || eventName === "workflow_dispatch")) {
    return { kind: "single", prNumber: config.prNumber, allowCreateMarker: true };
  }
  if (!eventModeHandlesEvent(eventName, config.eventMode)) {
    return {
      kind: "skip",
      reason: `Skipping ${eventName}; event mode is ${config.eventMode}.`,
    };
  }

  if (eventName === "workflow_dispatch") {
    return { kind: "scan", allowCreateMarker: true };
  }

  if (eventName === "schedule") {
    if (!autoRetryEnabled(config.autoRetry)) {
      return { kind: "skip", reason: "Scheduled retry is disabled." };
    }
    return { kind: "scan", allowCreateMarker: false };
  }

  if (eventName === "pull_request_target") {
    const number = Number(event.pull_request?.number || "");
    return number > 0
      ? { kind: "single", prNumber: number, allowCreateMarker: true }
      : { kind: "skip", reason: "pull_request_target event did not include a PR number." };
  }

  if (eventName === "issue_comment") {
    if (!event.issue?.pull_request) {
      return { kind: "skip", reason: "Issue comment is not on a pull request." };
    }
    if (!isCodexBot(event.comment?.user?.login, config.codexBotLogins)) {
      return { kind: "skip", reason: "Issue comment was not posted by a configured Codex bot." };
    }
    const number = Number(event.issue?.number || "");
    return number > 0
      ? { kind: "single", prNumber: number, allowCreateMarker: false }
      : { kind: "skip", reason: "issue_comment event did not include a PR number." };
  }

  if (eventName === "pull_request_review") {
    if (!isCodexBot(event.review?.user?.login, config.codexBotLogins)) {
      return { kind: "skip", reason: "Pull request review was not submitted by a configured Codex bot." };
    }
    const number = Number(event.pull_request?.number || "");
    return number > 0
      ? { kind: "single", prNumber: number, allowCreateMarker: false }
      : { kind: "skip", reason: "pull_request_review event did not include a PR number." };
  }

  if (eventName === "pull_request_review_comment") {
    if (!isCodexBot(event.comment?.user?.login, config.codexBotLogins)) {
      return {
        kind: "skip",
        reason: "Pull request review comment was not posted by a configured Codex bot.",
      };
    }
    const number = Number(event.pull_request?.number || "");
    return number > 0
      ? { kind: "single", prNumber: number, allowCreateMarker: false }
      : { kind: "skip", reason: "pull_request_review_comment event did not include a PR number." };
  }

  return { kind: "skip", reason: `Unsupported event ${eventName || "<unknown>"}.` };
}

function readEventPayload() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(eventPath, "utf8"));
  } catch (error) {
    throw new Error(`failed to read GITHUB_EVENT_PATH: ${error.message}`);
  }
}

function eventMayHaveReadOnlyForkToken() {
  return new Set(["pull_request_review", "pull_request_review_comment"]).has(
    process.env.GITHUB_EVENT_NAME || "",
  );
}

function pullRequestIsFromFork(pullRequest) {
  const headRepo = pullRequest.head?.repo?.full_name;
  const baseRepo = pullRequest.base?.repo?.full_name;
  return Boolean(headRepo && baseRepo && headRepo !== baseRepo);
}

async function scanOpenPullRequests(trigger) {
  const pullRequests = await paginate(repoPath + "/pulls", { state: "open", per_page: "100" });
  let failures = 0;

  for (const pullRequest of pullRequests) {
    try {
      await processPullRequest(pullRequest.number, {
        ...trigger,
        allowCreateMarker: trigger.allowCreateMarker === true,
        scan: true,
      });
    } catch (error) {
      failures += 1;
      console.error(`failed to process PR #${pullRequest.number}: ${error.stack || error.message}`);
      await failClosedScannedPullRequest(pullRequest, error);
    }
  }

  if (failures > 0) {
    statusReady = false;
    throw new Error(`failed to process ${failures} pull request(s)`);
  }
}

async function failClosedScannedPullRequest(pullRequest, error) {
  activePrNumber = pullRequest.number;
  statusSha = statusSha || pullRequest.head?.sha || "";
  statusReady = false;
  if (!statusSha) {
    console.error(`failed to set ${STATUS_CONTEXT}=error for PR #${activePrNumber}: missing head SHA`);
    return;
  }

  try {
    await setCommitStatus("error", `Codex review gate errored while scanning PR #${activePrNumber}`);
  } catch (statusError) {
    console.error(
      `failed to set ${STATUS_CONTEXT}=error for PR #${activePrNumber} ` +
        `after ${error.name || "Error"}: ${statusError.message}`,
    );
  } finally {
    statusReady = false;
  }
}

async function processPullRequest(prNumber, trigger) {
  activePrNumber = prNumber;
  statusSha = "";
  statusReady = false;

  const pullRequest = await loadPullRequest();
  statusSha = pullRequest.head.sha;
  statusReady = true;
  if (
    eventMayHaveReadOnlyDependabotToken(process.env.GITHUB_EVENT_NAME) &&
    pullRequestIsDependabot(pullRequest)
  ) {
    console.log(
      `Skipping ${process.env.GITHUB_EVENT_NAME} for Dependabot PR #${activePrNumber}; ` +
        "scheduled or manual runs can resume with a write-capable token.",
    );
    return;
  }

  if (eventMayHaveReadOnlyForkToken() && pullRequestIsFromFork(pullRequest)) {
    console.log(
      `Skipping ${process.env.GITHUB_EVENT_NAME} for fork PR #${activePrNumber}; ` +
        "scheduled or manual pull_request_target runs can resume with a write-capable token.",
    );
    return;
  }

  if (pullRequest.draft) {
    if (trigger.kind === "scan") {
      console.log(`PR #${activePrNumber} is draft; skipping scheduled scan.`);
      return;
    }
    await setCommitStatus("pending", "Draft PR is waiting for Codex review gate");
    console.log(`PR #${activePrNumber} is draft; leaving ${STATUS_CONTEXT} pending.`);
    return;
  }

  const dependabotScheduleRecovery = trigger.kind === "scan" &&
    !trigger.allowCreateMarker &&
    pullRequestIsDependabot(pullRequest);

  if (trigger.kind === "scan" && !trigger.allowCreateMarker && !dependabotScheduleRecovery) {
    const comments = await paginate(`${repoPath}/issues/${activePrNumber}/comments`, { per_page: "100" });
    if (!hasTrustedGateStateOrMarker(comments, config.trustedCommentLogins)) {
      console.log(`PR #${activePrNumber} has no gate state; skipping scheduled scan.`);
      return;
    }
  }

  const snapshot = await loadSnapshot();

  let {
    state,
    stateComment: savedStateComment,
    needsFreshMarker: stateNeedsFreshMarker,
  } = await ensureState(snapshot, null, null);
  state = migrateStateForEventDrivenDeadlines(state);
  stateNeedsFreshMarker = stateNeedsFreshMarker ||
    stateNeedsFreshMarkerAfterRecovery(state) ||
    stateNeedsFreshMarkerAfterMissingMarker(state, statusSha);
  const headChanged = state.statusHead !== statusSha || activeMarkerIsObsolete(state.activeMarker, statusSha);

  if (shouldSkipScheduledScanWithoutMarker({
    triggerKind: trigger.kind,
    allowCreateMarker: trigger.allowCreateMarker,
    dependabotScheduleRecovery,
    hasActiveMarker: Boolean(state.activeMarker),
    headChanged,
    stateNeedsFreshMarker,
  })) {
    console.log(`PR #${activePrNumber} has no active marker; skipping scheduled scan.`);
    return;
  }

  let allowCreateMarker = trigger.allowCreateMarker || stateNeedsFreshMarker;
  if (headChanged) {
    if (state.activeMarker) {
      state = closeActiveMarker(state, "obsolete_head", isoNow(), { currentHeadSha: statusSha });
      savedStateComment = await saveState(state, savedStateComment);
    }
    allowCreateMarker = true;
    await setCommitStatus("pending", "Waiting for Codex review on current head");
    state = updateStateForStatus(state, {
      now: isoNow(),
      statusHead: statusSha,
      runUrl,
      status: "pending",
    });
  }

  const freshHeadMarkerAllowed = shouldCreateFreshHeadMarker({
    allowCreateMarker,
    hasActiveMarker: Boolean(state.activeMarker),
    headChanged,
    stateNeedsFreshMarker,
  });
  if (
    shouldFailFindingsBeforeMarker({
      findingsCount: snapshot.findings.count,
      freshHeadMarkerAllowed,
    })
  ) {
    await failFromFindings(snapshot.findings, state, savedStateComment);
    return;
  }

  if (
    !state.activeMarker &&
    state.lastStatus?.headSha === statusSha &&
    state.lastStatus?.state === "success"
  ) {
    console.log(`PR #${activePrNumber} already has a successful ${STATUS_CONTEXT} for ${statusSha}.`);
    return;
  }

  const result = await advanceEventDrivenMarker(
    state,
    savedStateComment,
    snapshot,
    { ...trigger, allowCreateMarker },
  );
  if (result.kind === "save") {
    await saveState(result.state, result.stateComment);
  }
}

async function ensureState(snapshot, previousState, previousComment) {
  if (previousState && previousComment) {
    return { state: previousState, stateComment: previousComment, needsFreshMarker: false };
  }

  const stateComment = findLatestTrustedStateComment(snapshot.comments, config.trustedCommentLogins);
  if (stateComment) {
    const markerComment = findLatestTrustedMarkerComment(snapshot.comments, config.trustedCommentLogins);
    const reconciled = reconcileStateWithMarkerComment(
      parseStateCommentBody(stateComment.body || ""),
      markerComment,
      isoNow(),
    );
    const reconciledStateComment = reconciled.changed
      ? await saveState(reconciled.state, stateComment)
      : stateComment;

    return {
      state: reconciled.state,
      stateComment: reconciledStateComment,
      needsFreshMarker: false,
    };
  }

  const markerComment = findLatestTrustedMarkerComment(snapshot.comments, config.trustedCommentLogins);
  const now = isoNow();
  const state = markerComment
    ? stateFromRecoveredMarkerComment({
        markerComment,
        marker: markerFromComment(markerComment),
        now,
        statusHead: statusSha,
        runUrl,
        reactions: snapshot.baseline,
        findings: snapshot.findings,
      })
    : createInitialState({
        now,
        statusHead: statusSha,
        runUrl,
        reactions: snapshot.baseline,
        findings: snapshot.findings,
      });

  state.bootstrap = {
    ...(state.bootstrap || {}),
    status: "closed",
    closedAt: state.bootstrap?.closedAt || now,
    closeReason: state.bootstrap?.closeReason || "event_driven",
  };

  const createdStateComment = await saveState(state, null);
  return { state, stateComment: createdStateComment, needsFreshMarker: true };
}

async function advanceEventDrivenMarker(state, stateComment, snapshot, trigger) {
  let allowCreateMarker = trigger.allowCreateMarker || stateNeedsFreshMarkerAfterRecovery(state);

  for (let iteration = 0; iteration < 4; iteration += 1) {
    if (!state.activeMarker) {
      if (!allowCreateMarker) {
        console.log(`PR #${activePrNumber} has no active marker; skipping ${trigger.kind} trigger.`);
        return { kind: "done", state, stateComment };
      }

      const marker = await createGateMarker(snapshot.baseline, state);
      state = normalizeState({
        ...state,
        updatedAt: isoNow(),
        activeMarker: marker,
      });
      stateComment = await saveState(state, stateComment);
      await setCommitStatus("pending", "Waiting for Codex review on controlled marker");
      console.log(`PR #${activePrNumber} is waiting for Codex review marker ${marker.id}.`);
      return { kind: "done", state, stateComment };
    }

    state = migrateStateForEventDrivenDeadlines(state);
    const activeMarker = state.activeMarker;

    if (activeMarkerIsObsolete(activeMarker, statusSha)) {
      state = closeActiveMarker(state, "obsolete_head", isoNow(), { currentHeadSha: statusSha });
      stateComment = await saveState(state, stateComment);
      await setCommitStatus("pending", "Previous Codex marker was for an obsolete head");
      allowCreateMarker = true;
      continue;
    }

    const timeoutOutcome = markerTimeoutOutcome(activeMarker);
    if (timeoutOutcome === "max_wait") {
      state = closeActiveMarker(state, "timed_out", isoNow(), {
        timedOutAfterSeconds: Math.round(config.maxWaitMs / 1000),
      });
      state = updateStateForStatus(state, {
        now: isoNow(),
        statusHead: statusSha,
        runUrl,
        status: "failure",
      });
      await setCommitStatus("failure", "Timed out waiting for Codex review signal");
      stateComment = await saveState(state, stateComment);
      return { kind: "done", state, stateComment };
    }

    const approvedReview = selectLatestCodexApprovedReview(snapshot.reviews, config.codexBotLogins);
    if (hasNewReviewTransition(activeMarker.baseline?.approvedReview, approvedReview, activeMarker.createdAt)) {
      await passGate(state, stateComment, snapshot, {
        observedApprovedReview: approvedReview,
      });
      return { kind: "done", state, stateComment };
    }

    if (
      hasNewCompletionComment(
        activeMarker.baseline?.completionComment,
        snapshot.completionComment,
        activeMarker.createdAt,
        { bufferSeconds: config.completionSignalBufferSeconds },
      )
    ) {
      await passGate(state, stateComment, snapshot, {
        observedCompletionComment: snapshot.completionComment,
      });
      return { kind: "done", state, stateComment };
    }

    if (
      markerCanAcceptAckSignal(activeMarker) &&
      hasNewEyesTransition(activeMarker.baseline?.eyes, snapshot.reactions.eyes, activeMarker.createdAt)
    ) {
      state = normalizeState({
        ...state,
        updatedAt: isoNow(),
        activeMarker: {
          ...activeMarker,
          state: "waiting_result",
          observedEyes: snapshot.reactions.eyes,
        },
      });
      stateComment = await saveState(state, stateComment);
      return { kind: "done", state, stateComment };
    }

    const submittedReview = selectLatestCodexSubmittedReview(snapshot.reviews, config.codexBotLogins);
    if (
      submittedReview &&
      markerCanAcceptAckSignal(activeMarker) &&
      hasNewReviewTransition(activeMarker.baseline?.submittedReview, submittedReview, activeMarker.createdAt)
    ) {
      state = normalizeState({
        ...state,
        updatedAt: isoNow(),
        activeMarker: {
          ...activeMarker,
          state: "waiting_result",
          observedReview: submittedReview,
        },
      });
      stateComment = await saveState(state, stateComment);
      return { kind: "done", state, stateComment };
    }

    if (timeoutOutcome === "missed_ack") {
      state = closeActiveMarker(state, "missed_ack", isoNow(), {
        ackTimeoutSeconds: activeMarker.ackTimeoutSeconds || config.markerAckTimeoutSeconds,
        lastObservedEyes: snapshot.reactions.eyes,
        lastObservedCompletionComment: snapshot.completionComment,
      });
      stateComment = await saveState(state, stateComment);
      allowCreateMarker = true;
      continue;
    }

    if (timeoutOutcome === "stalled") {
      state = closeActiveMarker(state, "stalled", isoNow(), {
        stalledAfterSeconds: Math.round(config.markerTimeoutMs / 1000),
        lastObservedEyes: snapshot.reactions.eyes,
        lastObservedCompletionComment: snapshot.completionComment,
      });
      stateComment = await saveState(state, stateComment);
      allowCreateMarker = true;
      continue;
    }

    console.log(`PR #${activePrNumber} has no due Codex review gate transition.`);
    return { kind: "done", state, stateComment };
  }

  throw new Error(`PR #${activePrNumber} exceeded event-driven transition budget`);
}

async function passGate(state, stateComment, snapshot, observed) {
  await failIfPullRequestHeadChanged("before passing Codex review gate");
  const finalSnapshot = await loadSnapshot();
  if (finalSnapshot.findings.count > 0) {
    await failFromFindings(finalSnapshot.findings, state, stateComment);
    return;
  }
  const passedState = updateStateForStatus(closeActiveMarker(state, "passed", isoNow(), {
    observedCompletionComment: observed.observedCompletionComment || snapshot.completionComment,
    observedApprovedReview: observed.observedApprovedReview || null,
  }), {
    now: isoNow(),
    statusHead: statusSha,
    runUrl,
    status: "success",
  });
  await setCommitStatus("success", "Codex completion observed and current head has no Codex findings");
  await saveState(passedState, stateComment);
  console.log(`${STATUS_CONTEXT} passed for ${statusSha}.`);
}

async function failFromFindings(findings, state, stateComment) {
  const sample = findings.samples[0];
  const suffix = sample ? ` First finding: ${sample}` : "";
  const failedState = state.activeMarker
    ? closeActiveMarker(state, "failed_findings", isoNow(), {
        currentHeadFindingIds: findings.ids,
      })
    : state;
  const statusState = updateStateForStatus(failedState, {
    now: isoNow(),
    statusHead: statusSha,
    runUrl,
    status: "failure",
  });
  await setCommitStatus("failure", `Codex posted ${findings.count} finding(s) on current head`);
  await saveState(statusState, stateComment);
  console.log(`Codex review found ${findings.count} finding(s) for ${statusSha}.${suffix}`);
}

function migrateStateForEventDrivenDeadlines(state) {
  if (!state.activeMarker) {
    return normalizeState(state);
  }

  const marker = state.activeMarker;
  const createdAt = marker.createdAt || state.updatedAt || state.createdAt || isoNow();
  const ackTimeoutSeconds =
    marker.ackTimeoutSeconds ||
    markerAckTimeoutSecondsForHistory(
      state.history,
      marker.headSha || statusSha,
      config.markerAckTimeoutSeconds,
      config.markerAckTimeoutMaxSeconds,
    );
  const ackDeadlineAt = marker.ackDeadlineAt || addSeconds(createdAt, ackTimeoutSeconds);
  const resultDeadlineAt =
    marker.resultDeadlineAt || addSeconds(createdAt, Math.round(config.markerTimeoutMs / 1000));
  const headStartedAt = marker.headStartedAt || state.headStartedAt || createdAt;
  const maxWaitDeadlineAt =
    marker.maxWaitDeadlineAt || addSeconds(headStartedAt, Math.round(config.maxWaitMs / 1000));
  const nextRetryAt =
    marker.nextRetryAt ||
    (marker.state === "waiting_result" ? resultDeadlineAt : ackDeadlineAt);

  return normalizeState({
    ...state,
    activeMarker: {
      ...marker,
      state: marker.state || "waiting_ack",
      ackTimeoutSeconds,
      ackDeadlineAt,
      resultDeadlineAt,
      nextRetryAt,
      headStartedAt,
      maxWaitDeadlineAt,
    },
  });
}

async function createGateMarker(reactionBaseline, state) {
  const attempt = (state.history || []).length + 1;
  const createdAtFallback = isoNow();
  const headStartedAt = headStartedAtForState(state, createdAtFallback);
  const ackTimeoutSeconds = markerAckTimeoutSecondsForHistory(
    state.history,
    statusSha,
    config.markerAckTimeoutSeconds,
    config.markerAckTimeoutMaxSeconds,
  );
  const marker = {
    version: 1,
    headSha: statusSha,
    runUrl,
    runId: config.runId,
    runAttempt: config.runAttempt,
    attempt,
    baseline: reactionBaseline,
    state: "waiting_ack",
    ackTimeoutSeconds,
    headStartedAt,
    maxWaitDeadlineAt: addSeconds(headStartedAt, Math.round(config.maxWaitMs / 1000)),
  };

  const { data } = await request("POST", `${repoPath}/issues/${activePrNumber}/comments`, {
    body: buildMarkerCommentBody(marker),
  });

  const created = {
    ...marker,
    id: String(data.id),
    url: data.html_url || null,
    createdAt: data.created_at,
  };
  created.ackDeadlineAt = addSeconds(created.createdAt, ackTimeoutSeconds);
  created.resultDeadlineAt = addSeconds(created.createdAt, Math.round(config.markerTimeoutMs / 1000));
  created.nextRetryAt = created.ackDeadlineAt;
  console.log(`Created controlled Codex marker ${created.url || `#${created.id}`} for ${statusSha}.`);
  return created;
}

function headStartedAtForState(state, fallback) {
  const sameHead = [...(state.history || [])]
    .reverse()
    .find((marker) => marker.headSha === statusSha && marker.headStartedAt);
  return sameHead?.headStartedAt || state.activeMarker?.headStartedAt || fallback;
}

async function saveState(state, stateComment) {
  const body = buildStateCommentBody(state);
  if (stateComment?.id) {
    const { data } = await request("PATCH", `${repoPath}/issues/comments/${stateComment.id}`, { body });
    return data;
  }

  const { data } = await request("POST", `${repoPath}/issues/${activePrNumber}/comments`, { body });
  console.log(`Created gate state comment ${data.html_url || `#${data.id}`}.`);
  return data;
}

async function loadSnapshot() {
  const [comments, issueReactions, reviewComments, reviews, reviewThreads] = await Promise.all([
    paginate(`${repoPath}/issues/${activePrNumber}/comments`, { per_page: "100" }),
    paginate(`${repoPath}/issues/${activePrNumber}/reactions`, { per_page: "100" }),
    paginate(`${repoPath}/pulls/${activePrNumber}/comments`, { per_page: "100" }),
    paginate(`${repoPath}/pulls/${activePrNumber}/reviews`, { per_page: "100" }),
    loadReviewThreads(),
  ]);
  const markerComment = findLatestTrustedMarkerComment(comments, config.trustedCommentLogins);
  const markerCommentReactions = markerComment?.id
    ? await paginate(`${repoPath}/issues/comments/${markerComment.id}/reactions`, { per_page: "100" })
    : [];

  const findings = collectCurrentHeadCodexFindings(
    reviewComments,
    reviews,
    statusSha,
    config.codexBotLogins,
    reviewThreads,
  );
  const reactions = summarizeCodexSignalReactions(
    issueReactions,
    markerCommentReactions,
    config.codexBotLogins,
  );
  const completionComment = selectLatestCodexCompletionComment(comments, config.codexBotLogins);
  const approvedReview = selectLatestCodexApprovedReview(reviews, config.codexBotLogins);
  const submittedReview = selectLatestCodexSubmittedReview(reviews, config.codexBotLogins);

  return {
    comments,
    issueReactions,
    markerCommentReactions,
    reviewComments,
    reviews,
    reviewThreads,
    reactions,
    completionComment,
    approvedReview,
    submittedReview,
    baseline: {
      ...reactions,
      completionComment,
      approvedReview,
      submittedReview,
    },
    findings,
  };
}

function readConfig() {
  const token = requiredEnv("GITHUB_TOKEN");
  const repository = requiredEnv("GITHUB_REPOSITORY");
  const prNumberRaw = (process.env.PR_NUMBER || "").trim();
  const prNumber = prNumberRaw ? Number(prNumberRaw) : null;
  const headSha = (process.env.HEAD_SHA || "").trim();

  if (prNumber !== null && (!Number.isInteger(prNumber) || prNumber <= 0)) {
    throw new Error("PR_NUMBER must be a positive integer");
  }

  const apiUrl = stripTrailingSlash(process.env.GITHUB_API_URL || "https://api.github.com");
  const serverUrl = stripTrailingSlash(process.env.GITHUB_SERVER_URL || "https://github.com");
  const markerTimeoutSeconds = secondsEnv("MARKER_TIMEOUT_SECONDS", 3600, { allowZero: false });
  const markerAckTimeoutConfig = normalizeMarkerAckTimeoutSeconds({
    markerTimeoutSeconds,
    markerAckTimeoutSeconds: secondsEnv("MARKER_ACK_TIMEOUT_SECONDS", 300, { allowZero: false }),
    markerAckTimeoutMaxSeconds: secondsEnv("MARKER_ACK_TIMEOUT_MAX_SECONDS", 1800, {
      allowZero: false,
    }),
  });

  return {
    token,
    repository,
    prNumber,
    headSha,
    apiUrl,
    serverUrl,
    graphqlUrl: graphqlEndpoint(apiUrl, serverUrl),
    runId: requiredEnv("GITHUB_RUN_ID"),
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || "1",
    maxWaitMs: secondsEnv("MAX_WAIT_SECONDS", 7200, { allowZero: false }) * 1000,
    markerTimeoutMs: markerTimeoutSeconds * 1000,
    markerAckTimeoutSeconds: markerAckTimeoutConfig.markerAckTimeoutSeconds,
    markerAckTimeoutMaxSeconds: markerAckTimeoutConfig.markerAckTimeoutMaxSeconds,
    completionSignalBufferSeconds: secondsEnv("COMPLETION_SIGNAL_BUFFER_SECONDS", 30, {
      allowZero: true,
    }),
    pollIntervalMs: secondsEnv("POLL_INTERVAL_SECONDS", 30, { allowZero: false }) * 1000,
    bootstrapGraceSeconds: secondsEnv("BOOTSTRAP_GRACE_SECONDS", 60, { allowZero: true }),
    eventMode: normalizeEventMode(process.env.EVENT_MODE_INPUT || process.env.CODEX_REVIEW_GATE_EVENT_MODE || ""),
    autoRetry: process.env.CODEX_REVIEW_GATE_AUTO_RETRY || "",
    codexBotLogins: parseLoginSet(process.env.CODEX_BOT_LOGINS || "", DEFAULT_CODEX_BOT_LOGINS),
    trustedCommentLogins: parseLoginSet(
      process.env.TRUSTED_COMMENT_LOGINS || "",
      DEFAULT_TRUSTED_COMMENT_LOGINS,
    ),
  };
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function secondsEnv(name, fallback, { allowZero }) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  const valid = Number.isFinite(parsed) && (allowZero ? parsed >= 0 : parsed > 0);
  if (!valid) {
    throw new Error(`${name} must be a ${allowZero ? "non-negative" : "positive"} number`);
  }
  return parsed;
}

function parseRepo(repository) {
  const parts = repository.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`invalid GITHUB_REPOSITORY: ${repository}`);
  }
  return { owner: parts[0], name: parts[1] };
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

async function loadPullRequest() {
  const { data } = await request("GET", `${repoPath}/pulls/${activePrNumber}`);
  if (!statusSha) {
    statusSha = data.head.sha;
  }
  console.log(`Loaded PR #${activePrNumber}; PR head is ${data.head.sha}; gate head is ${statusSha}.`);
  return data;
}

async function failIfPullRequestHeadChanged(phase = "while waiting for Codex") {
  const pullRequest = await loadPullRequest();
  failIfLoadedPullRequestHeadChanged(pullRequest, phase);
}

function failIfLoadedPullRequestHeadChanged(pullRequest, phase) {
  if (pullRequest.head.sha === statusSha) {
    return;
  }

  throw new GateFailure(
    "error",
    `PR head changed ${phase}`,
    `PR head changed from ${statusSha} to ${pullRequest.head.sha}; this gate run is stale.`,
  );
}

function failIfCurrentHeadHasCodexFindings(findings) {
  if (findings.count === 0) {
    return;
  }

  const sample = findings.samples[0];
  const suffix = sample ? ` First finding: ${sample}` : "";
  throw new GateFailure(
    "failure",
    `Codex posted ${findings.count} finding(s) on current head`,
    `Codex review found ${findings.count} finding(s) for ${statusSha}.${suffix}`,
  );
}

function reviewIdentity(review) {
  if (!review) {
    return null;
  }
  return {
    id: String(review.id),
    state: review.state,
    commitId: review.commit_id || "",
    submittedAt: review.submitted_at || review.created_at || "",
    user: review.user?.login || "",
  };
}

function selectLatestCodexApprovedReview(reviews, botLogins = DEFAULT_CODEX_BOT_LOGINS) {
  return selectLatestCodexReview(reviews, botLogins, (review) => review.state === "APPROVED");
}

function selectLatestCodexSubmittedReview(reviews, botLogins = DEFAULT_CODEX_BOT_LOGINS) {
  return selectLatestCodexReview(reviews, botLogins, (review) => review.state === "COMMENTED");
}

function selectLatestCodexReview(reviews, botLogins, predicate) {
  const matches = reviews
    .filter((review) =>
      isCodexBot(review.user?.login, botLogins) &&
      review.commit_id === statusSha &&
      predicate(review),
    )
    .map(reviewIdentity);

  matches.sort((left, right) => {
    const bySubmittedAt = parseTimestamp(right.submittedAt, "Codex review submission time") -
      parseTimestamp(left.submittedAt, "Codex review submission time");
    if (bySubmittedAt !== 0) {
      return bySubmittedAt;
    }
    return Number(right.id) - Number(left.id);
  });

  return matches[0] || null;
}

async function setCommitStatus(state, description) {
  await request("POST", `${repoPath}/statuses/${statusSha}`, {
    state,
    context: STATUS_CONTEXT,
    description: truncate(description, 140),
    target_url: runUrl,
  });
  console.log(`Set ${STATUS_CONTEXT}=${state}: ${description}`);
}

async function paginate(path, query) {
  const results = [];
  let page = 1;

  while (true) {
    const { data } = await request("GET", path, { ...query, page: String(page) });
    if (!Array.isArray(data)) {
      throw new Error(`paginated endpoint did not return an array: ${path}`);
    }
    results.push(...data);
    if (data.length < Number(query.per_page || 100)) {
      return results;
    }
    page += 1;
  }
}

async function loadReviewThreads() {
  const threads = [];
  let after = null;

  while (true) {
    const { data } = await graphqlRequest(REVIEW_THREADS_QUERY, {
      owner: repo.owner,
      repo: repo.name,
      number: activePrNumber,
      after,
    });
    const connection = data?.repository?.pullRequest?.reviewThreads;
    if (!connection) {
      throw new Error("GraphQL reviewThreads query did not return a connection");
    }

    threads.push(...(connection.nodes || []));
    if (!connection.pageInfo?.hasNextPage) {
      return Promise.all(threads.map((thread) => loadAllReviewThreadComments(thread)));
    }
    after = connection.pageInfo.endCursor;
  }
}

async function loadAllReviewThreadComments(thread) {
  let connection = thread.comments || { nodes: [] };
  const nodes = [...(connection.nodes || [])];
  let after = connection.pageInfo?.endCursor || null;

  while (connection.pageInfo?.hasNextPage) {
    const { data } = await graphqlRequest(REVIEW_THREAD_COMMENTS_QUERY, {
      threadId: thread.id,
      after,
    });
    connection = data?.node?.comments;
    if (!connection) {
      throw new Error(`GraphQL comments query did not return a connection for thread ${thread.id}`);
    }

    nodes.push(...(connection.nodes || []));
    after = connection.pageInfo?.endCursor || null;
  }

  return {
    ...thread,
    comments: {
      ...(thread.comments || {}),
      nodes,
      pageInfo: {
        hasNextPage: false,
        endCursor: after,
      },
    },
  };
}

async function request(method, path, bodyOrQuery) {
  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    const url = new URL(`${config.apiUrl}${path}`);
    const options = {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${config.token}`,
        "User-Agent": "codex-review-gate",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    };

    if (method === "GET") {
      for (const [key, value] of Object.entries(bodyOrQuery || {})) {
        url.searchParams.set(key, value);
      }
    } else if (bodyOrQuery) {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(bodyOrQuery);
    }

    let response;
    try {
      response = await fetch(url, options);
    } catch (error) {
      if (attempt < MAX_REQUEST_ATTEMPTS && restRequestRetryAllowed(method, path, 503)) {
        await sleepBeforeRetry(`retrying ${method} ${url.pathname} after fetch error: ${error.message}`, attempt);
        continue;
      }
      throw error;
    }

    const text = await response.text();
    let data;
    try {
      data = parseJsonResponseText(text, `${method} ${url.pathname} (${response.status})`);
    } catch (error) {
      if (
        error instanceof NonJsonResponseError &&
        !response.ok &&
        attempt < MAX_REQUEST_ATTEMPTS &&
        restRequestRetryAllowed(method, path, response.status)
      ) {
        await sleepBeforeRetry(
          `retrying ${method} ${url.pathname} after ${response.status}: ${error.preview}`,
          attempt,
          response.headers.get("retry-after"),
        );
        continue;
      }
      throw error;
    }

    if (!response.ok) {
      const message = data?.message || response.statusText;
      if (
        attempt < MAX_REQUEST_ATTEMPTS &&
        restRequestRetryAllowed(method, path, response.status)
      ) {
        await sleepBeforeRetry(
          `retrying ${method} ${url.pathname} after ${response.status}: ${message}`,
          attempt,
          response.headers.get("retry-after"),
        );
        continue;
      }
      throw new Error(`${method} ${url.pathname} failed with ${response.status}: ${message}`);
    }

    return { data, headers: response.headers };
  }

  throw new Error(`${method} ${path} exceeded retry budget`);
}

async function graphqlRequest(query, variables) {
  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await fetch(config.graphqlUrl, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
          "User-Agent": "codex-review-gate",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (error) {
      if (attempt < MAX_REQUEST_ATTEMPTS) {
        await sleepBeforeRetry(`retrying GraphQL request after fetch error: ${error.message}`, attempt);
        continue;
      }
      throw error;
    }

    const text = await response.text();
    let payload;
    try {
      payload = parseJsonResponseText(
        text,
        `POST ${new URL(config.graphqlUrl).pathname} (${response.status})`,
      );
    } catch (error) {
      if (error instanceof NonJsonResponseError && !response.ok && attempt < MAX_REQUEST_ATTEMPTS) {
        await sleepBeforeRetry(
          `retrying GraphQL request after ${response.status}: ${error.preview}`,
          attempt,
          response.headers.get("retry-after"),
        );
        continue;
      }
      throw error;
    }

    if (!response.ok) {
      const message = payload?.message || response.statusText;
      if (attempt < MAX_REQUEST_ATTEMPTS && isRetryableHttpStatus(response.status)) {
        await sleepBeforeRetry(
          `retrying GraphQL request after ${response.status}: ${message}`,
          attempt,
          response.headers.get("retry-after"),
        );
        continue;
      }
      throw new Error(`POST ${new URL(config.graphqlUrl).pathname} failed with ${response.status}: ${message}`);
    }
    if (payload?.errors?.length) {
      const message = payload.errors.map((error) => error.message).join("; ");
      throw new Error(`GraphQL reviewThreads query failed: ${message}`);
    }

    return { data: payload?.data };
  }

  throw new Error("GraphQL request exceeded retry budget");
}

function graphqlEndpoint(apiUrl, serverUrl) {
  if (apiUrl.endsWith("/api/v3")) {
    return `${serverUrl}/api/graphql`;
  }
  return `${apiUrl}/graphql`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sleepBeforeRetry(message, attempt, retryAfter = null) {
  const fallbackMs = Math.min(1000 * 2 ** (attempt - 1), 10_000);
  const delayMs = retryAfterDelayMs(retryAfter, fallbackMs);
  console.warn(`${message}; retrying in ${Math.round(delayMs / 1000)}s`);
  await sleep(delayMs);
}
