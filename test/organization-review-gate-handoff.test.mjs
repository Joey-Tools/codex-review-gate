import assert from "node:assert/strict";
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
  CANONICAL_WORKFLOW_IDENTITIES,
  CODEOWNERS_PATH,
  GITHUB_ACTIONS_INTEGRATION_ID,
  LEGACY_STATUS_CONTEXT,
  MANIFEST_SCHEMA_VERSION,
  OUTPUT_SCHEMA_VERSION,
  REQUIRED_REPOSITORY_COUNT,
  V2_RULESET_NAME,
  V2_STATUS_CONTEXT,
  V2_VERIFIER_RUN_NAME_PREFIX,
  buildV2OrganizationRulesetPayload,
  canonicalJson,
  deriveLegacyOrganizationCutoverPayload,
  deriveRepositoryCleanupAction,
  loadStableSnapshots,
  runCli,
  sha256Canonical,
  validateLegacyStatusPages,
  validateCanaryPullResponse,
  validateDefaultBranchResponse,
  validateManifest,
  validateV2CheckRunResponse,
} from "../scripts/organization-review-gate-handoff.mjs";

const HANDOFF_SCRIPT = fileURLToPath(
  new URL("../scripts/organization-review-gate-handoff.mjs", import.meta.url),
);
const JOEY_TEMPLATE = JSON.parse(
  readFileSync(
    new URL(
      "../templates/organization-review-gate-handoff/joey-tools-11-member-manifest.template.json",
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
  ["codex-waited-delivery", 1242512099, 16583524],
  ["codex-workflow-hygiene", 1242512084, 16583522],
  ["codex-session-retrospective-history", 1246526548, null],
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
      expected_before: legacyOrganizationRuleset(
        repositories.map((repository) => repository.id),
      ),
    },
    v2_ruleset: {
      id: 26590367,
      name: V2_RULESET_NAME,
    },
    repositories,
    expected_legacy_cleanup_action_count: 9,
  };
}

function assertManifestRejected(mutator, pattern) {
  const manifest = manifestFixture();
  mutator(manifest);
  assert.throws(() => validateManifest(manifest), pattern);
}

function canaryPullResponse(repo) {
  return {
    number: repo.canary.pull_number,
    state: "open",
    merged: false,
    draft: false,
    head: {
      sha: repo.canary.head_sha,
      repo: { full_name: repo.slug },
    },
    base: {
      ref: repo.default_branch,
      sha: repo.canary.base_sha,
      repo: { full_name: repo.slug },
    },
    merge_commit_sha: repo.canary.test_merge_sha,
    changed_files: 1,
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

function legacyStatusPages(repo, { newerLegacyContext = null } = {}) {
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
    });
  }
  return [statuses];
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

function createFakeGhHarness(
  t,
  {
    extraWorkflow = null,
    canaryState = "open",
    defaultWorkflowPermissions = "read",
    newerLegacyStatusContext = null,
    unexpectedWorkflowTree = false,
  } = {},
) {
  const { manifest, codeownersBytes } = integrationManifestFixture();
  const directory = mkdtempSync(join(tmpdir(), "organization-handoff-fake-gh-"));
  const ghPath = join(directory, "gh");
  const logPath = join(directory, "requests.tsv");
  const manifestPath = join(directory, "manifest.json");
  const v2StatePath = join(directory, "v2-state");
  const legacyStatePath = join(directory, "legacy-state");
  const cleanupStatePath = join(directory, "cleanup-state");
  const responses = new Map();
  const cleanupResponses = [];
  const notFoundEndpoints = [];
  const workflowBytes = Object.fromEntries(
    Object.entries(CANONICAL_WORKFLOW_IDENTITIES).map(([key, identity]) => [
      key,
      readFileSync(
        new URL(`../templates/codex-gated-repo/${identity.path}`, import.meta.url),
      ),
    ]),
  );

  const organization = manifest.organization;
  const encodedOrganization = encodeURIComponent(organization.login);
  addFakeResponse(responses, `orgs/${encodedOrganization}`, organization);

  for (const [repositoryIndex, repository] of manifest.repositories.entries()) {
    const encodedSlug = encodeEndpointPathForTest(repository.slug);
    addFakeResponse(responses, `repos/${encodedSlug}`, {
      full_name: repository.slug,
      id: repository.id,
      node_id: repository.node_id,
      default_branch: repository.default_branch,
    });
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
        commit: { sha: repository.canary.base_sha },
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
      `repos/${encodedSlug}/git/trees/${repository.canary.base_sha}`,
      {
        sha: repository.canary.base_sha,
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
        `repos/${encodedSlug}/contents/${encodeEndpointPathForTest(identity.path)}?ref=${encodeURIComponent(repository.default_branch)}`,
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
      `repos/${encodedSlug}/contents/${encodeEndpointPathForTest(repository.codeowners.path)}?ref=${encodeURIComponent(repository.default_branch)}`,
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
    for (const action of repository.legacy_cleanup) {
      assert.equal(action.surface, "repository_ruleset");
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
      });
    }
    addFakeResponse(
      responses,
      `repos/${encodedSlug}/rulesets?includes_parents=false&per_page=100`,
      [localRulesetSummaries],
    );

    const pullResponse = canaryPullResponse(repository);
    if (canaryState === "closed") {
      pullResponse.state = "closed";
    } else {
      assert.equal(canaryState, "open");
    }
    addFakeResponse(
      responses,
      `repos/${encodedSlug}/pulls/${repository.canary.pull_number}`,
      pullResponse,
    );
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
    addFakeResponse(
      responses,
      `repos/${encodedSlug}/commits/${repository.canary.head_sha}/statuses?per_page=100`,
      legacyStatusPages(repository, {
        newerLegacyContext:
          repositoryIndex === 0 ? newerLegacyStatusContext : null,
      }),
    );
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
    `    respond ${shellQuote(v2Complete(v2Disabled))} ;;`,
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

  if (cleanupResponses.length > 0) {
    scriptLines.push('case "$request" in');
    for (const response of cleanupResponses) {
      scriptLines.push(
        `  ${shellQuote(response.request)})`,
        '    case "$(cat "${FAKE_GH_CLEANUP_STATE:?}")" in',
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
  writeFileSync(cleanupStatePath, "before\n");

  const previousEnvironment = new Map(
    ["PATH", "FAKE_GH_LOG", "FAKE_GH_V2_STATE", "FAKE_GH_LEGACY_STATE", "FAKE_GH_CLEANUP_STATE"]
      .map((name) => [name, process.env[name]]),
  );
  process.env.PATH = `${directory}${delimiter}${process.env.PATH ?? ""}`;
  process.env.FAKE_GH_LOG = logPath;
  process.env.FAKE_GH_V2_STATE = v2StatePath;
  process.env.FAKE_GH_LEGACY_STATE = legacyStatePath;
  process.env.FAKE_GH_CLEANUP_STATE = cleanupStatePath;
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
    cleanupStatePath,
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
  return requests.filter(({ method }) => method !== "GET");
}

function countRequest(requests, method, endpoint) {
  return requests.filter(
    (request) => request.method === method && request.endpoint === endpoint,
  ).length;
}

test("exports the closed organization handoff protocol constants", () => {
  assert.equal(MANIFEST_SCHEMA_VERSION, "organization-review-gate-handoff-manifest/v1");
  assert.equal(OUTPUT_SCHEMA_VERSION, "organization-review-gate-handoff-output/v1");
  assert.equal(REQUIRED_REPOSITORY_COUNT, 11);
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
      git_blob_sha: "bc6827bdfb94a36b177ecaaa1bab5facd9a71fde",
      sha256: "1a6e6ea700874632c0e7413fe60418ce5772a404df5f5acdaf070eb528067a7f",
    },
    legacy_bridge: {
      path: ".github/workflows/codex-review-gate-legacy-bridge.yml",
      git_blob_sha: "9d894030ca760569c34877baf3812d6e11980af8",
      sha256: "3b54e3ad161720a239f01d8e1cf031ce15f78793b7d91ca1866a063090a6f2d6",
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
  assert.match(invalidMode.stderr, /--apply is valid only with stage, activate, or verify mode/u);

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
  assert.deepEqual(writes[0].body.rules.map(({ type }) => type), [
    "required_status_checks",
  ]);
  assert.equal(writes[0].body.enforcement, "disabled");
  let mutationIndex = requests.findIndex(({ method }) => method !== "GET");
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
  assert.equal(writes[0].body.enforcement, "active");
  assert.deepEqual(writes[0].body.rules.map(({ type }) => type), [
    "required_status_checks",
  ]);
  mutationIndex = requests.findIndex(({ method }) => method !== "GET");
  const activationBefore = requests.slice(0, mutationIndex);
  const activationAfter = requests.slice(mutationIndex + 1);
  for (const repository of boundManifest.repositories) {
    const encodedSlug = encodeEndpointPathForTest(repository.slug);
    const bridgeEndpoint =
      `repos/${encodedSlug}/git/blobs/${repository.workflows.legacy_bridge.git_blob_sha}`;
    const legacyStatusEndpoint =
      `repos/${encodedSlug}/commits/${repository.canary.head_sha}/statuses?per_page=100`;
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
      const method = derived.operation === "delete" ? "DELETE" : "PUT";
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
      if (method === "PUT") {
        expected.mutation.payload = action.expected_after;
        expected.mutation.payload_sha256 = sha256Canonical(action.expected_after);
      }
      if (action.surface === "repository_ruleset") {
        expected.ruleset_id = action.ruleset_id;
      }
      return expected;
    }),
  );
  assert.equal(expectedRepositoryActions.length, 9);
  assert.deepEqual(cutoverPlan.external_repository_actions, expectedRepositoryActions);
  assert.deepEqual(cutoverPlan.sequencing, [
    "execute-and-read-back-external-repository-actions",
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
  assert.match(cutoverPlan.plan_sha256, /^[0-9a-f]{64}$/u);

  writeFileSync(harness.cleanupStatePath, "after\n");
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
  assert.deepEqual(writes[0].body.rules, [
    { type: "deletion" },
    { type: "non_fast_forward" },
  ]);
  assert.equal(
    writes[0].body.rules.some(({ type }) => type === "required_status_checks"),
    false,
  );
  mutationIndex = requests.findIndex(({ method }) => method !== "GET");
  const cutoverBefore = requests.slice(0, mutationIndex);
  const cutoverAfter = requests.slice(mutationIndex + 1);
  assert.ok(
    countRequest(cutoverBefore, "GET", legacyRulesetEndpoint) >= 4,
    "cutover must finish with a direct legacy organization ruleset read after full-cohort revalidation",
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
  assert.equal(verifyCompletePreview.status, "final-verified");
  assert.equal(verifyCompletePreview.applied, false);
  assert.equal(verifyCompletePreview.action, null);
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
    /exact open, non-draft, same-repository, current-base PR\/head\/test-merge/u,
  );
  assert.deepEqual(mutationRequests(fakeGhRequests(harness.logPath)), []);
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

test("canary pull evidence binds one open current-base same-repository test merge", async (t) => {
  const repo = manifestFixture().repositories[0];
  const response = canaryPullResponse(repo);
  assert.deepEqual(validateCanaryPullResponse(response, repo), {
    number: repo.canary.pull_number,
    state: "open",
    merged: false,
    draft: false,
    head_sha: repo.canary.head_sha,
    head_repository: repo.slug,
    base_ref: repo.default_branch,
    base_sha: repo.canary.base_sha,
    base_repository: repo.slug,
    test_merge_sha: repo.canary.test_merge_sha,
    changed_files: 1,
  });

  const cases = [
    ["closed", (value) => { value.state = "closed"; }],
    ["merged", (value) => { value.merged = true; }],
    ["draft", (value) => { value.draft = true; }],
    ["wrong head", (value) => { value.head.sha = "f".repeat(40); }],
    ["fork head", (value) => { value.head.repo.full_name = "fork/example"; }],
    ["wrong base ref", (value) => { value.base.ref = "release"; }],
    ["outdated base", (value) => { value.base.sha = "f".repeat(40); }],
    ["foreign base", (value) => { value.base.repo.full_name = "Other/example"; }],
    ["wrong test merge", (value) => { value.merge_commit_sha = "f".repeat(40); }],
    ["truncated file count", (value) => { value.changed_files = 3001; }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const candidate = clone(response);
      mutate(candidate);
      assert.throws(
        () => validateCanaryPullResponse(candidate, repo),
        /exact open, non-draft, same-repository, current-base PR\/head\/test-merge/u,
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
  projectedV2Status[0].push({ context: V2_STATUS_CONTEXT });
  assert.throws(
    () => validateLegacyStatusPages(projectedV2Status, repo),
    /v2 context must not be projected as a commit status/u,
  );

  const projectedV2StatusVariant = legacyStatusPages(repo);
  projectedV2StatusVariant[0].push({
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

test("validates and clones a complete exact 11-repository handoff manifest", () => {
  const manifest = manifestFixture();
  const before = clone(manifest);
  const validated = validateManifest(manifest);

  assert.deepEqual(validated, manifest);
  assert.notEqual(validated, manifest);
  assert.notEqual(validated.repositories, manifest.repositories);
  assert.deepEqual(manifest, before, "validation must not mutate the approval manifest");
  assert.equal(validated.repositories.length, REQUIRED_REPOSITORY_COUNT);
  assert.deepEqual(
    validated.legacy_ruleset.expected_before.conditions.repository_id.repository_ids,
    validated.repositories.map((repository) => repository.id),
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
  assert.deepEqual(
    JOEY_TEMPLATE.legacy_ruleset.expected_before.conditions.repository_id.repository_ids,
    JOEY_TEMPLATE.repositories.map(({ id }) => id),
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
        repository_ids: JOEY_TEMPLATE.repositories.map(({ id }) => id),
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
  assert.equal(JOEY_TEMPLATE.expected_legacy_cleanup_action_count, 9);
  assert.equal(cleanupActions.length, 9);
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
  manifest.legacy_ruleset.expected_before.name = "Example legacy gate";
  manifest.v2_ruleset.id = 7002;
  manifest.repositories.forEach((repository, index) => {
    repository.slug = `Example-Organization/repository-${index + 1}`;
    repository.id = 8000 + index;
    repository.node_id = `R_example_${index + 1}`;
  });
  manifest.legacy_ruleset.expected_before.conditions.repository_id.repository_ids =
    manifest.repositories.map((repository) => repository.id);

  assert.deepEqual(validateManifest(manifest), manifest);
});

test("manifest validation rejects incomplete, duplicate, or cross-bound cohort identities", async (t) => {
  const cases = [
    {
      name: "missing member",
      mutate: (manifest) => manifest.repositories.pop(),
      error: /exactly 11 entries/u,
    },
    {
      name: "extra member",
      mutate: (manifest) => manifest.repositories.push({ ...clone(manifest.repositories[0]), id: 99 }),
      error: /exactly 11 entries/u,
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
      name: "selector order or membership drift",
      mutate: (manifest) => {
        manifest.legacy_ruleset.expected_before.conditions.repository_id.repository_ids.reverse();
      },
      error: /exactly match the ordered manifest repository IDs/u,
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
    conditions: manifest.legacy_ruleset.expected_before.conditions,
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
  assert.notEqual(disabled.conditions, manifest.legacy_ruleset.expected_before.conditions);
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

  assert.deepEqual(deriveLegacyOrganizationCutoverPayload(manifest), expected);
  assert.deepEqual(manifest, before, "cutover derivation must be read-only");
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
