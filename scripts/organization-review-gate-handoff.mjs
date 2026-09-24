#!/usr/bin/env node

import { spawn } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import {
  decodeGitHubBlobContent,
  rulesetCoversDefaultBranch,
  validateFrozenHandoffV2WorkflowInventory,
} from "../src/bootstrap.mjs";

export const MANIFEST_SCHEMA_VERSION =
  "organization-review-gate-handoff-manifest/v3";
export const OUTPUT_SCHEMA_VERSION =
  "organization-review-gate-handoff-output/v2";
export const FINAL_CLOSURE_RECEIPT_SCHEMA_VERSION = 2;
export const V2_RULESET_NAME = "Must Pass Codex Review v2";
export const V2_STATUS_CONTEXT = "codex/github-review-gate";
export const LEGACY_STATUS_CONTEXT = "codex/review-gate";
export const GITHUB_ACTIONS_INTEGRATION_ID = 15368;
// GitHub materializes these values on the repository-v2 ruleset detail
// response. They are part of the frozen policy, rather than permissive
// readback extras: every value below is either the observed no-additional-
// restriction shape or an explicit required gate property.
const V2_REPOSITORY_PULL_REQUEST_PARAMETERS = Object.freeze({
  allowed_merge_methods: Object.freeze(["merge", "squash", "rebase"]),
  dismiss_stale_reviews_on_push: true,
  dismissal_restriction: Object.freeze({
    enabled: false,
    allowed_actors: Object.freeze([]),
  }),
  require_code_owner_review: true,
  require_extra_approval_for_unattributed_changes: true,
  require_last_push_approval: false,
  required_approving_review_count: 0,
  required_review_thread_resolution: true,
  required_reviewers: Object.freeze([]),
});
const V2_REPOSITORY_STATUS_PARAMETERS = Object.freeze({
  required_status_checks: Object.freeze([
    Object.freeze({
      context: V2_STATUS_CONTEXT,
      integration_id: GITHUB_ACTIONS_INTEGRATION_ID,
    }),
  ]),
  strict_required_status_checks_policy: true,
  do_not_enforce_on_create: false,
});
export const REQUIRED_REPOSITORY_COUNT = 10;
// The current v2 handoff migrates ten active repositories. The inherited
// organization rule intentionally retains one archived repository so its
// deletion/non-fast-forward protection survives the v1 status-rule removal.
export const LEGACY_SELECTOR_REPOSITORY_COUNT = 11;
export const CODEOWNERS_PATH = ".github/CODEOWNERS";
export const V2_VERIFIER_RUN_NAME_PREFIX = "codex-review-gate-verifier";
// These are every documented nonterminal Actions workflow-run state. A run in
// any of them can still execute and overwrite the legacy status, so every
// complete, unfiltered legacy-writer inventory must reject all of them before
// its compatibility evidence is accepted.
export const NONTERMINAL_WORKFLOW_RUN_STATUSES = Object.freeze([
  "requested",
  "waiting",
  "pending",
  "queued",
  "in_progress",
]);
const CANARY_PULL_QUERY = `query CanaryPull($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number
      state
      isDraft
      merged
      mergeable
      headRefOid
      baseRefName
      baseRefOid
      headRepository { nameWithOwner }
      baseRepository { nameWithOwner }
      potentialMergeCommit { oid }
      changedFiles
    }
  }
}`;
export const CANONICAL_WORKFLOW_IDENTITIES = Object.freeze({
  verifier: Object.freeze({
    path: ".github/workflows/codex-review-gate.yml",
    git_blob_sha: "ac3aa30e5ae489ee81fbe8eb303bc06ecbf2b5af",
    sha256: "e3cb79b20483524303b84543921e6734de0dea13b1e37833bb0bf2b29dc6c74e",
  }),
  controller: Object.freeze({
    path: ".github/workflows/codex-review-gate-controller.yml",
    git_blob_sha: "c994a6861414e1efc1e7ab376470c7709d475ef1",
    sha256: "e4135ae8a7e2c41b2f354f5955795c67e61aa10acb4953724e631d93f863907e",
  }),
  legacy_bridge: Object.freeze({
    path: ".github/workflows/codex-review-gate-legacy-bridge.yml",
    git_blob_sha: "8a4e7af48dc50a33325185f7a0f35dbe22f788ba",
    sha256: "e2266e3ed116139f4272d0bf47188776455ea3be026225328bfb654ef74f02ef",
  }),
});

const GITHUB_API_VERSION = "2026-03-10";
const MAX_GH_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const GH_TIMEOUT_MS = 60_000;
const GH_API_QUEUE_TIMEOUT_MS = 60_000;
// A writer epoch retains one compact execution identity per historical run.
// These hard bounds protect the one-time handoff reader's memory and request
// footprint; they are intentionally distinct from consumer reconcile limits.
const LEGACY_WRITER_SCAN_TIMEOUT_MS = 60_000;
const MAX_LEGACY_WRITER_SCAN_TIMEOUT_MS = 300_000;
const LEGACY_EVIDENCE_STABILITY_TIMEOUT_MS = 900_000;
const MAX_LEGACY_EVIDENCE_STABILITY_TIMEOUT_MS = 900_000;
const ACTIVATION_STABILITY_INTERVAL_MS = 5_000;
const ACTIVATION_SCHEDULER_DRAIN_TIMEOUT_MS = 2_100_000;
const MAX_ACTIVATION_SCHEDULER_DRAIN_TIMEOUT_MS = 2_100_000;
// A coverage round first proves the complete post-disable scheduler evidence,
// then reads the ten repositories in five bounded waves. The organization
// read and every repository evidence pass have independent budgets, so the
// round formula remains an enforceable capacity bound even when a live
// workflow or ruleset inventory grows. The pair budget covers two whole rounds
// plus their stable-read interval.
const ACTIVATION_REPOSITORY_EVIDENCE_TIMEOUT_MS = 1_200_000;
const MAX_ACTIVATION_REPOSITORY_EVIDENCE_TIMEOUT_MS = 1_800_000;
const ACTIVATION_SCHEDULER_SNAPSHOT_TIMEOUT_MS = 120_000;
const MAX_ACTIVATION_SCHEDULER_SNAPSHOT_TIMEOUT_MS = 300_000;
const ACTIVATION_ORGANIZATION_EVIDENCE_TIMEOUT_MS = 120_000;
const MAX_ACTIVATION_ORGANIZATION_EVIDENCE_TIMEOUT_MS = 600_000;
const ACTIVATION_COVERAGE_ROUND_TIMEOUT_MS = 9_000_000;
const MAX_ACTIVATION_COVERAGE_ROUND_TIMEOUT_MS = 15_000_000;
const ACTIVATION_COVERAGE_STABILITY_TIMEOUT_MS = 18_005_000;
const MAX_ACTIVATION_COVERAGE_STABILITY_TIMEOUT_MS =
  2 * MAX_ACTIVATION_COVERAGE_ROUND_TIMEOUT_MS +
  ACTIVATION_STABILITY_INTERVAL_MS;
// These inventories feed bounded fan-out reads. Keep their cardinalities small
// enough that a single evidence phase remains operationally inspectable.
const MAX_WORKFLOW_INVENTORY_YAML_FILES = 32;
const MAX_ACTIONS_WORKFLOW_INVENTORY_ENTRIES = 32;
const MAX_LOCAL_REPOSITORY_RULESETS = 32;
const LEGACY_WRITER_RUN_PAGE_SIZE = 100;
const MAX_LEGACY_WRITER_RUN_ENTRIES = 100_000;
const MAX_LEGACY_WRITER_RUN_PAGES = 1_000;
const GH_API_CONCURRENCY = 8;
const REPOSITORY_EVIDENCE_CONCURRENCY = 2;
const MODES = new Set([
  "plan",
  "stage",
  "quiesce-scheduler",
  "activate",
  "restore-scheduler",
  "derive-cutover",
  "apply-repository-cleanup",
  "verify",
]);
const WORKFLOW_KEYS = ["verifier", "controller", "legacy_bridge"];
const CONTROL_PLANE_CODEOWNERS_BEGIN =
  "# BEGIN codex-review-gate control-plane";
const CONTROL_PLANE_CODEOWNERS_END = "# END codex-review-gate control-plane";
const ACTIVATION_SCHEDULER_REPOSITORY = "Joey-Tools/codex-private-workflows";
const ACTIVATION_SCHEDULER_WORKFLOW_PATH =
  ".github/workflows/scheduled-sync-release.yml";

export class RetryableHandoffEvidenceUnstableError extends Error {
  constructor(message, options = undefined) {
    super(message, options);
    this.name = "RetryableHandoffEvidenceUnstableError";
  }
}

class DeadlineExceededError extends Error {
  constructor(label) {
    super(
      `${label} exceeded its shared deadline; the result is inconclusive and no next write is allowed.`,
    );
    this.name = "DeadlineExceededError";
    this.label = label;
  }
}

const ghDeadlineContext = new AsyncLocalStorage();

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256Canonical(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value;
}

function assertExactKeys(value, expectedKeys, label) {
  assertPlainObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(
      `${label} must contain exactly these keys: ${expected.join(", ")}.`,
    );
  }
}

function assertAllowedKeys(value, allowedKeys, label) {
  assertPlainObject(value, label);
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new Error(
      `${label} contains unsupported keys: ${unexpected.sort().join(", ")}.`,
    );
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function statusContextEquals(candidate, canonical) {
  return (
    typeof candidate === "string" &&
    candidate.toLowerCase() === canonical.toLowerCase()
  );
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function assertBoundedTimeout(value, minimum, maximum, label) {
  assertPositiveInteger(value, label);
  if (value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum}ms and ${maximum}ms.`);
  }
  return value;
}

function assertNullablePositiveInteger(value, label) {
  if (value !== null) {
    assertPositiveInteger(value, label);
  }
  return value;
}

function assertHex(value, length, label) {
  if (
    typeof value !== "string" ||
    !new RegExp(`^[0-9a-f]{${length}}$`, "u").test(value)
  ) {
    throw new Error(`${label} must be an exact lowercase ${length}-hex value.`);
  }
  return value;
}

function assertJsonData(value, label) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`${label} contains a non-safe-integer JSON number.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonData(entry, `${label}[${index}]`));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      assertJsonData(entry, `${label}.${key}`);
    }
    return;
  }
  throw new Error(`${label} contains a non-JSON value.`);
}

function assertSlug(value, label) {
  assertNonEmptyString(value, label);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value)) {
    throw new Error(`${label} must be an exact OWNER/REPO slug.`);
  }
  return value;
}

function assertRepoRelativeWorkflowPath(value, label) {
  assertNonEmptyString(value, label);
  if (
    !value.startsWith(".github/workflows/") ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((part) => part === "" || part === "." || part === "..") ||
    !/\.ya?ml$/u.test(value)
  ) {
    throw new Error(
      `${label} must be a normalized repository-relative YAML path under .github/workflows/.`,
    );
  }
  return value;
}

function assertRule(rule, label) {
  assertAllowedKeys(rule, ["type", "parameters"], label);
  assertNonEmptyString(rule.type, `${label}.type`);
  if (Object.hasOwn(rule, "parameters")) {
    assertPlainObject(rule.parameters, `${label}.parameters`);
    assertJsonData(rule.parameters, `${label}.parameters`);
  }
}

function assertBypassActor(actor, label) {
  assertExactKeys(actor, ["actor_id", "actor_type", "bypass_mode"], label);
  if (actor.actor_id !== null) {
    assertPositiveInteger(actor.actor_id, `${label}.actor_id`);
  }
  assertNonEmptyString(actor.actor_type, `${label}.actor_type`);
  assertNonEmptyString(actor.bypass_mode, `${label}.bypass_mode`);
}

function assertWritableRuleset(value, label) {
  assertExactKeys(
    value,
    ["name", "target", "enforcement", "bypass_actors", "conditions", "rules"],
    label,
  );
  assertNonEmptyString(value.name, `${label}.name`);
  if (value.target !== "branch") {
    throw new Error(`${label}.target must be "branch".`);
  }
  if (!new Set(["disabled", "evaluate", "active"]).has(value.enforcement)) {
    throw new Error(`${label}.enforcement is unsupported.`);
  }
  assertPlainObject(value.conditions, `${label}.conditions`);
  assertJsonData(value.conditions, `${label}.conditions`);
  if (!Array.isArray(value.bypass_actors)) {
    throw new Error(`${label}.bypass_actors must be an array.`);
  }
  value.bypass_actors.forEach((actor, index) =>
    assertBypassActor(actor, `${label}.bypass_actors[${index}]`),
  );
  if (!Array.isArray(value.rules)) {
    throw new Error(`${label}.rules must be an array.`);
  }
  value.rules.forEach((rule, index) => assertRule(rule, `${label}.rules[${index}]`));
  const statusRules = value.rules.filter(
    (rule) => rule.type === "required_status_checks",
  );
  if (statusRules.length > 1) {
    throw new Error(`${label} contains duplicate required_status_checks rules.`);
  }
  if (statusRules.length === 1) {
    const checks = statusChecks(statusRules[0], `${label}.required_status_checks`);
    const contexts = checks.map((check) => check.context);
    if (new Set(contexts).size !== contexts.length) {
      throw new Error(`${label} contains duplicate required status contexts.`);
    }
  }
  return value;
}

function requiredStatusRules(ruleset) {
  return ruleset.rules.filter((rule) => rule.type === "required_status_checks");
}

function statusChecks(rule, label) {
  if (!isPlainObject(rule.parameters)) {
    throw new Error(`${label}.parameters must be an object.`);
  }
  const checks = rule.parameters.required_status_checks;
  if (!Array.isArray(checks)) {
    throw new Error(`${label}.parameters.required_status_checks must be an array.`);
  }
  for (const [index, check] of checks.entries()) {
    assertAllowedKeys(check, ["context", "integration_id"], `${label}.check[${index}]`);
    assertNonEmptyString(check.context, `${label}.check[${index}].context`);
    if (Object.hasOwn(check, "integration_id")) {
      assertPositiveInteger(
        check.integration_id,
        `${label}.check[${index}].integration_id`,
      );
    }
  }
  return checks;
}

function assertLegacyOrganizationRulesetPolicy(
  ruleset,
  activeRepositoryIds,
  legacyOnlyRepository,
  label,
) {
  assertWritableRuleset(ruleset, label);
  if (ruleset.enforcement !== "active") {
    throw new Error(`${label} must remain active before global cutover.`);
  }
  const conditions = ruleset.conditions;
  assertExactKeys(conditions, ["ref_name", "repository_id"], `${label}.conditions`);
  assertExactKeys(
    conditions.repository_id,
    ["repository_ids"],
    `${label}.conditions.repository_id`,
  );
  const legacySelectorRepositoryIds = conditions.repository_id.repository_ids;
  if (
    !Array.isArray(legacySelectorRepositoryIds) ||
    legacySelectorRepositoryIds.some(
      (id) => !Number.isSafeInteger(id) || id <= 0,
    )
  ) {
    throw new Error(`${label}.conditions.repository_id.repository_ids is malformed.`);
  }
  if (
    legacySelectorRepositoryIds.length !== LEGACY_SELECTOR_REPOSITORY_COUNT ||
    new Set(legacySelectorRepositoryIds).size !== legacySelectorRepositoryIds.length
  ) {
    throw new Error(
      `${label} repository IDs must contain exactly ${LEGACY_SELECTOR_REPOSITORY_COUNT} unique entries.`,
    );
  }
  const activeRepositoryIdSet = new Set(activeRepositoryIds);
  const orderedActiveRepositoryIds = legacySelectorRepositoryIds.filter((id) =>
    activeRepositoryIdSet.has(id),
  );
  if (
    canonicalJson(orderedActiveRepositoryIds) !==
    canonicalJson(activeRepositoryIds)
  ) {
    throw new Error(
      `${label} repository IDs must retain every ordered active manifest repository ID.`,
    );
  }
  if (
    legacySelectorRepositoryIds.filter((id) => id === legacyOnlyRepository.id)
      .length !== 1 ||
    legacySelectorRepositoryIds.some(
      (id) => !activeRepositoryIdSet.has(id) && id !== legacyOnlyRepository.id,
    )
  ) {
    throw new Error(
      `${label} repository IDs must contain only the ordered active manifest repository IDs plus manifest.legacy_ruleset.legacy_only_repository.id.`,
    );
  }
  assertExactKeys(
    conditions.ref_name,
    ["include", "exclude"],
    `${label}.conditions.ref_name`,
  );
  if (
    canonicalJson(conditions.ref_name.include) !== canonicalJson(["~DEFAULT_BRANCH"]) ||
    canonicalJson(conditions.ref_name.exclude) !== canonicalJson([])
  ) {
    throw new Error(
      `${label} must target exactly each selected repository's default branch.`,
    );
  }
  const statusRules = requiredStatusRules(ruleset);
  if (statusRules.length !== 1) {
    throw new Error(`${label} must contain exactly one required_status_checks rule.`);
  }
  const checks = statusChecks(statusRules[0], `${label}.legacy_status_rule`);
  if (
    checks.length !== 1 ||
    checks[0].context !== LEGACY_STATUS_CONTEXT ||
    checks.some((check) => check.context === V2_STATUS_CONTEXT)
  ) {
    throw new Error(
      `${label} required_status_checks must contain only the legacy v1 context.`,
    );
  }
  for (const requiredType of ["deletion", "non_fast_forward"]) {
    if (ruleset.rules.filter((rule) => rule.type === requiredType).length !== 1) {
      throw new Error(`${label} must contain exactly one ${requiredType} rule.`);
    }
  }
}

function assertV2RepositoryRulesetPolicy(ruleset, defaultBranch, label) {
  assertWritableRuleset(ruleset, label);
  if (ruleset.enforcement !== "active") {
    throw new Error(`${label} must be active.`);
  }
  if (ruleset.bypass_actors.length !== 0) {
    throw new Error(`${label} must have an explicit empty bypass list.`);
  }
  const refName = ruleset.conditions.ref_name;
  if (
    !isPlainObject(refName) ||
    !Array.isArray(refName.include) ||
    !Array.isArray(refName.exclude) ||
    !rulesetProvablyCoversDefaultBranch(ruleset, defaultBranch)
  ) {
    throw new Error(`${label} does not provably cover the repository default branch.`);
  }
  const statusRules = requiredStatusRules(ruleset);
  if (statusRules.length !== 1) {
    throw new Error(`${label} must contain exactly one required_status_checks rule.`);
  }
  const statusRule = statusRules[0];
  assertPlainObject(
    statusRule.parameters,
    `${label}.v2_status_rule.parameters`,
  );
  assertExactSnapshot(
    statusRule.parameters,
    V2_REPOSITORY_STATUS_PARAMETERS,
    `${label}.v2_status_rule.parameters`,
  );
  const pullRequestRules = ruleset.rules.filter((rule) => rule.type === "pull_request");
  if (pullRequestRules.length !== 1) {
    throw new Error(`${label} must contain exactly one pull_request rule.`);
  }
  const parameters = pullRequestRules[0].parameters;
  assertPlainObject(parameters, `${label}.pull_request.parameters`);
  assertExactSnapshot(
    parameters,
    V2_REPOSITORY_PULL_REQUEST_PARAMETERS,
    `${label}.pull_request.parameters`,
  );
  if (ruleset.rules.filter((rule) => rule.type === "non_fast_forward").length !== 1) {
    throw new Error(`${label} must contain exactly one non_fast_forward rule.`);
  }
}

function rulesetProvablyCoversDefaultBranch(ruleset, defaultBranch) {
  const exclude = ruleset.conditions?.ref_name?.exclude;
  if (!Array.isArray(exclude)) return false;
  // A wildcard exclusion is not a stable default-branch coverage assertion:
  // a branch rename can make it effective without changing the ruleset. The
  // handoff can retain exact exclusions for other known branches, but it must
  // not admit a broad exclusion into a default-branch gate policy.
  if (
    exclude.some(
      (pattern) =>
        typeof pattern !== "string" || /[*?[]/u.test(pattern),
    )
  ) {
    return false;
  }
  return rulesetCoversDefaultBranch(ruleset, defaultBranch);
}

function assertWorkflowDescriptor(value, label) {
  assertExactKeys(value, ["path", "git_blob_sha", "sha256"], label);
  assertRepoRelativeWorkflowPath(value.path, `${label}.path`);
  assertHex(value.git_blob_sha, 40, `${label}.git_blob_sha`);
  assertHex(value.sha256, 64, `${label}.sha256`);
}

function validateActivationConfiguration(value) {
  assertExactKeys(
    value,
    [
      "legacy_evidence_stability_timeout_ms",
      "repository_evidence_timeout_ms",
      "scheduler_snapshot_timeout_ms",
      "organization_evidence_timeout_ms",
      "coverage_round_timeout_ms",
      "coverage_stability_timeout_ms",
    ],
    "manifest.activation",
  );
  const legacyEvidenceTimeoutMs = assertBoundedTimeout(
    value.legacy_evidence_stability_timeout_ms,
    LEGACY_WRITER_SCAN_TIMEOUT_MS,
    MAX_LEGACY_EVIDENCE_STABILITY_TIMEOUT_MS,
    "manifest.activation.legacy_evidence_stability_timeout_ms",
  );
  const coverageRoundTimeoutMs = assertBoundedTimeout(
    value.coverage_round_timeout_ms,
    ACTIVATION_COVERAGE_ROUND_TIMEOUT_MS,
    MAX_ACTIVATION_COVERAGE_ROUND_TIMEOUT_MS,
    "manifest.activation.coverage_round_timeout_ms",
  );
  const repositoryEvidenceTimeoutMs = assertBoundedTimeout(
    value.repository_evidence_timeout_ms,
    Math.max(legacyEvidenceTimeoutMs, ACTIVATION_REPOSITORY_EVIDENCE_TIMEOUT_MS),
    MAX_ACTIVATION_REPOSITORY_EVIDENCE_TIMEOUT_MS,
    "manifest.activation.repository_evidence_timeout_ms",
  );
  const organizationEvidenceTimeoutMs = assertBoundedTimeout(
    value.organization_evidence_timeout_ms,
    ACTIVATION_ORGANIZATION_EVIDENCE_TIMEOUT_MS,
    MAX_ACTIVATION_ORGANIZATION_EVIDENCE_TIMEOUT_MS,
    "manifest.activation.organization_evidence_timeout_ms",
  );
  const schedulerSnapshotTimeoutMs = assertBoundedTimeout(
    value.scheduler_snapshot_timeout_ms,
    ACTIVATION_SCHEDULER_SNAPSHOT_TIMEOUT_MS,
    MAX_ACTIVATION_SCHEDULER_SNAPSHOT_TIMEOUT_MS,
    "manifest.activation.scheduler_snapshot_timeout_ms",
  );
  const coverageTimeoutMs = assertBoundedTimeout(
    value.coverage_stability_timeout_ms,
    ACTIVATION_COVERAGE_STABILITY_TIMEOUT_MS,
    MAX_ACTIVATION_COVERAGE_STABILITY_TIMEOUT_MS,
    "manifest.activation.coverage_stability_timeout_ms",
  );
  return {
    legacyEvidenceTimeoutMs,
    repositoryEvidenceTimeoutMs,
    schedulerSnapshotTimeoutMs,
    organizationEvidenceTimeoutMs,
    coverageRoundTimeoutMs,
    coverageTimeoutMs,
  };
}

function activationCoverageRoundMinimum(manifest) {
  const schedulerRepository = manifest.repositories.find(
    (repo) => repo.slug === ACTIVATION_SCHEDULER_REPOSITORY,
  );
  const scheduler = schedulerRepository?.scheduler_quiescence;
  if (scheduler === null || scheduler === undefined) {
    throw new Error(
      `Validated manifest does not bind one activation scheduler in ${ACTIVATION_SCHEDULER_REPOSITORY}.`,
    );
  }
  return (
    scheduler.drain_timeout_ms +
    2 * manifest.activation.scheduler_snapshot_timeout_ms +
    Math.max(
      manifest.activation.organization_evidence_timeout_ms,
      Math.ceil(manifest.repositories.length / REPOSITORY_EVIDENCE_CONCURRENCY) *
        manifest.activation.repository_evidence_timeout_ms,
    )
  );
}

function assertActivationCoverageBudgetTopology(manifest) {
  const roundTimeoutMs = manifest.activation.coverage_round_timeout_ms;
  const minimumRoundTimeoutMs = activationCoverageRoundMinimum(manifest);
  if (roundTimeoutMs < minimumRoundTimeoutMs) {
    throw new Error(
      "manifest.activation.coverage_round_timeout_ms must cover scheduler drain plus both bounded scheduler snapshots and the longer of bounded organization evidence or every bounded repository-evidence wave.",
    );
  }
  const minimumPairTimeoutMs =
    2 * roundTimeoutMs + ACTIVATION_STABILITY_INTERVAL_MS;
  if (
    manifest.activation.coverage_stability_timeout_ms <
    minimumPairTimeoutMs
  ) {
    throw new Error(
      "manifest.activation.coverage_stability_timeout_ms must cover two complete coverage rounds and their stable-read interval.",
    );
  }
}

function validateSchedulerQuiescence(value, repo, label) {
  if (repo.slug !== ACTIVATION_SCHEDULER_REPOSITORY) {
    if (value !== null) {
      throw new Error(`${label} is allowed only for ${ACTIVATION_SCHEDULER_REPOSITORY}.`);
    }
    return null;
  }
  assertExactKeys(
    value,
    ["workflow_id", "workflow", "expected_initial_state", "drain_timeout_ms"],
    label,
  );
  assertPositiveInteger(value.workflow_id, `${label}.workflow_id`);
  assertWorkflowDescriptor(value.workflow, `${label}.workflow`);
  if (value.workflow.path !== ACTIVATION_SCHEDULER_WORKFLOW_PATH) {
    throw new Error(
      `${label}.workflow.path must be "${ACTIVATION_SCHEDULER_WORKFLOW_PATH}".`,
    );
  }
  if (value.expected_initial_state !== "active") {
    throw new Error(`${label}.expected_initial_state must be "active".`);
  }
  assertBoundedTimeout(
    value.drain_timeout_ms,
    ACTIVATION_STABILITY_INTERVAL_MS,
    MAX_ACTIVATION_SCHEDULER_DRAIN_TIMEOUT_MS,
    `${label}.drain_timeout_ms`,
  );
  return value;
}

function assertCodeownersDescriptor(value, label) {
  assertExactKeys(value, ["path", "git_blob_sha", "sha256", "owner"], label);
  if (value.path !== CODEOWNERS_PATH) {
    throw new Error(`${label}.path must be "${CODEOWNERS_PATH}".`);
  }
  assertHex(value.git_blob_sha, 40, `${label}.git_blob_sha`);
  assertHex(value.sha256, 64, `${label}.sha256`);
  assertExactKeys(value.owner, ["login", "id", "node_id"], `${label}.owner`);
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(value.owner.login)) {
    throw new Error(`${label}.owner.login must be one explicit USER login.`);
  }
  assertPositiveInteger(value.owner.id, `${label}.owner.id`);
  assertNonEmptyString(value.owner.node_id, `${label}.owner.node_id`);
}

function assertClassicStatusSnapshot(value, label) {
  assertExactKeys(value, ["strict", "contexts", "checks"], label);
  if (typeof value.strict !== "boolean") {
    throw new Error(`${label}.strict must be boolean.`);
  }
  if (!Array.isArray(value.contexts) || !Array.isArray(value.checks)) {
    throw new Error(`${label}.contexts and ${label}.checks must be arrays.`);
  }
  value.contexts.forEach((context, index) =>
    assertNonEmptyString(context, `${label}.contexts[${index}]`),
  );
  value.checks.forEach((check, index) => {
    assertExactKeys(check, ["context", "app_id"], `${label}.checks[${index}]`);
    assertNonEmptyString(check.context, `${label}.checks[${index}].context`);
    if (check.app_id !== null && check.app_id !== -1) {
      assertPositiveInteger(check.app_id, `${label}.checks[${index}].app_id`);
    }
  });
  return value;
}

function validateCleanupAction(action, repo, index) {
  const label = `manifest.repositories[${index}].legacy_cleanup action`;
  if (action.surface === "repository_ruleset") {
    assertExactKeys(
      action,
      [
        "surface",
        "ruleset_id",
        "operation",
        "expected_before",
        "expected_after",
      ],
      label,
    );
    assertPositiveInteger(action.ruleset_id, `${label}.ruleset_id`);
    if (action.ruleset_id === repo.v2_ruleset.id) {
      throw new Error(`${label} must not target the repository's v2 ruleset.`);
    }
    assertWritableRuleset(action.expected_before, `${label}.expected_before`);
    if (action.expected_after !== null) {
      assertWritableRuleset(action.expected_after, `${label}.expected_after`);
    }
  } else if (action.surface === "classic_required_status_checks") {
    assertExactKeys(
      action,
      ["surface", "operation", "expected_before", "expected_after"],
      label,
    );
    assertClassicStatusSnapshot(action.expected_before, `${label}.expected_before`);
    if (action.expected_after !== null) {
      assertClassicStatusSnapshot(action.expected_after, `${label}.expected_after`);
    }
  } else {
    throw new Error(`${label}.surface is unsupported.`);
  }
  if (!new Set(["update", "delete"]).has(action.operation)) {
    throw new Error(`${label}.operation must be update or delete.`);
  }
  deriveRepositoryCleanupAction(action);
}

function assertLegacyOnlyRepositoryIdentity(value, organization, label) {
  assertExactKeys(
    value,
    ["slug", "id", "node_id", "default_branch", "archived"],
    label,
  );
  assertSlug(value.slug, `${label}.slug`);
  const [owner] = value.slug.split("/");
  if (owner.toLowerCase() !== organization.login.toLowerCase()) {
    throw new Error(`${label}.slug must belong to manifest.organization.login.`);
  }
  assertPositiveInteger(value.id, `${label}.id`);
  assertNonEmptyString(value.node_id, `${label}.node_id`);
  assertNonEmptyString(value.default_branch, `${label}.default_branch`);
  if (
    value.default_branch.startsWith("refs/") ||
    value.default_branch.includes("..")
  ) {
    throw new Error(`${label}.default_branch is malformed.`);
  }
  if (value.archived !== true) {
    throw new Error(`${label}.archived must be true.`);
  }
}

export function validateManifest(input) {
  assertExactKeys(
    input,
    [
      "schema_version",
      "organization",
      "legacy_ruleset",
      "v2_ruleset",
      "activation",
      "repositories",
      "expected_legacy_cleanup_action_count",
    ],
    "manifest",
  );
  if (input.schema_version !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `manifest.schema_version must be "${MANIFEST_SCHEMA_VERSION}"; earlier manifests cannot authorize this 10-member cutover because they do not bind its scheduler and coverage-capacity contract.`,
    );
  }
  assertExactKeys(input.organization, ["login", "id", "node_id"], "manifest.organization");
  if (!/^[A-Za-z0-9-]+$/u.test(input.organization.login ?? "")) {
    throw new Error("manifest.organization.login is malformed.");
  }
  assertPositiveInteger(input.organization.id, "manifest.organization.id");
  assertNonEmptyString(input.organization.node_id, "manifest.organization.node_id");

  assertExactKeys(
    input.legacy_ruleset,
    ["id", "legacy_only_repository", "expected_before"],
    "manifest.legacy_ruleset",
  );
  assertPositiveInteger(input.legacy_ruleset.id, "manifest.legacy_ruleset.id");
  assertLegacyOnlyRepositoryIdentity(
    input.legacy_ruleset.legacy_only_repository,
    input.organization,
    "manifest.legacy_ruleset.legacy_only_repository",
  );
  assertWritableRuleset(
    input.legacy_ruleset.expected_before,
    "manifest.legacy_ruleset.expected_before",
  );

  assertExactKeys(input.v2_ruleset, ["id", "name"], "manifest.v2_ruleset");
  assertNullablePositiveInteger(input.v2_ruleset.id, "manifest.v2_ruleset.id");
  if (input.v2_ruleset.name !== V2_RULESET_NAME) {
    throw new Error(`manifest.v2_ruleset.name must be "${V2_RULESET_NAME}".`);
  }
  if (input.v2_ruleset.id === input.legacy_ruleset.id) {
    throw new Error("The legacy and v2 organization rulesets must have distinct IDs.");
  }

  validateActivationConfiguration(input.activation);

  if (
    !Array.isArray(input.repositories) ||
    input.repositories.length !== REQUIRED_REPOSITORY_COUNT
  ) {
    throw new Error(
      `manifest.repositories must contain exactly ${REQUIRED_REPOSITORY_COUNT} entries.`,
    );
  }
  const seenIds = new Set();
  const seenSlugs = new Set();
  const seenNodeIds = new Set();
  const seenCleanupTargets = new Set();
  let schedulerQuiescenceCount = 0;
  let cleanupCount = 0;
  for (const [index, repo] of input.repositories.entries()) {
    const label = `manifest.repositories[${index}]`;
    assertExactKeys(
      repo,
      [
        "slug",
        "id",
        "node_id",
        "default_branch",
        "workflows",
        "legacy_writer_scan_timeout_ms",
        "scheduler_quiescence",
        "codeowners",
        "v2_ruleset",
        "canary",
        "legacy_cleanup",
      ],
      label,
    );
    assertSlug(repo.slug, `${label}.slug`);
    const [owner] = repo.slug.split("/");
    if (owner.toLowerCase() !== input.organization.login.toLowerCase()) {
      throw new Error(`${label}.slug must belong to manifest.organization.login.`);
    }
    assertPositiveInteger(repo.id, `${label}.id`);
    assertNonEmptyString(repo.node_id, `${label}.node_id`);
    assertNonEmptyString(repo.default_branch, `${label}.default_branch`);
    if (repo.default_branch.startsWith("refs/") || repo.default_branch.includes("..")) {
      throw new Error(`${label}.default_branch is malformed.`);
    }
    if (
      seenIds.has(repo.id) ||
      seenSlugs.has(repo.slug.toLowerCase()) ||
      seenNodeIds.has(repo.node_id)
    ) {
      throw new Error(`${label} duplicates a repository identity.`);
    }
    seenIds.add(repo.id);
    seenSlugs.add(repo.slug.toLowerCase());
    seenNodeIds.add(repo.node_id);

    assertExactKeys(repo.workflows, WORKFLOW_KEYS, `${label}.workflows`);
    const workflowPaths = new Set();
    for (const key of WORKFLOW_KEYS) {
      assertWorkflowDescriptor(repo.workflows[key], `${label}.workflows.${key}`);
      if (
        canonicalJson(repo.workflows[key]) !==
        canonicalJson(CANONICAL_WORKFLOW_IDENTITIES[key])
      ) {
        throw new Error(
          `${label}.workflows.${key} must match the canonical path and byte identities for this manifest schema.`,
        );
      }
      if (workflowPaths.has(repo.workflows[key].path)) {
        throw new Error(`${label}.workflows paths must be distinct.`);
      }
      workflowPaths.add(repo.workflows[key].path);
    }
    assertCodeownersDescriptor(repo.codeowners, `${label}.codeowners`);
    assertBoundedTimeout(
      repo.legacy_writer_scan_timeout_ms,
      LEGACY_WRITER_SCAN_TIMEOUT_MS,
      MAX_LEGACY_WRITER_SCAN_TIMEOUT_MS,
      `${label}.legacy_writer_scan_timeout_ms`,
    );
    if (
      validateSchedulerQuiescence(
        repo.scheduler_quiescence,
        repo,
        `${label}.scheduler_quiescence`,
      ) !== null
    ) {
      schedulerQuiescenceCount += 1;
    }

    assertExactKeys(
      repo.v2_ruleset,
      ["id", "expected"],
      `${label}.v2_ruleset`,
    );
    assertPositiveInteger(repo.v2_ruleset.id, `${label}.v2_ruleset.id`);
    assertV2RepositoryRulesetPolicy(
      repo.v2_ruleset.expected,
      repo.default_branch,
      `${label}.v2_ruleset.expected`,
    );

    assertExactKeys(
      repo.canary,
      [
        "pull_number",
        "head_sha",
        "base_sha",
        "test_merge_sha",
        "v2_check_run_id",
        "v2_run_id",
        "v2_job_id",
        "v2_workflow_id",
        "v2_run_attempt",
        "legacy_status_id",
      ],
      `${label}.canary`,
    );
    assertPositiveInteger(repo.canary.pull_number, `${label}.canary.pull_number`);
    assertHex(repo.canary.head_sha, 40, `${label}.canary.head_sha`);
    assertHex(repo.canary.base_sha, 40, `${label}.canary.base_sha`);
    assertHex(repo.canary.test_merge_sha, 40, `${label}.canary.test_merge_sha`);
    assertPositiveInteger(repo.canary.v2_check_run_id, `${label}.canary.v2_check_run_id`);
    assertPositiveInteger(
      repo.canary.v2_run_id,
      `${label}.canary.v2_run_id`,
    );
    assertPositiveInteger(repo.canary.v2_job_id, `${label}.canary.v2_job_id`);
    assertPositiveInteger(
      repo.canary.v2_workflow_id,
      `${label}.canary.v2_workflow_id`,
    );
    assertPositiveInteger(
      repo.canary.v2_run_attempt,
      `${label}.canary.v2_run_attempt`,
    );
    assertPositiveInteger(
      repo.canary.legacy_status_id,
      `${label}.canary.legacy_status_id`,
    );

    if (!Array.isArray(repo.legacy_cleanup)) {
      throw new Error(`${label}.legacy_cleanup must be an array.`);
    }
    for (const action of repo.legacy_cleanup) {
      validateCleanupAction(action, repo, index);
      const target =
        action.surface === "repository_ruleset"
          ? `${repo.slug}:ruleset:${action.ruleset_id}`
          : `${repo.slug}:classic:${repo.default_branch}`;
      if (seenCleanupTargets.has(target)) {
        throw new Error(`Duplicate legacy cleanup target: ${target}.`);
      }
      seenCleanupTargets.add(target);
      cleanupCount += 1;
    }
  }

  assertPositiveInteger(
    input.expected_legacy_cleanup_action_count,
    "manifest.expected_legacy_cleanup_action_count",
  );
  if (cleanupCount !== input.expected_legacy_cleanup_action_count) {
    throw new Error(
      "manifest.expected_legacy_cleanup_action_count does not match the listed actions.",
    );
  }
  if (schedulerQuiescenceCount !== 1) {
    throw new Error(
      `manifest must bind exactly one activation scheduler quiescence target in ${ACTIVATION_SCHEDULER_REPOSITORY}.`,
    );
  }
  assertActivationCoverageBudgetTopology(input);
  const legacyOnlyRepository = input.legacy_ruleset.legacy_only_repository;
  if (
    seenIds.has(legacyOnlyRepository.id) ||
    seenSlugs.has(legacyOnlyRepository.slug.toLowerCase()) ||
    seenNodeIds.has(legacyOnlyRepository.node_id)
  ) {
    throw new Error(
      "manifest.legacy_ruleset.legacy_only_repository must not overlap an active manifest repository identity.",
    );
  }
  assertLegacyOrganizationRulesetPolicy(
    input.legacy_ruleset.expected_before,
    input.repositories.map((repo) => repo.id),
    legacyOnlyRepository,
    "manifest.legacy_ruleset.expected_before",
  );
  buildV2OrganizationRulesetPayload(input, "disabled");
  deriveLegacyOrganizationCutoverPayload(input);
  assertJsonData(input, "manifest");
  return cloneJson(input);
}

export function buildV2OrganizationRulesetPayload(manifest, enforcement = "disabled") {
  if (!new Set(["disabled", "active"]).has(enforcement)) {
    throw new Error("v2 organization ruleset enforcement must be disabled or active.");
  }
  const legacy = manifest.legacy_ruleset.expected_before;
  return {
    name: V2_RULESET_NAME,
    target: "branch",
    enforcement,
    bypass_actors: [],
    conditions: {
      ref_name: cloneJson(legacy.conditions.ref_name),
      repository_id: {
        repository_ids: manifest.repositories.map((repository) => repository.id),
      },
    },
    rules: [
      {
        type: "required_status_checks",
        parameters: {
          required_status_checks: [
            {
              context: V2_STATUS_CONTEXT,
              integration_id: GITHUB_ACTIONS_INTEGRATION_ID,
            },
          ],
          strict_required_status_checks_policy: true,
          do_not_enforce_on_create: true,
        },
      },
    ],
  };
}

export function deriveLegacyOrganizationCutoverPayload(manifest) {
  const before = cloneJson(manifest.legacy_ruleset.expected_before);
  const statusIndexes = before.rules.flatMap((rule, index) =>
    rule.type === "required_status_checks" ? [index] : [],
  );
  if (statusIndexes.length !== 1) {
    throw new Error(
      "Legacy organization ruleset must contain exactly one required_status_checks rule before cutover.",
    );
  }
  before.rules = before.rules.filter((_, index) => index !== statusIndexes[0]);
  if (before.rules.some((rule) => rule.type === "required_status_checks")) {
    throw new Error("Legacy organization cutover failed to remove the whole status rule.");
  }
  return before;
}

function deriveRulesetLegacyRemoval(before) {
  let removed = 0;
  const after = cloneJson(before);
  after.rules = after.rules.flatMap((rule) => {
    if (rule.type !== "required_status_checks") {
      return [rule];
    }
    const checks = statusChecks(rule, "legacy cleanup required_status_checks");
    const keptChecks = checks.filter((check) => {
      if (check.context === LEGACY_STATUS_CONTEXT) {
        removed += 1;
        return false;
      }
      return true;
    });
    if (keptChecks.length === 0) {
      return [];
    }
    const keptRule = cloneJson(rule);
    keptRule.parameters.required_status_checks = keptChecks;
    return [keptRule];
  });
  if (removed === 0) {
    throw new Error("Repository ruleset cleanup source contains no legacy context.");
  }
  return after;
}

function deriveClassicLegacyRemoval(before) {
  const after = cloneJson(before);
  let removed = 0;
  after.contexts = after.contexts.filter((context) => {
    if (context === LEGACY_STATUS_CONTEXT) {
      removed += 1;
      return false;
    }
    return true;
  });
  after.checks = after.checks.filter((check) => {
    if (check.context === LEGACY_STATUS_CONTEXT) {
      removed += 1;
      return false;
    }
    return true;
  });
  if (removed === 0) {
    throw new Error("Classic protection cleanup source contains no legacy context.");
  }
  return after;
}

export function deriveRepositoryCleanupAction(action) {
  let derived;
  if (action.surface === "repository_ruleset") {
    assertWritableRuleset(
      action.expected_before,
      "Repository cleanup expected_before",
    );
    if (action.expected_after !== null) {
      assertWritableRuleset(
        action.expected_after,
        "Repository cleanup expected_after",
      );
    }
    derived = deriveRulesetLegacyRemoval(action.expected_before);
    const canDelete = derived.rules.length === 0;
    if (action.operation === "delete") {
      if (!canDelete || action.expected_after !== null) {
        throw new Error(
          "Repository ruleset delete cleanup is valid only for a now-empty ruleset with null expected_after.",
        );
      }
      return { operation: "delete", expected_after: null };
    }
  } else if (action.surface === "classic_required_status_checks") {
    assertClassicStatusSnapshot(
      action.expected_before,
      "Classic cleanup expected_before",
    );
    if (action.expected_after !== null) {
      assertClassicStatusSnapshot(
        action.expected_after,
        "Classic cleanup expected_after",
      );
    }
    derived = deriveClassicLegacyRemoval(action.expected_before);
    const canDelete = derived.contexts.length === 0 && derived.checks.length === 0;
    if (action.operation === "delete") {
      if (!canDelete || action.expected_after !== null) {
        throw new Error(
          "Classic protection delete cleanup is valid only when no status requirement remains and expected_after is null.",
        );
      }
      return { operation: "delete", expected_after: null };
    }
  } else {
    throw new Error("Unsupported repository cleanup surface.");
  }
  if (action.operation !== "update" || action.expected_after === null) {
    throw new Error("Cleanup update requires a complete expected_after snapshot.");
  }
  if (canonicalJson(derived) !== canonicalJson(action.expected_after)) {
    throw new Error(
      "Cleanup expected_after is not the exact source snapshot with only legacy status entries removed.",
    );
  }
  return { operation: "update", expected_after: cloneJson(derived) };
}

function disclosedBypassActorsFromApi(value, label) {
  // GitHub intentionally redacts this property from a ruleset-detail response
  // when the calling identity cannot write that ruleset. A receipt must prove
  // the absence of bypass actors, so neither an omitted property nor a
  // malformed visible value can be interpreted as an empty list.
  if (!Object.hasOwn(value, "bypass_actors")) {
    throw new Error(
      `${label} cannot prove its bypass policy because GitHub omitted bypass_actors; rerun with an identity that has write access to this ruleset.`,
    );
  }
  if (!Array.isArray(value.bypass_actors)) {
    throw new Error(
      `${label} returned a malformed bypass_actors value; rerun with an identity that has write access to this ruleset and require an explicit array.`,
    );
  }
  return cloneJson(value.bypass_actors);
}

function writableRulesetFromApi(value, expectedSourceType, expectedSource, label) {
  assertPlainObject(value, label);
  assertJsonData(value, label);
  assertPositiveInteger(value.id, `${label}.id`);
  assertNonEmptyString(value.source_type, `${label}.source_type`);
  assertNonEmptyString(value.source, `${label}.source`);
  if (value.source_type !== expectedSourceType || value.source !== expectedSource) {
    throw new Error(`${label} source identity does not match the manifest.`);
  }
  const writable = {
    name: value.name,
    target: value.target,
    enforcement: value.enforcement,
    bypass_actors: disclosedBypassActorsFromApi(value, label),
    conditions: cloneJson(value.conditions),
    rules: cloneJson(value.rules),
  };
  assertWritableRuleset(writable, `${label}.writable`);
  return {
    id: value.id,
    source_type: value.source_type,
    source: value.source,
    writable,
  };
}

function assertExactSnapshot(actual, expected, label) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(
      `${label} drifted from the manifest-bound snapshot (expected ${sha256Canonical(expected)}, got ${sha256Canonical(actual)}).`,
    );
  }
}

function compareCanonicalJsonUtf8(left, right) {
  return Buffer.compare(
    Buffer.from(canonicalJson(left), "utf8"),
    Buffer.from(canonicalJson(right), "utf8"),
  );
}

function normalizeRepositoryCleanupRulesetSnapshot(ruleset, label) {
  assertWritableRuleset(ruleset, label);
  const normalized = cloneJson(ruleset);
  const statusRules = requiredStatusRules(normalized);
  if (statusRules.length === 1) {
    const [statusRule] = statusRules;
    const checks = statusChecks(statusRule, `${label}.required_status_checks`);
    // Live GitHub readback has been observed to reorder these two policy
    // collections. Their order has no policy meaning; protect the complete
    // multiset of full elements, normalize only this observed behavior, and
    // never deduplicate.
    statusRule.parameters.required_status_checks = [...checks].sort(
      compareCanonicalJsonUtf8,
    );
  }
  normalized.rules.sort(compareCanonicalJsonUtf8);
  return normalized;
}

function repositoryCleanupRulesetSnapshotsEqual(actual, expected, label) {
  if (actual === null || expected === null) {
    return canonicalJson(actual) === canonicalJson(expected);
  }
  return (
    canonicalJson(
      normalizeRepositoryCleanupRulesetSnapshot(actual, `${label} actual`),
    ) ===
    canonicalJson(
      normalizeRepositoryCleanupRulesetSnapshot(expected, `${label} expected`),
    )
  );
}

function cleanupSurfaceSnapshotsEqual(action, actual, expected, label) {
  if (action.surface === "repository_ruleset") {
    return repositoryCleanupRulesetSnapshotsEqual(actual, expected, label);
  }
  return canonicalJson(actual) === canonicalJson(expected);
}

function normalizeOrganizationRulesetSelectorSnapshot(ruleset, label) {
  assertWritableRuleset(ruleset, label);
  const normalized = cloneJson(ruleset);
  assertExactKeys(
    normalized.conditions,
    ["ref_name", "repository_id"],
    `${label}.conditions`,
  );
  assertExactKeys(
    normalized.conditions.repository_id,
    ["repository_ids"],
    `${label}.conditions.repository_id`,
  );
  const repositoryIds = normalized.conditions.repository_id.repository_ids;
  if (
    !Array.isArray(repositoryIds) ||
    repositoryIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
  ) {
    throw new Error(`${label}.conditions.repository_id.repository_ids is malformed.`);
  }
  // GitHub reads organization selector IDs in its own numeric order. The
  // protected property here is selector membership including multiplicity:
  // normalize only this one unordered API field, leaving every other policy
  // field and every other array order exact. In particular, do not dedupe.
  normalized.conditions.repository_id.repository_ids = [...repositoryIds].sort(
    (left, right) => left - right,
  );
  return normalized;
}

function organizationRulesetSnapshotsEqual(actual, expected, label) {
  return (
    canonicalJson(
      normalizeOrganizationRulesetSelectorSnapshot(actual, `${label} actual`),
    ) ===
    canonicalJson(
      normalizeOrganizationRulesetSelectorSnapshot(expected, `${label} expected`),
    )
  );
}

function assertExactOrganizationRulesetSnapshot(actual, expected, label) {
  if (!organizationRulesetSnapshotsEqual(actual, expected, label)) {
    throw new Error(
      `${label} drifted from the manifest-bound snapshot (expected ${sha256Canonical(expected)}, got ${sha256Canonical(actual)}).`,
    );
  }
}

function encodeEndpointPath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}

function organizationRulesetEndpoint(manifest, id) {
  return `orgs/${encodeURIComponent(manifest.organization.login)}/rulesets/${id}`;
}

function repositoryRulesetEndpoint(repo, id) {
  return `repos/${encodeEndpointPath(repo.slug)}/rulesets/${id}?includes_parents=false`;
}

function repositoryRulesetMutationEndpoint(repo, id) {
  return `repos/${encodeEndpointPath(repo.slug)}/rulesets/${id}`;
}

function classicStatusEndpoint(repo) {
  return `repos/${encodeEndpointPath(repo.slug)}/branches/${encodeURIComponent(repo.default_branch)}/protection/required_status_checks`;
}

async function loadOrganizationIdentity(manifest) {
  const response = await ghJson(`orgs/${encodeURIComponent(manifest.organization.login)}`);
  assertPlainObject(response, "Organization API response");
  const identity = {
    login: response.login,
    id: response.id,
    node_id: response.node_id,
  };
  assertExactSnapshot(identity, manifest.organization, "Organization identity");
  return identity;
}

async function loadLegacyOnlyRepositoryIdentity(manifest, label) {
  const repository = manifest.legacy_ruleset.legacy_only_repository;
  const response = await ghJson(`repos/${encodeEndpointPath(repository.slug)}`);
  assertPlainObject(response, `${label} API response`);
  const identity = {
    full_name: response.full_name,
    id: response.id,
    node_id: response.node_id,
    default_branch: response.default_branch,
    archived: response.archived,
  };
  // Protected property: this read binds the retained selector entry to the
  // exact archived repository object and its default-branch selector.
  // id/node_id bind object identity, full_name detects rename, transfer, or
  // same-slug reuse, default_branch binds the selector, and archived proves
  // the exception remains the deliberate archived-only repository. Unrelated
  // metadata churn is intentionally not treated as a policy change.
  assertExactSnapshot(
    identity,
    {
      full_name: repository.slug,
      id: repository.id,
      node_id: repository.node_id,
      default_branch: repository.default_branch,
      archived: repository.archived,
    },
    label,
  );
  return identity;
}

async function loadOrganizationRuleset(manifest, id, label) {
  const response = await ghJson(organizationRulesetEndpoint(manifest, id));
  const complete = writableRulesetFromApi(
    response,
    "Organization",
    manifest.organization.login,
    label,
  );
  if (complete.id !== id) {
    throw new Error(`${label} returned the wrong ruleset ID.`);
  }
  return complete;
}

async function loadOrganizationRulesetSummaries(manifest) {
  const response = await ghJson(
    `orgs/${encodeURIComponent(manifest.organization.login)}/rulesets?per_page=100`,
    { paginate: true },
  );
  if (!Array.isArray(response) || response.some((page) => !Array.isArray(page))) {
    throw new Error("Organization ruleset inventory pagination response is malformed.");
  }
  const summaries = response.flat();
  for (const [index, summary] of summaries.entries()) {
    assertPlainObject(summary, `Organization ruleset summary ${index}`);
    assertPositiveInteger(summary.id, `Organization ruleset summary ${index}.id`);
    assertNonEmptyString(summary.name, `Organization ruleset summary ${index}.name`);
    assertNonEmptyString(
      summary.source_type,
      `Organization ruleset summary ${index}.source_type`,
    );
    assertNonEmptyString(summary.source, `Organization ruleset summary ${index}.source`);
    assertNonEmptyString(
      summary.enforcement,
      `Organization ruleset summary ${index}.enforcement`,
    );
  }
  const ids = summaries.map((summary) => summary.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Organization ruleset inventory contains duplicate IDs.");
  }
  return summaries
    .map((summary) => ({
      id: summary.id,
      name: summary.name,
      source_type: summary.source_type,
      source: summary.source,
      enforcement: summary.enforcement,
    }))
    .sort((left, right) => left.id - right.id);
}

function classifyLegacyOrganizationRuleset(manifest, complete) {
  const before = manifest.legacy_ruleset.expected_before;
  const after = deriveLegacyOrganizationCutoverPayload(manifest);
  if (
    organizationRulesetSnapshotsEqual(
      complete.writable,
      before,
      "Legacy organization ruleset before snapshot",
    )
  ) {
    return "before";
  }
  if (
    organizationRulesetSnapshotsEqual(
      complete.writable,
      after,
      "Legacy organization ruleset after snapshot",
    )
  ) {
    return "after";
  }
  throw new Error("Legacy organization ruleset does not match either authorized snapshot.");
}

function classifyV2OrganizationRuleset(manifest, complete) {
  const disabled = buildV2OrganizationRulesetPayload(manifest, "disabled");
  const active = buildV2OrganizationRulesetPayload(manifest, "active");
  if (
    organizationRulesetSnapshotsEqual(
      complete.writable,
      disabled,
      "Disabled v2 organization ruleset snapshot",
    )
  ) {
    return "disabled";
  }
  if (
    organizationRulesetSnapshotsEqual(
      complete.writable,
      active,
      "Active v2 organization ruleset snapshot",
    )
  ) {
    return "active";
  }
  throw new Error("v2 organization ruleset does not match an authorized exact state.");
}

async function loadOrganizationRound(
  manifest,
  { allowUnboundV2 = false } = {},
) {
  const [organization, legacy, summaries] = await Promise.all([
    loadOrganizationIdentity(manifest),
    loadOrganizationRuleset(manifest, manifest.legacy_ruleset.id, "Legacy organization ruleset"),
    loadOrganizationRulesetSummaries(manifest),
  ]);
  const legacyMatches = summaries.filter(
    (summary) => summary.id === manifest.legacy_ruleset.id,
  );
  if (
    legacyMatches.length !== 1 ||
    legacyMatches[0].name !== legacy.writable.name ||
    legacyMatches[0].source_type !== "Organization" ||
    legacyMatches[0].source !== manifest.organization.login
  ) {
    throw new Error("Legacy organization ruleset inventory identity is missing or ambiguous.");
  }
  const namedV2 = summaries.filter((summary) => summary.name === V2_RULESET_NAME);
  let v2 = null;
  if (manifest.v2_ruleset.id === null) {
    if (namedV2.length !== 0 && !allowUnboundV2) {
      throw new Error(
        "A v2 organization ruleset exists but manifest.v2_ruleset.id is null; use stage --recover-created-v2 only after an ambiguous stage creation, or bind its exact ID after verified recovery.",
      );
    }
    if (allowUnboundV2 && namedV2.length !== 0) {
      if (
        namedV2.length !== 1 ||
        namedV2[0].source_type !== "Organization" ||
        namedV2[0].source !== manifest.organization.login ||
        namedV2[0].id === manifest.legacy_ruleset.id
      ) {
        throw new Error(
          "Ambiguous or foreign v2 organization ruleset candidate cannot be recovered automatically.",
        );
      }
      v2 = await loadOrganizationRuleset(
        manifest,
        namedV2[0].id,
        "Recoverable v2 organization ruleset",
      );
    }
  } else {
    if (
      namedV2.length !== 1 ||
      namedV2[0].id !== manifest.v2_ruleset.id ||
      namedV2[0].source_type !== "Organization" ||
      namedV2[0].source !== manifest.organization.login
    ) {
      throw new Error("v2 organization ruleset inventory identity is missing or ambiguous.");
    }
    v2 = await loadOrganizationRuleset(
      manifest,
      manifest.v2_ruleset.id,
      "v2 organization ruleset",
    );
  }
  return {
    organization,
    legacy,
    legacy_state: classifyLegacyOrganizationRuleset(manifest, legacy),
    v2,
    v2_state: v2 === null ? "absent" : classifyV2OrganizationRuleset(manifest, v2),
    summaries,
  };
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function assertDeadlineConfiguration(deadlineAt, deadlineLabel) {
  if (
    !Number.isFinite(deadlineAt) ||
    typeof deadlineLabel !== "string" ||
    deadlineLabel === ""
  ) {
    throw new Error("GitHub API deadline configuration is invalid.");
  }
}

function withGhDeadline(deadlineAt, deadlineLabel, callback) {
  assertDeadlineConfiguration(deadlineAt, deadlineLabel);
  if (typeof callback !== "function") {
    throw new Error("GitHub API deadline callback must be a function.");
  }
  const inherited = ghDeadlineContext.getStore();
  const effective =
    inherited === undefined || deadlineAt < inherited.deadlineAt
      ? { deadlineAt, deadlineLabel }
      : inherited;
  return ghDeadlineContext.run(effective, callback);
}

export async function loadStableSnapshots(
  label,
  loader,
  {
    sleep = delay,
    now = Date.now,
    intervalMs = 5_000,
    timeoutMs = 60_000,
  } = {},
) {
  if (
    typeof loader !== "function" ||
    typeof sleep !== "function" ||
    typeof now !== "function" ||
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < 0 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < intervalMs
  ) {
    throw new Error("Stable snapshot reader configuration is invalid.");
  }
  const startedAt = now();
  for (;;) {
    const first = await loader();
    await sleep(intervalMs);
    const second = await loader();
    const elapsed = now() - startedAt;
    if (canonicalJson(first) === canonicalJson(second) && elapsed <= timeoutMs) {
      return first;
    }
    if (elapsed >= timeoutMs) {
      throw new Error(
        `${label} remained unstable for ${timeoutMs}ms; the result is inconclusive and no next write is allowed.`,
      );
    }
  }
}

async function loadStable(label, loader, options = undefined) {
  return loadStableSnapshots(label, loader, options);
}

async function revalidateUnchangedBeforeMutation(label, plannedSnapshot, loader) {
  let latestSnapshot;
  try {
    latestSnapshot = await loader();
  } catch (error) {
    throw new Error(
      `${label} could not be revalidated immediately before mutation; no mutation was sent. ${error.message}`,
      { cause: error },
    );
  }
  if (canonicalJson(latestSnapshot) !== canonicalJson(plannedSnapshot)) {
    throw new Error(
      `${label} changed after the stable plan snapshot; no mutation was sent (planned ${sha256Canonical(plannedSnapshot)}, latest ${sha256Canonical(latestSnapshot)}).`,
    );
  }
  return latestSnapshot;
}

async function revalidateLegacyOrganizationRuleImmediatelyBeforeCutover(
  manifest,
  plannedSnapshot,
) {
  let latestLegacy;
  try {
    latestLegacy = await loadOrganizationRuleset(
      manifest,
      manifest.legacy_ruleset.id,
      "Final legacy organization ruleset pre-write read",
    );
  } catch (error) {
    throw new Error(
      `The legacy organization ruleset could not be read immediately before cutover; no mutation was sent. ${error.message}`,
      { cause: error },
    );
  }
  if (
    canonicalJson(latestLegacy) !==
    canonicalJson(plannedSnapshot.organization.legacy)
  ) {
    throw new Error(
      `The legacy organization ruleset changed after full-cohort revalidation; no mutation was sent (planned ${sha256Canonical(plannedSnapshot.organization.legacy)}, latest ${sha256Canonical(latestLegacy)}).`,
    );
  }
  return latestLegacy;
}

async function revalidateLegacyOnlyRepositoryImmediatelyBeforeCutover(
  manifest,
  plannedSnapshot,
) {
  let latestIdentity;
  try {
    latestIdentity = await loadLegacyOnlyRepositoryIdentity(
      manifest,
      "Final legacy-only archived repository pre-write read",
    );
  } catch (error) {
    throw new Error(
      `The legacy-only archived repository could not be read immediately before cutover; no mutation was sent. ${error.message}`,
      { cause: error },
    );
  }
  if (
    canonicalJson(latestIdentity) !==
    canonicalJson(plannedSnapshot.legacy_only_repository)
  ) {
    throw new Error(
      `The legacy-only archived repository changed after full-cohort revalidation; no mutation was sent (planned ${sha256Canonical(plannedSnapshot.legacy_only_repository)}, latest ${sha256Canonical(latestIdentity)}).`,
    );
  }
  return latestIdentity;
}

async function revalidateActivationSchedulerImmediatelyBeforeCutover(
  manifest,
  plannedSnapshot,
  runtime,
) {
  let latestScheduler;
  try {
    latestScheduler = await loadRestoredActivationSchedulerSnapshot(
      manifest,
      runtime,
    );
  } catch (error) {
    throw new Error(
      `The manifest-bound activation scheduler could not be read as active immediately before cutover; no mutation was sent. ${error.message}`,
      { cause: error },
    );
  }
  if (
    canonicalJson(latestScheduler) !==
    canonicalJson(plannedSnapshot.activation_scheduler)
  ) {
    throw new Error(
      `The manifest-bound activation scheduler changed after full-cohort revalidation; no mutation was sent (planned ${sha256Canonical(plannedSnapshot.activation_scheduler)}, latest ${sha256Canonical(latestScheduler)}).`,
    );
  }
  return latestScheduler;
}

function assertState(actual, allowed, label) {
  if (!allowed.includes(actual)) {
    throw new Error(`${label} must be ${allowed.join(" or ")}; observed ${actual}.`);
  }
}

function decodeBase64Content(response, label) {
  if (
    response.encoding !== "base64" ||
    typeof response.content !== "string" ||
    response.content === ""
  ) {
    throw new Error(`${label} must return non-empty base64 content.`);
  }
  const compact = response.content.replace(/\r?\n/gu, "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(compact)) {
    throw new Error(`${label} returned malformed base64 content.`);
  }
  return Buffer.from(compact, "base64");
}

async function loadContentEvidence(repo, expected, label, revision) {
  assertHex(revision, 40, `${repo.slug} ${label} revision`);
  const endpoint = `repos/${encodeEndpointPath(repo.slug)}/contents/${encodeEndpointPath(expected.path)}?ref=${encodeURIComponent(revision)}`;
  const response = await ghJson(endpoint);
  assertPlainObject(response, `${repo.slug} ${label} content response`);
  if (response.type !== "file" || response.path !== expected.path) {
    throw new Error(`${repo.slug} ${label} path/type does not match the manifest.`);
  }
  assertHex(response.sha, 40, `${repo.slug} ${label} blob SHA`);
  const bytes = decodeBase64Content(response, `${repo.slug} ${label}`);
  const evidence = {
    path: response.path,
    git_blob_sha: response.sha,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  assertExactSnapshot(
    evidence,
    {
      path: expected.path,
      git_blob_sha: expected.git_blob_sha,
      sha256: expected.sha256,
    },
    `${repo.slug} ${label}`,
  );
  return { evidence, bytes };
}

async function loadCompleteGitTree(repo, treeRef, label) {
  const response = await ghJson(
    `repos/${encodeEndpointPath(repo.slug)}/git/trees/${encodeURIComponent(treeRef)}`,
  );
  if (response?.truncated !== false || !Array.isArray(response.tree)) {
    throw new Error(
      `${repo.slug} ${label} Git tree is truncated or malformed; workflow inventory is inconclusive.`,
    );
  }
  const paths = [];
  for (const [index, entry] of response.tree.entries()) {
    assertPlainObject(entry, `${repo.slug} ${label} Git tree entry ${index}`);
    assertNonEmptyString(entry.path, `${repo.slug} ${label} Git tree entry ${index}.path`);
    assertHex(entry.sha, 40, `${repo.slug} ${label} Git tree entry ${index}.sha`);
    assertNonEmptyString(entry.type, `${repo.slug} ${label} Git tree entry ${index}.type`);
    assertNonEmptyString(entry.mode, `${repo.slug} ${label} Git tree entry ${index}.mode`);
    paths.push(entry.path);
  }
  if (new Set(paths).size !== paths.length) {
    throw new Error(`${repo.slug} ${label} Git tree contains duplicate paths.`);
  }
  return response.tree;
}

function findUniqueGitTreeEntry(tree, path, label) {
  const matches = tree.filter((entry) => entry.path === path);
  if (matches.length > 1) {
    throw new Error(`${label} Git tree contains duplicate ${path} entries.`);
  }
  return matches[0] ?? null;
}

function assertGitTreeDirectory(entry, path, repo) {
  if (entry === null || entry.type !== "tree" || entry.mode !== "040000") {
    throw new Error(
      `${repo.slug} ${path} is not one exact Git tree; workflow inventory is inconclusive.`,
    );
  }
}

async function loadWorkflowInventoryEvidence(repo, revision) {
  assertHex(revision, 40, `${repo.slug} workflow inventory revision`);
  const rootTree = await loadCompleteGitTree(
    repo,
    revision,
    "default-branch root",
  );
  const githubEntry = findUniqueGitTreeEntry(
    rootTree,
    ".github",
    `${repo.slug} default-branch root`,
  );
  assertGitTreeDirectory(githubEntry, ".github", repo);
  const githubTree = await loadCompleteGitTree(repo, githubEntry.sha, ".github");
  const workflowsEntry = findUniqueGitTreeEntry(
    githubTree,
    "workflows",
    `${repo.slug} .github`,
  );
  assertGitTreeDirectory(workflowsEntry, ".github/workflows", repo);
  const workflowsTree = await loadCompleteGitTree(
    repo,
    workflowsEntry.sha,
    ".github/workflows",
  );
  for (const entry of workflowsTree) {
    if (entry.type !== "blob" || !new Set(["100644", "100755"]).has(entry.mode)) {
      throw new Error(
        `${repo.slug} .github/workflows/${entry.path} is an unsupported non-regular entry; workflow inventory is inconclusive.`,
      );
    }
  }
  const workflowEntries = workflowsTree.filter((entry) => /\.ya?ml$/u.test(entry.path));
  if (workflowEntries.length > MAX_WORKFLOW_INVENTORY_YAML_FILES) {
    throw new Error(
      `${repo.slug} .github/workflows inventory exceeds the ${MAX_WORKFLOW_INVENTORY_YAML_FILES}-YAML capacity bound; workflow evidence is inconclusive.`,
    );
  }
  const workflowFiles = await Promise.all(
    workflowEntries.map(async (entry) => {
      const blob = await ghJson(
        `repos/${encodeEndpointPath(repo.slug)}/git/blobs/${encodeURIComponent(entry.sha)}`,
      );
      const content = decodeGitHubBlobContent(blob);
      return {
        path: `.github/workflows/${entry.path}`,
        mode: entry.mode,
        git_blob_sha: entry.sha,
        sha256: createHash("sha256").update(content, "utf8").digest("hex"),
        content,
      };
    }),
  );
  const canonicalWorkflows = {};
  const canonicalEvidence = {};
  for (const key of WORKFLOW_KEYS) {
    const expected = repo.workflows[key];
    const matches = workflowFiles.filter((file) => file.path === expected.path);
    if (matches.length !== 1) {
      throw new Error(
        `${repo.slug} ${expected.path} must occur exactly once in the complete default-branch workflow inventory.`,
      );
    }
    const file = matches[0];
    const evidence = {
      path: file.path,
      git_blob_sha: file.git_blob_sha,
      sha256: file.sha256,
    };
    assertExactSnapshot(evidence, expected, `${repo.slug} ${key} workflow`);
    canonicalEvidence[key] = evidence;
    canonicalWorkflows[key === "legacy_bridge" ? "legacyBridge" : key] = file.content;
  }
  try {
    validateFrozenHandoffV2WorkflowInventory(
      workflowFiles,
      canonicalWorkflows,
      { legacyBridge: true },
    );
  } catch (error) {
    throw new Error(
      `${repo.slug} default-branch workflow inventory is not closed: ${error.message}`,
      { cause: error },
    );
  }
  let schedulerQuiescence = null;
  if (repo.scheduler_quiescence !== null) {
    const expected = repo.scheduler_quiescence.workflow;
    const matches = workflowFiles.filter((file) => file.path === expected.path);
    if (matches.length !== 1) {
      throw new Error(
        `${repo.slug} activation scheduler workflow must occur exactly once in the complete default-branch workflow inventory.`,
      );
    }
    const file = matches[0];
    schedulerQuiescence = {
      path: file.path,
      git_blob_sha: file.git_blob_sha,
      sha256: file.sha256,
    };
    assertExactSnapshot(
      schedulerQuiescence,
      expected,
      `${repo.slug} activation scheduler workflow`,
    );
  }
  return {
    canonical: canonicalEvidence,
    scheduler_quiescence: schedulerQuiescence,
    inventory: workflowFiles
      .map(({ path, mode, git_blob_sha, sha256 }) => ({
        path,
        mode,
        git_blob_sha,
        sha256,
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
}

function validateCodeownersControlPlane(bytes, ownerLogin, label) {
  const content = bytes.toString("utf8");
  if (!Buffer.from(content, "utf8").equals(bytes) || content.includes("\0")) {
    throw new Error(`${label} must be non-NUL UTF-8 text.`);
  }
  if (bytes.length >= 3 * 1024 * 1024) {
    throw new Error(`${label} must remain below GitHub's 3 MB limit.`);
  }
  const lines = content.split(/\r?\n/u);
  const begin = lines.flatMap((line, index) =>
    line === CONTROL_PLANE_CODEOWNERS_BEGIN ? [index] : [],
  );
  const end = lines.flatMap((line, index) =>
    line === CONTROL_PLANE_CODEOWNERS_END ? [index] : [],
  );
  const expectedWorkflowRule = `/.github/workflows/ @${ownerLogin}`;
  const expectedCodeownersRule = `/.github/CODEOWNERS @${ownerLogin}`;
  const effectiveRules = lines
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  if (
    begin.length !== 1 ||
    end.length !== 1 ||
    end[0] !== begin[0] + 3 ||
    end[0] !== lines.length - 2 ||
    lines[begin[0] + 1] !== expectedWorkflowRule ||
    lines[begin[0] + 2] !== expectedCodeownersRule ||
    effectiveRules.at(-2) !== expectedWorkflowRule ||
    effectiveRules.at(-1) !== expectedCodeownersRule
  ) {
    throw new Error(
      `${label} must end with exact, non-overridable workflow and CODEOWNERS ownership for @${ownerLogin}.`,
    );
  }
}

async function loadCodeownersEvidence(repo, revision) {
  const loaded = await loadContentEvidence(
    repo,
    repo.codeowners,
    "CODEOWNERS control plane",
    revision,
  );
  validateCodeownersControlPlane(
    loaded.bytes,
    repo.codeowners.owner.login,
    `${repo.slug} CODEOWNERS`,
  );
  const permission = await ghJson(
    `repos/${encodeEndpointPath(repo.slug)}/collaborators/${encodeURIComponent(repo.codeowners.owner.login)}/permission`,
  );
  assertPlainObject(permission, `${repo.slug} control-plane owner permission`);
  const ownerIdentity = {
    login: permission.user?.login,
    id: permission.user?.id,
    node_id: permission.user?.node_id,
  };
  if (
    typeof ownerIdentity.login !== "string" ||
    ownerIdentity.login.toLowerCase() !==
      repo.codeowners.owner.login.toLowerCase() ||
    ownerIdentity.id !== repo.codeowners.owner.id ||
    ownerIdentity.node_id !== repo.codeowners.owner.node_id ||
    permission.user?.type !== "User" ||
    !["write", "maintain", "admin"].includes(permission.permission)
  ) {
    throw new Error(
      `${repo.slug} CODEOWNERS owner identity or write/maintain/admin permission drifted.`,
    );
  }
  return {
    ...loaded.evidence,
    owner: cloneJson(repo.codeowners.owner),
    permission: permission.permission,
  };
}

async function loadActionsWorkflowPermissions(repo) {
  const response = await ghJson(
    `repos/${encodeEndpointPath(repo.slug)}/actions/permissions/workflow`,
  );
  const projection = {
    default_workflow_permissions: response?.default_workflow_permissions,
    can_approve_pull_request_reviews:
      response?.can_approve_pull_request_reviews,
  };
  if (
    projection.default_workflow_permissions !== "read" ||
    typeof projection.can_approve_pull_request_reviews !== "boolean"
  ) {
    throw new Error(
      `${repo.slug} must expose a complete Actions workflow-permission policy with default permissions set to read.`,
    );
  }
  return projection;
}

async function loadRepositoryRuleset(repo) {
  const response = await ghJson(repositoryRulesetEndpoint(repo, repo.v2_ruleset.id));
  const complete = writableRulesetFromApi(
    response,
    "Repository",
    repo.slug,
    `${repo.slug} v2 repository ruleset`,
  );
  if (complete.id !== repo.v2_ruleset.id) {
    throw new Error(`${repo.slug} v2 repository ruleset returned the wrong ID.`);
  }
  assertExactSnapshot(
    complete.writable,
    repo.v2_ruleset.expected,
    `${repo.slug} v2 repository ruleset`,
  );
  return complete;
}

export function validateDefaultBranchResponse(
  response,
  repo,
  { requireCanaryBase = true } = {},
) {
  const projection = {
    name: response?.name,
    head_sha: response?.commit?.sha,
  };
  if (
    projection.name !== repo.default_branch ||
    (requireCanaryBase && projection.head_sha !== repo.canary.base_sha)
  ) {
    throw new Error(
      requireCanaryBase
        ? `${repo.slug} default branch no longer matches the manifest-bound canary base.`
        : `${repo.slug} default branch response does not identify the manifest-bound default branch.`,
    );
  }
  assertHex(projection.head_sha, 40, `${repo.slug} default branch head SHA`);
  return projection;
}

async function loadDefaultBranchHead(repo, { requireCanaryBase = true } = {}) {
  const response = await ghJson(
    `repos/${encodeEndpointPath(repo.slug)}/branches/${encodeURIComponent(repo.default_branch)}`,
  );
  return validateDefaultBranchResponse(response, repo, { requireCanaryBase });
}

async function loadCanaryPull(repo) {
  const [owner, name] = repo.slug.split("/");
  const response = await ghJson("graphql", {
    method: "POST",
    body: {
      query: CANARY_PULL_QUERY,
      variables: { owner, name, number: repo.canary.pull_number },
    },
  });
  const projection = validateCanaryPullGraphqlResponse(response, repo);
  const pages = await ghJson(
    `repos/${encodeEndpointPath(repo.slug)}/pulls/${repo.canary.pull_number}/files?per_page=100`,
    { paginate: true },
  );
  const expectedPages = Math.max(1, Math.ceil(projection.changed_files / 100));
  if (
    !Array.isArray(pages) ||
    pages.length !== expectedPages ||
    pages.some((page, pageIndex) => {
      const expectedSize = Math.min(
        100,
        Math.max(0, projection.changed_files - pageIndex * 100),
      );
      return !Array.isArray(page) || page.length !== expectedSize;
    })
  ) {
    throw new Error(`${repo.slug} canary changed-file inventory is incomplete.`);
  }
  const files = pages.flat();
  const seenFiles = new Set();
  for (const [index, file] of files.entries()) {
    assertPlainObject(file, `${repo.slug} canary file ${index}`);
    assertNonEmptyString(file.filename, `${repo.slug} canary file ${index}.filename`);
    if (seenFiles.has(file.filename)) {
      throw new Error(`${repo.slug} canary file inventory contains duplicates.`);
    }
    seenFiles.add(file.filename);
    const paths = [file.filename];
    if (Object.hasOwn(file, "previous_filename")) {
      assertNonEmptyString(
        file.previous_filename,
        `${repo.slug} canary file ${index}.previous_filename`,
      );
      paths.push(file.previous_filename);
    }
    if (
      paths.some(
        (path) => path === CODEOWNERS_PATH || path.startsWith(".github/workflows/"),
      )
    ) {
      throw new Error(`${repo.slug} canary changes the protected control plane.`);
    }
  }
  projection.files = [...seenFiles].sort();
  return projection;
}

export function validateCanaryPullGraphqlResponse(response, repo) {
  const pull = response?.data?.repository?.pullRequest;
  assertPlainObject(pull, `${repo.slug} GraphQL canary pull request`);
  const projection = {
    number: pull.number,
    state: pull.state,
    merged: pull.merged,
    draft: pull.isDraft,
    mergeable: pull.mergeable,
    head_sha: pull.headRefOid,
    head_repository: pull.headRepository?.nameWithOwner,
    base_ref: pull.baseRefName,
    base_sha: pull.baseRefOid,
    base_repository: pull.baseRepository?.nameWithOwner,
    test_merge_sha: pull.potentialMergeCommit?.oid,
    changed_files: pull.changedFiles,
  };
  if (
    projection.number !== repo.canary.pull_number ||
    projection.state !== "OPEN" ||
    projection.merged !== false ||
    projection.draft !== false ||
    projection.mergeable !== "MERGEABLE" ||
    projection.head_sha !== repo.canary.head_sha ||
    projection.head_repository !== repo.slug ||
    projection.base_ref !== repo.default_branch ||
    projection.base_sha !== repo.canary.base_sha ||
    projection.base_repository !== repo.slug ||
    projection.test_merge_sha !== repo.canary.test_merge_sha ||
    !Number.isSafeInteger(projection.changed_files) ||
    projection.changed_files < 0 ||
    projection.changed_files > 3_000
  ) {
    throw new Error(
      `${repo.slug} canary must be the exact open, mergeable, non-draft, same-repository, current-base PR/head/test-merge.`,
    );
  }
  return projection;
}

function parseActionsJobDetailsUrl(value, repoSlug) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${repoSlug} v2 CheckRun details_url is not an absolute URL.`);
  }
  const prefix = `/${repoSlug}/actions/runs/`;
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    !url.pathname.startsWith(prefix)
  ) {
    throw new Error(`${repoSlug} v2 CheckRun details_url is not canonical.`);
  }
  const match = url.pathname
    .slice(prefix.length)
    .match(/^([1-9][0-9]*)\/job\/([1-9][0-9]*)$/u);
  if (match === null) {
    throw new Error(`${repoSlug} v2 CheckRun details_url lacks one run/job identity.`);
  }
  const runId = Number(match[1]);
  const jobId = Number(match[2]);
  assertPositiveInteger(runId, `${repoSlug} v2 run ID`);
  assertPositiveInteger(jobId, `${repoSlug} v2 job ID`);
  return { runId, jobId };
}

function parseCheckRunApiUrl(value, repoSlug) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${repoSlug} v2 job check_run_url is not an absolute URL.`);
  }
  const match = url.pathname.match(
    new RegExp(
      `^/repos/${repoSlug
        .split("/")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
        .join("/")}/check-runs/([1-9][0-9]*)$`,
      "u",
    ),
  );
  if (
    url.protocol !== "https:" ||
    url.hostname !== "api.github.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    match === null
  ) {
    throw new Error(`${repoSlug} v2 job check_run_url is not canonical.`);
  }
  const id = Number(match[1]);
  assertPositiveInteger(id, `${repoSlug} v2 job CheckRun ID`);
  return id;
}

export function parseWorkflowRunPath(value, defaultBranch = undefined) {
  if (typeof value !== "string") {
    throw new Error("Workflow run path must be a string.");
  }
  const separator = value.lastIndexOf("@");
  const workflowPath = separator === -1 ? value : value.slice(0, separator);
  const workflowRef = separator === -1 ? null : value.slice(separator + 1);
  try {
    assertRepoRelativeWorkflowPath(workflowPath, "Workflow run path");
  } catch {
    throw new Error("Workflow run path is not a normalized workflow path.");
  }
  if (
    (workflowRef !== null &&
      (workflowRef === "" || /[\u0000-\u001f\u007f\s]/u.test(workflowRef))) ||
    (defaultBranch !== undefined && typeof defaultBranch !== "string")
  ) {
    throw new Error("Workflow run path has an invalid source ref.");
  }
  // GitHub documents this field as ".github/workflows/foo.yml@ref". Keep
  // accepting its historical bare-path form, but when it supplies a ref bind
  // it to the manifest's default branch rather than merely recording it.
  if (
    defaultBranch !== undefined &&
    (workflowPath !== CANONICAL_WORKFLOW_IDENTITIES.verifier.path ||
      (workflowRef !== null &&
        workflowRef !== defaultBranch &&
        workflowRef !== `refs/heads/${defaultBranch}`))
  ) {
    throw new Error("Workflow run path is not bound to the canonical verifier source.");
  }
  return {
    workflow_path: workflowPath,
    workflow_ref: workflowRef,
  };
}

export function validateV2CheckRunResponse(response, repo) {
  if (
    !isPlainObject(response) ||
    response.total_count !== 1 ||
    !Array.isArray(response.check_runs) ||
    response.check_runs.length !== 1
  ) {
    throw new Error(
      `${repo.slug} ${V2_STATUS_CONTEXT} must have exactly one latest CheckRun.`,
    );
  }
  const check = response.check_runs[0];
  const checkProjection = {
    id: check.id,
    name: check.name,
    status: check.status,
    conclusion: check.conclusion,
    app_id: check.app?.id,
    app_slug: check.app?.slug,
    head_sha: check.head_sha,
    details_url: check.details_url,
  };
  if (
    checkProjection.id !== repo.canary.v2_check_run_id ||
    checkProjection.name !== V2_STATUS_CONTEXT ||
    checkProjection.status !== "completed" ||
    checkProjection.conclusion !== "success" ||
    checkProjection.app_id !== GITHUB_ACTIONS_INTEGRATION_ID ||
    checkProjection.app_slug !== "github-actions" ||
    checkProjection.head_sha !== repo.canary.head_sha
  ) {
    throw new Error(
      `${repo.slug} v2 evidence is not the manifest-bound successful native GitHub Actions CheckRun on the exact canary head.`,
    );
  }
  const { runId, jobId } = parseActionsJobDetailsUrl(
    checkProjection.details_url,
    repo.slug,
  );
  if (runId !== repo.canary.v2_run_id || jobId !== repo.canary.v2_job_id) {
    throw new Error(`${repo.slug} v2 CheckRun run/job identity drifted.`);
  }
  return { checkProjection, runId, jobId };
}

async function loadV2CanaryEvidence(repo) {
  const endpoint = `repos/${encodeEndpointPath(repo.slug)}/commits/${repo.canary.head_sha}/check-runs?check_name=${encodeURIComponent(V2_STATUS_CONTEXT)}&filter=latest&per_page=100`;
  const response = await ghJson(endpoint);
  const { checkProjection, runId, jobId } = validateV2CheckRunResponse(
    response,
    repo,
  );
  const run = await ghJson(
    `repos/${encodeEndpointPath(repo.slug)}/actions/runs/${runId}`,
  );
  const workflowPath = parseWorkflowRunPath(run?.path, repo.default_branch);
  const expectedTitle = `${V2_VERIFIER_RUN_NAME_PREFIX}/${repo.canary.pull_number}/${repo.canary.test_merge_sha}`;
  const matchingPull = Array.isArray(run?.pull_requests)
    ? run.pull_requests.filter(
        (pull) =>
          pull?.number === repo.canary.pull_number &&
          pull?.head?.sha === repo.canary.head_sha &&
          pull?.base?.ref === repo.default_branch,
      )
    : [];
  if (
    run?.id !== repo.canary.v2_run_id ||
    run?.workflow_id !== repo.canary.v2_workflow_id ||
    run?.run_attempt !== repo.canary.v2_run_attempt ||
    run?.display_title !== expectedTitle ||
    run?.repository?.full_name !== repo.slug ||
    run?.head_repository?.full_name !== repo.slug ||
    workflowPath.workflow_path !== CANONICAL_WORKFLOW_IDENTITIES.verifier.path ||
    run?.head_sha !== repo.canary.head_sha ||
    run?.event !== "pull_request" ||
    run?.status !== "completed" ||
    run?.conclusion !== "success" ||
    matchingPull.length !== 1
  ) {
    throw new Error(`${repo.slug} v2 CheckRun is not bound to the exact canonical test-merge run.`);
  }
  const workflow = await ghJson(
    `repos/${encodeEndpointPath(repo.slug)}/actions/workflows/${repo.canary.v2_workflow_id}`,
  );
  if (
    workflow?.id !== repo.canary.v2_workflow_id ||
    workflow?.path !== CANONICAL_WORKFLOW_IDENTITIES.verifier.path ||
    workflow?.state !== "active"
  ) {
    throw new Error(`${repo.slug} v2 run is not bound to the active canonical workflow.`);
  }
  const jobPages = await ghJson(
    `repos/${encodeEndpointPath(repo.slug)}/actions/runs/${runId}/attempts/${repo.canary.v2_run_attempt}/jobs?per_page=100`,
    { paginate: true },
  );
  if (
    !Array.isArray(jobPages) ||
    jobPages.length === 0 ||
    jobPages.some(
      (page) =>
        !isPlainObject(page) ||
        !Number.isSafeInteger(page.total_count) ||
        page.total_count < 0 ||
        !Array.isArray(page.jobs),
    )
  ) {
    throw new Error(`${repo.slug} v2 Actions job inventory is incomplete.`);
  }
  const jobs = jobPages.flatMap((page) => page.jobs);
  if (
    jobPages.some((page) => page.total_count !== jobPages[0].total_count) ||
    jobs.length !== jobPages[0].total_count
  ) {
    throw new Error(`${repo.slug} v2 Actions job pagination is inconsistent.`);
  }
  const matchingJobs = jobs.filter((job) => job?.name === V2_STATUS_CONTEXT);
  if (
    matchingJobs.length !== 1 ||
    matchingJobs[0].id !== repo.canary.v2_job_id ||
    matchingJobs[0].run_id !== repo.canary.v2_run_id ||
    matchingJobs[0].head_sha !== repo.canary.head_sha ||
    matchingJobs[0].status !== "completed" ||
    matchingJobs[0].conclusion !== "success" ||
    parseCheckRunApiUrl(matchingJobs[0].check_run_url, repo.slug) !==
      repo.canary.v2_check_run_id
  ) {
    throw new Error(`${repo.slug} v2 run lacks one exact successful canonical job.`);
  }
  return {
    check_run: checkProjection,
    run: {
      id: run.id,
      workflow_id: run.workflow_id,
      run_attempt: run.run_attempt,
      display_title: run.display_title,
      workflow_path: workflowPath.workflow_path,
      workflow_ref: workflowPath.workflow_ref,
      head_sha: run.head_sha,
    },
    job: {
      id: matchingJobs[0].id,
      check_run_id: repo.canary.v2_check_run_id,
    },
  };
}

export function validateLegacyStatusPages(pages, repo) {
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new Error(`${repo.slug} legacy commit-status inventory is incomplete.`);
  }
  if (pages.some((page, index) => index < pages.length - 1 && page.length !== 100)) {
    throw new Error(`${repo.slug} commit-status pagination has an incomplete non-final page.`);
  }
  const statuses = pages.flat();
  const statusIds = new Set();
  for (const [index, status] of statuses.entries()) {
    assertPositiveInteger(status?.id, `${repo.slug} commit status ${index}.id`);
    if (statusIds.has(status.id)) {
      throw new Error(`${repo.slug} commit-status pagination contains duplicate IDs.`);
    }
    statusIds.add(status.id);
  }
  if (
    statuses.some((status) =>
      statusContextEquals(status?.context, V2_STATUS_CONTEXT),
    )
  ) {
    throw new Error(`${repo.slug} v2 context must not be projected as a commit status.`);
  }
  const legacyStatuses = statuses.filter(
    (status) => statusContextEquals(status?.context, LEGACY_STATUS_CONTEXT),
  );
  if (legacyStatuses.length === 0) {
    throw new Error(
      `${repo.slug} lacks the manifest-bound legacy commit-status compatibility evidence; a CheckRun is not a substitute, and the v1 status is not source-bound cutover authority.`,
    );
  }
  const latest = legacyStatuses[0];
  if (latest.context !== LEGACY_STATUS_CONTEXT) {
    throw new Error(
      `${repo.slug} latest case-insensitive legacy commit-status context must use the exact canonical spelling ${LEGACY_STATUS_CONTEXT}.`,
    );
  }
  const projection = {
    id: latest.id,
    node_id: latest.node_id,
    context: latest.context,
    state: latest.state,
    queried_ref: repo.canary.head_sha,
    creator_login: latest.creator?.login,
    creator_type: latest.creator?.type,
    pagination_horizon: {
      page_count: pages.length,
      page_sizes: pages.map((page) => page.length),
      statuses_sha256: sha256Canonical(
        statuses.map((status) => ({
          id: status.id,
          node_id: status.node_id ?? null,
          context: status.context ?? null,
          state: status.state ?? null,
          creator_login: status.creator?.login ?? null,
          creator_type: status.creator?.type ?? null,
        })),
      ),
    },
  };
  if (
    projection.id !== repo.canary.legacy_status_id ||
    typeof projection.node_id !== "string" ||
    projection.node_id === "" ||
    projection.context !== LEGACY_STATUS_CONTEXT ||
    projection.state !== "success" ||
    projection.creator_login !== "github-actions[bot]" ||
    projection.creator_type !== "Bot"
  ) {
    throw new Error(
      `${repo.slug} latest legacy context is not the manifest-bound successful compatibility status on the exact canary head; v1 status provenance is not integration-bound.`,
    );
  }
  return projection;
}

function createLegacyWriterRunInventoryAccumulator(
  repo,
  writer,
  { requireTerminal = true, includeStatus = false } = {},
) {
  let totalCount = null;
  let pageCount = 0;
  const pageSizes = [];
  const executions = [];
  const runIds = new Set();

  return {
    addPage(page) {
      if (
        !isPlainObject(page) ||
        !Number.isSafeInteger(page.total_count) ||
        page.total_count < 0 ||
        !Array.isArray(page.workflow_runs) ||
        page.workflow_runs.length > LEGACY_WRITER_RUN_PAGE_SIZE
      ) {
        throw new Error(`${repo.slug} legacy writer run inventory is incomplete.`);
      }
      if (totalCount === null) {
        totalCount = page.total_count;
        if (totalCount > MAX_LEGACY_WRITER_RUN_ENTRIES) {
          throw new Error(
            `${repo.slug} ${writer} history has ${totalCount} runs, beyond the ${MAX_LEGACY_WRITER_RUN_ENTRIES}-entry hard resource bound; the result is inconclusive and no next write is allowed.`,
          );
        }
        if (
          Math.ceil(totalCount / LEGACY_WRITER_RUN_PAGE_SIZE) >
          MAX_LEGACY_WRITER_RUN_PAGES
        ) {
          throw new Error(
            `${repo.slug} ${writer} history exceeds the ${MAX_LEGACY_WRITER_RUN_PAGES}-page hard resource bound; the result is inconclusive and no next write is allowed.`,
          );
        }
      } else if (page.total_count !== totalCount) {
        throw new RetryableHandoffEvidenceUnstableError(
          `${repo.slug} legacy writer run pagination is inconsistent.`,
        );
      }
      if (pageCount >= MAX_LEGACY_WRITER_RUN_PAGES) {
        throw new Error(
          `${repo.slug} ${writer} history exceeds the ${MAX_LEGACY_WRITER_RUN_PAGES}-page hard resource bound; the result is inconclusive and no next write is allowed.`,
        );
      }
      pageCount += 1;
      pageSizes.push(page.workflow_runs.length);
      const executionOffset = executions.length;
      for (const [index, run] of page.workflow_runs.entries()) {
        const runLabel = `${repo.slug} legacy writer run ${executionOffset + index}`;
        assertPositiveInteger(run?.id, `${runLabel}.id`);
        assertPositiveInteger(run?.run_attempt, `${runLabel}.run_attempt`);
        if (runIds.has(run.id)) {
          throw new RetryableHandoffEvidenceUnstableError(
            `${repo.slug} legacy writer run pagination contains duplicate IDs.`,
          );
        }
        runIds.add(run.id);
        if (NONTERMINAL_WORKFLOW_RUN_STATUSES.includes(run.status)) {
          if (requireTerminal) {
            throw new RetryableHandoffEvidenceUnstableError(
              `${repo.slug} ${writer} still has ${run.status} runs; bridge status cannot be accepted until every legacy-status writer drains.`,
            );
          }
        } else if (run.status !== "completed") {
          throw new Error(
            `${repo.slug} ${writer} run ${run.id} has unsupported status ${JSON.stringify(run.status)}; bridge status cannot be accepted until the complete legacy-writer inventory is terminal.`,
          );
        }
        executions.push(
          includeStatus
            ? { id: run.id, run_attempt: run.run_attempt, status: run.status }
            : { id: run.id, run_attempt: run.run_attempt },
        );
      }
      if (runIds.size > totalCount) {
        throw new RetryableHandoffEvidenceUnstableError(
          `${repo.slug} legacy writer run pagination is inconsistent.`,
        );
      }
      if (runIds.size === totalCount) return true;
      if (page.workflow_runs.length !== LEGACY_WRITER_RUN_PAGE_SIZE) {
        throw new RetryableHandoffEvidenceUnstableError(
          `${repo.slug} legacy writer run pagination has an incomplete non-final page.`,
        );
      }
      return false;
    },
    finish() {
      if (totalCount === null || runIds.size !== totalCount) {
        throw new RetryableHandoffEvidenceUnstableError(
          `${repo.slug} legacy writer run pagination is inconsistent.`,
        );
      }
      return {
        total_count: totalCount,
        page_count: pageCount,
        page_sizes: pageSizes,
        executions: executions.sort(
          (left, right) =>
            left.id - right.id || left.run_attempt - right.run_attempt,
        ),
      };
    },
  };
}

export function validateLegacyWriterRunPages(
  pages,
  repo,
  writer = "legacy-status writer",
) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error(`${repo.slug} legacy writer run inventory is incomplete.`);
  }
  const accumulator = createLegacyWriterRunInventoryAccumulator(repo, writer);
  let complete = false;
  for (const page of pages) {
    if (complete) {
      throw new Error(`${repo.slug} legacy writer run pagination is inconsistent.`);
    }
    complete = accumulator.addPage(page);
  }
  if (!complete) {
    throw new Error(`${repo.slug} legacy writer run pagination is inconsistent.`);
  }
  return accumulator.finish();
}

function validateActionsWorkflowInventoryPages(pages, repo) {
  if (
    !Array.isArray(pages) ||
    pages.length === 0 ||
    pages.some(
      (page) =>
        !isPlainObject(page) ||
        !Number.isSafeInteger(page.total_count) ||
        page.total_count < 0 ||
        !Array.isArray(page.workflows),
    )
  ) {
    throw new Error(`${repo.slug} Actions workflow inventory is incomplete.`);
  }
  if (pages.some((page, index) => index < pages.length - 1 && page.workflows.length !== 100)) {
    throw new Error(`${repo.slug} Actions workflow inventory has an incomplete non-final page.`);
  }
  const workflows = pages.flatMap((page) => page.workflows);
  if (
    pages.some((page) => page.total_count !== pages[0].total_count) ||
    workflows.length !== pages[0].total_count
  ) {
    throw new RetryableHandoffEvidenceUnstableError(
      `${repo.slug} Actions workflow inventory is inconsistent.`,
    );
  }
  if (workflows.length > MAX_ACTIONS_WORKFLOW_INVENTORY_ENTRIES) {
    throw new Error(
      `${repo.slug} Actions workflow inventory exceeds the ${MAX_ACTIONS_WORKFLOW_INVENTORY_ENTRIES}-entry capacity bound; activation evidence is inconclusive.`,
    );
  }
  const workflowIds = new Set();
  for (const [index, workflow] of workflows.entries()) {
    assertPositiveInteger(workflow?.id, `${repo.slug} Actions workflow ${index}.id`);
    if (workflowIds.has(workflow.id)) {
      throw new RetryableHandoffEvidenceUnstableError(
        `${repo.slug} Actions workflow inventory contains duplicate IDs.`,
      );
    }
    workflowIds.add(workflow.id);
    assertRepoRelativeWorkflowPath(
      workflow?.path,
      `${repo.slug} Actions workflow ${index}.path`,
    );
    assertNonEmptyString(workflow?.state, `${repo.slug} Actions workflow ${index}.state`);
  }
  return workflows;
}

async function loadStableActionsWorkflowInventory(
  repo,
  { deadlineAt = undefined, deadlineLabel = undefined } = {},
) {
  const endpoint =
    `repos/${encodeEndpointPath(repo.slug)}/actions/workflows?per_page=100`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const pages = await ghJson(endpoint, {
      paginate: true,
      deadlineAt,
      deadlineLabel,
    });
    const workflows = validateActionsWorkflowInventoryPages(pages, repo);
    const firstPage = await ghJson(`${endpoint}&page=1`, {
      deadlineAt,
      deadlineLabel,
    });
    if (
      Array.isArray(firstPage?.workflows) &&
      Array.isArray(pages[0]?.workflows) &&
      canonicalJson(firstPage) === canonicalJson(pages[0])
    ) {
      return workflows;
    }
  }
  throw new RetryableHandoffEvidenceUnstableError(
    `${repo.slug} Actions workflow inventory changed during horizon revalidation; the result is inconclusive and no next write is allowed.`,
  );
}

async function loadActiveCanonicalWorkflowById(
  repo,
  workflowId,
  expectedPath,
  label,
  { deadlineAt = undefined, deadlineLabel = undefined } = {},
) {
  const workflow = await ghJson(
    `repos/${encodeEndpointPath(repo.slug)}/actions/workflows/${workflowId}`,
    { deadlineAt, deadlineLabel },
  );
  if (
    workflow?.id !== workflowId ||
    workflow?.path !== expectedPath ||
    workflow?.state !== "active"
  ) {
    throw new Error(
      `${repo.slug} ${label} is not bound to one active canonical Actions workflow identity.`,
    );
  }
  return workflowId;
}

async function loadActiveCanonicalLegacyBridgeWorkflowId(
  repo,
  { deadlineAt = undefined, deadlineLabel = undefined } = {},
) {
  const workflows = await loadStableActionsWorkflowInventory(repo, {
    deadlineAt,
    deadlineLabel,
  });
  const matches = workflows.filter(
    (workflow) => workflow.path === CANONICAL_WORKFLOW_IDENTITIES.legacy_bridge.path,
  );
  if (matches.length !== 1) {
    throw new Error(
      `${repo.slug} canonical legacy bridge must have exactly one Actions workflow identity in the complete inventory.`,
    );
  }
  const [bridge] = matches;
  if (bridge.state !== "active") {
    throw new Error(`${repo.slug} canonical legacy bridge Actions workflow is not active.`);
  }
  return loadActiveCanonicalWorkflowById(
    repo,
    bridge.id,
    CANONICAL_WORKFLOW_IDENTITIES.legacy_bridge.path,
    "canonical legacy bridge",
    { deadlineAt, deadlineLabel },
  );
}

function legacyWriterScanDeadlineError(repo, writer, timeoutMs) {
  return new RetryableHandoffEvidenceUnstableError(
    `${repo.slug} ${writer} complete legacy-writer scan exceeded its ${timeoutMs}ms total deadline; the result is inconclusive and no next write is allowed.`,
  );
}

async function scanWorkflowRunInventory(
  repo,
  workflowId,
  writer,
  {
    now = performance.now.bind(performance),
    timeoutMs = LEGACY_WRITER_SCAN_TIMEOUT_MS,
    readPage = ghJson,
    requireTerminal = true,
    includeStatus = false,
    deadlineAt = undefined,
    deadlineLabel = undefined,
  } = {},
) {
  if (
    typeof now !== "function" ||
    typeof readPage !== "function" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    typeof requireTerminal !== "boolean" ||
    typeof includeStatus !== "boolean" ||
    (deadlineAt !== undefined &&
      (!Number.isFinite(deadlineAt) ||
        typeof deadlineLabel !== "string" ||
        deadlineLabel === ""))
  ) {
    throw new Error("Legacy writer scan runtime configuration is invalid.");
  }
  const startedAt = now();
  if (!Number.isFinite(startedAt)) {
    throw new Error("Legacy writer scan clock returned an invalid start time.");
  }
  const localDeadlineAt = startedAt + timeoutMs;
  if (!Number.isFinite(localDeadlineAt)) {
    throw new Error("Legacy writer scan deadline is invalid.");
  }
  const localDeadlineLabel =
    `${repo.slug} ${writer} ${timeoutMs}ms complete legacy-writer scan`;
  const externalDeadlineWins =
    deadlineAt !== undefined && deadlineAt <= localDeadlineAt;
  const effectiveDeadlineAt = externalDeadlineWins ? deadlineAt : localDeadlineAt;
  const effectiveDeadlineLabel = externalDeadlineWins
    ? deadlineLabel
    : localDeadlineLabel;
  let lastObservedAt = startedAt;
  const assertWithinDeadline = () => {
    const observedAt = now();
    if (!Number.isFinite(observedAt) || observedAt < lastObservedAt) {
      throw new Error("Legacy writer scan clock is invalid or moved backwards.");
    }
    lastObservedAt = observedAt;
    if (observedAt >= effectiveDeadlineAt) {
      if (externalDeadlineWins) {
        throw new DeadlineExceededError(effectiveDeadlineLabel);
      }
      throw legacyWriterScanDeadlineError(repo, writer, timeoutMs);
    }
  };
  const endpoint =
    `repos/${encodeEndpointPath(repo.slug)}/actions/workflows/${workflowId}/runs?per_page=${LEGACY_WRITER_RUN_PAGE_SIZE}`;
  const accumulator = createLegacyWriterRunInventoryAccumulator(repo, writer, {
    requireTerminal,
    includeStatus,
  });
  for (let page = 1; ; page += 1) {
    assertWithinDeadline();
    const response = await readPage(`${endpoint}&page=${page}`, {
      deadlineAt: effectiveDeadlineAt,
      deadlineLabel: effectiveDeadlineLabel,
    });
    assertWithinDeadline();
    const complete = accumulator.addPage(response);
    if (complete) return accumulator.finish();
  }
}

export async function scanLegacyWriterRuns(
  repo,
  workflowId,
  writer,
  options = undefined,
) {
  return scanWorkflowRunInventory(repo, workflowId, writer, options);
}

async function assertLegacyProducerDrained(
  repo,
  {
    deadlineAt = undefined,
    deadlineLabel = undefined,
    writerScanTimeoutMs =
      repo.legacy_writer_scan_timeout_ms ?? LEGACY_WRITER_SCAN_TIMEOUT_MS,
  } = {},
) {
  // The verifier retained the old producer's Actions workflow ID by replacing
  // .github/workflows/codex-review-gate.yml in place. The temporary bridge is
  // a second, independently identified legacy-status writer and shares its
  // concurrency key. Bind both live identities and drain both inventories so
  // neither writer can race the compatibility status snapshot or readback.
  const [producerWorkflowId, bridgeWorkflowId] = await Promise.all([
    loadActiveCanonicalWorkflowById(
      repo,
      repo.canary.v2_workflow_id,
      CANONICAL_WORKFLOW_IDENTITIES.verifier.path,
      "retained canonical producer",
      { deadlineAt, deadlineLabel },
    ),
    loadActiveCanonicalLegacyBridgeWorkflowId(repo, { deadlineAt, deadlineLabel }),
  ]);
  const writers = await Promise.all(
    [
      [producerWorkflowId, "retained canonical producer"],
      [bridgeWorkflowId, "temporary legacy bridge"],
    ].map(async ([workflowId, writer]) => {
      // Do not split this inventory into individual `status` queries. A run
      // can advance between independently timed filtered requests, leaving
      // every bucket empty even though it never drained. Scan one unfiltered
      // inventory page at a time, retaining only execution identity; reject
      // nonterminal states locally without accumulating full run payloads.
      return {
        workflow_id: workflowId,
        execution_epoch: await scanLegacyWriterRuns(repo, workflowId, writer, {
          timeoutMs: writerScanTimeoutMs,
          deadlineAt,
          deadlineLabel,
        }),
      };
    }),
  );
  return writers;
}

async function loadStableLegacyStatusProjection(
  repo,
  endpoint,
  { deadlineAt = undefined, deadlineLabel = undefined } = {},
) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const pages = await ghJson(endpoint, {
      paginate: true,
      deadlineAt,
      deadlineLabel,
    });
    const projection = validateLegacyStatusPages(pages, repo);
    const firstPage = await ghJson(`${endpoint}&page=1`, {
      deadlineAt,
      deadlineLabel,
    });
    if (
      Array.isArray(firstPage) &&
      Array.isArray(pages[0]) &&
      canonicalJson(firstPage) === canonicalJson(pages[0])
    ) {
      return projection;
    }
  }
  throw new RetryableHandoffEvidenceUnstableError(
    `${repo.slug} commit-status pagination horizon changed during revalidation; the result is inconclusive and no next write is allowed.`,
  );
}

function legacyEvidenceDeadlineError(repo, timeoutMs) {
  return new Error(
    `${repo.slug} legacy status evidence remained unstable for ${timeoutMs}ms; recovery_code=legacy-writer-evidence-unstable. Keep legacy protection active, wait for writers to drain or repair the named evidence drift, then run a fresh activation preview.`,
  );
}

export async function loadLegacyStatusEvidence(
  repo,
  {
    evidenceTimeoutMs = LEGACY_EVIDENCE_STABILITY_TIMEOUT_MS,
    retryIntervalMs = ACTIVATION_STABILITY_INTERVAL_MS,
    now = performance.now.bind(performance),
    sleep = delay,
    loadWriterEpoch = undefined,
    loadStatusProjection = undefined,
  } = {},
) {
  if (
    !Number.isSafeInteger(evidenceTimeoutMs) ||
    evidenceTimeoutMs < LEGACY_WRITER_SCAN_TIMEOUT_MS ||
    evidenceTimeoutMs > MAX_LEGACY_EVIDENCE_STABILITY_TIMEOUT_MS ||
    !Number.isSafeInteger(retryIntervalMs) ||
    retryIntervalMs < 0 ||
    typeof now !== "function" ||
    typeof sleep !== "function" ||
    (loadWriterEpoch !== undefined && typeof loadWriterEpoch !== "function") ||
    (loadStatusProjection !== undefined && typeof loadStatusProjection !== "function")
  ) {
    throw new Error("Legacy status evidence runtime configuration is invalid.");
  }
  const endpoint = `repos/${encodeEndpointPath(repo.slug)}/commits/${repo.canary.head_sha}/statuses?per_page=100`;
  const startedAt = now();
  if (!Number.isFinite(startedAt)) {
    throw new Error("Legacy status evidence clock returned an invalid start time.");
  }
  const localDeadlineAt = startedAt + evidenceTimeoutMs;
  if (!Number.isFinite(localDeadlineAt)) {
    throw new Error("Legacy status evidence deadline is invalid.");
  }
  const localDeadlineLabel =
    `${repo.slug} ${evidenceTimeoutMs}ms legacy status evidence stability`;
  const inherited = ghDeadlineContext.getStore();
  const externalDeadlineWins =
    inherited !== undefined && inherited.deadlineAt < localDeadlineAt;
  const deadlineAt = externalDeadlineWins
    ? inherited.deadlineAt
    : localDeadlineAt;
  const deadlineLabel = externalDeadlineWins
    ? inherited.deadlineLabel
    : localDeadlineLabel;
  const readerOptions = { deadlineAt, deadlineLabel };
  const readWriterEpoch =
    loadWriterEpoch ??
    ((options) =>
      assertLegacyProducerDrained(repo, {
        ...options,
        writerScanTimeoutMs:
          repo.legacy_writer_scan_timeout_ms ?? LEGACY_WRITER_SCAN_TIMEOUT_MS,
      }));
  const readStatusProjection =
    loadStatusProjection ??
    ((options) => loadStableLegacyStatusProjection(repo, endpoint, options));
  let lastObservedAt = startedAt;
  const remaining = () => {
    const observedAt = now();
    if (!Number.isFinite(observedAt) || observedAt < lastObservedAt) {
      throw new Error("Legacy status evidence clock is invalid or moved backwards.");
    }
    lastObservedAt = observedAt;
    return deadlineAt - observedAt;
  };

  for (;;) {
    if (remaining() <= 0) {
      if (externalDeadlineWins) throw new DeadlineExceededError(deadlineLabel);
      throw legacyEvidenceDeadlineError(repo, evidenceTimeoutMs);
    }
    try {
      const result = await withGhDeadline(deadlineAt, deadlineLabel, async () => {
        // GitHub does not expose an atomic cross-resource snapshot. Keep the
        // status decision inside two complete terminal writer epochs, then read a
        // second full status projection after the latter epoch. Any new completed
        // run, rerun, or status-list change forces a bounded retry rather than
        // authorizing a stale legacy success.
        const writerEpochBefore = await readWriterEpoch(readerOptions);
        const statusBefore = await readStatusProjection(readerOptions);
        const writerEpochAfter = await readWriterEpoch(readerOptions);
        const statusAfter = await readStatusProjection(readerOptions);
        if (
          canonicalJson(writerEpochBefore) !== canonicalJson(writerEpochAfter) ||
          canonicalJson(statusBefore) !== canonicalJson(statusAfter)
        ) {
          throw new RetryableHandoffEvidenceUnstableError(
            `${repo.slug} commit-status or legacy-writer execution horizon changed during revalidation; the result is inconclusive and no next write is allowed.`,
          );
        }
        return statusAfter;
      });
      if (remaining() <= 0) {
        if (externalDeadlineWins) throw new DeadlineExceededError(deadlineLabel);
        throw legacyEvidenceDeadlineError(repo, evidenceTimeoutMs);
      }
      return result;
    } catch (error) {
      if (
        !(error instanceof RetryableHandoffEvidenceUnstableError) &&
        !(error instanceof DeadlineExceededError)
      ) {
        throw error;
      }
      const remainingMs = remaining();
      if (error instanceof DeadlineExceededError && externalDeadlineWins) {
        throw error;
      }
      if (remainingMs <= 0 || error instanceof DeadlineExceededError) {
        throw legacyEvidenceDeadlineError(repo, evidenceTimeoutMs);
      }
      await sleep(Math.min(retryIntervalMs, remainingMs));
    }
  }
}

function activationSchedulerRepository(manifest) {
  const matches = manifest.repositories.filter(
    (repo) => repo.slug === ACTIVATION_SCHEDULER_REPOSITORY,
  );
  if (matches.length !== 1 || matches[0].scheduler_quiescence === null) {
    throw new Error(
      `Validated manifest does not bind one activation scheduler in ${ACTIVATION_SCHEDULER_REPOSITORY}.`,
    );
  }
  return matches[0];
}

function activationSchedulerEndpoint(repo, workflowId, operation) {
  if (!new Set(["disable", "enable"]).has(operation)) {
    throw new Error("Activation scheduler operation is unsupported.");
  }
  return `repos/${encodeEndpointPath(repo.slug)}/actions/workflows/${workflowId}/${operation}`;
}

async function loadActivationSchedulerSnapshot(
  manifest,
  {
    expectedState,
    requireCanaryBase = true,
    deadlineAt = undefined,
    deadlineLabel = undefined,
  } = {},
) {
  const expectedStates = Array.isArray(expectedState)
    ? expectedState
    : [expectedState];
  if (
    expectedStates.length === 0 ||
    expectedStates.some(
      (state) => !new Set(["active", "disabled_manually"]).has(state),
    )
  ) {
    throw new Error("Activation scheduler expected state is unsupported.");
  }
  const repo = activationSchedulerRepository(manifest);
  const scheduler = repo.scheduler_quiescence;
  const [metadata, defaultBranch] = await Promise.all([
    ghJson(`repos/${encodeEndpointPath(repo.slug)}`, {
      deadlineAt,
      deadlineLabel,
    }),
    loadDefaultBranchHead(repo, { requireCanaryBase }),
  ]);
  const identity = {
    full_name: metadata?.full_name,
    id: metadata?.id,
    node_id: metadata?.node_id,
    default_branch: metadata?.default_branch,
  };
  assertExactSnapshot(
    identity,
    {
      full_name: repo.slug,
      id: repo.id,
      node_id: repo.node_id,
      default_branch: repo.default_branch,
    },
    `${repo.slug} activation scheduler repository identity`,
  );
  const workflowInventory = await loadWorkflowInventoryEvidence(
    repo,
    defaultBranch.head_sha,
  );
  const workflow = await ghJson(
    `repos/${encodeEndpointPath(repo.slug)}/actions/workflows/${scheduler.workflow_id}`,
    { deadlineAt, deadlineLabel },
  );
  if (
    workflow?.id !== scheduler.workflow_id ||
    workflow?.path !== scheduler.workflow.path ||
    !expectedStates.includes(workflow?.state)
  ) {
    throw new Error(
      `${repo.slug} activation scheduler is not bound to one exact ${expectedStates.join(" or ")} workflow identity.`,
    );
  }
  if (
    canonicalJson(workflowInventory.scheduler_quiescence) !==
    canonicalJson(scheduler.workflow)
  ) {
    throw new Error(
      `${repo.slug} activation scheduler source identity is not bound to the manifest.`,
    );
  }
  return {
    repository: identity,
    default_branch: defaultBranch,
    workflow: {
      id: workflow.id,
      path: workflow.path,
      state: workflow.state,
      source: workflowInventory.scheduler_quiescence,
    },
  };
}

function schedulerDrainDeadlineError(repo, timeoutMs) {
  return new Error(
    `${repo.slug} activation scheduler did not complete its bound source, control-plane, and stable terminal execution evidence within ${timeoutMs}ms. It remains disabled_manually. Do not activate v2; wait for the already-started run to finish or inspect it, then use a fresh quiesce preview or explicit restore as appropriate.`,
  );
}

function activationSchedulerSnapshotDeadlineError(repo, timeoutMs) {
  return new Error(
    `${repo.slug} activation scheduler snapshot could not complete within ${timeoutMs}ms; recovery_code=activation-scheduler-snapshot-timeout. Do not make an activation decision from this incomplete observation; inspect the scheduler state, then use a fresh quiesce, activation, or restore preview as appropriate.`,
  );
}

function schedulerRunsAreTerminal(inventory) {
  return inventory.executions.every((execution) => execution.status === "completed");
}

async function loadStableActivationSchedulerDrain(
  manifest,
  {
    now = performance.now.bind(performance),
    sleep = delay,
    retryIntervalMs = ACTIVATION_STABILITY_INTERVAL_MS,
  } = {},
) {
  if (
    typeof now !== "function" ||
    typeof sleep !== "function" ||
    !Number.isSafeInteger(retryIntervalMs) ||
    retryIntervalMs < 0
  ) {
    throw new Error("Activation scheduler drain runtime configuration is invalid.");
  }
  const repo = activationSchedulerRepository(manifest);
  const scheduler = repo.scheduler_quiescence;
  const startedAt = now();
  if (!Number.isFinite(startedAt)) {
    throw new Error("Activation scheduler drain clock returned an invalid start time.");
  }
  const localDeadlineAt = startedAt + scheduler.drain_timeout_ms;
  if (!Number.isFinite(localDeadlineAt)) {
    throw new Error("Activation scheduler drain deadline is invalid.");
  }
  const localDeadlineLabel =
    `${repo.slug} ${scheduler.drain_timeout_ms}ms activation scheduler drain`;
  const inherited = ghDeadlineContext.getStore();
  const externalDeadlineWins =
    inherited !== undefined && inherited.deadlineAt < localDeadlineAt;
  const deadlineAt = externalDeadlineWins
    ? inherited.deadlineAt
    : localDeadlineAt;
  const deadlineLabel = externalDeadlineWins
    ? inherited.deadlineLabel
    : localDeadlineLabel;
  let lastObservedAt = startedAt;
  const remaining = () => {
    const observedAt = now();
    if (!Number.isFinite(observedAt) || observedAt < lastObservedAt) {
      throw new Error("Activation scheduler drain clock is invalid or moved backwards.");
    }
    lastObservedAt = observedAt;
    return deadlineAt - observedAt;
  };
  const loadInventory = () =>
    scanWorkflowRunInventory(
      repo,
      scheduler.workflow_id,
      "activation scheduler",
      {
        timeoutMs: scheduler.drain_timeout_ms,
        requireTerminal: false,
        includeStatus: true,
        deadlineAt,
        deadlineLabel,
      },
    );

  for (;;) {
    if (remaining() <= 0) {
      if (externalDeadlineWins) throw new DeadlineExceededError(deadlineLabel);
      throw schedulerDrainDeadlineError(repo, scheduler.drain_timeout_ms);
    }
    try {
      const epoch = await withGhDeadline(deadlineAt, deadlineLabel, async () => {
        const first = await loadInventory();
        if (!schedulerRunsAreTerminal(first)) {
          throw new RetryableHandoffEvidenceUnstableError(
            `${repo.slug} activation scheduler still has nonterminal runs.`,
          );
        }
        await sleep(Math.min(retryIntervalMs, Math.max(0, remaining())));
        const second = await loadInventory();
        if (
          !schedulerRunsAreTerminal(second) ||
          canonicalJson(first) !== canonicalJson(second)
        ) {
          throw new RetryableHandoffEvidenceUnstableError(
            `${repo.slug} activation scheduler execution epoch changed during drain revalidation.`,
          );
        }
        return second;
      });
      if (remaining() <= 0) {
        if (externalDeadlineWins) throw new DeadlineExceededError(deadlineLabel);
        throw schedulerDrainDeadlineError(repo, scheduler.drain_timeout_ms);
      }
      return epoch;
    } catch (error) {
      if (
        !(error instanceof RetryableHandoffEvidenceUnstableError) &&
        !(error instanceof DeadlineExceededError)
      ) {
        throw error;
      }
      const remainingMs = remaining();
      if (error instanceof DeadlineExceededError && externalDeadlineWins) {
        throw error;
      }
      if (remainingMs <= 0 || error instanceof DeadlineExceededError) {
        throw schedulerDrainDeadlineError(repo, scheduler.drain_timeout_ms);
      }
      await sleep(Math.min(retryIntervalMs, remainingMs));
    }
  }
}

async function loadQuiescedActivationSchedulerEvidence(
  manifest,
  runtime,
  { outerDeadlineAt = undefined, snapshotRuntime = runtime } = {},
) {
  const before = await loadBoundedActivationSchedulerSnapshot(
    manifest,
    snapshotRuntime,
    { expectedState: "disabled_manually" },
    { outerDeadlineAt },
  );
  const executionEpoch = await loadStableActivationSchedulerDrain(manifest, runtime);
  const after = await loadBoundedActivationSchedulerSnapshot(
    manifest,
    snapshotRuntime,
    { expectedState: "disabled_manually" },
    { outerDeadlineAt },
  );
  if (canonicalJson(before) !== canonicalJson(after)) {
    throw new RetryableHandoffEvidenceUnstableError(
      `${before.repository.full_name} activation scheduler control-plane changed while its execution epoch drained.`,
    );
  }
  return { ...after, execution_epoch: executionEpoch };
}

function rulesetLegacyContextCount(writable, label) {
  return requiredStatusRules(writable).reduce(
    (count, rule, index) =>
      count +
      statusChecks(rule, `${label}.required_status_checks[${index}]`).reduce(
        (ruleCount, check) => {
          if (!statusContextEquals(check.context, LEGACY_STATUS_CONTEXT)) {
            return ruleCount;
          }
          if (check.context !== LEGACY_STATUS_CONTEXT) {
            throw new Error(
              `${label} has a case-variant legacy context; refusing to classify it as unrelated policy.`,
            );
          }
          return ruleCount + 1;
        },
        0,
      ),
    0,
  );
}

function classicLegacyContextCount(value) {
  if (value === null) {
    return 0;
  }
  const contexts = [
    ...value.contexts,
    ...value.checks.map((check) => check.context),
  ];
  return contexts.reduce((count, context) => {
    if (!statusContextEquals(context, LEGACY_STATUS_CONTEXT)) {
      return count;
    }
    if (context !== LEGACY_STATUS_CONTEXT) {
      throw new Error(
        "Classic required-status protection has a case-variant legacy context; refusing to classify it as unrelated policy.",
      );
    }
    return count + 1;
  }, 0);
}

async function loadLocalRepositoryRulesets(repo) {
  const response = await ghJson(
    `repos/${encodeEndpointPath(repo.slug)}/rulesets?includes_parents=false&per_page=100`,
    { paginate: true },
  );
  if (!Array.isArray(response) || response.some((page) => !Array.isArray(page))) {
    throw new Error(`${repo.slug} local ruleset inventory pagination is malformed.`);
  }
  const summaries = response.flat();
  if (summaries.length > MAX_LOCAL_REPOSITORY_RULESETS) {
    throw new Error(
      `${repo.slug} local ruleset inventory exceeds the ${MAX_LOCAL_REPOSITORY_RULESETS}-ruleset capacity bound; activation evidence is inconclusive.`,
    );
  }
  const ids = summaries.map((summary, index) => {
    assertPlainObject(summary, `${repo.slug} local ruleset summary ${index}`);
    assertPositiveInteger(summary.id, `${repo.slug} local ruleset summary ${index}.id`);
    if (summary.source_type !== "Repository" || summary.source !== repo.slug) {
      throw new Error(
        `${repo.slug} includes_parents=false inventory returned a non-local ruleset.`,
      );
    }
    return summary.id;
  });
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${repo.slug} local ruleset inventory contains duplicate IDs.`);
  }
  const complete = await mapWithConcurrency(ids, 2, async (id) => {
      const responseValue = await ghJson(repositoryRulesetEndpoint(repo, id));
      const ruleset = writableRulesetFromApi(
        responseValue,
        "Repository",
        repo.slug,
        `${repo.slug} local ruleset ${id}`,
      );
      if (ruleset.id !== id) {
        throw new Error(`${repo.slug} local ruleset ${id} returned the wrong ID.`);
      }
      return ruleset;
  });
  return complete.sort((left, right) => left.id - right.id);
}

function canonicalClassicApiResponse(value, label) {
  if (value === null) {
    return null;
  }
  const projection = {
    strict: value.strict,
    contexts: cloneJson(value.contexts),
    checks: Array.isArray(value.checks)
      ? value.checks.map((check) => ({ context: check.context, app_id: check.app_id }))
      : value.checks,
  };
  return assertClassicStatusSnapshot(projection, label);
}

async function loadClassicStatusSurface(repo) {
  const response = await ghJson(classicStatusEndpoint(repo), { allowNotFound: true });
  if (response === GH_NOT_FOUND) {
    return null;
  }
  return canonicalClassicApiResponse(
    response,
    `${repo.slug} classic required status checks`,
  );
}

function canonicalEffectiveBranchRule(value, repo, index) {
  assertPlainObject(value, `${repo.slug} effective branch rule ${index}`);
  assertNonEmptyString(value.type, `${repo.slug} effective branch rule ${index}.type`);
  if (
    !Object.hasOwn(value, "ruleset_id") ||
    !Object.hasOwn(value, "ruleset_source") ||
    !Object.hasOwn(value, "ruleset_source_type")
  ) {
    throw new Error(
      `${repo.slug} effective branch rule ${index} lacks a complete ruleset provenance tuple.`,
    );
  }
  const rulesetId = value.ruleset_id;
  const rulesetSource = value.ruleset_source;
  const rulesetSourceType = value.ruleset_source_type;
  if (rulesetId !== null) {
    assertPositiveInteger(
      rulesetId,
      `${repo.slug} effective branch rule ${index}.ruleset_id`,
    );
    assertNonEmptyString(
      rulesetSource,
      `${repo.slug} effective branch rule ${index}.ruleset_source`,
    );
    assertNonEmptyString(
      rulesetSourceType,
      `${repo.slug} effective branch rule ${index}.ruleset_source_type`,
    );
  } else if (rulesetSource !== null || rulesetSourceType !== null) {
    throw new Error(
      `${repo.slug} effective branch rule ${index} has an incomplete classic-protection provenance tuple.`,
    );
  }
  const projection = {
    type: value.type,
    ruleset_id: rulesetId,
    ruleset_source: rulesetSource,
    ruleset_source_type: rulesetSourceType,
    parameters: value.parameters === undefined ? null : cloneJson(value.parameters),
  };
  assertJsonData(projection, `${repo.slug} effective branch rule ${index}`);
  if (projection.type === "required_status_checks") {
    statusChecks(
      { type: projection.type, parameters: projection.parameters },
      `${repo.slug} effective branch rule ${index}`,
    );
  }
  return projection;
}

async function loadEffectiveBranchRules(repo) {
  const response = await ghJson(
    `repos/${encodeEndpointPath(repo.slug)}/rules/branches/${encodeURIComponent(repo.default_branch)}?per_page=100`,
    { paginate: true },
  );
  if (
    !Array.isArray(response) ||
    response.length === 0 ||
    response.some((page) => !Array.isArray(page))
  ) {
    throw new Error(`${repo.slug} effective branch-rule inventory is malformed.`);
  }
  if (response.some((page, index) => index < response.length - 1 && page.length !== 100)) {
    throw new Error(`${repo.slug} effective branch-rule pagination has an incomplete non-final page.`);
  }
  return response
    .flat()
    .map((rule, index) => canonicalEffectiveBranchRule(rule, repo, index))
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
}

function effectiveRuleStatusChecks(rule, repo, index) {
  if (rule.type !== "required_status_checks") {
    return [];
  }
  return statusChecks(
    { type: rule.type, parameters: rule.parameters },
    `${repo.slug} effective branch rule ${index}`,
  );
}

function assertEffectiveLegacyClosure(
  repo,
  manifest,
  effectiveBranchRules,
  cleanup,
) {
  const cleanupStateBySurface = new Map(
    cleanup.map((entry) => [entry.surface, entry.state]),
  );
  for (const [index, rule] of effectiveBranchRules.entries()) {
    for (const check of effectiveRuleStatusChecks(rule, repo, index)) {
      if (!statusContextEquals(check.context, LEGACY_STATUS_CONTEXT)) {
        continue;
      }
      if (check.context !== LEGACY_STATUS_CONTEXT) {
        throw new Error(
          `${repo.slug} effective legacy context must use canonical spelling ${LEGACY_STATUS_CONTEXT}.`,
        );
      }
      if (rule.ruleset_id === manifest.legacy_ruleset.id) {
        if (
          rule.ruleset_source_type !== "Organization" ||
          rule.ruleset_source !== manifest.organization.login
        ) {
          throw new Error(
            `${repo.slug} effective legacy organization rule has an unexpected source identity.`,
          );
        }
        continue;
      }
      const localCleanupSurface = `repository_ruleset:${rule.ruleset_id}`;
      if (cleanupStateBySurface.has(localCleanupSurface)) {
        if (
          rule.ruleset_source_type !== "Repository" ||
          rule.ruleset_source !== repo.slug
        ) {
          throw new Error(
            `${repo.slug} effective local legacy cleanup ruleset has an unexpected source identity.`,
          );
        }
        if (cleanupStateBySurface.get(localCleanupSurface) !== "before") {
          throw new Error(
            `${repo.slug} effective local legacy cleanup ruleset still requires the legacy context after its cleanup.`,
          );
        }
        continue;
      }
      if (rule.ruleset_id === null) {
        const classicState = cleanupStateBySurface.get(
          "classic_required_status_checks",
        );
        if (classicState === "before") {
          continue;
        }
        if (classicState === "after") {
          throw new Error(
            `${repo.slug} effective classic protection still requires the legacy context after its cleanup.`,
          );
        }
      }
      if (rule.ruleset_id === null) {
        throw new Error(
          `${repo.slug} effective default-branch rules include an unmanifested legacy context from classic protection.`,
        );
      }
      throw new Error(
        `${repo.slug} effective default-branch rules include an unmanifested legacy context from ruleset ${rule.ruleset_id}.`,
      );
    }
  }
}

function assertEffectiveOrganizationGateCoverage(snapshot, manifest) {
  const requireLegacy = snapshot.organization.legacy_state === "before";
  const requireV2 = snapshot.organization.v2_state === "active";
  for (const repository of snapshot.repositories) {
    const rules = repository.effective_default_branch_rules;
    const repositoryLabel = { slug: repository.identity.full_name };
    const matches = (context, rulesetId) =>
      rules.flatMap(
        (rule, index) => {
          if (
            rule.ruleset_id !== rulesetId ||
            rule.ruleset_source_type !== "Organization" ||
            rule.ruleset_source !== manifest.organization.login
          ) {
            return [];
          }
          return effectiveRuleStatusChecks(rule, repositoryLabel, index)
            .filter(
              (check) =>
                check.context === context &&
                (context !== V2_STATUS_CONTEXT ||
                  check.integration_id === GITHUB_ACTIONS_INTEGRATION_ID),
            )
            .map((check) => ({ rule, index, check }));
        },
      );
    const legacyMatches = matches(
      LEGACY_STATUS_CONTEXT,
      manifest.legacy_ruleset.id,
    );
    const v2Matches = matches(V2_STATUS_CONTEXT, manifest.v2_ruleset.id);
    if (requireLegacy && legacyMatches.length !== 1) {
      throw new Error(
        `${repository.identity.full_name} must have exactly one effective manifest-bound legacy organization status rule.`,
      );
    }
    if (!requireLegacy && legacyMatches.length !== 0) {
      throw new Error(
        `${repository.identity.full_name} still has the effective legacy organization status rule after cutover.`,
      );
    }
    if (requireV2 && v2Matches.length !== 1) {
      throw new Error(
        `${repository.identity.full_name} must have exactly one effective manifest-bound v2 organization status rule.`,
      );
    }
  }
}

function classifyCleanupSurface(action, actual) {
  if (
    cleanupSurfaceSnapshotsEqual(
      action,
      actual,
      action.expected_before,
      "Repository legacy cleanup before snapshot",
    )
  ) {
    return "before";
  }
  if (
    cleanupSurfaceSnapshotsEqual(
      action,
      actual,
      action.expected_after,
      "Repository legacy cleanup after snapshot",
    )
  ) {
    return "after";
  }
  throw new Error("Repository legacy cleanup surface matches neither bound snapshot.");
}

async function loadRepositoryEvidence(
  repo,
  {
    requireCanaryEvidence = true,
    manifest,
    legacyEvidenceRuntime = undefined,
  } = {},
) {
  if (manifest === undefined) {
    throw new Error("Repository evidence requires the validated handoff manifest.");
  }
  const metadataPromise = ghJson(`repos/${encodeEndpointPath(repo.slug)}`);
  const defaultBranchPromise = loadDefaultBranchHead(repo, {
    requireCanaryBase: requireCanaryEvidence,
  });
  const [metadata, defaultBranch] = await Promise.all([
    metadataPromise,
    defaultBranchPromise,
  ]);
  // The default-branch tree binds the canonical bridge bytes before the live
  // Actions inventory resolves its mutable workflow ID for status-writer drain.
  const workflowControlPlane = await loadWorkflowInventoryEvidence(
    repo,
    defaultBranch.head_sha,
  );
  const canaryEvidencePromise = requireCanaryEvidence
    ? Promise.allSettled([
        loadCanaryPull(repo),
        loadV2CanaryEvidence(repo),
        loadLegacyStatusEvidence(repo, {
          ...(legacyEvidenceRuntime ?? {}),
          evidenceTimeoutMs:
            manifest.activation.legacy_evidence_stability_timeout_ms,
        }),
      ]).then((results) => {
        const rejected = results.find((result) => result.status === "rejected");
        if (rejected !== undefined) throw rejected.reason;
        return results.map((result) => result.value);
      })
    : Promise.resolve(null);
  const canaryEvidence = await canaryEvidencePromise;
  const [
    v2Ruleset,
    codeowners,
    actionsWorkflowPermissions,
    localRulesets,
    classicStatus,
    effectiveBranchRules,
  ] = await Promise.all([
    loadRepositoryRuleset(repo),
    loadCodeownersEvidence(repo, defaultBranch.head_sha),
    loadActionsWorkflowPermissions(repo),
    loadLocalRepositoryRulesets(repo),
    loadClassicStatusSurface(repo),
    loadEffectiveBranchRules(repo),
  ]);
  assertPlainObject(metadata, `${repo.slug} repository metadata`);
  const identity = {
    full_name: metadata.full_name,
    id: metadata.id,
    node_id: metadata.node_id,
    default_branch: metadata.default_branch,
  };
  assertExactSnapshot(
    identity,
    {
      full_name: repo.slug,
      id: repo.id,
      node_id: repo.node_id,
      default_branch: repo.default_branch,
    },
    `${repo.slug} repository identity`,
  );
  const rulesetsById = new Map(localRulesets.map((ruleset) => [ruleset.id, ruleset]));
  const listedRulesetActions = new Map(
    repo.legacy_cleanup
      .filter((action) => action.surface === "repository_ruleset")
      .map((action) => [action.ruleset_id, action]),
  );
  const classicActions = repo.legacy_cleanup.filter(
    (action) => action.surface === "classic_required_status_checks",
  );
  for (const ruleset of localRulesets) {
    const legacyCount = rulesetLegacyContextCount(
      ruleset.writable,
      `${repo.slug} local ruleset ${ruleset.id}`,
    );
    if (legacyCount > 0 && !listedRulesetActions.has(ruleset.id)) {
      throw new Error(
        `${repo.slug} local ruleset ${ruleset.id} contains an unmanifested legacy context.`,
      );
    }
  }
  for (const rulesetId of listedRulesetActions.keys()) {
    if (!rulesetsById.has(rulesetId)) {
      const action = listedRulesetActions.get(rulesetId);
      if (action.expected_after !== null) {
        throw new Error(
          `${repo.slug} manifest-bound cleanup ruleset ${rulesetId} is unexpectedly missing.`,
        );
      }
    }
  }
  if (classicLegacyContextCount(classicStatus) > 0 && classicActions.length !== 1) {
    throw new Error(`${repo.slug} classic protection contains an unmanifested legacy context.`);
  }
  const cleanup = repo.legacy_cleanup.map((action) => {
    const actual =
      action.surface === "repository_ruleset"
        ? rulesetsById.get(action.ruleset_id)?.writable ?? null
        : classicStatus;
    return {
      surface:
        action.surface === "repository_ruleset"
          ? `repository_ruleset:${action.ruleset_id}`
          : "classic_required_status_checks",
      state: classifyCleanupSurface(action, actual),
      snapshot: actual,
    };
  });
  assertEffectiveLegacyClosure(repo, manifest, effectiveBranchRules, cleanup);
  return {
    identity,
    default_branch: defaultBranch,
    workflows: workflowControlPlane.canonical,
    workflow_inventory: workflowControlPlane.inventory,
    scheduler_quiescence: workflowControlPlane.scheduler_quiescence,
    codeowners,
    actions_workflow_permissions: actionsWorkflowPermissions,
    v2_ruleset: v2Ruleset,
    canary: canaryEvidence?.[0] ?? null,
    canary_evidence:
      canaryEvidence === null
        ? null
        : {
            v2: canaryEvidence[1],
            legacy_compatibility_status: canaryEvidence[2],
          },
    complete_local_legacy_inventory: {
      rulesets: localRulesets,
      classic_required_status_checks: classicStatus,
    },
    effective_default_branch_rules: effectiveBranchRules,
    legacy_cleanup: cleanup,
  };
}

export async function mapWithConcurrency(
  items,
  limit,
  mapper,
  { onFirstFailure = undefined } = {},
) {
  if (
    !Array.isArray(items) ||
    !Number.isSafeInteger(limit) ||
    limit <= 0
  ) {
    throw new Error("Bounded mapper requires an array and positive safe-integer limit.");
  }
  if (typeof mapper !== "function") {
    throw new Error("Bounded mapper requires a mapper function.");
  }
  if (onFirstFailure !== undefined && typeof onFirstFailure !== "function") {
    throw new Error("Bounded mapper first-failure callback must be a function.");
  }
  const results = new Array(items.length);
  let next = 0;
  let firstError = null;
  const workerCount = Math.min(limit, items.length);
  await Promise.allSettled(
    Array.from({ length: workerCount }, async () => {
      for (;;) {
        if (firstError !== null) return;
        const index = next;
        next += 1;
        if (index >= items.length) return;
        try {
          results[index] = await mapper(items[index], index);
        } catch (error) {
          if (firstError === null) {
            firstError = error;
            onFirstFailure?.(error);
          }
          return;
        }
      }
    }),
  );
  if (firstError !== null) throw firstError;
  return results;
}

async function awaitCoverageEvidence(organizationFactory, repositoriesFactory) {
  // Do not let one evidence branch reject while the other continues in the
  // background. A subsequent stable-read retry must not overlap stale scans
  // or inherit their API work after the caller has already handled an error.
  // Preserve the earliest observed failure even when a repository mapper waits
  // for another already-started worker before its aggregate promise rejects.
  let failureCaptured = false;
  let firstFailure;
  const recordFirstFailure = (error) => {
    if (!failureCaptured) {
      failureCaptured = true;
      firstFailure = error;
    }
  };
  const settle = async (factory) => {
    try {
      return await factory(recordFirstFailure);
    } catch (error) {
      recordFirstFailure(error);
      return undefined;
    }
  };
  const [organization, repositories] = await Promise.all([
    settle(organizationFactory),
    settle(repositoriesFactory),
  ]);
  if (failureCaptured) {
    throw firstFailure;
  }
  return { organization, repositories };
}

async function loadCoverageRound(
  manifest,
  { requireCanaryEvidence = true, legacyEvidenceRuntime = undefined } = {},
) {
  const coverage = await awaitCoverageEvidence(
    () => loadOrganizationRound(manifest),
    (onFirstFailure) =>
      mapWithConcurrency(
        manifest.repositories,
        REPOSITORY_EVIDENCE_CONCURRENCY,
        (repo) =>
          loadRepositoryEvidence(repo, {
            requireCanaryEvidence,
            manifest,
            legacyEvidenceRuntime,
          }),
        { onFirstFailure },
      ),
  );
  assertEffectiveOrganizationGateCoverage(coverage, manifest);
  return coverage;
}

function activationCoverageDeadlineError(label, timeoutMs) {
  return new Error(
    `${label} remained unstable for ${timeoutMs}ms; recovery_code=activation-coverage-evidence-unstable. Keep v1 protection active, repair or wait for the named evidence drift, then start a fresh quiesce/activation preview.`,
  );
}

function activationCoverageRoundDeadlineError(label, timeoutMs) {
  return new Error(
    `${label} could not complete one activation coverage round within ${timeoutMs}ms; recovery_code=activation-coverage-evidence-unstable. Keep v1 protection active, repair or wait for the named evidence drift, then start a fresh quiesce/activation preview.`,
  );
}

function activationRepositoryEvidenceDeadlineError(repo, timeoutMs) {
  return new Error(
    `${repo.slug} could not complete its activation repository evidence within ${timeoutMs}ms; recovery_code=activation-repository-evidence-timeout. Keep v1 protection active, repair or wait for the named control-plane or canary evidence drift, then start a fresh quiesce/activation preview.`,
  );
}

function activationOrganizationEvidenceDeadlineError(timeoutMs) {
  return new Error(
    `Organization activation control-plane evidence could not complete within ${timeoutMs}ms; recovery_code=activation-organization-evidence-timeout. Keep v1 protection active, repair or wait for the named organization evidence drift, then start a fresh quiesce/activation preview.`,
  );
}

function activationSnapshotRuntime(runtime) {
  const supplied = runtime?.stableSnapshotOptions ?? runtime ?? {};
  const sleep = supplied.sleep ?? delay;
  const intervalMs = supplied.intervalMs ?? ACTIVATION_STABILITY_INTERVAL_MS;
  const now = supplied.now ?? performance.now.bind(performance);
  if (
    typeof sleep !== "function" ||
    typeof now !== "function" ||
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < 0
  ) {
    throw new Error("Activation stable snapshot runtime configuration is invalid.");
  }
  return { sleep, now, intervalMs };
}

function activationSchedulerStableSnapshotOptions(manifest, runtime) {
  const supplied = runtime?.stableSnapshotOptions ?? {};
  const { intervalMs } = activationSnapshotRuntime(runtime);
  const timeoutMs = supplied.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < intervalMs) {
    return supplied;
  }
  return {
    ...supplied,
    timeoutMs: Math.max(
      timeoutMs,
      2 * manifest.activation.scheduler_snapshot_timeout_ms + intervalMs,
    ),
  };
}

async function loadBoundedActivationPhase(
  runtime,
  {
    timeoutMs,
    outerDeadlineAt = undefined,
    label,
    onOwnDeadline,
    loader,
  },
) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    typeof label !== "string" ||
    label === "" ||
    typeof onOwnDeadline !== "function" ||
    typeof loader !== "function" ||
    (outerDeadlineAt !== undefined && !Number.isFinite(outerDeadlineAt))
  ) {
    throw new Error("Activation bounded phase configuration is invalid.");
  }
  const { now } = activationSnapshotRuntime(runtime);
  const startedAt = now();
  if (!Number.isFinite(startedAt)) {
    throw new Error(`${label} clock returned an invalid start time.`);
  }
  const ownDeadlineAt = startedAt + timeoutMs;
  if (!Number.isFinite(ownDeadlineAt)) {
    throw new Error(`${label} deadline is invalid.`);
  }
  const deadlineAt =
    outerDeadlineAt === undefined
      ? ownDeadlineAt
      : Math.min(outerDeadlineAt, ownDeadlineAt);
  const ownDeadlineWins = ownDeadlineAt <= deadlineAt;
  const ownDeadlineError = () => {
    const error = onOwnDeadline();
    if (!(error instanceof Error)) {
      throw new Error(`${label} own-deadline callback must return an Error.`);
    }
    return error;
  };
  if (deadlineAt <= startedAt) {
    if (ownDeadlineWins) throw ownDeadlineError();
    throw new DeadlineExceededError(label);
  }
  try {
    const result = await withGhDeadline(deadlineAt, label, () => loader(deadlineAt));
    const completedAt = now();
    if (!Number.isFinite(completedAt)) {
      throw new Error(`${label} clock returned an invalid completion time.`);
    }
    if (completedAt >= deadlineAt) {
      if (ownDeadlineWins) throw ownDeadlineError();
      throw new DeadlineExceededError(label);
    }
    return result;
  } catch (error) {
    if (error instanceof DeadlineExceededError && ownDeadlineWins) {
      throw ownDeadlineError();
    }
    throw error;
  }
}

async function loadBoundedActivationSchedulerSnapshot(
  manifest,
  runtime,
  snapshotOptions,
  { outerDeadlineAt = undefined } = {},
) {
  const repo = activationSchedulerRepository(manifest);
  const timeoutMs = manifest.activation.scheduler_snapshot_timeout_ms;
  return loadBoundedActivationPhase(runtime, {
    timeoutMs,
    outerDeadlineAt,
    label: `${repo.slug} activation scheduler snapshot`,
    onOwnDeadline: () =>
      activationSchedulerSnapshotDeadlineError(repo, timeoutMs),
    loader: () => loadActivationSchedulerSnapshot(manifest, snapshotOptions),
  });
}

async function loadBoundedActivationSchedulerEvidence(
  manifest,
  schedulerRuntime,
  { outerDeadlineAt = undefined, clockRuntime = schedulerRuntime } = {},
) {
  return loadQuiescedActivationSchedulerEvidence(manifest, schedulerRuntime, {
    outerDeadlineAt,
    snapshotRuntime: clockRuntime,
  });
}

async function loadBoundedActivationRepositoryEvidence(
  repo,
  manifest,
  runtime,
  { outerDeadlineAt = undefined } = {},
) {
  const timeoutMs = manifest.activation.repository_evidence_timeout_ms;
  return loadBoundedActivationPhase(runtime, {
    timeoutMs,
    outerDeadlineAt,
    label: `${repo.slug} activation repository evidence`,
    onOwnDeadline: () => activationRepositoryEvidenceDeadlineError(repo, timeoutMs),
    loader: () =>
      loadRepositoryEvidence(repo, {
        manifest,
        legacyEvidenceRuntime: runtime.legacyEvidenceRuntime,
      }),
  });
}

async function loadBoundedActivationOrganizationEvidence(
  manifest,
  runtime,
  { outerDeadlineAt = undefined } = {},
) {
  const timeoutMs = manifest.activation.organization_evidence_timeout_ms;
  return loadBoundedActivationPhase(runtime, {
    timeoutMs,
    outerDeadlineAt,
    label: "Organization activation control-plane evidence",
    onOwnDeadline: () => activationOrganizationEvidenceDeadlineError(timeoutMs),
    loader: () => loadOrganizationRound(manifest),
  });
}

async function loadActivationCoverageRound(
  manifest,
  runtime,
  { outerDeadlineAt = undefined } = {},
) {
  const { sleep, now } = activationSnapshotRuntime(runtime);
  const schedulerRuntime = { ...(runtime.schedulerDrainRuntime ?? {}) };
  if (schedulerRuntime.sleep === undefined) schedulerRuntime.sleep = sleep;
  if (schedulerRuntime.now === undefined) schedulerRuntime.now = now;
  const scheduler = await loadBoundedActivationSchedulerEvidence(
    manifest,
    schedulerRuntime,
    { outerDeadlineAt, clockRuntime: runtime },
  );
  const coverage = await awaitCoverageEvidence(
    () =>
      loadBoundedActivationOrganizationEvidence(manifest, runtime, {
        outerDeadlineAt,
      }),
    (onFirstFailure) =>
      mapWithConcurrency(
        manifest.repositories,
        REPOSITORY_EVIDENCE_CONCURRENCY,
        (repo) =>
          loadBoundedActivationRepositoryEvidence(repo, manifest, runtime, {
            outerDeadlineAt,
          }),
        { onFirstFailure },
      ),
  );
  assertEffectiveOrganizationGateCoverage(coverage, manifest);
  return { ...coverage, activation_scheduler_quiescence: scheduler };
}

async function loadBoundedActivationCoverageRound(
  manifest,
  runtime,
  { outerDeadlineAt = undefined, label },
) {
  const roundTimeoutMs = manifest.activation.coverage_round_timeout_ms;
  return loadBoundedActivationPhase(runtime, {
    timeoutMs: roundTimeoutMs,
    outerDeadlineAt,
    label: `${label} coverage round`,
    onOwnDeadline: () => activationCoverageRoundDeadlineError(label, roundTimeoutMs),
    loader: (deadlineAt) =>
      loadActivationCoverageRound(manifest, runtime, { outerDeadlineAt: deadlineAt }),
  });
}

async function loadStableActivationCoverage(manifest, runtime, label) {
  const { sleep, now, intervalMs } = activationSnapshotRuntime(runtime);
  const timeoutMs = manifest.activation.coverage_stability_timeout_ms;
  const startedAt = now();
  const deadlineAt = startedAt + timeoutMs;
  if (!Number.isFinite(deadlineAt)) {
    throw new Error("Activation coverage deadline is invalid.");
  }
  let lastObservedAt = startedAt;
  const remaining = () => {
    const observedAt = now();
    if (!Number.isFinite(observedAt) || observedAt < lastObservedAt) {
      throw new Error("Activation coverage clock is invalid or moved backwards.");
    }
    lastObservedAt = observedAt;
    return deadlineAt - observedAt;
  };
  for (;;) {
    if (remaining() <= 0) throw activationCoverageDeadlineError(label, timeoutMs);
    try {
      const snapshot = await withGhDeadline(deadlineAt, label, async () => {
        const first = await loadBoundedActivationCoverageRound(manifest, runtime, {
          outerDeadlineAt: deadlineAt,
          label,
        });
        await sleep(Math.min(intervalMs, Math.max(0, remaining())));
        const second = await loadBoundedActivationCoverageRound(manifest, runtime, {
          outerDeadlineAt: deadlineAt,
          label,
        });
        if (canonicalJson(first) !== canonicalJson(second)) {
          throw new RetryableHandoffEvidenceUnstableError(
            `${label} changed between complete activation coverage snapshots.`,
          );
        }
        return first;
      });
      if (remaining() <= 0) throw activationCoverageDeadlineError(label, timeoutMs);
      return snapshot;
    } catch (error) {
      if (!(error instanceof RetryableHandoffEvidenceUnstableError)) {
        if (error instanceof DeadlineExceededError) {
          throw activationCoverageDeadlineError(label, timeoutMs);
        }
        throw error;
      }
      const remainingMs = remaining();
      if (remainingMs <= 0) throw activationCoverageDeadlineError(label, timeoutMs);
      await sleep(Math.min(intervalMs, remainingMs));
    }
  }
}

async function loadActivationCoverageRevalidation(manifest, runtime, label) {
  return loadBoundedActivationCoverageRound(manifest, runtime, { label });
}

async function loadRestoredActivationSchedulerSnapshot(manifest, runtime) {
  const snapshot = await loadBoundedActivationSchedulerSnapshot(
    manifest,
    runtime,
    {
      expectedState: ["active", "disabled_manually"],
      requireCanaryBase: false,
    },
  );
  if (snapshot.workflow.state !== "active") {
    throw new Error(
      `${snapshot.repository.full_name} activation scheduler remains disabled_manually after activation; recovery_code=activation-scheduler-restore-required. Run a fresh restore-scheduler preview/apply, confirm its manifest-bound active readback, then restart the blocked post-activation preview.`,
    );
  }
  return snapshot;
}

async function loadPostActivationRound(manifest, runtime) {
  const [coverage, activationScheduler, legacyOnlyRepository] = await Promise.all([
    loadCoverageRound(manifest, { requireCanaryEvidence: false }),
    loadRestoredActivationSchedulerSnapshot(manifest, runtime),
    loadLegacyOnlyRepositoryIdentity(
      manifest,
      "Legacy-only archived repository identity",
    ),
  ]);
  return {
    ...coverage,
    activation_scheduler: activationScheduler,
    legacy_only_repository: legacyOnlyRepository,
  };
}

function assertCleanupState(snapshot, requiredState) {
  for (const [repoIndex, repository] of snapshot.repositories.entries()) {
    for (const [actionIndex, action] of repository.legacy_cleanup.entries()) {
      if (action.state !== requiredState) {
        throw new Error(
          `${snapshot.repositories[repoIndex].identity.full_name} legacy cleanup action ${actionIndex} must be ${requiredState}; observed ${action.state}.`,
        );
      }
    }
  }
}

function assertCleanupStates(snapshot, allowedStates) {
  for (const [repoIndex, repository] of snapshot.repositories.entries()) {
    for (const [actionIndex, action] of repository.legacy_cleanup.entries()) {
      assertState(
        action.state,
        allowedStates,
        `${snapshot.repositories[repoIndex].identity.full_name} legacy cleanup action ${actionIndex}`,
      );
    }
  }
}

function planDigest(plan) {
  return sha256Canonical(plan);
}

function mutationDescriptor(method, endpoint, payload = undefined) {
  const descriptor = { method, endpoint };
  if (payload !== undefined) {
    descriptor.payload = cloneJson(payload);
    descriptor.payload_sha256 = sha256Canonical(payload);
  }
  return descriptor;
}

function buildRepositoryExternalActionRecords(manifest, snapshot = null) {
  if (
    snapshot !== null &&
    (!Array.isArray(snapshot.repositories) ||
      snapshot.repositories.length !== manifest.repositories.length)
  ) {
    throw new Error("Repository cleanup snapshot does not match the manifest cohort.");
  }
  return manifest.repositories.flatMap((repo, repositoryIndex) =>
    repo.legacy_cleanup.map((action, actionIndex) => {
      const observed = snapshot?.repositories[repositoryIndex]?.legacy_cleanup?.[actionIndex];
      if (snapshot !== null) {
        if (
          observed === undefined ||
          snapshot.repositories[repositoryIndex].identity.full_name !== repo.slug
        ) {
          throw new Error("Repository cleanup snapshot action ordering drifted.");
        }
        assertState(
          observed.state,
          ["before", "after"],
          `${repo.slug} repository cleanup action ${actionIndex}`,
        );
      }
      const derived = deriveRepositoryCleanupAction(action);
      const endpoint =
        action.surface === "repository_ruleset"
          ? repositoryRulesetMutationEndpoint(repo, action.ruleset_id)
          : classicStatusEndpoint(repo);
      const method =
        derived.operation === "delete"
          ? "DELETE"
          : action.surface === "repository_ruleset"
            ? "PUT"
            : "PATCH";
      return {
        repo,
        action,
        state: observed?.state ?? "before",
        derived,
        endpoint,
        method,
      };
    }),
  );
}

function repositoryExternalActionOutput(record) {
  const { repo, action, endpoint, method } = record;
  const result = {
        repository: repo.slug,
        surface: action.surface,
        before_sha256: sha256Canonical(action.expected_before),
        after_sha256:
          action.expected_after === null
            ? null
            : sha256Canonical(action.expected_after),
        mutation: mutationDescriptor(
          method,
          endpoint,
          method === "DELETE" ? undefined : action.expected_after,
        ),
      };
  if (action.surface === "repository_ruleset") {
    result.ruleset_id = action.ruleset_id;
  }
  return result;
}

function buildRepositoryExternalActions(manifest, snapshot = null) {
  return buildRepositoryExternalActionRecords(manifest, snapshot)
    .filter((record) => record.state === "before")
    .map(repositoryExternalActionOutput);
}

async function readExactHandleBytes(handle, size, label) {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(
      bytes,
      offset,
      size - offset,
      offset,
    );
    if (bytesRead === 0) {
      throw new Error(`${label} changed size while it was being read.`);
    }
    offset += bytesRead;
  }
  const trailing = Buffer.alloc(1);
  const { bytesRead: trailingBytes } = await handle.read(trailing, 0, 1, size);
  if (trailingBytes !== 0) {
    throw new Error(`${label} changed size while it was being read.`);
  }
  return bytes;
}

async function readManifest(path) {
  const absolutePath = resolve(path);
  if (
    !Number.isInteger(fsConstants.O_NOFOLLOW) ||
    fsConstants.O_NOFOLLOW <= 0
  ) {
    throw new Error("This platform cannot safely open --manifest without following symlinks.");
  }
  let handle;
  try {
    handle = await open(
      absolutePath,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
  } catch (error) {
    throw new Error(
      `--manifest must name an openable regular, non-symlink file: ${absolutePath} (${error.message})`,
      { cause: error },
    );
  }
  let bytes;
  try {
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      !Number.isSafeInteger(metadata.size) ||
      metadata.size < 0 ||
      metadata.size > MAX_MANIFEST_BYTES
    ) {
      throw new Error(
        `--manifest must be a regular file no larger than ${MAX_MANIFEST_BYTES} bytes: ${absolutePath}`,
      );
    }
    // Protected property: admission and both reads use the same O_NOFOLLOW
    // descriptor, binding one regular-file object. Exact byte equality rejects
    // observed in-place content changes; metadata-only changes are irrelevant.
    const first = await readExactHandleBytes(handle, metadata.size, "--manifest");
    const second = await readExactHandleBytes(handle, metadata.size, "--manifest");
    if (!first.equals(second)) {
      throw new Error("--manifest bytes changed while the file was being read.");
    }
    bytes = first;
  } finally {
    await handle.close();
  }
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    throw new Error("--manifest must be valid UTF-8.");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`--manifest is not valid JSON: ${error.message}`);
  }
  return { path: absolutePath, manifest: validateManifest(parsed) };
}

function readCliOptions(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      manifest: { type: "string" },
      mode: { type: "string" },
      apply: { type: "boolean", default: false },
      "recover-created-v2": { type: "boolean", default: false },
      "expected-plan-sha256": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    return { help: true };
  }
  if (values.manifest === undefined || values.mode === undefined) {
    throw new Error("--manifest PATH and --mode MODE are required.");
  }
  if (!MODES.has(values.mode)) {
    throw new Error(`--mode must be one of: ${[...MODES].join(", ")}.`);
  }
  if (
    values.apply &&
    !new Set([
      "stage",
      "quiesce-scheduler",
      "activate",
      "restore-scheduler",
      "apply-repository-cleanup",
      "verify",
    ]).has(values.mode)
  ) {
    throw new Error(
      "--apply is valid only with stage, quiesce-scheduler, activate, restore-scheduler, apply-repository-cleanup, or verify mode.",
    );
  }
  if (values["recover-created-v2"] && values.mode !== "stage") {
    throw new Error("--recover-created-v2 is valid only with stage mode.");
  }
  if (values["recover-created-v2"] && values.apply) {
    throw new Error("--recover-created-v2 is read-only and cannot be combined with --apply.");
  }
  if (values["recover-created-v2"] && values["expected-plan-sha256"] !== undefined) {
    throw new Error(
      "--recover-created-v2 is read-only and cannot be combined with --expected-plan-sha256.",
    );
  }
  if (values.apply && values["expected-plan-sha256"] === undefined) {
    throw new Error("--apply requires --expected-plan-sha256 from the matching preview.");
  }
  if (!values.apply && values["expected-plan-sha256"] !== undefined) {
    throw new Error("--expected-plan-sha256 is valid only with --apply.");
  }
  if (values["expected-plan-sha256"] !== undefined) {
    assertHex(values["expected-plan-sha256"], 64, "--expected-plan-sha256");
  }
  return {
    help: false,
    manifestPath: values.manifest,
    mode: values.mode,
    apply: values.apply,
    recoverCreatedV2: values["recover-created-v2"],
    expectedPlanSha256: values["expected-plan-sha256"] ?? null,
  };
}

function printUsage() {
  process.stdout.write(`Usage:
  node scripts/organization-review-gate-handoff.mjs --manifest PATH --mode plan
  node scripts/organization-review-gate-handoff.mjs --manifest PATH --mode stage [--apply --expected-plan-sha256 SHA256]
  node scripts/organization-review-gate-handoff.mjs --manifest PATH --mode stage --recover-created-v2
  node scripts/organization-review-gate-handoff.mjs --manifest PATH --mode quiesce-scheduler [--apply --expected-plan-sha256 SHA256]
  node scripts/organization-review-gate-handoff.mjs --manifest PATH --mode activate [--apply --expected-plan-sha256 SHA256]
  node scripts/organization-review-gate-handoff.mjs --manifest PATH --mode restore-scheduler [--apply --expected-plan-sha256 SHA256]
  node scripts/organization-review-gate-handoff.mjs --manifest PATH --mode derive-cutover
  node scripts/organization-review-gate-handoff.mjs --manifest PATH --mode apply-repository-cleanup [--apply --expected-plan-sha256 SHA256]
  node scripts/organization-review-gate-handoff.mjs --manifest PATH --mode verify [--apply --expected-plan-sha256 SHA256]

Modes:
  plan            Read two complete organization snapshots and report the bound phase.
  stage           Preview or create the exact Disabled v2 organization ruleset; --recover-created-v2 is the read-only recovery path for an ambiguous create.
  quiesce-scheduler  Preview or temporarily disable and drain the manifest-bound private overlay scheduler before activation.
  activate        Require a quiesced scheduler plus ${REQUIRED_REPOSITORY_COUNT}/${REQUIRED_REPOSITORY_COUNT} workflow, bridge, repo-ruleset, and canary proof; preview or activate v2.
  restore-scheduler  Preview or re-enable the manifest-bound private overlay scheduler after activation or recovery.
  derive-cutover  Read-only derivation of remaining manifest-bound repository cleanup actions and the later organization cutover.
  apply-repository-cleanup  Preview or apply the remaining repository cleanup actions with per-action exact-before/readback checks.
  verify          Verify external repository cleanup; preview or apply removal of the whole legacy organization status rule, then close with two reads.

All mutation modes default to preview. Every --apply requires the exact plan digest emitted by its immediately matching preview. Repository cleanup writes require the documented organization/repository policy-mutation freeze because GitHub does not offer a supported compare-and-swap precondition for these endpoints.
`);
}

function baseOutput(mode, manifest, snapshot) {
  return {
    schema_version: OUTPUT_SCHEMA_VERSION,
    mode,
    organization: cloneJson(manifest.organization),
    manifest_sha256: sha256Canonical(manifest),
    snapshot_sha256: sha256Canonical(snapshot),
  };
}

export function buildFinalClosureReceipt(manifest, snapshot) {
  if (
    snapshot.organization.legacy_state !== "after" ||
    snapshot.organization.v2_state !== "active"
  ) {
    throw new Error("Final closure receipt requires an active v2 and removed legacy organization rule.");
  }
  const repositories = canonicalFinalClosureRepositoryIdentities(
    snapshot.repositories.map((repository) => repository.identity),
  );
  const manifestRepositories = canonicalFinalClosureRepositoryIdentities(
    manifest.repositories.map((repository) => ({
      full_name: repository.slug,
      id: repository.id,
      node_id: repository.node_id,
      default_branch: repository.default_branch,
    })),
  );
  if (
    repositories.length !== REQUIRED_REPOSITORY_COUNT ||
    manifestRepositories.length !== REQUIRED_REPOSITORY_COUNT
  ) {
    throw new Error("Final closure receipt requires the complete repository cohort.");
  }
  if (canonicalJson(repositories) !== canonicalJson(manifestRepositories)) {
    throw new Error(
      "Final closure receipt requires the stable observed repository identity cohort to exactly match manifest.repositories.",
    );
  }
  return {
    schema_version: FINAL_CLOSURE_RECEIPT_SCHEMA_VERSION,
    organization: cloneJson(snapshot.organization.organization),
    manifest_sha256: sha256Canonical(manifest),
    snapshot_sha256: sha256Canonical(snapshot),
    legacy_ruleset: {
      id: snapshot.organization.legacy.id,
      state: snapshot.organization.legacy_state,
    },
    v2_ruleset: {
      id: snapshot.organization.v2.id,
      state: snapshot.organization.v2_state,
    },
    manifest_repositories: manifestRepositories,
    repositories,
  };
}

function canonicalFinalClosureRepositoryIdentities(repositories) {
  return repositories
    .map((repository) => cloneJson(repository))
    .sort((left, right) =>
      Buffer.compare(
        Buffer.from(left.full_name, "utf8"),
        Buffer.from(right.full_name, "utf8"),
      )
    );
}

function finalClosureReceiptOutput(manifest, snapshot) {
  const receipt = buildFinalClosureReceipt(manifest, snapshot);
  return {
    final_closure_receipt: receipt,
    final_closure_receipt_sha256: sha256Canonical(receipt),
  };
}

function assertExpectedPlan(options, digest) {
  if (options.apply && options.expectedPlanSha256 !== digest) {
    throw new Error(
      `--expected-plan-sha256 does not match this exact live plan (expected ${digest}).`,
    );
  }
}

async function runPlanMode(manifest, runtime) {
  const snapshot = await loadStable("Organization handoff snapshot", () =>
    loadOrganizationRound(manifest),
    runtime.stableSnapshotOptions,
  );
  return {
    ...baseOutput("plan", manifest, snapshot),
    status: "verified",
    legacy_ruleset_state: snapshot.legacy_state,
    v2_ruleset_state: snapshot.v2_state,
    required_repository_count: REQUIRED_REPOSITORY_COUNT,
    repository_cleanup_action_count:
      manifest.expected_legacy_cleanup_action_count,
  };
}

async function loadRecoverableStageSnapshot(
  manifest,
  runtime,
  { expectedCreatedId = null, label = "Recoverable v2 organization ruleset" } = {},
) {
  if (manifest.v2_ruleset.id !== null) {
    throw new Error("v2 stage recovery requires manifest.v2_ruleset.id to be null.");
  }
  if (expectedCreatedId !== null) {
    assertPositiveInteger(expectedCreatedId, "Recovered v2 organization ruleset ID");
  }
  const snapshot = await loadStable(label, () =>
    loadOrganizationRound(manifest, { allowUnboundV2: true }),
    runtime.stableSnapshotOptions,
  );
  assertState(snapshot.legacy_state, ["before"], "Legacy organization ruleset");
  assertState(snapshot.v2_state, ["disabled"], "Recoverable v2 organization ruleset");
  if (snapshot.v2 === null) {
    throw new Error("No recoverable v2 organization ruleset exists.");
  }
  if (expectedCreatedId !== null && snapshot.v2.id !== expectedCreatedId) {
    throw new Error(
      "Recovered v2 organization ruleset ID does not match the post request's exact receipt.",
    );
  }
  return snapshot;
}

function assertStageRecoveryTransition(before, after, expectedCreatedId = null) {
  if (
    canonicalJson(before.organization) !== canonicalJson(after.organization) ||
    canonicalJson(before.legacy) !== canonicalJson(after.legacy) ||
    before.legacy_state !== "before" ||
    after.legacy_state !== "before" ||
    after.v2 === null
  ) {
    throw new Error(
      "Stage recovery observed organization or legacy ruleset drift and cannot adopt a candidate.",
    );
  }
  if (expectedCreatedId !== null && after.v2.id !== expectedCreatedId) {
    throw new Error(
      "Stage recovery candidate differs from the ID returned by the original POST receipt.",
    );
  }
  const priorSummaries = before.summaries;
  const recoveredSummaries = after.summaries.filter(
    (summary) => summary.id !== after.v2.id,
  );
  if (canonicalJson(priorSummaries) !== canonicalJson(recoveredSummaries)) {
    throw new Error(
      "Stage recovery observed an organization ruleset inventory change beyond the one v2 candidate.",
    );
  }
}

function stageRecoveryOutput(
  manifest,
  snapshot,
  { status, action, planSha256, applied = false },
) {
  return {
    ...baseOutput("stage", manifest, snapshot),
    status,
    applied,
    ...(planSha256 === undefined ? {} : { plan_sha256: planSha256 }),
    ...(action === undefined ? {} : { action }),
    created_v2_ruleset_id: snapshot.v2.id,
    next_manifest_update: {
      v2_ruleset: { id: snapshot.v2.id, name: V2_RULESET_NAME },
    },
  };
}

async function runStageMode(manifest, options, runtime) {
  if (options.recoverCreatedV2) {
    const snapshot = await loadRecoverableStageSnapshot(manifest, runtime, {
      label: "Explicit v2 organization ruleset stage recovery",
    });
    return stageRecoveryOutput(manifest, snapshot, {
      status: "recovered-created-v2",
    });
  }
  const snapshot = await loadStable("Organization staging precondition", () =>
    loadOrganizationRound(manifest),
    runtime.stableSnapshotOptions,
  );
  assertState(snapshot.legacy_state, ["before"], "Legacy organization ruleset");
  assertState(
    snapshot.v2_state,
    manifest.v2_ruleset.id === null ? ["absent"] : ["disabled", "active"],
    "v2 organization ruleset",
  );
  const desired = buildV2OrganizationRulesetPayload(manifest, "disabled");
  const action =
    snapshot.v2_state === "absent"
      ? mutationDescriptor(
          "POST",
          `orgs/${encodeURIComponent(manifest.organization.login)}/rulesets`,
          desired,
        )
      : null;
  const plan = {
    mode: "stage",
    manifest_sha256: sha256Canonical(manifest),
    snapshot_sha256: sha256Canonical(snapshot),
    action,
  };
  const digest = planDigest(plan);
  assertExpectedPlan(options, digest);
  if (!options.apply || action === null) {
    return {
      ...baseOutput("stage", manifest, snapshot),
      status: action === null ? "verified" : "preview",
      applied: false,
      plan_sha256: digest,
      action,
      v2_ruleset_state: snapshot.v2_state,
    };
  }
  await revalidateUnchangedBeforeMutation(
    "Organization staging precondition",
    snapshot,
    () => loadOrganizationRound(manifest),
  );
  let createdId = null;
  try {
    const response = await ghJson(action.endpoint, { method: "POST", body: desired });
    if (Number.isSafeInteger(response?.id) && response.id > 0) {
      createdId = response.id;
    }
    const created = writableRulesetFromApi(
      response,
      "Organization",
      manifest.organization.login,
      "Created v2 organization ruleset",
    );
    assertExactOrganizationRulesetSnapshot(
      created.writable,
      desired,
      "Created v2 organization ruleset",
    );
    if (
      created.id === manifest.legacy_ruleset.id ||
      snapshot.summaries.some((summary) => summary.id === created.id)
    ) {
      throw new Error("Create response did not return a fresh v2 ruleset ID.");
    }
    createdId = created.id;
    const boundManifest = cloneJson(manifest);
    boundManifest.v2_ruleset.id = created.id;
    const readback = await loadStable("Staged v2 organization ruleset readback", () =>
      loadOrganizationRound(boundManifest),
      runtime.stableSnapshotOptions,
    );
    assertState(readback.legacy_state, ["before"], "Legacy organization ruleset");
    assertState(readback.v2_state, ["disabled"], "v2 organization ruleset");
    return {
      ...baseOutput("stage", manifest, readback),
      status: "applied",
      applied: true,
      plan_sha256: digest,
      action,
      created_v2_ruleset_id: created.id,
      next_manifest_update: { v2_ruleset: { id: created.id, name: V2_RULESET_NAME } },
    };
  } catch (error) {
    try {
      const recovered = await loadRecoverableStageSnapshot(manifest, runtime, {
        expectedCreatedId: createdId,
        label: "Ambiguous v2 organization ruleset stage recovery",
      });
      assertStageRecoveryTransition(snapshot, recovered, createdId);
      return stageRecoveryOutput(manifest, recovered, {
        status: "applied-recovered",
        action,
        planSha256: digest,
        applied: true,
      });
    } catch (recoveryError) {
      throw new Error(
        "Stage creation outcome is unknown; do not replay POST. Run stage --recover-created-v2 under the organization policy-mutation freeze.",
        { cause: recoveryError ?? error },
      );
    }
  }
}

function schedulerTransitionIdentity(snapshot) {
  return {
    repository: snapshot.repository,
    default_branch: snapshot.default_branch,
    workflow: {
      id: snapshot.workflow.id,
      path: snapshot.workflow.path,
      source: snapshot.workflow.source,
    },
  };
}

function assertSchedulerTransition(before, after, expectedBefore, expectedAfter, label) {
  if (
    before.workflow.state !== expectedBefore ||
    after.workflow.state !== expectedAfter ||
    canonicalJson(schedulerTransitionIdentity(before)) !==
      canonicalJson(schedulerTransitionIdentity(after))
  ) {
    throw new Error(
      `${label} did not preserve the manifest-bound scheduler identity/source or exact expected state transition.`,
    );
  }
}

function schedulerModePlan(manifest, mode, snapshot, action) {
  return {
    mode,
    manifest_sha256: sha256Canonical(manifest),
    snapshot_sha256: sha256Canonical(snapshot),
    action,
  };
}

async function runQuiesceSchedulerMode(manifest, options, runtime) {
  const repo = activationSchedulerRepository(manifest);
  const scheduler = repo.scheduler_quiescence;
  const label = "Activation scheduler quiesce precondition";
  const snapshot = await loadStable(
    label,
    () =>
      loadBoundedActivationSchedulerSnapshot(
        manifest,
        runtime,
        { expectedState: "active" },
      ),
    activationSchedulerStableSnapshotOptions(manifest, runtime),
  );
  const action = mutationDescriptor(
    "PUT",
    activationSchedulerEndpoint(repo, scheduler.workflow_id, "disable"),
  );
  const plan = schedulerModePlan(manifest, "quiesce-scheduler", snapshot, action);
  const digest = planDigest(plan);
  assertExpectedPlan(options, digest);
  if (!options.apply) {
    return {
      ...baseOutput("quiesce-scheduler", manifest, snapshot),
      status: "preview",
      applied: false,
      plan_sha256: digest,
      action,
      scheduler_quiescence: snapshot,
    };
  }
  await revalidateUnchangedBeforeMutation(label, snapshot, () =>
    loadBoundedActivationSchedulerSnapshot(
      manifest,
      runtime,
      { expectedState: "active" },
    ),
  );
  let disabled;
  try {
    await ghJson(action.endpoint, { method: "PUT" });
    disabled = await loadBoundedActivationSchedulerSnapshot(
      manifest,
      runtime,
      { expectedState: "disabled_manually" },
    );
  } catch (error) {
    try {
      disabled = await loadBoundedActivationSchedulerSnapshot(
        manifest,
        runtime,
        { expectedState: "disabled_manually" },
      );
    } catch (recoveryError) {
      throw new Error(
        `Activation scheduler disable outcome is unknown; recovery_code=activation-scheduler-state-unknown. Do not replay the disable request. Inspect the manifest-bound scheduler state, then run a fresh quiesce preview if it is active or restore-scheduler only if disabled_manually is intentional.`,
        { cause: recoveryError ?? error },
      );
    }
  }
  try {
    assertSchedulerTransition(snapshot, disabled, "active", "disabled_manually", label);
    const schedulerRuntime = { ...(runtime.schedulerDrainRuntime ?? {}) };
    if (schedulerRuntime.sleep === undefined) {
      schedulerRuntime.sleep = activationSnapshotRuntime(runtime).sleep;
    }
    if (schedulerRuntime.now === undefined) {
      schedulerRuntime.now = activationSnapshotRuntime(runtime).now;
    }
    const drained = await loadQuiescedActivationSchedulerEvidence(
      manifest,
      schedulerRuntime,
      { snapshotRuntime: runtime },
    );
    assertSchedulerTransition(
      disabled,
      drained,
      "disabled_manually",
      "disabled_manually",
      "Activation scheduler drain",
    );
    return {
      ...baseOutput("quiesce-scheduler", manifest, drained),
      status: "applied-drained",
      applied: true,
      plan_sha256: digest,
      action,
      scheduler_quiescence: drained,
      next_action:
        "Run a fresh activate preview while the scheduler remains disabled_manually.",
    };
  } catch (error) {
    throw new Error(
      `${error.message} recovery_code=activation-scheduler-restore-required. The manifest-bound scheduler remains disabled_manually; do not activate v2 until its current state and any started run are understood.`,
      { cause: error },
    );
  }
}

async function runRestoreSchedulerMode(manifest, options, runtime) {
  const repo = activationSchedulerRepository(manifest);
  const scheduler = repo.scheduler_quiescence;
  const label = "Activation scheduler restore precondition";
  const snapshot = await loadStable(
    label,
    () =>
      loadBoundedActivationSchedulerSnapshot(
        manifest,
        runtime,
        {
          expectedState: ["active", "disabled_manually"],
          requireCanaryBase: false,
        },
      ),
    activationSchedulerStableSnapshotOptions(manifest, runtime),
  );
  const action =
    snapshot.workflow.state === "disabled_manually"
      ? mutationDescriptor(
          "PUT",
          activationSchedulerEndpoint(repo, scheduler.workflow_id, "enable"),
        )
      : null;
  const plan = schedulerModePlan(manifest, "restore-scheduler", snapshot, action);
  const digest = planDigest(plan);
  assertExpectedPlan(options, digest);
  if (!options.apply || action === null) {
    return {
      ...baseOutput("restore-scheduler", manifest, snapshot),
      status: action === null ? "verified-active" : "preview",
      applied: false,
      plan_sha256: digest,
      action,
      scheduler_quiescence: snapshot,
    };
  }
  await revalidateUnchangedBeforeMutation(label, snapshot, () =>
    loadBoundedActivationSchedulerSnapshot(
      manifest,
      runtime,
      {
        expectedState: "disabled_manually",
        requireCanaryBase: false,
      },
    ),
  );
  let active;
  try {
    await ghJson(action.endpoint, { method: "PUT" });
    active = await loadBoundedActivationSchedulerSnapshot(
      manifest,
      runtime,
      {
        expectedState: "active",
        requireCanaryBase: false,
      },
    );
  } catch (error) {
    try {
      active = await loadBoundedActivationSchedulerSnapshot(
        manifest,
        runtime,
        {
          expectedState: "active",
          requireCanaryBase: false,
        },
      );
    } catch (recoveryError) {
      throw new Error(
        `Activation scheduler enable outcome is unknown; recovery_code=activation-scheduler-state-unknown. Do not replay the enable request. Inspect the manifest-bound scheduler state before choosing a fresh restore preview.`,
        { cause: recoveryError ?? error },
      );
    }
  }
  assertSchedulerTransition(snapshot, active, "disabled_manually", "active", label);
  return {
    ...baseOutput("restore-scheduler", manifest, active),
    status: "applied-restored",
    applied: true,
    plan_sha256: digest,
    action,
    scheduler_quiescence: active,
  };
}

function assertCoveragePhase(snapshot, { legacyState, v2State, cleanupState }) {
  assertState(
    snapshot.organization.legacy_state,
    [legacyState],
    "Legacy organization ruleset",
  );
  assertState(
    snapshot.organization.v2_state,
    Array.isArray(v2State) ? v2State : [v2State],
    "v2 organization ruleset",
  );
  if (cleanupState !== undefined) {
    assertCleanupState(snapshot, cleanupState);
  }
}

async function runActivateMode(manifest, options, runtime) {
  if (manifest.v2_ruleset.id === null) {
    throw new Error("activate mode requires manifest.v2_ruleset.id from stage readback.");
  }
  const activationCoverageLabel =
    `${REQUIRED_REPOSITORY_COUNT}/${REQUIRED_REPOSITORY_COUNT} activation coverage`;
  try {
    // This narrow preflight deliberately happens before the broader coverage
    // read. A scheduler that is already active is not a safe starting point for
    // the legacy-writer proof; quiesce-scheduler owns that state transition.
    // Keep it inside the recovery boundary: quiesce may already have left the
    // scheduler disabled_manually when a transient control-plane read fails.
    await loadBoundedActivationSchedulerSnapshot(
      manifest,
      runtime,
      { expectedState: "disabled_manually" },
    );
    const snapshot = await loadStableActivationCoverage(
      manifest,
      runtime,
      activationCoverageLabel,
    );
    assertCoveragePhase(snapshot, {
      legacyState: "before",
      v2State: ["disabled", "active"],
      cleanupState: "before",
    });
    const action =
      snapshot.organization.v2_state === "disabled"
        ? mutationDescriptor(
            "PUT",
            organizationRulesetEndpoint(manifest, manifest.v2_ruleset.id),
            buildV2OrganizationRulesetPayload(manifest, "active"),
          )
        : null;
    const plan = {
      mode: "activate",
      manifest_sha256: sha256Canonical(manifest),
      snapshot_sha256: sha256Canonical(snapshot),
      scheduler_quiescence: snapshot.activation_scheduler_quiescence,
      action,
    };
    const digest = planDigest(plan);
    assertExpectedPlan(options, digest);
    if (!options.apply || action === null) {
      return {
        ...baseOutput("activate", manifest, snapshot),
        status: action === null ? "verified-dual-enforcement" : "preview",
        applied: false,
        plan_sha256: digest,
        action,
        scheduler_quiescence: snapshot.activation_scheduler_quiescence,
        coverage: {
          repositories_verified: snapshot.repositories.length,
          required: REQUIRED_REPOSITORY_COUNT,
          legacy_bridge: true,
          v2: true,
        },
        ...(action === null
          ? {
              next_action:
                "Run restore-scheduler preview/apply after confirming this is the intended dual-enforcement state.",
            }
          : {}),
      };
    }
    await revalidateUnchangedBeforeMutation(
      activationCoverageLabel,
      snapshot,
      () =>
        loadActivationCoverageRevalidation(
          manifest,
          runtime,
          `${activationCoverageLabel} immediate revalidation`,
        ),
    );
    const response = await ghJson(action.endpoint, {
      method: "PUT",
      body: action.payload,
    });
    const updated = writableRulesetFromApi(
      response,
      "Organization",
      manifest.organization.login,
      "Activated v2 organization ruleset",
    );
    if (updated.id !== manifest.v2_ruleset.id) {
      throw new Error("v2 activation response returned the wrong ruleset ID.");
    }
    assertExactOrganizationRulesetSnapshot(
      updated.writable,
      action.payload,
      "Activated v2 organization ruleset",
    );
    const readback = await loadStableActivationCoverage(
      manifest,
      runtime,
      "Active dual-enforcement readback",
    );
    assertCoveragePhase(readback, {
      legacyState: "before",
      v2State: "active",
      cleanupState: "before",
    });
    return {
      ...baseOutput("activate", manifest, readback),
      status: "applied-dual-enforcement-verified",
      applied: true,
      plan_sha256: digest,
      action,
      scheduler_quiescence: readback.activation_scheduler_quiescence,
      coverage: {
        repositories_verified: readback.repositories.length,
        required: REQUIRED_REPOSITORY_COUNT,
        legacy_bridge: true,
        v2: true,
      },
      next_action: "Run restore-scheduler preview/apply after the documented dual-enforcement readback.",
    };
  } catch (error) {
    throw new Error(
      `${error.message} recovery_code=activation-scheduler-reconcile-required. The scheduler was required to be disabled_manually before activation; inspect its current state. If it remains disabled, use restore-scheduler only after deciding whether the interrupted activation reached dual enforcement; otherwise restore or re-quiesce and start with a fresh activation preview.`,
      { cause: error },
    );
  }
}

async function runDeriveCutoverMode(manifest, runtime) {
  if (manifest.v2_ruleset.id === null) {
    throw new Error("derive-cutover requires manifest.v2_ruleset.id.");
  }
  const snapshot = await loadStable("Dual-enforcement cutover derivation", () =>
    loadPostActivationRound(manifest, runtime),
    runtime.stableSnapshotOptions,
  );
  assertCoveragePhase(snapshot, {
    legacyState: "before",
    v2State: "active",
  });
  assertCleanupStates(snapshot, ["before", "after"]);
  const externalActions = buildRepositoryExternalActions(manifest, snapshot);
  const completedActionCount =
    manifest.expected_legacy_cleanup_action_count - externalActions.length;
  const organizationAction = mutationDescriptor(
    "PUT",
    organizationRulesetEndpoint(manifest, manifest.legacy_ruleset.id),
    deriveLegacyOrganizationCutoverPayload(manifest),
  );
  const plan = {
    mode: "derive-cutover",
    manifest_sha256: sha256Canonical(manifest),
    snapshot_sha256: sha256Canonical(snapshot),
    external_repository_actions: externalActions,
    completed_repository_cleanup_action_count: completedActionCount,
    organization_action_after_external_verification: organizationAction,
  };
  return {
    ...baseOutput("derive-cutover", manifest, snapshot),
    status: "derived-read-only",
    plan_sha256: planDigest(plan),
    external_repository_actions: externalActions,
    completed_repository_cleanup_action_count: completedActionCount,
    organization_action_after_external_verification: organizationAction,
    sequencing: [
      "apply-repository-cleanup-preview",
      "apply-repository-cleanup-with-exact-plan-digest",
      "run-verify-preview",
      "run-verify-apply-with-exact-plan-digest",
      "run-verify-again-for-final-two-read-closure",
    ],
  };
}

async function loadRepositoryCleanupSurface(repo, action) {
  if (action.surface === "repository_ruleset") {
    const response = await ghJson(
      repositoryRulesetEndpoint(repo, action.ruleset_id),
      { allowNotFound: action.expected_after === null },
    );
    if (response === GH_NOT_FOUND) return null;
    const ruleset = writableRulesetFromApi(
      response,
      "Repository",
      repo.slug,
      `${repo.slug} repository cleanup ruleset ${action.ruleset_id}`,
    );
    if (ruleset.id !== action.ruleset_id) {
      throw new Error(`${repo.slug} repository cleanup ruleset returned the wrong ID.`);
    }
    return ruleset.writable;
  }
  if (action.surface === "classic_required_status_checks") {
    return loadClassicStatusSurface(repo);
  }
  throw new Error("Unsupported repository cleanup surface.");
}

async function loadManifestBoundRepositoryCleanupIdentity(repo, label) {
  const metadata = await ghJson(`repos/${encodeEndpointPath(repo.slug)}`);
  assertPlainObject(metadata, `${label} repository metadata`);
  const identity = {
    full_name: metadata.full_name,
    id: metadata.id,
    node_id: metadata.node_id,
    default_branch: metadata.default_branch,
  };
  // Protected property: the cleanup route still selects the exact manifest-bound
  // repository object and default-branch target. id/node_id bind object identity,
  // full_name detects redirect/rename/transfer or same-slug reuse, and
  // default_branch binds the branch selector; unrelated metadata churn is ignored.
  assertExactSnapshot(
    identity,
    {
      full_name: repo.slug,
      id: repo.id,
      node_id: repo.node_id,
      default_branch: repo.default_branch,
    },
    label,
  );
  return identity;
}

async function classifyLiveRepositoryCleanupSurface(record) {
  await loadManifestBoundRepositoryCleanupIdentity(
    record.repo,
    `${record.repo.slug} repository cleanup identity before surface read`,
  );
  const actual = await loadRepositoryCleanupSurface(record.repo, record.action);
  return {
    actual,
    state: classifyCleanupSurface(record.action, actual),
  };
}

async function executeRepositoryCleanupRecord(record) {
  const initial = await classifyLiveRepositoryCleanupSurface(record);
  if (initial.state === "after") {
    return { ...record, outcome: "already-reconciled" };
  }
  const payload =
    record.method === "DELETE" ? undefined : record.action.expected_after;
  // The external policy-mutation freeze is the accepted protection for the
  // unavoidable final GET-to-write gap. Still, reread the selected surface
  // immediately before the final identity check so a policy change observed
  // between the initial checkpoint and this write cannot be overwritten by
  // this executor. The following identity read must remain adjacent to the
  // write boundary: otherwise a same-slug replacement could make this exact
  // surface read describe a different repository object.
  // `classifyCleanupSurface` accepts only the manifest's exact before/after
  // bytes; a third state fails closed before the mutation.
  const immediatelyBeforeMutation = classifyCleanupSurface(
    record.action,
    await loadRepositoryCleanupSurface(record.repo, record.action),
  );
  if (immediatelyBeforeMutation === "after") {
    return { ...record, outcome: "already-reconciled-immediately-before-write" };
  }
  await loadManifestBoundRepositoryCleanupIdentity(
    record.repo,
    `${record.repo.slug} repository cleanup identity after final surface read immediately before mutation`,
  );
  try {
    await ghJson(record.endpoint, { method: record.method, body: payload });
  } catch (error) {
    let reconciliation;
    try {
      reconciliation = await classifyLiveRepositoryCleanupSurface(record);
    } catch (readbackError) {
      throw new Error(
        `${record.repo.slug} repository cleanup write outcome is unknown; do not replay it. Re-run a fresh apply-repository-cleanup preview under the policy-mutation freeze.`,
        { cause: readbackError },
      );
    }
    if (reconciliation.state === "after") {
      return { ...record, outcome: "reconciled-after-write-error" };
    }
    throw new Error(
      `${record.repo.slug} repository cleanup write did not reach its expected-after state; do not replay it. Re-run a fresh preview after resolving the error.`,
      { cause: error },
    );
  }
  const readback = await classifyLiveRepositoryCleanupSurface(record);
  if (readback.state !== "after") {
    throw new Error(
      `${record.repo.slug} repository cleanup write did not produce its exact expected-after state.`,
    );
  }
  return { ...record, outcome: "applied" };
}

async function runApplyRepositoryCleanupMode(manifest, options, runtime) {
  if (manifest.v2_ruleset.id === null) {
    throw new Error("apply-repository-cleanup requires manifest.v2_ruleset.id.");
  }
  const snapshot = await loadStable("Repository cleanup precondition", () =>
    loadPostActivationRound(manifest, runtime),
    runtime.stableSnapshotOptions,
  );
  assertCoveragePhase(snapshot, {
    legacyState: "before",
    v2State: "active",
  });
  assertCleanupStates(snapshot, ["before", "after"]);
  const pendingRecords = buildRepositoryExternalActionRecords(manifest, snapshot)
    .filter((record) => record.state === "before");
  const externalActions = pendingRecords.map(repositoryExternalActionOutput);
  const plan = {
    mode: "apply-repository-cleanup",
    manifest_sha256: sha256Canonical(manifest),
    snapshot_sha256: sha256Canonical(snapshot),
    external_repository_actions: externalActions,
  };
  const digest = planDigest(plan);
  assertExpectedPlan(options, digest);
  if (!options.apply || pendingRecords.length === 0) {
    return {
      ...baseOutput("apply-repository-cleanup", manifest, snapshot),
      status:
        pendingRecords.length === 0
          ? "verified-repository-cleanup"
          : "preview",
      applied: false,
      plan_sha256: digest,
      external_repository_actions: externalActions,
      completed_repository_cleanup_action_count:
        manifest.expected_legacy_cleanup_action_count - pendingRecords.length,
    };
  }
  await revalidateUnchangedBeforeMutation(
    "Repository cleanup precondition",
    snapshot,
    () => loadPostActivationRound(manifest, runtime),
  );
  const outcomes = [];
  for (const record of pendingRecords) {
    outcomes.push(await executeRepositoryCleanupRecord(record));
  }
  const readback = await loadStable("Repository cleanup readback", () =>
    loadPostActivationRound(manifest, runtime),
    runtime.stableSnapshotOptions,
  );
  assertCoveragePhase(readback, {
    legacyState: "before",
    v2State: "active",
    cleanupState: "after",
  });
  return {
    ...baseOutput("apply-repository-cleanup", manifest, readback),
    status: "applied-repository-cleanup-verified",
    applied: true,
    plan_sha256: digest,
    external_repository_actions: externalActions,
    execution_outcomes: outcomes.map(({ repo, action, outcome }) => ({
      repository: repo.slug,
      surface:
        action.surface === "repository_ruleset"
          ? `repository_ruleset:${action.ruleset_id}`
          : action.surface,
      outcome,
    })),
    repositories_verified: readback.repositories.length,
  };
}

async function runVerifyMode(manifest, options, runtime) {
  if (manifest.v2_ruleset.id === null) {
    throw new Error("verify requires manifest.v2_ruleset.id.");
  }
  const snapshot = await loadStable("Post-repository-cleanup verification", () =>
    loadPostActivationRound(manifest, runtime),
    runtime.stableSnapshotOptions,
  );
  assertState(
    snapshot.organization.legacy_state,
    ["before", "after"],
    "Legacy organization ruleset",
  );
  assertState(snapshot.organization.v2_state, ["active"], "v2 organization ruleset");
  assertCleanupState(snapshot, "after");
  const action =
    snapshot.organization.legacy_state === "before"
      ? mutationDescriptor(
          "PUT",
          organizationRulesetEndpoint(manifest, manifest.legacy_ruleset.id),
          deriveLegacyOrganizationCutoverPayload(manifest),
        )
      : null;
  const plan = {
    mode: "verify",
    manifest_sha256: sha256Canonical(manifest),
    snapshot_sha256: sha256Canonical(snapshot),
    action,
  };
  const digest = planDigest(plan);
  assertExpectedPlan(options, digest);
  if (!options.apply || action === null) {
    const output = {
      ...baseOutput("verify", manifest, snapshot),
      status: action === null ? "final-verified" : "preview-cutover-ready",
      applied: false,
      plan_sha256: digest,
      action,
      repositories_verified: snapshot.repositories.length,
    };
    return action === null
      ? { ...output, ...finalClosureReceiptOutput(manifest, snapshot) }
      : output;
  }
  await revalidateUnchangedBeforeMutation(
    "Post-repository-cleanup verification",
    snapshot,
    () => loadPostActivationRound(manifest, runtime),
  );
  if (runtime.beforeFinalLegacyRevalidation !== undefined) {
    await runtime.beforeFinalLegacyRevalidation();
  }
  await revalidateLegacyOrganizationRuleImmediatelyBeforeCutover(
    manifest,
    snapshot,
  );
  await revalidateLegacyOnlyRepositoryImmediatelyBeforeCutover(
    manifest,
    snapshot,
  );
  await revalidateActivationSchedulerImmediatelyBeforeCutover(
    manifest,
    snapshot,
    runtime,
  );
  const response = await ghJson(action.endpoint, {
    method: "PUT",
    body: action.payload,
  });
  const updated = writableRulesetFromApi(
    response,
    "Organization",
    manifest.organization.login,
    "Legacy organization cutover response",
  );
  if (updated.id !== manifest.legacy_ruleset.id) {
    throw new Error("Legacy organization cutover response returned the wrong ruleset ID.");
  }
  assertExactOrganizationRulesetSnapshot(
    updated.writable,
    action.payload,
    "Legacy organization cutover response",
  );
  const readback = await loadStable("Final organization handoff closure", () =>
    loadPostActivationRound(manifest, runtime),
    runtime.stableSnapshotOptions,
  );
  assertCoveragePhase(readback, {
    legacyState: "after",
    v2State: "active",
    cleanupState: "after",
  });
  return {
    ...baseOutput("verify", manifest, readback),
    status: "applied-final-verified",
    applied: true,
    plan_sha256: digest,
    action,
    repositories_verified: readback.repositories.length,
  };
}

export async function runCli(
  argv = process.argv.slice(2),
  {
    stableSnapshotOptions = undefined,
    legacyEvidenceRuntime = undefined,
    schedulerDrainRuntime = undefined,
    beforeFinalLegacyRevalidation = undefined,
    writeOutput = process.stdout.write.bind(process.stdout),
  } = {},
) {
  if (typeof writeOutput !== "function") {
    throw new Error("CLI runtime writeOutput must be a function.");
  }
  if (
    beforeFinalLegacyRevalidation !== undefined &&
    typeof beforeFinalLegacyRevalidation !== "function"
  ) {
    throw new Error(
      "CLI runtime beforeFinalLegacyRevalidation must be a function when provided.",
    );
  }
  const runtime = {
    stableSnapshotOptions,
    legacyEvidenceRuntime,
    schedulerDrainRuntime,
    beforeFinalLegacyRevalidation,
  };
  const options = readCliOptions(argv);
  if (options.help) {
    printUsage();
    return null;
  }
  const { manifest } = await readManifest(options.manifestPath);
  let output;
  switch (options.mode) {
    case "plan":
      output = await runPlanMode(manifest, runtime);
      break;
    case "stage":
      output = await runStageMode(manifest, options, runtime);
      break;
    case "quiesce-scheduler":
      output = await runQuiesceSchedulerMode(manifest, options, runtime);
      break;
    case "activate":
      output = await runActivateMode(manifest, options, runtime);
      break;
    case "restore-scheduler":
      output = await runRestoreSchedulerMode(manifest, options, runtime);
      break;
    case "derive-cutover":
      output = await runDeriveCutoverMode(manifest, runtime);
      break;
    case "apply-repository-cleanup":
      output = await runApplyRepositoryCleanupMode(manifest, options, runtime);
      break;
    case "verify":
      output = await runVerifyMode(manifest, options, runtime);
      break;
    default:
      throw new Error(`Unsupported mode: ${options.mode}`);
  }
  writeOutput(`${JSON.stringify(canonicalValue(output), null, 2)}\n`);
  return output;
}

const GH_NOT_FOUND = Symbol("GitHub API not found");
const ghApiSlots = {
  active: 0,
  waiters: [],
};

function deadlineExceededError(deadlineLabel) {
  return new DeadlineExceededError(deadlineLabel);
}

function remainingDeadlineMs(deadlineAt, deadlineLabel) {
  if (!Number.isFinite(deadlineAt) || typeof deadlineLabel !== "string" || deadlineLabel === "") {
    throw new Error("GitHub API deadline configuration is invalid.");
  }
  const remaining = deadlineAt - performance.now();
  if (remaining <= 0) throw deadlineExceededError(deadlineLabel);
  return Math.ceil(remaining);
}

async function withGhApiSlot(
  callback,
  { deadlineAt = undefined, deadlineLabel = undefined } = {},
) {
  if (typeof callback !== "function") {
    throw new Error("GitHub API slot callback must be a function.");
  }
  const queueTimeoutMs =
    deadlineAt === undefined
      ? GH_API_QUEUE_TIMEOUT_MS
      : Math.min(
          GH_API_QUEUE_TIMEOUT_MS,
          remainingDeadlineMs(deadlineAt, deadlineLabel),
        );
  await new Promise((resolvePromise, rejectPromise) => {
    if (ghApiSlots.active < GH_API_CONCURRENCY) {
      ghApiSlots.active += 1;
      resolvePromise();
      return;
    }
    let settled = false;
    const waiter = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise();
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const index = ghApiSlots.waiters.indexOf(waiter);
      if (index !== -1) ghApiSlots.waiters.splice(index, 1);
      rejectPromise(
        deadlineAt === undefined
          ? new Error(
              `GitHub API queue remained full for ${GH_API_QUEUE_TIMEOUT_MS}ms; the result is inconclusive and no next write is allowed.`,
            )
          : deadlineExceededError(deadlineLabel),
      );
    }, queueTimeoutMs);
    ghApiSlots.waiters.push(waiter);
  });
  try {
    return await callback();
  } finally {
    const next = ghApiSlots.waiters.shift();
    if (next === undefined) {
      ghApiSlots.active -= 1;
    } else {
      next();
    }
  }
}

function ghJson(
  endpoint,
  options = {},
) {
  const {
    deadlineAt: requestedDeadlineAt = undefined,
    deadlineLabel: requestedDeadlineLabel = undefined,
    ...requestOptions
  } = options;
  if (requestedDeadlineAt !== undefined) {
    assertDeadlineConfiguration(requestedDeadlineAt, requestedDeadlineLabel);
  }
  const inherited = ghDeadlineContext.getStore();
  const useInherited =
    inherited !== undefined &&
    (requestedDeadlineAt === undefined ||
      inherited.deadlineAt < requestedDeadlineAt);
  const deadlineAt = useInherited
    ? inherited.deadlineAt
    : requestedDeadlineAt;
  const deadlineLabel = useInherited
    ? inherited.deadlineLabel
    : requestedDeadlineLabel;
  return withGhApiSlot(
    () =>
      ghJsonUnbounded(endpoint, requestOptions, {
        timeoutMs:
          deadlineAt === undefined
            ? GH_TIMEOUT_MS
            : Math.min(
                GH_TIMEOUT_MS,
                remainingDeadlineMs(deadlineAt, deadlineLabel),
              ),
        timeoutError:
          deadlineAt === undefined
            ? undefined
            : deadlineExceededError(deadlineLabel),
      }),
    { deadlineAt, deadlineLabel },
  );
}

function ghJsonUnbounded(
  endpoint,
  { method = "GET", body = undefined, paginate = false, allowNotFound = false } = {},
  { timeoutMs = GH_TIMEOUT_MS, timeoutError = undefined } = {},
) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("GitHub API request timeout must be a positive safe integer.");
  }
  if (timeoutError !== undefined && !(timeoutError instanceof Error)) {
    throw new Error("GitHub API request timeout error must be an Error when provided.");
  }
  return new Promise((resolvePromise, rejectPromise) => {
    const args = [
      "api",
      "--hostname",
      "github.com",
      "-H",
      "Accept: application/vnd.github+json",
      "-H",
      `X-GitHub-Api-Version: ${GITHUB_API_VERSION}`,
      endpoint,
    ];
    if (method !== "GET") {
      args.push("--method", method);
    }
    if (paginate) {
      args.push("--paginate", "--slurp");
    }
    if (body !== undefined) {
      args.push("--input", "-");
    }
    const child = spawn("gh", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const rejectOversize = (stream) => {
      child.kill("SIGKILL");
      finish(() => rejectPromise(new Error(`gh ${stream} exceeded ${MAX_GH_OUTPUT_BYTES} bytes.`)));
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > MAX_GH_OUTPUT_BYTES) rejectOversize("stdout");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (Buffer.byteLength(stderr) > MAX_GH_OUTPUT_BYTES) rejectOversize("stderr");
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() =>
        rejectPromise(timeoutError ?? new Error(`gh api ${endpoint} timed out.`)),
      );
    }, timeoutMs);
    if (body === undefined) {
      child.stdin.end();
    } else {
      child.stdin.end(`${JSON.stringify(body)}\n`);
    }
    child.on("error", (error) => finish(() => rejectPromise(error)));
    child.on("close", (code, signal) => {
      finish(() => {
        if (code !== 0) {
          if (allowNotFound && /\bHTTP 404\b/u.test(stderr)) {
            resolvePromise(GH_NOT_FOUND);
            return;
          }
          rejectPromise(
            new Error(
              stderr.trim() || `gh api ${endpoint} exited with ${code ?? signal}`,
            ),
          );
          return;
        }
        try {
          resolvePromise(stdout.trim() === "" ? null : JSON.parse(stdout));
        } catch (error) {
          rejectPromise(
            new Error(`gh api ${endpoint} returned invalid JSON: ${error.message}`),
          );
        }
      });
    });
  });
}

function isMainModule() {
  return (
    typeof process.argv[1] === "string" &&
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  );
}

if (isMainModule()) {
  runCli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
