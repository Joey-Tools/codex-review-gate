import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

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
export const DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH =
  ".github/workflows/codex-review-gate-legacy-bridge.yml";
export const DEFAULT_RULESET_ENFORCEMENT = "disabled";
export const RULESET_PROFILE_FULL = "full";
export const RULESET_PROFILE_STATUS_ONLY = "status-only";
export const DEFAULT_RULESET_PROFILE = RULESET_PROFILE_FULL;
export const DEFAULT_CONTROL_PLANE_OWNER = "@JoeyTeng";
export const DEFAULT_CODEOWNERS_PATH = ".github/CODEOWNERS";
// This source repository is deliberately outside the organization handoff
// cohort. Its temporary v1 bridge has a separate, source-local closure
// lifecycle and must never be admitted through an organization receipt.
export const SOURCE_SELF_HOSTING_REPOSITORY_SLUG =
  "Joey-Tools/codex-review-gate";
export const SOURCE_SELF_HOSTING_RULESET_NAME = "Must Pass Codex Review v2";
export const SOURCE_SELF_HOSTING_RETAINED_RULESET_ID = 16_410_326;
export const SOURCE_SELF_HOSTING_RETAINED_RULESET_NAME =
  "PR must pass codex review";
export const SOURCE_BRIDGE_REMOVAL_PROOF_SCHEMA_VERSION = 1;
export const SOURCE_BRIDGE_REMOVAL_PROOF_OUTPUT_SCHEMA_VERSION =
  "source-bridge-removal-proof-output/v1";
export const CANONICAL_V2_WORKFLOW_USES =
  "JoeyTeng/codex-review-gate-action@v2";
export const LEGACY_V1_WORKFLOW_USES =
  "JoeyTeng/codex-review-gate-action/.github/workflows/codex-review-gate.yml@v1";
const LEGACY_V1_DIRECT_ACTION_USES = "JoeyTeng/codex-review-gate-action@v1";

// This source repository retains its pre-v2 non-status protections in a
// separate ruleset while the v2 status-only policy evolves independently.
// These are intentionally the observed source policy values, not the generic
// consumer full-profile defaults: source does not require CODEOWNERS review or
// stale-review dismissal, but it does require conversation resolution and the
// unattributed-change extra approval. Source bridge deletion must not silently
// weaken or substitute this retained policy.
const SOURCE_SELF_HOSTING_RETAINED_RULESET_WRITABLE_POLICY = Object.freeze({
  name: SOURCE_SELF_HOSTING_RETAINED_RULESET_NAME,
  target: "branch",
  enforcement: "active",
  bypass_actors: [],
  conditions: {
    ref_name: {
      include: ["~DEFAULT_BRANCH"],
      exclude: [],
    },
  },
  rules: [
    { type: "deletion" },
    { type: "non_fast_forward" },
    {
      type: "pull_request",
      parameters: {
        allowed_merge_methods: ["squash"],
        dismiss_stale_reviews_on_push: false,
        dismissal_restriction: { allowed_actors: [], enabled: false },
        require_code_owner_review: false,
        require_extra_approval_for_unattributed_changes: true,
        require_last_push_approval: false,
        required_approving_review_count: 0,
        required_review_thread_resolution: true,
        required_reviewers: [],
      },
    },
  ],
});

// GitHub status-context matching is case-insensitive for this legacy surface.
// Keep the comparison explicitly ASCII-only: the reserved context is ASCII and
// accepting Unicode case folds would blur a security identity rather than
// normalize it.
export function statusContextEqualsAsciiCaseInsensitive(value, expected) {
  if (
    typeof value !== "string" ||
    typeof expected !== "string" ||
    value.length !== expected.length
  ) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const valueCode = value.charCodeAt(index);
    const expectedCode = expected.charCodeAt(index);
    const normalizedValue =
      valueCode >= 0x41 && valueCode <= 0x5a ? valueCode + 0x20 : valueCode;
    const normalizedExpected =
      expectedCode >= 0x41 && expectedCode <= 0x5a
        ? expectedCode + 0x20
        : expectedCode;
    if (normalizedValue !== normalizedExpected || normalizedValue > 0x7f) {
      return false;
    }
  }
  return true;
}

export function isLegacyStatusContext(value) {
  return statusContextEqualsAsciiCaseInsensitive(value, LEGACY_STATUS_CONTEXT);
}
const CANONICAL_LEGACY_BRIDGE_WORKFLOW_CONTENT = [
  "name: Codex Review Gate Legacy Bridge",
  "",
  "on:",
  "  pull_request_target:",
  "    types: [opened, reopened, synchronize, ready_for_review]",
  "  issue_comment:",
  "    types: [created]",
  "",
  "permissions:",
  "  contents: read",
  "  issues: write",
  "  pull-requests: read",
  "  statuses: write",
  "",
  "concurrency:",
  "  group: codex-review-gate-${{ github.repository }}",
  "  cancel-in-progress: false",
  "",
  "jobs:",
  "  codex-review-gate-legacy-bridge:",
  "    name: codex/review-gate legacy bridge",
  `    uses: ${LEGACY_V1_WORKFLOW_USES}`,
  "",
].join("\n");
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
      github.event.action == 'created' &&
      github.event.issue.pull_request &&
      github.event.sender.login == 'chatgpt-codex-connector[bot]' &&
      github.event.sender.type == 'Bot' &&
      github.event.comment.user.login == 'chatgpt-codex-connector[bot]' &&
      github.event.comment.user.type == 'Bot'
    )
  }}
`);
const FROZEN_HANDOFF_CONTROLLER_JOB_IF_EXPRESSION = normalizeWorkflowExpression(`
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
const CANONICAL_CONTROLLER_ISSUE_COMMENT_TYPES = "[created]";
const FROZEN_HANDOFF_CONTROLLER_ISSUE_COMMENT_TYPES = "[created, edited]";
const CANONICAL_REQUEST_AUTHOR_PERMISSION = "any";
const FROZEN_HANDOFF_REQUEST_AUTHOR_PERMISSION =
  "${{ vars.CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION == 'any' && 'any' || 'write' }}";

const DEFAULT_REF_CONDITIONS = {
  ref_name: {
    include: ["~DEFAULT_BRANCH"],
    exclude: [],
  },
};
const STATUS_ONLY_RULESET_ENFORCEMENTS = new Set(["disabled", "active"]);

export function normalizeRulesetProfile(value = DEFAULT_RULESET_PROFILE) {
  if (
    value === RULESET_PROFILE_FULL ||
    value === RULESET_PROFILE_STATUS_ONLY
  ) {
    return value;
  }
  throw new Error(
    `Ruleset profile must be "${RULESET_PROFILE_FULL}" or "${RULESET_PROFILE_STATUS_ONLY}".`,
  );
}

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

export function parseGitHubRepositoryRemote(value) {
  if (typeof value !== "string" || value.trim() === "" || /[\0\r\n]/u.test(value)) {
    throw new Error("Git origin must be one unambiguous GitHub repository URL.");
  }
  const remote = value.trim();
  const scpMatch = remote.match(/^git@github\.com:([^/:]+)\/([^/]+?)(?:\.git)?$/u);
  if (scpMatch !== null) {
    return parseRepoSlug(`${scpMatch[1]}/${scpMatch[2]}`);
  }

  let parsed;
  try {
    parsed = new URL(remote);
  } catch {
    throw new Error(`Git origin is not a supported GitHub repository URL: ${value}`);
  }
  if (
    !new Set(["https:", "ssh:"]).has(parsed.protocol) ||
    parsed.hostname.toLowerCase() !== "github.com" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error(`Git origin is not a supported GitHub repository URL: ${value}`);
  }
  if (
    (parsed.protocol === "https:" && parsed.username !== "") ||
    (parsed.protocol === "ssh:" && !new Set(["", "git"]).has(parsed.username))
  ) {
    throw new Error(`Git origin contains an unsupported credential or user: ${value}`);
  }
  const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+?)(?:\.git)?$/u);
  if (match === null) {
    throw new Error(`Git origin is not one GitHub repository path: ${value}`);
  }
  let owner;
  let repo;
  try {
    owner = decodeURIComponent(match[1]);
    repo = decodeURIComponent(match[2]);
  } catch {
    throw new Error(`Git origin contains invalid percent encoding: ${value}`);
  }
  return parseRepoSlug(`${owner}/${repo}`);
}

// v1 receipts are published historical evidence and therefore retain their
// original eleven-member cohort. v2 is the current active cohort, which
// deliberately excludes the archived legacy-only repository.
export const LEGACY_ORGANIZATION_FINAL_CLOSURE_COHORT_SIZE = 11;
export const ORGANIZATION_FINAL_CLOSURE_COHORT_SIZE = 10;

// This is a rollout-specific hard boundary in addition to schema v2's
// generic manifest binding. The archived legacy-only repository remains in
// the old organization selector solely for deletion/non-fast-forward
// protection and must never receive bridge-removal authorization. The slug
// catches a same-slug replacement or rename/transfer path; id and node_id
// bind the persistent GitHub object identity.
const CURRENT_LEGACY_ONLY_ARCHIVED_REPOSITORY = Object.freeze({
  full_name: "Joey-Tools/codex-waited-delivery",
  id: 1_242_512_099,
  node_id: "R_kgDOSg864w",
});

function organizationFinalClosureOutputFormat(schemaVersion) {
  switch (schemaVersion) {
    case "organization-review-gate-handoff-output/v1":
      return {
        receiptSchemaVersion: 1,
        bridgeRemovalAuthorized: false,
      };
    case "organization-review-gate-handoff-output/v2":
      return {
        receiptSchemaVersion: 2,
        bridgeRemovalAuthorized: true,
      };
    default:
      throw new Error(
        "Organization handoff output schema_version is not a supported final-closure format.",
      );
  }
}

function organizationFinalClosureReceiptCohortSize(schemaVersion) {
  switch (schemaVersion) {
    case 1:
      return LEGACY_ORGANIZATION_FINAL_CLOSURE_COHORT_SIZE;
    case 2:
      return ORGANIZATION_FINAL_CLOSURE_COHORT_SIZE;
    default:
      throw new Error(
        "Organization final closure receipt schema_version is not supported.",
      );
  }
}

export function organizationFinalClosurePlanSha256({
  manifest_sha256: manifestSha256,
  snapshot_sha256: snapshotSha256,
}) {
  assertReceiptSha256(manifestSha256, "plan manifest_sha256");
  assertReceiptSha256(snapshotSha256, "plan snapshot_sha256");
  return createHash("sha256")
    .update(
      canonicalJson({
        mode: "verify",
        manifest_sha256: manifestSha256,
        snapshot_sha256: snapshotSha256,
        action: null,
      }),
      "utf8",
    )
    .digest("hex");
}

export function validateOrganizationFinalClosureOutput(output) {
  assertPlainReceiptObject(output, "Organization handoff output");
  assertExactReceiptKeys(
    output,
    [
      "schema_version",
      "mode",
      "organization",
      "manifest_sha256",
      "snapshot_sha256",
      "status",
      "applied",
      "plan_sha256",
      "action",
      "repositories_verified",
      "final_closure_receipt",
      "final_closure_receipt_sha256",
    ],
    "Organization handoff output",
  );
  const format = organizationFinalClosureOutputFormat(output.schema_version);
  if (output.mode !== "verify" || output.status !== "final-verified") {
    throw new Error(
      'Organization handoff output must be a successful final read-only verify result with mode "verify" and status "final-verified".',
    );
  }
  if (output.applied !== false) {
    throw new Error(
      "Organization handoff output must be a read-only final verify result with applied false.",
    );
  }
  if (output.action !== null) {
    throw new Error(
      "Organization handoff output must be the final read-only verify result with action null.",
    );
  }
  assertReceiptSha256(output.manifest_sha256, "manifest_sha256");
  assertReceiptSha256(output.snapshot_sha256, "snapshot_sha256");
  assertReceiptSha256(output.plan_sha256, "plan_sha256");
  if (
    output.plan_sha256 !==
    organizationFinalClosurePlanSha256(output)
  ) {
    throw new Error(
      "Organization handoff output plan_sha256 does not bind the final read-only verify plan.",
    );
  }
  assertReceiptSha256(
    output.final_closure_receipt_sha256,
    "final_closure_receipt_sha256",
  );
  const receipt = validateOrganizationFinalClosureReceipt(
    output.final_closure_receipt,
  );
  if (receipt.schema_version !== format.receiptSchemaVersion) {
    throw new Error(
      "Organization handoff output schema_version and final closure receipt schema_version are not an admitted format pair.",
    );
  }
  if (
    canonicalJson(output.organization) !== canonicalJson(receipt.organization) ||
    output.manifest_sha256 !== receipt.manifest_sha256 ||
    output.snapshot_sha256 !== receipt.snapshot_sha256
  ) {
    throw new Error(
      "Organization handoff output and final closure receipt disagree on their bound organization or snapshot.",
    );
  }
  if (
    !Number.isSafeInteger(output.repositories_verified) ||
    output.repositories_verified !== receipt.repositories.length
  ) {
    throw new Error(
      "Organization handoff output repositories_verified does not match the final closure receipt.",
    );
  }
  return {
    receipt,
    claimedSha256: output.final_closure_receipt_sha256,
    // v1 is immutable historical evidence only. Bridge removal is authorized
    // solely by the current v2 receipt's manifest-bound active cohort.
    // Consumers must use this explicit result rather than infer membership
    // from the legacy organization selector, which may contain legacy-only
    // members. The receipt's observed cohort is intentionally not used as an
    // authorization source: schema v2 first proves it exactly equals the
    // producer's manifest-derived cohort.
    bridgeRemovalRepositories: format.bridgeRemovalAuthorized
      ? receipt.manifest_repositories
      : [],
  };
}

export function canonicalOrganizationFinalClosureReceipt(receipt) {
  const canonical = validateOrganizationFinalClosureReceipt(receipt);
  return canonicalJson(canonical);
}

export function validateOrganizationFinalClosureReceipt(receipt) {
  assertPlainReceiptObject(receipt, "Organization final closure receipt");
  const cohortSize = organizationFinalClosureReceiptCohortSize(
    receipt.schema_version,
  );
  const manifestBound = receipt.schema_version === 2;
  assertExactReceiptKeys(
    receipt,
    [
      "schema_version",
      "organization",
      "manifest_sha256",
      "snapshot_sha256",
      "legacy_ruleset",
      "v2_ruleset",
      "repositories",
      ...(manifestBound ? ["manifest_repositories"] : []),
    ],
    "Organization final closure receipt",
  );
  const organization = validateReceiptOrganization(receipt.organization);
  assertReceiptSha256(receipt.manifest_sha256, "receipt manifest_sha256");
  assertReceiptSha256(receipt.snapshot_sha256, "receipt snapshot_sha256");
  const legacyRuleset = validateReceiptRuleset(
    receipt.legacy_ruleset,
    "after",
    "legacy_ruleset",
  );
  const v2Ruleset = validateReceiptRuleset(
    receipt.v2_ruleset,
    "active",
    "v2_ruleset",
  );
  if (legacyRuleset.id === v2Ruleset.id) {
    throw new Error("Organization final closure receipt ruleset IDs must be distinct.");
  }
  const repositories = validateReceiptRepositoryCohort(
    receipt.repositories,
    organization,
    cohortSize,
    "repositories",
    receipt.schema_version,
  );
  const manifestRepositories = manifestBound
    ? validateReceiptRepositoryCohort(
        receipt.manifest_repositories,
        organization,
        cohortSize,
        "manifest_repositories",
        receipt.schema_version,
      )
    : null;
  if (manifestBound) {
    assertSchemaTwoCohortExcludesCurrentLegacyOnlyRepository(
      repositories,
      "repositories",
    );
    assertSchemaTwoCohortExcludesCurrentLegacyOnlyRepository(
      manifestRepositories,
      "manifest_repositories",
    );
  }
  if (
    manifestRepositories !== null &&
    canonicalJson(manifestRepositories) !== canonicalJson(repositories)
  ) {
    throw new Error(
      "Organization final closure receipt manifest_repositories must exactly match the observed repositories identity cohort.",
    );
  }
  const canonical = {
    schema_version: receipt.schema_version,
    organization,
    manifest_sha256: receipt.manifest_sha256,
    snapshot_sha256: receipt.snapshot_sha256,
    legacy_ruleset: legacyRuleset,
    v2_ruleset: v2Ruleset,
    repositories,
  };
  if (manifestRepositories !== null) {
    canonical.manifest_repositories = manifestRepositories;
  }
  return canonical;
}

// A source bridge-removal proof is deliberately evidence, not authority. A
// later local mutation must re-derive the complete live closure and require
// byte-for-byte equality with this canonical receipt. Keeping this separate
// from organization receipts prevents the organization cohort from extending
// deletion authority to the source repository.
export function canonicalSourceBridgeRemovalProof(receipt) {
  return canonicalJson(validateSourceBridgeRemovalProof(receipt));
}

export function sourceBridgeRemovalProofSha256(receipt) {
  return createHash("sha256")
    .update(canonicalSourceBridgeRemovalProof(receipt), "utf8")
    .digest("hex");
}

export function sourceBridgeRemovalSecurityStateSha256(securityState) {
  const canonical = validateReceiptJsonValue(
    securityState,
    "Source bridge-removal security state",
  );
  if (canonical === null || typeof canonical !== "object" || Array.isArray(canonical)) {
    throw new Error("Source bridge-removal security state must be an object.");
  }
  return createHash("sha256")
    .update(canonicalJson(canonical), "utf8")
    .digest("hex");
}

export function sourceBridgeRemovalLegacyInventorySha256(inventory) {
  const canonical = validateReceiptJsonValue(
    inventory,
    "Source bridge-removal legacy inventory",
  );
  if (canonical === null || typeof canonical !== "object" || Array.isArray(canonical)) {
    throw new Error("Source bridge-removal legacy inventory must be an object.");
  }
  return createHash("sha256")
    .update(`${canonicalJson(canonical)}\n`, "utf8")
    .digest("hex");
}

export function sourceBridgeRemovalRulesetWritableSha256(writable) {
  const canonical = validateReceiptJsonValue(
    writable,
    "Source bridge-removal v2 ruleset writable policy",
  );
  if (canonical === null || typeof canonical !== "object" || Array.isArray(canonical)) {
    throw new Error(
      "Source bridge-removal v2 ruleset writable policy must be an object.",
    );
  }
  return createHash("sha256")
    .update(canonicalJson(canonical), "utf8")
    .digest("hex");
}

export function canonicalSourceBridgeRemovalProofOutput(output) {
  return canonicalJson(validateSourceBridgeRemovalProofOutput(output));
}

export function validateSourceBridgeRemovalProofOutput(output) {
  assertPlainReceiptObject(output, "Source bridge-removal proof output");
  assertExactReceiptKeys(
    output,
    [
      "schema_version",
      "mode",
      "status",
      "applied",
      "source_bridge_removal_receipt",
      "source_bridge_removal_receipt_sha256",
    ],
    "Source bridge-removal proof output",
  );
  if (
    output.schema_version !== SOURCE_BRIDGE_REMOVAL_PROOF_OUTPUT_SCHEMA_VERSION ||
    output.mode !== "derive" ||
    output.status !== "candidate" ||
    output.applied !== false
  ) {
    throw new Error(
      "Source bridge-removal proof output must be the read-only candidate result from derive mode.",
    );
  }
  const receipt = validateSourceBridgeRemovalProof(
    output.source_bridge_removal_receipt,
  );
  assertReceiptSha256(
    output.source_bridge_removal_receipt_sha256,
    "source_bridge_removal_receipt_sha256",
  );
  if (
    output.source_bridge_removal_receipt_sha256 !==
    sourceBridgeRemovalProofSha256(receipt)
  ) {
    throw new Error(
      "Source bridge-removal proof output SHA-256 does not bind its canonical receipt.",
    );
  }
  return {
    schema_version: SOURCE_BRIDGE_REMOVAL_PROOF_OUTPUT_SCHEMA_VERSION,
    mode: "derive",
    status: "candidate",
    applied: false,
    source_bridge_removal_receipt: receipt,
    source_bridge_removal_receipt_sha256:
      output.source_bridge_removal_receipt_sha256,
  };
}

export function validateSourceBridgeRemovalProof(receipt) {
  assertPlainReceiptObject(receipt, "Source bridge-removal receipt");
  assertExactReceiptKeys(
    receipt,
    [
      "schema_version",
      "scope",
      "repository",
      "control_plane_owner",
      "v2_ruleset",
      "retained_source_ruleset",
      "canary",
      "live_closure",
    ],
    "Source bridge-removal receipt",
  );
  if (
    receipt.schema_version !== SOURCE_BRIDGE_REMOVAL_PROOF_SCHEMA_VERSION ||
    receipt.scope !== "source-bridge-removal"
  ) {
    throw new Error(
      "Source bridge-removal receipt must use the admitted source-only schema and scope.",
    );
  }
  const repository = validateSourceBridgeRemovalRepository(receipt.repository);
  const controlPlaneOwner = validateSourceBridgeRemovalControlPlaneOwner(
    receipt.control_plane_owner,
  );
  const v2Ruleset = validateSourceBridgeRemovalV2Ruleset(receipt.v2_ruleset);
  const retainedSourceRuleset = validateSourceBridgeRemovalRetainedRuleset(
    receipt.retained_source_ruleset,
  );
  const canary = validateSourceBridgeRemovalCanary({
    canary: receipt.canary,
    repository,
  });
  const liveClosure = validateSourceBridgeRemovalLiveClosure({
    value: receipt.live_closure,
    repository,
    controlPlaneOwner,
    v2Ruleset,
    retainedSourceRuleset,
  });
  return {
    schema_version: SOURCE_BRIDGE_REMOVAL_PROOF_SCHEMA_VERSION,
    scope: "source-bridge-removal",
    repository,
    control_plane_owner: controlPlaneOwner,
    v2_ruleset: v2Ruleset,
    retained_source_ruleset: retainedSourceRuleset,
    canary,
    live_closure: liveClosure,
  };
}

function validateSourceBridgeRemovalControlPlaneOwner(value) {
  if (value !== DEFAULT_CONTROL_PLANE_OWNER) {
    throw new Error(
      `Source bridge-removal receipt must bind the fixed control-plane owner ${DEFAULT_CONTROL_PLANE_OWNER}.`,
    );
  }
  return DEFAULT_CONTROL_PLANE_OWNER;
}

function validateSourceBridgeRemovalRepository(value) {
  assertPlainReceiptObject(value, "Source bridge-removal repository");
  assertExactReceiptKeys(
    value,
    ["full_name", "id", "node_id", "default_branch", "default_branch_head_sha"],
    "Source bridge-removal repository",
  );
  if (value.full_name !== SOURCE_SELF_HOSTING_REPOSITORY_SLUG) {
    throw new Error(
      "Source bridge-removal receipt is not bound to the source self-hosting repository.",
    );
  }
  assertPositiveReceiptId(value.id, "Source bridge-removal repository id");
  assertReceiptText(value.node_id, "Source bridge-removal repository node_id");
  assertReceiptText(
    value.default_branch,
    "Source bridge-removal repository default_branch",
  );
  if (
    value.default_branch.startsWith("refs/") ||
    value.default_branch.includes("..")
  ) {
    throw new Error(
      "Source bridge-removal repository default_branch is malformed.",
    );
  }
  assertReceiptCommitSha(
    value.default_branch_head_sha,
    "Source bridge-removal repository default_branch_head_sha",
  );
  return {
    full_name: SOURCE_SELF_HOSTING_REPOSITORY_SLUG,
    id: value.id,
    node_id: value.node_id,
    default_branch: value.default_branch,
    default_branch_head_sha: value.default_branch_head_sha,
  };
}

function validateSourceBridgeRemovalV2Ruleset(value) {
  assertPlainReceiptObject(value, "Source bridge-removal v2_ruleset");
  assertExactReceiptKeys(
    value,
    [
      "id",
      "name",
      "state",
      "profile",
      "context",
      "integration_id",
      "strict_required_status_checks",
      "writable_sha256",
    ],
    "Source bridge-removal v2_ruleset",
  );
  assertPositiveReceiptId(value.id, "Source bridge-removal v2_ruleset id");
  assertReceiptText(value.name, "Source bridge-removal v2_ruleset name");
  if (
    value.name !== SOURCE_SELF_HOSTING_RULESET_NAME ||
    value.state !== "active" ||
    value.profile !== RULESET_PROFILE_STATUS_ONLY ||
    value.context !== DEFAULT_STATUS_CONTEXT ||
    value.integration_id !== DEFAULT_STATUS_INTEGRATION_ID ||
    value.strict_required_status_checks !== true
  ) {
    throw new Error(
      `Source bridge-removal receipt v2_ruleset is not the fixed ${SOURCE_SELF_HOSTING_RULESET_NAME} active strict status-only GitHub Actions v2 policy.`,
    );
  }
  assertReceiptSha256(
    value.writable_sha256,
    "Source bridge-removal v2_ruleset writable_sha256",
  );
  return {
    id: value.id,
    name: value.name,
    state: "active",
    profile: RULESET_PROFILE_STATUS_ONLY,
    context: DEFAULT_STATUS_CONTEXT,
    integration_id: DEFAULT_STATUS_INTEGRATION_ID,
    strict_required_status_checks: true,
    writable_sha256: value.writable_sha256,
  };
}

function validateSourceBridgeRemovalRetainedRuleset(value) {
  assertPlainReceiptObject(value, "Source bridge-removal retained_source_ruleset");
  assertExactReceiptKeys(
    value,
    ["id", "name", "source_type", "source", "target", "writable_sha256"],
    "Source bridge-removal retained_source_ruleset",
  );
  if (
    value.id !== SOURCE_SELF_HOSTING_RETAINED_RULESET_ID ||
    value.name !== SOURCE_SELF_HOSTING_RETAINED_RULESET_NAME ||
    value.source_type !== "Repository" ||
    value.source !== SOURCE_SELF_HOSTING_REPOSITORY_SLUG ||
    value.target !== "branch"
  ) {
    throw new Error(
      "Source bridge-removal retained_source_ruleset is not the fixed source non-status protection ruleset.",
    );
  }
  assertReceiptSha256(
    value.writable_sha256,
    "Source bridge-removal retained_source_ruleset writable_sha256",
  );
  const expectedWritableSha256 = sourceBridgeRemovalRulesetWritableSha256(
    sourceSelfHostingRetainedRulesetWritableProjection(
      SOURCE_SELF_HOSTING_RETAINED_RULESET_WRITABLE_POLICY,
    ),
  );
  if (value.writable_sha256 !== expectedWritableSha256) {
    throw new Error(
      "Source bridge-removal retained_source_ruleset writable_sha256 does not bind the admitted exact non-status protection policy.",
    );
  }
  return {
    id: SOURCE_SELF_HOSTING_RETAINED_RULESET_ID,
    name: SOURCE_SELF_HOSTING_RETAINED_RULESET_NAME,
    source_type: "Repository",
    source: SOURCE_SELF_HOSTING_REPOSITORY_SLUG,
    target: "branch",
    writable_sha256: expectedWritableSha256,
  };
}

// GitHub represents rules as an unordered ruleset. Normalize only that outer
// rule collection before comparing it with the security-state projection.
// Parameter arrays such as allowed_merge_methods and required_status_checks
// remain verbatim because their order may carry API semantics.
function sourceSelfHostingRetainedRulesetWritableProjection(writable) {
  if (!Array.isArray(writable?.rules)) {
    throw new Error(
      "Source retained ruleset writable policy must contain a complete rules array.",
    );
  }
  return {
    ...writable,
    rules: [...writable.rules].sort((left, right) =>
      canonicalJson(left).localeCompare(canonicalJson(right))
    ),
  };
}

function validateSourceBridgeRemovalCanary({ canary, repository }) {
  assertPlainReceiptObject(canary, "Source bridge-removal canary");
  assertExactReceiptKeys(
    canary,
    [
      "number",
      "state",
      "merged",
      "closed_at",
      "base",
      "base_ancestry",
      "head_sha",
      "test_merge_sha",
      "check_run",
      "run",
      "job",
    ],
    "Source bridge-removal canary",
  );
  assertPositiveReceiptId(canary.number, "Source bridge-removal canary number");
  if (canary.state !== "closed" || canary.merged !== false) {
    throw new Error(
      "Source bridge-removal canary must be a closed, unmerged historical pull request.",
    );
  }
  const closedAt = assertReceiptTimestamp(
    canary.closed_at,
    "Source bridge-removal canary closed_at",
  );
  assertPlainReceiptObject(canary.base, "Source bridge-removal canary base");
  assertExactReceiptKeys(
    canary.base,
    ["ref", "sha"],
    "Source bridge-removal canary base",
  );
  if (canary.base.ref !== repository.default_branch) {
    throw new Error(
      "Source bridge-removal canary base must use the source default branch.",
    );
  }
  assertReceiptCommitSha(canary.base.sha, "Source bridge-removal canary base sha");
  assertReceiptCommitSha(canary.head_sha, "Source bridge-removal canary head_sha");
  assertReceiptCommitSha(
    canary.test_merge_sha,
    "Source bridge-removal canary test_merge_sha",
  );
  const baseAncestry = validateSourceBridgeRemovalCanaryBaseAncestry({
    value: canary.base_ancestry,
    baseSha: canary.base.sha,
    defaultBranchHeadSha: repository.default_branch_head_sha,
  });
  const checkRun = validateSourceBridgeRemovalCanaryCheckRun(
    canary.check_run,
    canary.head_sha,
  );
  if (Date.parse(checkRun.completed_at) > closedAt) {
    throw new Error(
      "Source bridge-removal canary CheckRun completed after the pull request was closed.",
    );
  }
  const run = validateSourceBridgeRemovalCanaryRun({
    run: canary.run,
    canary,
  });
  const job = validateSourceBridgeRemovalCanaryJob({
    job: canary.job,
    headSha: canary.head_sha,
    checkRunId: checkRun.id,
    runId: run.id,
  });
  return {
    number: canary.number,
    state: "closed",
    merged: false,
    closed_at: canary.closed_at,
    base: { ref: repository.default_branch, sha: canary.base.sha },
    base_ancestry: baseAncestry,
    head_sha: canary.head_sha,
    test_merge_sha: canary.test_merge_sha,
    check_run: checkRun,
    run,
    job,
  };
}

function validateSourceBridgeRemovalCanaryBaseAncestry({
  value,
  baseSha,
  defaultBranchHeadSha,
}) {
  assertPlainReceiptObject(
    value,
    "Source bridge-removal canary base_ancestry",
  );
  assertExactReceiptKeys(
    value,
    [
      "base_sha",
      "current_default_branch_head_sha",
      "merge_base_sha",
      "status",
    ],
    "Source bridge-removal canary base_ancestry",
  );
  if (
    value.base_sha !== baseSha ||
    value.current_default_branch_head_sha !== defaultBranchHeadSha ||
    value.merge_base_sha !== baseSha ||
    !new Set(["identical", "ahead"]).has(value.status)
  ) {
    throw new Error(
      "Source bridge-removal canary base_ancestry does not prove that the historical base remains an ancestor of the current default-branch head.",
    );
  }
  return {
    base_sha: baseSha,
    current_default_branch_head_sha: defaultBranchHeadSha,
    merge_base_sha: baseSha,
    status: value.status,
  };
}

function validateSourceBridgeRemovalCanaryCheckRun(value, headSha) {
  assertPlainReceiptObject(value, "Source bridge-removal canary check_run");
  assertExactReceiptKeys(
    value,
    [
      "id",
      "name",
      "head_sha",
      "status",
      "conclusion",
      "completed_at",
      "app_id",
      "app_slug",
    ],
    "Source bridge-removal canary check_run",
  );
  assertPositiveReceiptId(value.id, "Source bridge-removal canary check_run id");
  if (
    value.name !== DEFAULT_STATUS_CONTEXT ||
    value.head_sha !== headSha ||
    value.status !== "completed" ||
    value.conclusion !== "success" ||
    value.app_id !== DEFAULT_STATUS_INTEGRATION_ID ||
    value.app_slug !== "github-actions"
  ) {
    throw new Error(
      "Source bridge-removal canary check_run is not the successful native GitHub Actions v2 check on its exact head.",
    );
  }
  assertReceiptTimestamp(
    value.completed_at,
    "Source bridge-removal canary check_run completed_at",
  );
  return {
    id: value.id,
    name: DEFAULT_STATUS_CONTEXT,
    head_sha: headSha,
    status: "completed",
    conclusion: "success",
    completed_at: value.completed_at,
    app_id: DEFAULT_STATUS_INTEGRATION_ID,
    app_slug: "github-actions",
  };
}

function validateSourceBridgeRemovalCanaryRun({ run, canary }) {
  assertPlainReceiptObject(run, "Source bridge-removal canary run");
  assertExactReceiptKeys(
    run,
    [
      "id",
      "attempt",
      "workflow_id",
      "workflow_path",
      "event",
      "head_sha",
      "status",
      "conclusion",
      "display_title",
    ],
    "Source bridge-removal canary run",
  );
  assertPositiveReceiptId(run.id, "Source bridge-removal canary run id");
  assertPositiveReceiptId(
    run.attempt,
    "Source bridge-removal canary run attempt",
  );
  assertPositiveReceiptId(
    run.workflow_id,
    "Source bridge-removal canary run workflow_id",
  );
  const expectedDisplayTitle =
    `${DEFAULT_VERIFIER_RUN_NAME_PREFIX}/${canary.number}/${canary.test_merge_sha}`;
  if (
    run.workflow_path !== DEFAULT_WORKFLOW_PATH ||
    run.event !== "pull_request" ||
    run.head_sha !== canary.head_sha ||
    run.status !== "completed" ||
    run.conclusion !== "success" ||
    run.display_title !== expectedDisplayTitle
  ) {
    throw new Error(
      "Source bridge-removal canary run does not bind the successful v2 verifier pull_request execution to the exact historical test merge.",
    );
  }
  return {
    id: run.id,
    attempt: run.attempt,
    workflow_id: run.workflow_id,
    workflow_path: DEFAULT_WORKFLOW_PATH,
    event: "pull_request",
    head_sha: canary.head_sha,
    status: "completed",
    conclusion: "success",
    display_title: expectedDisplayTitle,
  };
}

function validateSourceBridgeRemovalCanaryJob({
  job,
  headSha,
  checkRunId,
  runId,
}) {
  assertPlainReceiptObject(job, "Source bridge-removal canary job");
  assertExactReceiptKeys(
    job,
    ["id", "run_id", "name", "head_sha", "status", "conclusion", "check_run_id"],
    "Source bridge-removal canary job",
  );
  assertPositiveReceiptId(job.id, "Source bridge-removal canary job id");
  if (
    job.run_id !== runId ||
    job.name !== DEFAULT_STATUS_CONTEXT ||
    job.head_sha !== headSha ||
    job.status !== "completed" ||
    job.conclusion !== "success" ||
    job.check_run_id !== checkRunId
  ) {
    throw new Error(
      "Source bridge-removal canary job does not bind the exact successful v2 CheckRun and run.",
    );
  }
  return {
    id: job.id,
    run_id: runId,
    name: DEFAULT_STATUS_CONTEXT,
    head_sha: headSha,
    status: "completed",
    conclusion: "success",
    check_run_id: checkRunId,
  };
}

function validateSourceBridgeRemovalLiveClosure({
  value,
  repository,
  controlPlaneOwner,
  v2Ruleset,
  retainedSourceRuleset,
}) {
  assertPlainReceiptObject(value, "Source bridge-removal live_closure");
  assertExactReceiptKeys(
    value,
    [
      "security_sha256",
      "legacy_inventory_sha256",
      "legacy_inventory",
      "legacy_status_required",
      "canonical_workflows",
      "canonical_workflow_api",
      "security_state",
    ],
    "Source bridge-removal live_closure",
  );
  assertReceiptSha256(
    value.security_sha256,
    "Source bridge-removal live_closure security_sha256",
  );
  assertReceiptSha256(
    value.legacy_inventory_sha256,
    "Source bridge-removal live_closure legacy_inventory_sha256",
  );
  if (value.legacy_status_required !== false) {
    throw new Error(
      "Source bridge-removal live closure must prove that the legacy status is not required.",
    );
  }
  const legacyInventory = validateSourceBridgeRemovalLegacyInventory({
    value: value.legacy_inventory,
    repository,
  });
  if (
    value.legacy_inventory_sha256 !==
    sourceBridgeRemovalLegacyInventorySha256(legacyInventory)
  ) {
    throw new Error(
      "Source bridge-removal live_closure legacy_inventory_sha256 does not bind its complete legacy inventory.",
    );
  }
  if (!Array.isArray(value.canonical_workflows) || value.canonical_workflows.length !== 3) {
    throw new Error(
      "Source bridge-removal live closure must bind the three canonical v2/legacy workflow objects.",
    );
  }
  const expectedPaths = [
    DEFAULT_CONTROLLER_WORKFLOW_PATH,
    DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH,
    DEFAULT_WORKFLOW_PATH,
  ].sort(compareCanonicalText);
  const workflows = value.canonical_workflows.map((workflow, index) => {
    assertPlainReceiptObject(
      workflow,
      `Source bridge-removal canonical_workflows ${index + 1}`,
    );
    assertExactReceiptKeys(
      workflow,
      ["path", "mode", "content_sha256"],
      `Source bridge-removal canonical_workflows ${index + 1}`,
    );
    if (workflow.path !== expectedPaths[index]) {
      throw new Error(
        "Source bridge-removal canonical_workflows must use exact canonical path order.",
      );
    }
    if (!new Set(["100644", "100755"]).has(workflow.mode)) {
      throw new Error(
        "Source bridge-removal canonical workflow mode is not a regular Git blob mode.",
      );
    }
    assertReceiptSha256(
      workflow.content_sha256,
      `Source bridge-removal canonical workflow ${workflow.path} content_sha256`,
    );
    return {
      path: workflow.path,
      mode: workflow.mode,
      content_sha256: workflow.content_sha256,
    };
  });
  const securityState = validateSourceBridgeRemovalSecurityState({
    value: value.security_state,
    repository,
    controlPlaneOwner,
    v2Ruleset,
    retainedSourceRuleset,
    workflows,
  });
  const workflowApi = validateSourceBridgeRemovalWorkflowApi({
    value: value.canonical_workflow_api,
    workflows,
  });
  if (
    value.security_sha256 !==
    sourceBridgeRemovalSecurityStateSha256(securityState)
  ) {
    throw new Error(
      "Source bridge-removal live_closure security_sha256 does not bind its complete security_state.",
    );
  }
  return {
    security_sha256: value.security_sha256,
    legacy_inventory_sha256: value.legacy_inventory_sha256,
    legacy_inventory: legacyInventory,
    legacy_status_required: false,
    canonical_workflows: workflows,
    canonical_workflow_api: workflowApi,
    security_state: securityState,
  };
}

function validateSourceBridgeRemovalLegacyInventory({ value, repository }) {
  const inventory = validateReceiptJsonValue(
    value,
    "Source bridge-removal live_closure legacy_inventory",
  );
  if (
    inventory === null ||
    typeof inventory !== "object" ||
    Array.isArray(inventory) ||
    inventory.repository !== repository.full_name ||
    inventory.repository_id !== repository.id ||
    inventory.repository_node_id !== repository.node_id ||
    inventory.default_branch !== repository.default_branch ||
    !Array.isArray(inventory.rulesets) ||
    inventory.rulesets.length !== 0
  ) {
    throw new Error(
      "Source bridge-removal live_closure legacy_inventory is not a complete clear inventory bound to the source repository.",
    );
  }
  const classic = inventory.classic_required_status_checks;
  if (
    classic !== null &&
    (typeof classic !== "object" ||
      Array.isArray(classic) ||
      !Array.isArray(classic.contexts) ||
      !Array.isArray(classic.checks) ||
      classic.contexts.some((context) => isLegacyStatusContext(context)) ||
      classic.checks.some((check) => isLegacyStatusContext(check?.context)))
  ) {
    throw new Error(
      "Source bridge-removal live_closure legacy_inventory still contains the legacy status context.",
    );
  }
  return inventory;
}

function validateSourceBridgeRemovalWorkflowApi({ value, workflows }) {
  if (!Array.isArray(value) || value.length !== workflows.length) {
    throw new Error(
      "Source bridge-removal live_closure must bind active workflow API identities for each canonical workflow.",
    );
  }
  const expectedPaths = workflows.map((workflow) => workflow.path);
  return value.map((workflow, index) => {
    assertPlainReceiptObject(
      workflow,
      `Source bridge-removal canonical_workflow_api ${index + 1}`,
    );
    assertExactReceiptKeys(
      workflow,
      ["id", "path", "state"],
      `Source bridge-removal canonical_workflow_api ${index + 1}`,
    );
    assertPositiveReceiptId(
      workflow.id,
      `Source bridge-removal canonical workflow ${workflow.path} id`,
    );
    if (workflow.path !== expectedPaths[index] || workflow.state !== "active") {
      throw new Error(
        "Source bridge-removal canonical_workflow_api must use exact canonical path order and active states.",
      );
    }
    return { id: workflow.id, path: workflow.path, state: "active" };
  });
}

function validateSourceBridgeRemovalSecurityState({
  value,
  repository,
  controlPlaneOwner,
  v2Ruleset,
  retainedSourceRuleset,
  workflows,
}) {
  const securityState = validateReceiptJsonValue(
    value,
    "Source bridge-removal live_closure security_state",
  );
  if (
    securityState === null ||
    typeof securityState !== "object" ||
    Array.isArray(securityState)
  ) {
    throw new Error(
      "Source bridge-removal live_closure security_state must be a complete object.",
    );
  }
  const boundControlPlaneOwner =
    validateSourceBridgeRemovalControlPlaneOwnerSecurityBinding(
      securityState.control_plane_owner,
      controlPlaneOwner,
    );
  assertExactReceiptKeys(
    securityState,
    [
      "schema_version",
      "repository",
      "actions_workflow_permissions",
      "control_plane_owner",
      "workflow_inventory",
      "codeowners",
      "classic_branch_protection",
      "rulesets",
    ],
    "Source bridge-removal live_closure security_state",
  );
  if (
    securityState.schema_version !== 1 ||
    securityState.repository === null ||
    typeof securityState.repository !== "object" ||
    Array.isArray(securityState.repository) ||
    securityState.repository.full_name !== repository.full_name ||
    securityState.repository.id !== repository.id ||
    securityState.repository.node_id !== repository.node_id ||
    securityState.repository.default_branch !== repository.default_branch ||
    securityState.repository.default_branch_head_sha !==
      repository.default_branch_head_sha ||
    !Array.isArray(securityState.rulesets) ||
    !Array.isArray(securityState.workflow_inventory)
  ) {
    throw new Error(
      "Source bridge-removal live_closure security_state is not bound to the receipt repository, complete rulesets, and workflow inventory.",
    );
  }
  const matchedRetainedSourceRulesets = securityState.rulesets.filter(
    (ruleset) => ruleset?.id === retainedSourceRuleset.id,
  );
  if (
    matchedRetainedSourceRulesets.length !== 1 ||
    matchedRetainedSourceRulesets[0]?.name !== retainedSourceRuleset.name ||
    matchedRetainedSourceRulesets[0]?.source_type !==
      retainedSourceRuleset.source_type ||
    matchedRetainedSourceRulesets[0]?.source !== retainedSourceRuleset.source ||
    matchedRetainedSourceRulesets[0]?.writable === null ||
    typeof matchedRetainedSourceRulesets[0]?.writable !== "object" ||
    Array.isArray(matchedRetainedSourceRulesets[0]?.writable) ||
    sourceBridgeRemovalRulesetWritableSha256(
      matchedRetainedSourceRulesets[0].writable,
    ) !== retainedSourceRuleset.writable_sha256
  ) {
    throw new Error(
      "Source bridge-removal live_closure security_state does not bind the fixed retained source non-status protection policy.",
    );
  }
  const matchedRulesets = securityState.rulesets.filter(
    (ruleset) => ruleset?.id === v2Ruleset.id,
  );
  if (
    matchedRulesets.length !== 1 ||
    matchedRulesets[0]?.name !== v2Ruleset.name ||
    matchedRulesets[0]?.source_type !== "Repository" ||
    matchedRulesets[0]?.source !== repository.full_name ||
    matchedRulesets[0]?.writable === null ||
    typeof matchedRulesets[0]?.writable !== "object" ||
    Array.isArray(matchedRulesets[0]?.writable) ||
    sourceBridgeRemovalRulesetWritableSha256(matchedRulesets[0].writable) !==
      v2Ruleset.writable_sha256
  ) {
    throw new Error(
      "Source bridge-removal live_closure security_state does not bind the selected v2 ruleset writable policy.",
    );
  }
  for (const workflow of workflows) {
    const matches = securityState.workflow_inventory.filter(
      (entry) =>
        entry?.path === workflow.path &&
        entry?.mode === workflow.mode &&
        entry?.content_sha256 === workflow.content_sha256,
    );
    if (matches.length !== 1) {
      throw new Error(
        "Source bridge-removal live_closure security_state does not bind each canonical workflow object.",
      );
    }
  }
  return {
    ...securityState,
    control_plane_owner: boundControlPlaneOwner,
  };
}

function validateSourceBridgeRemovalControlPlaneOwnerSecurityBinding(
  value,
  controlPlaneOwner,
) {
  assertPlainReceiptObject(
    value,
    "Source bridge-removal control_plane_owner security binding",
  );
  assertExactReceiptKeys(
    value,
    ["login", "type", "id", "node_id", "permission"],
    "Source bridge-removal control_plane_owner security binding",
  );
  const expectedLogin = controlPlaneOwner.slice(1).toLowerCase();
  if (
    value.login !== expectedLogin ||
    value.type !== "User" ||
    !["write", "maintain", "admin"].includes(value.permission)
  ) {
    throw new Error(
      `Source bridge-removal control_plane_owner security binding must prove ${controlPlaneOwner} as a writable GitHub User.`,
    );
  }
  assertPositiveReceiptId(
    value.id,
    "Source bridge-removal control_plane_owner security binding id",
  );
  assertReceiptText(
    value.node_id,
    "Source bridge-removal control_plane_owner security binding node_id",
  );
  return {
    login: expectedLogin,
    type: "User",
    id: value.id,
    node_id: value.node_id,
    permission: value.permission,
  };
}

function validateReceiptJsonValue(value, label) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`${label} contains a non-safe-integer number.`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      validateReceiptJsonValue(item, `${label}[${index}]`),
    );
  }
  if (value === undefined || typeof value !== "object") {
    throw new Error(`${label} contains an unsupported value.`);
  }
  const result = {};
  for (const key of Object.keys(value)) {
    if (
      typeof key !== "string" ||
      /[\0\r\n]/u.test(key) ||
      ["__proto__", "constructor", "prototype"].includes(key)
    ) {
      throw new Error(`${label} contains an invalid object key.`);
    }
    result[key] = validateReceiptJsonValue(value[key], `${label}.${key}`);
  }
  return result;
}

function assertReceiptCommitSha(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`${label} must be an exact lowercase 40-hex commit SHA.`);
  }
}

function assertReceiptTimestamp(value, label) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value)
  ) {
    throw new Error(`${label} must be an exact UTC ISO-8601 timestamp.`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isSafeInteger(timestamp)) {
    throw new Error(`${label} is not a valid UTC ISO-8601 timestamp.`);
  }
  return timestamp;
}

function assertSchemaTwoCohortExcludesCurrentLegacyOnlyRepository(
  repositories,
  field,
) {
  const archived = CURRENT_LEGACY_ONLY_ARCHIVED_REPOSITORY;
  if (
    repositories.some(
      (repository) =>
        repository.full_name.toLowerCase() === archived.full_name.toLowerCase() ||
        repository.id === archived.id ||
        repository.node_id === archived.node_id,
    )
  ) {
    throw new Error(
      `Organization final closure receipt ${field} must not authorize the current archived legacy-only repository.`,
    );
  }
}

function validateReceiptRepositoryCohort(
  value,
  organization,
  cohortSize,
  field,
  schemaVersion,
) {
  if (!Array.isArray(value) || value.length !== cohortSize) {
    throw new Error(
      `Organization final closure receipt ${field} must contain exactly ${cohortSize} cohort members for receipt schema ${schemaVersion}.`,
    );
  }
  const repositories = value.map((repository, index) =>
    validateReceiptRepository(repository, organization, index)
  );
  const slugs = new Set();
  const ids = new Set();
  const nodeIds = new Set();
  for (const repository of repositories) {
    const foldedSlug = repository.full_name.toLowerCase();
    if (
      slugs.has(foldedSlug) ||
      ids.has(repository.id) ||
      nodeIds.has(repository.node_id)
    ) {
      throw new Error(
        `Organization final closure receipt ${field} contains duplicate repository identities.`,
      );
    }
    slugs.add(foldedSlug);
    ids.add(repository.id);
    nodeIds.add(repository.node_id);
  }
  const canonicalOrder = [...repositories].sort((left, right) =>
    compareCanonicalText(left.full_name, right.full_name)
  );
  if (canonicalJson(repositories) !== canonicalJson(canonicalOrder)) {
    throw new Error(
      `Organization final closure receipt ${field} must use producer canonical full_name order.`,
    );
  }
  return repositories;
}

function validateReceiptOrganization(value) {
  assertPlainReceiptObject(value, "Receipt organization");
  assertExactReceiptKeys(value, ["login", "id", "node_id"], "Receipt organization");
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(value.login)) {
    throw new Error("Receipt organization login is invalid.");
  }
  assertPositiveReceiptId(value.id, "Receipt organization id");
  assertReceiptText(value.node_id, "Receipt organization node_id");
  return { login: value.login, id: value.id, node_id: value.node_id };
}

function validateReceiptRuleset(value, expectedState, label) {
  assertPlainReceiptObject(value, `Receipt ${label}`);
  assertExactReceiptKeys(value, ["id", "state"], `Receipt ${label}`);
  assertPositiveReceiptId(value.id, `Receipt ${label} id`);
  if (value.state !== expectedState) {
    throw new Error(`Receipt ${label} state must be ${expectedState}.`);
  }
  return { id: value.id, state: value.state };
}

function validateReceiptRepository(value, organization, index) {
  const label = `Receipt repository ${index + 1}`;
  assertPlainReceiptObject(value, label);
  assertExactReceiptKeys(
    value,
    ["full_name", "id", "node_id", "default_branch"],
    label,
  );
  assertReceiptText(value.full_name, `${label} full_name`);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value.full_name)) {
    throw new Error(`${label} full_name must be an exact OWNER/REPO slug.`);
  }
  const parsed = parseRepoSlug(value.full_name);
  if (parsed.owner.toLowerCase() !== organization.login.toLowerCase()) {
    throw new Error(`${label} is outside the receipt organization.`);
  }
  assertPositiveReceiptId(value.id, `${label} id`);
  assertReceiptText(value.node_id, `${label} node_id`);
  assertReceiptText(value.default_branch, `${label} default_branch`);
  if (
    value.default_branch.startsWith("refs/") ||
    value.default_branch.includes("..")
  ) {
    throw new Error(`${label} default_branch is malformed.`);
  }
  return {
    full_name: parsed.slug,
    id: value.id,
    node_id: value.node_id,
    default_branch: value.default_branch,
  };
}

function assertPlainReceiptObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertExactReceiptKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`${label} has an unexpected or missing field.`);
  }
}

function assertPositiveReceiptId(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
}

function assertReceiptText(value, label) {
  if (
    typeof value !== "string" ||
    value === "" ||
    /[\0\r\n]/u.test(value)
  ) {
    throw new Error(`${label} must be non-empty text without control newlines.`);
  }
}

function assertReceiptSha256(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be an exact lowercase SHA-256.`);
  }
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

export function rulesetHasStatusOnlyPolicy(
  ruleset,
  context = DEFAULT_STATUS_CONTEXT,
  { integrationId = DEFAULT_STATUS_INTEGRATION_ID } = {},
) {
  assertStatusOnlyProfileBinding(context, integrationId);
  if (
    ruleset === null ||
    typeof ruleset !== "object" ||
    Array.isArray(ruleset) ||
    !Array.isArray(ruleset.bypass_actors) ||
    ruleset.bypass_actors.length !== 0 ||
    !Array.isArray(ruleset.rules) ||
    ruleset.rules.length !== 1
  ) {
    return false;
  }

  const [rule] = ruleset.rules;
  if (
    rule === null ||
    typeof rule !== "object" ||
    Array.isArray(rule) ||
    rule.type !== "required_status_checks"
  ) {
    return false;
  }

  return canonicalJson(
    normalizeStatusOnlyRequiredStatusRuleForComparison(rule),
  ) === canonicalJson(
    buildRequiredStatusChecksRule({
      context,
      integrationId,
      strict: true,
      doNotEnforceOnCreate: false,
    }),
  );
}

export function rulesetHasStatusOnlyProfile(
  ruleset,
  context = DEFAULT_STATUS_CONTEXT,
  { integrationId = DEFAULT_STATUS_INTEGRATION_ID } = {},
) {
  return (
    rulesetHasStatusOnlyPolicy(ruleset, context, { integrationId }) &&
    ruleset.target === "branch" &&
    STATUS_ONLY_RULESET_ENFORCEMENTS.has(ruleset.enforcement) &&
    canonicalJson(ruleset.conditions) === canonicalJson(DEFAULT_REF_CONDITIONS)
  );
}

export function rulesetHasPolicyForProfile(
  ruleset,
  profile = DEFAULT_RULESET_PROFILE,
  context = DEFAULT_STATUS_CONTEXT,
  { integrationId = DEFAULT_STATUS_INTEGRATION_ID } = {},
) {
  switch (normalizeRulesetProfile(profile)) {
    case RULESET_PROFILE_FULL:
      return rulesetHasGatePolicy(ruleset, context, { integrationId });
    case RULESET_PROFILE_STATUS_ONLY:
      return rulesetHasStatusOnlyPolicy(ruleset, context, { integrationId });
    default:
      throw new Error("Ruleset profile normalization returned an unsupported value.");
  }
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

export function findEffectiveRulesetWithStatusOnlyPolicy(
  rulesets,
  context = DEFAULT_STATUS_CONTEXT,
  { defaultBranch = null, integrationId = DEFAULT_STATUS_INTEGRATION_ID } = {},
) {
  assertStatusOnlyProfileBinding(context, integrationId);
  return rulesets.find(
    (ruleset) =>
      ruleset.enforcement === "active" &&
      rulesetCoversDefaultBranch(ruleset, defaultBranch) &&
      rulesetHasStatusOnlyProfile(ruleset, context, { integrationId }),
  );
}

export function findEffectiveRulesetWithProfilePolicy(
  rulesets,
  profile = DEFAULT_RULESET_PROFILE,
  context = DEFAULT_STATUS_CONTEXT,
  options = {},
) {
  switch (normalizeRulesetProfile(profile)) {
    case RULESET_PROFILE_FULL:
      return findEffectiveRulesetWithGatePolicy(rulesets, context, options);
    case RULESET_PROFILE_STATUS_ONLY:
      return findEffectiveRulesetWithStatusOnlyPolicy(rulesets, context, options);
    default:
      throw new Error("Ruleset profile normalization returned an unsupported value.");
  }
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
        (check) => isLegacyStatusContext(check.context),
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
            (check) => isLegacyStatusContext(check.context),
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
  const removableContexts = removeContexts.filter(
    (item) => !statusContextEqualsAsciiCaseInsensitive(item, context),
  );
  const checks = originalChecks.filter(
    (check) =>
      !removableContexts.some((item) =>
        statusContextEqualsAsciiCaseInsensitive(check?.context, item),
      ),
  );
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
  profile = DEFAULT_RULESET_PROFILE,
} = {}) {
  const normalizedProfile = normalizeRulesetProfile(profile);
  if (normalizedProfile === RULESET_PROFILE_STATUS_ONLY) {
    assertStatusOnlyProfileOptions({
      context,
      integrationId,
      strict,
      doNotEnforceOnCreate,
    });
    assertStatusOnlyRulesetEnforcement(enforcement);
    return {
      name,
      target: "branch",
      enforcement,
      bypass_actors: [],
      conditions: structuredCloneSafe(DEFAULT_REF_CONDITIONS),
      rules: [
        buildRequiredStatusChecksRule({
          context,
          integrationId,
          strict,
          doNotEnforceOnCreate: doNotEnforceOnCreate ?? false,
        }),
      ],
    };
  }

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
    profile = DEFAULT_RULESET_PROFILE,
  } = {},
) {
  const normalizedProfile = normalizeRulesetProfile(profile);
  if (normalizedProfile === RULESET_PROFILE_STATUS_ONLY) {
    return buildStatusOnlyUpdateRulesetPayload(ruleset, {
      context,
      integrationId,
      enforcement,
      strict,
      doNotEnforceOnCreate,
    });
  }

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

function buildStatusOnlyUpdateRulesetPayload(
  ruleset,
  {
    context,
    integrationId,
    enforcement,
    strict,
    doNotEnforceOnCreate,
  },
) {
  assertStatusOnlyProfileOptions({
    context,
    integrationId,
    strict,
    doNotEnforceOnCreate,
  });
  if (!rulesetHasStatusOnlyProfile(ruleset, context, { integrationId })) {
    throw new Error(
      `Ruleset "${ruleset?.name ?? "<unnamed>"}" is not an exact status-only profile; refusing to remove or rewrite additional protections.`,
    );
  }

  const requiredEnforcement = enforcement ?? ruleset.enforcement;
  assertStatusOnlyRulesetEnforcement(requiredEnforcement);
  const payload = buildCreateRulesetPayload({
    name: ruleset.name,
    context,
    integrationId,
    enforcement: requiredEnforcement,
    strict,
    doNotEnforceOnCreate,
    profile: RULESET_PROFILE_STATUS_ONLY,
  });
  return {
    changed:
      rulesetWritableFingerprint(ruleset, {
        profile: RULESET_PROFILE_STATUS_ONLY,
      }) !==
      rulesetWritableFingerprint(payload, {
        profile: RULESET_PROFILE_STATUS_ONLY,
      }),
    payload,
  };
}

export function rulesetWritableFingerprint(
  ruleset,
  { profile = DEFAULT_RULESET_PROFILE } = {},
) {
  if (ruleset === null || typeof ruleset !== "object" || Array.isArray(ruleset)) {
    throw new Error("Ruleset readback must be an object before update.");
  }
  const normalizedProfile = normalizeRulesetProfile(profile);
  const rules = Array.isArray(ruleset.rules)
    ? ruleset.rules.map(stripRuleForRulesetPayload)
    : ruleset.rules;
  return canonicalJson({
    name: ruleset.name,
    target: ruleset.target,
    enforcement: ruleset.enforcement,
    bypass_actors: Array.isArray(ruleset.bypass_actors)
      ? ruleset.bypass_actors.map(stripBypassActorForRulesetPayload)
      : ruleset.bypass_actors,
    conditions: structuredCloneSafe(ruleset.conditions),
    rules: normalizedProfile === RULESET_PROFILE_STATUS_ONLY && Array.isArray(rules)
      ? rules.map(normalizeStatusOnlyRequiredStatusRuleForComparison)
      : rules,
  });
}

export function assertSourceSelfHostingRetainedRulesetPolicy(ruleset) {
  const fullRuleset = assertCompleteRulesetApiObject(ruleset);
  if (
    fullRuleset.id !== SOURCE_SELF_HOSTING_RETAINED_RULESET_ID ||
    fullRuleset.name !== SOURCE_SELF_HOSTING_RETAINED_RULESET_NAME ||
    fullRuleset.source_type !== "Repository" ||
    fullRuleset.source !== SOURCE_SELF_HOSTING_REPOSITORY_SLUG ||
    fullRuleset.target !== "branch"
  ) {
    throw new Error(
      `Source retained ruleset must remain ${SOURCE_SELF_HOSTING_RETAINED_RULESET_ID} (${SOURCE_SELF_HOSTING_RETAINED_RULESET_NAME}) with the exact source repository branch identity.`,
    );
  }
  const writable = sourceSelfHostingRetainedRulesetWritableProjection(
    JSON.parse(rulesetWritableFingerprint(fullRuleset)),
  );
  if (
    canonicalJson(writable) !==
    canonicalJson(
      sourceSelfHostingRetainedRulesetWritableProjection(
        SOURCE_SELF_HOSTING_RETAINED_RULESET_WRITABLE_POLICY,
      ),
    )
  ) {
    throw new Error(
      "Source retained ruleset no longer matches the admitted exact non-status protection policy.",
    );
  }
  return {
    id: SOURCE_SELF_HOSTING_RETAINED_RULESET_ID,
    name: SOURCE_SELF_HOSTING_RETAINED_RULESET_NAME,
    source_type: "Repository",
    source: SOURCE_SELF_HOSTING_REPOSITORY_SLUG,
    target: "branch",
    writable,
  };
}

export function validateCanonicalV2WorkflowContent(value) {
  return validateCanonicalV2VerifierWorkflowContent(value);
}

export function validateCanonicalLegacyBridgeWorkflowContent(value) {
  return validateLegacyBridgeWorkflowContent(value, {
    requireCurrentCanonicalBytes: true,
  });
}

function validateFrozenHandoffLegacyBridgeWorkflowContent(value) {
  return validateLegacyBridgeWorkflowContent(value, {
    requireCurrentCanonicalBytes: false,
  });
}

function validateLegacyBridgeWorkflowContent(value, {
  requireCurrentCanonicalBytes,
}) {
  if (typeof value !== "string" || value === "") {
    throw new Error(
      "Canonical legacy bridge workflow must be non-empty UTF-8 text.",
    );
  }
  if (value.startsWith("\uFEFF") || /\uFEFF|[\u0085\u2028\u2029\t]/u.test(value)) {
    throw new Error(
      "Canonical legacy bridge workflow must use plain LF YAML without BOM, tabs, or non-ASCII line separators.",
    );
  }
  assertCanonicalWorkflowLineEndings(value);
  if (/^\s*schedule:\s*$/m.test(value) || /^\s*-?\s*cron:\s*/m.test(value)) {
    throw new Error("Canonical legacy bridge workflow must not allocate cron runners.");
  }
  for (const forbiddenEvent of [
    "workflow_dispatch",
    "repository_dispatch",
    "pull_request_review",
    "pull_request_review_comment",
  ]) {
    if (new RegExp(`^  ${forbiddenEvent}:`, "m").test(value)) {
      throw new Error(
        `Canonical legacy bridge workflow must not expose ${forbiddenEvent}.`,
      );
    }
  }
  if (
    value.includes(CANONICAL_V2_WORKFLOW_USES) ||
    value.includes(DEFAULT_STATUS_CONTEXT)
  ) {
    throw new Error(
      "Canonical legacy bridge workflow must not produce or call the v2 gate.",
    );
  }
  const usesMatches = value.match(/^\s*uses:\s*([^\s#]+)\s*$/gm) ?? [];
  const expectedUses = `uses: ${LEGACY_V1_WORKFLOW_USES}`;
  if (usesMatches.length !== 1 || usesMatches[0].trim() !== expectedUses) {
    throw new Error(
      `Canonical legacy bridge workflow must contain exactly one literal "${expectedUses}" caller.`,
    );
  }
  const producerViolations = workflowSingleProducerPolicyViolations(value);
  if (
    producerViolations.length !== 2 ||
    producerViolations[0] !== "issues: write" ||
    producerViolations[1] !== "statuses: write"
  ) {
    throw new Error(
      "Canonical legacy bridge workflow may write only issues and legacy commit statuses.",
    );
  }
  if (
    requireCurrentCanonicalBytes &&
    value !== CANONICAL_LEGACY_BRIDGE_WORKFLOW_CONTENT
  ) {
    throw new Error(
      "Canonical legacy bridge workflow must exactly match the closed temporary event, permission, concurrency, and single-caller envelope.",
    );
  }
  return value;
}

export function validateCanonicalV2VerifierWorkflowContent(value) {
  return validateV2VerifierWorkflowContent(value, {
    requestAuthorPermission: CANONICAL_REQUEST_AUTHOR_PERMISSION,
  });
}

function validateFrozenHandoffV2VerifierWorkflowContent(value) {
  return validateV2VerifierWorkflowContent(value, {
    requestAuthorPermission: FROZEN_HANDOFF_REQUEST_AUTHOR_PERMISSION,
  });
}

function validateV2VerifierWorkflowContent(value, {
  requestAuthorPermission,
}) {
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
    `CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION: ${requestAuthorPermission}`,
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
  return validateV2ControllerWorkflowContent(value, {
    jobIfExpression: CANONICAL_CONTROLLER_JOB_IF_EXPRESSION,
    issueCommentTypes: CANONICAL_CONTROLLER_ISSUE_COMMENT_TYPES,
  });
}

function validateFrozenHandoffV2ControllerWorkflowContent(value) {
  return validateV2ControllerWorkflowContent(value, {
    jobIfExpression: FROZEN_HANDOFF_CONTROLLER_JOB_IF_EXPRESSION,
    issueCommentTypes: FROZEN_HANDOFF_CONTROLLER_ISSUE_COMMENT_TYPES,
    requestAuthorPermission: FROZEN_HANDOFF_REQUEST_AUTHOR_PERMISSION,
  });
}

function validateV2ControllerWorkflowContent(value, {
  jobIfExpression: expectedJobIfExpression,
  issueCommentTypes,
  requestAuthorPermission = CANONICAL_REQUEST_AUTHOR_PERMISSION,
}) {
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
  if (jobIfExpression !== expectedJobIfExpression) {
    throw new Error(
      "Canonical v2 controller workflow job.if must exactly match the closed runner-admission expression.",
    );
  }
  if (
    !value.includes(`  issue_comment:\n    types: ${issueCommentTypes}`) ||
    !/^  workflow_dispatch:\s*$/m.test(value)
  ) {
    throw new Error(
      `Canonical v2 controller workflow must expose issue_comment ${issueCommentTypes} and workflow_dispatch.`,
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
    issueCommentTypes,
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
    ["permissions.pull-requests", "write"],
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
      requestAuthorPermission,
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
    "permissions:\n  actions: write\n  checks: read\n  contents: read\n  pull-requests: write",
    "github.event_name == 'workflow_dispatch'",
    "github.ref_type == 'branch'",
    "github.ref_name == github.event.repository.default_branch",
    "github.event_name == 'issue_comment'",
    "github.event.action == 'created'",
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
    `CODEX_REVIEW_GATE_REQUEST_AUTHOR_PERMISSION: ${requestAuthorPermission}`,
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
  { legacyBridge = false } = {},
) {
  return validateV2WorkflowInventory(
    workflowFiles,
    canonicalWorkflows,
    {
      legacyBridge,
      validateVerifier: validateCanonicalV2VerifierWorkflowContent,
      validateController: validateCanonicalV2ControllerWorkflowContent,
      validateLegacyBridge: validateCanonicalLegacyBridgeWorkflowContent,
    },
  );
}

// This entry point is intentionally limited to immutable organization-handoff
// evidence that predates the created-only controller admission rule. It is not
// an installation or bootstrap policy: callers must separately bind each
// workflow to its frozen manifest identity before using this validator.
export function validateFrozenHandoffV2WorkflowInventory(
  workflowFiles,
  canonicalWorkflows,
  { legacyBridge = false } = {},
) {
  return validateV2WorkflowInventory(
    workflowFiles,
    canonicalWorkflows,
    {
      legacyBridge,
      validateVerifier: validateFrozenHandoffV2VerifierWorkflowContent,
      validateController: validateFrozenHandoffV2ControllerWorkflowContent,
      validateLegacyBridge: validateFrozenHandoffLegacyBridgeWorkflowContent,
    },
  );
}

function validateV2WorkflowInventory(
  workflowFiles,
  canonicalWorkflows,
  {
    legacyBridge,
    validateVerifier,
    validateController,
    validateLegacyBridge,
  },
) {
  if (!Array.isArray(workflowFiles)) {
    throw new Error("Default-branch workflow inventory must be an array.");
  }
  if (typeof legacyBridge !== "boolean") {
    throw new Error("Legacy bridge inventory admission must be an explicit boolean.");
  }
  const canonicalEntries = normalizeCanonicalWorkflowEntries(
    canonicalWorkflows,
    {
      legacyBridge,
      validateVerifier,
      validateController,
      validateLegacyBridge,
    },
  );
  for (const { path, content, role } of canonicalEntries) {
    const matches = workflowFiles.filter((file) => file?.path === path);
    if (matches.length !== 1) {
      throw new Error(
        `${path} must occur exactly once in the complete default-branch workflow inventory.`,
      );
    }
    if (role === "verifier") {
      validateVerifier(matches[0].content);
    } else if (role === "controller") {
      validateController(matches[0].content);
    } else {
      validateLegacyBridge(matches[0].content);
    }
    if (!installedWorkflowMatchesCanonical(matches[0].content, content)) {
      throw new Error(
        role === "legacy bridge"
          ? `${path} differs from the canonical temporary legacy bridge workflow bytes.`
          : `${path} differs from the canonical v2 ${role} workflow bytes.`,
      );
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

function normalizeCanonicalWorkflowEntries(
  canonicalWorkflows,
  {
    legacyBridge = false,
    validateVerifier = validateCanonicalV2VerifierWorkflowContent,
    validateController = validateCanonicalV2ControllerWorkflowContent,
    validateLegacyBridge = validateCanonicalLegacyBridgeWorkflowContent,
  } = {},
) {
  if (
    canonicalWorkflows === null ||
    typeof canonicalWorkflows !== "object" ||
    Array.isArray(canonicalWorkflows)
  ) {
    throw new Error(
      "Canonical workflow inventory must provide verifier and controller workflow bytes.",
    );
  }
  if (
    typeof validateVerifier !== "function" ||
    typeof validateController !== "function" ||
    typeof validateLegacyBridge !== "function"
  ) {
    throw new Error("Canonical workflow inventory validators must be functions.");
  }
  const verifier = canonicalWorkflows.verifier;
  const controller = canonicalWorkflows.controller;
  validateVerifier(verifier);
  validateController(controller);
  const entries = [
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
  if (legacyBridge) {
    const bridge = canonicalWorkflows.legacyBridge;
    validateLegacyBridge(bridge);
    entries.push({
      role: "legacy bridge",
      path: DEFAULT_LEGACY_BRIDGE_WORKFLOW_PATH,
      content: bridge,
    });
  }
  return entries;
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

function assertStatusOnlyProfileBinding(context, integrationId) {
  if (context !== DEFAULT_STATUS_CONTEXT) {
    throw new Error(
      `Status-only rulesets require the ${DEFAULT_STATUS_CONTEXT} status context.`,
    );
  }
  if (integrationId !== DEFAULT_STATUS_INTEGRATION_ID) {
    throw new Error(
      `Status-only rulesets require the GitHub Actions source integration id ${DEFAULT_STATUS_INTEGRATION_ID}.`,
    );
  }
}

function assertStatusOnlyProfileOptions({
  context,
  integrationId,
  strict,
  doNotEnforceOnCreate,
}) {
  assertStatusOnlyProfileBinding(context, integrationId);
  if (strict !== true) {
    throw new Error("Status-only rulesets require strict required status checks.");
  }
  if (
    doNotEnforceOnCreate !== undefined &&
    doNotEnforceOnCreate !== false
  ) {
    throw new Error(
      "Status-only rulesets require do_not_enforce_on_create to be false.",
    );
  }
}

function assertStatusOnlyRulesetEnforcement(enforcement) {
  if (!STATUS_ONLY_RULESET_ENFORCEMENTS.has(enforcement)) {
    throw new Error(
      "Status-only ruleset enforcement must be disabled or active.",
    );
  }
}

function normalizeStatusOnlyRequiredStatusRuleForComparison(rule) {
  const normalized = stripRuleForRulesetPayload(rule);
  if (
    normalized.type === "required_status_checks" &&
    normalized.parameters !== undefined &&
    !Object.prototype.hasOwnProperty.call(
      normalized.parameters,
      "do_not_enforce_on_create",
    )
  ) {
    normalized.parameters.do_not_enforce_on_create = false;
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
