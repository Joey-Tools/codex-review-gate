import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
const templateCodeownersPath = join(
  repoRoot,
  "templates/codex-gated-repo/.github/CODEOWNERS",
);
const templateRulesetPath = join(
  repoRoot,
  "templates/codex-gated-repo/rulesets/codex-review-gate.json",
);
const installGuides = Object.fromEntries(
  ["human.md", "human.zh-CN.md", "agent.md", "agent.zh-CN.md"].map((name) => [
    name,
    readFileSync(join(repoRoot, "docs/install", name), "utf8"),
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
const templateCodeowners = readFileSync(templateCodeownersPath, "utf8");
const templateRuleset = JSON.parse(readFileSync(templateRulesetPath, "utf8"));

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
  ") ||",
  "(",
  "github.event_name == 'pull_request_target' &&",
  "github.event.action == 'edited' &&",
  "github.event.changes.base.ref.from &&",
  "github.event.changes.base.ref.from != github.event.pull_request.base.ref &&",
  "github.event.pull_request.base.repo.full_name == github.repository &&",
  "github.event.pull_request.base.ref == github.event.repository.default_branch",
  ")",
  "}}",
].join(" ");

test("the v2 installation template is isolated from the still-live v1 source caller", () => {
  const workflow = parseConsumerWorkflow(templateConsumer);
  assert.notEqual(sourceConsumer, templateConsumer);
  assert.match(
    sourceConsumer,
    /uses: JoeyTeng\/codex-review-gate-action\/\.github\/workflows\/codex-review-gate\.yml@v1/u,
  );
  assert.doesNotMatch(sourceConsumer, /codex-review-gate-action@v2/u);
  for (const path of retiredPackageWorkflowPaths) {
    assert.equal(existsSync(path), false);
  }
  assert.equal(itemScalar(workflow.steps[0], "uses"), MARKETPLACE_ACTION);
  assert.doesNotMatch(
    templateConsumer,
    /\.github\/workflows\/codex-review-gate\.yml@|workflow_call|secrets:\s*inherit/u,
  );
});

test("automatic runner admission is closed to exact Codex comments and actual base-ref edits", () => {
  const workflow = parseConsumerWorkflow(templateConsumer);
  assert.deepEqual(blockDirectKeys(workflow.events), [
    "pull_request_target",
    "issue_comment",
    "workflow_dispatch",
  ]);
  assert.deepEqual(blockScalarMapping(workflow.pullRequestTarget), {
    types: "[edited]",
  });
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
    "github.event_name == 'pull_request_target'",
    "github.event.changes.base.ref.from",
    "github.event.changes.base.ref.from != github.event.pull_request.base.ref",
    "github.event.pull_request.base.repo.full_name == github.repository",
    "github.event.pull_request.base.ref == github.event.repository.default_branch",
  ]) {
    assert.ok(jobIf.includes(expression), `missing pre-runner filter: ${expression}`);
  }
});

test("manual dispatch is default-branch-only and exposes the closed typed business inputs", () => {
  const workflow = parseConsumerWorkflow(templateConsumer);
  assert.deepEqual(blockDirectKeys(workflow.workflowDispatch), ["inputs"]);
  assert.deepEqual(blockDirectKeys(workflow.dispatchInputs), [
    "operation",
    "pr_number",
    "expected_head_sha",
    "request_comment_id",
    "request_review",
    "limits_profile",
  ]);
  assert.doesNotMatch(
    templateConsumer,
    /repository_dispatch|client_payload|batch|targets|source_sha|temporary|max_pages|max_objects/u,
  );
});

test("consumer permissions and runtime shape cannot read or execute pull-request code", () => {
  const workflow = parseConsumerWorkflow(templateConsumer);
  assert.deepEqual(blockScalarMapping(workflow.permissions), {
    contents: "read",
    issues: "write",
    "pull-requests": "read",
    statuses: "write",
  });
  assert.equal(
    blockScalar(workflow.job, "runs-on"),
    "${{ vars.CODEX_REVIEW_GATE_USE_UBUNTU_LATEST == 'true' && 'ubuntu-latest' || 'ubuntu-slim' }}",
  );
  assert.equal(blockScalar(workflow.job, "timeout-minutes"), "14");
  assert.equal(workflow.steps.length, 1);
  assert.deepEqual(
    itemKeys(workflow.steps[0]),
    ["name", "id", "uses", "env", "with"],
  );
  assert.equal(itemScalar(workflow.steps[0], "uses"), MARKETPLACE_ACTION);
  assert.deepEqual(blockScalarMapping(workflow.env), {
    CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION:
      "${{ vars.CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION == 'any' && 'any' || 'write' }}",
  });
  assertNoForbiddenExecutionKeys(templateConsumer);
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

test("consumer routing fixes automatic reconciliation and permits only reviewed profiles", () => {
  const workflow = parseConsumerWorkflow(templateConsumer);
  assert.deepEqual(blockScalarMapping(workflow.with), {
    github_token: "${{ github.token }}",
    pr_number:
      "${{ github.event_name == 'workflow_dispatch' && inputs.pr_number || github.event_name == 'pull_request_target' && github.event.pull_request.number || github.event.issue.number }}",
    expected_head_sha:
      "${{ github.event_name == 'workflow_dispatch' && inputs.expected_head_sha || github.event_name == 'pull_request_target' && github.event.pull_request.head.sha || '' }}",
    operation:
      "${{ github.event_name == 'workflow_dispatch' && inputs.operation || 'reconcile' }}",
    request_comment_id:
      "${{ github.event_name == 'workflow_dispatch' && inputs.request_comment_id || github.event_name == 'issue_comment' && github.event.comment.id || '' }}",
    request_review:
      "${{ github.event_name == 'workflow_dispatch' && inputs.operation == 'begin-review' && inputs.request_review || false }}",
    limits_profile:
      "${{ ((github.event_name == 'workflow_dispatch' && inputs.limits_profile == 'expanded') || vars.CODEX_REVIEW_GATE_LIMITS_PROFILE == 'expanded') && 'expanded' || 'default' }}",
  });
  assert.equal(
    (templateConsumer.match(/\$\{\{\s*vars\./gu) ?? []).length,
    2,
  );
  assert.doesNotMatch(templateConsumer, /CODEX_REVIEW_GATE_MAX_(?:PAGES|OBJECTS)/u);
  assert.doesNotMatch(templateConsumer, /\$\{\{\s*secrets\.|env\./u);
});

test("repo-plus-PR concurrency serializes effects without cancelling active reconciliation", () => {
  const workflow = parseConsumerWorkflow(templateConsumer);
  assert.deepEqual(blockScalarMapping(workflow.concurrency), {
    group:
      "codex-review-gate-${{ github.repository }}-${{ github.event.pull_request.number || github.event.issue.number || inputs.pr_number }}",
    "cancel-in-progress": "false",
  });
});

test("security structure rejects extra jobs, steps, and execution escape keys", () => {
  const mutations = [
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
    templateConsumer.replace(
      "github.event.comment.user.type == 'Bot'",
      "github.event.comment.user.type == 'Bot' || true",
    ),
    templateConsumer.replace(
      "github.event.action == 'created' || github.event.action == 'edited'",
      "github.event.action == 'edited' || github.event.action == 'created'",
    ),
  ];
  for (const mutation of mutations) {
    assert.throws(() => parseConsumerWorkflow(mutation));
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

test("installation guides preserve the persistent-SHA status reset boundary", () => {
  for (const name of ["human.md", "agent.md"]) {
    const guide = installGuides[name];
    assert.match(guide, /Commit statuses? persist on a commit SHA/u, name);
    assert.match(
      guide,
      /(?:does|do) not contain a PR identity|ha(?:s|ve) no PR identity/u,
      name,
    );
    assert.match(guide, /parallel or duplicate PRs/iu, name);
    assert.match(guide, /`pull_request` reset job/u, name);
    assert.match(guide, /`pull_request_target` `edited`/u, name);
    assert.match(guide, /non-fast-forward/u, name);
  }
  for (const name of ["human.zh-CN.md", "agent.zh-CN.md"]) {
    const guide = installGuides[name];
    assert.match(guide, /Commit status 会按 commit SHA 持久存在/u, name);
    assert.match(guide, /Commit\s+status\s+不包含 PR identity/u, name);
    assert.match(guide, /parallel\/duplicate\s+PR/u, name);
    assert.match(guide, /`pull_request` reset job/u, name);
    assert.match(guide, /`pull_request_target` `edited`/u, name);
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

function parseConsumerWorkflow(source) {
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
  assert.equal(blockScalar(root, "name"), "Codex Review Gate");

  const events = blockChild(root, "on");
  assert.deepEqual(blockDirectKeys(events), [
    "pull_request_target",
    "issue_comment",
    "workflow_dispatch",
  ]);
  const pullRequestTarget = blockChild(events, "pull_request_target");
  const issueComment = blockChild(events, "issue_comment");
  const workflowDispatch = blockChild(events, "workflow_dispatch");
  assert.deepEqual(blockDirectKeys(issueComment), ["types"]);
  assert.deepEqual(blockDirectKeys(workflowDispatch), ["inputs"]);
  const dispatchInputs = blockChild(workflowDispatch, "inputs");

  const permissions = blockChild(root, "permissions");
  assert.deepEqual(blockDirectKeys(permissions), [
    "contents",
    "issues",
    "pull-requests",
    "statuses",
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
    "if",
    "runs-on",
    "timeout-minutes",
    "steps",
  ]);
  assert.equal(blockScalar(job, "name"), "codex/github-review-gate");
  assert.equal(blockScalar(job, "if"), ">-");
  assert.equal(
    foldedScalarBody(job, "if"),
    CLOSED_JOB_IF,
    "consumer job.if must be the complete normalized closed admission expression",
  );

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
  assert.deepEqual(blockDirectKeys(withBlock), [
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
    pullRequestTarget,
    issueComment,
    workflowDispatch,
    dispatchInputs,
    permissions,
    concurrency,
    jobs,
    job,
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
