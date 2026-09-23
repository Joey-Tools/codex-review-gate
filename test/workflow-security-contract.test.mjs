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
import {
  canonicalLegacyReviewGateInventoryBytes,
  validateCanonicalV2ControllerWorkflowContent,
  validateCanonicalLegacyBridgeWorkflowContent,
  workflowSingleProducerPolicyViolations,
} from "../src/bootstrap.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const actionPath = join(repoRoot, "packages/action/action.yml");
const sourceConsumerPath = join(
  repoRoot,
  ".github/workflows/codex-review-gate.yml",
);
const sourceControllerPath = join(
  repoRoot,
  ".github/workflows/codex-review-gate-controller.yml",
);
const sourceLegacyBridgePath = join(
  repoRoot,
  ".github/workflows/codex-review-gate-legacy-bridge.yml",
);
const sourceCodeownersPath = join(repoRoot, ".github/CODEOWNERS");
const sourceStateMachinePath = join(repoRoot, ".github/workflows/state-machine.yml");
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
const legacyInventoryCanonicalizerPath = join(
  repoRoot,
  "scripts/canonicalize-legacy-review-gate-inventory.mjs",
);
const legacyInventoryCanonicalizer = readFileSync(
  legacyInventoryCanonicalizerPath,
  "utf8",
);
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
const ACTIVE_V2_READBACK_PATTERN =
  /(?:activate(?:d)?|activation|激活)[\s\S]{0,220}?(?:read\s+back[\s\S]{0,100}?(?:Active\s+(?:policy|readback)|complete\s+Active)|(?:Active\s+policy|complete\s+Active)[\s\S]{0,40}?back|Active\s+readback|读回[\s\S]{0,100}?(?:完整\s+Active|Active\s+policy))/iu;

const action = readFileSync(actionPath, "utf8");
const sourceConsumer = readFileSync(sourceConsumerPath, "utf8");
const sourceController = readFileSync(sourceControllerPath, "utf8");
const sourceLegacyBridge = readFileSync(sourceLegacyBridgePath, "utf8");
const sourceCodeowners = readFileSync(sourceCodeownersPath, "utf8");
const sourceStateMachine = readFileSync(sourceStateMachinePath, "utf8");
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

test("source self-installation matches canonical v2 assets and contains its temporary v1 bridge", () => {
  const verifier = parseVerifierWorkflow(sourceConsumer);
  const controller = parseControllerWorkflow(sourceController);
  assert.equal(sourceConsumer, templateConsumer);
  assert.equal(sourceController, templateController);
  assert.equal(sourceCodeowners, templateCodeowners);
  assert.equal(
    validateCanonicalLegacyBridgeWorkflowContent(sourceLegacyBridge),
    sourceLegacyBridge,
  );
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

test("source state-machine check names have a static non-reserved prefix", () => {
  assert.match(
    sourceStateMachine,
    /^    name: Review gate state machine\$\{\{ matrix\.check-suffix \}\}$/mu,
  );
  assert.match(sourceStateMachine, /^            check-suffix: ""$/mu);
  assert.match(sourceStateMachine, /^            check-suffix: " Node\.js 24"$/mu);
  assert.deepEqual(workflowSingleProducerPolicyViolations(sourceStateMachine), []);
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
    "pull-requests": "write",
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

test("installation docs reserve prerelease selectors for both RC bridge forms", () => {
  for (const [name, guide] of Object.entries(installGuides)) {
    assert.match(guide, /temporary\s+RC\s+admission\s+bridge/iu, name);
    assert.match(
      guide,
      /installed-consumer[\s\S]{0,80}fresh(?:-fixture|\s+fixture)/iu,
      name,
    );
    assert.match(
      guide,
      /(?:neither|两者都)[\s\S]{0,100}(?:consumer\s+installation|installation)/iu,
      name,
    );
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

test("public package docs keep legacy active through v2 activation before cleanup", () => {
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
    const disabledOffset = section.slice(approvedScope).search(/Disabled/u);
    const disabled = disabledOffset < 0 ? -1 : approvedScope + disabledOffset;
    const canaryOffset = section.slice(disabled).search(/canary/iu);
    const canary = canaryOffset < 0 ? -1 : disabled + canaryOffset;
    const activeReadbackEnd = matchEndAfter(
      section,
      canary,
      ACTIVE_V2_READBACK_PATTERN,
    );
    const cleanupOffset = section.slice(activeReadbackEnd).search(
      /(?:(?:cleanup|remove|removal|移除|删除)[\s\S]{0,120}(?:legacy|inventoried)|(?:legacy|inventoried)[\s\S]{0,80}(?:cleanup|remove|removal|移除|删除))/iu,
    );
    const cleanup = cleanupOffset < 0 ? -1 : activeReadbackEnd + cleanupOffset;
    assert.ok(
      merge >= 0 &&
        readback > merge &&
        approvedScope >= readback &&
        disabled > approvedScope &&
        canary > disabled &&
        activeReadbackEnd > canary &&
        cleanup >= activeReadbackEnd,
      `${name}: merge < scope readback < Disabled stage < canary < Active readback < legacy cleanup`,
    );
    assert.match(section, /(?:failed readback|readback fails|readback 失败|failure|失败)[\s\S]{0,100}(?:keep|preserve|保留)[\s\S]{0,80}legacy/iu, name);
    assert.match(
      section.slice(cleanup),
      /(?:(?:both|两个)[\s\S]{0,40}legacy\s+surfaces[\s\S]{0,100}(?:v2|Active)|(?:v2|Active)[\s\S]{0,100}(?:both|两个)[\s\S]{0,40}legacy\s+surfaces)/iu,
      `${name}: final closure proves both legacy surfaces clear and v2 Active`,
    );
  }
});

test("documentation ordering treats completed Active readback as the cleanup boundary", () => {
  const valid =
    "canary; activate v2 and read back the complete Active policy; legacy cleanup";
  const invalid =
    "canary; activate v2; legacy cleanup; then read back the complete Active policy";
  const validEnd = matchEndAfter(valid, valid.indexOf("canary"), ACTIVE_V2_READBACK_PATTERN);
  const invalidEnd = matchEndAfter(
    invalid,
    invalid.indexOf("canary"),
    ACTIVE_V2_READBACK_PATTERN,
  );

  assert.ok(validEnd > 0);
  assert.match(valid.slice(validEnd), /legacy cleanup/u);
  assert.ok(invalidEnd > 0);
  assert.doesNotMatch(invalid.slice(invalidEnd), /legacy cleanup/u);
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

test("cohort guides bind v1 bridge recovery separately from v2 reconcile", () => {
  for (const [name, guide] of Object.entries(installGuides)) {
    const recovery = markdownSection(
      guide,
      "### Dual-protection legacy-status recovery",
    );
    const rerunEndpoint = "repos/$REPO/actions/runs/$LEGACY_RUN_ID/rerun";
    assert.equal(
      (recovery.match(
        /repos\/\$REPO\/actions\/runs\/\$LEGACY_RUN_ID\/rerun/gu,
      ) ?? []).length,
      1,
      `${name}: require exactly one exact legacy bridge rerun endpoint`,
    );
    const recoveryGhInvocations = executableGhInvocations(recovery);
    const rerunInvocations = recoveryGhInvocations.filter(
      ({ words }) => words.includes(rerunEndpoint),
    );
    assert.equal(
      rerunInvocations.length,
      1,
      `${name}: require exactly one executable legacy bridge rerun request`,
    );
    const [rerunInvocation] = rerunInvocations;
    assert.equal(rerunInvocation.command, "api", name);
    const postInvocations = recoveryGhInvocations.filter(({ words }) =>
      words.some(
        (word, index) =>
          ((word === "--method" || word === "-X") &&
            words[index + 1] === "POST") ||
          word === "--method=POST" ||
          word === "-XPOST",
      ),
    );
    assert.equal(
      postInvocations.length,
      1,
      `${name}: recovery contains one executable POST in total`,
    );
    assert.equal(postInvocations[0].text, rerunInvocation.text, name);
    assert.equal(
      rerunInvocation.words.filter((word) => word === "--method").length,
      1,
      `${name}: rerun request has one explicit method`,
    );
    assert.equal(
      rerunInvocation.words[
        rerunInvocation.words.indexOf("--method") + 1
      ],
      "POST",
      `${name}: rerun request is the sole POST to the exact endpoint`,
    );
    assert.equal(
      rerunInvocation.words.filter((word) => word === "--include").length,
      1,
      `${name}: capture the rerun HTTP response headers`,
    );
    const apiVersionHeaderIndices = rerunInvocation.words.flatMap(
      (word, index) =>
        word === "--header" &&
        rerunInvocation.words[index + 1] ===
          "X-GitHub-Api-Version: 2026-03-10"
          ? [index]
          : [],
    );
    assert.equal(
      apiVersionHeaderIndices.length,
      1,
      `${name}: pin the rerun request to one literal GitHub API version`,
    );
    assert.match(
      recovery,
      /test\s+!\s+-e\s+"\$LEGACY_RERUN_RECEIPT"/u,
      `${name}: refuse to overwrite an existing rerun receipt`,
    );
    assert.match(
      recovery,
      /repos\/\$REPO\/actions\/runs\/\$LEGACY_RUN_ID\/rerun"?[\s\\]*>[\s\\]*"\$LEGACY_RERUN_RECEIPT"/u,
      `${name}: capture the unique POST response as the rerun receipt`,
    );
    assert.match(
      recovery,
      /read\s+-r[\s\\]+LEGACY_RERUN_HTTP_VERSION\s+LEGACY_RERUN_HTTP_STATUS[\s\S]{0,120}<\s*"\$LEGACY_RERUN_RECEIPT"/u,
      `${name}: parse the captured HTTP receipt`,
    );
    assert.match(
      recovery,
      /case\s+"\$LEGACY_RERUN_HTTP_VERSION"[\s\S]{0,160}HTTP\/1\.1[\s\S]{0,80}HTTP\/2[\s\S]{0,80}HTTP\/3/u,
      `${name}: validate the captured HTTP status-line version token`,
    );
    assert.match(
      recovery,
      /test\s+"\$LEGACY_RERUN_GH_EXIT"\s+-ne\s+0/u,
      `${name}: a nonzero gh exit leaves the rerun outcome inconclusive`,
    );
    assert.match(
      recovery,
      /test\s+"\$LEGACY_RERUN_HTTP_STATUS"\s+=\s+"?201"?/u,
      `${name}: accept only a captured HTTP 201 receipt`,
    );
    assert.match(
      recovery,
      /(?:Submit the POST once|POST[^。；\n]{0,30}(?:只能|仅能)[^。；\n]{0,20}(?:一次|1 次))/iu,
      `${name}: submit the rerun POST once`,
    );
    assert.match(
      recovery,
      /(?:do not|never|不得|禁止)[^。\n]{0,50}(?:replay|再次提交|第二次 POST)/iu,
      `${name}: never replay an unconfirmed rerun POST`,
    );
    const runInventoryStart = recovery.indexOf(
      "actions/workflows/$LEGACY_WORKFLOW_ID/runs",
    );
    const eligibilityStart = recovery.indexOf("created_at", runInventoryStart);
    assert.ok(runInventoryStart >= 0, `${name}: workflow-run inventory endpoint`);
    assert.ok(
      eligibilityStart > runInventoryStart,
      `${name}: workflow-run inventory precedes candidate eligibility`,
    );
    const runInventoryContract = recovery.slice(
      runInventoryStart,
      eligibilityStart,
    );
    assert.match(
      runInventoryContract,
      /(?:complete paginated|完整分页) workflow-run inventory/iu,
      `${name}: enumerate the complete paginated workflow-run inventory`,
    );
    assert.match(
      runInventoryContract,
      /(?:same[^.。\n]{0,80}total_count|total_count[^.。\n]{0,80}(?:same|相同))/iu,
      `${name}: every workflow-run page has the same total_count`,
    );
    assert.match(
      runInventoryContract,
      /(?:non-final page|非末页)[^.。\n]{0,80}(?:full|100|满)/iu,
      `${name}: every non-final workflow-run page is full`,
    );
    assert.match(
      runInventoryContract,
      /flatten(?:ed)?[\s\S]{0,80}(?:equals?|等于)[\s\S]{0,30}total_count/iu,
      `${name}: flattened workflow-run count equals total_count`,
    );
    assert.match(
      runInventoryContract,
      /1,?000-result[\s\S]{0,120}(?:ceiling|cap)[\s\S]{0,160}(?:inconclusive|empty set|空集合|不能证明)/iu,
      `${name}: the filtered-search 1000-result cap fails closed`,
    );
    assert.match(
      runInventoryContract,
      /(?:duplicate\s+run ID across pages|跨页重复 run ID)/iu,
      `${name}: duplicate run IDs fail closed`,
    );
    assert.match(
      runInventoryContract,
      /(?:(?:reread|重读|复读)[\s\S]{0,80}(?:page[ -]?1|第一页)[\s\S]{0,140}(?:identical query|完全相同的 query)|(?:identical query|完全相同的 query)[\s\S]{0,80}(?:reread|重读|复读)[\s\S]{0,80}(?:page[ -]?1|第一页))/iu,
      `${name}: re-read workflow-run page 1 with the identical query`,
    );
    assert.match(
      runInventoryContract,
      /canonical\s+JSON[\s\S]{0,100}total_count[\s\S]{0,80}(?:ordered runs|有序 runs)/iu,
      `${name}: bind the workflow-run horizon to total_count and ordered runs`,
    );
    assert.match(
      runInventoryContract,
      /pagination horizon[\s\S]{0,100}(?:invalidates|restart|无效|重新开始)/iu,
      `${name}: reject a changed workflow-run pagination horizon`,
    );

    assert.match(
      recovery,
      /(?:Only|只有|仅当)[\s\S]{0,120}(?:cardinality )?zero[\s\S]{0,180}(?:draft-to-ready|draft[\s\S]{0,40}ready)/iu,
      `${name}: draft-to-ready fallback is reserved for zero candidates`,
    );
    assert.match(
      recovery,
      /(?:Exactly one|恰好一个)[\s\S]{0,40}candidate[\s\S]{0,80}(?:proceed|继续)/iu,
      `${name}: exactly one candidate may proceed to rerun`,
    );
    assert.match(
      recovery,
      /(?:more than one|多于一个|超过一个)[\s\S]{0,140}(?:stop|inconclusive|停止|终止|不确定)/iu,
      `${name}: multiple candidates stop as inconclusive`,
    );

    assert.match(
      recovery,
      /base\s+repository\/ref\/SHA[\s\S]{0,100}\$REPO[\s\S]{0,80}DEFAULT_BRANCH[\s\S]{0,80}DEFAULT_BRANCH_HEAD_SHA/iu,
      `${name}: bind the current PR base repository, default branch, and base SHA`,
    );
    assert.match(
      recovery,
      /head_sha=\$CANARY_HEAD/u,
      `${name}: bind the run head_sha to the current feature head`,
    );
    assert.match(
      recovery,
      /DEFAULT_BRANCH_HEAD_SHA[\s\S]{0,100}(?:only by|只由)[\s\S]{0,60}pull_requests\[0\]\.base\.sha/iu,
      `${name}: bind the current base SHA only through the embedded PR`,
    );
    assert.match(
      recovery,
      /(?:never compare|不得)[\s\S]{0,100}(?:run\.)?head_sha[\s\S]{0,100}default-branch SHA/iu,
      `${name}: do not confuse the feature-head run SHA with the base SHA`,
    );
    assert.match(
      recovery,
      /actions\/workflows\/\$LEGACY_WORKFLOW_ID[\s\S]{0,200}state=active/iu,
      `${name}: bind the active current legacy-bridge workflow identity`,
    );
    const bridgeContentsStart = recovery.indexOf(
      "contents/.github/workflows/codex-review-gate-legacy-bridge.yml",
    );
    assert.ok(
      bridgeContentsStart >= 0 && bridgeContentsStart < runInventoryStart,
      `${name}: canonical bridge content read precedes run enumeration`,
    );
    const bridgeComparison = recovery.slice(
      bridgeContentsStart,
      runInventoryStart,
    );
    assert.match(
      bridgeComparison,
      /ref=\$DEFAULT_BRANCH_HEAD_SHA[\s\S]{0,360}(?:bytes exactly|逐 byte)/iu,
      `${name}: bind canonical bridge bytes at the current base SHA`,
    );
    assert.match(
      bridgeComparison,
      /\$SOURCE_ROOT\/templates\/codex-gated-repo\/\.github\/workflows\/codex-review-gate-legacy-bridge\.yml/u,
      `${name}: compare against the exact canonical SOURCE_ROOT bridge template`,
    );

    assert.match(
      recovery,
      /<canonical-path>@(?:<DEFAULT_BRANCH>|\$DEFAULT_BRANCH)[\s\S]{0,220}(?:Parse|解析)/iu,
      `${name}: parse the official workflow-run path@ref shape`,
    );
    assert.match(
      recovery,
      /(?:ref to equal|ref 必须精确等于)[\s\S]{0,60}(?<!refs\/heads\/)\$DEFAULT_BRANCH/iu,
      `${name}: bind the parsed workflow ref to the current default branch`,
    );
    assert.match(
      recovery,
      /recovery binding set[\s\S]{0,220}(?:selection[\s\S]{0,100}both sides of the write|candidate selection[\s\S]{0,100}write 前后)/iu,
      `${name}: define one binding set for selection and both sides of the POST`,
    );

    const inventoryEnd = matchEndAfter(
      recovery,
      0,
      /(?:complete paginated|完整分页) workflow-run inventory/iu,
    );
    const horizonEnd = matchEndAfter(
      recovery,
      inventoryEnd,
      /pagination horizon/iu,
    );
    const candidateEnd = matchEndAfter(
      recovery,
      horizonEnd,
      /(?:Only cardinality zero|只有[\s\S]{0,80}cardinality zero)[\s\S]{0,180}(?:draft-to-ready|draft[\s\S]{0,40}ready)/iu,
    );
    const prePostEnd = matchEndAfter(
      recovery,
      candidateEnd,
      /(?:pre-POST recovery binding-set read|pre-POST recovery binding set read)/iu,
    );
    const rerunEnd = matchEndAfter(
      recovery,
      prePostEnd,
      /actions\/runs\/\$LEGACY_RUN_ID\/rerun/u,
    );
    const postPostEnd = matchEndAfter(
      recovery,
      rerunEnd,
      /(?:After the POST|POST 后)[\s\S]{0,260}recovery binding(?: |-)?set/iu,
    );
    assert.ok(
      inventoryEnd > 0 &&
        horizonEnd > inventoryEnd &&
        candidateEnd > horizonEnd &&
        prePostEnd > candidateEnd &&
        rerunEnd > prePostEnd &&
        postPostEnd > rerunEnd,
      `${name}: stable pagination < candidate classification < pre-POST revalidation < POST < post-POST revalidation`,
    );

    assert.match(
      recovery,
      /(?:run_attempt[\s\S]{0,80}(?:exactly|恰好)[\s\S]{0,60}LEGACY_RUN_ATTEMPT \+ 1|LEGACY_RUN_ATTEMPT \+ 1[\s\S]{0,80}run_attempt)/iu,
      `${name}: require exactly one new rerun attempt`,
    );
    const postRerun = recovery.slice(postPostEnd);
    const postStatusStart = postRerun.indexOf(
      "commits/$CANARY_HEAD/statuses?per_page=100",
    );
    const postStatusEnd = postRerun.indexOf("draft", postStatusStart);
    assert.ok(postStatusStart >= 0, `${name}: post-rerun status endpoint`);
    assert.ok(
      postStatusEnd > postStatusStart,
      `${name}: post-rerun status proof precedes the draft fallback`,
    );
    const postStatusContract = postRerun.slice(
      postStatusStart,
      postStatusEnd,
    );
    assert.match(
      postStatusContract,
      /^commits\/\$CANARY_HEAD\/statuses\?per_page=100/u,
      `${name}: read the post-rerun status inventory on the current head`,
    );
    assert.match(
      postStatusContract,
      /(?:duplicate\s+status IDs|重复\s+status IDs?)/iu,
      `${name}: reject duplicate post-rerun status IDs`,
    );
    assert.match(
      postStatusContract,
      /(?:page[ -]?1|第一页)[^.。\n]{0,80}horizon/iu,
      `${name}: stabilize the post-rerun status pagination horizon`,
    );
    assert.match(
      postStatusContract,
      /codex\/review-gate[\s\S]{0,240}state=success/iu,
      `${name}: require a stable v1 success inventory on the current head`,
    );
    assert.match(
      postStatusContract,
      /(?:still-current|仍(?:然)?(?:绑定|为) current)[\s\S]{0,40}CANARY_HEAD/iu,
      `${name}: revalidate that the successful v1 status is on the current head`,
    );
    assert.match(
      postStatusContract,
      /(?:ID absent from|不在)[\s\S]{0,100}(?:complete\s+)?pre-POST\s+inventory/iu,
      `${name}: require a fresh post-POST v1 status ID`,
    );
    assert.match(
      postStatusContract,
      /creator\.login=github-actions\[bot\][\s\S]{0,80}creator\.type=Bot/u,
      `${name}: require the fresh status to come from the GitHub Actions bot`,
    );
    assert.match(
      recovery,
      /(?:Do not add|不得为了)[\s\S]{0,220}workflow_dispatch[\s\S]{0,120}pull_request_review[\s\S]{0,120}pull_request_review_comment[\s\S]{0,120}cron/iu,
      name,
    );
  }
});

test("all executable install and package gh commands pin github.com", () => {
  const guides = {
    ...Object.fromEntries(
      Object.entries(installGuides).map(([name, guide]) => [
        `docs/install/${name}`,
        guide,
      ]),
    ),
    ...Object.fromEntries(
      Object.entries(packageDocs).map(([name, guide]) => [
        `packages/action/${name}`,
        guide,
      ]),
    ),
  };
  const expectedExecutablePackageDocs = new Set([
    "packages/action/README.md",
    "packages/action/README.zh-CN.md",
    "packages/action/DESIGN.md",
    "packages/action/DESIGN.zh-CN.md",
    "packages/action/COOKBOOK.md",
    "packages/action/COOKBOOK.zh-CN.md",
  ]);
  for (const [name, guide] of Object.entries(guides)) {
    const invocations = executableGhInvocations(guide);
    if (name.startsWith("docs/install/") || expectedExecutablePackageDocs.has(name)) {
      assert.ok(invocations.length > 0, `${name}: missing executable gh guidance`);
    }
    assert.deepEqual(githubHostPinViolations(invocations), [], name);
  }
});

test("gh guidance scanner closes compound, continuation, substitution, and quoting gaps", () => {
  const compound = scanShellGhInvocations(
    "gh api --hostname github.com user; gh api user",
  );
  assert.equal(compound.length, 2);
  assert.deepEqual(
    githubHostPinViolations(compound),
    ["gh api user: gh api must start with exactly one --hostname github.com"],
  );

  const continued = scanShellGhInvocations(String.raw`gh \
  api user`);
  assert.equal(continued.length, 1);
  assert.equal(continued[0].command, "api");
  assert.deepEqual(
    githubHostPinViolations(continued),
    ["gh api user: gh api must start with exactly one --hostname github.com"],
  );

  const safeCompound = scanShellGhInvocations(
    [
      'actor="$(gh api --hostname github.com user)" &&',
      '  gh pr view "$PR_NUMBER" --repo "github.com/$REPO" |',
      '  gh run list --repo "github.com/$REPO" ||',
      '  gh variable set PROFILE --repo "github.com/$REPO" --body expanded',
      'legacy=`gh api --hostname github.com user`',
    ].join("\n"),
  );
  assert.deepEqual(
    safeCompound.map(({ command }) => command),
    ["api", "pr", "run", "variable", "api"],
  );
  assert.deepEqual(githubHostPinViolations(safeCompound), []);

  const ambientRepo = scanShellGhInvocations(
    'gh pr view "$PR_NUMBER" --repo "$REPO"',
  );
  assert.deepEqual(githubHostPinViolations(ambientRepo), [
    "gh pr view $PR_NUMBER --repo $REPO: " +
      "gh pr must use exactly one canonical --repo github.com/$REPO",
  ]);

  const quotedCommand = scanShellGhInvocations("'gh' api user");
  assert.equal(quotedCommand.length, 1);
  assert.deepEqual(githubHostPinViolations(quotedCommand), [
    "gh api user: gh api must start with exactly one --hostname github.com",
  ]);

  const wrapped = scanShellGhInvocations([
    "GH_HOST=hostile.example gh api --hostname github.com user",
    "env GH_HOST=hostile.example 'gh' pr view \"$PR_NUMBER\" " +
      "--repo \"github.com/$REPO\"",
  ].join("\n"));
  assert.deepEqual(wrapped.map(({ command }) => command), ["api", "pr"]);
  assert.deepEqual(githubHostPinViolations(wrapped), []);

  const ignored = scanShellGhInvocations(String.raw`
# gh api user
printf '%s\n' gh
printf '%s\n' 'gh api user'
printf '%s\n' "gh api user"
printf '%s\n' 'gh' "gh"
printf '%s\n' "$(printf '%s' 'gh api user')"
`);
  assert.deepEqual(ignored, []);
});

test("gh guidance scanner rejects duplicate selectors and implicit merge targets", () => {
  const duplicateHostname = scanShellGhInvocations(
    "gh api --hostname github.com user --hostname hostile.example",
  );
  assert.deepEqual(githubHostPinViolations(duplicateHostname), [
    "gh api --hostname github.com user --hostname hostile.example: " +
      "gh api must start with exactly one --hostname github.com",
  ]);

  const duplicateRepo = scanShellGhInvocations(
    'gh pr view "$PR_NUMBER" --repo "github.com/$REPO" -R hostile/repo',
  );
  assert.deepEqual(githubHostPinViolations(duplicateRepo), [
    "gh pr view $PR_NUMBER --repo github.com/$REPO -R hostile/repo: " +
      "gh pr must use exactly one canonical --repo github.com/$REPO",
  ]);

  const attachedShortRepo = scanShellGhInvocations(
    'gh pr view "$PR_NUMBER" --repo "github.com/$REPO" -Rhostile/repo',
  );
  assert.deepEqual(githubHostPinViolations(attachedShortRepo), [
    "gh pr view $PR_NUMBER --repo github.com/$REPO -Rhostile/repo: " +
      "gh pr must use exactly one canonical --repo github.com/$REPO",
  ]);

  const equalsRepo = scanShellGhInvocations(
    "gh run list --repo=github.com/$REPO",
  );
  assert.deepEqual(githubHostPinViolations(equalsRepo), [
    "gh run list --repo=github.com/$REPO: " +
      "gh run must use exactly one canonical --repo github.com/$REPO",
  ]);

  const implicitMerge = scanShellGhInvocations(
    'gh pr merge --repo "github.com/$REPO" ' +
      '--match-head-commit "$HEAD_SHA"',
  );
  assert.deepEqual(githubHostPinViolations(implicitMerge), [
    "gh pr merge --repo github.com/$REPO --match-head-commit $HEAD_SHA: " +
      "gh pr merge must explicitly target $PR_NUMBER",
  ]);

  const missingCas = scanShellGhInvocations(
    'gh pr merge "$PR_NUMBER" --repo "github.com/$REPO"',
  );
  assert.deepEqual(githubHostPinViolations(missingCas), [
    "gh pr merge $PR_NUMBER --repo github.com/$REPO: " +
      'gh pr merge must use exactly one canonical --match-head-commit "$HEAD_SHA"',
  ]);

  const duplicateCas = scanShellGhInvocations(
    'gh pr merge "$PR_NUMBER" --repo "github.com/$REPO" ' +
      '--match-head-commit "$HEAD_SHA" --match-head-commit "$OTHER_SHA"',
  );
  assert.deepEqual(githubHostPinViolations(duplicateCas), [
    "gh pr merge $PR_NUMBER --repo github.com/$REPO " +
      "--match-head-commit $HEAD_SHA --match-head-commit $OTHER_SHA: " +
      'gh pr merge must use exactly one canonical --match-head-commit "$HEAD_SHA"',
  ]);

  const attachedCas = scanShellGhInvocations(
    'gh pr merge "$PR_NUMBER" --repo "github.com/$REPO" ' +
      '--match-head-commit="$HEAD_SHA"',
  );
  assert.deepEqual(githubHostPinViolations(attachedCas), [
    "gh pr merge $PR_NUMBER --repo github.com/$REPO " +
      "--match-head-commit=$HEAD_SHA: " +
      'gh pr merge must use exactly one canonical --match-head-commit "$HEAD_SHA"',
  ]);

  const wrongCas = scanShellGhInvocations(
    'gh pr merge "$PR_NUMBER" --repo "github.com/$REPO" ' +
      '--match-head-commit "$OTHER_SHA"',
  );
  assert.deepEqual(githubHostPinViolations(wrongCas), [
    "gh pr merge $PR_NUMBER --repo github.com/$REPO " +
      "--match-head-commit $OTHER_SHA: " +
      'gh pr merge must use exactly one canonical --match-head-commit "$HEAD_SHA"',
  ]);
  assert.deepEqual(
    githubHostPinViolations(scanShellGhInvocations(
      'gh pr merge "$PR_NUMBER" --repo "github.com/$REPO" ' +
        '--match-head-commit "$HEAD_SHA"',
    )),
    [],
  );
});

test("gh guidance scanner unwraps command and exec but closes ambiguous wrappers", () => {
  const reviewerExamples = scanShellGhInvocations([
    "command gh api user",
    "command -- gh api user",
    "exec gh api user",
  ].join("\n"));
  assert.deepEqual(
    reviewerExamples.map(({ text }) => text),
    ["gh api user", "gh api user", "gh api user"],
  );
  assert.deepEqual(githubHostPinViolations(reviewerExamples), [
    "gh api user: gh api must start with exactly one --hostname github.com",
    "gh api user: gh api must start with exactly one --hostname github.com",
    "gh api user: gh api must start with exactly one --hostname github.com",
  ]);

  const safeWrappers = scanShellGhInvocations([
    "command -p gh api --hostname github.com user",
    'command -- gh pr view "$PR_NUMBER" --repo "github.com/$REPO"',
    'exec -- gh run list --repo "github.com/$REPO"',
    'exec -c -l -a codex-gh gh workflow run gate.yml --repo "github.com/$REPO"',
  ].join("\n"));
  assert.deepEqual(
    safeWrappers.map(({ command }) => command),
    ["api", "pr", "run", "workflow"],
  );
  assert.deepEqual(githubHostPinViolations(safeWrappers), []);

  assert.deepEqual(
    scanShellGhInvocations("command -v gh\ncommand -V gh\ncommand -pv gh"),
    [],
  );
  assert.throws(
    () => scanShellGhInvocations("env -S 'gh api --hostname github.com user'"),
    /env split-string wrapper cannot be audited safely/u,
  );
  assert.throws(
    () => scanShellGhInvocations(
      "env --split-string='gh api --hostname github.com user'",
    ),
    /env split-string wrapper cannot be audited safely/u,
  );
  assert.throws(
    () => scanShellGhInvocations("sudo gh api --hostname github.com user"),
    /literal gh is not in a proven executable position/u,
  );
  assert.throws(
    () => scanShellGhInvocations("bash -c 'gh api --hostname github.com user'"),
    /literal gh is not in a proven executable position/u,
  );
});

test("gh guidance scanner audits executable inline snippets but ignores command names", () => {
  const invocations = executableGhInvocations([
    "Use `gh api` for REST calls.",
    "Do not use `gh pr merge` or auto-merge.",
    "Run `gh api user` to inspect the current account.",
  ].join("\n"));
  assert.deepEqual(invocations.map(({ text }) => text), ["gh api user"]);
  assert.deepEqual(githubHostPinViolations(invocations), [
    "gh api user: gh api must start with exactly one --hostname github.com",
  ]);
});

test("legacy inventory helper pins github.com despite hostile GH_HOST and builds canonical output", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "codex-review-gate-inventory-test-"));
  try {
    const fixtureBin = join(fixtureRoot, "bin");
    mkdirSync(fixtureBin);
    const fakeGh = join(fixtureBin, "gh");
    writeFileSync(
      fakeGh,
      String.raw`#!/usr/bin/env bash
set -euo pipefail
if [[ $1 != api || $2 != --hostname || $3 != github.com ]]; then
  printf 'GitHub API request is not pinned to github.com\n' >&2
  exit 90
fi
shift 3
if [[ $1 == --paginate ]]; then
  if [[ $FIXTURE_MALFORMED == parameters ]]; then
    printf '%s\n' '[[{"type":"required_status_checks","ruleset_id":7,"parameters":{"strict_required_status_checks_policy":"not-a-boolean","required_status_checks":{}}}]]'
  elif [[ $FIXTURE_MALFORMED == missing-strict ]]; then
    printf '%s\n' '[[{"type":"required_status_checks","ruleset_id":7,"parameters":{"required_status_checks":[{"context":"codex/review-gate","integration_id":15368}]}}]]'
  else
    if [[ $FIXTURE_PERMUTED == true ]]; then
      checks='[{"context":"codex/review-gate","integration_id":15368},{"context":"ci/test","integration_id":15368},{"context":"codex/review-gate"}]'
    else
      checks='[{"context":"codex/review-gate"},{"context":"codex/review-gate","integration_id":15368},{"context":"ci/test","integration_id":15368}]'
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
  repos/OWNER/REPO)
    printf '%s\n' '{"id":1234,"node_id":"R_kgDOConsumer","full_name":"OWNER/REPO","default_branch":"main"}'
    ;;
  repos/OWNER/REPO/branches/main)
    printf 'main\n'
    ;;
  repos/OWNER/REPO/branches/main/protection/required_status_checks)
    if [[ $FIXTURE_MALFORMED == classic-missing-strict ]]; then
      printf '%s\n' '{"contexts":["codex/review-gate"],"checks":[{"context":"codex/review-gate","app_id":15368}]}'
    elif [[ $FIXTURE_MALFORMED == classic-missing-app-id ]]; then
      printf '%s\n' '{"strict":true,"contexts":["codex/review-gate"],"checks":[{"context":"codex/review-gate"}]}'
    elif [[ $FIXTURE_MALFORMED == classic-zero-app-id ]]; then
      printf '%s\n' '{"strict":true,"contexts":["codex/review-gate"],"checks":[{"context":"codex/review-gate","app_id":0}]}'
    elif [[ $FIXTURE_MALFORMED == classic-negative-app-id ]]; then
      printf '%s\n' '{"strict":true,"contexts":["codex/review-gate"],"checks":[{"context":"codex/review-gate","app_id":-2}]}'
    elif [[ $FIXTURE_MALFORMED == classic-fraction-app-id ]]; then
      printf '%s\n' '{"strict":true,"contexts":["codex/review-gate"],"checks":[{"context":"codex/review-gate","app_id":1.5}]}'
    elif [[ $FIXTURE_MALFORMED == classic-string-app-id ]]; then
      printf '%s\n' '{"strict":true,"contexts":["codex/review-gate"],"checks":[{"context":"codex/review-gate","app_id":"15368"}]}'
    elif [[ $FIXTURE_PERMUTED == true ]]; then
      printf '{"url":"https://api.github.com/repos/OWNER/REPO/branches/main/protection/required_status_checks","strict":%s,"contexts_url":"https://api.github.com/repos/OWNER/REPO/branches/main/protection/required_status_checks/contexts","contexts":["ci/test","codex/review-gate"],"checks":[{"context":"codex/review-gate","app_id":15368,"response_only":"ignored"},{"context":"codex/review-gate","app_id":-1},{"context":"ci/test","app_id":15368},{"context":"codex/review-gate","app_id":null}]}\n' "$FIXTURE_CLASSIC_STRICT"
    else
      printf '{"url":"https://api.github.com/repos/OWNER/REPO/branches/main/protection/required_status_checks","strict":%s,"contexts_url":"https://api.github.com/repos/OWNER/REPO/branches/main/protection/required_status_checks/contexts","contexts":["codex/review-gate","ci/test"],"checks":[{"context":"codex/review-gate","app_id":null},{"context":"ci/test","app_id":15368,"response_only":"ignored"},{"context":"codex/review-gate","app_id":-1},{"context":"codex/review-gate","app_id":15368}]}\n' "$FIXTURE_CLASSIC_STRICT"
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
    if [[ $FIXTURE_RULES_CHANGED == true ]]; then
      extra_rule='{"type":"non_fast_forward","parameters":{"policy_revision":2}}'
    else
      extra_rule='{"type":"non_fast_forward"}'
    fi
    if [[ $FIXTURE_PERMUTED == true ]]; then
      rules_checks='[{"context":"codex/review-gate","integration_id":15368},{"context":"ci/test","integration_id":15368},{"context":"codex/review-gate"}]'
      rules="$(printf '[%s,{\"parameters\":{\"required_status_checks\":%s,\"do_not_enforce_on_create\":false,\"strict_required_status_checks_policy\":%s},\"type\":\"required_status_checks\"}]' "$extra_rule" "$rules_checks" "$FIXTURE_STRICT")"
    else
      rules_checks='[{"context":"codex/review-gate"},{"context":"codex/review-gate","integration_id":15368},{"context":"ci/test","integration_id":15368}]'
      rules="$(printf '[{\"type\":\"required_status_checks\",\"parameters\":{\"strict_required_status_checks_policy\":%s,\"do_not_enforce_on_create\":false,\"required_status_checks\":%s}},%s]' "$FIXTURE_STRICT" "$rules_checks" "$extra_rule")"
    fi
    printf '{"id":7,"name":"legacy","source_type":"Repository","source":"OWNER/REPO","enforcement":"active","target":"branch","conditions":%s,"rules":%s,"bypass_actors":%s}\n' "$conditions" "$rules" "$bypass"
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
            GH_HOST: "hostile.invalid",
            PATH: `${fixtureBin}:${process.env.PATH}`,
            TMPDIR: fixtureRoot,
            FIXTURE_BYPASS: "",
            FIXTURE_CLASSIC_STRICT: "true",
            FIXTURE_MALFORMED: "",
            FIXTURE_PERMUTED: "false",
            FIXTURE_RULES_CHANGED: "false",
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
    const inventory = JSON.parse(readFileSync(output, "utf8"));
    const effectiveChecks = inventory.rulesets[0]
      .effective_required_status_checks_rule.parameters.required_status_checks;
    assert.deepEqual(
      effectiveChecks.map((check) => JSON.stringify(check)).sort(),
      [
        { context: "ci/test", integration_id: 15368 },
        { context: "codex/review-gate", integration_id: 15368 },
        { context: "codex/review-gate" },
      ].map((check) => JSON.stringify(check)).sort(),
      "effective required checks must preserve every producer binding",
    );
    assert.deepEqual(inventory, {
      classic_required_status_checks: {
        checks: [
          { app_id: 15368, context: "ci/test" },
          { app_id: null, context: "codex/review-gate" },
          { app_id: -1, context: "codex/review-gate" },
          { app_id: 15368, context: "codex/review-gate" },
        ],
        contexts: ["ci/test", "codex/review-gate"],
        strict: true,
      },
      default_branch: "main",
      repository: "OWNER/REPO",
      repository_id: 1234,
      repository_node_id: "R_kgDOConsumer",
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
          rules: [
            {
              parameters: {
                do_not_enforce_on_create: false,
                required_status_checks: [
                  { context: "ci/test", integration_id: 15368 },
                  {
                    context: "codex/review-gate",
                    integration_id: 15368,
                  },
                  { context: "codex/review-gate" },
                ],
                strict_required_status_checks_policy: true,
              },
              type: "required_status_checks",
            },
            { type: "non_fast_forward" },
          ],
          effective_required_status_checks_rule: {
            parameters: {
              do_not_enforce_on_create: false,
              required_status_checks: effectiveChecks,
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
    const nodeInventoryInput = {
      repository: "OWNER/REPO",
      repositoryId: 1234,
      repositoryNodeId: "R_kgDOConsumer",
      defaultBranch: "main",
      effectiveRulePages: [[{
        type: "required_status_checks",
        ruleset_id: 7,
        parameters: {
          strict_required_status_checks_policy: true,
          do_not_enforce_on_create: false,
          required_status_checks: [
            { context: "codex/review-gate" },
            { context: "codex/review-gate", integration_id: 15368 },
            { context: "ci/test", integration_id: 15368 },
          ],
        },
      }]],
      rulesets: [{
        id: 7,
        name: "legacy",
        source_type: "Repository",
        source: "OWNER/REPO",
        enforcement: "active",
        target: "branch",
        conditions: {
          ref_name: {
            include: ["~DEFAULT_BRANCH", "refs/heads/release"],
            exclude: ["refs/heads/tmp*", "refs/heads/wip*"],
          },
          repository_id: { repository_ids: [1001, 1002] },
          repository_property: {
            include: [
              { name: "tier", property_values: ["beta", "alpha"] },
              {
                name: "visibility",
                property_values: ["private", "public"],
              },
            ],
            exclude: [
              { name: "state", property_values: ["blocked", "archived"] },
            ],
          },
        },
        rules: [
          {
            type: "required_status_checks",
            parameters: {
              strict_required_status_checks_policy: true,
              do_not_enforce_on_create: false,
              required_status_checks: [
                { context: "codex/review-gate" },
                { context: "codex/review-gate", integration_id: 15368 },
                { context: "ci/test", integration_id: 15368 },
              ],
            },
          },
          { type: "non_fast_forward" },
        ],
        bypass_actors: [
          { actor_id: 42, actor_type: "Team", bypass_mode: "always" },
          {
            actor_id: null,
            actor_type: "OrganizationAdmin",
            bypass_mode: "always",
          },
          {
            actor_id: null,
            actor_type: "DeployKey",
            bypass_mode: "always",
          },
        ],
      }],
      classicRequiredStatusChecks: {
        url: "https://api.github.com/repos/OWNER/REPO/branches/main/protection/required_status_checks",
        contexts_url:
          "https://api.github.com/repos/OWNER/REPO/branches/main/protection/required_status_checks/contexts",
        strict: true,
        contexts: ["codex/review-gate", "ci/test"],
        checks: [
          { context: "codex/review-gate", app_id: null },
          { context: "ci/test", app_id: 15368, response_only: "ignored" },
          { context: "codex/review-gate", app_id: -1 },
          { context: "codex/review-gate", app_id: 15368 },
        ],
      },
    };
    const nodeCanonicalBytes = canonicalLegacyReviewGateInventoryBytes(
      nodeInventoryInput,
    );
    assert.equal(
      readFileSync(output, "utf8"),
      nodeCanonicalBytes,
      "shell and Node inventory canonicalization must emit identical bytes",
    );
    for (const invalidCheck of [
      { context: "codex/review-gate" },
      { context: "codex/review-gate", app_id: 0 },
      { context: "codex/review-gate", app_id: -2 },
      { context: "codex/review-gate", app_id: 1.5 },
      { context: "codex/review-gate", app_id: "15368" },
    ]) {
      const invalidInput = structuredClone(nodeInventoryInput);
      invalidInput.classicRequiredStatusChecks.checks = [invalidCheck];
      assert.throws(
        () => canonicalLegacyReviewGateInventoryBytes(invalidInput),
        /explicit app_id \(positive integer, -1, or null\)/u,
      );
    }
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
    const rulesChanged = runFixture("rules-changed", {
      FIXTURE_RULES_CHANGED: "true",
    });
    assert.equal(rulesChanged.result.status, 0, rulesChanged.result.stderr);
    assert.notEqual(
      rulesChanged.result.stdout,
      baseline.result.stdout,
      "non-effective full-ruleset rule drift must change the digest",
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
      "classic-missing-app-id",
      "classic-zero-app-id",
      "classic-negative-app-id",
      "classic-fraction-app-id",
      "classic-string-app-id",
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

test("installation runbooks pin github.com and close the trust-bootstrap merge on the approved head", () => {
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
  assert.doesNotMatch(legacyInventoryHelper, /\bgh repo\b/u);
  assert.equal(
    (legacyInventoryHelper.match(/\bgh api\b/gu) ?? []).length,
    (legacyInventoryHelper.match(/\bgh api --hostname github\.com\b/gu) ?? [])
      .length,
    "every legacy inventory API read must be pinned to github.com",
  );
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
  assert.match(legacyInventoryHelper, /\.contexts \| type == "array"/u);
  assert.match(legacyInventoryHelper, /\.checks \| type == "array"/u);
  assert.match(legacyInventoryHelper, /has\("app_id"\)/u);
  assert.match(
    legacyInventoryHelper,
    /\.app_id == null or\s*\(\.app_id \| type == "number" and floor == \. and \(\. == -1 or \. > 0\)\)/u,
  );
  assert.match(legacyInventoryHelper, /printf 'null\\n' > "\$classic_status"/u);
  assert.doesNotMatch(legacyInventoryHelper, /(?:required_status_checks|contexts|checks)\[\]\?/u);
  assert.match(
    legacyInventoryHelper,
    /node "\$canonicalizer"[\s\S]*?"\$repository_id"[\s\S]*?"\$repository_node_id"[\s\S]*?> "\$canonical_inventory"/u,
  );
  assert.match(
    legacyInventoryCanonicalizer,
    /canonicalLegacyReviewGateInventoryBytes/u,
  );
  for (const field of [
    "repository",
    "repositoryId",
    "repositoryNodeId",
    "defaultBranch",
    "effectiveRulePages",
    "rulesets",
    "classicRequiredStatusChecks",
  ]) {
    assert.match(
      legacyInventoryCanonicalizer,
      new RegExp(`\\b${field}\\b`, "u"),
      `canonicalizer: ${field}`,
    );
  }
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
      /gh api --hostname github\.com --method PUT[\s\S]{0,80}"repos\/\$REPO\/pulls\/\$MIGRATION_PR\/merge"/u.test(
        block,
      ),
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
    assert.match(
      transaction,
      /CURRENT_ACTOR="\$\(gh api --hostname github\.com user --jq '\.login'\)"/u,
      name,
    );
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
    assert.match(
      trustBootstrap,
      /(?:keep every legacy requirement active|让全部\s+legacy\s+requirements\s+保持\s+active|保留全部\s+legacy\s+requirements|保留所有\s+legacy\s+requirement)/iu,
      name,
    );
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
      "gh api --hostname github.com --method PUT",
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
      /gh api --hostname github\.com --paginate --slurp[\s\S]{0,160}pulls\/\$MIGRATION_PR\/reviews\?per_page=100/u,
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
      (transaction.match(/gh api --hostname github\.com --method PUT[\s\S]{0,100}"repos\/\$REPO\/pulls\/\$MIGRATION_PR\/merge"[\s\S]{0,100}--input "\$MERGE_BODY"/gu) ?? []).length,
      1,
      `${name}: exactly one synchronous merge mutation is allowed`,
    );
    assert.equal(
      (transaction.match(/\bgh api --hostname github\.com --method PUT\b/gu) ?? []).length,
      1,
      `${name}: transaction must contain exactly one PUT mutation`,
    );
    assert.doesNotMatch(transaction, /gh pr merge|--auto|--admin|merge_queue|enqueue|graphql|enablePullRequestAutoMerge/u, name);
    assert.doesNotMatch(
      transaction,
      /gh api --hostname github\.com --method (?:POST|PATCH|DELETE)\b/u,
      name,
    );
    assert.equal(
      (transaction.match(/gh api --hostname github\.com --method\s+\S+/gu) ?? [])
        .length,
      1,
      name,
    );
    const postMergeRegion = transaction.slice(mergeIndex);
    const defaultReadIndex = postMergeRegion.indexOf(".default_branch");
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
      "gh api --hostname github.com --method PUT",
    );
    const afterMerge = trustBootstrap.slice(globalMergeIndex);
    const lifecycleReadIndex = afterMerge.indexOf('--json baseRefName,headRefOid,state,mergedAt');
    const disabledIndex = afterMerge.indexOf("Disabled");
    const canaryOffset = afterMerge.slice(disabledIndex).search(/canary/iu);
    const canaryIndex = canaryOffset < 0 ? -1 : disabledIndex + canaryOffset;
    const activeReadbackEnd = matchEndAfter(
      afterMerge,
      canaryIndex,
      ACTIVE_V2_READBACK_PATTERN,
    );
    const removalOffset = afterMerge
      .slice(activeReadbackEnd)
      .search(/(?:legacy-removal plan|legacy removal plan|legacy cleanup|cleanup[\s\S]{0,80}legacy|(?:移除|删除)[\s\S]{0,80}legacy)/iu);
    const removalIndex = removalOffset < 0
      ? -1
      : activeReadbackEnd + removalOffset;
    assert.ok(
      lifecycleReadIndex >= 0 &&
        disabledIndex > lifecycleReadIndex &&
        canaryIndex > disabledIndex &&
        activeReadbackEnd > canaryIndex &&
        removalIndex >= activeReadbackEnd,
      `${name}: merge readback, Disabled, canary, Active readback, legacy cleanup order`,
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
    assert.match(guide, /classic\s+branch\s+protection/iu, name);
    assert.match(guide, /codex\/review-gate/u, name);
    assert.match(
      guide,
      /(?:(?:keep|preserve)[\s\S]{0,120}legacy[\s\S]{0,80}active|保留[\s\S]{0,120}active[\s\S]{0,80}legacy|legacy[\s\S]{0,80}保持\s*active)/iu,
      name,
    );
    assert.match(
      guide,
      /(?:distinct[\s\S]{0,80}V2_RULESET_NAME|V2_RULESET_NAME[\s\S]{0,80}distinct)/iu,
      name,
    );
    assert.match(guide, /(?:Active readback|Active policy)/u, name);
    assert.match(guide, /(?:separately authorised|另行授权)[\s\S]{0,100}(?:cleanup|legacy)/iu, name);
    assert.match(guide, /fails?(?:\s+|-)+closed/iu, name);
    assert.match(guide, /inconclusive/iu, name);
  }
});

test("installation runbooks derive and verify one explicit post-cleanup security state", () => {
  for (const [name, guide] of Object.entries(installGuides)) {
    assert.match(
      guide,
      /V2_RULESET_NAME\s*=[^\n]*Must Pass Codex Review/u,
      name,
    );
    const { ordinaryGuide, sourceSelfHostingGuide } = splitSourceSelfHostingGuide(
      guide,
      name,
    );
    const sourceCommands = bootstrapRemoteCommands(sourceSelfHostingGuide);
    assert.equal(
      sourceCommands.length,
      2,
      `${name}: source self-hosting has only status-only stage preview/apply`,
    );
    for (const { text } of sourceCommands) {
      assert.match(text, /--repo "\$REPO"/u, `${name}: ${text}`);
      assert.match(
        text,
        /--ruleset-name "\$V2_RULESET_NAME"/u,
        `${name}: ${text}`,
      );
      assert.match(text, /--ruleset-profile status-only/u, `${name}: ${text}`);
      assert.match(text, /--legacy-bridge/u, `${name}: ${text}`);
      assert.match(
        text,
        /--expected-legacy-inventory-sha256/u,
        `${name}: ${text}`,
      );
      assert.doesNotMatch(
        text,
        /--activate|--derive-post-cleanup-plan|--verify-post-cleanup/u,
        `${name}: source staging stays distinct from canary and cleanup`,
      );
    }
    assert.equal(
      sourceCommands.filter(({ text }) => text.includes("--apply")).length,
      1,
      `${name}: source self-hosting has one stage apply`,
    );

    const remoteCommands = bootstrapRemoteCommands(ordinaryGuide);
    assert.equal(
      remoteCommands.length,
      6,
      `${name}: expected stage preview/apply, activation preview/apply, cleanup-plan derivation, and final probe`,
    );
    for (const { text } of remoteCommands) {
      assert.match(
        text,
        /--ruleset-name "\$V2_RULESET_NAME"/u,
        `${name}: ${text}`,
      );
    }

    const finalProbes = remoteCommands.filter(({ text }) =>
      text.includes("--verify-post-cleanup"),
    );
    assert.equal(finalProbes.length, 1, `${name}: one explicit post-cleanup probe`);
    const [finalProbe] = finalProbes;
    const deriveCommands = remoteCommands.filter(({ text }) =>
      text.includes("--derive-post-cleanup-plan"),
    );
    assert.equal(deriveCommands.length, 1, `${name}: one pre-cleanup derivation`);
    const [deriveCommand] = deriveCommands;
    const preCleanupWrites = remoteCommands.filter(
      (command) => command !== finalProbe && command !== deriveCommand,
    );
    assert.equal(preCleanupWrites.length, 4, `${name}: four pre-cleanup remote write commands`);
    for (const { text } of [...preCleanupWrites, deriveCommand]) {
      assert.equal(
        (text.match(/--expected-legacy-inventory-sha256/gu) ?? []).length,
        1,
        `${name}: one approval digest per pre-cleanup command`,
      );
      assert.match(
        text,
        /--expected-legacy-inventory-sha256\s+\\\n\s*"\$\{LEGACY_INVENTORY_SHA256\}"/u,
        `${name}: ${text}`,
      );
      assert.doesNotMatch(text, /--verify-post-cleanup/u, name);
    }
    assert.equal(
      preCleanupWrites.filter(({ text }) => text.includes("--activate")).length,
      2,
      `${name}: activation preview and apply`,
    );
    assert.equal(
      preCleanupWrites.filter(({ text }) => text.includes("--apply")).length,
      2,
      `${name}: staging and activation apply`,
    );
    assert.doesNotMatch(
      deriveCommand.text,
      /--apply|--activate|--verify-post-cleanup/u,
      `${name}: derivation must remain read-only and pre-cleanup`,
    );
    assert.doesNotMatch(
      finalProbe.text,
      /--expected-legacy-inventory-sha256|LEGACY_INVENTORY_SHA256|--apply|--activate|--derive-post-cleanup-plan/u,
      `${name}: post-cleanup closure must not replay the stale legacy digest or mutate`,
    );
    assert.match(
      finalProbe.text,
      /--expected-post-cleanup-security-sha256\s+\\\n\s*"\$\{EXPECTED_POST_CLEANUP_SECURITY_SHA256\}"/u,
      `${name}: final probe must bind the pre-derived post-state`,
    );
    assert.match(
      ordinaryGuide.slice(deriveCommand.end, finalProbe.start),
      /(?:legacy cleanup|cleanup[\s\S]{0,100}legacy|(?:移除|删除)[\s\S]{0,100}legacy)/iu,
      `${name}: legacy cleanup must separate derivation from final closure`,
    );
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
      /`plan`[\s\S]{0,40}artifact[\s\S]{0,80}(?:90 days|90 天)/iu,
      name,
    );
    assert.match(
      guide,
      /candidate\s+A\/B artifacts[\s\S]{0,140}(?:one day|1\s*天)/iu,
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
    ["Upload release plan", 90],
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
    const bridgeStart = guide.indexOf("### Stable v2.0 RC admission bridge");
    const bridgeEnd = guide.indexOf("\n## ", bridgeStart);
    assert.notEqual(bridgeStart, -1, `${name}: RC bridge heading`);
    assert.notEqual(bridgeEnd, -1, `${name}: RC bridge boundary`);
    const bridge = guide.slice(bridgeStart, bridgeEnd);
    const freshStart = bridge.indexOf("**Fresh temporary fixture");
    assert.notEqual(freshStart, -1, `${name}: fresh fixture heading`);
    const fresh = bridge.slice(freshStart);
    const scopeStart = Math.max(
      guide.indexOf("## Initial v2 scope"),
      guide.indexOf("## 初始 v2 scope"),
    );
    const scopeEnd = guide.indexOf("\n## ", scopeStart);
    assert.notEqual(scopeStart, -1, `${name}: initial-scope heading`);
    assert.notEqual(scopeEnd, -1, `${name}: initial-scope boundary`);
    const scope = guide.slice(scopeStart, scopeEnd);

    for (const required of [
      /@v2\.0\.0-rc\.N/u,
      /test consumer/iu,
      /owner-reviewed/iu,
      /default branch/iu,
      /selector-only/iu,
      /fresh temporary fixture/iu,
      /last-push approval/iu,
      /complete paginated review inventory/iu,
      /exact RC bytes/iu,
      /(?:does not|不得).{0,80}CODEOWNERS/iu,
      /(?:neither is|不是)[\s\S]{0,80}ordinary consumer\s+installation/iu,
      /(?:unique(?:ly)?\s+named|唯一命名)[\s\S]{0,100}repository\s+ruleset/iu,
      /classic branch-protection/iu,
      /normalized\s+(?:profile|ruleset\s+profile)/iu,
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
      /(?:only[^.。]{0,120}(?:originally|原本)[^.。]{0,120}@v2|(?:若原状态|原本就有)[^.。]{0,120}@v2)/iu,
      /(?:otherwise[^.。]{0,120}remove|否则[^.。]{0,120}删除)/iu,
    ]) {
      assert.match(guide, required, `${name}: ${required}`);
    }

    for (const required of [
      /(?:unique(?:ly)?\s+named|唯一命名)[\s\S]{0,100}repository\s+ruleset/iu,
      /(?:no\s+bypass\s+actor|没有\s+bypass\s+actor)/iu,
      /(?:one\s+approval|一名\s+reviewer\s+approval)/iu,
      /(?:stale-approval\s+dismissal|dismiss\s+stale\s+approvals)/iu,
      /last-push\s+approval/iu,
      /(?:no\s+required\s+status\s+check|没有\s+required\s+status\s+check)/iu,
      /(?:returned\s+ID|返回的\s+ID)/iu,
      /rulesetWritableFingerprint\(\)/u,
      /source_type=Repository/iu,
      /source=<owner>\/<repository>/iu,
      /classic\s+branch-protection\s+`PUT`\/`DELETE`/iu,
      /complete\s+paginated\s+review\s+inventory/iu,
      /expected\s+`sha`/iu,
      /(?:It\s+does\s+not\s+add|不得新增)\s+CODEOWNERS/iu,
      /(?:Whether[\s\S]{0,120}succeeds,[\s\S]{0,120}fails,[\s\S]{0,120}cancelled|无论[\s\S]{0,120}成功、失败、被取消)/u,
      /(?:every\s+terminal\s+result[\s\S]{0,100}cleanup|每个\s+terminal\s+result[\s\S]{0,100}cleanup)/iu,
      /(?:keep\s+the\s+temporary\s+ruleset\s+active\s+through\s+the\s+cleanup\s+PR's\s+successful\s+merge|必须保持\s+active，直到[\s\S]{0,80}cleanup\s+PR\s+successful\s+merge)/iu,
      /exclusive\s+owner\s+(?:maintenance\s+)?window/iu,
      /(?:reread\s+the\s+effective\s+default-branch\s+rules\s+inventory[\s\S]{0,100}same\s+ID[\s\S]{0,60}absent|重读\s+effective\s+default-branch\s+rules\s+inventory[\s\S]{0,100}同一\s+ID[\s\S]{0,60}不存在)/iu,
      /exact\s+RC\s+bytes/iu,
    ]) {
      assert.match(fresh, required, `${name}: fresh RC fixture ${required}`);
    }

    for (const required of [
      /(?:after\s+every\s+terminal\s+gate\s+result|每个\s+terminal\s+gate\s+result\s+后)[\s\S]{0,120}forward\s+PR/iu,
      /(?:only a successful gate|只有\s+successful gate)[\s\S]{0,100}stable admission/iu,
    ]) {
      assert.match(scope, required, `${name}: RC scope summary ${required}`);
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
      "${{ github.event_name == 'workflow_dispatch' && inputs.request_review || false }}",
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

test("production controller validation rejects alternate YAML execution surfaces", () => {
  assert.equal(
    validateCanonicalV2ControllerWorkflowContent(templateController),
    templateController,
  );

  const replaceOnce = (before, after) => {
    assert.equal(
      templateController.split(before).length,
      2,
      `controller fixture must contain one mutation anchor: ${before}`,
    );
    return templateController.replace(before, after);
  };
  const mutations = [
    [
      "extra runner job",
      () => replaceOnce(
        "jobs:\n",
        [
          "jobs:",
          "  attacker-runner:",
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - run: echo attacker",
          "",
        ].join("\n"),
      ),
    ],
    [
      "extra run key",
      () => replaceOnce(
        "        id: controller\n",
        "        id: controller\n        run: echo attacker\n",
      ),
    ],
    [
      "extra reusable-workflow job",
      () => replaceOnce(
        "jobs:\n",
        [
          "jobs:",
          "  attacker-reusable:",
          "    uses: attacker/example/.github/workflows/reusable.yml@main",
          "",
        ].join("\n"),
      ),
    ],
    [
      "quoted uses",
      () => replaceOnce(
        `        uses: ${MARKETPLACE_ACTION}`,
        `        uses: "${MARKETPLACE_ACTION}"`,
      ),
    ],
    [
      "tagged uses",
      () => replaceOnce(
        `        uses: ${MARKETPLACE_ACTION}`,
        `        uses: !!str ${MARKETPLACE_ACTION}`,
      ),
    ],
    [
      "explicit uses",
      () => replaceOnce(
        `        uses: ${MARKETPLACE_ACTION}`,
        `        ? uses\n        : ${MARKETPLACE_ACTION}`,
      ),
    ],
    [
      "flow uses",
      () => replaceOnce(
        `        uses: ${MARKETPLACE_ACTION}`,
        `        uses: [${MARKETPLACE_ACTION}]`,
      ),
    ],
    [
      "secrets inherit",
      () => replaceOnce(
        "    timeout-minutes: 14\n",
        "    timeout-minutes: 14\n    secrets: inherit\n",
      ),
    ],
    [
      "secrets expression",
      () => replaceOnce(
        "    timeout-minutes: 14\n",
        "    timeout-minutes: 14\n    secrets: ${{ github.token }}\n",
      ),
    ],
    [
      "plain workflow_call",
      () => replaceOnce(
        "name: Codex Review Gate Controller\n\non:\n",
        "name: Codex Review Gate Controller\n\non:\n  workflow_call:\n",
      ),
    ],
    [
      "quoted workflow_call",
      () => replaceOnce(
        "name: Codex Review Gate Controller\n\non:\n",
        'name: Codex Review Gate Controller\n\non:\n  "workflow_call":\n',
      ),
    ],
    [
      "tagged workflow_call",
      () => replaceOnce(
        "name: Codex Review Gate Controller\n\non:\n",
        "name: Codex Review Gate Controller\n\non:\n  !!str workflow_call:\n",
      ),
    ],
    [
      "explicit workflow_call",
      () => replaceOnce(
        "name: Codex Review Gate Controller\n\non:\n",
        "name: Codex Review Gate Controller\n\non:\n  ? workflow_call\n  :\n",
      ),
    ],
    [
      "flow workflow_call",
      () => replaceOnce(
        "name: Codex Review Gate Controller\n\non:\n",
        "name: Codex Review Gate Controller\n\non:\n  workflow_call: {}\n",
      ),
    ],
    [
      "duplicate flow on",
      () => `${templateController}\non: {}\n`,
    ],
    [
      "duplicate flow jobs",
      () => `${templateController}\njobs: {}\n`,
    ],
    [
      "extra step",
      () => replaceOnce(
        "    steps:\n",
        [
          "    steps:",
          "      - name: Attacker step",
          "        run: echo attacker",
          "",
        ].join("\n"),
      ),
    ],
    [
      "extra callee",
      () => replaceOnce(
        `        uses: ${MARKETPLACE_ACTION}`,
        [
          `        uses: ${MARKETPLACE_ACTION}`,
          "        uses: attacker/example@v1",
        ].join("\n"),
      ),
    ],
    [
      "required fragment decoy in comment",
      () => replaceOnce(
        "          github_token: ${{ github.token }}",
        "          token: ${{ github.token }}\n# github_token:",
      ),
    ],
    [
      "required fragment decoy in block scalar",
      () => replaceOnce(
        "        description: Optional GitHub comment ID used only as an evidence hint",
        "        description: |\n          github_token:\n          This is inert block-scalar text.",
      ).replace(
        "          github_token: ${{ github.token }}",
        "          token: ${{ github.token }}",
      ),
    ],
  ];

  for (const [label, mutate] of mutations) {
    const mutation = mutate();
    assert.notEqual(mutation, templateController, label);
    assert.throws(
      () => validateCanonicalV2ControllerWorkflowContent(mutation),
      undefined,
      label,
    );
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

test("agent canary reads URI-encode slash-containing default branches", () => {
  const encoded = spawnSync(
    "jq",
    ["-rn", "--arg", "value", "release/v2", "$value | @uri"],
    { encoding: "utf8" },
  );
  assert.equal(encoded.status, 0, encoded.stderr);
  assert.equal(encoded.stdout, "release%2Fv2\n");

  const headings = {
    "agent.md": "## Phase 5: prove the canary and activate protection",
    "agent.zh-CN.md": "## 阶段 5：证明 canary、启用保护并清理",
  };
  for (const [name, heading] of Object.entries(headings)) {
    const activation = markdownSection(installGuides[name], heading);
    const readBlock = shellCodeBlocks(activation).find((block) =>
      block.includes("DEFAULT_BRANCH_HEAD_SHA"),
    );
    assert.ok(readBlock, `${name}: missing canary branch read`);
    assert.match(
      readBlock,
      /DEFAULT_BRANCH_URI="\$\(jq -rn --arg value "\$DEFAULT_BRANCH" '\$value \| @uri'\)"/u,
      name,
    );
    assert.match(
      readBlock,
      /repos\/\$REPO\/branches\/\$DEFAULT_BRANCH_URI/u,
      name,
    );
    assert.doesNotMatch(
      readBlock,
      /repos\/\$REPO\/branches\/\$DEFAULT_BRANCH(?:["/?]|$)/u,
      name,
    );
    assert.ok(
      readBlock.indexOf("DEFAULT_BRANCH_URI=") <
        readBlock.indexOf("DEFAULT_BRANCH_HEAD_SHA="),
      `${name}: URI encoding must precede the branch API read`,
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
    assert.match(
      guide,
      /gh api --hostname github\.com --paginate --slurp[\s\S]{0,220}check-runs\?check_name=codex%2Fgithub-review-gate&filter=latest&per_page=100[\s\S]{0,160}\.\[\]\.check_runs\[\]/u,
      `${name}: canary CheckRun inventory must be server-filtered and completely paginated`,
    );
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
    "run-name",
    "on",
    "permissions",
    "concurrency",
    "jobs",
  ]);
  assert.equal(blockScalar(root, "name"), "Codex Review Gate Verifier");
  assert.equal(
    blockScalar(root, "run-name"),
    "codex-review-gate-verifier/${{ github.event.pull_request.number }}/${{ github.sha }}",
  );

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
  const lineStart = source.lastIndexOf("\n", start - 1) + 1;
  const indentation = source.slice(lineStart, start);
  assert.match(indentation, /^[ \t]*$/u, `invalid Markdown heading ${heading}`);
  const followingHeading = new RegExp(
    `\\n[ \\t]{0,${indentation.length}}#{1,${level}}\\s+`,
    "gu",
  );
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

function executableGhInvocations(source) {
  const fenced = shellCodeBlocks(source).flatMap(scanShellGhInvocations);
  const inline = inlineCodeSpans(source)
    .flatMap(scanShellGhInvocations)
    .filter(inlineGhInvocationIsExecutable);
  return [...fenced, ...inline];
}

function scanShellGhInvocations(source) {
  const invocations = [];
  for (const segment of shellCommandSegments(source)) {
    const position = shellExecutablePosition(segment);
    if (position.kind !== "execute") {
      continue;
    }
    const commandIndex = position.index;
    if (segment[commandIndex].value !== "gh") {
      const hasAmbiguousGh = segment
        .slice(commandIndex + 1)
        .some(({ value }) =>
          value === "gh" || /(?:^|[\s;&|()])gh(?:$|[\s;&|()])/u.test(value)
        );
      const displayCommand = new Set(["echo", "printf"]).has(
        segment[commandIndex].value,
      );
      if (hasAmbiguousGh && !displayCommand) {
        throw new Error(
          `${segment.map(({ value }) => value).join(" ")}: ` +
            "literal gh is not in a proven executable position",
        );
      }
      continue;
    }
    const words = segment.slice(commandIndex).map((token) => token.value);
    invocations.push({
      command: words[1] ?? "",
      text: words.join(" "),
      words,
    });
  }
  return invocations;
}

function githubHostPinViolations(invocations) {
  const repositoryCommands = new Set(["pr", "run", "variable", "workflow"]);
  const violations = [];
  for (const { command, text, words } of invocations) {
    if (command === "api") {
      const selectors = ghSelectorIndices(words, "--hostname");
      if (
        selectors.length !== 1 ||
        selectors[0] !== 2 ||
        words[2] !== "--hostname" ||
        words[3] !== "github.com"
      ) {
        violations.push(
          `${text}: gh api must start with exactly one --hostname github.com`,
        );
      }
      continue;
    }
    if (!repositoryCommands.has(command)) {
      violations.push(`${text}: unclassified executable gh command`);
      continue;
    }
    const selectors = ghSelectorIndices(words, "--repo", "-R");
    const repoIndex = words.indexOf("--repo", 2);
    if (
      selectors.length !== 1 ||
      selectors[0] !== repoIndex ||
      repoIndex === -1 ||
      words[repoIndex + 1] !== "github.com/$REPO"
    ) {
      violations.push(
        `${text}: gh ${command} must use exactly one canonical ` +
          "--repo github.com/$REPO",
      );
    }
    if (command === "pr" && words[2] === "merge" && words[3] !== "$PR_NUMBER") {
      violations.push(`${text}: gh pr merge must explicitly target $PR_NUMBER`);
    }
    if (command === "pr" && words[2] === "merge") {
      const selectors = ghSelectorIndices(words, "--match-head-commit");
      const selectorIndex = words.indexOf("--match-head-commit", 3);
      if (
        selectors.length !== 1 ||
        selectors[0] !== selectorIndex ||
        selectorIndex === -1 ||
        words[selectorIndex + 1] !== "$HEAD_SHA"
      ) {
        violations.push(
          `${text}: gh pr merge must use exactly one canonical ` +
            '--match-head-commit "$HEAD_SHA"',
        );
      }
    }
  }
  return violations;
}

function inlineCodeSpans(source) {
  const prose = source.replace(/```[\s\S]*?```/gu, "");
  return [...prose.matchAll(/(?<!`)`([^`\r\n]+)`(?!`)/gu)].map(
    (match) => match[1],
  );
}

function inlineGhInvocationIsExecutable({ command, words }) {
  const commandReferenceLength = new Set(["pr", "run", "variable", "workflow"])
      .has(command)
    ? 3
    : 2;
  return words.length > commandReferenceLength;
}

function ghSelectorIndices(words, longName, shortName = null) {
  return words.flatMap((word, index) => {
    if (
      word === longName ||
      word.startsWith(`${longName}=`) ||
      (shortName !== null &&
        (word === shortName || word.startsWith(shortName)))
    ) {
      return [index];
    }
    return [];
  });
}

function shellExecutablePosition(segment) {
  const commandPrefixes = new Set(["if", "then", "elif", "else", "while", "until", "do"]);
  let index = 0;
  while (commandPrefixes.has(segment[index]?.value)) {
    index += 1;
  }
  while (shellAssignment(segment[index]?.value)) {
    index += 1;
  }
  while (index < segment.length) {
    const wrapper = segment[index].value;
    if (wrapper === "env") {
      index = unwrapEnvCommand(segment, index);
      continue;
    }
    if (wrapper === "command") {
      const command = unwrapCommandBuiltin(segment, index);
      if (command.kind === "query") {
        return command;
      }
      index = command.index;
      continue;
    }
    if (wrapper === "exec") {
      index = unwrapExecBuiltin(segment, index);
      continue;
    }
    break;
  }
  return index < segment.length ? { kind: "execute", index } : { kind: "none" };
}

function unwrapEnvCommand(segment, wrapperIndex) {
  let index = wrapperIndex + 1;
  while (index < segment.length) {
    const value = segment[index].value;
    if (
      value === "-S" ||
      value === "--split-string" ||
      value.startsWith("--split-string=")
    ) {
      throw new Error(
        `${segment.map((token) => token.value).join(" ")}: ` +
          "env split-string wrapper cannot be audited safely",
      );
    }
    if (value === "--") {
      index += 1;
      break;
    }
    if (shellAssignment(value)) {
      index += 1;
      continue;
    }
    if (["-u", "--unset", "-C", "--chdir", "--argv0", "-P"].includes(value)) {
      index += 2;
      continue;
    }
    if (
      ["-i", "--ignore-environment", "-0", "--null", "-v", "--debug"]
        .includes(value) ||
      /^-(?:u|C|P).+/u.test(value) ||
      /^--(?:unset|chdir|argv0)=/u.test(value)
    ) {
      index += 1;
      continue;
    }
    if (value.startsWith("-")) {
      throw new Error(
        `${segment.map((token) => token.value).join(" ")}: ` +
          `unsupported env wrapper option ${value}`,
      );
    }
    break;
  }
  while (shellAssignment(segment[index]?.value)) {
    index += 1;
  }
  return index;
}

function unwrapCommandBuiltin(segment, wrapperIndex) {
  let index = wrapperIndex + 1;
  let query = false;
  while (index < segment.length) {
    const value = segment[index].value;
    if (value === "--") {
      index += 1;
      break;
    }
    if (!value.startsWith("-") || value === "-") {
      break;
    }
    if (!/^-[pVv]+$/u.test(value)) {
      throw new Error(
        `${segment.map((token) => token.value).join(" ")}: ` +
          `unsupported command wrapper option ${value}`,
      );
    }
    query ||= /[Vv]/u.test(value);
    index += 1;
  }
  return query ? { kind: "query" } : { kind: "execute", index };
}

function unwrapExecBuiltin(segment, wrapperIndex) {
  let index = wrapperIndex + 1;
  while (index < segment.length) {
    const value = segment[index].value;
    if (value === "--") {
      index += 1;
      break;
    }
    if (value === "-a") {
      if (segment[index + 1] === undefined) {
        throw new Error("exec -a wrapper is missing its argv[0] value");
      }
      index += 2;
      continue;
    }
    if (/^-[cl]+$/u.test(value)) {
      index += 1;
      continue;
    }
    if (value.startsWith("-")) {
      throw new Error(
        `${segment.map((token) => token.value).join(" ")}: ` +
          `unsupported exec wrapper option ${value}`,
      );
    }
    break;
  }
  return index;
}

function shellAssignment(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*=/u.test(value ?? "");
}

// Tokenize shell simple commands while recursively preserving command
// substitutions. The scanner unwraps only the explicit env/command/exec forms
// above. Literal `gh` tokens or command strings behind non-display commands,
// unknown wrapper options, and env split-string forms fail closed. Arbitrary
// expansion, aliases, and function bodies remain outside this static model.
function shellCommandSegments(source) {
  const segments = [];
  let offset = 0;

  function scanContext(stopCharacter = null) {
    let words = [];
    let word = null;

    const append = (value, hasUnquoted = false) => {
      word ??= { hasUnquoted: false, value: "" };
      word.value += value;
      word.hasUnquoted ||= hasUnquoted;
    };
    const flushWord = () => {
      if (word !== null) {
        words.push(word);
        word = null;
      }
    };
    const flushSegment = () => {
      flushWord();
      if (words.length > 0) {
        segments.push(words);
        words = [];
      }
    };
    const scanSingleQuote = () => {
      offset += 1;
      while (offset < source.length && source[offset] !== "'") {
        append(source[offset]);
        offset += 1;
      }
      assert.ok(offset < source.length, "unterminated single-quoted shell word");
      offset += 1;
    };
    const scanDoubleQuote = () => {
      offset += 1;
      while (offset < source.length) {
        const character = source[offset];
        if (character === '"') {
          offset += 1;
          return;
        }
        if (character === "\\") {
          const next = source[offset + 1];
          if (next === "\n") {
            offset += 2;
          } else if (["$", "`", '"', "\\"].includes(next)) {
            append(next);
            offset += 2;
          } else {
            append("\\");
            offset += 1;
          }
          continue;
        }
        if (character === "$" && source[offset + 1] === "(") {
          append("$()");
          offset += 2;
          scanContext(")");
          continue;
        }
        if (character === "`") {
          append("``");
          offset += 1;
          scanContext("`");
          continue;
        }
        append(character);
        offset += 1;
      }
      assert.fail("unterminated double-quoted shell word");
    };

    while (offset < source.length) {
      const character = source[offset];
      if (stopCharacter !== null && character === stopCharacter) {
        flushSegment();
        offset += 1;
        return;
      }
      if (character === "'") {
        scanSingleQuote();
        continue;
      }
      if (character === '"') {
        scanDoubleQuote();
        continue;
      }
      if (character === "\\") {
        const next = source[offset + 1];
        if (next === "\n") {
          offset += 2;
        } else if (next === undefined) {
          append("\\", true);
          offset += 1;
        } else {
          append(next, true);
          offset += 2;
        }
        continue;
      }
      if (character === "$" && source[offset + 1] === "(") {
        append("$()", true);
        offset += 2;
        scanContext(")");
        continue;
      }
      if (character === "`") {
        append("``", true);
        offset += 1;
        scanContext("`");
        continue;
      }
      if (character === "#" && word === null) {
        while (offset < source.length && source[offset] !== "\n") {
          offset += 1;
        }
        continue;
      }
      if (/\s/u.test(character)) {
        flushWord();
        if (character === "\n" || character === "\r") {
          flushSegment();
        }
        offset += 1;
        continue;
      }
      if (";&|<>!{}".includes(character)) {
        flushSegment();
        offset += 1;
        continue;
      }
      if (character === "(") {
        flushSegment();
        offset += 1;
        scanContext(")");
        continue;
      }
      if (character === ")") {
        flushSegment();
        offset += 1;
        continue;
      }
      append(character, true);
      offset += 1;
    }

    flushSegment();
    assert.equal(stopCharacter, null, `unterminated shell ${stopCharacter}`);
  }

  scanContext();
  return segments;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function matchEndAfter(value, start, pattern) {
  if (!Number.isInteger(start) || start < 0) {
    return -1;
  }
  const match = pattern.exec(value.slice(start));
  return match === null ? -1 : start + match.index + match[0].length;
}

function bootstrapRemoteCommands(markdown) {
  const lines = markdown.split("\n");
  const commands = [];
  let offset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const start = offset;
    const command = [lines[index]];
    offset += lines[index].length + 1;
    if (!lines[index].includes("bootstrap-codex-review-gate.mjs")) {
      continue;
    }
    while (command.at(-1).trimEnd().endsWith("\\") && index + 1 < lines.length) {
      index += 1;
      command.push(lines[index]);
      offset += lines[index].length + 1;
    }
    const text = command.join("\n");
    if (text.includes("--repo")) {
      commands.push({ text, start, end: offset - 1 });
    }
  }
  return commands;
}

function splitSourceSelfHostingGuide(markdown, name) {
  const heading = name.endsWith(".zh-CN.md")
    ? "## 窄范围 source repository self-hosting 例外"
    : "## Narrow source-repository self-hosting exception";
  const start = markdown.indexOf(heading);
  assert.ok(start >= 0, `${name}: source self-hosting exception heading`);
  const endOffset = markdown.indexOf("\n## ", start + heading.length);
  const end = endOffset === -1 ? markdown.length : endOffset + 1;
  return {
    sourceSelfHostingGuide: markdown.slice(start, end),
    ordinaryGuide: `${markdown.slice(0, start)}${markdown.slice(end)}`,
  };
}
