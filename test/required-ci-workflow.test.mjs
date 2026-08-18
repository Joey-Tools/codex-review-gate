import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const requiredWorkflowPath = join(
  repoRoot,
  ".github/workflows/required-ci.yml",
);
const routerWorkflowPath = join(
  repoRoot,
  ".github/workflows/required-ci-router.yml",
);

const CHECKOUT =
  "actions/checkout@11d5960a326750d5838078e36cf38b85af677262";
const SETUP_NODE =
  "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020";
const REQUIRED_REPOSITORY = "Joey-Tools/codex-review-gate";
const REQUIRED_REPOSITORIES = [
  "Joey-Tools/codex-review-gate",
  "Joey-Tools/codex-apple-notes-toolkit",
  "Joey-Tools/codex-debug-triage",
  "Joey-Tools/codex-personal-sync",
  "Joey-Tools/codex-project-journal",
  "Joey-Tools/codex-private-workflows",
  "Joey-Tools/codex-review-workflows",
  "Joey-Tools/codex-rollout-backup",
  "Joey-Tools/codex-toolbox",
  "Joey-Tools/codex-waited-delivery",
  "Joey-Tools/codex-workflow-hygiene",
];

test("required CI exposes only the Node.js 20 review-gate closure", () => {
  const source = readFileSync(requiredWorkflowPath, "utf8");
  const root = rootBlock(yamlLines(source));

  assert.deepEqual(directKeys(root), ["name", "on", "permissions", "jobs"]);
  assert.equal(directScalar(root, "name"), "Required CI");

  const on = childBlock(root, "on");
  assert.deepEqual(directKeys(on), ["workflow_call"]);
  const workflowCall = childBlock(on, "workflow_call");
  assert.deepEqual(directKeys(workflowCall), []);
  assert.deepEqual(scalarMapping(childBlock(root, "permissions")), {
    contents: "read",
  });

  const jobs = childBlock(root, "jobs");
  assert.deepEqual(directKeys(jobs), ["review-gate-state-machine"]);
  const job = childBlock(jobs, "review-gate-state-machine");
  assert.deepEqual(directKeys(job), ["name", "runs-on", "steps"]);
  assert.equal(directScalar(job, "name"), "Review gate state machine");
  assert.equal(directScalar(job, "runs-on"), "ubuntu-latest");

  const steps = listItemBlocks(childBlock(job, "steps"));
  assert.equal(steps.length, 7);
  const checkoutSteps = steps.filter(
    (step) =>
      itemKeys(step).includes("uses") &&
      itemScalar(step, "uses").startsWith("actions/checkout@"),
  );
  assert.equal(checkoutSteps.length, 1);
  for (const checkoutStep of checkoutSteps) {
    assert.equal(itemScalar(checkoutStep, "uses"), CHECKOUT);
    assert.deepEqual(scalarMapping(childBlock(checkoutStep, "with")), {
      repository: REQUIRED_REPOSITORY,
      ref: "${{ github.sha }}",
      "persist-credentials": "false",
    });
  }
  assert.deepEqual(itemKeys(steps[0]), ["name", "if", "run"]);
  assert.equal(itemScalar(steps[0], "name"), "Reject unexpected repository");
  assert.equal(
    itemScalar(steps[0], "if"),
    "${{ github.repository != 'Joey-Tools/codex-review-gate' }}",
  );
  assert.equal(itemScalar(steps[0], "run"), "exit 1");
  assert.deepEqual(itemKeys(steps[1]), ["uses", "with"]);
  assert.equal(itemScalar(steps[1], "uses"), CHECKOUT);
  assert.deepEqual(itemKeys(steps[2]), ["uses", "with"]);
  assert.equal(itemScalar(steps[2], "uses"), SETUP_NODE);
  assert.deepEqual(scalarMapping(childBlock(steps[2], "with")), {
    "node-version": '"20"',
  });
  assert.deepEqual(itemKeys(steps[3]), ["run"]);
  assert.equal(itemScalar(steps[3], "run"), "npm run check:state-machine");
  assert.deepEqual(itemKeys(steps[4]), ["run"]);
  assert.equal(itemScalar(steps[4], "run"), "npm run test:state-machine");
  assert.deepEqual(itemKeys(steps[5]), ["run"]);
  assert.equal(itemScalar(steps[5], "run"), "npm run test:v2");
  assert.deepEqual(itemKeys(steps[6]), ["run"]);
  assert.equal(
    itemScalar(steps[6], "run"),
    "node --test test/required-ci-workflow.test.mjs",
  );

  assert.doesNotMatch(source, /pull_request_target|\bsecrets\b/u);
  assert.doesNotMatch(source, /inputs\.(?:repository|ref)/u);
  assert.doesNotMatch(source, /repository:\s*\$\{\{\s*github\.repository/u);
  assert.doesNotMatch(source, /^\s+[A-Za-z-]+:\s*write\s*$/mu);
});

test("the ruleset router uses a read-only pull_request envelope", () => {
  const source = readFileSync(routerWorkflowPath, "utf8");
  const root = rootBlock(yamlLines(source));

  assert.deepEqual(directKeys(root), ["name", "on", "permissions", "jobs"]);
  assert.equal(directScalar(root, "name"), "Required CI Router");
  const on = childBlock(root, "on");
  assert.deepEqual(directKeys(on), ["pull_request"]);
  assert.deepEqual(directKeys(childBlock(on, "pull_request")), []);
  assert.deepEqual(scalarMapping(childBlock(root, "permissions")), {
    contents: "read",
  });

  assert.doesNotMatch(source, /pull_request_target|actions\/checkout/u);
  assert.doesNotMatch(source, /\bsecrets\b/u);
  assert.doesNotMatch(source, /^\s+[A-Za-z-]+:\s*write\s*$/mu);
});

test("the router is unconditional and fails closed outside the exact allowlist", () => {
  const lines = readYamlLines(routerWorkflowPath);
  const jobs = childBlock(rootBlock(lines), "jobs");
  const job = childBlock(jobs, "repository-allowlist");

  assert.deepEqual(directKeys(job), ["name", "runs-on", "steps"]);
  assert.equal(
    directScalar(job, "name"),
    "Required CI repository allowlist",
  );
  assert.equal(directScalar(job, "runs-on"), "ubuntu-slim");

  const steps = listItemBlocks(childBlock(job, "steps"));
  assert.equal(steps.length, 1);
  assert.deepEqual(itemKeys(steps[0]), ["name", "shell", "env", "run"]);
  assert.equal(itemScalar(steps[0], "name"), "Reject unknown repositories");
  assert.equal(itemScalar(steps[0], "shell"), "bash");
  assert.deepEqual(scalarMapping(childBlock(steps[0], "env")), {
    REPOSITORY: "${{ github.repository }}",
  });
  assert.equal(itemScalar(steps[0], "run"), "|");

  const script = blockText(steps[0]);
  assert.deepEqual(
    [...script.matchAll(/"(Joey-Tools\/[A-Za-z0-9-]+)"/gu)].map(
      (match) => match[1],
    ),
    REQUIRED_REPOSITORIES,
  );
  assert.match(script, /case "\$REPOSITORY" in/u);
  assert.match(script, /^\s+\*\)\s*$/mu);
  assert.match(script, /^\s+exit 1\s*$/mu);
});

test("the router statically calls each protected default-branch workflow once", () => {
  const source = readFileSync(routerWorkflowPath, "utf8");
  const jobs = childBlock(rootBlock(yamlLines(source)), "jobs");
  const expectedJobIds = [
    "repository-allowlist",
    ...REQUIRED_REPOSITORIES.map((repository) => repository.split("/")[1]),
  ];
  assert.deepEqual(directKeys(jobs), expectedJobIds);

  for (const repository of REQUIRED_REPOSITORIES) {
    const slug = repository.split("/")[1];
    const job = childBlock(jobs, slug);
    assert.deepEqual(
      directKeys(job),
      repository === "Joey-Tools/codex-project-journal"
        ? ["name", "if", "uses", "with"]
        : ["name", "if", "uses"],
    );
    assert.equal(directScalar(job, "name"), `Required CI - ${slug}`);
    assert.equal(
      directScalar(job, "if"),
      `\${{ github.repository == '${repository}' }}`,
    );
    assert.equal(
      directScalar(job, "uses"),
      `${repository}/.github/workflows/required-ci.yml@master`,
    );
    if (repository === "Joey-Tools/codex-project-journal") {
      assert.deepEqual(scalarMapping(childBlock(job, "with")), {
        run_fatal_signal_tests: '"1"',
      });
    }
  }

  assert.doesNotMatch(source, /^\s+(?:repository|ref):/mu);

  const calls = [...source.matchAll(/^\s+uses:\s+(\S+)\s*$/gmu)].map(
    (match) => match[1],
  );
  assert.equal(calls.length, REQUIRED_REPOSITORIES.length);
  assert.ok(calls.every((call) => !call.includes("${{")));
  assert.ok(calls.every((call) => call.endsWith("@master")));
});

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
  assert.match(
    parent.lines[index],
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
  const pattern = new RegExp(
    `^ {${expectedIndent}}([A-Za-z0-9_-]+):(?:\\s|$)`,
    "u",
  );
  for (let index = block.start; index < block.end; index += 1) {
    const match = block.lines[index].match(pattern);
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
  const first = item.lines[item.start].match(
    new RegExp(
      `^ {${item.headerIndent}}-\\s+${escapeRegExp(key)}:\\s*(.*?)\\s*(?:#.*)?$`,
      "u",
    ),
  );
  if (first) {
    return first[1];
  }
  return directScalar(
    { ...item, headerIndent: item.headerIndent, start: item.start + 1 },
    key,
  );
}

function blockText(block) {
  return block.lines.slice(block.start, block.end).join("\n");
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
