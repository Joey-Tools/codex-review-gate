#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as fileSystemConstants } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_CODEOWNERS_PATH,
  DEFAULT_CONTROLLER_WORKFLOW_PATH,
  DEFAULT_CONTROL_PLANE_OWNER,
  DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH,
  DEFAULT_RULESET_ENFORCEMENT,
  DEFAULT_RULESET_NAME,
  DEFAULT_RULESET_PROFILE,
  RULESET_PROFILE_STATUS_ONLY,
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
  findEffectiveRulesetWithProfilePolicy,
  installedWorkflowMatchesCanonical,
  normalizeControlPlaneOwner,
  normalizeRulesetProfile,
  normalizeWorkflowPath,
  parseGitHubRepositoryRemote,
  parseRepoSlug,
  rulesetCoversDefaultBranch,
  rulesetHasPolicyForProfile,
  rulesetHasRequiredStatusContext,
  rulesetHasStatusOnlyProfile,
  rulesetWritableFingerprint,
  validateCanonicalV2ControllerWorkflowContent,
  validateCanonicalLegacyBridgeWorkflowContent,
  validateCanonicalV2VerifierWorkflowContent,
  validateCanonicalV2WorkflowInventory,
  validateControlPlaneCodeownersContent,
  validateOrganizationBridgeRemovalProofOutput,
  workflowContainsCodexReviewGateCaller,
  workflowContainsLegacyV1Caller,
  workflowSingleProducerPolicyViolations,
} from "../src/bootstrap.mjs";

const BOOTSTRAP_SCRIPT_PATH = fileURLToPath(import.meta.url);
const SOURCE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const CANONICAL_VERIFIER_WORKFLOW_SOURCE = join(
  SOURCE_ROOT,
  "templates/codex-gated-repo/.github/workflows/codex-review-gate.yml",
);
const CANONICAL_CONTROLLER_WORKFLOW_SOURCE = join(
  SOURCE_ROOT,
  "templates/codex-gated-repo/.github/workflows/codex-review-gate-controller.yml",
);
const CANONICAL_LEGACY_BRIDGE_WORKFLOW_SOURCE = join(
  SOURCE_ROOT,
  "templates/codex-gated-repo/.github/workflows/codex-review-gate-legacy-bridge.yml",
);
const GH_NOT_FOUND = Symbol("GitHub API not found");
const GITHUB_PULL_REQUEST_FILES_LIMIT = 3_000;
const GITHUB_PULL_REQUEST_FILES_PAGE_SIZE = 100;
const MAX_APPROVED_POST_CLEANUP_PLAN_BYTES = 1_048_576;
const POST_CLEANUP_WRITE_RECOVERY_TAG = Symbol(
  "post-cleanup-write-recovery-guidance",
);
const SOURCE_SELF_HOSTING_REPOSITORY_SLUG = "Joey-Tools/codex-review-gate";

async function main() {
  const options = readCliOptions();
  const canonicalWorkflows = await loadCanonicalWorkflows({
    includeLegacyBridge: options.legacyBridge || options.removeLegacyBridge,
  });

  if (options.prepareWorktree !== null) {
    await prepareConsumerWorktree({
      targetRoot: options.prepareWorktree,
      canonicalWorkflows,
      controlPlaneOwner: options.controlPlaneOwner,
      legacyBridge: options.legacyBridge,
      removeLegacyBridge: options.removeLegacyBridge,
      finalClosureReceiptPath: options.finalClosureReceiptPath,
      expectedFinalClosureReceiptSha256:
        options.expectedFinalClosureReceiptSha256,
      apply: options.apply,
    });
    return;
  }

  if (options.derivePostCleanupPlan) {
    await printDerivedPostCleanupPlan({
      options,
      canonicalWorkflows,
    });
    return;
  }

  if (options.applyPostCleanupPlanPath !== null) {
    await applyApprovedPostCleanupPlan({
      options,
      canonicalWorkflows,
    });
    return;
  }

  if (options.verifyPostCleanup) {
    await verifyExpectedPostCleanupState({
      options,
      canonicalWorkflows,
    });
    return;
  }

  const initialSecuritySnapshot = await loadConsumerSecuritySnapshot({
    repoSlug: options.repo.slug,
    canonicalWorkflows,
    controlPlaneOwner: options.controlPlaneOwner,
  });
  const { defaultBranch } = initialSecuritySnapshot;
  await assertExpectedLegacyInventoryDigest({
    repoSlug: options.repo.slug,
    defaultBranch,
    expectedDigest: options.expectedLegacyInventorySha256,
    phase: "initial approval-snapshot readback",
  });

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
  console.log(`Ruleset profile: ${options.rulesetProfile}`);
  console.log(`Verifier: ${DEFAULT_WORKFLOW_PATH} exactly matches the canonical v2 verifier`);
  console.log(`Controller: ${DEFAULT_CONTROLLER_WORKFLOW_PATH} exactly matches the canonical v2 controller`);
  if (options.legacyBridge) {
    console.log(
      `Temporary legacy bridge: ${DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH} exactly matches the closed canonical v1 producer envelope.`,
    );
  }
  console.log(`Control plane: ${DEFAULT_CODEOWNERS_PATH} protects the workflow and itself for ${options.controlPlaneOwner}`);
  if (initialSecuritySnapshot.classicLegacyStatusRequired) {
    console.log(
      `Fail-closed migration overlap: classic branch protection continues to require ${LEGACY_STATUS_CONTEXT} until the separate v2 ruleset is active and read back.`,
    );
  }

  const repoRuleset = selectUniqueNamedRepositoryRuleset(
    effectiveRulesets,
    options.rulesetName,
  );

  if (
    repoRuleset !== undefined &&
    repoRuleset.target !== undefined &&
    repoRuleset.target !== "branch"
  ) {
    throw new Error(
      `Repository ruleset "${options.rulesetName}" already targets ${repoRuleset.target}; refusing to rewrite it as a branch ruleset. Use a different --ruleset-name or rename the existing ruleset.`,
    );
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
    !rulesetMatchesProfileAtDefaultBranch({
      ruleset: repoRuleset,
      rulesetProfile: options.rulesetProfile,
      defaultBranch,
      context: options.context,
      integrationId: options.integrationId,
    })
  ) {
    throw new Error(
      `Repository ruleset "${options.rulesetName}" is an active legacy or incomplete gate; refusing to disable or replace it during v2 staging. Keep it active and rerun with a distinct --ruleset-name for the disabled v2 ruleset.`,
    );
  }

  const existingEffective = findEffectiveRulesetWithProfilePolicy(
    effectiveRulesets,
    options.rulesetProfile,
    options.context,
    { defaultBranch, integrationId: options.integrationId },
  );
  if (repoRuleset === undefined && existingEffective !== undefined) {
    console.log(
      `No change: the ${rulesetProfileDescription(options.rulesetProfile)} is already enforced by ${rulesetLabel(existingEffective)}.`,
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
      profile: options.rulesetProfile,
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
        repoId: currentSecuritySnapshot.repoId,
        defaultBranch,
        defaultBranchHeadSha: currentSecuritySnapshot.defaultBranchHeadSha,
        prNumber: options.canaryPr,
        headSha: options.canaryHead,
      });
    }
    const preCreateSummaries = await loadRulesetSummaries(options.repo.slug);
    if (
      selectUniqueNamedRepositoryRuleset(
        preCreateSummaries,
        options.rulesetName,
      ) !== undefined
    ) {
      throw new Error(
        `Repository ruleset "${options.rulesetName}" appeared during final create preflight; refusing to create a duplicate.`,
      );
    }
    const preCreateIds = new Set(preCreateSummaries.map((ruleset) => ruleset.id));
    const finalCreatedRuleset = await withPostWriteRecoveryGuidance(
      {
        enforcement: payload.enforcement,
      },
      async () => {
        const created = await ghJson(`repos/${options.repo.slug}/rulesets`, {
          method: "POST",
          body: payload,
        });
        if (
          !Number.isSafeInteger(created?.id) ||
          created.id <= 0 ||
          preCreateIds.has(created.id)
        ) {
          throw new Error(
            "Ruleset create response did not return a fresh positive integer id absent from the final pre-create inventory.",
          );
        }
        await assertRulesetReadback({
          repoSlug: options.repo.slug,
          rulesetId: created.id,
          defaultBranch,
          context: options.context,
          integrationId: options.integrationId,
          rulesetProfile: options.rulesetProfile,
          enforcement: payload.enforcement,
          expectedPayload: payload,
          exactWritableFields: false,
          logSuccess: false,
          inconclusiveWriteEnforcement: payload.enforcement,
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
          {
            phase: "ruleset post-write readback",
            attemptedEnforcement: payload.enforcement,
          },
        );
        await assertExpectedLegacyInventoryDigest({
          repoSlug: options.repo.slug,
          defaultBranch,
          expectedDigest: options.expectedLegacyInventorySha256,
          phase: "ruleset post-write readback",
          attemptedEnforcement: payload.enforcement,
        });
        const authoritativeCreatedRuleset = await assertRulesetReadback({
          repoSlug: options.repo.slug,
          rulesetId: created.id,
          defaultBranch,
          context: options.context,
          integrationId: options.integrationId,
          rulesetProfile: options.rulesetProfile,
          enforcement: payload.enforcement,
          expectedPayload: payload,
          exactWritableFields: false,
          inconclusiveWriteEnforcement: payload.enforcement,
        });
        const finalSummaries = await loadRulesetSummaries(options.repo.slug);
        const finalNamedRuleset = selectUniqueNamedRepositoryRuleset(
          finalSummaries,
          options.rulesetName,
        );
        if (finalNamedRuleset?.id !== created.id) {
          throw new Error(
            `Final ruleset inventory does not uniquely bind repository ruleset "${options.rulesetName}" to created id ${created.id}.`,
          );
        }
        return authoritativeCreatedRuleset;
      },
    );
    console.log(`Created ruleset: ${rulesetLabel(finalCreatedRuleset)}`);
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
    rulesetMatchesProfileAtDefaultBranch({
      ruleset: fullRuleset,
      rulesetProfile: options.rulesetProfile,
      defaultBranch,
      context: options.context,
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
      `No change: the ${rulesetProfileDescription(options.rulesetProfile)} is already enforced by ${rulesetLabel(fullRuleset)}.`,
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
    profile: options.rulesetProfile,
  });
  if (options.activate) {
    const expectedActivationPayload = {
      ...fullRuleset,
      enforcement: "active",
    };
    if (
      !rulesetMatchesProfileAtDefaultBranch({
        ruleset: fullRuleset,
        rulesetProfile: options.rulesetProfile,
        defaultBranch,
        context: options.context,
        integrationId: options.integrationId,
      }) ||
      rulesetHasRequiredStatusContext(fullRuleset, LEGACY_STATUS_CONTEXT, {
        integrationId: undefined,
      }) ||
      rulesetWritableFingerprint(payload, {
        profile: options.rulesetProfile,
      }) !==
        rulesetWritableFingerprint(expectedActivationPayload, {
          profile: options.rulesetProfile,
        })
    ) {
      throw new Error(
        `Repository ruleset "${options.rulesetName}" is disabled but not an exact staged ${rulesetProfileDescription(options.rulesetProfile)}. Run a plain --apply to repair and read back the disabled stage; --activate may change only enforcement from disabled to active.`,
      );
    }
    await assertCanaryCheckRunSource({
      repoSlug: options.repo.slug,
      repoId: initialSecuritySnapshot.repoId,
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
      repoId: currentSecuritySnapshot.repoId,
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
    rulesetWritableFingerprint(currentFullRuleset, {
      profile: options.rulesetProfile,
    }) !==
    rulesetWritableFingerprint(fullRuleset, {
      profile: options.rulesetProfile,
    })
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
      repoId: currentSecuritySnapshot.repoId,
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
    await assertExpectedLegacyInventoryDigest({
      repoSlug: options.repo.slug,
      defaultBranch,
      expectedDigest: options.expectedLegacyInventorySha256,
      phase: "activation final write-boundary readback",
    });
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
    rulesetWritableFingerprint(finalFullRuleset, {
      profile: options.rulesetProfile,
    }) !==
    rulesetWritableFingerprint(fullRuleset, {
      profile: options.rulesetProfile,
    })
  ) {
    throw new Error(
      `Ruleset ${fullRuleset.id} changed during the final legacy-inventory readback; refusing a lost-update overwrite. Re-run bootstrap against the latest ruleset.`,
    );
  }
  // GitHub's ruleset API does not expose an If-Match update contract here.
  // Bracket the final legacy read with full target-ruleset reads, after the
  // complete canary/security closure, then keep this second writable-field
  // reread adjacent to PUT. These are the final best-effort lost-update and
  // zero-gate boundaries without an API transaction or If-Match contract.
  const finalUpdatedRuleset = await withPostWriteRecoveryGuidance(
    {
      enforcement: payload.enforcement,
      rulesetId: fullRuleset.id,
    },
    async () => {
      await ghJson(`repos/${options.repo.slug}/rulesets/${fullRuleset.id}`, {
        method: "PUT",
        body: payload,
      });
      await assertRulesetReadback({
        repoSlug: options.repo.slug,
        rulesetId: fullRuleset.id,
        defaultBranch,
        context: options.context,
        integrationId: options.integrationId,
        rulesetProfile: options.rulesetProfile,
        enforcement: payload.enforcement,
        expectedPayload: payload,
        exactWritableFields: true,
        logSuccess: false,
        inconclusiveWriteEnforcement: payload.enforcement,
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
        {
          phase: "ruleset post-write readback",
          attemptedEnforcement: payload.enforcement,
        },
      );
      await assertExpectedLegacyInventoryDigest({
        repoSlug: options.repo.slug,
        defaultBranch,
        expectedDigest: options.expectedLegacyInventorySha256,
        phase: "ruleset post-write readback",
        attemptedEnforcement: payload.enforcement,
      });
      return assertRulesetReadback({
        repoSlug: options.repo.slug,
        rulesetId: fullRuleset.id,
        defaultBranch,
        context: options.context,
        integrationId: options.integrationId,
        rulesetProfile: options.rulesetProfile,
        enforcement: payload.enforcement,
        expectedPayload: payload,
        exactWritableFields: true,
        inconclusiveWriteEnforcement: payload.enforcement,
      });
    },
  );
  console.log(`Updated ruleset: ${rulesetLabel(finalUpdatedRuleset)}`);
}

function readCliOptions() {
  const { values } = parseArgs({
    options: {
      repo: { type: "string" },
      "prepare-worktree": { type: "string" },
      apply: { type: "boolean", default: false },
      activate: { type: "boolean", default: false },
      "legacy-bridge": { type: "boolean", default: false },
      "remove-legacy-bridge": { type: "boolean", default: false },
      "final-closure-receipt": { type: "string" },
      "expected-final-closure-receipt-sha256": { type: "string" },
      "derive-post-cleanup-plan": { type: "boolean", default: false },
      "apply-post-cleanup-plan": { type: "string" },
      "expected-post-cleanup-plan-sha256": { type: "string" },
      "verify-post-cleanup": { type: "boolean", default: false },
      "expected-legacy-inventory-sha256": { type: "string" },
      "expected-post-cleanup-security-sha256": { type: "string" },
      "ruleset-name": { type: "string", default: DEFAULT_RULESET_NAME },
      "ruleset-profile": { type: "string", default: DEFAULT_RULESET_PROFILE },
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
  const hasApplyPostCleanupPlan =
    values["apply-post-cleanup-plan"] !== undefined;
  const repo = hasRepo ? parseRepoSlug(values.repo) : null;
  const rulesetProfile = normalizeRulesetProfile(values["ruleset-profile"]);
  if (hasRepo === hasPrepareWorktree) {
    printUsage();
    throw new Error("Choose exactly one mode: --prepare-worktree PATH or --repo OWNER/REPO.");
  }
  if (hasPrepareWorktree && values.activate) {
    throw new Error("--activate is only valid with --repo after the canary passes.");
  }
  if (hasPrepareWorktree && rulesetProfile !== DEFAULT_RULESET_PROFILE) {
    throw new Error(
      `--ruleset-profile ${rulesetProfile} is remote-only; --prepare-worktree always installs the canonical full consumer control plane.`,
    );
  }
  if (
    rulesetProfile !== DEFAULT_RULESET_PROFILE &&
    repo?.slug !== SOURCE_SELF_HOSTING_REPOSITORY_SLUG
  ) {
    throw new Error(
      `--ruleset-profile ${rulesetProfile} is reserved for the ${SOURCE_SELF_HOSTING_REPOSITORY_SLUG} source self-hosting migration. Ordinary consumers must use ${DEFAULT_RULESET_PROFILE}.`,
    );
  }
  if (
    rulesetProfile === RULESET_PROFILE_STATUS_ONLY &&
    !values["legacy-bridge"]
  ) {
    throw new Error(
      `--ruleset-profile ${RULESET_PROFILE_STATUS_ONLY} requires --legacy-bridge while ${LEGACY_STATUS_CONTEXT} remains a source-local required status. A later source-local bridge removal needs separate closure proof; do not stage or activate without the exact temporary bridge.`,
    );
  }
  if (values["legacy-bridge"] && values["remove-legacy-bridge"]) {
    throw new Error(
      "--legacy-bridge and --remove-legacy-bridge are mutually exclusive lifecycle phases.",
    );
  }
  if (hasRepo && values["remove-legacy-bridge"]) {
    throw new Error(
      "--remove-legacy-bridge is local-only and requires --prepare-worktree after legacy requirements have been removed and verified.",
    );
  }
  if (
    values["remove-legacy-bridge"] &&
    (values["final-closure-receipt"] === undefined ||
      values["expected-final-closure-receipt-sha256"] === undefined)
  ) {
    throw new Error(
      "--remove-legacy-bridge requires --final-closure-receipt and --expected-final-closure-receipt-sha256 from an admitted bridge-removal proof. Allowed schema pairs are organization-review-gate-handoff-output/v2 + final_closure_receipt schema_version 2, and organization-review-gate-post-cutover-audit-output/v1 + organization-review-gate-post-cutover-audit-receipt/v1.",
    );
  }
  if (
    !values["remove-legacy-bridge"] &&
    (values["final-closure-receipt"] !== undefined ||
      values["expected-final-closure-receipt-sha256"] !== undefined)
  ) {
    throw new Error(
      "--final-closure-receipt and --expected-final-closure-receipt-sha256 are valid only with --remove-legacy-bridge.",
    );
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
  if (hasPrepareWorktree && values["derive-post-cleanup-plan"]) {
    throw new Error("--derive-post-cleanup-plan is valid only with --repo.");
  }
  if (hasPrepareWorktree && hasApplyPostCleanupPlan) {
    throw new Error("--apply-post-cleanup-plan is valid only with --repo.");
  }
  if (values["derive-post-cleanup-plan"] && values["verify-post-cleanup"]) {
    throw new Error(
      "--derive-post-cleanup-plan and --verify-post-cleanup are separate read-only phases.",
    );
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
  if (
    values["derive-post-cleanup-plan"] &&
    (values.apply ||
      values.activate ||
      values["canary-pr"] !== undefined ||
      values["canary-head"] !== undefined)
  ) {
    throw new Error(
      "--derive-post-cleanup-plan is read-only and cannot be combined with --apply, --activate, or canary inputs.",
    );
  }
  if (
    hasApplyPostCleanupPlan &&
    (values["derive-post-cleanup-plan"] ||
      values["verify-post-cleanup"] ||
      values.activate ||
      values["canary-pr"] !== undefined ||
      values["canary-head"] !== undefined ||
      values["remove-legacy-bridge"])
  ) {
    throw new Error(
      "--apply-post-cleanup-plan is a separate source-local cleanup phase and cannot be combined with derive, verify, activation, canary, or bridge-removal inputs.",
    );
  }
  if (
    hasApplyPostCleanupPlan &&
    (repo?.slug !== SOURCE_SELF_HOSTING_REPOSITORY_SLUG ||
      rulesetProfile !== RULESET_PROFILE_STATUS_ONLY ||
      !values["legacy-bridge"])
  ) {
    throw new Error(
      `--apply-post-cleanup-plan is restricted to ${SOURCE_SELF_HOSTING_REPOSITORY_SLUG} with --ruleset-profile ${RULESET_PROFILE_STATUS_ONLY} and --legacy-bridge.`,
    );
  }
  if (
    hasApplyPostCleanupPlan &&
    values["expected-post-cleanup-plan-sha256"] === undefined
  ) {
    throw new Error(
      "--apply-post-cleanup-plan requires --expected-post-cleanup-plan-sha256 for the exact raw plan bytes approved for this cleanup.",
    );
  }
  if (
    !hasApplyPostCleanupPlan &&
    values["expected-post-cleanup-plan-sha256"] !== undefined
  ) {
    throw new Error(
      "--expected-post-cleanup-plan-sha256 is valid only with --apply-post-cleanup-plan.",
    );
  }
  if (
    values["verify-post-cleanup"] &&
    values["expected-post-cleanup-security-sha256"] === undefined
  ) {
    throw new Error(
      "--verify-post-cleanup requires --expected-post-cleanup-security-sha256 from the pre-cleanup derived plan.",
    );
  }
  if (
    !values["verify-post-cleanup"] &&
    values["expected-post-cleanup-security-sha256"] !== undefined
  ) {
    throw new Error(
      "--expected-post-cleanup-security-sha256 is valid only with --verify-post-cleanup.",
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
    repo,
    prepareWorktree: hasPrepareWorktree ? resolve(values["prepare-worktree"]) : null,
    apply: values.apply,
    activate: values.activate,
    legacyBridge: values["legacy-bridge"],
    removeLegacyBridge: values["remove-legacy-bridge"],
    finalClosureReceiptPath: values["remove-legacy-bridge"]
      ? resolve(values["final-closure-receipt"])
      : null,
    expectedFinalClosureReceiptSha256: values["remove-legacy-bridge"]
      ? parseExpectedSecuritySha256(
          values["expected-final-closure-receipt-sha256"],
          "--expected-final-closure-receipt-sha256",
        )
      : null,
    derivePostCleanupPlan: values["derive-post-cleanup-plan"],
    applyPostCleanupPlanPath: hasApplyPostCleanupPlan
      ? resolve(values["apply-post-cleanup-plan"])
      : null,
    expectedPostCleanupPlanSha256: hasApplyPostCleanupPlan
      ? parseExpectedSecuritySha256(
          values["expected-post-cleanup-plan-sha256"],
          "--expected-post-cleanup-plan-sha256",
        )
      : null,
    verifyPostCleanup: values["verify-post-cleanup"],
    rulesetName: values["ruleset-name"],
    rulesetProfile,
    controlPlaneOwner: normalizeControlPlaneOwner(values["control-plane-owner"]),
    context: values.context,
    integrationId: DEFAULT_STATUS_INTEGRATION_ID,
    expectedLegacyInventorySha256: hasRepo && !values["verify-post-cleanup"]
      ? parseExpectedLegacyInventorySha256(
          values["expected-legacy-inventory-sha256"],
        )
      : null,
    expectedPostCleanupSecuritySha256: values["verify-post-cleanup"]
      ? parseExpectedSecuritySha256(
          values["expected-post-cleanup-security-sha256"],
          "--expected-post-cleanup-security-sha256",
        )
      : null,
    canaryPr: values.activate ? parseCanaryPr(values["canary-pr"]) : null,
    canaryHead: values.activate ? parseCanaryHead(values["canary-head"]) : null,
  };
}

function printUsage() {
  console.log(`Usage:
  node scripts/bootstrap-codex-review-gate.mjs --prepare-worktree PATH [--legacy-bridge | --remove-legacy-bridge --final-closure-receipt PATH --expected-final-closure-receipt-sha256 SHA256] [--control-plane-owner @USER] [--apply]
  node scripts/bootstrap-codex-review-gate.mjs --repo OWNER/REPO --expected-legacy-inventory-sha256 SHA256 [--ruleset-profile full] [--legacy-bridge] [--control-plane-owner @USER] [--apply]
  node scripts/bootstrap-codex-review-gate.mjs --repo OWNER/REPO --expected-legacy-inventory-sha256 SHA256 --activate --canary-pr NUMBER --canary-head SHA [--ruleset-profile full] [--legacy-bridge] [--control-plane-owner @USER] [--apply]
  node scripts/bootstrap-codex-review-gate.mjs --repo OWNER/REPO --expected-legacy-inventory-sha256 SHA256 --derive-post-cleanup-plan [--ruleset-profile full] [--legacy-bridge] [--control-plane-owner @USER]
  node scripts/bootstrap-codex-review-gate.mjs --repo OWNER/REPO --verify-post-cleanup --expected-post-cleanup-security-sha256 SHA256 [--ruleset-profile full] [--legacy-bridge] [--control-plane-owner @USER]

Options:
  --prepare-worktree PATH Prepare a local consumer checkout for one installation PR.
  --repo OWNER/REPO       Inspect or stage the merged repository ruleset.
  --apply                 Apply the local copy or ruleset change. Defaults to dry-run.
  --legacy-bridge         Explicitly require/install the exact temporary v1 producer at ${DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH}. Keep this flag through legacy cleanup verification.
  --remove-legacy-bridge  Local-only post-cutover removal of an exact canonical bridge. Requires a repository-bound admitted bridge-removal proof.
  --final-closure-receipt
                          JSON admitted bridge-removal proof. Allowed pairs: handoff output/v2 + final_closure_receipt schema_version 2, or post-cutover audit output/v1 + post-cutover audit receipt/v1.
  --expected-final-closure-receipt-sha256
                          Exact canonical receipt SHA-256 copied from the admitted bridge-removal proof.
  --expected-legacy-inventory-sha256
                          Exact lowercase SHA-256 from the external owner approval snapshot. Required for every remote staging/activation preview and apply.
  --derive-post-cleanup-plan
                          Read-only pre-cleanup derivation of the only authorized legacy-elision post-state.
  --verify-post-cleanup   Read-only two-round proof against the pre-cleanup derived post-state.
  --expected-post-cleanup-security-sha256
                          Exact lowercase SHA-256 emitted by --derive-post-cleanup-plan.
  --activate              Activate only after verifying the named temporary-PR canary.
  --canary-pr NUMBER      Open canary PR to verify before activation.
  --canary-head SHA       Exact lowercase 40-hex canary head to verify before activation.
  --ruleset-name NAME     Repo ruleset to create or update. Defaults to "${DEFAULT_RULESET_NAME}".
  --ruleset-profile PROFILE
                          Ruleset policy profile. Defaults to "${DEFAULT_RULESET_PROFILE}". "status-only" is reserved for ${SOURCE_SELF_HOSTING_REPOSITORY_SLUG}'s source self-hosting migration and cannot be used for a local install or another repository.
  --control-plane-owner   GitHub user owning workflow and CODEOWNERS changes. Defaults to "${DEFAULT_CONTROL_PLANE_OWNER}".
  --context CONTEXT       Required CheckRun name. Must remain "${DEFAULT_STATUS_CONTEXT}".
  --workflow PATH         Verifier path; fixed to "${DEFAULT_WORKFLOW_PATH}" while both workflows are verified.
  -h, --help              Show this help.

The source-self-hosting cleanup executor is intentionally omitted from this
general help because it is not a consumer-installation capability. Its exact,
separately authorized invocation is documented only in the source exception in
docs/install.
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

function parseExpectedSecuritySha256(value, optionName) {
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(
      `${optionName} must be an exact lowercase 64-hex SHA-256: ${value}`,
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
  repoId,
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
    run?.repository?.id !== repoId ||
    run?.head_repository?.full_name !== repoSlug ||
    run?.head_repository?.id !== repoId ||
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
      repoId,
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
  {
    repoId,
    prNumber,
    headSha,
    defaultBranch,
    defaultBranchHeadSha,
  },
) {
  if (!Array.isArray(run?.pull_requests) || run.pull_requests.length !== 1) {
    return false;
  }
  const pullRequest = run.pull_requests[0];
  return (
    Number(pullRequest?.number) === prNumber &&
    pullRequest?.head?.sha === headSha &&
    pullRequest?.head?.repo?.id === repoId &&
    pullRequest?.base?.ref === defaultBranch &&
    pullRequest?.base?.sha === defaultBranchHeadSha &&
    pullRequest?.base?.repo?.id === repoId
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
  rulesetProfile,
  enforcement,
  expectedPayload,
  exactWritableFields,
  logSuccess = true,
  inconclusiveWriteEnforcement = null,
}) {
  if (!Number.isSafeInteger(rulesetId) || rulesetId <= 0) {
    throw new Error(
      "Ruleset write did not return a positive integer id for independent readback.",
    );
  }

  let ruleset;
  try {
    ruleset = assertCompleteRulesetApiObject(
      await ghJson(`repos/${repoSlug}/rulesets/${rulesetId}`),
    );
  } catch (error) {
    if (inconclusiveWriteEnforcement === null) {
      throw error;
    }
    throw new Error(
      `${error.message} ${postWriteRecoveryGuidance(inconclusiveWriteEnforcement, rulesetId)}`,
    );
  }
  if (
    ruleset.id !== rulesetId ||
    ruleset.source_type !== "Repository" ||
    ruleset.source !== repoSlug ||
    ruleset?.target !== "branch" ||
    ruleset?.enforcement !== enforcement ||
    !rulesetMatchesProfileAtDefaultBranch({
      ruleset,
      rulesetProfile,
      defaultBranch,
      context,
      integrationId,
    }) ||
    (exactWritableFields
      ? rulesetWritableFingerprint(ruleset, { profile: rulesetProfile }) !==
        rulesetWritableFingerprint(expectedPayload, { profile: rulesetProfile })
      : !createReadbackMatchesPlannedShape(
        ruleset,
        expectedPayload,
        rulesetProfile,
      ))
  ) {
    throw new Error(
      `Ruleset readback for id ${rulesetId} is incomplete or drifted: expected exact writable fields with ${enforcement} default-branch coverage and ${rulesetProfileReadbackExpectation(rulesetProfile, context, integrationId)}.${inconclusiveWriteEnforcement === null ? "" : ` ${postWriteRecoveryGuidance(inconclusiveWriteEnforcement, rulesetId)}`}`,
    );
  }

  if (logSuccess) {
    console.log(rulesetReadbackSuccessMessage({
      ruleset,
      rulesetProfile,
      enforcement,
    }));
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

function createReadbackMatchesPlannedShape(actual, planned, rulesetProfile) {
  if (normalizeRulesetProfile(rulesetProfile) === RULESET_PROFILE_STATUS_ONLY) {
    return (
      rulesetWritableFingerprint(actual, { profile: rulesetProfile }) ===
      rulesetWritableFingerprint(planned, { profile: rulesetProfile })
    );
  }
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
  if (
    workflowPermissions?.default_workflow_permissions !== "read" ||
    typeof workflowPermissions?.can_approve_pull_request_reviews !== "boolean"
  ) {
    throw new Error(
      `${repoSlug} must expose a complete Actions workflow-permission policy with default permissions set to read before the GitHub Actions source can be uniquely trusted.`,
    );
  }
  const controlPlaneOwnerAccess = await loadControlPlaneOwnerPermission({
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
      { legacyBridge: canonicalWorkflows.legacyBridge !== undefined },
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
      workflowInventory: [...workflowFiles]
        .sort((left, right) => left.path.localeCompare(right.path))
        .map((file) => ({
          path: file.path,
          mode: file.mode,
          content_sha256: fingerprintText(file.content),
        })),
      codeownersFingerprint: fingerprintText(codeownersContent),
      codeownersErrors: canonicalizeSecurityApiValue(codeownersErrors.errors),
      hasEffectiveUnmanagedCodeownersPatterns:
        codeownersHasEffectiveUnmanagedPatterns(codeownersContent),
      actionsWorkflowPermissions:
        canonicalizeSecurityApiValue(workflowPermissions),
      // Keep the complete classic producer-binding representation. contexts[]
      // and checks[] are distinct surfaces, strict is writable policy, and
      // app_id null/-1/positive values have different meanings. Missing or
      // unreadable schema never becomes an empty witness.
      classicRequiredStatusChecksFingerprint: fingerprintText(
        JSON.stringify(classicBranchProtection.requiredStatusChecks),
      ),
      classicRequiredStatusChecks:
        classicBranchProtection.requiredStatusChecks,
      classicLegacyStatusRequired,
      classicCodeOwnerReviewRequired:
        classicBranchProtection.codeOwnerReviewRequired,
      classicBranchProtection: classicBranchProtection.protection,
      controlPlaneOwnerPermission: controlPlaneOwnerAccess.fingerprint,
      controlPlaneOwner: controlPlaneOwnerAccess.projection,
    };
  } catch (error) {
    const workflowRequirement = canonicalWorkflows.legacyBridge === undefined
      ? "remove every v1 caller"
      : `retain only the exact canonical temporary bridge at ${DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH}`;
    throw new Error(
      `${repoSlug}@${defaultBranch} does not have the complete canonical v2 workflow and CODEOWNERS control plane; merge the installation PR, protect the control-plane owner, and ${workflowRequirement} before staging or activating the ruleset.\n${error.message}`,
    );
  }
}

function assertConsumerSecuritySnapshotStable(
  expected,
  current,
  {
    phase = "ruleset pre-write readback",
    attemptedEnforcement = null,
  } = {},
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
        `The ruleset write completed, but repository identity, default branch, canonical workflow inventory, CODEOWNERS, classic legacy-gate overlap, or control-plane owner permission changed during post-write readback. Do not treat staging or activation as complete. ${postWriteRecoveryGuidance(attemptedEnforcement)}`,
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
      protection: null,
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
      protection: canonicalClassicProtectionProjection(response),
    };
  }
  return {
    requiredStatusChecks:
      canonicalClassicRequiredStatusChecks(requiredStatusChecks),
    codeOwnerReviewRequired,
    protection: canonicalClassicProtectionProjection(response),
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

function canonicalClassicProtectionProjection(response) {
  const projection = canonicalizeSecurityApiValue(response);
  projection.required_status_checks = response.required_status_checks === null
    ? null
    : canonicalClassicRequiredStatusChecks(response.required_status_checks);
  return projection;
}

function canonicalizeSecurityApiValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(
        "Security-policy API projection contains a non-safe-integer number.",
      );
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => canonicalizeSecurityApiValue(item))
      .sort((left, right) =>
        canonicalSecurityJson(left).localeCompare(canonicalSecurityJson(right)));
  }
  if (value === undefined || typeof value !== "object") {
    throw new Error("Security-policy API projection contains an unsupported value.");
  }
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (
      key === "url" ||
      key.endsWith("_url") ||
      ["created_at", "updated_at", "avatar_url", "html_url"].includes(key)
    ) {
      continue;
    }
    result[key] = canonicalizeSecurityApiValue(value[key]);
  }
  return result;
}

function canonicalSecurityJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalSecurityJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalSecurityJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalSecurityBytes(value) {
  return `${canonicalSecurityJson(value)}\n`;
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
  const fingerprint = [
    permission.user.login.toLowerCase(),
    permission.user.type,
    permission.user.id,
    permission.user.node_id,
    permission.permission,
  ].join(":");
  return {
    fingerprint,
    projection: {
      login: permission.user.login.toLowerCase(),
      type: permission.user.type,
      id: permission.user.id,
      node_id: permission.user.node_id,
      permission: permission.permission,
    },
  };
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

function selectUniqueNamedRepositoryRuleset(rulesets, rulesetName) {
  const matches = rulesets.filter(
    (ruleset) =>
      ruleset?.source_type === "Repository" && ruleset?.name === rulesetName,
  );
  if (matches.length > 1) {
    throw new Error(
      `Repository ruleset name "${rulesetName}" is ambiguous; found ${matches
        .map((ruleset) => `id ${ruleset.id} (${ruleset.target ?? "branch"})`)
        .join(", ")}. Rename or remove duplicates before bootstrap.`,
    );
  }
  return matches[0];
}

async function loadRulesetSummaries(repoSlug) {
  const pages = await ghJson(
    `repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`,
    { paginate: true },
  );
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new Error("Repository ruleset listing is not a complete paginated array.");
  }
  const summaries = pages.flat();
  const ids = summaries.map((ruleset) => ruleset?.id);
  if (
    ids.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
    new Set(ids).size !== ids.length
  ) {
    throw new Error("Repository ruleset listing contains malformed or duplicate ids.");
  }
  return summaries;
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
  attemptedEnforcement = null,
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
      `${prefix} the canonical legacy review-gate inventory digest mismatched the external owner approval snapshot during ${phase}: expected ${expectedDigest}, read ${actualDigest}.${phase === "ruleset post-write readback" ? ` ${postWriteRecoveryGuidance(attemptedEnforcement)}` : ""}`,
    );
  }
}

function postWriteRecoveryGuidance(enforcement, rulesetId = null) {
  const idClause = Number.isSafeInteger(rulesetId)
    ? ` for exact ruleset id ${rulesetId}`
    : " against the complete authoritative ruleset inventory, binding any candidate by exact id";
  if (enforcement === "active") {
    return `The Active write may already have completed: preserve the v2 ruleset and every legacy protection, do not disable, delete, or overwrite the v2 gate, and perform an authoritative readback${idClause} before any separately authorized repair.`;
  }
  return `The Disabled staging write may already have completed: inspect an authoritative readback${idClause}; repair or disable it only after its exact state is known.`;
}

async function withPostWriteRecoveryGuidance(
  { enforcement, rulesetId = null },
  operation,
) {
  try {
    return await operation();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const guidance = postWriteRecoveryGuidance(enforcement, rulesetId);
    const guidancePrefix = enforcement === "active"
      ? "The Active write may already have completed:"
      : "The Disabled staging write may already have completed:";
    if (message.includes(guidancePrefix)) {
      throw error;
    }
    throw new Error(`${message} ${guidance}`);
  }
}

// Cleanup never trusts a digest manufactured from the already-mutated state.
// The read-only derive phase captures two identical complete pre-cleanup
// closures and deterministically removes only the legacy status requirement.
// The read-only verify phase then requires two complete post-cleanup closures
// to equal that pre-derived state. No original-repository write credential or
// in-repository ledger is needed.
async function printDerivedPostCleanupPlan({ options, canonicalWorkflows }) {
  const { plan } = await derivePostCleanupPlan({ options, canonicalWorkflows });
  process.stdout.write(canonicalPostCleanupPlanText(plan));
}

async function derivePostCleanupPlan({ options, canonicalWorkflows }) {
  const first = await loadCleanupSecurityClosure({
    options,
    canonicalWorkflows,
    requireLegacyClear: false,
  });
  assertLegacyInventoryDigestBytes(
    first.legacyInventoryBytes,
    options.expectedLegacyInventorySha256,
    "post-cleanup plan first pre-state readback",
  );
  const second = await loadCleanupSecurityClosure({
    options,
    canonicalWorkflows,
    requireLegacyClear: false,
  });
  assertLegacyInventoryDigestBytes(
    second.legacyInventoryBytes,
    options.expectedLegacyInventorySha256,
    "post-cleanup plan second pre-state readback",
  );
  assertCleanupClosureStable(first, second, "pre-cleanup plan derivation");

  const firstDerived = deriveAuthorizedPostCleanupState(first);
  const secondDerived = deriveAuthorizedPostCleanupState(second);
  if (
    canonicalSecurityBytes(firstDerived.state) !==
    canonicalSecurityBytes(secondDerived.state)
  ) {
    throw new Error(
      "The deterministic post-cleanup state changed across the two pre-cleanup readbacks; refusing to emit an approval digest.",
    );
  }
  const expectedDigest = fingerprintText(
    canonicalSecurityBytes(firstDerived.state),
  );
  const plan = {
    schema_version: 1,
    repository: first.state.repository,
    authorized_legacy_context: LEGACY_STATUS_CONTEXT,
    legacy_inventory_sha256: fingerprintText(first.legacyInventoryBytes),
    pre_cleanup_security_sha256: fingerprintText(
      canonicalSecurityBytes(first.state),
    ),
    expected_post_cleanup_security_sha256: expectedDigest,
    selected_v2_ruleset: {
      id: first.selectedV2.id,
      name: first.selectedV2.name,
      source_type: first.selectedV2.source_type,
      source: first.selectedV2.source,
      target: first.selectedV2.target,
    },
    cleanup_actions: firstDerived.actions,
    expected_post_cleanup_security_state: firstDerived.state,
  };
  return { plan, preCleanupClosure: first };
}

function canonicalPostCleanupPlanText(plan) {
  return `${JSON.stringify(JSON.parse(canonicalSecurityJson(plan)), null, 2)}\n`;
}

async function applyApprovedPostCleanupPlan({ options, canonicalWorkflows }) {
  const approved = await readApprovedPostCleanupPlan({
    path: options.applyPostCleanupPlanPath,
    expectedSha256: options.expectedPostCleanupPlanSha256,
  });
  const authorized = assertSourcePostCleanupPlanScope({
    plan: approved.plan,
    options,
  });
  const derived = await derivePostCleanupPlan({ options, canonicalWorkflows });
  if (
    canonicalPostCleanupPlanText(approved.plan) !==
    canonicalPostCleanupPlanText(derived.plan)
  ) {
    throw new Error(
      "The approved post-cleanup plan no longer equals a fresh two-round complete pre-cleanup derivation. Refusing to write after security-state drift; derive, review, and separately authorize a new raw plan.",
    );
  }
  const plannedAfterRuleset = authorized.plannedAfterLegacyRuleset;
  console.log(
    `Approved source-local cleanup plan ${approved.sha256}: remove only ${LEGACY_STATUS_CONTEXT} from ${authorized.legacyRulesetAction.name} (id ${authorized.legacyRulesetAction.id}).`,
  );
  if (!options.apply) {
    console.log("Dry run: the exact approved plan matches a fresh complete closure; no remote write was made.");
    console.log("Run again with --apply to perform the single plan-bound ruleset PUT.");
    return;
  }

  const preWriteDerived = await derivePostCleanupPlan({
    options,
    canonicalWorkflows,
  });
  if (
    canonicalPostCleanupPlanText(approved.plan) !==
    canonicalPostCleanupPlanText(preWriteDerived.plan)
  ) {
    throw new Error(
      "The approved post-cleanup plan no longer equals the final two-round complete pre-write derivation. Refusing to write after security-state drift; derive, review, and separately authorize a new raw plan.",
    );
  }
  const preWriteLegacyRuleset = selectSinglePlanRulesetProjection({
    state: preWriteDerived.preCleanupClosure.state,
    rulesetId: authorized.legacyRulesetAction.id,
    label: "final pre-write cleanup state",
  });
  const preWriteSelectedV2Ruleset = selectSinglePlanRulesetProjection({
    state: preWriteDerived.preCleanupClosure.state,
    rulesetId: authorized.selectedV2.id,
    label: "final pre-write selected v2 state",
  });

  // GitHub's repository-ruleset API has no If-Match/CAS update. The protected
  // property is the selected legacy ruleset's immutable identity plus complete
  // writable policy and the independent Active v2 identity/policy; the only
  // authorized change is removal of the legacy status rule. The final complete
  // two-round derivation catches all observed closure drift, then exact reads
  // compare both rulesets immediately before PUT. These reads are not CAS and
  // cannot exclude a concurrent administrator mutation in the final API gap:
  // the separately authorized operation must run under an external single-
  // writer policy freeze, and this executor must never claim otherwise, replay,
  // or roll back either this PUT or the independent Active v2 ruleset.
  const currentSelectedV2BeforeWrite = assertSelectedRepositoryRulesetIdentity(
    await ghJson(
      `repos/${options.repo.slug}/rulesets/${authorized.selectedV2.id}`,
    ),
    {
      repoSlug: options.repo.slug,
      rulesetId: authorized.selectedV2.id,
      rulesetName: authorized.selectedV2.name,
    },
  );
  const currentSelectedV2Projection = rulesetSecurityProjection(
    currentSelectedV2BeforeWrite,
    options.rulesetProfile,
  );
  if (
    canonicalSecurityJson(currentSelectedV2Projection.writable) !==
      canonicalSecurityJson(preWriteSelectedV2Ruleset.writable)
  ) {
    throw new Error(
      `Selected v2 ruleset ${authorized.selectedV2.id} changed after the final complete pre-write closure; refusing to remove ${LEGACY_STATUS_CONTEXT}. Preserve Active v2, derive and separately review a new cleanup plan.`,
    );
  }
  // Read the mutation target last, minimizing the unavoidable no-CAS window
  // between its exact writable projection comparison and the legacy PUT.
  const currentBeforeWrite = assertSelectedRepositoryRulesetIdentity(
    await ghJson(
      `repos/${options.repo.slug}/rulesets/${authorized.legacyRulesetAction.id}`,
    ),
    {
      repoSlug: options.repo.slug,
      rulesetId: authorized.legacyRulesetAction.id,
      rulesetName: authorized.legacyRulesetAction.name,
    },
  );
  const currentBeforeProjection = rulesetSecurityProjection(
    currentBeforeWrite,
    DEFAULT_RULESET_PROFILE,
  );
  if (
    canonicalSecurityJson(currentBeforeProjection.writable) !==
      canonicalSecurityJson(preWriteLegacyRuleset.writable)
  ) {
    throw new Error(
      `Ruleset ${authorized.legacyRulesetAction.id} changed after the final complete pre-write closure; refusing an observed lost-update overwrite. Preserve Active v2, derive and separately review a new cleanup plan.`,
    );
  }

  const verifyOptions = {
    ...options,
    expectedPostCleanupSecuritySha256:
      approved.plan.expected_post_cleanup_security_sha256,
  };
  await withPostCleanupWriteRecoveryGuidance(
    {
      repoSlug: options.repo.slug,
      rulesetId: authorized.legacyRulesetAction.id,
      rulesetName: authorized.selectedV2.name,
      controlPlaneOwner: options.controlPlaneOwner,
      rulesetProfile: options.rulesetProfile,
      legacyBridge: options.legacyBridge,
      expectedPostCleanupSecuritySha256:
        approved.plan.expected_post_cleanup_security_sha256,
    },
    async () => {
      await ghJson(
        `repos/${options.repo.slug}/rulesets/${authorized.legacyRulesetAction.id}`,
        {
          method: "PUT",
          body: structuredClone(plannedAfterRuleset.writable),
        },
      );
      const exactReadback = assertSelectedRepositoryRulesetIdentity(
        await ghJson(
          `repos/${options.repo.slug}/rulesets/${authorized.legacyRulesetAction.id}`,
        ),
        {
          repoSlug: options.repo.slug,
          rulesetId: authorized.legacyRulesetAction.id,
          rulesetName: authorized.legacyRulesetAction.name,
        },
      );
      const readbackProjection = rulesetSecurityProjection(
        exactReadback,
        DEFAULT_RULESET_PROFILE,
      );
      if (
        canonicalSecurityJson(readbackProjection.writable) !==
        canonicalSecurityJson(plannedAfterRuleset.writable)
      ) {
        throw new Error(
          `Ruleset ${authorized.legacyRulesetAction.id} readback does not equal the approved post-cleanup writable projection.`,
        );
      }
      await verifyExpectedPostCleanupState({
        options: verifyOptions,
        canonicalWorkflows,
      });
    },
  );
  console.log(
    `Applied the approved source-local cleanup plan and verified its post-cleanup closure: ${rulesetLabel(currentBeforeWrite)} retained every planned non-legacy protection while ${LEGACY_STATUS_CONTEXT} was removed.`,
  );
}

async function readApprovedPostCleanupPlan({ path, expectedSha256 }) {
  const noFollow = fileSystemConstants.O_NOFOLLOW ?? 0;
  let handle;
  let primaryError = null;
  try {
    handle = await open(
      path,
      fileSystemConstants.O_RDONLY |
        noFollow |
        (fileSystemConstants.O_NONBLOCK ?? 0),
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Approved post-cleanup plan is missing: ${path}`);
    }
    throw new Error(`Unable to open approved post-cleanup plan: ${path}: ${error.message}`);
  }
  try {
    const metadata = await handle.stat({ bigint: true });
    if (!metadata.isFile()) {
      throw new Error(
        `Approved post-cleanup plan must be a regular file: ${path}`,
      );
    }
    if (metadata.size > BigInt(MAX_APPROVED_POST_CLEANUP_PLAN_BYTES)) {
      throw new Error(
        `Approved post-cleanup plan exceeds the ${MAX_APPROVED_POST_CLEANUP_PLAN_BYTES}-byte admission limit: ${path}`,
      );
    }
    // O_NOFOLLOW is unavailable on a few platforms. There, bind the opened
    // descriptor to a same-object non-symlink path witness before reading.
    // This is only an admission check: the protected property is the raw
    // content read from the admitted descriptor, not later pathname identity.
    if (noFollow === 0) {
      const pathMetadata = await lstat(path, { bigint: true });
      if (
        !pathMetadata.isFile() ||
        pathMetadata.isSymbolicLink() ||
        pathMetadata.dev !== metadata.dev ||
        pathMetadata.ino !== metadata.ino
      ) {
        throw new Error(
          `Approved post-cleanup plan changed or is not a regular non-symlink file while opening it: ${path}`,
        );
      }
    }
    // The protected local property is the admitted plan content. O_NOFOLLOW,
    // O_NONBLOCK, and descriptor stat reject a symlink, FIFO, device, or
    // replacement at opening. Read the descriptor with a hard byte ceiling;
    // a pre-read stat cannot bound concurrent growth or a sparse file by
    // itself. Bind the admitted bytes' SHA-256 before parsing and retain them
    // while remote reads occur.
    const bytes = await readBoundedApprovedPostCleanupPlanBytes(handle);
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (actualSha256 !== expectedSha256) {
      throw new Error(
        `Approved post-cleanup plan SHA-256 mismatched: expected ${expectedSha256}, read ${actualSha256}. Refusing all remote writes.`,
      );
    }
    const text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) {
      throw new Error(
        `Approved post-cleanup plan is not exact UTF-8 text: ${path}`,
      );
    }
    let plan;
    try {
      plan = JSON.parse(text);
    } catch (error) {
      throw new Error(
        `Approved post-cleanup plan is not valid JSON: ${error.message}`,
      );
    }
    if (canonicalPostCleanupPlanText(plan) !== text) {
      throw new Error(
        "Approved post-cleanup plan is not the unmodified canonical raw output from --derive-post-cleanup-plan. Refusing all remote writes.",
      );
    }
    return { plan, sha256: actualSha256 };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await handle.close();
    } catch (error) {
      if (primaryError === null) {
        throw error;
      }
    }
  }
}

async function readBoundedApprovedPostCleanupPlanBytes(handle) {
  const chunks = [];
  let total = 0;
  let position = 0;
  while (true) {
    const remaining = MAX_APPROVED_POST_CLEANUP_PLAN_BYTES + 1 - total;
    const chunk = Buffer.allocUnsafe(Math.min(65_536, remaining));
    const { bytesRead } = await handle.read(
      chunk,
      0,
      chunk.length,
      position,
    );
    if (bytesRead === 0) {
      return Buffer.concat(chunks, total);
    }
    total += bytesRead;
    if (total > MAX_APPROVED_POST_CLEANUP_PLAN_BYTES) {
      throw new Error(
        `Approved post-cleanup plan exceeds the ${MAX_APPROVED_POST_CLEANUP_PLAN_BYTES}-byte admission limit while reading its bound descriptor.`,
      );
    }
    chunks.push(chunk.subarray(0, bytesRead));
    position += bytesRead;
  }
}

function assertSourcePostCleanupPlanScope({ plan, options }) {
  if (plan === null || typeof plan !== "object" || Array.isArray(plan)) {
    throw new Error("Approved post-cleanup plan must be a JSON object.");
  }
  if (plan.schema_version !== 1) {
    throw new Error("Approved post-cleanup plan must use schema_version 1.");
  }
  if (
    plan.authorized_legacy_context !== LEGACY_STATUS_CONTEXT ||
    canonicalSecurityJson(plan.repository) !==
      canonicalSecurityJson(plan.expected_post_cleanup_security_state?.repository) ||
    plan.repository?.full_name !== SOURCE_SELF_HOSTING_REPOSITORY_SLUG ||
    plan.repository?.full_name !== options.repo.slug
  ) {
    throw new Error(
      "Approved post-cleanup plan is not bound to the source repository and exact legacy review-gate context.",
    );
  }
  parseExpectedSecuritySha256(
    plan.pre_cleanup_security_sha256,
    "approved plan pre_cleanup_security_sha256",
  );
  if (plan.legacy_inventory_sha256 !== options.expectedLegacyInventorySha256) {
    throw new Error(
      "Approved post-cleanup plan is not bound to the same owner-approved legacy inventory SHA-256 supplied for this cleanup.",
    );
  }
  parseExpectedSecuritySha256(
    plan.legacy_inventory_sha256,
    "approved plan legacy_inventory_sha256",
  );
  parseExpectedSecuritySha256(
    plan.expected_post_cleanup_security_sha256,
    "approved plan expected_post_cleanup_security_sha256",
  );
  const selectedV2 = plan.selected_v2_ruleset;
  if (
    selectedV2 === null ||
    typeof selectedV2 !== "object" ||
    Array.isArray(selectedV2) ||
    !Number.isSafeInteger(selectedV2.id) ||
    selectedV2.id <= 0 ||
    selectedV2.name !== options.rulesetName ||
    selectedV2.source_type !== "Repository" ||
    selectedV2.source !== SOURCE_SELF_HOSTING_REPOSITORY_SLUG ||
    selectedV2.target !== "branch"
  ) {
    throw new Error(
      "Approved post-cleanup plan does not bind the selected source status-only v2 ruleset to the requested exact repository ruleset name.",
    );
  }
  const actions = plan.cleanup_actions;
  if (
    actions === null ||
    typeof actions !== "object" ||
    Array.isArray(actions) ||
    actions.classic_required_status_check_removed !== false ||
    !Array.isArray(actions.rulesets) ||
    actions.rulesets.length !== 1
  ) {
    throw new Error(
      "Source-local cleanup authorizes exactly one retained-ruleset legacy status removal and no classic branch-protection mutation.",
    );
  }
  const [legacyRulesetAction] = actions.rulesets;
  if (
    legacyRulesetAction === null ||
    typeof legacyRulesetAction !== "object" ||
    Array.isArray(legacyRulesetAction) ||
    !Number.isSafeInteger(legacyRulesetAction.id) ||
    legacyRulesetAction.id <= 0 ||
    typeof legacyRulesetAction.name !== "string" ||
    legacyRulesetAction.name === "" ||
    legacyRulesetAction.action !== "remove-legacy-check-only" ||
    legacyRulesetAction.id === selectedV2.id
  ) {
    throw new Error(
      "Source-local cleanup permits only one distinct legacy ruleset action: remove-legacy-check-only.",
    );
  }
  const plannedAfterLegacyRuleset = selectSinglePlanRulesetProjection({
    state: plan.expected_post_cleanup_security_state,
    rulesetId: legacyRulesetAction.id,
    label: "approved post-cleanup state",
  });
  const plannedSelectedV2 = selectSinglePlanRulesetProjection({
    state: plan.expected_post_cleanup_security_state,
    rulesetId: selectedV2.id,
    label: "approved post-cleanup selected v2 ruleset",
  });
  if (
    plannedAfterLegacyRuleset.name !== legacyRulesetAction.name ||
    plannedAfterLegacyRuleset.source_type !== "Repository" ||
    plannedAfterLegacyRuleset.source !== SOURCE_SELF_HOSTING_REPOSITORY_SLUG ||
    plannedSelectedV2.name !== selectedV2.name ||
    plannedSelectedV2.source_type !== selectedV2.source_type ||
    plannedSelectedV2.source !== selectedV2.source ||
    plannedSelectedV2.writable?.target !== selectedV2.target ||
    !Array.isArray(plannedAfterLegacyRuleset.writable?.rules) ||
    plannedAfterLegacyRuleset.writable.rules.some(
      (rule) => rule?.type === "required_status_checks",
    )
  ) {
    throw new Error(
      "Approved source-local cleanup state does not preserve the selected v2 identity or remove only the legacy ruleset status rule.",
    );
  }
  return { legacyRulesetAction, plannedAfterLegacyRuleset, selectedV2 };
}

function selectSinglePlanRulesetProjection({ state, rulesetId, label }) {
  if (
    state === null ||
    typeof state !== "object" ||
    Array.isArray(state) ||
    !Array.isArray(state.rulesets)
  ) {
    throw new Error(`${label} lacks a complete ruleset security projection.`);
  }
  const matches = state.rulesets.filter((ruleset) => ruleset?.id === rulesetId);
  if (matches.length !== 1) {
    throw new Error(
      `${label} must bind exactly one ruleset projection for id ${rulesetId}.`,
    );
  }
  const [ruleset] = matches;
  if (
    typeof ruleset.name !== "string" ||
    typeof ruleset.source_type !== "string" ||
    typeof ruleset.source !== "string" ||
    ruleset.writable === null ||
    typeof ruleset.writable !== "object" ||
    Array.isArray(ruleset.writable)
  ) {
    throw new Error(`${label} has a malformed ruleset writable projection.`);
  }
  return ruleset;
}

function postCleanupWriteRecoveryGuidance({
  repoSlug,
  rulesetId,
  rulesetName,
  controlPlaneOwner,
  rulesetProfile,
  legacyBridge,
  expectedPostCleanupSecuritySha256,
}) {
  const recoveryScope = [
    `--repo ${shellQuote(repoSlug)}`,
    `--control-plane-owner ${shellQuote(controlPlaneOwner)}`,
    `--ruleset-name ${shellQuote(rulesetName)}`,
    `--ruleset-profile ${shellQuote(rulesetProfile)}`,
    ...(legacyBridge ? ["--legacy-bridge"] : []),
    "--verify-post-cleanup",
    `--expected-post-cleanup-security-sha256 ${expectedPostCleanupSecuritySha256}`,
  ].join(" ");
  return `The plan-bound source cleanup PUT may already have completed. Do not replay the PUT, rollback or overwrite Active v2, remove the bridge, or mutate classic protection. First run the exact read-only closure from this source checkout: node ${shellQuote(BOOTSTRAP_SCRIPT_PATH)} ${recoveryScope}; if it is inconclusive, inspect exact ruleset id ${rulesetId} and the approved plan before separately authorizing any repair.`;
}

function shellQuote(value) {
  if (typeof value !== "string") {
    throw new TypeError("Shell guidance can quote only string arguments.");
  }
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

async function withPostCleanupWriteRecoveryGuidance(details, operation) {
  try {
    return await operation();
  } catch (error) {
    // Remote API stderr can contain arbitrary text, so only this process-local
    // symbol—not a recovery sentence in Error.message—proves guidance was
    // already attached by this wrapper.
    if (error?.[POST_CLEANUP_WRITE_RECOVERY_TAG] === true) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    const wrapped = new Error(
      `${message} ${postCleanupWriteRecoveryGuidance(details)}`,
    );
    Object.defineProperty(wrapped, POST_CLEANUP_WRITE_RECOVERY_TAG, {
      value: true,
    });
    throw wrapped;
  }
}

async function verifyExpectedPostCleanupState({ options, canonicalWorkflows }) {
  const first = await loadCleanupSecurityClosure({
    options,
    canonicalWorkflows,
    requireLegacyClear: true,
  });
  const second = await loadCleanupSecurityClosure({
    options,
    canonicalWorkflows,
    requireLegacyClear: true,
  });
  assertCleanupClosureStable(first, second, "post-cleanup verification");
  const firstDigest = fingerprintText(canonicalSecurityBytes(first.state));
  const secondDigest = fingerprintText(canonicalSecurityBytes(second.state));
  if (
    firstDigest !== options.expectedPostCleanupSecuritySha256 ||
    secondDigest !== options.expectedPostCleanupSecuritySha256
  ) {
    throw new Error(
      `Post-cleanup security state does not equal the pre-cleanup derived authorized state: expected ${options.expectedPostCleanupSecuritySha256}, read ${firstDigest} and ${secondDigest}. Preserve the Active v2 ruleset and every remaining protection; do not delete, disable, or overwrite the v2 gate while investigating the drift.`,
    );
  }
  console.log(
    `Post-cleanup verified across two complete stable security snapshots: both legacy requirement surfaces are clear, every unrelated protection matches the pre-derived state, and ${rulesetLabel(second.selectedV2)} remains the ${rulesetProfileDescription(options.rulesetProfile, { active: true })}.`,
  );
}

async function loadCleanupSecurityClosure({
  options,
  canonicalWorkflows,
  requireLegacyClear,
}) {
  const securitySnapshot = await loadConsumerSecuritySnapshot({
    repoSlug: options.repo.slug,
    canonicalWorkflows,
    controlPlaneOwner: options.controlPlaneOwner,
  });
  const rulesets = await loadRulesets(options.repo.slug);
  const selectedV2 = selectUniqueNamedRepositoryRuleset(
    rulesets,
    options.rulesetName,
  );
  if (
    selectedV2 === undefined ||
    selectedV2.target !== "branch" ||
    selectedV2.enforcement !== "active" ||
    !rulesetMatchesProfileAtDefaultBranch({
      ruleset: selectedV2,
      rulesetProfile: options.rulesetProfile,
      defaultBranch: securitySnapshot.defaultBranch,
      context: options.context,
      integrationId: options.integrationId,
    }) ||
    (requireLegacyClear &&
      rulesetHasRequiredStatusContext(selectedV2, LEGACY_STATUS_CONTEXT, {
        integrationId: undefined,
      }))
  ) {
    throw new Error(
      `Cleanup closure requires the unique repository ruleset "${options.rulesetName}" to remain the ${rulesetProfileDescription(options.rulesetProfile, { active: true })}${requireLegacyClear ? ` without ${LEGACY_STATUS_CONTEXT}` : ""}.`,
    );
  }

  let legacyInventoryBytes;
  try {
    legacyInventoryBytes = await loadCanonicalLegacyInventoryBytes({
      repoSlug: options.repo.slug,
      defaultBranch: securitySnapshot.defaultBranch,
    });
  } catch (error) {
    throw new Error(
      `Cleanup security closure could not read a complete legacy inventory.\n${error.message}`,
    );
  }
  const legacyInventory = decodeBoundLegacyInventory({
    bytes: legacyInventoryBytes,
    repoSlug: options.repo.slug,
    repositoryId: securitySnapshot.repoId,
    repositoryNodeId: securitySnapshot.repoNodeId,
    defaultBranch: securitySnapshot.defaultBranch,
  });
  if (
    canonicalSecurityJson(legacyInventory.classic_required_status_checks) !==
    canonicalSecurityJson(securitySnapshot.classicRequiredStatusChecks)
  ) {
    throw new Error(
      "Classic required-status policy changed between the full security snapshot and legacy-inventory readback.",
    );
  }
  const byId = new Map(rulesets.map((ruleset) => [ruleset.id, ruleset]));
  for (const legacyRuleset of legacyInventory.rulesets) {
    const fullRuleset = byId.get(legacyRuleset.id);
    if (
      fullRuleset === undefined ||
      postCleanupRulesetFingerprint(fullRuleset) !==
        postCleanupRulesetFingerprint(legacyRuleset)
    ) {
      throw new Error(
        `Effective legacy ruleset ${legacyRuleset.id} changed between the complete ruleset and legacy-inventory readbacks.`,
      );
    }
  }
  if (requireLegacyClear) {
    assertDecodedLegacyInventoryClear(legacyInventory, options.repo.slug);
  }

  return {
    legacyInventory,
    legacyInventoryBytes,
    rulesetProfile: options.rulesetProfile,
    selectedV2,
    state: buildCleanupSecurityState({
      repoSlug: options.repo.slug,
      securitySnapshot,
      rulesets,
      selectedV2,
      rulesetProfile: options.rulesetProfile,
    }),
  };
}

function buildCleanupSecurityState({
  repoSlug,
  securitySnapshot,
  rulesets,
  selectedV2,
  rulesetProfile,
}) {
  return {
    schema_version: 1,
    repository: {
      full_name: repoSlug,
      id: securitySnapshot.repoId,
      node_id: securitySnapshot.repoNodeId,
      default_branch: securitySnapshot.defaultBranch,
      default_branch_head_sha: securitySnapshot.defaultBranchHeadSha,
    },
    actions_workflow_permissions: securitySnapshot.actionsWorkflowPermissions,
    control_plane_owner: securitySnapshot.controlPlaneOwner,
    workflow_inventory: securitySnapshot.workflowInventory,
    codeowners: {
      content_sha256: securitySnapshot.codeownersFingerprint,
      errors: securitySnapshot.codeownersErrors,
      has_effective_unmanaged_patterns:
        securitySnapshot.hasEffectiveUnmanagedCodeownersPatterns,
    },
    classic_branch_protection: securitySnapshot.classicBranchProtection,
    rulesets: rulesets
      .map((ruleset) =>
        rulesetSecurityProjection(
          ruleset,
          ruleset.id === selectedV2.id
            ? rulesetProfile
            : DEFAULT_RULESET_PROFILE,
        ))
      .sort((left, right) => left.id - right.id),
  };
}

function rulesetSecurityProjection(
  ruleset,
  rulesetProfile = DEFAULT_RULESET_PROFILE,
) {
  return {
    id: ruleset.id,
    name: ruleset.name,
    source_type: ruleset.source_type,
    source: ruleset.source,
    writable: canonicalizeSecurityApiValue(
      JSON.parse(rulesetWritableFingerprint(ruleset, { profile: rulesetProfile })),
    ),
  };
}

function deriveAuthorizedPostCleanupState(closure) {
  const state = structuredClone(closure.state);
  const actions = {
    classic_required_status_check_removed: false,
    rulesets: [],
  };
  const classic = state.classic_branch_protection?.required_status_checks ?? null;
  if (classic !== null) {
    const nextClassic = removeLegacyFromClassicStatusPolicy(classic);
    actions.classic_required_status_check_removed =
      canonicalSecurityJson(nextClassic) !== canonicalSecurityJson(classic);
    state.classic_branch_protection.required_status_checks = nextClassic;
  }

  const effectiveLegacyIds = new Set(
    closure.legacyInventory.rulesets.map((ruleset) => ruleset.id),
  );
  state.rulesets = state.rulesets.flatMap((ruleset) => {
    if (!effectiveLegacyIds.has(ruleset.id)) {
      return [ruleset];
    }
    const nextRules = ruleset.writable.rules.flatMap((rule) => {
      if (rule.type !== "required_status_checks") {
        return [rule];
      }
      const checks = rule.parameters.required_status_checks.filter(
        (check) => check.context !== LEGACY_STATUS_CONTEXT,
      );
      if (checks.length === rule.parameters.required_status_checks.length) {
        return [rule];
      }
      if (checks.length === 0) {
        return [];
      }
      return [{
        ...rule,
        parameters: {
          ...rule.parameters,
          required_status_checks: checks,
        },
      }];
    });
    if (nextRules.length === 0) {
      actions.rulesets.push({
        id: ruleset.id,
        name: ruleset.name,
        action: "delete-dedicated-legacy-only-ruleset",
      });
      return [];
    }
    const updated = structuredClone(ruleset);
    updated.writable.rules = nextRules;
    actions.rulesets.push({
      id: ruleset.id,
      name: ruleset.name,
      action: "remove-legacy-check-only",
    });
    return [updated];
  });
  return { state, actions };
}

function removeLegacyFromClassicStatusPolicy(classic) {
  const contexts = classic.contexts.filter(
    (context) => context !== LEGACY_STATUS_CONTEXT,
  );
  const checks = classic.checks.filter(
    (check) => check.context !== LEGACY_STATUS_CONTEXT,
  );
  if (contexts.length === 0 && checks.length === 0) {
    return null;
  }
  return { ...classic, contexts, checks };
}

function decodeBoundLegacyInventory({
  bytes,
  repoSlug,
  repositoryId,
  repositoryNodeId,
  defaultBranch,
}) {
  let inventory;
  try {
    inventory = JSON.parse(bytes);
  } catch (error) {
    throw new Error(
      `Legacy review-gate inventory could not be decoded; verification is inconclusive.\n${error.message}`,
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
      "Legacy review-gate inventory lost its repository/default-branch binding or ruleset array.",
    );
  }
  return inventory;
}

function assertDecodedLegacyInventoryClear(inventory, repoSlug) {
  const classic = inventory.classic_required_status_checks;
  const classicHasLegacy = classic !== null &&
    (classic.contexts.includes(LEGACY_STATUS_CONTEXT) ||
      classic.checks.some((check) => check.context === LEGACY_STATUS_CONTEXT));
  if (inventory.rulesets.length > 0 || classicHasLegacy) {
    throw new Error(
      `${LEGACY_STATUS_CONTEXT} remains required after cleanup on ${repoSlug}; leave the v2 ruleset active, remove only the remaining authorized legacy requirement, and rerun this read-only verification.`,
    );
  }
}

function assertCleanupClosureStable(first, second, phase) {
  if (
    first.legacyInventoryBytes !== second.legacyInventoryBytes ||
    canonicalSecurityBytes(first.state) !== canonicalSecurityBytes(second.state) ||
    postCleanupRulesetFingerprint(
      first.selectedV2,
      first.rulesetProfile,
    ) !==
      postCleanupRulesetFingerprint(
        second.selectedV2,
        second.rulesetProfile,
      )
  ) {
    throw new Error(
      `Repository security state changed across the two complete ${phase} readbacks; the result is inconclusive and must be rerun against a stable repository.`,
    );
  }
}

function assertLegacyInventoryDigestBytes(bytes, expectedDigest, phase) {
  const actualDigest = fingerprintText(bytes);
  if (actualDigest !== expectedDigest) {
    throw new Error(
      `Canonical legacy review-gate inventory mismatched the owner-approved pre-cleanup snapshot during ${phase}: expected ${expectedDigest}, read ${actualDigest}.`,
    );
  }
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

function postCleanupRulesetFingerprint(
  ruleset,
  rulesetProfile = DEFAULT_RULESET_PROFILE,
) {
  return canonicalSecurityJson({
    id: ruleset.id,
    source_type: ruleset.source_type,
    source: ruleset.source,
    writable: canonicalizeSecurityApiValue(
      JSON.parse(rulesetWritableFingerprint(ruleset, { profile: rulesetProfile })),
    ),
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

function rulesetMatchesProfileAtDefaultBranch({
  ruleset,
  rulesetProfile,
  defaultBranch,
  context,
  integrationId,
}) {
  if (!rulesetCoversDefaultBranch(ruleset, defaultBranch)) {
    return false;
  }
  if (normalizeRulesetProfile(rulesetProfile) === RULESET_PROFILE_STATUS_ONLY) {
    return rulesetHasStatusOnlyProfile(ruleset, context, { integrationId });
  }
  return rulesetHasPolicyForProfile(
    ruleset,
    rulesetProfile,
    context,
    { integrationId },
  );
}

function rulesetProfileDescription(profile, { active = false } = {}) {
  switch (normalizeRulesetProfile(profile)) {
    case DEFAULT_RULESET_PROFILE:
      return active ? "complete Active v2 policy" : "complete v2 gate policy";
    case RULESET_PROFILE_STATUS_ONLY:
      return active ? "status-only Active v2 policy" : "status-only v2 policy";
    default:
      throw new Error("Ruleset profile normalization returned an unsupported value.");
  }
}

function rulesetProfileReadbackExpectation(profile, context, integrationId) {
  switch (normalizeRulesetProfile(profile)) {
    case DEFAULT_RULESET_PROFILE:
      return `strict ${context} from GitHub Actions (${integrationId}), code-owner review without weakening an existing approval count, resolved conversations, non-fast-forward protection, and explicit empty bypass actors`;
    case RULESET_PROFILE_STATUS_ONLY:
      return `one strict ${context} check bound to GitHub Actions (${integrationId}), default source conditions, explicit empty bypass actors, and no other rules`;
    default:
      throw new Error("Ruleset profile normalization returned an unsupported value.");
  }
}

function rulesetReadbackSuccessMessage({
  ruleset,
  rulesetProfile,
  enforcement,
}) {
  if (normalizeRulesetProfile(rulesetProfile) === DEFAULT_RULESET_PROFILE) {
    return `Ruleset readback: ${rulesetLabel(ruleset)} is complete with ${enforcement} enforcement.`;
  }
  return `Ruleset readback: ${rulesetLabel(ruleset)} is an exact status-only v2 policy with ${enforcement} enforcement.`;
}

function printDryRun(action, options, payload, existingRuleset = null) {
  console.log(`Dry run: would ${action} repository ruleset "${payload.name}".`);
  if (existingRuleset !== null) {
    console.log(`Existing ruleset: ${rulesetLabel(existingRuleset)}`);
  }
  console.log(`Ruleset profile: ${options.rulesetProfile}`);
  console.log(`Required status: ${options.context}`);
  console.log(`Enforcement: ${payload.enforcement}`);
  console.log(`Required source: GitHub Actions (${options.integrationId})`);
  console.log(`Required control-plane owner: ${options.controlPlaneOwner}`);
  console.log(`Target refs: ${(payload.conditions?.ref_name?.include ?? []).join(", ")}`);
  console.log("Payload:");
  console.log(JSON.stringify(payload, null, 2));
  console.log(`Run again with --apply to ${action} it.`);
}

async function loadCanonicalWorkflows({ includeLegacyBridge = false } = {}) {
  const [verifier, controller] = await Promise.all([
    readFile(CANONICAL_VERIFIER_WORKFLOW_SOURCE, "utf8"),
    readFile(CANONICAL_CONTROLLER_WORKFLOW_SOURCE, "utf8"),
  ]);
  const canonicalWorkflows = {
    verifier: validateCanonicalV2VerifierWorkflowContent(verifier),
    controller: validateCanonicalV2ControllerWorkflowContent(controller),
  };
  if (includeLegacyBridge) {
    const legacyBridge = await readFile(
      CANONICAL_LEGACY_BRIDGE_WORKFLOW_SOURCE,
      "utf8",
    );
    canonicalWorkflows.legacyBridge =
      validateCanonicalLegacyBridgeWorkflowContent(legacyBridge);
  }
  return canonicalWorkflows;
}

async function loadAndBindOrganizationBridgeRemovalProof({
  targetRoot,
  receiptPath,
  expectedSha256,
}) {
  const content = await readOptionalRegularFile(receiptPath);
  if (content === null) {
    throw new Error(`Admitted bridge-removal proof is missing: ${receiptPath}`);
  }
  let output;
  try {
    output = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Admitted bridge-removal proof is not valid JSON: ${error.message}`,
    );
  }
  const validated = validateOrganizationBridgeRemovalProofOutput(output);
  const computedSha256 = fingerprintText(validated.canonicalReceipt);
  if (validated.claimedSha256 !== computedSha256) {
    throw new Error(
      "Admitted bridge-removal proof receipt SHA-256 does not match its canonical content.",
    );
  }
  if (expectedSha256 !== computedSha256) {
    throw new Error(
      `--expected-final-closure-receipt-sha256 does not match the admitted bridge-removal proof receipt (expected ${computedSha256}).`,
    );
  }

  const origin = await loadGitHubOriginRepository(targetRoot);
  const repository = validated.bridgeRemovalRepositories.find(
    (candidate) =>
      candidate.full_name.toLowerCase() === origin.repository.slug.toLowerCase(),
  );
  if (repository === undefined) {
    throw new Error(
      `Git origin repository ${origin.repository.slug} is not authorized for bridge removal by the admitted bridge-removal proof.`,
    );
  }
  const proof = {
    receiptPath,
    sha256: computedSha256,
    proofKind: validated.proofKind,
    receipt: validated.receipt,
    organization: validated.receipt.organization,
    repository,
    originRepository: origin.repository,
  };
  return proof;
}

async function loadGitHubOriginRepository(targetRoot) {
  let stdout;
  try {
    stdout = await runCommand("git", [
      "-C",
      targetRoot,
      "remote",
      "get-url",
      "origin",
    ]);
  } catch (error) {
    throw new Error(
      `Unable to bind --prepare-worktree to a GitHub origin repository: ${error.message}`,
    );
  }
  const value = stdout.replace(/\r?\n$/u, "");
  if (/[\r\n]/u.test(value)) {
    throw new Error("Git origin returned more than one repository URL.");
  }
  return { raw: value, repository: parseGitHubRepositoryRemote(value) };
}

function githubRepositoryEndpoint(repository) {
  return `repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`;
}

function organizationFinalClosureRepositoryIdentity(value, label) {
  const identity = {
    full_name: value?.full_name,
    id: value?.id,
    node_id: value?.node_id,
    default_branch: value?.default_branch,
  };
  if (
    typeof identity.full_name !== "string" ||
    identity.full_name === "" ||
    !Number.isSafeInteger(identity.id) ||
    identity.id <= 0 ||
    typeof identity.node_id !== "string" ||
    identity.node_id === "" ||
    typeof identity.default_branch !== "string" ||
    identity.default_branch === ""
  ) {
    throw new Error(
      `${label} does not provide a complete GitHub repository identity and default branch.`,
    );
  }
  return identity;
}

function organizationFinalClosureOrganizationIdentity(value, label) {
  const identity = {
    login: value?.login,
    id: value?.id,
    node_id: value?.node_id,
  };
  if (
    typeof identity.login !== "string" ||
    identity.login === "" ||
    !Number.isSafeInteger(identity.id) ||
    identity.id <= 0 ||
    typeof identity.node_id !== "string" ||
    identity.node_id === ""
  ) {
    throw new Error(`${label} does not provide a complete GitHub organization identity.`);
  }
  return identity;
}

function assertPostCutoverAuditOrganizationRulesetBinding({
  ruleset,
  expected,
  organization,
  label,
}) {
  const complete = assertCompleteRulesetApiObject(ruleset);
  if (
    complete.id !== expected.id ||
    complete.source_type !== "Organization" ||
    complete.source !== organization.login ||
    complete.target !== "branch"
  ) {
    throw new Error(
      `${label} no longer has the receipt-bound organization identity, source, and branch target.`,
    );
  }
  const writableSha256 = fingerprintText(rulesetWritableFingerprint(complete));
  if (writableSha256 !== expected.writable_sha256) {
    if (
      label === "Post-cutover audit legacy organization ruleset" &&
      rulesetHasRequiredStatusContext(complete, LEGACY_STATUS_CONTEXT, {
        integrationId: undefined,
      })
    ) {
      throw new Error(
        `${label} restored ${LEGACY_STATUS_CONTEXT} after the audit.`,
      );
    }
    throw new Error(
      `${label} writable policy drifted after the audit (expected ${expected.writable_sha256}, read ${writableSha256}).`,
    );
  }
}

// The post-cutover receipt is the only admitted removal proof that commits
// writable-policy hashes. Re-read exactly those two organization rulesets
// before every local mutation boundary, so the consumer never treats the
// audit as a perpetual authorization after a later v1 restoration or policy
// rewrite. The receipt deliberately does not contain a replayable complete
// repository-local policy snapshot. The separate live repository check below
// therefore proves only the security property actually bound by this receipt:
// no legacy status remains effective through either classic protection or an
// effective ruleset. It must not invent an unbound repository-policy hash.
// The existing origin -> live repository identity/default-branch -> origin
// binding remains the independent consumer object-selection proof. Historical
// handoff-v2 proofs also retain their published identity-only compatibility
// because they contain no policy fingerprints.
async function assertPostCutoverAuditOrganizationPolicyStable(proof, phase) {
  if (proof.proofKind !== "post-cutover-audit-v1") return;

  const organization = proof.organization;
  try {
    const [liveOrganization, legacyRuleset, v2Ruleset] = await Promise.all([
      ghJson(`orgs/${encodeURIComponent(organization.login)}`),
      ghJson(
        `orgs/${encodeURIComponent(organization.login)}/rulesets/${proof.receipt.legacy.id}`,
      ),
      ghJson(
        `orgs/${encodeURIComponent(organization.login)}/rulesets/${proof.receipt.v2.id}`,
      ),
    ]);
    const liveIdentity = organizationFinalClosureOrganizationIdentity(
      liveOrganization,
      `GitHub organization during ${phase}`,
    );
    if (
      liveIdentity.login !== organization.login ||
      liveIdentity.id !== organization.id ||
      liveIdentity.node_id !== organization.node_id
    ) {
      throw new Error(
        `GitHub organization identity changed during ${phase}; refusing bridge removal success.`,
      );
    }
    assertPostCutoverAuditOrganizationRulesetBinding({
      ruleset: legacyRuleset,
      expected: proof.receipt.legacy,
      organization,
      label: "Post-cutover audit legacy organization ruleset",
    });
    assertPostCutoverAuditOrganizationRulesetBinding({
      ruleset: v2Ruleset,
      expected: proof.receipt.v2,
      organization,
      label: "Post-cutover audit v2 organization ruleset",
    });
  } catch (error) {
    throw new Error(
      `Post-cutover audit organization policy is unreadable or drifted during ${phase}; refusing bridge removal success.\n${error.message}`,
    );
  }
}

async function assertPostCutoverAuditRepositoryLegacyPolicyClear(proof, phase) {
  if (proof.proofKind !== "post-cutover-audit-v1") return;

  const repository = proof.repository;
  try {
    const bytes = await loadCanonicalLegacyInventoryBytes({
      repoSlug: repository.full_name,
      defaultBranch: repository.default_branch,
    });
    const inventory = decodeBoundLegacyInventory({
      bytes,
      repoSlug: repository.full_name,
      repositoryId: repository.id,
      repositoryNodeId: repository.node_id,
      defaultBranch: repository.default_branch,
    });
    assertDecodedLegacyInventoryClear(inventory, repository.full_name);
  } catch (error) {
    throw new Error(
      `Post-cutover audit repository legacy-policy is unreadable or restored during ${phase}; refusing bridge removal success.\n${error.message}`,
    );
  }
}

async function loadCurrentOrganizationFinalClosureRepository(
  originRepository,
  phase,
) {
  const response = await ghJson(githubRepositoryEndpoint(originRepository));
  return organizationFinalClosureRepositoryIdentity(
    response,
    `GitHub origin repository during ${phase}`,
  );
}

async function assertOrganizationFinalClosureBindingStable(
  targetRoot,
  proof,
  phase,
) {
  const current = await loadGitHubOriginRepository(targetRoot);
  assertOrganizationFinalClosureOriginMatchesProof(current, proof, phase);
  const liveRepository = await loadCurrentOrganizationFinalClosureRepository(
    current.repository,
    phase,
  );
  if (
    liveRepository.full_name !== proof.repository.full_name ||
    liveRepository.id !== proof.repository.id ||
    liveRepository.node_id !== proof.repository.node_id ||
    liveRepository.default_branch !== proof.repository.default_branch
  ) {
    throw new Error(
      `GitHub origin repository identity or default branch changed during ${phase}; refusing bridge removal success.`,
    );
  }
  await assertPostCutoverAuditOrganizationPolicyStable(proof, phase);
  await assertPostCutoverAuditRepositoryLegacyPolicyClear(proof, phase);
  const afterMetadataRead = await loadGitHubOriginRepository(targetRoot);
  assertOrganizationFinalClosureOriginMatchesProof(
    afterMetadataRead,
    proof,
    phase,
  );
}

function assertOrganizationFinalClosureOriginMatchesProof(current, proof, phase) {
  if (
    current.repository.slug.toLowerCase() !==
    proof.originRepository.slug.toLowerCase()
  ) {
    throw new Error(
      `Git origin repository changed during ${phase}; refusing bridge removal success.`,
    );
  }
}

async function prepareConsumerWorktree({
  targetRoot,
  canonicalWorkflows,
  controlPlaneOwner,
  legacyBridge,
  removeLegacyBridge,
  finalClosureReceiptPath,
  expectedFinalClosureReceiptSha256,
  apply,
}) {
  const rootWitness = await assertLocalGitWorktree(targetRoot);
  const bridgeRemovalProof = removeLegacyBridge
    ? await loadAndBindOrganizationBridgeRemovalProof({
        targetRoot,
        receiptPath: finalClosureReceiptPath,
        expectedSha256: expectedFinalClosureReceiptSha256,
      })
    : null;
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
  const legacyBridgeWorkflowPath = join(
    targetRoot,
    ...DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH.split("/"),
  );
  const codeownersPath = join(targetRoot, ...DEFAULT_CODEOWNERS_PATH.split("/"));
  const currentVerifierWorkflow = await readOptionalRegularFile(
    verifierWorkflowPath,
  );
  const currentControllerWorkflow = await readOptionalRegularFile(
    controllerWorkflowPath,
  );
  const managesLegacyBridge = legacyBridge || removeLegacyBridge;
  if (managesLegacyBridge && canonicalWorkflows.legacyBridge === undefined) {
    throw new Error("Internal error: the selected bridge lifecycle lacks canonical bytes.");
  }
  const currentLegacyBridgeWorkflow = managesLegacyBridge
    ? await readOptionalRegularFile(legacyBridgeWorkflowPath)
    : null;
  if (removeLegacyBridge && currentLegacyBridgeWorkflow !== null) {
    validateCanonicalLegacyBridgeWorkflowContent(currentLegacyBridgeWorkflow);
    if (currentLegacyBridgeWorkflow !== canonicalWorkflows.legacyBridge) {
      throw new Error(
        `${DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH} differs from the exact canonical bridge bytes; refusing post-cutover removal.`,
      );
    }
  }
  const currentCodeowners = await readOptionalRegularFile(codeownersPath);
  const preparedCodeowners = ensureControlPlaneCodeownersContent(
    currentCodeowners,
    controlPlaneOwner,
  );
  const initialLocalSecurityState = await loadLocalInstallationSecurityState({
    targetRoot,
    canonicalWorkflowPaths: [
      verifierWorkflowPath,
      controllerWorkflowPath,
      ...(managesLegacyBridge ? [legacyBridgeWorkflowPath] : []),
    ],
  });
  await revalidateDirectoryChain(parentWitnesses, "after local workflow inspection");
  // Admission follows the fail-closed local workflow/object inspection so a
  // drifted or displaced bridge receives its local diagnostic without an
  // unrelated remote API dependency. It still precedes every mutation and
  // binds the receipt to the current GitHub object, not merely to a reusable
  // OWNER/REPO path: a repository can be deleted and recreated with the same
  // slug between proof production and this local cutover.
  if (bridgeRemovalProof !== null) {
    await assertOrganizationFinalClosureBindingStable(
      targetRoot,
      bridgeRemovalProof,
      "bridge-removal proof admission",
    );
  }

  const verifierChanged =
    currentVerifierWorkflow !== canonicalWorkflows.verifier;
  const controllerChanged =
    currentControllerWorkflow !== canonicalWorkflows.controller;
  const legacyBridgeChanged = legacyBridge
    ? currentLegacyBridgeWorkflow !== canonicalWorkflows.legacyBridge
    : removeLegacyBridge && currentLegacyBridgeWorkflow !== null;
  console.log(`Target worktree: ${targetRoot}`);
  console.log(`Verifier: ${DEFAULT_WORKFLOW_PATH}`);
  console.log(`Controller: ${DEFAULT_CONTROLLER_WORKFLOW_PATH}`);
  if (legacyBridge) {
    console.log(`Temporary legacy bridge: ${DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH}`);
  } else if (removeLegacyBridge) {
    console.log(
      `Post-cutover legacy bridge removal: ${DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH}`,
    );
    console.log(
      `Admitted bridge-removal proof: ${bridgeRemovalProof.repository.full_name} at ${bridgeRemovalProof.sha256}`,
    );
  }
  console.log(`Control plane: ${DEFAULT_CODEOWNERS_PATH} -> ${controlPlaneOwner}`);
  if (!verifierChanged) {
    console.log("No change: local verifier already matches the canonical v2 bytes.");
  }
  if (!controllerChanged) {
    console.log("No change: local controller already matches the canonical v2 bytes.");
  }
  if (legacyBridge && !legacyBridgeChanged) {
    console.log("No change: local temporary legacy bridge already matches the canonical bytes.");
  }
  if (removeLegacyBridge && !legacyBridgeChanged) {
    console.log("No change: local temporary legacy bridge is already absent.");
  }
  if (!preparedCodeowners.changed) {
    console.log("No change: local CODEOWNERS already has canonical final control-plane ownership.");
  }
  if (
    !verifierChanged &&
    !controllerChanged &&
    !legacyBridgeChanged &&
    !preparedCodeowners.changed
  ) {
    const finalNoopState = await loadLocalInstallationSecurityState({
      targetRoot,
      canonicalWorkflowPaths: [
        verifierWorkflowPath,
        controllerWorkflowPath,
        ...(managesLegacyBridge ? [legacyBridgeWorkflowPath] : []),
      ],
    });
    assertLocalInstallationSecurityStateStable(
      initialLocalSecurityState,
      finalNoopState,
      "no-op success readback",
    );
    if (bridgeRemovalProof !== null) {
      await assertOrganizationFinalClosureBindingStable(
        targetRoot,
        bridgeRemovalProof,
        "no-op success readback",
      );
    }
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
  const legacyBridgeAction = legacyBridge
    ? currentLegacyBridgeWorkflow === null
      ? "install the exact temporary legacy bridge workflow"
      : "replace the drifted temporary legacy bridge with canonical bytes"
    : "remove the exact temporary legacy bridge after verified legacy cleanup";
  if (!apply) {
    if (legacyBridgeChanged) {
      console.log(`Dry run: would ${legacyBridgeAction}.`);
    }
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
  const plannedChanges = [
    ...(preparedCodeowners.changed
      ? [{
          path: codeownersPath,
          content: preparedCodeowners.content,
          expectedContent: currentCodeowners,
          label: "CODEOWNERS",
        }]
      : []),
    ...(legacyBridge && legacyBridgeChanged
      ? [{
          path: legacyBridgeWorkflowPath,
          content: canonicalWorkflows.legacyBridge,
          expectedContent: currentLegacyBridgeWorkflow,
          label: "legacy-bridge-workflow",
        }]
      : []),
    ...(verifierChanged
      ? [{
          path: verifierWorkflowPath,
          content: canonicalWorkflows.verifier,
          expectedContent: currentVerifierWorkflow,
          label: "verifier-workflow",
        }]
      : []),
    ...(controllerChanged
      ? [{
          path: controllerWorkflowPath,
          content: canonicalWorkflows.controller,
          expectedContent: currentControllerWorkflow,
          label: "controller-workflow",
        }]
      : []),
    ...(removeLegacyBridge && legacyBridgeChanged
      ? [{
          path: legacyBridgeWorkflowPath,
          expectedContent: currentLegacyBridgeWorkflow,
          label: "legacy-bridge-removal",
          operation: "remove",
        }]
      : []),
  ];
  const expectedFinalLocalSecurityState = buildExpectedFinalLocalSecurityState({
    initialState: initialLocalSecurityState,
    targetRoot,
    verifierWorkflowPath,
    controllerWorkflowPath,
    legacyBridgeWorkflowPath: managesLegacyBridge
      ? legacyBridgeWorkflowPath
      : null,
    legacyBridgeContent: legacyBridge
      ? canonicalWorkflows.legacyBridge
      : null,
    codeownersContent: preparedCodeowners.content,
    verifierContent: canonicalWorkflows.verifier,
    controllerContent: canonicalWorkflows.controller,
  });
  const installedLabels = [];
  let initialLocalSecurityBoundaryComplete = false;
  const beforePlannedMutation = async (phase) => {
    // The initial local inventory can only be compared before the first
    // planned change: later checkpoints intentionally include prior applied
    // changes. The remote bridge-removal proof, however, must bind every
    // planned mutation boundary so a same-slug repository recreation or a
    // retargeted origin cannot authorize a later local change.
    if (!initialLocalSecurityBoundaryComplete) {
      const preMutationState = await loadLocalInstallationSecurityState({
        targetRoot,
        canonicalWorkflowPaths: [
          verifierWorkflowPath,
          controllerWorkflowPath,
          ...(managesLegacyBridge ? [legacyBridgeWorkflowPath] : []),
        ],
      });
      assertLocalInstallationSecurityStateStable(
        initialLocalSecurityState,
        preMutationState,
        "immediately before the first install mutation",
      );
      initialLocalSecurityBoundaryComplete = true;
    }
    if (bridgeRemovalProof !== null) {
      await assertOrganizationFinalClosureBindingStable(
        targetRoot,
        bridgeRemovalProof,
        phase,
      );
    }
  };
  const beforeLegacyBridgeQuarantineRename = async () => {
    await beforePlannedMutation(
      "immediately before legacy bridge quarantine rename",
    );
  };
  const beforeFinalLegacyBridgeQuarantineRename = async () => {
    await beforePlannedMutation(
      "immediately before legacy bridge quarantine rename",
    );
  };
  const beforeLegacyBridgeQuarantineUnlink = async () => {
    await beforePlannedMutation(
      "after legacy bridge quarantine rename and before unlink",
    );
  };
  try {
    for (const change of plannedChanges) {
      if (change.operation === "remove") {
        await removePreparedConsumerFile({
          ...change,
          parentWitnesses,
          beforeRemove: async () => {
            await beforePlannedMutation(
              "immediately before legacy bridge removal",
            );
          },
          beforeQuarantineRename: beforeLegacyBridgeQuarantineRename,
          beforeFinalQuarantineRename: beforeFinalLegacyBridgeQuarantineRename,
          beforeQuarantineUnlink: beforeLegacyBridgeQuarantineUnlink,
        });
      } else {
        await installPreparedConsumerFile({
          ...change,
          parentWitnesses,
          beforeRename: async () => {
            await beforePlannedMutation(
              `immediately before ${change.label} install rename`,
            );
          },
        });
      }
      installedLabels.push(change.label);
    }

    const finalLocalSecurityState = await loadLocalInstallationSecurityState({
      targetRoot,
      canonicalWorkflowPaths: [
        verifierWorkflowPath,
        controllerWorkflowPath,
        ...(managesLegacyBridge ? [legacyBridgeWorkflowPath] : []),
      ],
    });
    assertLocalInstallationSecurityStateStable(
      expectedFinalLocalSecurityState,
      finalLocalSecurityState,
      "final local apply success readback",
    );
  } catch (error) {
    if (installedLabels.length > 0) {
      throw buildPartialLocalApplyError(error, installedLabels, plannedChanges);
    }
    throw error;
  }

  try {
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
    if (legacyBridge) {
      const installedLegacyBridge = await readOptionalRegularFile(
        legacyBridgeWorkflowPath,
      );
      validateCanonicalLegacyBridgeWorkflowContent(installedLegacyBridge);
      if (
        !installedWorkflowMatchesCanonical(
          installedLegacyBridge,
          canonicalWorkflows.legacyBridge,
        )
      ) {
        throw new Error(
          "Local temporary legacy bridge failed exact-byte post-install verification.",
        );
      }
    } else if (
      removeLegacyBridge &&
      await readOptionalRegularFile(legacyBridgeWorkflowPath) !== null
    ) {
      throw new Error("Local temporary legacy bridge remains after post-cutover removal.");
    }
    const installedCodeowners = await readOptionalRegularFile(codeownersPath);
    validateControlPlaneCodeownersContent(installedCodeowners, controlPlaneOwner);
    if (installedCodeowners !== preparedCodeowners.content) {
      throw new Error("Local CODEOWNERS failed exact-byte post-install verification.");
    }
    await revalidateDirectoryChain(parentWitnesses, "after exact-byte verification");
    const successBoundaryState = await loadLocalInstallationSecurityState({
      targetRoot,
      canonicalWorkflowPaths: [
        verifierWorkflowPath,
        controllerWorkflowPath,
        ...(managesLegacyBridge ? [legacyBridgeWorkflowPath] : []),
      ],
    });
    assertLocalInstallationSecurityStateStable(
      expectedFinalLocalSecurityState,
      successBoundaryState,
      "immediately before local apply success",
    );
    if (bridgeRemovalProof !== null) {
      await assertOrganizationFinalClosureBindingStable(
        targetRoot,
        bridgeRemovalProof,
        "immediately before local apply success",
      );
    }
  } catch (error) {
    throw buildPartialLocalApplyError(error, installedLabels, plannedChanges);
  }
  if (verifierChanged) {
    console.log(`Applied: ${verifierAction}.`);
  }
  if (controllerChanged) {
    console.log(`Applied: ${controllerAction}.`);
  }
  if (legacyBridgeChanged) {
    console.log(`Applied: ${legacyBridgeAction}.`);
  }
  if (preparedCodeowners.changed) {
    console.log(`Applied: protect the control plane with ${controlPlaneOwner}.`);
  }
  if (legacyBridge) {
    console.log(
      "Next: review the target-repository diff, open one installation PR, obtain an independent exact-head control-plane-owner approval, and retain --legacy-bridge through disabled staging, activation, and legacy cleanup verification.",
    );
  } else if (removeLegacyBridge) {
    console.log(
      "Next: review the post-cutover diff and confirm ordinary strict validation rejects any remaining v1 caller before landing the removal.",
    );
  } else {
    console.log(
      "Next: review the target-repository diff, open one installation PR, and obtain an independent exact-head control-plane-owner approval.",
    );
  }
}

function buildPartialLocalApplyError(error, installedLabels, plannedChanges) {
  const remainingLabels = plannedChanges
    .map((change) => change.label)
    .filter((label) => !installedLabels.includes(label));
  const hasRemoval = plannedChanges.some((change) => change.operation === "remove");
  const completedVerb = hasRemoval ? "completed" : "installed";
  const pendingDescription = hasRemoval
    ? "were not completed or verified"
    : "were not installed or verified";
  return new Error(
    `${error.message}\nPartial local apply: ${completedVerb} ${installedLabels.join(", ") || "no completed target"}; ${remainingLabels.length > 0 ? `${remainingLabels.join(", ")} ${pendingDescription}` : "all planned mutations completed but the final security closure was not verified"}. Inspect the target-repository diff and rerun the helper; no rollback was claimed or attempted.`,
  );
}

async function installPreparedConsumerFile({
  path,
  content,
  expectedContent,
  parentWitnesses,
  label,
  beforeRename = async () => {},
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
    await beforeRename();
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

// Protected property: removal may unlink only the regular-file object admitted
// here by dev/ino identity and exact canonical UTF-8 content. Directory
// metadata churn is benign for that property. The fixed workflow path is first
// atomically renamed into a fresh task-owned quarantine directory; identity and
// content are then rebound at the unpredictable quarantine path before unlink.
// A replacement won by the fixed-path rename is quarantined but never unlinked.
// Node does not expose unlinkat against an already-open file descriptor, so the
// final quarantine check and path-based unlink remain a best-effort boundary
// under the existing same-UID non-interference assumption.
// The remote authorization is a point-in-time property: the GitHub repository
// identity/default branch and origin binding are fully revalidated after the
// quarantine rename and before unlink. A final local identity/content check
// follows that remote read, so remote I/O cannot weaken the admitted file-object
// property. This detects observed drift through those boundaries; it does not
// claim a continuous lock against a same-UID rewrite after the final checks.
async function removePreparedConsumerFile({
  path,
  expectedContent,
  parentWitnesses,
  label,
  beforeRemove = async () => {},
  beforeQuarantineRename = async () => {},
  beforeFinalQuarantineRename = async () => {},
  beforeQuarantineUnlink = async () => {},
}) {
  const admittedIdentity = await readConsumerFileIdentity(
    path,
    label,
    expectedContent,
  );
  let quarantineDirectory = null;
  let quarantineDirectoryWitness = null;
  let quarantinePath = null;
  let renameCompleted = false;
  let quarantineVerified = false;
  let unlinkCompleted = false;
  let quarantineDirectoryRemoved = false;
  let restorationAttempted = false;
  try {
    await revalidateDirectoryChain(parentWitnesses, `before ${label} removal`);
    await assertConsumerFileIdentityStable(
      admittedIdentity,
      path,
      `before ${label} removal`,
    );
    await assertConsumerFileContentStable(path, expectedContent, label);
    await beforeRemove();
    await revalidateDirectoryChain(
      parentWitnesses,
      `before ${label} quarantine`,
    );
    await assertConsumerFileIdentityStable(
      admittedIdentity,
      path,
      `before ${label} quarantine`,
    );
    await assertConsumerFileContentStable(path, expectedContent, label);

    quarantineDirectory = await mkdtemp(
      join(dirname(path), ".codex-review-gate-removal-"),
    );
    quarantineDirectoryWitness = await readDirectoryWitness(
      quarantineDirectory,
      `${label} quarantine`,
    );
    quarantinePath = join(quarantineDirectory, "canonical-legacy-bridge.yml");
    await revalidateDirectoryChain(
      parentWitnesses,
      `after ${label} quarantine creation`,
    );
    await assertConsumerFileIdentityStable(
      admittedIdentity,
      path,
      `immediately before ${label} quarantine rename`,
    );
    await assertConsumerFileContentStable(path, expectedContent, label);
    await beforeQuarantineRename();
    await revalidateDirectoryChain(
      parentWitnesses,
      `after ${label} quarantine authorization revalidation`,
    );
    await assertConsumerFileIdentityStable(
      admittedIdentity,
      path,
      `after ${label} quarantine authorization revalidation`,
    );
    await assertConsumerFileContentStable(path, expectedContent, label);
    await beforeFinalQuarantineRename();
    // The authorization check above can perform remote I/O. Rebind the local
    // object after it returns; inode/content (rather than incidental stat
    // fields) are the protected local property immediately before rename.
    await revalidateDirectoryChain(
      parentWitnesses,
      `after final ${label} quarantine authorization revalidation`,
    );
    await assertConsumerFileIdentityStable(
      admittedIdentity,
      path,
      `after final ${label} quarantine authorization revalidation`,
    );
    await assertConsumerFileContentStable(path, expectedContent, label);
    await rename(path, quarantinePath);
    renameCompleted = true;

    await revalidateDirectoryWitness(
      quarantineDirectoryWitness,
      `after ${label} quarantine rename`,
    );
    await revalidateDirectoryChain(
      parentWitnesses,
      `after ${label} quarantine rename`,
    );
    await assertConsumerFileIdentityStable(
      admittedIdentity,
      quarantinePath,
      `after ${label} quarantine rename`,
    );
    await assertConsumerFileContentStable(
      quarantinePath,
      expectedContent,
      `${label} quarantine`,
    );
    quarantineVerified = true;

    await revalidateDirectoryWitness(
      quarantineDirectoryWitness,
      `before ${label} quarantine authorization revalidation`,
    );
    await assertConsumerFileIdentityStable(
      admittedIdentity,
      quarantinePath,
      `before ${label} quarantine authorization revalidation`,
    );
    await assertConsumerFileContentStable(
      quarantinePath,
      expectedContent,
      `${label} quarantine`,
    );
    try {
      // Recheck remote target identity only after the quarantined object's
      // identity/content have been observed. The post-I/O local check below
      // then detects a concurrent local replacement before unlink.
      await beforeQuarantineUnlink();
    } catch (authorizationError) {
      restorationAttempted = true;
      try {
        await restoreQuarantinedConsumerFile({
          path,
          quarantinePath,
          quarantineDirectory,
          quarantineDirectoryWitness,
          admittedIdentity,
          expectedContent,
          parentWitnesses,
          label,
        });
        quarantineDirectoryRemoved = true;
      } catch (restoreError) {
        throw new Error(
          `${authorizationError.message}\nFail-closed restoration of the admitted bridge did not complete: ${restoreError.message} The canonical destination was never overwritten; inspect both ${path} and ${quarantinePath}. No further path cleanup was attempted.`,
        );
      }
      throw new Error(
        `${authorizationError.message}\nThe admitted exact bridge remains installed at ${path}; it was atomically restored without overwriting any concurrent destination, and no removal success was reported.`,
      );
    }
    await revalidateDirectoryWitness(
      quarantineDirectoryWitness,
      `before ${label} quarantine unlink`,
    );
    await assertConsumerFileIdentityStable(
      admittedIdentity,
      quarantinePath,
      `before ${label} quarantine unlink`,
    );
    await assertConsumerFileContentStable(
      quarantinePath,
      expectedContent,
      `${label} quarantine`,
    );
    await unlink(quarantinePath);
    unlinkCompleted = true;
    await revalidateDirectoryWitness(
      quarantineDirectoryWitness,
      `after ${label} quarantine unlink`,
    );
    await revalidateDirectoryChain(parentWitnesses, `after ${label} unlink`);
    await rmdir(quarantineDirectory);
    quarantineDirectoryRemoved = true;
    await revalidateDirectoryChain(
      parentWitnesses,
      `after ${label} quarantine removal`,
    );
  } catch (error) {
    let failure = error;
    try {
      await admittedIdentity.handle.close();
    } catch (closeError) {
      failure = new Error(
        `${error.message}\nUnable to close the admitted bridge handle after failure: ${closeError.message}`,
      );
    }
    if (restorationAttempted) {
      throw failure;
    }
    if (unlinkCompleted) {
      const quarantineDisposition = quarantineDirectoryRemoved
        ? "The task-owned quarantine directory was removed."
        : `An empty quarantine directory may remain at ${quarantineDirectory}.`;
      throw new Error(
        `${failure.message}\nThe admitted exact bridge unlink completed before the checkpoint mismatch was detected; no success was reported. ${quarantineDisposition} Inspect the intended target and any concurrently substituted parent.`,
      );
    }
    if (renameCompleted) {
      throw new Error(
        `${failure.message}\n${quarantineVerified ? "The admitted exact bridge remains" : "An unverified replacement remains"} quarantined at ${quarantinePath}; it was not unlinked and no rollback or success was reported.`,
      );
    }
    if (quarantineDirectory !== null) {
      throw new Error(
        `${failure.message}\nNo workflow object was unlinked. An empty task-owned quarantine directory may remain at ${quarantineDirectory}; no path-based cleanup was attempted after failure.`,
      );
    }
    throw failure;
  }
  await admittedIdentity.handle.close();
}

// Recovery property: a remote-authorization failure after quarantine must
// leave the admitted exact bridge installed at its canonical path. link(2)
// creates that path only when absent, so a concurrent destination is never
// overwritten. dev/ino and exact content bind both hard links to the admitted
// object before the quarantine link is removed. Directory entry churn alone is
// not treated as mutation; only object identity, content, or access policy is.
async function restoreQuarantinedConsumerFile({
  path,
  quarantinePath,
  quarantineDirectory,
  quarantineDirectoryWitness,
  admittedIdentity,
  expectedContent,
  parentWitnesses,
  label,
}) {
  await revalidateDirectoryWitness(
    quarantineDirectoryWitness,
    `before fail-closed ${label} restoration`,
  );
  await revalidateDirectoryChain(
    parentWitnesses,
    `before fail-closed ${label} restoration`,
  );
  await assertConsumerFileIdentityStable(
    admittedIdentity,
    quarantinePath,
    `before fail-closed ${label} restoration`,
  );
  await assertConsumerFileContentStable(
    quarantinePath,
    expectedContent,
    `${label} quarantine`,
  );

  try {
    await link(quarantinePath, path);
  } catch (error) {
    throw new Error(
      `Unable to atomically restore ${label} without overwriting the canonical path: ${error.message}`,
    );
  }

  await revalidateDirectoryWitness(
    quarantineDirectoryWitness,
    `after fail-closed ${label} restore link`,
  );
  await revalidateDirectoryChain(
    parentWitnesses,
    `after fail-closed ${label} restore link`,
  );
  await assertConsumerFileIdentityStable(
    admittedIdentity,
    path,
    `after fail-closed ${label} restore link`,
  );
  await assertConsumerFileContentStable(path, expectedContent, label);
  await assertConsumerFileIdentityStable(
    admittedIdentity,
    quarantinePath,
    `before removing the ${label} quarantine link`,
  );
  await assertConsumerFileContentStable(
    quarantinePath,
    expectedContent,
    `${label} quarantine`,
  );

  await unlink(quarantinePath);
  await revalidateDirectoryWitness(
    quarantineDirectoryWitness,
    `after removing the ${label} quarantine link`,
  );
  await revalidateDirectoryChain(
    parentWitnesses,
    `after removing the ${label} quarantine link`,
  );
  await assertConsumerFileIdentityStable(
    admittedIdentity,
    path,
    `after fail-closed ${label} restoration`,
  );
  await assertConsumerFileContentStable(path, expectedContent, label);
  await rmdir(quarantineDirectory);
  await revalidateDirectoryChain(
    parentWitnesses,
    `after fail-closed ${label} quarantine cleanup`,
  );
  await assertConsumerFileIdentityStable(
    admittedIdentity,
    path,
    `after fail-closed ${label} quarantine cleanup`,
  );
  await assertConsumerFileContentStable(path, expectedContent, label);
}

// Object identity, not metadata stability, is the selected file property for
// removal. dev/ino binds the admitted filesystem object. Content is checked
// separately at every boundary. Mode/uid/gid and timestamps are deliberately
// not compared because they do not prove replacement or content mutation and
// the containing directory controls unlink access.
async function readConsumerFileIdentity(path, label, expectedContent) {
  let handle;
  try {
    handle = await open(
      path,
      fileSystemConstants.O_RDONLY | (fileSystemConstants.O_NOFOLLOW ?? 0),
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`${label} is missing before removal: ${path}`);
    }
    throw new Error(`Unable to open ${label} before removal: ${path}: ${error.message}`);
  }

  try {
    const [metadata, pathMetadata] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(path, { bigint: true }),
    ]);
    if (
      !metadata.isFile() ||
      !pathMetadata.isFile() ||
      pathMetadata.isSymbolicLink()
    ) {
      throw new Error(`Refusing to remove non-regular ${label}: ${path}`);
    }
    if (metadata.dev !== pathMetadata.dev || metadata.ino !== pathMetadata.ino) {
      throw new Error(
        `${label} object identity changed while opening it for removal: ${path}`,
      );
    }
    const bytes = await handle.readFile();
    const content = bytes.toString("utf8");
    if (!Buffer.from(content, "utf8").equals(bytes)) {
      throw new Error(`Refusing to remove non-UTF-8 ${label}: ${path}`);
    }
    if (content !== expectedContent) {
      throw new Error(
        `${label} changed after local preparation; refusing to remove non-canonical content.`,
      );
    }
    return { dev: metadata.dev, ino: metadata.ino, handle };
  } catch (error) {
    try {
      await handle.close();
    } catch (closeError) {
      throw new Error(
        `${error.message}\nUnable to close the rejected bridge handle: ${closeError.message}`,
      );
    }
    throw error;
  }
}

async function assertConsumerFileIdentityStable(expected, path, phase) {
  let metadata;
  try {
    metadata = await lstat(path, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Admitted bridge object is missing during ${phase}: ${path}`);
    }
    throw new Error(
      `Unable to revalidate the admitted bridge object during ${phase}: ${path}: ${error.message}`,
    );
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(
      `Admitted bridge object is no longer a regular file during ${phase}: ${path}`,
    );
  }
  if (metadata.dev !== expected.dev || metadata.ino !== expected.ino) {
    throw new Error(
      `Admitted bridge object identity changed during ${phase}: ${path}`,
    );
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

async function loadLocalInstallationSecurityState({
  targetRoot,
  canonicalWorkflowPaths,
}) {
  const lowerPrecedenceCodeowners = await findLowerPrecedenceCodeowners(targetRoot);
  if (lowerPrecedenceCodeowners !== null) {
    throw new Error(
      `${lowerPrecedenceCodeowners} is a lower-precedence CODEOWNERS file. ${DEFAULT_CODEOWNERS_PATH} would shadow or already shadows it; merge its entries into ${DEFAULT_CODEOWNERS_PATH}, remove the lower-precedence file in the same installation PR, then rerun the helper.`,
    );
  }
  const workflowsDirectory = join(targetRoot, ".github", "workflows");
  const canonicalPaths = new Set(canonicalWorkflowPaths);
  const entries = await readdir(workflowsDirectory, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  const workflowFiles = [];
  const conflicts = [];
  for (const entry of entries) {
    if (!/\.ya?ml$/.test(entry.name)) {
      continue;
    }
    const absolutePath = join(workflowsDirectory, entry.name);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`Cannot safely inspect non-regular workflow: ${absolutePath}`);
    }
    const content = await readFile(absolutePath, "utf8");
    const relativePath = absolutePath.slice(targetRoot.length + 1);
    workflowFiles.push({
      path: relativePath,
      content_sha256: fingerprintText(content),
    });
    if (canonicalPaths.has(absolutePath)) {
      continue;
    }
    const violations = [];
    if (workflowContainsCodexReviewGateCaller(content)) {
      violations.push("gate caller");
    }
    violations.push(...workflowSingleProducerPolicyViolations(content));
    if (violations.length > 0) {
      conflicts.push(
        `${relativePath} (${violations.join(", ")})`,
      );
    }
  }
  if (conflicts.length > 0) {
    throw new Error(
      `Additional workflows have a v1/v2 gate caller, reserved CheckRun name, or relevant write authority and require explicit removal or review in the same installation PR: ${conflicts.sort().join(", ")}`,
    );
  }
  const codeownersContent = await readOptionalRegularFile(
    join(targetRoot, ...DEFAULT_CODEOWNERS_PATH.split("/")),
  );
  return {
    lower_precedence_codeowners: null,
    codeowners_sha256: codeownersContent === null
      ? null
      : fingerprintText(codeownersContent),
    workflows: workflowFiles.sort((left, right) => left.path.localeCompare(right.path)),
  };
}

function buildExpectedFinalLocalSecurityState({
  initialState,
  targetRoot,
  verifierWorkflowPath,
  controllerWorkflowPath,
  legacyBridgeWorkflowPath,
  codeownersContent,
  verifierContent,
  controllerContent,
  legacyBridgeContent,
}) {
  const workflows = new Map(
    initialState.workflows.map((file) => [file.path, file.content_sha256]),
  );
  workflows.set(
    verifierWorkflowPath.slice(targetRoot.length + 1),
    fingerprintText(verifierContent),
  );
  workflows.set(
    controllerWorkflowPath.slice(targetRoot.length + 1),
    fingerprintText(controllerContent),
  );
  if (legacyBridgeWorkflowPath !== null) {
    const relativeBridgePath = legacyBridgeWorkflowPath.slice(
      targetRoot.length + 1,
    );
    if (legacyBridgeContent === null) {
      workflows.delete(relativeBridgePath);
    } else {
      workflows.set(relativeBridgePath, fingerprintText(legacyBridgeContent));
    }
  }
  return {
    lower_precedence_codeowners: null,
    codeowners_sha256: fingerprintText(codeownersContent),
    workflows: [...workflows.entries()]
      .map(([path, content_sha256]) => ({ path, content_sha256 }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
}

function assertLocalInstallationSecurityStateStable(expected, current, phase) {
  if (canonicalSecurityJson(expected) !== canonicalSecurityJson(current)) {
    throw new Error(
      `Local workflow/CODEOWNERS security inventory changed during ${phase}; refusing to continue or report success.`,
    );
  }
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
