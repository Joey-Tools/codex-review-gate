export const DEFAULT_STATUS_CONTEXT = "codex/review-gate";
export const DEFAULT_STATUS_INTEGRATION_ID = 15368;
export const DEFAULT_RULESET_NAME = "Must Pass Codex Review";
export const DEFAULT_WORKFLOW_PATH = ".github/workflows/codex-review-gate.yml";

const DEFAULT_REF_CONDITIONS = {
  ref_name: {
    include: ["~DEFAULT_BRANCH"],
    exclude: [],
  },
};

export function parseRepoSlug(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Repository must be provided as OWNER/REPO.");
  }

  const normalized = value.trim();
  const parts = normalized.split("/");
  if (parts.length !== 2 || parts.some((part) => part === "")) {
    throw new Error(`Repository must be provided as OWNER/REPO: ${value}`);
  }

  return {
    owner: parts[0],
    repo: parts[1],
    slug: `${parts[0]}/${parts[1]}`,
  };
}

export function rulesetHasRequiredStatusContext(
  ruleset,
  context = DEFAULT_STATUS_CONTEXT,
  { integrationId = DEFAULT_STATUS_INTEGRATION_ID } = {},
) {
  return requiredStatusChecks(ruleset).some((check) =>
    requiredStatusCheckMatches(check, context, integrationId),
  );
}

export function requiredStatusCheckContexts(ruleset) {
  return requiredStatusChecks(ruleset)
    .map((check) => check?.context)
    .filter((context) => typeof context === "string" && context !== "");
}

function requiredStatusChecks(ruleset) {
  return (ruleset.rules ?? [])
    .filter((rule) => rule.type === "required_status_checks")
    .flatMap((rule) => rule.parameters?.required_status_checks ?? []);
}

export function findEffectiveRulesetWithStatusContext(
  rulesets,
  context = DEFAULT_STATUS_CONTEXT,
  { defaultBranch = null, integrationId = DEFAULT_STATUS_INTEGRATION_ID } = {},
) {
  return rulesets.find(
    (ruleset) =>
      ruleset.enforcement === "active" &&
      rulesetCoversDefaultBranch(ruleset, defaultBranch) &&
      rulesetHasRequiredStatusContext(ruleset, context, { integrationId }),
  );
}

export function rulesetCoversDefaultBranch(ruleset, defaultBranch = null) {
  if (ruleset.target !== undefined && ruleset.target !== "branch") {
    return false;
  }

  const refName = ruleset.conditions?.ref_name;
  if (refName === undefined || refName === null) {
    return true;
  }

  const include = refName.include ?? [];
  const exclude = refName.exclude ?? [];

  if (exclude.some((pattern) => refPatternMatchesDefaultBranch(pattern, defaultBranch))) {
    return false;
  }

  return include.some((pattern) => refPatternMatchesDefaultBranch(pattern, defaultBranch));
}

export function ensureStatusContextInRules(
  existingRules,
  context = DEFAULT_STATUS_CONTEXT,
  {
    integrationId = DEFAULT_STATUS_INTEGRATION_ID,
    strict = true,
    doNotEnforceOnCreate = true,
  } = {},
) {
  const rules = existingRules.map(stripRuleForRulesetPayload);
  const index = rules.findIndex((rule) => rule.type === "required_status_checks");

  if (index === -1) {
    return {
      changed: true,
      rules: [
        ...rules,
        buildRequiredStatusChecksRule({
          context,
          integrationId,
          strict,
          doNotEnforceOnCreate,
        }),
      ],
    };
  }

  const rule = rules[index];
  const parameters = structuredCloneSafe(rule.parameters ?? {});
  const checks = [...(parameters.required_status_checks ?? [])];
  const statusIndex = checks.findIndex((check) => check?.context === context);
  let changed = false;
  if (statusIndex === -1) {
    checks.push(buildRequiredStatusCheck({ context, integrationId }));
    changed = true;
  } else if (!requiredStatusCheckMatches(checks[statusIndex], context, integrationId)) {
    checks[statusIndex] = buildRequiredStatusCheck({ context, integrationId });
    changed = true;
  }

  parameters.required_status_checks = checks.map(normalizeRequiredStatusCheck);
  if (parameters.strict_required_status_checks_policy === undefined) {
    parameters.strict_required_status_checks_policy = strict;
  }
  if (parameters.do_not_enforce_on_create === undefined) {
    parameters.do_not_enforce_on_create = doNotEnforceOnCreate;
  }

  rules[index] = {
    type: "required_status_checks",
    parameters,
  };

  return {
    changed,
    rules,
  };
}

export function buildCreateRulesetPayload({
  name = DEFAULT_RULESET_NAME,
  context = DEFAULT_STATUS_CONTEXT,
  integrationId = DEFAULT_STATUS_INTEGRATION_ID,
  strict = true,
  doNotEnforceOnCreate = true,
} = {}) {
  const { rules } = ensureStatusContextInRules([], context, {
    integrationId,
    strict,
    doNotEnforceOnCreate,
  });

  return {
    name,
    target: "branch",
    enforcement: "active",
    conditions: structuredCloneSafe(DEFAULT_REF_CONDITIONS),
    rules,
  };
}

export function buildUpdateRulesetPayload(
  ruleset,
  {
    context = DEFAULT_STATUS_CONTEXT,
    integrationId = DEFAULT_STATUS_INTEGRATION_ID,
    defaultBranch = null,
    enforcement = "active",
    strict = true,
    doNotEnforceOnCreate = true,
  } = {},
) {
  const requiredTarget = "branch";
  if (ruleset.target !== undefined && ruleset.target !== requiredTarget) {
    throw new Error(
      `Ruleset "${ruleset.name}" targets ${ruleset.target}; refusing to rewrite it as a branch ruleset.`,
    );
  }

  const coversDefaultBranch = rulesetCoversDefaultBranch(ruleset, defaultBranch);
  const requiredConditions = coversDefaultBranch
    ? structuredCloneSafe(ruleset.conditions)
    : addDefaultBranchToConditions(ruleset.conditions, defaultBranch);
  const { changed: rulesChanged, rules } = ensureStatusContextInRules(
    ruleset.rules ?? [],
    context,
    {
      integrationId,
      strict,
      doNotEnforceOnCreate,
    },
  );
  const changed =
    rulesChanged ||
    ruleset.target !== requiredTarget ||
    ruleset.enforcement !== enforcement ||
    !coversDefaultBranch;

  const payload = {
    name: ruleset.name,
    target: requiredTarget,
    enforcement,
    rules,
  };
  if (requiredConditions !== undefined) {
    payload.conditions = requiredConditions;
  }

  if (Array.isArray(ruleset.bypass_actors) && ruleset.bypass_actors.length > 0) {
    payload.bypass_actors = ruleset.bypass_actors.map(stripBypassActorForRulesetPayload);
  }

  return { changed, payload };
}

export function workflowContentEndpoint(repoSlug, workflowPath, ref) {
  const encodedWorkflowPath = workflowPath.split("/").map(encodeURIComponent).join("/");
  return `repos/${repoSlug}/contents/${encodedWorkflowPath}?ref=${encodeURIComponent(ref)}`;
}

export function normalizeWorkflowPath(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Workflow path must be a non-empty .github/workflows/*.yml or *.yaml file.");
  }

  const normalized = value.trim();
  if (!/^\.github\/workflows\/[^/]+\.ya?ml$/.test(normalized)) {
    throw new Error(
      `Workflow path must be a .github/workflows/*.yml or *.yaml file: ${value}`,
    );
  }
  return normalized;
}

function buildRequiredStatusChecksRule({
  context,
  integrationId,
  strict,
  doNotEnforceOnCreate,
}) {
  return {
    type: "required_status_checks",
    parameters: {
      strict_required_status_checks_policy: strict,
      do_not_enforce_on_create: doNotEnforceOnCreate,
      required_status_checks: [buildRequiredStatusCheck({ context, integrationId })],
    },
  };
}

function buildRequiredStatusCheck({ context, integrationId }) {
  const check = { context };
  if (integrationId !== undefined && integrationId !== null) {
    check.integration_id = Number(integrationId);
  }
  return check;
}

function normalizeRequiredStatusCheck(check) {
  const normalized = { context: check.context };
  if (check.integration_id !== undefined) {
    normalized.integration_id = check.integration_id;
  }
  return normalized;
}

function stripRuleForRulesetPayload(rule) {
  const stripped = { type: rule.type };
  if (rule.parameters !== undefined && rule.parameters !== null) {
    stripped.parameters = structuredCloneSafe(rule.parameters);
  }
  return stripped;
}

function stripBypassActorForRulesetPayload(actor) {
  const stripped = {
    actor_id: actor.actor_id,
    actor_type: actor.actor_type,
    bypass_mode: actor.bypass_mode,
  };

  return Object.fromEntries(
    Object.entries(stripped).filter(([, value]) => value !== undefined),
  );
}

function structuredCloneSafe(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}

function addDefaultBranchToConditions(conditions, defaultBranch) {
  if (conditions === undefined || conditions === null) {
    return structuredCloneSafe(DEFAULT_REF_CONDITIONS);
  }

  const nextConditions = structuredCloneSafe(conditions);
  const refName = nextConditions.ref_name ?? {};
  const include = Array.isArray(refName.include) ? [...refName.include] : [];
  const exclude = Array.isArray(refName.exclude) ? [...refName.exclude] : [];
  const broadDefaultBranchExclude = exclude.find(
    (pattern) =>
      refPatternMatchesDefaultBranch(pattern, defaultBranch) &&
      !isExactDefaultBranchPattern(pattern, defaultBranch),
  );
  if (broadDefaultBranchExclude !== undefined) {
    throw new Error(
      `Existing ruleset excludes the default branch with non-exact pattern "${broadDefaultBranchExclude}"; refusing to broaden its branch coverage.`,
    );
  }

  if (!include.some((pattern) => refPatternMatchesDefaultBranch(pattern, defaultBranch))) {
    include.push("~DEFAULT_BRANCH");
  }

  nextConditions.ref_name = {
    ...refName,
    include,
    exclude: exclude.filter(
      (pattern) => !isExactDefaultBranchPattern(pattern, defaultBranch),
    ),
  };
  return nextConditions;
}

function isExactDefaultBranchPattern(pattern, defaultBranch) {
  if (pattern === "~DEFAULT_BRANCH") {
    return true;
  }

  if (typeof defaultBranch !== "string" || defaultBranch === "") {
    return false;
  }

  return pattern === defaultBranch || pattern === `refs/heads/${defaultBranch}`;
}

function refPatternMatchesDefaultBranch(pattern, defaultBranch) {
  if (pattern === "~DEFAULT_BRANCH" || pattern === "~ALL") {
    return true;
  }

  if (
    typeof pattern !== "string" ||
    pattern === "" ||
    typeof defaultBranch !== "string" ||
    defaultBranch === ""
  ) {
    return false;
  }

  const branchRef = `refs/heads/${defaultBranch}`;
  if (pattern === defaultBranch || pattern === branchRef) {
    return true;
  }

  if (pattern.includes("*") || pattern.includes("?") || pattern.includes("[")) {
    const regex = branchPatternToRegExp(pattern);
    return regex.test(defaultBranch) || regex.test(branchRef);
  }

  return false;
}

function requiredStatusCheckMatches(check, context, integrationId) {
  if (check?.context !== context) {
    return false;
  }
  if (integrationId === undefined) {
    return true;
  }
  if (integrationId === null) {
    return check.integration_id === undefined || check.integration_id === null;
  }
  return Number(check.integration_id) === Number(integrationId);
}

function branchPatternToRegExp(pattern) {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else if (char === "[") {
      const characterClass = readCharacterClass(pattern, index);
      if (characterClass === null) {
        source += escapeRegExp(char);
      } else {
        source += characterClass.source;
        index = characterClass.end;
      }
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`^${source}$`);
}

function readCharacterClass(pattern, start) {
  const end = pattern.indexOf("]", start + 1);
  if (end === -1) {
    return null;
  }

  let body = pattern.slice(start + 1, end);
  if (body === "") {
    return null;
  }

  let negate = "";
  if (body.startsWith("!") || body.startsWith("^")) {
    negate = "^";
    body = body.slice(1);
  }
  if (body === "") {
    return null;
  }

  const escapedBody = escapeCharacterClassBody(body);
  const source = negate === "^" && !body.includes("/")
    ? `[^/${escapedBody}]`
    : `[${negate}${escapedBody}]`;
  return { end, source };
}

function escapeCharacterClassBody(value) {
  return value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
