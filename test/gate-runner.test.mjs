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

test("valid current-head clean passes without creating a review marker", async () => {
  await withHarness(async (harness) => {
    harness.issueComments.push(codexCleanComment(2001));

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.snapshotLoads, 2);
    assert.equal(harness.statuses.at(-1).body.state, "success");
    assert.equal(harness.findMarkerComments().length, 0);
    assert.equal(markerCommentWrites(harness), 0);
  });
});

test("current-head clean passes regardless of marker timing or deadline", async (t) => {
  const cases = [
    {
      name: "clean predates active marker",
      markerCreatedAt: "2026-05-14T09:55:00Z",
      cleanCreatedAt: "2026-05-14T09:50:00Z",
      maxWaitDeadlineAt: "2026-05-14T11:55:00Z",
    },
    {
      name: "clean arrives after max-wait deadline",
      markerCreatedAt: "2026-05-14T09:50:00Z",
      cleanCreatedAt: "2026-05-14T10:00:00Z",
      maxWaitDeadlineAt: "2026-05-14T09:59:00Z",
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      await withHarness(async (harness) => {
        harness.seedActiveMarker({
          id: 1900,
          headSha: HEAD_SHA,
          createdAt: scenario.markerCreatedAt,
          maxWaitDeadlineAt: scenario.maxWaitDeadlineAt,
          baseline: {
            plusOne: null,
            eyes: null,
            completionComment: null,
            approvedReview: null,
            submittedReview: null,
          },
        });
        harness.issueComments.push(
          codexCleanComment(2001, scenario.cleanCreatedAt),
        );

        const result = await harness.runGate({
          eventName: "workflow_dispatch",
          event: { inputs: { pull_request: "1" } },
          env: { PR_NUMBER: "1" },
        });

        assert.equal(result.code, 0, result.stderr);
        assert.equal(harness.statuses.at(-1).body.state, "success");
        assert.equal(markerCommentWrites(harness), 0);
      });
    });
  }
});

test("marker and audit history cannot reject stable current-head clean", async (t) => {
  const activeMarkerOptions = {
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
  };
  const cases = [
    {
      name: "missing marker",
      seed(harness) {
        harness.seedActiveMarker(activeMarkerOptions);
        harness.issueComments = harness.issueComments.filter(
          (comment) => !comment.body.includes(MARKER_COMMENT),
        );
      },
    },
    {
      name: "forged marker",
      seed(harness) {
        harness.seedActiveMarker(activeMarkerOptions);
        harness.findMarkerComments().at(-1).user = { login: "octocat" };
      },
    },
    {
      name: "malformed state and marker",
      seed(harness) {
        harness.seedActiveMarker(activeMarkerOptions);
        harness.findStateComment().body = harness.findStateComment().body.replace(
          '"version": 1',
          '"version":',
        );
        const marker = harness.findMarkerComments().at(-1);
        marker.body = marker.body.replace('"version": 1', '"version":');
      },
    },
    {
      name: "legacy failed audit",
      seed(harness) {
        harness.seedFailedFindingsState({ id: 1900 });
      },
    },
    {
      name: "legacy passed audit",
      seed(harness) {
        harness.seedSuccessfulState({ providerId: 1999 });
      },
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      await withHarness(async (harness) => {
        scenario.seed(harness);
        harness.issueComments.push(codexCleanComment(2001));

        const result = await harness.runGate({
          eventName: "workflow_dispatch",
          event: { inputs: { pull_request: "1" } },
          env: { PR_NUMBER: "1" },
        });

        assert.equal(result.code, 0, result.stderr);
        assert.equal(harness.snapshotLoads, 2);
        assert.equal(harness.statuses.at(-1).body.state, "success");
        assert.equal(markerCommentWrites(harness), 0);
      });
    });
  }
});

test("deprecated recovery inputs are accepted but do not change live evidence", async (t) => {
  const cases = [
    {
      name: "recovery disabled",
      env: { FAILED_FINDINGS_RECOVERY_INPUT: "false" },
    },
    {
      name: "fresh recovery mode",
      env: { FAILED_FINDINGS_RECOVERY_MODE_INPUT: "fresh" },
    },
    {
      name: "zero completion buffer",
      env: { COMPLETION_SIGNAL_BUFFER_SECONDS: "0" },
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      await withHarness(async (harness) => {
        harness.seedFailedFindingsState({ id: 1900 });
        harness.issueComments.push(codexCleanComment(2001));

        const result = await harness.runGate({
          eventName: "workflow_dispatch",
          event: { inputs: { pull_request: "1" } },
          env: {
            PR_NUMBER: "1",
            ...scenario.env,
          },
        });

        assert.equal(result.code, 0, result.stderr);
        assert.equal(harness.statuses.at(-1).body.state, "success");
        assert.equal(markerCommentWrites(harness), 0);
      });
    });
  }
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

test("new-head findings still request a current-head review before failing", async () => {
  await withHarness(async (harness) => {
    harness.seedActiveMarker({
      id: 1900,
      headSha: OLD_HEAD_SHA,
      stateHead: OLD_HEAD_SHA,
      pullHead: HEAD_SHA,
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
      eventName: "pull_request_target",
      event: {
        pull_request: { number: 1, head: { sha: HEAD_SHA } },
        repository: { default_branch: "master" },
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "failure");
    assert.equal(
      harness.findMarkerComments().length,
      2,
      `${result.stdout}\n${result.stderr}`,
    );
    assert.equal(markerCommentWrites(harness), 1);
    const latestMarker = parseMarkerCommentBody(
      harness.findMarkerComments().at(-1).body,
    );
    assert.equal(latestMarker.headSha, HEAD_SHA);

    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(state.activeMarker, null);
    assert.equal(
      state.history.some(
        (marker) =>
          marker.headSha === OLD_HEAD_SHA &&
          marker.outcome === "obsolete_head",
      ),
      true,
    );
    assert.equal(state.history.at(-1).headSha, HEAD_SHA);
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
          createdAt: "2026-05-14T09:35:00Z",
          baseline: {
            plusOne: null,
            eyes: null,
            completionComment: null,
            approvedReview: null,
            submittedReview: null,
          },
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
            id: "1800",
            headSha: OLD_HEAD_SHA,
            createdAt: "2026-05-14T09:25:00Z",
            baseline: {
              plusOne: null,
              eyes: null,
              completionComment: null,
              approvedReview: null,
              submittedReview: null,
            },
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

test("no-clean timeout persists an orchestration fence before retry recovery", async () => {
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
    const statePath =
      `PATCH /repos/${harness.owner}/${harness.repo}/issues/comments/1000`;
    const replacementPath =
      `POST /repos/${harness.owner}/${harness.repo}/issues/${harness.prNumber}/comments`;
    harness.routeFaults[statePath] = Array.from({ length: 4 }, () => ({
      status: 503,
      body: { message: "state update failed" },
      headers: { "Retry-After": "0" },
    }));
    harness.routeFaults[replacementPath] = [{
      status: 503,
      body: { message: "replacement state failed" },
      headers: { "Retry-After": "0" },
    }];

    const fenced = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(fenced.code, 1);
    assert.equal(harness.statuses.at(-1).body.state, "error");
    assert.match(fenced.stderr, /published a durable marker-orchestration fence/);
    const fencedMarker = parseMarkerCommentBody(
      harness.findMarkerComments().at(-1).body,
    );
    assert.equal(
      fencedMarker.baseline.orchestrationFence.reason,
      "max-wait timeout state",
    );

    harness.routeFaults = {};
    const recovered = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(recovered.code, 0, recovered.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    assert.equal(harness.findMarkerComments().length, 2);
    const state = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(
      state.history.some(
        (marker) =>
          marker.outcome === "state_lost" &&
          marker.recoveryReason === "orchestration_state_persistence_fence",
      ),
      true,
    );
    assert.equal(state.activeMarker.state, "waiting_ack");
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
      ahead_by: 1,
      behind_by: 0,
      total_commits: 1,
      base_commit: { sha: HEAD_SHA },
      merge_base_commit: { sha: HEAD_SHA },
      commits: [{ sha: NEW_HEAD_SHA }],
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
      ahead_by: 1,
      behind_by: 0,
      total_commits: 1,
      base_commit: { sha: OLD_HEAD_SHA },
      merge_base_commit: { sha: OLD_HEAD_SHA },
      commits: [{ sha: NEW_HEAD_SHA }],
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
      ahead_by: 1,
      behind_by: 1,
      total_commits: 1,
      base_commit: { sha: OLD_HEAD_SHA },
      merge_base_commit: { sha: HEAD_SHA },
      commits: [{ sha: NEW_HEAD_SHA }],
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

test("a documented behind response is valid non-ancestor evidence", async () => {
  await withHarness(async (harness) => {
    harness.pullRequest = harness.pullRequestForHead(HEAD_SHA);
    harness.commitResolutions[OLD_HEAD_SHA.slice(0, 10)] = OLD_HEAD_SHA;
    harness.compareResults[`${OLD_HEAD_SHA}...${HEAD_SHA}`] = {
      status: "behind",
      ahead_by: 0,
      behind_by: 1,
      total_commits: 0,
      base_commit: { sha: OLD_HEAD_SHA },
      merge_base_commit: { sha: HEAD_SHA },
      commits: [],
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
    assert.doesNotMatch(result.stderr, /ancestry response is invalid/);
  });
});

test("an asymmetric diverged response is valid non-ancestor evidence", async () => {
  await withHarness(async (harness) => {
    harness.commitResolutions[OLD_HEAD_SHA.slice(0, 10)] = OLD_HEAD_SHA;
    harness.compareResults[`${OLD_HEAD_SHA}...${HEAD_SHA}`] = {
      status: "diverged",
      ahead_by: 3,
      behind_by: 6,
      total_commits: 3,
      base_commit: { sha: OLD_HEAD_SHA },
      merge_base_commit: { sha: NEW_HEAD_SHA },
      commits: [
        { sha: "1".repeat(40) },
        { sha: "2".repeat(40) },
        { sha: HEAD_SHA },
      ],
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
    assert.doesNotMatch(result.stderr, /ancestry response is invalid/);
  });
});

test("a live-shaped compare response binds its exact requested endpoints without head_commit", async () => {
  await withHarness(async (harness) => {
    const oldShortSha = OLD_HEAD_SHA.slice(0, 10);
    harness.commitResolutions[oldShortSha] = OLD_HEAD_SHA;
    harness.compareResults[`${OLD_HEAD_SHA}...${HEAD_SHA}`] = {
      status: "ahead",
      ahead_by: 1,
      behind_by: 0,
      total_commits: 1,
      base_commit: { sha: OLD_HEAD_SHA },
      merge_base_commit: { sha: OLD_HEAD_SHA },
      commits: [{ sha: HEAD_SHA }],
    };
    harness.issueComments.push(codexCleanCommentForHead(2001, OLD_HEAD_SHA));

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    assert.equal(
      harness.requestLog.filter((entry) =>
        entry.method === "GET" &&
          entry.path.endsWith(`/compare/${OLD_HEAD_SHA}...${HEAD_SHA}`),
      ).length,
      1,
    );
    assert.equal(
      harness.requestLog.some((entry) =>
        entry.method === "GET" &&
          entry.path.endsWith(`/commits/${HEAD_SHA}`),
      ),
      false,
    );
  });
});

test("compare relationship and count contradictions fail closed", async (t) => {
  const validAhead = {
    status: "ahead",
    ahead_by: 1,
    behind_by: 0,
    total_commits: 1,
    base_commit: { sha: OLD_HEAD_SHA },
    merge_base_commit: { sha: OLD_HEAD_SHA },
    commits: [{ sha: HEAD_SHA }],
  };
  for (const scenario of [
    {
      name: "base does not match the requested base",
      response: {
        ...validAhead,
        base_commit: { sha: NEW_HEAD_SHA },
      },
      expected: /instead of requested provider commit/,
    },
    {
      name: "total commits do not equal ahead count",
      response: {
        ...validAhead,
        total_commits: 2,
      },
      expected: /reported total_commits 2 but ahead_by 1/,
    },
    {
      name: "commit list does not end at the requested head",
      response: {
        ...validAhead,
        commits: [{ sha: NEW_HEAD_SHA }],
      },
      expected: /instead of requested head/,
    },
    {
      name: "unpaginated commit list has the wrong length",
      response: {
        ...validAhead,
        ahead_by: 2,
        total_commits: 2,
      },
      expected: /returned 1 commits.*requires 2/,
    },
    {
      name: "intermediate commit SHA is malformed",
      response: {
        ...validAhead,
        ahead_by: 2,
        total_commits: 2,
        commits: [{ sha: "malformed" }, { sha: HEAD_SHA }],
      },
      expected: /invalid commit SHA at index 0/,
    },
    {
      name: "commit list contains a duplicate",
      response: {
        ...validAhead,
        ahead_by: 2,
        total_commits: 2,
        commits: [{ sha: HEAD_SHA }, { sha: HEAD_SHA }],
      },
      expected: /duplicate commit/,
    },
    {
      name: "commit list includes the excluded base",
      response: {
        ...validAhead,
        ahead_by: 2,
        total_commits: 2,
        commits: [{ sha: OLD_HEAD_SHA }, { sha: HEAD_SHA }],
      },
      expected: /included excluded base-side commit/,
    },
    {
      name: "ahead reports a behind count",
      response: {
        ...validAhead,
        behind_by: 1,
      },
      expected: /contradicted its ahead relationship and commit counts/,
    },
    {
      name: "identical uses distinct requested endpoints",
      response: {
        ...validAhead,
        status: "identical",
        ahead_by: 0,
        total_commits: 0,
        commits: [],
      },
      expected: /contradicted its identical relationship and commit counts/,
    },
    {
      name: "behind does not use the requested head as merge base",
      response: {
        ...validAhead,
        status: "behind",
        ahead_by: 0,
        behind_by: 1,
        total_commits: 0,
        commits: [],
      },
      expected: /contradicted its behind relationship and commit counts/,
    },
    {
      name: "diverged reuses an endpoint as merge base",
      response: {
        ...validAhead,
        status: "diverged",
        behind_by: 1,
      },
      expected: /contradicted its diverged relationship and commit counts/,
    },
    {
      name: "counts must be nonnegative safe integers",
      response: {
        ...validAhead,
        behind_by: -1,
      },
      expected: /did not contain the documented commit-comparison fields/,
    },
    {
      name: "commits must be present",
      response: {
        ...validAhead,
        commits: undefined,
      },
      expected: /did not contain the documented commit-comparison fields/,
    },
  ]) {
    await t.test(scenario.name, async () => {
      await withHarness(async (harness) => {
        harness.commitResolutions[OLD_HEAD_SHA.slice(0, 10)] = OLD_HEAD_SHA;
        harness.compareResults[`${OLD_HEAD_SHA}...${HEAD_SHA}`] =
          scenario.response;
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

test("scheduled scan treats schema-malformed audit state as absent", async () => {
  await withHarness(async (harness) => {
    harness.commitStatuses.push({
      sha: HEAD_SHA,
      context: "codex/review-gate",
      state: "success",
      creator: { login: "github-actions[bot]", type: "Bot" },
    });
    harness.issueComments.push({
      id: 1000,
      body: stateCommentBody({
        version: 1,
        createdAt: "2026-05-14T09:50:00Z",
        updatedAt: "2026-05-14T09:55:00Z",
        statusHead: HEAD_SHA,
        bootstrap: { status: "closed" },
        activeMarker: null,
        history: {},
        lastStatus: {
          headSha: HEAD_SHA,
          state: "success",
          updatedAt: "2026-05-14T09:55:00Z",
          runUrl: "https://github.example/owner/repo/actions/runs/999",
        },
      }),
      created_at: "2026-05-14T09:50:00Z",
      html_url: "https://github.example/owner/repo/pull/1#issuecomment-1000",
      user: { login: "github-actions[bot]" },
    });
    harness.issueComments.push(codexCleanComment(2001));

    const result = await harness.runGate({
      eventName: "schedule",
      event: {},
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.length, 0);
    assert.equal(statusReads(harness), 1);
    assert.equal(harness.pullLoads, 0);
  });
});

test("schema-malformed active marker cannot suppress a fresh review request", async () => {
  await withHarness(async (harness) => {
    harness.issueComments.push({
      id: 1000,
      body: stateCommentBody({
        version: 1,
        createdAt: "2026-05-14T09:50:00Z",
        updatedAt: "2026-05-14T09:55:00Z",
        statusHead: HEAD_SHA,
        bootstrap: { status: "closed" },
        activeMarker: {},
        history: [],
        lastStatus: {
          headSha: HEAD_SHA,
          state: "pending",
          updatedAt: "2026-05-14T09:55:00Z",
          runUrl: "https://github.example/owner/repo/actions/runs/999",
        },
      }),
      created_at: "2026-05-14T09:50:00Z",
      html_url: "https://github.example/owner/repo/pull/1#issuecomment-1000",
      user: { login: "github-actions[bot]" },
    });

    const result = await harness.runGate({
      eventName: "workflow_dispatch",
      event: { inputs: { pull_request: "1" } },
      env: { PR_NUMBER: "1" },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(harness.statuses.at(-1).body.state, "pending");
    assert.equal(markerCommentWrites(harness), 1);
    const latestState = parseStateCommentBody(harness.findStateComment().body);
    assert.equal(latestState.activeMarker.headSha, HEAD_SHA);
    assert.equal(latestState.activeMarker.state, "waiting_ack");
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

test("stale live error or pending is rewritten to success by current evidence", async (t) => {
  for (const staleState of ["error", "pending"]) {
    await t.test(staleState, async () => {
      await withHarness(async (harness) => {
        harness.seedSuccessfulState({
          providerId: 5004259807,
          maxWaitDeadlineAt: "2026-05-14T10:00:00Z",
        });
        harness.commitStatuses.push({
          sha: HEAD_SHA,
          context: "codex/review-gate",
          state: staleState,
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
        assert.equal(markerCommentWrites(harness), 0);
        assert.equal(
          parseStateCommentBody(harness.findStateComment().body).history.some(
            (marker) => marker.outcome === "timed_out",
          ),
          false,
        );
      });
    });
  }
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
      ahead_by: 1,
      behind_by: 1,
      total_commits: 1,
      base_commit: { sha: OLD_HEAD_SHA },
      merge_base_commit: { sha: NEW_HEAD_SHA },
      commits: [{ sha: HEAD_SHA }],
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
      ahead_by: 1,
      behind_by: 1,
      total_commits: 1,
      base_commit: { sha: OLD_HEAD_SHA },
      merge_base_commit: { sha: NEW_HEAD_SHA },
      commits: [{ sha: HEAD_SHA }],
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
      ahead_by: 1,
      behind_by: 1,
      total_commits: 1,
      base_commit: { sha: OLD_HEAD_SHA },
      merge_base_commit: { sha: NEW_HEAD_SHA },
      commits: [{ sha: HEAD_SHA }],
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

test("final snapshot rejects a clean artifact swap instead of falling back", async () => {
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
    assert.equal(harness.statuses.at(-1).body.state, "error");
    assert.match(result.stderr, /not stable across final validation/);
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
      ahead_by: 1,
      behind_by: 1,
      total_commits: 1,
      base_commit: { sha: OLD_HEAD_SHA },
      merge_base_commit: { sha: NEW_HEAD_SHA },
      commits: [{ sha: HEAD_SHA }],
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
    assert.equal(state.history.length, 1);
    assert.equal(state.history.at(-1).headSha, HEAD_SHA);
    assert.equal(state.history.at(-1).outcome, "failed_findings");
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
    assert.equal(state.history.length, 1);
    assert.equal(state.history.at(-1).headSha, HEAD_SHA);
    assert.equal(state.history.at(-1).outcome, "failed_findings");
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
        ahead_by: 1,
        behind_by: 0,
        total_commits: 1,
        base_commit: { sha: OLD_HEAD_SHA },
        merge_base_commit: { sha: OLD_HEAD_SHA },
        commits: [{ sha: HEAD_SHA }],
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

function removePersistedMaxWaitDeadline(
  harness,
  {
    removeLiveHeadStartedAt = false,
    removeStateDeadline = true,
  } = {},
) {
  const stateComment = harness.findStateComment();
  const state = parseStateCommentBody(stateComment.body);
  if (removeStateDeadline) {
    delete state.history.at(-1).maxWaitDeadlineAt;
  }
  stateComment.body = stateCommentBody(state);

  const liveComment = harness.findMarkerComments()[0];
  const liveMarker = parseMarkerCommentBody(liveComment.body);
  delete liveMarker.maxWaitDeadlineAt;
  if (removeLiveHeadStartedAt) {
    delete liveMarker.headStartedAt;
  }
  Object.assign(liveComment, markerCommentFor({
    ...liveMarker,
    id: String(liveComment.id),
    url: liveComment.html_url,
    createdAt: liveComment.created_at,
  }));
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
