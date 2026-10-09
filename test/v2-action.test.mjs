import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildV2GateReport,
  buildV2StickyCommentBody,
  appendV2GateSummary,
  writeV2GateCliReport,
} from "../packages/action/src/v2/gate-runtime.mjs";

const ACTION_YAML_URL = new URL("../packages/action/action.yml", import.meta.url);

test("direct gate Action exposes the adopted production ABI and entrypoint", () => {
  const action = readFileSync(ACTION_YAML_URL, "utf8");
  assert.match(action, /Verify Codex review evidence, refresh the canonical verifier, or report a completion snapshot/u);
  assert.match(action, /controller to update diagnostics and rerun the verifier/u);
  assert.doesNotMatch(action, /write the gate status|commit status|status projection/iu);
  const inputs = yamlSection(action, "inputs", "outputs");
  assert.deepEqual(topLevelYamlKeys(inputs), [
    "github_token",
    "review_request_token",
    "pr_number",
    "expected_head_sha",
    "operation",
    "request_comment_id",
    "request_review",
    "limits_profile",
  ]);
  assert.match(yamlChildBlock(inputs, "github_token"), /^    required: true$/mu);
  assert.match(yamlChildBlock(inputs, "review_request_token"), /^    required: false$/mu);
  assert.match(yamlChildBlock(inputs, "review_request_token"), /^    default: ""$/mu);
  assert.match(yamlChildBlock(inputs, "pr_number"), /^    required: true$/mu);
  assert.match(yamlChildBlock(inputs, "expected_head_sha"), /^    default: ""$/mu);
  assert.match(yamlChildBlock(inputs, "operation"), /^    description: .*workflow_run-only report-completion/u);
  assert.match(yamlChildBlock(inputs, "operation"), /^    required: false$/mu);
  assert.match(yamlChildBlock(inputs, "operation"), /^    default: reconcile$/mu);
  assert.match(yamlChildBlock(inputs, "request_review"), /^    default: "true"$/mu);
  assert.match(yamlChildBlock(inputs, "limits_profile"), /^    default: default$/mu);

  const outputs = yamlSection(action, "outputs", "runs");
  assert.deepEqual(topLevelYamlKeys(outputs), [
    "execution_health",
    "gate_outcome",
    "recovery_code",
    "retry_safe",
  ]);
  const runs = action.slice(action.indexOf("\nruns:\n"));
  assert.match(runs, /^  using: node24$/mu);
  assert.match(runs, /^  main: src\/v2\/gate-runtime\.mjs$/mu);
  assert.doesNotMatch(
    runs,
    /using: composite|steps:|actions\/(?:checkout|upload-artifact)|\bgh\b|\bcurl\b/u,
  );
  assert.doesNotMatch(outputs, /^    value:/mu);
});

test("controller diagnostic observations hide unread counts without inventing zero findings", () => {
  const headSha = "a".repeat(40);
  for (const gateOutcome of ["pending", "success", "failure"]) {
    const report = buildV2GateReport({
      executionHealth: "healthy",
      gateOutcome,
      reason: `Verifier run 123 attempt 2 observed at 2026-10-05T12:00:00Z; conclusion ${gateOutcome}.`,
      recoveryCode: gateOutcome === "success" ? "none" : "wait_then_reconcile",
      findingsUnresolved: "unknown",
      findingsResolved: "unknown",
      findingsHistorical: "unknown",
      findingsIndeterminate: "unknown",
      reviewThreads: { status: "not_read" },
    });
    const body = buildV2StickyCommentBody(report, {
      prNumber: 17,
      headSha,
      diagnosticObservation: true,
      verifierRunId: 123,
      verifierRunAttempt: 2,
      verifierObservedAt: "2026-10-05T12:00:00Z",
    });
    const visible = body.split("<!--")[0];
    assert.match(visible, /Diagnostic-only verifier observation/u);
    assert.match(visible, /not the current gating result/u);
    assert.match(visible, /PR Checks and verifier summary are authoritative/u);
    assert.ok(visible.includes(`Exact head: \`${headSha}\``));
    assert.match(visible, /run 123 attempt 2 observed at 2026-10-05T12:00:00Z/u);
    assert.doesNotMatch(visible, /unknown|Findings:|Review threads:|Review-thread inventory:/u);
    const payloadLine = body.split("\n").at(-1);
    const payload = JSON.parse(payloadLine.slice(5, -4));
    assert.equal(payload.gateOutcome, gateOutcome);
    assert.equal(payload.findingsUnresolved, "unknown");
    assert.equal(payload.findingsResolved, "unknown");
    assert.equal(payload.reviewThreads.status, "not_read");
  }
});

test("CLI diagnostics retain closed parser codes and reject unsafe extra fields", () => {
  const report = buildV2GateReport({
    executionHealth: "healthy",
    gateOutcome: "pending",
    reason: "Parser rejected a provider artifact",
    recoveryCode: "request_clean_generation",
    carrierDiagnostics: [
      {
        source: "issue-comment",
        id: "201",
        htmlUrl: "https://github.com/JoeyTeng/codex-review-workflows/pull/215#issuecomment-201",
        revisionAt: "2026-10-08T12:00:00Z",
        parseDiagnostics: {
          profile: "top-level-clean-issue-comment-v2",
          stage: "disclosure",
          reasonCode: "disclosure_invalid",
          disclosureProfile: "official-codex-disclosure-v1",
          commitRefLength: 40,
          rawBody: "UNSAFE_PROVIDER_TEXT",
          token: "SECRET_TOKEN",
        },
        requestSelection: {
          currentGenerationCount: 1,
          selectedRequestId: "101",
          selected: true,
          raw: "UNSAFE_REQUEST_DATA",
        },
      },
      {
        source: "issue-comment",
        id: "202",
        htmlUrl: "https://attacker.example/unsafe?token=SECRET_TOKEN",
        revisionAt: "2026-10-08T12:01:00Z",
        parseDiagnostics: {
          profile: "top-level-clean-issue-comment-v2",
          stage: "finding-signal",
          reasonCode: "finding_signal",
        },
      },
      {
        source: "issue-comment",
        id: "203",
        parseDiagnostics: {
          profile: "unknown-profile",
          stage: "disclosure",
          reasonCode: "disclosure_invalid",
        },
      },
    ],
  });
  const originalError = console.error;
  let output = "";
  console.error = (line) => { output += `${line}\n`; };
  try {
    writeV2GateCliReport(report, {
      GITHUB_TOKEN: "SECRET_TOKEN",
      INPUT_GITHUB_TOKEN: "ANOTHER_SECRET",
    });
  } finally {
    console.error = originalError;
  }

  const payload = JSON.parse(output.match(/^\[codex-review-gate\] (.*)$/mu)[1]);
  assert.equal(payload.carrier_diagnostics.length, 2);
  assert.equal(payload.carrier_diagnostics[0].reasonCode, "disclosure_invalid");
  assert.equal(payload.carrier_diagnostics[0].profile, "top-level-clean-issue-comment-v2");
  assert.equal(payload.carrier_diagnostics[0].stage, "disclosure");
  assert.equal(payload.carrier_diagnostics[0].commitRefLength, 40);
  assert.equal(payload.carrier_diagnostics[1].url, null);
  assert.equal(payload.carrier_diagnostics[1].reasonCode, "finding_signal");
  assert.doesNotMatch(output, /UNSAFE_PROVIDER_TEXT|UNSAFE_REQUEST_DATA|SECRET_TOKEN|ANOTHER_SECRET|attacker\.example|rawBody|token/u);
  assert.match(output.trim().split("\n").at(-1), /^\[codex-review-gate\] Steps to unblock: /u);
});

test("unblock guidance leads with complete unresolved threads and retains review recovery", () => {
  const report = buildV2GateReport({
    executionHealth: "healthy",
    gateOutcome: "pending",
    recoveryCode: "request_clean_generation",
    reason: "A historical request attribution gap remains",
    findingsUnresolved: 0,
    findingsResolved: 0,
    findingsHistorical: 0,
    findingsIndeterminate: 4,
    reviewThreads: { status: "complete", unresolved: 1, resolved: 11, total: 12 },
  });
  const lines = captureCliReport(report, { INPUT_PR_NUMBER: "34" });
  const payload = JSON.parse(lines[0].slice("[codex-review-gate] ".length));
  assert.equal(payload.recovery_code, "request_clean_generation");
  assert.equal(payload.findings.unresolved, 0);
  assert.equal(payload.review_threads.unresolved, 1);
  assert.equal(payload.review_threads.resolved, 11);
  assert.equal(payload.review_threads.total, 12);
  assert.match(lines.at(-1), /Steps to unblock: First resolve all 1 unresolved pull-request review thread\(s\) on PR #34; then /u);
  assert.match(lines.at(-1), /request lineage|review generation/u);
});

test("complete thread blockers retain independent finding and permission repairs", () => {
  for (const [code, action] of [
    ["fix_findings", /Fix the unresolved Codex findings/u],
    ["repair_permissions", /Repair the canonical workflow permissions/u],
  ]) {
    const report = buildV2GateReport({
      executionHealth: code === "repair_permissions" ? "unhealthy" : "healthy",
      gateOutcome: code === "fix_findings" ? "failure" : "pending",
      recoveryCode: code,
      reason: "An independent blocker remains",
      findingsUnresolved: code === "fix_findings" ? 2 : 0,
      reviewThreads: { status: "complete", unresolved: 1, resolved: 0, total: 1 },
    });
    const tail = captureCliReport(report, { INPUT_PR_NUMBER: "34" }).at(-1);
    assert.match(tail, /Steps to unblock: First resolve all 1 unresolved/u);
    assert.match(tail, action);
    assert.doesNotMatch(tail, /do not request another review while the head is unchanged/u);
  }
});

test("incomplete thread inventory keeps counts unknown and ends with safe recovery", () => {
  const report = buildV2GateReport({
    executionHealth: "unhealthy",
    gateOutcome: "pending",
    recoveryCode: "use_expanded_limits",
    reason: "Thread pagination exceeded the configured limit",
    reviewThreads: { status: "incomplete" },
  });
  const lines = captureCliReport(report, { INPUT_PR_NUMBER: "34" });
  const payload = JSON.parse(lines[0].slice("[codex-review-gate] ".length));
  assert.equal(payload.review_threads.unresolved, "unknown");
  assert.equal(payload.review_threads.resolved, "unknown");
  assert.equal(payload.review_threads.total, "unknown");
  assert.match(lines.at(-1), /Steps to unblock: Rerun reconcile for PR #34 with limits_profile=expanded/u);
  assert.match(lines.at(-1), /counts remain unknown/u);
  assert.match(lines.at(-1), /exact-head reconcile/u);
});

test("thread-only summary ends with reconcile instructions without requesting another review", () => {
  const directory = mkdtempSync(join(tmpdir(), "gate-unblock-summary-"));
  const summary = join(directory, "summary.md");
  try {
    const report = buildV2GateReport({
      executionHealth: "healthy",
      gateOutcome: "pending",
      recoveryCode: "wait_then_reconcile",
      reason: "GitHub reports 1 unresolved pull-request review thread(s)",
      reviewThreads: { status: "complete", unresolved: 1, resolved: 11, total: 12 },
    });
    appendV2GateSummary(summary, report, { prNumber: 34 });
    const tail = readFileSync(summary, "utf8").trim().split("\n").at(-1);
    assert.match(tail, /^Steps to unblock: First resolve all 1 unresolved/u);
    assert.ok(tail.includes("dispatch reconcile against the exact current head on PR \\#34"));
    assert.doesNotMatch(tail, /@codex|&#64;codex|canonical generation|request a new review/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CLI uses the actual contextual recovery instruction and redacts its final line", () => {
  const report = buildV2GateReport({
    executionHealth: "healthy",
    gateOutcome: "pending",
    recoveryCode: "request_clean_generation",
    reason: "The latest request is still awaiting a clean receipt",
  });
  const nextAction = "Wait for the latest eligible @codex review request for PR #34 to finish; reconcile only after its exact-head clean arrives.";
  const lines = captureCliReport(report, { INPUT_PR_NUMBER: "34" }, nextAction);
  assert.equal(lines.at(-1), `[codex-review-gate] Steps to unblock: ${nextAction}`);
  assert.doesNotMatch(lines.at(-1), /create exactly one canonical generation/u);
  const redacted = captureCliReport(report, { INPUT_GITHUB_TOKEN: "SECRET_TOKEN" },
    "Repair permissions without exposing SECRET_TOKEN\n::error:: untrusted text");
  assert.equal(redacted.length, 2);
  assert.doesNotMatch(redacted.at(-1), /SECRET_TOKEN|\n/u);
});

function captureCliReport(report, environment, nextAction) {
  const originalError = console.error;
  const lines = [];
  console.error = (line) => { lines.push(line); };
  try {
    writeV2GateCliReport(report, environment, nextAction);
  } finally {
    console.error = originalError;
  }
  return lines;
}

function yamlSection(text, startName, endName) {
  const start = text.indexOf(`${startName}:\n`);
  const end = text.indexOf(`\n${endName}:\n`, start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return text.slice(start + startName.length + 2, end);
}

function topLevelYamlKeys(section) {
  return [...section.matchAll(/^  ([a-z][a-z0-9_-]*):$/gmu)].map((match) => match[1]);
}

function yamlChildBlock(section, name) {
  const start = section.indexOf(`  ${name}:\n`);
  assert.notEqual(start, -1);
  const following = section.slice(start + name.length + 4);
  const next = following.search(/^  [a-z][a-z0-9_-]*:$/mu);
  return next === -1 ? following : following.slice(0, next);
}
