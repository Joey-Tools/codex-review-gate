import { Buffer } from "node:buffer";

export const DEFAULT_STATUS_CONTEXT = "codex/github-review-gate";
export const LEGACY_STATUS_CONTEXT = "codex/review-gate";
export const DEFAULT_STATUS_INTEGRATION_ID = 15368;
export const DEFAULT_RULESET_NAME = "Must Pass Codex Review";
export const DEFAULT_WORKFLOW_PATH = ".github/workflows/codex-review-gate.yml";
export const DEFAULT_VERIFIER_RUN_NAME_PREFIX = "codex-review-gate-verifier";
export const DEFAULT_VERIFIER_RUN_NAME =
  `${DEFAULT_VERIFIER_RUN_NAME_PREFIX}/\${{ github.event.pull_request.number }}/\${{ github.sha }}`;
export const DEFAULT_CONTROLLER_WORKFLOW_PATH =
  ".github/workflows/codex-review-gate-controller.yml";
export const DEFAULT_RULESET_ENFORCEMENT = "disabled";
export const DEFAULT_CONTROL_PLANE_OWNER = "@JoeyTeng";
export const DEFAULT_CODEOWNERS_PATH = ".github/CODEOWNERS";
export const CANONICAL_V2_WORKFLOW_USES =
  "JoeyTeng/codex-review-gate-action@v2";
export const LEGACY_V1_WORKFLOW_USES =
  "JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1";
const LEGACY_V1_DIRECT_ACTION_USES = "JoeyTeng/codex-review-gate-action@v1";
const SINGLE_PRODUCER_WRITE_PERMISSIONS = new Set([
  "actions",
  "checks",
  "issues",
  "pull-requests",
  "statuses",
]);
const CODEX_REVIEW_GATE_CALLER_PATTERN =
  /(?:^|[\s,{])["']?uses["']?\s*:\s*["']?JoeyTeng\/codex-review-gate-action(?:\/\.github\/workflows\/codex-review-gate\.ya?ml)?@[^\s,}#"']+/imu;
const CONTROL_PLANE_CODEOWNERS_BEGIN =
  "# BEGIN codex-review-gate control-plane";
const CONTROL_PLANE_CODEOWNERS_END =
  "# END codex-review-gate control-plane";
const CONTROL_PLANE_CODEOWNERS_PATTERNS = [
  "/.github/workflows/",
  "/.github/CODEOWNERS",
];
const CANONICAL_CONTROLLER_JOB_IF_EXPRESSION = normalizeWorkflowExpression(`
  \${{
    (
      github.event_name == 'workflow_dispatch' &&
      github.ref_type == 'branch' &&
      github.ref_name == github.event.repository.default_branch
    ) ||
    (
      github.event_name == 'issue_comment' &&
      (github.event.action == 'created' || github.event.action == 'edited') &&
      github.event.issue.pull_request &&
      github.event.sender.login == 'chatgpt-codex-connector[bot]' &&
      github.event.sender.type == 'Bot' &&
      github.event.comment.user.login == 'chatgpt-codex-connector[bot]' &&
      github.event.comment.user.type == 'Bot'
    )
  }}
`);

const DEFAULT_REF_CONDITIONS = {
  ref_name: {
    include: ["~DEFAULT_BRANCH"],
    exclude: [],
  },
};

export function directoryWitnessFromMetadata(path, metadata, label = "Directory") {
  if (metadata === null || metadata === undefined) {
    throw new Error(`${label} is missing: ${path}`);
  }
  if (metadata.isSymbolicLink()) {
    throw new Error(`${label} must not be a symbolic link: ${path}`);
  }
  if (!metadata.isDirectory()) {
    throw new Error(`${label} must be a directory: ${path}`);
  }

  const permissionMask = typeof metadata.mode === "bigint" ? 0o7777n : 0o7777;
  return {
    path,
    dev: metadata.dev,
    ino: metadata.ino,
    mode: metadata.mode & permissionMask,
    uid: metadata.uid,
    gid: metadata.gid,
  };
}

export function assertDirectoryWitnessStable(
  expected,
  metadata,
  phase = "revalidation",
) {
  const current = directoryWitnessFromMetadata(expected.path, metadata, "Verified parent");
  if (current.dev !== expected.dev || current.ino !== expected.ino) {
    throw new Error(
      `Verified parent object identity changed during ${phase}: ${expected.path}`,
    );
  }
  if (
    current.mode !== expected.mode ||
    current.uid !== expected.uid ||
    current.gid !== expected.gid
  ) {
    throw new Error(
      `Verified parent access policy changed during ${phase}: ${expected.path}`,
    );
  }
  return current;
}

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

export function normalizeControlPlaneOwner(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Control-plane owner must be a GitHub user handle such as @JoeyTeng.");
  }

  const normalized = value.trim();
  if (!/^@[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(normalized)) {
    throw new Error(
      `Control-plane owner must be one GitHub user handle such as @JoeyTeng: ${value}`,
    );
  }
  return normalized;
}

export function ensureControlPlaneCodeownersContent(
  existing,
  owner = DEFAULT_CONTROL_PLANE_OWNER,
) {
  const normalizedOwner = normalizeControlPlaneOwner(owner);
  if (existing !== null && typeof existing !== "string") {
    throw new Error("Existing .github/CODEOWNERS content must be UTF-8 text or null.");
  }
  if (existing?.includes("\0")) {
    throw new Error("Existing .github/CODEOWNERS contains a NUL byte.");
  }

  const source = existing ?? "";
  const newline = selectCodeownersNewline(source);
  const lines = source === "" ? [] : source.split(newline);
  const beginIndexes = findExactLineIndexes(lines, CONTROL_PLANE_CODEOWNERS_BEGIN);
  const endIndexes = findExactLineIndexes(lines, CONTROL_PLANE_CODEOWNERS_END);
  if (beginIndexes.length !== endIndexes.length || beginIndexes.length > 1) {
    throw new Error(
      "Existing .github/CODEOWNERS has an ambiguous codex-review-gate managed block.",
    );
  }

  let unmanagedLines = lines;
  if (beginIndexes.length === 1) {
    const begin = beginIndexes[0];
    const end = endIndexes[0];
    if (end <= begin) {
      throw new Error(
        "Existing .github/CODEOWNERS has a malformed codex-review-gate managed block.",
      );
    }
    unmanagedLines = [...lines.slice(0, begin), ...lines.slice(end + 1)];
  }

  while (
    unmanagedLines.length > 0 &&
    unmanagedLines[unmanagedLines.length - 1].trim() === ""
  ) {
    unmanagedLines = unmanagedLines.slice(0, -1);
  }
  const managedLines = [
    CONTROL_PLANE_CODEOWNERS_BEGIN,
    ...CONTROL_PLANE_CODEOWNERS_PATTERNS.map(
      (pattern) => `${pattern} ${normalizedOwner}`,
    ),
    CONTROL_PLANE_CODEOWNERS_END,
  ];
  const content = [
    ...unmanagedLines,
    ...(unmanagedLines.length > 0 ? [""] : []),
    ...managedLines,
  ].join(newline) + newline;
  validateControlPlaneCodeownersContent(content, normalizedOwner);
  return { changed: content !== source, content };
}

export function validateControlPlaneCodeownersContent(
  value,
  owner = DEFAULT_CONTROL_PLANE_OWNER,
) {
  const normalizedOwner = normalizeControlPlaneOwner(owner);
  if (typeof value !== "string" || value === "" || value.includes("\0")) {
    throw new Error("Default-branch .github/CODEOWNERS must be non-empty UTF-8 text.");
  }
  if (Buffer.byteLength(value, "utf8") >= 3 * 1024 * 1024) {
    throw new Error("Default-branch .github/CODEOWNERS must remain below GitHub's 3 MB limit.");
  }
  const lines = value.split(/\r?\n/u);
  const rules = lines
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  const expected = CONTROL_PLANE_CODEOWNERS_PATTERNS.map(
    (pattern) => `${pattern} ${normalizedOwner}`,
  );
  const beginIndexes = findExactLineIndexes(lines, CONTROL_PLANE_CODEOWNERS_BEGIN);
  const endIndexes = findExactLineIndexes(lines, CONTROL_PLANE_CODEOWNERS_END);
  if (
    beginIndexes.length !== 1 ||
    endIndexes.length !== 1 ||
    endIndexes[0] !== beginIndexes[0] + 3 ||
    endIndexes[0] !== lines.length - 2 ||
    lines[beginIndexes[0] + 1] !== expected[0] ||
    lines[beginIndexes[0] + 2] !== expected[1] ||
    rules.length < expected.length ||
    rules[rules.length - 2] !== expected[0] ||
    rules[rules.length - 1] !== expected[1]
  ) {
    throw new Error(
      `Default-branch .github/CODEOWNERS must end with exact, non-overridable ownership for /.github/workflows/ and /.github/CODEOWNERS by ${normalizedOwner}.`,
    );
  }
  return value;
}

export function codeownersHasEffectiveUnmanagedPatterns(value) {
  if (typeof value !== "string" || value === "" || value.includes("\0")) {
    throw new Error("Default-branch .github/CODEOWNERS must be non-empty UTF-8 text.");
  }
  const lines = value.split(/\r?\n/u);
  const beginIndexes = findExactLineIndexes(lines, CONTROL_PLANE_CODEOWNERS_BEGIN);
  const endIndexes = findExactLineIndexes(lines, CONTROL_PLANE_CODEOWNERS_END);
  if (beginIndexes.length !== 1 || endIndexes.length !== 1 || endIndexes[0] <= beginIndexes[0]) {
    throw new Error(
      "Default-branch .github/CODEOWNERS has an ambiguous codex-review-gate managed block.",
    );
  }
  return lines.some((line, index) => {
    if (index >= beginIndexes[0] && index <= endIndexes[0]) {
      return false;
    }
    const trimmed = line.trim();
    return trimmed !== "" && !trimmed.startsWith("#");
  });
}

export function rulesetHasRequiredStatusContext(
  ruleset,
  context = DEFAULT_STATUS_CONTEXT,
  options = {},
) {
  const integrationId = Object.prototype.hasOwnProperty.call(options, "integrationId")
    ? options.integrationId
    : DEFAULT_STATUS_INTEGRATION_ID;
  return requiredStatusChecks(ruleset).some((check) =>
    requiredStatusCheckMatches(check, context, integrationId),
  );
}

export function rulesetHasRequiredPullRequestPolicy(ruleset) {
  return (ruleset.rules ?? []).some(
    (rule) =>
      rule.type === "pull_request" &&
      rule.parameters?.required_review_thread_resolution === true &&
      rule.parameters?.require_code_owner_review === true &&
      rule.parameters?.dismiss_stale_reviews_on_push === true &&
      Number.isSafeInteger(rule.parameters?.required_approving_review_count) &&
      rule.parameters.required_approving_review_count >= 0,
  );
}

export function rulesetHasNonFastForwardPolicy(ruleset) {
  return (ruleset.rules ?? []).some(
    (rule) =>
      rule.type === "non_fast_forward" &&
      (rule.parameters === undefined || rule.parameters === null),
  );
}

export function rulesetHasGatePolicy(
  ruleset,
  context = DEFAULT_STATUS_CONTEXT,
  { integrationId = DEFAULT_STATUS_INTEGRATION_ID } = {},
) {
  return (
    rulesetHasOneBoundStrictStatusPolicy(ruleset, context, integrationId) &&
    rulesetHasRequiredPullRequestPolicy(ruleset) &&
    rulesetHasNonFastForwardPolicy(ruleset) &&
    Array.isArray(ruleset.bypass_actors) &&
    ruleset.bypass_actors.length === 0
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

function rulesetHasOneBoundStrictStatusPolicy(ruleset, context, integrationId) {
  const statusRules = (ruleset.rules ?? []).filter(
    (rule) => rule.type === "required_status_checks",
  );
  return (
    statusRules.length === 1 &&
    statusRules[0].parameters?.strict_required_status_checks_policy === true &&
    (statusRules[0].parameters?.required_status_checks ?? []).some(
      (check) => requiredStatusCheckMatches(check, context, integrationId),
    )
  );
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

export function findEffectiveRulesetWithGatePolicy(
  rulesets,
  context = DEFAULT_STATUS_CONTEXT,
  { defaultBranch = null, integrationId = DEFAULT_STATUS_INTEGRATION_ID } = {},
) {
  return rulesets.find(
    (ruleset) =>
      ruleset.enforcement === "active" &&
      rulesetCoversDefaultBranch(ruleset, defaultBranch) &&
      rulesetHasGatePolicy(ruleset, context, { integrationId }),
  );
}

export function assertCompleteRulesetApiObject(ruleset) {
  assertJsonNumbersAreSafeIntegers(ruleset, "Full ruleset API readback");
  if (
    ruleset === null ||
    typeof ruleset !== "object" ||
    Array.isArray(ruleset) ||
    !Number.isSafeInteger(ruleset.id) ||
    ruleset.id <= 0 ||
    typeof ruleset.name !== "string" ||
    ruleset.name === "" ||
    typeof ruleset.source_type !== "string" ||
    ruleset.source_type === "" ||
    typeof ruleset.source !== "string" ||
    ruleset.source === "" ||
    typeof ruleset.enforcement !== "string" ||
    ruleset.enforcement === "" ||
    typeof ruleset.target !== "string" ||
    ruleset.target === "" ||
    ruleset.conditions === null ||
    typeof ruleset.conditions !== "object" ||
    Array.isArray(ruleset.conditions) ||
    !Array.isArray(ruleset.bypass_actors) ||
    !Array.isArray(ruleset.rules)
  ) {
    throw new Error(
      "Full ruleset API readback is malformed or omits identity, source, enforcement, target, conditions, bypass_actors, or rules.",
    );
  }

  for (const actor of ruleset.bypass_actors) {
    assertLegacyInventoryBypassActor(actor, ruleset.target);
  }
  for (const rule of ruleset.rules) {
    assertLegacyInventoryRule(rule, "Full ruleset API readback");
  }
  if (
    ruleset.rules.filter((rule) => rule.type === "required_status_checks").length > 1
  ) {
    throw new Error(
      "Full ruleset API readback contains duplicate required_status_checks rules.",
    );
  }
  return ruleset;
}

export function canonicalClassicRequiredStatusChecks(value) {
  if (value === null) {
    return null;
  }
  if (
    value === undefined ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.strict !== "boolean" ||
    !Array.isArray(value.contexts) ||
    !Array.isArray(value.checks)
  ) {
    throw new Error(
      "Classic branch protection required_status_checks is malformed or incomplete.",
    );
  }

  const contexts = value.contexts.map((context) => {
    if (typeof context !== "string" || context === "") {
      throw new Error(
        "Classic branch protection contexts contain a malformed status context.",
      );
    }
    return context;
  });
  const checks = value.checks.map((check) => {
    if (
      check === null ||
      typeof check !== "object" ||
      Array.isArray(check) ||
      typeof check.context !== "string" ||
      check.context === "" ||
      !Object.prototype.hasOwnProperty.call(check, "app_id") ||
      !validClassicAppId(check.app_id)
    ) {
      throw new Error(
        "Classic branch protection checks must contain a status context and explicit app_id (positive integer, -1, or null).",
      );
    }
    return { context: check.context, app_id: check.app_id };
  });

  contexts.sort(compareCanonicalText);
  checks.sort(compareClassicStatusCheck);
  return { strict: value.strict, contexts, checks };
}

export function buildCanonicalLegacyReviewGateInventory({
  repository,
  repositoryId,
  repositoryNodeId,
  defaultBranch,
  effectiveRulePages,
  rulesets,
  classicRequiredStatusChecks,
}) {
  if (typeof repository !== "string" || repository === "") {
    throw new Error("Legacy inventory repository must be a non-empty string.");
  }
  if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) {
    throw new Error("Legacy inventory repository id must be a positive safe integer.");
  }
  if (typeof repositoryNodeId !== "string" || repositoryNodeId === "") {
    throw new Error("Legacy inventory repository node id must be a non-empty string.");
  }
  if (typeof defaultBranch !== "string" || defaultBranch === "") {
    throw new Error("Legacy inventory default branch must be a non-empty string.");
  }
  if (
    !Array.isArray(effectiveRulePages) ||
    effectiveRulePages.length === 0 ||
    effectiveRulePages.some((page) => !Array.isArray(page))
  ) {
    throw new Error(
      "Effective ruleset inventory must be a complete paginated array of arrays.",
    );
  }
  if (!Array.isArray(rulesets)) {
    throw new Error("Legacy full-ruleset inventory must be an array.");
  }

  const effectiveLegacyRules = [];
  for (const rule of effectiveRulePages.flat()) {
    assertEffectiveRulesetRule(rule);
    if (
      rule.type === "required_status_checks" &&
      rule.parameters.required_status_checks.some(
        (check) => check.context === LEGACY_STATUS_CONTEXT,
      )
    ) {
      effectiveLegacyRules.push(rule);
    }
  }

  const rulesetsById = new Map();
  for (const ruleset of rulesets) {
    assertCompleteRulesetApiObject(ruleset);
    if (rulesetsById.has(ruleset.id)) {
      throw new Error(`Legacy full-ruleset inventory repeats id ${ruleset.id}.`);
    }
    rulesetsById.set(ruleset.id, ruleset);
  }
  const expectedIds = new Set(effectiveLegacyRules.map((rule) => rule.ruleset_id));
  if (
    rulesetsById.size !== expectedIds.size ||
    [...rulesetsById.keys()].some((id) => !expectedIds.has(id))
  ) {
    throw new Error(
      "Legacy full-ruleset inventory does not exactly cover the effective legacy ruleset ids.",
    );
  }

  const canonicalRulesets = effectiveLegacyRules.map((effectiveRule) => {
    const ruleset = rulesetsById.get(effectiveRule.ruleset_id);
    if (ruleset === undefined) {
      throw new Error(
        `Effective legacy ruleset ${effectiveRule.ruleset_id} lacks a full API readback.`,
      );
    }
    if (
      !ruleset.rules.some(
        (rule) =>
          rule.type === "required_status_checks" &&
          rule.parameters.required_status_checks.some(
            (check) => check.context === LEGACY_STATUS_CONTEXT,
          ),
      )
    ) {
      throw new Error(
        `Full ruleset ${ruleset.id} disagrees with its effective legacy status-check rule.`,
      );
    }
    return {
      id: ruleset.id,
      name: ruleset.name,
      source_type: ruleset.source_type,
      source: ruleset.source,
      enforcement: ruleset.enforcement,
      target: ruleset.target,
      conditions: canonicalSemanticValue(ruleset.conditions),
      bypass_actors: ruleset.bypass_actors
        .map((actor) => structuredCloneSafe(actor))
        .sort(compareLegacyBypassActor),
      rules: canonicalSemanticValue(ruleset.rules),
      effective_required_status_checks_rule:
        canonicalEffectiveRequiredStatusChecksRule(effectiveRule),
    };
  });
  canonicalRulesets.sort((left, right) =>
    compareCanonicalText(canonicalJson(left), canonicalJson(right))
  );

  return {
    repository,
    repository_id: repositoryId,
    repository_node_id: repositoryNodeId,
    default_branch: defaultBranch,
    rulesets: canonicalRulesets,
    classic_required_status_checks:
      canonicalClassicRequiredStatusChecks(classicRequiredStatusChecks),
  };
}

export function canonicalLegacyReviewGateInventoryBytes(input) {
  return `${canonicalJson(buildCanonicalLegacyReviewGateInventory(input))}\n`;
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
  if (!Array.isArray(include) || !Array.isArray(exclude)) {
    throw new Error(
      "Ruleset ref_name include/exclude conditions must be arrays before branch coverage can be proved.",
    );
  }

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
    doNotEnforceOnCreate = undefined,
    removeContexts = [LEGACY_STATUS_CONTEXT],
  } = {},
) {
  if (integrationId !== DEFAULT_STATUS_INTEGRATION_ID) {
    throw new Error(
      `Codex Review Gate requires the GitHub Actions source integration id ${DEFAULT_STATUS_INTEGRATION_ID}.`,
    );
  }
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
  const originalChecks = [...(parameters.required_status_checks ?? [])];
  const removableContexts = new Set(removeContexts.filter((item) => item !== context));
  const checks = originalChecks.filter((check) => !removableContexts.has(check?.context));
  const statusIndex = checks.findIndex((check) => check?.context === context);
  let changed = checks.length !== originalChecks.length;
  if (statusIndex === -1) {
    checks.push(buildRequiredStatusCheck({ context, integrationId }));
    changed = true;
  } else if (!requiredStatusCheckMatches(checks[statusIndex], context, integrationId)) {
    checks[statusIndex] = buildRequiredStatusCheck({ context, integrationId });
    changed = true;
  }

  parameters.required_status_checks = checks.map(normalizeRequiredStatusCheck);
  if (parameters.strict_required_status_checks_policy !== strict) {
    parameters.strict_required_status_checks_policy = strict;
    changed = true;
  }
  if (
    doNotEnforceOnCreate !== undefined &&
    parameters.do_not_enforce_on_create !== doNotEnforceOnCreate
  ) {
    parameters.do_not_enforce_on_create = doNotEnforceOnCreate;
    changed = true;
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

export function ensurePullRequestPolicyInRules(existingRules) {
  const rules = existingRules.map(stripRuleForRulesetPayload);
  const index = rules.findIndex((rule) => rule.type === "pull_request");
  if (index === -1) {
    return {
      changed: true,
      rules: [buildPullRequestRule(), ...rules],
    };
  }

  const rule = rules[index];
  const parameters = structuredCloneSafe(rule.parameters ?? {});
  let changed = false;
  for (const [key, value] of Object.entries(defaultPullRequestParameters())) {
    if (parameters[key] === undefined) {
      parameters[key] = value;
      changed = true;
    }
  }
  if (parameters.required_review_thread_resolution !== true) {
    parameters.required_review_thread_resolution = true;
    changed = true;
  }
  if (parameters.require_code_owner_review !== true) {
    parameters.require_code_owner_review = true;
    changed = true;
  }
  if (parameters.dismiss_stale_reviews_on_push !== true) {
    parameters.dismiss_stale_reviews_on_push = true;
    changed = true;
  }
  if (
    !Number.isSafeInteger(parameters.required_approving_review_count) ||
    parameters.required_approving_review_count < 0
  ) {
    parameters.required_approving_review_count = 0;
    changed = true;
  }
  rules[index] = { type: "pull_request", parameters };
  return { changed, rules };
}

export function ensureNonFastForwardPolicyInRules(existingRules) {
  const rules = existingRules.map(stripRuleForRulesetPayload);
  const indexes = rules.flatMap((rule, index) =>
    rule.type === "non_fast_forward" ? [index] : []
  );
  if (indexes.length === 0) {
    return {
      changed: true,
      rules: [...rules, { type: "non_fast_forward" }],
    };
  }
  const keptIndex = indexes[0];
  const normalized = rules.filter(
    (rule, index) => rule.type !== "non_fast_forward" || index === keptIndex,
  );
  const normalizedIndex = normalized.findIndex((rule) => rule.type === "non_fast_forward");
  const changed = indexes.length !== 1 || normalized[normalizedIndex].parameters !== undefined;
  normalized[normalizedIndex] = { type: "non_fast_forward" };
  return { changed, rules: normalized };
}

export function ensureGatePolicyInRules(
  existingRules,
  context = DEFAULT_STATUS_CONTEXT,
  {
    integrationId = DEFAULT_STATUS_INTEGRATION_ID,
    strict = true,
    doNotEnforceOnCreate = undefined,
    removeContexts = [LEGACY_STATUS_CONTEXT],
  } = {},
) {
  const pullRequest = ensurePullRequestPolicyInRules(existingRules);
  const status = ensureStatusContextInRules(pullRequest.rules, context, {
    integrationId,
    strict,
    doNotEnforceOnCreate,
    removeContexts,
  });
  const nonFastForward = ensureNonFastForwardPolicyInRules(status.rules);
  return {
    changed: pullRequest.changed || status.changed || nonFastForward.changed,
    rules: nonFastForward.rules,
  };
}

export function buildCreateRulesetPayload({
  name = DEFAULT_RULESET_NAME,
  context = DEFAULT_STATUS_CONTEXT,
  integrationId = DEFAULT_STATUS_INTEGRATION_ID,
  enforcement = DEFAULT_RULESET_ENFORCEMENT,
  strict = true,
  doNotEnforceOnCreate = undefined,
} = {}) {
  const { rules } = ensureGatePolicyInRules([], context, {
    integrationId,
    strict,
    doNotEnforceOnCreate,
  });

  return {
    name,
    target: "branch",
    enforcement,
    bypass_actors: [],
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
    enforcement = undefined,
    strict = true,
    doNotEnforceOnCreate = undefined,
  } = {},
) {
  const requiredTarget = "branch";
  if (ruleset.target !== undefined && ruleset.target !== requiredTarget) {
    throw new Error(
      `Ruleset "${ruleset.name}" targets ${ruleset.target}; refusing to rewrite it as a branch ruleset.`,
    );
  }

  const coversDefaultBranch = rulesetCoversDefaultBranch(ruleset, defaultBranch);
  const preservesCompleteActivePolicy =
    ruleset.enforcement === "active" &&
    coversDefaultBranch &&
    rulesetHasGatePolicy(ruleset, context, { integrationId });
  const requiredEnforcement = enforcement ?? (
    preservesCompleteActivePolicy ? "active" : DEFAULT_RULESET_ENFORCEMENT
  );
  if (ruleset.enforcement === "active" && !preservesCompleteActivePolicy) {
    throw new Error(
      `Ruleset "${ruleset.name}" is an active legacy or incomplete gate; refusing to disable it during v2 staging. Keep it active and use a distinct --ruleset-name for the disabled v2 ruleset.`,
    );
  }
  const requiredConditions = coversDefaultBranch
    ? structuredCloneSafe(ruleset.conditions)
    : addDefaultBranchToConditions(ruleset.conditions, defaultBranch);
  const { changed: rulesChanged, rules } = ensureGatePolicyInRules(
    ruleset.rules ?? [],
    context,
    {
      integrationId,
      strict,
      doNotEnforceOnCreate,
      removeContexts: preservesCompleteActivePolicy ? [] : [LEGACY_STATUS_CONTEXT],
    },
  );
  const changed =
    rulesChanged ||
    ruleset.target !== requiredTarget ||
    ruleset.enforcement !== requiredEnforcement ||
    !coversDefaultBranch ||
    !Array.isArray(ruleset.bypass_actors) ||
    ruleset.bypass_actors.length > 0;

  const payload = {
    name: ruleset.name,
    target: requiredTarget,
    enforcement: requiredEnforcement,
    bypass_actors: [],
    rules,
  };
  if (requiredConditions !== undefined) {
    payload.conditions = requiredConditions;
  }

  return { changed, payload };
}

export function rulesetWritableFingerprint(ruleset) {
  if (ruleset === null || typeof ruleset !== "object" || Array.isArray(ruleset)) {
    throw new Error("Ruleset readback must be an object before update.");
  }
  return canonicalJson({
    name: ruleset.name,
    target: ruleset.target,
    enforcement: ruleset.enforcement,
    bypass_actors: Array.isArray(ruleset.bypass_actors)
      ? ruleset.bypass_actors.map(stripBypassActorForRulesetPayload)
      : ruleset.bypass_actors,
    conditions: structuredCloneSafe(ruleset.conditions),
    rules: Array.isArray(ruleset.rules)
      ? ruleset.rules.map(stripRuleForRulesetPayload)
      : ruleset.rules,
  });
}

export function validateCanonicalV2WorkflowContent(value) {
  return validateCanonicalV2VerifierWorkflowContent(value);
}

export function validateCanonicalV2VerifierWorkflowContent(value) {
  if (typeof value !== "string" || value === "") {
    throw new Error("Canonical v2 verifier workflow must be non-empty UTF-8 text.");
  }
  assertCanonicalWorkflowLineEndings(value);
  const runNameLines = value
    .split("\n")
    .filter((line) => {
      const mapping = matchSimpleYamlMappingLine(line);
      return mapping?.indent === 0 && mapping.key === "run-name";
    });
  if (
    runNameLines.length !== 1 ||
    runNameLines[0] !== `run-name: ${DEFAULT_VERIFIER_RUN_NAME}`
  ) {
    throw new Error(
      `Canonical v2 verifier workflow must expose exactly one top-level run-name: ${DEFAULT_VERIFIER_RUN_NAME}`,
    );
  }
  assertOneCanonicalActionCall(value, "verifier");
  assertCommonWorkflowSafety(value, "verifier");
  if (value.includes(LEGACY_V1_WORKFLOW_USES) || /@v1(?:\s|$)/m.test(value)) {
    throw new Error("Canonical v2 verifier workflow must not retain a v1 caller.");
  }
  if (!/^  pull_request:\n    types: \[opened, reopened, synchronize, ready_for_review\]$/m.test(value)) {
    throw new Error(
      "Canonical v2 verifier workflow must expose only the adopted pull_request lifecycle types.",
    );
  }
  for (const forbiddenEvent of [
    "issue_comment",
    "workflow_dispatch",
    "pull_request_target",
    "pull_request_review",
    "pull_request_review_comment",
    "repository_dispatch",
  ]) {
    if (new RegExp(`^  ${forbiddenEvent}:`, "m").test(value)) {
      throw new Error(
        `Canonical v2 verifier workflow must not expose ${forbiddenEvent}.`,
      );
    }
  }
  if (!/^  cancel-in-progress: true$/m.test(value)) {
    throw new Error("Canonical v2 verifier workflow must cancel superseded attempts.");
  }
  for (const fragment of [
    "jobs:\n  codex-review-gate:",
    `name: ${DEFAULT_STATUS_CONTEXT}`,
    "permissions:\n  contents: read\n  issues: read\n  pull-requests: read",
    "github.event.pull_request.number",
    "github.event.pull_request.head.sha",
    "operation: reconcile",
    "request_review: false",
    "CODEX_REVIEW_GATE_LIMITS_PROFILE",
    "CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION: ${{ vars.CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION == 'any' && 'any' || 'write' }}",
    "CODEX_REVIEW_GATE_USE_UBUNTU_LATEST",
  ]) {
    if (!value.includes(fragment)) {
      throw new Error(
        `Canonical v2 verifier workflow is missing required fragment: ${fragment}`,
      );
    }
  }
  if (workflowSingleProducerPolicyViolations(value).some((violation) =>
    violation.endsWith(": write"))) {
    throw new Error(
      "Canonical v2 verifier workflow must remain read-only.",
    );
  }
  return value;
}

export function validateCanonicalV2ControllerWorkflowContent(value) {
  if (typeof value !== "string" || value === "") {
    throw new Error("Canonical v2 controller workflow must be non-empty UTF-8 text.");
  }
  assertCanonicalWorkflowLineEndings(value);
  const controllerMappings = assertCanonicalControllerWorkflowStructure(value);
  assertOneCanonicalActionCall(value, "controller");
  assertCommonWorkflowSafety(value, "controller");
  if (value.includes(LEGACY_V1_WORKFLOW_USES) || /@v1(?:\s|$)/m.test(value)) {
    throw new Error("Canonical v2 controller workflow must not retain a v1 caller.");
  }

  const jobIfExpression = extractCanonicalJobIfExpression(value);
  if (jobIfExpression !== CANONICAL_CONTROLLER_JOB_IF_EXPRESSION) {
    throw new Error(
      "Canonical v2 controller workflow job.if must exactly match the closed runner-admission expression.",
    );
  }
  if (
    !/^  issue_comment:\n    types: \[created, edited\]$/m.test(value) ||
    !/^  workflow_dispatch:\s*$/m.test(value)
  ) {
    throw new Error(
      "Canonical v2 controller workflow must expose issue_comment created/edited and workflow_dispatch.",
    );
  }
  for (const forbiddenEvent of [
    "pull_request",
    "pull_request_target",
    "pull_request_review",
    "pull_request_review_comment",
    "repository_dispatch",
  ]) {
    if (new RegExp(`^  ${forbiddenEvent}:`, "m").test(value)) {
      throw new Error(
        `Canonical v2 controller workflow must not expose ${forbiddenEvent}.`,
      );
    }
  }
  if (!/^  cancel-in-progress: false$/m.test(value)) {
    throw new Error("Canonical v2 controller workflow must not cancel an active request.");
  }

  assertControllerMappingScalar(
    controllerMappings,
    "name",
    "Codex Review Gate Controller",
  );
  assertControllerMappingScalar(
    controllerMappings,
    "on.issue_comment.types",
    "[created, edited]",
  );
  for (const [path, expected] of [
    ["on.workflow_dispatch.inputs.operation.required", "true"],
    ["on.workflow_dispatch.inputs.operation.type", "choice"],
    ["on.workflow_dispatch.inputs.operation.default", "reconcile"],
    ["on.workflow_dispatch.inputs.pr_number.required", "true"],
    ["on.workflow_dispatch.inputs.pr_number.type", "number"],
    ["on.workflow_dispatch.inputs.expected_head_sha.required", "true"],
    ["on.workflow_dispatch.inputs.expected_head_sha.type", "string"],
    ["on.workflow_dispatch.inputs.request_comment_id.required", "false"],
    ["on.workflow_dispatch.inputs.request_comment_id.type", "string"],
    ["on.workflow_dispatch.inputs.request_review.required", "false"],
    ["on.workflow_dispatch.inputs.request_review.type", "boolean"],
    ["on.workflow_dispatch.inputs.request_review.default", "true"],
    ["permissions.actions", "write"],
    ["permissions.checks", "read"],
    ["permissions.contents", "read"],
    ["permissions.issues", "write"],
    ["permissions.pull-requests", "read"],
    ["concurrency.cancel-in-progress", "false"],
    ["jobs.codex-review-gate-controller.name", "codex/review-gate-controller"],
    ["jobs.codex-review-gate-controller.if", ">-"],
    [
      "jobs.codex-review-gate-controller.runs-on",
      "${{ vars.CODEX_REVIEW_GATE_USE_UBUNTU_LATEST == 'true' && 'ubuntu-latest' || 'ubuntu-slim' }}",
    ],
    ["jobs.codex-review-gate-controller.timeout-minutes", "14"],
    ["jobs.codex-review-gate-controller.steps.name", "Refresh Codex review gate"],
    ["jobs.codex-review-gate-controller.steps.id", "controller"],
    ["jobs.codex-review-gate-controller.steps.uses", CANONICAL_V2_WORKFLOW_USES],
    [
      "jobs.codex-review-gate-controller.steps.env.CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION",
      "${{ vars.CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION == 'any' && 'any' || 'write' }}",
    ],
    [
      "jobs.codex-review-gate-controller.steps.with.github_token",
      "${{ github.token }}",
    ],
    [
      "jobs.codex-review-gate-controller.steps.with.pr_number",
      "${{ github.event_name == 'workflow_dispatch' && inputs.pr_number || github.event.issue.number }}",
    ],
    [
      "jobs.codex-review-gate-controller.steps.with.expected_head_sha",
      "${{ github.event_name == 'workflow_dispatch' && inputs.expected_head_sha || '' }}",
    ],
    [
      "jobs.codex-review-gate-controller.steps.with.operation",
      "${{ github.event_name == 'workflow_dispatch' && inputs.operation || 'reconcile' }}",
    ],
    [
      "jobs.codex-review-gate-controller.steps.with.request_comment_id",
      "${{ github.event_name == 'workflow_dispatch' && inputs.request_comment_id || github.event.comment.id }}",
    ],
    [
      "jobs.codex-review-gate-controller.steps.with.request_review",
      "${{ github.event_name == 'workflow_dispatch' && inputs.request_review || false }}",
    ],
    [
      "jobs.codex-review-gate-controller.steps.with.limits_profile",
      "${{ vars.CODEX_REVIEW_GATE_LIMITS_PROFILE == 'expanded' && 'expanded' || 'default' }}",
    ],
  ]) {
    assertControllerMappingScalar(controllerMappings, path, expected);
  }
  assertControllerOperationOptions(value);

  for (const fragment of [
    "jobs:\n  codex-review-gate-controller:",
    "name: codex/review-gate-controller",
    "permissions:\n  actions: write\n  checks: read\n  contents: read\n  issues: write\n  pull-requests: read",
    "github.event_name == 'workflow_dispatch'",
    "github.ref_type == 'branch'",
    "github.ref_name == github.event.repository.default_branch",
    "github.event_name == 'issue_comment'",
    "github.event.action == 'created'",
    "github.event.action == 'edited'",
    "github.event.sender.login",
    "github.event.sender.type",
    "github.event.comment.user.login",
    "github.event.comment.user.type",
    "chatgpt-codex-connector[bot]",
    "github_token:",
    "pr_number:",
    "expected_head_sha:",
    "operation:",
    "request_comment_id:",
    "request_review:",
    "CODEX_REVIEW_GATE_LIMITS_PROFILE",
    "CODEX_REVIEW_GATE_USE_UBUNTU_LATEST",
    "CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION: ${{ vars.CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION == 'any' && 'any' || 'write' }}",
  ]) {
    if (!value.includes(fragment)) {
      throw new Error(`Canonical v2 controller workflow is missing required fragment: ${fragment}`);
    }
  }
  for (const input of [
    "operation",
    "pr_number",
    "expected_head_sha",
    "request_comment_id",
    "request_review",
  ]) {
    if (!new RegExp(`^      ${input}:\\s*$`, "m").test(value)) {
      throw new Error(`Canonical v2 controller workflow is missing typed dispatch input: ${input}`);
    }
  }
  for (const forbidden of [
    "github.event.client_payload",
    "CODEX_REVIEW_GATE_MAX_PAGES",
    "CODEX_REVIEW_GATE_MAX_OBJECTS",
    "request_author_permission:",
  ]) {
    if (value.includes(forbidden)) {
      throw new Error(`Canonical v2 controller workflow contains rejected legacy surface: ${forbidden}`);
    }
  }
  if (/^      limits_profile:\s*$/m.test(value)) {
    throw new Error(
      "Canonical v2 controller workflow contains rejected dispatch input: limits_profile.",
    );
  }
  return value;
}

const CANONICAL_CONTROLLER_MAPPING_PATHS = [
  "name",
  "on",
  "on.issue_comment",
  "on.issue_comment.types",
  "on.workflow_dispatch",
  "on.workflow_dispatch.inputs",
  "on.workflow_dispatch.inputs.operation",
  "on.workflow_dispatch.inputs.operation.description",
  "on.workflow_dispatch.inputs.operation.required",
  "on.workflow_dispatch.inputs.operation.type",
  "on.workflow_dispatch.inputs.operation.options",
  "on.workflow_dispatch.inputs.operation.default",
  "on.workflow_dispatch.inputs.pr_number",
  "on.workflow_dispatch.inputs.pr_number.description",
  "on.workflow_dispatch.inputs.pr_number.required",
  "on.workflow_dispatch.inputs.pr_number.type",
  "on.workflow_dispatch.inputs.expected_head_sha",
  "on.workflow_dispatch.inputs.expected_head_sha.description",
  "on.workflow_dispatch.inputs.expected_head_sha.required",
  "on.workflow_dispatch.inputs.expected_head_sha.type",
  "on.workflow_dispatch.inputs.request_comment_id",
  "on.workflow_dispatch.inputs.request_comment_id.description",
  "on.workflow_dispatch.inputs.request_comment_id.required",
  "on.workflow_dispatch.inputs.request_comment_id.type",
  "on.workflow_dispatch.inputs.request_review",
  "on.workflow_dispatch.inputs.request_review.description",
  "on.workflow_dispatch.inputs.request_review.required",
  "on.workflow_dispatch.inputs.request_review.type",
  "on.workflow_dispatch.inputs.request_review.default",
  "permissions",
  "permissions.actions",
  "permissions.checks",
  "permissions.contents",
  "permissions.issues",
  "permissions.pull-requests",
  "concurrency",
  "concurrency.group",
  "concurrency.cancel-in-progress",
  "jobs",
  "jobs.codex-review-gate-controller",
  "jobs.codex-review-gate-controller.name",
  "jobs.codex-review-gate-controller.if",
  "jobs.codex-review-gate-controller.runs-on",
  "jobs.codex-review-gate-controller.timeout-minutes",
  "jobs.codex-review-gate-controller.steps",
  "jobs.codex-review-gate-controller.steps.name",
  "jobs.codex-review-gate-controller.steps.id",
  "jobs.codex-review-gate-controller.steps.uses",
  "jobs.codex-review-gate-controller.steps.env",
  "jobs.codex-review-gate-controller.steps.env.CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION",
  "jobs.codex-review-gate-controller.steps.with",
  "jobs.codex-review-gate-controller.steps.with.github_token",
  "jobs.codex-review-gate-controller.steps.with.pr_number",
  "jobs.codex-review-gate-controller.steps.with.expected_head_sha",
  "jobs.codex-review-gate-controller.steps.with.operation",
  "jobs.codex-review-gate-controller.steps.with.request_comment_id",
  "jobs.codex-review-gate-controller.steps.with.request_review",
  "jobs.codex-review-gate-controller.steps.with.limits_profile",
];

function assertCanonicalControllerWorkflowStructure(value) {
  if (value.startsWith("\uFEFF") || /\uFEFF|[\u0085\u2028\u2029\t]/u.test(value)) {
    throw new Error(
      "Canonical v2 controller workflow must use plain LF YAML without BOM, tabs, or non-ASCII line separators.",
    );
  }
  if (/\$\{\{\s*secrets\./iu.test(value)) {
    throw new Error("Canonical v2 controller workflow must not reference secrets.");
  }

  const entries = [];
  const stack = [];
  const lines = value.split("\n");
  let blockScalarIndent = null;
  for (const rawLine of lines) {
    const rawIndent = rawLine.match(/^ */u)[0].length;
    if (blockScalarIndent !== null) {
      if (rawLine.trim() === "" || rawIndent > blockScalarIndent) {
        continue;
      }
      blockScalarIndent = null;
    }
    const line = stripYamlComment(rawLine);
    if (line.trim() === "") {
      continue;
    }
    const trimmed = line.trimStart();
    if (
      /^(?:-\s*)?(?:["']|\?|:|!!|!<|![A-Za-z_]|&[A-Za-z0-9_-]+|\*[A-Za-z0-9_-]+|<<\s*:|\{)/u.test(trimmed)
    ) {
      throw new Error(
        "Canonical v2 controller workflow uses a quoted, tagged, explicit, aliased, merged, or flow-style mapping key.",
      );
    }

    let match = line.match(/^( *)([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$/u);
    let indent;
    let key;
    let mappingValue;
    if (match !== null) {
      indent = match[1].length;
      key = match[2];
      mappingValue = match[3];
    } else {
      match = line.match(/^( *)-\s+([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$/u);
      if (match === null) {
        continue;
      }
      indent = match[1].length + 2;
      key = match[2];
      mappingValue = match[3];
    }
    if (
      mappingValue.startsWith("{") &&
      !mappingValue.startsWith("${{")
    ) {
      throw new Error(
        "Canonical v2 controller workflow must not use flow-style mappings.",
      );
    }
    if (/(?:^|\s)(?:!!|!<|![A-Za-z_]|&[A-Za-z0-9_-]+|\*[A-Za-z0-9_-]+)(?:\s|$)/u.test(mappingValue)) {
      throw new Error(
        "Canonical v2 controller workflow must not use YAML tags, anchors, or aliases.",
      );
    }
    while (stack.length > 0 && stack.at(-1).indent >= indent) {
      stack.pop();
    }
    const path = [...stack.map((entry) => entry.key), key].join(".");
    entries.push({ path, value: mappingValue });
    stack.push({ indent, key });
    if (/^[|>][+-]?[1-9]?$/u.test(mappingValue)) {
      blockScalarIndent = indent;
    }
  }

  const actualPaths = entries.map((entry) => entry.path);
  if (
    actualPaths.length !== CANONICAL_CONTROLLER_MAPPING_PATHS.length ||
    actualPaths.some(
      (path, index) => path !== CANONICAL_CONTROLLER_MAPPING_PATHS[index],
    )
  ) {
    throw new Error(
      "Canonical v2 controller workflow must contain only the adopted closed event, permission, job, step, env, and input mappings.",
    );
  }
  return new Map(entries.map(({ path, value: mappingValue }) => [path, mappingValue]));
}

function assertControllerMappingScalar(mappings, path, expected) {
  if (mappings.get(path) !== expected) {
    throw new Error(
      `Canonical v2 controller workflow has an unexpected ${path} value.`,
    );
  }
}

function assertControllerOperationOptions(value) {
  if (
    !/^        options:\n          - reconcile\n          - begin-review\n        default: reconcile$/mu.test(
      value,
    )
  ) {
    throw new Error(
      "Canonical v2 controller workflow must expose only reconcile and begin-review operations.",
    );
  }
}

export function installedWorkflowMatchesCanonical(installed, canonical) {
  return (
    typeof canonical === "string" &&
    canonical !== "" &&
    typeof installed === "string" &&
    installed === canonical
  );
}

function assertOneCanonicalActionCall(value, role) {
  const usesMatches = value.match(/^\s*uses:\s*([^\s#]+)\s*$/gm) ?? [];
  const expectedUses = `uses: ${CANONICAL_V2_WORKFLOW_USES}`;
  if (usesMatches.length !== 1 || usesMatches[0].trim() !== expectedUses) {
    throw new Error(
      `Canonical v2 ${role} workflow must contain exactly one literal "${expectedUses}" call.`,
    );
  }
}

function assertCommonWorkflowSafety(value, role) {
  if (/^\s*schedule:\s*$/m.test(value) || /^\s*-?\s*cron:\s*/m.test(value)) {
    throw new Error(`Canonical v2 ${role} workflow must not allocate cron runners.`);
  }
  if (/^\s*repository_dispatch:\s*$/m.test(value)) {
    throw new Error(`Canonical v2 ${role} workflow must not expose repository_dispatch.`);
  }
  for (const fragment of [
    "runs-on: ${{ vars.CODEX_REVIEW_GATE_USE_UBUNTU_LATEST == 'true' && 'ubuntu-latest' || 'ubuntu-slim' }}",
    "timeout-minutes: 14",
    "github_token:",
  ]) {
    if (!value.includes(fragment)) {
      throw new Error(
        `Canonical v2 ${role} workflow is missing required fragment: ${fragment}`,
      );
    }
  }
}

export function workflowContainsLegacyV1Caller(value) {
  if (typeof value !== "string") {
    return false;
  }
  assertCanonicalWorkflowLineEndings(value);
  return (
    value.includes(LEGACY_V1_WORKFLOW_USES) ||
    value.includes(LEGACY_V1_DIRECT_ACTION_USES)
  );
}

export function workflowContainsCodexReviewGateCaller(value) {
  if (typeof value !== "string") {
    return false;
  }
  assertCanonicalWorkflowLineEndings(value);
  const uncommented = value.split(/\r?\n/u).map(stripYamlComment);
  for (const line of uncommented) {
    const usesMatch = line.match(
      /^\s*(?:-\s*)?(?:uses|"uses"|'uses')\s*:\s*(.*?)\s*$/iu,
    );
    if (usesMatch === null) {
      continue;
    }
    const scalar = usesMatch[1];
    if (
      scalar === "" ||
      /^[|>][+-]?[1-9]?\s*$/u.test(scalar) ||
      /^(?:[&*!]|\$\{\{|[\[{])/u.test(scalar) ||
      /\\/u.test(scalar) ||
      (scalar.startsWith('"') && !scalar.endsWith('"')) ||
      (!scalar.startsWith('"') && scalar.endsWith('"')) ||
      (scalar.startsWith("'") && !scalar.endsWith("'")) ||
      (!scalar.startsWith("'") && scalar.endsWith("'"))
    ) {
      throw new Error(
        "Workflow uses an opaque, escaped, flow-style, or multiline uses scalar that cannot prove another Codex review gate caller is absent.",
      );
    }
  }
  return CODEX_REVIEW_GATE_CALLER_PATTERN.test(uncommented.join("\n"));
}

export function workflowCanWriteStatuses(value) {
  return workflowWritePermissions(value).has("statuses");
}

export function workflowSingleProducerPolicyViolations(
  value,
  reservedCheckName = DEFAULT_STATUS_CONTEXT,
) {
  const writePermissions = workflowWritePermissions(value);
  const violations = [...writePermissions]
    .sort()
    .map((permission) => `${permission}: write`);
  if (workflowHasExactJobName(value, reservedCheckName)) {
    violations.push(`job name: ${reservedCheckName}`);
  }
  return violations;
}

function workflowWritePermissions(value) {
  if (typeof value !== "string") {
    throw new Error("Workflow content must be text before permissions inspection.");
  }
  assertCanonicalWorkflowLineEndings(value);
  const normalizedValue = value.startsWith("\uFEFF") ? value.slice(1) : value;
  if (/\uFEFF/u.test(normalizedValue)) {
    throw new Error(
      "Workflow uses an embedded UTF-8 BOM that prevents a conclusive relevant-write inventory.",
    );
  }
  if (/[\u0085\u2028\u2029]/u.test(normalizedValue)) {
    throw new Error(
      "Workflow uses a non-ASCII YAML line separator that prevents a conclusive relevant-write inventory.",
    );
  }
  const lines = normalizedValue.split(/\r?\n/u);
  const writes = new Set();
  let blockScalarIndent = null;
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const rawIndent = rawLine.match(/^ */u)[0].length;
    if (blockScalarIndent !== null) {
      if (rawLine.trim() === "" || rawIndent > blockScalarIndent) {
        continue;
      }
      blockScalarIndent = null;
    }
    const line = stripYamlComment(rawLine);
    if (/^\s*[^:#]+:\s*[|>][+-]?[1-9]?\s*$/u.test(line)) {
      blockScalarIndent = rawIndent;
    }
    const structuralLine = stripYamlQuotedSegments(line).replace(
      /\$\{\{.*?\}\}/gu,
      "",
    );
    if (
      /(?:^|[\s:[{,?])(?:&[A-Za-z0-9_-]+|\*[A-Za-z0-9_-]+|!(?:!|<|[A-Za-z_]))/u.test(
        structuralLine,
      )
    ) {
      throw new Error(
        "Workflow uses YAML tags, anchors, or aliases that prevent a conclusive relevant-write inventory.",
      );
    }
    if (
      /"[^"\r\n]*\\[^"\r\n]*"\s*:/u.test(line) ||
      /(?:^|[,{?]\s*)"[^"\r\n]*\\/u.test(line)
    ) {
      throw new Error(
        "Workflow uses an escaped double-quoted mapping key that prevents a conclusive relevant-write inventory.",
      );
    }
    if (/(?:^|[,{?]\s*)\s*["'](?:permissions|checks|issues|pull-requests|statuses)["']\s*:/iu.test(line)) {
      throw new Error(
        "Workflow uses a quoted protected permissions key that cannot prove single-producer access.",
      );
    }
    if (/(?:^|[,{]\s*)\?\s+/u.test(line)) {
      throw new Error(
        "Workflow uses an explicit YAML mapping key that cannot prove single-producer access.",
      );
    }
    if (/^\s*<<\s*:/u.test(line) || /:\s*[&*][A-Za-z0-9_-]+(?:\s|$)/u.test(line)) {
      throw new Error(
        "Workflow permissions are opaque because YAML anchors, aliases, or merge keys are present.",
      );
    }
    if (
      /(?:^|[,{]\s*)permissions\s*:/iu.test(line) &&
      !/^( *)(?:permissions):\s*(.*?)\s*$/iu.test(line)
    ) {
      throw new Error(
        "Workflow uses a nested flow-style permissions mapping that cannot prove single-producer access.",
      );
    }
    const match = line.match(/^( *)(?:permissions):\s*(.*?)\s*$/iu);
    if (match === null) {
      continue;
    }
    const permissionsIndent = match[1].length;
    const scalar = unquoteYamlScalar(match[2]);
    if (scalar !== "") {
      if (scalar === "read-all" || scalar === "{}") {
        continue;
      }
      if (scalar === "write-all") {
        for (const permission of SINGLE_PRODUCER_WRITE_PERMISSIONS) {
          writes.add(permission);
        }
        continue;
      }
      if (/^\{.*\}$/u.test(scalar)) {
        throw new Error(
          "Workflow uses a flow-style permissions mapping that cannot prove single-producer access.",
        );
      }
      throw new Error(
        `Workflow has an opaque permissions scalar that cannot prove single-producer access: ${scalar}`,
      );
    }

    let childMappingIndent = null;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const childLine = stripYamlComment(lines[cursor]);
      if (childLine.trim() === "") {
        continue;
      }
      const childIndent = childLine.match(/^ */u)[0].length;
      if (childIndent <= permissionsIndent) {
        break;
      }
      if (/^\s*\{/u.test(childLine)) {
        throw new Error(
          "Workflow uses a line-broken flow-style permissions mapping that cannot prove single-producer access.",
        );
      }
      if (childMappingIndent === null) {
        childMappingIndent = childIndent;
      } else if (childIndent !== childMappingIndent) {
        throw new Error(
          "Workflow permissions contain a nested or malformed mapping that cannot prove single-producer access.",
        );
      }
      const permissionMatch = childLine.match(
        /^\s*([A-Za-z][A-Za-z0-9-]*)\s*:\s*(.*?)\s*$/u,
      );
      if (permissionMatch === null) {
        throw new Error(
          "Workflow contains an opaque permissions entry that cannot prove single-producer access.",
        );
      }
      const permission = permissionMatch[1].toLowerCase();
      const access = unquoteYamlScalar(permissionMatch[2]);
      if (!new Set(["read", "write", "none"]).has(access)) {
        throw new Error(
          `Workflow has an opaque ${permission} permission: ${access || "<mapping>"}`,
        );
      }
      if (access === "write" && SINGLE_PRODUCER_WRITE_PERMISSIONS.has(permission)) {
        writes.add(permission);
      }
    }
  }
  return writes;
}

function workflowHasExactJobName(value, reservedCheckName) {
  if (typeof reservedCheckName !== "string" || reservedCheckName === "") {
    throw new Error("Reserved check name must be non-empty text.");
  }
  assertCanonicalWorkflowLineEndings(value);
  const lines = value.startsWith("\uFEFF")
    ? value.slice(1).split(/\r?\n/u)
    : value.split(/\r?\n/u);
  const rootMappingIndent = lines.reduce((minimum, line) => {
    const mapping = matchSimpleYamlMappingLine(stripYamlComment(line));
    return mapping === null ? minimum : Math.min(minimum, mapping.indent);
  }, Number.POSITIVE_INFINITY);
  if (
    rootMappingIndent === Number.POSITIVE_INFINITY &&
    lines.some((line) => stripYamlComment(line).trimStart().startsWith("{"))
  ) {
    throw new Error(
      "Workflow uses a flow-style root mapping that cannot prove the reserved check name is absent.",
    );
  }
  let jobsIndent = null;
  let jobIndent = null;
  let currentJobIndent = null;
  let propertyIndent = null;
  let blockScalarIndent = null;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    const rawIndent = rawLine.match(/^ */u)[0].length;
    if (blockScalarIndent !== null) {
      if (rawLine.trim() === "" || rawIndent > blockScalarIndent) {
        continue;
      }
      blockScalarIndent = null;
    }
    const line = stripYamlComment(rawLine);
    if (/^\s*[^:#]+:\s*[|>][+-]?[1-9]?\s*$/u.test(line)) {
      blockScalarIndent = rawIndent;
    }
    if (jobsIndent === null) {
      const jobsMatch = matchSimpleYamlMappingLine(line);
      if (
        jobsMatch === null ||
        jobsMatch.key !== "jobs" ||
        jobsMatch.indent !== rootMappingIndent
      ) {
        continue;
      }
      const jobsValue = unquoteYamlScalar(jobsMatch.value);
      if (jobsValue === "{}") {
        return false;
      }
      if (jobsValue !== "") {
        throw new Error(
          "Workflow uses a flow-style jobs mapping that cannot prove the reserved check name is absent.",
        );
      }
      jobsIndent = jobsMatch.indent;
      continue;
    }
    if (line.trim() === "") {
      continue;
    }
    if (rawIndent <= jobsIndent) {
      break;
    }
    if (line.trimStart().startsWith("{")) {
      if (line.trim() === "{}") {
        continue;
      }
      throw new Error(
        "Workflow uses a line-broken flow-style jobs mapping that cannot prove the reserved check name is absent.",
      );
    }
    const mappingMatch = matchSimpleYamlMappingLine(line);
    if (mappingMatch === null) {
      continue;
    }
    if (jobIndent === null) {
      jobIndent = mappingMatch.indent;
    }
    if (mappingMatch.indent === jobIndent) {
      currentJobIndent = jobIndent;
      propertyIndent = null;
      if (mappingMatch.value !== "" && mappingMatch.value !== "{}") {
        throw new Error(
          "Workflow uses a flow-style job definition that cannot prove the reserved check name is absent.",
        );
      }
      continue;
    }
    if (currentJobIndent === null || mappingMatch.indent <= currentJobIndent) {
      continue;
    }
    if (propertyIndent === null) {
      propertyIndent = mappingMatch.indent;
    }
    if (mappingMatch.indent !== propertyIndent || mappingMatch.key !== "name") {
      continue;
    }
    let name;
    if (/^[|>]/u.test(mappingMatch.value)) {
      if (![">-", "|-"].includes(mappingMatch.value)) {
        throw new Error(
          "Workflow uses an unsupported block-scalar job name indicator that cannot prove the reserved check name is absent.",
        );
      }
      name = decodeSafeSingleLineJobNameBlock(
        lines,
        lineIndex,
        propertyIndent,
      );
    } else {
      name = unquoteSimpleYamlScalar(mappingMatch.value);
    }
    if (jobNameCouldResolveTo(name, reservedCheckName)) {
      return true;
    }
  }
  return false;
}

function decodeSafeSingleLineJobNameBlock(
  lines,
  declarationIndex,
  propertyIndent,
) {
  const contentIndex = declarationIndex + 1;
  const contentLine = lines[contentIndex];
  if (
    contentLine === undefined ||
    contentLine.trim() === "" ||
    /^ *\t/u.test(contentLine)
  ) {
    throw new Error(
      "Workflow block-scalar job name must have exactly one unambiguous physical content line.",
    );
  }
  const contentIndent = contentLine.match(/^ */u)[0].length;
  if (contentIndent <= propertyIndent) {
    throw new Error(
      "Workflow block-scalar job name content is missing or not indented beneath name.",
    );
  }
  for (let index = contentIndex + 1; index < lines.length; index += 1) {
    const followingLine = lines[index];
    if (followingLine.trim() === "") {
      if (/\t/u.test(followingLine)) {
        throw new Error(
          "Workflow block-scalar job name has ambiguous tab-indented blank content.",
        );
      }
      continue;
    }
    const followingIndent = followingLine.match(/^ */u)[0].length;
    if (followingIndent > propertyIndent) {
      throw new Error(
        "Workflow block-scalar job name has multiple or ambiguous physical content lines.",
      );
    }
    break;
  }
  return contentLine.slice(contentIndent);
}

function matchSimpleYamlMappingLine(line) {
  const plain = line.match(
    /^( *)([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$/u,
  );
  if (plain !== null) {
    return { indent: plain[1].length, key: plain[2], value: plain[3] };
  }
  const quoted = line.match(
    /^( *)(?:"([A-Za-z_][A-Za-z0-9_-]*)"|'([A-Za-z_][A-Za-z0-9_-]*)')\s*:\s*(.*?)\s*$/u,
  );
  if (quoted !== null) {
    return {
      indent: quoted[1].length,
      key: quoted[2] ?? quoted[3],
      value: quoted[4],
    };
  }
  return null;
}

function unquoteSimpleYamlScalar(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && !trimmed.endsWith("'")) ||
    (!trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && !trimmed.endsWith('"')) ||
    (!trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    throw new Error(
      "Workflow uses a multiline or unterminated quoted job name that cannot prove the reserved check name is absent.",
    );
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    if (/\\/u.test(trimmed)) {
      throw new Error(
        "Workflow uses an escaped job name that cannot prove the reserved check name is absent.",
      );
    }
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function jobNameCouldResolveTo(name, reservedCheckName) {
  const expressionStart = name.indexOf("${{");
  if (expressionStart === -1) {
    return name === reservedCheckName;
  }
  const fixedPrefix = name.slice(0, expressionStart);
  return fixedPrefix === "" || reservedCheckName.startsWith(fixedPrefix);
}

export function decodeGitHubFileContent(value) {
  if (
    value?.type !== "file" ||
    value.encoding !== "base64" ||
    typeof value.content !== "string"
  ) {
    throw new Error("GitHub Contents API did not return a base64-encoded file.");
  }
  return decodeCanonicalBase64Text(value.content, "GitHub Contents API");
}

export function decodeGitHubBlobContent(value) {
  if (value?.encoding !== "base64" || typeof value.content !== "string") {
    throw new Error("GitHub Git Blobs API did not return base64-encoded content.");
  }
  return decodeCanonicalBase64Text(value.content, "GitHub Git Blobs API");
}

export function validateCanonicalV2WorkflowInventory(
  workflowFiles,
  canonicalWorkflows,
) {
  if (!Array.isArray(workflowFiles)) {
    throw new Error("Default-branch workflow inventory must be an array.");
  }
  const canonicalEntries = normalizeCanonicalWorkflowEntries(canonicalWorkflows);
  for (const { path, content, role } of canonicalEntries) {
    const matches = workflowFiles.filter((file) => file?.path === path);
    if (matches.length !== 1) {
      throw new Error(
        `${path} must occur exactly once in the complete default-branch workflow inventory.`,
      );
    }
    if (role === "verifier") {
      validateCanonicalV2VerifierWorkflowContent(matches[0].content);
    } else {
      validateCanonicalV2ControllerWorkflowContent(matches[0].content);
    }
    if (!installedWorkflowMatchesCanonical(matches[0].content, content)) {
      throw new Error(`${path} differs from the canonical v2 ${role} workflow bytes.`);
    }
  }

  const canonicalPaths = new Set(canonicalEntries.map((entry) => entry.path));

  const callerPaths = workflowFiles
    .filter(
      (file) =>
        !canonicalPaths.has(file?.path) &&
        workflowContainsCodexReviewGateCaller(file?.content),
    )
    .map((file) => file.path)
    .sort();
  if (callerPaths.length > 0) {
    throw new Error(
      `Additional v1/v2 gate callers remain on the default branch: ${callerPaths.join(", ")}`,
    );
  }

  const producerViolations = workflowFiles
    .filter((file) => !canonicalPaths.has(file?.path))
    .map((file) => ({
      path: file.path,
      violations: workflowSingleProducerPolicyViolations(file?.content),
    }))
    .filter((file) => file.violations.length > 0)
    .sort((left, right) => compareCanonicalText(left.path, right.path));
  if (producerViolations.length > 0) {
    throw new Error(
      `Additional workflows violate the codex/github-review-gate single-producer policy: ${producerViolations
        .map(({ path, violations }) => `${path} (${violations.join(", ")})`)
        .join("; ")}`,
    );
  }
  return canonicalWorkflows;
}

function normalizeCanonicalWorkflowEntries(canonicalWorkflows) {
  if (
    canonicalWorkflows === null ||
    typeof canonicalWorkflows !== "object" ||
    Array.isArray(canonicalWorkflows)
  ) {
    throw new Error(
      "Canonical workflow inventory must provide verifier and controller workflow bytes.",
    );
  }
  const verifier = canonicalWorkflows.verifier;
  const controller = canonicalWorkflows.controller;
  validateCanonicalV2VerifierWorkflowContent(verifier);
  validateCanonicalV2ControllerWorkflowContent(controller);
  return [
    {
      role: "verifier",
      path: DEFAULT_WORKFLOW_PATH,
      content: verifier,
    },
    {
      role: "controller",
      path: DEFAULT_CONTROLLER_WORKFLOW_PATH,
      content: controller,
    },
  ];
}

function extractCanonicalJobIfExpression(value) {
  const match = value.match(
    /^    if:\s*>-\s*\r?\n([\s\S]*?)^    runs-on:/mu,
  );
  if (match === null) {
    throw new Error("Canonical v2 workflow must contain one folded codex-review-gate job.if.");
  }
  return normalizeWorkflowExpression(match[1]);
}

function normalizeWorkflowExpression(value) {
  return value.replace(/\s+/gu, " ").trim();
}

function stripYamlComment(line) {
  let singleQuoted = false;
  let doubleQuoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "'" && !doubleQuoted) {
      singleQuoted = !singleQuoted;
    } else if (char === '"' && !singleQuoted && line[index - 1] !== "\\") {
      doubleQuoted = !doubleQuoted;
    } else if (
      char === "#" &&
      !singleQuoted &&
      !doubleQuoted &&
      (index === 0 || /[ \t]/u.test(line[index - 1]))
    ) {
      return line.slice(0, index).trimEnd();
    }
  }
  return line;
}

function assertCanonicalWorkflowLineEndings(value) {
  if (/\r(?!\n)/u.test(value)) {
    throw new Error(
      "Workflow uses a bare CR YAML line break; security inventory accepts only LF or CRLF line endings.",
    );
  }
}

function stripYamlQuotedSegments(line) {
  let result = "";
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote === null) {
      if (char === "'" || char === '"') {
        quote = char;
        result += " ";
      } else {
        result += char;
      }
      continue;
    }
    result += " ";
    if (quote === '"' && char === "\\") {
      if (index + 1 < line.length) {
        index += 1;
        result += " ";
      }
      continue;
    }
    if (quote === "'" && char === "'" && line[index + 1] === "'") {
      index += 1;
      result += " ";
      continue;
    }
    if (char === quote) {
      quote = null;
    }
  }
  return result;
}

function unquoteYamlScalar(value) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim().toLowerCase();
  }
  return trimmed.toLowerCase();
}

function decodeCanonicalBase64Text(content, sourceLabel) {
  const encoded = content.replace(/\s/g, "");
  if (
    encoded === "" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encoded,
    )
  ) {
    throw new Error(`${sourceLabel} returned malformed base64 text content.`);
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded) {
    throw new Error(`${sourceLabel} returned non-canonical base64 text content.`);
  }
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    throw new Error(`${sourceLabel} returned content that is not valid UTF-8.`);
  }
  return text;
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
  const parameters = {
    strict_required_status_checks_policy: strict,
    required_status_checks: [buildRequiredStatusCheck({ context, integrationId })],
  };
  if (doNotEnforceOnCreate !== undefined) {
    parameters.do_not_enforce_on_create = doNotEnforceOnCreate;
  }
  return {
    type: "required_status_checks",
    parameters,
  };
}

function buildPullRequestRule() {
  return {
    type: "pull_request",
    parameters: defaultPullRequestParameters(),
  };
}

function defaultPullRequestParameters() {
  return {
    dismiss_stale_reviews_on_push: true,
    require_code_owner_review: true,
    require_last_push_approval: false,
    required_approving_review_count: 0,
    required_review_thread_resolution: true,
  };
}

function selectCodeownersNewline(value) {
  const withoutCrLf = value.replace(/\r\n/gu, "");
  if (withoutCrLf.includes("\r")) {
    throw new Error(
      "Existing .github/CODEOWNERS uses unsupported bare carriage returns.",
    );
  }
  return value.includes("\r\n") ? "\r\n" : "\n";
}

function findExactLineIndexes(lines, expected) {
  const indexes = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === expected) {
      indexes.push(index);
    }
  }
  return indexes;
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

function assertEffectiveRulesetRule(rule) {
  assertJsonNumbersAreSafeIntegers(rule, "Effective ruleset inventory");
  if (
    rule === null ||
    typeof rule !== "object" ||
    Array.isArray(rule) ||
    typeof rule.type !== "string" ||
    rule.type === "" ||
    !Number.isSafeInteger(rule.ruleset_id) ||
    rule.ruleset_id <= 0
  ) {
    throw new Error("Effective ruleset inventory contains a malformed rule.");
  }
  if (rule.type === "required_status_checks") {
    assertRequiredStatusChecksParameters(
      rule.parameters,
      "Effective required_status_checks rule",
    );
  }
}

function assertJsonNumbersAreSafeIntegers(value, label) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`${label} contains a non-safe-integer JSON number.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertJsonNumbersAreSafeIntegers(item, label);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) {
      assertJsonNumbersAreSafeIntegers(item, label);
    }
  }
}

function assertLegacyInventoryRule(rule, label) {
  if (
    rule === null ||
    typeof rule !== "object" ||
    Array.isArray(rule) ||
    typeof rule.type !== "string" ||
    rule.type === ""
  ) {
    throw new Error(`${label} contains a malformed rule.`);
  }
  if (rule.type === "required_status_checks") {
    assertRequiredStatusChecksParameters(rule.parameters, label);
  } else if (
    Object.prototype.hasOwnProperty.call(rule, "parameters") &&
    (rule.parameters === null ||
      typeof rule.parameters !== "object" ||
      Array.isArray(rule.parameters))
  ) {
    throw new Error(`${label} contains malformed rule parameters.`);
  }
}

function assertRequiredStatusChecksParameters(parameters, label) {
  if (
    parameters === null ||
    typeof parameters !== "object" ||
    Array.isArray(parameters) ||
    typeof parameters.strict_required_status_checks_policy !== "boolean" ||
    !Array.isArray(parameters.required_status_checks) ||
    (Object.prototype.hasOwnProperty.call(parameters, "do_not_enforce_on_create") &&
      typeof parameters.do_not_enforce_on_create !== "boolean")
  ) {
    throw new Error(`${label} is malformed or incomplete.`);
  }
  for (const check of parameters.required_status_checks) {
    if (
      check === null ||
      typeof check !== "object" ||
      Array.isArray(check) ||
      typeof check.context !== "string" ||
      check.context === "" ||
      (Object.prototype.hasOwnProperty.call(check, "integration_id") &&
        (!Number.isSafeInteger(check.integration_id) || check.integration_id <= 0))
    ) {
      throw new Error(`${label} contains a malformed required status check.`);
    }
  }
}

function assertLegacyInventoryBypassActor(actor, target) {
  const actorTypes = new Set([
    "Integration",
    "OrganizationAdmin",
    "RepositoryRole",
    "Team",
    "DeployKey",
    "EnterpriseOwner",
    "EnterpriseRole",
    "User",
  ]);
  const bypassModes = new Set(["always", "pull_request", "exempt"]);
  if (
    actor === null ||
    typeof actor !== "object" ||
    Array.isArray(actor) ||
    !actorTypes.has(actor.actor_type) ||
    !bypassModes.has(actor.bypass_mode)
  ) {
    throw new Error("Full ruleset API readback contains a malformed bypass actor.");
  }
  const nullableActor =
    actor.actor_type === "DeployKey" ||
    actor.actor_type === "OrganizationAdmin" ||
    actor.actor_type === "EnterpriseOwner";
  if (
    (actor.actor_id === null && !nullableActor) ||
    (actor.actor_id !== null &&
      (!Number.isSafeInteger(actor.actor_id) || actor.actor_id <= 0)) ||
    (actor.actor_type === "DeployKey" && actor.actor_id !== null) ||
    (actor.bypass_mode === "pull_request" &&
      (actor.actor_type === "DeployKey" || target !== "branch"))
  ) {
    throw new Error("Full ruleset API readback contains an invalid bypass actor binding.");
  }
}

function validClassicAppId(value) {
  return value === null || value === -1 || (Number.isSafeInteger(value) && value > 0);
}

function compareClassicStatusCheck(left, right) {
  return compareTuple(
    [
      left.context,
      left.app_id === null ? "null" : "number",
      String(left.app_id),
      canonicalJson(left),
    ],
    [
      right.context,
      right.app_id === null ? "null" : "number",
      String(right.app_id),
      canonicalJson(right),
    ],
  );
}

function compareLegacyBypassActor(left, right) {
  return compareTuple(
    [
      left.actor_type,
      left.actor_id ?? -1,
      left.bypass_mode,
      canonicalJson(left),
    ],
    [
      right.actor_type,
      right.actor_id ?? -1,
      right.bypass_mode,
      canonicalJson(right),
    ],
  );
}

function compareTuple(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === right[index]) {
      continue;
    }
    if (typeof left[index] === "number" && typeof right[index] === "number") {
      return left[index] - right[index];
    }
    return compareCanonicalText(String(left[index]), String(right[index]));
  }
  return 0;
}

function canonicalEffectiveRequiredStatusChecksRule(rule) {
  const normalized = structuredCloneSafe(rule);
  normalized.parameters.required_status_checks.sort((left, right) =>
    compareTuple(
      [
        left.context,
        left.integration_id ?? -1,
        canonicalJson(left),
      ],
      [
        right.context,
        right.integration_id ?? -1,
        canonicalJson(right),
      ],
    )
  );
  return normalized;
}

function canonicalSemanticValue(value) {
  if (Array.isArray(value)) {
    const items = value.map(canonicalSemanticValue);
    items.sort((left, right) =>
      compareCanonicalText(canonicalJson(left), canonicalJson(right))
    );
    return items;
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, canonicalSemanticValue(item)]),
    );
  }
  return value;
}

// Canonical order must not depend on the host locale. GitHub JSON text is
// valid UTF-8, whose bytewise order preserves Unicode scalar order and matches
// jq's deterministic string ordering for this shared inventory contract.
function compareCanonicalText(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function structuredCloneSafe(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function addDefaultBranchToConditions(conditions, defaultBranch) {
  if (conditions === undefined || conditions === null) {
    return structuredCloneSafe(DEFAULT_REF_CONDITIONS);
  }

  const nextConditions = structuredCloneSafe(conditions);
  const refName = nextConditions.ref_name ?? {};
  if (
    (refName.include !== undefined && !Array.isArray(refName.include)) ||
    (refName.exclude !== undefined && !Array.isArray(refName.exclude))
  ) {
    throw new Error(
      "Existing ruleset ref_name include/exclude conditions are malformed; refusing to change branch coverage.",
    );
  }
  const include = [...(refName.include ?? [])];
  const exclude = [...(refName.exclude ?? [])];
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

  assertSupportedGitHubRulesetPattern(pattern);
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
      if (
        pattern[index + 1] === "*" &&
        pattern[index + 2] === "/" &&
        (index === 0 || pattern[index - 1] === "/")
      ) {
        source += "(?:[^/]+/)*";
        index += 2;
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else if (char === "[") {
      const characterClass = readCharacterClass(pattern, index);
      source += characterClass.source;
      index = characterClass.end;
    } else {
      source += escapeRegExp(char);
    }
  }
  try {
    return new RegExp(`^${source}$`);
  } catch (error) {
    throw new Error(`Unsupported GitHub ruleset fnmatch pattern "${pattern}": ${error.message}`);
  }
}

function readCharacterClass(pattern, start) {
  const end = pattern.indexOf("]", start + 1);
  if (end === -1) {
    throw new Error(`Unsupported GitHub ruleset fnmatch pattern "${pattern}": unclosed character class.`);
  }

  let body = pattern.slice(start + 1, end);
  if (body === "") {
    throw new Error(`Unsupported GitHub ruleset fnmatch pattern "${pattern}": empty character class.`);
  }

  let negate = "";
  if (body.startsWith("^")) {
    throw new Error(
      `Unsupported GitHub ruleset fnmatch pattern "${pattern}": caret-complemented character classes are not supported by GitHub.`,
    );
  }
  if (body.startsWith("!")) {
    negate = "^";
    body = body.slice(1);
  }
  if (body === "") {
    throw new Error(`Unsupported GitHub ruleset fnmatch pattern "${pattern}": empty character class.`);
  }

  const escapedBody = escapeCharacterClassBody(body);
  const source = negate === "^"
    ? `[^/${escapedBody}]`
    : `(?!/)[${escapedBody}]`;
  return { end, source };
}

function assertSupportedGitHubRulesetPattern(pattern) {
  if (pattern.startsWith("~")) {
    throw new Error(
      `Unsupported GitHub ruleset ref token "${pattern}"; only ~DEFAULT_BRANCH and ~ALL are understood.`,
    );
  }
  if (pattern.includes("\\")) {
    throw new Error(
      `Unsupported GitHub ruleset fnmatch pattern "${pattern}": backslash quoting is not supported by GitHub.`,
    );
  }
  for (let index = 0; index < pattern.length; index += 1) {
    if (pattern[index] === "[") {
      const characterClass = readCharacterClass(pattern, index);
      index = characterClass.end;
    } else if (pattern[index] === "]") {
      throw new Error(
        `Unsupported GitHub ruleset fnmatch pattern "${pattern}": unmatched closing character class.`,
      );
    }
  }
}

function escapeCharacterClassBody(value) {
  return value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
