#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_CODEOWNERS_PATH,
  DEFAULT_CONTROL_PLANE_OWNER,
  DEFAULT_RULESET_ENFORCEMENT,
  DEFAULT_RULESET_NAME,
  DEFAULT_STATUS_CONTEXT,
  DEFAULT_STATUS_INTEGRATION_ID,
  DEFAULT_WORKFLOW_PATH,
  LEGACY_STATUS_CONTEXT,
  assertDirectoryWitnessStable,
  buildCreateRulesetPayload,
  buildUpdateRulesetPayload,
  decodeGitHubBlobContent,
  directoryWitnessFromMetadata,
  ensureControlPlaneCodeownersContent,
  findEffectiveRulesetWithGatePolicy,
  installedWorkflowMatchesCanonical,
  normalizeControlPlaneOwner,
  normalizeWorkflowPath,
  parseRepoSlug,
  rulesetCoversDefaultBranch,
  rulesetHasGatePolicy,
  rulesetHasRequiredStatusContext,
  rulesetWritableFingerprint,
  validateCanonicalV2WorkflowContent,
  validateCanonicalV2WorkflowInventory,
  validateControlPlaneCodeownersContent,
  workflowContainsCodexReviewGateCaller,
  workflowContainsLegacyV1Caller,
} from "../src/bootstrap.mjs";

const SOURCE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CANONICAL_WORKFLOW_SOURCE = join(
  SOURCE_ROOT,
  "templates/codex-gated-repo/.github/workflows/codex-review-gate.yml",
);

async function main() {
  const options = readCliOptions();
  const canonicalWorkflow = await loadCanonicalWorkflow();

  if (options.prepareWorktree !== null) {
    await prepareConsumerWorktree({
      targetRoot: options.prepareWorktree,
      canonicalWorkflow,
      controlPlaneOwner: options.controlPlaneOwner,
      apply: options.apply,
    });
    return;
  }

  const initialSecuritySnapshot = await loadConsumerSecuritySnapshot({
    repoSlug: options.repo.slug,
    workflowPath: options.workflowPath,
    canonicalWorkflow,
    controlPlaneOwner: options.controlPlaneOwner,
  });
  const { defaultBranch } = initialSecuritySnapshot;
  if (options.activate) {
    await assertCanaryStatusSource({
      repoSlug: options.repo.slug,
      defaultBranch,
      defaultBranchHeadSha: initialSecuritySnapshot.defaultBranchHeadSha,
      workflowPath: options.workflowPath,
      prNumber: options.canaryPr,
      headSha: options.canaryHead,
    });
  }

  const effectiveRulesets = await loadRulesets(options.repo.slug);

  console.log(`Repository: ${options.repo.slug}`);
  console.log(`Default branch: ${defaultBranch}`);
  console.log(`Workflow: ${options.workflowPath} exactly matches the canonical v2 caller`);
  console.log(`Control plane: ${DEFAULT_CODEOWNERS_PATH} protects the workflow and itself for ${options.controlPlaneOwner}`);

  const repoRulesets = effectiveRulesets.filter(
    (ruleset) =>
      ruleset.source_type === "Repository" && ruleset.name === options.rulesetName,
  );
  const repoRuleset = repoRulesets.find(
    (ruleset) => ruleset.target === undefined || ruleset.target === "branch",
  );
  const nonBranchRuleset = repoRulesets.find(
    (ruleset) => ruleset.target !== undefined && ruleset.target !== "branch",
  );

  if (repoRuleset === undefined && nonBranchRuleset !== undefined) {
    throw new Error(
      `Repository ruleset "${options.rulesetName}" already targets ${nonBranchRuleset.target}; refusing to rewrite it as a branch ruleset. Use a different --ruleset-name or rename the existing ruleset.`,
    );
  }

  const unmanageableLegacyRulesets = effectiveRulesets.filter(
    (ruleset) =>
      ruleset.enforcement === "active" &&
      rulesetCoversDefaultBranch(ruleset, defaultBranch) &&
      rulesetHasRequiredStatusContext(ruleset, LEGACY_STATUS_CONTEXT, {
        integrationId: undefined,
      }) &&
      ruleset.id !== repoRuleset?.id,
  );
  if (unmanageableLegacyRulesets.length > 0) {
    throw new Error(
      `${LEGACY_STATUS_CONTEXT} is still required by ${unmanageableLegacyRulesets
        .map(rulesetLabel)
        .join(", ")}; remove that legacy requirement in the installation PR or ruleset settings before activating v2.`,
    );
  }

  const existingEffective = findEffectiveRulesetWithGatePolicy(
    effectiveRulesets,
    options.context,
    { defaultBranch, integrationId: options.integrationId },
  );
  if (repoRuleset === undefined && existingEffective !== undefined) {
    console.log(
      `No change: the complete v2 gate policy is already enforced by ${rulesetLabel(existingEffective)}.`,
    );
    return;
  }

  if (repoRuleset === undefined) {
    const payload = buildCreateRulesetPayload({
      name: options.rulesetName,
      context: options.context,
      integrationId: options.integrationId,
      enforcement: options.activate ? "active" : DEFAULT_RULESET_ENFORCEMENT,
    });

    if (!options.apply) {
      printDryRun("create", options, payload);
      return;
    }

    const currentSecuritySnapshot = await loadConsumerSecuritySnapshot({
      repoSlug: options.repo.slug,
      workflowPath: options.workflowPath,
      canonicalWorkflow,
      controlPlaneOwner: options.controlPlaneOwner,
      expectedDefaultBranch: defaultBranch,
    });
    assertConsumerSecuritySnapshotStable(
      initialSecuritySnapshot,
      currentSecuritySnapshot,
    );
    if (options.activate) {
      await assertCanaryStatusSource({
        repoSlug: options.repo.slug,
        defaultBranch,
        defaultBranchHeadSha: currentSecuritySnapshot.defaultBranchHeadSha,
        workflowPath: options.workflowPath,
        prNumber: options.canaryPr,
        headSha: options.canaryHead,
      });
    }
    const created = await ghJson(`repos/${options.repo.slug}/rulesets`, {
      method: "POST",
      body: payload,
    });
    await assertRulesetReadback({
      repoSlug: options.repo.slug,
      rulesetId: created?.id,
      defaultBranch,
      context: options.context,
      integrationId: options.integrationId,
      enforcement: payload.enforcement,
      expectedPayload: payload,
      exactWritableFields: false,
    });
    const postWriteSecuritySnapshot = await loadConsumerSecuritySnapshot({
      repoSlug: options.repo.slug,
      workflowPath: options.workflowPath,
      canonicalWorkflow,
      controlPlaneOwner: options.controlPlaneOwner,
      expectedDefaultBranch: defaultBranch,
    });
    assertConsumerSecuritySnapshotStable(
      currentSecuritySnapshot,
      postWriteSecuritySnapshot,
      { phase: "ruleset post-write readback" },
    );
    console.log(`Created ruleset: ${rulesetLabel(created)}`);
    return;
  }

  const fullRuleset = await ghJson(`repos/${options.repo.slug}/rulesets/${repoRuleset.id}`);
  const { changed, payload } = buildUpdateRulesetPayload(fullRuleset, {
    context: options.context,
    integrationId: options.integrationId,
    defaultBranch,
    ...(options.activate ? { enforcement: "active" } : {}),
  });
  if (!changed) {
    console.log(`No change: ${options.context} is already required by ${rulesetLabel(fullRuleset)}.`);
    return;
  }

  if (!options.apply) {
    printDryRun("update", options, payload, fullRuleset);
    return;
  }

  const activeWrite = payload.enforcement === "active";
  if (activeWrite && !options.activate) {
    throw new Error(
      "An active ruleset update requires --activate with an exact current canary PR and head so the security snapshot can be revalidated before PUT.",
    );
  }
  const currentSecuritySnapshot = await loadConsumerSecuritySnapshot({
    repoSlug: options.repo.slug,
    workflowPath: options.workflowPath,
    canonicalWorkflow,
    controlPlaneOwner: options.controlPlaneOwner,
    expectedDefaultBranch: defaultBranch,
  });
  assertConsumerSecuritySnapshotStable(
    initialSecuritySnapshot,
    currentSecuritySnapshot,
  );
  if (activeWrite) {
    await assertCanaryStatusSource({
      repoSlug: options.repo.slug,
      defaultBranch,
      defaultBranchHeadSha: currentSecuritySnapshot.defaultBranchHeadSha,
      workflowPath: options.workflowPath,
      prNumber: options.canaryPr,
      headSha: options.canaryHead,
    });
  }
  const currentFullRuleset = await ghJson(
    `repos/${options.repo.slug}/rulesets/${fullRuleset.id}`,
  );
  if (
    rulesetWritableFingerprint(currentFullRuleset) !==
    rulesetWritableFingerprint(fullRuleset)
  ) {
    throw new Error(
      `Ruleset ${fullRuleset.id} changed after planning; refusing a lost-update overwrite. Re-run bootstrap against the latest ruleset.`,
    );
  }
  // GitHub's ruleset API does not expose an If-Match update contract here.
  // This full writable-field reread is therefore the final best-effort
  // lost-update boundary immediately before PUT.
  const updated = await ghJson(`repos/${options.repo.slug}/rulesets/${fullRuleset.id}`, {
    method: "PUT",
    body: payload,
  });
  await assertRulesetReadback({
    repoSlug: options.repo.slug,
    rulesetId: fullRuleset.id,
    defaultBranch,
    context: options.context,
    integrationId: options.integrationId,
    enforcement: payload.enforcement,
    expectedPayload: payload,
    exactWritableFields: true,
  });
  const postWriteSecuritySnapshot = await loadConsumerSecuritySnapshot({
    repoSlug: options.repo.slug,
    workflowPath: options.workflowPath,
    canonicalWorkflow,
    controlPlaneOwner: options.controlPlaneOwner,
    expectedDefaultBranch: defaultBranch,
  });
  assertConsumerSecuritySnapshotStable(
    currentSecuritySnapshot,
    postWriteSecuritySnapshot,
    { phase: "ruleset post-write readback" },
  );
  console.log(`Updated ruleset: ${rulesetLabel(updated)}`);
}

function readCliOptions() {
  const { values } = parseArgs({
    options: {
      repo: { type: "string" },
      "prepare-worktree": { type: "string" },
      apply: { type: "boolean", default: false },
      activate: { type: "boolean", default: false },
      "ruleset-name": { type: "string", default: DEFAULT_RULESET_NAME },
      "control-plane-owner": {
        type: "string",
        default: DEFAULT_CONTROL_PLANE_OWNER,
      },
      context: { type: "string", default: DEFAULT_STATUS_CONTEXT },
      "canary-pr": { type: "string" },
      "canary-head": { type: "string" },
      workflow: { type: "string", default: DEFAULT_WORKFLOW_PATH },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  const hasRepo = values.repo !== undefined;
  const hasPrepareWorktree = values["prepare-worktree"] !== undefined;
  if (hasRepo === hasPrepareWorktree) {
    printUsage();
    throw new Error("Choose exactly one mode: --prepare-worktree PATH or --repo OWNER/REPO.");
  }
  if (hasPrepareWorktree && values.activate) {
    throw new Error("--activate is only valid with --repo after the canary passes.");
  }
  if (values.activate && (values["canary-pr"] === undefined || values["canary-head"] === undefined)) {
    throw new Error("--activate requires both --canary-pr and --canary-head for source readback.");
  }
  if (!values.activate && (values["canary-pr"] !== undefined || values["canary-head"] !== undefined)) {
    throw new Error("--canary-pr and --canary-head are valid only with --activate.");
  }
  if (values.context !== DEFAULT_STATUS_CONTEXT) {
    throw new Error(
      `--context is fixed to "${DEFAULT_STATUS_CONTEXT}"; the v2 runtime does not support another status context.`,
    );
  }

  return {
    repo: hasRepo ? parseRepoSlug(values.repo) : null,
    prepareWorktree: hasPrepareWorktree ? resolve(values["prepare-worktree"]) : null,
    apply: values.apply,
    activate: values.activate,
    rulesetName: values["ruleset-name"],
    controlPlaneOwner: normalizeControlPlaneOwner(values["control-plane-owner"]),
    context: values.context,
    integrationId: DEFAULT_STATUS_INTEGRATION_ID,
    canaryPr: values.activate ? parseCanaryPr(values["canary-pr"]) : null,
    canaryHead: values.activate ? parseCanaryHead(values["canary-head"]) : null,
    workflowPath: normalizeWorkflowPath(values.workflow),
  };
}

function printUsage() {
  console.log(`Usage:
  node scripts/bootstrap-codex-review-gate.mjs --prepare-worktree PATH [--control-plane-owner @USER] [--apply]
  node scripts/bootstrap-codex-review-gate.mjs --repo OWNER/REPO [--control-plane-owner @USER] [--apply]
  node scripts/bootstrap-codex-review-gate.mjs --repo OWNER/REPO --activate --canary-pr NUMBER --canary-head SHA [--control-plane-owner @USER] [--apply]

Options:
  --prepare-worktree PATH Prepare a local consumer checkout for one installation PR.
  --repo OWNER/REPO       Inspect or stage the merged repository ruleset.
  --apply                 Apply the local copy or ruleset change. Defaults to dry-run.
  --activate              Activate only after verifying the named temporary-PR canary.
  --canary-pr NUMBER      Open canary PR to verify before activation.
  --canary-head SHA       Exact lowercase 40-hex canary head to verify before activation.
  --ruleset-name NAME     Repo ruleset to create or update. Defaults to "${DEFAULT_RULESET_NAME}".
  --control-plane-owner   GitHub user owning workflow and CODEOWNERS changes. Defaults to "${DEFAULT_CONTROL_PLANE_OWNER}".
  --context CONTEXT       Required status context. Must remain "${DEFAULT_STATUS_CONTEXT}".
  --workflow PATH         Gate workflow path. Defaults to "${DEFAULT_WORKFLOW_PATH}".
  -h, --help              Show this help.
`);
}

function parseCanaryPr(value) {
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`--canary-pr must be a positive integer: ${value}`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`--canary-pr exceeds the safe integer range: ${value}`);
  }
  return parsed;
}

function parseCanaryHead(value) {
  if (!/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`--canary-head must be an exact lowercase 40-hex SHA: ${value}`);
  }
  return value;
}

async function assertCanaryStatusSource({
  repoSlug,
  defaultBranch,
  defaultBranchHeadSha,
  workflowPath,
  prNumber,
  headSha,
}) {
  const pullRequest = await ghJson(`repos/${repoSlug}/pulls/${prNumber}`);
  if (
    pullRequest?.state !== "open" ||
    pullRequest?.merged === true ||
    pullRequest?.draft === true ||
    pullRequest?.base?.ref !== defaultBranch ||
    pullRequest?.head?.repo?.full_name !== repoSlug ||
    pullRequest?.head?.sha !== headSha
  ) {
    throw new Error(
      `Canary PR #${prNumber} is not an open, non-draft, same-repository default-branch PR at exact head ${headSha}.`,
    );
  }

  const pages = await ghJson(
    `repos/${repoSlug}/commits/${encodeURIComponent(headSha)}/statuses?per_page=100`,
    { paginate: true },
  );
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new Error("Canary status readback did not return complete paginated status arrays.");
  }
  const latest = pages
    .flat()
    .find((status) => status?.context === DEFAULT_STATUS_CONTEXT);
  if (latest?.state !== "success") {
    throw new Error(
      `Canary head ${headSha} does not have a latest successful ${DEFAULT_STATUS_CONTEXT} status.`,
    );
  }
  if (
    latest?.sha !== headSha ||
    latest?.creator?.login !== "github-actions[bot]" ||
    latest?.creator?.type !== "Bot"
  ) {
    throw new Error(
      `Canary ${DEFAULT_STATUS_CONTEXT} status was not produced by GitHub Actions.`,
    );
  }

  const runId = parseCanonicalRunTargetUrl(latest?.target_url, repoSlug);
  const run = await ghJson(`repos/${repoSlug}/actions/runs/${runId}`);
  const expectedRunPath = `${workflowPath}@${defaultBranch}`;
  if (
    Number(run?.id) !== runId ||
    run?.html_url !== latest.target_url ||
    run?.repository?.full_name !== repoSlug ||
    run?.head_repository?.full_name !== repoSlug ||
    run?.path !== expectedRunPath ||
    run?.head_branch !== defaultBranch ||
    run?.head_sha !== defaultBranchHeadSha ||
    !["issue_comment", "workflow_dispatch"].includes(run?.event) ||
    run?.status !== "completed" ||
    run?.conclusion !== "success" ||
    !Number.isSafeInteger(run?.workflow_id) ||
    run.workflow_id <= 0
  ) {
    throw new Error(
      `Canary status target does not resolve to a successful current-default-branch ${workflowPath} GitHub Actions run.`,
    );
  }
  const workflow = await ghJson(
    `repos/${repoSlug}/actions/workflows/${run.workflow_id}`,
  );
  if (
    workflow?.id !== run.workflow_id ||
    workflow?.path !== workflowPath ||
    workflow?.state !== "active"
  ) {
    throw new Error(
      `Canary run ${runId} is not bound to the active canonical workflow identity.`,
    );
  }

  console.log(
    `Canary: #${prNumber} at ${headSha} has a successful ${DEFAULT_STATUS_CONTEXT} status from GitHub Actions.`,
  );
}

function parseCanonicalRunTargetUrl(value, repoSlug) {
  if (typeof value !== "string" || value === "") {
    throw new Error("Canary status lacks a GitHub Actions run target_url.");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Canary status target_url is not an absolute URL.");
  }
  const expectedPrefix = `/${repoSlug}/actions/runs/`;
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    !url.pathname.startsWith(expectedPrefix)
  ) {
    throw new Error("Canary status target_url is not a canonical same-repository GitHub run URL.");
  }
  const runIdText = url.pathname.slice(expectedPrefix.length);
  if (!/^[1-9][0-9]*$/u.test(runIdText)) {
    throw new Error("Canary status target_url does not contain one canonical run id.");
  }
  const runId = Number(runIdText);
  if (!Number.isSafeInteger(runId)) {
    throw new Error("Canary status target_url run id exceeds the safe integer range.");
  }
  return runId;
}

async function assertRulesetReadback({
  repoSlug,
  rulesetId,
  defaultBranch,
  context,
  integrationId,
  enforcement,
  expectedPayload,
  exactWritableFields,
}) {
  if (!Number.isSafeInteger(rulesetId) || rulesetId <= 0) {
    throw new Error(
      "Ruleset write did not return a positive integer id for independent readback.",
    );
  }

  const ruleset = await ghJson(`repos/${repoSlug}/rulesets/${rulesetId}`);
  if (
    ruleset?.target !== "branch" ||
    ruleset?.enforcement !== enforcement ||
    !rulesetCoversDefaultBranch(ruleset, defaultBranch) ||
    !rulesetHasGatePolicy(ruleset, context, { integrationId }) ||
    (exactWritableFields
      ? rulesetWritableFingerprint(ruleset) !==
        rulesetWritableFingerprint(expectedPayload)
      : !createReadbackMatchesPlannedShape(ruleset, expectedPayload))
  ) {
    throw new Error(
      `Ruleset readback for id ${rulesetId} is incomplete or drifted: expected exact writable fields with ${enforcement} default-branch coverage, strict ${context} from GitHub Actions (${integrationId}), code-owner review without weakening an existing approval count, resolved conversations, non-fast-forward protection, and explicit empty bypass actors.`,
    );
  }

  console.log(
    `Ruleset readback: ${rulesetLabel(ruleset)} is complete with ${enforcement} enforcement.`,
  );
  return ruleset;
}

function valueContainsExactPlannedShape(actual, planned) {
  if (Array.isArray(planned)) {
    return (
      Array.isArray(actual) &&
      actual.length === planned.length &&
      planned.every((value, index) =>
        valueContainsExactPlannedShape(actual[index], value))
    );
  }
  if (planned !== null && typeof planned === "object") {
    return (
      actual !== null &&
      typeof actual === "object" &&
      !Array.isArray(actual) &&
      Object.entries(planned).every(
        ([key, value]) =>
          Object.prototype.hasOwnProperty.call(actual, key) &&
          valueContainsExactPlannedShape(actual[key], value),
      )
    );
  }
  return Object.is(actual, planned);
}

function createReadbackMatchesPlannedShape(actual, planned) {
  if (!valueContainsExactPlannedShape(actual, planned)) {
    return false;
  }
  if (!valuesDeepEqual(actual.conditions, planned.conditions)) {
    return false;
  }
  if (!Array.isArray(actual.rules) || actual.rules.length !== planned.rules.length) {
    return false;
  }

  for (let index = 0; index < planned.rules.length; index += 1) {
    const actualRule = actual.rules[index];
    const plannedRule = planned.rules[index];
    if (actualRule?.type !== plannedRule?.type) {
      return false;
    }
    const actualParameters = actualRule.parameters;
    const plannedParameters = plannedRule.parameters;
    if (plannedParameters === undefined) {
      if (actualParameters !== undefined && actualParameters !== null) {
        return false;
      }
      continue;
    }
    if (
      actualParameters === null ||
      typeof actualParameters !== "object" ||
      Array.isArray(actualParameters)
    ) {
      return false;
    }
    const extraKeys = Object.keys(actualParameters).filter(
      (key) => !Object.prototype.hasOwnProperty.call(plannedParameters, key),
    );
    if (actualRule.type === "pull_request") {
      const allowedExtraKeys = new Set([
        "allowed_merge_methods",
        "dismissal_restriction",
        "require_extra_approval_for_unattributed_changes",
        "required_reviewers",
      ]);
      if (extraKeys.some((key) => !allowedExtraKeys.has(key))) {
        return false;
      }
      if (
        Object.prototype.hasOwnProperty.call(actualParameters, "allowed_merge_methods") &&
        (!Array.isArray(actualParameters.allowed_merge_methods) ||
          actualParameters.allowed_merge_methods.length === 0 ||
          actualParameters.allowed_merge_methods.some(
            (method) => !["merge", "squash", "rebase"].includes(method),
          ) ||
          new Set(actualParameters.allowed_merge_methods).size !==
            actualParameters.allowed_merge_methods.length)
      ) {
        return false;
      }
      if (
        Object.prototype.hasOwnProperty.call(actualParameters, "dismissal_restriction") &&
        (actualParameters.dismissal_restriction === null ||
          typeof actualParameters.dismissal_restriction !== "object" ||
          Array.isArray(actualParameters.dismissal_restriction) ||
          typeof actualParameters.dismissal_restriction.enabled !== "boolean" ||
          !Array.isArray(actualParameters.dismissal_restriction.allowed_actors))
      ) {
        return false;
      }
      if (
        Object.prototype.hasOwnProperty.call(
          actualParameters,
          "require_extra_approval_for_unattributed_changes",
        ) &&
        typeof actualParameters.require_extra_approval_for_unattributed_changes !==
          "boolean"
      ) {
        return false;
      }
      if (
        Object.prototype.hasOwnProperty.call(actualParameters, "required_reviewers") &&
        !Array.isArray(actualParameters.required_reviewers)
      ) {
        return false;
      }
    } else if (actualRule.type === "required_status_checks") {
      if (
        extraKeys.some((key) => key !== "do_not_enforce_on_create") ||
        (Object.prototype.hasOwnProperty.call(
          actualParameters,
          "do_not_enforce_on_create",
        ) && actualParameters.do_not_enforce_on_create !== false)
      ) {
        return false;
      }
    } else if (extraKeys.length !== 0) {
      return false;
    }
  }
  return true;
}

function valuesDeepEqual(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => valuesDeepEqual(value, right[index]))
    );
  }
  if (
    left !== null &&
    right !== null &&
    typeof left === "object" &&
    typeof right === "object"
  ) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      valuesDeepEqual(leftKeys, rightKeys) &&
      leftKeys.every((key) => valuesDeepEqual(left[key], right[key]))
    );
  }
  return Object.is(left, right);
}

async function loadConsumerSecuritySnapshot({
  repoSlug,
  workflowPath,
  canonicalWorkflow,
  controlPlaneOwner,
  expectedDefaultBranch = null,
}) {
  const repoInfo = await ghJson(`repos/${repoSlug}`);
  if (
    repoInfo?.full_name !== repoSlug ||
    !Number.isSafeInteger(repoInfo?.id) ||
    repoInfo.id <= 0 ||
    typeof repoInfo?.node_id !== "string" ||
    repoInfo.node_id === ""
  ) {
    throw new Error(`${repoSlug} repository metadata does not prove the expected identity.`);
  }
  if (repoInfo.archived) {
    throw new Error(`${repoSlug} is archived; not changing rulesets.`);
  }
  const defaultBranch = repoInfo.default_branch;
  if (typeof defaultBranch !== "string" || defaultBranch === "") {
    throw new Error(`${repoSlug} repository metadata lacks a default branch.`);
  }
  if (expectedDefaultBranch !== null && defaultBranch !== expectedDefaultBranch) {
    throw new Error(
      `Repository default branch changed from ${expectedDefaultBranch} to ${defaultBranch}; refusing an unstable activation write.`,
    );
  }
  const workflowPermissions = await ghJson(
    `repos/${repoSlug}/actions/permissions/workflow`,
  );
  if (workflowPermissions?.default_workflow_permissions !== "read") {
    throw new Error(
      `${repoSlug} must set default workflow permissions to read before the GitHub Actions source can be uniquely trusted.`,
    );
  }
  const controlPlaneOwnerPermission = await loadControlPlaneOwnerPermission({
    repoSlug,
    owner: controlPlaneOwner,
  });
  const branch = await ghJson(
    `repos/${repoSlug}/branches/${encodeURIComponent(defaultBranch)}`,
  );
  const defaultBranchHeadSha = branch?.commit?.sha;
  if (
    branch?.name !== defaultBranch ||
    typeof defaultBranchHeadSha !== "string" ||
    !/^[0-9a-f]{40}$/u.test(defaultBranchHeadSha)
  ) {
    throw new Error(`${repoSlug}@${defaultBranch} branch metadata is malformed.`);
  }
  try {
    const { workflowFiles, codeownersContent } =
      await loadDefaultBranchControlPlaneInventory({
      repoSlug,
      treeRef: defaultBranchHeadSha,
    });
    validateCanonicalV2WorkflowInventory(
      workflowFiles,
      canonicalWorkflow,
      workflowPath,
    );
    validateControlPlaneCodeownersContent(
      codeownersContent,
      controlPlaneOwner,
    );
    const codeownersErrors = await ghJson(
      `repos/${repoSlug}/codeowners/errors?ref=${encodeURIComponent(defaultBranchHeadSha)}`,
    );
    if (!Array.isArray(codeownersErrors?.errors) || codeownersErrors.errors.length !== 0) {
      throw new Error(
        "GitHub reports CODEOWNERS syntax or ownership errors at the exact default-branch head.",
      );
    }
    return {
      repoId: repoInfo.id,
      repoNodeId: repoInfo.node_id,
      defaultBranch,
      defaultBranchHeadSha,
      workflowInventoryFingerprint: fingerprintWorkflowInventory(workflowFiles),
      codeownersFingerprint: fingerprintText(codeownersContent),
      controlPlaneOwnerPermission,
    };
  } catch (error) {
    throw new Error(
      `${repoSlug}@${defaultBranch} does not have the complete canonical v2 workflow and CODEOWNERS control plane; merge the installation PR, protect the control-plane owner, and remove every v1 caller before staging or activating the ruleset.\n${error.message}`,
    );
  }
}

function assertConsumerSecuritySnapshotStable(
  expected,
  current,
  { phase = "ruleset pre-write readback" } = {},
) {
  if (
    current.repoId !== expected.repoId ||
    current.repoNodeId !== expected.repoNodeId ||
    current.defaultBranch !== expected.defaultBranch ||
    current.defaultBranchHeadSha !== expected.defaultBranchHeadSha ||
    current.workflowInventoryFingerprint !== expected.workflowInventoryFingerprint ||
    current.codeownersFingerprint !== expected.codeownersFingerprint ||
    current.controlPlaneOwnerPermission !== expected.controlPlaneOwnerPermission
  ) {
    if (phase === "ruleset post-write readback") {
      throw new Error(
        "The ruleset write completed, but repository identity, default branch, canonical workflow inventory, CODEOWNERS, or control-plane owner permission changed during post-write readback. Do not treat staging or activation as complete; inspect the written ruleset and restore or disable it before retrying.",
      );
    }
    throw new Error(
      `Repository identity, default branch, canonical workflow inventory, CODEOWNERS, or control-plane owner permission changed during ${phase}; no conditional API write is available, so refusing the write.`,
    );
  }
}

function fingerprintWorkflowInventory(workflowFiles) {
  const hash = createHash("sha256");
  for (const file of [...workflowFiles].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(`${Buffer.byteLength(file.path, "utf8")}:`);
    hash.update(file.path, "utf8");
    hash.update(`${Buffer.byteLength(file.mode, "utf8")}:`);
    hash.update(file.mode, "utf8");
    hash.update(`${Buffer.byteLength(file.content, "utf8")}:`);
    hash.update(file.content, "utf8");
  }
  return hash.digest("hex");
}

function fingerprintText(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function loadControlPlaneOwnerPermission({ repoSlug, owner }) {
  const login = normalizeControlPlaneOwner(owner).slice(1);
  const permission = await ghJson(
    `repos/${repoSlug}/collaborators/${encodeURIComponent(login)}/permission`,
  );
  if (
    typeof permission?.user?.login !== "string" ||
    permission.user.login.toLowerCase() !== login.toLowerCase() ||
    permission.user.type !== "User" ||
    !Number.isSafeInteger(permission.user.id) ||
    permission.user.id <= 0 ||
    typeof permission.user.node_id !== "string" ||
    permission.user.node_id === "" ||
    !["write", "maintain", "admin"].includes(permission?.permission)
  ) {
    throw new Error(
      `${owner} must resolve to a repository collaborator with write, maintain, or admin permission on ${repoSlug}.`,
    );
  }
  return [
    permission.user.login.toLowerCase(),
    permission.user.type,
    permission.user.id,
    permission.user.node_id,
    permission.permission,
  ].join(":");
}

async function loadDefaultBranchControlPlaneInventory({ repoSlug, treeRef }) {
  const rootTree = await loadCompleteGitTree(repoSlug, treeRef, "repository root");
  const githubEntry = findUniqueTreeEntry(rootTree, ".github", "repository root");
  if (githubEntry === null) {
    throw new Error("Default branch lacks the required .github control-plane tree.");
  }
  assertTreeDirectory(githubEntry, ".github");

  const githubTree = await loadCompleteGitTree(repoSlug, githubEntry.sha, ".github");
  const codeownersEntry = findUniqueTreeEntry(githubTree, "CODEOWNERS", ".github");
  if (
    codeownersEntry === null ||
    codeownersEntry.type !== "blob" ||
    !["100644", "100755"].includes(codeownersEntry.mode)
  ) {
    throw new Error(
      "Default branch lacks a regular .github/CODEOWNERS Git blob.",
    );
  }
  const codeownersBlob = await ghJson(
    `repos/${repoSlug}/git/blobs/${encodeURIComponent(codeownersEntry.sha)}`,
  );
  const codeownersContent = decodeGitHubBlobContent(codeownersBlob);
  const workflowsEntry = findUniqueTreeEntry(githubTree, "workflows", ".github");
  if (workflowsEntry === null) {
    throw new Error("Default branch lacks the required .github/workflows tree.");
  }
  assertTreeDirectory(workflowsEntry, ".github/workflows");

  const workflowsTree = await loadCompleteGitTree(
    repoSlug,
    workflowsEntry.sha,
    ".github/workflows",
  );
  const inventory = [];
  for (const entry of workflowsTree) {
    if (!/\.ya?ml$/.test(entry.path)) {
      continue;
    }
    if (
      entry.type !== "blob" ||
      !["100644", "100755"].includes(entry.mode)
    ) {
      throw new Error(
        `.github/workflows/${entry.path} is not a regular Git blob; workflow inventory is inconclusive.`,
      );
    }
    const blob = await ghJson(`repos/${repoSlug}/git/blobs/${encodeURIComponent(entry.sha)}`);
    inventory.push({
      path: `.github/workflows/${entry.path}`,
      mode: entry.mode,
      content: decodeGitHubBlobContent(blob),
    });
  }
  return { workflowFiles: inventory, codeownersContent };
}

async function loadCompleteGitTree(repoSlug, treeRef, label) {
  const response = await ghJson(
    `repos/${repoSlug}/git/trees/${encodeURIComponent(treeRef)}`,
  );
  if (response?.truncated !== false || !Array.isArray(response.tree)) {
    throw new Error(
      `${label} Git tree is truncated or malformed; workflow inventory is inconclusive.`,
    );
  }
  for (const entry of response.tree) {
    if (
      typeof entry?.path !== "string" ||
      typeof entry?.sha !== "string" ||
      typeof entry?.type !== "string"
    ) {
      throw new Error(`${label} Git tree contains a malformed entry.`);
    }
  }
  return response.tree;
}

function findUniqueTreeEntry(tree, path, label) {
  const matches = tree.filter((entry) => entry.path === path);
  if (matches.length > 1) {
    throw new Error(`${label} Git tree contains duplicate ${path} entries.`);
  }
  return matches[0] ?? null;
}

function assertTreeDirectory(entry, path) {
  if (entry.type !== "tree") {
    throw new Error(`${path} is not a Git tree; workflow inventory is inconclusive.`);
  }
}

async function loadRulesets(repoSlug) {
  const pages = await ghJson(`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`, {
    paginate: true,
  });
  const summaries = pages.flat();
  return Promise.all(
    summaries.map((ruleset) => ghJson(`repos/${repoSlug}/rulesets/${ruleset.id}`)),
  );
}

function printDryRun(action, options, payload, existingRuleset = null) {
  console.log(`Dry run: would ${action} repository ruleset "${payload.name}".`);
  if (existingRuleset !== null) {
    console.log(`Existing ruleset: ${rulesetLabel(existingRuleset)}`);
  }
  console.log(`Required status: ${options.context}`);
  console.log(`Enforcement: ${payload.enforcement}`);
  console.log(`Required source: GitHub Actions (${options.integrationId})`);
  console.log(`Required control-plane owner: ${options.controlPlaneOwner}`);
  console.log(`Target refs: ${(payload.conditions?.ref_name?.include ?? []).join(", ")}`);
  console.log("Payload:");
  console.log(JSON.stringify(payload, null, 2));
  console.log(`Run again with --apply to ${action} it.`);
}

async function loadCanonicalWorkflow() {
  const content = await readFile(CANONICAL_WORKFLOW_SOURCE, "utf8");
  return validateCanonicalV2WorkflowContent(content);
}

async function prepareConsumerWorktree({
  targetRoot,
  canonicalWorkflow,
  controlPlaneOwner,
  apply,
}) {
  const rootWitness = await assertLocalGitWorktree(targetRoot);
  const parentWitnesses = await prepareVerifiedWorkflowParents({
    targetRoot,
    rootWitness,
    create: apply,
  });
  const workflowPath = join(targetRoot, ...DEFAULT_WORKFLOW_PATH.split("/"));
  const codeownersPath = join(targetRoot, ...DEFAULT_CODEOWNERS_PATH.split("/"));
  const currentWorkflow = await readOptionalRegularFile(workflowPath);
  const currentCodeowners = await readOptionalRegularFile(codeownersPath);
  const lowerPrecedenceCodeowners = await findLowerPrecedenceCodeowners(targetRoot);
  if (lowerPrecedenceCodeowners !== null) {
    throw new Error(
      `${lowerPrecedenceCodeowners} is a lower-precedence CODEOWNERS file. ${DEFAULT_CODEOWNERS_PATH} would shadow or already shadows it; merge its entries into ${DEFAULT_CODEOWNERS_PATH}, remove the lower-precedence file in the same installation PR, then rerun the helper.`,
    );
  }
  const preparedCodeowners = ensureControlPlaneCodeownersContent(
    currentCodeowners,
    controlPlaneOwner,
  );
  const otherCallerPaths = await findOtherGateCallerWorkflowPaths({
    targetRoot,
    canonicalWorkflowPath: workflowPath,
  });
  if (otherCallerPaths.length > 0) {
    throw new Error(
      `Additional v1/v2 gate callers require explicit removal in the same installation PR: ${otherCallerPaths.join(", ")}`,
    );
  }
  await revalidateDirectoryChain(parentWitnesses, "after local workflow inspection");

  const workflowChanged = currentWorkflow !== canonicalWorkflow;
  console.log(`Target worktree: ${targetRoot}`);
  console.log(`Workflow: ${DEFAULT_WORKFLOW_PATH}`);
  console.log(`Control plane: ${DEFAULT_CODEOWNERS_PATH} -> ${controlPlaneOwner}`);
  if (!workflowChanged) {
    console.log("No change: local workflow already matches the canonical v2 bytes.");
  }
  if (!preparedCodeowners.changed) {
    console.log("No change: local CODEOWNERS already has canonical final control-plane ownership.");
  }
  if (!workflowChanged && !preparedCodeowners.changed) {
    return;
  }

  const workflowAction = currentWorkflow === null
    ? "install the canonical v2 workflow"
    : workflowContainsLegacyV1Caller(currentWorkflow)
      ? "replace the canonical-path v1 caller with v2"
      : "replace the drifted workflow with canonical v2 bytes";
  if (!apply) {
    if (workflowChanged) {
      console.log(`Dry run: would ${workflowAction}.`);
    }
    if (preparedCodeowners.changed) {
      console.log(
        `Dry run: would preserve unrelated CODEOWNERS entries and install final control-plane ownership for ${controlPlaneOwner}.`,
      );
    }
    console.log("Run again with --apply, then review the resulting target-repository diff.");
    return;
  }

  if (parentWitnesses.github === null || parentWitnesses.workflows === null) {
    throw new Error("Verified workflow parent chain is incomplete before write.");
  }
  if (preparedCodeowners.changed) {
    await installPreparedConsumerFile({
      path: codeownersPath,
      content: preparedCodeowners.content,
      expectedContent: currentCodeowners,
      parentWitnesses,
      label: "CODEOWNERS",
    });
  }
  if (workflowChanged) {
    await installPreparedConsumerFile({
      path: workflowPath,
      content: canonicalWorkflow,
      expectedContent: currentWorkflow,
      parentWitnesses,
      label: "workflow",
    });
  }

  const installedWorkflow = await readOptionalRegularFile(workflowPath);
  if (!installedWorkflowMatchesCanonical(installedWorkflow, canonicalWorkflow)) {
    throw new Error("Local workflow failed exact-byte post-install verification.");
  }
  const installedCodeowners = await readOptionalRegularFile(codeownersPath);
  validateControlPlaneCodeownersContent(installedCodeowners, controlPlaneOwner);
  if (installedCodeowners !== preparedCodeowners.content) {
    throw new Error("Local CODEOWNERS failed exact-byte post-install verification.");
  }
  await revalidateDirectoryChain(parentWitnesses, "after exact-byte verification");
  if (workflowChanged) {
    console.log(`Applied: ${workflowAction}.`);
  }
  if (preparedCodeowners.changed) {
    console.log(`Applied: protect the control plane with ${controlPlaneOwner}.`);
  }
  console.log(
    "Next: review the target-repository diff, open one installation PR, and obtain an independent exact-head control-plane-owner approval.",
  );
}

async function installPreparedConsumerFile({
  path,
  content,
  expectedContent,
  parentWitnesses,
  label,
}) {
  const temporaryPath = join(
    dirname(path),
    `.codex-review-gate.${label.toLowerCase()}-${process.pid}-${Date.now()}`,
  );
  let temporaryOwned = false;
  let renameCompleted = false;
  try {
    await revalidateDirectoryChain(parentWitnesses, `before temporary ${label} write`);
    await assertConsumerFileContentStable(path, expectedContent, label);
    await writeFile(temporaryPath, content, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o644,
    });
    temporaryOwned = true;
    await revalidateDirectoryChain(parentWitnesses, `after temporary ${label} write`);
    await revalidateDirectoryChain(parentWitnesses, `before ${label} install rename`);
    await assertConsumerFileContentStable(path, expectedContent, label);
    await rename(temporaryPath, path);
    temporaryOwned = false;
    renameCompleted = true;
    await revalidateDirectoryChain(parentWitnesses, `after ${label} install rename`);
  } catch (error) {
    if (temporaryOwned) {
      throw new Error(
        `${error.message}\nA temporary ${label} file may remain in whichever directory the path-based create resolved at operation time. No path-based cleanup was attempted after failure.`,
      );
    }
    if (renameCompleted) {
      throw new Error(
        `${error.message}\nThe path-based rename completed before the checkpoint mismatch was detected; inspect the intended target and any concurrently substituted parent.`,
      );
    }
    throw error;
  }

}

// Protected property: the target file's admitted absence or exact UTF-8
// content must remain stable until each best-effort pre-rename checkpoint.
// Replacing an object with identical content is benign for this property;
// unreadable, non-regular, or changed content remains a distinct failure.
async function assertConsumerFileContentStable(path, expectedContent, label) {
  const currentContent = await readOptionalRegularFile(path);
  if (currentContent !== expectedContent) {
    throw new Error(
      `${label} changed after local preparation; refusing to overwrite concurrent content. Re-run the helper against the latest target worktree.`,
    );
  }
}

async function findLowerPrecedenceCodeowners(targetRoot) {
  const rootCodeownersPath = join(targetRoot, "CODEOWNERS");
  if (await readOptionalRegularFile(rootCodeownersPath) !== null) {
    return "CODEOWNERS";
  }

  const docsPath = join(targetRoot, "docs");
  const docsMetadata = await lstat(docsPath).catch((error) => {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (docsMetadata === null) {
    return null;
  }
  if (!docsMetadata.isDirectory() || docsMetadata.isSymbolicLink()) {
    throw new Error(
      `Cannot safely inspect lower-precedence CODEOWNERS location: ${docsPath}`,
    );
  }
  return (await readOptionalRegularFile(join(docsPath, "CODEOWNERS"))) === null
    ? null
    : "docs/CODEOWNERS";
}

// Admission property: targetRoot is the exact root of a genuine non-bare Git
// worktree and its .git marker agrees with Git's administrative identity. The
// Git-reported top level prevents admitting a nested directory; the reported
// git/common directories bind a main-worktree directory marker; and a linked
// worktree additionally requires both its forward pointer and administrative
// gitdir backpointer. dev/ino and mode/uid/gid then detect marker replacement
// or access-policy change during this validation. Size, timestamps, and link
// count are ignored because they do not change the selected property. A failed
// Git probe is reported as unreadable/invalid rather than as a proved mismatch.
async function assertLocalGitWorktree(targetRoot) {
  if (/[\0\r\n]/u.test(targetRoot)) {
    throw new Error("--prepare-worktree path must not contain NUL or newline characters.");
  }
  const rootWitness = await readDirectoryWitness(
    targetRoot,
    "--prepare-worktree root",
  );
  const gitMarkerPath = join(targetRoot, ".git");
  let gitMarker;
  try {
    gitMarker = await lstat(gitMarkerPath, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      gitMarker = null;
    } else {
      throw new Error(`Unable to inspect Git worktree marker: ${error.message}`);
    }
  }
  if (
    gitMarker === null ||
    gitMarker.isSymbolicLink() ||
    (!gitMarker.isDirectory() && !gitMarker.isFile())
  ) {
    throw new Error(`--prepare-worktree is not a Git worktree: ${targetRoot}`);
  }

  let insideWorktree;
  let bareRepository;
  let topLevel;
  let gitDirectory;
  let commonDirectory;
  try {
    [insideWorktree, bareRepository, topLevel, gitDirectory, commonDirectory] =
      await Promise.all([
        gitRevParse(targetRoot, "--is-inside-work-tree"),
        gitRevParse(targetRoot, "--is-bare-repository"),
        gitRevParse(targetRoot, "--path-format=absolute", "--show-toplevel"),
        gitRevParse(targetRoot, "--absolute-git-dir"),
        gitRevParse(targetRoot, "--path-format=absolute", "--git-common-dir"),
      ]);
  } catch (error) {
    throw new Error(
      `--prepare-worktree is not a valid Git worktree: ${targetRoot}: ${error.message}`,
    );
  }
  if (insideWorktree !== "true" || bareRepository !== "false") {
    throw new Error(`--prepare-worktree must name a non-bare Git worktree: ${targetRoot}`);
  }

  const [canonicalTargetRoot, canonicalTopLevel, canonicalGitDirectory, canonicalCommonDirectory] =
    await Promise.all([
      realpath(targetRoot),
      realpath(topLevel),
      realpath(gitDirectory),
      realpath(commonDirectory),
    ]);
  if (canonicalTargetRoot !== canonicalTopLevel) {
    throw new Error(
      `--prepare-worktree must name the exact Git worktree root: ${targetRoot}`,
    );
  }

  if (gitMarker.isDirectory()) {
    const canonicalMarkerDirectory = await realpath(gitMarkerPath);
    if (
      canonicalMarkerDirectory !== canonicalGitDirectory ||
      canonicalMarkerDirectory !== canonicalCommonDirectory
    ) {
      throw new Error(
        `--prepare-worktree .git directory does not match Git's worktree metadata: ${gitMarkerPath}`,
      );
    }
  } else {
    await assertLinkedWorktreeBackpointer({
      targetRoot,
      gitMarkerPath,
      canonicalGitDirectory,
    });
  }

  const currentGitMarker = await lstat(gitMarkerPath, { bigint: true });
  assertGitMarkerStable(gitMarkerPath, gitMarker, currentGitMarker);
  await revalidateDirectoryWitness(rootWitness, "after Git worktree marker inspection");
  return rootWitness;
}

async function assertLinkedWorktreeBackpointer({
  targetRoot,
  gitMarkerPath,
  canonicalGitDirectory,
}) {
  const markerContent = await readFile(gitMarkerPath, "utf8");
  const markerMatch = markerContent.match(/^gitdir: ([^\0\r\n]+)\r?\n?$/u);
  if (markerMatch === null) {
    throw new Error(`Invalid linked-worktree .git file: ${gitMarkerPath}`);
  }
  const declaredGitDirectory = isAbsolute(markerMatch[1])
    ? markerMatch[1]
    : resolve(targetRoot, markerMatch[1]);
  if (await realpath(declaredGitDirectory) !== canonicalGitDirectory) {
    throw new Error(
      `Linked-worktree .git file does not name Git's administrative directory: ${gitMarkerPath}`,
    );
  }

  const backpointerPath = join(canonicalGitDirectory, "gitdir");
  const backpointerMetadata = await lstat(backpointerPath).catch((error) => {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (
    backpointerMetadata === null ||
    backpointerMetadata.isSymbolicLink() ||
    !backpointerMetadata.isFile()
  ) {
    throw new Error(
      `Linked-worktree administrative directory lacks a regular gitdir backpointer: ${canonicalGitDirectory}`,
    );
  }
  const backpointerContent = await readFile(backpointerPath, "utf8");
  const backpointerMatch = backpointerContent.match(/^([^\0\r\n]+)\r?\n?$/u);
  if (backpointerMatch === null) {
    throw new Error(`Invalid linked-worktree gitdir backpointer: ${backpointerPath}`);
  }
  const declaredMarkerPath = isAbsolute(backpointerMatch[1])
    ? backpointerMatch[1]
    : resolve(canonicalGitDirectory, backpointerMatch[1]);
  const [canonicalDeclaredMarker, canonicalActualMarker] = await Promise.all([
    realpath(declaredMarkerPath),
    realpath(gitMarkerPath),
  ]);
  if (canonicalDeclaredMarker !== canonicalActualMarker) {
    throw new Error(
      `Linked-worktree gitdir backpointer does not return to the admitted .git file: ${backpointerPath}`,
    );
  }
}

function assertGitMarkerStable(path, expected, current) {
  if (
    expected.dev !== current.dev ||
    expected.ino !== current.ino ||
    expected.mode !== current.mode ||
    expected.uid !== current.uid ||
    expected.gid !== current.gid ||
    expected.isDirectory() !== current.isDirectory() ||
    expected.isFile() !== current.isFile() ||
    current.isSymbolicLink()
  ) {
    throw new Error(`Git worktree marker changed during validation: ${path}`);
  }
}

async function gitRevParse(targetRoot, ...args) {
  const stdout = await runCommand("git", ["-C", targetRoot, "rev-parse", ...args]);
  const value = stdout.replace(/\r?\n$/u, "");
  if (/[\r\n]/u.test(value)) {
    throw new Error("git rev-parse returned more than one result.");
  }
  return value;
}

// Protected property: at each explicit checkpoint, the lexical worktree and
// workflow-parent paths resolve to the same directory objects and POSIX access
// policy captured at admission. dev/ino bind checkpoint object identity;
// mode/uid/gid bind checkpoint access policy. Directory size, timestamps, and
// link count are deliberately ignored because ordinary child-entry churn
// changes them without changing that property.
//
// Node does not expose portable openat/renameat/unlinkat operations. The
// following checks therefore reject static symlinks and detect ordinary races
// visible at a checkpoint, but they are not an operation-bound placement
// guarantee. A malicious same-UID process can replace a parent after a check
// and before a path-based write or rename, causing side effects before the next
// mismatch is observed. Run this helper only in a worktree whose parents are
// not concurrently mutable by an untrusted process.
async function prepareVerifiedWorkflowParents({ targetRoot, rootWitness, create }) {
  await revalidateDirectoryWitness(rootWitness, "before parent-chain inspection");
  const githubPath = join(targetRoot, ".github");
  let githubWitness = await readDirectoryWitness(
    githubPath,
    ".github parent",
    { optional: true },
  );
  if (githubWitness === null && create) {
    await revalidateDirectoryWitness(rootWitness, "before creating .github");
    await mkdir(githubPath, { mode: 0o755 });
    await revalidateDirectoryWitness(rootWitness, "after creating .github");
    githubWitness = await readDirectoryWitness(githubPath, ".github parent");
  }

  const workflowsPath = join(githubPath, "workflows");
  let workflowsWitness = githubWitness === null
    ? null
    : await readDirectoryWitness(workflowsPath, ".github/workflows parent", {
        optional: true,
      });
  if (workflowsWitness === null && githubWitness !== null && create) {
    await revalidateDirectoryWitness(
      githubWitness,
      "before creating workflows parent",
    );
    await mkdir(workflowsPath, { mode: 0o755 });
    await revalidateDirectoryWitness(
      githubWitness,
      "after creating workflows parent",
    );
    workflowsWitness = await readDirectoryWitness(
      workflowsPath,
      ".github/workflows parent",
    );
  }

  const witnesses = {
    root: rootWitness,
    github: githubWitness,
    workflows: workflowsWitness,
  };
  await revalidateDirectoryChain(witnesses, "after parent-chain inspection");
  return witnesses;
}

async function readDirectoryWitness(path, label, { optional = false } = {}) {
  let metadata;
  try {
    metadata = await lstat(path, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT" && optional) {
      return null;
    }
    if (error?.code === "ENOENT") {
      throw new Error(`${label} is missing: ${path}`);
    }
    throw new Error(`Unable to inspect ${label} at ${path}: ${error.message}`);
  }
  return directoryWitnessFromMetadata(path, metadata, label);
}

async function revalidateDirectoryWitness(witness, phase) {
  let metadata;
  try {
    metadata = await lstat(witness.path, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Verified parent is missing during ${phase}: ${witness.path}`);
    }
    throw new Error(
      `Unable to revalidate verified parent during ${phase}: ${witness.path}: ${error.message}`,
    );
  }
  return assertDirectoryWitnessStable(witness, metadata, phase);
}

async function revalidateDirectoryChain(witnesses, phase) {
  await revalidateDirectoryWitness(witnesses.root, phase);
  if (witnesses.github !== null) {
    await revalidateDirectoryWitness(witnesses.github, phase);
  }
  if (witnesses.workflows !== null) {
    await revalidateDirectoryWitness(witnesses.workflows, phase);
  }
}

async function findOtherGateCallerWorkflowPaths({ targetRoot, canonicalWorkflowPath }) {
  const workflowsDirectory = join(targetRoot, ".github", "workflows");
  const entries = await readdir(workflowsDirectory, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  const callerPaths = [];
  for (const entry of entries) {
    if (!/\.ya?ml$/.test(entry.name)) {
      continue;
    }
    const absolutePath = join(workflowsDirectory, entry.name);
    if (absolutePath === canonicalWorkflowPath) {
      continue;
    }
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`Cannot safely inspect non-regular workflow: ${absolutePath}`);
    }
    const content = await readFile(absolutePath, "utf8");
    if (workflowContainsCodexReviewGateCaller(content)) {
      callerPaths.push(absolutePath.slice(targetRoot.length + 1));
    }
  }
  return callerPaths.sort();
}

async function readOptionalRegularFile(path) {
  const metadata = await lstat(path).catch((error) => {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (metadata === null) {
    return null;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Refusing to replace non-regular installation path: ${path}`);
  }
  const bytes = await readFile(path);
  const content = bytes.toString("utf8");
  if (!Buffer.from(content, "utf8").equals(bytes)) {
    throw new Error(`Refusing to inspect non-UTF-8 installation file: ${path}`);
  }
  return content;
}

function rulesetLabel(ruleset) {
  const source = ruleset.source_type ?? "Repository";
  return `${ruleset.name} (${source}, id ${ruleset.id})`;
}

function ghJson(endpoint, { method = "GET", body = undefined, paginate = false } = {}) {
  return new Promise((resolve, reject) => {
    const args = ["api", endpoint];
    if (method !== "GET") {
      args.push("--method", method);
    }
    if (paginate) {
      args.push("--paginate", "--slurp");
    }
    if (body !== undefined) {
      args.push("--input", "-");
    }

    const child = spawn("gh", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

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

    if (body !== undefined) {
      child.stdin.end(`${JSON.stringify(body)}\n`);
    } else {
      child.stdin.end();
    }

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `gh api ${endpoint} exited with ${code}`));
        return;
      }
      try {
        resolve(stdout.trim() === "" ? null : JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`gh api ${endpoint} returned invalid JSON: ${error.message}`));
      }
    });
  });
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 64 * 1024) {
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 64 * 1024) {
        child.kill("SIGKILL");
      }
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code !== 0) {
        reject(
          new Error(
            stderr.trim() ||
              `${command} ${args.join(" ")} exited with ${code ?? signal}`,
          ),
        );
        return;
      }
      resolve(stdout);
    });
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
