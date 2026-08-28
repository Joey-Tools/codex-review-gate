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
  DEFAULT_CONTROLLER_WORKFLOW_PATH,
  DEFAULT_CONTROL_PLANE_OWNER,
  DEFAULT_RULESET_ENFORCEMENT,
  DEFAULT_RULESET_NAME,
  DEFAULT_STATUS_CONTEXT,
  DEFAULT_STATUS_INTEGRATION_ID,
  DEFAULT_VERIFIER_RUN_NAME_PREFIX,
  DEFAULT_WORKFLOW_PATH,
  LEGACY_STATUS_CONTEXT,
  assertCompleteRulesetApiObject,
  assertDirectoryWitnessStable,
  buildCreateRulesetPayload,
  canonicalClassicRequiredStatusChecks,
  canonicalLegacyReviewGateInventoryBytes,
  buildUpdateRulesetPayload,
  codeownersHasEffectiveUnmanagedPatterns,
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
  validateCanonicalV2ControllerWorkflowContent,
  validateCanonicalV2VerifierWorkflowContent,
  validateCanonicalV2WorkflowInventory,
  validateControlPlaneCodeownersContent,
  workflowContainsCodexReviewGateCaller,
  workflowContainsLegacyV1Caller,
  workflowSingleProducerPolicyViolations,
} from "../src/bootstrap.mjs";

const SOURCE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CANONICAL_VERIFIER_WORKFLOW_SOURCE = join(
  SOURCE_ROOT,
  "templates/codex-gated-repo/.github/workflows/codex-review-gate.yml",
);
const CANONICAL_CONTROLLER_WORKFLOW_SOURCE = join(
  SOURCE_ROOT,
  "templates/codex-gated-repo/.github/workflows/codex-review-gate-controller.yml",
);
const GH_NOT_FOUND = Symbol("GitHub API not found");
const GITHUB_PULL_REQUEST_FILES_LIMIT = 3_000;
const GITHUB_PULL_REQUEST_FILES_PAGE_SIZE = 100;

async function main() {
  const options = readCliOptions();
  const canonicalWorkflows = await loadCanonicalWorkflows();

  if (options.prepareWorktree !== null) {
    await prepareConsumerWorktree({
      targetRoot: options.prepareWorktree,
      canonicalWorkflows,
      controlPlaneOwner: options.controlPlaneOwner,
      apply: options.apply,
    });
    return;
  }

  const initialSecuritySnapshot = await loadConsumerSecuritySnapshot({
    repoSlug: options.repo.slug,
    canonicalWorkflows,
    controlPlaneOwner: options.controlPlaneOwner,
  });
  const { defaultBranch } = initialSecuritySnapshot;
  if (!options.verifyPostCleanup) {
    await assertExpectedLegacyInventoryDigest({
      repoSlug: options.repo.slug,
      defaultBranch,
      expectedDigest: options.expectedLegacyInventorySha256,
      phase: "initial approval-snapshot readback",
    });
  }

  const effectiveRulesets = await loadRulesets(options.repo.slug);
  if (options.activate) {
    assertCodeownersActivationDoesNotExpandPolicy({
      securitySnapshot: initialSecuritySnapshot,
      rulesets: effectiveRulesets,
      defaultBranch,
    });
  }

  console.log(`Repository: ${options.repo.slug}`);
  console.log(`Default branch: ${defaultBranch}`);
  console.log(`Verifier: ${DEFAULT_WORKFLOW_PATH} exactly matches the canonical v2 verifier`);
  console.log(`Controller: ${DEFAULT_CONTROLLER_WORKFLOW_PATH} exactly matches the canonical v2 controller`);
  console.log(`Control plane: ${DEFAULT_CODEOWNERS_PATH} protects the workflow and itself for ${options.controlPlaneOwner}`);
  if (initialSecuritySnapshot.classicLegacyStatusRequired) {
    console.log(
      `Fail-closed migration overlap: classic branch protection continues to require ${LEGACY_STATUS_CONTEXT} until the separate v2 ruleset is active and read back.`,
    );
  }

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

  if (options.verifyPostCleanup) {
    const firstLegacyInventory = await assertPostCleanupLegacyInventoryClear({
      repoSlug: options.repo.slug,
      defaultBranch,
      repositoryId: initialSecuritySnapshot.repoId,
      repositoryNodeId: initialSecuritySnapshot.repoNodeId,
    });
    if (repoRuleset === undefined) {
      throw new Error(
        `Post-cleanup verification requires repository ruleset "${options.rulesetName}" to exist.`,
      );
    }
    const firstFullRuleset = await loadPostCleanupV2Ruleset({
      repoSlug: options.repo.slug,
      rulesetId: repoRuleset.id,
      rulesetName: options.rulesetName,
      defaultBranch,
      context: options.context,
      integrationId: options.integrationId,
    });
    const secondLegacyInventory = await assertPostCleanupLegacyInventoryClear({
      repoSlug: options.repo.slug,
      defaultBranch,
      repositoryId: initialSecuritySnapshot.repoId,
      repositoryNodeId: initialSecuritySnapshot.repoNodeId,
    });
    const secondFullRuleset = await loadPostCleanupV2Ruleset({
      repoSlug: options.repo.slug,
      rulesetId: repoRuleset.id,
      rulesetName: options.rulesetName,
      defaultBranch,
      context: options.context,
      integrationId: options.integrationId,
    });
    if (
      firstLegacyInventory !== secondLegacyInventory ||
      postCleanupRulesetFingerprint(firstFullRuleset) !==
        postCleanupRulesetFingerprint(secondFullRuleset)
    ) {
      throw new Error(
        "Post-cleanup repository, legacy-inventory, or v2-ruleset state changed across the two complete readbacks; verification is inconclusive and must be rerun against a stable repository.",
      );
    }
    console.log(
      `Post-cleanup verified across two complete stable readbacks: both legacy requirement surfaces are clear and ${rulesetLabel(secondFullRuleset)} remains the complete Active v2 gate.`,
    );
    return;
  }

  const overlappingLegacyRulesets = effectiveRulesets.filter(
    (ruleset) =>
      ruleset.enforcement === "active" &&
      rulesetCoversDefaultBranch(ruleset, defaultBranch) &&
      rulesetHasRequiredStatusContext(ruleset, LEGACY_STATUS_CONTEXT, {
        integrationId: undefined,
      }) &&
      ruleset.id !== repoRuleset?.id,
  );
  if (overlappingLegacyRulesets.length > 0) {
    console.log(
      `Fail-closed migration overlap: ${LEGACY_STATUS_CONTEXT} remains active in ${overlappingLegacyRulesets
        .map(rulesetLabel)
        .join(", ")} until the separate v2 ruleset is active and read back.`,
    );
  }

  if (
    repoRuleset?.enforcement === "active" &&
    (!rulesetCoversDefaultBranch(repoRuleset, defaultBranch) ||
      !rulesetHasGatePolicy(repoRuleset, options.context, {
        integrationId: options.integrationId,
      }))
  ) {
    throw new Error(
      `Repository ruleset "${options.rulesetName}" is an active legacy or incomplete gate; refusing to disable or replace it during v2 staging. Keep it active and rerun with a distinct --ruleset-name for the disabled v2 ruleset.`,
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
    if (options.activate) {
      throw new Error(
        `Cannot activate missing repository ruleset "${options.rulesetName}" directly. Run a plain --apply first to stage the disabled ruleset, then verify the canary and rerun with --activate.`,
      );
    }
    const payload = buildCreateRulesetPayload({
      name: options.rulesetName,
      context: options.context,
      integrationId: options.integrationId,
      enforcement: DEFAULT_RULESET_ENFORCEMENT,
    });

    if (!options.apply) {
      printDryRun("create", options, payload);
      return;
    }

    const currentSecuritySnapshot = await loadConsumerSecuritySnapshot({
      repoSlug: options.repo.slug,
      canonicalWorkflows,
      controlPlaneOwner: options.controlPlaneOwner,
      expectedDefaultBranch: defaultBranch,
    });
    assertConsumerSecuritySnapshotStable(
      initialSecuritySnapshot,
      currentSecuritySnapshot,
    );
    await assertExpectedLegacyInventoryDigest({
      repoSlug: options.repo.slug,
      defaultBranch,
      expectedDigest: options.expectedLegacyInventorySha256,
      phase: "ruleset pre-write readback",
    });
    if (options.activate) {
      await assertCanaryCheckRunSource({
        repoSlug: options.repo.slug,
        defaultBranch,
        defaultBranchHeadSha: currentSecuritySnapshot.defaultBranchHeadSha,
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
      logSuccess: false,
    });
    const postWriteSecuritySnapshot = await loadConsumerSecuritySnapshot({
      repoSlug: options.repo.slug,
      canonicalWorkflows,
      controlPlaneOwner: options.controlPlaneOwner,
      expectedDefaultBranch: defaultBranch,
    });
    assertConsumerSecuritySnapshotStable(
      currentSecuritySnapshot,
      postWriteSecuritySnapshot,
      { phase: "ruleset post-write readback" },
    );
    await assertExpectedLegacyInventoryDigest({
      repoSlug: options.repo.slug,
      defaultBranch,
      expectedDigest: options.expectedLegacyInventorySha256,
      phase: "ruleset post-write readback",
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
    console.log(`Created ruleset: ${rulesetLabel(created)}`);
    return;
  }

  const fullRuleset = assertSelectedRepositoryRulesetIdentity(
    await ghJson(`repos/${options.repo.slug}/rulesets/${repoRuleset.id}`),
    {
      repoSlug: options.repo.slug,
      rulesetId: repoRuleset.id,
      rulesetName: options.rulesetName,
    },
  );
  if (
    options.activate &&
    fullRuleset?.enforcement === "active" &&
    rulesetCoversDefaultBranch(fullRuleset, defaultBranch) &&
    rulesetHasGatePolicy(fullRuleset, options.context, {
      integrationId: options.integrationId,
    })
  ) {
    if (
      rulesetHasRequiredStatusContext(fullRuleset, LEGACY_STATUS_CONTEXT, {
        integrationId: undefined,
      })
    ) {
      console.log(
        `No cleanup: ${LEGACY_STATUS_CONTEXT} remains required by the active v2 ruleset until a separately authorised legacy cleanup removes it.`,
      );
    }
    console.log(
      `No change: the complete v2 gate policy is already enforced by ${rulesetLabel(fullRuleset)}.`,
    );
    return;
  }
  if (options.activate && fullRuleset?.enforcement !== DEFAULT_RULESET_ENFORCEMENT) {
    throw new Error(
      `Repository ruleset "${options.rulesetName}" must be exactly read back as disabled before --activate can update it to active. An already-active complete gate is a no-op; any other enforcement state requires manual inspection.`,
    );
  }
  const { changed, payload } = buildUpdateRulesetPayload(fullRuleset, {
    context: options.context,
    integrationId: options.integrationId,
    defaultBranch,
    ...(options.activate ? { enforcement: "active" } : {}),
  });
  if (options.activate) {
    const expectedActivationPayload = {
      ...fullRuleset,
      enforcement: "active",
    };
    if (
      fullRuleset.target !== "branch" ||
      !rulesetCoversDefaultBranch(fullRuleset, defaultBranch) ||
      !rulesetHasGatePolicy(fullRuleset, options.context, {
        integrationId: options.integrationId,
      }) ||
      rulesetHasRequiredStatusContext(fullRuleset, LEGACY_STATUS_CONTEXT, {
        integrationId: undefined,
      }) ||
      rulesetWritableFingerprint(payload) !==
        rulesetWritableFingerprint(expectedActivationPayload)
    ) {
      throw new Error(
        `Repository ruleset "${options.rulesetName}" is disabled but not an exact complete staged v2 policy. Run a plain --apply to repair and read back the disabled stage; --activate may change only enforcement from disabled to active.`,
      );
    }
    await assertCanaryCheckRunSource({
      repoSlug: options.repo.slug,
      defaultBranch,
      defaultBranchHeadSha: initialSecuritySnapshot.defaultBranchHeadSha,
      prNumber: options.canaryPr,
      headSha: options.canaryHead,
    });
  }
  if (!changed) {
    if (
      rulesetHasRequiredStatusContext(fullRuleset, LEGACY_STATUS_CONTEXT, {
        integrationId: undefined,
      })
    ) {
      console.log(
        `No cleanup: ${LEGACY_STATUS_CONTEXT} remains required by the active v2 ruleset until a separately authorised legacy cleanup removes it.`,
      );
    }
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
    canonicalWorkflows,
    controlPlaneOwner: options.controlPlaneOwner,
    expectedDefaultBranch: defaultBranch,
  });
  assertConsumerSecuritySnapshotStable(
    initialSecuritySnapshot,
    currentSecuritySnapshot,
  );
  if (activeWrite) {
    const currentRulesets = await loadRulesets(options.repo.slug);
    assertCodeownersActivationDoesNotExpandPolicy({
      securitySnapshot: currentSecuritySnapshot,
      rulesets: currentRulesets,
      defaultBranch,
    });
    await assertCanaryCheckRunSource({
      repoSlug: options.repo.slug,
      defaultBranch,
      defaultBranchHeadSha: currentSecuritySnapshot.defaultBranchHeadSha,
      prNumber: options.canaryPr,
      headSha: options.canaryHead,
    });
  }
  await assertExpectedLegacyInventoryDigest({
    repoSlug: options.repo.slug,
    defaultBranch,
    expectedDigest: options.expectedLegacyInventorySha256,
    phase: "ruleset pre-write readback",
  });
  const currentFullRuleset = assertSelectedRepositoryRulesetIdentity(
    await ghJson(`repos/${options.repo.slug}/rulesets/${fullRuleset.id}`),
    {
      repoSlug: options.repo.slug,
      rulesetId: fullRuleset.id,
      rulesetName: options.rulesetName,
    },
  );
  if (
    rulesetWritableFingerprint(currentFullRuleset) !==
    rulesetWritableFingerprint(fullRuleset)
  ) {
    throw new Error(
      `Ruleset ${fullRuleset.id} changed after planning; refusing a lost-update overwrite. Re-run bootstrap against the latest ruleset.`,
    );
  }
  await assertExpectedLegacyInventoryDigest({
    repoSlug: options.repo.slug,
    defaultBranch,
    expectedDigest: options.expectedLegacyInventorySha256,
    phase: "final ruleset pre-write readback",
  });
  if (activeWrite) {
    await assertCanaryCheckRunSource({
      repoSlug: options.repo.slug,
      defaultBranch,
      defaultBranchHeadSha: currentSecuritySnapshot.defaultBranchHeadSha,
      prNumber: options.canaryPr,
      headSha: options.canaryHead,
    });
    const finalSecuritySnapshot = await loadConsumerSecuritySnapshot({
      repoSlug: options.repo.slug,
      canonicalWorkflows,
      controlPlaneOwner: options.controlPlaneOwner,
      expectedDefaultBranch: defaultBranch,
    });
    assertConsumerSecuritySnapshotStable(
      currentSecuritySnapshot,
      finalSecuritySnapshot,
      { phase: "final ruleset pre-write readback" },
    );
  }
  const finalFullRuleset = assertSelectedRepositoryRulesetIdentity(
    await ghJson(`repos/${options.repo.slug}/rulesets/${fullRuleset.id}`),
    {
      repoSlug: options.repo.slug,
      rulesetId: fullRuleset.id,
      rulesetName: options.rulesetName,
    },
  );
  if (
    rulesetWritableFingerprint(finalFullRuleset) !==
    rulesetWritableFingerprint(fullRuleset)
  ) {
    throw new Error(
      `Ruleset ${fullRuleset.id} changed during the final legacy-inventory readback; refusing a lost-update overwrite. Re-run bootstrap against the latest ruleset.`,
    );
  }
  // GitHub's ruleset API does not expose an If-Match update contract here.
  // Bracket the legacy read with full target-ruleset reads, then keep this
  // second writable-field reread adjacent to PUT. These are the final
  // best-effort lost-update boundaries without an API If-Match contract.
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
    logSuccess: false,
  });
  const postWriteSecuritySnapshot = await loadConsumerSecuritySnapshot({
    repoSlug: options.repo.slug,
    canonicalWorkflows,
    controlPlaneOwner: options.controlPlaneOwner,
    expectedDefaultBranch: defaultBranch,
  });
  assertConsumerSecuritySnapshotStable(
    currentSecuritySnapshot,
    postWriteSecuritySnapshot,
    { phase: "ruleset post-write readback" },
  );
  await assertExpectedLegacyInventoryDigest({
    repoSlug: options.repo.slug,
    defaultBranch,
    expectedDigest: options.expectedLegacyInventorySha256,
    phase: "ruleset post-write readback",
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
  console.log(`Updated ruleset: ${rulesetLabel(updated)}`);
}

function readCliOptions() {
  const { values } = parseArgs({
    options: {
      repo: { type: "string" },
      "prepare-worktree": { type: "string" },
      apply: { type: "boolean", default: false },
      activate: { type: "boolean", default: false },
      "verify-post-cleanup": { type: "boolean", default: false },
      "expected-legacy-inventory-sha256": { type: "string" },
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
  if (
    hasPrepareWorktree &&
    values["expected-legacy-inventory-sha256"] !== undefined
  ) {
    throw new Error(
      "--expected-legacy-inventory-sha256 is only valid with --repo after the owner approval snapshot is recorded.",
    );
  }
  if (hasPrepareWorktree && values["verify-post-cleanup"]) {
    throw new Error("--verify-post-cleanup is valid only with --repo.");
  }
  if (
    hasRepo &&
    !values["verify-post-cleanup"] &&
    values["expected-legacy-inventory-sha256"] === undefined
  ) {
    throw new Error(
      "--repo requires --expected-legacy-inventory-sha256 from the external owner approval snapshot, including when both legacy surfaces were empty.",
    );
  }
  if (
    values["verify-post-cleanup"] &&
    (values.apply ||
      values.activate ||
      values["canary-pr"] !== undefined ||
      values["canary-head"] !== undefined ||
      values["expected-legacy-inventory-sha256"] !== undefined)
  ) {
    throw new Error(
      "--verify-post-cleanup is read-only and cannot be combined with --apply, --activate, canary inputs, or the pre-cleanup legacy digest.",
    );
  }
  if (values.activate && (values["canary-pr"] === undefined || values["canary-head"] === undefined)) {
    throw new Error("--activate requires both --canary-pr and --canary-head for source readback.");
  }
  if (!values.activate && (values["canary-pr"] !== undefined || values["canary-head"] !== undefined)) {
    throw new Error("--canary-pr and --canary-head are valid only with --activate.");
  }
  if (values.context !== DEFAULT_STATUS_CONTEXT) {
    throw new Error(
      `--context is fixed to "${DEFAULT_STATUS_CONTEXT}"; the v2 verifier does not support another required CheckRun name.`,
    );
  }
  const workflowPath = normalizeWorkflowPath(values.workflow);
  if (workflowPath !== DEFAULT_WORKFLOW_PATH) {
    throw new Error(
      `--workflow is fixed to "${DEFAULT_WORKFLOW_PATH}" because v2 verifies an exact two-workflow control plane.`,
    );
  }

  return {
    repo: hasRepo ? parseRepoSlug(values.repo) : null,
    prepareWorktree: hasPrepareWorktree ? resolve(values["prepare-worktree"]) : null,
    apply: values.apply,
    activate: values.activate,
    verifyPostCleanup: values["verify-post-cleanup"],
    rulesetName: values["ruleset-name"],
    controlPlaneOwner: normalizeControlPlaneOwner(values["control-plane-owner"]),
    context: values.context,
    integrationId: DEFAULT_STATUS_INTEGRATION_ID,
    expectedLegacyInventorySha256: hasRepo && !values["verify-post-cleanup"]
      ? parseExpectedLegacyInventorySha256(
          values["expected-legacy-inventory-sha256"],
        )
      : null,
    canaryPr: values.activate ? parseCanaryPr(values["canary-pr"]) : null,
    canaryHead: values.activate ? parseCanaryHead(values["canary-head"]) : null,
  };
}

function printUsage() {
  console.log(`Usage:
  node scripts/bootstrap-codex-review-gate.mjs --prepare-worktree PATH [--control-plane-owner @USER] [--apply]
  node scripts/bootstrap-codex-review-gate.mjs --repo OWNER/REPO --expected-legacy-inventory-sha256 SHA256 [--control-plane-owner @USER] [--apply]
  node scripts/bootstrap-codex-review-gate.mjs --repo OWNER/REPO --expected-legacy-inventory-sha256 SHA256 --activate --canary-pr NUMBER --canary-head SHA [--control-plane-owner @USER] [--apply]
  node scripts/bootstrap-codex-review-gate.mjs --repo OWNER/REPO --verify-post-cleanup [--control-plane-owner @USER]

Options:
  --prepare-worktree PATH Prepare a local consumer checkout for one installation PR.
  --repo OWNER/REPO       Inspect or stage the merged repository ruleset.
  --apply                 Apply the local copy or ruleset change. Defaults to dry-run.
  --expected-legacy-inventory-sha256
                          Exact lowercase SHA-256 from the external owner approval snapshot. Required for every remote staging/activation preview and apply.
  --verify-post-cleanup   Read-only final proof that legacy requirements are clear and the selected v2 ruleset remains Active.
  --activate              Activate only after verifying the named temporary-PR canary.
  --canary-pr NUMBER      Open canary PR to verify before activation.
  --canary-head SHA       Exact lowercase 40-hex canary head to verify before activation.
  --ruleset-name NAME     Repo ruleset to create or update. Defaults to "${DEFAULT_RULESET_NAME}".
  --control-plane-owner   GitHub user owning workflow and CODEOWNERS changes. Defaults to "${DEFAULT_CONTROL_PLANE_OWNER}".
  --context CONTEXT       Required CheckRun name. Must remain "${DEFAULT_STATUS_CONTEXT}".
  --workflow PATH         Verifier path; fixed to "${DEFAULT_WORKFLOW_PATH}" while both workflows are verified.
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

function parseExpectedLegacyInventorySha256(value) {
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(
      `--expected-legacy-inventory-sha256 must be an exact lowercase 64-hex SHA-256: ${value}`,
    );
  }
  return value;
}

function parseCanaryHead(value) {
  if (!/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`--canary-head must be an exact lowercase 40-hex SHA: ${value}`);
  }
  return value;
}

async function assertCanaryCheckRunSource({
  repoSlug,
  defaultBranch,
  defaultBranchHeadSha,
  prNumber,
  headSha,
}) {
  const pullRequest = await ghJson(`repos/${repoSlug}/pulls/${prNumber}`);
  const mergeCommitSha = pullRequest?.merge_commit_sha;
  if (
    pullRequest?.state !== "open" ||
    pullRequest?.merged === true ||
    pullRequest?.draft === true ||
    pullRequest?.base?.ref !== defaultBranch ||
    pullRequest?.base?.repo?.full_name !== repoSlug ||
    pullRequest?.base?.sha !== defaultBranchHeadSha ||
    pullRequest?.head?.repo?.full_name !== repoSlug ||
    pullRequest?.head?.sha !== headSha ||
    typeof mergeCommitSha !== "string" ||
    !/^[0-9a-f]{40}$/u.test(mergeCommitSha)
  ) {
    throw new Error(
      `Canary PR #${prNumber} is not an open, non-draft, same-repository, up-to-date default-branch PR at exact head ${headSha} with a current test-merge SHA.`,
    );
  }

  await assertCanaryControlPlaneUnchanged({
    repoSlug,
    prNumber,
    changedFiles: pullRequest?.changed_files,
  });
  await assertNoLegacyGateStatus({ repoSlug, sha: headSha });
  await assertNoLegacyGateStatus({ repoSlug, sha: mergeCommitSha });

  const checkRuns = await loadCompleteCheckRuns({
    repoSlug,
    sha: headSha,
    checkName: DEFAULT_STATUS_CONTEXT,
  });
  if (checkRuns.length !== 1) {
    throw new Error(
      `Canary feature head ${headSha} must have exactly one latest CheckRun named ${DEFAULT_STATUS_CONTEXT}; found ${checkRuns.length}, so activation cannot exclude a missing or competing producer.`,
    );
  }
  const checkRun = checkRuns[0];
  if (
    checkRun.name !== DEFAULT_STATUS_CONTEXT ||
    checkRun.head_sha !== headSha ||
    checkRun.status !== "completed" ||
    checkRun.conclusion !== "success" ||
    Number(checkRun?.app?.id) !== DEFAULT_STATUS_INTEGRATION_ID ||
    checkRun?.app?.slug !== "github-actions"
  ) {
    throw new Error(
      `Canary ${DEFAULT_STATUS_CONTEXT} is not a successful native GitHub Actions CheckRun on the exact current feature head.`,
    );
  }

  const { runId, jobId } = parseCanonicalActionsJobDetailsUrl(
    checkRun.details_url,
    repoSlug,
  );
  const run = await ghJson(`repos/${repoSlug}/actions/runs/${runId}`);
  const expectedDisplayTitle =
    `${DEFAULT_VERIFIER_RUN_NAME_PREFIX}/${prNumber}/${mergeCommitSha}`;
  if (run?.display_title !== expectedDisplayTitle) {
    throw new Error(
      `Canary run ${runId} lacks the exact current test-merge run-name receipt ${expectedDisplayTitle}.`,
    );
  }
  if (
    Number(run?.id) !== runId ||
    run?.repository?.full_name !== repoSlug ||
    run?.head_repository?.full_name !== repoSlug ||
    run?.path !== DEFAULT_WORKFLOW_PATH ||
    run?.head_sha !== headSha ||
    run?.event !== "pull_request" ||
    run?.status !== "completed" ||
    run?.conclusion !== "success" ||
    !Number.isSafeInteger(run?.workflow_id) ||
    run.workflow_id <= 0 ||
    !Number.isSafeInteger(run?.run_attempt) ||
    run.run_attempt <= 0 ||
    !runContainsCanaryPullRequest(run, {
      repoSlug,
      prNumber,
      headSha,
      defaultBranch,
      defaultBranchHeadSha,
    })
  ) {
    throw new Error(
      `Canary CheckRun does not resolve to a successful current pull_request run of the exact canonical ${DEFAULT_WORKFLOW_PATH} at feature head ${headSha}.`,
    );
  }
  const workflow = await ghJson(
    `repos/${repoSlug}/actions/workflows/${run.workflow_id}`,
  );
  if (
    workflow?.id !== run.workflow_id ||
    workflow?.path !== DEFAULT_WORKFLOW_PATH ||
    workflow?.state !== "active"
  ) {
    throw new Error(
      `Canary run ${runId} is not bound to the active canonical workflow identity.`,
    );
  }

  const jobPages = await ghJson(
    `repos/${repoSlug}/actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100`,
    { paginate: true },
  );
  if (
    !Array.isArray(jobPages) ||
    jobPages.length === 0 ||
    jobPages.some(
      (page) =>
        page === null ||
        typeof page !== "object" ||
        Array.isArray(page) ||
        !Number.isSafeInteger(page.total_count) ||
        page.total_count < 0 ||
        !Array.isArray(page.jobs),
    )
  ) {
    throw new Error(
      "Canary Actions job readback did not return complete paginated job objects.",
    );
  }
  const jobs = jobPages.flatMap((page) => page.jobs);
  const jobTotalCount = jobPages[0].total_count;
  if (
    jobPages.some((page) => page.total_count !== jobTotalCount) ||
    jobs.length !== jobTotalCount ||
    jobs.some(
      (job) =>
        job === null ||
        typeof job !== "object" ||
        Array.isArray(job) ||
        !Number.isSafeInteger(job.id) ||
        job.id <= 0 ||
        Number(job.run_id) !== runId ||
        typeof job.head_sha !== "string" ||
        !/^[0-9a-f]{40}$/u.test(job.head_sha) ||
        typeof job.name !== "string" ||
        job.name === "" ||
        typeof job.status !== "string" ||
        (job.conclusion !== null && typeof job.conclusion !== "string") ||
        typeof job.check_run_url !== "string" ||
        job.check_run_url === "",
    )
  ) {
    throw new Error(
      "Canary Actions job inventory is incomplete, malformed, or inconsistent with the verified run.",
    );
  }
  const canonicalJobs = jobs.filter(
    (job) => job.name === DEFAULT_STATUS_CONTEXT,
  );
  if (
    canonicalJobs.length !== 1 ||
    canonicalJobs[0].id !== jobId ||
    canonicalJobs[0].head_sha !== headSha ||
    canonicalJobs[0].status !== "completed" ||
    canonicalJobs[0].conclusion !== "success"
  ) {
    throw new Error(
      `Verified run ${runId} must contain exactly one successful ${DEFAULT_STATUS_CONTEXT} canonical job bound to its exact head.`,
    );
  }
  const canonicalJob = canonicalJobs[0];
  const checkRunId = parseCanonicalCheckRunApiUrl(
    canonicalJob.check_run_url,
    repoSlug,
  );
  if (checkRunId !== checkRun.id) {
    throw new Error(
      "Canonical verifier job does not resolve to the unique canary CheckRun.",
    );
  }

  console.log(
    `Canary: #${prNumber} has one successful native ${DEFAULT_STATUS_CONTEXT} CheckRun on feature head ${headSha}; the current verifier execution scope is test-merge ${mergeCommitSha}.`,
  );
}

function parseCanonicalActionsJobDetailsUrl(value, repoSlug) {
  if (typeof value !== "string" || value === "") {
    throw new Error("Canary CheckRun lacks a GitHub Actions job details_url.");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Canary CheckRun details_url is not an absolute URL.");
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
    throw new Error(
      "Canary CheckRun details_url is not a canonical same-repository GitHub Actions job URL.",
    );
  }
  const match = url.pathname
    .slice(expectedPrefix.length)
    .match(/^([1-9][0-9]*)\/job\/([1-9][0-9]*)$/u);
  if (match === null) {
    throw new Error(
      "Canary CheckRun details_url does not contain one canonical run and job id.",
    );
  }
  const runId = Number(match[1]);
  const jobId = Number(match[2]);
  if (!Number.isSafeInteger(runId) || !Number.isSafeInteger(jobId)) {
    throw new Error("Canary CheckRun run or job id exceeds the safe integer range.");
  }
  return { runId, jobId };
}

async function assertCanaryControlPlaneUnchanged({
  repoSlug,
  prNumber,
  changedFiles,
}) {
  if (!Number.isSafeInteger(changedFiles) || changedFiles < 0) {
    throw new Error(
      `Canary PR #${prNumber} lacks an authoritative non-negative changed_files count; the protected-control-plane inventory is inconclusive.`,
    );
  }
  if (changedFiles > GITHUB_PULL_REQUEST_FILES_LIMIT) {
    throw new Error(
      `Canary PR #${prNumber} reports ${changedFiles} changed files, beyond GitHub's ${GITHUB_PULL_REQUEST_FILES_LIMIT}-file pull-request files API limit; use a smaller canary PR.`,
    );
  }

  const pages = await ghJson(
    `repos/${repoSlug}/pulls/${prNumber}/files?per_page=100`,
    { paginate: true },
  );
  const expectedPageCount = Math.max(
    1,
    Math.ceil(changedFiles / GITHUB_PULL_REQUEST_FILES_PAGE_SIZE),
  );
  if (
    !Array.isArray(pages) ||
    pages.length !== expectedPageCount ||
    pages.some((page, pageIndex) => {
      if (!Array.isArray(page)) {
        return true;
      }
      const expectedPageSize = Math.min(
        GITHUB_PULL_REQUEST_FILES_PAGE_SIZE,
        Math.max(
          0,
          changedFiles - pageIndex * GITHUB_PULL_REQUEST_FILES_PAGE_SIZE,
        ),
      );
      return page.length !== expectedPageSize;
    })
  ) {
    throw new Error(
      `Canary changed-file readback is incomplete or inconsistent with authoritative changed_files=${changedFiles}.`,
    );
  }

  const files = pages.flat();
  const filenames = new Set();
  const candidatePaths = [];
  for (const file of files) {
    if (
      file === null ||
      typeof file !== "object" ||
      Array.isArray(file) ||
      typeof file.filename !== "string" ||
      file.filename === "" ||
      (file.previous_filename !== undefined &&
        (typeof file.previous_filename !== "string" ||
          file.previous_filename === ""))
    ) {
      throw new Error(
        "Canary changed-file inventory contains a malformed file record.",
      );
    }
    if (filenames.has(file.filename)) {
      throw new Error(
        `Canary changed-file inventory contains duplicate filename ${JSON.stringify(file.filename)}.`,
      );
    }
    filenames.add(file.filename);
    candidatePaths.push(file.filename);
    if (file.previous_filename !== undefined) {
      candidatePaths.push(file.previous_filename);
    }
  }

  if (files.length !== changedFiles) {
    throw new Error(
      `Canary changed-file inventory contains ${files.length} records but authoritative changed_files=${changedFiles}.`,
    );
  }

  const changedControlPlanePaths = [...new Set(candidatePaths)]
    .filter(
      (path) =>
        path === DEFAULT_CODEOWNERS_PATH ||
        path.startsWith(".github/workflows/"),
    )
    .sort();
  if (changedControlPlanePaths.length > 0) {
    throw new Error(
      `Canary PR #${prNumber} changes the protected control plane (${changedControlPlanePaths.join(", ")}); use a harmless non-control-plane canary PR.`,
    );
  }
}

async function assertNoLegacyGateStatus({ repoSlug, sha }) {
  const pages = await ghJson(
    `repos/${repoSlug}/commits/${encodeURIComponent(sha)}/statuses?per_page=100`,
    { paginate: true },
  );
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new Error(
      "Canary legacy commit-status readback did not return complete paginated arrays.",
    );
  }
  const collisions = pages
    .flat()
    .filter((status) => status?.context === DEFAULT_STATUS_CONTEXT);
  if (collisions.length > 0) {
    throw new Error(
      `Canary commit ${sha} still has ${collisions.length} legacy commit status projection(s) named ${DEFAULT_STATUS_CONTEXT}; native-CheckRun activation requires none.`,
    );
  }
}

async function loadCompleteCheckRuns({ repoSlug, sha, checkName }) {
  const pages = await ghJson(
    `repos/${repoSlug}/commits/${encodeURIComponent(sha)}/check-runs?check_name=${encodeURIComponent(checkName)}&filter=latest&per_page=100`,
    { paginate: true },
  );
  if (
    !Array.isArray(pages) ||
    pages.length === 0 ||
    pages.some(
      (page) =>
        page === null ||
        typeof page !== "object" ||
        Array.isArray(page) ||
        !Number.isSafeInteger(page.total_count) ||
        page.total_count < 0 ||
        !Array.isArray(page.check_runs),
    )
  ) {
    throw new Error(
      "Canary CheckRun readback did not return complete paginated objects.",
    );
  }
  const checkRuns = pages.flatMap((page) => page.check_runs);
  const totalCount = pages[0].total_count;
  if (
    pages.some((page) => page.total_count !== totalCount) ||
    checkRuns.length !== totalCount ||
    checkRuns.some(
      (checkRun) =>
        checkRun === null ||
        typeof checkRun !== "object" ||
        Array.isArray(checkRun) ||
        !Number.isSafeInteger(checkRun.id) ||
        checkRun.id <= 0 ||
        checkRun.name !== checkName ||
        checkRun.head_sha !== sha,
    )
  ) {
    throw new Error(
      "Canary CheckRun inventory is incomplete, malformed, or inconsistent with the exact-name filter.",
    );
  }
  return checkRuns;
}

function runContainsCanaryPullRequest(
  run,
  { repoSlug, prNumber, headSha, defaultBranch, defaultBranchHeadSha },
) {
  if (!Array.isArray(run?.pull_requests) || run.pull_requests.length !== 1) {
    return false;
  }
  const pullRequest = run.pull_requests[0];
  return (
    Number(pullRequest?.number) === prNumber &&
    pullRequest?.head?.sha === headSha &&
    pullRequest?.head?.repo?.full_name === repoSlug &&
    pullRequest?.base?.ref === defaultBranch &&
    pullRequest?.base?.sha === defaultBranchHeadSha &&
    pullRequest?.base?.repo?.full_name === repoSlug
  );
}

function parseCanonicalCheckRunApiUrl(value, repoSlug) {
  if (typeof value !== "string" || value === "") {
    throw new Error("Canonical Actions job lacks a check_run_url.");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Canonical Actions job check_run_url is not absolute.");
  }
  const expectedPrefix = `/repos/${repoSlug}/check-runs/`;
  if (
    url.protocol !== "https:" ||
    url.hostname !== "api.github.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    !url.pathname.startsWith(expectedPrefix)
  ) {
    throw new Error(
      "Canonical Actions job check_run_url is not a same-repository GitHub API URL.",
    );
  }
  const checkRunIdText = url.pathname.slice(expectedPrefix.length);
  if (!/^[1-9][0-9]*$/u.test(checkRunIdText)) {
    throw new Error(
      "Canonical Actions job check_run_url does not contain one canonical check-run id.",
    );
  }
  const checkRunId = Number(checkRunIdText);
  if (!Number.isSafeInteger(checkRunId)) {
    throw new Error(
      "Canonical Actions job check-run id exceeds the safe integer range.",
    );
  }
  return checkRunId;
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
  logSuccess = true,
}) {
  if (!Number.isSafeInteger(rulesetId) || rulesetId <= 0) {
    throw new Error(
      "Ruleset write did not return a positive integer id for independent readback.",
    );
  }

  const ruleset = assertCompleteRulesetApiObject(
    await ghJson(`repos/${repoSlug}/rulesets/${rulesetId}`),
  );
  if (
    ruleset.id !== rulesetId ||
    ruleset.source_type !== "Repository" ||
    ruleset.source !== repoSlug ||
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

  if (logSuccess) {
    console.log(
      `Ruleset readback: ${rulesetLabel(ruleset)} is complete with ${enforcement} enforcement.`,
    );
  }
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
  canonicalWorkflows,
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
      canonicalWorkflows,
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
    const classicBranchProtection =
      await loadClassicBranchProtectionPolicy({
        repoSlug,
        defaultBranch,
      });
    const classicLegacyStatusRequired =
      classicBranchProtection.requiredStatusChecks !== null &&
      (
        classicBranchProtection.requiredStatusChecks.contexts.includes(
          LEGACY_STATUS_CONTEXT,
        ) ||
        classicBranchProtection.requiredStatusChecks.checks.some(
          (check) => check.context === LEGACY_STATUS_CONTEXT,
        )
      );
    return {
      repoId: repoInfo.id,
      repoNodeId: repoInfo.node_id,
      defaultBranch,
      defaultBranchHeadSha,
      workflowInventoryFingerprint: fingerprintWorkflowInventory(workflowFiles),
      codeownersFingerprint: fingerprintText(codeownersContent),
      hasEffectiveUnmanagedCodeownersPatterns:
        codeownersHasEffectiveUnmanagedPatterns(codeownersContent),
      // Keep the complete classic producer-binding representation. contexts[]
      // and checks[] are distinct surfaces, strict is writable policy, and
      // app_id null/-1/positive values have different meanings. Missing or
      // unreadable schema never becomes an empty witness.
      classicRequiredStatusChecksFingerprint: fingerprintText(
        JSON.stringify(classicBranchProtection.requiredStatusChecks),
      ),
      classicLegacyStatusRequired,
      classicCodeOwnerReviewRequired:
        classicBranchProtection.codeOwnerReviewRequired,
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
    current.hasEffectiveUnmanagedCodeownersPatterns !==
      expected.hasEffectiveUnmanagedCodeownersPatterns ||
    current.classicRequiredStatusChecksFingerprint !==
      expected.classicRequiredStatusChecksFingerprint ||
    current.classicCodeOwnerReviewRequired !==
      expected.classicCodeOwnerReviewRequired ||
    current.controlPlaneOwnerPermission !== expected.controlPlaneOwnerPermission
  ) {
    if (phase === "ruleset post-write readback") {
      throw new Error(
        "The ruleset write completed, but repository identity, default branch, canonical workflow inventory, CODEOWNERS, classic legacy-gate overlap, or control-plane owner permission changed during post-write readback. Do not treat staging or activation as complete; inspect the written ruleset and restore or disable it before retrying.",
      );
    }
    throw new Error(
      `Repository identity, default branch, canonical workflow inventory, CODEOWNERS, classic legacy-gate overlap, or control-plane owner permission changed during ${phase}; no conditional API write is available, so refusing the write.`,
    );
  }
}

async function loadClassicBranchProtectionPolicy({
  repoSlug,
  defaultBranch,
}) {
  const endpoint =
    `repos/${repoSlug}/branches/${encodeURIComponent(defaultBranch)}/protection`;
  const response = await ghJson(endpoint, { allowNotFound: true });
  if (response === GH_NOT_FOUND) {
    return {
      requiredStatusChecks: null,
      codeOwnerReviewRequired: false,
    };
  }
  if (
    response === null ||
    typeof response !== "object" ||
    Array.isArray(response) ||
    !Object.prototype.hasOwnProperty.call(response, "required_status_checks")
  ) {
    throw new Error(
      "Classic branch protection response is malformed or omits required_status_checks.",
    );
  }
  const requiredStatusChecks = response.required_status_checks;
  const requiredPullRequestReviews = response.required_pull_request_reviews;
  let codeOwnerReviewRequired = false;
  if (requiredPullRequestReviews !== null && requiredPullRequestReviews !== undefined) {
    if (
      typeof requiredPullRequestReviews !== "object" ||
      Array.isArray(requiredPullRequestReviews) ||
      typeof requiredPullRequestReviews.require_code_owner_reviews !== "boolean"
    ) {
      throw new Error(
        "Classic branch protection required_pull_request_reviews is malformed or incomplete.",
      );
    }
    codeOwnerReviewRequired =
      requiredPullRequestReviews.require_code_owner_reviews;
  }
  if (requiredStatusChecks === null) {
    return {
      requiredStatusChecks: null,
      codeOwnerReviewRequired,
    };
  }
  return {
    requiredStatusChecks:
      canonicalClassicRequiredStatusChecks(requiredStatusChecks),
    codeOwnerReviewRequired,
  };
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
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new Error("Repository ruleset listing is not a complete paginated array.");
  }
  const summaries = pages.flat();
  const summaryIds = summaries.map((ruleset) => ruleset?.id);
  if (
    summaryIds.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
    new Set(summaryIds).size !== summaryIds.length
  ) {
    throw new Error("Repository ruleset listing contains malformed or duplicate ids.");
  }
  const rulesets = await Promise.all(summaryIds.map(async (id) => {
    const ruleset = await ghJson(`repos/${repoSlug}/rulesets/${id}`);
    if (ruleset?.id !== id) {
      throw new Error(`Ruleset detail endpoint ${id} returned a different identity.`);
    }
    return ruleset;
  }));
  for (const ruleset of rulesets) {
    assertCompleteRulesetApiObject(ruleset);
  }
  return rulesets;
}

// Protected property: from the externally approved owner snapshot through the
// Disabled stage, canary, activation write, and exact Active readback, every
// original legacy ruleset/classic requirement keeps the same identity,
// effective branch coverage, complete writable policy, and producer binding.
// The repository/default-branch fields bind even an empty inventory. API or
// schema unreadability is inconclusive and remains distinct from a readable
// digest mismatch; neither is treated as legacy absence.
async function assertExpectedLegacyInventoryDigest({
  repoSlug,
  defaultBranch,
  expectedDigest,
  phase,
}) {
  let bytes;
  try {
    bytes = await loadCanonicalLegacyInventoryBytes({ repoSlug, defaultBranch });
  } catch (error) {
    throw new Error(
      `Legacy review-gate inventory is unreadable or schema-inconclusive during ${phase}; refusing to treat any legacy surface as absent.\n${error.message}`,
    );
  }
  const actualDigest = createHash("sha256").update(bytes).digest("hex");
  if (actualDigest !== expectedDigest) {
    const prefix = phase === "ruleset post-write readback"
      ? "The ruleset write completed, but"
      : "Refusing the write because";
    throw new Error(
      `${prefix} the canonical legacy review-gate inventory digest mismatched the external owner approval snapshot during ${phase}: expected ${expectedDigest}, read ${actualDigest}.`,
    );
  }
}

// Post-cleanup proof intentionally uses a new read-only mode rather than the
// pre-cleanup approval digest: an authorised cleanup must change that digest.
// The protected property here is absence of the legacy context on both
// effective ruleset and classic branch-protection surfaces. Other classic
// required checks remain valid and do not make the proof inconclusive.
async function assertPostCleanupLegacyInventoryClear({
  repoSlug,
  defaultBranch,
  repositoryId,
  repositoryNodeId,
}) {
  let bytes;
  try {
    bytes = await loadCanonicalLegacyInventoryBytes({ repoSlug, defaultBranch });
  } catch (error) {
    throw new Error(
      `Post-cleanup legacy review-gate inventory is unreadable or schema-inconclusive; refusing to treat either legacy surface as clear.\n${error.message}`,
    );
  }

  let inventory;
  try {
    inventory = JSON.parse(bytes);
  } catch (error) {
    throw new Error(
      `Post-cleanup legacy review-gate inventory could not be decoded; verification is inconclusive.\n${error.message}`,
    );
  }
  if (
    inventory?.repository !== repoSlug ||
    inventory?.repository_id !== repositoryId ||
    inventory?.repository_node_id !== repositoryNodeId ||
    inventory?.default_branch !== defaultBranch ||
    !Array.isArray(inventory?.rulesets)
  ) {
    throw new Error(
      "Post-cleanup legacy review-gate inventory lost its repository/default-branch binding or ruleset array; verification is inconclusive.",
    );
  }

  const classic = inventory.classic_required_status_checks;
  const classicHasLegacy = classic !== null &&
    (classic.contexts.includes(LEGACY_STATUS_CONTEXT) ||
      classic.checks.some((check) => check.context === LEGACY_STATUS_CONTEXT));
  if (inventory.rulesets.length > 0 || classicHasLegacy) {
    throw new Error(
      `${LEGACY_STATUS_CONTEXT} remains required after cleanup on ${repoSlug}'s ${defaultBranch} branch; leave the v2 ruleset active, remove the remaining legacy requirement, and rerun this read-only verification.`,
    );
  }
  return bytes;
}

async function loadPostCleanupV2Ruleset({
  repoSlug,
  rulesetId,
  rulesetName,
  defaultBranch,
  context,
  integrationId,
}) {
  const fullRuleset = assertCompleteRulesetApiObject(
    await ghJson(`repos/${repoSlug}/rulesets/${rulesetId}`),
  );
  if (
    fullRuleset.id !== rulesetId ||
    fullRuleset.name !== rulesetName ||
    fullRuleset.source_type !== "Repository" ||
    fullRuleset.source !== repoSlug ||
    fullRuleset.enforcement !== "active" ||
    !rulesetCoversDefaultBranch(fullRuleset, defaultBranch) ||
    !rulesetHasGatePolicy(fullRuleset, context, { integrationId }) ||
    rulesetHasRequiredStatusContext(fullRuleset, LEGACY_STATUS_CONTEXT, {
      integrationId: undefined,
    })
  ) {
    throw new Error(
      `Post-cleanup verification requires repository ruleset "${rulesetName}" to remain the complete Active v2 policy without ${LEGACY_STATUS_CONTEXT}.`,
    );
  }
  return fullRuleset;
}

function assertSelectedRepositoryRulesetIdentity(
  ruleset,
  { repoSlug, rulesetId, rulesetName },
) {
  const fullRuleset = assertCompleteRulesetApiObject(ruleset);
  if (
    fullRuleset.id !== rulesetId ||
    fullRuleset.name !== rulesetName ||
    fullRuleset.source_type !== "Repository" ||
    fullRuleset.source !== repoSlug ||
    fullRuleset.target !== "branch"
  ) {
    throw new Error(
      `Selected ruleset id ${rulesetId} no longer has the approved repository identity, name, source, and branch target; refusing to plan or write a different ruleset.`,
    );
  }
  return fullRuleset;
}

function postCleanupRulesetFingerprint(ruleset) {
  return JSON.stringify({
    id: ruleset.id,
    source_type: ruleset.source_type,
    source: ruleset.source,
    writable: rulesetWritableFingerprint(ruleset),
  });
}

async function loadCanonicalLegacyInventoryBytes({ repoSlug, defaultBranch }) {
  const repository = await loadLegacyInventoryRepositoryMetadata({
    repoSlug,
    defaultBranch,
  });
  const branchUri = encodeURIComponent(defaultBranch);
  const effectiveRulePages = await ghJson(
    `repos/${repoSlug}/rules/branches/${branchUri}?per_page=100`,
    { paginate: true },
  );
  if (
    !Array.isArray(effectiveRulePages) ||
    effectiveRulePages.some((page) => !Array.isArray(page))
  ) {
    throw new Error(
      "Effective default-branch rules endpoint did not return complete paginated arrays.",
    );
  }
  const legacyRulesetIds = [...new Set(
    effectiveRulePages
      .flat()
      .filter(
        (rule) =>
          rule?.type === "required_status_checks" &&
          Array.isArray(rule?.parameters?.required_status_checks) &&
          rule.parameters.required_status_checks.some(
            (check) => check?.context === LEGACY_STATUS_CONTEXT,
          ),
      )
      .map((rule) => rule.ruleset_id),
  )].sort((left, right) => Number(left) - Number(right));
  const rulesets = await Promise.all(
    legacyRulesetIds.map((id) => ghJson(`repos/${repoSlug}/rulesets/${id}`)),
  );
  const classicResponse = await ghJson(
    `repos/${repoSlug}/branches/${branchUri}/protection/required_status_checks`,
    { allowNotFound: true },
  );
  if (classicResponse === null) {
    throw new Error(
      "Classic required-status endpoint returned HTTP 200 with null JSON; only a verified 404 can prove that surface absent.",
    );
  }
  const classicRequiredStatusChecks = classicResponse === GH_NOT_FOUND
    ? null
    : classicResponse;
  const finalRepository = await loadLegacyInventoryRepositoryMetadata({
    repoSlug,
    defaultBranch,
  });
  if (
    finalRepository.id !== repository.id ||
    finalRepository.node_id !== repository.node_id
  ) {
    throw new Error(
      "Repository identity changed during the legacy inventory readback.",
    );
  }
  const finalBranch = await ghJson(`repos/${repoSlug}/branches/${branchUri}`);
  if (finalBranch?.name !== defaultBranch) {
    throw new Error(
      "The approved default branch was not readable after the legacy inventory readback.",
    );
  }
  return canonicalLegacyReviewGateInventoryBytes({
    repository: repoSlug,
    repositoryId: repository.id,
    repositoryNodeId: repository.node_id,
    defaultBranch,
    effectiveRulePages,
    rulesets,
    classicRequiredStatusChecks,
  });
}

async function loadLegacyInventoryRepositoryMetadata({ repoSlug, defaultBranch }) {
  const repository = await ghJson(`repos/${repoSlug}`);
  if (
    repository?.full_name !== repoSlug ||
    !Number.isSafeInteger(repository?.id) ||
    repository.id <= 0 ||
    typeof repository?.node_id !== "string" ||
    repository.node_id === "" ||
    repository.default_branch !== defaultBranch
  ) {
    throw new Error(
      "Repository metadata no longer proves the approved object identity and default branch.",
    );
  }
  return repository;
}

function assertCodeownersActivationDoesNotExpandPolicy({
  securitySnapshot,
  rulesets,
  defaultBranch,
}) {
  if (!securitySnapshot.hasEffectiveUnmanagedCodeownersPatterns) {
    return;
  }
  const alreadyRequired =
    securitySnapshot.classicCodeOwnerReviewRequired === true ||
    rulesets.some(
      (ruleset) =>
        ruleset?.enforcement === "active" &&
        Array.isArray(ruleset.bypass_actors) &&
        ruleset.bypass_actors.length === 0 &&
        rulesetCoversDefaultBranch(ruleset, defaultBranch) &&
        (ruleset.rules ?? []).some(
          (rule) =>
            rule?.type === "pull_request" &&
            rule?.parameters?.require_code_owner_review === true,
        ),
    );
  if (!alreadyRequired) {
    throw new Error(
      "Activation would newly require Code Owner approval for existing non-managed CODEOWNERS patterns. The installer will not silently broaden approval policy: explicitly accept and stage that policy expansion, split or remove the unrelated patterns, or enable an equivalent reviewed Code Owner rule before retrying --activate.",
    );
  }
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

async function loadCanonicalWorkflows() {
  const [verifier, controller] = await Promise.all([
    readFile(CANONICAL_VERIFIER_WORKFLOW_SOURCE, "utf8"),
    readFile(CANONICAL_CONTROLLER_WORKFLOW_SOURCE, "utf8"),
  ]);
  return {
    verifier: validateCanonicalV2VerifierWorkflowContent(verifier),
    controller: validateCanonicalV2ControllerWorkflowContent(controller),
  };
}

async function prepareConsumerWorktree({
  targetRoot,
  canonicalWorkflows,
  controlPlaneOwner,
  apply,
}) {
  const rootWitness = await assertLocalGitWorktree(targetRoot);
  const parentWitnesses = await prepareVerifiedWorkflowParents({
    targetRoot,
    rootWitness,
    create: apply,
  });
  const verifierWorkflowPath = join(
    targetRoot,
    ...DEFAULT_WORKFLOW_PATH.split("/"),
  );
  const controllerWorkflowPath = join(
    targetRoot,
    ...DEFAULT_CONTROLLER_WORKFLOW_PATH.split("/"),
  );
  const codeownersPath = join(targetRoot, ...DEFAULT_CODEOWNERS_PATH.split("/"));
  const currentVerifierWorkflow = await readOptionalRegularFile(
    verifierWorkflowPath,
  );
  const currentControllerWorkflow = await readOptionalRegularFile(
    controllerWorkflowPath,
  );
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
  const otherWorkflowConflicts = await findOtherGateCallerWorkflowPaths({
    targetRoot,
    canonicalWorkflowPaths: [verifierWorkflowPath, controllerWorkflowPath],
  });
  if (otherWorkflowConflicts.length > 0) {
    throw new Error(
      `Additional workflows have a v1/v2 gate caller, reserved CheckRun name, or relevant write authority and require explicit removal or review in the same installation PR: ${otherWorkflowConflicts.join(", ")}`,
    );
  }
  await revalidateDirectoryChain(parentWitnesses, "after local workflow inspection");

  const verifierChanged =
    currentVerifierWorkflow !== canonicalWorkflows.verifier;
  const controllerChanged =
    currentControllerWorkflow !== canonicalWorkflows.controller;
  console.log(`Target worktree: ${targetRoot}`);
  console.log(`Verifier: ${DEFAULT_WORKFLOW_PATH}`);
  console.log(`Controller: ${DEFAULT_CONTROLLER_WORKFLOW_PATH}`);
  console.log(`Control plane: ${DEFAULT_CODEOWNERS_PATH} -> ${controlPlaneOwner}`);
  if (!verifierChanged) {
    console.log("No change: local verifier already matches the canonical v2 bytes.");
  }
  if (!controllerChanged) {
    console.log("No change: local controller already matches the canonical v2 bytes.");
  }
  if (!preparedCodeowners.changed) {
    console.log("No change: local CODEOWNERS already has canonical final control-plane ownership.");
  }
  if (!verifierChanged && !controllerChanged && !preparedCodeowners.changed) {
    return;
  }

  const verifierAction = currentVerifierWorkflow === null
    ? "install the canonical v2 verifier workflow"
    : workflowContainsLegacyV1Caller(currentVerifierWorkflow)
      ? "replace the canonical-path v1 caller with the v2 verifier"
      : "replace the drifted verifier workflow with canonical v2 bytes";
  const controllerAction = currentControllerWorkflow === null
    ? "install the canonical v2 controller workflow"
    : "replace the drifted controller workflow with canonical v2 bytes";
  if (!apply) {
    if (verifierChanged) {
      console.log(`Dry run: would ${verifierAction}.`);
    }
    if (controllerChanged) {
      console.log(`Dry run: would ${controllerAction}.`);
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
  if (verifierChanged) {
    await installPreparedConsumerFile({
      path: verifierWorkflowPath,
      content: canonicalWorkflows.verifier,
      expectedContent: currentVerifierWorkflow,
      parentWitnesses,
      label: "verifier-workflow",
    });
  }
  if (controllerChanged) {
    await installPreparedConsumerFile({
      path: controllerWorkflowPath,
      content: canonicalWorkflows.controller,
      expectedContent: currentControllerWorkflow,
      parentWitnesses,
      label: "controller-workflow",
    });
  }

  const installedVerifier = await readOptionalRegularFile(verifierWorkflowPath);
  const installedController = await readOptionalRegularFile(
    controllerWorkflowPath,
  );
  if (
    !installedWorkflowMatchesCanonical(
      installedVerifier,
      canonicalWorkflows.verifier,
    ) ||
    !installedWorkflowMatchesCanonical(
      installedController,
      canonicalWorkflows.controller,
    )
  ) {
    throw new Error(
      "Local verifier/controller workflows failed exact-byte post-install verification.",
    );
  }
  const installedCodeowners = await readOptionalRegularFile(codeownersPath);
  validateControlPlaneCodeownersContent(installedCodeowners, controlPlaneOwner);
  if (installedCodeowners !== preparedCodeowners.content) {
    throw new Error("Local CODEOWNERS failed exact-byte post-install verification.");
  }
  await revalidateDirectoryChain(parentWitnesses, "after exact-byte verification");
  if (verifierChanged) {
    console.log(`Applied: ${verifierAction}.`);
  }
  if (controllerChanged) {
    console.log(`Applied: ${controllerAction}.`);
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

async function findOtherGateCallerWorkflowPaths({
  targetRoot,
  canonicalWorkflowPaths,
}) {
  const workflowsDirectory = join(targetRoot, ".github", "workflows");
  const canonicalPaths = new Set(canonicalWorkflowPaths);
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
    if (canonicalPaths.has(absolutePath)) {
      continue;
    }
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`Cannot safely inspect non-regular workflow: ${absolutePath}`);
    }
    const content = await readFile(absolutePath, "utf8");
    const violations = [];
    if (workflowContainsCodexReviewGateCaller(content)) {
      violations.push("gate caller");
    }
    violations.push(...workflowSingleProducerPolicyViolations(content));
    if (violations.length > 0) {
      callerPaths.push(
        `${absolutePath.slice(targetRoot.length + 1)} (${violations.join(", ")})`,
      );
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

function ghJson(
  endpoint,
  {
    method = "GET",
    body = undefined,
    paginate = false,
    allowNotFound = false,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const args = ["api", "--hostname", "github.com", endpoint];
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
        if (
          allowNotFound &&
          [
            "gh: Branch not protected (HTTP 404)",
            "gh: Required status checks not enabled (HTTP 404)",
          ].includes(stderr.trim())
        ) {
          resolve(GH_NOT_FOUND);
          return;
        }
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
