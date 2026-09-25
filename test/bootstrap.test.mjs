import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CANONICAL_V2_WORKFLOW_USES,
  DEFAULT_CONTROLLER_WORKFLOW_PATH,
  DEFAULT_CONTROL_PLANE_OWNER,
  DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH,
  DEFAULT_RULESET_PROFILE,
  DEFAULT_STATUS_CONTEXT,
  DEFAULT_STATUS_INTEGRATION_ID,
  DEFAULT_VERIFIER_RUN_NAME,
  DEFAULT_VERIFIER_RUN_NAME_PREFIX,
  DEFAULT_WORKFLOW_PATH,
  LEGACY_ORGANIZATION_FINAL_CLOSURE_COHORT_SIZE,
  LEGACY_STATUS_CONTEXT,
  ORGANIZATION_FINAL_CLOSURE_COHORT_SIZE,
  RULESET_PROFILE_FULL,
  RULESET_PROFILE_STATUS_ONLY,
  SOURCE_BRIDGE_REMOVAL_PROOF_OUTPUT_SCHEMA_VERSION,
  SOURCE_BRIDGE_REMOVAL_PROOF_SCHEMA_VERSION,
  SOURCE_SELF_HOSTING_REPOSITORY_SLUG,
  SOURCE_SELF_HOSTING_RULESET_NAME,
  SOURCE_SELF_HOSTING_RETAINED_RULESET_ID,
  SOURCE_SELF_HOSTING_RETAINED_RULESET_NAME,
  assertSourceSelfHostingRetainedRulesetPolicy,
  assertCompleteRulesetApiObject,
  assertDirectoryWitnessStable,
  buildCreateRulesetPayload,
  canonicalOrganizationFinalClosureReceipt,
  canonicalSourceBridgeRemovalProof,
  canonicalSourceBridgeRemovalProofOutput,
  canonicalLegacyReviewGateInventoryBytes,
  buildUpdateRulesetPayload,
  codeownersHasEffectiveUnmanagedPatterns,
  decodeGitHubBlobContent,
  decodeGitHubFileContent,
  directoryWitnessFromMetadata,
  ensureControlPlaneCodeownersContent,
  ensureGatePolicyInRules,
  ensureNonFastForwardPolicyInRules,
  ensurePullRequestPolicyInRules,
  ensureStatusContextInRules,
  findEffectiveRulesetWithGatePolicy,
  findEffectiveRulesetWithProfilePolicy,
  findEffectiveRulesetWithStatusOnlyPolicy,
  findEffectiveRulesetWithStatusContext,
  installedWorkflowMatchesCanonical,
  isLegacyStatusContext,
  normalizeControlPlaneOwner,
  normalizeRulesetProfile,
  normalizeWorkflowPath,
  organizationFinalClosurePlanSha256,
  parseGitHubRepositoryRemote,
  parseRepoSlug,
  requiredStatusCheckContexts,
  rulesetCoversDefaultBranch,
  rulesetHasGatePolicy,
  rulesetHasNonFastForwardPolicy,
  rulesetHasPolicyForProfile,
  rulesetHasRequiredPullRequestPolicy,
  rulesetHasRequiredStatusContext,
  rulesetHasStatusOnlyPolicy,
  rulesetHasStatusOnlyProfile,
  rulesetWritableFingerprint,
  sourceBridgeRemovalLegacyInventorySha256,
  sourceBridgeRemovalProofSha256,
  sourceBridgeRemovalRulesetWritableSha256,
  sourceBridgeRemovalSecurityStateSha256,
  validateCanonicalV2WorkflowContent,
  validateCanonicalV2ControllerWorkflowContent,
  validateCanonicalV2WorkflowInventory,
  validateCanonicalLegacyBridgeWorkflowContent,
  validateControlPlaneCodeownersContent,
  validateOrganizationFinalClosureOutput,
  validateSourceBridgeRemovalProof,
  validateSourceBridgeRemovalProofOutput,
  workflowCanWriteStatuses,
  workflowContainsCodexReviewGateCaller,
  workflowContainsLegacyV1Caller,
  workflowContentEndpoint,
  workflowSingleProducerPolicyViolations,
} from "../src/bootstrap.mjs";

const BOOTSTRAP_SCRIPT = fileURLToPath(
  new URL("../scripts/bootstrap-codex-review-gate.mjs", import.meta.url),
);
const CANONICAL_WORKFLOW = readFileSync(
  new URL(
    "../templates/codex-gated-repo/.github/workflows/codex-review-gate.yml",
    import.meta.url,
  ),
  "utf8",
);
const CANONICAL_CONTROLLER_WORKFLOW = readFileSync(
  new URL(
    "../templates/codex-gated-repo/.github/workflows/codex-review-gate-controller.yml",
    import.meta.url,
  ),
  "utf8",
);
const CANONICAL_LEGACY_BRIDGE_WORKFLOW = readFileSync(
  new URL(
    "../templates/codex-gated-repo/.github/workflows/codex-review-gate-legacy-bridge.yml",
    import.meta.url,
  ),
  "utf8",
);
const CANONICAL_WORKFLOWS = {
  verifier: CANONICAL_WORKFLOW,
  controller: CANONICAL_CONTROLLER_WORKFLOW,
};
const CANONICAL_WORKFLOWS_WITH_LEGACY_BRIDGE = {
  ...CANONICAL_WORKFLOWS,
  legacyBridge: CANONICAL_LEGACY_BRIDGE_WORKFLOW,
};
const DEFAULT_BRANCH_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CANARY_HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";
const CANARY_REPOSITORY_ID = 1234;
const CANARY_RUN_ID = 9007;
const CANARY_WORKFLOW_ID = 17;
const CANARY_JOB_ID = 18017;
const CANARY_CHECK_RUN_ID = 28017;
const CANARY_MERGE_SHA = "fedcba9876543210fedcba9876543210fedcba98";
const HISTORICAL_SOURCE_CANARY_BASE_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const EMPTY_CLASSIC_REQUIRED_STATUS_CHECKS = Object.freeze({
  strict: true,
  contexts: [],
  checks: [],
});
const EXPECTED_LEGACY_INVENTORY_FIXTURE_KEY =
  "__test_expected_legacy_inventory_approval";

test("builds a disabled complete default-branch ruleset payload", () => {
  const payload = buildCreateRulesetPayload();

  assert.equal(payload.name, "Must Pass Codex Review");
  assert.equal(payload.target, "branch");
  assert.equal(payload.enforcement, "disabled");
  assert.deepEqual(payload.bypass_actors, []);
  assert.deepEqual(payload.conditions, {
    ref_name: {
      include: ["~DEFAULT_BRANCH"],
      exclude: [],
    },
  });
  assert.deepEqual(payload.rules, [
    {
      type: "pull_request",
      parameters: {
        dismiss_stale_reviews_on_push: true,
        require_code_owner_review: true,
        require_last_push_approval: false,
        required_approving_review_count: 0,
        required_review_thread_resolution: true,
      },
    },
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: true,
        required_status_checks: [
          {
            context: DEFAULT_STATUS_CONTEXT,
            integration_id: DEFAULT_STATUS_INTEGRATION_ID,
          },
        ],
      },
    },
    { type: "non_fast_forward" },
  ]);
});

test("builds exact disabled and active status-only ruleset payloads", () => {
  const disabled = buildCreateRulesetPayload({
    profile: RULESET_PROFILE_STATUS_ONLY,
  });
  const expected = {
    name: "Must Pass Codex Review",
    target: "branch",
    enforcement: "disabled",
    bypass_actors: [],
    conditions: {
      ref_name: {
        include: ["~DEFAULT_BRANCH"],
        exclude: [],
      },
    },
    rules: [
      {
        type: "required_status_checks",
        parameters: {
          do_not_enforce_on_create: false,
          strict_required_status_checks_policy: true,
          required_status_checks: [
            {
              context: DEFAULT_STATUS_CONTEXT,
              integration_id: DEFAULT_STATUS_INTEGRATION_ID,
            },
          ],
        },
      },
    ],
  };

  assert.deepEqual(disabled, expected);
  assert.deepEqual(
    buildCreateRulesetPayload({
      profile: RULESET_PROFILE_STATUS_ONLY,
      enforcement: "active",
    }),
    { ...expected, enforcement: "active" },
  );
  assert.throws(
    () =>
      buildCreateRulesetPayload({
        profile: RULESET_PROFILE_STATUS_ONLY,
        enforcement: "evaluate",
      }),
    /must be disabled or active/u,
  );
  assert.throws(
    () =>
      buildCreateRulesetPayload({
        profile: RULESET_PROFILE_STATUS_ONLY,
        context: "ci/test",
      }),
    /require the codex\/github-review-gate status context/u,
  );
  assert.throws(
    () =>
      buildCreateRulesetPayload({
        profile: RULESET_PROFILE_STATUS_ONLY,
        strict: false,
      }),
    /require strict required status checks/u,
  );
  assert.throws(
    () =>
      buildCreateRulesetPayload({
        profile: RULESET_PROFILE_STATUS_ONLY,
        doNotEnforceOnCreate: true,
      }),
    /require do_not_enforce_on_create to be false/u,
  );
});

test("recognizes and selects only exact active status-only profiles", () => {
  const active = buildCreateRulesetPayload({
    profile: RULESET_PROFILE_STATUS_ONLY,
    enforcement: "active",
  });
  const extraRule = structuredClone(active);
  extraRule.rules.push({ type: "deletion" });
  const extraContext = structuredClone(active);
  extraContext.rules[0].parameters.required_status_checks.push({
    context: "ci/test",
    integration_id: DEFAULT_STATUS_INTEGRATION_ID,
  });
  const bypass = structuredClone(active);
  bypass.bypass_actors.push({
    actor_id: 1,
    actor_type: "RepositoryRole",
    bypass_mode: "always",
  });
  const broaderConditions = structuredClone(active);
  broaderConditions.conditions.ref_name.include = ["~ALL"];
  const evaluated = { ...active, enforcement: "evaluate" };
  const legacyApiShape = structuredClone(active);
  delete legacyApiShape.rules[0].parameters.do_not_enforce_on_create;
  const doNotEnforce = structuredClone(active);
  doNotEnforce.rules[0].parameters.do_not_enforce_on_create = true;

  assert.equal(rulesetHasStatusOnlyPolicy(active), true);
  assert.equal(rulesetHasStatusOnlyProfile(active), true);
  assert.equal(
    rulesetHasStatusOnlyPolicy(legacyApiShape),
    true,
    "an older readback that omits the false default is semantically exact",
  );
  assert.equal(
    rulesetHasPolicyForProfile(active, RULESET_PROFILE_STATUS_ONLY),
    true,
  );
  for (const candidate of [extraRule, extraContext, bypass, doNotEnforce]) {
    assert.equal(rulesetHasStatusOnlyPolicy(candidate), false);
    assert.equal(rulesetHasStatusOnlyProfile(candidate), false);
  }
  assert.equal(rulesetHasStatusOnlyPolicy(broaderConditions), true);
  assert.equal(rulesetHasStatusOnlyProfile(broaderConditions), false);
  assert.equal(rulesetHasStatusOnlyPolicy(evaluated), true);
  assert.equal(rulesetHasStatusOnlyProfile(evaluated), false);
  assert.equal(
    findEffectiveRulesetWithStatusOnlyPolicy(
      [extraRule, extraContext, bypass, broaderConditions, active],
      DEFAULT_STATUS_CONTEXT,
      { defaultBranch: "master" },
    ),
    active,
  );
  assert.equal(
    findEffectiveRulesetWithProfilePolicy(
      [extraRule, extraContext, bypass, broaderConditions, active],
      RULESET_PROFILE_STATUS_ONLY,
      DEFAULT_STATUS_CONTEXT,
      { defaultBranch: "master" },
    ),
    active,
  );
});

test("updates exact status-only profiles idempotently and fails closed on drift", () => {
  const disabled = buildCreateRulesetPayload({
    profile: RULESET_PROFILE_STATUS_ONLY,
  });
  const omittedFalseDefault = structuredClone(disabled);
  delete omittedFalseDefault.rules[0].parameters.do_not_enforce_on_create;
  const before = structuredClone(disabled);
  const idempotent = buildUpdateRulesetPayload(disabled, {
    profile: RULESET_PROFILE_STATUS_ONLY,
    defaultBranch: "master",
  });
  const activated = buildUpdateRulesetPayload(disabled, {
    profile: RULESET_PROFILE_STATUS_ONLY,
    enforcement: "active",
  });
  const activeIdempotent = buildUpdateRulesetPayload(activated.payload, {
    profile: RULESET_PROFILE_STATUS_ONLY,
  });
  const deactivated = buildUpdateRulesetPayload(activated.payload, {
    profile: RULESET_PROFILE_STATUS_ONLY,
    enforcement: "disabled",
  });

  assert.equal(idempotent.changed, false);
  assert.deepEqual(idempotent.payload, disabled);
  assert.equal(
    rulesetWritableFingerprint(disabled, {
      profile: RULESET_PROFILE_STATUS_ONLY,
    }),
    rulesetWritableFingerprint(omittedFalseDefault, {
      profile: RULESET_PROFILE_STATUS_ONLY,
    }),
    "the API's omitted false default is equivalent only for status-only readback",
  );
  assert.equal(
    buildUpdateRulesetPayload(omittedFalseDefault, {
      profile: RULESET_PROFILE_STATUS_ONLY,
    }).changed,
    false,
  );
  assert.deepEqual(disabled, before, "status-only update must not mutate its input");
  assert.equal(activated.changed, true);
  assert.equal(activated.payload.enforcement, "active");
  assert.equal(activeIdempotent.changed, false);
  assert.equal(deactivated.changed, true);
  assert.equal(deactivated.payload.enforcement, "disabled");

  const full = buildCreateRulesetPayload();
  const extraContext = structuredClone(disabled);
  extraContext.rules[0].parameters.required_status_checks.push({
    context: "ci/test",
    integration_id: DEFAULT_STATUS_INTEGRATION_ID,
  });
  const bypass = structuredClone(disabled);
  bypass.bypass_actors.push({
    actor_id: 1,
    actor_type: "RepositoryRole",
    bypass_mode: "always",
  });
  for (const candidate of [full, extraContext, bypass]) {
    const candidateBefore = structuredClone(candidate);
    assert.throws(
      () =>
        buildUpdateRulesetPayload(candidate, {
          profile: RULESET_PROFILE_STATUS_ONLY,
          enforcement: "active",
        }),
      /not an exact status-only profile; refusing to remove or rewrite additional protections/u,
    );
    assert.deepEqual(candidate, candidateBefore);
  }
});

test("defaults profile-aware builders and predicates to the unchanged full gate", () => {
  const defaultPayload = buildCreateRulesetPayload();
  const explicitFullPayload = buildCreateRulesetPayload({
    profile: RULESET_PROFILE_FULL,
  });
  const activeFull = { ...defaultPayload, enforcement: "active" };
  const defaultUpdate = buildUpdateRulesetPayload(activeFull);
  const explicitFullUpdate = buildUpdateRulesetPayload(activeFull, {
    profile: RULESET_PROFILE_FULL,
  });

  assert.equal(DEFAULT_RULESET_PROFILE, RULESET_PROFILE_FULL);
  assert.equal(normalizeRulesetProfile(), RULESET_PROFILE_FULL);
  assert.equal(
    normalizeRulesetProfile(RULESET_PROFILE_STATUS_ONLY),
    RULESET_PROFILE_STATUS_ONLY,
  );
  assert.throws(() => normalizeRulesetProfile("legacy"), /must be "full" or "status-only"/u);
  assert.equal(JSON.stringify(defaultPayload), JSON.stringify(explicitFullPayload));
  assert.equal(rulesetHasGatePolicy(activeFull), true);
  assert.equal(
    rulesetHasPolicyForProfile(activeFull, RULESET_PROFILE_FULL),
    true,
  );
  assert.equal(defaultUpdate.changed, false);
  assert.deepEqual(defaultUpdate, explicitFullUpdate);
  assert.equal(
    findEffectiveRulesetWithProfilePolicy(
      [activeFull],
      RULESET_PROFILE_FULL,
      DEFAULT_STATUS_CONTEXT,
      { defaultBranch: "master" },
    ),
    activeFull,
  );
});

test("reserves the status-only profile for the source self-hosting remote migration", () => {
  for (const [name, args, expected] of [
    [
      "local install",
      [
        "--prepare-worktree",
        "/definitely-not-a-worktree",
        "--ruleset-profile",
        RULESET_PROFILE_STATUS_ONLY,
      ],
      /remote-only/u,
    ],
    [
      "ordinary remote consumer",
      [
        "--repo",
        "Joey-Tools/consumer",
        "--ruleset-profile",
        RULESET_PROFILE_STATUS_ONLY,
      ],
      /reserved for the Joey-Tools\/codex-review-gate source self-hosting migration/u,
    ],
    [
      "unknown profile",
      [
        "--repo",
        "Joey-Tools/codex-review-gate",
        "--ruleset-profile",
        "unexpected",
      ],
      /must be "full" or "status-only"/u,
    ],
    [
      "source remote without legacy bridge",
      [
        "--repo",
        "Joey-Tools/codex-review-gate",
        "--ruleset-profile",
        RULESET_PROFILE_STATUS_ONLY,
      ],
      /status-only requires --legacy-bridge/u,
    ],
  ]) {
    const result = runBootstrap(args, {
      addExpectedLegacyInventoryDigest: false,
    });
    assert.equal(result.status, 1, `${name}: ${result.stderr}`);
    assert.match(result.stderr, expected, name);
  }
});

test("ruleset writable fingerprints ignore response-only fields but bind every writable field", () => {
  const payload = buildCreateRulesetPayload();
  const first = {
    id: 7,
    source_type: "Repository",
    ...payload,
  };
  const sameWritableFields = {
    rules: structuredClone(payload.rules),
    conditions: {
      ref_name: {
        exclude: [],
        include: ["~DEFAULT_BRANCH"],
      },
    },
    bypass_actors: [],
    enforcement: payload.enforcement,
    target: payload.target,
    name: payload.name,
    id: 8,
    source_type: "Organization",
  };
  assert.equal(
    rulesetWritableFingerprint(first),
    rulesetWritableFingerprint(sameWritableFields),
  );
  assert.notEqual(
    rulesetWritableFingerprint(first),
    rulesetWritableFingerprint({ ...sameWritableFields, enforcement: "active" }),
  );
});

test("adds codex status context while preserving existing checks", () => {
  const existingRules = [
    {
      id: 1,
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: false,
        do_not_enforce_on_create: false,
        required_status_checks: [
          { context: "test", integration_id: 15368 },
        ],
      },
    },
    {
      id: 2,
      type: "pull_request",
      parameters: { required_review_thread_resolution: true },
    },
  ];

  const { changed, rules } = ensureStatusContextInRules(existingRules);

  assert.equal(changed, true);
  assert.deepEqual(rules, [
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: true,
        do_not_enforce_on_create: false,
        required_status_checks: [
          { context: "test", integration_id: 15368 },
          {
            context: DEFAULT_STATUS_CONTEXT,
            integration_id: DEFAULT_STATUS_INTEGRATION_ID,
          },
        ],
      },
    },
    {
      type: "pull_request",
      parameters: { required_review_thread_resolution: true },
    },
  ]);
});

test("updates an unbound codex status context to the expected source", () => {
  const existingRules = [
    {
      type: "required_status_checks",
      parameters: {
        required_status_checks: [{ context: DEFAULT_STATUS_CONTEXT }],
      },
    },
  ];

  const { changed, rules } = ensureStatusContextInRules(existingRules);

  assert.equal(changed, true);
  assert.deepEqual(rules[0].parameters.required_status_checks, [
    {
      context: DEFAULT_STATUS_CONTEXT,
      integration_id: DEFAULT_STATUS_INTEGRATION_ID,
    },
  ]);
});

test("does not duplicate an existing codex status context with matching source", () => {
  const existingRules = [
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: true,
        required_status_checks: [
          {
            context: DEFAULT_STATUS_CONTEXT,
            integration_id: DEFAULT_STATUS_INTEGRATION_ID,
          },
        ],
      },
    },
  ];

  const { changed, rules } = ensureStatusContextInRules(existingRules);

  assert.equal(changed, false);
  assert.deepEqual(rules[0].parameters.required_status_checks, [
    {
      context: DEFAULT_STATUS_CONTEXT,
      integration_id: DEFAULT_STATUS_INTEGRATION_ID,
    },
  ]);
});

test("rejects removing the GitHub Actions status source binding", () => {
  const existingRules = [
    {
      type: "required_status_checks",
      parameters: {
        required_status_checks: [
          {
            context: DEFAULT_STATUS_CONTEXT,
            integration_id: DEFAULT_STATUS_INTEGRATION_ID,
          },
        ],
      },
    },
  ];

  assert.throws(
    () =>
      ensureStatusContextInRules(existingRules, DEFAULT_STATUS_CONTEXT, {
        integrationId: null,
      }),
    /requires the GitHub Actions source integration id 15368/u,
  );
});

test("replaces only the legacy v1 status and forces strict up-to-date", () => {
  const existingRules = [
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: false,
        required_status_checks: [
          { context: "build" },
          { context: LEGACY_STATUS_CONTEXT },
        ],
      },
    },
  ];

  const { changed, rules } = ensureStatusContextInRules(existingRules);

  assert.equal(changed, true);
  assert.equal(rules[0].parameters.strict_required_status_checks_policy, true);
  assert.deepEqual(rules[0].parameters.required_status_checks, [
    { context: "build" },
    {
      context: DEFAULT_STATUS_CONTEXT,
      integration_id: DEFAULT_STATUS_INTEGRATION_ID,
    },
  ]);
});

test("adds and repairs the complete pull-request control-plane policy", () => {
  const created = ensurePullRequestPolicyInRules([]);
  assert.equal(created.changed, true);
  assert.equal(created.rules[0].type, "pull_request");
  assert.equal(
    created.rules[0].parameters.required_review_thread_resolution,
    true,
  );
  assert.equal(created.rules[0].parameters.require_code_owner_review, true);
  assert.equal(created.rules[0].parameters.dismiss_stale_reviews_on_push, true);
  assert.equal(created.rules[0].parameters.required_approving_review_count, 0);

  const repaired = ensurePullRequestPolicyInRules([
    {
      type: "pull_request",
      parameters: {
        required_approving_review_count: 2,
        require_code_owner_review: false,
        dismiss_stale_reviews_on_push: false,
        required_review_thread_resolution: false,
      },
    },
  ]);
  assert.equal(repaired.changed, true);
  assert.equal(repaired.rules[0].parameters.required_approving_review_count, 2);
  assert.equal(repaired.rules[0].parameters.require_code_owner_review, true);
  assert.equal(repaired.rules[0].parameters.dismiss_stale_reviews_on_push, true);
  assert.equal(repaired.rules[0].parameters.required_review_thread_resolution, true);
});

test("recognizes only the complete active v2 gate policy", () => {
  const complete = {
    name: "Complete",
    target: "branch",
    enforcement: "active",
    bypass_actors: [],
    conditions: {
      ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] },
    },
    rules: ensureGatePolicyInRules([]).rules,
  };
  const statusOnly = {
    ...complete,
    name: "Status only",
    rules: complete.rules.filter((rule) => rule.type === "required_status_checks"),
  };
  const withoutNonFastForward = {
    ...complete,
    name: "No force-push protection",
    rules: complete.rules.filter((rule) => rule.type !== "non_fast_forward"),
  };

  assert.equal(rulesetHasRequiredPullRequestPolicy(complete), true);
  assert.equal(rulesetHasNonFastForwardPolicy(complete), true);
  assert.equal(rulesetHasGatePolicy(complete), true);
  assert.equal(rulesetHasGatePolicy(statusOnly), false);
  assert.equal(rulesetHasGatePolicy(withoutNonFastForward), false);
  assert.equal(
    findEffectiveRulesetWithGatePolicy([statusOnly, complete], DEFAULT_STATUS_CONTEXT, {
      defaultBranch: "master",
    }),
    complete,
  );
});

test("adds, normalizes, and deduplicates parameterless non-fast-forward policy", () => {
  assert.deepEqual(ensureNonFastForwardPolicyInRules([]), {
    changed: true,
    rules: [{ type: "non_fast_forward" }],
  });
  assert.deepEqual(ensureNonFastForwardPolicyInRules([
    { type: "non_fast_forward", parameters: {} },
    { type: "non_fast_forward" },
  ]), {
    changed: true,
    rules: [{ type: "non_fast_forward" }],
  });
  assert.deepEqual(ensureNonFastForwardPolicyInRules([
    { type: "non_fast_forward" },
  ]), {
    changed: false,
    rules: [{ type: "non_fast_forward" }],
  });
});

test("requires explicit empty bypass actors and repairs missing or malformed values", () => {
  const complete = {
    name: "Must Pass Codex Review",
    target: "branch",
    enforcement: "evaluate",
    conditions: {
      ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] },
    },
    bypass_actors: [],
    rules: ensureGatePolicyInRules([]).rules,
  };

  assert.equal(rulesetHasGatePolicy(complete), true);
  for (const bypassActors of [undefined, null, {}, "none"]) {
    const candidate = { ...complete, bypass_actors: bypassActors };
    if (bypassActors === undefined) {
      delete candidate.bypass_actors;
    }
    assert.equal(rulesetHasGatePolicy(candidate), false);
    const { changed, payload } = buildUpdateRulesetPayload(candidate, {
      defaultBranch: "master",
    });
    assert.equal(changed, true);
    assert.deepEqual(payload.bypass_actors, []);
  }
});

test("detects effective rulesets with the codex status context", () => {
  const inheritedRuleset = {
    id: 10,
    name: "Must Pass Codex Review",
    source_type: "Organization",
    enforcement: "active",
    rules: [
      {
        type: "required_status_checks",
        parameters: {
          required_status_checks: [
            {
              context: DEFAULT_STATUS_CONTEXT,
              integration_id: DEFAULT_STATUS_INTEGRATION_ID,
            },
          ],
        },
      },
    ],
  };
  const disabledRuleset = {
    id: 11,
    name: "Disabled",
    source_type: "Repository",
    enforcement: "disabled",
    rules: inheritedRuleset.rules,
  };
  const evaluateRuleset = {
    id: 12,
    name: "Evaluate",
    source_type: "Repository",
    enforcement: "evaluate",
    rules: inheritedRuleset.rules,
  };

  assert.equal(rulesetHasRequiredStatusContext(inheritedRuleset), true);
  assert.equal(
    rulesetHasRequiredStatusContext(
      {
        rules: [
          {
            type: "required_status_checks",
            parameters: {
              required_status_checks: [{ context: LEGACY_STATUS_CONTEXT }],
            },
          },
        ],
      },
      LEGACY_STATUS_CONTEXT,
      { integrationId: undefined },
    ),
    true,
  );
  assert.equal(
    rulesetHasRequiredStatusContext(inheritedRuleset, DEFAULT_STATUS_CONTEXT, {
      integrationId: null,
    }),
    false,
  );
  assert.deepEqual(requiredStatusCheckContexts(inheritedRuleset), [DEFAULT_STATUS_CONTEXT]);
  assert.equal(
    rulesetHasRequiredStatusContext({
      ...inheritedRuleset,
      rules: [
        {
          type: "required_status_checks",
          parameters: {
            required_status_checks: [
              { context: DEFAULT_STATUS_CONTEXT, integration_id: 99999 },
            ],
          },
        },
      ],
    }),
    false,
  );
  assert.equal(
    findEffectiveRulesetWithStatusContext(
      [disabledRuleset, evaluateRuleset, inheritedRuleset],
      DEFAULT_STATUS_CONTEXT,
      { defaultBranch: "master" },
    ),
    inheritedRuleset,
  );
});

test("requires effective rulesets to cover the default branch", () => {
  const releaseOnlyRuleset = {
    target: "branch",
    enforcement: "active",
    conditions: {
      ref_name: {
        include: ["release/*"],
        exclude: [],
      },
    },
    rules: [
      {
        type: "required_status_checks",
        parameters: {
          required_status_checks: [
            {
              context: DEFAULT_STATUS_CONTEXT,
              integration_id: DEFAULT_STATUS_INTEGRATION_ID,
            },
          ],
        },
      },
    ],
  };
  const defaultBranchRuleset = {
    ...releaseOnlyRuleset,
    conditions: {
      ref_name: {
        include: ["~DEFAULT_BRANCH"],
        exclude: [],
      },
    },
  };

  assert.equal(rulesetCoversDefaultBranch(releaseOnlyRuleset, "master"), false);
  assert.equal(rulesetCoversDefaultBranch(defaultBranchRuleset, "master"), true);
  assert.equal(
    findEffectiveRulesetWithStatusContext(
      [releaseOnlyRuleset, defaultBranchRuleset],
      DEFAULT_STATUS_CONTEXT,
      { defaultBranch: "master" },
    ),
    defaultBranchRuleset,
  );
});

test("matches default branch ruleset glob patterns", () => {
  assert.equal(
    rulesetCoversDefaultBranch(
      {
        target: "branch",
        conditions: {
          ref_name: {
            include: ["*"],
            exclude: [],
          },
        },
      },
      "main",
    ),
    true,
  );
  assert.equal(
    rulesetCoversDefaultBranch(
      {
        target: "branch",
        conditions: {
          ref_name: {
            include: ["[Mm]ain"],
            exclude: [],
          },
        },
      },
      "main",
    ),
    true,
  );
  assert.equal(
    rulesetCoversDefaultBranch(
      {
        target: "branch",
        conditions: {
          ref_name: {
            include: ["~ALL"],
            exclude: ["[Mm]ain"],
          },
        },
      },
      "main",
    ),
    false,
  );
  assert.equal(
    rulesetCoversDefaultBranch(
      {
        target: "branch",
        conditions: {
          ref_name: {
            include: ["*"],
            exclude: [],
          },
        },
      },
      "release/1.2",
    ),
    false,
  );
  assert.equal(
    rulesetCoversDefaultBranch(
      {
        target: "branch",
        conditions: {
          ref_name: {
            include: ["refs/heads/main*"],
            exclude: [],
          },
        },
      },
      "main",
    ),
    true,
  );
  assert.equal(
    rulesetCoversDefaultBranch(
      {
        target: "branch",
        conditions: {
          ref_name: {
            include: ["refs/heads/*"],
            exclude: [],
          },
        },
      },
      "release/1.2",
    ),
    false,
  );
  assert.equal(
    rulesetCoversDefaultBranch(
      {
        target: "branch",
        conditions: {
          ref_name: {
            include: ["release/*"],
            exclude: [],
          },
        },
      },
      "release/1.2",
    ),
    true,
  );
  assert.equal(
    rulesetCoversDefaultBranch(
      {
        target: "branch",
        conditions: {
          ref_name: {
            include: ["release/*"],
            exclude: [],
          },
        },
      },
      "release/2026/05",
    ),
    false,
  );
  assert.equal(
    rulesetCoversDefaultBranch(
      {
        target: "branch",
        conditions: {
          ref_name: {
            include: ["release/**"],
            exclude: [],
          },
        },
      },
      "release/2026/05",
    ),
    false,
  );
  assert.equal(
    rulesetCoversDefaultBranch(
      {
        target: "branch",
        conditions: {
          ref_name: {
            include: ["release/**"],
            exclude: [],
          },
        },
      },
      "release/2026",
    ),
    true,
  );
  for (const branch of ["release/2026", "release/2026/05"]) {
    assert.equal(
      rulesetCoversDefaultBranch(
        {
          target: "branch",
          conditions: {
            ref_name: {
              include: ["release/**/*"],
              exclude: [],
            },
          },
        },
        branch,
      ),
      true,
    );
  }
  assert.equal(
    rulesetCoversDefaultBranch(
      {
        target: "branch",
        conditions: {
          ref_name: {
            include: ["release[/]2026"],
            exclude: [],
          },
        },
      },
      "release/2026",
    ),
    false,
  );
  assert.equal(
    rulesetCoversDefaultBranch(
      {
        target: "branch",
        conditions: {
          ref_name: {
            include: ["~ALL"],
            exclude: ["main?"],
          },
        },
      },
      "main1",
    ),
    false,
  );
});

test("fails closed on unsupported or malformed GitHub ruleset patterns", () => {
  for (const pattern of ["[^m]ain", "[z-a]ain", "main\\*", "~UNKNOWN"]) {
    assert.throws(
      () => rulesetCoversDefaultBranch({
        target: "branch",
        conditions: { ref_name: { include: [pattern], exclude: [] } },
      }, "main"),
      /Unsupported GitHub ruleset/u,
      pattern,
    );
  }
  assert.throws(
    () => rulesetCoversDefaultBranch({
      target: "branch",
      conditions: { ref_name: { include: ["~ALL"], exclude: ["[^m]ain"] } },
    }, "main"),
    /Unsupported GitHub ruleset/u,
  );
  assert.throws(
    () => rulesetCoversDefaultBranch({
      target: "branch",
      conditions: { ref_name: { include: "~ALL", exclude: [] } },
    }, "main"),
    /must be arrays/u,
  );
});

test("treats explicit default-branch exclusions as not covered", () => {
  assert.equal(
    rulesetCoversDefaultBranch(
      {
        target: "branch",
        conditions: {
          ref_name: {
            include: ["~ALL"],
            exclude: ["~DEFAULT_BRANCH"],
          },
        },
      },
      "master",
    ),
    false,
  );
  assert.equal(
    rulesetCoversDefaultBranch(
      {
        target: "branch",
        conditions: {
          ref_name: {
            include: ["refs/heads/master"],
            exclude: [],
          },
        },
      },
      "master",
    ),
    true,
  );
});

test("builds an explicitly active complete update payload without read-only fields", () => {
  const { changed, payload } = buildUpdateRulesetPayload(
    {
      id: 100,
      name: "Must Pass Codex Review",
      target: "branch",
      enforcement: "evaluate",
      conditions: {
        ref_name: {
          include: ["~DEFAULT_BRANCH"],
          exclude: [],
        },
      },
      bypass_actors: [
        {
          actor_id: 1,
          actor_type: "RepositoryRole",
          bypass_mode: "always",
          id: 999,
        },
      ],
      rules: [
        {
          id: 200,
          type: "required_status_checks",
          parameters: {
            required_status_checks: [{ context: "test" }],
          },
        },
      ],
    },
    { enforcement: "active" },
  );

  assert.equal(changed, true);
  assert.deepEqual(payload, {
    name: "Must Pass Codex Review",
    target: "branch",
    enforcement: "active",
    conditions: {
      ref_name: {
        include: ["~DEFAULT_BRANCH"],
        exclude: [],
      },
    },
    bypass_actors: [],
    rules: [
      {
        type: "pull_request",
        parameters: {
          dismiss_stale_reviews_on_push: true,
          require_code_owner_review: true,
          require_last_push_approval: false,
          required_approving_review_count: 0,
          required_review_thread_resolution: true,
        },
      },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: true,
          required_status_checks: [
            { context: "test" },
            {
              context: DEFAULT_STATUS_CONTEXT,
              integration_id: DEFAULT_STATUS_INTEGRATION_ID,
            },
          ],
        },
      },
      { type: "non_fast_forward" },
    ],
  });
});

test("preserves an existing complete active v2 ruleset by default", () => {
  const { changed, payload } = buildUpdateRulesetPayload({
    name: "Must Pass Codex Review",
    target: "branch",
    enforcement: "active",
    bypass_actors: [],
    conditions: {
      ref_name: {
        include: ["~DEFAULT_BRANCH"],
        exclude: [],
      },
    },
    rules: ensureGatePolicyInRules([]).rules,
  });

  assert.equal(changed, false);
  assert.equal(payload.enforcement, "active");
});

test("preserves a same-ruleset legacy status in a complete active v2 payload", () => {
  const completeRules = ensureGatePolicyInRules([]).rules;
  const statusRule = completeRules.find(
    (rule) => rule.type === "required_status_checks",
  );
  statusRule.parameters.required_status_checks.push({
    context: LEGACY_STATUS_CONTEXT,
  });

  const { changed, payload } = buildUpdateRulesetPayload({
    name: "Must Pass Codex Review",
    target: "branch",
    enforcement: "active",
    bypass_actors: [],
    conditions: {
      ref_name: {
        include: ["~DEFAULT_BRANCH"],
        exclude: [],
      },
    },
    rules: completeRules,
  });

  assert.equal(changed, false);
  assert.equal(payload.enforcement, "active");
  assert.equal(
    requiredStatusCheckContexts(payload).includes(LEGACY_STATUS_CONTEXT),
    true,
  );
  assert.equal(rulesetHasGatePolicy(payload), true);
});

test("refuses to disable existing active legacy or incomplete rulesets during v2 staging", () => {
  const candidates = [
    {
      conditions: {
        ref_name: {
          include: ["~DEFAULT_BRANCH"],
          exclude: [],
        },
      },
      rules: [
        {
          type: "required_status_checks",
          parameters: {
            strict_required_status_checks_policy: false,
            required_status_checks: [{ context: LEGACY_STATUS_CONTEXT }],
          },
        },
      ],
    },
    {
      conditions: {
        ref_name: {
          include: ["~DEFAULT_BRANCH"],
          exclude: [],
        },
      },
      rules: [
        {
          type: "required_status_checks",
          parameters: {
            strict_required_status_checks_policy: true,
            required_status_checks: [{ context: "ci/test" }],
          },
        },
      ],
    },
    {
      conditions: {
        ref_name: {
          include: ["release/*"],
          exclude: [],
        },
      },
      rules: ensureGatePolicyInRules([]).rules,
    },
  ];

  for (const candidate of candidates) {
    assert.throws(
      () =>
        buildUpdateRulesetPayload({
          name: "Must Pass Codex Review",
          target: "branch",
          enforcement: "active",
          ...candidate,
        }, {
          defaultBranch: "master",
        }),
      /active legacy or incomplete gate.*distinct --ruleset-name/u,
    );
  }
});

test("repairs a disabled legacy-only ruleset into a complete disabled v2 stage", () => {
  const { changed, payload } = buildUpdateRulesetPayload({
    name: "Must Pass Codex Review",
    target: "branch",
    enforcement: "disabled",
    bypass_actors: [],
    conditions: {
      ref_name: {
        include: ["~DEFAULT_BRANCH"],
        exclude: [],
      },
    },
    rules: [
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: false,
          required_status_checks: [{ context: LEGACY_STATUS_CONTEXT }],
        },
      },
    ],
  }, {
    defaultBranch: "master",
  });

  assert.equal(changed, true);
  assert.equal(payload.enforcement, "disabled");
  assert.equal(rulesetHasGatePolicy(payload), true);
  assert.equal(
    requiredStatusCheckContexts(payload).includes(LEGACY_STATUS_CONTEXT),
    false,
  );
});

test("refuses to rewrite non-branch rulesets as branch rulesets", () => {
  assert.throws(
    () =>
      buildUpdateRulesetPayload(
        {
          name: "Must Pass Codex Review",
          target: "tag",
          enforcement: "active",
          rules: [],
        },
        {
          defaultBranch: "master",
        },
      ),
    /refusing to rewrite/,
  );
});

test("adds default branch coverage to same-name rulesets that do not cover it", () => {
  const { changed, payload } = buildUpdateRulesetPayload(
    {
      name: "Must Pass Codex Review",
      target: "branch",
      enforcement: "evaluate",
      conditions: {
        ref_name: {
          include: ["release/*"],
          exclude: [],
        },
      },
      rules: [
        {
          type: "required_status_checks",
          parameters: {
            required_status_checks: [{ context: DEFAULT_STATUS_CONTEXT }],
          },
        },
      ],
    },
    {
      defaultBranch: "master",
    },
  );

  assert.equal(changed, true);
  assert.equal(payload.enforcement, "disabled");
  assert.deepEqual(payload.conditions, {
    ref_name: {
      include: ["release/*", "~DEFAULT_BRANCH"],
      exclude: [],
    },
  });
  assert.deepEqual(payload.rules[1].parameters.required_status_checks, [
    {
      context: DEFAULT_STATUS_CONTEXT,
      integration_id: DEFAULT_STATUS_INTEGRATION_ID,
    },
  ]);
});

test("removes default branch exclusions when extending same-name rulesets", () => {
  const { changed, payload } = buildUpdateRulesetPayload(
    {
      name: "Must Pass Codex Review",
      target: "branch",
      enforcement: "evaluate",
      conditions: {
        ref_name: {
          include: ["release/*"],
          exclude: ["~DEFAULT_BRANCH", "legacy/*"],
        },
      },
      rules: [
        {
          type: "required_status_checks",
          parameters: {
            required_status_checks: [
              {
                context: DEFAULT_STATUS_CONTEXT,
                integration_id: DEFAULT_STATUS_INTEGRATION_ID,
              },
            ],
          },
        },
      ],
    },
    {
      defaultBranch: "master",
    },
  );

  assert.equal(changed, true);
  assert.deepEqual(payload.conditions, {
    ref_name: {
      include: ["release/*", "~DEFAULT_BRANCH"],
      exclude: ["legacy/*"],
    },
  });
});

test("refuses to broaden non-exact default branch exclusions", () => {
  assert.throws(
    () =>
      buildUpdateRulesetPayload(
        {
          name: "Must Pass Codex Review",
          target: "branch",
          enforcement: "evaluate",
          conditions: {
            ref_name: {
              include: ["~ALL"],
              exclude: ["main*"],
            },
          },
          rules: [
            {
              type: "required_status_checks",
              parameters: {
                required_status_checks: [
                  {
                    context: DEFAULT_STATUS_CONTEXT,
                    integration_id: DEFAULT_STATUS_INTEGRATION_ID,
                  },
                ],
              },
            },
          ],
        },
        {
          defaultBranch: "main",
        },
      ),
    /refusing to broaden/,
  );
});

test("preserves broader same-name ruleset branch coverage", () => {
  const { changed, payload } = buildUpdateRulesetPayload(
    {
      name: "Must Pass Codex Review",
      target: "branch",
      enforcement: "evaluate",
      conditions: {
        ref_name: {
          include: ["~ALL"],
          exclude: [],
        },
      },
      rules: [
        {
          type: "required_status_checks",
          parameters: {
            required_status_checks: [{ context: "test" }],
          },
        },
      ],
    },
    {
      defaultBranch: "master",
    },
  );

  assert.equal(changed, true);
  assert.deepEqual(payload.conditions, {
    ref_name: {
      include: ["~ALL"],
      exclude: [],
    },
  });
  assert.deepEqual(payload.rules[1].parameters.required_status_checks, [
    { context: "test" },
    {
      context: DEFAULT_STATUS_CONTEXT,
      integration_id: DEFAULT_STATUS_INTEGRATION_ID,
    },
  ]);
});

test("parses repository slugs and content endpoints", () => {
  assert.deepEqual(parseRepoSlug("Joey-Tools/codex-gated-repo-template"), {
    owner: "Joey-Tools",
    repo: "codex-gated-repo-template",
    slug: "Joey-Tools/codex-gated-repo-template",
  });
  assert.equal(
    workflowContentEndpoint(
      "Joey-Tools/codex-gated-repo-template",
      ".github/workflows/codex-review-gate.yml",
      "feature/name",
    ),
    "repos/Joey-Tools/codex-gated-repo-template/contents/.github/workflows/codex-review-gate.yml?ref=feature%2Fname",
  );
  assert.equal(
    workflowContentEndpoint(
      "Joey-Tools/codex-gated-repo-template",
      ".github/workflows/codex gate?#.yml",
      "master",
    ),
    "repos/Joey-Tools/codex-gated-repo-template/contents/.github/workflows/codex%20gate%3F%23.yml?ref=master",
  );
  assert.throws(() => parseRepoSlug("Joey-Tools"), /OWNER\/REPO/);
});

test("parses supported GitHub origin URLs without accepting credentials or ambiguity", () => {
  for (const remote of [
    "git@github.com:Joey-Tools/consumer.git",
    "ssh://git@github.com/Joey-Tools/consumer.git",
    "https://github.com/Joey-Tools/consumer.git",
  ]) {
    assert.deepEqual(parseGitHubRepositoryRemote(remote), {
      owner: "Joey-Tools",
      repo: "consumer",
      slug: "Joey-Tools/consumer",
    });
  }
  for (const remote of [
    "https://token@github.com/Joey-Tools/consumer.git",
    "https://github.example/Joey-Tools/consumer.git",
    "file:///tmp/consumer.git",
    "https://github.com/Joey-Tools/consumer.git?ref=main",
    "https://github.com/Joey-Tools/consumer/extra.git",
  ]) {
    assert.throws(() => parseGitHubRepositoryRemote(remote), /Git origin/u);
  }
});

test("validates historical v1 and current v2 organization final closure receipts", () => {
  const historicalOutput = buildFinalClosureOutput({ format: "v1" });
  const output = buildFinalClosureOutput();
  assert.equal(LEGACY_ORGANIZATION_FINAL_CLOSURE_COHORT_SIZE, 11);
  assert.equal(ORGANIZATION_FINAL_CLOSURE_COHORT_SIZE, 10);
  const historicalValidated = validateOrganizationFinalClosureOutput(
    historicalOutput,
  );
  const currentValidated = validateOrganizationFinalClosureOutput(output);
  for (const [candidateOutput, validated] of [
    [historicalOutput, historicalValidated],
    [output, currentValidated],
  ]) {
    assert.deepEqual(validated.receipt, candidateOutput.final_closure_receipt);
    assert.equal(
      createHash("sha256")
        .update(canonicalOrganizationFinalClosureReceipt(validated.receipt))
        .digest("hex"),
      candidateOutput.final_closure_receipt_sha256,
    );
  }
  assert.deepEqual(
    historicalValidated.bridgeRemovalRepositories,
    [],
    "historical v1 evidence cannot authorize a new bridge-removal mutation",
  );
  assert.deepEqual(
    currentValidated.bridgeRemovalRepositories,
    output.final_closure_receipt.manifest_repositories,
    "v2 bridge removal is authorized by the manifest-derived identity cohort",
  );
  assert.deepEqual(
    output.final_closure_receipt.manifest_repositories,
    output.final_closure_receipt.repositories,
    "a producer's v2 manifest cohort must exactly bind the stable observed cohort",
  );
  assert.equal(
    historicalOutput.final_closure_receipt_sha256,
    "6eeb485ac17c561fbd5f9f7c6aa70979ac4d1b4f5f8714937605d443a8f9fa9d",
    "v1 canonical receipt hashes are a published compatibility contract",
  );
  assert.equal(
    currentValidated.bridgeRemovalRepositories.some(
      ({ full_name: fullName }) =>
        fullName.toLowerCase() === "joey-tools/codex-waited-delivery",
    ),
    false,
    "the archived legacy-only repository is not a v2 bridge-removal authorization",
  );

  const v1WithV2Receipt = structuredClone(historicalOutput);
  v1WithV2Receipt.final_closure_receipt = structuredClone(
    output.final_closure_receipt,
  );
  v1WithV2Receipt.final_closure_receipt_sha256 =
    output.final_closure_receipt_sha256;
  v1WithV2Receipt.repositories_verified = output.repositories_verified;

  const v2WithV1Receipt = structuredClone(output);
  v2WithV1Receipt.final_closure_receipt = structuredClone(
    historicalOutput.final_closure_receipt,
  );
  v2WithV1Receipt.final_closure_receipt_sha256 =
    historicalOutput.final_closure_receipt_sha256;
  v2WithV1Receipt.repositories_verified = historicalOutput.repositories_verified;

  const v1WithTenRepositories = structuredClone(historicalOutput);
  v1WithTenRepositories.final_closure_receipt.repositories.pop();
  v1WithTenRepositories.repositories_verified =
    v1WithTenRepositories.final_closure_receipt.repositories.length;
  refreshFinalClosureReceiptDigest(v1WithTenRepositories);

  const v2WithElevenRepositories = structuredClone(output);
  v2WithElevenRepositories.final_closure_receipt.repositories.push({
    full_name: "Joey-Tools/codex-waited-delivery",
    id: 1_244,
    node_id: "R_kgDOReceiptCohort11",
    default_branch: "master",
  });
  v2WithElevenRepositories.repositories_verified =
    v2WithElevenRepositories.final_closure_receipt.repositories.length;
  refreshFinalClosureReceiptDigest(v2WithElevenRepositories);

  const v2WithObservedArchiveSubstitution = structuredClone(output);
  v2WithObservedArchiveSubstitution.final_closure_receipt.repositories = [
    ...v2WithObservedArchiveSubstitution.final_closure_receipt.repositories.slice(1),
    {
      full_name: "Joey-Tools/codex-waited-delivery",
      id: 1_242_512_099,
      node_id: "R_kgDOSg864w",
      default_branch: "master",
    },
  ].sort((left, right) =>
    left.full_name < right.full_name ? -1 : left.full_name > right.full_name ? 1 : 0
  );
  refreshFinalClosureReceiptDigest(v2WithObservedArchiveSubstitution);

  const v2WithoutManifestRepositories = structuredClone(output);
  delete v2WithoutManifestRepositories.final_closure_receipt.manifest_repositories;
  refreshFinalClosureReceiptDigest(v2WithoutManifestRepositories);

  const v1WithManifestRepositories = structuredClone(historicalOutput);
  v1WithManifestRepositories.final_closure_receipt.manifest_repositories =
    structuredClone(output.final_closure_receipt.manifest_repositories);
  refreshFinalClosureReceiptDigest(v1WithManifestRepositories);

  const unknownOutputFormat = structuredClone(output);
  unknownOutputFormat.schema_version = "organization-review-gate-handoff-output/v3";

  const unknownReceiptFormat = structuredClone(output);
  unknownReceiptFormat.final_closure_receipt.schema_version = 3;
  refreshFinalClosureReceiptDigest(unknownReceiptFormat);

  const receiptWithExtraKey = structuredClone(output);
  receiptWithExtraKey.final_closure_receipt.unreviewed_extension = true;
  refreshFinalClosureReceiptDigest(receiptWithExtraKey);

  const receiptWithMissingKey = structuredClone(output);
  delete receiptWithMissingKey.final_closure_receipt.v2_ruleset;
  refreshFinalClosureReceiptDigest(receiptWithMissingKey);

  const outputWithExtraKey = structuredClone(output);
  outputWithExtraKey.unreviewed_extension = true;

  const outputWithMissingKey = structuredClone(output);
  delete outputWithMissingKey.plan_sha256;

  const mutateCurrentOutput = (mutate) => {
    const candidate = structuredClone(output);
    mutate(candidate);
    return candidate;
  };

  for (const [name, candidate] of [
    ["cross-paired-v1-output", v1WithV2Receipt],
    ["cross-paired-v2-output", v2WithV1Receipt],
    ["v1-with-ten-repositories", v1WithTenRepositories],
    ["v2-with-eleven-repositories", v2WithElevenRepositories],
    ["v2-observed-archive-substitution", v2WithObservedArchiveSubstitution],
    ["v2-without-manifest-repositories", v2WithoutManifestRepositories],
    ["v1-with-manifest-repositories", v1WithManifestRepositories],
    ["unknown-output-format", unknownOutputFormat],
    ["unknown-receipt-format", unknownReceiptFormat],
    ["receipt-extra-key", receiptWithExtraKey],
    ["receipt-missing-key", receiptWithMissingKey],
    ["output-extra-key", outputWithExtraKey],
    ["output-missing-key", outputWithMissingKey],
    ["non-verify-mode", mutateCurrentOutput((candidate) => {
      candidate.mode = "activate";
    })],
    ["non-final-status", mutateCurrentOutput((candidate) => {
      candidate.status = "applied-final-verified";
    })],
    ["applied", mutateCurrentOutput((candidate) => {
      candidate.applied = true;
    })],
    ["action", mutateCurrentOutput((candidate) => {
      candidate.action = { method: "PUT" };
    })],
    ["wrong-plan", mutateCurrentOutput((candidate) => {
      candidate.plan_sha256 = "4".repeat(64);
    })],
    ["legacy-ruleset-state", mutateCurrentOutput((candidate) => {
      candidate.final_closure_receipt.legacy_ruleset.state = "before";
    })],
    ["wrong-organization", mutateCurrentOutput((candidate) => {
      candidate.final_closure_receipt.repositories[0].full_name =
        "Elsewhere/consumer";
    })],
    ["single-repository", mutateCurrentOutput((candidate) => {
      candidate.final_closure_receipt.repositories =
        candidate.final_closure_receipt.repositories.slice(0, 1);
      candidate.repositories_verified = 1;
      refreshFinalClosureReceiptDigest(candidate);
    })],
    ["reordered-repositories", mutateCurrentOutput((candidate) => {
      candidate.final_closure_receipt.repositories.reverse();
      refreshFinalClosureReceiptDigest(candidate);
    })],
    ["invalid-repository-slug", mutateCurrentOutput((candidate) => {
      candidate.final_closure_receipt.repositories[1].full_name =
        "Joey-Tools/bad repo";
      refreshFinalClosureReceiptDigest(candidate);
    })],
    ["invalid-default-branch", mutateCurrentOutput((candidate) => {
      candidate.final_closure_receipt.repositories[1].default_branch =
        "refs/heads/main";
      refreshFinalClosureReceiptDigest(candidate);
    })],
    ["wrong-repositories-verified", mutateCurrentOutput((candidate) => {
      candidate.repositories_verified = 2;
    })],
  ]) {
    assert.throws(
      () => validateOrganizationFinalClosureOutput(candidate),
      /final|receipt|repositories_verified|organization|plan_sha256|cohort|schema_version|keys|slug|default_branch|order|manifest/iu,
      name,
    );
  }
});

test("validates source-only bridge-removal proof receipts independently from organization closure receipts", () => {
  const output = buildSourceBridgeRemovalProofOutput();
  const receipt = output.source_bridge_removal_receipt;
  assert.equal(SOURCE_SELF_HOSTING_REPOSITORY_SLUG, "Joey-Tools/codex-review-gate");
  assert.equal(SOURCE_BRIDGE_REMOVAL_PROOF_SCHEMA_VERSION, 1);
  assert.equal(
    SOURCE_BRIDGE_REMOVAL_PROOF_OUTPUT_SCHEMA_VERSION,
    "source-bridge-removal-proof-output/v1",
  );
  assert.deepEqual(validateSourceBridgeRemovalProof(receipt), receipt);
  assert.deepEqual(validateSourceBridgeRemovalProofOutput(output), output);
  assert.equal(
    canonicalSourceBridgeRemovalProof(receipt),
    canonicalJsonForTest(receipt),
  );
  assert.equal(
    sourceBridgeRemovalProofSha256(receipt),
    output.source_bridge_removal_receipt_sha256,
  );
  const historicalBaseStillAncestor = buildSourceBridgeRemovalProofOutput({
    defaultBranchHeadSha: "b".repeat(40),
    canaryBaseSha: DEFAULT_BRANCH_SHA,
  });
  assert.equal(
    validateSourceBridgeRemovalProof(
      historicalBaseStillAncestor.source_bridge_removal_receipt,
    ).canary.base_ancestry.status,
    "ahead",
    "a historical canary base need not equal the current default head once its ancestry is proven",
  );

  const wrongDigest = structuredClone(output);
  wrongDigest.source_bridge_removal_receipt_sha256 = "f".repeat(64);
  const organizationReceipt = buildFinalClosureOutput();
  const extraKey = structuredClone(receipt);
  extraKey.unreviewed_extension = true;
  const sourceScopeMismatch = structuredClone(receipt);
  sourceScopeMismatch.scope = "organization-bridge-removal";
  const foreignSource = structuredClone(receipt);
  foreignSource.repository.full_name = "Joey-Tools/consumer";
  const wrongControlPlaneOwner = structuredClone(receipt);
  wrongControlPlaneOwner.control_plane_owner = "@DifferentOwner";
  const wrongV2RulesetName = structuredClone(receipt);
  wrongV2RulesetName.v2_ruleset.name = "replacement v2 ruleset";
  const wrongRetainedRuleset = structuredClone(receipt);
  wrongRetainedRuleset.retained_source_ruleset.name =
    "replacement retained ruleset";
  const openCanary = structuredClone(receipt);
  openCanary.canary.state = "open";
  const mergedCanary = structuredClone(receipt);
  mergedCanary.canary.merged = true;
  const wrongCheckRunHead = structuredClone(receipt);
  wrongCheckRunHead.canary.check_run.head_sha = "b".repeat(40);
  const checkRunAfterClose = structuredClone(receipt);
  checkRunAfterClose.canary.check_run.completed_at = "2026-09-25T12:01:00Z";
  const wrongRunBinding = structuredClone(receipt);
  wrongRunBinding.canary.run.display_title =
    `${DEFAULT_VERIFIER_RUN_NAME_PREFIX}/${wrongRunBinding.canary.number}/${"c".repeat(40)}`;
  const wrongJobBinding = structuredClone(receipt);
  wrongJobBinding.canary.job.check_run_id += 1;
  const nonAncestorBase = structuredClone(receipt);
  nonAncestorBase.canary.base_ancestry.merge_base_sha = "d".repeat(40);
  const unsortedCanonicalWorkflowInventory = structuredClone(receipt);
  unsortedCanonicalWorkflowInventory.live_closure.canonical_workflows.reverse();
  const legacyStillRequired = structuredClone(receipt);
  legacyStillRequired.live_closure.legacy_status_required = true;

  assert.throws(
    () => validateSourceBridgeRemovalProofOutput(organizationReceipt),
    /Source bridge-removal proof output|schema_version|keys/u,
    "an organization receipt must never become source bridge-removal authority",
  );
  assert.throws(
    () => validateSourceBridgeRemovalProofOutput(wrongDigest),
    /SHA-256/u,
  );
  for (const [name, candidate] of [
    ["extra-key", extraKey],
    ["source-scope-mismatch", sourceScopeMismatch],
    ["foreign-source", foreignSource],
    ["control-plane-owner", wrongControlPlaneOwner],
    ["v2-ruleset-name", wrongV2RulesetName],
    ["retained-source-ruleset", wrongRetainedRuleset],
    ["open-canary", openCanary],
    ["merged-canary", mergedCanary],
    ["check-run-head", wrongCheckRunHead],
    ["check-run-after-closed-canary", checkRunAfterClose],
    ["run-test-merge-binding", wrongRunBinding],
    ["job-check-run-binding", wrongJobBinding],
    ["historical-base-not-ancestor", nonAncestorBase],
    ["canonical-workflow-order", unsortedCanonicalWorkflowInventory],
    ["legacy-still-required", legacyStillRequired],
  ]) {
    assert.throws(
      () => validateSourceBridgeRemovalProof(candidate),
      /Source bridge-removal|source self-hosting|control-plane|v2_ruleset|retained_source_ruleset|canary|check_run|run|job|canonical|legacy/u,
      name,
    );
  }
});

test("pins the source retained non-status ruleset to its actual reviewed policy", () => {
  const baseline = sourceRetainedRulesetFixture();
  const expectedWritable = JSON.parse(rulesetWritableFingerprint(baseline));
  expectedWritable.rules.sort((left, right) =>
    canonicalJsonForTest(left).localeCompare(canonicalJsonForTest(right))
  );
  assert.deepEqual(
    assertSourceSelfHostingRetainedRulesetPolicy(baseline),
    {
      id: SOURCE_SELF_HOSTING_RETAINED_RULESET_ID,
      name: SOURCE_SELF_HOSTING_RETAINED_RULESET_NAME,
      source_type: "Repository",
      source: SOURCE_SELF_HOSTING_REPOSITORY_SLUG,
      target: "branch",
      writable: expectedWritable,
    },
  );
  const reorderedRules = structuredClone(baseline);
  reorderedRules.rules.reverse();
  assert.deepEqual(
    assertSourceSelfHostingRetainedRulesetPolicy(reorderedRules),
    assertSourceSelfHostingRetainedRulesetPolicy(baseline),
    "the unordered rules collection must not change the fixed retained-policy projection",
  );
  for (const [name, mutate] of [
    [
      "deletion-removed",
      (ruleset) => {
        ruleset.rules = ruleset.rules.filter((rule) => rule.type !== "deletion");
      },
    ],
    [
      "non-fast-forward-parameters-added",
      (ruleset) => {
        ruleset.rules.find((rule) => rule.type === "non_fast_forward").parameters = {};
      },
    ],
    [
      "thread-resolution-relaxed",
      (ruleset) => {
        ruleset.rules.find(
          (rule) => rule.type === "pull_request",
        ).parameters.required_review_thread_resolution = false;
      },
    ],
    [
      "bypass-added",
      (ruleset) => {
        ruleset.bypass_actors = [{
          actor_id: 1,
          actor_type: "RepositoryRole",
          bypass_mode: "always",
        }];
      },
    ],
    [
      "name-drift",
      (ruleset) => {
        ruleset.name = "replacement retained policy";
      },
    ],
    [
      "id-drift",
      (ruleset) => {
        ruleset.id += 1;
      },
    ],
    [
      "conditions-drift",
      (ruleset) => {
        ruleset.conditions.ref_name.exclude = ["master"];
      },
    ],
  ]) {
    const candidate = structuredClone(baseline);
    mutate(candidate);
    assert.throws(
      () => assertSourceSelfHostingRetainedRulesetPolicy(candidate),
      /Source retained ruleset/u,
      name,
    );
  }
});

test("normalizes workflow paths to repository workflow files", () => {
  assert.equal(
    normalizeWorkflowPath(" .github/workflows/codex-review-gate.yml "),
    ".github/workflows/codex-review-gate.yml",
  );
  assert.equal(
    normalizeWorkflowPath(".github/workflows/codex-review-gate.yaml"),
    ".github/workflows/codex-review-gate.yaml",
  );
  assert.throws(() => normalizeWorkflowPath(""), /Workflow path/);
  assert.throws(() => normalizeWorkflowPath(".github/workflows"), /Workflow path/);
  assert.throws(
    () => normalizeWorkflowPath(".github/workflows/nested/codex-review-gate.yml"),
    /Workflow path/,
  );
  assert.throws(() => normalizeWorkflowPath("codex-review-gate.yml"), /Workflow path/);
});

test("builds a final idempotent CODEOWNERS control-plane block without losing other entries", () => {
  assert.equal(normalizeControlPlaneOwner(" @JoeyTeng "), "@JoeyTeng");
  assert.throws(() => normalizeControlPlaneOwner("@Joey-Tools/team"), /one GitHub user/u);
  assert.throws(() => normalizeControlPlaneOwner("JoeyTeng"), /GitHub user handle/u);

  const existing = "# Existing ownership\n/docs/** @docs-team\n";
  const prepared = ensureControlPlaneCodeownersContent(existing);
  assert.equal(prepared.changed, true);
  assert.match(prepared.content, /^# Existing ownership\n\/docs\/\*\* @docs-team\n/u);
  assert.match(
    prepared.content,
    /# BEGIN codex-review-gate control-plane\n\/\.github\/workflows\/ @JoeyTeng\n\/\.github\/CODEOWNERS @JoeyTeng\n# END codex-review-gate control-plane\n$/u,
  );
  assert.equal(validateControlPlaneCodeownersContent(prepared.content), prepared.content);
  assert.deepEqual(
    ensureControlPlaneCodeownersContent(prepared.content),
    { changed: false, content: prepared.content },
  );

  const updated = ensureControlPlaneCodeownersContent(prepared.content, "@Alice");
  assert.equal(updated.changed, true);
  assert.match(updated.content, /\/\.github\/workflows\/ @Alice/u);
  assert.doesNotMatch(updated.content, /\/\.github\/workflows\/ @JoeyTeng/u);
  assert.match(updated.content, /^# Existing ownership\n\/docs\/\*\* @docs-team\n/u);
});

test("CODEOWNERS validation rejects missing, wrong, multi-owner, and later override rules", () => {
  const canonical = ensureControlPlaneCodeownersContent(null).content;
  for (const candidate of [
    canonical.replace("/.github/CODEOWNERS @JoeyTeng\n", ""),
    canonical.replace("/.github/workflows/ @JoeyTeng", "/.github/workflows/* @JoeyTeng"),
    canonical.replace("/.github/CODEOWNERS @JoeyTeng", "/.github/CODEOWNERS @Alice"),
    canonical.replace("/.github/CODEOWNERS @JoeyTeng", "/.github/CODEOWNERS @JoeyTeng @Alice"),
    `${canonical}* @Alice\n`,
    `${canonical}# trailing comment\n`,
  ]) {
    assert.throws(
      () => validateControlPlaneCodeownersContent(candidate),
      /exact, non-overridable ownership/u,
    );
  }
  for (const malformed of [
    "# BEGIN codex-review-gate control-plane\n",
    "# END codex-review-gate control-plane\n",
    `${canonical}# BEGIN codex-review-gate control-plane\n# END codex-review-gate control-plane\n`,
  ]) {
    assert.throws(
      () => ensureControlPlaneCodeownersContent(malformed),
      /ambiguous|malformed/u,
    );
  }
});

test("detects effective non-managed CODEOWNERS patterns without counting comments", () => {
  const managedOnly = ensureControlPlaneCodeownersContent(null).content;
  assert.equal(codeownersHasEffectiveUnmanagedPatterns(managedOnly), false);
  assert.equal(
    codeownersHasEffectiveUnmanagedPatterns(
      ensureControlPlaneCodeownersContent(
        "# existing comment\n\n/src/** @Alice\n",
      ).content,
    ),
    true,
  );
});

test("prepare-worktree creates and revalidates a missing workflow parent chain", () => {
  const targetRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-bootstrap-"));
  const workflowPath = join(
    targetRoot,
    ".github",
    "workflows",
    "codex-review-gate.yml",
  );
  try {
    initializeGitRepository(targetRoot);

    const apply = runBootstrap(["--prepare-worktree", targetRoot, "--apply"]);
    assert.equal(apply.status, 0, apply.stderr);
    assert.match(apply.stdout, /Applied: install the canonical v2 verifier workflow/u);
    assert.match(apply.stdout, /Applied: install the canonical v2 controller workflow/u);
    assert.equal(readFileSync(workflowPath, "utf8"), CANONICAL_WORKFLOW);
  } finally {
    rmSync(targetRoot, { recursive: true, force: true });
  }
});

test("prepare-worktree dry-runs and then replaces a canonical-path v1 caller", () => {
  const targetRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-bootstrap-"));
  const workflowsDirectory = join(targetRoot, ".github", "workflows");
  const workflowPath = join(workflowsDirectory, "codex-review-gate.yml");
  const legacyWorkflow =
    "jobs:\n  gate:\n    uses: JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1\n";
  try {
    initializeGitRepository(targetRoot);
    mkdirSync(workflowsDirectory, { recursive: true });
    writeFileSync(workflowPath, legacyWorkflow, "utf8");

    const dryRun = runBootstrap(["--prepare-worktree", targetRoot]);
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /Dry run: would replace the canonical-path v1 caller with the v2 verifier/u);
    assert.match(dryRun.stdout, /Dry run: would install the canonical v2 controller workflow/u);
    assert.equal(readFileSync(workflowPath, "utf8"), legacyWorkflow);

    const apply = runBootstrap(["--prepare-worktree", targetRoot, "--apply"]);
    assert.equal(apply.status, 0, apply.stderr);
    assert.match(apply.stdout, /Applied: replace the canonical-path v1 caller with the v2 verifier/u);
    assert.equal(readFileSync(workflowPath, "utf8"), CANONICAL_WORKFLOW);

    const repeat = runBootstrap(["--prepare-worktree", targetRoot, "--apply"]);
    assert.equal(repeat.status, 0, repeat.stderr);
    assert.match(repeat.stdout, /local verifier already matches the canonical v2 bytes/u);
    assert.match(repeat.stdout, /local controller already matches the canonical v2 bytes/u);
  } finally {
    rmSync(targetRoot, { recursive: true, force: true });
  }
});

test("prepare-worktree explicitly installs, retains, and removes the exact legacy bridge", () => {
  const targetRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-bridge-"));
  const workflowsDirectory = join(targetRoot, ".github", "workflows");
  const verifierPath = join(targetRoot, ...DEFAULT_WORKFLOW_PATH.split("/"));
  const controllerPath = join(
    targetRoot,
    ...DEFAULT_CONTROLLER_WORKFLOW_PATH.split("/"),
  );
  const bridgePath = join(
    targetRoot,
    ...DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH.split("/"),
  );
  const codeownersPath = join(targetRoot, ".github", "CODEOWNERS");
  const legacyVerifier =
    "jobs:\n  gate:\n    uses: JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1\n";
  try {
    initializeGitRepository(targetRoot);
    const finalClosureArgs = prepareFinalClosureReceipt(targetRoot);
    const finalClosureEnv = finalClosureGhEnvironment(targetRoot);
    mkdirSync(workflowsDirectory, { recursive: true });
    writeFileSync(verifierPath, legacyVerifier, "utf8");

    const dryRun = runBootstrap([
      "--prepare-worktree",
      targetRoot,
      "--legacy-bridge",
    ]);
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /install the exact temporary legacy bridge workflow/u);
    assert.match(dryRun.stdout, /replace the canonical-path v1 caller/u);
    assert.equal(existsSync(bridgePath), false);
    assert.equal(existsSync(controllerPath), false);
    assert.equal(existsSync(codeownersPath), false);
    assert.equal(readFileSync(verifierPath, "utf8"), legacyVerifier);

    const apply = runBootstrap([
      "--prepare-worktree",
      targetRoot,
      "--legacy-bridge",
      "--apply",
    ]);
    assert.equal(apply.status, 0, apply.stderr);
    assert.equal(readFileSync(verifierPath, "utf8"), CANONICAL_WORKFLOW);
    assert.equal(readFileSync(controllerPath, "utf8"), CANONICAL_CONTROLLER_WORKFLOW);
    assert.equal(
      readFileSync(bridgePath, "utf8"),
      CANONICAL_LEGACY_BRIDGE_WORKFLOW,
    );
    validateControlPlaneCodeownersContent(
      readFileSync(codeownersPath, "utf8"),
      DEFAULT_CONTROL_PLANE_OWNER,
    );

    const repeat = runBootstrap([
      "--prepare-worktree",
      targetRoot,
      "--legacy-bridge",
      "--apply",
    ]);
    assert.equal(repeat.status, 0, repeat.stderr);
    assert.match(repeat.stdout, /legacy bridge already matches the canonical bytes/u);

    const strict = runBootstrap(["--prepare-worktree", targetRoot, "--apply"]);
    assert.equal(strict.status, 1);
    assert.match(strict.stderr, /Additional workflows have a v1\/v2 gate caller/u);
    assert.equal(readFileSync(bridgePath, "utf8"), CANONICAL_LEGACY_BRIDGE_WORKFLOW);

    const removalDryRun = runBootstrap([
      "--prepare-worktree",
      targetRoot,
      "--remove-legacy-bridge",
      ...finalClosureArgs,
    ], { env: finalClosureEnv });
    assert.equal(removalDryRun.status, 0, removalDryRun.stderr);
    assert.match(removalDryRun.stdout, /remove the exact temporary legacy bridge/u);
    assert.equal(existsSync(bridgePath), true);

    const removal = runBootstrap([
      "--prepare-worktree",
      targetRoot,
      "--remove-legacy-bridge",
      ...finalClosureArgs,
      "--apply",
    ], { env: finalClosureEnv });
    assert.equal(removal.status, 0, removal.stderr);
    assert.match(removal.stdout, /Applied: remove the exact temporary legacy bridge/u);
    assert.equal(existsSync(bridgePath), false);

    const removalRepeat = runBootstrap([
      "--prepare-worktree",
      targetRoot,
      "--remove-legacy-bridge",
      ...finalClosureArgs,
      "--apply",
    ], { env: finalClosureEnv });
    assert.equal(removalRepeat.status, 0, removalRepeat.stderr);
    assert.match(removalRepeat.stdout, /legacy bridge is already absent/u);
    const strictAfterRemoval = runBootstrap([
      "--prepare-worktree",
      targetRoot,
      "--apply",
    ]);
    assert.equal(strictAfterRemoval.status, 0, strictAfterRemoval.stderr);
  } finally {
    rmSync(targetRoot, { recursive: true, force: true });
  }
});

test("legacy bridge removal requires an exact repository-bound final closure receipt", () => {
  for (const scenario of [
    {
      name: "missing-proof",
      prepare: () => [],
      expected: /requires --final-closure-receipt/u,
    },
    {
      name: "wrong-repository",
      prepare: (targetRoot) => prepareFinalClosureReceipt(targetRoot, {
        repoSlug: "Joey-Tools/other-consumer",
        originRepoSlug: "Joey-Tools/consumer",
      }),
      expected: /not authorized for bridge removal/u,
    },
    {
      name: "historical-v1-origin",
      prepare: (targetRoot) => prepareFinalClosureReceipt(targetRoot, {
        format: "v1",
      }),
      expected: /not authorized for bridge removal/u,
    },
    {
      name: "v2-archived-legacy-only-origin",
      prepare: (targetRoot) => prepareFinalClosureReceipt(targetRoot, {
        originRepoSlug: "Joey-Tools/codex-waited-delivery",
      }),
      expected: /not authorized for bridge removal/u,
      codeownersContent: "# proof-admission-sentinel\n",
    },
    {
      name: "v2-observed-cohort-substitutes-archived-legacy-only",
      prepare: (targetRoot) => {
        const output = buildFinalClosureOutput();
        const substitutedRepositories =
          substituteArchivedLegacyOnlyReceiptRepository(
            output.final_closure_receipt.repositories,
          );
        output.final_closure_receipt.repositories = substitutedRepositories;
        refreshFinalClosureReceiptDigest(output);
        return prepareFinalClosureReceipt(targetRoot, { output });
      },
      expected: /must not authorize the current archived legacy-only repository/u,
      codeownersContent: "# proof-admission-sentinel\n",
      assertPreflightNoLocalMutation: true,
    },
    {
      name: "v2-manifest-and-observed-cohort-substitute-archived-legacy-only",
      prepare: (targetRoot) => {
        const output = buildFinalClosureOutput();
        const substitutedRepositories =
          substituteArchivedLegacyOnlyReceiptRepository(
            output.final_closure_receipt.repositories,
          );
        output.final_closure_receipt.repositories = substitutedRepositories;
        output.final_closure_receipt.manifest_repositories = structuredClone(
          substitutedRepositories,
        );
        refreshFinalClosureReceiptDigest(output);
        return prepareFinalClosureReceipt(targetRoot, { output });
      },
      expected: /must not authorize the current archived legacy-only repository/u,
      codeownersContent: "# proof-admission-sentinel\n",
      assertPreflightNoLocalMutation: true,
    },
    {
      name: "wrong-digest",
      prepare: (targetRoot) => {
        const args = prepareFinalClosureReceipt(targetRoot);
        args[3] = "f".repeat(64);
        return args;
      },
      expected: /does not match the admitted receipt/u,
    },
  ]) {
    const targetRoot = mkdtempSync(
      join(tmpdir(), `codex-review-gate-closure-${scenario.name}-`),
    );
    const bridgePath = join(
      targetRoot,
      ...DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH.split("/"),
    );
    try {
      initializeGitRepository(targetRoot);
      const finalClosureArgs = scenario.prepare(targetRoot);
      mkdirSync(join(targetRoot, ".github", "workflows"), { recursive: true });
      writeFileSync(
        join(targetRoot, ...DEFAULT_WORKFLOW_PATH.split("/")),
        CANONICAL_WORKFLOW,
        "utf8",
      );
      writeFileSync(
        join(targetRoot, ...DEFAULT_CONTROLLER_WORKFLOW_PATH.split("/")),
        CANONICAL_CONTROLLER_WORKFLOW,
        "utf8",
      );
      writeFileSync(bridgePath, CANONICAL_LEGACY_BRIDGE_WORKFLOW, "utf8");
      writeFileSync(
        join(targetRoot, ".github", "CODEOWNERS"),
        scenario.codeownersContent ?? ensureControlPlaneCodeownersContent(null).content,
        "utf8",
      );
      const result = runBootstrap([
        "--prepare-worktree",
        targetRoot,
        "--remove-legacy-bridge",
        ...finalClosureArgs,
        "--apply",
      ]);
      assert.equal(result.status, 1, `${scenario.name}: ${result.stderr}`);
      assert.match(result.stderr, scenario.expected, scenario.name);
      assert.equal(existsSync(bridgePath), true, scenario.name);
      assert.doesNotMatch(result.stdout, /Applied: remove/u, scenario.name);
      if (scenario.codeownersContent !== undefined) {
        assert.equal(
          readFileSync(join(targetRoot, ".github", "CODEOWNERS"), "utf8"),
          scenario.codeownersContent,
          `${scenario.name}: final closure admission must reject before local mutations`,
        );
      }
      if (scenario.assertPreflightNoLocalMutation === true) {
        assert.equal(
          readFileSync(
            join(targetRoot, ...DEFAULT_WORKFLOW_PATH.split("/")),
            "utf8",
          ),
          CANONICAL_WORKFLOW,
          `${scenario.name}: admission must reject before verifier mutation`,
        );
        assert.equal(
          readFileSync(
            join(targetRoot, ...DEFAULT_CONTROLLER_WORKFLOW_PATH.split("/")),
            "utf8",
          ),
          CANONICAL_CONTROLLER_WORKFLOW,
          `${scenario.name}: admission must reject before controller mutation`,
        );
      }
    } finally {
      rmSync(targetRoot, { recursive: true, force: true });
    }
  }
});

test("legacy bridge removal rebinds the live GitHub repository identity to the final receipt", () => {
  const expected = buildFinalClosureOutput().final_closure_receipt.repositories[0];
  for (const [name, mutate] of [
    ["replacement-id", (metadata) => { metadata.id += 1; }],
    ["replacement-node-id", (metadata) => { metadata.node_id = "R_kgDOReplacement"; }],
    ["default-branch-drift", (metadata) => { metadata.default_branch = "main"; }],
  ]) {
    const targetRoot = mkdtempSync(
      join(tmpdir(), `codex-review-gate-live-identity-${name}-`),
    );
    const bridgePath = join(
      targetRoot,
      ...DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH.split("/"),
    );
    try {
      initializeGitRepository(targetRoot);
      const finalClosureArgs = prepareFinalClosureReceipt(targetRoot);
      const metadata = structuredClone(expected);
      mutate(metadata);
      const finalClosureEnv = finalClosureGhEnvironment(targetRoot, {}, {
        repositoryMetadata: metadata,
      });
      mkdirSync(join(targetRoot, ".github", "workflows"), { recursive: true });
      writeFileSync(
        join(targetRoot, ...DEFAULT_WORKFLOW_PATH.split("/")),
        CANONICAL_WORKFLOW,
        "utf8",
      );
      writeFileSync(
        join(targetRoot, ...DEFAULT_CONTROLLER_WORKFLOW_PATH.split("/")),
        CANONICAL_CONTROLLER_WORKFLOW,
        "utf8",
      );
      writeFileSync(bridgePath, CANONICAL_LEGACY_BRIDGE_WORKFLOW, "utf8");
      writeFileSync(
        join(targetRoot, ".github", "CODEOWNERS"),
        ensureControlPlaneCodeownersContent(null).content,
        "utf8",
      );
      const result = runBootstrap([
        "--prepare-worktree",
        targetRoot,
        "--remove-legacy-bridge",
        ...finalClosureArgs,
        "--apply",
      ], { env: finalClosureEnv });
      assert.equal(result.status, 1, `${name}: ${result.stderr}`);
      assert.match(
        result.stderr,
        /GitHub origin repository identity or default branch changed/u,
        name,
      );
      assert.equal(existsSync(bridgePath), true, name);
      assert.doesNotMatch(result.stdout, /Applied: remove/u, name);
    } finally {
      rmSync(targetRoot, { recursive: true, force: true });
    }
  }
});

test("legacy bridge removal rereads origin after the second fake GitHub metadata lookup", () => {
  const targetRoot = mkdtempSync(
    join(tmpdir(), "codex-review-gate-live-origin-query-race-"),
  );
  const bridgePath = join(
    targetRoot,
    ...DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH.split("/"),
  );
  try {
    initializeGitRepository(targetRoot);
    const finalClosureArgs = prepareFinalClosureReceipt(targetRoot);
    const finalClosureEnv = finalClosureGhEnvironment(targetRoot, {}, {
      // Admission is the first live metadata lookup. The second lookup occurs
      // at the first planned removal boundary, after which the helper must
      // reread origin before it can create the quarantine or touch the bridge.
      originDriftOnLiveQuery: 2,
    });
    mkdirSync(join(targetRoot, ".github", "workflows"), { recursive: true });
    writeFileSync(
      join(targetRoot, ...DEFAULT_WORKFLOW_PATH.split("/")),
      CANONICAL_WORKFLOW,
      "utf8",
    );
    writeFileSync(
      join(targetRoot, ...DEFAULT_CONTROLLER_WORKFLOW_PATH.split("/")),
      CANONICAL_CONTROLLER_WORKFLOW,
      "utf8",
    );
    writeFileSync(bridgePath, CANONICAL_LEGACY_BRIDGE_WORKFLOW, "utf8");
    writeFileSync(
      join(targetRoot, ".github", "CODEOWNERS"),
      ensureControlPlaneCodeownersContent(null).content,
      "utf8",
    );
    const result = runBootstrap([
      "--prepare-worktree",
      targetRoot,
      "--remove-legacy-bridge",
      ...finalClosureArgs,
      "--apply",
    ], { env: finalClosureEnv });
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /Git origin repository changed during immediately before legacy bridge removal/u,
    );
    assert.equal(existsSync(bridgePath), true);
    assert.doesNotMatch(result.stdout, /Applied: remove/u);
  } finally {
    rmSync(targetRoot, { recursive: true, force: true });
  }
});

test("legacy bridge removal rejects same-slug recreated repository identity drift after a prior mutation", () => {
  const receiptRepository = buildFinalClosureOutput()
    .final_closure_receipt.repositories[0];
  for (const [name, mutate] of [
    ["id", (metadata) => { metadata.id += 1; }],
    ["node-id", (metadata) => { metadata.node_id = "R_kgDOSameSlugReplacement"; }],
    ["default-branch", (metadata) => { metadata.default_branch = "main"; }],
  ]) {
    const targetRoot = mkdtempSync(
      join(tmpdir(), `codex-review-gate-final-rename-${name}-`),
    );
    const workflowsDirectory = join(targetRoot, ".github", "workflows");
    const bridgePath = join(
      targetRoot,
      ...DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH.split("/"),
    );
    try {
      initializeGitRepository(targetRoot);
      const finalClosureArgs = prepareFinalClosureReceipt(targetRoot);
      const replacement = structuredClone(receiptRepository);
      mutate(replacement);
      const finalClosureEnv = finalClosureGhEnvironment(targetRoot, {}, {
        repositoryMetadataSequence: [
          receiptRepository,
          receiptRepository,
          receiptRepository,
          replacement,
        ],
      });
      mkdirSync(workflowsDirectory, { recursive: true });
      writeFileSync(
        join(targetRoot, ...DEFAULT_WORKFLOW_PATH.split("/")),
        CANONICAL_WORKFLOW,
        "utf8",
      );
      writeFileSync(
        join(targetRoot, ...DEFAULT_CONTROLLER_WORKFLOW_PATH.split("/")),
        CANONICAL_CONTROLLER_WORKFLOW,
        "utf8",
      );
      writeFileSync(bridgePath, CANONICAL_LEGACY_BRIDGE_WORKFLOW, "utf8");
      // This requires an earlier CODEOWNERS mutation, so the fourth query is
      // also a regression for drift after a preceding local mutation.
      writeFileSync(join(targetRoot, ".github", "CODEOWNERS"), "# retained ownership\n", "utf8");

      const result = runBootstrap([
        "--prepare-worktree",
        targetRoot,
        "--remove-legacy-bridge",
        ...finalClosureArgs,
        "--apply",
      ], { env: finalClosureEnv });
      assert.equal(result.status, 1, `${name}: ${result.stderr}`);
      assert.match(
        result.stderr,
        /GitHub origin repository identity or default branch changed during immediately before legacy bridge quarantine rename/u,
        name,
      );
      assert.match(result.stderr, /No workflow object was unlinked/u, name);
      assert.equal(readFileSync(bridgePath, "utf8"), CANONICAL_LEGACY_BRIDGE_WORKFLOW, name);
      const quarantineDirectories = readdirSync(workflowsDirectory, {
        withFileTypes: true,
      }).filter(
        (entry) => entry.isDirectory() && entry.name.startsWith(".codex-review-gate-removal-"),
      );
      assert.equal(quarantineDirectories.length, 1, name);
      assert.equal(
        existsSync(join(
          workflowsDirectory,
          quarantineDirectories[0].name,
          "canonical-legacy-bridge.yml",
        )),
        false,
        name,
      );
      assert.doesNotMatch(result.stdout, /Applied: remove|Next:/u, name);
    } finally {
      rmSync(targetRoot, { recursive: true, force: true });
    }
  }
});

test("legacy bridge removal stops before its final quarantine rename when origin drifts after a prior mutation", () => {
  const targetRoot = mkdtempSync(
    join(tmpdir(), "codex-review-gate-final-rename-origin-drift-"),
  );
  const workflowsDirectory = join(targetRoot, ".github", "workflows");
  const bridgePath = join(
    targetRoot,
    ...DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH.split("/"),
  );
  try {
    initializeGitRepository(targetRoot);
    const finalClosureArgs = prepareFinalClosureReceipt(targetRoot);
    const finalClosureEnv = finalClosureGhEnvironment(targetRoot, {}, {
      // The first query authorizes the preceding CODEOWNERS install; the
      // fourth is the final live binding check immediately before the bridge
      // path can be renamed into quarantine.
      originDriftOnLiveQuery: 4,
    });
    mkdirSync(workflowsDirectory, { recursive: true });
    writeFileSync(
      join(targetRoot, ...DEFAULT_WORKFLOW_PATH.split("/")),
      CANONICAL_WORKFLOW,
      "utf8",
    );
    writeFileSync(
      join(targetRoot, ...DEFAULT_CONTROLLER_WORKFLOW_PATH.split("/")),
      CANONICAL_CONTROLLER_WORKFLOW,
      "utf8",
    );
    writeFileSync(bridgePath, CANONICAL_LEGACY_BRIDGE_WORKFLOW, "utf8");
    writeFileSync(
      join(targetRoot, ".github", "CODEOWNERS"),
      "# retained ownership\n",
      "utf8",
    );
    const preloadPath = join(targetRoot, "final-rename-origin-drift.cjs");
    const bridgeMutationLog = join(targetRoot, "bridge-mutation-calls.log");
    writeFileSync(preloadPath, localApplyRacePreloadSource(), "utf8");

    const result = runBootstrap([
      "--prepare-worktree",
      targetRoot,
      "--remove-legacy-bridge",
      ...finalClosureArgs,
      "--apply",
    ], {
      env: {
        ...finalClosureEnv,
        NODE_OPTIONS: `--require=${preloadPath}`,
        CODEX_BOOTSTRAP_TEST_RACE_ROOT: targetRoot,
        CODEX_BOOTSTRAP_TEST_BRIDGE_MUTATION_LOG: bridgeMutationLog,
      },
    });

    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /Git origin repository changed during immediately before legacy bridge quarantine rename/u,
    );
    assert.match(
      result.stderr,
      /Partial local apply: completed CODEOWNERS/u,
    );
    assert.equal(
      readFileSync(join(targetRoot, ".github", "CODEOWNERS"), "utf8"),
      ensureControlPlaneCodeownersContent("# retained ownership\n").content,
      "the preceding local mutation must have completed before the final binding check",
    );
    assert.equal(readFileSync(bridgePath, "utf8"), CANONICAL_LEGACY_BRIDGE_WORKFLOW);
    assert.equal(
      existsSync(bridgeMutationLog),
      false,
      "origin drift at the final binding check must prevent bridge rename and unlink",
    );
    assert.doesNotMatch(result.stdout, /Applied: remove|Next:/u);
  } finally {
    rmSync(targetRoot, { recursive: true, force: true });
  }
});

test("legacy bridge removal stops before bridge rename or unlink after verifier and controller mutations drift origin", () => {
  const targetRoot = mkdtempSync(
    join(tmpdir(), "codex-review-gate-post-controller-origin-drift-"),
  );
  const workflowsDirectory = join(targetRoot, ".github", "workflows");
  const verifierPath = join(targetRoot, ...DEFAULT_WORKFLOW_PATH.split("/"));
  const controllerPath = join(
    targetRoot,
    ...DEFAULT_CONTROLLER_WORKFLOW_PATH.split("/"),
  );
  const bridgePath = join(
    targetRoot,
    ...DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH.split("/"),
  );
  try {
    initializeGitRepository(targetRoot);
    const finalClosureArgs = prepareFinalClosureReceipt(targetRoot);
    const finalClosureEnv = finalClosureGhEnvironment(targetRoot);
    mkdirSync(workflowsDirectory, { recursive: true });
    writeFileSync(
      verifierPath,
      "jobs:\n  gate:\n    uses: JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1\n",
      "utf8",
    );
    writeFileSync(bridgePath, CANONICAL_LEGACY_BRIDGE_WORKFLOW, "utf8");
    writeFileSync(
      join(targetRoot, ".github", "CODEOWNERS"),
      ensureControlPlaneCodeownersContent(null).content,
      "utf8",
    );
    const preloadPath = join(targetRoot, "post-controller-origin-drift.cjs");
    const bridgeMutationLog = join(targetRoot, "bridge-mutation-calls.log");
    writeFileSync(preloadPath, localApplyRacePreloadSource(), "utf8");

    const result = runBootstrap([
      "--prepare-worktree",
      targetRoot,
      "--remove-legacy-bridge",
      ...finalClosureArgs,
      "--apply",
    ], {
      env: {
        ...finalClosureEnv,
        NODE_OPTIONS: `--require=${preloadPath}`,
        CODEX_BOOTSTRAP_TEST_RACE_MODE: "removal-origin-drift-after-controller",
        CODEX_BOOTSTRAP_TEST_RACE_ROOT: targetRoot,
        CODEX_BOOTSTRAP_TEST_BRIDGE_MUTATION_LOG: bridgeMutationLog,
      },
    });

    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /Git origin repository changed during immediately before legacy bridge removal/u,
    );
    assert.match(
      result.stderr,
      /Partial local apply: completed verifier-workflow, controller-workflow/u,
    );
    assert.equal(readFileSync(verifierPath, "utf8"), CANONICAL_WORKFLOW);
    assert.equal(
      readFileSync(controllerPath, "utf8"),
      CANONICAL_CONTROLLER_WORKFLOW,
    );
    assert.equal(readFileSync(bridgePath, "utf8"), CANONICAL_LEGACY_BRIDGE_WORKFLOW);
    assert.equal(
      existsSync(bridgeMutationLog),
      false,
      "bridge rename and unlink must not be called after origin drift",
    );
    assert.equal(
      readdirSync(workflowsDirectory, { withFileTypes: true }).some(
        (entry) =>
          entry.isDirectory() &&
          entry.name.startsWith(".codex-review-gate-removal-"),
      ),
      false,
    );
    assert.doesNotMatch(result.stdout, /Applied:|Next:/u);
  } finally {
    rmSync(targetRoot, { recursive: true, force: true });
  }
});

test("legacy bridge removal restores the bridge when its remote binding drifts at the quarantine rename boundary", () => {
  for (const [mode, expected] of [
    [
      "removal-identity-drift-after-quarantine-rename",
      /GitHub origin repository identity or default branch changed during after legacy bridge quarantine rename and before unlink/u,
    ],
    [
      "removal-default-branch-drift-after-quarantine-rename",
      /GitHub origin repository identity or default branch changed during after legacy bridge quarantine rename and before unlink/u,
    ],
    [
      "removal-origin-drift-after-quarantine-rename",
      /Git origin repository changed during after legacy bridge quarantine rename and before unlink/u,
    ],
  ]) {
    const targetRoot = mkdtempSync(
      join(tmpdir(), `codex-review-gate-post-rename-binding-${mode}-`),
    );
    const workflowsDirectory = join(targetRoot, ".github", "workflows");
    const bridgePath = join(
      targetRoot,
      ...DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH.split("/"),
    );
    try {
      initializeGitRepository(targetRoot);
      const finalClosureArgs = prepareFinalClosureReceipt(targetRoot);
      const finalClosureEnv = finalClosureGhEnvironment(targetRoot);
      mkdirSync(workflowsDirectory, { recursive: true });
      writeFileSync(
        join(targetRoot, ...DEFAULT_WORKFLOW_PATH.split("/")),
        CANONICAL_WORKFLOW,
        "utf8",
      );
      writeFileSync(
        join(targetRoot, ...DEFAULT_CONTROLLER_WORKFLOW_PATH.split("/")),
        CANONICAL_CONTROLLER_WORKFLOW,
        "utf8",
      );
      writeFileSync(bridgePath, CANONICAL_LEGACY_BRIDGE_WORKFLOW, "utf8");
      const admittedBridge = lstatSync(bridgePath, { bigint: true });
      writeFileSync(
        join(targetRoot, ".github", "CODEOWNERS"),
        ensureControlPlaneCodeownersContent(null).content,
        "utf8",
      );
      const preloadPath = join(targetRoot, "post-rename-binding-race.cjs");
      writeFileSync(preloadPath, localApplyRacePreloadSource(), "utf8");

      const result = runBootstrap([
        "--prepare-worktree",
        targetRoot,
        "--remove-legacy-bridge",
        ...finalClosureArgs,
        "--apply",
      ], {
        env: {
          ...finalClosureEnv,
          NODE_OPTIONS: `--require=${preloadPath}`,
          CODEX_BOOTSTRAP_TEST_RACE_MODE: mode,
          CODEX_BOOTSTRAP_TEST_RACE_ROOT: targetRoot,
        },
      });

      assert.equal(result.status, 1, `${mode}: ${result.stderr}`);
      assert.match(result.stderr, expected, mode);
      assert.match(
        result.stderr,
        /admitted exact bridge remains installed/u,
        mode,
      );
      assert.equal(
        readFileSync(bridgePath, "utf8"),
        CANONICAL_LEGACY_BRIDGE_WORKFLOW,
        mode,
      );
      const restoredBridge = lstatSync(bridgePath, { bigint: true });
      assert.equal(restoredBridge.dev, admittedBridge.dev, mode);
      assert.equal(restoredBridge.ino, admittedBridge.ino, mode);
      assert.equal(
        readdirSync(workflowsDirectory, { withFileTypes: true }).some(
          (entry) =>
            entry.isDirectory() &&
            entry.name.startsWith(".codex-review-gate-removal-"),
        ),
        false,
        mode,
      );
      assert.doesNotMatch(result.stdout, /Applied:|Next:/u, mode);
    } finally {
      rmSync(targetRoot, { recursive: true, force: true });
    }
  }
});

test("prepare-worktree installs the bridge before replacing a canonical-path v1 producer", () => {
  const targetRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-bridge-order-"));
  const workflowsDirectory = join(targetRoot, ".github", "workflows");
  const verifierPath = join(targetRoot, ...DEFAULT_WORKFLOW_PATH.split("/"));
  const bridgePath = join(
    targetRoot,
    ...DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH.split("/"),
  );
  const legacyVerifier =
    "jobs:\n  gate:\n    uses: JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1\n";
  try {
    initializeGitRepository(targetRoot);
    mkdirSync(workflowsDirectory, { recursive: true });
    writeFileSync(verifierPath, legacyVerifier, "utf8");
    const preloadPath = join(targetRoot, "bridge-order.cjs");
    writeFileSync(preloadPath, localApplyRacePreloadSource(), "utf8");
    const result = runBootstrap([
      "--prepare-worktree",
      targetRoot,
      "--legacy-bridge",
      "--apply",
    ], {
      env: {
        ...process.env,
        NODE_OPTIONS: `--require=${preloadPath}`,
        CODEX_BOOTSTRAP_TEST_RACE_MODE: "bridge-verifier-fails",
        CODEX_BOOTSTRAP_TEST_RACE_ROOT: targetRoot,
      },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /synthetic verifier replacement failure/u);
    assert.match(result.stderr, /installed CODEOWNERS, legacy-bridge-workflow/u);
    assert.equal(readFileSync(verifierPath, "utf8"), legacyVerifier);
    assert.equal(readFileSync(bridgePath, "utf8"), CANONICAL_LEGACY_BRIDGE_WORKFLOW);
  } finally {
    rmSync(targetRoot, { recursive: true, force: true });
  }
});

test("prepare-worktree refuses removal of a drifted or displaced bridge", () => {
  for (const mode of ["drifted", "displaced"]) {
    const targetRoot = mkdtempSync(join(tmpdir(), `codex-review-gate-remove-${mode}-`));
    const workflowsDirectory = join(targetRoot, ".github", "workflows");
    const bridgePath = join(
      targetRoot,
      ...DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH.split("/"),
    );
    try {
      initializeGitRepository(targetRoot);
      const finalClosureArgs = prepareFinalClosureReceipt(targetRoot);
      mkdirSync(workflowsDirectory, { recursive: true });
      writeFileSync(
        join(targetRoot, ...DEFAULT_WORKFLOW_PATH.split("/")),
        CANONICAL_WORKFLOW,
        "utf8",
      );
      writeFileSync(
        join(targetRoot, ...DEFAULT_CONTROLLER_WORKFLOW_PATH.split("/")),
        CANONICAL_CONTROLLER_WORKFLOW,
        "utf8",
      );
      writeFileSync(
        join(targetRoot, ".github", "CODEOWNERS"),
        ensureControlPlaneCodeownersContent(null).content,
        "utf8",
      );
      if (mode === "drifted") {
        writeFileSync(
          bridgePath,
          CANONICAL_LEGACY_BRIDGE_WORKFLOW.replace(
            "  pull-requests: read",
            "  pull-requests: write",
          ),
          "utf8",
        );
      } else {
        writeFileSync(
          join(workflowsDirectory, "moved-legacy-bridge.yml"),
          CANONICAL_LEGACY_BRIDGE_WORKFLOW,
          "utf8",
        );
      }
      const removal = runBootstrap([
        "--prepare-worktree",
        targetRoot,
        "--remove-legacy-bridge",
        ...finalClosureArgs,
        "--apply",
      ]);
      assert.equal(removal.status, 1, `${mode}: ${removal.stderr}`);
      assert.match(
        removal.stderr,
        mode === "drifted"
          ? /may write only issues and legacy commit statuses|differs from the exact canonical bridge/u
          : /Additional workflows have a v1\/v2 gate caller/u,
      );
      if (mode === "drifted") {
        assert.equal(existsSync(bridgePath), true);
      }
    } finally {
      rmSync(targetRoot, { recursive: true, force: true });
    }
  }
});

test("legacy bridge removal fails closed across replacement, deletion, unlink, and post-unlink races", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-remove-race-"));
  try {
    for (const [mode, expected, expectedQuarantineDirectories, verify] of [
      [
        "removal-check-replacement",
        /object identity changed.*unverified replacement remains quarantined/su,
        1,
        ({ bridgePath, quarantinePath }) => {
          assert.equal(
            readFileSync(`${bridgePath}.admitted`, "utf8"),
            CANONICAL_LEGACY_BRIDGE_WORKFLOW,
          );
          assert.equal(
            readFileSync(quarantinePath, "utf8"),
            "attacker replacement\n",
          );
        },
      ],
      [
        "removal-check-delete",
        /ENOENT.*No workflow object was unlinked/su,
        1,
        ({ quarantinePath }) => {
          assert.equal(existsSync(quarantinePath), false);
        },
      ],
      [
        "removal-unlink-fails",
        /synthetic quarantine unlink failure.*admitted exact bridge remains quarantined/su,
        1,
        ({ quarantinePath }) => {
          assert.equal(
            readFileSync(quarantinePath, "utf8"),
            CANONICAL_LEGACY_BRIDGE_WORKFLOW,
          );
        },
      ],
      [
        "removal-post-unlink-checkpoint-fails",
        /access policy changed.*admitted exact bridge unlink completed.*no success was reported/su,
        1,
        ({ quarantinePath }) => {
          assert.equal(existsSync(quarantinePath), false);
        },
      ],
      [
        "removal-origin-drift-after-codeowners",
        /Git origin repository changed during immediately before legacy bridge removal/u,
        0,
        ({ bridgePath }) => {
          assert.equal(existsSync(bridgePath), true);
        },
      ],
    ]) {
      const targetRoot = join(fixtureRoot, mode);
      const workflowsDirectory = join(targetRoot, ".github", "workflows");
      const bridgePath = join(
        targetRoot,
        ...DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH.split("/"),
      );
      mkdirSync(targetRoot);
      initializeGitRepository(targetRoot);
      const finalClosureArgs = prepareFinalClosureReceipt(targetRoot);
      const finalClosureEnv = finalClosureGhEnvironment(targetRoot);
      mkdirSync(workflowsDirectory, { recursive: true });
      writeFileSync(
        join(targetRoot, ...DEFAULT_WORKFLOW_PATH.split("/")),
        CANONICAL_WORKFLOW,
        "utf8",
      );
      writeFileSync(
        join(targetRoot, ...DEFAULT_CONTROLLER_WORKFLOW_PATH.split("/")),
        CANONICAL_CONTROLLER_WORKFLOW,
        "utf8",
      );
      writeFileSync(bridgePath, CANONICAL_LEGACY_BRIDGE_WORKFLOW, "utf8");
      writeFileSync(
        join(targetRoot, ".github", "CODEOWNERS"),
        mode === "removal-origin-drift-after-codeowners"
          ? "# retained ownership\n"
          : ensureControlPlaneCodeownersContent(null).content,
        "utf8",
      );
      const preloadPath = join(targetRoot, "removal-race.cjs");
      writeFileSync(preloadPath, localApplyRacePreloadSource(), "utf8");
      const result = runBootstrap([
        "--prepare-worktree",
        targetRoot,
        "--remove-legacy-bridge",
        ...finalClosureArgs,
        "--apply",
      ], {
        env: {
          ...finalClosureEnv,
          NODE_OPTIONS: `--require=${preloadPath}`,
          CODEX_BOOTSTRAP_TEST_RACE_MODE: mode,
          CODEX_BOOTSTRAP_TEST_RACE_ROOT: targetRoot,
        },
      });
      assert.equal(result.status, 1, `${mode}: ${result.stderr}`);
      assert.match(result.stderr, expected, mode);
      assert.doesNotMatch(result.stdout, /Applied:|Next:/u, mode);
      const quarantineDirectories = readdirSync(workflowsDirectory, {
        withFileTypes: true,
      }).filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name.startsWith(".codex-review-gate-removal-"),
      );
      assert.equal(
        quarantineDirectories.length,
        expectedQuarantineDirectories,
        mode,
      );
      const quarantinePath = expectedQuarantineDirectories === 0
        ? null
        : join(
          workflowsDirectory,
          quarantineDirectories[0].name,
          "canonical-legacy-bridge.yml",
        );
      verify({ bridgePath, quarantinePath });
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("prepare-worktree preserves unrelated CODEOWNERS entries and is byte-idempotent", () => {
  const targetRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-bootstrap-"));
  const githubDirectory = join(targetRoot, ".github");
  const codeownersPath = join(githubDirectory, "CODEOWNERS");
  try {
    initializeGitRepository(targetRoot);
    mkdirSync(githubDirectory, { recursive: true });
    writeFileSync(codeownersPath, "/docs/** @DocsOwner\n", "utf8");

    const first = runBootstrap([
      "--prepare-worktree",
      targetRoot,
      "--control-plane-owner",
      "@Alice",
      "--apply",
    ]);
    assert.equal(first.status, 0, first.stderr);
    const firstContent = readFileSync(codeownersPath, "utf8");
    assert.match(firstContent, /^\/docs\/\*\* @DocsOwner\n/u);
    assert.match(firstContent, /\/\.github\/workflows\/ @Alice/u);
    assert.match(firstContent, /\/\.github\/CODEOWNERS @Alice/u);

    const repeat = runBootstrap([
      "--prepare-worktree",
      targetRoot,
      "--control-plane-owner",
      "@Alice",
      "--apply",
    ]);
    assert.equal(repeat.status, 0, repeat.stderr);
    assert.match(repeat.stdout, /CODEOWNERS already has canonical/u);
    assert.equal(readFileSync(codeownersPath, "utf8"), firstContent);
  } finally {
    rmSync(targetRoot, { recursive: true, force: true });
  }
});

test("prepare-worktree fails closed on an ambiguous managed CODEOWNERS block", () => {
  const targetRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-bootstrap-"));
  const githubDirectory = join(targetRoot, ".github");
  try {
    initializeGitRepository(targetRoot);
    mkdirSync(githubDirectory, { recursive: true });
    writeFileSync(
      join(githubDirectory, "CODEOWNERS"),
      "# BEGIN codex-review-gate control-plane\n",
      "utf8",
    );
    const result = runBootstrap([
      "--prepare-worktree",
      targetRoot,
      "--apply",
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ambiguous codex-review-gate managed block/u);
    assert.equal(
      existsSync(join(githubDirectory, "workflows", "codex-review-gate.yml")),
      false,
    );
  } finally {
    rmSync(targetRoot, { recursive: true, force: true });
  }
});

test("prepare-worktree refuses to shadow root or docs CODEOWNERS", () => {
  for (const relativePath of ["CODEOWNERS", "docs/CODEOWNERS"]) {
    for (const existingHighPrecedence of [false, true]) {
      const targetRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-bootstrap-"));
      try {
        initializeGitRepository(targetRoot);
        mkdirSync(join(targetRoot, ".github"), { recursive: true });
        mkdirSync(join(targetRoot, "docs"), { recursive: true });
        writeFileSync(join(targetRoot, relativePath), "* @ExistingOwner\n", "utf8");
        if (existingHighPrecedence) {
          writeFileSync(
            join(targetRoot, ".github", "CODEOWNERS"),
            ensureControlPlaneCodeownersContent(null).content,
            "utf8",
          );
        }
        const result = runBootstrap([
          "--prepare-worktree",
          targetRoot,
          "--apply",
        ]);
        assert.equal(
          result.status,
          1,
          `${relativePath}/${existingHighPrecedence}: ${result.stderr}`,
        );
        assert.match(result.stderr, /would shadow or already shadows it/u);
        assert.match(result.stderr, new RegExp(relativePath.replace("/", "\\/"), "u"));
        assert.equal(
          existsSync(join(targetRoot, ".github", "CODEOWNERS")),
          existingHighPrecedence,
        );
      } finally {
        rmSync(targetRoot, { recursive: true, force: true });
      }
    }
  }
});

test("prepare-worktree blocks additional v1 callers before writing", () => {
  const targetRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-bootstrap-"));
  const workflowsDirectory = join(targetRoot, ".github", "workflows");
  const workflowPath = join(workflowsDirectory, "codex-review-gate.yml");
  const legacyWorkflow =
    "jobs:\n  gate:\n    uses: JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1\n";
  try {
    initializeGitRepository(targetRoot);
    mkdirSync(workflowsDirectory, { recursive: true });
    writeFileSync(
      join(workflowsDirectory, "legacy-codex-review.yml"),
      legacyWorkflow,
      "utf8",
    );

    const apply = runBootstrap(["--prepare-worktree", targetRoot, "--apply"]);
    assert.equal(apply.status, 1);
    assert.match(apply.stderr, /Additional workflows have a v1\/v2 gate caller/u);
    assert.match(apply.stderr, /\.github\/workflows\/legacy-codex-review\.yml/u);
    assert.equal(existsSync(workflowPath), false);
  } finally {
    rmSync(targetRoot, { recursive: true, force: true });
  }
});

test("prepare-worktree blocks an additional direct v2 caller before writing", () => {
  const targetRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-bootstrap-"));
  const workflowsDirectory = join(targetRoot, ".github", "workflows");
  const workflowPath = join(workflowsDirectory, "codex-review-gate.yml");
  try {
    initializeGitRepository(targetRoot);
    mkdirSync(workflowsDirectory, { recursive: true });
    writeFileSync(
      join(workflowsDirectory, "duplicate-v2.yml"),
      "jobs:\n  duplicate:\n    uses: JoeyTeng/codex-review-gate-action@v2\n",
      "utf8",
    );

    const apply = runBootstrap(["--prepare-worktree", targetRoot, "--apply"]);
    assert.equal(apply.status, 1);
    assert.match(apply.stderr, /Additional workflows have a v1\/v2 gate caller/u);
    assert.match(apply.stderr, /\.github\/workflows\/duplicate-v2\.yml/u);
    assert.equal(existsSync(workflowPath), false);
  } finally {
    rmSync(targetRoot, { recursive: true, force: true });
  }
});

test("prepare-worktree rebinds the full local security inventory and reports partial apply", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-local-race-"));
  try {
    for (const [mode, expected, verify] of [
      [
        "pre-first-rename",
        /Additional workflows have a v1\/v2 gate caller|Local workflow\/CODEOWNERS security inventory changed/u,
        (targetRoot, result) => {
          assert.equal(
            existsSync(join(targetRoot, ".github", "CODEOWNERS")),
            false,
          );
          assert.doesNotMatch(result.stdout, /Applied:|Next:/u);
        },
      ],
      [
        "second-rename-fails",
        /Partial local apply: installed CODEOWNERS.*verifier-workflow, controller-workflow were not installed or verified/su,
        (targetRoot, result) => {
          assert.equal(existsSync(join(targetRoot, ".github", "CODEOWNERS")), true);
          assert.equal(
            existsSync(join(targetRoot, ".github", "workflows", "codex-review-gate.yml")),
            false,
          );
          assert.doesNotMatch(result.stdout, /Applied:|Next:/u);
        },
      ],
      [
        "final-boundary",
        /Partial local apply: installed CODEOWNERS, verifier-workflow, controller-workflow.*final security closure was not verified/su,
        (_targetRoot, result) => {
          assert.doesNotMatch(result.stdout, /Applied:|Next:/u);
        },
      ],
    ]) {
      const targetRoot = join(fixtureRoot, mode);
      mkdirSync(targetRoot);
      initializeGitRepository(targetRoot);
      const preloadPath = join(fixtureRoot, `${mode}.cjs`);
      writeFileSync(preloadPath, localApplyRacePreloadSource(), "utf8");
      const result = runBootstrap([
        "--prepare-worktree",
        targetRoot,
        "--apply",
      ], {
        env: {
          ...process.env,
          NODE_OPTIONS: `--require=${preloadPath}`,
          CODEX_BOOTSTRAP_TEST_RACE_MODE: mode,
          CODEX_BOOTSTRAP_TEST_RACE_ROOT: targetRoot,
        },
      });
      assert.equal(result.status, 1, `${mode}: ${result.stderr}`);
      assert.match(result.stderr, expected, mode);
      verify(targetRoot, result);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("prepare-worktree rejects a symlinked workflow parent without writing outside", () => {
  const targetRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-bootstrap-"));
  const outsideRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-outside-"));
  try {
    initializeGitRepository(targetRoot);
    symlinkSync(outsideRoot, join(targetRoot, ".github"));

    const apply = runBootstrap(["--prepare-worktree", targetRoot, "--apply"]);
    assert.equal(apply.status, 1);
    assert.match(apply.stderr, /\.github parent must not be a symbolic link/u);
    assert.equal(existsSync(join(outsideRoot, "workflows")), false);
  } finally {
    rmSync(targetRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test("prepare-worktree rejects arbitrary .git markers", () => {
  const directoryMarkerRoot = mkdtempSync(
    join(tmpdir(), "codex-review-gate-fake-git-dir-"),
  );
  const fileMarkerRoot = mkdtempSync(
    join(tmpdir(), "codex-review-gate-fake-git-file-"),
  );
  try {
    mkdirSync(join(directoryMarkerRoot, ".git"));
    writeFileSync(
      join(fileMarkerRoot, ".git"),
      `gitdir: ${join(fileMarkerRoot, "missing-admin")}\n`,
      "utf8",
    );

    for (const targetRoot of [directoryMarkerRoot, fileMarkerRoot]) {
      const apply = runBootstrap(["--prepare-worktree", targetRoot, "--apply"]);
      assert.equal(apply.status, 1);
      assert.match(apply.stderr, /not a valid Git worktree/u);
      assert.equal(
        existsSync(join(targetRoot, ".github", "workflows", "codex-review-gate.yml")),
        false,
      );
    }
  } finally {
    rmSync(directoryMarkerRoot, { recursive: true, force: true });
    rmSync(fileMarkerRoot, { recursive: true, force: true });
  }
});

test("prepare-worktree accepts a real linked worktree with a matching backpointer", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-linked-"));
  const repositoryRoot = join(fixtureRoot, "repository");
  const linkedRoot = join(fixtureRoot, "linked");
  try {
    mkdirSync(repositoryRoot);
    initializeGitRepository(repositoryRoot);
    writeFileSync(join(repositoryRoot, "seed.txt"), "seed\n", "utf8");
    runGit(["-C", repositoryRoot, "add", "seed.txt"]);
    runGit([
      "-C",
      repositoryRoot,
      "-c",
      "user.name=Codex Test",
      "-c",
      "user.email=codex-test@example.invalid",
      "commit",
      "--quiet",
      "--no-gpg-sign",
      "-m",
      "seed",
    ]);
    runGit(["-C", repositoryRoot, "worktree", "add", "--quiet", "--detach", linkedRoot]);

    const apply = runBootstrap(["--prepare-worktree", linkedRoot, "--apply"]);
    assert.equal(apply.status, 0, apply.stderr);
    assert.equal(
      readFileSync(
        join(linkedRoot, ".github", "workflows", "codex-review-gate.yml"),
        "utf8",
      ),
      CANONICAL_WORKFLOW,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("prepare-worktree rejects a linked-worktree admin backpointer mismatch", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-linked-"));
  const repositoryRoot = join(fixtureRoot, "repository");
  const linkedRoot = join(fixtureRoot, "linked");
  try {
    mkdirSync(repositoryRoot);
    initializeGitRepository(repositoryRoot);
    writeFileSync(join(repositoryRoot, "seed.txt"), "seed\n", "utf8");
    runGit(["-C", repositoryRoot, "add", "seed.txt"]);
    runGit([
      "-C",
      repositoryRoot,
      "-c",
      "user.name=Codex Test",
      "-c",
      "user.email=codex-test@example.invalid",
      "commit",
      "--quiet",
      "--no-gpg-sign",
      "-m",
      "seed",
    ]);
    runGit(["-C", repositoryRoot, "worktree", "add", "--quiet", "--detach", linkedRoot]);
    const marker = readFileSync(join(linkedRoot, ".git"), "utf8");
    const declaredAdmin = marker.replace(/^gitdir: /u, "").trim();
    const adminDirectory = resolve(linkedRoot, declaredAdmin);
    writeFileSync(
      join(adminDirectory, "gitdir"),
      `${join(repositoryRoot, "seed.txt")}\n`,
      "utf8",
    );

    const apply = runBootstrap(["--prepare-worktree", linkedRoot, "--apply"]);
    assert.equal(apply.status, 1);
    assert.match(apply.stderr, /backpointer does not return/u);
    assert.equal(existsSync(join(linkedRoot, ".github")), false);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("bootstrap rejects a status context the v2 runtime cannot publish", () => {
  const targetRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-context-"));
  try {
    const result = runBootstrap([
      "--prepare-worktree",
      targetRoot,
      "--context",
      "attacker/chosen-status",
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--context is fixed to "codex\/github-review-gate"/u);
  } finally {
    rmSync(targetRoot, { recursive: true, force: true });
  }
});

test("parent revalidation rejects replacement by a symlink", () => {
  const targetRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-witness-"));
  const outsideRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-outside-"));
  const parentPath = join(targetRoot, ".github");
  try {
    mkdirSync(parentPath);
    const witness = directoryWitnessFromMetadata(
      parentPath,
      lstatSync(parentPath, { bigint: true }),
      ".github parent",
    );
    rmSync(parentPath, { recursive: true });
    symlinkSync(outsideRoot, parentPath);

    assert.throws(
      () =>
        assertDirectoryWitnessStable(
          witness,
          lstatSync(parentPath, { bigint: true }),
          "test replacement",
        ),
      /Verified parent must not be a symbolic link/u,
    );
  } finally {
    rmSync(targetRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test("parent revalidation distinguishes identity and access-policy changes", () => {
  const targetRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-witness-"));
  const identityPath = join(targetRoot, "identity-parent");
  const replacementPath = join(targetRoot, "replacement-parent");
  const displacedPath = join(targetRoot, "displaced-parent");
  const policyPath = join(targetRoot, "policy-parent");
  try {
    mkdirSync(identityPath);
    mkdirSync(replacementPath);
    const identityWitness = directoryWitnessFromMetadata(
      identityPath,
      lstatSync(identityPath, { bigint: true }),
    );
    renameSync(identityPath, displacedPath);
    renameSync(replacementPath, identityPath);
    assert.throws(
      () =>
        assertDirectoryWitnessStable(
          identityWitness,
          lstatSync(identityPath, { bigint: true }),
          "identity replacement",
        ),
      /object identity changed/u,
    );

    mkdirSync(policyPath, { mode: 0o755 });
    const policyWitness = directoryWitnessFromMetadata(
      policyPath,
      lstatSync(policyPath, { bigint: true }),
    );
    chmodSync(policyPath, 0o700);
    assert.throws(
      () =>
        assertDirectoryWitnessStable(
          policyWitness,
          lstatSync(policyPath, { bigint: true }),
          "access-policy replacement",
        ),
      /access policy changed/u,
    );
  } finally {
    rmSync(targetRoot, { recursive: true, force: true });
  }
});

test("parent revalidation ignores benign child-entry churn", () => {
  const targetRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-witness-"));
  const parentPath = join(targetRoot, "parent");
  try {
    mkdirSync(parentPath);
    const witness = directoryWitnessFromMetadata(
      parentPath,
      lstatSync(parentPath, { bigint: true }),
      "parent",
    );

    writeFileSync(join(parentPath, "ordinary-child"), "ordinary churn\n", "utf8");

    assert.doesNotThrow(() =>
      assertDirectoryWitnessStable(
        witness,
        lstatSync(parentPath, { bigint: true }),
        "benign child-entry churn",
      ),
    );
  } finally {
    rmSync(targetRoot, { recursive: true, force: true });
  }
});

test("validates exact canonical v2 workflow shape and remote bytes", () => {
  const canonical = canonicalWorkflowFixture();
  assert.equal(validateCanonicalV2WorkflowContent(canonical), canonical);
  for (const [name, invalid] of [
    [
      "omitted run-name",
      canonical.replace(`run-name: ${DEFAULT_VERIFIER_RUN_NAME}\n`, ""),
    ],
    [
      "tampered run-name",
      canonical.replace(DEFAULT_VERIFIER_RUN_NAME, "attacker/${{ github.sha }}"),
    ],
    [
      "duplicate quoted run-name",
      canonical.replace(
        `run-name: ${DEFAULT_VERIFIER_RUN_NAME}\n`,
        `run-name: ${DEFAULT_VERIFIER_RUN_NAME}\n'run-name': attacker\n`,
      ),
    ],
  ]) {
    assert.throws(
      () => validateCanonicalV2WorkflowContent(invalid),
      /exactly one top-level run-name/u,
      name,
    );
  }
  assert.equal(installedWorkflowMatchesCanonical(canonical, canonical), true);
  assert.equal(installedWorkflowMatchesCanonical(`${canonical}\n`, canonical), false);
  assert.equal(workflowContainsLegacyV1Caller(canonical), false);
  assert.equal(
    workflowContainsLegacyV1Caller(
      canonical.replace(
        `${CANONICAL_V2_WORKFLOW_USES}`,
        "JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1",
      ),
    ),
    true,
  );
  for (const caller of [
    "JoeyTeng/codex-review-gate-action@v2",
    "JoeyTeng/codex-review-gate-action@v3",
    "JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v2",
  ]) {
    assert.equal(
      workflowContainsCodexReviewGateCaller(`jobs:\n  gate:\n    uses: ${caller}\n`),
      true,
      caller,
    );
  }
  assert.equal(
    workflowContainsCodexReviewGateCaller(
      "jobs:\n  test:\n    uses: actions/checkout@v4\n",
    ),
    false,
  );
  for (const opaqueUses of [
    "jobs:\n  gate:\n    uses: >-\n      JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1\n",
    "jobs:\n  gate:\n    uses: \"JoeyTeng/codex-review-gate-action\\\n      @v2\"\n",
  ]) {
    assert.throws(
      () => workflowContainsCodexReviewGateCaller(opaqueUses),
      /opaque, escaped, flow-style, or multiline uses scalar/u,
    );
  }
  assert.equal(workflowCanWriteStatuses("name: Test\non: [push]\njobs: {}\n"), false);
  assert.equal(
    workflowCanWriteStatuses(
      "permissions:\n  contents: read\njobs:\n  test:\n    permissions:\n      statuses: write\n",
    ),
    true,
  );
  assert.equal(workflowCanWriteStatuses("permissions: write-all\njobs: {}\n"), true);
  assert.throws(
    () =>
      workflowCanWriteStatuses(
        "permissions: { contents: read, statuses: write }\njobs: {}\n",
      ),
    /flow-style permissions mapping/u,
  );
  assert.equal(workflowCanWriteStatuses("permissions:\n  statuses : write\n"), true);
  assert.equal(
    workflowCanWriteStatuses("permissions:\r\n  statuses: write\r\njobs: {}\r\n"),
    true,
  );
  for (const [name, inspect] of [
    [
      "permissions",
      () =>
        workflowCanWriteStatuses(
          "permissions:\r  statuses: write\njobs: {}\n",
        ),
    ],
    [
      "job-name",
      () =>
        workflowSingleProducerPolicyViolations(
          "permissions: {}\rjobs:\r  collision:\r    name: codex/github-review-gate\n",
        ),
    ],
    [
      "caller",
      () =>
        workflowContainsCodexReviewGateCaller(
          "jobs:\r  gate:\r    uses: JoeyTeng/codex-review-gate-action@v2\n",
        ),
    ],
    [
      "legacy-caller",
      () =>
        workflowContainsLegacyV1Caller(
          "jobs:\r  gate:\r    uses: JoeyTeng/codex-review-gate-action@v1\n",
        ),
    ],
  ]) {
    assert.throws(inspect, /bare CR YAML line break/u, name);
  }
  for (const lineBrokenFlow of [
    "permissions:\n  {statuses: write}\njobs: {}\n",
    "jobs:\n  test:\n    permissions:\n      {statuses: write}\n    runs-on: ubuntu-slim\n",
  ]) {
    assert.throws(
      () => workflowCanWriteStatuses(lineBrokenFlow),
      /line-broken flow-style permissions mapping/u,
    );
  }
  assert.deepEqual(
    workflowSingleProducerPolicyViolations(
      "permissions:\n  checks: read\n  issues: none\n  pull-requests: read\n  statuses: none\njobs:\n  test:\n    name: ordinary test\n    runs-on: ubuntu-slim\n",
    ),
    [],
  );
  for (const permission of ["checks", "issues", "pull-requests", "statuses"]) {
    assert.deepEqual(
      workflowSingleProducerPolicyViolations(
        `permissions:\n  ${permission}: write\njobs: {}\n`,
      ),
      [`${permission}: write`],
      permission,
    );
  }
  assert.deepEqual(
    workflowSingleProducerPolicyViolations(
      "permissions: write-all\njobs: {}\n",
    ),
    [
      "actions: write",
      "checks: write",
      "issues: write",
      "pull-requests: write",
      "statuses: write",
    ],
  );
  assert.deepEqual(
    workflowSingleProducerPolicyViolations(
      "permissions:\n  contents: read\njobs:\n  collision:\n    name: codex/github-review-gate\n    runs-on: ubuntu-slim\n",
    ),
    [`job name: ${DEFAULT_STATUS_CONTEXT}`],
  );
  for (const indicator of [">-", "|-"]) {
    assert.deepEqual(
      workflowSingleProducerPolicyViolations(
        `permissions: {}\njobs:\n  test:\n    runs-on: ubuntu-slim\n    name: ${indicator}\n      ordinary test\n`,
      ),
      [],
      indicator,
    );
  }
  assert.deepEqual(
    workflowSingleProducerPolicyViolations(
      "permissions: {}\njobs:\n  collision:\n    name: >-\n      codex/github-review-gate\n    runs-on: ubuntu-slim\n",
    ),
    [`job name: ${DEFAULT_STATUS_CONTEXT}`],
  );
  assert.throws(
    () =>
      workflowSingleProducerPolicyViolations(
        "permissions: {}\njobs:\n  test:\n    name: >-\n      ordinary\n      second line\n    runs-on: ubuntu-slim\n",
      ),
    /multiple or ambiguous physical content lines/u,
  );
  assert.throws(
    () =>
      workflowSingleProducerPolicyViolations(
        "permissions: {}\njobs:\n  test:\n    name: >2-\n      ordinary test\n    runs-on: ubuntu-slim\n",
      ),
    /unsupported block-scalar job name indicator/u,
  );
  assert.deepEqual(
    workflowSingleProducerPolicyViolations(
      "permissions: {}\n\"jobs\":\n  \"collision\":\n    \"name\": \"codex/github-review-gate\"\n    runs-on: ubuntu-slim\n",
    ),
    [`job name: ${DEFAULT_STATUS_CONTEXT}`],
  );
  assert.deepEqual(
    workflowSingleProducerPolicyViolations(
      "permissions: {}\njobs:\n  collision:\n    name: ${{ matrix.check_name }}\n    runs-on: ubuntu-slim\n    strategy:\n      matrix:\n        check_name: [codex/github-review-gate]\n",
    ),
    [`job name: ${DEFAULT_STATUS_CONTEXT}`],
  );
  assert.deepEqual(
    workflowSingleProducerPolicyViolations(
      "permissions: {}\njobs:\n  collision:\n    name: ${{ contains('}}', 'never') && 'x' || matrix.check_name }}\n    runs-on: ubuntu-slim\n",
    ),
    [`job name: ${DEFAULT_STATUS_CONTEXT}`],
  );
  assert.deepEqual(
    workflowSingleProducerPolicyViolations(
      "permissions: {}\njobs:\n  matrix-test:\n    name: test-${{ matrix.os }}\n    runs-on: ubuntu-slim\n",
    ),
    [],
  );
  assert.throws(
    () =>
      workflowSingleProducerPolicyViolations(
        "permissions: {}\njobs:\n  collision:\n    name: \"codex/github-review-\n      gate\"\n    runs-on: ubuntu-slim\n",
      ),
    /multiline or unterminated quoted job name/u,
  );
  assert.deepEqual(
    workflowSingleProducerPolicyViolations(
      "name: codex/github-review-gate\npermissions: {}\njobs:\n  test:\n    name: ordinary test\n    runs-on: ubuntu-slim\n    steps:\n      - name: codex/github-review-gate\n        run: 'true'\n",
    ),
    [],
  );
  for (const quoted of [
    "permissions:\n  \"statuses\": write\njobs: {}\n",
    "permissions:\n  'statuses': write\njobs: {}\n",
    "jobs:\n  test:\n    permissions:\n      \"statuses\": write\n",
    '{"name":"x","on":"push","permissions":{"statuses":"write"},"jobs":{}}\n',
  ]) {
    assert.throws(
      () => workflowCanWriteStatuses(quoted),
      /quoted protected permissions key|opaque permissions entry/u,
    );
  }
  for (const escaped of [
    '"per\\u006dissions":\n  statuses: write\njobs: {}\n',
    'permissions:\n  "stat\\u0075ses": write\njobs: {}\n',
    '{"name":"x","on":"push","per\\u006dissions":{"stat\\u0075ses":"write"},"jobs":{}}\n',
  ]) {
    assert.throws(
      () => workflowCanWriteStatuses(escaped),
      /escaped double-quoted mapping key|opaque permissions entry/u,
    );
  }
  assert.throws(
    () => workflowCanWriteStatuses("? permissions\n:\n  statuses: write\njobs: {}\n"),
    /explicit YAML mapping key/u,
  );
  assert.throws(
    () => workflowCanWriteStatuses("{ ? permissions : { statuses: write }, jobs: {} }\n"),
    /explicit YAML mapping key/u,
  );
  assert.throws(
    () =>
      workflowCanWriteStatuses(
        "{name: x#y, on: push, permissions: {statuses: write}, jobs: {}}\n",
      ),
    /nested flow-style permissions mapping/u,
  );
  assert.throws(
    () => workflowCanWriteStatuses("!!str permissions:\n  statuses: write\njobs: {}\n"),
    /YAML tags, anchors, or aliases/u,
  );
  for (const tagged of [
    "!!str &p permissions:\n  statuses: write\njobs: {}\n",
    "&p !!str permissions:\n  statuses: write\njobs: {}\n",
    "!!str \"permissions\":\n  statuses: write\njobs: {}\n",
    "&p \"permissions\":\n  statuses: write\njobs: {}\n",
    "env:\n  P: !!str &p permissions\n*p:\n  statuses: write\njobs: {}\n",
  ]) {
    assert.throws(
      () => workflowCanWriteStatuses(tagged),
      /YAML tags, anchors, or aliases/u,
    );
  }
  assert.equal(
    workflowCanWriteStatuses("\uFEFFpermissions:\n  statuses: write\njobs: {}\n"),
    true,
  );
  assert.throws(
    () => workflowCanWriteStatuses("permissions:\u0085  statuses: write\u0085jobs: {}\n"),
    /non-ASCII YAML line separator/u,
  );
  assert.equal(
    workflowContainsLegacyV1Caller(
      canonical.replace(
        `${CANONICAL_V2_WORKFLOW_USES}`,
        "JoeyTeng/codex-review-gate-action@v1",
      ),
    ),
    true,
  );

  const encoded = Buffer.from(canonical, "utf8").toString("base64");
  assert.equal(
    decodeGitHubFileContent({ type: "file", encoding: "base64", content: encoded }),
    canonical,
  );
  assert.equal(
    decodeGitHubBlobContent({ encoding: "base64", content: encoded }),
    canonical,
  );
  assert.throws(
    () => decodeGitHubFileContent({ type: "file", encoding: "none", content: canonical }),
    /base64-encoded file/,
  );
  assert.equal(
    validateCanonicalV2ControllerWorkflowContent(CANONICAL_CONTROLLER_WORKFLOW),
    CANONICAL_CONTROLLER_WORKFLOW,
  );
  assert.throws(
    () =>
      validateCanonicalV2WorkflowContent(
        canonical.replace(
          "  pull_request:\n",
          "  schedule:\n    - cron: '0 * * * *'\n  pull_request:\n",
        ),
      ),
    /cron runners/,
  );
  assert.throws(
    () =>
      validateCanonicalV2WorkflowContent(
        canonical.replace("  pull_request:", "  pull_request_review:"),
      ),
    /adopted pull_request lifecycle types/,
  );
  assert.throws(
    () =>
      validateCanonicalV2ControllerWorkflowContent(
        CANONICAL_CONTROLLER_WORKFLOW.replace(
          "  workflow_dispatch:",
          "  repository_dispatch:",
        ),
      ),
    /closed event|must not expose repository_dispatch/u,
  );
  assert.throws(
    () =>
      validateCanonicalV2WorkflowContent(
        canonical.replace(
          "CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION: any",
          "CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION: write",
        ),
      ),
    /missing required fragment: CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION/u,
  );
  assert.throws(
    () =>
      validateCanonicalV2ControllerWorkflowContent(
        CANONICAL_CONTROLLER_WORKFLOW.replace("          github_token:", "          request_author_permission:\n          github_token:"),
      ),
    /closed event|rejected legacy surface: request_author_permission:/u,
  );
  assert.throws(
    () =>
      validateCanonicalV2ControllerWorkflowContent(
        CANONICAL_CONTROLLER_WORKFLOW.replace(
          "github.event.comment.user.type == 'Bot'",
          "github.event.comment.user.type == 'Bot' || true",
        ),
      ),
    /job\.if must exactly match/u,
  );
  assert.throws(
    () =>
      validateCanonicalV2ControllerWorkflowContent(
        CANONICAL_CONTROLLER_WORKFLOW.replace(
          "github.event.action == 'created'",
          "github.event.action == 'created' || github.event.action == 'edited'",
        ),
      ),
    /job\.if must exactly match/u,
  );
});

test("validates the exact closed temporary legacy bridge envelope", () => {
  const bridge = CANONICAL_LEGACY_BRIDGE_WORKFLOW;
  assert.equal(validateCanonicalLegacyBridgeWorkflowContent(bridge), bridge);
  assert.match(
    bridge,
    /^  group: codex-review-gate-\$\{\{ github\.repository \}\}$/mu,
  );
  assert.doesNotMatch(bridge, /group: codex-review-gate-legacy-bridge-/u);
  assert.match(bridge, /^  cancel-in-progress: false$/mu);
  assert.match(
    bridge,
    /^  pull_request_target:\n    types: \[opened, reopened, synchronize, ready_for_review\]$/mu,
  );
  assert.match(bridge, /^  issue_comment:\n    types: \[created\]$/mu);
  assert.equal(
    workflowSingleProducerPolicyViolations(bridge).join(","),
    "issues: write,statuses: write",
  );
  assert.doesNotMatch(
    bridge,
    /workflow_dispatch|repository_dispatch|pull_request_review|schedule|cron:/u,
  );
  assert.doesNotMatch(bridge, /checks:\s*write|actions:\s*write/u);
  assert.doesNotMatch(bridge, /codex\/github-review-gate|@v2/u);

  for (const [name, invalid, expected] of [
    [
      "cron",
      bridge.replace(
        "  pull_request_target:\n",
        "  schedule:\n    - cron: '0 * * * *'\n  pull_request_target:\n",
      ),
      /cron runners/u,
    ],
    [
      "manual dispatch",
      bridge.replace("  pull_request_target:\n", "  workflow_dispatch:\n  pull_request_target:\n"),
      /must not expose workflow_dispatch/u,
    ],
    [
      "repository dispatch",
      bridge.replace("  pull_request_target:\n", "  repository_dispatch:\n  pull_request_target:\n"),
      /must not expose repository_dispatch/u,
    ],
    [
      "checks writer",
      bridge.replace("  contents: read\n", "  checks: write\n  contents: read\n"),
      /may write only issues and legacy commit statuses/u,
    ],
    [
      "wide writer",
      bridge.replace(
        "permissions:\n  contents: read\n  issues: write\n  pull-requests: read\n  statuses: write",
        "permissions: write-all",
      ),
      /may write only issues and legacy commit statuses/u,
    ],
    [
      "v2 caller",
      bridge.replace(
        "JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1",
        CANONICAL_V2_WORKFLOW_USES,
      ),
      /must not produce or call the v2 gate/u,
    ],
    [
      "v2 job producer",
      bridge.replace("codex/review-gate legacy bridge", DEFAULT_STATUS_CONTEXT),
      /must not produce or call the v2 gate/u,
    ],
    [
      "direct v1 caller",
      bridge.replace(
        "JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1",
        "JoeyTeng/codex-review-gate-action@v1",
      ),
      /exactly one literal/u,
    ],
    [
      "second caller",
      bridge.replace(
        "    uses: JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1\n",
        "    uses: JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1\n  second:\n    uses: JoeyTeng/codex-review-gate-action@v1\n",
      ),
      /exactly one literal/u,
    ],
    [
      "opaque caller",
      bridge.replace(
        "    uses: JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1",
        "    uses: >-\n      JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1",
      ),
      /exactly one literal/u,
    ],
    [
      "quoted caller",
      bridge.replace(
        "uses: JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1",
        'uses: "JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1"',
      ),
      /exactly one literal/u,
    ],
    [
      "forbidden pull request review lifecycle",
      bridge.replace(
        "  issue_comment:\n",
        "  pull_request_review:\n    types: [submitted]\n  issue_comment:\n",
      ),
      /must not expose pull_request_review/u,
    ],
    [
      "forbidden pull request review comment lifecycle",
      bridge.replace(
        "  issue_comment:\n",
        "  pull_request_review_comment:\n    types: [created]\n  issue_comment:\n",
      ),
      /must not expose pull_request_review_comment/u,
    ],
    [
      "extra read permission",
      bridge.replace("  contents: read\n", "  actions: read\n  contents: read\n"),
      /exactly match the closed temporary/u,
    ],
    [
      "commented extra caller",
      bridge.replace(
        "jobs:\n",
        "# uses: JoeyTeng/codex-review-gate-action@v1\njobs:\n",
      ),
      /exactly match the closed temporary/u,
    ],
    ["byte drift", `${bridge}\n`, /exactly match the closed temporary/u],
  ]) {
    assert.throws(
      () => validateCanonicalLegacyBridgeWorkflowContent(invalid),
      expected,
      name,
    );
  }
  assert.throws(
    () => validateCanonicalLegacyBridgeWorkflowContent(`\uFEFF${bridge}`),
    /BOM/u,
  );
  assert.throws(
    () => validateCanonicalLegacyBridgeWorkflowContent(bridge.replaceAll("\n", "\r")),
    /bare CR/u,
  );
});

test("post-merge inventory rejects an extra default-branch v1 caller", () => {
  const canonicalPath = ".github/workflows/codex-review-gate.yml";
  const cleanInventory = [
    { path: canonicalPath, content: CANONICAL_WORKFLOW },
    {
      path: DEFAULT_CONTROLLER_WORKFLOW_PATH,
      content: CANONICAL_CONTROLLER_WORKFLOW,
    },
    {
      path: ".github/workflows/test.yml",
      content: "name: Test\non: [push]\njobs: {}\n",
    },
  ];
  assert.equal(
    validateCanonicalV2WorkflowInventory(cleanInventory, CANONICAL_WORKFLOWS),
    CANONICAL_WORKFLOWS,
  );

  const legacyInventory = [
    ...cleanInventory,
    {
      path: ".github/workflows/legacy-codex-review.yml",
      content:
        "jobs:\n  gate:\n    uses: JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1\n",
    },
  ];
  assert.throws(
    () => validateCanonicalV2WorkflowInventory(legacyInventory, CANONICAL_WORKFLOWS),
    /Additional v1\/v2 gate callers remain on the default branch: \.github\/workflows\/legacy-codex-review\.yml/u,
  );

  const additionalV2Caller = [
    ...cleanInventory,
    {
      path: ".github/workflows/extra-v2.yml",
      content: "jobs:\n  gate:\n    uses: JoeyTeng/codex-review-gate-action@v2\n",
    },
  ];
  assert.throws(
    () => validateCanonicalV2WorkflowInventory(additionalV2Caller, CANONICAL_WORKFLOWS),
    /Additional v1\/v2 gate callers.*extra-v2\.yml/u,
  );
  for (const blockCaller of [
    "jobs:\n  gate:\n    uses: >-\n      JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1\n",
    "jobs:\n  gate:\n    uses: >-\n      JoeyTeng/codex-review-gate-action@v2\n",
  ]) {
    assert.throws(
      () =>
        validateCanonicalV2WorkflowInventory(
          [
            ...cleanInventory,
            {
              path: ".github/workflows/opaque-gate-caller.yml",
              content: blockCaller,
            },
          ],
          CANONICAL_WORKFLOWS,
        ),
      /opaque, escaped, flow-style, or multiline uses scalar/u,
    );
  }

  const additionalStatusWriter = [
    ...cleanInventory,
    {
      path: ".github/workflows/status-writer.yml",
      content: "permissions:\n  statuses: write\njobs: {}\n",
    },
  ];
  assert.throws(
    () => validateCanonicalV2WorkflowInventory(additionalStatusWriter, CANONICAL_WORKFLOWS),
    /single-producer policy.*status-writer\.yml.*statuses: write/u,
  );
  for (const quotedStatusWriter of [
    "permissions:\n  \"statuses\": write\njobs: {}\n",
    "permissions:\n  'statuses': write\njobs: {}\n",
  ]) {
    assert.throws(
      () =>
        validateCanonicalV2WorkflowInventory(
          [
            ...cleanInventory,
            {
              path: ".github/workflows/quoted-status-writer.yml",
              content: quotedStatusWriter,
            },
          ],
          CANONICAL_WORKFLOWS,
        ),
      /quoted protected permissions key|opaque permissions entry/u,
    );
  }

  for (const [name, content, expected] of [
    [
      "actions-writer",
      "permissions:\n  actions: write\njobs: {}\n",
      /actions: write/u,
    ],
    [
      "checks-writer",
      "permissions:\n  checks: write\njobs: {}\n",
      /checks: write/u,
    ],
    [
      "issues-writer",
      "permissions:\n  issues: write\njobs: {}\n",
      /issues: write/u,
    ],
    [
      "pull-requests-writer",
      "permissions:\n  pull-requests: write\njobs: {}\n",
      /pull-requests: write/u,
    ],
    [
      "reserved-job-name",
      "permissions:\n  contents: read\njobs:\n  collision:\n    name: 'codex/github-review-gate'\n    runs-on: ubuntu-slim\n",
      /job name: codex\/github-review-gate/u,
    ],
    [
      "block-scalar-job-name",
      "permissions: {}\njobs:\n  collision:\n    name: >-\n      codex/github-review-gate\n    runs-on: ubuntu-slim\n",
      /job name: codex\/github-review-gate/u,
    ],
    [
      "flow-root-jobs",
      "{name: Test, on: push, jobs: {collision: {name: codex/github-review-gate}}}\n",
      /flow-style root mapping/u,
    ],
    [
      "line-broken-top-flow",
      "permissions:\n  {statuses: write}\njobs: {}\n",
      /line-broken flow-style permissions mapping/u,
    ],
    [
      "line-broken-job-flow",
      "jobs:\n  test:\n    permissions:\n      {checks: write}\n    runs-on: ubuntu-slim\n",
      /line-broken flow-style permissions mapping/u,
    ],
    [
      "inline-flow-read",
      "permissions: {contents: read}\njobs: {}\n",
      /flow-style permissions mapping/u,
    ],
  ]) {
    assert.throws(
      () =>
        validateCanonicalV2WorkflowInventory(
          [...cleanInventory, { path: `.github/workflows/${name}.yml`, content }],
          CANONICAL_WORKFLOWS,
        ),
      expected,
      name,
    );
  }
});

test("legacy bridge inventory requires explicit profile, fixed path, and exact bytes", () => {
  const v2Inventory = [
    { path: DEFAULT_WORKFLOW_PATH, content: CANONICAL_WORKFLOW },
    {
      path: DEFAULT_CONTROLLER_WORKFLOW_PATH,
      content: CANONICAL_CONTROLLER_WORKFLOW,
    },
  ];
  const exactBridge = {
    path: DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH,
    content: CANONICAL_LEGACY_BRIDGE_WORKFLOW,
  };
  const bridgeInventory = [...v2Inventory, exactBridge];

  assert.throws(
    () =>
      validateCanonicalV2WorkflowInventory(
        bridgeInventory,
        CANONICAL_WORKFLOWS_WITH_LEGACY_BRIDGE,
      ),
    /Additional v1\/v2 gate callers.*codex-review-gate-legacy-bridge\.yml/u,
  );
  assert.throws(
    () =>
      validateCanonicalV2WorkflowInventory(
        v2Inventory,
        CANONICAL_WORKFLOWS_WITH_LEGACY_BRIDGE,
        { legacyBridge: true },
      ),
    /codex-review-gate-legacy-bridge\.yml must occur exactly once/u,
  );
  assert.throws(
    () =>
      validateCanonicalV2WorkflowInventory(
        [
          ...v2Inventory,
          {
            ...exactBridge,
            path: ".github/workflows/renamed-legacy-bridge.yml",
          },
        ],
        CANONICAL_WORKFLOWS_WITH_LEGACY_BRIDGE,
        { legacyBridge: true },
      ),
    /codex-review-gate-legacy-bridge\.yml must occur exactly once/u,
  );
  assert.throws(
    () =>
      validateCanonicalV2WorkflowInventory(
        [
          ...v2Inventory,
          {
            ...exactBridge,
            content: CANONICAL_LEGACY_BRIDGE_WORKFLOW.replace(
              "  pull-requests: read",
              "  pull-requests: write",
            ),
          },
        ],
        CANONICAL_WORKFLOWS_WITH_LEGACY_BRIDGE,
        { legacyBridge: true },
      ),
    /may write only issues and legacy commit statuses/u,
  );
  assert.throws(
    () =>
      validateCanonicalV2WorkflowInventory(
        [...bridgeInventory, exactBridge],
        CANONICAL_WORKFLOWS_WITH_LEGACY_BRIDGE,
        { legacyBridge: true },
      ),
    /codex-review-gate-legacy-bridge\.yml must occur exactly once/u,
  );
  for (const [name, content] of [
    [
      "reusable-v1",
      "jobs:\n  gate:\n    uses: JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1\n",
    ],
    [
      "reusable-yaml-v1",
      "jobs:\n  gate:\n    uses: JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yaml@v1\n",
    ],
    [
      "direct-v1",
      "jobs:\n  gate:\n    uses: JoeyTeng/codex-review-gate-action@v1\n",
    ],
    [
      "direct-v2",
      "jobs:\n  gate:\n    uses: JoeyTeng/codex-review-gate-action@v2\n",
    ],
    [
      "future-ref",
      "jobs:\n  gate:\n    uses: JoeyTeng/codex-review-gate-action@v10\n",
    ],
    [
      "malicious-ref",
      "jobs:\n  gate:\n    uses: JoeyTeng/codex-review-gate-action@v1-malicious\n",
    ],
    ["writer", "permissions:\n  checks: write\njobs: {}\n"],
  ]) {
    assert.throws(
      () =>
        validateCanonicalV2WorkflowInventory(
          [
            ...bridgeInventory,
            { path: `.github/workflows/${name}.yml`, content },
          ],
          CANONICAL_WORKFLOWS_WITH_LEGACY_BRIDGE,
          { legacyBridge: true },
        ),
      /Additional v1\/v2 gate callers|single-producer policy/u,
      name,
    );
  }
  assert.equal(
    validateCanonicalV2WorkflowInventory(
      bridgeInventory,
      CANONICAL_WORKFLOWS_WITH_LEGACY_BRIDGE,
      { legacyBridge: true },
    ),
    CANONICAL_WORKFLOWS_WITH_LEGACY_BRIDGE,
  );
  assert.throws(
    () =>
      validateCanonicalV2WorkflowInventory(
        bridgeInventory,
        CANONICAL_WORKFLOWS_WITH_LEGACY_BRIDGE,
        { legacyBridge: "yes" },
      ),
    /explicit boolean/u,
  );
});

test("remote staging and activation reject a post-merge extra v1 caller", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const fakeBin = join(fixtureRoot, "bin");
  const repoSlug = "Joey-Tools/consumer";
  const legacyWorkflow =
    "jobs:\n  gate:\n    uses: JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1\n";
  try {
    createFakeGhExecutable(fakeBin);

    const responses = {
      [`repos/${repoSlug}`]: repositoryMetadataFixture(repoSlug),
      [`repos/${repoSlug}/actions/permissions/workflow`]: {
        default_workflow_permissions: "read",
        can_approve_pull_request_reviews: false,
      },
      [`repos/${repoSlug}/collaborators/JoeyTeng/permission`]:
        controlPlaneOwnerPermissionFixture(),
      [`repos/${repoSlug}/branches/master`]: {
        name: "master",
        commit: { sha: DEFAULT_BRANCH_SHA },
      },
      [`repos/${repoSlug}/git/trees/${DEFAULT_BRANCH_SHA}`]: {
        truncated: false,
        tree: [{ path: ".github", sha: "github-tree", type: "tree" }],
      },
      [`repos/${repoSlug}/git/trees/github-tree`]: {
        truncated: false,
        tree: [
          { path: "CODEOWNERS", sha: "codeowners-blob", type: "blob", mode: "100644" },
          { path: "workflows", sha: "workflows-tree", type: "tree" },
        ],
      },
      [`repos/${repoSlug}/git/trees/workflows-tree`]: {
        truncated: false,
        tree: [
          {
            path: "codex-review-gate.yml",
            sha: "canonical-blob",
            type: "blob",
            mode: "100644",
          },
          {
            path: "codex-review-gate-controller.yml",
            sha: "canonical-controller-blob",
            type: "blob",
            mode: "100644",
          },
          {
            path: "legacy-codex-review.yml",
            sha: "legacy-blob",
            type: "blob",
            mode: "100644",
          },
        ],
      },
      [`repos/${repoSlug}/git/blobs/canonical-blob`]: {
        encoding: "base64",
        content: Buffer.from(CANONICAL_WORKFLOW, "utf8").toString("base64"),
      },
      [`repos/${repoSlug}/git/blobs/canonical-controller-blob`]: {
        encoding: "base64",
        content: Buffer.from(CANONICAL_CONTROLLER_WORKFLOW, "utf8").toString(
          "base64",
        ),
      },
      [`repos/${repoSlug}/git/blobs/legacy-blob`]: {
        encoding: "base64",
        content: Buffer.from(legacyWorkflow, "utf8").toString("base64"),
      },
      [`repos/${repoSlug}/git/blobs/codeowners-blob`]: {
        encoding: "base64",
        content: Buffer.from(
          ensureControlPlaneCodeownersContent(null).content,
          "utf8",
        ).toString("base64"),
      },
      [`repos/${repoSlug}/codeowners/errors?ref=${DEFAULT_BRANCH_SHA}`]: {
        errors: [],
      },
    };
    const env = {
      ...process.env,
      PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
      FAKE_GH_RESPONSES: JSON.stringify(responses),
    };

    for (const args of [
      ["--repo", repoSlug],
      [
        "--repo",
        repoSlug,
        "--activate",
        "--canary-pr",
        "7",
        "--canary-head",
        "0123456789abcdef0123456789abcdef01234567",
      ],
    ]) {
      const result = runBootstrap(args, { env });
      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /Additional v1\/v2 gate callers remain on the default branch: \.github\/workflows\/legacy-codex-review\.yml/u,
      );
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("remote inventory rejects an extra v2 caller and an extra status writer", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const repoSlug = "Joey-Tools/consumer";
  try {
    for (const [name, extraContent, expected] of [
      [
        "extra-v2",
        "jobs:\n  gate:\n    uses: JoeyTeng/codex-review-gate-action@v2\n",
        /Additional v1\/v2 gate callers.*extra\.yml/u,
      ],
      [
        "status-writer",
        "permissions: write-all\njobs: {}\n",
        /single-producer policy.*extra\.yml.*checks: write.*issues: write.*pull-requests: write.*statuses: write/u,
      ],
      [
        "issues-writer",
        "permissions:\n  issues: write\njobs: {}\n",
        /single-producer policy.*extra\.yml.*issues: write/u,
      ],
      [
        "reserved-job-name",
        "permissions: {}\njobs:\n  collision:\n    name: codex/github-review-gate\n    runs-on: ubuntu-slim\n",
        /single-producer policy.*extra\.yml.*job name: codex\/github-review-gate/u,
      ],
      [
        "line-broken-flow",
        "permissions:\n  {statuses: write}\njobs: {}\n",
        /line-broken flow-style permissions mapping/u,
      ],
    ]) {
      const fakeBin = join(fixtureRoot, name);
      createFakeGhExecutable(fakeBin);
      const responses = {
        ...canonicalRemoteWorkflowResponses(repoSlug),
        [`repos/${repoSlug}/git/trees/workflows-tree`]: {
          truncated: false,
          tree: [
            {
              path: "codex-review-gate.yml",
              sha: "canonical-blob",
              type: "blob",
              mode: "100644",
            },
            {
              path: "codex-review-gate-controller.yml",
              sha: "canonical-controller-blob",
              type: "blob",
              mode: "100644",
            },
            {
              path: "extra.yml",
              sha: "extra-blob",
              type: "blob",
              mode: "100644",
            },
          ],
        },
        [`repos/${repoSlug}/git/blobs/extra-blob`]: {
          encoding: "base64",
          content: Buffer.from(extraContent, "utf8").toString("base64"),
        },
      };
      const result = runBootstrap(["--repo", repoSlug], {
        env: {
          ...process.env,
          PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
          FAKE_GH_RESPONSES: JSON.stringify(responses),
        },
      });
      assert.equal(result.status, 1, name);
      assert.match(result.stderr, expected, name);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("remote bootstrap rejects default workflow write permissions", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const fakeBin = join(fixtureRoot, "bin");
  const repoSlug = "Joey-Tools/consumer";
  try {
    createFakeGhExecutable(fakeBin);
    const responses = {
      ...canonicalRemoteWorkflowResponses(repoSlug),
      [`repos/${repoSlug}/actions/permissions/workflow`]: {
        default_workflow_permissions: "write",
        can_approve_pull_request_reviews: false,
      },
    };
    const result = runBootstrap(["--repo", repoSlug], {
      env: {
        ...process.env,
        PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
        FAKE_GH_RESPONSES: JSON.stringify(responses),
      },
    });
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /must expose a complete Actions workflow-permission policy with default permissions set to read/u,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("remote bootstrap binds every gh api request to github.com despite hostile GH_HOST", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const fakeBin = join(fixtureRoot, "bin");
  const callLog = join(fixtureRoot, "calls.log");
  const repoSlug = "Joey-Tools/consumer";
  try {
    createFakeGhExecutable(fakeBin);
    const responses = {
      ...canonicalRemoteWorkflowResponses(repoSlug),
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [[]],
    };
    const result = runBootstrap(["--repo", repoSlug], {
      env: {
        ...process.env,
        GH_HOST: "hostile.invalid",
        PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
        FAKE_GH_RESPONSES: JSON.stringify(responses),
        FAKE_GH_CALL_LOG: callLog,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Dry run: would create repository ruleset/u);
    assert.notEqual(readFileSync(callLog, "utf8").trim(), "");
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("remote staging refuses to disable a same-name active legacy ruleset", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const fakeBin = join(fixtureRoot, "bin");
  const callLog = join(fixtureRoot, "calls.log");
  const repoSlug = "Joey-Tools/consumer";
  try {
    createFakeGhExecutable(fakeBin);
    const legacyRuleset = activeLegacyRulesetFixture(7, {
      name: "Must Pass Codex Review",
    });
    const responses = {
      ...canonicalRemoteWorkflowResponses(repoSlug),
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
        [legacyRuleset],
      ],
      [`repos/${repoSlug}/rulesets/7`]: legacyRuleset,
    };
    const result = runBootstrap(["--repo", repoSlug, "--apply"], {
      env: {
        ...process.env,
        PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
        FAKE_GH_RESPONSES: JSON.stringify(responses),
        FAKE_GH_CALL_LOG: callLog,
      },
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /active legacy or incomplete gate/u);
    assert.match(result.stderr, /distinct --ruleset-name/u);
    assert.doesNotMatch(readFileSync(callLog, "utf8"), /^(?:POST|PUT) /mu);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("remote staging refuses to disable a same-name active incomplete non-legacy ruleset", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const fakeBin = join(fixtureRoot, "bin");
  const callLog = join(fixtureRoot, "calls.log");
  const repoSlug = "Joey-Tools/consumer";
  try {
    createFakeGhExecutable(fakeBin);
    const incompleteRuleset = {
      ...activeLegacyRulesetFixture(7, {
        name: "Must Pass Codex Review",
      }),
      rules: [
        {
          type: "required_status_checks",
          parameters: {
            strict_required_status_checks_policy: true,
            required_status_checks: [{ context: "ci/test" }],
          },
        },
      ],
    };
    const responses = {
      ...canonicalRemoteWorkflowResponses(repoSlug),
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
        [incompleteRuleset],
      ],
      [`repos/${repoSlug}/rulesets/7`]: incompleteRuleset,
    };
    const result = runBootstrap(["--repo", repoSlug, "--apply"], {
      env: {
        ...process.env,
        PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
        FAKE_GH_RESPONSES: JSON.stringify(responses),
        FAKE_GH_CALL_LOG: callLog,
      },
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /active legacy or incomplete gate/u);
    assert.match(result.stderr, /distinct --ruleset-name/u);
    assert.doesNotMatch(readFileSync(callLog, "utf8"), /^(?:POST|PUT) /mu);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("remote bootstrap rejects every ambiguous same-name repository ruleset inventory", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-same-name-"));
  const repoSlug = "Joey-Tools/consumer";
  try {
    for (const [name, targets] of [
      ["two-branch", ["branch", "branch"]],
      ["branch-and-tag", ["branch", "tag"]],
    ]) {
      const fakeBin = join(fixtureRoot, name);
      const callLog = join(fixtureRoot, `${name}.log`);
      createFakeGhExecutable(fakeBin);
      const candidates = targets.map((target, index) => ({
        ...completeDisabledRulesetFixture(7 + index),
        target,
      }));
      const responses = {
        ...canonicalRemoteWorkflowResponses(repoSlug),
        [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
          candidates,
        ],
        ...Object.fromEntries(candidates.map((ruleset) => [
          `repos/${repoSlug}/rulesets/${ruleset.id}`,
          ruleset,
        ])),
      };
      const result = runBootstrap(["--repo", repoSlug, "--apply"], {
        env: {
          ...process.env,
          PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
          FAKE_GH_RESPONSES: JSON.stringify(responses),
          FAKE_GH_CALL_LOG: callLog,
        },
      });
      assert.equal(result.status, 1, name);
      assert.match(result.stderr, /ruleset name .* is ambiguous.*id 7.*id 8/iu, name);
      assert.doesNotMatch(readFileSync(callLog, "utf8"), /^(?:POST|PUT) /mu, name);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("ruleset create binds final absence, a fresh response id, and one final named candidate", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-create-bind-"));
  const repoSlug = "Joey-Tools/consumer";
  const createdRuleset = completeDisabledRulesetFixture(8);
  try {
    for (const scenario of [
      {
        name: "appeared-before-post",
        lists: [[[]], [[createdRuleset]]],
        post: { id: 8 },
        expected: /appeared during final create preflight/u,
        expectPost: false,
      },
      {
        name: "non-positive-created-id",
        lists: [[[]], [[]]],
        post: { id: 0 },
        expected: /fresh positive integer id/u,
        expectPost: true,
      },
      {
        name: "missing-final-candidate",
        lists: [[[]], [[]], [[]]],
        post: { id: 8 },
        expected: /Final ruleset inventory does not uniquely bind/u,
        expectPost: true,
      },
      {
        name: "duplicate-final-candidate",
        lists: [[[]], [[]], [[
          createdRuleset,
          { ...createdRuleset, id: 9 },
        ]]],
        post: { id: 8 },
        expected: /ruleset name .* is ambiguous/iu,
        expectPost: true,
      },
      {
        name: "wrong-final-id",
        lists: [[[]], [[]], [[{ ...createdRuleset, id: 9 }]]],
        post: { id: 8 },
        expected: /does not uniquely bind.*created id 8/iu,
        expectPost: true,
      },
    ]) {
      const fakeBin = join(fixtureRoot, scenario.name);
      const stateDir = join(fixtureRoot, `${scenario.name}-state`);
      const callLog = join(fixtureRoot, `${scenario.name}.log`);
      createFakeGhExecutable(fakeBin);
      const responses = {
        ...canonicalRemoteWorkflowResponses(repoSlug),
        [`GET repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: {
          __fake_sequence: scenario.lists,
        },
        [`POST repos/${repoSlug}/rulesets`]: scenario.post,
        [`GET repos/${repoSlug}/rulesets/8`]: createdRuleset,
      };
      const result = runBootstrap(["--repo", repoSlug, "--apply"], {
        env: fakeGhEnvironment({ fakeBin, responses, stateDir, callLog }),
      });
      assert.equal(result.status, 1, `${scenario.name}: ${result.stderr}`);
      assert.match(result.stderr, scenario.expected, scenario.name);
      const calls = readFileSync(callLog, "utf8");
      assert.equal(
        /^POST /mu.test(calls),
        scenario.expectPost,
        scenario.name,
      );
      assert.doesNotMatch(result.stdout, /Created ruleset/u, scenario.name);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("stages a distinct disabled v2 ruleset while a legacy ruleset remains active", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const fakeBin = join(fixtureRoot, "bin");
  const stateDir = join(fixtureRoot, "state");
  const callLog = join(fixtureRoot, "calls.log");
  const repoSlug = "Joey-Tools/consumer";
  const v2RulesetName = "Must Pass Codex Review v2";
  try {
    createFakeGhExecutable(fakeBin);
    const legacyRuleset = activeLegacyRulesetFixture(7);
    const disabledV2 = {
      ...completeDisabledRulesetFixture(8),
      name: v2RulesetName,
    };
    const responses = {
      ...canonicalRemoteWorkflowResponses(repoSlug),
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: {
        __fake_sequence: [
          [[legacyRuleset]],
          [[legacyRuleset]],
          [[legacyRuleset, disabledV2]],
        ],
      },
      [`repos/${repoSlug}/rulesets/7`]: legacyRuleset,
      [`POST repos/${repoSlug}/rulesets`]: { id: 8, name: v2RulesetName },
      [`GET repos/${repoSlug}/rulesets/8`]: disabledV2,
    };
    const result = runBootstrap([
      "--repo",
      repoSlug,
      "--ruleset-name",
      v2RulesetName,
      "--apply",
    ], {
      env: fakeGhEnvironment({ fakeBin, responses, stateDir, callLog }),
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Fail-closed migration overlap/u);
    assert.match(result.stdout, /Created ruleset/u);
    const calls = readFileSync(callLog, "utf8");
    assert.match(calls, new RegExp(`^POST repos/${repoSlug}/rulesets$`, "mu"));
    assert.doesNotMatch(calls, new RegExp(`^PUT repos/${repoSlug}/rulesets/7$`, "mu"));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("stages an exact status-only source v2 ruleset without rewriting the retained legacy protections", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-source-status-only-stage-"));
  const fakeBin = join(fixtureRoot, "bin");
  const stateDir = join(fixtureRoot, "state");
  const callLog = join(fixtureRoot, "calls.log");
  const repoSlug = "Joey-Tools/codex-review-gate";
  const v2RulesetName = "Must Pass Codex Review v2";
  try {
    createFakeGhExecutable(fakeBin);
    const retainedLegacy = sourceLegacyRulesetFixture(7, repoSlug);
    const effectiveRulePages = [[
      effectiveLegacyRequiredStatusChecksRule(retainedLegacy),
    ]];
    const legacyInventory = legacyInventoryResponseFixtures(repoSlug, {
      effectiveRulePages,
      rulesets: [retainedLegacy],
    });
    const disabledV2 = statusOnlyRulesetFixture(8, repoSlug, {
      name: v2RulesetName,
      enforcement: "disabled",
    });
    delete disabledV2.rules[0].parameters.do_not_enforce_on_create;
    const responses = {
      ...canonicalRemoteWorkflowResponses(repoSlug, { legacyBridge: true }),
      ...legacyInventory.responses,
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: {
        __fake_sequence: [
          [[retainedLegacy]],
          [[retainedLegacy]],
          [[retainedLegacy, disabledV2]],
        ],
      },
      [`repos/${repoSlug}/rulesets/7`]: retainedLegacy,
      [`POST repos/${repoSlug}/rulesets`]: { id: 8, name: v2RulesetName },
      [`GET repos/${repoSlug}/rulesets/8`]: disabledV2,
    };
    const result = runBootstrap([
      "--repo",
      repoSlug,
      "--ruleset-name",
      v2RulesetName,
      "--ruleset-profile",
      RULESET_PROFILE_STATUS_ONLY,
      "--legacy-bridge",
      "--apply",
    ], {
      env: fakeGhEnvironment({ fakeBin, responses, stateDir, callLog }),
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Ruleset profile: status-only/u);
    assert.match(result.stdout, /Created ruleset/u);
    const calls = readFileSync(callLog, "utf8");
    assert.match(calls, new RegExp(`^POST repos/${repoSlug}/rulesets$`, "mu"));
    assert.doesNotMatch(calls, new RegExp(`^PUT repos/${repoSlug}/rulesets/7$`, "mu"));
    assert.doesNotMatch(calls, new RegExp(`^PUT repos/${repoSlug}/rulesets/8$`, "mu"));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("legacy ruleset disappearance or policy drift before staging prevents every write", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const repoSlug = "Joey-Tools/consumer";
  try {
    for (const [name, mutateEffectiveRules] of [
      ["disappeared", () => [[]]],
      ["policy-drift", (pages) => {
        const drifted = structuredClone(pages);
        drifted[0][0].parameters.strict_required_status_checks_policy = false;
        return drifted;
      }],
    ]) {
      const fakeBin = join(fixtureRoot, name);
      const stateDir = join(fixtureRoot, `${name}-state`);
      const callLog = join(fixtureRoot, `${name}.log`);
      createFakeGhExecutable(fakeBin);
      const legacyRuleset = activeLegacyRulesetFixture(7);
      const effectiveRulePages = [[
        effectiveLegacyRequiredStatusChecksRule(legacyRuleset),
      ]];
      const legacyInventory = legacyInventoryResponseFixtures(repoSlug, {
        effectiveRulePages,
        rulesets: [legacyRuleset],
      });
      const responses = {
        ...canonicalRemoteWorkflowResponses(repoSlug),
        ...legacyInventory.responses,
        [`GET repos/${repoSlug}/rules/branches/master?per_page=100`]: {
          __fake_sequence: [
            effectiveRulePages,
            mutateEffectiveRules(effectiveRulePages),
          ],
        },
        [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
          [legacyRuleset],
        ],
        [`POST repos/${repoSlug}/rulesets`]: { id: 8 },
      };
      const result = runBootstrap([
        "--repo",
        repoSlug,
        "--ruleset-name",
        "Must Pass Codex Review v2",
        "--apply",
      ], {
        env: fakeGhEnvironment({ fakeBin, responses, stateDir, callLog }),
      });

      assert.equal(result.status, 1, name);
      assert.match(
        result.stderr,
        /canonical legacy review-gate inventory digest mismatched.*ruleset pre-write readback/iu,
        name,
      );
      assert.doesNotMatch(
        readFileSync(callLog, "utf8"),
        /^(?:POST|PUT) /mu,
        name,
      );
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("legacy ruleset drift after staging prevents a completion report", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const fakeBin = join(fixtureRoot, "bin");
  const stateDir = join(fixtureRoot, "state");
  const callLog = join(fixtureRoot, "calls.log");
  const repoSlug = "Joey-Tools/consumer";
  const v2RulesetName = "Must Pass Codex Review v2";
  try {
    createFakeGhExecutable(fakeBin);
    const legacyRuleset = activeLegacyRulesetFixture(7);
    const effectiveRulePages = [[
      effectiveLegacyRequiredStatusChecksRule(legacyRuleset),
    ]];
    const legacyInventory = legacyInventoryResponseFixtures(repoSlug, {
      effectiveRulePages,
      rulesets: [legacyRuleset],
    });
    const disabledV2 = {
      ...completeDisabledRulesetFixture(8),
      name: v2RulesetName,
    };
    const responses = {
      ...canonicalRemoteWorkflowResponses(repoSlug),
      ...legacyInventory.responses,
      [`GET repos/${repoSlug}/rules/branches/master?per_page=100`]: {
        __fake_sequence: [effectiveRulePages, effectiveRulePages, [[]]],
      },
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
        [legacyRuleset],
      ],
      [`POST repos/${repoSlug}/rulesets`]: { id: 8, name: v2RulesetName },
      [`GET repos/${repoSlug}/rulesets/8`]: disabledV2,
    };
    const result = runBootstrap([
      "--repo",
      repoSlug,
      "--ruleset-name",
      v2RulesetName,
      "--apply",
    ], {
      env: fakeGhEnvironment({ fakeBin, responses, stateDir, callLog }),
    });

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /write completed.*canonical legacy review-gate inventory digest mismatched.*post-write readback/iu,
    );
    const calls = readFileSync(callLog, "utf8");
    assert.match(calls, new RegExp(`^POST repos/${repoSlug}/rulesets$`, "mu"));
    assert.doesNotMatch(result.stdout, /Created ruleset/u);
    assert.doesNotMatch(calls, new RegExp(`^PUT repos/${repoSlug}/rulesets/7$`, "mu"));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("stages a disabled v2 ruleset while classic legacy protection remains active", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const fakeBin = join(fixtureRoot, "bin");
  const stateDir = join(fixtureRoot, "state");
  const callLog = join(fixtureRoot, "calls.log");
  const repoSlug = "Joey-Tools/consumer";
  try {
    createFakeGhExecutable(fakeBin);
    const disabledV2 = completeDisabledRulesetFixture(7);
    const responses = {
      ...canonicalRemoteWorkflowResponses(repoSlug),
      [`repos/${repoSlug}/branches/master/protection`]: {
        required_status_checks: {
          strict: true,
          contexts: [LEGACY_STATUS_CONTEXT],
          checks: [],
        },
      },
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: {
        __fake_sequence: [
          [[]],
          [[]],
          [[disabledV2]],
        ],
      },
      [`POST repos/${repoSlug}/rulesets`]: {
        id: 7,
        name: "Must Pass Codex Review",
      },
      [`GET repos/${repoSlug}/rulesets/7`]: disabledV2,
    };
    const result = runBootstrap(["--repo", repoSlug, "--apply"], {
      env: fakeGhEnvironment({ fakeBin, responses, stateDir, callLog }),
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Created ruleset/u);
    assert.match(
      readFileSync(callLog, "utf8"),
      new RegExp(`^POST repos/${repoSlug}/rulesets$`, "mu"),
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("classic branch protection aggregates legacy contexts and permits migration overlap", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const repoSlug = "Joey-Tools/consumer";
  const endpoint =
    `repos/${repoSlug}/branches/master/protection`;
  try {
    for (const [name, response, expectedStatus, expected] of [
      [
        "legacy-context",
        {
          required_status_checks: {
            strict: true,
            contexts: [LEGACY_STATUS_CONTEXT],
            checks: [],
          },
        },
        0,
        /Dry run: would create repository ruleset/u,
      ],
      [
        "legacy-check",
        {
          required_status_checks: {
            strict: true,
            contexts: ["lint"],
            checks: [{ context: LEGACY_STATUS_CONTEXT, app_id: 15368 }],
          },
        },
        0,
        /Dry run: would create repository ruleset/u,
      ],
      [
        "malformed",
        {
          required_status_checks: {
            strict: true,
            contexts: null,
            checks: [],
          },
        },
        1,
        /required_status_checks is malformed or incomplete/u,
      ],
      [
        "missing-required-status-checks",
        { url: "https://api.github.com/repos/Joey-Tools/consumer/branches/master/protection" },
        1,
        /omits required_status_checks/u,
      ],
      [
        "protected-without-required-checks",
        { required_status_checks: null },
        0,
        /Dry run: would create repository ruleset/u,
      ],
      [
        "forbidden",
        { __fake_http_error: 403, message: "Forbidden" },
        1,
        /HTTP 403/u,
      ],
      [
        "absent",
        { __fake_http_error: 404, message: "Branch not protected" },
        0,
        /Dry run: would create repository ruleset/u,
      ],
      [
        "generic-not-found",
        { __fake_http_error: 404, message: "Not Found" },
        1,
        /Not Found \(HTTP 404\)/u,
      ],
      [
        "permission-masked-not-found",
        { __fake_http_error: 404, message: "Resource not found" },
        1,
        /Resource not found \(HTTP 404\)/u,
      ],
    ]) {
      const fakeBin = join(fixtureRoot, name);
      const callLog = join(fixtureRoot, `${name}.log`);
      createFakeGhExecutable(fakeBin);
      const responses = {
        ...canonicalRemoteWorkflowResponses(repoSlug),
        [endpoint]: response,
        [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [[]],
      };
      const result = runBootstrap(["--repo", repoSlug], {
        env: {
          ...process.env,
          PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
          FAKE_GH_RESPONSES: JSON.stringify(responses),
          FAKE_GH_CALL_LOG: callLog,
        },
      });
      assert.equal(result.status, expectedStatus, `${name}: ${result.stderr}`);
      assert.match(expectedStatus === 0 ? result.stdout : result.stderr, expected, name);
      const calls = readFileSync(callLog, "utf8");
      assert.doesNotMatch(calls, /^(?:POST|PUT) /mu, name);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("classic legacy protection appearing during staging prevents every write", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const fakeBin = join(fixtureRoot, "bin");
  const stateDir = join(fixtureRoot, "state");
  const callLog = join(fixtureRoot, "calls.log");
  const repoSlug = "Joey-Tools/consumer";
  const endpoint =
    `GET repos/${repoSlug}/branches/master/protection`;
  try {
    createFakeGhExecutable(fakeBin);
    const responses = {
      ...canonicalRemoteWorkflowResponses(repoSlug),
      [endpoint]: {
        __fake_sequence: [
          {
            required_status_checks: {
              strict: true,
              contexts: [],
              checks: [],
            },
          },
          {
            required_status_checks: {
              strict: true,
              contexts: [],
              checks: [{ context: LEGACY_STATUS_CONTEXT, app_id: null }],
            },
          },
        ],
      },
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [[]],
      [`POST repos/${repoSlug}/rulesets`]: { id: 7 },
    };
    const result = runBootstrap(["--repo", repoSlug, "--apply"], {
      env: fakeGhEnvironment({ fakeBin, responses, stateDir, callLog }),
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /classic legacy-gate overlap/u);
    assert.doesNotMatch(
      readFileSync(callLog, "utf8"),
      new RegExp(`^POST repos/${repoSlug}/rulesets$`, "mu"),
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("classic required status policy drift before staging prevents every write", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const fakeBin = join(fixtureRoot, "bin");
  const stateDir = join(fixtureRoot, "state");
  const callLog = join(fixtureRoot, "calls.log");
  const repoSlug = "Joey-Tools/consumer";
  const endpoint =
    `GET repos/${repoSlug}/branches/master/protection`;
  try {
    createFakeGhExecutable(fakeBin);
    const presentWithoutLegacy = {
      strict: true,
      contexts: ["lint"],
      checks: [
        { context: "build", app_id: 1 },
        { context: "build", app_id: 2 },
      ],
    };
    const responses = {
      ...canonicalRemoteWorkflowResponses(repoSlug),
      [endpoint]: {
        __fake_sequence: [
          { __fake_http_error: 404, message: "Branch not protected" },
          { required_status_checks: presentWithoutLegacy },
          { required_status_checks: presentWithoutLegacy },
        ],
      },
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [[]],
      [`POST repos/${repoSlug}/rulesets`]: {
        id: 7,
        name: "Must Pass Codex Review",
      },
      [`GET repos/${repoSlug}/rulesets/7`]: completeDisabledRulesetFixture(7),
    };
    const result = runBootstrap(["--repo", repoSlug, "--apply"], {
      env: fakeGhEnvironment({ fakeBin, responses, stateDir, callLog }),
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /classic legacy-gate overlap/u);
    assert.doesNotMatch(
      readFileSync(callLog, "utf8"),
      new RegExp(`^POST repos/${repoSlug}/rulesets$`, "mu"),
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("activates a distinct v2 ruleset while a separate legacy ruleset remains active", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const fakeBin = join(fixtureRoot, "bin");
  const stateDir = join(fixtureRoot, "state");
  const callLog = join(fixtureRoot, "calls.log");
  const repoSlug = "Joey-Tools/consumer";
  const v2RulesetName = "Must Pass Codex Review v2";
  try {
    createFakeGhExecutable(fakeBin);
    const validPullRequest = canaryPullRequestFixture(repoSlug, CANARY_HEAD_SHA);
    const legacyRuleset = activeLegacyRulesetFixture(7);
    const disabledV2 = {
      ...completeDisabledRulesetFixture(8),
      name: v2RulesetName,
    };
    const activeV2 = {
      ...completeActiveRulesetFixture(8),
      name: v2RulesetName,
    };
    const responses = {
      ...canonicalRemoteWorkflowResponses(repoSlug),
      ...canaryRunResponses(repoSlug),
      [`GET repos/${repoSlug}/pulls/7`]: {
        __fake_sequence: [validPullRequest, validPullRequest, validPullRequest],
      },
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
        [legacyRuleset, disabledV2],
      ],
      [`repos/${repoSlug}/rulesets/7`]: legacyRuleset,
      [`GET repos/${repoSlug}/rulesets/8`]: {
        __fake_sequence: [
          disabledV2,
          disabledV2,
          disabledV2,
          disabledV2,
          disabledV2,
          activeV2,
          activeV2,
        ],
      },
      [`PUT repos/${repoSlug}/rulesets/8`]: { id: 8, name: v2RulesetName },
    };
    const result = runBootstrap([
      ...activationArguments(repoSlug, CANARY_HEAD_SHA),
      "--ruleset-name",
      v2RulesetName,
    ], {
      env: fakeGhEnvironment({ fakeBin, responses, stateDir, callLog }),
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Fail-closed migration overlap/u);
    assert.match(result.stdout, /Ruleset readback: Must Pass Codex Review v2/u);
    const calls = readFileSync(callLog, "utf8");
    assert.match(calls, new RegExp(`^PUT repos/${repoSlug}/rulesets/8$`, "mu"));
    assert.doesNotMatch(calls, new RegExp(`^PUT repos/${repoSlug}/rulesets/7$`, "mu"));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("activates only the staged status-only source v2 ruleset after its canary passes", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-source-status-only-activate-"));
  const fakeBin = join(fixtureRoot, "bin");
  const stateDir = join(fixtureRoot, "state");
  const callLog = join(fixtureRoot, "calls.log");
  const repoSlug = "Joey-Tools/codex-review-gate";
  const v2RulesetName = "Must Pass Codex Review v2";
  try {
    createFakeGhExecutable(fakeBin);
    const retainedLegacy = sourceLegacyRulesetFixture(7, repoSlug);
    const effectiveRulePages = [[
      effectiveLegacyRequiredStatusChecksRule(retainedLegacy),
    ]];
    const legacyInventory = legacyInventoryResponseFixtures(repoSlug, {
      effectiveRulePages,
      rulesets: [retainedLegacy],
    });
    const validPullRequest = canaryPullRequestFixture(repoSlug, CANARY_HEAD_SHA);
    const disabledV2 = statusOnlyRulesetFixture(8, repoSlug, {
      name: v2RulesetName,
      enforcement: "disabled",
    });
    const activeV2 = statusOnlyRulesetFixture(8, repoSlug, {
      name: v2RulesetName,
      enforcement: "active",
    });
    delete disabledV2.rules[0].parameters.do_not_enforce_on_create;
    delete activeV2.rules[0].parameters.do_not_enforce_on_create;
    const responses = {
      ...canonicalRemoteWorkflowResponses(repoSlug, { legacyBridge: true }),
      ...legacyInventory.responses,
      ...canaryRunResponses(repoSlug),
      [`GET repos/${repoSlug}/pulls/7`]: {
        __fake_sequence: [validPullRequest, validPullRequest, validPullRequest],
      },
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
        [retainedLegacy, disabledV2],
      ],
      [`repos/${repoSlug}/rulesets/7`]: retainedLegacy,
      [`GET repos/${repoSlug}/rulesets/8`]: {
        __fake_sequence: [
          disabledV2,
          disabledV2,
          disabledV2,
          disabledV2,
          disabledV2,
          activeV2,
          activeV2,
        ],
      },
      [`PUT repos/${repoSlug}/rulesets/8`]: { id: 8, name: v2RulesetName },
    };
    const result = runBootstrap([
      ...activationArguments(repoSlug, CANARY_HEAD_SHA),
      "--ruleset-name",
      v2RulesetName,
      "--ruleset-profile",
      RULESET_PROFILE_STATUS_ONLY,
      "--legacy-bridge",
    ], {
      env: fakeGhEnvironment({ fakeBin, responses, stateDir, callLog }),
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Ruleset profile: status-only/u);
    assert.match(result.stdout, /exact status-only v2 policy with active enforcement/u);
    const calls = readFileSync(callLog, "utf8");
    assert.match(calls, new RegExp(`^PUT repos/${repoSlug}/rulesets/8$`, "mu"));
    assert.doesNotMatch(calls, new RegExp(`^PUT repos/${repoSlug}/rulesets/7$`, "mu"));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("rejects active source status-only profile drift before any write", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-source-status-only-drift-"));
  const repoSlug = "Joey-Tools/codex-review-gate";
  const v2RulesetName = "Must Pass Codex Review v2";
  try {
    for (const [name, drift] of [
      [
        "broader conditions",
        (ruleset) => {
          ruleset.conditions.ref_name.include = ["~ALL"];
        },
      ],
      [
        "extra rule",
        (ruleset) => {
          ruleset.rules.push({ type: "deletion" });
        },
      ],
      [
        "bypass actor",
        (ruleset) => {
          ruleset.bypass_actors.push({
            actor_id: 1,
            actor_type: "RepositoryRole",
            bypass_mode: "always",
          });
        },
      ],
    ]) {
      const fakeBin = join(fixtureRoot, `${name}-bin`);
      const stateDir = join(fixtureRoot, `${name}-state`);
      const callLog = join(fixtureRoot, `${name}.log`);
      createFakeGhExecutable(fakeBin);
      const drifted = statusOnlyRulesetFixture(8, repoSlug, {
        name: v2RulesetName,
        enforcement: "active",
      });
      drift(drifted);
      const result = runBootstrap([
        "--repo",
        repoSlug,
        "--ruleset-name",
        v2RulesetName,
        "--ruleset-profile",
        RULESET_PROFILE_STATUS_ONLY,
        "--legacy-bridge",
        "--apply",
      ], {
        env: fakeGhEnvironment({
          fakeBin,
          responses: {
            ...canonicalRemoteWorkflowResponses(repoSlug, { legacyBridge: true }),
            [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
              [drifted],
            ],
            [`repos/${repoSlug}/rulesets/8`]: drifted,
          },
          stateDir,
          callLog,
        }),
      });
      assert.equal(result.status, 1, `${name}: ${result.stderr}`);
      assert.match(result.stderr, /active legacy or incomplete gate/u, name);
      assert.doesNotMatch(readFileSync(callLog, "utf8"), /^(?:POST|PUT) /mu, name);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("legacy ruleset disappearance at the activation write boundary prevents PUT", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const fakeBin = join(fixtureRoot, "bin");
  const stateDir = join(fixtureRoot, "state");
  const callLog = join(fixtureRoot, "calls.log");
  const repoSlug = "Joey-Tools/consumer";
  const v2RulesetName = "Must Pass Codex Review v2";
  try {
    createFakeGhExecutable(fakeBin);
    const validPullRequest = canaryPullRequestFixture(repoSlug, CANARY_HEAD_SHA);
    const legacyRuleset = activeLegacyRulesetFixture(7);
    const effectiveRulePages = [[
      effectiveLegacyRequiredStatusChecksRule(legacyRuleset),
    ]];
    const legacyInventory = legacyInventoryResponseFixtures(repoSlug, {
      effectiveRulePages,
      rulesets: [legacyRuleset],
    });
    const disabledV2 = {
      ...completeDisabledRulesetFixture(8),
      name: v2RulesetName,
    };
    const responses = {
      ...canonicalRemoteWorkflowResponses(repoSlug),
      ...canaryRunResponses(repoSlug),
      ...legacyInventory.responses,
      [`GET repos/${repoSlug}/rules/branches/master?per_page=100`]: {
        __fake_sequence: [effectiveRulePages, effectiveRulePages, [[]]],
      },
      [`GET repos/${repoSlug}/pulls/7`]: {
        __fake_sequence: [validPullRequest, validPullRequest, validPullRequest],
      },
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
        [legacyRuleset, disabledV2],
      ],
      [`GET repos/${repoSlug}/rulesets/8`]: disabledV2,
      [`PUT repos/${repoSlug}/rulesets/8`]: { id: 8, name: v2RulesetName },
    };
    const result = runBootstrap([
      ...activationArguments(repoSlug, CANARY_HEAD_SHA),
      "--ruleset-name",
      v2RulesetName,
    ], {
      env: fakeGhEnvironment({ fakeBin, responses, stateDir, callLog }),
    });

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /canonical legacy review-gate inventory digest mismatched.*final ruleset pre-write readback/iu,
    );
    const calls = readFileSync(callLog, "utf8");
    assert.doesNotMatch(calls, new RegExp(`^PUT repos/${repoSlug}/rulesets/8$`, "mu"));
    assert.doesNotMatch(calls, new RegExp(`^PUT repos/${repoSlug}/rulesets/7$`, "mu"));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("legacy disappearance during final activation closure prevents PUT", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const fakeBin = join(fixtureRoot, "bin");
  const stateDir = join(fixtureRoot, "state");
  const callLog = join(fixtureRoot, "calls.log");
  const repoSlug = "Joey-Tools/consumer";
  const v2RulesetName = "Must Pass Codex Review v2";
  try {
    createFakeGhExecutable(fakeBin);
    const validPullRequest = canaryPullRequestFixture(repoSlug, CANARY_HEAD_SHA);
    const legacyRuleset = activeLegacyRulesetFixture(7);
    const effectiveRulePages = [[
      effectiveLegacyRequiredStatusChecksRule(legacyRuleset),
    ]];
    const legacyInventory = legacyInventoryResponseFixtures(repoSlug, {
      effectiveRulePages,
      rulesets: [legacyRuleset],
    });
    const disabledV2 = {
      ...completeDisabledRulesetFixture(8),
      name: v2RulesetName,
    };
    const responses = {
      ...canonicalRemoteWorkflowResponses(repoSlug),
      ...canaryRunResponses(repoSlug),
      ...legacyInventory.responses,
      [`GET repos/${repoSlug}/rules/branches/master?per_page=100`]: {
        __fake_sequence: [
          effectiveRulePages,
          effectiveRulePages,
          effectiveRulePages,
          [[]],
        ],
      },
      [`GET repos/${repoSlug}/pulls/7`]: {
        __fake_sequence: [validPullRequest, validPullRequest, validPullRequest],
      },
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
        [legacyRuleset, disabledV2],
      ],
      [`GET repos/${repoSlug}/rulesets/8`]: disabledV2,
      [`PUT repos/${repoSlug}/rulesets/8`]: { id: 8, name: v2RulesetName },
    };
    const result = runBootstrap([
      ...activationArguments(repoSlug, CANARY_HEAD_SHA),
      "--ruleset-name",
      v2RulesetName,
    ], {
      env: fakeGhEnvironment({ fakeBin, responses, stateDir, callLog }),
    });

    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /canonical legacy review-gate inventory digest mismatched.*activation final write-boundary readback/iu,
    );
    const calls = readFileSync(callLog, "utf8");
    assert.equal(
      countLines(
        calls,
        `GET repos/${repoSlug}/rules/branches/master?per_page=100`,
      ),
      4,
    );
    assert.doesNotMatch(calls, new RegExp(`^PUT repos/${repoSlug}/rulesets/8$`, "mu"));
    assert.doesNotMatch(calls, new RegExp(`^PUT repos/${repoSlug}/rulesets/7$`, "mu"));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("activates v2 while classic legacy protection remains active and stable", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const fakeBin = join(fixtureRoot, "bin");
  const stateDir = join(fixtureRoot, "state");
  const callLog = join(fixtureRoot, "calls.log");
  const repoSlug = "Joey-Tools/consumer";
  try {
    createFakeGhExecutable(fakeBin);
    const validPullRequest = canaryPullRequestFixture(repoSlug, CANARY_HEAD_SHA);
    const disabledV2 = completeDisabledRulesetFixture(7);
    const activeV2 = completeActiveRulesetFixture(7);
    const responses = {
      ...canonicalRemoteWorkflowResponses(repoSlug),
      ...canaryRunResponses(repoSlug),
      [`repos/${repoSlug}/branches/master/protection`]: {
        required_status_checks: {
          strict: true,
          contexts: [LEGACY_STATUS_CONTEXT],
          checks: [],
        },
      },
      [`GET repos/${repoSlug}/pulls/7`]: {
        __fake_sequence: [validPullRequest, validPullRequest, validPullRequest],
      },
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
        [disabledV2],
      ],
      [`GET repos/${repoSlug}/rulesets/7`]: {
        __fake_sequence: [
          disabledV2,
          disabledV2,
          disabledV2,
          disabledV2,
          disabledV2,
          activeV2,
          activeV2,
        ],
      },
      [`PUT repos/${repoSlug}/rulesets/7`]: {
        id: 7,
        name: "Must Pass Codex Review",
      },
    };
    const result = runBootstrap(activationArguments(repoSlug, CANARY_HEAD_SHA), {
      env: fakeGhEnvironment({ fakeBin, responses, stateDir, callLog }),
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /classic branch protection continues to require/u);
    assert.match(result.stdout, /Ruleset readback: Must Pass Codex Review/u);
    assert.match(
      readFileSync(callLog, "utf8"),
      new RegExp(`^PUT repos/${repoSlug}/rulesets/7$`, "mu"),
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("a failed canary leaves the active legacy ruleset untouched", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const fakeBin = join(fixtureRoot, "bin");
  const callLog = join(fixtureRoot, "calls.log");
  const repoSlug = "Joey-Tools/consumer";
  const v2RulesetName = "Must Pass Codex Review v2";
  try {
    createFakeGhExecutable(fakeBin);
    const legacyRuleset = activeLegacyRulesetFixture(7);
    const disabledV2 = {
      ...completeDisabledRulesetFixture(8),
      name: v2RulesetName,
    };
    const failedCheckRun = {
      ...canonicalCanaryCheckRunFixture(repoSlug),
      conclusion: "failure",
    };
    const responses = {
      ...canonicalRemoteWorkflowResponses(repoSlug),
      ...canaryRunResponses(repoSlug),
      [`repos/${repoSlug}/pulls/7`]: canaryPullRequestFixture(
        repoSlug,
        CANARY_HEAD_SHA,
      ),
      [`repos/${repoSlug}/commits/${CANARY_HEAD_SHA}/check-runs?check_name=codex%2Fgithub-review-gate&filter=latest&per_page=100`]: [
        { total_count: 1, check_runs: [failedCheckRun] },
      ],
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
        [legacyRuleset, disabledV2],
      ],
      [`repos/${repoSlug}/rulesets/7`]: legacyRuleset,
      [`repos/${repoSlug}/rulesets/8`]: disabledV2,
    };
    const result = runBootstrap([
      ...activationArguments(repoSlug, CANARY_HEAD_SHA),
      "--ruleset-name",
      v2RulesetName,
    ], {
      env: {
        ...process.env,
        PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
        FAKE_GH_RESPONSES: JSON.stringify(responses),
        FAKE_GH_CALL_LOG: callLog,
      },
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a successful native GitHub Actions CheckRun/u);
    assert.doesNotMatch(readFileSync(callLog, "utf8"), /^PUT /mu);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("remote bootstrap rejects missing, wrong, overridden, or invalid CODEOWNERS", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const repoSlug = "Joey-Tools/consumer";
  const canonicalCodeowners = ensureControlPlaneCodeownersContent(null).content;
  try {
    for (const [name, mutate, expected] of [
      [
        "missing",
        (responses) => {
          responses[`repos/${repoSlug}/git/trees/github-tree`] = {
            truncated: false,
            tree: [{ path: "workflows", sha: "workflows-tree", type: "tree" }],
          };
        },
        /lacks a regular \.github\/CODEOWNERS/u,
      ],
      [
        "wrong-owner",
        (responses) => {
          responses[`repos/${repoSlug}/git/blobs/codeowners-blob`] = {
            encoding: "base64",
            content: Buffer.from(
              canonicalCodeowners.replaceAll("@JoeyTeng", "@Alice"),
              "utf8",
            ).toString("base64"),
          };
        },
        /exact, non-overridable ownership/u,
      ],
      [
        "overridden",
        (responses) => {
          responses[`repos/${repoSlug}/git/blobs/codeowners-blob`] = {
            encoding: "base64",
            content: Buffer.from(`${canonicalCodeowners}* @Alice\n`, "utf8").toString("base64"),
          };
        },
        /exact, non-overridable ownership/u,
      ],
      [
        "github-errors",
        (responses) => {
          responses[`repos/${repoSlug}/codeowners/errors?ref=${DEFAULT_BRANCH_SHA}`] = {
            errors: [{ line: 2, column: 1, kind: "Invalid owner" }],
          };
        },
        /GitHub reports CODEOWNERS syntax or ownership errors/u,
      ],
      [
        "read-only-owner",
        (responses) => {
          responses[`repos/${repoSlug}/collaborators/JoeyTeng/permission`] =
            controlPlaneOwnerPermissionFixture({ permission: "read" });
        },
        /must resolve to a repository collaborator with write/u,
      ],
    ]) {
      const fakeBin = join(fixtureRoot, name);
      createFakeGhExecutable(fakeBin);
      const responses = canonicalRemoteWorkflowResponses(repoSlug);
      mutate(responses);
      const result = runBootstrap(["--repo", repoSlug], {
        env: {
          ...process.env,
          PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
          FAKE_GH_RESPONSES: JSON.stringify(responses),
        },
      });
      assert.equal(result.status, 1, name);
      assert.match(result.stderr, expected, name);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("ruleset create refuses control-plane owner identity drift before POST", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const fakeBin = join(fixtureRoot, "bin");
  const stateDir = join(fixtureRoot, "state");
  const callLog = join(fixtureRoot, "calls.log");
  const repoSlug = "Joey-Tools/consumer";
  try {
    createFakeGhExecutable(fakeBin);
    const responses = {
      ...canonicalRemoteWorkflowResponses(repoSlug),
      [`GET repos/${repoSlug}/collaborators/JoeyTeng/permission`]: {
        __fake_sequence: [
          controlPlaneOwnerPermissionFixture(),
          controlPlaneOwnerPermissionFixture({
            user: {
              id: 4343,
              node_id: "U_ReplacementOwner",
              login: "JoeyTeng",
              type: "User",
            },
          }),
        ],
      },
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [[]],
      [`POST repos/${repoSlug}/rulesets`]: { id: 7 },
    };
    const result = runBootstrap(["--repo", repoSlug, "--apply"], {
      env: fakeGhEnvironment({ fakeBin, responses, stateDir, callLog }),
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /control-plane owner permission changed/u);
    const calls = readFileSync(callLog, "utf8");
    assert.equal(
      countLines(calls, `GET repos/${repoSlug}/collaborators/JoeyTeng/permission`),
      2,
    );
    assert.doesNotMatch(calls, new RegExp(`^POST repos/${repoSlug}/rulesets$`, "mu"));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("plain remote apply does not downgrade a complete active v2 ruleset", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const fakeBin = join(fixtureRoot, "bin");
  const repoSlug = "Joey-Tools/consumer";
  try {
    createFakeGhExecutable(fakeBin);
    const completeRuleset = {
      id: 7,
      name: "Must Pass Codex Review",
      source_type: "Repository",
      source: repoSlug,
      target: "branch",
      enforcement: "active",
      bypass_actors: [],
      conditions: {
        ref_name: {
          include: ["~DEFAULT_BRANCH"],
          exclude: [],
        },
      },
      rules: ensureGatePolicyInRules([]).rules,
    };
    const responses = {
      ...canonicalRemoteWorkflowResponses(repoSlug),
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
        [completeRuleset],
      ],
      [`repos/${repoSlug}/rulesets/7`]: completeRuleset,
    };
    const result = runBootstrap(["--repo", repoSlug, "--apply"], {
      env: {
        ...process.env,
        PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
        FAKE_GH_RESPONSES: JSON.stringify(responses),
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No change: codex\/github-review-gate is already required/u);
    assert.doesNotMatch(result.stdout, /Updated ruleset/u);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("activation requires a staged disabled repository ruleset and preserves active no-op", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const repoSlug = "Joey-Tools/consumer";
  try {
    const disabledIncomplete = completeDisabledRulesetFixture(7);
    disabledIncomplete.rules = disabledIncomplete.rules.filter(
      (rule) => rule.type !== "non_fast_forward",
    );
    for (const [name, rulesets, expectedStatus, expected] of [
      [
        "missing",
        [],
        1,
        /Cannot activate missing repository ruleset.*plain --apply first/u,
      ],
      [
        "active-complete",
        [completeActiveRulesetFixture(7)],
        0,
        /complete v2 gate policy is already enforced/u,
      ],
      [
        "active-incomplete",
        [
          {
            ...completeActiveRulesetFixture(7),
            rules: completeActiveRulesetFixture(7).rules.filter(
              (rule) => rule.type !== "pull_request",
            ),
          },
        ],
        1,
        /active legacy or incomplete gate.*distinct --ruleset-name/u,
      ],
      [
        "disabled-incomplete",
        [disabledIncomplete],
        1,
        /disabled but not an exact staged complete v2 gate policy/u,
      ],
    ]) {
      const fakeBin = join(fixtureRoot, name);
      const callLog = join(fixtureRoot, `${name}.log`);
      createFakeGhExecutable(fakeBin);
      const responses = {
        ...canonicalRemoteWorkflowResponses(repoSlug),
        [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
          rulesets,
        ],
        ...Object.fromEntries(
          rulesets.map((ruleset) => [
            `repos/${repoSlug}/rulesets/${ruleset.id}`,
            ruleset,
          ]),
        ),
        [`POST repos/${repoSlug}/rulesets`]: { id: 8 },
        [`PUT repos/${repoSlug}/rulesets/7`]: { id: 7 },
      };
      const result = runBootstrap(activationArguments(repoSlug, CANARY_HEAD_SHA), {
        env: {
          ...process.env,
          PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
          FAKE_GH_RESPONSES: JSON.stringify(responses),
          FAKE_GH_CALL_LOG: callLog,
        },
      });
      assert.equal(result.status, expectedStatus, `${name}: ${result.stderr}`);
      assert.match(expectedStatus === 0 ? result.stdout : result.stderr, expected, name);
      const calls = readFileSync(callLog, "utf8");
      assert.doesNotMatch(calls, /^(?:POST|PUT) /mu, name);
      assert.doesNotMatch(calls, new RegExp(`^GET repos/${repoSlug}/pulls/7$`, "mu"), name);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("activation refuses to silently approval-gate existing unmanaged CODEOWNERS patterns", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const fakeBin = join(fixtureRoot, "bin");
  const callLog = join(fixtureRoot, "calls.log");
  const repoSlug = "Joey-Tools/consumer";
  try {
    createFakeGhExecutable(fakeBin);
    const disabledRuleset = completeDisabledRulesetFixture(7);
    const unmanagedCodeowners = ensureControlPlaneCodeownersContent(
      "/src/** @Alice\n",
    ).content;
    const responses = {
      ...canonicalRemoteWorkflowResponses(repoSlug),
      [`repos/${repoSlug}/git/blobs/codeowners-blob`]: {
        encoding: "base64",
        content: Buffer.from(unmanagedCodeowners, "utf8").toString("base64"),
      },
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
        [disabledRuleset],
      ],
      [`repos/${repoSlug}/rulesets/7`]: disabledRuleset,
    };
    const result = runBootstrap(activationArguments(repoSlug, CANARY_HEAD_SHA), {
      env: {
        ...process.env,
        PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
        FAKE_GH_RESPONSES: JSON.stringify(responses),
        FAKE_GH_CALL_LOG: callLog,
      },
    });
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /will not silently broaden approval policy/u,
    );
    const calls = readFileSync(callLog, "utf8");
    assert.doesNotMatch(calls, new RegExp(`^GET repos/${repoSlug}/pulls/7$`, "mu"));
    assert.doesNotMatch(calls, new RegExp(`^PUT repos/${repoSlug}/rulesets/7$`, "mu"));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("activation does not treat bypassable or unreadable rulesets as equivalent Code Owner policy", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const repoSlug = "Joey-Tools/consumer";
  try {
    for (const [name, bypassActors, expected] of [
      [
        "non-empty",
        [{ actor_id: 7, actor_type: "Team", bypass_mode: "always" }],
        /will not silently broaden approval policy/u,
      ],
      [
        "missing",
        undefined,
        /Full ruleset API readback is malformed/u,
      ],
      [
        "malformed",
        {},
        /Full ruleset API readback is malformed/u,
      ],
    ]) {
      const fakeBin = join(fixtureRoot, name);
      const callLog = join(fixtureRoot, `${name}.log`);
      createFakeGhExecutable(fakeBin);
      const disabledRuleset = completeDisabledRulesetFixture(7);
      const existingCodeOwnerPolicy = {
        ...completeActiveRulesetFixture(8),
        name: "Existing Code Owner Policy",
        source_type: "Organization",
        bypass_actors: bypassActors,
      };
      if (bypassActors === undefined) {
        delete existingCodeOwnerPolicy.bypass_actors;
      }
      const unmanagedCodeowners = ensureControlPlaneCodeownersContent(
        "/src/** @Alice\n",
      ).content;
      const responses = {
        ...canonicalRemoteWorkflowResponses(repoSlug),
        [`repos/${repoSlug}/git/blobs/codeowners-blob`]: {
          encoding: "base64",
          content: Buffer.from(unmanagedCodeowners, "utf8").toString("base64"),
        },
        [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [[
          disabledRuleset,
          existingCodeOwnerPolicy,
        ]],
        [`repos/${repoSlug}/rulesets/7`]: disabledRuleset,
        [`repos/${repoSlug}/rulesets/8`]: existingCodeOwnerPolicy,
      };
      const result = runBootstrap(activationArguments(repoSlug, CANARY_HEAD_SHA), {
        env: {
          ...process.env,
          PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
          FAKE_GH_RESPONSES: JSON.stringify(responses),
          FAKE_GH_CALL_LOG: callLog,
        },
      });
      assert.equal(result.status, 1, `${name}: ${result.stderr}`);
      assert.match(
        result.stderr,
        expected,
        name,
      );
      const calls = readFileSync(callLog, "utf8");
      assert.doesNotMatch(calls, new RegExp(`^GET repos/${repoSlug}/pulls/7$`, "mu"));
      assert.doesNotMatch(calls, new RegExp(`^PUT repos/${repoSlug}/rulesets/7$`, "mu"));
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("activation rejects a colliding exact-name check run before ruleset update", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const fakeBin = join(fixtureRoot, "bin");
  const callLog = join(fixtureRoot, "calls.log");
  const repoSlug = "Joey-Tools/consumer";
  const disabledRuleset = completeDisabledRulesetFixture(7);
  const checkRunsEndpoint =
    `repos/${repoSlug}/commits/${CANARY_HEAD_SHA}/check-runs?check_name=codex%2Fgithub-review-gate&filter=latest&per_page=100`;
  try {
    createFakeGhExecutable(fakeBin);
    const responses = {
      ...canonicalRemoteWorkflowResponses(repoSlug),
      ...canaryRunResponses(repoSlug),
      [`repos/${repoSlug}/pulls/7`]: canaryPullRequestFixture(
        repoSlug,
        CANARY_HEAD_SHA,
      ),
      [checkRunsEndpoint]: [
        {
          total_count: 2,
          check_runs: [
            canonicalCanaryCheckRunFixture(repoSlug),
            {
              ...canonicalCanaryCheckRunFixture(repoSlug),
              id: CANARY_CHECK_RUN_ID + 1,
            },
          ],
        },
      ],
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
        [disabledRuleset],
      ],
      [`repos/${repoSlug}/rulesets/7`]: disabledRuleset,
      [`PUT repos/${repoSlug}/rulesets/7`]: { id: 7 },
    };
    const result = runBootstrap(activationArguments(repoSlug, CANARY_HEAD_SHA), {
      env: {
        ...process.env,
        PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
        FAKE_GH_RESPONSES: JSON.stringify(responses),
        FAKE_GH_CALL_LOG: callLog,
      },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must have exactly one latest CheckRun/u);
    assert.doesNotMatch(
      readFileSync(callLog, "utf8"),
      new RegExp(`^PUT repos/${repoSlug}/rulesets/7$`, "mu"),
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("native canary rejects legacy status projection and control-plane changes", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const repoSlug = "Joey-Tools/consumer";
  try {
    for (const [name, mutate, expected] of [
      [
        "legacy-status",
        (responses) => {
          responses[
            `repos/${repoSlug}/commits/${CANARY_HEAD_SHA}/statuses?per_page=100`
          ] = [[{
            context: DEFAULT_STATUS_CONTEXT,
            state: "success",
            sha: CANARY_HEAD_SHA,
          }]];
        },
        /legacy commit status projection/u,
      ],
      [
        "control-plane-change",
        (responses) => {
          responses[`repos/${repoSlug}/pulls/7`] = {
            ...responses[`repos/${repoSlug}/pulls/7`],
            changed_files: 1,
          };
          responses[`repos/${repoSlug}/pulls/7/files?per_page=100`] = [[{
            filename: DEFAULT_CONTROLLER_WORKFLOW_PATH,
          }]];
        },
        /changes the protected control plane/u,
      ],
    ]) {
      const fakeBin = join(fixtureRoot, name);
      const callLog = join(fixtureRoot, `${name}.log`);
      createFakeGhExecutable(fakeBin);
      const disabledRuleset = completeDisabledRulesetFixture(7);
      const responses = {
        ...canonicalRemoteWorkflowResponses(repoSlug),
        ...canaryRunResponses(repoSlug),
        [`repos/${repoSlug}/pulls/7`]: canaryPullRequestFixture(
          repoSlug,
          CANARY_HEAD_SHA,
        ),
        [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
          [disabledRuleset],
        ],
        [`repos/${repoSlug}/rulesets/7`]: disabledRuleset,
      };
      mutate(responses);
      const result = runBootstrap(activationArguments(repoSlug, CANARY_HEAD_SHA), {
        env: {
          ...process.env,
          PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
          FAKE_GH_RESPONSES: JSON.stringify(responses),
          FAKE_GH_CALL_LOG: callLog,
        },
      });
      assert.equal(result.status, 1, name);
      assert.match(result.stderr, expected, name);
      assert.doesNotMatch(
        readFileSync(callLog, "utf8"),
        new RegExp(`^PUT repos/${repoSlug}/rulesets/7$`, "mu"),
      );
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("native canary requires a complete authoritative and rename-aware file inventory", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const repoSlug = "Joey-Tools/consumer";
  try {
    for (const [name, pullRequestOverrides, filePages, expected] of [
      [
        "missing-authoritative-count",
        { changed_files: undefined },
        [[]],
        /lacks an authoritative non-negative changed_files count/u,
      ],
      [
        "over-api-limit",
        { changed_files: 3_001 },
        [[]],
        /beyond GitHub's 3000-file pull-request files API limit/u,
      ],
      [
        "truncated-inventory",
        { changed_files: 1 },
        [[]],
        /incomplete or inconsistent with authoritative changed_files=1/u,
      ],
      [
        "malformed-filename",
        { changed_files: 1 },
        [[{ filename: null }]],
        /malformed file record/u,
      ],
      [
        "malformed-previous-filename",
        { changed_files: 1 },
        [[{ filename: "docs/canary.md", previous_filename: null }]],
        /malformed file record/u,
      ],
      [
        "duplicate-record",
        { changed_files: 2 },
        [[
          { filename: "docs/canary.md" },
          { filename: "docs/canary.md" },
        ]],
        /duplicate filename/u,
      ],
      [
        "rename-away-from-control-plane",
        { changed_files: 1 },
        [[{
          filename: "docs/moved-workflow.yml",
          previous_filename: DEFAULT_WORKFLOW_PATH,
        }]],
        /changes the protected control plane/u,
      ],
    ]) {
      const fakeBin = join(fixtureRoot, name);
      const callLog = join(fixtureRoot, `${name}.log`);
      createFakeGhExecutable(fakeBin);
      const disabledRuleset = completeDisabledRulesetFixture(7);
      const pullRequest = {
        ...canaryPullRequestFixture(repoSlug, CANARY_HEAD_SHA),
        ...pullRequestOverrides,
      };
      if (pullRequestOverrides.changed_files === undefined) {
        delete pullRequest.changed_files;
      }
      const responses = {
        ...canonicalRemoteWorkflowResponses(repoSlug),
        ...canaryRunResponses(repoSlug),
        [`repos/${repoSlug}/pulls/7`]: pullRequest,
        [`repos/${repoSlug}/pulls/7/files?per_page=100`]: filePages,
        [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
          [disabledRuleset],
        ],
        [`repos/${repoSlug}/rulesets/7`]: disabledRuleset,
      };
      const result = runBootstrap(activationArguments(repoSlug, CANARY_HEAD_SHA), {
        env: {
          ...process.env,
          PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
          FAKE_GH_RESPONSES: JSON.stringify(responses),
          FAKE_GH_CALL_LOG: callLog,
        },
      });
      assert.equal(result.status, 1, `${name}: ${result.stderr}`);
      assert.match(result.stderr, expected, name);
      assert.doesNotMatch(
        readFileSync(callLog, "utf8"),
        new RegExp(`^PUT repos/${repoSlug}/rulesets/7$`, "mu"),
      );
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("activation revalidates canary PR lifecycle and exact head immediately before update", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const fakeBin = join(fixtureRoot, "bin");
  const stateDir = join(fixtureRoot, "state");
  const callLog = join(fixtureRoot, "calls.log");
  const repoSlug = "Joey-Tools/consumer";
  const headSha = "0123456789abcdef0123456789abcdef01234567";
  try {
    createFakeGhExecutable(fakeBin);
    const validPullRequest = canaryPullRequestFixture(repoSlug, headSha);
    const disabledRuleset = completeDisabledRulesetFixture(7);
    const responses = {
      ...canonicalRemoteWorkflowResponses(repoSlug),
      ...canaryRunResponses(repoSlug),
      [`GET repos/${repoSlug}/pulls/7`]: {
        __fake_sequence: [validPullRequest, { ...validPullRequest, state: "closed" }],
      },
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
        [disabledRuleset],
      ],
      [`repos/${repoSlug}/rulesets/7`]: disabledRuleset,
      [`PUT repos/${repoSlug}/rulesets/7`]: { id: 7 },
    };

    const result = runBootstrap(activationArguments(repoSlug, headSha), {
      env: fakeGhEnvironment({ fakeBin, responses, stateDir, callLog }),
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Canary PR #7 is not an open/u);
    const calls = readFileSync(callLog, "utf8");
    assert.equal(countLines(calls, `GET repos/${repoSlug}/pulls/7`), 2);
    assert.equal(
      countLines(calls, `GET repos/${repoSlug}/commits/${headSha}/statuses?per_page=100`),
      1,
    );
    assert.doesNotMatch(calls, new RegExp(`^PUT repos/${repoSlug}/rulesets/7$`, "mu"));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("activation revalidates the native feature-head CheckRun immediately before update", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const fakeBin = join(fixtureRoot, "bin");
  const stateDir = join(fixtureRoot, "state");
  const callLog = join(fixtureRoot, "calls.log");
  const repoSlug = "Joey-Tools/consumer";
  const headSha = "0123456789abcdef0123456789abcdef01234567";
  try {
    createFakeGhExecutable(fakeBin);
    const validPullRequest = canaryPullRequestFixture(repoSlug, headSha);
    const disabledRuleset = completeDisabledRulesetFixture(7);
    const responses = {
      ...canonicalRemoteWorkflowResponses(repoSlug),
      ...canaryRunResponses(repoSlug),
      [`GET repos/${repoSlug}/pulls/7`]: {
        __fake_sequence: [validPullRequest, validPullRequest],
      },
      [`GET repos/${repoSlug}/commits/${headSha}/check-runs?check_name=codex%2Fgithub-review-gate&filter=latest&per_page=100`]: {
        __fake_sequence: [
          [{ total_count: 1, check_runs: [canonicalCanaryCheckRunFixture(repoSlug)] }],
          [{
            total_count: 1,
            check_runs: [{
              ...canonicalCanaryCheckRunFixture(repoSlug),
              app: { id: 99999, name: "Other", slug: "other" },
            }],
          }],
        ],
      },
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
        [disabledRuleset],
      ],
      [`repos/${repoSlug}/rulesets/7`]: disabledRuleset,
      [`PUT repos/${repoSlug}/rulesets/7`]: { id: 7 },
    };

    const result = runBootstrap(activationArguments(repoSlug, headSha), {
      env: fakeGhEnvironment({ fakeBin, responses, stateDir, callLog }),
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a successful native GitHub Actions CheckRun/u);
    const calls = readFileSync(callLog, "utf8");
    assert.equal(countLines(calls, `GET repos/${repoSlug}/pulls/7`), 2);
    assert.equal(
      countLines(calls, `GET repos/${repoSlug}/commits/${headSha}/check-runs?check_name=codex%2Fgithub-review-gate&filter=latest&per_page=100`),
      2,
    );
    assert.doesNotMatch(calls, new RegExp(`^PUT repos/${repoSlug}/rulesets/7$`, "mu"));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("activation rejects spoofed source bindings and stale feature-head subjects", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const repoSlug = "Joey-Tools/consumer";
  const headSha = "0123456789abcdef0123456789abcdef01234567";
  const validPullRequest = canaryPullRequestFixture(repoSlug, headSha);
  try {
    for (const [name, checkRunOverrides, runOverrides, jobOverrides, expected] of [
      [
        "spoof-target",
        { details_url: "https://example.invalid/Joey-Tools/consumer/actions/runs/9007/job/18017" },
        {},
        {},
        /not a canonical same-repository GitHub Actions job URL/u,
      ],
      [
        "wrong-workflow",
        {},
        { path: ".github/workflows/attacker.yml" },
        {},
        /does not resolve to a successful current pull_request run/u,
      ],
      [
        "decorated-workflow-path",
        {},
        { path: `${DEFAULT_WORKFLOW_PATH}@refs/pull/7/merge` },
        {},
        /does not resolve to a successful current pull_request run/u,
      ],
      [
        "stale-run-feature-head",
        {},
        { head_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
        {},
        /does not resolve to a successful current pull_request run/u,
      ],
      [
        "stale-run-base",
        {},
        {
          pull_requests: [canonicalCanaryRunPullRequestFixture(repoSlug, {
            baseSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          })],
        },
        {},
        /does not resolve to a successful current pull_request run/u,
      ],
      [
        "missing-run-repository-id",
        {},
        { repository: { full_name: repoSlug } },
        {},
        /does not resolve to a successful current pull_request run/u,
      ],
      [
        "mismatched-run-repository-id",
        {},
        { repository: { id: 5678, full_name: repoSlug } },
        {},
        /does not resolve to a successful current pull_request run/u,
      ],
      [
        "missing-run-head-repository-id",
        {},
        { head_repository: { full_name: repoSlug } },
        {},
        /does not resolve to a successful current pull_request run/u,
      ],
      [
        "mismatched-run-head-repository-id",
        {},
        { head_repository: { id: 5678, full_name: repoSlug } },
        {},
        /does not resolve to a successful current pull_request run/u,
      ],
      [
        "mismatched-run-pr-head-repository",
        {},
        {
          pull_requests: [canonicalCanaryRunPullRequestFixture(repoSlug, {
            headRepoId: 5678,
          })],
        },
        {},
        /does not resolve to a successful current pull_request run/u,
      ],
      [
        "mismatched-run-pr-base-repository",
        {},
        {
          pull_requests: [canonicalCanaryRunPullRequestFixture(repoSlug, {
            baseRepoId: 5678,
          })],
        },
        {},
        /does not resolve to a successful current pull_request run/u,
      ],
      [
        "missing-test-merge-receipt",
        {},
        { display_title: undefined },
        {},
        /lacks the exact current test-merge run-name receipt/u,
      ],
      [
        "stale-test-merge-receipt",
        {},
        {
          display_title:
            `${DEFAULT_VERIFIER_RUN_NAME_PREFIX}/7/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`,
        },
        {},
        /lacks the exact current test-merge run-name receipt/u,
      ],
      [
        "wrong-test-merge-receipt",
        {},
        { display_title: `other-verifier/7/${CANARY_MERGE_SHA}` },
        {},
        /lacks the exact current test-merge run-name receipt/u,
      ],
      [
        "stale-checkrun-feature-head",
        { head_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
        {},
        {},
        /CheckRun inventory is incomplete, malformed, or inconsistent/u,
      ],
      [
        "stale-job-feature-head",
        {},
        {},
        { head_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
        /canonical job bound to its exact head/u,
      ],
    ]) {
      const fakeBin = join(fixtureRoot, name);
      createFakeGhExecutable(fakeBin);
      const disabledRuleset = completeDisabledRulesetFixture(7);
      const responses = {
        ...canonicalRemoteWorkflowResponses(repoSlug),
        ...canaryRunResponses(repoSlug, runOverrides),
        [`GET repos/${repoSlug}/pulls/7`]: validPullRequest,
        [`repos/${repoSlug}/commits/${headSha}/check-runs?check_name=codex%2Fgithub-review-gate&filter=latest&per_page=100`]: [
          {
            total_count: 1,
            check_runs: [
              { ...canonicalCanaryCheckRunFixture(repoSlug), ...checkRunOverrides },
            ],
          },
        ],
        [`repos/${repoSlug}/actions/runs/${CANARY_RUN_ID}/attempts/1/jobs?per_page=100`]: [
          {
            total_count: 1,
            jobs: [
              { ...canonicalCanaryJobFixture(repoSlug), ...jobOverrides },
            ],
          },
        ],
        [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
          [disabledRuleset],
        ],
        [`repos/${repoSlug}/rulesets/7`]: disabledRuleset,
      };
      const result = runBootstrap(activationArguments(repoSlug, headSha), {
        env: {
          ...process.env,
          PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
          FAKE_GH_RESPONSES: JSON.stringify(responses),
        },
      });
      assert.equal(result.status, 1, name);
      assert.match(result.stderr, expected, name);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("ruleset update refuses a lost-update overwrite after a fresh full read", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const fakeBin = join(fixtureRoot, "bin");
  const stateDir = join(fixtureRoot, "state");
  const callLog = join(fixtureRoot, "calls.log");
  const repoSlug = "Joey-Tools/consumer";
  try {
    createFakeGhExecutable(fakeBin);
    const initial = completeDisabledRulesetFixture(7);
    initial.rules = initial.rules.filter((rule) => rule.type !== "pull_request");
    const drifted = structuredClone(initial);
    drifted.conditions.ref_name.exclude = ["refs/heads/release-freeze"];
    const responses = {
      ...canonicalRemoteWorkflowResponses(repoSlug),
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [[initial]],
      [`GET repos/${repoSlug}/rulesets/7`]: {
        __fake_sequence: [initial, initial, drifted],
      },
      [`PUT repos/${repoSlug}/rulesets/7`]: { id: 7 },
    };
    const result = runBootstrap(["--repo", repoSlug, "--apply"], {
      env: fakeGhEnvironment({ fakeBin, responses, stateDir, callLog }),
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /changed after planning; refusing a lost-update overwrite/u);
    const calls = readFileSync(callLog, "utf8");
    assert.equal(countLines(calls, `GET repos/${repoSlug}/rulesets/7`), 3);
    assert.doesNotMatch(calls, new RegExp(`^PUT repos/${repoSlug}/rulesets/7$`, "mu"));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("a complete active v2 ruleset preserves same-ruleset legacy without PUT", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const repoSlug = "Joey-Tools/consumer";
  try {
    const activeWithLegacy = completeActiveRulesetFixture(7);
    activeWithLegacy.rules
      .find((rule) => rule.type === "required_status_checks")
      .parameters.required_status_checks.push({ context: LEGACY_STATUS_CONTEXT });
    for (const [name, args] of [
      ["plain", ["--repo", repoSlug, "--apply"]],
      ["activate", activationArguments(repoSlug, CANARY_HEAD_SHA)],
    ]) {
      const fakeBin = join(fixtureRoot, name);
      const callLog = join(fixtureRoot, `${name}.log`);
      createFakeGhExecutable(fakeBin);
      const responses = {
        ...canonicalRemoteWorkflowResponses(repoSlug),
        [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
          [activeWithLegacy],
        ],
        [`repos/${repoSlug}/rulesets/7`]: activeWithLegacy,
        [`PUT repos/${repoSlug}/rulesets/7`]: activeWithLegacy,
      };
      const result = runBootstrap(args, {
        env: {
          ...process.env,
          PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
          FAKE_GH_RESPONSES: JSON.stringify(responses),
          FAKE_GH_CALL_LOG: callLog,
        },
      });
      assert.equal(result.status, 0, `${name}: ${result.stderr}`);
      assert.match(result.stdout, /No cleanup: codex\/review-gate remains required/u, name);
      assert.match(result.stdout, /No change/u, name);
      const calls = readFileSync(callLog, "utf8");
      assert.doesNotMatch(
        calls,
        new RegExp(`^PUT repos/${repoSlug}/rulesets/7$`, "mu"),
        name,
      );
      assert.doesNotMatch(calls, new RegExp(`^GET repos/${repoSlug}/pulls/7$`, "mu"), name);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("activation update refuses default-branch and workflow drift between security reads", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const repoSlug = "Joey-Tools/consumer";
  const headSha = "0123456789abcdef0123456789abcdef01234567";
  const validPullRequest = canaryPullRequestFixture(repoSlug, headSha);
  try {
    for (const [name, mutateResponses, expected] of [
      [
        "default-branch",
        (responses) => {
          responses[`repos/${repoSlug}`] = {
            __fake_sequence: [
              repositoryMetadataFixture(repoSlug),
              repositoryMetadataFixture(repoSlug),
              repositoryMetadataFixture(repoSlug),
              repositoryMetadataFixture(repoSlug, { default_branch: "main" }),
            ],
          };
        },
        /Repository default branch changed from master to main/u,
      ],
      [
        "workflow-bytes",
        (responses) => {
          responses[`repos/${repoSlug}/git/blobs/canonical-blob`] = {
            __fake_sequence: [
              {
                encoding: "base64",
                content: Buffer.from(CANONICAL_WORKFLOW, "utf8").toString("base64"),
              },
              {
                encoding: "base64",
                content: Buffer.from(`${CANONICAL_WORKFLOW}\n# drift\n`, "utf8").toString("base64"),
              },
            ],
          };
        },
        /differs from the canonical v2 verifier workflow bytes/u,
      ],
      [
        "run-name-omitted",
        (responses) => {
          responses[`repos/${repoSlug}/git/blobs/canonical-blob`] = {
            __fake_sequence: [
              {
                encoding: "base64",
                content: Buffer.from(CANONICAL_WORKFLOW, "utf8").toString("base64"),
              },
              {
                encoding: "base64",
                content: Buffer.from(
                  CANONICAL_WORKFLOW.replace(
                    `run-name: ${DEFAULT_VERIFIER_RUN_NAME}\n`,
                    "",
                  ),
                  "utf8",
                ).toString("base64"),
              },
            ],
          };
        },
        /exactly one top-level run-name/u,
      ],
      [
        "run-name-tampered",
        (responses) => {
          responses[`repos/${repoSlug}/git/blobs/canonical-blob`] = {
            __fake_sequence: [
              {
                encoding: "base64",
                content: Buffer.from(CANONICAL_WORKFLOW, "utf8").toString("base64"),
              },
              {
                encoding: "base64",
                content: Buffer.from(
                  CANONICAL_WORKFLOW.replace(
                    DEFAULT_VERIFIER_RUN_NAME,
                    "attacker/${{ github.sha }}",
                  ),
                  "utf8",
                ).toString("base64"),
              },
            ],
          };
        },
        /exactly one top-level run-name/u,
      ],
    ]) {
      const fakeBin = join(fixtureRoot, name);
      const stateDir = join(fixtureRoot, `state-${name}`);
      const callLog = join(fixtureRoot, `calls-${name}.log`);
      createFakeGhExecutable(fakeBin);
      const disabledRuleset = completeDisabledRulesetFixture(7);
      const responses = {
        ...canonicalRemoteWorkflowResponses(repoSlug),
        ...canaryRunResponses(repoSlug),
        [`GET repos/${repoSlug}/pulls/7`]: validPullRequest,
        [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
          [disabledRuleset],
        ],
        [`repos/${repoSlug}/rulesets/7`]: disabledRuleset,
        [`PUT repos/${repoSlug}/rulesets/7`]: { id: 7 },
      };
      mutateResponses(responses);
      const result = runBootstrap(activationArguments(repoSlug, headSha), {
        env: fakeGhEnvironment({ fakeBin, responses, stateDir, callLog }),
      });
      assert.equal(result.status, 1, `${name}: ${result.stderr}`);
      assert.match(result.stderr, expected, name);
      assert.doesNotMatch(
        readFileSync(callLog, "utf8"),
        new RegExp(`^PUT repos/${repoSlug}/rulesets/7$`, "mu"),
      );
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("activation fails closed when post-update ruleset readback drifts", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const fakeBin = join(fixtureRoot, "bin");
  const repoSlug = "Joey-Tools/consumer";
  const headSha = "0123456789abcdef0123456789abcdef01234567";
  try {
    createFakeGhExecutable(fakeBin);
    const complete = completeActiveRulesetFixture(7);
    const disabled = completeDisabledRulesetFixture(7);
    const missingBypass = { ...complete };
    delete missingBypass.bypass_actors;
    const releaseOnly = {
      ...complete,
      conditions: { ref_name: { include: ["release/*"], exclude: [] } },
    };
    const wrongSource = structuredClone(complete);
    wrongSource.rules
      .find((rule) => rule.type === "required_status_checks")
      .parameters.required_status_checks[0].integration_id = 99999;
    const unknownServerExpansion = structuredClone(complete);
    unknownServerExpansion.rules
      .find((rule) => rule.type === "pull_request")
      .parameters.future_unreviewed_field = true;

    for (const [name, readback, expected] of [
      [
        "inactive",
        { ...complete, enforcement: "disabled" },
        /Ruleset readback for id 7 is incomplete/u,
      ],
      ["wrong-branch", releaseOnly, /Ruleset readback for id 7 is incomplete/u],
      [
        "missing-bypass",
        missingBypass,
        /Full ruleset API readback is malformed/u,
      ],
      ["wrong-source", wrongSource, /Ruleset readback for id 7 is incomplete/u],
      [
        "unknown-server-expansion",
        unknownServerExpansion,
        /Ruleset readback for id 7 is incomplete/u,
      ],
    ]) {
      const stateDir = join(fixtureRoot, `state-${name}`);
      const callLog = join(fixtureRoot, `calls-${name}.log`);
      const validPullRequest = canaryPullRequestFixture(repoSlug, headSha);
      const responses = {
        ...canonicalRemoteWorkflowResponses(repoSlug),
        ...canaryRunResponses(repoSlug),
        [`GET repos/${repoSlug}/pulls/7`]: {
          __fake_sequence: [validPullRequest, validPullRequest, validPullRequest],
        },
        [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
          [disabled],
        ],
        [`PUT repos/${repoSlug}/rulesets/7`]: { id: 7 },
        [`GET repos/${repoSlug}/rulesets/7`]: {
          __fake_sequence: [
            disabled,
            disabled,
            disabled,
            disabled,
            disabled,
            readback,
          ],
        },
      };

      const result = runBootstrap(activationArguments(repoSlug, headSha), {
        env: fakeGhEnvironment({ fakeBin, responses, stateDir, callLog }),
      });

      assert.equal(result.status, 1, `${name}: ${result.stderr}`);
      assert.match(result.stderr, expected);
      assert.match(result.stderr, /Active write may already have completed/u);
      assert.match(result.stderr, /preserve the v2 ruleset/u);
      assert.match(result.stderr, /every legacy protection/u);
      assert.match(result.stderr, /do not disable, delete, or overwrite/u);
      assert.doesNotMatch(result.stderr, /repair or disable it/u);
      const calls = readFileSync(callLog, "utf8");
      assert.match(calls, new RegExp(`^PUT repos/${repoSlug}/rulesets/7$`, "mu"));
      assert.match(calls, new RegExp(`^GET repos/${repoSlug}/rulesets/7$`, "mu"));
      assert.doesNotMatch(result.stdout, /Updated ruleset/u);
      assert.ok(
        calls.indexOf(`PUT repos/${repoSlug}/rulesets/7`) <
          calls.lastIndexOf(`GET repos/${repoSlug}/rulesets/7`),
      );
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("active post-write API failures preserve v2 and never advise disable", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const fakeBin = join(fixtureRoot, "bin");
  const stateDir = join(fixtureRoot, "state");
  const callLog = join(fixtureRoot, "calls.log");
  const repoSlug = "Joey-Tools/consumer";
  const headSha = "0123456789abcdef0123456789abcdef01234567";
  try {
    createFakeGhExecutable(fakeBin);
    const repository = repositoryMetadataFixture(repoSlug);
    const disabled = completeDisabledRulesetFixture(7);
    const active = completeActiveRulesetFixture(7);
    const validPullRequest = canaryPullRequestFixture(repoSlug, headSha);
    const responses = {
      ...canonicalRemoteWorkflowResponses(repoSlug),
      ...canaryRunResponses(repoSlug),
      [`repos/${repoSlug}`]: {
        __fake_sequence: [
          repository,
          repository,
          repository,
          repository,
          repository,
          repository,
          repository,
          repository,
          repository,
          repository,
          repository,
          { __fake_http_error: 503, message: "post-write repository read failed" },
        ],
      },
      [`GET repos/${repoSlug}/pulls/7`]: {
        __fake_sequence: [validPullRequest, validPullRequest, validPullRequest],
      },
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
        [disabled],
      ],
      [`PUT repos/${repoSlug}/rulesets/7`]: { id: 7 },
      [`GET repos/${repoSlug}/rulesets/7`]: {
        __fake_sequence: [
          disabled,
          disabled,
          disabled,
          disabled,
          disabled,
          active,
        ],
      },
    };
    const result = runBootstrap(activationArguments(repoSlug, headSha), {
      env: fakeGhEnvironment({ fakeBin, responses, stateDir, callLog }),
    });

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /post-write repository read failed/u);
    const calls = readFileSync(callLog, "utf8");
    assert.match(calls, new RegExp(`^PUT repos/${repoSlug}/rulesets/7$`, "mu"));
    assert.match(result.stderr, /Active write may already have completed/u);
    assert.match(result.stderr, /preserve the v2 ruleset/u);
    assert.match(result.stderr, /every legacy protection/u);
    assert.match(result.stderr, /do not disable, delete, or overwrite/u);
    assert.doesNotMatch(result.stderr, /repair or disable it/u);
    assert.doesNotMatch(result.stdout, /Updated ruleset/u);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("activation reads only the current feature-head CheckRun and succeeds after complete readback", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const fakeBin = join(fixtureRoot, "bin");
  const stateDir = join(fixtureRoot, "state");
  const callLog = join(fixtureRoot, "calls.log");
  const repoSlug = "Joey-Tools/consumer";
  const headSha = "0123456789abcdef0123456789abcdef01234567";
  try {
    createFakeGhExecutable(fakeBin);
    const validPullRequest = canaryPullRequestFixture(repoSlug, headSha);
    const disabled = completeDisabledRulesetFixture(7);
    const active = completeActiveRulesetFixture(7);
    const responses = {
      ...canonicalRemoteWorkflowResponses(repoSlug),
      ...canaryRunResponses(repoSlug),
      [`GET repos/${repoSlug}/pulls/7`]: {
        __fake_sequence: [validPullRequest, validPullRequest, validPullRequest],
      },
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
        [disabled],
      ],
      [`PUT repos/${repoSlug}/rulesets/7`]: {
        id: 7,
        name: "Must Pass Codex Review",
      },
      [`GET repos/${repoSlug}/rulesets/7`]: {
        __fake_sequence: [
          disabled,
          disabled,
          disabled,
          disabled,
          disabled,
          active,
          active,
        ],
      },
    };

    const result = runBootstrap(activationArguments(repoSlug, headSha), {
      env: fakeGhEnvironment({ fakeBin, responses, stateDir, callLog }),
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Ruleset readback: Must Pass Codex Review/u);
    const calls = readFileSync(callLog, "utf8");
    assert.equal(
      countLines(calls, `GET repos/${repoSlug}/pulls/7`),
      3,
    );
    assert.equal(
      countLines(
        calls,
        `GET repos/${repoSlug}/commits/${headSha}/check-runs?check_name=codex%2Fgithub-review-gate&filter=latest&per_page=100`,
      ),
      3,
    );
    assert.equal(
      countLines(
        calls,
        `GET repos/${repoSlug}/commits/${DEFAULT_BRANCH_SHA}/check-runs?check_name=codex%2Fgithub-review-gate&filter=latest&per_page=100`,
      ),
      0,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("remote digest admission rejects missing, malformed, and mismatching approvals before writes", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const fakeBin = join(fixtureRoot, "bin");
  const repoSlug = "Joey-Tools/consumer";
  try {
    createFakeGhExecutable(fakeBin);
    const responses = {
      ...canonicalRemoteWorkflowResponses(repoSlug),
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [[]],
    };
    assert.notEqual(
      legacyInventoryResponseFixtures(repoSlug).approval.sha256,
      legacyInventoryResponseFixtures("Joey-Tools/other-consumer").approval.sha256,
    );
    assert.notEqual(
      legacyInventoryResponseFixtures(repoSlug).approval.sha256,
      legacyInventoryResponseFixtures(repoSlug, { defaultBranch: "main" }).approval
        .sha256,
    );

    for (const [name, args, expected] of [
      [
        "missing",
        ["--repo", repoSlug],
        /requires --expected-legacy-inventory-sha256/u,
      ],
      [
        "malformed-uppercase",
        [
          "--repo",
          repoSlug,
          "--expected-legacy-inventory-sha256",
          "A".repeat(64),
        ],
        /exact lowercase 64-hex SHA-256/u,
      ],
      [
        "mismatch",
        [
          "--repo",
          repoSlug,
          "--expected-legacy-inventory-sha256",
          "0".repeat(64),
        ],
        /canonical legacy review-gate inventory digest mismatched.*initial approval-snapshot readback/iu,
      ],
    ]) {
      const callLog = join(fixtureRoot, `${name}.log`);
      const result = runBootstrap(args, {
        addExpectedLegacyInventoryDigest: false,
        env: {
          ...process.env,
          PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
          FAKE_GH_RESPONSES: JSON.stringify(responses),
          FAKE_GH_CALL_LOG: callLog,
        },
      });
      assert.equal(result.status, 1, name);
      assert.match(result.stderr, expected, name);
      const calls = existsSync(callLog) ? readFileSync(callLog, "utf8") : "";
      assert.doesNotMatch(calls, /^(?:POST|PUT) /mu, name);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("independent staging and activation runs preserve stable legacy and greenfield inventories", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const repoSlug = "Joey-Tools/consumer";
  const v2RulesetName = "Must Pass Codex Review v2";
  try {
    for (const [name, legacyRulesets] of [
      ["greenfield", []],
      ["stable-legacy", [activeLegacyRulesetFixture(7)]],
    ]) {
      const fakeBin = join(fixtureRoot, name);
      const stateDir = join(fixtureRoot, `${name}-state`);
      const stageLog = join(fixtureRoot, `${name}-stage.log`);
      const activationLog = join(fixtureRoot, `${name}-activation.log`);
      createFakeGhExecutable(fakeBin);
      const migration = stageThenActivationResponseFixtures({
        repoSlug,
        legacyRulesets,
        v2RulesetName,
      });

      const stage = runBootstrap([
        "--repo",
        repoSlug,
        "--ruleset-name",
        v2RulesetName,
        "--apply",
      ], {
        env: fakeGhEnvironment({
          fakeBin,
          responses: migration.responses,
          stateDir,
          callLog: stageLog,
        }),
      });
      assert.equal(stage.status, 0, `${name} stage: ${stage.stderr}`);
      assert.match(stage.stdout, /Created ruleset/u, name);

      const activation = runBootstrap([
        ...activationArguments(repoSlug, CANARY_HEAD_SHA),
        "--ruleset-name",
        v2RulesetName,
      ], {
        env: fakeGhEnvironment({
          fakeBin,
          responses: migration.responses,
          stateDir,
          callLog: activationLog,
        }),
      });
      assert.equal(
        activation.status,
        0,
        `${name} activation: ${activation.stderr}`,
      );
      assert.match(activation.stdout, /Updated ruleset/u, name);

      const inventoryEndpoint =
        `GET repos/${repoSlug}/rules/branches/master?per_page=100`;
      const stageCalls = readFileSync(stageLog, "utf8");
      const activationCalls = readFileSync(activationLog, "utf8");
      assert.equal(countLines(stageCalls, inventoryEndpoint), 3, name);
      assert.equal(countLines(activationCalls, inventoryEndpoint), 5, name);
      assert.match(stageCalls, new RegExp(`^POST repos/${repoSlug}/rulesets$`, "mu"));
      assert.doesNotMatch(stageCalls, /^PUT /mu, name);
      assert.match(
        activationCalls,
        new RegExp(`^PUT repos/${repoSlug}/rulesets/8$`, "mu"),
      );
      assert.doesNotMatch(activationCalls, /^POST /mu, name);
      const activationLines = activationCalls.trimEnd().split("\n");
      const finalCanaryJobs = activationLines.lastIndexOf(
        `GET repos/${repoSlug}/actions/runs/${CANARY_RUN_ID}/attempts/1/jobs?per_page=100`,
      );
      const finalSecurityRepository = activationLines.indexOf(
        `GET repos/${repoSlug}`,
        finalCanaryJobs + 1,
      );
      const finalSecurityProtection = activationLines.indexOf(
        `GET repos/${repoSlug}/branches/master/protection`,
        finalSecurityRepository + 1,
      );
      const putIndex = activationLines.indexOf(
        `PUT repos/${repoSlug}/rulesets/8`,
      );
      const finalLegacyRead = activationLines.lastIndexOf(
        inventoryEndpoint,
        putIndex - 1,
      );
      const finalTargetRead = activationLines.lastIndexOf(
        `GET repos/${repoSlug}/rulesets/8`,
        putIndex - 1,
      );
      assert.ok(
        finalCanaryJobs !== -1 &&
          finalCanaryJobs < finalSecurityRepository &&
          finalSecurityRepository < finalSecurityProtection &&
          finalSecurityProtection < finalLegacyRead &&
          finalLegacyRead < finalTargetRead &&
          finalTargetRead < putIndex,
        `${name}: final canary, security, legacy, target, and PUT order drifted`,
      );
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("legacy bridge profile survives every remote staging and activation snapshot", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-bridge-remote-"));
  const fakeBin = join(fixtureRoot, "bin");
  const stateDir = join(fixtureRoot, "state");
  const stageLog = join(fixtureRoot, "stage.log");
  const activationLog = join(fixtureRoot, "activation.log");
  const repoSlug = "Joey-Tools/consumer";
  const v2RulesetName = "Must Pass Codex Review v2";
  try {
    createFakeGhExecutable(fakeBin);
    const migration = stageThenActivationResponseFixtures({
      repoSlug,
      legacyRulesets: [activeLegacyRulesetFixture(7)],
      v2RulesetName,
      legacyBridge: true,
    });
    const stage = runBootstrap([
      "--repo",
      repoSlug,
      "--ruleset-name",
      v2RulesetName,
      "--legacy-bridge",
      "--apply",
    ], {
      env: fakeGhEnvironment({
        fakeBin,
        responses: migration.responses,
        stateDir,
        callLog: stageLog,
      }),
    });
    assert.equal(stage.status, 0, stage.stderr);
    assert.match(stage.stdout, /Temporary legacy bridge/u);
    assert.match(stage.stdout, /Created ruleset/u);

    const activation = runBootstrap([
      ...activationArguments(repoSlug, CANARY_HEAD_SHA),
      "--ruleset-name",
      v2RulesetName,
      "--legacy-bridge",
    ], {
      env: fakeGhEnvironment({
        fakeBin,
        responses: migration.responses,
        stateDir,
        callLog: activationLog,
      }),
    });
    assert.equal(activation.status, 0, activation.stderr);
    assert.match(activation.stdout, /Temporary legacy bridge/u);
    assert.match(activation.stdout, /Updated ruleset/u);
    assert.match(
      readFileSync(stageLog, "utf8"),
      new RegExp(`^POST repos/${repoSlug}/rulesets$`, "mu"),
    );
    assert.match(
      readFileSync(activationLog, "utf8"),
      new RegExp(`^PUT repos/${repoSlug}/rulesets/8$`, "mu"),
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("remote bridge admission rejects missing, drifted, displaced, unflagged, or additional callers before writes", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-bridge-reject-"));
  const repoSlug = "Joey-Tools/consumer";
  try {
    for (const scenario of [
      {
        name: "missing",
        flag: true,
        responses: canonicalRemoteWorkflowResponses(repoSlug),
        expected: /codex-review-gate-legacy-bridge\.yml must occur exactly once/u,
      },
      {
        name: "drifted",
        flag: true,
        responses: (() => {
          const responses = canonicalRemoteWorkflowResponses(repoSlug, {
            legacyBridge: true,
          });
          responses[`repos/${repoSlug}/git/blobs/canonical-legacy-bridge-blob`] = {
            encoding: "base64",
            content: Buffer.from(
              CANONICAL_LEGACY_BRIDGE_WORKFLOW.replace(
                "  pull-requests: read",
                "  pull-requests: write",
              ),
              "utf8",
            ).toString("base64"),
          };
          return responses;
        })(),
        expected: /may write only issues and legacy commit statuses/u,
      },
      {
        name: "displaced",
        flag: true,
        responses: (() => {
          const responses = canonicalRemoteWorkflowResponses(repoSlug, {
            legacyBridge: true,
          });
          const tree = responses[`repos/${repoSlug}/git/trees/workflows-tree`];
          tree.tree.find(
            (entry) => entry.sha === "canonical-legacy-bridge-blob",
          ).path = "renamed-legacy-bridge.yml";
          return responses;
        })(),
        expected: /codex-review-gate-legacy-bridge\.yml must occur exactly once/u,
      },
      {
        name: "unflagged",
        flag: false,
        responses: canonicalRemoteWorkflowResponses(repoSlug, {
          legacyBridge: true,
        }),
        expected: /Additional v1\/v2 gate callers/u,
      },
      {
        name: "additional-v2",
        flag: true,
        responses: (() => {
          const responses = canonicalRemoteWorkflowResponses(repoSlug, {
            legacyBridge: true,
          });
          responses[`repos/${repoSlug}/git/trees/workflows-tree`].tree.push({
            path: "extra-v2.yml",
            sha: "extra-v2-blob",
            type: "blob",
            mode: "100644",
          });
          responses[`repos/${repoSlug}/git/blobs/extra-v2-blob`] = {
            encoding: "base64",
            content: Buffer.from(
              "jobs:\n  gate:\n    uses: JoeyTeng/codex-review-gate-action@v2\n",
              "utf8",
            ).toString("base64"),
          };
          return responses;
        })(),
        expected: /Additional v1\/v2 gate callers/u,
      },
    ]) {
      const fakeBin = join(fixtureRoot, scenario.name);
      const callLog = join(fixtureRoot, `${scenario.name}.log`);
      createFakeGhExecutable(fakeBin);
      const args = ["--repo", repoSlug, "--apply"];
      if (scenario.flag) {
        args.push("--legacy-bridge");
      }
      const result = runBootstrap(args, {
        env: {
          ...process.env,
          PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
          FAKE_GH_RESPONSES: JSON.stringify(scenario.responses),
          FAKE_GH_CALL_LOG: callLog,
        },
      });
      assert.equal(result.status, 1, `${scenario.name}: ${result.stderr}`);
      assert.match(result.stderr, scenario.expected, scenario.name);
      const calls = existsSync(callLog) ? readFileSync(callLog, "utf8") : "";
      assert.doesNotMatch(calls, /^(?:POST|PUT) /mu, scenario.name);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("independent activation rejects approved legacy inventory disappearance, subset, classic drift, and incomplete schema", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const repoSlug = "Joey-Tools/consumer";
  const v2RulesetName = "Must Pass Codex Review v2";
  const legacyA = activeLegacyRulesetFixture(7, { name: "Legacy A" });
  const legacyB = activeLegacyRulesetFixture(9, { name: "Legacy B" });
  const classicLegacy = {
    strict: true,
    contexts: [],
    checks: [{ context: LEGACY_STATUS_CONTEXT, app_id: 15368 }],
  };
  try {
    for (const scenario of [
      {
        name: "ruleset-disappeared",
        legacyRulesets: [legacyA],
        configure(migration) {
          return {
            [`GET repos/${repoSlug}/rules/branches/master?per_page=100`]: {
              __fake_sequence: [
                migration.effectiveRulePages,
                migration.effectiveRulePages,
                migration.effectiveRulePages,
                [[]],
              ],
            },
          };
        },
      },
      {
        name: "two-ruleset-baseline-lost-one",
        legacyRulesets: [legacyA, legacyB],
        configure(migration) {
          return {
            [`GET repos/${repoSlug}/rules/branches/master?per_page=100`]: {
              __fake_sequence: [
                migration.effectiveRulePages,
                migration.effectiveRulePages,
                migration.effectiveRulePages,
                [[migration.effectiveRulePages[0][0]]],
              ],
            },
          };
        },
      },
      {
        name: "classic-disappeared",
        classicRequiredStatusChecks: classicLegacy,
        configure(migration) {
          return classicDriftSequences({
            repoSlug,
            baseline: classicLegacy,
            drifted: null,
            parentBaseline: migration.parentProtection,
          });
        },
      },
      {
        name: "classic-app-id-drift",
        classicRequiredStatusChecks: classicLegacy,
        configure(migration) {
          const drifted = structuredClone(classicLegacy);
          drifted.checks[0].app_id = null;
          return classicDriftSequences({
            repoSlug,
            baseline: classicLegacy,
            drifted,
            parentBaseline: migration.parentProtection,
          });
        },
      },
      {
        name: "classic-strict-drift",
        classicRequiredStatusChecks: classicLegacy,
        configure(migration) {
          const drifted = { ...classicLegacy, strict: false };
          return classicDriftSequences({
            repoSlug,
            baseline: classicLegacy,
            drifted,
            parentBaseline: migration.parentProtection,
          });
        },
      },
      {
        name: "incomplete-full-ruleset-schema",
        legacyRulesets: [legacyA],
        schemaInconclusive: true,
        configure() {
          const incomplete = structuredClone(legacyA);
          delete incomplete.source;
          return {
            [`GET repos/${repoSlug}/rulesets/7`]: {
              __fake_sequence: [
                legacyA,
                legacyA,
                legacyA,
                legacyA,
                incomplete,
              ],
            },
          };
        },
      },
    ]) {
      const fakeBin = join(fixtureRoot, scenario.name);
      const stateDir = join(fixtureRoot, `${scenario.name}-state`);
      const stageLog = join(fixtureRoot, `${scenario.name}-stage.log`);
      const activationLog = join(
        fixtureRoot,
        `${scenario.name}-activation.log`,
      );
      createFakeGhExecutable(fakeBin);
      const migration = stageThenActivationResponseFixtures({
        repoSlug,
        legacyRulesets: scenario.legacyRulesets ?? [],
        classicRequiredStatusChecks:
          scenario.classicRequiredStatusChecks ??
          EMPTY_CLASSIC_REQUIRED_STATUS_CHECKS,
        v2RulesetName,
      });
      const responses = {
        ...migration.responses,
        ...scenario.configure(migration),
      };

      const stage = runBootstrap([
        "--repo",
        repoSlug,
        "--ruleset-name",
        v2RulesetName,
        "--apply",
      ], {
        env: fakeGhEnvironment({
          fakeBin,
          responses,
          stateDir,
          callLog: stageLog,
        }),
      });
      assert.equal(
        stage.status,
        0,
        `${scenario.name} stage: ${stage.stderr}`,
      );
      assert.match(stage.stdout, /Created ruleset/u, scenario.name);

      const activation = runBootstrap([
        ...activationArguments(repoSlug, CANARY_HEAD_SHA),
        "--ruleset-name",
        v2RulesetName,
      ], {
        env: fakeGhEnvironment({
          fakeBin,
          responses,
          stateDir,
          callLog: activationLog,
        }),
      });
      assert.equal(activation.status, 1, scenario.name);
      if (scenario.schemaInconclusive) {
        assert.match(activation.stderr, /unreadable or schema-inconclusive/u);
        assert.match(activation.stderr, /Full ruleset API readback is malformed/u);
      } else {
        assert.match(
          activation.stderr,
          /canonical legacy review-gate inventory digest mismatched.*initial approval-snapshot readback/iu,
          scenario.name,
        );
      }
      const activationCalls = readFileSync(activationLog, "utf8");
      assert.doesNotMatch(activationCalls, /^(?:POST|PUT) /mu, scenario.name);
      assert.doesNotMatch(activation.stdout, /Updated ruleset/u, scenario.name);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("post-cleanup verification admission remains read-only and rejects the old digest", () => {
  const repoSlug = "Joey-Tools/consumer";
  for (const [name, args, expected] of [
    [
      "mutually-exclusive-bridge-lifecycle",
      [
        "--prepare-worktree",
        "/tmp/consumer",
        "--legacy-bridge",
        "--remove-legacy-bridge",
      ],
      /mutually exclusive lifecycle phases/u,
    ],
    [
      "remote-bridge-removal",
      ["--repo", repoSlug, "--remove-legacy-bridge"],
      /local-only.*--prepare-worktree/u,
    ],
    [
      "without-repo",
      ["--verify-post-cleanup"],
      /Choose exactly one mode/u,
    ],
    [
      "prepare-worktree",
      ["--prepare-worktree", "/tmp/consumer", "--verify-post-cleanup"],
      /valid only with --repo/u,
    ],
    [
      "apply",
      ["--repo", repoSlug, "--verify-post-cleanup", "--apply"],
      /read-only/u,
    ],
    [
      "activate",
      [
        "--repo",
        repoSlug,
        "--verify-post-cleanup",
        "--activate",
        "--canary-pr",
        "7",
        "--canary-head",
        CANARY_HEAD_SHA,
      ],
      /read-only/u,
    ],
    [
      "canary-input",
      ["--repo", repoSlug, "--verify-post-cleanup", "--canary-pr", "7"],
      /read-only/u,
    ],
    [
      "old-digest",
      [
        "--repo",
        repoSlug,
        "--verify-post-cleanup",
        "--expected-legacy-inventory-sha256",
        "0".repeat(64),
      ],
      /read-only.*pre-cleanup legacy digest/u,
    ],
    [
      "missing-expected-post-state",
      ["--repo", repoSlug, "--verify-post-cleanup"],
      /requires --expected-post-cleanup-security-sha256/u,
    ],
    [
      "malformed-expected-post-state",
      [
        "--repo",
        repoSlug,
        "--verify-post-cleanup",
        "--expected-post-cleanup-security-sha256",
        "abc",
      ],
      /exact lowercase 64-hex SHA-256/u,
    ],
  ]) {
    const result = runBootstrap(args, {
      addExpectedLegacyInventoryDigest: false,
    });
    assert.equal(result.status, 1, name);
    assert.match(result.stderr, expected, name);
  }
});

test("post-cleanup verification accepts empty legacy surfaces and unrelated classic checks", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const fakeBin = join(fixtureRoot, "bin");
  const callLog = join(fixtureRoot, "calls.log");
  const repoSlug = "Joey-Tools/consumer";
  const classicRequiredStatusChecks = {
    strict: false,
    contexts: ["lint"],
    checks: [{ context: "build", app_id: 15368 }],
  };
  try {
    createFakeGhExecutable(fakeBin);
    const activeV2 = completeActiveRulesetFixture(7);
    const inventory = legacyInventoryResponseFixtures(repoSlug, {
      classicRequiredStatusChecks,
    });
    const responses = {
      ...canonicalRemoteWorkflowResponses(repoSlug),
      ...inventory.responses,
      [`repos/${repoSlug}/branches/master/protection`]: {
        required_status_checks: classicRequiredStatusChecks,
      },
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
        [activeV2],
      ],
      [`repos/${repoSlug}/rulesets/7`]: activeV2,
    };
    const derive = runBootstrap([
      "--repo",
      repoSlug,
      "--derive-post-cleanup-plan",
    ], {
      env: {
        ...process.env,
        PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
        FAKE_GH_RESPONSES: JSON.stringify(responses),
        FAKE_GH_CALL_LOG: callLog,
      },
    });
    assert.equal(derive.status, 0, derive.stderr);
    const plan = JSON.parse(derive.stdout);
    assert.match(plan.expected_post_cleanup_security_sha256, /^[0-9a-f]{64}$/u);
    const result = runBootstrap([
      "--repo",
      repoSlug,
      "--verify-post-cleanup",
      "--expected-post-cleanup-security-sha256",
      plan.expected_post_cleanup_security_sha256,
    ], {
      env: {
        ...process.env,
        PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
        FAKE_GH_RESPONSES: JSON.stringify(responses),
        FAKE_GH_CALL_LOG: callLog,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Post-cleanup verified/u);
    assert.doesNotMatch(readFileSync(callLog, "utf8"), /^(?:POST|PUT) /mu);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("legacy bridge profile remains exact through cleanup derivation and verification", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-bridge-cleanup-"));
  const fakeBin = join(fixtureRoot, "bin");
  const callLog = join(fixtureRoot, "calls.log");
  const repoSlug = "Joey-Tools/consumer";
  const classicRequiredStatusChecks = {
    strict: false,
    contexts: ["lint"],
    checks: [{ context: "build", app_id: 15368 }],
  };
  try {
    createFakeGhExecutable(fakeBin);
    const activeV2 = completeActiveRulesetFixture(7);
    const inventory = legacyInventoryResponseFixtures(repoSlug, {
      classicRequiredStatusChecks,
    });
    const responses = {
      ...canonicalRemoteWorkflowResponses(repoSlug, { legacyBridge: true }),
      ...inventory.responses,
      [`repos/${repoSlug}/branches/master/protection`]: {
        required_status_checks: classicRequiredStatusChecks,
      },
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
        [activeV2],
      ],
      [`repos/${repoSlug}/rulesets/7`]: activeV2,
    };
    const env = {
      ...process.env,
      PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
      FAKE_GH_RESPONSES: JSON.stringify(responses),
      FAKE_GH_CALL_LOG: callLog,
    };
    const derive = runBootstrap([
      "--repo",
      repoSlug,
      "--derive-post-cleanup-plan",
      "--legacy-bridge",
    ], { env });
    assert.equal(derive.status, 0, derive.stderr);
    const plan = JSON.parse(derive.stdout);
    const verify = runBootstrap([
      "--repo",
      repoSlug,
      "--verify-post-cleanup",
      "--expected-post-cleanup-security-sha256",
      plan.expected_post_cleanup_security_sha256,
      "--legacy-bridge",
    ], { env });
    assert.equal(verify.status, 0, verify.stderr);
    assert.match(verify.stdout, /Post-cleanup verified/u);
    assert.doesNotMatch(readFileSync(callLog, "utf8"), /^(?:POST|PUT) /mu);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("pre-cleanup derivation authorizes only legacy elision and preserves unrelated protections", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-cleanup-plan-"));
  const repoSlug = "Joey-Tools/consumer";
  const classicPre = {
    strict: true,
    contexts: ["lint", LEGACY_STATUS_CONTEXT],
    checks: [
      { context: "build", app_id: 15368 },
      { context: LEGACY_STATUS_CONTEXT, app_id: null },
    ],
  };
  const classicPost = {
    strict: true,
    contexts: ["lint"],
    checks: [{ context: "build", app_id: 15368 }],
  };
  try {
    const activeWithLegacy = completeActiveRulesetFixture(7);
    activeWithLegacy.rules
      .find((rule) => rule.type === "required_status_checks")
      .parameters.required_status_checks.push({
        context: LEGACY_STATUS_CONTEXT,
      });
    const activeWithoutLegacy = completeActiveRulesetFixture(7);
    const dedicatedLegacy = activeLegacyRulesetFixture(9);
    const unrelatedRuleset = {
      ...activeLegacyRulesetFixture(10, { name: "Preserve force-push policy" }),
      rules: [{ type: "non_fast_forward" }],
    };
    const effectivePre = [[
      effectiveLegacyRequiredStatusChecksRule(activeWithLegacy),
      effectiveLegacyRequiredStatusChecksRule(dedicatedLegacy),
    ]];
    const preInventory = legacyInventoryResponseFixtures(repoSlug, {
      effectiveRulePages: effectivePre,
      rulesets: [activeWithLegacy, dedicatedLegacy],
      classicRequiredStatusChecks: classicPre,
    });
    const preResponses = {
      ...canonicalRemoteWorkflowResponses(repoSlug),
      ...preInventory.responses,
      [`repos/${repoSlug}/branches/master/protection`]: {
        required_status_checks: classicPre,
        enforce_admins: { enabled: true, url: "https://api.github.com/ignored" },
      },
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [[
        activeWithLegacy,
        dedicatedLegacy,
        unrelatedRuleset,
      ]],
      [`repos/${repoSlug}/rulesets/7`]: activeWithLegacy,
      [`repos/${repoSlug}/rulesets/9`]: dedicatedLegacy,
      [`repos/${repoSlug}/rulesets/10`]: unrelatedRuleset,
    };
    const preBin = join(fixtureRoot, "pre-bin");
    const preLog = join(fixtureRoot, "pre.log");
    createFakeGhExecutable(preBin);
    const derive = runBootstrap([
      "--repo",
      repoSlug,
      "--derive-post-cleanup-plan",
    ], {
      env: {
        ...process.env,
        PATH: `${preBin}${delimiter}${process.env.PATH}`,
        FAKE_GH_RESPONSES: JSON.stringify(preResponses),
        FAKE_GH_CALL_LOG: preLog,
      },
    });
    assert.equal(derive.status, 0, derive.stderr);
    const plan = JSON.parse(derive.stdout);
    assert.equal(plan.cleanup_actions.classic_required_status_check_removed, true);
    assert.deepEqual(
      plan.cleanup_actions.rulesets.map(({ id, action }) => ({ id, action })),
      [
        { id: 7, action: "remove-legacy-check-only" },
        { id: 9, action: "delete-dedicated-legacy-only-ruleset" },
      ],
    );
    assert.doesNotMatch(readFileSync(preLog, "utf8"), /^(?:POST|PUT) /mu);

    const postInventory = legacyInventoryResponseFixtures(repoSlug, {
      classicRequiredStatusChecks: classicPost,
    });
    const basePostResponses = {
      ...canonicalRemoteWorkflowResponses(repoSlug),
      ...postInventory.responses,
      [`repos/${repoSlug}/branches/master/protection`]: {
        required_status_checks: classicPost,
        enforce_admins: { enabled: true, url: "https://api.github.com/ignored" },
      },
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [[
        activeWithoutLegacy,
        unrelatedRuleset,
      ]],
      [`repos/${repoSlug}/rulesets/7`]: activeWithoutLegacy,
      [`repos/${repoSlug}/rulesets/10`]: unrelatedRuleset,
    };
    for (const [name, mutate, expectedStatus] of [
      ["valid", () => {}, 0],
      [
        "unrelated-ruleset-deleted",
        (responses) => {
          responses[`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`] = [[
            activeWithoutLegacy,
          ]];
          delete responses[`repos/${repoSlug}/rulesets/10`];
        },
        1,
      ],
      [
        "classic-admin-policy-drift",
        (responses) => {
          responses[`repos/${repoSlug}/branches/master/protection`] = {
            required_status_checks: classicPost,
            enforce_admins: { enabled: false, url: "https://api.github.com/ignored" },
          };
        },
        1,
      ],
    ]) {
      const fakeBin = join(fixtureRoot, `${name}-bin`);
      const callLog = join(fixtureRoot, `${name}.log`);
      createFakeGhExecutable(fakeBin);
      const responses = structuredClone(basePostResponses);
      mutate(responses);
      const verify = runBootstrap([
        "--repo",
        repoSlug,
        "--verify-post-cleanup",
        "--expected-post-cleanup-security-sha256",
        plan.expected_post_cleanup_security_sha256,
      ], {
        env: {
          ...process.env,
          PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
          FAKE_GH_RESPONSES: JSON.stringify(responses),
          FAKE_GH_CALL_LOG: callLog,
        },
      });
      assert.equal(verify.status, expectedStatus, `${name}: ${verify.stderr}`);
      if (expectedStatus === 0) {
        assert.match(verify.stdout, /Post-cleanup verified/u, name);
      } else {
        assert.match(verify.stderr, /does not equal the pre-cleanup derived/u, name);
      }
      assert.doesNotMatch(readFileSync(callLog, "utf8"), /^(?:POST|PUT) /mu);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("source status-only cleanup derivation preserves every retained legacy protection", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-source-status-only-cleanup-"));
  const repoSlug = "Joey-Tools/codex-review-gate";
  const v2RulesetName = "Must Pass Codex Review v2";
  const absentClassicProtection = {
    __fake_http_error: 404,
    message: "Branch not protected",
  };
  try {
    const retainedLegacy = sourceLegacyRulesetFixture(7, repoSlug);
    const activeV2 = statusOnlyRulesetFixture(8, repoSlug, {
      name: v2RulesetName,
      enforcement: "active",
    });
    const effectivePre = [[
      effectiveLegacyRequiredStatusChecksRule(retainedLegacy),
    ]];
    const preInventory = legacyInventoryResponseFixtures(repoSlug, {
      effectiveRulePages: effectivePre,
      rulesets: [retainedLegacy],
      classicRequiredStatusChecks: null,
    });
    const preBin = join(fixtureRoot, "pre-bin");
    const preLog = join(fixtureRoot, "pre.log");
    createFakeGhExecutable(preBin);
    const derive = runBootstrap([
      "--repo",
      repoSlug,
      "--ruleset-name",
      v2RulesetName,
      "--ruleset-profile",
      RULESET_PROFILE_STATUS_ONLY,
      "--legacy-bridge",
      "--derive-post-cleanup-plan",
    ], {
      env: fakeGhEnvironment({
        fakeBin: preBin,
        responses: {
          ...canonicalRemoteWorkflowResponses(repoSlug, { legacyBridge: true }),
          ...preInventory.responses,
          [`repos/${repoSlug}/branches/master/protection`]: absentClassicProtection,
          [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
            [retainedLegacy, activeV2],
          ],
          [`repos/${repoSlug}/rulesets/7`]: retainedLegacy,
          [`repos/${repoSlug}/rulesets/8`]: activeV2,
        },
        stateDir: join(fixtureRoot, "pre-state"),
        callLog: preLog,
      }),
    });
    assert.equal(derive.status, 0, derive.stderr);
    const plan = JSON.parse(derive.stdout);
    assert.deepEqual(plan.cleanup_actions.rulesets, [{
      id: 7,
      name: retainedLegacy.name,
      action: "remove-legacy-check-only",
    }]);
    const retainedProjection = plan.expected_post_cleanup_security_state.rulesets
      .find((ruleset) => ruleset.id === retainedLegacy.id);
    assert.ok(retainedProjection, "the retained legacy ruleset must not be deleted");
    assert.deepEqual(
      retainedProjection.writable.rules.map((rule) => rule.type).sort(),
      ["deletion", "non_fast_forward", "pull_request"],
    );
    assert.doesNotMatch(readFileSync(preLog, "utf8"), /^(?:POST|PUT) /mu);

    const retainedPostCleanup = structuredClone(retainedLegacy);
    retainedPostCleanup.rules = retainedPostCleanup.rules.filter(
      (rule) => rule.type !== "required_status_checks",
    );
    const postInventory = legacyInventoryResponseFixtures(repoSlug, {
      classicRequiredStatusChecks: null,
    });
    const verifyBin = join(fixtureRoot, "verify-bin");
    const verifyLog = join(fixtureRoot, "verify.log");
    createFakeGhExecutable(verifyBin);
    const verify = runBootstrap([
      "--repo",
      repoSlug,
      "--ruleset-name",
      v2RulesetName,
      "--ruleset-profile",
      RULESET_PROFILE_STATUS_ONLY,
      "--legacy-bridge",
      "--verify-post-cleanup",
      "--expected-post-cleanup-security-sha256",
      plan.expected_post_cleanup_security_sha256,
    ], {
      env: fakeGhEnvironment({
        fakeBin: verifyBin,
        responses: {
          ...canonicalRemoteWorkflowResponses(repoSlug, { legacyBridge: true }),
          ...postInventory.responses,
          [`repos/${repoSlug}/branches/master/protection`]: absentClassicProtection,
          [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
            [retainedPostCleanup, activeV2],
          ],
          [`repos/${repoSlug}/rulesets/7`]: retainedPostCleanup,
          [`repos/${repoSlug}/rulesets/8`]: activeV2,
        },
        stateDir: join(fixtureRoot, "verify-state"),
        callLog: verifyLog,
      }),
    });
    assert.equal(verify.status, 0, verify.stderr);
    assert.match(verify.stdout, /status-only Active v2 policy/u);
    assert.doesNotMatch(readFileSync(verifyLog, "utf8"), /^(?:POST|PUT) /mu);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("derives a stable fixed-policy source proof without an explicit ruleset-name override", () => {
  const fixtureRoot = mkdtempSync(
    join(tmpdir(), "codex-review-gate-source-closure-proof-"),
  );
  const fakeBin = join(fixtureRoot, "bin");
  const stateDir = join(fixtureRoot, "state");
  const callLog = join(fixtureRoot, "calls.log");
  const preloadPath = join(fixtureRoot, "fast-source-closure.cjs");
  try {
    createFakeGhExecutable(fakeBin);
    writeFileSync(preloadPath, sourceClosureTimingPreloadSource(), "utf8");
    const { responses } = sourceBridgeRemovalFixtureResponses();
    const result = runBootstrap(sourceBridgeRemovalArguments({
      includeRulesetName: false,
    }), {
      addExpectedLegacyInventoryDigest: false,
      env: {
        ...fakeGhEnvironment({ fakeBin, responses, stateDir, callLog }),
        NODE_OPTIONS: `--require=${preloadPath}`,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    const admitted = validateSourceBridgeRemovalProofOutput(output);
    assert.equal(
      admitted.source_bridge_removal_receipt.canary.base_ancestry.status,
      "ahead",
      "#74's historical base is proven an ancestor rather than required to equal today's default head",
    );
    assert.equal(
      admitted.source_bridge_removal_receipt.v2_ruleset.name,
      SOURCE_SELF_HOSTING_RULESET_NAME,
      "source proof modes must replace the ordinary consumer default with their fixed source v2 policy",
    );
    assert.equal(
      admitted.source_bridge_removal_receipt.canary.run.workflow_path,
      DEFAULT_WORKFLOW_PATH,
      "the durable run binding uses the bare canonical workflow path, not an action ref",
    );
    assert.equal(
      admitted.source_bridge_removal_receipt.canary.run.id,
      CANARY_RUN_ID,
    );
    const calls = readFileSync(callLog, "utf8");
    assert.match(calls, /^POST graphql$/mu);
    assert.match(
      calls,
      new RegExp(
        `^GET repos/${SOURCE_SELF_HOSTING_REPOSITORY_SLUG}/compare/${HISTORICAL_SOURCE_CANARY_BASE_SHA}\\.\\.\\.${DEFAULT_BRANCH_SHA}$`,
        "mu",
      ),
    );
    assert.doesNotMatch(
      calls,
      new RegExp(
        `^GET repos/${SOURCE_SELF_HOSTING_REPOSITORY_SLUG}/commits/(?:${CANARY_HEAD_SHA}|${CANARY_MERGE_SHA})/statuses`,
        "mu",
      ),
      "closed historical canaries may retain v1 statuses; only current required-status policy is closure evidence",
    );
    assert.doesNotMatch(
      calls,
      /^(?:PUT|PATCH|DELETE) /mu,
      "the only POST is the read-only GraphQL historical-PR query",
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("source proof modes reject migration-policy ruleset and owner overrides before remote reads", () => {
  for (const [name, argumentsToTest] of [
    [
      "ruleset-name",
      sourceBridgeRemovalArguments({
        v2RulesetName: "replacement source v2 ruleset",
      }),
    ],
    [
      "control-plane-owner",
      [
        ...sourceBridgeRemovalArguments(),
        "--control-plane-owner",
        "@DifferentOwner",
      ],
    ],
  ]) {
    const result = runBootstrap(argumentsToTest, {
      addExpectedLegacyInventoryDigest: false,
    });
    assert.equal(result.status, 1, `${name}: ${result.stderr}`);
    assert.match(
      result.stderr,
      /fixed to ruleset "Must Pass Codex Review v2" and control-plane owner @JoeyTeng/u,
      name,
    );
    assert.equal(result.stdout, "", `${name}: no source proof may be emitted`);
  }
});

test("source proof treats GraphQL potentialMergeCommit as durable while cross-checking present REST merge SHAs", () => {
  const fixtureRoot = mkdtempSync(
    join(tmpdir(), "codex-review-gate-source-rest-test-merge-"),
  );
  const preloadPath = join(fixtureRoot, "fast-source-closure.cjs");
  try {
    writeFileSync(preloadPath, sourceClosureTimingPreloadSource(), "utf8");
    for (const [name, restMergeSha, expectedStatus] of [
      ["rest-null", null, 0],
      ["rest-different", "d".repeat(40), 1],
    ]) {
      const fakeBin = join(fixtureRoot, `${name}-bin`);
      const callLog = join(fixtureRoot, `${name}.log`);
      createFakeGhExecutable(fakeBin);
      const fixture = sourceBridgeRemovalFixtureResponses({
        pullRequestOverrides: { merge_commit_sha: restMergeSha },
      });
      const result = runBootstrap(sourceBridgeRemovalArguments(), {
        addExpectedLegacyInventoryDigest: false,
        env: {
          ...fakeGhEnvironment({
            fakeBin,
            responses: fixture.responses,
            stateDir: join(fixtureRoot, `${name}-state`),
            callLog,
          }),
          NODE_OPTIONS: `--require=${preloadPath}`,
        },
      });
      assert.equal(result.status, expectedStatus, `${name}: ${result.stderr}`);
      if (expectedStatus === 0) {
        assert.equal(
          JSON.parse(result.stdout).source_bridge_removal_receipt.canary
            .test_merge_sha,
          CANARY_MERGE_SHA,
          "a null REST field must not displace the durable GraphQL test merge",
        );
      } else {
        assert.match(result.stderr, /GraphQL tuple disagrees/u, name);
        assert.equal(result.stdout, "", `${name}: no proof may be emitted`);
      }
      assert.doesNotMatch(
        readFileSync(callLog, "utf8"),
        /^(?:PUT|PATCH|DELETE) /mu,
        name,
      );
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("source proof rebind rejects a receipt after proof-machinery advances the default branch", () => {
  const fixtureRoot = mkdtempSync(
    join(tmpdir(), "codex-review-gate-source-proof-rebind-"),
  );
  const preloadPath = join(fixtureRoot, "fast-source-closure.cjs");
  const v2RulesetName = SOURCE_SELF_HOSTING_RULESET_NAME;
  const commonArguments = [
    "--repo",
    SOURCE_SELF_HOSTING_REPOSITORY_SLUG,
    "--ruleset-name",
    v2RulesetName,
    "--ruleset-profile",
    RULESET_PROFILE_STATUS_ONLY,
    "--legacy-bridge",
  ];
  try {
    writeFileSync(preloadPath, sourceClosureTimingPreloadSource(), "utf8");
    const deriveBin = join(fixtureRoot, "derive-bin");
    createFakeGhExecutable(deriveBin);
    const deriveLog = join(fixtureRoot, "derive.log");
    const deriveFixture = sourceBridgeRemovalFixtureResponses({ v2RulesetName });
    const derive = runBootstrap(sourceBridgeRemovalArguments({ v2RulesetName }), {
      addExpectedLegacyInventoryDigest: false,
      env: {
        ...fakeGhEnvironment({
          fakeBin: deriveBin,
          responses: deriveFixture.responses,
          stateDir: join(fixtureRoot, "derive-state"),
          callLog: deriveLog,
        }),
        NODE_OPTIONS: `--require=${preloadPath}`,
      },
    });
    assert.equal(derive.status, 0, derive.stderr);
    const approvedPath = join(fixtureRoot, "approved-source-proof.json");
    writeFileSync(approvedPath, derive.stdout, "utf8");
    const approved = JSON.parse(derive.stdout);
    const approvedSha256 = approved.source_bridge_removal_receipt_sha256;

    const rebindBin = join(fixtureRoot, "rebind-bin");
    const rebindLog = join(fixtureRoot, "rebind.log");
    createFakeGhExecutable(rebindBin);
    const rebindFixture = sourceBridgeRemovalFixtureResponses({
      v2RulesetName,
      currentDefaultBranchHeadSha: "c".repeat(40),
    });
    const rebind = runBootstrap([
      ...commonArguments,
      "--rebind-source-bridge-removal-proof",
      approvedPath,
      "--expected-source-bridge-removal-proof-sha256",
      approvedSha256,
    ], {
      addExpectedLegacyInventoryDigest: false,
      env: {
        ...fakeGhEnvironment({
          fakeBin: rebindBin,
          responses: rebindFixture.responses,
          stateDir: join(fixtureRoot, "rebind-state"),
          callLog: rebindLog,
        }),
        NODE_OPTIONS: `--require=${preloadPath}`,
      },
    });
    assert.equal(rebind.status, 1, rebind.stderr);
    assert.match(
      rebind.stderr,
      /no longer equals a fresh two-round live source closure|derive, review, and explicitly approve a new receipt/u,
    );
    assert.doesNotMatch(
      readFileSync(rebindLog, "utf8"),
      /^(?:PUT|PATCH|DELETE) /mu,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("source proof rejects closed-canary tuple, CheckRun, run, job, and ancestry binding drift", () => {
  const fixtureRoot = mkdtempSync(
    join(tmpdir(), "codex-review-gate-source-historical-binding-"),
  );
  const preloadPath = join(fixtureRoot, "fast-source-closure.cjs");
  try {
    writeFileSync(preloadPath, sourceClosureTimingPreloadSource(), "utf8");
    for (const [name, mutate, expected] of [
      [
        "not-closed-unmerged",
        ({ responses }) => {
          responses[`repos/${SOURCE_SELF_HOSTING_REPOSITORY_SLUG}/pulls/74`].state = "open";
        },
        /closed, unmerged, non-draft/u,
      ],
      [
        "graphql-test-merge-disagrees",
        ({ responses }) => {
          responses["POST graphql"].data.repository.pullRequest.potentialMergeCommit = {
            oid: "d".repeat(40),
          };
        },
        /GraphQL tuple disagrees/u,
      ],
      [
        "test-merge-parent-order",
        ({ responses }) => {
          responses[
            `repos/${SOURCE_SELF_HOSTING_REPOSITORY_SLUG}/git/commits/${CANARY_MERGE_SHA}`
          ].parents.reverse();
        },
        /test-merge.*ordered base\/head parents/u,
      ],
      [
        "historical-base-no-longer-ancestor",
        ({ responses }) => {
          responses[
            `repos/${SOURCE_SELF_HOSTING_REPOSITORY_SLUG}/compare/${HISTORICAL_SOURCE_CANARY_BASE_SHA}...${DEFAULT_BRANCH_SHA}`
          ] = {
            base_commit: { sha: HISTORICAL_SOURCE_CANARY_BASE_SHA },
            merge_base_commit: { sha: "d".repeat(40) },
            status: "behind",
            ahead_by: 0,
          };
        },
        /not a proven ancestor/u,
      ],
      [
        "check-run-not-native-v2",
        ({ responses }) => {
          responses[
            `repos/${SOURCE_SELF_HOSTING_REPOSITORY_SLUG}/commits/${CANARY_HEAD_SHA}/check-runs?check_name=codex%2Fgithub-review-gate&filter=latest&per_page=100`
          ][0].check_runs[0].app.slug = "untrusted-actions";
        },
        /not a successful native GitHub Actions CheckRun/u,
      ],
      [
        "run-path-is-an-action-ref",
        ({ responses }) => {
          responses[
            `repos/${SOURCE_SELF_HOSTING_REPOSITORY_SLUG}/actions/runs/${CANARY_RUN_ID}`
          ].path = `${DEFAULT_WORKFLOW_PATH}@v2`;
        },
        /exact successful canonical/u,
      ],
      [
        "job-check-run-reverse-link",
        ({ responses }) => {
          responses[
            `repos/${SOURCE_SELF_HOSTING_REPOSITORY_SLUG}/actions/runs/${CANARY_RUN_ID}/attempts/1/jobs?per_page=100`
          ][0].jobs[0].check_run_url =
            `https://api.github.com/repos/${SOURCE_SELF_HOSTING_REPOSITORY_SLUG}/check-runs/${CANARY_CHECK_RUN_ID + 1}`;
        },
        /does not resolve to the unique CheckRun/u,
      ],
    ]) {
      const fakeBin = join(fixtureRoot, `${name}-bin`);
      const callLog = join(fixtureRoot, `${name}.log`);
      createFakeGhExecutable(fakeBin);
      const fixture = sourceBridgeRemovalFixtureResponses();
      mutate(fixture);
      const result = runBootstrap(sourceBridgeRemovalArguments(), {
        addExpectedLegacyInventoryDigest: false,
        env: {
          ...fakeGhEnvironment({
            fakeBin,
            responses: fixture.responses,
            stateDir: join(fixtureRoot, `${name}-state`),
            callLog,
          }),
          NODE_OPTIONS: `--require=${preloadPath}`,
        },
      });
      assert.equal(result.status, 1, `${name}: ${result.stderr}`);
      assert.match(result.stderr, expected, name);
      assert.equal(existsSync(callLog), true, name);
      assert.doesNotMatch(
        readFileSync(callLog, "utf8"),
        /^(?:PUT|PATCH|DELETE) /mu,
        name,
      );
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("source proof fails closed for hidden ruleset bypasses and case-insensitive legacy status requirements", () => {
  const fixtureRoot = mkdtempSync(
    join(tmpdir(), "codex-review-gate-source-closure-policy-"),
  );
  const preloadPath = join(fixtureRoot, "fast-source-closure.cjs");
  const sourceRepo = SOURCE_SELF_HOSTING_REPOSITORY_SLUG;
  try {
    writeFileSync(preloadPath, sourceClosureTimingPreloadSource(), "utf8");
    assert.equal(isLegacyStatusContext("CODEX/REVIEW-GATE"), true);
    assert.equal(isLegacyStatusContext("codex/github-review-gate"), false);
    for (const [name, mutate, expected] of [
      [
        "redacted-bypass-actors",
        ({ responses, selectedV2 }) => {
          selectedV2.bypass_actors = null;
          responses[`repos/${sourceRepo}/rulesets/${selectedV2.id}`] = selectedV2;
          responses[
            `repos/${sourceRepo}/rulesets?includes_parents=true&per_page=100`
          ][0][0] = selectedV2;
        },
        /bypass_actors|complete ruleset API object/u,
      ],
      [
        "uppercase-classic-legacy-context",
        ({ responses }) => {
          const classic = {
            strict: true,
            contexts: ["CODEX/REVIEW-GATE"],
            checks: [],
          };
          responses[
            `repos/${sourceRepo}/branches/master/protection/required_status_checks`
          ] = classic;
          responses[`repos/${sourceRepo}/branches/master/protection`] = {
            required_status_checks: classic,
          };
        },
        /codex\/review-gate remains required after cleanup|legacy status context/u,
      ],
      [
        "retained-policy-missing-deletion",
        ({ retainedSourceRuleset }) => {
          retainedSourceRuleset.rules = retainedSourceRuleset.rules.filter(
            (rule) => rule.type !== "deletion",
          );
        },
        /retained ruleset.*exact non-status protection policy/u,
      ],
      [
        "retained-policy-non-fast-forward-parameters",
        ({ retainedSourceRuleset }) => {
          retainedSourceRuleset.rules.find(
            (rule) => rule.type === "non_fast_forward",
          ).parameters = {};
        },
        /retained ruleset.*exact non-status protection policy/u,
      ],
      [
        "retained-policy-thread-resolution-disabled",
        ({ retainedSourceRuleset }) => {
          retainedSourceRuleset.rules.find(
            (rule) => rule.type === "pull_request",
          ).parameters.required_review_thread_resolution = false;
        },
        /retained ruleset.*exact non-status protection policy/u,
      ],
      [
        "retained-policy-bypass-actor",
        ({ retainedSourceRuleset }) => {
          retainedSourceRuleset.bypass_actors = [{
            actor_id: 1,
            actor_type: "RepositoryRole",
            bypass_mode: "always",
          }];
        },
        /retained ruleset.*exact non-status protection policy/u,
      ],
      [
        "retained-policy-name-drift",
        ({ retainedSourceRuleset }) => {
          retainedSourceRuleset.name = "replacement retained policy";
        },
        /retained ruleset.*exact source repository branch identity/u,
      ],
      [
        "retained-policy-id-drift",
        ({ responses, retainedSourceRuleset }) => {
          const originalId = retainedSourceRuleset.id;
          retainedSourceRuleset.id = originalId + 1;
          delete responses[`repos/${sourceRepo}/rulesets/${originalId}`];
          responses[`repos/${sourceRepo}/rulesets/${retainedSourceRuleset.id}`] =
            retainedSourceRuleset;
        },
        /requires exactly one retained ruleset id/u,
      ],
      [
        "retained-policy-conditions-drift",
        ({ retainedSourceRuleset }) => {
          retainedSourceRuleset.conditions.ref_name.exclude = ["master"];
        },
        /retained ruleset.*exact non-status protection policy/u,
      ],
    ]) {
      const fakeBin = join(fixtureRoot, `${name}-bin`);
      const callLog = join(fixtureRoot, `${name}.log`);
      createFakeGhExecutable(fakeBin);
      const fixture = sourceBridgeRemovalFixtureResponses();
      mutate(fixture);
      const result = runBootstrap(sourceBridgeRemovalArguments(), {
        addExpectedLegacyInventoryDigest: false,
        env: {
          ...fakeGhEnvironment({
            fakeBin,
            responses: fixture.responses,
            stateDir: join(fixtureRoot, `${name}-state`),
            callLog,
          }),
          NODE_OPTIONS: `--require=${preloadPath}`,
        },
      });
      assert.equal(result.status, 1, `${name}: ${result.stderr}`);
      assert.match(result.stderr, expected, name);
      assert.equal(existsSync(callLog), true, name);
      assert.doesNotMatch(
        readFileSync(callLog, "utf8"),
        /^(?:PUT|PATCH|DELETE) /mu,
        name,
      );
      assert.equal(result.stdout, "", `${name}: no proof may be emitted`);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("source proof keeps pending when complete source snapshots do not stabilize", () => {
  const fixtureRoot = mkdtempSync(
    join(tmpdir(), "codex-review-gate-source-closure-instability-"),
  );
  const fakeBin = join(fixtureRoot, "bin");
  const stateDir = join(fixtureRoot, "state");
  const callLog = join(fixtureRoot, "calls.log");
  const preloadPath = join(fixtureRoot, "unstable-source-closure.cjs");
  try {
    createFakeGhExecutable(fakeBin);
    writeFileSync(preloadPath, sourceClosureTimingPreloadSource(), "utf8");
    const { responses } = sourceBridgeRemovalFixtureResponses();
    const permissionEndpoint =
      `repos/${SOURCE_SELF_HOSTING_REPOSITORY_SLUG}/collaborators/JoeyTeng/permission`;
    responses[permissionEndpoint] = {
      __fake_sequence: [
        controlPlaneOwnerPermissionFixture({ permission: "write" }),
        controlPlaneOwnerPermissionFixture({ permission: "maintain" }),
      ],
    };
    const result = runBootstrap(sourceBridgeRemovalArguments(), {
      addExpectedLegacyInventoryDigest: false,
      env: {
        ...fakeGhEnvironment({ fakeBin, responses, stateDir, callLog }),
        CODEX_SOURCE_CLOSURE_TEST_CLOCK: "unstable",
        NODE_OPTIONS: `--require=${preloadPath}`,
      },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /closure remained unstable.*Fail closed: no receipt was emitted/u,
    );
    assert.equal(result.stdout, "");
    assert.doesNotMatch(
      readFileSync(callLog, "utf8"),
      /^(?:PUT|PATCH|DELETE) /mu,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("source proof fails closed when its second complete read reaches the stability deadline", () => {
  const fixtureRoot = mkdtempSync(
    join(tmpdir(), "codex-review-gate-source-closure-second-read-deadline-"),
  );
  const fakeBin = join(fixtureRoot, "bin");
  const stateDir = join(fixtureRoot, "state");
  const callLog = join(fixtureRoot, "calls.log");
  const preloadPath = join(fixtureRoot, "second-read-deadline-source-closure.cjs");
  try {
    createFakeGhExecutable(fakeBin);
    writeFileSync(preloadPath, sourceClosureTimingPreloadSource(), "utf8");
    const { responses } = sourceBridgeRemovalFixtureResponses();
    const result = runBootstrap(sourceBridgeRemovalArguments(), {
      addExpectedLegacyInventoryDigest: false,
      env: {
        ...fakeGhEnvironment({ fakeBin, responses, stateDir, callLog }),
        CODEX_SOURCE_CLOSURE_TEST_CLOCK: "second-read-over-deadline",
        NODE_OPTIONS: `--require=${preloadPath}`,
      },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(
      result.stderr,
      /exceeded the 60-second stability budget after its second complete read.*Fail closed: no receipt was emitted/u,
    );
    assert.equal(result.stdout, "");
    assert.doesNotMatch(
      readFileSync(callLog, "utf8"),
      /^(?:PUT|PATCH|DELETE) /mu,
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("source bridge deletion CLI admits only its isolated local authority", () => {
  const nonWorktree = join(tmpdir(), "codex-review-gate-no-source-worktree");
  const placeholderProof = join(tmpdir(), "codex-review-gate-unread-proof.json");
  const approvedSha256 = "a".repeat(64);
  const base = [
    "--prepare-worktree",
    nonWorktree,
    "--remove-source-legacy-bridge",
    "--source-bridge-removal-proof",
    placeholderProof,
    "--expected-source-bridge-removal-proof-sha256",
    approvedSha256,
  ];
  for (const [name, args, expected] of [
    [
      "missing-approved-proof",
      ["--prepare-worktree", nonWorktree, "--remove-source-legacy-bridge"],
      /requires --source-bridge-removal-proof/u,
    ],
    [
      "remote-mode",
      [
        "--repo",
        SOURCE_SELF_HOSTING_REPOSITORY_SLUG,
        "--remove-source-legacy-bridge",
        "--source-bridge-removal-proof",
        placeholderProof,
        "--expected-source-bridge-removal-proof-sha256",
        approvedSha256,
      ],
      /local source-only operation and requires --prepare-worktree/u,
    ],
    [
      "retained-bridge-phase",
      [...base, "--legacy-bridge"],
      /mutually exclusive lifecycle phases/u,
    ],
    [
      "organization-receipt-phase",
      [...base, "--remove-legacy-bridge"],
      /different authorization domains and are mutually exclusive/u,
    ],
    [
      "canary-input",
      [...base, "--canary-pr", "74"],
      /separate local source-only operation/u,
    ],
    [
      "ruleset-override",
      [...base, "--ruleset-name", "Unexpected source ruleset"],
      /do not admit migration-policy overrides/u,
    ],
    [
      "bad-approved-sha",
      [
        ...base.slice(0, -1),
        "not-a-sha",
      ],
      /must be an exact lowercase 64-hex SHA-256/u,
    ],
    [
      "orphan-source-proof",
      [
        "--prepare-worktree",
        nonWorktree,
        "--source-bridge-removal-proof",
        placeholderProof,
      ],
      /valid only with --remove-source-legacy-bridge/u,
    ],
  ]) {
    const result = runBootstrap(args, { addExpectedLegacyInventoryDigest: false });
    assert.equal(result.status, 1, `${name}: ${result.stderr}`);
    assert.match(result.stderr, expected, name);
    assert.equal(result.stdout, "", `${name}: admission rejects before a dry run`);
  }
});

test("source and organization bridge-deletion receipt paths reject each other's repository authority", () => {
  const sourceOriginTarget = mkdtempSync(
    join(tmpdir(), "codex-review-gate-source-origin-boundary-"),
  );
  const organizationSourceTarget = mkdtempSync(
    join(tmpdir(), "codex-review-gate-org-source-boundary-"),
  );
  try {
    initializeGitRepository(sourceOriginTarget);
    runGit([
      "-C",
      sourceOriginTarget,
      "remote",
      "add",
      "origin",
      "https://github.com/Joey-Tools/ordinary-consumer.git",
    ]);
    const sourceProofArgs = prepareSourceBridgeRemovalProof(sourceOriginTarget);
    const sourcePathResult = runBootstrap([
      "--prepare-worktree",
      sourceOriginTarget,
      "--remove-source-legacy-bridge",
      ...sourceProofArgs,
    ]);
    assert.equal(sourcePathResult.status, 1, sourcePathResult.stderr);
    assert.match(sourcePathResult.stderr, /restricted to Git origin/u);
    assert.doesNotMatch(sourcePathResult.stdout, /Dry run|Applied/u);

    initializeGitRepository(organizationSourceTarget);
    const bridgePath = join(
      organizationSourceTarget,
      ...DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH.split("/"),
    );
    mkdirSync(join(organizationSourceTarget, ".github", "workflows"), {
      recursive: true,
    });
    writeFileSync(bridgePath, CANONICAL_LEGACY_BRIDGE_WORKFLOW, "utf8");
    const organizationArgs = prepareFinalClosureReceipt(organizationSourceTarget, {
      repoSlug: SOURCE_SELF_HOSTING_REPOSITORY_SLUG,
    });
    const organizationPathResult = runBootstrap([
      "--prepare-worktree",
      organizationSourceTarget,
      "--remove-legacy-bridge",
      ...organizationArgs,
      "--apply",
    ]);
    assert.equal(organizationPathResult.status, 1, organizationPathResult.stderr);
    assert.match(
      organizationPathResult.stderr,
      /source self-hosting repository.*cannot use the organization --remove-legacy-bridge receipt path/u,
    );
    assert.equal(
      readFileSync(bridgePath, "utf8"),
      CANONICAL_LEGACY_BRIDGE_WORKFLOW,
      "the generic organization path must reject before changing the source bridge",
    );
  } finally {
    rmSync(sourceOriginTarget, { recursive: true, force: true });
    rmSync(organizationSourceTarget, { recursive: true, force: true });
  }
});

test("source bridge deletion restores the canonical bridge when source closure drifts after quarantine", () => {
  const fixtureRoot = mkdtempSync(
    join(tmpdir(), "codex-review-gate-source-delete-drift-"),
  );
  const targetRoot = join(fixtureRoot, "source-worktree");
  const timingPreloadPath = join(fixtureRoot, "fast-source-closure.cjs");
  const driftPreloadPath = join(fixtureRoot, "post-rename-source-drift.cjs");
  const bridgePath = join(
    targetRoot,
    ...DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH.split("/"),
  );
  try {
    initializeGitRepository(targetRoot);
    runGit(["-C", targetRoot, "symbolic-ref", "HEAD", "refs/heads/master"]);
    runGit(["-C", targetRoot, "config", "user.name", "Codex Test"]);
    runGit(["-C", targetRoot, "config", "user.email", "codex-test@example.invalid"]);
    mkdirSync(join(targetRoot, ".github", "workflows"), { recursive: true });
    writeFileSync(
      join(targetRoot, ...DEFAULT_WORKFLOW_PATH.split("/")),
      CANONICAL_WORKFLOW,
      "utf8",
    );
    writeFileSync(
      join(targetRoot, ...DEFAULT_CONTROLLER_WORKFLOW_PATH.split("/")),
      CANONICAL_CONTROLLER_WORKFLOW,
      "utf8",
    );
    writeFileSync(bridgePath, CANONICAL_LEGACY_BRIDGE_WORKFLOW, "utf8");
    writeFileSync(
      join(targetRoot, ".github", "CODEOWNERS"),
      ensureControlPlaneCodeownersContent(null).content,
      "utf8",
    );
    runGit(["-C", targetRoot, "add", ".github"]);
    runGit(["-C", targetRoot, "commit", "-qm", "source bridge fixture"]);
    const sourceHead = runGit(["-C", targetRoot, "rev-parse", "HEAD"]).trim();
    runGit([
      "-C",
      targetRoot,
      "remote",
      "add",
      "origin",
      `https://github.com/${SOURCE_SELF_HOSTING_REPOSITORY_SLUG}.git`,
    ]);
    writeFileSync(timingPreloadPath, sourceClosureTimingPreloadSource(), "utf8");
    writeFileSync(
      driftPreloadPath,
      sourceBridgeRemovalPostRenameRemoteDriftPreloadSource(),
      "utf8",
    );

    const deriveBin = join(fixtureRoot, "derive-bin");
    const deriveLog = join(fixtureRoot, "derive.log");
    createFakeGhExecutable(deriveBin);
    const deriveFixture = sourceBridgeRemovalFixtureResponses({
      currentDefaultBranchHeadSha: sourceHead,
    });
    const derive = runBootstrap(sourceBridgeRemovalArguments(), {
      addExpectedLegacyInventoryDigest: false,
      env: {
        ...fakeGhEnvironment({
          fakeBin: deriveBin,
          responses: deriveFixture.responses,
          stateDir: join(fixtureRoot, "derive-state"),
          callLog: deriveLog,
        }),
        NODE_OPTIONS: `--require=${timingPreloadPath}`,
      },
    });
    assert.equal(derive.status, 0, derive.stderr);
    const proofPath = join(fixtureRoot, "approved-source-proof.json");
    writeFileSync(proofPath, derive.stdout, "utf8");
    const approvedSha256 = JSON.parse(
      derive.stdout,
    ).source_bridge_removal_receipt_sha256;

    const applyBin = join(fixtureRoot, "apply-bin");
    const applyLog = join(fixtureRoot, "apply.log");
    createFakeGhExecutable(applyBin);
    const applyFixture = sourceBridgeRemovalFixtureResponses({
      currentDefaultBranchHeadSha: sourceHead,
    });
    const apply = runBootstrap([
      "--prepare-worktree",
      targetRoot,
      "--remove-source-legacy-bridge",
      "--source-bridge-removal-proof",
      proofPath,
      "--expected-source-bridge-removal-proof-sha256",
      approvedSha256,
      "--apply",
    ], {
      env: {
        ...fakeGhEnvironment({
          fakeBin: applyBin,
          responses: applyFixture.responses,
          stateDir: join(fixtureRoot, "apply-state"),
          callLog: applyLog,
        }),
        CODEX_SOURCE_CLOSURE_TEST_RACE_ROOT: targetRoot,
        NODE_OPTIONS: `--require=${timingPreloadPath} --require=${driftPreloadPath}`,
      },
    });
    assert.equal(apply.status, 1, apply.stderr);
    assert.match(
      apply.stderr,
      /no longer equals a fresh complete two-round source closure.*after source legacy bridge quarantine rename and before unlink/u,
    );
    assert.match(
      apply.stderr,
      /admitted exact bridge remains installed.*atomically restored/u,
    );
    assert.equal(
      readFileSync(bridgePath, "utf8"),
      CANONICAL_LEGACY_BRIDGE_WORKFLOW,
      "a source security drift after quarantine must restore the admitted bridge",
    );
    assert.equal(
      runGit(["-C", targetRoot, "status", "--porcelain"]),
      "",
      "restoration must leave no staged or unstaged bridge deletion",
    );
    assert.doesNotMatch(apply.stdout, /Applied: removed only/u);
    assert.doesNotMatch(
      readFileSync(applyLog, "utf8"),
      /^(?:PUT|PATCH|DELETE) /mu,
      "source deletion rebind is read-only against GitHub",
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("source bridge deletion keeps remote rebinds inside the restorable pre-unlink boundary", () => {
  for (const {
    phase,
    expectsRestoration,
    expectsSuccess,
    expectedWorktreeStatus,
  } of [
    {
      phase: "before-quarantine-rename",
      expectsRestoration: false,
      expectsSuccess: false,
      expectedWorktreeStatus: " M README.md\n",
    },
    {
      phase: "after-quarantine-rename-tracked-before-unlink",
      expectsRestoration: true,
      expectsSuccess: false,
      expectedWorktreeStatus: " M README.md\n",
    },
    {
      phase: "after-quarantine-rename-staged-before-unlink",
      expectsRestoration: true,
      expectsSuccess: false,
      expectedWorktreeStatus: "M  README.md\n",
    },
    {
      phase: "after-quarantine-rename-untracked-before-unlink",
      expectsRestoration: true,
      expectsSuccess: false,
      expectedWorktreeStatus: "?? unrelated-source-bridge-race.txt\n",
    },
    {
      phase: "post-unlink-remote-rebind",
      expectsRestoration: false,
      expectsSuccess: true,
    },
  ]) {
    const fixtureRoot = mkdtempSync(
      join(tmpdir(), `codex-review-gate-source-delete-worktree-diff-${phase}-`),
    );
    const targetRoot = join(fixtureRoot, "source-worktree");
    const timingPreloadPath = join(fixtureRoot, "fast-source-closure.cjs");
    const diffPreloadPath = join(fixtureRoot, "source-worktree-diff-race.cjs");
    const postUnlinkMarkerPath = join(fixtureRoot, "post-unlink-marker");
    const bridgePath = join(
      targetRoot,
      ...DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH.split("/"),
    );
    try {
      initializeGitRepository(targetRoot);
      runGit(["-C", targetRoot, "symbolic-ref", "HEAD", "refs/heads/master"]);
      runGit(["-C", targetRoot, "config", "user.name", "Codex Test"]);
      runGit([
        "-C",
        targetRoot,
        "config",
        "user.email",
        "codex-test@example.invalid",
      ]);
      mkdirSync(join(targetRoot, ".github", "workflows"), { recursive: true });
      writeFileSync(
        join(targetRoot, ...DEFAULT_WORKFLOW_PATH.split("/")),
        CANONICAL_WORKFLOW,
        "utf8",
      );
      writeFileSync(
        join(targetRoot, ...DEFAULT_CONTROLLER_WORKFLOW_PATH.split("/")),
        CANONICAL_CONTROLLER_WORKFLOW,
        "utf8",
      );
      writeFileSync(bridgePath, CANONICAL_LEGACY_BRIDGE_WORKFLOW, "utf8");
      writeFileSync(
        join(targetRoot, ".github", "CODEOWNERS"),
        ensureControlPlaneCodeownersContent(null).content,
        "utf8",
      );
      writeFileSync(join(targetRoot, "README.md"), "fixture base\n", "utf8");
      runGit(["-C", targetRoot, "add", ".github", "README.md"]);
      runGit(["-C", targetRoot, "commit", "-qm", "source bridge fixture"]);
      const sourceHead = runGit(["-C", targetRoot, "rev-parse", "HEAD"]).trim();
      const admittedBridge = lstatSync(bridgePath, { bigint: true });
      runGit([
        "-C",
        targetRoot,
        "remote",
        "add",
        "origin",
        `https://github.com/${SOURCE_SELF_HOSTING_REPOSITORY_SLUG}.git`,
      ]);
      writeFileSync(timingPreloadPath, sourceClosureTimingPreloadSource(), "utf8");
      writeFileSync(
        diffPreloadPath,
        sourceBridgeRemovalWorktreeDiffRacePreloadSource(),
        "utf8",
      );

      const deriveBin = join(fixtureRoot, "derive-bin");
      createFakeGhExecutable(deriveBin);
      const deriveFixture = sourceBridgeRemovalFixtureResponses({
        currentDefaultBranchHeadSha: sourceHead,
      });
      const derive = runBootstrap(sourceBridgeRemovalArguments({
        includeRulesetName: false,
      }), {
        addExpectedLegacyInventoryDigest: false,
        env: {
          ...fakeGhEnvironment({
            fakeBin: deriveBin,
            responses: deriveFixture.responses,
            stateDir: join(fixtureRoot, "derive-state"),
            callLog: join(fixtureRoot, "derive.log"),
          }),
          NODE_OPTIONS: `--require=${timingPreloadPath}`,
        },
      });
      assert.equal(derive.status, 0, `${phase}: ${derive.stderr}`);
      const proofPath = join(fixtureRoot, "approved-source-proof.json");
      writeFileSync(proofPath, derive.stdout, "utf8");
      const approvedSha256 = JSON.parse(
        derive.stdout,
      ).source_bridge_removal_receipt_sha256;

      const applyBin = join(fixtureRoot, "apply-bin");
      const applyLog = join(fixtureRoot, "apply.log");
      createFakeGhExecutable(applyBin);
      const applyFixture = sourceBridgeRemovalFixtureResponses({
        currentDefaultBranchHeadSha: sourceHead,
      });
      const apply = runBootstrap([
        "--prepare-worktree",
        targetRoot,
        "--remove-source-legacy-bridge",
        "--source-bridge-removal-proof",
        proofPath,
        "--expected-source-bridge-removal-proof-sha256",
        approvedSha256,
        "--apply",
      ], {
        env: {
          ...fakeGhEnvironment({
            fakeBin: applyBin,
            responses: applyFixture.responses,
            stateDir: join(fixtureRoot, "apply-state"),
            callLog: applyLog,
          }),
          CODEX_SOURCE_CLOSURE_TEST_RACE_ROOT: targetRoot,
          CODEX_SOURCE_CLOSURE_TEST_WORKTREE_DIFF_RACE_PHASE: phase,
          CODEX_SOURCE_CLOSURE_TEST_POST_UNLINK_MARKER: postUnlinkMarkerPath,
          ...(expectsSuccess
            ? {
                FAKE_GH_POST_UNLINK_MARKER: postUnlinkMarkerPath,
                FAKE_GH_POST_UNLINK_MUTATION_TARGET: join(targetRoot, "README.md"),
              }
            : {}),
          NODE_OPTIONS: `--require=${timingPreloadPath} --require=${diffPreloadPath}`,
        },
      });
      if (expectsSuccess) {
        assert.equal(apply.status, 0, `${phase}: ${apply.stderr}`);
        assert.equal(existsSync(postUnlinkMarkerPath), true, phase);
        assert.equal(existsSync(bridgePath), false, phase);
        assert.equal(
          readFileSync(join(targetRoot, "README.md"), "utf8"),
          "fixture base\n",
          phase,
        );
        assert.equal(
          runGit(["-C", targetRoot, "status", "--porcelain"]),
          ` D ${DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH}\n`,
          phase,
        );
        assert.match(apply.stdout, /Applied: removed only/u, phase);
        assert.doesNotMatch(
          readFileSync(applyLog, "utf8"),
          /^(?:PUT|PATCH|DELETE) /mu,
          phase,
        );
        continue;
      }
      assert.equal(apply.status, 1, `${phase}: ${apply.stderr}`);
      assert.match(
        apply.stderr,
        /Source bridge removal requires a clean worktree/u,
        phase,
      );
      if (expectsRestoration) {
        assert.match(
          apply.stderr,
          /admitted exact bridge remains installed.*atomically restored/u,
          phase,
        );
      }
      assert.equal(
        readFileSync(bridgePath, "utf8"),
        CANONICAL_LEGACY_BRIDGE_WORKFLOW,
        phase,
      );
      const restoredBridge = lstatSync(bridgePath, { bigint: true });
      assert.equal(restoredBridge.dev, admittedBridge.dev, phase);
      assert.equal(restoredBridge.ino, admittedBridge.ino, phase);
      assert.equal(
        runGit(["-C", targetRoot, "status", "--porcelain"]),
        expectedWorktreeStatus,
        phase,
      );
      assert.doesNotMatch(apply.stdout, /Applied: removed only/u, phase);
      assert.doesNotMatch(
        readFileSync(applyLog, "utf8"),
        /^(?:PUT|PATCH|DELETE) /mu,
        phase,
      );
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }
});

test("source bridge deletion rejects a substituted valid linked-worktree marker before quarantine rename", () => {
  const fixtureRoot = mkdtempSync(
    join(tmpdir(), "codex-review-gate-source-linked-marker-replacement-"),
  );
  const repositoryRoot = join(fixtureRoot, "repository");
  const targetRoot = join(fixtureRoot, "source-worktree");
  const timingPreloadPath = join(fixtureRoot, "fast-source-closure.cjs");
  const replacementPreloadPath = join(
    fixtureRoot,
    "replace-linked-marker-before-quarantine.cjs",
  );
  const replacementAdminPath = join(fixtureRoot, "replacement-admin");
  const replacementMarkerPath = join(fixtureRoot, "replacement-marker");
  const displacedMarkerPath = join(fixtureRoot, "displaced-marker");
  const bridgePath = join(
    targetRoot,
    ...DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH.split("/"),
  );
  const repositoryBridgePath = join(
    repositoryRoot,
    ...DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH.split("/"),
  );
  try {
    initializeGitRepository(repositoryRoot);
    runGit(["-C", repositoryRoot, "config", "user.name", "Codex Test"]);
    runGit([
      "-C",
      repositoryRoot,
      "config",
      "user.email",
      "codex-test@example.invalid",
    ]);
    mkdirSync(join(repositoryRoot, ".github", "workflows"), {
      recursive: true,
    });
    writeFileSync(
      join(repositoryRoot, ...DEFAULT_WORKFLOW_PATH.split("/")),
      CANONICAL_WORKFLOW,
      "utf8",
    );
    writeFileSync(
      join(repositoryRoot, ...DEFAULT_CONTROLLER_WORKFLOW_PATH.split("/")),
      CANONICAL_CONTROLLER_WORKFLOW,
      "utf8",
    );
    writeFileSync(
      repositoryBridgePath,
      CANONICAL_LEGACY_BRIDGE_WORKFLOW,
      "utf8",
    );
    writeFileSync(
      join(repositoryRoot, ".github", "CODEOWNERS"),
      ensureControlPlaneCodeownersContent(null).content,
      "utf8",
    );
    runGit(["-C", repositoryRoot, "add", ".github"]);
    runGit(["-C", repositoryRoot, "commit", "-qm", "source bridge fixture"]);
    runGit(["-C", repositoryRoot, "checkout", "-qb", "parking"]);
    runGit([
      "-C",
      repositoryRoot,
      "worktree",
      "add",
      "--quiet",
      targetRoot,
      "master",
    ]);
    runGit([
      "-C",
      targetRoot,
      "remote",
      "add",
      "origin",
      `https://github.com/${SOURCE_SELF_HOSTING_REPOSITORY_SLUG}.git`,
    ]);
    const sourceHead = runGit(["-C", targetRoot, "rev-parse", "HEAD"]).trim();
    const markerPath = join(targetRoot, ".git");
    const originalMarkerContent = readFileSync(markerPath, "utf8");
    const markerMatch = originalMarkerContent.match(/^gitdir: ([^\r\n]+)\r?\n?$/u);
    assert.ok(
      markerMatch,
      "the fixture must create a normal linked-worktree marker",
    );
    const originalAdminPath = resolve(targetRoot, markerMatch[1]);
    const commonDirectory = runGit([
      "-C",
      targetRoot,
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]).trim();
    cpSync(originalAdminPath, replacementAdminPath, { recursive: true });
    // The copied linked-worktree administration remains genuinely usable: it
    // points at the same common object/config store and back to this marker.
    writeFileSync(
      join(replacementAdminPath, "commondir"),
      `${commonDirectory}\n`,
      "utf8",
    );
    writeFileSync(
      join(replacementAdminPath, "gitdir"),
      `${markerPath}\n`,
      "utf8",
    );
    writeFileSync(
      replacementMarkerPath,
      `gitdir: ${replacementAdminPath}\n`,
      "utf8",
    );

    // Prove the alternate marker/admin state is a valid linked worktree with
    // the same origin, default branch, and HEAD before using it as the race.
    renameSync(markerPath, displacedMarkerPath);
    renameSync(replacementMarkerPath, markerPath);
    assert.equal(runGit(["-C", targetRoot, "status", "--porcelain"]), "");
    assert.equal(
      runGit(["-C", targetRoot, "remote", "get-url", "origin"]).trim(),
      `https://github.com/${SOURCE_SELF_HOSTING_REPOSITORY_SLUG}.git`,
    );
    assert.equal(
      runGit(["-C", targetRoot, "branch", "--show-current"]).trim(),
      "master",
    );
    assert.equal(
      runGit(["-C", targetRoot, "rev-parse", "HEAD"]).trim(),
      sourceHead,
    );
    renameSync(markerPath, replacementMarkerPath);
    renameSync(displacedMarkerPath, markerPath);

    writeFileSync(timingPreloadPath, sourceClosureTimingPreloadSource(), "utf8");
    writeFileSync(
      replacementPreloadPath,
      sourceBridgeRemovalLinkedMarkerReplacementPreloadSource(),
      "utf8",
    );
    const deriveBin = join(fixtureRoot, "derive-bin");
    createFakeGhExecutable(deriveBin);
    const deriveFixture = sourceBridgeRemovalFixtureResponses({
      currentDefaultBranchHeadSha: sourceHead,
    });
    const derive = runBootstrap(sourceBridgeRemovalArguments({
      includeRulesetName: false,
    }), {
      addExpectedLegacyInventoryDigest: false,
      env: {
        ...fakeGhEnvironment({
          fakeBin: deriveBin,
          responses: deriveFixture.responses,
          stateDir: join(fixtureRoot, "derive-state"),
          callLog: join(fixtureRoot, "derive.log"),
        }),
        NODE_OPTIONS: `--require=${timingPreloadPath}`,
      },
    });
    assert.equal(derive.status, 0, derive.stderr);
    const proofPath = join(fixtureRoot, "approved-source-proof.json");
    writeFileSync(proofPath, derive.stdout, "utf8");
    const approvedSha256 = JSON.parse(
      derive.stdout,
    ).source_bridge_removal_receipt_sha256;

    const applyBin = join(fixtureRoot, "apply-bin");
    const applyLog = join(fixtureRoot, "apply.log");
    createFakeGhExecutable(applyBin);
    const applyFixture = sourceBridgeRemovalFixtureResponses({
      currentDefaultBranchHeadSha: sourceHead,
    });
    const apply = runBootstrap([
      "--prepare-worktree",
      targetRoot,
      "--remove-source-legacy-bridge",
      "--source-bridge-removal-proof",
      proofPath,
      "--expected-source-bridge-removal-proof-sha256",
      approvedSha256,
      "--apply",
    ], {
      env: {
        ...fakeGhEnvironment({
          fakeBin: applyBin,
          responses: applyFixture.responses,
          stateDir: join(fixtureRoot, "apply-state"),
          callLog: applyLog,
        }),
        CODEX_SOURCE_CLOSURE_TEST_RACE_ROOT: targetRoot,
        CODEX_SOURCE_CLOSURE_TEST_REPLACEMENT_MARKER: replacementMarkerPath,
        CODEX_SOURCE_CLOSURE_TEST_DISPLACED_MARKER: displacedMarkerPath,
        NODE_OPTIONS: `--require=${timingPreloadPath} --require=${replacementPreloadPath}`,
      },
    });
    assert.equal(apply.status, 1, apply.stderr);
    assert.match(
      apply.stderr,
      /Git worktree marker object identity changed during immediately before source legacy bridge quarantine rename/u,
    );
    assert.equal(
      readFileSync(bridgePath, "utf8"),
      CANONICAL_LEGACY_BRIDGE_WORKFLOW,
      "the valid substituted administrative marker must be rejected before bridge rename or unlink",
    );
    assert.equal(
      runGit(["-C", targetRoot, "status", "--porcelain"]),
      "",
      "the pre-rename rejection must retain the tracked bridge without an unstaged deletion",
    );
    assert.doesNotMatch(apply.stdout, /Applied: removed only/u);
    assert.doesNotMatch(
      readFileSync(applyLog, "utf8"),
      /^(?:PUT|PATCH|DELETE) /mu,
      "source deletion rebind remains read-only against GitHub",
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("general bootstrap help omits the source-only cleanup executor", () => {
  const help = runBootstrap(["--help"], {
    addExpectedLegacyInventoryDigest: false,
  });
  assert.equal(help.status, 0, help.stderr);
  assert.doesNotMatch(help.stdout, /--apply-post-cleanup-plan/u);
  assert.doesNotMatch(help.stdout, /--expected-post-cleanup-plan-sha256/u);
  assert.match(help.stdout, /not a consumer-installation capability/u);
});

test("source-local cleanup executor binds the approved raw plan and performs one guarded legacy-ruleset PUT", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-source-cleanup-executor-"));
  const repoSlug = "Joey-Tools/codex-review-gate";
  const v2RulesetName = "Must Pass Codex Review v2";
  const absentClassicProtection = {
    __fake_http_error: 404,
    message: "Branch not protected",
  };
  try {
    const retainedLegacy = sourceLegacyRulesetFixture(7, repoSlug);
    const retainedPostCleanup = structuredClone(retainedLegacy);
    retainedPostCleanup.rules = retainedPostCleanup.rules.filter(
      (rule) => rule.type !== "required_status_checks",
    );
    const activeV2 = statusOnlyRulesetFixture(8, repoSlug, {
      name: v2RulesetName,
      enforcement: "active",
    });
    const effectivePre = [[
      effectiveLegacyRequiredStatusChecksRule(retainedLegacy),
    ]];
    const preInventory = legacyInventoryResponseFixtures(repoSlug, {
      effectiveRulePages: effectivePre,
      rulesets: [retainedLegacy],
      classicRequiredStatusChecks: null,
    });
    const sourceArguments = [
      "--repo",
      repoSlug,
      "--ruleset-name",
      v2RulesetName,
      "--ruleset-profile",
      RULESET_PROFILE_STATUS_ONLY,
      "--legacy-bridge",
    ];
    const preResponses = {
      ...canonicalRemoteWorkflowResponses(repoSlug, { legacyBridge: true }),
      ...preInventory.responses,
      [`repos/${repoSlug}/branches/master/protection`]: absentClassicProtection,
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [[
        retainedLegacy,
        activeV2,
      ]],
      [`repos/${repoSlug}/rulesets/7`]: retainedLegacy,
      [`repos/${repoSlug}/rulesets/8`]: activeV2,
    };
    const planBin = join(fixtureRoot, "plan-bin");
    createFakeGhExecutable(planBin);
    const planResult = runBootstrap([
      ...sourceArguments,
      "--derive-post-cleanup-plan",
    ], {
      env: fakeGhEnvironment({
        fakeBin: planBin,
        responses: preResponses,
        stateDir: join(fixtureRoot, "plan-state"),
        callLog: join(fixtureRoot, "plan.log"),
      }),
    });
    assert.equal(planResult.status, 0, planResult.stderr);
    const planPath = join(fixtureRoot, "approved-plan.json");
    writeFileSync(planPath, planResult.stdout, "utf8");
    const planSha256 = createHash("sha256")
      .update(planResult.stdout, "utf8")
      .digest("hex");
    const plan = JSON.parse(planResult.stdout);
    assert.equal(
      plan.legacy_inventory_sha256,
      preInventory.approval.sha256,
      "the approved plan binds the exact owner-approved legacy inventory",
    );
    const expectedPutPayload = plan.expected_post_cleanup_security_state.rulesets
      .find((ruleset) => ruleset.id === retainedLegacy.id).writable;
    const applyPlanArguments = [
      ...sourceArguments,
      "--apply-post-cleanup-plan",
      planPath,
      "--expected-post-cleanup-plan-sha256",
      planSha256,
    ];

    const symlinkPlanPath = join(fixtureRoot, "approved-plan-link.json");
    symlinkSync(planPath, symlinkPlanPath);
    const symlinkBin = join(fixtureRoot, "symlink-bin");
    const symlinkLog = join(fixtureRoot, "symlink.log");
    createFakeGhExecutable(symlinkBin);
    const symlinkPlan = runBootstrap([
      ...sourceArguments,
      "--apply-post-cleanup-plan",
      symlinkPlanPath,
      "--expected-post-cleanup-plan-sha256",
      planSha256,
    ], {
      env: fakeGhEnvironment({
        fakeBin: symlinkBin,
        responses: preResponses,
        stateDir: join(fixtureRoot, "symlink-state"),
        callLog: symlinkLog,
      }),
    });
    assert.equal(symlinkPlan.status, 1, symlinkPlan.stderr);
    assert.match(symlinkPlan.stderr, /Unable to open approved post-cleanup plan/u);
    assert.equal(existsSync(symlinkLog), false);

    const previewBin = join(fixtureRoot, "preview-bin");
    const previewLog = join(fixtureRoot, "preview.log");
    createFakeGhExecutable(previewBin);
    const preview = runBootstrap(applyPlanArguments, {
      env: fakeGhEnvironment({
        fakeBin: previewBin,
        responses: preResponses,
        stateDir: join(fixtureRoot, "preview-state"),
        callLog: previewLog,
      }),
    });
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /Dry run:.*no remote write/u);
    assert.doesNotMatch(readFileSync(previewLog, "utf8"), /^(?:POST|PUT) /mu);

    const alteredPlanPath = join(fixtureRoot, "altered-plan.json");
    writeFileSync(alteredPlanPath, `${planResult.stdout} `, "utf8");
    const alteredBin = join(fixtureRoot, "altered-bin");
    const alteredLog = join(fixtureRoot, "altered.log");
    createFakeGhExecutable(alteredBin);
    const altered = runBootstrap([
      ...sourceArguments,
      "--apply-post-cleanup-plan",
      alteredPlanPath,
      "--expected-post-cleanup-plan-sha256",
      planSha256,
    ], {
      env: fakeGhEnvironment({
        fakeBin: alteredBin,
        responses: preResponses,
        stateDir: join(fixtureRoot, "altered-state"),
        callLog: alteredLog,
      }),
    });
    assert.equal(altered.status, 1, altered.stderr);
    assert.match(altered.stderr, /plan SHA-256 mismatched/u);
    assert.equal(existsSync(alteredLog), false);

    const nonCanonicalPlanPath = join(fixtureRoot, "non-canonical-plan.json");
    const nonCanonicalPlan = `${planResult.stdout} `;
    writeFileSync(nonCanonicalPlanPath, nonCanonicalPlan, "utf8");
    const nonCanonicalPlanSha256 = createHash("sha256")
      .update(nonCanonicalPlan, "utf8")
      .digest("hex");
    const nonCanonicalBin = join(fixtureRoot, "non-canonical-bin");
    const nonCanonicalLog = join(fixtureRoot, "non-canonical.log");
    createFakeGhExecutable(nonCanonicalBin);
    const nonCanonical = runBootstrap([
      ...sourceArguments,
      "--apply-post-cleanup-plan",
      nonCanonicalPlanPath,
      "--expected-post-cleanup-plan-sha256",
      nonCanonicalPlanSha256,
    ], {
      env: fakeGhEnvironment({
        fakeBin: nonCanonicalBin,
        responses: preResponses,
        stateDir: join(fixtureRoot, "non-canonical-state"),
        callLog: nonCanonicalLog,
      }),
    });
    assert.equal(nonCanonical.status, 1, nonCanonical.stderr);
    assert.match(nonCanonical.stderr, /not the unmodified canonical raw output/u);
    assert.equal(existsSync(nonCanonicalLog), false);

    const replacedInventoryBin = join(fixtureRoot, "replaced-inventory-bin");
    const replacedInventoryLog = join(fixtureRoot, "replaced-inventory.log");
    createFakeGhExecutable(replacedInventoryBin);
    const replacedInventory = runBootstrap([
      ...applyPlanArguments,
      "--expected-legacy-inventory-sha256",
      "0".repeat(64),
    ], {
      env: fakeGhEnvironment({
        fakeBin: replacedInventoryBin,
        responses: preResponses,
        stateDir: join(fixtureRoot, "replaced-inventory-state"),
        callLog: replacedInventoryLog,
      }),
    });
    assert.equal(replacedInventory.status, 1, replacedInventory.stderr);
    assert.match(
      replacedInventory.stderr,
      /same owner-approved legacy inventory SHA-256/u,
    );
    assert.equal(existsSync(replacedInventoryLog), false);

    const oversizedPlanPath = join(fixtureRoot, "oversized-plan.json");
    writeFileSync(oversizedPlanPath, Buffer.alloc(1_048_577, 0x20));
    const oversizedBin = join(fixtureRoot, "oversized-bin");
    const oversizedLog = join(fixtureRoot, "oversized.log");
    createFakeGhExecutable(oversizedBin);
    const oversized = runBootstrap([
      ...sourceArguments,
      "--apply-post-cleanup-plan",
      oversizedPlanPath,
      "--expected-post-cleanup-plan-sha256",
      planSha256,
    ], {
      env: fakeGhEnvironment({
        fakeBin: oversizedBin,
        responses: preResponses,
        stateDir: join(fixtureRoot, "oversized-state"),
        callLog: oversizedLog,
      }),
    });
    assert.equal(oversized.status, 1, oversized.stderr);
    assert.match(oversized.stderr, /admission limit/u);
    assert.equal(existsSync(oversizedLog), false);

    const driftedLegacy = structuredClone(retainedLegacy);
    driftedLegacy.conditions.ref_name.include.push("refs/heads/release");
    const driftBin = join(fixtureRoot, "drift-bin");
    const driftLog = join(fixtureRoot, "drift.log");
    createFakeGhExecutable(driftBin);
    const drift = runBootstrap([
      ...applyPlanArguments,
      "--apply",
    ], {
      env: fakeGhEnvironment({
        fakeBin: driftBin,
        responses: {
          ...preResponses,
          [`GET repos/${repoSlug}/rulesets/7`]: {
            __fake_sequence: [
              retainedLegacy,
              retainedLegacy,
              retainedLegacy,
              retainedLegacy,
              retainedLegacy,
              retainedLegacy,
              retainedLegacy,
              retainedLegacy,
              driftedLegacy,
            ],
          },
        },
        stateDir: join(fixtureRoot, "drift-state"),
        callLog: driftLog,
      }),
    });
    assert.equal(drift.status, 1, drift.stderr);
    assert.match(drift.stderr, /changed after the final complete pre-write closure/u);
    assert.doesNotMatch(readFileSync(driftLog, "utf8"), /^PUT /mu);

    const disabledV2 = structuredClone(activeV2);
    disabledV2.enforcement = "disabled";
    const v2DriftBin = join(fixtureRoot, "v2-drift-bin");
    const v2DriftLog = join(fixtureRoot, "v2-drift.log");
    createFakeGhExecutable(v2DriftBin);
    const v2Drift = runBootstrap([
      ...applyPlanArguments,
      "--apply",
    ], {
      env: fakeGhEnvironment({
        fakeBin: v2DriftBin,
        responses: {
          ...preResponses,
          [`GET repos/${repoSlug}/rulesets/8`]: {
            __fake_sequence: [
              activeV2,
              activeV2,
              activeV2,
              activeV2,
              disabledV2,
            ],
          },
        },
        stateDir: join(fixtureRoot, "v2-drift-state"),
        callLog: v2DriftLog,
      }),
    });
    assert.equal(v2Drift.status, 1, v2Drift.stderr);
    assert.match(
      v2Drift.stderr,
      /Selected v2 ruleset 8 changed after the final complete pre-write closure/u,
    );
    assert.doesNotMatch(readFileSync(v2DriftLog, "utf8"), /^PUT /mu);

    const applyBin = join(fixtureRoot, "apply-bin");
    const applyLog = join(fixtureRoot, "apply.log");
    const applyBodyLog = join(fixtureRoot, "apply-body.log");
    createFakeGhExecutable(applyBin);
    const apply = runBootstrap([
      ...applyPlanArguments,
      "--apply",
    ], {
      env: {
        ...fakeGhEnvironment({
          fakeBin: applyBin,
          responses: {
            ...preResponses,
            [`GET repos/${repoSlug}/rules/branches/master?per_page=100`]: {
              __fake_sequence: [
                effectivePre,
                effectivePre,
                effectivePre,
                effectivePre,
                [[]],
                [[]],
              ],
            },
            [`GET repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: {
              __fake_sequence: [
                [[retainedLegacy, activeV2]],
                [[retainedLegacy, activeV2]],
                [[retainedLegacy, activeV2]],
                [[retainedLegacy, activeV2]],
                [[retainedPostCleanup, activeV2]],
                [[retainedPostCleanup, activeV2]],
              ],
            },
            [`GET repos/${repoSlug}/rulesets/7`]: {
              __fake_sequence: [
                retainedLegacy,
                retainedLegacy,
                retainedLegacy,
                retainedLegacy,
                retainedLegacy,
                retainedLegacy,
                retainedLegacy,
                retainedLegacy,
                retainedLegacy,
                retainedPostCleanup,
                retainedPostCleanup,
                retainedPostCleanup,
              ],
            },
            [`GET repos/${repoSlug}/rulesets/8`]: activeV2,
            [`PUT repos/${repoSlug}/rulesets/7`]: { id: retainedLegacy.id },
          },
          stateDir: join(fixtureRoot, "apply-state"),
          callLog: applyLog,
        }),
        FAKE_GH_BODY_LOG: applyBodyLog,
      },
    });
    assert.equal(apply.status, 0, apply.stderr);
    assert.match(apply.stdout, /Applied the approved source-local cleanup plan/u);
    assert.equal(
      countLines(
        readFileSync(applyLog, "utf8"),
        `PUT repos/${repoSlug}/rulesets/7`,
      ),
      1,
    );
    const applyCalls = readFileSync(applyLog, "utf8").trim().split("\n");
    const applyPutIndex = applyCalls.indexOf(`PUT repos/${repoSlug}/rulesets/7`);
    assert.ok(applyPutIndex >= 2, "the guarded legacy PUT was recorded");
    assert.equal(
      applyCalls[applyPutIndex - 2],
      `GET repos/${repoSlug}/rulesets/8`,
      "the selected v2 ruleset is checked immediately before the mutable target",
    );
    assert.equal(
      applyCalls[applyPutIndex - 1],
      `GET repos/${repoSlug}/rulesets/7`,
      "the mutable legacy target is checked last before its PUT",
    );
    const [putBody] = readFileSync(applyBodyLog, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(putBody.requestKey, `PUT repos/${repoSlug}/rulesets/7`);
    assert.deepEqual(JSON.parse(putBody.requestBody), expectedPutPayload);

    const errorBin = join(fixtureRoot, "error-bin");
    const errorLog = join(fixtureRoot, "error.log");
    createFakeGhExecutable(errorBin);
    const mutationError = runBootstrap([
      ...applyPlanArguments,
      "--apply",
    ], {
      env: fakeGhEnvironment({
        fakeBin: errorBin,
        responses: {
          ...preResponses,
          [`PUT repos/${repoSlug}/rulesets/7`]: {
            __fake_http_error: 500,
            message: "Ruleset service unavailable. The plan-bound source cleanup PUT may already have completed.",
          },
        },
        stateDir: join(fixtureRoot, "error-state"),
        callLog: errorLog,
      }),
    });
    assert.equal(mutationError.status, 1, mutationError.stderr);
    assert.match(
      mutationError.stderr,
      /The plan-bound source cleanup PUT may already have completed/u,
    );
    assert.match(
      mutationError.stderr,
      /First run the exact read-only closure/u,
    );
    assert.match(
      mutationError.stderr,
      /node '\/.*\/scripts\/bootstrap-codex-review-gate\.mjs' --repo /u,
      "the recovery command names the exact executable source checkout path",
    );
    assert.match(
      mutationError.stderr,
      /--control-plane-owner '@[^']+' --ruleset-name 'Must Pass Codex Review v2' --ruleset-profile 'status-only' --legacy-bridge --verify-post-cleanup/u,
    );
    assert.equal(
      countLines(
        readFileSync(errorLog, "utf8"),
        `PUT repos/${repoSlug}/rulesets/7`,
      ),
      1,
    );

    const readbackErrorBin = join(fixtureRoot, "readback-error-bin");
    const readbackErrorLog = join(fixtureRoot, "readback-error.log");
    createFakeGhExecutable(readbackErrorBin);
    const readbackError = runBootstrap([
      ...applyPlanArguments,
      "--apply",
    ], {
      env: fakeGhEnvironment({
        fakeBin: readbackErrorBin,
        responses: {
          ...preResponses,
          [`GET repos/${repoSlug}/rulesets/7`]: {
            __fake_sequence: [
              retainedLegacy,
              retainedLegacy,
              retainedLegacy,
              retainedLegacy,
              retainedLegacy,
              retainedLegacy,
              retainedLegacy,
              retainedLegacy,
              retainedLegacy,
              {
                __fake_http_error: 500,
                message: "Readback unavailable after mutation",
              },
            ],
          },
          [`PUT repos/${repoSlug}/rulesets/7`]: { id: retainedLegacy.id },
        },
        stateDir: join(fixtureRoot, "readback-error-state"),
        callLog: readbackErrorLog,
      }),
    });
    assert.equal(readbackError.status, 1, readbackError.stderr);
    assert.match(readbackError.stderr, /Readback unavailable after mutation/u);
    assert.match(
      readbackError.stderr,
      /The plan-bound source cleanup PUT may already have completed/u,
    );
    assert.match(
      readbackError.stderr,
      /First run the exact read-only closure/u,
    );
    assert.equal(
      countLines(
        readFileSync(readbackErrorLog, "utf8"),
        `PUT repos/${repoSlug}/rulesets/7`,
      ),
      1,
      "a readback failure must not cause an automatic mutation replay",
    );

    const mismatchedReadback = structuredClone(retainedPostCleanup);
    mismatchedReadback.conditions.ref_name.include.push("refs/heads/release");
    const mismatchedReadbackBin = join(fixtureRoot, "mismatched-readback-bin");
    const mismatchedReadbackLog = join(fixtureRoot, "mismatched-readback.log");
    createFakeGhExecutable(mismatchedReadbackBin);
    const mismatchedReadbackResult = runBootstrap([
      ...applyPlanArguments,
      "--apply",
    ], {
      env: fakeGhEnvironment({
        fakeBin: mismatchedReadbackBin,
        responses: {
          ...preResponses,
          [`GET repos/${repoSlug}/rulesets/7`]: {
            __fake_sequence: [
              retainedLegacy,
              retainedLegacy,
              retainedLegacy,
              retainedLegacy,
              retainedLegacy,
              retainedLegacy,
              retainedLegacy,
              retainedLegacy,
              retainedLegacy,
              mismatchedReadback,
            ],
          },
          [`PUT repos/${repoSlug}/rulesets/7`]: { id: retainedLegacy.id },
        },
        stateDir: join(fixtureRoot, "mismatched-readback-state"),
        callLog: mismatchedReadbackLog,
      }),
    });
    assert.equal(
      mismatchedReadbackResult.status,
      1,
      mismatchedReadbackResult.stderr,
    );
    assert.match(
      mismatchedReadbackResult.stderr,
      /does not equal the approved post-cleanup writable projection/u,
    );
    assert.match(
      mismatchedReadbackResult.stderr,
      /The plan-bound source cleanup PUT may already have completed/u,
    );
    assert.equal(
      countLines(
        readFileSync(mismatchedReadbackLog, "utf8"),
        `PUT repos/${repoSlug}/rulesets/7`,
      ),
      1,
      "a successful but mismatched readback must not cause an automatic mutation replay",
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("post-cleanup verification rejects legacy residuals and a non-active selected v2 gate", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const repoSlug = "Joey-Tools/consumer";
  try {
    for (const scenario of [
      {
        name: "ruleset-residual",
        legacyRulesets: [activeLegacyRulesetFixture(9)],
        selectedV2: completeActiveRulesetFixture(7),
        expected: /codex\/review-gate remains required after cleanup/u,
      },
      {
        name: "classic-residual",
        classicRequiredStatusChecks: {
          strict: true,
          contexts: [LEGACY_STATUS_CONTEXT],
          checks: [],
        },
        selectedV2: completeActiveRulesetFixture(7),
        expected: /codex\/review-gate remains required after cleanup/u,
      },
      {
        name: "disabled-v2",
        selectedV2: completeDisabledRulesetFixture(7),
        expected: /remain the complete Active v2 policy/u,
      },
    ]) {
      const fakeBin = join(fixtureRoot, scenario.name);
      const callLog = join(fixtureRoot, `${scenario.name}.log`);
      createFakeGhExecutable(fakeBin);
      const legacyRulesets = scenario.legacyRulesets ?? [];
      const classicRequiredStatusChecks =
        scenario.classicRequiredStatusChecks ??
        EMPTY_CLASSIC_REQUIRED_STATUS_CHECKS;
      const effectiveRulePages = [[
        ...legacyRulesets.map(effectiveLegacyRequiredStatusChecksRule),
      ]];
      const inventory = legacyInventoryResponseFixtures(repoSlug, {
        effectiveRulePages,
        rulesets: legacyRulesets,
        classicRequiredStatusChecks,
      });
      const responses = {
        ...canonicalRemoteWorkflowResponses(repoSlug),
        ...inventory.responses,
        [`repos/${repoSlug}/branches/master/protection`]: {
          required_status_checks: classicRequiredStatusChecks,
        },
        [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [[
          ...legacyRulesets,
          scenario.selectedV2,
        ]],
        [`repos/${repoSlug}/rulesets/7`]: scenario.selectedV2,
      };
      const result = runBootstrap([
        "--repo",
        repoSlug,
        "--verify-post-cleanup",
        "--expected-post-cleanup-security-sha256",
        "0".repeat(64),
      ], {
        env: {
          ...process.env,
          PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
          FAKE_GH_RESPONSES: JSON.stringify(responses),
          FAKE_GH_CALL_LOG: callLog,
        },
      });

      assert.equal(result.status, 1, scenario.name);
      assert.match(result.stderr, scenario.expected, scenario.name);
      assert.doesNotMatch(
        readFileSync(callLog, "utf8"),
        /^(?:POST|PUT) /mu,
        scenario.name,
      );
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("approved canonical inventory rejects repository id or node replacement across independent runs", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const repoSlug = "Joey-Tools/consumer";
  const v2RulesetName = "Must Pass Codex Review v2";
  try {
    for (const [name, replacement] of [
      ["repository-id", repositoryMetadataFixture(repoSlug, { id: 5678 })],
      [
        "repository-node-id",
        repositoryMetadataFixture(repoSlug, { node_id: "R_kgDOReplacement" }),
      ],
    ]) {
      const fakeBin = join(fixtureRoot, name);
      const stateDir = join(fixtureRoot, `${name}-state`);
      const stageLog = join(fixtureRoot, `${name}-stage.log`);
      const activationLog = join(fixtureRoot, `${name}-activation.log`);
      createFakeGhExecutable(fakeBin);
      const migration = stageThenActivationResponseFixtures({
        repoSlug,
        v2RulesetName,
      });
      const baseline = repositoryMetadataFixture(repoSlug);
      const responses = {
        ...migration.responses,
        [`GET repos/${repoSlug}`]: {
          __fake_sequence: [
            ...Array.from({ length: 9 }, () => baseline),
            replacement,
            replacement,
            replacement,
          ],
        },
      };

      const stage = runBootstrap([
        "--repo",
        repoSlug,
        "--ruleset-name",
        v2RulesetName,
        "--apply",
      ], {
        env: fakeGhEnvironment({
          fakeBin,
          responses,
          stateDir,
          callLog: stageLog,
        }),
      });
      assert.equal(stage.status, 0, `${name} stage: ${stage.stderr}`);
      assert.match(stage.stdout, /Created ruleset/u, name);

      const activation = runBootstrap([
        ...activationArguments(repoSlug, CANARY_HEAD_SHA),
        "--ruleset-name",
        v2RulesetName,
      ], {
        env: fakeGhEnvironment({
          fakeBin,
          responses,
          stateDir,
          callLog: activationLog,
        }),
      });
      assert.equal(activation.status, 1, name);
      assert.match(
        activation.stderr,
        /canonical legacy review-gate inventory digest mismatched.*initial approval-snapshot readback/iu,
        name,
      );
      assert.doesNotMatch(
        readFileSync(activationLog, "utf8"),
        /^(?:POST|PUT) /mu,
        name,
      );
      assert.doesNotMatch(activation.stdout, /Updated ruleset/u, name);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("HTTP 200 null or empty classic status JSON cannot authorize activation or post-cleanup", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const repoSlug = "Joey-Tools/consumer";
  try {
    for (const [valueName, value, expected] of [
      [
        "null",
        null,
        /HTTP 200 with null JSON; only a verified 404 can prove that surface absent/u,
      ],
      [
        "empty-object",
        {},
        /required_status_checks is malformed or incomplete/u,
      ],
    ]) {
      for (const mode of ["activate", "verify-post-cleanup"]) {
        const name = `${mode}-${valueName}`;
        const fakeBin = join(fixtureRoot, name);
        const callLog = join(fixtureRoot, `${name}.log`);
        createFakeGhExecutable(fakeBin);
        const selected = mode === "activate"
          ? completeDisabledRulesetFixture(7)
          : completeActiveRulesetFixture(7);
        const responses = {
          ...canonicalRemoteWorkflowResponses(repoSlug),
          [`repos/${repoSlug}/branches/master/protection/required_status_checks`]:
            value,
          [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
            [selected],
          ],
          [`repos/${repoSlug}/rulesets/7`]: selected,
          [`PUT repos/${repoSlug}/rulesets/7`]: { id: 7 },
        };
        const args = mode === "activate"
          ? activationArguments(repoSlug, CANARY_HEAD_SHA)
          : [
              "--repo",
              repoSlug,
              "--verify-post-cleanup",
              "--expected-post-cleanup-security-sha256",
              "0".repeat(64),
            ];
        const result = runBootstrap(args, {
          env: {
            ...process.env,
            PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
            FAKE_GH_RESPONSES: JSON.stringify(responses),
            FAKE_GH_CALL_LOG: callLog,
          },
        });

        assert.equal(result.status, 1, name);
        assert.match(result.stderr, expected, name);
        const calls = readFileSync(callLog, "utf8");
        assert.doesNotMatch(calls, /^PUT /mu, name);
        assert.doesNotMatch(result.stdout, /Post-cleanup verified/u, name);
      }
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("duplicate required-status rules cannot compose one complete gate or reach PUT", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const fakeBin = join(fixtureRoot, "bin");
  const callLog = join(fixtureRoot, "calls.log");
  const repoSlug = "Joey-Tools/consumer";
  try {
    const duplicate = completeDisabledRulesetFixture(7);
    const statusRuleIndex = duplicate.rules.findIndex(
      (rule) => rule.type === "required_status_checks",
    );
    duplicate.rules.splice(
      statusRuleIndex,
      1,
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: true,
          required_status_checks: [{ context: "ci/unbound-strict" }],
        },
      },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: false,
          required_status_checks: [{
            context: DEFAULT_STATUS_CONTEXT,
            integration_id: DEFAULT_STATUS_INTEGRATION_ID,
          }],
        },
      },
    );

    assert.equal(rulesetHasGatePolicy(duplicate), false);
    assert.throws(
      () => assertCompleteRulesetApiObject(duplicate),
      /duplicate required_status_checks rules/u,
    );

    createFakeGhExecutable(fakeBin);
    const responses = {
      ...canonicalRemoteWorkflowResponses(repoSlug),
      [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
        [duplicate],
      ],
      [`repos/${repoSlug}/rulesets/7`]: duplicate,
      [`PUT repos/${repoSlug}/rulesets/7`]: { id: 7 },
    };
    const result = runBootstrap(activationArguments(repoSlug, CANARY_HEAD_SHA), {
      env: {
        ...process.env,
        PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
        FAKE_GH_RESPONSES: JSON.stringify(responses),
        FAKE_GH_CALL_LOG: callLog,
      },
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /duplicate required_status_checks rules/u);
    assert.doesNotMatch(readFileSync(callLog, "utf8"), /^PUT /mu);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("selected target identity drift after the initial listing prevents every write", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const repoSlug = "Joey-Tools/consumer";
  try {
    const selected = completeDisabledRulesetFixture(7);
    for (const [name, drifted] of [
      ["renamed", { ...selected, name: "Renamed v2 gate" }],
      ["source", { ...selected, source: "Joey-Tools/replacement" }],
      ["id", { ...selected, id: 8 }],
      ["target", { ...selected, target: "tag" }],
    ]) {
      const fakeBin = join(fixtureRoot, name);
      const stateDir = join(fixtureRoot, `${name}-state`);
      const callLog = join(fixtureRoot, `${name}.log`);
      createFakeGhExecutable(fakeBin);
      const responses = {
        ...canonicalRemoteWorkflowResponses(repoSlug),
        [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
          [selected],
        ],
        [`GET repos/${repoSlug}/rulesets/7`]: {
          __fake_sequence: [selected, drifted],
        },
        [`PUT repos/${repoSlug}/rulesets/7`]: { id: 7 },
      };
      const result = runBootstrap(activationArguments(repoSlug, CANARY_HEAD_SHA), {
        env: fakeGhEnvironment({ fakeBin, responses, stateDir, callLog }),
      });

      assert.equal(result.status, 1, name);
      assert.match(
        result.stderr,
        /Selected ruleset id 7 no longer has the approved repository identity, name, source, and branch target/u,
        name,
      );
      const calls = readFileSync(callLog, "utf8");
      assert.equal(countLines(calls, `GET repos/${repoSlug}/rulesets/7`), 2, name);
      assert.doesNotMatch(calls, /^PUT /mu, name);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("post-cleanup double readback rejects torn classic-to-ruleset surface swaps", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const repoSlug = "Joey-Tools/consumer";
  const activeV2 = completeActiveRulesetFixture(7);
  const legacyRuleset = activeLegacyRulesetFixture(9);
  const effectiveLegacy = effectiveLegacyRequiredStatusChecksRule(legacyRuleset);
  const classicLegacy = {
    strict: true,
    contexts: [LEGACY_STATUS_CONTEXT],
    checks: [],
  };
  try {
    for (const [name, effectiveSequence, classicSequence] of [
      [
        "classic-to-ruleset",
        [[[]], [[effectiveLegacy]]],
        [EMPTY_CLASSIC_REQUIRED_STATUS_CHECKS, EMPTY_CLASSIC_REQUIRED_STATUS_CHECKS],
      ],
      [
        "ruleset-to-classic",
        [[[]], [[]]],
        [EMPTY_CLASSIC_REQUIRED_STATUS_CHECKS, classicLegacy],
      ],
    ]) {
      const fakeBin = join(fixtureRoot, name);
      const stateDir = join(fixtureRoot, `${name}-state`);
      const callLog = join(fixtureRoot, `${name}.log`);
      createFakeGhExecutable(fakeBin);
      const responses = {
        ...canonicalRemoteWorkflowResponses(repoSlug),
        [`GET repos/${repoSlug}/rules/branches/master?per_page=100`]: {
          __fake_sequence: effectiveSequence,
        },
        [`GET repos/${repoSlug}/branches/master/protection/required_status_checks`]: {
          __fake_sequence: classicSequence,
        },
        [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
          [activeV2],
        ],
        [`repos/${repoSlug}/rulesets/7`]: activeV2,
        [`repos/${repoSlug}/rulesets/9`]: legacyRuleset,
      };
      const result = runBootstrap([
        "--repo",
        repoSlug,
        "--verify-post-cleanup",
        "--expected-post-cleanup-security-sha256",
        "0".repeat(64),
      ], {
        env: fakeGhEnvironment({ fakeBin, responses, stateDir, callLog }),
      });

      assert.equal(result.status, 1, name);
      assert.match(
        result.stderr,
        /codex\/review-gate remains required after cleanup|changed between the (?:complete ruleset|full security snapshot) and legacy-inventory readback(?:s)?/u,
        name,
      );
      assert.doesNotMatch(result.stdout, /Post-cleanup verified/u, name);
      const calls = readFileSync(callLog, "utf8");
      assert.equal(
        countLines(
          calls,
          `GET repos/${repoSlug}/rules/branches/master?per_page=100`,
        ),
        2,
        name,
      );
      assert.equal(
        countLines(
          calls,
          `GET repos/${repoSlug}/branches/master/protection/required_status_checks`,
        ),
        2,
        name,
      );
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("create and update reject target drift between their two post-write readbacks", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-fake-gh-"));
  const repoSlug = "Joey-Tools/consumer";
  try {
    for (const mode of ["create", "update"]) {
      const fakeBin = join(fixtureRoot, mode);
      const stateDir = join(fixtureRoot, `${mode}-state`);
      const callLog = join(fixtureRoot, `${mode}.log`);
      createFakeGhExecutable(fakeBin);
      const complete = completeDisabledRulesetFixture(7);
      const drifted = { ...complete, target: "tag" };
      let args;
      let expectedReadCount;
      let responses;
      if (mode === "create") {
        args = ["--repo", repoSlug, "--apply"];
        expectedReadCount = 2;
        responses = {
          ...canonicalRemoteWorkflowResponses(repoSlug),
          [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [[]],
          [`POST repos/${repoSlug}/rulesets`]: {
            id: 7,
            name: "Must Pass Codex Review",
          },
          [`GET repos/${repoSlug}/rulesets/7`]: {
            __fake_sequence: [complete, drifted],
          },
        };
      } else {
        const incomplete = completeDisabledRulesetFixture(7);
        incomplete.rules = incomplete.rules.filter(
          (rule) => rule.type !== "non_fast_forward",
        );
        args = ["--repo", repoSlug, "--apply"];
        expectedReadCount = 6;
        responses = {
          ...canonicalRemoteWorkflowResponses(repoSlug),
          [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [
            [incomplete],
          ],
          [`PUT repos/${repoSlug}/rulesets/7`]: {
            id: 7,
            name: "Must Pass Codex Review",
          },
          [`GET repos/${repoSlug}/rulesets/7`]: {
            __fake_sequence: [
              incomplete,
              incomplete,
              incomplete,
              incomplete,
              complete,
              drifted,
            ],
          },
        };
      }

      const result = runBootstrap(args, {
        env: fakeGhEnvironment({ fakeBin, responses, stateDir, callLog }),
      });
      assert.equal(result.status, 1, `${mode}: ${result.stderr}`);
      assert.match(result.stderr, /Ruleset readback for id 7 is incomplete or drifted/u, mode);
      const calls = readFileSync(callLog, "utf8");
      assert.equal(
        countLines(calls, `GET repos/${repoSlug}/rulesets/7`),
        expectedReadCount,
        mode,
      );
      assert.match(
        calls,
        new RegExp(`^${mode === "create" ? "POST" : "PUT"} repos/${repoSlug}/rulesets(?:/7)?$`, "mu"),
        mode,
      );
      assert.doesNotMatch(result.stdout, /Ruleset readback:/u, mode);
      assert.doesNotMatch(result.stdout, /(?:Created|Updated) ruleset/u, mode);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("canonical template and importable ruleset implement the staged v2 contract", () => {
  const workflow = readFileSync(
    new URL(
      "../templates/codex-gated-repo/.github/workflows/codex-review-gate.yml",
      import.meta.url,
    ),
    "utf8",
  );
  const codeowners = readFileSync(
    new URL(
      "../templates/codex-gated-repo/.github/CODEOWNERS",
      import.meta.url,
    ),
    "utf8",
  );
  const readme = readFileSync(
    new URL("../templates/codex-gated-repo/README.md", import.meta.url),
    "utf8",
  );
  const humanInstallGuide = readFileSync(
    new URL("../docs/install/human.md", import.meta.url),
    "utf8",
  );
  const agentInstallGuide = readFileSync(
    new URL("../docs/install/agent.md", import.meta.url),
    "utf8",
  );
  const ruleset = JSON.parse(
    readFileSync(
      new URL(
        "../templates/codex-gated-repo/rulesets/codex-review-gate.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );

  validateCanonicalV2WorkflowContent(workflow);
  validateCanonicalLegacyBridgeWorkflowContent(
    CANONICAL_LEGACY_BRIDGE_WORKFLOW,
  );
  validateControlPlaneCodeownersContent(codeowners, DEFAULT_CONTROL_PLANE_OWNER);
  for (const input of [
    "completion-signal-buffer-seconds",
    "failed-findings-recovery",
    "failed-findings-recovery-mode",
  ]) {
    assert.doesNotMatch(workflow, new RegExp(`^\\s+${input}:`, "m"));
  }
  assert.doesNotMatch(workflow, /^\s*schedule:\s*$/m);
  assert.doesNotMatch(workflow, /^\s*pull_request_review(?:_comment)?:\s*$/m);
  assert.match(readme, /docs\/install\/human\.md/);
  assert.match(readme, /docs\/install\/agent\.md/);
  for (const guide of [readme, humanInstallGuide, agentInstallGuide]) {
    assert.match(guide, /not\s+an\s+operation-bound/u);
    assert.match(guide, /same-UID/u);
  }
  for (const path of [
    "../docs/install/human.md",
    "../docs/install/human.zh-CN.md",
    "../docs/install/agent.md",
    "../docs/install/agent.zh-CN.md",
  ]) {
    assert.equal(existsSync(new URL(path, import.meta.url)), true, `missing ${path}`);
  }
  assert.equal(ruleset.source_type, "Repository");
  const { source_type: responseOnlySourceType, ...templatePayload } = ruleset;
  assert.equal(responseOnlySourceType, "Repository");
  assert.deepEqual(templatePayload, buildCreateRulesetPayload());
  assert.equal(typeof ruleset.target, "string");
  assert.equal(typeof ruleset.conditions, "object");
  assert.equal(Array.isArray(ruleset.bypass_actors), true);
  assert.equal(ruleset.enforcement, "disabled");
  assert.equal(ruleset.bypass_actors.length, 0);
  assert.equal(ruleset.rules[0].type, "pull_request");
  assert.equal(ruleset.rules[0].parameters.required_review_thread_resolution, true);
  assert.equal(ruleset.rules[0].parameters.require_code_owner_review, true);
  assert.equal(ruleset.rules[0].parameters.dismiss_stale_reviews_on_push, true);
  assert.equal(ruleset.rules[0].parameters.required_approving_review_count, 0);
  assert.equal(ruleset.rules[1].type, "required_status_checks");
  assert.equal(ruleset.rules[1].parameters.strict_required_status_checks_policy, true);
  assert.deepEqual(ruleset.rules[1].parameters.required_status_checks, [
    {
      context: DEFAULT_STATUS_CONTEXT,
      integration_id: DEFAULT_STATUS_INTEGRATION_ID,
    },
  ]);
});

function legacyInventoryResponseFixtures(
  repoSlug,
  {
    repositoryId = 1234,
    repositoryNodeId = "R_kgDOConsumer",
    defaultBranch = "master",
    effectiveRulePages = [[]],
    rulesets = [],
    classicRequiredStatusChecks = EMPTY_CLASSIC_REQUIRED_STATUS_CHECKS,
  } = {},
) {
  const inventory = {
    repository: repoSlug,
    repositoryId,
    repositoryNodeId,
    defaultBranch,
    effectiveRulePages,
    rulesets,
    classicRequiredStatusChecks,
  };
  const sha256 = createHash("sha256")
    .update(canonicalLegacyReviewGateInventoryBytes(inventory))
    .digest("hex");
  const branchUri = encodeURIComponent(defaultBranch);
  return {
    approval: {
      repository: repoSlug,
      repositoryId,
      repositoryNodeId,
      defaultBranch,
      sha256,
    },
    responses: {
      [EXPECTED_LEGACY_INVENTORY_FIXTURE_KEY]: {
        repository: repoSlug,
        repositoryId,
        repositoryNodeId,
        defaultBranch,
        sha256,
      },
      [`repos/${repoSlug}/rules/branches/${branchUri}?per_page=100`]:
        effectiveRulePages,
      [`repos/${repoSlug}/branches/${branchUri}/protection/required_status_checks`]:
        classicRequiredStatusChecks === null
          ? { __fake_http_error: 404, message: "Branch not protected" }
          : classicRequiredStatusChecks,
      ...Object.fromEntries(
        rulesets.map((ruleset) => [
          `repos/${repoSlug}/rulesets/${ruleset.id}`,
          ruleset,
        ]),
      ),
    },
  };
}

function effectiveLegacyRequiredStatusChecksRule(ruleset) {
  const rule = ruleset.rules.find(
    (candidate) =>
      candidate.type === "required_status_checks" &&
      candidate.parameters.required_status_checks.some(
        (check) => check.context === LEGACY_STATUS_CONTEXT,
      ),
  );
  assert.ok(rule, `ruleset ${ruleset.id} must require ${LEGACY_STATUS_CONTEXT}`);
  return { ...structuredClone(rule), ruleset_id: ruleset.id };
}

function stageThenActivationResponseFixtures({
  repoSlug,
  legacyRulesets = [],
  classicRequiredStatusChecks = EMPTY_CLASSIC_REQUIRED_STATUS_CHECKS,
  v2RulesetName = "Must Pass Codex Review v2",
  legacyBridge = false,
} = {}) {
  const effectiveRulePages = [[
    ...legacyRulesets.map(effectiveLegacyRequiredStatusChecksRule),
  ]];
  const legacyInventory = legacyInventoryResponseFixtures(repoSlug, {
    effectiveRulePages,
    rulesets: legacyRulesets,
    classicRequiredStatusChecks,
  });
  const disabledV2 = {
    ...completeDisabledRulesetFixture(8),
    name: v2RulesetName,
  };
  const activeV2 = {
    ...completeActiveRulesetFixture(8),
    name: v2RulesetName,
  };
  const validPullRequest = canaryPullRequestFixture(repoSlug, CANARY_HEAD_SHA);
  const parentProtection = classicRequiredStatusChecks === null
    ? { __fake_http_error: 404, message: "Branch not protected" }
    : { required_status_checks: classicRequiredStatusChecks };
  return {
    activeV2,
    disabledV2,
    effectiveRulePages,
    legacyInventory,
    parentProtection,
    responses: {
      ...canonicalRemoteWorkflowResponses(repoSlug, { legacyBridge }),
      ...canaryRunResponses(repoSlug),
      ...legacyInventory.responses,
      [`repos/${repoSlug}/branches/master/protection`]: parentProtection,
      [`GET repos/${repoSlug}/pulls/7`]: {
        __fake_sequence: [validPullRequest, validPullRequest, validPullRequest],
      },
      [`GET repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: {
        __fake_sequence: [
          [legacyRulesets],
          [legacyRulesets],
          [[...legacyRulesets, disabledV2]],
          [[...legacyRulesets, disabledV2]],
          [[...legacyRulesets, disabledV2]],
        ],
      },
      [`POST repos/${repoSlug}/rulesets`]: { id: 8, name: v2RulesetName },
      [`GET repos/${repoSlug}/rulesets/8`]: {
        __fake_sequence: [
          disabledV2,
          disabledV2,
          disabledV2,
          disabledV2,
          disabledV2,
          disabledV2,
          disabledV2,
          activeV2,
          activeV2,
        ],
      },
      [`PUT repos/${repoSlug}/rulesets/8`]: { id: 8, name: v2RulesetName },
    },
  };
}

function classicDriftSequences({
  repoSlug,
  baseline,
  drifted,
  parentBaseline,
}) {
  const unavailable = { __fake_http_error: 404, message: "Branch not protected" };
  const exactDrifted = drifted === null ? unavailable : drifted;
  const parentDrifted = drifted === null
    ? unavailable
    : { required_status_checks: drifted };
  return {
    [`GET repos/${repoSlug}/branches/master/protection/required_status_checks`]: {
      __fake_sequence: [baseline, baseline, baseline, exactDrifted],
    },
    [`GET repos/${repoSlug}/branches/master/protection`]: {
      __fake_sequence: [
        parentBaseline,
        parentBaseline,
        parentBaseline,
        parentDrifted,
      ],
    },
  };
}

function canonicalRemoteWorkflowResponses(
  repoSlug,
  { legacyBridge = false } = {},
) {
  const codeowners = ensureControlPlaneCodeownersContent(null).content;
  return {
    ...legacyInventoryResponseFixtures(repoSlug).responses,
    [`repos/${repoSlug}`]: repositoryMetadataFixture(repoSlug),
    [`repos/${repoSlug}/actions/permissions/workflow`]: {
      default_workflow_permissions: "read",
      can_approve_pull_request_reviews: false,
    },
    [`repos/${repoSlug}/collaborators/JoeyTeng/permission`]:
      controlPlaneOwnerPermissionFixture(),
    [`repos/${repoSlug}/branches/master`]: {
      name: "master",
      commit: { sha: DEFAULT_BRANCH_SHA },
    },
    [`repos/${repoSlug}/branches/master/protection`]: {
      required_status_checks: {
        ...EMPTY_CLASSIC_REQUIRED_STATUS_CHECKS,
      },
    },
    [`repos/${repoSlug}/git/trees/${DEFAULT_BRANCH_SHA}`]: {
      truncated: false,
      tree: [{ path: ".github", sha: "github-tree", type: "tree" }],
    },
    [`repos/${repoSlug}/git/trees/github-tree`]: {
      truncated: false,
      tree: [
        { path: "CODEOWNERS", sha: "codeowners-blob", type: "blob", mode: "100644" },
        { path: "workflows", sha: "workflows-tree", type: "tree" },
      ],
    },
    [`repos/${repoSlug}/git/trees/workflows-tree`]: {
      truncated: false,
      tree: [
        {
          path: "codex-review-gate.yml",
          sha: "canonical-blob",
          type: "blob",
          mode: "100644",
        },
        {
          path: "codex-review-gate-controller.yml",
          sha: "canonical-controller-blob",
          type: "blob",
          mode: "100644",
        },
        ...(legacyBridge
          ? [{
              path: "codex-review-gate-legacy-bridge.yml",
              sha: "canonical-legacy-bridge-blob",
              type: "blob",
              mode: "100644",
            }]
          : []),
      ],
    },
    [`repos/${repoSlug}/git/blobs/canonical-blob`]: {
      encoding: "base64",
      content: Buffer.from(CANONICAL_WORKFLOW, "utf8").toString("base64"),
    },
    [`repos/${repoSlug}/git/blobs/canonical-controller-blob`]: {
      encoding: "base64",
      content: Buffer.from(CANONICAL_CONTROLLER_WORKFLOW, "utf8").toString(
        "base64",
      ),
    },
    ...(legacyBridge
      ? {
          [`repos/${repoSlug}/git/blobs/canonical-legacy-bridge-blob`]: {
            encoding: "base64",
            content: Buffer.from(
              CANONICAL_LEGACY_BRIDGE_WORKFLOW,
              "utf8",
            ).toString("base64"),
          },
        }
      : {}),
    [`repos/${repoSlug}/git/blobs/codeowners-blob`]: {
      encoding: "base64",
      content: Buffer.from(codeowners, "utf8").toString("base64"),
    },
    [`repos/${repoSlug}/codeowners/errors?ref=${DEFAULT_BRANCH_SHA}`]: {
      errors: [],
    },
  };
}

function controlPlaneOwnerPermissionFixture(overrides = {}) {
  return {
    permission: "write",
    user: {
      id: 4242,
      node_id: "U_ControlPlaneOwner",
      login: "JoeyTeng",
      type: "User",
    },
    ...overrides,
  };
}

function repositoryMetadataFixture(repoSlug, overrides = {}) {
  return {
    id: CANARY_REPOSITORY_ID,
    node_id: "R_kgDOConsumer",
    full_name: repoSlug,
    archived: false,
    default_branch: "master",
    ...overrides,
  };
}

function canaryRunResponses(repoSlug, overrides = {}) {
  return {
    [`repos/${repoSlug}/actions/runs/${CANARY_RUN_ID}`]: {
      id: CANARY_RUN_ID,
      repository: { id: CANARY_REPOSITORY_ID, full_name: repoSlug },
      head_repository: { id: CANARY_REPOSITORY_ID, full_name: repoSlug },
      path: DEFAULT_WORKFLOW_PATH,
      display_title:
        `${DEFAULT_VERIFIER_RUN_NAME_PREFIX}/7/${CANARY_MERGE_SHA}`,
      head_sha: CANARY_HEAD_SHA,
      event: "pull_request",
      status: "completed",
      conclusion: "success",
      workflow_id: CANARY_WORKFLOW_ID,
      run_attempt: 1,
      pull_requests: [canonicalCanaryRunPullRequestFixture(repoSlug)],
      ...overrides,
    },
    [`repos/${repoSlug}/actions/workflows/${CANARY_WORKFLOW_ID}`]: {
      id: CANARY_WORKFLOW_ID,
      path: DEFAULT_WORKFLOW_PATH,
      state: "active",
    },
    [`repos/${repoSlug}/actions/runs/${CANARY_RUN_ID}/attempts/1/jobs?per_page=100`]: [
      {
        total_count: 1,
        jobs: [canonicalCanaryJobFixture(repoSlug)],
      },
    ],
    [`repos/${repoSlug}/pulls/7/files?per_page=100`]: [[]],
    [`repos/${repoSlug}/commits/${CANARY_HEAD_SHA}/statuses?per_page=100`]: [[]],
    [`repos/${repoSlug}/commits/${CANARY_MERGE_SHA}/statuses?per_page=100`]: [[]],
    [`repos/${repoSlug}/commits/${CANARY_HEAD_SHA}/check-runs?check_name=codex%2Fgithub-review-gate&filter=latest&per_page=100`]: [
      {
        total_count: 1,
        check_runs: [canonicalCanaryCheckRunFixture(repoSlug)],
      },
    ],
  };
}

function sourceBridgeRemovalArguments({
  canaryPr = 74,
  canaryHead = CANARY_HEAD_SHA,
  v2RulesetName = SOURCE_SELF_HOSTING_RULESET_NAME,
  includeRulesetName = true,
} = {}) {
  return [
    "--repo",
    SOURCE_SELF_HOSTING_REPOSITORY_SLUG,
    ...(includeRulesetName ? ["--ruleset-name", v2RulesetName] : []),
    "--ruleset-profile",
    RULESET_PROFILE_STATUS_ONLY,
    "--legacy-bridge",
    "--derive-source-bridge-removal-proof",
    "--canary-pr",
    String(canaryPr),
    "--canary-head",
    canaryHead,
  ];
}

function sourceBridgeRemovalFixtureResponses({
  repoSlug = SOURCE_SELF_HOSTING_REPOSITORY_SLUG,
  v2RulesetName = SOURCE_SELF_HOSTING_RULESET_NAME,
  currentDefaultBranchHeadSha = DEFAULT_BRANCH_SHA,
  historicalBaseSha = HISTORICAL_SOURCE_CANARY_BASE_SHA,
  checkRunOverrides = {},
  runOverrides = {},
  jobOverrides = {},
  pullRequestOverrides = {},
  graphPullRequestOverrides = {},
  comparisonOverrides = {},
  workflowApiOverrides = {},
  selectedV2Overrides = {},
} = {}) {
  const selectedV2 = {
    ...statusOnlyRulesetFixture(23927388, repoSlug, {
      name: v2RulesetName,
      enforcement: "active",
    }),
    ...selectedV2Overrides,
  };
  const retainedSourceRuleset = sourceRetainedRulesetFixture(repoSlug);
  const closedAt = "2026-09-25T12:00:00Z";
  const historicalPullRequest = {
    state: "closed",
    merged: false,
    merged_at: null,
    draft: false,
    changed_files: 1,
    closed_at: closedAt,
    base: {
      ref: "master",
      sha: historicalBaseSha,
      repo: { full_name: repoSlug },
    },
    head: {
      sha: CANARY_HEAD_SHA,
      repo: { full_name: repoSlug },
    },
    merge_commit_sha: CANARY_MERGE_SHA,
    ...pullRequestOverrides,
  };
  const graphPullRequest = {
    number: 74,
    state: "CLOSED",
    isDraft: false,
    merged: false,
    mergedAt: null,
    closedAt,
    baseRefName: "master",
    baseRefOid: historicalBaseSha,
    headRefOid: CANARY_HEAD_SHA,
    potentialMergeCommit: { oid: CANARY_MERGE_SHA },
    baseRepository: { nameWithOwner: repoSlug },
    headRepository: { nameWithOwner: repoSlug },
    ...graphPullRequestOverrides,
  };
  const historicalCheckRun = {
    ...canonicalCanaryCheckRunFixture(repoSlug),
    completed_at: "2026-09-25T11:59:00Z",
    ...checkRunOverrides,
  };
  const historicalRun = {
    ...canaryRunResponses(repoSlug, {
      display_title:
        `${DEFAULT_VERIFIER_RUN_NAME_PREFIX}/74/${CANARY_MERGE_SHA}`,
      pull_requests: [],
      ...runOverrides,
    })[`repos/${repoSlug}/actions/runs/${CANARY_RUN_ID}`],
  };
  const historicalJob = {
    ...canonicalCanaryJobFixture(repoSlug),
    ...jobOverrides,
  };
  const workflowApi = [
    {
      id: CANARY_WORKFLOW_ID,
      path: DEFAULT_WORKFLOW_PATH,
      state: "active",
    },
    {
      id: CANARY_WORKFLOW_ID + 1,
      path: DEFAULT_CONTROLLER_WORKFLOW_PATH,
      state: "active",
    },
    {
      id: CANARY_WORKFLOW_ID + 2,
      path: DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH,
      state: "active",
    },
  ].map((workflow) => ({ ...workflow, ...workflowApiOverrides[workflow.path] }));
  const responses = {
    ...canonicalRemoteWorkflowResponses(repoSlug, { legacyBridge: true }),
    [`repos/${repoSlug}/branches/master`]: {
      name: "master",
      commit: { sha: currentDefaultBranchHeadSha },
    },
    [`repos/${repoSlug}/git/trees/${currentDefaultBranchHeadSha}`]: {
      truncated: false,
      tree: [{ path: ".github", sha: "github-tree", type: "tree" }],
    },
    [`repos/${repoSlug}/codeowners/errors?ref=${currentDefaultBranchHeadSha}`]: {
      errors: [],
    },
    [`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`]: [[
      selectedV2,
      retainedSourceRuleset,
    ]],
    [`repos/${repoSlug}/rulesets/${selectedV2.id}`]: selectedV2,
    [`repos/${repoSlug}/rulesets/${retainedSourceRuleset.id}`]: retainedSourceRuleset,
    [`repos/${repoSlug}/actions/workflows?per_page=100`]: [{
      total_count: workflowApi.length,
      workflows: workflowApi,
    }],
    [`repos/${repoSlug}/pulls/74`]: historicalPullRequest,
    "POST graphql": {
      data: { repository: { pullRequest: graphPullRequest } },
    },
    [`repos/${repoSlug}/pulls/74/files?per_page=100`]: [[{
      filename: "docs/.codex-review-gate-node24-canary.md",
    }]],
    [`repos/${repoSlug}/git/trees/${historicalBaseSha}`]: {
      truncated: false,
      tree: [{ path: ".github", sha: "github-tree", type: "tree" }],
    },
    [`repos/${repoSlug}/codeowners/errors?ref=${historicalBaseSha}`]: {
      errors: [],
    },
    [`repos/${repoSlug}/git/commits/${CANARY_MERGE_SHA}`]: {
      sha: CANARY_MERGE_SHA,
      parents: [{ sha: historicalBaseSha }, { sha: CANARY_HEAD_SHA }],
    },
    [`repos/${repoSlug}/compare/${historicalBaseSha}...${currentDefaultBranchHeadSha}`]: {
      base_commit: { sha: historicalBaseSha },
      merge_base_commit: { sha: historicalBaseSha },
      status: historicalBaseSha === currentDefaultBranchHeadSha ? "identical" : "ahead",
      ahead_by: historicalBaseSha === currentDefaultBranchHeadSha ? 0 : 1,
      ...comparisonOverrides,
    },
    [`repos/${repoSlug}/commits/${CANARY_HEAD_SHA}/check-runs?check_name=codex%2Fgithub-review-gate&filter=latest&per_page=100`]: [{
      total_count: 1,
      check_runs: [historicalCheckRun],
    }],
    [`repos/${repoSlug}/actions/runs/${CANARY_RUN_ID}`]: historicalRun,
    [`repos/${repoSlug}/actions/workflows/${CANARY_WORKFLOW_ID}`]: {
      id: CANARY_WORKFLOW_ID,
      path: DEFAULT_WORKFLOW_PATH,
      state: "active",
    },
    [`repos/${repoSlug}/actions/runs/${CANARY_RUN_ID}/attempts/1/jobs?per_page=100`]: [{
      total_count: 1,
      jobs: [historicalJob],
    }],
    // Historical #74 may retain v1 producer statuses. The source proof must
    // prove they are not required now, not retroactively erase them.
    [`repos/${repoSlug}/commits/${CANARY_HEAD_SHA}/statuses?per_page=100`]: [[{
      context: LEGACY_STATUS_CONTEXT,
      state: "success",
      sha: CANARY_HEAD_SHA,
    }]],
    [`repos/${repoSlug}/commits/${CANARY_MERGE_SHA}/statuses?per_page=100`]: [[{
      context: LEGACY_STATUS_CONTEXT,
      state: "success",
      sha: CANARY_MERGE_SHA,
    }]],
  };
  return {
    responses,
    selectedV2,
    retainedSourceRuleset,
    historicalPullRequest,
    graphPullRequest,
  };
}

function canonicalCanaryRunPullRequestFixture(
  repoSlug,
  {
    baseSha = DEFAULT_BRANCH_SHA,
    headRepoId = CANARY_REPOSITORY_ID,
    baseRepoId = CANARY_REPOSITORY_ID,
  } = {},
) {
  return {
    number: 7,
    head: {
      sha: CANARY_HEAD_SHA,
      repo: canonicalCanaryRunRepositoryReferenceFixture(repoSlug, headRepoId),
    },
    base: {
      ref: "master",
      sha: baseSha,
      repo: canonicalCanaryRunRepositoryReferenceFixture(repoSlug, baseRepoId),
    },
  };
}

function canonicalCanaryRunRepositoryReferenceFixture(repoSlug, id) {
  return {
    id,
    name: repoSlug.slice(repoSlug.lastIndexOf("/") + 1),
    url: `https://api.github.com/repos/${repoSlug}`,
  };
}

function canonicalCanaryJobFixture(repoSlug) {
  return {
    id: CANARY_JOB_ID,
    run_id: CANARY_RUN_ID,
    head_sha: CANARY_HEAD_SHA,
    name: DEFAULT_STATUS_CONTEXT,
    status: "completed",
    conclusion: "success",
    check_run_url:
      `https://api.github.com/repos/${repoSlug}/check-runs/${CANARY_CHECK_RUN_ID}`,
  };
}

function canonicalCanaryCheckRunFixture(repoSlug) {
  return {
    id: CANARY_CHECK_RUN_ID,
    name: DEFAULT_STATUS_CONTEXT,
    head_sha: CANARY_HEAD_SHA,
    status: "completed",
    conclusion: "success",
    details_url:
      `https://github.com/${repoSlug}/actions/runs/${CANARY_RUN_ID}/job/${CANARY_JOB_ID}`,
    app: {
      id: DEFAULT_STATUS_INTEGRATION_ID,
      name: "GitHub Actions",
      slug: "github-actions",
    },
  };
}

function canaryPullRequestFixture(repoSlug, headSha) {
  return {
    state: "open",
    merged: false,
    draft: false,
    changed_files: 0,
    base: {
      ref: "master",
      sha: DEFAULT_BRANCH_SHA,
      repo: { full_name: repoSlug },
    },
    head: {
      repo: { full_name: repoSlug },
      sha: headSha,
    },
    merge_commit_sha: CANARY_MERGE_SHA,
  };
}

function successfulCanaryStatusPages({
  repoSlug,
  headSha,
  creatorLogin = "github-actions[bot]",
  targetUrl = `https://github.com/${repoSlug}/actions/runs/${CANARY_RUN_ID}`,
} = {}) {
  return [
    [
      {
        context: DEFAULT_STATUS_CONTEXT,
        state: "success",
        sha: headSha,
        target_url: targetUrl,
        creator: { login: creatorLogin, type: "Bot" },
      },
    ],
  ];
}

function completeActiveRulesetFixture(id) {
  const rules = ensureGatePolicyInRules([]).rules;
  const pullRequest = rules.find((rule) => rule.type === "pull_request");
  Object.assign(pullRequest.parameters, {
    allowed_merge_methods: ["merge", "squash", "rebase"],
    dismissal_restriction: { allowed_actors: [], enabled: false },
    require_extra_approval_for_unattributed_changes: false,
    required_reviewers: [],
  });
  rules.find(
    (rule) => rule.type === "required_status_checks",
  ).parameters.do_not_enforce_on_create = false;
  return {
    id,
    name: "Must Pass Codex Review",
    source_type: "Repository",
    source: "Joey-Tools/consumer",
    target: "branch",
    enforcement: "active",
    bypass_actors: [],
    conditions: {
      ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] },
    },
    rules,
  };
}

function completeDisabledRulesetFixture(id) {
  return {
    ...completeActiveRulesetFixture(id),
    enforcement: "disabled",
  };
}

function statusOnlyRulesetFixture(
  id,
  repoSlug,
  { name = "Must Pass Codex Review", enforcement = "active" } = {},
) {
  return {
    id,
    source_type: "Repository",
    source: repoSlug,
    ...buildCreateRulesetPayload({
      name,
      enforcement,
      profile: RULESET_PROFILE_STATUS_ONLY,
    }),
  };
}

function sourceLegacyRulesetFixture(id, repoSlug) {
  const legacy = completeActiveRulesetFixture(id);
  legacy.name = "Must Pass Codex Review";
  legacy.source = repoSlug;
  legacy.rules.find(
    (rule) => rule.type === "required_status_checks",
  ).parameters.required_status_checks = [{ context: LEGACY_STATUS_CONTEXT }];
  legacy.rules.push({ type: "deletion" });
  return legacy;
}

function sourceRetainedRulesetFixture(repoSlug = SOURCE_SELF_HOSTING_REPOSITORY_SLUG) {
  return {
    id: SOURCE_SELF_HOSTING_RETAINED_RULESET_ID,
    name: SOURCE_SELF_HOSTING_RETAINED_RULESET_NAME,
    source_type: "Repository",
    source: repoSlug,
    target: "branch",
    enforcement: "active",
    bypass_actors: [],
    conditions: {
      ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] },
    },
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      {
        type: "pull_request",
        parameters: {
          allowed_merge_methods: ["squash"],
          dismiss_stale_reviews_on_push: false,
          dismissal_restriction: { allowed_actors: [], enabled: false },
          require_code_owner_review: false,
          require_extra_approval_for_unattributed_changes: true,
          require_last_push_approval: false,
          required_approving_review_count: 0,
          required_review_thread_resolution: true,
          required_reviewers: [],
        },
      },
    ],
  };
}

function activeLegacyRulesetFixture(
  id,
  { name = "Legacy Codex Review", sourceType = "Repository" } = {},
) {
  return {
    id,
    name,
    source_type: sourceType,
    source: sourceType === "Repository" ? "Joey-Tools/consumer" : "Joey-Tools",
    target: "branch",
    enforcement: "active",
    bypass_actors: [],
    conditions: {
      ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] },
    },
    rules: [
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: true,
          required_status_checks: [{ context: LEGACY_STATUS_CONTEXT }],
        },
      },
    ],
  };
}

function activationArguments(repoSlug, headSha) {
  return [
    "--repo",
    repoSlug,
    "--activate",
    "--canary-pr",
    "7",
    "--canary-head",
    headSha,
    "--apply",
  ];
}

function fakeGhEnvironment({ fakeBin, responses, stateDir, callLog }) {
  return {
    ...process.env,
    GH_HOST: "hostile.invalid",
    PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
    FAKE_GH_RESPONSES: JSON.stringify(responses),
    FAKE_GH_STATE_DIR: stateDir,
    FAKE_GH_CALL_LOG: callLog,
  };
}

function sourceClosureTimingPreloadSource() {
  return `
const nativeSetTimeout = global.setTimeout;
global.setTimeout = (callback, delay, ...args) => {
  if (delay === 5000) {
    queueMicrotask(() => callback(...args));
    return 0;
  }
  return nativeSetTimeout(callback, delay, ...args);
};
if (process.env.CODEX_SOURCE_CLOSURE_TEST_CLOCK === "unstable") {
  const values = [0, 0, 0, 60000];
  let index = 0;
  Date.now = () => values[Math.min(index++, values.length - 1)];
}
if (process.env.CODEX_SOURCE_CLOSURE_TEST_CLOCK === "second-read-over-deadline") {
  const values = [0, 0, 60000];
  let index = 0;
  Date.now = () => values[Math.min(index++, values.length - 1)];
}
`;
}

function sourceBridgeRemovalPostRenameRemoteDriftPreloadSource() {
  return `
const fs = require("node:fs");
const { join } = require("node:path");
const { syncBuiltinESMExports } = require("node:module");

const originalRename = fs.promises.rename.bind(fs.promises);
const targetRoot = process.env.CODEX_SOURCE_CLOSURE_TEST_RACE_ROOT;
const bridgePath = join(
  targetRoot,
  ".github",
  "workflows",
  "codex-review-gate-legacy-bridge.yml",
);
const permissionEndpoint =
  "repos/Joey-Tools/codex-review-gate/collaborators/JoeyTeng/permission";
let injected = false;

fs.promises.rename = async function patchedRename(from, to) {
  const result = await originalRename(from, to);
  if (!injected && String(from) === bridgePath) {
    injected = true;
    const responses = JSON.parse(process.env.FAKE_GH_RESPONSES || "{}");
    const permission = responses[permissionEndpoint];
    if (
      permission === null ||
      typeof permission !== "object" ||
      Array.isArray(permission)
    ) {
      throw new Error("source drift fixture lacks the control-plane permission response");
    }
    responses[permissionEndpoint] = { ...permission, permission: "maintain" };
    process.env.FAKE_GH_RESPONSES = JSON.stringify(responses);
  }
  return result;
};

syncBuiltinESMExports();
`;
}

function sourceBridgeRemovalWorktreeDiffRacePreloadSource() {
  return `
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { join } = require("node:path");
const { syncBuiltinESMExports } = require("node:module");

const originalMkdtemp = fs.promises.mkdtemp.bind(fs.promises);
const originalRename = fs.promises.rename.bind(fs.promises);
const originalUnlink = fs.promises.unlink.bind(fs.promises);
const targetRoot = process.env.CODEX_SOURCE_CLOSURE_TEST_RACE_ROOT;
const phase = process.env.CODEX_SOURCE_CLOSURE_TEST_WORKTREE_DIFF_RACE_PHASE;
const postUnlinkMarkerPath = process.env.CODEX_SOURCE_CLOSURE_TEST_POST_UNLINK_MARKER;
const bridgePath = join(
  targetRoot,
  ".github",
  "workflows",
  "codex-review-gate-legacy-bridge.yml",
);
const quarantinePrefix = join(
  targetRoot,
  ".github",
  "workflows",
  ".codex-review-gate-removal-",
);
let injected = false;

function injectUnrelatedTrackedDiff() {
  fs.appendFileSync(
    join(targetRoot, "README.md"),
    "unrelated worktree change\\n",
    "utf8",
  );
}

function injectUnrelatedStagedDiff() {
  injectUnrelatedTrackedDiff();
  execFileSync("git", ["-C", targetRoot, "add", "README.md"], {
    stdio: "ignore",
  });
}

function injectUnrelatedUntrackedFile() {
  fs.writeFileSync(
    join(targetRoot, "unrelated-source-bridge-race.txt"),
    "unrelated untracked worktree change\\n",
    "utf8",
  );
}

if (phase === "before-quarantine-rename") {
  fs.promises.mkdtemp = async function patchedMkdtemp(prefix, ...args) {
    const directory = await originalMkdtemp(prefix, ...args);
    if (!injected && String(prefix) === quarantinePrefix) {
      injected = true;
      injectUnrelatedTrackedDiff();
    }
    return directory;
  };
} else if (
  phase === "after-quarantine-rename-tracked-before-unlink" ||
  phase === "after-quarantine-rename-staged-before-unlink" ||
  phase === "after-quarantine-rename-untracked-before-unlink"
) {
  fs.promises.rename = async function patchedRename(from, to) {
    const result = await originalRename(from, to);
    if (!injected && String(from) === bridgePath) {
      injected = true;
      if (phase === "after-quarantine-rename-staged-before-unlink") {
        injectUnrelatedStagedDiff();
      } else if (phase === "after-quarantine-rename-untracked-before-unlink") {
        injectUnrelatedUntrackedFile();
      } else {
        injectUnrelatedTrackedDiff();
      }
    }
    return result;
  };
} else if (phase === "post-unlink-remote-rebind") {
  if (!postUnlinkMarkerPath) {
    throw new Error("post-unlink race fixture requires a marker path");
  }
  fs.promises.unlink = async function patchedUnlink(path, ...args) {
    const result = await originalUnlink(path, ...args);
    if (!injected && String(path).startsWith(quarantinePrefix)) {
      injected = true;
      fs.writeFileSync(postUnlinkMarkerPath, "unlinked\\n", "utf8");
    }
    return result;
  };
} else {
  throw new Error(\`Unknown source worktree-diff race phase: \${phase}\`);
}

syncBuiltinESMExports();
`;
}

function sourceBridgeRemovalLinkedMarkerReplacementPreloadSource() {
  return `
const fs = require("node:fs");
const { join } = require("node:path");
const { syncBuiltinESMExports } = require("node:module");

const originalMkdtemp = fs.promises.mkdtemp.bind(fs.promises);
const targetRoot = process.env.CODEX_SOURCE_CLOSURE_TEST_RACE_ROOT;
const markerPath = join(targetRoot, ".git");
const replacementMarkerPath =
  process.env.CODEX_SOURCE_CLOSURE_TEST_REPLACEMENT_MARKER;
const displacedMarkerPath =
  process.env.CODEX_SOURCE_CLOSURE_TEST_DISPLACED_MARKER;
const quarantinePrefix = join(
  targetRoot,
  ".github",
  "workflows",
  ".codex-review-gate-removal-",
);
let injected = false;

fs.promises.mkdtemp = async function patchedMkdtemp(prefix, ...args) {
  const directory = await originalMkdtemp(prefix, ...args);
  if (!injected && String(prefix) === quarantinePrefix) {
    injected = true;
    fs.renameSync(markerPath, displacedMarkerPath);
    fs.renameSync(replacementMarkerPath, markerPath);
  }
  return directory;
};

syncBuiltinESMExports();
`;
}

function countLines(content, expected) {
  return content.split("\n").filter((line) => line === expected).length;
}

function canonicalWorkflowFixture() {
  return CANONICAL_WORKFLOW;
}

function runBootstrap(
  args,
  {
    env = process.env,
    addExpectedLegacyInventoryDigest = true,
  } = {},
) {
  const preparedArgs = [...args];
  const repoIndex = preparedArgs.indexOf("--repo");
  const verifiesPostCleanup = preparedArgs.includes("--verify-post-cleanup");
  if (
    repoIndex !== -1 &&
    !verifiesPostCleanup &&
    !preparedArgs.includes("--expected-legacy-inventory-sha256") &&
    addExpectedLegacyInventoryDigest
  ) {
    const repoSlug = preparedArgs[repoIndex + 1];
    let approval = null;
    if (typeof env.FAKE_GH_RESPONSES === "string") {
      const responses = JSON.parse(env.FAKE_GH_RESPONSES);
      approval = responses[EXPECTED_LEGACY_INVENTORY_FIXTURE_KEY] ?? null;
    }
    if (approval === null) {
      approval = legacyInventoryResponseFixtures(repoSlug).approval;
    }
    assert.deepEqual(
      {
        repository: approval.repository,
        repositoryId: approval.repositoryId,
        repositoryNodeId: approval.repositoryNodeId,
        defaultBranch: approval.defaultBranch,
      },
      {
        repository: repoSlug,
        repositoryId: 1234,
        repositoryNodeId: "R_kgDOConsumer",
        defaultBranch: "master",
      },
      "legacy inventory approval must bind the exact remote repository object and default branch",
    );
    preparedArgs.push(
      "--expected-legacy-inventory-sha256",
      approval.sha256,
    );
  }
  return spawnSync(process.execPath, [BOOTSTRAP_SCRIPT, ...preparedArgs], {
    encoding: "utf8",
    env,
  });
}

function initializeGitRepository(targetRoot) {
  runGit(["init", "--quiet", targetRoot]);
}

function buildFinalClosureOutput({
  format = "v2",
  repoSlug = "Joey-Tools/consumer",
  repositoryId = 1234,
  repositoryNodeId = "R_kgDOConsumer",
  defaultBranch = "master",
} = {}) {
  const closureFormat = finalClosureFixtureFormat(format);
  const repositories = Array.from(
    { length: closureFormat.cohortSize },
    (_, index) =>
      index === 0
        ? {
            full_name: repoSlug,
            id: repositoryId,
            node_id: repositoryNodeId,
            default_branch: defaultBranch,
          }
        : {
            full_name: `Joey-Tools/receipt-cohort-${String(index + 1).padStart(2, "0")}`,
            id: repositoryId + index,
            node_id: `R_kgDOReceiptCohort${index + 1}`,
            default_branch: defaultBranch,
          },
  );
  const receipt = {
    schema_version: closureFormat.receiptSchemaVersion,
    organization: {
      login: "Joey-Tools",
      id: 991,
      node_id: "O_kgDOJoeyTools",
    },
    manifest_sha256: "1".repeat(64),
    snapshot_sha256: "2".repeat(64),
    legacy_ruleset: { id: 16590367, state: "after" },
    v2_ruleset: { id: 26590367, state: "active" },
    repositories,
  };
  if (closureFormat.receiptSchemaVersion === 2) {
    receipt.manifest_repositories = structuredClone(repositories);
  }
  return {
    schema_version: closureFormat.outputSchemaVersion,
    mode: "verify",
    organization: receipt.organization,
    manifest_sha256: receipt.manifest_sha256,
    snapshot_sha256: receipt.snapshot_sha256,
    status: "final-verified",
    applied: false,
    plan_sha256: organizationFinalClosurePlanSha256({
      manifest_sha256: receipt.manifest_sha256,
      snapshot_sha256: receipt.snapshot_sha256,
    }),
    action: null,
    repositories_verified: receipt.repositories.length,
    final_closure_receipt: receipt,
    final_closure_receipt_sha256: createHash("sha256")
      .update(canonicalOrganizationFinalClosureReceipt(receipt))
      .digest("hex"),
  };
}

function buildSourceBridgeRemovalProofOutput({
  defaultBranch = "master",
  defaultBranchHeadSha = DEFAULT_BRANCH_SHA,
  canaryBaseSha = DEFAULT_BRANCH_SHA,
  canaryHeadSha = CANARY_HEAD_SHA,
  canaryTestMergeSha = CANARY_MERGE_SHA,
} = {}) {
  const retainedSourceRuleset = sourceRetainedRulesetFixture();
  const retainedSourceWritable =
    assertSourceSelfHostingRetainedRulesetPolicy(
      retainedSourceRuleset,
    ).writable;
  const v2Writable = {
    bypass_actors: [],
    conditions: { ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] } },
    enforcement: "active",
    id: 23927388,
    name: SOURCE_SELF_HOSTING_RULESET_NAME,
    rules: [],
    source: SOURCE_SELF_HOSTING_REPOSITORY_SLUG,
    source_type: "Repository",
    target: "branch",
  };
  const canonicalWorkflows = [
    DEFAULT_CONTROLLER_WORKFLOW_PATH,
    DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH,
    DEFAULT_WORKFLOW_PATH,
  ].sort().map((path) => ({
    path,
    mode: "100644",
    content_sha256: createHash("sha256")
      .update(`${path}:canonical`, "utf8")
      .digest("hex"),
  }));
  const repository = {
    full_name: SOURCE_SELF_HOSTING_REPOSITORY_SLUG,
    id: CANARY_REPOSITORY_ID,
    node_id: "R_kgDOCodexReviewGate",
    default_branch: defaultBranch,
    default_branch_head_sha: defaultBranchHeadSha,
  };
  const securityState = {
    schema_version: 1,
    repository,
    actions_workflow_permissions: {},
    control_plane_owner: {
      login: DEFAULT_CONTROL_PLANE_OWNER.slice(1).toLowerCase(),
      type: "User",
      id: 42,
      node_id: "U_kgDOCodexControlPlane",
      permission: "admin",
    },
    rulesets: [{
      id: 23927388,
      name: SOURCE_SELF_HOSTING_RULESET_NAME,
      source_type: "Repository",
      source: SOURCE_SELF_HOSTING_REPOSITORY_SLUG,
      writable: v2Writable,
    }, {
      id: retainedSourceRuleset.id,
      name: retainedSourceRuleset.name,
      source_type: retainedSourceRuleset.source_type,
      source: retainedSourceRuleset.source,
      writable: retainedSourceWritable,
    }],
    workflow_inventory: canonicalWorkflows,
    codeowners: {},
    classic_branch_protection: {},
  };
  const receipt = {
    schema_version: SOURCE_BRIDGE_REMOVAL_PROOF_SCHEMA_VERSION,
    scope: "source-bridge-removal",
    repository,
    control_plane_owner: DEFAULT_CONTROL_PLANE_OWNER,
    v2_ruleset: {
      id: 23927388,
      name: SOURCE_SELF_HOSTING_RULESET_NAME,
      state: "active",
      profile: RULESET_PROFILE_STATUS_ONLY,
      context: DEFAULT_STATUS_CONTEXT,
      integration_id: DEFAULT_STATUS_INTEGRATION_ID,
    strict_required_status_checks: true,
      writable_sha256: sourceBridgeRemovalRulesetWritableSha256(v2Writable),
    },
    retained_source_ruleset: {
      id: retainedSourceRuleset.id,
      name: retainedSourceRuleset.name,
      source_type: retainedSourceRuleset.source_type,
      source: retainedSourceRuleset.source,
      target: retainedSourceRuleset.target,
      writable_sha256: sourceBridgeRemovalRulesetWritableSha256(
        retainedSourceWritable,
      ),
    },
    canary: {
      number: 74,
      state: "closed",
      merged: false,
      closed_at: "2026-09-25T12:00:00Z",
      base: { ref: defaultBranch, sha: canaryBaseSha },
      base_ancestry: {
        base_sha: canaryBaseSha,
        current_default_branch_head_sha: defaultBranchHeadSha,
        merge_base_sha: canaryBaseSha,
        status: canaryBaseSha === defaultBranchHeadSha ? "identical" : "ahead",
      },
      head_sha: canaryHeadSha,
      test_merge_sha: canaryTestMergeSha,
      check_run: {
        id: CANARY_CHECK_RUN_ID,
        name: DEFAULT_STATUS_CONTEXT,
        head_sha: canaryHeadSha,
        status: "completed",
        conclusion: "success",
        completed_at: "2026-09-25T11:59:00Z",
        app_id: DEFAULT_STATUS_INTEGRATION_ID,
        app_slug: "github-actions",
      },
      run: {
        id: CANARY_RUN_ID,
        attempt: 2,
        workflow_id: CANARY_WORKFLOW_ID,
        workflow_path: DEFAULT_WORKFLOW_PATH,
        event: "pull_request",
        head_sha: canaryHeadSha,
        status: "completed",
        conclusion: "success",
        display_title:
          `${DEFAULT_VERIFIER_RUN_NAME_PREFIX}/74/${canaryTestMergeSha}`,
      },
      job: {
        id: CANARY_JOB_ID,
        run_id: CANARY_RUN_ID,
        name: DEFAULT_STATUS_CONTEXT,
        head_sha: canaryHeadSha,
        status: "completed",
        conclusion: "success",
        check_run_id: CANARY_CHECK_RUN_ID,
      },
    },
    live_closure: {
      security_sha256: sourceBridgeRemovalSecurityStateSha256(securityState),
      legacy_inventory_sha256: sourceBridgeRemovalLegacyInventorySha256({
        repository: SOURCE_SELF_HOSTING_REPOSITORY_SLUG,
        repository_id: CANARY_REPOSITORY_ID,
        repository_node_id: "R_kgDOCodexReviewGate",
        default_branch: defaultBranch,
        classic_required_status_checks: EMPTY_CLASSIC_REQUIRED_STATUS_CHECKS,
        rulesets: [],
      }),
      legacy_inventory: {
        repository: SOURCE_SELF_HOSTING_REPOSITORY_SLUG,
        repository_id: CANARY_REPOSITORY_ID,
        repository_node_id: "R_kgDOCodexReviewGate",
        default_branch: defaultBranch,
        classic_required_status_checks: EMPTY_CLASSIC_REQUIRED_STATUS_CHECKS,
        rulesets: [],
      },
      legacy_status_required: false,
      canonical_workflows: canonicalWorkflows,
      canonical_workflow_api: canonicalWorkflows.map((workflow, index) => ({
        id: index + 100,
        path: workflow.path,
        state: "active",
      })),
      security_state: securityState,
    },
  };
  return {
    schema_version: SOURCE_BRIDGE_REMOVAL_PROOF_OUTPUT_SCHEMA_VERSION,
    mode: "derive",
    status: "candidate",
    applied: false,
    source_bridge_removal_receipt: receipt,
    source_bridge_removal_receipt_sha256: sourceBridgeRemovalProofSha256(receipt),
  };
}

function finalClosureFixtureFormat(format) {
  switch (format) {
    case "v1":
      return {
        outputSchemaVersion: "organization-review-gate-handoff-output/v1",
        receiptSchemaVersion: 1,
        cohortSize: LEGACY_ORGANIZATION_FINAL_CLOSURE_COHORT_SIZE,
      };
    case "v2":
      return {
        outputSchemaVersion: "organization-review-gate-handoff-output/v2",
        receiptSchemaVersion: 2,
        cohortSize: ORGANIZATION_FINAL_CLOSURE_COHORT_SIZE,
      };
    default:
      throw new Error(`Unsupported final closure fixture format: ${format}`);
  }
}

function substituteArchivedLegacyOnlyReceiptRepository(repositories) {
  return [
    ...repositories.slice(1),
    {
      full_name: "Joey-Tools/codex-waited-delivery",
      id: 1_242_512_099,
      node_id: "R_kgDOSg864w",
      default_branch: "master",
    },
  ].sort((left, right) =>
    left.full_name < right.full_name
      ? -1
      : left.full_name > right.full_name
        ? 1
        : 0
  );
}

function refreshFinalClosureReceiptDigest(output) {
  output.final_closure_receipt_sha256 = createHash("sha256")
    .update(canonicalJsonForTest(output.final_closure_receipt))
    .digest("hex");
}

function canonicalJsonForTest(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonForTest).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJsonForTest(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function prepareFinalClosureReceipt(targetRoot, options = {}) {
  const output = options.output ?? buildFinalClosureOutput(options);
  const receiptPath = join(targetRoot, "organization-final-closure.json");
  const repoSlug = output.final_closure_receipt.repositories[0].full_name;
  runGit([
    "-C",
    targetRoot,
    "remote",
    "add",
    "origin",
    `https://github.com/${options.originRepoSlug ?? repoSlug}.git`,
  ]);
  writeFileSync(receiptPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  return [
    "--final-closure-receipt",
    receiptPath,
    "--expected-final-closure-receipt-sha256",
    output.final_closure_receipt_sha256,
  ];
}

function prepareSourceBridgeRemovalProof(targetRoot, output = undefined) {
  const proof = output ?? buildSourceBridgeRemovalProofOutput();
  const proofPath = join(targetRoot, "source-bridge-removal-proof.json");
  const canonicalOutput = `${JSON.stringify(
    JSON.parse(canonicalSourceBridgeRemovalProofOutput(proof)),
    null,
    2,
  )}\n`;
  writeFileSync(proofPath, canonicalOutput, "utf8");
  return [
    "--source-bridge-removal-proof",
    proofPath,
    "--expected-source-bridge-removal-proof-sha256",
    proof.source_bridge_removal_receipt_sha256,
  ];
}

function finalClosureGhEnvironment(
  targetRoot,
  options = {},
  {
    repositoryMetadata = undefined,
    repositoryMetadataSequence = undefined,
    originDriftOnLiveQuery = undefined,
    originDriftTarget = "Joey-Tools/replaced-consumer",
  } = {},
) {
  const output = buildFinalClosureOutput(options);
  const originRepoSlug = options.originRepoSlug ??
    output.final_closure_receipt.repositories[0].full_name;
  const receiptRepository = output.final_closure_receipt.repositories.find(
    (candidate) => candidate.full_name.toLowerCase() === originRepoSlug.toLowerCase(),
  );
  const metadata = repositoryMetadata ?? receiptRepository ?? {
    full_name: originRepoSlug,
    id: 1,
    node_id: "R_kgDOUnboundOrigin",
    default_branch: "master",
  };
  const fakeBin = join(targetRoot, ".final-closure-gh-bin");
  const stateDir = join(targetRoot, ".final-closure-gh-state");
  const callLog = join(targetRoot, ".final-closure-gh-calls.log");
  createFakeGhExecutable(fakeBin);
  let responses = repositoryMetadataSequence === undefined
    ? undefined
    : [...repositoryMetadataSequence];
  if (originDriftOnLiveQuery !== undefined) {
    if (!Number.isSafeInteger(originDriftOnLiveQuery) || originDriftOnLiveQuery < 1) {
      throw new Error("originDriftOnLiveQuery must be a one-based safe integer.");
    }
    responses ??= [];
    while (responses.length < originDriftOnLiveQuery) {
      responses.push(metadata);
    }
    responses[originDriftOnLiveQuery - 1] = {
      __fake_origin_drift_to: originDriftTarget,
      __fake_response: metadata,
    };
  }
  const response = responses === undefined
    ? metadata
    : { __fake_sequence: responses };
  const environment = fakeGhEnvironment({
    fakeBin,
    responses: { [`repos/${originRepoSlug}`]: response },
    stateDir,
    callLog,
  });
  return originDriftOnLiveQuery === undefined
    ? environment
    : {
        ...environment,
        FAKE_GH_ORIGIN_DRIFT_TARGET_ROOT: targetRoot,
      };
}

function runGit(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed:\n${result.stderr || result.stdout}`,
  );
  return result.stdout;
}

function createFakeGhExecutable(fakeBin) {
  mkdirSync(fakeBin);
  const fakeGh = join(fakeBin, "gh");
  writeFileSync(
    fakeGh,
    `#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const responses = JSON.parse(process.env.FAKE_GH_RESPONSES);
if (
  process.argv[2] !== "api" ||
  process.argv[3] !== "--hostname" ||
  process.argv[4] !== "github.com"
) {
  process.stderr.write("gh api request is not explicitly bound to github.com\\n");
  process.exit(2);
}
const endpoint = process.argv[5];
const methodIndex = process.argv.indexOf("--method");
const method = methodIndex === -1 ? "GET" : process.argv[methodIndex + 1];
const requestKey = \`\${method} \${endpoint}\`;
if (
  process.env.FAKE_GH_POST_UNLINK_MARKER &&
  existsSync(process.env.FAKE_GH_POST_UNLINK_MARKER)
) {
  if (!process.env.FAKE_GH_POST_UNLINK_MUTATION_TARGET) {
    process.stderr.write("post-unlink fake-gh mutation target is required\\n");
    process.exit(2);
  }
  appendFileSync(
    process.env.FAKE_GH_POST_UNLINK_MUTATION_TARGET,
    "unexpected post-unlink remote request\\n",
    "utf8",
  );
}
const inputIndex = process.argv.indexOf("--input");
const requestBody = inputIndex === -1 ? null : readFileSync(0, "utf8");
if (process.env.FAKE_GH_CALL_LOG) {
  appendFileSync(process.env.FAKE_GH_CALL_LOG, \`\${requestKey}\\n\`, "utf8");
}
if (process.env.FAKE_GH_BODY_LOG && requestBody !== null) {
  appendFileSync(
    process.env.FAKE_GH_BODY_LOG,
    JSON.stringify({ requestKey, requestBody }) + "\\n",
    "utf8",
  );
}
const responseKey = Object.prototype.hasOwnProperty.call(responses, requestKey)
  ? requestKey
  : endpoint;
if (!Object.prototype.hasOwnProperty.call(responses, responseKey)) {
  process.stderr.write(\`unexpected gh request: \${requestKey}\\n\`);
  process.exit(2);
}
let response = responses[responseKey];
if (
  response !== null &&
  typeof response === "object" &&
  !Array.isArray(response) &&
  Array.isArray(response.__fake_sequence)
) {
  if (!process.env.FAKE_GH_STATE_DIR) {
    process.stderr.write("FAKE_GH_STATE_DIR is required for sequenced responses\\n");
    process.exit(2);
  }
  mkdirSync(process.env.FAKE_GH_STATE_DIR, { recursive: true });
  const statePath = join(
    process.env.FAKE_GH_STATE_DIR,
    Buffer.from(responseKey, "utf8").toString("base64url"),
  );
  let index = 0;
  try {
    index = Number(readFileSync(statePath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  if (!Number.isSafeInteger(index) || index < 0 || index >= response.__fake_sequence.length) {
    process.stderr.write(\`no sequenced response \${index} for \${requestKey}\\n\`);
    process.exit(2);
  }
  writeFileSync(statePath, String(index + 1), "utf8");
  response = response.__fake_sequence[index];
}
if (
  response !== null &&
  typeof response === "object" &&
  !Array.isArray(response) &&
  typeof response.__fake_origin_drift_to === "string"
) {
  if (!process.env.FAKE_GH_ORIGIN_DRIFT_TARGET_ROOT) {
    process.stderr.write("FAKE_GH_ORIGIN_DRIFT_TARGET_ROOT is required for origin drift responses\\n");
    process.exit(2);
  }
  if (response.__fake_response === undefined) {
    process.stderr.write("origin drift response is missing __fake_response\\n");
    process.exit(2);
  }
  execFileSync(
    "git",
    [
      "-C",
      process.env.FAKE_GH_ORIGIN_DRIFT_TARGET_ROOT,
      "remote",
      "set-url",
      "origin",
      \`https://github.com/\${response.__fake_origin_drift_to}.git\`,
    ],
    { stdio: "ignore" },
  );
  response = response.__fake_response;
}
if (
  response !== null &&
  typeof response === "object" &&
  !Array.isArray(response) &&
  Number.isSafeInteger(response.__fake_http_error)
) {
  process.stderr.write(
    "gh: " +
      (response.message ?? "API request failed") +
      " (HTTP " +
      response.__fake_http_error +
      ")\\n",
  );
  process.exit(1);
}
process.stdout.write(JSON.stringify(response));
`,
    "utf8",
  );
  chmodSync(fakeGh, 0o755);
}

function localApplyRacePreloadSource() {
  return `
const fs = require("node:fs");
const { join, basename } = require("node:path");
const { execFileSync } = require("node:child_process");
const { syncBuiltinESMExports } = require("node:module");

const promises = fs.promises;
const originalWriteFile = promises.writeFile.bind(promises);
const originalRename = promises.rename.bind(promises);
const originalUnlink = promises.unlink.bind(promises);
const mode = process.env.CODEX_BOOTSTRAP_TEST_RACE_MODE;
const targetRoot = process.env.CODEX_BOOTSTRAP_TEST_RACE_ROOT;
const bridgeMutationLog = process.env.CODEX_BOOTSTRAP_TEST_BRIDGE_MUTATION_LOG;
let injectedBeforeFirstRename = false;
let renameCount = 0;

function recordBridgeMutation(operation) {
  if (bridgeMutationLog) {
    fs.appendFileSync(bridgeMutationLog, \`\${operation}\\n\`, "utf8");
  }
}

promises.writeFile = async function patchedWriteFile(path, ...args) {
  const result = await originalWriteFile(path, ...args);
  if (
    mode === "pre-first-rename" &&
    !injectedBeforeFirstRename &&
    basename(String(path)).startsWith(".codex-review-gate.")
  ) {
    injectedBeforeFirstRename = true;
    await originalWriteFile(
      join(targetRoot, ".github", "workflows", "attacker.yml"),
      "permissions:\\n  statuses: write\\njobs: {}\\n",
      "utf8",
    );
  }
  return result;
};

promises.rename = async function patchedRename(from, to) {
  renameCount += 1;
  const bridgePath = join(
    targetRoot,
    ".github",
    "workflows",
    "codex-review-gate-legacy-bridge.yml",
  );
  if (String(from) === bridgePath) {
    recordBridgeMutation("rename");
  }
  if (
    (mode === "removal-check-delete" || mode === "removal-check-replacement") &&
    String(from) === bridgePath
  ) {
    if (mode === "removal-check-delete") {
      await originalUnlink(from);
    } else {
      await originalRename(from, bridgePath + ".admitted");
      await originalWriteFile(from, "attacker replacement\\n", "utf8");
    }
  }
  if (
    mode === "bridge-verifier-fails" &&
    String(to) === join(targetRoot, ".github", "workflows", "codex-review-gate.yml")
  ) {
    if (!fs.existsSync(join(
      targetRoot,
      ".github",
      "workflows",
      "codex-review-gate-legacy-bridge.yml",
    ))) {
      throw new Error("zero-producer ordering: verifier replacement preceded bridge install");
    }
    throw new Error("synthetic verifier replacement failure");
  }
  if (mode === "second-rename-fails" && renameCount === 2) {
    const error = new Error("synthetic second rename failure");
    error.code = "EACCES";
    throw error;
  }
  const result = await originalRename(from, to);
  if (
    String(from) === bridgePath &&
    (
      mode === "removal-identity-drift-after-quarantine-rename" ||
      mode === "removal-default-branch-drift-after-quarantine-rename"
    )
  ) {
    const responses = JSON.parse(process.env.FAKE_GH_RESPONSES || "{}");
    const repositoryKey = Object.keys(responses).find((key) =>
      key.startsWith("repos/")
    );
    if (
      repositoryKey === undefined ||
      responses[repositoryKey] === null ||
      typeof responses[repositoryKey] !== "object" ||
      Array.isArray(responses[repositoryKey])
    ) {
      throw new Error("synthetic post-rename repository drift lacks metadata");
    }
    responses[repositoryKey] = {
      ...responses[repositoryKey],
      ...(mode === "removal-identity-drift-after-quarantine-rename"
        ? { id: responses[repositoryKey].id + 1 }
        : { default_branch: "renamed-default" }),
    };
    process.env.FAKE_GH_RESPONSES = JSON.stringify(responses);
  }
  if (
    mode === "removal-origin-drift-after-quarantine-rename" &&
    String(from) === bridgePath
  ) {
    execFileSync(
      "git",
      [
        "-C",
        targetRoot,
        "remote",
        "set-url",
        "origin",
        "https://github.com/Joey-Tools/replaced-consumer.git",
      ],
      { stdio: "inherit" },
    );
  }
  if (
    mode === "removal-origin-drift-after-codeowners" &&
    String(to) === join(targetRoot, ".github", "CODEOWNERS")
  ) {
    execFileSync(
      "git",
      [
        "-C",
        targetRoot,
        "remote",
        "set-url",
        "origin",
        "https://github.com/Joey-Tools/replaced-consumer.git",
      ],
      { stdio: "inherit" },
    );
  }
  if (
    mode === "removal-origin-drift-after-controller" &&
    String(to) === join(
      targetRoot,
      ".github",
      "workflows",
      "codex-review-gate-controller.yml",
    )
  ) {
    execFileSync(
      "git",
      [
        "-C",
        targetRoot,
        "remote",
        "set-url",
        "origin",
        "https://github.com/Joey-Tools/replaced-consumer.git",
      ],
      { stdio: "inherit" },
    );
  }
  if (mode === "final-boundary" && renameCount === 3) {
    await originalWriteFile(
      join(targetRoot, ".github", "workflows", "attacker.yml"),
      "permissions:\\n  statuses: write\\njobs: {}\\n",
      "utf8",
    );
  }
  return result;
};

promises.unlink = async function patchedUnlink(path, ...args) {
  if (basename(String(path)) === "canonical-legacy-bridge.yml") {
    recordBridgeMutation("unlink");
  }
  if (
    mode === "removal-unlink-fails" &&
    basename(String(path)) === "canonical-legacy-bridge.yml"
  ) {
    const error = new Error("synthetic quarantine unlink failure");
    error.code = "EACCES";
    throw error;
  }
  const result = await originalUnlink(path, ...args);
  if (
    mode === "removal-post-unlink-checkpoint-fails" &&
    basename(String(path)) === "canonical-legacy-bridge.yml"
  ) {
    fs.chmodSync(join(targetRoot, ".github", "workflows"), 0o700);
  }
  return result;
};

syncBuiltinESMExports();
`;
}
