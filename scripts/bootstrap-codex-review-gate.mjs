#!/usr/bin/env node
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";

import {
  DEFAULT_RULESET_NAME,
  DEFAULT_STATUS_CONTEXT,
  DEFAULT_STATUS_INTEGRATION_ID,
  DEFAULT_WORKFLOW_PATH,
  buildCreateRulesetPayload,
  buildUpdateRulesetPayload,
  findEffectiveRulesetWithStatusContext,
  normalizeWorkflowPath,
  parseRepoSlug,
  workflowContentEndpoint,
} from "../src/bootstrap.mjs";

async function main() {
  const options = readCliOptions();

  const repoInfo = await ghJson(`repos/${options.repo.slug}`);
  if (repoInfo.archived) {
    throw new Error(`${options.repo.slug} is archived; not changing rulesets.`);
  }

  const defaultBranch = repoInfo.default_branch;
  await assertWorkflowExists({
    repoSlug: options.repo.slug,
    workflowPath: options.workflowPath,
    defaultBranch,
  });

  const effectiveRulesets = await loadRulesets(options.repo.slug);
  const existingEffective = findEffectiveRulesetWithStatusContext(
    effectiveRulesets,
    options.context,
    { defaultBranch, integrationId: options.integrationId },
  );

  console.log(`Repository: ${options.repo.slug}`);
  console.log(`Default branch: ${defaultBranch}`);
  console.log(`Workflow: ${options.workflowPath} exists on ${defaultBranch}`);

  if (existingEffective !== undefined) {
    console.log(
      `No change: ${options.context} is already required by ${rulesetLabel(existingEffective)}.`,
    );
    return;
  }

  const repoRulesets = effectiveRulesets.filter(
    (ruleset) =>
      ruleset.source_type === "Repository" && ruleset.name === options.rulesetName,
  );
  const repoRuleset = repoRulesets.find(
    (ruleset) => ruleset.target === undefined || ruleset.target === "branch",
  );
  const nonBranchRuleset = repoRulesets.find(
    (ruleset) => ruleset.target !== undefined && ruleset.target !== "branch",
  );

  if (repoRuleset === undefined && nonBranchRuleset !== undefined) {
    throw new Error(
      `Repository ruleset "${options.rulesetName}" already targets ${nonBranchRuleset.target}; refusing to rewrite it as a branch ruleset. Use a different --ruleset-name or rename the existing ruleset.`,
    );
  }

  if (repoRuleset === undefined) {
    const payload = buildCreateRulesetPayload({
      name: options.rulesetName,
      context: options.context,
      integrationId: options.integrationId,
    });

    if (!options.apply) {
      printDryRun("create", options, payload);
      return;
    }

    const created = await ghJson(`repos/${options.repo.slug}/rulesets`, {
      method: "POST",
      body: payload,
    });
    console.log(`Created ruleset: ${rulesetLabel(created)}`);
    return;
  }

  const fullRuleset = await ghJson(`repos/${options.repo.slug}/rulesets/${repoRuleset.id}`);
  const { changed, payload } = buildUpdateRulesetPayload(fullRuleset, {
    context: options.context,
    integrationId: options.integrationId,
    defaultBranch,
  });
  if (!changed) {
    console.log(`No change: ${options.context} is already required by ${rulesetLabel(fullRuleset)}.`);
    return;
  }

  if (!options.apply) {
    printDryRun("update", options, payload, fullRuleset);
    return;
  }

  const updated = await ghJson(`repos/${options.repo.slug}/rulesets/${fullRuleset.id}`, {
    method: "PUT",
    body: payload,
  });
  console.log(`Updated ruleset: ${rulesetLabel(updated)}`);
}

function readCliOptions() {
  const { values } = parseArgs({
    options: {
      repo: { type: "string" },
      apply: { type: "boolean", default: false },
      "ruleset-name": { type: "string", default: DEFAULT_RULESET_NAME },
      context: { type: "string", default: DEFAULT_STATUS_CONTEXT },
      "integration-id": { type: "string", default: String(DEFAULT_STATUS_INTEGRATION_ID) },
      workflow: { type: "string", default: DEFAULT_WORKFLOW_PATH },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  if (values.repo === undefined) {
    printUsage();
    throw new Error("--repo OWNER/REPO is required.");
  }

  return {
    repo: parseRepoSlug(values.repo),
    apply: values.apply,
    rulesetName: values["ruleset-name"],
    context: values.context,
    integrationId: parseIntegrationId(values["integration-id"]),
    workflowPath: normalizeWorkflowPath(values.workflow),
  };
}

function printUsage() {
  console.log(`Usage: node scripts/bootstrap-codex-review-gate.mjs --repo OWNER/REPO [--apply]

Options:
  --repo OWNER/REPO        Repository to inspect or update.
  --apply                 Apply the ruleset change. Defaults to dry-run.
  --ruleset-name NAME     Repo ruleset to create or update. Defaults to "${DEFAULT_RULESET_NAME}".
  --context CONTEXT       Required status context. Defaults to "${DEFAULT_STATUS_CONTEXT}".
  --integration-id ID     Required status source app id. Defaults to GitHub Actions (${DEFAULT_STATUS_INTEGRATION_ID}). Use "any" to omit source binding.
  --workflow PATH         Gate workflow path. Defaults to "${DEFAULT_WORKFLOW_PATH}".
  -h, --help              Show this help.
`);
}

function parseIntegrationId(value) {
  if (value === "any" || value === "none" || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--integration-id must be a positive integer or "any": ${value}`);
  }
  return parsed;
}

async function assertWorkflowExists({ repoSlug, workflowPath, defaultBranch }) {
  try {
    const content = await ghJson(workflowContentEndpoint(repoSlug, workflowPath, defaultBranch));
    if (content?.type !== "file") {
      throw new Error(`GitHub Contents API returned ${content?.type ?? "non-file"} content.`);
    }
  } catch (error) {
    throw new Error(
      `${workflowPath} is not present on ${repoSlug}@${defaultBranch}; merge the gate workflow before requiring the gate status.\n${error.message}`,
    );
  }
}

async function loadRulesets(repoSlug) {
  const pages = await ghJson(`repos/${repoSlug}/rulesets?includes_parents=true&per_page=100`, {
    paginate: true,
  });
  const summaries = pages.flat();
  return Promise.all(
    summaries.map((ruleset) => ghJson(`repos/${repoSlug}/rulesets/${ruleset.id}`)),
  );
}

function printDryRun(action, options, payload, existingRuleset = null) {
  console.log(`Dry run: would ${action} repository ruleset "${payload.name}".`);
  if (existingRuleset !== null) {
    console.log(`Existing ruleset: ${rulesetLabel(existingRuleset)}`);
  }
  console.log(`Required status: ${options.context}`);
  console.log(
    `Required source: ${options.integrationId === null ? "any" : options.integrationId}`,
  );
  console.log(`Target refs: ${(payload.conditions?.ref_name?.include ?? []).join(", ")}`);
  console.log("Payload:");
  console.log(JSON.stringify(payload, null, 2));
  console.log(`Run again with --apply to ${action} it.`);
}

function rulesetLabel(ruleset) {
  const source = ruleset.source_type ?? "Repository";
  return `${ruleset.name} (${source}, id ${ruleset.id})`;
}

function ghJson(endpoint, { method = "GET", body = undefined, paginate = false } = {}) {
  return new Promise((resolve, reject) => {
    const args = ["api", endpoint];
    if (method !== "GET") {
      args.push("--method", method);
    }
    if (paginate) {
      args.push("--paginate", "--slurp");
    }
    if (body !== undefined) {
      args.push("--input", "-");
    }

    const child = spawn("gh", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    if (body !== undefined) {
      child.stdin.end(`${JSON.stringify(body)}\n`);
    } else {
      child.stdin.end();
    }

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `gh api ${endpoint} exited with ${code}`));
        return;
      }
      try {
        resolve(stdout.trim() === "" ? null : JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`gh api ${endpoint} returned invalid JSON: ${error.message}`));
      }
    });
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
