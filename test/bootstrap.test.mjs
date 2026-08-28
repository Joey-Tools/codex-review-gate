import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
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
  DEFAULT_STATUS_CONTEXT,
  DEFAULT_STATUS_INTEGRATION_ID,
  DEFAULT_VERIFIER_RUN_NAME,
  DEFAULT_VERIFIER_RUN_NAME_PREFIX,
  DEFAULT_WORKFLOW_PATH,
  LEGACY_STATUS_CONTEXT,
  assertCompleteRulesetApiObject,
  assertDirectoryWitnessStable,
  buildCreateRulesetPayload,
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
  findEffectiveRulesetWithStatusContext,
  installedWorkflowMatchesCanonical,
  normalizeControlPlaneOwner,
  normalizeWorkflowPath,
  parseRepoSlug,
  requiredStatusCheckContexts,
  rulesetCoversDefaultBranch,
  rulesetHasGatePolicy,
  rulesetHasNonFastForwardPolicy,
  rulesetHasRequiredPullRequestPolicy,
  rulesetHasRequiredStatusContext,
  rulesetWritableFingerprint,
  validateCanonicalV2WorkflowContent,
  validateCanonicalV2ControllerWorkflowContent,
  validateCanonicalV2WorkflowInventory,
  validateControlPlaneCodeownersContent,
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
const CANONICAL_WORKFLOWS = {
  verifier: CANONICAL_WORKFLOW,
  controller: CANONICAL_CONTROLLER_WORKFLOW,
};
const DEFAULT_BRANCH_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CANARY_HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";
const CANARY_RUN_ID = 9007;
const CANARY_WORKFLOW_ID = 17;
const CANARY_JOB_ID = 18017;
const CANARY_CHECK_RUN_ID = 28017;
const CANARY_MERGE_SHA = "fedcba9876543210fedcba9876543210fedcba98";
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
          "CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION == 'any' && 'any' || 'write'",
          "CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION == 'any' && 'write' || 'any'",
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
          "github.event.action == 'created' || github.event.action == 'edited'",
          "github.event.action == 'edited' || github.event.action == 'created'",
        ),
      ),
    /job\.if must exactly match/u,
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
        /disabled but not an exact complete staged v2 policy/u,
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
      assert.equal(countLines(activationCalls, inventoryEndpoint), 4, name);
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
      const finalTargetRead = activationLines.lastIndexOf(
        `GET repos/${repoSlug}/rulesets/8`,
        putIndex - 1,
      );
      assert.ok(
        finalCanaryJobs !== -1 &&
          finalCanaryJobs < finalSecurityRepository &&
          finalSecurityRepository < finalSecurityProtection &&
          finalSecurityProtection < finalTargetRead &&
          finalTargetRead < putIndex,
        `${name}: final canary, security, target, and PUT order drifted`,
      );
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
      ...canonicalRemoteWorkflowResponses(repoSlug),
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

function canonicalRemoteWorkflowResponses(repoSlug) {
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
    id: 1234,
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
      repository: { full_name: repoSlug },
      head_repository: { full_name: repoSlug },
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

function canonicalCanaryRunPullRequestFixture(
  repoSlug,
  { baseSha = DEFAULT_BRANCH_SHA } = {},
) {
  return {
    number: 7,
    head: {
      sha: CANARY_HEAD_SHA,
      repo: { full_name: repoSlug },
    },
    base: {
      ref: "master",
      sha: baseSha,
      repo: { full_name: repoSlug },
    },
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
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
if (process.env.FAKE_GH_CALL_LOG) {
  appendFileSync(process.env.FAKE_GH_CALL_LOG, \`\${requestKey}\\n\`, "utf8");
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
const { syncBuiltinESMExports } = require("node:module");

const promises = fs.promises;
const originalWriteFile = promises.writeFile.bind(promises);
const originalRename = promises.rename.bind(promises);
const mode = process.env.CODEX_BOOTSTRAP_TEST_RACE_MODE;
const targetRoot = process.env.CODEX_BOOTSTRAP_TEST_RACE_ROOT;
let injectedBeforeFirstRename = false;
let renameCount = 0;

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
  if (mode === "second-rename-fails" && renameCount === 2) {
    const error = new Error("synthetic second rename failure");
    error.code = "EACCES";
    throw error;
  }
  const result = await originalRename(from, to);
  if (mode === "final-boundary" && renameCount === 3) {
    await originalWriteFile(
      join(targetRoot, ".github", "workflows", "attacker.yml"),
      "permissions:\\n  statuses: write\\njobs: {}\\n",
      "utf8",
    );
  }
  return result;
};

syncBuiltinESMExports();
`;
}
