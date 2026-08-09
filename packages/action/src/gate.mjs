#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual, TextDecoder } from "node:util";

import {
  DEFAULT_CODEX_BOT_LOGINS,
  DEFAULT_TRUSTED_COMMENT_LOGINS,
  GateFailure,
  MARKER_STATE_CONFLICT_DESCRIPTION,
  NonJsonResponseError,
  STATUS_CONTEXT,
  STATE_VERSION,
  activeMarkerIsObsolete,
  addSeconds,
  autoRetryEnabled,
  buildMarkerCommentBody,
  buildStateCommentBody,
  closeActiveMarker,
  codexInlineParentReviewBodyHasClosedGrammar,
  collectCodexThreadEvidence,
  createInitialState,
  eventMayHaveReadOnlyDependabotToken,
  eventModeHandlesEvent,
  failedFindingsRecoveryEnabled,
  findLatestTrustedMarkerComment,
  findLatestTrustedStateComment,
  hasNewCompletionComment,
  hasNewEyesTransition,
  hasNewReviewTransition,
  isoNow,
  hasTrustedGateStateOrMarker,
  isCodexBot,
  isCodexCompletionComment,
  isRetryableHttpStatus,
  issueCommentIdentity,
  markerAckTimeoutSecondsForHistory,
  markerCanAcceptAckSignal,
  markerFromComment,
  markerTimeoutOutcome,
  normalizeEventMode,
  normalizeFailedFindingsRecoveryMode,
  normalizeState,
  normalizeMarkerAckTimeoutSeconds,
  parseCodexIssueCommentArtifact,
  parseCodexReviewArtifact,
  parseLoginSet,
  parseJsonResponseText,
  parseStateCommentBody,
  parseTimestamp,
  pullRequestIsDependabot,
  reconcileStateWithMarkerComment,
  restRequestRetryAllowed,
  retryAfterDelayMs,
  sameIssueCommentIdentity,
  selectLatestCodexCompletionComment,
  shouldCreateFreshHeadMarker,
  shouldSkipScheduledScanWithoutMarker,
  stateNeedsFreshMarkerAfterMissingMarker,
  stateNeedsFreshMarkerAfterRecovery,
  stateFromRecoveredMarkerComment,
  summarizeFindingsForState,
  sortCodexArtifactsNewestFirst,
  summarizeCodexSignalReactions,
  truncate,
  updateStateForStatus,
} from "./core.mjs";
import {
  EvidenceWorkBudget,
  mapWithConcurrency,
} from "./evidence-budget.mjs";

const MAX_EVIDENCE_ITEMS_PER_SNAPSHOT = 20_000;
const MAX_EVIDENCE_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_EVIDENCE_RESPONSE_BYTES_PER_RUN = 64 * 1024 * 1024;
const MAX_EVIDENCE_REQUEST_ATTEMPTS_PER_RUN = 1_024;
const MAX_EVIDENCE_HTTP_CONCURRENCY = 4;
const MAX_REVIEW_THREAD_COMMENT_CONCURRENCY = 4;
const STATUS_READ_PAGE_SIZE = 100;
const MAX_STATUS_READ_PAGES = 10;
const MAX_STATUS_READ_ITEMS = 1_000;
const MAX_STATUS_READ_RESPONSE_BYTES = 1024 * 1024;
const MAX_STATUS_READ_BYTES = 4 * 1024 * 1024;
const MAX_STATUS_READ_REQUEST_ATTEMPTS = 16;
const PRODUCER_RECEIPT_SCHEMA =
  "urn:joeyteng:codex-review-gate:producer-receipt:1";

const config = readConfig();
const repo = parseRepo(config.repository);
const repoPath = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
const runUrl =
  `${config.serverUrl}/${repo.owner}/${repo.name}/actions/runs/${config.runId}` +
  `/attempts/${config.runAttempt}`;
const producerReceipt = createProducerReceipt();
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
                id
                fullDatabaseId
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
        id
        isResolved
        comments(first: 100, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            fullDatabaseId
          }
        }
      }
    }
  }
`;
const REVIEW_THREAD_STATES_QUERY = `
  query CodexReviewGateReviewThreadStates(
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
          }
        }
      }
    }
  }
`;

let activePrNumber = config.prNumber;
let statusSha = config.headSha;
let statusReady = false;
let evidenceWorkBudget = null;
const MAX_REQUEST_ATTEMPTS = 4;
const MAX_WHOLE_SNAPSHOT_ATTEMPTS = 2;
const MAX_REST_PAGES = 1_000;
const MAX_GRAPHQL_PAGES = 1_000;
const MAX_IN_PROCESS_RETRY_WAIT_MS = 10_000;
const ORCHESTRATION_PERSISTENCE_FENCE_DESCRIPTION =
  "Review orchestration state persistence failed; fresh marker required";
main().then(() => {
  finishProducerReceipt("completed");
}).catch(async (error) => {
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
  try {
    finishProducerReceipt("failed");
  } catch (receiptError) {
    console.error(`failed to finalize producer receipt: ${receiptError.message}`);
  }
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
    const completionComment = isCodexCompletionComment(event.comment, config.codexBotLogins)
      ? issueCommentIdentity(event.comment)
      : null;
    return number > 0
      ? { kind: "single", prNumber: number, allowCreateMarker: false, completionComment }
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
      await processPullRequest(
        pullRequest.number,
        {
          ...trigger,
          allowCreateMarker: trigger.allowCreateMarker === true,
          scan: true,
        },
        pullRequest,
      );
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
  if (!statusReady) {
    console.error(
      `skipping ${STATUS_CONTEXT} failure write for PR #${pullRequest.number}; ` +
        "scheduled write eligibility was not established",
    );
    return;
  }

  activePrNumber = pullRequest.number;
  statusSha = statusSha || pullRequest.head?.sha || "";
  statusReady = false;
  if (!statusSha) {
    console.error(`failed to set ${STATUS_CONTEXT}=error for PR #${activePrNumber}: missing head SHA`);
    return;
  }

  try {
    const state = error instanceof GateFailure ? error.state : "error";
    const description = error instanceof GateFailure
      ? error.description
      : `Codex review gate errored while scanning PR #${activePrNumber}`;
    await setCommitStatus(state, description);
  } catch (statusError) {
    console.error(
      `failed to set ${STATUS_CONTEXT} after scan error for PR #${activePrNumber} ` +
        `after ${error.name || "Error"}: ${statusError.message}`,
    );
  } finally {
    statusReady = false;
  }
}

async function processPullRequest(prNumber, trigger, scanCandidate = null) {
  activePrNumber = prNumber;
  statusSha = "";
  statusReady = false;
  evidenceWorkBudget = createEvidenceWorkBudget();

  const dependabotScheduleRecovery = trigger.kind === "scan" &&
    !trigger.allowCreateMarker &&
    pullRequestIsDependabot(scanCandidate);

  let initialComments = null;
  let initialSnapshotBudget = null;
  if (
    trigger.kind === "scan" &&
    !trigger.allowCreateMarker &&
    !dependabotScheduleRecovery
  ) {
    if (scanCandidate?.head?.sha) {
      statusSha = scanCandidate.head.sha;
      const liveStatus = await loadLatestGateStatus();
      statusReady = Boolean(
        !liveStatus.readFailed &&
          liveStatus.producerMatches &&
          liveStatus.latest,
      );
    }
    initialSnapshotBudget = createEvidenceSnapshotBudget();
    initialComments = await paginate(
      `${repoPath}/issues/${activePrNumber}/comments`,
      { per_page: "100" },
      { evidenceBudget: initialSnapshotBudget },
    );
    if (
      !hasTrustedGateStateOrMarker(
        initialComments,
        config.trustedCommentLogins,
      )
    ) {
      console.log(
        `PR #${activePrNumber} has no trusted gate state or marker; skipping scheduled scan.`,
      );
      statusSha = "";
      statusReady = false;
      return;
    }
  }

  if (trigger.kind === "scan" && scanCandidate?.head?.sha) {
    statusSha = scanCandidate.head.sha;
    statusReady = true;
  }

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

  const snapshot = await loadSnapshot({
    initialComments,
    initialSnapshotBudget,
  });
  const scheduledWithoutTrustedState =
    trigger.kind === "scan" &&
    !trigger.allowCreateMarker &&
    !dependabotScheduleRecovery &&
    snapshot.findings.count === 0 &&
    !hasTrustedGateStateOrMarker(snapshot.comments, config.trustedCommentLogins);
  if (scheduledWithoutTrustedState) {
    console.log(
      `PR #${activePrNumber} has no trusted gate state or marker; skipping scheduled scan.`,
    );
    return;
  }

  let {
    state,
    stateComment: savedStateComment,
    needsFreshMarker: stateNeedsFreshMarker,
    needsSave: stateNeedsSave,
    legacyFailureCandidate,
    reviewOrchestrationBlocked = false,
  } = await loadAuditState(snapshot);

  if (snapshot.findings.count > 0) {
    const evidenceIssue = snapshotEvidenceIssue(snapshot);
    const findingOrchestration =
      reviewOrchestrationBlocked ||
      snapshot.providerSnapshotIncomplete ||
      Boolean(evidenceIssue)
      ? { state, stateComment: savedStateComment }
      : await prepareFindingReviewOrchestration(
          snapshot,
          state,
          savedStateComment,
          trigger,
          stateNeedsFreshMarker,
        );
    await failFromFindings(
      snapshot.findings,
      findingOrchestration.state,
      findingOrchestration.stateComment,
      {
        preserveAuditState:
          reviewOrchestrationBlocked || snapshot.providerSnapshotIncomplete,
        evidenceIssue,
      },
    );
    return;
  }

  failIfSnapshotEvidenceIsInvalid(snapshot);

  if (
    await reconcileCurrentReviewEvidence(
      snapshot,
      state,
      savedStateComment,
      { reviewOrchestrationBlocked },
    )
  ) {
    return;
  }
  const providerProgressIsPending =
    snapshot.progressObserved === true &&
    snapshot.providerResult.kind === "pending";

  const legacyMigration = migrateLegacyFailureState(
    state,
    snapshot,
    isoNow(),
    { legacyFailureCandidate },
  );
  state = legacyMigration.state;
  stateNeedsFreshMarker = stateNeedsFreshMarker || legacyMigration.needsFreshMarker;
  stateNeedsSave = stateNeedsSave || legacyMigration.changed;
  const fenceRecovery = await recoverOrchestrationPersistenceFence(
    state,
    savedStateComment,
    snapshot,
  );
  state = fenceRecovery.state;
  savedStateComment = fenceRecovery.stateComment;
  stateNeedsFreshMarker =
    stateNeedsFreshMarker || fenceRecovery.needsFreshMarker;
  if (fenceRecovery.recovered) {
    stateNeedsSave = false;
  }
  const legacyPassedMigration = migrateLegacyPassedState(
    state,
    snapshot,
    isoNow(),
  );
  state = legacyPassedMigration.state;
  stateNeedsFreshMarker =
    stateNeedsFreshMarker || legacyPassedMigration.needsFreshMarker;
  if (legacyPassedMigration.changed) {
    savedStateComment = await saveOrchestrationCriticalState(
      state,
      savedStateComment,
      "legacy passed-marker audit migration",
    );
    stateNeedsSave = false;
  }
  state = migrateStateForEventDrivenDeadlines(state);
  stateNeedsFreshMarker = stateNeedsFreshMarker ||
    stateNeedsFreshMarkerAfterRecovery(state) ||
    stateNeedsFreshMarkerAfterMissingMarker(state, statusSha) ||
    stateNeedsFreshMarkerAfterLiveEvidenceLoss(state, snapshot);
  let headChanged =
    state.statusHead !== statusSha ||
    activeMarkerIsObsolete(state.activeMarker, statusSha);

  let allowCreateMarker = trigger.allowCreateMarker || stateNeedsFreshMarker;

  if (stateNeedsSave) {
    try {
      savedStateComment = await saveState(state, savedStateComment);
    } catch (error) {
      console.warn(`failed to save initial audit state: ${error.message}`);
    }
    stateNeedsSave = false;
  }

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

  const progressSuppressesFreshMarker =
    providerProgressIsPending &&
    !headChanged &&
    !state.activeMarker &&
    !latestMarkerForCurrentHead(state);
  if (progressSuppressesFreshMarker) {
    allowCreateMarker = false;
  }

  let freshHeadMarkerAllowed = shouldCreateFreshHeadMarker({
    allowCreateMarker,
    hasActiveMarker: Boolean(state.activeMarker),
    headChanged,
    stateNeedsFreshMarker,
  });
  if (freshHeadMarkerAllowed) {
    const markerResult = await advanceEventDrivenMarker(
      state,
      savedStateComment,
      snapshot,
      {
        ...trigger,
        allowCreateMarker: true,
        suppressFreshMarker: progressSuppressesFreshMarker,
      },
    );
    state = markerResult.state;
    savedStateComment = markerResult.stateComment;
    if (markerResult.kind === "terminal") {
      return;
    }
    headChanged = false;
    stateNeedsFreshMarker = false;
    freshHeadMarkerAllowed = false;
  }

  const reconciliationTimeout = await timeOutCurrentHeadWaitCycleIfNeeded(
    state,
    savedStateComment,
  );
  if (reconciliationTimeout.timedOut) {
    return;
  }

  if (
    snapshot.findings.count === 0 &&
    (snapshot.providerResult.kind === "pending" || Boolean(state.activeMarker)) &&
    !currentHeadWaitCycleTimedOut(state)
  ) {
    await setCommitStatusIfNeeded("pending", "Waiting for a complete current-head Codex review result");
    state = updateStateForStatus(state, {
      now: isoNow(),
      statusHead: statusSha,
      runUrl,
      status: "pending",
    });
    try {
      savedStateComment = await saveState(state, savedStateComment);
    } catch (error) {
      console.warn(`failed to save audit state after ${STATUS_CONTEXT}=pending: ${error.message}`);
    }
  }

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

  const result = await advanceEventDrivenMarker(
    state,
    savedStateComment,
    snapshot,
    {
      ...trigger,
      allowCreateMarker,
      suppressFreshMarker: progressSuppressesFreshMarker,
    },
  );
  if (result.kind === "save") {
    await saveState(result.state, result.stateComment);
  }
}

async function loadAuditState(snapshot) {
  try {
    return await ensureState(snapshot, null, null, { persist: false });
  } catch (error) {
    const providerOutcomeIsAuthoritative =
      snapshot.findings.count > 0 ||
      providerResultIsCurrentHeadClean(snapshot.providerResult);
    if (
      !(error instanceof GateFailure) ||
      error.description !== MARKER_STATE_CONFLICT_DESCRIPTION ||
      !providerOutcomeIsAuthoritative
    ) {
      throw error;
    }
    console.warn(
      `ignored conflicting marker audit while applying authoritative live review evidence: ` +
        `${error.message}`,
    );
    return {
      state: createInitialAuditState(snapshot),
      stateComment: null,
      needsFreshMarker: true,
      needsSave: true,
      legacyFailureCandidate: false,
      reviewOrchestrationBlocked: true,
    };
  }
}

async function prepareFindingReviewOrchestration(
  snapshot,
  state,
  stateComment,
  trigger,
  stateNeedsFreshMarker,
) {
  let preparedState = state;
  const headChanged =
    preparedState.statusHead !== statusSha ||
    activeMarkerIsObsolete(preparedState.activeMarker, statusSha);
  if (activeMarkerIsObsolete(preparedState.activeMarker, statusSha)) {
    preparedState = closeActiveMarker(
      preparedState,
      "obsolete_head",
      isoNow(),
      { currentHeadSha: statusSha },
    );
  }

  const allowCreateMarker =
    trigger.allowCreateMarker ||
    stateNeedsFreshMarker ||
    headChanged;
  const freshHeadMarkerAllowed = shouldCreateFreshHeadMarker({
    allowCreateMarker,
    hasActiveMarker: Boolean(preparedState.activeMarker),
    headChanged,
    stateNeedsFreshMarker,
  });
  if (!freshHeadMarkerAllowed) {
    return { state: preparedState, stateComment };
  }

  try {
    const result = await advanceEventDrivenMarker(
      preparedState,
      stateComment,
      snapshot,
      { ...trigger, allowCreateMarker: true },
    );
    return {
      state: result.state,
      stateComment: result.stateComment,
    };
  } catch (error) {
    console.warn(
      `failed to prepare current-head review orchestration before recording findings: ` +
        `${error.message}`,
    );
    return { state: preparedState, stateComment };
  }
}

async function ensureState(snapshot, previousState, previousComment, { persist = true } = {}) {
  if (previousState && previousComment) {
    return {
      state: previousState,
      stateComment: previousComment,
      needsFreshMarker: false,
      needsSave: false,
      legacyFailureCandidate: false,
    };
  }

  const stateComment = findLatestTrustedStateComment(snapshot.comments, config.trustedCommentLogins);
  if (stateComment) {
    const markerComment = findLatestTrustedMarkerComment(snapshot.comments, config.trustedCommentLogins);
    const parsedState = parseStateCommentBody(stateComment.body || "");
    const reconciled = reconcileStateWithMarkerComment(
      parsedState,
      markerComment,
      isoNow(),
    );
    const reconciledStateComment = reconciled.changed && persist
      ? await saveState(reconciled.state, stateComment)
      : stateComment;

    return {
      state: reconciled.state,
      stateComment: reconciledStateComment,
      needsFreshMarker: false,
      needsSave: reconciled.changed && !persist,
      legacyFailureCandidate:
        !parsedState.activeMarker &&
        (parsedState.history || []).length === 0 &&
        parsedState.lastStatus?.state === "failure",
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
    : createInitialAuditState(snapshot, now);

  if (markerComment) {
    state.bootstrap = {
      ...(state.bootstrap || {}),
      status: "closed",
      closedAt: state.bootstrap?.closedAt || now,
      closeReason: state.bootstrap?.closeReason || "event_driven",
    };
  }

  const createdStateComment = persist ? await saveState(state, null) : null;
  return {
    state,
    stateComment: createdStateComment,
    needsFreshMarker: true,
    needsSave: !persist,
    legacyFailureCandidate: false,
  };
}

function createInitialAuditState(snapshot, now = isoNow()) {
  const state = createInitialState({
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
  return state;
}

function stateNeedsFreshMarkerAfterLiveEvidenceLoss(state, snapshot) {
  return (
    !state?.activeMarker &&
    state?.lastStatus?.headSha === statusSha &&
    state?.lastStatus?.state === "success" &&
    snapshot?.providerResult?.kind === "pending"
  );
}

function migrateLegacyFailureState(
  state,
  snapshot,
  now,
  { legacyFailureCandidate = false } = {},
) {
  const history = state?.history || [];
  const marker = state?.activeMarker;
  const lastStatus = state?.lastStatus;
  const matchesLegacyFailureState =
    legacyFailureCandidate &&
    history.length === 0 &&
    state.statusHead === statusSha &&
    lastStatus?.headSha === statusSha &&
    lastStatus?.state === "failure";
  if (!matchesLegacyFailureState) {
    return { state, changed: false, needsFreshMarker: false };
  }
  if (!marker || marker.headSha !== statusSha) {
    return { state, changed: false, needsFreshMarker: true };
  }

  let markerPredatesFailure;
  try {
    markerPredatesFailure =
      parseTimestamp(marker.createdAt, "legacy marker creation time") <=
      parseTimestamp(lastStatus.updatedAt, "legacy failure status time");
  } catch {
    return {
      state: closeActiveMarker(state, "state_lost", now, {
        recoveryReason: "legacy_failure_lineage_unknown",
      }),
      changed: true,
      needsFreshMarker: true,
    };
  }
  if (!markerPredatesFailure) {
    return { state, changed: false, needsFreshMarker: false };
  }

  if (snapshot.findings.count > 0) {
    return {
      state: closeActiveMarker(
        state,
        "failed_findings",
        lastStatus.updatedAt,
        {
          currentHeadFindings: summarizeFindingsForState(snapshot.findings),
          recoveryReason: "legacy_failure_evidence_recovery",
        },
      ),
      changed: true,
      needsFreshMarker: false,
    };
  }

  return {
    state: closeActiveMarker(state, "state_lost", now, {
      recoveryReason: "legacy_failure_lineage_unknown",
    }),
    changed: true,
    needsFreshMarker: true,
  };
}

function migrateLegacyPassedState(state, snapshot, now) {
  if (
    state?.activeMarker ||
    state?.statusHead !== statusSha
  ) {
    return { state, changed: false, needsFreshMarker: false };
  }

  const history = state.history || [];
  const markerIndex = history.findLastIndex((marker) => marker.headSha === statusSha);
  const marker = markerIndex >= 0 ? history[markerIndex] : null;
  if (
    !marker ||
    (marker.outcome || marker.state) !== "passed" ||
    marker.observedProviderResult
  ) {
    return { state, changed: false, needsFreshMarker: false };
  }

  const requireFreshMarker = () => ({
    state,
    changed: false,
    needsFreshMarker: true,
  });
  if (
    state?.lastStatus?.headSha !== statusSha ||
    state?.lastStatus?.state !== "success"
  ) {
    return requireFreshMarker();
  }
  const providerResult = snapshot?.providerResult;
  if (
    snapshot?.findings?.count !== 0 ||
    providerResult?.kind !== "clean" ||
    providerResult.headSha !== statusSha.toLowerCase() ||
    !trustedLiveMarkerMatches(marker, snapshot)
  ) {
    return requireFreshMarker();
  }

  let lineageMatches = false;
  try {
    if (marker.observedApprovedReview) {
      const legacyReview = marker.observedApprovedReview;
      lineageMatches =
        providerResult.source === "pull-request-review" &&
        String(providerResult.id) === String(legacyReview.id) &&
        providerResult.createdAt === legacyReview.submittedAt &&
        legacyReview.state === "APPROVED" &&
        String(legacyReview.commitId || "").toLowerCase() === statusSha.toLowerCase() &&
        hasNewReviewTransition(
          marker.baseline?.approvedReview,
          {
            id: String(providerResult.id),
            submittedAt: providerResult.createdAt,
          },
          marker.createdAt,
        );
    } else if (marker.observedCompletionComment) {
      const legacyComment = marker.observedCompletionComment;
      const currentComment = {
        id: String(providerResult.id),
        createdAt: providerResult.createdAt,
      };
      lineageMatches =
        providerResult.source === "issue-comment" &&
        sameIssueCommentIdentity(legacyComment, currentComment) &&
        hasNewCompletionComment(
          marker.baseline?.completionComment,
          currentComment,
          marker.createdAt,
          { bufferSeconds: config.completionSignalBufferSeconds },
        );
    }
  } catch {
    return requireFreshMarker();
  }

  if (!lineageMatches) {
    return requireFreshMarker();
  }

  return {
    state: normalizeState({
      ...state,
      updatedAt: now,
      history: history.map((candidate, index) =>
        index === markerIndex
          ? {
              ...candidate,
              observedProviderResult: providerResult,
              auditLineageMigratedAt: now,
            }
          : candidate,
      ),
    }),
    changed: true,
    needsFreshMarker: false,
  };
}

async function advanceEventDrivenMarker(state, stateComment, snapshot, trigger) {
  let allowCreateMarker =
    !trigger.suppressFreshMarker &&
    (trigger.allowCreateMarker || stateNeedsFreshMarkerAfterRecovery(state));

  for (let iteration = 0; iteration < 4; iteration += 1) {
    if (!state.activeMarker) {
      const timeout = await timeOutCurrentHeadWaitCycleIfNeeded(state, stateComment);
      if (timeout.timedOut) {
        return {
          kind: "terminal",
          state: timeout.state,
          stateComment: timeout.stateComment,
        };
      }

      if (!allowCreateMarker || trigger.suppressFreshMarker) {
        console.log(`PR #${activePrNumber} has no active marker; skipping ${trigger.kind} trigger.`);
        return { kind: "done", state, stateComment };
      }

      const waitCycle = waitCycleForState(state, isoNow());

      const marker = await createGateMarker(snapshot.baseline, state, waitCycle);
      state = normalizeState({
        ...state,
        updatedAt: isoNow(),
        activeMarker: marker,
      });
      stateComment = await saveState(state, stateComment);
      await setCommitStatusIfNeeded("pending", "Waiting for Codex review on controlled marker");
      console.log(`PR #${activePrNumber} is waiting for Codex review marker ${marker.id}.`);
      return { kind: "done", state, stateComment };
    }

    state = migrateStateForEventDrivenDeadlines(state);
    const activeMarker = state.activeMarker;

    if (activeMarkerIsObsolete(activeMarker, statusSha)) {
      state = closeActiveMarker(state, "obsolete_head", isoNow(), { currentHeadSha: statusSha });
      stateComment = await saveState(state, stateComment);
      await setCommitStatus("pending", "Previous Codex marker was for an obsolete head");
      allowCreateMarker = !trigger.suppressFreshMarker;
      continue;
    }

    const timeoutOutcome = markerTimeoutOutcome(activeMarker);
    if (timeoutOutcome === "max_wait") {
      const timeout = await timeOutCurrentHeadWaitCycleIfNeeded(state, stateComment);
      return {
        kind: "terminal",
        state: timeout.state,
        stateComment: timeout.stateComment,
      };
    }

    const approvedReview = selectLatestCodexApprovedReview(snapshot.reviews, config.codexBotLogins);
    if (
      snapshot.providerResult.kind === "clean" &&
      snapshot.providerResult.source === "pull-request-review" &&
      String(snapshot.providerResult.id) === String(approvedReview?.id) &&
      snapshot.providerResult.createdAt === approvedReview?.submittedAt &&
      snapshot.providerResult.headSha === statusSha.toLowerCase() &&
      hasNewReviewTransition(
        activeMarker.baseline?.approvedReview,
        approvedReview,
        activeMarker.createdAt,
      )
    ) {
      await passGate(state, stateComment, snapshot, {
        observedApprovedReview: approvedReview,
      });
      return { kind: "done", state, stateComment };
    }

    if (
      snapshot.providerResult.kind === "clean" &&
      snapshot.providerResult.source === "issue-comment" &&
      String(snapshot.providerResult.id) === String(snapshot.completionComment?.id) &&
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
      allowCreateMarker = !trigger.suppressFreshMarker;
      continue;
    }

    if (timeoutOutcome === "stalled") {
      state = closeActiveMarker(state, "stalled", isoNow(), {
        stalledAfterSeconds: Math.round(config.markerTimeoutMs / 1000),
        lastObservedEyes: snapshot.reactions.eyes,
        lastObservedCompletionComment: snapshot.completionComment,
      });
      stateComment = await saveState(state, stateComment);
      allowCreateMarker = !trigger.suppressFreshMarker;
      continue;
    }

    console.log(`PR #${activePrNumber} has no due Codex review gate transition.`);
    return { kind: "done", state, stateComment };
  }

  throw new Error(`PR #${activePrNumber} exceeded event-driven transition budget`);
}

async function reconcileCurrentReviewEvidence(
  snapshot,
  state,
  stateComment,
  { reviewOrchestrationBlocked = false } = {},
) {
  failIfSnapshotEvidenceIsInvalid(snapshot);
  if (snapshot.providerResult.kind !== "clean") {
    return false;
  }
  if (!providerResultIsCurrentHeadClean(snapshot.providerResult)) {
    throw new GateFailure(
      "error",
      "Codex clean result is not bound to the current head",
      `The selected Codex clean result is not bound to ${statusSha}.`,
    );
  }

  await passGateFromCurrentEvidence(
    state,
    stateComment,
    snapshot,
    { reviewOrchestrationBlocked },
  );
  return true;
}

function providerResultIsCurrentHeadClean(providerResult) {
  return (
    providerResult?.kind === "clean" &&
    new Set(["issue-comment", "pull-request-review"]).has(providerResult.source) &&
    providerResult.headSha === statusSha.toLowerCase()
  );
}

async function markerStateConflictBlocksReviewOrchestration(snapshot) {
  try {
    await ensureState(snapshot, null, null, { persist: false });
    return false;
  } catch (error) {
    if (
      error instanceof GateFailure &&
      error.description === MARKER_STATE_CONFLICT_DESCRIPTION
    ) {
      return true;
    }
    throw error;
  }
}

function matchingTrustedLiveMarker(recordedMarker, snapshot) {
  const markerComment = findLatestTrustedMarkerComment(
    snapshot?.comments || [],
    config.trustedCommentLogins,
  );
  const liveMarker = markerComment ? markerFromComment(markerComment) : null;
  if (!liveMarker) {
    return null;
  }
  if (
    liveMarker.version !== STATE_VERSION ||
    recordedMarker?.version !== STATE_VERSION
  ) {
    return null;
  }

  const immutableFields = [
    "version",
    "id",
    "headSha",
    "runUrl",
    "runId",
    "runAttempt",
    "attempt",
    "createdAt",
  ];
  const waitBudgetFields = ["headStartedAt", "maxWaitDeadlineAt"];
  if (
    !immutableFields.every((field) =>
      String(liveMarker[field] ?? "") === String(recordedMarker[field] ?? "")
    ) ||
    !waitBudgetFields.every((field) =>
      liveMarker[field] == null ||
      String(liveMarker[field]) === String(recordedMarker[field] ?? "")
    ) ||
    !isDeepStrictEqual(liveMarker.baseline || {}, recordedMarker.baseline || {})
  ) {
    return null;
  }
  return liveMarker;
}

function trustedLiveMarkerMatches(recordedMarker, snapshot) {
  return Boolean(matchingTrustedLiveMarker(recordedMarker, snapshot));
}

function failIfSnapshotEvidenceIsInvalid(snapshot) {
  const reason = snapshotEvidenceIssue(snapshot);
  if (!reason) {
    return;
  }

  throw new GateFailure(
    "error",
    evidenceIssueStatusDescription(reason),
    `Cannot reconcile Codex review evidence for ${statusSha}: ${reason}`,
  );
}

function snapshotEvidenceIssue(snapshot) {
  const errors = snapshot?.evidenceErrors || [];
  if (errors.length > 0) {
    return errors[0];
  }
  return snapshot?.providerResult?.kind === "malformed"
    ? snapshot.providerResult.reason || "unknown provider evidence conflict"
    : null;
}

async function passGateFromCurrentEvidence(
  state,
  stateComment,
  snapshot,
  { reviewOrchestrationBlocked = false } = {},
) {
  const liveStatus = await loadLatestGateStatus();
  await failIfPullRequestHeadChanged("before final Codex review evidence snapshot");
  const finalSnapshot = await loadSnapshot();
  const finalReviewOrchestrationBlocked =
    reviewOrchestrationBlocked ||
    await markerStateConflictBlocksReviewOrchestration(finalSnapshot);
  if (finalReviewOrchestrationBlocked && !reviewOrchestrationBlocked) {
    console.warn(
      "detected conflicting marker audit during final provider evidence reload; " +
        "sticky state writes remain blocked",
    );
  }
  if (finalSnapshot.findings.count > 0) {
    await failFromFindings(
      finalSnapshot.findings,
      state,
      stateComment,
      {
        preserveAuditState: finalReviewOrchestrationBlocked,
        evidenceIssue: snapshotEvidenceIssue(finalSnapshot),
      },
    );
    return;
  }
  failIfSnapshotEvidenceIsInvalid(finalSnapshot);
  if (!providerResultIsCurrentHeadClean(finalSnapshot.providerResult)) {
    throw new GateFailure(
      "error",
      "Codex clean result changed during final validation",
      `The current-head Codex clean result for ${statusSha} was not stable across final validation.`,
    );
  }
  if (!isDeepStrictEqual(finalSnapshot.providerResult, snapshot.providerResult)) {
    throw new GateFailure(
      "error",
      "Codex clean result changed during final validation",
      `The current-head Codex clean result for ${statusSha} was not stable across final validation.`,
    );
  }
  if (!isDeepStrictEqual(finalSnapshot.decisionCertificate, snapshot.decisionCertificate)) {
    throw new GateFailure(
      "error",
      "Codex review evidence reduction changed during final validation",
      describeDecisionCertificateChange(
        snapshot.decisionCertificate,
        finalSnapshot.decisionCertificate,
      ),
    );
  }

  const passedAt = isoNow();
  let auditedState = state;
  if (state.activeMarker) {
    auditedState = activeMarkerIsObsolete(state.activeMarker, statusSha)
      ? closeActiveMarker(state, "obsolete_head", passedAt, {
          currentHeadSha: statusSha,
          resolutionSource: "live-provider-evidence",
        })
      : closeActiveMarker(state, "passed", passedAt, {
          observedProviderResult: finalSnapshot.providerResult,
          resolutionSource: "live-provider-evidence",
        });
  }

  const passedState = updateStateForStatus(
    auditedState,
    {
      now: passedAt,
      statusHead: statusSha,
      runUrl,
      status: "success",
    },
  );
  try {
    await setCommitStatusIfNeeded(
      "success",
      "Latest Codex review is clean and all findings are resolved",
      { liveStatus, retryTransient: false },
    );
  } catch (error) {
    throw new Error(
      `${STATUS_CONTEXT}=success may have persisted despite an unsuccessful response; ` +
        `the workflow must publish a compensating non-success status: ${error.message}`,
    );
  }
  if (finalReviewOrchestrationBlocked) {
    console.warn(
      "left conflicting marker audit state unchanged while recording authoritative clean evidence",
    );
  } else {
    try {
      await saveState(passedState, stateComment);
    } catch (error) {
      console.warn(`failed to save audit state after ${STATUS_CONTEXT}=success: ${error.message}`);
    }
  }
  console.log(
    `${STATUS_CONTEXT} passed for ${statusSha} from ` +
      `${finalSnapshot.providerResult.source} ${finalSnapshot.providerResult.id}.`,
  );
}

async function passGate(state, stateComment, snapshot, observed) {
  void observed;
  await passGateFromCurrentEvidence(state, stateComment, snapshot);
}

async function failFromFindings(
  findings,
  state,
  stateComment,
  {
    preserveAuditState = false,
    evidenceIssue = null,
  } = {},
) {
  const sample = findings.samples[0];
  const suffix = sample ? ` First finding: ${sample}` : "";
  const description = evidenceIssue
    ? `Codex posted ${findings.count} finding(s); evidence issue also present`
    : `Codex posted ${findings.count} finding(s) (applicable)`;
  if (evidenceIssue) {
    console.warn(
      `Codex review has a confirmed finding and an evidence issue for ${statusSha}: ` +
        `${evidenceIssue}`,
    );
    writeEvidenceIssueSummary(findings, evidenceIssue);
  }
  if (preserveAuditState) {
    await setCommitStatus("failure", description);
    console.warn(
      "left conflicting marker audit state unchanged while recording authoritative findings",
    );
    console.log(`Codex review found ${findings.count} finding(s) for ${statusSha}.${suffix}`);
    return;
  }
  const failedState = state.activeMarker
    ? closeActiveMarker(state, "failed_findings", isoNow(), {
        currentHeadFindings: summarizeFindingsForState(findings),
      })
    : state;
  const statusState = updateStateForStatus(failedState, {
    now: isoNow(),
    statusHead: statusSha,
    runUrl,
    status: "failure",
  });
  await setCommitStatus("failure", description);
  try {
    await saveState(statusState, stateComment);
  } catch (error) {
    console.warn(
      `failed to save audit state after ${STATUS_CONTEXT}=failure: ${error.message}`,
    );
  }
  console.log(`Codex review found ${findings.count} finding(s) for ${statusSha}.${suffix}`);
}

function writeEvidenceIssueSummary(findings, evidenceIssue) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }
  const body = [
    "## Codex Review Gate Evidence Issue",
    "",
    `The gate confirmed ${findings.count} blocking finding(s), so the required status is ` +
      "`failure`.",
    "",
    `A separate evidence issue was also present: ${evidenceIssue}`,
    "",
  ].join("\n");
  try {
    appendFileSync(summaryPath, body, "utf8");
  } catch (error) {
    console.warn(`failed to write Codex evidence issue step summary: ${error.message}`);
  }
}

async function saveOrchestrationCriticalState(state, stateComment, description) {
  try {
    return await saveState(state, stateComment);
  } catch (updateError) {
    let replacementError = null;
    if (stateComment?.id) {
      console.warn(
        `failed to update orchestration-critical ${description}; ` +
          `creating a replacement state comment: ${updateError.message}`,
      );
      try {
        return await saveState(state, null);
      } catch (error) {
        replacementError = error;
      }
    }

    let fenceError = null;
    try {
      await publishOrchestrationFence(state, description);
    } catch (error) {
      fenceError = error;
    }
    if (!fenceError) {
      throw new GateFailure(
        "error",
        ORCHESTRATION_PERSISTENCE_FENCE_DESCRIPTION,
        `failed to persist orchestration-critical ${description}; ` +
          `published a durable marker-orchestration fence and stopped this run`,
      );
    }
    const replacementDetail = replacementError
      ? `; replacement state creation failed (${replacementError.message})`
      : "";
    throw new GateFailure(
      "error",
      ORCHESTRATION_PERSISTENCE_FENCE_DESCRIPTION,
      `failed to persist orchestration-critical ${description}; ` +
        `state write failed (${updateError.message})${replacementDetail}; ` +
        `durable marker-orchestration fence failed (${fenceError.message})`,
    );
  }
}

async function publishOrchestrationFence(state, description) {
  const marker = state.activeMarker?.headSha === statusSha
    ? state.activeMarker
    : [...(state.history || [])]
        .reverse()
        .find((candidate) => candidate.headSha === statusSha && candidate.id);
  if (!marker?.id) {
    throw new Error(`no controlled marker is available for ${statusSha}`);
  }

  const fencedMarker = {
    ...marker,
    baseline: {
      ...(marker.baseline || {}),
      orchestrationFence: {
        reason: description,
        runUrl,
        runId: config.runId,
        runAttempt: config.runAttempt,
        createdAt: isoNow(),
      },
    },
  };
  await request("PATCH", `${repoPath}/issues/comments/${marker.id}`, {
    body: buildMarkerCommentBody(fencedMarker),
  });
  console.warn(
    `published a durable orchestration fence on controlled marker ${marker.id} for ${statusSha}`,
  );
}

async function recoverOrchestrationPersistenceFence(state, stateComment, snapshot) {
  const markerComment = findLatestTrustedMarkerComment(
    snapshot.comments || [],
    config.trustedCommentLogins,
  );
  const liveMarker = markerComment ? markerFromComment(markerComment) : null;
  const markerFence =
    liveMarker?.headSha === statusSha &&
    (
      liveMarker.baseline?.orchestrationFence ||
      liveMarker.baseline?.authorizationFence
    );

  if (!markerFence) {
    return { state, stateComment, needsFreshMarker: false, recovered: false };
  }

  const now = isoNow();
  let recoveredState;
  if (state.activeMarker) {
    recoveredState = closeActiveMarker(state, "state_lost", now, {
      recoveryReason: "orchestration_state_persistence_fence",
    });
  } else {
    const previousMarker = [...(state.history || [])]
      .reverse()
      .find((candidate) => candidate.headSha === statusSha);
    recoveredState = normalizeState({
      ...state,
      updatedAt: now,
      history: [
        ...(state.history || []),
        {
          ...(previousMarker || {}),
          version: STATE_VERSION,
          id:
            liveMarker?.id ||
            previousMarker?.id ||
            `orchestration-fence-${config.runId}-${config.runAttempt}`,
          url: markerComment?.html_url || previousMarker?.url || null,
          headSha: statusSha,
          createdAt:
            liveMarker?.createdAt ||
            previousMarker?.createdAt ||
            now,
          baseline: liveMarker?.baseline || previousMarker?.baseline || {},
          state: "state_lost",
          outcome: "state_lost",
          closedAt: now,
          recoveryReason: "orchestration_state_persistence_fence",
        },
      ],
    });
  }
  recoveredState = updateStateForStatus(recoveredState, {
    now,
    statusHead: statusSha,
    runUrl,
    status: "pending",
  });
  const recoveredStateComment = await saveOrchestrationCriticalState(
    recoveredState,
    stateComment,
    "orchestration persistence fence recovery",
  );
  await setCommitStatus(
    "pending",
    "Fresh Codex review required after state persistence failure",
  );
  return {
    state: recoveredState,
    stateComment: recoveredStateComment,
    needsFreshMarker: true,
    recovered: true,
  };
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

async function createGateMarker(reactionBaseline, state, waitCycle) {
  const attempt = (state.history || []).length + 1;
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
    headStartedAt: waitCycle.headStartedAt,
    maxWaitDeadlineAt: waitCycle.maxWaitDeadlineAt,
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
  writeAiReviewDisclosureSummary(created);
  console.log(`Created controlled Codex marker ${created.url || `#${created.id}`} for ${statusSha}.`);
  return created;
}

function writeAiReviewDisclosureSummary(marker) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }

  const markerReference = marker.url ? `[controlled marker](${marker.url})` : "controlled marker";
  const body = [
    "## Codex Review Gate",
    "",
    `This workflow requested a Codex generative AI review by posting a ${markerReference}.`,
    "",
    "Codex may post AI-generated comments or reviews on this pull request.",
    "Review and verify AI-generated output before relying on it for security, correctness, or merge decisions.",
    "",
    `Requested head: \`${marker.headSha || statusSha || "unknown"}\``,
    "",
  ].join("\n");

  try {
    appendFileSync(summaryPath, body, "utf8");
  } catch (error) {
    console.warn(`failed to write Codex review disclosure step summary: ${error.message}`);
  }
}

function latestMarkerForCurrentHead(state) {
  return [...(state.history || [])]
    .reverse()
    .find((marker) => marker.headSha === statusSha) || null;
}

function waitCycleForState(state, fallback) {
  const latestForHead = latestMarkerForCurrentHead(state);
  const latestOutcome = latestForHead?.outcome || latestForHead?.state;
  const newCycle =
    !latestForHead ||
    latestOutcome === "passed" ||
    latestOutcome === "state_lost";
  const headStartedAt = newCycle
    ? fallback
    : latestForHead.headStartedAt || fallback;
  const maxWaitDeadlineAt =
    !newCycle && latestForHead.maxWaitDeadlineAt
      ? latestForHead.maxWaitDeadlineAt
      : addSeconds(headStartedAt, Math.round(config.maxWaitMs / 1000));

  return {
    latestForHead,
    latestOutcome,
    newCycle,
    headStartedAt,
    maxWaitDeadlineAt,
  };
}

function currentHeadWaitCycleTimedOut(state) {
  if (state.activeMarker) {
    return false;
  }
  const latestForHead = latestMarkerForCurrentHead(state);
  return (latestForHead?.outcome || latestForHead?.state) === "timed_out";
}

function recordHistoryOnlyWaitCycleTimeout(state, waitCycle, now) {
  if (waitCycle.latestOutcome === "timed_out") {
    return normalizeState({
      ...state,
      updatedAt: now,
      activeMarker: null,
    });
  }

  const timedOutAfterSeconds = Math.max(
    0,
    Math.round(
      (
        parseTimestamp(waitCycle.maxWaitDeadlineAt, "max wait deadline") -
        parseTimestamp(waitCycle.headStartedAt, "wait cycle start time")
      ) / 1000,
    ),
  );
  const timedOutMarker = {
    ...waitCycle.latestForHead,
    state: "timed_out",
    outcome: "timed_out",
    timedOutFromOutcome: waitCycle.latestOutcome,
    timedOutFromMarker: {
      id: String(waitCycle.latestForHead?.id || ""),
      headSha: waitCycle.latestForHead?.headSha || "",
      outcome: waitCycle.latestOutcome,
      closedAt: waitCycle.latestForHead?.closedAt || null,
    },
    closedAt: now,
    headStartedAt: waitCycle.headStartedAt,
    maxWaitDeadlineAt: waitCycle.maxWaitDeadlineAt,
    timedOutAfterSeconds,
  };

  return normalizeState({
    ...state,
    updatedAt: now,
    activeMarker: null,
    history: [...(state.history || []), timedOutMarker],
  });
}

async function timeOutCurrentHeadWaitCycleIfNeeded(state, stateComment) {
  const nowMs = Date.now();
  const now = isoNow(nowMs);
  let timedOutState = null;

  if (state.activeMarker) {
    if (markerTimeoutOutcome(state.activeMarker, nowMs) !== "max_wait") {
      return { timedOut: false, state, stateComment };
    }
    const headStartedAt =
      state.activeMarker.headStartedAt ||
      state.activeMarker.createdAt ||
      state.createdAt ||
      now;
    const maxWaitDeadlineAt = state.activeMarker.maxWaitDeadlineAt;
    const timedOutAfterSeconds = Math.max(
      0,
      Math.round(
        (
          parseTimestamp(maxWaitDeadlineAt, "max wait deadline") -
          parseTimestamp(headStartedAt, "wait cycle start time")
        ) / 1000,
      ),
    );
    timedOutState = closeActiveMarker(state, "timed_out", now, {
      timedOutAfterSeconds,
      timedOutFromOutcome: state.activeMarker.state,
    });
  } else {
    const waitCycle = waitCycleForState(state, now);
    if (
      waitCycle.newCycle ||
      nowMs < parseTimestamp(waitCycle.maxWaitDeadlineAt, "max wait deadline")
    ) {
      return { timedOut: false, state, stateComment };
    }
    if (waitCycle.latestOutcome === "timed_out") {
      await setCommitStatusIfNeeded(
        "failure",
        "Timed out waiting for Codex review signal",
      );
      return { timedOut: true, state, stateComment };
    }
    timedOutState = recordHistoryOnlyWaitCycleTimeout(state, waitCycle, now);
  }

  const statusState = updateStateForStatus(timedOutState, {
    now,
    statusHead: statusSha,
    runUrl,
    status: "failure",
  });
  const persistedStateComment = await saveOrchestrationCriticalState(
    statusState,
    stateComment,
    "max-wait timeout state",
  );
  await setCommitStatus("failure", "Timed out waiting for Codex review signal");
  return {
    timedOut: true,
    state: statusState,
    stateComment: persistedStateComment,
  };
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

function createEvidenceWorkBudget() {
  return new EvidenceWorkBudget({
    maxItemsPerSnapshot: MAX_EVIDENCE_ITEMS_PER_SNAPSHOT,
    maxResponseBytes: MAX_EVIDENCE_RESPONSE_BYTES,
    maxResponseBytesPerWork: MAX_EVIDENCE_RESPONSE_BYTES_PER_RUN,
    maxRequestAttemptsPerWork: MAX_EVIDENCE_REQUEST_ATTEMPTS_PER_RUN,
    maxConcurrency: MAX_EVIDENCE_HTTP_CONCURRENCY,
  });
}

function createEvidenceSnapshotBudget() {
  if (!evidenceWorkBudget) {
    throw new Error("evidence work budget was not initialized");
  }
  return evidenceWorkBudget.newSnapshot();
}

async function loadSnapshot({
  initialComments = null,
  initialSnapshotBudget = null,
} = {}) {
  for (let attempt = 1; attempt <= MAX_WHOLE_SNAPSHOT_ATTEMPTS; attempt += 1) {
    const reuseInitialComments =
      attempt === 1 &&
      Array.isArray(initialComments) &&
      initialSnapshotBudget !== null;
    let snapshot;
    try {
      snapshot = await loadSnapshotOnce({
        allowMissingReviewChildTransient: attempt < MAX_WHOLE_SNAPSHOT_ATTEMPTS,
        finalSnapshotAttempt: attempt === MAX_WHOLE_SNAPSHOT_ATTEMPTS,
        evidenceBudget: reuseInitialComments
          ? initialSnapshotBudget
          : createEvidenceSnapshotBudget(),
        preloadedComments: reuseInitialComments ? initialComments : null,
      });
    } catch (error) {
      if (!(error instanceof GateFailure) || error.state !== "pending") {
        throw error;
      }
      if (attempt < MAX_WHOLE_SNAPSHOT_ATTEMPTS) {
        await sleepBeforeRetry(
          `review evidence acquisition was incomplete (${error.message}); ` +
            "reloading the whole snapshot",
          attempt,
        );
        continue;
      }
      throw exhaustedSnapshotFailure(error.message);
    }
    if (
      snapshot.evidenceTransientErrors.length > 0 &&
      evidenceWorkBudget?.failure
    ) {
      const exhaustedReason = exhaustedSnapshotReason([
        ...snapshot.evidenceTransientErrors,
        evidenceWorkBudget.failure.message,
      ]);
      return {
        ...snapshot,
        evidenceErrors: [...snapshot.evidenceErrors, exhaustedReason],
        evidenceTransientErrors: [],
      };
    }
    if (
      snapshot.providerResult.kind === "malformed" ||
      snapshot.evidenceErrors.length > 0 ||
      (
        snapshot.evidenceTransientErrors.length === 0
      )
    ) {
      return snapshot;
    }
    if (attempt < MAX_WHOLE_SNAPSHOT_ATTEMPTS) {
      await sleepBeforeRetry(
        "review evidence was inconsistent; reloading the whole snapshot",
        attempt,
      );
      continue;
    }
    const exhaustedReason = exhaustedSnapshotReason(
      snapshot.evidenceTransientErrors,
    );
    return {
      ...snapshot,
      evidenceErrors: [...snapshot.evidenceErrors, exhaustedReason],
      evidenceTransientErrors: [],
    };
  }

  throw new Error("whole-snapshot reconciliation exceeded its retry budget");
}

function exhaustedSnapshotFailure(detail) {
  const reason = exhaustedSnapshotReason([detail]);
  return new GateFailure(
    "error",
    evidenceIssueStatusDescription(reason),
    reason,
  );
}

function exhaustedSnapshotReason(transientErrors) {
  const detail = transientErrors.find((error) =>
    String(error).includes("ancestry-unverified"),
  ) || transientErrors[0] || "review evidence remained incomplete";
  const category = String(detail).includes("ancestry-unverified")
    ? "ancestry-unverified"
    : "evidence-unavailable";
  return `${category}: bounded whole-snapshot reconciliation exhausted: ${detail}`;
}

function evidenceIssueStatusDescription(reason) {
  if (String(reason).includes("ancestry-unverified")) {
    return "Codex ancestry unverified (ancestry-unverified)";
  }
  if (String(reason).includes("evidence-unavailable")) {
    return "Codex evidence unavailable (evidence-unavailable)";
  }
  return "Codex review evidence is invalid";
}

async function loadSnapshotOnce({
  allowMissingReviewChildTransient = false,
  finalSnapshotAttempt = false,
  evidenceBudget,
  preloadedComments = null,
} = {}) {
  const loadedEvidence = await settleEvidenceLoads([
      Array.isArray(preloadedComments)
        ? Promise.resolve(preloadedComments)
        : paginate(
            `${repoPath}/issues/${activePrNumber}/comments`,
            { per_page: "100" },
            { evidenceBudget },
          ),
      paginate(
        `${repoPath}/issues/${activePrNumber}/reactions`,
        { per_page: "100" },
        { evidenceBudget },
      ),
      paginate(
        `${repoPath}/pulls/${activePrNumber}/comments`,
        { per_page: "100" },
        { evidenceBudget },
      ),
      paginate(
        `${repoPath}/pulls/${activePrNumber}/reviews`,
        { per_page: "100" },
        { evidenceBudget },
      ),
      loadReviewThreads(evidenceBudget),
    ], evidenceBudget, { finalSnapshotAttempt });
  if (!Array.isArray(loadedEvidence)) {
    return partialSnapshotFromFulfilledEvidence(loadedEvidence);
  }
  const [comments, issueReactions, reviewComments, reviews, reviewThreads] = loadedEvidence;
  const evidence = await buildCurrentReviewEvidence({
    comments,
    reviewComments,
    reviews,
    reviewThreads,
    allowMissingReviewChildTransient,
    evidenceBudget,
  });
  const markerComment = findLatestTrustedMarkerComment(comments, config.trustedCommentLogins);
  let markerCommentReactions = [];
  if (markerComment?.id) {
    try {
      markerCommentReactions = await paginate(
        `${repoPath}/issues/comments/${markerComment.id}/reactions`,
        { per_page: "100" },
        { evidenceBudget },
      );
    } catch (error) {
      const deterministic =
        !(error instanceof GateFailure) || error.state !== "pending";
      const canPreserveConfirmedFinding = evidence.findings.count > 0;
      if (
        canPreserveConfirmedFinding &&
        (
          deterministic ||
          evidence.errors.length > 0 ||
          evidenceWorkBudget?.failure ||
          finalSnapshotAttempt
        )
      ) {
        const exhaustionReason = deterministic
          ? error?.message || String(error)
          : evidence.errors[0] || exhaustedSnapshotReason([
              ...evidence.transientErrors,
              error?.message || String(error),
              evidenceWorkBudget?.failure?.message,
            ]);
        return partialSnapshotFromFulfilledEvidence({
          comments,
          issueReactions,
          reviewComments,
          reviews,
          reviewThreads,
          providerResult: evidence.providerResult,
          errors: evidence.errors,
          transientErrors: evidence.transientErrors,
          findings: evidence.findings,
          decisionCertificate: evidence.decisionCertificate,
          progressObserved: evidence.progressObserved,
          exhaustionReason,
        });
      }
      throw error;
    }
  }
  let reactions;
  let completionComment;
  let approvedReview;
  let submittedReview;
  try {
    validateCodexEyesReactions(
      [...issueReactions, ...markerCommentReactions],
      config.codexBotLogins,
    );
    reactions = summarizeCodexSignalReactions(
      issueReactions,
      markerCommentReactions,
      config.codexBotLogins,
    );
    completionComment = selectLatestCodexCompletionComment(
      comments,
      config.codexBotLogins,
    );
    approvedReview = selectLatestCodexApprovedReview(
      reviews,
      config.codexBotLogins,
    );
    submittedReview = selectLatestCodexSubmittedReview(
      reviews,
      config.codexBotLogins,
    );
  } catch (error) {
    if (evidence.findings.count === 0) {
      throw error;
    }
    return partialSnapshotFromFulfilledEvidence({
      comments,
      issueReactions,
      reviewComments,
      reviews,
      reviewThreads,
      providerResult: evidence.providerResult,
      errors: evidence.errors,
      transientErrors: evidence.transientErrors,
      findings: evidence.findings,
      decisionCertificate: evidence.decisionCertificate,
      progressObserved: evidence.progressObserved,
      exhaustionReason: error?.message || String(error),
    });
  }

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
    findings: evidence.findings,
    providerResult: evidence.providerResult,
    progressObserved: evidence.progressObserved,
    evidenceErrors: evidence.errors,
    evidenceTransientErrors: evidence.transientErrors,
    decisionCertificate: evidence.decisionCertificate,
  };
}

async function settleEvidenceLoads(
  loads,
  evidenceBudget,
  { finalSnapshotAttempt = false } = {},
) {
  const settled = await Promise.allSettled(loads);
  const rejections = settled
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason);
  if (rejections.length > 0) {
    const deterministic = rejections.find(
      (error) => !(error instanceof GateFailure) || error.state !== "pending",
    );
    const fulfilledEvidence = await buildFulfilledProviderEvidence(
      settled,
      evidenceBudget,
    );
    const canPreserveConfirmedFinding =
      (
        fulfilledEvidence.providerChannelsComplete &&
        fulfilledEvidence.providerFindingCount > 0
      ) ||
      (
        fulfilledEvidence.threadChannelsComplete &&
        fulfilledEvidence.threadFindingCount > 0
      );
    if (deterministic) {
      if (canPreserveConfirmedFinding) {
        return {
          ...fulfilledEvidence,
          exhaustionReason: deterministic?.message || String(deterministic),
        };
      }
      throw deterministic;
    }
    if (
      canPreserveConfirmedFinding &&
      fulfilledEvidence.errors.length > 0
    ) {
      return {
        ...fulfilledEvidence,
        exhaustionReason: fulfilledEvidence.errors[0],
      };
    }
    if (
      canPreserveConfirmedFinding &&
      (evidenceWorkBudget?.failure || finalSnapshotAttempt)
    ) {
      return {
        ...fulfilledEvidence,
        exhaustionReason: exhaustedSnapshotReason([
          ...fulfilledEvidence.transientErrors,
          ...rejections.map((error) => error?.message || String(error)),
          evidenceWorkBudget?.failure?.message,
        ]),
      };
    }
    if (fulfilledEvidence.errors.length > 0) {
      throw invalidProviderEvidenceFailure(fulfilledEvidence.errors[0]);
    }
    if (evidenceWorkBudget?.failure) {
      throw evidenceWorkBudget.failure;
    }
    throw rejections[0];
  }
  return settled.map((result) => result.value);
}

async function buildFulfilledProviderEvidence(settled, evidenceBudget) {
  const commentsResult = settled[0];
  const issueReactionsResult = settled[1];
  const reviewCommentsResult = settled[2];
  const reviewsResult = settled[3];
  const reviewThreadsResult = settled[4];
  const comments = commentsResult?.status === "fulfilled" ? commentsResult.value : [];
  const issueReactions = issueReactionsResult?.status === "fulfilled"
    ? issueReactionsResult.value
    : [];
  const reviewComments = reviewCommentsResult?.status === "fulfilled"
    ? reviewCommentsResult.value
    : [];
  const reviews = reviewsResult?.status === "fulfilled" ? reviewsResult.value : [];
  const reviewThreads = reviewThreadsResult?.status === "fulfilled"
    ? reviewThreadsResult.value
    : [];
  const errors = [];
  const relationCaches = createRelationCaches();
  const threadEvidenceComplete =
    reviewCommentsResult?.status === "fulfilled" &&
    reviewsResult?.status === "fulfilled" &&
    reviewThreadsResult?.status === "fulfilled";
  const providerEvidenceComplete =
    commentsResult?.status === "fulfilled" &&
    reviewsResult?.status === "fulfilled";
  let threadEvidence = {
    findings: [],
    errors: [],
    transientErrors: [],
    validatedCodexInlineParentReviewIds: [],
  };
  let inlineParentEvidenceComplete = false;
  let validatedCodexInlineParentReviewIds = new Set();
  if (threadEvidenceComplete) {
    threadEvidence = collectCodexThreadEvidence(
      reviewComments,
      reviews,
      reviewThreads,
      config.codexBotLogins,
      statusSha,
    );
    inlineParentEvidenceComplete =
      threadEvidence.errors.length === 0 &&
      threadEvidence.transientErrors.length === 0;
    validatedCodexInlineParentReviewIds = new Set(
      threadEvidence.validatedCodexInlineParentReviewIds,
    );
  }

  if (reviewsResult?.status === "fulfilled") {
    const reviewIds = new Set();
    for (const review of reviews) {
      if (
        typeof review?.id !== "number" ||
        !Number.isSafeInteger(review.id) ||
        review.id <= 0
      ) {
        errors.push(
          "REST review snapshot contains a review without a valid numeric id",
        );
        continue;
      }
      const reviewId = String(review.id);
      if (reviewIds.has(reviewId)) {
        errors.push(
          `REST review snapshot contains duplicate numeric id ${reviewId}`,
        );
      }
      reviewIds.add(reviewId);
    }
  }

  const artifacts = providerEvidenceComplete ? [
    ...comments.map((comment) =>
      parseCodexIssueCommentArtifact(comment, {
        owner: repo.owner,
        repo: repo.name,
        botLogins: config.codexBotLogins,
      }),
    ),
    ...reviews.map((review) => {
      const artifact = parseCodexReviewArtifact(review, {
        owner: repo.owner,
        repo: repo.name,
        botLogins: config.codexBotLogins,
      });
      if (!commentedReviewMayBeInlineParent(review, artifact)) {
        return artifact;
      }
      if (!inlineParentEvidenceComplete) {
        return null;
      }
      return validatedCodexInlineParentReviewIds.has(String(review.id))
        ? null
        : artifact;
    }),
  ].filter(Boolean) : [];
  const providerReduction = await reduceProviderArtifacts(
    artifacts,
    relationCaches,
    evidenceBudget,
  );
  const threadReduction = threadEvidenceComplete
    ? await reduceThreadFindings(
        threadEvidence.findings,
        relationCaches,
        evidenceBudget,
      )
    : {
        findings: [],
        errors: [],
        transientErrors: [],
        certificateRelations: [],
      };
  const findings = [
    ...threadReduction.findings,
    ...providerReduction.findings,
  ];
  return {
    providerChannelsComplete: providerEvidenceComplete,
    providerFindingCount: providerReduction.findings.length,
    threadChannelsComplete: threadEvidenceComplete,
    threadFindingCount: threadReduction.findings.length,
    comments,
    issueReactions,
    reviewComments,
    reviews,
    reviewThreads,
    providerResult: providerReduction.result,
    progressObserved: providerReduction.progressObserved,
    errors: uniqueStrings([
      ...errors,
      ...threadEvidence.errors,
      ...threadReduction.errors,
      ...providerReduction.errors,
    ]),
    transientErrors: uniqueStrings([
      ...threadEvidence.transientErrors,
      ...threadReduction.transientErrors,
      ...providerReduction.transientErrors,
    ]),
    findings: {
      count: findings.length,
      ids: findings.map((finding) => finding.id),
      samples: findings.map((finding) => finding.sample).filter(Boolean).slice(0, 3),
    },
    decisionCertificate: {
      selected: providerReduction.certificate.selected
        ? {
            ...providerReduction.certificate.selected,
            carrierDigest: selectedProviderCarrierDigest(
              providerReduction.result,
              comments,
              reviews,
            ),
          }
        : null,
      relations: [
        ...providerReduction.certificate.relations.map((relation) => ({
          ...relation,
          carrierDigest: providerCertificateCarrierDigest(
            relation.id,
            comments,
            reviews,
          ),
        })),
        ...threadReduction.certificateRelations,
      ].sort(compareCertificateRelations),
      applicableFindingIds: findings.map((finding) => finding.id).sort(),
    },
  };
}

function partialSnapshotFromFulfilledEvidence(evidence) {
  const reactions = { plusOne: null, eyes: null };
  return {
    providerSnapshotIncomplete: true,
    comments: evidence.comments,
    issueReactions: evidence.issueReactions,
    markerCommentReactions: [],
    reviewComments: evidence.reviewComments,
    reviews: evidence.reviews,
    reviewThreads: evidence.reviewThreads,
    reactions,
    completionComment: null,
    approvedReview: null,
    submittedReview: null,
    baseline: {
      ...reactions,
      completionComment: null,
      approvedReview: null,
      submittedReview: null,
    },
    findings: evidence.findings,
    providerResult: evidence.providerResult,
    progressObserved: Boolean(evidence.progressObserved),
    evidenceErrors: uniqueStrings([
      evidence.exhaustionReason,
      ...evidence.errors,
    ]),
    evidenceTransientErrors: [],
    decisionCertificate: evidence.decisionCertificate,
  };
}

function invalidProviderEvidenceFailure(reason) {
  return new GateFailure(
    "error",
    "Codex review evidence is invalid",
    `Cannot reconcile Codex review evidence for ${statusSha}: ${reason}`,
  );
}

function commentedReviewMayBeInlineParent(review, artifact) {
  if (review.state !== "COMMENTED") {
    return false;
  }
  if (String(review.body || "").trim() === "") {
    return artifact?.reason === "unrecognized Codex terminal pull-request-review format";
  }
  return (
    artifact?.reason === "Codex finding must contain only exact full-SHA github.com blob links" &&
    codexInlineParentReviewBodyHasClosedGrammar(review)
  );
}

async function buildCurrentReviewEvidence({
  comments,
  reviewComments,
  reviews,
  reviewThreads,
  allowMissingReviewChildTransient = false,
  evidenceBudget,
}) {
  const threadFindings = collectCodexThreadEvidence(
    reviewComments,
    reviews,
    reviewThreads,
    config.codexBotLogins,
    statusSha,
  );
  const validatedCodexInlineParentReviewIds = new Set(
    threadFindings.validatedCodexInlineParentReviewIds,
  );
  const parentReviewTransientErrors = [];
  const artifacts = [
    ...comments.map((comment) =>
      parseCodexIssueCommentArtifact(comment, {
        owner: repo.owner,
        repo: repo.name,
        botLogins: config.codexBotLogins,
      }),
    ),
    ...reviews.map((review) => {
      const artifact = parseCodexReviewArtifact(review, {
        owner: repo.owner,
        repo: repo.name,
        botLogins: config.codexBotLogins,
      });
      if (
        validatedCodexInlineParentReviewIds.has(String(review.id)) &&
        commentedReviewMayBeInlineParent(review, artifact)
      ) {
        return null;
      }
      if (
        threadFindings.transientErrors.length > 0 &&
        commentedReviewMayBeInlineParent(review, artifact)
      ) {
        return null;
      }
      if (
        allowMissingReviewChildTransient &&
        !validatedCodexInlineParentReviewIds.has(String(review.id)) &&
        commentedReviewMayBeInlineParent(review, artifact)
      ) {
        parentReviewTransientErrors.push(
          `COMMENTED review ${review.id} has no loaded child review comment`,
        );
        return null;
      }
      return artifact;
    }),
  ].filter(Boolean);
  const relationCaches = createRelationCaches();
  const providerReduction = await reduceProviderArtifacts(
    artifacts,
    relationCaches,
    evidenceBudget,
  );
  const threadReduction = await reduceThreadFindings(
    threadFindings.findings,
    relationCaches,
    evidenceBudget,
  );
  const findings = [
    ...threadReduction.findings,
    ...providerReduction.findings,
  ];

  return {
    providerResult: providerReduction.result,
    progressObserved: providerReduction.progressObserved,
    errors: [
      ...threadFindings.errors,
      ...threadReduction.errors,
      ...providerReduction.errors,
    ],
    transientErrors: [
      ...threadFindings.transientErrors,
      ...parentReviewTransientErrors,
      ...threadReduction.transientErrors,
      ...providerReduction.transientErrors,
    ],
    findings: {
      count: findings.length,
      ids: findings.map((finding) => finding.id),
      samples: findings.map((finding) => finding.sample).filter(Boolean).slice(0, 3),
    },
    decisionCertificate: {
      selected: providerReduction.certificate.selected
        ? {
            ...providerReduction.certificate.selected,
            carrierDigest: selectedProviderCarrierDigest(
              providerReduction.result,
              comments,
              reviews,
            ),
          }
        : null,
      relations: [
        ...providerReduction.certificate.relations.map((relation) => ({
          ...relation,
          carrierDigest: providerCertificateCarrierDigest(
            relation.id,
            comments,
            reviews,
          ),
        })),
        ...threadReduction.certificateRelations,
      ].sort(compareCertificateRelations),
      applicableFindingIds: findings.map((finding) => finding.id).sort(),
    },
  };
}

function createRelationCaches() {
  return {
    classifications: new Map(),
    ancestry: new Map(),
    resolutions: new Map(),
  };
}

function selectedProviderCarrierDigest(providerResult, comments, reviews) {
  const id = String(providerResult?.id || "");
  let carrier;
  if (providerResult?.source === "issue-comment") {
    const comment = comments.find((candidate) => String(candidate?.id || "") === id);
    carrier = comment && {
      id,
      body: String(comment.body || ""),
      createdAt: comment.created_at || null,
      updatedAt: comment.updated_at || null,
      url: comment.html_url || null,
      user: {
        login: comment.user?.login || null,
        type: comment.user?.type || null,
      },
      appSlug: comment.performed_via_github_app?.slug || null,
    };
  } else if (providerResult?.source === "pull-request-review") {
    const review = reviews.find((candidate) => String(candidate?.id || "") === id);
    carrier = review && {
      id,
      body: String(review.body || ""),
      state: review.state || null,
      commitId: review.commit_id || null,
      submittedAt: review.submitted_at || review.created_at || null,
      url: review.html_url || null,
      user: {
        login: review.user?.login || null,
        type: review.user?.type || null,
      },
    };
  }
  if (!carrier) {
    return null;
  }
  return `sha256:${createHash("sha256").update(JSON.stringify(carrier)).digest("hex")}`;
}

function providerCertificateCarrierDigest(identity, comments, reviews) {
  const separator = String(identity || "").indexOf(":");
  if (separator < 1) {
    return null;
  }
  return selectedProviderCarrierDigest(
    {
      source: identity.slice(0, separator),
      id: identity.slice(separator + 1),
    },
    comments,
    reviews,
  );
}

async function reduceProviderArtifacts(artifacts, caches, evidenceBudget) {
  const progressObserved = artifacts.some((artifact) =>
    artifact?.auditOnly === true &&
    artifact?.kind === "pending" &&
    artifact?.pendingKind === "progress",
  );
  const artifactIdentities = new Set();
  const errors = [];
  const transientErrors = [];
  for (const artifact of artifacts) {
    if (!/^[1-9][0-9]*$/.test(String(artifact.id || ""))) {
      continue;
    }
    const identity = `${artifact.source}:${artifact.id}`;
    if (artifactIdentities.has(identity)) {
      errors.push(`Codex provider artifact identity ${identity} appears more than once`);
    }
    artifactIdentities.add(identity);
  }

  for (const artifact of artifacts) {
    if (artifact.kind === "malformed") {
      errors.push(artifact.reason || `Codex provider artifact ${artifact.source}:${artifact.id} is malformed`);
    }
  }

  const orderableTerminalArtifacts = [];
  const terminalFindingArtifacts = [];
  const terminalCleanArtifacts = [];
  const terminalOrderingErrors = new Map();
  for (const artifact of artifacts) {
    if (
      artifact.auditOnly ||
      artifact.kind === "pending" ||
      artifact.kind === "malformed"
    ) {
      continue;
    }
    if (!/^[1-9][0-9]*$/.test(String(artifact.id || ""))) {
      errors.push(
        `Codex provider artifact ${artifact.source}:${artifact.id || "<missing>"} ` +
          "cannot be ordered without a canonical numeric id",
      );
      continue;
    }
    if (artifact.kind === "finding") {
      terminalFindingArtifacts.push(artifact);
    } else if (artifact.kind === "clean") {
      terminalCleanArtifacts.push(artifact);
    }
    if (artifact.orderingError) {
      terminalOrderingErrors.set(artifact, artifact.orderingError);
      continue;
    }
    try {
      parseTimestamp(artifact.createdAt, "Codex artifact revision time");
    } catch (error) {
      terminalOrderingErrors.set(artifact, error.message);
      continue;
    }
    orderableTerminalArtifacts.push(artifact);
  }
  const terminalArtifacts = sortCodexArtifactsNewestFirst(
    orderableTerminalArtifacts,
  );
  const findingRecords = [];
  for (const artifact of terminalFindingArtifacts) {
    const classification = await classifyCommitRelation(
      artifact.headSha,
      caches,
      evidenceBudget,
    );
    recordClassificationProblem(classification, errors, transientErrors);
    if (
      relationRetainsOrderingError(classification.relation) &&
      terminalOrderingErrors.has(artifact)
    ) {
      errors.push(terminalOrderingErrors.get(artifact));
    }
    findingRecords.push({
      artifact,
      orderable: orderableTerminalArtifacts.includes(artifact),
      ...classification,
    });
  }

  let selectedClean = null;
  const classifiedCleanRecords = [];
  const classifiedCleanArtifacts = new Set();
  const cleanArtifacts = terminalArtifacts.filter((artifact) => artifact.kind === "clean");
  for (const artifact of cleanArtifacts) {
    const record = await classifyCleanArtifact(
      artifact,
      caches,
      evidenceBudget,
    );
    recordClassificationProblem(record, errors, transientErrors);
    classifiedCleanRecords.push(record);
    classifiedCleanArtifacts.add(artifact);
    if (record.relation === "current" || record.relation === "ancestor") {
      selectedClean = record;
      break;
    }
  }

  if (selectedClean) {
    const selectedTime = parseTimestamp(
      selectedClean.artifact.createdAt,
      "Codex artifact revision time",
    );
    for (const artifact of cleanArtifacts) {
      if (
        artifact === selectedClean.artifact ||
        parseTimestamp(artifact.createdAt, "Codex artifact revision time") !== selectedTime ||
        classifiedCleanArtifacts.has(artifact)
      ) {
        continue;
      }
      const record = await classifyCleanArtifact(
        artifact,
        caches,
        evidenceBudget,
      );
      recordClassificationProblem(record, errors, transientErrors);
      classifiedCleanRecords.push(record);
      classifiedCleanArtifacts.add(artifact);
    }
  }

  for (const artifact of terminalCleanArtifacts) {
    if (
      classifiedCleanArtifacts.has(artifact) ||
      !terminalOrderingErrors.has(artifact)
    ) {
      continue;
    }
    const record = await classifyCleanArtifact(
      artifact,
      caches,
      evidenceBudget,
    );
    recordClassificationProblem(record, errors, transientErrors);
    classifiedCleanRecords.push(record);
    classifiedCleanArtifacts.add(artifact);
    if (
      relationRetainsOrderingError(record.relation) &&
      terminalOrderingErrors.has(artifact)
    ) {
      errors.push(terminalOrderingErrors.get(artifact));
    }
  }

  const inScopeFindings = findingRecords.filter((record) =>
    record.relation === "current" || record.relation === "ancestor",
  );
  const findings = [];
  for (const record of inScopeFindings) {
    const superseded = Boolean(
      selectedClean?.relation === "current" &&
      artifactIsStrictlyLater(selectedClean.artifact, record.artifact),
    );
    record.disposition = superseded ? "finding-superseded" : "finding-blocking";
    if (!superseded) {
      findings.push({
        id: `${record.artifact.source}:${record.artifact.id}`,
        sample: record.artifact.samples?.[0] || null,
        headSha: record.headSha,
        artifact: record.artifact,
        orderable: record.orderable,
      });
    }
  }

  const relevantAtTimestamp = [
    ...inScopeFindings.map((record) => ({ artifact: record.artifact })),
    ...classifiedCleanRecords
      .filter((record) =>
        record.relation === "current" || record.relation === "ancestor",
      )
      .map((record) => ({ artifact: record.artifact })),
  ];
  const byTimestamp = new Map();
  for (const record of relevantAtTimestamp) {
    if (terminalOrderingErrors.has(record.artifact)) {
      continue;
    }
    const timestamp = parseTimestamp(
      record.artifact.createdAt,
      "Codex artifact revision time",
    );
    const group = byTimestamp.get(timestamp) || [];
    group.push(record.artifact);
    byTimestamp.set(timestamp, group);
  }
  for (const group of byTimestamp.values()) {
    if (new Set(group.map((artifact) => artifact.source)).size > 1) {
      errors.push(
        "cross-channel Codex terminal artifacts share an ambiguous server timestamp",
      );
    } else if (
      group.length > 1 &&
      group[0]?.source === "issue-comment"
    ) {
      errors.push(
        "edited Codex issue-comment artifacts share an ambiguous revision timestamp",
      );
    }
  }

  const uniqueErrors = uniqueStrings(errors);
  const uniqueTransientErrors = uniqueStrings(transientErrors);
  let result;
  if (findings.length > 0) {
    const orderableFindings = findings.filter((finding) => finding.orderable);
    const newestFinding = orderableFindings.length > 0
      ? sortCodexArtifactsNewestFirst(
          orderableFindings.map((finding) => finding.artifact),
        )[0]
      : [...findings]
          .sort((left, right) =>
            `${left.artifact.source}:${left.artifact.id}`.localeCompare(
              `${right.artifact.source}:${right.artifact.id}`,
            ),
          )[0].artifact;
    result = {
      ...newestFinding,
      headSha: findings.find((finding) => finding.artifact === newestFinding).headSha,
    };
  } else if (uniqueErrors.length > 0) {
    result = malformedProviderResult(uniqueErrors[0]);
  } else if (uniqueTransientErrors.length > 0) {
    result = {
      kind: "pending",
      source: "provider-artifact-set",
      id: "transient",
      reason: uniqueTransientErrors[0],
    };
  } else if (selectedClean?.relation === "current") {
    result = {
      ...selectedClean.artifact,
      headSha: selectedClean.headSha,
    };
  } else if (selectedClean?.relation === "ancestor") {
    result = {
      ...selectedClean.artifact,
      kind: "pending",
      headSha: selectedClean.headSha,
      reason:
        `latest Codex clean result is bound to prior head ${selectedClean.headSha}; ` +
        `waiting for a complete clean result on current head ${statusSha.toLowerCase()}`,
    };
  } else {
    result = { kind: "pending", source: "provider-artifact-set", id: "none" };
  }

  const relations = [
    ...inScopeFindings.map((record) => ({
      id: `${record.artifact.source}:${record.artifact.id}`,
      headSha: record.headSha,
      relation: record.relation,
      disposition: record.disposition,
      carrierCreatedAt: record.artifact.carrierCreatedAt || null,
      carrierUpdatedAt: record.artifact.carrierUpdatedAt || null,
    })),
    ...(selectedClean
      ? [{
          id: `${selectedClean.artifact.source}:${selectedClean.artifact.id}`,
          headSha: selectedClean.headSha,
          relation: selectedClean.relation,
          disposition: "clean-selected",
          carrierCreatedAt: selectedClean.artifact.carrierCreatedAt || null,
          carrierUpdatedAt: selectedClean.artifact.carrierUpdatedAt || null,
        }]
      : []),
  ].sort(compareCertificateRelations);

  return {
    result,
    progressObserved,
    findings: findings.map(({ artifact, orderable, ...finding }) => finding),
    errors: uniqueErrors,
    transientErrors: uniqueTransientErrors,
    certificate: {
      selected: selectedClean
        ? {
            id: `${selectedClean.artifact.source}:${selectedClean.artifact.id}`,
            headSha: selectedClean.headSha,
            relation: selectedClean.relation,
            carrierCreatedAt: selectedClean.artifact.carrierCreatedAt || null,
            carrierUpdatedAt: selectedClean.artifact.carrierUpdatedAt || null,
          }
        : null,
      relations,
    },
  };
}

function relationRetainsOrderingError(relation) {
  return relation === "current" || relation === "ancestor" || relation === "invalid";
}

function malformedProviderResult(reason) {
  return {
    kind: "malformed",
    source: "provider-artifact-set",
    id: "invalid",
    reason,
  };
}

async function classifyCleanArtifact(artifact, caches, evidenceBudget) {
  let headSha = artifact.headSha || "";
  if (artifact.commitRef) {
    try {
      headSha = await resolveReviewedCommit(
        artifact.commitRef,
        caches.resolutions,
        evidenceBudget,
      );
    } catch (error) {
      return {
        artifact,
        ...classificationFromError(
          artifact.commitRef,
          statusSha.toLowerCase(),
          error,
        ),
      };
    }
  }
  return {
    artifact,
    ...(await classifyCommitRelation(headSha, caches, evidenceBudget)),
  };
}

async function classifyCommitRelation(headSha, caches, evidenceBudget) {
  const normalizedHeadSha = String(headSha || "").toLowerCase();
  const currentHeadSha = statusSha.toLowerCase();
  const cacheKey = `${normalizedHeadSha}->${currentHeadSha}`;
  if (caches.classifications.has(cacheKey)) {
    return caches.classifications.get(cacheKey);
  }
  let classification;
  if (!/^[0-9a-f]{40}$/.test(normalizedHeadSha)) {
    classification = {
      headSha: normalizedHeadSha,
      relation: "invalid",
      error: `provider commit ${normalizedHeadSha || "<missing>"} is not a full commit SHA`,
    };
  } else if (normalizedHeadSha === currentHeadSha) {
    classification = { headSha: normalizedHeadSha, relation: "current" };
  } else {
    try {
      classification = {
        headSha: normalizedHeadSha,
        relation: await commitIsAncestor(
          normalizedHeadSha,
          currentHeadSha,
          caches.ancestry,
          evidenceBudget,
        ) ? "ancestor" : "nonancestor",
      };
    } catch (error) {
      classification = classificationFromError(
        normalizedHeadSha,
        currentHeadSha,
        error,
      );
    }
  }
  caches.classifications.set(cacheKey, classification);
  return classification;
}

function classificationFromError(headSha, currentHeadSha, error) {
  if (error instanceof GateFailure && error.state === "pending") {
    return {
      headSha: String(headSha || "").toLowerCase(),
      relation: "unknown",
      transientError:
        `ancestry-unverified: ${String(headSha || "").toLowerCase()} -> ${currentHeadSha}: ` +
        `${error.message}`,
    };
  }
  return {
    headSha: String(headSha || "").toLowerCase(),
    relation: "invalid",
    error: error?.message || String(error),
  };
}

function recordClassificationProblem(classification, errors, transientErrors) {
  if (classification.error) {
    errors.push(classification.error);
  }
  if (classification.transientError) {
    transientErrors.push(classification.transientError);
  }
}

async function reduceThreadFindings(findings, caches, evidenceBudget) {
  const applicableFindings = [];
  const errors = [];
  const transientErrors = [];
  const certificateRelations = [];
  for (const finding of findings || []) {
    const headShas = finding.headShas || [finding.headSha];
    const classifications = [];
    for (const headSha of [...headShas].sort()) {
      const classification = await classifyCommitRelation(
        headSha,
        caches,
        evidenceBudget,
      );
      recordClassificationProblem(classification, errors, transientErrors);
      classifications.push(classification);
    }
    const inScope = classifications.filter((classification) =>
      classification.relation === "current" || classification.relation === "ancestor",
    );
    if (inScope.length === 0) {
      continue;
    }
    applicableFindings.push({
      id: finding.id,
      sample: finding.sample || null,
    });
    for (const classification of inScope) {
      certificateRelations.push({
        id: finding.id,
        headSha: classification.headSha,
        relation: classification.relation,
        disposition: "thread-blocking",
      });
    }
  }
  return {
    findings: applicableFindings,
    errors: uniqueStrings(errors),
    transientErrors: uniqueStrings(transientErrors),
    certificateRelations: certificateRelations.sort(compareCertificateRelations),
  };
}

function artifactIsStrictlyLater(candidate, reference) {
  if (candidate.orderingError || reference.orderingError) {
    return false;
  }
  const candidateTime = parseTimestamp(candidate.createdAt, "Codex artifact revision time");
  const referenceTime = parseTimestamp(reference.createdAt, "Codex artifact revision time");
  if (candidateTime !== referenceTime) {
    return candidateTime > referenceTime;
  }
  if (
    candidate.source === "issue-comment" ||
    reference.source === "issue-comment"
  ) {
    return false;
  }
  return candidate.source === reference.source &&
    BigInt(String(candidate.id)) > BigInt(String(reference.id));
}

function compareCertificateRelations(left, right) {
  return certificateRelationKey(left).localeCompare(certificateRelationKey(right));
}

function certificateRelationKey(relation) {
  return [
    relation.id,
    relation.headSha,
    relation.relation,
    relation.disposition,
    relation.carrierCreatedAt || "",
    relation.carrierUpdatedAt || "",
    relation.carrierDigest || "",
  ].join("\0");
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function describeDecisionCertificateChange(initialCertificate, finalCertificate) {
  const initialRelations = initialCertificate?.relations || [];
  const finalRelations = finalCertificate?.relations || [];
  const finalKeys = new Set(finalRelations.map(certificateRelationKey));
  const changed = initialRelations.find((relation) =>
    !finalKeys.has(certificateRelationKey(relation)),
  ) || finalRelations[0] || initialRelations[0];
  const relationDetail = changed?.headSha
    ? ` for ${changed.headSha} -> ${statusSha.toLowerCase()}`
    : "";
  return `Codex review evidence reduction changed during final validation${relationDetail}.`;
}

async function commitIsAncestor(baseSha, headSha, cache, evidenceBudget) {
  const cacheKey = `${baseSha}...${headSha}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  let data;
  try {
    ({ data } = await request(
      "GET",
      `${repoPath}/compare/${encodeURIComponent(baseSha)}...${encodeURIComponent(headSha)}`,
      undefined,
      { evidenceBudget },
    ));
  } catch (error) {
    if (error instanceof GateFailure && error.state === "pending") {
      throw error;
    }
    throw new GateFailure(
      "error",
      "Codex artifact ancestry could not be verified",
      `Cannot compare provider commit ${baseSha} with commit ${headSha}: ${error.message}`,
    );
  }

  const baseCommitSha = String(data?.base_commit?.sha || "").toLowerCase();
  const mergeBaseSha = String(data?.merge_base_commit?.sha || "").toLowerCase();
  const status = data?.status;
  const aheadBy = data?.ahead_by;
  const behindBy = data?.behind_by;
  const totalCommits = data?.total_commits;
  const invalidResponse = (detail) => new GateFailure(
    "error",
    "Codex artifact ancestry response is invalid",
    `Compare response for ${cacheKey} ${detail}.`,
  );
  if (
    !/^[0-9a-f]{40}$/.test(baseCommitSha) ||
    !/^[0-9a-f]{40}$/.test(mergeBaseSha) ||
    !new Set(["ahead", "behind", "diverged", "identical"]).has(status) ||
    !Number.isSafeInteger(aheadBy) ||
    aheadBy < 0 ||
    !Number.isSafeInteger(behindBy) ||
    behindBy < 0 ||
    !Number.isSafeInteger(totalCommits) ||
    totalCommits < 0 ||
    !Array.isArray(data?.commits)
  ) {
    throw invalidResponse("did not contain the documented commit-comparison fields");
  }
  if (baseCommitSha !== baseSha) {
    throw invalidResponse(
      `bound base ${baseCommitSha} instead of requested provider commit ${baseSha}`,
    );
  }
  if (totalCommits !== aheadBy) {
    throw invalidResponse(
      `reported total_commits ${totalCommits} but ahead_by ${aheadBy}`,
    );
  }
  const expectedCommitCount = Math.min(aheadBy, 250);
  if (data.commits.length !== expectedCommitCount) {
    throw invalidResponse(
      `returned ${data.commits.length} commits but the unpaginated response requires ${expectedCommitCount}`,
    );
  }
  const commitShas = [];
  const seenCommitShas = new Set();
  for (const [index, commit] of data.commits.entries()) {
    const commitSha = String(commit?.sha || "").toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(commitSha)) {
      throw invalidResponse(
        `returned an invalid commit SHA at index ${index}`,
      );
    }
    if (seenCommitShas.has(commitSha)) {
      throw invalidResponse(
        `returned duplicate commit ${commitSha}`,
      );
    }
    if (commitSha === baseSha || commitSha === mergeBaseSha) {
      throw invalidResponse(
        `included excluded base-side commit ${commitSha}`,
      );
    }
    seenCommitShas.add(commitSha);
    commitShas.push(commitSha);
  }
  if (expectedCommitCount > 0) {
    const terminalCommitSha = commitShas.at(-1);
    if (terminalCommitSha !== headSha) {
      throw invalidResponse(
        `bound terminal commit ${terminalCommitSha} instead of requested head ${headSha}`,
      );
    }
  }

  let isAncestor;
  if (
    status === "ahead" &&
    aheadBy > 0 &&
    behindBy === 0 &&
    mergeBaseSha === baseSha
  ) {
    isAncestor = true;
  } else if (
    status === "identical" &&
    baseSha === headSha &&
    aheadBy === 0 &&
    behindBy === 0 &&
    mergeBaseSha === baseSha
  ) {
    isAncestor = true;
  } else if (
    status === "behind" &&
    aheadBy === 0 &&
    behindBy > 0 &&
    mergeBaseSha === headSha
  ) {
    isAncestor = false;
  } else if (
    status === "diverged" &&
    aheadBy > 0 &&
    behindBy > 0 &&
    mergeBaseSha !== baseSha &&
    mergeBaseSha !== headSha
  ) {
    isAncestor = false;
  } else {
    throw invalidResponse(
      `contradicted its ${String(status)} relationship and commit counts`,
    );
  }

  cache.set(cacheKey, isAncestor);
  return isAncestor;
}

async function resolveReviewedCommit(commitRef, cache, evidenceBudget) {
  if (/^[0-9a-f]{40}$/.test(commitRef)) {
    return commitRef;
  }
  if (cache.has(commitRef)) {
    const cached = cache.get(commitRef);
    if (cached.error) {
      throw cached.error;
    }
    return cached.value;
  }

  let data;
  try {
    ({ data } = await request(
      "GET",
      `${repoPath}/commits/${encodeURIComponent(commitRef)}`,
      undefined,
      { evidenceBudget },
    ));
  } catch (error) {
    const failure = error instanceof GateFailure && error.state === "pending"
      ? error
      : new GateFailure(
          "error",
          "Codex reviewed commit could not be resolved",
          `Cannot uniquely resolve Reviewed commit ${commitRef}: ${error.message}`,
        );
    cache.set(commitRef, { error: failure });
    throw failure;
  }
  const resolvedSha = String(data?.sha || "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(resolvedSha)) {
    const failure = new GateFailure(
      "error",
      "Codex reviewed commit response is invalid",
      `Reviewed commit ${commitRef} did not resolve to one full commit SHA.`,
    );
    cache.set(commitRef, { error: failure });
    throw failure;
  }
  if (!resolvedSha.startsWith(commitRef)) {
    const failure = new GateFailure(
      "error",
      "Codex reviewed commit response conflicts with its short SHA",
      `Reviewed commit ${commitRef} resolved to non-matching commit ${resolvedSha}.`,
    );
    cache.set(commitRef, { error: failure });
    throw failure;
  }
  cache.set(commitRef, { value: resolvedSha });
  return resolvedSha;
}

function createProducerReceipt() {
  const path = (process.env.CODEX_REVIEW_GATE_RECEIPT_PATH || "").trim();
  if (!path) {
    return null;
  }

  const workflowRef = requiredEnv("GITHUB_WORKFLOW_REF");
  const workflowSha = fullShaEnv("GITHUB_WORKFLOW_SHA");
  const boundWorkflowRef = requiredEnv("CODEX_REVIEW_GATE_WORKFLOW_REF");
  const boundWorkflowSha = fullShaEnv("CODEX_REVIEW_GATE_WORKFLOW_SHA");
  if (workflowRef !== boundWorkflowRef || workflowSha !== boundWorkflowSha) {
    throw new Error(
      "producer receipt workflow context did not match GITHUB_WORKFLOW_REF/SHA",
    );
  }

  const actionRef = process.env.CODEX_REVIEW_GATE_ACTION_REF || null;
  const actionRepository = process.env.CODEX_REVIEW_GATE_ACTION_REPOSITORY || null;
  const actionCommitSha = actionRef && /^[0-9a-f]{40}$/.test(actionRef)
    ? actionRef
    : null;
  const runId = decimalEnv("GITHUB_RUN_ID");
  const runAttempt = decimalEnv("GITHUB_RUN_ATTEMPT");
  const artifactName = `codex-review-gate-producer-receipt-${runId}-${runAttempt}`;

  return {
    path,
    value: {
      schema: PRODUCER_RECEIPT_SCHEMA,
      schema_version: 1,
      artifact: {
        name: artifactName,
        file: "codex-review-gate-producer-receipt.json",
      },
      producer: {
        repository: config.repository,
        server_url: config.serverUrl,
        run: {
          id: runId,
          attempt: runAttempt,
          target_url: runUrl,
        },
        environment: {
          GITHUB_WORKFLOW_REF: workflowRef,
          GITHUB_WORKFLOW_SHA: workflowSha,
        },
        job: {
          id: requiredEnv("GITHUB_JOB"),
          workflow_ref: requiredEnv("CODEX_REVIEW_GATE_JOB_WORKFLOW_REF"),
          workflow_sha: fullShaEnv("CODEX_REVIEW_GATE_JOB_WORKFLOW_SHA"),
          workflow_repository: requiredEnv(
            "CODEX_REVIEW_GATE_JOB_WORKFLOW_REPOSITORY",
          ),
          workflow_file_path: requiredEnv(
            "CODEX_REVIEW_GATE_JOB_WORKFLOW_FILE_PATH",
          ),
        },
        action: {
          repository: actionRepository,
          ref: actionRef,
          commit_sha: actionCommitSha,
          immutable: actionCommitSha !== null,
        },
      },
      execution: {
        result: "running",
        status_count: 0,
      },
      statuses: [],
    },
  };
}

function recordProducerStatus(response, requestBody) {
  if (!producerReceipt) {
    return;
  }
  const id = statusResponseId(response?.id);
  const nodeId = response?.node_id;
  if (typeof nodeId !== "string" || nodeId.trim().length === 0) {
    throw new Error("commit-status POST response omitted node_id");
  }
  if (!/^[0-9a-f]{40}$/.test(statusSha)) {
    throw new Error("producer receipt cannot bind a non-full commit status head");
  }
  if (
    response?.state !== requestBody.state ||
    response?.context !== requestBody.context ||
    response?.description !== requestBody.description ||
    response?.target_url !== requestBody.targetUrl
  ) {
    throw new Error("commit-status POST response did not echo the requested status fields");
  }
  const creatorLogin = response?.creator?.login;
  const creatorType = response?.creator?.type;
  if (
    typeof creatorLogin !== "string" ||
    creatorLogin.trim().length === 0 ||
    typeof creatorType !== "string" ||
    creatorType.trim().length === 0
  ) {
    throw new Error("commit-status POST response omitted creator identity");
  }

  producerReceipt.value.statuses.push({
    sequence: producerReceipt.value.statuses.length + 1,
    id,
    node_id: nodeId,
    pull_request_number: Number.isInteger(activePrNumber) ? activePrNumber : null,
    head_sha: statusSha,
    context: requestBody.context,
    state: requestBody.state,
    description: requestBody.description,
    target_url: requestBody.targetUrl,
    creator: {
      login: creatorLogin,
      type: creatorType,
    },
  });
}

function finishProducerReceipt(result) {
  if (!producerReceipt) {
    return;
  }
  producerReceipt.value.execution.result = result;
  writeProducerReceipt();
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error("GITHUB_OUTPUT is required to finalize a producer receipt");
  }
  appendFileSync(outputPath, "producer-receipt-finalized=true\n", "utf8");
}

function writeProducerReceipt() {
  if (!producerReceipt) {
    return;
  }
  producerReceipt.value.execution.status_count = producerReceipt.value.statuses.length;
  const temporaryPath = `${producerReceipt.path}.tmp-${process.pid}`;
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(producerReceipt.value, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  renameSync(temporaryPath, producerReceipt.path);
}

function statusResponseId(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value === "string" && /^[1-9][0-9]*$/.test(value)) {
    return value;
  }
  throw new Error("commit-status POST response omitted a safe positive id");
}

function fullShaEnv(name) {
  const value = requiredEnv(name);
  if (!/^[0-9a-f]{40}$/.test(value)) {
    throw new Error(`${name} must be one lowercase full commit SHA`);
  }
  return value;
}

function decimalEnv(name) {
  const value = requiredEnv(name);
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${name} must be one positive decimal integer`);
  }
  return value;
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
    requestTimeoutMs:
      secondsEnv("CODEX_REVIEW_GATE_REQUEST_TIMEOUT_SECONDS", 60, {
        allowZero: false,
      }) * 1000,
    markerTimeoutMs: markerTimeoutSeconds * 1000,
    markerAckTimeoutSeconds: markerAckTimeoutConfig.markerAckTimeoutSeconds,
    markerAckTimeoutMaxSeconds: markerAckTimeoutConfig.markerAckTimeoutMaxSeconds,
    completionSignalBufferSeconds: secondsEnv("COMPLETION_SIGNAL_BUFFER_SECONDS", 30, {
      allowZero: true,
    }),
    failedFindingsRecovery: failedFindingsRecoveryEnabled(
      process.env.FAILED_FINDINGS_RECOVERY_INPUT || process.env.FAILED_FINDINGS_RECOVERY || "",
    ),
    failedFindingsRecoveryMode: normalizeFailedFindingsRecoveryMode(
      process.env.FAILED_FINDINGS_RECOVERY_MODE_INPUT ||
        process.env.FAILED_FINDINGS_RECOVERY_MODE ||
        "",
    ),
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
  if (
    pullRequest.state !== "open" ||
    pullRequest.merged === true ||
    pullRequest.merged_at
  ) {
    throw new GateFailure(
      "error",
      `PR lifecycle changed ${phase}`,
      `PR #${activePrNumber} is no longer an open, unmerged pull request.`,
    );
  }
  if (pullRequest.draft) {
    throw new GateFailure(
      "pending",
      `PR became draft ${phase}`,
      `PR #${activePrNumber} became draft before the Codex review gate could pass.`,
    );
  }
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
  if (
    typeof review.id !== "number" ||
    !Number.isSafeInteger(review.id) ||
    review.id <= 0
  ) {
    return null;
  }
  const submittedAt = review.submitted_at || review.created_at || "";
  if (!isCanonicalUtcTimestamp(submittedAt)) {
    return null;
  }
  return {
    id: String(review.id),
    state: review.state,
    commitId: review.commit_id || "",
    submittedAt,
    user: review.user?.login || "",
  };
}

function validateCodexEyesReactions(
  reactions,
  botLogins = DEFAULT_CODEX_BOT_LOGINS,
) {
  const ids = new Set();
  for (const reaction of reactions) {
    if (
      reaction?.content !== "eyes" ||
      !isCodexBot(reaction.user?.login, botLogins)
    ) {
      continue;
    }
    if (
      typeof reaction.id !== "number" ||
      !Number.isSafeInteger(reaction.id) ||
      reaction.id <= 0
    ) {
      throw new Error("Codex eyes reaction does not have a valid positive integer id");
    }
    if (!isCanonicalUtcTimestamp(reaction.created_at)) {
      throw new Error(
        `invalid Codex eyes reaction creation time: ${reaction.created_at || "<missing>"}`,
      );
    }
    const id = String(reaction.id);
    if (ids.has(id)) {
      throw new Error(`Codex eyes reaction identity ${id} appears more than once`);
    }
    ids.add(id);
  }
}

function isCanonicalUtcTimestamp(value) {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  const match = /^(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d{1,3}))?Z$/.exec(
    value,
  );
  if (!match) {
    return false;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return false;
  }
  const canonical = `${match[1]}.${(match[2] || "").padEnd(3, "0")}Z`;
  return new Date(parsed).toISOString() === canonical;
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
    .map(reviewIdentity)
    .filter(Boolean);

  matches.sort((left, right) => {
    const bySubmittedAt = parseTimestamp(right.submittedAt, "Codex review submission time") -
      parseTimestamp(left.submittedAt, "Codex review submission time");
    if (bySubmittedAt !== 0) {
      return bySubmittedAt;
    }
    const leftId = BigInt(left.id);
    const rightId = BigInt(right.id);
    return rightId > leftId ? 1 : rightId < leftId ? -1 : 0;
  });

  return matches[0] || null;
}

async function setCommitStatus(
  state,
  description,
  { retryTransient = true } = {},
) {
  const statusDescription = truncate(description, 140);
  const { data } = await request("POST", `${repoPath}/statuses/${statusSha}`, {
    state,
    context: STATUS_CONTEXT,
    description: statusDescription,
    target_url: runUrl,
  }, { retryTransient });
  recordProducerStatus(data, {
    state,
    context: STATUS_CONTEXT,
    description: statusDescription,
    targetUrl: runUrl,
  });
  console.log(`Set ${STATUS_CONTEXT}=${state}: ${description}`);
}

async function setCommitStatusIfNeeded(
  state,
  description,
  {
    beforeDecision = null,
    liveStatus = null,
    retryTransient = true,
  } = {},
) {
  if (producerReceipt) {
    if (beforeDecision) {
      await beforeDecision();
    }
    await setCommitStatus(state, description, { retryTransient });
    return;
  }

  const observed = liveStatus || await loadLatestGateStatus();

  if (beforeDecision) {
    await beforeDecision();
  }
  if (
    !observed.readFailed &&
    observed.producerMatches &&
    observed.latest?.state === state
  ) {
    console.log(`Latest live ${STATUS_CONTEXT} already equals ${state} for ${statusSha}.`);
    return;
  }
  await setCommitStatus(state, description, { retryTransient });
}

async function loadLatestGateStatus() {
  const statusReadBudget = new EvidenceWorkBudget({
    maxItemsPerSnapshot: MAX_STATUS_READ_ITEMS,
    maxResponseBytes: MAX_STATUS_READ_RESPONSE_BYTES,
    maxResponseBytesPerWork: MAX_STATUS_READ_BYTES,
    maxRequestAttemptsPerWork: MAX_STATUS_READ_REQUEST_ATTEMPTS,
    maxConcurrency: 1,
  });
  const statusReadSnapshot = statusReadBudget.newSnapshot();
  const path = `${repoPath}/commits/${encodeURIComponent(statusSha)}/statuses`;
  let page = 1;

  try {
    while (true) {
      if (page > MAX_STATUS_READ_PAGES) {
        statusReadBudget.fail(
          `Commit-status read page budget exhausted after ${MAX_STATUS_READ_PAGES} pages.`,
        );
      }
      const { data, headers } = await request(
        "GET",
        path,
        {
          per_page: String(STATUS_READ_PAGE_SIZE),
          page: String(page),
        },
        { evidenceBudget: statusReadSnapshot },
      );
      if (!Array.isArray(data)) {
        throw new Error("commit-status endpoint did not return an array");
      }
      statusReadBudget.consumeItems(
        statusReadSnapshot,
        data.length,
        "commit-status history",
      );
      // GitHub returns commit statuses newest-first, so the first matching
      // context is authoritative even when its producer is not trusted.
      const latest = data.find((status) =>
        typeof status?.context === "string" &&
        status.context.toLowerCase() === STATUS_CONTEXT.toLowerCase(),
      );
      if (latest) {
        return {
          latest,
          producerMatches: gateStatusHasExpectedProducer(latest),
          readFailed: false,
        };
      }
      if (
        !linkHeaderHasNext(headers.get("link")) &&
        data.length < STATUS_READ_PAGE_SIZE
      ) {
        return { latest: null, producerMatches: false, readFailed: false };
      }
      page += 1;
    }
  } catch (error) {
    console.warn(`failed to read current ${STATUS_CONTEXT} status: ${error.message}`);
    return { latest: null, producerMatches: false, readFailed: true };
  }
}

function gateStatusHasExpectedProducer(status) {
  return (
    status?.context === STATUS_CONTEXT &&
    status?.creator?.type === "Bot" &&
    status.creator.login === "github-actions[bot]" &&
    status.target_url === runUrl
  );
}

async function paginate(path, query, { evidenceBudget = null } = {}) {
  const results = [];
  let page = 1;
  const perPage = Number(query.per_page || 100);

  while (true) {
    if (page > MAX_REST_PAGES) {
      throw new GateFailure(
        "pending",
        "Codex review evidence is temporarily incomplete",
        `REST pagination exceeded ${MAX_REST_PAGES} pages for ${path}`,
      );
    }
    const { data, headers } = await request(
      "GET",
      path,
      { ...query, page: String(page) },
      { evidenceBudget },
    );
    if (!Array.isArray(data)) {
      throw new Error(`paginated endpoint did not return an array: ${path}`);
    }
    evidenceBudget?.work.consumeItems(evidenceBudget, data.length, path);
    results.push(...data);
    if (!linkHeaderHasNext(headers.get("link")) && data.length < perPage) {
      return results;
    }
    page += 1;
  }
}

function linkHeaderHasNext(linkHeader) {
  return String(linkHeader || "")
    .split(",")
    .some((entry) =>
      entry
        .split(";")
        .slice(1)
        .some((parameter) => /^\s*rel\s*=\s*"?next"?\s*$/i.test(parameter)),
    );
}

async function loadReviewThreads(evidenceBudget) {
  const threads = [];
  const seenCursors = new Set();
  let after = null;
  let pageCount = 0;

  while (true) {
    if (pageCount >= MAX_GRAPHQL_PAGES) {
      throw new GateFailure(
        "pending",
        "Codex review evidence is temporarily incomplete",
        `GraphQL reviewThreads pagination exceeded ${MAX_GRAPHQL_PAGES} pages`,
      );
    }
    const { data } = await graphqlRequest(
      REVIEW_THREADS_QUERY,
      {
        owner: repo.owner,
        repo: repo.name,
        number: activePrNumber,
        after,
      },
      { evidenceBudget, label: "GraphQL review threads" },
    );
    pageCount += 1;
    const connection = data?.repository?.pullRequest?.reviewThreads;
    if (!connection) {
      throw new Error("GraphQL reviewThreads query did not return a connection");
    }
    if (!Array.isArray(connection.nodes)) {
      throw new Error("GraphQL reviewThreads connection did not return a nodes array");
    }
    if (
      !connection.pageInfo ||
      typeof connection.pageInfo.hasNextPage !== "boolean"
    ) {
      throw new Error("GraphQL reviewThreads connection did not return complete pageInfo");
    }

    let embeddedCommentCount = 0;
    for (const thread of connection.nodes) {
      if (!Array.isArray(thread?.comments?.nodes)) {
        throw new Error(
          `GraphQL comments connection did not return nodes for thread ${thread?.id}`,
        );
      }
      embeddedCommentCount += thread.comments.nodes.length;
    }
    evidenceBudget?.work.consumeItems(
      evidenceBudget,
      connection.nodes.length + embeddedCommentCount,
      "GraphQL review threads and embedded comments",
    );
    threads.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) {
      const loadedThreads = await mapWithConcurrency(
        threads,
        MAX_REVIEW_THREAD_COMMENT_CONCURRENCY,
        (thread) => loadAllReviewThreadComments(thread, evidenceBudget),
      );
      await validateClosingReviewThreadStates(loadedThreads, evidenceBudget);
      return loadedThreads;
    }
    const endCursor = connection.pageInfo.endCursor;
    if (typeof endCursor !== "string" || endCursor.length === 0) {
      throw new Error("GraphQL reviewThreads connection omitted an end cursor");
    }
    if (seenCursors.has(endCursor)) {
      throw new Error("GraphQL reviewThreads pagination cursor did not advance");
    }
    seenCursors.add(endCursor);
    after = endCursor;
  }
}

async function validateClosingReviewThreadStates(initialThreads, evidenceBudget) {
  const initialStates = new Map();
  for (const thread of initialThreads) {
    if (
      typeof thread?.id !== "string" ||
      thread.id.length === 0 ||
      typeof thread.isResolved !== "boolean"
    ) {
      throw new Error("initial GraphQL review-thread state is not canonical");
    }
    if (initialStates.has(thread.id)) {
      throw new Error(`initial GraphQL review-thread snapshot repeats id ${thread.id}`);
    }
    initialStates.set(thread.id, thread.isResolved);
  }

  const closingStates = new Map();
  const seenCursors = new Set();
  let after = null;
  let pageCount = 0;
  while (true) {
    if (pageCount >= MAX_GRAPHQL_PAGES) {
      throw new GateFailure(
        "pending",
        "Codex review evidence is temporarily incomplete",
        `closing GraphQL review-thread state pagination exceeded ${MAX_GRAPHQL_PAGES} pages`,
      );
    }
    const { data } = await graphqlRequest(
      REVIEW_THREAD_STATES_QUERY,
      {
        owner: repo.owner,
        repo: repo.name,
        number: activePrNumber,
        after,
      },
      { evidenceBudget, label: "closing GraphQL review-thread states" },
    );
    pageCount += 1;
    const connection = data?.repository?.pullRequest?.reviewThreads;
    if (
      !connection ||
      !Array.isArray(connection.nodes) ||
      !connection.pageInfo ||
      typeof connection.pageInfo.hasNextPage !== "boolean"
    ) {
      throw new Error("closing GraphQL review-thread states are incomplete");
    }
    evidenceBudget?.work.consumeItems(
      evidenceBudget,
      connection.nodes.length,
      "closing GraphQL review-thread states",
    );
    for (const thread of connection.nodes) {
      if (
        typeof thread?.id !== "string" ||
        thread.id.length === 0 ||
        typeof thread.isResolved !== "boolean"
      ) {
        throw new Error("closing GraphQL review-thread state is not canonical");
      }
      if (closingStates.has(thread.id)) {
        throw new Error(`closing GraphQL review-thread states repeat id ${thread.id}`);
      }
      closingStates.set(thread.id, thread.isResolved);
    }
    if (!connection.pageInfo.hasNextPage) {
      break;
    }
    const endCursor = connection.pageInfo.endCursor;
    if (typeof endCursor !== "string" || endCursor.length === 0) {
      throw new Error("closing GraphQL review-thread states omitted an end cursor");
    }
    if (seenCursors.has(endCursor)) {
      throw new Error("closing GraphQL review-thread state cursor did not advance");
    }
    seenCursors.add(endCursor);
    after = endCursor;
  }

  const drifted = initialStates.size !== closingStates.size ||
    [...initialStates].some(([id, isResolved]) => closingStates.get(id) !== isResolved);
  if (drifted) {
    throw new GateFailure(
      "pending",
      "Codex review evidence is temporarily incomplete",
      "closing GraphQL review-thread state drifted from the initial snapshot",
    );
  }
}

async function loadAllReviewThreadComments(thread, evidenceBudget) {
  if (
    typeof thread?.id !== "string" ||
    thread.id.length === 0 ||
    /\s/.test(thread.id)
  ) {
    throw new Error("GraphQL review thread does not have a valid opaque id");
  }
  if (typeof thread.isResolved !== "boolean") {
    throw new Error(`GraphQL review thread ${thread.id} has a non-boolean isResolved value`);
  }
  let connection = thread.comments;
  if (!connection) {
    throw new Error(`GraphQL comments query did not return a connection for thread ${thread.id}`);
  }
  if (!Array.isArray(connection.nodes)) {
    throw new Error(`GraphQL comments connection did not return nodes for thread ${thread.id}`);
  }
  if (
    !connection.pageInfo ||
    typeof connection.pageInfo.hasNextPage !== "boolean"
  ) {
    throw new Error(`GraphQL comments connection did not return complete pageInfo for thread ${thread.id}`);
  }
  const nodes = [...(connection.nodes || [])];
  const seenCursors = new Set();
  let pageCount = 1;
  let after = connection.pageInfo.endCursor || null;

  while (connection.pageInfo.hasNextPage) {
    if (typeof after !== "string" || after.length === 0) {
      throw new Error(`GraphQL comments connection omitted an end cursor for thread ${thread.id}`);
    }
    if (seenCursors.has(after)) {
      throw new Error(
        `GraphQL comments pagination cursor did not advance for thread ${thread.id}`,
      );
    }
    seenCursors.add(after);
    if (pageCount >= MAX_GRAPHQL_PAGES) {
      throw new GateFailure(
        "pending",
        "Codex review evidence is temporarily incomplete",
        `GraphQL comments pagination exceeded ${MAX_GRAPHQL_PAGES} pages for thread ${thread.id}`,
      );
    }
    const { data } = await graphqlRequest(
      REVIEW_THREAD_COMMENTS_QUERY,
      {
        threadId: thread.id,
        after,
      },
      {
        evidenceBudget,
        label: `GraphQL comments for review thread ${thread.id}`,
      },
    );
    pageCount += 1;
    validateReviewThreadStateSnapshot(
      data?.node,
      thread,
      `GraphQL comments page ${pageCount}`,
    );
    connection = data.node.comments;
    if (!connection) {
      throw new Error(`GraphQL comments query did not return a connection for thread ${thread.id}`);
    }
    if (!Array.isArray(connection.nodes)) {
      throw new Error(`GraphQL comments connection did not return nodes for thread ${thread.id}`);
    }
    if (
      !connection.pageInfo ||
      typeof connection.pageInfo.hasNextPage !== "boolean"
    ) {
      throw new Error(`GraphQL comments connection did not return complete pageInfo for thread ${thread.id}`);
    }

    evidenceBudget?.work.consumeItems(
      evidenceBudget,
      connection.nodes.length,
      `GraphQL comments for review thread ${thread.id}`,
    );
    nodes.push(...connection.nodes);
    if (
      connection.pageInfo.hasNextPage &&
      (
        typeof connection.pageInfo.endCursor !== "string" ||
        connection.pageInfo.endCursor.length === 0
      )
    ) {
      throw new Error(`GraphQL comments connection omitted an end cursor for thread ${thread.id}`);
    }
    after = connection.pageInfo.endCursor || null;
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

function validateReviewThreadStateSnapshot(node, initialThread, phase) {
  if (
    !node ||
    typeof node.id !== "string" ||
    node.id.length === 0 ||
    typeof node.isResolved !== "boolean"
  ) {
    throw new Error(
      `${phase} did not return canonical id/isResolved metadata for thread ${initialThread.id}`,
    );
  }
  if (
    node.id !== initialThread.id ||
    node.isResolved !== initialThread.isResolved
  ) {
    throw new GateFailure(
      "pending",
      "Codex review evidence is temporarily incomplete",
      `${phase} drifted for review thread ${initialThread.id}: ` +
        `observed id=${node.id} isResolved=${node.isResolved}, ` +
        `initial isResolved=${initialThread.isResolved}`,
    );
  }
}

async function request(
  method,
  path,
  bodyOrQuery,
  { retryTransient = true, evidenceBudget = null } = {},
) {
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
    let text;
    try {
      ({ response, text } = await fetchWithDeadline(url, options, {
        evidenceBudget,
        label: `${method} ${url.pathname}`,
      }));
    } catch (error) {
      if (error instanceof GateFailure) {
        throw error;
      }
      if (
        retryTransient &&
        attempt < MAX_REQUEST_ATTEMPTS &&
        restRequestRetryAllowed(method, path, 503)
      ) {
        await sleepBeforeRetry(
          `retrying ${method} ${url.pathname} after transport error: ${error.message}`,
          attempt,
        );
        continue;
      }
      if (method === "GET") {
        throw new GateFailure(
          "pending",
          "Codex review evidence is temporarily incomplete",
          `${method} ${url.pathname} exhausted its retry budget: ${error.message}`,
        );
      }
      throw error;
    }

    let explicitRateLimit = responseIsExplicitRateLimit(response);
    let retryPlan = retryTransient && !response.ok
      ? restResponseRetryPlan({
          method,
          path,
          response,
          explicitRateLimit,
        })
      : { kind: "unavailable" };
    failIfRetryPlanExceedsBound(
      retryPlan,
      `${method} ${url.pathname}`,
      { readOnly: method === "GET" },
    );
    let data;
    try {
      data = parseJsonResponseText(text, `${method} ${url.pathname} (${response.status})`);
    } catch (error) {
      if (
        error instanceof NonJsonResponseError &&
        !response.ok &&
        retryTransient &&
        attempt < MAX_REQUEST_ATTEMPTS &&
        retryPlanAllowsRetry(retryPlan)
      ) {
        await sleepBeforeRetry(
          `retrying ${method} ${url.pathname} after ${response.status}: ${error.preview}`,
          attempt,
          retryPlan.kind === "delay" ? retryPlan.delayMs : null,
        );
        continue;
      }
      if (
        error instanceof NonJsonResponseError &&
        !response.ok &&
        (isRetryableHttpStatus(response.status) || explicitRateLimit) &&
        method === "GET"
      ) {
        throw new GateFailure(
          "pending",
          "Codex review evidence is temporarily incomplete",
          `${method} ${url.pathname} exhausted its retry budget: ${error.message}`,
        );
      }
      throw error;
    }
    explicitRateLimit = responseIsExplicitRateLimit(response, data);
    retryPlan = retryTransient && !response.ok
      ? restResponseRetryPlan({
          method,
          path,
          response,
          explicitRateLimit,
        })
      : { kind: "unavailable" };
    failIfRetryPlanExceedsBound(
      retryPlan,
      `${method} ${url.pathname}`,
      { readOnly: method === "GET" },
    );

    if (!response.ok) {
      const message = data?.message || response.statusText;
      if (
        retryTransient &&
        attempt < MAX_REQUEST_ATTEMPTS &&
        retryPlanAllowsRetry(retryPlan)
      ) {
        await sleepBeforeRetry(
          `retrying ${method} ${url.pathname} after ${response.status}: ${message}`,
          attempt,
          retryPlan.kind === "delay" ? retryPlan.delayMs : null,
        );
        continue;
      }
      if (
        method === "GET" &&
        (isRetryableHttpStatus(response.status) || explicitRateLimit)
      ) {
        throw new GateFailure(
          "pending",
          "Codex review evidence is temporarily incomplete",
          `${method} ${url.pathname} exhausted its retry budget after ${response.status}: ${message}`,
        );
      }
      throw new Error(`${method} ${url.pathname} failed with ${response.status}: ${message}`);
    }

    return { data, headers: response.headers };
  }

  throw new Error(`${method} ${path} exceeded retry budget`);
}

async function graphqlRequest(
  query,
  variables,
  { evidenceBudget = null, label = "GraphQL review evidence" } = {},
) {
  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    let response;
    let text;
    try {
      ({ response, text } = await fetchWithDeadline(config.graphqlUrl, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
          "User-Agent": "codex-review-gate",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ query, variables }),
      }, { evidenceBudget, label }));
    } catch (error) {
      if (error instanceof GateFailure) {
        throw error;
      }
      if (attempt < MAX_REQUEST_ATTEMPTS) {
        await sleepBeforeRetry(
          `retrying GraphQL request after transport error: ${error.message}`,
          attempt,
        );
        continue;
      }
      throw new GateFailure(
        "pending",
        "Codex review evidence is temporarily incomplete",
        `GraphQL request exhausted its retry budget: ${error.message}`,
      );
    }

    let explicitRateLimit = responseIsExplicitRateLimit(response);
    let retryPlan = !response.ok &&
      (isRetryableHttpStatus(response.status) || explicitRateLimit)
      ? responseRetryPlan(response, { explicitRateLimit })
      : { kind: "unavailable" };
    failIfRetryPlanExceedsBound(retryPlan, "GraphQL request", {
      readOnly: true,
    });
    let payload;
    try {
      payload = parseJsonResponseText(
        text,
        `POST ${new URL(config.graphqlUrl).pathname} (${response.status})`,
      );
    } catch (error) {
      if (
        error instanceof NonJsonResponseError &&
        !response.ok &&
        attempt < MAX_REQUEST_ATTEMPTS &&
        retryPlanAllowsRetry(retryPlan)
      ) {
        await sleepBeforeRetry(
          `retrying GraphQL request after ${response.status}: ${error.preview}`,
          attempt,
          retryPlan.kind === "delay" ? retryPlan.delayMs : null,
        );
        continue;
      }
      if (
        error instanceof NonJsonResponseError &&
        !response.ok &&
        (isRetryableHttpStatus(response.status) || explicitRateLimit)
      ) {
        throw new GateFailure(
          "pending",
          "Codex review evidence is temporarily incomplete",
          `GraphQL request exhausted its retry budget: ${error.message}`,
        );
      }
      throw error;
    }
    explicitRateLimit =
      responseIsExplicitRateLimit(response, payload) ||
      graphqlErrorsAreExplicitRateLimit(payload?.errors || []);
    retryPlan =
      (
        (!response.ok && isRetryableHttpStatus(response.status)) ||
        explicitRateLimit
      )
      ? responseRetryPlan(response, { explicitRateLimit })
      : { kind: "unavailable" };
    failIfRetryPlanExceedsBound(retryPlan, "GraphQL request", {
      readOnly: true,
    });

    if (!response.ok) {
      const message = payload?.message || response.statusText;
      if (
        attempt < MAX_REQUEST_ATTEMPTS &&
        retryPlanAllowsRetry(retryPlan)
      ) {
        await sleepBeforeRetry(
          `retrying GraphQL request after ${response.status}: ${message}`,
          attempt,
          retryPlan.kind === "delay" ? retryPlan.delayMs : null,
        );
        continue;
      }
      if (isRetryableHttpStatus(response.status) || explicitRateLimit) {
        throw new GateFailure(
          "pending",
          "Codex review evidence is temporarily incomplete",
          `GraphQL request exhausted its retry budget after ${response.status}: ${message}`,
        );
      }
      throw new Error(`POST ${new URL(config.graphqlUrl).pathname} failed with ${response.status}: ${message}`);
    }
    if (payload?.errors?.length) {
      const message = payload.errors.map((error) => error.message).join("; ");
      if (graphqlErrorsAreExplicitRateLimit(payload.errors)) {
        retryPlan = responseRetryPlan(response, {
          explicitRateLimit: true,
        });
        failIfRetryPlanExceedsBound(retryPlan, "GraphQL rate limit", {
          readOnly: true,
        });
        if (
          attempt < MAX_REQUEST_ATTEMPTS &&
          retryPlanAllowsRetry(retryPlan)
        ) {
          await sleepBeforeRetry(
            `retrying GraphQL request after rate limit: ${message}`,
            attempt,
            retryPlan.kind === "delay" ? retryPlan.delayMs : null,
          );
          continue;
        }
        throw new GateFailure(
          "pending",
          "Codex review evidence is temporarily incomplete",
          `GraphQL request exhausted its retry budget after rate limit: ${message}`,
        );
      }
      throw new Error(`GraphQL reviewThreads query failed: ${message}`);
    }

    return { data: payload?.data };
  }

  throw new Error("GraphQL request exceeded retry budget");
}

function responseIsExplicitRateLimit(response, payload = null) {
  if (response.status !== 403 && response.status !== 429) {
    return false;
  }
  if (
    response.status === 429 ||
    response.headers.get("retry-after") !== null ||
    response.headers.get("x-ratelimit-remaining") === "0"
  ) {
    return true;
  }

  const message = String(payload?.message || "");
  const documentationUrl = String(payload?.documentation_url || "");
  return /\brate[ -]?limit(?:ed| exceeded)?\b|secondary rate limit|abuse detection/i.test(message) ||
    /rate-limits?/i.test(documentationUrl);
}

function responseRetryPlan(response, { explicitRateLimit = false } = {}) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null) {
    const delayMs = retryAfterDelayMs(retryAfter, null);
    if (delayMs === null) {
      return isRetryableHttpStatus(response.status)
        ? { kind: "fallback" }
        : { kind: "unavailable" };
    }
    return delayMs <= MAX_IN_PROCESS_RETRY_WAIT_MS
      ? { kind: "delay", delayMs }
      : { kind: "over-cap", delayMs };
  }

  if (explicitRateLimit) {
    const resetHeader = response.headers.get("x-ratelimit-reset");
    if (resetHeader !== null && /^[0-9]+$/.test(resetHeader)) {
      const reset = Number(resetHeader);
      const delayMs = Number.isSafeInteger(reset)
        ? Math.max(0, reset * 1000 - Date.now())
        : Number.MAX_SAFE_INTEGER;
      return delayMs <= MAX_IN_PROCESS_RETRY_WAIT_MS
        ? { kind: "delay", delayMs }
        : { kind: "over-cap", delayMs };
    }
  }

  return isRetryableHttpStatus(response.status)
    ? { kind: "fallback" }
    : { kind: "unavailable" };
}

function retryPlanAllowsRetry(plan) {
  return plan.kind === "delay" || plan.kind === "fallback";
}

function failIfRetryPlanExceedsBound(plan, label, { readOnly = false } = {}) {
  if (plan.kind !== "over-cap") {
    return;
  }
  const message =
    `${label} requested a retry delay above the ` +
    `${MAX_IN_PROCESS_RETRY_WAIT_MS / 1000}s in-process limit`;
  if (readOnly) {
    throw new GateFailure(
      "pending",
      "Codex review evidence is temporarily incomplete",
      message,
    );
  }
  throw new Error(message);
}

function restResponseRetryPlan({
  method,
  path,
  response,
  explicitRateLimit,
}) {
  const retryStatus = explicitRateLimit ? 429 : response.status;
  if (!restRequestRetryAllowed(method, path, retryStatus)) {
    return { kind: "unavailable" };
  }
  return responseRetryPlan(response, { explicitRateLimit });
}

function graphqlErrorsAreExplicitRateLimit(errors) {
  return errors.some((error) =>
    error?.type === "RATE_LIMITED" ||
    error?.extensions?.type === "RATE_LIMITED" ||
    error?.extensions?.code === "RATE_LIMITED" ||
    /\brate[ -]?limit(?:ed| exceeded)?\b/i.test(String(error?.message || "")),
  );
}

function graphqlEndpoint(apiUrl, serverUrl) {
  if (apiUrl.endsWith("/api/v3")) {
    return `${serverUrl}/api/graphql`;
  }
  return `${apiUrl}/graphql`;
}

async function fetchWithDeadline(
  input,
  options,
  { evidenceBudget = null, label = "GitHub evidence response" } = {},
) {
  let controller = null;
  let timeout = null;
  let releaseRequestSlot = () => {};
  let unregisterAbortController = () => {};

  try {
    if (evidenceBudget) {
      releaseRequestSlot = await evidenceBudget.work.acquireRequest(label);
    }
    controller = new AbortController();
    if (evidenceBudget) {
      unregisterAbortController =
        evidenceBudget.work.registerAbortController(controller);
    }
    timeout = setTimeout(() => {
      controller.abort(
        new Error(
          `GitHub request exceeded the ${Math.round(config.requestTimeoutMs / 1000)}s attempt deadline`,
        ),
      );
    }, config.requestTimeoutMs);
    const response = await fetch(input, {
      ...options,
      signal: controller.signal,
    });
    const contentLengthHeader = response.headers.get("content-length");
    const contentEncoding = response.headers.get("content-encoding");
    if (
      evidenceBudget &&
      (!contentEncoding || contentEncoding.trim().toLowerCase() === "identity") &&
      /^\d+$/.test(String(contentLengthHeader || ""))
    ) {
      evidenceBudget.work.rejectOversizedContentLength(
        Number(contentLengthHeader),
        label,
      );
    }
    const text = await readResponseText(
      response,
      evidenceBudget,
      label,
      controller,
    );
    return { response, text };
  } catch (error) {
    if (evidenceBudget?.work.failure) {
      throw evidenceBudget.work.failure;
    }
    if (error instanceof GateFailure && controller && !controller.signal.aborted) {
      controller.abort(error);
    }
    throw error;
  } finally {
    unregisterAbortController();
    releaseRequestSlot();
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function readResponseText(response, evidenceBudget, label, controller) {
  if (!evidenceBudget || !response.body?.getReader) {
    const text = await response.text();
    if (evidenceBudget) {
      const byteCount = Buffer.byteLength(text, "utf8");
      evidenceBudget.work.consumeResponseBytes(byteCount, byteCount, label);
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let responseByteCount = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const byteCount = value?.byteLength || 0;
      responseByteCount += byteCount;
      evidenceBudget.work.consumeResponseBytes(
        byteCount,
        responseByteCount,
        label,
      );
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    if (!controller.signal.aborted) {
      controller.abort(error);
    }
    throw error;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sleepBeforeRetry(message, attempt, delayMs = null) {
  const fallbackMs = Math.min(1000 * 2 ** (attempt - 1), 10_000);
  const effectiveDelayMs = delayMs ?? fallbackMs;
  if (effectiveDelayMs > MAX_IN_PROCESS_RETRY_WAIT_MS) {
    throw new Error("retry delay exceeded the in-process safety limit");
  }
  console.warn(`${message}; retrying in ${Math.round(effectiveDelayMs / 1000)}s`);
  await sleep(effectiveDelayMs);
}
