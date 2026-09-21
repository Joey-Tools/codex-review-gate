import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  validateOrganizationFinalClosureOutput,
} from "../src/bootstrap.mjs";
import {
  CANONICAL_WORKFLOW_IDENTITIES,
  CODEOWNERS_PATH,
  FINAL_CLOSURE_RECEIPT_SCHEMA_VERSION,
  GITHUB_ACTIONS_INTEGRATION_ID,
  LEGACY_SELECTOR_REPOSITORY_COUNT,
  LEGACY_STATUS_CONTEXT,
  MANIFEST_SCHEMA_VERSION,
  NONTERMINAL_WORKFLOW_RUN_STATUSES,
  OUTPUT_SCHEMA_VERSION,
  REQUIRED_REPOSITORY_COUNT,
  V2_RULESET_NAME,
  V2_STATUS_CONTEXT,
  V2_VERIFIER_RUN_NAME_PREFIX,
  buildFinalClosureReceipt,
  buildV2OrganizationRulesetPayload,
  canonicalJson,
  deriveLegacyOrganizationCutoverPayload,
  deriveRepositoryCleanupAction,
  loadStableSnapshots,
  mapWithConcurrency,
  parseWorkflowRunPath,
  runCli,
  scanLegacyWriterRuns,
  sha256Canonical,
  validateCanaryPullGraphqlResponse,
  validateLegacyWriterRunPages,
  validateLegacyStatusPages,
  validateDefaultBranchResponse,
  validateManifest,
  validateV2CheckRunResponse,
} from "../scripts/organization-review-gate-handoff.mjs";

const HANDOFF_SCRIPT = fileURLToPath(
  new URL("../scripts/organization-review-gate-handoff.mjs", import.meta.url),
);
// Keep this independent from the production constant. It freezes the complete
// documented Actions workflow-run nonterminal set so a future production edit
// cannot silently shrink both the drain and its fake API coverage together.
const EXPECTED_NONTERMINAL_WORKFLOW_RUN_STATUSES = Object.freeze([
  "requested",
  "waiting",
  "pending",
  "queued",
  "in_progress",
]);
const JOEY_TEMPLATE = JSON.parse(
  readFileSync(
    new URL(
      "../templates/organization-review-gate-handoff/joey-tools-10-member-manifest.template.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

const ORGANIZATION = {
  login: "Joey-Tools",
  id: 61547245,
  node_id: "O_kgDOCodexReviewGate",
};

const REPOSITORIES = [
  ["codex-apple-notes-toolkit", 1242512097, 16583474],
  ["codex-debug-triage", 1242512092, 16583544],
  ["codex-personal-sync", 1242511852, 16583466],
  ["codex-private-workflows", 1242512336, null],
  ["codex-project-journal", 1242511845, 16583303],
  ["codex-review-workflows", 1242511842, 16583548],
  ["codex-rollout-backup", 1242512323, 16583521],
  ["codex-toolbox", 1242511840, 16583093],
  ["codex-workflow-hygiene", 1242512084, 16583522],
  ["codex-session-retrospective-history", 1246526548, null],
];

const ARCHIVED_LEGACY_ONLY_REPOSITORY = Object.freeze({
  slug: "Joey-Tools/codex-waited-delivery",
  id: 1242512099,
  node_id: "R_kgDOSg864w",
  default_branch: "master",
  archived: true,
});
const ARCHIVED_LEGACY_ONLY_REPOSITORY_ID = ARCHIVED_LEGACY_ONLY_REPOSITORY.id;
const LEGACY_SELECTOR_REPOSITORY_IDS = [
  ...REPOSITORIES.slice(0, 8).map(([, id]) => id),
  ARCHIVED_LEGACY_ONLY_REPOSITORY_ID,
  ...REPOSITORIES.slice(8).map(([, id]) => id),
];

function clone(value) {
  return structuredClone(value);
}

function statusRule(contexts) {
  return {
    type: "required_status_checks",
    parameters: {
      required_status_checks: contexts.map((context) => ({
        context,
        integration_id: GITHUB_ACTIONS_INTEGRATION_ID,
      })),
      strict_required_status_checks_policy: true,
      do_not_enforce_on_create: false,
    },
  };
}

function defaultBranchConditions() {
  return {
    ref_name: {
      include: ["~DEFAULT_BRANCH"],
      exclude: [],
    },
  };
}

// Keep these wire expectations independent from the producer helpers.  The
// fake-gh integration test below must catch a shared regression in a helper
// and its caller rather than merely compare two values from that helper.
function expectedOrganizationV2RulesetPayload(manifest, enforcement) {
  return {
    name: V2_RULESET_NAME,
    target: "branch",
    enforcement,
    bypass_actors: [],
    conditions: {
      ref_name: clone(manifest.legacy_ruleset.expected_before.conditions.ref_name),
      repository_id: {
        repository_ids: manifest.repositories.map((repository) => repository.id),
      },
    },
    rules: [
      {
        type: "required_status_checks",
        parameters: {
          required_status_checks: [
            {
              context: V2_STATUS_CONTEXT,
              integration_id: GITHUB_ACTIONS_INTEGRATION_ID,
            },
          ],
          strict_required_status_checks_policy: true,
          do_not_enforce_on_create: true,
        },
      },
    ],
  };
}

function expectedLegacyOrganizationCutoverPayload(manifest) {
  const payload = clone(manifest.legacy_ruleset.expected_before);
  payload.rules = payload.rules.filter(
    ({ type }) => type !== "required_status_checks",
  );
  return payload;
}

function repositoryV2Ruleset(index) {
  return {
    name: `Must Pass Codex Review v2 (${index + 1})`,
    target: "branch",
    enforcement: "active",
    bypass_actors: [],
    conditions: defaultBranchConditions(),
    rules: [
      {
        type: "pull_request",
        parameters: {
          dismiss_stale_reviews_on_push: true,
          require_code_owner_review: true,
          required_review_thread_resolution: true,
        },
      },
      {
        type: "required_status_checks",
        parameters: {
          required_status_checks: [
            {
              context: V2_STATUS_CONTEXT,
              integration_id: GITHUB_ACTIONS_INTEGRATION_ID,
            },
          ],
          strict_required_status_checks_policy: true,
          do_not_enforce_on_create: true,
        },
      },
      { type: "non_fast_forward" },
    ],
  };
}

function cleanupRuleset(name, contexts) {
  return {
    name,
    target: "branch",
    enforcement: "active",
    bypass_actors: [],
    conditions: defaultBranchConditions(),
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      statusRule(contexts),
    ],
  };
}

function repositoryCleanupAction(rulesetId, index) {
  const name = `Legacy repository protection ${index + 1}`;
  return {
    surface: "repository_ruleset",
    ruleset_id: rulesetId,
    operation: "update",
    expected_before: cleanupRuleset(name, [LEGACY_STATUS_CONTEXT, "test"]),
    expected_after: cleanupRuleset(name, ["test"]),
  };
}

function repositoryEntry([name, id, cleanupRulesetId], index) {
  const digit = ((index % 14) + 1).toString(16);
  const slug = `${ORGANIZATION.login}/${name}`;
  return {
    slug,
    id,
    node_id: `R_kgDO${id}`,
    default_branch: "master",
    workflows: clone(CANONICAL_WORKFLOW_IDENTITIES),
    codeowners: {
      path: CODEOWNERS_PATH,
      git_blob_sha: digit.repeat(40),
      sha256: digit.repeat(64),
      owner: {
        login: "JoeyTeng",
        id: 12524680,
        node_id: "MDQ6VXNlcjEyNTI0Njgw",
      },
    },
    v2_ruleset: {
      id: 20000000 + index,
      expected: repositoryV2Ruleset(index),
    },
    canary: {
      pull_number: 100 + index,
      head_sha: digit.repeat(40),
      base_sha: ((index + 2) % 16).toString(16).repeat(40),
      test_merge_sha: ((index + 3) % 16).toString(16).repeat(40),
      v2_check_run_id: 30000000 + index * 2,
      v2_run_id: 31000000 + index,
      v2_job_id: 32000000 + index,
      v2_workflow_id: 33000000 + index,
      v2_run_attempt: 1,
      legacy_status_id: 30000001 + index * 2,
    },
    legacy_cleanup:
      cleanupRulesetId === null
        ? []
        : [repositoryCleanupAction(cleanupRulesetId, index)],
  };
}

function legacyOrganizationRuleset(repositoryIds) {
  return {
    name: "Must Pass Codex Review",
    target: "branch",
    enforcement: "active",
    bypass_actors: [],
    conditions: {
      repository_id: { repository_ids: repositoryIds },
      ref_name: {
        include: ["~DEFAULT_BRANCH"],
        exclude: [],
      },
    },
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      statusRule([LEGACY_STATUS_CONTEXT]),
    ],
  };
}

function manifestFixture() {
  const repositories = REPOSITORIES.map(repositoryEntry);
  return {
    schema_version: MANIFEST_SCHEMA_VERSION,
    organization: clone(ORGANIZATION),
    legacy_ruleset: {
      id: 16590367,
      legacy_only_repository: clone(ARCHIVED_LEGACY_ONLY_REPOSITORY),
      expected_before: legacyOrganizationRuleset(
        [...LEGACY_SELECTOR_REPOSITORY_IDS],
      ),
    },
    v2_ruleset: {
      id: 26590367,
      name: V2_RULESET_NAME,
    },
    repositories,
    expected_legacy_cleanup_action_count: 8,
  };
}

function assertManifestRejected(mutator, pattern) {
  const manifest = manifestFixture();
  mutator(manifest);
  assert.throws(() => validateManifest(manifest), pattern);
}

function canaryPullGraphqlResponse(repo) {
  return {
    data: {
      repository: {
        pullRequest: {
          number: repo.canary.pull_number,
          state: "OPEN",
          merged: false,
          isDraft: false,
          mergeable: "MERGEABLE",
          headRefOid: repo.canary.head_sha,
          baseRefName: repo.default_branch,
          baseRefOid: repo.canary.base_sha,
          headRepository: { nameWithOwner: repo.slug },
          baseRepository: { nameWithOwner: repo.slug },
          potentialMergeCommit: { oid: repo.canary.test_merge_sha },
          changedFiles: 1,
        },
      },
    },
  };
}

function v2CheckRunResponse(repo) {
  return {
    total_count: 1,
    check_runs: [{
      id: repo.canary.v2_check_run_id,
      name: V2_STATUS_CONTEXT,
      status: "completed",
      conclusion: "success",
      app: {
        id: GITHUB_ACTIONS_INTEGRATION_ID,
        slug: "github-actions",
      },
      head_sha: repo.canary.head_sha,
      details_url:
        `https://github.com/${repo.slug}/actions/runs/${repo.canary.v2_run_id}/job/${repo.canary.v2_job_id}`,
    }],
  };
}

function legacyStatusPages(
  repo,
  { newerLegacyContext = null, newerLegacyState = "success" } = {},
) {
  const canonical = {
    id: repo.canary.legacy_status_id,
    node_id: "SC_legacy_status",
    context: LEGACY_STATUS_CONTEXT,
    state: "success",
    target_url: "https://writer-controlled.invalid/not-provenance",
    creator: {
      login: "github-actions[bot]",
      type: "Bot",
    },
  };
  const statuses = [canonical];
  if (newerLegacyContext !== null) {
    statuses.unshift({
      ...clone(canonical),
      id: repo.canary.legacy_status_id + 1,
      node_id: "SC_newer_case_variant",
      context: newerLegacyContext,
      state: newerLegacyState,
    });
  }
  return [statuses];
}

function effectiveStatusRule({ id, sourceType, source, context }) {
  return {
    type: "required_status_checks",
    ruleset_id: id,
    ruleset_source: source,
    ruleset_source_type: sourceType,
    parameters: statusRule([context]).parameters,
  };
}

function effectiveBranchRules(repository, manifest, {
  v2State,
  legacyState,
  cleanupState,
}) {
  const rules = [
    effectiveStatusRule({
      id: repository.v2_ruleset.id,
      sourceType: "Repository",
      source: repository.slug,
      context: V2_STATUS_CONTEXT,
    }),
  ];
  if (legacyState === "before") {
    rules.push(effectiveStatusRule({
      id: manifest.legacy_ruleset.id,
      sourceType: "Organization",
      source: manifest.organization.login,
      context: LEGACY_STATUS_CONTEXT,
    }));
  }
  if (v2State === "active") {
    rules.push(effectiveStatusRule({
      id: manifest.v2_ruleset.id,
      sourceType: "Organization",
      source: manifest.organization.login,
      context: V2_STATUS_CONTEXT,
    }));
  }
  if (cleanupState === "before") {
    for (const action of repository.legacy_cleanup) {
      if (action.surface === "repository_ruleset") {
        rules.push(effectiveStatusRule({
          id: action.ruleset_id,
          sourceType: "Repository",
          source: repository.slug,
          context: LEGACY_STATUS_CONTEXT,
        }));
      }
    }
  }
  return rules;
}

function gitBlobSha(bytes) {
  return createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`, "utf8"))
    .update(bytes)
    .digest("hex");
}

function completeRulesetResponse(id, sourceType, source, writable) {
  return {
    id,
    source_type: sourceType,
    source,
    ...clone(writable),
  };
}

function integrationManifestFixture() {
  const manifest = manifestFixture();
  const codeownersBytes = Buffer.from(
    [
      "# Integration fixture owners",
      "# BEGIN codex-review-gate control-plane",
      "/.github/workflows/ @JoeyTeng",
      "/.github/CODEOWNERS @JoeyTeng",
      "# END codex-review-gate control-plane",
      "",
    ].join("\n"),
    "utf8",
  );
  for (const repository of manifest.repositories) {
    repository.codeowners.git_blob_sha = gitBlobSha(codeownersBytes);
    repository.codeowners.sha256 = createHash("sha256")
      .update(codeownersBytes)
      .digest("hex");
  }
  return { manifest, codeownersBytes };
}

function encodeEndpointPathForTest(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function addFakeResponse(responses, endpoint, value) {
  const key = `GET:${endpoint}`;
  const serialized = JSON.stringify(value);
  if (responses.has(key)) {
    assert.equal(responses.get(key), serialized, `conflicting fake response for ${key}`);
  } else {
    responses.set(key, serialized);
  }
}

function workflowRunPages(runs) {
  const normalizedRuns = runs.map((run) => ({ run_attempt: 1, ...run }));
  const totalCount = normalizedRuns.length;
  const pages = [];
  for (let offset = 0; offset < totalCount; offset += 100) {
    pages.push({
      total_count: totalCount,
      workflow_runs: normalizedRuns.slice(offset, offset + 100),
    });
  }
  return pages.length === 0
    ? [{ total_count: 0, workflow_runs: [] }]
    : pages;
}

function createFakeGhHarness(
  t,
  {
    extraWorkflow = null,
    canaryState = "open",
    defaultWorkflowPermissions = "read",
    newerLegacyStatusContext = null,
    unexpectedWorkflowTree = false,
    postActivationHeadSha = null,
    detailedCleanupState = false,
    cleanupMutationErrorAt = null,
    cleanupMutationFailureAt = null,
    cleanupIdentityDriftAtMetadataRead = null,
    cleanupExternalReconcileAtSurfaceRead = null,
    cleanupPrewriteSurfaceDriftAtRead = null,
    cleanupPrewriteSurfaceFailureAtRead = null,
    stageCreateResponse = "valid",
    extraEffectiveRules = [],
    extraEffectiveSecondPageRules = [],
    mutateEffectiveRules = null,
    legacyProducerRunPages = null,
    legacyProducerRunDelaySeconds = null,
    legacyBridgeRunPages = null,
    legacyBridgeWorkflowInventory = null,
    legacyWriterRace = null,
    legacyBridgeWorkflowHorizonDrift = false,
  } = {},
) {
  const { manifest, codeownersBytes } = integrationManifestFixture();
  const directory = mkdtempSync(join(tmpdir(), "organization-handoff-fake-gh-"));
  const ghPath = join(directory, "gh");
  const logPath = join(directory, "requests.tsv");
  const manifestPath = join(directory, "manifest.json");
  const v2StatePath = join(directory, "v2-state");
  const legacyStatePath = join(directory, "legacy-state");
  const legacyOnlyIdentityStatePath = join(
    directory,
    "legacy-only-identity-state",
  );
  const cleanupStatePath = join(directory, "cleanup-state");
  const cleanupIdentityReadCountPath = join(
    directory,
    "cleanup-identity-read-count",
  );
  const legacyWriterRaceStatePath = join(directory, "legacy-writer-race-state");
  const cleanupActionStatePaths = [];
  const cleanupSurfaceReadCountPaths = [];
  const responses = new Map();
  const delayedRequests = [];
  const legacyWriterRaceResponses = [];
  const cleanupResponses = [];
  const effectiveBranchResponses = [];
  const graphQlResponses = [];
  const notFoundEndpoints = [];
  const workflowBytes = Object.fromEntries(
    Object.entries(CANONICAL_WORKFLOW_IDENTITIES).map(([key, identity]) => [
      key,
      readFileSync(
        new URL(`../templates/codex-gated-repo/${identity.path}`, import.meta.url),
      ),
    ]),
  );
  let cleanupIdentityResponse = null;

  const organization = manifest.organization;
  const encodedOrganization = encodeURIComponent(organization.login);
  addFakeResponse(responses, `orgs/${encodedOrganization}`, organization);
  const legacyOnlyRepository = manifest.legacy_ruleset.legacy_only_repository;
  const legacyOnlyRepositoryEndpoint =
    `repos/${encodeEndpointPathForTest(legacyOnlyRepository.slug)}`;
  const legacyOnlyRepositoryIdentity = {
    full_name: legacyOnlyRepository.slug,
    id: legacyOnlyRepository.id,
    node_id: legacyOnlyRepository.node_id,
    default_branch: legacyOnlyRepository.default_branch,
    archived: legacyOnlyRepository.archived,
  };
  const legacyOnlyRepositoryArchiveDrift = {
    ...legacyOnlyRepositoryIdentity,
    archived: false,
  };
  const legacyOnlyRepositoryIdentityDrift = {
    ...legacyOnlyRepositoryIdentity,
    node_id: `${legacyOnlyRepository.node_id}_replacement`,
  };
  addFakeResponse(
    responses,
    legacyOnlyRepositoryEndpoint,
    legacyOnlyRepositoryIdentity,
  );

  for (const [repositoryIndex, repository] of manifest.repositories.entries()) {
    const encodedSlug = encodeEndpointPathForTest(repository.slug);
    const controlPlaneHead = postActivationHeadSha ?? repository.canary.base_sha;
    addFakeResponse(responses, `repos/${encodedSlug}`, {
      full_name: repository.slug,
      id: repository.id,
      node_id: repository.node_id,
      default_branch: repository.default_branch,
    });
    if (repositoryIndex === 0 && cleanupIdentityDriftAtMetadataRead !== null) {
      cleanupIdentityResponse = {
        request: `GET:repos/${encodedSlug}`,
        bound: JSON.stringify({
          full_name: repository.slug,
          id: repository.id,
          node_id: repository.node_id,
          default_branch: repository.default_branch,
        }),
        drifted: JSON.stringify({
          full_name: repository.slug,
          id: repository.id + 1,
          node_id: `${repository.node_id}_replacement`,
          default_branch: repository.default_branch,
        }),
      };
    }
    addFakeResponse(
      responses,
      `repos/${encodedSlug}/actions/permissions/workflow`,
      {
        default_workflow_permissions: defaultWorkflowPermissions,
        can_approve_pull_request_reviews: false,
      },
    );
    addFakeResponse(
      responses,
      `repos/${encodedSlug}/branches/${encodeURIComponent(repository.default_branch)}`,
      {
        name: repository.default_branch,
        commit: { sha: controlPlaneHead },
      },
    );

    const githubTreeSha = createHash("sha1")
      .update(`${repository.slug}:github-tree`)
      .digest("hex");
    const workflowsTreeSha = createHash("sha1")
      .update(`${repository.slug}:workflows-tree`)
      .digest("hex");
    const workflowEntries = Object.entries(repository.workflows).map(
      ([key, identity]) => ({
        path: identity.path.split("/").at(-1),
        mode: "100644",
        type: "blob",
        sha: identity.git_blob_sha,
        content: workflowBytes[key],
      }),
    );
    if (repositoryIndex === 0 && extraWorkflow !== null) {
      const content = Buffer.from(extraWorkflow.content, "utf8");
      workflowEntries.push({
        path: extraWorkflow.path.replace(/^\.github\/workflows\//u, ""),
        mode: "100644",
        type: "blob",
        sha: gitBlobSha(content),
        content,
      });
    }
    const workflowTreeEntries = workflowEntries.map(
      ({ content: _content, ...entry }) => entry,
    );
    if (repositoryIndex === 0 && unexpectedWorkflowTree) {
      workflowTreeEntries.push({
        path: "nested",
        mode: "040000",
        type: "tree",
        sha: createHash("sha1").update("unexpected nested workflow tree").digest("hex"),
      });
    }
    addFakeResponse(
      responses,
      `repos/${encodedSlug}/git/trees/${controlPlaneHead}`,
      {
        sha: controlPlaneHead,
        truncated: false,
        tree: [{
          path: ".github",
          mode: "040000",
          type: "tree",
          sha: githubTreeSha,
        }],
      },
    );
    addFakeResponse(
      responses,
      `repos/${encodedSlug}/git/trees/${githubTreeSha}`,
      {
        sha: githubTreeSha,
        truncated: false,
        tree: [{
          path: "workflows",
          mode: "040000",
          type: "tree",
          sha: workflowsTreeSha,
        }],
      },
    );
    addFakeResponse(
      responses,
      `repos/${encodedSlug}/git/trees/${workflowsTreeSha}`,
      {
        sha: workflowsTreeSha,
        truncated: false,
        tree: workflowTreeEntries,
      },
    );
    for (const entry of workflowEntries) {
      addFakeResponse(
        responses,
        `repos/${encodedSlug}/git/blobs/${entry.sha}`,
        {
          sha: entry.sha,
          encoding: "base64",
          content: entry.content.toString("base64"),
        },
      );
    }

    for (const [key, identity] of Object.entries(repository.workflows)) {
      addFakeResponse(
        responses,
        `repos/${encodedSlug}/contents/${encodeEndpointPathForTest(identity.path)}?ref=${encodeURIComponent(controlPlaneHead)}`,
        {
          type: "file",
          path: identity.path,
          sha: identity.git_blob_sha,
          encoding: "base64",
          content: workflowBytes[key].toString("base64"),
        },
      );
    }
    addFakeResponse(
      responses,
      `repos/${encodedSlug}/contents/${encodeEndpointPathForTest(repository.codeowners.path)}?ref=${encodeURIComponent(controlPlaneHead)}`,
      {
        type: "file",
        path: repository.codeowners.path,
        sha: repository.codeowners.git_blob_sha,
        encoding: "base64",
        content: codeownersBytes.toString("base64"),
      },
    );
    addFakeResponse(
      responses,
      `repos/${encodedSlug}/collaborators/${encodeURIComponent(repository.codeowners.owner.login)}/permission`,
      {
        permission: "admin",
        user: {
          ...repository.codeowners.owner,
          type: "User",
        },
      },
    );

    const v2RulesetEndpoint =
      `repos/${encodedSlug}/rulesets/${repository.v2_ruleset.id}?includes_parents=false`;
    addFakeResponse(
      responses,
      v2RulesetEndpoint,
      completeRulesetResponse(
        repository.v2_ruleset.id,
        "Repository",
        repository.slug,
        repository.v2_ruleset.expected,
      ),
    );
    const localRulesetSummaries = [{
      id: repository.v2_ruleset.id,
      name: repository.v2_ruleset.expected.name,
      source_type: "Repository",
      source: repository.slug,
      enforcement: repository.v2_ruleset.expected.enforcement,
    }];
    for (const [actionIndex, action] of repository.legacy_cleanup.entries()) {
      assert.equal(action.surface, "repository_ruleset");
      const actionStatePath = join(
        directory,
        `cleanup-action-${repositoryIndex}-${actionIndex}`,
      );
      const surfaceReadCountPath = join(
        directory,
        `cleanup-surface-reads-${repositoryIndex}-${actionIndex}`,
      );
      const actionOrdinal = cleanupActionStatePaths.length;
      cleanupActionStatePaths.push({
        repository: repository.slug,
        surface: `repository_ruleset:${action.ruleset_id}`,
        path: actionStatePath,
        ordinal: actionOrdinal,
      });
      cleanupSurfaceReadCountPaths.push(surfaceReadCountPath);
      localRulesetSummaries.push({
        id: action.ruleset_id,
        name: action.expected_before.name,
        source_type: "Repository",
        source: repository.slug,
        enforcement: action.expected_before.enforcement,
      });
      cleanupResponses.push({
        request:
          `GET:repos/${encodedSlug}/rulesets/${action.ruleset_id}?includes_parents=false`,
        mutationRequest:
          `PUT:repos/${encodedSlug}/rulesets/${action.ruleset_id}`,
        statePath: actionStatePath,
        surfaceReadCountPath,
        ordinal: actionOrdinal,
        before: JSON.stringify(
          completeRulesetResponse(
            action.ruleset_id,
            "Repository",
            repository.slug,
            action.expected_before,
          ),
        ),
        after: JSON.stringify(
          completeRulesetResponse(
            action.ruleset_id,
            "Repository",
            repository.slug,
            action.expected_after,
          ),
        ),
        drifted: JSON.stringify({
          ...completeRulesetResponse(
            action.ruleset_id,
            "Repository",
            repository.slug,
            action.expected_before,
          ),
          name: "Unexpected concurrent cleanup policy edit",
        }),
      });
    }
    addFakeResponse(
      responses,
      `repos/${encodedSlug}/rulesets?includes_parents=false&per_page=100`,
      [localRulesetSummaries],
    );
    const effectiveResponseByState = {};
    for (const v2State of ["absent", "disabled", "active"]) {
      for (const legacyState of ["before", "after"]) {
        for (const cleanupState of ["before", "after"]) {
          let rules = effectiveBranchRules(repository, manifest, {
            v2State,
            legacyState,
            cleanupState,
          });
          if (repositoryIndex === 0) {
            rules = [...rules, ...clone(extraEffectiveRules)];
            if (mutateEffectiveRules !== null) {
              rules = mutateEffectiveRules(clone(rules), {
                v2State,
                legacyState,
                cleanupState,
              });
            }
            if (extraEffectiveSecondPageRules.length > 0) {
              rules.push(
                ...Array.from({ length: Math.max(0, 100 - rules.length) }, () => ({
                  type: "deletion",
                  ruleset_id: null,
                  ruleset_source: null,
                  ruleset_source_type: null,
                })),
              );
            }
          }
          effectiveResponseByState[`${v2State}:${legacyState}:${cleanupState}`] =
            JSON.stringify([
              rules,
              ...(repositoryIndex === 0 && extraEffectiveSecondPageRules.length > 0
                ? [clone(extraEffectiveSecondPageRules)]
                : []),
            ]);
        }
      }
    }
    effectiveBranchResponses.push({
      request: `GET:repos/${encodedSlug}/rules/branches/${encodeURIComponent(repository.default_branch)}?per_page=100`,
      cleanupStatePath:
        detailedCleanupState && repository.legacy_cleanup.length === 1
          ? cleanupActionStatePaths.at(-1).path
          : null,
      byState: effectiveResponseByState,
    });

    if (canaryState !== "closed") {
      assert.equal(canaryState, "open");
    }
    const graphQlResponse = canaryPullGraphqlResponse(repository);
    if (canaryState === "closed") {
      graphQlResponse.data.repository.pullRequest.state = "CLOSED";
    }
    graphQlResponses.push({
      owner: repository.slug.split("/")[0],
      repositoryName: repository.slug.split("/")[1],
      pullNumber: repository.canary.pull_number,
      response: JSON.stringify(graphQlResponse),
    });
    addFakeResponse(
      responses,
      `repos/${encodedSlug}/pulls/${repository.canary.pull_number}/files?per_page=100`,
      [[{ filename: "README.md" }]],
    );
    addFakeResponse(
      responses,
      `repos/${encodedSlug}/commits/${repository.canary.head_sha}/check-runs?check_name=${encodeURIComponent(V2_STATUS_CONTEXT)}&filter=latest&per_page=100`,
      v2CheckRunResponse(repository),
    );
    addFakeResponse(
      responses,
      `repos/${encodedSlug}/actions/runs/${repository.canary.v2_run_id}`,
      {
        id: repository.canary.v2_run_id,
        workflow_id: repository.canary.v2_workflow_id,
        run_attempt: repository.canary.v2_run_attempt,
        display_title:
          `${V2_VERIFIER_RUN_NAME_PREFIX}/${repository.canary.pull_number}/${repository.canary.test_merge_sha}`,
        repository: { full_name: repository.slug },
        head_repository: { full_name: repository.slug },
        path: CANONICAL_WORKFLOW_IDENTITIES.verifier.path,
        head_sha: repository.canary.head_sha,
        event: "pull_request",
        status: "completed",
        conclusion: "success",
        pull_requests: [{
          number: repository.canary.pull_number,
          head: { sha: repository.canary.head_sha },
          base: { ref: repository.default_branch },
        }],
      },
    );
    addFakeResponse(
      responses,
      `repos/${encodedSlug}/actions/workflows/${repository.canary.v2_workflow_id}`,
      {
        id: repository.canary.v2_workflow_id,
        path: CANONICAL_WORKFLOW_IDENTITIES.verifier.path,
        state: "active",
      },
    );
    const bridgeWorkflowId = 34000000 + repositoryIndex;
    let actionsWorkflowInventory = [
      {
        id: repository.canary.v2_workflow_id,
        path: CANONICAL_WORKFLOW_IDENTITIES.verifier.path,
        state: "active",
      },
      {
        id: 35000000 + repositoryIndex,
        path: CANONICAL_WORKFLOW_IDENTITIES.controller.path,
        state: "active",
      },
      {
        id: bridgeWorkflowId,
        path: CANONICAL_WORKFLOW_IDENTITIES.legacy_bridge.path,
        state: "active",
      },
    ];
    if (repositoryIndex === 0 && legacyBridgeWorkflowInventory === "malformed") {
      actionsWorkflowInventory = null;
    }
    if (repositoryIndex === 0 && legacyBridgeWorkflowInventory === "ambiguous") {
      actionsWorkflowInventory.push({
        id: 36000000,
        path: CANONICAL_WORKFLOW_IDENTITIES.legacy_bridge.path,
        state: "active",
      });
    }
    if (repositoryIndex === 0 && legacyBridgeWorkflowInventory === "duplicate-id") {
      actionsWorkflowInventory.push({
        id: repository.canary.v2_workflow_id,
        path: ".github/workflows/duplicate-id.yml",
        state: "active",
      });
    }
    addFakeResponse(
      responses,
      `repos/${encodedSlug}/actions/workflows?per_page=100`,
      [{
        total_count: actionsWorkflowInventory?.length ?? 3,
        workflows: actionsWorkflowInventory,
      }],
    );
    if (actionsWorkflowInventory !== null) {
      const workflowHorizonPage = {
        total_count: actionsWorkflowInventory.length,
        workflows:
          repositoryIndex === 0 && legacyBridgeWorkflowHorizonDrift
            ? actionsWorkflowInventory.map((workflow, index) =>
                index === 0
                  ? { ...workflow, id: workflow.id + 1000000 }
                  : workflow,
              )
            : actionsWorkflowInventory,
      };
      addFakeResponse(
        responses,
        `repos/${encodedSlug}/actions/workflows?per_page=100&page=1`,
        workflowHorizonPage,
      );
    }
    if (actionsWorkflowInventory !== null) {
      addFakeResponse(
        responses,
        `repos/${encodedSlug}/actions/workflows/${bridgeWorkflowId}`,
        {
          id: bridgeWorkflowId,
          path: CANONICAL_WORKFLOW_IDENTITIES.legacy_bridge.path,
          state: "active",
        },
      );
    }
    const producerRunPages =
      repositoryIndex === 0 && legacyProducerRunPages !== null
        ? legacyProducerRunPages
        : workflowRunPages([]);
    for (const [pageIndex, page] of producerRunPages.entries()) {
      const endpoint =
        `repos/${encodedSlug}/actions/workflows/${repository.canary.v2_workflow_id}/runs?per_page=100&page=${pageIndex + 1}`;
      addFakeResponse(
        responses,
        endpoint,
        page,
      );
      if (repositoryIndex === 0 && legacyProducerRunDelaySeconds !== null) {
        delayedRequests.push({
          request: `GET:${endpoint}`,
          seconds: legacyProducerRunDelaySeconds,
        });
      }
    }
    const bridgeRunPages =
      repositoryIndex === 0 && legacyBridgeRunPages !== null
        ? legacyBridgeRunPages
        : workflowRunPages([]);
    const bridgeRunEndpoint =
      `repos/${encodedSlug}/actions/workflows/${bridgeWorkflowId}/runs?per_page=100`;
    if (repositoryIndex === 0 && legacyWriterRace !== null) {
      const bridgeRunPagesAfter = legacyWriterRace.bridge_run_pages_after;
      assert.ok(Array.isArray(bridgeRunPagesAfter));
      for (let pageIndex = 0; pageIndex < bridgeRunPagesAfter.length; pageIndex += 1) {
        legacyWriterRaceResponses.push({
          request: `GET:${bridgeRunEndpoint}&page=${pageIndex + 1}`,
          before: JSON.stringify(bridgeRunPages[pageIndex]),
          after: JSON.stringify(bridgeRunPagesAfter[pageIndex]),
          advance: false,
        });
      }
    } else {
      for (const [pageIndex, page] of bridgeRunPages.entries()) {
        addFakeResponse(
          responses,
          `${bridgeRunEndpoint}&page=${pageIndex + 1}`,
          page,
        );
      }
    }
    addFakeResponse(
      responses,
      `repos/${encodedSlug}/actions/runs/${repository.canary.v2_run_id}/attempts/${repository.canary.v2_run_attempt}/jobs?per_page=100`,
      [{
        total_count: 1,
        jobs: [{
          id: repository.canary.v2_job_id,
          run_id: repository.canary.v2_run_id,
          name: V2_STATUS_CONTEXT,
          head_sha: repository.canary.head_sha,
          status: "completed",
          conclusion: "success",
          check_run_url:
            `https://api.github.com/repos/${repository.slug}/check-runs/${repository.canary.v2_check_run_id}`,
        }],
      }],
    );
    const legacyStatusEndpoint =
      `repos/${encodedSlug}/commits/${repository.canary.head_sha}/statuses?per_page=100`;
    const statusPages = legacyStatusPages(repository, {
      newerLegacyContext:
        repositoryIndex === 0 ? newerLegacyStatusContext : null,
    });
    if (repositoryIndex === 0 && legacyWriterRace !== null) {
      const statusPagesAfter =
        legacyWriterRace.status_pages_after ??
        legacyStatusPages(repository, {
          newerLegacyContext: LEGACY_STATUS_CONTEXT,
          newerLegacyState: "failure",
        });
      assert.ok(Array.isArray(statusPagesAfter));
      legacyWriterRaceResponses.push(
        {
          request: `GET:${legacyStatusEndpoint}`,
          before: JSON.stringify(statusPages),
          after: JSON.stringify(statusPagesAfter),
          advance: false,
        },
        {
          request: `GET:${legacyStatusEndpoint}&page=1`,
          before: JSON.stringify(statusPages[0]),
          after: JSON.stringify(statusPagesAfter[0]),
          advance: true,
        },
      );
    } else {
      addFakeResponse(responses, legacyStatusEndpoint, statusPages);
      addFakeResponse(responses, `${legacyStatusEndpoint}&page=1`, statusPages[0]);
    }
    notFoundEndpoints.push(
      `GET:repos/${encodedSlug}/branches/${encodeURIComponent(repository.default_branch)}/protection/required_status_checks`,
    );
  }

  const legacyBefore = manifest.legacy_ruleset.expected_before;
  const legacyAfter = deriveLegacyOrganizationCutoverPayload(manifest);
  const legacyDrift = clone(legacyBefore);
  legacyDrift.name = `${legacyDrift.name} drift`;
  const v2Disabled = buildV2OrganizationRulesetPayload(manifest, "disabled");
  const v2Active = buildV2OrganizationRulesetPayload(manifest, "active");
  const legacyComplete = (writable) => JSON.stringify(
    completeRulesetResponse(
      manifest.legacy_ruleset.id,
      "Organization",
      organization.login,
      writable,
    ),
  );
  const v2Complete = (writable) => JSON.stringify(
    completeRulesetResponse(
      manifest.v2_ruleset.id,
      "Organization",
      organization.login,
      writable,
    ),
  );
  const legacySummary = {
    id: manifest.legacy_ruleset.id,
    name: legacyBefore.name,
    source_type: "Organization",
    source: organization.login,
    enforcement: legacyBefore.enforcement,
  };
  const v2Summary = (enforcement) => ({
    id: manifest.v2_ruleset.id,
    name: V2_RULESET_NAME,
    source_type: "Organization",
    source: organization.login,
    enforcement,
  });
  const orgRulesetCollection = `orgs/${encodedOrganization}/rulesets`;
  const legacyEndpoint = `${orgRulesetCollection}/${manifest.legacy_ruleset.id}`;
  const v2Endpoint = `${orgRulesetCollection}/${manifest.v2_ruleset.id}`;
  const stagePostResponse =
    stageCreateResponse === "invalid"
      ? JSON.stringify({ id: "invalid-created-ruleset" })
      : v2Complete(v2Disabled);

  const scriptLines = [
    "#!/bin/sh",
    "set -eu",
    'method="GET"',
    'endpoint=""',
    'input=""',
    'while [ "$#" -gt 0 ]; do',
    '  case "$1" in',
    "    api) shift ;;",
    "    --hostname|-H) shift 2 ;;",
    '    --method) method="$2"; shift 2 ;;',
    "    --paginate|--slurp) shift ;;",
    '    --input) input="$2"; shift 2 ;;',
    '    *) endpoint="$1"; shift ;;',
    "  esac",
    "done",
    'body=""',
    'if [ "$input" = "-" ]; then body="$(cat)"; fi',
    'printf \'%s\\t%s\\t%s\\n\' "$method" "$endpoint" "$body" >> "${FAKE_GH_LOG:?}"',
    'request="$method:$endpoint"',
    'respond() { printf \'%s\\n\' "$1"; exit 0; }',
    'case "$request" in',
    `  ${shellQuote(`POST:${orgRulesetCollection}`)})`,
    '    printf \'%s\\n\' \'disabled\' > "${FAKE_GH_V2_STATE:?}"',
    `    respond ${shellQuote(stagePostResponse)} ;;`,
    `  ${shellQuote(`PUT:${v2Endpoint}`)})`,
    '    printf \'%s\\n\' \'active\' > "${FAKE_GH_V2_STATE:?}"',
    `    respond ${shellQuote(v2Complete(v2Active))} ;;`,
    `  ${shellQuote(`PUT:${legacyEndpoint}`)})`,
    '    printf \'%s\\n\' \'after\' > "${FAKE_GH_LEGACY_STATE:?}"',
    `    respond ${shellQuote(legacyComplete(legacyAfter))} ;;`,
    "esac",
    'case "$request" in',
    `  ${shellQuote(`GET:${legacyEndpoint}`)})`,
    '    case "$(cat "${FAKE_GH_LEGACY_STATE:?}")" in',
    `      before) respond ${shellQuote(legacyComplete(legacyBefore))} ;;`,
    `      after) respond ${shellQuote(legacyComplete(legacyAfter))} ;;`,
    `      drift) respond ${shellQuote(legacyComplete(legacyDrift))} ;;`,
    "      *) printf '%s\\n' 'invalid fake legacy state' >&2; exit 2 ;;",
    "    esac ;;",
    `  ${shellQuote(`GET:${v2Endpoint}`)})`,
    '    case "$(cat "${FAKE_GH_V2_STATE:?}")" in',
    `      disabled) respond ${shellQuote(v2Complete(v2Disabled))} ;;`,
    `      active) respond ${shellQuote(v2Complete(v2Active))} ;;`,
    "      *) printf '%s\\n' 'v2 ruleset is absent' >&2; exit 2 ;;",
    "    esac ;;",
    `  ${shellQuote(`GET:${orgRulesetCollection}?per_page=100`)})`,
    '    case "$(cat "${FAKE_GH_V2_STATE:?}")" in',
    `      absent) respond ${shellQuote(JSON.stringify([[legacySummary]]))} ;;`,
    `      disabled) respond ${shellQuote(JSON.stringify([[legacySummary, v2Summary("disabled")]]))} ;;`,
    `      active) respond ${shellQuote(JSON.stringify([[legacySummary, v2Summary("active")]]))} ;;`,
    "      *) printf '%s\\n' 'invalid fake v2 state' >&2; exit 2 ;;",
    "    esac ;;",
    "esac",
  ];

  if (graphQlResponses.length > 0) {
    scriptLines.push(
      'if [ "$request" = "POST:graphql" ]; then',
      '  case "$body" in',
    );
    for (const response of graphQlResponses) {
      const variablesToken = `"variables":{"owner":"${response.owner}","name":"${response.repositoryName}","number":${response.pullNumber}}`;
      scriptLines.push(
        `    *${shellQuote(variablesToken)}*) respond ${shellQuote(response.response)} ;;`,
      );
    }
    scriptLines.push(
      "    *) printf '%s\\n' 'unexpected fake GraphQL variables' >&2; exit 2 ;;",
      "  esac",
      "fi",
    );
  }

  if (effectiveBranchResponses.length > 0) {
    scriptLines.push('case "$request" in');
    for (const response of effectiveBranchResponses) {
      const cleanupStateExpression =
        response.cleanupStatePath === null
          ? '$(cat "${FAKE_GH_CLEANUP_STATE:?}")'
          : `$(cat ${shellQuote(response.cleanupStatePath)})`;
      scriptLines.push(
        `  ${shellQuote(response.request)})`,
        `    state="$(cat \"\${FAKE_GH_V2_STATE:?}\"):$(cat \"\${FAKE_GH_LEGACY_STATE:?}\"):${cleanupStateExpression}"`,
        '    case "$state" in',
      );
      for (const [state, payload] of Object.entries(response.byState)) {
        scriptLines.push(
          `      ${shellQuote(state)}) respond ${shellQuote(JSON.stringify(JSON.parse(payload)))} ;;`,
        );
      }
      scriptLines.push(
        "      *) printf '%s\\n' 'invalid fake effective branch-rule state' >&2; exit 2 ;;",
        "    esac ;;",
      );
    }
    scriptLines.push("esac");
  }

  if (cleanupResponses.length > 0) {
    scriptLines.push('case "$request" in');
    for (const response of cleanupResponses) {
      const cleanupStateFile = detailedCleanupState
        ? shellQuote(response.statePath)
        : '"${FAKE_GH_CLEANUP_STATE:?}"';
      scriptLines.push(
        `  ${shellQuote(response.mutationRequest)})`,
      );
      if (cleanupMutationFailureAt === response.ordinal) {
        scriptLines.push(
          "    printf '%s\\n' 'simulated cleanup mutation failure' >&2; exit 1 ;;",
        );
      } else if (cleanupMutationErrorAt === response.ordinal) {
        scriptLines.push(
          `    printf '%s\\n' 'after' > ${cleanupStateFile}`,
          "    printf '%s\\n' 'simulated ambiguous cleanup mutation result' >&2; exit 1 ;;",
        );
      } else {
        scriptLines.push(
          `    printf '%s\\n' 'after' > ${cleanupStateFile}`,
          `    respond ${shellQuote(response.after)} ;;`,
        );
      }
      scriptLines.push(
        `  ${shellQuote(response.request)})`,
      );
      const surfaceReadInjections = [
        ["external-reconcile", cleanupExternalReconcileAtSurfaceRead],
        ["third-state", cleanupPrewriteSurfaceDriftAtRead],
        ["read-failure", cleanupPrewriteSurfaceFailureAtRead],
      ].filter(([, injection]) =>
        injection !== null && injection.ordinal === response.ordinal,
      );
      if (surfaceReadInjections.length > 1) {
        throw new Error("Fake cleanup surface read injections must not overlap.");
      }
      const [surfaceReadInjection] = surfaceReadInjections;
      if (surfaceReadInjection !== undefined) {
        const [kind, injection] = surfaceReadInjection;
        scriptLines.push(
          `    count="$(cat ${shellQuote(response.surfaceReadCountPath)})"`,
          "    count=$((count + 1))",
          `    printf '%s\\n' "$count" > ${shellQuote(response.surfaceReadCountPath)}`,
        );
        if (kind === "external-reconcile") {
          scriptLines.push(
            `    if [ "$count" -ge ${injection.read} ]; then printf '%s\\n' 'after' > ${cleanupStateFile}; fi`,
          );
        } else if (kind === "third-state") {
          scriptLines.push(
            `    if [ "$count" -ge ${injection.read} ]; then respond ${shellQuote(response.drifted)}; fi`,
          );
        } else {
          scriptLines.push(
            `    if [ "$count" -ge ${injection.read} ]; then printf '%s\\n' 'simulated prewrite cleanup surface read failure' >&2; exit 1; fi`,
          );
        }
      }
      scriptLines.push(
        `    case "$(cat ${cleanupStateFile})" in`,
        `      before) respond ${shellQuote(response.before)} ;;`,
        `      after) respond ${shellQuote(response.after)} ;;`,
        "      *) printf '%s\\n' 'invalid fake cleanup state' >&2; exit 2 ;;",
        "    esac ;;",
      );
    }
    scriptLines.push("esac");
  }
  if (notFoundEndpoints.length > 0) {
    scriptLines.push('case "$request" in');
    for (const request of notFoundEndpoints) {
      scriptLines.push(
        `  ${shellQuote(request)}) printf '%s\\n' 'gh: Not Found (HTTP 404)' >&2; exit 1 ;;`,
      );
    }
    scriptLines.push("esac");
  }
  if (cleanupIdentityResponse !== null) {
    scriptLines.push(
      `if [ "$request" = ${shellQuote(cleanupIdentityResponse.request)} ]; then`,
      `  count="$(cat ${shellQuote(cleanupIdentityReadCountPath)})"`,
      "  count=$((count + 1))",
      `  printf '%s\\n' "$count" > ${shellQuote(cleanupIdentityReadCountPath)}`,
      `  if [ "$count" -ge ${cleanupIdentityDriftAtMetadataRead} ]; then`,
      `    respond ${shellQuote(cleanupIdentityResponse.drifted)}`,
      "  fi",
      `  respond ${shellQuote(cleanupIdentityResponse.bound)}`,
      "fi",
    );
  }
  if (legacyWriterRaceResponses.length > 0) {
    scriptLines.push('case "$request" in');
    for (const response of legacyWriterRaceResponses) {
      scriptLines.push(
        `  ${shellQuote(response.request)})`,
        '    case "$(cat \"${FAKE_GH_LEGACY_WRITER_RACE_STATE:?}\")" in',
      );
      if (response.advance) {
        scriptLines.push(
          `      before) printf '%s\\n' 'after' > "\${FAKE_GH_LEGACY_WRITER_RACE_STATE:?}"; respond ${shellQuote(response.before)} ;;`,
        );
      } else {
        scriptLines.push(
          `      before) respond ${shellQuote(response.before)} ;;`,
        );
      }
      scriptLines.push(
        `      after) respond ${shellQuote(response.after)} ;;`,
        "      *) printf '%s\\n' 'invalid fake legacy writer race state' >&2; exit 2 ;;",
        "    esac ;;",
      );
    }
    scriptLines.push("esac");
  }
  if (delayedRequests.length > 0) {
    scriptLines.push('case "$request" in');
    for (const delayed of delayedRequests) {
      scriptLines.push(
        `  ${shellQuote(delayed.request)}) sleep ${shellQuote(String(delayed.seconds))} ;;`,
      );
    }
    scriptLines.push("esac");
  }
  scriptLines.push(
    `if [ "$request" = ${shellQuote(`GET:${legacyOnlyRepositoryEndpoint}`)} ]; then`,
    `  case "$(cat ${shellQuote(legacyOnlyIdentityStatePath)})" in`,
    `    bound) respond ${shellQuote(JSON.stringify(legacyOnlyRepositoryIdentity))} ;;`,
    `    unarchived) respond ${shellQuote(JSON.stringify(legacyOnlyRepositoryArchiveDrift))} ;;`,
    `    identity-drift) respond ${shellQuote(JSON.stringify(legacyOnlyRepositoryIdentityDrift))} ;;`,
    "    unreadable) printf '%s\\n' 'simulated legacy-only repository identity read failure' >&2; exit 1 ;;",
    "    *) printf '%s\\n' 'invalid fake legacy-only repository identity state' >&2; exit 2 ;;",
    "  esac",
    "fi",
  );
  scriptLines.push('case "$request" in');
  for (const [request, response] of responses.entries()) {
    scriptLines.push(`  ${shellQuote(request)}) respond ${shellQuote(response)} ;;`);
  }
  scriptLines.push(
    "esac",
    'printf \'%s\\n\' "unexpected fake gh request: $request" >&2',
    "exit 2",
    "",
  );

  writeFileSync(ghPath, scriptLines.join("\n"), { mode: 0o700 });
  writeFileSync(logPath, "");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(v2StatePath, "absent\n");
  writeFileSync(legacyStatePath, "before\n");
  writeFileSync(legacyOnlyIdentityStatePath, "bound\n");
  writeFileSync(cleanupStatePath, "before\n");
  writeFileSync(cleanupIdentityReadCountPath, "0\n");
  writeFileSync(legacyWriterRaceStatePath, "before\n");
  if (detailedCleanupState) {
    for (const action of cleanupActionStatePaths) {
      writeFileSync(action.path, "before\n");
    }
  }
  for (const path of cleanupSurfaceReadCountPaths) {
    writeFileSync(path, "0\n");
  }

  const previousEnvironment = new Map(
    [
      "PATH",
      "FAKE_GH_LOG",
      "FAKE_GH_V2_STATE",
      "FAKE_GH_LEGACY_STATE",
      "FAKE_GH_CLEANUP_STATE",
      "FAKE_GH_LEGACY_WRITER_RACE_STATE",
    ]
      .map((name) => [name, process.env[name]]),
  );
  process.env.PATH = `${directory}${delimiter}${process.env.PATH ?? ""}`;
  process.env.FAKE_GH_LOG = logPath;
  process.env.FAKE_GH_V2_STATE = v2StatePath;
  process.env.FAKE_GH_LEGACY_STATE = legacyStatePath;
  process.env.FAKE_GH_CLEANUP_STATE = cleanupStatePath;
  process.env.FAKE_GH_LEGACY_WRITER_RACE_STATE = legacyWriterRaceStatePath;
  t.after(() => {
    for (const [name, value] of previousEnvironment.entries()) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 10,
    });
  });

  return {
    manifest,
    manifestPath,
    logPath,
    v2StatePath,
    legacyStatePath,
    legacyOnlyIdentityStatePath,
    cleanupStatePath,
    cleanupIdentityReadCountPath,
    legacyWriterRaceStatePath,
    cleanupActionStatePaths,
    cleanupSurfaceReadCountPaths,
  };
}

function fakeGhRequests(logPath) {
  const text = readFileSync(logPath, "utf8").trim();
  if (text === "") return [];
  return text.split("\n").map((line) => {
    const [method, endpoint, ...bodyParts] = line.split("\t");
    const bodyText = bodyParts.join("\t");
    return {
      method,
      endpoint,
      body: bodyText === "" ? null : JSON.parse(bodyText),
    };
  });
}

function immediateStableRuntime({
  afterFirstStablePair = null,
  beforeFinalLegacyRevalidation = undefined,
} = {}) {
  let clock = 0;
  let nowCalls = 0;
  return {
    stableSnapshotOptions: {
      intervalMs: 5_000,
      timeoutMs: 60_000,
      now: () => {
        nowCalls += 1;
        if (nowCalls === 2 && afterFirstStablePair !== null) {
          afterFirstStablePair();
        }
        return clock;
      },
      sleep: async (milliseconds) => {
        clock += milliseconds;
      },
    },
    beforeFinalLegacyRevalidation,
    writeOutput: () => {},
  };
}

async function runFakeCli(
  harness,
  mode,
  extraArgs = [],
  runtime = immediateStableRuntime(),
) {
  return runCli(
    ["--manifest", harness.manifestPath, "--mode", mode, ...extraArgs],
    runtime,
  );
}

function mutationRequests(requests) {
  return requests.filter(
    ({ method, endpoint }) => method !== "GET" && endpoint !== "graphql",
  );
}

function countRequest(requests, method, endpoint) {
  return requests.filter(
    (request) => request.method === method && request.endpoint === endpoint,
  ).length;
}

test("exports the closed organization handoff protocol constants", () => {
  assert.equal(MANIFEST_SCHEMA_VERSION, "organization-review-gate-handoff-manifest/v2");
  assert.equal(OUTPUT_SCHEMA_VERSION, "organization-review-gate-handoff-output/v2");
  assert.equal(FINAL_CLOSURE_RECEIPT_SCHEMA_VERSION, 2);
  assert.equal(REQUIRED_REPOSITORY_COUNT, 10);
  assert.equal(LEGACY_SELECTOR_REPOSITORY_COUNT, 11);
  assert.equal(V2_RULESET_NAME, "Must Pass Codex Review v2");
  assert.equal(V2_STATUS_CONTEXT, "codex/github-review-gate");
  assert.equal(LEGACY_STATUS_CONTEXT, "codex/review-gate");
  assert.equal(GITHUB_ACTIONS_INTEGRATION_ID, 15368);
  assert.equal(CODEOWNERS_PATH, ".github/CODEOWNERS");
  assert.equal(V2_VERIFIER_RUN_NAME_PREFIX, "codex-review-gate-verifier");
  assert.deepEqual(CANONICAL_WORKFLOW_IDENTITIES, {
    verifier: {
      path: ".github/workflows/codex-review-gate.yml",
      git_blob_sha: "ac3aa30e5ae489ee81fbe8eb303bc06ecbf2b5af",
      sha256: "e3cb79b20483524303b84543921e6734de0dea13b1e37833bb0bf2b29dc6c74e",
    },
    controller: {
      path: ".github/workflows/codex-review-gate-controller.yml",
      git_blob_sha: "c994a6861414e1efc1e7ab376470c7709d475ef1",
      sha256: "e4135ae8a7e2c41b2f354f5955795c67e61aa10acb4953724e631d93f863907e",
    },
    legacy_bridge: {
      path: ".github/workflows/codex-review-gate-legacy-bridge.yml",
      git_blob_sha: "8a4e7af48dc50a33325185f7a0f35dbe22f788ba",
      sha256: "e2266e3ed116139f4272d0bf47188776455ea3be026225328bfb654ef74f02ef",
    },
  });
});

test("CLI help is read-only and invalid apply shapes fail before reading a manifest", () => {
  const help = spawnSync(process.execPath, [HANDOFF_SCRIPT, "--help"], {
    encoding: "utf8",
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /^Usage:/u);
  assert.match(help.stdout, /Every --apply requires the exact plan digest/u);
  assert.equal(help.stderr, "");

  const invalidMode = spawnSync(
    process.execPath,
    [
      HANDOFF_SCRIPT,
      "--manifest",
      "not-read.json",
      "--mode",
      "derive-cutover",
      "--apply",
      "--expected-plan-sha256",
      "a".repeat(64),
    ],
    { encoding: "utf8" },
  );
  assert.equal(invalidMode.status, 1);
  assert.equal(invalidMode.stdout, "");
  assert.match(
    invalidMode.stderr,
    /--apply is valid only with stage, activate, apply-repository-cleanup, or verify mode/u,
  );

  const missingDigest = spawnSync(
    process.execPath,
    [HANDOFF_SCRIPT, "--manifest", "not-read.json", "--mode", "stage", "--apply"],
    { encoding: "utf8" },
  );
  assert.equal(missingDigest.status, 1);
  assert.equal(missingDigest.stdout, "");
  assert.match(missingDigest.stderr, /--apply requires --expected-plan-sha256/u);
});

test("manifest admission uses one non-symlink regular-file descriptor and strict bytes", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "organization-handoff-manifest-"));
  t.after(() => rmSync(directory, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 10,
  }));
  const targetPath = join(directory, "target.json");
  const symlinkPath = join(directory, "manifest-link.json");
  const invalidUtf8Path = join(directory, "invalid-utf8.json");
  const invalidJsonPath = join(directory, "invalid-json.json");
  writeFileSync(targetPath, "{}\n");
  symlinkSync(targetPath, symlinkPath);
  writeFileSync(invalidUtf8Path, Buffer.from([0xff]));
  writeFileSync(invalidJsonPath, "{\n");

  const read = (manifestPath) => runCli(
    ["--manifest", manifestPath, "--mode", "plan"],
    immediateStableRuntime(),
  );
  await assert.rejects(read(symlinkPath), /regular, non-symlink file/u);
  await assert.rejects(read(invalidUtf8Path), /must be valid UTF-8/u);
  await assert.rejects(read(invalidJsonPath), /is not valid JSON/u);
});

test("CLI wire path uses fake gh for fail-closed stage, activation, and cutover", async (t) => {
  const harness = createFakeGhHarness(t);
  const boundManifest = clone(harness.manifest);
  const stagingManifest = clone(boundManifest);
  stagingManifest.v2_ruleset.id = null;
  writeFileSync(
    harness.manifestPath,
    `${JSON.stringify(stagingManifest, null, 2)}\n`,
  );

  const organizationRulesetsEndpoint =
    `orgs/${encodeURIComponent(boundManifest.organization.login)}/rulesets`;
  const organizationInventoryEndpoint =
    `${organizationRulesetsEndpoint}?per_page=100`;
  const v2RulesetEndpoint =
    `${organizationRulesetsEndpoint}/${boundManifest.v2_ruleset.id}`;
  const legacyRulesetEndpoint =
    `${organizationRulesetsEndpoint}/${boundManifest.legacy_ruleset.id}`;
  const legacyOnlyRepositoryEndpoint =
    `repos/${encodeEndpointPathForTest(
      boundManifest.legacy_ruleset.legacy_only_repository.slug,
    )}`;

  writeFileSync(harness.logPath, "");
  const plan = await runFakeCli(harness, "plan");
  assert.equal(plan.status, "verified");
  assert.equal(plan.v2_ruleset_state, "absent");
  assert.deepEqual(mutationRequests(fakeGhRequests(harness.logPath)), []);

  writeFileSync(harness.logPath, "");
  const stagePreview = await runFakeCli(harness, "stage");
  assert.equal(stagePreview.status, "preview");
  assert.deepEqual(stagePreview.action, {
    method: "POST",
    endpoint: organizationRulesetsEndpoint,
    payload: buildV2OrganizationRulesetPayload(stagingManifest, "disabled"),
    payload_sha256: sha256Canonical(
      buildV2OrganizationRulesetPayload(stagingManifest, "disabled"),
    ),
  });
  assert.deepEqual(
    stagePreview.action.payload,
    expectedOrganizationV2RulesetPayload(stagingManifest, "disabled"),
    "the staged organization payload must use the active 10-member cohort",
  );
  assert.deepEqual(mutationRequests(fakeGhRequests(harness.logPath)), []);

  writeFileSync(harness.logPath, "");
  const stageApplied = await runFakeCli(harness, "stage", [
    "--apply",
    "--expected-plan-sha256",
    stagePreview.plan_sha256,
  ]);
  assert.equal(stageApplied.status, "applied");
  assert.equal(stageApplied.created_v2_ruleset_id, boundManifest.v2_ruleset.id);
  let requests = fakeGhRequests(harness.logPath);
  let writes = mutationRequests(requests);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, "POST");
  assert.equal(writes[0].endpoint, organizationRulesetsEndpoint);
  assert.deepEqual(
    writes[0].body,
    buildV2OrganizationRulesetPayload(stagingManifest, "disabled"),
  );
  assert.deepEqual(
    writes[0].body,
    expectedOrganizationV2RulesetPayload(stagingManifest, "disabled"),
    "the stage POST body must be independently bound to the active cohort",
  );
  assert.equal(
    writes[0].body.conditions.repository_id.repository_ids.includes(
      ARCHIVED_LEGACY_ONLY_REPOSITORY_ID,
    ),
    false,
  );
  assert.deepEqual(writes[0].body.rules.map(({ type }) => type), [
    "required_status_checks",
  ]);
  assert.equal(writes[0].body.enforcement, "disabled");
  let mutationIndex = requests.findIndex(
    ({ method, endpoint }) => method !== "GET" && endpoint !== "graphql",
  );
  assert.ok(mutationIndex > 0);
  assert.ok(
    countRequest(
      requests.slice(0, mutationIndex),
      "GET",
      organizationInventoryEndpoint,
    ) >= 3,
    "stage POST must follow two stable reads plus immediate revalidation",
  );
  assert.ok(
    countRequest(
      requests.slice(mutationIndex + 1),
      "GET",
      organizationInventoryEndpoint,
    ) >= 2,
    "stage success must include two complete readback rounds",
  );

  writeFileSync(
    harness.manifestPath,
    `${JSON.stringify(boundManifest, null, 2)}\n`,
  );
  writeFileSync(harness.logPath, "");
  const stageExistingPreview = await runFakeCli(harness, "stage");
  assert.equal(stageExistingPreview.status, "verified");
  assert.equal(stageExistingPreview.applied, false);
  assert.equal(stageExistingPreview.action, null);
  assert.deepEqual(mutationRequests(fakeGhRequests(harness.logPath)), []);

  writeFileSync(harness.logPath, "");
  const stageExistingApply = await runFakeCli(harness, "stage", [
    "--apply",
    "--expected-plan-sha256",
    stageExistingPreview.plan_sha256,
  ]);
  assert.equal(stageExistingApply.status, "verified");
  assert.equal(stageExistingApply.applied, false);
  assert.equal(stageExistingApply.action, null);
  assert.deepEqual(
    mutationRequests(fakeGhRequests(harness.logPath)),
    [],
    "stage --apply must not rewrite an existing manifest-bound v2 ruleset",
  );

  writeFileSync(harness.logPath, "");
  const activatePreview = await runFakeCli(harness, "activate");
  assert.equal(activatePreview.status, "preview");
  assert.deepEqual(mutationRequests(fakeGhRequests(harness.logPath)), []);
  assert.deepEqual(activatePreview.coverage, {
    repositories_verified: REQUIRED_REPOSITORY_COUNT,
    required: REQUIRED_REPOSITORY_COUNT,
    legacy_bridge: true,
    v2: true,
  });

  writeFileSync(harness.logPath, "");
  const activateApplied = await runFakeCli(harness, "activate", [
    "--apply",
    "--expected-plan-sha256",
    activatePreview.plan_sha256,
  ]);
  assert.equal(activateApplied.status, "applied-dual-enforcement-verified");
  requests = fakeGhRequests(harness.logPath);
  writes = mutationRequests(requests);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, "PUT");
  assert.equal(writes[0].endpoint, v2RulesetEndpoint);
  assert.deepEqual(
    writes[0].body,
    buildV2OrganizationRulesetPayload(boundManifest, "active"),
  );
  assert.deepEqual(
    writes[0].body,
    expectedOrganizationV2RulesetPayload(boundManifest, "active"),
    "the activation PUT body must be independently bound to the active cohort",
  );
  assert.deepEqual(
    writes[0].body.conditions.repository_id.repository_ids,
    boundManifest.repositories.map((repository) => repository.id),
  );
  assert.equal(
    writes[0].body.conditions.repository_id.repository_ids.includes(
      ARCHIVED_LEGACY_ONLY_REPOSITORY_ID,
    ),
    false,
  );
  assert.equal(writes[0].body.enforcement, "active");
  assert.deepEqual(writes[0].body.rules.map(({ type }) => type), [
    "required_status_checks",
  ]);
  mutationIndex = requests.findIndex(
    ({ method, endpoint }) => method !== "GET" && endpoint !== "graphql",
  );
  const activationBefore = requests.slice(0, mutationIndex);
  const activationAfter = requests.slice(mutationIndex + 1);
  for (const [repositoryIndex, repository] of boundManifest.repositories.entries()) {
    const encodedSlug = encodeEndpointPathForTest(repository.slug);
    const bridgeEndpoint =
      `repos/${encodedSlug}/git/blobs/${repository.workflows.legacy_bridge.git_blob_sha}`;
    const legacyStatusEndpoint =
      `repos/${encodedSlug}/commits/${repository.canary.head_sha}/statuses?per_page=100`;
    const legacyWriterWorkflowIds = [
      repository.canary.v2_workflow_id,
      34000000 + repositoryIndex,
    ];
    assert.ok(
      countRequest(activationBefore, "GET", bridgeEndpoint) >= 3,
      `${repository.slug} bridge must be read in stable activation rounds and immediate revalidation`,
    );
    assert.ok(
      countRequest(activationBefore, "GET", legacyStatusEndpoint) >= 3,
      `${repository.slug} legacy commit status must be read in stable activation rounds and immediate revalidation`,
    );
    assert.ok(
      countRequest(activationAfter, "GET", bridgeEndpoint) >= 2,
      `${repository.slug} bridge must be read in both activation readback rounds`,
    );
    assert.ok(
      countRequest(activationAfter, "GET", legacyStatusEndpoint) >= 2,
      `${repository.slug} legacy status must survive both activation readback rounds`,
    );
    for (const workflowId of legacyWriterWorkflowIds) {
      const endpoint =
        `repos/${encodedSlug}/actions/workflows/${workflowId}/runs?per_page=100`;
      assert.ok(
        countRequest(activationBefore, "GET", `${endpoint}&page=1`) >= 3,
        `${repository.slug} legacy writer ${workflowId} must be drained from a complete unfiltered inventory before activation`,
      );
      const writerRunEndpoints = activationBefore
        .filter(
          (request) =>
            request.method === "GET" &&
            request.endpoint.startsWith(
              `repos/${encodedSlug}/actions/workflows/${workflowId}/runs?`,
            ),
        )
        .map((request) => request.endpoint);
      assert.ok(writerRunEndpoints.length >= 3);
      const writerRunPagePrefix = `${endpoint}&page=`;
      assert.ok(
        writerRunEndpoints.every(
          (candidate) =>
            candidate.startsWith(writerRunPagePrefix) &&
            /^[1-9][0-9]*$/u.test(candidate.slice(writerRunPagePrefix.length)),
        ),
        `${repository.slug} legacy writer ${workflowId} must scan exact unfiltered inventory pages`,
      );
    }
  }

  writeFileSync(harness.logPath, "");
  const activateActivePreview = await runFakeCli(harness, "activate");
  assert.equal(activateActivePreview.status, "verified-dual-enforcement");
  assert.equal(activateActivePreview.applied, false);
  assert.equal(activateActivePreview.action, null);
  assert.deepEqual(mutationRequests(fakeGhRequests(harness.logPath)), []);

  writeFileSync(harness.logPath, "");
  const activateActiveApply = await runFakeCli(harness, "activate", [
    "--apply",
    "--expected-plan-sha256",
    activateActivePreview.plan_sha256,
  ]);
  assert.equal(activateActiveApply.status, "verified-dual-enforcement");
  assert.equal(activateActiveApply.applied, false);
  assert.equal(activateActiveApply.action, null);
  assert.deepEqual(
    mutationRequests(fakeGhRequests(harness.logPath)),
    [],
    "activate --apply must not rewrite an already-active v2 organization ruleset",
  );

  writeFileSync(harness.logPath, "");
  const cutoverPlan = await runFakeCli(harness, "derive-cutover");
  assert.equal(cutoverPlan.status, "derived-read-only");
  assert.deepEqual(mutationRequests(fakeGhRequests(harness.logPath)), []);
  const expectedRepositoryActions = boundManifest.repositories.flatMap(
    (repository) => repository.legacy_cleanup.map((action) => {
      const derived = deriveRepositoryCleanupAction(action);
      const endpoint = action.surface === "repository_ruleset"
        ? `repos/${encodeEndpointPathForTest(repository.slug)}/rulesets/${action.ruleset_id}`
        : `repos/${encodeEndpointPathForTest(repository.slug)}/branches/${encodeURIComponent(repository.default_branch)}/protection/required_status_checks`;
      const method = derived.operation === "delete"
        ? "DELETE"
        : action.surface === "repository_ruleset"
          ? "PUT"
          : "PATCH";
      const expected = {
        repository: repository.slug,
        surface: action.surface,
        before_sha256: sha256Canonical(action.expected_before),
        after_sha256:
          action.expected_after === null
            ? null
            : sha256Canonical(action.expected_after),
        mutation: {
          method,
          endpoint,
        },
      };
      if (method !== "DELETE") {
        expected.mutation.payload = action.expected_after;
        expected.mutation.payload_sha256 = sha256Canonical(action.expected_after);
      }
      if (action.surface === "repository_ruleset") {
        expected.ruleset_id = action.ruleset_id;
      }
      return expected;
    }),
  );
  assert.equal(expectedRepositoryActions.length, 8);
  assert.deepEqual(cutoverPlan.external_repository_actions, expectedRepositoryActions);
  assert.deepEqual(cutoverPlan.sequencing, [
    "apply-repository-cleanup-preview",
    "apply-repository-cleanup-with-exact-plan-digest",
    "run-verify-preview",
    "run-verify-apply-with-exact-plan-digest",
    "run-verify-again-for-final-two-read-closure",
  ]);
  assert.deepEqual(cutoverPlan.organization_action_after_external_verification, {
    method: "PUT",
    endpoint: legacyRulesetEndpoint,
    payload: deriveLegacyOrganizationCutoverPayload(boundManifest),
    payload_sha256: sha256Canonical(
      deriveLegacyOrganizationCutoverPayload(boundManifest),
    ),
  });
  assert.deepEqual(
    cutoverPlan.organization_action_after_external_verification.payload,
    expectedLegacyOrganizationCutoverPayload(boundManifest),
    "the legacy cutover plan must retain the original 11-member selector",
  );
  assert.match(cutoverPlan.plan_sha256, /^[0-9a-f]{64}$/u);

  writeFileSync(harness.logPath, "");
  const cleanupPreview = await runFakeCli(harness, "apply-repository-cleanup");
  assert.equal(cleanupPreview.status, "preview");
  assert.equal(cleanupPreview.external_repository_actions.length, 8);
  assert.deepEqual(mutationRequests(fakeGhRequests(harness.logPath)), []);

  writeFileSync(harness.logPath, "");
  const cleanupApplied = await runFakeCli(harness, "apply-repository-cleanup", [
    "--apply",
    "--expected-plan-sha256",
    cleanupPreview.plan_sha256,
  ]);
  assert.equal(cleanupApplied.status, "applied-repository-cleanup-verified");
  writes = mutationRequests(fakeGhRequests(harness.logPath));
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, "PUT");

  writeFileSync(harness.logPath, "");
  const verifyPreview = await runFakeCli(harness, "verify");
  assert.equal(verifyPreview.status, "preview-cutover-ready");
  assert.deepEqual(mutationRequests(fakeGhRequests(harness.logPath)), []);

  writeFileSync(harness.logPath, "");
  await assert.rejects(
    runFakeCli(harness, "verify", [
      "--apply",
      "--expected-plan-sha256",
      "a".repeat(64),
    ]),
    /does not match this exact live plan/u,
  );
  assert.deepEqual(
    mutationRequests(fakeGhRequests(harness.logPath)),
    [],
    "a wrong plan digest must fail before any organization mutation",
  );

  writeFileSync(harness.logPath, "");
  const verifyApplied = await runFakeCli(harness, "verify", [
    "--apply",
    "--expected-plan-sha256",
    verifyPreview.plan_sha256,
  ]);
  assert.equal(verifyApplied.status, "applied-final-verified");
  requests = fakeGhRequests(harness.logPath);
  writes = mutationRequests(requests);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, "PUT");
  assert.equal(writes[0].endpoint, legacyRulesetEndpoint);
  assert.deepEqual(
    writes[0].body,
    deriveLegacyOrganizationCutoverPayload(boundManifest),
  );
  assert.deepEqual(
    writes[0].body,
    expectedLegacyOrganizationCutoverPayload(boundManifest),
    "the legacy cutover PUT body must be independently bound to the retained selector",
  );
  assert.deepEqual(
    writes[0].body.conditions.repository_id.repository_ids,
    LEGACY_SELECTOR_REPOSITORY_IDS,
  );
  assert.equal(
    writes[0].body.conditions.repository_id.repository_ids.includes(
      ARCHIVED_LEGACY_ONLY_REPOSITORY_ID,
    ),
    true,
  );
  assert.deepEqual(writes[0].body.rules, [
    { type: "deletion" },
    { type: "non_fast_forward" },
  ]);
  assert.equal(
    writes[0].body.rules.some(({ type }) => type === "required_status_checks"),
    false,
  );
  mutationIndex = requests.findIndex(
    ({ method, endpoint }) => method !== "GET" && endpoint !== "graphql",
  );
  const cutoverBefore = requests.slice(0, mutationIndex);
  const cutoverAfter = requests.slice(mutationIndex + 1);
  assert.ok(
    countRequest(cutoverBefore, "GET", legacyRulesetEndpoint) >= 4,
    "cutover must finish with a direct legacy organization ruleset read after full-cohort revalidation",
  );
  assert.ok(
    countRequest(cutoverBefore, "GET", legacyOnlyRepositoryEndpoint) >= 4,
    "cutover must stably observe the archived selector identity and reread it immediately before the legacy PUT",
  );
  assert.ok(
    countRequest(cutoverAfter, "GET", legacyOnlyRepositoryEndpoint) >= 2,
    "final closure must retain two stable archived-selector identity reads",
  );
  for (const repository of boundManifest.repositories) {
    for (const action of repository.legacy_cleanup) {
      const endpoint =
        `repos/${encodeEndpointPathForTest(repository.slug)}/rulesets/${action.ruleset_id}?includes_parents=false`;
      assert.ok(
        countRequest(cutoverBefore, "GET", endpoint) >= 3,
        `${repository.slug} cleanup must be stable and immediately revalidated before organization cutover`,
      );
      assert.ok(
        countRequest(cutoverAfter, "GET", endpoint) >= 2,
        `${repository.slug} cleanup must remain verified in both final rounds`,
      );
    }
  }

  writeFileSync(harness.logPath, "");
  const verifyCompletePreview = await runFakeCli(harness, "verify");
  assert.equal(verifyCompletePreview.schema_version, OUTPUT_SCHEMA_VERSION);
  assert.equal(verifyCompletePreview.status, "final-verified");
  assert.equal(verifyCompletePreview.applied, false);
  assert.equal(verifyCompletePreview.action, null);
  const expectedFinalClosureRepositories = boundManifest.repositories
    .map(({ slug, id, node_id, default_branch }) => ({
      full_name: slug,
      id,
      node_id,
      default_branch,
    }))
    .sort((left, right) =>
      Buffer.compare(
        Buffer.from(left.full_name, "utf8"),
        Buffer.from(right.full_name, "utf8"),
      )
    );
  assert.deepEqual(verifyCompletePreview.final_closure_receipt, {
    schema_version: FINAL_CLOSURE_RECEIPT_SCHEMA_VERSION,
    organization: boundManifest.organization,
    manifest_sha256: sha256Canonical(boundManifest),
    snapshot_sha256: verifyCompletePreview.snapshot_sha256,
    legacy_ruleset: {
      id: boundManifest.legacy_ruleset.id,
      state: "after",
    },
    v2_ruleset: {
      id: boundManifest.v2_ruleset.id,
      state: "active",
    },
    manifest_repositories: expectedFinalClosureRepositories,
    repositories: expectedFinalClosureRepositories,
  });
  assert.deepEqual(
    verifyCompletePreview.final_closure_receipt.manifest_repositories,
    verifyCompletePreview.final_closure_receipt.repositories,
    "the final receipt must bind its observed cohort to manifest.repositories",
  );
  assert.equal(
    verifyCompletePreview.final_closure_receipt.repositories.length,
    REQUIRED_REPOSITORY_COUNT,
  );
  for (const [field, repositories] of [
    ["repositories", verifyCompletePreview.final_closure_receipt.repositories],
    [
      "manifest_repositories",
      verifyCompletePreview.final_closure_receipt.manifest_repositories,
    ],
  ]) {
    assert.equal(
      repositories.some(
        ({ id, full_name, node_id }) =>
          id === ARCHIVED_LEGACY_ONLY_REPOSITORY_ID ||
          full_name === ARCHIVED_LEGACY_ONLY_REPOSITORY.slug ||
          node_id === ARCHIVED_LEGACY_ONLY_REPOSITORY.node_id,
      ),
      false,
      `the final receipt ${field} must not authorize the archived legacy-only repository`,
    );
  }
  assert.equal(
    verifyCompletePreview.final_closure_receipt_sha256,
    sha256Canonical(verifyCompletePreview.final_closure_receipt),
  );
  assert.deepEqual(
    validateOrganizationFinalClosureOutput(verifyCompletePreview)
      .bridgeRemovalRepositories,
    expectedFinalClosureRepositories,
    "the consumer must admit only the source producer's manifest-bound active cohort",
  );
  assert.deepEqual(mutationRequests(fakeGhRequests(harness.logPath)), []);

  writeFileSync(harness.logPath, "");
  const verifyCompleteApply = await runFakeCli(harness, "verify", [
    "--apply",
    "--expected-plan-sha256",
    verifyCompletePreview.plan_sha256,
  ]);
  assert.equal(verifyCompleteApply.status, "final-verified");
  assert.equal(verifyCompleteApply.applied, false);
  assert.equal(verifyCompleteApply.action, null);
  assert.equal(
    verifyCompleteApply.final_closure_receipt_sha256,
    verifyCompletePreview.final_closure_receipt_sha256,
  );
  assert.deepEqual(
    mutationRequests(fakeGhRequests(harness.logPath)),
    [],
    "verify --apply must not rewrite a completed legacy organization cutover",
  );

  writeFileSync(harness.v2StatePath, "absent\n");
  writeFileSync(harness.legacyStatePath, "drift\n");
  writeFileSync(harness.cleanupStatePath, "before\n");
  writeFileSync(
    harness.manifestPath,
    `${JSON.stringify(stagingManifest, null, 2)}\n`,
  );
  writeFileSync(harness.logPath, "");
  await assert.rejects(
    runFakeCli(harness, "stage", [
      "--apply",
      "--expected-plan-sha256",
      "a".repeat(64),
    ]),
    /drifted|missing or ambiguous|authorized snapshot/u,
  );
  assert.deepEqual(
    mutationRequests(fakeGhRequests(harness.logPath)),
    [],
    "manifest-bound organization drift must fail before any write",
  );
});

function configureDetailedCleanupHandoff(harness) {
  writeFileSync(
    harness.manifestPath,
    `${JSON.stringify(harness.manifest, null, 2)}\n`,
  );
  writeFileSync(harness.v2StatePath, "active\n");
  writeFileSync(harness.legacyStatePath, "before\n");
  writeFileSync(harness.cleanupStatePath, "before\n");
  for (const action of harness.cleanupActionStatePaths) {
    writeFileSync(action.path, "before\n");
  }
}

test("repository cleanup executor performs every pending action in serial exact-before/readback order", async (t) => {
  const harness = createFakeGhHarness(t, { detailedCleanupState: true });
  configureDetailedCleanupHandoff(harness);
  const preview = await runFakeCli(harness, "apply-repository-cleanup");
  assert.equal(preview.status, "preview");
  assert.equal(preview.external_repository_actions.length, 8);
  writeFileSync(harness.logPath, "");

  const applied = await runFakeCli(harness, "apply-repository-cleanup", [
    "--apply",
    "--expected-plan-sha256",
    preview.plan_sha256,
  ]);
  assert.equal(applied.status, "applied-repository-cleanup-verified");
  assert.deepEqual(
    applied.execution_outcomes.map((entry) => entry.outcome),
    Array(8).fill("applied"),
  );
  const writes = mutationRequests(fakeGhRequests(harness.logPath));
  assert.deepEqual(
    writes.map(({ method, endpoint }) => ({ method, endpoint })),
    harness.cleanupActionStatePaths.map(({ repository, surface }) => ({
      method: "PUT",
      endpoint: `repos/${encodeEndpointPathForTest(repository)}/rulesets/${surface.slice("repository_ruleset:".length)}`,
    })),
  );
  for (const action of harness.cleanupActionStatePaths) {
    assert.equal(readFileSync(action.path, "utf8"), "after\n");
  }
  const firstAction = harness.cleanupActionStatePaths[0];
  const firstRepositoryEndpoint =
    `repos/${encodeEndpointPathForTest(firstAction.repository)}`;
  const firstSurfaceEndpoint =
    `${firstRepositoryEndpoint}/rulesets/${firstAction.surface.slice("repository_ruleset:".length)}?includes_parents=false`;
  const firstMutationEndpoint =
    `${firstRepositoryEndpoint}/rulesets/${firstAction.surface.slice("repository_ruleset:".length)}`;
  const firstMutationIndex = fakeGhRequests(harness.logPath).findIndex(
    ({ method, endpoint }) =>
      method === "PUT" && endpoint === firstMutationEndpoint,
  );
  assert.ok(firstMutationIndex >= 4);
  assert.deepEqual(
    fakeGhRequests(harness.logPath)
      .slice(firstMutationIndex - 4, firstMutationIndex)
      .map(({ method, endpoint }) => ({ method, endpoint })),
    [
      { method: "GET", endpoint: firstRepositoryEndpoint },
      { method: "GET", endpoint: firstSurfaceEndpoint },
      { method: "GET", endpoint: firstSurfaceEndpoint },
      { method: "GET", endpoint: firstRepositoryEndpoint },
    ],
    "every cleanup write must follow a final exact surface read and then an adjacent identity check",
  );
});

test("repository cleanup executor rejects same-slug identity drift after its final surface reread", async (t) => {
  const harness = createFakeGhHarness(t, {
    detailedCleanupState: true,
    cleanupIdentityDriftAtMetadataRead: 5,
  });
  configureDetailedCleanupHandoff(harness);
  const preview = await runFakeCli(harness, "apply-repository-cleanup");
  writeFileSync(harness.logPath, "");
  writeFileSync(harness.cleanupIdentityReadCountPath, "0\n");

  await assert.rejects(
    runFakeCli(harness, "apply-repository-cleanup", [
      "--apply",
      "--expected-plan-sha256",
      preview.plan_sha256,
    ]),
    /repository cleanup identity after final surface read immediately before mutation drifted/u,
  );

  const requests = fakeGhRequests(harness.logPath);
  const firstAction = harness.cleanupActionStatePaths[0];
  const repositoryEndpoint =
    `repos/${encodeEndpointPathForTest(firstAction.repository)}`;
  const surfaceEndpoint =
    `${repositoryEndpoint}/rulesets/${firstAction.surface.slice("repository_ruleset:".length)}?includes_parents=false`;
  const firstActionRequests = requests.filter(
    ({ endpoint }) => endpoint === repositoryEndpoint || endpoint === surfaceEndpoint,
  );
  assert.deepEqual(
    firstActionRequests.slice(-4).map(({ method, endpoint }) => ({ method, endpoint })),
    [
      { method: "GET", endpoint: repositoryEndpoint },
      { method: "GET", endpoint: surfaceEndpoint },
      { method: "GET", endpoint: surfaceEndpoint },
      { method: "GET", endpoint: repositoryEndpoint },
    ],
    "the final identity check must follow the final surface reread and remain adjacent to mutation",
  );
  assert.deepEqual(
    mutationRequests(requests),
    [],
    "same-slug repository replacement after cohort revalidation must block every cleanup mutation",
  );
});

test("repository cleanup executor resumes a mixed checkpoint without rewriting reconciled actions", async (t) => {
  const harness = createFakeGhHarness(t, { detailedCleanupState: true });
  configureDetailedCleanupHandoff(harness);
  const reconciled = harness.cleanupActionStatePaths[0];
  writeFileSync(reconciled.path, "after\n");
  const preview = await runFakeCli(harness, "apply-repository-cleanup");
  assert.equal(preview.status, "preview");
  assert.equal(preview.completed_repository_cleanup_action_count, 1);
  assert.equal(preview.external_repository_actions.length, 7);
  writeFileSync(harness.logPath, "");

  const applied = await runFakeCli(harness, "apply-repository-cleanup", [
    "--apply",
    "--expected-plan-sha256",
    preview.plan_sha256,
  ]);
  assert.equal(applied.status, "applied-repository-cleanup-verified");
  const writes = mutationRequests(fakeGhRequests(harness.logPath));
  assert.equal(writes.length, 7);
  assert.equal(
    writes.some(
      (entry) =>
        entry.endpoint ===
        `repos/${encodeEndpointPathForTest(reconciled.repository)}/rulesets/${reconciled.surface.slice("repository_ruleset:".length)}`,
    ),
    false,
  );
});

test("repository cleanup executor recognizes an external exact-after checkpoint on its pre-write surface reread", async (t) => {
  const harness = createFakeGhHarness(t, {
    detailedCleanupState: true,
    cleanupExternalReconcileAtSurfaceRead: { ordinal: 0, read: 5 },
  });
  configureDetailedCleanupHandoff(harness);
  const preview = await runFakeCli(harness, "apply-repository-cleanup");
  for (const path of harness.cleanupSurfaceReadCountPaths) {
    writeFileSync(path, "0\n");
  }
  writeFileSync(harness.logPath, "");

  const applied = await runFakeCli(harness, "apply-repository-cleanup", [
    "--apply",
    "--expected-plan-sha256",
    preview.plan_sha256,
  ]);
  assert.equal(applied.status, "applied-repository-cleanup-verified");
  assert.equal(
    applied.execution_outcomes[0].outcome,
    "already-reconciled-immediately-before-write",
  );
  const firstAction = harness.cleanupActionStatePaths[0];
  const firstMutationEndpoint =
    `repos/${encodeEndpointPathForTest(firstAction.repository)}/rulesets/${firstAction.surface.slice("repository_ruleset:".length)}`;
  assert.equal(
    mutationRequests(fakeGhRequests(harness.logPath)).some(
      ({ endpoint }) => endpoint === firstMutationEndpoint,
    ),
    false,
    "a live exact-after checkpoint found at the final surface reread must not be overwritten",
  );
});

test("repository cleanup executor rejects a third state at its final pre-write surface reread", async (t) => {
  const harness = createFakeGhHarness(t, {
    detailedCleanupState: true,
    cleanupPrewriteSurfaceDriftAtRead: { ordinal: 0, read: 5 },
  });
  configureDetailedCleanupHandoff(harness);
  const preview = await runFakeCli(harness, "apply-repository-cleanup");
  for (const path of harness.cleanupSurfaceReadCountPaths) {
    writeFileSync(path, "0\n");
  }
  writeFileSync(harness.logPath, "");

  await assert.rejects(
    runFakeCli(harness, "apply-repository-cleanup", [
      "--apply",
      "--expected-plan-sha256",
      preview.plan_sha256,
    ]),
    /Repository legacy cleanup surface matches neither bound snapshot\./u,
  );

  assert.deepEqual(
    mutationRequests(fakeGhRequests(harness.logPath)),
    [],
    "a concurrent third state found at the final surface reread must fail closed before any cleanup mutation",
  );
});

test("repository cleanup executor surfaces a final pre-write read failure without write recovery", async (t) => {
  const harness = createFakeGhHarness(t, {
    detailedCleanupState: true,
    cleanupPrewriteSurfaceFailureAtRead: { ordinal: 0, read: 5 },
  });
  configureDetailedCleanupHandoff(harness);
  const preview = await runFakeCli(harness, "apply-repository-cleanup");
  for (const path of harness.cleanupSurfaceReadCountPaths) {
    writeFileSync(path, "0\n");
  }
  writeFileSync(harness.logPath, "");

  await assert.rejects(
    runFakeCli(harness, "apply-repository-cleanup", [
      "--apply",
      "--expected-plan-sha256",
      preview.plan_sha256,
    ]),
    (error) => {
      assert.match(error.message, /simulated prewrite cleanup surface read failure/u);
      assert.doesNotMatch(error.message, /reconciled-after-write-error/u);
      return true;
    },
  );

  assert.deepEqual(
    mutationRequests(fakeGhRequests(harness.logPath)),
    [],
    "a failed final surface read must not send a mutation or enter write-error recovery",
  );
});

test("repository cleanup executor reconciles an ambiguous write only after exact after-state readback", async (t) => {
  const harness = createFakeGhHarness(t, {
    detailedCleanupState: true,
    cleanupMutationErrorAt: 2,
  });
  configureDetailedCleanupHandoff(harness);
  const preview = await runFakeCli(harness, "apply-repository-cleanup");
  writeFileSync(harness.logPath, "");

  const applied = await runFakeCli(harness, "apply-repository-cleanup", [
    "--apply",
    "--expected-plan-sha256",
    preview.plan_sha256,
  ]);
  assert.equal(applied.status, "applied-repository-cleanup-verified");
  assert.equal(
    applied.execution_outcomes[2].outcome,
    "reconciled-after-write-error",
  );
  assert.equal(mutationRequests(fakeGhRequests(harness.logPath)).length, 8);
});

test("repository cleanup executor stops after a write that remains before-state", async (t) => {
  const harness = createFakeGhHarness(t, {
    detailedCleanupState: true,
    cleanupMutationFailureAt: 2,
  });
  configureDetailedCleanupHandoff(harness);
  const preview = await runFakeCli(harness, "apply-repository-cleanup");
  writeFileSync(harness.logPath, "");

  await assert.rejects(
    runFakeCli(harness, "apply-repository-cleanup", [
      "--apply",
      "--expected-plan-sha256",
      preview.plan_sha256,
    ]),
    /did not reach its expected-after state/u,
  );
  const writes = mutationRequests(fakeGhRequests(harness.logPath));
  assert.equal(writes.length, 3);
  assert.deepEqual(
    writes.map(({ endpoint }) => endpoint),
    harness.cleanupActionStatePaths.slice(0, 3).map(
      ({ repository, surface }) =>
        `repos/${encodeEndpointPathForTest(repository)}/rulesets/${surface.slice("repository_ruleset:".length)}`,
    ),
  );
  assert.equal(readFileSync(harness.cleanupActionStatePaths[0].path, "utf8"), "after\n");
  assert.equal(readFileSync(harness.cleanupActionStatePaths[1].path, "utf8"), "after\n");
  assert.equal(readFileSync(harness.cleanupActionStatePaths[2].path, "utf8"), "before\n");
});

test("stage adopts an exact uniquely created disabled v2 ruleset after an ambiguous POST response", async (t) => {
  const harness = createFakeGhHarness(t, { stageCreateResponse: "invalid" });
  const unboundManifest = clone(harness.manifest);
  unboundManifest.v2_ruleset.id = null;
  writeFileSync(harness.manifestPath, `${JSON.stringify(unboundManifest, null, 2)}\n`);
  writeFileSync(harness.v2StatePath, "absent\n");
  writeFileSync(harness.legacyStatePath, "before\n");
  writeFileSync(harness.cleanupStatePath, "before\n");

  const preview = await runFakeCli(harness, "stage");
  writeFileSync(harness.logPath, "");
  const recovered = await runFakeCli(harness, "stage", [
    "--apply",
    "--expected-plan-sha256",
    preview.plan_sha256,
  ]);
  assert.equal(recovered.status, "applied-recovered");
  assert.equal(recovered.applied, true);
  assert.equal(recovered.created_v2_ruleset_id, harness.manifest.v2_ruleset.id);
  assert.equal(
    mutationRequests(fakeGhRequests(harness.logPath)).filter(
      ({ method, endpoint }) =>
        method === "POST" &&
        endpoint === `orgs/${encodeURIComponent(harness.manifest.organization.login)}/rulesets`,
    ).length,
    1,
    "an ambiguous create response must be reconciled, never replayed",
  );

  writeFileSync(harness.logPath, "");
  const explicitRecovery = await runFakeCli(harness, "stage", [
    "--recover-created-v2",
  ]);
  assert.equal(explicitRecovery.status, "recovered-created-v2");
  assert.equal(explicitRecovery.created_v2_ruleset_id, harness.manifest.v2_ruleset.id);
  assert.deepEqual(mutationRequests(fakeGhRequests(harness.logPath)), []);
});

test("stage recovery rejects absent or active candidates without sending a POST", async (t) => {
  const harness = createFakeGhHarness(t);
  const unboundManifest = clone(harness.manifest);
  unboundManifest.v2_ruleset.id = null;
  writeFileSync(harness.manifestPath, `${JSON.stringify(unboundManifest, null, 2)}\n`);
  for (const v2State of ["absent", "active"]) {
    writeFileSync(harness.v2StatePath, `${v2State}\n`);
    writeFileSync(harness.legacyStatePath, "before\n");
    writeFileSync(harness.cleanupStatePath, "before\n");
    writeFileSync(harness.logPath, "");
    await assert.rejects(
      runFakeCli(harness, "stage", ["--recover-created-v2"]),
      /recovery|recover|disabled|missing/u,
    );
    assert.deepEqual(
      mutationRequests(fakeGhRequests(harness.logPath)),
      [],
      `${v2State} stage recovery must remain read-only`,
    );
  }
});

test("effective inherited legacy context on a later page blocks activation", async (t) => {
  const harness = createFakeGhHarness(t, {
    extraEffectiveSecondPageRules: [
      effectiveStatusRule({
        id: 99999991,
        sourceType: "Enterprise",
        source: "Joey-Enterprise",
        context: LEGACY_STATUS_CONTEXT,
      }),
    ],
  });
  writeFileSync(harness.manifestPath, `${JSON.stringify(harness.manifest, null, 2)}\n`);
  writeFileSync(harness.v2StatePath, "disabled\n");
  writeFileSync(harness.legacyStatePath, "before\n");
  writeFileSync(harness.cleanupStatePath, "before\n");
  writeFileSync(harness.logPath, "");
  await assert.rejects(
    runFakeCli(harness, "activate"),
    /unmanifested legacy context/u,
  );
  assert.deepEqual(mutationRequests(fakeGhRequests(harness.logPath)), []);
});

test("case-variant inherited legacy context blocks activation", async (t) => {
  const harness = createFakeGhHarness(t, {
    extraEffectiveRules: [
      effectiveStatusRule({
        id: 99999992,
        sourceType: "Organization",
        source: ORGANIZATION.login,
        context: "Codex/Review-Gate",
      }),
    ],
  });
  writeFileSync(harness.manifestPath, `${JSON.stringify(harness.manifest, null, 2)}\n`);
  writeFileSync(harness.v2StatePath, "disabled\n");
  writeFileSync(harness.legacyStatePath, "before\n");
  writeFileSync(harness.cleanupStatePath, "before\n");
  writeFileSync(harness.logPath, "");
  await assert.rejects(
    runFakeCli(harness, "activate"),
    /canonical spelling codex\/review-gate/u,
  );
  assert.deepEqual(mutationRequests(fakeGhRequests(harness.logPath)), []);
});

test("an effective local legacy rule remaining after its cleanup blocks cutover", async (t) => {
  const firstCleanupRuleId = REPOSITORIES[0][2];
  const harness = createFakeGhHarness(t, {
    extraEffectiveRules: [
      effectiveStatusRule({
        id: firstCleanupRuleId,
        sourceType: "Repository",
        source: `${ORGANIZATION.login}/${REPOSITORIES[0][0]}`,
        context: LEGACY_STATUS_CONTEXT,
      }),
    ],
  });
  writeFileSync(harness.manifestPath, `${JSON.stringify(harness.manifest, null, 2)}\n`);
  writeFileSync(harness.v2StatePath, "active\n");
  writeFileSync(harness.legacyStatePath, "before\n");
  writeFileSync(harness.cleanupStatePath, "after\n");
  writeFileSync(harness.logPath, "");
  await assert.rejects(
    runFakeCli(harness, "derive-cutover"),
    /still requires the legacy context after its cleanup/u,
  );
  assert.deepEqual(mutationRequests(fakeGhRequests(harness.logPath)), []);
});

test("an active v2 rule with a mismatched inherited source blocks cutover", async (t) => {
  const harness = createFakeGhHarness(t, {
    mutateEffectiveRules: (rules, { v2State }) =>
      v2State === "active"
        ? rules.map((rule) =>
            rule.ruleset_id === 26590367
              ? { ...rule, ruleset_source: "Other-Organization" }
              : rule,
          )
        : rules,
  });
  writeFileSync(harness.manifestPath, `${JSON.stringify(harness.manifest, null, 2)}\n`);
  writeFileSync(harness.v2StatePath, "active\n");
  writeFileSync(harness.legacyStatePath, "before\n");
  writeFileSync(harness.cleanupStatePath, "after\n");
  writeFileSync(harness.logPath, "");
  await assert.rejects(
    runFakeCli(harness, "derive-cutover"),
    /exactly one effective manifest-bound v2 organization status rule/u,
  );
  assert.deepEqual(mutationRequests(fakeGhRequests(harness.logPath)), []);
});

test("verify apply revalidates the full cohort and legacy rule immediately before PUT", async (t) => {
  const harness = createFakeGhHarness(t);
  writeFileSync(
    harness.manifestPath,
    `${JSON.stringify(harness.manifest, null, 2)}\n`,
  );
  writeFileSync(harness.v2StatePath, "active\n");
  writeFileSync(harness.legacyStatePath, "before\n");
  writeFileSync(harness.cleanupStatePath, "after\n");
  const preview = await runFakeCli(harness, "verify");
  assert.equal(preview.status, "preview-cutover-ready");

  const applyArguments = [
    "--apply",
    "--expected-plan-sha256",
    preview.plan_sha256,
  ];
  const cases = [
    {
      name: "repository cleanup regresses after the stable pair",
      runtime: () => immediateStableRuntime({
        afterFirstStablePair: () => {
          writeFileSync(harness.cleanupStatePath, "before\n");
        },
      }),
      error: /changed after the stable plan snapshot/u,
    },
    {
      name: "v2 organization enforcement regresses after the stable pair",
      runtime: () => immediateStableRuntime({
        afterFirstStablePair: () => {
          writeFileSync(harness.v2StatePath, "disabled\n");
        },
      }),
      error: /changed after the stable plan snapshot/u,
    },
    {
      name: "legacy organization rule drifts after full-cohort revalidation",
      runtime: () => immediateStableRuntime({
        beforeFinalLegacyRevalidation: () => {
          writeFileSync(harness.legacyStatePath, "drift\n");
        },
      }),
      error: /changed after full-cohort revalidation/u,
    },
  ];
  for (const driftCase of cases) {
    await t.test(driftCase.name, async () => {
      writeFileSync(harness.v2StatePath, "active\n");
      writeFileSync(harness.legacyStatePath, "before\n");
      writeFileSync(harness.cleanupStatePath, "after\n");
      writeFileSync(harness.logPath, "");
      await assert.rejects(
        runFakeCli(
          harness,
          "verify",
          applyArguments,
          driftCase.runtime(),
        ),
        driftCase.error,
      );
      assert.deepEqual(
        mutationRequests(fakeGhRequests(harness.logPath)),
        [],
        "observed pre-write drift must fail before the legacy organization PUT",
      );
    });
  }
});

test("verify apply fails closed when the retained archived selector cannot be revalidated immediately before PUT", async (t) => {
  const harness = createFakeGhHarness(t);
  writeFileSync(
    harness.manifestPath,
    `${JSON.stringify(harness.manifest, null, 2)}\n`,
  );
  writeFileSync(harness.v2StatePath, "active\n");
  writeFileSync(harness.legacyStatePath, "before\n");
  writeFileSync(harness.cleanupStatePath, "after\n");
  writeFileSync(harness.legacyOnlyIdentityStatePath, "bound\n");
  const preview = await runFakeCli(harness, "verify");
  assert.equal(preview.status, "preview-cutover-ready");

  const legacyOnlyRepositoryEndpoint =
    `repos/${encodeEndpointPathForTest(
      harness.manifest.legacy_ruleset.legacy_only_repository.slug,
    )}`;
  const applyArguments = [
    "--apply",
    "--expected-plan-sha256",
    preview.plan_sha256,
  ];
  const cases = [
    { name: "live archive flag becomes false", state: "unarchived" },
    { name: "same-slug live node identity drifts", state: "identity-drift" },
    { name: "live archive identity becomes unreadable", state: "unreadable" },
  ];
  for (const driftCase of cases) {
    await t.test(driftCase.name, async () => {
      writeFileSync(harness.v2StatePath, "active\n");
      writeFileSync(harness.legacyStatePath, "before\n");
      writeFileSync(harness.cleanupStatePath, "after\n");
      writeFileSync(harness.legacyOnlyIdentityStatePath, "bound\n");
      writeFileSync(harness.logPath, "");
      await assert.rejects(
        runFakeCli(
          harness,
          "verify",
          applyArguments,
          immediateStableRuntime({
            beforeFinalLegacyRevalidation: () => {
              writeFileSync(
                harness.legacyOnlyIdentityStatePath,
                `${driftCase.state}\n`,
              );
            },
          }),
        ),
        /legacy-only archived repository could not be read immediately before cutover; no mutation was sent/u,
      );
      const requests = fakeGhRequests(harness.logPath);
      assert.deepEqual(
        mutationRequests(requests),
        [],
        "an unreadable or mismatched archived selector identity must block the legacy organization PUT",
      );
      assert.deepEqual(requests.at(-1), {
        method: "GET",
        endpoint: legacyOnlyRepositoryEndpoint,
        body: null,
      });
    });
  }
});

test("live workflow inventory rejects an additional v2 caller before activate or verify writes", async (t) => {
  const harness = createFakeGhHarness(t, {
    extraWorkflow: {
      path: ".github/workflows/extra-v2.yml",
      content:
        "jobs:\n  gate:\n    uses: JoeyTeng/codex-review-gate-action@v2\n",
    },
  });
  writeFileSync(
    harness.manifestPath,
    `${JSON.stringify(harness.manifest, null, 2)}\n`,
  );

  for (const phase of [
    { mode: "activate", v2: "disabled", cleanup: "before" },
    { mode: "verify", v2: "active", cleanup: "after" },
  ]) {
    writeFileSync(harness.v2StatePath, `${phase.v2}\n`);
    writeFileSync(harness.legacyStatePath, "before\n");
    writeFileSync(harness.cleanupStatePath, `${phase.cleanup}\n`);
    writeFileSync(harness.logPath, "");
    await assert.rejects(
      runFakeCli(harness, phase.mode, [
        "--apply",
        "--expected-plan-sha256",
        "a".repeat(64),
      ]),
      /Additional v1\/v2 gate callers remain.*extra-v2\.yml/u,
    );
    assert.deepEqual(
      mutationRequests(fakeGhRequests(harness.logPath)),
      [],
      `${phase.mode} must not write with an unclosed workflow producer inventory`,
    );
  }
});

test("live workflow inventory rejects nested or non-regular entries", async (t) => {
  const harness = createFakeGhHarness(t, { unexpectedWorkflowTree: true });
  writeFileSync(
    harness.manifestPath,
    `${JSON.stringify(harness.manifest, null, 2)}\n`,
  );
  writeFileSync(harness.v2StatePath, "disabled\n");
  writeFileSync(harness.legacyStatePath, "before\n");
  writeFileSync(harness.cleanupStatePath, "before\n");
  writeFileSync(harness.logPath, "");
  await assert.rejects(
    runFakeCli(harness, "activate", [
      "--apply",
      "--expected-plan-sha256",
      "a".repeat(64),
    ]),
    /unsupported non-regular entry; workflow inventory is inconclusive/u,
  );
  assert.deepEqual(
    mutationRequests(fakeGhRequests(harness.logPath)),
    [],
    "an unsupported workflow-directory entry must fail before activation",
  );
});

test("a newer case-variant legacy status blocks activation before any write", async (t) => {
  const harness = createFakeGhHarness(t, {
    newerLegacyStatusContext: "CODEX/REVIEW-GATE",
  });
  writeFileSync(
    harness.manifestPath,
    `${JSON.stringify(harness.manifest, null, 2)}\n`,
  );
  writeFileSync(harness.v2StatePath, "disabled\n");
  writeFileSync(harness.legacyStatePath, "before\n");
  writeFileSync(harness.cleanupStatePath, "before\n");
  writeFileSync(harness.logPath, "");
  await assert.rejects(
    runFakeCli(harness, "activate", [
      "--apply",
      "--expected-plan-sha256",
      "a".repeat(64),
    ]),
    /latest case-insensitive legacy commit-status context must use the exact canonical spelling/u,
  );
  assert.deepEqual(
    mutationRequests(fakeGhRequests(harness.logPath)),
    [],
    "a newer case-variant status must fail before activation",
  );
});

test("live Actions default-write policy blocks activate and verify writes", async (t) => {
  const harness = createFakeGhHarness(t, {
    defaultWorkflowPermissions: "write",
  });
  writeFileSync(
    harness.manifestPath,
    `${JSON.stringify(harness.manifest, null, 2)}\n`,
  );
  for (const phase of [
    { mode: "activate", v2: "disabled", cleanup: "before" },
    { mode: "verify", v2: "active", cleanup: "after" },
  ]) {
    writeFileSync(harness.v2StatePath, `${phase.v2}\n`);
    writeFileSync(harness.legacyStatePath, "before\n");
    writeFileSync(harness.cleanupStatePath, `${phase.cleanup}\n`);
    writeFileSync(harness.logPath, "");
    await assert.rejects(
      runFakeCli(harness, phase.mode, [
        "--apply",
        "--expected-plan-sha256",
        "a".repeat(64),
      ]),
      /default permissions set to read/u,
    );
    assert.deepEqual(
      mutationRequests(fakeGhRequests(harness.logPath)),
      [],
      `${phase.mode} must not write while unrelated workflows inherit write permission`,
    );
  }
});

test("canary closure is rejected before activation", async (t) => {
  const harness = createFakeGhHarness(t, { canaryState: "closed" });
  writeFileSync(
    harness.manifestPath,
    `${JSON.stringify(harness.manifest, null, 2)}\n`,
  );
  writeFileSync(harness.v2StatePath, "disabled\n");
  writeFileSync(harness.legacyStatePath, "before\n");
  writeFileSync(harness.cleanupStatePath, "before\n");
  writeFileSync(harness.logPath, "");
  await assert.rejects(
    runFakeCli(harness, "activate", [
      "--apply",
      "--expected-plan-sha256",
      "a".repeat(64),
    ]),
    /exact open, mergeable, non-draft, same-repository, current-base PR\/head\/test-merge/u,
  );
  assert.deepEqual(mutationRequests(fakeGhRequests(harness.logPath)), []);
});

test("activation sends GraphQL canary queries with exact owner, repository, and PR number", async (t) => {
  const harness = createFakeGhHarness(t);
  writeFileSync(
    harness.manifestPath,
    `${JSON.stringify(harness.manifest, null, 2)}\n`,
  );
  writeFileSync(harness.v2StatePath, "disabled\n");
  writeFileSync(harness.legacyStatePath, "before\n");
  writeFileSync(harness.cleanupStatePath, "before\n");
  writeFileSync(harness.logPath, "");

  const preview = await runFakeCli(harness, "activate");
  assert.equal(preview.status, "preview");
  const expected = new Map(
    harness.manifest.repositories.map((repository) => {
      const [owner, name] = repository.slug.split("/");
      return [name, { owner, name, number: repository.canary.pull_number }];
    }),
  );
  const requests = fakeGhRequests(harness.logPath).filter(
    ({ method, endpoint }) => method === "POST" && endpoint === "graphql",
  );
  assert.ok(requests.length >= harness.manifest.repositories.length * 2);
  for (const request of requests) {
    assert.deepEqual(request.body.variables, expected.get(request.body.variables.name));
  }
});

test("post-activation cutover accepts canaries that were closed unmerged", async (t) => {
  const harness = createFakeGhHarness(t, { canaryState: "closed" });
  writeFileSync(
    harness.manifestPath,
    `${JSON.stringify(harness.manifest, null, 2)}\n`,
  );
  writeFileSync(harness.v2StatePath, "active\n");
  writeFileSync(harness.legacyStatePath, "before\n");
  writeFileSync(harness.cleanupStatePath, "before\n");
  writeFileSync(harness.logPath, "");
  const derived = await runFakeCli(harness, "derive-cutover");
  assert.equal(derived.status, "derived-read-only");
  let requests = fakeGhRequests(harness.logPath);
  assert.deepEqual(mutationRequests(requests), []);
  for (const repository of harness.manifest.repositories) {
    assert.equal(
      countRequest(
        requests,
        "GET",
        `repos/${encodeEndpointPathForTest(repository.slug)}/pulls/${repository.canary.pull_number}`,
      ),
      0,
      "post-activation derivation must not depend on a live canary PR",
    );
  }

  writeFileSync(harness.cleanupStatePath, "after\n");
  writeFileSync(harness.logPath, "");
  const verified = await runFakeCli(harness, "verify");
  assert.equal(verified.status, "preview-cutover-ready");
  requests = fakeGhRequests(harness.logPath);
  assert.deepEqual(mutationRequests(requests), []);
  for (const repository of harness.manifest.repositories) {
    assert.equal(
      countRequest(
        requests,
        "GET",
        `repos/${encodeEndpointPathForTest(repository.slug)}/pulls/${repository.canary.pull_number}`,
      ),
      0,
      "post-activation verification must not depend on a live canary PR",
    );
  }
});

test("post-activation closure binds control-plane reads to the current default head", async (t) => {
  const currentHead = "f".repeat(40);
  const harness = createFakeGhHarness(t, { postActivationHeadSha: currentHead });
  writeFileSync(
    harness.manifestPath,
    `${JSON.stringify(harness.manifest, null, 2)}\n`,
  );
  writeFileSync(harness.v2StatePath, "active\n");
  writeFileSync(harness.legacyStatePath, "before\n");
  writeFileSync(harness.cleanupStatePath, "before\n");
  writeFileSync(harness.logPath, "");

  const derived = await runFakeCli(harness, "derive-cutover");
  assert.equal(derived.status, "derived-read-only");
  const requests = fakeGhRequests(harness.logPath);
  for (const repository of harness.manifest.repositories) {
    const encodedSlug = encodeEndpointPathForTest(repository.slug);
    assert.ok(
      countRequest(
        requests,
        "GET",
        `repos/${encodedSlug}/git/trees/${currentHead}`,
      ) >= 2,
      `${repository.slug} must read each stable-round workflow tree at the current default head`,
    );
    assert.ok(
      countRequest(
        requests,
        "GET",
        `repos/${encodedSlug}/contents/${encodeEndpointPathForTest(repository.codeowners.path)}?ref=${encodeURIComponent(currentHead)}`,
      ) >= 2,
      `${repository.slug} must read CODEOWNERS at the same current immutable head`,
    );
  }
});

test("canonical JSON is byte-stable across object insertion order but preserves arrays", () => {
  const left = {
    z: 9,
    nested: { omega: true, alpha: 1 },
    array: [{ z: 2, a: 1 }, "tail"],
    omitted: undefined,
  };
  const right = {
    array: [{ a: 1, z: 2 }, "tail"],
    nested: { alpha: 1, omega: true },
    z: 9,
  };
  assert.equal(
    canonicalJson(left),
    '{"array":[{"a":1,"z":2},"tail"],"nested":{"alpha":1,"omega":true},"z":9}',
  );
  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.equal(sha256Canonical(left), sha256Canonical(right));
  assert.notEqual(canonicalJson(left), canonicalJson({ ...right, array: ["tail", { a: 1, z: 2 }] }));
});

test("stable snapshot reads wait between reads and restart after observed drift", async () => {
  const snapshots = [
    { generation: 1, nested: { value: "old" } },
    { generation: 2, nested: { value: "new" } },
    { nested: { value: "new" }, generation: 2 },
    { generation: 2, nested: { value: "new" } },
  ];
  let reads = 0;
  let clock = 0;
  const sleeps = [];
  const stable = await loadStableSnapshots(
    "test cohort",
    async () => clone(snapshots[reads++]),
    {
      now: () => clock,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        clock += milliseconds;
      },
    },
  );

  assert.deepEqual(stable, snapshots[2]);
  assert.equal(reads, 4, "a changed pair must be discarded, not reused as stable evidence");
  assert.deepEqual(sleeps, [5_000, 5_000]);
});

test("perpetually changing snapshots stop inconclusive at the bounded deadline", async () => {
  let generation = 0;
  let clock = 0;
  let writes = 0;
  await assert.rejects(
    async () => {
      await loadStableSnapshots(
        "test cohort",
        async () => ({ generation: generation++ }),
        {
          now: () => clock,
          sleep: async (milliseconds) => {
            clock += milliseconds;
          },
        },
      );
      writes += 1;
    },
    /remained unstable for 60000ms; the result is inconclusive and no next write is allowed/u,
  );
  assert.equal(generation, 24, "60 seconds permits twelve five-second read pairs");
  assert.equal(writes, 0, "an inconclusive read must never reach the following write");
});

test("stable snapshot configuration rejects unbounded or malformed timing", async () => {
  const loader = async () => ({ stable: true });
  for (const options of [
    { intervalMs: -1, timeoutMs: 60_000 },
    { intervalMs: 5_000, timeoutMs: 4_999 },
    { intervalMs: 1.5, timeoutMs: 60_000 },
    { intervalMs: 5_000, timeoutMs: Number.MAX_SAFE_INTEGER + 1 },
    { intervalMs: 5_000, timeoutMs: 60_000, sleep: null },
  ]) {
    await assert.rejects(
      loadStableSnapshots("test cohort", loader, options),
      /configuration is invalid/u,
    );
  }
});

test("default-branch evidence rejects an outdated canary base", () => {
  const repo = manifestFixture().repositories[0];
  assert.deepEqual(
    validateDefaultBranchResponse({
      name: repo.default_branch,
      commit: { sha: repo.canary.base_sha },
    }, repo),
    {
      name: repo.default_branch,
      head_sha: repo.canary.base_sha,
    },
  );
  assert.throws(
    () => validateDefaultBranchResponse({
      name: repo.default_branch,
      commit: { sha: "f".repeat(40) },
    }, repo),
    /default branch no longer matches the manifest-bound canary base/u,
  );
  assert.throws(
    () => validateDefaultBranchResponse({
      name: "renamed-default",
      commit: { sha: repo.canary.base_sha },
    }, repo),
    /default branch no longer matches the manifest-bound canary base/u,
  );
});

test("post-activation default-branch evidence accepts a current immutable head", () => {
  const repo = manifestFixture().repositories[0];
  const currentHead = "f".repeat(40);
  assert.deepEqual(
    validateDefaultBranchResponse(
      { name: repo.default_branch, commit: { sha: currentHead } },
      repo,
      { requireCanaryBase: false },
    ),
    { name: repo.default_branch, head_sha: currentHead },
  );
  assert.throws(
    () =>
      validateDefaultBranchResponse(
        { name: "retargeted", commit: { sha: currentHead } },
        repo,
        { requireCanaryBase: false },
      ),
    /does not identify the manifest-bound default branch/u,
  );
});

test("workflow-run path accepts GitHub's documented optional source-ref suffix", () => {
  const repo = manifestFixture().repositories[0];
  assert.deepEqual(
    parseWorkflowRunPath(CANONICAL_WORKFLOW_IDENTITIES.verifier.path, repo.default_branch),
    {
      workflow_path: CANONICAL_WORKFLOW_IDENTITIES.verifier.path,
      workflow_ref: null,
    },
  );
  assert.deepEqual(
    parseWorkflowRunPath(
      `${CANONICAL_WORKFLOW_IDENTITIES.verifier.path}@${repo.default_branch}`,
      repo.default_branch,
    ),
    {
      workflow_path: CANONICAL_WORKFLOW_IDENTITIES.verifier.path,
      workflow_ref: repo.default_branch,
    },
  );
  assert.deepEqual(
    parseWorkflowRunPath(".github/workflows/foo.yml@refs/heads/release"),
    {
      workflow_path: ".github/workflows/foo.yml",
      workflow_ref: "refs/heads/release",
    },
  );
  for (const candidate of [
    ".github/workflows/other.yml@master",
    `${CANONICAL_WORKFLOW_IDENTITIES.verifier.path}@`,
    `${CANONICAL_WORKFLOW_IDENTITIES.verifier.path}@master\nforeign`,
    `${CANONICAL_WORKFLOW_IDENTITIES.verifier.path}@release`,
    null,
  ]) {
    assert.throws(
      () => parseWorkflowRunPath(candidate, repo.default_branch),
      /Workflow run path/u,
    );
  }
});

test("manifest rejects wildcard and actual default-branch exclusions", () => {
  for (const exclusion of ["release*", "master", "~DEFAULT_BRANCH"]) {
    const manifest = manifestFixture();
    manifest.repositories[0].v2_ruleset.expected.conditions.ref_name.exclude = [
      exclusion,
    ];
    assert.throws(
      () => validateManifest(manifest),
      /does not provably cover the repository default branch/u,
      exclusion,
    );
  }
});

test("legacy bridge status requires a coherent unfiltered writer inventory", () => {
  const repo = manifestFixture().repositories[0];
  assert.deepEqual(
    NONTERMINAL_WORKFLOW_RUN_STATUSES,
    EXPECTED_NONTERMINAL_WORKFLOW_RUN_STATUSES,
    "the legacy-writer drain must locally reject every documented nonterminal workflow-run status",
  );
  assert.doesNotThrow(() =>
    validateLegacyWriterRunPages([
      {
        total_count: 1,
        workflow_runs: [{ id: 89999999, run_attempt: 1, status: "completed" }],
      },
    ], repo),
  );
  for (const status of EXPECTED_NONTERMINAL_WORKFLOW_RUN_STATUSES) {
    assert.throws(
      () =>
        validateLegacyWriterRunPages([
          { total_count: 1, workflow_runs: [{ id: 90000000, run_attempt: 1, status }] },
        ], repo),
      new RegExp(`legacy-status writer still has ${status} runs`, "u"),
    );
  }
  assert.throws(
    () => validateLegacyWriterRunPages([], repo),
    /inventory is incomplete/u,
  );
  assert.throws(
    () =>
      validateLegacyWriterRunPages([
        {
          total_count: 1,
          workflow_runs: [{ id: 90000001, run_attempt: 1, status: "unknown-state" }],
        },
    ], repo),
    /unsupported status/u,
  );
  assert.throws(
    () =>
      validateLegacyWriterRunPages([
        {
          total_count: 1,
          workflow_runs: [{ id: 90000003, status: "completed" }],
        },
      ], repo),
    /run_attempt must be a positive safe integer/u,
  );
  assert.throws(
    () =>
      validateLegacyWriterRunPages([
        {
          total_count: 1,
          workflow_runs: [{ id: 90000002, run_attempt: 1 }],
        },
      ], repo),
    /unsupported status/u,
  );
  const completedRuns = Array.from({ length: 1_001 }, (_value, index) => ({
    id: 91000000 + index,
    run_attempt: 1,
    status: "completed",
  }));
  assert.doesNotThrow(() =>
    validateLegacyWriterRunPages(workflowRunPages(completedRuns), repo),
  );
  assert.throws(
    () =>
      validateLegacyWriterRunPages([
        { total_count: 101, workflow_runs: completedRuns.slice(0, 99) },
        { total_count: 101, workflow_runs: completedRuns.slice(99, 101) },
    ], repo),
    /incomplete non-final page/u,
  );
  assert.throws(
    () =>
      validateLegacyWriterRunPages([
        { total_count: 1, workflow_runs: [] },
      ], repo),
    /incomplete non-final page/u,
  );
  assert.throws(
    () =>
      validateLegacyWriterRunPages([
        {
          total_count: 2,
          workflow_runs: [
            { id: 92000000, run_attempt: 1, status: "completed" },
            { id: 92000000, run_attempt: 1, status: "completed" },
          ],
        },
      ], repo),
    /duplicate IDs/u,
  );
});

test("a queued old producer blocks bridge-status acceptance before activation writes", async (t) => {
  const harness = createFakeGhHarness(t, {
    legacyProducerRunPages: workflowRunPages([
      { id: 90000000, status: "completed" },
      { id: 90000001, status: "queued" },
    ]),
  });
  writeFileSync(harness.manifestPath, `${JSON.stringify(harness.manifest, null, 2)}\n`);
  writeFileSync(harness.v2StatePath, "disabled\n");
  writeFileSync(harness.legacyStatePath, "before\n");
  writeFileSync(harness.cleanupStatePath, "before\n");
  await assert.rejects(
    runFakeCli(harness, "activate"),
    /retained canonical producer still has queued runs/u,
  );
  assert.deepEqual(mutationRequests(fakeGhRequests(harness.logPath)), []);
});

test("unfiltered retained producer history above 1,000 completed runs is accepted", async (t) => {
  const harness = createFakeGhHarness(t, {
    legacyProducerRunPages: workflowRunPages(
      Array.from({ length: 1_001 }, (_value, index) => ({
        id: 91000000 + index,
        status: "completed",
      })),
    ),
  });
  writeFileSync(harness.manifestPath, `${JSON.stringify(harness.manifest, null, 2)}\n`);
  writeFileSync(harness.v2StatePath, "disabled\n");
  writeFileSync(harness.legacyStatePath, "before\n");
  writeFileSync(harness.cleanupStatePath, "before\n");
  const preview = await runFakeCli(harness, "activate");
  assert.equal(preview.status, "preview");
  assert.deepEqual(mutationRequests(fakeGhRequests(harness.logPath)), []);
});

test("legacy writer scans oversized aggregate history one bounded page at a time", async (t) => {
  const oversizedPages = workflowRunPages(
    Array.from({ length: 701 }, (_value, index) => ({
      id: 93000000 + index,
      status: "completed",
      opaque_payload: "x".repeat(12 * 1024),
    })),
  );
  assert.ok(
    Buffer.byteLength(JSON.stringify(oversizedPages), "utf8") > 8 * 1024 * 1024,
    "the aggregate fixture must exceed ghJson's per-process output limit",
  );
  const harness = createFakeGhHarness(t, {
    legacyProducerRunPages: oversizedPages,
  });
  const repository = harness.manifest.repositories[0];
  const epoch = await scanLegacyWriterRuns(
    repository,
    repository.canary.v2_workflow_id,
    "retained canonical producer",
  );
  assert.equal(epoch.total_count, 701);
  assert.equal(epoch.page_count, oversizedPages.length);
  assert.equal(epoch.executions.length, 701);
  const endpoint =
    `repos/${encodeEndpointPathForTest(repository.slug)}/actions/workflows/${repository.canary.v2_workflow_id}/runs?per_page=100`;
  const requests = fakeGhRequests(harness.logPath)
    .filter(({ method, endpoint: candidate }) =>
      method === "GET" && candidate.startsWith(`${endpoint}&page=`),
    );
  assert.equal(requests.length, oversizedPages.length);
  assert.equal(
    countRequest(fakeGhRequests(harness.logPath), "GET", endpoint),
    0,
    "the scanner must not ask gh to aggregate every run page into one stdout payload",
  );
});

test("legacy writer scan shares one total deadline through its final page", async () => {
  const repository = integrationManifestFixture().manifest.repositories[0];
  const pages = workflowRunPages(
    Array.from({ length: 101 }, (_value, index) => ({
      id: 94000000 + index,
      status: "completed",
    })),
  );
  let nowMs = 0;
  const requests = [];
  await assert.rejects(
    scanLegacyWriterRuns(
      repository,
      repository.canary.v2_workflow_id,
      "retained canonical producer",
      {
        now: () => nowMs,
        timeoutMs: 50,
        readPage: async (endpoint, options) => {
          requests.push({ endpoint, options });
          nowMs += requests.length === 1 ? 20 : 31;
          return pages[requests.length - 1];
        },
      },
    ),
    /complete legacy-writer scan exceeded its 50ms total deadline/u,
  );
  assert.equal(requests.length, 2);
  assert.deepEqual(
    requests.map(({ endpoint }) => endpoint),
    [
      `repos/${encodeEndpointPathForTest(repository.slug)}/actions/workflows/${repository.canary.v2_workflow_id}/runs?per_page=100&page=1`,
      `repos/${encodeEndpointPathForTest(repository.slug)}/actions/workflows/${repository.canary.v2_workflow_id}/runs?per_page=100&page=2`,
    ],
  );
  assert.deepEqual(
    requests.map(({ options }) => options.deadlineAt),
    [50, 50],
  );
  assert.match(
    requests[0].options.deadlineLabel,
    /50ms complete legacy-writer scan/u,
  );
});

test("legacy writer scan rejects oversized history before requesting a second page", async () => {
  const repository = integrationManifestFixture().manifest.repositories[0];
  const requests = [];
  await assert.rejects(
    scanLegacyWriterRuns(
      repository,
      repository.canary.v2_workflow_id,
      "retained canonical producer",
      {
        readPage: async (endpoint) => {
          requests.push(endpoint);
          return { total_count: 100_001, workflow_runs: [] };
        },
      },
    ),
    /100000-entry hard resource bound/u,
  );
  assert.equal(requests.length, 1);
});

test("legacy writer scan applies its shared deadline to the real gh child", async (t) => {
  const harness = createFakeGhHarness(t, {
    legacyProducerRunDelaySeconds: 0.4,
  });
  const repository = harness.manifest.repositories[0];
  await assert.rejects(
    scanLegacyWriterRuns(
      repository,
      repository.canary.v2_workflow_id,
      "retained canonical producer",
      { timeoutMs: 100 },
    ),
    /100ms complete legacy-writer scan exceeded its shared deadline/u,
  );
});

test("a completed legacy writer rerun after the status snapshot blocks stale activation", async (t) => {
  const harness = createFakeGhHarness(t, {
    legacyBridgeRunPages: workflowRunPages([
      { id: 92000000, run_attempt: 1, status: "completed" },
    ]),
    legacyWriterRace: {
      bridge_run_pages_after: workflowRunPages([
        { id: 92000000, run_attempt: 2, status: "completed" },
      ]),
    },
  });
  writeFileSync(harness.manifestPath, `${JSON.stringify(harness.manifest, null, 2)}\n`);
  writeFileSync(harness.v2StatePath, "disabled\n");
  writeFileSync(harness.legacyStatePath, "before\n");
  writeFileSync(harness.cleanupStatePath, "before\n");
  await assert.rejects(
    runFakeCli(harness, "activate"),
    /latest legacy context is not the manifest-bound successful compatibility status/u,
  );
  const requests = fakeGhRequests(harness.logPath);
  const firstRepository = harness.manifest.repositories[0];
  const bridgeRunPage =
    `repos/${encodeEndpointPathForTest(firstRepository.slug)}/actions/workflows/34000000/runs?per_page=100&page=1`;
  assert.ok(
    countRequest(requests, "GET", bridgeRunPage) >= 2,
    "the final writer epoch must be read after the status snapshot",
  );
  assert.deepEqual(mutationRequests(requests), []);
});

test("a queued temporary legacy bridge blocks bridge-status acceptance before activation writes", async (t) => {
  const harness = createFakeGhHarness(t, {
    legacyBridgeRunPages: workflowRunPages([
      { id: 90000003, status: "completed" },
      { id: 90000002, status: "queued" },
    ]),
  });
  writeFileSync(harness.manifestPath, `${JSON.stringify(harness.manifest, null, 2)}\n`);
  writeFileSync(harness.v2StatePath, "disabled\n");
  writeFileSync(harness.legacyStatePath, "before\n");
  writeFileSync(harness.cleanupStatePath, "before\n");
  await assert.rejects(
    runFakeCli(harness, "activate"),
    /temporary legacy bridge still has queued runs/u,
  );
  assert.deepEqual(mutationRequests(fakeGhRequests(harness.logPath)), []);
});

test("malformed or ambiguous canonical legacy bridge workflow inventory fails closed", async (t) => {
  for (const inventory of ["malformed", "ambiguous"]) {
    const harness = createFakeGhHarness(t, {
      legacyBridgeWorkflowInventory: inventory,
    });
    writeFileSync(harness.manifestPath, `${JSON.stringify(harness.manifest, null, 2)}\n`);
    writeFileSync(harness.v2StatePath, "disabled\n");
    writeFileSync(harness.legacyStatePath, "before\n");
    writeFileSync(harness.cleanupStatePath, "before\n");
    await assert.rejects(
      runFakeCli(harness, "activate"),
      inventory === "malformed"
        ? /Actions workflow inventory is incomplete/u
        : /canonical legacy bridge must have exactly one Actions workflow identity/u,
    );
    assert.deepEqual(
      mutationRequests(fakeGhRequests(harness.logPath)),
      [],
      `${inventory} Actions workflow inventory must fail before activation writes`,
    );
  }
});

test("legacy bridge Actions inventory rejects duplicate IDs and horizon drift before activation writes", async (t) => {
  const cases = [
    {
      options: { legacyBridgeWorkflowInventory: "duplicate-id" },
      error: /Actions workflow inventory contains duplicate IDs/u,
    },
    {
      options: { legacyBridgeWorkflowHorizonDrift: true },
      error: /Actions workflow inventory changed during horizon revalidation/u,
    },
  ];
  for (const { options, error } of cases) {
    await t.test(JSON.stringify(options), async () => {
      const harness = createFakeGhHarness(t, options);
      writeFileSync(harness.manifestPath, `${JSON.stringify(harness.manifest, null, 2)}\n`);
      writeFileSync(harness.v2StatePath, "disabled\n");
      writeFileSync(harness.legacyStatePath, "before\n");
      writeFileSync(harness.cleanupStatePath, "before\n");
      await assert.rejects(runFakeCli(harness, "activate"), error);
      assert.deepEqual(mutationRequests(fakeGhRequests(harness.logPath)), []);
    });
  }
});

test("bounded repository mapper stops acquiring items after its first error", async () => {
  const expected = new Error("first mapper failure");
  const started = [];
  let releaseSecond;
  const secondStarted = new Promise((resolvePromise) => {
    releaseSecond = resolvePromise;
  });
  const run = mapWithConcurrency([0, 1, 2, 3], 2, async (_value, index) => {
    started.push(index);
    if (index === 0) {
      await Promise.resolve();
      throw expected;
    }
    if (index === 1) {
      await secondStarted;
      return index;
    }
    return index;
  });
  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  releaseSecond();
  await assert.rejects(run, (error) => error === expected);
  assert.deepEqual(started.sort((left, right) => left - right), [0, 1]);
});

test("GraphQL canary evidence binds the supported potential test merge commit", async (t) => {
  const repo = manifestFixture().repositories[0];
  const response = canaryPullGraphqlResponse(repo);
  assert.deepEqual(validateCanaryPullGraphqlResponse(response, repo), {
    number: repo.canary.pull_number,
    state: "OPEN",
    merged: false,
    draft: false,
    mergeable: "MERGEABLE",
    head_sha: repo.canary.head_sha,
    head_repository: repo.slug,
    base_ref: repo.default_branch,
    base_sha: repo.canary.base_sha,
    base_repository: repo.slug,
    test_merge_sha: repo.canary.test_merge_sha,
    changed_files: 1,
  });
  for (const [name, mutate] of [
    ["wrong number", (value) => { value.data.repository.pullRequest.number += 1; }],
    ["merged", (value) => { value.data.repository.pullRequest.merged = true; }],
    ["draft", (value) => { value.data.repository.pullRequest.isDraft = true; }],
    ["unknown mergeability", (value) => { value.data.repository.pullRequest.mergeable = "UNKNOWN"; }],
    ["wrong head", (value) => { value.data.repository.pullRequest.headRefOid = "f".repeat(40); }],
    ["fork head", (value) => { value.data.repository.pullRequest.headRepository.nameWithOwner = "fork/example"; }],
    ["wrong base ref", (value) => { value.data.repository.pullRequest.baseRefName = "release"; }],
    ["wrong base", (value) => { value.data.repository.pullRequest.baseRefOid = "f".repeat(40); }],
    ["foreign base", (value) => { value.data.repository.pullRequest.baseRepository.nameWithOwner = "Other/example"; }],
    ["missing potential merge", (value) => { value.data.repository.pullRequest.potentialMergeCommit = null; }],
    ["wrong potential merge", (value) => { value.data.repository.pullRequest.potentialMergeCommit.oid = "f".repeat(40); }],
    ["too many files", (value) => { value.data.repository.pullRequest.changedFiles = 3001; }],
  ]) {
    await t.test(name, () => {
      const candidate = clone(response);
      mutate(candidate);
      assert.throws(
        () => validateCanaryPullGraphqlResponse(candidate, repo),
        /exact open, mergeable, non-draft, same-repository, current-base PR\/head\/test-merge/u,
      );
    });
  }
});

test("v2 evidence requires one native Actions CheckRun with canonical run/job identity", async (t) => {
  const repo = manifestFixture().repositories[0];
  const response = v2CheckRunResponse(repo);
  const validated = validateV2CheckRunResponse(response, repo);
  assert.equal(validated.runId, repo.canary.v2_run_id);
  assert.equal(validated.jobId, repo.canary.v2_job_id);
  assert.deepEqual(validated.checkProjection, {
    id: repo.canary.v2_check_run_id,
    name: V2_STATUS_CONTEXT,
    status: "completed",
    conclusion: "success",
    app_id: GITHUB_ACTIONS_INTEGRATION_ID,
    app_slug: "github-actions",
    head_sha: repo.canary.head_sha,
    details_url: response.check_runs[0].details_url,
  });

  assert.throws(
    () => validateV2CheckRunResponse(null, repo),
    (error) => {
      assert.equal(error instanceof TypeError, false, "malformed evidence must fail controllably");
      assert.match(error.message, /must have exactly one latest CheckRun/u);
      return true;
    },
  );

  const cases = [
    ["wrong app", (value) => { value.check_runs[0].app.id = 1; }],
    ["wrong app slug", (value) => { value.check_runs[0].app.slug = "other"; }],
    ["wrong head", (value) => { value.check_runs[0].head_sha = "f".repeat(40); }],
    ["not successful", (value) => { value.check_runs[0].conclusion = "failure"; }],
    ["foreign details URL", (value) => {
      value.check_runs[0].details_url =
        `https://example.com/${repo.slug}/actions/runs/${repo.canary.v2_run_id}/job/${repo.canary.v2_job_id}`;
    }],
    ["wrong run", (value) => {
      value.check_runs[0].details_url =
        `https://github.com/${repo.slug}/actions/runs/999/job/${repo.canary.v2_job_id}`;
    }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const candidate = clone(response);
      mutate(candidate);
      assert.throws(() => validateV2CheckRunResponse(candidate, repo));
    });
  }
});

test("legacy evidence is a latest successful commit status, never a CheckRun substitute", () => {
  const repo = manifestFixture().repositories[0];
  const statusPages = legacyStatusPages(repo);
  assert.equal(Object.hasOwn(statusPages[0][0], "sha"), false);
  assert.deepEqual(validateLegacyStatusPages(statusPages, repo), {
    id: repo.canary.legacy_status_id,
    node_id: "SC_legacy_status",
    context: LEGACY_STATUS_CONTEXT,
    state: "success",
    queried_ref: repo.canary.head_sha,
    creator_login: "github-actions[bot]",
    creator_type: "Bot",
    pagination_horizon: {
      page_count: 1,
      page_sizes: [1],
      statuses_sha256: sha256Canonical([{
        id: repo.canary.legacy_status_id,
        node_id: "SC_legacy_status",
        context: LEGACY_STATUS_CONTEXT,
        state: "success",
        creator_login: "github-actions[bot]",
        creator_type: "Bot",
      }]),
    },
  });

  const checkRunSubstitute = [[{
    id: repo.canary.legacy_status_id,
    name: LEGACY_STATUS_CONTEXT,
    status: "completed",
    conclusion: "success",
    app: { id: GITHUB_ACTIONS_INTEGRATION_ID, slug: "github-actions" },
    head_sha: repo.canary.head_sha,
  }]];
  assert.throws(
    () => validateLegacyStatusPages(checkRunSubstitute, repo),
    /a CheckRun is not a substitute/u,
  );

  const projectedV2Status = legacyStatusPages(repo);
  projectedV2Status[0].push({
    id: repo.canary.legacy_status_id + 10,
    context: V2_STATUS_CONTEXT,
  });
  assert.throws(
    () => validateLegacyStatusPages(projectedV2Status, repo),
    /v2 context must not be projected as a commit status/u,
  );

  const projectedV2StatusVariant = legacyStatusPages(repo);
  projectedV2StatusVariant[0].push({
    id: repo.canary.legacy_status_id + 10,
    context: V2_STATUS_CONTEXT.toUpperCase(),
  });
  assert.throws(
    () => validateLegacyStatusPages(projectedV2StatusVariant, repo),
    /v2 context must not be projected as a commit status/u,
  );

  const newerLegacyCaseVariant = legacyStatusPages(repo, {
    newerLegacyContext: LEGACY_STATUS_CONTEXT.toUpperCase(),
  });
  assert.throws(
    () => validateLegacyStatusPages(newerLegacyCaseVariant, repo),
    /latest case-insensitive legacy commit-status context must use the exact canonical spelling/u,
  );

  for (const mutate of [
    (status) => { status.id += 1; },
    (status) => { status.state = "pending"; },
    (status) => { status.node_id = ""; },
    (status) => { status.creator.login = "someone"; },
  ]) {
    const pages = legacyStatusPages(repo);
    mutate(pages[0][0]);
    assert.throws(
      () => validateLegacyStatusPages(pages, repo),
      /not the manifest-bound successful compatibility status/u,
    );
  }
});

test("validates and clones the complete exact 10-repository active handoff cohort", () => {
  const manifest = manifestFixture();
  const before = clone(manifest);
  const validated = validateManifest(manifest);

  assert.deepEqual(validated, manifest);
  assert.notEqual(validated, manifest);
  assert.notEqual(validated.repositories, manifest.repositories);
  assert.deepEqual(manifest, before, "validation must not mutate the approval manifest");
  assert.equal(validated.repositories.length, REQUIRED_REPOSITORY_COUNT);
  const activeRepositoryIds = validated.repositories.map((repository) => repository.id);
  const legacySelectorRepositoryIds =
    validated.legacy_ruleset.expected_before.conditions.repository_id.repository_ids;
  assert.equal(legacySelectorRepositoryIds.length, LEGACY_SELECTOR_REPOSITORY_COUNT);
  assert.deepEqual(
    legacySelectorRepositoryIds.filter((id) => activeRepositoryIds.includes(id)),
    activeRepositoryIds,
  );
  assert.equal(
    activeRepositoryIds.includes(ARCHIVED_LEGACY_ONLY_REPOSITORY_ID),
    false,
  );
  assert.equal(
    legacySelectorRepositoryIds.includes(ARCHIVED_LEGACY_ONLY_REPOSITORY_ID),
    true,
  );
});

test("the checked-in Joey manifest template fixes the approved identities and cleanup set", () => {
  const repositoryIdentities = JOEY_TEMPLATE.repositories.map(
    ({ slug, id, default_branch: defaultBranch }) => ({
      slug,
      id,
      default_branch: defaultBranch,
    }),
  );
  assert.deepEqual(JOEY_TEMPLATE.organization, {
    login: "Joey-Tools",
    id: 283943935,
    node_id: "O_kgDOEOyj_w",
  });
  assert.equal(JOEY_TEMPLATE.repositories.length, REQUIRED_REPOSITORY_COUNT);
  assert.deepEqual(
    repositoryIdentities,
    REPOSITORIES.map(([name, id]) => ({
      slug: `Joey-Tools/${name}`,
      id,
      default_branch: "master",
    })),
  );
  for (const repository of JOEY_TEMPLATE.repositories) {
    assert.deepEqual(repository.workflows, CANONICAL_WORKFLOW_IDENTITIES);
    assert.equal(repository.codeowners.path, CODEOWNERS_PATH);
    assert.deepEqual(repository.codeowners.owner, {
      login: "JoeyTeng",
      id: 12524680,
      node_id: "MDQ6VXNlcjEyNTI0Njgw",
    });
  }
  for (const identity of Object.values(CANONICAL_WORKFLOW_IDENTITIES)) {
    const bytes = readFileSync(
      new URL(`../templates/codex-gated-repo/${identity.path}`, import.meta.url),
    );
    const gitBlobHeader = Buffer.from(`blob ${bytes.length}\0`, "utf8");
    assert.equal(
      createHash("sha1").update(gitBlobHeader).update(bytes).digest("hex"),
      identity.git_blob_sha,
    );
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      identity.sha256,
    );
  }
  const templateActiveRepositoryIds = JOEY_TEMPLATE.repositories.map(({ id }) => id);
  assert.deepEqual(
    JOEY_TEMPLATE.legacy_ruleset.legacy_only_repository,
    ARCHIVED_LEGACY_ONLY_REPOSITORY,
  );
  const templateLegacySelectorRepositoryIds =
    JOEY_TEMPLATE.legacy_ruleset.expected_before.conditions.repository_id.repository_ids;
  assert.deepEqual(templateLegacySelectorRepositoryIds, LEGACY_SELECTOR_REPOSITORY_IDS);
  assert.deepEqual(
    templateLegacySelectorRepositoryIds.filter((id) =>
      templateActiveRepositoryIds.includes(id),
    ),
    templateActiveRepositoryIds,
  );
  assert.equal(
    templateActiveRepositoryIds.includes(ARCHIVED_LEGACY_ONLY_REPOSITORY_ID),
    false,
  );

  assert.equal(JOEY_TEMPLATE.legacy_ruleset.id, 16590367);
  assert.deepEqual(JOEY_TEMPLATE.legacy_ruleset.expected_before, {
    name: "Must Pass Codex Review",
    target: "branch",
    enforcement: "active",
    bypass_actors: [],
    conditions: {
      ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] },
      repository_id: {
        repository_ids: LEGACY_SELECTOR_REPOSITORY_IDS,
      },
    },
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: true,
          do_not_enforce_on_create: true,
          required_status_checks: [{ context: LEGACY_STATUS_CONTEXT }],
        },
      },
    ],
  });

  const cleanupActions = JOEY_TEMPLATE.repositories.flatMap(
    (repository) => repository.legacy_cleanup.map((action) => ({
      slug: repository.slug,
      ruleset_id: action.ruleset_id,
      surface: action.surface,
      operation: action.operation,
    })),
  );
  assert.equal(JOEY_TEMPLATE.expected_legacy_cleanup_action_count, 8);
  assert.equal(cleanupActions.length, 8);
  assert.equal(
    cleanupActions.some(({ slug }) => slug === ARCHIVED_LEGACY_ONLY_REPOSITORY.slug),
    false,
    "the archived legacy-only repository must not receive a v2 cleanup action",
  );
  assert.deepEqual(
    cleanupActions,
    REPOSITORIES.flatMap(([name, , rulesetId]) =>
      rulesetId === null
        ? []
        : [{
            slug: `Joey-Tools/${name}`,
            ruleset_id: rulesetId,
            surface: "repository_ruleset",
            operation: "update",
          }],
    ),
  );
});

test("only the documented replacement tokens keep the Joey template non-executable", () => {
  const replacements = [];
  const collect = (value, path = "") => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => collect(entry, `${path}[${index}]`));
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const [key, entry] of Object.entries(value)) {
        collect(entry, path === "" ? key : `${path}.${key}`);
      }
      return;
    }
    if (typeof value === "string" && value.startsWith("REPLACE_WITH_")) {
      replacements.push({ path, value });
    }
  };
  collect(JOEY_TEMPLATE);

  const expectedReplacements = JOEY_TEMPLATE.repositories.flatMap((_, index) => {
    const number = index + 1;
    const prefix = `repositories[${index}]`;
    return [
      {
        path: `${prefix}.v2_ruleset.id`,
        value: `REPLACE_WITH_REPOSITORY_V2_RULESET_ID_${number}`,
      },
      {
        path: `${prefix}.canary.pull_number`,
        value: `REPLACE_WITH_OPEN_CANARY_PR_${number}`,
      },
      {
        path: `${prefix}.canary.head_sha`,
        value: `REPLACE_WITH_40_HEX_CANARY_HEAD_${number}`,
      },
      {
        path: `${prefix}.canary.base_sha`,
        value: `REPLACE_WITH_40_HEX_CURRENT_DEFAULT_BRANCH_HEAD_${number}`,
      },
      {
        path: `${prefix}.canary.test_merge_sha`,
        value: `REPLACE_WITH_40_HEX_TEST_MERGE_${number}`,
      },
      {
        path: `${prefix}.canary.v2_check_run_id`,
        value: `REPLACE_WITH_V2_CHECK_RUN_ID_${number}`,
      },
      {
        path: `${prefix}.canary.v2_run_id`,
        value: `REPLACE_WITH_V2_RUN_ID_${number}`,
      },
      {
        path: `${prefix}.canary.v2_job_id`,
        value: `REPLACE_WITH_V2_JOB_ID_${number}`,
      },
      {
        path: `${prefix}.canary.v2_workflow_id`,
        value: `REPLACE_WITH_V2_WORKFLOW_ID_${number}`,
      },
      {
        path: `${prefix}.canary.v2_run_attempt`,
        value: `REPLACE_WITH_V2_RUN_ATTEMPT_${number}`,
      },
      {
        path: `${prefix}.canary.legacy_status_id`,
        value: `REPLACE_WITH_LEGACY_BRIDGE_STATUS_ID_${number}`,
      },
      {
        path: `${prefix}.codeowners.git_blob_sha`,
        value: `REPLACE_WITH_CODEOWNERS_BLOB_SHA_${number}`,
      },
      {
        path: `${prefix}.codeowners.sha256`,
        value: `REPLACE_WITH_CODEOWNERS_SHA256_${number}`,
      },
    ];
  });
  assert.deepEqual(replacements, expectedReplacements);
  assert.throws(() => validateManifest(JOEY_TEMPLATE), /exact lowercase 40-hex/u);

  const materialized = clone(JOEY_TEMPLATE);
  materialized.repositories.forEach((repository, index) => {
    const digit = ((index % 14) + 1).toString(16);
    repository.v2_ruleset.id = 40000000 + index;
    repository.canary.pull_number = 500 + index;
    repository.canary.head_sha = digit.repeat(40);
    repository.canary.base_sha = ((index + 2) % 16).toString(16).repeat(40);
    repository.canary.test_merge_sha = ((index + 3) % 16).toString(16).repeat(40);
    repository.canary.v2_check_run_id = 50000000 + index;
    repository.canary.v2_run_id = 51000000 + index;
    repository.canary.v2_job_id = 52000000 + index;
    repository.canary.v2_workflow_id = 53000000 + index;
    repository.canary.v2_run_attempt = 1;
    repository.canary.legacy_status_id = 54000000 + index;
    repository.codeowners.git_blob_sha = digit.repeat(40);
    repository.codeowners.sha256 = digit.repeat(64);
  });
  assert.deepEqual(validateManifest(materialized), materialized);
});

test("manifest validation is generic but binds every supplied identity and old snapshot", () => {
  const manifest = manifestFixture();
  manifest.organization = {
    login: "Example-Organization",
    id: 987654,
    node_id: "O_example",
  };
  manifest.legacy_ruleset.id = 7001;
  manifest.legacy_ruleset.legacy_only_repository = {
    slug: "Example-Organization/archived-legacy-only",
    id: 9000,
    node_id: "R_example_archived_legacy_only",
    default_branch: "master",
    archived: true,
  };
  manifest.legacy_ruleset.expected_before.name = "Example legacy gate";
  manifest.v2_ruleset.id = 7002;
  manifest.repositories.forEach((repository, index) => {
    repository.slug = `Example-Organization/repository-${index + 1}`;
    repository.id = 8000 + index;
    repository.node_id = `R_example_${index + 1}`;
  });
  const activeRepositoryIds = manifest.repositories.map((repository) => repository.id);
  manifest.legacy_ruleset.expected_before.conditions.repository_id.repository_ids = [
    ...activeRepositoryIds.slice(0, 8),
    manifest.legacy_ruleset.legacy_only_repository.id,
    ...activeRepositoryIds.slice(8),
  ];

  assert.deepEqual(validateManifest(manifest), manifest);
});

test("final closure receipt binds manifest and stable snapshot repository identities exactly", () => {
  const manifest = manifestFixture();
  const snapshot = {
    organization: {
      organization: clone(manifest.organization),
      legacy: { id: manifest.legacy_ruleset.id },
      legacy_state: "after",
      v2: { id: manifest.v2_ruleset.id },
      v2_state: "active",
    },
    repositories: manifest.repositories.map(
      ({ slug, id, node_id, default_branch }) => ({
        identity: { full_name: slug, id, node_id, default_branch },
      }),
    ),
  };
  const receipt = buildFinalClosureReceipt(manifest, snapshot);
  assert.deepEqual(receipt.manifest_repositories, receipt.repositories);
  assert.equal(
    receipt.manifest_repositories.some(
      ({ id, full_name, node_id }) =>
        id === ARCHIVED_LEGACY_ONLY_REPOSITORY_ID ||
        full_name === ARCHIVED_LEGACY_ONLY_REPOSITORY.slug ||
        node_id === ARCHIVED_LEGACY_ONLY_REPOSITORY.node_id,
    ),
    false,
  );

  const changedSnapshot = clone(snapshot);
  changedSnapshot.repositories[0].identity.node_id = "R_kgDOReplacement";
  assert.throws(
    () => buildFinalClosureReceipt(manifest, changedSnapshot),
    /stable observed repository identity cohort to exactly match manifest.repositories/u,
  );
});

test("manifest validation rejects incomplete, duplicate, or cross-bound cohort identities", async (t) => {
  const cases = [
    {
      name: "missing member",
      mutate: (manifest) => manifest.repositories.pop(),
      error: /exactly 10 entries/u,
    },
    {
      name: "historical v1 manifest cannot authorize the current cutover",
      mutate: (manifest) => {
        manifest.schema_version = "organization-review-gate-handoff-manifest/v1";
      },
      error: /v1 manifests are historical 11-member artifacts/u,
    },
    {
      name: "extra member",
      mutate: (manifest) => manifest.repositories.push({ ...clone(manifest.repositories[0]), id: 99 }),
      error: /exactly 10 entries/u,
    },
    {
      name: "duplicate numeric identity",
      mutate: (manifest) => {
        manifest.repositories[1].id = manifest.repositories[0].id;
      },
      error: /duplicates a repository identity/u,
    },
    {
      name: "case-insensitive duplicate slug",
      mutate: (manifest) => {
        manifest.repositories[1].slug = manifest.repositories[0].slug.toUpperCase();
      },
      error: /duplicates a repository identity/u,
    },
    {
      name: "foreign owner",
      mutate: (manifest) => {
        manifest.repositories[0].slug = "Other-Org/codex-toolbox";
      },
      error: /must belong to manifest\.organization\.login/u,
    },
    {
      name: "missing node identity",
      mutate: (manifest) => {
        manifest.repositories[0].node_id = "";
      },
      error: /node_id must be a non-empty string/u,
    },
    {
      name: "unsafe numeric identity",
      mutate: (manifest) => {
        manifest.repositories[0].id = Number.MAX_SAFE_INTEGER + 1;
      },
      error: /positive safe integer/u,
    },
    {
      name: "active cohort order drift within legacy selector",
      mutate: (manifest) => {
        manifest.repositories.reverse();
      },
      error: /retain every ordered active manifest repository ID/u,
    },
    {
      name: "legacy selector loses an active cohort member",
      mutate: (manifest) => {
        manifest.legacy_ruleset.expected_before.conditions.repository_id.repository_ids[0] =
          99;
      },
      error: /retain every ordered active manifest repository ID/u,
    },
    {
      name: "legacy selector contains a duplicate identity",
      mutate: (manifest) => {
        manifest.legacy_ruleset.expected_before.conditions.repository_id.repository_ids[0] =
          manifest.legacy_ruleset.expected_before.conditions.repository_id.repository_ids[1];
      },
      error: /exactly 11 unique entries/u,
    },
    {
      name: "legacy selector cannot substitute an arbitrary eleventh ID",
      mutate: (manifest) => {
        const selector =
          manifest.legacy_ruleset.expected_before.conditions.repository_id.repository_ids;
        selector[selector.indexOf(ARCHIVED_LEGACY_ONLY_REPOSITORY_ID)] = 99;
      },
      error: /only the ordered active manifest repository IDs plus manifest\.legacy_ruleset\.legacy_only_repository\.id/u,
    },
    {
      name: "legacy-only repository identity has every required field",
      mutate: (manifest) => {
        delete manifest.legacy_ruleset.legacy_only_repository.node_id;
      },
      error: /must contain exactly these keys/u,
    },
    {
      name: "legacy-only repository must belong to the manifest organization",
      mutate: (manifest) => {
        manifest.legacy_ruleset.legacy_only_repository.slug =
          "Other-Organization/codex-waited-delivery";
      },
      error: /legacy_only_repository\.slug must belong to manifest\.organization\.login/u,
    },
    {
      name: "legacy-only repository node identity must be non-empty",
      mutate: (manifest) => {
        manifest.legacy_ruleset.legacy_only_repository.node_id = "";
      },
      error: /legacy_only_repository\.node_id must be a non-empty string/u,
    },
    {
      name: "legacy-only repository default branch must be a branch name",
      mutate: (manifest) => {
        manifest.legacy_ruleset.legacy_only_repository.default_branch =
          "refs/heads/master";
      },
      error: /legacy_only_repository\.default_branch is malformed/u,
    },
    {
      name: "legacy-only repository must be archived",
      mutate: (manifest) => {
        manifest.legacy_ruleset.legacy_only_repository.archived = false;
      },
      error: /legacy_only_repository\.archived must be true/u,
    },
    {
      name: "legacy-only repository identity cannot overlap an active ID",
      mutate: (manifest) => {
        manifest.legacy_ruleset.legacy_only_repository.id = manifest.repositories[0].id;
      },
      error: /must not overlap an active manifest repository identity/u,
    },
    {
      name: "legacy-only repository identity cannot overlap an active slug",
      mutate: (manifest) => {
        manifest.legacy_ruleset.legacy_only_repository.slug = manifest.repositories[0].slug;
      },
      error: /must not overlap an active manifest repository identity/u,
    },
    {
      name: "legacy-only repository identity cannot overlap an active node ID",
      mutate: (manifest) => {
        manifest.legacy_ruleset.legacy_only_repository.node_id =
          manifest.repositories[0].node_id;
      },
      error: /must not overlap an active manifest repository identity/u,
    },
  ];

  for (const { name, mutate, error } of cases) {
    await t.test(name, () => assertManifestRejected(mutate, error));
  }
});

test("manifest validation requires exact workflow, canary, and repository-v2 proof shapes", async (t) => {
  const cases = [
    {
      name: "workflow hash is exact lowercase hex",
      mutate: (manifest) => {
        manifest.repositories[0].workflows.verifier.sha256 = "A".repeat(64);
      },
      error: /exact lowercase 64-hex/u,
    },
    {
      name: "workflow roles cannot swap canonical identities",
      mutate: (manifest) => {
        [
          manifest.repositories[0].workflows.verifier,
          manifest.repositories[0].workflows.controller,
        ] = [
          manifest.repositories[0].workflows.controller,
          manifest.repositories[0].workflows.verifier,
        ];
      },
      error: /must match the canonical path and byte identities/u,
    },
    {
      name: "workflow path stays below the workflow directory",
      mutate: (manifest) => {
        manifest.repositories[0].workflows.legacy_bridge.path =
          ".github/workflows/../CODEOWNERS.yml";
      },
      error: /normalized repository-relative YAML path/u,
    },
    {
      name: "well-formed workflow hashes still cannot drift",
      mutate: (manifest) => {
        manifest.repositories[0].workflows.verifier.sha256 = "0".repeat(64);
      },
      error: /must match the canonical path and byte identities/u,
    },
    {
      name: "CODEOWNERS uses its exact control-plane path",
      mutate: (manifest) => {
        manifest.repositories[0].codeowners.path = ".github/OWNERS";
      },
      error: /codeowners\.path must be/u,
    },
    {
      name: "CODEOWNERS bytes are fully bound",
      mutate: (manifest) => {
        manifest.repositories[0].codeowners.sha256 = "abc123";
      },
      error: /exact lowercase 64-hex/u,
    },
    {
      name: "CODEOWNERS owner has a full numeric identity",
      mutate: (manifest) => {
        manifest.repositories[0].codeowners.owner.id = 0;
      },
      error: /positive safe integer/u,
    },
    {
      name: "canary head is a full SHA",
      mutate: (manifest) => {
        manifest.repositories[0].canary.head_sha = "abc123";
      },
      error: /exact lowercase 40-hex/u,
    },
    {
      name: "canary base is a full SHA",
      mutate: (manifest) => {
        manifest.repositories[0].canary.base_sha = "not-a-sha";
      },
      error: /exact lowercase 40-hex/u,
    },
    {
      name: "canary test merge is a full SHA",
      mutate: (manifest) => {
        manifest.repositories[0].canary.test_merge_sha = "A".repeat(40);
      },
      error: /exact lowercase 40-hex/u,
    },
    {
      name: "canary run attempt is positive",
      mutate: (manifest) => {
        manifest.repositories[0].canary.v2_run_attempt = 0;
      },
      error: /positive safe integer/u,
    },
    {
      name: "repository v2 proof is active",
      mutate: (manifest) => {
        manifest.repositories[0].v2_ruleset.expected.enforcement = "disabled";
      },
      error: /must be active/u,
    },
    {
      name: "repository v2 proof has no bypass",
      mutate: (manifest) => {
        manifest.repositories[0].v2_ruleset.expected.bypass_actors = [{
          actor_id: 1,
          actor_type: "Integration",
          bypass_mode: "always",
        }];
      },
      error: /explicit empty bypass list/u,
    },
    {
      name: "repository v2 proof is source bound",
      mutate: (manifest) => {
        const rule = manifest.repositories[0].v2_ruleset.expected.rules.find(
          ({ type }) => type === "required_status_checks",
        );
        rule.parameters.required_status_checks[0].integration_id = 1;
      },
      error: /strict, source-bound v2 status/u,
    },
    {
      name: "repository v2 proof keeps control-plane review policy",
      mutate: (manifest) => {
        const rule = manifest.repositories[0].v2_ruleset.expected.rules.find(
          ({ type }) => type === "pull_request",
        );
        rule.parameters.require_code_owner_review = false;
      },
      error: /require_code_owner_review must be true/u,
    },
  ];

  for (const { name, mutate, error } of cases) {
    await t.test(name, () => assertManifestRejected(mutate, error));
  }
});

test("manifest validation binds the old rule and every cleanup before/after snapshot", async (t) => {
  const cases = [
    {
      name: "legacy organization rule stays active",
      mutate: (manifest) => {
        manifest.legacy_ruleset.expected_before.enforcement = "disabled";
      },
      error: /must remain active/u,
    },
    {
      name: "legacy organization status is v1-only",
      mutate: (manifest) => {
        const rule = manifest.legacy_ruleset.expected_before.rules.find(
          ({ type }) => type === "required_status_checks",
        );
        rule.parameters.required_status_checks.push({
          context: V2_STATUS_CONTEXT,
          integration_id: GITHUB_ACTIONS_INTEGRATION_ID,
        });
      },
      error: /only the legacy v1 context/u,
    },
    {
      name: "legacy organization deletion policy is present",
      mutate: (manifest) => {
        manifest.legacy_ruleset.expected_before.rules =
          manifest.legacy_ruleset.expected_before.rules.filter(
            ({ type }) => type !== "deletion",
          );
      },
      error: /exactly one deletion rule/u,
    },
    {
      name: "legacy and v2 identities stay distinct",
      mutate: (manifest) => {
        manifest.v2_ruleset.id = manifest.legacy_ruleset.id;
      },
      error: /must have distinct IDs/u,
    },
    {
      name: "v2 organization name is fixed",
      mutate: (manifest) => {
        manifest.v2_ruleset.name = "Looks similar";
      },
      error: /manifest\.v2_ruleset\.name/u,
    },
    {
      name: "cleanup after is exactly derived",
      mutate: (manifest) => {
        manifest.repositories[0].legacy_cleanup[0].expected_after.enforcement = "disabled";
      },
      error: /exact source snapshot with only legacy status entries removed/u,
    },
    {
      name: "cleanup count matches listed actions",
      mutate: (manifest) => {
        manifest.expected_legacy_cleanup_action_count += 1;
      },
      error: /does not match the listed actions/u,
    },
    {
      name: "cleanup cannot target the v2 ruleset",
      mutate: (manifest) => {
        manifest.repositories[0].legacy_cleanup[0].ruleset_id =
          manifest.repositories[0].v2_ruleset.id;
      },
      error: /must not target the repository's v2 ruleset/u,
    },
    {
      name: "cleanup targets are unique",
      mutate: (manifest) => {
        manifest.repositories[0].legacy_cleanup.push(
          clone(manifest.repositories[0].legacy_cleanup[0]),
        );
        manifest.expected_legacy_cleanup_action_count += 1;
      },
      error: /Duplicate legacy cleanup target/u,
    },
    {
      name: "schema has no unreviewed extension keys",
      mutate: (manifest) => {
        manifest.allow_partial = true;
      },
      error: /must contain exactly these keys/u,
    },
  ];

  for (const { name, mutate, error } of cases) {
    await t.test(name, () => assertManifestRejected(mutate, error));
  }
});

test("builds a disabled or active organization v2 ruleset with status-only policy", () => {
  const manifest = manifestFixture();
  const before = clone(manifest);
  const disabled = buildV2OrganizationRulesetPayload(manifest);
  const active = buildV2OrganizationRulesetPayload(manifest, "active");

  assert.deepEqual(disabled, {
    name: V2_RULESET_NAME,
    target: "branch",
    enforcement: "disabled",
    bypass_actors: [],
    conditions: {
      ref_name: manifest.legacy_ruleset.expected_before.conditions.ref_name,
      repository_id: {
        repository_ids: manifest.repositories.map((repository) => repository.id),
      },
    },
    rules: [
      {
        type: "required_status_checks",
        parameters: {
          required_status_checks: [
            {
              context: V2_STATUS_CONTEXT,
              integration_id: GITHUB_ACTIONS_INTEGRATION_ID,
            },
          ],
          strict_required_status_checks_policy: true,
          do_not_enforce_on_create: true,
        },
      },
    ],
  });
  assert.deepEqual(active, { ...disabled, enforcement: "active" });
  assert.deepEqual(manifest, before, "payload derivation must not mutate the manifest");
  assert.notEqual(
    disabled.conditions.ref_name,
    manifest.legacy_ruleset.expected_before.conditions.ref_name,
  );
  assert.notEqual(
    disabled.conditions.repository_id,
    manifest.legacy_ruleset.expected_before.conditions.repository_id,
  );
  assert.equal(
    disabled.conditions.repository_id.repository_ids.includes(
      ARCHIVED_LEGACY_ONLY_REPOSITORY_ID,
    ),
    false,
    "the active v2 organization rule must not cover the archived legacy-only repository",
  );
  assert.equal(
    disabled.rules.some(({ type }) =>
      ["deletion", "non_fast_forward", "pull_request"].includes(type)),
    false,
  );
  assert.throws(
    () => buildV2OrganizationRulesetPayload(manifest, "evaluate"),
    /must be disabled or active/u,
  );
});

test("organization cutover removes only the whole v1 status rule", () => {
  const manifest = manifestFixture();
  const before = clone(manifest);
  const expected = clone(manifest.legacy_ruleset.expected_before);
  expected.rules = expected.rules.filter(({ type }) => type !== "required_status_checks");

  const cutover = deriveLegacyOrganizationCutoverPayload(manifest);
  assert.deepEqual(cutover, expected);
  assert.deepEqual(manifest, before, "cutover derivation must be read-only");
  assert.deepEqual(
    cutover.conditions.repository_id.repository_ids,
    LEGACY_SELECTOR_REPOSITORY_IDS,
  );
  assert.equal(
    cutover.conditions.repository_id.repository_ids.includes(
      ARCHIVED_LEGACY_ONLY_REPOSITORY_ID,
    ),
    true,
    "cutover must retain the old rule's archived-repository deletion and non-fast-forward selector",
  );
  assert.deepEqual(expected.rules, [
    { type: "deletion" },
    { type: "non_fast_forward" },
  ]);

  const ambiguous = manifestFixture();
  ambiguous.legacy_ruleset.expected_before.rules.push(statusRule([LEGACY_STATUS_CONTEXT]));
  assert.throws(
    () => deriveLegacyOrganizationCutoverPayload(ambiguous),
    /exactly one required_status_checks rule/u,
  );
});

test("repository ruleset cleanup preserves all non-v1 writable policy", () => {
  const action = repositoryCleanupAction(16583474, 0);
  action.expected_before.bypass_actors = [{
    actor_id: 4700530,
    actor_type: "Integration",
    bypass_mode: "always",
  }];
  action.expected_after.bypass_actors = clone(action.expected_before.bypass_actors);
  action.expected_before.rules[2].parameters.custom_policy = {
    exact: ["keep", "this"],
  };
  action.expected_after.rules[2].parameters.custom_policy = {
    exact: ["keep", "this"],
  };
  const before = clone(action);

  assert.deepEqual(deriveRepositoryCleanupAction(action), {
    operation: "update",
    expected_after: action.expected_after,
  });
  assert.deepEqual(action, before, "cleanup derivation must not mutate either snapshot");

  const drifted = clone(action);
  drifted.expected_after.rules[2].parameters.custom_policy.exact.reverse();
  assert.throws(
    () => deriveRepositoryCleanupAction(drifted),
    /exact source snapshot with only legacy status entries removed/u,
  );
  const absent = clone(action);
  absent.expected_before = cleanupRuleset("No legacy", ["test"]);
  assert.throws(
    () => deriveRepositoryCleanupAction(absent),
    /contains no legacy context/u,
  );
});

test("repository ruleset cleanup requires explicit delete semantics for an empty result", () => {
  const expectedBefore = {
    name: "Dedicated legacy-only rule",
    target: "branch",
    enforcement: "active",
    bypass_actors: [],
    conditions: defaultBranchConditions(),
    rules: [statusRule([LEGACY_STATUS_CONTEXT])],
  };
  const action = {
    surface: "repository_ruleset",
    ruleset_id: 77,
    operation: "delete",
    expected_before: expectedBefore,
    expected_after: null,
  };
  assert.deepEqual(deriveRepositoryCleanupAction(action), {
    operation: "delete",
    expected_after: null,
  });

  assert.throws(
    () => deriveRepositoryCleanupAction({ ...action, operation: "update" }),
    /complete expected_after snapshot/u,
  );
  const residual = clone(action);
  residual.expected_before.rules.unshift({ type: "non_fast_forward" });
  assert.throws(
    () => deriveRepositoryCleanupAction(residual),
    /valid only for a now-empty ruleset/u,
  );
});

test("repository cleanup rejects ambiguous duplicate status rules or contexts", () => {
  const duplicateRule = repositoryCleanupAction(16583474, 0);
  duplicateRule.expected_before.rules.push(statusRule([LEGACY_STATUS_CONTEXT]));
  duplicateRule.expected_after.rules.push(statusRule([]));
  assert.throws(
    () => deriveRepositoryCleanupAction(duplicateRule),
    /duplicate required_status_checks|at most one required_status_checks/u,
  );

  const duplicateContext = repositoryCleanupAction(16583474, 0);
  const beforeStatus = duplicateContext.expected_before.rules.find(
    ({ type }) => type === "required_status_checks",
  );
  beforeStatus.parameters.required_status_checks.push({
    context: LEGACY_STATUS_CONTEXT,
    integration_id: 1,
  });
  assert.throws(
    () => deriveRepositoryCleanupAction(duplicateContext),
    /duplicate.*context|status contexts must be unique/u,
  );
});

test("classic cleanup removes v1 from both legacy representations and preserves the rest", () => {
  const expectedBefore = {
    strict: true,
    contexts: [LEGACY_STATUS_CONTEXT, "lint"],
    checks: [
      { context: LEGACY_STATUS_CONTEXT, app_id: null },
      { context: "test", app_id: GITHUB_ACTIONS_INTEGRATION_ID },
    ],
  };
  const expectedAfter = {
    strict: true,
    contexts: ["lint"],
    checks: [{ context: "test", app_id: GITHUB_ACTIONS_INTEGRATION_ID }],
  };
  const action = {
    surface: "classic_required_status_checks",
    operation: "update",
    expected_before: expectedBefore,
    expected_after: expectedAfter,
  };
  const before = clone(action);
  assert.deepEqual(deriveRepositoryCleanupAction(action), {
    operation: "update",
    expected_after: expectedAfter,
  });
  assert.deepEqual(action, before);

  assert.deepEqual(
    deriveRepositoryCleanupAction({
      surface: "classic_required_status_checks",
      operation: "delete",
      expected_before: {
        strict: true,
        contexts: [LEGACY_STATUS_CONTEXT],
        checks: [],
      },
      expected_after: null,
    }),
    { operation: "delete", expected_after: null },
  );
  assert.throws(
    () => deriveRepositoryCleanupAction({ ...action, surface: "unknown" }),
    /Unsupported repository cleanup surface/u,
  );
});
