import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

const CHECKOUT = "actions/checkout@v4";
const SETUP_NODE = "actions/setup-node@v4";
const REQUIRED_REPOSITORY = "Joey-Tools/codex-review-gate";

test("required CI exposes the complete Node.js 20 delivery closure", () => {
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
  assert.equal(steps.length, 8);
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
  assert.equal(itemScalar(steps[3], "run"), "npm run check");
  assert.deepEqual(itemKeys(steps[4]), ["run"]);
  assert.equal(itemScalar(steps[4], "run"), "npm test");
  assert.deepEqual(itemKeys(steps[5]), ["run"]);
  assert.equal(itemScalar(steps[5], "run"), "bash -n scripts/release-action-subtree.sh");
  assert.deepEqual(itemKeys(steps[6]), ["run"]);
  assert.equal(itemScalar(steps[6], "run"), "shellcheck scripts/release-action-subtree.sh");
  assert.deepEqual(itemKeys(steps[7]), ["run"]);
  assert.equal(
    itemScalar(steps[7], "run"),
    "node --test test/required-ci-workflow.test.mjs",
  );

  const actionUses = steps
    .filter((step) => itemKeys(step).includes("uses"))
    .map((step) => itemScalar(step, "uses"));
  assert.deepEqual(actionUses, [CHECKOUT, SETUP_NODE]);
  for (const action of actionUses) {
    assert.match(action, /^actions\/[a-z0-9-]+@v[1-9][0-9]*$/u);
  }

  assert.doesNotMatch(source, /pull_request_target|\bsecrets\b/u);
  assert.doesNotMatch(source, /uses:\s*[^\n]+@main\b/u);
  assert.doesNotMatch(source, /uses:\s*[^\n]+@[0-9a-f]{40}\b/u);
  assert.doesNotMatch(source, /inputs\.(?:repository|ref)/u);
  assert.doesNotMatch(source, /repository:\s*\$\{\{\s*github\.repository/u);
  assert.doesNotMatch(source, /^\s+[A-Za-z-]+:\s*write\s*$/mu);
});

test(
  "the pull-request router stays deferred until all 11 protected masters publish required-ci.yml",
  () => {
    assert.equal(existsSync(routerWorkflowPath), false);
  },
);

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

function indentOf(line) {
  return line.match(/^ */u)[0].length;
}

function isIgnorable(line) {
  return /^\s*(?:#.*)?$/u.test(line);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
