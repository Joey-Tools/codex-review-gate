import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  createHash,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import {
  assembleV2ProductionControllerCycle,
  acquireV2LeaseThenLoadDiscovery,
  assertV2InitialProductionLedgerApi,
  assertV2LeasedDiscoveryContinuityHandle,
  assertV2MinimalLiveScopeHandle,
  assertV2MinimalScopeMatchesFullDiscovery,
  bindV2EffectResponse,
  createV2GitHubOidcProvenanceVerifier,
  createV2PreLeaseEvaluatedScopeAuthority,
  createV2GitHubEffectTransport,
  createV2GitHubProductionStatusTransport,
  createV2GitHubLedgerStore,
  createV2GitHubReservationLedger,
  createV2EffectLedger,
  createV2ProductionInitialCycle,
  executeV2ControllerCycle,
  executeV2EffectOnce,
  listAllOpenPullRequests,
  loadV2GitLedgerTriggerIdentity,
  loadV2MinimalLiveScope,
  MAX_V2_SCHEDULE_DISPATCH_GITHUB_OUTPUT_UTF16_BYTES,
  markV2EffectAttempted,
  projectV2MinimalScopeForGitLedger,
  projectV2LeasedDiscoveryContinuityForGitLedger,
  readV2ProviderEventSelector,
  reserveAndPersistV2Effect,
  reserveV2Effect,
  runV2ListOpenCli,
  runV2ScheduleDispatchCli,
  runV2WorkflowControllerCli,
  validateV2ProductionPreflightBoundary,
  validateV2CandidateRefreshReconciliationForSource,
  validateV2EffectLedger,
  validateV2StatusWrites,
  V2WorkflowControllerError,
  writeV2ScheduleDispatchMatrixOutput,
  writeV2WorkflowOutputs,
} from "../packages/action/src/v2/workflow-controller.mjs";
import {
  createV2GitHubTransport,
} from "../packages/action/src/v2/transport.mjs";
import {
  createV2GitHubCandidateInventory,
  MAX_V2_CANDIDATE_SCAN_PASSES,
} from "../packages/action/src/v2/candidate-inventory.mjs";
import {
  V2_GIT_LEDGER_BLOB_PATH,
  V2_GIT_LEDGER_CANDIDATE_INVENTORY_RECORD_SCHEMA,
  V2_GIT_LEDGER_CHECKPOINT_STATE_BLOB_PATH,
  V2_GIT_LEDGER_CHECKPOINT_STATE_PATH,
  V2_GIT_LEDGER_ENVELOPE_SCHEMA,
  V2_GIT_LEDGER_OIDC_AUDIENCE,
  V2_GIT_LEDGER_OIDC_CLAIMS,
  V2_GIT_LEDGER_LEASE_RECEIPT_SCHEMA,
  V2_GIT_LEDGER_PROVENANCE_TIMEOUT_MS,
  V2_GIT_LEDGER_PROVENANCE_REQUEST_SCHEMA,
  V2_GIT_LEDGER_PROVENANCE_VERIFIER_REQUEST_SCHEMA,
  V2_GIT_LEDGER_PROVENANCE_VERIFIER_RESULT_SCHEMA,
  V2_GIT_LEDGER_REF,
  calculateV2GitLedgerCandidateDispatchCommitBudget,
  createV2GitLedgerCandidateInventoryEvaluatedScopeReceipt,
  createV2GitLedgerCandidateInventoryRecord,
  deriveV2GitLedgerCandidateInventoryAuthority,
  digestV2GitLedgerPayload,
  MAX_V2_GIT_LEDGER_COMMITS,
  MAX_V2_CURRENT_OPEN_CANDIDATE_DISPATCH_BINDING_BYTES,
  MAX_V2_CURRENT_OPEN_CANDIDATE_DISPATCH_PLAN_BYTES,
  projectV2GitLedgerCandidateDispatchBinding,
  V2_GIT_LEDGER_CANDIDATE_DISPATCH_PLAN_SCHEMA,
  validateV2GitLedgerProvenanceReceipt,
} from "../packages/action/src/v2/git-ledger.mjs";
import {
  prepareV2WorkflowCommand,
  V2_STATUS_CONTEXT,
  V2_STATUS_TARGET_MODE,
  V2_WORKFLOW_PATH,
} from "../packages/action/src/v2/workflow-command.mjs";
import {
  PUBLIC_INITIAL_WAIT_MS,
  PUBLIC_NO_START_CONFIRMATION_MS,
  PUBLIC_POST_REQUEST_WAIT_MS,
  V2_SCHEDULER_SCHEMA,
  V2_SCHEDULER_SCHEMA_VERSION,
  planV2Actions,
} from "../packages/action/src/v2/scheduler.mjs";

const HEAD = "a".repeat(40);
const MERGE = "b".repeat(40);
const BASE = "c".repeat(40);
const MERGE_BASE = "d".repeat(40);
const TREE = "e".repeat(40);
const PUBLIC_DIGEST = `sha256:${"f".repeat(64)}`;
const TIME = "2026-08-13T12:00:00.000Z";

function fixtureHeadForPull(number) {
  return number === 7 ? HEAD : number.toString(16).padStart(40, "0");
}

function fixtureHeadRefForPull(number) {
  return number === 7 ? "feature" : `feature-${number}`;
}

function fixtureMergeForPull(number) {
  return number === 7 ? MERGE : (10_000 + number).toString(16).padStart(40, "0");
}

function fixtureTreeForPull(number) {
  return number === 7 ? TREE : (20_000 + number).toString(16).padStart(40, "0");
}

const REQUEST_URL =
  "https://github.com/owner/repo/pull/7#issuecomment-1001";
const ARTIFACT_URL =
  "https://github.com/owner/repo/pull/7#issuecomment-2001";
const NO_START_URL =
  "https://github.com/owner/repo/pull/7#issuecomment-2002";
const PROTECTED_AUTOMATIC_RECOVERY_INTERNAL = new RegExp([
  "recovery_handle",
  "artifact_binding_candidate_handle",
  "artifact_binding_intent_handle",
  "provider_artifact_handles",
  "ready_reachability_boundary",
  "closure_records",
  "evidence_snapshot",
].join("|"), "u");
const CONTROLLER_PATH = fileURLToPath(new URL(
  "../packages/action/src/v2/workflow-controller.mjs",
  import.meta.url,
));

test("controller source keeps the schedule line guard escaped and NUL-free", async () => {
  const source = await readFile(CONTROLLER_PATH);
  assert.equal(source.includes(0), false);
  assert.equal(
    source.toString("utf8").includes(
      String.raw`if (/[\0\r\n]/u.test(canonical))`,
    ),
    true,
  );
});

function scheduleDispatchBindingFixture() {
  return {
    generation_id: `candidate-dispatch:${"1".repeat(64)}`,
    cycle_id: `candidate-cycle:${"2".repeat(64)}`,
    inventory_digest: `sha256:${"3".repeat(64)}`,
    batch_index: 0,
    batch_count: 1,
    dispatch_digest: `sha256:${"4".repeat(64)}`,
    candidate: {
      id: "1007",
      node_id: "PR_7",
      number: 7,
      created_at: "2026-08-01T00:00:07.000Z",
      head_ref_oid: HEAD,
      base_ref_oid: BASE,
      observation_server_time: TIME,
      observation_raw_body_sha256: `sha256:${"5".repeat(64)}`,
    },
  };
}

function scheduleDispatchBindingTamperCases(binding) {
  const cases = [
    ["generation_id", (value) => {
      value.generation_id = `candidate-dispatch:${"9".repeat(64)}`;
    }],
    ["cycle_id", (value) => {
      value.cycle_id = `candidate-cycle:${"9".repeat(64)}`;
    }],
    ["inventory_digest", (value) => {
      value.inventory_digest = `sha256:${"9".repeat(64)}`;
    }],
    ["batch_index", (value) => { value.batch_index = 1; }],
    ["batch_count", (value) => { value.batch_count = 2; }],
    ["dispatch_digest", (value) => {
      value.dispatch_digest = `sha256:${"9".repeat(64)}`;
    }],
    ["candidate.id", (value) => { value.candidate.id = "9999"; }],
    ["candidate.node_id", (value) => {
      value.candidate.node_id = "PR_9999";
    }],
    ["candidate.number", (value) => { value.candidate.number = 8; }],
    ["candidate.created_at", (value) => {
      value.candidate.created_at = "2026-08-01T00:00:08.000Z";
    }],
    ["candidate.head_ref_oid", (value) => {
      value.candidate.head_ref_oid = "9".repeat(40);
    }],
    ["candidate.base_ref_oid", (value) => {
      value.candidate.base_ref_oid = "8".repeat(40);
    }],
    ["candidate.observation_server_time", (value) => {
      value.candidate.observation_server_time =
        "2026-08-13T12:00:01.000Z";
    }],
    ["candidate.observation_raw_body_sha256", (value) => {
      value.candidate.observation_raw_body_sha256 =
        `sha256:${"7".repeat(64)}`;
    }],
  ];
  return cases.map(([name, mutate]) => {
    const tampered = structuredClone(binding);
    mutate(tampered);
    return { name, binding: tampered };
  });
}

function publicReport({
  mode = "test-merge-with-head-sentinel",
  decision = "pending",
  potentialTargetState,
} = {}) {
  const targetState = mode === "head"
    ? "not-applicable"
    : potentialTargetState ?? (
      ["blocked-configuration", "blocked-input"].includes(decision)
        ? "unavailable"
        : "validated"
    );
  const requestPolicy = {
    status: "compliant",
    warnings: [],
    warning_evidence: { legacy_triple_alias: null },
    request_id: "1001",
    request_url: REQUEST_URL,
    manual: false,
    generation_id: "automatic:1",
    generation_kind: "automatic",
    generation_index: 1,
    automatic_reservations_consumed_on_head: 1,
    manual_requests_in_review_epoch: 0,
    permission_assurance: null,
    request_time_permission: null,
    permission_aba_excluded: null,
  };
  const terminal = ["clean", "findings"].includes(decision);
  const noStart = decision === "skipped-unavailable";
  const evidenceBasis = terminal
    ? publicEvidenceBasis({
      kind: "terminal-payload",
      outcome: decision,
      id: "2001",
      url: ARTIFACT_URL,
      requestBound: false,
    })
    : noStart
      ? publicEvidenceBasis({
        kind: "stable-exact-no-start",
        outcome: decision,
        id: "2002",
        url: NO_START_URL,
        requestBound: true,
      })
      : null;
  return {
    schema_version: 2,
    snapshot_fingerprint: PUBLIC_DIGEST,
    selection: {
      selected: true,
      intent: "required",
      mode: "implicit",
      source: "active-ruleset",
    },
    server_enforcement: "enforced",
    review_epoch: {
      host: "github.com",
      repository: "owner/repo",
      pull_request: 7,
      pr_state: "OPEN",
      pr_merged: false,
      pr_merged_at: null,
      base_ref: "main",
      live_base_ref_tip: BASE,
      head_ref: "feature",
      head_ref_oid: HEAD,
      pr_merge_base: MERGE_BASE,
      controlled_request_id: "1001",
    },
    request_policy: requestPolicy,
    provider_profile: terminal
      ? "terminal-payload"
      : noStart
        ? "no-start-rejection"
        : decision === "pending"
          ? "unknown"
          : null,
    provider_input_lineage: "unavailable",
    evidence_basis: evidenceBasis,
    status_target: publicStatusTarget({ mode, targetState, decision }),
    decision,
    freshness_assurance: "point-in-time",
  };
}

function preEpochPublicReport(decision) {
  const value = publicReport({ decision });
  value.server_enforcement = decision === "blocked-configuration"
    ? "not-enforced"
    : "enforced";
  value.review_epoch = null;
  value.request_policy = {
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
  };
  value.provider_profile = null;
  value.evidence_basis = null;
  value.status_target = null;
  return value;
}

function publicEvidenceBasis({ kind, outcome, id, url, requestBound }) {
  const artifactTime = "2026-08-13T12:10:00.000Z";
  const requestTime = requestBound ? "2026-08-13T12:05:00.000Z" : null;
  return {
    kind,
    outcome,
    selected_ids: [id],
    selected_urls: [url],
    server_times: {
      request: requestTime,
      selected: [{ id, server_time: artifactTime }],
    },
    pagination_complete: true,
    final_reread_complete: true,
    scope_assurance: "whole-pr-contractual",
    provider_input_lineage: "unavailable",
    finding_recovery: null,
    authority_receipt: {
      selected_request: requestBound
        ? { id: "1001", url: REQUEST_URL, created_at: requestTime }
        : null,
      selected_artifact: { id, url, created_at: artifactTime },
      pagination_sha256: PUBLIC_DIGEST,
      final_reread_sha256: PUBLIC_DIGEST,
      recovery: null,
    },
  };
}

function publicStatusTarget({ mode, targetState, decision }) {
  const sentinelState = {
    pending: "pending",
    clean: "pending",
    findings: "failure",
    inconclusive: "error",
    "skipped-unavailable": "pending",
    "blocked-configuration": "error",
    "blocked-input": "error",
  }[decision] ?? "absent";
  const common = {
    context: V2_STATUS_CONTEXT,
    mode,
    live_base_ref_tip: BASE,
    head_ref_oid: HEAD,
    pr_merge_base: MERGE_BASE,
  };
  if (mode === "head") {
    const observation = (observed_http_date) => ({
      observed_http_date,
      pr_state: "OPEN",
      pr_merged: false,
      pr_merged_at: null,
      live_base_ref_tip: BASE,
      head_ref_oid: HEAD,
      pr_merge_base: MERGE_BASE,
    });
    return {
      ...common,
      potential_merge_commit_oid: null,
      potential_merge_commit_tree_oid: null,
      potential_merge_commit_parent_oids: null,
      merge_ref_oid: null,
      potential_target_state: "not-applicable",
      head_sentinel_state: sentinelState,
      validation_receipt: {
        pre: observation("2026-08-13T12:00:00.000Z"),
        post: observation("2026-08-13T12:01:00.000Z"),
      },
    };
  }
  const validated = targetState === "validated";
  const observation = (observed_http_date) => ({
    observed_http_date,
    pr_state: "OPEN",
    pr_merged: false,
    pr_merged_at: null,
    mergeable: "MERGEABLE",
    live_base_ref_tip: BASE,
    head_ref_oid: HEAD,
    pr_merge_base: MERGE_BASE,
    potential_merge_commit_oid: MERGE,
    potential_merge_commit_tree_oid: TREE,
    potential_merge_commit_parent_oids: [BASE, HEAD],
    merge_ref_oid: MERGE,
  });
  return {
    ...common,
    potential_merge_commit_oid: validated ? MERGE : null,
    potential_merge_commit_tree_oid: validated ? TREE : null,
    potential_merge_commit_parent_oids: validated ? [BASE, HEAD] : null,
    merge_ref_oid: validated ? MERGE : null,
    potential_target_state: targetState,
    head_sentinel_state: sentinelState,
    validation_receipt: validated
      ? {
        pre: observation("2026-08-13T12:00:00.000Z"),
        post: observation("2026-08-13T12:01:00.000Z"),
      }
      : null,
  };
}

test("status effects use an append-only retry-zero WAL before exact response binding", () => {
  const empty = createV2EffectLedger({
    repository_node_id: "R_repo",
    pull_request_node_id: "PR_7",
    head_ref_oid: HEAD,
    created_at: TIME,
  });
  const write = {
    role: "primary-terminal",
    sha: MERGE,
    context: "codex/github-review-gate",
    state: "success",
    reason: "decision-clean",
    idempotency_key: `status:${"c".repeat(64)}`,
  };
  assert.deepEqual(
    validateV2StatusWrites(
      {
        mode: "test-merge-with-head-sentinel",
        decision: "clean",
        writes: [write],
        terminal_cutover: true,
      },
      {
        head_ref_oid: HEAD,
        status_target_mode: "test-merge-with-head-sentinel",
        public_report: publicReport({ decision: "clean" }),
      },
    ),
    [write],
  );
  const reserved = reserveV2Effect({
    ledger: empty,
    kind: "commit-status",
    idempotency_key: write.idempotency_key,
    payload: write,
    recorded_at: TIME,
  });
  assert.equal(reserved.effects[0].state, "reserved");
  assert.equal(reserved.effects[0].retry_limit, 0);
  assert.equal(reserved.effects[0].network_uncertainty_policy, "do-not-retry-or-reclaim");

  const attempted = markV2EffectAttempted({
    ledger: reserved,
    effect_id: reserved.effects[0].effect_id,
    attempted_at: "2026-08-13T12:00:01.000Z",
  });
  assert.equal(attempted.effects[0].state, "attempted");
  assert.throws(
    () => markV2EffectAttempted({
      ledger: attempted,
      effect_id: attempted.effects[0].effect_id,
      attempted_at: "2026-08-13T12:00:02.000Z",
    }),
    /only a durably reserved effect/u,
  );

  const bound = bindV2EffectResponse({
    ledger: attempted,
    effect_id: attempted.effects[0].effect_id,
    http_status: 201,
    server_time: "2026-08-13T12:00:02.000Z",
    raw_body: JSON.stringify({ id: 1 }),
    receipt: {
      sha: MERGE,
      context: "codex/github-review-gate",
      state: "success",
      id: "1",
    },
  });
  assert.equal(validateV2EffectLedger(bound).effects[0].state, "bound");
  assert.throws(
    () => reserveV2Effect({
      ledger: bound,
      kind: "commit-status",
      idempotency_key: write.idempotency_key,
      payload: write,
      recorded_at: "2026-08-13T12:00:03.000Z",
    }),
    /already consumed/u,
  );
});

test("closed selected pre-epoch blockers produce exactly zero status writes", () => {
  for (const decision of ["blocked-input", "blocked-configuration"]) {
    const plan = {
      mode: "test-merge-with-head-sentinel",
      decision,
      writes: [],
      terminal_cutover: false,
    };
    assert.deepEqual(
      validateV2StatusWrites(plan, {
        head_ref_oid: null,
        status_target_mode: "test-merge-with-head-sentinel",
        public_report: preEpochPublicReport(decision),
      }),
      [],
      decision,
    );
  }
});

test("closed selected pre-epoch blockers reject forged status writes", () => {
  const forged = {
    role: "head-sentinel",
    sha: HEAD,
    context: V2_STATUS_CONTEXT,
    state: "error",
    reason: "forged-pre-epoch-write",
    idempotency_key: `status:${"9".repeat(64)}`,
  };
  assert.throws(
    () => validateV2StatusWrites({
      mode: "test-merge-with-head-sentinel",
      decision: "blocked-input",
      writes: [forged],
      terminal_cutover: false,
    }, {
      head_ref_oid: HEAD,
      status_target_mode: "test-merge-with-head-sentinel",
      public_report: preEpochPublicReport("blocked-input"),
    }),
    /exact public report write count/u,
  );
});

test("head sentinel never succeeds and blocked targets may emit only non-success head writes", () => {
  const blockedReport = publicReport({ decision: "blocked-input" });
  const blocked = {
    mode: "test-merge-with-head-sentinel",
    decision: "blocked-input",
    writes: [{
      role: "head-sentinel",
      sha: HEAD,
      context: "codex/github-review-gate",
      state: "error",
      reason: "potential-merge-unavailable",
      idempotency_key: `status:${"d".repeat(64)}`,
    }],
    terminal_cutover: false,
  };
  assert.equal(
    validateV2StatusWrites(blocked, {
      head_ref_oid: HEAD,
      public_report: blockedReport,
    })[0].state,
    "error",
  );
  assert.throws(
    () => validateV2StatusWrites({
      ...blocked,
      writes: [{ ...blocked.writes[0], state: "success" }],
    }, { head_ref_oid: HEAD, public_report: blockedReport }),
    /head sentinel must never receive success/u,
  );
  assert.throws(
    () => validateV2StatusWrites({
      ...blocked,
      writes: [{ ...blocked.writes[0], sha: MERGE }],
    }, { head_ref_oid: HEAD, public_report: blockedReport }),
    /must target the current head/u,
  );
  assert.throws(
    () => validateV2StatusWrites({
      ...blocked,
      writes: [{ ...blocked.writes[0], role: "primary" }],
    }, { head_ref_oid: HEAD, public_report: blockedReport }),
    /not a closed value/u,
  );
  assert.throws(
    () => validateV2StatusWrites({
      ...blocked,
      writes: [{ ...blocked.writes[0], role: "primary-terminal" }],
      terminal_cutover: true,
    }, { head_ref_oid: HEAD, public_report: blockedReport }),
    /only by the head-sentinel role/u,
  );
});

test("head mode forbids terminal cutover and explicitly suppresses clean or skipped writes", () => {
  const findingsReport = publicReport({ mode: "head", decision: "findings" });
  const findings = {
    mode: "head",
    decision: "findings",
    writes: [{
      role: "head-sentinel",
      sha: HEAD,
      context: "codex/github-review-gate",
      state: "failure",
      reason: "decision-findings",
      idempotency_key: `status:${"e".repeat(64)}`,
    }],
    terminal_cutover: false,
  };
  assert.equal(
    validateV2StatusWrites(findings, {
      head_ref_oid: HEAD,
      status_target_mode: "head",
      public_report: findingsReport,
    })[0].role,
    "head-sentinel",
  );

  const clean = {
    mode: "head",
    decision: "clean",
    writes: [],
    terminal_cutover: false,
    suppressed_writes: [],
    suppression_reason: "suppressed-unsupported-terminal-target",
  };
  const cleanReport = publicReport({ mode: "head", decision: "clean" });
  assert.deepEqual(
    validateV2StatusWrites(clean, {
      head_ref_oid: HEAD,
      status_target_mode: "head",
      public_report: cleanReport,
    }),
    [],
  );
  const skipped = { ...clean, decision: "skipped-unavailable" };
  const skippedReport = publicReport({
    mode: "head",
    decision: "skipped-unavailable",
  });
  assert.deepEqual(
    validateV2StatusWrites(skipped, {
      head_ref_oid: HEAD,
      status_target_mode: "head",
      public_report: skippedReport,
    }),
    [],
  );
  for (const [plan, report] of [[clean, cleanReport], [skipped, skippedReport]]) {
    assert.throws(
      () => validateV2StatusWrites({
        ...plan,
        suppressed_writes: undefined,
        suppression_reason: undefined,
      }, {
        head_ref_oid: HEAD,
        status_target_mode: "head",
        public_report: report,
      }),
      /require explicit zero-write suppression/u,
    );
  }
  assert.throws(
    () => validateV2StatusWrites({
      mode: "head",
      decision: "findings",
      writes: [{
        ...findings.writes[0],
        role: "primary-terminal",
        sha: MERGE,
      }],
      terminal_cutover: true,
    }, {
      head_ref_oid: HEAD,
      status_target_mode: "head",
      public_report: findingsReport,
    }),
    /exact public report target and decision/u,
  );
  assert.throws(
    () => validateV2StatusWrites(findings, {
      head_ref_oid: HEAD,
      status_target_mode: "test-merge-with-head-sentinel",
      public_report: findingsReport,
    }),
    /mode does not match/u,
  );
  assert.throws(
    () => validateV2StatusWrites({ ...findings, mode: undefined }, {
      head_ref_oid: HEAD,
      public_report: findingsReport,
    }),
    /status target mode is not a closed value/u,
  );
  assert.throws(
    () => validateV2StatusWrites({ ...findings, decision: undefined }, {
      head_ref_oid: HEAD,
      status_target_mode: "head",
      public_report: findingsReport,
    }),
    /status plan decision is not a closed value/u,
  );
});

test("status writes are exactly derived from the rich public decision and target receipt", () => {
  const headFindings = publicReport({ mode: "head", decision: "findings" });
  assert.throws(
    () => validateV2StatusWrites({
      mode: "head",
      decision: "findings",
      writes: [statusWrite({
        role: "head-sentinel",
        sha: HEAD,
        state: "error",
        suffix: "1",
      })],
      terminal_cutover: false,
    }, {
      head_ref_oid: HEAD,
      status_target_mode: "head",
      public_report: headFindings,
    }),
    /exact public report target and decision/u,
  );

  const mergeClean = publicReport({ decision: "clean" });
  assert.throws(
    () => validateV2StatusWrites({
      mode: "test-merge-with-head-sentinel",
      decision: "clean",
      writes: [
        statusWrite({
          role: "primary-terminal",
          sha: MERGE,
          state: "failure",
          suffix: "2",
        }),
        statusWrite({
          role: "head-sentinel",
          sha: HEAD,
          state: "error",
          suffix: "3",
        }),
      ],
      terminal_cutover: true,
    }, {
      head_ref_oid: HEAD,
      public_report: mergeClean,
    }),
    /exact public report write count/u,
  );

  const mergePending = publicReport({ decision: "pending" });
  assert.throws(
    () => validateV2StatusWrites({
      mode: "test-merge-with-head-sentinel",
      decision: "pending",
      writes: [statusWrite({
        role: "primary-terminal",
        sha: MERGE,
        state: "failure",
        suffix: "4",
      })],
      terminal_cutover: true,
    }, {
      head_ref_oid: HEAD,
      public_report: mergePending,
    }),
    /exact public report target and decision/u,
  );

  const forgedTarget = structuredClone(mergePending);
  forgedTarget.status_target.potential_merge_commit_oid = "1".repeat(40);
  assert.throws(
    () => validateV2StatusWrites({
      mode: "test-merge-with-head-sentinel",
      decision: "pending",
      writes: [statusWrite({
        role: "head-sentinel",
        sha: HEAD,
        state: "pending",
        suffix: "5",
      })],
      terminal_cutover: false,
    }, {
      head_ref_oid: HEAD,
      public_report: forgedTarget,
    }),
    /merge_ref_oid must equal/u,
  );

  const staleReceipt = structuredClone(mergePending);
  staleReceipt.status_target.validation_receipt.post.head_ref_oid = "2".repeat(40);
  assert.throws(
    () => validateV2StatusWrites({
      mode: "test-merge-with-head-sentinel",
      decision: "pending",
      writes: [statusWrite({
        role: "head-sentinel",
        sha: HEAD,
        state: "pending",
        suffix: "6",
      })],
      terminal_cutover: false,
    }, {
      head_ref_oid: HEAD,
      public_report: staleReceipt,
    }),
    /parent order/u,
  );
});

test("findings preserve a failure head sentinel for every non-validated merge target", () => {
  for (const [index, potentialTargetState] of [
    "unavailable",
    "invalid",
    "conflicting",
    "stale",
  ].entries()) {
    const report = publicReport({
      decision: "findings",
      potentialTargetState,
    });
    const failureWrite = statusWrite({
      role: "head-sentinel",
      sha: HEAD,
      state: "failure",
      suffix: ["7", "8", "9", "a"][index],
    });
    const plan = {
      mode: "test-merge-with-head-sentinel",
      decision: "findings",
      writes: [failureWrite],
      terminal_cutover: false,
    };
    assert.deepEqual(
      validateV2StatusWrites(plan, {
        head_ref_oid: HEAD,
        public_report: report,
      }),
      [failureWrite],
    );
    assert.throws(
      () => validateV2StatusWrites({
        ...plan,
        writes: [{ ...failureWrite, state: "error" }],
      }, {
        head_ref_oid: HEAD,
        public_report: report,
      }),
      /exact public report target and decision/u,
    );
  }
});

test("ambiguous or wrong-status effects stay consumed and cannot bind", () => {
  const base = createV2EffectLedger({
    repository_node_id: "R_repo",
    pull_request_node_id: "PR_7",
    head_ref_oid: HEAD,
    created_at: TIME,
  });
  const payload = {
    method: "POST",
    comment_id: null,
    body_sha256: `sha256:${"e".repeat(64)}`,
    projection_digest: `sha256:${"f".repeat(64)}`,
  };
  const reserved = reserveV2Effect({
    ledger: base,
    kind: "sticky-comment",
    idempotency_key: `sticky:${"1".repeat(64)}`,
    payload,
    recorded_at: TIME,
  });
  const attempted = markV2EffectAttempted({
    ledger: reserved,
    effect_id: reserved.effects[0].effect_id,
    attempted_at: TIME,
  });
  assert.throws(
    () => bindV2EffectResponse({
      ledger: attempted,
      effect_id: attempted.effects[0].effect_id,
      http_status: 500,
      server_time: TIME,
      raw_body: "failure",
      receipt: null,
    }),
    /requires exact HTTP 201/u,
  );
  assert.equal(attempted.effects[0].state, "attempted");
  assert.throws(
    () => markV2EffectAttempted({
      ledger: attempted,
      effect_id: attempted.effects[0].effect_id,
      attempted_at: TIME,
    }),
    /only a durably reserved effect/u,
  );
});

test("real status transport persists WAL before one POST 201 and exact GET", async () => {
  const requests = [];
  const responseBody = JSON.stringify({
    id: 901,
    sha: MERGE,
    context: "codex/github-review-gate",
    state: "success",
  });
  const transport = createV2GitHubEffectTransport({
    token: "synthetic-token-for-v2-controller-tests-only",
    restBaseUrl: "https://api.github.test",
    async fetch(url, init) {
      requests.push({ url: String(url), method: init.method, body: init.body ?? null });
      return response(
        init.method === "POST" ? 201 : 200,
        init.method === "POST" ? responseBody : `[${responseBody}]`,
        init.method === "POST"
          ? "Wed, 13 Aug 2026 12:00:02 GMT"
          : "Wed, 13 Aug 2026 12:00:03 GMT",
      );
    },
  });
  const persisted = [];
  const persist = async (ledger, phase) => {
    persisted.push({ phase, digest: ledger.ledger_digest });
    return structuredClone(ledger);
  };
  const initial = createV2EffectLedger({
    repository_node_id: "R_repo",
    pull_request_node_id: "PR_7",
    head_ref_oid: HEAD,
    created_at: TIME,
  });
  const write = {
    role: "primary-terminal",
    sha: MERGE,
    context: "codex/github-review-gate",
    state: "success",
    reason: "decision-clean",
    idempotency_key: `status:${"9".repeat(64)}`,
  };
  const reserved = await reserveAndPersistV2Effect({
    ledger: initial,
    kind: "commit-status",
    idempotency_key: write.idempotency_key,
    payload: write,
    recorded_at: TIME,
    persist_ledger: persist,
  });
  const outcome = await executeV2EffectOnce({
    ledger: reserved,
    effect_id: reserved.effects[0].effect_id,
    attempted_at: "2026-08-13T12:00:01.000Z",
    persist_ledger: persist,
    perform_effect: (effect) => transport.performEffect({
      effect,
      repository: { owner: "owner", name: "repo" },
      pull_number: 7,
    }),
  });

  assert.deepEqual(persisted.map(({ phase }) => phase), ["reserved", "attempted", "bound"]);
  assert.equal(outcome.ledger.effects[0].state, "bound");
  assert.deepEqual(
    requests.map(({ method, url }) => ({ method, url })),
    [
      {
        method: "POST",
        url: `https://api.github.test/repos/owner/repo/statuses/${MERGE}`,
      },
      {
        method: "GET",
        url: `https://api.github.test/repos/owner/repo/commits/${MERGE}/statuses?per_page=100&page=1`,
      },
    ],
  );
  assert.deepEqual(JSON.parse(requests[0].body), {
    state: "success",
    context: "codex/github-review-gate",
    description: "decision-clean",
  });
});

test("production status transport rejects a forged handle before any POST", async () => {
  let fetchCalls = 0;
  const transport = createV2GitHubProductionStatusTransport({
    fetch: async () => {
      fetchCalls += 1;
      throw new Error("forged status handle reached the network");
    },
    token: "synthetic-token-for-v2-controller-tests-only",
    restBaseUrl: "https://api.github.test",
    repository: { owner: "owner", name: "repo" },
  });
  await assert.rejects(
    transport.performStatusWrite({
      status_intent_handle: {
        schema: "codex-review-gate-git-ledger-status-write-intent-handle-v2",
        schema_version: 1,
        intent_commit_sha: HEAD,
        append_receipt_digest: `sha256:${"1".repeat(64)}`,
        transport_digest: `sha256:${"2".repeat(64)}`,
        intent_digest: `sha256:${"3".repeat(64)}`,
      },
    }),
    (error) => error?.code === "UNTRUSTED_STATUS_WRITE_INTENT_HANDLE",
  );
  assert.equal(fetchCalls, 0);
});

test("GitHub ledger store persists and exact-refetches monotonic controller state", async () => {
  let comment = null;
  const calls = [];
  const trusted = (body) => ({
    id: 71,
    node_id: "IC_71",
    body,
    user: { login: "github-actions[bot]", type: "Bot" },
    performed_via_github_app: { slug: "github-actions" },
  });
  const store = createV2GitHubLedgerStore({
    token: "synthetic-token-for-v2-controller-tests-only",
    restBaseUrl: "https://api.github.test",
    repository: { owner: "owner", name: "repo" },
    pull_number: 7,
    async fetch(url, init) {
      const parsed = new URL(url);
      calls.push({ method: init.method, path: `${parsed.pathname}${parsed.search}` });
      if (parsed.pathname.endsWith("/issues/7/comments") && init.method === "GET") {
        return response(200, JSON.stringify(comment === null ? [] : [comment]),
          "Wed, 13 Aug 2026 12:00:01 GMT");
      }
      if (parsed.pathname.endsWith("/issues/7/comments") && init.method === "POST") {
        comment = trusted(JSON.parse(init.body).body);
        return response(201, JSON.stringify(comment), "Wed, 13 Aug 2026 12:00:02 GMT");
      }
      if (parsed.pathname.endsWith("/issues/comments/71") && init.method === "PATCH") {
        comment = trusted(JSON.parse(init.body).body);
        return response(200, JSON.stringify(comment), "Wed, 13 Aug 2026 12:00:03 GMT");
      }
      if (parsed.pathname.endsWith("/issues/comments/71") && init.method === "GET") {
        return response(200, JSON.stringify(comment), "Wed, 13 Aug 2026 12:00:04 GMT");
      }
      throw new Error(`unexpected request ${init.method} ${url}`);
    },
  });
  const initial = createV2EffectLedger({
    repository_node_id: "R_repo",
    pull_request_node_id: "PR_7",
    head_ref_oid: HEAD,
    created_at: TIME,
  });
  assert.deepEqual(await store.persistLedger(initial), initial);
  const loaded = await store.loadLedger({
    repository_node_id: "R_repo",
    pull_request_node_id: "PR_7",
    head_ref_oid: HEAD,
  });
  assert.equal(loaded.ledger.ledger_digest, initial.ledger_digest);

  const write = {
    role: "head-sentinel",
    sha: HEAD,
    context: "codex/github-review-gate",
    state: "pending",
    reason: "awaiting-terminal-test-merge-decision",
    idempotency_key: `status:${"8".repeat(64)}`,
  };
  const next = await reserveAndPersistV2Effect({
    ledger: initial,
    kind: "commit-status",
    idempotency_key: write.idempotency_key,
    payload: write,
    recorded_at: "2026-08-13T12:00:05.000Z",
    persist_ledger: (ledger) => store.persistLedger(ledger),
  });
  assert.equal(next.effects.length, 1);
  assert.equal((await store.loadLedger({
    repository_node_id: "R_repo",
    pull_request_node_id: "PR_7",
    head_ref_oid: HEAD,
  })).ledger.effects[0].state, "reserved");
  assert.equal(calls.some(({ method }) => method === "POST"), true);
  assert.equal(calls.some(({ method }) => method === "PATCH"), true);
});

test("legacy head reservation projection survives deleted comment WAL without refund", async () => {
  const reservation = reservationFixture();
  const statuses = [];
  const comments = [];
  const requests = [];
  const ledger = createV2GitHubReservationLedger({
    token: "synthetic-token-for-v2-controller-tests-only",
    restBaseUrl: "https://api.github.test",
    repository: { owner: "owner", name: "repo" },
    async fetch(url, init) {
      const parsed = new URL(url);
      requests.push({ method: init.method, path: `${parsed.pathname}${parsed.search}` });
      if (init.method === "GET" && parsed.pathname.endsWith(`/commits/${HEAD}/statuses`)) {
        return response(200, JSON.stringify(statuses), "Wed, 13 Aug 2026 12:00:01 GMT");
      }
      if (init.method === "POST" && parsed.pathname.endsWith(`/statuses/${HEAD}`)) {
        const body = JSON.parse(init.body);
        const created = {
          id: 801,
          sha: HEAD,
          state: body.state,
          context: body.context,
          description: body.description,
          creator: { login: "github-actions[bot]", type: "Bot" },
          created_at: "2026-08-13T12:00:01.000Z",
          updated_at: "2026-08-13T12:00:01.000Z",
        };
        statuses.push(created);
        return response(201, JSON.stringify(created), "Wed, 13 Aug 2026 12:00:01 GMT");
      }
      throw new Error(`unexpected request ${init.method} ${url}`);
    },
  });
  const persisted = await ledger.persistReservation(reservation);
  assert.equal(persisted.ordinal, 1);
  assert.equal(persisted.reservation_digest, reservation.reservation_digest);
  assert.equal((await ledger.loadReservations({ head_ref_oid: HEAD }))
    .automatic_reservations_on_head, 1);

  // The legacy compatibility harness must not infer a refund after an audit
  // status was observed merely because its unrelated comment WAL disappeared.
  comments.splice(0);
  comments.push({ body: "forged replacement comment" });
  await assert.rejects(
    ledger.persistReservation(reservation),
    /already consumed/u,
  );
  assert.equal((await ledger.loadReservations({ head_ref_oid: HEAD }))
    .automatic_reservations_on_head, 1);
  assert.equal(requests.filter(({ method }) => method === "POST").length, 1);
});

test("legacy cycle keeps its compatibility order outside production authority", async () => {
  const events = [];
  let durableLedger = null;
  const reservation = reservationFixture();
  const attempt = {
    schema: "codex-review-gate-request-attempt-v2",
    schema_version: 1,
    attempt_id: reservation.attempt_id,
    reservation_digest: reservation.reservation_digest,
    scheduler_intent_id: reservation.scheduler_intent_id,
    recorded_at: TIME,
    recorded_before_effect: true,
    retry_limit: 0,
    attempt_digest: `sha256:${"6".repeat(64)}`,
  };
  const binding = {
    schema: "codex-review-gate-request-binding-v2",
    receipt_digest: `sha256:${"7".repeat(64)}`,
  };
  const pendingWrite = statusWrite({
    role: "head-sentinel",
    sha: HEAD,
    state: "pending",
    suffix: "8",
  });
  const terminalWrite = statusWrite({
    role: "primary-terminal",
    sha: MERGE,
    state: "success",
    suffix: "9",
  });
  const report = {
    selection: { status: "selected" },
    server_enforcement: { status: "enforced" },
    review_epoch: { head_oid: HEAD, merge_oid: MERGE },
    request_policy: { status: "compliant" },
    provider_profile: "thumbs-up-clean",
    provider_input_lineage: "unavailable",
    evidence_basis: { kind: "thumbs-up-clean" },
    status_target: { mode: "test-merge-with-head-sentinel", sha: MERGE },
    decision: "clean",
  };
  const result = (overrides = {}) => ({
    writes_performed: false,
    reducer_report: structuredClone(report),
    report: publicReport({ decision: "clean" }),
    scheduler_plan: { actions: [] },
    status_plan: {
      mode: "test-merge-with-head-sentinel",
      decision: "clean",
      writes: [],
      terminal_cutover: false,
    },
    reservation: null,
    post_intent: null,
    binding_receipt: null,
    ...overrides,
  });
  const results = {
    initial: result({
      reducer_report: { ...structuredClone(report), decision: "pending" },
      report: publicReport({ decision: "pending" }),
      scheduler_plan: {
        actions: [
          {
            kind: "publish_status",
            idempotency_key: `publish-status:${"a".repeat(64)}`,
          },
          {
            kind: "persist_auto_request_intent",
            idempotency_key: `persist-auto-request-intent:${"b".repeat(64)}`,
            intent_id: reservation.scheduler_intent_id,
          },
          {
            kind: "post_review_request",
            idempotency_key: `post-review-request:${"c".repeat(64)}`,
            intent_id: reservation.scheduler_intent_id,
            depends_on_idempotency_key: `persist-auto-request-intent:${"b".repeat(64)}`,
          },
        ],
      },
      status_plan: {
        mode: "test-merge-with-head-sentinel",
        decision: "pending",
        writes: [pendingWrite],
        terminal_cutover: false,
      },
      reservation,
      post_intent: { pre_effect_attempt_receipt: attempt },
    }),
    "bind-request": result({ binding_receipt: binding }),
    "pre-sticky-final-reread": result(),
    "terminal-final-reread": result({
      status_plan: {
        mode: "test-merge-with-head-sentinel",
        decision: "clean",
        writes: [terminalWrite],
        terminal_cutover: true,
      },
    }),
  };
  const stickyBody = "controller sticky body";
  const stickyDigest = `sha256:${createHash("sha256").update(stickyBody).digest("hex")}`;
  const initialInput = {
    phase: "initial",
    status_target_mode: "test-merge-with-head-sentinel",
    snapshot_request: { owner: "owner", repo: "repo", pull_number: 7 },
    head_ledger: {
      repository_node_id: "R_repo",
      pull_request_node_id: "PR_7",
      head_ref_oid: HEAD,
      observed_at: TIME,
    },
  };

  const outcome = await executeV2ControllerCycle({
    initial_input: initialInput,
    runner_dependencies: {},
    async run_operation(input) {
      events.push(`run:${input.phase}`);
      return structuredClone(results[input.phase]);
    },
    ledger_store: {
      async loadLedger() { return durableLedger === null ? null : { ledger: durableLedger }; },
      async persistLedger(value) {
        durableLedger = structuredClone(value);
        events.push(`wal:${value.effects.at(-1)?.kind ?? "initial"}:${value.effects.at(-1)?.state ?? "empty"}`);
        return structuredClone(value);
      },
    },
    reservation_ledger: {
      async persistReservation(value) {
        events.push("reservation-status");
        return { ordinal: value.ordinal, reservation_digest: value.reservation_digest };
      },
    },
    effect_transport: {
      async performEffect({ effect }) {
        events.push(`effect:${effect.kind}:${effect.payload.state ?? effect.payload.method ?? "post"}`);
        if (effect.kind === "commit-status") {
          return {
            http_status: 201,
            server_time: "2026-08-13T12:00:02.000Z",
            raw_body: JSON.stringify({ id: effect.payload.state }),
            receipt: {
              sha: effect.payload.sha,
              context: effect.payload.context,
              state: effect.payload.state,
              id: effect.payload.state === "pending" ? "1" : "2",
            },
          };
        }
        if (effect.kind === "request-comment") {
          return {
            http_status: 201,
            server_time: "2026-08-13T12:00:02.000Z",
            raw_body: JSON.stringify({ id: 71 }),
          };
        }
        return {
          http_status: 201,
          server_time: "2026-08-13T12:00:02.000Z",
          raw_body: JSON.stringify({ id: 72 }),
        };
      },
    },
    async persist_scheduler_intent(value) {
      events.push("scheduler-intent");
      return structuredClone(value);
    },
    async persist_request_binding(value) {
      events.push("request-binding");
      return structuredClone(value);
    },
    async build_runner_input({ phase }) { return { phase }; },
    async build_sticky_effect() {
      return {
        body: stickyBody,
        idempotency_key: `sticky:${"d".repeat(64)}`,
        payload: {
          method: "POST",
          comment_id: null,
          body_sha256: stickyDigest,
          projection_digest: `sha256:${"e".repeat(64)}`,
        },
        receipt_builder: async () => ({
          comment_id: "72",
          comment_node_id: "IC_72",
          raw_body_sha256: stickyDigest,
          binding_sha256: `sha256:${"f".repeat(64)}`,
        }),
      };
    },
    clock(_phase, floor) { return floor ?? TIME; },
  });

  const order = [
    "effect:commit-status:pending",
    "scheduler-intent",
    "reservation-status",
    "effect:request-comment:post",
    "request-binding",
    "effect:sticky-comment:POST",
    "run:terminal-final-reread",
    "effect:commit-status:success",
  ].map((entry) => events.indexOf(entry));
  assert.equal(order.every((index) => index >= 0), true, events.join("\n"));
  assert.deepEqual([...order].sort((left, right) => left - right), order);
  assert.equal(outcome.binding_receipt.receipt_digest, binding.receipt_digest);
  assert.equal(outcome.sticky_receipt.comment_id, "72");
  assert.equal(outcome.ledger.effects.every((effect) => effect.state === "bound"), true);
});

test("production OIDC verifier caches trust material and mints one signed token per ledger operation", async () => {
  const oidc = oidcFixture();
  const verifier = createV2GitHubOidcProvenanceVerifier({
    fetch: oidc.fetch,
    environment: oidc.environment,
    policy: oidc.policy,
    clock: () => Date.parse(TIME),
  });
  const initialized = await verifier.initialize();
  assert.equal(initialized.initialized, true);
  assert.equal(initialized.discovery.raw_body_sha256, oidc.discoveryRawDigest);

  const firstRequest = oidcRequestFixture("1");
  const secondRequest = oidcRequestFixture("2");
  const first = await verifier.verifyWorkflowProvenance(
    oidcVerifierRequest("mint-and-verify", firstRequest),
    oidcVerifierExecutionContext(),
  );
  const second = await verifier.verifyWorkflowProvenance(
    oidcVerifierRequest("mint-and-verify", secondRequest),
    oidcVerifierExecutionContext(),
  );
  assert.equal(first.schema, V2_GIT_LEDGER_PROVENANCE_VERIFIER_RESULT_SCHEMA);
  assert.equal(first.compact_jwt, oidc.tokens[0]);
  validateV2GitLedgerProvenanceReceipt(first.receipt, {
    request: firstRequest,
    policy: oidc.policy,
  });
  validateV2GitLedgerProvenanceReceipt(second.receipt, {
    request: secondRequest,
    policy: oidc.policy,
  });
  assert.notEqual(first.receipt.audience, second.receipt.audience);
  assert.notEqual(first.receipt.token_sha256, second.receipt.token_sha256);
  assert.deepEqual(Object.keys(first.receipt.claims).sort(), [
    ...V2_GIT_LEDGER_OIDC_CLAIMS,
    "jti",
  ].sort());
  assert.equal(Object.hasOwn(first.receipt.claims, "actor"), false);
  assert.deepEqual(oidc.calls.map((call) => call.kind), [
    "discovery", "jwks", "mint", "mint",
  ]);
  assert.equal(oidc.calls[2].authorization, "Bearer codex_synth_v1_bearer_a");
  assert.equal(oidc.calls[2].audience, firstRequest.audience);
  assert.equal(oidc.calls[3].audience, secondRequest.audience);
  assert.equal(JSON.stringify(first.receipt).includes(oidc.tokens[0]), false);

  const reverified = await verifier.verifyWorkflowProvenance(
    oidcVerifierRequest(
      "reverify-stored",
      firstRequest,
      first.compact_jwt,
      first.receipt,
    ),
    oidcVerifierExecutionContext(),
  );
  assert.equal(reverified.compact_jwt, null);
  assert.equal(reverified.receipt.token_sha256, first.receipt.token_sha256);
  assert.equal(
    reverified.receipt.replay_prevention_receipt_digest,
    first.receipt.replay_prevention_receipt_digest,
  );
  assert.deepEqual(oidc.calls.map((call) => call.kind), [
    "discovery", "jwks", "mint", "mint",
  ]);
});

test("OIDC verifier admits only the closed checkpoint-rotate provenance shape", async () => {
  const oidc = oidcFixture();
  const verifier = createV2GitHubOidcProvenanceVerifier({
    fetch: oidc.fetch,
    environment: oidc.environment,
    policy: oidc.policy,
    clock: () => Date.parse(TIME),
  });
  const invalidCases = [
    ["other operation", (request) => { request.operation = "load"; }],
    ["other record type", (request) => {
      request.record_identity.record_type = "candidate-inventory-observation";
    }],
    ["effect scope only", (request) => { request.effect_scope = {}; }],
    ["evaluated receipt only", (request) => {
      request.evaluated_scope_receipt = {};
    }],
    ["missing identity", (request) => { request.record_identity = null; }],
    ["checkpoint effect kind", (request) => {
      request.record_identity.kind = "request-comment";
    }],
    ["checkpoint effect id", (request) => {
      request.record_identity.effect_id = "checkpoint-effect";
    }],
    ["checkpoint idempotency key", (request) => {
      request.record_identity.idempotency_key = "checkpoint-idempotency";
    }],
    ["invalid payload digest", (request) => {
      request.record_identity.payload_digest = `sha256:${"g".repeat(64)}`;
    }],
    ["extra identity field", (request) => {
      request.record_identity.ledger_ref = request.ledger_ref;
    }],
  ];
  for (const [index, [label, mutate]] of invalidCases.entries()) {
    const request = checkpointOidcRequestFixture(index.toString(16));
    mutate(request);
    const sealed = resealOidcRequestFixture(request);
    await assert.rejects(
      verifier.verifyWorkflowProvenance(
        oidcVerifierRequest("mint-and-verify", sealed),
        oidcVerifierExecutionContext(),
      ),
      undefined,
      label,
    );
    assert.deepEqual(
      oidc.calls.map((call) => call.kind),
      ["discovery", "jwks"],
      `${label} must fail before OIDC mint`,
    );
  }
  assert.deepEqual(oidc.calls.map((call) => call.kind), ["discovery", "jwks"]);

  const request = checkpointOidcRequestFixture("f");
  const verified = await verifier.verifyWorkflowProvenance(
    oidcVerifierRequest("mint-and-verify", request),
    oidcVerifierExecutionContext(),
  );
  validateV2GitLedgerProvenanceReceipt(verified.receipt, {
    request,
    policy: oidc.policy,
  });
  assert.equal(
    verified.receipt.operation_binding.record_identity.record_type,
    "epoch-checkpoint",
  );
  assert.deepEqual(oidc.calls.map((call) => call.kind), [
    "discovery", "jwks", "mint",
  ]);
});

test("OIDC verifier keeps precompiled JWKS keys closed to one trust snapshot", async () => {
  const snapshots = [oidcFixture(), oidcFixture()];
  for (const [index, oidc] of snapshots.entries()) {
    const verifier = createV2GitHubOidcProvenanceVerifier({
      fetch: oidc.fetch,
      environment: oidc.environment,
      policy: oidc.policy,
      clock: () => Date.parse(TIME),
    });
    for (const suffix of (index === 0 ? ["a", "b"] : ["c", "d"])) {
      const request = oidcRequestFixture(suffix);
      const verified = await verifier.verifyWorkflowProvenance(
        oidcVerifierRequest("mint-and-verify", request),
        oidcVerifierExecutionContext(),
      );
      validateV2GitLedgerProvenanceReceipt(verified.receipt, {
        request,
        policy: oidc.policy,
      });
    }
    assert.deepEqual(oidc.calls.map((call) => call.kind), [
      "discovery", "jwks", "mint", "mint",
    ]);
  }

  const invalidCases = [
    ["duplicate kid", { duplicateJwksKey: true }, /unique RSA signing key/u],
    ["unsupported key algorithm", {
      jwksKeyOverrides: { alg: "RS512" },
    }, /unique RSA signing key/u],
    ["unconstructable RSA key", {
      jwksKeyOverrides: { e: "AA" },
    }, /trusted RSA key/u],
  ];
  for (const [label, options, message] of invalidCases) {
    const oidc = oidcFixture(options);
    const verifier = createV2GitHubOidcProvenanceVerifier({
      fetch: oidc.fetch,
      environment: oidc.environment,
      policy: oidc.policy,
      clock: () => Date.parse(TIME),
    });
    await assert.rejects(verifier.initialize(), message, label);
    assert.deepEqual(
      oidc.calls.map((call) => call.kind),
      ["discovery", "jwks"],
      `${label} must fail before token mint`,
    );
  }
});

test("OIDC verifier rejects replay and hostile mint URLs without exposing tokens", async () => {
  const oidc = oidcFixture({ fixedJti: "fixed-jti" });
  const verifier = createV2GitHubOidcProvenanceVerifier({
    fetch: oidc.fetch,
    environment: oidc.environment,
    policy: oidc.policy,
    clock: () => Date.parse(TIME),
  });
  const request = oidcRequestFixture("3");
  await verifier.verifyWorkflowProvenance(
    oidcVerifierRequest("mint-and-verify", request),
    oidcVerifierExecutionContext(),
  );
  await assert.rejects(
    verifier.verifyWorkflowProvenance(
      oidcVerifierRequest("mint-and-verify", request),
      oidcVerifierExecutionContext(),
    ),
    (error) => {
      assert.equal(error?.code, "OIDC_REPLAY_DETECTED");
      assert.equal(String(error).includes(oidc.tokens.at(-1)), false);
      return true;
    },
  );
  assert.throws(
    () => createV2GitHubOidcProvenanceVerifier({
      fetch: oidc.fetch,
      environment: {
        ...oidc.environment,
        ACTIONS_ID_TOKEN_REQUEST_URL:
          "https://attacker.invalid/idtoken?api-version=2.0",
      },
      clock: () => Date.parse(TIME),
    }),
    (error) => error?.code === "OIDC_MINT_URL_INVALID",
  );
  for (const suffix of [
    "?api-version=%32.0",
    "?api-version=2.0&audience=caller-controlled",
  ]) {
    assert.throws(
      () => createV2GitHubOidcProvenanceVerifier({
        fetch: oidc.fetch,
        environment: {
          ...oidc.environment,
          ACTIONS_ID_TOKEN_REQUEST_URL:
            oidc.environment.ACTIONS_ID_TOKEN_REQUEST_URL.replace(
              "?api-version=2.0",
              suffix,
            ),
        },
        clock: () => Date.parse(TIME),
      }),
      (error) => error?.code === "OIDC_MINT_URL_INVALID",
    );
  }

  const withoutJti = oidcFixture({ omitJti: true });
  const fallbackVerifier = createV2GitHubOidcProvenanceVerifier({
    fetch: withoutJti.fetch,
    environment: withoutJti.environment,
    policy: withoutJti.policy,
    clock: () => Date.parse(TIME),
  });
  const fallbackRequest = oidcRequestFixture("4");
  const fallbackResult = await fallbackVerifier.verifyWorkflowProvenance(
    oidcVerifierRequest("mint-and-verify", fallbackRequest),
    oidcVerifierExecutionContext(),
  );
  assert.equal(Object.hasOwn(fallbackResult.receipt.claims, "jti"), false);
  await assert.rejects(
    fallbackVerifier.verifyWorkflowProvenance(
      oidcVerifierRequest("mint-and-verify", fallbackRequest),
      oidcVerifierExecutionContext(),
    ),
    (error) => error?.code === "OIDC_REPLAY_DETECTED",
  );
});

test("OIDC verifier rejects non-RS256 headers, untrusted keys, bad signatures and time claims", async () => {
  const cases = [
    ["algorithm", { headerOverrides: { alg: "HS256" } }, "OIDC_JWT_HEADER_UNSUPPORTED"],
    ["type", { headerOverrides: { typ: "at+jwt" } }, "OIDC_JWT_HEADER_UNSUPPORTED"],
    ["key", { headerOverrides: { kid: "untrusted-kid" } }, "OIDC_KID_UNAVAILABLE"],
    ["signature", { invalidSignature: true }, "OIDC_SIGNATURE_INVALID"],
    ["issuer", { claimOverrides: { iss: "https://attacker.invalid" } }, "OIDC_CLAIMS_INVALID"],
    ["audience", { claimOverrides: { aud: "wrong-audience" } }, "OIDC_CLAIMS_INVALID"],
    ["expiry", {
      claimOverrides: { exp: Math.floor(Date.parse(TIME) / 1000) - 1 },
    }, "OIDC_CLAIMS_INVALID"],
    ["required claim", { omitClaim: "repository_owner_id" },
      "OIDC_REQUIRED_CLAIM_MISSING"],
  ];
  for (const [label, options, code] of cases) {
    const oidc = oidcFixture(options);
    const verifier = createV2GitHubOidcProvenanceVerifier({
      fetch: oidc.fetch,
      environment: oidc.environment,
      policy: oidc.policy,
      clock: () => Date.parse(TIME),
    });
    await assert.rejects(
      verifier.verifyWorkflowProvenance(
        oidcVerifierRequest("mint-and-verify", oidcRequestFixture("5")),
        oidcVerifierExecutionContext(),
      ),
      (error) => {
        assert.equal(error?.code, code, label);
        assert.equal(String(error).includes(oidc.tokens[0] ?? "never-match"), false);
        return true;
      },
    );
  }
});

test("OIDC verifier enforces request, byte, and GitHub Date clock bounds before mint", async () => {
  const requestBound = oidcFixture();
  const boundedVerifier = createV2GitHubOidcProvenanceVerifier({
    fetch: requestBound.fetch,
    environment: requestBound.environment,
    policy: requestBound.policy,
    clock: () => Date.parse(TIME),
    http_limits: { max_requests: 2 },
  });
  await assert.rejects(
    boundedVerifier.verifyWorkflowProvenance(
      oidcVerifierRequest("mint-and-verify", oidcRequestFixture("6")),
      oidcVerifierExecutionContext(),
    ),
    (error) => error?.code === "OIDC_REQUEST_LIMIT",
  );
  assert.deepEqual(requestBound.calls.map((call) => call.kind), ["discovery", "jwks"]);

  const byteBound = oidcFixture();
  const byteVerifier = createV2GitHubOidcProvenanceVerifier({
    fetch: byteBound.fetch,
    environment: byteBound.environment,
    policy: byteBound.policy,
    clock: () => Date.parse(TIME),
    http_limits: { max_response_bytes: 16 },
  });
  await assert.rejects(
    byteVerifier.initialize(),
    (error) => error?.code === "OIDC_RESPONSE_TOO_LARGE",
  );
  assert.deepEqual(byteBound.calls.map((call) => call.kind), ["discovery"]);

  const clockBound = oidcFixture();
  const clockVerifier = createV2GitHubOidcProvenanceVerifier({
    fetch: clockBound.fetch,
    environment: clockBound.environment,
    policy: clockBound.policy,
    clock: () => Date.parse(TIME) + 10 * 60 * 1000,
  });
  await assert.rejects(
    clockVerifier.initialize(),
    (error) => error?.code === "OIDC_CLOCK_SKEW",
  );
  assert.deepEqual(clockBound.calls.map((call) => call.kind), ["discovery"]);

  const cancelled = oidcFixture();
  const cancelledVerifier = createV2GitHubOidcProvenanceVerifier({
    fetch: cancelled.fetch,
    environment: cancelled.environment,
    policy: cancelled.policy,
    clock: () => Date.parse(TIME),
  });
  const cancelledController = new AbortController();
  cancelledController.abort(new Error("caller cancelled"));
  await assert.rejects(
    cancelledVerifier.verifyWorkflowProvenance(
      oidcVerifierRequest("mint-and-verify", oidcRequestFixture("7")),
      oidcVerifierExecutionContext({ signal: cancelledController.signal }),
    ),
    (error) => error?.code === "OIDC_VERIFIER_ABORTED",
  );
  assert.deepEqual(cancelled.calls, []);
  await assert.rejects(
    cancelledVerifier.verifyWorkflowProvenance(
      oidcVerifierRequest("mint-and-verify", oidcRequestFixture("8")),
      { signal: new AbortController().signal },
    ),
    (error) => String(error).includes("closed key set"),
  );

  const stalledVerifier = createV2GitHubOidcProvenanceVerifier({
    environment: cancelled.environment,
    clock: () => Date.parse(TIME),
    async fetch() {
      return {
        status: 200,
        headers: {
          get(name) {
            return name.toLowerCase() === "date"
              ? "Thu, 13 Aug 2026 12:00:00 GMT"
              : null;
          },
        },
        body: {
          getReader() {
            return {
              read() { return new Promise(() => {}); },
              releaseLock() {},
            };
          },
        },
      };
    },
  });
  await assert.rejects(
    stalledVerifier.verifyWorkflowProvenance(
      oidcVerifierRequest("mint-and-verify", oidcRequestFixture("9")),
      oidcVerifierExecutionContext({ deadline_ms: 20 }),
    ),
    (error) => error?.code === "OIDC_VERIFIER_TIMEOUT",
  );
});

test("minimal live scope preserves a nullable potential merge receipt", async () => {
  const fixture = minimalScopeFixture([{
    potential: null,
    mergeable: "CONFLICTING",
    updatedAt: TIME,
  }]);
  const receipt = await loadV2MinimalLiveScope({
    fetch: fixture.fetch,
    token: "synthetic-token-for-v2-controller-tests-only",
    repository: { owner: "owner", name: "repo" },
    pull_number: 7,
    rest_base_url: "https://api.github.test",
    graphql_url: "https://api.github.test/graphql",
  });
  assert.equal(receipt.pull_request.state, "OPEN");
  assert.equal(receipt.scope.potential_merge_oid, null);
  assert.equal(receipt.scope.potential_merge_tree, null);
  assert.deepEqual(receipt.scope.ordered_parent_oids, []);
  assert.equal(receipt.scope.merge_ref_oid, null);
  assert.equal(receipt.endpoint_receipts.at(-1).status, 404);
  assert.equal(assertV2MinimalLiveScopeHandle(receipt, {
    repository: { owner: "owner", name: "repo" },
    pull_number: 7,
  }), receipt);
  assert.throws(
    () => assertV2MinimalLiveScopeHandle(structuredClone(receipt), {
      repository: { owner: "owner", name: "repo" },
      pull_number: 7,
    }),
    (error) => error?.code === "UNTRUSTED_MINIMAL_LIVE_SCOPE_HANDLE",
  );
  assert.throws(
    () => assertV2MinimalLiveScopeHandle(receipt, {
      repository: { owner: "owner", name: "different" },
      pull_number: 7,
    }),
    (error) => error?.code === "MINIMAL_LIVE_SCOPE_HANDLE_BINDING_MISMATCH",
  );
  assert.throws(
    () => assertV2MinimalLiveScopeHandle(receipt, {
      repository: { owner: "owner", name: "repo" },
      pull_number: 8,
    }),
    (error) => error?.code === "MINIMAL_LIVE_SCOPE_HANDLE_BINDING_MISMATCH",
  );
  assert.throws(
    () => projectV2MinimalScopeForGitLedger(structuredClone(receipt)),
    (error) => error?.code === "UNTRUSTED_MINIMAL_LIVE_SCOPE_HANDLE",
  );
  const rehashedPlainReceipt = structuredClone(receipt);
  rehashedPlainReceipt.scope.head_ref_oid = "9".repeat(40);
  const { receipt_digest: _receiptDigest, ...rehashedBody } = rehashedPlainReceipt;
  rehashedPlainReceipt.receipt_digest = digestDomain(
    "codex-review-gate-v2-minimal-live-scope",
    rehashedBody,
  );
  assert.throws(
    () => projectV2MinimalScopeForGitLedger(rehashedPlainReceipt),
    (error) => error?.code === "UNTRUSTED_MINIMAL_LIVE_SCOPE_HANDLE",
  );
  const ledgerBinding = projectV2MinimalScopeForGitLedger(receipt);
  assert.deepEqual(ledgerBinding.scope, {
    pull_request: { number: 7, node_id: "PR_7" },
    head_ref_oid: HEAD,
    base_ref_oid: BASE,
    potential_merge_commit_oid: null,
  });
  assert.equal(
    ledgerBinding.scope_endpoint_receipt.path,
    "/repos/owner/repo/pulls/7",
  );
  assert.equal(
    ledgerBinding.scope_endpoint_receipt.raw_body_sha256,
    receipt.endpoint_receipts[0].raw_body_sha256,
  );
});

test("leased discovery rejects a cloned minimal scope before ledger effects", async () => {
  const loaded = await loadMinimalFixture(minimalScopeFixture([{}]));
  const forged = structuredClone(loaded);
  forged.scope.head_ref_oid = "9".repeat(40);
  const { receipt_digest: _receiptDigest, ...forgedBody } = forged;
  forged.receipt_digest = digestDomain(
    "codex-review-gate-v2-minimal-live-scope",
    forgedBody,
  );
  const calls = [];
  const ledger = {
    async load() {
      calls.push("load");
      throw new Error("must not load");
    },
    async acquireLease() {
      calls.push("acquire");
      throw new Error("must not acquire");
    },
    async releaseLease() {
      calls.push("release");
      throw new Error("must not release");
    },
  };
  await assert.rejects(
    acquireV2LeaseThenLoadDiscovery({
      command: leasedDiscoveryCommand(),
      environment: {},
      token: "synthetic-token-for-v2-controller-tests-only",
      ledger,
      evaluated_scope_receipt: { schema: "test-evaluated-scope" },
      pre_scope: forged,
    }),
    (error) => error?.code === "UNTRUSTED_MINIMAL_LIVE_SCOPE_HANDLE",
  );
  assert.deepEqual(calls, []);
});

test("minimal/full continuity rejects discovery drift, retarget, and close/reopen ABA", async () => {
  const stableFixture = minimalScopeFixture([{}]);
  const pre = await loadMinimalFixture(stableFixture);
  const stableSnapshot = snapshotFromMinimalScope(pre);
  const stablePost = await loadMinimalFixture(stableFixture);
  assert.equal(assertV2MinimalScopeMatchesFullDiscovery({
    pre_scope: pre,
    discovery_snapshot: stableSnapshot,
    post_scope: stablePost,
  }).matched, true);

  const fullDrift = structuredClone(stableSnapshot);
  fullDrift.scope.head_ref_oid = "d".repeat(40);
  fullDrift.scope_receipts.pre.head_ref_oid = "d".repeat(40);
  fullDrift.scope_receipts.post.head_ref_oid = "d".repeat(40);
  await assert.rejects(
    Promise.resolve().then(() => assertV2MinimalScopeMatchesFullDiscovery({
      pre_scope: pre,
      discovery_snapshot: fullDrift,
      post_scope: stablePost,
    })),
    (error) => error?.code === "FULL_DISCOVERY_SCOPE_DRIFT",
  );

  const retargetFixture = minimalScopeFixture([
    {},
    { base: "e".repeat(40), potential: potentialMerge("e".repeat(40), HEAD) },
  ]);
  const beforeRetarget = await loadMinimalFixture(retargetFixture);
  const afterRetarget = await loadMinimalFixture(retargetFixture);
  assert.throws(
    () => assertV2MinimalScopeMatchesFullDiscovery({
      pre_scope: beforeRetarget,
      discovery_snapshot: snapshotFromMinimalScope(beforeRetarget),
      post_scope: afterRetarget,
    }),
    (error) => error?.code === "LIVE_SCOPE_DRIFT",
  );

  const reopenedFixture = minimalScopeFixture([
    { updatedAt: TIME },
    { updatedAt: "2026-08-13T12:00:05.000Z" },
  ]);
  const beforeReopen = await loadMinimalFixture(reopenedFixture);
  const afterReopen = await loadMinimalFixture(reopenedFixture);
  assert.equal(beforeReopen.pull_request.state, "OPEN");
  assert.equal(afterReopen.pull_request.state, "OPEN");
  assert.throws(
    () => assertV2MinimalScopeMatchesFullDiscovery({
      pre_scope: beforeReopen,
      discovery_snapshot: snapshotFromMinimalScope(beforeReopen),
      post_scope: afterReopen,
    }),
    (error) => error?.code === "LIVE_SCOPE_DRIFT",
  );
});

test("leased discovery orders pre-scope, attestation, lease, full read and no-refund abort", async () => {
  const fixture = minimalScopeFixture([{}, { head: "d".repeat(40) }]);
  const events = fixture.events;
  const command = leasedDiscoveryCommand();
  let acquired = false;
  let released = false;
  const ledger = {
    async load() {
      events.push("ledger-load");
      return {
        tip_commit_sha: "f".repeat(40),
        observed_at: TIME,
        post_ref: { server_time: TIME },
        control_comment_binding: null,
        active_lease: acquired && !released ? { lease_id: "active" } : null,
      };
    },
    async acquireLease(input, authority) {
      events.push("lease-acquire");
      assert.equal(input.head_ref_oid, HEAD);
      assert.equal(authority.evaluated_scope_receipt, evaluatedScopeReceipt);
      acquired = true;
      return {
        receipt_digest: `sha256:${"1".repeat(64)}`,
        lease_id: input.lease_id,
      };
    },
    async releaseLease(_input, authority) {
      events.push("lease-release");
      assert.equal(authority.evaluated_scope_receipt, evaluatedScopeReceipt);
      released = true;
      return { receipt_digest: `sha256:${"2".repeat(64)}` };
    },
  };
  const transport = {
    async loadSnapshot() {
      events.push("full-discovery");
      return fixture.snapshot(0);
    },
  };
  const evaluatedScopeReceipt = {
    schema: "codex-review-gate-v2-test-evaluated-scope",
  };
  await assert.rejects(
    acquireV2LeaseThenLoadDiscovery({
      command,
      environment: { GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only" },
      fetch: fixture.fetch,
      token: "synthetic-token-for-v2-controller-tests-only",
      rest_base_url: "https://api.github.test",
      graphql_url: "https://api.github.test/graphql",
      ledger,
      transport,
      evaluated_scope_receipt: evaluatedScopeReceipt,
    }),
    (error) => {
      assert.equal(error?.code, "LEASED_DISCOVERY_ABORTED");
      assert.equal(error.details.budget_refunded, false);
      assert.equal(error.details.public_effects_performed, 0);
      assert.equal(error.details.release_receipt_digest, `sha256:${"2".repeat(64)}`);
      return true;
    },
  );
  const firstScopeEnd = events.indexOf("scope-complete:0");
  assert.ok(firstScopeEnd >= 0, events.join("\n"));
  assert.ok(firstScopeEnd < events.indexOf("ledger-load"), events.join("\n"));
  assert.ok(events.indexOf("ledger-load") < events.indexOf("lease-acquire"));
  assert.ok(events.indexOf("lease-acquire") < events.indexOf("full-discovery"));
  const ledgerLoads = events
    .map((event, index) => event === "ledger-load" ? index : null)
    .filter((index) => index !== null);
  assert.equal(ledgerLoads.length, 3);
  assert.ok(events.indexOf("full-discovery") < ledgerLoads[1]);
  assert.ok(ledgerLoads[1] < events.indexOf("lease-release"));
  assert.ok(events.indexOf("lease-release") < ledgerLoads[2]);
  assert.equal(events.some((event) => event.startsWith("effect:")), false);
});

test("provider full discovery follows branded post-scope continuity and common authority", async () => {
  const fixture = minimalScopeFixture([{}, {}]);
  const preScope = await loadMinimalFixture(fixture);
  const events = fixture.events;
  events.length = 0;
  const preReceipt = {
    relation: "provider-selector",
    repository: {
      owner: "owner",
      name: "repo",
      id: "42",
      node_id: "R_repo",
      owner_id: "88",
    },
    receipt_digest: `sha256:${"3".repeat(64)}`,
  };
  const commonFullReceipt = {
    relation: "provider-selector",
    receipt_digest: `sha256:${"4".repeat(64)}`,
  };
  const providerFullReceipt = {
    relation: "provider-selector",
    receipt_digest: `sha256:${"5".repeat(64)}`,
  };
  const leaseReceiptBody = {
    schema: V2_GIT_LEDGER_LEASE_RECEIPT_SCHEMA,
    schema_version: 1,
    repository: preReceipt.repository,
    ledger_ref: "refs/heads/codex-review-gate-ledger-v2",
    lease_id: "active",
    owner: { run_id: "9001", run_attempt: 1, actor_id: "88" },
    acquire_commit_sha: "f".repeat(40),
    acquired_at: TIME,
    expires_at: "2026-08-13T12:10:00.000Z",
    scope: {
      pull_request: { number: 7, node_id: "PR_7" },
      head_ref_oid: HEAD,
      base_ref_oid: BASE,
      potential_merge_commit_oid: MERGE,
    },
    append_receipt_digest: `sha256:${"1".repeat(64)}`,
  };
  const leaseReceipt = {
    ...leaseReceiptBody,
    receipt_digest: gitLedgerDigestDomain(
      "codex-review-gate-v2-git-ledger-lease-receipt",
      leaseReceiptBody,
    ),
  };
  let snapshot = null;
  let released = false;
  const liveTransport = createV2GitHubTransport({
    fetch: completeSnapshotFetch(),
    token: "synthetic-token-for-v2-controller-tests-only",
    restBaseUrl: "https://api.github.test",
    graphqlUrl: "https://api.github.test/graphql",
  });
  const ledger = {
    async load() {
      events.push("ledger-load");
      return {
        tip_commit_sha: "f".repeat(40),
        observed_at: TIME,
        post_ref: { server_time: TIME },
        control_comment_binding: null,
        active_lease: released ? null : { lease_id: "active" },
      };
    },
    async acquireLease(_input, authority) {
      events.push("lease-acquire");
      assert.equal(authority.evaluated_scope_receipt, preReceipt);
      return leaseReceipt;
    },
    async releaseLease() {
      events.push("lease-release");
      released = true;
      return { receipt_digest: `sha256:${"2".repeat(64)}` };
    },
    async createFullDiscoveryEvaluatedScopeReceipt(input) {
      events.push("common-full-authority");
      resultContinuity = input.continuity_handle;
      assert.deepEqual(input, {
        pre_scope_receipt: preReceipt,
        lease_receipt: leaseReceipt,
        continuity_handle: resultContinuity,
      });
      return commonFullReceipt;
    },
    async createProviderEventFullDiscoveryEvaluatedScopeReceipt(input) {
      events.push("provider-full-authority");
      assert.deepEqual(input, {
        full_scope_receipt: commonFullReceipt,
        continuity_handle: resultContinuity,
      });
      return providerFullReceipt;
    },
  };
  let resultContinuity = null;
  const result = await acquireV2LeaseThenLoadDiscovery({
    command: leasedDiscoveryCommand(),
    environment: {},
    fetch: fixture.fetch,
    token: "synthetic-token-for-v2-controller-tests-only",
    rest_base_url: "https://api.github.test",
    graphql_url: "https://api.github.test/graphql",
    ledger,
    transport: {
      async loadSnapshot(input) {
        events.push("full-discovery");
        snapshot = await liveTransport.loadSnapshot(input);
        return snapshot;
      },
    },
    evaluated_scope_receipt: preReceipt,
    pre_scope: preScope,
  });
  resultContinuity = result.continuity_authority;
  assert.equal(result.lease_evaluated_scope_receipt, preReceipt);
  assert.equal(result.full_evaluated_scope_receipt, commonFullReceipt);
  assert.equal(result.effect_evaluated_scope_receipt, providerFullReceipt);
  const projectedScope = projectV2MinimalScopeForGitLedger(preScope).scope;
  assert.equal(assertV2LeasedDiscoveryContinuityHandle(
    result.continuity_authority,
    {
      repository: preReceipt.repository,
      scope: projectedScope,
      pre_scope_receipt: preReceipt,
      lease_receipt: leaseReceipt,
    },
  ), result.continuity_authority);
  const privateProjection =
    projectV2LeasedDiscoveryContinuityForGitLedger(
      result.continuity_authority,
    );
  assert.equal(privateProjection.discovery_snapshot, snapshot);
  assert.equal(privateProjection.minimal_pre, preScope);
  assert.notEqual(privateProjection.minimal_post, preScope);
  assert.equal(privateProjection.effective_limits.max_requests, 2_048);
  assert.equal(
    privateProjection.continuity_receipt.continuity_receipt_digest,
    result.continuity_authority.continuity_receipt
      .continuity_receipt_digest,
  );
  assert.ok(events.indexOf("lease-acquire") < events.indexOf("full-discovery"));
  assert.ok(
    events.indexOf("full-discovery") <
      events.findIndex((event) => event.startsWith("scope-request:")),
  );
  assert.ok(
    events.findIndex((event) => event.startsWith("scope-complete:")) <
      events.indexOf("common-full-authority"),
  );
  assert.ok(
    events.indexOf("common-full-authority") <
      events.indexOf("provider-full-authority"),
  );
  assert.equal(events.includes("lease-release"), false);
});

test("ledger trigger identity binds the exact trusted job ref and SHA", async () => {
  await withWorkflowCliFixture({
    eventName: "pull_request_target",
    event: { pull_request: { number: 7 } },
    route: "ordinary",
    pullRequest: "7",
  }, async ({ environment }) => {
    const command = await prepareV2WorkflowCommand(environment);
    const trigger = loadV2GitLedgerTriggerIdentity({ command, environment });
    assert.deepEqual(trigger, {
      event_name: "pull_request_target",
      ref: "refs/heads/main",
      sha: BASE,
    });
    assert.equal(Object.isFrozen(trigger), true);

    assert.throws(
      () => loadV2GitLedgerTriggerIdentity({
        command,
        environment: { ...environment, GITHUB_EVENT_NAME: "schedule" },
      }),
      (error) => error?.code === "TRIGGER_EVENT_IDENTITY_MISMATCH",
    );
    assert.throws(
      () => loadV2GitLedgerTriggerIdentity({
        command,
        environment: { ...environment, GITHUB_REF: "main" },
      }),
      (error) => error?.code === "TRIGGER_REF_INVALID",
    );
    assert.throws(
      () => loadV2GitLedgerTriggerIdentity({
        command,
        environment: { ...environment, GITHUB_SHA: "not-a-sha" },
      }),
      /GITHUB_SHA must be a lowercase full SHA/u,
    );
  });
});

test("pre-lease route authority uses only ledger closure builders", async () => {
  const cases = [
    {
      name: "pull request",
      eventName: "pull_request_target",
      route: "ordinary",
      expectedRelation: "pull-request-event",
      method: "createPullRequestEventEvaluatedScopeReceipt",
    },
    {
      name: "schedule",
      eventName: "schedule",
      route: "ordinary",
      expectedRelation: "scheduled-pull-request",
      method: "loadScheduledPullRequestEvaluatedScopeReceipt",
    },
    {
      name: "manual",
      eventName: "workflow_dispatch",
      route: "evaluate-only",
      expectedRelation: "manual-pull-request",
      method: "createManualPullRequestEvaluatedScopeReceipt",
    },
  ];
  for (const selected of cases) {
    await withWorkflowCliFixture({
      eventName: selected.eventName,
      event: selected.eventName === "pull_request_target"
        ? { pull_request: { number: 7 } }
        : {},
      route: selected.route,
      pullRequest: "7",
      dispatchBinding: selected.name === "schedule"
        ? scheduleDispatchBindingFixture()
        : undefined,
    }, async ({ environment }) => {
      const command = await prepareV2WorkflowCommand(environment);
      const preScope = await loadMinimalFixture(minimalScopeFixture([{}]));
      const calls = [];
      const ledger = {
        async [selected.method](input) {
          calls.push(input);
          return { receipt: selected.expectedRelation };
        },
      };
      const authority = await createV2PreLeaseEvaluatedScopeAuthority({
        command,
        environment,
        ledger,
        pre_scope: preScope,
        ...(selected.name === "schedule"
          ? { candidate_dispatch_handle: { fixture: "same-factory" } }
          : {}),
      });
      assert.equal(authority.relation, selected.expectedRelation, selected.name);
      assert.equal(calls.length, 1, selected.name);
      assert.equal(calls[0].minimal_scope_handle, preScope, selected.name);
      assert.deepEqual(
        Object.keys(calls[0]).sort(),
        selected.name === "manual"
          ? ["minimal_scope_handle", "trigger_identity", "workflow_command_handle"]
          : selected.name === "schedule"
            ? [
                "candidate_dispatch_handle",
                "minimal_scope_handle",
                "trigger_identity",
              ]
            : ["minimal_scope_handle", "trigger_identity"],
        selected.name,
      );
      assert.deepEqual(calls[0].trigger_identity, {
        event_name: selected.eventName,
        ref: "refs/heads/main",
        sha: BASE,
      });
      if (selected.name === "manual") {
        assert.equal(calls[0].workflow_command_handle, command);
      } else if (selected.name === "schedule") {
        assert.deepEqual(calls[0].candidate_dispatch_handle, {
          fixture: "same-factory",
        });
      }
    });
  }
});

test("pre-lease route rejects a candidate dispatch handle outside schedule", async () => {
  await withWorkflowCliFixture({
    eventName: "pull_request_target",
    event: { pull_request: { number: 7 } },
    route: "ordinary",
    pullRequest: "7",
  }, async ({ environment }) => {
    const command = await prepareV2WorkflowCommand(environment);
    const preScope = await loadMinimalFixture(minimalScopeFixture([{}]));
    let ledgerCalls = 0;
    await assert.rejects(
      createV2PreLeaseEvaluatedScopeAuthority({
        command,
        environment,
        ledger: {
          async createPullRequestEventEvaluatedScopeReceipt() {
            ledgerCalls += 1;
            throw new Error("spurious dispatch authority reached the ledger");
          },
        },
        pre_scope: preScope,
        candidate_dispatch_handle: { fixture: "spurious" },
      }),
      (error) => error?.code === "CANDIDATE_DISPATCH_HANDLE_SPURIOUS",
    );
    assert.equal(ledgerCalls, 0);
  });
});

test("pre-lease route rejects a rehashed plain scope before ledger authority", async () => {
  await withWorkflowCliFixture({
    eventName: "pull_request_target",
    event: { pull_request: { number: 7 } },
    route: "ordinary",
    pullRequest: "7",
  }, async ({ environment }) => {
    const command = await prepareV2WorkflowCommand(environment);
    const loaded = await loadMinimalFixture(minimalScopeFixture([{}]));
    const forged = structuredClone(loaded);
    forged.scope.head_ref_oid = "9".repeat(40);
    const { receipt_digest: _receiptDigest, ...forgedBody } = forged;
    forged.receipt_digest = digestDomain(
      "codex-review-gate-v2-minimal-live-scope",
      forgedBody,
    );
    const calls = [];
    await assert.rejects(
      createV2PreLeaseEvaluatedScopeAuthority({
        command,
        environment,
        ledger: {
          async createPullRequestEventEvaluatedScopeReceipt(input) {
            calls.push(input);
            return { receipt: "forged" };
          },
        },
        pre_scope: forged,
      }),
      (error) => error?.code === "UNTRUSTED_MINIMAL_LIVE_SCOPE_HANDLE",
    );
    assert.deepEqual(calls, []);
  });
});

test("diagnostic open PR scan paginates but marks completeness unproven", async () => {
  const calls = [];
  const diagnostic = await listAllOpenPullRequests({
    token: "synthetic-token-for-v2-controller-tests-only",
    repository: { owner: "owner", name: "repo" },
    restBaseUrl: "https://api.github.test",
    async fetch(url, init) {
      const parsed = new URL(url);
      calls.push(`${init.method} ${parsed.pathname}${parsed.search}`);
      const page = Number(parsed.searchParams.get("page"));
      const start = page === 1 ? 1 : 101;
      const count = page === 1 ? 100 : 2;
      return response(200, JSON.stringify(Array.from({ length: count }, (_, index) => ({
        number: start + index,
        state: "open",
        merged_at: null,
      }))), "Wed, 13 Aug 2026 12:00:00 GMT");
    },
  });
  assert.equal(diagnostic.completeness, "unproven");
  assert.equal(diagnostic.pull_requests.length, 102);
  assert.deepEqual(diagnostic.pull_requests.slice(-2), [101, 102]);
  assert.equal(calls.length, 4);
  assert.match(calls[1], /per_page=100&page=2/u);
  assert.equal(calls[0], calls[2]);
  assert.equal(calls[1], calls[3]);
});

test("diagnostic open PR scan exposes the page-boundary close/reopen ABA gap", async () => {
  const liveOpen = new Set(Array.from({ length: 150 }, (_, index) => index + 1));
  const diagnostic = await listAllOpenPullRequests({
    token: "synthetic-token-for-v2-controller-tests-only",
    repository: { owner: "owner", name: "repo" },
    restBaseUrl: "https://api.github.test",
    async fetch(url) {
      const page = Number(new URL(url).searchParams.get("page"));
      const sorted = [...liveOpen].sort((left, right) => left - right);
      const data = sorted.slice((page - 1) * 100, page * 100).map((number) => ({
        number,
        state: "open",
        merged_at: null,
      }));
      if (page === 1) liveOpen.delete(1);
      if (page === 2) liveOpen.add(1);
      return response(
        200,
        JSON.stringify(data),
        "Wed, 13 Aug 2026 12:00:00 GMT",
      );
    },
  });

  assert.equal(diagnostic.completeness, "unproven");
  assert.equal(liveOpen.size, 150);
  assert.equal(liveOpen.has(101), true);
  assert.equal(diagnostic.pull_requests.includes(101), false);
  assert.equal(diagnostic.pull_requests.length, 149);
});

test("open PR scan rejects offset-pagination drift and matrix overflow", async () => {
  let requestCount = 0;
  await assert.rejects(
    listAllOpenPullRequests({
      token: "synthetic-token-for-v2-controller-tests-only",
      repository: { owner: "owner", name: "repo" },
      restBaseUrl: "https://api.github.test",
      async fetch() {
        requestCount += 1;
        return response(200, JSON.stringify(requestCount === 1
          ? [{ number: 1, state: "open", merged_at: null }]
          : [{ number: 2, state: "open", merged_at: null }]),
        "Wed, 13 Aug 2026 12:00:00 GMT");
      },
    }),
    (error) => error?.code === "OPEN_PULL_REQUEST_INVENTORY_DRIFT",
  );

  await assert.rejects(
    listAllOpenPullRequests({
      token: "synthetic-token-for-v2-controller-tests-only",
      repository: { owner: "owner", name: "repo" },
      restBaseUrl: "https://api.github.test",
      async fetch(url) {
        const page = Number(new URL(url).searchParams.get("page"));
        const count = page <= 2 ? 100 : 57;
        const start = (page - 1) * 100 + 1;
        return response(200, JSON.stringify(Array.from(
          { length: count },
          (_, index) => ({
            number: start + index,
            state: "open",
            merged_at: null,
          }),
        )), "Wed, 13 Aug 2026 12:00:00 GMT");
      },
    }),
    (error) => error?.code === "OPEN_PULL_REQUEST_MATRIX_LIMIT",
  );
});

test("production assembler reaches the real live preflight and fails closed with a typed error", async () => {
  await withWorkflowCliFixture({
    eventName: "pull_request_target",
    event: { pull_request: { number: 7 } },
    route: "ordinary",
    pullRequest: "7",
  }, async ({ environment }) => {
    const command = await prepareV2WorkflowCommand(environment);
    const requests = [];
    await assert.rejects(
      assembleV2ProductionControllerCycle({
        command,
        environment: {
          ...environment,
          GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
        },
        async fetch(url, init) {
          requests.push(`${init.method} ${url}`);
          return response(
            503,
            JSON.stringify({ message: "fixture preflight stop" }),
            "Wed, 13 Aug 2026 12:00:00 GMT",
          );
        },
      }),
      (error) => {
        assert.equal(error instanceof V2WorkflowControllerError, true);
        assert.equal(error.code, "PREFLIGHT_FAILED");
        assert.match(error.details.upstream_code, /^HTTP_/u);
        return true;
      },
    );
    assert.deepEqual(requests, ["GET https://api.github.com/repos/owner/repo"]);
  });
});

test("provider pre-scope selector is re-read from exact digest-bound event bytes", async () => {
  const cases = [
    [
      "issue_comment",
      {
        issue: { number: 7, pull_request: { url: "https://api.github.test/pr/7" } },
        comment: { id: 101 },
      },
      { kind: "issue_comment", id: "101" },
    ],
    [
      "pull_request_review",
      { pull_request: { number: 7 }, review: { id: 102 } },
      { kind: "pull_request_review", id: "102" },
    ],
    [
      "pull_request_review_comment",
      { pull_request: { number: 7 }, comment: { id: 103 } },
      { kind: "inline_comment", id: "103" },
    ],
  ];
  for (const [eventName, event, expected] of cases) {
    await withWorkflowCliFixture({
      eventName,
      event,
      route: "provider-event-hint",
      pullRequest: "7",
    }, async ({ environment }) => {
      const command = await prepareV2WorkflowCommand(environment);
      const selected = await readV2ProviderEventSelector({ command, environment });
      assert.deepEqual(selected.selector, expected);
      assert.equal(selected.pull_request_number, 7);
      assert.equal(
        selected.event_payload_sha256,
        command.invocation.event_payload_sha256,
      );
    });
  }
});

test("provider continuation rereads the same native event carrier after a public wait", async () => {
  await withWorkflowCliFixture({
    eventName: "pull_request_review",
    event: {
      pull_request: { number: 7 },
      review: { id: 102 },
    },
    route: "ordinary",
    observationBoundary: "public-initial-wait-complete",
    pullRequest: "7",
  }, async ({ environment }) => {
    const command = await prepareV2WorkflowCommand(environment);
    assert.equal(command.route.trigger, "timer");
    assert.deepEqual(
      (await readV2ProviderEventSelector({ command, environment })).selector,
      { kind: "pull_request_review", id: "102" },
    );
  });
});

test("provider pre-scope selector rejects event replacement and wrong PR", async () => {
  const event = {
    issue: { number: 7, pull_request: { url: "https://api.github.test/pr/7" } },
    comment: { id: 101 },
  };
  await withWorkflowCliFixture({
    eventName: "issue_comment",
    event,
    route: "provider-event-hint",
    pullRequest: "7",
  }, async ({ eventPath, environment }) => {
    const command = await prepareV2WorkflowCommand(environment);
    await writeFile(eventPath, JSON.stringify({
      ...event,
      comment: { id: 999 },
    }), { mode: 0o600 });
    await assert.rejects(
      readV2ProviderEventSelector({ command, environment }),
      (error) => error?.code === "PROVIDER_EVENT_DIGEST_MISMATCH",
    );

    const wrongPrCommand = structuredClone(command);
    wrongPrCommand.invocation.event_payload_sha256 = sha256(JSON.stringify({
      issue: { number: 8, pull_request: { url: "https://api.github.test/pr/8" } },
      comment: { id: 101 },
    }));
    await writeFile(eventPath, JSON.stringify({
      issue: { number: 8, pull_request: { url: "https://api.github.test/pr/8" } },
      comment: { id: 101 },
    }), { mode: 0o600 });
    await assert.rejects(
      readV2ProviderEventSelector({
        command: wrongPrCommand,
        environment,
      }),
      (error) => error?.code === "PROVIDER_EVENT_PULL_REQUEST_MISMATCH",
    );
  });
});

test("production assembler forms a branded preflight and OIDC bootstrap handoff", async () => {
  await withWorkflowCliFixture({
    eventName: "pull_request_target",
    event: { pull_request: { number: 7 } },
    route: "ordinary",
    pullRequest: "7",
  }, async ({ environment }) => {
    const command = await prepareV2WorkflowCommand(environment);
    const oidc = oidcFixture();
    const preflight = productionPreflightFetchFixture(command);
    const fetch = async (url, init) => {
      const hostname = new URL(url).hostname;
      if (hostname === "token.actions.githubusercontent.com" ||
          hostname.endsWith(".actions.githubusercontent.com")
      ) {
        const original = await oidc.fetch(url, init);
        const raw = await original.text();
        return new Response(raw, {
          status: original.status,
          headers: {
            date: new Date().toUTCString(),
            "content-length": String(Buffer.byteLength(raw)),
            "content-type": "application/json",
          },
        });
      }
      return preflight.fetch(url, init);
    };
    const failure = await assembleV2ProductionControllerCycle({
        command,
        environment: {
          ...environment,
          ...oidc.environment,
          GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
          GITHUB_API_URL: "https://api.github.com",
        },
        fetch,
      }).then(
        () => null,
        (error) => error,
      );
    assert.equal(
      failure?.code,
      "LEDGER_BOOTSTRAP_FAILED",
      `${String(failure?.cause)} ${JSON.stringify(failure?.details)}`,
    );
    assert.match(failure.details.handoff_digest, /^sha256:[0-9a-f]{64}$/u);
    assert.match(
      failure.details.preflight_receipt_digest,
      /^sha256:[0-9a-f]{64}$/u,
    );
    assert.ok(preflight.paths.includes("/repos/owner/repo"));
    assert.ok(preflight.paths.includes(
      "/repos/owner/repo/actions/oidc/customization/sub",
    ));
    assert.ok(preflight.paths.includes(
      "/repos/owner/repo/git/ref/heads/codex-review-gate-ledger-v2",
    ));
    assert.deepEqual(oidc.calls.map(({ kind }) => kind), ["discovery", "jwks"]);
  });
});

test("production initial route binds the full branded automatic request chain", async () => {
  await withWorkflowCliFixture({
    eventName: "pull_request_target",
    event: { pull_request: { number: 7 } },
    route: "ordinary",
    pullRequest: "7",
  }, async ({ environment }) => {
    const command = await prepareV2WorkflowCommand(environment);
    const liveTime = new Date().toISOString();
    const oidc = productionOidcFixture(command, liveTime);
    const github = productionControllerGitHubFixture(command, oidc, liveTime);
    const result = await runV2WorkflowControllerCli({
      ...environment,
      ...oidc.environment,
      GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
      GITHUB_API_URL: "https://api.github.com",
    }, { fetch: github.fetch });
    const cycle = result.cycle;

    assert.equal(cycle.terminal_result.effect_barrier,
      "AUTOMATIC_REQUEST_EFFECT_BOUND");
    assert.equal(cycle.terminal_result.status_effect_outcome, "bound");
    assert.equal(cycle.terminal_result.reservation_status_effect_outcome, "bound");
    assert.equal(cycle.terminal_result.automatic_request_effect_outcome, "bound");
    assert.equal(cycle.terminal_result.status_plan, null);
    assert.equal(cycle.terminal_result.request_plan, null);
    assert.equal(cycle.terminal_result.comment_plan, null);
    assert.equal(cycle.terminal_result.public_effects_performed, 3);
    assert.equal(cycle.terminal_result.writes_performed, true);
    assert.match(
      cycle.terminal_result.initial_runner_state_authority_digest,
      /^sha256:[0-9a-f]{64}$/u,
    );
    assert.equal(
      cycle.terminal_result.established_runner_state_authority_digest,
      null,
    );
    assert.equal(Object.hasOwn(cycle.terminal_result, "scheduler_plan"), false);
    assert.equal(Object.hasOwn(cycle.terminal_result, "reducer_report"), false);
    assert.equal(cycle.initial_result, null);
    assert.equal(
      cycle.binding_receipt.schema,
      "codex-review-gate-git-ledger-automatic-review-request-binding-receipt-v2",
    );
    assert.equal(cycle.binding_receipt.actor.id, "789");
    assert.equal(cycle.binding_receipt.actor.login, "github-actions[bot]");
    assert.equal(cycle.binding_receipt.app.slug, "github-actions");
    assert.equal(cycle.sticky_receipt, null);
    assert.equal(cycle.status_receipts.length, 1);
    assert.equal(cycle.status_receipts[0].target_sha, HEAD);
    assert.equal(cycle.status_receipts[0].refetch_match_count, 1);
    assert.equal(
      cycle.terminal_result.scheduler_append_receipt.record_type,
      "effect-intent",
    );
    assert.equal(
      cycle.terminal_result.lease_release_receipt.record_type,
      "lease-release",
    );
    assert.deepEqual(
      Object.keys(cycle.ledger).sort(),
      [
        "automatic_request_attempt_append_receipt",
        "automatic_request_binding_intent_append_receipt",
        "automatic_request_binding_response_append_receipt",
        "automatic_request_intent_append_receipt",
        "automatic_request_review_response_append_receipt",
        "automatic_reservation_append_receipt",
        "lease_release_receipt",
        "reservation_status_intent_append_receipt",
        "reservation_status_response_append_receipt",
        "scheduler_append_receipt",
        "status_intent_append_receipt",
        "status_response_append_receipt",
      ],
    );
    assert.equal(github.activeLease(), false);
    assert.deepEqual(github.externalWrites, [
      `POST /repos/owner/repo/statuses/${HEAD}`,
      `POST /repos/owner/repo/statuses/${HEAD}`,
      "POST /repos/owner/repo/issues/7/comments",
    ]);
    assert.equal(github.statusPostCount(), 2);
    assert.equal(github.statusRefetchCount(), 2);
    assert.equal(github.requestPostCount(), 1);
    assert.equal(github.requestRefetchCount(), 1);
    assert.deepEqual(github.effectRecordKinds().slice(-13), [
      "lease-acquire:",
      "effect-intent:scheduler-observation",
      "effect-intent:status-write",
      "effect-response:status-write",
      "effect-intent:automatic-request-reservation",
      "effect-intent:reservation-status-write",
      "effect-response:reservation-status-write",
      "effect-intent:effect-attempt",
      "effect-intent:review-request",
      "effect-response:review-request",
      "effect-intent:request-binding",
      "effect-response:request-binding",
      "lease-release:",
    ]);
    assert.ok(oidc.tokens.length >= 1);
    assert.equal(result.output.outputs["status-plan-path"], "");
    assert.equal(result.output.outputs["reservation-path"], "");
    assert.equal(result.output.outputs["intent-path"], "");
    assert.notEqual(result.output.outputs["binding-receipt-path"], "");
    assert.equal(result.output.outputs["sticky-receipt-path"], "");
    assert.notEqual(result.output.outputs["report-path"], "");
    assert.notEqual(result.output.outputs["ledger-receipt-path"], "");
    assert.deepEqual(
      JSON.parse(await readFile(environment.V2_CONTROLLER_OUTPUT_PATH, "utf8")),
      result.output,
    );
    const report = JSON.parse(await readFile(
      result.output.outputs["report-path"],
      "utf8",
    ));
    const ledger = JSON.parse(await readFile(
      result.output.outputs["ledger-receipt-path"],
      "utf8",
    ));
    assert.equal(report.decision, cycle.terminal_result.decision);
    assert.equal(Object.hasOwn(report, "reducer_report"), false);
    assert.deepEqual(
      Object.keys(ledger).sort(),
      [
        "automatic_request_attempt_append_receipt",
        "automatic_request_binding_intent_append_receipt",
        "automatic_request_binding_response_append_receipt",
        "automatic_request_intent_append_receipt",
        "automatic_request_review_response_append_receipt",
        "automatic_reservation_append_receipt",
        "lease_release_receipt",
        "reservation_status_intent_append_receipt",
        "reservation_status_response_append_receipt",
        "scheduler_append_receipt",
        "status_intent_append_receipt",
        "status_response_append_receipt",
      ],
    );
    assertNoProtectedProductionInternals(cycle);
    assertNoProtectedProductionInternals(report, "report-artifact");
    assertNoProtectedProductionInternals(ledger, "ledger-artifact");
    assert.equal(
      JSON.stringify({ cycle, report, ledger }).includes(
        "synthetic-token-for-v2-controller-tests-only",
      ),
      false,
    );
  });
});

test("production ledger API preflight precedes lease acquisition", async () => {
  const source = await readFile(CONTROLLER_PATH, "utf8");
  const observationStart = source.indexOf(
    "async function assembleV2InitialProductionObservation",
  );
  const apiPreflight = source.indexOf(
    "assertV2InitialProductionLedgerApi(ledger);",
    observationStart,
  );
  const leaseAcquire = source.indexOf(
    "const discovery = await acquireV2LeaseThenLoadDiscovery",
    observationStart,
  );
  assert.ok(observationStart >= 0);
  assert.ok(apiPreflight >= 0);
  assert.ok(leaseAcquire >= 0);
  assert.ok(
    apiPreflight < leaseAcquire,
    "every production ledger API must be checked before lease acquisition",
  );
});

test("production ledger API preflight rejects invalid status intent without effects",
  () => {
    for (const [variant, invalid] of [
      ["missing", undefined],
      ["nonfunction", { invalid: true }],
    ]) {
      const calls = [];
      const ledger = {
        loadControlPlaneAuthority() { calls.push("control-plane"); },
        loadInitialRunnerStateAuthority() { calls.push("initial-runner"); },
        loadEstablishedRunnerStateAuthority() {
          calls.push("established-runner");
        },
        appendInitialSchedulerObservation() {
          calls.push("initial-scheduler-write");
        },
        appendEstablishedSchedulerObservation() {
          calls.push("established-scheduler-write");
        },
        loadNextStatusWriteIntent() { calls.push("status-intent"); },
        acquireLease() { calls.push("lease-acquire"); },
      };
      if (variant === "missing") {
        delete ledger.loadNextStatusWriteIntent;
      } else {
        ledger.loadNextStatusWriteIntent = invalid;
      }

      assert.throws(
        () => assertV2InitialProductionLedgerApi(ledger),
        (error) => {
          assert.equal(error?.code, "INITIAL_RUNNER_AUTHORITY_REQUIRED");
          assert.equal(error.details.public_effects_performed, 0);
          assert.match(error.message, /loadNextStatusWriteIntent/u);
          return true;
        },
      );
      assert.deepEqual(calls, [], `${variant} API must fail before effects`);
    }
  });

test("production binds a terminal primary status before its head sentinel", async () => {
  await withWorkflowCliFixture({
    eventName: "pull_request_target",
    event: { pull_request: { number: 7 } },
    route: "ordinary",
    pullRequest: "7",
  }, async ({ environment }) => {
    const command = await prepareV2WorkflowCommand(environment);
    const liveTime = new Date().toISOString();
    const oidc = productionOidcFixture(command, liveTime);
    const github = productionControllerGitHubFixture(command, oidc, liveTime, {
      snapshotIssueComments: [productionTerminalFindingIssueComment()],
    });

    const result = await runV2WorkflowControllerCli({
      ...environment,
      ...oidc.environment,
      GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
      GITHUB_API_URL: "https://api.github.com",
    }, { fetch: github.fetch });

    assert.equal(result.cycle.terminal_result.decision, "findings");
    assert.equal(result.cycle.terminal_result.status_effect_outcome, "bound");
    assert.equal(result.cycle.terminal_result.public_effects_performed, 2);
    assert.deepEqual(
      result.cycle.status_receipts.map((receipt) => receipt.target_sha),
      [MERGE, HEAD],
    );
    assert.deepEqual(github.externalWrites, [
      `POST /repos/owner/repo/statuses/${MERGE}`,
      `POST /repos/owner/repo/statuses/${HEAD}`,
    ]);
    assert.equal(github.statusPostCount(), 2);
    assert.equal(github.statusRefetchCount(), 2);
    assert.deepEqual(github.effectRecordKinds().slice(-7), [
      "lease-acquire:",
      "effect-intent:scheduler-observation",
      "effect-intent:status-write",
      "effect-response:status-write",
      "effect-intent:status-write",
      "effect-response:status-write",
      "lease-release:",
    ]);
    assertNoProtectedProductionInternals(result.cycle);
  });
});

for (const failedIntentOrdinal of [1, 2]) {
  test(`status transaction resumes a ${failedIntentOrdinal - 1}-write bound prefix`,
    async () => {
      await withWorkflowCliFixture({
        eventName: "pull_request_target",
        event: { pull_request: { number: 7 } },
        route: "ordinary",
        pullRequest: "7",
      }, async ({ environment, runnerTemp }) => {
        const command = await prepareV2WorkflowCommand(environment);
        const liveTime = new Date().toISOString();
        const oidc = productionOidcFixture(command, liveTime);
        const github = productionControllerGitHubFixture(command, oidc, liveTime, {
          snapshotIssueComments: [productionTerminalFindingIssueComment()],
        });
        github.failRecordUpdateAt(
          "effect-intent:status-write",
          failedIntentOrdinal,
        );
        const firstEnvironment = {
          ...environment,
          ...oidc.environment,
          GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
          GITHUB_API_URL: "https://api.github.com",
        };

        await assert.rejects(
          runV2WorkflowControllerCli(firstEnvironment, { fetch: github.fetch }),
          (error) => error?.code === "INITIAL_OBSERVATION_ABORTED",
        );
        assert.equal(github.statusPostCount(), failedIntentOrdinal - 1);
        assert.equal(github.statusRefetchCount(), failedIntentOrdinal - 1);

        const restartEnvironment = await makeWorkflowLegEnvironment({
          environment: firstEnvironment,
          runnerTemp,
          name: `status-prefix-${failedIntentOrdinal}`,
          runId: `12345${failedIntentOrdinal + 6}`,
          route: "ordinary",
          pullRequest: "7",
        });
        const restartCommand = await prepareV2WorkflowCommand(
          restartEnvironment,
        );
        oidc.bindCommand(restartCommand);
        const restarted = await runV2WorkflowControllerCli(
          restartEnvironment,
          { fetch: github.fetch },
        );

        assert.equal(restarted.cycle.terminal_result.decision, "findings");
        assert.equal(
          restarted.cycle.terminal_result.status_effect_outcome,
          "bound",
        );
        assert.equal(
          restarted.cycle.terminal_result.public_effects_performed,
          3 - failedIntentOrdinal,
        );
        assert.deepEqual(
          restarted.cycle.status_receipts.map((receipt) => receipt.target_sha),
          failedIntentOrdinal === 1 ? [MERGE, HEAD] : [HEAD],
        );
        assert.deepEqual(github.externalWrites, [
          `POST /repos/owner/repo/statuses/${MERGE}`,
          `POST /repos/owner/repo/statuses/${HEAD}`,
        ]);
        assert.equal(github.statusPostCount(), 2);
        assert.equal(github.statusRefetchCount(), 2);
        assert.equal(
          github.effectRecordKinds().filter((kind) =>
            kind === "effect-intent:status-write").length,
          2,
        );
        assert.equal(
          github.effectRecordKinds().filter((kind) =>
            kind === "effect-response:status-write").length,
          2,
        );
        assert.equal(github.requestPostCount(), 0);
        assertNoProtectedProductionInternals(restarted.cycle);
      });
    });
}

for (const failedResponseOrdinal of [1, 2]) {
  test(`status response ${failedResponseOrdinal} crash never replays its public write`,
    async () => {
      await withWorkflowCliFixture({
        eventName: "pull_request_target",
        event: { pull_request: { number: 7 } },
        route: "ordinary",
        pullRequest: "7",
      }, async ({ environment, runnerTemp }) => {
        const command = await prepareV2WorkflowCommand(environment);
        const liveTime = new Date().toISOString();
        const oidc = productionOidcFixture(command, liveTime);
        const github = productionControllerGitHubFixture(command, oidc, liveTime, {
          snapshotIssueComments: [productionTerminalFindingIssueComment()],
        });
        github.failRecordUpdateAt(
          "effect-response:status-write",
          failedResponseOrdinal,
        );
        const firstEnvironment = {
          ...environment,
          ...oidc.environment,
          GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
          GITHUB_API_URL: "https://api.github.com",
        };

        await assert.rejects(
          runV2WorkflowControllerCli(firstEnvironment, { fetch: github.fetch }),
          (error) => error?.code === "INITIAL_OBSERVATION_ABORTED",
        );
        assert.equal(github.statusPostCount(), failedResponseOrdinal);
        assert.equal(github.statusRefetchCount(), failedResponseOrdinal);

        const restartEnvironment = await makeWorkflowLegEnvironment({
          environment: firstEnvironment,
          runnerTemp,
          name: `status-response-crash-${failedResponseOrdinal}`,
          runId: `12346${failedResponseOrdinal}`,
          route: "ordinary",
          pullRequest: "7",
        });
        const restartCommand = await prepareV2WorkflowCommand(
          restartEnvironment,
        );
        oidc.bindCommand(restartCommand);
        await assert.rejects(
          runV2WorkflowControllerCli(restartEnvironment, { fetch: github.fetch }),
          (error) => error?.code === "INITIAL_OBSERVATION_ABORTED",
        );

        assert.equal(github.statusPostCount(), failedResponseOrdinal);
        assert.equal(github.statusRefetchCount(), failedResponseOrdinal);
        assert.equal(
          github.effectRecordKinds().filter((kind) =>
            kind === "effect-intent:status-write").length,
          failedResponseOrdinal,
        );
        assert.equal(
          github.effectRecordKinds().filter((kind) =>
            kind === "effect-response:status-write").length,
          failedResponseOrdinal - 1,
        );
        assert.equal(github.requestPostCount(), 0);
      });
    });
}

test("second terminal status ambiguity consumes its suffix without retry", async () => {
  await withWorkflowCliFixture({
    eventName: "pull_request_target",
    event: { pull_request: { number: 7 } },
    route: "ordinary",
    pullRequest: "7",
  }, async ({ environment, runnerTemp }) => {
    const command = await prepareV2WorkflowCommand(environment);
    const liveTime = new Date().toISOString();
    const oidc = productionOidcFixture(command, liveTime);
    const github = productionControllerGitHubFixture(command, oidc, liveTime, {
      snapshotIssueComments: [productionTerminalFindingIssueComment()],
    });
    github.setStatusRefetchModeAt(2, "missing");
    const firstEnvironment = {
      ...environment,
      ...oidc.environment,
      GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
      GITHUB_API_URL: "https://api.github.com",
    };
    const first = await runV2WorkflowControllerCli(firstEnvironment, {
      fetch: github.fetch,
    });

    assert.equal(first.cycle.terminal_result.status_effect_outcome, "ambiguous");
    assert.equal(first.cycle.terminal_result.public_effects_performed, 2);
    assert.deepEqual(
      first.cycle.status_receipts.map((receipt) => receipt.target_sha),
      [MERGE],
    );
    assert.equal(first.cycle.ledger.status_response_append_receipt, null);
    assert.deepEqual(github.externalWrites, [
      `POST /repos/owner/repo/statuses/${MERGE}`,
      `POST /repos/owner/repo/statuses/${HEAD}`,
    ]);

    const restartEnvironment = await makeWorkflowLegEnvironment({
      environment: firstEnvironment,
      runnerTemp,
      name: "ambiguous-status-suffix",
      runId: "123459",
      route: "ordinary",
      pullRequest: "7",
    });
    const restartCommand = await prepareV2WorkflowCommand(restartEnvironment);
    oidc.bindCommand(restartCommand);
    await assert.rejects(
      runV2WorkflowControllerCli(restartEnvironment, { fetch: github.fetch }),
      (error) => error?.code === "INITIAL_OBSERVATION_ABORTED",
    );
    assert.equal(github.statusPostCount(), 2);
    assert.equal(github.statusRefetchCount(), 2);
    assert.equal(
      github.effectRecordKinds().filter((kind) =>
        kind === "effect-intent:status-write").length,
      2,
    );
    assert.equal(
      github.effectRecordKinds().filter((kind) =>
        kind === "effect-response:status-write").length,
      1,
    );
  });
});

for (const refetchMode of ["missing", "drift", "duplicate", "error"]) {
  test(`status ${refetchMode} refetch consumes one intent without retry`, async () => {
    await withWorkflowCliFixture({
      eventName: "pull_request_target",
      event: { pull_request: { number: 7 } },
      route: "ordinary",
      pullRequest: "7",
    }, async ({ environment }) => {
      const command = await prepareV2WorkflowCommand(environment);
      const liveTime = new Date().toISOString();
      const oidc = productionOidcFixture(command, liveTime);
      const github = productionControllerGitHubFixture(command, oidc, liveTime);
      github.setStatusRefetchMode(refetchMode);
      const result = await runV2WorkflowControllerCli({
        ...environment,
        ...oidc.environment,
        GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
        GITHUB_API_URL: "https://api.github.com",
      }, { fetch: github.fetch });
      const cycle = result.cycle;

      assert.equal(cycle.terminal_result.effect_barrier,
        "STATUS_EFFECT_AMBIGUOUS_CONSUMED");
      assert.equal(cycle.terminal_result.status_effect_outcome, "ambiguous");
      assert.equal(cycle.terminal_result.status_ambiguity_code,
        "STATUS_EFFECT_AMBIGUOUS");
      assert.equal(cycle.terminal_result.public_effects_performed, 1);
      assert.equal(cycle.terminal_result.writes_performed, true);
      assert.equal(cycle.status_receipts.length, 0);
      assert.notEqual(cycle.ledger.status_intent_append_receipt, null);
      assert.equal(cycle.ledger.status_response_append_receipt, null);
      assert.equal(cycle.ledger.lease_release_receipt.record_type,
        "lease-release");
      assert.equal(github.activeLease(), false);
      assert.equal(github.statusPostCount(), 1);
      assert.equal(github.statusRefetchCount(), 1);
      assert.deepEqual(github.externalWrites, [
        `POST /repos/owner/repo/statuses/${HEAD}`,
      ]);
      assert.deepEqual(github.effectRecordKinds().slice(-4), [
        "lease-acquire:",
        "effect-intent:scheduler-observation",
        "effect-intent:status-write",
        "lease-release:",
      ]);
      assert.equal(cycle.terminal_result.status_plan, null);
      assert.equal(cycle.terminal_result.request_plan, null);
      assert.equal(cycle.terminal_result.comment_plan, null);
      assert.equal(result.output.outputs["status-plan-path"], "");
      assertNoProtectedProductionInternals(cycle);
    });
  });
}

for (const requestCase of [
  { name: "uncertain POST", post: "throw", refetches: 0 },
  { name: "HTTP-error POST", post: "error", refetches: 0 },
  { name: "missing exact GET", refetch: "missing", refetches: 1 },
  { name: "drifting exact GET", refetch: "drift", refetches: 1 },
  {
    name: "pre/post scope drift",
    scope: "drift",
    refetches: 1,
    ambiguity_code: "AUTOMATIC_REQUEST_SCOPE_DRIFT",
  },
]) {
  test(`automatic request ${requestCase.name} consumes one attempt without retry`,
    async () => {
      await withWorkflowCliFixture({
        eventName: "pull_request_target",
        event: { pull_request: { number: 7 } },
        route: "ordinary",
        pullRequest: "7",
      }, async ({ environment }) => {
        const command = await prepareV2WorkflowCommand(environment);
        const liveTime = new Date().toISOString();
        const oidc = productionOidcFixture(command, liveTime);
        const github = productionControllerGitHubFixture(command, oidc, liveTime);
        if (requestCase.post !== undefined) {
          github.setRequestPostMode(requestCase.post);
        }
        if (requestCase.refetch !== undefined) {
          github.setRequestRefetchMode(requestCase.refetch);
        }
        if (requestCase.scope !== undefined) {
          github.setRequestScopeMode(requestCase.scope);
        }
        const result = await runV2WorkflowControllerCli({
          ...environment,
          ...oidc.environment,
          GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
          GITHUB_API_URL: "https://api.github.com",
        }, { fetch: github.fetch });
        const cycle = result.cycle;

        assert.equal(
          cycle.terminal_result.effect_barrier,
          "AUTOMATIC_REQUEST_EFFECT_AMBIGUOUS_CONSUMED",
        );
        assert.equal(cycle.terminal_result.status_effect_outcome, "bound");
        assert.equal(
          cycle.terminal_result.reservation_status_effect_outcome,
          "bound",
        );
        assert.equal(
          cycle.terminal_result.automatic_request_effect_outcome,
          "ambiguous",
        );
        assert.equal(
          cycle.terminal_result.automatic_request_ambiguity_code,
          requestCase.ambiguity_code ?? "AUTOMATIC_REQUEST_EFFECT_AMBIGUOUS",
        );
        assert.equal(cycle.terminal_result.status_plan, null);
        assert.equal(cycle.terminal_result.request_plan, null);
        assert.equal(cycle.terminal_result.comment_plan, null);
        assert.equal(cycle.terminal_result.public_effects_performed, 3);
        assert.equal(cycle.binding_receipt, null);
        assert.notEqual(
          cycle.ledger.automatic_request_attempt_append_receipt,
          null,
        );
        assert.notEqual(cycle.ledger.automatic_request_intent_append_receipt, null);
        assert.equal(
          cycle.ledger.automatic_request_review_response_append_receipt,
          null,
        );
        assert.equal(
          cycle.ledger.automatic_request_binding_intent_append_receipt,
          null,
        );
        assert.equal(
          cycle.ledger.automatic_request_binding_response_append_receipt,
          null,
        );
        assert.equal(github.requestPostCount(), 1);
        assert.equal(github.requestRefetchCount(), requestCase.refetches);
        assert.equal(github.statusPostCount(), 2);
        assert.equal(github.statusRefetchCount(), 2);
        assert.equal(github.activeLease(), false);
        assert.equal(
          github.effectRecordKinds().includes("effect-response:review-request"),
          false,
        );
        assert.equal(
          github.effectRecordKinds().includes("effect-intent:request-binding"),
          false,
        );
        assert.equal(result.output.outputs["binding-receipt-path"], "");
        assertNoProtectedProductionInternals(cycle);
      });
    });
}

test("automatic request binding resumes internal ledger appends without a second POST",
  async () => {
    await withWorkflowCliFixture({
      eventName: "pull_request_target",
      event: { pull_request: { number: 7 } },
      route: "ordinary",
      pullRequest: "7",
    }, async ({ environment }) => {
      const command = await prepareV2WorkflowCommand(environment);
      const liveTime = new Date().toISOString();
      const oidc = productionOidcFixture(command, liveTime);
      const github = productionControllerGitHubFixture(command, oidc, liveTime);
      github.failNextRecordUpdates(
        "effect-response:review-request",
        "effect-intent:request-binding",
        "effect-response:request-binding",
      );
      const result = await runV2WorkflowControllerCli({
        ...environment,
        ...oidc.environment,
        GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
        GITHUB_API_URL: "https://api.github.com",
      }, { fetch: github.fetch });

      assert.equal(
        result.cycle.terminal_result.automatic_request_effect_outcome,
        "bound",
      );
      assert.equal(result.cycle.terminal_result.public_effects_performed, 3);
      assert.equal(github.requestPostCount(), 1);
      assert.equal(github.requestRefetchCount(), 1);
      const kinds = github.effectRecordKinds();
      assert.equal(
        kinds.filter((kind) => kind === "effect-response:review-request").length,
        1,
      );
      assert.equal(
        kinds.filter((kind) => kind === "effect-intent:request-binding").length,
        1,
      );
      assert.equal(
        kinds.filter((kind) => kind === "effect-response:request-binding").length,
        1,
      );
      assert.equal(github.activeLease(), false);
      assertNoProtectedProductionInternals(result.cycle);
    });
  });

test("intent-persisted restart consumes the existing automatic request attempt",
  async () => {
    await withWorkflowCliFixture({
      eventName: "pull_request_target",
      event: { pull_request: { number: 7 } },
      route: "ordinary",
      pullRequest: "7",
    }, async ({ environment, runnerTemp }) => {
      const command = await prepareV2WorkflowCommand(environment);
      const liveTime = new Date().toISOString();
      const oidc = productionOidcFixture(command, liveTime);
      const github = productionControllerGitHubFixture(command, oidc, liveTime);
      github.failNextRecordUpdates("effect-intent:effect-attempt");
      const firstEnvironment = {
        ...environment,
        ...oidc.environment,
        GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
        GITHUB_API_URL: "https://api.github.com",
      };

      await assert.rejects(
        runV2WorkflowControllerCli(firstEnvironment, { fetch: github.fetch }),
        (error) => error?.code === "INITIAL_OBSERVATION_ABORTED",
      );
      assert.equal(github.requestPostCount(), 0);
      assert.equal(
        github.effectRecordKinds().filter((kind) =>
          kind === "effect-intent:automatic-request-reservation").length,
        1,
      );
      assert.equal(
        github.effectRecordKinds().filter((kind) =>
          kind === "effect-intent:effect-attempt").length,
        0,
      );
      assert.equal(
        github.effectRecordKinds().filter((kind) =>
          kind === "effect-intent:review-request").length,
        0,
      );

      const restartEnvironment = await makeWorkflowLegEnvironment({
        environment: firstEnvironment,
        runnerTemp,
        name: "intent-persisted-restart",
        runId: "123457",
        route: "ordinary",
        pullRequest: "7",
      });
      const restartCommand = await prepareV2WorkflowCommand(restartEnvironment);
      oidc.bindCommand(restartCommand);
      const restarted = await runV2WorkflowControllerCli(restartEnvironment, {
        fetch: github.fetch,
      });

      assert.equal(
        restarted.cycle.terminal_result.automatic_request_effect_outcome,
        "bound",
      );
      assert.equal(restarted.cycle.terminal_result.public_effects_performed, 1);
      assert.equal(github.requestPostCount(), 1);
      assert.equal(github.requestRefetchCount(), 1);
      assert.equal(
        github.effectRecordKinds().filter((kind) =>
          kind === "effect-intent:automatic-request-reservation").length,
        1,
      );
      assert.equal(
        github.effectRecordKinds().filter((kind) =>
          kind === "effect-intent:effect-attempt").length,
        1,
      );
      assert.equal(
        github.effectRecordKinds().filter((kind) =>
          kind === "effect-intent:review-request").length,
        1,
      );
      assertNoProtectedProductionInternals(restarted.cycle);
    });
  });

test("production advances addressed findings through three automatic generations",
  async () => {
    await withWorkflowCliFixture({
      eventName: "pull_request_target",
      event: { pull_request: { number: 7 } },
      route: "ordinary",
      pullRequest: "7",
    }, async ({ environment, runnerTemp }) => {
      const command = await prepareV2WorkflowCommand(environment);
      const liveTime = new Date().toISOString();
      const oidc = productionOidcFixture(command, liveTime);
      const github = productionControllerGitHubFixture(command, oidc, liveTime, {
        serverTimeStepMilliseconds: 500,
      });
      const firstEnvironment = {
        ...environment,
        ...oidc.environment,
        GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
        GITHUB_API_URL: "https://api.github.com",
      };
      const runLeg = async (name, runId) => {
        const legEnvironment = await makeWorkflowLegEnvironment({
          environment: firstEnvironment,
          runnerTemp,
          name,
          runId,
          route: "ordinary",
          pullRequest: "7",
        });
        const legCommand = await prepareV2WorkflowCommand(legEnvironment);
        oidc.bindCommand(legCommand);
        return runV2WorkflowControllerCli(legEnvironment, {
          fetch: github.fetch,
        });
      };
      const addressLatestRequest = (ordinal) => {
        const request = github.requestComments().at(-1);
        assert.ok(request, `automatic generation ${ordinal} request exists`);
        const finding = productionAutomaticRecoveryFinding({
          id: 2_000 + ordinal * 10,
          request,
        });
        const address = productionAutomaticRecoveryAddress({
          id: 2_000 + ordinal * 10 + 1,
          finding,
        });
        github.addSnapshotIssueComments(finding, address);
      };

      await runV2WorkflowControllerCli(firstEnvironment, {
        fetch: github.fetch,
      });
      assert.equal(github.requestPostCount(), 1);
      addressLatestRequest(1);

      const firstRecovery = await runLeg("automatic-recovery-1", "123461");
      assert.equal(firstRecovery.cycle.terminal_result.decision, "findings");
      assert.equal(firstRecovery.cycle.terminal_result.public_effects_performed, 2);
      assert.equal(github.requestPostCount(), 1);
      assertNoProtectedProductionInternals(firstRecovery.cycle);
      assert.doesNotMatch(
        JSON.stringify(firstRecovery.cycle),
        PROTECTED_AUTOMATIC_RECOVERY_INTERNAL,
      );

      const firstTransition = await runLeg(
        "automatic-transition-1",
        "123462",
      );
      assert.equal(firstTransition.cycle.terminal_result.decision, "findings");
      assert.equal(github.requestPostCount(), 1);
      assert.equal(
        firstTransition.cycle.terminal_result.public_effects_performed,
        0,
      );
      const secondGeneration = await runLeg(
        "automatic-generation-2",
        "123463",
      );
      assert.equal(secondGeneration.cycle.terminal_result.decision, "findings");
      assert.equal(github.requestPostCount(), 2);
      assert.equal(
        secondGeneration.cycle.terminal_result.public_effects_performed,
        2,
      );
      addressLatestRequest(2);

      await runLeg("automatic-recovery-2", "123464");
      assert.equal(github.requestPostCount(), 2);
      const secondTransition = await runLeg(
        "automatic-transition-2",
        "123465",
      );
      assert.equal(secondTransition.cycle.terminal_result.decision, "findings");
      assert.equal(github.requestPostCount(), 2);
      assert.equal(
        secondTransition.cycle.terminal_result.public_effects_performed,
        0,
      );
      const thirdGeneration = await runLeg(
        "automatic-generation-3",
        "123466",
      );
      assert.equal(github.requestPostCount(), 3);
      assert.equal(
        thirdGeneration.cycle.terminal_result.public_effects_performed,
        2,
      );
      addressLatestRequest(3);

      const terminalThird = await runLeg(
        "automatic-generation-3-terminal",
        "123467",
      );
      const noFourth = await runLeg("automatic-no-generation-4", "123468");
      assert.equal(terminalThird.cycle.terminal_result.decision, "findings");
      assert.equal(noFourth.cycle.terminal_result.decision, "findings");
      assert.equal(github.requestPostCount(), 3);
      assert.equal(
        github.effectRecordKinds().filter((kind) =>
          kind === "effect-intent:automatic-request-reservation").length,
        3,
      );
      assert.equal(
        github.effectRecordKinds().filter((kind) =>
          kind === "effect-intent:scheduler-state").length,
        2,
      );
      assert.equal(
        github.effectRecordKinds().filter((kind) =>
          kind === "effect-response:scheduler-state").length,
        2,
      );
      assert.equal(
        github.effectRecordKinds().filter((kind) =>
          kind === "effect-intent:artifact-binding").length,
        2,
      );
      assert.equal(
        github.effectRecordKinds().filter((kind) =>
          kind === "effect-intent:artifact-binding-ready").length,
        2,
      );
      assert.equal(
        github.effectRecordKinds().filter((kind) =>
          kind === "effect-response:artifact-binding-ready").length,
        2,
      );
      assert.equal(
        github.effectRecordKinds().filter((kind) =>
          kind === "effect-response:artifact-binding").length,
        2,
      );
      assert.equal(github.artifactBindingPointReadRequests().length, 2);
      const postGenerations = github.schedulerObservationActions()
        .flatMap((observation) => observation.scheduler_plan.actions)
        .filter((action) => action.kind === "post_review_request")
        .map((action) => action.generation_id);
      assert.deepEqual(postGenerations, [
        "automatic:1",
        "automatic:2",
        "automatic:3",
      ]);
      assert.equal(github.activeLease(), false);
      assertNoProtectedProductionInternals(noFourth.cycle);
      assertFixtureServerClockWithinOidcSkew(github);
    });
  });

test("aggregate recovery point reads retry one complete ordered batch", async () => {
  await withProductionAutomaticRecoveryScenario(async ({
    github,
    runLeg,
    addFindings,
  }) => {
    addFindings([3010, 3020]);
    github.setArtifactBindingEqualDateReads(2);

    const bound = await runLeg("aggregate-ordered-retry");

    assert.equal(bound.cycle.terminal_result.decision, "findings");
    assert.equal(bound.cycle.terminal_result.public_effects_performed, 2);
    assert.deepEqual(
      github.artifactBindingPointReadRequests(),
      [3010, 3020, 3010, 3020].map((id) =>
        `/repos/owner/repo/issues/comments/${id}`),
    );
    const kinds = github.effectRecordKinds();
    assert.equal(kinds.filter((kind) =>
      kind === "effect-intent:artifact-binding").length, 1);
    assert.equal(kinds.filter((kind) =>
      kind === "effect-intent:artifact-binding-ready").length, 1);
    assert.equal(kinds.filter((kind) =>
      kind === "effect-response:artifact-binding-ready").length, 1);
    assert.equal(kinds.filter((kind) =>
      kind === "effect-response:artifact-binding").length, 1);
    assert.equal(github.requestPostCount(), 1);
    assert.equal(github.activeLease(), false);
    assertNoProtectedProductionInternals(bound.cycle);
    assert.doesNotMatch(
      JSON.stringify(bound.cycle),
      PROTECTED_AUTOMATIC_RECOVERY_INTERNAL,
    );
    assertFixtureServerClockWithinOidcSkew(github);
  });
});

test("aggregate recovery exhausts equal-Date reads without weakening stage 9",
  async () => {
    await withProductionAutomaticRecoveryScenario(async ({
      github,
      runLeg,
      addFindings,
    }) => {
      addFindings([3030]);
      github.setArtifactBindingEqualDateAlways();

      await assert.rejects(
        runLeg("aggregate-equal-date-exhausted"),
        (error) =>
          error?.code === "INITIAL_OBSERVATION_ABORTED" &&
          error?.details?.upstream_code ===
            "automatic-artifact-binding-point-read-too-early",
      );
      assert.deepEqual(
        github.artifactBindingPointReadRequests(),
        Array(4).fill("/repos/owner/repo/issues/comments/3030"),
      );
      let kinds = github.effectRecordKinds();
      assert.equal(kinds.filter((kind) =>
        kind === "effect-intent:artifact-binding").length, 1);
      assert.equal(kinds.filter((kind) =>
        kind === "effect-intent:artifact-binding-ready").length, 1);
      assert.equal(kinds.filter((kind) =>
        kind === "effect-response:artifact-binding-ready").length, 1);
      assert.equal(kinds.filter((kind) =>
        kind === "effect-response:artifact-binding").length, 0);
      assert.equal(github.activeLease(), false);

      github.setArtifactBindingEqualDateAlways(false);
      const resumed = await runLeg("aggregate-equal-date-resumed");
      kinds = github.effectRecordKinds();
      assert.equal(
        github.artifactBindingPointReadRequests().length,
        5,
      );
      assert.equal(kinds.filter((kind) =>
        kind === "effect-intent:artifact-binding").length, 1);
      assert.equal(kinds.filter((kind) =>
        kind === "effect-intent:artifact-binding-ready").length, 1);
      assert.equal(kinds.filter((kind) =>
        kind === "effect-response:artifact-binding-ready").length, 1);
      assert.equal(kinds.filter((kind) =>
        kind === "effect-response:artifact-binding").length, 1);
      assert.equal(resumed.cycle.terminal_result.public_effects_performed, 0);
      assertNoProtectedProductionInternals(resumed.cycle);
      assert.equal(github.activeLease(), false);
      assertFixtureServerClockWithinOidcSkew(github);
    });
  });

for (const durablePrefixKind of [
  "effect-intent:artifact-binding",
  "effect-intent:artifact-binding-ready",
  "effect-response:artifact-binding-ready",
]) {
  test(`aggregate recovery resumes durable ${durablePrefixKind} without replay`,
    async () => {
      await withProductionAutomaticRecoveryScenario(async ({
        github,
        runLeg,
        addFindings,
      }) => {
        addFindings([3040]);
        github.failNextDurableRecordUpdates(durablePrefixKind);

        await assert.rejects(
          runLeg(`durable-prefix-${durablePrefixKind.replaceAll(":", "-")}`),
          (error) => error?.code === "INITIAL_OBSERVATION_ABORTED",
        );
        const resumed = await runLeg(
          `durable-prefix-resume-${durablePrefixKind.replaceAll(":", "-")}`,
        );

        const kinds = github.effectRecordKinds();
        assert.equal(kinds.filter((kind) =>
          kind === "effect-intent:artifact-binding").length, 1);
        assert.equal(kinds.filter((kind) =>
          kind === "effect-intent:artifact-binding-ready").length, 1);
        assert.equal(kinds.filter((kind) =>
          kind === "effect-response:artifact-binding-ready").length, 1);
        assert.equal(kinds.filter((kind) =>
          kind === "effect-response:artifact-binding").length, 1);
        assert.equal(github.artifactBindingPointReadRequests().length, 1);
        assert.equal(github.requestPostCount(), 1);
        assert.equal(github.activeLease(), false);
        assertNoProtectedProductionInternals(resumed.cycle);
        assertFixtureServerClockWithinOidcSkew(github);
      });
    });
}

test("durable stage 9 return loss transitions without a second point read",
  async () => {
    await withProductionAutomaticRecoveryScenario(async ({
      github,
      runLeg,
      addFindings,
    }) => {
      addFindings([3050]);
      github.failNextDurableRecordUpdates(
        "effect-response:artifact-binding",
      );

      await assert.rejects(
        runLeg("durable-stage-9-return-loss"),
        (error) => error?.code === "INITIAL_OBSERVATION_ABORTED",
      );
      assert.equal(github.artifactBindingPointReadRequests().length, 1);
      let kinds = github.effectRecordKinds();
      assert.equal(kinds.filter((kind) =>
        kind === "effect-response:artifact-binding").length, 1);

      const transitioned = await runLeg("durable-stage-9-transition");
      kinds = github.effectRecordKinds();
      assert.equal(github.artifactBindingPointReadRequests().length, 1);
      assert.equal(kinds.filter((kind) =>
        kind === "effect-response:artifact-binding").length, 1);
      assert.equal(kinds.filter((kind) =>
        kind === "effect-intent:scheduler-state").length, 1);
      assert.equal(kinds.filter((kind) =>
        kind === "effect-response:scheduler-state").length, 1);
      assert.equal(
        transitioned.cycle.terminal_result.public_effects_performed,
        0,
      );
      assert.equal(github.requestPostCount(), 1);
      assert.equal(github.activeLease(), false);
      assertNoProtectedProductionInternals(transitioned.cycle);
      assertFixtureServerClockWithinOidcSkew(github);
    });
  });

test("queued artifact suffix survives a point-read abort in exact chain order",
  async () => {
    await withProductionAutomaticRecoveryScenario(async ({
      github,
      runLeg,
      addFindings,
    }) => {
      addFindings([3100]);
      github.failNextDurableRecordUpdates(
        "effect-response:artifact-binding-ready",
      );
      await assert.rejects(
        runLeg("queued-prefix-stage-8-return-loss"),
        (error) => error?.code === "INITIAL_OBSERVATION_ABORTED",
      );

      addFindings([3120]);
      github.failArtifactBindingPointReadAt(1);
      await assert.rejects(
        runLeg("queued-prefix-point-read-abort"),
        (error) => error?.code === "INITIAL_OBSERVATION_ABORTED",
      );
      assert.equal(github.activeLease(), false);

      const suffixBound = await runLeg(
        "queued-prefix-parent-and-suffix-response",
      );

      assert.deepEqual(
        github.artifactBindingPointReadRequests(),
        [3100, 3100, 3120].map((id) =>
          `/repos/owner/repo/issues/comments/${id}`),
      );
      assert.deepEqual(
        github.effectRecordKinds().filter((kind) =>
          kind.includes("artifact-binding")),
        [
          "effect-intent:artifact-binding",
          "effect-intent:artifact-binding-ready",
          "effect-response:artifact-binding-ready",
          "effect-intent:artifact-binding",
          "effect-response:artifact-binding",
          "effect-intent:artifact-binding-ready",
          "effect-response:artifact-binding-ready",
          "effect-response:artifact-binding",
        ],
      );
      assert.equal(github.activeLease(), false);
      assertNoProtectedProductionInternals(suffixBound.cycle);
      assertFixtureServerClockWithinOidcSkew(github);
    });
  });

test("queued artifact release failure reports the latest reachable append",
  async () => {
    await withProductionAutomaticRecoveryScenario(async ({
      github,
      runLeg,
      addFindings,
    }) => {
      addFindings([3140]);
      github.failNextDurableRecordUpdates(
        "effect-response:artifact-binding-ready",
      );
      await assert.rejects(
        runLeg("queued-release-stage-8-return-loss"),
        (error) => error?.code === "INITIAL_OBSERVATION_ABORTED",
      );
      const [staleReadyReceiptDigest] =
        github.artifactBindingReadyConfirmationRecoveryReceiptDigests();
      assert.match(staleReadyReceiptDigest, /^sha256:[0-9a-f]{64}$/u);

      addFindings([3160]);
      github.failArtifactBindingPointReadAt(1);
      github.failNextRelease();
      await assert.rejects(
        runLeg("queued-release-point-read-failure"),
        (error) => {
          assert.equal(error?.code, "PRODUCTION_LEASE_RELEASE_FAILED");
          assert.equal(
            error.details.phase,
            "abort:automatic-recovery-artifact-binding-point-read",
          );
          assert.equal(error.details.budget_refunded, false);
          assert.equal(error.details.public_effects_performed, 0);
          assert.match(
            error.details.last_reachable_receipt_digest,
            /^sha256:[0-9a-f]{64}$/u,
          );
          assert.notEqual(
            error.details.last_reachable_receipt_digest,
            staleReadyReceiptDigest,
          );
          return true;
        },
      );
      assert.deepEqual(
        github.artifactBindingPointReadRequests(),
        ["/repos/owner/repo/issues/comments/3140"],
      );
      assert.equal(github.activeLease(), true);
      assertFixtureServerClockWithinOidcSkew(github);
    });
  });

test("partial aggregate point-read failure restarts the whole ordered batch",
  async () => {
    await withProductionAutomaticRecoveryScenario(async ({
      github,
      runLeg,
      addFindings,
    }) => {
      addFindings([3070, 3080]);
      github.failArtifactBindingPointReadAt(2);

      await assert.rejects(
        runLeg("aggregate-partial-point-read-failure"),
        (error) => error?.code === "INITIAL_OBSERVATION_ABORTED",
      );
      assert.deepEqual(
        github.artifactBindingPointReadRequests(),
        [3070, 3080].map((id) =>
          `/repos/owner/repo/issues/comments/${id}`),
      );
      let kinds = github.effectRecordKinds();
      assert.equal(kinds.filter((kind) =>
        kind === "effect-response:artifact-binding").length, 0);
      assert.equal(github.activeLease(), false);

      const resumed = await runLeg("aggregate-partial-point-read-resume");
      assert.deepEqual(
        github.artifactBindingPointReadRequests(),
        [3070, 3080, 3070, 3080].map((id) =>
          `/repos/owner/repo/issues/comments/${id}`),
      );
      kinds = github.effectRecordKinds();
      assert.equal(kinds.filter((kind) =>
        kind === "effect-intent:artifact-binding").length, 1);
      assert.equal(kinds.filter((kind) =>
        kind === "effect-intent:artifact-binding-ready").length, 1);
      assert.equal(kinds.filter((kind) =>
        kind === "effect-response:artifact-binding-ready").length, 1);
      assert.equal(kinds.filter((kind) =>
        kind === "effect-response:artifact-binding").length, 1);
      assert.equal(resumed.cycle.terminal_result.public_effects_performed, 0);
      assert.equal(github.requestPostCount(), 1);
      assert.equal(github.activeLease(), false);
      assertNoProtectedProductionInternals(resumed.cycle);
      assertFixtureServerClockWithinOidcSkew(github);
    });
  });

test("aggregate binding release failure retains its exact no-refund phase",
  async () => {
    await withProductionAutomaticRecoveryScenario(async ({
      github,
      runLeg,
      addFindings,
    }) => {
      addFindings([3090]);
      github.failNextRelease();

      await assert.rejects(
        runLeg("aggregate-binding-release-failure"),
        (error) =>
          error?.code === "PRODUCTION_LEASE_RELEASE_FAILED" &&
          error?.details?.phase ===
            "automatic-recovery-artifact-binding-bound-release" &&
          error?.details?.budget_refunded === false,
      );
      const kinds = github.effectRecordKinds();
      assert.equal(kinds.filter((kind) =>
        kind === "effect-response:artifact-binding").length, 1);
      assert.equal(github.artifactBindingPointReadRequests().length, 1);
      assert.equal(github.requestPostCount(), 1);
      assert.equal(github.activeLease(), true);
      assertFixtureServerClockWithinOidcSkew(github);
    }, { serverTimeStepMilliseconds: 1_000 });
  });

test("status ambiguity blocks both recovery authorities", async () => {
  await withProductionAutomaticRecoveryScenario(async ({
    github,
    runLeg,
    addFindings,
  }) => {
    addFindings([3060]);
    github.setStatusRefetchModeAt(github.statusPostCount() + 1, "missing");

    const ambiguous = await runLeg("status-ambiguous-recovery");

    assert.equal(
      ambiguous.cycle.terminal_result.status_effect_outcome,
      "ambiguous",
    );
    assert.equal(
      ambiguous.cycle.terminal_result.public_effects_performed,
      1,
    );
    assert.equal(github.artifactBindingPointReadRequests().length, 0);
    const kinds = github.effectRecordKinds();
    assert.equal(kinds.some((kind) => kind.includes("artifact-binding")), false);
    assert.equal(kinds.some((kind) => kind.endsWith(":scheduler-state")), false);
    assert.equal(github.requestPostCount(), 1);
    assert.equal(github.activeLease(), false);
    assertNoProtectedProductionInternals(ambiguous.cycle);
    assertFixtureServerClockWithinOidcSkew(github);
  });
});

test("bound automatic request fails closed when its no-refund lease release fails", async () => {
  await withWorkflowCliFixture({
    eventName: "pull_request_target",
    event: { pull_request: { number: 7 } },
    route: "ordinary",
    pullRequest: "7",
  }, async ({ environment }) => {
    const command = await prepareV2WorkflowCommand(environment);
    const liveTime = new Date().toISOString();
    const oidc = productionOidcFixture(command, liveTime);
    const github = productionControllerGitHubFixture(command, oidc, liveTime);
    github.failNextRelease();
    await assert.rejects(
      assembleV2ProductionControllerCycle({
        command,
        environment: {
          ...environment,
          ...oidc.environment,
          GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
          GITHUB_API_URL: "https://api.github.com",
        },
        fetch: github.fetch,
      }),
      (error) => {
        assert.equal(error?.code, "PRODUCTION_LEASE_RELEASE_FAILED");
        assert.equal(error.details.public_effects_performed, 3);
        assert.equal(error.details.budget_refunded, false);
        assert.equal(error.details.phase, "automatic-request-bound-release");
        assert.match(
          error.details.last_reachable_receipt_digest,
          /^sha256:[0-9a-f]{64}$/u,
        );
        return true;
      },
    );
    assert.equal(github.activeLease(), true);
    assert.deepEqual(github.externalWrites, [
      `POST /repos/owner/repo/statuses/${HEAD}`,
      `POST /repos/owner/repo/statuses/${HEAD}`,
      "POST /repos/owner/repo/issues/7/comments",
    ]);
    assert.equal(github.statusPostCount(), 2);
    assert.equal(github.requestPostCount(), 1);
  });
});

test("ambiguous status retains its intent when no-refund release fails", async () => {
  await withWorkflowCliFixture({
    eventName: "pull_request_target",
    event: { pull_request: { number: 7 } },
    route: "ordinary",
    pullRequest: "7",
  }, async ({ environment }) => {
    const command = await prepareV2WorkflowCommand(environment);
    const liveTime = new Date().toISOString();
    const oidc = productionOidcFixture(command, liveTime);
    const github = productionControllerGitHubFixture(command, oidc, liveTime);
    github.setStatusRefetchMode("missing");
    github.failNextRelease("after-status-intent");
    await assert.rejects(
      assembleV2ProductionControllerCycle({
        command,
        environment: {
          ...environment,
          ...oidc.environment,
          GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
          GITHUB_API_URL: "https://api.github.com",
        },
        fetch: github.fetch,
      }),
      (error) => {
        assert.equal(error?.code, "PRODUCTION_LEASE_RELEASE_FAILED");
        assert.equal(error.details.phase, "status-ambiguous-release");
        assert.equal(error.details.public_effects_performed, 1);
        assert.equal(error.details.budget_refunded, false);
        assert.match(
          error.details.last_reachable_receipt_digest,
          /^sha256:[0-9a-f]{64}$/u,
        );
        return true;
      },
    );
    assert.equal(github.activeLease(), true);
    assert.equal(github.statusPostCount(), 1);
    assert.equal(github.statusRefetchCount(), 1);
    assert.deepEqual(github.externalWrites, [
      `POST /repos/owner/repo/statuses/${HEAD}`,
    ]);
    assert.deepEqual(github.effectRecordKinds().slice(-3), [
      "lease-acquire:",
      "effect-intent:scheduler-observation",
      "effect-intent:status-write",
    ]);
  });
});

test("ambiguous reservation status retains two writes when lease release fails",
  async () => {
    await withWorkflowCliFixture({
      eventName: "pull_request_target",
      event: { pull_request: { number: 7 } },
      route: "ordinary",
      pullRequest: "7",
    }, async ({ environment }) => {
      const command = await prepareV2WorkflowCommand(environment);
      const liveTime = new Date().toISOString();
      const oidc = productionOidcFixture(command, liveTime);
      const github = productionControllerGitHubFixture(command, oidc, liveTime);
      github.setStatusRefetchModeAt(2, "missing");
      github.failNextRelease();
      await assert.rejects(
        assembleV2ProductionControllerCycle({
          command,
          environment: {
            ...environment,
            ...oidc.environment,
            GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
            GITHUB_API_URL: "https://api.github.com",
          },
          fetch: github.fetch,
        }),
        (error) => {
          assert.equal(error?.code, "PRODUCTION_LEASE_RELEASE_FAILED");
          assert.equal(error.details.phase, "reservation-status-ambiguous-release");
          assert.equal(error.details.public_effects_performed, 2);
          assert.equal(error.details.budget_refunded, false);
          assert.match(
            error.details.last_reachable_receipt_digest,
            /^sha256:[0-9a-f]{64}$/u,
          );
          return true;
        },
      );
      assert.equal(github.activeLease(), true);
      assert.equal(github.statusPostCount(), 2);
      assert.equal(github.statusRefetchCount(), 2);
      assert.equal(github.requestPostCount(), 0);
      assert.deepEqual(github.externalWrites, [
        `POST /repos/owner/repo/statuses/${HEAD}`,
        `POST /repos/owner/repo/statuses/${HEAD}`,
      ]);
      assert.equal(
        github.effectRecordKinds().includes("effect-intent:review-request"),
        false,
      );
    });
  });

test("established history preserves one bound request without replay", async () => {
  await withWorkflowCliFixture({
    eventName: "pull_request_target",
    event: { pull_request: { number: 7 } },
    route: "ordinary",
    pullRequest: "7",
  }, async ({ environment, runnerTemp }) => {
    const command = await prepareV2WorkflowCommand(environment);
    const liveTime = new Date().toISOString();
    const oidc = productionOidcFixture(command, liveTime);
    const github = productionControllerGitHubFixture(command, oidc, liveTime);
    const firstEnvironment = {
      ...environment,
      ...oidc.environment,
      GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
      GITHUB_API_URL: "https://api.github.com",
    };
    const first = await runV2WorkflowControllerCli(firstEnvironment, {
      fetch: github.fetch,
    });
    assert.equal(first.cycle.terminal_result.public_effects_performed, 3);
    assert.equal(first.cycle.terminal_result.status_effect_outcome, "bound");
    assert.equal(
      first.cycle.terminal_result.automatic_request_effect_outcome,
      "bound",
    );
    assert.match(
      first.cycle.terminal_result.initial_runner_state_authority_digest,
      /^sha256:[0-9a-f]{64}$/u,
    );
    assert.equal(
      first.cycle.terminal_result.established_runner_state_authority_digest,
      null,
    );
    assert.equal(github.activeLease(), false);
    const secondRunnerTemp = join(runnerTemp, "established");
    await mkdir(secondRunnerTemp);
    const secondEnvironment = {
      ...firstEnvironment,
      RUNNER_TEMP: secondRunnerTemp,
      GITHUB_RUN_ID: "123457",
      GITHUB_RUN_ATTEMPT: "1",
      V2_CONTROLLER_INPUT_PATH: join(secondRunnerTemp, "command.json"),
      V2_CONTROLLER_OUTPUT_PATH: join(secondRunnerTemp, "output.json"),
    };
    const secondCommand = await prepareV2WorkflowCommand(secondEnvironment);
    oidc.bindCommand(secondCommand);
    const second = await runV2WorkflowControllerCli(secondEnvironment, {
      fetch: github.fetch,
    });
    assert.equal(second.cycle.terminal_result.public_effects_performed, 0);
    assert.equal(second.cycle.terminal_result.status_plan, null);
    assert.equal(second.cycle.terminal_result.request_plan, null);
    assert.equal(second.cycle.terminal_result.comment_plan, null);
    assert.equal(
      second.cycle.terminal_result.initial_runner_state_authority_digest,
      null,
    );
    assert.match(
      second.cycle.terminal_result.established_runner_state_authority_digest,
      /^sha256:[0-9a-f]{64}$/u,
    );
    assert.equal(
      second.cycle.terminal_result.scheduler_append_receipt.record_type,
      "effect-intent",
    );
    assert.equal(
      second.cycle.terminal_result.lease_release_receipt.record_type,
      "lease-release",
    );
    assert.notEqual(second.output.outputs["report-path"], "");
    assert.notEqual(second.output.outputs["ledger-receipt-path"], "");
    assert.equal(second.output.outputs["status-plan-path"], "");
    const observations = github.schedulerObservationActions();
    assert.equal(observations.length, 2);
    assert.notEqual(observations[0].initial_runner_state_authority, null);
    assert.equal(observations[1].initial_runner_state_authority, null);
    assert.equal(
      observations[1].prior_scheduling.epoch.id,
      observations[0].prior_scheduling.epoch.id,
    );
    assert.equal(
      observations[1].prior_scheduling.epoch.started_at,
      observations[0].prior_scheduling.epoch.started_at,
    );
    assert.equal(observations[0].prior_scheduling.epoch.controlled_request, null);
    assert.deepEqual(
      observations[1].prior_scheduling.epoch.controlled_request,
      first.cycle.terminal_result.authoritative_controlled_request,
    );
    assert.deepEqual(
      observations[1].prior_scheduling.no_start_candidate,
      observations[0].prior_scheduling.no_start_candidate,
    );
    assert.deepEqual(observations[1].prior_scheduling.run_identity, {
      run_id: "123457",
      run_attempt: 1,
    });
    assert.equal(
      observations[1].prior_scheduling.trigger,
      secondCommand.route.trigger,
    );
    assert.equal(github.activeLease(), false);
    assert.equal(github.statusPostCount(), 2);
    assert.equal(github.requestPostCount(), 1);
    assert.equal(github.requestRefetchCount(), 2);
    assert.deepEqual(github.externalWrites, [
      `POST /repos/owner/repo/statuses/${HEAD}`,
      `POST /repos/owner/repo/statuses/${HEAD}`,
      "POST /repos/owner/repo/issues/7/comments",
    ]);
    assert.deepEqual(github.effectRecordKinds().slice(-4), [
      "lease-release:",
      "lease-acquire:",
      "effect-intent:scheduler-observation",
      "lease-release:",
    ]);
    assertNoProtectedProductionInternals(second.cycle);
  });
});

test("incompatible live configuration publishes only a rich zero-effect result", async () => {
  await withWorkflowCliFixture({
    eventName: "pull_request_target",
    event: { pull_request: { number: 7 } },
    route: "ordinary",
    pullRequest: "7",
  }, async ({ environment }) => {
    const command = await prepareV2WorkflowCommand(environment);
    const oidc = oidcFixture();
    const preflight = productionPreflightFetchFixture(command, {
      callerWorkflowState: "disabled_manually",
    });
    const fetch = async (url, init) => {
      const hostname = new URL(url).hostname;
      if (hostname === "token.actions.githubusercontent.com" ||
          hostname.endsWith(".actions.githubusercontent.com")) {
        const original = await oidc.fetch(url, init);
        const raw = await original.text();
        return new Response(raw, {
          status: original.status,
          headers: {
            date: new Date().toUTCString(),
            "content-length": String(Buffer.byteLength(raw)),
            "content-type": "application/json",
          },
        });
      }
      return preflight.fetch(url, init);
    };
    const result = await runV2WorkflowControllerCli({
      ...environment,
      ...oidc.environment,
      GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
      GITHUB_API_URL: "https://api.github.com",
    }, { fetch });
    assert.equal(result.cycle.terminal_result.decision, "blocked-configuration");
    assert.equal(result.cycle.terminal_result.public_effects_performed, 0);
    assert.deepEqual(result.cycle.terminal_result.status_plan.writes, []);
    assert.deepEqual(result.cycle.terminal_result.scheduler_plan.actions, []);
    assert.equal(result.output.outputs["ledger-receipt-path"], "");
    const report = JSON.parse(await readFile(
      result.output.outputs["report-path"],
      "utf8",
    ));
    assert.equal(report.selection.source, "workflow");
    assert.equal(report.decision, "blocked-configuration");
    assert.equal(report.review_epoch, null);
    assert.equal(report.status_target, null);
    assert.equal(report.provider_profile, null);
    assert.equal(report.evidence_basis, null);
    assert.equal(report.request_policy.status, "not-applicable");
    assert.equal(oidc.tokens.length, 0);
  });
});

test("production preflight boundary binds owner identity, repo receipt, and shared OIDC audience", async () => {
  await withWorkflowCliFixture({
    eventName: "pull_request_target",
    event: { pull_request: { number: 7 } },
    route: "ordinary",
    pullRequest: "7",
  }, async ({ environment }) => {
    const command = await prepareV2WorkflowCommand(environment);
    const receipt = productionPreflightBoundaryFixture(command);
    const validated = validateV2ProductionPreflightBoundary(receipt, command);
    assert.equal(validated.repository.owner_id, "88");
    assert.deepEqual(
      validated.git_ledger_capability_input.repository_endpoint_receipt,
      validated.repository_endpoint_receipt,
    );
    assert.equal(
      validated.git_ledger_capability_input.actor_assurance
        .oidc_binding_requirements.audience,
      V2_GIT_LEDGER_OIDC_AUDIENCE,
    );
    assert.equal(validated.git_ledger_capability_input.sealed, false);

    for (const [label, mutate] of [
      ["owner identity", (value) => {
        value.git_ledger_capability_input.repository.owner_id = "99";
      }],
      ["repository endpoint", (value) => {
        value.git_ledger_capability_input.repository_endpoint_receipt.path =
          "/repos/other/repo";
      }],
      ["OIDC audience", (value) => {
        value.git_ledger_capability_input.actor_assurance
          .oidc_binding_requirements.audience = "wrong-audience";
      }],
    ]) {
      const drifted = structuredClone(receipt);
      mutate(drifted);
      assert.throws(
        () => validateV2ProductionPreflightBoundary(drifted, command),
        { name: "TypeError" },
        label,
      );
    }
  });
});

test("exact prepare-command and run subprocesses reach global-fetch live preflight", async () => {
  await withWorkflowCliFixture({
    eventName: "pull_request_target",
    event: { pull_request: { number: 7 } },
    route: "ordinary",
    pullRequest: "7",
  }, async ({ root, environment }) => {
    const fetchLog = join(root, "fetch.log");
    const preload = join(root, "mock-fetch.mjs");
    await writeFile(preload, [
      'import { appendFileSync } from "node:fs";',
      "globalThis.fetch = async (url, init = {}) => {",
      "  appendFileSync(process.env.V2_TEST_FETCH_LOG, `${init.method ?? \"GET\"} ${String(url)}\\n`);",
      "  return {",
      "    status: 503,",
      "    headers: { get: (name) => name.toLowerCase() === \"date\" ? \"Wed, 13 Aug 2026 12:00:00 GMT\" : null },",
      "    async text() { return JSON.stringify({ message: \"fixture preflight stop\" }); },",
      "  };",
      "};",
      "",
    ].join("\n"), { mode: 0o600 });
    const subprocessEnvironment = {
      ...process.env,
      ...environment,
      GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
      NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
      V2_TEST_FETCH_LOG: fetchLog,
    };
    const prepared = spawnSync(
      process.execPath,
      [CONTROLLER_PATH, "prepare-command"],
      { env: subprocessEnvironment, encoding: "utf8" },
    );
    assert.equal(prepared.status, 0, prepared.stderr);
    const run = spawnSync(
      process.execPath,
      [CONTROLLER_PATH, "run"],
      { env: subprocessEnvironment, encoding: "utf8" },
    );
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, /^::error::PREFLIGHT_FAILED:/u);
    assert.equal(
      await readFile(fetchLog, "utf8"),
      "GET https://api.github.com/repos/owner/repo\n",
    );
  });
});

test("scan-all run rejects the single-PR route and list-open has no production CLI", async () => {
  await withWorkflowCliFixture({
    eventName: "schedule",
    event: {},
    route: "scan-all-open",
    pullRequest: "",
  }, async ({ environment }) => {
    await prepareV2WorkflowCommand(environment);
    await assert.rejects(
      runV2WorkflowControllerCli(environment),
      (error) => error?.code === "SCAN_ALL_REQUIRES_SCHEDULE_DISPATCH",
    );
    let fetchCalled = false;
    await assert.rejects(
      runV2ListOpenCli(environment, {
        async fetch() { fetchCalled = true; },
      }),
      (error) => {
        assert.equal(
          error?.code,
          "OPEN_PULL_REQUEST_DISCOVERY_AUTHORITY_UNAVAILABLE",
        );
        assert.equal(error.details.diagnostic_completeness, "unproven");
        return true;
      },
    );
    assert.equal(fetchCalled, false);

    const subprocess = spawnSync(
      process.execPath,
      [CONTROLLER_PATH, "list-open"],
      { env: { ...process.env, ...environment }, encoding: "utf8" },
    );
    assert.equal(subprocess.status, 2, subprocess.stderr);
    assert.match(
      subprocess.stderr,
      /^::error::workflow-controller requires exact/u,
    );
    assert.equal(subprocess.stdout, "");
  });
});

function historicalCandidateInventorySourceWorkflow(controllerRelease) {
  return {
    repository: structuredClone(controllerRelease.repository),
    workflow_path: controllerRelease.workflow_path,
    workflow_ref: controllerRelease.workflow_ref,
    workflow_sha: controllerRelease.workflow_sha,
    job_workflow_ref: controllerRelease.job_workflow_ref,
    job_workflow_sha: controllerRelease.job_workflow_sha,
    caller_workflow_file_receipt_digest:
      controllerRelease.caller_workflow_file_receipt_digest,
    job_workflow_file_receipt_digest:
      controllerRelease.job_workflow_file_receipt_digest,
    release_receipt_digest: controllerRelease.release_receipt_digest,
  };
}

function historicalCandidateInventoryPayload({
  phase,
  owner,
  initialInventory,
  shardReceipt = null,
  priorCandidateAuthorityDigest,
}) {
  return {
    schema: V2_GIT_LEDGER_CANDIDATE_INVENTORY_RECORD_SCHEMA,
    schema_version: 1,
    phase,
    cycle_id:
      `candidate-cycle:${initialInventory.receipt_digest.slice("sha256:".length)}`,
    owner: structuredClone(owner),
    prior_candidate_authority_digest: priorCandidateAuthorityDigest,
    supersedes_incomplete_cycle_id: null,
    initial_inventory_receipt_digest: initialInventory.receipt_digest,
    initial_inventory: phase === "cycle-start"
      ? structuredClone(initialInventory)
      : null,
    shard_receipt: phase === "shard"
      ? structuredClone(shardReceipt)
      : null,
    final_inventory: null,
    cycle_receipt: null,
  };
}

async function mintHistoricalCandidateInventoryEnvelope({
  verifier,
  capability,
  priorEnvelope,
  record,
  evaluatedScopeReceipt,
}) {
  const sourceWorkflow = historicalCandidateInventorySourceWorkflow(
    capability.controller_release,
  );
  const requestInput = {
    schema: V2_GIT_LEDGER_PROVENANCE_REQUEST_SCHEMA,
    schema_version: 1,
    operation: record.record_type,
    repository: structuredClone(capability.repository),
    ledger_ref: V2_GIT_LEDGER_REF,
    predecessor_commit_sha: record.predecessor_commit_sha,
    protection_receipt_digest:
      capability.protection.live_ruleset_receipt_digest,
    source_workflow: sourceWorkflow,
    effect_scope: null,
    evaluated_scope_receipt: evaluatedScopeReceipt,
    record_identity: {
      record_type: record.record_type,
      kind: record.kind,
      effect_id: record.effect_id,
      idempotency_key: record.idempotency_key,
      payload_digest: digestV2GitLedgerPayload(record.payload),
    },
    github_server_time: record.server_observed_at,
  };
  const nonce = gitLedgerDigestDomain(
    "codex-review-gate-v2-git-ledger-provenance-nonce",
    requestInput,
  );
  const requestWithoutDigest = {
    ...requestInput,
    nonce,
    audience:
      `${V2_GIT_LEDGER_OIDC_AUDIENCE}:${nonce.slice("sha256:".length)}`,
  };
  const provenanceRequest = {
    ...requestWithoutDigest,
    request_digest: gitLedgerDigestDomain(
      "codex-review-gate-v2-git-ledger-provenance-request",
      requestWithoutDigest,
    ),
  };
  const provenance = await verifier.verifyWorkflowProvenance(
    {
      schema: V2_GIT_LEDGER_PROVENANCE_VERIFIER_REQUEST_SCHEMA,
      schema_version: 1,
      mode: "mint-and-verify",
      provenance_request: provenanceRequest,
      compact_jwt: null,
      stored_receipt: null,
    },
    {
      signal: new AbortController().signal,
      deadline_ms: V2_GIT_LEDGER_PROVENANCE_TIMEOUT_MS,
    },
  );
  const envelopeBase = {
    schema: V2_GIT_LEDGER_ENVELOPE_SCHEMA,
    schema_version: 1,
    repository: structuredClone(capability.repository),
    ledger_ref: V2_GIT_LEDGER_REF,
    record_type: record.record_type,
    sequence: priorEnvelope.sequence + 1,
    pull_request: record.pull_request,
    head_ref_oid: record.head_ref_oid,
    base_ref_oid: record.base_ref_oid,
    potential_merge_commit_oid: record.potential_merge_commit_oid,
    kind: record.kind,
    effect_id: record.effect_id,
    idempotency_key: record.idempotency_key,
    predecessor_commit_sha: record.predecessor_commit_sha,
    server_observed_at: record.server_observed_at,
    payload: structuredClone(record.payload),
    control_comment_binding: record.control_comment_binding,
    lease: record.lease,
    source_workflow: sourceWorkflow,
    workflow_provenance: provenance.receipt,
    workflow_provenance_jwt: provenance.compact_jwt,
    payload_digest: digestV2GitLedgerPayload(record.payload),
  };
  return {
    ...envelopeBase,
    envelope_digest: gitLedgerDigestDomain(
      "codex-review-gate-v2-git-ledger-envelope",
      envelopeBase,
    ),
  };
}

async function seedHistoricalLegacyIncompleteCandidateCycle({
  github,
  verifier,
  capability,
  triggerIdentity,
  owner,
}) {
  const repository = {
    owner: capability.repository.owner,
    name: capability.repository.name,
    id: capability.repository.id,
    node_id: capability.repository.node_id,
  };
  const transport = createV2GitHubCandidateInventory({
    fetch: github.fetch,
    token: "synthetic-token-for-v2-controller-tests-only",
    repository,
    restBaseUrl: "https://api.github.com",
  });
  const initialInventory = await transport.scan();
  assert.equal(initialInventory.shards.length, 2);
  const completedShard = await transport.readShard({
    inventory: initialInventory,
    shard_index: 0,
  });
  const initialAuthority = deriveV2GitLedgerCandidateInventoryAuthority(
    [],
    capability.repository,
  );
  const startPayload = historicalCandidateInventoryPayload({
    phase: "cycle-start",
    owner,
    initialInventory,
    priorCandidateAuthorityDigest: initialAuthority.authority_digest,
  });
  const startRecord = createV2GitLedgerCandidateInventoryRecord({
    predecessor_commit_sha: github.ledgerTipCommitSha(),
    owner,
    server_observed_at: initialInventory.observed_at,
    payload: startPayload,
  });
  const startScope = createV2GitLedgerCandidateInventoryEvaluatedScopeReceipt({
    repository: capability.repository,
    payload: startPayload,
    trigger_identity: triggerIdentity,
    repository_endpoint_receipt: capability.repository_endpoint_receipt,
  });
  const startEnvelope = await mintHistoricalCandidateInventoryEnvelope({
    verifier,
    capability,
    priorEnvelope: github.ledgerLatestEnvelope(),
    record: startRecord,
    evaluatedScopeReceipt: startScope,
  });
  const startEntry = github.materializeHistoricalLedgerEnvelope(startEnvelope);
  const afterStart = deriveV2GitLedgerCandidateInventoryAuthority(
    [startEntry],
    capability.repository,
  );
  const shardPayload = historicalCandidateInventoryPayload({
    phase: "shard",
    owner,
    initialInventory,
    shardReceipt: completedShard,
    priorCandidateAuthorityDigest: afterStart.authority_digest,
  });
  const shardRecord = createV2GitLedgerCandidateInventoryRecord({
    predecessor_commit_sha: github.ledgerTipCommitSha(),
    owner,
    server_observed_at: completedShard.observed_at,
    payload: shardPayload,
  });
  const shardScope = createV2GitLedgerCandidateInventoryEvaluatedScopeReceipt({
    repository: capability.repository,
    payload: shardPayload,
    trigger_identity: triggerIdentity,
    repository_endpoint_receipt: capability.repository_endpoint_receipt,
  });
  const shardEnvelope = await mintHistoricalCandidateInventoryEnvelope({
    verifier,
    capability,
    priorEnvelope: startEnvelope,
    record: shardRecord,
    evaluatedScopeReceipt: shardScope,
  });
  const shardEntry = github.materializeHistoricalLedgerEnvelope(shardEnvelope);
  const incompleteAuthority = deriveV2GitLedgerCandidateInventoryAuthority(
    [startEntry, shardEntry],
    capability.repository,
  );
  return {
    cycle_id: startPayload.cycle_id,
    start_record_oid: startEntry.commit_sha,
    initial_inventory: initialInventory,
    completed_shard: completedShard,
    incomplete_authority: incompleteAuthority.incomplete_cycle,
  };
}

async function padHistoricalCapabilityAttestations({
  github,
  createVerifier,
  targetRecordCount,
}) {
  let priorEnvelope = github.ledgerLatestEnvelope();
  assert.equal(priorEnvelope.record_type, "capability-attestation");
  let predecessorCommitSha = github.ledgerTipCommitSha();
  let recordCount = priorEnvelope.sequence + 1;
  assert.equal(recordCount, 3);
  let verifier = null;
  let verifierMintCount = 120;
  while (recordCount < targetRecordCount) {
    if (verifierMintCount === 120) {
      verifier = createVerifier();
      await verifier.initialize();
      verifierMintCount = 0;
    }
    const binding = structuredClone(
      priorEnvelope.workflow_provenance.operation_binding,
    );
    const nonceInput = {
      schema: V2_GIT_LEDGER_PROVENANCE_REQUEST_SCHEMA,
      schema_version: 1,
      ...binding,
      predecessor_commit_sha: predecessorCommitSha,
    };
    delete nonceInput.nonce;
    delete nonceInput.audience;
    delete nonceInput.request_digest;
    const nonce = gitLedgerDigestDomain(
      "codex-review-gate-v2-git-ledger-provenance-nonce",
      nonceInput,
    );
    const requestWithoutDigest = {
      ...nonceInput,
      nonce,
      audience:
        `${V2_GIT_LEDGER_OIDC_AUDIENCE}:${nonce.slice("sha256:".length)}`,
    };
    const provenanceRequest = {
      ...requestWithoutDigest,
      request_digest: gitLedgerDigestDomain(
        "codex-review-gate-v2-git-ledger-provenance-request",
        requestWithoutDigest,
      ),
    };
    const provenance = await verifier.verifyWorkflowProvenance(
      {
        schema: V2_GIT_LEDGER_PROVENANCE_VERIFIER_REQUEST_SCHEMA,
        schema_version: 1,
        mode: "mint-and-verify",
        provenance_request: provenanceRequest,
        compact_jwt: null,
        stored_receipt: null,
      },
      {
        signal: new AbortController().signal,
        deadline_ms: V2_GIT_LEDGER_PROVENANCE_TIMEOUT_MS,
      },
    );
    const {
      envelope_digest: _priorEnvelopeDigest,
      workflow_provenance: _priorWorkflowProvenance,
      workflow_provenance_jwt: _priorWorkflowProvenanceJwt,
      ...template
    } = priorEnvelope;
    const envelopeBase = {
      ...structuredClone(template),
      sequence: recordCount,
      predecessor_commit_sha: predecessorCommitSha,
      workflow_provenance: provenance.receipt,
      workflow_provenance_jwt: provenance.compact_jwt,
    };
    const envelope = {
      ...envelopeBase,
      envelope_digest: gitLedgerDigestDomain(
        "codex-review-gate-v2-git-ledger-envelope",
        envelopeBase,
      ),
    };
    const entry = github.materializeHistoricalLedgerEnvelope(envelope);
    predecessorCommitSha = entry.commit_sha;
    priorEnvelope = envelope;
    recordCount += 1;
    verifierMintCount += 1;
  }
  return {
    record_count: recordCount,
    tip_commit_sha: predecessorCommitSha,
  };
}

test("schedule-dispatch binds a legacy finish publication to its durable remaining shard count", () => {
  const oid = (digit) => digit.repeat(40);
  const digest = (digit) => `sha256:${digit.repeat(64)}`;
  const candidateAuthority = {
    completed_cycle: null,
    completed_generation: null,
    incomplete_cycle: {
      cycle_id: `candidate-cycle:${"2".repeat(64)}`,
      start_record_oid: oid("3"),
      initial_inventory: { shards: [{}, {}] },
      shard_receipts: [{}],
      next_shard_index: 1,
    },
    atomic_cycle: null,
  };
  let publishedRecordCount = 3;
  const reconciliation = () => ({
    schema:
      "codex-review-gate-git-ledger-candidate-refresh-reconciliation-v2",
    schema_version: 2,
    state: "persisted",
    reason: "legacy-incomplete-cycle-finished",
    repository: {},
    ledger_ref: "refs/heads/codex-review-gate-ledger-v2",
    adapter_configuration_digest: digest("1"),
    persistence_mode: "legacy-finish-v1",
    suppression_result: null,
    publication_result: {
      schema:
        "codex-review-gate-git-ledger-candidate-inventory-legacy-finish-publication-v2",
      schema_version: 1,
      state: "persisted",
      reason: "legacy-incomplete-cycle-finished",
      publication_outcome: "published",
      repository: {},
      ledger_ref: "refs/heads/codex-review-gate-ledger-v2",
      cycle_id: `candidate-cycle:${"2".repeat(64)}`,
      start_record_oid: oid("3"),
      cycle_receipt_digest: digest("4"),
      published_record_commit_shas: Array.from(
        { length: publishedRecordCount },
        (_, index) => oid(String(index + 5)),
      ),
      append_receipts: [],
      latest_append_receipt: null,
      final_tip_commit_sha: oid("9"),
      final_commit_count: 9,
      writes_performed: true,
      result_digest: digest("a"),
    },
    result_digest: digest("b"),
  });
  assert.equal(
    validateV2CandidateRefreshReconciliationForSource(
      reconciliation(),
      candidateAuthority,
    ).publication_result.published_record_commit_shas.length,
    3,
  );

  for (const invalidCount of [2, 4]) {
    publishedRecordCount = invalidCount;
    assert.throws(
      () => validateV2CandidateRefreshReconciliationForSource(
        reconciliation(),
        candidateAuthority,
      ),
      (error) => error?.code ===
        "SCHEDULE_DISPATCH_RECONCILIATION_INVALID",
    );
  }
  publishedRecordCount = 3;
  candidateAuthority.incomplete_cycle.shard_receipts = [];
  assert.throws(
    () => validateV2CandidateRefreshReconciliationForSource(
      reconciliation(),
      candidateAuthority,
    ),
    (error) => error?.code ===
      "SCHEDULE_DISPATCH_CANDIDATE_AUTHORITY_INVALID",
  );

  candidateAuthority.incomplete_cycle.shard_receipts = [{}];
  candidateAuthority.incomplete_cycle.cycle_id =
    `candidate-cycle:${"c".repeat(64)}`;
  assert.throws(
    () => validateV2CandidateRefreshReconciliationForSource(
      reconciliation(),
      candidateAuthority,
    ),
    (error) => error?.code ===
      "SCHEDULE_DISPATCH_RECONCILIATION_INVALID",
  );

  candidateAuthority.incomplete_cycle.cycle_id =
    `candidate-cycle:${"2".repeat(64)}`;
  candidateAuthority.incomplete_cycle.start_record_oid = oid("4");
  assert.throws(
    () => validateV2CandidateRefreshReconciliationForSource(
      reconciliation(),
      candidateAuthority,
    ),
    (error) => error?.code ===
      "SCHEDULE_DISPATCH_RECONCILIATION_INVALID",
  );
});

test("schedule-dispatch finishes the exact durable legacy shard suffix before publishing its matrix",
  async () => {
    await withWorkflowCliFixture({
      eventName: "schedule",
      event: {},
      route: "scan-all-open",
      pullRequest: "",
    }, async ({ root, environment }) => {
      const command = await prepareV2WorkflowCommand(environment);
      const liveTime = new Date().toISOString();
      const oidc = productionOidcFixture(command, liveTime);
      const githubOutput = join(root, "legacy-finish-github-output");
      await writeFile(githubOutput, "", { mode: 0o600 });
      const selectedEnvironment = {
        ...environment,
        ...oidc.environment,
        GITHUB_OUTPUT: githubOutput,
        GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
        GITHUB_API_URL: "https://api.github.com",
      };
      const github = productionControllerGitHubFixture(
        command,
        oidc,
        liveTime,
        {
          candidateNumbers: Array.from(
            { length: 257 },
            (_, index) => index + 1,
          ),
          candidateLifecycleStates: [
            ...Array.from({ length: 256 }, () => "closed"),
            "open",
            ...Array.from({ length: 256 }, () => "closed"),
            "open",
          ],
          apiOrigin: "https://api.github.com",
          serverTimeStepMilliseconds: 1,
        },
      );
      let rejectCurrentOpen = true;
      const bootstrapThenStopFetch = async (input, init = {}) => {
        const url = new URL(String(input));
        if (
          rejectCurrentOpen && url.pathname === "/graphql" &&
          String(init.method ?? "GET").toUpperCase() === "POST" &&
          String(JSON.parse(String(init.body)).query).includes(
            "CodexReviewGateCurrentOpenPullRequests",
          )
        ) {
          return jsonResponse(JSON.stringify({
            message: "fixture stop after protected-ledger bootstrap",
          }), 500);
        }
        return github.fetch(input, init);
      };
      await assert.rejects(
        runV2ScheduleDispatchCli(selectedEnvironment, {
          fetch: bootstrapThenStopFetch,
        }),
      );
      rejectCurrentOpen = false;
      assert.deepEqual(github.candidateInventoryPhases(), []);
      assert.deepEqual(github.candidateDispatchPhases(), []);
      const capability = github.ledgerCapabilityReceipt();
      assert.notEqual(capability, null);
      const historicalVerifier = createV2GitHubOidcProvenanceVerifier({
        fetch: github.fetch,
        environment: selectedEnvironment,
      });
      await historicalVerifier.initialize();
      const triggerIdentity = loadV2GitLedgerTriggerIdentity({
        command,
        environment: selectedEnvironment,
      });
      const legacy = await seedHistoricalLegacyIncompleteCandidateCycle({
        github,
        verifier: historicalVerifier,
        capability,
        triggerIdentity,
        owner: {
          run_id: selectedEnvironment.GITHUB_RUN_ID,
          run_attempt: Number(selectedEnvironment.GITHUB_RUN_ATTEMPT),
          actor_id: selectedEnvironment.GITHUB_ACTOR_ID,
        },
      });
      assert.equal(legacy.incomplete_authority.cycle_id, legacy.cycle_id);
      assert.equal(
        legacy.incomplete_authority.start_record_oid,
        legacy.start_record_oid,
      );
      assert.equal(legacy.incomplete_authority.next_shard_index, 1);
      assert.equal(legacy.incomplete_authority.shard_receipts.length, 1);
      assert.equal(legacy.initial_inventory.shards.length, 2);
      const recordCountBefore = github.ledgerRecordCount();
      const writeRequestsBefore = github.ledgerWriteRequests().length;
      const inventoryRequestsBefore =
        github.candidateInventoryRequests().length;
      const lifecycleRequestsBefore =
        github.candidateLifecycleRequests().length;
      const currentOpenRequestsBefore =
        github.currentOpenCandidateRequests().length;

      const result = await runV2ScheduleDispatchCli(selectedEnvironment, {
        fetch: github.fetch,
      });

      assert.equal(github.ledgerRecordCount() - recordCountBefore, 3);
      assert.equal(
        github.ledgerWriteRequests().slice(writeRequestsBefore)
          .filter((request) => request.startsWith("PATCH /git/refs/"))
          .length,
        1,
        "the remaining shard, completion, and reservation must share one ref CAS",
      );
      assert.deepEqual(github.candidateInventoryPhases(), [
        "cycle-start",
        "shard",
        "shard",
        "cycle-complete",
      ]);
      assert.deepEqual(github.candidateDispatchPhases(), ["reserve"]);
      const inventoryRecords = github.candidateInventoryRecordEntries();
      assert.equal(inventoryRecords[0].commit_sha, legacy.start_record_oid);
      assert.ok(inventoryRecords.every(({ cycle_id: cycleId }) =>
        cycleId === legacy.cycle_id));
      assert.equal(
        github.currentOpenCandidateRequests().length,
        currentOpenRequestsBefore,
        "an incomplete legacy source must not be replaced by current-open sampling",
      );
      assert.ok(
        github.candidateInventoryRequests().length > inventoryRequestsBefore,
      );
      assert.ok(
        github.candidateLifecycleRequests().length > lifecycleRequestsBefore,
      );
      assert.deepEqual(
        result.matrix.include.map(({ pull_request: pullRequest }) =>
          pullRequest),
        [257],
      );
      assert.equal(result.matrix.include[0].enabled, true);
      assert.equal(
        await readFile(githubOutput, "utf8"),
        `matrix=${canonicalJson(result.matrix)}\n`,
      );
      assertNoDispatchAuthorityInternals(result);
    });
  });

test("schedule-dispatch bootstraps one current-open candidate without legacy REST", async () => {
  await withWorkflowCliFixture({
    eventName: "schedule",
    event: {},
    route: "scan-all-open",
    pullRequest: "",
  }, async ({ environment }) => {
    const command = await prepareV2WorkflowCommand(environment);
    const liveTime = new Date().toISOString();
    const oidc = productionOidcFixture(command, liveTime);
    const selectedEnvironment = {
      ...environment,
      ...oidc.environment,
      GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
      GITHUB_API_URL: "https://api.github.com",
    };
    const github = productionControllerGitHubFixture(
      command,
      oidc,
      liveTime,
      {
        candidateNumbers: [7],
        apiOrigin: "https://api.github.com",
      },
    );
    const currentOpenRequestsBefore =
      github.currentOpenCandidateRequests().length;
    const inventoryRequestsBefore =
      github.candidateInventoryRequests().length;
    const lifecycleRequestsBefore =
      github.candidateLifecycleRequests().length;
    const ledgerWritesBefore = github.ledgerWriteRequests().length;

    const result = await runV2ScheduleDispatchCli(selectedEnvironment, {
      fetch: github.fetch,
    });

    assert.equal(result.matrix.include.length, 1);
    assert.equal(result.matrix.include[0].enabled, true);
    assert.equal(result.matrix.include[0].pull_request, 7);
    assert.equal(
      github.currentOpenCandidateRequests().length - currentOpenRequestsBefore,
      4,
    );
    assert.equal(
      github.candidateInventoryRequests().length - inventoryRequestsBefore,
      0,
    );
    assert.equal(
      github.candidateLifecycleRequests().length - lifecycleRequestsBefore,
      0,
    );
    assert.equal(
      github.ledgerWriteRequests().slice(ledgerWritesBefore)
        .filter((request) => request.startsWith("PATCH /git/refs/"))
        .length,
      4,
      "bootstrap plus current-open publication must use four protected-ref updates",
    );
    assertNoDispatchAuthorityInternals(result);
  });
});

test("schedule-dispatch checkpoints a 4095-record current-open source before publishing its matrix",
  async () => {
    await withWorkflowCliFixture({
      eventName: "schedule",
      event: {},
      route: "scan-all-open",
      pullRequest: "",
    }, async ({ root, runnerTemp, environment }) => {
      const command = await prepareV2WorkflowCommand(environment);
      const liveTime = new Date().toISOString();
      const oidc = productionOidcFixture(command, liveTime);
      const bootstrapEnvironment = {
        ...environment,
        ...oidc.environment,
        GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
        GITHUB_API_URL: "https://api.github.com",
      };
      const github = productionControllerGitHubFixture(
        command,
        oidc,
        liveTime,
        {
          candidateNumbers: [7],
          apiOrigin: "https://api.github.com",
          serverTimeStepMilliseconds: 1,
          authoritativeWallClock: true,
        },
      );
      let rejectCurrentOpen = true;
      const bootstrapThenStopFetch = async (input, init = {}) => {
        const url = new URL(String(input));
        if (
          rejectCurrentOpen && url.pathname === "/graphql" &&
          String(init.method ?? "GET").toUpperCase() === "POST" &&
          String(JSON.parse(String(init.body)).query).includes(
            "CodexReviewGateCurrentOpenPullRequests",
          )
        ) {
          return jsonResponse(JSON.stringify({
            message: "fixture stop after protected-ledger bootstrap",
          }), 500);
        }
        return github.fetch(input, init);
      };
      await assert.rejects(
        runV2ScheduleDispatchCli(bootstrapEnvironment, {
          fetch: bootstrapThenStopFetch,
        }),
      );
      rejectCurrentOpen = false;
      const padded = await padHistoricalCapabilityAttestations({
        github,
        createVerifier: () => createV2GitHubOidcProvenanceVerifier({
          fetch: github.fetch,
          environment: bootstrapEnvironment,
        }),
        targetRecordCount: MAX_V2_GIT_LEDGER_COMMITS - 1,
      });
      assert.equal(padded.record_count, MAX_V2_GIT_LEDGER_COMMITS - 1);
      assert.equal(padded.tip_commit_sha, github.ledgerTipCommitSha());

      const githubOutput = join(root, "current-open-4095-github-output");
      await writeFile(githubOutput, "", { mode: 0o600 });
      const checkpointEnvironment = await makeWorkflowLegEnvironment({
        environment: bootstrapEnvironment,
        runnerTemp,
        name: "current-open-4095-checkpoint",
        runId: "123457",
        route: "scan-all-open",
        pullRequest: "",
        githubOutput,
      });
      const checkpointCommand = await prepareV2WorkflowCommand(
        checkpointEnvironment,
      );
      oidc.bindCommand(checkpointCommand);
      const oidcCallsBefore = oidc.calls.length;
      const writesBefore = github.ledgerWriteRequests().length;
      const currentOpenRequestsBefore =
        github.currentOpenCandidateRequests().length;
      const inventoryRequestsBefore =
        github.candidateInventoryRequests().length;
      const lifecycleRequestsBefore =
        github.candidateLifecycleRequests().length;

      const result = await runV2ScheduleDispatchCli(checkpointEnvironment, {
        fetch: github.fetch,
      });

      assert.equal(
        github.ledgerWriteRequests().slice(writesBefore)
          .filter((request) => request.startsWith("PATCH /git/refs/"))
          .length,
        1,
        "checkpoint carrier, generation, and reservation require one ref CAS",
      );
      assert.equal(
        github.currentOpenCandidateRequests().length -
          currentOpenRequestsBefore,
        4,
      );
      assert.equal(
        github.candidateInventoryRequests().length,
        inventoryRequestsBefore,
      );
      assert.equal(
        github.candidateLifecycleRequests().length,
        lifecycleRequestsBefore,
      );
      assert.deepEqual(github.candidateInventoryPhases(), [
        "current-open-generation",
      ]);
      assert.deepEqual(github.candidateDispatchPhases(), ["reserve"]);
      assert.deepEqual(
        oidc.calls.slice(oidcCallsBefore).map(({ kind }) => kind),
        [
          "discovery", "jwks",
          "mint", "mint", "mint", "mint", "mint", "mint",
        ],
        "the reconciled reserve must not perform another full load and load mint",
      );
      const checkpointState = github.ledgerLatestCheckpointState();
      assert.notEqual(checkpointState, null);
      assert.equal(checkpointState.schema_version, 3);
      assert.equal(checkpointState.profile, "mature-quiescent-v1");
      assert.equal(
        checkpointState.source.commit_count,
        MAX_V2_GIT_LEDGER_COMMITS - 1,
      );
      assert.equal(
        checkpointState.next_unit.profile,
        "current-open-generation-v1",
      );
      assert.equal(checkpointState.next_unit.kind, "current-open-generation");
      assert.equal(checkpointState.next_unit.candidate_count, 1);
      assert.ok(
        checkpointState.next_unit.current_epoch_remaining_commit_capacity < 0,
      );
      assert.ok(
        checkpointState.next_unit.fresh_epoch_remaining_commit_capacity >= 0,
      );
      assert.equal(result.matrix.include.length, 1);
      assert.equal(result.matrix.include[0].enabled, true);
      assert.equal(result.matrix.include[0].pull_request, 7);
      const binding = JSON.parse(result.matrix.include[0].dispatch_binding);
      assert.equal(binding.candidate.identity.number, 7);
      assert.equal(
        binding.candidate_source.source_profile,
        "stable-graphql-current-open-v4",
      );
      assert.equal(
        await readFile(githubOutput, "utf8"),
        `matrix=${canonicalJson(result.matrix)}\n`,
      );
      assertNoDispatchAuthorityInternals(result);
    });
  });

test("schedule-dispatch persists current-open authority without legacy full refresh and restarts the active raw-plan matrix", async () => {
  await withWorkflowCliFixture({
    eventName: "schedule",
    event: {},
    route: "scan-all-open",
    pullRequest: "",
  }, async ({ root, runnerTemp, environment }) => {
    const githubOutput = join(root, "github-output-first");
    await writeFile(githubOutput, "", { mode: 0o600 });
    const command = await prepareV2WorkflowCommand(environment);
    const liveTime = new Date().toISOString();
    const oidc = productionOidcFixture(command, liveTime);
    const firstEnvironment = {
      ...environment,
      ...oidc.environment,
      GITHUB_OUTPUT: githubOutput,
      GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
      GITHUB_API_URL: "https://api.github.com",
    };
    const github = productionControllerGitHubFixture(
      command,
      oidc,
      liveTime,
      {
        candidateNumbers: [],
        apiOrigin: "https://api.github.com",
      },
    );
    await runV2ScheduleDispatchCli(firstEnvironment, {
      fetch: github.fetch,
    });
    github.setCandidateNumbers([7]);
    const currentOpenRequestsBefore =
      github.currentOpenCandidateRequests().length;
    const inventoryRequestsBefore = github.candidateInventoryRequests().length;
    const lifecycleRequestsBefore = github.candidateLifecycleRequests().length;
    const inventoryPhasesBefore = github.candidateInventoryPhases().length;
    const dispatchPhasesBefore = github.candidateDispatchPhases().length;
    const ledgerWritesBefore = github.ledgerWriteRequests().length;
    const firstOutput = join(root, "github-output-first-nonempty");
    await writeFile(firstOutput, "", { mode: 0o600 });
    const nonemptyEnvironment = await makeWorkflowLegEnvironment({
      environment: firstEnvironment,
      runnerTemp,
      name: "first-nonempty",
      runId: "123457",
      route: "scan-all-open",
      pullRequest: "",
      githubOutput: firstOutput,
    });
    const nonemptyCommand = await prepareV2WorkflowCommand(
      nonemptyEnvironment,
    );
    oidc.bindCommand(nonemptyCommand);
    const first = await runV2ScheduleDispatchCli(nonemptyEnvironment, {
      fetch: github.fetch,
    });
    assert.deepEqual(Object.keys(first), ["matrix", "rendered"]);
    assert.deepEqual(Object.keys(first.matrix), ["include"]);
    assert.equal(first.matrix.include.length, 1);
    const row = first.matrix.include[0];
    assert.deepEqual(Object.keys(row).sort(), [
      "dispatch_binding", "enabled", "pull_request",
    ]);
    assert.equal(row.enabled, true);
    assert.equal(row.pull_request, 7);
    const rowBinding = JSON.parse(row.dispatch_binding);
    assert.equal(rowBinding.candidate.schema_version, 2);
    assert.equal(rowBinding.candidate.identity.number, 7);
    assert.deepEqual(Object.keys(rowBinding).sort(), [
      "batch_count",
      "batch_index",
      "binding_digest",
      "candidate",
      "candidate_dispatch_authority_digest",
      "candidate_index",
      "candidate_inventory_authority_digest",
      "candidate_source",
      "cycle_id",
      "dispatch_digest",
      "generation_id",
      "inventory_digest",
      "repository",
      "reservation_digest",
      "reservation_record_oid",
      "schema",
      "schema_version",
    ]);
    assert.deepEqual(Object.keys(rowBinding.candidate_source).sort(), [
      "candidate_set_digest",
      "lifecycle_candidate_set_digest",
      "production_candidate_authority_digest",
      "schema",
      "schema_version",
      "source_current_open_semantic_digest",
      "source_generation_digest",
      "source_generation_id",
      "source_generation_record_oid",
      "source_profile",
    ]);
    assert.deepEqual(Object.keys(rowBinding.candidate).sort(), [
      "identity",
      "identity_digest",
      "lifecycle_generation_id",
      "lifecycle_seed",
      "lifecycle_seed_digest",
      "schema",
      "schema_version",
      "selection_digest",
      "source_generation_record_oid",
    ]);
    assert.equal(
      first.rendered,
      `${canonicalJson(first.matrix)}\n`,
    );
    assert.equal(
      await readFile(firstOutput, "utf8"),
      `matrix=${canonicalJson(first.matrix)}\n`,
    );
    assert.deepEqual(github.candidateInventoryPhases().slice(
      inventoryPhasesBefore,
    ), ["current-open-generation"]);
    assert.deepEqual(github.candidateDispatchPhases().slice(
      dispatchPhasesBefore,
    ), ["reserve"]);
    assert.equal(
      github.ledgerWriteRequests().slice(ledgerWritesBefore)
        .filter((request) => request.startsWith("PATCH /git/refs/"))
        .length,
      1,
      "atomic publication must update the protected ref exactly once",
    );
    assert.equal(
      github.currentOpenCandidateRequests().length - currentOpenRequestsBefore,
      4,
    );
    assert.equal(
      github.candidateInventoryRequests().length - inventoryRequestsBefore,
      0,
    );
    assert.equal(
      github.candidateLifecycleRequests().length - lifecycleRequestsBefore,
      0,
    );
    assertNoDispatchAuthorityInternals(first);

    const restartOutput = join(root, "github-output-restart");
    await writeFile(restartOutput, "", { mode: 0o600 });
    const restartEnvironment = await makeWorkflowLegEnvironment({
      environment: nonemptyEnvironment,
      runnerTemp,
      name: "restart",
      runId: "123458",
      route: "scan-all-open",
      pullRequest: "",
      githubOutput: restartOutput,
    });
    const restartCommand = await prepareV2WorkflowCommand(restartEnvironment);
    oidc.bindCommand(restartCommand);
    const restartInventoryRequestsBefore =
      github.candidateInventoryRequests().length;
    const restartLifecycleRequestsBefore =
      github.candidateLifecycleRequests().length;
    const restartCurrentOpenRequestsBefore =
      github.currentOpenCandidateRequests().length;
    const recordsBefore = github.ledgerRecordCount();
    const restartLedgerWritesBefore = github.ledgerWriteRequests().length;
    const restarted = await runV2ScheduleDispatchCli(restartEnvironment, {
      fetch: github.fetch,
    });
    assert.deepEqual(restarted.matrix, first.matrix);
    assert.equal(
      github.candidateInventoryRequests().length,
      restartInventoryRequestsBefore,
      "active reservation restart must not rescan candidates",
    );
    assert.equal(
      github.currentOpenCandidateRequests().length,
      restartCurrentOpenRequestsBefore,
      "active reservation restart must not resample current-open candidates",
    );
    assert.equal(
      github.candidateLifecycleRequests().length,
      restartLifecycleRequestsBefore,
      "active reservation restart must not read legacy candidate lifecycle",
    );
    assert.equal(github.ledgerRecordCount(), recordsBefore);
    assert.equal(
      github.ledgerWriteRequests().length,
      restartLedgerWritesBefore,
      "reservation restart must perform no Git write",
    );
    assert.equal(
      await readFile(restartOutput, "utf8"),
      `matrix=${canonicalJson(first.matrix)}\n`,
    );
    assertNoDispatchAuthorityInternals(restarted);
  });
});

test("schedule-dispatch reconciles one durable current-open publication response loss without legacy refresh",
  async () => {
    await withWorkflowCliFixture({
      eventName: "schedule",
      event: {},
      route: "scan-all-open",
      pullRequest: "",
    }, async ({ environment, runnerTemp }) => {
      const scanCommand = await prepareV2WorkflowCommand(environment);
      const liveTime = new Date().toISOString();
      const oidc = productionOidcFixture(scanCommand, liveTime);
      const sharedEnvironment = {
        ...environment,
        ...oidc.environment,
        GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
        GITHUB_API_URL: "https://api.github.com",
      };
      const github = productionControllerGitHubFixture(
        scanCommand,
        oidc,
        liveTime,
        {
          candidateNumbers: [],
          apiOrigin: "https://api.github.com",
        },
      );
      await runV2ScheduleDispatchCli(sharedEnvironment, {
        fetch: github.fetch,
      });
      github.setCandidateNumbers([7]);
      const currentOpenRequestsBeforePublication =
        github.currentOpenCandidateRequests().length;
      const candidateInventoryRequestsBeforePublication =
        github.candidateInventoryRequests().length;
      const candidateLifecycleRequestsBeforePublication =
        github.candidateLifecycleRequests().length;
      const inventoryPhasesBefore = github.candidateInventoryPhases().length;
      const dispatchPhasesBefore = github.candidateDispatchPhases().length;
      const ledgerWritesBeforePublication =
        github.ledgerWriteRequests().length;
      github.failNextDurableRecordUpdates(
        "candidate-dispatch-observation:",
      );
      const publicationEnvironment = await makeWorkflowLegEnvironment({
        environment: sharedEnvironment,
        runnerTemp,
        name: "atomic-publication-response-loss",
        runId: "123457",
        route: "scan-all-open",
        pullRequest: "",
      });
      const publicationCommand = await prepareV2WorkflowCommand(
        publicationEnvironment,
      );
      oidc.bindCommand(publicationCommand);
      const first = await runV2ScheduleDispatchCli(publicationEnvironment, {
        fetch: github.fetch,
      });

      assert.equal(first.matrix.include.length, 1);
      assert.equal(first.matrix.include[0].pull_request, 7);
      assert.equal(
        github.currentOpenCandidateRequests().length -
          currentOpenRequestsBeforePublication,
        4,
      );
      assert.equal(
        github.candidateInventoryRequests().length -
          candidateInventoryRequestsBeforePublication,
        0,
      );
      assert.equal(
        github.candidateLifecycleRequests().length -
          candidateLifecycleRequestsBeforePublication,
        0,
      );
      assert.deepEqual(github.candidateInventoryPhases().slice(
        inventoryPhasesBefore,
      ), ["current-open-generation"]);
      assert.deepEqual(github.candidateDispatchPhases().slice(
        dispatchPhasesBefore,
      ), ["reserve"]);
      assert.equal(
        github.ledgerWriteRequests().slice(ledgerWritesBeforePublication)
          .filter((request) => request.startsWith("PATCH /git/refs/"))
          .length,
        1,
        "response-lost atomic publication must issue one ref update",
      );
      const currentOpenRequestsBefore =
        github.currentOpenCandidateRequests().length;
      const candidateInventoryRequestsBefore =
        github.candidateInventoryRequests().length;
      const candidateLifecycleRequestsBefore =
        github.candidateLifecycleRequests().length;
      const externalWritesBefore = github.externalWriteRequests().length;
      const recordsBefore = github.ledgerRecordCount();
      const restartLedgerWritesBefore = github.ledgerWriteRequests().length;
      const restartEnvironment = await makeWorkflowLegEnvironment({
        environment: publicationEnvironment,
        runnerTemp,
        name: "atomic-publication-response-loss-restart",
        runId: "123458",
        route: "scan-all-open",
        pullRequest: "",
      });
      const restartCommand = await prepareV2WorkflowCommand(
        restartEnvironment,
      );
      oidc.bindCommand(restartCommand);
      const restarted = await runV2ScheduleDispatchCli(restartEnvironment, {
        fetch: github.fetch,
      });

      assert.deepEqual(restarted.matrix, first.matrix);
      assert.equal(github.ledgerRecordCount(), recordsBefore);
      assert.equal(
        github.ledgerWriteRequests().length,
        restartLedgerWritesBefore,
      );
      assert.equal(
        github.currentOpenCandidateRequests().length -
          currentOpenRequestsBefore,
        0,
      );
      assert.equal(
        github.candidateInventoryRequests().length -
          candidateInventoryRequestsBefore,
        0,
      );
      assert.equal(
        github.candidateLifecycleRequests().length -
          candidateLifecycleRequestsBefore,
        0,
      );
      assert.equal(
        github.externalWriteRequests().length - externalWritesBefore,
        0,
      );
      assertNoDispatchAuthorityInternals(restarted);
    });
  });

test("schedule-dispatch expands every compact batch item into a workflow binding",
  async () => {
    await withWorkflowCliFixture({
      eventName: "schedule",
      event: {},
      route: "scan-all-open",
      pullRequest: "",
    }, async ({ environment, runnerTemp }) => {
      const scanCommand = await prepareV2WorkflowCommand(environment);
      const liveTime = new Date().toISOString();
      const oidc = productionOidcFixture(scanCommand, liveTime);
      const sharedEnvironment = {
        ...environment,
        ...oidc.environment,
        GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
        GITHUB_API_URL: "https://api.github.com",
      };
      const githubOutput = join(runnerTemp, "compact-matrix-github-output");
      await writeFile(githubOutput, "", { mode: 0o600 });
      const candidateNumbers = Array.from({ length: 64 }, (_, index) =>
        index + 1);
      const github = productionControllerGitHubFixture(
        scanCommand,
        oidc,
        liveTime,
        {
          candidateNumbers,
          apiOrigin: "https://api.github.com",
        },
      );
      const dispatch = await runV2ScheduleDispatchCli({
        ...sharedEnvironment,
        GITHUB_OUTPUT: githubOutput,
      }, { fetch: github.fetch });

      assert.equal(dispatch.matrix.include.length, candidateNumbers.length);
      const matrixBindings = [];
      for (const [index, row] of dispatch.matrix.include.entries()) {
        assert.equal(row.enabled, true);
        assert.equal(row.pull_request, candidateNumbers[index]);
        const legEnvironment = await makeWorkflowLegEnvironment({
          environment: sharedEnvironment,
          runnerTemp,
          name: `compact-binding-${index}`,
          runId: String(123_457 + index),
          route: "ordinary",
          pullRequest: String(candidateNumbers[index]),
          dispatchBinding: row.dispatch_binding,
        });
        const legCommand = await prepareV2WorkflowCommand(legEnvironment);
        matrixBindings.push(legCommand.dispatch_binding);
        assert.deepEqual(
          legCommand.dispatch_binding,
          JSON.parse(row.dispatch_binding),
        );
        assert.deepEqual(Object.keys(legCommand.dispatch_binding).sort(), [
          "batch_count",
          "batch_index",
          "binding_digest",
          "candidate",
          "candidate_dispatch_authority_digest",
          "candidate_index",
          "candidate_inventory_authority_digest",
          "candidate_source",
          "cycle_id",
          "dispatch_digest",
          "generation_id",
          "inventory_digest",
          "repository",
          "reservation_digest",
          "reservation_record_oid",
          "schema",
          "schema_version",
        ]);
        assert.deepEqual(Object.keys(
          legCommand.dispatch_binding.candidate_source,
        ).sort(), [
          "candidate_set_digest",
          "lifecycle_candidate_set_digest",
          "production_candidate_authority_digest",
          "schema",
          "schema_version",
          "source_current_open_semantic_digest",
          "source_generation_digest",
          "source_generation_id",
          "source_generation_record_oid",
          "source_profile",
        ]);
        assert.deepEqual(Object.keys(
          legCommand.dispatch_binding.candidate,
        ).sort(), [
          "identity",
          "identity_digest",
          "lifecycle_generation_id",
          "lifecycle_seed",
          "lifecycle_seed_digest",
          "schema",
          "schema_version",
          "selection_digest",
          "source_generation_record_oid",
        ]);
        assert.ok(
          Buffer.byteLength(row.dispatch_binding, "utf8") <=
            MAX_V2_CURRENT_OPEN_CANDIDATE_DISPATCH_BINDING_BYTES,
        );
      }
      const firstBinding = matrixBindings[0];
      const commitBudget = calculateV2GitLedgerCandidateDispatchCommitBudget({
        candidate_count: matrixBindings.length,
        batch_count: firstBinding.batch_count,
        reachable_record_count: github.ledgerRecordCount() - 1,
      });
      const planWithoutDigest = {
        schema: V2_GIT_LEDGER_CANDIDATE_DISPATCH_PLAN_SCHEMA,
        schema_version: 2,
        repository: firstBinding.repository,
        generation_id: firstBinding.generation_id,
        cycle_id: firstBinding.cycle_id,
        candidate_source: firstBinding.candidate_source,
        candidate_inventory_authority_digest:
          firstBinding.candidate_inventory_authority_digest,
        candidate_dispatch_authority_digest:
          firstBinding.candidate_dispatch_authority_digest,
        reservation_record_oid: firstBinding.reservation_record_oid,
        reservation_digest: firstBinding.reservation_digest,
        inventory_digest: firstBinding.inventory_digest,
        batch_index: firstBinding.batch_index,
        batch_count: firstBinding.batch_count,
        dispatch_digest: firstBinding.dispatch_digest,
        items: matrixBindings.map((binding) => ({
          candidate_index: binding.candidate_index,
          candidate: binding.candidate,
        })),
        remaining_count: matrixBindings.length,
        dispatch_commit_budget_required:
          commitBudget.dispatch_commit_budget_required,
        candidate_execution_commit_budget_required:
          commitBudget.candidate_execution_commit_budget_required,
        total_commit_budget_required:
          commitBudget.total_commit_budget_required,
        remaining_ledger_commit_capacity_after_dispatch:
          commitBudget.remaining_ledger_commit_capacity_after_dispatch,
      };
      const compactPlan = {
        ...planWithoutDigest,
        plan_digest: ledgerDigestDomain(
          "codex-review-gate-v2-candidate-dispatch-plan",
          planWithoutDigest,
        ),
      };
      assert.ok(
        Buffer.byteLength(canonicalJson(compactPlan), "utf8") <=
          MAX_V2_CURRENT_OPEN_CANDIDATE_DISPATCH_PLAN_BYTES,
      );
      for (const [index, binding] of matrixBindings.entries()) {
        assert.deepEqual(
          projectV2GitLedgerCandidateDispatchBinding(compactPlan, index),
          binding,
        );
      }
      const publicWrites = github.externalWrites.length;
      const forgedPlan = {
        ...compactPlan,
        plan_digest: `sha256:${"0".repeat(64)}`,
      };
      assert.throws(
        () => projectV2GitLedgerCandidateDispatchBinding(forgedPlan, 0),
        (error) => error?.code === "CANDIDATE_DISPATCH_PLAN_INVALID",
      );
      for (const invalidIndex of [-1, 64, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(
          () => projectV2GitLedgerCandidateDispatchBinding(
            compactPlan,
            invalidIndex,
          ),
          (error) =>
            error?.code === "CANDIDATE_DISPATCH_PLAN_ITEM_INDEX_INVALID",
        );
      }
      assert.equal(github.externalWrites.length, publicWrites);
      const githubOutputLine = `matrix=${canonicalJson(dispatch.matrix)}\n`;
      assert.equal(await readFile(githubOutput, "utf8"), githubOutputLine);
      assert.ok(
        Buffer.byteLength(githubOutputLine, "utf16le") <=
          MAX_V2_SCHEDULE_DISPATCH_GITHUB_OUTPUT_UTF16_BYTES,
      );
      const oversizedRows = Array.from(
        { length: 4 },
        () => dispatch.matrix.include,
      ).flat();
      assert.equal(oversizedRows.length, 256);
      const oversizedLine = `matrix=${canonicalJson({
        include: oversizedRows,
      })}\n`;
      assert.ok(
        Buffer.byteLength(oversizedLine, "utf16le") >
          MAX_V2_SCHEDULE_DISPATCH_GITHUB_OUTPUT_UTF16_BYTES,
      );
      const oversizedOutput = join(
        runnerTemp,
        "oversized-compact-matrix-github-output",
      );
      const originalOutput = Buffer.from("sentinel=unchanged\n", "utf8");
      await writeFile(oversizedOutput, originalOutput, { mode: 0o600 });
      const ledgerWritesBeforeOversizedOutput =
        github.ledgerWriteRequests().length;
      await assert.rejects(
        writeV2ScheduleDispatchMatrixOutput({
          rows: oversizedRows,
          environment: { GITHUB_OUTPUT: oversizedOutput },
        }),
        (error) => error?.code === "SCHEDULE_DISPATCH_OUTPUT_TOO_LARGE",
      );
      assert.deepEqual(await readFile(oversizedOutput), originalOutput);
      assert.equal(
        github.ledgerWriteRequests().length,
        ledgerWritesBeforeOversizedOutput,
      );
      assertNoDispatchAuthorityInternals(dispatch);
    });
  });

test("schedule-dispatch hard-fails the 512-candidate capacity boundary without writes",
  async () => {
    await withWorkflowCliFixture({
      eventName: "schedule",
      event: {},
      route: "scan-all-open",
      pullRequest: "",
    }, async ({ environment, runnerTemp }) => {
      const initialCommand = await prepareV2WorkflowCommand(environment);
      const liveTime = new Date().toISOString();
      const oidc = productionOidcFixture(initialCommand, liveTime);
      const sharedEnvironment = {
        ...environment,
        ...oidc.environment,
        GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
        GITHUB_API_URL: "https://api.github.com",
      };
      const github = productionControllerGitHubFixture(
        initialCommand,
        oidc,
        liveTime,
        {
          candidateNumbers: [],
          apiOrigin: "https://api.github.com",
          serverTimeStepMilliseconds: 250,
        },
      );
      await runV2ScheduleDispatchCli(sharedEnvironment, {
        fetch: github.fetch,
      });
      github.setCandidateNumbers(Array.from(
        { length: 512 },
        (_, index) => index + 1,
      ));
      const externalWritesBefore = github.externalWriteRequests().length;
      const ledgerWritesBefore = github.ledgerWriteRequests().length;
      const recordsBefore = github.ledgerRecordCount();
      const currentOpenRequestsBefore =
        github.currentOpenCandidateRequests().length;
      const candidateInventoryRequestsBefore =
        github.candidateInventoryRequests().length;
      const candidateLifecycleRequestsBefore =
        github.candidateLifecycleRequests().length;
      const inventoryPhasesBefore = github.candidateInventoryPhases();
      const dispatchPhasesBefore = github.candidateDispatchPhases();
      const scheduleEnvironment = await makeWorkflowLegEnvironment({
        environment: sharedEnvironment,
        runnerTemp,
        name: "capacity-schedule",
        runId: "223457",
        route: "scan-all-open",
        pullRequest: "",
      });
      const scheduleCommand = await prepareV2WorkflowCommand(
        scheduleEnvironment,
      );
      oidc.bindCommand(scheduleCommand);

      await assert.rejects(
        runV2ScheduleDispatchCli(scheduleEnvironment, {
          fetch: github.fetch,
        }),
        (error) =>
          error?.code === "candidate-inventory-cycle-commit-capacity",
      );

      assert.equal(
        github.currentOpenCandidateRequests().length -
          currentOpenRequestsBefore,
        14,
      );
      assert.equal(
        github.candidateInventoryRequests().length -
          candidateInventoryRequestsBefore,
        0,
      );
      assert.equal(
        github.candidateLifecycleRequests().length -
          candidateLifecycleRequestsBefore,
        0,
      );
      assert.equal(github.ledgerRecordCount(), recordsBefore);
      assert.equal(
        github.externalWriteRequests().length - externalWritesBefore,
        0,
      );
      assert.equal(
        github.ledgerWriteRequests().length - ledgerWritesBefore,
        0,
      );
      assert.deepEqual(github.candidateInventoryPhases(), inventoryPhasesBefore);
      assert.deepEqual(github.candidateDispatchPhases(), dispatchPhasesBefore);
    });
  });

test("schedule-dispatch rejects 513 current-open candidates before full refresh",
  async () => {
    await withWorkflowCliFixture({
      eventName: "schedule",
      event: {},
      route: "scan-all-open",
      pullRequest: "",
    }, async ({ environment, runnerTemp }) => {
      const initialCommand = await prepareV2WorkflowCommand(environment);
      const liveTime = new Date().toISOString();
      const oidc = productionOidcFixture(initialCommand, liveTime);
      const sharedEnvironment = {
        ...environment,
        ...oidc.environment,
        GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
        GITHUB_API_URL: "https://api.github.com",
      };
      const github = productionControllerGitHubFixture(
        initialCommand,
        oidc,
        liveTime,
        {
          candidateNumbers: [],
          apiOrigin: "https://api.github.com",
          serverTimeStepMilliseconds: 250,
        },
      );
      await runV2ScheduleDispatchCli(sharedEnvironment, {
        fetch: github.fetch,
      });
      github.setCandidateNumbers(Array.from(
        { length: 513 },
        (_, index) => index + 1,
      ));
      const externalWritesBefore = github.externalWriteRequests().length;
      const ledgerWritesBefore = github.ledgerWriteRequests().length;
      const recordsBefore = github.ledgerRecordCount();
      const currentOpenRequestsBefore =
        github.currentOpenCandidateRequests().length;
      const candidateInventoryRequestsBefore =
        github.candidateInventoryRequests().length;
      const candidateLifecycleRequestsBefore =
        github.candidateLifecycleRequests().length;
      const inventoryPhasesBefore = github.candidateInventoryPhases();
      const dispatchPhasesBefore = github.candidateDispatchPhases();
      const scheduleEnvironment = await makeWorkflowLegEnvironment({
        environment: sharedEnvironment,
        runnerTemp,
        name: "candidate-cap-schedule",
        runId: "223458",
        route: "scan-all-open",
        pullRequest: "",
      });
      const scheduleCommand = await prepareV2WorkflowCommand(
        scheduleEnvironment,
      );
      oidc.bindCommand(scheduleCommand);

      await assert.rejects(
        runV2ScheduleDispatchCli(scheduleEnvironment, {
          fetch: github.fetch,
        }),
        (error) => error?.code === "CANDIDATE_OPEN_SET_CAP",
      );

      assert.equal(
        github.currentOpenCandidateRequests().length -
          currentOpenRequestsBefore,
        6,
      );
      assert.equal(
        github.candidateInventoryRequests().length -
          candidateInventoryRequestsBefore,
        0,
      );
      assert.equal(
        github.candidateLifecycleRequests().length -
          candidateLifecycleRequestsBefore,
        0,
      );
      assert.equal(github.ledgerRecordCount(), recordsBefore);
      assert.equal(
        github.externalWriteRequests().length - externalWritesBefore,
        0,
      );
      assert.equal(
        github.ledgerWriteRequests().length - ledgerWritesBefore,
        0,
      );
      assert.deepEqual(github.candidateInventoryPhases(), inventoryPhasesBefore);
      assert.deepEqual(github.candidateDispatchPhases(), dispatchPhasesBefore);
    });
  });

test("schedule-dispatch ignores a legacy phase fault on a fresh current-open restart", async () => {
  await withWorkflowCliFixture({
    eventName: "schedule",
    event: {},
    route: "scan-all-open",
    pullRequest: "",
  }, async ({ environment, runnerTemp }) => {
    const command = await prepareV2WorkflowCommand(environment);
    const liveTime = new Date().toISOString();
    const oidc = productionOidcFixture(command, liveTime);
    const sharedEnvironment = {
      ...environment,
      ...oidc.environment,
      GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
      GITHUB_API_URL: "https://api.github.com",
    };
    const github = productionControllerGitHubFixture(
      command,
      oidc,
      liveTime,
      {
        candidateNumbers: [7],
        apiOrigin: "https://api.github.com",
      },
    );
    github.failNextCandidatePhase(
      "candidate-inventory-observation",
      "shard",
    );
    const first = await runV2ScheduleDispatchCli(sharedEnvironment, {
      fetch: github.fetch,
    });
    assert.equal(first.matrix.include[0].pull_request, 7);
    assert.deepEqual(github.candidateInventoryPhases(), [
      "current-open-generation",
    ]);
    assert.deepEqual(github.candidateDispatchPhases(), ["reserve"]);
    const inventoryRequests = github.candidateInventoryRequests().length;
    const currentOpenRequests = github.currentOpenCandidateRequests().length;

    const restartEnvironment = await makeWorkflowLegEnvironment({
      environment: sharedEnvironment,
      runnerTemp,
      name: "incomplete-inventory-restart",
      runId: "123457",
      route: "scan-all-open",
      pullRequest: "",
    });
    const restartCommand = await prepareV2WorkflowCommand(
      restartEnvironment,
    );
    oidc.bindCommand(restartCommand);
    const restarted = await runV2ScheduleDispatchCli(restartEnvironment, {
      fetch: github.fetch,
    });

    assert.deepEqual(restarted.matrix, first.matrix);
    assert.deepEqual(github.candidateInventoryPhases(), [
      "current-open-generation",
    ]);
    assert.deepEqual(github.candidateDispatchPhases(), ["reserve"]);
    assert.equal(github.candidateInventoryRequests().length, inventoryRequests);
    assert.equal(
      github.currentOpenCandidateRequests().length,
      currentOpenRequests,
    );
    assert.equal(github.candidateLifecycleRequests().length, 0);
    assertNoDispatchAuthorityInternals(restarted);
  });
});

test("schedule-dispatch does not enter legacy close/reopen drift on a fresh current-open run",
  async () => {
    await withWorkflowCliFixture({
      eventName: "schedule",
      event: {},
      route: "scan-all-open",
      pullRequest: "",
    }, async ({ environment }) => {
      const command = await prepareV2WorkflowCommand(environment);
      const liveTime = new Date().toISOString();
      const oidc = productionOidcFixture(command, liveTime);
      const sharedEnvironment = {
        ...environment,
        ...oidc.environment,
        GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
        GITHUB_API_URL: "https://api.github.com",
      };
      const github = productionControllerGitHubFixture(
        command,
        oidc,
        liveTime,
        {
          candidateNumbers: [7],
          candidateLifecycleStates: ["open", "closed", "open", "open"],
          apiOrigin: "https://api.github.com",
        },
      );

      const result = await runV2ScheduleDispatchCli(sharedEnvironment, {
        fetch: github.fetch,
      });

      assert.equal(result.matrix.include[0].enabled, true);
      assert.equal(result.matrix.include[0].pull_request, 7);
      assert.deepEqual(github.candidateInventoryPhases(), [
        "current-open-generation",
      ]);
      assert.deepEqual(github.candidateInventoryRequests(), []);
      assert.deepEqual(github.candidateLifecycleRequests(), []);
      assert.deepEqual(github.candidateDispatchPhases(), ["reserve"]);
      assertNoDispatchAuthorityInternals(result);
    });
  });

test("schedule-dispatch ignores legacy drift snapshots on a fresh current-open run",
  async () => {
    await withWorkflowCliFixture({
      eventName: "schedule",
      event: {},
      route: "scan-all-open",
      pullRequest: "",
    }, async ({ environment }) => {
      const command = await prepareV2WorkflowCommand(environment);
      const liveTime = new Date().toISOString();
      const oidc = productionOidcFixture(command, liveTime);
      const github = productionControllerGitHubFixture(
        command,
        oidc,
        liveTime,
        {
          candidateNumbers: [7, 8],
          candidateInventorySnapshots: [
            [7], [7],
            [7, 8], [7, 8],
            [7], [7],
            [7], [7],
          ],
          apiOrigin: "https://api.github.com",
        },
      );

      const result = await runV2ScheduleDispatchCli({
        ...environment,
        ...oidc.environment,
        GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
        GITHUB_API_URL: "https://api.github.com",
      }, { fetch: github.fetch });

      assert.deepEqual(
        result.matrix.include.map(({ pull_request: pullRequest }) =>
          pullRequest),
        [7, 8],
      );
      assert.deepEqual(github.candidateInventoryPhases(), [
        "current-open-generation",
      ]);
      assert.equal(github.candidateInventoryRequests().length, 0);
      assert.equal(github.candidateLifecycleRequests().length, 0);
      assertNoDispatchAuthorityInternals(result);
    });
  });

test("schedule-dispatch does not enter bounded legacy lifecycle retries on a fresh current-open run",
  async () => {
    await withWorkflowCliFixture({
      eventName: "schedule",
      event: {},
      route: "scan-all-open",
      pullRequest: "",
    }, async ({ environment }) => {
      const command = await prepareV2WorkflowCommand(environment);
      const liveTime = new Date().toISOString();
      const oidc = productionOidcFixture(command, liveTime);
      const github = productionControllerGitHubFixture(
        command,
        oidc,
        liveTime,
        {
          candidateNumbers: [7],
          candidateLifecycleStates: Array.from(
            { length: MAX_V2_CANDIDATE_SCAN_PASSES },
            () => ["open", "closed"],
          ).flat(),
          apiOrigin: "https://api.github.com",
        },
      );

      const result = await runV2ScheduleDispatchCli({
          ...environment,
          ...oidc.environment,
          GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
          GITHUB_API_URL: "https://api.github.com",
        }, { fetch: github.fetch });
      assert.equal(result.matrix.include[0].pull_request, 7);
      assert.deepEqual(github.candidateInventoryPhases(), [
        "current-open-generation",
      ]);
      assert.deepEqual(github.candidateInventoryRequests(), []);
      assert.deepEqual(github.candidateLifecycleRequests(), []);
      assert.deepEqual(github.candidateDispatchPhases(), ["reserve"]);
      assertNoDispatchAuthorityInternals(result);
    });
  });

test("schedule-dispatch retries an unapplied atomic reservation with a fresh current-open scan", async () => {
  await withWorkflowCliFixture({
    eventName: "schedule",
    event: {},
    route: "scan-all-open",
    pullRequest: "",
  }, async ({ environment, runnerTemp }) => {
    const command = await prepareV2WorkflowCommand(environment);
    const liveTime = new Date().toISOString();
    const oidc = productionOidcFixture(command, liveTime);
    const sharedEnvironment = {
      ...environment,
      ...oidc.environment,
      GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
      GITHUB_API_URL: "https://api.github.com",
    };
    const github = productionControllerGitHubFixture(
      command,
      oidc,
      liveTime,
      {
        candidateNumbers: [7],
        apiOrigin: "https://api.github.com",
      },
    );
    github.failNextCandidatePhase(
      "candidate-dispatch-observation",
      "reserve",
    );
    await assert.rejects(
      runV2ScheduleDispatchCli(sharedEnvironment, { fetch: github.fetch }),
    );
    assert.deepEqual(github.candidateInventoryPhases(), []);
    assert.deepEqual(github.candidateDispatchPhases(), []);
    const inventoryRequests = github.candidateInventoryRequests().length;
    const currentOpenRequests = github.currentOpenCandidateRequests().length;

    const restartEnvironment = await makeWorkflowLegEnvironment({
      environment: sharedEnvironment,
      runnerTemp,
      name: "completed-inventory-restart",
      runId: "123457",
      route: "scan-all-open",
      pullRequest: "",
    });
    const restartCommand = await prepareV2WorkflowCommand(
      restartEnvironment,
    );
    oidc.bindCommand(restartCommand);
    const restarted = await runV2ScheduleDispatchCli(restartEnvironment, {
      fetch: github.fetch,
    });

    assert.equal(restarted.matrix.include[0].enabled, true);
    assert.equal(restarted.matrix.include[0].pull_request, 7);
    assert.equal(
      github.candidateInventoryRequests().length,
      inventoryRequests,
      "current-open retry must not fall back to legacy inventory",
    );
    assert.equal(
      github.currentOpenCandidateRequests().length - currentOpenRequests,
      4,
      "an unapplied atomic publication must collect fresh current-open authority",
    );
    assert.deepEqual(github.candidateInventoryPhases(), [
      "current-open-generation",
    ]);
    assert.deepEqual(github.candidateDispatchPhases(), ["reserve"]);
    assertNoDispatchAuthorityInternals(restarted);
  });
});

test("schedule-dispatch publishes the exact one-row disabled sentinel for an empty cycle", async () => {
  await withWorkflowCliFixture({
    eventName: "schedule",
    event: {},
    route: "scan-all-open",
    pullRequest: "",
  }, async ({ root, runnerTemp, environment }) => {
    const githubOutput = join(root, "github-output-empty");
    await writeFile(githubOutput, "", { mode: 0o600 });
    const command = await prepareV2WorkflowCommand(environment);
    const liveTime = new Date().toISOString();
    const oidc = productionOidcFixture(command, liveTime);
    const selectedEnvironment = {
      ...environment,
      ...oidc.environment,
      GITHUB_OUTPUT: githubOutput,
      GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
      GITHUB_API_URL: "https://api.github.com",
    };
    const github = productionControllerGitHubFixture(
      command,
      oidc,
      liveTime,
      {
        candidateNumbers: [],
        apiOrigin: "https://api.github.com",
      },
    );
    const firstCurrentOpenRequestsBefore =
      github.currentOpenCandidateRequests().length;
    const firstCandidateInventoryRequestsBefore =
      github.candidateInventoryRequests().length;
    const firstCandidateLifecycleRequestsBefore =
      github.candidateLifecycleRequests().length;
    await runV2ScheduleDispatchCli(selectedEnvironment, {
      fetch: github.fetch,
    });
    assert.equal(
      github.currentOpenCandidateRequests().length -
        firstCurrentOpenRequestsBefore,
      4,
    );
    assert.equal(
      github.candidateInventoryRequests().length -
        firstCandidateInventoryRequestsBefore,
      0,
      "fresh empty current-open authority must not use legacy full inventory REST",
    );
    assert.equal(
      github.candidateLifecycleRequests().length -
        firstCandidateLifecycleRequestsBefore,
      0,
      "fresh empty current-open authority must not read legacy lifecycle REST",
    );
    const currentOpenRequestsBefore =
      github.currentOpenCandidateRequests().length;
    const candidateInventoryRequestsBefore =
      github.candidateInventoryRequests().length;
    const externalWritesBefore = github.externalWriteRequests().length;
    const ledgerWritesBefore = github.ledgerWriteRequests().length;
    const inventoryPhasesBefore = github.candidateInventoryPhases();
    const dispatchPhasesBefore = github.candidateDispatchPhases();
    assert.deepEqual(inventoryPhasesBefore, ["current-open-generation"]);
    assert.deepEqual(dispatchPhasesBefore, ["cycle-complete"]);
    const restartOutput = join(root, "github-output-empty-restart");
    await writeFile(restartOutput, "", { mode: 0o600 });
    const restartEnvironment = await makeWorkflowLegEnvironment({
      environment: selectedEnvironment,
      runnerTemp,
      name: "empty-restart",
      runId: "123457",
      route: "scan-all-open",
      pullRequest: "",
      githubOutput: restartOutput,
    });
    const restartCommand = await prepareV2WorkflowCommand(restartEnvironment);
    oidc.bindCommand(restartCommand);
    const result = await runV2ScheduleDispatchCli(restartEnvironment, {
      fetch: github.fetch,
    });
    assert.deepEqual(result.matrix, {
      include: [{
        enabled: false,
        pull_request: 0,
        dispatch_binding: "null",
      }],
    });
    const expected = canonicalJson(result.matrix);
    assert.equal(result.rendered, `${expected}\n`);
    assert.equal(await readFile(restartOutput, "utf8"), `matrix=${expected}\n`);
    assert.equal((await readFile(restartOutput, "utf8")).split("\n").length, 2);
    assert.deepEqual(
      github.candidateInventoryPhases(),
      inventoryPhasesBefore,
    );
    assert.deepEqual(github.candidateDispatchPhases(), dispatchPhasesBefore);
    assert.equal(
      github.currentOpenCandidateRequests().length - currentOpenRequestsBefore,
      4,
    );
    assert.equal(
      github.candidateInventoryRequests().length -
        candidateInventoryRequestsBefore,
      0,
    );
    assert.equal(
      github.externalWriteRequests().length - externalWritesBefore,
      0,
    );
    assert.equal(
      github.ledgerWriteRequests().length - ledgerWritesBefore,
      0,
    );
    assertNoDispatchAuthorityInternals(result);
  });
});

test("scheduled production run acknowledges its exact matrix binding through cycle completion", async () => {
  await withWorkflowCliFixture({
    eventName: "schedule",
    event: {},
    route: "scan-all-open",
    pullRequest: "",
  }, async ({ environment, runnerTemp }) => {
    const scanCommand = await prepareV2WorkflowCommand(environment);
    const liveTime = new Date().toISOString();
    const oidc = productionOidcFixture(scanCommand, liveTime);
    const sharedEnvironment = {
      ...environment,
      ...oidc.environment,
      GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
      GITHUB_API_URL: "https://api.github.com",
    };
    const github = productionControllerGitHubFixture(
      scanCommand,
      oidc,
      liveTime,
      {
        candidateNumbers: [7],
        apiOrigin: "https://api.github.com",
      },
    );
    const dispatch = await runV2ScheduleDispatchCli(sharedEnvironment, {
      fetch: github.fetch,
    });
    const [matrixRow] = dispatch.matrix.include;
    assert.equal(matrixRow.enabled, true);
    const scheduledCurrentOpenRequestsBefore =
      github.currentOpenCandidateRequests().length;
    const scheduledInventoryRequestsBefore =
      github.candidateInventoryRequests().length;

    const scheduledEnvironment = await makeWorkflowLegEnvironment({
      environment: sharedEnvironment,
      runnerTemp,
      name: "scheduled-pr-7",
      runId: "123457",
      route: "ordinary",
      pullRequest: "7",
      dispatchBinding: matrixRow.dispatch_binding,
    });
    const scheduledCommand = await prepareV2WorkflowCommand(
      scheduledEnvironment,
    );
    oidc.bindCommand(scheduledCommand);
    const result = await runV2WorkflowControllerCli(scheduledEnvironment, {
      fetch: github.fetch,
    });

    assert.deepEqual(
      scheduledCommand.dispatch_binding,
      JSON.parse(matrixRow.dispatch_binding),
    );
    assert.equal(result.cycle.terminal_result.public_effects_performed, 3);
    assert.equal(result.cycle.terminal_result.status_effect_outcome, "bound");
    assert.equal(
      result.cycle.terminal_result.automatic_request_effect_outcome,
      "bound",
    );
    assert.equal(github.activeLease(), false);
    assert.equal(
      github.currentOpenCandidateRequests().length,
      scheduledCurrentOpenRequestsBefore,
      "scheduled execution must reuse its durable dispatch authority",
    );
    assert.equal(
      github.candidateInventoryRequests().length,
      scheduledInventoryRequestsBefore,
      "scheduled execution must not refresh legacy inventory",
    );
    assert.deepEqual(github.candidateDispatchPhases(), [
      "reserve",
      "candidate-ack",
      "batch-complete",
      "cycle-complete",
    ]);
    assert.deepEqual(github.candidateProtocolOrder(), [
      "candidate-dispatch:reserve",
      "lease-acquire:",
      "effect-intent:scheduler-observation",
      "effect-intent:status-write",
      "effect-response:status-write",
      "effect-intent:automatic-request-reservation",
      "effect-intent:reservation-status-write",
      "effect-response:reservation-status-write",
      "effect-intent:effect-attempt",
      "effect-intent:review-request",
      "effect-response:review-request",
      "effect-intent:request-binding",
      "effect-response:request-binding",
      "lease-release:",
      "candidate-dispatch:candidate-ack",
      "candidate-dispatch:batch-complete",
      "candidate-dispatch:cycle-complete",
    ]);
    assert.equal(
      JSON.stringify(result.cycle).includes("candidate_dispatch_handle"),
      false,
    );
    assert.equal(
      JSON.stringify(result.cycle).includes("candidate_dispatch_result_handle"),
      false,
    );
    assertFixtureServerClockWithinOidcSkew(github);
  });
});

test("scheduled production consumes two immutable matrix bindings across restart and final ack response loss", async () => {
  await withWorkflowCliFixture({
    eventName: "schedule",
    event: {},
    route: "scan-all-open",
    pullRequest: "",
  }, async ({ environment, runnerTemp }) => {
    const scanCommand = await prepareV2WorkflowCommand(environment);
    const liveTime = new Date().toISOString();
    const oidc = productionOidcFixture(scanCommand, liveTime);
    const sharedEnvironment = {
      ...environment,
      ...oidc.environment,
      GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
      GITHUB_API_URL: "https://api.github.com",
    };
    const github = productionControllerGitHubFixture(
      scanCommand,
      oidc,
      liveTime,
      {
        candidateNumbers: [7, 8],
        apiOrigin: "https://api.github.com",
        serverTimeStepMilliseconds: 500,
      },
    );
    const dispatch = await runV2ScheduleDispatchCli(sharedEnvironment, {
      fetch: github.fetch,
    });
    assert.deepEqual(
      dispatch.matrix.include.map((row) => row.pull_request),
      [7, 8],
    );
    const originalBindings = dispatch.matrix.include.map((row) =>
      JSON.parse(row.dispatch_binding));
    assert.equal(
      new Set(originalBindings.map((binding) =>
        binding.candidate_dispatch_authority_digest)).size,
      1,
      "one reservation must keep one immutable D1 matrix authority",
    );

    const runScheduledCandidate = async (index, { expectFailure = false } = {}) => {
      const row = dispatch.matrix.include[index];
      const scheduledEnvironment = await makeWorkflowLegEnvironment({
        environment: sharedEnvironment,
        runnerTemp,
        name: `scheduled-two-candidate-${row.pull_request}`,
        runId: String(123_457 + index),
        route: "ordinary",
        pullRequest: String(row.pull_request),
        dispatchBinding: row.dispatch_binding,
      });
      const scheduledCommand = await prepareV2WorkflowCommand(
        scheduledEnvironment,
      );
      oidc.bindCommand(scheduledCommand);
      const invocation = runV2WorkflowControllerCli(scheduledEnvironment, {
        fetch: github.fetch,
      });
      if (expectFailure) {
        await assert.rejects(invocation, (error) => {
          assert.equal(error?.code, "CANDIDATE_DISPATCH_COMPLETION_FAILED");
          assert.equal(error?.details?.upstream_code, "unexpected-http-status");
          assert.equal(error?.details?.public_effects_performed, 3);
          assert.equal(error?.details?.budget_refunded, false);
          assert.equal(error?.details?.lease_released, true);
          return true;
        });
        return null;
      }
      const result = await invocation;
      assert.deepEqual(scheduledCommand.dispatch_binding, originalBindings[index]);
      assert.equal(result.cycle.terminal_result.public_effects_performed, 3);
      assert.equal(result.cycle.terminal_result.status_effect_outcome, "bound");
      assert.equal(
        result.cycle.terminal_result.automatic_request_effect_outcome,
        "bound",
      );
      assertNoProtectedProductionInternals(result.cycle);
      return result;
    };

    await runScheduledCandidate(0);
    assert.equal(github.activeLease(), false);
    assert.deepEqual(github.candidateDispatchPhases(), [
      "reserve",
      "candidate-ack",
    ]);
    const currentOpenRequestsAfterFirst =
      github.currentOpenCandidateRequests().length;
    const legacyInventoryRequestsAfterFirst =
      github.candidateInventoryRequests().length;
    const legacyLifecycleRequestsAfterFirst =
      github.candidateLifecycleRequests().length;
    const ledgerWritesAfterFirst = github.ledgerWriteRequests().length;

    const remainingEnvironment = await makeWorkflowLegEnvironment({
      environment: sharedEnvironment,
      runnerTemp,
      name: "scheduled-two-candidate-remaining-restart",
      runId: "123459",
      route: "scan-all-open",
      pullRequest: "",
    });
    const remainingCommand = await prepareV2WorkflowCommand(
      remainingEnvironment,
    );
    oidc.bindCommand(remainingCommand);
    const remaining = await runV2ScheduleDispatchCli(remainingEnvironment, {
      fetch: github.fetch,
    });
    assert.deepEqual(remaining.matrix.include, [dispatch.matrix.include[1]]);
    assert.equal(
      github.currentOpenCandidateRequests().length,
      currentOpenRequestsAfterFirst,
    );
    assert.equal(
      github.candidateInventoryRequests().length,
      legacyInventoryRequestsAfterFirst,
    );
    assert.equal(
      github.candidateLifecycleRequests().length,
      legacyLifecycleRequestsAfterFirst,
    );
    assert.equal(
      github.ledgerWriteRequests().length,
      ledgerWritesAfterFirst,
      "remaining-plan restart must be a read-only durable reload",
    );
    assertNoDispatchAuthorityInternals(remaining);

    github.failNextDurableRecordUpdates("candidate-dispatch-observation:");
    await runScheduledCandidate(1, { expectFailure: true });

    assert.equal(github.activeLease(), false);
    assert.deepEqual(github.candidateDispatchPhases(), [
      "reserve",
      "candidate-ack",
      "candidate-ack",
    ]);
    assert.equal(
      github.currentOpenCandidateRequests().length,
      currentOpenRequestsAfterFirst,
      "restart must load the durable reservation before any fresh scan",
    );
    assert.equal(
      github.candidateInventoryRequests().length,
      legacyInventoryRequestsAfterFirst,
      "current-open scheduled execution must not use legacy inventory",
    );
    const completionEnvironment = await makeWorkflowLegEnvironment({
      environment: sharedEnvironment,
      runnerTemp,
      name: "scheduled-two-candidate-completion-restart",
      runId: "123460",
      route: "scan-all-open",
      pullRequest: "",
    });
    const completionCommand = await prepareV2WorkflowCommand(
      completionEnvironment,
    );
    oidc.bindCommand(completionCommand);
    const completed = await runV2ScheduleDispatchCli(completionEnvironment, {
      fetch: github.fetch,
    });
    assert.deepEqual(completed.matrix, {
      include: [{
        enabled: false,
        pull_request: 0,
        dispatch_binding: "null",
      }],
    });
    assert.equal(
      github.currentOpenCandidateRequests().length,
      currentOpenRequestsAfterFirst,
      "completion restart must not resample current-open candidates",
    );
    assert.equal(
      github.candidateInventoryRequests().length,
      legacyInventoryRequestsAfterFirst,
      "completion restart must not use legacy inventory",
    );
    assertNoDispatchAuthorityInternals(completed);
    assert.deepEqual(github.candidateDispatchPhases(), [
      "reserve",
      "candidate-ack",
      "candidate-ack",
      "batch-complete",
      "cycle-complete",
    ]);
    assert.equal(
      github.candidateProtocolOrder().filter((entry) =>
        entry === "candidate-dispatch:candidate-ack").length,
      2,
    );
    assert.deepEqual(
      github.requestComments().map((comment) =>
        new URL(comment.issue_url).pathname),
      [
        "/repos/owner/repo/issues/7",
        "/repos/owner/repo/issues/8",
      ],
    );
    assertFixtureServerClockWithinOidcSkew(github);
  });
});

test("an intervening candidate scan preserves a queued artifact suffix after ready response loss",
  async () => {
    await withWorkflowCliFixture({
      eventName: "schedule",
      event: {},
      route: "scan-all-open",
      pullRequest: "",
    }, async ({ environment, runnerTemp }) => {
      const scanCommand = await prepareV2WorkflowCommand(environment);
      const liveTime = new Date().toISOString();
      const oidc = productionOidcFixture(scanCommand, liveTime);
      const sharedEnvironment = {
        ...environment,
        ...oidc.environment,
        GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
        GITHUB_API_URL: "https://api.github.com",
      };
      const github = productionControllerGitHubFixture(
        scanCommand,
        oidc,
        liveTime,
        {
          candidateNumbers: [7],
          apiOrigin: "https://api.github.com",
          serverTimeStepMilliseconds: 500,
        },
      );
      const firstDispatch = await runV2ScheduleDispatchCli(
        sharedEnvironment,
        { fetch: github.fetch },
      );
      const firstScheduledEnvironment = await makeWorkflowLegEnvironment({
        environment: sharedEnvironment,
        runnerTemp,
        name: "scheduled-queue-initial-request",
        runId: "123471",
        route: "ordinary",
        pullRequest: "7",
        dispatchBinding:
          firstDispatch.matrix.include[0].dispatch_binding,
      });
      const firstScheduledCommand = await prepareV2WorkflowCommand(
        firstScheduledEnvironment,
      );
      oidc.bindCommand(firstScheduledCommand);
      await runV2WorkflowControllerCli(firstScheduledEnvironment, {
        fetch: github.fetch,
      });
      const request = github.requestComments().at(-1);
      assert.ok(request, "scheduled automatic request exists");
      assert.deepEqual(
        github.candidateDispatchPhases(),
        ["reserve", "candidate-ack", "batch-complete", "cycle-complete"],
      );
      const completedDispatchRecords = github.candidateDispatchRecords();
      assert.equal(github.activeLease(), false);
      const addFinding = (id) => {
        const finding = productionAutomaticRecoveryFinding({ id, request });
        const address = productionAutomaticRecoveryAddress({
          id: id + 1,
          finding,
        });
        github.addSnapshotIssueComments(finding, address);
      };
      const artifactBindingFamilyEntries = () =>
        github.effectRecordEntries().filter(({ record }) =>
          typeof record.kind === "string" &&
          record.kind.includes("artifact-binding"));
      const assertCanonicalArtifactBindingFamily = (entries) => {
        const canonicalKinds = new Set([
          "artifact-binding",
          "artifact-binding-ready",
        ]);
        assert.equal(
          entries.some(({ record }) => !canonicalKinds.has(record.kind)),
          false,
          "artifact binding family must not contain a noncanonical sibling",
        );
      };

      addFinding(3180);
      github.failNextDurableRecordUpdates(
        "effect-response:artifact-binding-ready",
      );
      const ordinaryEventPath = join(
        runnerTemp,
        "scheduled-queue-ordinary-event.json",
      );
      await writeFile(ordinaryEventPath, JSON.stringify({
        pull_request: { number: 7 },
      }), { mode: 0o600 });
      const prefixEnvironment = await makeWorkflowLegEnvironment({
        environment: sharedEnvironment,
        runnerTemp,
        name: "scheduled-queue-prefix",
        runId: "123472",
        route: "ordinary",
        pullRequest: "7",
      });
      prefixEnvironment.GITHUB_EVENT_NAME = "pull_request_target";
      prefixEnvironment.V2_CONTROLLER_EVENT_PATH = ordinaryEventPath;
      const prefixCommand = await prepareV2WorkflowCommand(prefixEnvironment);
      oidc.bindCommand(prefixCommand);
      await assert.rejects(
        runV2WorkflowControllerCli(prefixEnvironment, {
          fetch: github.fetch,
        }),
        (error) => error?.code === "INITIAL_OBSERVATION_ABORTED",
      );
      const artifactPrefixEntries = artifactBindingFamilyEntries();
      assertCanonicalArtifactBindingFamily(artifactPrefixEntries);
      assert.deepEqual(
        artifactPrefixEntries.map(({ record }) =>
          `${record.record_type}:${record.kind}`),
        [
          "effect-intent:artifact-binding",
          "effect-intent:artifact-binding-ready",
          "effect-response:artifact-binding-ready",
        ],
      );
      assert.equal(
        new Set(artifactPrefixEntries.map(({ commit_sha: commitSha }) =>
          commitSha)).size,
        3,
      );
      for (const { commit_sha: commitSha } of artifactPrefixEntries) {
        assert.match(commitSha, /^[0-9a-f]{40}$/u);
      }
      assert.deepEqual(
        github.artifactBindingPointReadRequests(),
        [],
        "the durable ready prefix must precede every provider point read",
      );
      assert.deepEqual(
        github.candidateDispatchRecords(),
        completedDispatchRecords,
        "artifact prefix persistence must not rewrite completed candidate records",
      );
      addFinding(3200);

      const dispatchRecordsBeforeInterveningScan =
        github.candidateDispatchRecords();
      const publicWritesBeforeInterveningScan = github.externalWrites.length;
      const pointReadsBeforeInterveningScan =
        github.artifactBindingPointReadRequests();

      const secondScanEnvironment = await makeWorkflowLegEnvironment({
        environment: sharedEnvironment,
        runnerTemp,
        name: "scheduled-queue-second-scan",
        runId: "123473",
        route: "scan-all-open",
        pullRequest: "",
      });
      const secondScanCommand = await prepareV2WorkflowCommand(
        secondScanEnvironment,
      );
      oidc.bindCommand(secondScanCommand);
      const secondDispatch = await runV2ScheduleDispatchCli(
        secondScanEnvironment,
        { fetch: github.fetch },
      );
      assert.deepEqual(secondDispatch.matrix, {
        include: [{
          enabled: false,
          pull_request: 0,
          dispatch_binding: "null",
        }],
      });
      assert.equal(
        github.externalWrites.length,
        publicWritesBeforeInterveningScan,
      );
      assert.deepEqual(
        github.artifactBindingPointReadRequests(),
        pointReadsBeforeInterveningScan,
      );
      const artifactEntriesAfterInterveningScan =
        artifactBindingFamilyEntries();
      assertCanonicalArtifactBindingFamily(
        artifactEntriesAfterInterveningScan,
      );
      assert.deepEqual(
        artifactEntriesAfterInterveningScan,
        artifactPrefixEntries,
        "intervening scan must not append, replace, or reorder artifact records",
      );
      assert.deepEqual(
        github.candidateDispatchRecords(),
        dispatchRecordsBeforeInterveningScan,
        "intervening scan must not reuse candidate phases as new recovery evidence",
      );
      const dispatchRecordsAfterInterveningScan =
        github.candidateDispatchRecords();
      const secondOrdinaryEnvironment = await makeWorkflowLegEnvironment({
        environment: secondScanEnvironment,
        runnerTemp,
        name: "scheduled-queue-close",
        runId: "123474",
        route: "ordinary",
        pullRequest: "7",
      });
      secondOrdinaryEnvironment.GITHUB_EVENT_NAME = "pull_request_target";
      secondOrdinaryEnvironment.V2_CONTROLLER_EVENT_PATH = ordinaryEventPath;
      const secondOrdinaryCommand = await prepareV2WorkflowCommand(
        secondOrdinaryEnvironment,
      );
      oidc.bindCommand(secondOrdinaryCommand);
      const result = await runV2WorkflowControllerCli(
        secondOrdinaryEnvironment,
        { fetch: github.fetch },
      );

      const finalArtifactEntries = artifactBindingFamilyEntries();
      assertCanonicalArtifactBindingFamily(finalArtifactEntries);
      assert.deepEqual(
        finalArtifactEntries.map(({ record }) =>
          `${record.record_type}:${record.kind}`),
        [
          "effect-intent:artifact-binding",
          "effect-intent:artifact-binding-ready",
          "effect-response:artifact-binding-ready",
          "effect-intent:artifact-binding",
          "effect-response:artifact-binding",
          "effect-intent:artifact-binding-ready",
          "effect-response:artifact-binding-ready",
          "effect-response:artifact-binding",
        ],
      );
      assert.deepEqual(
        finalArtifactEntries.slice(0, artifactPrefixEntries.length),
        artifactPrefixEntries,
        "ordinary continuation must retain the exact durable prefix",
      );
      const finalArtifactOids = finalArtifactEntries.map(
        ({ commit_sha: commitSha }) => commitSha,
      );
      assert.equal(new Set(finalArtifactOids).size, 8);
      const prefixArtifactOids = new Set(
        artifactPrefixEntries.map(({ commit_sha: commitSha }) => commitSha),
      );
      for (const commitSha of finalArtifactOids.slice(
        artifactPrefixEntries.length,
      )) {
        assert.match(commitSha, /^[0-9a-f]{40}$/u);
        assert.equal(prefixArtifactOids.has(commitSha), false);
      }
      assert.deepEqual(
        github.artifactBindingPointReadRequests(),
        [3180, 3200].map((id) =>
          `/repos/owner/repo/issues/comments/${id}`),
      );
      assert.deepEqual(
        github.candidateDispatchRecords(),
        dispatchRecordsAfterInterveningScan,
        "ordinary artifact continuation must not rewrite candidate records",
      );
      assert.equal(github.activeLease(), false);
      assertNoProtectedProductionInternals(result.cycle);
      assertFixtureServerClockWithinOidcSkew(github);
    });
  });

test("every scheduled dispatch binding field rejects tampering before lease or effect", async () => {
  await withWorkflowCliFixture({
    eventName: "schedule",
    event: {},
    route: "scan-all-open",
    pullRequest: "",
  }, async ({ environment, runnerTemp }) => {
    const scanCommand = await prepareV2WorkflowCommand(environment);
    const liveTime = new Date().toISOString();
    const oidc = productionOidcFixture(scanCommand, liveTime);
    const sharedEnvironment = {
      ...environment,
      ...oidc.environment,
      GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
      GITHUB_API_URL: "https://api.github.com",
    };
    const github = productionControllerGitHubFixture(
      scanCommand,
      oidc,
      liveTime,
      {
        candidateNumbers: [7],
        apiOrigin: "https://api.github.com",
      },
    );
    const dispatch = await runV2ScheduleDispatchCli(sharedEnvironment, {
      fetch: github.fetch,
    });
    const validBinding = JSON.parse(
      dispatch.matrix.include[0].dispatch_binding,
    );
    const baselineRecords = github.ledgerRecordCount();

    for (const [index, selected] of
      scheduleDispatchBindingTamperCases(validBinding).entries()) {
      const selectedEnvironment = await makeWorkflowLegEnvironment({
        environment: sharedEnvironment,
        runnerTemp,
        name: `tamper-${index}`,
        runId: String(123500 + index),
        route: "ordinary",
        pullRequest: "7",
        dispatchBinding: canonicalJson(selected.binding),
      });
      await assert.rejects(async () => {
        const command = await prepareV2WorkflowCommand(selectedEnvironment);
        oidc.bindCommand(command);
        await runV2WorkflowControllerCli(selectedEnvironment, {
          fetch: github.fetch,
        });
      }, undefined, selected.name);
      assert.equal(
        github.ledgerRecordCount(),
        baselineRecords,
        `${selected.name} reached a protected-ledger write`,
      );
      assert.equal(
        github.activeLease(),
        false,
        `${selected.name} acquired a production lease`,
      );
      assert.deepEqual(
        github.externalWrites,
        [],
        `${selected.name} reached a public effect`,
      );
    }
  });
});

test("scheduled completion uses same-run recovery after a durable lease release", async () => {
  await withWorkflowCliFixture({
    eventName: "schedule",
    event: {},
    route: "scan-all-open",
    pullRequest: "",
  }, async ({ environment, runnerTemp }) => {
    const scanCommand = await prepareV2WorkflowCommand(environment);
    const liveTime = new Date().toISOString();
    const oidc = productionOidcFixture(scanCommand, liveTime);
    const sharedEnvironment = {
      ...environment,
      ...oidc.environment,
      GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
      GITHUB_API_URL: "https://api.github.com",
    };
    const github = productionControllerGitHubFixture(
      scanCommand,
      oidc,
      liveTime,
      {
        candidateNumbers: [7],
        apiOrigin: "https://api.github.com",
      },
    );
    const dispatch = await runV2ScheduleDispatchCli(sharedEnvironment, {
      fetch: github.fetch,
    });
    github.failNextRecordUpdates("candidate-dispatch-observation:");
    const scheduledEnvironment = await makeWorkflowLegEnvironment({
      environment: sharedEnvironment,
      runnerTemp,
      name: "same-run-recovery",
      runId: "123457",
      route: "ordinary",
      pullRequest: "7",
      dispatchBinding: dispatch.matrix.include[0].dispatch_binding,
    });
    const scheduledCommand = await prepareV2WorkflowCommand(
      scheduledEnvironment,
    );
    oidc.bindCommand(scheduledCommand);
    const result = await runV2WorkflowControllerCli(scheduledEnvironment, {
      fetch: github.fetch,
    });

    assert.equal(result.cycle.terminal_result.public_effects_performed, 3);
    assert.equal(github.activeLease(), false);
    assert.deepEqual(github.candidateDispatchPhases(), [
      "reserve",
      "candidate-ack",
      "batch-complete",
      "cycle-complete",
    ]);
    assert.equal(
      github.candidateProtocolOrder().filter((entry) =>
        entry === "candidate-dispatch:candidate-ack").length,
      1,
    );
    assertFixtureServerClockWithinOidcSkew(github);
  });
});

test("schedule-dispatch recovers one ready released attempt without a fresh candidate scan", async () => {
  await withWorkflowCliFixture({
    eventName: "schedule",
    event: {},
    route: "scan-all-open",
    pullRequest: "",
  }, async ({ environment, runnerTemp }) => {
    const scanCommand = await prepareV2WorkflowCommand(environment);
    const liveTime = new Date().toISOString();
    const oidc = productionOidcFixture(scanCommand, liveTime);
    const sharedEnvironment = {
      ...environment,
      ...oidc.environment,
      GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
      GITHUB_API_URL: "https://api.github.com",
    };
    const github = productionControllerGitHubFixture(
      scanCommand,
      oidc,
      liveTime,
      {
        candidateNumbers: [7],
        apiOrigin: "https://api.github.com",
      },
    );
    const dispatch = await runV2ScheduleDispatchCli(sharedEnvironment, {
      fetch: github.fetch,
    });
    github.failNextRecordUpdates(
      "candidate-dispatch-observation:",
      "candidate-dispatch-observation:",
    );
    const scheduledEnvironment = await makeWorkflowLegEnvironment({
      environment: sharedEnvironment,
      runnerTemp,
      name: "released-unacknowledged",
      runId: "123457",
      route: "ordinary",
      pullRequest: "7",
      dispatchBinding: dispatch.matrix.include[0].dispatch_binding,
    });
    const scheduledCommand = await prepareV2WorkflowCommand(
      scheduledEnvironment,
    );
    assert.deepEqual(
      scheduledCommand.dispatch_binding,
      JSON.parse(dispatch.matrix.include[0].dispatch_binding),
    );
    oidc.bindCommand(scheduledCommand);
    await assert.rejects(
      runV2WorkflowControllerCli(scheduledEnvironment, {
        fetch: github.fetch,
      }),
      (error) => error?.code === "CANDIDATE_DISPATCH_COMPLETION_FAILED",
    );
    assert.ok(
      github.requestComments().at(-1),
      "the failed scheduled attempt must have performed its public request",
    );
    assert.equal(github.activeLease(), false);
    assert.deepEqual(github.candidateDispatchPhases(), ["reserve"]);
    const releasedAttemptProtocol = github.candidateProtocolOrder();
    assert.equal(
      releasedAttemptProtocol.filter((entry) =>
        entry === "lease-acquire:").length,
      1,
    );
    assert.equal(
      releasedAttemptProtocol.filter((entry) =>
        entry === "lease-release:").length,
      1,
    );
    assert.equal(releasedAttemptProtocol.at(-1), "lease-release:");
    const dispatchRecordsBeforeRecovery = github.candidateDispatchRecords();
    assert.equal(
      dispatchRecordsBeforeRecovery.filter(({ phase }) =>
        phase === "candidate-ack").length,
      0,
    );
    const inventoryRequests = github.candidateInventoryRequests().length;
    const lifecycleRequests = github.candidateLifecycleRequests().length;
    const currentOpenRequests = github.currentOpenCandidateRequests().length;
    const publicWrites = github.externalWrites.length;
    const pointReads = github.artifactBindingPointReadRequests();

    const recoveryEnvironment = await makeWorkflowLegEnvironment({
      environment: sharedEnvironment,
      runnerTemp,
      name: "ready-recovery-scan",
      runId: "123458",
      route: "scan-all-open",
      pullRequest: "",
    });
    const recoveryCommand = await prepareV2WorkflowCommand(
      recoveryEnvironment,
    );
    oidc.bindCommand(recoveryCommand);
    const recovered = await runV2ScheduleDispatchCli(recoveryEnvironment, {
      fetch: github.fetch,
    });

    assert.deepEqual(recovered.matrix, {
      include: [{
        enabled: false,
        pull_request: 0,
        dispatch_binding: "null",
      }],
    });
    assert.equal(
      github.candidateInventoryRequests().length,
      inventoryRequests,
      "recovery must not start another diagnostic or candidate scan",
    );
    assert.equal(
      github.candidateLifecycleRequests().length,
      lifecycleRequests,
      "ready recovery must not read legacy candidate lifecycle",
    );
    assert.equal(
      github.currentOpenCandidateRequests().length,
      currentOpenRequests,
      "ready recovery must not resample current-open candidates",
    );
    assert.equal(github.externalWrites.length, publicWrites);
    assert.deepEqual(github.artifactBindingPointReadRequests(), pointReads);
    assert.equal(
      github.candidateProtocolOrder().filter((entry) =>
        entry === "lease-acquire:").length,
      1,
      "recovery must consume the single released attempt without a new lease",
    );
    assert.equal(
      github.candidateProtocolOrder().filter((entry) =>
        entry === "lease-release:").length,
      1,
    );
    const dispatchRecordsAfterRecovery = github.candidateDispatchRecords();
    const recoveryRecords = dispatchRecordsAfterRecovery.slice(
      dispatchRecordsBeforeRecovery.length,
    );
    assert.deepEqual(
      recoveryRecords.map(({ phase }) => phase),
      ["candidate-ack", "batch-complete", "cycle-complete"],
    );
    const dispatchRecordOidsBeforeRecovery = new Set(
      dispatchRecordsBeforeRecovery.map(({ commit_sha: commitSha }) =>
        commitSha),
    );
    assert.equal(
      new Set(recoveryRecords.map(({ commit_sha: commitSha }) => commitSha))
        .size,
      3,
      "recovery ack and both completion records must have unique OIDs",
    );
    for (const { commit_sha: commitSha } of recoveryRecords) {
      assert.match(commitSha, /^[0-9a-f]{40}$/u);
      assert.equal(
        dispatchRecordOidsBeforeRecovery.has(commitSha),
        false,
        "fresh recovery records must not reuse a pre-recovery OID",
      );
    }
    const recoveryAckRecords = recoveryRecords.filter(({ phase }) =>
      phase === "candidate-ack");
    assert.equal(recoveryAckRecords.length, 1);
    assert.equal(
      dispatchRecordsAfterRecovery.filter(({ phase }) =>
        phase === "candidate-ack").length,
      1,
    );
    assertNoDispatchAuthorityInternals(recovered);
    assertFixtureServerClockWithinOidcSkew(github);
  });
});

test("schedule-dispatch returns a zero-effect sentinel while recovery is not ready", async () => {
  await withWorkflowCliFixture({
    eventName: "schedule",
    event: {},
    route: "scan-all-open",
    pullRequest: "",
  }, async ({ environment, runnerTemp }) => {
    const scanCommand = await prepareV2WorkflowCommand(environment);
    const liveTime = new Date().toISOString();
    const oidc = productionOidcFixture(scanCommand, liveTime);
    const sharedEnvironment = {
      ...environment,
      ...oidc.environment,
      GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
      GITHUB_API_URL: "https://api.github.com",
    };
    const github = productionControllerGitHubFixture(
      scanCommand,
      oidc,
      liveTime,
      {
        candidateNumbers: [7],
        apiOrigin: "https://api.github.com",
      },
    );
    const dispatch = await runV2ScheduleDispatchCli(sharedEnvironment, {
      fetch: github.fetch,
    });
    github.failNextRelease();
    const scheduledEnvironment = await makeWorkflowLegEnvironment({
      environment: sharedEnvironment,
      runnerTemp,
      name: "active-lease-recovery",
      runId: "123457",
      route: "ordinary",
      pullRequest: "7",
      dispatchBinding: dispatch.matrix.include[0].dispatch_binding,
    });
    const scheduledCommand = await prepareV2WorkflowCommand(
      scheduledEnvironment,
    );
    oidc.bindCommand(scheduledCommand);
    await assert.rejects(
      runV2WorkflowControllerCli(scheduledEnvironment, {
        fetch: github.fetch,
      }),
      (error) => error?.code === "PRODUCTION_LEASE_RELEASE_FAILED",
    );
    assert.equal(github.activeLease(), true);
    const recordsBefore = github.ledgerRecordCount();
    const writesBefore = github.externalWrites.length;
    const inventoryRequests = github.candidateInventoryRequests().length;
    const lifecycleRequests = github.candidateLifecycleRequests().length;
    const currentOpenRequests = github.currentOpenCandidateRequests().length;

    const pendingEnvironment = await makeWorkflowLegEnvironment({
      environment: sharedEnvironment,
      runnerTemp,
      name: "pending-recovery-scan",
      runId: "123458",
      route: "scan-all-open",
      pullRequest: "",
    });
    const pendingCommand = await prepareV2WorkflowCommand(pendingEnvironment);
    oidc.bindCommand(pendingCommand);
    const pending = await runV2ScheduleDispatchCli(pendingEnvironment, {
      fetch: github.fetch,
    });

    assert.deepEqual(pending.matrix, {
      include: [{
        enabled: false,
        pull_request: 0,
        dispatch_binding: "null",
      }],
    });
    assert.equal(github.ledgerRecordCount(), recordsBefore);
    assert.equal(github.externalWrites.length, writesBefore);
    assert.equal(github.candidateInventoryRequests().length, inventoryRequests);
    assert.equal(github.candidateLifecycleRequests().length, lifecycleRequests);
    assert.equal(
      github.currentOpenCandidateRequests().length,
      currentOpenRequests,
    );
    assert.equal(github.activeLease(), true);
    assertNoDispatchAuthorityInternals(pending);
  });
});

test("workflow output writer publishes exactly ten outputs and canonical artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-review-gate-v2-output-"));
  const githubOutput = join(root, "github-output");
  const outputPath = join(root, "summary.json");
  await writeFile(githubOutput, "", { mode: 0o600 });
  const terminal = {
    decision: "not-selected",
    reducer_report: { decision: "not-selected" },
    report: {
      schema_version: 2,
      selection: {
        selected: false,
        intent: "none",
        mode: "none",
        source: "none",
      },
      server_enforcement: "not-applicable",
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
      decision: "not-selected",
      freshness_assurance: "point-in-time",
    },
    status_plan: { writes: [] },
    scheduler_plan: { actions: [], due_at: null },
  };
  const result = {
    initial_result: { reservation: null, post_intent: null },
    terminal_result: terminal,
    binding_receipt: null,
    sticky_receipt: null,
    ledger: { ledger_digest: `sha256:${"a".repeat(64)}` },
  };
  try {
    await assert.rejects(
      writeV2WorkflowOutputs({
        result: {
          ...result,
          terminal_result: {
            ...terminal,
            report: { ...terminal.report, reducer_report: terminal.reducer_report },
          },
        },
        environment: {
          RUNNER_TEMP: root,
          V2_CONTROLLER_OUTPUT_PATH: outputPath,
        },
      }),
      (error) => error?.code === "COMPACT_REDUCER_REPORT_PUBLICATION_BLOCKED",
    );
    await assert.rejects(readFile(outputPath, "utf8"), { code: "ENOENT" });

    const summary = await writeV2WorkflowOutputs({
      result,
      environment: {
        RUNNER_TEMP: root,
        V2_CONTROLLER_OUTPUT_PATH: outputPath,
        GITHUB_OUTPUT: githubOutput,
      },
    });
    assert.equal(summary.schema, "codex-review-gate-workflow-output-v2");
    assert.deepEqual(Object.keys(summary.outputs).sort(), [
      "binding-receipt-path", "decision", "due-at", "intent-path",
      "ledger-receipt-path", "report-path", "reservation-path",
      "status-plan-path", "sticky-receipt-path", "wakeup-hints",
    ]);
    assert.equal(summary.outputs.decision, "not-selected");
    assert.equal(
      JSON.parse(await readFile(summary.outputs["report-path"], "utf8")).schema_version,
      2,
    );
    assert.equal(
      (await readFile(summary.outputs["report-path"], "utf8")).includes(
        "reducer_report",
      ),
      false,
    );
    assert.equal(JSON.stringify(summary).includes("reducer_report"), false);
    assert.equal((await readFile(githubOutput, "utf8")).trim().split("\n").length, 10);
    assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), summary);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real scheduler public waits reach all three closed workflow outputs",
  async () => {
    const start = "2026-08-13T08:00:00.000Z";
    const epochId = "owner/repo:7:base:head:merge";
    const at = (milliseconds) =>
      new Date(Date.parse(start) + milliseconds).toISOString();
    const automaticRequest = (overrides = {}) => ({
      state: "available",
      generation_index: 1,
      recovery_authority: null,
      intent_id: null,
      intent_persisted_at: null,
      effect_attempted_at: null,
      ...overrides,
    });
    const controlledRequest = (boundAt) => ({
      request_id: "1001",
      bound_at: boundAt,
      binding_record_oid: "b".repeat(40),
      binding_receipt_digest: `sha256:${"a".repeat(64)}`,
    });
    const snapshot = (overrides = {}) => ({
      epoch_id: epochId,
      decision: "pending",
      complete: true,
      snapshot_id: "snapshot-1",
      snapshot_fingerprint: "snapshot-fingerprint-1",
      observed_at: start,
      provider_activity_fingerprint: "provider-activity-1",
      no_start_candidate: null,
      run_id: "1001",
      run_attempt: 1,
      ...overrides,
    });
    const schedulerInput = (overrides = {}) => {
      const base = {
        schema: V2_SCHEDULER_SCHEMA,
        schema_version: V2_SCHEDULER_SCHEMA_VERSION,
        trigger: "initial",
        now: start,
        public_wait_supported: true,
        status_target_mode: "test-merge-with-head-sentinel",
        epoch: {
          id: epochId,
          started_at: start,
          controlled_request: null,
          automatic_request: automaticRequest(),
        },
        evaluation: snapshot(),
        complete_snapshots: [],
        status: {
          exact_sha_context_count: 0,
          latest_idempotency_key: null,
        },
        applied_action_keys: [],
      };
      return {
        ...base,
        ...overrides,
        epoch: { ...base.epoch, ...(overrides.epoch ?? {}) },
        status: { ...base.status, ...(overrides.status ?? {}) },
      };
    };
    const requestAt = at(PUBLIC_INITIAL_WAIT_MS);
    const attemptedRequestEpoch = {
      controlled_request: controlledRequest(requestAt),
      automatic_request: automaticRequest({
        state: "effect-attempted",
        intent_id: "automatic-request:intent-1",
        intent_persisted_at: requestAt,
        effect_attempted_at: requestAt,
      }),
    };
    const postRequestSnapshot = snapshot({
      snapshot_id: "snapshot-post-request",
      snapshot_fingerprint: "snapshot-post-request-fingerprint",
      observed_at: requestAt,
    });
    const noStartObservedAt = at(
      PUBLIC_INITIAL_WAIT_MS + PUBLIC_POST_REQUEST_WAIT_MS,
    );
    const noStartSnapshot = snapshot({
      decision: "skipped-unavailable",
      snapshot_id: "snapshot-no-start",
      snapshot_fingerprint: "snapshot-no-start-fingerprint",
      observed_at: noStartObservedAt,
      provider_activity_fingerprint: "no-provider-activity",
      no_start_candidate: {
        artifact_id: "issue-comment-2002",
        artifact_digest: PUBLIC_DIGEST,
        scope_fingerprint: "scope-fingerprint-1",
        lifecycle_fingerprint: "open-unmerged-base-head-merge",
        first_seen_at: at(PUBLIC_INITIAL_WAIT_MS + 1),
      },
    });
    const phases = [
      {
        name: "initial",
        hint: "public-initial-wait",
        completionReason: "public-initial-wait-complete",
        waiting: schedulerInput(),
        complete: schedulerInput({ now: at(PUBLIC_INITIAL_WAIT_MS) }),
      },
      {
        name: "post-request",
        hint: "public-post-request-wait",
        completionReason: "public-post-request-wait-complete",
        waiting: schedulerInput({
          now: requestAt,
          evaluation: postRequestSnapshot,
        }),
        complete: schedulerInput({
          now: at(PUBLIC_INITIAL_WAIT_MS + PUBLIC_POST_REQUEST_WAIT_MS),
          epoch: attemptedRequestEpoch,
          evaluation: postRequestSnapshot,
        }),
      },
      {
        name: "no-start",
        hint: "public-no-start-wait",
        completionReason: "public-no-start-confirmation",
        waiting: schedulerInput({
          now: noStartObservedAt,
          epoch: attemptedRequestEpoch,
          evaluation: noStartSnapshot,
        }),
        complete: schedulerInput({
          now: at(
            PUBLIC_INITIAL_WAIT_MS + PUBLIC_POST_REQUEST_WAIT_MS +
              PUBLIC_NO_START_CONFIRMATION_MS,
          ),
          epoch: attemptedRequestEpoch,
          evaluation: noStartSnapshot,
        }),
      },
    ];
    const productionCycle = (
      scheduling,
      schedulerPlan,
      evaluation = scheduling.evaluation,
    ) => createV2ProductionInitialCycle({
      internal_result: {
        decision: evaluation.decision,
        report: publicReport({ decision: evaluation.decision }),
        scheduler_plan: schedulerPlan,
        scheduler_evaluation: evaluation,
        status_plan: { writes: [] },
      },
      scheduler_append: {
        append_receipt: {
          commit_sha: "1".repeat(40),
          receipt_digest: PUBLIC_DIGEST,
        },
      },
      status_intent_appends: [],
      status_response_appends: [],
      status_receipts: [],
      status_outcome: "not-required",
      ambiguity_code: null,
      automatic_reservation_append: null,
      reservation_status_intent_append: null,
      reservation_status_response_append: null,
      reservation_status_receipt: null,
      reservation_status_outcome: "not-required",
      reservation_status_ambiguity_code: null,
      automatic_request_intent_append: null,
      automatic_request_binding_append: null,
      automatic_request_binding_receipt: null,
      automatic_request_outcome: "not-required",
      automatic_request_ambiguity_code: null,
      automatic_request_intent_source: "none",
      public_effects_performed: 0,
      lease_release_receipt: {
        commit_sha: "2".repeat(40),
        receipt_digest: PUBLIC_DIGEST,
      },
      runner_authority: {
        scheduling,
        authority_digest: PUBLIC_DIGEST,
      },
      initial_runner_state_authority: {
        authority_digest: PUBLIC_DIGEST,
      },
      established_runner_state_authority: null,
      control_plane_receipt: { receipt_digest: PUBLIC_DIGEST },
      continuity_authority: {
        continuity_receipt: {
          continuity_receipt_digest: PUBLIC_DIGEST,
        },
      },
      handoff: {
        preflight_receipt_digest: PUBLIC_DIGEST,
        handoff_digest: PUBLIC_DIGEST,
      },
    });
    const actual = [];
    for (const phase of phases) {
      for (const state of ["waiting", "complete"]) {
        const scheduling = phase[state];
        const schedulerPlan = planV2Actions(scheduling);
        const evaluateActions = schedulerPlan.actions.filter((action) =>
          action.kind === "evaluate_snapshot");
        if (state === "waiting") {
          assert.notEqual(schedulerPlan.due_at, null);
          assert.deepEqual(evaluateActions, []);
        } else {
          assert.equal(schedulerPlan.due_at, null);
          assert.equal(evaluateActions.length, 1);
          assert.equal(evaluateActions[0].reason, phase.completionReason);
        }
        const cycle = productionCycle(scheduling, schedulerPlan);
        const root = await mkdtemp(
          join(tmpdir(), `codex-review-gate-v2-${phase.name}-${state}-`),
        );
        try {
          const summary = await writeV2WorkflowOutputs({
            result: cycle,
            environment: {
              RUNNER_TEMP: root,
              V2_CONTROLLER_OUTPUT_PATH: join(root, "summary.json"),
            },
          });
          actual.push([
            phase.name,
            state,
            summary.outputs["due-at"],
            summary.outputs["wakeup-hints"],
          ]);
          assert.equal(Object.keys(summary.outputs).length, 10);
          assert.doesNotMatch(
            JSON.stringify(summary),
            /scheduler_plan|scheduler_evaluation|evaluate_snapshot|epoch/u,
          );
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    }
    assert.deepEqual(actual, phases.flatMap((phase) => [
      [phase.name, "waiting", planV2Actions(phase.waiting).due_at, phase.hint],
      [phase.name, "complete", "", ""],
    ]));
    assert.deepEqual(
      planV2Actions(phases[1].waiting).actions.map((action) => action.kind),
      [
        "publish_status",
        "persist_auto_request_intent",
        "post_review_request",
      ],
    );
    const postRequestVariants = [
      schedulerInput({
        now: requestAt,
        evaluation: postRequestSnapshot,
        epoch: {
          automatic_request: automaticRequest({
            state: "intent-persisted",
            intent_id: "automatic-request:intent-1",
            intent_persisted_at: requestAt,
          }),
        },
      }),
      schedulerInput({
        now: at(PUBLIC_INITIAL_WAIT_MS + 5 * 60 * 1000),
        evaluation: postRequestSnapshot,
        epoch: {
          controlled_request: controlledRequest(requestAt),
        },
      }),
      schedulerInput({
        now: at(PUBLIC_INITIAL_WAIT_MS + 5 * 60 * 1000),
        evaluation: postRequestSnapshot,
        epoch: {
          automatic_request: automaticRequest({
            state: "effect-attempted",
            intent_id: "automatic-request:intent-1",
            intent_persisted_at: requestAt,
            effect_attempted_at: requestAt,
          }),
        },
      }),
    ];
    for (const scheduling of postRequestVariants) {
      const schedulerPlan = planV2Actions(scheduling);
      assert.notEqual(schedulerPlan.due_at, null);
      assert.equal(
        productionCycle(scheduling, schedulerPlan).terminal_result.wakeup_hints,
        "public-post-request-wait",
      );
    }
    const privateScheduling = schedulerInput({
      public_wait_supported: false,
    });
    const privatePlan = planV2Actions(privateScheduling);
    assert.notEqual(privatePlan.due_at, null);
    assert.equal(
      productionCycle(privateScheduling, privatePlan)
        .terminal_result.wakeup_hints,
      "private-reconcile",
    );
    const postRequestWaiting = phases[1].waiting;
    assert.throws(
      () => productionCycle(
        postRequestWaiting,
        planV2Actions(postRequestWaiting),
        { ...postRequestWaiting.evaluation, decision: "clean" },
      ),
      (error) => error?.code === "PUBLIC_WAIT_PHASE_UNCLASSIFIED",
    );
    const forgedAutomaticState = schedulerInput({
      now: requestAt,
      evaluation: postRequestSnapshot,
      epoch: {
        automatic_request: automaticRequest({ state: "forged" }),
      },
    });
    assert.throws(
      () => productionCycle(
        forgedAutomaticState,
        planV2Actions(postRequestWaiting),
      ),
      (error) => error?.code === "PUBLIC_WAIT_PHASE_UNCLASSIFIED",
    );
  });

function productionPreflightBoundaryFixture(command) {
  const repository = {
    owner: "owner",
    name: "repo",
    id: "42",
    node_id: "R_repo",
    owner_id: "88",
    visibility: "public",
    default_branch: "main",
    authenticated_permissions: {
      admin: false,
      maintain: true,
      push: true,
      triage: true,
      pull: true,
    },
  };
  const repositoryEndpointReceipt = {
    method: "GET",
    path: "/repos/owner/repo",
    status: 200,
    server_time: TIME,
    raw_body_sha256: `sha256:${"1".repeat(64)}`,
  };
  const endpointReceipts = [repositoryEndpointReceipt];
  const appCatalog = {
    id: "15368",
    node_id: "A_github_actions",
    slug: "github-actions",
  };
  const identityEvidence = {
    triggering_actor_id_claim: command.invocation.actor_id,
    app_catalog: appCatalog,
    assurance: "trusted-trigger-claim-plus-public-app-catalog-only",
    proves_current_token_identity: false,
    oidc_provenance_required: true,
    oidc_provenance: null,
    oidc_binding_requirements: {
      issuer: "https://token.actions.githubusercontent.com",
      audience: V2_GIT_LEDGER_OIDC_AUDIENCE,
      repository_id: repository.id,
      repository: command.workflow_receipt.caller_repository,
      workflow_ref: command.workflow_receipt.caller_workflow_ref,
      workflow_sha: command.workflow_receipt.caller_workflow_sha,
      job_workflow_ref:
        "Joey-Tools/codex-review-gate-action/.github/workflows/" +
        `codex-review-gate.yml@${command.workflow_receipt.revision}`,
      job_workflow_sha: command.workflow_receipt.checkout_sha,
      run_id: command.invocation.run_id,
      run_attempt: command.invocation.run_attempt,
      event_name: command.invocation.event_name,
      ref: null,
      repository_id_source: "live-repository-receipt",
      ref_source: "trusted-job-context-required",
    },
  };
  const sourceWorkflow = {
    repository: { owner: "Joey-Tools", name: "codex-review-gate-action" },
    workflow_path: ".github/workflows/codex-review-gate.yml",
    workflow_ref:
      "Joey-Tools/codex-review-gate-action/.github/workflows/" +
      `codex-review-gate.yml@${command.workflow_receipt.revision}`,
    workflow_sha: command.workflow_receipt.checkout_sha,
    actor_app: appCatalog,
  };
  const capability = {
    sealed: false,
    capability_ready: false,
    blockers: [
      "oidc-workflow-provenance-required",
      "ledger-capability-attestation-required",
      "exact-contents-write-observation-required",
    ],
    repository: {
      owner: repository.owner,
      name: repository.name,
      id: repository.id,
      node_id: repository.node_id,
      owner_id: repository.owner_id,
    },
    repository_endpoint_receipt: repositoryEndpointReceipt,
    ledger_ref: "refs/heads/codex-review-gate-ledger-v2",
    expected_creator: null,
    actor_assurance: identityEvidence,
    permissions: {
      metadata_read_observed: true,
      exact_contents_write_observed: false,
      repository_permission_summary: {
        repository_push_observed: true,
        repository_admin_observed: false,
        assurance: "repository-permission-summary-only",
        proves_exact_contents_write: false,
        proves_minimal_token_scope: false,
        proves_no_additional_writes: false,
      },
      observation_receipt_digest: ledgerDigestDomain(
        "codex-review-gate-v2-permission-observation",
        endpointReceipts,
      ),
    },
    protection: {
      deletion_blocked: true,
      non_fast_forward_blocked: true,
      force_pushes_blocked: true,
      live_ruleset_receipt_digest: `sha256:${"2".repeat(64)}`,
      source_workflow_pin: sourceWorkflow,
      current_attestation: false,
    },
    controller_release: {
      repository: sourceWorkflow.repository,
      release_sha: command.workflow_receipt.revision,
      workflow_path: sourceWorkflow.workflow_path,
      workflow_ref: sourceWorkflow.workflow_ref,
      workflow_sha: sourceWorkflow.workflow_sha,
      current: true,
    },
    observed_at: TIME,
  };
  const configurationProjection = {
    repository,
    repository_endpoint_receipt: repositoryEndpointReceipt,
    workflow: {},
    ruleset: {},
    app: {},
    identity_evidence: identityEvidence,
    public_wait: {},
    ledger_branch: {},
    server_enforcement: {},
  };
  const configurationDigest = ledgerDigestDomain(
    "codex-review-gate-v2-workflow-preflight-configuration",
    configurationProjection,
  );
  const withoutDigest = {
    schema: "codex-review-gate-workflow-preflight-v2",
    schema_version: 1,
    ...configurationProjection,
    git_ledger_capability_input: capability,
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
  return {
    ...withoutDigest,
    receipt_digest: ledgerDigestDomain(
      "codex-review-gate-v2-workflow-preflight",
      withoutDigest,
    ),
  };
}

function productionPreflightFetchFixture(command, {
  callerWorkflowState = "active",
  ledgerBranchPresent = true,
  apiOrigin = "https://api.github.com",
} = {}) {
  const paths = [];
  const repository = "owner/repo";
  const releaseRepository = "Joey-Tools/codex-review-gate-action";
  const callerPath = ".github/workflows/codex-review-gate-reconcile.yml";
  const ledgerRef = "refs/heads/codex-review-gate-ledger-v2";
  const effectiveRule = (type) => ({
    type,
    enforcement: "active",
    ruleset_id: 30,
    ruleset_name: "Codex ledger protection",
    ruleset_source_type: "Repository",
    ruleset_source: repository,
  });
  const protection = {
    id: 30,
    name: "Codex ledger protection",
    target: "branch",
    source_type: "Repository",
    source: repository,
    enforcement: "active",
    bypass_actors: [],
    conditions: {
      ref_name: {
        include: [ledgerRef],
        exclude: [],
      },
    },
    rules: [{ type: "deletion" }, { type: "non_fast_forward" }],
  };
  const callerYaml = [
    "name: Codex Review Gate caller",
    "jobs:",
    "  gate:",
    `    uses: ${releaseRepository}/.github/workflows/` +
      `codex-review-gate.yml@${command.workflow_receipt.revision}`,
    "",
  ].join("\n");
  const releaseYaml = [
    "name: Codex Review Gate v2",
    "permissions:",
    "  contents: write",
    "  id-token: write",
    "  issues: write",
    "  pull-requests: write",
    "  statuses: write",
    "jobs:",
    "  gate:",
    "    runs-on: ubuntu-slim",
    "",
  ].join("\n");
  const fetch = async (urlValue) => {
    const url = new URL(urlValue);
    const path = url.pathname;
    paths.push(path);
    if (path === "/repos/owner/repo") {
      return jsonResponse(JSON.stringify({
        id: 42,
        full_name: repository,
        node_id: "R_repo",
        url: `${apiOrigin}/repos/owner/repo`,
        role_name: "write",
        visibility: "private",
        private: true,
        default_branch: "main",
        permissions: {
          admin: false,
          maintain: false,
          push: true,
          triage: true,
          pull: true,
        },
        owner: { id: 88, login: "owner" },
      }));
    }
    if (path === "/repos/Joey-Tools/codex-review-gate-action") {
      return jsonResponse(JSON.stringify({
        id: 900,
        node_id: "R_release",
        full_name: releaseRepository,
      }));
    }
    if (path === "/apps/github-actions") {
      return jsonResponse(JSON.stringify({
        id: 15368,
        node_id: "A_github_actions",
        slug: "github-actions",
      }));
    }
    if (path === "/apps/chatgpt-codex-connector") {
      return jsonResponse(JSON.stringify({
        id: 1144995,
        node_id: "A_kwHOAOQ6Gs4AEXij",
        slug: "chatgpt-codex-connector",
      }));
    }
    if (path === "/users/chatgpt-codex-connector%5Bbot%5D") {
      return jsonResponse(JSON.stringify({
        id: 199175422,
        node_id: "BOT_kgDOC98s_g",
        login: "chatgpt-codex-connector[bot]",
        type: "Bot",
      }));
    }
    if (path === "/repos/owner/repo/actions/oidc/customization/sub") {
      return jsonResponse(JSON.stringify({
        use_default: false,
        include_claim_keys: ["repo", "job_workflow_ref"],
      }));
    }
    if (path === `/repos/owner/repo/actions/workflows/${callerPath.split("/").at(-1)}`) {
      return jsonResponse(JSON.stringify({
        id: 1,
        node_id: "W_caller",
        path: callerPath,
        state: callerWorkflowState,
      }));
    }
    if (path === `/repos/owner/repo/contents/${callerPath}`) {
      return jsonResponse(JSON.stringify({
        type: "file",
        path: callerPath,
        encoding: "base64",
        content: Buffer.from(callerYaml).toString("base64"),
        sha: "d".repeat(40),
      }));
    }
    if (path ===
        "/repos/Joey-Tools/codex-review-gate-action/contents/" +
          ".github/workflows/codex-review-gate.yml") {
      return jsonResponse(JSON.stringify({
        type: "file",
        path: ".github/workflows/codex-review-gate.yml",
        encoding: "base64",
        content: Buffer.from(releaseYaml).toString("base64"),
        sha: "e".repeat(40),
      }));
    }
    if (path === "/repos/owner/repo/rules/branches/main") {
      return jsonResponse("[]");
    }
    if (path === "/repos/owner/repo/branches/codex-review-gate-ledger-v2") {
      if (!ledgerBranchPresent) {
        return jsonResponse(JSON.stringify({ message: "Not Found" }), 404);
      }
      return jsonResponse(JSON.stringify({
        name: "codex-review-gate-ledger-v2",
        commit: { sha: "f".repeat(40) },
      }));
    }
    if (path ===
        "/repos/owner/repo/rules/branches/codex-review-gate-ledger-v2") {
      return jsonResponse(JSON.stringify([
        effectiveRule("deletion"),
        effectiveRule("non_fast_forward"),
      ]));
    }
    if (path === "/repos/owner/repo/rulesets") {
      return jsonResponse(JSON.stringify([protection]));
    }
    if (path === "/repos/owner/repo/rulesets/30") {
      return jsonResponse(JSON.stringify(protection));
    }
    throw new Error(`unexpected production preflight request ${url.href}`);
  };
  return { fetch, paths };
}

function productionControllerGitHubFixture(
  command,
  oidc,
  baseTime,
  {
    candidateNumbers = null,
    candidateInventorySnapshots = null,
    candidateLifecycleStates = null,
    currentOpenCandidateSnapshots = null,
    apiOrigin = "https://api.github.com",
    snapshotIssueComments = [],
    serverTimeStepMilliseconds = 1_000,
    authoritativeWallClock = false,
  } = {},
) {
  const preflight = productionPreflightFetchFixture(command, {
    ledgerBranchPresent: false,
    apiOrigin,
  });
  const transportFetch = completeSnapshotFetch({
    apiOrigin,
    issueComments: snapshotIssueComments,
  });
  const blobs = new Map();
  const trees = new Map();
  const commits = new Map();
  const ledgerWriteRequests = [];
  const externalWrites = [];
  const statuses = new Map();
  const requests = new Map();
  let refTarget = null;
  let serverTimeOffsetMilliseconds = 0;
  let activeLease = false;
  let failRelease = false;
  let failReleaseMode = "next";
  let nextStatusId = 800;
  let statusPostCount = 0;
  let statusRefetchCount = 0;
  let statusRefetchMode = "exact";
  const statusRefetchModeByPost = new Map();
  let nextRequestId = 900;
  let requestPostCount = 0;
  let requestRefetchCount = 0;
  let requestPostMode = "exact";
  let requestRefetchMode = "exact";
  let requestScopeMode = "exact";
  const failedRecordUpdates = new Map();
  const durableFailedRecordUpdates = new Map();
  const failedRecordUpdateOrdinals = new Map();
  const recordUpdateCounts = new Map();
  const artifactBindingPointReadRequests = [];
  const failedArtifactBindingPointReadOrdinals = new Set();
  let artifactBindingEqualDateReadsRemaining = 0;
  let artifactBindingEqualDateAlways = false;
  const candidateInventoryRequests = [];
  const candidateLifecycleRequests = [];
  const currentOpenCandidateRequests = [];
  let configuredCandidateNumbers = candidateNumbers;
  let candidateInventoryUniverse = candidateInventorySnapshots === null
    ? configuredCandidateNumbers
    : [...new Set(candidateInventorySnapshots.flat())];
  let candidateInventorySnapshotReadCount = 0;
  let candidateLifecycleReadCount = 0;
  let currentOpenPass = 0;
  let currentOpenActive = null;
  let maxServerTimestamp = Date.parse(baseTime);

  const fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method ?? "GET").toUpperCase();
    if (url.hostname === "token.actions.githubusercontent.com" ||
        url.hostname.endsWith(".actions.githubusercontent.com")) {
      return redated(await oidc.fetch(input, init), { advance: false });
    }
    if (url.origin !== apiOrigin) {
      throw new Error(`unexpected production controller host ${url.hostname}`);
    }
    const path = url.pathname;
    const repoPrefix = "/repos/owner/repo";
    const ledgerPath = path.startsWith(repoPrefix)
      ? path.slice(repoPrefix.length)
      : null;
    if (
      ledgerPath === "/branches/codex-review-gate-ledger-v2" &&
      refTarget !== null
    ) {
      return redated(jsonResponse(JSON.stringify({
        name: "codex-review-gate-ledger-v2",
        commit: { sha: refTarget },
      })), { advance: false });
    }
    if (ledgerPath !== null && isLedgerGitPath(ledgerPath)) {
      return ledgerFetch(ledgerPath, method, init);
    }
    if (method === "POST" && path === "/graphql") {
      const request = JSON.parse(String(init.body));
      if (String(request.query).includes(
        "CodexReviewGateCurrentOpenPullRequests",
      )) {
        const after = request.variables?.after ?? null;
        let kind;
        let start;
        if (after === null && currentOpenActive?.awaiting_fence === true) {
          kind = "fence";
          start = 0;
        } else if (after === null && currentOpenActive === null) {
          currentOpenPass += 1;
          const snapshots = currentOpenCandidateSnapshots ?? [
            configuredCandidateNumbers ?? [],
          ];
          currentOpenActive = {
            candidates: snapshots[Math.min(
              currentOpenPass - 1,
              snapshots.length - 1,
            )],
            expected_cursor: null,
            next_offset: 0,
            awaiting_fence: false,
          };
          kind = "page";
          start = 0;
        } else if (
          typeof after === "string" && currentOpenActive !== null &&
          currentOpenActive.awaiting_fence === false &&
          after === currentOpenActive.expected_cursor
        ) {
          kind = "page";
          start = currentOpenActive.next_offset;
        } else {
          throw new Error("unexpected current-open GraphQL cursor");
        }
        const end = Math.min(
          start + 100,
          currentOpenActive.candidates.length,
        );
        const selected = currentOpenActive.candidates.slice(start, end);
        const pageInfo = {
          hasNextPage: end < currentOpenActive.candidates.length,
          endCursor: selected.length === 0
            ? null
            : `current-open:${currentOpenPass}:${end}`,
        };
        currentOpenCandidateRequests.push({
          after,
          kind,
          pass: currentOpenPass,
        });
        if (kind === "fence") {
          currentOpenActive = null;
        } else if (pageInfo.hasNextPage) {
          currentOpenActive.expected_cursor = pageInfo.endCursor;
          currentOpenActive.next_offset = end;
        } else {
          currentOpenActive.awaiting_fence = true;
        }
        const raw = JSON.stringify({
          data: {
            repository: {
              id: "R_repo",
              databaseId: 42,
              nameWithOwner: "owner/repo",
              pullRequests: {
                nodes: selected.map(candidateCurrentOpenGraphqlPull),
                pageInfo,
              },
            },
          },
        });
        const response = new Response(raw, {
          status: 200,
          headers: {
            "content-length": String(Buffer.byteLength(raw)),
            "content-type": "application/json",
            "x-github-request-id":
              `CURRENT-OPEN:${currentOpenCandidateRequests.length}`,
          },
        });
        return redated(response);
      }
    }
    if (
      candidateInventoryUniverse !== null && method === "GET" &&
      path === "/repos/owner/repo/pulls" &&
      url.searchParams.get("state") === "all"
    ) {
      candidateInventoryRequests.push(`${path}${url.search}`);
      const page = Number(url.searchParams.get("page"));
      if (page === 1) candidateInventorySnapshotReadCount += 1;
      const inventory = candidateInventorySnapshots === null
        ? configuredCandidateNumbers
        : candidateInventorySnapshots[Math.min(
            candidateInventorySnapshotReadCount - 1,
            candidateInventorySnapshots.length - 1,
          )];
      const start = (page - 1) * 100;
      const selected = inventory.slice(start, start + 100);
      const raw = JSON.stringify(selected.map(candidateInventoryListPull));
      const headers = {
        "content-length": String(Buffer.byteLength(raw)),
        "content-type": "application/json",
      };
      if (selected.length === 100) {
        const next = new URL(url.href);
        next.searchParams.set("page", String(page + 1));
        headers.link = `<${next.href}>; rel="next"`;
      }
      return redated(new Response(raw, { status: 200, headers }));
    }
    const candidatePullMatch = candidateInventoryUniverse === null
      ? null
      : path.match(/^\/repos\/owner\/repo\/pulls\/([1-9][0-9]*)$/u);
    if (
      method === "GET" && candidatePullMatch !== null &&
      candidateInventoryUniverse.includes(Number(candidatePullMatch[1]))
    ) {
      const lifecycleState = candidateLifecycleStates === null
        ? "open"
        : candidateLifecycleStates[Math.min(
            candidateLifecycleReadCount,
            candidateLifecycleStates.length - 1,
          )];
      candidateLifecycleReadCount += 1;
      candidateLifecycleRequests.push(`${path}:${lifecycleState}`);
      return redated(jsonResponse(JSON.stringify(
        candidateInventoryExactPull(
          Number(candidatePullMatch[1]),
          lifecycleState,
        ),
      )));
    }
    if (
      new Set(["POST", "PATCH", "DELETE"]).has(method) &&
      !(method === "POST" && path === "/graphql")
    ) {
      externalWrites.push(`${method} ${path}`);
    }
    const statusPost = path.match(
      /^\/repos\/owner\/repo\/statuses\/([0-9a-f]{40})$/u,
    );
    if (method === "POST" && statusPost !== null) {
      statusPostCount += 1;
      statusRefetchMode =
        statusRefetchModeByPost.get(statusPostCount) ?? statusRefetchMode;
      const body = JSON.parse(init.body);
      const createdAt = new Date(nextDate()).toISOString();
      const created = {
        id: ++nextStatusId,
        sha: statusPost[1],
        state: body.state,
        context: body.context,
        description: body.description,
        created_at: createdAt,
        updated_at: createdAt,
        creator: { login: "github-actions[bot]", type: "Bot" },
      };
      if (statusRefetchMode !== "missing") {
        const stored = statusRefetchMode === "drift"
          ? { ...created, description: `${created.description}-drift` }
          : structuredClone(created);
        const inventory = statuses.get(created.sha) ?? [];
        inventory.push(stored);
        if (statusRefetchMode === "duplicate") {
          inventory.push(structuredClone(stored));
        }
        statuses.set(created.sha, inventory);
      }
      return redated(jsonResponse(JSON.stringify(created), 201));
    }
    const statusGet = path.match(
      /^\/repos\/owner\/repo\/commits\/([0-9a-f]{40})\/statuses$/u,
    );
    if (method === "GET" && statusGet !== null) {
      statusRefetchCount += 1;
      if (statusRefetchMode === "error") {
        return redated(jsonResponse(JSON.stringify({
          message: "Internal Server Error",
        }), 500));
      }
      const page = Number(url.searchParams.get("page") ?? "1");
      const inventory = statuses.get(statusGet[1]) ?? [];
      return redated(jsonResponse(JSON.stringify(
        inventory.slice((page - 1) * 100, page * 100),
      )));
    }
    const issueCommentPost = path.match(
      /^\/repos\/owner\/repo\/issues\/([1-9][0-9]*)\/comments$/u,
    );
    if (method === "POST" && issueCommentPost !== null) {
      const pullNumber = Number(issueCommentPost[1]);
      requestPostCount += 1;
      if (requestPostMode === "throw") {
        throw new Error("simulated automatic request transport uncertainty");
      }
      if (requestPostMode === "error") {
        return redated(jsonResponse(JSON.stringify({
          message: "Internal Server Error",
        }), 500));
      }
      const body = JSON.parse(init.body).body;
      const createdAt = new Date(nextDate()).toISOString();
      const request = {
        id: ++nextRequestId,
        node_id: `IC_${nextRequestId}`,
        url: `${apiOrigin}/repos/owner/repo/issues/comments/${nextRequestId}`,
        html_url:
          `https://github.com/owner/repo/pull/${pullNumber}` +
          `#issuecomment-${nextRequestId}`,
        issue_url: `${apiOrigin}/repos/owner/repo/issues/${pullNumber}`,
        author_association: "NONE",
        body,
        created_at: createdAt,
        updated_at: createdAt,
        user: {
          id: 789,
          node_id: "U_789",
          login: "github-actions[bot]",
          type: "Bot",
        },
        performed_via_github_app: {
          id: 15368,
          node_id: "A_github_actions",
          slug: "github-actions",
        },
      };
      requests.set(String(request.id), structuredClone(request));
      return redated(jsonResponse(JSON.stringify(request), 201));
    }
    const requestGet = path.match(
      /^\/repos\/owner\/repo\/issues\/comments\/([1-9][0-9]*)$/u,
    );
    if (
      method === "GET" && requestGet !== null &&
      requests.has(requestGet[1])
    ) {
      requestRefetchCount += 1;
      if (requestRefetchMode === "error") {
        return redated(jsonResponse(JSON.stringify({
          message: "Internal Server Error",
        }), 500));
      }
      const request = requests.get(requestGet[1]);
      if (request === undefined || requestRefetchMode === "missing") {
        return redated(jsonResponse(JSON.stringify({ message: "Not Found" }), 404));
      }
      const exact = requestRefetchMode === "drift"
        ? { ...request, body: `${request.body} drift` }
        : request;
      return redated(jsonResponse(JSON.stringify(exact)));
    }
    const issueCommentsGet = path.match(
      /^\/repos\/owner\/repo\/issues\/([1-9][0-9]*)\/comments$/u,
    );
    if (method === "GET" && issueCommentsGet !== null && requests.size > 0) {
      return redated(jsonResponse(JSON.stringify(
        allIssueComments(Number(issueCommentsGet[1])),
      )));
    }
    if (
      method === "GET" &&
      /^\/repos\/owner\/repo\/issues\/comments\/[1-9][0-9]*\/reactions$/u
        .test(path)
    ) {
      return redated(jsonResponse("[]"));
    }
    if (
      requestScopeMode === "drift" && requestPostCount > 0 &&
      method === "POST" && path === "/graphql" &&
      String(JSON.parse(init.body).query).includes("CodexReviewGateV2Scope")
    ) {
      const original = await transportFetch(input, init);
      const data = JSON.parse(await original.text());
      const pull = data.data.repository.pullRequest;
      const driftHead = "1".repeat(40);
      pull.headRefOid = driftHead;
      pull.headRef.target.oid = driftHead;
      pull.potentialMergeCommit.parents.nodes[1].oid = driftHead;
      return redated(jsonResponse(JSON.stringify(data)));
    }
    if (
      requestScopeMode === "drift" && requestPostCount > 0 &&
      method === "GET" &&
      path === `/repos/owner/repo/compare/${BASE}...${"1".repeat(40)}`
    ) {
      return redated(jsonResponse(JSON.stringify({
        base_commit: { sha: BASE },
        merge_base_commit: { sha: BASE },
      })));
    }
    try {
      return redated(await preflight.fetch(input, init), { advance: false });
    } catch (error) {
      if (!String(error?.message).startsWith(
        "unexpected production preflight request",
      )) throw error;
    }
    const artifactBindingPointRead =
      method === "GET" && isExactProviderArtifactPath(path) &&
      hasReadyAutomaticArtifactBinding();
    let failArtifactBindingPointRead = false;
    if (artifactBindingPointRead) {
      artifactBindingPointReadRequests.push(path);
      const pointReadOrdinal = artifactBindingPointReadRequests.length;
      failArtifactBindingPointRead =
        failedArtifactBindingPointReadOrdinals.delete(pointReadOrdinal);
    }
    const forceEqualArtifactBindingDate = artifactBindingPointRead &&
      (artifactBindingEqualDateAlways ||
        artifactBindingEqualDateReadsRemaining > 0);
    if (
      forceEqualArtifactBindingDate &&
      artifactBindingEqualDateReadsRemaining > 0
    ) {
      artifactBindingEqualDateReadsRemaining -= 1;
    }
    if (artifactBindingPointRead && !forceEqualArtifactBindingDate) {
      advancePastCurrentServerSecond();
    }
    if (failArtifactBindingPointRead) {
      return redated(jsonResponse(JSON.stringify({
        message: "Internal Server Error",
      }), 500), { advance: false });
    }
    const response = await redated(await transportFetch(input, init), {
      advance: !artifactBindingPointRead,
    });
    if (
      response.status !== 404 ||
      /^\/repos\/owner\/repo\/git\/ref\/pull\/[1-9][0-9]*\/merge$/u
        .test(path)
    ) {
      return response;
    }
    throw new Error(`unexpected production controller request ${method} ${path}`);
  };

  return {
    fetch,
    externalWrites,
    externalWriteRequests: () => structuredClone(externalWrites),
    ledgerWriteRequests: () => structuredClone(ledgerWriteRequests),
    activeLease: () => activeLease,
    failNextRelease(mode = "next") {
      failRelease = true;
      failReleaseMode = mode;
    },
    setStatusRefetchMode(mode) { statusRefetchMode = mode; },
    setStatusRefetchModeAt(postOrdinal, mode) {
      statusRefetchModeByPost.set(postOrdinal, mode);
    },
    setRequestPostMode(mode) { requestPostMode = mode; },
    setRequestRefetchMode(mode) { requestRefetchMode = mode; },
    setRequestScopeMode(mode) { requestScopeMode = mode; },
    statusPostCount: () => statusPostCount,
    statusRefetchCount: () => statusRefetchCount,
    requestPostCount: () => requestPostCount,
    requestRefetchCount: () => requestRefetchCount,
    requestComments: () => structuredClone([...requests.values()]),
    addSnapshotIssueComments(...comments) {
      snapshotIssueComments.push(...structuredClone(comments));
    },
    maxServerWallOffsetMilliseconds: () =>
      Math.abs(maxServerTimestamp - Date.now()),
    candidateInventoryRequests: () =>
      structuredClone(candidateInventoryRequests),
    candidateLifecycleRequests: () =>
      structuredClone(candidateLifecycleRequests),
    currentOpenCandidateRequests: () =>
      structuredClone(currentOpenCandidateRequests),
    ledgerTipCommitSha: () => refTarget,
    ledgerLatestEnvelope: () => {
      const entries = reachableRecordEntries();
      return entries.length === 0
        ? null
        : structuredClone(entries.at(-1).record);
    },
    ledgerCapabilityReceipt: () => {
      const attestation = reachableRecords().findLast((record) =>
        record.record_type === "capability-attestation");
      return attestation === undefined
        ? null
        : structuredClone(attestation.payload.capability_receipt);
    },
    ledgerLatestCheckpointState,
    materializeHistoricalLedgerEnvelope,
    setCandidateNumbers(numbers) {
      if (
        candidateInventorySnapshots !== null ||
        currentOpenCandidateSnapshots !== null ||
        !Array.isArray(numbers)
      ) {
        throw new TypeError(
          "mutable candidate numbers require the default inventory fixtures",
        );
      }
      configuredCandidateNumbers = structuredClone(numbers);
      candidateInventoryUniverse = configuredCandidateNumbers;
    },
    ledgerRecordCount: () => reachableRecords().length,
    candidateInventoryPhases: () => reachableRecords()
      .filter((record) =>
        record.record_type === "candidate-inventory-observation")
      .map((record) => record.payload.phase),
    candidateInventoryRecordEntries: () => reachableRecordEntries()
      .filter(({ record }) =>
        record.record_type === "candidate-inventory-observation")
      .map(({ commit_sha: commitSha, record }) => ({
        commit_sha: commitSha,
        phase: record.payload.phase,
        cycle_id: record.payload.cycle_id ?? null,
      })),
    candidateDispatchPhases: () => reachableRecords()
      .filter((record) =>
        record.record_type === "candidate-dispatch-observation")
      .map((record) => record.payload.phase),
    candidateDispatchRecords: () => reachableRecordEntries()
      .filter(({ record }) =>
        record.record_type === "candidate-dispatch-observation")
      .map(({ commit_sha: commitSha, record }) => ({
        commit_sha: commitSha,
        phase: record.payload.phase,
      })),
    effectRecordEntries: () => reachableRecordEntries()
      .filter(({ record }) =>
        new Set(["effect-intent", "effect-response"]).has(
          record.record_type,
        ))
      .map(({ commit_sha: commitSha, record }) => ({
        commit_sha: commitSha,
        record: structuredClone(record),
      })),
    candidateProtocolOrder() {
      const records = reachableRecords();
      const start = records.findIndex((record) =>
        record.record_type === "candidate-dispatch-observation" &&
        record.payload.phase === "reserve");
      if (start < 0) return [];
      return records.slice(start)
        .filter((record) => new Set([
          "candidate-dispatch-observation",
          "lease-acquire",
          "lease-release",
          "effect-intent",
          "effect-response",
        ]).has(record.record_type))
        .map((record) => record.record_type ===
            "candidate-dispatch-observation"
          ? `candidate-dispatch:${record.payload.phase}`
          : `${record.record_type}:${record.kind ?? ""}`);
    },
    failNextRecordUpdates(...recordKinds) {
      for (const kind of recordKinds) {
        failedRecordUpdates.set(kind, (failedRecordUpdates.get(kind) ?? 0) + 1);
      }
    },
    failNextDurableRecordUpdates(...recordKinds) {
      for (const kind of recordKinds) {
        durableFailedRecordUpdates.set(
          kind,
          (durableFailedRecordUpdates.get(kind) ?? 0) + 1,
        );
      }
    },
    setArtifactBindingEqualDateReads(count) {
      artifactBindingEqualDateAlways = false;
      artifactBindingEqualDateReadsRemaining = count;
    },
    setArtifactBindingEqualDateAlways(value = true) {
      artifactBindingEqualDateAlways = value;
      artifactBindingEqualDateReadsRemaining = 0;
    },
    artifactBindingPointReadRequests: () =>
      structuredClone(artifactBindingPointReadRequests),
    artifactBindingReadyConfirmationRecoveryReceiptDigests: () =>
      reachableRecordEntries()
        .filter(({ record }) =>
          record.record_type === "effect-response" &&
          record.kind === "artifact-binding-ready")
        .map(({ commit_sha: commitSha, record }) =>
          gitLedgerDigestDomain(
            "codex-review-gate-v2-git-ledger-recovered-private-append",
            {
              label:
                "automatic-recovery-artifact-binding-ready-confirmation",
              commit_sha: commitSha,
              envelope_digest: record.envelope_digest,
            },
          )),
    failArtifactBindingPointReadAt(ordinal) {
      failedArtifactBindingPointReadOrdinals.add(ordinal);
    },
    failRecordUpdateAt(recordKind, ordinal) {
      const ordinals = failedRecordUpdateOrdinals.get(recordKind) ?? new Set();
      ordinals.add(ordinal);
      failedRecordUpdateOrdinals.set(recordKind, ordinals);
    },
    failNextCandidatePhase(recordType, phase) {
      const key = `phase:${recordType}:${phase}`;
      failedRecordUpdates.set(key, (failedRecordUpdates.get(key) ?? 0) + 1);
    },
    effectRecordKinds,
    schedulerObservationActions() {
      return [...blobs.values()]
        .flatMap(({ content }) => {
          try {
            return [JSON.parse(content)];
          } catch {
            return [];
          }
        })
        .filter((record) =>
          record.record_type === "effect-intent" &&
          record.kind === "scheduler-observation")
        .map((record) => structuredClone(record.payload.action));
    },
  };

  function isLedgerGitPath(path) {
    return new Set([
      "/git/blobs",
      "/git/trees",
      "/git/commits",
      "/git/refs",
      "/git/refs/heads/codex-review-gate-ledger-v2",
      "/git/ref/heads/codex-review-gate-ledger-v2",
    ]).has(path) ||
      /^\/git\/(?:blobs|trees|commits)\/[0-9a-f]{40}$/u.test(path);
  }

  async function ledgerFetch(path, method, init) {
    const date = currentDate();
    if (new Set(["POST", "PATCH", "DELETE"]).has(method)) {
      ledgerWriteRequests.push(`${method} ${path}`);
    }
    if (method === "GET" && path === "/branches/codex-review-gate-ledger-v2") {
      if (refTarget === null) return ledgerResponse(404, { message: "Not Found" }, date);
      return ledgerResponse(200, {
        name: "codex-review-gate-ledger-v2",
        commit: { sha: refTarget },
      }, date);
    }
    if (method === "GET" &&
        path === "/rules/branches/codex-review-gate-ledger-v2") {
      return preflight.fetch(
        `${apiOrigin}/repos/owner/repo/rules/branches/` +
          "codex-review-gate-ledger-v2",
        init,
      );
    }
    if (method === "GET" && new Set(["/rulesets", "/rulesets/30"]).has(path)) {
      return preflight.fetch(`${apiOrigin}/repos/owner/repo${path}`, init);
    }
    if (method === "POST" && path === "/git/blobs") {
      const body = JSON.parse(init.body);
      const bytes = body.encoding === "base64"
        ? Buffer.from(body.content, "base64")
        : Buffer.from(body.content, "utf8");
      const sha = gitObjectSha("blob", bytes);
      blobs.set(sha, {
        sha,
        bytes,
        content: bytes.toString("utf8"),
      });
      return ledgerResponse(201, { sha, url: `${apiOrigin}/blob/${sha}` }, date);
    }
    if (method === "POST" && path === "/git/trees") {
      const body = JSON.parse(init.body);
      const sha = canonicalTreeSha(body.tree);
      trees.set(sha, { sha, tree: structuredClone(body.tree) });
      return ledgerResponse(201, { sha, tree: body.tree }, date);
    }
    if (method === "POST" && path === "/git/commits") {
      const body = JSON.parse(init.body);
      const bytes = Buffer.from([
        `tree ${body.tree}`,
        ...body.parents.map((parent) => `parent ${parent}`),
        `author ${body.author.name} <${body.author.email}> ` +
          `${Math.floor(Date.parse(body.author.date) / 1000)} +0000`,
        `committer ${body.committer.name} <${body.committer.email}> ` +
          `${Math.floor(Date.parse(body.committer.date) / 1000)} +0000`,
        "",
        body.message,
      ].join("\n"), "utf8");
      const sha = gitObjectSha("commit", bytes);
      const commit = {
        sha,
        message: body.message,
        tree: { sha: body.tree },
        parents: body.parents.map((parent) => ({ sha: parent })),
        author: structuredClone(body.author),
        committer: structuredClone(body.committer),
      };
      commits.set(sha, commit);
      return ledgerResponse(201, commit, date);
    }
    if (method === "POST" && path === "/git/refs") {
      const body = JSON.parse(init.body);
      refTarget = body.sha;
      return ledgerResponse(201, refBody(refTarget), date);
    }
    if (method === "PATCH" &&
        path === "/git/refs/heads/codex-review-gate-ledger-v2") {
      const body = JSON.parse(init.body);
      if (!isFastForwardCommit(body.sha, refTarget)) {
        return ledgerResponse(422, {
          message: "Update is not a fast forward",
          documentation_url:
            "https://docs.github.com/rest/git/refs#update-a-reference",
          status: "422",
        }, date);
      }
      const candidateRecord = recordForCommit(body.sha);
      const candidateKind =
        `${candidateRecord.record_type}:${candidateRecord.kind ?? ""}`;
      const updateOrdinal = (recordUpdateCounts.get(candidateKind) ?? 0) + 1;
      recordUpdateCounts.set(candidateKind, updateOrdinal);
      const ordinalFailures = failedRecordUpdateOrdinals.get(candidateKind);
      const ordinalFailure = ordinalFailures?.delete(updateOrdinal) === true;
      const phaseKind = typeof candidateRecord.payload?.phase === "string"
        ? `phase:${candidateRecord.record_type}:${candidateRecord.payload.phase}`
        : null;
      const failureKey = phaseKind !== null &&
          (failedRecordUpdates.get(phaseKind) ?? 0) > 0
        ? phaseKind
        : candidateKind;
      const failuresRemaining = failedRecordUpdates.get(failureKey) ?? 0;
      if (ordinalFailure || failuresRemaining > 0) {
        failedRecordUpdates.set(failureKey, failuresRemaining - 1);
        return ledgerResponse(500, {
          message: "Internal Server Error",
          documentation_url: "https://docs.github.com/rest",
          status: "500",
        }, date);
      }
      const durableFailuresRemaining =
        durableFailedRecordUpdates.get(candidateKind) ?? 0;
      if (durableFailuresRemaining > 0) {
        durableFailedRecordUpdates.set(
          candidateKind,
          durableFailuresRemaining - 1,
        );
        refTarget = body.sha;
        const type = recordType(refTarget);
        if (type === "lease-acquire") activeLease = true;
        if (type === "lease-release") activeLease = false;
        return ledgerResponse(500, {
          message: "Internal Server Error",
          documentation_url: "https://docs.github.com/rest",
          status: "500",
        }, date);
      }
      if (
        failRelease && recordType(body.sha) === "lease-release" &&
        (failReleaseMode === "next" ||
          effectRecordKinds().includes("effect-intent:status-write"))
      ) {
        failRelease = false;
        return ledgerResponse(500, {
          message: "Internal Server Error",
          documentation_url: "https://docs.github.com/rest",
          status: "500",
        }, date);
      }
      refTarget = body.sha;
      const type = recordType(refTarget);
      if (type === "lease-acquire") activeLease = true;
      if (type === "lease-release") activeLease = false;
      return ledgerResponse(200, refBody(refTarget), date);
    }
    if (method === "GET" &&
        path === "/git/ref/heads/codex-review-gate-ledger-v2") {
      if (refTarget === null) {
        return ledgerResponse(404, {
          message: "Not Found",
          documentation_url:
            "https://docs.github.com/rest/git/refs#get-a-reference",
          status: "404",
        }, date);
      }
      return ledgerResponse(200, refBody(refTarget), date);
    }
    const commitMatch = path.match(/^\/git\/commits\/([0-9a-f]{40})$/u);
    if (method === "GET" && commitMatch !== null) {
      return ledgerResponse(200, commits.get(commitMatch[1]), date);
    }
    const treeMatch = path.match(/^\/git\/trees\/([0-9a-f]{40})$/u);
    if (method === "GET" && treeMatch !== null) {
      return ledgerResponse(200, trees.get(treeMatch[1]), date);
    }
    const blobMatch = path.match(/^\/git\/blobs\/([0-9a-f]{40})$/u);
    if (method === "GET" && blobMatch !== null) {
      const blob = blobs.get(blobMatch[1]);
      return ledgerResponse(200, {
        sha: blob.sha,
        encoding: "base64",
        content: Buffer.from(blob.bytes).toString("base64"),
      }, date);
    }
    if (new Set(["POST", "PATCH", "DELETE"]).has(method)) {
      externalWrites.push(`${method} ${path}`);
    }
    throw new Error(`unexpected ledger fixture request ${method} ${path}`);
  }

  async function redated(original, { advance = true } = {}) {
    const raw = await original.text();
    const headers = new Headers(original.headers);
    headers.set("date", advance ? nextDate() : currentDate());
    headers.set("content-length", String(Buffer.byteLength(raw)));
    return new Response(raw, { status: original.status, headers });
  }

  function nextDate() {
    serverTimeOffsetMilliseconds += serverTimeStepMilliseconds;
    return currentDate();
  }

  function advancePastCurrentServerSecond() {
    const currentServerSecond = currentDate();
    do {
      serverTimeOffsetMilliseconds += serverTimeStepMilliseconds;
    } while (currentDate() === currentServerSecond);
  }

  function currentDate() {
    const logicalTimestamp =
      Date.parse(baseTime) + serverTimeOffsetMilliseconds;
    const rendered = new Date(
      authoritativeWallClock
        ? Math.max(logicalTimestamp, Date.now(), maxServerTimestamp)
        : logicalTimestamp,
    ).toUTCString();
    maxServerTimestamp = Math.max(maxServerTimestamp, Date.parse(rendered));
    return rendered;
  }

  function isFastForwardCommit(candidateSha, currentSha) {
    let cursor = candidateSha;
    while (cursor !== null) {
      if (cursor === currentSha) return true;
      cursor = commits.get(cursor)?.parents?.[0]?.sha ?? null;
    }
    return false;
  }

  function refBody(sha) {
    return {
      ref: V2_GIT_LEDGER_REF,
      node_id: "REF_ledger",
      object: { type: "commit", sha },
    };
  }

  function recordType(commitSha) {
    const commit = commits.get(commitSha);
    const tree = trees.get(commit.tree.sha);
    const blob = blobs.get(tree.tree[0].sha);
    return JSON.parse(blob.content).record_type;
  }

  function effectRecordKinds() {
    return reachableRecords()
      .filter((record) => new Set([
        "lease-acquire",
        "lease-release",
        "effect-intent",
        "effect-response",
      ]).has(record.record_type))
      .map((record) => `${record.record_type}:${record.kind ?? ""}`);
  }

  function hasReadyAutomaticArtifactBinding() {
    const records = reachableRecords();
    const latestAcquireIndex = records.findLastIndex((record) =>
      record.record_type === "lease-acquire");
    const currentRunHasSchedulerObservation = records
      .slice(latestAcquireIndex + 1)
      .some((record) =>
        record.record_type === "effect-intent" &&
        record.kind === "scheduler-observation");
    if (!currentRunHasSchedulerObservation) return false;
    return records.some((intent) =>
      intent.record_type === "effect-intent" &&
      intent.kind === "artifact-binding" &&
      !records.some((response) =>
        response.record_type === "effect-response" &&
        response.kind === "artifact-binding" &&
        response.effect_id === intent.effect_id) &&
      records.some((ready) =>
        ready.record_type === "effect-response" &&
        ready.kind === "artifact-binding-ready" &&
        ready.effect_id === `${intent.effect_id}:ready`));
  }

  function isExactProviderArtifactPath(path) {
    return /^\/repos\/owner\/repo\/issues\/comments\/[1-9][0-9]*$/u
      .test(path) ||
      /^\/repos\/owner\/repo\/pulls\/[1-9][0-9]*\/reviews\/[1-9][0-9]*$/u
        .test(path);
  }

  function allIssueComments(pullNumber) {
    const issuePath = `/repos/owner/repo/issues/${pullNumber}`;
    return [
      ...snapshotIssueComments,
      ...requests.values(),
    ].filter((comment) =>
      new URL(comment.issue_url).pathname === issuePath)
      .map((comment) => structuredClone(comment)).sort((left, right) =>
      Date.parse(left.created_at) - Date.parse(right.created_at) ||
      Number(left.id) - Number(right.id));
  }

  function reachableRecords() {
    return reachableRecordEntries().map(({ record }) => record);
  }

  function materializeHistoricalLedgerEnvelope(envelope) {
    assert.equal(envelope.predecessor_commit_sha, refTarget);
    const bytes = Buffer.from(`${canonicalJson(envelope)}\n`, "utf8");
    const blobSha = gitObjectSha("blob", bytes);
    blobs.set(blobSha, {
      sha: blobSha,
      bytes,
      content: bytes.toString("utf8"),
    });
    const treeEntries = [{
      path: V2_GIT_LEDGER_BLOB_PATH,
      mode: "100644",
      type: "blob",
      sha: blobSha,
    }];
    const treeSha = canonicalTreeSha(treeEntries);
    trees.set(treeSha, { sha: treeSha, tree: treeEntries });
    const identity = {
      name: "Codex Review Gate",
      email: "codex-review-gate@users.noreply.github.com",
      date: envelope.server_observed_at,
    };
    const message =
      `Codex Review Gate v2: ${envelope.record_type} #${envelope.sequence}`;
    const commitBytes = Buffer.from([
      `tree ${treeSha}`,
      `parent ${refTarget}`,
      `author ${identity.name} <${identity.email}> ` +
        `${Math.floor(Date.parse(identity.date) / 1000)} +0000`,
      `committer ${identity.name} <${identity.email}> ` +
        `${Math.floor(Date.parse(identity.date) / 1000)} +0000`,
      "",
      message,
    ].join("\n"), "utf8");
    const commitSha = gitObjectSha("commit", commitBytes);
    commits.set(commitSha, {
      sha: commitSha,
      message,
      tree: { sha: treeSha },
      parents: [{ sha: refTarget }],
      author: structuredClone(identity),
      committer: structuredClone(identity),
    });
    refTarget = commitSha;
    return {
      commit_sha: commitSha,
      parents: [envelope.predecessor_commit_sha],
      tree_sha: treeSha,
      blob_sha: blobSha,
      envelope: structuredClone(envelope),
    };
  }

  function ledgerLatestCheckpointState() {
    let cursor = refTarget;
    while (cursor !== null) {
      const commit = commits.get(cursor);
      const rootTree = commit === undefined
        ? undefined
        : trees.get(commit.tree.sha);
      const stateTreeEntry = rootTree?.tree.find(({ path: entryPath }) =>
        entryPath === V2_GIT_LEDGER_CHECKPOINT_STATE_PATH);
      if (stateTreeEntry !== undefined) {
        const stateTree = trees.get(stateTreeEntry.sha);
        const stateBlobEntry = stateTree?.tree.find(({ path: entryPath }) =>
          entryPath === V2_GIT_LEDGER_CHECKPOINT_STATE_BLOB_PATH);
        const stateBlob = stateBlobEntry === undefined
          ? undefined
          : blobs.get(stateBlobEntry.sha);
        assert.notEqual(stateBlob, undefined);
        return JSON.parse(stateBlob.content);
      }
      cursor = commit?.parents[0]?.sha ?? null;
    }
    return null;
  }

  function reachableRecordEntries() {
    const reachable = [];
    let cursor = refTarget;
    while (cursor !== null) {
      const commit = commits.get(cursor);
      if (commit === undefined) break;
      reachable.push({
        commit_sha: cursor,
        record: recordForCommit(cursor),
      });
      cursor = commit.parents[0]?.sha ?? null;
    }
    return reachable.reverse();
  }

  function recordForCommit(commitSha) {
    const commit = commits.get(commitSha);
    const tree = trees.get(commit.tree.sha);
    const blobEntry = tree.tree.find(({ path: entryPath }) =>
      entryPath === V2_GIT_LEDGER_BLOB_PATH);
    const blob = blobs.get(blobEntry.sha);
    return JSON.parse(blob.content);
  }

  function candidateInventoryListPull(number) {
    return {
      id: String(1000 + number),
      node_id: `PR_${number}`,
      number,
      created_at: new Date(
        Date.parse("2026-08-01T00:00:00.000Z") + number * 1_000,
      ).toISOString(),
      url: `${apiOrigin}/repos/owner/repo/pulls/${number}`,
    };
  }

  function candidateInventoryExactPull(number, lifecycleState = "open") {
    return {
      ...candidateInventoryListPull(number),
      state: lifecycleState,
      merged: false,
      merged_at: null,
      updated_at: TIME,
      draft: false,
      mergeable: true,
      merge_commit_sha: fixtureMergeForPull(number),
      base: {
        ref: "main",
        sha: BASE,
        repo: {
          id: 42,
          node_id: "R_repo",
          full_name: "owner/repo",
        },
      },
      head: {
        ref: fixtureHeadRefForPull(number),
        sha: fixtureHeadForPull(number),
        repo: {
          id: 42,
          node_id: "R_repo",
          full_name: "owner/repo",
        },
      },
    };
  }

  function candidateCurrentOpenGraphqlPull(number) {
    const repository = {
      id: "R_repo",
      databaseId: 42,
      nameWithOwner: "owner/repo",
    };
    return {
      id: `PR_${number}`,
      fullDatabaseId: String(1000 + number),
      number,
      state: "OPEN",
      isDraft: false,
      createdAt: candidateInventoryListPull(number).created_at,
      updatedAt: TIME,
      headRefOid: fixtureHeadForPull(number),
      headRefName: fixtureHeadRefForPull(number),
      baseRefOid: BASE,
      baseRefName: "main",
      headRepository: repository,
      baseRepository: repository,
    };
  }
}

function productionOidcFixture(command, liveTime) {
  const jobWorkflowRef =
    `Joey-Tools/codex-review-gate-action/.github/workflows/` +
    `codex-review-gate.yml@${command.workflow_receipt.revision}`;
  const claimOverrides = {
    event_name: command.invocation.event_name,
    job_workflow_ref: jobWorkflowRef,
    job_workflow_sha: command.workflow_receipt.checkout_sha,
    workflow_ref: command.workflow_receipt.caller_workflow_ref,
    workflow_sha: command.workflow_receipt.caller_workflow_sha,
    run_id: command.invocation.run_id,
    run_attempt: String(command.invocation.run_attempt),
  };
  const fixture = oidcFixture({
    subjectOverride: `repo:owner/repo:job_workflow_ref:${jobWorkflowRef}`,
    jwtTime: liveTime,
    tokenLifetimeSeconds: 3_600,
    claimOverrides,
  });
  return {
    ...fixture,
    bindCommand(nextCommand) {
      claimOverrides.event_name = nextCommand.invocation.event_name;
      claimOverrides.run_id = nextCommand.invocation.run_id;
      claimOverrides.run_attempt = String(nextCommand.invocation.run_attempt);
      claimOverrides.workflow_ref =
        nextCommand.workflow_receipt.caller_workflow_ref;
      claimOverrides.workflow_sha =
        nextCommand.workflow_receipt.caller_workflow_sha;
    },
  };
}

function ledgerResponse(status, value, date) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { date, "content-type": "application/json" },
  });
}

function gitObjectSha(type, bytes) {
  return createHash("sha1")
    .update(Buffer.from(`${type} ${bytes.byteLength}\0`, "utf8"))
    .update(bytes)
    .digest("hex");
}

function canonicalTreeSha(entries) {
  const ordered = structuredClone(entries).sort((left, right) =>
    Buffer.compare(
      Buffer.from(`${left.path}${left.type === "tree" ? "/" : ""}`, "utf8"),
      Buffer.from(`${right.path}${right.type === "tree" ? "/" : ""}`, "utf8"),
    ));
  return gitObjectSha("tree", Buffer.concat(ordered.map((entry) =>
    Buffer.concat([
      Buffer.from(`${entry.mode} ${entry.path}\0`, "utf8"),
      Buffer.from(entry.sha, "hex"),
    ]))));
}

function oidcFixture({
  fixedJti = null,
  omitJti = false,
  headerOverrides = {},
  jwksKeyOverrides = {},
  duplicateJwksKey = false,
  claimOverrides = {},
  omitClaim = null,
  invalidSignature = false,
  subjectOverride = null,
  jwtTime = TIME,
  tokenLifetimeSeconds = 300,
} = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const invalidPrivateKey = invalidSignature
    ? generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
    : null;
  const publicJwk = publicKey.export({ format: "jwk" });
  const discoveryBody = {
    issuer: "https://token.actions.githubusercontent.com",
    jwks_uri: "https://token.actions.githubusercontent.com/.well-known/jwks",
    id_token_signing_alg_values_supported: ["RS256"],
    claims_supported: [...V2_GIT_LEDGER_OIDC_CLAIMS].sort(),
  };
  const jwksKey = {
    kty: "RSA",
    use: "sig",
    alg: "RS256",
    kid: "fixture-kid",
    n: publicJwk.n,
    e: publicJwk.e,
    ...jwksKeyOverrides,
  };
  const jwksBody = {
    keys: duplicateJwksKey
      ? [jwksKey, structuredClone(jwksKey)]
      : [jwksKey],
  };
  const discoveryRaw = JSON.stringify(discoveryBody);
  const jwksRaw = JSON.stringify(jwksBody);
  const subject = subjectOverride ?? "repo:owner/repo:pull_request";
  const policy = {
    issuer: "https://token.actions.githubusercontent.com",
    audience: V2_GIT_LEDGER_OIDC_AUDIENCE,
    discovery_url:
      "https://token.actions.githubusercontent.com/.well-known/openid-configuration",
    jwks_uri: "https://token.actions.githubusercontent.com/.well-known/jwks",
    algorithm: "RS256",
    required_claims: [...V2_GIT_LEDGER_OIDC_CLAIMS].sort(),
    claims_supported: [...V2_GIT_LEDGER_OIDC_CLAIMS].sort(),
    repository_owner_id: "88",
    subject_pattern: subject,
    subject_pattern_digest: ledgerDigestDomain(
      "codex-review-gate-v2-oidc-subject-pattern",
      subject,
    ),
    subject_policy_receipt_digest: `sha256:${"4".repeat(64)}`,
    execution_policy_receipt_digest: `sha256:${"5".repeat(64)}`,
    replay_registry_policy_receipt_digest: `sha256:${"6".repeat(64)}`,
    fork_pull_requests_api_only: true,
    candidate_code_execution_blocked: true,
    allowed_event_names: ["pull_request_target"],
    allowed_refs: ["refs/heads/main"],
  };
  const calls = [];
  const tokens = [];
  let mintOrdinal = 0;
  const fetch = async (urlValue, init) => {
    const url = new URL(urlValue);
    if (url.href ===
        "https://token.actions.githubusercontent.com/.well-known/openid-configuration") {
      calls.push({ kind: "discovery" });
      return jsonResponse(discoveryRaw);
    }
    if (url.href === "https://token.actions.githubusercontent.com/.well-known/jwks") {
      calls.push({ kind: "jwks" });
      return jsonResponse(jwksRaw);
    }
    mintOrdinal += 1;
    const audience = url.searchParams.get("audience");
    calls.push({
      kind: "mint",
      audience,
      authorization: init.headers.Authorization,
    });
    const epoch = Math.floor(Date.parse(jwtTime) / 1000);
    const claims = {
      aud: audience,
      event_name: "pull_request_target",
      exp: epoch + tokenLifetimeSeconds,
      iat: epoch - 1,
      iss: "https://token.actions.githubusercontent.com",
      job_workflow_ref:
        `Joey-Tools/codex-review-gate-action/.github/workflows/` +
        `codex-review-gate.yml@${"9".repeat(40)}`,
      job_workflow_sha: "9".repeat(40),
      nbf: epoch - 1,
      ref: "refs/heads/main",
      repository: "owner/repo",
      repository_id: "42",
      repository_owner_id: "88",
      run_attempt: "1",
      run_id: "9001",
      sha: BASE,
      sub: subject,
      workflow_ref:
        "owner/repo/.github/workflows/controller.yml@refs/heads/main",
      workflow_sha: "8".repeat(40),
      actor: "unprojected-extra-claim",
    };
    if (!omitJti) claims.jti = fixedJti ?? `fixture-jti-${mintOrdinal}`;
    Object.assign(claims, claimOverrides);
    if (omitClaim !== null) delete claims[omitClaim];
    const header = {
      alg: "RS256",
      kid: "fixture-kid",
      typ: "JWT",
      ...headerOverrides,
    };
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
    const encodedClaims = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const signingInput = `${encodedHeader}.${encodedClaims}`;
    const signature = sign(
      "RSA-SHA256",
      Buffer.from(signingInput),
      invalidPrivateKey ?? privateKey,
    )
      .toString("base64url");
    const token = `${signingInput}.${signature}`;
    tokens.push(token);
    return jsonResponse(JSON.stringify({ value: token }));
  };
  return {
    fetch,
    calls,
    tokens,
    policy,
    discoveryRawDigest: sha256(discoveryRaw),
    environment: {
      ACTIONS_ID_TOKEN_REQUEST_URL:
        "https://pipelinesghubeus8.actions.githubusercontent.com/tenant/" +
        "00000000-0000-0000-0000-000000000000/_apis/distributedtask/hubs/" +
        "Actions/plans/11111111-1111-1111-1111-111111111111/jobs/" +
        "22222222-2222-2222-2222-222222222222/idtoken?api-version=2.0",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "codex_synth_v1_bearer_a",
    },
  };
}

function oidcRequestFixture(suffix) {
  const input = {
    schema: "codex-review-gate-git-ledger-provenance-request-v2",
    schema_version: 1,
    operation: "load",
    repository: {
      owner: "owner",
      name: "repo",
      id: "42",
      node_id: "R_repo",
      owner_id: "88",
    },
    ledger_ref: "refs/heads/codex-review-gate-ledger-v2",
    predecessor_commit_sha: suffix.repeat(40),
    protection_receipt_digest: `sha256:${"7".repeat(64)}`,
    source_workflow: {
      repository: {
        owner: "Joey-Tools",
        name: "codex-review-gate-action",
        id: "4242",
      },
      workflow_path: ".github/workflows/codex-review-gate.yml",
      workflow_ref:
        "owner/repo/.github/workflows/controller.yml@refs/heads/main",
      workflow_sha: "8".repeat(40),
      job_workflow_ref:
        `Joey-Tools/codex-review-gate-action/.github/workflows/` +
        `codex-review-gate.yml@${"9".repeat(40)}`,
      job_workflow_sha: "9".repeat(40),
      caller_workflow_file_receipt_digest: `sha256:${"a".repeat(64)}`,
      job_workflow_file_receipt_digest: `sha256:${"b".repeat(64)}`,
      release_receipt_digest: `sha256:${"c".repeat(64)}`,
    },
    effect_scope: null,
    evaluated_scope_receipt: null,
    record_identity: null,
    github_server_time: TIME,
  };
  const nonce = ledgerDigestDomain(
    "codex-review-gate-v2-git-ledger-provenance-nonce",
    input,
  );
  const withoutDigest = {
    ...input,
    nonce,
    audience: `${V2_GIT_LEDGER_OIDC_AUDIENCE}:${nonce.slice("sha256:".length)}`,
  };
  return {
    ...withoutDigest,
    request_digest: ledgerDigestDomain(
      "codex-review-gate-v2-git-ledger-provenance-request",
      withoutDigest,
    ),
  };
}

function resealOidcRequestFixture(value) {
  const {
    nonce: _nonce,
    audience: _audience,
    request_digest: _requestDigest,
    ...input
  } = structuredClone(value);
  const nonce = ledgerDigestDomain(
    "codex-review-gate-v2-git-ledger-provenance-nonce",
    input,
  );
  const withoutDigest = {
    ...input,
    nonce,
    audience: `${V2_GIT_LEDGER_OIDC_AUDIENCE}:${nonce.slice("sha256:".length)}`,
  };
  return {
    ...withoutDigest,
    request_digest: ledgerDigestDomain(
      "codex-review-gate-v2-git-ledger-provenance-request",
      withoutDigest,
    ),
  };
}

function checkpointOidcRequestFixture(suffix) {
  return resealOidcRequestFixture({
    ...oidcRequestFixture(suffix),
    operation: "checkpoint-rotate",
    effect_scope: null,
    evaluated_scope_receipt: null,
    record_identity: {
      record_type: "epoch-checkpoint",
      kind: null,
      effect_id: null,
      idempotency_key: null,
      payload_digest: `sha256:${"d".repeat(64)}`,
    },
  });
}

function oidcVerifierRequest(
  mode,
  provenanceRequest,
  compactJwt = null,
  storedReceipt = null,
) {
  return {
    schema: V2_GIT_LEDGER_PROVENANCE_VERIFIER_REQUEST_SCHEMA,
    schema_version: 1,
    mode,
    provenance_request: structuredClone(provenanceRequest),
    compact_jwt: compactJwt,
    stored_receipt: storedReceipt === null
      ? null
      : structuredClone(storedReceipt),
  };
}

function oidcVerifierExecutionContext({
  signal = new AbortController().signal,
  deadline_ms = 15_000,
} = {}) {
  return { signal, deadline_ms };
}

function minimalScopeFixture(rawStates) {
  const states = rawStates.map((raw) => {
    const base = raw.base ?? BASE;
    const head = raw.head ?? HEAD;
    return {
      base,
      head,
      potential: raw.potential === undefined
        ? potentialMerge(base, head)
        : raw.potential,
      mergeable: raw.mergeable ?? "MERGEABLE",
      updatedAt: raw.updatedAt ?? TIME,
      state: raw.state ?? "OPEN",
      merged: raw.merged ?? false,
      mergedAt: raw.mergedAt ?? null,
    };
  });
  const events = [];
  let scan = 0;
  const stateAt = (index) => states[Math.min(index, states.length - 1)];
  const fetch = async (urlValue, init) => {
    const url = new URL(urlValue);
    const state = stateAt(scan);
    events.push(`scope-request:${scan}:${init.method}:${url.pathname}`);
    if (url.pathname === "/repos/owner/repo/pulls/7") {
      return jsonResponse(JSON.stringify({
        number: 7,
        url: "https://api.github.test/repos/owner/repo/pulls/7",
        node_id: "PR_7",
        state: state.merged ? "closed" : state.state.toLowerCase(),
        merged: state.merged,
        merged_at: state.mergedAt,
        updated_at: state.updatedAt,
      }));
    }
    if (url.pathname === "/graphql") {
      const body = JSON.parse(init.body);
      assert.match(body.query, /updatedAt/u);
      return jsonResponse(JSON.stringify({
        data: {
          repository: {
            id: "R_repo",
            name: "repo",
            owner: { login: "owner" },
            pullRequest: {
              id: "PR_7",
              number: 7,
              state: state.merged ? "MERGED" : state.state,
              merged: state.merged,
              mergedAt: state.mergedAt,
              isDraft: false,
              updatedAt: state.updatedAt,
              mergeable: state.mergeable,
              baseRefName: "main",
              baseRef: { name: "main", target: { oid: state.base } },
              headRefName: "feature",
              headRefOid: state.head,
              headRef: { name: "feature", target: { oid: state.head } },
              potentialMergeCommit: state.potential === null ? null : {
                oid: state.potential.oid,
                tree: { oid: state.potential.tree },
                parents: {
                  totalCount: state.potential.parents.length,
                  pageInfo: { hasNextPage: false, endCursor: "cursor" },
                  nodes: state.potential.parents.map((oid) => ({ oid })),
                },
              },
            },
          },
        },
      }));
    }
    if (url.pathname.startsWith("/repos/owner/repo/compare/")) {
      return jsonResponse(JSON.stringify({
        base_commit: { sha: state.base },
        merge_base_commit: { sha: state.base },
      }));
    }
    if (url.pathname === "/repos/owner/repo/git/ref/pull/7/merge") {
      const responseValue = state.potential === null
        ? jsonResponse(JSON.stringify({ message: "Not Found" }), 404)
        : jsonResponse(JSON.stringify({
            ref: "refs/pull/7/merge",
            url: "https://api.github.test/repos/owner/repo/git/refs/pull/7/merge",
            object: {
              type: "commit",
              sha: state.potential.oid,
              url: `https://api.github.test/repos/owner/repo/git/commits/${state.potential.oid}`,
            },
          }));
      events.push(`scope-complete:${scan}`);
      scan += 1;
      return responseValue;
    }
    throw new Error(`unexpected minimal-scope request ${url.href}`);
  };
  return {
    fetch,
    events,
    snapshot(index) {
      return snapshotFromMinimalState(stateAt(index));
    },
  };
}

function potentialMerge(base, head) {
  return {
    oid: MERGE,
    tree: "e".repeat(40),
    parents: [base, head],
  };
}

async function loadMinimalFixture(fixture) {
  return loadV2MinimalLiveScope({
    fetch: fixture.fetch,
    token: "synthetic-token-for-v2-controller-tests-only",
    repository: { owner: "owner", name: "repo" },
    pull_number: 7,
    rest_base_url: "https://api.github.test",
    graphql_url: "https://api.github.test/graphql",
  });
}

function snapshotFromMinimalScope(receipt) {
  const scopeReceipt = {
    repository_owner: receipt.repository.owner,
    repository_name: receipt.repository.name,
    repository_node_id: receipt.repository.node_id,
    pull_request_number: receipt.pull_request.number,
    pull_request_node_id: receipt.pull_request.node_id,
    pull_request_state: receipt.pull_request.state,
    pull_request_merged: receipt.pull_request.merged,
    pull_request_merged_at: receipt.pull_request.merged_at,
    pull_request_is_draft: receipt.pull_request.is_draft,
    ...structuredClone(receipt.scope),
    server_time: receipt.observed_at,
  };
  return {
    repository: structuredClone(receipt.repository),
    pull_request: {
      number: receipt.pull_request.number,
      node_id: receipt.pull_request.node_id,
      state: receipt.pull_request.state,
      merged: receipt.pull_request.merged,
      merged_at: receipt.pull_request.merged_at,
      is_draft: receipt.pull_request.is_draft,
    },
    scope: structuredClone(receipt.scope),
    scope_receipts: {
      pre: structuredClone(scopeReceipt),
      post: structuredClone(scopeReceipt),
    },
  };
}

function snapshotFromMinimalState(state) {
  const potential = state.potential;
  const receipt = {
    repository: { owner: "owner", name: "repo", node_id: "R_repo" },
    pull_request: {
      number: 7,
      node_id: "PR_7",
      state: state.merged ? "MERGED" : state.state,
      merged: state.merged,
      merged_at: state.mergedAt,
      is_draft: false,
      updated_at: state.updatedAt,
    },
    scope: {
      base_ref_name: "main",
      base_ref_tip: state.base,
      head_ref_name: "feature",
      head_ref_oid: state.head,
      merge_base_sha: state.base,
      potential_merge_oid: potential?.oid ?? null,
      potential_merge_tree: potential?.tree ?? null,
      ordered_parent_oids: potential?.parents ?? [],
      merge_ref_oid: potential?.oid ?? null,
      mergeable: state.mergeable,
    },
    observed_at: TIME,
  };
  return snapshotFromMinimalScope(receipt);
}

function leasedDiscoveryCommand() {
  return {
    repository: { owner: "owner", name: "repo" },
    pull_request: { number: 7 },
    invocation: {
      run_id: "9001",
      run_attempt: 1,
      actor_id: "88",
    },
  };
}

function completeSnapshotFetch({
  apiOrigin = "https://api.github.test",
  issueComments = [],
} = {}) {
  return async (input, options = {}) => {
    const url = new URL(String(input));
    const method = String(options.method ?? "GET").toUpperCase();
    const repoPath = "/repos/owner/repo";
    if (url.pathname === "/graphql" && method === "POST") {
      const body = JSON.parse(options.body);
      if (String(body.query).includes("CodexReviewGateV2Scope")) {
        const pullNumber = Number(body.variables?.number);
        const head = fixtureHeadForPull(pullNumber);
        const headRefName = fixtureHeadRefForPull(pullNumber);
        const merge = fixtureMergeForPull(pullNumber);
        const tree = fixtureTreeForPull(pullNumber);
        return jsonResponse(JSON.stringify({
          data: {
            repository: {
              id: "R_repo",
              name: "repo",
              owner: { login: "owner" },
              pullRequest: {
                id: `PR_${pullNumber}`,
                number: pullNumber,
                state: "OPEN",
                merged: false,
                mergedAt: null,
                isDraft: false,
                updatedAt: TIME,
                mergeable: "MERGEABLE",
                baseRefName: "main",
                baseRef: { name: "main", target: { oid: BASE } },
                headRefName,
                headRefOid: head,
                headRef: { name: headRefName, target: { oid: head } },
                potentialMergeCommit: {
                  oid: merge,
                  tree: { oid: tree },
                  parents: {
                    totalCount: 2,
                    pageInfo: { hasNextPage: false, endCursor: "parent-2" },
                    nodes: [{ oid: BASE }, { oid: head }],
                  },
                },
              },
            },
          },
        }));
      }
      if (String(body.query).includes("CodexReviewGateV2ReviewThreads")) {
        return jsonResponse(JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  nodes: [],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          },
        }));
      }
      return jsonResponse(JSON.stringify({
        errors: [{ message: "unexpected test GraphQL query" }],
      }));
    }
    const pullMatch = url.pathname.match(
      /^\/repos\/owner\/repo\/pulls\/([1-9][0-9]*)$/u,
    );
    if (pullMatch !== null) {
      const pullNumber = Number(pullMatch[1]);
      const head = fixtureHeadForPull(pullNumber);
      const headRefName = fixtureHeadRefForPull(pullNumber);
      const merge = fixtureMergeForPull(pullNumber);
      return jsonResponse(JSON.stringify({
        number: pullNumber,
        node_id: `PR_${pullNumber}`,
        url: `${apiOrigin}/repos/owner/repo/pulls/${pullNumber}`,
        state: "open",
        merged: false,
        merged_at: null,
        updated_at: TIME,
        mergeable: true,
        merge_commit_sha: merge,
        base: { ref: "main", sha: BASE },
        head: { ref: headRefName, sha: head },
      }));
    }
    const compareMatch = url.pathname.match(
      /^\/repos\/owner\/repo\/compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})$/u,
    );
    if (compareMatch !== null && compareMatch[1] === BASE) {
      return jsonResponse(JSON.stringify({
        base_commit: { sha: BASE },
        merge_base_commit: { sha: BASE },
      }));
    }
    const mergeRefMatch = url.pathname.match(
      /^\/repos\/owner\/repo\/git\/ref\/pull\/([1-9][0-9]*)\/merge$/u,
    );
    if (mergeRefMatch !== null) {
      const pullNumber = Number(mergeRefMatch[1]);
      const merge = fixtureMergeForPull(pullNumber);
      return jsonResponse(JSON.stringify({
        ref: `refs/pull/${pullNumber}/merge`,
        url: `${apiOrigin}/repos/owner/repo/git/refs/pull/${pullNumber}/merge`,
        object: {
          type: "commit",
          sha: merge,
          url: `${apiOrigin}/repos/owner/repo/git/commits/${merge}`,
        },
      }));
    }
    if (/^\/repos\/owner\/repo\/commits\/[0-9a-f]{40}\/check-runs$/u
      .test(url.pathname)) {
      return jsonResponse(JSON.stringify({ total_count: 0, check_runs: [] }));
    }
    const issueCommentsMatch = url.pathname.match(
      /^\/repos\/owner\/repo\/issues\/([1-9][0-9]*)\/comments$/u,
    );
    if (issueCommentsMatch !== null) {
      const pullNumber = Number(issueCommentsMatch[1]);
      return jsonResponse(JSON.stringify(issueComments.filter((comment) =>
        new URL(comment.issue_url).pathname ===
          `${repoPath}/issues/${pullNumber}`)));
    }
    const issueCommentMatch = url.pathname.match(
      /^\/repos\/owner\/repo\/issues\/comments\/([1-9][0-9]*)$/u,
    );
    if (issueCommentMatch !== null) {
      const comment = issueComments.find((candidate) =>
        String(candidate.id) === issueCommentMatch[1]);
      return comment === undefined
        ? jsonResponse(JSON.stringify({ message: "Not Found" }), 404)
        : jsonResponse(JSON.stringify(comment));
    }
    if (
      /^\/repos\/owner\/repo\/(?:pulls\/[1-9][0-9]*\/(?:reviews|comments)|issues\/[1-9][0-9]*\/reactions)$/u
        .test(url.pathname)
    ) {
      return jsonResponse("[]");
    }
    if (url.pathname === `${repoPath}/collaborators/maintainer/permission`) {
      return jsonResponse(JSON.stringify({
        permission: "write",
        role_name: "write",
        user: {
          id: 7001,
          node_id: "U_maintainer",
          login: "maintainer",
          type: "User",
          site_admin: false,
          permissions: {
            admin: false,
            maintain: false,
            push: true,
            triage: true,
            pull: true,
          },
        },
      }));
    }
    if (url.pathname === repoPath) {
      return jsonResponse(JSON.stringify({
        full_name: "owner/repo",
        url: `${apiOrigin}/repos/owner/repo`,
        role_name: "admin",
        permissions: {
          admin: true,
          maintain: true,
          push: true,
          triage: true,
          pull: true,
        },
      }));
    }
    return jsonResponse(JSON.stringify({
      message: `unexpected complete snapshot route ${method} ${url.pathname}`,
    }), 404);
  };
}

function productionTerminalFindingIssueComment() {
  return {
    id: 202,
    node_id: "IC_202",
    url: "https://api.github.com/repos/owner/repo/issues/comments/202",
    html_url: "https://github.com/owner/repo/pull/7#issuecomment-202",
    issue_url: "https://api.github.com/repos/owner/repo/issues/7",
    author_association: "NONE",
    body:
      "### 💡 Codex Review\n\n" +
      `- [P1] Fix this finding https://github.com/owner/repo/blob/${HEAD}/` +
      "src/example.mjs#L10",
    created_at: "2026-08-13T12:00:10.000Z",
    updated_at: "2026-08-13T12:00:10.000Z",
    user: {
      id: 9001,
      node_id: "BOT_codex",
      login: "chatgpt-codex-connector[bot]",
      type: "Bot",
    },
    performed_via_github_app: {
      id: 15368,
      node_id: "APP_codex",
      slug: "chatgpt-codex-connector",
    },
  };
}

async function withProductionAutomaticRecoveryScenario(callback, {
  serverTimeStepMilliseconds = 500,
} = {}) {
  return withWorkflowCliFixture({
    eventName: "pull_request_target",
    event: { pull_request: { number: 7 } },
    route: "ordinary",
    pullRequest: "7",
  }, async ({ environment, runnerTemp }) => {
    const command = await prepareV2WorkflowCommand(environment);
    const liveTime = new Date().toISOString();
    const oidc = productionOidcFixture(command, liveTime);
    const github = productionControllerGitHubFixture(command, oidc, liveTime, {
      serverTimeStepMilliseconds,
    });
    const firstEnvironment = {
      ...environment,
      ...oidc.environment,
      GITHUB_TOKEN: "synthetic-token-for-v2-controller-tests-only",
      GITHUB_API_URL: "https://api.github.com",
    };
    const initial = await runV2WorkflowControllerCli(firstEnvironment, {
      fetch: github.fetch,
    });
    let runOrdinal = 0;
    const runLeg = async (name) => {
      runOrdinal += 1;
      const legEnvironment = await makeWorkflowLegEnvironment({
        environment: firstEnvironment,
        runnerTemp,
        name,
        runId: String(200_000 + runOrdinal),
        route: "ordinary",
        pullRequest: "7",
      });
      const legCommand = await prepareV2WorkflowCommand(legEnvironment);
      oidc.bindCommand(legCommand);
      return runV2WorkflowControllerCli(legEnvironment, {
        fetch: github.fetch,
      });
    };
    const addFindings = (ids) => {
      const request = github.requestComments().at(-1);
      assert.ok(request, "automatic recovery request exists");
      ids.forEach((id, index) => {
        const finding = productionAutomaticRecoveryFinding({ id, request });
        const createdAt = new Date(
          Date.parse(finding.created_at) + index * 1_000,
        ).toISOString();
        finding.created_at = createdAt;
        finding.updated_at = createdAt;
        const address = productionAutomaticRecoveryAddress({
          id: id + 1,
          finding,
        });
        github.addSnapshotIssueComments(finding, address);
      });
    };
    await callback({
      github,
      initial,
      runLeg,
      addFindings,
    });
  });
}

function productionAutomaticRecoveryFinding({ id, request }) {
  const apiOrigin = new URL(request.url).origin;
  const createdAt = new Date(
    Date.parse(request.created_at) + 1_000,
  ).toISOString();
  return {
    id,
    node_id: `IC_${id}`,
    url: `${apiOrigin}/repos/owner/repo/issues/comments/${id}`,
    html_url: `https://github.com/owner/repo/pull/7#issuecomment-${id}`,
    issue_url: `${apiOrigin}/repos/owner/repo/issues/7`,
    author_association: "NONE",
    body:
      "### 💡 Codex Review\n\n" +
      `- [P1] Fix generation finding https://github.com/owner/repo/blob/${HEAD}/` +
      `src/generation-${id}.mjs#L10`,
    created_at: createdAt,
    updated_at: createdAt,
    user: {
      id: 199175422,
      node_id: "BOT_kgDOC98s_g",
      login: "chatgpt-codex-connector[bot]",
      type: "Bot",
    },
    performed_via_github_app: {
      id: 1144995,
      node_id: "A_kwHOAOQ6Gs4AEXij",
      slug: "chatgpt-codex-connector",
    },
  };
}

function productionAutomaticRecoveryAddress({ id, finding }) {
  const apiOrigin = new URL(finding.url).origin;
  const createdAt = new Date(
    Date.parse(finding.created_at) + 1_000,
  ).toISOString();
  return {
    id,
    node_id: `IC_${id}`,
    url: `${apiOrigin}/repos/owner/repo/issues/comments/${id}`,
    html_url: `https://github.com/owner/repo/pull/7#issuecomment-${id}`,
    issue_url: `${apiOrigin}/repos/owner/repo/issues/7`,
    author_association: "MEMBER",
    body: `/codex-gate addressed ${finding.html_url}`,
    created_at: createdAt,
    updated_at: createdAt,
    user: {
      id: 7001,
      node_id: "U_maintainer",
      login: "maintainer",
      type: "User",
    },
    performed_via_github_app: null,
  };
}

function jsonResponse(raw, status = 200) {
  return new Response(raw, {
    status,
    headers: {
      date: "Thu, 13 Aug 2026 12:00:00 GMT",
      "content-length": String(Buffer.byteLength(raw)),
      "content-type": "application/json",
    },
  });
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function digestDomain(domain, value) {
  const bytes = canonicalJson(value);
  return `sha256:${createHash("sha256")
    .update(`${Buffer.byteLength(domain)}:${domain}\0`)
    .update(`${Buffer.byteLength(bytes)}:${bytes}`)
    .digest("hex")}`;
}

function gitLedgerDigestDomain(domain, value) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0${canonicalJson(value)}`)
    .digest("hex")}`;
}

function ledgerDigestDomain(domain, value) {
  return sha256(`${domain}\0${canonicalJson(value)}`);
}

async function withWorkflowCliFixture(options, callback) {
  const root = await mkdtemp(join(tmpdir(), "codex-review-gate-v2-controller-"));
  const runnerTemp = join(root, "runner-temp");
  const workspace = join(root, "workspace");
  await mkdir(runnerTemp);
  await mkdir(workspace);
  const eventPath = join(root, "event.json");
  await writeFile(eventPath, JSON.stringify(options.event), { mode: 0o600 });
  const environment = {
    RUNNER_TEMP: runnerTemp,
    GITHUB_WORKSPACE: workspace,
    GITHUB_REPOSITORY: "owner/repo",
    GITHUB_EVENT_NAME: options.eventName,
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: BASE,
    GITHUB_RUN_ID: "123456",
    GITHUB_RUN_ATTEMPT: "2",
    GITHUB_ACTOR_ID: "789",
    GITHUB_WORKFLOW_REF:
      "owner/repo/.github/workflows/codex-review-gate-reconcile.yml@refs/heads/main",
    GITHUB_WORKFLOW_SHA: MERGE,
    V2_CONTROLLER_EVENT_PATH: eventPath,
    V2_CONTROLLER_INPUT_PATH: join(runnerTemp, "command.json"),
    V2_CONTROLLER_OUTPUT_PATH: join(runnerTemp, "output.json"),
    V2_CONTROLLER_ROUTE: options.route,
    V2_CONTROLLER_OBSERVATION_BOUNDARY:
      options.observationBoundary ?? "initial",
    V2_CONTROLLER_PULL_REQUEST: options.pullRequest,
    V2_CONTROLLER_DISPATCH_BINDING: options.dispatchBinding === undefined
      ? ""
      : typeof options.dispatchBinding === "string"
        ? options.dispatchBinding
        : canonicalJson(options.dispatchBinding),
    V2_SELECTION_POLICY: "joey-default",
    V2_STATUS_CONTEXT,
    V2_STATUS_TARGET_MODE,
    V2_EXPECTED_WORKFLOW_REPOSITORY: "Joey-Tools/codex-review-gate-action",
    V2_ACTUAL_WORKFLOW_REPOSITORY: "Joey-Tools/codex-review-gate-action",
    V2_EXPECTED_WORKFLOW_PATH: V2_WORKFLOW_PATH,
    V2_EXPECTED_WORKFLOW_SHA: HEAD,
    V2_CHECKED_OUT_RELEASE_SHA: HEAD,
    V2_PUBLIC_WAIT_PREFLIGHT_REQUIRED: "true",
    V2_PUBLIC_WAIT_MINUTES: "15",
    V2_PUBLIC_WAIT_ENVIRONMENT_INITIAL:
      "codex-review-gate-public-initial-15m",
    V2_PUBLIC_WAIT_ENVIRONMENT_POST_REQUEST:
      "codex-review-gate-public-post-request-15m",
    V2_PUBLIC_WAIT_ENVIRONMENT_NO_START:
      "codex-review-gate-public-no-start-15m",
  };
  try {
    await callback({ root, runnerTemp, workspace, eventPath, environment });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function makeWorkflowLegEnvironment({
  environment,
  runnerTemp,
  name,
  runId,
  route,
  pullRequest,
  dispatchBinding = "",
  githubOutput = null,
}) {
  const directory = join(runnerTemp, name);
  await mkdir(directory);
  return {
    ...environment,
    RUNNER_TEMP: directory,
    GITHUB_RUN_ID: runId,
    GITHUB_RUN_ATTEMPT: "1",
    V2_CONTROLLER_INPUT_PATH: join(directory, "command.json"),
    V2_CONTROLLER_OUTPUT_PATH: join(directory, "output.json"),
    V2_CONTROLLER_ROUTE: route,
    V2_CONTROLLER_PULL_REQUEST: pullRequest,
    V2_CONTROLLER_DISPATCH_BINDING: dispatchBinding,
    ...(githubOutput === null ? {} : { GITHUB_OUTPUT: githubOutput }),
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertNoProtectedProductionInternals(value, path = "production-cycle") {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoProtectedProductionInternals(item, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;
  const forbidden = new Set([
    "compact_jwt",
    "artifact_binding_candidate_handle",
    "artifact_binding_intent_handle",
    "closure_records",
    "envelope",
    "evidence_snapshot",
    "full_snapshot",
    "payload",
    "provider_artifact_handles",
    "ready_reachability_boundary",
    "record",
    "recovery_handle",
    "reducer_report",
    "scheduler_evaluation",
    "scheduler_plan",
    "token",
    "workflow_provenance_jwt",
  ]);
  for (const [key, item] of Object.entries(value)) {
    assert.equal(
      forbidden.has(key),
      false,
      `${path}.${key} leaks a protected production internal`,
    );
    assertNoProtectedProductionInternals(item, `${path}.${key}`);
  }
}

function assertNoDispatchAuthorityInternals(value, path = "schedule-matrix") {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoDispatchAuthorityInternals(item, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    assert.doesNotMatch(
      key,
      /(?:handle|receipt|record|payload|envelope|jwt)/iu,
      `${path}.${key} leaks dispatch authority internals`,
    );
    assertNoDispatchAuthorityInternals(item, `${path}.${key}`);
  }
}

function assertFixtureServerClockWithinOidcSkew(github) {
  assert.ok(
    github.maxServerWallOffsetMilliseconds() < 300_000,
    "fixture GitHub Date must remain inside the production OIDC clock-skew cap",
  );
}

function response(status, body, date) {
  return {
    status,
    headers: { get: (name) => name.toLowerCase() === "date" ? date : null },
    async text() { return body; },
  };
}

function reservationFixture() {
  return {
    schema: "codex-review-gate-request-reservation-v2",
    schema_version: 1,
    repository: { owner: "owner", name: "repo", node_id: "R_repo" },
    pull_request: { number: 7, node_id: "PR_7" },
    epoch_head_sha: HEAD,
    ordinal: 1,
    scheduler_intent_id: "scheduler-intent",
    intent_id: "v2-request:intent",
    intent_digest: `sha256:${"2".repeat(64)}`,
    attempt_id: `v2-attempt:${"3".repeat(64)}`,
    body: "@codex review",
    created_at: TIME,
    automatic: true,
    consumed: true,
    pre_scope_digest: `sha256:${"4".repeat(64)}`,
    status_ledger_binding: {},
    reservation_digest: `sha256:${"5".repeat(64)}`,
  };
}

function statusWrite({ role, sha, state, suffix }) {
  return {
    role,
    sha,
    context: "codex/github-review-gate",
    state,
    reason: `decision-${state}`,
    idempotency_key: `status:${suffix.repeat(64)}`,
  };
}
