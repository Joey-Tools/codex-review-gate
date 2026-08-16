import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const V2_WORKFLOW_COMMAND_SCHEMA = "codex-review-gate-workflow-command-v2";
export const V2_WORKFLOW_COMMAND_VERSION = 1;
export const MAX_V2_WORKFLOW_COMMAND_BYTES = 1024 * 1024;
export const MAX_V2_WORKFLOW_EVENT_BYTES = 25 * 1024 * 1024;
export const MAX_V2_WORKFLOW_DISPATCH_BINDING_BYTES = 4096;
export const V2_WORKFLOW_RECEIPT_SOURCE = "trusted-reusable-workflow";
export const V2_WORKFLOW_PATH = ".github/workflows/codex-review-gate.yml";
export const V2_STATUS_CONTEXT = "codex/github-review-gate";
export const V2_STATUS_TARGET_MODE = "test-merge-with-head-sentinel";
export const V2_SERVER_ENFORCEMENT_POLICY = "live-github-api-required";
export const V2_PUBLIC_WAIT_POLICY =
  "live-github-environment-api-required-for-public";
export const V2_SELECTION_POLICIES = Object.freeze([
  "joey-default",
  "required-infrastructure-only",
  "user-explicit",
  "legacy-triple",
  "disabled",
]);

export const V2_CONTROLLER_ROUTES = Object.freeze([
  "ordinary",
  "evaluate-only",
  "provider-event-hint",
  "scan-all-open",
]);
export const V2_OBSERVATION_BOUNDARIES = Object.freeze([
  "initial",
  "public-initial-wait-complete",
  "public-post-request-wait-complete",
  "public-no-start-wait-complete",
  "private-reconcile",
]);

const CONTROLLER_ROUTE_SET = new Set(V2_CONTROLLER_ROUTES);
const OBSERVATION_BOUNDARY_SET = new Set(V2_OBSERVATION_BOUNDARIES);
const OPERATION_SET = new Set(["ordinary", "evaluate-only"]);
const TRIGGER_SET = new Set([
  "initial",
  "timer",
  "provider-event",
  "schedule",
  "manual",
]);
const PROVIDER_EVENT_NAMES = new Set([
  "issue_comment",
  "pull_request_review",
  "pull_request_review_comment",
]);
const SUPPORTED_EVENT_NAMES = new Set([
  "pull_request_target",
  "workflow_dispatch",
  "schedule",
  ...PROVIDER_EVENT_NAMES,
]);
const REPOSITORY_PART = /^[A-Za-z0-9_.-]{1,100}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const POSITIVE_DECIMAL = /^[1-9][0-9]{0,31}$/u;
const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const CANDIDATE_CYCLE_ID = /^candidate-cycle:[0-9a-f]{64}$/u;
const CANDIDATE_SOURCE_GENERATION_ID =
  /^candidate-source:[0-9a-f]{64}$/u;
const CANDIDATE_LIFECYCLE_GENERATION_ID =
  /^candidate-lifecycle:[0-9a-f]{64}$/u;
const CANDIDATE_DISPATCH_GENERATION_ID =
  /^candidate-dispatch:[0-9a-f]{64}$/u;
const V2_CANDIDATE_DISPATCH_BINDING_SCHEMA =
  "codex-review-gate-git-ledger-candidate-dispatch-binding-v2";
const V2_CANDIDATE_DISPATCH_SOURCE_SCHEMA =
  "codex-review-gate-git-ledger-candidate-dispatch-source-v2";
const V2_CANDIDATE_DISPATCH_SELECTION_SCHEMA =
  "codex-review-gate-git-ledger-candidate-dispatch-selection-v2";
const V2_CURRENT_OPEN_SOURCE_PROFILE = "stable-graphql-current-open-v4";
const MAX_V2_CANDIDATE_DISPATCH_ITEMS = 64;
const MAX_V2_CANDIDATE_DISPATCH_BATCHES = 8;
const TIMESTAMP =
  /^(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.(\d{1,3}))?Z$/u;
const CREATE_FLAGS = constants.O_CREAT | constants.O_EXCL | constants.O_RDWR |
  (constants.O_NOFOLLOW ?? 0);
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
const WORKFLOW_COMMAND_HANDLES = new WeakSet();

/**
 * Publish one controller command from trusted workflow environment values.
 * The event file is advisory: it supplies only a digest and cross-checks the
 * already-selected route and pull-request number.
 */
export async function prepareV2WorkflowCommand(environment = process.env) {
  const eventEvidence = await readAdvisoryEvent(environment);
  const repository = parseRepository(
    requiredEnvironment(environment, "GITHUB_REPOSITORY"),
    "GITHUB_REPOSITORY",
  );
  const pullRequestNumber = parseOptionalPullRequest(
    environment?.V2_CONTROLLER_PULL_REQUEST ?? "",
    "V2_CONTROLLER_PULL_REQUEST",
  );
  const route = deriveRoute(environment, pullRequestNumber);
  const dispatchBinding = readDispatchBindingEnvironment(environment, {
    route,
    pullRequestNumber,
  });
  const expectedWorkflowRepository = parseRepository(
    requiredEnvironment(environment, "V2_EXPECTED_WORKFLOW_REPOSITORY"),
    "V2_EXPECTED_WORKFLOW_REPOSITORY",
  );
  const actualWorkflowRepository = parseRepository(
    requiredEnvironment(environment, "V2_ACTUAL_WORKFLOW_REPOSITORY"),
    "V2_ACTUAL_WORKFLOW_REPOSITORY",
  );
  if (canonicalJson(expectedWorkflowRepository) !==
      canonicalJson(actualWorkflowRepository)) {
    throw new Error("called workflow repository does not match its trusted expectation");
  }
  const revision = sha(
    requiredEnvironment(environment, "V2_EXPECTED_WORKFLOW_SHA"),
    "V2_EXPECTED_WORKFLOW_SHA",
  );
  const checkoutSha = sha(
    requiredEnvironment(environment, "V2_CHECKED_OUT_RELEASE_SHA"),
    "V2_CHECKED_OUT_RELEASE_SHA",
  );
  if (revision !== checkoutSha) {
    throw new Error("called workflow revision does not match the checked-out release");
  }
  const workflowPath = requiredEnvironment(environment, "V2_EXPECTED_WORKFLOW_PATH");
  if (workflowPath !== V2_WORKFLOW_PATH) {
    throw new Error(`called workflow path must be exactly ${V2_WORKFLOW_PATH}`);
  }
  const callerRepository = `${repository.owner}/${repository.name}`;
  const callerWorkflowRef = validateCallerWorkflowRef(
    requiredEnvironment(environment, "GITHUB_WORKFLOW_REF"),
    callerRepository,
  );
  const callerWorkflowSha = sha(
    requiredEnvironment(environment, "GITHUB_WORKFLOW_SHA"),
    "GITHUB_WORKFLOW_SHA",
  );
  const selectionPolicy = enumValue(
    requiredEnvironment(environment, "V2_SELECTION_POLICY"),
    new Set(V2_SELECTION_POLICIES),
    "V2_SELECTION_POLICY",
  );
  requireFixedEnvironment(environment);

  const command = {
    schema: V2_WORKFLOW_COMMAND_SCHEMA,
    schema_version: V2_WORKFLOW_COMMAND_VERSION,
    command: "run",
    repository,
    pull_request: { number: pullRequestNumber },
    dispatch_binding: dispatchBinding,
    selection_policy: selectionPolicy,
    route,
    invocation: {
      event_name: requiredEnvironment(environment, "GITHUB_EVENT_NAME"),
      event_payload_sha256: eventEvidence.digest,
      run_id: positiveDecimal(
        requiredEnvironment(environment, "GITHUB_RUN_ID"),
        "GITHUB_RUN_ID",
      ),
      run_attempt: positiveIntegerFromText(
        requiredEnvironment(environment, "GITHUB_RUN_ATTEMPT"),
        "GITHUB_RUN_ATTEMPT",
      ),
      actor_id: positiveDecimal(
        requiredEnvironment(environment, "GITHUB_ACTOR_ID"),
        "GITHUB_ACTOR_ID",
      ),
    },
    workflow_receipt: {
      present: true,
      compatible: true,
      source: V2_WORKFLOW_RECEIPT_SOURCE,
      repository: `${expectedWorkflowRepository.owner}/${expectedWorkflowRepository.name}`,
      path: workflowPath,
      revision,
      checkout_sha: checkoutSha,
      caller_repository: callerRepository,
      caller_workflow_ref: callerWorkflowRef,
      caller_workflow_sha: callerWorkflowSha,
      status_context: V2_STATUS_CONTEXT,
      status_target_mode: V2_STATUS_TARGET_MODE,
    },
    receipt_policy: {
      server_enforcement: V2_SERVER_ENFORCEMENT_POLICY,
      public_wait: V2_PUBLIC_WAIT_POLICY,
    },
  };
  validateV2WorkflowCommand(command, environment, eventEvidence);

  const destination = await resolveControllerPath(environment);
  const bytes = Buffer.from(`${canonicalJson(command)}\n`, "utf8");
  if (bytes.length > MAX_V2_WORKFLOW_COMMAND_BYTES) {
    throw new Error("workflow command exceeds the bounded file size");
  }
  await writeProtectedNewFile(destination, bytes, "workflow command");

  // Re-read both the command and advisory event through protected descriptors.
  // This also catches an event replacement between construction and publish.
  return readV2WorkflowCommand(environment);
}

/** Read and fully revalidate a controller command from RUNNER_TEMP. */
export async function readV2WorkflowCommand(environment = process.env) {
  const inputPath = await resolveControllerPath(environment);
  const bytes = await readProtectedFile(inputPath, {
    label: "workflow command",
    maxBytes: MAX_V2_WORKFLOW_COMMAND_BYTES,
    requireMode: 0o600,
  });
  const text = decodeUtf8(bytes, "workflow command");
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error("workflow command is not exact JSON", { cause: error });
  }
  if (text !== `${canonicalJson(value)}\n`) {
    throw new Error("workflow command must be canonical sorted compact JSON with one LF");
  }
  const eventEvidence = await readAdvisoryEvent(environment);
  const command = validateV2WorkflowCommand(value, environment, eventEvidence);
  WORKFLOW_COMMAND_HANDLES.add(command);
  return command;
}

/**
 * Return the canonical digest of a command read through the protected command
 * and event descriptors. Structural clones and caller-constructed commands do
 * not acquire this authority.
 */
export function digestV2WorkflowCommand(command) {
  assertV2WorkflowCommandHandle(command);
  return `sha256:${createHash("sha256")
    .update(
      `codex-review-gate-v2-workflow-command\0${canonicalJson(command)}`,
      "utf8",
    )
    .digest("hex")}`;
}

export function assertV2WorkflowCommandHandle(command) {
  if ((typeof command !== "object" || command === null) ||
      !WORKFLOW_COMMAND_HANDLES.has(command)) {
    throw new Error(
      "workflow command authority requires a protected descriptor-backed command",
    );
  }
  return command;
}

/** Validate the closed command schema without granting command authority. */
export function validateV2WorkflowCommandStructure(value) {
  assertPlainObject(value, "workflow command");
  exactKeys(value, [
    "schema",
    "schema_version",
    "command",
    "repository",
    "pull_request",
    "dispatch_binding",
    "selection_policy",
    "route",
    "invocation",
    "workflow_receipt",
    "receipt_policy",
  ], "workflow command");
  if (value.schema !== V2_WORKFLOW_COMMAND_SCHEMA ||
      value.schema_version !== V2_WORKFLOW_COMMAND_VERSION || value.command !== "run") {
    throw new Error("workflow command has an unsupported schema, version, or command");
  }

  const repository = validateRepository(value.repository, "workflow command.repository");
  assertPlainObject(value.pull_request, "workflow command.pull_request");
  exactKeys(value.pull_request, ["number"], "workflow command.pull_request");
  const pullRequestNumber = optionalPositiveInteger(
    value.pull_request.number,
    "workflow command.pull_request.number",
  );
  enumValue(
    value.selection_policy,
    new Set(V2_SELECTION_POLICIES),
    "workflow command.selection_policy",
  );

  assertPlainObject(value.route, "workflow command.route");
  exactKeys(
    value.route,
    ["operation", "trigger", "observation_boundary"],
    "workflow command.route",
  );
  enumValue(value.route.operation, OPERATION_SET, "workflow command.route.operation");
  enumValue(value.route.trigger, TRIGGER_SET, "workflow command.route.trigger");
  enumValue(
    value.route.observation_boundary,
    OBSERVATION_BOUNDARY_SET,
    "workflow command.route.observation_boundary",
  );

  assertPlainObject(value.invocation, "workflow command.invocation");
  exactKeys(value.invocation, [
    "event_name",
    "event_payload_sha256",
    "run_id",
    "run_attempt",
    "actor_id",
  ], "workflow command.invocation");
  const eventName = enumValue(
    value.invocation.event_name,
    SUPPORTED_EVENT_NAMES,
    "workflow command.invocation.event_name",
  );
  digest(value.invocation.event_payload_sha256,
    "workflow command.invocation.event_payload_sha256");
  positiveDecimal(value.invocation.run_id,
    "workflow command.invocation.run_id");
  positiveSafeInteger(value.invocation.run_attempt,
    "workflow command.invocation.run_attempt");
  positiveDecimal(value.invocation.actor_id,
    "workflow command.invocation.actor_id");

  validateWorkflowReceiptStructure(value.workflow_receipt, repository);
  validateReceiptPolicy(value.receipt_policy);
  const dispatchBinding = value.dispatch_binding === null
    ? null
    : validateDispatchBinding(value.dispatch_binding);
  validateClosedCommandRelationship({
    eventName,
    pullRequestNumber,
    repository,
    route: value.route,
    dispatchBinding,
  });

  return deepFreeze({
    ...structuredClone(value),
    repository,
    pull_request: { number: pullRequestNumber },
    dispatch_binding: dispatchBinding,
  });
}

/**
 * Validate the closed command schema and every trusted-environment binding.
 * Public callers normally use prepare/read, which also provide event evidence.
 */
export function validateV2WorkflowCommand(
  value,
  environment = process.env,
  eventEvidence = null,
) {
  const command = validateV2WorkflowCommandStructure(value);
  const environmentRepository = parseRepository(
    requiredEnvironment(environment, "GITHUB_REPOSITORY"),
    "GITHUB_REPOSITORY",
  );
  if (canonicalJson(command.repository) !== canonicalJson(environmentRepository)) {
    throw new Error("workflow command repository does not match GITHUB_REPOSITORY");
  }

  const environmentPullRequest = parseOptionalPullRequest(
    environment?.V2_CONTROLLER_PULL_REQUEST ?? "",
    "V2_CONTROLLER_PULL_REQUEST",
  );
  if (command.pull_request.number !== environmentPullRequest) {
    throw new Error("workflow command pull request does not match its trusted selector");
  }
  if (command.selection_policy !==
      requiredEnvironment(environment, "V2_SELECTION_POLICY")) {
    throw new Error("workflow command selection policy does not match its trusted input");
  }

  const expectedRoute = deriveRoute(environment, environmentPullRequest);
  if (canonicalJson(command.route) !== canonicalJson(expectedRoute)) {
    throw new Error("workflow command route does not match its closed trusted mapping");
  }
  const expectedDispatchBinding = readDispatchBindingEnvironment(environment, {
    route: expectedRoute,
    pullRequestNumber: environmentPullRequest,
  });
  if (canonicalJson(command.dispatch_binding) !==
      canonicalJson(expectedDispatchBinding)) {
    throw new Error(
      "workflow command dispatch binding does not match its exact trusted environment bytes",
    );
  }

  const eventName = command.invocation.event_name;
  if (eventName !== requiredEnvironment(environment, "GITHUB_EVENT_NAME")) {
    throw new Error("workflow command event name does not match GITHUB_EVENT_NAME");
  }
  const runId = command.invocation.run_id;
  const runAttempt = command.invocation.run_attempt;
  const actorId = command.invocation.actor_id;
  if (
    runId !== positiveDecimal(requiredEnvironment(environment, "GITHUB_RUN_ID"),
      "GITHUB_RUN_ID") ||
    runAttempt !== positiveIntegerFromText(
      requiredEnvironment(environment, "GITHUB_RUN_ATTEMPT"),
      "GITHUB_RUN_ATTEMPT",
    ) ||
    actorId !== positiveDecimal(requiredEnvironment(environment, "GITHUB_ACTOR_ID"),
      "GITHUB_ACTOR_ID")
  ) {
    throw new Error("workflow command invocation does not match the trusted run identity");
  }

  validateWorkflowReceipt(command.workflow_receipt, environment);
  requireFixedEnvironment(environment);

  if (eventEvidence !== null) {
    validateEventEvidence(eventEvidence);
    if (command.invocation.event_payload_sha256 !== eventEvidence.digest) {
      throw new Error("workflow command does not bind the current advisory event bytes");
    }
    validateAdvisoryEventSelector({
      eventName,
      event: eventEvidence.event,
      pullRequestNumber: command.pull_request.number,
      controllerRoute: requiredEnvironment(environment, "V2_CONTROLLER_ROUTE"),
    });
  }

  return command;
}

function deriveRoute(environment, pullRequestNumber) {
  const controllerRoute = enumValue(
    requiredEnvironment(environment, "V2_CONTROLLER_ROUTE"),
    CONTROLLER_ROUTE_SET,
    "V2_CONTROLLER_ROUTE",
  );
  const observationBoundary = enumValue(
    requiredEnvironment(environment, "V2_CONTROLLER_OBSERVATION_BOUNDARY"),
    OBSERVATION_BOUNDARY_SET,
    "V2_CONTROLLER_OBSERVATION_BOUNDARY",
  );
  const eventName = enumValue(
    requiredEnvironment(environment, "GITHUB_EVENT_NAME"),
    SUPPORTED_EVENT_NAMES,
    "GITHUB_EVENT_NAME",
  );

  if (controllerRoute === "evaluate-only") {
    if (eventName !== "workflow_dispatch" || observationBoundary !== "initial" ||
        pullRequestNumber === null) {
      throw new Error(
        "evaluate-only requires an initial workflow_dispatch with one explicit pull request",
      );
    }
    return {
      operation: "evaluate-only",
      trigger: "manual",
      observation_boundary: observationBoundary,
    };
  }
  if (controllerRoute === "scan-all-open") {
    if (eventName !== "schedule" || observationBoundary !== "initial" ||
        pullRequestNumber !== null) {
      throw new Error(
        "scan-all-open requires an initial schedule event without a pull-request selector",
      );
    }
    return {
      operation: "ordinary",
      trigger: "schedule",
      observation_boundary: observationBoundary,
    };
  }
  if (controllerRoute === "provider-event-hint") {
    if (!PROVIDER_EVENT_NAMES.has(eventName) || observationBoundary !== "initial" ||
        pullRequestNumber === null) {
      throw new Error(
        "provider-event-hint requires an initial provider event with one pull request",
      );
    }
    return {
      operation: "ordinary",
      trigger: "provider-event",
      observation_boundary: observationBoundary,
    };
  }

  if (pullRequestNumber === null) {
    throw new Error("ordinary controller runs require one explicit pull request");
  }
  if (observationBoundary !== "initial") {
    return {
      operation: "ordinary",
      trigger: "timer",
      observation_boundary: observationBoundary,
    };
  }
  if (eventName === "pull_request_target") {
    return {
      operation: "ordinary",
      trigger: "initial",
      observation_boundary: observationBoundary,
    };
  }
  if (eventName === "schedule") {
    return {
      operation: "ordinary",
      trigger: "schedule",
      observation_boundary: observationBoundary,
    };
  }
  throw new Error("initial event must use its matching closed controller route");
}

function validateClosedCommandRelationship({
  eventName,
  pullRequestNumber,
  repository,
  route,
  dispatchBinding,
}) {
  let valid = false;
  if (route.operation === "evaluate-only") {
    valid = route.trigger === "manual" &&
      route.observation_boundary === "initial" &&
      eventName === "workflow_dispatch" && pullRequestNumber !== null;
  } else if (route.trigger === "schedule") {
    valid = route.observation_boundary === "initial" &&
      eventName === "schedule";
  } else if (route.trigger === "provider-event") {
    valid = route.observation_boundary === "initial" &&
      PROVIDER_EVENT_NAMES.has(eventName) && pullRequestNumber !== null;
  } else if (route.trigger === "initial") {
    valid = route.observation_boundary === "initial" &&
      eventName === "pull_request_target" && pullRequestNumber !== null;
  } else if (route.trigger === "timer") {
    valid = route.observation_boundary !== "initial" &&
      pullRequestNumber !== null;
  }
  if (!valid) {
    throw new Error(
      "workflow command event, route, boundary, and pull-request selector are inconsistent",
    );
  }

  const required = isScheduledDispatchLeg(route, pullRequestNumber);
  if (required && dispatchBinding === null) {
    throw new Error(
      "scheduled pull-request command requires one dispatch binding",
    );
  }
  if (!required && dispatchBinding !== null) {
    throw new Error(
      "workflow command dispatch binding must be null outside scheduled pull-request legs",
    );
  }
  if (dispatchBinding !== null &&
      dispatchCandidateNumber(dispatchBinding.candidate) !==
        pullRequestNumber) {
    throw new Error(
      "dispatch binding candidate does not match the trusted pull-request selector",
    );
  }
  if (dispatchBinding?.schema_version === 2 &&
      (dispatchBinding.repository.owner !== repository.owner ||
        dispatchBinding.repository.name !== repository.name)) {
    throw new Error(
      "dispatch binding repository does not match the workflow command repository",
    );
  }
}

function isScheduledDispatchLeg(route, pullRequestNumber) {
  return route.operation === "ordinary" && route.trigger === "schedule" &&
    route.observation_boundary === "initial" && pullRequestNumber !== null;
}

function readDispatchBindingEnvironment(environment, {
  route,
  pullRequestNumber,
}) {
  const raw = environment?.V2_CONTROLLER_DISPATCH_BINDING;
  if (typeof raw !== "string") {
    throw new TypeError(
      "V2_CONTROLLER_DISPATCH_BINDING must be one bounded environment string",
    );
  }
  if (Buffer.byteLength(raw, "utf8") >
      MAX_V2_WORKFLOW_DISPATCH_BINDING_BYTES) {
    throw new TypeError(
      "V2_CONTROLLER_DISPATCH_BINDING exceeds its 4096-byte bound",
    );
  }
  if (raw.includes("\0") || raw.includes("\r") || raw.includes("\n")) {
    throw new TypeError(
      "V2_CONTROLLER_DISPATCH_BINDING must not contain NUL, CR, or LF",
    );
  }

  const required = isScheduledDispatchLeg(route, pullRequestNumber);
  if (!required) {
    if (raw !== "") {
      throw new Error(
        "controller dispatch binding environment must be empty outside scheduled pull-request legs",
      );
    }
    return null;
  }
  if (raw === "") {
    throw new Error("scheduled pull-request command requires one dispatch binding");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      "V2_CONTROLLER_DISPATCH_BINDING is not exact JSON",
      { cause: error },
    );
  }
  if (raw !== canonicalJson(parsed)) {
    throw new Error(
      "V2_CONTROLLER_DISPATCH_BINDING must be canonical sorted compact JSON",
    );
  }
  const binding = validateDispatchBinding(parsed);
  if (dispatchCandidateNumber(binding.candidate) !== pullRequestNumber) {
    throw new Error(
      "dispatch binding candidate does not match the trusted pull-request selector",
    );
  }
  return binding;
}

function validateDispatchBinding(value) {
  assertPlainObject(value, "workflow command.dispatch_binding");
  if (value.schema_version === 2) {
    return validateCurrentOpenDispatchBinding(value);
  }
  exactKeys(value, [
    "generation_id",
    "cycle_id",
    "inventory_digest",
    "batch_index",
    "batch_count",
    "dispatch_digest",
    "candidate",
  ], "workflow command.dispatch_binding");
  if (typeof value.generation_id !== "string" ||
      !CANDIDATE_DISPATCH_GENERATION_ID.test(value.generation_id)) {
    throw new TypeError(
      "workflow command.dispatch_binding.generation_id is invalid",
    );
  }
  if (typeof value.cycle_id !== "string" ||
      !CANDIDATE_CYCLE_ID.test(value.cycle_id)) {
    throw new TypeError("workflow command.dispatch_binding.cycle_id is invalid");
  }
  digest(value.inventory_digest,
    "workflow command.dispatch_binding.inventory_digest");
  const batchIndex = nonnegativeSafeInteger(
    value.batch_index,
    "workflow command.dispatch_binding.batch_index",
  );
  const batchCount = positiveSafeInteger(
    value.batch_count,
    "workflow command.dispatch_binding.batch_count",
  );
  if (batchIndex >= batchCount ||
      batchCount > MAX_V2_CANDIDATE_DISPATCH_BATCHES) {
    throw new Error("workflow command dispatch binding batch identity is invalid");
  }
  digest(value.dispatch_digest,
    "workflow command.dispatch_binding.dispatch_digest");

  assertPlainObject(value.candidate,
    "workflow command.dispatch_binding.candidate");
  exactKeys(value.candidate, [
    "id",
    "node_id",
    "number",
    "created_at",
    "head_ref_oid",
    "base_ref_oid",
    "observation_server_time",
    "observation_raw_body_sha256",
  ], "workflow command.dispatch_binding.candidate");
  decimal(value.candidate.id,
    "workflow command.dispatch_binding.candidate.id");
  boundedNonemptyString(value.candidate.node_id,
    "workflow command.dispatch_binding.candidate.node_id", 256);
  positiveSafeInteger(value.candidate.number,
    "workflow command.dispatch_binding.candidate.number");
  ledgerTimestamp(value.candidate.created_at,
    "workflow command.dispatch_binding.candidate.created_at");
  sha(value.candidate.head_ref_oid,
    "workflow command.dispatch_binding.candidate.head_ref_oid");
  sha(value.candidate.base_ref_oid,
    "workflow command.dispatch_binding.candidate.base_ref_oid");
  ledgerTimestamp(value.candidate.observation_server_time,
    "workflow command.dispatch_binding.candidate.observation_server_time");
  digest(value.candidate.observation_raw_body_sha256,
    "workflow command.dispatch_binding.candidate.observation_raw_body_sha256");

  return deepFreeze(structuredClone(value));
}

function validateCurrentOpenDispatchBinding(value) {
  const label = "workflow command.dispatch_binding";
  exactKeys(value, [
    "schema",
    "schema_version",
    "repository",
    "generation_id",
    "cycle_id",
    "candidate_source",
    "candidate_inventory_authority_digest",
    "candidate_dispatch_authority_digest",
    "inventory_digest",
    "reservation_record_oid",
    "reservation_digest",
    "dispatch_digest",
    "batch_index",
    "batch_count",
    "candidate_index",
    "candidate",
    "binding_digest",
  ], label);
  if (value.schema !== V2_CANDIDATE_DISPATCH_BINDING_SCHEMA ||
      value.schema_version !== 2 ||
      typeof value.generation_id !== "string" ||
      !CANDIDATE_DISPATCH_GENERATION_ID.test(value.generation_id) ||
      typeof value.cycle_id !== "string" ||
      !CANDIDATE_CYCLE_ID.test(value.cycle_id)) {
    throw new TypeError(`${label} schema or generation is invalid`);
  }

  const repository = validateDispatchRepository(
    value.repository,
    `${label}.repository`,
  );
  const candidateSource = validateCurrentOpenDispatchSource(
    value.candidate_source,
    `${label}.candidate_source`,
  );
  const candidate = validateCurrentOpenDispatchCandidate(
    value.candidate,
    `${label}.candidate`,
  );
  if (candidate.source_generation_record_oid !==
      candidateSource.source_generation_record_oid) {
    throw new Error(`${label} changes its source generation`);
  }
  if (candidate.lifecycle_generation_id !==
      currentOpenLifecycleGenerationId(
        repository,
        candidate.identity_digest,
      )) {
    throw new Error(`${label} changes its lifecycle identity`);
  }

  const batchIndex = nonnegativeSafeInteger(
    value.batch_index,
    `${label}.batch_index`,
  );
  const batchCount = positiveSafeInteger(
    value.batch_count,
    `${label}.batch_count`,
  );
  const candidateIndex = nonnegativeSafeInteger(
    value.candidate_index,
    `${label}.candidate_index`,
  );
  if (candidateIndex >= MAX_V2_CANDIDATE_DISPATCH_ITEMS ||
      batchIndex >= batchCount ||
      batchCount > MAX_V2_CANDIDATE_DISPATCH_BATCHES) {
    throw new Error(`${label} batch identity is invalid`);
  }

  for (const [field, fieldLabel] of [
    [value.candidate_inventory_authority_digest, "candidate authority"],
    [value.candidate_dispatch_authority_digest, "dispatch authority"],
    [value.inventory_digest, "inventory"],
    [value.reservation_digest, "reservation"],
    [value.dispatch_digest, "dispatch"],
    [value.binding_digest, "binding"],
  ]) {
    digest(field, `${label} ${fieldLabel} digest`);
  }
  sha(value.reservation_record_oid, `${label}.reservation_record_oid`);

  const normalized = {
    schema: V2_CANDIDATE_DISPATCH_BINDING_SCHEMA,
    schema_version: 2,
    repository,
    generation_id: value.generation_id,
    cycle_id: value.cycle_id,
    candidate_source: candidateSource,
    candidate_inventory_authority_digest:
      value.candidate_inventory_authority_digest,
    candidate_dispatch_authority_digest:
      value.candidate_dispatch_authority_digest,
    inventory_digest: value.inventory_digest,
    reservation_record_oid: value.reservation_record_oid,
    reservation_digest: value.reservation_digest,
    dispatch_digest: value.dispatch_digest,
    batch_index: batchIndex,
    batch_count: batchCount,
    candidate_index: candidateIndex,
    candidate,
  };
  if (value.binding_digest !== ledgerDigestCanonical(
    "codex-review-gate-v2-current-open-candidate-dispatch-binding",
    normalized,
  )) {
    throw new Error(`${label}.binding_digest is invalid`);
  }
  if (Buffer.byteLength(canonicalJson(value), "utf8") >
      MAX_V2_WORKFLOW_DISPATCH_BINDING_BYTES) {
    throw new TypeError(`${label} exceeds its 4096-byte bound`);
  }
  return deepFreeze({
    ...normalized,
    binding_digest: value.binding_digest,
  });
}

function validateDispatchRepository(value, label) {
  assertPlainObject(value, label);
  exactKeys(value, ["owner", "name", "id", "node_id", "owner_id"], label);
  if (!REPOSITORY_PART.test(value.owner) ||
      !REPOSITORY_PART.test(value.name)) {
    throw new TypeError(`${label} contains a non-canonical GitHub path part`);
  }
  return {
    owner: value.owner,
    name: value.name,
    id: decimal(value.id, `${label}.id`),
    node_id: boundedNonemptyString(value.node_id, `${label}.node_id`, 256),
    owner_id: decimal(value.owner_id, `${label}.owner_id`),
  };
}

function validateCurrentOpenDispatchSource(value, label) {
  assertPlainObject(value, label);
  exactKeys(value, [
    "schema",
    "schema_version",
    "source_profile",
    "source_generation_id",
    "source_generation_record_oid",
    "source_generation_digest",
    "production_candidate_authority_digest",
    "candidate_set_digest",
    "source_current_open_semantic_digest",
    "lifecycle_candidate_set_digest",
  ], label);
  if (value.schema !== V2_CANDIDATE_DISPATCH_SOURCE_SCHEMA ||
      value.schema_version !== 2 ||
      value.source_profile !== V2_CURRENT_OPEN_SOURCE_PROFILE ||
      typeof value.source_generation_id !== "string" ||
      !CANDIDATE_SOURCE_GENERATION_ID.test(value.source_generation_id)) {
    throw new TypeError(`${label} schema or generation is invalid`);
  }
  sha(value.source_generation_record_oid,
    `${label}.source_generation_record_oid`);
  for (const [field, fieldLabel] of [
    [value.source_generation_digest, "generation"],
    [value.production_candidate_authority_digest, "production authority"],
    [value.candidate_set_digest, "candidate set"],
    [value.source_current_open_semantic_digest, "source semantic"],
    [value.lifecycle_candidate_set_digest, "lifecycle candidate set"],
  ]) {
    digest(field, `${label} ${fieldLabel} digest`);
  }
  return deepFreeze(structuredClone(value));
}

function validateCurrentOpenDispatchCandidate(value, label) {
  assertPlainObject(value, label);
  exactKeys(value, [
    "schema",
    "schema_version",
    "source_generation_record_oid",
    "identity",
    "identity_digest",
    "lifecycle_seed",
    "lifecycle_seed_digest",
    "lifecycle_generation_id",
    "selection_digest",
  ], label);
  if (value.schema !== V2_CANDIDATE_DISPATCH_SELECTION_SCHEMA ||
      value.schema_version !== 2) {
    throw new TypeError(`${label} schema is invalid`);
  }
  sha(value.source_generation_record_oid,
    `${label}.source_generation_record_oid`);

  assertPlainObject(value.identity, `${label}.identity`);
  exactKeys(value.identity, ["id", "node_id", "number", "created_at"],
    `${label}.identity`);
  const identity = {
    id: decimal(value.identity.id, `${label}.identity.id`),
    node_id: boundedNonemptyString(
      value.identity.node_id,
      `${label}.identity.node_id`,
      256,
    ),
    number: positiveSafeInteger(
      value.identity.number,
      `${label}.identity.number`,
    ),
    created_at: normalizedLedgerTimestamp(
      value.identity.created_at,
      `${label}.identity.created_at`,
    ),
  };
  digest(value.identity_digest, `${label}.identity_digest`);
  if (value.identity_digest !== currentOpenDigestCanonical(
    "codex-review-gate-v2-production-candidate-identity",
    identity,
  )) {
    throw new Error(`${label}.identity_digest is invalid`);
  }

  assertPlainObject(value.lifecycle_seed, `${label}.lifecycle_seed`);
  exactKeys(value.lifecycle_seed, [
    "state",
    "updated_at",
    "draft",
    "base",
    "head",
  ], `${label}.lifecycle_seed`);
  if (value.lifecycle_seed.state !== "open" ||
      typeof value.lifecycle_seed.draft !== "boolean") {
    throw new TypeError(`${label}.lifecycle_seed is invalid`);
  }
  const updatedAt = normalizedLedgerTimestamp(
    value.lifecycle_seed.updated_at,
    `${label}.lifecycle_seed.updated_at`,
  );
  const lifecycleSeed = {
    state: "open",
    updated_at: updatedAt,
    draft: value.lifecycle_seed.draft,
    base: validateCurrentOpenRefSeed(
      value.lifecycle_seed.base,
      `${label}.lifecycle_seed.base`,
    ),
    head: validateCurrentOpenRefSeed(
      value.lifecycle_seed.head,
      `${label}.lifecycle_seed.head`,
    ),
  };
  digest(value.lifecycle_seed_digest, `${label}.lifecycle_seed_digest`);
  if (value.lifecycle_seed_digest !== currentOpenDigestCanonical(
    "codex-review-gate-v2-production-candidate-lifecycle-seed",
    { identity, lifecycle_seed: lifecycleSeed },
  )) {
    throw new Error(`${label}.lifecycle_seed_digest is invalid`);
  }
  if (typeof value.lifecycle_generation_id !== "string" ||
      !CANDIDATE_LIFECYCLE_GENERATION_ID.test(
        value.lifecycle_generation_id,
      )) {
    throw new TypeError(`${label}.lifecycle_generation_id is invalid`);
  }
  digest(value.selection_digest, `${label}.selection_digest`);
  if (value.selection_digest !== ledgerDigestCanonical(
    "codex-review-gate-v2-current-open-dispatch-selection",
    {
      source_generation_record_oid: value.source_generation_record_oid,
      identity_digest: value.identity_digest,
      lifecycle_seed_digest: value.lifecycle_seed_digest,
      lifecycle_generation_id: value.lifecycle_generation_id,
    },
  )) {
    throw new Error(`${label}.selection_digest is invalid`);
  }
  return deepFreeze({
    schema: V2_CANDIDATE_DISPATCH_SELECTION_SCHEMA,
    schema_version: 2,
    source_generation_record_oid: value.source_generation_record_oid,
    identity,
    identity_digest: value.identity_digest,
    lifecycle_seed: lifecycleSeed,
    lifecycle_seed_digest: value.lifecycle_seed_digest,
    lifecycle_generation_id: value.lifecycle_generation_id,
    selection_digest: value.selection_digest,
  });
}

function validateCurrentOpenRefSeed(value, label) {
  assertPlainObject(value, label);
  exactKeys(value, ["ref", "sha", "repo"], label);
  assertPlainObject(value.repo, `${label}.repo`);
  exactKeys(value.repo, ["id", "node_id", "full_name"], `${label}.repo`);
  return {
    ref: boundedNonemptyString(value.ref, `${label}.ref`, 255),
    sha: sha(value.sha, `${label}.sha`),
    repo: {
      id: decimal(value.repo.id, `${label}.repo.id`),
      node_id: boundedNonemptyString(
        value.repo.node_id,
        `${label}.repo.node_id`,
        256,
      ),
      full_name: boundedNonemptyString(
        value.repo.full_name,
        `${label}.repo.full_name`,
        256,
      ),
    },
  };
}

function dispatchCandidateNumber(candidate) {
  return candidate.schema_version === 2
    ? candidate.identity.number
    : candidate.number;
}

function currentOpenLifecycleGenerationId(repository, identityDigest) {
  return `candidate-lifecycle:${ledgerDigestCanonical(
    "codex-review-gate-v2-current-open-lifecycle-generation",
    {
      repository: {
        owner: repository.owner,
        name: repository.name,
        id: repository.id,
        node_id: repository.node_id,
      },
      identity_digest: identityDigest,
    },
  ).slice("sha256:".length)}`;
}

async function readAdvisoryEvent(environment) {
  const path = requiredAbsolutePath(environment, "V2_CONTROLLER_EVENT_PATH");
  if (environment?.GITHUB_WORKSPACE) {
    const workspace = await realpath(
      requiredAbsolutePath(environment, "GITHUB_WORKSPACE"),
    );
    const canonicalEvent = await resolveExistingPath(path, "V2_CONTROLLER_EVENT_PATH");
    if (pathInside(canonicalEvent, workspace)) {
      throw new Error("advisory event path must not resolve inside the checkout");
    }
  }
  const bytes = await readProtectedFile(path, {
    label: "advisory event",
    maxBytes: MAX_V2_WORKFLOW_EVENT_BYTES,
    requireMode: null,
  });
  let event;
  try {
    event = JSON.parse(decodeUtf8(bytes, "advisory event"));
  } catch (error) {
    throw new Error("advisory event is not valid JSON", { cause: error });
  }
  assertPlainObject(event, "advisory event");
  return deepFreeze({
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    event,
  });
}

function validateAdvisoryEventSelector({
  eventName,
  event,
  pullRequestNumber,
  controllerRoute,
}) {
  const selector = pullRequestFromEvent(eventName, event);
  if (controllerRoute === "scan-all-open") {
    if (selector !== null || pullRequestNumber !== null) {
      throw new Error("scan-all-open event unexpectedly selected a pull request");
    }
    return;
  }
  if (eventName === "schedule") {
    // Scheduled per-PR legs carry the selector only in the trusted workflow input.
    return;
  }
  if (selector === null) {
    if (eventName === "workflow_dispatch" && pullRequestNumber !== null) {
      // A trusted workflow input is sufficient when the event JSON omits inputs.
      return;
    }
    throw new Error("advisory event does not identify the selected pull request");
  }
  if (selector !== pullRequestNumber) {
    throw new Error("advisory event pull request does not match the trusted selector");
  }
}

function pullRequestFromEvent(eventName, event) {
  if (eventName === "schedule") return null;
  if (eventName === "pull_request_target" ||
      eventName === "pull_request_review" ||
      eventName === "pull_request_review_comment") {
    assertPlainObject(event.pull_request, `advisory ${eventName}.pull_request`);
    return positiveSafeInteger(
      event.pull_request.number,
      `advisory ${eventName}.pull_request.number`,
    );
  }
  if (eventName === "issue_comment") {
    assertPlainObject(event.issue, "advisory issue_comment.issue");
    assertPlainObject(
      event.issue.pull_request,
      "advisory issue_comment.issue.pull_request",
    );
    return positiveSafeInteger(
      event.issue.number,
      "advisory issue_comment.issue.number",
    );
  }
  if (eventName === "workflow_dispatch") {
    if (event.inputs === undefined || event.inputs === null) return null;
    assertPlainObject(event.inputs, "advisory workflow_dispatch.inputs");
    const selector = event.inputs["pull-request"];
    if (selector === undefined || selector === "") return null;
    return parseOptionalPullRequest(selector,
      "advisory workflow_dispatch.inputs.pull-request");
  }
  throw new Error("advisory event name is unsupported");
}

function validateEventEvidence(value) {
  assertPlainObject(value, "event evidence");
  exactKeys(value, ["digest", "event"], "event evidence");
  digest(value.digest, "event evidence.digest");
  assertPlainObject(value.event, "event evidence.event");
}

function validateWorkflowReceiptStructure(value, repository) {
  assertPlainObject(value, "workflow command.workflow_receipt");
  exactKeys(value, [
    "present",
    "compatible",
    "source",
    "repository",
    "path",
    "revision",
    "checkout_sha",
    "caller_repository",
    "caller_workflow_ref",
    "caller_workflow_sha",
    "status_context",
    "status_target_mode",
  ], "workflow command.workflow_receipt");
  if (value.present !== true || value.compatible !== true ||
      value.source !== V2_WORKFLOW_RECEIPT_SOURCE) {
    throw new Error(
      "workflow receipt must identify the compatible trusted reusable workflow",
    );
  }
  parseRepository(value.repository,
    "workflow command.workflow_receipt.repository");
  if (value.path !== V2_WORKFLOW_PATH) {
    throw new Error(`workflow receipt path must be exactly ${V2_WORKFLOW_PATH}`);
  }
  const revision = sha(value.revision,
    "workflow command.workflow_receipt.revision");
  const checkoutSha = sha(value.checkout_sha,
    "workflow command.workflow_receipt.checkout_sha");
  if (revision !== checkoutSha) {
    throw new Error("workflow receipt does not bind the exact checked-out revision");
  }
  const callerRepository = parseRepository(
    value.caller_repository,
    "workflow command.workflow_receipt.caller_repository",
  );
  if (canonicalJson(callerRepository) !== canonicalJson(repository)) {
    throw new Error("workflow receipt caller repository differs from the command");
  }
  validateCallerWorkflowRef(value.caller_workflow_ref,
    value.caller_repository);
  sha(value.caller_workflow_sha,
    "workflow command.workflow_receipt.caller_workflow_sha");
  if (value.status_context !== V2_STATUS_CONTEXT ||
      value.status_target_mode !== V2_STATUS_TARGET_MODE) {
    throw new Error("workflow receipt does not bind the fixed status contract");
  }
}

function validateWorkflowReceipt(value, environment) {
  assertPlainObject(value, "workflow command.workflow_receipt");
  exactKeys(value, [
    "present",
    "compatible",
    "source",
    "repository",
    "path",
    "revision",
    "checkout_sha",
    "caller_repository",
    "caller_workflow_ref",
    "caller_workflow_sha",
    "status_context",
    "status_target_mode",
  ], "workflow command.workflow_receipt");
  if (value.present !== true || value.compatible !== true ||
      value.source !== V2_WORKFLOW_RECEIPT_SOURCE) {
    throw new Error("workflow receipt must identify the compatible trusted reusable workflow");
  }
  const repository = parseRepository(value.repository,
    "workflow command.workflow_receipt.repository");
  const expected = parseRepository(
    requiredEnvironment(environment, "V2_EXPECTED_WORKFLOW_REPOSITORY"),
    "V2_EXPECTED_WORKFLOW_REPOSITORY",
  );
  const actual = parseRepository(
    requiredEnvironment(environment, "V2_ACTUAL_WORKFLOW_REPOSITORY"),
    "V2_ACTUAL_WORKFLOW_REPOSITORY",
  );
  if (canonicalJson(repository) !== canonicalJson(expected) ||
      canonicalJson(repository) !== canonicalJson(actual)) {
    throw new Error("workflow receipt repository does not match the called workflow");
  }
  if (value.path !== V2_WORKFLOW_PATH ||
      value.path !== requiredEnvironment(environment, "V2_EXPECTED_WORKFLOW_PATH")) {
    throw new Error(`workflow receipt path must be exactly ${V2_WORKFLOW_PATH}`);
  }
  const revision = sha(value.revision, "workflow command.workflow_receipt.revision");
  const checkoutSha = sha(value.checkout_sha,
    "workflow command.workflow_receipt.checkout_sha");
  if (
    revision !== sha(requiredEnvironment(environment, "V2_EXPECTED_WORKFLOW_SHA"),
      "V2_EXPECTED_WORKFLOW_SHA") ||
    checkoutSha !== sha(requiredEnvironment(environment, "V2_CHECKED_OUT_RELEASE_SHA"),
      "V2_CHECKED_OUT_RELEASE_SHA") ||
    revision !== checkoutSha
  ) {
    throw new Error("workflow receipt does not bind the exact checked-out revision");
  }
  const callerRepository = requiredEnvironment(environment, "GITHUB_REPOSITORY");
  if (value.caller_repository !== callerRepository ||
      value.caller_workflow_ref !== validateCallerWorkflowRef(
        requiredEnvironment(environment, "GITHUB_WORKFLOW_REF"),
        callerRepository,
      ) ||
      sha(value.caller_workflow_sha,
        "workflow command.workflow_receipt.caller_workflow_sha") !==
        sha(requiredEnvironment(environment, "GITHUB_WORKFLOW_SHA"),
          "GITHUB_WORKFLOW_SHA")) {
    throw new Error("workflow receipt does not bind the actual caller workflow identity");
  }
  if (value.status_context !== V2_STATUS_CONTEXT ||
      value.status_target_mode !== V2_STATUS_TARGET_MODE) {
    throw new Error("workflow receipt does not bind the fixed status contract");
  }
}

function validateCallerWorkflowRef(value, callerRepository) {
  if (typeof value !== "string" || value.length > 4096 ||
      !value.startsWith(`${callerRepository}/.github/workflows/`)) {
    throw new TypeError("GITHUB_WORKFLOW_REF must identify a workflow in the caller repository");
  }
  const separator = value.lastIndexOf("@");
  if (separator <= callerRepository.length || separator === value.length - 1 ||
      value.slice(callerRepository.length + 1, separator).includes("..")) {
    throw new TypeError("GITHUB_WORKFLOW_REF is not one canonical workflow ref");
  }
  return value;
}

function validateReceiptPolicy(value) {
  assertPlainObject(value, "workflow command.receipt_policy");
  exactKeys(
    value,
    ["server_enforcement", "public_wait"],
    "workflow command.receipt_policy",
  );
  if (value.server_enforcement !== V2_SERVER_ENFORCEMENT_POLICY ||
      value.public_wait !== V2_PUBLIC_WAIT_POLICY) {
    throw new Error("workflow command receipt policy is not the closed live-API policy");
  }
}

function requireFixedEnvironment(environment) {
  if (requiredEnvironment(environment, "V2_STATUS_CONTEXT") !== V2_STATUS_CONTEXT) {
    throw new Error(`V2_STATUS_CONTEXT must be exactly ${V2_STATUS_CONTEXT}`);
  }
  if (requiredEnvironment(environment, "V2_STATUS_TARGET_MODE") !==
      V2_STATUS_TARGET_MODE) {
    throw new Error(`V2_STATUS_TARGET_MODE must be exactly ${V2_STATUS_TARGET_MODE}`);
  }
}

async function resolveControllerPath(environment) {
  const runnerTempInput = requiredAbsolutePath(environment, "RUNNER_TEMP");
  const runnerTemp = await realpath(runnerTempInput);
  const rootInfo = await lstat(runnerTemp, { bigint: true });
  if (!rootInfo.isDirectory()) {
    throw new Error("RUNNER_TEMP must resolve to a directory");
  }
  const input = requiredAbsolutePath(environment, "V2_CONTROLLER_INPUT_PATH");
  const parent = await realpath(dirname(input));
  const candidate = resolve(parent, basename(input));
  if (!pathInside(candidate, runnerTemp)) {
    throw new Error("V2_CONTROLLER_INPUT_PATH must resolve inside RUNNER_TEMP");
  }
  const workspace = await realpath(requiredAbsolutePath(environment, "GITHUB_WORKSPACE"));
  if (pathInside(candidate, workspace)) {
    throw new Error("V2_CONTROLLER_INPUT_PATH must not resolve inside the checkout");
  }
  return candidate;
}

async function resolveExistingPath(path, label) {
  try {
    return await realpath(path);
  } catch (error) {
    throw new Error(`${label} does not resolve to an existing file`, { cause: error });
  }
}

async function writeProtectedNewFile(path, bytes, label) {
  let handle;
  try {
    handle = await open(path, CREATE_FLAGS, 0o600);
    await handle.chmod(0o600);
    const opened = await handle.stat({ bigint: true });
    assertFilePolicy(opened, label, 0o600);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesWritten } = await handle.write(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (bytesWritten <= 0) throw new Error(`${label} write made no progress`);
      offset += bytesWritten;
    }
    await handle.sync();
    const stable = await handle.stat({ bigint: true });
    assertFilePolicy(stable, label, 0o600);
    if (stable.dev !== opened.dev || stable.ino !== opened.ino ||
        stable.size !== BigInt(bytes.length)) {
      throw new Error(`${label} changed object identity or size while publishing`);
    }
    const readback = Buffer.alloc(bytes.length);
    await readDescriptorExactly(handle, readback, label);
    const afterRead = await handle.stat({ bigint: true });
    assertStableObject(stable, afterRead, label);
    if (!readback.equals(bytes)) {
      throw new Error(`${label} content does not match its protected write`);
    }
    const pathAfter = await lstat(path, { bigint: true });
    assertStableObject(afterRead, pathAfter, label);
  } finally {
    await handle?.close();
  }
}

async function readProtectedFile(path, { label, maxBytes, requireMode }) {
  const before = await lstat(path, { bigint: true });
  assertFilePolicy(before, label, requireMode);
  if (before.size <= 0n || before.size > BigInt(maxBytes)) {
    throw new Error(`${label} exceeds its bounded non-empty file size`);
  }
  const handle = await open(path, READ_FLAGS);
  try {
    const opened = await handle.stat({ bigint: true });
    assertFilePolicy(opened, label, requireMode);
    assertStableObject(before, opened, label);
    const bytes = Buffer.alloc(Number(opened.size));
    await readDescriptorExactly(handle, bytes, label);
    const afterRead = await handle.stat({ bigint: true });
    assertStableObject(opened, afterRead, label);
    const pathAfter = await lstat(path, { bigint: true });
    assertStableObject(afterRead, pathAfter, label);
    return bytes;
  } finally {
    await handle.close();
  }
}

async function readDescriptorExactly(handle, buffer, label) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      buffer.length - offset,
      offset,
    );
    if (bytesRead <= 0) {
      throw new Error(`${label} ended before its descriptor-declared size`);
    }
    offset += bytesRead;
  }
}

function assertFilePolicy(info, label, requireMode) {
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n) {
    throw new Error(`${label} must be an ordinary non-symlink file with one link`);
  }
  if (requireMode !== null && Number(info.mode & 0o777n) !== requireMode) {
    throw new Error(`${label} must have mode ${requireMode.toString(8)}`);
  }
}

function assertStableObject(before, after, label) {
  // dev+ino protects object identity; size+mtime+ctime protects content
  // stability; mode+nlink protects the selected access/link policy.
  if (
    before.dev !== after.dev || before.ino !== after.ino ||
    before.size !== after.size || before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs || before.mode !== after.mode ||
    before.nlink !== after.nlink
  ) {
    throw new Error(`${label} changed identity, content, or access policy during use`);
  }
}

function requiredAbsolutePath(environment, name) {
  const value = requiredEnvironment(environment, name);
  if (!isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  return value;
}

function pathInside(candidate, root) {
  const suffix = relative(root, candidate);
  return suffix === "" || (!suffix.startsWith("..") && !isAbsolute(suffix));
}

function requiredEnvironment(environment, name) {
  const value = environment?.[name];
  if (typeof value !== "string" || value.length === 0 || value.length > 4096 ||
      value.includes("\0") || value.includes("\r") || value.includes("\n")) {
    throw new TypeError(`${name} must be one bounded non-empty environment string`);
  }
  return value;
}

function parseRepository(value, label) {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  const parts = value.split("/");
  if (parts.length !== 2 || !REPOSITORY_PART.test(parts[0]) ||
      !REPOSITORY_PART.test(parts[1])) {
    throw new TypeError(`${label} must be one canonical owner/name`);
  }
  return { owner: parts[0], name: parts[1] };
}

function validateRepository(value, label) {
  assertPlainObject(value, label);
  exactKeys(value, ["owner", "name"], label);
  if (!REPOSITORY_PART.test(value.owner) || !REPOSITORY_PART.test(value.name)) {
    throw new TypeError(`${label} contains a non-canonical GitHub path part`);
  }
  return { owner: value.owner, name: value.name };
}

function parseOptionalPullRequest(value, label) {
  if (value === "") return null;
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  if (!POSITIVE_DECIMAL.test(value)) {
    throw new TypeError(`${label} must be empty or one positive canonical decimal`);
  }
  const number = Number(value);
  return positiveSafeInteger(number, label);
}

function optionalPositiveInteger(value, label) {
  return value === null ? null : positiveSafeInteger(value, label);
}

function positiveIntegerFromText(value, label) {
  positiveDecimal(value, label);
  return positiveSafeInteger(Number(value), label);
}

function positiveDecimal(value, label) {
  if (typeof value !== "string" || !POSITIVE_DECIMAL.test(value)) {
    throw new TypeError(`${label} must be one positive canonical decimal string`);
  }
  return value;
}

function positiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function nonnegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer`);
  }
  return value;
}

function decimal(value, label) {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new TypeError(`${label} must be one canonical decimal string`);
  }
  return value;
}

function boundedNonemptyString(value, label, maximumBytes) {
  if (typeof value !== "string" || value.length === 0 ||
      Buffer.byteLength(value, "utf8") > maximumBytes) {
    throw new TypeError(`${label} must be one non-empty bounded string`);
  }
  return value;
}

function ledgerTimestamp(value, label) {
  if (typeof value !== "string" || !TIMESTAMP.test(value) ||
      !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${label} must be one canonical UTC timestamp`);
  }
  return value;
}

function normalizedLedgerTimestamp(value, label) {
  ledgerTimestamp(value, label);
  const normalized = new Date(Date.parse(value)).toISOString();
  if (value !== normalized) {
    throw new TypeError(`${label} must use normalized millisecond UTC form`);
  }
  return normalized;
}

function sha(value, label) {
  if (typeof value !== "string" || !SHA.test(value)) {
    throw new TypeError(`${label} must be one lowercase SHA-1 object id`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} must be one sha256 digest`);
  }
  return value;
}

function enumValue(value, allowed, label) {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new TypeError(`${label} is outside its closed enum`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new TypeError(`${label} keys are not exact`);
  }
}

function assertPlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }
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

function rawDigest(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function ledgerDigestCanonical(domain, value) {
  return rawDigest(`${domain}\0${canonicalJson(value)}`);
}

function currentOpenDigestCanonical(domain, value) {
  return rawDigest(`${domain}\n${canonicalJson(value)}\n`);
}

function decodeUtf8(bytes, label) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8`, { cause: error });
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function isMainModule() {
  return process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  if (process.argv.length !== 3 || process.argv[2] !== "prepare-command") {
    process.stderr.write(
      "::error::workflow-command requires the exact `prepare-command` command\n",
    );
    process.exitCode = 2;
  } else {
    prepareV2WorkflowCommand().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`::error::${message.replace(/[\r\n%]/gu, " ")}\n`);
      process.exitCode = 1;
    });
  }
}
