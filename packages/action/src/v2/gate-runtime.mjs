#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  codexInlineParentReviewBodyHasClosedGrammar,
  parseCodexIssueCommentArtifact,
  parseCodexReviewArtifact,
} from "../core.mjs";

export const V2_REQUIRED_CHECK_NAME = "codex/github-review-gate";
export const V2_VERIFIER_WORKFLOW_PATH = "codex-review-gate.yml";
export const V2_GITHUB_ACTIONS_APP_ID = 15_368;
export const V2_REQUEST_MARKER = "codex-review-gate-request-v2";
export const V2_STICKY_MARKER = "codex-review-gate:v2:diagnostic";
export const V2_STABILITY_INTERVAL_MS = 5_000;
export const V2_STABILITY_WINDOW_MS = 60_000;
export const V2_REACTION_FETCH_CONCURRENCY = 4;
export const V2_OUTPUT_KEYS = Object.freeze([
  "execution_health",
  "gate_outcome",
  "recovery_code",
  "retry_safe",
]);

export const V2_LIMITS_PROFILES = Object.freeze({
  default: Object.freeze({
    maxPages: 20,
    maxObjects: 2_000,
    maxAttempts: 128,
    maxSnapshotBytes: 32 * 1024 * 1024,
    requestTimeoutMs: 10_000,
    reconcileBudgetMs: 60_000,
  }),
  expanded: Object.freeze({
    maxPages: 100,
    maxObjects: 10_000,
    maxAttempts: 512,
    maxSnapshotBytes: 64 * 1024 * 1024,
    requestTimeoutMs: 20_000,
    reconcileBudgetMs: 300_000,
  }),
});
export const V2_HARD_LIMITS = Object.freeze({
  maxPages: 1_000,
  maxObjects: 20_000,
  maxAttempts: 2_048,
  maxSnapshotBytes: 64 * 1024 * 1024,
  requestTimeoutMs: 30_000,
  reconcileBudgetMs: 720_000,
});

export const V2_RECOVERY_CODES = Object.freeze(new Set([
  "none",
  "wait_provider",
  "reconcile",
  "fix_findings",
  "request_clean_generation",
  "retry_reconcile",
  "wait_then_reconcile",
  "use_expanded_limits",
  "raise_protected_limit",
  "refresh_head",
  "repair_permissions",
  "retry_begin",
  "unsupported_target",
  "create_verifier_run",
]));

const FULL_SHA = /^[0-9a-f]{40}$/u;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/u;
const OFFICIAL_CODEX_BOT_LOGIN = "chatgpt-codex-connector[bot]";
const V2_BASE_EPOCH_QUERY = `query CodexReviewGateBaseEpoch(
  $owner: String!
  $repo: String!
  $number: Int!
) {
  repository(owner: $owner, name: $repo) {
    nameWithOwner
    pullRequest(number: $number) {
      number
      timelineItems(
        last: 1
        itemTypes: [BASE_REF_CHANGED_EVENT, BASE_REF_FORCE_PUSHED_EVENT]
      ) {
        filteredCount
        pageCount
        nodes {
          __typename
          ... on BaseRefChangedEvent {
            id
            createdAt
            previousRefName
            currentRefName
            actor { __typename login }
          }
          ... on BaseRefForcePushedEvent {
            id
            createdAt
            beforeCommit { oid }
            afterCommit { oid }
            ref { name }
            actor { __typename login }
          }
        }
      }
    }
  }
}`;
const V2_DELETED_COMMENTS_PAGE_SIZE = 100;
const V2_OBSERVED_HISTORY_POISON = Symbol("v2-observed-history-poison");
const V2_OBSERVED_HISTORY_COUNT_FLOOR = Symbol("v2-observed-history-count-floor");
const V2_OBSERVED_HISTORY_RAW_IDENTITIES = Symbol(
  "v2-observed-history-raw-identities",
);
const V2_OBSERVED_HISTORY_PARTIAL_FACTS = Symbol(
  "v2-observed-history-partial-facts",
);
const V2_OBSERVED_BASE_EPOCH_COUNT_FLOOR = Symbol(
  "v2-observed-base-epoch-count-floor",
);
const V2_OBSERVED_BASE_EPOCH_LATEST = Symbol(
  "v2-observed-base-epoch-latest",
);
const V2_OBSERVED_CARRIER_FINGERPRINTS = Symbol(
  "v2-observed-carrier-fingerprints",
);
const V2_DELETED_COMMENTS_QUERY = `query CodexReviewGateDeletedComments(
  $owner: String!
  $repo: String!
  $number: Int!
  $cursor: String
  $commentCursor: String
  $includeDeleted: Boolean!
  $includeComments: Boolean!
) {
  repository(owner: $owner, name: $repo) {
    nameWithOwner
    pullRequest(number: $number) {
      number
      timelineItems(
        first: ${V2_DELETED_COMMENTS_PAGE_SIZE}
        after: $cursor
        itemTypes: [COMMENT_DELETED_EVENT]
      ) @include(if: $includeDeleted) {
        totalCount
        filteredCount
        pageCount
        nodes {
          __typename
          ... on CommentDeletedEvent {
            id
            createdAt
            actor { __typename login }
            deletedCommentAuthor { __typename login }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
      comments(
        first: ${V2_DELETED_COMMENTS_PAGE_SIZE}
        after: $commentCursor
      ) @include(if: $includeComments) {
        totalCount
        nodes {
          databaseId: fullDatabaseId
          body
          createdAt
          updatedAt
          lastEditedAt
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

export function normalizeV2Operation(raw) {
  const operation = String(raw ?? "").trim() || "reconcile";
  if (operation !== "reconcile" && operation !== "begin-review") {
    throw new Error("OPERATION_INPUT must be exactly reconcile or begin-review");
  }
  return operation;
}

export function normalizeV2RequestReview(raw) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "" || value === "true") return true;
  if (value === "false") return false;
  throw new Error("REQUEST_REVIEW_INPUT must be exactly true or false");
}

export function normalizeV2LimitsProfile(raw) {
  const profile = String(raw ?? "").trim() || "default";
  if (!Object.hasOwn(V2_LIMITS_PROFILES, profile)) {
    throw new Error("LIMITS_PROFILE must be exactly default or expanded");
  }
  return profile;
}

export function buildCanonicalV2ReviewRequestBody({
  repositoryId,
  prNumber,
  headSha,
  baseSha,
  baseRef,
  baseRepositoryId,
  runId,
} = {}) {
  const rawHead = String(headSha ?? "");
  const normalizedHead = rawHead.toLowerCase();
  if (!FULL_SHA.test(normalizedHead) || rawHead !== normalizedHead) {
    throw new Error("canonical Codex review request head must be one full lowercase SHA");
  }
  const rawBase = String(baseSha ?? "");
  const normalizedBase = rawBase.toLowerCase();
  if (!FULL_SHA.test(normalizedBase) || rawBase !== normalizedBase) {
    throw new Error("canonical Codex review request base must be one full lowercase SHA");
  }
  const normalizedBaseRef = String(baseRef ?? "");
  if (
    normalizedBaseRef.trim() === "" ||
    normalizedBaseRef !== normalizedBaseRef.trim() ||
    /[\u0000-\u001f\u007f]/u.test(normalizedBaseRef)
  ) {
    throw new Error("canonical Codex review request base ref must be one non-empty ref name");
  }
  const normalizedRepositoryId = canonicalPositiveId(repositoryId);
  const normalizedPrNumber = canonicalPositiveId(prNumber);
  const normalizedBaseRepositoryId = canonicalPositiveId(baseRepositoryId);
  const normalizedRunId = canonicalPositiveId(runId);
  if (
    !normalizedRepositoryId ||
    !normalizedPrNumber ||
    !normalizedBaseRepositoryId ||
    !normalizedRunId
  ) {
    throw new Error(
      "canonical Codex review request requires repository, base-repository, PR, and run ids",
    );
  }
  const binding = canonicalJson({
    version: 2,
    repositoryId: normalizedRepositoryId,
    prNumber: normalizedPrNumber,
    headSha: normalizedHead,
    baseSha: normalizedBase,
    baseRef: normalizedBaseRef,
    baseRepositoryId: normalizedBaseRepositoryId,
    runId: normalizedRunId,
  });
  return `@codex review\n\n<!-- ${V2_REQUEST_MARKER}\n${binding}\n-->`;
}

export function parseCanonicalV2ReviewRequestBody(body) {
  if (typeof body !== "string") return null;
  const match = new RegExp(
    `^@codex review\\n\\n<!-- ${escapeRegExp(V2_REQUEST_MARKER)}\\n([^\\n]+)\\n-->$`,
    "u",
  ).exec(body);
  if (!match) return null;
  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return null;
  }
  if (
    !isPlainRecord(parsed) ||
    Object.keys(parsed).sort().join(",") !==
      "baseRef,baseRepositoryId,baseSha,headSha,prNumber,repositoryId,runId,version" ||
    parsed.version !== 2 ||
    !FULL_SHA.test(String(parsed.headSha ?? "")) ||
    !FULL_SHA.test(String(parsed.baseSha ?? "")) ||
    typeof parsed.baseRef !== "string" ||
    parsed.baseRef.trim() === "" ||
    parsed.baseRef !== parsed.baseRef.trim() ||
    /[\u0000-\u001f\u007f]/u.test(parsed.baseRef) ||
    !canonicalPositiveId(parsed.repositoryId) ||
    !canonicalPositiveId(parsed.prNumber) ||
    !canonicalPositiveId(parsed.baseRepositoryId) ||
    !canonicalPositiveId(parsed.runId)
  ) {
    return null;
  }
  const headSha = String(parsed.headSha).toLowerCase();
  const baseSha = String(parsed.baseSha).toLowerCase();
  const binding = {
    version: 2,
    repositoryId: canonicalPositiveId(parsed.repositoryId),
    prNumber: canonicalPositiveId(parsed.prNumber),
    headSha,
    baseSha,
    baseRef: parsed.baseRef,
    baseRepositoryId: canonicalPositiveId(parsed.baseRepositoryId),
    runId: canonicalPositiveId(parsed.runId),
  };
  return body === buildCanonicalV2ReviewRequestBody(binding)
    ? binding
    : null;
}

export function canonicalV2RequestComments(comments) {
  return (comments ?? []).flatMap((comment) => {
    const binding = parseCanonicalV2ReviewRequestBody(comment?.body);
    if (
      !binding ||
      !canonicalPositiveId(comment?.id) ||
      comment?.user?.login !== "github-actions[bot]" ||
      comment?.user?.type !== "Bot" ||
      hasV2ObservedIssueCommentEdit(comment)
    ) {
      return [];
    }
    return [{ comment, binding }];
  });
}

export function buildV2ReactionCleanArtifacts(requests, reactionsByCommentId) {
  const artifacts = [];
  const errors = [];
  let livenessVetoed = false;
  const canonicalReactionIdCounts = new Map();
  for (const inventory of reactionsByCommentId?.values() ?? []) {
    for (const reaction of inventory) {
      const id = canonicalPositiveId(reaction?.id);
      if (id) canonicalReactionIdCounts.set(id, (canonicalReactionIdCounts.get(id) || 0) + 1);
    }
  }
  const reportedDuplicateReactionIds = new Set();
  for (const { comment, binding } of requests ?? []) {
    const commentId = String(comment.id);
    if (
      !isCanonicalUtcTimestamp(comment.created_at) ||
      !isCanonicalUtcTimestamp(comment.updated_at)
    ) {
      errors.push(`Review request ${commentId} has invalid creation or update time`);
      continue;
    }
    const requestCreatedAt = Date.parse(comment.created_at);
    const requestUpdatedAt = Date.parse(comment.updated_at);
    if (requestUpdatedAt < requestCreatedAt) {
      errors.push(`Review request ${commentId} was updated before it was created`);
      continue;
    }
    const plusOnes = [];
    const eyes = [];
    for (const reaction of reactionsByCommentId?.get(commentId) ?? []) {
      if (reaction?.content !== "+1" && reaction?.content !== "eyes") continue;
      if (reaction?.user?.login !== OFFICIAL_CODEX_BOT_LOGIN) continue;
      if (reaction?.user?.type !== "Bot") {
        errors.push(v2InvalidProviderReactionProvenanceError(reaction));
        continue;
      }
      const reactionId = canonicalPositiveId(reaction.id);
      if (!reactionId) {
        errors.push(
          `Codex ${reaction.content} reaction on request ${commentId} has no canonical positive id`,
        );
        continue;
      }
      if (canonicalReactionIdCounts.get(reactionId) !== 1) {
        if (!reportedDuplicateReactionIds.has(reactionId)) {
          errors.push(
            `Codex ${reaction.content} reaction identity ${reactionId} appears more than once`,
          );
          reportedDuplicateReactionIds.add(reactionId);
        }
        continue;
      }
      if (!isCanonicalUtcTimestamp(reaction.created_at)) {
        errors.push(`Codex ${reaction.content} reaction ${reactionId} has no canonical creation time`);
        continue;
      }
      const reactionTime = Date.parse(reaction.created_at);
      if (reaction.content === "+1" && reactionTime <= requestUpdatedAt) {
        errors.push(
          `Codex +1 reaction ${reactionId} is not strictly after the current request revision ${commentId}`,
        );
        continue;
      }
      if (reactionTime <= requestUpdatedAt) continue;
      (reaction.content === "+1" ? plusOnes : eyes).push({
        reaction,
        id: reactionId,
        createdMs: reactionTime,
      });
    }
    plusOnes.sort(compareV2ReactionSignalsNewestFirst);
    const selected = plusOnes[0] || null;
    if (!selected) continue;
    if (eyes.some((candidate) => candidate.createdMs >= selected.createdMs)) {
      livenessVetoed = true;
      continue;
    }
    const reaction = selected.reaction;
    const reactionId = selected.id;
    const carrier = {
      request: {
        id: commentId,
        body: comment.body,
        createdAt: comment.created_at ?? null,
        updatedAt: comment.updated_at ?? null,
        author: {
          login: comment.user?.login ?? null,
          type: comment.user?.type ?? null,
        },
      },
      reaction: {
        id: reactionId,
        content: reaction.content,
        createdAt: reaction.created_at,
        author: {
          login: reaction.user.login,
          type: reaction.user.type,
        },
      },
    };
    artifacts.push({
      kind: "clean",
      source: "request-reaction",
      id: reactionId,
      requestId: commentId,
      headSha: binding.headSha,
      createdAt: reaction.created_at,
      carrierCreatedAt: comment.created_at ?? null,
      carrierUpdatedAt: reaction.created_at,
      carrierDigest: `sha256:${sha256(canonicalJson(carrier))}`,
    });
  }
  return { artifacts, errors, livenessVetoed };
}

export function fingerprintV2Snapshot(snapshot) {
  return `sha256:${sha256(canonicalJson(snapshot))}`;
}

export async function waitForStableV2Snapshot({
  loadSnapshot,
  sleep = sleepMilliseconds,
  now = monotonicMilliseconds,
  intervalMs = V2_STABILITY_INTERVAL_MS,
  windowMs = V2_STABILITY_WINDOW_MS,
} = {}) {
  if (
    typeof loadSnapshot !== "function" ||
    typeof sleep !== "function" ||
    typeof now !== "function"
  ) {
    throw new TypeError(
      "waitForStableV2Snapshot requires loadSnapshot, sleep, and monotonic clock functions",
    );
  }
  validateV2StabilityTiming(intervalMs, windowMs);

  const comparisons = Math.floor(windowMs / intervalMs);
  const deadlineMs = now() + windowMs;
  let previous = await loadSnapshot();
  let loads = 1;
  if (now() >= deadlineMs) {
    return { kind: "unstable", snapshot: previous, loads };
  }
  for (let comparison = 0; comparison < comparisons; comparison += 1) {
    const remainingMs = deadlineMs - now();
    if (remainingMs <= 0) break;
    await sleep(Math.min(intervalMs, remainingMs));
    if (now() >= deadlineMs) break;
    const current = await loadSnapshot();
    loads += 1;
    if (now() >= deadlineMs) {
      previous = current;
      break;
    }
    if (
      previous?.selfConsistent === true &&
      current?.selfConsistent === true &&
      previous.headSha === current.headSha &&
      previous.fingerprint === current.fingerprint
    ) {
      return { kind: "stable", snapshot: current, loads };
    }
    previous = current;
  }
  return { kind: "unstable", snapshot: previous, loads };
}

export function buildV2GateReport({
  executionHealth,
  gateOutcome,
  reason,
  recoveryCode,
  retrySafe,
  requiresReplacementPr = false,
  findingsUnresolved = 0,
  findingsResolved = 0,
  findingsHistorical = 0,
  findingsIndeterminate = 0,
} = {}) {
  if (executionHealth !== "healthy" && executionHealth !== "unhealthy") {
    throw new Error("executionHealth must be healthy or unhealthy");
  }
  if (!new Set(["success", "failure", "pending", "not_applicable", "unknown"]).has(gateOutcome)) {
    throw new Error(
      "gateOutcome must be success, failure, pending, not_applicable, or unknown",
    );
  }
  if (executionHealth === "unhealthy" && gateOutcome === "success") {
    throw new Error("unhealthy/success is not a valid v2 result");
  }
  if (!V2_RECOVERY_CODES.has(recoveryCode)) {
    throw new Error(`recoveryCode is not in the closed v2 set: ${recoveryCode}`);
  }
  const counts = {
    unresolved: findingsUnresolved,
    resolved: findingsResolved,
    historical: findingsHistorical,
    indeterminate: findingsIndeterminate,
  };
  for (const [name, value] of Object.entries(counts)) {
    if (value !== "unknown" && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error(`findings ${name} must be a non-negative safe integer or unknown`);
    }
  }
  const normalizedReason = oneLine(reason, "No reason was reported").slice(0, 2_000);
  const normalizedRetrySafe = retrySafe ?? recoveryCode === "retry_reconcile";
  if (typeof normalizedRetrySafe !== "boolean") {
    throw new Error("retrySafe must be boolean");
  }
  if (typeof requiresReplacementPr !== "boolean") {
    throw new Error("requiresReplacementPr must be boolean");
  }
  return Object.freeze({
    executionHealth,
    gateOutcome,
    reason: normalizedReason,
    recoveryCode,
    retrySafe: normalizedRetrySafe,
    requiresReplacementPr,
    counts: Object.freeze(counts),
  });
}

export function writeV2GateOutputs(outputPath, report) {
  if (!outputPath) throw new Error("GITHUB_OUTPUT is required for the v2 runtime");
  const values = reportOutputValues(report);
  const lines = V2_OUTPUT_KEYS.map((key) => `${key}=${values[key]}`);
  appendFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
}

export function appendV2GateSummary(summaryPath, report, context = {}) {
  if (!summaryPath) return;
  const pr = context.prNumber ? `#${context.prNumber}` : "unknown";
  const head = context.headSha ? `\`${context.headSha}\`` : "unknown";
  const testMerge = FULL_SHA.test(String(context.testMergeSha || ""))
    ? `\`${context.testMergeSha}\``
    : "unknown";
  const reason = formatV2DiagnosticText(report.reason, "No reason was reported");
  const nextAction = formatV2DiagnosticText(
    context.verifierRunId
      ? `Wait for verifier run ${context.verifierRunId} attempt ` +
        `${context.verifierRunAttempt} to complete, then require its exact ` +
        `${V2_REQUIRED_CHECK_NAME} result to be healthy/success before merge.`
      : recoveryInstruction(
          report.recoveryCode,
          context.prNumber,
          report.retrySafe,
          report.requiresReplacementPr,
        ),
    "Inspect the workflow run and retry safely.",
  );
  const body = [
    "## Codex GitHub Review Gate",
    "",
    `- Execution health: **${report.executionHealth}**`,
    `- Gate outcome: **${report.gateOutcome}**`,
    `- Pull request: **${pr}**`,
    `- Exact head: ${head}`,
    `- Test-merge commit: ${testMerge}`,
    `- Reason: ${reason}`,
    `- Recovery code: \`${report.recoveryCode}\``,
    `- Findings: ${formatV2FindingCounts(report.counts)}`,
    ...(context.verifierRunId
      ? [
          `- Verifier run: ${formatV2DiagnosticText(context.verifierRunUrl || context.verifierRunId, "unknown", 500)}`,
          `- Verifier attempt: **${context.verifierRunAttempt}**`,
        ]
      : []),
    "",
    `Next action: ${nextAction}`,
    "",
  ].join("\n");
  appendFileSync(summaryPath, body, "utf8");
}

export function buildV2StickyCommentBody(report, context = {}) {
  const prNumber = Number(context.prNumber);
  const headSha = String(context.headSha ?? "").toLowerCase();
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0 || !FULL_SHA.test(headSha)) {
    throw new Error("v2 sticky report requires one PR number and full lowercase head SHA");
  }
  const reason = formatV2DiagnosticText(report.reason, "No reason was reported");
  const nextAction = formatV2DiagnosticText(
    context.verifierRunId
      ? `Wait for verifier run ${context.verifierRunId} attempt ` +
        `${context.verifierRunAttempt} to complete, then require its exact ` +
        `${V2_REQUIRED_CHECK_NAME} result to be healthy/success before merge.`
      : recoveryInstruction(
          report.recoveryCode,
          prNumber,
          report.retrySafe,
          report.requiresReplacementPr,
        ),
    "Inspect the workflow run and retry safely.",
  );
  const hidden = canonicalJson({
    version: 2,
    prNumber,
    headSha,
    executionHealth: report.executionHealth,
    gateOutcome: report.gateOutcome,
    reason,
    recoveryCode: report.recoveryCode,
    retrySafe: report.retrySafe,
    requiresReplacementPr: report.requiresReplacementPr,
    nextAction,
    findingsUnresolved: report.counts.unresolved,
    findingsResolved: report.counts.resolved,
    findingsHistorical: report.counts.historical,
    findingsIndeterminate: report.counts.indeterminate,
  });
  return [
    "## Codex GitHub Review Gate",
    "",
    `**${report.gateOutcome}** — ${reason}`,
    "",
    `Findings: ${formatV2FindingCounts(report.counts)}.`,
    "",
    `Recovery: \`${report.recoveryCode}\``,
    `Next action: ${nextAction}`,
    "",
    `<!-- ${V2_STICKY_MARKER} -->`,
    `<!-- ${hidden} -->`,
  ].join("\n");
}

export function isV2StickyCommentBody(body) {
  return typeof body === "string" &&
    body.replace(/\r\n?/gu, "\n").split("\n").includes(`<!-- ${V2_STICKY_MARKER} -->`);
}

function parseCanonicalV2StickyCommentBody(body) {
  if (typeof body !== "string") return null;
  const normalized = body.replace(/\r\n?/gu, "\n");
  const lines = normalized.split("\n");
  if (lines.length !== 11 || lines[9] !== `<!-- ${V2_STICKY_MARKER} -->`) {
    return null;
  }
  const hiddenMatch = /^<!-- (\{.*\}) -->$/u.exec(lines[10]);
  if (!hiddenMatch) return null;
  let hidden;
  try {
    hidden = JSON.parse(hiddenMatch[1]);
  } catch {
    return null;
  }
  const expectedKeys = [
    "executionHealth",
    "findingsHistorical",
    "findingsIndeterminate",
    "findingsResolved",
    "findingsUnresolved",
    "gateOutcome",
    "headSha",
    "nextAction",
    "prNumber",
    "reason",
    "recoveryCode",
    "requiresReplacementPr",
    "retrySafe",
    "version",
  ];
  if (
    !isPlainRecord(hidden) ||
    canonicalJson(hidden) !== hiddenMatch[1] ||
    canonicalJson(Object.keys(hidden).sort()) !== canonicalJson(expectedKeys) ||
    hidden.version !== 2 ||
    !Number.isSafeInteger(hidden.prNumber) ||
    hidden.prNumber <= 0 ||
    typeof hidden.headSha !== "string" ||
    !FULL_SHA.test(hidden.headSha) ||
    !new Set(["healthy", "unhealthy"]).has(hidden.executionHealth) ||
    !new Set(["success", "failure", "pending", "not_applicable", "unknown"])
      .has(hidden.gateOutcome) ||
    !V2_RECOVERY_CODES.has(hidden.recoveryCode) ||
    typeof hidden.reason !== "string" ||
    typeof hidden.nextAction !== "string" ||
    typeof hidden.retrySafe !== "boolean" ||
    typeof hidden.requiresReplacementPr !== "boolean"
  ) {
    return null;
  }
  const counts = {
    unresolved: hidden.findingsUnresolved,
    resolved: hidden.findingsResolved,
    historical: hidden.findingsHistorical,
    indeterminate: hidden.findingsIndeterminate,
  };
  if (Object.values(counts).some((value) =>
    value !== "unknown" && (!Number.isSafeInteger(value) || value < 0)
  )) {
    return null;
  }
  const expected = [
    "## Codex GitHub Review Gate",
    "",
    `**${hidden.gateOutcome}** — ${hidden.reason}`,
    "",
    `Findings: ${formatV2FindingCounts(counts)}.`,
    "",
    `Recovery: \`${hidden.recoveryCode}\``,
    `Next action: ${hidden.nextAction}`,
    "",
    `<!-- ${V2_STICKY_MARKER} -->`,
    `<!-- ${hiddenMatch[1]} -->`,
  ].join("\n");
  return body === expected ? hidden : null;
}

function reportOutputValues(report) {
  return {
    execution_health: report.executionHealth,
    gate_outcome: report.gateOutcome,
    recovery_code: report.recoveryCode,
    retry_safe: String(report.retrySafe),
  };
}

function recoveryInstruction(
  code,
  prNumber,
  retrySafe = false,
  requiresReplacementPr = false,
) {
  const target = Number.isSafeInteger(Number(prNumber)) ? ` for PR #${prNumber}` : "";
  if (code === "fix_findings") {
    if (requiresReplacementPr) {
      return (
        `Fix the unresolved Codex findings${target}, then do not request another generation on ` +
        `the original PR because the reported evidence warning proves an unclosable historical ` +
        `lineage. Open a replacement PR with the fixes, run exactly one canonical review ` +
        `generation there, and then reconcile.`
      );
    }
    return `Fix the unresolved Codex findings, request a new review generation, then reconcile${target}.`;
  }
  if (code === "repair_permissions") {
    if (requiresReplacementPr) {
      return (
        `Repair the canonical workflow permissions or installation${target}, then do not add ` +
        `another review boundary on the original PR because its preserved structured lineage ` +
        `requires a replacement PR. Open the replacement PR, run exactly one canonical review ` +
        `generation there, and then reconcile.`
      );
    }
    return `Repair the canonical workflow permissions or installation, then retry${target}.`;
  }
  if (requiresReplacementPr) {
    return (
      `Do not add another review boundary on the original PR${target}: its observed historical ` +
      `lineage cannot be closed safely. Open a replacement PR, run exactly one canonical review ` +
      `generation there, obtain its request-bound clean, and then reconcile.`
    );
  }
  if (code === "none") return "No recovery action is required.";
  if (code === "wait_provider") {
    return `Wait for Codex to publish a terminal result, then dispatch reconcile${target}.`;
  }
  if (code === "reconcile") return `Dispatch reconcile${target} against the exact current head.`;
  if (code === "request_clean_generation") {
    return (
      `Follow the reported request lineage${target}. If the latest current canonical request only ` +
      `lacks request-bound clean, obtain its qualifying direct +1 and then reconcile. Otherwise, ` +
      `because the structured lineage is safe to extend, create exactly one canonical generation, ` +
      `wait for its request-bound clean, and then reconcile.`
    );
  }
  if (code === "retry_reconcile") return `Retry the identical reconcile invocation${target}.`;
  if (code === "wait_then_reconcile") {
    return `Wait for GitHub evidence to settle, then dispatch reconcile${target}.`;
  }
  if (code === "use_expanded_limits") {
    return `Rerun reconcile${target} with limits_profile=expanded.`;
  }
  if (code === "raise_protected_limit") {
    return `Review the evidence volume and raise the protected runtime limit before reconciling${target}.`;
  }
  if (code === "refresh_head") {
    return `Read the PR's current head and dispatch a new exact-head operation${target}.`;
  }
  if (code === "retry_begin") {
    if (retrySafe) {
      return `Retry the identical exact-head begin-review invocation${target}.`;
    }
    return `Wait for the exact same-run request marker to settle${target}; if it remains absent, rerun the original workflow run instead of dispatching a new generation.`;
  }
  if (code === "create_verifier_run") {
    return `Create a fresh verifier for the current test-merge commit${target}: convert a ready PR to draft and mark it ready again, or mark an existing draft ready, then reconcile again.`;
  }
  return `Move the PR to a supported v2 target shape before retrying${target}.`;
}

function formatV2FindingCounts(counts) {
  return [
    `${counts.unresolved} unresolved`,
    `${counts.resolved} resolved`,
    `${counts.historical} historical`,
    `${counts.indeterminate} indeterminate`,
  ].join(", ");
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function canonicalPositiveId(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value === "string" && POSITIVE_DECIMAL.test(value)) return value;
  return null;
}

function isCanonicalUtcTimestamp(value) {
  if (typeof value !== "string") return false;
  const match = /^(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d{1,3}))?Z$/u.exec(value);
  if (!match) return false;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return false;
  return new Date(time).toISOString() === `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z`;
}

function oneLine(value, fallback) {
  const normalized = String(value ?? "").replace(/[\r\n]+/gu, " ").trim();
  return normalized || fallback;
}

function formatV2DiagnosticText(value, fallback, maxLength = 1_000) {
  const source = oneLine(value, fallback);
  const replacements = new Map([
    ["&", "&amp;"],
    ["<", "&lt;"],
    [">", "&gt;"],
    ["@", "&#64;"],
    ["\\", "\\\\"],
    ["`", "\\`"],
    ["*", "\\*"],
    ["_", "\\_"],
    ["[", "\\["],
    ["]", "\\]"],
    ["(", "\\("],
    [")", "\\)"],
    ["#", "\\#"],
    ["!", "\\!"],
    ["|", "\\|"],
    ["~", "\\~"],
  ]);
  let output = "";
  for (const character of source) {
    const encoded = replacements.get(character) || character;
    if (output.length + encoded.length > maxLength - 1) {
      return `${output}…`;
    }
    output += encoded;
  }
  return output;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sleepMilliseconds(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isPlainRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateV2StabilityTiming(intervalMs, windowMs) {
  if (
    !Number.isSafeInteger(intervalMs) ||
    intervalMs <= 0 ||
    !Number.isSafeInteger(windowMs) ||
    windowMs < intervalMs
  ) {
    throw new TypeError("snapshot stability timing must be positive bounded integers");
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const OFFICIAL_CODEX_APP_SLUG = "chatgpt-codex-connector";
const EXACT_CODEX_LOGINS = new Set([OFFICIAL_CODEX_BOT_LOGIN]);
const GITHUB_ACTIONS_BOT_LOGIN = "github-actions[bot]";
const V2_RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

class V2RuntimeFailure extends Error {
  constructor(message, {
    executionHealth = "unhealthy",
    recoveryCode = null,
    gateOutcome = null,
    counts = null,
    httpStatus = null,
    responseReceived = false,
    responsePhase = "none",
    retrySafe = undefined,
    requiresReplacementPr = false,
  } = {}) {
    super(message);
    this.name = "V2RuntimeFailure";
    this.executionHealth = executionHealth;
    this.recoveryCode = recoveryCode;
    this.gateOutcome = gateOutcome;
    this.counts = counts;
    this.httpStatus = httpStatus;
    this.responseReceived = responseReceived;
    this.responsePhase = responsePhase;
    this.retrySafe = retrySafe;
    this.requiresReplacementPr = requiresReplacementPr === true;
  }
}

class V2ResponseSizeFailure extends V2RuntimeFailure {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "V2ResponseSizeFailure";
  }
}

function transientV2SafeReadFailure(message, {
  httpStatus = null,
  responseReceived = false,
  responsePhase = "transport",
} = {}) {
  return new V2RuntimeFailure(message, {
    recoveryCode: "retry_reconcile",
    retrySafe: true,
    httpStatus,
    responseReceived,
    responsePhase,
  });
}

function v2HttpFailure(method, path, response, data = null) {
  const detail = typeof data?.message === "string"
    ? `: ${oneLine(data.message, "GitHub API error").slice(0, 1_000)}`
    : "";
  const options = response.status === 401 || response.status === 403
    ? {
        recoveryCode: "repair_permissions",
        httpStatus: response.status,
        responseReceived: true,
        responsePhase: "http",
      }
    : {
        httpStatus: response.status,
        responseReceived: true,
        responsePhase: "http",
      };
  return new V2RuntimeFailure(
    `GitHub ${method} ${path} returned HTTP ${response.status}${detail}`,
    options,
  );
}

class V2SnapshotDeadlineFailure extends V2RuntimeFailure {
  constructor(label) {
    super(`The GitHub snapshot stability deadline expired while loading ${label}`, {
      recoveryCode: "wait_then_reconcile",
    });
    this.name = "V2SnapshotDeadlineFailure";
    this.stabilityDeadlineExceeded = true;
  }
}

class V2StaleFailure extends V2RuntimeFailure {
  constructor(message) {
    super(message, {
      executionHealth: "healthy",
      gateOutcome: "not_applicable",
      recoveryCode: "refresh_head",
    });
    this.name = "V2StaleFailure";
  }
}

class V2HeadChangedFailure extends V2StaleFailure {
  constructor(message) {
    super(message);
    this.name = "V2HeadChangedFailure";
  }
}

class V2SnapshotBudget {
  constructor(config, {
    deadlineMs = null,
    now = monotonicMilliseconds,
  } = {}) {
    this.profile = config.limitsProfile;
    this.maxPages = config.limits.maxPages;
    this.maxObjects = config.limits.maxObjects;
    this.maxAttempts = config.limits.maxAttempts;
    this.maxSnapshotBytes = config.limits.maxSnapshotBytes;
    this.requestTimeoutMs = config.limits.requestTimeoutMs;
    this.objects = 0;
    this.pages = 0;
    this.attempts = 0;
    this.responseBytes = 0;
    this.deadlineMs = deadlineMs;
    this.now = now;
  }

  remainingMilliseconds() {
    if (this.deadlineMs === null) return Number.POSITIVE_INFINITY;
    return Math.max(0, this.deadlineMs - this.now());
  }

  assertWithinDeadline(label) {
    if (this.remainingMilliseconds() <= 0) {
      throw new V2SnapshotDeadlineFailure(label);
    }
  }

  requestTimeoutMilliseconds(label) {
    this.assertWithinDeadline(label);
    return Math.max(
      1,
      Math.ceil(Math.min(this.requestTimeoutMs, this.remainingMilliseconds())),
    );
  }

  consumeAttempt(label) {
    this.assertWithinDeadline(label);
    this.attempts += 1;
    if (this.attempts > this.maxAttempts) {
      throw this.limitFailure(
        `GitHub API attempt limit exceeded while loading ${label}: ` +
          `${this.attempts} > ${this.maxAttempts}`,
      );
    }
  }

  consumeObjects(count, label) {
    this.assertWithinDeadline(label);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new V2RuntimeFailure(`Invalid object count while loading ${label}`);
    }
    this.objects += count;
    if (this.objects > this.maxObjects) {
      throw this.limitFailure(
        `Evidence object soft limit exceeded while loading ${label}: ` +
          `${this.objects} > ${this.maxObjects}`,
      );
    }
  }

  consumePage(label) {
    this.assertWithinDeadline(label);
    this.pages += 1;
    if (this.pages > this.maxPages) {
      throw this.limitFailure(
        `Aggregate GitHub pagination limit exceeded while loading ${label}: ` +
          `${this.pages} > ${this.maxPages}`,
      );
    }
  }

  consumeResponseBytes(count, label) {
    this.assertWithinDeadline(label);
    if (!Number.isSafeInteger(count) || count < 0 || count > MAX_RESPONSE_BYTES) {
      throw new V2RuntimeFailure(`GitHub response byte limit exceeded while loading ${label}`);
    }
    this.responseBytes += count;
    if (this.responseBytes > this.maxSnapshotBytes) {
      throw this.limitFailure(
        `Aggregate GitHub snapshot response byte limit exceeded: ` +
          `${this.responseBytes} > ${this.maxSnapshotBytes}`,
      );
    }
  }

  limitFailure(message) {
    return new V2RuntimeFailure(message, {
      recoveryCode:
        this.profile === "default" ? "use_expanded_limits" : "raise_protected_limit",
    });
  }
}

class V2GitHubClient {
  constructor(config, fetchImpl) {
    if (typeof fetchImpl !== "function") {
      throw new V2RuntimeFailure("A fetch implementation is required");
    }
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async request(method, path, body = undefined, { budget = null, safeRead = false } = {}) {
    const url = path.startsWith("http") ? path : `${this.config.apiUrl}${path}`;
    const attempts = safeRead ? 3 : 1;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      budget?.consumeAttempt(path);
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error("GitHub API request timed out")),
        budget?.requestTimeoutMilliseconds(path) ?? V2_HARD_LIMITS.requestTimeoutMs,
      );
      let response;
      let raw;
      try {
        response = await this.fetchImpl(url, {
          method,
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${this.config.token}`,
            "X-GitHub-Api-Version": "2022-11-28",
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
        raw = await readBoundedResponseText(response, MAX_RESPONSE_BYTES, path);
      } catch (error) {
        clearTimeout(timeout);
        if (budget && budget.remainingMilliseconds() <= 0) {
          throw new V2SnapshotDeadlineFailure(path);
        }
        if (
          response &&
          !response.ok &&
          (!safeRead || !V2_RETRYABLE_STATUS.has(response.status))
        ) {
          throw v2HttpFailure(method, path, response);
        }
        if (error instanceof V2ResponseSizeFailure) {
          error.httpStatus = response?.status ?? null;
          error.responseReceived = Boolean(response);
          error.responsePhase = response ? "body" : "transport";
          throw error;
        }
        const phase = response ? "response failed" : "failed";
        lastError = transientV2SafeReadFailure(
          `GitHub ${method} ${path} ${phase}: ${oneLine(
            error?.message || String(error),
            "unknown response failure",
          ).slice(0, 1_000)}`,
          {
            httpStatus: response?.status ?? null,
            responseReceived: Boolean(response),
            responsePhase: response ? "body" : "transport",
          },
        );
        if (safeRead && attempt < attempts) {
          await sleepV2RetryDelay(250 * attempt, budget, path);
          continue;
        }
        throw safeRead
          ? lastError
          : new V2RuntimeFailure(lastError.message, {
              httpStatus: lastError.httpStatus,
              responseReceived: lastError.responseReceived,
              responsePhase: lastError.responsePhase,
            });
      } finally {
        clearTimeout(timeout);
      }
      budget?.consumeResponseBytes(Buffer.byteLength(raw), path);
      let data = null;
      if (raw !== "") {
        try {
          data = JSON.parse(raw);
        } catch {
          if (
            !response.ok &&
            (!safeRead || !V2_RETRYABLE_STATUS.has(response.status))
          ) {
            throw v2HttpFailure(method, path, response);
          }
          lastError = transientV2SafeReadFailure(
            `GitHub ${method} ${path} returned non-JSON data`,
            {
              httpStatus: response.status,
              responseReceived: true,
              responsePhase: "decode",
            },
          );
          if (safeRead && attempt < attempts) {
            await sleepV2RetryDelay(250 * attempt, budget, path);
            continue;
          }
          throw safeRead
            ? lastError
            : new V2RuntimeFailure(lastError.message, {
                httpStatus: lastError.httpStatus,
                responseReceived: true,
                responsePhase: lastError.responsePhase,
              });
        }
      }
      if (response.ok) {
        return { data, headers: response.headers, status: response.status };
      }

      lastError = v2HttpFailure(method, path, response, data);
      if (
        safeRead &&
        attempt < attempts &&
        V2_RETRYABLE_STATUS.has(response.status)
      ) {
        await sleepV2RetryDelay(
          retryDelay(response.headers.get("retry-after"), attempt),
          budget,
          path,
        );
        continue;
      }
      if (safeRead && V2_RETRYABLE_STATUS.has(response.status)) {
        throw transientV2SafeReadFailure(lastError.message, {
          httpStatus: response.status,
          responseReceived: true,
          responsePhase: "http",
        });
      }
      throw lastError;
    }
    throw lastError || new V2RuntimeFailure(`GitHub ${method} ${path} failed`);
  }

  async paginate(path, {
    budget,
    label,
    identity = (item) => canonicalPositiveId(item?.id),
    validate = null,
    expectedCount = null,
    observe = null,
    poison = null,
  }) {
    const items = [];
    const seen = new Set();
    for (let page = 1; ; page += 1) {
      const separator = path.includes("?") ? "&" : "?";
      const { data, headers } = await this.request(
        "GET",
        `${path}${separator}per_page=100&page=${page}`,
        undefined,
        { budget, safeRead: true },
      );
      budget.consumePage(label);
      if (!Array.isArray(data)) {
        throw new V2RuntimeFailure(`${label} endpoint did not return an array`);
      }
      if (data.length > 100) {
        throw new V2RuntimeFailure(`${label} endpoint exceeded per_page=100`);
      }
      for (const [index, item] of data.entries()) {
        validate?.(item, `${label} item ${items.length + index + 1}`);
        const id = identity(item);
        if (!id) {
          throw new V2RuntimeFailure(`${label} contains an item without a canonical identity`);
        }
        observe?.(item, id);
        if (seen.has(id)) {
          const message =
            `${label} contains duplicate identity ${id} across paginated evidence`;
          if (typeof poison === "function") throw poison(message);
          throw new V2RuntimeFailure(message, { recoveryCode: "wait_then_reconcile" });
        }
        seen.add(id);
      }
      budget.consumeObjects(data.length, label);
      items.push(...data);
      const { hasNext } = inspectV2PaginationLink(headers.get("link"), label);
      if (hasNext && data.length === 0) {
        throw new V2RuntimeFailure(`${label} returned an empty page with a next Link`);
      }
      const countProvesTerminal =
        isNonNegativeSafeInteger(expectedCount) && items.length === expectedCount;
      const needsAnotherPage = hasNext || (data.length === 100 && !countProvesTerminal);
      if (!needsAnotherPage) return items;
    }
  }
}

export async function runV2GateCli({
  environment = process.env,
  fetchImpl = globalThis.fetch,
  sleep = sleepMilliseconds,
  now = monotonicMilliseconds,
  stabilityIntervalMs = V2_STABILITY_INTERVAL_MS,
  stabilityWindowMs = null,
} = {}) {
  let config;
  let client;
  const context = {
    prNumber: null,
    headSha: "",
    expectedHeadSha: "",
    testMergeSha: "",
    repositoryId: "",
    issueComments: [],
    triggerKind: "",
    headValidated: false,
  };
  try {
    config = readV2Config(environment);
    context.prNumber = config.prNumber;
    Object.assign(config, validateV2Trigger(config));
    context.triggerKind = config.triggerKind;
    client = new V2GitHubClient(config, fetchImpl);
    if (config.triggerKind === "verifier") {
      return await runV2Verifier(client, config, context, {
        sleep,
        now,
        stabilityIntervalMs,
        stabilityWindowMs: stabilityWindowMs ?? config.limits.reconcileBudgetMs,
      });
    }
    return await runV2ControllerAction(client, config, context, {
      sleep,
      now,
      pollIntervalMs: stabilityIntervalMs,
      pollWindowMs: stabilityWindowMs ?? config.limits.reconcileBudgetMs,
    });
  } catch (error) {
    const counts = normalizeV2FailureCounts(error?.counts);
    const stale = error instanceof V2StaleFailure;
    const safeBeginRetry =
      config?.triggerKind === "controller" &&
      config?.operation === "begin-review" &&
      error?.recoveryCode === "retry_reconcile" &&
      error?.retrySafe === true;
    let report = buildV2GateReport({
      executionHealth: stale ? "healthy" : error?.executionHealth || "unhealthy",
      gateOutcome: stale
        ? "not_applicable"
        : error?.gateOutcome ?? (context.headValidated ? "pending" : "unknown"),
      reason: error?.message || String(error),
      recoveryCode: stale
        ? "refresh_head"
        : safeBeginRetry
          ? "retry_begin"
          : error?.recoveryCode ?? (config ? "wait_then_reconcile" : "unsupported_target"),
      retrySafe: error?.retrySafe,
      requiresReplacementPr: error?.requiresReplacementPr === true,
      findingsUnresolved: counts.unresolved,
      findingsResolved: counts.resolved,
      findingsHistorical: counts.historical,
      findingsIndeterminate: counts.indeterminate,
    });
    try {
      report = await finalizeV2Report(client, config || {
        outputPath: environment.GITHUB_OUTPUT || "",
        summaryPath: environment.GITHUB_STEP_SUMMARY || "",
      }, context, report, {
        diagnostic:
          config?.triggerKind === "controller" &&
          context.headValidated &&
          !stale,
      });
    } catch (reportError) {
      console.error(`failed to finalize v2 gate report: ${reportError.message}`);
      const preserveFindingFailure =
        error?.gateOutcome === "failure" &&
        error?.recoveryCode === "fix_findings" &&
        Object.values(counts).every((value) =>
          Number.isSafeInteger(value) && value >= 0
        );
      report = buildV2GateReport({
        executionHealth: "unhealthy",
        gateOutcome: preserveFindingFailure ? "failure" : "unknown",
        reason: `Failed to persist the v2 gate report: ${reportError.message}`,
        recoveryCode: preserveFindingFailure ? error.recoveryCode : "repair_permissions",
        requiresReplacementPr: error?.requiresReplacementPr === true,
        findingsUnresolved: counts.unresolved,
        findingsResolved: counts.resolved,
        findingsHistorical: counts.historical,
        findingsIndeterminate: counts.indeterminate,
      });
      try {
        persistV2ReportFiles(config || {
          outputPath: environment.GITHUB_OUTPUT || "",
          summaryPath: environment.GITHUB_STEP_SUMMARY || "",
        }, report, context, { allowSummaryAfterOutputFailure: true });
      } catch (finalReportError) {
        console.error(
          `failed to persist final unhealthy v2 gate report: ${finalReportError.message}`,
        );
      }
    }
    if (report.executionHealth === "unhealthy") {
      console.error(error?.stack || error?.message || String(error));
    } else {
      console.warn(error?.message || String(error));
    }
    return {
      report,
      exitCode: exitCodeForV2Report(report, config?.triggerKind),
    };
  }
}

async function runV2Verifier(client, config, context, {
  sleep,
  now,
  stabilityIntervalMs,
  stabilityWindowMs,
}) {
  const [repository, initialPr] = await Promise.all([
    loadV2Repository(client, config, null),
    loadV2PullRequest(client, config, null),
  ]);
  initializeV2Scope(config, context, repository, initialPr);
  const unsupported = classifyUnsupportedV2Target(repository, initialPr, config);
  if (unsupported) {
    const report = buildV2GateReport({
      executionHealth: "unhealthy",
      gateOutcome: "not_applicable",
      reason: unsupported,
      recoveryCode: "unsupported_target",
    });
    await finalizeV2Report(client, config, context, report);
    return { report, exitCode: exitCodeForV2Report(report, config.triggerKind) };
  }
  assertV2VerifierLaunchScope(config, initialPr);
  context.headValidated = true;
  return runV2Reconcile(client, config, context, {
    sleep,
    now,
    stabilityIntervalMs,
    stabilityWindowMs,
  });
}

async function runV2ControllerAction(client, config, context, {
  sleep,
  now,
  pollIntervalMs,
  pollWindowMs,
}) {
  const [repository, initialPr] = await Promise.all([
    loadV2Repository(client, config, null),
    loadV2PullRequest(client, config, null),
  ]);
  initializeV2Scope(config, context, repository, initialPr, {
    expectedHeadSha: config.expectedHeadSha || String(initialPr?.head?.sha || "").toLowerCase(),
  });
  if (
    config.triggerSource === "provider" &&
    !isOpenV2PullRequest(initialPr)
  ) {
    const report = staleV2Report(
      "The provider event arrived after the pull request stopped being open",
    );
    await finalizeV2Report(client, config, context, report);
    return { report, exitCode: exitCodeForV2Report(report, config.triggerKind) };
  }
  const unsupported = classifyUnsupportedV2Target(repository, initialPr, config);
  if (unsupported) {
    const report = buildV2GateReport({
      executionHealth: "unhealthy",
      gateOutcome: "not_applicable",
      reason: unsupported,
      recoveryCode: "unsupported_target",
    });
    await finalizeV2Report(client, config, context, report);
    return { report, exitCode: exitCodeForV2Report(report, config.triggerKind) };
  }
  if (initialPr.head.sha.toLowerCase() !== config.expectedHeadSha) {
    throw new V2RuntimeFailure(
      `Expected head ${config.expectedHeadSha} no longer matches current head ` +
        `${initialPr.head.sha.toLowerCase()}`,
      { gateOutcome: "not_applicable", recoveryCode: "refresh_head" },
    );
  }
  context.headValidated = true;
  if (config.triggerSource === "provider") {
    await exactRefetchV2ControllerProviderEvent(client, config);
    if (providerEventIsStale(config.event, config.expectedHeadSha, {
      owner: config.owner,
      repo: config.repo,
    })) {
      const report = staleV2Report("The provider event is bound to an older pull-request head");
      await finalizeV2Report(client, config, context, report);
      return { report, exitCode: exitCodeForV2Report(report, config.triggerKind) };
    }
  }
  if (config.operation === "begin-review") {
    const reviewRequest = await ensureV2ControllerReviewRequest(
      client,
      config,
      context,
      initialPr,
      { now },
    );
    if (config.requestReview && !canonicalPositiveId(reviewRequest.commentId)) {
      throw new V2RuntimeFailure(
        "The adopted or created review request has no canonical comment identity",
      );
    }
  }
  const refresh = await rerunCurrentV2Verifier(client, config, context, initialPr, {
    sleep,
    now,
    pollIntervalMs,
    pollWindowMs,
  });
  context.verifierRunId = refresh.runId;
  context.verifierRunAttempt = refresh.runAttempt;
  context.verifierRunUrl = refresh.runUrl;
  const report = buildV2GateReport({
    executionHealth: "healthy",
    gateOutcome: "pending",
    reason:
      `Verifier run ${refresh.runId} attempt ${refresh.runAttempt} is observable ` +
      `with its unique ${V2_REQUIRED_CHECK_NAME} CheckRun queued or in progress`,
    recoveryCode: "wait_provider",
    retrySafe: false,
    findingsUnresolved: "unknown",
    findingsResolved: "unknown",
    findingsHistorical: "unknown",
    findingsIndeterminate: "unknown",
  });
  await finalizeV2Report(client, config, context, report, { diagnostic: true });
  return { report, exitCode: exitCodeForV2Report(report, config.triggerKind) };
}

function initializeV2Scope(
  config,
  context,
  repository,
  pullRequest,
  { expectedHeadSha = config.expectedHeadSha } = {},
) {
  context.repositoryId = String(repository.id);
  config.repositoryId = context.repositoryId;
  config.expectedHeadSha = expectedHeadSha;
  context.headSha = expectedHeadSha;
  context.expectedHeadSha = expectedHeadSha;
  context.testMergeSha = String(pullRequest?.merge_commit_sha || "").toLowerCase();
  config.testMergeSha = context.testMergeSha;
  config.snapshotScope = Object.freeze({
    repositoryId: repository.id,
    repositoryFullName: repository.full_name,
    defaultBranch: repository.default_branch,
    headRef: pullRequest.head.ref,
    headRepositoryId: pullRequest.head.repo.id,
    headRepositoryFullName: pullRequest.head.repo.full_name,
    baseSha: pullRequest.base.sha.toLowerCase(),
    baseRef: pullRequest.base.ref,
    baseRepositoryId: pullRequest.base.repo.id,
    baseRepositoryFullName: pullRequest.base.repo.full_name,
    testMergeSha: context.testMergeSha,
  });
}

function assertV2VerifierLaunchScope(config, pullRequest) {
  const eventPr = config.event?.pull_request;
  const eventMergeSha = String(eventPr?.merge_commit_sha || "").toLowerCase();
  const currentMergeSha = String(pullRequest?.merge_commit_sha || "").toLowerCase();
  const githubSha = String(config.environment.GITHUB_SHA || "").toLowerCase();
  const expectedMergeRef = `refs/pull/${config.prNumber}/merge`;
  if (
    !FULL_SHA.test(eventMergeSha) ||
    !FULL_SHA.test(currentMergeSha) ||
    !FULL_SHA.test(githubSha) ||
    eventMergeSha !== currentMergeSha ||
    githubSha !== currentMergeSha ||
    config.environment.GITHUB_REF !== expectedMergeRef ||
    String(pullRequest.head.sha || "").toLowerCase() !== config.expectedHeadSha ||
    String(eventPr?.head?.sha || "").toLowerCase() !== config.expectedHeadSha ||
    String(eventPr?.base?.sha || "").toLowerCase() !==
      String(pullRequest.base.sha || "").toLowerCase() ||
    eventPr?.base?.ref !== pullRequest.base.ref ||
    eventPr?.head?.ref !== pullRequest.head.ref ||
    eventPr?.base?.repo?.full_name !== config.repository ||
    eventPr?.head?.repo?.full_name !== config.repository
  ) {
    throw new V2StaleFailure(
      "The pull_request verifier is not bound to the exact current PR head, base, and test-merge commit",
    );
  }
}

async function finalizeV2Report(client, config, context, report, {
  diagnostic = false,
} = {}) {
  persistV2ReportFiles(config || {
    outputPath: "",
    summaryPath: "",
  }, report, context);
  if (
    diagnostic &&
    client &&
    config &&
    Number.isSafeInteger(context.prNumber) &&
    FULL_SHA.test(context.headSha)
  ) {
    await writeV2StickyBestEffort(client, config, context, report);
  }
  return report;
}

function exitCodeForV2Report(report, triggerKind) {
  if (triggerKind === "verifier") {
    return report.executionHealth === "healthy" && report.gateOutcome === "success" ? 0 : 1;
  }
  return report.executionHealth === "healthy" ? 0 : 1;
}

async function exactRefetchV2ControllerProviderEvent(client, config) {
  const eventComment = config.event?.comment;
  const commentId = canonicalPositiveId(eventComment?.id);
  if (!commentId) {
    throw new V2RuntimeFailure("The admitted provider comment has no canonical id", {
      gateOutcome: "not_applicable",
      recoveryCode: "unsupported_target",
    });
  }
  requireV2IssueCommentShape(eventComment, "admitted provider comment");
  const budget = new V2SnapshotBudget(config);
  const { data: refetched } = await client.request(
    "GET",
    `${config.repoPath}/issues/comments/${commentId}`,
    undefined,
    { budget, safeRead: true },
  );
  requireV2IssueCommentShape(refetched, "refetched provider comment");
  if (
    String(refetched.id) !== commentId ||
    !hasExactProviderIdentity(refetched) ||
    canonicalJson(fingerprintIssueComment(refetched)) !==
      canonicalJson(fingerprintIssueComment(eventComment))
  ) {
    throw new V2StaleFailure(
      "The admitted provider comment changed or lost exact Codex identity before controller readback",
    );
  }
}

async function rerunCurrentV2Verifier(client, config, context, pullRequest, {
  sleep,
  now,
  pollIntervalMs,
  pollWindowMs,
}) {
  validateV2StabilityTiming(pollIntervalMs, pollWindowMs);
  if (!FULL_SHA.test(context.testMergeSha)) {
    throw missingV2VerifierRunFailure(
      "The current pull request has no full test-merge commit SHA",
    );
  }
  const deadlineMs = now() + pollWindowMs;
  const budget = new V2SnapshotBudget(config, { deadlineMs, now });
  const currentPr = await loadV2PullRequest(client, config, budget);
  assertV2ExpectedSnapshotScope(currentPr, config);
  assertV2BeginReviewScopeSnapshot(currentPr, config, pullRequest);
  const inventory = await listCurrentV2VerifierRuns(client, config, budget);
  const current = selectCurrentV2VerifierRun(inventory, config, currentPr);
  if (!current) {
    throw missingV2VerifierRunFailure(
      `No canonical pull_request verifier run exists for feature head ${config.expectedHeadSha}`,
    );
  }
  const active = inventory.filter((run) =>
    run.id !== current.id && isActiveV2ActionsStatus(run.status)
  );
  if (active.length > 0 || isActiveV2ActionsStatus(current.status)) {
    throw new V2RuntimeFailure(
      "A canonical verifier attempt is already queued or running; wait for it to settle, then reconcile again",
      { gateOutcome: "pending", recoveryCode: "wait_then_reconcile", retrySafe: false },
    );
  }
  if (current.status !== "completed") {
    throw new V2RuntimeFailure(
      `Verifier run ${current.id} has unsupported baseline status ${current.status}`,
      { gateOutcome: "pending", recoveryCode: "wait_then_reconcile", retrySafe: false },
    );
  }
  const inventoryFingerprint = canonicalV2VerifierInventoryFingerprint(inventory);
  const confirmedInventory = await listCurrentV2VerifierRuns(
    client,
    config,
    budget,
  );
  if (
    canonicalV2VerifierInventoryFingerprint(confirmedInventory) !==
    inventoryFingerprint
  ) {
    throw new V2RuntimeFailure(
      "Canonical verifier workflow-run inventory changed between pre-rerun snapshots",
      { gateOutcome: "pending", recoveryCode: "wait_then_reconcile", retrySafe: false },
    );
  }
  const prePostPr = await loadV2PullRequest(client, config, budget);
  assertV2ControllerRerunScopeSnapshot(prePostPr, config);
  const prePostInventory = await listCurrentV2VerifierRuns(client, config, budget);
  if (
    canonicalV2VerifierInventoryFingerprint(prePostInventory) !==
    inventoryFingerprint
  ) {
    throw new V2RuntimeFailure(
      "Canonical verifier workflow-run inventory changed immediately before rerun POST",
      { gateOutcome: "pending", recoveryCode: "wait_then_reconcile", retrySafe: false },
    );
  }
  const prePostCurrent = selectCurrentV2VerifierRun(prePostInventory, config, prePostPr);
  if (
    !prePostCurrent ||
    prePostCurrent.id !== current.id ||
    prePostCurrent.run_attempt !== current.run_attempt ||
    prePostCurrent.status !== "completed"
  ) {
    throw new V2RuntimeFailure(
      "The canonical verifier baseline changed immediately before rerun POST",
      { gateOutcome: "pending", recoveryCode: "wait_then_reconcile", retrySafe: false },
    );
  }
  const baselineAttempt = current.run_attempt;
  let rerunError = null;
  try {
    const response = await client.request(
      "POST",
      `${config.repoPath}/actions/runs/${current.id}/rerun`,
      undefined,
      { budget, safeRead: false },
    );
    if (response.status !== 201) {
      throw new V2RuntimeFailure(
        `Verifier rerun returned unexpected HTTP ${response.status}`,
        { responseReceived: true, httpStatus: response.status, responsePhase: "ack" },
      );
    }
  } catch (error) {
    if (error?.httpStatus === 401 || error?.httpStatus === 403) throw error;
    if (
      Number.isInteger(error?.httpStatus) &&
      error.httpStatus >= 400 &&
      error.httpStatus < 500 &&
      error.httpStatus !== 408 &&
      error.httpStatus !== 429
    ) {
      throw new V2RuntimeFailure(
        `GitHub definitely rejected verifier rerun ${current.id}: ${error.message}`,
        {
          gateOutcome: "pending",
          recoveryCode: "wait_then_reconcile",
          retrySafe: false,
          httpStatus: error.httpStatus,
          responseReceived: error.responseReceived,
          responsePhase: error.responsePhase,
        },
      );
    }
    rerunError = error;
  }

  try {
    for (;;) {
      if (now() >= deadlineMs) break;
      const observed = await loadExactV2VerifierRun(
        client,
        config,
        currentPr,
        current.id,
        budget,
      );
      if (observed.run_attempt > baselineAttempt + 1) {
        throw new V2RuntimeFailure(
          `Verifier run ${current.id} advanced from attempt ${baselineAttempt} to ` +
            `${observed.run_attempt}; the controller cannot attribute the competing rerun`,
          { gateOutcome: "pending", recoveryCode: "wait_then_reconcile", retrySafe: false },
        );
      }
      if (observed.run_attempt === baselineAttempt + 1) {
        if (observed.status === "completed") {
          throw new V2RuntimeFailure(
            `Verifier attempt ${observed.run_attempt} completed before the controller observed ` +
              "its canonical CheckRun queued or in progress",
            { gateOutcome: "pending", recoveryCode: "wait_then_reconcile", retrySafe: false },
          );
        }
        if (!isActiveV2ActionsStatus(observed.status) || observed.conclusion !== null) {
          throw new V2RuntimeFailure(
            `Verifier attempt ${observed.run_attempt} became inconsistent before the controller ` +
              "observed its canonical CheckRun queued or in progress",
            { gateOutcome: "pending", recoveryCode: "wait_then_reconcile", retrySafe: false },
          );
        }
        const job = await loadUniqueV2VerifierJob(
          client,
          config,
          observed,
          baselineAttempt + 1,
          budget,
        );
        if (job) {
          const checkRun = await loadV2VerifierCheckRun(client, config, job, budget);
          if (
            (job.status === "queued" || job.status === "in_progress") &&
            (checkRun.status === "queued" || checkRun.status === "in_progress")
          ) {
            if (
              canonicalV2VerifierRunLineageFingerprint(observed) !==
              canonicalV2VerifierRunLineageFingerprint(prePostCurrent)
            ) {
              throw new V2RuntimeFailure(
                "The exact verifier A+1 readback changed immutable run identity",
                { gateOutcome: "pending", recoveryCode: "wait_then_reconcile", retrySafe: false },
              );
            }
            const postObservationPr = await loadV2PullRequest(client, config, budget);
            assertV2ControllerRerunScopeSnapshot(postObservationPr, config);
            const postObservationInventory = await listCurrentV2VerifierRuns(
              client,
              config,
              budget,
            );
            const corroboratedRun = assertV2PostRerunInventory({
              baselineInventory: prePostInventory,
              observedInventory: postObservationInventory,
              config,
              pullRequest: postObservationPr,
              runId: current.id,
              runAttempt: baselineAttempt + 1,
              exactObservedRun: observed,
            });
            return {
              runId: String(corroboratedRun.id),
              runAttempt: corroboratedRun.run_attempt,
              runUrl: corroboratedRun.html_url,
              jobId: String(job.id),
              checkRunId: String(checkRun.id),
            };
          }
          if (job.status === "completed" || checkRun.status === "completed") {
            throw new V2RuntimeFailure(
              `Verifier attempt ${observed.run_attempt} completed before the controller observed ` +
                "its canonical CheckRun queued or in progress",
              { gateOutcome: "pending", recoveryCode: "wait_then_reconcile", retrySafe: false },
            );
          }
        }
      } else if (observed.run_attempt < baselineAttempt) {
        throw new V2RuntimeFailure(
          `Verifier run ${current.id} regressed below baseline attempt ${baselineAttempt}`,
          { gateOutcome: "pending", recoveryCode: "wait_then_reconcile", retrySafe: false },
        );
      }
      const remainingMs = deadlineMs - now();
      if (remainingMs <= 0) break;
      await sleep(Math.min(pollIntervalMs, remainingMs));
    }
    const suffix = rerunError
      ? `; the rerun POST result was ambiguous: ${rerunError.message}`
      : "";
    throw new V2RuntimeFailure(
      `Verifier rerun ${current.id} attempt ${baselineAttempt + 1} did not become ` +
        `uniquely observable before the controller deadline${suffix}`,
      { gateOutcome: "pending", recoveryCode: "wait_then_reconcile", retrySafe: false },
    );
  } catch (error) {
    throw failClosedAfterV2VerifierRerunSubmission(error, current.id);
  }
}

function assertV2ControllerRerunScopeSnapshot(pullRequest, config) {
  assertV2ExpectedSnapshotScope(pullRequest, config);
  const expected = config.snapshotScope;
  if (
    !isPlainRecord(expected) ||
    pullRequest.head?.ref !== expected.headRef ||
    pullRequest.head?.repo?.id !== expected.headRepositoryId ||
    pullRequest.head?.repo?.full_name !== expected.headRepositoryFullName ||
    String(pullRequest.base?.sha || "").toLowerCase() !== expected.baseSha ||
    pullRequest.base?.ref !== expected.baseRef ||
    pullRequest.base?.repo?.id !== expected.baseRepositoryId ||
    pullRequest.base?.repo?.full_name !== expected.baseRepositoryFullName ||
    String(pullRequest.merge_commit_sha || "").toLowerCase() !== expected.testMergeSha
  ) {
    throw new V2StaleFailure(
      "Pull-request head, base, or test-merge scope changed during verifier rerun",
    );
  }
}

function assertV2PostRerunInventory({
  baselineInventory,
  observedInventory,
  config,
  pullRequest,
  runId,
  runAttempt,
  exactObservedRun,
}) {
  if (
    canonicalV2VerifierInventoryLineageFingerprint(observedInventory, runId) !==
    canonicalV2VerifierInventoryLineageFingerprint(baselineInventory, runId)
  ) {
    throw new V2RuntimeFailure(
      "Canonical verifier workflow-run inventory changed after observing the new attempt",
      { gateOutcome: "pending", recoveryCode: "wait_then_reconcile", retrySafe: false },
    );
  }
  const current = selectCurrentV2VerifierRun(observedInventory, config, pullRequest);
  const competingActive = observedInventory.filter((run) =>
    run.id !== runId && isActiveV2ActionsStatus(run.status)
  );
  if (
    !current ||
    current.id !== runId ||
    current.run_attempt !== runAttempt ||
    !isActiveV2ActionsStatus(current.status) ||
    current.conclusion !== null ||
    canonicalV2VerifierRunLineageFingerprint(current) !==
      canonicalV2VerifierRunLineageFingerprint(exactObservedRun) ||
    competingActive.length > 0
  ) {
    throw new V2RuntimeFailure(
      "The canonical verifier run changed after observing the new attempt",
      { gateOutcome: "pending", recoveryCode: "wait_then_reconcile", retrySafe: false },
    );
  }
  return current;
}

function failClosedAfterV2VerifierRerunSubmission(error, runId) {
  if (
    error instanceof V2RuntimeFailure &&
    error.gateOutcome === "pending" &&
    error.recoveryCode === "wait_then_reconcile" &&
    error.retrySafe === false
  ) {
    return error;
  }
  return new V2RuntimeFailure(
    `Verifier rerun ${runId} may have been submitted, but its exact readback failed: ` +
      `${error?.message || String(error)}`,
    {
      gateOutcome: "pending",
      recoveryCode: "wait_then_reconcile",
      retrySafe: false,
      httpStatus: error?.httpStatus ?? null,
      responseReceived: error?.responseReceived ?? false,
      responsePhase: error?.responsePhase ?? "none",
    },
  );
}

async function listCurrentV2VerifierRuns(client, config, budget) {
  const workflow = encodeURIComponent(V2_VERIFIER_WORKFLOW_PATH);
  const runs = [];
  const seen = new Set();
  let queryCount = 0;
  let frozenTotalCount = null;
  for (let page = 1; ; page += 1) {
    const path =
      `${config.repoPath}/actions/workflows/${workflow}/runs` +
      `?event=pull_request&head_sha=${encodeURIComponent(config.expectedHeadSha)}` +
      `&per_page=100&page=${page}`;
    const { data, headers } = await client.request(
      "GET",
      path,
      undefined,
      { budget, safeRead: true },
    );
    budget.consumePage(`canonical verifier workflow runs for ${config.expectedHeadSha}`);
    if (
      !isPlainRecord(data) ||
      !isNonNegativeSafeInteger(data.total_count) ||
      !Array.isArray(data.workflow_runs) ||
      data.workflow_runs.length > 100
    ) {
      throw new V2RuntimeFailure("Verifier workflow-run inventory has an invalid shape");
    }
    if (frozenTotalCount === null) {
      frozenTotalCount = data.total_count;
    } else if (data.total_count !== frozenTotalCount) {
      throw new V2RuntimeFailure(
        `Verifier workflow-run inventory total_count changed across pages ` +
          `(${frozenTotalCount} != ${data.total_count})`,
        { gateOutcome: "pending", recoveryCode: "wait_then_reconcile", retrySafe: false },
      );
    }
    queryCount += data.workflow_runs.length;
    for (const [index, run] of data.workflow_runs.entries()) {
      requireV2VerifierRunShape(run, `verifier workflow run ${runs.length + index + 1}`);
      const id = String(run.id);
      if (seen.has(id)) {
        throw new V2RuntimeFailure(
          `Canonical verifier workflow runs contain duplicate identity ${id} ` +
            "across paginated evidence",
          { gateOutcome: "pending", recoveryCode: "wait_then_reconcile", retrySafe: false },
        );
      }
      seen.add(id);
      runs.push(run);
    }
    budget.consumeObjects(data.workflow_runs.length, "canonical verifier workflow runs");
    const { hasNext } = inspectV2PaginationLink(
      headers.get("link"),
      "canonical verifier workflow runs",
    );
    if (!hasNext) {
      if (queryCount !== frozenTotalCount) {
        throw new V2RuntimeFailure(
          `Verifier workflow-run inventory count changed (${queryCount} != ${frozenTotalCount})`,
          { gateOutcome: "pending", recoveryCode: "wait_then_reconcile", retrySafe: false },
        );
      }
      break;
    }
  }
  return runs;
}

function canonicalV2VerifierInventoryFingerprint(runs) {
  return canonicalJson(
    [...runs]
      .sort((left, right) => left.id - right.id)
      .map((run) => ({
        id: run.id,
        runNumber: run.run_number,
        runAttempt: run.run_attempt,
        event: run.event,
        path: run.path,
        displayTitle: run.display_title,
        headSha: String(run.head_sha).toLowerCase(),
        status: run.status,
        conclusion: run.conclusion ?? null,
        htmlUrl: run.html_url,
        pullRequests: run.pull_requests
          .map((pullRequest) => ({
            number: Number(pullRequest?.number),
            headSha: String(pullRequest?.head?.sha || "").toLowerCase(),
            baseSha: String(pullRequest?.base?.sha || "").toLowerCase(),
          }))
          .sort((left, right) =>
            left.number - right.number ||
            left.headSha.localeCompare(right.headSha) ||
            left.baseSha.localeCompare(right.baseSha)
          ),
      })),
  );
}

function canonicalV2VerifierInventoryLineageFingerprint(runs, mutableRunId) {
  return canonicalJson(
    [...runs]
      .sort((left, right) => left.id - right.id)
      .map((run) => ({
        id: run.id,
        runNumber: run.run_number,
        event: run.event,
        path: run.path,
        displayTitle: run.display_title,
        headSha: String(run.head_sha).toLowerCase(),
        htmlUrl: run.html_url,
        ...(run.id === mutableRunId
          ? {}
          : {
              runAttempt: run.run_attempt,
              status: run.status,
              conclusion: run.conclusion ?? null,
            }),
        pullRequests: run.pull_requests
          .map((pullRequest) => ({
            number: Number(pullRequest?.number),
            headSha: String(pullRequest?.head?.sha || "").toLowerCase(),
            baseSha: String(pullRequest?.base?.sha || "").toLowerCase(),
          }))
          .sort((left, right) =>
            left.number - right.number ||
            left.headSha.localeCompare(right.headSha) ||
            left.baseSha.localeCompare(right.baseSha)
          ),
      })),
  );
}

function canonicalV2VerifierRunLineageFingerprint(run) {
  return canonicalJson({
    id: run.id,
    runNumber: run.run_number,
    event: run.event,
    path: run.path,
    displayTitle: run.display_title,
    headSha: String(run.head_sha).toLowerCase(),
    htmlUrl: run.html_url,
    pullRequests: run.pull_requests
      .map((pullRequest) => ({
        number: Number(pullRequest?.number),
        headSha: String(pullRequest?.head?.sha || "").toLowerCase(),
        baseSha: String(pullRequest?.base?.sha || "").toLowerCase(),
      }))
      .sort((left, right) =>
        left.number - right.number ||
        left.headSha.localeCompare(right.headSha) ||
        left.baseSha.localeCompare(right.baseSha)
      ),
  });
}

function selectCurrentV2VerifierRun(runs, config, pullRequest) {
  const candidates = runs
    .filter((run) => v2VerifierRunMatchesScope(run, config, pullRequest))
    .sort((left, right) =>
      right.run_number - left.run_number || right.id - left.id
    );
  if (candidates.length > 1) {
    const first = candidates[0];
    const second = candidates[1];
    if (first.run_number === second.run_number) {
      throw new V2RuntimeFailure(
        "Canonical verifier workflow-run ordering is ambiguous",
        { gateOutcome: "pending", recoveryCode: "wait_then_reconcile", retrySafe: false },
      );
    }
  }
  return candidates[0] || null;
}

function v2VerifierRunMatchesScope(run, config, pullRequest) {
  const matchingPrs = run.pull_requests.filter((value) =>
    Number(value?.number) === config.prNumber &&
    String(value?.head?.sha || "").toLowerCase() === config.expectedHeadSha &&
    String(value?.base?.sha || "").toLowerCase() ===
      String(pullRequest.base.sha || "").toLowerCase()
  );
  return run.event === "pull_request" &&
    isCanonicalV2VerifierWorkflowPath(run.path) &&
    run.display_title === expectedV2VerifierDisplayTitle(config, pullRequest) &&
    String(run.head_sha || "").toLowerCase() === config.expectedHeadSha &&
    run.pull_requests.length === 1 &&
    matchingPrs.length === 1;
}

function expectedV2VerifierDisplayTitle(config, pullRequest) {
  return `codex-review-gate-verifier/${config.prNumber}/${String(
    pullRequest.merge_commit_sha || "",
  ).toLowerCase()}`;
}

function isCanonicalV2VerifierWorkflowPath(path) {
  const canonical = `.github/workflows/${V2_VERIFIER_WORKFLOW_PATH}`;
  return path === canonical || path.startsWith(`${canonical}@`);
}

function requireV2VerifierRunShape(run, label) {
  if (
    !isPlainRecord(run) ||
    !Number.isSafeInteger(run.id) ||
    run.id <= 0 ||
    !Number.isSafeInteger(run.run_number) ||
    run.run_number <= 0 ||
    !Number.isSafeInteger(run.run_attempt) ||
    run.run_attempt <= 0 ||
    typeof run.event !== "string" ||
    typeof run.path !== "string" ||
    typeof run.display_title !== "string" ||
    !FULL_SHA.test(String(run.head_sha || "").toLowerCase()) ||
    typeof run.status !== "string" ||
    typeof run.html_url !== "string" ||
    !Array.isArray(run.pull_requests)
  ) {
    throw new V2RuntimeFailure(`${label} has an incomplete or inconsistent shape`);
  }
}

async function loadExactV2VerifierRun(client, config, pullRequest, runId, budget) {
  const { data } = await client.request(
    "GET",
    `${config.repoPath}/actions/runs/${runId}`,
    undefined,
    { budget, safeRead: true },
  );
  requireV2VerifierRunShape(data, `verifier workflow run ${runId}`);
  if (
    String(data.id) !== String(runId) ||
    !v2VerifierRunMatchesScope(data, config, pullRequest)
  ) {
    throw new V2RuntimeFailure(`Verifier workflow run ${runId} changed identity during readback`);
  }
  return data;
}

async function loadUniqueV2VerifierJob(client, config, run, attempt, budget) {
  const jobs = [];
  const seen = new Set();
  for (let page = 1; ; page += 1) {
    const path =
      `${config.repoPath}/actions/runs/${run.id}/attempts/${attempt}/jobs` +
      `?per_page=100&page=${page}`;
    const { data, headers } = await client.request(
      "GET",
      path,
      undefined,
      { budget, safeRead: true },
    );
    budget.consumePage(`verifier attempt ${attempt} jobs`);
    if (
      !isPlainRecord(data) ||
      !isNonNegativeSafeInteger(data.total_count) ||
      !Array.isArray(data.jobs) ||
      data.jobs.length > 100
    ) {
      throw new V2RuntimeFailure(`Verifier attempt ${attempt} jobs have an invalid shape`);
    }
    for (const job of data.jobs) {
      requireV2VerifierJobShape(job, run, attempt, config);
      const id = String(job.id);
      if (seen.has(id)) {
        throw new V2RuntimeFailure(`Verifier attempt ${attempt} repeats job ${id}`);
      }
      seen.add(id);
    }
    budget.consumeObjects(data.jobs.length, `verifier attempt ${attempt} jobs`);
    jobs.push(...data.jobs);
    const { hasNext } = inspectV2PaginationLink(
      headers.get("link"),
      `verifier attempt ${attempt} jobs`,
    );
    if (!hasNext) {
      if (jobs.length !== data.total_count) {
        throw new V2RuntimeFailure(
          `Verifier attempt ${attempt} job count changed (${jobs.length} != ${data.total_count})`,
          { recoveryCode: "wait_then_reconcile" },
        );
      }
      break;
    }
  }
  const matches = jobs.filter((job) => job.name === V2_REQUIRED_CHECK_NAME);
  if (matches.length > 1) {
    throw new V2RuntimeFailure(
      `Verifier attempt ${attempt} has ${matches.length} canonical jobs`,
      { gateOutcome: "pending", recoveryCode: "wait_then_reconcile", retrySafe: false },
    );
  }
  return matches[0] || null;
}

function requireV2VerifierJobShape(job, run, attempt, config) {
  if (
    !isPlainRecord(job) ||
    !Number.isSafeInteger(job.id) ||
    job.id <= 0 ||
    Number(job.run_id) !== run.id ||
    Number(job.run_attempt) !== attempt ||
    typeof job.name !== "string" ||
    String(job.head_sha || "").toLowerCase() !== config.expectedHeadSha ||
    typeof job.status !== "string" ||
    typeof job.check_run_url !== "string"
  ) {
    throw new V2RuntimeFailure(
      `Verifier attempt ${attempt} contains an incomplete or inconsistent job`,
    );
  }
}

async function loadV2VerifierCheckRun(client, config, job, budget) {
  const expectedPrefix = `${config.apiUrl}${config.repoPath}/check-runs/`;
  if (!job.check_run_url.startsWith(expectedPrefix)) {
    throw new V2RuntimeFailure("Canonical verifier job exposed an out-of-scope CheckRun URL");
  }
  const { data } = await client.request(
    "GET",
    job.check_run_url,
    undefined,
    { budget, safeRead: true },
  );
  if (
    !isPlainRecord(data) ||
    !Number.isSafeInteger(data.id) ||
    data.id <= 0 ||
    data.name !== V2_REQUIRED_CHECK_NAME ||
    String(data.head_sha || "").toLowerCase() !== config.expectedHeadSha ||
    typeof data.status !== "string" ||
    data.app?.id !== V2_GITHUB_ACTIONS_APP_ID ||
    data.app?.slug !== "github-actions"
  ) {
    throw new V2RuntimeFailure(
      "Canonical verifier CheckRun failed exact name, head, or GitHub Actions source readback",
    );
  }
  return data;
}

function isActiveV2ActionsStatus(status) {
  return new Set(["queued", "in_progress", "pending", "requested", "waiting"]).has(status);
}

function missingV2VerifierRunFailure(reason) {
  return new V2RuntimeFailure(reason, {
    gateOutcome: "not_applicable",
    recoveryCode: "create_verifier_run",
    retrySafe: false,
  });
}

async function ensureV2ControllerReviewRequest(client, config, context, initialPr, { now }) {
  const budget = new V2SnapshotBudget(config, {
    deadlineMs: now() + config.limits.reconcileBudgetMs,
    now,
  });
  const observedDeletedCommentEvents = new Map();
  const observedIssueCommentEdits = new Map();
  if (!config.requestReview) {
    await assertV2BeginReviewScope(client, config, initialPr, budget);
    return { kind: "disabled", commentId: null };
  }

  const comments = await loadV2IssueCommentsWithEditHistory(
    client,
    config,
    budget,
    {
      label: "pull-request issue comments",
      expectedCount: initialPr.comments,
      observedDeletedCommentEvents,
      observedIssueCommentEdits,
    },
  );
  context.issueComments = comments;
  if (comments.length !== initialPr.comments) {
    throw new V2RuntimeFailure(
      "Pull-request comments changed while checking for an existing review request",
      { recoveryCode: "wait_then_reconcile" },
    );
  }

  const matching = canonicalV2RequestComments(comments).filter(({ binding }) =>
    binding.repositoryId === context.repositoryId &&
    binding.prNumber === String(config.prNumber) &&
    binding.headSha === context.expectedHeadSha &&
    binding.baseSha === String(initialPr.base.sha).toLowerCase() &&
    binding.baseRef === initialPr.base.ref &&
    binding.baseRepositoryId === String(initialPr.base.repo.id) &&
    binding.runId === config.runId
  );
  if (matching.length > 0) {
    await assertV2BeginReviewScope(client, config, initialPr, budget);
    return {
      kind: matching.length === 1 ? "adopted" : "duplicates",
      commentId: canonicalPositiveId(matching[0].comment.id),
      duplicateCount: matching.length,
    };
  }

  const prePostPr = await loadV2PullRequest(client, config, budget);
  assertV2BeginReviewScopeSnapshot(prePostPr, config, initialPr);
  if (!sameV2InventoryCounts(initialPr, prePostPr)) {
    throw new V2RuntimeFailure(
      "Pull-request inventory changed before the review request could be posted",
      { recoveryCode: "wait_then_reconcile" },
    );
  }

  const requestBody = buildCanonicalV2ReviewRequestBody({
    repositoryId: context.repositoryId,
    prNumber: config.prNumber,
    headSha: context.expectedHeadSha,
    baseSha: String(initialPr.base.sha).toLowerCase(),
    baseRef: initialPr.base.ref,
    baseRepositoryId: initialPr.base.repo.id,
    runId: config.runId,
  });
  let mayHaveCommitted = false;
  let postReturnedSuccessfully = false;
  let createdId = null;
  try {
    try {
      mayHaveCommitted = true;
      const { data: created } = await client.request(
        "POST",
        `${config.repoPath}/issues/${config.prNumber}/comments`,
        { body: requestBody },
        { budget },
      );
      postReturnedSuccessfully = true;
      createdId = canonicalPositiveId(created?.id);
      if (!createdId) {
        throw new V2RuntimeFailure(
          "Review-request POST response omitted a canonical comment id",
        );
      }
      const { data: refetched } = await client.request(
        "GET",
        `${config.repoPath}/issues/comments/${createdId}`,
        undefined,
        { budget, safeRead: true },
      );
      requireV2IssueCommentShape(refetched, "created review request");
      rememberV2ObservedCarrierFingerprint(
        observedIssueCommentEdits,
        "rest",
        createdId,
        canonicalJson(fingerprintIssueComment(refetched)),
      );
      const { deletedCommentEvents, issueCommentEdits } = await loadV2CommentHistory(
        client,
        config,
        budget,
        observedDeletedCommentEvents,
        observedIssueCommentEdits,
      );
      retainV2ObservedDeletedCommentEvents(
        deletedCommentEvents,
        observedDeletedCommentEvents,
      );
      attachV2IssueCommentEditMetadata(
        [refetched],
        issueCommentEdits.filter((edit) => edit.id === createdId),
        observedIssueCommentEdits,
      );
      requireExactV2CreatedReviewRequest(
        refetched,
        createdId,
        requestBody,
        config.runId,
      );
      context.issueComments = [...comments, refetched];

      const postRequestPr = await loadV2PullRequest(client, config, budget);
      assertV2BeginReviewScopeSnapshot(postRequestPr, config, initialPr);
      mayHaveCommitted = false;
      return { kind: "created", commentId: createdId };
    } catch (postError) {
      if (
        !postReturnedSuccessfully &&
        (postError?.httpStatus === 401 || postError?.httpStatus === 403)
      ) {
        mayHaveCommitted = false;
        throw postError;
      }
      let visible = [];
      let visibilityError = null;
      try {
        const reread = await loadV2IssueCommentsWithEditHistory(
          client,
          config,
          budget,
          {
            label: "post-unknown review-request comments",
            observedDeletedCommentEvents,
            observedIssueCommentEdits,
          },
        );
        context.issueComments = reread;
        const sameRun = canonicalV2RequestComments(reread).filter(({ binding }) =>
          binding.repositoryId === context.repositoryId &&
          binding.prNumber === String(config.prNumber) &&
          binding.headSha === context.expectedHeadSha &&
          binding.baseSha === String(initialPr.base.sha).toLowerCase() &&
          binding.baseRef === initialPr.base.ref &&
          binding.baseRepositoryId === String(initialPr.base.repo.id) &&
          binding.runId === config.runId
        );
        visible = postReturnedSuccessfully
          ? sameRun.filter(({ comment }) =>
              canonicalPositiveId(comment.id) === createdId
            )
          : sameRun;
        if (visible.length > 0) {
          await exactRefetchV2RelevantObjects(
            client,
            config,
            budget,
            reread,
            [],
            visible,
            observedIssueCommentEdits,
          );
          if (postReturnedSuccessfully && visible.length === 1) {
            requireExactV2CreatedReviewRequest(
              visible[0].comment,
              createdId,
              requestBody,
              config.runId,
            );
          }
        }
      } catch (error) {
        visibilityError = error;
      }
      await assertV2BeginReviewScope(client, config, initialPr, budget);
      if (visible.length > 0 && visibilityError === null) {
        mayHaveCommitted = false;
        return {
          kind: visible.length === 1 ? "adopted-after-unknown" : "duplicates-after-unknown",
          commentId: canonicalPositiveId(visible[0].comment.id),
          duplicateCount: visible.length,
        };
      }
      const detail = visibilityError
        ? `; visibility verification failed: ${visibilityError.message}`
        : "";
      throw new V2RuntimeFailure(
        `Review-request POST visibility remains unknown: ${postError.message}${detail}`,
      );
    }
  } catch (error) {
    if (!mayHaveCommitted || isSaferV2BeginReviewFailure(error)) throw error;
    if (error?.recoveryCode === "retry_begin" && error?.retrySafe === false) {
      throw error;
    }
    throw new V2RuntimeFailure(
      `Review-request creation may have committed but was not fully verified: ${error.message}`,
      { recoveryCode: "retry_begin", retrySafe: false },
    );
  }
}

async function loadV2IssueCommentsWithEditHistory(
  client,
  config,
  budget,
  {
    label,
    expectedCount = null,
    observedDeletedCommentEvents = null,
    observedIssueCommentEdits = null,
  },
) {
  const comments = await client.paginate(
    `${config.repoPath}/issues/${config.prNumber}/comments`,
    {
      budget,
      label,
      validate: requireV2IssueCommentShape,
      ...(isNonNegativeSafeInteger(expectedCount) ? { expectedCount } : {}),
      observe: (comment, id) => rememberV2ObservedCarrierFingerprint(
        observedIssueCommentEdits,
        "rest",
        id,
        canonicalJson(fingerprintIssueComment(comment)),
      ),
      poison: (message) => poisonV2ObservedHistory(
        observedIssueCommentEdits,
        message,
      ),
    },
  );
  const { deletedCommentEvents, issueCommentEdits } = await loadV2CommentHistory(
    client,
    config,
    budget,
    observedDeletedCommentEvents,
    observedIssueCommentEdits,
  );
  retainV2ObservedDeletedCommentEvents(
    deletedCommentEvents,
    observedDeletedCommentEvents,
  );
  attachV2IssueCommentEditMetadata(
    comments,
    issueCommentEdits,
    observedIssueCommentEdits,
  );
  return comments;
}

function requireExactV2CreatedReviewRequest(refetched, createdId, requestBody, runId) {
  requireV2IssueCommentShape(refetched, "created review request");
  if (
    String(refetched?.id ?? "") !== createdId ||
    refetched?.body !== requestBody ||
    refetched?.user?.login !== GITHUB_ACTIONS_BOT_LOGIN ||
    refetched?.user?.type !== "Bot" ||
    hasV2ObservedIssueCommentEdit(refetched) ||
    parseCanonicalV2ReviewRequestBody(refetched.body)?.runId !== runId
  ) {
    throw new V2RuntimeFailure("Created review request failed exact refetch binding");
  }
}

function isSaferV2BeginReviewFailure(error) {
  return error instanceof V2HeadChangedFailure;
}

async function assertV2BeginReviewScope(client, config, initialPr, budget) {
  const current = await loadV2PullRequest(client, config, budget);
  assertV2BeginReviewScopeSnapshot(current, config, initialPr);
  return current;
}

function assertV2BeginReviewScopeSnapshot(current, config, initialPr) {
  assertV2ExpectedSnapshotScope(current, config);
  if (
    String(current.base?.sha || "").toLowerCase() !==
      String(initialPr.base?.sha || "").toLowerCase() ||
    current.base?.ref !== initialPr.base?.ref ||
    current.base?.repo?.id !== initialPr.base?.repo?.id
  ) {
    throw new V2StaleFailure("Pull-request base scope changed during begin-review");
  }
}

async function runV2Reconcile(client, config, context, {
  sleep,
  now,
  stabilityIntervalMs,
  stabilityWindowMs,
}) {
  validateV2StabilityTiming(stabilityIntervalMs, stabilityWindowMs);
  if (typeof now !== "function") {
    throw new TypeError("snapshot stability requires a monotonic clock function");
  }
  const comparisons = Math.floor(stabilityWindowMs / stabilityIntervalMs);
  const deadlineMs = now() + stabilityWindowMs;
  let previousClean = null;
  let latestComplete = null;
  let instabilityDetail = "";
  const observedDeletedCommentEvents = new Map();
  const observedIssueCommentEdits = new Map();
  const observedBaseEpoch = new Map();
  for (let attempt = 0; attempt <= comparisons; attempt += 1) {
    if (now() >= deadlineMs) {
      instabilityDetail ||= "The monotonic snapshot stability deadline expired";
      break;
    }
    let current;
    try {
      current = await loadCompleteV2Snapshot(client, config, {
        deadlineMs,
        now,
        observedDeletedCommentEvents,
        observedIssueCommentEdits,
        observedBaseEpoch,
      });
    } catch (error) {
      if (error?.recoveryCode !== "wait_then_reconcile") throw error;
      instabilityDetail = error.message;
      previousClean = null;
      current = null;
      if (error?.stabilityDeadlineExceeded) break;
    }

    if (now() >= deadlineMs) {
      instabilityDetail ||= "The monotonic snapshot stability deadline expired";
      break;
    }

    if (current?.selfConsistent === true) {
      latestComplete = current;
      if (current.decision.gateOutcome !== "success") {
        return publishV2SnapshotDecision(client, config, context, current);
      }
      if (
        previousClean &&
        previousClean.headSha === current.headSha &&
        previousClean.fingerprint === current.fingerprint
      ) {
        return publishV2SnapshotDecision(client, config, context, current);
      }
      if (previousClean) {
        instabilityDetail = "Complete clean evidence changed between adjacent snapshots";
      }
      previousClean = current;
    } else if (current) {
      instabilityDetail = "Pull-request scope or inventory changed within a snapshot";
      previousClean = null;
    }

    if (attempt < comparisons) {
      const remainingMs = deadlineMs - now();
      if (remainingMs <= 0) break;
      await sleep(Math.min(stabilityIntervalMs, remainingMs));
    }
  }

  return publishV2UnstablePending(
    client,
    config,
    context,
    latestComplete,
    instabilityDetail,
  );
}

async function publishV2SnapshotDecision(client, config, context, snapshot) {
  context.headSha = snapshot.headSha;
  context.issueComments = snapshot.issueComments;
  const decision = snapshot.decision;
  const report = buildV2GateReport({
    executionHealth: "healthy",
    gateOutcome: decision.gateOutcome,
    reason: decision.reason,
    recoveryCode: decision.recoveryCode,
    requiresReplacementPr: decision.requiresReplacementPr === true,
    findingsUnresolved: snapshot.counts.unresolved,
    findingsResolved: snapshot.counts.resolved,
    findingsHistorical: snapshot.counts.historical,
    findingsIndeterminate: snapshot.counts.indeterminate,
  });
  await finalizeV2Report(client, config, context, report);
  return { report, exitCode: exitCodeForV2Report(report, config.triggerKind) };
}

async function publishV2UnstablePending(client, config, context, snapshot, detail = "") {
  if (FULL_SHA.test(snapshot?.headSha || "")) {
    context.headSha = snapshot.headSha;
  }
  context.issueComments = snapshot?.issueComments || [];
  const detailSuffix = detail ? `: ${oneLine(detail, "unstable evidence")}` : "";
  const report = buildV2GateReport({
    executionHealth: "unhealthy",
    gateOutcome: "pending",
    reason: `GitHub review evidence did not stabilize across two complete snapshots${detailSuffix}`,
    recoveryCode: "wait_then_reconcile",
    requiresReplacementPr: snapshot?.decision?.requiresReplacementPr === true,
    findingsUnresolved: snapshot?.counts?.unresolved ?? "unknown",
    findingsResolved: snapshot?.counts?.resolved ?? "unknown",
    findingsHistorical: snapshot?.counts?.historical ?? "unknown",
    findingsIndeterminate: snapshot?.counts?.indeterminate ?? "unknown",
  });
  await finalizeV2Report(client, config, context, report);
  return { report, exitCode: exitCodeForV2Report(report, config.triggerKind) };
}

function staleV2Report(reason) {
  return buildV2GateReport({
    executionHealth: "healthy",
    gateOutcome: "not_applicable",
    reason,
    recoveryCode: "refresh_head",
  });
}

function normalizeV2FailureCounts(counts) {
  return {
    unresolved: counts?.unresolved ?? "unknown",
    resolved: counts?.resolved ?? "unknown",
    historical: counts?.historical ?? "unknown",
    indeterminate: counts?.indeterminate ?? "unknown",
  };
}

function persistV2ReportFiles(config, report, context, {
  allowSummaryAfterOutputFailure = false,
} = {}) {
  const failures = [];
  let outputFailed = false;
  if (config.outputPath) {
    try {
      writeV2GateOutputs(config.outputPath, report);
    } catch (error) {
      outputFailed = true;
      failures.push(`Action outputs: ${error.message}`);
    }
  }
  if (outputFailed && !allowSummaryAfterOutputFailure) {
    throw v2ReportPersistenceFailure(failures, report);
  }
  try {
    appendV2GateSummary(config.summaryPath || "", report, context);
  } catch (error) {
    failures.push(`step summary: ${error.message}`);
  }
  if (failures.length > 0) {
    throw v2ReportPersistenceFailure(failures, report);
  }
}

function v2ReportPersistenceFailure(failures, report) {
  const preserveFindingFailure =
    report.executionHealth === "healthy" &&
    report.gateOutcome === "failure" &&
    report.recoveryCode === "fix_findings" &&
    Object.values(report.counts).every((value) =>
      Number.isSafeInteger(value) && value >= 0
    );
  return new V2RuntimeFailure(
    `Failed to persist v2 report (${failures.join("; ")})`,
    preserveFindingFailure
      ? {
          gateOutcome: "failure",
          recoveryCode: report.recoveryCode,
          retrySafe: false,
          requiresReplacementPr: report.requiresReplacementPr === true,
          counts: report.counts,
        }
      : {
          requiresReplacementPr: report.requiresReplacementPr === true,
        },
  );
}

function readV2Config(environment) {
  const token = requiredRuntimeValue(environment, "GITHUB_TOKEN", "INPUT_GITHUB_TOKEN");
  const repository = requiredValue(environment, "GITHUB_REPOSITORY");
  const [owner, repo, extra] = repository.split("/");
  if (!owner || !repo || extra) throw new Error("GITHUB_REPOSITORY must be OWNER/REPO");
  const prNumberRaw = runtimeValue(environment, "PR_NUMBER", "INPUT_PR_NUMBER");
  if (!POSITIVE_DECIMAL.test(prNumberRaw)) {
    throw new Error("PR_NUMBER must be one canonical positive decimal integer");
  }
  const prNumber = Number(prNumberRaw);
  if (!Number.isSafeInteger(prNumber)) {
    throw new Error("PR_NUMBER must be a positive safe integer");
  }
  const expectedHeadSha = runtimeValue(
    environment,
    "EXPECTED_HEAD_SHA",
    "INPUT_EXPECTED_HEAD_SHA",
  );
  if (expectedHeadSha !== "" && !FULL_SHA.test(expectedHeadSha)) {
    throw new Error("EXPECTED_HEAD_SHA must be empty or one full lowercase commit SHA");
  }
  const requestCommentId = runtimeValue(
    environment,
    "REQUEST_COMMENT_ID",
    "INPUT_REQUEST_COMMENT_ID",
  );
  if (requestCommentId !== "" && !canonicalPositiveId(requestCommentId)) {
    throw new Error("REQUEST_COMMENT_ID must be empty or one canonical positive decimal id");
  }
  const limitsProfile = normalizeV2LimitsProfile(runtimeValue(
    environment,
    "LIMITS_PROFILE",
    "INPUT_LIMITS_PROFILE",
  ));
  const runId = requiredValue(environment, "GITHUB_RUN_ID");
  if (!canonicalPositiveId(runId)) {
    throw new Error("GITHUB_RUN_ID must be one canonical positive decimal id");
  }
  const requestAuthorPermission = String(
    environment.CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION || "write",
  ).trim();
  if (requestAuthorPermission !== "write" && requestAuthorPermission !== "any") {
    throw new Error(
      "CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION must be exactly write or any",
    );
  }
  const apiUrl = stripSlashes(environment.GITHUB_API_URL || "https://api.github.com");
  const serverUrl = stripSlashes(environment.GITHUB_SERVER_URL || "https://github.com");
  return {
    environment,
    token,
    repository,
    owner,
    repo,
    prNumber,
    repoPath: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    apiUrl,
    serverUrl,
    runId,
    runUrl: `${serverUrl}/${owner}/${repo}/actions/runs/${runId}`,
    outputPath: requiredValue(environment, "GITHUB_OUTPUT"),
    summaryPath: environment.GITHUB_STEP_SUMMARY || "",
    operation: normalizeV2Operation(runtimeValue(
      environment,
      "OPERATION_INPUT",
      "INPUT_OPERATION",
    )),
    requestReview: normalizeV2RequestReview(runtimeValue(
      environment,
      "REQUEST_REVIEW_INPUT",
      "INPUT_REQUEST_REVIEW",
    )),
    expectedHeadSha,
    requestCommentId,
    limitsProfile,
    limits: V2_LIMITS_PROFILES[limitsProfile],
    requestAuthorPermission,
  };
}

function validateV2Trigger(config) {
  const eventName = String(config.environment.GITHUB_EVENT_NAME || "");
  if (
    eventName !== "pull_request" &&
    eventName !== "issue_comment" &&
    eventName !== "workflow_dispatch"
  ) {
    throw new V2RuntimeFailure(`Unsupported v2 runtime event: ${eventName}`, {
      gateOutcome: "not_applicable",
      recoveryCode: "unsupported_target",
    });
  }
  const event = readEvent(config.environment.GITHUB_EVENT_PATH);
  if (eventName === "pull_request") {
    const allowedActions = new Set(["opened", "reopened", "synchronize", "ready_for_review"]);
    const eventPr = event?.pull_request;
    const eventHead = String(eventPr?.head?.sha || "").toLowerCase();
    if (
      !allowedActions.has(event?.action) ||
      !isPlainRecord(eventPr) ||
      Number(event?.number) !== config.prNumber ||
      Number(eventPr?.number) !== config.prNumber ||
      event?.repository?.full_name !== config.repository ||
      eventPr?.base?.repo?.full_name !== config.repository ||
      eventPr?.head?.repo?.full_name !== config.repository ||
      !FULL_SHA.test(eventHead) ||
      config.expectedHeadSha !== eventHead ||
      config.operation !== "reconcile" ||
      config.requestReview !== false ||
      config.requestCommentId !== ""
    ) {
      throw new V2RuntimeFailure(
        "pull_request trigger did not satisfy the exact read-only verifier contract",
        { gateOutcome: "not_applicable", recoveryCode: "unsupported_target" },
      );
    }
    return { triggerKind: "verifier", triggerSource: "pull_request", event };
  }
  if (eventName === "workflow_dispatch") {
    const inputs = event?.inputs;
    let eventRequestReview;
    try {
      eventRequestReview = normalizeV2RequestReview(inputs?.request_review);
    } catch {
      eventRequestReview = null;
    }
    if (
      !config.expectedHeadSha ||
      (event?.repository?.full_name != null &&
        event.repository.full_name !== config.repository) ||
      !isPlainRecord(inputs) ||
      String(inputs.operation || "") !== config.operation ||
      String(inputs.pr_number || "") !== String(config.prNumber) ||
      String(inputs.expected_head_sha || "").toLowerCase() !== config.expectedHeadSha ||
      String(inputs.request_comment_id || "") !== config.requestCommentId ||
      eventRequestReview !== config.requestReview
    ) {
      throw new V2RuntimeFailure(
        "workflow_dispatch did not bind the exact controller operation, repository, PR, and head",
        { gateOutcome: "not_applicable", recoveryCode: "unsupported_target" },
      );
    }
    return {
      triggerKind: "controller",
      triggerSource: "manual",
      event,
      requestReview: config.operation === "begin-review" ? config.requestReview : false,
    };
  }
  if (
    (event?.action !== "created" && event?.action !== "edited") ||
    Number(event?.issue?.number) !== config.prNumber ||
    !event?.issue?.pull_request ||
    event?.sender?.login !== OFFICIAL_CODEX_BOT_LOGIN ||
    event?.sender?.type !== "Bot" ||
    !hasExactProviderIdentity(event?.comment) ||
    config.operation !== "reconcile" ||
    config.requestReview !== false ||
    config.expectedHeadSha !== "" ||
    (config.requestCommentId !== "" &&
      config.requestCommentId !== canonicalPositiveId(event?.comment?.id))
  ) {
    throw new V2RuntimeFailure(
      "issue_comment trigger did not satisfy the exact Codex sender/author contract",
      { gateOutcome: "not_applicable", recoveryCode: "unsupported_target" },
    );
  }
  return { triggerKind: "controller", triggerSource: "provider", event };
}

async function loadV2Repository(client, config, budget) {
  const { data } = await client.request(
    "GET",
    config.repoPath,
    undefined,
    { budget, safeRead: true },
  );
  budget?.consumeObjects(1, "repository metadata");
  if (
    !isPlainRecord(data) ||
    !Number.isSafeInteger(data.id) ||
    data.id <= 0 ||
    data.full_name !== config.repository ||
    typeof data.fork !== "boolean" ||
    typeof data.default_branch !== "string" ||
    data.default_branch.trim() === ""
  ) {
    throw new V2RuntimeFailure("GitHub repository response was incomplete or inconsistent");
  }
  return data;
}

function classifyUnsupportedV2Target(repository, pullRequest, config) {
  if (
    config.serverUrl !== "https://github.com" ||
    config.apiUrl !== "https://api.github.com"
  ) {
    return "Action v2 supports GitHub.com only";
  }
  if (
    config.environment.RUNNER_OS !== "Linux" ||
    config.environment.RUNNER_ENVIRONMENT !== "github-hosted"
  ) {
    return "Action v2 supports GitHub-hosted Linux runners only";
  }
  if (repository.fork) return "Action v2 does not support installation on a fork repository";
  if (!isOpenV2PullRequest(pullRequest)) {
    return "Action v2 requires an open, unmerged pull request";
  }
  if (pullRequest.draft) return "Action v2 does not operate on draft pull requests";
  if (
    pullRequest.base?.ref !== repository.default_branch ||
    pullRequest.base?.repo?.id !== repository.id ||
    pullRequest.base?.repo?.full_name !== config.repository
  ) {
    return "Action v2 requires the repository default branch as the pull-request base";
  }
  if (
    pullRequest.head?.repo?.id !== repository.id ||
    pullRequest.head?.repo?.full_name !== config.repository
  ) {
    return "Action v2 does not support fork pull requests";
  }
  if (
    String(pullRequest.head?.ref || "").startsWith("gh-readonly-queue/") ||
    pullRequest.user?.type === "Bot" ||
    pullRequest.head?.user?.type === "Bot"
  ) {
    return "Action v2 supports ordinary, non-bot same-repository branches only";
  }
  if (config.triggerSource === "manual") {
    const refType = String(config.environment.GITHUB_REF_TYPE || "");
    const refName = String(config.environment.GITHUB_REF_NAME || "");
    if (refType !== "branch" || refName !== repository.default_branch) {
      return "workflow_dispatch must run from the protected default branch";
    }
  }
  return null;
}

function providerEventIsStale(event, currentHead, { owner, repo } = {}) {
  const comment = event?.comment;
  if (!comment || !FULL_SHA.test(currentHead)) return false;
  const artifact = parseCodexIssueCommentArtifact(comment, {
    botLogins: EXACT_CODEX_LOGINS,
    allowShortCommitRefs: true,
    owner,
    repo,
  });
  if (!artifact || artifact.kind === "malformed") return false;
  if (FULL_SHA.test(String(artifact.headSha || ""))) {
    return artifact.headSha.toLowerCase() !== currentHead;
  }
  if (artifact.commitRef) {
    return !currentHead.startsWith(String(artifact.commitRef).toLowerCase());
  }
  return false;
}

async function loadCompleteV2Snapshot(client, config, {
  deadlineMs = null,
  now = monotonicMilliseconds,
  observedDeletedCommentEvents = null,
  observedIssueCommentEdits = null,
  observedBaseEpoch = null,
} = {}) {
  const budget = new V2SnapshotBudget(config, { deadlineMs, now });
  const beforeRepository = await loadV2Repository(client, config, budget);
  const before = await loadV2PullRequest(client, config, budget);
  assertV2ExpectedSnapshotScope(before, config);
  assertV2FixedSnapshotScope(beforeRepository, before, config);
  const opening = await loadV2DecisionCarriers(
    client,
    config,
    budget,
    before,
    observedDeletedCommentEvents,
    observedIssueCommentEdits,
    observedBaseEpoch,
  );
  const closing = await loadV2DecisionCarriers(
    client,
    config,
    budget,
    before,
    observedDeletedCommentEvents,
    observedIssueCommentEdits,
    observedBaseEpoch,
  );
  const afterRepository = await loadV2Repository(client, config, budget);
  const after = await loadV2PullRequest(client, config, budget);
  assertV2ExpectedSnapshotScope(after, config);
  assertV2FixedSnapshotScope(afterRepository, after, config);

  const selfConsistent =
    sameV2RepositoryScope(beforeRepository, afterRepository) &&
    sameV2PullRequestScope(before, after) &&
    sameV2InventoryCounts(before, after) &&
    opening.fingerprint === closing.fingerprint;
  const fingerprintPayload = {
    repository: {
      opening: fingerprintV2RepositoryScope(beforeRepository),
      closing: fingerprintV2RepositoryScope(afterRepository),
    },
    pullRequest: {
      opening: fingerprintV2PullRequestScope(before),
      closing: fingerprintV2PullRequestScope(after),
    },
    decisionCarriers: {
      opening: opening.fingerprint,
      closing: closing.fingerprint,
    },
  };
  budget.assertWithinDeadline("complete GitHub snapshot");
  return {
    selfConsistent,
    headSha: config.expectedHeadSha,
    baseSha: after.base.sha.toLowerCase(),
    fingerprint: fingerprintV2Snapshot(fingerprintPayload),
    issueComments: closing.issueComments,
    counts: closing.decisionEvidence.counts,
    decision: closing.decisionEvidence.decision,
  };
}

async function loadV2DecisionCarriers(
  client,
  config,
  budget,
  pullRequest,
  observedDeletedCommentEvents = null,
  observedIssueCommentEdits = null,
  observedBaseEpoch = null,
) {
  const headSha = config.expectedHeadSha;
  const baseSha = pullRequest.base.sha.toLowerCase();
  const seenReviewIds = new Set();
  const providerReviewIds = new Set();
  const carrierReads = await Promise.allSettled([
    client.paginate(`${config.repoPath}/issues/${config.prNumber}/comments`, {
      budget,
      label: "pull-request issue comments",
      validate: requireV2IssueCommentShape,
      observe: (comment, id) => rememberV2ObservedCarrierFingerprint(
        observedIssueCommentEdits,
        "rest",
        id,
        canonicalJson(fingerprintIssueComment(comment)),
      ),
      poison: (message) => poisonV2ObservedHistory(
        observedIssueCommentEdits,
        message,
      ),
    }),
    client.paginate(`${config.repoPath}/pulls/${config.prNumber}/reviews`, {
      budget,
      label: "pull-request reviews",
      validate: requireV2ReviewShape,
      observe: (review, id) => {
        const providerRelevant = hasAnyV2ProviderIdentitySignal(review);
        rememberV2ObservedCarrierFingerprint(
          observedIssueCommentEdits,
          "review-identity",
          id,
          canonicalJson(fingerprintReviewIdentity(review)),
        );
        if (
          seenReviewIds.has(id) &&
          (providerRelevant || providerReviewIds.has(id))
        ) {
          throw poisonV2ObservedHistory(
            observedIssueCommentEdits,
            `pull-request reviews repeated provider-relevant identity ${id}`,
          );
        }
        seenReviewIds.add(id);
        if (!providerRelevant) return;
        providerReviewIds.add(id);
        rememberV2ObservedCarrierFingerprint(
          observedIssueCommentEdits,
          "review-rest",
          id,
          canonicalJson(fingerprintReview(review)),
        );
      },
    }),
    loadLatestV2BaseEpoch(client, config, budget, observedBaseEpoch),
    loadV2CommentHistory(
      client,
      config,
      budget,
      observedDeletedCommentEvents,
      observedIssueCommentEdits,
    ),
  ]);
  const [issueCommentRead, reviewRead, baseEpochRead, commentHistoryRead] =
    carrierReads;
  let latchError = null;
  if (issueCommentRead.status === "fulfilled") {
    try {
      retainV2ObservedCarrierFingerprints(
        observedIssueCommentEdits,
        "rest",
        issueCommentRead.value.map((comment) => [
          canonicalPositiveId(comment.id),
          canonicalJson(fingerprintIssueComment(comment)),
        ]),
      );
    } catch (error) {
      latchError ??= error;
    }
  }
  if (reviewRead.status === "fulfilled") {
    try {
      retainV2ObservedCarrierFingerprints(
        observedIssueCommentEdits,
        "review-rest",
        reviewRead.value
          .filter(hasAnyV2ProviderIdentitySignal)
          .map((review) => [
            canonicalPositiveId(review.id),
            canonicalJson(fingerprintReview(review)),
          ]),
      );
    } catch (error) {
      latchError ??= error;
    }
  }
  if (commentHistoryRead.status === "fulfilled") {
    const { deletedCommentEvents, issueCommentEdits } = commentHistoryRead.value;
    try {
      retainV2ObservedDeletedCommentEvents(
        deletedCommentEvents,
        observedDeletedCommentEvents,
      );
    } catch (error) {
      latchError ??= error;
    }
    try {
      retainV2ObservedIssueCommentEdits(
        issueCommentEdits,
        observedIssueCommentEdits,
      );
    } catch (error) {
      latchError ??= error;
    }
  }
  if (
    issueCommentRead.status === "fulfilled" &&
    commentHistoryRead.status === "fulfilled"
  ) {
    try {
      attachV2IssueCommentEditMetadata(
        issueCommentRead.value,
        commentHistoryRead.value.issueCommentEdits,
        observedIssueCommentEdits,
      );
    } catch (error) {
      latchError ??= error;
    }
    try {
      requireMatchingV2InventoryCount(
        pullRequest.comments,
        issueCommentRead.value,
        "issue comments",
      );
    } catch (error) {
      latchError ??= error;
    }
  }
  if (latchError) throw latchError;
  const failedRead = carrierReads.find((read) => read.status === "rejected");
  if (failedRead) throw failedRead.reason;
  const issueComments = issueCommentRead.value;
  const reviews = reviewRead.value;
  const baseEpoch = baseEpochRead.value;
  const { deletedCommentEvents, issueCommentEdits } = commentHistoryRead.value;
  const requestAuthority = await collectAuthorizedV2Requests(
    client,
    config,
    budget,
    issueComments,
  );
  await exactRefetchV2RelevantObjects(
    client,
    config,
    budget,
    issueComments,
    reviews,
    requestAuthority.authorized,
    observedIssueCommentEdits,
  );
  const reactionRequests = selectV2ReactionInventoryRequests({
    headSha,
    baseSha,
    baseRef: pullRequest.base.ref,
    baseRepositoryId: String(pullRequest.base.repo.id),
    baseEpoch,
    requests: requestAuthority.boundaries,
    authorizedRequests: requestAuthority.authorized,
  });
  const requestReactions = new Map();
  const seenReactionIdentities = new Map();
  const reactionInventories = await mapV2Bounded(
    reactionRequests,
    V2_REACTION_FETCH_CONCURRENCY,
    async ({ comment }) => {
      const id = String(comment.id);
      const source = `reaction-rest:${id}`;
      const reactions = await client.paginate(
        `${config.repoPath}/issues/comments/${id}/reactions`,
        {
          budget,
          label: `reactions for review request ${id}`,
          validate: requireV2ReactionShape,
          observe: (reaction, reactionId) => {
            const officialIdentity =
              reaction?.user?.login === OFFICIAL_CODEX_BOT_LOGIN;
            const previousWasOfficial = seenReactionIdentities.get(reactionId);
            if (
              previousWasOfficial !== undefined &&
              (officialIdentity || previousWasOfficial)
            ) {
              throw poisonV2ObservedHistory(
                observedIssueCommentEdits,
                `review-request reactions repeated official Codex identity ${reactionId}`,
              );
            }
            seenReactionIdentities.set(
              reactionId,
              Boolean(previousWasOfficial) || officialIdentity,
            );
            rememberV2ObservedCarrierFingerprint(
              observedIssueCommentEdits,
              "reaction-identity",
              reactionId,
              canonicalJson({
                requestId: id,
                reaction: fingerprintReaction(reaction),
              }),
            );
            if (!hasV2ProviderReactionIdentitySignal(reaction)) return;
            rememberV2ObservedCarrierFingerprint(
              observedIssueCommentEdits,
              source,
              reactionId,
              canonicalJson(fingerprintReaction(reaction)),
            );
          },
        },
      );
      retainV2ObservedCarrierFingerprints(
        observedIssueCommentEdits,
        source,
        reactions
          .filter(hasV2ProviderReactionIdentitySignal)
          .map((reaction) => [
            canonicalPositiveId(reaction.id),
            canonicalJson(fingerprintReaction(reaction)),
          ]),
      );
      return [id, reactions];
    },
  );
  for (const [id, reactions] of reactionInventories) {
    requestReactions.set(id, reactions);
  }

  const providerEvidence = await collectV2ProviderEvidence(
    client,
    config,
    budget,
    headSha,
    issueComments,
    reviews,
  );
  const decisionEvidence = reduceV2Evidence({
    headSha,
    baseSha,
    baseRef: pullRequest.base.ref,
    baseRepositoryId: String(pullRequest.base.repo.id),
    baseEpoch,
    requests: requestAuthority.authorized,
    requestBoundaries: requestAuthority.boundaries,
    requestErrors: requestAuthority.errors,
    requestReactions,
    artifacts: providerEvidence.artifacts,
    providerErrors: providerEvidence.errors,
    deletedCommentEvents,
  });
  const carrierPayload = {
    headSha,
    baseSha,
    baseRef: pullRequest.base.ref,
    baseRepositoryId: String(pullRequest.base.repo.id),
    issueComments: issueComments
      .filter(isRelevantV2IssueComment)
      .sort(compareV2IssueCommentsOldestFirst)
      .map(fingerprintIssueComment),
    requestReactions: [...requestReactions]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([requestId, reactions]) => ({
        requestId,
        reactions: reactions
          .filter(hasV2ProviderReactionIdentitySignal)
          .sort(compareV2CanonicalIdsAscending)
          .map(fingerprintReaction),
      })),
    reviews: reviews
      .filter((review) => review?.user?.login === OFFICIAL_CODEX_BOT_LOGIN)
      .sort(compareV2ProviderObjectsById)
      .map(fingerprintReview),
    requestAuthority: requestAuthority.authorized.map((request) => ({
      id: request.id,
      headBound: request.headBound,
      binding: request.binding,
      permission: request.permission,
      revisionAt: v2IssueCommentRevisionAt(request.comment),
    })),
    requestBoundaries: requestAuthority.boundaries.map((request) => ({
      id: request.id,
      headBound: request.headBound,
      binding: request.binding,
      authorized: request.authorized,
      permission: request.permission,
      physicalOnlyReason: request.physicalOnlyReason ?? null,
      revisionAt: v2IssueCommentRevisionAt(request.comment),
    })),
    requestErrors: requestAuthority.errors,
    baseEpoch,
    deletedCommentEvents,
    issueCommentEdits,
    commitResolutions: providerEvidence.commitResolutions,
    providerErrors: providerEvidence.errors,
    exactRefetch: true,
    decision: decisionEvidence.decision,
    counts: decisionEvidence.counts,
  };
  return {
    fingerprint: fingerprintV2Snapshot(carrierPayload),
    issueComments,
    decisionEvidence,
  };
}

function reduceV2Evidence({
  headSha,
  baseSha,
  baseRef,
  baseRepositoryId,
  baseEpoch,
  requests,
  requestBoundaries,
  requestErrors,
  requestReactions,
  artifacts,
  providerErrors,
  deletedCommentEvents,
}) {
  const deletedBoundaries = (deletedCommentEvents ?? []).map(v2DeletedCommentBoundary);
  const scopedErrors = [
    ...(requestErrors ?? []),
    ...(providerErrors ?? []),
    ...(deletedCommentEvents ?? []).map((event) => ({
      message:
        `Deleted comment event ${event.id} has no recoverable body history and may hide a ` +
        `provider-triggering review request`,
      createdAt: event.createdAt,
    })),
  ]
    .map(normalizeV2EvidenceError);
  const blockingErrors = [];
  let indeterminate = scopedErrors.length;
  const authorizedScope = selectCurrentV2RequestGenerations({
    headSha,
    baseSha,
    baseRef,
    baseRepositoryId,
    baseEpoch,
    requests,
  });
  const {
    baseEpochMs,
    generationRequests,
  } = authorizedScope;
  const boundaryScope = selectV2PhysicalRequestBoundaries({
    headSha,
    baseEpoch,
    requests: [...(requestBoundaries ?? []), ...deletedBoundaries],
  });
  const requestEpoch = selectLatestV2RequestEpoch(generationRequests);
  if (requestEpoch.error) {
    blockingErrors.push(requestEpoch.error);
    indeterminate += 1;
  }
  if (baseEpochMs !== null && generationRequests.length === 0) {
    blockingErrors.push(
      `No exact head/base-bound canonical @codex review request is strictly newer than base epoch ` +
        `${baseEpoch.event.typename}:${baseEpoch.event.id} at ${baseEpoch.event.createdAt}`,
    );
  }
  const reactionEvidence = buildV2ReactionCleanArtifacts(
    requestEpoch.selected?.headBound === true ? [requestEpoch.selected] : [],
    requestReactions,
  );
  const allArtifacts = [...(artifacts ?? []), ...reactionEvidence.artifacts];
  const reactionErrors = [...new Set([
    ...reactionEvidence.errors,
    ...findV2GlobalReactionInventoryErrors(requestReactions),
  ])];
  blockingErrors.push(...reactionErrors);
  indeterminate += reactionErrors.length;

  const currentArtifacts = [];
  const currentHeadTerminalArtifacts = [];
  const historicalArtifacts = [];
  const progressArtifacts = [];
  const unboundProviderActivities = (deletedCommentEvents ?? []).map((event) => ({
    source: "comment-deleted-event",
    id: event.id,
    carrierCreatedAt: event.createdAt,
    revisionAt: event.createdAt,
    activityKind: "deleted-comment-unknown-history",
  })).concat(
    (providerErrors ?? [])
      .map((error) => error?.activity)
      .filter((activity) => isPlainRecord(activity)),
  );
  for (const artifact of allArtifacts) {
    const artifactHead = String(
      artifact.resolvedHeadSha || artifact.headSha || "",
    ).toLowerCase();
    if (
      artifact.source !== "request-reaction" &&
      (
        artifact.kind === "malformed" ||
        Boolean(artifact.orderingError) ||
        Boolean(artifact.resolutionError) ||
        (
          (artifact.kind === "clean" || artifact.kind === "finding") &&
          !FULL_SHA.test(artifactHead)
        ) ||
        (
          artifact.source === "issue-comment" &&
          artifact.edited === true &&
          (artifact.kind === "clean" || artifact.kind === "finding")
        )
      )
    ) {
      unboundProviderActivities.push({
        source: artifact.source,
        id: artifact.id,
        carrierCreatedAt: artifact.carrierCreatedAt || artifact.createdAt,
        revisionAt: artifact.revisionAt || artifact.createdAt,
        activityKind: "unbound-provider-carrier",
      });
    }
    if (
      artifact.source === "issue-comment" &&
      artifact.edited === true &&
      (artifact.kind === "clean" || artifact.kind === "finding")
    ) {
      scopedErrors.push(normalizeV2EvidenceError({
        message:
          `Edited Codex ${artifact.kind} issue-comment ${artifact.id} has unobservable prior ` +
          `body history and cannot provide positive terminal authority`,
        createdAt: artifact.createdAt,
      }));
      indeterminate += 1;
      continue;
    }
    if (artifact.kind === "malformed") {
      scopedErrors.push(normalizeV2EvidenceError({
        message: artifact.reason ||
          `Codex artifact ${artifact.source}:${artifact.id} is malformed`,
        createdAt: artifact.createdAt,
      }));
      indeterminate += 1;
      continue;
    }
    if (artifact.orderingError) {
      scopedErrors.push(normalizeV2EvidenceError({
        message: artifact.orderingError,
        createdAt: artifact.createdAt,
      }));
      indeterminate += 1;
      continue;
    }
    if (artifact.kind === "pending" || artifact.auditOnly) {
      if (artifact.kind === "pending" && artifact.pendingKind === "progress") {
        progressArtifacts.push(artifact);
      }
      continue;
    }
    if (artifact.resolutionError) {
      scopedErrors.push(normalizeV2EvidenceError({
        message: artifact.resolutionError,
        createdAt: artifact.createdAt,
      }));
      indeterminate += 1;
      continue;
    }
    if (!FULL_SHA.test(artifactHead)) {
      scopedErrors.push(normalizeV2EvidenceError({
        message: artifact.resolutionError ||
          `Codex artifact ${artifact.source}:${artifact.id} has no unambiguous commit binding`,
        createdAt: artifact.createdAt,
      }));
      indeterminate += 1;
      continue;
    }
    if (artifactHead === headSha) {
      currentHeadTerminalArtifacts.push({ ...artifact, headSha: artifactHead });
      if (
        artifact.kind === "clean" &&
        (
          requestEpoch.error ||
          (
            requestEpoch.selected &&
            Date.parse(artifact.createdAt) <= requestEpoch.selected.revisionMs
          )
        )
      ) {
        continue;
      }
      currentArtifacts.push({ ...artifact, headSha: artifactHead });
    } else {
      historicalArtifacts.push({ ...artifact, headSha: artifactHead });
    }
  }

  currentArtifacts.sort(compareTerminalArtifactsNewestFirst);
  currentHeadTerminalArtifacts.sort(compareTerminalArtifactsNewestFirst);
  const scopedProgressArtifacts = scopeV2ProgressArtifactsToCurrentHead({
    headSha,
    progressArtifacts,
  });
  const providerActivityArtifacts = [
    ...scopedProgressArtifacts,
    ...unboundProviderActivities,
  ];
  const generationLineage = buildV2GenerationLineage({
    currentRequests: boundaryScope.currentRequests,
    currentArtifacts: currentHeadTerminalArtifacts,
    requestReactions,
    providerActivityArtifacts,
    livenessFloorMs: baseEpochMs,
    allowProviderTerminalFirstGapClosure: baseEpochMs === null,
  });
  const sameTimeConflicts = findCrossChannelTimestampConflicts(currentArtifacts);
  for (const conflict of sameTimeConflicts) {
    scopedErrors.push(normalizeV2EvidenceError(conflict));
    indeterminate += 1;
  }
  const positiveCleans = currentArtifacts.filter((artifact) =>
    artifact.kind === "clean" &&
    (
      baseEpochMs === null ||
      (
        artifact.source === "request-reaction" &&
        requestEpoch.selected?.headBound === true &&
        artifact.requestId === requestEpoch.selected.id
      )
    )
  );
  const hasUnattributableEpochTerminalClean = baseEpochMs !== null &&
    currentArtifacts.some((artifact) =>
      artifact.kind === "clean" && artifact.source !== "request-reaction"
    );
  const directSelectedGenerationClean = positiveCleans.find((artifact) =>
    artifact.source === "request-reaction" &&
    artifact.requestId === requestEpoch.selected?.id
  );
  const cleanCandidates = directSelectedGenerationClean
    ? [
        directSelectedGenerationClean,
        ...positiveCleans.filter((artifact) => artifact !== directSelectedGenerationClean),
      ]
    : positiveCleans;
  let selectedClean = null;
  let cleanBlockedByLiveness = false;
  let firstCleanLineageError = null;
  for (const candidate of cleanCandidates) {
    const lineageError = requestEpoch.selected
      ? v2CleanLineageError({
          clean: candidate,
          generation: requestEpoch.selected,
          generationLineage,
        })
      : null;
    if (lineageError) {
      firstCleanLineageError ??= lineageError;
      continue;
    }
    const livenessBlocked = requestEpoch.selected
      ? !isV2QualifyingCleanForGeneration(
          candidate,
          requestEpoch.selected,
          requestReactions,
          generationLineage,
        )
      : false;
    if (livenessBlocked) {
      cleanBlockedByLiveness = true;
      continue;
    }
    selectedClean = candidate;
    break;
  }
  if (!selectedClean && firstCleanLineageError) {
    blockingErrors.push(firstCleanLineageError);
    indeterminate += 1;
  }
  if (cleanCandidates.length === 0) {
    cleanBlockedByLiveness = reactionEvidence.livenessVetoed;
  }
  const providerFindings = currentArtifacts.filter((artifact) => artifact.kind === "finding");
  for (const error of scopedErrors) {
    if (!findV2SupersedingGenerationClean({
      evidenceMs: error.createdMs,
      currentRequests: generationRequests,
      currentCleans: positiveCleans,
      requestReactions,
      generationLineage,
    })) {
      blockingErrors.push(error.message);
    }
  }
  const unresolvedFindings = [];
  const resolvedFindings = [];
  for (const finding of providerFindings) {
    const findingMs = Date.parse(finding.createdAt);
    const supersession = findV2SupersedingGenerationClean({
      evidenceMs: findingMs,
      evidenceHeadSha: finding.headSha,
      currentRequests: generationRequests,
      currentCleans: positiveCleans,
      requestReactions,
      generationLineage,
    });
    if (supersession) {
      resolvedFindings.push(finding);
    } else {
      unresolvedFindings.push(finding);
    }
  }
  const counts = {
    unresolved: unresolvedFindings.reduce(
        (total, artifact) => total + normalizedV2FindingCount(artifact),
        0,
      ),
    resolved: resolvedFindings.reduce(
      (total, artifact) => total + normalizedV2FindingCount(artifact),
      0,
    ),
    historical: historicalArtifacts
      .filter((artifact) => artifact.kind === "finding")
      .reduce((total, artifact) => total + normalizedV2FindingCount(artifact), 0),
    indeterminate,
  };
  const latestPhysicalBoundary = generationLineage.generations.at(-1) ?? null;
  const latestBoundaryCannotBeContinued = latestPhysicalBoundary !== null &&
    latestPhysicalBoundary.authorized !== true;
  const requiresReplacementPr =
    generationLineage.gapClosures.some((closure) => closure === null) ||
    latestBoundaryCannotBeContinued;

  let decision;
  if (counts.unresolved > 0) {
    const sample = unresolvedFindings[0]?.samples?.[0] || null;
    decision = {
      gateOutcome: "failure",
      reason:
        `Codex reported ${counts.unresolved} unresolved finding(s) on the current head` +
        (sample ? `; first: ${oneLine(sample, "finding")}` : "") +
        (blockingErrors.length > 0
          ? `; evidence warning: ${oneLine(blockingErrors[0], "invalid evidence")}`
          : ""),
      recoveryCode: "fix_findings",
    };
  } else if (blockingErrors.length > 0) {
    decision = {
      gateOutcome: "pending",
      reason:
        `Codex evidence is invalid or incomplete: ` +
        `${oneLine(blockingErrors[0], "unknown error")}`,
      recoveryCode: "request_clean_generation",
    };
  } else if (selectedClean && requestEpoch.selected) {
    decision = {
      gateOutcome: "success",
      reason:
        `Stable current-head Codex clean evidence from ${selectedClean.source} ${selectedClean.id}`,
      recoveryCode: "none",
    };
  } else if (cleanBlockedByLiveness) {
    decision = {
      gateOutcome: "pending",
      reason: "Codex activity at or after the latest clean evidence indicates review is still in progress",
      recoveryCode: "wait_provider",
    };
  } else if (hasUnattributableEpochTerminalClean) {
    decision = {
      gateOutcome: "pending",
      reason:
        "A current-head Codex terminal clean exists after the base epoch, but it cannot be " +
        "attributed to the latest exact head/base-bound canonical request; obtain a qualifying " +
        "Codex +1 reaction on that request, then run manual reconcile",
      recoveryCode: "request_clean_generation",
    };
  } else {
    decision = {
      gateOutcome: "pending",
      reason: "No complete Codex terminal result is bound to the current head",
      recoveryCode: "wait_provider",
    };
  }
  decision.requiresReplacementPr = requiresReplacementPr;
  return { counts, decision };
}

function selectCurrentV2RequestGenerations({
  headSha,
  baseSha,
  baseRef,
  baseRepositoryId,
  baseEpoch,
  requests,
}) {
  const baseEpochMs = baseEpoch?.event && isCanonicalUtcTimestamp(baseEpoch.event.createdAt)
    ? Date.parse(baseEpoch.event.createdAt)
    : null;
  const currentRequests = (requests ?? []).filter((request) => {
    if (!Number.isFinite(request.revisionMs)) return false;
    if (baseEpochMs !== null && request.revisionMs <= baseEpochMs) return false;
    if (request.headBound !== true) return true;
    return request.binding.headSha === headSha &&
      request.binding.baseSha === baseSha &&
      request.binding.baseRef === baseRef &&
      request.binding.baseRepositoryId === baseRepositoryId;
  });
  const generationRequests = baseEpochMs === null
    ? currentRequests
    : currentRequests.filter((request) => request.headBound === true);
  return { baseEpochMs, currentRequests, generationRequests };
}

function selectV2PhysicalRequestBoundaries({
  headSha,
  baseEpoch,
  requests,
}) {
  const baseEpochMs = baseEpoch?.event && isCanonicalUtcTimestamp(baseEpoch.event.createdAt)
    ? Date.parse(baseEpoch.event.createdAt)
    : null;
  const currentRequests = (requests ?? []).filter((request) => {
    if (!Number.isFinite(request.revisionMs)) return false;
    if (baseEpochMs !== null && request.revisionMs < baseEpochMs) return false;
    if (request.headBound !== true) return true;
    return request.binding?.headSha === headSha;
  });
  return { baseEpochMs, currentRequests };
}

function selectV2ReactionInventoryRequests({
  headSha,
  baseEpoch,
  requests,
  authorizedRequests,
}) {
  const authorizedIds = new Set((authorizedRequests ?? []).map((request) => request.id));
  const baseEpochMs = baseEpoch?.event && isCanonicalUtcTimestamp(baseEpoch.event.createdAt)
    ? Date.parse(baseEpoch.event.createdAt)
    : null;
  return (requests ?? []).filter((request) => {
    if (!Number.isFinite(request.revisionMs)) return false;
    if (
      !authorizedIds.has(request.id) &&
      !(baseEpochMs !== null && request.revisionMs < baseEpochMs)
    ) {
      return false;
    }
    if (request.headBound !== true) return true;
    return request.binding?.headSha === headSha;
  });
}

function normalizeV2EvidenceError(value) {
  const message = typeof value === "string" ? value : value?.message;
  const createdAt = typeof value === "string" ? null : value?.createdAt;
  const rawHeadSha = typeof value === "string" ? "" : String(value?.headSha || "").toLowerCase();
  return {
    message: oneLine(message, "Unknown Codex evidence error"),
    createdMs: isCanonicalUtcTimestamp(createdAt) ? Date.parse(createdAt) : null,
    headSha: FULL_SHA.test(rawHeadSha) ? rawHeadSha : null,
  };
}

function findV2SupersedingGenerationClean({
  evidenceMs,
  evidenceHeadSha = null,
  currentRequests,
  currentCleans,
  requestReactions,
  generationLineage,
}) {
  if (!Number.isFinite(evidenceMs)) return null;
  const generations = currentRequests
    .filter((request) => request.revisionMs > evidenceMs)
    .sort(compareV2RequestEpochNewestFirst);
  for (const generation of generations) {
    const clean = currentCleans.find((candidate) =>
      (!evidenceHeadSha || candidate.headSha === evidenceHeadSha) &&
      Date.parse(candidate.createdAt) > generation.revisionMs &&
      isV2QualifyingCleanForGeneration(
        candidate,
        generation,
        requestReactions,
        generationLineage,
      )
    );
    if (clean) return { generation, clean };
  }
  return null;
}

function isV2QualifyingCleanForGeneration(
  clean,
  generation,
  requestReactions,
  generationLineage,
) {
  const cleanMs = Date.parse(clean.createdAt);
  if (!Number.isFinite(cleanMs) || cleanMs <= generation.revisionMs) return false;
  if (
    clean.source === "request-reaction" &&
    (clean.requestId !== generation.id || generation.headBound !== true)
  ) {
    return false;
  }
  if (v2CleanLineageError({
    clean,
    generation,
    generationLineage,
  })) {
    return false;
  }
  const laterEyes = hasV2AnyOfficialEyesInClosedWindow({
    requestReactions,
    startMs: cleanMs,
    endMs: Number.POSITIVE_INFINITY,
  });
  const unsettledEarlierRequestEyes = hasV2UnsettledOfficialEyesOnOtherRequests({
    requestReactions,
    generationId: generation.id,
    beforeMs: cleanMs,
    floorMs: generationLineage.livenessFloorMs,
  });
  const laterProviderActivity = hasV2ProviderActivityInClosedWindow({
    activities: generationLineage.providerActivities,
    startMs: cleanMs,
    endMs: Number.POSITIVE_INFINITY,
    ignoredTerminal: clean.source === "request-reaction" ? null : clean,
  });
  return !laterEyes && !unsettledEarlierRequestEyes && !laterProviderActivity;
}

function v2CleanLineageError({
  clean,
  generation,
  generationLineage,
}) {
  const generationIndex = generationLineage?.indexById?.get(generation.id);
  if (!Number.isSafeInteger(generationIndex)) {
    return `Terminal clean ${clean.source}:${clean.id} is not bound to a known review generation`;
  }
  const cleanMs = Date.parse(clean.createdAt);
  if (clean.source !== "request-reaction") {
    const activityWindow = v2ProviderActivityWindow(clean);
    if (
      !activityWindow ||
      activityWindow.carrierCreatedMs <= generation.revisionMs
    ) {
      return (
        `Terminal clean ${clean.source}:${clean.id} has an unknown activity interval that ` +
        `starts at or before review request ${generation.id}`
      );
    }
  }
  const nextGeneration = generationLineage.generations[generationIndex + 1];
  if (clean.source === "request-reaction") {
    if (nextGeneration) {
      return (
        `Direct clean ${clean.source}:${clean.id} cannot be attributed to earlier review request ` +
        `${generation.id}: newer request ${nextGeneration.id} already existed`
      );
    }
  } else if (nextGeneration) {
    if (cleanMs >= nextGeneration.revisionMs) {
      return (
        `Terminal clean ${clean.source}:${clean.id} cannot be attributed to earlier review request ` +
        `${generation.id}: newer request ${nextGeneration.id} already existed`
      );
    }
    return (
      `Terminal clean ${clean.source}:${clean.id} predates newer physical review request ` +
      `${nextGeneration.id} and cannot satisfy the latest review generation`
    );
  }
  const unclosedIndex = generationLineage.firstUnclosedGapByGeneration[generationIndex];
  if (Number.isSafeInteger(unclosedIndex)) {
    const predecessor = generationLineage.generations[unclosedIndex];
    const successor = generationLineage.generations[unclosedIndex + 1];
    return (
      `Terminal clean ${clean.source}:${clean.id} cannot be attributed to review request ` +
      `${generation.id}: earlier request ${predecessor.id} had no qualifying settled closure ` +
      `before newer request ${successor.id}`
    );
  }
  if (clean.source !== "request-reaction" && generationIndex > 0) {
    const predecessor = generationLineage.generations[generationIndex - 1];
    return (
      `Terminal clean ${clean.source}:${clean.id} cannot be uniquely attributed to review request ` +
      `${generation.id}: earlier physical request ${predecessor.id} can emit delayed or duplicate ` +
      `terminal carriers; obtain a qualifying Codex +1 directly on request ${generation.id}`
    );
  }
  return null;
}

function buildV2GenerationLineage({
  currentRequests,
  currentArtifacts,
  requestReactions,
  providerActivityArtifacts,
  livenessFloorMs = null,
  allowProviderTerminalFirstGapClosure = true,
}) {
  const generations = [...(currentRequests ?? [])]
    .filter((request) => Number.isFinite(request?.revisionMs))
    .sort((left, right) =>
      left.revisionMs - right.revisionMs ||
      compareV2LineageBoundaryIdsAscending(left, right)
    );
  const indexById = new Map(generations.map((request, index) => [request.id, index]));
  const providerTerminals = (currentArtifacts ?? [])
    .filter((artifact) =>
      artifact.source !== "request-reaction" &&
      (artifact.kind === "clean" || artifact.kind === "finding")
    )
    .map((artifact) => ({
      source: artifact.source,
      id: artifact.id,
      kind: artifact.kind,
      createdAt: artifact.createdAt,
      createdMs: Date.parse(artifact.createdAt),
      carrierCreatedAt: artifact.carrierCreatedAt || artifact.createdAt,
      revisionAt: artifact.revisionAt || artifact.createdAt,
    }))
    .filter((artifact) => Number.isFinite(artifact.createdMs))
    .sort((left, right) =>
      left.createdMs - right.createdMs ||
      left.source.localeCompare(right.source) ||
      compareV2CanonicalIdsAscending(left, right)
    );
  const providerActivities = mergeV2ProviderActivities(
    providerTerminals,
    providerActivityArtifacts,
  );
  const canonicalReactionIdCounts = new Map();
  for (const inventory of requestReactions?.values() ?? []) {
    for (const reaction of inventory) {
      const id = canonicalPositiveId(reaction?.id);
      if (id) canonicalReactionIdCounts.set(id, (canonicalReactionIdCounts.get(id) || 0) + 1);
    }
  }
  const firstUnclosedGapByGeneration = Array(generations.length).fill(null);
  const gapClosures = Array(Math.max(0, generations.length - 1)).fill(null);
  let firstUnclosedGap = null;
  for (let index = 0; index + 1 < generations.length; index += 1) {
    const predecessor = generations[index];
    const successor = generations[index + 1];
    const providerClosure =
      allowProviderTerminalFirstGapClosure &&
      index === 0 &&
      requestReactions?.has(predecessor.id)
      ? providerTerminals.find((terminal) =>
          v2ProviderActivityWindow(terminal)?.carrierCreatedMs > predecessor.revisionMs &&
          terminal.createdMs > predecessor.revisionMs &&
          terminal.createdMs < successor.revisionMs &&
          !hasV2AnyOfficialEyesInClosedWindow({
            requestReactions,
            startMs: terminal.createdMs,
            endMs: successor.revisionMs,
          }) &&
          !hasV2ProviderActivityInClosedWindow({
            activities: providerActivities,
            startMs: terminal.createdMs,
            endMs: successor.revisionMs,
            ignoredTerminal: terminal,
          })
        ) ?? null
      : null;
    const reactionClosed = predecessor.headBound === true &&
      hasV2DirectReactionClosureBefore({
        request: predecessor,
        beforeMs: successor.revisionMs,
        requestReactions,
        canonicalReactionIdCounts,
        providerActivities,
      });
    if (providerClosure) {
      gapClosures[index] = {
        kind: "provider-terminal",
        source: providerClosure.source,
        id: providerClosure.id,
      };
    } else if (reactionClosed) {
      gapClosures[index] = {
        kind: "request-reaction",
        requestId: predecessor.id,
      };
    } else if (firstUnclosedGap === null) {
      firstUnclosedGap = index;
    }
    firstUnclosedGapByGeneration[index + 1] = firstUnclosedGap;
  }
  return {
    generations,
    indexById,
    firstUnclosedGapByGeneration,
    gapClosures,
    providerActivities,
    livenessFloorMs: Number.isFinite(livenessFloorMs) ? livenessFloorMs : null,
  };
}

function v2ProviderActivityWindow(artifact) {
  const carrierCreatedAt = artifact?.carrierCreatedAt;
  const revisionAt = artifact?.revisionAt || artifact?.createdAt;
  if (
    !isCanonicalUtcTimestamp(carrierCreatedAt) ||
    !isCanonicalUtcTimestamp(revisionAt)
  ) {
    return null;
  }
  const carrierCreatedMs = Date.parse(carrierCreatedAt);
  const revisionMs = Date.parse(revisionAt);
  if (
    !Number.isFinite(carrierCreatedMs) ||
    !Number.isFinite(revisionMs) ||
    revisionMs < carrierCreatedMs
  ) {
    return null;
  }
  return { carrierCreatedMs, revisionMs };
}

function scopeV2ProgressArtifactsToCurrentHead({
  headSha,
  progressArtifacts,
}) {
  return (progressArtifacts ?? []).filter((artifact) => {
    if (artifact?.resolutionError) return true;

    const explicitHead = String(
      artifact?.resolvedHeadSha || artifact?.headSha || "",
    ).toLowerCase();
    return !FULL_SHA.test(explicitHead) || explicitHead === headSha;
  });
}

function mergeV2ProviderActivities(providerTerminals, providerActivityArtifacts) {
  const byIdentity = new Map();
  for (const artifact of [
    ...(providerTerminals ?? []),
    ...(providerActivityArtifacts ?? []),
  ]) {
    const key = `${artifact?.source || "unknown"}:${artifact?.id || "unknown"}`;
    const existing = byIdentity.get(key);
    if (!existing) {
      byIdentity.set(key, artifact);
      continue;
    }
    const existingWindow = v2ProviderActivityWindow(existing);
    const candidateWindow = v2ProviderActivityWindow(artifact);
    if (
      candidateWindow &&
      (!existingWindow ||
        candidateWindow.carrierCreatedMs < existingWindow.carrierCreatedMs ||
        candidateWindow.revisionMs > existingWindow.revisionMs)
    ) {
      byIdentity.set(key, artifact);
    }
  }
  return [...byIdentity.values()];
}

function hasV2AnyOfficialEyesInClosedWindow({
  requestReactions,
  startMs,
  endMs,
}) {
  for (const reactions of requestReactions?.values() ?? []) {
    if ((reactions ?? []).some((reaction) =>
      reaction?.content === "eyes" &&
      reaction?.user?.login === OFFICIAL_CODEX_BOT_LOGIN &&
      reaction?.user?.type === "Bot" &&
      isCanonicalUtcTimestamp(reaction.created_at) &&
      Date.parse(reaction.created_at) >= startMs &&
      Date.parse(reaction.created_at) <= endMs
    )) {
      return true;
    }
  }
  return false;
}

function findV2GlobalReactionInventoryErrors(requestReactions) {
  const identities = new Map();
  const errors = [];
  for (const reactions of requestReactions?.values() ?? []) {
    for (const reaction of reactions ?? []) {
      const id = canonicalPositiveId(reaction?.id);
      if (!id) continue;
      const identity = identities.get(id) || { count: 0, officialSignal: null };
      identity.count += 1;
      if (hasV2ProviderReactionIdentitySignal(reaction)) {
        identity.officialSignal ||= reaction.content;
        if (reaction?.user?.type !== "Bot") {
          errors.push(v2InvalidProviderReactionProvenanceError(reaction));
        }
      }
      identities.set(id, identity);
    }
  }
  return errors.concat([...identities]
    .filter(([, identity]) => identity.count !== 1 && identity.officialSignal)
    .sort(([left], [right]) => BigInt(left) < BigInt(right) ? -1 : 1)
    .map(([id, identity]) =>
      `Codex ${identity.officialSignal} reaction identity ${id} appears more than once`
    ));
}

function hasV2UnsettledOfficialEyesOnOtherRequests({
  requestReactions,
  generationId,
  beforeMs,
  floorMs = null,
}) {
  const canonicalReactionIdCounts = new Map();
  for (const reactions of requestReactions?.values() ?? []) {
    for (const reaction of reactions ?? []) {
      const id = canonicalPositiveId(reaction?.id);
      if (id) {
        canonicalReactionIdCounts.set(
          id,
          (canonicalReactionIdCounts.get(id) || 0) + 1,
        );
      }
    }
  }
  const lowerBoundMs = Number.isFinite(floorMs)
    ? floorMs
    : Number.NEGATIVE_INFINITY;
  for (const [requestId, reactions] of requestReactions?.entries() ?? []) {
    if (String(requestId) === String(generationId)) continue;
    const officialSignals = (reactions ?? []).flatMap((reaction) => {
      const id = canonicalPositiveId(reaction?.id);
      if (
        !id ||
        canonicalReactionIdCounts.get(id) !== 1 ||
        (reaction?.content !== "+1" && reaction?.content !== "eyes") ||
        reaction?.user?.login !== OFFICIAL_CODEX_BOT_LOGIN ||
        reaction?.user?.type !== "Bot" ||
        !isCanonicalUtcTimestamp(reaction.created_at)
      ) {
        return [];
      }
      return [{ content: reaction.content, createdMs: Date.parse(reaction.created_at) }];
    });
    const plusOneTimes = officialSignals
      .filter(({ content, createdMs }) =>
        content === "+1" && createdMs < beforeMs
      )
      .map(({ createdMs }) => createdMs);
    const hasUnsettledEyes = officialSignals.some(({ content, createdMs }) =>
      content === "eyes" &&
      createdMs >= lowerBoundMs &&
      createdMs < beforeMs &&
      !plusOneTimes.some((plusOneMs) => plusOneMs > createdMs)
    );
    if (hasUnsettledEyes) return true;
  }
  return false;
}

function hasV2ProviderActivityInClosedWindow({
  activities,
  startMs,
  endMs,
  ignoredTerminal = null,
}) {
  return (activities ?? []).some((artifact) => {
    const window = v2ProviderActivityWindow(artifact);
    if (!window) return true;
    if (window.revisionMs < startMs || window.carrierCreatedMs > endMs) {
      return false;
    }
    const sameCarrier =
      ignoredTerminal &&
      artifact.source === ignoredTerminal.source &&
      String(artifact.id) === String(ignoredTerminal.id);
    if (
      sameCarrier &&
      window.revisionMs === startMs &&
      window.carrierCreatedMs <= startMs
    ) {
      return false;
    }
    return true;
  });
}

function hasV2DirectReactionClosureBefore({
  request,
  beforeMs,
  requestReactions,
  canonicalReactionIdCounts,
  providerActivities,
}) {
  const reactions = requestReactions?.get(request.id) ?? [];
  return reactions.some((reaction) => {
    const id = canonicalPositiveId(reaction?.id);
    if (
      !id ||
      canonicalReactionIdCounts.get(id) !== 1 ||
      reaction?.content !== "+1" ||
      reaction?.user?.login !== OFFICIAL_CODEX_BOT_LOGIN ||
      reaction?.user?.type !== "Bot" ||
      !isCanonicalUtcTimestamp(reaction.created_at)
    ) {
      return false;
    }
    const plusOneMs = Date.parse(reaction.created_at);
    return plusOneMs > request.revisionMs &&
      plusOneMs < beforeMs &&
      !hasV2AnyOfficialEyesInClosedWindow({
        requestReactions,
        startMs: plusOneMs,
        endMs: beforeMs,
      }) &&
      !hasV2ProviderActivityInClosedWindow({
        activities: providerActivities,
        startMs: plusOneMs,
        endMs: beforeMs,
      });
  });
}

function assertV2ExpectedSnapshotScope(pullRequest, config) {
  const headSha = String(pullRequest?.head?.sha || "").toLowerCase();
  if (headSha !== config.expectedHeadSha) {
    throw new V2HeadChangedFailure(
      `Pull-request head changed from ${config.expectedHeadSha} to ${headSha || "unknown"}`,
    );
  }
  if (!isOpenV2PullRequest(pullRequest)) {
    throw new V2StaleFailure("Pull request closed or merged while loading review evidence");
  }
  if (pullRequest.draft) {
    throw new V2RuntimeFailure("Pull request became draft while loading review evidence", {
      gateOutcome: "not_applicable",
      recoveryCode: "unsupported_target",
    });
  }
  const testMergeSha = String(pullRequest?.merge_commit_sha || "").toLowerCase();
  if (!FULL_SHA.test(testMergeSha) || testMergeSha !== config.testMergeSha) {
    throw new V2StaleFailure(
      `Pull-request test-merge commit changed from ${config.testMergeSha || "unknown"} ` +
        `to ${testMergeSha || "unknown"}`,
    );
  }
}

function assertV2FixedSnapshotScope(repository, pullRequest, config) {
  const expected = config.snapshotScope;
  if (!isPlainRecord(expected)) {
    throw new V2RuntimeFailure("The initial default-branch snapshot scope is unavailable", {
      recoveryCode: "wait_then_reconcile",
    });
  }
  if (
    repository.id !== expected.repositoryId ||
    repository.full_name !== expected.repositoryFullName ||
    repository.default_branch !== expected.defaultBranch ||
    pullRequest.head?.ref !== expected.headRef ||
    pullRequest.head?.repo?.id !== expected.headRepositoryId ||
    pullRequest.head?.repo?.full_name !== expected.headRepositoryFullName ||
    String(pullRequest.base?.sha || "").toLowerCase() !== expected.baseSha ||
    pullRequest.base?.ref !== expected.baseRef ||
    pullRequest.base?.ref !== repository.default_branch ||
    pullRequest.base?.repo?.id !== expected.baseRepositoryId ||
    pullRequest.base?.repo?.full_name !== expected.baseRepositoryFullName ||
    String(pullRequest.merge_commit_sha || "").toLowerCase() !== expected.testMergeSha
  ) {
    throw new V2RuntimeFailure(
      "Pull-request default-branch or base-ref scope changed while loading review evidence",
      { recoveryCode: "wait_then_reconcile" },
    );
  }
}

async function exactRefetchV2RelevantObjects(
  client,
  config,
  budget,
  issueComments,
  reviews,
  authorizedRequests,
  observedIssueCommentEdits = null,
) {
  const authorizedRequestIds = new Set(
    (authorizedRequests ?? []).map((request) =>
      String(request.id ?? request.comment?.id),
    ),
  );
  const commentsById = new Map();
  for (const comment of issueComments) {
    const id = canonicalPositiveId(comment?.id);
    if (!id) continue;
    const providerCandidate = hasAnyV2ProviderIdentitySignal(comment);
    if (
      providerCandidate ||
      authorizedRequestIds.has(id)
    ) {
      commentsById.set(id, comment);
    }
  }
  const comments = [...commentsById.values()];
  const relevantReviews = reviews.filter((review) =>
    hasAnyV2ProviderIdentitySignal(review)
  );
  await mapV2Bounded(comments, V2_REACTION_FETCH_CONCURRENCY, async (comment) => {
    const id = canonicalPositiveId(comment.id);
    const { data } = await client.request(
      "GET",
      `${config.repoPath}/issues/comments/${id}`,
      undefined,
      { budget, safeRead: true },
    );
    budget.consumeObjects(1, `exact issue-comment refetch ${id}`);
    requireV2IssueCommentShape(data, `exact issue-comment refetch ${id}`);
    rememberV2ObservedCarrierFingerprint(
      observedIssueCommentEdits,
      "rest",
      id,
      canonicalJson(fingerprintIssueComment(data)),
    );
    if (canonicalJson(fingerprintIssueComment(data)) !== canonicalJson(fingerprintIssueComment(comment))) {
      throw poisonV2ObservedHistory(
        observedIssueCommentEdits,
        `Issue comment ${id} changed during exact refetch`,
      );
    }
  });
  await mapV2Bounded(relevantReviews, V2_REACTION_FETCH_CONCURRENCY, async (review) => {
    const id = canonicalPositiveId(review.id);
    const { data } = await client.request(
      "GET",
      `${config.repoPath}/pulls/${config.prNumber}/reviews/${id}`,
      undefined,
      { budget, safeRead: true },
    );
    budget.consumeObjects(1, `exact review refetch ${id}`);
    requireV2ReviewShape(data, `exact review refetch ${id}`);
    rememberV2ObservedCarrierFingerprint(
      observedIssueCommentEdits,
      "review-rest",
      id,
      canonicalJson(fingerprintReview(data)),
    );
    if (canonicalJson(fingerprintReview(data)) !== canonicalJson(fingerprintReview(review))) {
      throw poisonV2ObservedHistory(
        observedIssueCommentEdits,
        `Pull-request review ${id} changed during exact refetch`,
      );
    }
  });
}

async function collectAuthorizedV2Requests(client, config, budget, issueComments) {
  const authorized = [];
  const boundaries = [];
  const errors = [];
  const ordinaryCandidates = [];
  const permissionByLogin = new Map();
  for (const comment of issueComments) {
    if (hasExactProviderIdentity(comment)) continue;
    if (isV2ImmutableStickyDiagnostic(comment, config)) continue;
    if (isV2StickyCommentBody(comment?.body)) {
      boundaries.push(v2PhysicalOnlyRequestBoundary(
        comment,
        "invalid-sticky-diagnostic",
      ));
      errors.push({
        message:
          `Sticky-looking comment ${comment.id} lacks immutable canonical Actions provenance`,
        createdAt: v2IssueCommentRevisionAt(comment),
      });
      continue;
    }
    const canonical = parseCanonicalV2ReviewRequestBody(comment?.body);
    if (canonical) {
      if (
        comment.user?.login !== GITHUB_ACTIONS_BOT_LOGIN ||
        comment.user?.type !== "Bot"
      ) {
        boundaries.push(v2PhysicalOnlyRequestBoundary(comment, "canonical-wrong-author"));
        continue;
      }
      if (
        hasV2ObservedIssueCommentEdit(comment) ||
        canonical.repositoryId !== config.repositoryId ||
        canonical.prNumber !== String(config.prNumber)
      ) {
        boundaries.push(v2PhysicalOnlyRequestBoundary(comment, "canonical-invalid-binding"));
        errors.push({
          message: `Workflow-authored review request ${comment.id} has an invalid binding`,
          createdAt: v2IssueCommentRevisionAt(comment),
        });
        continue;
      }
      const request = {
        comment,
        binding: canonical,
        id: String(comment.id),
        revisionMs: Date.parse(v2IssueCommentRevisionAt(comment)),
        headBound: true,
        permission: "workflow",
      };
      authorized.push(request);
      boundaries.push({ ...request, authorized: true });
      continue;
    }
    if (!hasExactV2PhysicalReviewRequestShape(comment?.body)) {
      if (isV2EditedUnknownRequestBoundary(comment)) {
        boundaries.push(v2PhysicalOnlyRequestBoundary(
          comment,
          "edited-unknown-request-history",
        ));
        errors.push({
          message:
            `Edited comment ${comment.id} by a potential review-request author has ` +
            `unobservable prior body history`,
          createdAt: v2IssueCommentRevisionAt(comment),
        });
      }
      continue;
    }
    if (
      comment?.body !== "@codex review" ||
      hasV2ObservedIssueCommentEdit(comment) ||
      comment.user?.type !== "User" ||
      typeof comment.user?.login !== "string" ||
      comment.user.login.trim() === ""
    ) {
      boundaries.push(v2PhysicalOnlyRequestBoundary(
        comment,
        comment?.body === "@codex review" ? "bare-invalid-authority" : "malformed-canonical",
      ));
      continue;
    }
    ordinaryCandidates.push(comment);
  }
  for (const comment of ordinaryCandidates) {
    let permission = "any";
    let isAuthorized = true;
    if (config.requestAuthorPermission === "write") {
      const loginKey = comment.user.login.toLowerCase();
      if (!permissionByLogin.has(loginKey)) {
        let data;
        try {
          ({ data } = await client.request(
            "GET",
            `${config.repoPath}/collaborators/${encodeURIComponent(comment.user.login)}/permission`,
            undefined,
            { budget, safeRead: true },
          ));
        } catch (error) {
          if (error?.httpStatus === 404) {
            permissionByLogin.set(loginKey, null);
          } else {
            throw error;
          }
        }
        if (data !== undefined) {
          budget.consumeObjects(1, `request-author permission ${comment.user.login}`);
          permissionByLogin.set(loginKey, String(data?.permission || ""));
        }
      }
      permission = permissionByLogin.get(loginKey);
      isAuthorized = ["write", "maintain", "admin"].includes(permission);
    }
    const request = {
      comment,
      binding: null,
      id: String(comment.id),
      revisionMs: Date.parse(v2IssueCommentRevisionAt(comment)),
      headBound: false,
      permission,
    };
    boundaries.push({ ...request, authorized: isAuthorized });
    if (isAuthorized) authorized.push(request);
  }
  authorized.sort(compareV2RequestEpochNewestFirst);
  boundaries.sort(compareV2RequestEpochNewestFirst);
  return { authorized, boundaries, errors };
}

function hasExactV2PhysicalReviewRequestShape(body) {
  if (typeof body !== "string") return false;
  const withoutClosedComments = body.replace(/<!--[\s\S]*?-->/gu, "");
  const unclosedComment = withoutClosedComments.indexOf("<!--");
  const visible = unclosedComment === -1
    ? withoutClosedComments
    : withoutClosedComments.slice(0, unclosedComment);
  return /^@codex review(?:\s|$)/u.test(visible.trim());
}

function isV2EditedUnknownRequestBoundary(comment) {
  if (
    !isCanonicalUtcTimestamp(comment?.created_at) ||
    !isCanonicalUtcTimestamp(comment?.updated_at) ||
    !hasV2ObservedIssueCommentEdit(comment) ||
    hasExactV2PhysicalReviewRequestShape(comment?.body) ||
    hasExactProviderIdentity(comment)
  ) {
    return false;
  }
  return (comment.user?.type === "User" || comment.user?.type === "Bot") &&
    typeof comment.user?.login === "string" &&
    comment.user.login.trim() !== "";
}

function isV2CanonicalActionsSticky(comment, config) {
  const binding = parseCanonicalV2StickyCommentBody(comment?.body);
  return binding?.prNumber === config.prNumber &&
    comment?.user?.login === GITHUB_ACTIONS_BOT_LOGIN &&
    comment?.user?.type === "Bot" &&
    isCanonicalUtcTimestamp(comment?.created_at) &&
    isCanonicalUtcTimestamp(comment?.updated_at);
}

function isV2ImmutableStickyDiagnostic(comment, config) {
  return isV2CanonicalActionsSticky(comment, config) &&
    !hasV2ObservedIssueCommentEdit(comment);
}

function hasV2ObservedIssueCommentEdit(comment) {
  return isCanonicalUtcTimestamp(comment?._v2LastEditedAt) ||
    (
      isCanonicalUtcTimestamp(comment?._v2GraphQlUpdatedAt) &&
      isCanonicalUtcTimestamp(comment?.created_at) &&
      Date.parse(comment._v2GraphQlUpdatedAt) > Date.parse(comment.created_at)
    ) ||
    comment?.created_at !== comment?.updated_at;
}

function v2IssueCommentRevisionAt(comment) {
  const revisions = [
    comment?._v2LastEditedAt,
    comment?._v2GraphQlUpdatedAt,
    comment?.updated_at,
  ].filter(isCanonicalUtcTimestamp);
  return revisions.sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}

function v2PhysicalOnlyRequestBoundary(comment, reason) {
  return {
    comment,
    binding: null,
    id: String(comment.id),
    revisionMs: Date.parse(v2IssueCommentRevisionAt(comment)),
    headBound: false,
    permission: "physical-only",
    authorized: false,
    physicalOnlyReason: reason,
  };
}

async function collectV2ProviderEvidence(
  client,
  config,
  budget,
  headSha,
  issueComments,
  reviews,
) {
  const artifacts = [];
  const errors = [];
  for (const comment of issueComments) {
    if (!hasAnyV2ProviderIdentitySignal(comment)) continue;
    const revisionAt = v2IssueCommentRevisionAt(comment);
    if (!hasExactProviderIdentity(comment)) {
      errors.push({
        message:
          `Codex issue comment ${comment.id || "<unknown>"} has invalid Bot/App provenance`,
        createdAt: revisionAt,
        activity: {
          source: "issue-comment",
          id: String(comment.id),
          carrierCreatedAt: comment.created_at,
          revisionAt,
          activityKind: "invalid-provider-provenance",
        },
      });
      continue;
    }
    const observedEdit = hasV2ObservedIssueCommentEdit(comment);
    const providerComment = observedEdit
      ? { ...comment, updated_at: revisionAt }
      : comment;
    const artifact = parseCodexIssueCommentArtifact(providerComment, {
      owner: config.owner,
      repo: config.repo,
      botLogins: EXACT_CODEX_LOGINS,
      allowShortCommitRefs: true,
    });
    if (artifact) {
      if (observedEdit) {
        artifact.edited = true;
        artifact.carrierUpdatedAt = revisionAt;
        artifact.revisionAt = revisionAt;
      }
      artifacts.push(artifact);
    } else if (observedEdit || hasExactV2PhysicalReviewRequestShape(comment?.body)) {
      artifacts.push({
        source: "issue-comment",
        id: String(comment.id),
        kind: "malformed",
        reason: observedEdit
          ? `Edited official Codex comment ${comment.id} has unobservable prior body history`
          : `Official Codex comment ${comment.id} has request-like malformed provider content`,
        createdAt: revisionAt,
        carrierCreatedAt: comment.created_at,
        carrierUpdatedAt: revisionAt,
        revisionAt,
        edited: observedEdit,
      });
    }
  }
  for (const review of reviews) {
    if (!hasAnyV2ProviderIdentitySignal(review)) continue;
    if (!hasExactProviderIdentity(review, { allowMissingApp: true })) {
      const revisionAt = review.submitted_at || review.created_at;
      errors.push({
        message: `Codex review ${review.id || "<unknown>"} has invalid Bot/App provenance`,
        createdAt: revisionAt,
        headSha: FULL_SHA.test(String(review.commit_id || ""))
          ? review.commit_id.toLowerCase()
          : null,
        activity: {
          source: "pull-request-review",
          id: String(review.id),
          carrierCreatedAt: review.created_at || revisionAt,
          revisionAt,
          activityKind: "invalid-provider-provenance",
        },
      });
      continue;
    }
    if (codexInlineParentReviewBodyHasClosedGrammar(review, { allowShortCommitRefs: true })) {
      continue;
    }
    const artifact = parseCodexReviewArtifact(review, {
      owner: config.owner,
      repo: config.repo,
      botLogins: EXACT_CODEX_LOGINS,
      allowShortCommitRefs: true,
    });
    if (artifact) {
      if (
        artifact.kind === "malformed" &&
        FULL_SHA.test(String(review.commit_id || ""))
      ) {
        artifact.headSha = review.commit_id.toLowerCase();
      }
      if (artifact.kind === "clean" && review.state === "APPROVED") {
        artifact.commitRefs = approvedReviewCommitReferences(review.body);
      }
      artifacts.push(artifact);
    }
  }

  const commitResolutions = {};
  const shortRefs = [...new Set(artifacts
    .flatMap((artifact) => artifactCommitReferences(artifact))
    .filter((ref) => typeof ref === "string" && ref.length < 40))]
    .sort();
  for (const ref of shortRefs) {
    try {
      const { data } = await client.request(
        "GET",
        `${config.repoPath}/commits/${encodeURIComponent(ref)}`,
        undefined,
        { budget, safeRead: true },
      );
      budget.consumeObjects(1, `reviewed commit resolution ${ref}`);
      const resolvedSha = String(data?.sha || "");
      if (!FULL_SHA.test(resolvedSha)) {
        throw new V2RuntimeFailure(`GitHub returned an invalid commit resolution for ${ref}`);
      }
      if (!resolvedSha.startsWith(ref)) {
        commitResolutions[ref] = {
          error: `Reviewed commit ${ref} is unresolved or ambiguous`,
        };
        continue;
      }
      commitResolutions[ref] = { sha: resolvedSha };
    } catch (error) {
      if (error?.httpStatus === 404 || error?.httpStatus === 422) {
        commitResolutions[ref] = { error: `Reviewed commit ${ref} is unresolved or ambiguous` };
      } else {
        throw error;
      }
    }
  }
  for (const artifact of artifacts) {
    const commitRefs = artifactCommitReferences(artifact);
    if (commitRefs.length > 0) {
      const resolved = [];
      for (const ref of commitRefs) {
        if (ref.length === 40) {
          resolved.push(ref);
        } else if (commitResolutions[ref]?.sha) {
          resolved.push(commitResolutions[ref].sha);
        } else {
          artifact.resolutionError = commitResolutions[ref]?.error ||
            `Reviewed commit ${ref} could not be resolved`;
          break;
        }
      }
      const uniqueResolved = [...new Set(resolved)];
      if (!artifact.resolutionError && uniqueResolved.length === 1) {
        artifact.resolvedHeadSha = uniqueResolved[0];
      } else if (!artifact.resolutionError) {
        artifact.resolutionError =
          `Codex artifact ${artifact.source}:${artifact.id} has conflicting commit references`;
      }
    } else if (FULL_SHA.test(String(artifact.headSha || ""))) {
      artifact.resolvedHeadSha = artifact.headSha.toLowerCase();
    }
    if (
      artifact.source === "pull-request-review" &&
      FULL_SHA.test(String(artifact.resolvedHeadSha || "")) &&
      artifact.resolvedHeadSha !== String(artifact.nativeCommitId || artifact.headSha || "").toLowerCase()
    ) {
      artifact.resolutionError =
        `Pull-request review ${artifact.id} commit binding conflicts with native commit_id`;
      delete artifact.resolvedHeadSha;
    }
  }
  return { artifacts, errors, commitResolutions };
}

function approvedReviewCommitReferences(body) {
  return [...new Set(
    [...String(body || "").matchAll(/`([0-9a-f]{7,40})`/giu)]
      .map((match) => match[1].toLowerCase()),
  )].sort();
}

function artifactCommitReferences(artifact) {
  if (Array.isArray(artifact?.commitRefs)) return artifact.commitRefs;
  return typeof artifact?.commitRef === "string" ? [artifact.commitRef] : [];
}

async function loadV2CommentHistory(
  client,
  config,
  budget,
  observedDeletedCommentEvents = null,
  observedIssueCommentEdits = null,
) {
  assertV2ObservedHistoryNotPoisoned(observedDeletedCommentEvents);
  assertV2ObservedHistoryNotPoisoned(observedIssueCommentEdits);
  const events = [];
  const eventIds = new Set();
  const rawEventIds = new Map();
  const edits = [];
  const editIds = new Set();
  const rawEditIds = new Map();
  const editFingerprints = new Map();
  const deletedCursors = new Set();
  const commentCursors = new Set();
  let cursor = null;
  let commentCursor = null;
  let includeDeleted = true;
  let includeComments = true;
  let expectedTimelineCount = null;
  let expectedDeletedCount = null;
  let expectedCommentCount = null;
  while (includeDeleted || includeComments) {
    const { data } = await client.request(
      "POST",
      "/graphql",
      {
        query: V2_DELETED_COMMENTS_QUERY,
        variables: {
          owner: config.owner,
          repo: config.repo,
          number: config.prNumber,
          cursor,
          commentCursor,
          includeDeleted,
          includeComments,
        },
      },
      { budget, safeRead: true },
    );
    budget.consumePage("pull-request comment history");
    const partialPullRequest = data?.data?.repository?.pullRequest;
    const latchedPage = latchV2VisibleCommentHistoryNodes({
      pullRequest: partialPullRequest,
      includeDeleted,
      includeComments,
      observedDeletedCommentEvents,
      observedIssueCommentEdits,
      deletedEventsSeen: events.length,
      rawEventIds,
      rawEditIds,
    });
    const fingerprintError = rememberV2PageIssueCommentFingerprints(
      latchedPage.pageEdits,
      editFingerprints,
      observedIssueCommentEdits,
    );
    latchedPage.error ??= fingerprintError;
    if (
      !isPlainRecord(data) ||
      (data.errors !== undefined &&
        (!Array.isArray(data.errors) || data.errors.length > 0)) ||
      !isPlainRecord(data.data) ||
      !isPlainRecord(data.data.repository) ||
      data.data.repository.nameWithOwner !== config.repository ||
      !isPlainRecord(data.data.repository.pullRequest) ||
      data.data.repository.pullRequest.number !== config.prNumber
    ) {
      const message =
        "GitHub GraphQL comment-history response was incomplete or inconsistent";
      if (latchedPage.error) throw latchedPage.error;
      throw new V2RuntimeFailure(message, {
        recoveryCode: "wait_then_reconcile",
      });
    }
    if (latchedPage.error) throw latchedPage.error;
    const pullRequest = data.data.repository.pullRequest;
    const { pageEvents, pageEdits } = latchedPage;
    let pageObjects = 2;
    if (includeDeleted) {
      const connection = pullRequest.timelineItems;
      const pageInfo = connection?.pageInfo;
      const expectedRemainingDeleted = expectedDeletedCount === null
        ? connection?.filteredCount
        : expectedDeletedCount - events.length;
      if (
        !isPlainRecord(connection) ||
        !isNonNegativeSafeInteger(connection.totalCount) ||
        !isNonNegativeSafeInteger(connection.filteredCount) ||
        !isNonNegativeSafeInteger(connection.pageCount) ||
        !Array.isArray(connection.nodes) ||
        connection.nodes.length > V2_DELETED_COMMENTS_PAGE_SIZE ||
        connection.pageCount !== connection.nodes.length ||
        connection.totalCount < events.length + connection.filteredCount ||
        connection.filteredCount !== expectedRemainingDeleted ||
        connection.nodes.length > connection.filteredCount ||
        !isValidV2GraphQlPageInfo(pageInfo, connection.nodes.length) ||
        pageInfo.hasNextPage !==
          (connection.nodes.length < connection.filteredCount)
      ) {
        throw new V2RuntimeFailure(
          "GitHub GraphQL deleted-comment connection was incomplete or inconsistent",
          { recoveryCode: "wait_then_reconcile" },
        );
      }
      if (expectedDeletedCount === null) {
        expectedTimelineCount = connection.totalCount;
        expectedDeletedCount = connection.filteredCount;
      } else if (connection.totalCount !== expectedTimelineCount) {
        throw new V2RuntimeFailure(
          "GitHub GraphQL timeline total count changed during deleted-comment pagination",
          { recoveryCode: "wait_then_reconcile" },
        );
      }
      pageObjects += connection.nodes.length;
      for (const event of pageEvents) {
        if (eventIds.has(event.id)) {
          throw poisonV2ObservedHistory(
            observedDeletedCommentEvents,
            `GitHub GraphQL deleted-comment event ${event.id} appeared more than once`,
          );
        }
        eventIds.add(event.id);
        events.push(event);
      }
      if (pageInfo.hasNextPage) {
        if (deletedCursors.has(pageInfo.endCursor)) {
          throw new V2RuntimeFailure(
            "GitHub GraphQL deleted-comment pagination repeated a cursor",
            { recoveryCode: "wait_then_reconcile" },
          );
        }
        deletedCursors.add(pageInfo.endCursor);
        cursor = pageInfo.endCursor;
      } else {
        if (events.length !== expectedDeletedCount) {
          throw new V2RuntimeFailure(
            `GitHub GraphQL deleted-comment inventory was incomplete: ` +
              `${events.length} of ${expectedDeletedCount}`,
            { recoveryCode: "wait_then_reconcile" },
          );
        }
        includeDeleted = false;
      }
    }
    if (includeComments) {
      const connection = pullRequest.comments;
      const pageInfo = connection?.pageInfo;
      if (
        !isPlainRecord(connection) ||
        !isNonNegativeSafeInteger(connection.totalCount) ||
        !Array.isArray(connection.nodes) ||
        connection.nodes.length > V2_DELETED_COMMENTS_PAGE_SIZE ||
        connection.nodes.length > connection.totalCount - edits.length ||
        !isValidV2GraphQlPageInfo(pageInfo, connection.nodes.length) ||
        pageInfo.hasNextPage !==
          (connection.nodes.length < connection.totalCount - edits.length)
      ) {
        throw new V2RuntimeFailure(
          "GitHub GraphQL issue-comment edit connection was incomplete or inconsistent",
          { recoveryCode: "wait_then_reconcile" },
        );
      }
      if (expectedCommentCount === null) {
        expectedCommentCount = connection.totalCount;
      } else if (connection.totalCount !== expectedCommentCount) {
        throw new V2RuntimeFailure(
          "GitHub GraphQL issue-comment total count changed during pagination",
          { recoveryCode: "wait_then_reconcile" },
        );
      }
      pageObjects += connection.nodes.length;
      for (const edit of pageEdits) {
        const fingerprint = canonicalJson(edit);
        if (editIds.has(edit.id)) {
          throw poisonV2ObservedHistory(
            observedIssueCommentEdits,
            `GitHub GraphQL issue-comment ${edit.id} appeared more than once`,
          );
        }
        editIds.add(edit.id);
        editFingerprints.set(edit.id, fingerprint);
        edits.push(edit);
      }
      if (pageInfo.hasNextPage) {
        if (commentCursors.has(pageInfo.endCursor)) {
          throw new V2RuntimeFailure(
            "GitHub GraphQL issue-comment pagination repeated a cursor",
            { recoveryCode: "wait_then_reconcile" },
          );
        }
        commentCursors.add(pageInfo.endCursor);
        commentCursor = pageInfo.endCursor;
      } else {
        if (edits.length !== expectedCommentCount) {
          throw new V2RuntimeFailure(
            `GitHub GraphQL issue-comment inventory was incomplete: ` +
              `${edits.length} of ${expectedCommentCount}`,
            { recoveryCode: "wait_then_reconcile" },
          );
        }
        includeComments = false;
      }
    }
    budget.consumeObjects(pageObjects, "pull-request comment history");
  }
  retainV2ObservedHistoryRawIdentities(
    observedDeletedCommentEvents,
    events.map((event) => event.id),
    "deleted-comment event",
  );
  retainV2ObservedHistoryRawIdentities(
    observedIssueCommentEdits,
    edits.map((edit) => edit.id),
    "issue-comment",
  );
  retainV2ObservedCarrierFingerprints(
    observedIssueCommentEdits,
    "graphql",
    edits.map((edit) => [edit.id, canonicalJson(edit)]),
  );
  return {
    deletedCommentEvents: events.sort((left, right) =>
      Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
      compareV2OpaqueStringsAscending(left.id, right.id)
    ),
    issueCommentEdits: edits.sort((left, right) =>
      BigInt(left.id) < BigInt(right.id) ? -1 : BigInt(left.id) > BigInt(right.id) ? 1 : 0
    ),
  };
}

function latchV2VisibleCommentHistoryNodes({
  pullRequest,
  includeDeleted,
  includeComments,
  observedDeletedCommentEvents,
  observedIssueCommentEdits,
  deletedEventsSeen,
  rawEventIds,
  rawEditIds,
}) {
  let pageEvents = [];
  let pageEdits = [];
  let error = null;
  if (includeDeleted) {
    try {
      const remaining = pullRequest?.timelineItems?.filteredCount;
      rememberV2ObservedHistoryCount(
        observedDeletedCommentEvents,
        isNonNegativeSafeInteger(remaining) &&
            isNonNegativeSafeInteger(deletedEventsSeen)
          ? deletedEventsSeen + remaining
          : null,
        "deleted-comment inventory",
        "lower bound",
      );
    } catch (caught) {
      error ??= caught;
    }
    try {
      const normalizedPage = normalizeAndRememberV2HistoryNodes(
        Array.isArray(pullRequest?.timelineItems?.nodes)
          ? pullRequest.timelineItems.nodes
          : [],
        normalizeV2DeletedCommentEvent,
        rememberV2ObservedDeletedCommentEvent,
        observedDeletedCommentEvents,
        (node) =>
          typeof node?.id === "string" && node.id.trim() !== ""
            ? node.id
            : null,
        rawEventIds,
        "deleted-comment event",
        v2DeletedCommentPartialFacts,
        true,
      );
      pageEvents = normalizedPage.normalized;
      error ??= normalizedPage.error;
    } catch (caught) {
      error ??= caught;
    }
  }
  if (includeComments) {
    try {
      rememberV2ObservedHistoryCount(
        observedIssueCommentEdits,
        pullRequest?.comments?.totalCount,
        "issue-comment",
      );
    } catch (caught) {
      error ??= caught;
    }
    try {
      const normalizedPage = normalizeAndRememberV2HistoryNodes(
        Array.isArray(pullRequest?.comments?.nodes)
          ? pullRequest.comments.nodes
          : [],
        normalizeV2IssueCommentEdit,
        rememberV2ObservedIssueCommentEdit,
        observedIssueCommentEdits,
        (node) => canonicalPositiveId(node?.databaseId),
        rawEditIds,
        "issue-comment",
        v2IssueCommentPartialFacts,
        false,
      );
      pageEdits = normalizedPage.normalized;
      error ??= normalizedPage.error;
    } catch (caught) {
      error ??= caught;
    }
  }
  return { pageEvents, pageEdits, error };
}

function rememberV2PageIssueCommentFingerprints(edits, fingerprints, observed) {
  let error = null;
  for (const edit of edits ?? []) {
    const fingerprint = canonicalJson(edit);
    const previous = fingerprints.get(edit.id);
    if (previous !== undefined) {
      error ??= poisonV2ObservedHistory(
        observed,
        previous === fingerprint
          ? `GitHub GraphQL issue-comment ${edit.id} appeared more than once`
          : `GitHub GraphQL issue-comment ${edit.id} changed across paginated inventory`,
      );
      continue;
    }
    fingerprints.set(edit.id, fingerprint);
    try {
      rememberV2ObservedCarrierFingerprint(
        observed,
        "graphql",
        edit.id,
        fingerprint,
      );
    } catch (caught) {
      error ??= caught;
    }
  }
  return error;
}

function rememberV2ObservedCarrierFingerprint(
  observed,
  source,
  id,
  fingerprint,
) {
  if (!(observed instanceof Map)) return;
  assertV2ObservedHistoryNotPoisoned(observed);
  let fingerprints = observed.get(V2_OBSERVED_CARRIER_FINGERPRINTS);
  if (!(fingerprints instanceof Map)) {
    fingerprints = new Map();
    observed.set(V2_OBSERVED_CARRIER_FINGERPRINTS, fingerprints);
  }
  const key = `${source}:${id}`;
  const previous = fingerprints.get(key);
  if (previous !== undefined && previous !== fingerprint) {
    throw poisonV2ObservedHistory(
      observed,
      `Previously observed ${source} issue-comment ${id} changed`,
    );
  }
  fingerprints.set(key, fingerprint);
}

function retainV2ObservedCarrierFingerprints(observed, source, entries) {
  if (!(observed instanceof Map)) return;
  assertV2ObservedHistoryNotPoisoned(observed);
  const current = new Map(entries ?? []);
  let fingerprints = observed.get(V2_OBSERVED_CARRIER_FINGERPRINTS);
  if (!(fingerprints instanceof Map)) {
    fingerprints = new Map();
    observed.set(V2_OBSERVED_CARRIER_FINGERPRINTS, fingerprints);
  }
  const prefix = `${source}:`;
  for (const [key, previous] of fingerprints) {
    if (!key.startsWith(prefix)) continue;
    const id = key.slice(prefix.length);
    if (!current.has(id)) {
      throw poisonV2ObservedHistory(
        observed,
        `Previously observed ${source} issue-comment ${id} disappeared`,
      );
    }
    if (current.get(id) !== previous) {
      throw poisonV2ObservedHistory(
        observed,
        `Previously observed ${source} issue-comment ${id} changed`,
      );
    }
  }
  for (const [id, fingerprint] of current) {
    rememberV2ObservedCarrierFingerprint(
      observed,
      source,
      id,
      fingerprint,
    );
  }
}

function rememberV2ObservedHistoryCount(
  observed,
  count,
  label,
  countField = "totalCount",
) {
  if (!(observed instanceof Map) || !isNonNegativeSafeInteger(count)) return;
  assertV2ObservedHistoryNotPoisoned(observed);
  const previous = observed.get(V2_OBSERVED_HISTORY_COUNT_FLOOR);
  if (isNonNegativeSafeInteger(previous) && count < previous) {
    throw poisonV2ObservedHistory(
      observed,
      `Previously observed ${label} ${countField} decreased from ${previous} to ${count}`,
    );
  }
  observed.set(
    V2_OBSERVED_HISTORY_COUNT_FLOOR,
    isNonNegativeSafeInteger(previous) ? Math.max(previous, count) : count,
  );
}

function normalizeAndRememberV2HistoryNodes(
  nodes,
  normalize,
  remember,
  observed,
  rawIdentity,
  rawIdentitiesSeen,
  identityLabel,
  partialFacts,
  poisonValidDuplicates,
) {
  const normalized = [];
  let firstError = null;
  for (const node of nodes) {
    const identity = rawIdentity?.(node) ?? null;
    const previousIdentityState = identity === null
      ? undefined
      : rawIdentitiesSeen?.get(identity);
    let value;
    try {
      value = normalize(node);
      normalized.push(value);
    } catch (error) {
      const message = error?.message || String(error);
      if (identity !== null) {
        rememberV2ObservedHistoryRawIdentity(observed, identity);
        rawIdentitiesSeen?.set(identity, "malformed");
        if (previousIdentityState !== undefined) {
          const duplicateError = poisonV2ObservedHistory(
            observed,
            `GitHub GraphQL ${identityLabel} ${identity} appeared more than once`,
          );
          firstError ??= duplicateError;
        } else {
          try {
            rememberV2ObservedHistoryPartialFacts(
              observed,
              identity,
              partialFacts?.(node),
              identityLabel,
            );
          } catch (caught) {
            firstError ??= caught;
          }
        }
      }
      firstError ??= new V2RuntimeFailure(message, {
        recoveryCode: "wait_then_reconcile",
      });
      continue;
    }
    if (identity !== null) {
      rawIdentitiesSeen?.set(identity, "valid");
      if (
        previousIdentityState !== undefined &&
        (poisonValidDuplicates || previousIdentityState === "malformed")
      ) {
        const duplicateError = poisonV2ObservedHistory(
          observed,
          `GitHub GraphQL ${identityLabel} ${identity} appeared more than once`,
        );
        firstError ??= duplicateError;
      } else if (previousIdentityState === undefined) {
        try {
          rememberV2ObservedHistoryPartialFacts(
            observed,
            identity,
            partialFacts?.(node),
            identityLabel,
          );
        } catch (caught) {
          firstError ??= caught;
        }
      }
    }
    try {
      remember(value, observed);
    } catch (error) {
      firstError ??= error;
    }
  }
  return { normalized, error: firstError };
}

function rememberV2ObservedHistoryRawIdentity(observed, identity) {
  if (!(observed instanceof Map)) return;
  let identities = observed.get(V2_OBSERVED_HISTORY_RAW_IDENTITIES);
  if (!(identities instanceof Set)) {
    identities = new Set();
    observed.set(V2_OBSERVED_HISTORY_RAW_IDENTITIES, identities);
  }
  identities.add(identity);
}

function rememberV2ObservedHistoryPartialFacts(
  observed,
  identity,
  facts,
  identityLabel,
) {
  if (!(observed instanceof Map) || !isPlainRecord(facts)) return;
  assertV2ObservedHistoryNotPoisoned(observed);
  let identities = observed.get(V2_OBSERVED_HISTORY_PARTIAL_FACTS);
  if (!(identities instanceof Map)) {
    identities = new Map();
    observed.set(V2_OBSERVED_HISTORY_PARTIAL_FACTS, identities);
  }
  let remembered = identities.get(identity);
  if (!(remembered instanceof Map)) {
    remembered = new Map();
    identities.set(identity, remembered);
  }
  for (const [field, value] of Object.entries(facts)) {
    const fingerprint = canonicalJson(value);
    const previous = remembered.get(field);
    if (previous !== undefined && previous !== fingerprint) {
      throw poisonV2ObservedHistory(
        observed,
        `Previously observed ${identityLabel} ${identity} ${field} changed`,
      );
    }
    remembered.set(field, fingerprint);
  }
}

function v2IssueCommentPartialFacts(value) {
  if (!isPlainRecord(value)) return {};
  const facts = {};
  if (typeof value.body === "string") facts.body = value.body;
  if (isCanonicalUtcTimestamp(value.createdAt)) facts.createdAt = value.createdAt;
  if (isCanonicalUtcTimestamp(value.updatedAt)) facts.updatedAt = value.updatedAt;
  if (
    Object.prototype.hasOwnProperty.call(value, "lastEditedAt") &&
    (value.lastEditedAt === null || isCanonicalUtcTimestamp(value.lastEditedAt))
  ) {
    facts.lastEditedAt = value.lastEditedAt;
  }
  return facts;
}

function v2DeletedCommentPartialFacts(value) {
  if (!isPlainRecord(value)) return {};
  const facts = {};
  if (typeof value.__typename === "string" && value.__typename.trim() !== "") {
    facts.typename = value.__typename;
  }
  if (isCanonicalUtcTimestamp(value.createdAt)) facts.createdAt = value.createdAt;
  for (const field of ["actor", "deletedCommentAuthor"]) {
    const actor = v2DeletedCommentActorPartialFact(value[field]);
    if (actor !== undefined) facts[field] = actor;
  }
  return facts;
}

function v2DeletedCommentActorPartialFact(actor) {
  if (actor === null) return null;
  if (
    !isPlainRecord(actor) ||
    typeof actor.__typename !== "string" ||
    actor.__typename.trim() === "" ||
    typeof actor.login !== "string" ||
    actor.login.trim() === ""
  ) {
    return undefined;
  }
  return { typename: actor.__typename, login: actor.login };
}

function retainV2ObservedHistoryRawIdentities(
  observed,
  currentIdentities,
  identityLabel,
) {
  if (!(observed instanceof Map)) return;
  assertV2ObservedHistoryNotPoisoned(observed);
  const identities = observed.get(V2_OBSERVED_HISTORY_RAW_IDENTITIES);
  if (!(identities instanceof Set)) return;
  const current = new Set(currentIdentities ?? []);
  for (const identity of identities) {
    if (!current.has(identity)) {
      throw poisonV2ObservedHistory(
        observed,
        `Previously observed ${identityLabel} raw identity ${identity} disappeared`,
      );
    }
  }
}

function isValidV2GraphQlPageInfo(pageInfo, nodeCount) {
  return isPlainRecord(pageInfo) &&
    typeof pageInfo.hasNextPage === "boolean" &&
    (
      pageInfo.endCursor === null ||
      (typeof pageInfo.endCursor === "string" && pageInfo.endCursor.trim() !== "")
    ) &&
    !(pageInfo.hasNextPage && nodeCount === 0) &&
    !(pageInfo.hasNextPage && pageInfo.endCursor === null);
}

function retainV2ObservedDeletedCommentEvents(events, observedEvents) {
  if (!(observedEvents instanceof Map)) return;
  assertV2ObservedHistoryNotPoisoned(observedEvents);
  const current = new Map((events ?? []).map((event) => [
    event.id,
    canonicalJson(event),
  ]));
  for (const [id, fingerprint] of observedEvents) {
    if (typeof id === "symbol") continue;
    if (!current.has(id)) {
      throw new V2RuntimeFailure(
        `Previously observed deleted-comment event ${id} disappeared from later inventory`,
        { recoveryCode: "wait_then_reconcile" },
      );
    }
    if (current.get(id) !== fingerprint) {
      throw poisonV2ObservedHistory(
        observedEvents,
        `Previously observed deleted-comment event ${id} changed in later inventory`,
      );
    }
  }
  for (const [id, fingerprint] of current) {
    observedEvents.set(id, fingerprint);
  }
}

function rememberV2ObservedDeletedCommentEvent(event, observedEvents) {
  if (!(observedEvents instanceof Map)) return;
  assertV2ObservedHistoryNotPoisoned(observedEvents);
  const fingerprint = canonicalJson(event);
  const previous = observedEvents.get(event.id);
  if (previous !== undefined && previous !== fingerprint) {
    throw poisonV2ObservedHistory(
      observedEvents,
      `Previously observed deleted-comment event ${event.id} changed in later inventory`,
    );
  }
  observedEvents.set(event.id, fingerprint);
}

function retainV2ObservedIssueCommentEdits(edits, observedEdits) {
  if (!(observedEdits instanceof Map)) return;
  assertV2ObservedHistoryNotPoisoned(observedEdits);
  const current = new Map((edits ?? []).map((edit) => [edit.id, edit]));
  for (const [id] of observedEdits) {
    if (typeof id === "symbol") continue;
    const edit = current.get(id);
    if (!edit || v2IssueCommentEditProof(edit) === null) {
      throw new V2RuntimeFailure(
        `Previously observed edit metadata for issue comment ${id} disappeared`,
        { recoveryCode: "wait_then_reconcile" },
      );
    }
    rememberV2ObservedIssueCommentEdit(edit, observedEdits);
  }
  for (const edit of edits ?? []) {
    rememberV2ObservedIssueCommentEdit(edit, observedEdits);
  }
}

function rememberV2ObservedIssueCommentEdit(edit, observedEdits) {
  if (!(observedEdits instanceof Map)) return;
  assertV2ObservedHistoryNotPoisoned(observedEdits);
  const proof = v2IssueCommentEditProof(edit);
  const previous = observedEdits.get(edit.id);
  if (previous === undefined) {
    if (proof !== null) observedEdits.set(edit.id, proof);
    return;
  }
  if (
    proof === null ||
    proof.createdAt !== previous.createdAt ||
    Date.parse(proof.updatedAt) < Date.parse(previous.updatedAt) ||
    (
      previous.lastEditedAt !== null &&
      (
        proof.lastEditedAt === null ||
        Date.parse(proof.lastEditedAt) < Date.parse(previous.lastEditedAt)
      )
    )
  ) {
    throw poisonV2ObservedHistory(
      observedEdits,
      `Previously observed edit metadata for issue comment ${edit.id} moved backwards`,
    );
  }
  observedEdits.set(edit.id, proof);
}

function v2IssueCommentEditProof(edit) {
  const editedAt = isCanonicalUtcTimestamp(edit?.lastEditedAt)
    ? edit.lastEditedAt
    : null;
  if (
    !isCanonicalUtcTimestamp(edit?.createdAt) ||
    !isCanonicalUtcTimestamp(edit?.updatedAt) ||
    (editedAt === null && Date.parse(edit.updatedAt) <= Date.parse(edit.createdAt))
  ) {
    return null;
  }
  return {
    createdAt: edit.createdAt,
    updatedAt: edit.updatedAt,
    lastEditedAt: editedAt,
  };
}

function assertV2ObservedHistoryNotPoisoned(observed) {
  if (!(observed instanceof Map)) return;
  const message = observed.get(V2_OBSERVED_HISTORY_POISON);
  if (typeof message === "string") {
    throw new V2RuntimeFailure(message, { recoveryCode: "wait_then_reconcile" });
  }
}

function poisonV2ObservedHistory(observed, message) {
  if (observed instanceof Map) {
    observed.set(
      V2_OBSERVED_HISTORY_POISON,
      observed.get(V2_OBSERVED_HISTORY_POISON) || message,
    );
  }
  return new V2RuntimeFailure(message, { recoveryCode: "wait_then_reconcile" });
}

function normalizeV2DeletedCommentEvent(value) {
  if (
    !isPlainRecord(value) ||
    value.__typename !== "CommentDeletedEvent" ||
    typeof value.id !== "string" ||
    value.id.trim() === "" ||
    !isCanonicalUtcTimestamp(value.createdAt)
  ) {
    throw new V2RuntimeFailure(
      "GitHub GraphQL deleted-comment event was incomplete or inconsistent",
      { recoveryCode: "wait_then_reconcile" },
    );
  }
  return {
    typename: value.__typename,
    id: value.id,
    createdAt: value.createdAt,
    actor: normalizeV2DeletedCommentActor(value.actor, "actor"),
    deletedCommentAuthor: normalizeV2DeletedCommentActor(
      value.deletedCommentAuthor,
      "deleted comment author",
    ),
  };
}

function normalizeV2IssueCommentEdit(value) {
  const id = canonicalPositiveId(value?.databaseId);
  if (
    !isPlainRecord(value) ||
    !id ||
    typeof value.body !== "string" ||
    !isCanonicalUtcTimestamp(value.createdAt) ||
    !isCanonicalUtcTimestamp(value.updatedAt) ||
    !(
      value.lastEditedAt === null ||
      isCanonicalUtcTimestamp(value.lastEditedAt)
    ) ||
    Date.parse(value.updatedAt) < Date.parse(value.createdAt) ||
    (
      value.lastEditedAt !== null &&
      (
        Date.parse(value.lastEditedAt) < Date.parse(value.createdAt) ||
        Date.parse(value.lastEditedAt) > Date.parse(value.updatedAt)
      )
    )
  ) {
    throw new V2RuntimeFailure(
      "GitHub GraphQL issue-comment edit metadata was incomplete or inconsistent",
      { recoveryCode: "wait_then_reconcile" },
    );
  }
  return {
    id,
    body: value.body,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    lastEditedAt: value.lastEditedAt,
  };
}

function attachV2IssueCommentEditMetadata(
  issueComments,
  edits,
  observedIssueCommentEdits = null,
) {
  if (!Array.isArray(issueComments) || !Array.isArray(edits) ||
      issueComments.length !== edits.length) {
    throw poisonV2ObservedHistory(
      observedIssueCommentEdits,
      "REST and GraphQL issue-comment inventories have different counts",
    );
  }
  const editsById = new Map(edits.map((edit) => [edit.id, edit]));
  if (editsById.size !== edits.length) {
    throw poisonV2ObservedHistory(
      observedIssueCommentEdits,
      "GitHub GraphQL issue-comment inventory contained duplicate ids",
    );
  }
  const commentIds = new Set();
  for (const comment of issueComments) {
    const id = canonicalPositiveId(comment?.id);
    if (!id || commentIds.has(id)) {
      throw poisonV2ObservedHistory(
        observedIssueCommentEdits,
        `REST issue-comment inventory contained duplicate or invalid id ${id || "unknown"}`,
      );
    }
    commentIds.add(id);
    if (id) {
      rememberV2ObservedCarrierFingerprint(
        observedIssueCommentEdits,
        "rest",
        id,
        canonicalJson(fingerprintIssueComment(comment)),
      );
    }
    const edit = id ? editsById.get(id) : null;
    if (
      !edit ||
      edit.body !== comment.body ||
      Math.floor(Date.parse(edit.createdAt) / 1_000) !==
        Math.floor(Date.parse(comment.created_at) / 1_000) ||
      Math.floor(Date.parse(edit.updatedAt) / 1_000) !==
        Math.floor(Date.parse(comment.updated_at) / 1_000)
    ) {
      throw poisonV2ObservedHistory(
        observedIssueCommentEdits,
        `REST and GraphQL issue-comment metadata did not match for ${id || "unknown"}`,
      );
    }
    comment._v2LastEditedAt = edit.lastEditedAt;
    comment._v2GraphQlUpdatedAt = edit.updatedAt;
  }
  if (commentIds.size !== editsById.size) {
    throw poisonV2ObservedHistory(
      observedIssueCommentEdits,
      "REST and GraphQL issue-comment inventories have different id sets",
    );
  }
}

function normalizeV2DeletedCommentActor(actor, label) {
  if (actor === null) return null;
  if (
    !isPlainRecord(actor) ||
    typeof actor.__typename !== "string" ||
    actor.__typename.trim() === "" ||
    typeof actor.login !== "string" ||
    actor.login.trim() === ""
  ) {
    throw new V2RuntimeFailure(
      `GitHub GraphQL deleted-comment ${label} was incomplete or inconsistent`,
      { recoveryCode: "wait_then_reconcile" },
    );
  }
  return { typename: actor.__typename, login: actor.login };
}

function v2DeletedCommentBoundary(event) {
  return {
    comment: null,
    binding: null,
    id: `deleted:${event.id}`,
    revisionMs: Date.parse(event.createdAt),
    revisionAt: event.createdAt,
    headBound: false,
    permission: "physical-only",
    authorized: false,
    physicalOnlyReason: "deleted-comment-unknown-history",
  };
}

async function loadLatestV2BaseEpoch(
  client,
  config,
  budget,
  observedBaseEpoch = null,
) {
  assertV2ObservedHistoryNotPoisoned(observedBaseEpoch);
  const { data } = await client.request(
    "POST",
    "/graphql",
    {
      query: V2_BASE_EPOCH_QUERY,
      variables: {
        owner: config.owner,
        repo: config.repo,
        number: config.prNumber,
      },
    },
    { budget, safeRead: true },
  );
  budget.consumePage("latest pull-request base epoch");
  const partialConnection = data?.data?.repository?.pullRequest?.timelineItems;
  const latched = latchV2VisibleBaseEpoch(
    partialConnection,
    observedBaseEpoch,
  );
  if (
    !isPlainRecord(data) ||
    (data.errors !== undefined &&
      (!Array.isArray(data.errors) || data.errors.length > 0)) ||
    !isPlainRecord(data.data) ||
    !isPlainRecord(data.data.repository) ||
    data.data.repository.nameWithOwner !== config.repository ||
    !isPlainRecord(data.data.repository.pullRequest) ||
    data.data.repository.pullRequest.number !== config.prNumber
  ) {
    if (latched.error) throw latched.error;
    throw new V2RuntimeFailure(
      "GitHub GraphQL base-epoch response was incomplete or inconsistent",
    );
  }
  const connection = data.data.repository.pullRequest.timelineItems;
  if (
    !isPlainRecord(connection) ||
    !isNonNegativeSafeInteger(connection.filteredCount) ||
    !isNonNegativeSafeInteger(connection.pageCount) ||
    !Array.isArray(connection.nodes) ||
    connection.nodes.length > 1 ||
    connection.pageCount !== connection.nodes.length ||
    (connection.filteredCount === 0) !== (connection.nodes.length === 0)
  ) {
    if (latched.error) throw latched.error;
    throw new V2RuntimeFailure(
      "GitHub GraphQL base-epoch connection was incomplete or inconsistent",
    );
  }
  if (latched.error) throw latched.error;
  budget.consumeObjects(2 + connection.nodes.length, "latest pull-request base epoch");
  const event = latched.event;
  return {
    filteredCount: connection.filteredCount,
    event,
  };
}

function latchV2VisibleBaseEpoch(connection, observedBaseEpoch) {
  const filteredCount = isNonNegativeSafeInteger(connection?.filteredCount)
    ? connection.filteredCount
    : null;
  let event;
  let eventAvailable = false;
  let error = null;
  if (Array.isArray(connection?.nodes)) {
    if (connection.nodes.length === 0 && filteredCount === 0) {
      event = null;
      eventAvailable = true;
    } else if (connection.nodes.length === 1) {
      try {
        event = normalizeV2BaseEpochEvent(connection.nodes[0]);
        eventAvailable = true;
      } catch (caught) {
        error = caught;
      }
    }
  }
  try {
    const observationError = rememberV2ObservedBaseEpoch(
      observedBaseEpoch,
      filteredCount,
      eventAvailable ? event : undefined,
    );
    error ??= observationError;
  } catch (caught) {
    error ??= caught;
  }
  return { event, eventAvailable, error };
}

function rememberV2ObservedBaseEpoch(observed, filteredCount, event) {
  if (!(observed instanceof Map)) return null;
  assertV2ObservedHistoryNotPoisoned(observed);
  let error = null;
  if (isNonNegativeSafeInteger(filteredCount)) {
    const previousCount = observed.get(V2_OBSERVED_BASE_EPOCH_COUNT_FLOOR);
    if (
      isNonNegativeSafeInteger(previousCount) &&
      filteredCount < previousCount
    ) {
      error = new V2RuntimeFailure(
        `Previously observed base-epoch filteredCount decreased from ` +
          `${previousCount} to ${filteredCount}`,
        { recoveryCode: "wait_then_reconcile" },
      );
    } else {
      observed.set(
        V2_OBSERVED_BASE_EPOCH_COUNT_FLOOR,
        isNonNegativeSafeInteger(previousCount)
          ? Math.max(previousCount, filteredCount)
          : filteredCount,
      );
    }
  }
  if (event === undefined) return error;
  const previous = observed.get(V2_OBSERVED_BASE_EPOCH_LATEST);
  if (event === null) {
    if (isPlainRecord(previous)) {
      error ??= new V2RuntimeFailure(
        `Previously observed base-epoch event ${previous.event.id} ` +
          "disappeared from the latest-event inventory",
        { recoveryCode: "wait_then_reconcile" },
      );
    }
    return error;
  }
  const fingerprint = canonicalJson(event);
  if (!isPlainRecord(previous)) {
    observed.set(V2_OBSERVED_BASE_EPOCH_LATEST, { event, fingerprint });
    return error;
  }
  if (event.id === previous.event.id) {
    if (fingerprint !== previous.fingerprint) {
      return poisonV2ObservedHistory(
        observed,
        `Previously observed base-epoch event ${event.id} changed`,
      );
    }
    return error;
  }
  const order = Date.parse(event.createdAt) - Date.parse(previous.event.createdAt);
  if (order > 0) {
    observed.set(V2_OBSERVED_BASE_EPOCH_LATEST, { event, fingerprint });
    return error;
  }
  if (order === 0) {
    return poisonV2ObservedHistory(
      observed,
      `Base-epoch events ${previous.event.id} and ${event.id} have ambiguous ordering`,
    );
  }
  error ??= new V2RuntimeFailure(
    `Latest base-epoch event moved backwards from ${previous.event.id} ` +
      `to ${event.id}`,
    { recoveryCode: "wait_then_reconcile" },
  );
  return error;
}

function normalizeV2BaseEpochEvent(value) {
  if (
    !isPlainRecord(value) ||
    typeof value.id !== "string" ||
    value.id.trim() === "" ||
    !isCanonicalUtcTimestamp(value.createdAt)
  ) {
    throw new V2RuntimeFailure(
      "GitHub GraphQL base-epoch event was incomplete or inconsistent",
    );
  }
  const actor = normalizeV2BaseEpochActor(value.actor);
  if (value.__typename === "BaseRefChangedEvent") {
    if (
      typeof value.previousRefName !== "string" ||
      value.previousRefName.trim() === "" ||
      typeof value.currentRefName !== "string" ||
      value.currentRefName.trim() === ""
    ) {
      throw new V2RuntimeFailure(
        "GitHub GraphQL base-ref-change event was incomplete or inconsistent",
      );
    }
    return {
      typename: value.__typename,
      id: value.id,
      createdAt: value.createdAt,
      previousRefName: value.previousRefName,
      currentRefName: value.currentRefName,
      actor,
    };
  }
  if (value.__typename === "BaseRefForcePushedEvent") {
    const beforeSha = normalizeV2OptionalGraphQlCommit(value.beforeCommit, "before");
    const afterSha = normalizeV2OptionalGraphQlCommit(value.afterCommit, "after");
    const refName = value.ref === null
      ? null
      : isPlainRecord(value.ref) &&
          typeof value.ref.name === "string" &&
          value.ref.name.trim() !== ""
        ? value.ref.name
        : undefined;
    if (refName === undefined) {
      throw new V2RuntimeFailure(
        "GitHub GraphQL base-ref-force-push ref was incomplete or inconsistent",
      );
    }
    return {
      typename: value.__typename,
      id: value.id,
      createdAt: value.createdAt,
      beforeSha,
      afterSha,
      refName,
      actor,
    };
  }
  throw new V2RuntimeFailure(
    "GitHub GraphQL base-epoch response returned an unexpected timeline event",
  );
}

function normalizeV2BaseEpochActor(actor) {
  if (actor === null) return null;
  if (
    !isPlainRecord(actor) ||
    typeof actor.__typename !== "string" ||
    actor.__typename.trim() === "" ||
    typeof actor.login !== "string" ||
    actor.login.trim() === ""
  ) {
    throw new V2RuntimeFailure(
      "GitHub GraphQL base-epoch actor was incomplete or inconsistent",
    );
  }
  return { typename: actor.__typename, login: actor.login };
}

function normalizeV2OptionalGraphQlCommit(commit, position) {
  if (commit === null) return null;
  const oid = String(commit?.oid || "");
  if (!isPlainRecord(commit) || !FULL_SHA.test(oid) || oid !== oid.toLowerCase()) {
    throw new V2RuntimeFailure(
      `GitHub GraphQL base-ref-force-push ${position} commit was incomplete or inconsistent`,
    );
  }
  return oid;
}

async function loadV2PullRequest(client, config, budget) {
  const { data } = await client.request(
    "GET",
    `${config.repoPath}/pulls/${config.prNumber}`,
    undefined,
    { budget, safeRead: true },
  );
  budget?.consumeObjects(1, "pull-request metadata");
  if (
    !isPlainRecord(data) ||
    data.number !== config.prNumber ||
    !FULL_SHA.test(String(data.head?.sha || "")) ||
    !FULL_SHA.test(String(data.base?.sha || "")) ||
    !(
      data.merge_commit_sha === null ||
      FULL_SHA.test(String(data.merge_commit_sha || ""))
    ) ||
    !Number.isSafeInteger(data.base?.repo?.id) ||
    data.base.repo.id <= 0 ||
    data.base.repo.full_name !== config.repository ||
    typeof data.base?.ref !== "string" ||
    data.base.ref.trim() === "" ||
    !Number.isSafeInteger(data.head?.repo?.id) ||
    data.head.repo.id <= 0 ||
    typeof data.head.repo.full_name !== "string" ||
    typeof data.head?.ref !== "string" ||
    data.head.ref.trim() === "" ||
    !isPlainRecord(data.head?.user) ||
    typeof data.head.user.type !== "string" ||
    !isPlainRecord(data.user) ||
    typeof data.user.type !== "string" ||
    (data.state !== "open" && data.state !== "closed") ||
    typeof data.draft !== "boolean" ||
    typeof data.merged !== "boolean" ||
    !(data.merged_at === null || isCanonicalUtcTimestamp(data.merged_at)) ||
    data.merged !== (data.merged_at !== null) ||
    (data.state === "open" && data.merged) ||
    !isNonNegativeSafeInteger(data.comments) ||
    !isNonNegativeSafeInteger(data.commits)
  ) {
    throw new V2RuntimeFailure("GitHub pull-request response was incomplete or inconsistent");
  }
  return data;
}

function requireV2ActorShape(actor, label) {
  if (
    !isPlainRecord(actor) ||
    typeof actor.login !== "string" ||
    actor.login.trim() === "" ||
    typeof actor.type !== "string" ||
    actor.type.trim() === ""
  ) {
    throw new V2RuntimeFailure(`${label} has an incomplete author identity`);
  }
}

function requireV2OptionalAppShape(value, label) {
  for (const [field, app] of [
    ["app", value.app],
    ["performed_via_github_app", value.performed_via_github_app],
  ]) {
    if (app == null) continue;
    if (!isPlainRecord(app) || typeof app.slug !== "string" || app.slug.trim() === "") {
      throw new V2RuntimeFailure(`${label} has an incomplete ${field} identity`);
    }
  }
}

function requireV2IssueCommentShape(comment, label) {
  const id = canonicalPositiveId(comment?.id);
  if (
    !isPlainRecord(comment) ||
    !id ||
    typeof comment.body !== "string" ||
    typeof comment.html_url !== "string" ||
    comment.html_url.trim() === "" ||
    !isCanonicalUtcTimestamp(comment.created_at) ||
    !isCanonicalUtcTimestamp(comment.updated_at) ||
    Date.parse(comment.updated_at) < Date.parse(comment.created_at)
  ) {
    throw new V2RuntimeFailure(`${label} has an incomplete or inconsistent comment shape`);
  }
  requireV2ActorShape(comment.user, label);
  requireV2OptionalAppShape(comment, label);
}

function requireV2ReviewShape(review, label) {
  const reviewStates = new Set([
    "PENDING",
    "COMMENTED",
    "APPROVED",
    "CHANGES_REQUESTED",
    "DISMISSED",
  ]);
  const submittedAtIsValid = review?.submitted_at === null
    ? review?.state === "PENDING"
    : isCanonicalUtcTimestamp(review?.submitted_at);
  if (
    !isPlainRecord(review) ||
    !canonicalPositiveId(review.id) ||
    !reviewStates.has(review.state) ||
    typeof review.body !== "string" ||
    !FULL_SHA.test(String(review.commit_id || "")) ||
    typeof review.html_url !== "string" ||
    review.html_url.trim() === "" ||
    !submittedAtIsValid
  ) {
    throw new V2RuntimeFailure(`${label} has an incomplete or inconsistent review shape`);
  }
  requireV2ActorShape(review.user, label);
  requireV2OptionalAppShape(review, label);
}

function requireV2ReactionShape(reactionValue, label) {
  const reactionContents = new Set([
    "+1",
    "-1",
    "laugh",
    "confused",
    "heart",
    "hooray",
    "rocket",
    "eyes",
  ]);
  if (
    !isPlainRecord(reactionValue) ||
    !canonicalPositiveId(reactionValue.id) ||
    !reactionContents.has(reactionValue.content) ||
    !isCanonicalUtcTimestamp(reactionValue.created_at)
  ) {
    throw new V2RuntimeFailure(`${label} has an incomplete or inconsistent reaction shape`);
  }
  requireV2ActorShape(reactionValue.user, label);
}

function isOpenV2PullRequest(pullRequest) {
  return pullRequest.state === "open" &&
    pullRequest.merged === false &&
    pullRequest.merged_at === null;
}

async function writeV2StickyBestEffort(client, config, context, report) {
  try {
    const budget = new V2SnapshotBudget(config);
    const comments = await client.paginate(
      `${config.repoPath}/issues/${config.prNumber}/comments`,
      {
        budget,
        label: "sticky-comment lookup",
        validate: requireV2IssueCommentShape,
      },
    );
    const stickyCandidates = comments
      .filter((comment) =>
        canonicalPositiveId(comment?.id) && isV2CanonicalActionsSticky(comment, config)
      )
      .sort(compareV2CanonicalIdsAscending);
    if (stickyCandidates.length > 1) {
      console.warn(
        `Found ${stickyCandidates.length} canonical v2 sticky diagnostics; ` +
          "preserving them without mutation",
      );
    }
    if (stickyCandidates.length > 0) return;
    const body = buildV2StickyCommentBody(report, context);
    await client.request(
      "POST",
      `${config.repoPath}/issues/${config.prNumber}/comments`,
      { body },
      { safeRead: false },
    );
  } catch (error) {
    console.warn(`best-effort sticky report was not persisted: ${error.message}`);
  }
}

function normalizedV2FindingCount(artifact) {
  if (Number.isSafeInteger(artifact?.findingCount) && artifact.findingCount > 0) {
    return artifact.findingCount;
  }
  return Array.isArray(artifact?.samples) && artifact.samples.length > 0
    ? artifact.samples.length
    : 1;
}

function selectLatestV2RequestEpoch(requests) {
  const candidates = [];
  for (const request of requests ?? []) {
    const comment = request?.comment;
    const id = canonicalPositiveId(comment?.id);
    if (
      !id ||
      !isCanonicalUtcTimestamp(comment?.created_at) ||
      !isCanonicalUtcTimestamp(comment?.updated_at) ||
      Date.parse(comment.updated_at) < Date.parse(comment.created_at)
    ) {
      return {
        selected: null,
        error: `Review request ${id || "<unknown>"} has invalid ordering metadata`,
      };
    }
    candidates.push({
      ...request,
      id,
      revisionMs: Date.parse(comment.updated_at),
    });
  }
  candidates.sort(compareV2RequestEpochNewestFirst);
  return { selected: candidates[0] || null, error: null };
}

function compareV2RequestEpochNewestFirst(left, right) {
  const byRevision = right.revisionMs - left.revisionMs;
  if (byRevision !== 0) return byRevision;
  const leftId = BigInt(left.id);
  const rightId = BigInt(right.id);
  return rightId > leftId ? 1 : rightId < leftId ? -1 : 0;
}

function compareV2ProviderObjectsById(left, right) {
  const leftId = BigInt(canonicalPositiveId(left?.id));
  const rightId = BigInt(canonicalPositiveId(right?.id));
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function compareV2ReactionSignalsNewestFirst(left, right) {
  const byTime = right.createdMs - left.createdMs;
  if (byTime !== 0) return byTime;
  const leftId = BigInt(left.id);
  const rightId = BigInt(right.id);
  return rightId > leftId ? 1 : rightId < leftId ? -1 : 0;
}

function compareTerminalArtifactsNewestFirst(left, right) {
  const byTime = Date.parse(right.createdAt) - Date.parse(left.createdAt);
  if (byTime !== 0) return byTime;
  if (left.source !== right.source) return 0;
  const leftId = BigInt(String(left.id));
  const rightId = BigInt(String(right.id));
  return rightId > leftId ? 1 : rightId < leftId ? -1 : 0;
}

function findCrossChannelTimestampConflicts(artifacts) {
  const groups = new Map();
  for (const artifact of artifacts) {
    const headSha = String(artifact.headSha || "").toLowerCase();
    const second = Math.floor(Date.parse(artifact.createdAt) / 1_000);
    const key = `${headSha}\u0000${second}`;
    const group = groups.get(key) || [];
    group.push(artifact);
    groups.set(key, group);
  }
  const conflicts = [];
  for (const group of groups.values()) {
    if (new Set(group.map((artifact) => artifact.source)).size > 1) {
      const newestCreatedAt = group.reduce((newest, artifact) =>
        Date.parse(artifact.createdAt) > Date.parse(newest)
          ? artifact.createdAt
          : newest,
      group[0].createdAt);
      const second = Math.floor(Date.parse(newestCreatedAt) / 1_000);
      conflicts.push({
        message:
          `Cross-channel Codex terminal artifacts share ambiguous second ` +
          `${new Date(second * 1_000).toISOString()} on commit ${group[0].headSha}`,
        createdAt: newestCreatedAt,
        headSha: group[0].headSha,
      });
    }
  }
  return conflicts;
}

function compareV2IssueCommentsOldestFirst(left, right) {
  const leftTime = isCanonicalUtcTimestamp(left?.created_at)
    ? Date.parse(left.created_at)
    : null;
  const rightTime = isCanonicalUtcTimestamp(right?.created_at)
    ? Date.parse(right.created_at)
    : null;
  if (leftTime !== null && rightTime !== null && leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  const leftId = BigInt(canonicalPositiveId(left?.id));
  const rightId = BigInt(canonicalPositiveId(right?.id));
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function compareV2CanonicalIdsAscending(left, right) {
  const leftId = BigInt(canonicalPositiveId(left?.id));
  const rightId = BigInt(canonicalPositiveId(right?.id));
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function compareV2LineageBoundaryIdsAscending(left, right) {
  const leftNumeric = canonicalPositiveId(left?.id);
  const rightNumeric = canonicalPositiveId(right?.id);
  if (leftNumeric && rightNumeric) {
    const leftId = BigInt(leftNumeric);
    const rightId = BigInt(rightNumeric);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  }
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  return compareV2OpaqueStringsAscending(left?.id, right?.id);
}

function compareV2OpaqueStringsAscending(left, right) {
  const leftValue = String(left ?? "");
  const rightValue = String(right ?? "");
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function hasExactProviderIdentity(value, { allowMissingApp = false } = {}) {
  if (
    value?.user?.login !== OFFICIAL_CODEX_BOT_LOGIN ||
    value?.user?.type !== "Bot"
  ) {
    return false;
  }
  const apps = [value?.app, value?.performed_via_github_app]
    .filter((app) => app != null);
  return apps.every((app) => app?.slug === OFFICIAL_CODEX_APP_SLUG) &&
    (allowMissingApp || apps.length > 0);
}

function hasAnyV2ProviderIdentitySignal(value) {
  return value?.user?.login === OFFICIAL_CODEX_BOT_LOGIN ||
    [value?.app, value?.performed_via_github_app]
      .some((app) => app?.slug === OFFICIAL_CODEX_APP_SLUG);
}

function hasV2ProviderReactionIdentitySignal(reaction) {
  return reaction?.user?.login === OFFICIAL_CODEX_BOT_LOGIN &&
    (reaction?.content === "+1" || reaction?.content === "eyes");
}

function v2InvalidProviderReactionProvenanceError(reaction) {
  return `Codex ${reaction?.content || "signal"} reaction ` +
    `${canonicalPositiveId(reaction?.id) || "<unknown>"} has invalid Bot provenance`;
}

function isRelevantV2IssueComment(comment) {
  return Boolean(
    hasExactV2PhysicalReviewRequestShape(comment?.body) ||
      isV2EditedUnknownRequestBoundary(comment) ||
      hasAnyV2ProviderIdentitySignal(comment),
  );
}

function sameV2PullRequestScope(left, right) {
  return canonicalJson(fingerprintV2PullRequestScope(left)) ===
    canonicalJson(fingerprintV2PullRequestScope(right)) &&
    left?.state === "open" &&
    right?.state === "open" &&
    left?.draft === false &&
    right?.draft === false &&
    left?.merged !== true &&
    right?.merged !== true &&
    !left?.merged_at &&
    !right?.merged_at;
}

function sameV2RepositoryScope(left, right) {
  return canonicalJson(fingerprintV2RepositoryScope(left)) ===
    canonicalJson(fingerprintV2RepositoryScope(right));
}

function fingerprintV2RepositoryScope(repository) {
  return {
    id: repository?.id ?? null,
    fullName: repository?.full_name ?? null,
    defaultBranch: repository?.default_branch ?? null,
    fork: repository?.fork ?? null,
  };
}

function fingerprintV2PullRequestScope(pullRequest) {
  return {
    number: pullRequest?.number ?? null,
    state: pullRequest?.state ?? null,
    draft: pullRequest?.draft ?? null,
    merged: pullRequest?.merged === true,
    mergedAt: pullRequest?.merged_at ?? null,
    authorType: pullRequest?.user?.type ?? null,
    headSha: String(pullRequest?.head?.sha || "").toLowerCase(),
    testMergeSha: String(pullRequest?.merge_commit_sha || "").toLowerCase() || null,
    headRef: pullRequest?.head?.ref ?? null,
    headRepositoryId: pullRequest?.head?.repo?.id ?? null,
    headRepositoryFullName: pullRequest?.head?.repo?.full_name ?? null,
    headAuthorType: pullRequest?.head?.user?.type ?? null,
    baseSha: String(pullRequest?.base?.sha || "").toLowerCase(),
    baseRef: pullRequest?.base?.ref ?? null,
    baseRepositoryId: pullRequest?.base?.repo?.id ?? null,
    baseRepositoryFullName: pullRequest?.base?.repo?.full_name ?? null,
    comments: pullRequest?.comments ?? null,
    commits: pullRequest?.commits ?? null,
  };
}

function sameV2InventoryCounts(left, right) {
  return sameOptionalV2Count(left?.comments, right?.comments) &&
    sameOptionalV2Count(left?.commits, right?.commits);
}

function sameOptionalV2Count(left, right) {
  if (left === undefined && right === undefined) return true;
  return Number.isSafeInteger(left) && left >= 0 && left === right;
}

function requireMatchingV2InventoryCount(expected, items, label) {
  if (expected === undefined) return;
  if (!Number.isSafeInteger(expected) || expected < 0) {
    throw new V2RuntimeFailure(`Pull-request ${label} count is invalid`);
  }
  if (items.length !== expected) {
    throw new V2RuntimeFailure(
      `Pull-request ${label} inventory changed while loading: ${items.length} of ${expected}`,
      { recoveryCode: "wait_then_reconcile" },
    );
  }
}

function fingerprintIssueComment(comment) {
  return {
    id: String(comment?.id ?? ""),
    body: comment?.body ?? null,
    createdAt: comment?.created_at ?? null,
    updatedAt: comment?.updated_at ?? null,
    author: fingerprintActor(comment?.user),
    appSlugs: [comment?.app?.slug ?? null, comment?.performed_via_github_app?.slug ?? null],
    authorAssociation: comment?.author_association ?? null,
  };
}

function fingerprintReview(review) {
  return {
    id: String(review?.id ?? ""),
    body: review?.body ?? null,
    state: review?.state ?? null,
    commitId: review?.commit_id ?? null,
    submittedAt: review?.submitted_at ?? review?.created_at ?? null,
    author: fingerprintActor(review?.user),
    appSlugs: [review?.app?.slug ?? null, review?.performed_via_github_app?.slug ?? null],
  };
}

function fingerprintReviewIdentity(review) {
  return {
    id: String(review?.id ?? ""),
    author: fingerprintActor(review?.user),
    appSlugs: [review?.app?.slug ?? null, review?.performed_via_github_app?.slug ?? null],
  };
}

function fingerprintReaction(reaction) {
  return {
    id: String(reaction?.id ?? ""),
    content: reaction?.content ?? null,
    createdAt: reaction?.created_at ?? null,
    author: fingerprintActor(reaction?.user),
  };
}

function fingerprintActor(actor) {
  return { login: actor?.login ?? null, type: actor?.type ?? null };
}

function inspectV2PaginationLink(value, label) {
  const raw = String(value || "").trim();
  if (raw === "") return { hasNext: false, nextUrl: null };
  const knownRelations = new Set(["next", "prev", "first", "last"]);
  let nextLinks = 0;
  let nextUrl = null;
  for (const entry of raw.split(",")) {
    const match = /^\s*<([^<>]+)>\s*((?:;\s*[A-Za-z][A-Za-z0-9_-]*\s*=\s*(?:"[^"]*"|[^;,\s]+)\s*)+)$/u.exec(entry);
    if (!match) {
      throw new V2RuntimeFailure(`${label} returned a malformed Link header`);
    }
    try {
      new URL(match[1], "https://pagination.invalid");
    } catch {
      throw new V2RuntimeFailure(`${label} returned a malformed Link target`);
    }
    const relations = [...match[2].matchAll(
      /;\s*rel\s*=\s*(?:"([^"]*)"|([^;,\s]+))/giu,
    )];
    if (relations.length !== 1) {
      throw new V2RuntimeFailure(`${label} returned a Link without one exact rel parameter`);
    }
    const relationValues = (relations[0][1] ?? relations[0][2])
      .split(/\s+/u)
      .filter(Boolean);
    if (
      relationValues.length === 0 ||
      relationValues.some((relation) => !knownRelations.has(relation))
    ) {
      throw new V2RuntimeFailure(`${label} returned an unrecognized Link relation`);
    }
    if (relationValues.includes("next")) {
      nextLinks += 1;
      nextUrl = match[1];
    }
  }
  if (nextLinks > 1) {
    throw new V2RuntimeFailure(`${label} returned more than one next Link`);
  }
  return { hasNext: nextLinks === 1, nextUrl };
}

function exactNextLink(value, label) {
  return inspectV2PaginationLink(value, label).nextUrl;
}

async function mapV2Bounded(items, concurrency, worker) {
  if (!Array.isArray(items) || !Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new TypeError("mapV2Bounded requires an array and positive concurrency");
  }
  const results = new Array(items.length);
  let cursor = 0;
  let firstFailure = null;
  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (firstFailure === null) {
      const index = cursor;
      if (index >= items.length) return;
      cursor += 1;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        if (firstFailure === null) firstFailure = error;
      }
    }
  });
  await Promise.all(workers);
  if (firstFailure !== null) throw firstFailure;
  return results;
}

function monotonicMilliseconds() {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

async function sleepV2RetryDelay(milliseconds, budget, label) {
  budget?.assertWithinDeadline(label);
  const remaining = budget?.remainingMilliseconds() ?? Number.POSITIVE_INFINITY;
  await sleepMilliseconds(Math.max(1, Math.min(milliseconds, remaining)));
  budget?.assertWithinDeadline(label);
}

async function readBoundedResponseText(response, maxBytes, label) {
  if (!response?.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) {
      throw new V2ResponseSizeFailure(
        `GitHub response for ${label} exceeded ${maxBytes} bytes`,
      );
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel("response too large").catch(() => {});
        throw new V2ResponseSizeFailure(
          `GitHub response for ${label} exceeded ${maxBytes} bytes`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), length).toString("utf8");
}

function retryDelay(retryAfter, attempt) {
  if (/^[0-9]+$/u.test(String(retryAfter || ""))) {
    return Math.min(Number(retryAfter) * 1_000, 2_000);
  }
  return 250 * attempt;
}

function requiredValue(environment, name) {
  const value = String(environment[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function runtimeValue(environment, internalName, actionInputName) {
  if (Object.hasOwn(environment, internalName)) {
    return String(environment[internalName] ?? "");
  }
  return String(environment[actionInputName] ?? "");
}

function requiredRuntimeValue(environment, internalName, actionInputName) {
  const value = runtimeValue(environment, internalName, actionInputName).trim();
  if (!value) throw new Error(`${actionInputName} is required`);
  return value;
}

function stripSlashes(value) {
  return String(value).replace(/\/+$/u, "");
}

function readEvent(path) {
  if (!path) throw new V2RuntimeFailure("GITHUB_EVENT_PATH is required for v2 events");
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new V2RuntimeFailure(`Cannot read GitHub event payload: ${error.message}`);
  }
  if (!isPlainRecord(parsed)) throw new V2RuntimeFailure("GitHub event payload must be an object");
  return parsed;
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const result = await runV2GateCli();
  process.exitCode = result.exitCode;
}
