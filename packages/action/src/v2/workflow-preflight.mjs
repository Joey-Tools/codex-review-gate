import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

import {
  V2_GIT_LEDGER_BOOTSTRAP_INPUT_SCHEMA,
  V2_GIT_LEDGER_OIDC_AUDIENCE,
  V2_GIT_LEDGER_OIDC_CLAIMS,
  digestV2GitLedgerStableCapabilityAuthorization,
  projectV2GitLedgerStableControllerReleaseAuthorization,
  validateV2GitLedgerBootstrapInput,
  validateV2GitLedgerCapabilityReceipt,
} from "./git-ledger.mjs";
import { assertV2PublicReport } from "./public-report.mjs";
import { deriveV2SelectionProjection } from "./projector.mjs";
import {
  V2_STATUS_TARGET_MODE,
  validateV2WorkflowCommandStructure,
} from "./workflow-command.mjs";

export const V2_WORKFLOW_PREFLIGHT_SCHEMA =
  "codex-review-gate-workflow-preflight-v2";
export const V2_WORKFLOW_PREFLIGHT_SCHEMA_VERSION = 1;
export const V2_WORKFLOW_PREFLIGHT_STATUS_CONTEXT =
  "codex/github-review-gate";
export const V2_WORKFLOW_PREFLIGHT_INTEGRATION_ID = 15368;
export const V2_WORKFLOW_PREFLIGHT_LEDGER_BRANCH =
  "codex-review-gate-ledger-v2";
export const V2_WORKFLOW_PREFLIGHT_LEDGER_REF =
  `refs/heads/${V2_WORKFLOW_PREFLIGHT_LEDGER_BRANCH}`;
export const V2_WORKFLOW_PREFLIGHT_OIDC_ISSUER =
  "https://token.actions.githubusercontent.com";
export const V2_WORKFLOW_PREFLIGHT_OIDC_AUDIENCE =
  V2_GIT_LEDGER_OIDC_AUDIENCE;
export const V2_CODEX_PROVIDER_IDENTITY_AUTHORITY_SCHEMA =
  "codex-review-gate-provider-identity-authority-v2";
export const V2_CODEX_PROVIDER_IDENTITY_POLICY_SCHEMA =
  "codex-review-gate-provider-identity-policy-v2";
export const V2_CODEX_PROVIDER_CATALOG_VERSION = 1;
export const V2_CODEX_PROVIDER_ACTOR = Object.freeze({
  id: "199175422",
  node_id: "BOT_kgDOC98s_g",
  login: "chatgpt-codex-connector[bot]",
  type: "Bot",
});
export const V2_CODEX_PROVIDER_APP = Object.freeze({
  id: "1144995",
  node_id: "A_kwHOAOQ6Gs4AEXij",
  slug: "chatgpt-codex-connector",
});
export const V2_CODEX_PROVIDER_ACTOR_ENDPOINT_PATH =
  "/users/chatgpt-codex-connector%5Bbot%5D";
export const V2_CODEX_PROVIDER_APP_ENDPOINT_PATH =
  "/apps/chatgpt-codex-connector";
export const V2_WORKFLOW_GIT_LEDGER_HANDOFF_SCHEMA =
  "codex-review-gate-workflow-git-ledger-handoff-v2";
export const V2_BLOCKED_CONFIGURATION_WORKFLOW_RESULT_SCHEMA =
  "codex-review-gate-blocked-configuration-workflow-result-v2";

const WORKFLOW_PREFLIGHT_HANDLES = new WeakSet();
const WORKFLOW_GIT_LEDGER_HANDOFF_HANDLES = new WeakSet();
const BLOCKED_CONFIGURATION_WORKFLOW_RESULT_HANDLES = new WeakSet();

const ACTION_REPOSITORY = "Joey-Tools/codex-review-gate-action";
const REUSABLE_WORKFLOW_PATH = ".github/workflows/codex-review-gate.yml";
const WORKFLOW_RECEIPT_SOURCE = "trusted-reusable-workflow";
const WORKFLOW_SOURCE = "github-actions";
const GITHUB_OIDC_VERIFIER_SCHEMA =
  "codex-review-gate-github-oidc-verifier-v2";
const GITHUB_OIDC_DISCOVERY_URL =
  `${V2_WORKFLOW_PREFLIGHT_OIDC_ISSUER}/.well-known/openid-configuration`;
const GITHUB_OIDC_JWKS_URL =
  `${V2_WORKFLOW_PREFLIGHT_OIDC_ISSUER}/.well-known/jwks`;
const CONTROLLER_EVENT_NAMES = Object.freeze([
  "issue_comment",
  "pull_request_review",
  "pull_request_review_comment",
  "pull_request_target",
  "schedule",
  "workflow_dispatch",
]);
const CONTROLLER_PERMISSIONS = Object.freeze({
  contents: "write",
  "id-token": "write",
  issues: "write",
  "pull-requests": "write",
  statuses: "write",
});
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const MAX_ITEMS = 2_000;
const MAX_REQUESTS = 64;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_RESPONSE_BYTES = 16 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const HTTP_DATE =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), [0-3][0-9] (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4} (?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9] GMT$/u;
const JSON_CONTENT_TYPE =
  /^(?:application\/json|application\/vnd\.github\+json)(?:;\s*charset=utf-8)?$/iu;
const SHA = /^[0-9a-f]{40}$/u;
const REPOSITORY_PART = /^[A-Za-z0-9_.-]{1,100}$/u;
const WORKFLOW_FILE = /^\.github\/workflows\/[^/]+\.ya?ml$/u;
const PUBLIC_ENVIRONMENTS = Object.freeze([
  Object.freeze({
    stage: "initial",
    name: "codex-review-gate-public-initial-15m",
  }),
  Object.freeze({
    stage: "post-request",
    name: "codex-review-gate-public-post-request-15m",
  }),
  Object.freeze({
    stage: "no-start",
    name: "codex-review-gate-public-no-start-15m",
  }),
]);

export class V2WorkflowPreflightError extends Error {
  constructor(code, message, details = null, cause = undefined) {
    super(message);
    this.name = "V2WorkflowPreflightError";
    this.code = code;
    this.details = details;
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * Load the live, read-only configuration receipts that a trusted workflow
 * controller needs before it may construct projector state or execute an
 * effect. Event payloads are intentionally absent from this interface.
 */
export function createV2GitHubWorkflowPreflight({
  fetch: fetchImpl,
  token,
  repository,
  restBaseUrl = "https://api.github.com",
}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("workflow preflight fetch must be a function");
  }
  const authorization = boundedString(token, "token", 4096);
  const selectedRepository = normalizeRepository(repository);
  const restBase = normalizeRestBase(restBaseUrl);

  return Object.freeze({
    async load({ command }) {
      const normalizedCommand = validateCommand(command, selectedRepository);
      const client = new ReadOnlyGitHubClient({
        fetchImpl,
        authorization,
        restBase,
      });
      const repoPath = `/repos/${encodeURIComponent(selectedRepository.owner)}/` +
        `${encodeURIComponent(selectedRepository.name)}`;

      const repositoryCapture = await client.get(repoPath, {
        label: "repository identity and permissions",
      });
      const repositoryReceipt = normalizeRepositoryResponse(
        repositoryCapture.data,
        selectedRepository,
      );
      const repositoryEndpointReceipt = structuredClone(
        repositoryCapture.receipt,
      );

      const releaseRepositoryCapture = await client.get(
        `/repos/${ACTION_REPOSITORY.split("/").map(encodeURIComponent).join("/")}`,
        { label: "controller release repository identity" },
      );
      const releaseRepositoryReceipt = normalizeReleaseRepositoryResponse(
        releaseRepositoryCapture.data,
      );
      const appCapture = await client.get("/apps/github-actions", {
        label: "public GitHub Actions App catalog identity",
      });
      const providerAppCapture = await client.get(
        V2_CODEX_PROVIDER_APP_ENDPOINT_PATH,
        { label: "public Codex provider App catalog identity" },
      );
      const providerActorCapture = await client.get(
        V2_CODEX_PROVIDER_ACTOR_ENDPOINT_PATH,
        { label: "public Codex provider actor catalog identity" },
      );
      const providerIdentityAuthority = normalizeProviderIdentityAuthority({
        app: providerAppCapture.data,
        appEndpointReceipt: providerAppCapture.receipt,
        actor: providerActorCapture.data,
        actorEndpointReceipt: providerActorCapture.receipt,
      });
      const oidcSubjectPolicy = await loadOidcSubjectPolicy({
        client,
        repoPath,
        command: normalizedCommand,
      });
      const identityEvidence = normalizeIdentityEvidence({
        app: appCapture.data,
        command: normalizedCommand,
        repository: repositoryReceipt,
        oidcSubjectPolicy,
      });

      const workflowReceipt = await loadCallerWorkflow({
        client,
        repoPath,
        command: normalizedCommand,
      });
      const controllerReleaseReceipt = await loadControllerRelease({
        client,
        command: normalizedCommand,
        callerWorkflow: workflowReceipt,
        releaseRepository: releaseRepositoryReceipt,
      });

      const defaultRules = await client.getArrayPages(
        `${repoPath}/rules/branches/${encodeURIComponent(repositoryReceipt.default_branch)}`,
        { label: "default-branch effective rules" },
      );
      const rulesetReceipt = normalizeRequiredStatusRules(defaultRules.items, {
        command: normalizedCommand,
        releaseRepository: releaseRepositoryReceipt,
      });
      const appReceipt = {
        required: rulesetReceipt.required,
        bound: rulesetReceipt.required && rulesetReceipt.compatible,
        source_matches: rulesetReceipt.required && rulesetReceipt.compatible,
        integration_id: V2_WORKFLOW_PREFLIGHT_INTEGRATION_ID,
        identity_catalog: identityEvidence.app_catalog,
        binding_assurance: rulesetReceipt.workflow_source_pin.compatible
          ? "status-integration-and-required-workflow-source-pin"
          : "required-status-check-integration-id-only",
        proves_exact_workflow_revision:
          rulesetReceipt.workflow_source_pin.compatible,
      };

      const ledgerBranchCapture = await client.get(
        `${repoPath}/branches/${encodeURIComponent(V2_WORKFLOW_PREFLIGHT_LEDGER_BRANCH)}`,
        { label: "protected ledger branch", allowNotFound: true },
      );
      const permissionEvidence = normalizeLedgerPermissionEvidence(
        repositoryReceipt.authenticated_permissions,
      );
      const ledgerRulesetAuthority = await loadLedgerRulesetAuthority({
        client,
        repoPath,
        repository: repositoryReceipt,
      });
      const ledgerBranchReceipt = ledgerBranchCapture.status === 200
        ? await loadPresentLedgerProtection({
            client,
            repoPath,
            branchCapture: ledgerBranchCapture,
            permissionEvidence,
            rulesetAuthority: ledgerRulesetAuthority,
          })
        : await loadBootstrapLedgerProtection({
            branchCapture: ledgerBranchCapture,
            permissionEvidence,
            rulesetAuthority: ledgerRulesetAuthority,
          });

      const publicWaitReceipt = repositoryReceipt.visibility === "public"
        ? await loadPublicWaitReceipt({ client, repoPath })
        : {
            required: false,
            configuration_compatible: true,
            live_canary_required: false,
            live_canary: null,
            production_effects_authorized: false,
            environments: [],
          };

      const serverEnforcement = {
        workflow: {
          present: workflowReceipt.present,
          compatible: workflowReceipt.compatible,
          source: WORKFLOW_RECEIPT_SOURCE,
          path: workflowReceipt.path,
          revision: workflowReceipt.revision,
        },
        ruleset: {
          required: rulesetReceipt.required,
          present: rulesetReceipt.present,
          compatible: rulesetReceipt.compatible,
          status_context: V2_WORKFLOW_PREFLIGHT_STATUS_CONTEXT,
          expected_source: rulesetReceipt.required ? WORKFLOW_SOURCE : "",
          source_id: rulesetReceipt.required
            ? String(V2_WORKFLOW_PREFLIGHT_INTEGRATION_ID)
            : "",
        },
        app: {
          required: appReceipt.required,
          bound: appReceipt.bound,
          source_matches: appReceipt.source_matches,
        },
      };
      const endpointReceipts = client.receipts();
      const gitLedgerCapabilityInput = buildGitLedgerCapabilityInput({
        repository: repositoryReceipt,
        repositoryEndpointReceipt,
        workflow: workflowReceipt,
        ruleset: rulesetReceipt,
        identityEvidence,
        ledgerBranch: ledgerBranchReceipt,
        controllerRelease: controllerReleaseReceipt,
        publicWait: publicWaitReceipt,
        endpointReceipts,
      });
      const configurationProjection = {
        selection_policy: normalizedCommand.selection_policy,
        provider_identity_policy: createProviderIdentityPolicy(),
        repository: repositoryReceipt,
        repository_endpoint_receipt: repositoryEndpointReceipt,
        workflow: workflowReceipt,
        ruleset: rulesetReceipt,
        app: appReceipt,
        identity_evidence: identityEvidence,
        provider_identity_authority: providerIdentityAuthority,
        public_wait: publicWaitReceipt,
        ledger_branch: ledgerBranchReceipt,
        server_enforcement: serverEnforcement,
      };
      const configurationDigest = digestCanonical(
        "codex-review-gate-v2-workflow-preflight-configuration",
        configurationProjection,
      );
      const withoutDigest = {
        schema: V2_WORKFLOW_PREFLIGHT_SCHEMA,
        schema_version: V2_WORKFLOW_PREFLIGHT_SCHEMA_VERSION,
        ...configurationProjection,
        git_ledger_capability_input: gitLedgerCapabilityInput,
        configuration_digest: configurationDigest,
        stability: {
          assurance: "one-complete-capped-preflight-read",
          final_preflight_reread_required: true,
          final_preflight_reread_must_match_configuration_digest: true,
          configuration_digest: configurationDigest,
          production_effects_authorized: false,
        },
        endpoint_receipts: endpointReceipts,
      };
      const receipt = deepFreeze({
        ...withoutDigest,
        receipt_digest: digestCanonical(
          "codex-review-gate-v2-workflow-preflight",
          withoutDigest,
        ),
      });
      WORKFLOW_PREFLIGHT_HANDLES.add(receipt);
      return receipt;
    },
  });
}

/**
 * Require the exact immutable object returned by the live preflight loader.
 * A serialized or caller-resealed receipt remains useful as audit evidence,
 * but it cannot regain controller authority inside another process.
 */
export function assertV2WorkflowPreflightHandle(value) {
  if (
    typeof value !== "object" || value === null ||
    !WORKFLOW_PREFLIGHT_HANDLES.has(value)
  ) {
    throw preflightFailure(
      "UNTRUSTED_PREFLIGHT_HANDLE",
      "workflow preflight authority must come directly from the live loader",
    );
  }
  if (
    value.schema !== V2_WORKFLOW_PREFLIGHT_SCHEMA ||
    value.schema_version !== V2_WORKFLOW_PREFLIGHT_SCHEMA_VERSION
  ) {
    throw preflightFailure(
      "UNTRUSTED_PREFLIGHT_HANDLE",
      "workflow preflight handle has an unsupported schema",
    );
  }
  return value;
}

/**
 * Convert one branded live preflight and one live OIDC trust initialization
 * into the only two inputs accepted by the protected Git-ledger factories.
 * This adapter never seals a capability. An active receipt remains only a
 * validated candidate until createV2GitHubGitLedger.load() proves its exact
 * reachable attestation on the protected ref.
 */
export function createV2WorkflowGitLedgerHandoff(preflightHandle, options = {}) {
  const preflight = assertV2WorkflowPreflightHandle(preflightHandle);
  assertPlainObject(options, "Git-ledger handoff options");
  const allowedOptionKeys = new Set([
    "verifier_initialization",
    "active_capability_receipt",
  ]);
  if (Object.keys(options).some((key) => !allowedOptionKeys.has(key))) {
    throw preflightFailure(
      "INVALID_LEDGER_HANDOFF",
      "Git-ledger handoff options contain an unsupported key",
    );
  }
  const initialization = options.verifier_initialization ?? null;
  const activeCandidate = options.active_capability_receipt ?? null;
  const blockers = [];
  let policy = null;
  if (preflight.workflow.present && !preflight.workflow.compatible) {
    blockers.push("caller-workflow-incompatible");
  }
  if (preflight.ruleset.required && !preflight.ruleset.compatible) {
    blockers.push("required-ruleset-incompatible");
  }
  if (preflight.identity_evidence.oidc_subject_policy.compatible !== true) {
    blockers.push("oidc-subject-policy-incompatible");
  }
  if (initialization === null) {
    blockers.push("oidc-verifier-initialization-required");
  } else if (blockers.length === 0) {
    try {
      policy = deriveWorkflowProvenancePolicy(preflight, initialization);
    } catch (error) {
      if (!(error instanceof V2WorkflowPreflightError)) throw error;
      blockers.push("oidc-verifier-initialization-incompatible");
    }
  }
  const candidate = preflight.git_ledger_capability_input;
  let bootstrapInput = null;
  if (blockers.length === 0) {
    const withoutDigest = {
      schema: V2_GIT_LEDGER_BOOTSTRAP_INPUT_SCHEMA,
      schema_version: 1,
      sealed: false,
      bootstrap_eligible: true,
      current_attestation: false,
      repository: structuredClone(candidate.repository),
      repository_endpoint_receipt:
        structuredClone(candidate.repository_endpoint_receipt),
      ledger_ref: candidate.ledger_ref,
      permissions: structuredClone(candidate.permissions),
      protection: structuredClone(candidate.protection),
      ruleset_receipt: structuredClone(candidate.ruleset_receipt),
      protection_receipt: structuredClone(candidate.protection_receipt),
      controller_release: structuredClone(candidate.controller_release),
      workflow_provenance_policy: structuredClone(policy),
      provider_identity_policy:
        structuredClone(preflight.provider_identity_policy),
      observed_at: laterTimestamp(
        candidate.observed_at,
        initialization.discovery.server_time,
        initialization.jwks.server_time,
      ),
    };
    bootstrapInput = validateV2GitLedgerBootstrapInput({
      ...withoutDigest,
      input_digest: digestCanonical(
        "codex-review-gate-v2-git-ledger-bootstrap-input",
        withoutDigest,
      ),
    }, {
      repository: candidate.repository,
      ledger_ref: candidate.ledger_ref,
    });
  }

  let state = blockers.length === 0 ? "bootstrap" : "blocked";
  let capabilityReceipt = null;
  if (state !== "blocked" && activeCandidate !== null) {
    const normalized = validateV2GitLedgerCapabilityReceipt(activeCandidate, {
      repository: candidate.repository,
      ledger_ref: candidate.ledger_ref,
    });
    if (!activeCapabilityMatchesBootstrap(normalized, bootstrapInput)) {
      blockers.push("active-capability-binding-mismatch");
      state = "blocked";
      bootstrapInput = null;
    } else {
      state = "active";
      capabilityReceipt = normalized;
      bootstrapInput = null;
    }
  }
  const withoutDigest = {
    schema: V2_WORKFLOW_GIT_LEDGER_HANDOFF_SCHEMA,
    schema_version: 1,
    state,
    repository: structuredClone(candidate.repository),
    repository_endpoint_receipt:
      structuredClone(candidate.repository_endpoint_receipt),
    ledger_ref: candidate.ledger_ref,
    preflight_receipt_digest: preflight.receipt_digest,
    blockers: [...new Set(blockers)].sort(),
    workflow_provenance_policy: policy === null
      ? null
      : structuredClone(policy),
    bootstrap_input: bootstrapInput,
    capability_receipt: capabilityReceipt,
  };
  const handoff = deepFreeze({
    ...withoutDigest,
    handoff_digest: digestCanonical(
      "codex-review-gate-v2-workflow-git-ledger-handoff",
      withoutDigest,
    ),
  });
  WORKFLOW_GIT_LEDGER_HANDOFF_HANDLES.add(handoff);
  return handoff;
}

export function assertV2WorkflowGitLedgerHandoffHandle(value) {
  if (
    value === null || typeof value !== "object" ||
    !WORKFLOW_GIT_LEDGER_HANDOFF_HANDLES.has(value) ||
    value.schema !== V2_WORKFLOW_GIT_LEDGER_HANDOFF_SCHEMA ||
    value.schema_version !== 1
  ) {
    throw preflightFailure(
      "UNTRUSTED_LEDGER_HANDOFF_HANDLE",
      "Git-ledger handoff authority must come directly from the branded adapter",
    );
  }
  return value;
}

/**
 * Project one fully observed but incompatible server configuration into the
 * canonical zero-effect public result. This path deliberately cannot turn an
 * OIDC, transport, pagination, or authority failure into a public verdict.
 */
export function createV2BlockedConfigurationWorkflowResult({
  preflight_handle,
  handoff_handle,
}) {
  const preflight = assertV2WorkflowPreflightHandle(preflight_handle);
  const handoff = assertV2WorkflowGitLedgerHandoffHandle(handoff_handle);
  if (
    handoff.state !== "blocked" || handoff.bootstrap_input !== null ||
    handoff.capability_receipt !== null ||
    handoff.preflight_receipt_digest !== preflight.receipt_digest
  ) {
    throw preflightFailure(
      "BLOCKED_CONFIGURATION_AUTHORITY_MISMATCH",
      "blocked configuration result requires the matching blocked ledger handoff",
    );
  }
  const expectedBlockers = [];
  if (preflight.workflow.present && !preflight.workflow.compatible) {
    expectedBlockers.push("caller-workflow-incompatible");
  }
  if (preflight.ruleset.required && !preflight.ruleset.compatible) {
    expectedBlockers.push("required-ruleset-incompatible");
  }
  expectedBlockers.sort();
  if (
    expectedBlockers.length === 0 ||
    canonicalJson(handoff.blockers) !== canonicalJson(expectedBlockers)
  ) {
    throw preflightFailure(
      "BLOCKED_CONFIGURATION_AUTHORITY_MISMATCH",
      "only closed workflow or required-ruleset incompatibility is reportable here",
    );
  }
  const selection = deriveV2SelectionProjection({
    selection_policy: preflight.selection_policy,
    server_enforcement: preflight.server_enforcement,
  }).public_selection;
  if (
    selection.selected !== true ||
    !new Set(["active-ruleset", "workflow"]).has(selection.source)
  ) {
    throw preflightFailure(
      "BLOCKED_CONFIGURATION_SELECTION_MISMATCH",
      "incompatible observed infrastructure must retain server-driven selection",
    );
  }
  const report = assertV2PublicReport({
    schema_version: 2,
    selection: structuredClone(selection),
    server_enforcement: "not-enforced",
    review_epoch: null,
    request_policy: {
      status: "not-applicable",
      warnings: [],
      warning_evidence: { legacy_triple_alias: null },
      request_id: null,
      request_url: null,
      manual: false,
      generation_id: null,
      generation_kind: null,
      generation_index: null,
      automatic_reservations_consumed_on_head: 0,
      manual_requests_in_review_epoch: 0,
      permission_assurance: null,
      request_time_permission: null,
      permission_aba_excluded: null,
    },
    provider_profile: null,
    provider_input_lineage: "unavailable",
    evidence_basis: null,
    status_target: null,
    decision: "blocked-configuration",
    freshness_assurance: "point-in-time",
  });
  const withoutDigest = {
    schema: V2_BLOCKED_CONFIGURATION_WORKFLOW_RESULT_SCHEMA,
    schema_version: 1,
    preflight_receipt_digest: preflight.receipt_digest,
    handoff_digest: handoff.handoff_digest,
    blockers: structuredClone(expectedBlockers),
    decision: "blocked-configuration",
    report: structuredClone(report),
    status_plan: {
      mode: V2_STATUS_TARGET_MODE,
      decision: "blocked-configuration",
      writes: [],
      terminal_cutover: false,
    },
    scheduler_plan: { actions: [], due_at: null },
    writes_performed: false,
    public_effects_performed: 0,
    effect_barrier: "preflight-configuration-blocked",
  };
  const result = deepFreeze({
    ...withoutDigest,
    authority_digest: digestCanonical(
      "codex-review-gate-v2-blocked-configuration-workflow-result",
      withoutDigest,
    ),
  });
  BLOCKED_CONFIGURATION_WORKFLOW_RESULT_HANDLES.add(result);
  return result;
}

export function assertV2BlockedConfigurationWorkflowResultHandle(value) {
  if (
    value === null || typeof value !== "object" ||
    !BLOCKED_CONFIGURATION_WORKFLOW_RESULT_HANDLES.has(value) ||
    value.schema !== V2_BLOCKED_CONFIGURATION_WORKFLOW_RESULT_SCHEMA ||
    value.schema_version !== 1
  ) {
    throw preflightFailure(
      "UNTRUSTED_BLOCKED_CONFIGURATION_RESULT_HANDLE",
      "blocked configuration result must come directly from the branded adapter",
    );
  }
  return value;
}

function deriveWorkflowProvenancePolicy(preflight, initialization) {
  assertPlainObject(initialization, "OIDC verifier initialization");
  exactKeys(initialization, [
    "schema", "schema_version", "discovery", "jwks", "initialized",
  ], "OIDC verifier initialization");
  if (
    initialization.schema !== GITHUB_OIDC_VERIFIER_SCHEMA ||
    initialization.schema_version !== 1 || initialization.initialized !== true
  ) {
    throw preflightFailure(
      "OIDC_VERIFIER_INITIALIZATION_INCOMPATIBLE",
      "OIDC verifier initialization schema is unsupported",
    );
  }
  assertPlainObject(initialization.discovery, "OIDC verifier discovery receipt");
  exactKeys(initialization.discovery, [
    "url", "server_time", "raw_body_sha256", "claims_supported",
  ], "OIDC verifier discovery receipt");
  assertPlainObject(initialization.jwks, "OIDC verifier JWKS receipt");
  exactKeys(initialization.jwks, [
    "url", "server_time", "raw_body_sha256",
  ], "OIDC verifier JWKS receipt");
  if (
    initialization.discovery.url !== GITHUB_OIDC_DISCOVERY_URL ||
    initialization.jwks.url !== GITHUB_OIDC_JWKS_URL
  ) {
    throw preflightFailure(
      "OIDC_VERIFIER_INITIALIZATION_INCOMPATIBLE",
      "OIDC verifier trust endpoints differ from the fixed GitHub endpoints",
    );
  }
  const discoveryTime = timestamp(
    initialization.discovery.server_time,
    "OIDC verifier discovery server_time",
  );
  const jwksTime = timestamp(
    initialization.jwks.server_time,
    "OIDC verifier JWKS server_time",
  );
  if (Date.parse(jwksTime) < Date.parse(discoveryTime)) {
    throw preflightFailure(
      "OIDC_VERIFIER_INITIALIZATION_INCOMPATIBLE",
      "OIDC verifier trust-material server time regressed",
    );
  }
  assertDigest(
    initialization.discovery.raw_body_sha256,
    "OIDC verifier discovery raw_body_sha256",
  );
  assertDigest(
    initialization.jwks.raw_body_sha256,
    "OIDC verifier JWKS raw_body_sha256",
  );
  const claimsSupported = normalizeSortedUniqueStrings(
    initialization.discovery.claims_supported,
    "OIDC verifier claims_supported",
  );
  const requiredClaims = [...V2_GIT_LEDGER_OIDC_CLAIMS].sort();
  if (requiredClaims.some((claim) => !claimsSupported.includes(claim))) {
    throw preflightFailure(
      "OIDC_VERIFIER_INITIALIZATION_INCOMPATIBLE",
      "OIDC discovery omits a protected-ledger claim",
    );
  }
  const currentEvent = preflight.identity_evidence
    .oidc_binding_requirements.event_name;
  if (!CONTROLLER_EVENT_NAMES.includes(currentEvent)) {
    throw preflightFailure(
      "OIDC_EXECUTION_POLICY_INCOMPATIBLE",
      "current controller event is outside the trusted workflow family",
    );
  }
  const defaultRef = `refs/heads/${preflight.repository.default_branch}`;
  if (!preflight.workflow.caller_workflow_ref.endsWith(`@${defaultRef}`)) {
    throw preflightFailure(
      "OIDC_EXECUTION_POLICY_INCOMPATIBLE",
      "caller workflow ref is outside the live default-branch policy",
    );
  }
  const subjectPolicyReceipt = preflight.identity_evidence.oidc_subject_policy;
  assertPlainObject(subjectPolicyReceipt, "preflight OIDC subject policy");
  if (
    subjectPolicyReceipt.compatible !== true ||
    subjectPolicyReceipt.use_default !== false ||
    canonicalJson(subjectPolicyReceipt.include_claim_keys) !==
      canonicalJson(["repo", "job_workflow_ref"])
  ) {
    throw preflightFailure(
      "OIDC_EXECUTION_POLICY_INCOMPATIBLE",
      "preflight lacks the exact stable OIDC subject customization",
    );
  }
  const subject = subjectPolicyReceipt.subject_pattern;
  const release = preflight.git_ledger_capability_input.controller_release;
  const allowedRefs = [defaultRef];
  const subjectPolicyAuthorization = {
    repository: preflight.git_ledger_capability_input.repository,
    subject_pattern: subject,
    use_default: false,
    include_claim_keys: ["repo", "job_workflow_ref"],
    allowed_refs: allowedRefs,
  };
  const executionPolicyAuthorization = {
    controller_release:
      projectV2GitLedgerStableControllerReleaseAuthorization(release),
    requested_permission_booleans: {
      contents_write_requested: CONTROLLER_PERMISSIONS.contents === "write",
      id_token_write_requested: CONTROLLER_PERMISSIONS["id-token"] === "write",
      issues_write_requested: CONTROLLER_PERMISSIONS.issues === "write",
      pull_requests_write_requested:
        CONTROLLER_PERMISSIONS["pull-requests"] === "write",
      statuses_write_requested: CONTROLLER_PERMISSIONS.statuses === "write",
    },
    allowed_event_names: CONTROLLER_EVENT_NAMES,
    allowed_refs: allowedRefs,
    fork_pull_requests_api_only: true,
    candidate_code_execution_blocked: true,
  };
  const replayPolicy = {
    repository: preflight.git_ledger_capability_input.repository,
    ledger_ref: V2_WORKFLOW_PREFLIGHT_LEDGER_REF,
    issuer: V2_WORKFLOW_PREFLIGHT_OIDC_ISSUER,
    audience: V2_WORKFLOW_PREFLIGHT_OIDC_AUDIENCE,
    required_claims: requiredClaims,
  };
  return deepFreeze({
    issuer: V2_WORKFLOW_PREFLIGHT_OIDC_ISSUER,
    audience: V2_WORKFLOW_PREFLIGHT_OIDC_AUDIENCE,
    discovery_url: GITHUB_OIDC_DISCOVERY_URL,
    jwks_uri: GITHUB_OIDC_JWKS_URL,
    algorithm: "RS256",
    required_claims: requiredClaims,
    claims_supported: claimsSupported,
    repository_owner_id: preflight.repository.owner_id,
    subject_pattern: subject,
    subject_pattern_digest: digestCanonical(
      "codex-review-gate-v2-oidc-subject-pattern",
      subject,
    ),
    subject_policy_receipt_digest: digestCanonical(
      "codex-review-gate-v2-oidc-subject-policy",
      subjectPolicyAuthorization,
    ),
    execution_policy_receipt_digest: digestCanonical(
      "codex-review-gate-v2-oidc-execution-policy",
      executionPolicyAuthorization,
    ),
    replay_registry_policy_receipt_digest: digestCanonical(
      "codex-review-gate-v2-oidc-replay-registry-policy",
      replayPolicy,
    ),
    fork_pull_requests_api_only: true,
    candidate_code_execution_blocked: true,
    allowed_event_names: [...CONTROLLER_EVENT_NAMES],
    allowed_refs: allowedRefs,
  });
}

function activeCapabilityMatchesBootstrap(capability, bootstrap) {
  return digestV2GitLedgerStableCapabilityAuthorization(capability) ===
    digestV2GitLedgerStableCapabilityAuthorization(bootstrap);
}

async function loadCallerWorkflow({ client, repoPath, command }) {
  const identity = callerWorkflowIdentity(command);
  const fileName = identity.path.slice(".github/workflows/".length);
  const workflowCapture = await client.get(
    `${repoPath}/actions/workflows/${encodeURIComponent(fileName)}`,
    {
      label: "caller workflow registration",
      allowNotFound: true,
    },
  );
  const contentsPath = identity.path.split("/").map(encodeURIComponent).join("/");
  const contentCapture = await client.get(
    `${repoPath}/contents/${contentsPath}?ref=${encodeURIComponent(identity.revision)}`,
    {
      label: "caller workflow exact contents",
      allowNotFound: true,
      queryAlreadyPresent: true,
    },
  );
  const absent = workflowCapture.status === 404 && contentCapture.status === 404;
  if (absent) {
    const fileReceipt = sealWorkflowFileReceipt({
      role: "caller",
      repository: command.workflow_receipt.caller_repository,
      path: identity.path,
      workflow_ref: command.workflow_receipt.caller_workflow_ref,
      workflow_sha: command.workflow_receipt.caller_workflow_sha,
      registration_endpoint_receipt: workflowCapture.receipt,
      content_endpoint_receipt: contentCapture.receipt,
      present: false,
      blob_sha: null,
      content_sha256: null,
    });
    return {
      present: false,
      compatible: false,
      source: WORKFLOW_RECEIPT_SOURCE,
      path: identity.path,
      revision: identity.revision,
      caller_repository: command.workflow_receipt.caller_repository,
      caller_workflow_ref: command.workflow_receipt.caller_workflow_ref,
      caller_workflow_sha: command.workflow_receipt.caller_workflow_sha,
      called_repository: ACTION_REPOSITORY,
      called_path: REUSABLE_WORKFLOW_PATH,
      called_revision: command.workflow_receipt.revision,
      called_checkout_sha: command.workflow_receipt.checkout_sha,
      state: null,
      workflow_id: null,
      workflow_node_id: null,
      content_blob_sha: null,
      content_sha256: null,
      external_uses: [],
      file_receipt_digest: fileReceipt.receipt_digest,
    };
  }
  // A closed 200/404 pair is configuration evidence, not transport failure.
  // Preserve a registered/content-only or disabled workflow as present but
  // incompatible so selection can remain server-driven and the rich report can
  // explain blocked-configuration. Malformed endpoint payloads still fail in
  // the normalizers below because their authority cannot be established.
  const registration = workflowCapture.status === 200
    ? normalizeWorkflowRegistration(workflowCapture.data, identity.path)
    : null;
  const content = contentCapture.status === 200
    ? normalizeWorkflowContents(contentCapture.data, identity.path)
    : null;
  let externalUses = [];
  let externalUsesClosed = true;
  if (content !== null) {
    try {
      externalUses = parseExternalReusableUses(content.text);
    } catch (error) {
      if (
        !(error instanceof V2WorkflowPreflightError) ||
        error.code !== "WORKFLOW_INCOMPATIBLE"
      ) {
        throw error;
      }
      externalUsesClosed = false;
    }
  }
  const compatible = workflowCapture.status === 200 &&
    contentCapture.status === 200 &&
    registration.state === "active" &&
    externalUsesClosed &&
    externalUses.length > 0 &&
    externalUses.every(
      (use) => use.revision === command.workflow_receipt.revision,
    );
  const fileReceipt = sealWorkflowFileReceipt({
    role: "caller",
    repository: command.workflow_receipt.caller_repository,
    path: identity.path,
    workflow_ref: command.workflow_receipt.caller_workflow_ref,
    workflow_sha: command.workflow_receipt.caller_workflow_sha,
    registration_endpoint_receipt: workflowCapture.receipt,
    content_endpoint_receipt: contentCapture.receipt,
    present: true,
    blob_sha: content?.blob_sha ?? null,
    content_sha256: content === null ? null : rawDigest(content.bytes),
  });
  return {
    present: true,
    compatible,
    source: WORKFLOW_RECEIPT_SOURCE,
    path: identity.path,
    revision: identity.revision,
    caller_repository: command.workflow_receipt.caller_repository,
    caller_workflow_ref: command.workflow_receipt.caller_workflow_ref,
    caller_workflow_sha: command.workflow_receipt.caller_workflow_sha,
    called_repository: ACTION_REPOSITORY,
    called_path: REUSABLE_WORKFLOW_PATH,
    called_revision: command.workflow_receipt.revision,
    called_checkout_sha: command.workflow_receipt.checkout_sha,
    state: registration?.state ?? null,
    workflow_id: registration?.id ?? null,
    workflow_node_id: registration?.node_id ?? null,
    content_blob_sha: content?.blob_sha ?? null,
    content_sha256: content === null ? null : rawDigest(content.bytes),
    external_uses: externalUses,
    file_receipt_digest: fileReceipt.receipt_digest,
  };
}

async function loadControllerRelease({
  client,
  command,
  callerWorkflow,
  releaseRepository,
}) {
  const contentPath = REUSABLE_WORKFLOW_PATH.split("/")
    .map(encodeURIComponent).join("/");
  const capture = await client.get(
    `/repos/${ACTION_REPOSITORY.split("/").map(encodeURIComponent).join("/")}` +
      `/contents/${contentPath}?ref=${encodeURIComponent(command.workflow_receipt.revision)}`,
    {
      label: "exact called reusable workflow release",
      queryAlreadyPresent: true,
    },
  );
  const content = normalizeWorkflowContents(capture.data, REUSABLE_WORKFLOW_PATH);
  const requestedPermissions = parseControllerPermissions(content.text);
  const jobWorkflowRef = `${ACTION_REPOSITORY}/${REUSABLE_WORKFLOW_PATH}@` +
    command.workflow_receipt.revision;
  const jobFileReceipt = sealWorkflowFileReceipt({
    role: "called-reusable",
    repository: ACTION_REPOSITORY,
    path: REUSABLE_WORKFLOW_PATH,
    workflow_ref: jobWorkflowRef,
    workflow_sha: command.workflow_receipt.revision,
    registration_endpoint_receipt: null,
    content_endpoint_receipt: capture.receipt,
    present: true,
    blob_sha: content.blob_sha,
    content_sha256: rawDigest(content.bytes),
  });
  const releaseBase = {
    repository: {
      owner: releaseRepository.owner,
      name: releaseRepository.name,
      id: releaseRepository.id,
    },
    release_sha: command.workflow_receipt.revision,
    workflow_path: REUSABLE_WORKFLOW_PATH,
    workflow_ref: command.workflow_receipt.caller_workflow_ref,
    workflow_sha: command.workflow_receipt.caller_workflow_sha,
    job_workflow_ref: jobWorkflowRef,
    job_workflow_sha: command.workflow_receipt.revision,
    caller_workflow_file_receipt_digest: callerWorkflow.file_receipt_digest,
    job_workflow_file_receipt_digest: jobFileReceipt.receipt_digest,
    requested_permissions: requestedPermissions,
    current: true,
  };
  return deepFreeze({
    ...releaseBase,
    release_receipt_digest: digestCanonical(
      "codex-review-gate-v2-controller-release-observation",
      releaseBase,
    ),
  });
}

function sealWorkflowFileReceipt(value) {
  const withoutDigest = {
    schema: "codex-review-gate-workflow-file-receipt-v2",
    schema_version: 1,
    ...structuredClone(value),
  };
  return deepFreeze({
    ...withoutDigest,
    receipt_digest: digestCanonical(
      "codex-review-gate-v2-workflow-file-receipt",
      withoutDigest,
    ),
  });
}

function parseControllerPermissions(text) {
  const lines = text.split(/\r?\n/u);
  const occurrences = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== "permissions:") continue;
    const permissions = {};
    let cursor = index + 1;
    while (cursor < lines.length) {
      const line = lines[cursor];
      if (line.trim() === "" || /^\s*#/u.test(line)) {
        cursor += 1;
        continue;
      }
      if (!/^  /u.test(line)) break;
      const match = line.match(/^  ([a-z-]+): (read|write|none)\s*$/u);
      if (match === null || Object.hasOwn(permissions, match[1])) {
        throw preflightFailure(
          "CONTROLLER_RELEASE_INCOMPATIBLE",
          "called reusable workflow has a non-closed top-level permissions block",
        );
      }
      permissions[match[1]] = match[2];
      cursor += 1;
    }
    occurrences.push(permissions);
  }
  if (
    occurrences.length !== 1 ||
    canonicalJson(occurrences[0]) !== canonicalJson(CONTROLLER_PERMISSIONS)
  ) {
    throw preflightFailure(
      "CONTROLLER_RELEASE_INCOMPATIBLE",
      "called reusable workflow must request the exact production permission set",
    );
  }
  return deepFreeze(structuredClone(occurrences[0]));
}

function normalizeRequiredStatusRules(items, { command, releaseRepository }) {
  const occurrences = [];
  const workflowPins = [];
  for (const [ruleIndex, rule] of items.entries()) {
    const normalized = normalizeEffectiveRule(rule, ruleIndex);
    if (normalized.type === "workflows") {
      const workflows = normalized.parameters?.workflows;
      if (!Array.isArray(workflows)) {
        throw preflightFailure(
          "WORKFLOW_SOURCE_PIN_INCOMPATIBLE",
          "effective required-workflow rule has no closed workflow inventory",
        );
      }
      for (const [workflowIndex, workflow] of workflows.entries()) {
        assertPlainObject(workflow, `required workflow ${workflowIndex}`);
        if (
          workflow.path !== REUSABLE_WORKFLOW_PATH ||
          positiveDecimal(
            workflow.repository_id,
            `required workflow ${workflowIndex}.repository_id`,
          ) !== releaseRepository.id
        ) {
          continue;
        }
        const candidate = {
          ruleset_id: normalized.ruleset_id,
          ruleset_name: normalized.ruleset_name,
          source_type: normalized.source_type,
          source: normalized.source,
          rule_index: ruleIndex,
          workflow_index: workflowIndex,
          repository: ACTION_REPOSITORY,
          repository_id: releaseRepository.id,
          path: REUSABLE_WORKFLOW_PATH,
          ref: boundedString(
            workflow.ref,
            `required workflow ${workflowIndex}.ref`,
            256,
          ),
          sha: sha(
            workflow.sha,
            `required workflow ${workflowIndex}.sha`,
          ),
        };
        workflowPins.push({
          ...candidate,
          compatible:
            candidate.ref === command.workflow_receipt.revision &&
            candidate.sha === command.workflow_receipt.revision,
        });
      }
    }
    if (normalized.type !== "required_status_checks") continue;
    const checks = normalized.parameters?.required_status_checks;
    if (!Array.isArray(checks)) {
      throw preflightFailure(
        "RULESET_INCOMPATIBLE",
        "effective required-status rule has no closed checks array",
      );
    }
    for (const [checkIndex, check] of checks.entries()) {
      assertPlainObject(check, `required status check ${checkIndex}`);
      if (check.context !== V2_WORKFLOW_PREFLIGHT_STATUS_CONTEXT) continue;
      occurrences.push({
        ruleset_id: normalized.ruleset_id,
        ruleset_name: normalized.ruleset_name,
        source_type: normalized.source_type,
        source: normalized.source,
        rule_index: ruleIndex,
        check_index: checkIndex,
        integration_id: normalizeNullableIntegrationId(check.integration_id),
      });
    }
  }
  if (occurrences.length > 1) {
    throw preflightFailure(
      "RULESET_AMBIGUOUS",
      "fixed status context occurs more than once in effective default-branch rules",
      { occurrences: occurrences.length },
    );
  }
  if (workflowPins.length > 1) {
    throw preflightFailure(
      "WORKFLOW_SOURCE_PIN_AMBIGUOUS",
      "called reusable workflow occurs more than once in effective required-workflow rules",
      { occurrences: workflowPins.length },
    );
  }
  const workflowSourcePin = workflowPins.length === 1
    ? {
        present: true,
        compatible: workflowPins[0].compatible,
        ...workflowPins[0],
      }
    : {
        present: false,
        compatible: false,
        repository: ACTION_REPOSITORY,
        repository_id: releaseRepository.id,
        path: REUSABLE_WORKFLOW_PATH,
        ref: command.workflow_receipt.revision,
        sha: command.workflow_receipt.revision,
      };
  if (occurrences.length === 0) {
    return {
      required: false,
      present: false,
      compatible: false,
      status_context: V2_WORKFLOW_PREFLIGHT_STATUS_CONTEXT,
      expected_source: "",
      source_id: "",
      context_occurrences: 0,
      matching_rules: [],
      source_binding_assurance: "not-required",
      proves_exact_workflow_revision: workflowSourcePin.compatible,
      workflow_source_pin: workflowSourcePin,
    };
  }
  const selected = occurrences[0];
  const compatible =
    selected.integration_id === V2_WORKFLOW_PREFLIGHT_INTEGRATION_ID &&
    workflowSourcePin.compatible;
  return {
    required: true,
    present: true,
    compatible,
    status_context: V2_WORKFLOW_PREFLIGHT_STATUS_CONTEXT,
    expected_source: WORKFLOW_SOURCE,
    source_id: String(V2_WORKFLOW_PREFLIGHT_INTEGRATION_ID),
    context_occurrences: 1,
    matching_rules: [selected],
    source_binding_assurance: compatible
      ? "required-status-check-integration-id"
      : "required-status-check-observed-incompatible",
    proves_exact_workflow_revision: workflowSourcePin.compatible,
    workflow_source_pin: workflowSourcePin,
  };
}

function normalizeLedgerBranch(value) {
  assertPlainObject(value, "ledger branch response");
  if (value.name !== V2_WORKFLOW_PREFLIGHT_LEDGER_BRANCH) {
    throw preflightFailure(
      "LEDGER_BRANCH_UNPROTECTED",
      "ledger branch response has the wrong name",
    );
  }
  assertPlainObject(value.commit, "ledger branch response.commit");
  return {
    branch: V2_WORKFLOW_PREFLIGHT_LEDGER_BRANCH,
    ref: V2_WORKFLOW_PREFLIGHT_LEDGER_REF,
    head_sha: sha(value.commit.sha, "ledger branch response.commit.sha"),
  };
}

async function loadPresentLedgerProtection({
  client,
  repoPath,
  branchCapture,
  permissionEvidence,
  rulesetAuthority,
}) {
  const identity = normalizeLedgerBranch(branchCapture.data);
  const ledgerRules = await client.getArrayPages(
    `${repoPath}/rules/branches/${encodeURIComponent(V2_WORKFLOW_PREFLIGHT_LEDGER_BRANCH)}`,
    { label: "protected ledger effective rules" },
  );
  const normalized = normalizeLedgerProtectionRules(ledgerRules.items, {
    code: "LEDGER_BRANCH_UNPROTECTED",
    label: "ledger branch",
  });
  const authoritativeRulesetIds = new Set(
    rulesetAuthority.ruleset_receipt.ruleset_ids,
  );
  if (normalized.sources.some((source) =>
    !authoritativeRulesetIds.has(source.ruleset_id))) {
    throw preflightFailure(
      "LEDGER_BRANCH_UNPROTECTED",
      "effective ledger protection is not supplied by the exact dedicated ruleset",
    );
  }
  const protection = {
    ...identity,
    present: true,
    bootstrap_eligible: false,
    protection_current: true,
    current_attestation: false,
    attestation_required: true,
    permission_evidence: permissionEvidence,
    rules: normalized.rules,
    sources: normalized.sources,
    ruleset_receipt: rulesetAuthority.ruleset_receipt,
    endpoint_raw_digests: [
      branchCapture.receipt.raw_body_sha256,
      ...ledgerRules.receipts.map((receipt) => receipt.raw_body_sha256),
      ...rulesetAuthority.endpoint_raw_digests,
    ],
  };
  return {
    ...protection,
    protection_digest: digestCanonical(
      "codex-review-gate-v2-ledger-branch-protection",
      protection,
    ),
  };
}

async function loadBootstrapLedgerProtection({
  branchCapture,
  permissionEvidence,
  rulesetAuthority,
}) {
  const protection = {
    branch: V2_WORKFLOW_PREFLIGHT_LEDGER_BRANCH,
    ref: V2_WORKFLOW_PREFLIGHT_LEDGER_REF,
    head_sha: null,
    present: false,
    bootstrap_eligible: true,
    protection_current: false,
    current_attestation: false,
    attestation_required: true,
    permission_evidence: permissionEvidence,
    rules: rulesetAuthority.rules,
    sources: rulesetAuthority.sources,
    ruleset_receipt: rulesetAuthority.ruleset_receipt,
    endpoint_raw_digests: [
      branchCapture.receipt.raw_body_sha256,
      ...rulesetAuthority.endpoint_raw_digests,
    ],
  };
  return {
    ...protection,
    protection_digest: digestCanonical(
      "codex-review-gate-v2-ledger-bootstrap-protection",
      protection,
    ),
  };
}

async function loadLedgerRulesetAuthority({
  client,
  repoPath,
  repository,
}) {
  const inventory = await client.getArrayPages(
    `${repoPath}/rulesets?includes_parents=true`,
    {
      label: "complete ruleset inventory",
      identity: rulesetSummaryIdentity,
    },
  );
  const matching = [];
  const detailReceipts = [];
  for (const [index, rawSummary] of inventory.items.entries()) {
    const summary = normalizeRulesetSummary(rawSummary, index);
    const capture = await client.get(
      `${repoPath}/rulesets/${encodeURIComponent(summary.id)}`,
      { label: `ruleset detail ${summary.id}` },
    );
    detailReceipts.push(capture.receipt);
    const detail = normalizeRulesetDetail(capture.data, summary, index);
    if (rulesetProvablyCoversLedgerRef(detail)) matching.push(detail);
  }
  const ordered = matching.sort((left, right) =>
    BigInt(left.id) < BigInt(right.id) ? -1 :
      BigInt(left.id) > BigInt(right.id) ? 1 : 0);
  const flattenedRules = ordered.flatMap((ruleset) =>
    ruleset.rules.map((rule) => ({
      ...rule,
      enforcement: ruleset.enforcement,
      ruleset_id: ruleset.id,
      ruleset_name: ruleset.name,
      ruleset_source_type: ruleset.source_type,
      ruleset_source: ruleset.source,
    })));
  const normalized = normalizeLedgerProtectionRules(flattenedRules, {
    code: "LEDGER_BOOTSTRAP_INELIGIBLE",
    label: "dedicated ledger ref",
  });
  const configurationDigest = digestCanonical(
    "codex-review-gate-v2-ledger-ruleset-configuration",
    ordered,
  );
  const rulesetIds = ordered.map((ruleset) => ruleset.id);
  const authorityDigest = digestCanonical(
    "codex-review-gate-v2-ledger-ruleset-authority",
    {
      repository_id: repository.id,
      ledger_ref: V2_WORKFLOW_PREFLIGHT_LEDGER_REF,
      ruleset_ids: rulesetIds,
      configuration_digest: configurationDigest,
      target_includes_exact_ref: true,
      deletion_blocked: true,
      non_fast_forward_blocked: true,
      force_pushes_blocked: true,
      bypass_actors_empty: true,
    },
  );
  return deepFreeze({
    rules: normalized.rules,
    sources: normalized.sources,
    ruleset_receipt: {
      receipt_digest: authorityDigest,
      configuration_digest: configurationDigest,
      protection_digest: authorityDigest,
      repository_id: repository.id,
      ledger_ref: V2_WORKFLOW_PREFLIGHT_LEDGER_REF,
      ruleset_ids: rulesetIds,
      target_includes_exact_ref: true,
      deletion_blocked: true,
      non_fast_forward_blocked: true,
      force_pushes_blocked: true,
      bypass_actors_empty: true,
    },
    endpoint_raw_digests: [
      ...inventory.receipts.map((receipt) => receipt.raw_body_sha256),
      ...detailReceipts.map((receipt) => receipt.raw_body_sha256),
    ],
  });
}

function normalizeLedgerPermissionEvidence(permissions) {
  if (permissions.push !== true && permissions.admin !== true) {
    throw preflightFailure(
      "LEDGER_PERMISSION_UNPROVEN",
      "repository API did not observe a write-capable repository role",
    );
  }
  return {
    repository_push_observed: permissions.push,
    repository_admin_observed: permissions.admin,
    assurance: "repository-permission-summary-only",
    proves_exact_contents_write: false,
    proves_minimal_token_scope: false,
    proves_no_additional_writes: false,
  };
}

function buildGitLedgerCapabilityInput({
  repository,
  repositoryEndpointReceipt,
  ledgerBranch,
  controllerRelease,
  endpointReceipts,
}) {
  const release = ledgerControllerRelease(controllerRelease);
  const sourceWorkflowPin = sourceWorkflowFromRelease(release);
  const rulesetReceipt = structuredClone(ledgerBranch.ruleset_receipt);
  const protectionReceiptBase = {
    protection_digest: rulesetReceipt.protection_digest,
    ruleset_receipt_digest: rulesetReceipt.receipt_digest,
    deletion_blocked: true,
    non_fast_forward_blocked: true,
    source_workflow_pinned: true,
  };
  const protectionReceipt = {
    receipt_digest: digestCanonical(
      "codex-review-gate-v2-ledger-protection-receipt",
      protectionReceiptBase,
    ),
    ...protectionReceiptBase,
  };
  const observedAt = endpointReceipts.at(-1)?.server_time;
  const candidate = {
    schema: "codex-review-gate-workflow-git-ledger-candidate-v2",
    schema_version: 1,
    sealed: false,
    bootstrap_eligible: true,
    current_attestation: false,
    repository: {
      owner: repository.owner,
      name: repository.name,
      id: repository.id,
      node_id: repository.node_id,
      owner_id: repository.owner_id,
    },
    repository_endpoint_receipt:
      structuredClone(repositoryEndpointReceipt),
    ledger_ref: V2_WORKFLOW_PREFLIGHT_LEDGER_REF,
    permissions: {
      contents_write_requested:
        controllerRelease.requested_permissions.contents === "write",
      metadata_read_observed: true,
      observed_only: true,
      observation_receipt_digest: digestCanonical(
        "codex-review-gate-v2-permission-observation",
        {
          controller_release_receipt_digest:
            controllerRelease.release_receipt_digest,
          requested_permissions: controllerRelease.requested_permissions,
          repository_permission_summary: ledgerBranch.permission_evidence,
          endpoint_receipts: endpointReceipts,
        },
      ),
    },
    protection: {
      deletion_blocked: ledgerBranch.rules.deletion,
      non_fast_forward_blocked: ledgerBranch.rules.non_fast_forward,
      force_pushes_blocked: ledgerBranch.rules.non_fast_forward,
      live_ruleset_receipt_digest: rulesetReceipt.receipt_digest,
      source_workflow_pin: sourceWorkflowPin,
      accepted_records_restricted_by_oidc_source: true,
    },
    ruleset_receipt: rulesetReceipt,
    protection_receipt: protectionReceipt,
    controller_release: release,
    observed_at: observedAt,
  };
  return deepFreeze({
    ...candidate,
    candidate_material_digest: digestCanonical(
      "codex-review-gate-v2-workflow-git-ledger-candidate",
      candidate,
    ),
  });
}

function ledgerControllerRelease(value) {
  return {
    repository: structuredClone(value.repository),
    release_sha: value.release_sha,
    workflow_path: value.workflow_path,
    workflow_ref: value.workflow_ref,
    workflow_sha: value.workflow_sha,
    job_workflow_ref: value.job_workflow_ref,
    job_workflow_sha: value.job_workflow_sha,
    caller_workflow_file_receipt_digest:
      value.caller_workflow_file_receipt_digest,
    job_workflow_file_receipt_digest: value.job_workflow_file_receipt_digest,
    release_receipt_digest: value.release_receipt_digest,
    current: true,
  };
}

function sourceWorkflowFromRelease(value) {
  const { release_sha: _releaseSha, current: _current, ...source } = value;
  return source;
}

function normalizeLedgerProtectionRules(rules, { code, label }) {
  const required = new Map([
    ["deletion", []],
    ["non_fast_forward", []],
  ]);
  for (const [index, rule] of rules.entries()) {
    const normalized = normalizeEffectiveRule(rule, index);
    if (required.has(normalized.type)) {
      required.get(normalized.type).push({
        type: normalized.type,
        ruleset_id: normalized.ruleset_id,
        ruleset_name: normalized.ruleset_name,
        source_type: normalized.source_type,
        source: normalized.source,
      });
    }
  }
  for (const [type, matches] of required) {
    if (matches.length !== 1) {
      throw preflightFailure(
        code,
        `${label} must have exactly one effective ${type} rule`,
        { type, occurrences: matches.length },
      );
    }
  }
  const sources = [...required.values()].flat();
  return {
    rules: {
      deletion: true,
      non_fast_forward: true,
    },
    sources,
  };
}

function rulesetSummaryIdentity(value) {
  assertPlainObject(value, "ruleset summary");
  return positiveDecimal(value.id, "ruleset summary.id");
}

function normalizeRulesetSummary(value, index) {
  assertPlainObject(value, `ruleset summary ${index}`);
  return {
    id: positiveDecimal(value.id, `ruleset summary ${index}.id`),
    name: boundedString(value.name, `ruleset summary ${index}.name`, 256),
    target: boundedString(value.target, `ruleset summary ${index}.target`, 32),
    source_type: boundedString(
      value.source_type,
      `ruleset summary ${index}.source_type`,
      64,
    ),
    source: boundedString(value.source, `ruleset summary ${index}.source`, 256),
    enforcement: boundedString(
      value.enforcement,
      `ruleset summary ${index}.enforcement`,
      32,
    ),
  };
}

function normalizeRulesetDetail(value, summary, index) {
  assertPlainObject(value, `ruleset detail ${index}`);
  const normalized = normalizeRulesetSummary(value, index);
  for (const key of ["id", "name", "target", "source_type", "source", "enforcement"]) {
    if (normalized[key] !== summary[key]) {
      throw preflightFailure(
        "LEDGER_BOOTSTRAP_INELIGIBLE",
        `ruleset ${summary.id} identity changed between inventory and detail`,
      );
    }
  }
  if (!Array.isArray(value.rules)) {
    throw preflightFailure(
      "LEDGER_BOOTSTRAP_INELIGIBLE",
      `ruleset ${summary.id} has no complete rule inventory`,
    );
  }
  if (!Array.isArray(value.bypass_actors) || value.bypass_actors.length !== 0) {
    throw preflightFailure(
      "LEDGER_BOOTSTRAP_INELIGIBLE",
      `ruleset ${summary.id} must have one closed empty bypass inventory`,
    );
  }
  const rules = value.rules.map((rule, ruleIndex) => {
    assertPlainObject(rule, `ruleset ${summary.id} rule ${ruleIndex}`);
    return {
      type: boundedString(
        rule.type,
        `ruleset ${summary.id} rule ${ruleIndex}.type`,
        128,
      ),
      parameters: rule.parameters ?? null,
    };
  });
  const refName = value.conditions?.ref_name;
  if (normalized.target === "branch" && normalized.enforcement === "active") {
    assertPlainObject(value.conditions, `ruleset ${summary.id}.conditions`);
    assertPlainObject(refName, `ruleset ${summary.id}.conditions.ref_name`);
    if (!Array.isArray(refName.include) || !Array.isArray(refName.exclude)) {
      throw preflightFailure(
        "LEDGER_BOOTSTRAP_INELIGIBLE",
        `ruleset ${summary.id} has no closed ref-name condition`,
      );
    }
  }
  return {
    ...normalized,
    ref_name: normalized.target === "branch" && normalized.enforcement === "active"
      ? {
          include: refName.include.map((entry, entryIndex) => boundedString(
            entry,
            `ruleset ${summary.id} include ${entryIndex}`,
            512,
          )),
          exclude: refName.exclude.map((entry, entryIndex) => boundedString(
            entry,
            `ruleset ${summary.id} exclude ${entryIndex}`,
            512,
          )),
        }
      : null,
    rules,
    bypass_actors: [],
  };
}

function rulesetProvablyCoversLedgerRef(ruleset) {
  if (ruleset.target !== "branch" || ruleset.enforcement !== "active") return false;
  // The ledger authority must come from a dedicated exact-ref ruleset. A
  // default-branch or repository-wide ~ALL rule is useful defense in depth,
  // but it is not a substitute for this future-ref protection contract.
  return ruleset.ref_name.exclude.length === 0 &&
    ruleset.ref_name.include.length === 1 &&
    ruleset.ref_name.include[0] === V2_WORKFLOW_PREFLIGHT_LEDGER_REF &&
    ruleset.bypass_actors.length === 0;
}

async function loadPublicWaitReceipt({ client, repoPath }) {
  const inventory = await client.getObjectPages(
    `${repoPath}/environments`,
    {
      label: "repository environments",
      arrayKey: "environments",
      countKey: "total_count",
    },
  );
  const expectedNames = new Set(PUBLIC_ENVIRONMENTS.map(({ name }) => name));
  const inventoryByName = new Map();
  const unrelated = [];
  for (const item of inventory.items) {
    assertPlainObject(item, "environment inventory item");
    const name = boundedString(item.name, "environment inventory item.name", 255);
    const id = positiveDecimal(item.id, "environment inventory item.id");
    if (inventoryByName.has(name)) {
      throw preflightFailure(
        "PUBLIC_WAIT_INCOMPATIBLE",
        "environment inventory repeats a name",
      );
    }
    inventoryByName.set(name, { id });
    if (!expectedNames.has(name)) unrelated.push({ name, id });
  }
  if (
    PUBLIC_ENVIRONMENTS.some(({ name }) => !inventoryByName.has(name))
  ) {
    throw preflightFailure(
      "PUBLIC_WAIT_INCOMPATIBLE",
      "public repository is missing a fixed wait environment",
    );
  }

  const environments = [];
  for (const expected of PUBLIC_ENVIRONMENTS) {
    const capture = await client.get(
      `${repoPath}/environments/${encodeURIComponent(expected.name)}`,
      { label: `wait environment ${expected.stage}` },
    );
    const detail = normalizeEnvironmentDetail(capture.data, expected);
    if (detail.id !== inventoryByName.get(expected.name).id) {
      throw preflightFailure(
        "PUBLIC_WAIT_INCOMPATIBLE",
        `wait environment ${expected.stage} changed identity after inventory`,
      );
    }
    environments.push(detail);
  }
  return {
    required: true,
    configuration_compatible: true,
    live_canary_required: true,
    live_canary: null,
    production_effects_authorized: false,
    inventory_count: inventoryByName.size,
    unrelated_environments: unrelated.sort((left, right) =>
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
    environments,
  };
}

function normalizeEnvironmentDetail(value, expected) {
  assertPlainObject(value, `wait environment ${expected.stage}`);
  if (value.name !== expected.name) {
    throw preflightFailure(
      "PUBLIC_WAIT_INCOMPATIBLE",
      `wait environment ${expected.stage} returned the wrong name`,
    );
  }
  const id = positiveDecimal(value.id, `wait environment ${expected.stage}.id`);
  if (!Array.isArray(value.protection_rules)) {
    throw preflightFailure(
      "PUBLIC_WAIT_INCOMPATIBLE",
      `wait environment ${expected.stage} has no protection-rule inventory`,
    );
  }
  const waitRules = value.protection_rules.filter((rule) => rule?.type === "wait_timer");
  if (waitRules.length !== 1) {
    throw preflightFailure(
      "PUBLIC_WAIT_INCOMPATIBLE",
      `wait environment ${expected.stage} must have exactly one wait timer`,
      { occurrences: waitRules.length },
    );
  }
  const waitRule = waitRules[0];
  assertPlainObject(waitRule, `wait environment ${expected.stage} wait timer`);
  if (waitRule.wait_timer !== 15) {
    throw preflightFailure(
      "PUBLIC_WAIT_INCOMPATIBLE",
      `wait environment ${expected.stage} timer must be exactly 15 minutes`,
    );
  }
  return {
    stage: expected.stage,
    name: expected.name,
    id,
    wait_timer_rule_id: positiveDecimal(
      waitRule.id,
      `wait environment ${expected.stage} wait timer.id`,
    ),
    wait_timer_minutes: 15,
  };
}

class ReadOnlyGitHubClient {
  constructor({ fetchImpl, authorization, restBase }) {
    this.fetchImpl = fetchImpl;
    this.authorization = authorization;
    this.restBase = restBase;
    this.requestCount = 0;
    this.totalBytes = 0;
    this.endpointReceipts = [];
    this.lastServerTime = null;
  }

  receipts() {
    return structuredClone(this.endpointReceipts);
  }

  async getArrayPages(path, { label, identity = effectiveRuleIdentity }) {
    const items = [];
    const receipts = [];
    const identities = new Set();
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const separator = path.includes("?") ? "&" : "?";
      const capture = await this.get(
        `${path}${separator}per_page=${PAGE_SIZE}&page=${page}`,
        { label: `${label} page ${page}`, queryAlreadyPresent: true },
      );
      if (!Array.isArray(capture.data)) {
        throw preflightFailure(
          "PAGINATION_INCOMPLETE",
          `${label} page ${page} was not an array`,
        );
      }
      receipts.push(capture.receipt);
      for (const item of capture.data) {
        const itemIdentity = identity(item);
        if (identities.has(itemIdentity)) {
          throw preflightFailure(
            "PAGINATION_INCOMPLETE",
            `${label} repeats an effective rule across pages`,
          );
        }
        identities.add(itemIdentity);
        items.push(item);
        if (items.length > MAX_ITEMS) {
          throw preflightFailure(
            "PAGINATION_INCOMPLETE",
            `${label} exceeds the ${MAX_ITEMS}-item cap`,
          );
        }
      }
      if (capture.data.length < PAGE_SIZE) {
        return { items, receipts };
      }
    }
    throw preflightFailure(
      "PAGINATION_INCOMPLETE",
      `${label} exceeds the ${MAX_PAGES}-page cap`,
    );
  }

  async getObjectPages(path, { label, arrayKey, countKey }) {
    const items = [];
    let expectedCount = null;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const capture = await this.get(
        `${path}?per_page=${PAGE_SIZE}&page=${page}`,
        { label: `${label} page ${page}`, queryAlreadyPresent: true },
      );
      assertPlainObject(capture.data, `${label} page ${page}`);
      const count = nonNegativeInteger(capture.data[countKey], `${label}.${countKey}`);
      if (expectedCount === null) expectedCount = count;
      if (expectedCount !== count || !Array.isArray(capture.data[arrayKey])) {
        throw preflightFailure(
          "PAGINATION_INCOMPLETE",
          `${label} count or item shape changed across pages`,
        );
      }
      items.push(...capture.data[arrayKey]);
      if (items.length > MAX_ITEMS || items.length > expectedCount) {
        throw preflightFailure(
          "PAGINATION_INCOMPLETE",
          `${label} inventory exceeds its declared or bounded count`,
        );
      }
      if (items.length === expectedCount) return { items };
      if (capture.data[arrayKey].length < PAGE_SIZE) {
        throw preflightFailure(
          "PAGINATION_INCOMPLETE",
          `${label} ended before its declared count`,
        );
      }
    }
    throw preflightFailure(
      "PAGINATION_INCOMPLETE",
      `${label} exceeds the ${MAX_PAGES}-page cap`,
    );
  }

  async get(path, {
    label,
    allowNotFound = false,
    queryAlreadyPresent: _queryAlreadyPresent = false,
  }) {
    if (this.requestCount >= MAX_REQUESTS) {
      throw preflightFailure(
        "HTTP_UNREADABLE",
        `workflow preflight exhausted its ${MAX_REQUESTS}-request cap`,
      );
    }
    this.requestCount += 1;
    const url = new URL(`${this.restBase}${path}`);
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error(`${label} timed out`)),
      REQUEST_TIMEOUT_MS,
    );
    let response;
    let rawBody;
    try {
      response = await this.fetchImpl(url.href, {
        method: "GET",
        redirect: "error",
        signal: controller.signal,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.authorization}`,
          "User-Agent": "codex-review-gate-v2-workflow-preflight",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (
        response === null || typeof response !== "object" ||
        !Number.isInteger(response.status) ||
        typeof response.text !== "function" ||
        typeof response.headers?.get !== "function"
      ) {
        throw preflightFailure(
          "HTTP_UNREADABLE",
          `${label} did not return a Response-compatible object`,
        );
      }
      const declaredLength = parseContentLength(response.headers.get("content-length"));
      if (declaredLength !== null && declaredLength > MAX_RESPONSE_BYTES) {
        throw preflightFailure("HTTP_UNREADABLE", `${label} response is too large`);
      }
      const contentType = response.headers.get("content-type");
      if (typeof contentType !== "string" ||
          !JSON_CONTENT_TYPE.test(contentType.trim())) {
        throw preflightFailure(
          "HTTP_UNREADABLE",
          `${label} response has a noncanonical JSON Content-Type`,
        );
      }
      rawBody = await response.text();
    } catch (error) {
      if (error instanceof V2WorkflowPreflightError) throw error;
      throw preflightFailure(
        "HTTP_UNREADABLE",
        `${label} request failed`,
        null,
        error,
      );
    } finally {
      clearTimeout(timer);
    }
    const bytes = Buffer.from(rawBody, "utf8");
    if (bytes.length === 0 || bytes.length > MAX_RESPONSE_BYTES ||
        this.totalBytes + bytes.length > MAX_TOTAL_RESPONSE_BYTES) {
      throw preflightFailure(
        "HTTP_UNREADABLE",
        `${label} response violates the bounded non-empty body policy`,
      );
    }
    this.totalBytes += bytes.length;
    const serverTime = normalizeServerDate(response.headers.get("date"), label);
    if (this.lastServerTime !== null &&
        Date.parse(serverTime) < Date.parse(this.lastServerTime)) {
      throw preflightFailure(
        "HTTP_UNREADABLE",
        `${label} server Date regressed during preflight`,
      );
    }
    this.lastServerTime = serverTime;
    const receipt = {
      method: "GET",
      path: `${url.pathname}${url.search}`,
      status: response.status,
      server_time: serverTime,
      raw_body_sha256: rawDigest(bytes),
    };
    this.endpointReceipts.push(receipt);
    const allowed = response.status === 200 ||
      (allowNotFound && response.status === 404);
    if (!allowed) {
      throw preflightFailure(
        response.status === 404 ? "NOT_FOUND" : "HTTP_UNREADABLE",
        `${label} returned unexpected HTTP ${response.status}`,
        { status: response.status },
      );
    }
    let data;
    try {
      data = JSON.parse(rawBody);
    } catch (error) {
      throw preflightFailure(
        "HTTP_UNREADABLE",
        `${label} response is not JSON`,
        null,
        error,
      );
    }
    return {
      data,
      status: response.status,
      raw_body: rawBody,
      receipt,
    };
  }
}

function validateCommand(value, repository) {
  let command;
  try {
    command = validateV2WorkflowCommandStructure(value);
  } catch (error) {
    throw preflightFailure(
      "INVALID_COMMAND",
      "workflow command fails the closed structural contract",
      null,
      error,
    );
  }

  const commandRepository = normalizeRepository(command.repository);
  if (canonicalJson(commandRepository) !== canonicalJson(repository)) {
    throw preflightFailure(
      "REPOSITORY_MISMATCH",
      "workflow command repository differs from the preflight repository",
    );
  }
  if (
    command.workflow_receipt.present !== true ||
    command.workflow_receipt.compatible !== true ||
    command.workflow_receipt.source !== WORKFLOW_RECEIPT_SOURCE ||
    command.workflow_receipt.repository !== ACTION_REPOSITORY ||
    command.workflow_receipt.path !== REUSABLE_WORKFLOW_PATH ||
    command.workflow_receipt.status_context !==
      V2_WORKFLOW_PREFLIGHT_STATUS_CONTEXT ||
    command.workflow_receipt.status_target_mode !== V2_STATUS_TARGET_MODE
  ) {
    throw preflightFailure(
      "INVALID_COMMAND",
      "workflow command does not bind the fixed reusable workflow contract",
    );
  }
  if (command.workflow_receipt.caller_repository !==
      `${repository.owner}/${repository.name}`) {
    throw preflightFailure(
      "REPOSITORY_MISMATCH",
      "workflow command caller repository differs from its target repository",
    );
  }
  return structuredClone(command);
}

function callerWorkflowIdentity(command) {
  const prefix = `${command.workflow_receipt.caller_repository}/`;
  const value = command.workflow_receipt.caller_workflow_ref;
  if (typeof value !== "string" || !value.startsWith(prefix)) {
    throw preflightFailure(
      "INVALID_COMMAND",
      "caller workflow ref is outside the selected repository",
    );
  }
  const separator = value.lastIndexOf("@");
  const path = value.slice(prefix.length, separator);
  if (separator <= prefix.length || !WORKFLOW_FILE.test(path)) {
    throw preflightFailure("INVALID_COMMAND", "caller workflow ref path is not canonical");
  }
  return {
    path,
    revision: command.workflow_receipt.caller_workflow_sha,
  };
}

function normalizeRepositoryResponse(value, selected) {
  assertPlainObject(value, "repository response");
  if (typeof value.full_name !== "string" ||
      value.full_name.toLowerCase() !==
        `${selected.owner}/${selected.name}`.toLowerCase()) {
    throw preflightFailure(
      "REPOSITORY_MISMATCH",
      "repository API identity differs from the selected repository",
    );
  }
  const visibility = enumValue(
    value.visibility,
    new Set(["public", "private"]),
    "repository response.visibility",
  );
  if (typeof value.private !== "boolean" ||
      value.private !== (visibility === "private")) {
    throw preflightFailure(
      "REPOSITORY_MISMATCH",
      "repository visibility and private flag disagree",
    );
  }
  assertPlainObject(value.permissions, "repository response.permissions");
  assertPlainObject(value.owner, "repository response.owner");
  const ownerId = positiveDecimal(value.owner.id, "repository response.owner.id");
  const ownerLogin = boundedString(
    value.owner.login,
    "repository response.owner.login",
    100,
  );
  if (ownerLogin.toLowerCase() !== selected.owner.toLowerCase()) {
    throw preflightFailure(
      "REPOSITORY_MISMATCH",
      "repository API owner identity differs from the selected repository",
    );
  }
  const authenticatedPermissions = {
    admin: boolean(value.permissions.admin, "repository permissions.admin"),
    maintain: boolean(value.permissions.maintain, "repository permissions.maintain"),
    push: boolean(value.permissions.push, "repository permissions.push"),
    triage: boolean(value.permissions.triage, "repository permissions.triage"),
    pull: boolean(value.permissions.pull, "repository permissions.pull"),
  };
  return {
    owner: selected.owner,
    name: selected.name,
    id: positiveDecimal(value.id, "repository response.id"),
    node_id: boundedString(value.node_id, "repository response.node_id", 256),
    owner_id: ownerId,
    visibility,
    default_branch: boundedString(
      value.default_branch,
      "repository response.default_branch",
      255,
    ),
    authenticated_permissions: authenticatedPermissions,
  };
}

function normalizeReleaseRepositoryResponse(value) {
  assertPlainObject(value, "controller release repository response");
  if (value.full_name !== ACTION_REPOSITORY) {
    throw preflightFailure(
      "WORKFLOW_SOURCE_PIN_INCOMPATIBLE",
      "controller release repository identity differs from the fixed repository",
    );
  }
  return {
    owner: "Joey-Tools",
    name: "codex-review-gate-action",
    id: positiveDecimal(value.id, "controller release repository response.id"),
    node_id: boundedString(
      value.node_id,
      "controller release repository response.node_id",
      256,
    ),
  };
}

async function loadOidcSubjectPolicy({ client, repoPath, command }) {
  const capture = await client.get(
    `${repoPath}/actions/oidc/customization/sub`,
    {
      label: "repository OIDC subject customization",
      allowNotFound: true,
    },
  );
  if (capture.status === 404) {
    const withoutDigest = {
      compatible: false,
      use_default: null,
      include_claim_keys: [],
      subject_pattern: null,
      endpoint_receipt: capture.receipt,
    };
    return deepFreeze({
      ...withoutDigest,
      receipt_digest: digestCanonical(
        "codex-review-gate-v2-oidc-subject-policy-observation",
        withoutDigest,
      ),
    });
  }
  assertPlainObject(capture.data, "repository OIDC subject customization");
  exactKeys(capture.data, [
    "use_default", "include_claim_keys",
  ], "repository OIDC subject customization");
  if (!Array.isArray(capture.data.include_claim_keys)) {
    throw preflightFailure(
      "OIDC_SUBJECT_POLICY_INCOMPATIBLE",
      "repository OIDC subject claim inventory is unreadable",
    );
  }
  const compatible = capture.data.use_default === false &&
    canonicalJson(capture.data.include_claim_keys) ===
      canonicalJson(["repo", "job_workflow_ref"]);
  const jobWorkflowRef = `${ACTION_REPOSITORY}/${REUSABLE_WORKFLOW_PATH}@` +
    command.workflow_receipt.revision;
  const subjectPattern = `repo:${command.workflow_receipt.caller_repository}:` +
    `job_workflow_ref:${jobWorkflowRef}`;
  const withoutDigest = {
    compatible,
    use_default: capture.data.use_default,
    include_claim_keys: structuredClone(capture.data.include_claim_keys),
    subject_pattern: compatible ? subjectPattern : null,
    endpoint_receipt: capture.receipt,
  };
  return deepFreeze({
    ...withoutDigest,
    receipt_digest: digestCanonical(
      "codex-review-gate-v2-oidc-subject-policy-observation",
      withoutDigest,
    ),
  });
}

function normalizeProviderIdentityAuthority({
  app,
  appEndpointReceipt,
  actor,
  actorEndpointReceipt,
}) {
  assertPlainObject(app, "Codex provider App response");
  assertPlainObject(actor, "Codex provider actor response");
  const normalizedApp = {
    id: positiveDecimal(app.id, "Codex provider App response.id"),
    node_id: boundedString(
      app.node_id,
      "Codex provider App response.node_id",
      256,
    ),
    slug: boundedString(app.slug, "Codex provider App response.slug", 128),
  };
  const normalizedActor = {
    id: positiveDecimal(actor.id, "Codex provider actor response.id"),
    node_id: boundedString(
      actor.node_id,
      "Codex provider actor response.node_id",
      256,
    ),
    login: boundedString(
      actor.login,
      "Codex provider actor response.login",
      128,
    ),
    type: boundedString(actor.type, "Codex provider actor response.type", 32),
  };
  if (canonicalJson(normalizedApp) !== canonicalJson(V2_CODEX_PROVIDER_APP) ||
      canonicalJson(normalizedActor) !== canonicalJson(V2_CODEX_PROVIDER_ACTOR)) {
    throw preflightFailure(
      "PROVIDER_IDENTITY_CATALOG_MISMATCH",
      "live Codex provider identity differs from the pinned catalog version",
      { catalog_version: V2_CODEX_PROVIDER_CATALOG_VERSION },
    );
  }
  const withoutDigest = {
    schema: V2_CODEX_PROVIDER_IDENTITY_AUTHORITY_SCHEMA,
    schema_version: 1,
    catalog_version: V2_CODEX_PROVIDER_CATALOG_VERSION,
    actor: normalizedActor,
    app: normalizedApp,
    actor_endpoint_receipt: structuredClone(actorEndpointReceipt),
    app_endpoint_receipt: structuredClone(appEndpointReceipt),
    actor_endpoint_receipt_digest: digestCanonical(
      "codex-review-gate-v2-provider-actor-endpoint-receipt",
      actorEndpointReceipt,
    ),
    app_endpoint_receipt_digest: digestCanonical(
      "codex-review-gate-v2-provider-app-endpoint-receipt",
      appEndpointReceipt,
    ),
  };
  const providerIdentityPolicy = createProviderIdentityPolicy();
  return deepFreeze({
    ...withoutDigest,
    catalog_digest: providerIdentityPolicy.catalog_digest,
    identity_digest: digestCanonical(
      "codex-review-gate-v2-provider-identity-authority",
      withoutDigest,
    ),
  });
}

function createProviderIdentityPolicy() {
  const withoutDigest = {
    schema: V2_CODEX_PROVIDER_IDENTITY_POLICY_SCHEMA,
    schema_version: 1,
    catalog_version: V2_CODEX_PROVIDER_CATALOG_VERSION,
    actor: structuredClone(V2_CODEX_PROVIDER_ACTOR),
    app: structuredClone(V2_CODEX_PROVIDER_APP),
    actor_endpoint_path: V2_CODEX_PROVIDER_ACTOR_ENDPOINT_PATH,
    app_endpoint_path: V2_CODEX_PROVIDER_APP_ENDPOINT_PATH,
  };
  return deepFreeze({
    ...withoutDigest,
    catalog_digest: digestCanonical(
      "codex-review-gate-v2-provider-identity-policy",
      withoutDigest,
    ),
  });
}

function normalizeIdentityEvidence({
  app,
  command,
  repository,
  oidcSubjectPolicy,
}) {
  assertPlainObject(app, "GitHub Actions App response");
  const normalizedApp = {
    id: positiveDecimal(app.id, "GitHub Actions App response.id"),
    node_id: boundedString(app.node_id, "GitHub Actions App response.node_id", 256),
    slug: boundedString(app.slug, "GitHub Actions App response.slug", 128),
  };
  if (
    normalizedApp.id !== String(V2_WORKFLOW_PREFLIGHT_INTEGRATION_ID) ||
    normalizedApp.slug !== "github-actions"
  ) {
    throw preflightFailure(
      "APP_SOURCE_MISMATCH",
      "live GitHub Actions App identity differs from the fixed integration",
    );
  }
  return {
    triggering_actor_id_claim: positiveDecimal(
      command.invocation.actor_id,
      "workflow command actor_id",
    ),
    app_catalog: normalizedApp,
    assurance: "trusted-trigger-claim-plus-public-app-catalog-only",
    proves_current_token_identity: false,
    oidc_provenance_required: true,
    oidc_provenance: null,
    oidc_subject_policy: structuredClone(oidcSubjectPolicy),
    oidc_binding_requirements: {
      issuer: V2_WORKFLOW_PREFLIGHT_OIDC_ISSUER,
      audience: V2_WORKFLOW_PREFLIGHT_OIDC_AUDIENCE,
      repository_id: repository.id,
      repository: command.workflow_receipt.caller_repository,
      workflow_ref: command.workflow_receipt.caller_workflow_ref,
      workflow_sha: command.workflow_receipt.caller_workflow_sha,
      job_workflow_ref:
        `${ACTION_REPOSITORY}/${REUSABLE_WORKFLOW_PATH}@` +
        command.workflow_receipt.revision,
      job_workflow_sha: command.workflow_receipt.checkout_sha,
      run_id: command.invocation.run_id,
      run_attempt: command.invocation.run_attempt,
      event_name: command.invocation.event_name,
      ref: null,
      repository_id_source: "live-repository-receipt",
      ref_source: "trusted-job-context-required",
    },
  };
}

function normalizeWorkflowRegistration(value, expectedPath) {
  assertPlainObject(value, "workflow registration response");
  if (value.path !== expectedPath) {
    throw preflightFailure(
      "WORKFLOW_INCOMPATIBLE",
      "workflow registration path differs from the caller workflow path",
    );
  }
  return {
    id: positiveDecimal(value.id, "workflow registration response.id"),
    node_id: boundedString(
      value.node_id,
      "workflow registration response.node_id",
      256,
    ),
    state: boundedString(value.state, "workflow registration response.state", 64),
  };
}

function normalizeWorkflowContents(value, expectedPath) {
  assertPlainObject(value, "workflow contents response");
  if (value.type !== "file" || value.path !== expectedPath ||
      value.encoding !== "base64") {
    throw preflightFailure(
      "WORKFLOW_INCOMPATIBLE",
      "workflow contents response is not the exact registered file",
    );
  }
  const encoded = boundedString(
    value.content,
    "workflow contents response.content",
    2 * 1024 * 1024,
  );
  if (/[^A-Za-z0-9+/=\r\n]/u.test(encoded)) {
    throw preflightFailure("WORKFLOW_INCOMPATIBLE", "workflow content is not base64");
  }
  const compact = encoded.replace(/[\r\n]/gu, "");
  const bytes = Buffer.from(compact, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== compact) {
    throw preflightFailure(
      "WORKFLOW_INCOMPATIBLE",
      "workflow content is empty or non-canonical base64",
    );
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw preflightFailure(
      "WORKFLOW_INCOMPATIBLE",
      "workflow content is not UTF-8",
      null,
      error,
    );
  }
  return {
    text,
    bytes,
    blob_sha: sha(value.sha, "workflow contents response.sha"),
  };
}

function parseExternalReusableUses(text) {
  const target = `${ACTION_REPOSITORY}/${REUSABLE_WORKFLOW_PATH}@`;
  const targetPath = `${ACTION_REPOSITORY}/${REUSABLE_WORKFLOW_PATH}`;
  const matches = [];
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (!line.includes(targetPath) || /^\s*#/u.test(line)) continue;
    const parsed = line.match(
      /^\s*uses:\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))(?:\s+#.*)?\s*$/u,
    );
    const value = parsed?.[1] ?? parsed?.[2] ?? parsed?.[3] ?? null;
    if (value === null || !value.startsWith(target)) {
      throw preflightFailure(
        "WORKFLOW_INCOMPATIBLE",
        "reusable workflow reference is not one canonical external uses value",
        { line: index + 1 },
      );
    }
    const revision = value.slice(target.length);
    if (!SHA.test(revision)) {
      throw preflightFailure(
        "WORKFLOW_INCOMPATIBLE",
        "caller workflow reusable revision is not one lowercase SHA-1",
        { line: index + 1 },
      );
    }
    matches.push({
      line: index + 1,
      repository: ACTION_REPOSITORY,
      path: REUSABLE_WORKFLOW_PATH,
      revision,
    });
  }
  return matches;
}

function normalizeEffectiveRule(value, index) {
  assertPlainObject(value, `effective rule ${index}`);
  const enforcement = value.enforcement === undefined
    ? "effective"
    : boundedString(
        value.enforcement,
        `effective rule ${index}.enforcement`,
        32,
      );
  if (enforcement !== "active" && enforcement !== "effective") {
    throw preflightFailure(
      "RULESET_INCOMPATIBLE",
      "effective rule inventory contains a non-active rule",
    );
  }
  return {
    type: boundedString(value.type, `effective rule ${index}.type`, 128),
    ruleset_id: positiveDecimal(value.ruleset_id, `effective rule ${index}.ruleset_id`),
    ruleset_name: value.ruleset_name === undefined
      ? null
      : boundedString(
          value.ruleset_name,
          `effective rule ${index}.ruleset_name`,
          256,
        ),
    source_type: boundedString(
      value.ruleset_source_type,
      `effective rule ${index}.ruleset_source_type`,
      64,
    ),
    source: boundedString(
      value.ruleset_source,
      `effective rule ${index}.ruleset_source`,
      256,
    ),
    parameters: value.parameters ?? null,
  };
}

function effectiveRuleIdentity(value) {
  assertPlainObject(value, "effective rule");
  return `${String(value.ruleset_id)}\0${String(value.type)}`;
}

function normalizeNullableIntegrationId(value) {
  if (value === undefined || value === null) return null;
  const number = typeof value === "string" && /^[0-9]+$/u.test(value)
    ? Number(value)
    : value;
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw preflightFailure(
      "RULESET_INCOMPATIBLE",
      "required status check integration_id is invalid",
    );
  }
  return number;
}

function normalizeRepository(value) {
  if (typeof value === "string") {
    const parts = value.split("/");
    if (parts.length !== 2) {
      throw new TypeError("repository must be one owner/name");
    }
    value = { owner: parts[0], name: parts[1] };
  }
  assertPlainObject(value, "repository");
  exactKeys(value, ["owner", "name"], "repository");
  if (!REPOSITORY_PART.test(value.owner) || !REPOSITORY_PART.test(value.name)) {
    throw new TypeError("repository must contain canonical GitHub path parts");
  }
  return { owner: value.owner, name: value.name };
}

function normalizeRestBase(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new TypeError("restBaseUrl must be one absolute HTTPS URL", { cause: error });
  }
  if (
    parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" ||
    parsed.port !== "" || parsed.search !== "" || parsed.hash !== "" ||
    !["", "/"].includes(parsed.pathname) ||
    !["api.github.com", "api.github.test"].includes(parsed.hostname)
  ) {
    throw new TypeError("restBaseUrl must be the canonical credential-free GitHub API origin");
  }
  return parsed.href.replace(/\/$/u, "");
}

function normalizeServerDate(value, label) {
  if (typeof value !== "string" || !HTTP_DATE.test(value)) {
    throw preflightFailure(
      "HTTP_UNREADABLE",
      `${label} response has no unique canonical Date header`,
    );
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw preflightFailure("HTTP_UNREADABLE", `${label} response Date is invalid`);
  }
  return new Date(milliseconds).toISOString();
}

function parseContentLength(value) {
  if (value === null) return null;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw preflightFailure("HTTP_UNREADABLE", "response Content-Length is invalid");
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw preflightFailure("HTTP_UNREADABLE", "response Content-Length is too large");
  }
  return number;
}

function timestamp(value, label) {
  if (typeof value !== "string") {
    throw preflightFailure("HTTP_UNREADABLE", `${label} must be a timestamp`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw preflightFailure(
      "HTTP_UNREADABLE",
      `${label} must be one canonical UTC timestamp`,
    );
  }
  return value;
}

function laterTimestamp(...values) {
  return values.reduce((latest, value) =>
    Date.parse(value) > Date.parse(latest) ? value : latest);
}

function assertDigest(value, label) {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw preflightFailure("HTTP_UNREADABLE", `${label} must be a SHA-256 digest`);
  }
  return value;
}

function normalizeSortedUniqueStrings(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 512) {
    throw preflightFailure("HTTP_UNREADABLE", `${label} must be a bounded array`);
  }
  const normalized = value.map((item, index) =>
    boundedString(item, `${label}[${index}]`, 256));
  const sorted = [...normalized].sort();
  if (
    new Set(normalized).size !== normalized.length ||
    canonicalJson(normalized) !== canonicalJson(sorted)
  ) {
    throw preflightFailure(
      "HTTP_UNREADABLE",
      `${label} must be unique and sorted`,
    );
  }
  return sorted;
}

function digestCanonical(domain, value) {
  return rawDigest(`${domain}\0${canonicalJson(value)}`);
}

function rawDigest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError("canonical JSON value is unsupported");
  return encoded;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(wanted)) {
    throw preflightFailure("INVALID_COMMAND", `${label} keys are not exact`);
  }
}

function assertPlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw preflightFailure("HTTP_UNREADABLE", `${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw preflightFailure("HTTP_UNREADABLE", `${label} must be a plain object`);
  }
}

function boundedString(value, label, max) {
  if (typeof value !== "string" || value.length === 0 || value.length > max ||
      value.includes("\0")) {
    throw preflightFailure("HTTP_UNREADABLE", `${label} must be one bounded string`);
  }
  return value;
}

function sha(value, label) {
  if (typeof value !== "string" || !SHA.test(value)) {
    throw preflightFailure("INVALID_COMMAND", `${label} must be one lowercase SHA-1`);
  }
  return value;
}

function positiveDecimal(value, label) {
  const text = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : value;
  if (typeof text !== "string" || !/^[1-9][0-9]*$/u.test(text)) {
    throw preflightFailure("HTTP_UNREADABLE", `${label} must be one positive decimal`);
  }
  return text;
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw preflightFailure("PAGINATION_INCOMPLETE", `${label} must be non-negative`);
  }
  return value;
}

function boolean(value, label) {
  if (typeof value !== "boolean") {
    throw preflightFailure("HTTP_UNREADABLE", `${label} must be boolean`);
  }
  return value;
}

function enumValue(value, allowed, label) {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw preflightFailure("HTTP_UNREADABLE", `${label} is outside its closed enum`);
  }
  return value;
}

function preflightFailure(code, message, details = null, cause = undefined) {
  return new V2WorkflowPreflightError(code, message, details, cause);
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
