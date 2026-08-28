#!/usr/bin/env node

import { readFile } from "node:fs/promises";

import { canonicalLegacyReviewGateInventoryBytes } from "../src/bootstrap.mjs";

const args = process.argv.slice(2);
if (args.length !== 7) {
  throw new Error(
    "usage: canonicalize-legacy-review-gate-inventory.mjs REPOSITORY REPOSITORY_ID REPOSITORY_NODE_ID DEFAULT_BRANCH EFFECTIVE_RULE_PAGES RULESET_DETAILS CLASSIC_REQUIRED_STATUS_CHECKS",
  );
}

const [
  repository,
  repositoryIdText,
  repositoryNodeId,
  defaultBranch,
  effectiveRulePagesPath,
  rulesetsPath,
  classicRequiredStatusChecksPath,
] = args;

if (!/^[1-9][0-9]*$/u.test(repositoryIdText)) {
  throw new Error("Repository id must be a positive decimal integer.");
}
const repositoryId = Number(repositoryIdText);
if (!Number.isSafeInteger(repositoryId)) {
  throw new Error("Repository id exceeds the JavaScript safe-integer range.");
}

const [effectiveRulePages, rulesets, classicRequiredStatusChecks] =
  await Promise.all([
    readJson(effectiveRulePagesPath, "effective rule pages"),
    readJson(rulesetsPath, "full ruleset details"),
    readJson(
      classicRequiredStatusChecksPath,
      "classic required-status checks",
    ),
  ]);

process.stdout.write(canonicalLegacyReviewGateInventoryBytes({
  repository,
  repositoryId,
  repositoryNodeId,
  defaultBranch,
  effectiveRulePages,
  rulesets,
  classicRequiredStatusChecks,
}));

async function readJson(path, label) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Unable to read ${label}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}
