#!/usr/bin/env node

import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import {
  decodeGitHubBlobContent,
  rulesetCoversDefaultBranch,
  validateCanonicalV2WorkflowInventory,
} from "../src/bootstrap.mjs";

export const MANIFEST_SCHEMA_VERSION =
  "organization-review-gate-handoff-manifest/v1";
export const OUTPUT_SCHEMA_VERSION =
  "organization-review-gate-handoff-output/v1";
export const V2_RULESET_NAME = "Must Pass Codex Review v2";
export const V2_STATUS_CONTEXT = "codex/github-review-gate";
export const LEGACY_STATUS_CONTEXT = "codex/review-gate";
export const GITHUB_ACTIONS_INTEGRATION_ID = 15368;
export const REQUIRED_REPOSITORY_COUNT = 11;
export const CODEOWNERS_PATH = ".github/CODEOWNERS";
export const V2_VERIFIER_RUN_NAME_PREFIX = "codex-review-gate-verifier";
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
    git_blob_sha: "bc6827bdfb94a36b177ecaaa1bab5facd9a71fde",
    sha256: "1a6e6ea700874632c0e7413fe60418ce5772a404df5f5acdaf070eb528067a7f",
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
const GH_API_CONCURRENCY = 8;
const REPOSITORY_EVIDENCE_CONCURRENCY = 2;
const MODES = new Set([
  "plan",
  "stage",
  "activate",
  "derive-cutover",
  "apply-repository-cleanup",
  "verify",
]);
const WORKFLOW_KEYS = ["verifier", "controller", "legacy_bridge"];
const CONTROL_PLANE_CODEOWNERS_BEGIN =
  "# BEGIN codex-review-gate control-plane";
const CONTROL_PLANE_CODEOWNERS_END = "# END codex-review-gate control-plane";

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

function assertLegacyOrganizationRulesetPolicy(ruleset, repositoryIds, label) {
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
  if (
    !Array.isArray(conditions.repository_id.repository_ids) ||
    conditions.repository_id.repository_ids.some(
      (id) => !Number.isSafeInteger(id) || id <= 0,
    )
  ) {
    throw new Error(`${label}.conditions.repository_id.repository_ids is malformed.`);
  }
  if (
    canonicalJson(conditions.repository_id.repository_ids) !==
    canonicalJson(repositoryIds)
  ) {
    throw new Error(
      `${label} repository IDs must exactly match the ordered manifest repository IDs.`,
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
    !rulesetCoversDefaultBranch(ruleset, defaultBranch)
  ) {
    throw new Error(`${label} does not provably cover the repository default branch.`);
  }
  const statusRules = requiredStatusRules(ruleset);
  if (statusRules.length !== 1) {
    throw new Error(`${label} must contain exactly one required_status_checks rule.`);
  }
  const statusRule = statusRules[0];
  const checks = statusChecks(statusRule, `${label}.v2_status_rule`);
  if (
    checks.length !== 1 ||
    checks[0].context !== V2_STATUS_CONTEXT ||
    checks[0].integration_id !== GITHUB_ACTIONS_INTEGRATION_ID ||
    statusRule.parameters.strict_required_status_checks_policy !== true ||
    checks.some((check) => check.context === LEGACY_STATUS_CONTEXT)
  ) {
    throw new Error(`${label} must require only the strict, source-bound v2 status.`);
  }
  const pullRequestRules = ruleset.rules.filter((rule) => rule.type === "pull_request");
  if (pullRequestRules.length !== 1) {
    throw new Error(`${label} must contain exactly one pull_request rule.`);
  }
  const parameters = pullRequestRules[0].parameters;
  for (const key of [
    "require_code_owner_review",
    "dismiss_stale_reviews_on_push",
    "required_review_thread_resolution",
  ]) {
    if (parameters?.[key] !== true) {
      throw new Error(`${label}.pull_request.${key} must be true.`);
    }
  }
  if (ruleset.rules.filter((rule) => rule.type === "non_fast_forward").length !== 1) {
    throw new Error(`${label} must contain exactly one non_fast_forward rule.`);
  }
}

function assertWorkflowDescriptor(value, label) {
  assertExactKeys(value, ["path", "git_blob_sha", "sha256"], label);
  assertRepoRelativeWorkflowPath(value.path, `${label}.path`);
  assertHex(value.git_blob_sha, 40, `${label}.git_blob_sha`);
  assertHex(value.sha256, 64, `${label}.sha256`);
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

export function validateManifest(input) {
  assertExactKeys(
    input,
    [
      "schema_version",
      "organization",
      "legacy_ruleset",
      "v2_ruleset",
      "repositories",
      "expected_legacy_cleanup_action_count",
    ],
    "manifest",
  );
  if (input.schema_version !== MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `manifest.schema_version must be "${MANIFEST_SCHEMA_VERSION}".`,
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
    ["id", "expected_before"],
    "manifest.legacy_ruleset",
  );
  assertPositiveInteger(input.legacy_ruleset.id, "manifest.legacy_ruleset.id");
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
  const seenCleanupTargets = new Set();
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
    if (seenIds.has(repo.id) || seenSlugs.has(repo.slug.toLowerCase())) {
      throw new Error(`${label} duplicates a repository identity.`);
    }
    seenIds.add(repo.id);
    seenSlugs.add(repo.slug.toLowerCase());

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
  assertLegacyOrganizationRulesetPolicy(
    input.legacy_ruleset.expected_before,
    input.repositories.map((repo) => repo.id),
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
    conditions: cloneJson(legacy.conditions),
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
    bypass_actors: cloneJson(value.bypass_actors),
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
  if (canonicalJson(complete.writable) === canonicalJson(before)) {
    return "before";
  }
  if (canonicalJson(complete.writable) === canonicalJson(after)) {
    return "after";
  }
  throw new Error("Legacy organization ruleset does not match either authorized snapshot.");
}

function classifyV2OrganizationRuleset(manifest, complete) {
  const disabled = buildV2OrganizationRulesetPayload(manifest, "disabled");
  const active = buildV2OrganizationRulesetPayload(manifest, "active");
  if (canonicalJson(complete.writable) === canonicalJson(disabled)) {
    return "disabled";
  }
  if (canonicalJson(complete.writable) === canonicalJson(active)) {
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
  const workflowFiles = await Promise.all(
    workflowsTree
      .filter((entry) => /\.ya?ml$/u.test(entry.path))
      .map(async (entry) => {
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
    validateCanonicalV2WorkflowInventory(
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
  return {
    canonical: canonicalEvidence,
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

export function parseWorkflowRunPath(value, defaultBranch) {
  if (value === CANONICAL_WORKFLOW_IDENTITIES.verifier.path) {
    return {
      workflow_path: value,
      workflow_ref: null,
    };
  }
  if (typeof value !== "string") {
    throw new Error("Workflow run path must be a string.");
  }
  const prefix = `${CANONICAL_WORKFLOW_IDENTITIES.verifier.path}@`;
  if (!value.startsWith(prefix) || value.length === prefix.length) {
    throw new Error("Workflow run path is not the canonical verifier path.");
  }
  const workflowRef = value.slice(prefix.length);
  // GitHub returns a bare path for some runs and path@ref for others. The
  // workflow ID, canonical default-branch tree, and canary's protected-file
  // inventory bind the producer; accepting the documented optional suffix
  // avoids assuming one undocumented ref spelling.
  if (
    workflowRef.includes("\n") ||
    workflowRef.includes("\r") ||
    workflowRef.includes("\0") ||
    (defaultBranch !== undefined && typeof defaultBranch !== "string")
  ) {
    throw new Error("Workflow run path has an invalid source ref.");
  }
  return {
    workflow_path: CANONICAL_WORKFLOW_IDENTITIES.verifier.path,
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

async function loadLegacyStatusEvidence(repo) {
  const endpoint = `repos/${encodeEndpointPath(repo.slug)}/commits/${repo.canary.head_sha}/statuses?per_page=100`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const pages = await ghJson(endpoint, { paginate: true });
    const projection = validateLegacyStatusPages(pages, repo);
    const firstPage = await ghJson(`${endpoint}&page=1`);
    if (
      Array.isArray(firstPage) &&
      Array.isArray(pages[0]) &&
      canonicalJson(firstPage) === canonicalJson(pages[0])
    ) {
      return projection;
    }
  }
  throw new Error(
    `${repo.slug} commit-status pagination horizon changed during revalidation; the result is inconclusive and no next write is allowed.`,
  );
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
    response.some((page) => !Array.isArray(page))
  ) {
    throw new Error(`${repo.slug} effective branch-rule inventory is malformed.`);
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
  if (canonicalJson(actual) === canonicalJson(action.expected_before)) {
    return "before";
  }
  if (canonicalJson(actual) === canonicalJson(action.expected_after)) {
    return "after";
  }
  throw new Error("Repository legacy cleanup surface matches neither bound snapshot.");
}

async function loadRepositoryEvidence(
  repo,
  { requireCanaryEvidence = true, manifest } = {},
) {
  if (manifest === undefined) {
    throw new Error("Repository evidence requires the validated handoff manifest.");
  }
  const metadataPromise = ghJson(`repos/${encodeEndpointPath(repo.slug)}`);
  const defaultBranchPromise = loadDefaultBranchHead(repo, {
    requireCanaryBase: requireCanaryEvidence,
  });
  const canaryEvidencePromise = requireCanaryEvidence
    ? Promise.allSettled([
        loadCanaryPull(repo),
        loadV2CanaryEvidence(repo),
        loadLegacyStatusEvidence(repo),
      ]).then((results) => {
        const rejected = results.find((result) => result.status === "rejected");
        if (rejected !== undefined) throw rejected.reason;
        return results.map((result) => result.value);
      })
    : Promise.resolve(null);
  const [metadata, defaultBranch, canaryEvidence] = await Promise.all([
    metadataPromise,
    defaultBranchPromise,
    canaryEvidencePromise,
  ]);
  const [
    workflowControlPlane,
    v2Ruleset,
    codeowners,
    actionsWorkflowPermissions,
    localRulesets,
    classicStatus,
    effectiveBranchRules,
  ] = await Promise.all([
    loadWorkflowInventoryEvidence(repo, defaultBranch.head_sha),
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

export async function mapWithConcurrency(items, limit, mapper) {
  if (!Array.isArray(items) || !Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error("Bounded mapper requires an array and positive safe-integer limit.");
  }
  if (typeof mapper !== "function") {
    throw new Error("Bounded mapper requires a mapper function.");
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
          if (firstError === null) firstError = error;
          return;
        }
      }
    }),
  );
  if (firstError !== null) throw firstError;
  return results;
}

async function loadCoverageRound(
  manifest,
  { requireCanaryEvidence = true } = {},
) {
  const [organization, repositories] = await Promise.all([
    loadOrganizationRound(manifest),
    mapWithConcurrency(
      manifest.repositories,
      REPOSITORY_EVIDENCE_CONCURRENCY,
      (repo) =>
        loadRepositoryEvidence(repo, { requireCanaryEvidence, manifest }),
    ),
  ]);
  const snapshot = { organization, repositories };
  assertEffectiveOrganizationGateCoverage(snapshot, manifest);
  return snapshot;
}

async function loadPostActivationRound(manifest) {
  return loadCoverageRound(manifest, { requireCanaryEvidence: false });
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
    !new Set(["stage", "activate", "apply-repository-cleanup", "verify"]).has(
      values.mode,
    )
  ) {
    throw new Error(
      "--apply is valid only with stage, activate, apply-repository-cleanup, or verify mode.",
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
  node scripts/organization-review-gate-handoff.mjs --manifest PATH --mode activate [--apply --expected-plan-sha256 SHA256]
  node scripts/organization-review-gate-handoff.mjs --manifest PATH --mode derive-cutover
  node scripts/organization-review-gate-handoff.mjs --manifest PATH --mode apply-repository-cleanup [--apply --expected-plan-sha256 SHA256]
  node scripts/organization-review-gate-handoff.mjs --manifest PATH --mode verify [--apply --expected-plan-sha256 SHA256]

Modes:
  plan            Read two complete organization snapshots and report the bound phase.
  stage           Preview or create the exact Disabled v2 organization ruleset; --recover-created-v2 is the read-only recovery path for an ambiguous create.
  activate        Require 11/11 workflow, bridge, repo-ruleset, and canary proof; preview or activate v2.
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

function finalClosureReceipt(manifest, snapshot) {
  if (
    snapshot.organization.legacy_state !== "after" ||
    snapshot.organization.v2_state !== "active"
  ) {
    throw new Error("Final closure receipt requires an active v2 and removed legacy organization rule.");
  }
  const repositories = snapshot.repositories
    .map((repository) => cloneJson(repository.identity))
    .sort((left, right) =>
      Buffer.compare(
        Buffer.from(left.full_name, "utf8"),
        Buffer.from(right.full_name, "utf8"),
      )
    );
  if (repositories.length !== REQUIRED_REPOSITORY_COUNT) {
    throw new Error("Final closure receipt requires the complete repository cohort.");
  }
  return {
    schema_version: 1,
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
    repositories,
  };
}

function finalClosureReceiptOutput(manifest, snapshot) {
  const receipt = finalClosureReceipt(manifest, snapshot);
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
    assertExactSnapshot(created.writable, desired, "Created v2 organization ruleset");
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
  const snapshot = await loadStable("11/11 activation coverage", () =>
    loadCoverageRound(manifest),
    runtime.stableSnapshotOptions,
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
      coverage: {
        repositories_verified: snapshot.repositories.length,
        required: REQUIRED_REPOSITORY_COUNT,
        legacy_bridge: true,
        v2: true,
      },
    };
  }
  await revalidateUnchangedBeforeMutation(
    "11/11 activation coverage",
    snapshot,
    () => loadCoverageRound(manifest),
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
  assertExactSnapshot(updated.writable, action.payload, "Activated v2 organization ruleset");
  const readback = await loadStable("Active dual-enforcement readback", () =>
    loadCoverageRound(manifest),
    runtime.stableSnapshotOptions,
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
    coverage: {
      repositories_verified: readback.repositories.length,
      required: REQUIRED_REPOSITORY_COUNT,
      legacy_bridge: true,
      v2: true,
    },
  };
}

async function runDeriveCutoverMode(manifest, runtime) {
  if (manifest.v2_ruleset.id === null) {
    throw new Error("derive-cutover requires manifest.v2_ruleset.id.");
  }
  const snapshot = await loadStable("Dual-enforcement cutover derivation", () =>
    loadPostActivationRound(manifest),
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
  await loadManifestBoundRepositoryCleanupIdentity(
    record.repo,
    `${record.repo.slug} repository cleanup identity immediately before mutation`,
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
    loadPostActivationRound(manifest),
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
    () => loadPostActivationRound(manifest),
  );
  const outcomes = [];
  for (const record of pendingRecords) {
    outcomes.push(await executeRepositoryCleanupRecord(record));
  }
  const readback = await loadStable("Repository cleanup readback", () =>
    loadPostActivationRound(manifest),
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
    loadPostActivationRound(manifest),
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
    () => loadPostActivationRound(manifest),
  );
  if (runtime.beforeFinalLegacyRevalidation !== undefined) {
    await runtime.beforeFinalLegacyRevalidation();
  }
  await revalidateLegacyOrganizationRuleImmediatelyBeforeCutover(
    manifest,
    snapshot,
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
  assertExactSnapshot(updated.writable, action.payload, "Legacy organization cutover response");
  const readback = await loadStable("Final organization handoff closure", () =>
    loadPostActivationRound(manifest),
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
  const runtime = { stableSnapshotOptions, beforeFinalLegacyRevalidation };
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
    case "activate":
      output = await runActivateMode(manifest, options, runtime);
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

async function withGhApiSlot(callback) {
  if (typeof callback !== "function") {
    throw new Error("GitHub API slot callback must be a function.");
  }
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
        new Error(
          `GitHub API queue remained full for ${GH_API_QUEUE_TIMEOUT_MS}ms; the result is inconclusive and no next write is allowed.`,
        ),
      );
    }, GH_API_QUEUE_TIMEOUT_MS);
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
  return withGhApiSlot(() => ghJsonUnbounded(endpoint, options));
}

function ghJsonUnbounded(
  endpoint,
  { method = "GET", body = undefined, paginate = false, allowNotFound = false } = {},
) {
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
      finish(() => rejectPromise(new Error(`gh api ${endpoint} timed out.`)));
    }, GH_TIMEOUT_MS);
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
