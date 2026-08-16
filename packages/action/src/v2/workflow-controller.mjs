import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";
import { Buffer } from "node:buffer";
import { constants as fsConstants } from "node:fs";
import {
  appendFile,
  lstat,
  mkdir,
  open,
  realpath,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TextDecoder } from "node:util";

import { V2_STATUS_CONTEXT } from "./projection.mjs";
import { assertV2PublicReport } from "./public-report.mjs";
import { reduceV2Snapshot } from "./reducer.mjs";
import { PUBLIC_INITIAL_WAIT_MS } from "./scheduler.mjs";
import {
  MAX_V2_WORKFLOW_COMMAND_BYTES,
  MAX_V2_WORKFLOW_EVENT_BYTES,
  prepareV2WorkflowCommand,
  readV2WorkflowCommand,
  validateV2WorkflowCommand,
  V2_WORKFLOW_COMMAND_SCHEMA,
} from "./workflow-command.mjs";
import {
  getV2AutomaticRecoveryArtifactBindingCandidateHandle,
  getV2AutomaticRequestRecoveryHandle,
  runV2Operation,
  V2_RUNNER_SCHEMA,
  V2_RUNNER_SCHEMA_VERSION,
  V2_REQUEST_ATTEMPT_SCHEMA,
  V2_REQUEST_BINDING_SCHEMA,
  V2_REQUEST_RESERVATION_SCHEMA,
} from "./runner.mjs";
import {
  assertV2BlockedConfigurationWorkflowResultHandle,
  assertV2WorkflowGitLedgerHandoffHandle,
  assertV2WorkflowPreflightHandle,
  createV2BlockedConfigurationWorkflowResult,
  createV2GitHubWorkflowPreflight,
  createV2WorkflowGitLedgerHandoff,
  V2_WORKFLOW_PREFLIGHT_LEDGER_REF,
  V2_WORKFLOW_PREFLIGHT_OIDC_ISSUER,
  V2_WORKFLOW_PREFLIGHT_SCHEMA,
  V2_WORKFLOW_PREFLIGHT_SCHEMA_VERSION,
} from "./workflow-preflight.mjs";
import {
  createV2GitHubGitLedger,
  createV2GitHubGitLedgerBootstrap,
  createV2GitLedgerDiscoveryContinuityReceipt,
  projectV2GitLedgerCandidateDispatchBinding,
  projectV2GitLedgerCandidateDispatchPlan,
  projectV2GitLedgerAutomaticReviewRequestTransport,
  projectV2GitLedgerReservationStatusTransport,
  projectV2GitLedgerStatusWriteTransport,
  V2_GIT_LEDGER_CANDIDATE_REFRESH_ADAPTER_SCHEMA,
  V2_GIT_LEDGER_CANDIDATE_REFRESH_RECONCILIATION_SCHEMA,
  V2_GIT_LEDGER_AUTOMATIC_REVIEW_REQUEST_BINDING_RECEIPT_SCHEMA,
  V2_GIT_LEDGER_AUTOMATIC_REVIEW_REQUEST_SCOPE_RECEIPT_SCHEMA,
  V2_GIT_LEDGER_OIDC_AUDIENCE,
  V2_GIT_LEDGER_OIDC_CLAIMS,
  V2_GIT_LEDGER_OPTIONAL_OIDC_CLAIMS,
  V2_GIT_LEDGER_PROVENANCE_REQUEST_SCHEMA,
  V2_GIT_LEDGER_PROVENANCE_RECEIPT_SCHEMA,
  V2_GIT_LEDGER_PROVENANCE_TIMEOUT_MS,
  V2_GIT_LEDGER_PROVENANCE_VERIFIER_REQUEST_SCHEMA,
  V2_GIT_LEDGER_PROVENANCE_VERIFIER_RESULT_SCHEMA,
  validateV2GitLedgerProvenanceReceipt,
  validateV2GitLedgerDiscoveryContinuityReceipt,
  validateV2GitLedgerReservationStatusResponseReceipt,
  validateV2GitLedgerStatusWriteResponseReceipt,
} from "./git-ledger.mjs";
import {
  createV2GitHubCandidateInventory,
  createV2GitHubCurrentOpenCandidateInventory,
  MAX_V2_CANDIDATE_PAGES,
  MAX_V2_CURRENT_OPEN_CANDIDATES,
  MAX_V2_CURRENT_OPEN_CANDIDATE_PAGES,
  MAX_V2_CANDIDATE_SCAN_PASSES,
  V2_CANDIDATE_HTTP_TIMEOUT_MS,
  V2_CURRENT_OPEN_PULL_REQUESTS_QUERY,
} from "./candidate-inventory.mjs";
import {
  assertV2ProductionRunnerAuthorityHandle,
  createV2ControlPlaneReceiptFromGitLedgerAuthority,
  createV2ProductionRunnerAuthority,
} from "./control-plane-receipt.mjs";
import {
  assertV2ProviderPreScopeArtifactEqualsSnapshot,
  createV2GitHubTransport,
  loadV2ProviderPreScopeArtifact,
  projectV2TransportSnapshotForGitLedger,
  V2_SCOPE_QUERY,
} from "./transport.mjs";

export const V2_EFFECT_LEDGER_SCHEMA = "codex-review-gate-effect-ledger-v2";
export const V2_EFFECT_LEDGER_SCHEMA_VERSION = 1;
export const V2_EFFECT_ATTEMPT_SCHEMA = "codex-review-gate-effect-attempt-v2";
export const V2_EFFECT_RESPONSE_SCHEMA = "codex-review-gate-effect-response-v2";
export const V2_EFFECT_LEDGER_COMMENT_MARKER =
  "codex-review-gate-effect-ledger-v2";
export const V2_RESERVATION_STATUS_CONTEXT_PREFIX =
  "codex/github-review-gate-reservation/";
export const MAX_V2_RESERVATION_STATUS_RECORDS = 1_000;
export const V2_WORKFLOW_OUTPUT_SCHEMA = "codex-review-gate-workflow-output-v2";
export const V2_OPEN_PULL_REQUEST_MATRIX_SCHEMA =
  "codex-review-gate-open-pull-request-matrix-v2";
export const V2_OPEN_PULL_REQUEST_DIAGNOSTIC_SCHEMA =
  "codex-review-gate-open-pull-request-diagnostic-v2";
export const V2_PRODUCTION_ASSEMBLY_SCHEMA =
  "codex-review-gate-production-assembly-v2";
export const MAX_V2_OPEN_PULL_REQUEST_MATRIX_JOBS = 256;
export const MAX_V2_SCHEDULE_DISPATCH_GITHUB_OUTPUT_UTF16_BYTES =
  1024 * 1024;
export const V2_MINIMAL_SCOPE_RECEIPT_SCHEMA =
  "codex-review-gate-minimal-scope-receipt-v2";
export const V2_GITHUB_OIDC_VERIFIER_SCHEMA =
  "codex-review-gate-github-oidc-verifier-v2";
export const V2_GITHUB_OIDC_ISSUER =
  "https://token.actions.githubusercontent.com";
export const V2_GITHUB_OIDC_DISCOVERY_URL =
  `${V2_GITHUB_OIDC_ISSUER}/.well-known/openid-configuration`;
export const V2_GITHUB_OIDC_JWKS_URL =
  `${V2_GITHUB_OIDC_ISSUER}/.well-known/jwks`;
export const V2_GITHUB_OIDC_HTTP_TIMEOUT_MS =
  V2_GIT_LEDGER_PROVENANCE_TIMEOUT_MS;
export const V2_GITHUB_OIDC_MAX_RESPONSE_BYTES = 1024 * 1024;
export const V2_GITHUB_OIDC_MAX_TOTAL_BYTES = 2 * 1024 * 1024;
export const V2_GITHUB_OIDC_MAX_REQUESTS = 128;
const V2_CANDIDATE_LEGACY_FINISH_REQUEST_SCHEMA =
  "codex-review-gate-git-ledger-candidate-inventory-legacy-finish-request-v2";
const V2_CANDIDATE_LEGACY_FINISH_RESULT_SCHEMA =
  "codex-review-gate-git-ledger-candidate-inventory-legacy-finish-result-v2";
const V2_CURRENT_OPEN_GENERATION_PUBLICATION_SCHEMA =
  "codex-review-gate-git-ledger-current-open-generation-publication-v3";
const V2_CANDIDATE_LEGACY_FINISH_PUBLICATION_SCHEMA =
  "codex-review-gate-git-ledger-candidate-inventory-legacy-finish-publication-v2";
export const V2_MINIMAL_SCOPE_QUERY = V2_SCOPE_QUERY.replace(
  "        isDraft\n",
  "        isDraft\n        updatedAt\n",
);
export {
  MAX_V2_WORKFLOW_COMMAND_BYTES,
  MAX_V2_WORKFLOW_EVENT_BYTES,
  readV2WorkflowCommand,
  validateV2WorkflowCommand,
  V2_WORKFLOW_COMMAND_SCHEMA,
};

const PROVIDER_EVENT_ARTIFACTS = Object.freeze({
  issue_comment: Object.freeze({ event_key: "comment", kind: "issue_comment" }),
  pull_request_review: Object.freeze({
    event_key: "review",
    kind: "pull_request_review",
  }),
  pull_request_review_comment: Object.freeze({
    event_key: "comment",
    kind: "inline_comment",
  }),
});

// Object identity is the protected property: only a receipt returned directly
// by loadV2MinimalLiveScope in this process may cross the pre-lease boundary.
const V2_MINIMAL_LIVE_SCOPE_HANDLES = new WeakMap();

// The protected property is same-process causal continuity. Only the exact
// pre-scope, lease, full transport snapshot, and post-scope objects observed in
// this invocation may produce a full-discovery authority handle.
const V2_LEASED_DISCOVERY_CONTINUITY_HANDLES = new WeakMap();

const EFFECT_KINDS = new Set([
  "request-comment",
  "commit-status",
  "sticky-comment",
]);
const STATUS_STATES = new Set(["pending", "success", "failure", "error"]);
const STATUS_ROLES = new Set([
  "primary-terminal",
  "head-sentinel",
]);
const STATUS_TARGET_MODES = new Set([
  "head",
  "test-merge-with-head-sentinel",
]);
const STATUS_PLAN_DECISIONS = new Set([
  "not-selected",
  "pending",
  "clean",
  "findings",
  "inconclusive",
  "skipped-unavailable",
  "blocked-configuration",
  "blocked-input",
]);
const HEAD_MODE_SUPPRESSED_DECISIONS = new Set([
  "clean",
  "skipped-unavailable",
]);
const PUBLIC_WAIT_NO_START_DECISIONS = new Set([
  "skipped-unavailable",
  "blocked-configuration",
]);
const PUBLIC_WAIT_PENDING_DECISIONS = new Set([
  "pending",
  "inconclusive",
]);
const PUBLIC_WAIT_AUTOMATIC_REQUEST_STATES = new Set([
  "available",
  "intent-persisted",
  "effect-attempted",
]);
const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const STRICT_UTC_TIMESTAMP =
  /^(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d{1,3}))?Z$/u;
const WORKFLOW_OUTPUT_NAMES = Object.freeze([
  "decision",
  "report-path",
  "status-plan-path",
  "reservation-path",
  "intent-path",
  "binding-receipt-path",
  "sticky-receipt-path",
  "ledger-receipt-path",
  "due-at",
  "wakeup-hints",
]);

export class V2WorkflowControllerError extends Error {
  constructor(code, message, details = null, cause = undefined) {
    super(message);
    this.name = "V2WorkflowControllerError";
    this.code = code;
    this.details = details;
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * Legacy compatibility harness for the pre-Git-ledger prototype. Its comment
 * WAL and reservation statuses are never production authority and production
 * CLI assembly must not call this function. Retained exports support bounded
 * migration tests until every downstream consumer uses the protected Git ref.
 */
export async function executeV2ControllerCycle({
  initial_input,
  runner_dependencies,
  ledger_store,
  reservation_ledger,
  effect_transport,
  persist_scheduler_intent,
  persist_request_binding,
  build_runner_input,
  build_sticky_effect,
  run_operation = runV2Operation,
  clock = controllerClock,
}) {
  if (typeof run_operation !== "function") {
    throw new TypeError("controller cycle requires a runner operation function");
  }
  for (const [label, value] of [
    ["ledger_store.loadLedger", ledger_store?.loadLedger],
    ["ledger_store.persistLedger", ledger_store?.persistLedger],
    ["reservation_ledger.persistReservation", reservation_ledger?.persistReservation],
    ["effect_transport.performEffect", effect_transport?.performEffect],
    ["persist_scheduler_intent", persist_scheduler_intent],
    ["persist_request_binding", persist_request_binding],
    ["build_runner_input", build_runner_input],
    ["build_sticky_effect", build_sticky_effect],
    ["clock", clock],
  ]) {
    if (typeof value !== "function") {
      throw new TypeError(`controller cycle requires ${label}`);
    }
  }

  assertObject(initial_input, "initial_input");
  assertObject(initial_input.snapshot_request, "initial_input.snapshot_request");
  assertObject(initial_input.head_ledger, "initial_input.head_ledger");
  const repository = {
    owner: boundedString(initial_input.snapshot_request.owner, "snapshot owner", 100),
    name: boundedString(initial_input.snapshot_request.repo, "snapshot repo", 100),
  };
  const pullNumber = positiveInteger(
    initial_input.snapshot_request.pull_number,
    "snapshot pull_number",
  );
  const ledgerScopeValue = {
    repository_node_id: boundedString(
      initial_input.head_ledger.repository_node_id,
      "head ledger repository_node_id",
      256,
    ),
    pull_request_node_id: boundedString(
      initial_input.head_ledger.pull_request_node_id,
      "head ledger pull_request_node_id",
      256,
    ),
    head_ref_oid: sha(initial_input.head_ledger.head_ref_oid, "head ledger head_ref_oid"),
  };
  const loaded = await ledger_store.loadLedger(ledgerScopeValue);
  let ledger;
  if (loaded === null) {
    ledger = createV2EffectLedger({
      ...ledgerScopeValue,
      created_at: timestamp(initial_input.head_ledger.observed_at, "head ledger observed_at"),
    });
    await persistExactLedger(
      (value) => ledger_store.persistLedger(value),
      ledger,
      "initial",
    );
  } else {
    assertObject(loaded, "loaded effect ledger");
    ledger = validateV2EffectLedger(loaded.ledger);
    if (!sameLedgerScope(ledger, ledgerScopeValue)) {
      throw new Error("loaded effect ledger belongs to another repository, PR, or head");
    }
  }

  const persistLedger = async (value) => ledger_store.persistLedger(value);
  const statusReceipts = [];
  let stickyReceipt = null;
  let bindingReceipt = null;
  let requestCapture = null;
  let bindResult = null;

  const applyStatusWrites = async (result, phase) => {
    assertObject(result, `${phase} runner result`);
    const writes = validateV2StatusWrites(result.status_plan, {
      head_ref_oid: ledgerScopeValue.head_ref_oid,
      status_target_mode: initial_input.status_target_mode,
      public_report: result.report,
    });
    for (const write of writes) {
      const existing = ledger.effects.find((effect) =>
        effect.kind === "commit-status" && effect.idempotency_key === write.idempotency_key);
      if (existing !== undefined) {
        if (existing.state !== "bound") {
          throw new Error(`${phase} status effect is already consumed without an exact response`);
        }
        statusReceipts.push(existing.response.receipt);
        continue;
      }
      ledger = await reserveAndPersistV2Effect({
        ledger,
        kind: "commit-status",
        idempotency_key: write.idempotency_key,
        payload: write,
        recorded_at: clock(`${phase}-status-reserved`, ledger.created_at),
        persist_ledger: persistLedger,
      });
      const effect = ledger.effects.at(-1);
      const outcome = await executeV2EffectOnce({
        ledger,
        effect_id: effect.effect_id,
        attempted_at: clock(`${phase}-status-attempted`, effect.reserved_at),
        persist_ledger: persistLedger,
        perform_effect: (attempted) => effect_transport.performEffect({
          effect: attempted,
          repository,
          pull_number: pullNumber,
        }),
      });
      ledger = outcome.ledger;
      statusReceipts.push(outcome.ledger.effects.at(-1).response.receipt);
    }
  };

  const initialResult = await run_operation(initial_input, runner_dependencies);
  assertPlanOnlyRunnerResult(initialResult, "initial");
  const initialIsTerminal = initialResult.status_plan.terminal_cutover === true;
  if (!initialIsTerminal) {
    await applyStatusWrites(initialResult, "initial");
  }

  if (initialResult.reservation !== null) {
    if (initialResult.post_intent === null) {
      throw new Error("runner returned a request reservation without its retry-zero POST intent");
    }
    const persistAction = initialResult.scheduler_plan.actions.find((action) =>
      action.kind === "persist_auto_request_intent");
    const postAction = initialResult.scheduler_plan.actions.find((action) =>
      action.kind === "post_review_request");
    if (
      persistAction === undefined || postAction === undefined ||
      postAction.depends_on_idempotency_key !== persistAction.idempotency_key ||
      persistAction.intent_id !== initialResult.reservation.scheduler_intent_id ||
      postAction.intent_id !== persistAction.intent_id
    ) {
      throw new Error("request reservation is not authorized by one durable scheduler intent chain");
    }
    const schedulerIntentReceipt = {
      idempotency_key: persistAction.idempotency_key,
      intent_id: persistAction.intent_id,
      persisted_at: initialResult.reservation.created_at,
    };
    await requireExactCallbackEcho(
      persist_scheduler_intent,
      schedulerIntentReceipt,
      "scheduler intent",
    );

    // The independent HEAD status is the budget authority. It must be visible
    // before either the editable comment WAL or the request POST is created.
    await reservation_ledger.persistReservation(initialResult.reservation);

    ledger = await reserveAndPersistV2Effect({
      ledger,
      kind: "request-comment",
      idempotency_key: postAction.idempotency_key,
      payload: {
        reservation: initialResult.reservation,
        attempt: initialResult.post_intent.pre_effect_attempt_receipt,
      },
      recorded_at: initialResult.reservation.created_at,
      persist_ledger: persistLedger,
    });
    const requestEffect = ledger.effects.at(-1);
    const requestOutcome = await executeV2EffectOnce({
      ledger,
      effect_id: requestEffect.effect_id,
      attempted_at: initialResult.post_intent.pre_effect_attempt_receipt.recorded_at,
      persist_ledger: persistLedger,
      perform_effect: (attempted) => effect_transport.performEffect({
        effect: attempted,
        repository,
        pull_number: pullNumber,
      }),
    });
    ledger = requestOutcome.ledger;
    requestCapture = requestOutcome.capture;
    if (!requestOutcome.binding_required) {
      throw new Error("request POST must remain attempted until the runner binds its exact 201 refetch");
    }

    const bindInput = await build_runner_input({
      phase: "bind-request",
      initial_input: structuredClone(initial_input),
      initial_result: structuredClone(initialResult),
      ledger: structuredClone(ledger),
      reservation: structuredClone(initialResult.reservation),
      request_capture: structuredClone(requestCapture),
      scheduler_intent_receipt: schedulerIntentReceipt,
      status_receipts: structuredClone(statusReceipts),
    });
    bindResult = await run_operation(bindInput, runner_dependencies);
    assertPlanOnlyRunnerResult(bindResult, "bind-request");
    if (bindResult.binding_receipt === null) {
      throw new Error("bind-request did not return the exact 201/refetch binding receipt");
    }
    bindingReceipt = bindResult.binding_receipt;
    ledger = await bindAttemptedV2RequestEffect({
      ledger,
      effect_id: requestEffect.effect_id,
      capture: requestCapture,
      binding_receipt: bindingReceipt,
      persist_ledger: persistLedger,
    });
    await requireExactCallbackEcho(
      persist_request_binding,
      bindingReceipt,
      "request binding",
    );
  } else if (initialResult.post_intent !== null) {
    throw new Error("runner returned a POST intent without a consumed reservation");
  }

  const preStickyInput = await build_runner_input({
    phase: "pre-sticky-final-reread",
    initial_input: structuredClone(initial_input),
    initial_result: structuredClone(initialResult),
    bind_result: bindResult === null ? null : structuredClone(bindResult),
    ledger: structuredClone(ledger),
    binding_receipt: bindingReceipt === null ? null : structuredClone(bindingReceipt),
    status_receipts: structuredClone(statusReceipts),
  });
  const preStickyResult = await run_operation(preStickyInput, runner_dependencies);
  assertPlanOnlyRunnerResult(preStickyResult, "pre-sticky-final-reread");
  if (preStickyResult.reservation !== null || preStickyResult.post_intent !== null) {
    throw new Error("final reread unexpectedly authorized another automatic request");
  }

  const sticky = await build_sticky_effect({
    result: structuredClone(preStickyResult),
    ledger: structuredClone(ledger),
    repository: { ...repository },
    pull_number: pullNumber,
  });
  if (sticky !== null) {
    assertObject(sticky, "sticky effect plan");
    if (typeof sticky.body !== "string" || typeof sticky.receipt_builder !== "function") {
      throw new TypeError("sticky effect plan requires exact body and receipt_builder");
    }
    ledger = await reserveAndPersistV2Effect({
      ledger,
      kind: "sticky-comment",
      idempotency_key: boundedString(sticky.idempotency_key, "sticky idempotency_key", 256),
      payload: sticky.payload,
      recorded_at: clock("sticky-reserved", ledger.created_at),
      persist_ledger: persistLedger,
    });
    const stickyEffect = ledger.effects.at(-1);
    const stickyOutcome = await executeV2EffectOnce({
      ledger,
      effect_id: stickyEffect.effect_id,
      attempted_at: clock("sticky-attempted", stickyEffect.reserved_at),
      persist_ledger: persistLedger,
      perform_effect: (attempted) => effect_transport.performEffect({
        effect: attempted,
        repository,
        pull_number: pullNumber,
        sticky_body: sticky.body,
      }),
      receipt_builder: sticky.receipt_builder,
    });
    ledger = stickyOutcome.ledger;
    stickyReceipt = ledger.effects.at(-1).response.receipt;
  }

  const terminalInput = await build_runner_input({
    phase: "terminal-final-reread",
    initial_input: structuredClone(initial_input),
    initial_result: structuredClone(initialResult),
    pre_sticky_result: structuredClone(preStickyResult),
    bind_result: bindResult === null ? null : structuredClone(bindResult),
    ledger: structuredClone(ledger),
    binding_receipt: bindingReceipt === null ? null : structuredClone(bindingReceipt),
    sticky_receipt: stickyReceipt === null ? null : structuredClone(stickyReceipt),
    status_receipts: structuredClone(statusReceipts),
  });
  const terminalResult = await run_operation(terminalInput, runner_dependencies);
  assertPlanOnlyRunnerResult(terminalResult, "terminal-final-reread");
  assertFinalReportContinuity(preStickyResult.reducer_report, terminalResult.reducer_report);
  if (terminalResult.reservation !== null || terminalResult.post_intent !== null) {
    throw new Error("terminal final reread unexpectedly authorized an unexecuted request");
  }
  await applyStatusWrites(terminalResult, "terminal-final-reread");

  return deepFreeze({
    initial_result: initialResult,
    bind_result: bindResult,
    pre_sticky_result: preStickyResult,
    terminal_result: terminalResult,
    request_capture: requestCapture,
    binding_receipt: bindingReceipt,
    sticky_receipt: stickyReceipt,
    status_receipts: statusReceipts,
    ledger,
  });
}

function assertPlanOnlyRunnerResult(value, phase) {
  assertObject(value, `${phase} runner result`);
  if (value.writes_performed !== false) {
    throw new Error(`${phase} runner violated the plan-only effect boundary`);
  }
  assertObject(value.scheduler_plan, `${phase} scheduler_plan`);
  if (!Array.isArray(value.scheduler_plan.actions)) {
    throw new TypeError(`${phase} scheduler_plan.actions must be an array`);
  }
  assertObject(value.status_plan, `${phase} status_plan`);
  if (!Array.isArray(value.status_plan.writes)) {
    throw new TypeError(`${phase} status_plan.writes must be an array`);
  }
  assertObject(value.reducer_report, `${phase} reducer_report`);
  assertV2PublicReport(value.report);
}

async function requireExactCallbackEcho(callback, value, label) {
  const echoed = await callback(structuredClone(value));
  if (canonicalJson(echoed) !== canonicalJson(value)) {
    throw new Error(`${label} persistence did not echo the exact durable value`);
  }
}

function assertFinalReportContinuity(before, after) {
  assertObject(before, "pre-sticky reducer report");
  assertObject(after, "terminal reducer report");
  const semantic = (report) => ({
    selection: report.selection,
    server_enforcement: report.server_enforcement,
    review_epoch: report.review_epoch,
    request_policy: report.request_policy,
    provider_profile: report.provider_profile,
    provider_input_lineage: report.provider_input_lineage,
    evidence_basis: report.evidence_basis,
    status_target: report.status_target,
    decision: report.decision,
  });
  if (canonicalJson(semantic(before)) !== canonicalJson(semantic(after))) {
    throw new Error(
      "provider, scope, decision, or status target changed after sticky projection",
    );
  }
}

function controllerClock(_phase, notBefore = null) {
  const floor = notBefore === null ? 0 : Date.parse(timestamp(notBefore, "clock floor"));
  return new Date(Math.max(Date.now(), floor)).toISOString();
}

/**
 * Build the production GitHub Actions OIDC verifier used by the protected Git
 * ledger. Discovery and JWKS are loaded once per job; every callback invocation
 * mints a new token for the ledger's effect-bound audience. Neither the bearer
 * request token nor the returned JWT is retained in a receipt or error.
 */
export function createV2GitHubOidcProvenanceVerifier(options = {}) {
  assertObject(options, "OIDC verifier options");
  exactKeys(options, [
    "fetch", "environment", "policy", "clock", "http_limits",
  ].filter((key) => options[key] !== undefined), "OIDC verifier options");
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw controllerFailure("OIDC_FETCH_UNAVAILABLE", "OIDC verifier requires fetch");
  }
  const environment = options.environment ?? process.env;
  const policy = options.policy === undefined || options.policy === null
    ? null
    : deepFreeze(structuredClone(options.policy));
  if (policy !== null) assertObject(policy, "OIDC provenance policy");
  const clock = options.clock ?? Date.now;
  if (typeof clock !== "function") {
    throw new TypeError("OIDC verifier clock must be a function");
  }
  const limits = normalizeOidcHttpLimits(options.http_limits ?? {});
  const mintUrl = normalizeActionsOidcRequestUrl(
    requiredEnv(environment, "ACTIONS_ID_TOKEN_REQUEST_URL"),
  );
  const mintToken = requiredSecretEnv(
    environment,
    "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
    16 * 1024,
  );
  const budget = { requests: 0, bytes: 0, last_server_time: null };
  const consumedReplayIdentities = new Set();
  let trustPromise = null;
  const trustMaterial = (signal) => {
    if (signal.aborted) throw oidcAbortFailure(signal);
    trustPromise ??= loadOidcTrustMaterial({
      fetchImpl,
      clock,
      limits,
      budget,
      policy,
      signal,
    });
    return waitForOidcPromise(trustPromise, signal);
  };
  const initialize = async () => {
    const execution = createOidcExecutionDeadline({
      signal: new AbortController().signal,
      deadline_ms: V2_GIT_LEDGER_PROVENANCE_TIMEOUT_MS,
    });
    try {
      const trust = await trustMaterial(execution.signal);
      return deepFreeze({
        schema: V2_GITHUB_OIDC_VERIFIER_SCHEMA,
        schema_version: 1,
        discovery: trust.discovery_receipt,
        jwks: trust.jwks_receipt,
        initialized: true,
      });
    } finally {
      execution.finish();
    }
  };

  const verifyWorkflowProvenance = async (verifierRequest, executionOptions) => {
    const execution = createOidcExecutionDeadline(
      normalizeOidcVerifierExecutionContext(executionOptions),
    );
    try {
      const {
        mode,
        request,
        compact_jwt: storedJwt,
        stored_receipt: storedReceipt,
      } = normalizeOidcVerifierRequest(verifierRequest);
      const trust = await trustMaterial(execution.signal);
      const expectedAudience = validateEffectBoundOidcRequest(request);
      let jwt;
      let minted = null;
      if (mode === "mint-and-verify") {
        const tokenUrl = new URL(mintUrl.href);
        tokenUrl.searchParams.set("audience", expectedAudience);
        minted = await oidcJsonRequest({
          fetchImpl,
          clock,
          limits,
          budget,
          signal: execution.signal,
          url: tokenUrl,
          label: "GitHub Actions OIDC token mint",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${mintToken}`,
          },
        });
        assertObject(minted.data, "GitHub Actions OIDC mint response");
        exactKeys(minted.data, ["value"], "GitHub Actions OIDC mint response");
        jwt = boundedSecret(minted.data.value, "GitHub Actions OIDC JWT", 64 * 1024);
      } else {
        jwt = storedJwt;
        validateV2GitLedgerProvenanceReceipt(storedReceipt, { request });
        if (rawDigest(jwt) !== storedReceipt.token_sha256) {
          throw controllerFailure(
            "OIDC_STORED_TOKEN_DIGEST_MISMATCH",
            "stored OIDC JWT differs from its protected-ledger receipt",
          );
        }
      }
      const verified = verifyGitHubOidcJwt({
        jwt,
        request,
        trust,
      });
      const tokenSha256 = rawDigest(jwt);
      let replayReceiptDigest;
      if (mode === "mint-and-verify") {
        const replayIdentity = verified.claims.jti === undefined
          ? `jwt:${tokenSha256}`
          : `jti:${verified.claims.jti}`;
        if (consumedReplayIdentities.has(replayIdentity)) {
          throw controllerFailure(
            "OIDC_REPLAY_DETECTED",
            "GitHub Actions OIDC token identity was reused within this controller job",
          );
        }
        consumedReplayIdentities.add(replayIdentity);
        replayReceiptDigest = gitLedgerDigestCanonical(
          "codex-review-gate-v2-oidc-replay-prevention",
          {
            request_digest: request.request_digest,
            token_sha256: tokenSha256,
            token_response_server_time: minted.server_time,
            token_response_raw_body_sha256: minted.raw_body_sha256,
            replay_identity_sha256: rawDigest(replayIdentity),
          },
        );
      } else {
        replayReceiptDigest = storedReceipt.replay_prevention_receipt_digest;
      }
      const withoutDigest = {
        schema: V2_GIT_LEDGER_PROVENANCE_RECEIPT_SCHEMA,
        schema_version: 1,
        verified: true,
        signature_verified: true,
        jwks_verified: true,
        live_supported: true,
        issuer: V2_GITHUB_OIDC_ISSUER,
        audience: expectedAudience,
        algorithm: "RS256",
        key_id: verified.key_id,
        claims: verified.claims,
        token_sha256: tokenSha256,
        discovery: trust.discovery_receipt,
        jwks: trust.jwks_receipt,
        verified_at_server_time: request.github_server_time,
        replay_prevention_receipt_digest: replayReceiptDigest,
        operation_binding: oidcOperationBinding(request),
      };
      const receipt = deepFreeze({
        ...withoutDigest,
        receipt_digest: gitLedgerDigestCanonical(
          "codex-review-gate-v2-git-ledger-provenance",
          withoutDigest,
        ),
      });
      validateV2GitLedgerProvenanceReceipt(
        receipt,
        mode === "mint-and-verify" ? { request, policy } : { request },
      );
      return deepFreeze({
        schema: V2_GIT_LEDGER_PROVENANCE_VERIFIER_RESULT_SCHEMA,
        schema_version: 1,
        mode,
        compact_jwt: mode === "mint-and-verify" ? jwt : null,
        receipt,
      });
    } finally {
      execution.finish();
    }
  };

  return Object.freeze({
    schema: V2_GITHUB_OIDC_VERIFIER_SCHEMA,
    schema_version: 1,
    initialize,
    verifyWorkflowProvenance,
  });
}

/**
 * Re-read only the advisory provider selector through a protected descriptor.
 *
 * The protected properties are the event file's object identity, content, and
 * access policy for this read. atime/ctime are deliberately not compared: a
 * benign read may change them without changing any selected property. The
 * exact-byte digest is then required to equal the already validated workflow
 * command, so a later replacement cannot redirect the native artifact GET.
 */
export async function readV2ProviderEventSelector({
  command,
  environment = process.env,
}) {
  assertObject(command, "provider event workflow command");
  const eventName = boundedString(
    command.invocation?.event_name,
    "provider event name",
    128,
  );
  const artifactType = PROVIDER_EVENT_ARTIFACTS[eventName];
  if (
    artifactType === undefined ||
    !new Set(["provider-event", "timer"]).has(command.route?.trigger) ||
    command.pull_request?.number === null ||
    command.pull_request?.number === undefined
  ) {
    throw controllerFailure(
      "PROVIDER_EVENT_ROUTE_REQUIRED",
      "provider artifact pre-scope requires one validated provider-event command",
    );
  }
  const eventPathInput = requiredEnv(environment, "V2_CONTROLLER_EVENT_PATH");
  if (!isAbsolute(eventPathInput)) {
    throw new TypeError("V2_CONTROLLER_EVENT_PATH must be absolute");
  }
  const workspace = await realpath(requiredEnv(environment, "GITHUB_WORKSPACE"));
  const inputInfo = await lstat(eventPathInput, { bigint: true });
  if (inputInfo.isSymbolicLink()) {
    throw controllerFailure(
      "PROVIDER_EVENT_FILE_POLICY_INVALID",
      "provider event path must not be a symbolic link",
    );
  }
  const eventPath = await realpath(eventPathInput);
  if (pathInside(eventPath, workspace)) {
    throw controllerFailure(
      "PROVIDER_EVENT_FILE_POLICY_INVALID",
      "provider event path must remain outside the candidate checkout",
    );
  }
  const before = await lstat(eventPath, { bigint: true });
  assertProviderEventFilePolicy(before, "provider event before read");
  let handle;
  let bytes;
  try {
    handle = await open(
      eventPath,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    const opened = await handle.stat({ bigint: true });
    assertProviderEventFileStable(before, opened, "provider event open");
    bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (bytesRead <= 0) {
        throw controllerFailure(
          "PROVIDER_EVENT_READ_INCOMPLETE",
          "provider event ended before its descriptor-declared size",
        );
      }
      offset += bytesRead;
    }
    const afterRead = await handle.stat({ bigint: true });
    assertProviderEventFileStable(opened, afterRead, "provider event read");
    const pathAfter = await lstat(eventPath, { bigint: true });
    assertProviderEventFileStable(afterRead, pathAfter, "provider event path reread");
  } finally {
    await handle?.close();
  }
  const eventDigest = rawDigest(bytes);
  if (eventDigest !== command.invocation.event_payload_sha256) {
    throw controllerFailure(
      "PROVIDER_EVENT_DIGEST_MISMATCH",
      "provider event bytes differ from the validated workflow command",
    );
  }
  let event;
  try {
    event = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw controllerFailure(
      "PROVIDER_EVENT_JSON_INVALID",
      "provider event is not valid UTF-8 JSON",
      null,
      error,
    );
  }
  assertObject(event, "provider event");
  const carrier = event[artifactType.event_key];
  assertObject(carrier, `provider event ${artifactType.event_key}`);
  const pullNumber = eventName === "issue_comment"
    ? positiveInteger(event.issue?.number, "provider issue number")
    : positiveInteger(
        event.pull_request?.number,
        "provider pull request number",
      );
  if (pullNumber !== command.pull_request.number) {
    throw controllerFailure(
      "PROVIDER_EVENT_PULL_REQUEST_MISMATCH",
      "provider event carrier belongs to another pull request",
    );
  }
  if (eventName === "issue_comment") {
    assertObject(event.issue?.pull_request, "provider issue pull_request marker");
  }
  return deepFreeze({
    event_name: eventName,
    event_payload_sha256: eventDigest,
    pull_request_number: pullNumber,
    selector: {
      kind: artifactType.kind,
      id: providerEventDecimalId(carrier.id, "provider event carrier id"),
    },
  });
}

function assertProviderEventFilePolicy(info, label) {
  if (
    !info.isFile() || info.isSymbolicLink() || info.nlink !== 1n ||
    info.size <= 0n || info.size > BigInt(MAX_V2_WORKFLOW_EVENT_BYTES)
  ) {
    throw controllerFailure(
      "PROVIDER_EVENT_FILE_POLICY_INVALID",
      `${label} is not one bounded ordinary single-link file`,
    );
  }
}

function assertProviderEventFileStable(before, after, label) {
  assertProviderEventFilePolicy(after, label);
  for (const key of ["dev", "ino", "size", "mode", "uid", "gid", "nlink"]) {
    if (before[key] !== after[key]) {
      throw controllerFailure(
        "PROVIDER_EVENT_FILE_CHANGED",
        `${label} changed provider event identity, content size, or access policy`,
      );
    }
  }
}

function providerEventDecimalId(value, label) {
  if (Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^[1-9][0-9]{0,31}$/u.test(value)) {
    return value;
  }
  throw new TypeError(`${label} must be a positive decimal identifier`);
}

function normalizeOidcVerifierExecutionContext(value) {
  assertObject(value, "OIDC provenance verifier execution context");
  exactKeys(
    value,
    ["signal", "deadline_ms"],
    "OIDC provenance verifier execution context",
  );
  if (
    value.signal === null || typeof value.signal !== "object" ||
    typeof value.signal.aborted !== "boolean" ||
    typeof value.signal.addEventListener !== "function" ||
    typeof value.signal.removeEventListener !== "function"
  ) {
    throw new TypeError("OIDC provenance verifier signal must be an AbortSignal");
  }
  if (
    !Number.isSafeInteger(value.deadline_ms) || value.deadline_ms <= 0 ||
    value.deadline_ms > V2_GIT_LEDGER_PROVENANCE_TIMEOUT_MS
  ) {
    throw new TypeError("OIDC provenance verifier deadline may only tighten the ledger maximum");
  }
  return { signal: value.signal, deadline_ms: value.deadline_ms };
}

function createOidcExecutionDeadline({ signal, deadline_ms: deadlineMs }) {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal.reason);
  if (signal.aborted) abortFromCaller();
  else signal.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    controller.abort(controllerFailure(
      "OIDC_VERIFIER_TIMEOUT",
      "OIDC provenance verifier exceeded its fixed deadline",
    ));
  }, deadlineMs);
  return {
    signal: controller.signal,
    finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", abortFromCaller);
    },
  };
}

function oidcAbortFailure(signal) {
  if (signal.reason instanceof V2WorkflowControllerError) {
    return signal.reason;
  }
  return controllerFailure(
    "OIDC_VERIFIER_ABORTED",
    "OIDC provenance verifier was cancelled before completion",
  );
}

function waitForOidcPromise(promise, signal) {
  if (signal.aborted) {
    Promise.resolve(promise).catch(() => {});
    return Promise.reject(oidcAbortFailure(signal));
  }
  return new Promise((resolvePromise, rejectPromise) => {
    const abort = () => rejectPromise(oidcAbortFailure(signal));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolvePromise(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        rejectPromise(error);
      },
    );
  });
}

function normalizeOidcVerifierRequest(value) {
  assertObject(value, "OIDC provenance verifier request");
  exactKeys(value, [
    "schema", "schema_version", "mode", "provenance_request",
    "compact_jwt", "stored_receipt",
  ], "OIDC provenance verifier request");
  if (
    value.schema !== V2_GIT_LEDGER_PROVENANCE_VERIFIER_REQUEST_SCHEMA ||
    value.schema_version !== 1 ||
    !new Set(["mint-and-verify", "reverify-stored"]).has(value.mode)
  ) {
    throw new TypeError("OIDC provenance verifier request schema is invalid");
  }
  if (
    (value.mode === "mint-and-verify" &&
      (value.compact_jwt !== null || value.stored_receipt !== null)) ||
    (value.mode === "reverify-stored" &&
      (value.compact_jwt === null || value.stored_receipt === null))
  ) {
    throw new TypeError("OIDC provenance verifier mode payload is invalid");
  }
  const compactJwt = value.compact_jwt === null
    ? null
    : boundedSecret(value.compact_jwt, "stored GitHub Actions OIDC JWT", 64 * 1024);
  return {
    mode: value.mode,
    request: value.provenance_request,
    compact_jwt: compactJwt,
    stored_receipt: value.stored_receipt,
  };
}

async function loadOidcTrustMaterial({
  fetchImpl,
  clock,
  limits,
  budget,
  policy,
  signal,
}) {
  const discovery = await oidcJsonRequest({
    fetchImpl,
    clock,
    limits,
    budget,
    signal,
    url: new URL(V2_GITHUB_OIDC_DISCOVERY_URL),
    label: "GitHub Actions OIDC discovery",
    headers: { Accept: "application/json" },
  });
  const discoveryBody = normalizeOidcDiscoveryDocument(discovery.data);
  const jwks = await oidcJsonRequest({
    fetchImpl,
    clock,
    limits,
    budget,
    signal,
    url: new URL(V2_GITHUB_OIDC_JWKS_URL),
    label: "GitHub Actions OIDC JWKS",
    headers: { Accept: "application/json" },
  });
  const keys = normalizeOidcJwks(jwks.data);
  const discoveryReceipt = deepFreeze({
    url: V2_GITHUB_OIDC_DISCOVERY_URL,
    server_time: discovery.server_time,
    raw_body_sha256: discovery.raw_body_sha256,
    claims_supported: discoveryBody.claims_supported,
  });
  const jwksReceipt = deepFreeze({
    url: V2_GITHUB_OIDC_JWKS_URL,
    server_time: jwks.server_time,
    raw_body_sha256: jwks.raw_body_sha256,
  });
  if (policy !== null) {
    const expected = {
      issuer: policy.issuer,
      audience: policy.audience,
      discovery_url: policy.discovery_url,
      jwks_uri: policy.jwks_uri,
      algorithm: policy.algorithm,
      required_claims: policy.required_claims,
      claims_supported: policy.claims_supported,
    };
    const actual = {
      issuer: V2_GITHUB_OIDC_ISSUER,
      audience: V2_GIT_LEDGER_OIDC_AUDIENCE,
      discovery_url: V2_GITHUB_OIDC_DISCOVERY_URL,
      jwks_uri: V2_GITHUB_OIDC_JWKS_URL,
      algorithm: "RS256",
      required_claims: [...V2_GIT_LEDGER_OIDC_CLAIMS].sort(),
      claims_supported: discoveryBody.claims_supported,
    };
    if (canonicalJson(expected) !== canonicalJson(actual)) {
      throw controllerFailure(
        "OIDC_POLICY_DRIFT",
        "live GitHub OIDC discovery or JWKS differs from the sealed capability policy",
      );
    }
  }
  return deepFreeze({
    discovery_receipt: discoveryReceipt,
    jwks_receipt: jwksReceipt,
    keys,
  });
}

function normalizeOidcDiscoveryDocument(value) {
  assertObject(value, "OIDC discovery document");
  if (
    value.issuer !== V2_GITHUB_OIDC_ISSUER ||
    value.jwks_uri !== V2_GITHUB_OIDC_JWKS_URL ||
    !Array.isArray(value.id_token_signing_alg_values_supported) ||
    !value.id_token_signing_alg_values_supported.includes("RS256") ||
    !Array.isArray(value.claims_supported)
  ) {
    throw controllerFailure(
      "OIDC_DISCOVERY_UNSUPPORTED",
      "GitHub OIDC discovery does not expose the fixed issuer, JWKS, and RS256 profile",
    );
  }
  const claims = normalizeUniqueStrings(
    value.claims_supported,
    "OIDC discovery claims_supported",
    512,
  );
  for (const claim of V2_GIT_LEDGER_OIDC_CLAIMS) {
    if (!claims.includes(claim)) {
      throw controllerFailure(
        "OIDC_DISCOVERY_CLAIM_MISSING",
        "GitHub OIDC discovery omitted a required protected-ledger claim",
        { claim },
      );
    }
  }
  return { claims_supported: claims };
}

function normalizeOidcJwks(value) {
  assertObject(value, "OIDC JWKS document");
  exactKeys(value, ["keys"], "OIDC JWKS document");
  if (!Array.isArray(value.keys) || value.keys.length === 0 || value.keys.length > 64) {
    throw new TypeError("OIDC JWKS keys must be a non-empty bounded array");
  }
  const byKid = new Map();
  for (const [index, key] of value.keys.entries()) {
    assertObject(key, `OIDC JWKS key[${index}]`);
    const allowed = new Set([
      "alg", "e", "kid", "kty", "n", "use", "x5c", "x5t", "x5t#S256",
    ]);
    if (Object.keys(key).some((name) => !allowed.has(name))) {
      throw new TypeError(`OIDC JWKS key[${index}] contains an unsupported field`);
    }
    if (
      key.kty !== "RSA" || key.use !== "sig" || key.alg !== "RS256" ||
      typeof key.kid !== "string" || key.kid.length === 0 || key.kid.length > 512 ||
      !isCanonicalBase64Url(key.n) || !isCanonicalBase64Url(key.e) ||
      byKid.has(key.kid)
    ) {
      throw new TypeError(`OIDC JWKS key[${index}] is not one unique RSA signing key`);
    }
    let publicKey;
    try {
      publicKey = createPublicKey({
        key: { kty: key.kty, n: key.n, e: key.e },
        format: "jwk",
      });
      const details = publicKey.asymmetricKeyDetails;
      if (
        publicKey.asymmetricKeyType !== "rsa" ||
        !Number.isSafeInteger(details?.modulusLength) ||
        details.modulusLength < 2_048 ||
        typeof details.publicExponent !== "bigint" ||
        details.publicExponent < 3n || details.publicExponent % 2n === 0n
      ) {
        throw new TypeError("OIDC JWKS RSA key parameters are invalid");
      }
    } catch (error) {
      throw controllerFailure(
        "OIDC_JWK_INVALID",
        `OIDC JWKS key[${index}] cannot construct one trusted RSA key`,
        null,
        error,
      );
    }
    byKid.set(key.kid, Object.freeze({
      algorithm: key.alg,
      public_key: publicKey,
    }));
  }
  return Object.freeze({
    has(kid) { return byKid.has(kid); },
    get(kid) { return byKid.get(kid); },
  });
}

function validateCheckpointOidcRecordIdentity(value) {
  assertObject(value, "checkpoint OIDC provenance record_identity");
  exactKeys(value, [
    "record_type", "kind", "effect_id", "idempotency_key", "payload_digest",
  ], "checkpoint OIDC provenance record_identity");
  if (
    value.record_type !== "epoch-checkpoint" ||
    value.kind !== null || value.effect_id !== null ||
    value.idempotency_key !== null || !DIGEST.test(value.payload_digest)
  ) {
    throw new TypeError(
      "checkpoint OIDC provenance record_identity does not bind one exact ledger checkpoint",
    );
  }
}

function validateEffectBoundOidcRequest(request) {
  assertObject(request, "OIDC provenance request");
  exactKeys(request, [
    "schema", "schema_version", "operation", "repository", "ledger_ref",
    "predecessor_commit_sha", "protection_receipt_digest", "source_workflow",
    "effect_scope", "evaluated_scope_receipt", "record_identity",
    "github_server_time", "nonce",
    "audience", "request_digest",
  ], "OIDC provenance request");
  if (
    request.schema !== V2_GIT_LEDGER_PROVENANCE_REQUEST_SCHEMA ||
    request.schema_version !== 1
  ) {
    throw new TypeError("OIDC provenance request schema is invalid");
  }
  digest(request.nonce, "OIDC provenance request.nonce");
  digest(request.request_digest, "OIDC provenance request.request_digest");
  timestamp(request.github_server_time, "OIDC provenance request.github_server_time");
  const repositoryScopedRecord = new Set([
    "candidate-inventory-observation",
    "candidate-dispatch-observation",
  ]).has(request.operation);
  const checkpointRecord = request.operation === "checkpoint-rotate";
  const checkpointIdentity =
    request.record_identity?.record_type === "epoch-checkpoint";
  if (checkpointRecord) {
    if (
      request.effect_scope !== null ||
      request.evaluated_scope_receipt !== null
    ) {
      throw new TypeError(
        "checkpoint OIDC provenance request cannot carry effect scope authority",
      );
    }
    validateCheckpointOidcRecordIdentity(request.record_identity);
  } else if (checkpointIdentity) {
    throw new TypeError(
      "epoch-checkpoint OIDC provenance identity requires checkpoint-rotate",
    );
  }
  if (
    !checkpointRecord && (repositoryScopedRecord
      ? request.effect_scope !== null ||
        request.evaluated_scope_receipt === null || request.record_identity === null
      : (request.effect_scope === null) !==
          (request.evaluated_scope_receipt === null) ||
        (request.effect_scope === null) !== (request.record_identity === null))
  ) {
    throw new TypeError("OIDC provenance request scope authority fields are inconsistent");
  }
  if (request.evaluated_scope_receipt !== null) {
    assertObject(
      request.evaluated_scope_receipt,
      "OIDC provenance request.evaluated_scope_receipt",
    );
  }
  const {
    request_digest: _requestDigest,
    audience: _audience,
    nonce: _nonce,
    ...nonceInput
  } = request;
  const expectedNonce = gitLedgerDigestCanonical(
    "codex-review-gate-v2-git-ledger-provenance-nonce",
    nonceInput,
  );
  const expectedAudience = `${V2_GIT_LEDGER_OIDC_AUDIENCE}:` +
    request.nonce.slice("sha256:".length);
  const { request_digest: _digest, ...withoutDigest } = request;
  if (
    request.nonce !== expectedNonce ||
    request.audience !== expectedAudience ||
    request.request_digest !== gitLedgerDigestCanonical(
      "codex-review-gate-v2-git-ledger-provenance-request",
      withoutDigest,
    )
  ) {
    throw controllerFailure(
      "OIDC_AUDIENCE_MISMATCH",
      "OIDC provenance request does not use the sealed effect-bound ledger nonce and audience",
    );
  }
  return expectedAudience;
}

function verifyGitHubOidcJwt({ jwt, request, trust }) {
  const segments = jwt.split(".");
  if (segments.length !== 3 || segments.some((segment) => !isCanonicalBase64Url(segment))) {
    throw controllerFailure("OIDC_JWT_MALFORMED", "GitHub OIDC token is not canonical JWT");
  }
  const header = parseJwtJson(segments[0], "OIDC JWT header");
  exactKeys(header, ["alg", "kid", "typ"], "OIDC JWT header");
  if (
    header.alg !== "RS256" || header.typ !== "JWT" ||
    typeof header.kid !== "string" || header.kid.length === 0 ||
    header.kid.length > 512
  ) {
    throw controllerFailure(
      "OIDC_JWT_HEADER_UNSUPPORTED",
      "GitHub OIDC token header does not select one trusted RS256 JWT key",
    );
  }
  if (!trust.keys.has(header.kid)) {
    throw controllerFailure(
      "OIDC_KID_UNAVAILABLE",
      "GitHub Actions OIDC token key id is unavailable in the bounded live JWKS",
    );
  }
  const key = trust.keys.get(header.kid);
  if (key.algorithm !== header.alg) {
    throw controllerFailure(
      "OIDC_JWT_HEADER_UNSUPPORTED",
      "GitHub OIDC token header algorithm differs from its trusted key",
    );
  }
  const signature = decodeBase64Url(segments[2], "OIDC JWT signature");
  const valid = verifySignature(
    "RSA-SHA256",
    Buffer.from(`${segments[0]}.${segments[1]}`, "ascii"),
    key.public_key,
    signature,
  );
  if (!valid) {
    throw controllerFailure(
      "OIDC_SIGNATURE_INVALID",
      "GitHub OIDC token signature verification failed",
    );
  }
  const rawClaims = parseJwtJson(segments[1], "OIDC JWT claims");
  const claims = {};
  for (const name of V2_GIT_LEDGER_OIDC_CLAIMS) {
    if (!Object.hasOwn(rawClaims, name)) {
      throw controllerFailure(
        "OIDC_REQUIRED_CLAIM_MISSING",
        "GitHub OIDC token omitted a required protected-ledger claim",
        { claim: name },
      );
    }
    claims[name] = rawClaims[name];
  }
  for (const name of V2_GIT_LEDGER_OPTIONAL_OIDC_CLAIMS) {
    if (Object.hasOwn(rawClaims, name)) claims[name] = rawClaims[name];
  }
  for (const name of V2_GIT_LEDGER_OIDC_CLAIMS) {
    if (new Set(["iat", "nbf", "exp"]).has(name)) {
      if (!Number.isSafeInteger(claims[name]) || claims[name] < 0) {
        throw new TypeError(`OIDC claim ${name} must be a non-negative safe integer`);
      }
    } else if (typeof claims[name] !== "string" || claims[name].length === 0 ||
        claims[name].length > 1024) {
      throw new TypeError(`OIDC claim ${name} must be a bounded non-empty string`);
    }
  }
  if (claims.jti !== undefined &&
      (typeof claims.jti !== "string" || claims.jti.length === 0 || claims.jti.length > 1024)) {
    throw new TypeError("OIDC claim jti must be a bounded non-empty string");
  }
  const verifiedEpoch = Math.floor(
    Date.parse(timestamp(
      request.github_server_time,
      "OIDC provenance request.github_server_time",
    )) / 1000,
  );
  if (
    claims.iss !== V2_GITHUB_OIDC_ISSUER ||
    claims.aud !== request.audience ||
    verifiedEpoch < claims.nbf || verifiedEpoch > claims.exp ||
    claims.iat > verifiedEpoch || claims.iat > claims.exp || claims.nbf > claims.exp
  ) {
    throw controllerFailure(
      "OIDC_CLAIMS_INVALID",
      "GitHub OIDC claims do not bind the exact audience and server-time window",
    );
  }
  return { key_id: header.kid, claims: deepFreeze(claims) };
}

function oidcOperationBinding(request) {
  const keys = [
    "operation", "repository", "ledger_ref", "predecessor_commit_sha",
    "protection_receipt_digest", "source_workflow", "effect_scope",
    "evaluated_scope_receipt", "record_identity", "github_server_time",
    "nonce", "audience",
    "request_digest",
  ];
  const binding = {};
  for (const key of keys) {
    if (!Object.hasOwn(request, key)) {
      throw new TypeError(`OIDC provenance request omitted ${key}`);
    }
    binding[key] = structuredClone(request[key]);
  }
  return binding;
}

function normalizeActionsOidcRequestUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw controllerFailure(
      "OIDC_MINT_URL_INVALID",
      "ACTIONS_ID_TOKEN_REQUEST_URL is not an absolute URL",
      null,
      error,
    );
  }
  const host = /^pipelines[a-z0-9-]*\.actions\.githubusercontent\.com$/u;
  const path = /^\/[A-Za-z0-9_-]+\/[A-Za-z0-9-]+\/_apis\/distributedtask\/hubs\/(?:Actions|build)\/plans\/[A-Za-z0-9-]+\/jobs\/[A-Za-z0-9-]+\/idtoken$/u;
  if (
    url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
    url.port !== "" || url.hash !== "" || !host.test(url.hostname) ||
    !path.test(url.pathname) || url.search !== "?api-version=2.0"
  ) {
    throw controllerFailure(
      "OIDC_MINT_URL_INVALID",
      "ACTIONS_ID_TOKEN_REQUEST_URL is outside the closed GitHub Actions id-token endpoint",
    );
  }
  return url;
}

function normalizeOidcHttpLimits(value) {
  assertObject(value, "OIDC HTTP limits");
  exactKeys(value, [
    "max_requests", "max_response_bytes", "max_total_bytes", "timeout_ms",
    "clock_skew_ms",
  ].filter((key) => value[key] !== undefined), "OIDC HTTP limits");
  const tighten = (key, maximum) => {
    const selected = value[key] ?? maximum;
    if (!Number.isSafeInteger(selected) || selected <= 0 || selected > maximum) {
      throw new TypeError(`OIDC HTTP ${key} may only tighten its hard maximum`);
    }
    return selected;
  };
  return Object.freeze({
    max_requests: tighten("max_requests", V2_GITHUB_OIDC_MAX_REQUESTS),
    max_response_bytes: tighten(
      "max_response_bytes",
      V2_GITHUB_OIDC_MAX_RESPONSE_BYTES,
    ),
    max_total_bytes: tighten("max_total_bytes", V2_GITHUB_OIDC_MAX_TOTAL_BYTES),
    timeout_ms: tighten("timeout_ms", V2_GITHUB_OIDC_HTTP_TIMEOUT_MS),
    clock_skew_ms: tighten("clock_skew_ms", 5 * 60 * 1000),
  });
}

async function oidcJsonRequest({
  fetchImpl,
  clock,
  limits,
  budget,
  signal,
  url,
  label,
  headers,
}) {
  if (signal.aborted) throw oidcAbortFailure(signal);
  if (budget.requests >= limits.max_requests) {
    throw controllerFailure("OIDC_REQUEST_LIMIT", "OIDC HTTP request budget exhausted");
  }
  budget.requests += 1;
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abortFromCaller, { once: true });
  const timer = setTimeout(
    () => controller.abort(controllerFailure(
      "OIDC_HTTP_TIMEOUT",
      `${label} exceeded its fixed request deadline`,
    )),
    limits.timeout_ms,
  );
  let response;
  let bytes;
  try {
    response = await waitForOidcPromise(fetchImpl(url.href, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers,
    }), controller.signal);
    if (
      response === null || typeof response !== "object" || response.status !== 200 ||
      typeof response.headers?.get !== "function"
    ) {
      throw controllerFailure("OIDC_HTTP_UNREADABLE", `${label} did not return HTTP 200`);
    }
    const declared = parseBoundedContentLength(
      response.headers.get("content-length"),
      "OIDC_HTTP_UNREADABLE",
      label,
    );
    if (declared !== null && declared > limits.max_response_bytes) {
      throw controllerFailure("OIDC_RESPONSE_TOO_LARGE", `${label} response is too large`);
    }
    bytes = await readBoundedControllerResponse(
      response,
      Math.min(
        limits.max_response_bytes,
        limits.max_total_bytes - budget.bytes,
      ),
      controller,
      label,
      {
        unreadable: "OIDC_HTTP_UNREADABLE",
        too_large: "OIDC_RESPONSE_TOO_LARGE",
        fragmented: "OIDC_RESPONSE_FRAGMENTED",
        exhausted: "OIDC_TOTAL_BYTES_EXCEEDED",
      },
    );
  } catch (error) {
    if (error instanceof V2WorkflowControllerError) throw error;
    throw controllerFailure(
      controller.signal.aborted ? "OIDC_HTTP_TIMEOUT" : "OIDC_HTTP_FAILED",
      `${label} failed`,
      null,
      error,
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abortFromCaller);
  }
  budget.bytes += bytes.byteLength;
  if (budget.bytes > limits.max_total_bytes) {
    throw controllerFailure("OIDC_TOTAL_BYTES_EXCEEDED", "OIDC HTTP byte budget exhausted");
  }
  const serverTime = canonicalHttpDate(response.headers.get("date"), `${label} Date`);
  if (
    budget.last_server_time !== null &&
    Date.parse(serverTime) < Date.parse(budget.last_server_time)
  ) {
    throw controllerFailure("OIDC_SERVER_TIME_REGRESSED", `${label} server Date regressed`);
  }
  const now = Number(clock());
  if (!Number.isFinite(now) || Math.abs(now - Date.parse(serverTime)) > limits.clock_skew_ms) {
    throw controllerFailure("OIDC_CLOCK_SKEW", `${label} server Date is outside the clock bound`);
  }
  budget.last_server_time = serverTime;
  let rawBody;
  try {
    rawBody = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw controllerFailure("OIDC_INVALID_UTF8", `${label} response is not UTF-8`, null, error);
  }
  let data;
  try {
    data = JSON.parse(rawBody);
  } catch (error) {
    throw controllerFailure("OIDC_INVALID_JSON", `${label} response is not JSON`, null, error);
  }
  return {
    data,
    server_time: serverTime,
    raw_body_sha256: rawDigest(bytes),
  };
}

async function readBoundedControllerResponse(
  response,
  maximum,
  controller,
  label,
  codes,
) {
  if (!Number.isSafeInteger(maximum) || maximum <= 0) {
    throw controllerFailure(codes.exhausted, `${label} has no byte budget`);
  }
  if (typeof response.body?.getReader === "function") {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await waitForControllerAbort(
          reader.read(),
          controller.signal,
        );
        if (done) break;
        if (!(value instanceof Uint8Array)) {
          throw controllerFailure(codes.unreadable, `${label} returned non-byte data`);
        }
        if (value.byteLength === 0) continue;
        size += value.byteLength;
        if (size > maximum) {
          controller.abort(new Error(`${label} exceeded its byte budget`));
          await reader.cancel().catch(() => {});
          throw controllerFailure(codes.too_large, `${label} response is too large`);
        }
        if (chunks.length >= 16_384) {
          controller.abort(new Error(`${label} exceeded its chunk cap`));
          await reader.cancel().catch(() => {});
          throw controllerFailure(
            codes.fragmented,
            `${label} response exceeds the bounded chunk inventory`,
          );
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks, size);
  }
  throw controllerFailure(codes.unreadable, `${label} has no bounded stream reader`);
}

function waitForControllerAbort(promise, signal) {
  if (signal.aborted) {
    Promise.resolve(promise).catch(() => {});
    return Promise.reject(signal.reason ?? new Error("controller request aborted"));
  }
  return new Promise((resolvePromise, rejectPromise) => {
    const abort = () => rejectPromise(
      signal.reason ?? new Error("controller request aborted"),
    );
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolvePromise(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        rejectPromise(error);
      },
    );
  });
}

function parseJwtJson(segment, label) {
  const bytes = decodeBase64Url(segment, label);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw controllerFailure("OIDC_JWT_MALFORMED", `${label} is not UTF-8`, null, error);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw controllerFailure("OIDC_JWT_MALFORMED", `${label} is not JSON`, null, error);
  }
  assertObject(value, label);
  return value;
}

function decodeBase64Url(value, label) {
  if (!isCanonicalBase64Url(value)) {
    throw controllerFailure("OIDC_JWT_MALFORMED", `${label} is not canonical base64url`);
  }
  return Buffer.from(value, "base64url");
}

function isCanonicalBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) return false;
  const bytes = Buffer.from(value, "base64url");
  return bytes.length > 0 && bytes.toString("base64url") === value;
}

function normalizeUniqueStrings(value, label, maximumItems) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximumItems) {
    throw new TypeError(`${label} must be a non-empty bounded array`);
  }
  const strings = value.map((item, index) =>
    boundedString(item, `${label}[${index}]`, 256));
  if (new Set(strings).size !== strings.length) {
    throw new TypeError(`${label} must contain unique strings`);
  }
  return strings.sort();
}

function parseBoundedContentLength(value, code, label) {
  if (value === null) return null;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw controllerFailure(code, `${label} Content-Length is invalid`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw controllerFailure(code, `${label} Content-Length is unsafe`);
  }
  return parsed;
}

function canonicalHttpDate(value, label) {
  if (
    typeof value !== "string" ||
    !/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), [0-9]{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$/u.test(value)
  ) {
    throw controllerFailure("HTTP_DATE_MISSING", `${label} is not canonical`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw controllerFailure("HTTP_DATE_INVALID", `${label} is invalid`);
  }
  return new Date(parsed).toISOString();
}

function requiredSecretEnv(environment, name, maximum) {
  return boundedSecret(environment?.[name], name, maximum);
}

function boundedSecret(value, label, maximum) {
  if (
    typeof value !== "string" || value.length === 0 || value.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError(`${label} must be a bounded single-line secret`);
  }
  return value;
}

/**
 * Read only the exact PR epoch needed to scope a protected-ledger lease. This
 * does not load provider evidence and cannot authorize a public effect.
 */
export async function loadV2MinimalLiveScope(options = {}) {
  assertObject(options, "minimal live scope options");
  exactKeys(options, [
    "fetch", "token", "repository", "pull_number", "rest_base_url",
    "graphql_url", "http_limits",
  ].filter((key) => options[key] !== undefined), "minimal live scope options");
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw controllerFailure("FETCH_UNAVAILABLE", "minimal live scope requires fetch");
  }
  const token = boundedSecret(options.token, "minimal live scope token", 4096);
  const repository = normalizeRepository(options.repository);
  const pullNumber = positiveInteger(options.pull_number, "minimal live scope pull_number");
  const restBase = normalizeRestBase(options.rest_base_url ?? "https://api.github.com");
  const graphqlUrl = normalizeControllerServiceUrl(
    options.graphql_url ?? defaultControllerGraphqlUrl(restBase),
    "minimal live scope GraphQL URL",
  );
  const limits = normalizeMinimalScopeLimits(options.http_limits ?? {});
  const budget = { requests: 0, bytes: 0, last_server_time: null };
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "codex-review-gate-v2-minimal-scope",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const repoPath = `/repos/${encodeURIComponent(repository.owner)}/` +
    `${encodeURIComponent(repository.name)}`;
  const receipts = [];
  const pullPath = `${repoPath}/pulls/${pullNumber}`;
  const pullCapture = await controllerApiJsonRequest({
    fetchImpl,
    limits,
    budget,
    url: new URL(`${restBase}${pullPath}`),
    method: "GET",
    headers,
    expected_statuses: [200],
    label: "minimal pull-request scope",
  });
  receipts.push(controllerEndpointReceipt("GET", pullPath, pullCapture));
  const restPull = normalizeMinimalRestPull(
    pullCapture.data,
    repository,
    pullNumber,
    restBase,
  );

  const graphCapture = await controllerApiJsonRequest({
    fetchImpl,
    limits,
    budget,
    url: new URL(graphqlUrl),
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: {
      query: V2_MINIMAL_SCOPE_QUERY,
      variables: {
        owner: repository.owner,
        repo: repository.name,
        number: pullNumber,
      },
    },
    expected_statuses: [200],
    label: "minimal GraphQL PR scope",
  });
  receipts.push(controllerEndpointReceipt(
    "POST",
    new URL(graphqlUrl).pathname,
    graphCapture,
  ));
  const graph = normalizeMinimalGraphScope(
    graphCapture.data,
    repository,
    pullNumber,
  );
  if (
    restPull.node_id !== graph.pull_request.node_id ||
    restPull.state !== graph.pull_request.state ||
    restPull.merged !== graph.pull_request.merged ||
    restPull.merged_at !== graph.pull_request.merged_at ||
    restPull.updated_at !== graph.pull_request.updated_at
  ) {
    throw controllerFailure(
      "MINIMAL_SCOPE_IDENTITY_MISMATCH",
      "REST and GraphQL minimal scope do not bind one PR lifecycle version",
    );
  }

  let mergeBaseSha = null;
  if (graph.scope.base_ref_tip !== null && graph.scope.head_ref_oid !== null) {
    const comparePath = `${repoPath}/compare/${graph.scope.base_ref_tip}...` +
      graph.scope.head_ref_oid;
    const compareCapture = await controllerApiJsonRequest({
      fetchImpl,
      limits,
      budget,
      url: new URL(`${restBase}${comparePath}`),
      method: "GET",
      headers,
      expected_statuses: [200],
      label: "minimal live-base comparison",
    });
    receipts.push(controllerEndpointReceipt("GET", comparePath, compareCapture));
    assertObject(compareCapture.data, "minimal compare response");
    if (compareCapture.data.base_commit?.sha !== graph.scope.base_ref_tip) {
      throw controllerFailure(
        "MINIMAL_SCOPE_COMPARE_MISMATCH",
        "minimal compare response differs from the live base",
      );
    }
    mergeBaseSha = sha(
      compareCapture.data.merge_base_commit?.sha,
      "minimal compare merge_base_commit.sha",
    );
  }

  const mergeRefPath = `${repoPath}/git/ref/pull/${pullNumber}/merge`;
  const mergeRefCapture = await controllerApiJsonRequest({
    fetchImpl,
    limits,
    budget,
    url: new URL(`${restBase}${mergeRefPath}`),
    method: "GET",
    headers,
    expected_statuses: [200, 404],
    label: "minimal pull-request merge ref",
  });
  receipts.push(controllerEndpointReceipt("GET", mergeRefPath, mergeRefCapture));
  const mergeRefOid = mergeRefCapture.status === 404
    ? normalizeMinimalNotFound(mergeRefCapture.data)
    : normalizeMinimalMergeRef(
        mergeRefCapture.data,
        mergeRefPath,
        pullNumber,
        restBase,
      );
  const withoutDigest = {
    schema: V2_MINIMAL_SCOPE_RECEIPT_SCHEMA,
    schema_version: 1,
    repository: graph.repository,
    pull_request: graph.pull_request,
    scope: {
      ...graph.scope,
      merge_base_sha: mergeBaseSha,
      merge_ref_oid: mergeRefOid,
    },
    endpoint_receipts: receipts,
    observed_at: latestControllerServerTime(receipts.map((item) => item.server_time)),
  };
  const receipt = deepFreeze({
    ...withoutDigest,
    receipt_digest: digestCanonical(
      "codex-review-gate-v2-minimal-live-scope",
      withoutDigest,
    ),
  });
  V2_MINIMAL_LIVE_SCOPE_HANDLES.set(receipt, deepFreeze({
    repository: {
      owner: receipt.repository.owner,
      name: receipt.repository.name,
    },
    pull_number: receipt.pull_request.number,
    receipt_digest: receipt.receipt_digest,
  }));
  return receipt;
}

/**
 * Require an exact same-process minimal-scope loader result and optionally
 * bind it to the repository and pull request selected by trusted command data.
 */
export function assertV2MinimalLiveScopeHandle(value, expected) {
  assertObject(expected, "minimal live scope handle expectation");
  const hasPullNumber = Object.hasOwn(expected, "pull_number");
  exactKeys(
    expected,
    hasPullNumber ? ["repository", "pull_number"] : ["repository"],
    "minimal live scope handle expectation",
  );
  const repository = normalizeRepository(expected.repository);
  const pullNumber = hasPullNumber
    ? positiveInteger(
        expected.pull_number,
        "minimal live scope handle expectation.pull_number",
      )
    : null;
  const { receipt, binding } = requireV2MinimalLiveScopeHandle(
    value,
    "minimal live scope handle",
  );
  if (
    binding.repository.owner !== repository.owner ||
    binding.repository.name !== repository.name ||
    (pullNumber !== null && binding.pull_number !== pullNumber)
  ) {
    throw controllerFailure(
      "MINIMAL_LIVE_SCOPE_HANDLE_BINDING_MISMATCH",
      "minimal live scope handle differs from its trusted repository or pull request",
    );
  }
  return receipt;
}

/** Project the controller-owned minimal read into the ledger's exact PR scope. */
export function projectV2MinimalScopeForGitLedger(value) {
  const { receipt } = requireV2MinimalLiveScopeHandle(
    value,
    "minimal scope ledger binding",
  );
  if (
    receipt.scope.head_ref_oid === null || receipt.scope.base_ref_tip === null
  ) {
    throw controllerFailure(
      "LEDGER_SCOPE_INCOMPLETE",
      "minimal live scope lacks the exact base or head required by the ledger",
    );
  }
  const restReceipt = receipt.endpoint_receipts[0];
  const expectedPath = `/repos/${receipt.repository.owner}/` +
    `${receipt.repository.name}/pulls/${receipt.pull_request.number}`;
  if (
    restReceipt?.method !== "GET" || restReceipt.path !== expectedPath ||
    restReceipt.status !== 200
  ) {
    throw controllerFailure(
      "LEDGER_SCOPE_ENDPOINT_INVALID",
      "minimal live scope lacks its exact REST pull-request endpoint receipt",
    );
  }
  const scope = {
    pull_request: {
      number: receipt.pull_request.number,
      node_id: receipt.pull_request.node_id,
    },
    head_ref_oid: receipt.scope.head_ref_oid,
    base_ref_oid: receipt.scope.base_ref_tip,
    potential_merge_commit_oid: receipt.scope.potential_merge_oid,
  };
  return deepFreeze({
    scope,
    scope_endpoint_receipt: {
      method: "GET",
      path: restReceipt.path,
      status: 200,
      server_time: restReceipt.server_time,
      raw_body_sha256: restReceipt.raw_body_sha256,
      pull_request: structuredClone(scope.pull_request),
      head_ref_oid: scope.head_ref_oid,
      base_ref_oid: scope.base_ref_oid,
      potential_merge_commit_oid: scope.potential_merge_commit_oid,
    },
  });
}

export function assertV2MinimalScopeMatchesFullDiscovery({
  pre_scope,
  discovery_snapshot,
  post_scope,
}) {
  const { receipt: pre } = requireV2MinimalLiveScopeHandle(
    pre_scope,
    "pre_scope",
  );
  const { receipt: post } = requireV2MinimalLiveScopeHandle(
    post_scope,
    "post_scope",
  );
  assertObject(discovery_snapshot, "discovery_snapshot");
  const preStable = minimalScopeStableProjection(pre);
  const postStable = minimalScopeStableProjection(post);
  if (canonicalJson(preStable) !== canonicalJson(postStable)) {
    throw controllerFailure(
      "LIVE_SCOPE_DRIFT",
      "minimal PR scope changed across lease acquisition and full discovery",
    );
  }
  if (Date.parse(post.observed_at) < Date.parse(pre.observed_at)) {
    throw controllerFailure(
      "LIVE_SCOPE_TIME_REGRESSED",
      "post-discovery minimal scope predates the lease pre-scope",
    );
  }
  const fullProjection = fullDiscoveryScopeProjection(discovery_snapshot);
  const preProjection = minimalScopeDiscoveryProjection(pre);
  if (canonicalJson(preProjection) !== canonicalJson(fullProjection)) {
    throw controllerFailure(
      "FULL_DISCOVERY_SCOPE_DRIFT",
      "full discovery does not type-preservingly equal the lease pre-scope",
    );
  }
  return deepFreeze({
    pre_scope_receipt_digest: pre.receipt_digest,
    post_scope_receipt_digest: post.receipt_digest,
    matched: true,
  });
}

/**
 * Require a same-process leased-discovery authority and bind it to the exact
 * factory-created pre-scope and lease receipts selected by the ledger.
 */
export function assertV2LeasedDiscoveryContinuityHandle(value, expected) {
  assertObject(expected, "leased discovery continuity expectation");
  exactKeys(expected, [
    "repository",
    "scope",
    "pre_scope_receipt",
    "lease_receipt",
  ], "leased discovery continuity expectation");
  const repository = normalizeLeasedDiscoveryRepository(expected.repository);
  const scope = normalizeLeasedDiscoveryScope(expected.scope);
  const { handle, binding } = requireV2LeasedDiscoveryContinuityHandle(value);
  if (
    canonicalJson(binding.repository) !== canonicalJson(repository) ||
    canonicalJson(binding.scope) !== canonicalJson(scope) ||
    binding.pre_scope_receipt !== expected.pre_scope_receipt ||
    binding.lease_receipt !== expected.lease_receipt
  ) {
    throw controllerFailure(
      "LEASED_DISCOVERY_CONTINUITY_BINDING_MISMATCH",
      "leased discovery continuity differs from its repository, PR scope, pre-scope, or lease",
    );
  }
  validateV2GitLedgerDiscoveryContinuityReceipt(
    handle.continuity_receipt,
    {
      repository,
      scope,
      pre_scope_receipt_digest: digest(
        expected.pre_scope_receipt?.receipt_digest,
        "leased discovery pre-scope receipt digest",
      ),
      lease_receipt: expected.lease_receipt,
    },
  );
  return handle;
}

/**
 * Reveal the private branded full snapshot only to the trusted ledger adapter.
 * The durable continuity receipt stores a bounded digest/summary, never the
 * complete evidence snapshot.
 */
export function projectV2LeasedDiscoveryContinuityForGitLedger(value) {
  const { handle, binding } = requireV2LeasedDiscoveryContinuityHandle(value);
  const continuityReceipt = createV2GitLedgerDiscoveryContinuityReceipt({
    repository: binding.repository,
    scope: binding.scope,
    pre_scope_receipt_digest: binding.pre_scope_receipt.receipt_digest,
    lease_receipt: binding.lease_receipt,
    discovery_snapshot: binding.discovery_snapshot,
    transport_limits: binding.transport_limits,
    minimal_pre: binding.minimal_pre,
    minimal_post: binding.minimal_post,
  });
  if (
    continuityReceipt.continuity_receipt_digest !==
      handle.continuity_receipt.continuity_receipt_digest ||
    canonicalJson(continuityReceipt) !==
      canonicalJson(handle.continuity_receipt)
  ) {
    throw controllerFailure(
      "LEASED_DISCOVERY_CONTINUITY_BINDING_MISMATCH",
      "leased discovery continuity no longer reproduces its public receipt",
    );
  }
  return deepFreeze({
    continuity_receipt: continuityReceipt,
    discovery_snapshot: binding.discovery_snapshot,
    effective_limits: structuredClone(binding.transport_limits),
    minimal_pre: binding.minimal_pre,
    minimal_post: binding.minimal_post,
  });
}

function createV2LeasedDiscoveryContinuityHandle({
  repository: repositoryValue,
  scope: scopeValue,
  pre_scope_receipt,
  lease_receipt,
  discovery_snapshot,
  minimal_pre,
  minimal_post,
}) {
  const repository = normalizeLeasedDiscoveryRepository(repositoryValue);
  const scope = normalizeLeasedDiscoveryScope(scopeValue);
  assertObject(pre_scope_receipt, "leased discovery pre-scope receipt");
  const preScopeReceiptDigest = digest(
    pre_scope_receipt.receipt_digest,
    "leased discovery pre-scope receipt digest",
  );
  assertV2MinimalLiveScopeHandle(minimal_pre, {
    repository: { owner: repository.owner, name: repository.name },
    pull_number: scope.pull_request.number,
  });
  assertV2MinimalLiveScopeHandle(minimal_post, {
    repository: { owner: repository.owner, name: repository.name },
    pull_number: scope.pull_request.number,
  });
  const transportAuthority = projectV2TransportSnapshotForGitLedger(
    discovery_snapshot,
    {
      repository: { owner: repository.owner, name: repository.name },
      scope,
    },
  );
  const continuityReceipt = createV2GitLedgerDiscoveryContinuityReceipt({
    repository,
    scope,
    pre_scope_receipt_digest: preScopeReceiptDigest,
    lease_receipt,
    discovery_snapshot: transportAuthority.snapshot,
    transport_limits: transportAuthority.effective_limits,
    minimal_pre,
    minimal_post,
  });
  const handle = deepFreeze({
    continuity_receipt: continuityReceipt,
  });
  V2_LEASED_DISCOVERY_CONTINUITY_HANDLES.set(handle, Object.freeze({
    repository: deepFreeze(structuredClone(repository)),
    scope: deepFreeze(structuredClone(scope)),
    pre_scope_receipt,
    lease_receipt,
    discovery_snapshot: transportAuthority.snapshot,
    transport_limits: deepFreeze(
      structuredClone(transportAuthority.effective_limits),
    ),
    minimal_pre,
    minimal_post,
    continuity_receipt_digest: continuityReceipt.continuity_receipt_digest,
  }));
  return handle;
}

/**
 * Enforce the production ordering boundary around discovery: minimal scope,
 * protected-ledger attestation and lease, then the complete transport load.
 * Any read failure or scope drift releases the lease without refund and
 * returns no effect authority.
 */
export async function acquireV2LeaseThenLoadDiscovery(options = {}) {
  assertObject(options, "leased discovery options");
  exactKeys(options, [
    "command", "environment", "fetch", "token", "rest_base_url",
    "graphql_url", "ledger", "transport", "lease_ttl_seconds",
    "minimal_scope_http_limits", "evaluated_scope_receipt", "pre_scope",
  ].filter((key) => options[key] !== undefined), "leased discovery options");
  const command = options.command;
  assertObject(command, "leased discovery command");
  if (command.pull_request?.number === null || command.pull_request?.number === undefined) {
    throw controllerFailure(
      "SINGLE_PULL_REQUEST_REQUIRED",
      "leased discovery requires exactly one selected pull request",
    );
  }
  const environment = options.environment ?? process.env;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const token = options.token ?? requiredEnv(environment, "GITHUB_TOKEN");
  const restBaseUrl = options.rest_base_url ?? environment.GITHUB_API_URL ??
    "https://api.github.com";
  const graphqlUrl = options.graphql_url ?? defaultControllerGraphqlUrl(
    normalizeRestBase(restBaseUrl),
  );
  const ledger = options.ledger;
  assertObject(
    options.evaluated_scope_receipt,
    "leased discovery evaluated scope receipt",
  );
  const ledgerAuthority = {
    evaluated_scope_receipt: options.evaluated_scope_receipt,
  };
  for (const [name, callback] of [
    ["load", ledger?.load],
    ["acquireLease", ledger?.acquireLease],
    ["releaseLease", ledger?.releaseLease],
  ]) {
    if (typeof callback !== "function") {
      throw new TypeError(`leased discovery ledger requires ${name}`);
    }
  }
  const preScopeCandidate = options.pre_scope === undefined
    ? await loadV2MinimalLiveScope({
      fetch: fetchImpl,
      token,
      repository: command.repository,
      pull_number: command.pull_request.number,
      rest_base_url: restBaseUrl,
      graphql_url: graphqlUrl,
      ...(options.minimal_scope_http_limits === undefined
        ? {}
        : { http_limits: options.minimal_scope_http_limits }),
    })
    : options.pre_scope;
  const preScope = assertV2MinimalLiveScopeHandle(preScopeCandidate, {
    repository: command.repository,
    pull_number: command.pull_request.number,
  });
  if (
    preScope.pull_request.state !== "OPEN" ||
    preScope.pull_request.merged !== false ||
    preScope.pull_request.merged_at !== null
  ) {
    throw controllerFailure(
      "PULL_REQUEST_NOT_OPEN",
      "minimal live scope is not an open, unmerged pull request",
    );
  }
  if (preScope.scope.base_ref_tip === null || preScope.scope.head_ref_oid === null) {
    throw controllerFailure(
      "LEASE_SCOPE_INCOMPLETE",
      "minimal live scope lacks the exact base or head required for a lease",
    );
  }
  const attested = await ledger.load();
  assertObject(attested, "attested protected ledger load");
  const leaseTtl = options.lease_ttl_seconds ?? 600;
  if (!Number.isSafeInteger(leaseTtl) || leaseTtl <= 0 || leaseTtl > 900) {
    throw new TypeError("lease_ttl_seconds must be from 1 through 900");
  }
  const leaseReceipt = await ledger.acquireLease({
    predecessor_commit_sha: sha(
      attested.tip_commit_sha,
      "attested protected ledger tip_commit_sha",
    ),
    pull_request: {
      number: preScope.pull_request.number,
      node_id: preScope.pull_request.node_id,
    },
    head_ref_oid: preScope.scope.head_ref_oid,
    base_ref_oid: preScope.scope.base_ref_tip,
    potential_merge_commit_oid: preScope.scope.potential_merge_oid,
    lease_id: `lease:${boundedString(
      command.invocation.run_id,
      "workflow run id",
      64,
    )}:${positiveInteger(
      command.invocation.run_attempt,
      "workflow run attempt",
    )}:${preScope.receipt_digest.slice(-16)}`,
    owner: {
      run_id: command.invocation.run_id,
      run_attempt: command.invocation.run_attempt,
      actor_id: command.invocation.actor_id,
    },
    observed_at: preScope.observed_at,
    lease_ttl_seconds: leaseTtl,
    control_comment_binding: attested.control_comment_binding ?? null,
  }, ledgerAuthority);
  let releaseReceipt = null;
  const releaseAfterFailure = async (error) => {
    try {
      const current = await ledger.load();
      releaseReceipt = await ledger.releaseLease({
        predecessor_commit_sha: sha(
          current.tip_commit_sha,
          "abort protected ledger tip_commit_sha",
        ),
        lease_receipt: leaseReceipt,
        released_at: timestamp(
          current.post_ref?.server_time ?? current.observed_at,
          "abort protected ledger server time",
        ),
        control_comment_binding: current.control_comment_binding ?? null,
      }, ledgerAuthority);
      const confirmed = await ledger.load();
      assertObject(confirmed, "post-abort protected ledger load");
      if (confirmed.active_lease !== null) {
        throw new Error("protected ledger still reports an active lease after release");
      }
    } catch (releaseError) {
      throw controllerFailure(
        "LEASE_ABORT_FAILED",
        "leased discovery failed and its no-refund lease release could not be appended",
        {
          upstream_code: typeof error?.code === "string" ? error.code : null,
          budget_refunded: false,
        },
        releaseError,
      );
    }
    throw controllerFailure(
      "LEASED_DISCOVERY_ABORTED",
      "leased discovery failed closed and released its lease without refund",
      {
        upstream_code: typeof error?.code === "string" ? error.code : null,
        release_receipt_digest:
          typeof releaseReceipt?.receipt_digest === "string"
            ? releaseReceipt.receipt_digest
            : null,
        budget_refunded: false,
        public_effects_performed: 0,
      },
      error,
    );
  };
  try {
    const transport = options.transport ?? createV2GitHubTransport({
      fetch: fetchImpl,
      token,
      restBaseUrl,
      graphqlUrl,
    });
    if (typeof transport?.loadSnapshot !== "function") {
      throw new TypeError("leased discovery transport requires loadSnapshot");
    }
    const discoverySnapshot = await transport.loadSnapshot({
      owner: command.repository.owner,
      repo: command.repository.name,
      pullNumber: command.pull_request.number,
      artifactSelectors: [],
    });
    const postScope = await loadV2MinimalLiveScope({
      fetch: fetchImpl,
      token,
      repository: command.repository,
      pull_number: command.pull_request.number,
      rest_base_url: restBaseUrl,
      graphql_url: graphqlUrl,
      ...(options.minimal_scope_http_limits === undefined
        ? {}
        : { http_limits: options.minimal_scope_http_limits }),
    });
    assertV2MinimalScopeMatchesFullDiscovery({
      pre_scope: preScope,
      discovery_snapshot: discoverySnapshot,
      post_scope: postScope,
    });
    const projectedPreScope = projectV2MinimalScopeForGitLedger(preScope);
    const continuityAuthority = createV2LeasedDiscoveryContinuityHandle({
      repository: options.evaluated_scope_receipt.repository,
      scope: projectedPreScope.scope,
      pre_scope_receipt: options.evaluated_scope_receipt,
      lease_receipt: leaseReceipt,
      discovery_snapshot: discoverySnapshot,
      minimal_pre: preScope,
      minimal_post: postScope,
    });
    if (typeof ledger.createFullDiscoveryEvaluatedScopeReceipt !== "function") {
      throw new TypeError(
        "leased discovery requires createFullDiscoveryEvaluatedScopeReceipt",
      );
    }
    const fullEvaluatedScopeReceipt = await ledger
      .createFullDiscoveryEvaluatedScopeReceipt({
        pre_scope_receipt: options.evaluated_scope_receipt,
        lease_receipt: leaseReceipt,
        continuity_handle: continuityAuthority,
      });
    assertObject(
      fullEvaluatedScopeReceipt,
      "full-discovery evaluated scope receipt",
    );
    let effectEvaluatedScopeReceipt = fullEvaluatedScopeReceipt;
    if (options.evaluated_scope_receipt.relation === "provider-selector") {
      if (typeof ledger.createProviderEventFullDiscoveryEvaluatedScopeReceipt !==
          "function") {
        throw new TypeError(
          "provider leased discovery requires " +
            "createProviderEventFullDiscoveryEvaluatedScopeReceipt",
        );
      }
      effectEvaluatedScopeReceipt = await ledger
        .createProviderEventFullDiscoveryEvaluatedScopeReceipt({
          full_scope_receipt: fullEvaluatedScopeReceipt,
          continuity_handle: continuityAuthority,
        });
      assertObject(
        effectEvaluatedScopeReceipt,
        "provider full-discovery evaluated scope receipt",
      );
    }
    return deepFreeze({
      lease_receipt: leaseReceipt,
      continuity_authority: continuityAuthority,
      lease_evaluated_scope_receipt: options.evaluated_scope_receipt,
      full_evaluated_scope_receipt: fullEvaluatedScopeReceipt,
      effect_evaluated_scope_receipt: effectEvaluatedScopeReceipt,
      effects_performed: 0,
    });
  } catch (error) {
    return releaseAfterFailure(error);
  }
}

/**
 * Bind the evaluated-scope carrier to the exact trusted GitHub job context.
 * The protected ledger independently checks these values against every
 * operation's signed OIDC claims before it accepts a record.
 */
export function loadV2GitLedgerTriggerIdentity({
  command,
  environment = process.env,
}) {
  assertObject(command, "ledger trigger identity command");
  assertObject(command.invocation, "ledger trigger identity command.invocation");
  const eventName = boundedString(
    environment.GITHUB_EVENT_NAME,
    "GITHUB_EVENT_NAME",
    128,
  );
  if (eventName !== command.invocation.event_name) {
    throw controllerFailure(
      "TRIGGER_EVENT_IDENTITY_MISMATCH",
      "trusted GitHub event name differs from the validated workflow command",
    );
  }
  const ref = boundedString(environment.GITHUB_REF, "GITHUB_REF", 1024);
  if (!ref.startsWith("refs/") || /[\u0000-\u001f\u007f]/u.test(ref)) {
    throw controllerFailure(
      "TRIGGER_REF_INVALID",
      "trusted GitHub ref is not one canonical refs/ value",
    );
  }
  const triggerSha = sha(environment.GITHUB_SHA, "GITHUB_SHA");
  return deepFreeze({
    event_name: eventName,
    ref,
    sha: triggerSha,
  });
}

const V2_PROVIDER_EVENT_NAMES = new Set([
  "issue_comment",
  "pull_request_review",
  "pull_request_review_comment",
]);

/**
 * Select the only ledger-owned evaluated-scope authority permitted before a
 * lease. Provider routes additionally perform their one native artifact GET;
 * every other route remains a pure closure call over the live minimal scope.
 */
export async function createV2PreLeaseEvaluatedScopeAuthority(options = {}) {
  assertObject(options, "pre-lease evaluated scope options");
  exactKeys(options, [
    "command", "environment", "fetch", "token", "rest_base_url", "ledger",
    "preflight_handle", "pre_scope", "candidate_dispatch_handle",
  ].filter((key) => options[key] !== undefined), "pre-lease evaluated scope options");
  const command = options.command;
  assertObject(command, "pre-lease evaluated scope command");
  const environment = options.environment ?? process.env;
  const ledger = options.ledger;
  assertObject(ledger, "pre-lease evaluated scope ledger");
  const preScope = assertV2MinimalLiveScopeHandle(options.pre_scope, {
    repository: command.repository,
    pull_number: command.pull_request?.number,
  });
  if (
    preScope.pull_request.state !== "OPEN" ||
    preScope.pull_request.merged !== false ||
    preScope.pull_request.merged_at !== null
  ) {
    throw controllerFailure(
      "PULL_REQUEST_NOT_OPEN",
      "pre-lease authority requires an open, unmerged pull request",
    );
  }
  const triggerIdentity = loadV2GitLedgerTriggerIdentity({
    command,
    environment,
  });
  const eventName = triggerIdentity.event_name;
  const hasCandidateDispatchHandle = Object.hasOwn(
    options,
    "candidate_dispatch_handle",
  ) && options.candidate_dispatch_handle !== undefined;
  if (eventName !== "schedule" && hasCandidateDispatchHandle) {
    throw controllerFailure(
      "CANDIDATE_DISPATCH_HANDLE_SPURIOUS",
      "only a scheduled pull-request route may carry candidate dispatch authority",
    );
  }
  let relation;
  let evaluatedScopeReceipt;
  let providerArtifactHandle = null;

  if (V2_PROVIDER_EVENT_NAMES.has(eventName)) {
    if (typeof ledger.createProviderEventPreScopeEvaluatedScopeReceipt !== "function") {
      throw new TypeError(
        "provider route requires createProviderEventPreScopeEvaluatedScopeReceipt",
      );
    }
    const preflight = assertV2WorkflowPreflightHandle(options.preflight_handle);
    const selected = await readV2ProviderEventSelector({ command, environment });
    const provider = preflight.provider_identity_authority;
    assertObject(provider, "live provider identity authority");
    providerArtifactHandle = await loadV2ProviderPreScopeArtifact({
      fetch: options.fetch ?? globalThis.fetch,
      token: options.token ?? requiredEnv(environment, "GITHUB_TOKEN"),
      restBaseUrl: options.rest_base_url ?? environment.GITHUB_API_URL ??
        "https://api.github.com",
      owner: command.repository.owner,
      repo: command.repository.name,
      pullNumber: command.pull_request.number,
      headSha: preScope.scope.head_ref_oid,
      selector: selected.selector,
      expectedActor: provider.actor,
      expectedApp: provider.app,
    });
    evaluatedScopeReceipt = await ledger
      .createProviderEventPreScopeEvaluatedScopeReceipt({
        minimal_scope_handle: preScope,
        trigger_identity: triggerIdentity,
        provider_artifact_handle: providerArtifactHandle,
      });
    relation = "provider-selector";
  } else if (eventName === "workflow_dispatch") {
    if (command.route?.trigger !== "manual" ||
        typeof ledger.createManualPullRequestEvaluatedScopeReceipt !== "function") {
      throw controllerFailure(
        "MANUAL_SCOPE_ROUTE_INVALID",
        "workflow_dispatch requires the closed manual evaluated-scope route",
      );
    }
    evaluatedScopeReceipt = await ledger
      .createManualPullRequestEvaluatedScopeReceipt({
        minimal_scope_handle: preScope,
        trigger_identity: triggerIdentity,
        workflow_command_handle: command,
      });
    relation = "manual-pull-request";
  } else if (eventName === "schedule") {
    if (!hasCandidateDispatchHandle) {
      throw controllerFailure(
        "CANDIDATE_DISPATCH_HANDLE_REQUIRED",
        "scheduled pull-request scope requires same-factory candidate dispatch authority",
      );
    }
    if (typeof ledger.loadScheduledPullRequestEvaluatedScopeReceipt !== "function") {
      throw new TypeError(
        "scheduled route requires loadScheduledPullRequestEvaluatedScopeReceipt",
      );
    }
    evaluatedScopeReceipt = await ledger
      .loadScheduledPullRequestEvaluatedScopeReceipt({
        candidate_dispatch_handle: options.candidate_dispatch_handle,
        minimal_scope_handle: preScope,
        trigger_identity: triggerIdentity,
      });
    relation = "scheduled-pull-request";
  } else if (new Set(["pull_request", "pull_request_target"]).has(eventName)) {
    if (typeof ledger.createPullRequestEventEvaluatedScopeReceipt !== "function") {
      throw new TypeError(
        "pull request route requires createPullRequestEventEvaluatedScopeReceipt",
      );
    }
    evaluatedScopeReceipt = await ledger
      .createPullRequestEventEvaluatedScopeReceipt({
        minimal_scope_handle: preScope,
        trigger_identity: triggerIdentity,
      });
    relation = "pull-request-event";
  } else {
    throw controllerFailure(
      "EVALUATED_SCOPE_ROUTE_UNSUPPORTED",
      "workflow event has no closed protected-ledger evaluated-scope relation",
    );
  }
  assertObject(evaluatedScopeReceipt, "ledger evaluated-scope receipt");
  return deepFreeze({
    relation,
    pre_scope: preScope,
    trigger_identity: triggerIdentity,
    evaluated_scope_receipt: evaluatedScopeReceipt,
    provider_artifact_handle: providerArtifactHandle,
  });
}

function normalizeMinimalRestPull(value, repository, pullNumber, restBase) {
  assertObject(value, "minimal REST pull request");
  if (
    value.number !== pullNumber ||
    value.url !== `${restBase}/repos/${repository.owner}/${repository.name}/pulls/${pullNumber}`
  ) {
    throw controllerFailure(
      "MINIMAL_SCOPE_IDENTITY_MISMATCH",
      "minimal REST pull request URL or number differs from its selector",
    );
  }
  const merged = strictBoolean(value.merged, "minimal REST pull request.merged");
  const mergedAt = nullableControllerTimestamp(
    value.merged_at,
    "minimal REST pull request.merged_at",
  );
  const restState = enumValue(
    value.state,
    new Set(["open", "closed"]),
    "minimal REST pull request.state",
  );
  if (merged !== (mergedAt !== null)) {
    throw new TypeError("minimal REST pull request merged fields are inconsistent");
  }
  return {
    node_id: boundedString(value.node_id, "minimal REST pull request.node_id", 256),
    state: merged ? "MERGED" : restState.toUpperCase(),
    merged,
    merged_at: mergedAt,
    updated_at: timestamp(value.updated_at, "minimal REST pull request.updated_at"),
  };
}

function normalizeMinimalGraphScope(value, repository, pullNumber) {
  assertObject(value, "minimal GraphQL response");
  if (value.errors !== undefined) {
    throw controllerFailure("MINIMAL_SCOPE_GRAPHQL_ERROR", "minimal GraphQL scope returned errors");
  }
  assertObject(value.data, "minimal GraphQL response.data");
  const repo = value.data.repository;
  assertObject(repo, "minimal GraphQL repository");
  const owner = boundedString(repo.owner?.login, "minimal GraphQL repository owner", 100);
  const name = boundedString(repo.name, "minimal GraphQL repository name", 100);
  if (
    owner.toLowerCase() !== repository.owner.toLowerCase() ||
    name.toLowerCase() !== repository.name.toLowerCase()
  ) {
    throw controllerFailure(
      "MINIMAL_SCOPE_REPOSITORY_MISMATCH",
      "minimal GraphQL scope resolved another repository",
    );
  }
  const pull = repo.pullRequest;
  assertObject(pull, "minimal GraphQL pull request");
  if (pull.number !== pullNumber) {
    throw controllerFailure(
      "MINIMAL_SCOPE_IDENTITY_MISMATCH",
      "minimal GraphQL scope resolved another pull request",
    );
  }
  const state = enumValue(
    pull.state,
    new Set(["OPEN", "CLOSED", "MERGED"]),
    "minimal GraphQL pull request.state",
  );
  const merged = strictBoolean(pull.merged, "minimal GraphQL pull request.merged");
  const mergedAt = nullableControllerTimestamp(
    pull.mergedAt,
    "minimal GraphQL pull request.mergedAt",
  );
  if (merged !== (state === "MERGED") || merged !== (mergedAt !== null)) {
    throw new TypeError("minimal GraphQL pull request lifecycle is inconsistent");
  }
  const baseRefName = nullableControllerString(
    pull.baseRefName,
    "minimal GraphQL pull request.baseRefName",
    256,
  );
  const headRefName = nullableControllerString(
    pull.headRefName,
    "minimal GraphQL pull request.headRefName",
    256,
  );
  const baseRefTip = normalizeMinimalRefTarget(
    pull.baseRef,
    baseRefName,
    "minimal GraphQL pull request.baseRef",
  );
  const headRefOid = sha(
    pull.headRefOid,
    "minimal GraphQL pull request.headRefOid",
  );
  const headTarget = normalizeMinimalRefTarget(
    pull.headRef,
    headRefName,
    "minimal GraphQL pull request.headRef",
  );
  if (headTarget !== null && headTarget !== headRefOid) {
    throw controllerFailure(
      "MINIMAL_SCOPE_HEAD_MISMATCH",
      "minimal GraphQL headRef target differs from headRefOid",
    );
  }
  const potential = normalizeMinimalPotentialMerge(
    pull.potentialMergeCommit,
    "minimal GraphQL potentialMergeCommit",
  );
  return {
    repository: {
      owner,
      name,
      node_id: boundedString(repo.id, "minimal GraphQL repository.id", 256),
    },
    pull_request: {
      number: pullNumber,
      node_id: boundedString(pull.id, "minimal GraphQL pull request.id", 256),
      state,
      merged,
      merged_at: mergedAt,
      is_draft: strictBoolean(pull.isDraft, "minimal GraphQL pull request.isDraft"),
      updated_at: timestamp(pull.updatedAt, "minimal GraphQL pull request.updatedAt"),
    },
    scope: {
      base_ref_name: baseRefName,
      base_ref_tip: baseRefTip,
      head_ref_name: headRefName,
      head_ref_oid: headRefOid,
      potential_merge_oid: potential.oid,
      potential_merge_tree: potential.tree,
      ordered_parent_oids: potential.parents,
      mergeable: enumValue(
        pull.mergeable,
        new Set(["CONFLICTING", "MERGEABLE", "UNKNOWN"]),
        "minimal GraphQL pull request.mergeable",
      ),
    },
  };
}

function normalizeMinimalRefTarget(value, expectedName, label) {
  if (value === null || value === undefined) return null;
  assertObject(value, label);
  if (value.name !== expectedName) {
    throw controllerFailure("MINIMAL_SCOPE_REF_MISMATCH", `${label} name differs`);
  }
  return sha(value.target?.oid, `${label}.target.oid`);
}

function normalizeMinimalPotentialMerge(value, label) {
  if (value === null || value === undefined) {
    return { oid: null, tree: null, parents: [] };
  }
  assertObject(value, label);
  assertObject(value.parents, `${label}.parents`);
  assertObject(value.parents.pageInfo, `${label}.parents.pageInfo`);
  const endCursor = value.parents.pageInfo.endCursor;
  if (
    value.parents.pageInfo.hasNextPage !== false ||
    (endCursor !== null &&
      (typeof endCursor !== "string" || endCursor.length === 0 || endCursor.length > 1024)) ||
    !Number.isSafeInteger(value.parents.totalCount) ||
    value.parents.totalCount < 0 || value.parents.totalCount > 3 ||
    !Array.isArray(value.parents.nodes) ||
    value.parents.nodes.length !== value.parents.totalCount
  ) {
    throw controllerFailure(
      "MINIMAL_SCOPE_PARENTS_INCOMPLETE",
      "minimal potential merge parents are not one complete ordered list",
    );
  }
  return {
    oid: sha(value.oid, `${label}.oid`),
    tree: sha(value.tree?.oid, `${label}.tree.oid`),
    parents: value.parents.nodes.map((parent, index) =>
      sha(parent?.oid, `${label}.parents.nodes[${index}].oid`)),
  };
}

function normalizeMinimalMergeRef(value, path, pullNumber, restBase) {
  assertObject(value, "minimal merge ref");
  const oid = sha(value.object?.sha, "minimal merge ref object.sha");
  const responsePath = path.replace("/git/ref/", "/git/refs/");
  const commitPath = path.replace(
    /\/git\/ref\/pull\/[0-9]+\/merge$/u,
    `/git/commits/${oid}`,
  );
  if (
    value.ref !== `refs/pull/${pullNumber}/merge` ||
    value.url !== `${restBase}${responsePath}` ||
    value.object?.type !== "commit" ||
    value.object.url !== `${restBase}${commitPath}`
  ) {
    throw controllerFailure(
      "MINIMAL_SCOPE_MERGE_REF_MISMATCH",
      "minimal merge ref response differs from its exact selector",
    );
  }
  return oid;
}

function normalizeMinimalNotFound(value) {
  assertObject(value, "minimal merge ref 404");
  if (value.message !== "Not Found") {
    throw controllerFailure(
      "MINIMAL_SCOPE_UNEXPECTED_404",
      "minimal merge ref 404 is not the closed GitHub Not Found profile",
    );
  }
  return null;
}

function controllerEndpointReceipt(method, path, capture) {
  return deepFreeze({
    method,
    path,
    status: capture.status,
    server_time: capture.server_time,
    raw_body_sha256: capture.raw_body_sha256,
  });
}

async function controllerApiJsonRequest({
  fetchImpl,
  limits,
  budget,
  url,
  method,
  headers,
  body = null,
  expected_statuses,
  label,
}) {
  if (budget.requests >= limits.max_requests) {
    throw controllerFailure("MINIMAL_SCOPE_REQUEST_LIMIT", "minimal scope request cap exhausted");
  }
  budget.requests += 1;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`${label} timed out`)),
    limits.timeout_ms,
  );
  let response;
  let bytes;
  try {
    response = await fetchImpl(url.href, {
      method,
      redirect: "error",
      signal: controller.signal,
      headers,
      ...(body === null ? {} : { body: JSON.stringify(body) }),
    });
    if (
      response === null || typeof response !== "object" ||
      !Number.isInteger(response.status) ||
      typeof response.headers?.get !== "function" ||
      !expected_statuses.includes(response.status)
    ) {
      throw controllerFailure(
        "MINIMAL_SCOPE_HTTP_ERROR",
        `${label} did not return its closed HTTP status`,
      );
    }
    const declared = parseBoundedContentLength(
      response.headers.get("content-length"),
      "MINIMAL_SCOPE_HTTP_ERROR",
      label,
    );
    if (declared !== null && declared > limits.max_response_bytes) {
      throw controllerFailure("MINIMAL_SCOPE_RESPONSE_LIMIT", `${label} is too large`);
    }
    bytes = await readBoundedControllerResponse(
      response,
      Math.min(limits.max_response_bytes, limits.max_total_bytes - budget.bytes),
      controller,
      label,
      {
        unreadable: "MINIMAL_SCOPE_HTTP_ERROR",
        too_large: "MINIMAL_SCOPE_RESPONSE_LIMIT",
        fragmented: "MINIMAL_SCOPE_RESPONSE_FRAGMENTED",
        exhausted: "MINIMAL_SCOPE_TOTAL_LIMIT",
      },
    );
  } catch (error) {
    if (error instanceof V2WorkflowControllerError) throw error;
    throw controllerFailure(
      controller.signal.aborted
        ? "MINIMAL_SCOPE_TIMEOUT"
        : "MINIMAL_SCOPE_NETWORK_ERROR",
      `${label} failed`,
      null,
      error,
    );
  } finally {
    clearTimeout(timer);
  }
  budget.bytes += bytes.byteLength;
  if (budget.bytes > limits.max_total_bytes) {
    throw controllerFailure("MINIMAL_SCOPE_TOTAL_LIMIT", "minimal scope byte cap exhausted");
  }
  const serverTime = canonicalHttpDate(response.headers.get("date"), `${label} Date`);
  if (
    budget.last_server_time !== null &&
    Date.parse(serverTime) < Date.parse(budget.last_server_time)
  ) {
    throw controllerFailure("MINIMAL_SCOPE_TIME_REGRESSED", `${label} Date regressed`);
  }
  budget.last_server_time = serverTime;
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw controllerFailure("MINIMAL_SCOPE_INVALID_UTF8", `${label} is not UTF-8`, null, error);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw controllerFailure("MINIMAL_SCOPE_INVALID_JSON", `${label} is not JSON`, null, error);
  }
  return {
    data,
    status: response.status,
    server_time: serverTime,
    raw_body_sha256: rawDigest(bytes),
  };
}

function normalizeMinimalScopeLimits(value) {
  assertObject(value, "minimal scope HTTP limits");
  exactKeys(value, [
    "max_requests", "max_response_bytes", "max_total_bytes", "timeout_ms",
  ].filter((key) => value[key] !== undefined), "minimal scope HTTP limits");
  const hard = {
    max_requests: 8,
    max_response_bytes: 2 * 1024 * 1024,
    max_total_bytes: 8 * 1024 * 1024,
    timeout_ms: 15_000,
  };
  const normalized = {};
  for (const [key, maximum] of Object.entries(hard)) {
    const selected = value[key] ?? maximum;
    if (!Number.isSafeInteger(selected) || selected <= 0 || selected > maximum) {
      throw new TypeError(`minimal scope ${key} may only tighten its hard maximum`);
    }
    normalized[key] = selected;
  }
  return Object.freeze(normalized);
}

function normalizeControllerServiceUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new TypeError(`${label} must be an absolute URL`, { cause: error });
  }
  if (
    url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
    url.search !== "" || url.hash !== ""
  ) {
    throw new TypeError(`${label} must be a credential-free HTTPS URL`);
  }
  return url.href.replace(/\/$/u, "");
}

function defaultControllerGraphqlUrl(restBase) {
  const url = new URL(restBase);
  if (url.hostname === "api.github.com" && (url.pathname === "/" || url.pathname === "")) {
    return "https://api.github.com/graphql";
  }
  if (url.pathname.endsWith("/api/v3")) {
    url.pathname = `${url.pathname.slice(0, -"/v3".length)}/graphql`;
  } else {
    url.pathname = `${url.pathname.replace(/\/$/u, "")}/graphql`;
  }
  return url.href;
}

function validateMinimalScopeReceipt(value, label) {
  assertObject(value, label);
  exactKeys(value, [
    "schema", "schema_version", "repository", "pull_request", "scope",
    "endpoint_receipts", "observed_at", "receipt_digest",
  ], label);
  if (value.schema !== V2_MINIMAL_SCOPE_RECEIPT_SCHEMA || value.schema_version !== 1) {
    throw new TypeError(`${label} has an unsupported schema`);
  }
  digest(value.receipt_digest, `${label}.receipt_digest`);
  const { receipt_digest: _digest, ...withoutDigest } = value;
  if (value.receipt_digest !== digestCanonical(
    "codex-review-gate-v2-minimal-live-scope",
    withoutDigest,
  )) {
    throw new TypeError(`${label} receipt digest is invalid`);
  }
  timestamp(value.observed_at, `${label}.observed_at`);
  return value;
}

function requireV2MinimalLiveScopeHandle(value, label) {
  const binding = value !== null && typeof value === "object" && !Array.isArray(value)
    ? V2_MINIMAL_LIVE_SCOPE_HANDLES.get(value)
    : undefined;
  if (binding === undefined) {
    throw controllerFailure(
      "UNTRUSTED_MINIMAL_LIVE_SCOPE_HANDLE",
      `${label} must be the direct result of loadV2MinimalLiveScope`,
    );
  }
  if (!Object.isFrozen(value) || !Object.isFrozen(binding)) {
    throw controllerFailure(
      "UNSEALED_MINIMAL_LIVE_SCOPE_HANDLE",
      `${label} is not sealed`,
    );
  }
  const receipt = validateMinimalScopeReceipt(value, label);
  const currentBinding = {
    repository: {
      owner: receipt.repository.owner,
      name: receipt.repository.name,
    },
    pull_number: receipt.pull_request.number,
    receipt_digest: receipt.receipt_digest,
  };
  if (canonicalJson(currentBinding) !== canonicalJson(binding)) {
    throw controllerFailure(
      "MINIMAL_LIVE_SCOPE_HANDLE_BINDING_MISMATCH",
      `${label} no longer equals its sealed loader binding`,
    );
  }
  return { receipt, binding };
}

function requireV2LeasedDiscoveryContinuityHandle(value) {
  const binding = value !== null && typeof value === "object" &&
      !Array.isArray(value)
    ? V2_LEASED_DISCOVERY_CONTINUITY_HANDLES.get(value)
    : undefined;
  if (binding === undefined) {
    throw controllerFailure(
      "UNTRUSTED_LEASED_DISCOVERY_CONTINUITY_HANDLE",
      "leased discovery continuity must be the direct successful controller result",
    );
  }
  if (!Object.isFrozen(value) || !Object.isFrozen(binding)) {
    throw controllerFailure(
      "UNSEALED_LEASED_DISCOVERY_CONTINUITY_HANDLE",
      "leased discovery continuity handle or private binding is not sealed",
    );
  }
  exactKeys(value, ["continuity_receipt"],
    "leased discovery continuity handle");
  const receipt = validateV2GitLedgerDiscoveryContinuityReceipt(
    value.continuity_receipt,
    {
      repository: binding.repository,
      scope: binding.scope,
      pre_scope_receipt_digest: binding.pre_scope_receipt.receipt_digest,
      lease_receipt: binding.lease_receipt,
    },
  );
  if (
    receipt.continuity_receipt_digest !==
      binding.continuity_receipt_digest
  ) {
    throw controllerFailure(
      "LEASED_DISCOVERY_CONTINUITY_BINDING_MISMATCH",
      "leased discovery continuity receipt differs from its sealed binding",
    );
  }
  assertV2MinimalLiveScopeHandle(binding.minimal_pre, {
    repository: {
      owner: binding.repository.owner,
      name: binding.repository.name,
    },
    pull_number: binding.scope.pull_request.number,
  });
  assertV2MinimalLiveScopeHandle(binding.minimal_post, {
    repository: {
      owner: binding.repository.owner,
      name: binding.repository.name,
    },
    pull_number: binding.scope.pull_request.number,
  });
  const transport = projectV2TransportSnapshotForGitLedger(
    binding.discovery_snapshot,
    {
      repository: {
        owner: binding.repository.owner,
        name: binding.repository.name,
      },
      scope: binding.scope,
    },
  );
  if (
    transport.snapshot !== binding.discovery_snapshot ||
    canonicalJson(transport.effective_limits) !==
      canonicalJson(binding.transport_limits)
  ) {
    throw controllerFailure(
      "LEASED_DISCOVERY_CONTINUITY_BINDING_MISMATCH",
      "leased discovery transport authority differs from its sealed binding",
    );
  }
  return { handle: value, binding };
}

function normalizeLeasedDiscoveryScope(value) {
  assertObject(value, "leased discovery PR scope");
  exactKeys(value, [
    "pull_request",
    "head_ref_oid",
    "base_ref_oid",
    "potential_merge_commit_oid",
  ], "leased discovery PR scope");
  assertObject(value.pull_request, "leased discovery PR scope.pull_request");
  exactKeys(value.pull_request, ["number", "node_id"],
    "leased discovery PR scope.pull_request");
  return {
    pull_request: {
      number: positiveInteger(
        value.pull_request.number,
        "leased discovery PR number",
      ),
      node_id: boundedString(
        value.pull_request.node_id,
        "leased discovery PR node id",
        256,
      ),
    },
    head_ref_oid: sha(value.head_ref_oid, "leased discovery head SHA"),
    base_ref_oid: sha(value.base_ref_oid, "leased discovery base SHA"),
    potential_merge_commit_oid:
      value.potential_merge_commit_oid === null
        ? null
        : sha(
            value.potential_merge_commit_oid,
            "leased discovery potential merge SHA",
          ),
  };
}

function normalizeLeasedDiscoveryRepository(value) {
  assertObject(value, "leased discovery repository");
  exactKeys(value, ["owner", "name", "id", "node_id", "owner_id"],
    "leased discovery repository");
  const path = normalizeRepository({ owner: value.owner, name: value.name });
  return {
    ...path,
    id: positiveDecimalString(value.id, "leased discovery repository id"),
    node_id: boundedString(
      value.node_id,
      "leased discovery repository node id",
      256,
    ),
    owner_id: positiveDecimalString(
      value.owner_id,
      "leased discovery repository owner id",
    ),
  };
}

function minimalScopeStableProjection(value) {
  return {
    repository: value.repository,
    pull_request: value.pull_request,
    scope: value.scope,
  };
}

function minimalScopeDiscoveryProjection(value) {
  const projection = minimalScopeStableProjection(value);
  return {
    repository: projection.repository,
    pull_request: {
      number: projection.pull_request.number,
      node_id: projection.pull_request.node_id,
      state: projection.pull_request.state,
      merged: projection.pull_request.merged,
      merged_at: projection.pull_request.merged_at,
      is_draft: projection.pull_request.is_draft,
    },
    scope: projection.scope,
  };
}

function fullDiscoveryScopeProjection(snapshot) {
  assertObject(snapshot.repository, "discovery_snapshot.repository");
  assertObject(snapshot.pull_request, "discovery_snapshot.pull_request");
  assertObject(snapshot.scope, "discovery_snapshot.scope");
  assertObject(snapshot.scope_receipts, "discovery_snapshot.scope_receipts");
  const expected = {
    repository: structuredClone(snapshot.repository),
    pull_request: structuredClone(snapshot.pull_request),
    scope: structuredClone(snapshot.scope),
  };
  for (const phase of ["pre", "post"]) {
    const receipt = snapshot.scope_receipts[phase];
    assertObject(receipt, `discovery_snapshot.scope_receipts.${phase}`);
    const projection = {
      repository: {
        owner: receipt.repository_owner,
        name: receipt.repository_name,
        node_id: receipt.repository_node_id,
      },
      pull_request: {
        number: receipt.pull_request_number,
        node_id: receipt.pull_request_node_id,
        state: receipt.pull_request_state,
        merged: receipt.pull_request_merged,
        merged_at: receipt.pull_request_merged_at,
        is_draft: receipt.pull_request_is_draft,
      },
      scope: {
        base_ref_name: receipt.base_ref_name,
        base_ref_tip: receipt.base_ref_tip,
        head_ref_name: receipt.head_ref_name,
        head_ref_oid: receipt.head_ref_oid,
        merge_base_sha: receipt.merge_base_sha,
        potential_merge_oid: receipt.potential_merge_oid,
        potential_merge_tree: receipt.potential_merge_tree,
        ordered_parent_oids: receipt.ordered_parent_oids,
        merge_ref_oid: receipt.merge_ref_oid,
        mergeable: receipt.mergeable,
      },
    };
    if (canonicalJson(projection) !== canonicalJson(expected)) {
      throw controllerFailure(
        "FULL_DISCOVERY_INTERNAL_SCOPE_DRIFT",
        "full discovery scope receipt differs from its snapshot projection",
      );
    }
  }
  return expected;
}

function latestControllerServerTime(values) {
  if (values.length === 0) throw new TypeError("server time inventory is empty");
  return values.reduce((latest, current) =>
    Date.parse(current) > Date.parse(latest) ? current : latest);
}

function strictBoolean(value, label) {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be boolean`);
  return value;
}

function nullableControllerTimestamp(value, label) {
  return value === null ? null : timestamp(value, label);
}

function nullableControllerString(value, label, maximum) {
  return value === null ? null : boundedString(value, label, maximum);
}

/**
 * Diagnostic-only open inventory. Even two equal complete offset-pagination
 * passes cannot exclude close/reopen ABA at a page boundary. The explicit
 * completeness marker prevents this observation from masquerading as a
 * scheduler or effect authority.
 */
export async function listAllOpenPullRequests({
  fetch: fetchImpl,
  token,
  repository,
  restBaseUrl = "https://api.github.com",
}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("open PR inventory requires fetch");
  }
  const repo = normalizeRepository(repository);
  const base = normalizeRestBase(restBaseUrl);
  const authorization = boundedString(token, "token", 4096);
  const repoPath = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
  const first = await loadOpenPullRequestInventoryPass({
    fetchImpl,
    authorization,
    base,
    repoPath,
  });
  const second = await loadOpenPullRequestInventoryPass({
    fetchImpl,
    authorization,
    base,
    repoPath,
  });
  if (canonicalJson(first) !== canonicalJson(second)) {
    throw controllerFailure(
      "OPEN_PULL_REQUEST_INVENTORY_DRIFT",
      "open PR inventory changed across its two complete pagination passes",
    );
  }
  if (first.length > MAX_V2_OPEN_PULL_REQUEST_MATRIX_JOBS) {
    throw controllerFailure(
      "OPEN_PULL_REQUEST_MATRIX_LIMIT",
      `open PR inventory exceeds the ${MAX_V2_OPEN_PULL_REQUEST_MATRIX_JOBS}-job matrix cap`,
      { open_pull_request_count: first.length },
    );
  }
  return deepFreeze({
    schema: V2_OPEN_PULL_REQUEST_DIAGNOSTIC_SCHEMA,
    schema_version: 1,
    completeness: "unproven",
    pull_requests: first,
  });
}

async function loadOpenPullRequestInventoryPass({
  fetchImpl,
  authorization,
  base,
  repoPath,
}) {
  const pulls = [];
  const ids = new Set();
  for (let page = 1; page <= 100; page += 1) {
    const capture = await requestJsonArray({
      fetchImpl,
      authorization,
      base,
      method: "GET",
      path: `${repoPath}/pulls?state=open&sort=created&direction=asc&per_page=100&page=${page}`,
      expectedStatus: 200,
    });
    for (const pull of capture.data) {
      assertObject(pull, "open pull request");
      const number = positiveInteger(pull.number, "open pull request.number");
      if (pull.state !== "open" || pull.merged_at !== null || ids.has(number)) {
        throw new Error("open PR inventory is not a unique open/unmerged projection");
      }
      ids.add(number);
      pulls.push(number);
      if (pulls.length > MAX_V2_OPEN_PULL_REQUEST_MATRIX_JOBS) {
        throw controllerFailure(
          "OPEN_PULL_REQUEST_MATRIX_LIMIT",
          `open PR inventory exceeds the ${MAX_V2_OPEN_PULL_REQUEST_MATRIX_JOBS}-job matrix cap`,
          { open_pull_request_count: pulls.length },
        );
      }
    }
    if (capture.data.length < 100) return pulls;
  }
  throw new Error("open PR inventory pagination exceeds the fail-closed cap");
}

export async function writeV2WorkflowOutputs({
  result,
  environment = process.env,
}) {
  assertObject(result, "workflow cycle result");
  assertObject(result.terminal_result, "workflow cycle terminal_result");
  assertNoCompactReducerReport(
    result.terminal_result.report,
    "canonical public report",
  );
  const publicReport = assertV2PublicReport(result.terminal_result.report);
  if (publicReport.decision !== result.terminal_result.decision) {
    throw controllerFailure(
      "PUBLIC_REPORT_DECISION_MISMATCH",
      "canonical public report decision differs from the terminal controller result",
    );
  }
  const runnerTemp = await realpath(requiredEnv(environment, "RUNNER_TEMP"));
  const outputPath = await canonicalCandidate(
    requiredEnv(environment, "V2_CONTROLLER_OUTPUT_PATH"),
  );
  assertPathInside(outputPath, runnerTemp, "V2_CONTROLLER_OUTPUT_PATH");
  if ((await exists(outputPath))) {
    throw new Error("controller output path must be absent before publication");
  }
  const directory = resolve(runnerTemp, "codex-review-gate-v2-controller");
  await mkdir(directory, { recursive: false, mode: 0o700 }).catch(async (error) => {
    if (error?.code !== "EEXIST") throw error;
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error("controller output directory is not an ordinary directory");
    }
  });
  const artifacts = {
    "report-path": publicReport,
    "status-plan-path": result.terminal_result.status_plan,
    "reservation-path": result.initial_result?.reservation ?? null,
    "intent-path": result.initial_result?.post_intent ?? null,
    "binding-receipt-path": result.binding_receipt ?? null,
    "sticky-receipt-path": result.sticky_receipt ?? null,
    "ledger-receipt-path": result.ledger,
  };
  const outputs = {};
  for (const [name, artifact] of Object.entries(artifacts)) {
    if (artifact === null) {
      outputs[name] = "";
      continue;
    }
    assertNoCompactReducerReport(artifact, name);
    const path = resolve(directory, `${name}.json`);
    await writeExclusiveCanonical(path, artifact);
    outputs[name] = path;
  }
  outputs.decision = boundedString(
    result.terminal_result.decision,
    "terminal decision",
    64,
  );
  outputs["due-at"] = result.terminal_result.due_at ??
    result.terminal_result.scheduler_plan?.due_at ?? "";
  outputs["wakeup-hints"] = result.terminal_result.wakeup_hints ??
    projectV2WorkflowWakeupHint(result.terminal_result);
  exactKeys(outputs, WORKFLOW_OUTPUT_NAMES, "workflow outputs");
  const summary = {
    schema: V2_WORKFLOW_OUTPUT_SCHEMA,
    schema_version: 1,
    outputs,
  };
  assertNoCompactReducerReport(summary, "workflow output summary");
  await writeExclusiveCanonical(outputPath, summary);
  if (environment.GITHUB_OUTPUT) {
    const lines = WORKFLOW_OUTPUT_NAMES.map((name) =>
      `${name}=${String(outputs[name]).replace(/[\r\n%]/gu, "")}`).join("\n") + "\n";
    await appendFile(environment.GITHUB_OUTPUT, lines, { encoding: "utf8" });
  }
  return deepFreeze(summary);
}

function assertNoCompactReducerReport(value, label, depth = 0) {
  if (depth > 64) {
    throw new TypeError(`${label} exceeds the public output nesting cap`);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoCompactReducerReport(item, label, depth + 1);
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (Object.hasOwn(value, "reducer_report")) {
    throw controllerFailure(
      "COMPACT_REDUCER_REPORT_PUBLICATION_BLOCKED",
      `${label} contains the internal compact reducer report`,
    );
  }
  for (const item of Object.values(value)) {
    assertNoCompactReducerReport(item, label, depth + 1);
  }
}

function projectV2WorkflowWakeupHint(result, scheduling = null) {
  const due = result.scheduler_plan?.due_at;
  if (due === null || due === undefined) return "";
  if (scheduling?.public_wait_supported !== true) return "private-reconcile";
  const evaluation = result.scheduler_evaluation;
  assertObject(evaluation, "public wait scheduler evaluation");
  assertObject(scheduling.epoch, "public wait scheduler epoch");
  assertObject(
    scheduling.epoch.automatic_request,
    "public wait automatic request state",
  );
  if (!PUBLIC_WAIT_AUTOMATIC_REQUEST_STATES.has(
    scheduling.epoch.automatic_request.state,
  )) {
    throw controllerFailure(
      "PUBLIC_WAIT_PHASE_UNCLASSIFIED",
      "a public scheduler due_at carried an unknown automatic request state",
    );
  }
  if (
    PUBLIC_WAIT_NO_START_DECISIONS.has(evaluation.decision) &&
    evaluation.no_start_candidate !== null
  ) {
    return "public-no-start-wait";
  }
  if (
    evaluation.decision === "findings" &&
    scheduling.epoch.automatic_request.generation_index > 1
  ) {
    return "public-post-request-wait";
  }
  const observedAt = Date.parse(timestamp(
    evaluation.observed_at,
    "public wait scheduler evaluation observed_at",
  ));
  const epochStartedAt = Date.parse(timestamp(
    scheduling.epoch.started_at,
    "public wait scheduler epoch started_at",
  ));
  if (observedAt < epochStartedAt + PUBLIC_INITIAL_WAIT_MS) {
    return "public-initial-wait";
  }
  if (PUBLIC_WAIT_PENDING_DECISIONS.has(evaluation.decision)) {
    return "public-post-request-wait";
  }
  throw controllerFailure(
    "PUBLIC_WAIT_PHASE_UNCLASSIFIED",
    "a public scheduler due_at did not match a closed wait phase",
  );
}

async function writeExclusiveCanonical(path, value) {
  await writeFile(path, `${canonicalJson(value)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
}

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function runV2WorkflowControllerCli(
  environment = process.env,
  dependencies = {},
) {
  const command = await readV2WorkflowCommand(environment);
  if (command.route.operation === "evaluate-only" && command.route.trigger !== "manual") {
    throw new Error("evaluate-only workflow command must use the manual trigger");
  }
  if (command.pull_request.number === null) {
    throw controllerFailure(
      "SCAN_ALL_REQUIRES_SCHEDULE_DISPATCH",
      "scan-all-open must use `schedule-dispatch`; `run` executes exactly one selected PR",
    );
  }
  exactKeys(dependencies, ["fetch"].filter((key) => dependencies[key] !== undefined),
    "workflow controller dependencies");
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const cycle = await assembleV2ProductionControllerCycle({
    command,
    environment,
    fetch: fetchImpl,
  });
  assertObject(cycle, "production controller cycle");
  const output = await writeV2WorkflowOutputs({ result: cycle, environment });
  return deepFreeze({ command, cycle, output });
}

/**
 * Build one durable scheduled matrix from the protected candidate inventory.
 * The returned/public value contains only GitHub matrix rows; every ledger
 * handle and receipt remains confined to this process.
 */
export async function runV2ScheduleDispatchCli(
  environment = process.env,
  dependencies = {},
) {
  exactKeys(dependencies, [
    "fetch",
  ].filter((key) => dependencies[key] !== undefined),
  "schedule-dispatch dependencies");
  const command = await readV2WorkflowCommand(environment);
  if (
    command.pull_request.number !== null ||
    command.dispatch_binding !== null ||
    command.route.operation !== "ordinary" ||
    command.route.trigger !== "schedule" ||
    command.route.observation_boundary !== "initial" ||
    environment.V2_CONTROLLER_ROUTE !== "scan-all-open"
  ) {
    throw controllerFailure(
      "SCHEDULE_DISPATCH_ROUTE_REQUIRED",
      "schedule-dispatch requires the validated initial scan-all-open command",
    );
  }
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const activation = await activateV2ProductionLedgerAuthority({
    command,
    environment,
    fetch: fetchImpl,
  });
  if (activation.state !== "active") {
    throw controllerFailure(
      "SCHEDULE_DISPATCH_LEDGER_AUTHORITY_REQUIRED",
      "schedule-dispatch cannot publish a matrix without active protected-ledger authority",
      { public_effects_performed: 0 },
    );
  }
  const rows = await loadV2ScheduleDispatchMatrixRows({
    command,
    environment,
    ledger: activation.ledger,
    repository_endpoint_receipt:
      activation.preflight_handle.repository_endpoint_receipt,
  });
  return writeV2ScheduleDispatchMatrixOutput({ rows, environment });
}

export async function writeV2ScheduleDispatchMatrixOutput({
  rows,
  environment = process.env,
}) {
  const matrix = deepFreeze({ include: rows });
  const canonical = canonicalJson(matrix);
  if (/[\0\r\n]/u.test(canonical)) {
    throw new Error("schedule-dispatch matrix is not one canonical output line");
  }
  const githubOutputLine = `matrix=${canonical}\n`;
  if (
    Buffer.byteLength(githubOutputLine, "utf16le") >
      MAX_V2_SCHEDULE_DISPATCH_GITHUB_OUTPUT_UTF16_BYTES
  ) {
    throw controllerFailure(
      "SCHEDULE_DISPATCH_OUTPUT_TOO_LARGE",
      "schedule-dispatch matrix exceeds the GitHub job-output byte cap",
    );
  }
  if (environment.GITHUB_OUTPUT !== undefined) {
    await appendFile(
      requiredEnv(environment, "GITHUB_OUTPUT"),
      githubOutputLine,
      { encoding: "utf8" },
    );
  }
  return deepFreeze({
    matrix,
    rendered: `${canonical}\n`,
  });
}

async function loadV2ScheduleDispatchMatrixRows({
  command,
  environment,
  ledger,
  repository_endpoint_receipt: repositoryEndpointReceipt,
}) {
  for (const [name, callback] of [
    ["load", ledger?.load],
    ["reconcileCandidateInventoryRefreshAtomically",
      ledger?.reconcileCandidateInventoryRefreshAtomically],
    ["loadOrReserveCandidateDispatch", ledger?.loadOrReserveCandidateDispatch],
  ]) {
    if (typeof callback !== "function") {
      throw controllerFailure(
        "SCHEDULE_DISPATCH_LEDGER_API_REQUIRED",
        `schedule-dispatch requires protected ledger ${name}`,
      );
    }
  }
  const triggerIdentity = loadV2GitLedgerTriggerIdentity({
    command,
    environment,
  });
  const loaded = await ledger.load();
  const candidateAuthority = loaded.authority_projection?.candidate_inventory;
  assertObject(candidateAuthority, "candidate inventory authority");
  const completedInventory = candidateAuthority.completed_cycle;
  const completedGeneration = candidateAuthority.completed_generation ?? null;
  if (completedInventory !== null && completedGeneration !== null) {
    throw controllerFailure(
      "SCHEDULE_DISPATCH_CANDIDATE_AUTHORITY_INVALID",
      "candidate inventory authority returned two completed source generations",
    );
  }
  const currentDispatch = loaded.authority_projection?.candidate_dispatch
    ?.current_cycle ?? null;
  const completedSourceRecordOid = completedInventory?.complete_record_oid ??
    completedGeneration?.generation_record_oid ?? null;
  const completedSourceDigest = completedInventory?.cycle_receipt
    ?.receipt_digest ?? completedGeneration?.inventory_digest ?? null;
  const completedInventoryAlreadyDispatched =
    completedSourceRecordOid !== null && completedSourceDigest !== null &&
    currentDispatch?.cycle_complete === true &&
    currentDispatch.completed_cycle_record_oid ===
      completedSourceRecordOid &&
    currentDispatch.inventory_digest === completedSourceDigest &&
    (completedInventory === null ||
      currentDispatch.cycle_id === completedInventory.cycle_id);
  let refreshPersisted = false;
  let candidateRefreshReconciliation = null;
  if (
    completedSourceRecordOid === null ||
    candidateAuthority.incomplete_cycle !== null ||
    candidateAuthority.atomic_cycle !== null ||
    completedInventoryAlreadyDispatched
  ) {
    const reconciliation =
      validateV2CandidateRefreshReconciliationForSource(
        await ledger.reconcileCandidateInventoryRefreshAtomically({
          workflow_command_handle: command,
          trigger_identity: triggerIdentity,
          repository_endpoint_receipt: repositoryEndpointReceipt,
        }),
        candidateAuthority,
      );
    candidateRefreshReconciliation = reconciliation;
    if (reconciliation.state === "suppressed") {
      if (reconciliation.publication_result !== null) {
        throw controllerFailure(
          "SCHEDULE_DISPATCH_RECONCILIATION_INVALID",
          "suppressed candidate refresh unexpectedly returned a publication",
        );
      }
      return disabledV2CandidateDispatchRows();
    }
    if (
      reconciliation.state !== "persisted" ||
      reconciliation.publication_result?.state !== "persisted"
    ) {
      throw controllerFailure(
        "SCHEDULE_DISPATCH_RECONCILIATION_INVALID",
        "candidate refresh did not return one durable atomic publication",
        {
          state: typeof reconciliation.state === "string"
            ? reconciliation.state
            : null,
        },
      );
    }
    refreshPersisted = true;
  }
  let dispatch = await ledger.loadOrReserveCandidateDispatch({
    workflow_command_handle: command,
    trigger_identity: triggerIdentity,
    repository_endpoint_receipt: repositoryEndpointReceipt,
    ...(candidateRefreshReconciliation === null ? {} : {
      candidate_refresh_reconciliation_result:
        candidateRefreshReconciliation,
    }),
  });
  assertObject(dispatch, "candidate dispatch load result");
  if (
    refreshPersisted && dispatch.state === "dispatch" &&
    dispatch.restarted !== true
  ) {
    throw controllerFailure(
      "SCHEDULE_DISPATCH_ATOMIC_RESERVATION_MISSING",
      "atomic candidate refresh did not publish its first dispatch reservation",
    );
  }
  if (dispatch.state === "recovery-required") {
    assertObject(
      dispatch.recovery_required,
      "candidate dispatch recovery requirement",
    );
    if (dispatch.recovery_required.ready !== true) {
      return disabledV2CandidateDispatchRows();
    }
    if (typeof ledger.recoverCandidateDispatchFailure !== "function") {
      throw controllerFailure(
        "SCHEDULE_DISPATCH_RECOVERY_API_REQUIRED",
        "ready candidate dispatch recovery requires the public ledger recovery API",
      );
    }
    await ledger.recoverCandidateDispatchFailure({
      workflow_command_handle: command,
      trigger_identity: triggerIdentity,
      repository_endpoint_receipt: repositoryEndpointReceipt,
      expected_dispatch_binding:
        dispatch.recovery_required.expected_dispatch_binding,
    });
    dispatch = await ledger.loadOrReserveCandidateDispatch({
      workflow_command_handle: command,
      trigger_identity: triggerIdentity,
      repository_endpoint_receipt: repositoryEndpointReceipt,
    });
    assertObject(dispatch, "candidate dispatch post-recovery load result");
  }
  if (dispatch.state === "complete") {
    return disabledV2CandidateDispatchRows();
  }
  if (dispatch.state !== "dispatch") {
    throw new Error("candidate dispatch returned an unsupported state");
  }
  const plan = projectV2GitLedgerCandidateDispatchPlan(
    dispatch.candidate_dispatch_handle,
  );
  if (canonicalJson(plan) !== canonicalJson(dispatch.plan)) {
    throw controllerFailure(
      "SCHEDULE_DISPATCH_PLAN_PROJECTION_MISMATCH",
      "candidate dispatch result differs from its same-process public projection",
    );
  }
  if (plan.items.length === 0) {
    throw new Error("dispatch state requires at least one remaining candidate");
  }
  return deepFreeze(plan.items.map((_item, itemIndex) => {
    const binding = projectV2GitLedgerCandidateDispatchBinding(
      plan,
      itemIndex,
    );
    const candidateNumber = binding.candidate.schema_version === 2
      ? binding.candidate.identity?.number
      : binding.candidate.number;
    return {
      enabled: true,
      pull_request: positiveInteger(
        candidateNumber,
        "candidate dispatch matrix pull_request",
      ),
      dispatch_binding: canonicalJson(binding),
    };
  }));
}

function expectedLegacyCandidateRefreshPublicationBoundary(incomplete) {
  if (incomplete === null) return null;
  assertObject(incomplete, "incomplete candidate inventory authority");
  assertObject(
    incomplete.initial_inventory,
    "incomplete candidate inventory initial scan",
  );
  const shards = incomplete.initial_inventory.shards;
  const shardReceipts = incomplete.shard_receipts;
  const nextShardIndex = incomplete.next_shard_index;
  if (
    !Array.isArray(shards) || shards.length > MAX_V2_CANDIDATE_PAGES ||
    !Array.isArray(shardReceipts) || shardReceipts.length !== nextShardIndex ||
    !Number.isSafeInteger(nextShardIndex) || nextShardIndex < 0 ||
    nextShardIndex > shards.length
  ) {
    throw controllerFailure(
      "SCHEDULE_DISPATCH_CANDIDATE_AUTHORITY_INVALID",
      "incomplete candidate inventory returned an invalid durable shard boundary",
    );
  }
  if (
    typeof incomplete.cycle_id !== "string" ||
    !SHA.test(incomplete.start_record_oid)
  ) {
    throw controllerFailure(
      "SCHEDULE_DISPATCH_CANDIDATE_AUTHORITY_INVALID",
      "incomplete candidate inventory returned an invalid durable cycle identity",
    );
  }
  return deepFreeze({
    cycle_id: incomplete.cycle_id,
    start_record_oid: incomplete.start_record_oid,
    published_record_count: shards.length - nextShardIndex + 2,
  });
}

export function validateV2CandidateRefreshReconciliationForSource(
  value,
  candidateAuthority,
) {
  assertObject(candidateAuthority, "candidate inventory authority");
  return validateV2CandidateRefreshReconciliation(
    value,
    expectedLegacyCandidateRefreshPublicationBoundary(
      candidateAuthority.incomplete_cycle,
    ),
  );
}

function validateV2CandidateRefreshReconciliation(
  value,
  expectedLegacyPublicationBoundary,
) {
  assertObject(value, "candidate inventory reconciliation result");
  exactKeys(value, [
    "schema", "schema_version", "state", "reason", "repository",
    "ledger_ref", "adapter_configuration_digest", "persistence_mode",
    "suppression_result", "publication_result", "result_digest",
  ], "candidate inventory reconciliation result");
  if (
    value.schema !== V2_GIT_LEDGER_CANDIDATE_REFRESH_RECONCILIATION_SCHEMA ||
    value.schema_version !== 2 ||
    typeof value.reason !== "string" ||
    typeof value.ledger_ref !== "string" ||
    !DIGEST.test(value.adapter_configuration_digest) ||
    !DIGEST.test(value.result_digest)
  ) {
    throw controllerFailure(
      "SCHEDULE_DISPATCH_RECONCILIATION_INVALID",
      "candidate refresh returned an invalid public reconciliation receipt",
    );
  }
  assertObject(value.repository, "candidate refresh repository");
  if (value.state === "suppressed") {
    assertObject(value.suppression_result, "candidate suppression result");
    if (
      expectedLegacyPublicationBoundary !== null ||
      value.persistence_mode !== null ||
      value.publication_result !== null ||
      value.suppression_result.state !== "suppressed" ||
      value.suppression_result.writes_performed !== false
    ) {
      throw controllerFailure(
        "SCHEDULE_DISPATCH_RECONCILIATION_INVALID",
        "suppressed candidate refresh returned inconsistent authority",
      );
    }
    return value;
  }
  if (
    value.state !== "persisted" ||
    !new Set([
      "current-open-generation-v3",
      "legacy-finish-v1",
    ]).has(value.persistence_mode) ||
    value.suppression_result !== null
  ) {
    throw controllerFailure(
      "SCHEDULE_DISPATCH_RECONCILIATION_INVALID",
      "candidate refresh returned an unsupported reconciliation state",
    );
  }
  if (
    (value.persistence_mode === "legacy-finish-v1") !==
      (expectedLegacyPublicationBoundary !== null)
  ) {
    throw controllerFailure(
      "SCHEDULE_DISPATCH_RECONCILIATION_INVALID",
      "candidate refresh persistence mode differs from its durable source boundary",
    );
  }
  validateV2CandidateRefreshPublication(
    value.publication_result,
    value.persistence_mode,
    expectedLegacyPublicationBoundary,
  );
  return value;
}

function validateV2CandidateRefreshPublication(
  value,
  persistenceMode,
  expectedLegacyPublicationBoundary,
) {
  assertObject(value, "candidate refresh publication");
  const currentOpen = persistenceMode === "current-open-generation-v3";
  exactKeys(value, currentOpen
    ? [
        "schema", "schema_version", "state", "reason",
        "publication_outcome", "repository", "ledger_ref", "generation_id",
        "production_candidate_authority_digest", "candidate_count",
        "candidate_set_digest", "source_current_open_semantic_digest",
        "lifecycle_candidate_set_digest", "attachment_manifest_digest",
        "published_record_commit_shas", "append_receipts",
        "latest_append_receipt", "final_tip_commit_sha",
        "final_commit_count", "writes_performed", "result_digest",
      ]
    : [
        "schema", "schema_version", "state", "reason",
        "publication_outcome", "repository", "ledger_ref", "cycle_id",
        "start_record_oid", "cycle_receipt_digest",
        "published_record_commit_shas", "append_receipts",
        "latest_append_receipt", "final_tip_commit_sha",
        "final_commit_count", "writes_performed", "result_digest",
      ], "candidate refresh publication");
  if (
    value.schema !== (currentOpen
      ? V2_CURRENT_OPEN_GENERATION_PUBLICATION_SCHEMA
      : V2_CANDIDATE_LEGACY_FINISH_PUBLICATION_SCHEMA) ||
    value.schema_version !== 1 ||
    value.state !== "persisted" ||
    !new Set(["published", "recovered-after-apply"])
      .has(value.publication_outcome) ||
    typeof value.reason !== "string" ||
    typeof value.ledger_ref !== "string" ||
    !Array.isArray(value.published_record_commit_shas) ||
    value.published_record_commit_shas.length !== (currentOpen
      ? 2
      : expectedLegacyPublicationBoundary?.published_record_count) ||
    value.published_record_commit_shas.some((oid) => !SHA.test(oid)) ||
    !Array.isArray(value.append_receipts) ||
    !SHA.test(value.final_tip_commit_sha) ||
    !Number.isSafeInteger(value.final_commit_count) ||
    value.final_commit_count < 0 ||
    value.writes_performed !== true ||
    !DIGEST.test(value.result_digest)
  ) {
    throw controllerFailure(
      "SCHEDULE_DISPATCH_RECONCILIATION_INVALID",
      "candidate refresh did not return one durable atomic publication",
    );
  }
  assertObject(value.repository, "candidate refresh publication repository");
  if (currentOpen) {
    if (
      typeof value.generation_id !== "string" ||
      !Number.isSafeInteger(value.candidate_count) ||
      value.candidate_count < 0 ||
      !DIGEST.test(value.production_candidate_authority_digest) ||
      !DIGEST.test(value.candidate_set_digest) ||
      !DIGEST.test(value.source_current_open_semantic_digest) ||
      !DIGEST.test(value.lifecycle_candidate_set_digest) ||
      !DIGEST.test(value.attachment_manifest_digest)
    ) {
      throw controllerFailure(
        "SCHEDULE_DISPATCH_RECONCILIATION_INVALID",
        "current-open generation publication is invalid",
      );
    }
  } else if (
    typeof value.cycle_id !== "string" ||
    value.cycle_id !== expectedLegacyPublicationBoundary?.cycle_id ||
    !SHA.test(value.start_record_oid) ||
    value.start_record_oid !==
      expectedLegacyPublicationBoundary?.start_record_oid ||
    !DIGEST.test(value.cycle_receipt_digest)
  ) {
    throw controllerFailure(
      "SCHEDULE_DISPATCH_RECONCILIATION_INVALID",
      "legacy finish publication is invalid",
    );
  }
}

function disabledV2CandidateDispatchRows() {
  return deepFreeze([{
    enabled: false,
    pull_request: 0,
    dispatch_binding: "null",
  }]);
}

function createV2CandidateInventoryRefreshAdapter({
  fetch,
  token,
  repository,
  rest_base_url: restBaseUrl,
  controller_release: controllerRelease,
}) {
  const candidateRepository = {
    owner: repository.owner,
    name: repository.name,
    id: repository.id,
    node_id: repository.node_id,
  };
  const normalizedRestBase = normalizeRestBase(restBaseUrl);
  const graphqlUrl = defaultControllerGraphqlUrl(normalizedRestBase);
  const currentOpen = createV2GitHubCurrentOpenCandidateInventory({
    fetch,
    token,
    repository: candidateRepository,
    graphqlUrl,
  });
  const transport = createV2GitHubCandidateInventory({
    fetch,
    token,
    repository: candidateRepository,
    restBaseUrl: normalizedRestBase,
  });
  const configurationDigest = gitLedgerDigestCanonical(
    "codex-review-gate-v2-candidate-refresh-adapter-v2-configuration",
    {
      repository: candidateRepository,
      rest_base_url: normalizedRestBase,
      graphql_url: graphqlUrl,
      current_open_query_sha256:
        rawDigest(V2_CURRENT_OPEN_PULL_REQUESTS_QUERY),
      current_open_max_candidates: MAX_V2_CURRENT_OPEN_CANDIDATES,
      current_open_max_pages: MAX_V2_CURRENT_OPEN_CANDIDATE_PAGES,
      legacy_finish_max_pages: MAX_V2_CANDIDATE_PAGES,
      legacy_finish_max_scan_passes: MAX_V2_CANDIDATE_SCAN_PASSES,
      timeout_ms: V2_CANDIDATE_HTTP_TIMEOUT_MS,
      controller_release_digest: gitLedgerDigestCanonical(
        "codex-review-gate-v2-candidate-refresh-controller-release",
        controllerRelease,
      ),
    },
  );
  return deepFreeze({
    schema: V2_GIT_LEDGER_CANDIDATE_REFRESH_ADAPTER_SCHEMA,
    schema_version: 2,
    configuration_digest: configurationDigest,
    async collectCurrentOpenCandidateAuthority() {
      const receipt = await currentOpen.scan();
      const projection = currentOpen.projectForGitLedger(receipt);
      return Object.freeze({
        projection,
        production_candidate_authority:
          currentOpen.projectProductionCandidateAuthority(projection),
      });
    },
    async finishLegacyCandidateInventoryAttempt(request) {
      return finishV2LegacyCandidateInventoryAttempt({
        request,
        transport,
        repository: candidateRepository,
      });
    },
  });
}

async function finishV2LegacyCandidateInventoryAttempt({
  request,
  transport,
  repository,
}) {
  assertObject(request, "legacy candidate inventory finish request");
  exactKeys(request, [
    "schema", "schema_version", "request_handle", "mode", "query_state",
    "repository", "source_binding", "cycle_id", "start_record_oid",
    "initial_inventory", "completed_shard_receipts", "next_shard_index",
  ], "legacy candidate inventory finish request");
  if (
    request.schema !== V2_CANDIDATE_LEGACY_FINISH_REQUEST_SCHEMA ||
    request.schema_version !== 1 ||
    request.mode !== "finish-existing" ||
    request.query_state !== "all" ||
    canonicalJson(request.repository) !== canonicalJson(repository)
  ) {
    throw controllerFailure(
      "CANDIDATE_LEGACY_FINISH_REQUEST_INVALID",
      "protected ledger requested an invalid legacy inventory continuation",
    );
  }
  assertObject(request.source_binding, "legacy finish source binding");
  assertObject(request.initial_inventory, "legacy finish initial inventory");
  if (
    typeof request.cycle_id !== "string" ||
    !SHA.test(request.start_record_oid) ||
    !Array.isArray(request.initial_inventory.shards) ||
    !Array.isArray(request.completed_shard_receipts) ||
    !Number.isSafeInteger(request.next_shard_index) ||
    request.next_shard_index < 0 ||
    request.next_shard_index !== request.completed_shard_receipts.length ||
    request.next_shard_index > request.initial_inventory.shards.length
  ) {
    throw controllerFailure(
      "CANDIDATE_LEGACY_FINISH_REQUEST_INVALID",
      "legacy inventory continuation differs from its durable shard prefix",
    );
  }
  const initialInventory = request.initial_inventory;
  const shardReceipts = structuredClone(request.completed_shard_receipts);
  for (
    let index = request.next_shard_index;
    index < initialInventory.shards.length;
    index += 1
  ) {
    shardReceipts.push(await transport.readShard({
      inventory: initialInventory,
      shard_index: index,
    }));
  }
  const finalInventory = await transport.scan({
    prior_inventory: initialInventory,
  });
  const finalShardReceipts = [];
  for (let index = 0; index < finalInventory.shards.length; index += 1) {
    finalShardReceipts.push(await transport.readShard({
      inventory: finalInventory,
      shard_index: index,
    }));
  }
  return deepFreeze({
    schema: V2_CANDIDATE_LEGACY_FINISH_RESULT_SCHEMA,
    schema_version: 1,
    request_handle: request.request_handle,
    cycle_id: request.cycle_id,
    start_record_oid: request.start_record_oid,
    next_shard_index: request.next_shard_index,
    initial_inventory: initialInventory,
    shard_receipts: shardReceipts,
    final_inventory: finalInventory,
    final_shard_receipts: finalShardReceipts,
  });
}

/**
 * Construct the production controller from trusted workflow inputs and live
 * GitHub receipts. This is intentionally not an injected `assemble` callback:
 * the CLI always reaches the real preflight constructor with global fetch.
 *
 * The live preflight and OIDC initialization are retained as same-process
 * branded handles and converted only through workflow-preflight's closed
 * Git-ledger handoff. Restricted bootstrap either seals a live capability and
 * returns the production ledger or fails before PR discovery and public
 * effects. The remaining controller path must never route through
 * executeV2ControllerCycle.
 */
export async function assembleV2ProductionControllerCycle({
  command,
  environment = process.env,
  fetch: fetchImpl = globalThis.fetch,
}) {
  const activation = await activateV2ProductionLedgerAuthority({
    command,
    environment,
    fetch: fetchImpl,
  });
  if (activation.state === "blocked") return activation.cycle;
  return assembleV2InitialProductionObservation({
    command,
    environment,
    fetch: fetchImpl,
    token: activation.token,
    rest_base_url: activation.rest_base_url,
    ledger: activation.ledger,
    preflight_handle: activation.preflight_handle,
    handoff: activation.handoff,
  });
}

/**
 * Complete the production preflight -> OIDC -> handoff -> bootstrap chain once
 * and retain every private authority in this process. Both the single-PR
 * controller and the schedule dispatcher use this exact activation boundary.
 */
async function activateV2ProductionLedgerAuthority({
  command,
  environment = process.env,
  fetch: fetchImpl = globalThis.fetch,
}) {
  if (typeof fetchImpl !== "function") {
    throw controllerFailure(
      "FETCH_UNAVAILABLE",
      "production workflow controller requires global fetch",
    );
  }
  const token = requiredEnv(environment, "GITHUB_TOKEN");
  const restBaseUrl = environment.GITHUB_API_URL === undefined
    ? "https://api.github.com"
    : requiredEnv(environment, "GITHUB_API_URL");
  let preflightHandle;
  try {
    preflightHandle = await createV2GitHubWorkflowPreflight({
      fetch: fetchImpl,
      token,
      repository: command.repository,
      restBaseUrl,
    }).load({ command });
  } catch (error) {
    throw controllerFailure(
      "PREFLIGHT_FAILED",
      "live GitHub workflow preflight did not produce a complete receipt",
      {
        upstream_code: typeof error?.code === "string" ? error.code : null,
      },
      error,
    );
  }
  let verifier;
  let verifierInitialization;
  try {
    verifier = createV2GitHubOidcProvenanceVerifier({
      fetch: fetchImpl,
      environment,
    });
    verifierInitialization = await verifier.initialize();
  } catch (error) {
    throw controllerFailure(
      "OIDC_INITIALIZATION_FAILED",
      "live GitHub OIDC discovery and JWKS initialization failed",
      {
        preflight_receipt_digest:
          typeof preflightHandle?.receipt_digest === "string"
            ? preflightHandle.receipt_digest
            : null,
        upstream_code: typeof error?.code === "string" ? error.code : null,
      },
      error,
    );
  }
  let handoff;
  try {
    handoff = assertV2WorkflowGitLedgerHandoffHandle(
      createV2WorkflowGitLedgerHandoff(preflightHandle, {
        verifier_initialization: verifierInitialization,
      }),
    );
  } catch (error) {
    throw controllerFailure(
      "LEDGER_HANDOFF_FAILED",
      "live preflight and OIDC trust could not form a protected-ledger handoff",
      {
        preflight_receipt_digest:
          typeof preflightHandle?.receipt_digest === "string"
            ? preflightHandle.receipt_digest
            : null,
        upstream_code: typeof error?.code === "string" ? error.code : null,
      },
      error,
    );
  }
  if (handoff.state === "blocked") {
    const reportableBlockers = new Set([
      "caller-workflow-incompatible",
      "required-ruleset-incompatible",
    ]);
    if (
      handoff.blockers.length > 0 &&
      handoff.blockers.every((blocker) => reportableBlockers.has(blocker))
    ) {
      let blocked;
      try {
        blocked = assertV2BlockedConfigurationWorkflowResultHandle(
          createV2BlockedConfigurationWorkflowResult({
            preflight_handle: preflightHandle,
            handoff_handle: handoff,
          }),
        );
        assertV2PublicReport(blocked.report);
        validateV2StatusWrites(blocked.status_plan, {
          head_ref_oid: null,
          status_target_mode: blocked.status_plan.mode,
          public_report: blocked.report,
        });
      } catch (error) {
        throw controllerFailure(
          "BLOCKED_CONFIGURATION_PROJECTION_FAILED",
          "trusted incompatible configuration could not form its zero-effect public result",
          {
            blockers: structuredClone(handoff.blockers),
            handoff_digest: handoff.handoff_digest,
            preflight_receipt_digest: handoff.preflight_receipt_digest,
            public_effects_performed: 0,
          },
          error,
        );
      }
      return deepFreeze({
        state: "blocked",
        cycle: {
          initial_result: null,
          bind_result: null,
          pre_sticky_result: null,
          terminal_result: blocked,
          request_capture: null,
          binding_receipt: null,
          sticky_receipt: null,
          status_receipts: [],
          ledger: null,
        },
      });
    }
    throw controllerFailure(
      "LEDGER_HANDOFF_BLOCKED",
      "live preflight and OIDC trust do not authorize protected-ledger bootstrap",
      {
        blockers: structuredClone(handoff.blockers),
        handoff_digest: handoff.handoff_digest,
        preflight_receipt_digest: handoff.preflight_receipt_digest,
      },
    );
  }
  if (handoff.state !== "bootstrap" && handoff.state !== "active") {
    throw controllerFailure(
      "LEDGER_HANDOFF_STATE_UNSUPPORTED",
      "protected-ledger handoff returned an unsupported state",
      { state: handoff.state, public_effects_performed: 0 },
    );
  }
  let candidateInventoryRefreshAdapter;
  try {
    const controllerRelease = handoff.state === "bootstrap"
      ? handoff.bootstrap_input?.controller_release
      : handoff.capability_receipt?.controller_release;
    assertObject(controllerRelease, "candidate refresh controller release");
    candidateInventoryRefreshAdapter =
      createV2CandidateInventoryRefreshAdapter({
        fetch: fetchImpl,
        token,
        repository: handoff.repository,
        rest_base_url: restBaseUrl,
        controller_release: controllerRelease,
      });
  } catch (error) {
    throw controllerFailure(
      "CANDIDATE_REFRESH_ADAPTER_INITIALIZATION_FAILED",
      "candidate inventory refresh adapter could not be constructed",
      {
        assembly_schema: V2_PRODUCTION_ASSEMBLY_SCHEMA,
        handoff_digest: handoff.handoff_digest,
        preflight_receipt_digest: handoff.preflight_receipt_digest,
        upstream_code: typeof error?.code === "string" ? error.code : null,
        public_effects_performed: 0,
      },
      error,
    );
  }
  let ledger;
  if (handoff.state === "bootstrap") {
    try {
      const activated = await createV2GitHubGitLedgerBootstrap({
        fetch: fetchImpl,
        token,
        repository: handoff.repository,
        ledgerRef: handoff.ledger_ref,
        restBaseUrl,
        bootstrapCapabilityInput: handoff.bootstrap_input,
        preflightHandle,
        verifyWorkflowProvenance: verifier.verifyWorkflowProvenance,
        candidateInventoryRefreshAdapter,
      }).bootstrapCapability();
      ledger = activated.ledger;
    } catch (error) {
      throw controllerFailure(
        "LEDGER_BOOTSTRAP_FAILED",
        "protected-ledger restricted bootstrap did not produce active authority",
        {
          assembly_schema: V2_PRODUCTION_ASSEMBLY_SCHEMA,
          handoff_digest: handoff.handoff_digest,
          preflight_receipt_digest: handoff.preflight_receipt_digest,
          upstream_code: typeof error?.code === "string" ? error.code : null,
          public_effects_performed: 0,
        },
        error,
      );
    }
  } else if (handoff.state === "active") {
    try {
      ledger = createV2GitHubGitLedger({
        fetch: fetchImpl,
        token,
        repository: handoff.repository,
        ledgerRef: handoff.ledger_ref,
        restBaseUrl,
        capabilityReceipt: handoff.capability_receipt,
        preflightHandle,
        verifyWorkflowProvenance: verifier.verifyWorkflowProvenance,
        candidateInventoryRefreshAdapter,
      });
    } catch (error) {
      throw controllerFailure(
        "LEDGER_ACTIVE_AUTHORITY_FAILED",
        "active protected-ledger authority could not be constructed",
        {
          assembly_schema: V2_PRODUCTION_ASSEMBLY_SCHEMA,
          handoff_digest: handoff.handoff_digest,
          preflight_receipt_digest: handoff.preflight_receipt_digest,
          upstream_code: typeof error?.code === "string" ? error.code : null,
          public_effects_performed: 0,
        },
        error,
      );
    }
  }
  if (typeof ledger?.load !== "function") {
    throw controllerFailure(
      "LEDGER_ACTIVE_AUTHORITY_INVALID",
      "protected-ledger activation did not return a production ledger",
      { public_effects_performed: 0 },
    );
  }
  return deepFreeze({
    state: "active",
    token,
    rest_base_url: restBaseUrl,
    ledger,
    preflight_handle: preflightHandle,
    handoff,
  });
}

export function assertV2InitialProductionLedgerApi(ledger) {
  for (const [name, callback] of [
    ["loadControlPlaneAuthority", ledger?.loadControlPlaneAuthority],
    ["loadInitialRunnerStateAuthority", ledger?.loadInitialRunnerStateAuthority],
    ["loadEstablishedRunnerStateAuthority",
      ledger?.loadEstablishedRunnerStateAuthority],
    ["appendInitialSchedulerObservation",
      ledger?.appendInitialSchedulerObservation],
    ["appendEstablishedSchedulerObservation",
      ledger?.appendEstablishedSchedulerObservation],
    ["loadNextStatusWriteIntent", ledger?.loadNextStatusWriteIntent],
  ]) {
    if (typeof callback !== "function") {
      throw controllerFailure(
        "INITIAL_RUNNER_AUTHORITY_REQUIRED",
        `production ledger requires ${name}`,
        { public_effects_performed: 0 },
      );
    }
  }
  return ledger;
}

async function assembleV2InitialProductionObservation({
  command,
  environment,
  fetch,
  token,
  rest_base_url: restBaseUrl,
  ledger,
  preflight_handle: preflightHandle,
  handoff,
}) {
  assertV2InitialProductionLedgerApi(ledger);
  const graphqlUrl = defaultControllerGraphqlUrl(
    normalizeRestBase(restBaseUrl),
  );
  const preScope = await loadV2MinimalLiveScope({
    fetch,
    token,
    repository: command.repository,
    pull_number: command.pull_request.number,
    rest_base_url: restBaseUrl,
    graphql_url: graphqlUrl,
  });
  const triggerIdentity = loadV2GitLedgerTriggerIdentity({
    command,
    environment,
  });
  let candidateDispatch = null;
  if (triggerIdentity.event_name === "schedule") {
    if (typeof ledger.loadCandidateDispatchForScheduledPullRequest !==
        "function") {
      throw controllerFailure(
        "SCHEDULED_CANDIDATE_DISPATCH_API_REQUIRED",
        "scheduled production run requires candidate dispatch rehydration",
        { public_effects_performed: 0 },
      );
    }
    candidateDispatch = await ledger
      .loadCandidateDispatchForScheduledPullRequest({
        workflow_command_handle: command,
        minimal_scope_handle: preScope,
        trigger_identity: triggerIdentity,
        expected_dispatch_binding: command.dispatch_binding,
      });
    assertObject(candidateDispatch, "scheduled candidate dispatch authority");
  }
  const preLease = await createV2PreLeaseEvaluatedScopeAuthority({
    command,
    environment,
    fetch,
    token,
    rest_base_url: restBaseUrl,
    ledger,
    preflight_handle: preflightHandle,
    pre_scope: preScope,
    ...(candidateDispatch === null
      ? {}
      : {
          candidate_dispatch_handle:
            candidateDispatch.candidate_dispatch_handle,
        }),
  });
  const discovery = await acquireV2LeaseThenLoadDiscovery({
    command,
    environment,
    fetch,
    token,
    rest_base_url: restBaseUrl,
    graphql_url: graphqlUrl,
    ledger,
    evaluated_scope_receipt: preLease.evaluated_scope_receipt,
    pre_scope: preScope,
  });
  const evaluatedScopeReceipt = discovery.effect_evaluated_scope_receipt;
  let publicEffectsPerformed = 0;
  let failurePhase = "runner-authority";
  let lastReachableReceiptDigest = discovery.lease_receipt.receipt_digest;
  let durableLeaseReleaseReceipt = null;
  assertObject(
    evaluatedScopeReceipt,
    "production full-discovery evaluated scope receipt",
  );
  try {
    const controlPlaneAuthority = await ledger.loadControlPlaneAuthority(
      evaluatedScopeReceipt.scope,
    );
    const controlPlaneReceipt =
      createV2ControlPlaneReceiptFromGitLedgerAuthority(controlPlaneAuthority);
    const establishedHistory =
      controlPlaneAuthority.scoped_authority?.runner_state?.scheduling !== null;
    const initialRunnerStateAuthority = establishedHistory
      ? null
      : await ledger.loadInitialRunnerStateAuthority({
          control_plane_authority: controlPlaneAuthority,
          evaluated_scope_receipt: evaluatedScopeReceipt,
          workflow_command_handle: command,
        });
    const establishedRunnerStateAuthority = establishedHistory
      ? await ledger.loadEstablishedRunnerStateAuthority({
          control_plane_authority: controlPlaneAuthority,
          evaluated_scope_receipt: evaluatedScopeReceipt,
          workflow_command_handle: command,
        })
      : null;
    const runnerAuthority = assertV2ProductionRunnerAuthorityHandle(
      createV2ProductionRunnerAuthority({
        preflight_handle: preflightHandle,
        control_plane_receipt: controlPlaneReceipt,
        initial_runner_state_authority: initialRunnerStateAuthority,
        established_runner_state_authority: establishedRunnerStateAuthority,
        expected_scope: controlPlaneReceipt.scope,
      }),
    );
    const runnerOperation = command.route.operation === "evaluate-only"
      ? "evaluate-only"
      : "prepare-request";
    const runnerInput = {
      schema: V2_RUNNER_SCHEMA,
      schema_version: V2_RUNNER_SCHEMA_VERSION,
      operation: runnerOperation,
      status_target_mode: runnerAuthority.scheduling.status_target_mode,
      status_context: V2_STATUS_CONTEXT,
      snapshot_request: {
        owner: command.repository.owner,
        repo: command.repository.name,
        pull_number: command.pull_request.number,
      },
      controller: runnerAuthority.projector_controller,
      public_report_authority: runnerAuthority.public_report_authority,
      scheduling: runnerAuthority.scheduling,
      head_ledger: runnerOperation === "evaluate-only"
        ? null
        : runnerAuthority.head_ledger,
      reservation: null,
      post_response: null,
    };
    const internalResult = await runV2Operation(runnerInput, {
      transport: createV2GitHubTransport({
        fetch,
        token,
        restBaseUrl,
        graphqlUrl,
      }),
      reduceSnapshot: reduceV2Snapshot,
    });
    const automaticRecoveryHandle =
      getV2AutomaticRequestRecoveryHandle(internalResult);
    const automaticRecoveryArtifactBindingCandidateHandle =
      getV2AutomaticRecoveryArtifactBindingCandidateHandle(internalResult);
    const schedulerAppend = establishedHistory
      ? await ledger.appendEstablishedSchedulerObservation({
          established_runner_state_authority: establishedRunnerStateAuthority,
          scheduler_evaluation: internalResult.scheduler_evaluation,
          status_plan: internalResult.status_plan,
        })
      : await ledger.appendInitialSchedulerObservation({
          initial_runner_state_authority: initialRunnerStateAuthority,
          scheduler_evaluation: internalResult.scheduler_evaluation,
          status_plan: internalResult.status_plan,
        });
    failurePhase = "scheduler-observation";
    lastReachableReceiptDigest = schedulerAppend.append_receipt.receipt_digest;
    const statusWriteCount = internalResult.status_plan.writes.length;
    const statusIntentAppends = [];
    const statusResponseAppends = [];
    const statusReceipts = [];
    let statusOutcome = statusWriteCount === 0 ? "not-required" : "bound";
    let ambiguityCode = null;
    if (statusWriteCount > 0) {
      const statusTransport = createV2GitHubProductionStatusTransport({
        fetch,
        token,
        restBaseUrl,
        repository: command.repository,
      });
      let lastStatusWriteIndex = -1;
      for (let turn = 0; turn <= statusWriteCount; turn += 1) {
        failurePhase = "status-intent";
        const statusIntentAppend = await ledger.loadNextStatusWriteIntent({
          scheduler_append: schedulerAppend,
        });
        if (statusIntentAppend === null) break;
        if (
          !Number.isSafeInteger(statusIntentAppend.status_write_index) ||
          statusIntentAppend.status_write_index < 0 ||
          statusIntentAppend.status_write_index >= statusWriteCount ||
          statusIntentAppend.status_write_count !== statusWriteCount ||
          statusIntentAppend.status_write_index <= lastStatusWriteIndex
        ) {
          throw controllerFailure(
            "STATUS_WRITE_SEQUENCE_INVALID",
            "the public ledger returned a non-canonical status write sequence",
            {
              planned_status_writes: statusWriteCount,
              public_effects_performed: publicEffectsPerformed,
            },
          );
        }
        lastStatusWriteIndex = statusIntentAppend.status_write_index;
        statusIntentAppends.push(statusIntentAppend);
        lastReachableReceiptDigest =
          statusIntentAppend.intent_append_receipt.receipt_digest;
        failurePhase = "status-post-refetch";
        publicEffectsPerformed += 1;
        let statusReceipt = null;
        try {
          statusReceipt = await statusTransport.performStatusWrite({
            status_intent_handle: statusIntentAppend.status_intent_handle,
          });
        } catch (error) {
          statusOutcome = "ambiguous";
          ambiguityCode = typeof error?.code === "string"
            ? error.code
            : "STATUS_EFFECT_AMBIGUOUS";
        }
        if (statusReceipt === null) {
          await requireV2ProductionLedgerTip({
            ledger,
            expected_tip_commit_sha:
              statusIntentAppend.intent_append_receipt.commit_sha,
            phase: "status-ambiguous",
          });
          break;
        }
        statusReceipts.push(statusReceipt);
        failurePhase = "status-response";
        const statusResponseAppend = await ledger.appendStatusWriteResponse({
          status_intent_handle: statusIntentAppend.status_intent_handle,
          intent_append_receipt: statusIntentAppend.intent_append_receipt,
          receipt: statusReceipt,
        });
        statusResponseAppends.push(statusResponseAppend);
        lastReachableReceiptDigest =
          statusResponseAppend.response_append_receipt.receipt_digest;
        await requireV2ProductionLedgerTip({
          ledger,
          expected_tip_commit_sha:
            statusResponseAppend.response_append_receipt.commit_sha,
          phase: "status-response",
        });
        if (turn === statusWriteCount) {
          throw controllerFailure(
            "STATUS_WRITE_SEQUENCE_OVERFLOW",
            "the public ledger did not terminate the bounded status transaction",
            {
              planned_status_writes: statusWriteCount,
              public_effects_performed: publicEffectsPerformed,
            },
          );
        }
      }
    }

    const schedulerActionKinds = internalResult.scheduler_plan.actions
      .map((action) => action.kind);
    const automaticRequestPlanned =
      schedulerActionKinds.includes("persist_auto_request_intent") ||
      schedulerActionKinds.includes("post_review_request");
    const automaticRequestState =
      runnerAuthority.scheduling.epoch.automatic_request.state;
    const recoveredAutomaticRequestPlanned =
      automaticRequestPlanned && automaticRequestState === "intent-persisted";
    if (
      recoveredAutomaticRequestPlanned &&
      (internalResult.reservation !== null ||
        internalResult.post_intent !== null ||
        schedulerActionKinds.filter((kind) =>
          kind === "post_review_request").length !== 1 ||
        schedulerActionKinds.includes("persist_auto_request_intent"))
    ) {
      throw controllerFailure(
        "RECOVERED_AUTOMATIC_REQUEST_PLAN_INVALID",
        "intent-persisted recovery must retain one post-only scheduler action",
        { public_effects_performed: publicEffectsPerformed },
      );
    }
    let automaticRecoveryTransition = null;
    let automaticRecoveryArtifactBindingResponse = null;
    if (
      automaticRecoveryHandle !== null &&
      statusOutcome !== "ambiguous"
    ) {
      if (typeof ledger.appendAutomaticRequestRecoveryTransition !==
          "function") {
        throw controllerFailure(
          "AUTOMATIC_RECOVERY_TRANSITION_API_REQUIRED",
          "proved automatic recovery requires the protected-ledger transition API",
          { public_effects_performed: publicEffectsPerformed },
        );
      }
      failurePhase = "automatic-recovery-transition";
      automaticRecoveryTransition =
        await ledger.appendAutomaticRequestRecoveryTransition({
          scheduler_append: schedulerAppend,
          recovery_handle: automaticRecoveryHandle,
        });
      assertObject(
        automaticRecoveryTransition,
        "automatic request recovery transition",
      );
      assertObject(
        automaticRecoveryTransition.response_record_receipt,
        "automatic request recovery response receipt",
      );
      lastReachableReceiptDigest =
        automaticRecoveryTransition.response_record_receipt.receipt_digest;
      await requireV2ProductionLedgerTip({
        ledger,
        expected_tip_commit_sha:
          automaticRecoveryTransition.response_record_receipt.commit_sha,
        phase: "automatic-recovery-transition",
      });
    } else if (
      automaticRecoveryArtifactBindingCandidateHandle !== null &&
      statusOutcome !== "ambiguous"
    ) {
      if (
        typeof ledger.loadOrAppendAutomaticRecoveryArtifactBindingIntent !==
          "function" ||
        typeof ledger.appendAutomaticRecoveryArtifactBindingResponse !==
          "function"
      ) {
        throw controllerFailure(
          "AUTOMATIC_RECOVERY_ARTIFACT_BINDING_API_REQUIRED",
          "proved automatic recovery evidence requires the protected-ledger artifact-binding APIs",
          { public_effects_performed: publicEffectsPerformed },
        );
      }
      for (let transactionOrdinal = 0; transactionOrdinal < 2;
        transactionOrdinal += 1) {
        failurePhase = "automatic-recovery-artifact-binding-intent";
        const artifactBindingIntent =
          await ledger.loadOrAppendAutomaticRecoveryArtifactBindingIntent({
            scheduler_append: schedulerAppend,
            artifact_binding_candidate_handle:
              automaticRecoveryArtifactBindingCandidateHandle,
          });
        if (artifactBindingIntent === null) break;
        assertObject(
          artifactBindingIntent.ready_confirmation_append_receipt,
          "automatic recovery artifact binding ready confirmation receipt",
        );
        assertObject(
          artifactBindingIntent.latest_append_receipt,
          "automatic recovery artifact binding latest append receipt",
        );
        lastReachableReceiptDigest =
          artifactBindingIntent.latest_append_receipt.receipt_digest;
        failurePhase = "automatic-recovery-artifact-binding-point-read";
        automaticRecoveryArtifactBindingResponse =
          await appendV2AutomaticRecoveryArtifactBindingToCompletion({
            ledger,
            artifact_binding_intent: artifactBindingIntent,
            fetch,
            token,
            rest_base_url: restBaseUrl,
          });
        lastReachableReceiptDigest =
          automaticRecoveryArtifactBindingResponse.response_append_receipt
            .receipt_digest;
        await requireV2ProductionLedgerTip({
          ledger,
          expected_tip_commit_sha:
            automaticRecoveryArtifactBindingResponse.response_append_receipt
              .commit_sha,
          phase: "automatic-recovery-artifact-binding-response",
        });
      }
    }
    let automaticReservationAppend = null;
    let reservationStatusIntentAppend = null;
    let reservationStatusResponseAppend = null;
    let reservationStatusReceipt = null;
    let reservationStatusOutcome = "not-required";
    let reservationStatusAmbiguityCode = null;
    let automaticRequestIntentAppend = null;
    let automaticRequestBindingAppend = null;
    let automaticRequestBindingReceipt = null;
    let automaticRequestOutcome = "not-required";
    let automaticRequestAmbiguityCode = null;
    let automaticRequestIntentSource = "none";
    const completeAutomaticRequestEffect = async () => {
        const requestTransport =
          createV2GitHubProductionAutomaticReviewRequestTransport({
            fetch,
            token,
            restBaseUrl,
            repository: command.repository,
            pull_number: command.pull_request.number,
          });
        failurePhase = "automatic-request-pre-scope";
        let bindingReceiptCandidate = null;
        try {
          const requestPreScope = assertV2MinimalLiveScopeHandle(
            await loadV2MinimalLiveScope({
              fetch,
              token,
              repository: command.repository,
              pull_number: command.pull_request.number,
              rest_base_url: restBaseUrl,
              graphql_url: graphqlUrl,
            }),
            {
              repository: command.repository,
              pull_number: command.pull_request.number,
            },
          );
          failurePhase = "automatic-request-post-refetch";
          publicEffectsPerformed += 1;
          const requestCapture =
            await requestTransport.performAutomaticReviewRequest({
              automatic_request_intent_handle:
                automaticRequestIntentAppend.automatic_request_intent_handle,
            });
          failurePhase = "automatic-request-post-scope";
          const requestPostScope = assertV2MinimalLiveScopeHandle(
            await loadV2MinimalLiveScope({
              fetch,
              token,
              repository: command.repository,
              pull_number: command.pull_request.number,
              rest_base_url: restBaseUrl,
              graphql_url: graphqlUrl,
            }),
            {
              repository: command.repository,
              pull_number: command.pull_request.number,
            },
          );
          bindingReceiptCandidate =
            createV2AutomaticReviewRequestBindingReceipt({
              capture: requestCapture,
              minimal_pre: requestPreScope,
              minimal_post: requestPostScope,
            });
        } catch (error) {
          automaticRequestOutcome = "ambiguous";
          automaticRequestAmbiguityCode = typeof error?.code === "string"
            ? error.code
            : "AUTOMATIC_REQUEST_EFFECT_AMBIGUOUS";
          automaticRequestBindingAppend = null;
          automaticRequestBindingReceipt = null;
          await requireV2ProductionLedgerTip({
            ledger,
            expected_tip_commit_sha:
              automaticRequestIntentAppend.intent_append_receipt.commit_sha,
            phase: "automatic-request-ambiguous",
          });
        }
        if (bindingReceiptCandidate !== null) {
          failurePhase = "automatic-request-binding";
          const bindingCompletion =
            await appendV2AutomaticRequestBindingToCompletion({
              ledger,
              automatic_request_intent_append: automaticRequestIntentAppend,
              receipt: bindingReceiptCandidate,
            });
          if (bindingCompletion.append === null) {
            automaticRequestOutcome = "ambiguous";
            automaticRequestAmbiguityCode =
              typeof bindingCompletion.error?.code === "string"
                ? bindingCompletion.error.code
                : "AUTOMATIC_REQUEST_EFFECT_AMBIGUOUS";
            await requireV2ProductionLedgerTip({
              ledger,
              expected_tip_commit_sha:
                automaticRequestIntentAppend.intent_append_receipt.commit_sha,
              phase: "automatic-request-ambiguous",
            });
          } else {
            automaticRequestBindingAppend = bindingCompletion.append;
            automaticRequestBindingReceipt = bindingReceiptCandidate;
            lastReachableReceiptDigest =
              automaticRequestBindingAppend
                .request_binding_response_append_receipt.receipt_digest;
            await requireV2ProductionLedgerTip({
              ledger,
              expected_tip_commit_sha:
                automaticRequestBindingAppend
                  .request_binding_response_append_receipt.commit_sha,
              phase: "automatic-request-binding",
            });
            automaticRequestOutcome = "bound";
          }
        }
    };
    if (
      automaticRequestPlanned && automaticRecoveryHandle === null &&
      automaticRecoveryArtifactBindingCandidateHandle === null &&
      statusOutcome !== "ambiguous"
    ) {
      if (recoveredAutomaticRequestPlanned) {
        if (typeof ledger.appendRecoveredAutomaticReviewRequestIntent !==
            "function") {
          throw controllerFailure(
            "RECOVERED_AUTOMATIC_REQUEST_API_REQUIRED",
            "intent-persisted recovery requires the protected-ledger recovery API",
            { public_effects_performed: publicEffectsPerformed },
          );
        }
        failurePhase = "automatic-request-recovered-intent";
        automaticRequestIntentAppend =
          await ledger.appendRecoveredAutomaticReviewRequestIntent({
            scheduler_append: schedulerAppend,
          });
        automaticRequestIntentSource = "recovered-reservation";
        lastReachableReceiptDigest =
          automaticRequestIntentAppend.intent_append_receipt.receipt_digest;
        await completeAutomaticRequestEffect();
      } else {
        failurePhase = "automatic-reservation";
        automaticReservationAppend =
          await ledger.appendAutomaticRequestReservation({
            scheduler_append: schedulerAppend,
          });
        lastReachableReceiptDigest =
          automaticReservationAppend.reservation_append_receipt.receipt_digest;

        failurePhase = "reservation-status-intent";
        reservationStatusIntentAppend =
          await ledger.appendReservationStatusWriteIntent({
            automatic_reservation_handle:
              automaticReservationAppend.automatic_reservation_handle,
            reservation_append_receipt:
              automaticReservationAppend.reservation_append_receipt,
          });
        lastReachableReceiptDigest =
          reservationStatusIntentAppend.intent_append_receipt.receipt_digest;
        const reservationStatusTransport =
          createV2GitHubProductionReservationStatusTransport({
            fetch,
            token,
            restBaseUrl,
            repository: command.repository,
          });
        failurePhase = "reservation-status-post-refetch";
        publicEffectsPerformed += 1;
        try {
          reservationStatusReceipt =
            await reservationStatusTransport.performReservationStatusWrite({
              reservation_status_intent_handle:
                reservationStatusIntentAppend.reservation_status_intent_handle,
            });
        } catch (error) {
          reservationStatusOutcome = "ambiguous";
          reservationStatusAmbiguityCode = typeof error?.code === "string"
            ? error.code
            : "RESERVATION_STATUS_EFFECT_AMBIGUOUS";
        }
        if (reservationStatusReceipt !== null) {
          failurePhase = "reservation-status-response";
          reservationStatusResponseAppend =
            await ledger.appendReservationStatusWriteResponse({
              reservation_status_intent_handle:
                reservationStatusIntentAppend.reservation_status_intent_handle,
              intent_append_receipt:
                reservationStatusIntentAppend.intent_append_receipt,
              receipt: reservationStatusReceipt,
            });
          lastReachableReceiptDigest =
            reservationStatusResponseAppend.response_append_receipt
              .receipt_digest;
          await requireV2ProductionLedgerTip({
            ledger,
            expected_tip_commit_sha:
              reservationStatusResponseAppend.response_append_receipt
                .commit_sha,
            phase: "reservation-status-response",
          });
          reservationStatusOutcome = "bound";
        } else {
          await requireV2ProductionLedgerTip({
            ledger,
            expected_tip_commit_sha:
              reservationStatusIntentAppend.intent_append_receipt.commit_sha,
            phase: "reservation-status-ambiguous",
          });
        }

        if (reservationStatusOutcome === "bound") {
          failurePhase = "automatic-request-intent";
          automaticRequestIntentAppend =
            await ledger.appendAutomaticReviewRequestIntent({
              automatic_reservation_handle:
                automaticReservationAppend.automatic_reservation_handle,
              reservation_append_receipt:
                automaticReservationAppend.reservation_append_receipt,
              reservation_status_response_append:
                reservationStatusResponseAppend,
            });
          automaticRequestIntentSource = "new-reservation";
          lastReachableReceiptDigest =
            automaticRequestIntentAppend.intent_append_receipt.receipt_digest;
          await completeAutomaticRequestEffect();
        }
      }
    }

    failurePhase = automaticRecoveryTransition !== null
      ? "automatic-recovery-transition-bound-release"
      : automaticRecoveryArtifactBindingResponse !== null
        ? "automatic-recovery-artifact-binding-bound-release"
      : automaticRequestOutcome === "bound"
      ? "automatic-request-bound-release"
      : automaticRequestOutcome === "ambiguous"
        ? "automatic-request-ambiguous-release"
        : reservationStatusOutcome === "ambiguous"
          ? "reservation-status-ambiguous-release"
          : statusOutcome === "bound"
            ? "status-bound-release"
            : statusOutcome === "ambiguous"
              ? "status-ambiguous-release"
              : "zero-status-release";
    const leaseReleaseReceipt = await releaseV2ProductionLease({
      ledger,
      discovery,
      phase: failurePhase,
      last_reachable_receipt_digest: lastReachableReceiptDigest,
      public_effects_performed: publicEffectsPerformed,
    });
    durableLeaseReleaseReceipt = leaseReleaseReceipt;
    const cycle = createV2ProductionInitialCycle({
      internal_result: internalResult,
      scheduler_append: schedulerAppend,
      status_intent_appends: statusIntentAppends,
      status_response_appends: statusResponseAppends,
      status_receipts: statusReceipts,
      status_outcome: statusOutcome,
      ambiguity_code: ambiguityCode,
      automatic_reservation_append: automaticReservationAppend,
      reservation_status_intent_append: reservationStatusIntentAppend,
      reservation_status_response_append: reservationStatusResponseAppend,
      reservation_status_receipt: reservationStatusReceipt,
      reservation_status_outcome: reservationStatusOutcome,
      reservation_status_ambiguity_code: reservationStatusAmbiguityCode,
      automatic_request_intent_append: automaticRequestIntentAppend,
      automatic_request_binding_append: automaticRequestBindingAppend,
      automatic_request_binding_receipt: automaticRequestBindingReceipt,
      automatic_request_outcome: automaticRequestOutcome,
      automatic_request_ambiguity_code: automaticRequestAmbiguityCode,
      automatic_request_intent_source: automaticRequestIntentSource,
      public_effects_performed: publicEffectsPerformed,
      lease_release_receipt: leaseReleaseReceipt,
      runner_authority: runnerAuthority,
      initial_runner_state_authority: initialRunnerStateAuthority,
      established_runner_state_authority: establishedRunnerStateAuthority,
      control_plane_receipt: controlPlaneReceipt,
      continuity_authority: discovery.continuity_authority,
      handoff,
    });
    if (candidateDispatch !== null) {
      try {
        for (const [name, callback] of [
          ["createCandidateDispatchResultAuthority",
            ledger.createCandidateDispatchResultAuthority],
          ["ackCandidateDispatch", ledger.ackCandidateDispatch],
        ]) {
          if (typeof callback !== "function") {
            throw new TypeError(
              `scheduled production ledger requires ${name}`,
            );
          }
        }
        const resultAuthority = await ledger
          .createCandidateDispatchResultAuthority({
            candidate_dispatch_handle:
              candidateDispatch.candidate_dispatch_handle,
            scheduler_append: schedulerAppend,
            production_runner_authority: runnerAuthority,
            lease_release_receipt: leaseReleaseReceipt,
            terminal_result: cycle.terminal_result,
          });
        assertObject(
          resultAuthority,
          "scheduled candidate dispatch result authority",
        );
        await ledger.ackCandidateDispatch({
          candidate_dispatch_handle:
            candidateDispatch.candidate_dispatch_handle,
          reservation_receipt: candidateDispatch.reservation_receipt,
          full_scope_receipt: evaluatedScopeReceipt,
          candidate_dispatch_result_handle:
            resultAuthority.candidate_dispatch_result_handle,
        });
      } catch (error) {
        try {
          await recoverV2ScheduledCandidateAfterRelease({
            command,
            environment,
            ledger,
            repository_endpoint_receipt:
              preflightHandle.repository_endpoint_receipt,
          });
        } catch (recoveryError) {
          throw controllerFailure(
            "CANDIDATE_DISPATCH_COMPLETION_FAILED",
            "scheduled candidate terminal result could not be durably acknowledged",
            {
              upstream_code: typeof error?.code === "string" ? error.code : null,
              recovery_code: typeof recoveryError?.code === "string"
                ? recoveryError.code
                : null,
              public_effects_performed: publicEffectsPerformed,
              budget_refunded: false,
              lease_released: true,
            },
            recoveryError,
          );
        }
      }
    }
    return cycle;
  } catch (error) {
    if (new Set([
      "PRODUCTION_LEASE_RELEASE_FAILED",
      "CANDIDATE_DISPATCH_COMPLETION_FAILED",
    ]).has(error?.code)) throw error;
    if (candidateDispatch !== null && durableLeaseReleaseReceipt !== null) {
      try {
        await recoverV2ScheduledCandidateAfterRelease({
          command,
          environment,
          ledger,
          repository_endpoint_receipt:
            preflightHandle.repository_endpoint_receipt,
        });
      } catch (recoveryError) {
        throw controllerFailure(
          "CANDIDATE_DISPATCH_POST_RELEASE_RECOVERY_FAILED",
          "scheduled candidate failure could not be durably recovered after lease release",
          {
            upstream_code: typeof error?.code === "string" ? error.code : null,
            recovery_code: typeof recoveryError?.code === "string"
              ? recoveryError.code
              : null,
            public_effects_performed: publicEffectsPerformed,
            budget_refunded: false,
            lease_released: true,
          },
          recoveryError,
        );
      }
      throw error;
    }
    return abortV2PostDiscoveryLease({
      ledger,
      discovery,
      error,
      phase: failurePhase,
      last_reachable_receipt_digest: lastReachableReceiptDigest,
      public_effects_performed: publicEffectsPerformed,
    });
  }
}

async function recoverV2ScheduledCandidateAfterRelease({
  command,
  environment,
  ledger,
  repository_endpoint_receipt: repositoryEndpointReceipt,
}) {
  if (typeof ledger?.recoverCandidateDispatchFailure !== "function") {
    throw new TypeError(
      "scheduled candidate recovery requires recoverCandidateDispatchFailure",
    );
  }
  return ledger.recoverCandidateDispatchFailure({
    workflow_command_handle: command,
    trigger_identity: loadV2GitLedgerTriggerIdentity({
      command,
      environment,
    }),
    repository_endpoint_receipt: repositoryEndpointReceipt,
    expected_dispatch_binding: command.dispatch_binding,
  });
}

export function createV2ProductionInitialCycle({
  internal_result: internalResult,
  scheduler_append: schedulerAppend,
  status_intent_appends: statusIntentAppends,
  status_response_appends: statusResponseAppends,
  status_receipts: statusReceipts,
  status_outcome: statusOutcome,
  ambiguity_code: ambiguityCode,
  automatic_reservation_append: automaticReservationAppend,
  reservation_status_intent_append: reservationStatusIntentAppend,
  reservation_status_response_append: reservationStatusResponseAppend,
  reservation_status_receipt: reservationStatusReceipt,
  reservation_status_outcome: reservationStatusOutcome,
  reservation_status_ambiguity_code: reservationStatusAmbiguityCode,
  automatic_request_intent_append: automaticRequestIntentAppend,
  automatic_request_binding_append: automaticRequestBindingAppend,
  automatic_request_binding_receipt: automaticRequestBindingReceipt,
  automatic_request_outcome: automaticRequestOutcome,
  automatic_request_ambiguity_code: automaticRequestAmbiguityCode,
  automatic_request_intent_source: automaticRequestIntentSource,
  public_effects_performed: publicEffectsPerformed,
  lease_release_receipt: leaseReleaseReceipt,
  runner_authority: runnerAuthority,
  initial_runner_state_authority: initialRunnerStateAuthority,
  established_runner_state_authority: establishedRunnerStateAuthority,
  control_plane_receipt: controlPlaneReceipt,
  continuity_authority: continuityAuthority,
  handoff,
}) {
  assertObject(internalResult, "initial internal runner result");
  assertObject(schedulerAppend, "initial scheduler append");
  assertObject(schedulerAppend.append_receipt, "initial scheduler append receipt");
  assertObject(leaseReleaseReceipt, "production lease release receipt");
  if ((initialRunnerStateAuthority === null) ===
      (establishedRunnerStateAuthority === null)) {
    throw new TypeError(
      "zero-effect result requires exactly one runner-state authority",
    );
  }
  const report = assertV2PublicReport(internalResult.report);
  const dueAt = internalResult.scheduler_plan?.due_at ?? null;
  if (dueAt !== null) timestamp(dueAt, "initial scheduler due_at");
  const wakeupHints = projectV2WorkflowWakeupHint(
    internalResult,
    runnerAuthority.scheduling,
  );
  const continuityReceipt = continuityAuthority.continuity_receipt;
  if (
    !Array.isArray(statusIntentAppends) ||
    !Array.isArray(statusResponseAppends) ||
    !Array.isArray(statusReceipts)
  ) {
    throw new TypeError("production status transaction evidence must be arrays");
  }
  const statusIntentAppend = statusIntentAppends.at(-1) ?? null;
  const statusResponseAppend =
    statusResponseAppends.length === statusIntentAppends.length
      ? statusResponseAppends.at(-1) ?? null
      : null;
  const requiredStatusEffects = statusIntentAppends.length;
  const plannedStatusEffects = internalResult.status_plan.writes.length;
  const reservationStatusEffects = reservationStatusIntentAppend === null
    ? 0
    : 1;
  const minimumRequestEffects =
    requiredStatusEffects + reservationStatusEffects;
  if (!new Set([
    "none",
    "new-reservation",
    "recovered-reservation",
  ]).has(automaticRequestIntentSource)) {
    throw new TypeError("production automatic request intent source is closed");
  }
  if (
    !new Set(["not-required", "bound", "ambiguous"]).has(statusOutcome) ||
    (statusOutcome === "not-required" &&
      (plannedStatusEffects !== 0 || requiredStatusEffects !== 0 ||
        statusResponseAppends.length !== 0 || statusReceipts.length !== 0)) ||
    (statusOutcome === "bound" &&
      (plannedStatusEffects === 0 ||
        statusResponseAppends.length !== requiredStatusEffects ||
        statusReceipts.length !== requiredStatusEffects)) ||
    (statusOutcome === "ambiguous" &&
      (requiredStatusEffects === 0 ||
        statusResponseAppends.length !== requiredStatusEffects - 1 ||
        statusReceipts.length !== requiredStatusEffects - 1 ||
        publicEffectsPerformed !== requiredStatusEffects))
  ) {
    throw new TypeError("production status outcome is internally inconsistent");
  }
  if (
    !new Set(["not-required", "bound", "ambiguous"])
      .has(reservationStatusOutcome) ||
    (reservationStatusOutcome === "not-required" &&
      (automaticReservationAppend !== null ||
        reservationStatusIntentAppend !== null ||
        reservationStatusResponseAppend !== null ||
        reservationStatusReceipt !== null)) ||
    (reservationStatusOutcome === "bound" &&
      (automaticReservationAppend === null ||
        reservationStatusIntentAppend === null ||
        reservationStatusResponseAppend === null ||
        reservationStatusReceipt === null)) ||
    (reservationStatusOutcome === "ambiguous" &&
      (automaticReservationAppend === null ||
        reservationStatusIntentAppend === null ||
        reservationStatusResponseAppend !== null ||
        reservationStatusReceipt !== null ||
        publicEffectsPerformed !== minimumRequestEffects))
  ) {
    throw new TypeError(
      "production reservation status outcome is internally inconsistent",
    );
  }
  if (
    !new Set(["not-required", "bound", "ambiguous"])
      .has(automaticRequestOutcome) ||
    (automaticRequestOutcome === "not-required" &&
      (automaticRequestIntentSource !== "none" ||
        automaticRequestIntentAppend !== null ||
        automaticRequestBindingAppend !== null ||
        automaticRequestBindingReceipt !== null)) ||
    (automaticRequestOutcome === "bound" &&
      (automaticRequestIntentSource === "none" ||
        automaticRequestIntentAppend === null ||
        automaticRequestBindingAppend === null ||
        automaticRequestBindingReceipt === null ||
        publicEffectsPerformed !== minimumRequestEffects + 1 ||
        (automaticRequestIntentSource === "new-reservation" &&
          reservationStatusOutcome !== "bound") ||
        (automaticRequestIntentSource === "recovered-reservation" &&
          reservationStatusOutcome !== "not-required"))) ||
    (automaticRequestOutcome === "ambiguous" &&
      (automaticRequestIntentSource === "none" ||
        automaticRequestIntentAppend === null ||
        automaticRequestBindingAppend !== null ||
        automaticRequestBindingReceipt !== null ||
        (automaticRequestIntentSource === "new-reservation" &&
          reservationStatusOutcome !== "bound") ||
        (automaticRequestIntentSource === "recovered-reservation" &&
          reservationStatusOutcome !== "not-required") ||
        !new Set([minimumRequestEffects, minimumRequestEffects + 1])
          .has(publicEffectsPerformed)))
  ) {
    throw new TypeError(
      "production automatic request outcome is internally inconsistent",
    );
  }
  if (publicEffectsPerformed < 0 || publicEffectsPerformed > 4) {
    throw new TypeError("production public effect count is out of range");
  }
  const effectBarrier = automaticRequestOutcome === "bound"
    ? "AUTOMATIC_REQUEST_EFFECT_BOUND"
    : automaticRequestOutcome === "ambiguous"
      ? "AUTOMATIC_REQUEST_EFFECT_AMBIGUOUS_CONSUMED"
      : reservationStatusOutcome === "ambiguous"
        ? "RESERVATION_STATUS_EFFECT_AMBIGUOUS_CONSUMED"
        : {
            "not-required": "NO_STATUS_EFFECT_REQUIRED",
            bound: "STATUS_EFFECT_BOUND",
            ambiguous: "STATUS_EFFECT_AMBIGUOUS_CONSUMED",
          }[statusOutcome];
  const terminalResult = deepFreeze({
    schema: V2_PRODUCTION_ASSEMBLY_SCHEMA,
    schema_version: 1,
    decision: boundedString(internalResult.decision, "initial decision", 64),
    report,
    due_at: dueAt,
    wakeup_hints: wakeupHints,
    status_plan: null,
    request_plan: null,
    comment_plan: null,
    writes_performed: publicEffectsPerformed > 0,
    public_effects_performed: publicEffectsPerformed,
    effect_barrier: effectBarrier,
    status_effect_outcome: statusOutcome,
    status_ambiguity_code: ambiguityCode,
    status_intent_digest:
      statusIntentAppend?.status_intent_handle.intent_digest ?? null,
    status_response_runner_state_digest:
      statusResponseAppend?.runner_state_digest ?? null,
    reservation_status_effect_outcome: reservationStatusOutcome,
    reservation_status_ambiguity_code: reservationStatusAmbiguityCode,
    automatic_reservation_digest:
      automaticReservationAppend?.reservation?.reservation_digest ??
        automaticRequestIntentAppend?.transport?.reservation_digest ?? null,
    reservation_status_intent_digest:
      reservationStatusIntentAppend?.reservation_status_intent_handle
        .intent_digest ?? null,
    reservation_status_response_runner_state_digest:
      reservationStatusResponseAppend?.runner_state_digest ?? null,
    automatic_request_effect_outcome: automaticRequestOutcome,
    automatic_request_ambiguity_code: automaticRequestAmbiguityCode,
    automatic_request_intent_digest:
      automaticRequestIntentAppend?.automatic_request_intent_handle
        .intent_digest ?? null,
    automatic_request_binding_runner_state_digest:
      automaticRequestBindingAppend?.runner_state_digest ?? null,
    authoritative_controlled_request:
      automaticRequestBindingAppend?.authoritative_controlled_request ?? null,
    scheduler_append_receipt:
      structuredClone(schedulerAppend.append_receipt),
    lease_release_receipt: structuredClone(leaseReleaseReceipt),
    preflight_receipt_digest: handoff.preflight_receipt_digest,
    handoff_digest: handoff.handoff_digest,
    continuity_receipt_digest:
      continuityReceipt.continuity_receipt_digest,
    control_plane_receipt_digest: controlPlaneReceipt.receipt_digest,
    initial_runner_state_authority_digest:
      initialRunnerStateAuthority?.authority_digest ?? null,
    established_runner_state_authority_digest:
      establishedRunnerStateAuthority?.authority_digest ?? null,
    runner_authority_digest: runnerAuthority.authority_digest,
  });
  assertNoCompactReducerReport(terminalResult, "initial zero-effect result");
  return deepFreeze({
    initial_result: null,
    bind_result: null,
    pre_sticky_result: null,
    terminal_result: terminalResult,
    request_capture: null,
    binding_receipt: automaticRequestBindingReceipt === null
      ? null
      : structuredClone(automaticRequestBindingReceipt),
    sticky_receipt: null,
    status_receipts: statusReceipts.map((receipt) =>
      structuredClone(receipt)),
    ledger: deepFreeze({
      scheduler_append_receipt:
        structuredClone(schedulerAppend.append_receipt),
      status_intent_append_receipt:
        statusIntentAppend === null
          ? null
          : structuredClone(statusIntentAppend.intent_append_receipt),
      status_response_append_receipt:
        statusResponseAppend === null
          ? null
          : structuredClone(statusResponseAppend.response_append_receipt),
      automatic_reservation_append_receipt:
        automaticReservationAppend === null
          ? null
          : structuredClone(
              automaticReservationAppend.reservation_append_receipt,
            ),
      reservation_status_intent_append_receipt:
        reservationStatusIntentAppend === null
          ? null
          : structuredClone(
              reservationStatusIntentAppend.intent_append_receipt,
            ),
      reservation_status_response_append_receipt:
        reservationStatusResponseAppend === null
          ? null
          : structuredClone(
              reservationStatusResponseAppend.response_append_receipt,
            ),
      automatic_request_attempt_append_receipt:
        automaticRequestIntentAppend === null
          ? null
          : structuredClone(
              automaticRequestIntentAppend.attempt_append_receipt,
            ),
      automatic_request_intent_append_receipt:
        automaticRequestIntentAppend === null
          ? null
          : structuredClone(
              automaticRequestIntentAppend.intent_append_receipt,
            ),
      automatic_request_review_response_append_receipt:
        automaticRequestBindingAppend === null
          ? null
          : structuredClone(
              automaticRequestBindingAppend.review_response_append_receipt,
            ),
      automatic_request_binding_intent_append_receipt:
        automaticRequestBindingAppend === null
          ? null
          : structuredClone(
              automaticRequestBindingAppend
                .request_binding_intent_append_receipt,
            ),
      automatic_request_binding_response_append_receipt:
        automaticRequestBindingAppend === null
          ? null
          : structuredClone(
              automaticRequestBindingAppend
                .request_binding_response_append_receipt,
            ),
      lease_release_receipt: structuredClone(leaseReleaseReceipt),
    }),
  });
}

async function appendV2AutomaticRequestBindingToCompletion({
  ledger,
  automatic_request_intent_append: automaticRequestIntentAppend,
  receipt,
}) {
  const intentTip = automaticRequestIntentAppend.intent_append_receipt
    .commit_sha;
  const retryableInternalAppendCodes = new Set([
    "http-body-failed",
    "http-request-failed",
    "http-response-cap",
    "http-timeout",
    "invalid-http-response",
    "unexpected-http-status",
  ]);
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return {
        append: await ledger.appendAutomaticReviewRequestBinding({
          automatic_request_intent_handle:
            automaticRequestIntentAppend.automatic_request_intent_handle,
          intent_append_receipt:
            automaticRequestIntentAppend.intent_append_receipt,
          receipt,
        }),
        error: null,
      };
    } catch (error) {
      lastError = error;
      // The high-level ledger API validates the complete closed receipt before
      // its first append, remembers exact partial progress by handle+receipt,
      // and never performs the public POST. Retrying only this internal call is
      // therefore required continuation, not a forbidden public-effect retry.
      const current = await ledger.load();
      if (
        current.tip_commit_sha === intentTip &&
        !retryableInternalAppendCodes.has(error?.code)
      ) {
        return { append: null, error };
      }
    }
  }
  throw controllerFailure(
    "AUTOMATIC_REQUEST_BINDING_INCOMPLETE",
    "automatic request binding did not finish its bounded internal continuation",
    { public_effect_retry_performed: false },
    lastError,
  );
}

async function appendV2AutomaticRecoveryArtifactBindingToCompletion({
  ledger,
  artifact_binding_intent: artifactBindingIntent,
  fetch,
  token,
  rest_base_url: restBaseUrl,
}) {
  assertObject(
    artifactBindingIntent,
    "automatic recovery artifact binding intent",
  );
  assertObject(
    artifactBindingIntent.transport,
    "automatic recovery artifact binding transport",
  );
  const transport = artifactBindingIntent.transport;
  if (
    transport.operation !== "loadV2ProviderPreScopeArtifacts" ||
    transport.retry_policy !== "safe-idempotent" ||
    !Number.isSafeInteger(transport.expected_count) ||
    transport.expected_count < 1 ||
    !Array.isArray(transport.requests) ||
    transport.requests.length !== transport.expected_count
  ) {
    throw controllerFailure(
      "AUTOMATIC_RECOVERY_ARTIFACT_BINDING_TRANSPORT_INVALID",
      "protected-ledger artifact binding did not return one exact safe GET batch",
    );
  }
  let lastTooEarlyError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const providerArtifactHandles = [];
    for (const request of transport.requests) {
      providerArtifactHandles.push(await loadV2ProviderPreScopeArtifact({
        fetch,
        token,
        restBaseUrl,
        ...request,
      }));
    }
    try {
      return await ledger.appendAutomaticRecoveryArtifactBindingResponse({
        artifact_binding_intent_handle:
          artifactBindingIntent.artifact_binding_intent_handle,
        intent_append_receipt: artifactBindingIntent.intent_append_receipt,
        provider_artifact_handles: providerArtifactHandles,
      });
    } catch (error) {
      if (error?.code !==
          "automatic-artifact-binding-point-read-too-early") {
        throw error;
      }
      lastTooEarlyError = error;
    }
  }
  throw lastTooEarlyError;
}

async function requireV2ProductionLedgerTip({
  ledger,
  expected_tip_commit_sha: expectedTipCommitSha,
  phase,
}) {
  const current = await ledger.load();
  if (current.tip_commit_sha !== expectedTipCommitSha) {
    throw controllerFailure(
      "PRODUCTION_LEDGER_REACHABILITY_MISMATCH",
      `${phase} is absent from the exact fresh protected-ledger tip`,
      {
        expected_tip_commit_sha: expectedTipCommitSha,
        observed_tip_commit_sha: current.tip_commit_sha,
      },
    );
  }
  return current;
}

async function releaseV2ProductionLease({
  ledger,
  discovery,
  phase,
  last_reachable_receipt_digest: lastReachableReceiptDigest,
  public_effects_performed: publicEffectsPerformed,
}) {
  const authority = {
    evaluated_scope_receipt: discovery.lease_evaluated_scope_receipt,
  };
  try {
    const current = await ledger.load();
    const releaseReceipt = await ledger.releaseLease({
      predecessor_commit_sha: sha(
        current.tip_commit_sha,
        "production release protected ledger tip_commit_sha",
      ),
      lease_receipt: discovery.lease_receipt,
      released_at: timestamp(
        current.post_ref?.server_time ?? current.observed_at,
        "production release protected ledger server time",
      ),
      control_comment_binding: current.control_comment_binding ?? null,
    }, authority);
    const confirmed = await ledger.load();
    if (confirmed.active_lease !== null) {
      throw new Error("protected ledger still reports an active lease after release");
    }
    return releaseReceipt;
  } catch (error) {
    throw controllerFailure(
      "PRODUCTION_LEASE_RELEASE_FAILED",
      "production observation could not close its lease without refund",
      {
        phase,
        last_reachable_receipt_digest: lastReachableReceiptDigest,
        budget_refunded: false,
        public_effects_performed: publicEffectsPerformed,
      },
      error,
    );
  }
}

async function abortV2PostDiscoveryLease({
  ledger,
  discovery,
  error,
  phase,
  last_reachable_receipt_digest: lastReachableReceiptDigest,
  public_effects_performed: publicEffectsPerformed,
}) {
  try {
    const releaseReceipt = await releaseV2ProductionLease({
      ledger,
      discovery,
      phase: `abort:${phase}`,
      last_reachable_receipt_digest: lastReachableReceiptDigest,
      public_effects_performed: publicEffectsPerformed,
    });
    throw controllerFailure(
      "INITIAL_OBSERVATION_ABORTED",
      "initial production observation failed and released its lease without refund",
      {
        upstream_code: typeof error?.code === "string" ? error.code : null,
        release_receipt_digest:
          typeof releaseReceipt?.receipt_digest === "string"
            ? releaseReceipt.receipt_digest
            : null,
        budget_refunded: false,
        public_effects_performed: publicEffectsPerformed,
      },
      error,
    );
  } catch (releaseError) {
    if (releaseError?.code === "INITIAL_OBSERVATION_ABORTED") {
      throw releaseError;
    }
    if (releaseError?.code === "PRODUCTION_LEASE_RELEASE_FAILED") {
      throw releaseError;
    }
    throw releaseError;
  }
}

/**
 * Legacy serialized-receipt validator retained only for compatibility tests.
 * It deliberately cannot recover the live loader's private brand and is never
 * called by production assembly. Production authority flows exclusively
 * through createV2WorkflowGitLedgerHandoff(preflightHandle, ...).
 */
export function validateV2ProductionPreflightBoundary(value, command) {
  assertObject(value, "workflow preflight receipt");
  exactKeys(value, [
    "schema", "schema_version", "repository", "repository_endpoint_receipt",
    "workflow", "ruleset", "app", "identity_evidence", "public_wait",
    "ledger_branch", "server_enforcement", "git_ledger_capability_input",
    "configuration_digest", "stability", "endpoint_receipts", "receipt_digest",
  ], "workflow preflight receipt");
  if (
    value.schema !== V2_WORKFLOW_PREFLIGHT_SCHEMA ||
    value.schema_version !== V2_WORKFLOW_PREFLIGHT_SCHEMA_VERSION
  ) {
    throw new TypeError("workflow preflight receipt schema is unsupported");
  }
  assertObject(command, "workflow preflight command");
  const selectedRepository = normalizeRepository(command.repository);
  const repository = validateV2PreflightRepository(
    value.repository,
    selectedRepository,
  );
  const repositoryEndpointReceipt = validateV2PreflightEndpointReceipt(
    value.repository_endpoint_receipt,
    "workflow preflight repository_endpoint_receipt",
  );
  const expectedRepositoryPath = `/repos/${encodeURIComponent(repository.owner)}/` +
    encodeURIComponent(repository.name);
  if (
    repositoryEndpointReceipt.method !== "GET" ||
    repositoryEndpointReceipt.path !== expectedRepositoryPath ||
    repositoryEndpointReceipt.status !== 200
  ) {
    throw new TypeError("workflow preflight repository endpoint receipt is not exact");
  }
  if (!Array.isArray(value.endpoint_receipts) ||
      value.endpoint_receipts.length === 0 || value.endpoint_receipts.length > 64) {
    throw new TypeError("workflow preflight endpoint receipts must be a bounded inventory");
  }
  const endpointReceipts = value.endpoint_receipts.map((receipt, index) =>
    validateV2PreflightEndpointReceipt(
      receipt,
      `workflow preflight endpoint_receipts[${index}]`,
    ));
  for (let index = 1; index < endpointReceipts.length; index += 1) {
    if (Date.parse(endpointReceipts[index].server_time) <
        Date.parse(endpointReceipts[index - 1].server_time)) {
      throw new TypeError("workflow preflight endpoint server time regressed");
    }
  }
  if (canonicalJson(endpointReceipts[0]) !== canonicalJson(repositoryEndpointReceipt)) {
    throw new TypeError("workflow preflight repository receipt is not the first live endpoint");
  }
  for (const key of [
    "workflow", "ruleset", "app", "identity_evidence", "public_wait",
    "ledger_branch", "server_enforcement",
  ]) {
    assertObject(value[key], `workflow preflight ${key}`);
  }
  digest(value.configuration_digest, "workflow preflight configuration_digest");
  const configurationProjection = {
    repository: value.repository,
    repository_endpoint_receipt: value.repository_endpoint_receipt,
    workflow: value.workflow,
    ruleset: value.ruleset,
    app: value.app,
    identity_evidence: value.identity_evidence,
    public_wait: value.public_wait,
    ledger_branch: value.ledger_branch,
    server_enforcement: value.server_enforcement,
  };
  if (value.configuration_digest !== gitLedgerDigestCanonical(
    "codex-review-gate-v2-workflow-preflight-configuration",
    configurationProjection,
  )) {
    throw new TypeError("workflow preflight configuration digest is invalid");
  }
  assertObject(value.stability, "workflow preflight stability");
  exactKeys(value.stability, [
    "assurance", "final_preflight_reread_required",
    "final_preflight_reread_must_match_configuration_digest",
    "configuration_digest", "production_effects_authorized",
  ], "workflow preflight stability");
  if (
    value.stability.assurance !== "one-complete-capped-preflight-read" ||
    value.stability.final_preflight_reread_required !== true ||
    value.stability.final_preflight_reread_must_match_configuration_digest !== true ||
    value.stability.configuration_digest !== value.configuration_digest ||
    value.stability.production_effects_authorized !== false
  ) {
    throw new TypeError("workflow preflight stability boundary is invalid");
  }
  const capability = validateV2UnsealedCapabilityInput({
    value: value.git_ledger_capability_input,
    repository,
    repositoryEndpointReceipt,
    endpointReceipts,
    identityEvidence: value.identity_evidence,
    command,
  });
  digest(value.receipt_digest, "workflow preflight receipt_digest");
  const { receipt_digest: _receiptDigest, ...withoutReceiptDigest } = value;
  if (value.receipt_digest !== gitLedgerDigestCanonical(
    "codex-review-gate-v2-workflow-preflight",
    withoutReceiptDigest,
  )) {
    throw new TypeError("workflow preflight receipt digest is invalid");
  }
  return deepFreeze({
    ...structuredClone(value),
    git_ledger_capability_input: capability,
  });
}

function validateV2PreflightRepository(value, expected) {
  assertObject(value, "workflow preflight repository");
  exactKeys(value, [
    "owner", "name", "id", "node_id", "owner_id", "visibility",
    "default_branch", "authenticated_permissions",
  ], "workflow preflight repository");
  if (value.owner !== expected.owner || value.name !== expected.name) {
    throw new TypeError("workflow preflight repository differs from the command");
  }
  positiveDecimalString(value.id, "workflow preflight repository.id");
  positiveDecimalString(value.owner_id, "workflow preflight repository.owner_id");
  boundedString(value.node_id, "workflow preflight repository.node_id", 256);
  enumValue(
    value.visibility,
    new Set(["public", "private"]),
    "workflow preflight repository.visibility",
  );
  boundedString(value.default_branch, "workflow preflight repository.default_branch", 255);
  assertObject(
    value.authenticated_permissions,
    "workflow preflight repository.authenticated_permissions",
  );
  exactKeys(value.authenticated_permissions, [
    "admin", "maintain", "push", "triage", "pull",
  ], "workflow preflight repository.authenticated_permissions");
  for (const permission of Object.values(value.authenticated_permissions)) {
    strictBoolean(permission, "workflow preflight repository permission");
  }
  return value;
}

function validateV2PreflightEndpointReceipt(value, label) {
  assertObject(value, label);
  exactKeys(value, [
    "method", "path", "status", "server_time", "raw_body_sha256",
  ], label);
  if (
    value.method !== "GET" || typeof value.path !== "string" ||
    value.path.length === 0 || value.path.length > 4096 ||
    !value.path.startsWith("/") || /[\r\n]/u.test(value.path) ||
    !new Set([200, 404]).has(value.status)
  ) {
    throw new TypeError(`${label} is not a closed read-only GitHub endpoint receipt`);
  }
  timestamp(value.server_time, `${label}.server_time`);
  digest(value.raw_body_sha256, `${label}.raw_body_sha256`);
  return value;
}

function validateV2UnsealedCapabilityInput({
  value,
  repository,
  repositoryEndpointReceipt,
  endpointReceipts,
  identityEvidence,
  command,
}) {
  assertObject(value, "workflow preflight git_ledger_capability_input");
  exactKeys(value, [
    "sealed", "capability_ready", "blockers", "repository",
    "repository_endpoint_receipt", "ledger_ref", "expected_creator",
    "actor_assurance", "permissions", "protection", "controller_release",
    "observed_at",
  ], "workflow preflight git_ledger_capability_input");
  if (value.sealed !== false || typeof value.capability_ready !== "boolean") {
    throw new TypeError("workflow preflight capability must remain explicitly unsealed");
  }
  if (!Array.isArray(value.blockers) || value.blockers.length > 32) {
    throw new TypeError("workflow preflight capability blockers are not bounded");
  }
  const blockers = value.blockers.map((blocker, index) =>
    boundedString(blocker, `workflow preflight capability blocker[${index}]`, 128));
  if (new Set(blockers).size !== blockers.length ||
      value.capability_ready !== (blockers.length === 0)) {
    throw new TypeError("workflow preflight capability readiness is inconsistent");
  }
  if (
    canonicalJson(value.repository) !== canonicalJson({
      owner: repository.owner,
      name: repository.name,
      id: repository.id,
      node_id: repository.node_id,
      owner_id: repository.owner_id,
    }) ||
    canonicalJson(value.repository_endpoint_receipt) !==
      canonicalJson(repositoryEndpointReceipt) ||
    value.ledger_ref !== V2_WORKFLOW_PREFLIGHT_LEDGER_REF ||
    value.expected_creator !== null ||
    value.observed_at !== endpointReceipts.at(-1).server_time
  ) {
    throw new TypeError("workflow preflight capability identity boundary is inconsistent");
  }
  assertObject(value.actor_assurance, "workflow preflight actor_assurance");
  exactKeys(value.actor_assurance, [
    "assurance", "proves_current_token_identity", "oidc_provenance_required",
    "oidc_provenance", "oidc_binding_requirements", "triggering_actor_id_claim",
    "app_catalog",
  ], "workflow preflight actor_assurance");
  if (canonicalJson(value.actor_assurance) !== canonicalJson(identityEvidence)) {
    throw new TypeError("workflow preflight capability actor assurance was not preserved");
  }
  const oidc = value.actor_assurance.oidc_binding_requirements;
  assertObject(oidc, "workflow preflight OIDC binding requirements");
  exactKeys(oidc, [
    "issuer", "audience", "repository_id", "repository", "workflow_ref",
    "workflow_sha", "job_workflow_ref", "job_workflow_sha", "run_id",
    "run_attempt", "event_name", "ref", "repository_id_source", "ref_source",
  ], "workflow preflight OIDC binding requirements");
  if (
    value.actor_assurance.proves_current_token_identity !== false ||
    value.actor_assurance.oidc_provenance_required !== true ||
    value.actor_assurance.oidc_provenance !== null ||
    oidc.issuer !== V2_WORKFLOW_PREFLIGHT_OIDC_ISSUER ||
    oidc.audience !== V2_GIT_LEDGER_OIDC_AUDIENCE ||
    oidc.repository_id !== repository.id ||
    oidc.repository !== command.workflow_receipt.caller_repository ||
    oidc.workflow_ref !== command.workflow_receipt.caller_workflow_ref ||
    oidc.workflow_sha !== command.workflow_receipt.caller_workflow_sha ||
    oidc.job_workflow_sha !== command.workflow_receipt.checkout_sha ||
    oidc.job_workflow_ref !==
      "Joey-Tools/codex-review-gate-action/.github/workflows/" +
        `codex-review-gate.yml@${command.workflow_receipt.revision}` ||
    oidc.run_id !== command.invocation.run_id ||
    oidc.run_attempt !== command.invocation.run_attempt ||
    oidc.event_name !== command.invocation.event_name ||
    oidc.ref !== null ||
    oidc.repository_id_source !== "live-repository-receipt" ||
    oidc.ref_source !== "trusted-job-context-required"
  ) {
    throw new TypeError("workflow preflight capability OIDC handoff is not closed");
  }
  if (value.actor_assurance.triggering_actor_id_claim !==
      command.invocation.actor_id) {
    throw new TypeError("workflow preflight capability actor claim differs from the command");
  }
  assertObject(value.permissions, "workflow preflight capability permissions");
  exactKeys(value.permissions, [
    "metadata_read_observed", "exact_contents_write_observed",
    "repository_permission_summary", "observation_receipt_digest",
  ], "workflow preflight capability permissions");
  if (
    value.permissions.metadata_read_observed !== true ||
    value.permissions.exact_contents_write_observed !== false
  ) {
    throw new TypeError("workflow preflight capability permission observation is invalid");
  }
  digest(
    value.permissions.observation_receipt_digest,
    "workflow preflight capability permissions observation_receipt_digest",
  );
  if (value.permissions.observation_receipt_digest !== gitLedgerDigestCanonical(
    "codex-review-gate-v2-permission-observation",
    endpointReceipts,
  )) {
    throw new TypeError("workflow preflight permission observation digest is invalid");
  }
  assertObject(
    value.permissions.repository_permission_summary,
    "workflow preflight repository permission summary",
  );
  exactKeys(value.permissions.repository_permission_summary, [
    "repository_push_observed", "repository_admin_observed", "assurance",
    "proves_exact_contents_write", "proves_minimal_token_scope",
    "proves_no_additional_writes",
  ], "workflow preflight repository permission summary");
  const permissionSummary = value.permissions.repository_permission_summary;
  if (
    permissionSummary.assurance !== "repository-permission-summary-only" ||
    permissionSummary.proves_exact_contents_write !== false ||
    permissionSummary.proves_minimal_token_scope !== false ||
    permissionSummary.proves_no_additional_writes !== false
  ) {
    throw new TypeError("workflow preflight repository permission summary overclaims authority");
  }
  strictBoolean(
    permissionSummary.repository_push_observed,
    "workflow preflight repository push observation",
  );
  strictBoolean(
    permissionSummary.repository_admin_observed,
    "workflow preflight repository admin observation",
  );
  validateV2UnsealedCapabilityProtection(
    value.protection,
    value.controller_release,
    value.actor_assurance.app_catalog,
  );
  return deepFreeze(structuredClone(value));
}

function validateV2UnsealedCapabilityProtection(protection, release, appCatalog) {
  assertObject(protection, "workflow preflight capability protection");
  exactKeys(protection, [
    "deletion_blocked", "non_fast_forward_blocked", "force_pushes_blocked",
    "live_ruleset_receipt_digest", "source_workflow_pin", "current_attestation",
  ], "workflow preflight capability protection");
  for (const flag of [
    protection.deletion_blocked,
    protection.non_fast_forward_blocked,
    protection.force_pushes_blocked,
    protection.current_attestation,
  ]) strictBoolean(flag, "workflow preflight protection flag");
  if (protection.force_pushes_blocked !== protection.non_fast_forward_blocked) {
    throw new TypeError("workflow preflight force-push protection is inconsistent");
  }
  digest(
    protection.live_ruleset_receipt_digest,
    "workflow preflight protection live_ruleset_receipt_digest",
  );
  assertObject(protection.source_workflow_pin, "workflow preflight source workflow pin");
  exactKeys(protection.source_workflow_pin, [
    "repository", "workflow_path", "workflow_ref", "workflow_sha", "actor_app",
  ], "workflow preflight source workflow pin");
  assertObject(release, "workflow preflight controller release");
  exactKeys(release, [
    "repository", "release_sha", "workflow_path", "workflow_ref", "workflow_sha",
    "current",
  ], "workflow preflight controller release");
  for (const candidate of [protection.source_workflow_pin.repository, release.repository]) {
    if (canonicalJson(candidate) !== canonicalJson({
      owner: "Joey-Tools",
      name: "codex-review-gate-action",
    })) {
      throw new TypeError("workflow preflight controller repository is unsupported");
    }
  }
  const source = protection.source_workflow_pin;
  if (
    source.workflow_path !== ".github/workflows/codex-review-gate.yml" ||
    source.workflow_path !== release.workflow_path ||
    source.workflow_ref !== release.workflow_ref ||
    source.workflow_sha !== release.workflow_sha ||
    canonicalJson(source.actor_app) !== canonicalJson(appCatalog) ||
    release.release_sha !== release.workflow_sha || release.current !== true
  ) {
    throw new TypeError("workflow preflight controller release pin is inconsistent");
  }
  sha(source.workflow_sha, "workflow preflight source workflow_sha");
  sha(release.release_sha, "workflow preflight release_sha");
}

/**
 * Scan-only command for the scheduled caller. GitHub's offset-paginated open
 * PR connection has no atomic snapshot/version receipt, so a production
 * matrix cannot be assembled from it without a protected-ledger candidate
 * superset and durable discovery watermark. Fail closed until that authority
 * is available; listAllOpenPullRequests remains diagnostic-only.
 */
export async function runV2ListOpenCli(
  environment = process.env,
  dependencies = {},
) {
  exactKeys(dependencies, ["fetch"].filter((key) => dependencies[key] !== undefined),
    "list-open dependencies");
  const command = await readV2WorkflowCommand(environment);
  if (
    environment.V2_CONTROLLER_ROUTE !== "scan-all-open" ||
    command.pull_request.number !== null ||
    command.route.trigger !== "schedule"
  ) {
    throw controllerFailure(
      "LIST_OPEN_ROUTE_REQUIRED",
      "list-open requires the validated scan-all-open schedule command",
    );
  }
  throw controllerFailure(
    "OPEN_PULL_REQUEST_DISCOVERY_AUTHORITY_UNAVAILABLE",
    "list-open requires a protected-ledger candidate superset, durable " +
      "all-state discovery watermark, and exact per-candidate rereads",
    {
      required_authority: "protected-git-ledger-candidate-superset",
      diagnostic_completeness: "unproven",
    },
  );
}

function isMainModule() {
  return process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  const command = process.argv.length === 3 ? process.argv[2] : null;
  if (command === "prepare-command") {
    Promise.resolve(prepareV2WorkflowCommand()).catch((error) => {
      process.stderr.write(`::error::${formatCliError(error)}\n`);
      process.exitCode = 1;
    });
  } else if (command === "run") {
    runV2WorkflowControllerCli().catch((error) => {
      process.stderr.write(`::error::${formatCliError(error)}\n`);
      process.exitCode = 1;
    });
  } else if (command === "schedule-dispatch") {
    runV2ScheduleDispatchCli().then(({ rendered }) => {
      process.stdout.write(rendered);
    }).catch((error) => {
      process.stderr.write(`::error::${formatCliError(error)}\n`);
      process.exitCode = 1;
    });
  } else {
    process.stderr.write(
      "::error::workflow-controller requires exact `prepare-command`, `run`, or " +
        "`schedule-dispatch` command\n",
    );
    process.exitCode = 2;
  }
}

function controllerFailure(code, message, details = null, cause = undefined) {
  return new V2WorkflowControllerError(code, message, details, cause);
}

function formatCliError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error?.code === "string" ? `${error.code}: ` : "";
  return `${code}${message}`.replace(/[\r\n%]/gu, " ");
}

function requiredEnv(environment, name) {
  return boundedString(environment?.[name], name, 4096);
}

function pathInside(candidate, root) {
  const suffix = relative(root, candidate);
  return suffix === "" || (!suffix.startsWith("..") && !isAbsolute(suffix));
}

async function canonicalCandidate(path) {
  const absolute = resolve(path);
  const parent = await realpath(dirname(absolute));
  return resolve(parent, basename(absolute));
}

function assertPathInside(candidate, root, label) {
  if (!pathInside(candidate, root)) {
    throw new Error(`${label} must be inside RUNNER_TEMP`);
  }
}

/**
 * Execute the one network attempt only after the attempted ledger is durably
 * echoed by the caller-owned store. The callback must return the exact ledger
 * it persisted; a digest-only acknowledgement is deliberately insufficient.
 */
export async function executeV2EffectOnce({
  ledger,
  effect_id,
  attempted_at,
  persist_ledger,
  perform_effect,
  receipt_builder = null,
}) {
  if (typeof persist_ledger !== "function" || typeof perform_effect !== "function") {
    throw new TypeError("effect execution requires persist_ledger and perform_effect callbacks");
  }
  const attempted = markV2EffectAttempted({ ledger, effect_id, attempted_at });
  await persistExactLedger(persist_ledger, attempted, "attempted");
  const effect = attempted.effects.find((candidate) => candidate.effect_id === effect_id);

  // perform_effect is intentionally invoked exactly once. A rejection or an
  // invalid response leaves the durable state at attempted forever.
  const capture = await perform_effect(structuredClone(effect));
  assertObject(capture, "effect capture");
  if (effect.kind === "request-comment") {
    return deepFreeze({ ledger: attempted, capture, binding_required: true });
  }
  const receipt = receipt_builder === null
    ? capture.receipt
    : await receipt_builder(structuredClone(capture), structuredClone(effect));
  const bound = bindV2EffectResponse({
    ledger: attempted,
    effect_id,
    http_status: capture.http_status,
    server_time: capture.server_time,
    raw_body: capture.raw_body,
    receipt,
  });
  await persistExactLedger(persist_ledger, bound, "bound");
  return deepFreeze({ ledger: bound, capture, binding_required: false });
}

/** Persist a newly consumed effect before it may be attempted. */
export async function reserveAndPersistV2Effect({
  ledger,
  kind,
  idempotency_key,
  payload,
  recorded_at,
  persist_ledger,
}) {
  if (typeof persist_ledger !== "function") {
    throw new TypeError("effect reservation requires persist_ledger");
  }
  const reserved = reserveV2Effect({
    ledger,
    kind,
    idempotency_key,
    payload,
    recorded_at,
  });
  await persistExactLedger(persist_ledger, reserved, "reserved");
  return reserved;
}

/** Finalize a request effect only after the runner produced its exact binding. */
export async function bindAttemptedV2RequestEffect({
  ledger,
  effect_id,
  capture,
  binding_receipt,
  persist_ledger,
}) {
  if (typeof persist_ledger !== "function") {
    throw new TypeError("request binding requires persist_ledger");
  }
  const bound = bindV2EffectResponse({
    ledger,
    effect_id,
    http_status: capture.http_status,
    server_time: capture.server_time,
    raw_body: capture.raw_body,
    receipt: binding_receipt,
  });
  await persistExactLedger(persist_ledger, bound, "bound");
  return bound;
}

/**
 * Minimal no-retry GitHub effect transport. It never derives a write from an
 * event; every endpoint and payload comes from a validated WAL effect.
 */
export function createV2GitHubEffectTransport({
  fetch: fetchImpl,
  token,
  restBaseUrl = "https://api.github.com",
}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("effect transport fetch must be a function");
  }
  const base = normalizeRestBase(restBaseUrl);
  const authorization = boundedString(token, "token", 4096);
  const transport = {
    async performEffect({ effect, repository, pull_number, sticky_body = null }) {
      validateEffectForExecution(effect);
      const repo = normalizeRepository(repository);
      const pullNumber = positiveInteger(pull_number, "pull_number");
      const repoPath = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
      if (effect.kind === "request-comment") {
        const reservation = effect.payload.reservation;
        if (
          reservation.repository.owner.toLowerCase() !== repo.owner.toLowerCase() ||
          reservation.repository.name.toLowerCase() !== repo.name.toLowerCase() ||
          reservation.pull_request.number !== pullNumber
        ) {
          throw new Error("request effect does not bind the selected repository and pull request");
        }
        return requestJson({
          fetchImpl,
          authorization,
          base,
          method: "POST",
          path: `${repoPath}/issues/${pullNumber}/comments`,
          body: { body: reservation.body },
          expectedStatus: 201,
        });
      }
      if (effect.kind === "commit-status") {
        const write = effect.payload;
        const capture = await requestJson({
          fetchImpl,
          authorization,
          base,
          method: "POST",
          path: `${repoPath}/statuses/${write.sha}`,
          body: {
            state: write.state,
            context: write.context,
            description: write.reason.slice(0, 140),
          },
          expectedStatus: 201,
        });
        const created = parseStatusResponse(capture.data, write);
        const exact = await findExactStatus({
          fetchImpl,
          authorization,
          base,
          repoPath,
          shaValue: write.sha,
          statusId: created.id,
        });
        const refetched = parseStatusResponse(exact.status, write);
        if (canonicalJson(created) !== canonicalJson(refetched)) {
          throw new Error("exact status refetch differs from the create response");
        }
        return deepFreeze({
          ...capture,
          receipt: created,
          exact_refetch: {
            server_time: exact.server_time,
            raw_body_sha256: exact.raw_body_sha256,
          },
        });
      }

      if (typeof sticky_body !== "string" || rawDigest(sticky_body) !== effect.payload.body_sha256) {
        throw new Error("sticky effect body does not match its reserved exact digest");
      }
      const path = effect.payload.method === "POST"
        ? `${repoPath}/issues/${pullNumber}/comments`
        : `${repoPath}/issues/comments/${effect.payload.comment_id}`;
      const capture = await requestJson({
        fetchImpl,
        authorization,
        base,
        method: effect.payload.method,
        path,
        body: { body: sticky_body },
        expectedStatus: effect.payload.method === "POST" ? 201 : 200,
      });
      const comment = parseCommentIdentity(capture.data, sticky_body);
      const exact = await requestJson({
        fetchImpl,
        authorization,
        base,
        method: "GET",
        path: `${repoPath}/issues/comments/${comment.comment_id}`,
        body: null,
        expectedStatus: 200,
      });
      const refetched = parseCommentIdentity(exact.data, sticky_body);
      if (canonicalJson(comment) !== canonicalJson(refetched)) {
        throw new Error("exact sticky refetch differs from the write response");
      }
      return deepFreeze({
        ...capture,
        sticky_identity: comment,
        exact_refetch: {
          server_time: exact.server_time,
          raw_body: exact.raw_body,
          raw_body_sha256: rawDigest(exact.raw_body),
        },
      });
    },
  };
  return Object.freeze(transport);
}

/**
 * Execute one branded production status intent. The opaque ledger handle is
 * projected by the originating Git-ledger factory; callers cannot supply a
 * hand-built endpoint, target, context, state, or description. The one POST is
 * followed by a complete bounded status-history reread, and any uncertainty is
 * surfaced without retrying or reclaiming the consumed intent.
 */
export function createV2GitHubProductionStatusTransport({
  fetch: fetchImpl,
  token,
  restBaseUrl = "https://api.github.com",
  repository,
}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("production status transport fetch must be a function");
  }
  const authorization = boundedString(token, "token", 4096);
  const base = normalizeRestBase(restBaseUrl);
  const repo = normalizeRepository(repository);
  const repoPath = `/repos/${encodeURIComponent(repo.owner)}/` +
    encodeURIComponent(repo.name);

  return Object.freeze({
    async performStatusWrite({ status_intent_handle: statusIntentHandle }) {
      const write = projectV2GitLedgerStatusWriteTransport(statusIntentHandle);
      const capture = await requestJson({
        fetchImpl,
        authorization,
        base,
        method: write.method,
        path: `${repoPath}/statuses/${write.target_sha}`,
        body: {
          state: write.state,
          context: write.context,
          description: write.description,
        },
        expectedStatus: 201,
      });
      const created = parseProductionStatusIdentity(capture.data, write);
      const exact = await refetchExactProductionStatus({
        fetchImpl,
        authorization,
        base,
        repoPath,
        write,
        status_id: created.status_id,
      });
      if (canonicalJson(created) !== canonicalJson(exact.status)) {
        throw new Error(
          "exact production status refetch differs from the create response",
        );
      }
      return validateV2GitLedgerStatusWriteResponseReceipt({
        http_status: 201,
        status_id: created.status_id,
        target_sha: write.target_sha,
        role: write.role,
        context: write.context,
        state: write.state,
        description_digest: write.description_digest,
        created_at: created.created_at,
        updated_at: created.updated_at,
        creator: structuredClone(created.creator),
        post_server_time: capture.server_time,
        post_raw_body_sha256: rawDigest(capture.raw_body),
        refetch_server_time: exact.refetch_server_time,
        refetch_page_count: exact.pages.length,
        refetch_item_count: exact.item_count,
        refetch_match_count: exact.match_count,
        refetch_inventory_digest: gitLedgerDigestCanonical(
          "codex-review-gate-v2-status-refetch-inventory",
          {
            target_sha: write.target_sha,
            status_id: created.status_id,
            pages: exact.pages.map((page) => ({
              page: page.page,
              raw_body_sha256: page.raw_body_sha256,
              item_count: page.item_count,
            })),
          },
        ),
        refetch_pages: exact.pages,
      });
    },
  });
}

/**
 * Execute the audit-only reservation status behind its direct ledger handle.
 * The status is externally visible but never grants, refunds, or reconstructs
 * automatic-request authority.
 */
export function createV2GitHubProductionReservationStatusTransport({
  fetch: fetchImpl,
  token,
  restBaseUrl = "https://api.github.com",
  repository,
}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError(
      "production reservation status transport fetch must be a function",
    );
  }
  const authorization = boundedString(token, "token", 4096);
  const base = normalizeRestBase(restBaseUrl);
  const repo = normalizeRepository(repository);
  const repoPath = `/repos/${encodeURIComponent(repo.owner)}/` +
    encodeURIComponent(repo.name);

  return Object.freeze({
    async performReservationStatusWrite({
      reservation_status_intent_handle: reservationStatusIntentHandle,
    }) {
      const write = projectV2GitLedgerReservationStatusTransport(
        reservationStatusIntentHandle,
      );
      const capture = await requestJson({
        fetchImpl,
        authorization,
        base,
        method: write.method,
        path: `${repoPath}/statuses/${write.target_sha}`,
        body: {
          state: write.state,
          context: write.context,
          description: write.description,
        },
        expectedStatus: 201,
      });
      const created = parseProductionStatusIdentity(capture.data, write);
      const exact = await refetchExactProductionStatus({
        fetchImpl,
        authorization,
        base,
        repoPath,
        write,
        status_id: created.status_id,
      });
      if (canonicalJson(created) !== canonicalJson(exact.status)) {
        throw new Error(
          "exact reservation status refetch differs from the create response",
        );
      }
      return validateV2GitLedgerReservationStatusResponseReceipt({
        http_status: 201,
        status_id: created.status_id,
        target_sha: write.target_sha,
        context: write.context,
        state: write.state,
        description_digest: write.description_digest,
        created_at: created.created_at,
        updated_at: created.updated_at,
        creator: structuredClone(created.creator),
        post_server_time: capture.server_time,
        post_raw_body_sha256: rawDigest(capture.raw_body),
        refetch_server_time: exact.refetch_server_time,
        refetch_page_count: exact.pages.length,
        refetch_item_count: exact.item_count,
        refetch_match_count: exact.match_count,
        refetch_inventory_digest: gitLedgerDigestCanonical(
          "codex-review-gate-v2-reservation-status-refetch-inventory",
          {
            target_sha: write.target_sha,
            status_id: created.status_id,
            context: write.context,
            pages: exact.pages.map((page) => ({
              page: page.page,
              raw_body_sha256: page.raw_body_sha256,
              item_count: page.item_count,
            })),
          },
        ),
        refetch_pages: exact.pages,
      });
    },
  });
}

/**
 * Perform exactly one retry-zero automatic review-request POST and one exact
 * direct GET. Scope bracketing and protected-ledger binding remain controller
 * responsibilities because they must surround this exact public effect.
 */
export function createV2GitHubProductionAutomaticReviewRequestTransport({
  fetch: fetchImpl,
  token,
  restBaseUrl = "https://api.github.com",
  repository,
  pull_number: pullNumberValue,
}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError(
      "production automatic request transport fetch must be a function",
    );
  }
  const authorization = boundedString(token, "token", 4096);
  const base = normalizeRestBase(restBaseUrl);
  const repo = normalizeRepository(repository);
  const pullNumber = positiveInteger(pullNumberValue, "pull_number");
  const repoPath = `/repos/${encodeURIComponent(repo.owner)}/` +
    encodeURIComponent(repo.name);
  const expectedPath = `${repoPath}/issues/${pullNumber}/comments`;

  return Object.freeze({
    async performAutomaticReviewRequest({
      automatic_request_intent_handle: automaticRequestIntentHandle,
    }) {
      const write = projectV2GitLedgerAutomaticReviewRequestTransport(
        automaticRequestIntentHandle,
      );
      if (write.path !== expectedPath) {
        throw new Error(
          "automatic request transport differs from the selected pull request",
        );
      }
      const capture = await requestJson({
        fetchImpl,
        authorization,
        base,
        method: write.method,
        path: write.path,
        body: structuredClone(write.json),
        expectedStatus: write.expected_status,
      });
      const created = parseProductionAutomaticRequestIdentity(capture.data, {
        base,
        repo,
        pull_number: pullNumber,
        expected_body: write.body,
      });
      const exact = await requestJson({
        fetchImpl,
        authorization,
        base,
        method: "GET",
        path: `${repoPath}/issues/comments/${created.request_id}`,
        body: null,
        expectedStatus: 200,
      });
      const refetched = parseProductionAutomaticRequestIdentity(exact.data, {
        base,
        repo,
        pull_number: pullNumber,
        expected_body: write.body,
      });
      if (canonicalJson(created) !== canonicalJson(refetched)) {
        throw new Error(
          "exact automatic request refetch differs from the create response",
        );
      }
      return deepFreeze({
        identity: created,
        post_server_time: capture.server_time,
        post_raw_body_sha256: rawDigest(capture.raw_body),
        refetch_server_time: exact.server_time,
        refetch_raw_body_sha256: rawDigest(exact.raw_body),
      });
    },
  });
}

function parseProductionAutomaticRequestIdentity(value, {
  base,
  repo,
  pull_number: pullNumber,
  expected_body: expectedBody,
}) {
  assertObject(value, "production automatic request response");
  const requestId = String(positiveInteger(
    value.id,
    "production automatic request response.id",
  ));
  const apiUrl = `${base}/repos/${encodeURIComponent(repo.owner)}/` +
    `${encodeURIComponent(repo.name)}/issues/comments/${requestId}`;
  const requestUrl = `https://github.com/${repo.owner}/${repo.name}/pull/` +
    `${pullNumber}#issuecomment-${requestId}`;
  const issueUrl = `${base}/repos/${encodeURIComponent(repo.owner)}/` +
    `${encodeURIComponent(repo.name)}/issues/${pullNumber}`;
  if (
    value.url !== apiUrl || value.html_url !== requestUrl ||
    value.issue_url !== issueUrl || value.body !== expectedBody
  ) {
    throw new Error(
      "automatic request response differs from its exact repository, PR, and body",
    );
  }
  assertObject(value.user, "production automatic request response.user");
  assertObject(
    value.performed_via_github_app,
    "production automatic request response.performed_via_github_app",
  );
  return deepFreeze({
    carrier_selector: { kind: "issue_comment", id: requestId },
    request_id: requestId,
    request_node_id: boundedString(
      value.node_id,
      "production automatic request response.node_id",
      256,
    ),
    api_url: apiUrl,
    request_url: requestUrl,
    issue_url: issueUrl,
    body_sha256: rawDigest(expectedBody),
    created_at: timestamp(
      value.created_at,
      "production automatic request response.created_at",
    ),
    updated_at: timestamp(
      value.updated_at,
      "production automatic request response.updated_at",
    ),
    actor: {
      id: String(positiveInteger(
        value.user.id,
        "production automatic request response.user.id",
      )),
      node_id: boundedString(
        value.user.node_id,
        "production automatic request response.user.node_id",
        256,
      ),
      login: boundedString(
        value.user.login,
        "production automatic request response.user.login",
        128,
      ),
      type: boundedString(
        value.user.type,
        "production automatic request response.user.type",
        64,
      ),
    },
    app: {
      id: String(positiveInteger(
        value.performed_via_github_app.id,
        "production automatic request response app.id",
      )),
      node_id: boundedString(
        value.performed_via_github_app.node_id,
        "production automatic request response app.node_id",
        256,
      ),
      slug: boundedString(
        value.performed_via_github_app.slug,
        "production automatic request response app.slug",
        128,
      ),
    },
  });
}

function createV2AutomaticReviewRequestBindingReceipt({
  capture,
  minimal_pre: minimalPre,
  minimal_post: minimalPost,
}) {
  if (
    canonicalJson(minimalScopeStableProjection(minimalPre)) !==
      canonicalJson(minimalScopeStableProjection(minimalPost)) ||
    Date.parse(minimalPost.observed_at) < Date.parse(minimalPre.observed_at)
  ) {
    throw controllerFailure(
      "AUTOMATIC_REQUEST_SCOPE_DRIFT",
      "automatic review request changed PR scope across its public effect",
    );
  }
  const scopeWithoutDigest = {
    schema: V2_GIT_LEDGER_AUTOMATIC_REVIEW_REQUEST_SCOPE_RECEIPT_SCHEMA,
    schema_version: 1,
    pre_scope: structuredClone(minimalPre),
    post_scope: structuredClone(minimalPost),
    stable: true,
  };
  const requestScopeReceipt = {
    ...scopeWithoutDigest,
    receipt_digest: gitLedgerDigestCanonical(
      "codex-review-gate-v2-automatic-review-request-scope-receipt",
      scopeWithoutDigest,
    ),
  };
  const identity = structuredClone(capture.identity);
  const requestDigest = gitLedgerDigestCanonical(
    "codex-review-gate-v2-automatic-review-request-identity",
    identity,
  );
  const withoutDigest = {
    schema: V2_GIT_LEDGER_AUTOMATIC_REVIEW_REQUEST_BINDING_RECEIPT_SCHEMA,
    schema_version: 1,
    http_status: 201,
    ...identity,
    post_server_time: capture.post_server_time,
    post_raw_body_sha256: capture.post_raw_body_sha256,
    request_digest: requestDigest,
    refetch_http_status: 200,
    refetch_server_time: capture.refetch_server_time,
    refetch_raw_body_sha256: capture.refetch_raw_body_sha256,
    refetched_request_digest: requestDigest,
    request_scope_receipt: requestScopeReceipt,
  };
  return deepFreeze({
    ...withoutDigest,
    receipt_digest: gitLedgerDigestCanonical(
      "codex-review-gate-v2-automatic-review-request-binding-receipt",
      withoutDigest,
    ),
  });
}

/** Render the controller ledger as one canonical trusted issue-comment body. */
export function renderV2EffectLedgerComment(ledger) {
  const value = validateV2EffectLedger(ledger);
  const encoded = Buffer.from(canonicalJson(value), "utf8").toString("base64");
  return `Codex Review Gate v2 controller ledger.\n\n` +
    `<!-- ${V2_EFFECT_LEDGER_COMMENT_MARKER}\n${encoded}\n-->\n`;
}

export function parseV2EffectLedgerComment(body) {
  if (typeof body !== "string" || Buffer.byteLength(body, "utf8") > 512 * 1024) {
    return null;
  }
  const prefix = `Codex Review Gate v2 controller ledger.\n\n` +
    `<!-- ${V2_EFFECT_LEDGER_COMMENT_MARKER}\n`;
  if (!body.startsWith(prefix) || !body.endsWith("\n-->\n")) {
    return null;
  }
  const encoded = body.slice(prefix.length, -"\n-->\n".length);
  try {
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.toString("base64") !== encoded) {
      return null;
    }
    const text = bytes.toString("utf8");
    const value = JSON.parse(text);
    if (canonicalJson(value) !== text) {
      return null;
    }
    validateV2EffectLedger(value);
    return value;
  } catch {
    return null;
  }
}

/**
 * Durable issue-comment ledger store. A write is accepted only after its exact
 * response and an exact GET echo the canonical body. Ambiguous persistence
 * fails before any protected effect can run.
 */
export function createV2GitHubLedgerStore({
  fetch: fetchImpl,
  token,
  restBaseUrl = "https://api.github.com",
  repository,
  pull_number,
  trusted_actor = {
    login: "github-actions[bot]",
    type: "Bot",
    app_slug: "github-actions",
  },
}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("ledger store fetch must be a function");
  }
  const authorization = boundedString(token, "token", 4096);
  const base = normalizeRestBase(restBaseUrl);
  const repo = normalizeRepository(repository);
  const pullNumber = positiveInteger(pull_number, "pull_number");
  const actor = normalizeTrustedActor(trusted_actor);
  const repoPath = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;

  const store = {
    async loadLedger(scope) {
      const normalizedScope = normalizeLedgerScope(scope);
      const candidates = [];
      for (let page = 1; page <= 20; page += 1) {
        const capture = await requestJsonArray({
          fetchImpl,
          authorization,
          base,
          method: "GET",
          path: `${repoPath}/issues/${pullNumber}/comments?per_page=100&page=${page}`,
          expectedStatus: 200,
        });
        for (const comment of capture.data) {
          const parsed = parseV2EffectLedgerComment(comment.body);
          if (parsed !== null && sameLedgerScope(parsed, normalizedScope)) {
            assertTrustedLedgerActor(comment, actor);
            candidates.push({ comment, ledger: parsed });
          }
        }
        if (capture.data.length < 100) {
          break;
        }
        if (page === 20) {
          throw new Error("ledger comment inventory exceeds the 2000-item safety limit");
        }
      }
      if (candidates.length > 1) {
        throw new Error("multiple trusted controller ledgers exist for one head epoch");
      }
      if (candidates.length === 0) {
        return null;
      }
      const selected = candidates[0];
      const exact = await requestJson({
        fetchImpl,
        authorization,
        base,
        method: "GET",
        path: `${repoPath}/issues/comments/${positiveInteger(selected.comment.id, "ledger comment id")}`,
        body: null,
        expectedStatus: 200,
      });
      assertTrustedLedgerActor(exact.data, actor);
      if (exact.data.body !== selected.comment.body) {
        throw new Error("exact controller ledger differs from the complete comment inventory");
      }
      const ledger = parseV2EffectLedgerComment(exact.data.body);
      if (ledger === null || ledger.ledger_digest !== selected.ledger.ledger_digest) {
        throw new Error("exact controller ledger is invalid or changed");
      }
      return deepFreeze({
        ledger,
        comment_id: String(selected.comment.id),
        comment_node_id: boundedString(exact.data.node_id, "ledger comment node_id", 256),
        response_server_time: exact.server_time,
        raw_body_sha256: rawDigest(exact.raw_body),
      });
    },

    async persistLedger(ledger) {
      const desired = validateV2EffectLedger(ledger);
      const scope = ledgerScope(desired);
      const current = await store.loadLedger(scope);
      if (current !== null && current.ledger.ledger_digest === desired.ledger_digest) {
        return structuredClone(desired);
      }
      if (current !== null) {
        assertLedgerSuccessor(current.ledger, desired);
      } else if (desired.effects.length > 1) {
        throw new Error("a new durable ledger cannot begin with multiple effects");
      }
      const body = renderV2EffectLedgerComment(desired);
      const method = current === null ? "POST" : "PATCH";
      const path = current === null
        ? `${repoPath}/issues/${pullNumber}/comments`
        : `${repoPath}/issues/comments/${current.comment_id}`;
      const write = await requestJson({
        fetchImpl,
        authorization,
        base,
        method,
        path,
        body: { body },
        expectedStatus: method === "POST" ? 201 : 200,
      });
      assertTrustedLedgerActor(write.data, actor);
      if (write.data.body !== body) {
        throw new Error("controller ledger write response did not echo the canonical body");
      }
      const id = positiveInteger(write.data.id, "ledger write comment id");
      const exact = await requestJson({
        fetchImpl,
        authorization,
        base,
        method: "GET",
        path: `${repoPath}/issues/comments/${id}`,
        body: null,
        expectedStatus: 200,
      });
      assertTrustedLedgerActor(exact.data, actor);
      if (exact.data.body !== body) {
        throw new Error("exact controller ledger refetch did not echo the canonical body");
      }
      const echoed = parseV2EffectLedgerComment(exact.data.body);
      if (echoed === null || echoed.ledger_digest !== desired.ledger_digest) {
        throw new Error("exact controller ledger refetch is not the persisted value");
      }
      return structuredClone(echoed);
    },
  };
  return Object.freeze(store);
}

/**
 * Legacy reservation-status projection transport. In production the protected
 * Git ledger consumes the reservation before this non-required audit status is
 * attempted; neither this status nor a controller comment grants, refunds, or
 * reconstructs automatic-request authority.
 */
export function createV2GitHubReservationLedger({
  fetch: fetchImpl,
  token,
  restBaseUrl = "https://api.github.com",
  repository,
  expected_creator = {
    login: "github-actions[bot]",
    type: "Bot",
  },
}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("reservation ledger fetch must be a function");
  }
  const authorization = boundedString(token, "token", 4096);
  const base = normalizeRestBase(restBaseUrl);
  const repo = normalizeRepository(repository);
  const creator = normalizeStatusCreator(expected_creator);
  const repoPath = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;

  return Object.freeze({
    async loadReservations({ head_ref_oid }) {
      const head = sha(head_ref_oid, "head_ref_oid");
      const records = [];
      for (let page = 1; page <= 10; page += 1) {
        const capture = await requestJsonArray({
          fetchImpl,
          authorization,
          base,
          method: "GET",
          path: `${repoPath}/commits/${head}/statuses?per_page=100&page=${page}`,
          expectedStatus: 200,
        });
        for (const status of capture.data) {
          if (!String(status.context ?? "").startsWith(V2_RESERVATION_STATUS_CONTEXT_PREFIX)) {
            continue;
          }
          records.push(parseReservationStatus(status, head, creator));
          if (records.length > MAX_V2_RESERVATION_STATUS_RECORDS) {
            throw new Error("reservation status history exceeds the fail-closed cap");
          }
        }
        if (capture.data.length < 100) {
          break;
        }
        if (page === 10) {
          throw new Error("reservation status pagination exceeds the fail-closed cap");
        }
      }
      records.sort((left, right) => left.ordinal - right.ordinal);
      const ordinals = new Set();
      const digests = new Set();
      for (const record of records) {
        if (ordinals.has(record.ordinal) || digests.has(record.reservation_digest)) {
          throw new Error("reservation status history repeats an ordinal or digest");
        }
        ordinals.add(record.ordinal);
        digests.add(record.reservation_digest);
      }
      for (let ordinal = 1; ordinal <= records.length; ordinal += 1) {
        if (!ordinals.has(ordinal)) {
          throw new Error("reservation status history has a missing ordinal");
        }
      }
      return deepFreeze({
        head_ref_oid: head,
        automatic_reservations_on_head: records.length,
        records,
      });
    },

    async persistReservation(reservation) {
      validateReservationStatusInput(reservation, creator);
      const before = await this.loadReservations({
        head_ref_oid: reservation.epoch_head_sha,
      });
      if (before.records.some((record) =>
        record.reservation_digest === reservation.reservation_digest)) {
        throw new Error("reservation digest was already consumed on this head");
      }
      if (reservation.ordinal !== before.automatic_reservations_on_head + 1) {
        throw new Error("reservation ordinal does not follow append-only head status history");
      }
      const context = reservationStatusContext(reservation.ordinal);
      const description = reservation.reservation_digest;
      const capture = await requestJson({
        fetchImpl,
        authorization,
        base,
        method: "POST",
        path: `${repoPath}/statuses/${reservation.epoch_head_sha}`,
        body: {
          state: "pending",
          context,
          description,
        },
        expectedStatus: 201,
      });
      parseReservationStatus(capture.data, reservation.epoch_head_sha, creator, {
        ordinal: reservation.ordinal,
        reservation_digest: reservation.reservation_digest,
      });
      const after = await this.loadReservations({
        head_ref_oid: reservation.epoch_head_sha,
      });
      const persisted = after.records.find((record) =>
        record.ordinal === reservation.ordinal &&
        record.reservation_digest === reservation.reservation_digest);
      if (persisted === undefined) {
        throw new Error("reservation status did not appear in the exact paginated history");
      }
      return persisted;
    },
  });
}

/** Create the append-only controller ledger for one repository/PR/head epoch. */
export function createV2EffectLedger({
  repository_node_id,
  pull_request_node_id,
  head_ref_oid,
  created_at,
}) {
  const ledger = {
    schema: V2_EFFECT_LEDGER_SCHEMA,
    schema_version: V2_EFFECT_LEDGER_SCHEMA_VERSION,
    repository_node_id: boundedString(repository_node_id, "repository_node_id", 256),
    pull_request_node_id: boundedString(pull_request_node_id, "pull_request_node_id", 256),
    head_ref_oid: sha(head_ref_oid, "head_ref_oid"),
    created_at: timestamp(created_at, "created_at"),
    effects: [],
  };
  return sealLedger(ledger);
}

/**
 * Append an effect intent before any network call. Effects are single-attempt:
 * an ambiguous response permanently consumes the intent and is never retried.
 */
export function reserveV2Effect({
  ledger,
  kind,
  idempotency_key,
  payload,
  recorded_at,
}) {
  const current = validateV2EffectLedger(ledger);
  enumValue(kind, EFFECT_KINDS, "kind");
  const key = boundedString(idempotency_key, "idempotency_key", 256);
  if (current.effects.some((effect) => effect.idempotency_key === key)) {
    throw new Error("effect idempotency key is already consumed");
  }
  const normalizedPayload = validateEffectPayload(kind, payload, current);
  const at = timestamp(recorded_at, "recorded_at");
  if (Date.parse(at) < Date.parse(current.created_at)) {
    throw new Error("effect reservation cannot predate its ledger");
  }
  const intent = {
    schema: V2_EFFECT_ATTEMPT_SCHEMA,
    schema_version: 1,
    effect_id: effectId(current, kind, key, normalizedPayload),
    kind,
    idempotency_key: key,
    payload: normalizedPayload,
    state: "reserved",
    reserved_at: at,
    attempted_at: null,
    response: null,
    retry_limit: 0,
    network_uncertainty_policy: "do-not-retry-or-reclaim",
  };
  return appendEffect(current, intent);
}

/** Mark the durable intent attempted immediately before the one network call. */
export function markV2EffectAttempted({ ledger, effect_id, attempted_at }) {
  return updateEffect(ledger, effect_id, (effect, current) => {
    if (effect.state !== "reserved") {
      throw new Error("only a durably reserved effect can be attempted");
    }
    const at = timestamp(attempted_at, "attempted_at");
    if (Date.parse(at) < Date.parse(effect.reserved_at)) {
      throw new Error("effect attempt cannot predate its reservation");
    }
    return {
      ...effect,
      state: "attempted",
      attempted_at: at,
      response: null,
    };
  });
}

/**
 * Bind an exact HTTP response after the effect. Status/comment writes require
 * their exact success status; an ambiguous result remains attempted forever.
 */
export function bindV2EffectResponse({
  ledger,
  effect_id,
  http_status,
  server_time,
  raw_body,
  receipt = null,
}) {
  return updateEffect(ledger, effect_id, (effect) => {
    if (effect.state !== "attempted") {
      throw new Error("only an attempted effect can bind a response");
    }
    const expected = effect.kind === "commit-status" ||
        effect.kind === "request-comment" ||
        (effect.kind === "sticky-comment" && effect.payload.method === "POST")
      ? 201
      : 200;
    if (http_status !== expected) {
      throw new Error(`effect requires exact HTTP ${expected}`);
    }
    if (typeof raw_body !== "string") {
      throw new TypeError("raw_body must be the exact UTF-8 response text");
    }
    validateEffectReceipt(effect.kind, receipt);
    const responseTime = timestamp(server_time, "server_time");
    if (Date.parse(responseTime) < Date.parse(effect.attempted_at)) {
      throw new Error("effect response server time predates its durable attempt");
    }
    return {
      ...effect,
      state: "bound",
      response: {
        schema: V2_EFFECT_RESPONSE_SCHEMA,
        schema_version: 1,
        http_status,
        server_time: responseTime,
        raw_body_sha256: rawDigest(raw_body),
        receipt,
      },
    };
  });
}

/** Validate a scheduler-authorized status plan before creating WAL intents. */
export function validateV2StatusWrites(plan, {
  head_ref_oid,
  status_target_mode = plan?.mode,
  public_report,
}) {
  assertObject(plan, "status plan");
  if (!Array.isArray(plan.writes)) {
    throw new TypeError("status plan writes must be an array");
  }
  const mode = enumValue(
    status_target_mode,
    STATUS_TARGET_MODES,
    "status target mode",
  );
  const decision = enumValue(
    plan.decision,
    STATUS_PLAN_DECISIONS,
    "status plan decision",
  );
  const publicReport = assertV2PublicReport(public_report);
  if (publicReport.decision !== decision) {
    throw new Error("status plan decision does not match the exact public report");
  }
  if (plan.mode !== mode) {
    throw new Error("status plan mode does not match the trusted status target mode");
  }
  if (typeof plan.terminal_cutover !== "boolean") {
    throw new TypeError("status plan terminal_cutover must be boolean");
  }
  const preEpochZeroWrite =
    plan.writes.length === 0 && publicReport.status_target === null &&
    publicReport.review_epoch === null && publicReport.selection.selected === true &&
    publicReport.provider_profile === null && publicReport.evidence_basis === null &&
    new Set(["blocked-input", "blocked-configuration"]).has(decision);
  const head = head_ref_oid === null && preEpochZeroWrite
    ? null
    : sha(head_ref_oid, "head_ref_oid");
  const writes = plan.writes.map((write, index) => {
    assertObject(write, `status write ${index}`);
    const role = enumValue(write.role, STATUS_ROLES, `status write ${index}.role`);
    const state = enumValue(write.state, STATUS_STATES, `status write ${index}.state`);
    const target = sha(write.sha, `status write ${index}.sha`);
    if (write.context !== V2_STATUS_CONTEXT) {
      throw new Error(`status context must be exactly ${V2_STATUS_CONTEXT}`);
    }
    if (target === head && role !== "head-sentinel") {
      throw new Error("the current head may be targeted only by the head-sentinel role");
    }
    if (target === head && state === "success") {
      throw new Error("the head sentinel must never receive success");
    }
    if (role === "head-sentinel" && target !== head) {
      throw new Error("head-sentinel role must target the current head");
    }
    if (role === "primary-terminal" && !plan.terminal_cutover) {
      throw new Error("primary-terminal requires a terminal cutover plan");
    }
    if (role === "primary-terminal" && state === "pending") {
      throw new Error("primary-terminal cannot publish a pending state");
    }
    digest(write.idempotency_key, `status write ${index}.idempotency_key`, {
      allowPrefixedKey: true,
    });
    return structuredClone(write);
  });
  const ids = new Set(writes.map((write) => write.idempotency_key));
  if (ids.size !== writes.length) {
    throw new Error("status plan repeats an idempotency key");
  }
  const roles = new Set(writes.map((write) => write.role));
  if (roles.size !== writes.length) {
    throw new Error("status plan repeats a status role");
  }
  if (plan.terminal_cutover !== writes.some((write) =>
    write.role === "primary-terminal")) {
    throw new Error("terminal cutover must exactly bind one primary-terminal write");
  }
  const expectedWrites = expectedStatusWritesFromPublicReport({
    report: publicReport,
    mode,
    head,
  });
  if (writes.length !== expectedWrites.length) {
    throw new Error("status writes do not match the exact public report write count");
  }
  for (const [index, expected] of expectedWrites.entries()) {
    const write = writes[index];
    if (
      write.role !== expected.role || write.sha !== expected.sha ||
      write.state !== expected.state || write.context !== V2_STATUS_CONTEXT
    ) {
      throw new Error(
        `status write ${index} does not match the exact public report target and decision`,
      );
    }
  }
  if (mode === "head") {
    if (plan.terminal_cutover || writes.some((write) => write.role !== "head-sentinel")) {
      throw new Error("head mode permits only non-terminal head-sentinel writes");
    }
    if (HEAD_MODE_SUPPRESSED_DECISIONS.has(decision)) {
      if (
        writes.length !== 0 ||
        !Array.isArray(plan.suppressed_writes) ||
        plan.suppressed_writes.length !== 0 ||
        plan.suppression_reason !== "suppressed-unsupported-terminal-target"
      ) {
        throw new Error(
          "head mode clean/skipped decisions require explicit zero-write suppression",
        );
      }
    }
  }
  return writes;
}

function expectedStatusWritesFromPublicReport({ report, mode, head }) {
  if (report.decision === "not-selected") {
    if (report.status_target !== null) {
      throw new Error("not-selected public report unexpectedly carries a status target");
    }
    return [];
  }
  const target = report.status_target;
  if (target === null) {
    if (
      new Set(["blocked-input", "blocked-configuration"])
        .has(report.decision) &&
      report.selection.selected === true && report.review_epoch === null &&
      report.provider_profile === null && report.evidence_basis === null
    ) {
      return [];
    }
    throw new Error(
      "selected public report lacks a status target outside the closed pre-epoch blocker",
    );
  }
  assertObject(target, "public report status target");
  if (
    target.mode !== mode || target.context !== V2_STATUS_CONTEXT ||
    target.head_ref_oid !== head || report.review_epoch?.head_ref_oid !== head
  ) {
    throw new Error("public report status target is stale or belongs to another head/mode");
  }
  const sentinelState = {
    pending: "pending",
    findings: "failure",
    inconclusive: "error",
    "blocked-configuration": "error",
    "blocked-input": "error",
  }[report.decision];
  if (mode === "head") {
    if (HEAD_MODE_SUPPRESSED_DECISIONS.has(report.decision)) return [];
    return sentinelState === undefined
      ? []
      : [{ role: "head-sentinel", sha: head, state: sentinelState }];
  }

  const writes = [];
  const primaryState = {
    clean: "success",
    findings: "failure",
    inconclusive: "error",
    "skipped-unavailable": "success",
    "blocked-configuration": "error",
    "blocked-input": "error",
  }[report.decision];
  if (primaryState !== undefined && target.potential_target_state === "validated") {
    if (target.potential_merge_commit_oid === null) {
      throw new Error("validated public report lacks its potential merge status target");
    }
    writes.push({
      role: "primary-terminal",
      sha: target.potential_merge_commit_oid,
      state: primaryState,
    });
  }
  if (sentinelState !== undefined) {
    writes.push({ role: "head-sentinel", sha: head, state: sentinelState });
  }
  return writes;
}

export function validateV2EffectLedger(value) {
  assertObject(value, "effect ledger");
  exactKeys(value, [
    "schema",
    "schema_version",
    "repository_node_id",
    "pull_request_node_id",
    "head_ref_oid",
    "created_at",
    "effects",
    "ledger_digest",
  ], "effect ledger");
  if (value.schema !== V2_EFFECT_LEDGER_SCHEMA || value.schema_version !== 1) {
    throw new Error("effect ledger has an unsupported schema");
  }
  boundedString(value.repository_node_id, "repository_node_id", 256);
  boundedString(value.pull_request_node_id, "pull_request_node_id", 256);
  sha(value.head_ref_oid, "head_ref_oid");
  timestamp(value.created_at, "created_at");
  if (!Array.isArray(value.effects) || value.effects.length > 4_000) {
    throw new TypeError("effect ledger effects must contain at most 4000 entries");
  }
  const ids = new Set();
  const keys = new Set();
  for (const [index, effect] of value.effects.entries()) {
    validateEffect(effect, value, index);
    if (ids.has(effect.effect_id) || keys.has(effect.idempotency_key)) {
      throw new Error("effect ledger contains a replayed identity");
    }
    ids.add(effect.effect_id);
    keys.add(effect.idempotency_key);
  }
  digest(value.ledger_digest, "ledger_digest");
  const { ledger_digest: _digest, ...withoutDigest } = value;
  const expected = digestCanonical("codex-review-gate-v2-effect-ledger", withoutDigest);
  if (expected !== value.ledger_digest) {
    throw new Error("effect ledger digest is invalid");
  }
  return value;
}

function validateEffect(effect, ledger, index) {
  const label = `effect ledger effects[${index}]`;
  exactKeys(effect, [
    "schema", "schema_version", "effect_id", "kind", "idempotency_key",
    "payload", "state", "reserved_at", "attempted_at", "response",
    "retry_limit", "network_uncertainty_policy",
  ], label);
  if (effect.schema !== V2_EFFECT_ATTEMPT_SCHEMA || effect.schema_version !== 1) {
    throw new Error(`${label} has an unsupported schema`);
  }
  enumValue(effect.kind, EFFECT_KINDS, `${label}.kind`);
  boundedString(effect.effect_id, `${label}.effect_id`, 256);
  boundedString(effect.idempotency_key, `${label}.idempotency_key`, 256);
  validateEffectPayload(effect.kind, effect.payload, ledger);
  enumValue(effect.state, new Set(["reserved", "attempted", "bound"]), `${label}.state`);
  timestamp(effect.reserved_at, `${label}.reserved_at`);
  if (Date.parse(effect.reserved_at) < Date.parse(ledger.created_at)) {
    throw new Error(`${label} predates the ledger`);
  }
  if (effect.retry_limit !== 0 || effect.network_uncertainty_policy !== "do-not-retry-or-reclaim") {
    throw new Error(`${label} must be a consumed retry-zero effect`);
  }
  if (effect.state === "reserved") {
    if (effect.attempted_at !== null || effect.response !== null) {
      throw new Error(`${label} reserved state has effect evidence`);
    }
  } else {
    timestamp(effect.attempted_at, `${label}.attempted_at`);
    if (Date.parse(effect.attempted_at) < Date.parse(effect.reserved_at)) {
      throw new Error(`${label} attempt predates reservation`);
    }
    if (effect.state === "attempted" && effect.response !== null) {
      throw new Error(`${label} attempted state already has a response`);
    }
    if (effect.state === "bound") {
      assertObject(effect.response, `${label}.response`);
    }
  }
}

function validateEffectPayload(kind, payload, ledger) {
  assertObject(payload, `${kind} payload`);
  if (kind === "request-comment") {
    exactKeys(payload, ["reservation", "attempt"], "request-comment payload");
    if (payload.reservation?.schema !== V2_REQUEST_RESERVATION_SCHEMA) {
      throw new Error("request-comment payload requires a v2 reservation");
    }
    if (payload.attempt?.schema !== V2_REQUEST_ATTEMPT_SCHEMA) {
      throw new Error("request-comment payload requires a v2 attempt receipt");
    }
    if (
      payload.reservation.epoch_head_sha !== ledger.head_ref_oid ||
      payload.attempt.reservation_digest !== payload.reservation.reservation_digest
    ) {
      throw new Error("request-comment payload does not bind the ledger head and reservation");
    }
  } else if (kind === "commit-status") {
    exactKeys(payload, [
      "role", "sha", "context", "state", "reason", "idempotency_key",
    ], "commit-status payload");
    validateLegacyStatusPayload(payload, ledger.head_ref_oid);
  } else {
    exactKeys(payload, [
      "method", "comment_id", "body_sha256", "projection_digest",
    ], "sticky-comment payload");
    enumValue(payload.method, new Set(["POST", "PATCH"]), "sticky method");
    if (payload.method === "POST" && payload.comment_id !== null) {
      throw new Error("sticky POST cannot have a pre-existing comment id");
    }
    if (payload.method === "PATCH") {
      boundedString(payload.comment_id, "sticky comment_id", 32);
    }
    digest(payload.body_sha256, "sticky body_sha256");
    digest(payload.projection_digest, "sticky projection_digest");
  }
  return structuredClone(payload);
}

function validateLegacyStatusPayload(payload, headRefOid) {
  const role = enumValue(payload.role, STATUS_ROLES, "legacy status role");
  const state = enumValue(payload.state, STATUS_STATES, "legacy status state");
  const target = sha(payload.sha, "legacy status sha");
  const head = sha(headRefOid, "legacy status head_ref_oid");
  if (payload.context !== V2_STATUS_CONTEXT) {
    throw new Error(`status context must be exactly ${V2_STATUS_CONTEXT}`);
  }
  if (role === "head-sentinel") {
    if (target !== head) {
      throw new Error("head-sentinel role must target the current head");
    }
    if (state === "success") {
      throw new Error("the head sentinel must never receive success");
    }
  } else {
    if (target === head) {
      throw new Error("the current head may be targeted only by the head-sentinel role");
    }
    if (state === "pending") {
      throw new Error("primary-terminal cannot publish a pending state");
    }
  }
  boundedString(payload.reason, "legacy status reason", 256);
  digest(payload.idempotency_key, "legacy status idempotency_key", {
    allowPrefixedKey: true,
  });
}

function validateEffectReceipt(kind, receipt) {
  if (receipt === null) {
    throw new Error(`${kind} response requires a closed receipt`);
  }
  assertObject(receipt, `${kind} receipt`);
  if (kind === "request-comment" && receipt.schema !== V2_REQUEST_BINDING_SCHEMA) {
    throw new Error("request-comment response requires a v2 binding receipt");
  }
  if (kind === "commit-status") {
    exactKeys(receipt, ["sha", "context", "state", "id"], "status receipt");
    sha(receipt.sha, "status receipt.sha");
    if (receipt.context !== V2_STATUS_CONTEXT) {
      throw new Error("status receipt context mismatch");
    }
    enumValue(receipt.state, STATUS_STATES, "status receipt.state");
    boundedString(receipt.id, "status receipt.id", 64);
  }
  if (kind === "sticky-comment") {
    exactKeys(receipt, [
      "comment_id", "comment_node_id", "raw_body_sha256", "binding_sha256",
    ], "sticky receipt");
    boundedString(receipt.comment_id, "sticky receipt.comment_id", 32);
    boundedString(receipt.comment_node_id, "sticky receipt.comment_node_id", 256);
    digest(receipt.raw_body_sha256, "sticky receipt.raw_body_sha256");
    digest(receipt.binding_sha256, "sticky receipt.binding_sha256");
  }
}

function appendEffect(ledger, effect) {
  const { ledger_digest: _digest, ...base } = ledger;
  return sealLedger({ ...base, effects: [...base.effects, effect] });
}

function updateEffect(ledger, effectId, updater) {
  const current = validateV2EffectLedger(ledger);
  const index = current.effects.findIndex((effect) => effect.effect_id === effectId);
  if (index < 0) {
    throw new Error("effect id is not reserved in the ledger");
  }
  const effects = structuredClone(current.effects);
  effects[index] = updater(effects[index], current);
  const { ledger_digest: _digest, ...base } = current;
  return sealLedger({ ...base, effects });
}

function sealLedger(value) {
  const sealed = {
    ...value,
    ledger_digest: digestCanonical("codex-review-gate-v2-effect-ledger", value),
  };
  validateV2EffectLedger(sealed);
  return deepFreeze(sealed);
}

function effectId(ledger, kind, key, payload) {
  return `v2-effect:${digestCanonical("codex-review-gate-v2-effect-id", {
    repository_node_id: ledger.repository_node_id,
    pull_request_node_id: ledger.pull_request_node_id,
    head_ref_oid: ledger.head_ref_oid,
    kind,
    idempotency_key: key,
    payload,
  }).slice("sha256:".length)}`;
}

async function persistExactLedger(persistLedger, ledger, phase) {
  const echo = await persistLedger(ledger, phase);
  const validated = validateV2EffectLedger(echo);
  if (
    validated.ledger_digest !== ledger.ledger_digest ||
    canonicalJson(validated) !== canonicalJson(ledger)
  ) {
    throw new Error(`${phase} ledger persistence did not echo the exact durable value`);
  }
}

function validateEffectForExecution(effect) {
  assertObject(effect, "effect");
  if (effect.schema !== V2_EFFECT_ATTEMPT_SCHEMA || effect.state !== "attempted") {
    throw new Error("effect transport accepts only a durably attempted v2 effect");
  }
  if (effect.retry_limit !== 0 || effect.network_uncertainty_policy !== "do-not-retry-or-reclaim") {
    throw new Error("effect transport accepts only consumed retry-zero effects");
  }
}

function normalizeRepository(value) {
  assertObject(value, "repository");
  exactKeys(value, ["owner", "name"], "repository");
  const part = /^[A-Za-z0-9_.-]{1,100}$/u;
  if (!part.test(value.owner) || !part.test(value.name)) {
    throw new TypeError("repository owner and name are not canonical GitHub path parts");
  }
  return { owner: value.owner, name: value.name };
}

function normalizeRestBase(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new TypeError("restBaseUrl must be an absolute HTTPS URL", { cause: error });
  }
  if (
    url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
    url.search !== "" || url.hash !== ""
  ) {
    throw new TypeError("restBaseUrl must be a credential-free HTTPS URL");
  }
  return url.href.replace(/\/$/u, "");
}

async function requestJson({
  fetchImpl,
  authorization,
  base,
  method,
  path,
  body,
  expectedStatus,
}) {
  const response = await fetchImpl(`${base}${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${authorization}`,
      "x-github-api-version": "2022-11-28",
      ...(body === null ? {} : { "content-type": "application/json" }),
    },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
  });
  if (response?.status !== expectedStatus) {
    throw new Error(`GitHub effect expected HTTP ${expectedStatus} and received ${response?.status}`);
  }
  const serverTime = githubServerTime(response.headers?.get?.("date"));
  const rawBody = await response.text();
  let data;
  try {
    data = JSON.parse(rawBody);
  } catch (error) {
    throw new Error("GitHub effect response is not exact JSON", { cause: error });
  }
  assertObject(data, "GitHub effect response");
  return {
    http_status: response.status,
    server_time: serverTime,
    raw_body: rawBody,
    data,
  };
}

async function requestJsonArray({
  fetchImpl,
  authorization,
  base,
  method,
  path,
  expectedStatus,
}) {
  const response = await fetchImpl(`${base}${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${authorization}`,
      "x-github-api-version": "2022-11-28",
    },
  });
  if (response?.status !== expectedStatus) {
    throw new Error(`GitHub ledger read expected HTTP ${expectedStatus} and received ${response?.status}`);
  }
  const serverTime = githubServerTime(response.headers?.get?.("date"));
  const rawBody = await response.text();
  let data;
  try {
    data = JSON.parse(rawBody);
  } catch (error) {
    throw new Error("GitHub ledger inventory is not exact JSON", { cause: error });
  }
  if (!Array.isArray(data)) {
    throw new TypeError("GitHub ledger inventory response must be an array");
  }
  return { http_status: response.status, server_time: serverTime, raw_body: rawBody, data };
}

async function findExactStatus({
  fetchImpl,
  authorization,
  base,
  repoPath,
  shaValue,
  statusId,
}) {
  let found = null;
  let foundCapture = null;
  for (let page = 1; page <= 10; page += 1) {
    const capture = await requestJsonArray({
      fetchImpl,
      authorization,
      base,
      method: "GET",
      path: `${repoPath}/commits/${shaValue}/statuses?per_page=100&page=${page}`,
      expectedStatus: 200,
    });
    for (const status of capture.data) {
      if (String(status.id) === String(statusId)) {
        if (found !== null) {
          throw new Error("exact status identity appears more than once in paginated history");
        }
        found = status;
        foundCapture = capture;
      }
    }
    if (capture.data.length < 100) {
      break;
    }
    if (page === 10) {
      throw new Error("exact status refetch exceeds the 1000-record safety limit");
    }
  }
  if (found === null) {
    throw new Error("created status is absent from exact paginated history");
  }
  return {
    status: found,
    server_time: foundCapture.server_time,
    raw_body_sha256: rawDigest(foundCapture.raw_body),
  };
}

async function refetchExactProductionStatus({
  fetchImpl,
  authorization,
  base,
  repoPath,
  write,
  status_id: statusId,
}) {
  const pages = [];
  let itemCount = 0;
  let matchCount = 0;
  let selected = null;
  for (let page = 1; page <= 10; page += 1) {
    const capture = await requestJsonArray({
      fetchImpl,
      authorization,
      base,
      method: "GET",
      path: `${repoPath}/commits/${write.target_sha}/statuses` +
        `?per_page=100&page=${page}`,
      expectedStatus: 200,
    });
    pages.push({
      page,
      http_status: capture.http_status,
      server_time: capture.server_time,
      raw_body_sha256: rawDigest(capture.raw_body),
      item_count: capture.data.length,
    });
    itemCount += capture.data.length;
    for (const status of capture.data) {
      if (String(status?.id) !== statusId) continue;
      matchCount += 1;
      selected = parseProductionStatusIdentity(status, write);
    }
    if (capture.data.length < 100) break;
    if (page === 10) {
      throw new Error(
        "production status refetch exceeds the 1000-record safety limit",
      );
    }
  }
  if (matchCount !== 1 || selected === null) {
    throw new Error(
      "production status identity is not unique in exact paginated history",
    );
  }
  return deepFreeze({
    status: selected,
    pages,
    item_count: itemCount,
    match_count: matchCount,
    refetch_server_time: pages.at(-1).server_time,
  });
}

function parseProductionStatusIdentity(value, write) {
  assertObject(value, "production status response");
  const statusId = String(positiveInteger(
    value.id,
    "production status response.id",
  ));
  if (
    value.sha !== write.target_sha || value.context !== write.context ||
    value.state !== write.state || value.description !== write.description
  ) {
    throw new Error(
      "production status response differs from its protected transport intent",
    );
  }
  assertObject(value.creator, "production status response.creator");
  const creator = {
    login: boundedString(
      value.creator.login,
      "production status response.creator.login",
      128,
    ),
    type: boundedString(
      value.creator.type,
      "production status response.creator.type",
      32,
    ),
  };
  if (creator.login !== "github-actions[bot]" || creator.type !== "Bot") {
    throw new Error("production status response has an untrusted creator");
  }
  return deepFreeze({
    status_id: statusId,
    target_sha: value.sha,
    context: value.context,
    state: value.state,
    description: value.description,
    created_at: timestamp(
      value.created_at,
      "production status response.created_at",
    ),
    updated_at: timestamp(
      value.updated_at,
      "production status response.updated_at",
    ),
    creator,
  });
}

function normalizeStatusCreator(value) {
  assertObject(value, "expected_creator");
  exactKeys(value, ["login", "type"], "expected_creator");
  return {
    login: boundedString(value.login, "expected_creator.login", 128),
    type: boundedString(value.type, "expected_creator.type", 32),
  };
}

function reservationStatusContext(ordinal) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > 3) {
    throw new TypeError("reservation ordinal must be from 1 through 3");
  }
  return `${V2_RESERVATION_STATUS_CONTEXT_PREFIX}${ordinal}`;
}

function validateReservationStatusInput(reservation, creator) {
  assertObject(reservation, "reservation");
  if (
    reservation.schema !== V2_REQUEST_RESERVATION_SCHEMA ||
    reservation.automatic !== true ||
    reservation.consumed !== true
  ) {
    throw new Error("reservation status requires an automatic consumed v2 reservation");
  }
  sha(reservation.epoch_head_sha, "reservation.epoch_head_sha");
  reservationStatusContext(reservation.ordinal);
  digest(reservation.reservation_digest, "reservation.reservation_digest");
  normalizeStatusCreator(creator);
}

function parseReservationStatus(status, head, creator, expected = null) {
  assertObject(status, "reservation status");
  const context = boundedString(status.context, "reservation status.context", 128);
  const ordinalText = context.slice(V2_RESERVATION_STATUS_CONTEXT_PREFIX.length);
  if (!/^[1-3]$/u.test(ordinalText)) {
    throw new Error("reservation status context has an invalid ordinal");
  }
  const ordinal = Number(ordinalText);
  const reservationDigest = digest(
    status.description,
    "reservation status.description",
  );
  if (
    status.state !== "pending" ||
    status.sha !== head ||
    status.creator?.login !== creator.login ||
    status.creator?.type !== creator.type
  ) {
    throw new Error("reservation status has the wrong state, head, or trusted creator");
  }
  if (
    expected !== null &&
    (expected.ordinal !== ordinal || expected.reservation_digest !== reservationDigest)
  ) {
    throw new Error("reservation status response does not echo its ordinal and digest");
  }
  return {
    status_id: String(positiveInteger(status.id, "reservation status.id")),
    head_ref_oid: head,
    ordinal,
    reservation_digest: reservationDigest,
    creator: { ...creator },
    created_at: timestamp(status.created_at, "reservation status.created_at"),
    updated_at: timestamp(status.updated_at, "reservation status.updated_at"),
  };
}

function normalizeTrustedActor(value) {
  assertObject(value, "trusted_actor");
  exactKeys(value, ["login", "type", "app_slug"], "trusted_actor");
  return {
    login: boundedString(value.login, "trusted_actor.login", 128),
    type: boundedString(value.type, "trusted_actor.type", 32),
    app_slug: boundedString(value.app_slug, "trusted_actor.app_slug", 128),
  };
}

function assertTrustedLedgerActor(comment, actor) {
  assertObject(comment, "ledger comment");
  if (
    comment.user?.login !== actor.login ||
    comment.user?.type !== actor.type ||
    comment.performed_via_github_app?.slug !== actor.app_slug
  ) {
    throw new Error("controller ledger comment is not authored by the trusted workflow App");
  }
}

function ledgerScope(ledger) {
  return {
    repository_node_id: ledger.repository_node_id,
    pull_request_node_id: ledger.pull_request_node_id,
    head_ref_oid: ledger.head_ref_oid,
  };
}

function normalizeLedgerScope(value) {
  assertObject(value, "ledger scope");
  exactKeys(
    value,
    ["repository_node_id", "pull_request_node_id", "head_ref_oid"],
    "ledger scope",
  );
  return {
    repository_node_id: boundedString(value.repository_node_id, "repository_node_id", 256),
    pull_request_node_id: boundedString(value.pull_request_node_id, "pull_request_node_id", 256),
    head_ref_oid: sha(value.head_ref_oid, "head_ref_oid"),
  };
}

function sameLedgerScope(ledger, scope) {
  return ledger.repository_node_id === scope.repository_node_id &&
    ledger.pull_request_node_id === scope.pull_request_node_id &&
    ledger.head_ref_oid === scope.head_ref_oid;
}

function assertLedgerSuccessor(previous, next) {
  validateV2EffectLedger(previous);
  validateV2EffectLedger(next);
  if (
    !sameLedgerScope(next, ledgerScope(previous)) ||
    next.created_at !== previous.created_at ||
    next.effects.length < previous.effects.length ||
    next.effects.length > previous.effects.length + 1
  ) {
    throw new Error("controller ledger update is not a monotonic single-effect successor");
  }
  const stateRank = { reserved: 0, attempted: 1, bound: 2 };
  for (const [index, oldEffect] of previous.effects.entries()) {
    const newEffect = next.effects[index];
    const staticOld = {
      ...oldEffect,
      state: null,
      attempted_at: null,
      response: null,
    };
    const staticNew = {
      ...newEffect,
      state: null,
      attempted_at: null,
      response: null,
    };
    if (canonicalJson(staticOld) !== canonicalJson(staticNew)) {
      throw new Error("controller ledger update changed an existing effect identity or payload");
    }
    if (stateRank[newEffect.state] < stateRank[oldEffect.state]) {
      throw new Error("controller ledger update regressed an effect state");
    }
    if (oldEffect.state === "attempted" && newEffect.state === "bound" &&
        newEffect.attempted_at !== oldEffect.attempted_at) {
      throw new Error("controller ledger update changed the durable attempt time");
    }
    if (oldEffect.state === "bound" && canonicalJson(oldEffect) !== canonicalJson(newEffect)) {
      throw new Error("controller ledger update changed an already bound effect");
    }
  }
}

function githubServerTime(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("GitHub effect response is missing its Date header");
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new Error("GitHub effect response Date header is invalid");
  }
  return new Date(milliseconds).toISOString();
}

function parseStatusResponse(value, expected) {
  assertObject(value, "status response");
  const id = String(positiveInteger(value.id, "status response.id"));
  if (
    value.state !== expected.state ||
    value.context !== expected.context ||
    value.sha !== expected.sha
  ) {
    throw new Error("status response does not echo the reserved SHA, context, and state");
  }
  return {
    sha: value.sha,
    context: value.context,
    state: value.state,
    id,
  };
}

function parseCommentIdentity(value, expectedBody) {
  assertObject(value, "comment response");
  const id = String(positiveInteger(value.id, "comment response.id"));
  if (value.body !== expectedBody) {
    throw new Error("comment response body differs from the reserved exact body");
  }
  return {
    comment_id: id,
    comment_node_id: boundedString(value.node_id, "comment response.node_id", 256),
    body_sha256: rawDigest(value.body),
  };
}

function positiveInteger(value, label) {
  const number = typeof value === "string" && /^[1-9][0-9]*$/u.test(value)
    ? Number(value)
    : value;
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return number;
}

function positiveDecimalString(value, label) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) {
    throw new TypeError(`${label} must be a positive canonical decimal string`);
  }
  return value;
}

function rawDigest(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function gitLedgerDigestCanonical(domain, value) {
  return rawDigest(`${domain}\0${canonicalJson(value)}`);
}

function digestCanonical(domain, value) {
  const bytes = canonicalJson(value);
  return `sha256:${createHash("sha256")
    .update(`${Buffer.byteLength(domain, "utf8")}:${domain}\0`, "utf8")
    .update(`${Buffer.byteLength(bytes, "utf8")}:${bytes}`, "utf8")
    .digest("hex")}`;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function exactKeys(value, keys, label) {
  assertObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must use the closed key set: ${expected.join(", ")}`);
  }
}

function assertObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function boundedString(value, label, maximum) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new TypeError(`${label} must be a non-empty bounded string`);
  }
  return value;
}

function sha(value, label) {
  if (typeof value !== "string" || !SHA.test(value)) {
    throw new TypeError(`${label} must be a lowercase full SHA`);
  }
  return value;
}

function digest(value, label, { allowPrefixedKey = false } = {}) {
  if (allowPrefixedKey) {
    const suffix = String(value).split(":").at(-1);
    if (!/^[0-9a-f]{64}$/u.test(suffix ?? "")) {
      throw new TypeError(`${label} must end in a lowercase SHA-256 digest`);
    }
    return value;
  }
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function timestamp(value, label) {
  if (typeof value !== "string" || !STRICT_UTC_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${label} must be a strict UTC timestamp`);
  }
  return value;
}

function enumValue(value, allowed, label) {
  if (!allowed.has(value)) {
    throw new TypeError(`${label} is not a closed value`);
  }
  return value;
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
