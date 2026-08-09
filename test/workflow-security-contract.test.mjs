import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const actionRoot = join(repoRoot, "packages/action");
const actionDefinitionPath = join(actionRoot, "action.yml");
const calledWorkflowPath = join(
  actionRoot,
  ".github/workflows/codex-review-gate.yml",
);
const rootCallerWorkflowPath = join(
  repoRoot,
  ".github/workflows/codex-review-gate.yml",
);
const templateWorkflowPath = join(
  repoRoot,
  "templates/codex-gated-repo/.github/workflows/codex-review-gate.yml",
);

const CANONICAL_ACTION_REPOSITORY = "JoeyTeng/codex-review-gate-action";
const CANONICAL_WORKFLOW_FILE_PATH =
  ".github/workflows/codex-review-gate.yml";
const CANONICAL_CALL =
  `${CANONICAL_ACTION_REPOSITORY}/${CANONICAL_WORKFLOW_FILE_PATH}@v1`;
const CANONICAL_JOB_WORKFLOW_REF =
  `${CANONICAL_ACTION_REPOSITORY}/${CANONICAL_WORKFLOW_FILE_PATH}` +
  "@refs/tags/v1";
const EXPECTED_CALLED_JOB_IF = `
\${{
  (github.event_name != 'schedule' || vars.CODEX_REVIEW_GATE_AUTO_RETRY != 'false') &&
  (github.event_name != 'pull_request_target' ||
    github.event.pull_request.user.login != 'dependabot[bot]') &&
  (github.event_name != 'issue_comment' ||
    github.event.issue.user.login != 'dependabot[bot]') &&
  (github.event_name != 'pull_request_review' ||
    github.event.pull_request.user.login != 'dependabot[bot]') &&
  (github.event_name != 'pull_request_review_comment' ||
    github.event.pull_request.user.login != 'dependabot[bot]') &&
  (github.event_name != 'issue_comment' ||
    (github.event.issue.pull_request &&
      (contains(format(',chatgpt-codex-connector,chatgpt-codex-connector[bot],{0},',
        vars.CODEX_REVIEW_GATE_BOT_LOGINS), format(',{0},', github.event.comment.user.login)) ||
       contains(format(',chatgpt-codex-connector,chatgpt-codex-connector[bot],{0},',
        vars.CODEX_REVIEW_GATE_BOT_LOGINS), format(', {0},', github.event.comment.user.login))))) &&
  (github.event_name != 'pull_request_review' ||
    (vars.CODEX_REVIEW_GATE_EVENT_MODE != 'comment-only' &&
      github.event.pull_request.head.repo.full_name == github.event.pull_request.base.repo.full_name &&
      (contains(format(',chatgpt-codex-connector,chatgpt-codex-connector[bot],{0},',
        vars.CODEX_REVIEW_GATE_BOT_LOGINS), format(',{0},', github.event.review.user.login)) ||
       contains(format(',chatgpt-codex-connector,chatgpt-codex-connector[bot],{0},',
        vars.CODEX_REVIEW_GATE_BOT_LOGINS), format(', {0},', github.event.review.user.login))))) &&
  (github.event_name != 'pull_request_review_comment' ||
    (vars.CODEX_REVIEW_GATE_EVENT_MODE == 'full' &&
      github.event.pull_request.head.repo.full_name == github.event.pull_request.base.repo.full_name &&
      (contains(format(',chatgpt-codex-connector,chatgpt-codex-connector[bot],{0},',
        vars.CODEX_REVIEW_GATE_BOT_LOGINS), format(',{0},', github.event.comment.user.login)) ||
       contains(format(',chatgpt-codex-connector,chatgpt-codex-connector[bot],{0},',
        vars.CODEX_REVIEW_GATE_BOT_LOGINS), format(', {0},', github.event.comment.user.login)))))
}}
`.trim().replace(/\s+/gu, " ");
const CHECKOUT_SHA = "11d5960a326750d5838078e36cf38b85af677262";
const CHECKOUT_TARGET = `actions/checkout@${CHECKOUT_SHA}`;
const CHECKOUT_PATH = ".codex-review-gate-action";
const LOCAL_ACTION = `./${CHECKOUT_PATH}`;

const RECEIPT_OUTPUTS = {
  "producer-receipt-artifact-id": "artifact-id",
  "producer-receipt-artifact-url": "artifact-url",
  "producer-receipt-artifact-digest": "artifact-digest",
};

const CALLER_WORKFLOW_SHA = "1111111111111111111111111111111111111111";
const REUSABLE_V1_TAG_OBJECT_SHA =
  "2222222222222222222222222222222222222222";
const PEELED_V1_RELEASE_COMMIT_SHA =
  "6666666666666666666666666666666666666666";
const NEWER_REUSABLE_V1_TAG_OBJECT_SHA =
  "5555555555555555555555555555555555555555";
const NEWER_PEELED_V1_RELEASE_COMMIT_SHA =
  "7777777777777777777777777777777777777777";
const CURRENT_PR_HEAD_SHA = "3333333333333333333333333333333333333333";
const RUN_EVENT_HEAD_SHA = "4444444444444444444444444444444444444444";

const CANONICAL_CALLER_FIXTURE = `name: Codex Review Gate

on:
  pull_request_target:
    types: [opened, reopened, synchronize, ready_for_review]
  issue_comment:
    types: [created]
  pull_request_review:
    types: [submitted]
  pull_request_review_comment:
    types: [created]
  schedule:
    - cron: "0 */2 * * *"
  workflow_dispatch:
    inputs:
      pull_request:
        description: Pull request number to gate
        required: false
        type: string

permissions:
  contents: read
  issues: write
  pull-requests: write
  statuses: write

concurrency:
  group: codex-review-gate-\${{ github.repository }}
  cancel-in-progress: false

jobs:
  codex-review-gate:
    name: codex/review-gate runner
    uses: ${CANONICAL_CALL}
`;

test("caller workflows preserve the exact event, permission, and concurrency contract", () => {
  const fixtures = [
    ["canonical caller", yamlLines(CANONICAL_CALLER_FIXTURE)],
    ["activated source caller", readYamlLines(rootCallerWorkflowPath)],
    ["activated template caller", readYamlLines(templateWorkflowPath)],
  ];

  for (const [name, lines] of fixtures) {
    assertCallerEnvelope(lines, name);
  }
});

test("the canonical caller fixture contains only one non-escalating v1 reusable-workflow job", () => {
  const lines = yamlLines(CANONICAL_CALLER_FIXTURE);
  const jobs = childBlock(rootBlock(lines), "jobs");
  assert.deepEqual(directKeys(jobs), ["codex-review-gate"]);

  const job = childBlock(jobs, "codex-review-gate");
  assert.deepEqual(directKeys(job), ["name", "uses"]);
  assert.equal(directScalar(job, "name"), "codex/review-gate runner");
  assert.equal(directScalar(job, "uses"), CANONICAL_CALL);

  assert.doesNotMatch(CANONICAL_CALLER_FIXTURE, /secrets:\s*inherit/);
});

test("the activated source and template callers contain only the canonical reusable job", () => {
  for (const path of [rootCallerWorkflowPath, templateWorkflowPath]) {
    const caller = readYamlLines(path);
    const jobs = childBlock(rootBlock(caller), "jobs");
    assert.deepEqual(directKeys(jobs), ["codex-review-gate"]);

    const job = childBlock(jobs, "codex-review-gate");
    assert.deepEqual(directKeys(job), ["name", "uses"]);
    assert.equal(directScalar(job, "name"), "codex/review-gate runner");
    assert.equal(directScalar(job, "uses"), CANONICAL_CALL);
    assert.doesNotMatch(blockText(job), /\b(?:runs-on|steps|secrets|with):/u);
  }
});

test("the published workflow source is workflow_call-only and preserves receipt outputs", () => {
  assert.equal(
    relative(actionRoot, calledWorkflowPath),
    CANONICAL_WORKFLOW_FILE_PATH,
    "the subtree split must publish the called workflow at its canonical path",
  );

  const called = readYamlLines(calledWorkflowPath);
  assert.deepEqual(directKeys(rootBlock(called)), ["name", "on", "jobs"]);

  const on = childBlock(rootBlock(called), "on");
  assert.deepEqual(directKeys(on), ["workflow_call"]);
  const workflowCall = childBlock(on, "workflow_call");
  assert.deepEqual(directKeys(workflowCall), ["outputs"]);
  const workflowOutputs = childBlock(workflowCall, "outputs");
  assert.deepEqual(directKeys(workflowOutputs), Object.keys(RECEIPT_OUTPUTS));

  const jobs = childBlock(rootBlock(called), "jobs");
  assert.deepEqual(directKeys(jobs), ["codex-review-gate"]);
  const job = childBlock(jobs, "codex-review-gate");
  assert.deepEqual(directKeys(job), [
    "name",
    "if",
    "runs-on",
    "timeout-minutes",
    "outputs",
    "steps",
  ]);
  assert.equal(directFoldedScalar(job, "if"), EXPECTED_CALLED_JOB_IF);
  assert.doesNotMatch(blockText(job), /^\s+(?:permissions|secrets):/m);
  const runner = directScalar(job, "runs-on");
  assert.equal(
    runner,
    "ubuntu-slim",
    "the reusable producer must run on the GitHub-hosted canary runner",
  );
  assert.doesNotMatch(
    runner,
    /\$\{\{|\b(?:vars|inputs|matrix)\./u,
    "caller-controlled contexts must not select the reusable producer runner",
  );

  const jobOutputs = childBlock(job, "outputs");
  assert.deepEqual(directKeys(jobOutputs), Object.keys(RECEIPT_OUTPUTS));
  const action = readYamlLines(actionDefinitionPath);
  const actionOutputs = childBlock(rootBlock(action), "outputs");
  assert.deepEqual(directKeys(actionOutputs), Object.keys(RECEIPT_OUTPUTS));

  for (const [name, uploadOutput] of Object.entries(RECEIPT_OUTPUTS)) {
    assert.equal(
      directScalar(childBlock(workflowOutputs, name), "value"),
      `\${{ jobs.codex-review-gate.outputs.${name} }}`,
    );
    assert.equal(
      directScalar(jobOutputs, name),
      `\${{ steps.gate.outputs.${name} }}`,
    );
    assert.equal(
      directScalar(childBlock(actionOutputs, name), "value"),
      `\${{ steps.upload-producer-receipt.outputs.${uploadOutput} }}`,
    );
  }
});

test("the called workflow checks out only its exact resolved release and runs it locally", () => {
  const lines = readYamlLines(calledWorkflowPath);
  const job = childBlock(
    childBlock(rootBlock(lines), "jobs"),
    "codex-review-gate",
  );
  const steps = childBlock(job, "steps");
  const items = listItemBlocks(steps);

  assert.equal(items.length, 2);
  assert.deepEqual(itemKeys(items[0]), ["name", "id", "uses", "with"]);
  assert.equal(itemScalar(items[0], "id"), "checkout");
  assert.equal(itemScalar(items[0], "uses"), CHECKOUT_TARGET);
  assert.deepEqual(scalarMapping(childBlock(items[0], "with")), {
    repository: "${{ job.workflow_repository }}",
    ref: "${{ job.workflow_sha }}",
    path: CHECKOUT_PATH,
    "persist-credentials": "false",
  });

  assert.deepEqual(
    itemKeys(items[1]),
    ["name", "id", "uses", "env", "with"],
  );
  assert.equal(itemScalar(items[1], "id"), "gate");
  assert.equal(itemScalar(items[1], "uses"), LOCAL_ACTION);
  assert.deepEqual(scalarMapping(childBlock(items[1], "env")), {
    CODEX_REVIEW_GATE_CHECKED_OUT_ACTION_COMMIT_SHA:
      "${{ steps.checkout.outputs.commit }}",
  });
  assert.equal(
    scalarMapping(childBlock(items[1], "with"))["github-token"],
    "${{ github.token }}",
  );
  assert.doesNotMatch(blockText(job), /\bsecrets\./u);

  const checkout = blockText(items[0]);
  assert.doesNotMatch(
    checkout,
    /github\.(?:repository|sha|workflow_sha|event)|pull_request|refs\/pull/,
    "the called workflow must not check out the caller or pull-request tree",
  );

  const source = readFileSync(calledWorkflowPath, "utf8");
  assert.doesNotMatch(source, /^\s*run:/m);
  assert.doesNotMatch(
    source,
    /\b(?:curl|wget|git\s+clone|gh\s+release\s+download|Invoke-WebRequest)\b/i,
  );
});

test("every external source action is pinned to one literal lower-case full SHA", () => {
  const files = [
    ...yamlFilesBelow(join(repoRoot, ".github/workflows")),
    ...yamlFilesBelow(join(actionRoot, ".github/workflows")),
    actionDefinitionPath,
    templateWorkflowPath,
  ];
  let externalUseCount = 0;
  let canonicalCallerUseCount = 0;

  for (const path of [...new Set(files)]) {
    const label = relative(repoRoot, path);
    for (const target of usesTargets(readFileSync(path, "utf8"), label)) {
      assert.doesNotMatch(target, /\$\{\{/u, `${path}: uses cannot be dynamic`);
      if (target.startsWith("./")) {
        continue;
      }
      if (
        (path === rootCallerWorkflowPath || path === templateWorkflowPath) &&
        target === CANONICAL_CALL
      ) {
        canonicalCallerUseCount += 1;
        continue;
      }

      externalUseCount += 1;
      assert.match(
        target,
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_./-]+)?@[0-9a-f]{40}$/u,
        `${path}: external uses must be pinned to a literal lower-case 40-SHA`,
      );
      if (target.startsWith("actions/checkout@")) {
        assert.equal(target, CHECKOUT_TARGET, `${path}: unexpected checkout pin`);
      }
    }
  }

  assert.ok(externalUseCount > 0, "the pin scan must exercise external actions");
  assert.equal(
    canonicalCallerUseCount,
    2,
    "only the source and template callers may use the canonical floating selector",
  );
});

test("the source action scanner rejects non-canonical YAML uses forms", async (t) => {
  const target =
    "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020";
  const scenarios = [
    {
      name: "double-quoted mapping key",
      source: `steps:\n  - "uses": ${target}\n`,
      pattern: /quoted YAML mapping key/u,
    },
    {
      name: "single-quoted mapping key",
      source: `steps:\n  - 'uses': ${target}\n`,
      pattern: /quoted YAML mapping key/u,
    },
    {
      name: "flow mapping",
      source: `steps:\n  - { uses: ${target} }\n`,
      pattern: /non-canonical uses mapping/u,
    },
    {
      name: "flow sequence mapping",
      source: `steps:\n  - [uses: ${target}]\n`,
      pattern: /non-canonical uses mapping/u,
    },
    {
      name: "explicit mapping key",
      source: `steps:\n  - ? uses\n    : ${target}\n`,
      pattern: /explicit YAML mapping key/u,
    },
    {
      name: "tagged mapping key",
      source: `steps:\n  - !!str uses: ${target}\n`,
      pattern: /tagged YAML uses mapping/u,
    },
    {
      name: "tagged mapping value",
      source: `steps:\n  - uses: !!str ${target}\n`,
      pattern: /tagged YAML uses mapping/u,
    },
    {
      name: "tag-handle mapping key",
      source: `steps:\n  - !gate!string uses: ${target}\n`,
      pattern: /tagged YAML uses mapping/u,
    },
    {
      name: "folded scalar value",
      source: `steps:\n  - uses: >-\n      ${target}\n`,
      pattern: /canonical single-line scalar/u,
    },
    {
      name: "spaced key separator",
      source: `steps:\n  - uses : ${target}\n`,
      pattern: /canonical block mapping syntax/u,
    },
    {
      name: "anchor",
      source: `steps:\n  - &external-step\n    uses: ${target}\n`,
      pattern: /YAML anchor, alias, or merge key/u,
    },
    {
      name: "alias",
      source: "steps:\n  - *external-step\n",
      pattern: /YAML anchor, alias, or merge key/u,
    },
    {
      name: "merge key",
      source: "steps:\n  - <<: *external-step\n",
      pattern: /YAML anchor, alias, or merge key/u,
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, () => {
      assert.throws(
        () => usesTargets(scenario.source, scenario.name),
        scenario.pattern,
      );
    });
  }
});

test("the source action scanner ignores syntax-like block scalar and comment text", () => {
  const target =
    "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020";
  const source = `steps:
  - uses: ${target}
  - run: |
      echo '- "uses": attacker/action@main'
      echo '*external-step'
  # - { uses: attacker/action@main }
`;

  assert.deepEqual(usesTargets(source, "block scalar fixture"), [target]);
});

test("the composite captures caller and called workflow identities from distinct contexts", () => {
  const action = readYamlLines(actionDefinitionPath);
  const runs = childBlock(rootBlock(action), "runs");
  const steps = childBlock(runs, "steps");
  const gateStep = listItemBlocks(steps)[0];
  const env = scalarMapping(childBlock(gateStep, "env"));

  assert.equal(itemScalar(gateStep, "shell"), "bash");
  assert.equal(
    itemScalar(gateStep, "run"),
    'node "$GITHUB_ACTION_PATH/src/gate.mjs"',
  );

  assert.equal(
    env.CODEX_REVIEW_GATE_WORKFLOW_REF,
    "${{ github.workflow_ref }}",
  );
  assert.equal(
    env.CODEX_REVIEW_GATE_WORKFLOW_SHA,
    "${{ github.workflow_sha }}",
  );
  assert.equal(
    env.CODEX_REVIEW_GATE_JOB_WORKFLOW_REF,
    "${{ job.workflow_ref }}",
  );
  assert.equal(
    env.CODEX_REVIEW_GATE_JOB_WORKFLOW_SHA,
    "${{ job.workflow_sha }}",
  );
  assert.equal(
    env.CODEX_REVIEW_GATE_JOB_WORKFLOW_REPOSITORY,
    "${{ job.workflow_repository }}",
  );
  assert.equal(
    env.CODEX_REVIEW_GATE_JOB_WORKFLOW_FILE_PATH,
    "${{ job.workflow_file_path }}",
  );
  assert.equal(
    Object.hasOwn(
      env,
      "CODEX_REVIEW_GATE_CHECKED_OUT_ACTION_COMMIT_SHA",
    ),
    false,
    "the composite must receive the checkout commit only from the called workflow step",
  );
});

test("the canonical v1 canary binds W to the tag object and C to the peeled checkout commit", () => {
  const fixture = canonicalProvenanceFixture();
  const selected = validateReferencedWorkflow(
    fixture.receipt.producer.job,
    fixture.runAttempt,
  );

  assert.equal(
    fixture.receipt.producer.job.workflow_ref,
    CANONICAL_JOB_WORKFLOW_REF,
  );
  assert.equal(selected.path, CANONICAL_CALL);
  assert.equal(selected.ref, "refs/tags/v1");
  assert.equal(
    fixture.receipt.producer.job.workflow_sha,
    REUSABLE_V1_TAG_OBJECT_SHA,
  );
  assert.equal(selected.sha, REUSABLE_V1_TAG_OBJECT_SHA);
  assert.equal(fixture.receipt.producer.action.ref, REUSABLE_V1_TAG_OBJECT_SHA);
  assert.equal(
    fixture.receipt.producer.action.commit_sha,
    PEELED_V1_RELEASE_COMMIT_SHA,
  );
  assert.notEqual(
    fixture.receipt.producer.action.ref,
    fixture.receipt.producer.action.commit_sha,
  );
});

test("a future canonical workflow remains valid when GitHub reports W equal to C", () => {
  const fixture = canonicalProvenanceFixture({
    workflowSha: PEELED_V1_RELEASE_COMMIT_SHA,
    actionCommitSha: PEELED_V1_RELEASE_COMMIT_SHA,
  });

  assert.doesNotThrow(() => validateProvenanceShaDomains(fixture));
  assert.equal(
    fixture.receipt.producer.action.ref,
    fixture.receipt.producer.action.commit_sha,
  );
});

test("referenced_workflows selects exactly one canonical called-workflow entry", async (t) => {
  const fixture = canonicalProvenanceFixture();
  const selected = validateReferencedWorkflow(
    fixture.receipt.producer.job,
    fixture.runAttempt,
  );
  assert.deepEqual(selected, fixture.runAttempt.referenced_workflows[0]);

  const scenarios = [
    {
      name: "wrong job repository",
      mutate(candidate) {
        candidate.receipt.producer.job.workflow_repository =
          "attacker/codex-review-gate-action";
      },
    },
    {
      name: "wrong job workflow path",
      mutate(candidate) {
        candidate.receipt.producer.job.workflow_file_path =
          ".github/workflows/other.yml";
      },
    },
    {
      name: "wrong job workflow ref",
      mutate(candidate) {
        candidate.receipt.producer.job.workflow_ref =
          `${CANONICAL_ACTION_REPOSITORY}/${CANONICAL_WORKFLOW_FILE_PATH}` +
          "@refs/heads/v1";
      },
    },
    {
      name: "wrong referenced repository",
      mutate(candidate) {
        candidate.runAttempt.referenced_workflows[0].path =
          `attacker/codex-review-gate-action/${CANONICAL_WORKFLOW_FILE_PATH}@v1`;
      },
    },
    {
      name: "wrong referenced workflow path",
      mutate(candidate) {
        candidate.runAttempt.referenced_workflows[0].path =
          `${CANONICAL_ACTION_REPOSITORY}/.github/workflows/other.yml@v1`;
      },
    },
    {
      name: "wrong referenced selector",
      mutate(candidate) {
        candidate.runAttempt.referenced_workflows[0].path =
          `${CANONICAL_ACTION_REPOSITORY}/${CANONICAL_WORKFLOW_FILE_PATH}@v1.5`;
      },
    },
    {
      name: "wrong referenced ref",
      mutate(candidate) {
        candidate.runAttempt.referenced_workflows[0].ref = "refs/heads/v1";
      },
    },
    {
      name: "wrong referenced SHA",
      mutate(candidate) {
        candidate.runAttempt.referenced_workflows[0].sha = CALLER_WORKFLOW_SHA;
      },
    },
    {
      name: "malformed called-workflow SHA",
      mutate(candidate) {
        candidate.receipt.producer.job.workflow_sha =
          REUSABLE_V1_TAG_OBJECT_SHA.slice(0, -1);
      },
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, () => {
      const candidate = structuredClone(fixture);
      scenario.mutate(candidate);
      assert.throws(
        () =>
          validateReferencedWorkflow(
            candidate.receipt.producer.job,
            candidate.runAttempt,
          ),
        /called workflow|referenced_workflows/,
      );
    });
  }
});

test("referenced_workflows fails closed when canonical evidence is missing or duplicated", async (t) => {
  const scenarios = [
    ["missing field", undefined],
    ["nullable field", null],
    ["empty array", []],
    [
      "unrelated sibling only",
      [
        {
          path: "owner/consumer/.github/workflows/sibling.yml@master",
          sha: RUN_EVENT_HEAD_SHA,
          ref: "refs/heads/master",
        },
      ],
    ],
    [
      "duplicate canonical entries",
      [
        canonicalReferencedWorkflow(),
        canonicalReferencedWorkflow(),
      ],
    ],
  ];

  for (const [name, referencedWorkflows] of scenarios) {
    await t.test(name, () => {
      const fixture = canonicalProvenanceFixture();
      if (referencedWorkflows === undefined) {
        delete fixture.runAttempt.referenced_workflows;
      } else {
        fixture.runAttempt.referenced_workflows = referencedWorkflows;
      }
      assert.throws(
        () =>
          validateReferencedWorkflow(
            fixture.receipt.producer.job,
            fixture.runAttempt,
          ),
        /referenced_workflows/,
      );
    });
  }
});

test("caller workflow, called workflow, run head, and PR status SHA roles stay separate", () => {
  const fixture = canonicalProvenanceFixture();
  assert.equal(new Set([
    fixture.receipt.producer.environment.GITHUB_WORKFLOW_SHA,
    fixture.receipt.producer.job.workflow_sha,
    fixture.runAttempt.head_sha,
    fixture.currentPullRequest.head.sha,
    PEELED_V1_RELEASE_COMMIT_SHA,
  ]).size, 5);

  assert.doesNotThrow(() => validateProvenanceShaDomains(fixture));
  assert.equal(
    fixture.receipt.producer.environment.GITHUB_WORKFLOW_SHA,
    CALLER_WORKFLOW_SHA,
  );
  assert.equal(
    fixture.runAttempt.referenced_workflows[0].sha,
    REUSABLE_V1_TAG_OBJECT_SHA,
  );
  assert.equal(
    fixture.receipt.producer.action.commit_sha,
    PEELED_V1_RELEASE_COMMIT_SHA,
  );
  assert.equal(fixture.receipt.statuses[0].head_sha, CURRENT_PR_HEAD_SHA);
  assert.equal(fixture.runAttempt.head_sha, RUN_EVENT_HEAD_SHA);
  assert.equal(Object.hasOwn(fixture.runAttempt, "workflow_sha"), false);
  assert.notEqual(
    fixture.receipt.producer.environment.GITHUB_WORKFLOW_REF,
    fixture.receipt.producer.job.workflow_ref,
  );

  const wrongStatusHead = structuredClone(fixture);
  wrongStatusHead.receipt.statuses[0].head_sha = RUN_EVENT_HEAD_SHA;
  assert.throws(
    () => validateProvenanceShaDomains(wrongStatusHead),
    /current PR head/,
  );
});

test("rerun validation uses the receipt's exact run attempt", async (t) => {
  const scenarios = [
    {
      name: "different run id",
      mutate(candidate) {
        candidate.runAttempt.id += 1;
      },
    },
    {
      name: "different rerun attempt",
      mutate(candidate) {
        candidate.runAttempt.run_attempt += 1;
      },
    },
    {
      name: "different run repository",
      mutate(candidate) {
        candidate.runAttempt.repository.full_name = "owner/other";
      },
    },
    {
      name: "newer attempt tag resolution",
      mutate(candidate) {
        candidate.runAttempt.run_attempt += 1;
        candidate.runAttempt.referenced_workflows[0].sha =
          "5555555555555555555555555555555555555555";
      },
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, () => {
      const fixture = canonicalProvenanceFixture();
      scenario.mutate(fixture);
      assert.throws(() => validateProvenanceShaDomains(fixture));
    });
  }
});

test("reruns accept only attempt-local all-field rebinding of the v1 tag object", async (t) => {
  const scenarios = [
    {
      name: "specific-job rerun retains the prior resolved tag object",
      tagObjectSha: REUSABLE_V1_TAG_OBJECT_SHA,
      releaseCommitSha: PEELED_V1_RELEASE_COMMIT_SHA,
    },
    {
      name: "full rerun resolves the floating tag to a newer tag object",
      tagObjectSha: NEWER_REUSABLE_V1_TAG_OBJECT_SHA,
      releaseCommitSha: NEWER_PEELED_V1_RELEASE_COMMIT_SHA,
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, () => {
      const fixture = canonicalProvenanceFixture();
      fixture.receipt.producer.run.attempt = "4";
      fixture.runAttempt.run_attempt = 4;
      fixture.receipt.producer.job.workflow_sha = scenario.tagObjectSha;
      fixture.receipt.producer.action.ref = scenario.tagObjectSha;
      fixture.receipt.producer.action.commit_sha = scenario.releaseCommitSha;
      fixture.expectedActionCommitSha = scenario.releaseCommitSha;
      fixture.runAttempt.referenced_workflows[0].sha = scenario.tagObjectSha;

      assert.doesNotThrow(() => validateProvenanceShaDomains(fixture));
      assert.equal(
        fixture.receipt.producer.action.commit_sha,
        scenario.releaseCommitSha,
      );
    });
  }
});

test("canonical receipt action identity cannot cross-bind a different tag or release object", async (t) => {
  const scenarios = [
    {
      name: "wrong action repository",
      mutate(action) {
        action.repository = "attacker/codex-review-gate-action";
      },
    },
    {
      name: "newer tag object cross-paired with the old release commit",
      mutate(action) {
        action.ref = NEWER_REUSABLE_V1_TAG_OBJECT_SHA;
      },
    },
    {
      name: "older tag object cross-paired with the newer release commit",
      mutate(action) {
        action.commit_sha = NEWER_PEELED_V1_RELEASE_COMMIT_SHA;
      },
    },
    {
      name: "tag object substituted for the peeled release commit",
      mutate(action) {
        action.commit_sha = REUSABLE_V1_TAG_OBJECT_SHA;
      },
    },
    {
      name: "immutable flag cleared",
      mutate(action) {
        action.immutable = false;
      },
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, () => {
      const fixture = canonicalProvenanceFixture();
      scenario.mutate(fixture.receipt.producer.action);
      assert.throws(
        () => validateProvenanceShaDomains(fixture),
        /action identity/,
      );
    });
  }
});

test("run-level referenced_workflows corroboration does not claim a job binding", () => {
  const fixture = canonicalProvenanceFixture();
  fixture.runAttempt.referenced_workflows.push({
    path: "owner/consumer/.github/workflows/sibling.yml@master",
    sha: RUN_EVENT_HEAD_SHA,
    ref: "refs/heads/master",
  });

  const selected = validateReferencedWorkflow(
    fixture.receipt.producer.job,
    fixture.runAttempt,
  );
  assert.equal(selected.path, CANONICAL_CALL);
  assert.equal(Object.hasOwn(selected, "job_id"), false);

  const boundary = referencedWorkflowAuthority(selected);
  assert.deepEqual(boundary, {
    scope: "run-attempt",
    corroboratesResolvedWorkflow: true,
    bindsSpecificJob: false,
    cryptographicallyBindsReceipt: false,
  });

  const directSiblingContext = {
    github: {
      workflow_ref:
        "owner/consumer/.github/workflows/codex-review-gate.yml@refs/heads/master",
      workflow_sha: CALLER_WORKFLOW_SHA,
    },
    job: {
      workflow_ref:
        "owner/consumer/.github/workflows/codex-review-gate.yml@refs/heads/master",
      workflow_sha: CALLER_WORKFLOW_SHA,
      workflow_repository: "owner/consumer",
      workflow_file_path: ".github/workflows/codex-review-gate.yml",
    },
  };
  assert.equal(
    directSiblingContext.job.workflow_ref,
    directSiblingContext.github.workflow_ref,
  );
  assert.equal(
    directSiblingContext.job.workflow_sha,
    directSiblingContext.github.workflow_sha,
  );
  assert.notEqual(directSiblingContext.job.workflow_sha, selected.sha);
  assert.throws(
    () =>
      validateReferencedWorkflow(directSiblingContext.job, fixture.runAttempt),
    /called workflow/,
    "a run-level sibling entry cannot upgrade a direct job into the canonical called job",
  );
});

function canonicalProvenanceFixture({
  workflowSha = REUSABLE_V1_TAG_OBJECT_SHA,
  actionCommitSha = PEELED_V1_RELEASE_COMMIT_SHA,
} = {}) {
  return {
    expectedActionCommitSha: actionCommitSha,
    receipt: {
      producer: {
        repository: "owner/consumer",
        run: { id: "24680", attempt: "3" },
        environment: {
          GITHUB_WORKFLOW_REF:
            "owner/consumer/.github/workflows/codex-review-gate.yml@refs/heads/master",
          GITHUB_WORKFLOW_SHA: CALLER_WORKFLOW_SHA,
        },
        job: {
          workflow_ref: CANONICAL_JOB_WORKFLOW_REF,
          workflow_sha: workflowSha,
          workflow_repository: CANONICAL_ACTION_REPOSITORY,
          workflow_file_path: CANONICAL_WORKFLOW_FILE_PATH,
        },
        action: {
          repository: CANONICAL_ACTION_REPOSITORY,
          ref: workflowSha,
          commit_sha: actionCommitSha,
          immutable: true,
        },
      },
      statuses: [
        {
          id: "9001",
          node_id: "SC_status9001",
          pull_request_number: 17,
          head_sha: CURRENT_PR_HEAD_SHA,
        },
      ],
    },
    runAttempt: {
      id: 24680,
      run_attempt: 3,
      head_sha: RUN_EVENT_HEAD_SHA,
      repository: { full_name: "owner/consumer" },
      referenced_workflows: [canonicalReferencedWorkflow(workflowSha)],
    },
    currentPullRequest: {
      number: 17,
      head: { sha: CURRENT_PR_HEAD_SHA },
    },
    restStatus: {
      id: 9001,
      node_id: "SC_status9001",
      commit_sha: CURRENT_PR_HEAD_SHA,
    },
    graphQlStatus: {
      id: "SC_status9001",
      commit: { oid: CURRENT_PR_HEAD_SHA },
    },
  };
}

function assertCallerEnvelope(lines, message) {
  const root = rootBlock(lines);
  assert.deepEqual(
    directKeys(root),
    ["name", "on", "permissions", "concurrency", "jobs"],
    message,
  );

  const on = childBlock(root, "on");
  assert.deepEqual(directKeys(on), [
    "pull_request_target",
    "issue_comment",
    "pull_request_review",
    "pull_request_review_comment",
    "schedule",
    "workflow_dispatch",
  ], message);
  assert.deepEqual(
    inlineList(directScalar(childBlock(on, "pull_request_target"), "types")),
    ["opened", "reopened", "synchronize", "ready_for_review"],
    message,
  );
  assert.deepEqual(
    inlineList(directScalar(childBlock(on, "issue_comment"), "types")),
    ["created"],
    message,
  );
  assert.deepEqual(
    inlineList(directScalar(childBlock(on, "pull_request_review"), "types")),
    ["submitted"],
    message,
  );
  assert.deepEqual(
    inlineList(
      directScalar(childBlock(on, "pull_request_review_comment"), "types"),
    ),
    ["created"],
    message,
  );
  assert.deepEqual(
    listScalars(childBlock(on, "schedule"), "cron"),
    ["\"0 */2 * * *\""],
    message,
  );

  const workflowDispatch = childBlock(on, "workflow_dispatch");
  assert.deepEqual(directKeys(workflowDispatch), ["inputs"], message);
  const pullRequestInput = childBlock(
    childBlock(workflowDispatch, "inputs"),
    "pull_request",
  );
  assert.equal(directScalar(pullRequestInput, "required"), "false", message);
  assert.equal(directScalar(pullRequestInput, "type"), "string", message);

  assert.deepEqual(scalarMapping(childBlock(root, "permissions")), {
    contents: "read",
    issues: "write",
    "pull-requests": "write",
    statuses: "write",
  }, message);
  assert.deepEqual(scalarMapping(childBlock(root, "concurrency")), {
    group: "codex-review-gate-${{ github.repository }}",
    "cancel-in-progress": "false",
  }, message);
}

function canonicalReferencedWorkflow(
  workflowSha = REUSABLE_V1_TAG_OBJECT_SHA,
) {
  return {
    path: CANONICAL_CALL,
    sha: workflowSha,
    ref: "refs/tags/v1",
  };
}

function validateReferencedWorkflow(job, runAttempt) {
  assert.equal(
    job.workflow_repository,
    CANONICAL_ACTION_REPOSITORY,
    "called workflow repository mismatch",
  );
  assert.equal(
    job.workflow_file_path,
    CANONICAL_WORKFLOW_FILE_PATH,
    "called workflow file path mismatch",
  );
  assert.equal(
    job.workflow_ref,
    CANONICAL_JOB_WORKFLOW_REF,
    "called workflow ref mismatch",
  );
  assert.match(
    job.workflow_sha,
    /^[0-9a-f]{40}$/u,
    "called workflow SHA must be a lower-case full SHA",
  );
  assert.ok(
    Array.isArray(runAttempt.referenced_workflows),
    "referenced_workflows must be a non-null array",
  );

  const candidates = runAttempt.referenced_workflows.filter(
    (entry) => entry?.path === CANONICAL_CALL,
  );
  assert.equal(
    candidates.length,
    1,
    "referenced_workflows must contain exactly one canonical entry",
  );
  const selected = candidates[0];
  assert.equal(
    selected.ref,
    "refs/tags/v1",
    "referenced_workflows ref mismatch",
  );
  assert.equal(
    selected.sha,
    job.workflow_sha,
    "referenced_workflows SHA must match the called workflow SHA",
  );
  return selected;
}

function validateProvenanceShaDomains(fixture) {
  const { receipt, runAttempt, currentPullRequest, restStatus, graphQlStatus } =
    fixture;
  assert.equal(String(runAttempt.id), receipt.producer.run.id);
  assert.equal(String(runAttempt.run_attempt), receipt.producer.run.attempt);
  assert.equal(
    runAttempt.repository.full_name,
    receipt.producer.repository,
  );
  assert.match(
    receipt.producer.environment.GITHUB_WORKFLOW_SHA,
    /^[0-9a-f]{40}$/u,
  );
  const referencedWorkflow = validateReferencedWorkflow(
    receipt.producer.job,
    runAttempt,
  );
  assert.deepEqual(
    receipt.producer.action,
    {
      repository: CANONICAL_ACTION_REPOSITORY,
      ref: referencedWorkflow.sha,
      commit_sha: fixture.expectedActionCommitSha,
      immutable: true,
    },
    "canonical reusable receipt action identity must bind W and C independently",
  );

  const statusMembers = receipt.statuses.filter(
    (status) =>
      status.pull_request_number === currentPullRequest.number &&
      String(status.id) === String(restStatus.id) &&
      status.node_id === restStatus.node_id,
  );
  assert.equal(statusMembers.length, 1, "status membership must be unique");
  assert.equal(
    statusMembers[0].head_sha,
    currentPullRequest.head.sha,
    "receipt status must bind the current PR head",
  );
  assert.equal(
    restStatus.commit_sha,
    currentPullRequest.head.sha,
    "REST status must bind the current PR head",
  );
  assert.equal(graphQlStatus.id, restStatus.node_id);
  assert.equal(
    graphQlStatus.commit.oid,
    currentPullRequest.head.sha,
    "GraphQL status must bind the current PR head",
  );

  // The run-attempt head is event/run identity. GitHub does not expose a
  // workflow-file SHA field in this response, so it is deliberately not
  // compared with either workflow SHA or the current PR/status SHA.
  assert.match(runAttempt.head_sha, /^[0-9a-f]{40}$/u);
}

function referencedWorkflowAuthority(selected) {
  assert.equal(selected.path, CANONICAL_CALL);
  return {
    scope: "run-attempt",
    corroboratesResolvedWorkflow: true,
    bindsSpecificJob: false,
    cryptographicallyBindsReceipt: false,
  };
}

function readYamlLines(path) {
  return yamlLines(readFileSync(path, "utf8"));
}

function yamlLines(source) {
  return source.split(/\r?\n/u);
}

function rootBlock(lines) {
  return { lines, headerIndent: -2, start: 0, end: lines.length };
}

function childBlock(parent, key) {
  const expectedIndent = parent.headerIndent + 2;
  const index = findDirectKeyIndex(parent, key);
  const line = parent.lines[index];
  assert.match(
    line,
    new RegExp(`^ {${expectedIndent}}${escapeRegExp(key)}:\\s*(?:#.*)?$`, "u"),
    `${key} must introduce a mapping block`,
  );

  let end = parent.end;
  for (let cursor = index + 1; cursor < parent.end; cursor += 1) {
    if (isIgnorable(parent.lines[cursor])) {
      continue;
    }
    if (indentOf(parent.lines[cursor]) <= expectedIndent) {
      end = cursor;
      break;
    }
  }
  return {
    lines: parent.lines,
    headerIndent: expectedIndent,
    start: index + 1,
    end,
  };
}

function directKeys(block) {
  const expectedIndent = block.headerIndent + 2;
  const keys = [];
  for (let index = block.start; index < block.end; index += 1) {
    const match = block.lines[index].match(
      new RegExp(`^ {${expectedIndent}}([A-Za-z0-9_-]+):(?:\\s|$)`, "u"),
    );
    if (match) {
      keys.push(match[1]);
    }
  }
  return keys;
}

function directScalar(block, key) {
  const index = findDirectKeyIndex(block, key);
  const expectedIndent = block.headerIndent + 2;
  const match = block.lines[index].match(
    new RegExp(
      `^ {${expectedIndent}}${escapeRegExp(key)}:\\s*(.*?)\\s*(?:#.*)?$`,
      "u",
    ),
  );
  assert.ok(match, `missing scalar ${key}`);
  assert.notEqual(match[1], "", `${key} must be a scalar`);
  return match[1];
}

function directFoldedScalar(block, key) {
  const index = findDirectKeyIndex(block, key);
  const expectedIndent = block.headerIndent + 2;
  assert.match(
    block.lines[index],
    new RegExp(`^ {${expectedIndent}}${escapeRegExp(key)}:\\s*>-\\s*$`, "u"),
  );

  let end = block.end;
  const nextKeyPattern = new RegExp(
    `^ {${expectedIndent}}[A-Za-z0-9_-]+:(?:\\s|$)`,
    "u",
  );
  for (let cursor = index + 1; cursor < block.end; cursor += 1) {
    if (nextKeyPattern.test(block.lines[cursor])) {
      end = cursor;
      break;
    }
  }

  const valueLines = block.lines.slice(index + 1, end);
  assert.ok(valueLines.length > 0, `${key} must have a folded scalar body`);
  for (const line of valueLines) {
    assert.ok(
      line.trim() === "" || line.startsWith(" ".repeat(expectedIndent + 2)),
      `${key} folded scalar must remain nested under its direct key`,
    );
  }
  return valueLines.join("\n").trim().replace(/\s+/gu, " ");
}

function scalarMapping(block) {
  return Object.fromEntries(
    directKeys(block).map((key) => [key, directScalar(block, key)]),
  );
}

function findDirectKeyIndex(block, key) {
  const expectedIndent = block.headerIndent + 2;
  const pattern = new RegExp(
    `^ {${expectedIndent}}${escapeRegExp(key)}:(?:\\s|$)`,
    "u",
  );
  const matches = [];
  for (let index = block.start; index < block.end; index += 1) {
    if (pattern.test(block.lines[index])) {
      matches.push(index);
    }
  }
  assert.equal(matches.length, 1, `expected exactly one direct ${key} key`);
  return matches[0];
}

function inlineList(value) {
  assert.match(value, /^\[.*\]$/u);
  return value
    .slice(1, -1)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function listScalars(block, key) {
  const expectedIndent = block.headerIndent + 2;
  const pattern = new RegExp(
    `^ {${expectedIndent}}-\\s+${escapeRegExp(key)}:\\s*(.*?)\\s*(?:#.*)?$`,
    "u",
  );
  return block.lines
    .slice(block.start, block.end)
    .map((line) => line.match(pattern)?.[1])
    .filter((value) => value !== undefined);
}

function listItemBlocks(block) {
  const itemIndent = block.headerIndent + 2;
  const itemStarts = [];
  const pattern = new RegExp(`^ {${itemIndent}}-\\s+[A-Za-z0-9_-]+:`, "u");
  for (let index = block.start; index < block.end; index += 1) {
    if (pattern.test(block.lines[index])) {
      itemStarts.push(index);
    }
  }
  return itemStarts.map((start, offset) => ({
    lines: block.lines,
    headerIndent: itemIndent,
    start,
    end: itemStarts[offset + 1] ?? block.end,
    listItem: true,
  }));
}

function itemKeys(item) {
  const first = item.lines[item.start].match(
    new RegExp(`^ {${item.headerIndent}}-\\s+([A-Za-z0-9_-]+):`, "u"),
  );
  assert.ok(first);
  const keys = [first[1]];
  const childIndent = item.headerIndent + 2;
  const pattern = new RegExp(
    `^ {${childIndent}}([A-Za-z0-9_-]+):(?:\\s|$)`,
    "u",
  );
  for (let index = item.start + 1; index < item.end; index += 1) {
    const match = item.lines[index].match(pattern);
    if (match) {
      keys.push(match[1]);
    }
  }
  return keys;
}

function itemScalar(item, key) {
  const firstPattern = new RegExp(
    `^ {${item.headerIndent}}-\\s+${escapeRegExp(key)}:\\s*(.*?)\\s*(?:#.*)?$`,
    "u",
  );
  const first = item.lines[item.start].match(firstPattern);
  if (first) {
    return first[1];
  }
  return directScalar(
    {
      ...item,
      headerIndent: item.headerIndent,
      start: item.start + 1,
    },
    key,
  );
}

function blockText(block) {
  return block.lines.slice(block.start, block.end).join("\n");
}

function yamlFilesBelow(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...yamlFilesBelow(path));
    } else if (/\.ya?ml$/u.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

function usesTargets(source, label = "YAML source") {
  const targets = [];
  let blockScalarIndent = null;
  const lines = source.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (blockScalarIndent !== null) {
      if (isIgnorable(line) || indentOf(line) > blockScalarIndent) {
        continue;
      }
      blockScalarIndent = null;
    }

    if (isIgnorable(line)) {
      continue;
    }

    assertCanonicalYamlLine(line, label, index + 1);

    const blockScalar = line.match(
      /^( *)(?:-\s+)?([A-Za-z0-9_-]+):\s*[>|][+-]?\s*(?:#.*)?$/u,
    );
    if (blockScalar) {
      if (blockScalar[2] === "uses") {
        throw yamlSyntaxError(
          label,
          index + 1,
          "uses must be one canonical single-line scalar",
        );
      }
      blockScalarIndent = blockScalar[1].length;
      continue;
    }

    if (!/^\s*(?:-\s+)?uses\s*:/u.test(line)) {
      continue;
    }
    const match = /^\s*(?:-\s+)?uses:\s*([^\s#]+)(?:\s+#.*)?$/u.exec(line);
    if (!match) {
      throw yamlSyntaxError(
        label,
        index + 1,
        "uses must use canonical block mapping syntax with one plain scalar",
      );
    }
    targets.push(match[1]);
  }
  return targets;
}

function assertCanonicalYamlLine(line, label, lineNumber) {
  const structural = line.replace(/\s+#.*$/u, "");
  if (
    /(?:^|[\s:[{,])(?:&|\*)[A-Za-z0-9_-]+/u.test(structural) ||
    /(?:^|\s)<<\s*:/u.test(structural)
  ) {
    throw yamlSyntaxError(
      label,
      lineNumber,
      "forbidden YAML anchor, alias, or merge key",
    );
  }
  if (/^\s*(?:-\s+)?\?|[\[,{]\s*\?/u.test(structural)) {
    throw yamlSyntaxError(
      label,
      lineNumber,
      "forbidden explicit YAML mapping key",
    );
  }
  if (
    /(?:^|[\[,{]|-\s+)\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*')\s*:/u.test(
      structural,
    )
  ) {
    throw yamlSyntaxError(
      label,
      lineNumber,
      "forbidden quoted YAML mapping key",
    );
  }

  const tag = "(?:!<[^>\\r\\n]+>|![^\\s\\[\\]{},]+|!)";
  const taggedUsesKey = new RegExp(
    `(?:^|[\\[,{]|-\\s+)\\s*${tag}\\s+(?:uses|"uses"|'uses')\\s*:`,
    "u",
  );
  const taggedUsesValue = new RegExp(
    `^\\s*(?:-\\s+)?uses\\s*:\\s*${tag}(?:\\s|$)`,
    "u",
  );
  if (taggedUsesKey.test(structural) || taggedUsesValue.test(structural)) {
    throw yamlSyntaxError(
      label,
      lineNumber,
      "forbidden tagged YAML uses mapping",
    );
  }

  const canonicalUsesKey = /^\s*(?:-\s+)?uses\s*:/u.test(structural);
  const anyBareUsesKey = /(?:^|[\[,{]|-\s+)\s*uses\s*:/u.test(structural);
  if (anyBareUsesKey && !canonicalUsesKey) {
    throw yamlSyntaxError(
      label,
      lineNumber,
      "forbidden non-canonical uses mapping",
    );
  }
}

function yamlSyntaxError(label, lineNumber, message) {
  return new Error(`${label}:${lineNumber}: ${message}`);
}

function indentOf(line) {
  return line.match(/^ */u)[0].length;
}

function isIgnorable(line) {
  return /^\s*(?:#.*)?$/u.test(line);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
