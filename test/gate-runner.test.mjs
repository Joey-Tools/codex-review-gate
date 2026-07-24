import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MAX_FINDING_ID_SAMPLES,
  MAX_STATE_COMMENT_BYTES,
  MARKER_COMMENT,
  STATE_MARKER,
  parseMarkerCommentBody,
  parseStateCommentBody,
} from "../packages/action/src/core.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fakeFetchPath = join(repoRoot, "test/support/fake-github-fetch.mjs");
const HEAD_SHA = "01c3f9da03e7adfdcd4176cb927dc450436da8f4";
const HEAD_SHORT_SHA = "01c3f9da03";
const OLD_HEAD_SHA = "83542fa83542fa83542fa83542fa83542fa83542";
const NEW_HEAD_SHA = "abcdefabcdefabcdefabcdefabcdefabcdefabcd";
const LARGE_INLINE_COMMENT_ID = 3634927460;

test("pull_request_target creates current-head state, marker, and pending status", async () => {
  await withHarness(async (harness) => {
    const result = await harness.runGate({
      eventName: "pull_request_target",
      event: {
        pull_request: { number: 1, head: { sha: HEAD_SHA } },
        repository: { default_branch: "master" },
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.length, 1);
    assert.deepEqual(harness.statuses[0].body, {
      state: "pending",
      context: "codex/review-gate",
      description: "Waiting for Codex review on controlled marker",
      target_url: "https://github.example/owner/repo/actions/runs/12345",
    });

    const stateComment = harness.findStateComment();
    const state = parseStateCommentBody(stateComment.body);
    assert.equal(state.statusHead, HEAD_SHA);
    assert.equal(state.lastStatus.state, "pending");
    assert.equal(state.activeMarker.headSha, HEAD_SHA);
    assert.equal(state.activeMarker.state, "waiting_ack");
    assert.equal(state.activeMarker.ackDeadlineAt, "2026-05-14T10:06:01.000Z");
    assert.equal(state.activeMarker.resultDeadlineAt, "2026-05-14T11:01:01.000Z");

    const markerComment = harness.findMarkerComments().at(-1);
    assert.equal(markerComment.body.startsWith("@codex review"), true);
    assert.equal(markerComment.body.includes("[!NOTE]"), false);
    assert.equal(markerComment.body.includes("generative AI review"), false);
    assert.match(result.stepSummary, /This workflow requested a Codex generative AI review/);
    const marker = parseMarkerCommentBody(markerComment.body);
    assert.equal(marker.headSha, HEAD_SHA);
    assert.equal(marker.state, "waiting_ack");
  });
});

test("issue_comment completion after marker passes only after final current-head reload", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    harness.issueComments.push(codexCleanComment(2001, "2026-05-14T09:57:00Z"));

    const result = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: { user: { login: "chatgpt-codex-connector[bot]" } },
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.pullLoads, 2);
    assert.equal(harness.snapshotLoads, 2);
    assert.equal(harness.statuses.at(-1).body.state, "success");

    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.activeMarker, null);
    assert.equal(state.lastStatus.state, "success");
    assert.equal(state.history.at(-1).outcome, "passed");
    assert.equal(state.history.at(-1).observedProviderResult.id, "2001");
  });
});

test("approved Codex review passes the active marker after the final finding check", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    harness.reviews.push({
      id: 4001,
      state: "APPROVED",
      commit_id: HEAD_SHA,
      submitted_at: "2026-05-14T09:57:00Z",
      body: "Looks good.",
      user: codexBotUser(),
    });

    const result = await harness.runGate({
      eventName: "pull_request_review",
      event: {
        pull_request: { number: 1 },
        review: { user: { login: "chatgpt-codex-connector[bot]" } },
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.snapshotLoads, 2);
    assert.equal(harness.statuses.at(-1).body.state, "success");

    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.activeMarker, null);
    assert.equal(state.history.at(-1).outcome, "passed");
    assert.equal(state.history.at(-1).observedProviderResult.id, "4001");
  });
});

test("an older approval cannot bypass a newer selected prior-head clean", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
      ackDeadlineAt: "2026-05-14T10:30:00Z",
      nextRetryAt: "2026-05-14T10:30:00Z",
    });
    harness.commitResolutions[OLD_HEAD_SHA.slice(0, 10)] = OLD_HEAD_SHA;
    harness.reviews.push({
      id: 4001,
      state: "APPROVED",
      commit_id: HEAD_SHA,
      submitted_at: "2026-05-14T09:58:00Z",
      body: "Looks good.",
      user: codexBotUser(),
    });
    const newerPriorHeadClean = codexCleanCommentForHead(
      2001,
      OLD_HEAD_SHA,
      "2026-05-14T10:00:00Z",
    );
    harness.issueComments.push(newerPriorHeadClean);
    harness.afterSnapshotLoad(2, {
      action: "removeIssueComment",
      value: newerPriorHeadClean.id,
    });

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.snapshotLoads, 1);
    assert.equal(successStatusWrites(harness), 0);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    assert.equal(
      parseStateCommentBody(harness.findStateComment().body).activeMarker.id,
      "2000",
    );
  });
});

test("issue_comment completion fails closed when final reload sees current-head findings", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    harness.issueComments.push(codexCleanComment(2001, "2026-05-14T09:57:00Z"));
    harness.afterPullLoad(2, {
      action: "pushReviewComment",
      value: currentHeadInlineFinding(3001),
    });
    harness.afterPullLoad(2, {
      action: "pushReviewThread",
      value: unresolvedThread(3001),
    });

    const result = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: { user: { login: "chatgpt-codex-connector[bot]" } },
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "failure");

    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.activeMarker, null);
    assert.equal(state.lastStatus.state, "failure");
    assert.equal(state.history.at(-1).outcome, "failed_findings");
    assert.equal(state.history.at(-1).currentHeadFindings.count, 1);
    assert.deepEqual(
      state.history.at(-1).currentHeadFindings.sampleIds,
      ["thread:thread-3001"],
    );
  });
});

test("issue_comment clean completion recovers resolved failed findings", async () => {
  await withHarness(async (harness) => {
    harness.seedFailedFindingsState({ id: 2000 });
    harness.reviewComments.push(currentHeadInlineFinding(3001));
    harness.reviewThreads.push({
      id: "thread-3001",
      isResolved: true,
      isOutdated: false,
      comments: { nodes: [graphqlReviewCommentIdentity(3001)] },
    });
    const comment = codexCleanComment(2001);
    harness.issueComments.push(comment);

    const result = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment,
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.pullLoads, 2);
    assert.equal(harness.snapshotLoads, 2);
    assert.equal(harness.statuses.at(-1).body.state, "success");
    assert.equal(
      harness.statuses.at(-1).body.description,
      "Latest Codex review is clean and all findings are resolved",
    );

    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.activeMarker, null);
    assert.equal(state.lastStatus.state, "success");
    assert.equal(state.history.at(-1).outcome, "failed_findings");
  });
});

test("a non-boolean isResolved value cannot suppress an inline finding", async () => {
  await withHarness(async (harness) => {
    seedCleanActiveMarker(harness);
    harness.reviewComments.push(currentHeadInlineFinding(3001));
    harness.reviewThreads.push({
      ...unresolvedThread(3001),
      isResolved: "false",
    });

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(successStatusWrites(harness), 0);
    assert.equal(harness.statuses.at(-1).body.state, "error");
    assert.match(result.stderr, /non-boolean isResolved value/);
  });
});

test("failed-findings-recovery=false disables no-marker recovery", async () => {
  await withHarness(async (harness) => {
    harness.seedFailedFindingsState({ id: 2000 });
    const comment = codexCleanComment(2001);
    harness.issueComments.push(comment);

    const result = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment,
      },
      env: { FAILED_FINDINGS_RECOVERY: "false" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "pending");

    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.activeMarker, null);
    assert.equal(state.lastStatus.state, "pending");
  });

  await withHarness(async (harness) => {
    harness.seedFailedFindingsState({ id: 2000 });
    const comment = codexCleanComment(2001);
    harness.issueComments.push(comment);

    const result = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment,
      },
      env: {
        FAILED_FINDINGS_RECOVERY_INPUT: "false",
        FAILED_FINDINGS_RECOVERY: "true",
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    assert.equal(
      parseStateCommentBody(harness.findStateComment().body).lastStatus.state,
      "pending",
    );
  });
});

test("failed-findings-recovery=false cannot be bypassed after a definite state update failure", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    harness.reviewComments.push(currentHeadInlineFinding(3001));
    harness.reviewThreads.push(unresolvedThread(3001));
    const comment = codexCleanComment(2001);
    harness.issueComments.push(comment);
    harness.nextCommentId = 2002;
    harness.routeFaults[
      `PATCH /repos/${harness.owner}/${harness.repo}/issues/comments/1000`
    ] = Array.from({ length: 4 }, () => ({
      status: 503,
      body: { message: "definite state update failure" },
      headers: { "Retry-After": "0" },
    }));

    const firstResult = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment,
      },
      env: { FAILED_FINDINGS_RECOVERY: "false" },
    });

    assert.equal(firstResult.code, 0, firstResult.stderr);
    assert.match(firstResult.stderr, /creating a replacement state comment/);
    assert.equal(
      harness.issueComments.filter((candidate) => candidate.body.includes(STATE_MARKER)).length,
      2,
    );
    assert.equal(parseStateCommentBody(harness.findStateComment().body).activeMarker, null);
    assert.equal(
      parseStateCommentBody(harness.findStateComment().body).history.at(-1).outcome,
      "failed_findings",
    );

    harness.reviewThreads[0].isResolved = true;
    const statusCount = harness.statuses.length;
    const secondResult = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment,
      },
      env: { FAILED_FINDINGS_RECOVERY: "false" },
    });

    assert.equal(secondResult.code, 0, secondResult.stderr);
    assert.equal(harness.statuses.length, statusCount);
    assert.equal(harness.statuses.some((status) => status.body.state === "success"), false);
  });
});

test("issue_comment clean completion keeps failed findings blocked when unresolved findings remain", async () => {
  await withHarness(async (harness) => {
    harness.seedFailedFindingsState({ id: 2000 });
    harness.reviewComments.push(currentHeadInlineFinding(3001));
    harness.reviewThreads.push({
      id: "thread-3001",
      isResolved: false,
      isOutdated: false,
      comments: { nodes: [graphqlReviewCommentIdentity(3001)] },
    });
    const comment = codexCleanComment(2001);
    harness.issueComments.push(comment);

    const result = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment,
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "failure");

    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.activeMarker, null);
    assert.equal(state.lastStatus.state, "failure");
  });
});

test("issue_comment clean completion recovery in head mode can reuse a same-head clean signal after findings resolve", async () => {
  await withHarness(async (harness) => {
    harness.seedFailedFindingsState({ id: 2000 });
    harness.reviewComments.push(currentHeadInlineFinding(3001));
    harness.reviewThreads.push({
      id: "thread-3001",
      isResolved: false,
      isOutdated: false,
      comments: { nodes: [graphqlReviewCommentIdentity(3001)] },
    });
    const comment = codexCleanComment(2001);
    harness.issueComments.push(comment);

    const firstResult = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment,
      },
    });

    assert.equal(firstResult.code, 0, firstResult.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "failure");
    assert.equal(
      parseStateCommentBody(harness.findStateComment().body).history.at(-1).rejectedRecoveryCompletions,
      undefined,
    );

    harness.reviewThreads[0].isResolved = true;
    const secondResult = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment,
      },
    });

    assert.equal(secondResult.code, 0, secondResult.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "success");
  });
});

test("fresh recovery mode records and rejects a reused clean signal", async () => {
  await withHarness(async (harness) => {
    harness.seedFailedFindingsState({ id: 2000 });
    harness.reviewComments.push(currentHeadInlineFinding(3001));
    harness.reviewThreads.push({
      id: "thread-3001",
      isResolved: false,
      isOutdated: false,
      comments: { nodes: [graphqlReviewCommentIdentity(3001)] },
    });
    const comment = codexCleanComment(2001);
    harness.issueComments.push(comment);

    const firstResult = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment,
      },
      env: { FAILED_FINDINGS_RECOVERY_MODE: "fresh" },
    });

    assert.equal(firstResult.code, 0, firstResult.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "failure");
    let state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.history.at(-1).rejectedRecoveryCompletions.at(-1).id, "2001");
    assert.equal(state.history.at(-1).latestRejectedRecoveryAt, "2026-05-14T10:01:00.000Z");

    harness.reviewThreads[0].isResolved = true;
    const statusCount = harness.statuses.length;
    const secondResult = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment,
      },
      env: { FAILED_FINDINGS_RECOVERY_MODE: "fresh" },
    });

    assert.equal(secondResult.code, 0, secondResult.stderr);
    assert.equal(harness.statuses.length, statusCount);
    assert.equal(harness.statuses.at(-1).body.state, "failure");
    state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.lastStatus.state, "failure");
  });
});

test("fresh recovery rejection survives a definite state update failure", async () => {
  await withHarness(async (harness) => {
    harness.seedFailedFindingsState({ id: 2000 });
    const comment = codexCleanComment(2001);
    harness.issueComments.push(comment);
    harness.nextCommentId = 2002;
    harness.afterPullLoad(2, {
      action: "pushReviewComment",
      value: currentHeadInlineFinding(3001),
    });
    harness.afterPullLoad(2, {
      action: "pushReviewThread",
      value: unresolvedThread(3001),
    });
    harness.routeFaults[
      `PATCH /repos/${harness.owner}/${harness.repo}/issues/comments/1000`
    ] = Array.from({ length: 4 }, () => ({
      status: 503,
      body: { message: "definite state update failure" },
      headers: { "Retry-After": "0" },
    }));

    const firstResult = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment,
      },
      env: { FAILED_FINDINGS_RECOVERY_MODE: "fresh" },
    });

    assert.equal(firstResult.code, 0, firstResult.stderr);
    assert.match(firstResult.stderr, /creating a replacement state comment/);
    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.history.at(-1).rejectedRecoveryCompletions.at(-1).id, "2001");
    assert.equal(
      harness.issueComments.filter((candidate) => candidate.body.includes(STATE_MARKER)).length,
      2,
    );

    harness.reviewThreads[0].isResolved = true;
    const statusCount = harness.statuses.length;
    const secondResult = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment,
      },
      env: { FAILED_FINDINGS_RECOVERY_MODE: "fresh" },
    });

    assert.equal(secondResult.code, 0, secondResult.stderr);
    assert.equal(harness.statuses.length, statusCount);
    assert.equal(harness.statuses.some((status) => status.body.state === "success"), false);
  });
});

test("a durable marker-lineage fence blocks replay when both critical state writes fail", async () => {
  await withHarness(async (harness) => {
    harness.seedFailedFindingsState({ id: 2000 });
    harness.reviewComments.push(currentHeadInlineFinding(3001));
    harness.reviewThreads.push(unresolvedThread(3001));
    const comment = codexCleanComment(2001);
    harness.issueComments.push(comment);
    harness.nextCommentId = 2002;
    harness.routeFaults[
      `PATCH /repos/${harness.owner}/${harness.repo}/issues/comments/1000`
    ] = Array.from({ length: 4 }, () => ({
      status: 503,
      body: { message: "definite state update failure" },
      headers: { "Retry-After": "0" },
    }));
    harness.routeFaults[
      `POST /repos/${harness.owner}/${harness.repo}/issues/${harness.prNumber}/comments`
    ] = [{
      status: 503,
      body: { message: "definite replacement state failure" },
      headers: { "Retry-After": "0" },
    }];

    const firstResult = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment,
      },
      env: { FAILED_FINDINGS_RECOVERY_MODE: "fresh" },
    });

    assert.equal(firstResult.code, 1);
    assert.equal(harness.statuses.at(-1).body.state, "error");
    assert.match(firstResult.stderr, /published a durable marker-lineage fence/);
    const liveMarker = parseMarkerCommentBody(harness.findMarkerComments().at(-1).body);
    assert.equal(liveMarker.baseline.authorizationFence.reason, "failed findings state");
    assert.equal(
      parseStateCommentBody(harness.findStateComment().body)
        .history.at(-1).rejectedRecoveryCompletions,
      undefined,
    );

    harness.reviewThreads[0].isResolved = true;
    harness.issueComments = harness.issueComments.filter(
      (candidate) => candidate.id !== comment.id,
    );
    const secondResult = await harness.runGate({
      eventName: "schedule",
      event: {},
      env: { FAILED_FINDINGS_RECOVERY_MODE: "fresh" },
    });

    assert.equal(secondResult.code, 0, secondResult.stderr);
    assert.equal(harness.statuses.some((status) => status.body.state === "success"), false);
  });
});

test("the current run fails closed when every authorization comment write fails", async () => {
  await withHarness(async (harness) => {
    harness.seedFailedFindingsState({ id: 2000 });
    harness.reviewComments.push(currentHeadInlineFinding(3001));
    harness.reviewThreads.push(unresolvedThread(3001));
    const comment = codexCleanComment(2001);
    harness.issueComments.push(comment);
    harness.nextCommentId = 2002;
    harness.routeFaults[
      `PATCH /repos/${harness.owner}/${harness.repo}/issues/comments/1000`
    ] = Array.from({ length: 4 }, () => ({
      status: 503,
      body: { message: "definite state update failure" },
      headers: { "Retry-After": "0" },
    }));
    harness.routeFaults[
      `POST /repos/${harness.owner}/${harness.repo}/issues/${harness.prNumber}/comments`
    ] = [{
      status: 503,
      body: { message: "definite replacement state failure" },
      headers: { "Retry-After": "0" },
    }];
    harness.routeFaults[
      `PATCH /repos/${harness.owner}/${harness.repo}/issues/comments/2000`
    ] = Array.from({ length: 4 }, () => ({
      status: 503,
      body: { message: "definite marker fence failure" },
      headers: { "Retry-After": "0" },
    }));

    const firstResult = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment,
      },
      env: { FAILED_FINDINGS_RECOVERY_MODE: "fresh" },
    });

    assert.equal(firstResult.code, 1);
    assert.equal(harness.statuses.at(-1).body.state, "error");
    assert.equal(
      harness.statuses.at(-1).body.description,
      "Authorization state persistence failed; fresh marker required",
    );
    assert.match(firstResult.stderr, /durable marker-lineage fence failed/);
    assert.equal(
      parseMarkerCommentBody(harness.findMarkerComments().at(-1).body)
        .baseline.authorizationFence,
      undefined,
    );
    assert.equal(
      parseStateCommentBody(harness.findStateComment().body)
        .history.at(-1).rejectedRecoveryCompletions,
      undefined,
    );
  });
});

test("failed-findings recovery requires the trigger to match the selected clean", async () => {
  await withHarness(async (harness) => {
    harness.seedFailedFindingsState({ id: 2000 });
    harness.reviewComments.push(currentHeadInlineFinding(3001));
    harness.reviewThreads.push({
      id: "thread-3001",
      isResolved: false,
      isOutdated: false,
      comments: { nodes: [graphqlReviewCommentIdentity(3001)] },
    });
    const earlierComment = codexCleanComment(2001, "2026-05-14T09:59:00Z");
    const blockedComment = codexCleanComment(2002, "2026-05-14T10:00:00Z");
    harness.issueComments.push(earlierComment, blockedComment);

    const firstResult = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: blockedComment,
      },
      env: { FAILED_FINDINGS_RECOVERY_MODE: "fresh" },
    });

    assert.equal(firstResult.code, 0, firstResult.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "failure");
    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.history.at(-1).rejectedRecoveryCompletions.at(-1).id, "2002");

    harness.reviewThreads[0].isResolved = true;
    const statusCount = harness.statuses.length;
    const secondResult = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: earlierComment,
      },
      env: { FAILED_FINDINGS_RECOVERY_MODE: "fresh" },
    });

    assert.equal(secondResult.code, 0, secondResult.stderr);
    assert.equal(harness.statuses.length, statusCount);
    assert.equal(harness.statuses.at(-1).body.state, "failure");
  });
});

test("fresh recovery requires a clean newer than the rejected cutoff", async () => {
  await withHarness(async (harness) => {
    harness.seedFailedFindingsState({
      id: 2000,
      rejectedRecoveryCompletions: [
        {
          id: "2002",
          createdAt: "2026-05-14T10:00:00Z",
          rejectedAt: "2026-05-14T10:01:00.000Z",
        },
      ],
    });
    const earlierComment = codexCleanComment(2001, "2026-05-14T09:59:00Z");
    harness.issueComments.push(earlierComment);

    const result = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: earlierComment,
      },
      env: { FAILED_FINDINGS_RECOVERY_MODE: "fresh" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    assert.equal(parseStateCommentBody(harness.findStateComment().body).lastStatus.state, "pending");
  });
});

test("issue_comment clean completion recovery in fresh mode accepts a new clean signal", async () => {
  await withHarness(async (harness) => {
    harness.seedFailedFindingsState({ id: 2000 });
    harness.reviewComments.push(currentHeadInlineFinding(3001));
    harness.reviewThreads.push({
      id: "thread-3001",
      isResolved: false,
      isOutdated: false,
      comments: { nodes: [graphqlReviewCommentIdentity(3001)] },
    });
    const oldComment = codexCleanComment(2001);
    harness.issueComments.push(oldComment);

    const firstResult = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: oldComment,
      },
      env: { FAILED_FINDINGS_RECOVERY_MODE: "fresh" },
    });

    assert.equal(firstResult.code, 0, firstResult.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "failure");

    harness.reviewThreads[0].isResolved = true;
    const newComment = codexCleanComment(2002, "2026-05-14T10:05:00Z");
    harness.issueComments.push(newComment);
    const secondResult = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: newComment,
      },
      env: { FAILED_FINDINGS_RECOVERY_MODE: "fresh" },
    });

    assert.equal(secondResult.code, 0, secondResult.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "success");
  });
});

test("fresh recovery records its rejected cutoff when final validation adds findings", async () => {
  await withHarness(async (harness) => {
    harness.seedFailedFindingsState({ id: 2000 });
    const comment = codexCleanComment(2001);
    harness.issueComments.push(comment);
    harness.afterPullLoad(2, {
      action: "pushReviewComment",
      value: currentHeadInlineFinding(3001),
    });
    harness.afterPullLoad(2, {
      action: "pushReviewThread",
      value: unresolvedThread(3001),
    });

    const result = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment,
      },
      env: { FAILED_FINDINGS_RECOVERY_MODE: "fresh" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "failure");
    const state = parseStateCommentBody(harness.findStateComment().body);
    const failedMarker = state.history.at(-1);
    assert.equal(failedMarker.outcome, "failed_findings");
    assert.equal(failedMarker.rejectedRecoveryCompletions.at(-1).id, "2001");
    assert.equal(failedMarker.latestRejectedRecoveryAt, "2026-05-14T10:01:00.000Z");
  });
});

test("missing or edited clean completion cannot recover failed findings", async () => {
  await withHarness(async (harness) => {
    harness.seedFailedFindingsState({ id: 2000 });
    const eventComment = codexCleanComment(2001);

    const deletedResult = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: eventComment,
      },
    });

    assert.equal(deletedResult.code, 0, deletedResult.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    assert.equal(parseStateCommentBody(harness.findStateComment().body).lastStatus.state, "pending");
  });

  await withHarness(async (harness) => {
    harness.seedFailedFindingsState({ id: 2000 });
    const eventComment = codexCleanComment(2001);
    harness.issueComments.push({
      ...eventComment,
      body: "Codex Review in progress",
    });

    const editedResult = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: eventComment,
      },
    });

    assert.equal(editedResult.code, 0, editedResult.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    assert.equal(parseStateCommentBody(harness.findStateComment().body).lastStatus.state, "pending");
  });
});

test("failed-findings recovery requires its trusted live marker lineage", async () => {
  for (const markerMutation of ["deleted", "tampered"]) {
    await withHarness(async (harness) => {
      harness.seedFailedFindingsState({ id: 2000 });
      const marker = harness.findMarkerComments().find((comment) => comment.id === 2000);
      if (markerMutation === "deleted") {
        harness.issueComments = harness.issueComments.filter((comment) => comment.id !== 2000);
      } else {
        marker.body = marker.body.replace(HEAD_SHA, OLD_HEAD_SHA);
      }
      const comment = codexCleanComment(2001);
      harness.issueComments.push(comment);

      const result = await harness.runGate({
        eventName: "issue_comment",
        event: {
          issue: { number: 1, pull_request: {} },
          comment,
        },
      });

      assert.equal(result.code, 0, result.stderr);
      assert.equal(successStatusWrites(harness), 0);
      assert.notEqual(harness.statuses.at(-1)?.body.state, "success");
      const state = parseStateCommentBody(harness.findStateComment().body);
      assert.notEqual(state.lastStatus.state, "success");
    });
  }
});

test("fresh recovery mode input takes precedence over the legacy environment value", async () => {
  await withHarness(async (harness) => {
    harness.seedFailedFindingsState({ id: 2000 });
    harness.reviewComments.push(currentHeadInlineFinding(3001));
    harness.reviewThreads.push({
      id: "thread-3001",
      isResolved: false,
      isOutdated: false,
      comments: { nodes: [graphqlReviewCommentIdentity(3001)] },
    });
    const comment = codexCleanComment(2001);
    harness.issueComments.push(comment);

    const firstResult = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment,
      },
      env: {
        FAILED_FINDINGS_RECOVERY_MODE_INPUT: "fresh",
        FAILED_FINDINGS_RECOVERY_MODE: "head",
      },
    });

    assert.equal(firstResult.code, 0, firstResult.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "failure");

    harness.reviewThreads[0].isResolved = true;
    const statusCount = harness.statuses.length;
    const secondResult = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment,
      },
      env: {
        FAILED_FINDINGS_RECOVERY_MODE_INPUT: "fresh",
        FAILED_FINDINGS_RECOVERY_MODE: "head",
      },
    });

    assert.equal(secondResult.code, 0, secondResult.stderr);
    assert.equal(harness.statuses.length, statusCount);
    assert.equal(harness.statuses.at(-1).body.state, "failure");
  });
});

test("failed-findings recovery requires a clean strictly newer than marker close", async () => {
  await withHarness(async (harness) => {
    harness.seedFailedFindingsState({ id: 2000, closedAt: "2026-05-14T10:00:00Z" });
    const comment = codexCleanComment(2001, "2026-05-14T10:00:00Z");
    harness.issueComments.push(comment);

    const result = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment,
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "pending");

    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.lastStatus.state, "pending");
  });
});

test("no-marker clean cannot recover disallowed history", async () => {
  await withHarness(async (harness) => {
    harness.seedFailedFindingsState({ id: 2000 });
    const nonCompletion = {
      ...codexCleanComment(2001),
      body: "@codex review",
    };
    harness.issueComments.push(nonCompletion);

    const nonCompletionResult = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: nonCompletion,
      },
    });

    assert.equal(nonCompletionResult.code, 0, nonCompletionResult.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
  });

  await withHarness(async (harness) => {
    harness.seedFailedFindingsState({ id: 2000, outcome: "state_lost" });
    const comment = codexCleanComment(2001);
    harness.issueComments.push(comment);

    const result = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment,
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    assert.equal(
      parseStateCommentBody(harness.findStateComment().body).lastStatus.state,
      "pending",
    );
  });
});

test("issue_comment recovery ignores non-Codex comments", async () => {
  await withHarness(async (harness) => {
    harness.seedFailedFindingsState({ id: 2000 });
    const comment = {
      ...codexCleanComment(2001),
      user: { login: "octocat" },
    };
    harness.issueComments.push(comment);

    const result = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment,
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.length, 0);
  });
});

test("unknown COMMENTED Codex review fails closed instead of acknowledging a marker", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    harness.reviews.push({
      id: 4001,
      state: "COMMENTED",
      commit_id: HEAD_SHA,
      submitted_at: "2026-05-14T09:57:00Z",
      body: "No inline findings in the review body.",
      user: codexBotUser(),
    });

    const result = await harness.runGate({
      eventName: "pull_request_review",
      event: {
        pull_request: { number: 1 },
        review: { user: { login: "chatgpt-codex-connector[bot]" } },
      },
    });

    assert.equal(result.code, 1, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "error");
    assert.match(result.stderr, /unrecognized Codex terminal pull-request-review format/);
  });
});

test("only validated Codex Bot inline children can identify a COMMENTED parent", async () => {
  const invalidAuthors = [
    [
      "human",
      { login: "octocat", type: "User" },
      /unrecognized Codex terminal pull-request-review format/,
    ],
    [
      "unrelated Bot",
      { login: "dependabot[bot]", type: "Bot" },
      /unrecognized Codex terminal pull-request-review format/,
    ],
    [
      "configured Codex login without Bot type",
      { login: "chatgpt-codex-connector[bot]", type: "User" },
      /review comment 3001 author is not a Bot/,
    ],
  ];

  for (const [authorLabel, user, expectedError] of invalidAuthors) {
    await withHarness(async (harness) => {
      seedCleanActiveMarker(harness);
      harness.reviews.push({
        id: 9100,
        state: "COMMENTED",
        commit_id: HEAD_SHA,
        submitted_at: "2026-05-14T10:00:01Z",
        body: "Discussion without a Codex terminal review body.",
        user: codexBotUser(),
      });
      harness.reviewComments.push({
        ...currentHeadInlineFinding(3001),
        pull_request_review_id: 9100,
        user,
      });
      harness.reviewThreads.push(unresolvedThread(3001));

      const result = await harness.runGate({
        eventName: "workflow_dispatch",
        event: { inputs: { pull_request: "1" } },
        env: { PR_NUMBER: "1" },
      });

      assert.equal(result.code, 1, `${authorLabel}: ${result.stderr}`);
      assert.equal(successStatusWrites(harness), 0, authorLabel);
      assert.equal(harness.statuses.at(-1).body.state, "error", authorLabel);
      assert.match(result.stderr, expectedError, authorLabel);
    });
  }
});

test("a fully reconciled Codex inline child identifies its COMMENTED parent", async () => {
  await withHarness(async (harness) => {
    seedCleanActiveMarker(harness);
    harness.reviews.push({
      id: 9100,
      state: "COMMENTED",
      commit_id: HEAD_SHA,
      submitted_at: "2026-05-14T10:00:01Z",
      body: " \n\t ",
      user: codexBotUser(),
    });
    harness.reviewComments.push({
      ...currentHeadInlineFinding(3001),
      pull_request_review_id: 9100,
    });
    harness.reviewThreads.push(unresolvedThread(3001));

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.snapshotLoads, 1);
    assert.equal(successStatusWrites(harness), 0);
    assert.equal(harness.statuses.at(-1).body.state, "failure");
    assert.equal(
      parseStateCommentBody(harness.findStateComment().body).history.at(-1).outcome,
      "failed_findings",
    );
  });
});

test("the official COMMENTED wrapper delegates findings to reconciled inline children", async () => {
  await withHarness(async (harness) => {
    seedCleanActiveMarker(harness);
    harness.reviews.push({
      id: 9100,
      state: "COMMENTED",
      commit_id: HEAD_SHA,
      submitted_at: "2026-05-14T10:00:01Z",
      body: codexInlineParentReviewBody(),
      user: codexBotUser(),
    });
    harness.reviewComments.push({
      ...currentHeadInlineFinding(3001),
      pull_request_review_id: 9100,
      body: "Finding without a GitHub blob link.",
    });
    harness.reviewThreads.push(unresolvedThread(3001));

    const result = await harness.runGate({
      eventName: "pull_request_review",
      event: {
        pull_request: { number: 1 },
        review: { user: { login: "chatgpt-codex-connector[bot]" } },
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "failure");
    assert.equal(
      parseStateCommentBody(harness.findStateComment().body).history.at(-1).outcome,
      "failed_findings",
    );
  });
});

test("a resolved inline child lets an earlier clean coexist with its official parent wrapper", async () => {
  await withHarness(async (harness) => {
    seedCleanActiveMarker(harness);
    harness.reviews.push({
      id: 9100,
      state: "COMMENTED",
      commit_id: HEAD_SHA,
      submitted_at: "2026-05-14T10:00:01Z",
      body: codexInlineParentReviewBody(),
      user: codexBotUser(),
    });
    harness.reviewComments.push({
      ...currentHeadInlineFinding(3001),
      pull_request_review_id: 9100,
      body: "Resolved finding without a GitHub blob link.",
    });
    harness.reviewThreads.push(unresolvedThread(3001, { resolved: true }));

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "success");
  });
});

test("a resolved inline child does not hide a newer unknown nonempty COMMENTED body", async () => {
  await withHarness(async (harness) => {
    seedCleanActiveMarker(harness);
    harness.reviews.push({
      id: 9100,
      state: "COMMENTED",
      commit_id: HEAD_SHA,
      submitted_at: "2026-05-14T10:00:01Z",
      body: "Unknown nonempty parent review body.",
      user: codexBotUser(),
    });
    harness.reviewComments.push({
      ...currentHeadInlineFinding(3001),
      pull_request_review_id: 9100,
    });
    harness.reviewThreads.push(unresolvedThread(3001, { resolved: true }));

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(successStatusWrites(harness), 0);
    assert.equal(harness.statuses.at(-1).body.state, "error");
    assert.match(result.stderr, /unrecognized Codex terminal pull-request-review format/);
  });
});

test("an official COMMENTED wrapper without an inline child reloads once then fails closed", async () => {
  await withHarness(async (harness) => {
    harness.reviews.push({
      id: 9100,
      state: "COMMENTED",
      commit_id: HEAD_SHA,
      submitted_at: "2026-05-14T10:00:01Z",
      body: codexInlineParentReviewBody(),
      user: codexBotUser(),
    });

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(harness.snapshotLoads, 2);
    assert.equal(successStatusWrites(harness), 0);
    assert.equal(harness.statuses.at(-1).body.state, "error");
    assert.match(
      result.stderr,
      /Codex finding must contain only exact full-SHA github\.com blob links/,
    );
  });
});

test("a persistent REST-only child keeps its official parent wrapper pending", async () => {
  await withHarness(async (harness) => {
    harness.reviews.push({
      id: 9100,
      state: "COMMENTED",
      commit_id: HEAD_SHA,
      submitted_at: "2026-05-14T10:00:01Z",
      body: codexInlineParentReviewBody(),
      user: codexBotUser(),
    });
    harness.reviewComments.push({
      ...currentHeadInlineFinding(3001),
      pull_request_review_id: 9100,
    });

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(harness.snapshotLoads, 2);
    assert.equal(successStatusWrites(harness), 0);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    assert.match(result.stderr, /remained incomplete after a bounded whole-snapshot reload/);
    assert.doesNotMatch(
      result.stderr,
      /Codex finding must contain only exact full-SHA github\.com blob links/,
    );
  });
});

test("a persistent GraphQL-only child keeps its official parent wrapper pending", async () => {
  await withHarness(async (harness) => {
    harness.reviews.push({
      id: 9100,
      state: "COMMENTED",
      commit_id: HEAD_SHA,
      submitted_at: "2026-05-14T10:00:01Z",
      body: codexInlineParentReviewBody(),
      user: codexBotUser(),
    });
    harness.reviewThreads.push(unresolvedThread(3001));

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(harness.snapshotLoads, 2);
    assert.equal(successStatusWrites(harness), 0);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    assert.match(result.stderr, /remained incomplete after a bounded whole-snapshot reload/);
    assert.doesNotMatch(
      result.stderr,
      /Codex finding must contain only exact full-SHA github\.com blob links/,
    );
  });
});

test("eyes reaction acknowledges marker and moves WaitingAck to WaitingResult", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    harness.commentReactions.set("2000", [
      {
        id: 5001,
        content: "eyes",
        created_at: "2026-05-14T09:57:00Z",
        user: { login: "chatgpt-codex-connector[bot]" },
      },
    ]);

    const result = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(result.code, 0, `${result.stderr}\n${result.stdout}`);
    assert.equal(harness.statuses.at(-1).body.state, "pending");

    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.activeMarker.state, "waiting_result");
    assert.equal(state.activeMarker.observedEyes.id, "5001");
    assert.equal(
      harness.requestLog.filter((entry) =>
        entry.method === "GET" &&
          entry.path.endsWith(`/issues/${harness.prNumber}/comments`),
      ).length,
      1,
    );
  });
});

test("current-head Codex findings close the active marker as failed_findings", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    harness.reviewComments.push(currentHeadInlineFinding(3001));
    harness.reviewThreads.push(unresolvedThread(3001));

    const result = await harness.runGate({
      eventName: "pull_request_review_comment",
      event: {
        pull_request: { number: 1 },
        comment: { user: { login: "chatgpt-codex-connector[bot]" } },
      },
      env: { EVENT_MODE_INPUT: "full" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "failure");

    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.activeMarker, null);
    assert.equal(state.lastStatus.state, "failure");
    assert.equal(state.history.at(-1).outcome, "failed_findings");
  });
});

test("thousands of findings persist bounded audit state and a durable failure", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    const findingCount = 4_000;
    for (let index = 0; index < findingCount; index += 1) {
      const id = 10_000 + index;
      harness.reviewComments.push(currentHeadInlineFinding(id));
      harness.reviewThreads.push(unresolvedThread(id));
    }

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "failure");
    assert.equal(harness.findMarkerComments().length, 1);
    const stateComment = harness.findStateComment();
    assert.equal(
      Buffer.byteLength(stateComment.body, "utf8") <= MAX_STATE_COMMENT_BYTES,
      true,
    );
    assert.equal(stateComment.body.includes('"currentHeadFindingIds"'), false);

    const state = parseStateCommentBody(stateComment.body);
    const findingSummary = state.history.at(-1).currentHeadFindings;
    assert.equal(state.activeMarker, null);
    assert.equal(state.lastStatus.state, "failure");
    assert.equal(state.history.at(-1).outcome, "failed_findings");
    assert.equal(findingSummary.count, findingCount);
    assert.equal(findingSummary.sampleIds.length, MAX_FINDING_ID_SAMPLES);
    assert.match(findingSummary.idDigest, /^sha256:[0-9a-f]{64}$/);
  });
});

test("scheduled scan retries missed acknowledgement with same-head backoff", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:50:00Z",
      ackDeadlineAt: "2026-05-14T09:55:00Z",
      nextRetryAt: "2026-05-14T09:55:00Z",
      maxWaitDeadlineAt: "2026-05-14T11:50:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
      history: [
        {
          id: "1999",
          headSha: HEAD_SHA,
          outcome: "missed_ack",
          state: "missed_ack",
          closedAt: "2026-05-14T09:40:00Z",
        },
      ],
    });

    const result = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "pending");

    const markerComments = harness.findMarkerComments();
    assert.equal(markerComments.length, 2);
    const newMarker = parseMarkerCommentBody(markerComments.at(-1).body);
    assert.equal(newMarker.headSha, HEAD_SHA);
    assert.equal(newMarker.ackTimeoutSeconds, 1200);

    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.history.at(-1).outcome, "missed_ack");
    assert.equal(state.activeMarker.id, String(markerComments.at(-1).id));
    assert.equal(state.activeMarker.ackTimeoutSeconds, 1200);
    assert.equal(state.activeMarker.headStartedAt, "2026-05-14T09:50:00Z");
    assert.equal(state.activeMarker.maxWaitDeadlineAt, "2026-05-14T11:50:00Z");
  });
});

test("scheduled scan retries stalled WaitingResult markers", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: HEAD_SHA,
      state: "waiting_result",
      createdAt: "2026-05-14T08:50:00Z",
      resultDeadlineAt: "2026-05-14T09:50:00Z",
      nextRetryAt: "2026-05-14T09:50:00Z",
      maxWaitDeadlineAt: "2026-05-14T10:50:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });

    const result = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(result.code, 0, result.stderr);

    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.history.at(-1).outcome, "stalled");
    assert.equal(state.activeMarker.state, "waiting_ack");
    assert.equal(state.activeMarker.headStartedAt, "2026-05-14T08:50:00Z");
    assert.equal(state.activeMarker.maxWaitDeadlineAt, "2026-05-14T10:50:00Z");
    assert.equal(harness.statuses.at(-1).body.state, "pending");
  });
});

test("history-only retries at the max-wait deadline fail closed without another marker", async (t) => {
  for (const outcome of ["missed_ack", "stalled"]) {
    await t.test(outcome, async () => {
      await withHarness(async (harness) => {
        harness.seedHistoryOnlyRetryState({
          id: 2000,
          outcome,
          headStartedAt: "2026-05-14T08:01:00Z",
          maxWaitDeadlineAt: "2026-05-14T10:01:00Z",
        });

        const result = await harness.runGate({
          eventName: "schedule",
          event: {},
        });

        assert.equal(result.code, 0, result.stderr);
        assert.equal(harness.findMarkerComments().length, 1);
        assert.equal(markerCommentWrites(harness), 0);
        assert.equal(harness.statuses.at(-1).body.state, "failure");

        let state = parseStateCommentBody(harness.findStateComment().body);
        assert.equal(state.activeMarker, null);
        assert.equal(state.lastStatus.state, "failure");
        assert.equal(state.history.at(-2).outcome, outcome);
        assert.equal(state.history.at(-1).outcome, "timed_out");
        assert.equal(state.history.at(-1).headStartedAt, "2026-05-14T08:01:00Z");
        assert.equal(state.history.at(-1).maxWaitDeadlineAt, "2026-05-14T10:01:00Z");
        assert.equal(state.history.at(-1).timedOutAfterSeconds, 7200);

        const timedOutEntries = state.history.filter(
          (marker) => marker.headSha === HEAD_SHA && marker.outcome === "timed_out",
        ).length;
        const secondResult = await harness.runGate({
          eventName: "schedule",
          event: {},
        });

        assert.equal(secondResult.code, 0, secondResult.stderr);
        assert.equal(harness.findMarkerComments().length, 1);
        assert.equal(markerCommentWrites(harness), 0);
        state = parseStateCommentBody(harness.findStateComment().body);
        assert.equal(state.lastStatus.state, "failure");
        assert.equal(
          state.history.filter(
            (marker) => marker.headSha === HEAD_SHA && marker.outcome === "timed_out",
          ).length,
          timedOutEntries,
        );
      });
    });
  }
});

test("late clean from each closed wait outcome passes for issue comments and reviews", async (t) => {
  for (const outcome of ["timed_out", "missed_ack", "stalled"]) {
    for (const source of ["issue-comment", "pull-request-review"]) {
      await t.test(`${outcome} ${source}`, async () => {
        await withHarness(async (harness) => {
          harness.seedHistoryOnlyRetryState({
            id: 2000,
            outcome,
            closedAt: "2026-05-14T10:00:30Z",
            headStartedAt: "2026-05-14T08:01:00Z",
            maxWaitDeadlineAt: "2026-05-14T10:01:00Z",
          });
          if (source === "issue-comment") {
            harness.issueComments.push(
              codexCleanComment(2001, "2026-05-14T10:00:00Z"),
            );
          } else {
            harness.reviews.push(
              codexApprovedReview(4001, "2026-05-14T10:00:00Z"),
            );
          }

          const result = await harness.runGate({
            eventName: "schedule",
            event: {},
          });

          assert.equal(result.code, 0, result.stderr);
          assert.equal(successStatusWrites(harness), 1);
          assert.equal(markerCommentWrites(harness), 0);
          assert.equal(harness.findMarkerComments().length, 1);
          const state = parseStateCommentBody(harness.findStateComment().body);
          assert.equal(state.activeMarker, null);
          assert.equal(state.lastStatus.state, "success");
          assert.equal(state.history.at(-2).outcome, outcome);
          assert.equal(state.history.at(-1).outcome, "passed");
          assert.equal(state.history.at(-1).reconciledFromOutcome, outcome);
          assert.equal(
            state.history.at(-1).observedProviderResult.source,
            source,
          );
        });
      });
    }
  }
});

test("a late clean recovers a timeout persisted by the previous run", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:30:00Z",
      ackDeadlineAt: "2026-05-14T10:30:00Z",
      nextRetryAt: "2026-05-14T10:30:00Z",
      maxWaitDeadlineAt: "2026-05-14T10:01:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });

    const timeoutResult = await harness.runGate({
      eventName: "schedule",
      event: {},
    });
    assert.equal(timeoutResult.code, 0, timeoutResult.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "failure");
    assert.equal(
      parseStateCommentBody(harness.findStateComment().body).history.at(-1).outcome,
      "timed_out",
    );

    harness.issueComments.push(
      codexCleanComment(2001, "2026-05-14T10:00:00Z"),
    );
    const recoveryResult = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(recoveryResult.code, 0, recoveryResult.stderr);
    assert.equal(successStatusWrites(harness), 1);
    assert.equal(markerCommentWrites(harness), 0);
    assert.equal(harness.findMarkerComments().length, 1);
    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.activeMarker, null);
    assert.equal(state.lastStatus.state, "success");
    assert.equal(state.history.at(-2).outcome, "timed_out");
    assert.equal(state.history.at(-1).outcome, "passed");
    assert.equal(state.history.at(-1).reconciledFromOutcome, "timed_out");
    assert.equal(state.history.at(-1).observedProviderResult.id, "2001");
  });
});

test("closed-wait late clean reasserts from canonical passed history", async () => {
  await withHarness(async (harness) => {
    harness.seedHistoryOnlyRetryState({
      id: 2000,
      outcome: "timed_out",
      closedAt: "2026-05-14T10:00:30Z",
      headStartedAt: "2026-05-14T08:01:00Z",
      maxWaitDeadlineAt: "2026-05-14T10:01:00Z",
    });
    harness.issueComments.push(
      codexCleanComment(2001, "2026-05-14T10:00:00Z"),
    );

    const firstResult = await harness.runGate({
      eventName: "schedule",
      event: {},
    });
    assert.equal(firstResult.code, 0, firstResult.stderr);
    const firstState = parseStateCommentBody(harness.findStateComment().body);
    const firstHistoryLength = firstState.history.length;
    assert.equal(firstState.history.at(-2).outcome, "timed_out");
    assert.equal(firstState.history.at(-1).outcome, "passed");
    assert.equal(firstState.history.at(-1).observedProviderResult.id, "2001");

    harness.commitStatuses = {
      [HEAD_SHA]: [{
        sha: HEAD_SHA,
        context: "codex/review-gate",
        state: "error",
        description: "Newer live error requires exact evidence reassertion",
      }],
    };
    const snapshotLoadsBeforeReassert = harness.snapshotLoads;
    const successWritesBeforeReassert = successStatusWrites(harness);
    const secondResult = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(secondResult.code, 0, secondResult.stderr);
    assert.equal(harness.snapshotLoads - snapshotLoadsBeforeReassert, 2);
    assert.equal(
      successStatusWrites(harness),
      successWritesBeforeReassert + 1,
    );
    assert.equal(markerCommentWrites(harness), 0);
    const secondState = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(secondState.history.length, firstHistoryLength);
    assert.equal(secondState.history.at(-2).outcome, "timed_out");
    assert.equal(secondState.history.at(-1).outcome, "passed");
    assert.equal(secondState.lastStatus.state, "success");
  });
});

test("closed-wait authorization requires the exact trusted live marker", async (t) => {
  for (const mutation of ["missing", "lineage", "baseline"]) {
    await t.test(mutation, async () => {
      await withHarness(async (harness) => {
        harness.seedHistoryOnlyRetryState({
          id: 2000,
          outcome: "timed_out",
          headStartedAt: "2026-05-14T09:00:00Z",
          maxWaitDeadlineAt: "2026-05-14T11:00:00Z",
        });
        const liveComment = harness.findMarkerComments()[0];
        if (mutation === "missing") {
          harness.issueComments = harness.issueComments.filter(
            (comment) => comment.id !== liveComment.id,
          );
        } else {
          const liveMarker = parseMarkerCommentBody(liveComment.body);
          const mutatedMarker = {
            ...liveMarker,
            id: String(liveComment.id),
            url: liveComment.html_url,
            createdAt: liveComment.created_at,
            ...(mutation === "lineage" ? { runId: "forged-run" } : {}),
            ...(mutation === "baseline"
              ? {
                  baseline: {
                    ...liveMarker.baseline,
                    completionComment: {
                      id: "1999",
                      createdAt: "2026-05-14T09:54:00Z",
                    },
                  },
                }
              : {}),
          };
          Object.assign(liveComment, markerCommentFor(mutatedMarker));
        }
        harness.issueComments.push(codexCleanComment(2001));

        const result = await harness.runGate({
          eventName: "schedule",
          event: {},
        });

        assert.equal(result.code, 0, result.stderr);
        assert.equal(successStatusWrites(harness), 0);
        assert.equal(markerCommentWrites(harness), 0);
        const state = parseStateCommentBody(harness.findStateComment().body);
        assert.notEqual(state.lastStatus.state, "success");
        assert.equal(state.history.at(-1).outcome, "timed_out");
      });
    });
  }
});

test("closed-wait authorization rejects baseline provider replays", async (t) => {
  for (const source of ["issue-comment", "pull-request-review"]) {
    await t.test(source, async () => {
      await withHarness(async (harness) => {
        const issueComment = codexCleanComment(1999, "2026-05-14T09:54:00Z");
        const approvedReview = codexApprovedReview(3999, "2026-05-14T09:54:00Z");
        harness.seedHistoryOnlyRetryState({
          id: 2000,
          outcome: "timed_out",
          headStartedAt: "2026-05-14T09:00:00Z",
          maxWaitDeadlineAt: "2026-05-14T11:00:00Z",
          baseline: {
            plusOne: null,
            eyes: null,
            completionComment:
              source === "issue-comment"
                ? {
                    id: String(issueComment.id),
                    createdAt: issueComment.created_at,
                    user: issueComment.user.login,
                    url: issueComment.html_url,
                  }
                : null,
            approvedReview:
              source === "pull-request-review"
                ? {
                    id: String(approvedReview.id),
                    state: approvedReview.state,
                    commitId: approvedReview.commit_id,
                    submittedAt: approvedReview.submitted_at,
                    user: approvedReview.user.login,
                  }
                : null,
            submittedReview: null,
          },
        });
        if (source === "issue-comment") {
          harness.issueComments.push(issueComment);
        } else {
          harness.reviews.push(approvedReview);
        }

        const result = await harness.runGate({
          eventName: "schedule",
          event: {},
        });

        assert.equal(result.code, 0, result.stderr);
        assert.equal(successStatusWrites(harness), 0);
        assert.equal(markerCommentWrites(harness), 0);
        const state = parseStateCommentBody(harness.findStateComment().body);
        assert.notEqual(state.lastStatus.state, "success");
        assert.equal(state.history.at(-1).outcome, "timed_out");
      });
    });
  }
});

test("closed-wait authorization does not bypass non-wait outcomes", async (t) => {
  for (const outcome of ["passed", "failed_findings", "state_lost", "obsolete_head"]) {
    await t.test(outcome, async () => {
      await withHarness(async (harness) => {
        harness.seedFailedFindingsState({ id: 2000, outcome });
        harness.reviews.push(codexApprovedReview(4001));

        const result = await harness.runGate({
          eventName: "workflow_dispatch",
          event: { inputs: { pull_request: "1" } },
          env: { PR_NUMBER: "1" },
        });

        assert.equal(result.code, 0, result.stderr);
        assert.equal(successStatusWrites(harness), 0);
        const state = parseStateCommentBody(harness.findStateComment().body);
        assert.notEqual(state.lastStatus.state, "success");
        assert.equal(
          state.history.some((marker) =>
            (marker.outcome || marker.state) === outcome
          ),
          true,
        );
      });
    });
  }
});

test("failed-findings lineage cannot become closed-wait authorization through timeout", async () => {
  await withHarness(async (harness) => {
    harness.seedFailedFindingsState({
      id: 2000,
      maxWaitDeadlineAt: "2026-05-14T10:01:00Z",
    });

    const timeoutResult = await harness.runGate({
      eventName: "schedule",
      event: {},
      env: { FAILED_FINDINGS_RECOVERY: "false" },
    });
    assert.equal(timeoutResult.code, 0, timeoutResult.stderr);
    let state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.history.at(-2).outcome, "failed_findings");
    assert.equal(state.history.at(-1).outcome, "timed_out");
    assert.equal(state.history.at(-1).timedOutFromOutcome, "failed_findings");

    harness.issueComments.push(codexCleanComment(2001));
    const recoveryResult = await harness.runGate({
      eventName: "schedule",
      event: {},
      env: { FAILED_FINDINGS_RECOVERY: "false" },
    });

    assert.equal(recoveryResult.code, 0, recoveryResult.stderr);
    assert.equal(successStatusWrites(harness), 0);
    assert.equal(harness.statuses.at(-1).body.state, "failure");
    assert.equal(markerCommentWrites(harness), 0);
    state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.lastStatus.state, "failure");
    assert.equal(state.history.at(-2).outcome, "failed_findings");
    assert.equal(state.history.at(-1).outcome, "timed_out");
  });
});

test("legacy failed-findings timeout audit cannot authorize late clean", async () => {
  await withHarness(async (harness) => {
    harness.seedHistoryOnlyRetryState({
      id: 2000,
      outcome: "timed_out",
      headStartedAt: "2026-05-14T09:00:00Z",
      maxWaitDeadlineAt: "2026-05-14T10:01:00Z",
    });
    const stateComment = harness.findStateComment();
    const state = parseStateCommentBody(stateComment.body);
    state.history.at(-1).currentHeadFindingIds = ["3001"];
    stateComment.body = stateCommentBody(state);
    harness.issueComments.push(codexCleanComment(2001));

    const result = await harness.runGate({
      eventName: "schedule",
      event: {},
      env: { FAILED_FINDINGS_RECOVERY: "false" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(successStatusWrites(harness), 0);
    assert.equal(harness.statuses.at(-1).body.state, "failure");
    assert.equal(markerCommentWrites(harness), 0);
    const finalState = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(finalState.lastStatus.state, "pending");
    assert.equal(finalState.history.at(-1).outcome, "timed_out");
  });
});

test("failed-findings recovery unwraps only exact timeout lineage", async (t) => {
  for (const lineage of ["explicit-provenance", "legacy-history"]) {
    await t.test(lineage, async () => {
      await withHarness(async (harness) => {
        harness.seedFailedFindingsState({
          id: 2000,
          maxWaitDeadlineAt: "2026-05-14T10:01:00Z",
        });

        const timeoutResult = await harness.runGate({
          eventName: "schedule",
          event: {},
        });
        assert.equal(timeoutResult.code, 0, timeoutResult.stderr);

        const stateComment = harness.findStateComment();
        const timedOutState = parseStateCommentBody(stateComment.body);
        assert.equal(timedOutState.history.at(-2).outcome, "failed_findings");
        assert.equal(timedOutState.history.at(-1).outcome, "timed_out");
        if (lineage === "explicit-provenance") {
          timedOutState.history = [timedOutState.history.at(-1)];
        } else {
          delete timedOutState.history.at(-1).timedOutFromOutcome;
          delete timedOutState.history.at(-1).timedOutFromMarker;
        }
        stateComment.body = stateCommentBody(timedOutState);

        const clean = codexCleanComment(2001, "2026-05-14T10:02:00Z");
        harness.issueComments.push(clean);
        const recoveryResult = await harness.runGate({
          eventName: "issue_comment",
          event: {
            issue: { number: 1, pull_request: {} },
            comment: clean,
          },
        });

        assert.equal(recoveryResult.code, 0, recoveryResult.stderr);
        assert.equal(successStatusWrites(harness), 1);
        assert.equal(
          parseStateCommentBody(harness.findStateComment().body).lastStatus.state,
          "success",
        );
      });
    });
  }
});

test("fresh rejection persists on explicit timeout lineage after history truncation", async () => {
  await withHarness(async (harness) => {
    harness.seedFailedFindingsState({
      id: 2000,
      maxWaitDeadlineAt: "2026-05-14T10:01:00Z",
    });

    const timeoutResult = await harness.runGate({
      eventName: "schedule",
      event: {},
    });
    assert.equal(timeoutResult.code, 0, timeoutResult.stderr);

    const stateComment = harness.findStateComment();
    const timedOutState = parseStateCommentBody(stateComment.body);
    timedOutState.history = [timedOutState.history.at(-1)];
    stateComment.body = stateCommentBody(timedOutState);

    const clean = codexCleanComment(2001, "2026-05-14T10:02:00Z");
    harness.issueComments.push(clean);
    harness.reviewComments.push(currentHeadInlineFinding(3001));
    harness.reviewThreads.push(unresolvedThread(3001));
    const firstResult = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: clean,
      },
      env: { FAILED_FINDINGS_RECOVERY_MODE: "fresh" },
    });

    assert.equal(firstResult.code, 0, firstResult.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "failure");
    let state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.history.length, 1);
    assert.equal(state.history[0].outcome, "timed_out");
    assert.equal(state.history[0].rejectedRecoveryCompletions.at(-1).id, "2001");
    assert.equal(
      state.history[0].latestRejectedRecoveryAt,
      "2026-05-14T10:01:00.000Z",
    );

    harness.reviewThreads[0].isResolved = true;
    const statusCount = harness.statuses.length;
    const replayResult = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: clean,
      },
      env: { FAILED_FINDINGS_RECOVERY_MODE: "fresh" },
    });

    assert.equal(replayResult.code, 0, replayResult.stderr);
    assert.equal(harness.statuses.length, statusCount);
    assert.equal(successStatusWrites(harness), 0);
    state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.lastStatus.state, "failure");
  });
});

test("failed-findings timeout recovery never crosses marker identity", async () => {
  await withHarness(async (harness) => {
    harness.seedFailedFindingsState({
      id: 2000,
      maxWaitDeadlineAt: "2026-05-14T10:01:00Z",
    });

    const timeoutResult = await harness.runGate({
      eventName: "schedule",
      event: {},
    });
    assert.equal(timeoutResult.code, 0, timeoutResult.stderr);

    const stateComment = harness.findStateComment();
    const state = parseStateCommentBody(stateComment.body);
    state.history.at(-1).id = "2001";
    stateComment.body = stateCommentBody(state);
    const clean = codexCleanComment(2002, "2026-05-14T10:02:00Z");
    harness.issueComments.push(clean);

    const recoveryResult = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: clean,
      },
    });

    assert.equal(recoveryResult.code, 0, recoveryResult.stderr);
    assert.equal(successStatusWrites(harness), 0);
    assert.notEqual(
      parseStateCommentBody(harness.findStateComment().body).lastStatus.state,
      "success",
    );
  });
});

test("legacy obsolete-head timeout audit cannot authorize late clean", async () => {
  await withHarness(async (harness) => {
    harness.seedHistoryOnlyRetryState({
      id: 2000,
      outcome: "timed_out",
      headStartedAt: "2026-05-14T09:00:00Z",
      maxWaitDeadlineAt: "2026-05-14T10:01:00Z",
    });
    const stateComment = harness.findStateComment();
    const state = parseStateCommentBody(stateComment.body);
    state.history.at(-1).currentHeadSha = NEW_HEAD_SHA;
    stateComment.body = stateCommentBody(state);
    harness.issueComments.push(codexCleanComment(2001));

    const result = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(successStatusWrites(harness), 0);
    assert.equal(markerCommentWrites(harness), 0);
    assert.notEqual(
      parseStateCommentBody(harness.findStateComment().body).lastStatus.state,
      "success",
    );
  });
});

test("closed-wait findings remain blocked when recovery is disabled", async () => {
  await withHarness(async (harness) => {
    harness.seedHistoryOnlyRetryState({
      id: 2000,
      outcome: "timed_out",
      headStartedAt: "2026-05-14T09:00:00Z",
      maxWaitDeadlineAt: "2026-05-14T11:00:00Z",
    });
    const clean = codexCleanComment(2001);
    harness.issueComments.push(clean);
    harness.reviewComments.push(currentHeadInlineFinding(3001));
    harness.reviewThreads.push(unresolvedThread(3001));

    const failedResult = await harness.runGate({
      eventName: "schedule",
      event: {},
      env: { FAILED_FINDINGS_RECOVERY: "false" },
    });

    assert.equal(failedResult.code, 0, failedResult.stderr);
    let state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.history.at(-2).outcome, "timed_out");
    assert.equal(state.history.at(-1).outcome, "failed_findings");
    assert.equal(state.history.at(-1).reconciledFromOutcome, "timed_out");
    assert.equal(state.history.at(-1).currentHeadFindings.count, 1);

    harness.reviewThreads[0].isResolved = true;
    const replayResult = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: clean,
      },
      env: { FAILED_FINDINGS_RECOVERY: "false" },
    });

    assert.equal(replayResult.code, 0, replayResult.stderr);
    assert.equal(successStatusWrites(harness), 0);
    state = parseStateCommentBody(harness.findStateComment().body);
    assert.notEqual(state.lastStatus.state, "success");
    assert.equal(state.history.at(-1).outcome, "failed_findings");
  });
});

test("closed-wait findings recovery keeps existing head and fresh semantics", async (t) => {
  for (const mode of ["head", "fresh"]) {
    await t.test(mode, async () => {
      await withHarness(async (harness) => {
        harness.seedHistoryOnlyRetryState({
          id: 2000,
          outcome: "stalled",
          headStartedAt: "2026-05-14T09:00:00Z",
          maxWaitDeadlineAt: "2026-05-14T11:00:00Z",
        });
        harness.issueComments.push(codexCleanComment(2001));
        harness.reviewComments.push(currentHeadInlineFinding(3001));
        harness.reviewThreads.push(unresolvedThread(3001));

        const failedResult = await harness.runGate({
          eventName: "schedule",
          event: {},
          env: { FAILED_FINDINGS_RECOVERY_MODE: mode },
        });
        assert.equal(failedResult.code, 0, failedResult.stderr);
        assert.equal(
          parseStateCommentBody(harness.findStateComment().body).history.at(-1).outcome,
          "failed_findings",
        );

        harness.reviewThreads[0].isResolved = true;
        const newerClean = codexCleanComment(2002, "2026-05-14T10:02:00Z");
        harness.issueComments.push(newerClean);
        const noTriggerResult = await harness.runGate({
          eventName: "schedule",
          event: {},
          env: { FAILED_FINDINGS_RECOVERY_MODE: mode },
        });
        assert.equal(noTriggerResult.code, 0, noTriggerResult.stderr);
        assert.equal(successStatusWrites(harness), 0);
        assert.equal(markerCommentWrites(harness), 0);

        const recoveryResult = await harness.runGate({
          eventName: "issue_comment",
          event: {
            issue: { number: 1, pull_request: {} },
            comment: newerClean,
          },
          env: { FAILED_FINDINGS_RECOVERY_MODE: mode },
        });

        assert.equal(recoveryResult.code, 0, recoveryResult.stderr);
        assert.equal(successStatusWrites(harness), 1);
        const state = parseStateCommentBody(harness.findStateComment().body);
        assert.equal(state.lastStatus.state, "success");
        assert.equal(state.history.at(-2).outcome, "stalled");
        assert.equal(state.history.at(-1).outcome, "failed_findings");
      });
    });
  }
});

test("pending provider findings synthesize failed lineage for every closed wait outcome", async (t) => {
  for (const outcome of ["timed_out", "missed_ack", "stalled"]) {
    await t.test(outcome, async () => {
      await withHarness(async (harness) => {
        harness.seedHistoryOnlyRetryState({
          id: 2000,
          outcome,
          headStartedAt: "2026-05-14T09:00:00Z",
          maxWaitDeadlineAt: "2026-05-14T11:00:00Z",
        });
        harness.reviewComments.push(currentHeadInlineFinding(3001));
        harness.reviewThreads.push(unresolvedThread(3001));

        const result = await harness.runGate({
          eventName: "schedule",
          event: {},
        });

        assert.equal(result.code, 0, result.stderr);
        assert.equal(harness.statuses.at(-1).body.state, "failure");
        assert.equal(markerCommentWrites(harness), 0);
        const state = parseStateCommentBody(harness.findStateComment().body);
        assert.equal(state.history.at(-2).outcome, outcome);
        assert.equal(state.history.at(-1).outcome, "failed_findings");
        assert.equal(state.history.at(-1).id, "2000");
        assert.equal(state.history.at(-1).reconciledFromOutcome, outcome);
        assert.equal(state.history.at(-1).currentHeadFindings.count, 1);
      });
    });
  }
});

test("unrecoverable retry markers create a fresh marker before failed findings", async (t) => {
  for (const outcome of ["missed_ack", "stalled"]) {
    for (const mutation of ["missing", "lineage", "baseline"]) {
      await t.test(`${outcome} ${mutation}`, async () => {
        await withHarness(async (harness) => {
          harness.seedHistoryOnlyRetryState({
            id: 2000,
            outcome,
            headStartedAt: "2026-05-14T09:00:00Z",
            maxWaitDeadlineAt: "2026-05-14T11:00:00Z",
          });
          const liveComment = harness.findMarkerComments()[0];
          if (mutation === "missing") {
            harness.issueComments = harness.issueComments.filter(
              (comment) => comment.id !== liveComment.id,
            );
          } else {
            const liveMarker = parseMarkerCommentBody(liveComment.body);
            Object.assign(liveComment, markerCommentFor({
              ...liveMarker,
              id: String(liveComment.id),
              url: liveComment.html_url,
              createdAt: liveComment.created_at,
              ...(mutation === "lineage" ? { runId: "forged-run" } : {}),
              ...(mutation === "baseline"
                ? {
                    baseline: {
                      ...liveMarker.baseline,
                      completionComment: {
                        id: "1999",
                        createdAt: "2026-05-14T09:54:00Z",
                      },
                    },
                  }
                : {}),
            }));
          }
          harness.reviewComments.push(currentHeadInlineFinding(3001));
          harness.reviewThreads.push(unresolvedThread(3001));

          const result = await harness.runGate({
            eventName: "schedule",
            event: {},
          });

          assert.equal(result.code, 0, result.stderr);
          assert.equal(harness.statuses.at(-1).body.state, "failure");
          assert.equal(markerCommentWrites(harness), 1);
          const freshMarkerComment = harness.findMarkerComments().at(-1);
          const state = parseStateCommentBody(harness.findStateComment().body);
          assert.equal(state.activeMarker, null);
          assert.equal(state.history.at(-2).outcome, outcome);
          assert.equal(state.history.at(-1).outcome, "failed_findings");
          assert.equal(state.history.at(-1).id, String(freshMarkerComment.id));
          assert.notEqual(state.history.at(-1).id, "2000");
          assert.equal(state.history.at(-1).reconciledFromOutcome, undefined);
          assert.equal(state.history.at(-1).currentHeadFindings.count, 1);
        });
      });
    }
  }
});

test("untrusted closed marker cannot synthesize failed-findings lineage", async (t) => {
  for (const mutation of ["missing", "lineage", "baseline"]) {
    await t.test(mutation, async () => {
      await withHarness(async (harness) => {
        harness.seedHistoryOnlyRetryState({
          id: 2000,
          outcome: "timed_out",
          headStartedAt: "2026-05-14T09:00:00Z",
          maxWaitDeadlineAt: "2026-05-14T11:00:00Z",
        });
        const liveComment = harness.findMarkerComments()[0];
        if (mutation === "missing") {
          harness.issueComments = harness.issueComments.filter(
            (comment) => comment.id !== liveComment.id,
          );
        } else {
          const liveMarker = parseMarkerCommentBody(liveComment.body);
          Object.assign(liveComment, markerCommentFor({
            ...liveMarker,
            id: String(liveComment.id),
            url: liveComment.html_url,
            createdAt: liveComment.created_at,
            ...(mutation === "lineage" ? { runId: "forged-run" } : {}),
            ...(mutation === "baseline"
              ? {
                  baseline: {
                    ...liveMarker.baseline,
                    completionComment: {
                      id: "1999",
                      createdAt: "2026-05-14T09:54:00Z",
                    },
                  },
                }
              : {}),
          }));
        }
        harness.reviewComments.push(currentHeadInlineFinding(3001));
        harness.reviewThreads.push(unresolvedThread(3001));

        const result = await harness.runGate({
          eventName: "schedule",
          event: {},
        });

        assert.equal(result.code, 0, result.stderr);
        assert.equal(harness.statuses.at(-1).body.state, "failure");
        const state = parseStateCommentBody(harness.findStateComment().body);
        assert.equal(
          state.history.some((marker) => marker.outcome === "failed_findings"),
          false,
        );
        assert.equal(state.history.at(-1).outcome, "timed_out");
      });
    });
  }
});

test("closed-wait success rejects a clean artifact swap on final reload", async () => {
  await withHarness(async (harness) => {
    harness.seedHistoryOnlyRetryState({
      id: 2000,
      outcome: "stalled",
      headStartedAt: "2026-05-14T09:00:00Z",
      maxWaitDeadlineAt: "2026-05-14T11:00:00Z",
    });
    harness.issueComments.push(codexCleanComment(2001));
    harness.afterSnapshotLoad(2, {
      action: "pushIssueComment",
      value: codexCleanComment(2002, "2026-05-14T10:00:30Z"),
    });

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(successStatusWrites(harness), 0);
    assert.equal(harness.statuses.at(-1).body.state, "error");
    assert.match(result.stderr, /not stable across final validation/);
    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.history.at(-1).outcome, "stalled");
  });
});

test("history-only retries inherit the exact wait deadline across config changes", async (t) => {
  for (const scenario of [
    { name: "increase", maxWaitSeconds: "14400" },
    { name: "decrease", maxWaitSeconds: "1800" },
  ]) {
    await t.test(scenario.name, async () => {
      await withHarness(async (harness) => {
        harness.seedHistoryOnlyRetryState({
          id: 2000,
          outcome: "missed_ack",
          headStartedAt: "2026-05-14T09:01:00Z",
          maxWaitDeadlineAt: "2026-05-14T11:01:00Z",
          trailingHistory: [{
            id: "old-head-marker",
            headSha: OLD_HEAD_SHA,
            state: "passed",
            outcome: "passed",
            headStartedAt: "2026-05-14T09:30:00Z",
            maxWaitDeadlineAt: "2026-05-14T13:30:00Z",
          }],
        });

        const result = await harness.runGate({
          eventName: "schedule",
          event: {},
          env: { MAX_WAIT_SECONDS: scenario.maxWaitSeconds },
        });

        assert.equal(result.code, 0, result.stderr);
        assert.equal(harness.findMarkerComments().length, 2);
        assert.equal(harness.statuses.at(-1).body.state, "pending");
        const state = parseStateCommentBody(harness.findStateComment().body);
        assert.equal(state.activeMarker.headStartedAt, "2026-05-14T09:01:00Z");
        assert.equal(state.activeMarker.maxWaitDeadlineAt, "2026-05-14T11:01:00Z");
      });
    });
  }
});

test("stable active-marker clean wins at the exact max-wait deadline", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:30:00Z",
      ackDeadlineAt: "2026-05-14T10:30:00Z",
      nextRetryAt: "2026-05-14T10:30:00Z",
      maxWaitDeadlineAt: "2026-05-14T10:01:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    harness.issueComments.push(codexCleanComment(2001));

    const result = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(successStatusWrites(harness), 1);
    assert.equal(harness.statuses.at(-1).body.state, "success");
    assert.equal(harness.findMarkerComments().length, 1);

    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.activeMarker, null);
    assert.equal(state.lastStatus.state, "success");
    assert.equal(state.history.at(-1).outcome, "passed");
    assert.equal(
      state.history.some((marker) => marker.outcome === "timed_out"),
      false,
    );
  });
});

test("clean active-marker evidence still passes immediately before max wait", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:30:00Z",
      maxWaitDeadlineAt: "2026-05-14T10:01:01Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    harness.issueComments.push(codexCleanComment(2001));

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "success");
    assert.equal(successStatusWrites(harness), 1);
  });
});

test("stable active-marker clean wins when final validation crosses max wait", async () => {
  await withHarness(async (harness) => {
    const deadline = Date.parse("2026-05-14T10:01:01Z");
    harness.now = deadline - 1_000;
    harness.seedActiveMarker({
      id: 2000,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:30:00Z",
      maxWaitDeadlineAt: new Date(deadline).toISOString(),
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    harness.issueComments.push(codexCleanComment(2001));
    harness.advanceClockAfterSnapshotLoad(2, deadline);

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(successStatusWrites(harness), 1);
    assert.equal(harness.statuses.at(-1).body.state, "success");
    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.activeMarker, null);
    assert.equal(state.history.at(-1).outcome, "passed");
    assert.equal(state.history.at(-1).closedAt, "2026-05-14T10:01:01.000Z");
  });
});

test("active marker with no clean still times out at max wait", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:30:00Z",
      ackDeadlineAt: "2026-05-14T10:30:00Z",
      nextRetryAt: "2026-05-14T10:30:00Z",
      maxWaitDeadlineAt: "2026-05-14T10:01:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });

    const result = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(successStatusWrites(harness), 0);
    assert.equal(harness.statuses.at(-1).body.state, "failure");
    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.activeMarker, null);
    assert.equal(state.lastStatus.state, "failure");
    assert.equal(state.history.at(-1).outcome, "timed_out");
  });
});

test("manual retry after failed findings preserves the same-head max-wait budget", async () => {
  await withHarness(async (harness) => {
    harness.seedFailedFindingsState({
      id: 2000,
      currentHeadFindingIds: [],
      headStartedAt: "2026-05-14T09:00:00Z",
      maxWaitDeadlineAt: "2026-05-14T11:00:00Z",
    });

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    assert.equal(harness.findMarkerComments().length, 2);
    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.activeMarker.state, "waiting_ack");
    assert.equal(state.activeMarker.headStartedAt, "2026-05-14T09:00:00Z");
    assert.equal(
      state.activeMarker.maxWaitDeadlineAt,
      "2026-05-14T11:00:00Z",
    );
  });
});

test("head changes close obsolete markers, write pending, and create a fresh marker", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: OLD_HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
      stateHead: OLD_HEAD_SHA,
      pullHead: NEW_HEAD_SHA,
    });

    const result = await harness.runGate({
      eventName: "pull_request_target",
      event: {
        pull_request: { number: 1, head: { sha: NEW_HEAD_SHA } },
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(harness.statuses.map((status) => status.body.state), ["pending"]);

    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.history.at(-1).outcome, "obsolete_head");
    assert.equal(state.history.at(-1).currentHeadSha, NEW_HEAD_SHA);
    assert.equal(state.activeMarker.headSha, NEW_HEAD_SHA);
  });
});

test("a prior-head issue-comment clean is stale evidence and a head change creates a fresh marker", async () => {
  await withHarness(async (harness) => {
    harness.seedSuccessfulState();
    harness.pullRequest = harness.pullRequestForHead(NEW_HEAD_SHA);
    harness.compareResults[`${HEAD_SHA}...${NEW_HEAD_SHA}`] = {
      status: "ahead",
      base_commit: { sha: HEAD_SHA },
      head_commit: { sha: NEW_HEAD_SHA },
      merge_base_commit: { sha: HEAD_SHA },
    };
    const oldClean = codexCleanComment(2001);
    harness.issueComments.push(oldClean);

    const result = await harness.runGate({
      eventName: "pull_request_target",
      event: {
        pull_request: { number: 1, head: { sha: NEW_HEAD_SHA } },
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.history.at(-1).outcome, "passed");
    assert.equal(state.activeMarker.headSha, NEW_HEAD_SHA);
    assert.equal(state.activeMarker.baseline.completionComment.id, "2001");
    assert.equal(harness.findMarkerComments().length, 2);
  });
});

test("a prior-head review clean is stale evidence and a head change creates a fresh marker", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: OLD_HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
      stateHead: OLD_HEAD_SHA,
      pullHead: NEW_HEAD_SHA,
    });
    harness.compareResults[`${OLD_HEAD_SHA}...${NEW_HEAD_SHA}`] = {
      status: "ahead",
      base_commit: { sha: OLD_HEAD_SHA },
      head_commit: { sha: NEW_HEAD_SHA },
      merge_base_commit: { sha: OLD_HEAD_SHA },
    };
    harness.reviews.push({
      id: 4001,
      state: "APPROVED",
      commit_id: OLD_HEAD_SHA,
      submitted_at: "2026-05-14T10:00:00Z",
      body: "Looks good.",
      user: codexBotUser(),
    });

    const result = await harness.runGate({
      eventName: "pull_request_target",
      event: {
        pull_request: { number: 1, head: { sha: NEW_HEAD_SHA } },
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.history.at(-1).outcome, "obsolete_head");
    assert.equal(state.activeMarker.headSha, NEW_HEAD_SHA);
    assert.equal(state.activeMarker.baseline.approvedReview, null);
    assert.equal(
      harness.requestLog.some((entry) =>
        entry.method === "GET" &&
          entry.path.endsWith(`/compare/${OLD_HEAD_SHA}...${NEW_HEAD_SHA}`),
      ),
      true,
    );
    assert.equal(harness.findMarkerComments().length, 2);
  });
});

test("a clean bound to a non-ancestor commit remains deterministic invalid evidence", async () => {
  await withHarness(async (harness) => {
    harness.pullRequest = harness.pullRequestForHead(NEW_HEAD_SHA);
    harness.commitResolutions[OLD_HEAD_SHA.slice(0, 10)] = OLD_HEAD_SHA;
    harness.compareResults[`${OLD_HEAD_SHA}...${NEW_HEAD_SHA}`] = {
      status: "diverged",
      base_commit: { sha: OLD_HEAD_SHA },
      head_commit: { sha: NEW_HEAD_SHA },
      merge_base_commit: { sha: HEAD_SHA },
    };
    harness.issueComments.push(codexCleanCommentForHead(2001, OLD_HEAD_SHA));

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(harness.statuses.at(-1).body.state, "error");
    assert.match(result.stderr, /not current head/);
    assert.equal(harness.findMarkerComments().length, 0);
  });
});

test("compare responses must bind the requested head endpoint", async (t) => {
  for (const scenario of [
    {
      name: "missing head",
      headCommit: null,
      expected: /did not contain a closed commit relationship/,
    },
    {
      name: "conflicting head",
      headCommit: NEW_HEAD_SHA,
      expected: /does not match current commit/,
    },
  ]) {
    await t.test(scenario.name, async () => {
      await withHarness(async (harness) => {
        harness.commitResolutions[OLD_HEAD_SHA.slice(0, 10)] = OLD_HEAD_SHA;
        harness.compareResults[`${OLD_HEAD_SHA}...${HEAD_SHA}`] = {
          status: "ahead",
          base_commit: { sha: OLD_HEAD_SHA },
          ...(scenario.headCommit
            ? { head_commit: { sha: scenario.headCommit } }
            : {}),
          merge_base_commit: { sha: OLD_HEAD_SHA },
        };
        harness.issueComments.push(
          codexCleanCommentForHead(2001, OLD_HEAD_SHA),
        );

        const result = await harness.runGate({
          eventName: "workflow_dispatch",
          event: { inputs: { pull_request: "1" } },
          env: { PR_NUMBER: "1" },
        });

        assert.equal(result.code, 1);
        assert.equal(successStatusWrites(harness), 0);
        assert.equal(harness.statuses.at(-1).body.state, "error");
        assert.match(result.stderr, scenario.expected);
      });
    });
  }
});

test("a delayed prior-head clean cannot turn a current-head active marker into an error", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
      ackDeadlineAt: "2026-05-14T10:30:00Z",
      nextRetryAt: "2026-05-14T10:30:00Z",
    });
    harness.commitResolutions[OLD_HEAD_SHA.slice(0, 10)] = OLD_HEAD_SHA;
    const delayedOldClean = codexCleanCommentForHead(
      2001,
      OLD_HEAD_SHA,
      "2026-05-14T10:00:00Z",
    );
    harness.issueComments.push(delayedOldClean);

    const result = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: delayedOldClean,
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(harness.statuses.map((status) => status.body.state), ["pending"]);
    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.activeMarker.id, "2000");
    assert.equal(state.activeMarker.headSha, HEAD_SHA);
    assert.equal(harness.statuses.some((status) => status.body.state === "success"), false);
    assert.equal(harness.statuses.some((status) => status.body.state === "error"), false);
  });
});

test("state-loss recovery records old marker and creates a fresh marker without passing stale signals", async () => {
  await withHarness(async (harness) => {
    harness.seedMarkerOnly({
      id: 2000,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      headStartedAt: "2026-05-14T07:00:00Z",
      maxWaitDeadlineAt: "2026-05-14T09:00:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    harness.issueComments.push({
      id: 2001,
      body: "Codex review still in progress.",
      created_at: "2026-05-14T09:57:00Z",
      html_url: "https://github.example/owner/repo/pull/1#issuecomment-2001",
      user: codexBotUser(),
    });

    const result = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: { user: { login: "chatgpt-codex-connector[bot]" } },
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "pending");

    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.history.at(-1).outcome, "state_lost");
    assert.equal(state.history.at(-1).headStartedAt, "2026-05-14T07:00:00Z");
    assert.equal(state.activeMarker.state, "waiting_ack");
    assert.equal(state.activeMarker.baseline.completionComment, null);
    assert.equal(
      Date.parse(state.activeMarker.headStartedAt) >
        Date.parse("2026-05-14T09:00:00Z"),
      true,
    );
    assert.equal(
      Date.parse(state.activeMarker.maxWaitDeadlineAt) -
        Date.parse(state.activeMarker.headStartedAt),
      7_200_000,
    );
  });
});

test("legacy failure state migrates a live marker using same-head unresolved findings", async () => {
  await withHarness(async (harness) => {
    harness.seedLegacyFailureState({ id: 2000 });
    harness.reviewComments.push(currentHeadInlineFinding(3001));
    harness.reviewThreads.push(unresolvedThread(3001));

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "failure");
    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.activeMarker, null);
    assert.equal(state.history.at(-1).id, "2000");
    assert.equal(state.history.at(-1).outcome, "failed_findings");
    assert.equal(state.history.at(-1).closedAt, "2026-05-14T09:58:00Z");
    assert.equal(state.history.at(-1).currentHeadFindings.count, 1);
    assert.deepEqual(
      state.history.at(-1).currentHeadFindings.sampleIds,
      ["thread:thread-3001"],
    );
  });
});

test("a post-failure clean can recover migrated legacy findings after resolution", async () => {
  await withHarness(async (harness) => {
    harness.seedLegacyFailureState({ id: 2000 });
    harness.reviewComments.push(currentHeadInlineFinding(3001));
    harness.reviewThreads.push(unresolvedThread(3001));
    const comment = codexCleanComment(2001, "2026-05-14T10:00:00Z");
    harness.issueComments.push(comment);

    const failed = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment,
      },
    });

    assert.equal(failed.code, 0, failed.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "failure");
    let state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.history.at(-1).outcome, "failed_findings");
    assert.equal(state.history.at(-1).closedAt, "2026-05-14T09:58:00Z");

    harness.reviewThreads[0].isResolved = true;
    const recovered = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment,
      },
    });

    assert.equal(recovered.code, 0, recovered.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "success");
    state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.lastStatus.state, "success");
  });
});

test("legacy failure without provable findings records state loss and requires a fresh marker", async () => {
  await withHarness(async (harness) => {
    harness.seedLegacyFailureState({ id: 2000 });
    harness.issueComments.push(codexCleanComment(2001, "2026-05-14T09:57:00Z"));
    harness.nextCommentId = 3000;

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(successStatusWrites(harness), 0);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.history.at(-1).outcome, "state_lost");
    assert.equal(state.history.at(-1).id, "2000");
    assert.equal(state.activeMarker.id, "3000");
    assert.equal(state.activeMarker.baseline.completionComment.id, "2001");
    assert.equal(state.lastStatus.state, "pending");
  });
});

test("legacy failure with a missing trusted marker absorbs existing clean into a fresh marker", async () => {
  await withHarness(async (harness) => {
    harness.seedLegacyFailureState({ id: 2000 });
    harness.issueComments = harness.issueComments.filter((comment) => comment.id !== 2000);
    harness.issueComments.push(codexCleanComment(2001, "2026-05-14T10:00:00Z"));
    harness.nextCommentId = 3000;

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(successStatusWrites(harness), 0);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.activeMarker.id, "3000");
    assert.equal(state.activeMarker.baseline.completionComment.id, "2001");
    assert.equal(state.lastStatus.state, "pending");
  });
});

test("scheduled scan skips PRs with no trusted gate state or marker", async () => {
  await withHarness(async (harness) => {
    const result = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.length, 0);
    assert.equal(harness.findStateComment(), undefined);
    assert.equal(harness.findMarkerComments().length, 0);
  });
});

test("scheduled scan does not initialize stateless PRs from existing Codex evidence", async () => {
  const evidenceCases = [
    (harness) => {
      harness.reviewComments.push(currentHeadInlineFinding(3001));
      harness.reviewThreads.push(unresolvedThread(3001));
    },
    (harness) => {
      harness.issueComments.push(codexCleanComment(2001));
    },
    (harness) => {
      harness.issueComments.push(codexMalformedTerminal(2001));
    },
    (harness) => {
      harness.commitStatuses.push({
        sha: HEAD_SHA,
        context: "codex/review-gate",
        state: "pending",
        creator: { login: "github-actions[bot]", type: "Bot" },
      });
    },
  ];

  for (const seedEvidence of evidenceCases) {
    await withHarness(async (harness) => {
      seedEvidence(harness);

      const result = await harness.runGate({
        eventName: "schedule",
        event: {},
      });

      assert.equal(result.code, 0, result.stderr);
      assert.equal(harness.statuses.length, 0);
      assert.equal(harness.findStateComment(), undefined);
      assert.equal(harness.findMarkerComments().length, 0);
      assert.equal(statusReads(harness), 1);
      assert.equal(
        harness.requestLog.some((entry) =>
          entry.path === "/graphql" ||
            entry.path.endsWith(`/issues/${harness.prNumber}/reactions`) ||
            entry.path.endsWith(`/pulls/${harness.prNumber}/comments`) ||
            entry.path.endsWith(`/pulls/${harness.prNumber}/reviews`) ||
            (
              entry.path.includes("/commits/") &&
              !entry.path.endsWith(`/commits/${HEAD_SHA}/statuses`)
            ),
        ),
        false,
      );
    });
  }
});

test("scheduled stateless preflight skips unrelated evidence failures without writes", async () => {
  await withHarness(async (harness) => {
    harness.failNextReviewThreads = true;

    const result = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.length, 0);
    assert.equal(harness.findStateComment(), undefined);
    assert.equal(harness.findMarkerComments().length, 0);
    assert.equal(
      harness.requestLog.some((entry) => entry.path === "/graphql"),
      false,
    );
  });
});

test("scheduled stateless preflight skips PR detail failures without writes", async () => {
  await withHarness(async (harness) => {
    const pullPath =
      `/repos/${harness.owner}/${harness.repo}/pulls/${harness.prNumber}`;
    harness.routeFaults[`GET ${pullPath}`] = [{
      status: 422,
      body: { message: "PR detail should not be requested" },
    }];

    const result = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.length, 0);
    assert.equal(harness.findStateComment(), undefined);
    assert.equal(harness.findMarkerComments().length, 0);
    assert.equal(
      harness.requestLog.some((entry) =>
        entry.method === "GET" && entry.path === pullPath),
      false,
    );
  });
});

test("scheduled preflight failure demotes a trusted prior gate status", async () => {
  await withHarness(async (harness) => {
    harness.commitStatuses.push({
      sha: HEAD_SHA,
      context: "codex/review-gate",
      state: "success",
      creator: { login: "github-actions[bot]", type: "Bot" },
    });
    const commentsPath =
      `/repos/${harness.owner}/${harness.repo}/issues/${harness.prNumber}/comments`;
    harness.routeFaults[`GET ${commentsPath}`] = Array.from(
      { length: 4 },
      () => ({
        status: 503,
        body: { message: "scheduled comments unavailable" },
        headers: { "Retry-After": "0" },
      }),
    );

    const result = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /scheduled comments unavailable/);
    assert.equal(harness.statuses.at(-1).sha, HEAD_SHA);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    const statusReadIndex = harness.requestLog.findIndex((entry) =>
      entry.method === "GET" &&
        entry.path.endsWith(`/commits/${HEAD_SHA}/statuses`));
    const commentsReadIndex = harness.requestLog.findIndex((entry) =>
      entry.method === "GET" && entry.path === commentsPath);
    assert.equal(statusReadIndex >= 0, true);
    assert.equal(commentsReadIndex > statusReadIndex, true);
  });
});

test("scheduled deterministic preflight failure errors a trusted prior gate status", async () => {
  await withHarness(async (harness) => {
    harness.commitStatuses.push({
      sha: HEAD_SHA,
      context: "codex/review-gate",
      state: "success",
      creator: { login: "github-actions[bot]", type: "Bot" },
    });
    const commentsPath =
      `/repos/${harness.owner}/${harness.repo}/issues/${harness.prNumber}/comments`;
    harness.routeFaults[`GET ${commentsPath}`] = [{
      status: 422,
      body: { message: "invalid scheduled comments response" },
    }];

    const result = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /invalid scheduled comments response/);
    assert.equal(harness.statuses.at(-1).sha, HEAD_SHA);
    assert.equal(harness.statuses.at(-1).body.state, "error");
  });
});

test("scheduled preflight failure does not trust an external gate status", async () => {
  await withHarness(async (harness) => {
    harness.commitStatuses.push(
      {
        sha: HEAD_SHA,
        context: "codex/review-gate",
        state: "success",
        creator: { login: "external-integration[bot]", type: "Bot" },
      },
      {
        sha: HEAD_SHA,
        context: "codex/review-gate",
        state: "success",
        creator: { login: "github-actions[bot]", type: "Bot" },
      },
    );
    const commentsPath =
      `/repos/${harness.owner}/${harness.repo}/issues/${harness.prNumber}/comments`;
    harness.routeFaults[`GET ${commentsPath}`] = Array.from(
      { length: 4 },
      () => ({
        status: 503,
        body: { message: "scheduled comments unavailable" },
        headers: { "Retry-After": "0" },
      }),
    );

    const result = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /scheduled comments unavailable/);
    assert.equal(harness.statuses.length, 0);
    assert.equal(harness.findStateComment(), undefined);
    assert.equal(harness.findMarkerComments().length, 0);
  });
});

test("scheduled preflight failure does not write when status eligibility is unavailable", async () => {
  await withHarness(async (harness) => {
    const statusesPath =
      `/repos/${harness.owner}/${harness.repo}/commits/${HEAD_SHA}/statuses`;
    harness.routeFaults[`GET ${statusesPath}`] = Array.from(
      { length: 4 },
      () => ({
        status: 503,
        body: { message: "status history unavailable" },
        headers: { "Retry-After": "0" },
      }),
    );
    const commentsPath =
      `/repos/${harness.owner}/${harness.repo}/issues/${harness.prNumber}/comments`;
    harness.routeFaults[`GET ${commentsPath}`] = Array.from(
      { length: 4 },
      () => ({
        status: 503,
        body: { message: "scheduled comments unavailable" },
        headers: { "Retry-After": "0" },
      }),
    );

    const result = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /scheduled comments unavailable/);
    assert.equal(statusReads(harness), 4);
    assert.equal(harness.statuses.length, 0);
    assert.equal(harness.findStateComment(), undefined);
    assert.equal(harness.findMarkerComments().length, 0);
  });
});

test("scheduled stateful preflight fails closed when PR detail loading fails", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    const pullPath =
      `/repos/${harness.owner}/${harness.repo}/pulls/${harness.prNumber}`;
    harness.routeFaults[`GET ${pullPath}`] = [{
      status: 422,
      body: { message: "deterministic PR detail failure" },
    }];

    const result = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /deterministic PR detail failure/);
    assert.equal(harness.statuses.at(-1).sha, HEAD_SHA);
    assert.equal(harness.statuses.at(-1).body.state, "error");
    assert.equal(
      harness.requestLog.some((entry) =>
        entry.method === "GET" && entry.path === pullPath),
      true,
    );
  });
});

test("scheduled preflight paginates to trusted state and reuses those comments", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T10:00:00Z",
      ackDeadlineAt: "2026-05-14T10:05:00Z",
      nextRetryAt: "2026-05-14T10:05:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    const trustedComments = [...harness.issueComments];
    harness.issueComments = [
      ...Array.from({ length: 100 }, (_, index) => ({
        id: 3000 + index,
        body: `Untrusted comment ${index}`,
        created_at: "2026-05-14T09:00:00Z",
        user: { login: "octocat", type: "User" },
      })),
      ...trustedComments,
    ];

    const result = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(result.code, 0, result.stderr);
    assert.notEqual(harness.findStateComment(), undefined);
    assert.deepEqual(
      harness.requestLog
        .filter((entry) =>
          entry.method === "GET" &&
            entry.path.endsWith(`/issues/${harness.prNumber}/comments`),
        )
        .map((entry) => entry.query.page),
      ["1", "2"],
    );
  });
});

test("scheduled scan may initialize a stateless Dependabot PR", async () => {
  await withHarness(async (harness) => {
    harness.pullRequest.user = { login: "dependabot[bot]", type: "Bot" };

    const result = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(result.code, 0, result.stderr);
    assert.notEqual(harness.findStateComment(), undefined);
    assert.equal(harness.findMarkerComments().length, 1);
  });
});

test("targeted workflow_dispatch fails closed when snapshot loading errors after status readiness", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    harness.failNextReviewThreads = true;

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /GraphQL reviewThreads query failed/);
    assert.equal(harness.statuses.at(-1).body.state, "error");
  });
});

test("live PR evidence reasserts success over a newer live error without a new review request", async () => {
  await withHarness(async (harness) => {
    harness.seedSuccessfulState({
      providerId: 5004259807,
      maxWaitDeadlineAt: "2026-05-14T10:00:00Z",
    });
    harness.commitStatuses.push({
      sha: HEAD_SHA,
      context: "codex/review-gate",
      state: "error",
      description: "Earlier incomplete reconciliation",
    });
    for (let offset = 0; offset < 8; offset += 1) {
      const commentId = 3001 + offset;
      harness.reviewComments.push(currentHeadInlineFinding(commentId));
      harness.reviewThreads.push(
        unresolvedThread(commentId, {
          resolved: true,
          outdated: offset < 2,
        }),
      );
    }
    harness.issueComments.push(codexCleanComment(5004259807));

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.pullLoads, 2);
    assert.equal(harness.snapshotLoads, 2);
    assert.equal(harness.statuses.at(-1).body.state, "success");
    assert.equal(
      harness.requestLog.some((entry) =>
        entry.method === "GET" &&
          entry.path.endsWith(`/commits/${HEAD_SHA}/statuses`),
      ),
      true,
    );
    assert.equal(harness.findMarkerComments().length, 1);
    assert.equal(
      parseStateCommentBody(harness.findStateComment().body).history.some(
        (marker) => marker.outcome === "timed_out",
      ),
      false,
    );
  });
});

test("a later current-head clean supersedes an earlier exact threadless finding", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 1900,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:45:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    harness.issueComments.push(
      codexMalformedTerminal(2000, "2026-05-14T09:56:00Z"),
      codexThreadlessFinding(2001, OLD_HEAD_SHA, "2026-05-14T09:57:00Z"),
      codexCleanComment(2002, "2026-05-14T10:00:00Z"),
    );

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "success");
  });
});

test("a newer current-head clean does not resolve an unused older short-SHA clean", async () => {
  await withHarness(async (harness) => {
    const oldShortSha = OLD_HEAD_SHA.slice(0, 10);
    harness.seedActiveMarker({
      id: 1900,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:45:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    harness.routeFaults[
      `GET /repos/${harness.owner}/${harness.repo}/commits/${oldShortSha}`
    ] = Array.from({ length: 4 }, () => ({
      status: 429,
      body: { message: "unused older clean resolution fault" },
      headers: { "Retry-After": "0" },
    }));
    harness.issueComments.push(
      codexCleanCommentForHead(2001, OLD_HEAD_SHA, "2026-05-14T09:55:00Z"),
      codexCleanComment(2002, "2026-05-14T10:00:00Z"),
    );

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "success");
    assert.equal(
      harness.requestLog.some((entry) =>
        entry.method === "GET" &&
          entry.path.endsWith(`/commits/${oldShortSha}`),
      ),
      false,
    );
  });
});

test("an older finding makes an unresolved short-SHA clean decision fail closed", async () => {
  await withHarness(async (harness) => {
    const oldShortSha = OLD_HEAD_SHA.slice(0, 10);
    harness.compareResults[`${OLD_HEAD_SHA}...${HEAD_SHA}`] = {
      status: "diverged",
      base_commit: { sha: OLD_HEAD_SHA },
      head_commit: { sha: HEAD_SHA },
      merge_base_commit: { sha: NEW_HEAD_SHA },
    };
    harness.routeFaults[
      `GET /repos/${harness.owner}/${harness.repo}/commits/${oldShortSha}`
    ] = Array.from({ length: 4 }, () => ({
      status: 429,
      body: { message: "required older clean resolution fault" },
      headers: { "Retry-After": "0" },
    }));
    harness.issueComments.push(
      codexThreadlessFinding(2001, OLD_HEAD_SHA, "2026-05-14T09:50:00Z"),
      codexCleanCommentForHead(2002, OLD_HEAD_SHA, "2026-05-14T09:55:00Z"),
      codexCleanComment(2003, "2026-05-14T10:00:00Z"),
    );

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    assert.match(result.stderr, /exhausted its retry budget/);
    assert.equal(
      harness.requestLog.some((entry) =>
        entry.method === "GET" &&
          entry.path.endsWith(`/commits/${oldShortSha}`),
      ),
      true,
    );
  });
});

test("a deterministically invalid older short-SHA clean cannot suppress its finding", async () => {
  await withHarness(async (harness) => {
    const oldShortSha = OLD_HEAD_SHA.slice(0, 10);
    harness.compareResults[`${OLD_HEAD_SHA}...${HEAD_SHA}`] = {
      status: "diverged",
      base_commit: { sha: OLD_HEAD_SHA },
      head_commit: { sha: HEAD_SHA },
      merge_base_commit: { sha: NEW_HEAD_SHA },
    };
    harness.issueComments.push(
      codexThreadlessFinding(2001, OLD_HEAD_SHA, "2026-05-14T09:50:00Z"),
      codexCleanCommentForHead(2002, OLD_HEAD_SHA, "2026-05-14T09:55:00Z"),
      codexCleanComment(2003, "2026-05-14T10:00:00Z"),
    );

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "failure");
    assert.equal(
      harness.requestLog.some((entry) =>
        entry.method === "GET" &&
          entry.path.endsWith(`/commits/${oldShortSha}`),
      ),
      true,
    );
  });
});

test("a clean result does not supersede a finding from a non-ancestor commit", async () => {
  await withHarness(async (harness) => {
    harness.compareResults[`${OLD_HEAD_SHA}...${HEAD_SHA}`] = {
      status: "diverged",
      base_commit: { sha: OLD_HEAD_SHA },
      head_commit: { sha: HEAD_SHA },
      merge_base_commit: { sha: NEW_HEAD_SHA },
    };
    harness.issueComments.push(
      codexThreadlessFinding(2001, OLD_HEAD_SHA, "2026-05-14T09:57:00Z"),
      codexCleanComment(2002, "2026-05-14T10:00:00Z"),
    );

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "failure");
  });
});

test("a newer malformed terminal artifact invalidates an earlier clean result", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 1900,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    harness.issueComments.push(codexCleanComment(2001, "2026-05-14T09:57:00Z"));
    harness.afterSnapshotLoad(2, {
      action: "pushIssueComment",
      value: codexMalformedTerminal(2002, "2026-05-14T10:00:00Z"),
    });

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(harness.statuses.some((status) => status.body.state === "success"), false);
    assert.equal(harness.statuses.at(-1).body.state, "error");
    assert.match(result.stderr, /clean Codex issue comment must contain exactly one Reviewed commit marker/);
  });
});

test("a provider terminal artifact without a canonical ID fails closed", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 1900,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    const invalid = codexCleanComment(2001);
    delete invalid.id;
    harness.issueComments.push(invalid);

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(successStatusWrites(harness), 0);
    assert.equal(harness.statuses.at(-1).body.state, "error");
    assert.match(result.stderr, /valid positive integer id/);
  });
});

test("duplicate provider artifact IDs are deterministic evidence errors", async () => {
  await withHarness(async (harness) => {
    harness.issueComments.push(
      codexCleanComment(2001, "2026-05-14T10:00:00Z"),
      codexThreadlessFinding(2001, HEAD_SHA, "2026-05-14T09:59:00Z"),
    );

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(successStatusWrites(harness), 0);
    assert.equal(harness.statuses.at(-1).body.state, "error");
    assert.match(result.stderr, /artifact identity issue-comment:2001 appears more than once/);
  });
});

test("a final reload rejects a newly visible invalid provider identity", async () => {
  await withHarness(async (harness) => {
    seedCleanActiveMarker(harness);
    const invalid = codexCleanComment(2002, "2026-05-14T10:01:00Z");
    invalid.id = "2002";
    harness.afterSnapshotLoad(2, {
      action: "pushIssueComment",
      value: invalid,
    });

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(successStatusWrites(harness), 0);
    assert.equal(harness.statuses.at(-1).body.state, "error");
    assert.match(result.stderr, /valid positive integer id/);
  });
});

test("a newer valid clean can supersede an older malformed provider identity", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 1900,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    const olderInvalid = codexCleanComment(1998, "2026-05-14T09:56:00Z");
    delete olderInvalid.id;
    harness.issueComments.push(
      olderInvalid,
      codexCleanComment(2001, "2026-05-14T10:00:00Z"),
    );

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "success");
  });
});

test("a newer noncanonical terminal prefix invalidates an earlier clean result", async () => {
  await withHarness(async (harness) => {
    harness.issueComments.push(
      codexCleanComment(2001, "2026-05-14T09:57:00Z"),
      {
        ...codexCleanComment(2002, "2026-05-14T10:00:00Z"),
        body: "Codex Review result: unsupported terminal format",
      },
    );

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(harness.statuses.some((status) => status.body.state === "success"), false);
    assert.equal(harness.statuses.at(-1).body.state, "error");
    assert.match(result.stderr, /unrecognized Codex terminal issue-comment format/);
  });
});

test("newer unclassifiable decorated headings invalidate an earlier clean result", async () => {
  for (const decorator of [
    "👍🏽",
    "🇺🇸",
    "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    "1️⃣",
    "☀️",
    "☀︎",
    "👩🏽‍💻",
    "⟦future-decorator⟧",
  ]) {
    await withHarness(async (harness) => {
      harness.issueComments.push(
        codexCleanComment(2001, "2026-05-14T09:57:00Z"),
        {
          ...codexCleanComment(2002, "2026-05-14T10:00:00Z"),
          body:
            `### ${decorator} Codex Review outcome: unsupported terminal format`,
        },
      );

      const result = await harness.runGate({
        eventName: "workflow_dispatch",
        event: { inputs: { pull_request: "1" } },
        env: { PR_NUMBER: "1" },
      });

      assert.equal(result.code, 1, `${decorator}: ${result.stderr}`);
      assert.equal(successStatusWrites(harness), 0, decorator);
      assert.equal(harness.statuses.at(-1).body.state, "error", decorator);
      assert.match(
        result.stderr,
        /unrecognized Codex terminal issue-comment format/,
        decorator,
      );
    });
  }
});

test("a newer progress heading with an alternate-line terminal tail invalidates older clean", async () => {
  await withHarness(async (harness) => {
    harness.issueComments.push(
      codexCleanComment(2001, "2026-05-14T09:57:00Z"),
      {
        ...codexCleanComment(2002, "2026-05-14T10:00:00Z"),
        body: [
          "Codex Review in progress: queued",
          "### 💡 Codex Review",
          `https://github.com/owner/repo/blob/${HEAD_SHA}/src/gate.mjs#L42-L44`,
        ].join("\u2028"),
      },
    );

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(successStatusWrites(harness), 0);
    assert.equal(harness.statuses.at(-1).body.state, "error");
    assert.match(
      result.stderr,
      /unrecognized Codex terminal issue-comment format/,
    );
  });
});

test("cross-channel terminal artifacts at the same server timestamp are inconclusive", async () => {
  await withHarness(async (harness) => {
    harness.issueComments.push(codexCleanComment(2001, "2026-05-14T10:00:00Z"));
    harness.reviews.push({
      id: 4001,
      state: "APPROVED",
      commit_id: HEAD_SHA,
      submitted_at: "2026-05-14T10:00:00.000Z",
      body: "Looks good.",
      user: codexBotUser(),
    });

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(harness.statuses.at(-1).body.state, "error");
    assert.match(result.stderr, /ambiguous server timestamp/);
  });
});

test("status dedupe stops on the first trusted newest-first page", async () => {
  await withHarness(async (harness) => {
    seedCleanActiveMarker(harness);
    harness.commitStatuses = [
      {
        sha: HEAD_SHA,
        context: "codex/review-gate",
        state: "error",
        creator: { login: "github-actions[bot]", type: "Bot" },
      },
      ...Array.from({ length: 149 }, (_, index) => ({
        sha: HEAD_SHA,
        context: `other/status-${index}`,
        state: "success",
      })),
    ];

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "success");
    const reads = harness.requestLog.filter((entry) =>
      entry.method === "GET" &&
      entry.path.endsWith(`/commits/${HEAD_SHA}/statuses`));
    assert.deepEqual(reads.map((entry) => entry.query.page), ["1"]);
  });
});

test("status-read page-budget exhaustion does not replace computed success", async () => {
  await withHarness(async (harness) => {
    seedCleanActiveMarker(harness);
    harness.commitStatuses = Array.from({ length: 1_001 }, (_, index) => ({
      sha: HEAD_SHA,
      context: `other/status-${index}`,
      state: "success",
    }));

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "success");
    assert.match(result.stderr, /Commit-status read page budget exhausted/);
    assert.equal(statusReads(harness), 10);
    assert.equal(
      harness.requestLog.some((entry) =>
        entry.path.endsWith(`/commits/${HEAD_SHA}/statuses`) &&
        entry.query.page === "11"),
      false,
    );
  });
});

test("oversized streamed status history does not replace computed success", async () => {
  await withHarness(async (harness) => {
    seedCleanActiveMarker(harness);
    harness.streamResponseBodies = true;
    harness.streamChunkSize = 64 * 1024;
    harness.commitStatuses = Array.from({ length: 100 }, (_, index) => ({
      sha: HEAD_SHA,
      context: `other/status-${index}`,
      state: "success",
      description: "x".repeat(12 * 1024),
    }));

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "success");
    assert.match(result.stderr, /Evidence response-byte budget exceeded/);
    assert.equal(statusReads(harness), 1);
  });
});

test("status lookup exhaustion does not replace complete review evidence", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 1900,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    harness.issueComments.push(codexCleanComment(2001));
    harness.routeFaults[
      `GET /repos/${harness.owner}/${harness.repo}/commits/${HEAD_SHA}/statuses`
    ] = Array.from({ length: 4 }, () => ({
      status: 503,
      body: { message: "temporary status lookup failure" },
      headers: { "Retry-After": "0" },
    }));

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /failed to read current codex\/review-gate status/);
    assert.equal(harness.statuses.at(-1).body.state, "success");
  });
});

test("audit-state save failure cannot overwrite a computed success", async () => {
  await withHarness(async (harness) => {
    harness.seedSuccessfulState();
    harness.issueComments.push(codexCleanComment(2001));
    harness.commitStatuses.push({
      sha: HEAD_SHA,
      context: "codex/review-gate",
      state: "error",
    });
    harness.routeFaults[
      `PATCH /repos/${harness.owner}/${harness.repo}/issues/comments/1000`
    ] = Array.from({ length: 4 }, () => ({
      status: 503,
      body: { message: "temporary audit-state failure" },
      headers: { "Retry-After": "0" },
    }));

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(harness.statuses.map((status) => status.body.state), ["success"]);
    assert.match(result.stderr, /failed to save audit state after codex\/review-gate=success/);
  });
});

test("transient evidence read exhaustion writes pending and exits nonzero", async () => {
  await withHarness(async (harness) => {
    harness.routeFaults[
      `GET /repos/${harness.owner}/${harness.repo}/issues/${harness.prNumber}/comments`
    ] = Array.from({ length: 4 }, () => ({
      status: 503,
      body: { message: "temporary evidence failure" },
      headers: { "Retry-After": "0" },
    }));

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    assert.match(result.stderr, /exhausted its retry budget/);
  });
});

test("deterministic provider identity failure writes error and exits nonzero", async () => {
  await withHarness(async (harness) => {
    harness.issueComments.push({
      ...codexCleanComment(2001),
      user: { login: "chatgpt-codex-connector[bot]", type: "User" },
    });

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(harness.statuses.at(-1).body.state, "error");
    assert.match(result.stderr, /author is not a Bot/);
  });
});

test("deterministic reviewed-commit conflict writes error", async () => {
  await withHarness(async (harness) => {
    harness.commitResolutions[HEAD_SHORT_SHA] = OLD_HEAD_SHA;
    harness.issueComments.push(codexCleanComment(2001));

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(harness.statuses.at(-1).body.state, "error");
    assert.match(result.stderr, /resolved to non-matching commit/);
  });
});

test("final lifecycle reload prevents success after a head race", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 1900,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    harness.issueComments.push(codexCleanComment(2001));
    harness.afterPullLoad(2, {
      action: "setPullHead",
      value: NEW_HEAD_SHA,
    });

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(harness.statuses.some((status) => status.body.state === "success"), false);
    assert.equal(harness.statuses.at(-1).body.state, "error");
    assert.match(result.stderr, /gate run is stale/);
  });
});

test("complete REST pagination can find a clean comment after the first page", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 1900,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    for (let id = 1; id <= 100; id += 1) {
      harness.issueComments.push({
        id,
        body: `Human note ${id}`,
        created_at: "2026-05-14T09:00:00Z",
        user: { login: "octocat", type: "User" },
      });
    }
    harness.issueComments.push(codexCleanComment(5004259807));

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "success");
    assert.equal(
      harness.requestLog.some((entry) =>
        entry.path.endsWith("/issues/1/comments") && entry.query.page === "2",
      ),
      true,
    );
  });
});

test("REST pagination follows a next link even when the current page is short", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 1900,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    for (let id = 1; id <= 100; id += 1) {
      harness.issueComments.push({
        id,
        body: `Human note ${id}`,
        created_at: "2026-05-14T09:00:00Z",
        user: { login: "octocat", type: "User" },
      });
    }
    harness.issueComments.push(codexCleanComment(5004259807));
    const commentsPath =
      `/repos/${harness.owner}/${harness.repo}/issues/${harness.prNumber}/comments`;
    harness.routeFaults[
      `GET ${commentsPath}?per_page=100&page=1`
    ] = [{
      status: 200,
      body: harness.issueComments.slice(0, 4),
      headers: {
        Link:
          `<https://api.github.test${commentsPath}?per_page=100&page=2>; rel="next"`,
      },
    }];

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "success");
    assert.equal(
      harness.requestLog.some((entry) =>
        entry.path === commentsPath && entry.query.page === "2",
      ),
      true,
    );
  });
});

test("an oversized streamed evidence response is pending and never writes success", async () => {
  await withHarness(async (harness) => {
    harness.streamResponseBodies = true;
    harness.streamChunkSize = 256 * 1024;
    harness.issueComments.push({
      id: 7001,
      body: "x".repeat(8 * 1024 * 1024 + 1),
      created_at: "2026-05-14T09:00:00Z",
      user: { login: "octocat", type: "User" },
    });

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    assert.equal(harness.statuses.some((status) => status.body.state === "success"), false);
    assert.match(result.stderr, /response-byte budget exceeded/);
    assert.equal(
      harness.requestLog.filter((entry) =>
        entry.method === "GET" &&
        entry.path.endsWith("/issues/1/comments"),
      ).length,
      1,
    );
  });
});

test("an evidence budget failure aborts a concurrent hanging request", async () => {
  await withHarness(async (harness) => {
    const commentsPath =
      `/repos/${harness.owner}/${harness.repo}/issues/${harness.prNumber}/comments`;
    const reactionsPath =
      `/repos/${harness.owner}/${harness.repo}/issues/${harness.prNumber}/reactions`;
    harness.routeFaults[`GET ${commentsPath}`] = [{
      delayMs: 25,
      status: 200,
      body: [],
      headers: { "Content-Length": String(8 * 1024 * 1024 + 1) },
    }];
    harness.routeFaults[`GET ${reactionsPath}`] = [{
      hangUntilAbort: true,
    }];

    const startedAt = Date.now();
    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: {
        PR_NUMBER: "1",
        CODEX_REVIEW_GATE_REQUEST_TIMEOUT_SECONDS: "5",
      },
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(result.code, 1);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    assert.match(result.stderr, /declared .* > 8388608/);
    assert.equal(
      harness.requestLog.filter((entry) =>
        entry.method === "GET" && entry.path === commentsPath,
      ).length,
      1,
    );
    assert.equal(
      harness.requestLog.filter((entry) =>
        entry.method === "GET" && entry.path === reactionsPath,
      ).length,
      1,
    );
    assert.ok(
      elapsedMs < 4_000,
      `budget broadcast should beat the 5s request deadline; elapsed ${elapsedMs}ms`,
    );
  });
});

test("deterministic evidence parse failure outranks a concurrent budget failure", async () => {
  await withHarness(async (harness) => {
    const commentsPath =
      `/repos/${harness.owner}/${harness.repo}/issues/${harness.prNumber}/comments`;
    const reactionsPath =
      `/repos/${harness.owner}/${harness.repo}/issues/${harness.prNumber}/reactions`;
    harness.routeFaults[`GET ${commentsPath}`] = [{
      status: 200,
      rawText: "<not-json>",
    }];
    harness.routeFaults[`GET ${reactionsPath}`] = [{
      delayMs: 25,
      status: 200,
      body: [],
      headers: { "Content-Length": String(8 * 1024 * 1024 + 1) },
    }];

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(harness.statuses.at(-1).body.state, "error");
    assert.match(result.stderr, /returned a non-JSON response/);
    assert.doesNotMatch(result.stderr, /response-byte budget exceeded/);
  });
});

test("fulfilled invalid provider evidence outranks a concurrent response-byte budget failure", async (t) => {
  const scenarios = [
    {
      name: "malformed issue comment",
      arrange(harness) {
        harness.issueComments.push(codexMalformedTerminal(2001));
      },
      expected: /exactly one Reviewed commit marker/,
    },
    {
      name: "malformed review",
      arrange(harness) {
        harness.reviews.push({
          id: 9100,
          state: "COMMENTED",
          commit_id: HEAD_SHA,
          submitted_at: "2026-05-14T10:00:00Z",
          body: "Unknown nonempty review body.",
          user: codexBotUser(),
        });
      },
      expected: /unrecognized Codex terminal pull-request-review format/,
    },
    {
      name: "duplicate numeric review id",
      arrange(harness) {
        harness.reviews.push({
          ...harness.reviews[0],
          body: "Duplicate review identity.",
        });
      },
      expected: /duplicate numeric id 9000/,
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      await withHarness(async (harness) => {
        const reactionsPath =
          `/repos/${harness.owner}/${harness.repo}/issues/${harness.prNumber}/reactions`;
        scenario.arrange(harness);
        harness.routeFaults[`GET ${reactionsPath}`] = [{
          delayMs: 25,
          status: 200,
          body: [],
          headers: { "Content-Length": String(8 * 1024 * 1024 + 1) },
        }];

        const result = await harness.runGate({
          eventName: "workflow_dispatch",
          event: { inputs: { pull_request: "1" } },
          env: { PR_NUMBER: "1" },
        });

        assert.equal(result.code, 1);
        assert.equal(harness.statuses.at(-1).body.state, "error");
        assert.match(result.stderr, scenario.expected);
        assert.doesNotMatch(result.stderr, /response-byte budget exceeded/);
      });
    });
  }
});

test("partial-snapshot provider precedence uses complete provider-channel ordering", async (t) => {
  await t.test("newer clean supersedes an old malformed artifact before a budget failure", async () => {
    await withHarness(async (harness) => {
      const reactionsPath =
        `/repos/${harness.owner}/${harness.repo}/issues/${harness.prNumber}/reactions`;
      harness.issueComments.push(
        codexMalformedTerminal(2001, "2026-05-14T09:59:00Z"),
      );
      harness.reviews.push({
        id: 4001,
        state: "APPROVED",
        commit_id: HEAD_SHA,
        submitted_at: "2026-05-14T10:00:00Z",
        body: "Looks good.",
        user: codexBotUser(),
      });
      harness.routeFaults[`GET ${reactionsPath}`] = [{
        delayMs: 25,
        status: 200,
        body: [],
        headers: { "Content-Length": String(8 * 1024 * 1024 + 1) },
      }];

      const result = await harness.runGate({
        eventName: "workflow_dispatch",
        event: { inputs: { pull_request: "1" } },
        env: { PR_NUMBER: "1" },
      });

      assert.equal(result.code, 1);
      assert.equal(successStatusWrites(harness), 0);
      assert.equal(harness.statuses.at(-1).body.state, "pending");
      assert.match(result.stderr, /response-byte budget exceeded/);
      assert.doesNotMatch(result.stderr, /exactly one Reviewed commit marker/);
    });
  });

  await t.test("newer malformed artifact outranks an older clean and budget failure", async () => {
    await withHarness(async (harness) => {
      const reactionsPath =
        `/repos/${harness.owner}/${harness.repo}/issues/${harness.prNumber}/reactions`;
      harness.reviews.push({
        id: 4001,
        state: "APPROVED",
        commit_id: HEAD_SHA,
        submitted_at: "2026-05-14T09:59:00Z",
        body: "Looks good.",
        user: codexBotUser(),
      });
      harness.issueComments.push(
        codexMalformedTerminal(2001, "2026-05-14T10:00:00Z"),
      );
      harness.routeFaults[`GET ${reactionsPath}`] = [{
        delayMs: 25,
        status: 200,
        body: [],
        headers: { "Content-Length": String(8 * 1024 * 1024 + 1) },
      }];

      const result = await harness.runGate({
        eventName: "workflow_dispatch",
        event: { inputs: { pull_request: "1" } },
        env: { PR_NUMBER: "1" },
      });

      assert.equal(result.code, 1);
      assert.equal(harness.statuses.at(-1).body.state, "error");
      assert.match(result.stderr, /exactly one Reviewed commit marker/);
      assert.doesNotMatch(result.stderr, /response-byte budget exceeded/);
    });
  });

  await t.test("a reconciled inline child suppresses its parent wrapper before a budget failure", async () => {
    await withHarness(async (harness) => {
      const reactionsPath =
        `/repos/${harness.owner}/${harness.repo}/issues/${harness.prNumber}/reactions`;
      harness.reviews.push({
        id: 9100,
        state: "COMMENTED",
        commit_id: HEAD_SHA,
        submitted_at: "2026-05-14T10:00:01Z",
        body: codexInlineParentReviewBody(),
        user: codexBotUser(),
      });
      harness.reviewComments.push({
        ...currentHeadInlineFinding(3001),
        pull_request_review_id: 9100,
      });
      harness.reviewThreads.push(unresolvedThread(3001, { resolved: true }));
      harness.routeFaults[`GET ${reactionsPath}`] = [{
        delayMs: 25,
        status: 200,
        body: [],
        headers: { "Content-Length": String(8 * 1024 * 1024 + 1) },
      }];

      const result = await harness.runGate({
        eventName: "workflow_dispatch",
        event: { inputs: { pull_request: "1" } },
        env: { PR_NUMBER: "1" },
      });

      assert.equal(result.code, 1);
      assert.equal(successStatusWrites(harness), 0);
      assert.equal(harness.statuses.at(-1).body.state, "pending");
      assert.match(result.stderr, /response-byte budget exceeded/);
      assert.doesNotMatch(
        result.stderr,
        /Codex finding must contain only exact full-SHA github\.com blob links/,
      );
    });
  });

  await t.test("a childless parent wrapper remains invalid when another channel exceeds its budget", async () => {
    await withHarness(async (harness) => {
      const reactionsPath =
        `/repos/${harness.owner}/${harness.repo}/issues/${harness.prNumber}/reactions`;
      harness.reviews.push({
        id: 9100,
        state: "COMMENTED",
        commit_id: HEAD_SHA,
        submitted_at: "2026-05-14T10:00:01Z",
        body: codexInlineParentReviewBody(),
        user: codexBotUser(),
      });
      harness.routeFaults[`GET ${reactionsPath}`] = [{
        delayMs: 25,
        status: 200,
        body: [],
        headers: { "Content-Length": String(8 * 1024 * 1024 + 1) },
      }];

      const result = await harness.runGate({
        eventName: "workflow_dispatch",
        event: { inputs: { pull_request: "1" } },
        env: { PR_NUMBER: "1" },
      });

      assert.equal(result.code, 1);
      assert.equal(successStatusWrites(harness), 0);
      assert.equal(harness.statuses.at(-1).body.state, "error");
      assert.match(
        result.stderr,
        /Codex finding must contain only exact full-SHA github\.com blob links/,
      );
      assert.doesNotMatch(result.stderr, /response-byte budget exceeded/);
    });
  });

  await t.test("an unavailable inline-comment channel keeps a possible parent wrapper pending", async () => {
    await withHarness(async (harness) => {
      const reviewCommentsPath =
        `/repos/${harness.owner}/${harness.repo}/pulls/${harness.prNumber}/comments`;
      harness.reviews.push({
        id: 9100,
        state: "COMMENTED",
        commit_id: HEAD_SHA,
        submitted_at: "2026-05-14T10:00:01Z",
        body: codexInlineParentReviewBody(),
        user: codexBotUser(),
      });
      harness.routeFaults[`GET ${reviewCommentsPath}`] = Array.from(
        { length: 4 },
        () => ({
          status: 503,
          body: { message: "temporary inline-comment-channel failure" },
          headers: { "Retry-After": "0" },
        }),
      );

      const result = await harness.runGate({
        eventName: "workflow_dispatch",
        event: { inputs: { pull_request: "1" } },
        env: { PR_NUMBER: "1" },
      });

      assert.equal(result.code, 1);
      assert.equal(successStatusWrites(harness), 0);
      assert.equal(harness.statuses.at(-1).body.state, "pending");
      assert.match(result.stderr, /exhausted its retry budget/);
      assert.doesNotMatch(
        result.stderr,
        /Codex finding must contain only exact full-SHA github\.com blob links/,
      );
    });
  });

  await t.test("an unavailable review-thread channel keeps a possible parent wrapper pending", async () => {
    await withHarness(async (harness) => {
      harness.reviews.push({
        id: 9100,
        state: "COMMENTED",
        commit_id: HEAD_SHA,
        submitted_at: "2026-05-14T10:00:01Z",
        body: codexInlineParentReviewBody(),
        user: codexBotUser(),
      });
      harness.routeFaults["POST /graphql"] = Array.from({ length: 4 }, () => ({
        status: 200,
        body: {
          errors: [{
            type: "RATE_LIMITED",
            message: "temporary review-thread-channel failure",
          }],
        },
        headers: { "Retry-After": "0" },
      }));

      const result = await harness.runGate({
        eventName: "workflow_dispatch",
        event: { inputs: { pull_request: "1" } },
        env: { PR_NUMBER: "1" },
      });

      assert.equal(result.code, 1);
      assert.equal(successStatusWrites(harness), 0);
      assert.equal(harness.statuses.at(-1).body.state, "pending");
      assert.match(result.stderr, /exhausted its retry budget/);
      assert.doesNotMatch(
        result.stderr,
        /Codex finding must contain only exact full-SHA github\.com blob links/,
      );
    });
  });

  await t.test("cross-channel transient inline evidence keeps a possible parent wrapper pending", async () => {
    await withHarness(async (harness) => {
      const reactionsPath =
        `/repos/${harness.owner}/${harness.repo}/issues/${harness.prNumber}/reactions`;
      harness.reviews.push({
        id: 9100,
        state: "COMMENTED",
        commit_id: HEAD_SHA,
        submitted_at: "2026-05-14T10:00:01Z",
        body: codexInlineParentReviewBody(),
        user: codexBotUser(),
      });
      harness.reviewComments.push({
        ...currentHeadInlineFinding(3001),
        pull_request_review_id: 9100,
      });
      harness.routeFaults[`GET ${reactionsPath}`] = [{
        delayMs: 25,
        status: 200,
        body: [],
        headers: { "Content-Length": String(8 * 1024 * 1024 + 1) },
      }];

      const result = await harness.runGate({
        eventName: "workflow_dispatch",
        event: { inputs: { pull_request: "1" } },
        env: { PR_NUMBER: "1" },
      });

      assert.equal(result.code, 1);
      assert.equal(successStatusWrites(harness), 0);
      assert.equal(harness.statuses.at(-1).body.state, "pending");
      assert.match(result.stderr, /response-byte budget exceeded/);
      assert.doesNotMatch(
        result.stderr,
        /Codex finding must contain only exact full-SHA github\.com blob links/,
      );
    });
  });

  await t.test("an incomplete provider channel preserves pending", async () => {
    await withHarness(async (harness) => {
      const reviewsPath =
        `/repos/${harness.owner}/${harness.repo}/pulls/${harness.prNumber}/reviews`;
      harness.issueComments.push(codexMalformedTerminal(2001));
      harness.routeFaults[`GET ${reviewsPath}`] = Array.from(
        { length: 4 },
        () => ({
          status: 503,
          body: { message: "temporary review-channel failure" },
          headers: { "Retry-After": "0" },
        }),
      );

      const result = await harness.runGate({
        eventName: "workflow_dispatch",
        event: { inputs: { pull_request: "1" } },
        env: { PR_NUMBER: "1" },
      });

      assert.equal(result.code, 1);
      assert.equal(successStatusWrites(harness), 0);
      assert.equal(harness.statuses.at(-1).body.state, "pending");
      assert.match(result.stderr, /exhausted its retry budget/);
      assert.doesNotMatch(result.stderr, /exactly one Reviewed commit marker/);
    });
  });
});

test("review-thread comment pagination uses the bounded production worker pool", async () => {
  await withHarness(async (harness) => {
    harness.threadCommentDelayMs = 25;
    harness.reviewThreads = Array.from({ length: 8 }, (_, index) =>
      unresolvedThread(8000 + index, { resolved: true }));
    harness.threadCommentPages = Object.fromEntries(
      harness.reviewThreads.map((thread) => [thread.id, [[], []]]),
    );

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.activeThreadCommentRequests, 0);
    assert.equal(harness.maxActiveThreadCommentRequests, 4);
    assert.equal(
      harness.requestLog.filter((entry) =>
        entry.path === "/graphql" &&
        entry.body?.variables?.threadId !== undefined,
      ).length,
      8,
    );
  });
});

test("GraphQL opaque identity preserves a paginated unresolved finding above 32-bit range", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    harness.reviews.push({
      id: 9100,
      state: "COMMENTED",
      commit_id: OLD_HEAD_SHA,
      submitted_at: "2026-05-14T09:30:00Z",
      body: "",
      user: codexBotUser(),
    });
    harness.reviewComments.push({
      ...currentHeadInlineFinding(LARGE_INLINE_COMMENT_ID),
      pull_request_review_id: 9100,
      commit_id: HEAD_SHA,
      original_commit_id: OLD_HEAD_SHA,
    });
    const thread = unresolvedThread(LARGE_INLINE_COMMENT_ID, { outdated: true });
    harness.reviewThreadPages = [[], [thread]];
    harness.threadCommentPages = {
      [thread.id]: [[], [graphqlReviewCommentIdentity(LARGE_INLINE_COMMENT_ID)]],
    };

    const result = await harness.runGate({
      eventName: "pull_request_review_comment",
      event: {
        pull_request: { number: 1 },
        comment: { user: { login: "chatgpt-codex-connector[bot]" } },
      },
      env: { EVENT_MODE_INPUT: "full" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "failure");
    assert.equal(
      harness.requestLog.filter((entry) => entry.path === "/graphql").length >= 3,
      true,
    );
  });
});

test("a pre-marker clean stays pending after initial audit-state comment failure", async () => {
  await withHarness(async (harness) => {
    harness.issueComments.push(codexCleanComment(2001));
    harness.routeFaults[
      `POST /repos/${harness.owner}/${harness.repo}/issues/${harness.prNumber}/comments`
    ] = [{
      status: 503,
      body: { message: "temporary audit-state failure" },
      headers: { "Retry-After": "0" },
    }];

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    assert.match(result.stderr, /failed to save initial audit state/);
    assert.equal(harness.findMarkerComments().length, 1);
  });
});

test("pending evidence writes pending before an initial audit-state retry succeeds", async () => {
  await withHarness(async (harness) => {
    harness.routeFaults[
      `POST /repos/${harness.owner}/${harness.repo}/issues/${harness.prNumber}/comments`
    ] = [{
      status: 503,
      body: { message: "temporary audit-state failure" },
      headers: { "Retry-After": "0" },
    }];

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    assert.match(result.stderr, /failed to save initial audit state/);
  });
});

test("a stale live success is demoted after an unsaved clean result disappears", async () => {
  await withHarness(async (harness) => {
    harness.seedFailedFindingsState({ id: 2000 });
    harness.issueComments.push(codexCleanComment(2001));
    harness.routeFaults[
      `PATCH /repos/${harness.owner}/${harness.repo}/issues/comments/1000`
    ] = Array.from({ length: 4 }, () => ({
      status: 503,
      body: { message: "temporary audit-state failure" },
      headers: { "Retry-After": "0" },
    }));

    const first = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: codexCleanComment(2001),
      },
    });
    assert.equal(first.code, 0, first.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "success");

    harness.issueComments = harness.issueComments.filter((comment) => comment.id !== 2001);
    harness.routeFaults = {};
    const second = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(second.code, 0, second.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
  });
});

test("deterministic evidence errors take precedence over simultaneous findings", async () => {
  await withHarness(async (harness) => {
    harness.issueComments.push(codexMalformedTerminal(2001, "2026-05-14T10:00:00Z"));
    harness.reviewComments.push(currentHeadInlineFinding(3001));
    harness.reviewThreads.push(unresolvedThread(3001));

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(harness.statuses.at(-1).body.state, "error");
    assert.equal(harness.statuses.some((status) => status.body.state === "failure"), false);
  });
});

test("a finding records controlled failed lineage after initial audit-state creation fails", async () => {
  await withHarness(async (harness) => {
    harness.reviewComments.push(currentHeadInlineFinding(3001));
    harness.reviewThreads.push(unresolvedThread(3001));
    harness.routeFaults[
      `POST /repos/${harness.owner}/${harness.repo}/issues/${harness.prNumber}/comments`
    ] = [{
      status: 503,
      body: { message: "temporary audit-state failure" },
      headers: { "Retry-After": "0" },
    }];

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "failure");
    assert.match(result.stderr, /failed to save initial audit state/);
    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.lastStatus.state, "failure");
    assert.equal(state.activeMarker, null);
    assert.equal(state.history.at(-1).outcome, "failed_findings");
    assert.equal(state.history.at(-1).currentHeadFindings.count, 1);
    assert.equal(markerCommentWrites(harness), 1);
  });
});

test("an active marker cannot reuse a clean result that predates its request", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    harness.issueComments.push(codexCleanComment(2001, "2026-05-14T09:50:00Z"));

    const result = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    assert.notEqual(parseStateCommentBody(harness.findStateComment().body).lastStatus.state, "success");
  });
});

test("final reload cannot fall back from a post-marker clean to a baseline clean", async () => {
  await withHarness(async (harness) => {
    const baseline = codexCleanComment(1999, "2026-05-14T09:50:00Z");
    harness.seedActiveMarker({
      id: 2000,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: {
          id: String(baseline.id),
          createdAt: baseline.created_at,
          user: baseline.user.login,
          url: baseline.html_url,
        },
        approvedReview: null,
        submittedReview: null,
      },
    });
    harness.issueComments.push(
      baseline,
      codexCleanComment(2001, "2026-05-14T09:57:00Z"),
    );
    harness.afterSnapshotLoad(2, {
      action: "removeIssueComment",
      id: 2001,
    });

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(harness.statuses.some((status) => status.body.state === "success"), false);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    assert.match(result.stderr, /is not authorized by active-marker/);
  });
});

test("an intermediate clean supersedes its finding before a later divergent-head clean", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 1900,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:45:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    harness.compareResults[`${OLD_HEAD_SHA}...${HEAD_SHA}`] = {
      status: "diverged",
      base_commit: { sha: OLD_HEAD_SHA },
      head_commit: { sha: HEAD_SHA },
      merge_base_commit: { sha: NEW_HEAD_SHA },
    };
    harness.issueComments.push(
      codexThreadlessFinding(2001, OLD_HEAD_SHA, "2026-05-14T09:50:00Z"),
      codexCleanComment(2003, "2026-05-14T10:00:00Z"),
    );
    harness.reviews.push({
      id: 4002,
      state: "APPROVED",
      commit_id: OLD_HEAD_SHA,
      submitted_at: "2026-05-14T09:55:00Z",
      body: "Looks good.",
      user: codexBotUser(),
    });

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "success");
  });
});

test("missing GraphQL pageInfo makes the current snapshot incomplete", async () => {
  await withHarness(async (harness) => {
    harness.routeFaults["POST /graphql"] = [{
      status: 200,
      body: {
        data: {
          repository: {
            pullRequest: {
              reviewThreads: { nodes: [] },
            },
          },
        },
      },
    }];

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(harness.statuses.at(-1).body.state, "error");
    assert.match(result.stderr, /did not return complete pageInfo/);
  });
});

test("repeated GraphQL cursors fail closed instead of looping", async () => {
  await withHarness(async (harness) => {
    harness.reviewThreadPages = [
      {
        nodes: [],
        pageInfo: { hasNextPage: true, endCursor: "same-thread-cursor" },
      },
      {
        after: "same-thread-cursor",
        nodes: [],
        pageInfo: { hasNextPage: true, endCursor: "same-thread-cursor" },
      },
    ];

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(harness.statuses.at(-1).body.state, "error");
    assert.match(result.stderr, /reviewThreads pagination cursor did not advance/);
    assert.equal(
      harness.requestLog.filter((entry) => entry.path === "/graphql").length,
      2,
    );
  });

  await withHarness(async (harness) => {
    const thread = unresolvedThread(3001);
    harness.reviewThreadPages = [[thread]];
    harness.threadCommentPages = {
      [thread.id]: [
        {
          nodes: [],
          pageInfo: { hasNextPage: true, endCursor: "same-comment-cursor" },
        },
        {
          after: "same-comment-cursor",
          nodes: [],
          pageInfo: { hasNextPage: true, endCursor: "same-comment-cursor" },
        },
      ],
    };

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(harness.statuses.at(-1).body.state, "error");
    assert.match(result.stderr, /comments pagination cursor did not advance/);
    assert.equal(
      harness.requestLog.filter((entry) => entry.path === "/graphql").length,
      2,
    );
  });
});

test("explicit REST and GraphQL rate limits exhaust to pending", async () => {
  await withHarness(async (harness) => {
    harness.routeFaults[
      `GET /repos/${harness.owner}/${harness.repo}/issues/${harness.prNumber}/comments`
    ] = Array.from({ length: 4 }, () => ({
      status: 403,
      body: { message: "API rate limit exceeded" },
      headers: { "X-RateLimit-Remaining": "0", "Retry-After": "0" },
    }));

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });
    assert.equal(result.code, 1);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
  });

  await withHarness(async (harness) => {
    harness.routeFaults["POST /graphql"] = Array.from({ length: 4 }, () => ({
      status: 200,
      body: {
        errors: [{
          type: "RATE_LIMITED",
          message: "API rate limit exceeded",
        }],
      },
      headers: { "Retry-After": "0" },
    }));

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });
    assert.equal(result.code, 1);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
  });
});

test("a message-only REST secondary rate limit without a server delay is pending immediately", async () => {
  await withHarness(async (harness) => {
    const commentsPath =
      `/repos/${harness.owner}/${harness.repo}/issues/${harness.prNumber}/comments`;
    harness.routeFaults[`GET ${commentsPath}`] = [{
      status: 403,
      body: {
        message: "You have exceeded a secondary rate limit.",
        documentation_url:
          "https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api",
      },
    }];

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(
      harness.requestLog.filter((entry) =>
        entry.method === "GET" && entry.path === commentsPath,
      ).length,
      1,
    );
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    assert.match(result.stderr, /secondary rate limit/i);
  });
});

test("a message-only REST secondary rate limit honors Retry-After before retrying", async () => {
  await withHarness(async (harness) => {
    const commentsPath =
      `/repos/${harness.owner}/${harness.repo}/issues/${harness.prNumber}/comments`;
    harness.routeFaults[`GET ${commentsPath}`] = [{
      status: 403,
      body: {
        message: "You have exceeded a secondary rate limit.",
        documentation_url:
          "https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api",
      },
      headers: { "Retry-After": "0" },
    }];

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      harness.requestLog.filter((entry) =>
        entry.method === "GET" && entry.path === commentsPath,
      ).length,
      2,
    );
    assert.equal(harness.statuses.at(-1).body.state, "pending");
  });
});

test("a message-only GraphQL 403 rate limit without a server delay is pending immediately", async () => {
  await withHarness(async (harness) => {
    harness.routeFaults["POST /graphql"] = [{
      status: 403,
      body: {
        errors: [{
          message: "You have exceeded a secondary rate limit.",
        }],
      },
    }];

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(
      harness.requestLog.filter((entry) => entry.path === "/graphql").length,
      1,
    );
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    assert.match(result.stderr, /exhausted its retry budget after 403/i);
  });
});

test("oversized Retry-After fails fast for REST and GraphQL evidence reads", async () => {
  await withHarness(async (harness) => {
    const commentsPath =
      `/repos/${harness.owner}/${harness.repo}/issues/${harness.prNumber}/comments`;
    harness.routeFaults[`GET ${commentsPath}`] = [{
      status: 503,
      body: { message: "service unavailable" },
      headers: { "Retry-After": "11" },
    }];

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(
      harness.requestLog.filter((entry) =>
        entry.method === "GET" && entry.path === commentsPath,
      ).length,
      1,
    );
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    assert.match(result.stderr, /above the 10s in-process limit/);
  });

  await withHarness(async (harness) => {
    harness.routeFaults["POST /graphql"] = [{
      status: 503,
      rawText: "<html>temporarily unavailable</html>",
      headers: { "Retry-After": "11" },
    }];

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(
      harness.requestLog.filter((entry) => entry.path === "/graphql").length,
      1,
    );
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    assert.match(result.stderr, /above the 10s in-process limit/);
  });
});

test("malformed Retry-After falls back to bounded retries", async () => {
  await withHarness(async (harness) => {
    const commentsPath =
      `/repos/${harness.owner}/${harness.repo}/issues/${harness.prNumber}/comments`;
    harness.routeFaults[`GET ${commentsPath}`] = [{
      status: 429,
      body: { message: "too many requests" },
      headers: { "Retry-After": "not-a-delay" },
    }];

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      harness.requestLog.filter((entry) =>
        entry.method === "GET" && entry.path === commentsPath,
      ).length,
      2,
    );
  });

  await withHarness(async (harness) => {
    harness.routeFaults["POST /graphql"] = [{
      status: 503,
      body: { message: "service unavailable" },
      headers: { "Retry-After": "1.5" },
    }];

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      harness.requestLog.filter((entry) => entry.path === "/graphql").length,
      2,
    );
  });
});

test("Retry-After does not make a non-retryable GraphQL status retryable", async () => {
  await withHarness(async (harness) => {
    harness.routeFaults["POST /graphql"] = [{
      status: 422,
      body: { message: "unprocessable query" },
      headers: { "Retry-After": "11" },
    }];

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(
      harness.requestLog.filter((entry) => entry.path === "/graphql").length,
      1,
    );
    assert.equal(harness.statuses.at(-1).body.state, "error");
    assert.match(result.stderr, /failed with 422/);
  });
});

test("Retry-After preserves safe PATCH and commit-status POST retries", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 1900,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    harness.reviewComments.push(currentHeadInlineFinding(3001));
    harness.reviewThreads.push(unresolvedThread(3001));
    const statePath =
      `PATCH /repos/${harness.owner}/${harness.repo}/issues/comments/1000`;
    const statusPath =
      `POST /repos/${harness.owner}/${harness.repo}/statuses/${HEAD_SHA}`;
    const retryableRateLimit = {
      status: 403,
      body: { message: "You have exceeded a secondary rate limit." },
      headers: { "Retry-After": "0" },
    };
    harness.routeFaults[statePath] = [retryableRateLimit];
    harness.routeFaults[statusPath] = [retryableRateLimit];

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      harness.requestLog.filter((entry) =>
        entry.method === "PATCH" &&
          entry.path.endsWith("/issues/comments/1000"),
      ).length,
      2,
    );
    assert.equal(
      harness.requestLog.filter((entry) =>
        entry.method === "POST" &&
          entry.path.endsWith(`/statuses/${HEAD_SHA}`),
      ).length,
      2,
    );
    assert.deepEqual(
      harness.statuses.map((status) => status.body.state),
      ["failure"],
    );
  });
});

test("a transient REST or GraphQL orphan is recovered by a bounded whole-snapshot reload", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 1900,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    harness.issueComments.push(codexCleanComment(2001));
    harness.reviewThreads.push(unresolvedThread(3997));
    harness.afterSnapshotLoad(2, {
      action: "pushReviewComment",
      value: currentHeadInlineFinding(3997),
    });

    const result = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: codexCleanComment(2001),
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.snapshotLoads, 2);
    assert.equal(harness.statuses.at(-1).body.state, "failure");
  });

  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 1900,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    harness.issueComments.push(codexCleanComment(2001));
    harness.reviewComments.push(currentHeadInlineFinding(3998));
    harness.afterSnapshotLoad(2, {
      action: "pushReviewThread",
      value: unresolvedThread(3998),
    });

    const result = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: codexCleanComment(2001),
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.snapshotLoads, 2);
    assert.equal(harness.statuses.at(-1).body.state, "failure");
  });
});

test("a parent review appearing on whole-snapshot reload recovers a transient inline race", async () => {
  await withHarness(async (harness) => {
    const parentReview = {
      id: 9100,
      state: "COMMENTED",
      commit_id: HEAD_SHA,
      submitted_at: "2026-05-14T09:59:00Z",
      body: "",
      user: codexBotUser(),
    };
    harness.reviewComments.push({
      ...currentHeadInlineFinding(3001),
      pull_request_review_id: parentReview.id,
    });
    harness.reviewThreads.push(unresolvedThread(3001));
    harness.afterSnapshotLoad(2, {
      action: "pushReview",
      value: parentReview,
    });

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.snapshotLoads, 2);
    assert.equal(harness.statuses.at(-1).body.state, "failure");
    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.lastStatus.state, "failure");
    assert.equal(state.activeMarker, null);
    assert.equal(state.history.at(-1).outcome, "failed_findings");
    assert.equal(state.history.at(-1).currentHeadFindings.count, 1);
    assert.equal(markerCommentWrites(harness), 1);
  });
});

test("a child comment appearing on reload recovers the symmetric parent-first race", async () => {
  await withHarness(async (harness) => {
    const parentReview = {
      id: 9100,
      state: "COMMENTED",
      commit_id: HEAD_SHA,
      submitted_at: "2026-05-14T09:59:00Z",
      body: "",
      user: codexBotUser(),
    };
    harness.reviews.push(parentReview);
    harness.afterSnapshotLoad(2, {
      action: "pushReviewComment",
      value: {
        ...currentHeadInlineFinding(3001),
        pull_request_review_id: parentReview.id,
      },
    });
    harness.afterSnapshotLoad(2, {
      action: "pushReviewThread",
      value: unresolvedThread(3001),
    });

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.snapshotLoads, 2);
    assert.equal(harness.statuses.at(-1).body.state, "failure");
    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.lastStatus.state, "failure");
    assert.equal(state.activeMarker, null);
    assert.equal(state.history.at(-1).outcome, "failed_findings");
    assert.equal(state.history.at(-1).currentHeadFindings.count, 1);
    assert.equal(markerCommentWrites(harness), 1);
  });
});

test("a nonempty unknown COMMENTED parent is deterministically malformed without reload", async () => {
  await withHarness(async (harness) => {
    harness.reviews.push({
      id: 9100,
      state: "COMMENTED",
      commit_id: HEAD_SHA,
      submitted_at: "2026-05-14T10:00:00Z",
      body: "Parent review whose inline child never became visible.",
      user: codexBotUser(),
    });

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(harness.snapshotLoads, 1);
    assert.equal(harness.statuses.at(-1).body.state, "error");
    assert.match(result.stderr, /unrecognized Codex terminal pull-request-review format/);
  });
});

test("a newer clean supersedes an older persistent COMMENTED parent without children", async () => {
  await withHarness(async (harness) => {
    harness.seedSuccessfulState({ providerId: 2001 });
    harness.issueComments.push(codexCleanComment(2001));
    harness.reviews.push({
      id: 9100,
      state: "COMMENTED",
      commit_id: HEAD_SHA,
      submitted_at: "2026-05-14T09:59:00Z",
      body: "Older parent review whose inline child never became visible.",
      user: codexBotUser(),
    });

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.snapshotLoads, 2);
    assert.equal(harness.statuses.at(-1).body.state, "success");
  });
});

test("a persistently missing parent review leaves the complete snapshot pending", async () => {
  await withHarness(async (harness) => {
    harness.reviewComments.push({
      ...currentHeadInlineFinding(3001),
      pull_request_review_id: 9100,
    });
    harness.reviewThreads.push(unresolvedThread(3001));

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(harness.snapshotLoads, 2);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    assert.equal(harness.statuses.some((status) => status.body.state === "success"), false);
    assert.match(result.stderr, /review comment 3001 has no loaded parent review/);
  });
});

test("a persistent page-complete unresolved GraphQL orphan remains pending", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 1900,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    harness.issueComments.push(codexCleanComment(2001));
    const orphanThread = unresolvedThread(3999);
    harness.threadCommentPages = {
      [orphanThread.id]: [[], [graphqlReviewCommentIdentity(3999)]],
    };
    harness.afterPullLoad(2, {
      action: "pushReviewThread",
      value: orphanThread,
    });

    const result = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: codexCleanComment(2001),
      },
    });

    assert.equal(result.code, 1);
    assert.equal(harness.statuses.some((status) => status.body.state === "success"), false);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    assert.match(result.stderr, /missing from the complete REST review-comment snapshot/);
    assert.equal(harness.snapshotLoads, 3);
  });
});

test("a deterministic REST and GraphQL identity conflict errors without a whole-snapshot reload", async () => {
  await withHarness(async (harness) => {
    harness.reviewComments.push(currentHeadInlineFinding(3999));
    harness.reviewThreads.push({
      ...unresolvedThread(3999),
      comments: {
        nodes: [{
          id: reviewCommentNodeId(4999),
          fullDatabaseId: "3999",
        }],
      },
    });
    harness.afterSnapshotLoad(2, {
      action: "routeFault",
      route: "POST /graphql",
      faults: Array.from({ length: 4 }, () => ({
        status: 503,
        body: { message: "a deterministic conflict must not reach this reload" },
        headers: { "Retry-After": "0" },
      })),
    });

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 1);
    assert.equal(harness.snapshotLoads, 1);
    assert.equal(
      harness.requestLog.filter((entry) => entry.path === "/graphql").length,
      1,
    );
    assert.equal(harness.statuses.at(-1).body.state, "error");
    assert.match(result.stderr, /conflicting node_id/);
  });
});

test("success reads live status and PR before the final snapshot, then posts immediately", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 1900,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    harness.issueComments.push(codexCleanComment(2001));

    const result = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: codexCleanComment(2001),
      },
    });

    assert.equal(result.code, 0, result.stderr);
    const statusGetIndex = harness.requestLog.findLastIndex((entry) =>
      entry.method === "GET" && entry.path.endsWith(`/commits/${HEAD_SHA}/statuses`),
    );
    const pullGetIndex = harness.requestLog.findLastIndex((entry) =>
      entry.method === "GET" && entry.path.endsWith("/pulls/1"),
    );
    const finalCommentsIndex = harness.requestLog.findLastIndex((entry) =>
      entry.method === "GET" && entry.path.endsWith("/issues/1/comments"),
    );
    const successPostIndex = harness.requestLog.findLastIndex((entry) =>
      entry.method === "POST" &&
        entry.path.endsWith(`/statuses/${HEAD_SHA}`) &&
        entry.body?.state === "success",
    );

    assert.equal(statusGetIndex < pullGetIndex, true);
    assert.equal(pullGetIndex < finalCommentsIndex, true);
    assert.equal(finalCommentsIndex < successPostIndex, true);
    assert.equal(successPostIndex > 0, true);
    assert.equal(harness.requestLog[successPostIndex - 1].method === "GET" ||
      harness.requestLog[successPostIndex - 1].path === "/graphql", true);
  });
});

test("final success reuses its cached live-status read for dedupe and repair", async () => {
  for (const liveState of ["error", "pending", null]) {
    await withHarness(async (harness) => {
      seedCleanActiveMarker(harness);
      if (liveState) {
        harness.commitStatuses.push({
          sha: HEAD_SHA,
          context: "codex/review-gate",
          state: liveState,
        });
      }

      const result = await harness.runGate({
        eventName: "issue_comment",
        event: {
          issue: { number: 1, pull_request: {} },
          comment: codexCleanComment(2001),
        },
      });

      assert.equal(result.code, 0, result.stderr);
      assert.equal(statusReads(harness), 1);
      assert.equal(successStatusWrites(harness), 1);
      assert.equal(harness.statuses.at(-1).body.state, "success");
    });
  }

  await withHarness(async (harness) => {
    seedCleanActiveMarker(harness);
    harness.commitStatuses.push(
      {
        sha: HEAD_SHA,
        context: "codex/review-gate",
        state: "success",
        creator: { login: "github-actions[bot]", type: "Bot" },
      },
      {
        sha: HEAD_SHA,
        context: "codex/review-gate",
        state: "error",
        creator: { login: "external-integration[bot]", type: "Bot" },
      },
    );

    const result = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: codexCleanComment(2001),
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(statusReads(harness), 1);
    assert.equal(successStatusWrites(harness), 0);
    assert.equal(parseStateCommentBody(harness.findStateComment().body).lastStatus.state, "success");
  });

  await withHarness(async (harness) => {
    seedCleanActiveMarker(harness);
    const statusesPath =
      `/repos/${harness.owner}/${harness.repo}/commits/${HEAD_SHA}/statuses`;
    harness.routeFaults[`GET ${statusesPath}`] = Array.from({ length: 4 }, () => ({
      status: 503,
      body: { message: "status read unavailable" },
      headers: { "Retry-After": "0" },
    }));

    const result = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: codexCleanComment(2001),
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(statusReads(harness), 4);
    assert.equal(successStatusWrites(harness), 1);
    assert.equal(harness.statuses.at(-1).body.state, "success");
  });
});

test("success dedupe ignores same-context statuses from external or missing producers", async () => {
  const producers = [
    [
      "external",
      { login: "external-integration[bot]", type: "Bot" },
    ],
    ["missing", null],
  ];

  for (const [producerLabel, creator] of producers) {
    for (const liveState of ["error", "pending"]) {
      await withHarness(async (harness) => {
        seedCleanActiveMarker(harness);
        harness.commitStatuses.push(
          {
            sha: HEAD_SHA,
            context: "codex/review-gate",
            state: liveState,
            creator,
          },
          {
            sha: HEAD_SHA,
            context: "codex/review-gate",
            state: "success",
            creator: {
              login: "github-actions[bot]",
              type: "Bot",
            },
          },
        );

        const result = await harness.runGate({
          eventName: "issue_comment",
          event: {
            issue: { number: 1, pull_request: {} },
            comment: codexCleanComment(2001),
          },
        });

        const scenario = `${producerLabel} ${liveState}`;
        assert.equal(result.code, 0, `${scenario}: ${result.stderr}`);
        assert.equal(statusReads(harness), 1, scenario);
        assert.equal(successStatusWrites(harness), 1, scenario);
        assert.equal(harness.statuses.at(-1).body.state, "success", scenario);
      });
    }
  }
});

test("a final success status write is not retried after an explicit rate-limit response", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 1900,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    harness.issueComments.push(codexCleanComment(2001));
    harness.routeFaults[
      `POST /repos/${harness.owner}/${harness.repo}/statuses/${HEAD_SHA}`
    ] = [{
      status: 403,
      body: { message: "You have exceeded a secondary rate limit." },
      headers: { "Retry-After": "0" },
    }];

    const result = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: codexCleanComment(2001),
      },
    });

    assert.equal(result.code, 1);
    const successWrites = harness.requestLog.filter((entry) =>
      entry.method === "POST" &&
        entry.path.endsWith(`/statuses/${HEAD_SHA}`) &&
        entry.body?.state === "success",
    );
    assert.equal(successWrites.length, 1);
    assert.equal(harness.statuses.some((status) => status.body.state === "success"), false);
    assert.equal(harness.statuses.at(-1).body.state, "error");
  });
});

test("an ambiguous success response is compensated with error after the success persisted", async () => {
  await withHarness(async (harness) => {
    seedCleanActiveMarker(harness);
    harness.routeFaults[
      `POST /repos/${harness.owner}/${harness.repo}/statuses/${HEAD_SHA}`
    ] = [{
      afterMutation: true,
      status: 503,
      body: { message: "ambiguous success write response" },
      headers: { "Retry-After": "0" },
    }];

    const result = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: codexCleanComment(2001),
      },
    });

    assert.equal(result.code, 1);
    assert.deepEqual(
      harness.statuses.map((status) => status.body.state),
      ["success", "error"],
    );
    assert.match(result.stderr, /success.*(?:persist|ambiguous)|ambiguous.*success/i);
  });
});

test("a persisted success whose fetch hangs until abort is compensated with error", async () => {
  await withHarness(async (harness) => {
    seedCleanActiveMarker(harness);
    harness.routeFaults[
      `POST /repos/${harness.owner}/${harness.repo}/statuses/${HEAD_SHA}`
    ] = [{
      afterMutation: true,
      hangUntilAbort: true,
    }];

    const result = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: codexCleanComment(2001),
      },
      env: { CODEX_REVIEW_GATE_REQUEST_TIMEOUT_SECONDS: "0.01" },
    });

    assert.equal(result.code, 1);
    assert.equal(successStatusWrites(harness), 1);
    assert.deepEqual(
      harness.statuses.map((status) => status.body.state),
      ["success", "error"],
    );
    assert.match(result.stderr, /attempt deadline/i);
  });
});

test("a persisted success whose response body hangs until abort is compensated with error", async () => {
  await withHarness(async (harness) => {
    seedCleanActiveMarker(harness);
    harness.routeFaults[
      `POST /repos/${harness.owner}/${harness.repo}/statuses/${HEAD_SHA}`
    ] = [{
      afterMutation: true,
      hangBodyUntilAbort: true,
      status: 201,
      body: { id: 1 },
    }];

    const result = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: codexCleanComment(2001),
      },
      env: { CODEX_REVIEW_GATE_REQUEST_TIMEOUT_SECONDS: "0.01" },
    });

    assert.equal(result.code, 1);
    assert.equal(successStatusWrites(harness), 1);
    assert.deepEqual(
      harness.statuses.map((status) => status.body.state),
      ["success", "error"],
    );
    assert.match(result.stderr, /attempt deadline/i);
  });
});

test("an ambiguous persisted success remains explicit when compensation also fails", async () => {
  await withHarness(async (harness) => {
    seedCleanActiveMarker(harness);
    harness.routeFaults[
      `POST /repos/${harness.owner}/${harness.repo}/statuses/${HEAD_SHA}`
    ] = [
      {
        afterMutation: true,
        status: 503,
        body: { message: "ambiguous success write response" },
        headers: { "Retry-After": "0" },
      },
      ...Array.from({ length: 4 }, () => ({
        status: 503,
        body: { message: "compensating error write unavailable" },
        headers: { "Retry-After": "0" },
      })),
    ];

    const result = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: codexCleanComment(2001),
      },
    });

    assert.equal(result.code, 1);
    assert.deepEqual(
      harness.statuses.map((status) => status.body.state),
      ["success"],
    );
    assert.match(result.stderr, /success.*(?:persist|ambiguous)|ambiguous.*success/i);
    assert.match(result.stderr, /failed to set final codex\/review-gate status/i);
  });
});

test("head-change findings close a controlled marker and recover on the normal signal path", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 1900,
      headSha: OLD_HEAD_SHA,
      createdAt: "2026-05-14T09:50:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
      stateHead: OLD_HEAD_SHA,
      pullHead: NEW_HEAD_SHA,
    });
    harness.reviewComments.push(currentHeadInlineFinding(3001));
    harness.reviewThreads.push(unresolvedThread(3001));

    const result = await harness.runGate({
      eventName: "pull_request_target",
      event: {
        pull_request: { number: 1, head: { sha: NEW_HEAD_SHA } },
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "failure");
    assert.equal(harness.findMarkerComments().length, 2);
    assert.equal(markerCommentWrites(harness), 1);
    let state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.activeMarker, null);
    assert.equal(state.history.at(-2).outcome, "obsolete_head");
    assert.equal(state.history.at(-2).headSha, OLD_HEAD_SHA);
    assert.equal(state.history.at(-1).outcome, "failed_findings");
    assert.equal(state.history.at(-1).headSha, NEW_HEAD_SHA);
    assert.equal(state.history.at(-1).currentHeadFindings.count, 1);
    assert.equal(state.lastStatus.headSha, NEW_HEAD_SHA);
    assert.equal(state.lastStatus.state, "failure");

    harness.reviewThreads[0].isResolved = true;
    const clean = codexCleanCommentForHead(
      2001,
      NEW_HEAD_SHA,
      "2026-05-14T10:02:00Z",
    );
    harness.commitResolutions[NEW_HEAD_SHA.slice(0, 10)] = NEW_HEAD_SHA;
    harness.issueComments.push(clean);
    const recoveryResult = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: clean,
      },
    });

    assert.equal(recoveryResult.code, 0, recoveryResult.stderr);
    state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(harness.statuses.at(-1).sha, NEW_HEAD_SHA);
    assert.equal(harness.statuses.at(-1).body.state, "success");
    assert.equal(markerCommentWrites(harness), 1);
    assert.equal(state.activeMarker, null);
    assert.equal(state.lastStatus.headSha, NEW_HEAD_SHA);
    assert.equal(state.lastStatus.state, "success");
    assert.equal(state.history.at(-1).outcome, "failed_findings");
  });
});

test("scheduled reconciliation safely migrates a legacy passed issue-comment lineage", async () => {
  await withHarness(async (harness) => {
    harness.seedLegacySuccessfulState({
      providerSource: "issue-comment",
      providerId: 2001,
    });
    harness.issueComments.push(codexCleanComment(2001));
    harness.commitStatuses.push({
      sha: HEAD_SHA,
      context: "codex/review-gate",
      state: "error",
    });

    const result = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.findMarkerComments().length, 1);
    assert.equal(harness.statuses.at(-1).body.state, "success");
    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.history.at(-1).observedProviderResult.source, "issue-comment");
    assert.equal(state.history.at(-1).observedProviderResult.id, "2001");
    assert.equal(
      state.history.at(-1).authorizationLineageMigratedAt,
      "2026-05-14T10:01:00.000Z",
    );
  });
});

test("scheduled reconciliation safely migrates a legacy passed review lineage", async () => {
  await withHarness(async (harness) => {
    harness.seedLegacySuccessfulState({
      providerSource: "pull-request-review",
      providerId: 4001,
      providerCreatedAt: "2026-05-14T10:00:00Z",
    });
    harness.reviews.push({
      id: 4001,
      state: "APPROVED",
      commit_id: HEAD_SHA,
      submitted_at: "2026-05-14T10:00:00Z",
      body: "Looks good.",
      user: codexBotUser(),
    });
    harness.commitStatuses.push({
      sha: HEAD_SHA,
      context: "codex/review-gate",
      state: "error",
    });

    const result = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.findMarkerComments().length, 1);
    assert.equal(harness.statuses.at(-1).body.state, "success");
    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(
      state.history.at(-1).observedProviderResult.source,
      "pull-request-review",
    );
    assert.equal(state.history.at(-1).observedProviderResult.id, "4001");
  });
});

test("legacy passed lineage mismatch requires a fresh marker instead of reasserting success", async () => {
  await withHarness(async (harness) => {
    harness.seedLegacySuccessfulState({
      providerSource: "issue-comment",
      providerId: 2002,
    });
    harness.issueComments.push(codexCleanComment(2001));
    harness.commitStatuses.push({
      sha: HEAD_SHA,
      context: "codex/review-gate",
      state: "error",
    });

    const result = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(successStatusWrites(harness), 0);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    assert.equal(harness.findMarkerComments().length, 2);
    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.activeMarker.state, "waiting_ack");
    assert.equal(state.activeMarker.baseline.completionComment.id, "2001");
  });
});

test("legacy passed lineage with incomplete last-status audit requires a fresh marker", async () => {
  await withHarness(async (harness) => {
    harness.seedLegacySuccessfulState({
      providerSource: "issue-comment",
      providerId: 2001,
    });
    const stateComment = harness.findStateComment();
    const state = parseStateCommentBody(stateComment.body);
    state.lastStatus.state = "pending";
    stateComment.body = stateCommentBody(state);
    harness.issueComments.push(codexCleanComment(2001));
    harness.commitStatuses.push({
      sha: HEAD_SHA,
      context: "codex/review-gate",
      state: "pending",
    });

    const result = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(successStatusWrites(harness), 0);
    assert.equal(harness.findMarkerComments().length, 2);
    assert.equal(
      parseStateCommentBody(harness.findStateComment().body).activeMarker.state,
      "waiting_ack",
    );
  });
});

test("legacy passed migration fails closed when the final provider artifact changes", async () => {
  await withHarness(async (harness) => {
    harness.seedLegacySuccessfulState({
      providerSource: "issue-comment",
      providerId: 2001,
    });
    harness.issueComments.push(codexCleanComment(2001));
    harness.afterSnapshotLoad(2, {
      action: "pushIssueComment",
      value: codexCleanComment(2002, "2026-05-14T10:01:01Z"),
    });
    harness.commitStatuses.push({
      sha: HEAD_SHA,
      context: "codex/review-gate",
      state: "error",
    });

    const result = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(result.code, 1);
    assert.equal(successStatusWrites(harness), 0);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    assert.match(result.stderr, /not authorized by passed-marker-reassert/);

    const recoveryResult = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(recoveryResult.code, 0, recoveryResult.stderr);
    assert.equal(successStatusWrites(harness), 0);
    assert.equal(harness.findMarkerComments().length, 2);
    const recoveredState = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(recoveredState.history.at(-1).outcome, "state_lost");
    assert.equal(
      recoveredState.history.at(-1).recoveryReason,
      "unauthorized_passed_result_lineage",
    );
    assert.equal(recoveredState.activeMarker.state, "waiting_ack");
    assert.equal(recoveredState.activeMarker.baseline.completionComment.id, "2002");
  });
});

test("passed-marker reassertion fails closed when the trusted marker lineage is missing", async () => {
  await withHarness(async (harness) => {
    harness.seedSuccessfulState();
    harness.issueComments = harness.issueComments.filter((comment) => comment.id !== 1999);
    harness.issueComments.push(codexCleanComment(2001));
    harness.commitStatuses.push({
      sha: HEAD_SHA,
      context: "codex/review-gate",
      state: "error",
    });

    const result = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.some((status) => status.body.state === "success"), false);
  });
});

test("authorization recovery starts a new max-wait cycle and processes the next ack", async () => {
  await withHarness(async (harness) => {
    const recoveryStartedAt = new Date(harness.now).toISOString();
    const recoveryMaxWaitDeadlineAt =
      new Date(harness.now + 7_200_000).toISOString();
    harness.seedSuccessfulState({
      headStartedAt: "2026-05-14T07:00:00Z",
      maxWaitDeadlineAt: "2026-05-14T09:00:00Z",
    });
    harness.issueComments.push(codexCleanComment(2002, "2026-05-14T10:01:01Z"));
    harness.commitStatuses.push({
      sha: HEAD_SHA,
      context: "codex/review-gate",
      state: "success",
    });

    const result = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(successStatusWrites(harness), 0);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    assert.equal(harness.findMarkerComments().length, 2);
    let state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.history.at(-1).outcome, "state_lost");
    assert.equal(
      state.history.at(-1).recoveryReason,
      "unauthorized_passed_result_lineage",
    );
    assert.equal(state.activeMarker.state, "waiting_ack");
    assert.equal(state.activeMarker.baseline.completionComment.id, "2002");
    assert.equal(state.history.at(-1).headStartedAt, "2026-05-14T07:00:00Z");
    assert.equal(state.activeMarker.headStartedAt, recoveryStartedAt);
    assert.equal(
      state.activeMarker.maxWaitDeadlineAt,
      recoveryMaxWaitDeadlineAt,
    );
    const freshMarkerId = state.activeMarker.id;
    harness.commentReactions.set(freshMarkerId, [{
      id: 5001,
      content: "eyes",
      created_at: "2026-05-14T10:01:02Z",
      user: { login: "chatgpt-codex-connector[bot]" },
    }]);

    const secondResult = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(secondResult.code, 0, secondResult.stderr);
    assert.doesNotMatch(
      secondResult.stdout,
      /has no active marker; skipping scheduled scan/,
    );
    assert.equal(harness.findMarkerComments().length, 2);
    state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.activeMarker.state, "waiting_result");
    assert.equal(state.activeMarker.observedEyes.id, "5001");
    assert.equal(state.activeMarker.headStartedAt, recoveryStartedAt);
    assert.equal(
      state.activeMarker.maxWaitDeadlineAt,
      recoveryMaxWaitDeadlineAt,
    );
    assert.equal(state.activeMarker.baseline.completionComment.id, "2002");
    assert.equal(
      state.history.some((marker) => marker.outcome === "timed_out"),
      false,
    );
  });
});

test("unauthorized passed clean invalidation fences failed state persistence before recovery", async () => {
  await withHarness(async (harness) => {
    harness.seedSuccessfulState();
    harness.issueComments.push(codexCleanComment(2002, "2026-05-14T10:01:01Z"));
    harness.commitStatuses.push({
      sha: HEAD_SHA,
      context: "codex/review-gate",
      state: "success",
    });
    harness.routeFaults[
      `PATCH /repos/${harness.owner}/${harness.repo}/issues/comments/1000`
    ] = Array.from({ length: 4 }, () => ({
      status: 503,
      body: { message: "definite state update failure" },
      headers: { "Retry-After": "0" },
    }));
    harness.routeFaults[
      `POST /repos/${harness.owner}/${harness.repo}/issues/${harness.prNumber}/comments`
    ] = [{
      status: 503,
      body: { message: "definite replacement state failure" },
      headers: { "Retry-After": "0" },
    }];

    const firstResult = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(firstResult.code, 1);
    assert.equal(successStatusWrites(harness), 0);
    assert.deepEqual(
      harness.statuses.map((status) => status.body.state),
      ["error"],
    );
    assert.match(firstResult.stderr, /published a durable marker-lineage fence/);
    assert.equal(
      parseMarkerCommentBody(harness.findMarkerComments().at(-1).body)
        .baseline.authorizationFence.reason,
      "unauthorized passed-result lineage invalidation",
    );

    const recoveryResult = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(recoveryResult.code, 0, recoveryResult.stderr);
    assert.equal(successStatusWrites(harness), 0);
    assert.equal(harness.findMarkerComments().length, 2);
    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.history.at(-1).outcome, "state_lost");
    assert.equal(
      state.history.at(-1).recoveryReason,
      "authorization_state_persistence_fence",
    );
    assert.equal(state.activeMarker.state, "waiting_ack");
    assert.equal(state.activeMarker.baseline.completionComment.id, "2002");
  });
});

test("failed or ambiguous pending demotion cannot replay formerly authorized clean evidence", async (t) => {
  for (const [name, afterMutation] of [
    ["failed", false],
    ["ambiguous", true],
  ]) {
    await t.test(name, async () => {
      await withHarness(async (harness) => {
        harness.seedSuccessfulState({ providerId: 2001 });
        harness.issueComments.push(
          codexCleanComment(2001),
          codexCleanComment(2002, "2026-05-14T10:01:01Z"),
        );
        harness.commitStatuses.push({
          sha: HEAD_SHA,
          context: "codex/review-gate",
          state: "success",
        });
        harness.routeFaults[
          `POST /repos/${harness.owner}/${harness.repo}/statuses/${HEAD_SHA}`
        ] = Array.from({ length: 4 }, () => ({
          ...(afterMutation ? { afterMutation: true } : {}),
          status: 503,
          body: { message: `${name} pending status response` },
          headers: { "Retry-After": "0" },
        }));

        const firstResult = await harness.runGate({
          eventName: "schedule",
          event: {},
        });

        assert.equal(firstResult.code, 1);
        assert.equal(successStatusWrites(harness), 0);
        const persistedState = parseStateCommentBody(harness.findStateComment().body);
        assert.equal(persistedState.history.at(-1).outcome, "state_lost");
        assert.equal(
          persistedState.history.at(-1).recoveryReason,
          "unauthorized_passed_result_lineage",
        );
        const invalidationWriteIndex = harness.requestLog.findIndex((entry) =>
          entry.method === "PATCH" &&
          entry.path.endsWith("/issues/comments/1000") &&
          entry.body?.body?.includes('"outcome": "state_lost"'));
        const pendingWriteIndex = harness.requestLog.findIndex((entry) =>
          entry.method === "POST" &&
          entry.path.endsWith(`/statuses/${HEAD_SHA}`) &&
          entry.body?.state === "pending");
        assert.ok(invalidationWriteIndex >= 0);
        if (pendingWriteIndex >= 0) {
          assert.ok(invalidationWriteIndex < pendingWriteIndex);
        }

        harness.issueComments = harness.issueComments.filter(
          (comment) => String(comment.id) !== "2002",
        );
        const replayResult = await harness.runGate({
          eventName: "schedule",
          event: {},
        });

        assert.equal(replayResult.code, 0, replayResult.stderr);
        assert.equal(successStatusWrites(harness), 0);
        const recoveredState = parseStateCommentBody(harness.findStateComment().body);
        assert.equal(recoveredState.history.at(-1).outcome, "state_lost");
        assert.equal(recoveredState.activeMarker.state, "waiting_ack");
        assert.equal(recoveredState.activeMarker.baseline.completionComment.id, "2001");
      });
    });
  }
});

test("unauthorized clean demotion ignores a newer external pending status", async () => {
  await withHarness(async (harness) => {
    harness.seedSuccessfulState();
    harness.issueComments = harness.issueComments.filter((comment) => comment.id !== 1999);
    harness.issueComments.push(codexCleanComment(2001));
    harness.commitStatuses.push(
      {
        sha: HEAD_SHA,
        context: "codex/review-gate",
        state: "pending",
        creator: {
          login: "external-integration[bot]",
          type: "Bot",
        },
      },
      {
        sha: HEAD_SHA,
        context: "codex/review-gate",
        state: "success",
        creator: {
          login: "github-actions[bot]",
          type: "Bot",
        },
      },
    );

    const result = await harness.runGate({
      eventName: "schedule",
      event: {},
      env: {
        TRUSTED_COMMENT_LOGINS:
          "github-actions[bot],external-integration[bot]",
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(
      harness.statuses.map((status) => status.body.state),
      ["pending"],
    );
    assert.equal(parseStateCommentBody(harness.findStateComment().body).lastStatus.state, "pending");
  });
});

test("a newer invalid-version marker blocks fallback to older recovery and reassert lineage", async () => {
  for (const versionMode of ["missing", "wrong"]) {
    await withHarness(async (harness) => {
      harness.seedFailedFindingsState({ id: 2000 });
      harness.issueComments.push(
        invalidVersionMarkerComment(2500, versionMode),
        codexCleanComment(2600),
      );

      const result = await harness.runGate({
        eventName: "issue_comment",
        event: {
          issue: { number: 1, pull_request: {} },
          comment: codexCleanComment(2600),
        },
      });

      assert.equal(result.code, 0, result.stderr);
      assert.equal(successStatusWrites(harness), 0);
      assert.notEqual(
        parseStateCommentBody(harness.findStateComment().body).lastStatus.state,
        "success",
      );
    });

    await withHarness(async (harness) => {
      harness.seedSuccessfulState();
      harness.issueComments.push(
        invalidVersionMarkerComment(2500, versionMode),
        codexCleanComment(2001),
      );
      harness.commitStatuses.push({
        sha: HEAD_SHA,
        context: "codex/review-gate",
        state: "success",
      });

      const result = await harness.runGate({
        eventName: "schedule",
        event: {},
      });

      assert.equal(result.code, 0, result.stderr);
      assert.equal(successStatusWrites(harness), 0);
      assert.equal(harness.statuses.at(-1).body.state, "pending");
      assert.equal(
        parseStateCommentBody(harness.findStateComment().body).lastStatus.state,
        "pending",
      );
    });
  }
});

test("active-marker success fails closed when the trusted marker comment is missing", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 1900,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
    });
    harness.issueComments = harness.issueComments.filter((comment) => comment.id !== 1900);
    harness.issueComments.push(codexCleanComment(2001));

    const result = await harness.runGate({
      eventName: "issue_comment",
      event: {
        issue: { number: 1, pull_request: {} },
        comment: codexCleanComment(2001),
      },
    });

    assert.equal(result.code, 1);
    assert.equal(harness.statuses.some((status) => status.body.state === "success"), false);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
  });
});

test("passed-marker reassertion rejects forged observed-provider lineage", async () => {
  await withHarness(async (harness) => {
    harness.seedSuccessfulState();
    const stateComment = harness.findStateComment();
    const state = parseStateCommentBody(stateComment.body);
    state.history.at(-1).observedProviderResult.id = "forged-result";
    stateComment.body = stateCommentBody(state);
    harness.issueComments.push(codexCleanComment(2001));
    harness.commitStatuses.push({
      sha: HEAD_SHA,
      context: "codex/review-gate",
      state: "error",
    });

    const result = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.some((status) => status.body.state === "success"), false);
  });
});

async function withHarness(callback) {
  const harness = new GateHarness();
  await callback(harness);
}

function currentHeadInlineFinding(id) {
  return {
    id,
    node_id: reviewCommentNodeId(id),
    pull_request_review_id: 9000,
    path: "src/gate.mjs",
    line: 42,
    original_line: 42,
    commit_id: HEAD_SHA,
    original_commit_id: HEAD_SHA,
    body: "Finding",
    user: codexBotUser(),
  };
}

function reviewCommentNodeId(id) {
  return `PRRC_kwDOReviewComment${id}`;
}

function graphqlReviewCommentIdentity(id) {
  return {
    id: reviewCommentNodeId(id),
    fullDatabaseId: String(id),
  };
}

function codexCleanComment(id, createdAt = "2026-05-14T10:00:00Z") {
  return codexCleanCommentForHead(id, HEAD_SHA, createdAt);
}

function codexApprovedReview(id, submittedAt = "2026-05-14T10:00:00Z") {
  return {
    id,
    state: "APPROVED",
    commit_id: HEAD_SHA,
    submitted_at: submittedAt,
    body: "Looks good.",
    user: codexBotUser(),
  };
}

function codexCleanCommentForHead(id, headSha, createdAt = "2026-05-14T10:00:00Z") {
  return {
    id,
    body: [
      "Codex Review: Didn't find any major issues. Keep them coming!",
      "",
      `**Reviewed commit:** \`${headSha.slice(0, 10)}\``,
    ].join("\n"),
    created_at: createdAt,
    html_url: `https://github.example/owner/repo/pull/1#issuecomment-${id}`,
    user: codexBotUser(),
    performed_via_github_app: { slug: "chatgpt-codex-connector" },
  };
}

function codexThreadlessFinding(id, headSha, createdAt) {
  return {
    id,
    body: [
      "### 💡 Codex Review",
      "",
      `https://github.com/owner/repo/blob/${headSha}/src/gate.mjs#L42-L44`,
    ].join("\n"),
    created_at: createdAt,
    html_url: `https://github.example/owner/repo/pull/1#issuecomment-${id}`,
    user: codexBotUser(),
    performed_via_github_app: { slug: "chatgpt-codex-connector" },
  };
}

function codexInlineParentReviewBody(commitRef = HEAD_SHORT_SHA) {
  return [
    "### 💡 Codex Review",
    "",
    "Here are some automated review suggestions for this pull request.",
    "",
    `**Reviewed commit:** \`${commitRef}\``,
    "    ",
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

function codexMalformedTerminal(id, createdAt) {
  return {
    ...codexCleanComment(id, createdAt),
    body: [
      "Codex Review: Didn't find any major issues. Nice work!",
      "",
      "**Reviewed commit:** `01c3f9da0`",
    ].join("\n"),
  };
}

function invalidVersionMarkerComment(id, versionMode) {
  const metadata = {
    ...(versionMode === "wrong" ? { version: 2 } : {}),
    headSha: HEAD_SHA,
    runUrl: "https://github.example/owner/repo/actions/runs/invalid",
    runId: "invalid",
    runAttempt: "1",
    attempt: 2,
    baseline: {
      plusOne: null,
      eyes: null,
      completionComment: null,
      approvedReview: null,
      submittedReview: null,
    },
    state: "waiting_ack",
    ackTimeoutSeconds: 300,
  };
  return {
    id,
    body: [
      "@codex review",
      "",
      `<!-- ${MARKER_COMMENT}`,
      JSON.stringify(metadata, null, 2),
      "-->",
    ].join("\n"),
    created_at: "2026-05-14T10:00:30Z",
    html_url: `https://github.example/owner/repo/pull/1#issuecomment-${id}`,
    user: { login: "github-actions[bot]" },
  };
}

function codexBotUser() {
  return { login: "chatgpt-codex-connector[bot]", type: "Bot" };
}

function unresolvedThread(commentId, { resolved = false, outdated = false } = {}) {
  return {
    id: `thread-${commentId}`,
    isResolved: resolved,
    isOutdated: outdated,
    path: "src/gate.mjs",
    line: 42,
    comments: { nodes: [graphqlReviewCommentIdentity(commentId)] },
  };
}

function seedCleanActiveMarker(harness) {
  harness.seedActiveMarker({
    id: 1900,
    headSha: HEAD_SHA,
    createdAt: "2026-05-14T09:55:00Z",
    baseline: {
      plusOne: null,
      eyes: null,
      completionComment: null,
      approvedReview: null,
      submittedReview: null,
    },
  });
  harness.issueComments.push(codexCleanComment(2001));
}

function statusReads(harness) {
  return harness.requestLog.filter((entry) =>
    entry.method === "GET" &&
      entry.path.endsWith(`/commits/${HEAD_SHA}/statuses`),
  ).length;
}

function successStatusWrites(harness) {
  return harness.requestLog.filter((entry) =>
    entry.method === "POST" &&
      entry.path.endsWith(`/statuses/${HEAD_SHA}`) &&
      entry.body?.state === "success",
  ).length;
}

function markerCommentWrites(harness) {
  return harness.requestLog.filter((entry) =>
    entry.method === "POST" &&
      entry.path.endsWith(`/issues/${harness.prNumber}/comments`) &&
      entry.body?.body?.includes(MARKER_COMMENT),
  ).length;
}

class GateHarness {
  constructor() {
    this.now = Date.parse("2026-05-14T10:01:00Z");
    this.owner = "owner";
    this.repo = "repo";
    this.prNumber = 1;
    this.nextCommentId = 2000;
    this.pullLoads = 0;
    this.snapshotLoads = 0;
    this.snapshotHooks = [];
    this.pullHooks = [];
    this.clockSnapshotHooks = [];
    this.statuses = [];
    this.commitStatuses = [];
    this.commitResolutions = { [HEAD_SHORT_SHA]: HEAD_SHA };
    this.compareResults = {
      [`${OLD_HEAD_SHA}...${HEAD_SHA}`]: {
        status: "ahead",
        base_commit: { sha: OLD_HEAD_SHA },
        head_commit: { sha: HEAD_SHA },
        merge_base_commit: { sha: OLD_HEAD_SHA },
      },
    };
    this.requestLog = [];
    this.routeFaults = {};
    this.issueComments = [];
    this.issueReactions = [];
    this.commentReactions = new Map();
    this.reviewComments = [];
    this.reviews = [{
      id: 9000,
      state: "PENDING",
      commit_id: HEAD_SHA,
      submitted_at: "2026-05-14T09:00:00Z",
      body: "Parent review for inline findings.",
      user: codexBotUser(),
    }];
    this.reviewThreads = [];
    this.reviewThreadPages = null;
    this.threadCommentPages = null;
    this.threadCommentDelayMs = 0;
    this.activeThreadCommentRequests = 0;
    this.maxActiveThreadCommentRequests = 0;
    this.streamResponseBodies = false;
    this.streamChunkSize = 64 * 1024;
    this.failNextReviewThreads = false;
    this.pullRequest = this.pullRequestForHead(HEAD_SHA);
  }

  async runGate({ eventName, event, env = {} }) {
    const workDir = await mkdtemp(join(tmpdir(), "codex-review-gate-test-"));
    const eventPath = join(workDir, "event.json");
    const statePath = join(workDir, "fake-github-state.json");
    const stepSummaryPath = join(workDir, "step-summary.md");
    const clockControllerPath = join(workDir, "clock-controller.mjs");
    await writeFile(eventPath, JSON.stringify(event), "utf8");
    await this.writeState(statePath);
    const nodeArgs = ["--import", fakeFetchPath];
    if (this.clockSnapshotHooks.length > 0) {
      await writeFile(
        clockControllerPath,
        buildClockControllerSource(
          this.clockSnapshotHooks,
          `/repos/${this.owner}/${this.repo}/issues/${this.prNumber}/comments`,
        ),
        "utf8",
      );
      nodeArgs.push("--import", clockControllerPath);
    }
    nodeArgs.push(join(repoRoot, "packages/action/src/gate.mjs"));

    try {
      const result = await runNode(nodeArgs, {
        cwd: repoRoot,
        env: {
          ...cleanProcessEnv(),
          FAKE_GITHUB_STATE_PATH: statePath,
          GITHUB_TOKEN: "fake-token",
          GITHUB_REPOSITORY: `${this.owner}/${this.repo}`,
          GITHUB_RUN_ID: "12345",
          GITHUB_RUN_ATTEMPT: "1",
          GITHUB_SERVER_URL: "https://github.example",
          GITHUB_API_URL: "https://api.github.test",
          GITHUB_STEP_SUMMARY: stepSummaryPath,
          GITHUB_EVENT_NAME: eventName,
          GITHUB_EVENT_PATH: eventPath,
          MARKER_ACK_TIMEOUT_SECONDS: "300",
          MARKER_ACK_TIMEOUT_MAX_SECONDS: "1800",
          MARKER_TIMEOUT_SECONDS: "3600",
          MAX_WAIT_SECONDS: "7200",
          COMPLETION_SIGNAL_BUFFER_SECONDS: "60",
          ...env,
        },
      });
      await this.readState(statePath);
      result.stepSummary = await readFile(stepSummaryPath, "utf8").catch(() => "");
      return result;
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  afterSnapshotLoad(count, action) {
    this.snapshotHooks.push({ count, ...action });
  }

  afterPullLoad(count, action) {
    this.pullHooks.push({ count, ...action });
  }

  advanceClockAfterSnapshotLoad(count, now) {
    this.clockSnapshotHooks.push({ count, now });
  }

  async writeState(statePath) {
    await writeFile(statePath, JSON.stringify(this.serializableState(), null, 2), "utf8");
  }

  async readState(statePath) {
    const nextState = JSON.parse(await readFile(statePath, "utf8"));
    Object.assign(this, nextState);
    this.commentReactions = new Map(Object.entries(nextState.commentReactions || {}));
  }

  serializableState() {
    return {
      now: this.now,
      owner: this.owner,
      repo: this.repo,
      prNumber: this.prNumber,
      nextCommentId: this.nextCommentId,
      pullLoads: this.pullLoads,
      snapshotLoads: this.snapshotLoads,
      snapshotHooks: this.snapshotHooks,
      pullHooks: this.pullHooks,
      statuses: this.statuses,
      commitStatuses: this.commitStatuses,
      commitResolutions: this.commitResolutions,
      compareResults: this.compareResults,
      requestLog: this.requestLog,
      routeFaults: this.routeFaults,
      issueComments: this.issueComments,
      issueReactions: this.issueReactions,
      commentReactions: Object.fromEntries(this.commentReactions),
      reviewComments: this.reviewComments,
      reviews: this.reviews,
      reviewThreads: this.reviewThreads,
      reviewThreadPages: this.reviewThreadPages,
      threadCommentPages: this.threadCommentPages,
      threadCommentDelayMs: this.threadCommentDelayMs,
      activeThreadCommentRequests: this.activeThreadCommentRequests,
      maxActiveThreadCommentRequests: this.maxActiveThreadCommentRequests,
      streamResponseBodies: this.streamResponseBodies,
      streamChunkSize: this.streamChunkSize,
      failNextReviewThreads: this.failNextReviewThreads,
      pullRequest: this.pullRequest,
    };
  }

  pullRequestForHead(headSha) {
    return {
      number: this.prNumber,
      state: "open",
      draft: false,
      user: { login: "octocat" },
      head: {
        sha: headSha,
        repo: { full_name: `${this.owner}/${this.repo}` },
      },
      base: {
        repo: { full_name: `${this.owner}/${this.repo}` },
      },
    };
  }

  seedActiveMarker({
    id,
    headSha,
    createdAt,
    baseline,
    state = "waiting_ack",
    ackDeadlineAt = "2026-05-14T10:00:00Z",
    resultDeadlineAt = "2026-05-14T10:55:00Z",
    nextRetryAt = "2026-05-14T10:00:00Z",
    maxWaitDeadlineAt = "2026-05-14T11:55:00Z",
    headStartedAt = createdAt,
    history = [],
    stateHead = headSha,
    pullHead = headSha,
  }) {
    this.pullRequest = this.pullRequestForHead(pullHead);
    const activeMarker = {
      version: 1,
      id: String(id),
      url: `https://github.example/owner/repo/pull/1#issuecomment-${id}`,
      headSha,
      runUrl: "https://github.example/owner/repo/actions/runs/999",
      runId: "999",
      runAttempt: "1",
      attempt: history.length + 1,
      baseline,
      state,
      ackTimeoutSeconds: 300,
      createdAt,
      ackDeadlineAt,
      resultDeadlineAt,
      nextRetryAt,
      headStartedAt,
      maxWaitDeadlineAt,
    };
    const stateValue = {
      version: 1,
      createdAt: "2026-05-14T09:50:00Z",
      updatedAt: "2026-05-14T09:55:00Z",
      statusHead: stateHead,
      bootstrap: { status: "closed" },
      activeMarker,
      history,
      lastStatus: {
        headSha: stateHead,
        state: "pending",
        updatedAt: "2026-05-14T09:55:00Z",
        runUrl: "https://github.example/owner/repo/actions/runs/999",
      },
    };
    this.issueComments.push({
      id: 1000,
      body: stateCommentBody(stateValue),
      created_at: "2026-05-14T09:50:00Z",
      html_url: "https://github.example/owner/repo/pull/1#issuecomment-1000",
      user: { login: "github-actions[bot]" },
    });
    this.issueComments.push(markerCommentFor(activeMarker));
    this.nextCommentId = Math.max(this.nextCommentId, id + 1);
  }

  seedHistoryOnlyRetryState({
    id,
    outcome,
    headStartedAt,
    maxWaitDeadlineAt,
    closedAt = "2026-05-14T10:00:00Z",
    trailingHistory = [],
    baseline = {
      plusOne: null,
      eyes: null,
      completionComment: null,
      approvedReview: null,
      submittedReview: null,
    },
  }) {
    this.seedActiveMarker({
      id,
      headSha: HEAD_SHA,
      createdAt: "2026-05-14T09:55:00Z",
      headStartedAt,
      maxWaitDeadlineAt,
      baseline,
    });

    const stateComment = this.findStateComment();
    const state = parseStateCommentBody(stateComment.body);
    const closedMarker = {
      ...state.activeMarker,
      state: outcome,
      outcome,
      closedAt,
    };
    stateComment.body = stateCommentBody({
      ...state,
      updatedAt: closedAt,
      activeMarker: null,
      history: [closedMarker, ...trailingHistory],
      lastStatus: {
        ...state.lastStatus,
        state: "pending",
        updatedAt: closedAt,
      },
    });
  }

  seedFailedFindingsState({
    id,
    headSha = HEAD_SHA,
    closedAt = "2026-05-14T09:58:00Z",
    outcome = "failed_findings",
    stateHead = headSha,
    pullHead = headSha,
    currentHeadFindingIds = ["3001"],
    rejectedRecoveryCompletions = [],
    latestRejectedRecoveryAt = null,
    headStartedAt = "2026-05-14T09:55:00Z",
    maxWaitDeadlineAt = "2026-05-14T11:55:00Z",
  }) {
    this.pullRequest = this.pullRequestForHead(pullHead);
    const failedMarker = {
      version: 1,
      id: String(id),
      url: `https://github.example/owner/repo/pull/1#issuecomment-${id}`,
      headSha,
      runUrl: "https://github.example/owner/repo/actions/runs/999",
      runId: "999",
      runAttempt: "1",
      attempt: 1,
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
      state: outcome,
      outcome,
      ackTimeoutSeconds: 300,
      createdAt: "2026-05-14T09:55:00Z",
      closedAt,
      headStartedAt,
      maxWaitDeadlineAt,
      currentHeadFindingIds,
      ...(rejectedRecoveryCompletions.length > 0 ? { rejectedRecoveryCompletions } : {}),
      ...(latestRejectedRecoveryAt ? { latestRejectedRecoveryAt } : {}),
    };
    const stateValue = {
      version: 1,
      createdAt: "2026-05-14T09:50:00Z",
      updatedAt: closedAt,
      statusHead: stateHead,
      bootstrap: { status: "closed" },
      activeMarker: null,
      history: [failedMarker],
      lastStatus: {
        headSha: stateHead,
        state: "failure",
        updatedAt: closedAt,
        runUrl: "https://github.example/owner/repo/actions/runs/999",
      },
    };
    this.issueComments.push({
      id: 1000,
      body: stateCommentBody(stateValue),
      created_at: "2026-05-14T09:50:00Z",
      html_url: "https://github.example/owner/repo/pull/1#issuecomment-1000",
      user: { login: "github-actions[bot]" },
    });
    this.issueComments.push(markerCommentFor(failedMarker));
    this.nextCommentId = Math.max(this.nextCommentId, id + 1);
  }

  seedLegacyFailureState({
    id,
    headSha = HEAD_SHA,
    markerCreatedAt = "2026-05-14T09:55:00Z",
    failedAt = "2026-05-14T09:58:00Z",
  }) {
    this.pullRequest = this.pullRequestForHead(headSha);
    const marker = {
      version: 1,
      id: String(id),
      url: `https://github.example/owner/repo/pull/1#issuecomment-${id}`,
      headSha,
      runUrl: "https://github.example/owner/repo/actions/runs/999",
      runId: "999",
      runAttempt: "1",
      attempt: 1,
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
      state: "waiting_ack",
      ackTimeoutSeconds: 300,
      createdAt: markerCreatedAt,
    };
    const stateValue = {
      version: 1,
      createdAt: "2026-05-14T09:50:00Z",
      updatedAt: failedAt,
      statusHead: headSha,
      bootstrap: { status: "closed" },
      activeMarker: null,
      history: [],
      lastStatus: {
        headSha,
        state: "failure",
        updatedAt: failedAt,
        runUrl: "https://github.example/owner/repo/actions/runs/999",
      },
    };
    this.issueComments.push({
      id: 1000,
      body: stateCommentBody(stateValue),
      created_at: "2026-05-14T09:50:00Z",
      html_url: "https://github.example/owner/repo/pull/1#issuecomment-1000",
      user: { login: "github-actions[bot]" },
    });
    this.issueComments.push(markerCommentFor(marker));
    this.nextCommentId = Math.max(this.nextCommentId, id + 1);
  }

  seedSuccessfulState({
    providerId = 2001,
    providerCreatedAt = "2026-05-14T10:00:00Z",
    headStartedAt = "2026-05-14T09:55:00Z",
    maxWaitDeadlineAt = "2026-05-14T11:55:00Z",
  } = {}) {
    const passedMarker = {
      version: 1,
      id: "1999",
      url: "https://github.example/owner/repo/pull/1#issuecomment-1999",
      headSha: HEAD_SHA,
      runUrl: "https://github.example/owner/repo/actions/runs/999",
      runId: "999",
      runAttempt: "1",
      attempt: 1,
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
      state: "passed",
      outcome: "passed",
      createdAt: "2026-05-14T09:55:00Z",
      closedAt: "2026-05-14T10:00:01Z",
      headStartedAt,
      maxWaitDeadlineAt,
      observedProviderResult: {
        source: "issue-comment",
        id: String(providerId),
        createdAt: providerCreatedAt,
        url:
          `https://github.example/owner/repo/pull/1#issuecomment-${providerId}`,
        kind: "clean",
        commitRef: HEAD_SHORT_SHA,
        headSha: HEAD_SHA,
      },
    };
    const stateValue = {
      version: 1,
      createdAt: "2026-05-14T09:50:00Z",
      updatedAt: "2026-05-14T09:59:00Z",
      statusHead: HEAD_SHA,
      bootstrap: { status: "closed" },
      activeMarker: null,
      history: [passedMarker],
      lastStatus: {
        headSha: HEAD_SHA,
        state: "success",
        updatedAt: "2026-05-14T09:59:00Z",
        runUrl: "https://github.example/owner/repo/actions/runs/999",
      },
    };
    this.issueComments.push({
      id: 1000,
      body: stateCommentBody(stateValue),
      created_at: "2026-05-14T09:50:00Z",
      html_url: "https://github.example/owner/repo/pull/1#issuecomment-1000",
      user: { login: "github-actions[bot]" },
    });
    this.issueComments.push(markerCommentFor(passedMarker));
  }

  seedLegacySuccessfulState({
    providerSource,
    providerId,
    providerCreatedAt = "2026-05-14T10:00:00Z",
    headStartedAt = "2026-05-14T09:55:00Z",
    maxWaitDeadlineAt = "2026-05-14T11:55:00Z",
  }) {
    const passedMarker = {
      version: 1,
      id: "1999",
      url: "https://github.example/owner/repo/pull/1#issuecomment-1999",
      headSha: HEAD_SHA,
      runUrl: "https://github.example/owner/repo/actions/runs/999",
      runId: "999",
      runAttempt: "1",
      attempt: 1,
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
      state: "passed",
      outcome: "passed",
      createdAt: "2026-05-14T09:55:00Z",
      closedAt: "2026-05-14T10:00:01Z",
      headStartedAt,
      maxWaitDeadlineAt,
      observedCompletionComment:
        providerSource === "issue-comment"
          ? {
              id: String(providerId),
              createdAt: providerCreatedAt,
              user: "chatgpt-codex-connector[bot]",
              url:
                `https://github.example/owner/repo/pull/1#issuecomment-${providerId}`,
            }
          : null,
      observedApprovedReview:
        providerSource === "pull-request-review"
          ? {
              id: String(providerId),
              state: "APPROVED",
              commitId: HEAD_SHA,
              submittedAt: providerCreatedAt,
              user: "chatgpt-codex-connector[bot]",
            }
          : null,
    };
    const stateValue = {
      version: 1,
      createdAt: "2026-05-14T09:50:00Z",
      updatedAt: "2026-05-14T10:00:01Z",
      statusHead: HEAD_SHA,
      bootstrap: { status: "closed" },
      activeMarker: null,
      history: [passedMarker],
      lastStatus: {
        headSha: HEAD_SHA,
        state: "success",
        updatedAt: "2026-05-14T10:00:01Z",
        runUrl: "https://github.example/owner/repo/actions/runs/999",
      },
    };
    this.issueComments.push({
      id: 1000,
      body: stateCommentBody(stateValue),
      created_at: "2026-05-14T09:50:00Z",
      html_url: "https://github.example/owner/repo/pull/1#issuecomment-1000",
      user: { login: "github-actions[bot]" },
    });
    this.issueComments.push(markerCommentFor(passedMarker));
  }

  seedMarkerOnly({
    id,
    headSha,
    createdAt,
    baseline,
    headStartedAt = createdAt,
    maxWaitDeadlineAt = "2026-05-14T11:55:00Z",
  }) {
    this.issueComments.push(markerCommentFor({
      version: 1,
      id: String(id),
      url: `https://github.example/owner/repo/pull/1#issuecomment-${id}`,
      headSha,
      runUrl: "https://github.example/owner/repo/actions/runs/999",
      runId: "999",
      runAttempt: "1",
      attempt: 1,
      baseline,
      state: "waiting_ack",
      ackTimeoutSeconds: 300,
      createdAt,
      headStartedAt,
      maxWaitDeadlineAt,
    }));
    this.nextCommentId = Math.max(this.nextCommentId, id + 1);
  }

  findStateComment() {
    return this.issueComments.findLast((comment) => comment.body.includes(STATE_MARKER));
  }

  findMarkerComments() {
    return this.issueComments.filter((comment) => comment.body.includes(MARKER_COMMENT));
  }

}

function buildClockControllerSource(hooks, commentsPath) {
  return `
const clockHooks = ${JSON.stringify(hooks)};
const commentsPath = ${JSON.stringify(commentsPath)};
const originalFetch = globalThis.fetch;
let snapshotLoads = 0;

globalThis.fetch = async function clockControlledFetch(input, options = {}) {
  const response = await originalFetch(input, options);
  const url = new URL(String(input));
  const method = String(options.method || "GET").toUpperCase();
  if (
    method === "GET" &&
    url.pathname === commentsPath &&
    url.searchParams.get("page") === "1"
  ) {
    snapshotLoads += 1;
    const hook = clockHooks.find((candidate) => candidate.count === snapshotLoads);
    if (hook) {
      Date.now = () => hook.now;
    }
  }
  return response;
};
`;
}

function cleanProcessEnv() {
  const preservedNames = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SystemRoot", "ComSpec", "PATHEXT"];
  return Object.fromEntries(
    preservedNames
      .filter((name) => process.env[name])
      .map((name) => [name, process.env[name]]),
  );
}

function stateCommentBody(state) {
  return [
    "codex/review-gate state",
    "",
    `<!-- ${STATE_MARKER}`,
    JSON.stringify(state, null, 2),
    "-->",
  ].join("\n");
}

function markerCommentFor(marker) {
  return {
    id: Number(marker.id),
    body: [
      "@codex review",
      "",
      `<!-- ${MARKER_COMMENT}`,
      JSON.stringify({
        version: 1,
        headSha: marker.headSha,
        runUrl: marker.runUrl,
        runId: marker.runId,
        runAttempt: marker.runAttempt,
        attempt: marker.attempt,
        baseline: marker.baseline,
        state: marker.state || "waiting_ack",
        ackTimeoutSeconds: marker.ackTimeoutSeconds,
        ackDeadlineAt: marker.ackDeadlineAt,
        resultDeadlineAt: marker.resultDeadlineAt,
        nextRetryAt: marker.nextRetryAt,
        headStartedAt: marker.headStartedAt,
        maxWaitDeadlineAt: marker.maxWaitDeadlineAt,
      }, null, 2),
      "-->",
    ].join("\n"),
    created_at: marker.createdAt,
    html_url: marker.url,
    user: { login: "github-actions[bot]" },
  };
}

function runNode(args, { cwd, env }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd, env });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}
