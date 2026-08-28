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
  { integrationId = DEFAULT_STATUS_INTEGRATION_ID } = {},
) {
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
    rulesetHasRequiredStatusContext(ruleset, context, { integrationId }) &&
    rulesetHasStrictStatusPolicy(ruleset, context) &&
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

function rulesetHasStrictStatusPolicy(ruleset, context) {
  return (ruleset.rules ?? []).some(
    (rule) =>
      rule.type === "required_status_checks" &&
      rule.parameters?.strict_required_status_checks_policy === true &&
      (rule.parameters?.required_status_checks ?? []).some(
        (check) => check?.context === context,
      ),
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
  } = {},
) {
  const pullRequest = ensurePullRequestPolicyInRules(existingRules);
  const status = ensureStatusContextInRules(pullRequest.rules, context, {
    integrationId,
    strict,
    doNotEnforceOnCreate,
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
    .sort((left, right) => left.path.localeCompare(right.path));
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
