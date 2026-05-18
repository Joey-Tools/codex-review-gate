import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  MARKER_COMMENT,
  STATE_MARKER,
  parseMarkerCommentBody,
  parseStateCommentBody,
} from "../packages/action/src/core.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fakeFetchPath = join(repoRoot, "test/support/fake-github-fetch.mjs");

test("pull_request_target creates current-head state, marker, and pending status", async () => {
  await withHarness(async (harness) => {
    const result = await harness.runGate({
      eventName: "pull_request_target",
      event: {
        pull_request: { number: 1, head: { sha: "head-1" } },
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
    assert.equal(state.statusHead, "head-1");
    assert.equal(state.lastStatus.state, "pending");
    assert.equal(state.activeMarker.headSha, "head-1");
    assert.equal(state.activeMarker.state, "waiting_ack");
    assert.equal(state.activeMarker.ackDeadlineAt, "2026-05-14T10:06:01.000Z");
    assert.equal(state.activeMarker.resultDeadlineAt, "2026-05-14T11:01:01.000Z");

    const markerComment = harness.findMarkerComments().at(-1);
    assert.equal(markerComment.body.startsWith("@codex review"), true);
    assert.equal(markerComment.body.includes("[!NOTE]"), false);
    assert.equal(markerComment.body.includes("generative AI review"), false);
    assert.match(result.stepSummary, /This workflow requested a Codex generative AI review/);
    const marker = parseMarkerCommentBody(markerComment.body);
    assert.equal(marker.headSha, "head-1");
    assert.equal(marker.state, "waiting_ack");
  });
});

test("issue_comment completion after marker passes only after final current-head reload", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: "head-1",
      createdAt: "2026-05-14T09:55:00Z",
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
      body: "Codex Review: Didn't find any major issues.",
      created_at: "2026-05-14T09:57:00Z",
      html_url: "https://github.example/owner/repo/pull/1#issuecomment-2001",
      user: { login: "chatgpt-codex-connector[bot]" },
    });

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
    assert.equal(state.history.at(-1).observedCompletionComment.id, "2001");
  });
});

test("approved Codex review passes the active marker after the final finding check", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: "head-1",
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
      commit_id: "head-1",
      submitted_at: "2026-05-14T09:57:00Z",
      body: "Looks good.",
      user: { login: "chatgpt-codex-connector[bot]" },
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
    assert.equal(state.history.at(-1).observedApprovedReview.id, "4001");
  });
});

test("issue_comment completion fails closed when final reload sees current-head findings", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: "head-1",
      createdAt: "2026-05-14T09:55:00Z",
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
      body: "Codex Review: Didn't find any major issues.",
      created_at: "2026-05-14T09:57:00Z",
      html_url: "https://github.example/owner/repo/pull/1#issuecomment-2001",
      user: { login: "chatgpt-codex-connector[bot]" },
    });
    harness.afterSnapshotLoad(2, {
      action: "pushReviewComment",
      value: currentHeadInlineFinding(3001),
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
    assert.deepEqual(state.history.at(-1).currentHeadFindingIds, ["3001"]);
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
      comments: { nodes: [{ databaseId: 3001 }] },
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
    assert.equal(harness.statuses.at(-1).body.description, "Codex completion observed after resolved findings");

    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.activeMarker, null);
    assert.equal(state.lastStatus.state, "success");
    assert.equal(state.history.at(-1).outcome, "failed_findings");
  });
});

test("issue_comment clean completion does not recover failed findings when disabled", async () => {
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
    assert.equal(harness.statuses.length, 0);

    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.activeMarker, null);
    assert.equal(state.lastStatus.state, "failure");
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
    assert.equal(harness.statuses.length, 0);
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
      comments: { nodes: [{ databaseId: 3001 }] },
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
      comments: { nodes: [{ databaseId: 3001 }] },
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

test("issue_comment clean completion recovery in fresh mode rejects a previously failed clean signal", async () => {
  await withHarness(async (harness) => {
    harness.seedFailedFindingsState({ id: 2000 });
    harness.reviewComments.push(currentHeadInlineFinding(3001));
    harness.reviewThreads.push({
      id: "thread-3001",
      isResolved: false,
      isOutdated: false,
      comments: { nodes: [{ databaseId: 3001 }] },
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
    assert.deepEqual(state.history.at(-1).rejectedRecoveryCompletions, [
      {
        id: "2001",
        createdAt: "2026-05-14T10:00:00Z",
        rejectedAt: "2026-05-14T10:01:00.000Z",
      },
    ]);
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
    state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.lastStatus.state, "failure");
  });
});

test("issue_comment clean completion recovery in fresh mode rejects older clean signals after a blocked attempt", async () => {
  await withHarness(async (harness) => {
    harness.seedFailedFindingsState({ id: 2000 });
    harness.reviewComments.push(currentHeadInlineFinding(3001));
    harness.reviewThreads.push({
      id: "thread-3001",
      isResolved: false,
      isOutdated: false,
      comments: { nodes: [{ databaseId: 3001 }] },
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
    assert.equal(state.history.at(-1).latestRejectedRecoveryAt, "2026-05-14T10:01:00.000Z");

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
  });
});

test("issue_comment fresh recovery cutoff is derived from legacy rejected completions", async () => {
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
    assert.equal(harness.statuses.length, 0);
    assert.equal(parseStateCommentBody(harness.findStateComment().body).lastStatus.state, "failure");
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
      comments: { nodes: [{ databaseId: 3001 }] },
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

test("issue_comment clean completion recovery requires the trigger comment to remain clean and visible", async () => {
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
    assert.equal(harness.statuses.length, 0);
    assert.equal(parseStateCommentBody(harness.findStateComment().body).lastStatus.state, "failure");
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
    assert.equal(harness.statuses.length, 0);
    assert.equal(parseStateCommentBody(harness.findStateComment().body).lastStatus.state, "failure");
  });
});

test("issue_comment fresh recovery mode input takes precedence over runtime environment", async () => {
  await withHarness(async (harness) => {
    harness.seedFailedFindingsState({ id: 2000 });
    harness.reviewComments.push(currentHeadInlineFinding(3001));
    harness.reviewThreads.push({
      id: "thread-3001",
      isResolved: false,
      isOutdated: false,
      comments: { nodes: [{ databaseId: 3001 }] },
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
  });
});

test("issue_comment clean completion recovery requires completion after failed findings close time", async () => {
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
    assert.equal(harness.statuses.length, 0);

    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.lastStatus.state, "failure");
  });
});

test("issue_comment recovery requires a Codex clean completion and failed_findings history", async () => {
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
    assert.equal(harness.statuses.length, 0);
  });

  await withHarness(async (harness) => {
    harness.seedFailedFindingsState({ id: 2000, outcome: "missed_ack" });
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
    assert.equal(harness.statuses.length, 0);
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

test("submitted Codex review acknowledges marker and moves WaitingAck to WaitingResult", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: "head-1",
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
      commit_id: "head-1",
      submitted_at: "2026-05-14T09:57:00Z",
      body: "No inline findings in the review body.",
      user: { login: "chatgpt-codex-connector[bot]" },
    });

    const result = await harness.runGate({
      eventName: "pull_request_review",
      event: {
        pull_request: { number: 1 },
        review: { user: { login: "chatgpt-codex-connector[bot]" } },
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.length, 0);

    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.activeMarker.state, "waiting_result");
    assert.equal(state.activeMarker.observedReview.id, "4001");
  });
});

test("eyes reaction acknowledges marker and moves WaitingAck to WaitingResult", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: "head-1",
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

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.length, 0);

    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.activeMarker.state, "waiting_result");
    assert.equal(state.activeMarker.observedEyes.id, "5001");
  });
});

test("current-head Codex findings close the active marker as failed_findings", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: "head-1",
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

test("scheduled scan retries missed acknowledgement with same-head backoff", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: "head-1",
      createdAt: "2026-05-14T09:50:00Z",
      ackDeadlineAt: "2026-05-14T09:55:00Z",
      nextRetryAt: "2026-05-14T09:55:00Z",
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
          headSha: "head-1",
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
    assert.equal(newMarker.headSha, "head-1");
    assert.equal(newMarker.ackTimeoutSeconds, 1200);

    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.history.at(-1).outcome, "missed_ack");
    assert.equal(state.activeMarker.id, String(markerComments.at(-1).id));
    assert.equal(state.activeMarker.ackTimeoutSeconds, 1200);
  });
});

test("scheduled scan retries stalled WaitingResult markers", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: "head-1",
      state: "waiting_result",
      createdAt: "2026-05-14T08:50:00Z",
      resultDeadlineAt: "2026-05-14T09:50:00Z",
      nextRetryAt: "2026-05-14T09:50:00Z",
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
    assert.equal(harness.statuses.at(-1).body.state, "pending");
  });
});

test("scheduled scan fails a marker that exceeds the max wait deadline", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: "head-1",
      createdAt: "2026-05-14T09:30:00Z",
      ackDeadlineAt: "2026-05-14T10:30:00Z",
      nextRetryAt: "2026-05-14T10:30:00Z",
      maxWaitDeadlineAt: "2026-05-14T10:00:00Z",
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
    assert.equal(harness.statuses.at(-1).body.state, "failure");
    assert.equal(harness.findMarkerComments().length, 1);

    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.activeMarker, null);
    assert.equal(state.lastStatus.state, "failure");
    assert.equal(state.history.at(-1).outcome, "timed_out");
  });
});

test("head changes close obsolete markers, write pending, and create a fresh marker", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: "old-head",
      createdAt: "2026-05-14T09:55:00Z",
      baseline: {
        plusOne: null,
        eyes: null,
        completionComment: null,
        approvedReview: null,
        submittedReview: null,
      },
      stateHead: "old-head",
      pullHead: "new-head",
    });

    const result = await harness.runGate({
      eventName: "pull_request_target",
      event: {
        pull_request: { number: 1, head: { sha: "new-head" } },
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(harness.statuses.map((status) => status.body.state), ["pending", "pending"]);

    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.history.at(-1).outcome, "obsolete_head");
    assert.equal(state.history.at(-1).currentHeadSha, "new-head");
    assert.equal(state.activeMarker.headSha, "new-head");
  });
});

test("state-loss recovery records old marker and creates a fresh marker without passing stale signals", async () => {
  await withHarness(async (harness) => {
    harness.seedMarkerOnly({
      id: 2000,
      headSha: "head-1",
      createdAt: "2026-05-14T09:55:00Z",
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
      body: "Codex Review: Didn't find any major issues.",
      created_at: "2026-05-14T09:57:00Z",
      html_url: "https://github.example/owner/repo/pull/1#issuecomment-2001",
      user: { login: "chatgpt-codex-connector[bot]" },
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
    assert.equal(state.activeMarker.state, "waiting_ack");
    assert.equal(state.activeMarker.baseline.completionComment.id, "2001");
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

test("targeted workflow_dispatch fails closed when snapshot loading errors after status readiness", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 2000,
      headSha: "head-1",
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

async function withHarness(callback) {
  const harness = new GateHarness();
  await callback(harness);
}

function currentHeadInlineFinding(id) {
  return {
    id,
    path: "src/gate.mjs",
    line: 42,
    original_line: 42,
    commit_id: "head-1",
    original_commit_id: "head-1",
    body: "Finding",
    user: { login: "chatgpt-codex-connector[bot]" },
  };
}

function codexCleanComment(id, createdAt = "2026-05-14T10:00:00Z") {
  return {
    id,
    body: "Codex Review: Didn't find any major issues.",
    created_at: createdAt,
    html_url: `https://github.example/owner/repo/pull/1#issuecomment-${id}`,
    user: { login: "chatgpt-codex-connector[bot]" },
  };
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
    this.statuses = [];
    this.issueComments = [];
    this.issueReactions = [];
    this.commentReactions = new Map();
    this.reviewComments = [];
    this.reviews = [];
    this.reviewThreads = [];
    this.failNextReviewThreads = false;
    this.pullRequest = this.pullRequestForHead("head-1");
  }

  async runGate({ eventName, event, env = {} }) {
    const workDir = await mkdtemp(join(tmpdir(), "codex-review-gate-test-"));
    const eventPath = join(workDir, "event.json");
    const statePath = join(workDir, "fake-github-state.json");
    const stepSummaryPath = join(workDir, "step-summary.md");
    await writeFile(eventPath, JSON.stringify(event), "utf8");
    await this.writeState(statePath);

    try {
      const result = await runNode(["--import", fakeFetchPath, join(repoRoot, "packages/action/src/gate.mjs")], {
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
      statuses: this.statuses,
      issueComments: this.issueComments,
      issueReactions: this.issueReactions,
      commentReactions: Object.fromEntries(this.commentReactions),
      reviewComments: this.reviewComments,
      reviews: this.reviews,
      reviewThreads: this.reviewThreads,
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
      headStartedAt: createdAt,
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

  seedFailedFindingsState({
    id,
    headSha = "head-1",
    closedAt = "2026-05-14T09:58:00Z",
    outcome = "failed_findings",
    stateHead = headSha,
    pullHead = headSha,
    currentHeadFindingIds = ["3001"],
    rejectedRecoveryCompletions = [],
    latestRejectedRecoveryAt = null,
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

  seedMarkerOnly({ id, headSha, createdAt, baseline }) {
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
    }));
    this.nextCommentId = Math.max(this.nextCommentId, id + 1);
  }

  findStateComment() {
    return this.issueComments.find((comment) => comment.body.includes(STATE_MARKER));
  }

  findMarkerComments() {
    return this.issueComments.filter((comment) => comment.body.includes(MARKER_COMMENT));
  }

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
