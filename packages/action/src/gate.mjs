#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { appendFileSync, readFileSync } from "node:fs";
import { isDeepStrictEqual, TextDecoder } from "node:util";

import {
  DEFAULT_CODEX_BOT_LOGINS,
  DEFAULT_TRUSTED_COMMENT_LOGINS,
  GateFailure,
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

let activePrNumber = config.prNumber;
let statusSha = config.headSha;
let statusReady = false;
let evidenceWorkBudget = null;
const MAX_REQUEST_ATTEMPTS = 4;
const MAX_WHOLE_SNAPSHOT_ATTEMPTS = 2;
const MAX_REST_PAGES = 1_000;
const MAX_GRAPHQL_PAGES = 1_000;
const MAX_IN_PROCESS_RETRY_WAIT_MS = 10_000;
const AUTHORIZATION_PERSISTENCE_FENCE_DESCRIPTION =
  "Authorization state persistence failed; fresh marker required";

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
    !hasTrustedGateStateOrMarker(snapshot.comments, config.trustedCommentLogins);
  if (scheduledWithoutTrustedState) {
    console.log(
      `PR #${activePrNumber} has no trusted gate state or marker; skipping scheduled scan.`,
    );
    return;
  }
  failIfSnapshotEvidenceIsInvalid(snapshot);

  let {
    state,
    stateComment: savedStateComment,
    needsFreshMarker: stateNeedsFreshMarker,
    needsSave: stateNeedsSave,
    legacyFailureCandidate,
  } = await ensureState(snapshot, null, null, { persist: false });
  const legacyMigration = migrateLegacyFailureState(
    state,
    snapshot,
    isoNow(),
    { legacyFailureCandidate },
  );
  state = legacyMigration.state;
  stateNeedsFreshMarker = stateNeedsFreshMarker || legacyMigration.needsFreshMarker;
  stateNeedsSave = stateNeedsSave || legacyMigration.changed;
  const fenceRecovery = await recoverAuthorizationPersistenceFence(
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
    savedStateComment = await saveAuthorizationCriticalState(
      state,
      savedStateComment,
      "legacy passed-marker authorization lineage",
    );
    stateNeedsSave = false;
  }
  state = migrateStateForEventDrivenDeadlines(state);
  stateNeedsFreshMarker = stateNeedsFreshMarker ||
    stateNeedsFreshMarkerAfterRecovery(state) ||
    stateNeedsFreshMarkerAfterMissingMarker(state, statusSha);
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
      { ...trigger, allowCreateMarker: true },
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
    await reconcileCurrentReviewEvidence(
      snapshot,
      state,
      savedStateComment,
      { trigger },
    )
  ) {
    return;
  }

  if (
    snapshot.findings.count === 0 &&
    snapshot.providerResult.kind === "clean" &&
    !state.activeMarker
  ) {
    const demotion = await demoteUnauthorizedCleanIfNeeded(
      state,
      savedStateComment,
    );
    state = demotion.state;
    savedStateComment = demotion.stateComment;
    stateNeedsFreshMarker =
      stateNeedsFreshMarker || demotion.needsFreshMarker;
    allowCreateMarker = allowCreateMarker || demotion.needsFreshMarker;
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
    { ...trigger, allowCreateMarker },
  );
  if (result.kind === "save") {
    await saveState(result.state, result.stateComment);
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

  const createdStateComment = persist ? await saveState(state, null) : null;
  return {
    state,
    stateComment: createdStateComment,
    needsFreshMarker: true,
    needsSave: !persist,
    legacyFailureCandidate: false,
  };
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
              authorizationLineageMigratedAt: now,
            }
          : candidate,
      ),
    }),
    changed: true,
    needsFreshMarker: false,
  };
}

async function advanceEventDrivenMarker(state, stateComment, snapshot, trigger) {
  let allowCreateMarker = trigger.allowCreateMarker || stateNeedsFreshMarkerAfterRecovery(state);

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

      if (!allowCreateMarker) {
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
      allowCreateMarker = true;
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

async function reconcileCurrentReviewEvidence(
  snapshot,
  state,
  stateComment,
  { trigger = null } = {},
) {
  failIfSnapshotEvidenceIsInvalid(snapshot);
  if (snapshot.findings.count > 0) {
    const rejectedState = recordRejectedFreshRecoveryAttempt(
      snapshot.providerResult,
      state,
      trigger,
      snapshot,
    );
    await failFromFindings(snapshot.findings, rejectedState, stateComment);
    return true;
  }
  if (snapshot.providerResult.kind !== "clean") {
    return false;
  }
  const authorization = providerResultAuthorization(
    snapshot.providerResult,
    state,
    trigger,
    snapshot,
  );
  if (!authorization) {
    return false;
  }

  await passGateFromCurrentEvidence(state, stateComment, {
    trigger,
    authorizationKind: authorization.kind,
  });
  return true;
}

function providerResultAuthorization(providerResult, state, trigger, snapshot) {
  const marker = state?.activeMarker;
  if (!marker) {
    return (
      passedMarkerReassertAuthorization(providerResult, state, snapshot) ||
      failedFindingsRecoveryAuthorization(providerResult, state, trigger, snapshot)
    );
  }
  if (activeMarkerIsObsolete(marker, statusSha)) {
    return null;
  }
  if (!trustedLiveMarkerMatches(marker, snapshot)) {
    return null;
  }

  const baselineArtifact = providerResult.source === "issue-comment"
    ? marker.baseline?.completionComment
    : marker.baseline?.approvedReview;
  if (providerResult.source === "issue-comment") {
    return hasNewCompletionComment(
      baselineArtifact,
      {
        id: String(providerResult.id),
        createdAt: providerResult.createdAt,
      },
      marker.createdAt,
      { bufferSeconds: config.completionSignalBufferSeconds },
    )
      ? { kind: "active-marker", marker }
      : null;
  }
  if (providerResult.source === "pull-request-review") {
    return hasNewReviewTransition(
      baselineArtifact,
      {
        id: String(providerResult.id),
        submittedAt: providerResult.createdAt,
      },
      marker.createdAt,
    )
      ? { kind: "active-marker", marker }
      : null;
  }

  return null;
}

function passedMarkerReassertAuthorization(providerResult, state, snapshot) {
  if (state?.activeMarker || state?.statusHead !== statusSha) {
    return null;
  }
  const passedMarker = [...(state?.history || [])]
    .reverse()
    .find((marker) => marker.headSha === statusSha);
  if (
    !passedMarker ||
    (passedMarker.outcome || passedMarker.state) !== "passed" ||
    !passedMarker.observedProviderResult
  ) {
    return null;
  }

  if (!trustedLiveMarkerMatches(passedMarker, snapshot)) {
    return null;
  }

  const observed = passedMarker.observedProviderResult;
  if (!isDeepStrictEqual(observed, providerResult)) {
    return null;
  }
  return { kind: "passed-marker-reassert", marker: passedMarker };
}

function trustedLiveMarkerMatches(recordedMarker, snapshot) {
  const markerComment = findLatestTrustedMarkerComment(
    snapshot?.comments || [],
    config.trustedCommentLogins,
  );
  const liveMarker = markerComment ? markerFromComment(markerComment) : null;
  if (!liveMarker) {
    return false;
  }
  if (
    liveMarker.version !== STATE_VERSION ||
    recordedMarker?.version !== STATE_VERSION
  ) {
    return false;
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
  return immutableFields.every((field) =>
    String(liveMarker[field] ?? "") === String(recordedMarker[field] ?? ""),
  ) && isDeepStrictEqual(liveMarker.baseline || {}, recordedMarker.baseline || {});
}

function failedFindingsRecoveryAuthorization(providerResult, state, trigger, snapshot) {
  if (
    !config.failedFindingsRecovery ||
    state?.activeMarker ||
    state?.statusHead !== statusSha ||
    providerResult.source !== "issue-comment" ||
    !trigger?.completionComment ||
    String(trigger.completionComment.id) !== String(providerResult.id) ||
    trigger.completionComment.createdAt !== providerResult.createdAt
  ) {
    return null;
  }

  const failedMarker = [...(state?.history || [])]
    .reverse()
    .find((marker) => marker.headSha === statusSha);
  if (
    !failedMarker ||
    (failedMarker.outcome || failedMarker.state) !== "failed_findings" ||
    !failedMarker.closedAt ||
    !trustedLiveMarkerMatches(failedMarker, snapshot)
  ) {
    return null;
  }

  const resultCreatedAt = parseTimestamp(
    providerResult.createdAt,
    "Codex provider result creation time",
  );
  const findingsClosedAt = parseTimestamp(
    failedMarker.closedAt,
    "failed findings marker close time",
  );
  if (resultCreatedAt <= findingsClosedAt) {
    return null;
  }

  if (
    config.failedFindingsRecoveryMode === "fresh" &&
    recoveryCompletionWasRejected(failedMarker, providerResult)
  ) {
    return null;
  }
  if (config.failedFindingsRecoveryMode === "fresh") {
    const cutoff = latestRejectedRecoveryCutoff(failedMarker);
    if (
      cutoff &&
      resultCreatedAt <= parseTimestamp(cutoff, "latest rejected recovery time")
    ) {
      return null;
    }
  }

  return { kind: "failed-findings-recovery", marker: failedMarker };
}

function recordRejectedFreshRecoveryAttempt(providerResult, state, trigger, snapshot) {
  if (
    config.failedFindingsRecoveryMode !== "fresh" ||
    !failedFindingsRecoveryAuthorization(providerResult, state, trigger, snapshot)
  ) {
    return state;
  }

  const rejected = {
    id: String(providerResult.id),
    createdAt: providerResult.createdAt,
    rejectedAt: isoNow(),
  };
  const history = state.history || [];
  const failedMarkerIndex = history.findLastIndex((marker) =>
    marker.headSha === statusSha &&
    (marker.outcome || marker.state) === "failed_findings",
  );
  return normalizeState({
    ...state,
    updatedAt: rejected.rejectedAt,
    history: history.map((marker, index) => {
      if (index !== failedMarkerIndex) {
        return marker;
      }
      if (recoveryCompletionWasRejected(marker, providerResult)) {
        return marker;
      }
      return {
        ...marker,
        latestRejectedRecoveryAt: latestRejectedRecoveryCutoff(
          marker,
          rejected.rejectedAt,
        ),
        rejectedRecoveryCompletions: [
          ...(marker.rejectedRecoveryCompletions || []),
          rejected,
        ].slice(-20),
      };
    }),
  });
}

function recoveryCompletionWasRejected(marker, providerResult) {
  return (marker.rejectedRecoveryCompletions || []).some((rejected) =>
    String(rejected.id) === String(providerResult.id) &&
    rejected.createdAt === providerResult.createdAt,
  );
}

function latestRejectedRecoveryCutoff(marker, fallback = null) {
  const candidates = [
    marker.latestRejectedRecoveryAt,
    ...(marker.rejectedRecoveryCompletions || []).map((rejected) => rejected.rejectedAt),
    fallback,
  ].filter(Boolean);
  if (candidates.length === 0) {
    return null;
  }
  return candidates.sort((left, right) =>
    parseTimestamp(right, "rejected recovery time") -
      parseTimestamp(left, "rejected recovery time"),
  )[0];
}

function failIfSnapshotEvidenceIsInvalid(snapshot) {
  const errors = snapshot.evidenceErrors || [];
  if (errors.length === 0 && snapshot.providerResult.kind !== "malformed") {
    return;
  }

  const reason = errors[0] || snapshot.providerResult.reason || "unknown provider evidence conflict";
  throw new GateFailure(
    "error",
    "Codex review evidence is invalid",
    `Cannot reconcile Codex review evidence for ${statusSha}: ${reason}`,
  );
}

async function passGateFromCurrentEvidence(
  state,
  stateComment,
  { trigger = null, authorizationKind = "active-marker" } = {},
) {
  const liveStatus = await loadLatestGateStatus();
  await failIfPullRequestHeadChanged("before final Codex review evidence snapshot");
  const finalSnapshot = await loadSnapshot();
  failIfSnapshotEvidenceIsInvalid(finalSnapshot);
  const finalSnapshotTimeout = await timeOutCurrentHeadWaitCycleIfNeeded(
    state,
    stateComment,
  );
  if (finalSnapshotTimeout.timedOut) {
    return;
  }
  if (finalSnapshot.findings.count > 0) {
    const rejectedState = recordRejectedFreshRecoveryAttempt(
      finalSnapshot.providerResult,
      state,
      trigger,
      finalSnapshot,
    );
    await failFromFindings(finalSnapshot.findings, rejectedState, stateComment);
    return;
  }
  if (finalSnapshot.providerResult.kind !== "clean") {
    throw new GateFailure(
      "error",
      "Codex clean result changed during final validation",
      `The current-head Codex clean result for ${statusSha} was not stable across final validation.`,
    );
  }
  const finalAuthorization = providerResultAuthorization(
    finalSnapshot.providerResult,
    state,
    trigger,
    finalSnapshot,
  );
  if (!finalAuthorization || finalAuthorization.kind !== authorizationKind) {
    throw new GateFailure(
      "pending",
      "Codex clean result is not authorized by the current review state",
      `The current-head Codex clean result for ${statusSha} is not authorized by ` +
        `${authorizationKind}.`,
    );
  }

  const passedState = updateStateForStatus(
    state.activeMarker
      ? closeActiveMarker(state, "passed", isoNow(), {
          observedProviderResult: finalSnapshot.providerResult,
        })
      : state,
    {
      now: isoNow(),
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
  try {
    await saveState(passedState, stateComment);
  } catch (error) {
    console.warn(`failed to save audit state after ${STATUS_CONTEXT}=success: ${error.message}`);
  }
  console.log(
    `${STATUS_CONTEXT} passed for ${statusSha} from ` +
      `${finalSnapshot.providerResult.source} ${finalSnapshot.providerResult.id}.`,
  );
}

async function passGate(state, stateComment, snapshot, observed) {
  void snapshot;
  void observed;
  await passGateFromCurrentEvidence(state, stateComment);
}

async function failFromFindings(findings, state, stateComment) {
  const sample = findings.samples[0];
  const suffix = sample ? ` First finding: ${sample}` : "";
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
  await saveAuthorizationCriticalState(
    statusState,
    stateComment,
    "failed findings state",
  );
  await setCommitStatus("failure", `Codex posted ${findings.count} finding(s) on current head`);
  console.log(`Codex review found ${findings.count} finding(s) for ${statusSha}.${suffix}`);
}

async function saveAuthorizationCriticalState(state, stateComment, description) {
  try {
    return await saveState(state, stateComment);
  } catch (updateError) {
    let replacementError = null;
    if (stateComment?.id) {
      console.warn(
        `failed to update authorization-critical ${description}; ` +
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
      await publishAuthorizationFence(state, description);
    } catch (error) {
      fenceError = error;
    }
    if (!fenceError) {
      throw new GateFailure(
        "error",
        AUTHORIZATION_PERSISTENCE_FENCE_DESCRIPTION,
        `failed to persist authorization-critical ${description}; ` +
          `published a durable marker-lineage fence and stopped this run`,
      );
    }
    const replacementDetail = replacementError
      ? `; replacement state creation failed (${replacementError.message})`
      : "";
    throw new GateFailure(
      "error",
      AUTHORIZATION_PERSISTENCE_FENCE_DESCRIPTION,
      `failed to persist authorization-critical ${description}; ` +
        `state write failed (${updateError.message})${replacementDetail}; ` +
        `durable marker-lineage fence failed (${fenceError.message})`,
    );
  }
}

async function publishAuthorizationFence(state, description) {
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
      authorizationFence: {
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
    `published a durable authorization fence on controlled marker ${marker.id} for ${statusSha}`,
  );
}

async function recoverAuthorizationPersistenceFence(state, stateComment, snapshot) {
  const markerComment = findLatestTrustedMarkerComment(
    snapshot.comments || [],
    config.trustedCommentLogins,
  );
  const liveMarker = markerComment ? markerFromComment(markerComment) : null;
  const markerFence =
    liveMarker?.headSha === statusSha &&
    liveMarker.baseline?.authorizationFence;

  if (!markerFence) {
    return { state, stateComment, needsFreshMarker: false, recovered: false };
  }

  const now = isoNow();
  let recoveredState;
  if (state.activeMarker) {
    recoveredState = closeActiveMarker(state, "state_lost", now, {
      recoveryReason: "authorization_state_persistence_fence",
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
            `authorization-fence-${config.runId}-${config.runAttempt}`,
          url: markerComment?.html_url || previousMarker?.url || null,
          headSha: statusSha,
          baseline: liveMarker?.baseline || previousMarker?.baseline || {},
          state: "state_lost",
          outcome: "state_lost",
          closedAt: now,
          recoveryReason: "authorization_state_persistence_fence",
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
  const recoveredStateComment = await saveAuthorizationCriticalState(
    recoveredState,
    stateComment,
    "authorization persistence fence recovery",
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

async function demoteUnauthorizedCleanIfNeeded(state, stateComment) {
  const liveStatus = await loadLatestGateStatus();
  const now = isoNow();
  const invalidation = invalidatePassedAuthorizationLineage(state, now);
  if (
    !invalidation.changed &&
    !liveStatus.readFailed &&
    liveStatus.producerMatches &&
    liveStatus.latest &&
    liveStatus.latest.state !== "success"
  ) {
    return { state, stateComment, needsFreshMarker: false };
  }

  const pendingState = updateStateForStatus(invalidation.state, {
    now,
    statusHead: statusSha,
    runUrl,
    status: "pending",
  });
  if (invalidation.changed) {
    let persistedStateComment = stateComment;
    await setCommitStatusIfNeeded(
      "pending",
      "Current-head Codex clean result is not authorized by trusted marker lineage",
      {
        liveStatus,
        beforeDecision: async () => {
          persistedStateComment = await saveAuthorizationCriticalState(
            pendingState,
            stateComment,
            "unauthorized passed-result lineage invalidation",
          );
        },
      },
    );
    return {
      state: pendingState,
      stateComment: persistedStateComment,
      needsFreshMarker: true,
    };
  }

  await setCommitStatusIfNeeded(
    "pending",
    "Current-head Codex clean result is not authorized by trusted marker lineage",
    { liveStatus },
  );
  try {
    return {
      state: pendingState,
      stateComment: await saveState(pendingState, stateComment),
      needsFreshMarker: false,
    };
  } catch (error) {
    console.warn(
      `failed to save audit state after unauthorized clean demotion: ${error.message}`,
    );
    return {
      state: pendingState,
      stateComment,
      needsFreshMarker: false,
    };
  }
}

function invalidatePassedAuthorizationLineage(state, now) {
  const history = state?.history || [];
  const latestForHead = [...history]
    .reverse()
    .find((marker) => marker.headSha === statusSha);
  if (
    !latestForHead ||
    (latestForHead.outcome || latestForHead.state) !== "passed"
  ) {
    return { state, changed: false };
  }

  return {
    changed: true,
    state: normalizeState({
      ...state,
      updatedAt: now,
      history: [
        ...history,
        {
          ...latestForHead,
          version: STATE_VERSION,
          state: "state_lost",
          outcome: "state_lost",
          closedAt: now,
          recoveryReason: "unauthorized_passed_result_lineage",
          authorizationLineageInvalidatedAt: now,
        },
      ],
    }),
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
  const persistedStateComment = await saveAuthorizationCriticalState(
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
    const snapshot = await loadSnapshotOnce({
      allowMissingReviewChildTransient: attempt < MAX_WHOLE_SNAPSHOT_ATTEMPTS,
      evidenceBudget: reuseInitialComments
        ? initialSnapshotBudget
        : createEvidenceSnapshotBudget(),
      preloadedComments: reuseInitialComments ? initialComments : null,
    });
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
    throw new GateFailure(
      "pending",
      "Codex review evidence is temporarily incomplete",
      `Cross-channel review evidence remained incomplete after a bounded whole-snapshot ` +
        `reload: ${snapshot.evidenceTransientErrors[0]}`,
    );
  }

  throw new Error("whole-snapshot reconciliation exceeded its retry budget");
}

async function loadSnapshotOnce({
  allowMissingReviewChildTransient = false,
  evidenceBudget,
  preloadedComments = null,
} = {}) {
  const [comments, issueReactions, reviewComments, reviews, reviewThreads] =
    await settleEvidenceLoads([
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
    ], evidenceBudget);
  const markerComment = findLatestTrustedMarkerComment(comments, config.trustedCommentLogins);
  const markerCommentReactions = markerComment?.id
    ? await paginate(
        `${repoPath}/issues/comments/${markerComment.id}/reactions`,
        { per_page: "100" },
        { evidenceBudget },
      )
    : [];

  const evidence = await buildCurrentReviewEvidence({
    comments,
    reviewComments,
    reviews,
    reviewThreads,
    allowMissingReviewChildTransient,
    evidenceBudget,
  });
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
    findings: evidence.findings,
    providerResult: evidence.providerResult,
    evidenceErrors: evidence.errors,
    evidenceTransientErrors: evidence.transientErrors,
  };
}

async function settleEvidenceLoads(loads, evidenceBudget) {
  const settled = await Promise.allSettled(loads);
  const rejections = settled
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason);
  if (rejections.length > 0) {
    const deterministic = rejections.find(
      (error) => !(error instanceof GateFailure) || error.state !== "pending",
    );
    if (deterministic) {
      throw deterministic;
    }
    const fulfilledEvidenceError = await validateFulfilledProviderEvidence(
      settled,
      evidenceBudget,
    );
    if (fulfilledEvidenceError) {
      throw fulfilledEvidenceError;
    }
    if (evidenceWorkBudget?.failure) {
      throw evidenceWorkBudget.failure;
    }
    throw rejections[0];
  }
  return settled.map((result) => result.value);
}

async function validateFulfilledProviderEvidence(settled, evidenceBudget) {
  const commentsResult = settled[0];
  const reviewCommentsResult = settled[2];
  const reviewsResult = settled[3];
  const reviewThreadsResult = settled[4];
  let inlineParentEvidenceComplete = false;
  let validatedCodexInlineParentReviewIds = new Set();
  if (
    reviewCommentsResult?.status === "fulfilled" &&
    reviewsResult?.status === "fulfilled" &&
    reviewThreadsResult?.status === "fulfilled"
  ) {
    const threadEvidence = collectCodexThreadEvidence(
      reviewCommentsResult.value,
      reviewsResult.value,
      reviewThreadsResult.value,
      config.codexBotLogins,
      statusSha,
    );
    if (threadEvidence.errors.length > 0) {
      return invalidProviderEvidenceFailure(threadEvidence.errors[0]);
    }
    inlineParentEvidenceComplete = threadEvidence.transientErrors.length === 0;
    validatedCodexInlineParentReviewIds = new Set(
      threadEvidence.validatedCodexInlineParentReviewIds,
    );
  }

  if (reviewsResult?.status === "fulfilled") {
    const reviewIds = new Set();
    for (const review of reviewsResult.value) {
      if (
        typeof review?.id !== "number" ||
        !Number.isSafeInteger(review.id) ||
        review.id <= 0
      ) {
        return invalidProviderEvidenceFailure(
          "REST review snapshot contains a review without a valid numeric id",
        );
      }
      const reviewId = String(review.id);
      if (reviewIds.has(reviewId)) {
        return invalidProviderEvidenceFailure(
          `REST review snapshot contains duplicate numeric id ${reviewId}`,
        );
      }
      reviewIds.add(reviewId);
    }
  }

  if (
    commentsResult?.status !== "fulfilled" ||
    reviewsResult?.status !== "fulfilled"
  ) {
    return null;
  }

  const artifacts = [
    ...commentsResult.value.map((comment) =>
      parseCodexIssueCommentArtifact(comment, {
        owner: repo.owner,
        repo: repo.name,
        botLogins: config.codexBotLogins,
      }),
    ),
    ...reviewsResult.value.map((review) => {
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
  ].filter(Boolean);
  const providerResult = await selectCurrentHeadProviderResult(
    artifacts,
    evidenceBudget,
  );
  if (providerResult.kind === "malformed") {
    return invalidProviderEvidenceFailure(providerResult.reason);
  }
  return null;
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
  const providerResult = await selectCurrentHeadProviderResult(artifacts, evidenceBudget);
  const providerFindings = providerResult.kind === "finding"
    ? {
        count: 1,
        ids: [`${providerResult.source}:${providerResult.id}`],
        samples: providerResult.samples || [],
      }
    : { count: 0, ids: [], samples: [] };

  return {
    providerResult,
    errors: threadFindings.errors,
    transientErrors: [
      ...threadFindings.transientErrors,
      ...parentReviewTransientErrors,
    ],
    findings: {
      count: threadFindings.count + providerFindings.count,
      ids: [...threadFindings.ids, ...providerFindings.ids],
      samples: [...threadFindings.samples, ...providerFindings.samples].slice(0, 3),
    },
  };
}

async function selectCurrentHeadProviderResult(artifacts, evidenceBudget) {
  const artifactIdentities = new Set();
  for (const artifact of artifacts) {
    if (!/^[1-9][0-9]*$/.test(String(artifact.id || ""))) {
      continue;
    }
    const identity = `${artifact.source}:${artifact.id}`;
    if (artifactIdentities.has(identity)) {
      return {
        kind: "malformed",
        source: "provider-artifact-set",
        id: identity,
        reason: `Codex provider artifact identity ${identity} appears more than once`,
      };
    }
    artifactIdentities.add(identity);
  }

  let ordered;
  try {
    ordered = sortCodexArtifactsNewestFirst(artifacts);
  } catch (error) {
    return {
      kind: "malformed",
      source: "provider-artifact-set",
      id: "unknown",
      reason: error.message,
    };
  }

  const resolutionCache = new Map();
  const ancestryCache = new Map();
  for (let index = 0; index < ordered.length;) {
    const createdAt = ordered[index].createdAt;
    const createdAtMs = parseTimestamp(createdAt, "Codex artifact creation time");
    const group = [];
    while (
      index < ordered.length &&
      parseTimestamp(ordered[index].createdAt, "Codex artifact creation time") === createdAtMs
    ) {
      group.push(ordered[index]);
      index += 1;
    }

    if (new Set(group.map((artifact) => artifact.source)).size > 1) {
      return {
        kind: "malformed",
        source: "provider-artifact-set",
        id: group.map((artifact) => `${artifact.source}:${artifact.id}`).join(","),
        reason: "cross-channel Codex terminal artifacts share an ambiguous server timestamp",
      };
    }

    for (let groupIndex = 0; groupIndex < group.length; groupIndex += 1) {
      const artifact = group[groupIndex];
      if (artifact.kind === "malformed") {
        return artifact;
      }
      if (artifact.kind === "finding") {
        return artifact;
      }
      if (artifact.kind !== "clean") {
        continue;
      }

      let resolvedSha = artifact.headSha || "";
      if (artifact.commitRef) {
        resolvedSha = await resolveReviewedCommit(
          artifact.commitRef,
          resolutionCache,
          evidenceBudget,
        );
      }
      if (resolvedSha === statusSha.toLowerCase()) {
        const unsupersededFinding = await firstUnsupersededOlderFinding(
          resolvedSha,
          [...group.slice(groupIndex + 1), ...ordered.slice(index)],
          ancestryCache,
          resolutionCache,
          evidenceBudget,
        );
        if (unsupersededFinding) {
          return unsupersededFinding;
        }
        return {
          ...artifact,
          headSha: resolvedSha,
        };
      }
      if (
        await commitIsAncestor(
          resolvedSha,
          statusSha.toLowerCase(),
          ancestryCache,
          evidenceBudget,
        )
      ) {
        const unsupersededFinding = await firstUnsupersededOlderFinding(
          resolvedSha,
          [...group.slice(groupIndex + 1), ...ordered.slice(index)],
          ancestryCache,
          resolutionCache,
          evidenceBudget,
        );
        if (unsupersededFinding) {
          return unsupersededFinding;
        }
        return {
          ...artifact,
          kind: "pending",
          headSha: resolvedSha,
          reason:
            `latest Codex clean result is bound to prior head ${resolvedSha}; ` +
            `waiting for a complete clean result on current head ${statusSha.toLowerCase()}`,
        };
      }
      return {
        ...artifact,
        kind: "malformed",
        reason:
          `latest Codex clean result resolved to ${resolvedSha}, ` +
          `not current head ${statusSha.toLowerCase()}`,
      };
    }
  }

  return { kind: "pending", source: "provider-artifact-set", id: "none" };
}

async function firstUnsupersededOlderFinding(
  cleanHeadSha,
  olderArtifacts,
  ancestryCache,
  resolutionCache,
  evidenceBudget,
) {
  const newerCleanHeads = [cleanHeadSha];
  const unresolvedCleanArtifacts = [];
  for (const artifact of olderArtifacts) {
    if (artifact.kind === "clean") {
      const declaredHead = artifact.headSha ||
        (/^[0-9a-f]{40}$/.test(artifact.commitRef || "") ? artifact.commitRef : "");
      if (declaredHead) {
        newerCleanHeads.push(declaredHead);
      } else if (artifact.commitRef) {
        unresolvedCleanArtifacts.push(artifact);
      }
      continue;
    }
    if (artifact.kind !== "finding") {
      continue;
    }

    let superseded = await findingIsSupersededByCleanHeads(
      artifact,
      newerCleanHeads,
      ancestryCache,
      evidenceBudget,
    );
    while (!superseded && unresolvedCleanArtifacts.length > 0) {
      const unresolvedClean = unresolvedCleanArtifacts.shift();
      let resolvedSha;
      try {
        resolvedSha = await resolveReviewedCommit(
          unresolvedClean.commitRef,
          resolutionCache,
          evidenceBudget,
        );
      } catch (error) {
        if (error instanceof GateFailure && error.state === "pending") {
          throw error;
        }
        // Deterministically invalid older evidence remains audit history only.
        continue;
      }
      newerCleanHeads.push(resolvedSha);
      superseded = await findingIsSupersededByCleanHeads(
        artifact,
        [resolvedSha],
        ancestryCache,
        evidenceBudget,
      );
    }
    if (!superseded) {
      return artifact;
    }
  }
  return null;
}

async function findingIsSupersededByCleanHeads(
  finding,
  cleanHeads,
  ancestryCache,
  evidenceBudget,
) {
  for (const cleanHead of cleanHeads) {
    if (
      finding.headSha === cleanHead ||
      await commitIsAncestor(
        finding.headSha,
        cleanHead,
        ancestryCache,
        evidenceBudget,
      )
    ) {
      return true;
    }
  }
  return false;
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
  if (expectedCommitCount > 0) {
    const terminalCommitSha = String(
      data.commits.at(-1)?.sha || "",
    ).toLowerCase();
    if (
      !/^[0-9a-f]{40}$/.test(terminalCommitSha) ||
      terminalCommitSha !== headSha
    ) {
      throw invalidResponse(
        `bound terminal commit ${terminalCommitSha || "<missing>"} instead of requested head ${headSha}`,
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
    return cache.get(commitRef);
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
    if (error instanceof GateFailure && error.state === "pending") {
      throw error;
    }
    throw new GateFailure(
      "error",
      "Codex reviewed commit could not be resolved",
      `Cannot uniquely resolve Reviewed commit ${commitRef}: ${error.message}`,
    );
  }
  const resolvedSha = String(data?.sha || "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(resolvedSha)) {
    throw new GateFailure(
      "error",
      "Codex reviewed commit response is invalid",
      `Reviewed commit ${commitRef} did not resolve to one full commit SHA.`,
    );
  }
  if (!resolvedSha.startsWith(commitRef)) {
    throw new GateFailure(
      "error",
      "Codex reviewed commit response conflicts with its short SHA",
      `Reviewed commit ${commitRef} resolved to non-matching commit ${resolvedSha}.`,
    );
  }
  cache.set(commitRef, resolvedSha);
  return resolvedSha;
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

async function setCommitStatus(
  state,
  description,
  { retryTransient = true } = {},
) {
  await request("POST", `${repoPath}/statuses/${statusSha}`, {
    state,
    context: STATUS_CONTEXT,
    description: truncate(description, 140),
    target_url: runUrl,
  }, { retryTransient });
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
      const latest = data.find((status) => status.context === STATUS_CONTEXT);
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
    status?.creator?.type === "Bot" &&
    status.creator.login === "github-actions[bot]"
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
      return mapWithConcurrency(
        threads,
        MAX_REVIEW_THREAD_COMMENT_CONCURRENCY,
        (thread) => loadAllReviewThreadComments(thread, evidenceBudget),
      );
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

async function loadAllReviewThreadComments(thread, evidenceBudget) {
  if (
    typeof thread?.id !== "string" ||
    thread.id.length === 0 ||
    /\s/.test(thread.id)
  ) {
    throw new Error("GraphQL review thread does not have a valid opaque id");
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
    connection = data?.node?.comments;
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
