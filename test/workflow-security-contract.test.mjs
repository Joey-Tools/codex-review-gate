import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const actionPath = join(repoRoot, "packages/action/action.yml");
const sourceConsumerPath = join(
  repoRoot,
  ".github/workflows/codex-review-gate.yml",
);
const templateConsumerPath = join(
  repoRoot,
  "templates/codex-gated-repo/.github/workflows/codex-review-gate.yml",
);
const templateControllerPath = join(
  repoRoot,
  "templates/codex-gated-repo/.github/workflows/codex-review-gate-controller.yml",
);
const templateCodeownersPath = join(
  repoRoot,
  "templates/codex-gated-repo/.github/CODEOWNERS",
);
const templateRulesetPath = join(
  repoRoot,
  "templates/codex-gated-repo/rulesets/codex-review-gate.json",
);
const legacyInventoryHelperPath = join(
  repoRoot,
  "scripts/build-legacy-review-gate-inventory.sh",
);
const legacyInventoryHelper = readFileSync(legacyInventoryHelperPath, "utf8");
const installGuides = Object.fromEntries(
  ["human.md", "human.zh-CN.md", "agent.md", "agent.zh-CN.md"].map((name) => [
    name,
    readFileSync(join(repoRoot, "docs/install", name), "utf8"),
  ]),
);
const rootReadmes = Object.fromEntries(
  ["README.md", "README.zh-CN.md"].map((name) => [
    name,
    readFileSync(join(repoRoot, name), "utf8"),
  ]),
);
const packageDocs = Object.fromEntries(
  [
    "README.md",
    "README.zh-CN.md",
    "SECURITY.md",
    "DESIGN.md",
    "DESIGN.zh-CN.md",
    "COOKBOOK.md",
    "COOKBOOK.zh-CN.md",
  ].map((name) => [
    name,
    readFileSync(join(repoRoot, "packages/action", name), "utf8"),
  ]),
);
const releaseGuides = Object.fromEntries(
  ["RELEASING.md", "RELEASING.zh-CN.md"].map((name) => [
    name,
    readFileSync(join(repoRoot, "docs", name), "utf8"),
  ]),
);
const retiredPackageWorkflowPaths = [
  join(
    repoRoot,
    "packages/action/.github/workflows/codex-review-gate.yml",
  ),
  join(
    repoRoot,
    "packages/action/.github/workflows/codex-review-gate-reconcile.yml",
  ),
];

const action = readFileSync(actionPath, "utf8");
const sourceConsumer = readFileSync(sourceConsumerPath, "utf8");
const templateConsumer = readFileSync(templateConsumerPath, "utf8");
const templateController = readFileSync(templateControllerPath, "utf8");
const templateCodeowners = readFileSync(templateCodeownersPath, "utf8");
const templateRuleset = JSON.parse(readFileSync(templateRulesetPath, "utf8"));
const publisherWorkflow = readFileSync(
  join(repoRoot, ".github/workflows/sync-action-subtree.yml"),
  "utf8",
);

const EXACT_BOT = "chatgpt-codex-connector[bot]";
const MARKETPLACE_ACTION = "JoeyTeng/codex-review-gate-action@v2";
const CLOSED_JOB_IF = [
  "${{",
  "(",
  "github.event_name == 'workflow_dispatch' &&",
  "github.ref_type == 'branch' &&",
  "github.ref_name == github.event.repository.default_branch",
  ") ||",
  "(",
  "github.event_name == 'issue_comment' &&",
  "(github.event.action == 'created' || github.event.action == 'edited') &&",
  "github.event.issue.pull_request &&",
  `github.event.sender.login == '${EXACT_BOT}' &&`,
  "github.event.sender.type == 'Bot' &&",
  `github.event.comment.user.login == '${EXACT_BOT}' &&`,
  "github.event.comment.user.type == 'Bot'",
  ")",
  "}}",
].join(" ");

test("the v2 installation template is isolated from the still-live v1 source caller", () => {
  const verifier = parseVerifierWorkflow(templateConsumer);
  const controller = parseControllerWorkflow(templateController);
  assert.notEqual(sourceConsumer, templateConsumer);
  assert.match(
    sourceConsumer,
    /uses: JoeyTeng\/codex-review-gate-action\/\.github\/workflows\/codex-review-gate\.yml@v1/u,
  );
  assert.doesNotMatch(sourceConsumer, /codex-review-gate-action@v2/u);
  for (const path of retiredPackageWorkflowPaths) {
    assert.equal(existsSync(path), false);
  }
  assert.equal(itemScalar(verifier.steps[0], "uses"), MARKETPLACE_ACTION);
  assert.equal(itemScalar(controller.steps[0], "uses"), MARKETPLACE_ACTION);
  for (const workflow of [templateConsumer, templateController]) {
    assert.doesNotMatch(
      workflow,
      /\.github\/workflows\/codex-review-gate\.yml@|workflow_call|secrets:\s*inherit/u,
    );
  }
});

test("automatic runner admission separates read-only PR verification from exact Codex comments", () => {
  const verifier = parseVerifierWorkflow(templateConsumer);
  const workflow = parseControllerWorkflow(templateController);
  assert.deepEqual(blockDirectKeys(verifier.events), ["pull_request"]);
  assert.deepEqual(blockScalarMapping(verifier.pullRequest), {
    types: "[opened, reopened, synchronize, ready_for_review]",
  });
  assert.deepEqual(blockDirectKeys(workflow.events), ["issue_comment", "workflow_dispatch"]);
  assert.deepEqual(blockScalarMapping(workflow.issueComment), {
    types: "[created, edited]",
  });

  const jobIf = foldedScalarBody(workflow.job, "if");
  for (const expression of [
    "github.event_name == 'workflow_dispatch'",
    "github.ref_type == 'branch'",
    "github.ref_name == github.event.repository.default_branch",
    "github.event_name == 'issue_comment'",
    "github.event.action == 'created'",
    "github.event.action == 'edited'",
    "github.event.issue.pull_request",
    `github.event.sender.login == '${EXACT_BOT}'`,
    "github.event.sender.type == 'Bot'",
    `github.event.comment.user.login == '${EXACT_BOT}'`,
    "github.event.comment.user.type == 'Bot'",
  ]) {
    assert.ok(jobIf.includes(expression), `missing pre-runner filter: ${expression}`);
  }
});

test("manual dispatch is default-branch-only and exposes the closed typed business inputs", () => {
  const workflow = parseControllerWorkflow(templateController);
  assert.deepEqual(blockDirectKeys(workflow.workflowDispatch), ["inputs"]);
  assert.deepEqual(blockDirectKeys(workflow.dispatchInputs), [
    "operation",
    "pr_number",
    "expected_head_sha",
    "request_comment_id",
    "request_review",
  ]);
  assert.doesNotMatch(
    templateController,
    /repository_dispatch|client_payload|batch|targets|source_sha|temporary|max_pages|max_objects/u,
  );
});

test("consumer permissions and runtime shape cannot read or execute pull-request code", () => {
  const verifier = parseVerifierWorkflow(templateConsumer);
  const controller = parseControllerWorkflow(templateController);
  assert.deepEqual(blockScalarMapping(verifier.permissions), {
    contents: "read",
    issues: "read",
    "pull-requests": "read",
  });
  assert.deepEqual(blockScalarMapping(controller.permissions), {
    actions: "write",
    checks: "read",
    contents: "read",
    issues: "write",
    "pull-requests": "read",
  });
  assert.equal(
    blockScalar(verifier.job, "runs-on"),
    "${{ vars.CODEX_REVIEW_GATE_USE_UBUNTU_LATEST == 'true' && 'ubuntu-latest' || 'ubuntu-slim' }}",
  );
  assert.equal(blockScalar(verifier.job, "timeout-minutes"), "14");
  assert.equal(verifier.steps.length, 1);
  assert.deepEqual(
    itemKeys(verifier.steps[0]),
    ["name", "id", "uses", "env", "with"],
  );
  assert.equal(itemScalar(verifier.steps[0], "uses"), MARKETPLACE_ACTION);
  assert.deepEqual(blockScalarMapping(verifier.env), {
    CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION:
      "${{ vars.CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION == 'any' && 'any' || 'write' }}",
  });
  assertNoForbiddenExecutionKeys(templateConsumer);
  assertNoForbiddenExecutionKeys(templateController);
});

test("CODEOWNERS and the ruleset independently protect the workflow control plane", () => {
  assert.deepEqual(
    templateCodeowners
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#")),
    [
      "/.github/workflows/ @JoeyTeng",
      "/.github/CODEOWNERS @JoeyTeng",
    ],
  );
  const pullRequestRule = templateRuleset.rules.find(
    (rule) => rule.type === "pull_request",
  );
  assert.equal(pullRequestRule.parameters.require_code_owner_review, true);
  assert.equal(pullRequestRule.parameters.dismiss_stale_reviews_on_push, true);
  assert.equal(pullRequestRule.parameters.required_approving_review_count, 0);
  assert.equal(pullRequestRule.parameters.required_review_thread_resolution, true);

  for (const [name, guide] of Object.entries(installGuides)) {
    assert.match(guide, /CONTROL_PLANE_OWNER/u, name);
    assert.match(guide, /--control-plane-owner/u, name);
    assert.match(guide, /15368/u, name);
    assert.match(guide, /Code Owner/u, name);
  }
});

test("generic root quickstarts keep the control-plane owner explicit", () => {
  const expectedShell = `CONTROL_PLANE_OWNER=@USER
node scripts/bootstrap-codex-review-gate.mjs \\
  --prepare-worktree /path/to/consumer \\
  --control-plane-owner "$CONTROL_PLANE_OWNER"
node scripts/bootstrap-codex-review-gate.mjs \\
  --prepare-worktree /path/to/consumer \\
  --control-plane-owner "$CONTROL_PLANE_OWNER" \\
  --apply
`;
  const headings = {
    "README.md": "## Bootstrap",
    "README.zh-CN.md": "## Bootstrap",
  };
  for (const [name, readme] of Object.entries(rootReadmes)) {
    const quickstart = markdownSection(readme, headings[name]);
    assert.match(quickstart, /CONTROL_PLANE_OWNER=@USER/u, name);
    const invocations = shellInvocations(
      quickstart,
      /^node scripts\/bootstrap-codex-review-gate\.mjs\b/u,
    );
    assert.equal(invocations.length, 2, `${name}: root quickstart must stay local-only`);
    for (const invocation of invocations) {
      assert.equal(
        (invocation.match(/--control-plane-owner "\$CONTROL_PLANE_OWNER"/gu) ?? [])
          .length,
        1,
        `${name}: every bootstrap invocation must bind the owner exactly once`,
      );
    }
    assert.match(quickstart, /@JoeyTeng/u, name);
    assert.match(quickstart, /Joey-owned repositories/u, name);
    assert.match(quickstart, /local preparation/iu, name);
    assert.match(quickstart, /(?:human installation guide|人类安装指南)/iu, name);
    assert.match(quickstart, /(?:agent execution runbook|Agent 执行手册)/u, name);
    const quickstartBlocks = shellCodeBlocks(quickstart);
    assert.deepEqual(quickstartBlocks, [expectedShell], `${name}: local shell whitelist`);
  }
});

test("package installation docs require workflow, CODEOWNERS, and ruleset together", () => {
  const headings = {
    "README.md": "## Install the complete consumer contract",
    "README.zh-CN.md": "## 安装完整消费者契约",
    "SECURITY.md": "## Installation trust boundary",
  };
  for (const [name, heading] of Object.entries(headings)) {
    const guide = markdownSection(packageDocs[name], heading);
    for (const required of [
      /(?:three[- ]asset|three\s+required(?:\s+repository)?\s+asset(?:s|\s+groups)|三个[\s\S]{0,30}(?:asset groups|必需资产))/iu,
      /canonical[\s\S]{0,120}workflow/iu,
      /CODEOWNERS/u,
      /ruleset/iu,
      /--control-plane-owner/u,
      /@USER/u,
      /\/\.github\/workflows\//u,
      /\/\.github\/CODEOWNERS/u,
      /\bwrite\b/u,
      /\bmaintain\b/u,
      /\badmin\b/u,
      /15368/u,
      /entire\s+GitHub\s+Actions\s+App/iu,
      /exact-head/iu,
      /Code Owner/u,
      /stale/iu,
    ]) {
      assert.match(guide, required, `${name}: ${required}`);
    }
  }
});

test("public package docs preserve bootstrap sequencing", () => {
  const sections = {
    "README.md": "## Install the complete consumer contract",
    "README.zh-CN.md": "## 安装完整消费者契约",
    "SECURITY.md": "## Installation trust boundary",
    "DESIGN.md": "## Architecture and trust boundaries",
    "DESIGN.zh-CN.md": "## 架构和 trust boundaries",
    "COOKBOOK.md": "## Migrating from v1",
    "COOKBOOK.zh-CN.md": "## 从 v1 迁移",
  };
  for (const [name, heading] of Object.entries(sections)) {
    const guide = markdownSection(packageDocs[name], heading);
    for (const required of [
      /canonical[\s\S]{0,120}workflow/iu,
      /CODEOWNERS/u,
      /(?:legacy[\s\S]{0,200}inventory|inventory[\s\S]{0,200}legacy)/iu,
      /SHA-256/iu,
      /exact-head/iu,
      /(?:synchronous|同步)/iu,
      /Disabled/u,
      /canary/iu,
      /(?:activate|activation|Active|激活)/iu,
      /(?:no\s+bypass\s+actors|没有\s+bypass\s+actors|bypass\s+actors\s+(?:为空|are\s+empty))/iu,
    ]) {
      assert.match(guide, required, `${name}: ${required}`);
    }
  }
});

test("public package docs keep legacy active until exact post-merge scope readback", () => {
  const sections = {
    "README.md": "## Install the complete consumer contract",
    "README.zh-CN.md": "## 安装完整消费者契约",
    "SECURITY.md": "## Installation trust boundary",
    "DESIGN.md": "## Architecture and trust boundaries",
    "DESIGN.zh-CN.md": "## 架构和 trust boundaries",
    "COOKBOOK.md": "## Migrating from v1",
    "COOKBOOK.zh-CN.md": "## 从 v1 迁移",
  };
  for (const [name, heading] of Object.entries(sections)) {
    const section = markdownSection(packageDocs[name], heading);
    const merge = section.search(/(?:synchronous|同步)[\s\S]{0,80}merge/iu);
    const readback = section.search(/(?:current\s+default|current-default)/iu);
    const approvedScope = section.search(/approved scope/iu);
    const removalOffset = section.slice(approvedScope).search(
      /(?:(?:remove|removal|移除|删除)[\s\S]{0,100}(?:legacy|inventoried)|legacy[\s\S]{0,40}removal)/iu,
    );
    const removal = removalOffset < 0 ? -1 : approvedScope + removalOffset;
    assert.ok(
      merge >= 0 && readback > merge && approvedScope >= readback && removal > approvedScope,
      `${name}: merge < current-default merged/base/head readback < legacy removal`,
    );
    assert.match(section, /(?:failed readback|readback fails|readback 失败|failure|失败)[\s\S]{0,100}(?:keep|preserve|保留)[\s\S]{0,80}legacy/iu, name);
  }
});

test("public package docs preserve native verifier and controller recovery", () => {
  const sections = {
    "README.md": "## Public result ABI",
    "README.zh-CN.md": "## Public result ABI",
    "SECURITY.md": "## Runtime boundary",
    "DESIGN.md": "## Result and projection model",
    "DESIGN.zh-CN.md": "## Result 和 projection 模型",
    "COOKBOOK.md": "## Interpret results",
    "COOKBOOK.zh-CN.md": "## 解读结果",
  };
  for (const [name, heading] of Object.entries(sections)) {
    const guide = markdownSection(packageDocs[name], heading);
    for (const required of [
      /verifier/iu,
      /controller/iu,
      /CheckRun/iu,
      /healthy\/success/u,
      /retry_safe/iu,
      /(?:status projection|commit-status)[\s\S]{0,80}(?:deleted|removed|不存在|删除)/iu,
      /pending[\s\S]{0,100}(?:block|阻塞)/iu,
    ]) {
      assert.match(guide, required, `${name}: ${required}`);
    }
  }
});

test("installation bootstrap invocations bind the owner exactly once", () => {
  for (const [name, guide] of Object.entries(installGuides)) {
    const invocations = shellInvocations(
      guide,
      /^node "\$SOURCE_ROOT\/scripts\/bootstrap-codex-review-gate\.mjs"(?=\s|$)/u,
    );
    assert.ok(invocations.length > 0, `${name}: missing bootstrap invocation`);
    for (const invocation of invocations) {
      assert.equal(
        (invocation.match(/--control-plane-owner "\$CONTROL_PLANE_OWNER"/gu) ?? [])
          .length,
        1,
        `${name}: every bootstrap invocation must bind the owner exactly once`,
      );
    }
  }
});

test("legacy inventory helper builds canonical output from complete GitHub fixtures", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-inventory-test-"));
  try {
    const fixtureBin = join(fixtureRoot, "bin");
    mkdirSync(fixtureBin);
    const fakeGh = join(fixtureBin, "gh");
    writeFileSync(
      fakeGh,
      String.raw`#!/usr/bin/env bash
set -euo pipefail
if [[ $1 == repo && $2 == view ]]; then
  printf 'main\n'
  exit 0
fi
if [[ $1 != api ]]; then
  exit 90
fi
shift
if [[ $1 == --paginate ]]; then
  if [[ $FIXTURE_MALFORMED == parameters ]]; then
    printf '%s\n' '[[{"type":"required_status_checks","ruleset_id":7,"parameters":{"strict_required_status_checks_policy":"not-a-boolean","required_status_checks":{}}}]]'
  elif [[ $FIXTURE_MALFORMED == missing-strict ]]; then
    printf '%s\n' '[[{"type":"required_status_checks","ruleset_id":7,"parameters":{"required_status_checks":[{"context":"codex/review-gate","integration_id":15368}]}}]]'
  else
    if [[ $FIXTURE_PERMUTED == true ]]; then
      checks='[{"context":"ci/test","integration_id":15368},{"context":"codex/review-gate","integration_id":15368}]'
    else
      checks='[{"context":"codex/review-gate","integration_id":15368},{"context":"ci/test","integration_id":15368}]'
    fi
    printf '[[{"type":"required_status_checks","ruleset_id":7,"parameters":{"strict_required_status_checks_policy":%s,"do_not_enforce_on_create":false,"required_status_checks":%s}}]]\n' "$FIXTURE_STRICT" "$checks"
  fi
  exit 0
fi
if [[ $1 == --include ]]; then
  printf 'HTTP/2 200 OK\n'
  exit 0
fi
case "$1" in
  repos/OWNER/REPO/branches/main/protection/required_status_checks)
    if [[ $FIXTURE_MALFORMED == classic-missing-strict ]]; then
      printf '%s\n' '{"contexts":["codex/review-gate"],"checks":[{"context":"codex/review-gate","app_id":15368}]}'
    elif [[ $FIXTURE_PERMUTED == true ]]; then
      printf '{"strict":%s,"contexts":["ci/test","codex/review-gate"],"checks":[{"context":"ci/test","app_id":15368},{"context":"codex/review-gate","app_id":15368}]}\n' "$FIXTURE_CLASSIC_STRICT"
    else
      printf '{"strict":%s,"contexts":["codex/review-gate","ci/test"],"checks":[{"context":"codex/review-gate","app_id":15368},{"context":"ci/test","app_id":15368}]}\n' "$FIXTURE_CLASSIC_STRICT"
    fi
    ;;
  repos/OWNER/REPO/rulesets/7)
    if [[ $FIXTURE_MALFORMED == bypass ]]; then
      bypass='{"unexpected":true}'
    elif [[ $FIXTURE_BYPASS == invalid-deploy-id ]]; then
      bypass='[{"actor_id":99,"actor_type":"DeployKey","bypass_mode":"always"}]'
    elif [[ $FIXTURE_BYPASS == invalid-deploy-pr ]]; then
      bypass='[{"actor_id":null,"actor_type":"DeployKey","bypass_mode":"pull_request"}]'
    elif [[ $FIXTURE_BYPASS == invalid-null-team ]]; then
      bypass='[{"actor_id":null,"actor_type":"Team","bypass_mode":"always"}]'
    elif [[ $FIXTURE_BYPASS == invalid-type ]]; then
      bypass='[{"actor_id":42,"actor_type":"Unknown","bypass_mode":"always"}]'
    elif [[ $FIXTURE_BYPASS == invalid-mode ]]; then
      bypass='[{"actor_id":42,"actor_type":"Team","bypass_mode":"unknown"}]'
    elif [[ $FIXTURE_BYPASS == changed ]]; then
      bypass='[{"actor_id":42,"actor_type":"Team","bypass_mode":"exempt"},{"actor_id":null,"actor_type":"OrganizationAdmin","bypass_mode":"always"},{"actor_id":null,"actor_type":"DeployKey","bypass_mode":"always"}]'
    elif [[ $FIXTURE_PERMUTED == true ]]; then
      bypass='[{"actor_id":null,"actor_type":"DeployKey","bypass_mode":"always"},{"actor_id":null,"actor_type":"OrganizationAdmin","bypass_mode":"always"},{"actor_id":42,"actor_type":"Team","bypass_mode":"always"}]'
    else
      bypass='[{"actor_id":42,"actor_type":"Team","bypass_mode":"always"},{"actor_id":null,"actor_type":"OrganizationAdmin","bypass_mode":"always"},{"actor_id":null,"actor_type":"DeployKey","bypass_mode":"always"}]'
    fi
    if [[ $FIXTURE_PERMUTED == true ]]; then
      conditions='{"repository_property":{"exclude":[{"property_values":["archived","blocked"],"name":"state"}],"include":[{"property_values":["public","private"],"name":"visibility"},{"property_values":["alpha","beta"],"name":"tier"}]},"repository_id":{"repository_ids":[1002,1001]},"ref_name":{"exclude":["refs/heads/wip*","refs/heads/tmp*"],"include":["refs/heads/release","~DEFAULT_BRANCH"]}}'
    else
      conditions='{"ref_name":{"include":["~DEFAULT_BRANCH","refs/heads/release"],"exclude":["refs/heads/tmp*","refs/heads/wip*"]},"repository_id":{"repository_ids":[1001,1002]},"repository_property":{"include":[{"name":"tier","property_values":["beta","alpha"]},{"name":"visibility","property_values":["private","public"]}],"exclude":[{"name":"state","property_values":["blocked","archived"]}]}}'
    fi
    printf '{"id":7,"name":"legacy","source_type":"Repository","source":"OWNER/REPO","enforcement":"active","target":"branch","conditions":%s,"rules":[],"bypass_actors":%s}\n' "$conditions" "$bypass"
    ;;
  *) exit 91 ;;
esac
`,
      "utf8",
    );
    chmodSync(fakeGh, 0o755);
    const runFixture = (name, fixtureEnv = {}) => {
      const output = join(fixtureRoot, `${name}.json`);
      const result = spawnSync(
        legacyInventoryHelperPath,
        ["OWNER/REPO", "main", output],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${fixtureBin}:${process.env.PATH}`,
            TMPDIR: fixtureRoot,
            FIXTURE_BYPASS: "",
            FIXTURE_CLASSIC_STRICT: "true",
            FIXTURE_MALFORMED: "",
            FIXTURE_PERMUTED: "false",
            FIXTURE_STRICT: "true",
            ...fixtureEnv,
          },
        },
      );
      return { output, result };
    };
    const baseline = runFixture("baseline");
    const { output, result } = baseline;
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^LEGACY_INVENTORY_SHA256=[0-9a-f]{64}\n$/u);
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), {
      classic_required_status_checks: {
        checks: [
          { app_id: 15368, context: "ci/test" },
          { app_id: 15368, context: "codex/review-gate" },
        ],
        contexts: ["ci/test", "codex/review-gate"],
        strict: true,
      },
      default_branch: "main",
      repository: "OWNER/REPO",
      rulesets: [
        {
          conditions: {
            ref_name: {
              exclude: ["refs/heads/tmp*", "refs/heads/wip*"],
              include: ["refs/heads/release", "~DEFAULT_BRANCH"],
            },
            repository_id: {
              repository_ids: [1001, 1002],
            },
            repository_property: {
              exclude: [
                { name: "state", property_values: ["archived", "blocked"] },
              ],
              include: [
                { name: "tier", property_values: ["alpha", "beta"] },
                {
                  name: "visibility",
                  property_values: ["private", "public"],
                },
              ],
            },
          },
          enforcement: "active",
          bypass_actors: [
            {
              actor_id: null,
              actor_type: "DeployKey",
              bypass_mode: "always",
            },
            {
              actor_id: null,
              actor_type: "OrganizationAdmin",
              bypass_mode: "always",
            },
            { actor_id: 42, actor_type: "Team", bypass_mode: "always" },
          ],
          id: 7,
          name: "legacy",
          effective_required_status_checks_rule: {
            parameters: {
              do_not_enforce_on_create: false,
              required_status_checks: [
                { context: "ci/test", integration_id: 15368 },
                {
                  context: "codex/review-gate",
                  integration_id: 15368,
                },
              ],
              strict_required_status_checks_policy: true,
            },
            ruleset_id: 7,
            type: "required_status_checks",
          },
          source: "OWNER/REPO",
          source_type: "Repository",
          target: "branch",
        },
      ],
    });
    const bypassChanged = runFixture("bypass-changed", {
      FIXTURE_BYPASS: "changed",
    });
    assert.equal(bypassChanged.result.status, 0, bypassChanged.result.stderr);
    assert.notEqual(
      bypassChanged.result.stdout,
      baseline.result.stdout,
      "bypass_actors-only drift must change the digest",
    );
    assert.notDeepEqual(
      JSON.parse(readFileSync(bypassChanged.output, "utf8")),
      JSON.parse(readFileSync(baseline.output, "utf8")),
    );
    const parameterChanged = runFixture("parameter-changed", {
      FIXTURE_STRICT: "false",
    });
    assert.equal(parameterChanged.result.status, 0, parameterChanged.result.stderr);
    assert.notEqual(
      parameterChanged.result.stdout,
      baseline.result.stdout,
      "matching-rule parameter-only drift must change the digest",
    );
    assert.notDeepEqual(
      JSON.parse(readFileSync(parameterChanged.output, "utf8")),
      JSON.parse(readFileSync(baseline.output, "utf8")),
    );
    const classicStrictChanged = runFixture("classic-strict-changed", {
      FIXTURE_CLASSIC_STRICT: "false",
    });
    assert.equal(
      classicStrictChanged.result.status,
      0,
      classicStrictChanged.result.stderr,
    );
    assert.notEqual(
      classicStrictChanged.result.stdout,
      baseline.result.stdout,
      "classic strict-only drift must change the digest",
    );
    const permuted = runFixture("permuted", { FIXTURE_PERMUTED: "true" });
    assert.equal(permuted.result.status, 0, permuted.result.stderr);
    assert.equal(
      permuted.result.stdout,
      baseline.result.stdout,
      "unordered-array permutations must preserve the digest",
    );
    assert.equal(
      readFileSync(permuted.output, "utf8"),
      readFileSync(baseline.output, "utf8"),
      "unordered-array permutations must preserve canonical JSON bytes",
    );
    for (const malformed of [
      "parameters",
      "missing-strict",
      "bypass",
      "classic-missing-strict",
    ]) {
      const rejected = runFixture(`malformed-${malformed}`, {
        FIXTURE_MALFORMED: malformed,
      });
      assert.notEqual(rejected.result.status, 0, `${malformed} schema must fail closed`);
      assert.equal(existsSync(rejected.output), false);
    }
    for (const invalidBypass of [
      "invalid-deploy-id",
      "invalid-deploy-pr",
      "invalid-null-team",
      "invalid-type",
      "invalid-mode",
    ]) {
      const rejected = runFixture(invalidBypass, {
        FIXTURE_BYPASS: invalidBypass,
      });
      assert.notEqual(rejected.result.status, 0, `${invalidBypass} must fail closed`);
      assert.equal(existsSync(rejected.output), false);
    }
    const badArity = spawnSync(legacyInventoryHelperPath, ["OWNER/REPO", "main"]);
    assert.equal(badArity.status, 64);
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
});

test("installation runbooks close the initial trust-bootstrap merge on the approved head", () => {
  const headings = {
    "human.md": "## 1. Create and merge the migration PR",
    "human.zh-CN.md": "## 1. 创建并合并 migration PR",
    "agent.md": "## Phase 1: prepare and merge one migration PR",
    "agent.zh-CN.md": "## 阶段 1：准备并合并 migration PR",
  };
  assert.match(legacyInventoryHelper, /^#!\/usr\/bin\/env bash\n/u);
  assert.match(legacyInventoryHelper, /set -euo pipefail/u);
  assert.match(legacyInventoryHelper, /\[\[ \$# -ne 3 \]\]/u);
  assert.match(legacyInventoryHelper, /trap cleanup EXIT/u);
  assert.match(legacyInventoryHelper, /trap 'exit 130' HUP INT TERM/u);
  assert.match(legacyInventoryHelper, /repos\/\$repository\/rules\/branches\//u);
  assert.match(legacyInventoryHelper, /protection\/required_status_checks/u);
  assert.match(legacyInventoryHelper, /all\(\.\[\]; type == "array"\)/u);
  assert.match(legacyInventoryHelper, /strict_required_status_checks_policy \| type == "boolean"/u);
  assert.match(legacyInventoryHelper, /\.parameters\.required_status_checks \| type == "array"/u);
  assert.match(legacyInventoryHelper, /\.bypass_actors \| type == "array"/u);
  assert.match(
    legacyInventoryHelper,
    /\.actor_type \| IN\("Integration", "OrganizationAdmin",[\s\S]*?"DeployKey",[\s\S]*?"EnterpriseOwner",[\s\S]*?"User"\)/u,
  );
  assert.match(legacyInventoryHelper, /\.bypass_mode \| IN\("always", "pull_request", "exempt"\)/u);
  assert.match(legacyInventoryHelper, /if \.actor_type == "DeployKey" then\s*\.actor_id == null/u);
  assert.match(
    legacyInventoryHelper,
    /elif \(\.actor_type \| IN\("OrganizationAdmin", "EnterpriseOwner"\)\) then\s*\(\.actor_id == null or \(\.actor_id \| type == "number"\)\)/u,
  );
  assert.match(legacyInventoryHelper, /else\s*\(\.actor_id \| type == "number"\)/u);
  assert.match(
    legacyInventoryHelper,
    /if \.bypass_mode == "pull_request" then\s*\.actor_type != "DeployKey" and \$ruleset\.target == "branch"/u,
  );
  assert.match(legacyInventoryHelper, /\.strict \| type == "boolean"/u);
  assert.match(
    legacyInventoryHelper,
    /if type == "array" then\s*map\(canonical_condition_value\) \| sort_by\(tojson\)/u,
  );
  assert.match(
    legacyInventoryHelper,
    /elif type == "object" then\s*to_entries\s*\| sort_by\(\.key\)/u,
  );
  assert.match(legacyInventoryHelper, /\.parameters\.required_status_checks \|=\s*sort_by/u);
  assert.match(legacyInventoryHelper, /bypass_actors:\(\$ruleset\.bypass_actors\s*\| sort_by/u);
  assert.match(legacyInventoryHelper, /\.contexts \|= sort/u);
  assert.match(legacyInventoryHelper, /\.checks \|= sort_by/u);
  assert.match(legacyInventoryHelper, /\.contexts \| type == "array"/u);
  assert.match(legacyInventoryHelper, /\.checks \| type == "array"/u);
  assert.match(legacyInventoryHelper, /\. == null or/u);
  assert.match(legacyInventoryHelper, /printf 'null\\n' > "\$classic_status"/u);
  assert.doesNotMatch(legacyInventoryHelper, /(?:required_status_checks|contexts|checks)\[\]\?/u);
  assert.match(legacyInventoryHelper, /jq -S -c -n/u);
  for (const field of [
    "repository",
    "default_branch",
    "id",
    "name",
    "source_type",
    "source",
    "enforcement",
    "target",
    "conditions",
    "bypass_actors",
    "effective_required_status_checks_rule",
    "classic_required_status_checks",
  ]) {
    assert.match(legacyInventoryHelper, new RegExp(`${field}:`, "u"), `helper: ${field}`);
  }
  assert.match(legacyInventoryHelper, /sort_by\(\[\.id,?\s*\.name,?\s*\.source_type/iu);
  assert.match(legacyInventoryHelper, /mv "\$output_staging" "\$output"/u);
  assert.match(legacyInventoryHelper, /LEGACY_INVENTORY_SHA256=%s/u);
  const helperCleanup = legacyInventoryHelper.slice(
    legacyInventoryHelper.indexOf("cleanup() {"),
    legacyInventoryHelper.indexOf("trap cleanup EXIT"),
  );
  for (const variable of [
    "ruleset_pages",
    "ruleset_details",
    "ruleset_detail",
    "ruleset_next",
    "classic_headers",
    "classic_error",
    "classic_status",
    "canonical_inventory",
    "output_staging",
    "inventory_directory",
  ]) {
    assert.match(helperCleanup, new RegExp(`\\$${variable}\\b`, "u"), `helper cleanup ${variable}`);
  }
  assert.doesNotMatch(Object.values(installGuides).join("\n"), /build_legacy_inventory\(\)/u);

  for (const [name, heading] of Object.entries(headings)) {
    const trustBootstrap = markdownSection(installGuides[name], heading);
    const transactions = shellCodeBlocks(trustBootstrap).filter((block) =>
      block.includes('gh api --method PUT "repos/$REPO/pulls/$MIGRATION_PR/merge"'),
    );
    assert.equal(transactions.length, 1, `${name}: expected one fail-fast transaction`);
    const [transaction] = transactions;
    assert.match(transaction, /^\s*\(\n\s+set -euo pipefail/mu, name);
    assert.match(transaction, /cleanup\(\) \{/u, name);
    assert.match(transaction, /trap cleanup EXIT/u, name);
    assert.match(transaction, /trap 'exit 130' HUP INT TERM/u, name);
    assert.match(transaction, /rm -f "\$PR_STATE"/u, name);
    assert.match(trustBootstrap, /MERGE_METHOD=REPOSITORY_APPROVED_METHOD/u, name);
    assert.match(trustBootstrap, /merge\|squash\|rebase/u, name);
    assert.doesNotMatch(transaction, /^\s*LEGACY_INVENTORY_SHA256=/mu, name);
    assert.doesNotMatch(trustBootstrap, /LEGACY_PLAN_ACK/u, name);
    const helperCalls = shellCodeBlocks(trustBootstrap)
      .map((block) => block.match(/scripts\/build-legacy-review-gate-inventory\.sh/gu) ?? [])
      .flat();
    assert.equal(
      helperCalls.length,
      2,
      `${name}: approval snapshot and final gate must share the tracked helper`,
    );
    assert.match(trustBootstrap, /printf 'LEGACY_INVENTORY_SHA256=%s\\n'/u, name);
    assert.match(
      transaction,
      /\$\{LEGACY_INVENTORY_SHA256:\?external approval-snapshot digest is required\}/u,
      name,
    );
    assert.match(transaction, /--json author,baseRefName,headRefOid,state,isDraft/u, name);
    assert.match(transaction, /\.baseRefName == \$base/u, name);
    assert.match(
      transaction,
      /\.baseRefName == \$base and \.headRefOid == \$head and \.state == "OPEN" and \(\.isDraft \| not\)/u,
      name,
    );
    assert.match(transaction, /\.author\.login[\s\S]{0,100}ascii_downcase[\s\S]{0,100}!= \(\$owner \| ascii_downcase\)/u, name);
    assert.match(transaction, /CURRENT_ACTOR="\$\(gh api user --jq '\.login'\)"/u, name);
    assert.match(transaction, /\(\$actor \| ascii_downcase\) == \(\$owner \| ascii_downcase\)/u, name);
    assert.match(transaction, /\.user\.type == "User"/u, name);
    assert.match(transaction, /\| sort_by\(\[\.submitted_at, \.id\]\) \| last/u, name);
    assert.match(transaction, /\.commit_id[\s\S]{0,120}\$head/u, name);
    assert.match(trustBootstrap, /auto-merge/iu, name);
    assert.match(trustBootstrap, /merge queue/iu, name);
    assert.match(trustBootstrap, /admin bypass/iu, name);

    assert.match(transaction, /createHash\("sha256"\)/u, name);
    assert.equal((transaction.match(/^\s*LEGACY_INVENTORY_SHA256=/gmu) ?? []).length, 0, name);
    assert.doesNotMatch(transaction, /test "\$RULESET_LEGACY_COUNT" -eq 0/u, name);
    assert.doesNotMatch(transaction, /test "\$CLASSIC_LEGACY_COUNT" -eq 0/u, name);
    assert.match(trustBootstrap, /(?:keep every legacy requirement active|让全部 legacy requirements 保持 active|保留全部 legacy requirements|保留所有 legacy requirement)/iu, name);
    assert.match(trustBootstrap, /(?:post-merge|merge 后立即)/iu, name);

    const freshHashIndex = transaction.indexOf('FRESH_LEGACY_INVENTORY_SHA256="$(node');
    const digestCompareIndex = transaction.indexOf('test "$FRESH_LEGACY_INVENTORY_SHA256" =');
    const prPredicateIndex = transaction.indexOf(
      '.baseRefName == $base and .headRefOid == $head and .state == "OPEN" and (.isDraft | not)',
    );
    const finalReviewApiIndex = transaction.indexOf(
      "pulls/$MIGRATION_PR/reviews?per_page=100",
    );
    const mergeIndex = transaction.indexOf(
      'gh api --method PUT "repos/$REPO/pulls/$MIGRATION_PR/merge"',
    );
    assert.ok(
      freshHashIndex >= 0 &&
        digestCompareIndex > freshHashIndex &&
        prPredicateIndex > digestCompareIndex &&
        finalReviewApiIndex > prPredicateIndex &&
        mergeIndex > finalReviewApiIndex,
      `${name}: fresh digest equality and final approval must precede merge`,
    );
    assert.match(
      transaction,
      /test "\$FRESH_LEGACY_INVENTORY_SHA256" = \\\n\s*"\$\{LEGACY_INVENTORY_SHA256:\?external approval-snapshot digest is required\}"/u,
      `${name}: exact external digest equality`,
    );
    const finalRead = transaction.slice(finalReviewApiIndex, mergeIndex);
    assert.match(
      transaction,
      /gh api --paginate --slurp[\s\S]{0,160}pulls\/\$MIGRATION_PR\/reviews\?per_page=100/u,
      name,
    );
    assert.match(finalRead, /sort_by\(\[\.submitted_at, \.id\]\)/u, name);
    assert.match(finalRead, /\.state == "APPROVED"/u, name);
    assert.match(finalRead, /\.commit_id/u, name);
    assert.match(transaction, /\{sha:\$sha, merge_method:\$method\}/u, name);
    assert.equal(
      (transaction.match(/\{sha:\$sha,\s*merge_method:\$method\}/gu) ?? []).length,
      1,
      `${name}: merge body must contain exactly the adopted two fields once`,
    );
    assert.match(transaction, /--arg sha "\$MIGRATION_HEAD"/u, name);
    assert.match(transaction, /--arg method "\$MERGE_METHOD"/u, name);
    assert.match(transaction, /jq -e '\.merged == true' "\$MERGE_RESPONSE"/u, name);
    assert.equal(
      (transaction.match(/gh api --method PUT "repos\/\$REPO\/pulls\/\$MIGRATION_PR\/merge"[\s\S]{0,100}--input "\$MERGE_BODY"/gu) ?? []).length,
      1,
      `${name}: exactly one synchronous merge mutation is allowed`,
    );
    assert.equal(
      (transaction.match(/\bgh api --method PUT\b/gu) ?? []).length,
      1,
      `${name}: transaction must contain exactly one PUT mutation`,
    );
    assert.doesNotMatch(transaction, /gh pr merge|--auto|--admin|merge_queue|enqueue|graphql|enablePullRequestAutoMerge/u, name);
    assert.doesNotMatch(transaction, /gh api --method (?:POST|PATCH|DELETE)\b/u, name);
    assert.equal((transaction.match(/gh api --method\s+\S+/gu) ?? []).length, 1, name);
    const postMergeRegion = transaction.slice(mergeIndex);
    const defaultReadIndex = postMergeRegion.indexOf("defaultBranchRef.name");
    const postMergeReadIndex = postMergeRegion.indexOf('--json baseRefName,headRefOid,state,mergedAt');
    assert.ok(defaultReadIndex >= 0 && postMergeReadIndex > defaultReadIndex, `${name}: current default precedes PR readback`);
    assert.ok(postMergeReadIndex >= 0, `${name}: post-merge state readback follows PUT`);
    const postMergeRead = postMergeRegion.slice(postMergeReadIndex);
    assert.match(postMergeRead, /\.state == "MERGED" and \.mergedAt != null and \.baseRefName == \$base/u, name);
    assert.match(postMergeRead, /\.headRefOid[\s\S]{0,100}\$head/u, name);
    const cleanup = transaction.slice(
      transaction.indexOf("cleanup() {"),
      transaction.indexOf("trap cleanup EXIT"),
    );
    for (const variable of [
      "PR_STATE",
      "FINAL_REVIEW_PAGES",
      "MERGE_BODY",
      "MERGE_RESPONSE",
      "POST_MERGE_STATE",
      "LEGACY_INVENTORY",
      "TXN_DIR",
    ]) {
      assert.match(cleanup, new RegExp(`\\$${variable}\\b`, "u"), `${name}: cleanup ${variable}`);
    }
    assert.match(trustBootstrap, /(?:atomic\s+compare-and-swap|atomic\s+review-state-plus-head\s+CAS|review-state-plus-head\s+atomic\s+CAS)/iu, name);
    assert.match(trustBootstrap, /trusted\s+owner/iu, name);
    assert.match(trustBootstrap, /(?:immediately after|后立即|后立即执行)/iu, name);
    assert.match(trustBootstrap, /(?:head-only reread|只重读 head)/iu, name);
    assert.match(trustBootstrap, /405\/409/u, name);
    const globalMergeIndex = trustBootstrap.indexOf(
      'gh api --method PUT "repos/$REPO/pulls/$MIGRATION_PR/merge"',
    );
    const afterMerge = trustBootstrap.slice(globalMergeIndex);
    const lifecycleReadIndex = afterMerge.indexOf('--json baseRefName,headRefOid,state,mergedAt');
    const removalIndex = afterMerge.search(/(?:remove all|删除 inventory 中全部|removal plan)/iu);
    const disabledIndex = afterMerge.indexOf("Disabled");
    const canaryIndex = afterMerge.search(/canary/iu);
    const activeIndex = afterMerge.search(/(?:activate|active|激活)/iu);
    assert.ok(
      lifecycleReadIndex >= 0 &&
        removalIndex > lifecycleReadIndex &&
        disabledIndex > removalIndex &&
        canaryIndex > disabledIndex &&
        activeIndex > canaryIndex,
      `${name}: merge readback, legacy removal, Disabled, canary, Active order`,
    );
  }
});

test("installation runbooks require read-only default workflow permissions", () => {
  for (const [name, guide] of Object.entries(installGuides)) {
    assert.match(guide, /repos\/\$REPO\/actions\/permissions\/workflow/u, name);
    assert.match(guide, /default_workflow_permissions/u, name);
    assert.match(guide, /test "\$DEFAULT_WORKFLOW_PERMISSIONS" = read/u, name);
    assert.match(guide, /(?:separate\s+authorisation|另行取得授权)/iu, name);
    assert.match(guide, /(?:read\s+the\s+endpoint\s+back|读回\s*(?:该\s*)?endpoint)/iu, name);
  }
});

test("installation runbooks inventory rulesets and classic legacy contexts", () => {
  for (const [name, guide] of Object.entries(installGuides)) {
    assert.match(guide, /effective\s+repository\s+rulesets/iu, name);
    assert.match(guide, /classic branch protection/iu, name);
    assert.match(guide, /codex\/review-gate/u, name);
    assert.match(guide, /(?:remove (?:it|the context) manually|人工移除)/iu, name);
    assert.match(guide, /fails?\s+closed/iu, name);
    assert.match(guide, /inconclusive/iu, name);
  }
});

test("Chinese installation docs preserve wider existing ruleset targets", () => {
  for (const name of ["human.zh-CN.md", "agent.zh-CN.md"]) {
    const guide = installGuides[name];
    assert.match(guide, /新建[^。\n]*default(?: branch)?/iu, name);
    assert.match(guide, /existing[^。\n]*同名 ruleset/iu, name);
    assert.match(guide, /更广[^。\n]*targets/iu, name);
    assert.match(guide, /保留/iu, name);
    assert.match(guide, /核对/iu, name);
  }
});

test("cookbook persists the expanded profile through the repository variable", () => {
  for (const name of ["COOKBOOK.md", "COOKBOOK.zh-CN.md"]) {
    const cookbook = packageDocs[name];
    assert.match(
      cookbook,
      /gh variable set CODEX_REVIEW_GATE_LIMITS_PROFILE/u,
      name,
    );
    assert.match(cookbook, /--body expanded/u, name);
    assert.match(
      cookbook,
      /(?:must not|do not|不得|不要)[\s\S]{0,100}canonical\s+(?:wrapper|workflow)/iu,
      name,
    );
  }
});

test("cookbook starts from all three installed consumer assets", () => {
  for (const name of ["COOKBOOK.md", "COOKBOOK.zh-CN.md"]) {
    const introduction = packageDocs[name].slice(0, packageDocs[name].indexOf("## "));
    assert.match(introduction, /canonical[\s\S]{0,80}workflow/iu, name);
    assert.match(introduction, /managed `?\.github\/CODEOWNERS|受管 `?\.github\/CODEOWNERS/iu, name);
    assert.match(introduction, /disabled[\s\S]{0,100}ruleset/iu, name);
  }
});

test("agent activation closure rereads canary authority and the complete written policy", () => {
  const sections = {
    "agent.md": "## Phase 5: prove the canary and activate protection",
    "agent.zh-CN.md": "## 阶段 5：证明 canary、启用保护并清理",
  };
  for (const [name, heading] of Object.entries(sections)) {
    const activation = markdownSection(installGuides[name], heading);
    assert.match(activation, /(?:re-read|重读)[\s\S]{0,120}canary[\s\S]{0,120}lifecycle/iu, name);
    assert.match(activation, /base(?:[\s/,]+)head/iu, name);
    assert.match(activation, /exact feature-head verifier\s+run\/job\/CheckRun/iu, name);
    assert.match(activation, /(?:(?:before)[\s\S]{0,100}(?:active|enable)|(?:active|启用)[\s\S]{0,100}立即前)[\s\S]{0,100}(?:POST|PUT|write)/iu, name);
    assert.match(activation, /(?:(?:after|后)[\s\S]{0,80}(?:write|写入)|write 后)[\s\S]{0,120}exact ruleset/iu, name);
    assert.match(activation, /complete consumer security\s+snapshot|完整 consumer\s+security snapshot/iu, name);
  }
});

test("package docs preserve reaction liveness and pending recovery semantics", () => {
  for (const name of [
    "README.md",
    "README.zh-CN.md",
    "DESIGN.md",
    "DESIGN.zh-CN.md",
    "COOKBOOK.md",
    "COOKBOOK.zh-CN.md",
  ]) {
    const guide = packageDocs[name];
    assert.match(
      guide,
      /ordinary request reactions?[\s\S]{0,100}liveness/iu,
      name,
    );
    assert.match(
      guide,
      /ordinary[\s\S]{0,100}\+1[\s\S]{0,100}(?:cannot|does not|不能|不得)[\s\S]{0,80}(?:head-bind|绑定)/iu,
      name,
    );
    assert.match(guide, /same(?:-time| timestamp)?\/later official `?eyes`?\/progress/iu, name);
    assert.match(
      guide,
      /later\s+provider\s+event\s+or\s+manual\s+reconcile/iu,
      name,
    );
    assert.match(
      guide,
      /`healthy\/pending`[\s\S]{0,140}(?:cannot|不能|不得)[\s\S]{0,100}(?:authorise|authorize|授权) success/iu,
      name,
    );
    assert.match(guide, /recovery_code/u, name);
    assert.match(
      guide,
      /only\s+`wait_provider`[\s\S]{0,100}pure wait/iu,
      name,
    );
  }
});

test("release docs bind artifact retention to the approval window", () => {
  for (const [name, guide] of Object.entries(releaseGuides)) {
    assert.match(
      guide,
      /`plan`[\s\S]{0,140}candidate A\/B[\s\S]{0,140}(?:one day|1 天)/iu,
      name,
    );
    assert.match(
      guide,
      /assembled[\s\S]{0,120}candidate[\s\S]{0,120}publication plan[\s\S]{0,120}35\s+(?:days|天)/iu,
      name,
    );
    assert.match(
      guide,
      /35\s+(?:days|天)[\s\S]{0,160}30[- ](?:day|天)/iu,
      name,
    );
  }

  for (const [step, days] of [
    ["Upload release plan", 1],
    ["Upload candidate A", 1],
    ["Upload candidate B", 1],
    ["Upload assembled candidate", 35],
    ["Upload publication plan", 35],
  ]) {
    assert.match(
      publisherWorkflow,
      new RegExp(`${step}[\\s\\S]{0,420}retention-days: ${days}`, "u"),
      step,
    );
  }
});

test("release docs define the default-branch RC bridge and closed verification recovery", () => {
  for (const [name, guide] of Object.entries(releaseGuides)) {
    for (const required of [
      /@v2\.0\.0-rc\.N/u,
      /test consumer/iu,
      /owner-reviewed/iu,
      /default branch/iu,
      /selector-only/iu,
      /begin-review/u,
      /reconcile/u,
      /exact head/iu,
      /resolved tag/iu,
      /forward PR/iu,
      /production bootstrap `@v2`/iu,
      /PR-local wrapper/iu,
      /non-default dispatch/iu,
      /dedicated canary job/iu,
      /closed recovery/iu,
      /exact pre-bridge/iu,
      /(?:only[^.。]{0,120}(?:originally|原本)[^.。]{0,120}@v2|若原状态[^.。]{0,120}@v2)/iu,
      /(?:otherwise[^.。]{0,120}remove|否则[^.。]{0,120}删除)/iu,
    ]) {
      assert.match(guide, required, `${name}: ${required}`);
    }
  }
});

test("consumer routing fixes automatic reconciliation and permits only reviewed profiles", () => {
  const verifier = parseVerifierWorkflow(templateConsumer);
  const controller = parseControllerWorkflow(templateController);
  assert.deepEqual(blockScalarMapping(verifier.with), {
    github_token: "${{ github.token }}",
    pr_number: "${{ github.event.pull_request.number }}",
    expected_head_sha: "${{ github.event.pull_request.head.sha }}",
    operation: "reconcile",
    request_review: "false",
    limits_profile:
      "${{ vars.CODEX_REVIEW_GATE_LIMITS_PROFILE == 'expanded' && 'expanded' || 'default' }}",
  });
  assert.deepEqual(blockScalarMapping(controller.with), {
    github_token: "${{ github.token }}",
    pr_number:
      "${{ github.event_name == 'workflow_dispatch' && inputs.pr_number || github.event.issue.number }}",
    expected_head_sha:
      "${{ github.event_name == 'workflow_dispatch' && inputs.expected_head_sha || '' }}",
    operation:
      "${{ github.event_name == 'workflow_dispatch' && inputs.operation || 'reconcile' }}",
    request_comment_id:
      "${{ github.event_name == 'workflow_dispatch' && inputs.request_comment_id || github.event.comment.id }}",
    request_review:
      "${{ github.event_name == 'workflow_dispatch' && inputs.operation == 'begin-review' && inputs.request_review || false }}",
    limits_profile:
      "${{ vars.CODEX_REVIEW_GATE_LIMITS_PROFILE == 'expanded' && 'expanded' || 'default' }}",
  });
  for (const source of [templateConsumer, templateController]) {
    assert.doesNotMatch(source, /inputs\.limits_profile/u);
    assert.doesNotMatch(source, /CODEX_REVIEW_GATE_MAX_(?:PAGES|OBJECTS)/u);
    assert.doesNotMatch(source, /\$\{\{\s*secrets\.|env\./u);
  }
});

test("verifier cancellation and controller serialization use separate PR concurrency namespaces", () => {
  const verifier = parseVerifierWorkflow(templateConsumer);
  const controller = parseControllerWorkflow(templateController);
  assert.deepEqual(blockScalarMapping(verifier.concurrency), {
    group:
      "codex-review-gate-verifier-${{ github.repository }}-${{ github.event.pull_request.number }}",
    "cancel-in-progress": "true",
  });
  assert.deepEqual(blockScalarMapping(controller.concurrency), {
    group:
      "codex-review-gate-controller-${{ github.repository }}-${{ github.event.issue.number || inputs.pr_number }}",
    "cancel-in-progress": "false",
  });
});

test("security structure rejects extra jobs, steps, and execution escape keys", () => {
  const verifierMutations = [
    templateConsumer.replace(
      "jobs:\n",
      "jobs:\n  attacker:\n    runs-on: ubuntu-slim\n    steps: []\n",
    ),
    templateConsumer.replace(
      "          limits_profile:",
      "      - uses: attacker/action@v1\n          limits_profile:",
    ),
    templateConsumer.replace(
      "        id: gate",
      "        id: gate\n        run: echo bypass",
    ),
    templateConsumer.replace(
      "        id: gate",
      "        id: gate\n        'run': echo bypass",
    ),
    templateConsumer.replace(
      "    timeout-minutes: 14",
      "    timeout-minutes: 14\n    services:\n      helper:\n        image: attacker/image",
    ),
    templateConsumer.replace(
      "    timeout-minutes: 14",
      "    timeout-minutes: 14\n    <<: *attacker-job",
    ),
    templateConsumer.replace(
      "vars.CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION == 'any' && 'any' || 'write'",
      "vars.CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION",
    ),
  ];
  const controllerMutations = [
    templateController.replace(
      "github.event.comment.user.type == 'Bot'",
      "github.event.comment.user.type == 'Bot' || true",
    ),
    templateController.replace(
      "github.event.action == 'created' || github.event.action == 'edited'",
      "github.event.action == 'edited' || github.event.action == 'created'",
    ),
  ];
  for (const mutation of verifierMutations) {
    assert.throws(() => parseVerifierWorkflow(mutation));
  }
  for (const mutation of controllerMutations) {
    assert.throws(() => parseControllerWorkflow(mutation));
  }
});

test("installation guides use only the default-branch workflow dispatch API", () => {
  for (const [name, guide] of Object.entries(installGuides)) {
    assert.match(guide, /gh workflow run/u, name);
    assert.match(guide, /workflow_dispatch/u, name);
    assert.match(guide, /(?:-f|--field)\s+pr_number=/u, name);
    assert.match(guide, /(?:-f|--field)\s+expected_head_sha=/u, name);
    const dispatchCommands = shellCodeBlocks(guide).filter((block) =>
      block.includes("gh workflow run"),
    );
    assert.ok(dispatchCommands.length > 0, `${name}: missing workflow dispatch command`);
    for (const command of dispatchCommands) {
      assert.doesNotMatch(
        command,
        /--ref|\/dispatches|repository_dispatch|client_payload|event_type/u,
        `${name}: unsupported manual dispatch command`,
      );
    }
    assert.doesNotMatch(
      shellCodeBlocks(guide).join("\n"),
      /repos\/[^\s]+\/dispatches|client_payload|event_type=codex-review-gate/u,
      `${name}: repository dispatch command must not be executable guidance`,
    );
  }
});

test("installation guides preserve the feature-head CheckRun and test-merge execution binding", () => {
  for (const [name, guide] of Object.entries(installGuides)) {
    assert.match(guide, /test-merge SHA/iu, name);
    assert.match(guide, /(?:native|原生)[\s\S]{0,80}CheckRun/iu, name);
    assert.match(
      guide,
      /(?:verifier run\/job\/CheckRun[\s\S]{0,160}feature-head\s+SHA|feature-head\s+SHA[\s\S]{0,160}verifier run\/job\/CheckRun)/iu,
      name,
    );
    assert.match(guide, /refs\/pull\/N\/merge/u, name);
    assert.match(guide, /GITHUB_REF/u, name);
    assert.match(guide, /GITHUB_SHA/u, name);
    assert.match(guide, /fresh PR[ -]read/iu, name);
    assert.match(guide, /ready_for_review/u, name);
    assert.match(guide, /(?:convert|转)[\s\S]{0,80}draft[\s\S]{0,80}(?:ready|标记 ready)/iu, name);
    assert.match(guide, /(?:status bridge|commit-status)/iu, name);
    assert.match(guide, /non-fast-forward/u, name);
  }
  for (const name of ["agent.md", "agent.zh-CN.md"]) {
    const guide = installGuides[name];
    assert.match(guide, /exact `headRefOid`/u, name);
    assert.match(guide, /codex\/github-review-gate/u, name);
  }
});

test("installation guides preserve the protected request-author policy boundary", () => {
  for (const [name, guide] of Object.entries(installGuides)) {
    assert.match(guide, /CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION/u, name);
    assert.match(guide, /\bwrite\b/u, name);
    assert.match(guide, /\bany\b/u, name);
    assert.match(guide, /finding/u, name);
  }
  const inputs = section(action, "inputs", "outputs");
  assert.doesNotMatch(inputs, /request_author_permission/u);
});

test("the JavaScript Action exposes only the adopted public outcome ABI", () => {
  const outputs = section(action, "outputs", "runs");
  assert.deepEqual(directKeys(outputs, 2), [
    "execution_health",
    "gate_outcome",
    "recovery_code",
    "retry_safe",
  ]);
  assert.doesNotMatch(
    outputs,
    /result-path|report-path|status-plan-path|reservation-path|intent-path|receipt|ledger|wakeup/u,
  );

  const runs = action.slice(action.indexOf("\nruns:\n"));
  assert.deepEqual(directKeys(runs, 2), ["using", "main"]);
  assert.match(runs, /^  using: node20$/mu);
  assert.match(runs, /^  main: src\/v2\/gate-runtime\.mjs$/mu);
  assert.doesNotMatch(
    runs,
    /composite|steps:|shell:|env:|src\/(?:gate|v2\/action)\.mjs|actions\/checkout|\bgh\b|\bcurl\b|npm\s+(?:ci|install)|operation-input-path|status-target-mode/u,
  );
});

test("the JavaScript Action exposes only the adopted public input ABI", () => {
  const inputs = section(action, "inputs", "outputs");
  assert.deepEqual(directKeys(inputs, 2), [
    "github_token",
    "pr_number",
    "expected_head_sha",
    "operation",
    "request_comment_id",
    "request_review",
    "limits_profile",
  ]);
  assert.doesNotMatch(
    inputs,
    /^  (?:github-token|pull-request|request-review|max-pages|max-objects|temporary|result-path|report-path|receipt|ledger|wakeup):/mu,
  );
});

function parseVerifierWorkflow(source) {
  assertNoForbiddenExecutionKeys(source);
  assert.equal(
    (source.match(/^\s*env:\s*$/gmu) ?? []).length,
    1,
    "consumer workflow must contain exactly one closed Action-step env mapping",
  );
  const root = yamlRoot(source);
  assert.deepEqual(blockDirectKeys(root), [
    "name",
    "on",
    "permissions",
    "concurrency",
    "jobs",
  ]);
  assert.equal(blockScalar(root, "name"), "Codex Review Gate Verifier");

  const events = blockChild(root, "on");
  assert.deepEqual(blockDirectKeys(events), ["pull_request"]);
  const pullRequest = blockChild(events, "pull_request");
  assert.deepEqual(blockDirectKeys(pullRequest), ["types"]);

  const permissions = blockChild(root, "permissions");
  assert.deepEqual(blockDirectKeys(permissions), [
    "contents",
    "issues",
    "pull-requests",
  ]);

  const concurrency = blockChild(root, "concurrency");
  assert.deepEqual(blockDirectKeys(concurrency), [
    "group",
    "cancel-in-progress",
  ]);

  const jobs = blockChild(root, "jobs");
  assert.deepEqual(blockDirectKeys(jobs), ["codex-review-gate"]);
  const job = blockChild(jobs, "codex-review-gate");
  assert.deepEqual(blockDirectKeys(job), [
    "name",
    "runs-on",
    "timeout-minutes",
    "steps",
  ]);
  assert.equal(blockScalar(job, "name"), "codex/github-review-gate");
  const actionStep = parseClosedActionStep(job, [
    "github_token",
    "pr_number",
    "expected_head_sha",
    "operation",
    "request_review",
    "limits_profile",
  ]);

  return {
    root,
    events,
    pullRequest,
    permissions,
    concurrency,
    jobs,
    job,
    ...actionStep,
  };
}

function parseControllerWorkflow(source) {
  assertNoForbiddenExecutionKeys(source);
  assert.equal(
    (source.match(/^\s*env:\s*$/gmu) ?? []).length,
    1,
    "controller workflow must contain exactly one closed Action-step env mapping",
  );
  const root = yamlRoot(source);
  assert.deepEqual(blockDirectKeys(root), [
    "name",
    "on",
    "permissions",
    "concurrency",
    "jobs",
  ]);
  assert.equal(blockScalar(root, "name"), "Codex Review Gate Controller");
  const events = blockChild(root, "on");
  assert.deepEqual(blockDirectKeys(events), ["issue_comment", "workflow_dispatch"]);
  const issueComment = blockChild(events, "issue_comment");
  const workflowDispatch = blockChild(events, "workflow_dispatch");
  assert.deepEqual(blockDirectKeys(issueComment), ["types"]);
  assert.deepEqual(blockDirectKeys(workflowDispatch), ["inputs"]);
  const dispatchInputs = blockChild(workflowDispatch, "inputs");
  const permissions = blockChild(root, "permissions");
  assert.deepEqual(blockDirectKeys(permissions), [
    "actions",
    "checks",
    "contents",
    "issues",
    "pull-requests",
  ]);
  const concurrency = blockChild(root, "concurrency");
  assert.deepEqual(blockDirectKeys(concurrency), ["group", "cancel-in-progress"]);
  const jobs = blockChild(root, "jobs");
  assert.deepEqual(blockDirectKeys(jobs), ["codex-review-gate-controller"]);
  const job = blockChild(jobs, "codex-review-gate-controller");
  assert.deepEqual(blockDirectKeys(job), [
    "name",
    "if",
    "runs-on",
    "timeout-minutes",
    "steps",
  ]);
  assert.equal(blockScalar(job, "name"), "codex/review-gate-controller");
  assert.equal(blockScalar(job, "if"), ">-");
  assert.equal(
    foldedScalarBody(job, "if"),
    CLOSED_JOB_IF,
    "controller job.if must be the complete normalized closed admission expression",
  );
  const actionStep = parseClosedActionStep(job, [
    "github_token",
    "pr_number",
    "expected_head_sha",
    "operation",
    "request_comment_id",
    "request_review",
    "limits_profile",
  ]);
  return {
    root,
    events,
    issueComment,
    workflowDispatch,
    dispatchInputs,
    permissions,
    concurrency,
    jobs,
    job,
    ...actionStep,
  };
}

function parseClosedActionStep(job, expectedWithKeys) {
  const steps = listItemBlocks(blockChild(job, "steps"));
  assert.equal(steps.length, 1, "consumer workflow must contain exactly one step");
  assert.deepEqual(itemKeys(steps[0]), ["name", "id", "uses", "env", "with"]);
  const envBlock = itemChildBlock(steps[0], "env");
  assert.deepEqual(blockDirectKeys(envBlock), [
    "CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION",
  ]);
  assert.equal(
    blockScalar(envBlock, "CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION"),
    "${{ vars.CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION == 'any' && 'any' || 'write' }}",
  );
  const withBlock = itemChildBlock(steps[0], "with");
  assert.deepEqual(blockDirectKeys(withBlock), expectedWithKeys);
  return {
    steps,
    env: envBlock,
    with: withBlock,
  };
}

function assertNoForbiddenExecutionKeys(source) {
  assert.doesNotMatch(source, /\t/u, "workflow YAML must not contain tabs");
  assert.doesNotMatch(
    source,
    /^\s*(?:-\s+)?["'][^"']+["']\s*:/mu,
    "workflow YAML must not use quoted mapping keys",
  );
  assert.doesNotMatch(
    source,
    /^\s*(?:-\s+)?<<:|:\s*[&*!][A-Za-z0-9_-]+(?:\s|$)/mu,
    "workflow YAML must not use anchors, aliases, tags, or merge keys",
  );
  const forbidden = new Set(["run", "shell", "container", "services"]);
  for (const line of source.split(/\r?\n/u)) {
    const match = line.match(/^\s*(?:-\s+)?([A-Za-z0-9_-]+):(?:\s|$)/u);
    if (match !== null && forbidden.has(match[1])) {
      assert.fail(`consumer workflow must not contain ${match[1]} at any level`);
    }
  }
}

function yamlRoot(source) {
  const lines = source.split(/\r?\n/u);
  for (const line of lines) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      continue;
    }
    const indent = line.match(/^ */u)[0].length;
    assert.equal(indent % 2, 0, `unsupported odd YAML indentation: ${line}`);
    assert.doesNotMatch(
      line,
      /^\s*(?:-\s+)?\{/u,
      "workflow YAML must not use flow mappings",
    );
  }
  return { lines, headerIndent: -2, start: 0, end: lines.length };
}

function blockChild(parent, key) {
  const keyIndex = blockDirectKeyIndex(parent, key);
  const keyIndent = parent.headerIndent + 2;
  assert.match(
    parent.lines[keyIndex],
    new RegExp(`^ {${keyIndent}}${escapeRegExp(key)}:\\s*(?:#.*)?$`, "u"),
    `${key} must introduce a YAML mapping block`,
  );
  return nestedBlock(parent, keyIndex, keyIndent);
}

function nestedBlock(parent, keyIndex, keyIndent) {
  let end = parent.end;
  for (let cursor = keyIndex + 1; cursor < parent.end; cursor += 1) {
    if (isIgnorable(parent.lines[cursor])) {
      continue;
    }
    if (indentOf(parent.lines[cursor]) <= keyIndent) {
      end = cursor;
      break;
    }
  }
  return {
    lines: parent.lines,
    headerIndent: keyIndent,
    start: keyIndex + 1,
    end,
  };
}

function blockDirectKeys(block) {
  const expectedIndent = block.headerIndent + 2;
  const pattern = new RegExp(
    `^ {${expectedIndent}}([A-Za-z0-9_-]+):(?:\\s|$)`,
    "u",
  );
  const keys = [];
  for (let index = block.start; index < block.end; index += 1) {
    const match = block.lines[index].match(pattern);
    if (match !== null) {
      keys.push(match[1]);
    }
  }
  return keys;
}

function blockDirectKeyIndex(block, key) {
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
  assert.equal(matches.length, 1, `expected exactly one direct YAML key ${key}`);
  return matches[0];
}

function blockScalar(block, key) {
  const index = blockDirectKeyIndex(block, key);
  const expectedIndent = block.headerIndent + 2;
  const match = block.lines[index].match(
    new RegExp(
      `^ {${expectedIndent}}${escapeRegExp(key)}:\\s*(.*?)\\s*(?:#.*)?$`,
      "u",
    ),
  );
  assert.ok(match, `missing scalar YAML key ${key}`);
  assert.notEqual(match[1], "", `${key} must be a YAML scalar`);
  return match[1];
}

function blockScalarMapping(block) {
  return Object.fromEntries(
    blockDirectKeys(block).map((key) => [key, blockScalar(block, key)]),
  );
}

function foldedScalarBody(block, key) {
  assert.equal(blockScalar(block, key), ">-");
  const index = blockDirectKeyIndex(block, key);
  const keyIndent = block.headerIndent + 2;
  const body = [];
  for (let cursor = index + 1; cursor < block.end; cursor += 1) {
    if (!isIgnorable(block.lines[cursor]) && indentOf(block.lines[cursor]) <= keyIndent) {
      break;
    }
    body.push(block.lines[cursor].trim());
  }
  assert.ok(body.length > 0, `${key} folded scalar must have a body`);
  return body.join(" ").replace(/\s+/gu, " ").trim();
}

function listItemBlocks(block) {
  const itemIndent = block.headerIndent + 2;
  const starts = [];
  const pattern = new RegExp(`^ {${itemIndent}}-\\s+`, "u");
  for (let index = block.start; index < block.end; index += 1) {
    if (pattern.test(block.lines[index])) {
      starts.push(index);
    }
  }
  return starts.map((start, offset) => ({
    lines: block.lines,
    itemIndent,
    start,
    end: starts[offset + 1] ?? block.end,
  }));
}

function itemKeys(item) {
  const keys = [];
  const first = item.lines[item.start].match(
    new RegExp(`^ {${item.itemIndent}}-\\s+([A-Za-z0-9_-]+):(?:\\s|$)`, "u"),
  );
  assert.ok(first, "list item must begin with a mapping key");
  keys.push(first[1]);
  const pattern = new RegExp(
    `^ {${item.itemIndent + 2}}([A-Za-z0-9_-]+):(?:\\s|$)`,
    "u",
  );
  for (let index = item.start + 1; index < item.end; index += 1) {
    const match = item.lines[index].match(pattern);
    if (match !== null) {
      keys.push(match[1]);
    }
  }
  return keys;
}

function itemScalar(item, key) {
  const matches = [];
  const firstPattern = new RegExp(
    `^ {${item.itemIndent}}-\\s+${escapeRegExp(key)}:\\s*(.*?)\\s*(?:#.*)?$`,
    "u",
  );
  const laterPattern = new RegExp(
    `^ {${item.itemIndent + 2}}${escapeRegExp(key)}:\\s*(.*?)\\s*(?:#.*)?$`,
    "u",
  );
  for (let index = item.start; index < item.end; index += 1) {
    const match = item.lines[index].match(index === item.start ? firstPattern : laterPattern);
    if (match !== null) {
      matches.push(match[1]);
    }
  }
  assert.equal(matches.length, 1, `expected exactly one list-item YAML key ${key}`);
  assert.notEqual(matches[0], "", `${key} must be a YAML scalar`);
  return matches[0];
}

function itemChildBlock(item, key) {
  const expectedIndent = item.itemIndent + 2;
  const pattern = new RegExp(
    `^ {${expectedIndent}}${escapeRegExp(key)}:\\s*(?:#.*)?$`,
    "u",
  );
  const matches = [];
  for (let index = item.start + 1; index < item.end; index += 1) {
    if (pattern.test(item.lines[index])) {
      matches.push(index);
    }
  }
  assert.equal(matches.length, 1, `expected exactly one mapping key ${key}`);
  return nestedBlock(item, matches[0], expectedIndent);
}

function isIgnorable(line) {
  return line.trim() === "" || line.trimStart().startsWith("#");
}

function indentOf(line) {
  return line.match(/^ */u)[0].length;
}

function section(source, startName, endName) {
  const start = source.indexOf(`${startName}:\n`);
  assert.notEqual(start, -1, `missing ${startName}`);
  const end = source.indexOf(`\n${endName}:\n`, start + startName.length + 2);
  assert.notEqual(end, -1, `missing ${endName} after ${startName}`);
  return source.slice(start, end + 1);
}

function directKeys(source, indent) {
  const pattern = new RegExp(`^ {${indent}}([A-Za-z0-9_-]+):(?:\\s|$)`, "gmu");
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

function shellCodeBlocks(source) {
  return [...source.matchAll(/```(?:bash|sh)\n([\s\S]*?)```/gu)].map(
    (match) => match[1],
  );
}

function markdownSection(source, heading) {
  const marker = `${heading}\n`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing Markdown section ${heading}`);
  const level = heading.match(/^#+/u)?.[0].length;
  assert.ok(level, `invalid Markdown heading ${heading}`);
  const followingHeading = new RegExp(`\\n#{1,${level}}\\s+`, "gu");
  followingHeading.lastIndex = start + marker.length;
  const next = followingHeading.exec(source);
  return source.slice(start, next?.index ?? source.length);
}

function shellInvocations(source, startPattern) {
  const invocations = [];
  for (const block of shellCodeBlocks(source)) {
    const lines = block.split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      startPattern.lastIndex = 0;
      if (!startPattern.test(lines[index].trimStart())) {
        continue;
      }
      const invocation = [lines[index]];
      while (invocation.at(-1).trimEnd().endsWith("\\")) {
        index += 1;
        assert.ok(index < lines.length, "unterminated shell continuation");
        invocation.push(lines[index]);
      }
      invocations.push(invocation.join("\n"));
    }
  }
  return invocations;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
