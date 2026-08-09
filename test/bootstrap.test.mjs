import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_STATUS_CONTEXT,
  DEFAULT_STATUS_INTEGRATION_ID,
  buildCreateRulesetPayload,
  buildUpdateRulesetPayload,
  ensureStatusContextInRules,
  findEffectiveRulesetWithStatusContext,
  normalizeWorkflowPath,
  parseRepoSlug,
  requiredStatusCheckContexts,
  rulesetCoversDefaultBranch,
  rulesetHasRequiredStatusContext,
  workflowContentEndpoint,
} from "../src/bootstrap.mjs";

test("builds a minimal default-branch ruleset payload", () => {
  const payload = buildCreateRulesetPayload();

  assert.equal(payload.name, "Must Pass Codex Review");
  assert.equal(payload.target, "branch");
  assert.equal(payload.enforcement, "active");
  assert.deepEqual(payload.conditions, {
    ref_name: {
      include: ["~DEFAULT_BRANCH"],
      exclude: [],
    },
  });
  assert.deepEqual(payload.rules, [
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: true,
        do_not_enforce_on_create: true,
        required_status_checks: [
          {
            context: DEFAULT_STATUS_CONTEXT,
            integration_id: DEFAULT_STATUS_INTEGRATION_ID,
          },
        ],
      },
    },
  ]);
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
        strict_required_status_checks_policy: false,
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

test("removes codex status source binding when requested", () => {
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

  const { changed, rules } = ensureStatusContextInRules(existingRules, DEFAULT_STATUS_CONTEXT, {
    integrationId: null,
  });

  assert.equal(changed, true);
  assert.deepEqual(rules[0].parameters.required_status_checks, [
    { context: DEFAULT_STATUS_CONTEXT },
  ]);
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
    true,
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

test("builds an active update payload without GitHub read-only fields", () => {
  const { changed, payload } = buildUpdateRulesetPayload({
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
  });

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
    bypass_actors: [
      {
        actor_id: 1,
        actor_type: "RepositoryRole",
        bypass_mode: "always",
      },
    ],
    rules: [
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: true,
          do_not_enforce_on_create: true,
          required_status_checks: [
            { context: "test" },
            {
              context: DEFAULT_STATUS_CONTEXT,
              integration_id: DEFAULT_STATUS_INTEGRATION_ID,
            },
          ],
        },
      },
    ],
  });
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
  assert.equal(payload.enforcement, "active");
  assert.deepEqual(payload.conditions, {
    ref_name: {
      include: ["release/*", "~DEFAULT_BRANCH"],
      exclude: [],
    },
  });
  assert.deepEqual(payload.rules[0].parameters.required_status_checks, [
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
      enforcement: "active",
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
          enforcement: "active",
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
      enforcement: "active",
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
  assert.deepEqual(payload.rules[0].parameters.required_status_checks, [
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

test("canonical template omits inert v1 compatibility controls", () => {
  const workflow = readFileSync(
    new URL(
      "../templates/codex-gated-repo/.github/workflows/codex-review-gate.yml",
      import.meta.url,
    ),
    "utf8",
  );
  const readme = readFileSync(
    new URL("../templates/codex-gated-repo/README.md", import.meta.url),
    "utf8",
  );

  for (const input of [
    "completion-signal-buffer-seconds",
    "failed-findings-recovery",
    "failed-findings-recovery-mode",
  ]) {
    assert.doesNotMatch(workflow, new RegExp(`^\\s+${input}:`, "m"));
  }
  assert.match(readme, /legacy `completion-signal-buffer-seconds`/);
  assert.match(readme, /they are inert/);
});
