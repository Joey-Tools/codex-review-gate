import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  V2_GIT_LEDGER_BLOB_PATH,
  V2_GIT_LEDGER_CAPABILITY_SCHEMA,
  V2_GIT_LEDGER_CANDIDATE_INVENTORY_RECORD_SCHEMA,
  V2_GIT_LEDGER_CONTROL_PLANE_AUTHORITY_SCHEMA,
  V2_GIT_LEDGER_ESTABLISHED_RUNNER_STATE_AUTHORITY_SCHEMA,
  V2_GIT_LEDGER_DISCOVERY_CONTINUITY_RECEIPT_SCHEMA,
  V2_GIT_LEDGER_BOOTSTRAP_INPUT_SCHEMA,
  V2_GIT_LEDGER_HTTP_LIMITS,
  MAX_V2_GIT_LEDGER_COMMITS,
  MAX_V2_SCHEDULED_CANDIDATE_LEDGER_RECORDS,
  V2_GIT_LEDGER_OIDC_AUDIENCE,
  V2_GIT_LEDGER_OIDC_CLAIMS,
  V2_GIT_LEDGER_PROVENANCE_RECEIPT_SCHEMA,
  V2_GIT_LEDGER_PROVENANCE_REQUEST_SCHEMA,
  V2_GIT_LEDGER_PROVENANCE_VERIFIER_RESULT_SCHEMA,
  V2_GIT_LEDGER_PUBLIC_ENVELOPE_SCHEMA,
  assertV2GitLedgerControlPlaneAuthorityHandle,
  assertV2GitLedgerEstablishedRunnerStateAuthorityHandle,
  assertV2GitLedgerInitialRunnerStateAuthorityHandle,
  assertV2GitLedgerAutomaticRequestIntentHandle,
  assertV2GitLedgerAutomaticReservationHandle,
  assertV2GitLedgerReservationStatusIntentHandle,
  assertV2GitLedgerStatusWriteIntentHandle,
  assertV2GitLedgerCandidateDispatchHandle,
  assertV2GitLedgerCandidateDispatchResultHandle,
  V2_GIT_LEDGER_REF,
  createV2GitHubGitLedger,
  createV2GitHubGitLedgerBootstrap,
  createV2GitLedgerCandidateInventoryRecord,
  createV2GitLedgerCandidateDispatchEvaluatedScopeReceipt,
  createV2GitLedgerCandidateDispatchRecord,
  createV2GitLedgerDiscoveryContinuityReceipt,
  createV2GitLedgerEffectIntentRecord,
  createV2GitLedgerEffectResponseRecord,
  createV2GitLedgerEvaluatedScopeReceipt,
  createV2GitLedgerManualSelectionReceipt,
  createV2GitLedgerRecord,
  calculateV2GitLedgerCandidateDispatchCommitBudget,
  classifyV2GitLedgerCandidateDispatchRecoveryPrefix,
  deriveV2GitLedgerCandidateInventoryAuthority,
  deriveV2GitLedgerCandidateDispatchAuthority,
  deriveV2GitLedgerAuthority,
  digestV2GitLedgerStableCapabilityAuthorization,
  digestV2GitLedgerPayload,
  projectV2GitLedgerAutomaticReservation,
  projectV2GitLedgerAutomaticReviewRequestTransport,
  projectV2GitLedgerReservationStatusTransport,
  projectV2GitLedgerStatusWriteTransport,
  projectV2GitLedgerCandidateDispatchPlan,
  validateV2GitLedgerControlPlaneAuthority,
  validateV2GitLedgerDiscoveryContinuityReceipt,
  validateV2GitLedgerEstablishedRunnerStateAuthority,
  validateV2GitLedgerInitialRunnerStateAuthority,
} from "../packages/action/src/v2/git-ledger.mjs";
import {
  assertV2ProductionRunnerAuthorityHandle,
  createV2ControlPlaneReceiptFromGitLedgerAuthority,
  createV2ProductionRunnerAuthority,
} from "../packages/action/src/v2/control-plane-receipt.mjs";
import {
  createV2GitHubCandidateInventory,
  finalizeV2CandidateInventoryCycle,
} from "../packages/action/src/v2/candidate-inventory.mjs";
import {
  V2_SCHEDULER_SCHEMA,
  V2_SCHEDULER_SCHEMA_VERSION,
  planV2Actions,
} from "../packages/action/src/v2/scheduler.mjs";
import {
  acquireV2LeaseThenLoadDiscovery,
  loadV2MinimalLiveScope,
} from "../packages/action/src/v2/workflow-controller.mjs";
import {
  createV2GitHubWorkflowPreflight,
} from "../packages/action/src/v2/workflow-preflight.mjs";
import {
  V2_PUBLIC_WAIT_POLICY,
  V2_SERVER_ENFORCEMENT_POLICY,
  prepareV2WorkflowCommand,
} from "../packages/action/src/v2/workflow-command.mjs";
import {
  createV2GitHubTransport,
  loadV2ProviderPreScopeArtifact,
  V2_TRANSPORT_DEFAULT_LIMITS,
} from "../packages/action/src/v2/transport.mjs";

const REPOSITORY = {
  owner: "owner",
  name: "repo",
  id: "42",
  node_id: "R_repo",
  owner_id: "88",
};
const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const POTENTIAL = "c".repeat(40);
const TIME = "2026-08-13T12:00:00.000Z";
const PR = { number: 7, node_id: "PR_7" };
const OWNER = { run_id: "9001", run_attempt: 1, actor_id: "15368" };
const CONTROL = {
  comment_id: "71",
  comment_node_id: "IC_71",
  raw_body_sha256: `sha256:${"d".repeat(64)}`,
};
const ACTOR = {
  id: "15368",
  node_id: "U_actions",
  login: "github-actions[bot]",
  type: "Bot",
};
const CODEX_ACTOR = {
  id: "199175422",
  node_id: "BOT_kgDOC98s_g",
  login: "chatgpt-codex-connector[bot]",
  type: "Bot",
};
const CODEX_APP = {
  id: "1144995",
  node_id: "A_kwHOAOQ6Gs4AEXij",
  slug: "chatgpt-codex-connector",
};
const APP = {
  id: "15368",
  node_id: "A_actions",
  slug: "github-actions",
};
// review helper synthetic-token pool joey-private-v3: bearer-a
const SYNTHETIC_BEARER = "codex_synth_v1_bearer_a";

test("bootstrap proves one-winner canary and production append is exact-ref stable", async () => {
  const fixture = githubGitFixture();
  const ledger = makeLedger(fixture);

  const bootstrap = await ledger.bootstrapCapability();
  assert.equal(bootstrap.already_current, false);
  assert.equal(bootstrap.contenders.length, 2);
  assert.deepEqual(
    bootstrap.contenders.filter((entry) => entry.outcome === "winner").length,
    1,
  );
  assert.equal(
    bootstrap.contenders.filter((entry) => entry.outcome === "non-fast-forward").length,
    1,
  );
  assert.equal(bootstrap.stable, true);

  const initial = await ledger.load();
  assert.equal(initial.commit_count, 3);
  assert.equal(initial.capability.attestation_commit_sha, initial.tip_commit_sha);
  assert.equal(initial.pre_ref.target_commit_sha, initial.post_ref.target_commit_sha);

  const lease = (await acquireDefaultDiscovery(ledger)).lease_receipt;
  const intent = effectRecord({
    predecessor: lease.acquire_commit_sha,
    lease,
    effectId: "effect-1",
    idempotencyKey: "intent-1",
    at: TIME,
  });
  const receipt = await ledger.appendRecord(intent);
  assert.equal(receipt.record_type, "effect-intent");
  assert.equal(receipt.predecessor_commit_sha, lease.acquire_commit_sha);
  assert.equal(receipt.ref_reread.target_commit_sha, receipt.commit_sha);
  assert.equal(receipt.stable, true);

  const loaded = await ledger.load();
  assert.equal(loaded.tip_commit_sha, receipt.commit_sha);
  assert.equal(loaded.effect_intent_count, 1);
  assert.equal(loaded.active_lease.lease_id, lease.lease_id);
  assert.deepEqual(
    loaded.records.map((entry) => entry.envelope.record_type),
    ["genesis", "capability-canary", "capability-attestation", "lease-acquire", "effect-intent"],
  );
  assert.equal(
    fixture.calls.some((call) =>
      call.method === "PATCH" && JSON.parse(call.body).force !== false),
    false,
  );
});

test("bootstrap reuses one stable capability across live receipt churn", async () => {
  const fixture = githubGitFixture();
  const originalCapability = capabilityReceipt();
  const ledger = makeLedger(fixture, originalCapability);
  await ledger.bootstrapCapability();
  const tipBefore = fixture.refTarget;
  const writesBefore = fixture.writeCalls;
  const objectsBefore = {
    blobs: fixture.blobs.size,
    trees: fixture.trees.size,
    commits: fixture.commits.size,
  };

  const changedBase = capabilityBase();
  changedBase.repository_endpoint_receipt.server_time =
    "2026-08-13T12:00:01.000Z";
  changedBase.repository_endpoint_receipt.raw_body_sha256 =
    `sha256:${"5".repeat(64)}`;
  changedBase.permissions.observation_receipt_digest =
    `sha256:${"6".repeat(64)}`;
  changedBase.observed_at = "2026-08-13T12:00:01.000Z";
  for (const release of [
    changedBase.controller_release,
    changedBase.protection.source_workflow_pin,
  ]) {
    release.caller_workflow_file_receipt_digest = `sha256:${"d".repeat(64)}`;
    release.job_workflow_file_receipt_digest = `sha256:${"e".repeat(64)}`;
    release.release_receipt_digest = `sha256:${"f".repeat(64)}`;
  }
  const changedCapability = sealCapability(changedBase);
  assert.equal(
    digestV2GitLedgerStableCapabilityAuthorization(originalCapability),
    digestV2GitLedgerStableCapabilityAuthorization(changedCapability),
  );
  const restricted = createV2GitHubGitLedgerBootstrap({
    fetch: fixture.fetch,
    token: SYNTHETIC_BEARER,
    repository: REPOSITORY,
    ledgerRef: V2_GIT_LEDGER_REF,
    restBaseUrl: "https://api.github.test",
    bootstrapCapabilityInput: bootstrapInputForCapability(changedCapability),
    verifyWorkflowProvenance: provenanceVerifier(),
  });
  const restarted = await restricted.bootstrapCapability();
  assert.equal(restarted.bootstrap_receipt.already_current, true);
  assert.equal(fixture.refTarget, tipBefore);
  assert.equal(fixture.writeCalls, writesBefore);
  assert.deepEqual({
    blobs: fixture.blobs.size,
    trees: fixture.trees.size,
    commits: fixture.commits.size,
  }, objectsBefore);
});

test("two concurrent siblings advance the protected ref exactly once", async () => {
  const fixture = githubGitFixture();
  const ledger = makeLedger(fixture);
  await ledger.bootstrapCapability();
  const lease = (await acquireDefaultDiscovery(ledger)).lease_receipt;

  const left = effectRecord({
    predecessor: lease.acquire_commit_sha,
    lease,
    effectId: "effect-left",
    idempotencyKey: "intent-left",
    at: TIME,
  });
  const right = effectRecord({
    predecessor: lease.acquire_commit_sha,
    lease,
    effectId: "effect-right",
    idempotencyKey: "intent-right",
    at: TIME,
  });
  const outcomes = await Promise.allSettled([
    ledger.appendRecord(left),
    ledger.appendRecord(right),
  ]);
  assert.equal(outcomes.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((entry) => entry.status === "rejected").length, 1);
  const rejected = outcomes.find((entry) => entry.status === "rejected");
  assert.equal(rejected.reason.code, "non-fast-forward");
  assert.match(rejected.reason.message, /unreachable/u);

  const final = await ledger.load();
  assert.equal(final.effect_intent_count, 1);
  assert.equal(final.records.at(-1).commit_sha, fixture.refTarget);
  assert.equal(fixture.commits.size > final.commit_count, true,
    "the losing sibling remains an unreachable Git object");
});

test("capability, exact ref, rules, and observed permission mismatches fail before writes", async () => {
  const fixture = githubGitFixture();
  assert.throws(
    () => createV2GitHubGitLedger({
      ...factoryInput(fixture, capabilityReceipt()),
      ledgerRef: "refs/heads/not-the-ledger",
    }),
    /must be exactly/u,
  );

  const badRulesBase = capabilityBase();
  badRulesBase.protection.non_fast_forward_blocked = false;
  assert.throws(
    () => makeLedger(fixture, sealCapability(badRulesBase)),
    /protection is incomplete/u,
  );

  const broadPermissionBase = capabilityBase();
  broadPermissionBase.permissions.contents_write_observed = false;
  assert.throws(
    () => makeLedger(fixture, sealCapability(broadPermissionBase)),
    /observed contents:write/u,
  );
  assert.throws(
    () => makeLedger(fixture, null),
    /capability authority/u,
  );
  assert.equal(fixture.calls.length, 0);
});

test("restricted bootstrap is the only absent-ref path and seals production capability", async () => {
  const fixture = githubGitFixture();
  const restricted = createV2GitHubGitLedgerBootstrap({
    fetch: fixture.fetch,
    token: SYNTHETIC_BEARER,
    repository: REPOSITORY,
    ledgerRef: V2_GIT_LEDGER_REF,
    restBaseUrl: "https://api.github.test",
    bootstrapCapabilityInput: bootstrapInput(),
    verifyWorkflowProvenance: provenanceVerifier(),
  });
  assert.deepEqual(Object.keys(restricted), ["bootstrapCapability"]);
  const result = await restricted.bootstrapCapability();
  assert.equal(result.bootstrap_receipt.stable, true);
  assert.equal(
    result.bootstrap_receipt.capability_attestation_commit_sha,
    fixture.refTarget,
  );
  assert.equal(result.sealed_capability_receipt.feature_enabled, true);
  const loaded = await result.ledger.load();
  assert.equal(loaded.tip_commit_sha, fixture.refTarget);
});

test("restricted bootstrap rejects ineligible input, wrong ref, and bad OIDC", async (t) => {
  await t.test("ineligible input", () => {
    const fixture = githubGitFixture();
    const input = bootstrapInputBase();
    input.bootstrap_eligible = false;
    assert.throws(
      () => createV2GitHubGitLedgerBootstrap({
        fetch: fixture.fetch,
        token: SYNTHETIC_BEARER,
        repository: REPOSITORY,
        ledgerRef: V2_GIT_LEDGER_REF,
        restBaseUrl: "https://api.github.test",
        bootstrapCapabilityInput: sealBootstrapInput(input),
        verifyWorkflowProvenance: provenanceVerifier(),
      }),
      /not eligible/u,
    );
    assert.equal(fixture.writeCalls, 0);
  });

  await t.test("wrong ref", () => {
    const fixture = githubGitFixture();
    assert.throws(
      () => createV2GitHubGitLedgerBootstrap({
        fetch: fixture.fetch,
        token: SYNTHETIC_BEARER,
        repository: REPOSITORY,
        ledgerRef: "refs/heads/not-ledger",
        restBaseUrl: "https://api.github.test",
        bootstrapCapabilityInput: bootstrapInput(),
        verifyWorkflowProvenance: provenanceVerifier(),
      }),
      /must be exactly/u,
    );
    assert.equal(fixture.writeCalls, 0);
  });

  await t.test("bad OIDC", async () => {
    const fixture = githubGitFixture();
    const baseVerifier = provenanceVerifier();
    const restricted = createV2GitHubGitLedgerBootstrap({
      fetch: fixture.fetch,
      token: SYNTHETIC_BEARER,
      repository: REPOSITORY,
      ledgerRef: V2_GIT_LEDGER_REF,
      restBaseUrl: "https://api.github.test",
      bootstrapCapabilityInput: bootstrapInput(),
      verifyWorkflowProvenance: async (request) => {
        const result = structuredClone(await baseVerifier(request));
        const receipt = result.receipt;
        delete receipt.receipt_digest;
        receipt.signature_verified = false;
        receipt.receipt_digest = digestCanonical(
          "codex-review-gate-v2-git-ledger-provenance",
          receipt,
        );
        return result;
      },
    });
    await assert.rejects(
      restricted.bootstrapCapability(),
      /not live, verified, and signature-bound/u,
    );
    assert.equal(fixture.writeCalls, 0);
  });
});

test("reusable workflow source requires exact SHA, not a mutable ref", () => {
  const fixture = githubGitFixture();
  const base = capabilityBase();
  base.controller_release.job_workflow_ref =
    "Joey-Tools/codex-review-gate-action/.github/workflows/" +
    "codex-review-gate.yml@refs/tags/v2";
  base.protection.source_workflow_pin.job_workflow_ref =
    base.controller_release.job_workflow_ref;
  assert.throws(
    () => makeLedger(fixture, sealCapability(base)),
    /exact-SHA ref/u,
  );
  assert.equal(fixture.writeCalls, 0);
});

test("multi-parent, noncanonical bytes, and digest tampering fail closed", async (t) => {
  await t.test("multi-parent", async () => {
    const fixture = githubGitFixture();
    const ledger = makeLedger(fixture);
    await ledger.bootstrapCapability();
    fixture.commits.get(fixture.refTarget).parents.push({ sha: "f".repeat(40) });
    await assert.rejects(
      ledger.load(),
      (error) => error.code === "multi-parent",
    );
  });

  await t.test("tree identity", async () => {
    const fixture = githubGitFixture();
    const ledger = makeLedger(fixture);
    await ledger.bootstrapCapability();
    const commit = fixture.commits.get(fixture.refTarget);
    const tree = fixture.trees.get(commit.tree.sha);
    tree.tree[0].sha = "f".repeat(40);
    await assert.rejects(
      ledger.load(),
      (error) => error.code === "tree-identity",
    );
  });

  await t.test("commit identity", async () => {
    const fixture = githubGitFixture();
    const ledger = makeLedger(fixture);
    await ledger.bootstrapCapability();
    fixture.commits.get(fixture.refTarget).author.name = "Untrusted Writer";
    await assert.rejects(
      ledger.load(),
      (error) => error.code === "commit-identity",
    );
  });

  await t.test("noncanonical blob", async () => {
    const fixture = githubGitFixture();
    const ledger = makeLedger(fixture);
    await ledger.bootstrapCapability();
    fixture.rewriteTipText((text) => ` ${text}`);
    await assert.rejects(
      ledger.load(),
      (error) => error.code === "noncanonical-blob",
    );
  });

  await t.test("tampered envelope", async () => {
    const fixture = githubGitFixture();
    const ledger = makeLedger(fixture);
    await ledger.bootstrapCapability();
    fixture.rewriteTipEnvelope((envelope) => {
      envelope.payload.protection_receipt_digest = `sha256:${"0".repeat(64)}`;
    });
    await assert.rejects(
      ledger.load(),
      /digest is invalid/u,
    );
  });

  await t.test("tampered stored JWT", async () => {
    const fixture = githubGitFixture();
    const ledger = makeLedger(fixture);
    await ledger.bootstrapCapability();
    fixture.rewriteTipEnvelope((envelope) => {
      envelope.workflow_provenance_jwt =
        `${envelope.workflow_provenance_jwt}A`;
      resealEnvelope(envelope);
    });
    await assert.rejects(
      ledger.load(),
      /JWT digest differs/u,
    );
  });
});

test("reachable history rejects duplicate effect and idempotency identities", async (t) => {
  async function historyWithTwoIntents() {
    const fixture = githubGitFixture();
    const ledger = makeLedger(fixture);
    await ledger.bootstrapCapability();
    const lease = (await acquireDefaultDiscovery(ledger)).lease_receipt;
    const first = await ledger.appendRecord(effectRecord({
      predecessor: lease.acquire_commit_sha,
      lease,
      effectId: "effect-first",
      idempotencyKey: "key-first",
      at: TIME,
    }));
    await ledger.appendRecord(effectRecord({
      predecessor: first.commit_sha,
      lease,
      effectId: "effect-second",
      idempotencyKey: "key-second",
      at: TIME,
    }));
    return { fixture, ledger };
  }

  await t.test("duplicate effect", async () => {
    const { fixture, ledger } = await historyWithTwoIntents();
    fixture.rewriteTipEnvelope((envelope) => {
      envelope.effect_id = "effect-first";
      envelope.workflow_provenance.operation_binding.record_identity.effect_id =
        "effect-first";
      resealProvenance(envelope.workflow_provenance);
      resealEnvelope(envelope);
    });
    await assert.rejects(
      ledger.load(),
      (error) => error.code === "duplicate-effect",
    );
  });

  await t.test("duplicate idempotency", async () => {
    const { fixture, ledger } = await historyWithTwoIntents();
    fixture.rewriteTipEnvelope((envelope) => {
      envelope.idempotency_key = "key-first";
      envelope.workflow_provenance.operation_binding.record_identity
        .idempotency_key = "key-first";
      resealProvenance(envelope.workflow_provenance);
      resealEnvelope(envelope);
    });
    await assert.rejects(
      ledger.load(),
      (error) => error.code === "duplicate-idempotency",
    );
  });
});

test("lease expiry and release both prevent later effects without refund", async () => {
  const fixture = githubGitFixture();
  const ledger = makeLedger(fixture);
  await ledger.bootstrapCapability();
  const lease = (await acquireDefaultDiscovery(ledger)).lease_receipt;
  fixture.advanceServerTime(700);

  const postsBeforeExpiry = fixture.writeCalls;
  await assert.rejects(
    ledger.appendRecord(effectRecord({
      predecessor: lease.acquire_commit_sha,
      lease,
      effectId: "expired-effect",
      idempotencyKey: "expired-key",
      at: TIME,
    })),
    (error) => error.code === "lease-required" || error.code === "lease-expired",
  );
  assert.equal(fixture.writeCalls, postsBeforeExpiry,
    "expired lease rejection must occur before Git object writes");

  const fixture2 = githubGitFixture();
  const ledger2 = makeLedger(fixture2);
  await ledger2.bootstrapCapability();
  const lease2 = (await acquireDefaultDiscovery(ledger2)).lease_receipt;
  const release = await ledger2.releaseLease({
    predecessor_commit_sha: lease2.acquire_commit_sha,
    lease_receipt: lease2,
    released_at: TIME,
    control_comment_binding: null,
  });
  const writesBeforeReleased = fixture2.writeCalls;
  await assert.rejects(
    ledger2.appendRecord(effectRecord({
      predecessor: release.commit_sha,
      lease: lease2,
      effectId: "released-effect",
      idempotencyKey: "released-key",
      at: TIME,
    })),
    (error) => error.code === "lease-required",
  );
  assert.equal(fixture2.writeCalls, writesBeforeReleased,
    "released lease rejection must occur before Git object writes");
});

test("absent ref and exact ref reread mismatch fail closed", async () => {
  const absentFixture = githubGitFixture();
  await assert.rejects(
    makeLedger(absentFixture).load(),
    (error) => error.code === "ref-absent",
  );

  const fixture = githubGitFixture();
  const ledger = makeLedger(fixture);
  await ledger.bootstrapCapability();
  const initial = await ledger.load();
  fixture.mismatchNextRefReread();
  await assert.rejects(
    ledger.acquireLease(leaseInput(initial.tip_commit_sha)),
    (error) => error.code === "ref-reread-mismatch",
  );
});

test("an unattested canary tip is recovered by a new sealed race", async () => {
  const fixture = githubGitFixture();
  const ledger = makeLedger(fixture);
  fixture.failNextAttestationUpdate();
  await assert.rejects(
    ledger.bootstrapCapability(),
    (error) => error.code === "unexpected-http-status",
  );
  assert.equal(fixture.tipRecordType(), "capability-canary");
  const writesBeforeRecovery = fixture.writeCalls;
  await assert.rejects(
    ledger.load(),
    (error) => error.code === "capability-recovery-required",
  );
  assert.equal(fixture.writeCalls, writesBeforeRecovery,
    "production access cannot advance an unattested capability canary");

  const recovered = await ledger.bootstrapCapability();
  assert.equal(recovered.already_current, false);
  const loaded = await ledger.load();
  assert.deepEqual(
    loaded.records.map((entry) => entry.envelope.record_type),
    ["genesis", "capability-canary", "capability-canary", "capability-attestation"],
  );
  assert.deepEqual(
    loaded.records.at(-1).envelope.payload.recovered_unattested_canary_commits,
    [loaded.records[1].commit_sha],
  );
});

test("a new capability epoch revalidates old JWTs under their embedded authority", async () => {
  const fixture = githubGitFixture();
  const original = makeLedger(fixture);
  await original.bootstrapCapability();
  const originalLoad = await original.load();

  const nextBase = capabilityBase();
  const nextRulesetDigest = `sha256:${"a".repeat(64)}`;
  nextBase.permissions.observation_receipt_digest = `sha256:${"b".repeat(64)}`;
  nextBase.protection.live_ruleset_receipt_digest = nextRulesetDigest;
  nextBase.ruleset_receipt.receipt_digest = nextRulesetDigest;
  nextBase.ruleset_receipt.protection_digest = nextRulesetDigest;
  nextBase.protection_receipt.protection_digest = nextRulesetDigest;
  nextBase.protection_receipt.ruleset_receipt_digest = nextRulesetDigest;
  nextBase.protection_receipt.receipt_digest = `sha256:${"c".repeat(64)}`;
  const nextCapability = sealCapability(nextBase);
  const nextVerifier = provenanceVerifier({ jtiPrefix: "epoch-two-jti" });
  const restricted = createV2GitHubGitLedgerBootstrap({
    fetch: fixture.fetch,
    token: SYNTHETIC_BEARER,
    repository: REPOSITORY,
    ledgerRef: V2_GIT_LEDGER_REF,
    restBaseUrl: "https://api.github.test",
    bootstrapCapabilityInput: bootstrapInputForCapability(nextCapability),
    verifyWorkflowProvenance: nextVerifier,
  });
  const epoch = await restricted.bootstrapCapability();
  const current = await epoch.ledger.load();
  assert.notEqual(
    current.capability.capability_input_digest,
    originalLoad.capability.capability_input_digest,
  );
  assert.ok(current.commit_count > originalLoad.commit_count);
  await assert.rejects(
    original.load(),
    (error) => error.code === "capability-attestation-required",
  );
});

test("control comment creation is intent-null then exact response-bound", async () => {
  const fixture = githubGitFixture();
  const ledger = makeLedger(fixture);
  await ledger.bootstrapCapability();
  const lease = (await acquireDefaultDiscovery(ledger)).lease_receipt;
  const intent = createV2GitLedgerRecord({
    record_type: "effect-intent",
    predecessor_commit_sha: lease.acquire_commit_sha,
    pull_request: PR,
    head_ref_oid: HEAD,
    base_ref_oid: BASE,
    potential_merge_commit_oid: POTENTIAL,
    kind: "control-comment-create",
    effect_id: "control-comment-1",
    idempotency_key: "control-comment-create-1",
    server_observed_at: TIME,
    payload: effectPayload({
      phase: "intent",
      kind: "control-comment-create",
      predecessor: lease.acquire_commit_sha,
      action: {
        method: "POST",
        body_digest: `sha256:${"4".repeat(64)}`,
        pre_comment_inventory_digest: `sha256:${"5".repeat(64)}`,
      },
    }),
    control_comment_binding: null,
    lease: leaseBinding(lease),
  });
  const intentReceipt = await ledger.appendRecord(intent);
  const responseRecord = createV2GitLedgerRecord({
    record_type: "effect-response",
    predecessor_commit_sha: intentReceipt.commit_sha,
    pull_request: PR,
    head_ref_oid: HEAD,
    base_ref_oid: BASE,
    potential_merge_commit_oid: POTENTIAL,
    kind: "control-comment-create",
    effect_id: "control-comment-1",
    idempotency_key: "control-comment-create-1",
    server_observed_at: TIME,
    payload: effectPayload({
      phase: "response",
      kind: "control-comment-create",
      predecessor: intentReceipt.commit_sha,
      intentCommitSha: intentReceipt.commit_sha,
      action: {
        method: "POST",
        body_digest: `sha256:${"4".repeat(64)}`,
        pre_comment_inventory_digest: `sha256:${"5".repeat(64)}`,
      },
      receipt: {
        http_status: 201,
        server_time: TIME,
        raw_body_sha256: `sha256:${"6".repeat(64)}`,
        comment: CONTROL,
        actor: ACTOR,
        app: APP,
        pre_comment_inventory_digest: `sha256:${"5".repeat(64)}`,
        post_comment_inventory_digest: `sha256:${"7".repeat(64)}`,
      },
    }),
    control_comment_binding: CONTROL,
    lease: leaseBinding(lease),
  });
  await ledger.appendRecord(responseRecord);
  const loaded = await ledger.load();
  assert.deepEqual(loaded.control_comment_binding, CONTROL);
  assert.deepEqual(loaded.projection.control_comment_binding, CONTROL);

  const {
    schema: _schema,
    schema_version: _version,
    payload_digest: _payloadDigest,
    record_digest: _recordDigest,
    ...intentPlan
  } = intent;
  const createAgain = createV2GitLedgerRecord({
    ...structuredClone(intentPlan),
    predecessor_commit_sha: loaded.tip_commit_sha,
    effect_id: "control-comment-2",
    idempotency_key: "control-comment-create-2",
    payload: {
      ...structuredClone(intentPlan.payload),
      predecessor_commit_sha: loaded.tip_commit_sha,
    },
  });
  const writes = fixture.writeCalls;
  await assert.rejects(
    ledger.appendRecord(createAgain),
    (error) => error.code === "control-comment-exists",
  );
  assert.equal(fixture.writeCalls, writes);
});

test("GitHub ref Date, not caller clock, controls record and lease time", async () => {
  const fixture = githubGitFixture();
  const ledger = makeLedger(fixture);
  await ledger.bootstrapCapability();
  const lease = (await acquireDefaultDiscovery(ledger)).lease_receipt;
  assert.equal(Date.parse(lease.acquired_at) > Date.parse(TIME), true);
  assert.equal(
    Date.parse(lease.expires_at) - Date.parse(lease.acquired_at),
    600_000,
  );
  const receipt = await ledger.appendRecord(effectRecord({
    predecessor: lease.acquire_commit_sha,
    lease,
    effectId: "backdated-effect",
    idempotencyKey: "backdated-key",
    at: TIME,
  }));
  const loaded = await ledger.load();
  const actual = loaded.records.find((entry) => entry.commit_sha === receipt.commit_sha);
  assert.equal(Date.parse(actual.envelope.server_observed_at) > Date.parse(TIME), true);

  const future = effectRecord({
    predecessor: loaded.tip_commit_sha,
    lease,
    effectId: "future-effect",
    idempotencyKey: "future-key",
    at: "2099-01-01T00:00:00.000Z",
  });
  const writes = fixture.writeCalls;
  await assert.rejects(
    ledger.appendRecord(future),
    (error) => error.code === "caller-clock-ahead",
  );
  assert.equal(fixture.writeCalls, writes);
});

test("final ref Date fence rejects a lease too short for the bounded append", async () => {
  const fixture = githubGitFixture();
  const ledger = makeLedger(fixture);
  await ledger.bootstrapCapability();
  const lease = (await acquireDefaultDiscovery(ledger)).lease_receipt;
  fixture.advanceServerTime(480);
  const writes = fixture.writeCalls;
  await assert.rejects(
    ledger.appendRecord(effectRecord({
      predecessor: lease.acquire_commit_sha,
      lease,
      effectId: "short-write-window",
      idempotencyKey: "short-write-window-key",
      at: TIME,
    })),
    (error) => error.code === "lease-write-window",
  );
  assert.equal(fixture.writeCalls, writes,
    "lease safety-window rejection must precede Git object writes");
});

test("two-pass load rejects a ref that moves during chain traversal", async () => {
  const fixture = githubGitFixture();
  const ledger = makeLedger(fixture);
  await ledger.bootstrapCapability();
  fixture.moveRefToParentOnNextCommitRead();
  await assert.rejects(
    ledger.load(),
    (error) => error.code === "unstable-ref",
  );
});

test("workflow provenance failures reject before Git object writes", async (t) => {
  await t.test("missing verifier", () => {
    const fixture = githubGitFixture();
    const input = factoryInput(fixture, capabilityReceipt());
    delete input.verifyWorkflowProvenance;
    assert.throws(
      () => createV2GitHubGitLedger(input),
      /requires verifyWorkflowProvenance/u,
    );
    assert.equal(fixture.writeCalls, 0);
  });

  for (const [name, mutate, pattern] of [
    ["missing required claim", (receipt) => {
      delete receipt.claims.job_workflow_sha;
    }, /closed required set/u],
    ["expired token", (receipt) => {
      receipt.claims.exp = 1;
    }, /server-time window/u],
    ["wrong pull request SHA", (receipt) => {
      receipt.claims.sha = HEAD;
    }, /trigger identity|exact effect scope/u],
  ]) {
    await t.test(name, async () => {
      const fixture = githubGitFixture();
      const baseVerifier = provenanceVerifier();
      let verifierOrdinal = 0;
      let failureEnabled = false;
      const failing = makeLedger(fixture, capabilityReceipt(), async (request) => {
        if (request.mode === "reverify-stored" || !failureEnabled) {
          return baseVerifier(request);
        }
        verifierOrdinal += 1;
        const result = structuredClone(await baseVerifier(request));
        const receipt = result.receipt;
        delete receipt.receipt_digest;
        receipt.claims.jti = `negative-${name}-${verifierOrdinal}`;
        mutate(receipt);
        receipt.receipt_digest = digestCanonical(
          "codex-review-gate-v2-git-ledger-provenance",
          receipt,
        );
        return result;
      });
      await failing.bootstrapCapability();
      const lease = (await acquireDefaultDiscovery(failing)).lease_receipt;
      const writes = fixture.writeCalls;
      failureEnabled = true;
      await assert.rejects(
        failing.appendRecord(effectRecord({
          predecessor: lease.acquire_commit_sha,
          lease,
          effectId: `invalid-${name}`,
          idempotencyKey: `invalid-key-${name}`,
          at: TIME,
        })),
        pattern,
      );
      assert.equal(fixture.writeCalls, writes);
    });
  }
});

test("workflow provenance verifier has an abortable hard deadline", async () => {
  const fixture = githubGitFixture();
  const setup = makeLedger(fixture);
  await setup.bootstrapCapability();
  let observedSignal = null;
  const stalled = createV2GitHubGitLedger({
    ...factoryInput(fixture, capabilityReceipt()),
    provenanceTimeoutMs: 5,
    verifyWorkflowProvenance: async (_request, { signal, deadline_ms }) => {
      assert.equal(deadline_ms, 5);
      observedSignal = signal;
      return new Promise((resolve, reject) => {
        void resolve;
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    },
  });
  const writes = fixture.writeCalls;
  await assert.rejects(
    stalled.load(),
    (error) => error.code === "provenance-timeout",
  );
  assert.equal(observedSignal?.aborted, true);
  assert.equal(fixture.writeCalls, writes);
});

test("replayed OIDC jti and open effect payloads fail closed", async (t) => {
  await t.test("jti replay", async () => {
    const fixture = githubGitFixture();
    const repeated = provenanceVerifier({ fixedJti: "replayed-oidc-jti" });
    const ledger = makeLedger(fixture, capabilityReceipt(), repeated);
    await assert.rejects(
      ledger.bootstrapCapability(),
      (error) => error.code === "duplicate-provenance-identity",
    );
    assert.equal(fixture.tipRecordType(), "genesis");
  });

  await t.test("unknown payload key", async () => {
    const predecessor = "1".repeat(40);
    const payload = effectPayload({
      phase: "intent",
      kind: "review-request",
      predecessor,
      generation: automaticGeneration(1),
      action: {
        method: "POST",
        request_body_sha256: `sha256:${"1".repeat(64)}`,
      },
    });
    payload.action.untrusted = true;
    assert.throws(
      () => createV2GitLedgerRecord({
        record_type: "effect-intent",
        predecessor_commit_sha: predecessor,
        pull_request: PR,
        head_ref_oid: HEAD,
        base_ref_oid: BASE,
        potential_merge_commit_oid: POTENTIAL,
        kind: "review-request",
        effect_id: "open-payload",
        idempotency_key: "open-payload-key",
        server_observed_at: TIME,
        payload,
        control_comment_binding: null,
        lease: {
          lease_id: "lease-open",
          owner: OWNER,
          acquire_commit_sha: "2".repeat(40),
          expires_at: "2026-08-13T12:10:00.000Z",
        },
      }),
      /closed key set/u,
    );
  });
});

test("OIDC jti is optional and exact JWT bytes become the replay identity", async () => {
  const fixture = githubGitFixture();
  const ledger = makeLedger(
    fixture,
    capabilityReceipt(),
    provenanceVerifier({ omitJti: true }),
  );
  await ledger.bootstrapCapability();
  const loaded = await ledger.load();
  assert.equal(
    loaded.record_manifest.every((entry) =>
      entry.workflow_provenance_jti.startsWith("jwt:sha256:")),
    true,
  );
});

test("reachable JWTs are live-reverified but never returned or leaked by errors", async (t) => {
  const fixture = githubGitFixture();
  const ledger = makeLedger(fixture);
  await ledger.bootstrapCapability();
  const storedTokens = [...fixture.blobs.values()].map((blob) =>
    JSON.parse(blob.content).workflow_provenance_jwt);
  assert.ok(storedTokens.length >= 3);

  const baseVerifier = provenanceVerifier({ fixedJti: "live-load-jti" });
  const liveVerifier = async (request) => {
    const result = structuredClone(await baseVerifier(request));
    if (request.mode === "reverify-stored") {
      assert.match(request.stored_receipt.receipt_digest, /^sha256:/u);
      assert.equal(request.stored_receipt.token_sha256,
        rawDigest(request.compact_jwt));
      result.receipt.discovery.server_time =
        "2026-08-13T13:00:00.000Z";
      result.receipt.discovery.raw_body_sha256 = `sha256:${"8".repeat(64)}`;
      result.receipt.jwks.server_time = "2026-08-13T13:00:01.000Z";
      result.receipt.jwks.raw_body_sha256 = `sha256:${"9".repeat(64)}`;
      delete result.receipt.receipt_digest;
      result.receipt.receipt_digest = digestCanonical(
        "codex-review-gate-v2-git-ledger-provenance",
        result.receipt,
      );
    }
    return result;
  };
  const reverified = createV2GitHubGitLedger({
    ...factoryInput(fixture, capabilityReceipt()),
    verifyWorkflowProvenance: liveVerifier,
  });
  const loaded = await reverified.load();
  assert.equal(loaded.records[0].envelope.schema,
    V2_GIT_LEDGER_PUBLIC_ENVELOPE_SCHEMA);
  assert.equal(loaded.provenance_reverification.length, loaded.commit_count);
  assert.equal(loaded.provenance_reverification[0].discovery.server_time,
    "2026-08-13T13:00:00.000Z");
  const serialized = JSON.stringify(loaded);
  assert.doesNotMatch(serialized, /workflow_provenance_jwt/u);
  for (const token of storedTokens) assert.equal(serialized.includes(token), false);

  await t.test("kid rotation is typed and token-redacted", async () => {
    const token = storedTokens[0];
    const failing = createV2GitHubGitLedger({
      ...factoryInput(fixture, capabilityReceipt()),
      verifyWorkflowProvenance: async (request) => {
        if (request.mode === "reverify-stored") {
          const error = new Error(request.compact_jwt);
          error.code = "oidc-kid-unavailable";
          throw error;
        }
        return baseVerifier(request);
      },
    });
    let caught;
    try {
      await failing.load();
    } catch (error) {
      caught = error;
    }
    assert.equal(caught.code, "oidc-kid-unavailable");
    assert.equal(caught.message.includes(token), false);
    assert.equal(caught.cause, undefined);
    assert.equal(JSON.stringify(caught).includes(token), false);
  });
});

test("jti-less OIDC replay and operation audience tampering fail before writes", async (t) => {
  await t.test("replayed exact JWT digest", async () => {
    const fixture = githubGitFixture();
    const baseVerifier = provenanceVerifier({ omitJti: true });
    let repeated = null;
    const repeatedToken = async (request) => {
      const result = structuredClone(await baseVerifier(request));
      repeated ??= request.mode === "mint-and-verify"
        ? result.compact_jwt
        : request.compact_jwt;
      if (request.mode === "mint-and-verify") {
        result.compact_jwt = repeated;
      }
      result.receipt.token_sha256 = rawDigest(repeated);
      delete result.receipt.receipt_digest;
      result.receipt.receipt_digest = digestCanonical(
        "codex-review-gate-v2-git-ledger-provenance",
        result.receipt,
      );
      return result;
    };
    const ledger = makeLedger(fixture, capabilityReceipt(), repeatedToken);
    await assert.rejects(
      ledger.bootstrapCapability(),
      (error) => error.code === "duplicate-provenance-identity",
    );
    assert.equal(fixture.tipRecordType(), "genesis");
  });

  await t.test("effect-bound audience", async () => {
    const fixture = githubGitFixture();
    const baseVerifier = provenanceVerifier();
    const badAudience = async (request) => {
      const result = structuredClone(await baseVerifier(request));
      const receipt = result.receipt;
      receipt.audience = `${V2_GIT_LEDGER_OIDC_AUDIENCE}:wrong`;
      receipt.claims.aud = receipt.audience;
      delete receipt.receipt_digest;
      receipt.receipt_digest = digestCanonical(
        "codex-review-gate-v2-git-ledger-provenance",
        receipt,
      );
      return result;
    };
    const restricted = createV2GitHubGitLedgerBootstrap({
      fetch: fixture.fetch,
      token: SYNTHETIC_BEARER,
      repository: REPOSITORY,
      ledgerRef: V2_GIT_LEDGER_REF,
      restBaseUrl: "https://api.github.test",
      bootstrapCapabilityInput: bootstrapInput(),
      verifyWorkflowProvenance: badAudience,
    });
    await assert.rejects(
      restricted.bootstrapCapability(),
      /exact operation and source/u,
    );
    assert.equal(fixture.writeCalls, 0);
  });
});

test("HTTP transport caps declared, streamed, aggregate, and stalled bodies", async (t) => {
  await t.test("declared response bytes", async () => {
    const ledger = createV2GitHubGitLedger({
      ...factoryInput({
        fetch: async () => new Response("{}", {
          status: 200,
          headers: {
            Date: new Date(TIME).toUTCString(),
            "Content-Length": "3",
          },
        }),
      }, capabilityReceipt()),
      httpLimits: { ...V2_GIT_LEDGER_HTTP_LIMITS, response_bytes: 2 },
    });
    await assert.rejects(
      ledger.load(),
      (error) => error.code === "http-response-cap",
    );
  });

  await t.test("streamed response bytes", async () => {
    const ledger = createV2GitHubGitLedger({
      ...factoryInput({
        fetch: async () => new Response("{}", {
          status: 200,
          headers: { Date: new Date(TIME).toUTCString() },
        }),
      }, capabilityReceipt()),
      httpLimits: { ...V2_GIT_LEDGER_HTTP_LIMITS, response_bytes: 1 },
    });
    await assert.rejects(
      ledger.load(),
      (error) => error.code === "http-response-cap",
    );
  });

  await t.test("aggregate response bytes", async () => {
    const ledger = createV2GitHubGitLedger({
      ...factoryInput({
        fetch: async () => new Response("{}", {
          status: 200,
          headers: { Date: new Date(TIME).toUTCString() },
        }),
      }, capabilityReceipt()),
      httpLimits: { ...V2_GIT_LEDGER_HTTP_LIMITS, total_response_bytes: 1 },
    });
    await assert.rejects(
      ledger.load(),
      (error) => error.code === "http-total-byte-cap",
    );
  });

  await t.test("request count", async () => {
    let calls = 0;
    const ledger = createV2GitHubGitLedger({
      ...factoryInput({
        fetch: async () => {
          calls += 1;
          return new Response(JSON.stringify({
            ref: V2_GIT_LEDGER_REF,
            node_id: "REF_ledger",
            object: { type: "commit", sha: "1".repeat(40) },
          }), {
            status: 200,
            headers: { Date: new Date(TIME).toUTCString() },
          });
        },
      }, capabilityReceipt()),
      httpLimits: { ...V2_GIT_LEDGER_HTTP_LIMITS, request_count: 1 },
    });
    await assert.rejects(
      ledger.load(),
      (error) => error.code === "http-request-cap",
    );
    assert.equal(calls, 1);
  });

  await t.test("stalled body timeout", async () => {
    const body = new ReadableStream({
      start() {},
    });
    const ledger = createV2GitHubGitLedger({
      ...factoryInput({
        fetch: async () => new Response(body, {
          status: 200,
          headers: { Date: new Date(TIME).toUTCString() },
        }),
      }, capabilityReceipt()),
      httpLimits: { ...V2_GIT_LEDGER_HTTP_LIMITS, timeout_ms: 5 },
    });
    await assert.rejects(
      ledger.load(),
      (error) => error.code === "http-timeout",
    );
  });
});

test("status-write binds its exact target role and accepts clean success", () => {
  const predecessor = "1".repeat(40);
  const primaryIntent = createV2GitLedgerRecord({
    record_type: "effect-intent",
    predecessor_commit_sha: predecessor,
    pull_request: PR,
    head_ref_oid: HEAD,
    base_ref_oid: BASE,
    potential_merge_commit_oid: POTENTIAL,
    kind: "status-write",
    effect_id: "status-primary-success",
    idempotency_key: "status-primary-success-key",
    server_observed_at: TIME,
    payload: effectPayload({
      phase: "intent",
      kind: "status-write",
      predecessor,
      action: {
        mode: "test-merge-with-head-sentinel",
        target_sha: POTENTIAL,
        role: "primary-terminal",
        context: "codex/github-review-gate",
        state: "success",
        description_digest: `sha256:${"1".repeat(64)}`,
        scheduler_observation_record_oid: "3".repeat(40),
        scheduler_action_key: "publish-status:test",
        scheduler_plan_digest: `sha256:${"3".repeat(64)}`,
        status_plan_digest: `sha256:${"4".repeat(64)}`,
        status_write_index: 0,
        status_write_count: 1,
      },
    }),
    control_comment_binding: null,
    lease: {
      lease_id: "lease-status",
      owner: OWNER,
      acquire_commit_sha: "2".repeat(40),
      expires_at: "2026-08-13T12:10:00.000Z",
    },
  });
  assert.equal(primaryIntent.payload.action.state, "success");
  assert.equal(primaryIntent.payload.action.target_sha, POTENTIAL);

  assert.throws(
    () => createV2GitLedgerRecord({
      ...recordPlan(primaryIntent),
      effect_id: "status-wrong-target",
      idempotency_key: "status-wrong-target-key",
      payload: effectPayload({
        phase: "intent",
        kind: "status-write",
        predecessor,
        action: {
          ...primaryIntent.payload.action,
          target_sha: HEAD,
        },
      }),
    }),
    /target does not match/u,
  );
  for (const action of [
    {
      ...primaryIntent.payload.action,
      mode: "head",
      role: "head-sentinel",
      target_sha: HEAD,
    },
    {
      ...primaryIntent.payload.action,
      mode: "head",
      role: "primary-terminal",
      target_sha: HEAD,
      state: "failure",
    },
  ]) {
    assert.throws(
      () => createV2GitLedgerRecord({
        ...recordPlan(primaryIntent),
        effect_id: `status-forbidden-head-${action.role}`,
        idempotency_key: `status-forbidden-head-key-${action.role}`,
        payload: effectPayload({
          phase: "intent",
          kind: "status-write",
          predecessor,
          action,
        }),
      }),
      /target does not match/u,
    );
  }
});

test("status-only builder binds one protected scheduler write through exact refetch", async () => {
  const fixture = githubGitFixture();
  const context = await createProtectedInitialRunnerContext(fixture);
  const plan = schedulerObservationRecord({
    predecessor: context.lease.acquire_commit_sha,
    lease: context.lease,
    priorAuthorityDigest: context.initialAuthority.prior_authority_digest,
    initialAuthority: context.initialAuthority,
  }).payload.action;
  const schedulerAppend = await context.ledger
    .appendInitialSchedulerObservation({
      initial_runner_state_authority: context.initialAuthority,
      scheduler_evaluation: plan.scheduler_evaluation,
      status_plan: plan.status_plan,
    });
  const writesBeforeForgery = fixture.writeCalls;
  await assert.rejects(
    context.ledger.appendStatusWriteIntent({
      scheduler_append: structuredClone(schedulerAppend),
      status_write_index: 0,
    }),
    (error) => error.code === "UNTRUSTED_SCHEDULER_APPEND_HANDLE",
  );
  await assert.rejects(
    context.ledger.appendStatusWriteIntent({
      scheduler_append: schedulerAppend,
      status_write_index: 1,
    }),
    (error) => error.code === "status-write-index-unsupported",
  );
  assert.equal(fixture.writeCalls, writesBeforeForgery);

  const intent = await context.ledger.appendStatusWriteIntent({
    scheduler_append: schedulerAppend,
    status_write_index: 0,
  });
  assert.equal(
    assertV2GitLedgerStatusWriteIntentHandle(intent.status_intent_handle),
    intent.status_intent_handle,
  );
  assert.deepEqual(
    projectV2GitLedgerStatusWriteTransport(intent.status_intent_handle),
    intent.transport,
  );
  assert.deepEqual(intent.transport, {
    method: "POST",
    target_sha: HEAD,
    role: "head-sentinel",
    context: "codex/github-review-gate",
    state: "pending",
    description: "awaiting-terminal-test-merge-decision",
    description_digest: digestCanonical(
      "codex-review-gate-v2-status-description",
      { description: "awaiting-terminal-test-merge-decision" },
    ),
  });
  const loadedIntent = await context.ledger.load();
  assert.equal(loadedIntent.tip_commit_sha,
    intent.intent_append_receipt.commit_sha);
  const intentControl = await context.ledger.loadControlPlaneAuthority(
    context.initialAuthority.scope,
  );
  assert.equal(intentControl.scoped_authority.runner_state
    .status_inventory[0].response_record_oid, null);

  const responseReceipt = statusWriteResponseReceipt(
    intent.transport,
    intent.intent_append_receipt.ref_reread.server_time,
  );
  const beforeResponseForgery = fixture.writeCalls;
  await assert.rejects(
    context.ledger.appendStatusWriteResponse({
      status_intent_handle: structuredClone(intent.status_intent_handle),
      intent_append_receipt: intent.intent_append_receipt,
      receipt: responseReceipt,
    }),
    (error) => error.code === "UNTRUSTED_STATUS_WRITE_INTENT_HANDLE",
  );
  await assert.rejects(
    context.ledger.appendStatusWriteResponse({
      status_intent_handle: intent.status_intent_handle,
      intent_append_receipt: structuredClone(intent.intent_append_receipt),
      receipt: responseReceipt,
    }),
    (error) => error.code === "STATUS_WRITE_INTENT_RECEIPT_MISMATCH",
  );
  await assert.rejects(
    context.ledger.appendStatusWriteResponse({
      status_intent_handle: intent.status_intent_handle,
      intent_append_receipt: intent.intent_append_receipt,
      receipt: { ...responseReceipt, refetch_match_count: 2 },
    }),
    /unique status/u,
  );
  assert.equal(fixture.writeCalls, beforeResponseForgery);

  const response = await context.ledger.appendStatusWriteResponse({
    status_intent_handle: intent.status_intent_handle,
    intent_append_receipt: intent.intent_append_receipt,
    receipt: responseReceipt,
  });
  assert.equal(response.authoritative_status.status_id, "801");
  assert.equal(
    response.authoritative_status.response_record_oid,
    response.response_append_receipt.commit_sha,
  );
  const after = await context.ledger.load();
  assert.equal(after.tip_commit_sha, response.response_append_receipt.commit_sha);
  const responseControl = await context.ledger.loadControlPlaneAuthority(
    context.initialAuthority.scope,
  );
  assert.equal(
    responseControl.scoped_authority.runner_state.status_inventory[0]
      .response_record_oid,
    response.response_append_receipt.commit_sha,
  );
  const writesAfterResponse = fixture.writeCalls;
  await assert.rejects(
    context.ledger.appendStatusWriteResponse({
      status_intent_handle: intent.status_intent_handle,
      intent_append_receipt: intent.intent_append_receipt,
      receipt: responseReceipt,
    }),
    (error) => error.code === "status-write-response-replayed",
  );
  assert.equal(fixture.writeCalls, writesAfterResponse);
});

test("status-only builder rejects multi-write and stale scheduler authorities", async () => {
  const fixture = githubGitFixture();
  const context = await createProtectedInitialRunnerContext(fixture);
  const plan = schedulerObservationRecord({
    predecessor: context.lease.acquire_commit_sha,
    lease: context.lease,
    priorAuthorityDigest: context.initialAuthority.prior_authority_digest,
    initialAuthority: context.initialAuthority,
  }).payload.action;
  const schedulerAppend = await context.ledger
    .appendInitialSchedulerObservation({
      initial_runner_state_authority: context.initialAuthority,
      scheduler_evaluation: plan.scheduler_evaluation,
      status_plan: plan.status_plan,
    });
  const tampered = structuredClone(schedulerAppend);
  tampered.record.payload.action.status_plan.writes.push({
    ...structuredClone(tampered.record.payload.action.status_plan.writes[0]),
    idempotency_key: "status:forged-second-write",
  });
  await assert.rejects(
    context.ledger.appendStatusWriteIntent({
      scheduler_append: tampered,
      status_write_index: 0,
    }),
    (error) => error.code === "UNTRUSTED_SCHEDULER_APPEND_HANDLE",
  );
  await releaseFixtureDiscoveryLease(context.ledger, context.discovery);
  const writesBefore = fixture.writeCalls;
  await assert.rejects(
    context.ledger.appendStatusWriteIntent({
      scheduler_append: schedulerAppend,
      status_write_index: 0,
    }),
    (error) => error.code === "stale-scheduler-status-authority",
  );
  assert.equal(fixture.writeCalls, writesBefore);
});

test("automatic reservation and its nonrequired status bind one protected scheduler action", async () => {
  const fixture = githubGitFixture();
  const context = await createProtectedInitialRunnerContext(fixture);
  const plan = schedulerObservationRecord({
    predecessor: context.lease.acquire_commit_sha,
    lease: context.lease,
    priorAuthorityDigest: context.initialAuthority.prior_authority_digest,
    initialAuthority: context.initialAuthority,
  }).payload.action;
  const schedulerAppend = await context.ledger
    .appendInitialSchedulerObservation({
      initial_runner_state_authority: context.initialAuthority,
      scheduler_evaluation: plan.scheduler_evaluation,
      status_plan: plan.status_plan,
    });
  const requiredIntent = await context.ledger.appendStatusWriteIntent({
    scheduler_append: schedulerAppend,
    status_write_index: 0,
  });
  const writesBeforeUnboundStatus = fixture.writeCalls;
  await assert.rejects(
    context.ledger.appendAutomaticRequestReservation({
      scheduler_append: schedulerAppend,
    }),
    (error) => error.code === "automatic-request-required-status-unbound",
  );
  assert.equal(fixture.writeCalls, writesBeforeUnboundStatus);
  await context.ledger.appendStatusWriteResponse({
    status_intent_handle: requiredIntent.status_intent_handle,
    intent_append_receipt: requiredIntent.intent_append_receipt,
    receipt: statusWriteResponseReceipt(
      requiredIntent.transport,
      requiredIntent.intent_append_receipt.ref_reread.server_time,
    ),
  });
  const writesBeforeForgery = fixture.writeCalls;
  await assert.rejects(
    context.ledger.appendAutomaticRequestReservation({
      scheduler_append: structuredClone(schedulerAppend),
    }),
    (error) => error.code === "UNTRUSTED_SCHEDULER_APPEND_HANDLE",
  );
  assert.equal(fixture.writeCalls, writesBeforeForgery);

  const automatic = await context.ledger.appendAutomaticRequestReservation({
    scheduler_append: schedulerAppend,
  });
  assert.equal(
    assertV2GitLedgerAutomaticReservationHandle(
      automatic.automatic_reservation_handle,
    ),
    automatic.automatic_reservation_handle,
  );
  assert.deepEqual(
    projectV2GitLedgerAutomaticReservation(
      automatic.automatic_reservation_handle,
    ),
    automatic.reservation,
  );
  assert.equal(automatic.reservation.ordinal, 1);
  assert.equal(automatic.reservation.body, "@codex review");

  const writesBeforeStatusForgery = fixture.writeCalls;
  await assert.rejects(
    context.ledger.appendReservationStatusWriteIntent({
      automatic_reservation_handle: structuredClone(
        automatic.automatic_reservation_handle,
      ),
      reservation_append_receipt: automatic.reservation_append_receipt,
    }),
    (error) => error.code === "UNTRUSTED_AUTOMATIC_RESERVATION_HANDLE",
  );
  await assert.rejects(
    context.ledger.appendReservationStatusWriteIntent({
      automatic_reservation_handle: automatic.automatic_reservation_handle,
      reservation_append_receipt: structuredClone(
        automatic.reservation_append_receipt,
      ),
    }),
    (error) => error.code === "AUTOMATIC_RESERVATION_RECEIPT_MISMATCH",
  );
  assert.equal(fixture.writeCalls, writesBeforeStatusForgery);

  const intent = await context.ledger.appendReservationStatusWriteIntent({
    automatic_reservation_handle: automatic.automatic_reservation_handle,
    reservation_append_receipt: automatic.reservation_append_receipt,
  });
  assert.equal(
    assertV2GitLedgerReservationStatusIntentHandle(
      intent.reservation_status_intent_handle,
    ),
    intent.reservation_status_intent_handle,
  );
  assert.deepEqual(
    projectV2GitLedgerReservationStatusTransport(
      intent.reservation_status_intent_handle,
    ),
    intent.transport,
  );
  assert.deepEqual(intent.transport, {
    method: "POST",
    target_sha: HEAD,
    context: "codex/github-review-gate-reservation/1",
    state: "pending",
    description: automatic.reservation.reservation_digest,
    description_digest: automatic.reservation.reservation_digest,
  });

  const responseReceipt = reservationStatusWriteResponseReceipt(
    intent.transport,
    intent.intent_append_receipt.ref_reread.server_time,
  );
  const writesBeforeResponseForgery = fixture.writeCalls;
  await assert.rejects(
    context.ledger.appendReservationStatusWriteResponse({
      reservation_status_intent_handle: structuredClone(
        intent.reservation_status_intent_handle,
      ),
      intent_append_receipt: intent.intent_append_receipt,
      receipt: responseReceipt,
    }),
    (error) => error.code === "UNTRUSTED_RESERVATION_STATUS_INTENT_HANDLE",
  );
  await assert.rejects(
    context.ledger.appendReservationStatusWriteResponse({
      reservation_status_intent_handle:
        intent.reservation_status_intent_handle,
      intent_append_receipt: structuredClone(intent.intent_append_receipt),
      receipt: responseReceipt,
    }),
    (error) => error.code === "RESERVATION_STATUS_INTENT_RECEIPT_MISMATCH",
  );
  await assert.rejects(
    context.ledger.appendReservationStatusWriteResponse({
      reservation_status_intent_handle:
        intent.reservation_status_intent_handle,
      intent_append_receipt: intent.intent_append_receipt,
      receipt: { ...responseReceipt, refetch_match_count: 2 },
    }),
    /unique status/u,
  );
  assert.equal(fixture.writeCalls, writesBeforeResponseForgery);

  const response = await context.ledger.appendReservationStatusWriteResponse({
    reservation_status_intent_handle: intent.reservation_status_intent_handle,
    intent_append_receipt: intent.intent_append_receipt,
    receipt: responseReceipt,
  });
  assert.equal(response.authoritative_reservation.reservation_status_bound, true);
  assert.equal(
    response.authoritative_reservation.reservation_status_response_record_oid,
    response.response_append_receipt.commit_sha,
  );
  const final = await context.ledger.loadControlPlaneAuthority(
    context.initialAuthority.scope,
  );
  assert.equal(final.scoped_authority.runner_state.reservations[0]
    .reservation_status_bound, true);
  const writesAfterResponse = fixture.writeCalls;
  await assert.rejects(
    context.ledger.appendReservationStatusWriteResponse({
      reservation_status_intent_handle:
        intent.reservation_status_intent_handle,
      intent_append_receipt: intent.intent_append_receipt,
      receipt: responseReceipt,
    }),
    (error) => error.code === "reservation-status-response-replayed",
  );
  assert.equal(fixture.writeCalls, writesAfterResponse);
});

test("automatic reservation remains consumed when its status response is ambiguous", async () => {
  const fixture = githubGitFixture();
  const context = await createProtectedInitialRunnerContext(fixture);
  const plan = schedulerObservationRecord({
    predecessor: context.lease.acquire_commit_sha,
    lease: context.lease,
    priorAuthorityDigest: context.initialAuthority.prior_authority_digest,
    initialAuthority: context.initialAuthority,
  }).payload.action;
  const schedulerAppend = await context.ledger
    .appendInitialSchedulerObservation({
      initial_runner_state_authority: context.initialAuthority,
      scheduler_evaluation: plan.scheduler_evaluation,
      status_plan: plan.status_plan,
    });
  await appendRequiredStatusForScheduler(context.ledger, schedulerAppend);
  const automatic = await context.ledger.appendAutomaticRequestReservation({
    scheduler_append: schedulerAppend,
  });
  const intent = await context.ledger.appendReservationStatusWriteIntent({
    automatic_reservation_handle: automatic.automatic_reservation_handle,
    reservation_append_receipt: automatic.reservation_append_receipt,
  });
  const before = fixture.writeCalls;
  await assert.rejects(
    context.ledger.appendReservationStatusWriteResponse({
      reservation_status_intent_handle:
        intent.reservation_status_intent_handle,
      intent_append_receipt: intent.intent_append_receipt,
      receipt: {
        ...reservationStatusWriteResponseReceipt(
          intent.transport,
          intent.intent_append_receipt.ref_reread.server_time,
        ),
        refetch_match_count: 0,
      },
    }),
    /unique status/u,
  );
  assert.equal(fixture.writeCalls, before);
  const loaded = await context.ledger.loadControlPlaneAuthority(
    context.initialAuthority.scope,
  );
  assert.equal(loaded.scoped_authority.runner_state
    .head_ledger.automatic_request_count, 1);
  assert.equal(loaded.scoped_authority.runner_state.reservations[0]
    .reservation_status_bound, false);
  assert.equal(loaded.scoped_authority.runner_state.reservations[0]
    .reservation_status_intent_record_oid,
  intent.intent_append_receipt.commit_sha);
  const writesBeforeReplay = fixture.writeCalls;
  await assert.rejects(
    context.ledger.appendAutomaticRequestReservation({
      scheduler_append: schedulerAppend,
    }),
    (error) => error.code === "automatic-reservation-scheduler-replayed",
  );
  assert.equal(fixture.writeCalls, writesBeforeReplay);
});

test("automatic request intent durably records one retry-zero attempt before POST", async (t) => {
  await t.test("seals one attempt and review intent behind exact response authority", async () => {
    const fixture = githubGitFixture();
    const context = await createProtectedInitialRunnerContext(fixture);
    const plan = schedulerObservationRecord({
      predecessor: context.lease.acquire_commit_sha,
      lease: context.lease,
      priorAuthorityDigest: context.initialAuthority.prior_authority_digest,
      initialAuthority: context.initialAuthority,
    }).payload.action;
    const schedulerAppend = await context.ledger
      .appendInitialSchedulerObservation({
        initial_runner_state_authority: context.initialAuthority,
        scheduler_evaluation: plan.scheduler_evaluation,
        status_plan: plan.status_plan,
      });
    const { automatic, response } = await appendAutomaticReservationStatus(
      context.ledger,
      schedulerAppend,
    );
    const input = {
      automatic_reservation_handle: automatic.automatic_reservation_handle,
      reservation_append_receipt: automatic.reservation_append_receipt,
      reservation_status_response_append: response,
    };
    const writesBeforeForgery = fixture.writeCalls;
    await assert.rejects(
      context.ledger.appendAutomaticReviewRequestIntent({
        ...input,
        automatic_reservation_handle: structuredClone(
          automatic.automatic_reservation_handle,
        ),
      }),
      (error) => error.code === "UNTRUSTED_AUTOMATIC_RESERVATION_HANDLE",
    );
    await assert.rejects(
      context.ledger.appendAutomaticReviewRequestIntent({
        ...input,
        reservation_append_receipt: structuredClone(
          automatic.reservation_append_receipt,
        ),
      }),
      (error) => error.code === "AUTOMATIC_RESERVATION_RECEIPT_MISMATCH",
    );
    await assert.rejects(
      context.ledger.appendAutomaticReviewRequestIntent({
        ...input,
        reservation_status_response_append: structuredClone(response),
      }),
      (error) =>
        error.code === "UNTRUSTED_RESERVATION_STATUS_RESPONSE_APPEND",
    );
    assert.equal(fixture.writeCalls, writesBeforeForgery);

    const requestIntent = await context.ledger
      .appendAutomaticReviewRequestIntent(input);
    assert.equal(
      assertV2GitLedgerAutomaticRequestIntentHandle(
        requestIntent.automatic_request_intent_handle,
      ),
      requestIntent.automatic_request_intent_handle,
    );
    assert.deepEqual(
      projectV2GitLedgerAutomaticReviewRequestTransport(
        requestIntent.automatic_request_intent_handle,
      ),
      requestIntent.transport,
    );
    assert.deepEqual(requestIntent.transport, {
      method: "POST",
      path: "/repos/owner/repo/issues/7/comments",
      body: "@codex review",
      json: { body: "@codex review" },
      expected_status: 201,
      retry_limit: 0,
      record_attempt_before_effect: true,
      network_uncertainty_policy: "do-not-retry-or-reclaim",
      generation_id: "automatic:1",
      reservation_digest: automatic.reservation.reservation_digest,
      attempt_digest:
        requestIntent.automatic_request_intent_handle.attempt_digest,
    });
    assert.throws(
      () => assertV2GitLedgerAutomaticRequestIntentHandle(
        structuredClone(requestIntent.automatic_request_intent_handle),
      ),
      (error) => error.code === "UNTRUSTED_AUTOMATIC_REQUEST_INTENT_HANDLE",
    );

    const loaded = await context.ledger.load();
    const attempt = loaded.records.find((entry) =>
      entry.commit_sha === requestIntent.attempt_append_receipt.commit_sha);
    const reviewIntent = loaded.records.find((entry) =>
      entry.commit_sha === requestIntent.intent_append_receipt.commit_sha);
    assert.equal(attempt.envelope.kind, "effect-attempt");
    assert.equal(reviewIntent.envelope.kind, "review-request");
    assert.equal(
      reviewIntent.envelope.payload.action.attempt_record_oid,
      attempt.commit_sha,
    );
    assert.equal(
      reviewIntent.envelope.payload.action.request_body_sha256,
      rawDigest("@codex review"),
    );
    assert.equal(
      loaded.records.some((entry) =>
        entry.envelope.record_type === "effect-response" &&
        entry.envelope.kind === "review-request"),
      false,
    );
    const control = await context.ledger.loadControlPlaneAuthority(
      context.initialAuthority.scope,
    );
    assert.equal(control.scoped_authority.runner_state.effect_attempts.length, 1);
    assert.equal(
      control.scoped_authority.runner_state.effect_attempts[0].record_oid,
      attempt.commit_sha,
    );
    assert.equal(
      control.scoped_authority.runner_state.effect_attempts[0].bound,
      false,
    );
    const writesAfterIntent = fixture.writeCalls;
    await assert.rejects(
      context.ledger.appendAutomaticReviewRequestIntent(input),
      (error) => error.code === "automatic-review-request-attempt-replayed",
    );
    assert.equal(fixture.writeCalls, writesAfterIntent);
  });

  await t.test("a failed review-intent commit leaves the attempt permanently consumed", async () => {
    const fixture = githubGitFixture();
    const context = await createProtectedInitialRunnerContext(fixture);
    const plan = schedulerObservationRecord({
      predecessor: context.lease.acquire_commit_sha,
      lease: context.lease,
      priorAuthorityDigest: context.initialAuthority.prior_authority_digest,
      initialAuthority: context.initialAuthority,
    }).payload.action;
    const schedulerAppend = await context.ledger
      .appendInitialSchedulerObservation({
        initial_runner_state_authority: context.initialAuthority,
        scheduler_evaluation: plan.scheduler_evaluation,
        status_plan: plan.status_plan,
      });
    const { automatic, response } = await appendAutomaticReservationStatus(
      context.ledger,
      schedulerAppend,
    );
    const input = {
      automatic_reservation_handle: automatic.automatic_reservation_handle,
      reservation_append_receipt: automatic.reservation_append_receipt,
      reservation_status_response_append: response,
    };
    fixture.failNextEffectUpdate("review-request");
    await assert.rejects(
      context.ledger.appendAutomaticReviewRequestIntent(input),
      (error) => error.code === "unexpected-http-status",
    );
    const afterFailure = await context.ledger.load();
    const scopedAttempts = afterFailure.records.filter((entry) =>
      entry.envelope.record_type === "effect-intent" &&
      entry.envelope.kind === "effect-attempt" &&
      entry.envelope.payload.action.reservation_record_oid ===
        automatic.reservation_append_receipt.commit_sha);
    const scopedReviewIntents = afterFailure.records.filter((entry) =>
      entry.envelope.record_type === "effect-intent" &&
      entry.envelope.kind === "review-request" &&
      entry.envelope.payload.action.reservation_record_oid ===
        automatic.reservation_append_receipt.commit_sha);
    assert.equal(scopedAttempts.length, 1);
    assert.equal(scopedReviewIntents.length, 0);
    const writesAfterFailure = fixture.writeCalls;
    await assert.rejects(
      context.ledger.appendAutomaticReviewRequestIntent(input),
      (error) => error.code === "automatic-review-request-attempt-replayed",
    );
    assert.equal(fixture.writeCalls, writesAfterFailure);
  });
});

test("automatic review request binding is exact, controller-owned, and resumable", async (t) => {
  const prepare = async (fixture) => {
    const context = await createProtectedInitialRunnerContext(fixture);
    const plan = schedulerObservationRecord({
      predecessor: context.lease.acquire_commit_sha,
      lease: context.lease,
      priorAuthorityDigest: context.initialAuthority.prior_authority_digest,
      initialAuthority: context.initialAuthority,
    }).payload.action;
    const schedulerAppend = await context.ledger
      .appendInitialSchedulerObservation({
        initial_runner_state_authority: context.initialAuthority,
        scheduler_evaluation: plan.scheduler_evaluation,
        status_plan: plan.status_plan,
      });
    const { automatic, response } = await appendAutomaticReservationStatus(
      context.ledger,
      schedulerAppend,
    );
    const requestIntent = await context.ledger
      .appendAutomaticReviewRequestIntent({
        automatic_reservation_handle:
          automatic.automatic_reservation_handle,
        reservation_append_receipt: automatic.reservation_append_receipt,
        reservation_status_response_append: response,
      });
    const receipt = await automaticReviewRequestBindingReceipt({
      action: {
        method: "POST",
        request_body_sha256: rawDigest("@codex review"),
      },
      observedAt: requestIntent.intent_append_receipt.ref_reread.server_time,
    });
    return { context, automatic, requestIntent, receipt };
  };

  await t.test("rejects ambiguity before any response and returns bound authority", async () => {
    const fixture = githubGitFixture();
    const { context, requestIntent, receipt } = await prepare(fixture);
    const input = {
      automatic_request_intent_handle:
        requestIntent.automatic_request_intent_handle,
      intent_append_receipt: requestIntent.intent_append_receipt,
      receipt,
    };
    const writesBeforeAmbiguity = fixture.writeCalls;
    await assert.rejects(
      context.ledger.appendAutomaticReviewRequestBinding({
        ...input,
        receipt: {
          ...receipt,
          request_url:
            "https://github.com/owner/repo/issues/7#issuecomment-71",
        },
      }),
      (error) => error.code === "automatic-review-request-url-scope",
    );
    await assert.rejects(
      context.ledger.appendAutomaticReviewRequestBinding({
        ...input,
        receipt: { ...receipt, actor: CODEX_ACTOR, app: CODEX_APP },
      }),
      (error) =>
        error.code === "automatic-review-request-controller-principal-mismatch" ||
        /GitHub Actions app/u.test(error.message),
    );
    await assert.rejects(
      context.ledger.appendAutomaticReviewRequestBinding({
        ...input,
        automatic_request_intent_handle: structuredClone(
          requestIntent.automatic_request_intent_handle,
        ),
      }),
      (error) => error.code === "UNTRUSTED_AUTOMATIC_REQUEST_INTENT_HANDLE",
    );
    assert.equal(fixture.writeCalls, writesBeforeAmbiguity);
    const beforeBinding = await context.ledger.load();
    assert.equal(beforeBinding.records.filter((entry) =>
      entry.envelope.kind === "effect-attempt").length, 1);
    assert.equal(beforeBinding.records.filter((entry) =>
      entry.envelope.kind === "review-request" &&
      entry.envelope.record_type === "effect-intent").length, 1);
    assert.equal(beforeBinding.records.some((entry) =>
      entry.envelope.kind === "review-request" &&
      entry.envelope.record_type === "effect-response"), false);

    const binding = await context.ledger
      .appendAutomaticReviewRequestBinding(input);
    assert.equal(
      binding.authoritative_controlled_request.request_id,
      receipt.request_id,
    );
    assert.equal(binding.authoritative_attempt.bound, true);
    assert.equal(
      binding.authoritative_attempt.binding_record_oid,
      binding.request_binding_response_append_receipt.commit_sha,
    );
    const final = await context.ledger.load();
    assert.deepEqual(
      final.records.slice(-3).map((entry) => [
        entry.envelope.record_type,
        entry.envelope.kind,
      ]),
      [
        ["effect-response", "review-request"],
        ["effect-intent", "request-binding"],
        ["effect-response", "request-binding"],
      ],
    );
    assert.equal(
      final.records.at(-3).envelope.payload.receipt.request_url,
      "https://github.com/owner/repo/pull/7#issuecomment-71",
    );
    assert.deepEqual(final.records.at(-3).envelope.payload.receipt.actor, ACTOR);
    const writesAfterBinding = fixture.writeCalls;
    assert.equal(
      await context.ledger.appendAutomaticReviewRequestBinding(input),
      binding,
    );
    assert.equal(fixture.writeCalls, writesAfterBinding);
  });

  await t.test("resumes the same receipt after a partial internal append", async () => {
    const fixture = githubGitFixture();
    const { context, requestIntent, receipt } = await prepare(fixture);
    fixture.freezeServerTime();
    const input = {
      automatic_request_intent_handle:
        requestIntent.automatic_request_intent_handle,
      intent_append_receipt: requestIntent.intent_append_receipt,
      receipt,
    };
    fixture.failNextEffectUpdate("request-binding");
    await assert.rejects(
      context.ledger.appendAutomaticReviewRequestBinding(input),
      (error) => error.code === "unexpected-http-status",
    );
    const partial = await context.ledger.load();
    assert.equal(partial.records.filter((entry) =>
      entry.envelope.kind === "review-request" &&
      entry.envelope.record_type === "effect-response").length, 1);
    assert.equal(partial.records.filter((entry) =>
      entry.envelope.kind === "request-binding").length, 0);
    const binding = await context.ledger
      .appendAutomaticReviewRequestBinding(input);
    assert.equal(binding.authoritative_attempt.bound, true);
    const final = await context.ledger.load();
    assert.equal(final.records.filter((entry) =>
      entry.envelope.kind === "review-request" &&
      entry.envelope.record_type === "effect-response").length, 1);
    assert.equal(final.records.filter((entry) =>
      entry.envelope.kind === "request-binding").length, 2);
  });
});

test("reservation status binding is required before the retry-zero request attempt", async () => {
  const fixture = githubGitFixture();
  const context = await createProtectedInitialRunnerContext(fixture);
  const {
    ledger, lease, initialAuthority, evaluatedScopeReceipt,
  } = context;
  const generation = automaticGeneration(1);
  const beforeObservation = await ledger.load();
  const observationPlan = schedulerObservationRecord({
    predecessor: lease.acquire_commit_sha,
    lease,
    priorAuthorityDigest: priorRunnerAuthorityDigest(beforeObservation.records),
    initialAuthority,
  });
  const initialAppend = await ledger.appendInitialSchedulerObservation({
    initial_runner_state_authority: initialAuthority,
    scheduler_evaluation:
      observationPlan.payload.action.scheduler_evaluation,
    status_plan: observationPlan.payload.action.status_plan,
  });
  const observationRecord = initialAppend.record;
  const observation = initialAppend.append_receipt;
  const requiredStatus = await appendGenericRequiredStatus(
    ledger,
    lease,
    observationRecord,
    observation,
  );
  const statusControl = await ledger.loadControlPlaneAuthority(
    initialAuthority.scope,
  );
  const reservationRecord = protectedAutomaticReservationRecord({
    predecessor: requiredStatus.commit_sha,
    lease,
    generation,
    observationRecordOid: observation.commit_sha,
    observation: observationRecord,
    headLedger: statusControl.scoped_authority.runner_state.head_ledger,
  });
  const reservation = await ledger.appendRecord(reservationRecord);
  const postAction = observationRecord.payload.action.scheduler_plan.actions
    .find((action) => action.kind === "post_review_request");

  const beforeStatusAttempt = effectAttemptRecord({
    predecessor: reservation.commit_sha,
    lease,
    generation,
    observationRecordOid: observation.commit_sha,
    reservationRecordOid: reservation.commit_sha,
    reservation: reservationRecord.payload.action.reservation,
    schedulerActionKey: postAction.idempotency_key,
  });
  let writes = fixture.writeCalls;
  await assert.rejects(
    ledger.appendRecord(beforeStatusAttempt),
    (error) => error.code === "reservation-status-binding-required",
  );
  assert.equal(fixture.writeCalls, writes, "no Git object is written before status intent");

  const statusIntentRecord = reservationStatusIntentRecord({
    predecessor: reservation.commit_sha,
    lease,
    generation,
    reservationRecordOid: reservation.commit_sha,
    reservationDigest: reservationRecord.payload.action.reservation_digest,
  });
  const statusIntent = await ledger.appendRecord(statusIntentRecord);
  const afterAmbiguousStatusAttempt = effectAttemptRecord({
    predecessor: statusIntent.commit_sha,
    lease,
    generation,
    observationRecordOid: observation.commit_sha,
    reservationRecordOid: reservation.commit_sha,
    reservation: reservationRecord.payload.action.reservation,
    schedulerActionKey: postAction.idempotency_key,
  });
  writes = fixture.writeCalls;
  await assert.rejects(
    ledger.appendRecord(afterAmbiguousStatusAttempt),
    (error) => error.code === "reservation-status-binding-required",
  );
  assert.equal(fixture.writeCalls, writes, "ambiguous status never permits request POST");

  const loaded = await ledger.load();
  const authority = deriveV2GitLedgerAuthority(
    loaded.records,
    {
      pull_request: PR,
      head_ref_oid: HEAD,
      base_ref_oid: BASE,
      potential_merge_commit_oid: POTENTIAL,
    },
    loaded.observed_at,
  );
  assert.equal(authority.runner_state.head_ledger.automatic_request_count, 1,
    "reservation intent permanently consumes budget without a status response");
  assert.equal(authority.runner_state.reservations[0].reservation_status_bound,
    false);
  assert.equal(
    authority.runner_state.reservations[0].reservation_status_intent_record_oid,
    statusIntent.commit_sha,
  );
  assert.equal(
    authority.runner_state.scheduling.epoch.automatic_request.state,
    "intent-persisted",
  );
  assert.deepEqual(authority.runner_state.effect_attempts, []);
});

test("initial runner authority rejects a pre-lease control boundary", async () => {
  const fixture = githubGitFixture();
  const preflight = await loadFixtureProviderPreflight();
  const capability = capabilityReceiptForTrigger(
    "pull_request_target",
    "refs/heads/main",
  );
  const verifier = provenanceVerifier({
    eventName: "pull_request_target",
    ref: "refs/heads/main",
    shaValue: BASE,
  });
  const ledger = makeLedger(fixture, capability, verifier, preflight);
  await ledger.bootstrapCapability();
  const minimalScopeHandle = await loadFixtureMinimalScope();
  const preScopeReceipt = await ledger
    .createPullRequestEventEvaluatedScopeReceipt({
      minimal_scope_handle: minimalScopeHandle,
      trigger_identity: {
        event_name: "pull_request_target",
        ref: "refs/heads/main",
        sha: BASE,
      },
    });
  const controlPlaneAuthority = await ledger.loadControlPlaneAuthority(
    preScopeReceipt.scope,
  );
  const writes = fixture.writeCalls;
  await assert.rejects(
    ledger.loadInitialRunnerStateAuthority({
      control_plane_authority: controlPlaneAuthority,
      evaluated_scope_receipt: preScopeReceipt,
      workflow_command_handle:
        await createPullRequestTargetWorkflowCommandHandle(),
    }),
    (error) => error.code === "full-discovery-receipt-required",
  );
  assert.equal(fixture.writeCalls, writes);
});

test("initial runner authority is branded, one-shot, and historically reverified", async () => {
  const fixture = githubGitFixture();
  const context = await createProtectedInitialRunnerContext(fixture);
  const {
    ledger,
    lease,
    initialAuthority,
    evaluatedScopeReceipt,
    workflowCommandHandle,
    capability,
    verifier,
    preflight,
    controlPlaneAuthority,
  } = context;
  assert.equal(initialAuthority.scheduling.trigger, "initial");
  assert.equal(initialAuthority.scheduling.public_wait_supported, false);
  assert.equal(
    initialAuthority.scheduling.epoch.started_at,
    lease.acquired_at,
  );
  assert.equal(
    initialAuthority.head_ledger.observed_at,
    initialAuthority.source_authority.post_ref_receipt.server_time,
  );
  assert.equal(
    initialAuthority.source_authority.tip_commit_sha,
    controlPlaneAuthority.load.tip_commit_sha,
  );
  assert.deepEqual(
    initialAuthority.source_authority.post_ref_receipt,
    controlPlaneAuthority.load.post_ref,
  );
  assert.equal(
    initialAuthority.source_authority.same_job_source_inventory_digest,
    controlPlaneAuthority.scoped_authority.source_inventory_digest,
  );
  assert.equal(
    initialAuthority.source_authority.same_job_scoped_authority_digest,
    controlPlaneAuthority.scoped_authority.authority_digest,
  );
  assert.equal(
    assertV2GitLedgerInitialRunnerStateAuthorityHandle(initialAuthority, {
      control_plane_authority: controlPlaneAuthority,
      evaluated_scope_receipt: evaluatedScopeReceipt,
      workflow_command_handle: workflowCommandHandle,
      preflight_handle: preflight,
    }),
    initialAuthority,
  );

  const controlPlaneReceipt =
    createV2ControlPlaneReceiptFromGitLedgerAuthority(
      controlPlaneAuthority,
    );
  assert.equal(
    initialAuthority.prior_authority_digest,
    controlPlaneAuthority.scoped_authority.runner_state
      .source_authority_digest,
    "initial prior authority must equal the same-load runner source",
  );
  const {
    observed_at: initialHeadObservedAt,
    ...initialHeadFields
  } = initialAuthority.head_ledger;
  const {
    observed_at: controlHeadObservedAt,
    ...controlHeadFields
  } = controlPlaneAuthority.scoped_authority.runner_state.head_ledger;
  assert.deepEqual(
    initialHeadFields,
    controlHeadFields,
    "initial head fields must equal the same-load empty runner head",
  );
  assert.equal(
    initialHeadObservedAt,
    controlPlaneAuthority.load.post_ref.server_time,
    "initial head boundary must be the same-load post-ref receipt",
  );
  assert.equal(
    controlHeadObservedAt,
    controlPlaneAuthority.load.observed_at,
    "control runner head boundary must remain its same-load observation",
  );
  assert.deepEqual(
    controlPlaneAuthority.load.active_lease.scope,
    initialAuthority.scope,
    "initial scope must equal the same-load active lease scope",
  );
  assert.equal(
    initialAuthority.lease_authority.evaluated_scope_receipt_digest,
    controlPlaneAuthority.load.active_lease.evaluated_scope_receipt
      .receipt_digest,
    "initial lease authority must equal the same-load acquire authority",
  );
  assert.equal(
    initialAuthority.preflight_authority.preflight_receipt_digest,
    preflight.receipt_digest,
    "initial authority must retain the exact live preflight receipt",
  );
  assert.equal(
    initialAuthority.preflight_authority.configuration_digest,
    preflight.configuration_digest,
    "initial authority must retain the exact live preflight configuration",
  );
  assert.throws(
    () => createV2ProductionRunnerAuthority({
      preflight_handle: preflight,
      control_plane_receipt: controlPlaneReceipt,
      expected_scope: initialAuthority.scope,
    }),
    (error) => error.code === "INITIAL_RUNNER_STATE_AUTHORITY_REQUIRED",
  );
  assert.throws(
    () => createV2ProductionRunnerAuthority({
      preflight_handle: preflight,
      control_plane_receipt: controlPlaneReceipt,
      established_runner_state_authority: {},
      expected_scope: initialAuthority.scope,
    }),
    (error) => error.code === "ESTABLISHED_RUNNER_STATE_AUTHORITY_UNEXPECTED",
  );
  const productionAuthority = createV2ProductionRunnerAuthority({
    preflight_handle: preflight,
    control_plane_receipt: controlPlaneReceipt,
    initial_runner_state_authority: initialAuthority,
    expected_scope: initialAuthority.scope,
  });
  assert.equal(
    assertV2ProductionRunnerAuthorityHandle(productionAuthority),
    productionAuthority,
  );
  assert.equal(
    productionAuthority.effect_barrier,
    "scheduler-observation-required",
  );
  assert.deepEqual(productionAuthority.scheduling, initialAuthority.scheduling);
  assert.deepEqual(productionAuthority.head_ledger, initialAuthority.head_ledger);
  assert.equal(productionAuthority.runner_state.scheduling, null);
  assert.equal(
    productionAuthority.runner_state.runner_state_digest,
    controlPlaneAuthority.scoped_authority.runner_state.runner_state_digest,
  );
  assert.equal(
    productionAuthority.control_plane_binding.source_authority_digest,
    controlPlaneAuthority.scoped_authority.authority_digest,
  );
  assert.equal(
    productionAuthority.control_plane_binding.source_binding_digest,
    controlPlaneAuthority.binding_digest,
  );
  assert.equal(
    productionAuthority.source_binding_digest.startsWith("sha256:"),
    true,
  );
  assert.throws(
    () => assertV2ProductionRunnerAuthorityHandle(
      structuredClone(productionAuthority),
    ),
    (error) =>
      error.code === "UNTRUSTED_PRODUCTION_RUNNER_AUTHORITY_HANDLE",
  );
  assert.throws(
    () => createV2ProductionRunnerAuthority({
      preflight_handle: preflight,
      control_plane_receipt: structuredClone(controlPlaneReceipt),
      initial_runner_state_authority: initialAuthority,
      expected_scope: initialAuthority.scope,
    }),
    (error) => error.code === "UNTRUSTED_CONTROL_PLANE_RECEIPT_HANDLE",
  );
  await assert.rejects(
    ledger.loadInitialRunnerStateAuthority({
      control_plane_authority: structuredClone(controlPlaneAuthority),
      evaluated_scope_receipt: evaluatedScopeReceipt,
      workflow_command_handle: workflowCommandHandle,
    }),
    (error) => error.code === "UNTRUSTED_CONTROL_PLANE_AUTHORITY_HANDLE",
  );
  const wrongScopeControl = await ledger.loadControlPlaneAuthority({
    ...structuredClone(initialAuthority.scope),
    head_ref_oid: "9".repeat(40),
  });
  await assert.rejects(
    ledger.loadInitialRunnerStateAuthority({
      control_plane_authority: wrongScopeControl,
      evaluated_scope_receipt: evaluatedScopeReceipt,
      workflow_command_handle: workflowCommandHandle,
    }),
    (error) => error.code === "CONTROL_PLANE_AUTHORITY_SCOPE_MISMATCH",
  );
  assert.throws(
    () => assertV2GitLedgerInitialRunnerStateAuthorityHandle(
      initialAuthority,
      { control_plane_authority: wrongScopeControl },
    ),
    (error) =>
      error.code === "INITIAL_RUNNER_STATE_AUTHORITY_BINDING_MISMATCH",
  );
  const wrongScopeControlReceipt =
    createV2ControlPlaneReceiptFromGitLedgerAuthority(wrongScopeControl);
  assert.throws(
    () => createV2ProductionRunnerAuthority({
      preflight_handle: preflight,
      control_plane_receipt: wrongScopeControlReceipt,
      initial_runner_state_authority: initialAuthority,
      expected_scope: wrongScopeControl.scope,
    }),
    (error) => error.code === "INITIAL_RUNNER_STATE_AUTHORITY_UNTRUSTED",
  );
  const foreignFactory = createV2GitHubGitLedger({
    ...factoryInput(fixture, capability),
    preflightHandle: preflight,
    verifyWorkflowProvenance: verifier,
  });
  await assert.rejects(
    foreignFactory.loadInitialRunnerStateAuthority({
      control_plane_authority: controlPlaneAuthority,
      evaluated_scope_receipt: evaluatedScopeReceipt,
      workflow_command_handle: workflowCommandHandle,
    }),
    (error) => error.code === "UNTRUSTED_CONTROL_PLANE_AUTHORITY_HANDLE",
  );
  const foreignControlPlaneAuthority =
    await foreignFactory.loadControlPlaneAuthority(initialAuthority.scope);
  const foreignControlPlaneReceipt =
    createV2ControlPlaneReceiptFromGitLedgerAuthority(
      foreignControlPlaneAuthority,
    );
  assert.throws(
    () => createV2ProductionRunnerAuthority({
      preflight_handle: preflight,
      control_plane_receipt: foreignControlPlaneReceipt,
      initial_runner_state_authority: initialAuthority,
      expected_scope: initialAuthority.scope,
    }),
    (error) => error.code === "INITIAL_RUNNER_STATE_AUTHORITY_UNTRUSTED",
  );

  const clone = structuredClone(initialAuthority);
  assert.throws(
    () => assertV2GitLedgerInitialRunnerStateAuthorityHandle(clone),
    (error) =>
      error.code === "UNTRUSTED_INITIAL_RUNNER_STATE_AUTHORITY_HANDLE",
  );
  const resealedWithoutDigest = structuredClone(initialAuthority);
  delete resealedWithoutDigest.authority_digest;
  resealedWithoutDigest.source_authority.same_job_source_inventory_digest =
    `sha256:${"1".repeat(64)}`;
  const resealed = {
    ...resealedWithoutDigest,
    authority_digest: digestCanonical(
      "codex-review-gate-v2-git-ledger-initial-runner-state-authority",
      resealedWithoutDigest,
    ),
  };
  assert.equal(
    validateV2GitLedgerInitialRunnerStateAuthority(resealed).authority_digest,
    resealed.authority_digest,
    "structural resealing alone is not append authority",
  );
  assert.throws(
    () => assertV2GitLedgerInitialRunnerStateAuthorityHandle(resealed),
    (error) =>
      error.code === "UNTRUSTED_INITIAL_RUNNER_STATE_AUTHORITY_HANDLE",
  );
  assert.throws(
    () => createV2ProductionRunnerAuthority({
      preflight_handle: preflight,
      control_plane_receipt: controlPlaneReceipt,
      initial_runner_state_authority: resealed,
      expected_scope: initialAuthority.scope,
    }),
    (error) => error.code === "INITIAL_RUNNER_STATE_AUTHORITY_UNTRUSTED",
  );

  const beforeObservation = await ledger.load();
  const plan = schedulerObservationRecord({
    predecessor: lease.acquire_commit_sha,
    lease,
    priorAuthorityDigest: priorRunnerAuthorityDigest(beforeObservation.records),
    initialAuthority,
  }).payload.action;
  const writesBeforeAdmission = fixture.writeCalls;
  await assert.rejects(
    ledger.appendInitialSchedulerObservation({
      initial_runner_state_authority: clone,
      scheduler_evaluation: plan.scheduler_evaluation,
      status_plan: plan.status_plan,
    }),
    (error) =>
      error.code === "UNTRUSTED_INITIAL_RUNNER_STATE_AUTHORITY_HANDLE",
  );
  assert.equal(fixture.writeCalls, writesBeforeAdmission);

  await assert.rejects(
    ledger.appendInitialSchedulerObservation({
      initial_runner_state_authority: initialAuthority,
      scheduler_evaluation: plan.scheduler_evaluation,
      status_plan: {
        ...structuredClone(plan.status_plan),
        decision: "clean",
      },
    }),
    /runner status plan is not exact closed output/u,
  );
  assert.equal(fixture.writeCalls, writesBeforeAdmission);

  const appended = await ledger.appendInitialSchedulerObservation({
    initial_runner_state_authority: initialAuthority,
    scheduler_evaluation: plan.scheduler_evaluation,
    status_plan: plan.status_plan,
  });
  assert.equal(appended.record.kind, "scheduler-observation");
  assert.deepEqual(
    appended.record.payload.action.initial_runner_state_authority,
    initialAuthority,
  );

  const writesAfterAppend = fixture.writeCalls;
  await assert.rejects(
    ledger.appendInitialSchedulerObservation({
      initial_runner_state_authority: initialAuthority,
      scheduler_evaluation: plan.scheduler_evaluation,
      status_plan: plan.status_plan,
    }),
    (error) => error.code === "initial-runner-authority-replayed",
  );
  assert.equal(fixture.writeCalls, writesAfterAppend);
  await assert.rejects(
    ledger.loadInitialRunnerStateAuthority({
      control_plane_authority: controlPlaneAuthority,
      evaluated_scope_receipt: evaluatedScopeReceipt,
      workflow_command_handle: workflowCommandHandle,
    }),
    (error) => error.code === "STALE_CONTROL_PLANE_AUTHORITY",
  );
  const postObservationControl = await ledger.loadControlPlaneAuthority(
    initialAuthority.scope,
  );
  const postObservationReceipt =
    createV2ControlPlaneReceiptFromGitLedgerAuthority(
      postObservationControl,
    );
  assert.throws(
    () => createV2ProductionRunnerAuthority({
      preflight_handle: preflight,
      control_plane_receipt: postObservationReceipt,
      initial_runner_state_authority: initialAuthority,
      expected_scope: initialAuthority.scope,
    }),
    (error) => error.code === "INITIAL_RUNNER_STATE_AUTHORITY_UNEXPECTED",
  );
  assert.throws(
    () => createV2ProductionRunnerAuthority({
      preflight_handle: preflight,
      control_plane_receipt: postObservationReceipt,
      expected_scope: initialAuthority.scope,
    }),
    (error) => error.code === "ESTABLISHED_RUNNER_STATE_AUTHORITY_REQUIRED",
  );
  const establishedAuthority =
    await ledger.loadEstablishedRunnerStateAuthority({
      control_plane_authority: postObservationControl,
      evaluated_scope_receipt: evaluatedScopeReceipt,
      workflow_command_handle: workflowCommandHandle,
    });
  const readyAuthority = createV2ProductionRunnerAuthority({
    preflight_handle: preflight,
    control_plane_receipt: postObservationReceipt,
    established_runner_state_authority: establishedAuthority,
    expected_scope: initialAuthority.scope,
  });
  assert.equal(
    readyAuthority.effect_barrier,
    "scheduler-observation-required",
  );
  assert.deepEqual(
    readyAuthority.scheduling,
    establishedAuthority.scheduling,
  );
  assert.deepEqual(
    readyAuthority.head_ledger,
    establishedAuthority.head_ledger,
  );
  assert.notEqual(readyAuthority.runner_state.scheduling, null);
  assert.equal(
    readyAuthority.runner_state.runner_state_digest,
    postObservationControl.scoped_authority.runner_state.runner_state_digest,
  );
  assert.throws(
    () => createV2ProductionRunnerAuthority({
      preflight_handle: preflight,
      control_plane_receipt: postObservationReceipt,
      initial_runner_state_authority: initialAuthority,
      established_runner_state_authority: establishedAuthority,
      expected_scope: initialAuthority.scope,
    }),
    (error) => error.code === "INITIAL_RUNNER_STATE_AUTHORITY_UNEXPECTED",
  );
  assert.throws(
    () => createV2ProductionRunnerAuthority({
      preflight_handle: preflight,
      control_plane_receipt: postObservationReceipt,
      established_runner_state_authority:
        structuredClone(establishedAuthority),
      expected_scope: initialAuthority.scope,
    }),
    (error) =>
      error.code === "ESTABLISHED_RUNNER_STATE_AUTHORITY_UNTRUSTED",
  );
  await assert.rejects(
    ledger.loadInitialRunnerStateAuthority({
      control_plane_authority: postObservationControl,
      evaluated_scope_receipt: evaluatedScopeReceipt,
      workflow_command_handle: workflowCommandHandle,
    }),
    (error) => error.code === "initial-runner-history-exists",
  );

  const restarted = createV2GitHubGitLedger({
    ...factoryInput(fixture, capability),
    preflightHandle: preflight,
    verifyWorkflowProvenance: verifier,
  });
  const historical = await restarted.load();
  const historicalAuthority = deriveV2GitLedgerAuthority(
    historical.records,
    initialAuthority.scope,
    historical.observed_at,
  );
  assert.equal(
    historicalAuthority.runner_state.scheduling.trigger,
    "initial",
  );
  assert.equal(
    historicalAuthority.runner_state.observation_history[0].record_oid,
    appended.append_receipt.commit_sha,
  );
});

test("established runner authority preserves history and binds each current run", async () => {
  const fixture = githubGitFixture();
  const runIdentity = {
    run_id: OWNER.run_id,
    run_attempt: OWNER.run_attempt,
    actor_id: OWNER.actor_id,
  };
  const context = await createProtectedInitialRunnerContext(fixture, {
    runIdentity,
  });
  const {
    ledger,
    initialAuthority,
    controlPlaneAuthority,
    evaluatedScopeReceipt,
    workflowCommandHandle,
    discovery,
    capability,
    preflight,
  } = context;
  await assert.rejects(
    ledger.loadEstablishedRunnerStateAuthority({
      control_plane_authority: controlPlaneAuthority,
      evaluated_scope_receipt: evaluatedScopeReceipt,
      workflow_command_handle: workflowCommandHandle,
    }),
    (error) => error.code === "established-runner-history-required",
  );

  const seed = schedulerObservationRecord({
    predecessor: context.lease.acquire_commit_sha,
    lease: context.lease,
    priorAuthorityDigest: initialAuthority.prior_authority_digest,
    initialAuthority,
  }).payload.action;
  const firstAppend = await ledger.appendInitialSchedulerObservation({
    initial_runner_state_authority: initialAuthority,
    scheduler_evaluation: seed.scheduler_evaluation,
    status_plan: seed.status_plan,
  });
  const controlled = await appendControlledRequestAfterObservation(
    ledger,
    context.lease,
    {
      observationRecord: firstAppend.record,
      observationReceipt: firstAppend.append_receipt,
    },
  );
  await releaseFixtureDiscoveryLease(ledger, discovery);

  runIdentity.run_attempt = 2;
  const sameRun = await acquireEstablishedRunnerContext({
    ledger,
    runIdentity,
    observationBoundary: "public-initial-wait-complete",
    transportStartSecond: 3600,
    minimalServerTime: "2026-08-13T14:00:00.000Z",
  });
  const established = await ledger.loadEstablishedRunnerStateAuthority({
    control_plane_authority: sameRun.controlPlaneAuthority,
    evaluated_scope_receipt: sameRun.evaluatedScopeReceipt,
    workflow_command_handle: sameRun.workflowCommandHandle,
  });
  assert.equal(
    established.schema,
    V2_GIT_LEDGER_ESTABLISHED_RUNNER_STATE_AUTHORITY_SCHEMA,
  );
  assert.deepEqual(established.scheduling.run_identity, {
    run_id: OWNER.run_id,
    run_attempt: 2,
  });
  assert.equal(established.scheduling.trigger, "timer");
  assert.equal(
    established.scheduling.epoch.started_at,
    initialAuthority.scheduling.epoch.started_at,
  );
  assert.equal(
    established.scheduling.epoch.controlled_request.bound_at,
    controlled.boundAt,
    "a new execution must not reset the request-bound six-hour origin",
  );
  assert.equal(established.scheduling.complete_snapshots.length, 1);
  assert.equal(
    established.prior_authority_digest,
    sameRun.controlPlaneAuthority.scoped_authority.runner_state
      .source_authority_digest,
  );
  assert.equal(
    established.head_ledger.observed_at,
    sameRun.controlPlaneAuthority.load.post_ref.server_time,
  );
  assert.deepEqual(
    validateV2GitLedgerEstablishedRunnerStateAuthority(established),
    established,
  );
  assert.equal(
    assertV2GitLedgerEstablishedRunnerStateAuthorityHandle(established, {
      control_plane_authority: sameRun.controlPlaneAuthority,
      evaluated_scope_receipt: sameRun.evaluatedScopeReceipt,
      workflow_command_handle: sameRun.workflowCommandHandle,
      preflight_handle: preflight,
    }),
    established,
  );
  const sameRunControlReceipt =
    createV2ControlPlaneReceiptFromGitLedgerAuthority(
      sameRun.controlPlaneAuthority,
    );
  assert.throws(
    () => createV2ProductionRunnerAuthority({
      preflight_handle: preflight,
      control_plane_receipt: sameRunControlReceipt,
      expected_scope: established.scope,
    }),
    (error) => error.code === "ESTABLISHED_RUNNER_STATE_AUTHORITY_REQUIRED",
  );
  const establishedProductionAuthority = createV2ProductionRunnerAuthority({
    preflight_handle: preflight,
    control_plane_receipt: sameRunControlReceipt,
    established_runner_state_authority: established,
    expected_scope: established.scope,
  });
  assert.equal(
    establishedProductionAuthority.effect_barrier,
    "scheduler-observation-required",
  );
  assert.deepEqual(
    establishedProductionAuthority.scheduling,
    established.scheduling,
  );
  assert.deepEqual(
    establishedProductionAuthority.head_ledger,
    established.head_ledger,
  );
  assert.equal(
    establishedProductionAuthority.runner_state.runner_state_digest,
    sameRun.controlPlaneAuthority.scoped_authority.runner_state
      .runner_state_digest,
  );
  assert.notDeepEqual(
    establishedProductionAuthority.scheduling.run_identity,
    establishedProductionAuthority.runner_state.scheduling.run_identity,
    "execution authority updates only the current run identity",
  );
  assert.equal(
    establishedProductionAuthority.scheduling.epoch.started_at,
    establishedProductionAuthority.runner_state.scheduling.epoch.started_at,
    "execution projection must preserve the protected epoch origin",
  );
  assert.equal(
    establishedProductionAuthority.scheduling.epoch.controlled_request.bound_at,
    establishedProductionAuthority.runner_state.scheduling.epoch
      .controlled_request.bound_at,
    "execution projection must preserve the protected request deadline origin",
  );
  assert.throws(
    () => createV2ProductionRunnerAuthority({
      preflight_handle: preflight,
      control_plane_receipt: sameRunControlReceipt,
      initial_runner_state_authority: initialAuthority,
      established_runner_state_authority: established,
      expected_scope: established.scope,
    }),
    (error) => error.code === "INITIAL_RUNNER_STATE_AUTHORITY_UNEXPECTED",
  );
  const clone = structuredClone(established);
  assert.throws(
    () => assertV2GitLedgerEstablishedRunnerStateAuthorityHandle(clone),
    (error) =>
      error.code === "UNTRUSTED_ESTABLISHED_RUNNER_STATE_AUTHORITY_HANDLE",
  );
  assert.throws(
    () => createV2ProductionRunnerAuthority({
      preflight_handle: preflight,
      control_plane_receipt: sameRunControlReceipt,
      established_runner_state_authority: clone,
      expected_scope: established.scope,
    }),
    (error) =>
      error.code === "ESTABLISHED_RUNNER_STATE_AUTHORITY_UNTRUSTED",
  );
  const inputs = schedulerInputsForEstablishedAuthority(established, {
    snapshotId: "snapshot-established-attempt-2",
  });
  const writesBeforeForgery = fixture.writeCalls;
  await assert.rejects(
    ledger.appendEstablishedSchedulerObservation({
      established_runner_state_authority: clone,
      ...inputs,
    }),
    (error) =>
      error.code === "UNTRUSTED_ESTABLISHED_RUNNER_STATE_AUTHORITY_HANDLE",
  );
  await assert.rejects(
    ledger.appendEstablishedSchedulerObservation({
      established_runner_state_authority: established,
      scheduler_evaluation: inputs.scheduler_evaluation,
      status_plan: { ...inputs.status_plan, decision: "clean" },
    }),
    /runner status plan is not exact closed output/u,
  );
  assert.equal(fixture.writeCalls, writesBeforeForgery);
  const secondAppend = await ledger.appendEstablishedSchedulerObservation({
    established_runner_state_authority: established,
    ...inputs,
  });
  assert.equal(secondAppend.record.kind, "scheduler-observation");
  assert.equal(
    secondAppend.record.payload.action.initial_runner_state_authority,
    null,
  );
  const writesAfterAppend = fixture.writeCalls;
  await assert.rejects(
    ledger.appendEstablishedSchedulerObservation({
      established_runner_state_authority: established,
      ...inputs,
    }),
    (error) => error.code === "established-runner-authority-replayed",
  );
  assert.equal(fixture.writeCalls, writesAfterAppend);
  await releaseFixtureDiscoveryLease(ledger, sameRun.discovery);

  runIdentity.run_id = "9002";
  runIdentity.run_attempt = 1;
  const nextRun = await acquireEstablishedRunnerContext({
    ledger,
    runIdentity,
    observationBoundary: "public-post-request-wait-complete",
    transportStartSecond: 7200,
    minimalServerTime: "2026-08-13T16:00:00.000Z",
  });
  const nextEstablished = await ledger.loadEstablishedRunnerStateAuthority({
    control_plane_authority: nextRun.controlPlaneAuthority,
    evaluated_scope_receipt: nextRun.evaluatedScopeReceipt,
    workflow_command_handle: nextRun.workflowCommandHandle,
  });
  const nextRunControlReceipt =
    createV2ControlPlaneReceiptFromGitLedgerAuthority(
      nextRun.controlPlaneAuthority,
    );
  assert.throws(
    () => createV2ProductionRunnerAuthority({
      preflight_handle: preflight,
      control_plane_receipt: nextRunControlReceipt,
      established_runner_state_authority: established,
      expected_scope: nextEstablished.scope,
    }),
    (error) =>
      error.code === "ESTABLISHED_RUNNER_STATE_AUTHORITY_UNTRUSTED",
    "an established handle cannot cross a same-factory control load",
  );
  const nextRunProductionAuthority = createV2ProductionRunnerAuthority({
    preflight_handle: preflight,
    control_plane_receipt: nextRunControlReceipt,
    established_runner_state_authority: nextEstablished,
    expected_scope: nextEstablished.scope,
  });
  assert.deepEqual(
    nextRunProductionAuthority.scheduling.run_identity,
    { run_id: "9002", run_attempt: 1 },
  );
  assert.deepEqual(nextEstablished.scheduling.run_identity, {
    run_id: "9002",
    run_attempt: 1,
  });
  assert.equal(
    nextEstablished.scheduling.epoch.started_at,
    initialAuthority.scheduling.epoch.started_at,
  );
  assert.equal(
    nextEstablished.scheduling.epoch.controlled_request.bound_at,
    controlled.boundAt,
  );
  assert.equal(nextEstablished.scheduling.complete_snapshots.length, 2);
  await assert.rejects(
    ledger.loadEstablishedRunnerStateAuthority({
      control_plane_authority: nextRun.controlPlaneAuthority,
      evaluated_scope_receipt: nextRun.preScopeReceipt,
      workflow_command_handle: nextRun.workflowCommandHandle,
    }),
    (error) => error.code === "full-discovery-receipt-required",
  );
  const foreignFactory = createV2GitHubGitLedger({
    ...factoryInput(fixture, capability),
    preflightHandle: preflight,
    verifyWorkflowProvenance: provenanceVerifier({
      eventName: "pull_request_target",
      ref: "refs/heads/main",
      shaValue: BASE,
      runIdentity,
    }),
  });
  await assert.rejects(
    foreignFactory.loadEstablishedRunnerStateAuthority({
      control_plane_authority: nextRun.controlPlaneAuthority,
      evaluated_scope_receipt: nextRun.evaluatedScopeReceipt,
      workflow_command_handle: nextRun.workflowCommandHandle,
    }),
    (error) => error.code === "UNTRUSTED_CONTROL_PLANE_AUTHORITY_HANDLE",
  );
  const nextInputs = schedulerInputsForEstablishedAuthority(nextEstablished, {
    snapshotId: "snapshot-established-run-9002",
  });
  await releaseFixtureDiscoveryLease(ledger, nextRun.discovery);
  const writesAfterStaleFence = fixture.writeCalls;
  await assert.rejects(
    ledger.appendEstablishedSchedulerObservation({
      established_runner_state_authority: nextEstablished,
      ...nextInputs,
    }),
    (error) => new Set(["stale-predecessor", "lease-required"])
      .has(error.code),
  );
  assert.equal(fixture.writeCalls, writesAfterStaleFence);
});

test("scheduler observation run identity must equal its protected lease owner", async () => {
  const fixture = githubGitFixture();
  const context = await createProtectedInitialRunnerContext(fixture);
  const {
    ledger, lease, initialAuthority, evaluatedScopeReceipt,
  } = context;
  const loaded = await ledger.load();
  const valid = schedulerObservationRecord({
    predecessor: lease.acquire_commit_sha,
    lease,
    priorAuthorityDigest: priorRunnerAuthorityDigest(loaded.records),
    initialAuthority,
  });
  const action = structuredClone(valid.payload.action);
  action.scheduler_evaluation.run_id = "9002";
  const forged = createV2GitLedgerRecord({
    ...recordPlan(valid),
    effect_id: "scheduler-observation-wrong-run",
    idempotency_key: "scheduler-observation-wrong-run-key",
    payload: effectPayload({
      phase: "intent",
      kind: "scheduler-observation",
      predecessor: lease.acquire_commit_sha,
      action,
    }),
  });
  const writes = fixture.writeCalls;
  await assert.rejects(
    ledger.appendRecord(forged, {
      evaluated_scope_receipt: evaluatedScopeReceipt,
      initial_runner_state_authority: initialAuthority,
    }),
    (error) => error.code === "scheduler-run-identity-mismatch",
  );
  assert.equal(fixture.writeCalls, writes);
});

test("authority projection preserves ordered full records and request intent binding", async () => {
  const fixture = githubGitFixture();
  const context = await createProtectedInitialRunnerContext(fixture);
  const { ledger, lease } = context;
  const prefix = await appendProtectedRequestPrefix(ledger, lease, context);
  const { generation } = prefix;
  const intentRecord = reviewRequestRecord({
    predecessor: prefix.attemptReceipt.commit_sha,
    lease,
    effectId: "projection-request",
    idempotencyKey: "projection-request-key",
    at: TIME,
    generation,
    schedulerObservationRecordOid: prefix.observationReceipt.commit_sha,
    reservationRecordOid: prefix.reservationReceipt.commit_sha,
    attemptRecordOid: prefix.attemptReceipt.commit_sha,
    schedulerActionKey: prefix.schedulerActionKey,
  });
  const intent = await ledger.appendRecord(intentRecord);
  const reviewResponseReceipt =
    await automaticReviewRequestBindingReceipt({
      action: intentRecord.payload.action,
      observedAt: intent.ref_reread.server_time,
    });
  const responseRecord = createV2GitLedgerRecord({
    ...recordPlan(intentRecord),
    record_type: "effect-response",
    predecessor_commit_sha: intent.commit_sha,
    server_observed_at:
      reviewResponseReceipt.request_scope_receipt.post_scope.observed_at,
    payload: effectPayload({
      phase: "response",
      kind: "review-request",
      predecessor: intent.commit_sha,
      generation,
      intentCommitSha: intent.commit_sha,
      action: intentRecord.payload.action,
      receipt: reviewResponseReceipt,
    }),
  });
  const response = await ledger.appendRecord(responseRecord);
  const loaded = await ledger.load();
  const authority = deriveV2GitLedgerAuthority(loaded.records, {
    pull_request: PR,
    head_ref_oid: HEAD,
    base_ref_oid: BASE,
    potential_merge_commit_oid: POTENTIAL,
  });
  assert.equal(authority.ordered_records.length, loaded.commit_count);
  assert.equal(authority.ordered_records.at(-1).commit_sha, response.commit_sha);
  const responseFact = authority.authority_facts.find((entry) =>
    entry.record_oid === response.commit_sha);
  assert.equal(responseFact.payload.intent_commit_sha, intent.commit_sha);
  assert.equal(responseFact.payload.generation.generation_id, "automatic:1");
  assert.equal(authority.scope_counters[0].automatic_requests_on_head, 1);
  assert.equal(authority.runner_state.head_ledger.automatic_request_count, 1);
  assert.equal(authority.runner_state.reservations.length, 1);
  assert.equal(authority.runner_state.reservations[0].reservation_status_bound,
    true);
  assert.equal(authority.runner_state.effect_attempts.length, 1);
  assert.equal(authority.runner_state.effect_attempts[0].bound, false);
  assert.equal(
    authority.runner_state.scheduling.epoch.automatic_request.state,
    "effect-attempted",
  );
  assert.equal(authority.runner_state.observation_history[0].run_identity.run_id,
    OWNER.run_id);
  assert.match(authority.source_inventory_digest, /^sha256:/u);
  assert.match(authority.authority_digest, /^sha256:/u);
  const closureAuthority = await ledger.loadControlPlaneAuthority({
    pull_request: PR,
    head_ref_oid: HEAD,
    base_ref_oid: BASE,
    potential_merge_commit_oid: POTENTIAL,
  });
  assert.equal(closureAuthority.schema,
    V2_GIT_LEDGER_CONTROL_PLANE_AUTHORITY_SCHEMA);
  assert.equal(closureAuthority.load.stable, true);
  assert.equal(closureAuthority.scoped_authority.scope.head_ref_oid, HEAD);
  assert.match(closureAuthority.binding_digest, /^sha256:/u);
  assert.deepEqual(
    validateV2GitLedgerControlPlaneAuthority(closureAuthority, {
      pull_request: PR,
      head_ref_oid: HEAD,
      base_ref_oid: BASE,
      potential_merge_commit_oid: POTENTIAL,
    }),
    closureAuthority,
  );
  assert.equal(
    assertV2GitLedgerControlPlaneAuthorityHandle(closureAuthority, {
      pull_request: PR,
      head_ref_oid: HEAD,
      base_ref_oid: BASE,
      potential_merge_commit_oid: POTENTIAL,
    }),
    closureAuthority,
  );
  const reconstructed = structuredClone(closureAuthority);
  assert.throws(
    () => assertV2GitLedgerControlPlaneAuthorityHandle(reconstructed),
    (error) =>
      error.code === "UNTRUSTED_CONTROL_PLANE_AUTHORITY_HANDLE",
  );
  const forged = structuredClone(closureAuthority);
  forged.scoped_authority.scope.head_ref_oid = "f".repeat(40);
  assert.throws(
    () => validateV2GitLedgerControlPlaneAuthority(forged),
    /not derived/u,
  );
});

test("closure-bound control-plane receipt derives an empty effect authority", async () => {
  const fixture = githubGitFixture();
  const ledger = makeLedger(fixture);
  await ledger.bootstrapCapability();
  const receipt = await ledger.loadControlPlaneReceipt({
    pull_request: PR,
    head_ref_oid: HEAD,
    base_ref_oid: BASE,
    potential_merge_commit_oid: POTENTIAL,
  });
  assert.equal(receipt.derived.budget.automatic_reservations_on_head, 0);
  assert.equal(receipt.derived.budget.automatic_requests_on_head, 0);
  assert.deepEqual(receipt.derived.generations, []);
  assert.deepEqual(receipt.derived.request_bindings, []);
  assert.deepEqual(receipt.derived.artifact_bindings, []);
  assert.equal(receipt.record_count, 3);
  assert.match(receipt.source_binding_digest, /^sha256:/u);
  assert.match(receipt.receipt_digest, /^sha256:/u);
});

test("artifact binding requires prior request authority and strictly later exact provider evidence", async () => {
  const fixture = githubGitFixture();
  const context = await createProtectedInitialRunnerContext(fixture);
  const { ledger, lease } = context;
  const generation = automaticGeneration(1);

  const missingLineage = artifactBindingIntent({
    predecessor: lease.acquire_commit_sha,
    lease,
    generation,
    requestBindingRecordOid: "9".repeat(40),
  });
  const writesBeforeMissingLineage = fixture.writeCalls;
  await assert.rejects(
    ledger.appendRecord(missingLineage),
    (error) => error.code === "artifact-request-binding-required",
  );
  assert.equal(fixture.writeCalls, writesBeforeMissingLineage);

  const prefix = await appendProtectedRequestPrefix(ledger, lease, context);
  let boundAt = prefix.observationRecord.payload.action.snapshot_server_time;
  const requestIntentRecord = reviewRequestRecord({
    predecessor: prefix.attemptReceipt.commit_sha,
    lease,
    effectId: "artifact-review-request",
    idempotencyKey: "artifact-review-request-key",
    at: TIME,
    generation,
    schedulerObservationRecordOid: prefix.observationReceipt.commit_sha,
    reservationRecordOid: prefix.reservationReceipt.commit_sha,
    attemptRecordOid: prefix.attemptReceipt.commit_sha,
    schedulerActionKey: prefix.schedulerActionKey,
  });
  const requestIntent = await ledger.appendRecord(requestIntentRecord);
  const requestResponseReceipt =
    await automaticReviewRequestBindingReceipt({
      action: requestIntentRecord.payload.action,
      observedAt: requestIntent.ref_reread.server_time,
    });
  boundAt = requestResponseReceipt.created_at;
  const requestResponseRecord = createV2GitLedgerRecord({
    ...recordPlan(requestIntentRecord),
    record_type: "effect-response",
    predecessor_commit_sha: requestIntent.commit_sha,
    server_observed_at:
      requestResponseReceipt.request_scope_receipt.post_scope.observed_at,
    payload: effectPayload({
      phase: "response",
      kind: "review-request",
      predecessor: requestIntent.commit_sha,
      generation,
      intentCommitSha: requestIntent.commit_sha,
      action: requestIntentRecord.payload.action,
      receipt: requestResponseReceipt,
    }),
  });
  const requestResponse = await ledger.appendRecord(requestResponseRecord);

  const bindingIntentRecord = createV2GitLedgerRecord({
    ...recordPlan(requestIntentRecord),
    predecessor_commit_sha: requestResponse.commit_sha,
    kind: "request-binding",
    effect_id: "artifact-request-binding",
    idempotency_key: "artifact-request-binding-key",
    payload: effectPayload({
      phase: "intent",
      kind: "request-binding",
      predecessor: requestResponse.commit_sha,
      generation,
      action: {
        generation_id: "automatic:1",
        request_id: "71",
        reservation_record_oid: prefix.reservationReceipt.commit_sha,
        attempt_record_oid: prefix.attemptReceipt.commit_sha,
      },
    }),
  });
  const bindingIntent = await ledger.appendRecord(bindingIntentRecord);
  const bindingResponseRecord = createV2GitLedgerRecord({
    ...recordPlan(bindingIntentRecord),
    record_type: "effect-response",
    predecessor_commit_sha: bindingIntent.commit_sha,
    server_observed_at: boundAt,
    payload: effectPayload({
      phase: "response",
      kind: "request-binding",
      predecessor: bindingIntent.commit_sha,
      generation,
      intentCommitSha: bindingIntent.commit_sha,
      action: bindingIntentRecord.payload.action,
      receipt: {
        request_id: "71",
        request_node_id: "IC_71",
        request_url:
          "https://github.com/owner/repo/pull/7#issuecomment-71",
        body_sha256: requestResponseReceipt.body_sha256,
        created_at: boundAt,
        updated_at: boundAt,
        raw_body_sha256: requestResponseReceipt.refetch_raw_body_sha256,
        actor: ACTOR,
        controlled: true,
      },
    }),
  });
  const bindingResponse = await ledger.appendRecord(bindingResponseRecord);

  const artifactIntentRecord = artifactBindingIntent({
    predecessor: bindingResponse.commit_sha,
    lease,
    generation,
    requestBindingRecordOid: bindingResponse.commit_sha,
  });
  assert.throws(
    () => createV2GitLedgerRecord({
      ...recordPlan(artifactIntentRecord),
      effect_id: "artifact-wrong-provider",
      idempotency_key: "artifact-wrong-provider-key",
      payload: effectPayload({
        phase: "intent",
        kind: "artifact-binding",
        predecessor: bindingResponse.commit_sha,
        generation,
        action: {
          ...artifactIntentRecord.payload.action,
          expected_actor: ACTOR,
        },
      }),
    }),
    /exact GitHub Codex provider/u,
  );
  const artifactIntent = await ledger.appendRecord(artifactIntentRecord);
  const tooEarlyResponse = artifactBindingResponse({
    intentRecord: artifactIntentRecord,
    intentCommitSha: artifactIntent.commit_sha,
    artifactCreatedAt: boundAt,
  });
  const writesBeforeTooEarly = fixture.writeCalls;
  await assert.rejects(
    ledger.appendRecord(tooEarlyResponse),
    (error) => error.code === "artifact-time-order",
  );
  assert.equal(fixture.writeCalls, writesBeforeTooEarly);

  const artifactResponseRecord = artifactBindingResponse({
    intentRecord: artifactIntentRecord,
    intentCommitSha: artifactIntent.commit_sha,
    artifactCreatedAt: new Date(
      Date.parse(boundAt) + 1000,
    ).toISOString(),
  });
  const artifactResponse = await ledger.appendRecord(artifactResponseRecord);
  const loaded = await ledger.load();
  const artifactFact = loaded.authority_projection.authority_facts.find((item) =>
    item.record_oid === artifactResponse.commit_sha);
  assert.equal(artifactFact.kind, "artifact-binding");
  assert.equal(artifactFact.payload.receipt.request_binding_record_oid,
    bindingResponse.commit_sha);
  assert.equal(loaded.projection.selectors.artifact_bindings.length, 1);
  const controlPlane = await ledger.loadControlPlaneReceipt({
    pull_request: PR,
    head_ref_oid: HEAD,
    base_ref_oid: BASE,
    potential_merge_commit_oid: POTENTIAL,
  });
  assert.equal(controlPlane.derived.budget.automatic_reservations_on_head, 1);
  assert.equal(controlPlane.derived.budget.automatic_requests_on_head, 1);
  assert.equal(controlPlane.derived.generations.length, 1);
  const generationAudit = controlPlane.derived.generations[0];
  assert.equal(generationAudit.generation_id, "automatic:1");
  assert.equal(generationAudit.request_effect_record_oid,
    requestResponse.commit_sha);
  assert.equal(generationAudit.request_binding_record_oid,
    bindingResponse.commit_sha);
  assert.equal(generationAudit.request_id, "71");
  assert.equal(controlPlane.derived.artifact_bindings.length, 1);
  assert.equal(controlPlane.derived.artifact_bindings[0].record_oid,
    artifactResponse.commit_sha);
  assert.equal(
    controlPlane.derived.artifact_bindings[0].request_binding_record_oid,
    bindingResponse.commit_sha,
  );
  assert.match(controlPlane.source_binding_digest, /^sha256:/u);
  assert.match(controlPlane.source_authority_digest, /^sha256:/u);
});

test("protected candidate inventory is a sharded durable repository superset", async () => {
  const fixture = githubGitFixture();
  const capability = scheduleCapabilityReceipt();
  const verifier = provenanceVerifier({
    eventName: "schedule",
    ref: "refs/heads/main",
    shaValue: BASE,
  });
  const restricted = createV2GitHubGitLedgerBootstrap({
    fetch: fixture.fetch,
    token: SYNTHETIC_BEARER,
    repository: REPOSITORY,
    ledgerRef: V2_GIT_LEDGER_REF,
    restBaseUrl: "https://api.github.test",
    bootstrapCapabilityInput: bootstrapInputForCapability(capability),
    verifyWorkflowProvenance: verifier,
  });
  const { ledger } = await restricted.bootstrapCapability();
  const transportFixture = candidateTransportFixture(257);
  const transport = createV2GitHubCandidateInventory({
    fetch: transportFixture.fetch,
    token: SYNTHETIC_BEARER,
    repository: candidateRepository(),
    restBaseUrl: "https://github.example.test",
  });
  const initial = await transport.scan();
  assert.equal(initial.shards.length, 2);

  let loaded = await ledger.load();
  const start = await appendCandidateInventoryPhase({
    ledger,
    loaded,
    phase: "cycle-start",
    initial,
  });
  loaded = await ledger.load();
  assert.equal(start.record_type, "candidate-inventory-observation");
  assert.equal(loaded.active_lease, null, "repository scans never acquire a PR lease");
  assert.equal(
    loaded.authority_projection.candidate_inventory.open_pr_discovery
      .candidates.length,
    257,
  );
  assert.equal(
    loaded.authority_projection.candidate_inventory.open_pr_discovery
      .bootstrap_complete,
    false,
  );

  const shards = [];
  for (let index = 0; index < initial.shards.length; index += 1) {
    const shard = await transport.readShard({
      inventory: initial,
      shard_index: index,
    });
    shards.push(shard);
    await appendCandidateInventoryPhase({
      ledger,
      loaded,
      phase: "shard",
      initial,
      shard,
    });
    loaded = await ledger.load();
  }
  const finalInventory = await transport.scan({ prior_inventory: initial });
  const cycleReceipt = finalizeV2CandidateInventoryCycle({
    initial_inventory: initial,
    shard_receipts: shards,
    final_inventory: finalInventory,
  });
  await appendCandidateInventoryPhase({
    ledger,
    loaded,
    phase: "cycle-complete",
    initial,
    finalInventory,
    cycleReceipt,
  });
  loaded = await ledger.load();
  const authority = loaded.authority_projection.candidate_inventory;
  assert.equal(authority.open_pr_discovery.bootstrap_complete, true);
  assert.equal(authority.open_pr_discovery.candidates.length, 257);
  assert.equal(authority.open_pr_discovery.current_open_pull_requests.length, 257);
  assert.equal(authority.completed_cycle.shard_record_oids.length, 2);
  assert.equal(
    loaded.projection.selectors.candidate_inventory_observations.length,
    4,
  );
  assert.deepEqual(
    deriveV2GitLedgerCandidateInventoryAuthority(
      loaded.records,
      REPOSITORY,
    ),
    authority,
  );
});

test("candidate inventory fails closed on missing shards, wrong trigger, and shrink", async () => {
  const fixture = githubGitFixture();
  const capability = scheduleCapabilityReceipt();
  const verifier = provenanceVerifier({
    eventName: "schedule",
    ref: "refs/heads/main",
    shaValue: BASE,
  });
  const restricted = createV2GitHubGitLedgerBootstrap({
    fetch: fixture.fetch,
    token: SYNTHETIC_BEARER,
    repository: REPOSITORY,
    ledgerRef: V2_GIT_LEDGER_REF,
    restBaseUrl: "https://api.github.test",
    bootstrapCapabilityInput: bootstrapInputForCapability(capability),
    verifyWorkflowProvenance: verifier,
  });
  const { ledger } = await restricted.bootstrapCapability();
  const transportFixture = candidateTransportFixture(2);
  const transport = createV2GitHubCandidateInventory({
    fetch: transportFixture.fetch,
    token: SYNTHETIC_BEARER,
    repository: candidateRepository(),
    restBaseUrl: "https://github.example.test",
  });
  const initial = await transport.scan();
  let loaded = await ledger.load();
  const writesBeforeWrongTrigger = fixture.writeCalls;
  await assert.rejects(
    appendCandidateInventoryPhase({
      ledger,
      loaded,
      phase: "cycle-start",
      initial,
      authorityOverride: {
        eventName: "pull_request",
        relation: "scheduled-repository-inventory",
      },
    }),
    /relation differs from its trigger event/u,
  );
  assert.equal(fixture.writeCalls, writesBeforeWrongTrigger);

  await appendCandidateInventoryPhase({
    ledger,
    loaded,
    phase: "cycle-start",
    initial,
  });
  loaded = await ledger.load();
  const shard = await transport.readShard({ inventory: initial, shard_index: 0 });
  const finalInventory = await transport.scan({ prior_inventory: initial });
  const cycleReceipt = finalizeV2CandidateInventoryCycle({
    initial_inventory: initial,
    shard_receipts: [shard],
    final_inventory: finalInventory,
  });
  const writesBeforeMissingShard = fixture.writeCalls;
  await assert.rejects(
    appendCandidateInventoryPhase({
      ledger,
      loaded,
      phase: "cycle-complete",
      initial,
      finalInventory,
      cycleReceipt,
    }),
    (error) => error.code === "CANDIDATE_SHARDS_INCOMPLETE",
  );
  assert.equal(fixture.writeCalls, writesBeforeMissingShard);

  await appendCandidateInventoryPhase({
    ledger,
    loaded,
    phase: "shard",
    initial,
    shard,
  });
  loaded = await ledger.load();
  await appendCandidateInventoryPhase({
    ledger,
    loaded,
    phase: "cycle-complete",
    initial,
    finalInventory,
    cycleReceipt,
  });
  loaded = await ledger.load();

  transportFixture.setListedNumbers([2, 3]);
  const expanded = await transport.scan({ prior_inventory: finalInventory });
  assert.deepEqual(expanded.retained_prior_candidate_ids, ["1001"]);
  assert.equal(expanded.candidates.length, 3);
  await appendCandidateInventoryPhase({
    ledger,
    loaded,
    phase: "cycle-start",
    initial: expanded,
  });
  loaded = await ledger.load();
  assert.deepEqual(
    loaded.authority_projection.candidate_inventory.open_pr_discovery
      .candidates.map(({ number }) => number),
    [1, 2, 3],
  );

  const shrunk = structuredClone(expanded);
  shrunk.candidates.shift();
  const authority = loaded.authority_projection.candidate_inventory;
  const badPayload = candidateInventoryPayload({
    phase: "cycle-start",
    initial: shrunk,
    priorAuthorityDigest: authority.authority_digest,
    supersedes: authority.incomplete_cycle.cycle_id,
  });
  assert.throws(
    () => createV2GitLedgerCandidateInventoryRecord({
      predecessor_commit_sha: loaded.tip_commit_sha,
      owner: OWNER,
      server_observed_at: TIME,
      payload: badPayload,
    }),
    /candidate digest|receipt digest|high watermark/u,
  );
});

test("candidate dispatch reserves before projection and restarts the same batch", async () => {
  const fixture = githubGitFixture();
  const capability = scheduleCapabilityReceipt();
  const triggerIdentity = scheduleTriggerIdentity();
  const runIdentity = { ...OWNER };
  const verifier = provenanceVerifier({
    eventName: "schedule",
    ref: triggerIdentity.ref,
    shaValue: triggerIdentity.sha,
    runIdentity,
  });
  const ledger = makeLedger(fixture, capability, verifier);
  await ledger.bootstrapCapability();
  const candidateFixture = candidateTransportFixture(0, {
    exactScopeCandidateNumber: PR.number,
  });
  candidateFixture.setListedNumbers([PR.number]);
  await appendCompletedCandidateInventory({
    ledger,
    transportFixture: candidateFixture,
  });
  const scanCommand = await createScheduleWorkflowCommandHandle();
  const beforeReserve = await ledger.load();
  const writesBeforeReserve = fixture.writeCalls;
  const reserved = await ledger.loadOrReserveCandidateDispatch({
    workflow_command_handle: scanCommand,
    trigger_identity: triggerIdentity,
    repository_endpoint_receipt: scheduleRepositoryEndpointReceipt(),
  });
  assert.equal(reserved.state, "dispatch");
  assert.equal(reserved.restarted, false);
  assert.equal(reserved.plan.items.length, 1);
  assert.equal(reserved.plan.items[0].candidate.number, PR.number);
  assert.ok(fixture.writeCalls > writesBeforeReserve);
  const afterReserve = await ledger.load();
  assert.equal(afterReserve.records.length, beforeReserve.records.length + 1);
  assertV2GitLedgerCandidateDispatchHandle(
    reserved.candidate_dispatch_handle,
    { purpose: "scan" },
  );
  assert.deepEqual(
    projectV2GitLedgerCandidateDispatchPlan(
      reserved.candidate_dispatch_handle,
    ),
    reserved.plan,
  );
  assert.throws(
    () => assertV2GitLedgerCandidateDispatchHandle(
      structuredClone(reserved.candidate_dispatch_handle),
    ),
    (error) => error.code === "UNTRUSTED_CANDIDATE_DISPATCH_HANDLE",
  );

  runIdentity.run_id = "9002";
  runIdentity.run_attempt = 2;
  const nextOwner = { ...runIdentity };
  const restartedLedger = makeLedger(
    fixture,
    capability,
    verifier,
  );
  const nextScanCommand = await createScheduleWorkflowCommandHandle({
    runIdentity: nextOwner,
  });
  const writesBeforeRestart = fixture.writeCalls;
  const restarted = await restartedLedger.loadOrReserveCandidateDispatch({
    workflow_command_handle: nextScanCommand,
    trigger_identity: triggerIdentity,
    repository_endpoint_receipt: scheduleRepositoryEndpointReceipt(),
  });
  assert.equal(restarted.state, "dispatch");
  assert.equal(restarted.restarted, true);
  assert.equal(restarted.reservation_receipt.reservation_record_oid,
    reserved.reservation_receipt.reservation_record_oid);
  assert.deepEqual(restarted.plan, reserved.plan);
  assert.equal(fixture.writeCalls, writesBeforeRestart);

  for (const [label, command, trigger] of [
    ["selection policy", await createScheduleWorkflowCommandHandle({
      runIdentity: nextOwner,
      selectionPolicy: "disabled",
    }), triggerIdentity],
    ["event payload", await createScheduleWorkflowCommandHandle({
      runIdentity: nextOwner,
      event: { changed: true },
    }), triggerIdentity],
    ["workflow receipt", await createScheduleWorkflowCommandHandle({
      runIdentity: nextOwner,
      workflowSha: "3".repeat(40),
    }), triggerIdentity],
    ["trigger sha", nextScanCommand, {
      ...triggerIdentity,
      sha: HEAD,
    }],
  ]) {
    const writes = fixture.writeCalls;
    await assert.rejects(
      restartedLedger.loadOrReserveCandidateDispatch({
        workflow_command_handle: command,
        trigger_identity: trigger,
        repository_endpoint_receipt: scheduleRepositoryEndpointReceipt(),
      }),
      /candidate dispatch|schedule authority/u,
      label,
    );
    assert.equal(fixture.writeCalls, writes, `${label} drift wrote a record`);
  }
  const loaded = await restartedLedger.load();
  assert.deepEqual(
    deriveV2GitLedgerCandidateDispatchAuthority(
      loaded.records,
      REPOSITORY,
    ),
    loaded.authority_projection.candidate_dispatch,
  );
});

test("active candidate dispatch rejects semantic capability drift before object writes", async () => {
  const fixture = githubGitFixture();
  const capability = scheduleCapabilityReceipt();
  const triggerIdentity = scheduleTriggerIdentity();
  const verifier = provenanceVerifier({
    eventName: "schedule",
    ref: triggerIdentity.ref,
    shaValue: triggerIdentity.sha,
  });
  const ledger = makeLedger(fixture, capability, verifier);
  await ledger.bootstrapCapability();
  const candidateFixture = candidateTransportFixture(0, {
    exactScopeCandidateNumber: PR.number,
  });
  candidateFixture.setListedNumbers([PR.number]);
  await appendCompletedCandidateInventory({
    ledger,
    transportFixture: candidateFixture,
  });
  await ledger.loadOrReserveCandidateDispatch({
    workflow_command_handle: await createScheduleWorkflowCommandHandle(),
    trigger_identity: triggerIdentity,
    repository_endpoint_receipt: scheduleRepositoryEndpointReceipt(),
  });

  const changedCapability = scheduleCapabilityReceipt({
    allowedEventNames: ["schedule", "workflow_dispatch"],
  });
  assert.notEqual(
    digestV2GitLedgerStableCapabilityAuthorization(capability),
    digestV2GitLedgerStableCapabilityAuthorization(changedCapability),
  );
  const tipBefore = fixture.refTarget;
  const writesBefore = fixture.writeCalls;
  const objectCreatesBefore = fixture.calls.filter((call) =>
    call.method === "POST" && new Set([
      "/git/blobs", "/git/trees", "/git/commits",
    ]).has(call.path)).length;
  const restricted = createV2GitHubGitLedgerBootstrap({
    fetch: fixture.fetch,
    token: SYNTHETIC_BEARER,
    repository: REPOSITORY,
    ledgerRef: V2_GIT_LEDGER_REF,
    restBaseUrl: "https://api.github.test",
    bootstrapCapabilityInput: bootstrapInputForCapability(changedCapability),
    verifyWorkflowProvenance: provenanceVerifier({
      eventName: "schedule",
      ref: triggerIdentity.ref,
      shaValue: triggerIdentity.sha,
    }),
  });
  await assert.rejects(
    restricted.bootstrapCapability(),
    (error) => error.code === "candidate-dispatch-capability-drift",
  );
  assert.equal(fixture.refTarget, tipBefore);
  assert.equal(fixture.writeCalls, writesBefore);
  assert.equal(fixture.calls.filter((call) =>
    call.method === "POST" && new Set([
      "/git/blobs", "/git/trees", "/git/commits",
    ]).has(call.path)).length, objectCreatesBefore);
});

test("candidate dispatch rejects an oversized public plan before reserve", async () => {
  const fixture = githubGitFixture();
  const capability = scheduleCapabilityReceipt();
  const triggerIdentity = scheduleTriggerIdentity();
  const ledger = makeLedger(fixture, capability, provenanceVerifier({
    eventName: "schedule",
    ref: triggerIdentity.ref,
    shaValue: triggerIdentity.sha,
  }));
  await ledger.bootstrapCapability();
  await appendCompletedCandidateInventory({
    ledger,
    transportFixture: candidateTransportFixture(64, {
      longNodeIds: true,
      longIds: true,
    }),
  });
  const before = await ledger.load();
  const writes = fixture.writeCalls;
  await assert.rejects(
    ledger.loadOrReserveCandidateDispatch({
      workflow_command_handle: await createScheduleWorkflowCommandHandle(),
      trigger_identity: triggerIdentity,
      repository_endpoint_receipt: scheduleRepositoryEndpointReceipt(),
    }),
    (error) => error.code === "candidate-dispatch-plan-size",
  );
  const after = await ledger.load();
  assert.equal(fixture.writeCalls, writes);
  assert.equal(after.tip_commit_sha, before.tip_commit_sha);
  assert.equal(after.authority_projection.candidate_dispatch.active_reservation,
    null);
});

test("candidate dispatch proves the complete scheduled record budget before reserve", async () => {
  const fixture = githubGitFixture();
  const capability = scheduleCapabilityReceipt();
  const triggerIdentity = scheduleTriggerIdentity();
  const ledger = makeLedger(fixture, capability, provenanceVerifier({
    eventName: "schedule",
    ref: triggerIdentity.ref,
    shaValue: triggerIdentity.sha,
  }));
  await ledger.bootstrapCapability();
  await appendCompletedCandidateInventory({
    ledger,
    transportFixture: candidateTransportFixture(293),
  });
  const before = await ledger.load();
  const budget = calculateV2GitLedgerCandidateDispatchCommitBudget({
    candidate_count: 293,
    batch_count: 5,
    reachable_record_count: before.commit_count,
  });
  assert.equal(MAX_V2_SCHEDULED_CANDIDATE_LEDGER_RECORDS, 14);
  assert.equal(budget.dispatch_commit_budget_required, 304);
  assert.equal(
    budget.candidate_execution_commit_budget_required,
    293 * 13,
  );
  assert.equal(budget.total_commit_budget_required, 293 * 14 + 11);
  assert.equal(
    budget.remaining_ledger_commit_capacity_after_dispatch,
    MAX_V2_GIT_LEDGER_COMMITS - before.commit_count -
      budget.total_commit_budget_required,
  );
  const persistedReservationBudget =
    calculateV2GitLedgerCandidateDispatchCommitBudget({
      candidate_count: 293,
      batch_count: 5,
      reachable_record_count: before.commit_count,
      reservation_persisted: true,
    });
  assert.equal(
    persistedReservationBudget.total_commit_budget_required,
    budget.total_commit_budget_required - 1,
  );
  assert.ok(budget.remaining_ledger_commit_capacity_after_dispatch < 0);
  const writes = fixture.writeCalls;
  await assert.rejects(
    ledger.loadOrReserveCandidateDispatch({
      workflow_command_handle: await createScheduleWorkflowCommandHandle(),
      trigger_identity: triggerIdentity,
      repository_endpoint_receipt: scheduleRepositoryEndpointReceipt(),
    }),
    (error) => error.code === "candidate-dispatch-commit-capacity",
  );
  const after = await ledger.load();
  assert.equal(fixture.writeCalls, writes);
  assert.equal(after.tip_commit_sha, before.tip_commit_sha);
  assert.equal(after.authority_projection.candidate_dispatch.active_reservation,
    null);
});

test("candidate dispatch binds one released scheduled terminal result before ack", async () => {
  const fixture = githubGitFixture();
  const capability = scheduleCapabilityReceipt({
    allowedEventNames: ["schedule", "pull_request_target"],
  });
  const triggerIdentity = scheduleTriggerIdentity();
  const runIdentity = { ...OWNER };
  const verifier = provenanceVerifier({
    eventName: "schedule",
    ref: triggerIdentity.ref,
    shaValue: triggerIdentity.sha,
    runIdentity,
  });
  const preflight = await loadFixtureProviderPreflight();
  const ledger = makeLedger(fixture, capability, verifier, preflight);
  await ledger.bootstrapCapability();
  const candidateFixture = candidateTransportFixture(0, {
    exactScopeCandidateNumber: PR.number,
  });
  candidateFixture.setListedNumbers([PR.number]);
  await appendCompletedCandidateInventory({
    ledger,
    transportFixture: candidateFixture,
  });
  const scanCommand = await createScheduleWorkflowCommandHandle({ runIdentity });
  const reserved = await ledger.loadOrReserveCandidateDispatch({
    workflow_command_handle: scanCommand,
    trigger_identity: triggerIdentity,
    repository_endpoint_receipt: scheduleRepositoryEndpointReceipt(),
  });
  const unrelatedMinimal = await loadFixtureMinimalScope();
  const unrelatedPreScope = await ledger
    .createPullRequestEventEvaluatedScopeReceipt({
      minimal_scope_handle: unrelatedMinimal,
      trigger_identity: {
        event_name: "pull_request_target",
        ref: "refs/heads/main",
        sha: BASE,
      },
    });
  const beforeUnrelatedAttempt = await ledger.load();
  const writesBeforeUnrelatedAttempt = fixture.writeCalls;
  await assert.rejects(
    ledger.acquireLease({
      ...leaseInput(beforeUnrelatedAttempt.tip_commit_sha),
      lease_id: "lease-unrelated-dispatch-attempt",
    }, {
      evaluated_scope_receipt: unrelatedPreScope,
    }),
    (error) => error.code === "candidate-dispatch-write-window",
  );
  assert.equal(fixture.writeCalls, writesBeforeUnrelatedAttempt);
  assert.equal(
    (await ledger.load()).tip_commit_sha,
    beforeUnrelatedAttempt.tip_commit_sha,
  );
  runIdentity.run_id = "9002";
  runIdentity.run_attempt = 2;
  const scheduledCommand = await createScheduleWorkflowCommandHandle({
    pullRequestNumber: PR.number,
    dispatchBinding: reserved.plan.items[0],
    runIdentity,
  });
  const minimal = await loadFixtureMinimalScope();
  const writesBeforeExpectedCandidateForgery = fixture.writeCalls;
  await assert.rejects(
    ledger.loadCandidateDispatchForScheduledPullRequest({
      workflow_command_handle: scheduledCommand,
      minimal_scope_handle: minimal,
      trigger_identity: triggerIdentity,
      expected_dispatch_binding: {
        ...reserved.plan.items[0],
        candidate: {
          ...reserved.plan.items[0].candidate,
          id: "999999",
        },
      },
    }),
    (error) => error.code === "candidate-dispatch-workflow-command-mismatch",
  );
  assert.equal(fixture.writeCalls, writesBeforeExpectedCandidateForgery);
  const scheduled = await ledger.loadCandidateDispatchForScheduledPullRequest({
    workflow_command_handle: scheduledCommand,
    minimal_scope_handle: minimal,
    trigger_identity: triggerIdentity,
    expected_dispatch_binding: reserved.plan.items[0],
  });
  const staleScheduled =
    await ledger.loadCandidateDispatchForScheduledPullRequest({
      workflow_command_handle: scheduledCommand,
      minimal_scope_handle: minimal,
      trigger_identity: triggerIdentity,
      expected_dispatch_binding: reserved.plan.items[0],
    });
  assertV2GitLedgerCandidateDispatchHandle(
    scheduled.candidate_dispatch_handle,
    { purpose: "scheduled-pull-request" },
  );
  const preScopeReceipt = await ledger
    .loadScheduledPullRequestEvaluatedScopeReceipt({
      candidate_dispatch_handle: scheduled.candidate_dispatch_handle,
      minimal_scope_handle: minimal,
      trigger_identity: triggerIdentity,
    });
  const stalePreScopeReceipt = await ledger
    .loadScheduledPullRequestEvaluatedScopeReceipt({
      candidate_dispatch_handle: staleScheduled.candidate_dispatch_handle,
      minimal_scope_handle: minimal,
      trigger_identity: triggerIdentity,
    });
  const discovery = await acquireFixtureLeasedDiscovery({
    ledger,
    command: scheduledCommand,
    preScopeReceipt,
    minimalPre: minimal,
    leaseTtlSeconds: 900,
  });
  const fullScopeReceipt = discovery.effect_evaluated_scope_receipt;
  const controlPlaneAuthority = await ledger.loadControlPlaneAuthority(
    fullScopeReceipt.scope,
  );
  const initialAuthority = await ledger.loadInitialRunnerStateAuthority({
    control_plane_authority: controlPlaneAuthority,
    evaluated_scope_receipt: fullScopeReceipt,
    workflow_command_handle: scheduledCommand,
  });
  const controlPlaneReceipt =
    createV2ControlPlaneReceiptFromGitLedgerAuthority(controlPlaneAuthority);
  const runnerAuthority = createV2ProductionRunnerAuthority({
    preflight_handle: preflight,
    control_plane_receipt: controlPlaneReceipt,
    initial_runner_state_authority: initialAuthority,
    expected_scope: initialAuthority.scope,
  });
  const plan = schedulerObservationRecord({
    predecessor: discovery.lease_receipt.acquire_commit_sha,
    lease: discovery.lease_receipt,
    priorAuthorityDigest: initialAuthority.prior_authority_digest,
    initialAuthority,
  }).payload.action;
  const schedulerAppend = await ledger.appendInitialSchedulerObservation({
    initial_runner_state_authority: initialAuthority,
    scheduler_evaluation: plan.scheduler_evaluation,
    status_plan: plan.status_plan,
  });
  const statusIntent = await ledger.appendStatusWriteIntent({
    scheduler_append: schedulerAppend,
    status_write_index: 0,
  });
  const statusResponse = await ledger.appendStatusWriteResponse({
    status_intent_handle: statusIntent.status_intent_handle,
    intent_append_receipt: statusIntent.intent_append_receipt,
    receipt: statusWriteResponseReceipt(
      statusIntent.transport,
      statusIntent.intent_append_receipt.ref_reread.server_time,
    ),
  });
  const releaseReceipt = await releaseFixtureDiscoveryLease(ledger, discovery);
  const beforeReplayedAttempt = await ledger.load();
  const writesBeforeReplayedAttempt = fixture.writeCalls;
  await assert.rejects(
    acquireFixtureLeasedDiscovery({
      ledger,
      command: scheduledCommand,
      preScopeReceipt: stalePreScopeReceipt,
      minimalPre: minimal,
      leaseTtlSeconds: 900,
    }),
    (error) => error.code === "candidate-dispatch-attempt-replayed",
  );
  assert.equal(fixture.writeCalls, writesBeforeReplayedAttempt);
  assert.equal(
    (await ledger.load()).tip_commit_sha,
    beforeReplayedAttempt.tip_commit_sha,
  );
  const terminalResult = candidateDispatchTerminalResult({
    decision: plan.scheduler_evaluation.decision,
    schedulerAppend,
    leaseReleaseReceipt: releaseReceipt,
    preflight,
    continuityAuthority: discovery.continuity_authority,
    controlPlaneReceipt,
    initialAuthority,
    runnerAuthority,
    statusIntent,
    statusResponse,
  });
  const resultAuthority = await ledger.createCandidateDispatchResultAuthority({
    candidate_dispatch_handle: scheduled.candidate_dispatch_handle,
    scheduler_append: schedulerAppend,
    production_runner_authority: runnerAuthority,
    lease_release_receipt: releaseReceipt,
    terminal_result: terminalResult,
  });
  assertV2GitLedgerCandidateDispatchResultHandle(
    resultAuthority.candidate_dispatch_result_handle,
  );
  assert.throws(
    () => assertV2GitLedgerCandidateDispatchResultHandle(
      structuredClone(resultAuthority.candidate_dispatch_result_handle),
    ),
    (error) => error.code === "UNTRUSTED_CANDIDATE_DISPATCH_RESULT_HANDLE",
  );
  const ack = await ledger.ackCandidateDispatch({
    candidate_dispatch_handle: scheduled.candidate_dispatch_handle,
    reservation_receipt: scheduled.reservation_receipt,
    full_scope_receipt: fullScopeReceipt,
    candidate_dispatch_result_handle:
      resultAuthority.candidate_dispatch_result_handle,
  });
  assert.equal(
    resultAuthority.result.decision,
    plan.scheduler_evaluation.decision,
  );
  assert.equal(resultAuthority.result.public_effects_performed, 1);
  assert.equal(ack.result_digest, resultAuthority.result.result_digest);
  assert.notEqual(ack.ack_append_receipt, null);
  assert.notEqual(ack.batch_completion_append_receipt, null);
  assert.notEqual(ack.cycle_completion_append_receipt, null);
  assert.equal(ack.remaining_plan, null);
  const final = await ledger.load();
  assert.equal(final.active_lease, null);
  assert.equal(
    final.authority_projection.candidate_dispatch.current_cycle.cycle_complete,
    true,
  );
  assert.deepEqual(
    deriveV2GitLedgerCandidateDispatchAuthority(final.records, REPOSITORY),
    final.authority_projection.candidate_dispatch,
  );
  const writesBeforeReplay = fixture.writeCalls;
  await assert.rejects(
    ledger.ackCandidateDispatch({
      candidate_dispatch_handle: scheduled.candidate_dispatch_handle,
      reservation_receipt: scheduled.reservation_receipt,
      full_scope_receipt: fullScopeReceipt,
      candidate_dispatch_result_handle:
        resultAuthority.candidate_dispatch_result_handle,
    }),
    (error) => error.code === "candidate-dispatch-handle-replayed",
  );
  assert.equal(fixture.writeCalls, writesBeforeReplay);

  runIdentity.run_id = OWNER.run_id;
  runIdentity.run_attempt = OWNER.run_attempt;
  const priorInventory = (await ledger.load()).authority_projection
    .candidate_inventory.completed_cycle.final_inventory;
  candidateFixture.setListedNumbers([PR.number, PR.number + 1]);
  await appendCompletedCandidateInventory({
    ledger,
    transportFixture: candidateFixture,
    priorInventory,
  });
  runIdentity.run_id = "9003";
  runIdentity.run_attempt = 1;
  const nextScanCommand = await createScheduleWorkflowCommandHandle({
    runIdentity,
  });
  const nextReservation = await ledger.loadOrReserveCandidateDispatch({
    workflow_command_handle: nextScanCommand,
    trigger_identity: triggerIdentity,
    repository_endpoint_receipt: scheduleRepositoryEndpointReceipt(),
  });
  assert.deepEqual(
    nextReservation.plan.items[0].candidate,
    reserved.plan.items[0].candidate,
  );
  assert.notEqual(
    nextReservation.plan.items[0].generation_id,
    reserved.plan.items[0].generation_id,
  );
  runIdentity.run_id = "9004";
  const nextScheduledCommand = await createScheduleWorkflowCommandHandle({
    pullRequestNumber: PR.number,
    dispatchBinding: nextReservation.plan.items[0],
    runIdentity,
  });
  const nextMinimal = await loadFixtureMinimalScope();
  const writesBeforeStaleMatrix = fixture.writeCalls;
  await assert.rejects(
    ledger.loadCandidateDispatchForScheduledPullRequest({
      workflow_command_handle: nextScheduledCommand,
      minimal_scope_handle: nextMinimal,
      trigger_identity: triggerIdentity,
      expected_dispatch_binding: reserved.plan.items[0],
    }),
    (error) => error.code === "candidate-dispatch-workflow-command-mismatch",
  );
  assert.equal(fixture.writeCalls, writesBeforeStaleMatrix);
  const currentScheduled =
    await ledger.loadCandidateDispatchForScheduledPullRequest({
      workflow_command_handle: nextScheduledCommand,
      minimal_scope_handle: nextMinimal,
      trigger_identity: triggerIdentity,
      expected_dispatch_binding: nextReservation.plan.items[0],
    });
  assertV2GitLedgerCandidateDispatchHandle(
    currentScheduled.candidate_dispatch_handle,
    { purpose: "scheduled-pull-request" },
  );
});

test("candidate dispatch recovers one released same-run scheduled attempt", async () => {
  const attempt = await createScheduledCandidateDispatchAttempt();
  const releaseReceipt = await releaseFixtureDiscoveryLease(
    attempt.ledger,
    attempt.discovery,
  );
  const recovered = await attempt.ledger.recoverCandidateDispatchFailure({
    workflow_command_handle: attempt.scheduledCommand,
    trigger_identity: attempt.triggerIdentity,
    repository_endpoint_receipt: scheduleRepositoryEndpointReceipt(),
    expected_dispatch_binding: attempt.reserved.plan.items[0],
  });
  assert.equal(recovered.recovery_mode, "released");
  assert.equal(recovered.prefix_phase, "lease-acquired");
  assert.equal(recovered.result.outcome, "failed");
  assert.equal(
    recovered.result.failure_code,
    "CANDIDATE_ATTEMPT_RECOVERED_AFTER_LEASE",
  );
  assert.equal(recovered.result.public_effects_performed, 0);
  assert.notEqual(recovered.ack_append_receipt, null);
  assert.notEqual(recovered.batch_completion_append_receipt, null);
  assert.notEqual(recovered.cycle_completion_append_receipt, null);
  assert.equal(recovered.cycle_complete, true);
  assert.equal(recovered.remaining_plan, null);
  const loaded = await attempt.ledger.load();
  const ack = loaded.records.find((entry) =>
    entry.envelope.record_type === "candidate-dispatch-observation" &&
    entry.envelope.payload.phase === "candidate-ack");
  assert.equal(
    ack.envelope.payload.candidate_ack.terminal_authority
      .lease_release_record_oid,
    releaseReceipt.commit_sha,
  );
  assert.equal(
    ack.envelope.payload.command_authority.pull_request_number,
    PR.number,
  );
});

test("candidate dispatch recovery classifies a durable status ambiguity", async () => {
  const attempt = await createScheduledCandidateDispatchAttempt();
  const fullScopeReceipt = attempt.discovery.effect_evaluated_scope_receipt;
  const controlPlaneAuthority = await attempt.ledger.loadControlPlaneAuthority(
    fullScopeReceipt.scope,
  );
  const initialAuthority = await attempt.ledger.loadInitialRunnerStateAuthority({
    control_plane_authority: controlPlaneAuthority,
    evaluated_scope_receipt: fullScopeReceipt,
    workflow_command_handle: attempt.scheduledCommand,
  });
  const controlPlaneReceipt =
    createV2ControlPlaneReceiptFromGitLedgerAuthority(controlPlaneAuthority);
  const runnerAuthority = createV2ProductionRunnerAuthority({
    preflight_handle: attempt.preflight,
    control_plane_receipt: controlPlaneReceipt,
    initial_runner_state_authority: initialAuthority,
    expected_scope: initialAuthority.scope,
  });
  const plan = schedulerObservationRecord({
    predecessor: attempt.discovery.lease_receipt.acquire_commit_sha,
    lease: attempt.discovery.lease_receipt,
    priorAuthorityDigest: initialAuthority.prior_authority_digest,
    initialAuthority,
  }).payload.action;
  const schedulerAppend = await attempt.ledger
    .appendInitialSchedulerObservation({
      initial_runner_state_authority: initialAuthority,
      scheduler_evaluation: plan.scheduler_evaluation,
      status_plan: plan.status_plan,
    });
  await attempt.ledger.appendStatusWriteIntent({
    scheduler_append: schedulerAppend,
    status_write_index: 0,
  });
  await releaseFixtureDiscoveryLease(attempt.ledger, attempt.discovery);
  const recovered = await attempt.ledger.recoverCandidateDispatchFailure({
    workflow_command_handle: attempt.scheduledCommand,
    trigger_identity: attempt.triggerIdentity,
    repository_endpoint_receipt: scheduleRepositoryEndpointReceipt(),
    expected_dispatch_binding: attempt.reserved.plan.items[0],
  });
  assert.equal(recovered.prefix_phase, "status-intent");
  assert.equal(recovered.result.public_effects_performed, 1);
  assert.equal(
    recovered.result.failure_code,
    "CANDIDATE_STATUS_EFFECT_AMBIGUOUS",
  );
  const loaded = await attempt.ledger.load();
  const ack = loaded.records.find((entry) =>
    entry.envelope.record_type === "candidate-dispatch-observation" &&
    entry.envelope.payload.phase === "candidate-ack");
  assert.deepEqual(
    ack.envelope.payload.candidate_ack.terminal_authority.terminal_projection,
    {
      decision: plan.scheduler_evaluation.decision,
      public_effects_performed: 1,
      status_effect_outcome: "ambiguous",
      status_ambiguity_code: "CANDIDATE_STATUS_EFFECT_AMBIGUOUS",
      reservation_status_effect_outcome: "not-required",
      reservation_status_ambiguity_code: null,
      automatic_request_effect_outcome: "not-required",
      automatic_request_ambiguity_code: null,
    },
  );
  assert.equal(runnerAuthority.effect_barrier,
    "scheduler-observation-required");
});

test("candidate dispatch recovery classifies every durable protocol prefix", async () => {
  const attempt = await createScheduledCandidateDispatchAttempt();
  attempt.fixture.freezeServerTime();
  const fullScopeReceipt = attempt.discovery.effect_evaluated_scope_receipt;
  const controlPlaneAuthority = await attempt.ledger.loadControlPlaneAuthority(
    fullScopeReceipt.scope,
  );
  const initialAuthority = await attempt.ledger.loadInitialRunnerStateAuthority({
    control_plane_authority: controlPlaneAuthority,
    evaluated_scope_receipt: fullScopeReceipt,
    workflow_command_handle: attempt.scheduledCommand,
  });
  const plan = schedulerObservationRecord({
    predecessor: attempt.discovery.lease_receipt.acquire_commit_sha,
    lease: attempt.discovery.lease_receipt,
    priorAuthorityDigest: initialAuthority.prior_authority_digest,
    initialAuthority,
  }).payload.action;
  const schedulerAppend = await attempt.ledger
    .appendInitialSchedulerObservation({
      initial_runner_state_authority: initialAuthority,
      scheduler_evaluation: plan.scheduler_evaluation,
      status_plan: plan.status_plan,
    });
  const statusIntent = await attempt.ledger.appendStatusWriteIntent({
    scheduler_append: schedulerAppend,
    status_write_index: 0,
  });
  const statusResponse = await attempt.ledger.appendStatusWriteResponse({
    status_intent_handle: statusIntent.status_intent_handle,
    intent_append_receipt: statusIntent.intent_append_receipt,
    receipt: statusWriteResponseReceipt(
      statusIntent.transport,
      statusIntent.intent_append_receipt.ref_reread.server_time,
    ),
  });
  const automatic = await attempt.ledger.appendAutomaticRequestReservation({
    scheduler_append: schedulerAppend,
  });
  const reservationIntent = await attempt.ledger
    .appendReservationStatusWriteIntent({
      automatic_reservation_handle: automatic.automatic_reservation_handle,
      reservation_append_receipt: automatic.reservation_append_receipt,
    });
  const reservationResponse = await attempt.ledger
    .appendReservationStatusWriteResponse({
      reservation_status_intent_handle:
        reservationIntent.reservation_status_intent_handle,
      intent_append_receipt: reservationIntent.intent_append_receipt,
      receipt: reservationStatusWriteResponseReceipt(
        reservationIntent.transport,
        reservationIntent.intent_append_receipt.ref_reread.server_time,
      ),
    });
  const requestIntent = await attempt.ledger
    .appendAutomaticReviewRequestIntent({
      automatic_reservation_handle: automatic.automatic_reservation_handle,
      reservation_append_receipt: automatic.reservation_append_receipt,
      reservation_status_response_append: reservationResponse,
    });
  const requestReceipt = await automaticReviewRequestBindingReceipt({
    action: {
      method: "POST",
      request_body_sha256: rawDigest("@codex review"),
    },
    observedAt: requestIntent.intent_append_receipt.ref_reread.server_time,
  });
  const binding = await attempt.ledger.appendAutomaticReviewRequestBinding({
    automatic_request_intent_handle:
      requestIntent.automatic_request_intent_handle,
    intent_append_receipt: requestIntent.intent_append_receipt,
    receipt: requestReceipt,
  });
  const release = await releaseFixtureDiscoveryLease(
    attempt.ledger,
    attempt.discovery,
  );
  const records = (await attempt.ledger.load()).records;
  const stages = [
    [0, attempt.discovery.lease_receipt.acquire_commit_sha,
      "lease-acquired", "CANDIDATE_ATTEMPT_RECOVERED_AFTER_LEASE", 0,
      "not-required", "not-required", "not-required"],
    [1, schedulerAppend.append_receipt.commit_sha,
      "scheduler-observed", "CANDIDATE_ATTEMPT_RECOVERED_AFTER_SCHEDULER", 0,
      "not-required", "not-required", "not-required"],
    [2, statusIntent.intent_append_receipt.commit_sha,
      "status-intent", "CANDIDATE_STATUS_EFFECT_AMBIGUOUS", 1,
      "ambiguous", "not-required", "not-required"],
    [3, statusResponse.response_append_receipt.commit_sha,
      "status-response", "CANDIDATE_ATTEMPT_RECOVERED_AFTER_STATUS", 1,
      "bound", "not-required", "not-required"],
    [4, automatic.reservation_append_receipt.commit_sha,
      "automatic-reservation",
      "CANDIDATE_ATTEMPT_RECOVERED_AFTER_RESERVATION", 1,
      "bound", "not-required", "not-required"],
    [5, reservationIntent.intent_append_receipt.commit_sha,
      "reservation-status-intent",
      "CANDIDATE_RESERVATION_STATUS_EFFECT_AMBIGUOUS", 2,
      "bound", "ambiguous", "not-required"],
    [6, reservationResponse.response_append_receipt.commit_sha,
      "reservation-status-response",
      "CANDIDATE_ATTEMPT_RECOVERED_AFTER_RESERVATION_STATUS", 2,
      "bound", "bound", "not-required"],
    [7, requestIntent.attempt_append_receipt.commit_sha,
      "request-attempt",
      "CANDIDATE_ATTEMPT_RECOVERED_AFTER_REQUEST_ATTEMPT", 2,
      "bound", "bound", "not-required"],
    [8, requestIntent.intent_append_receipt.commit_sha,
      "review-request-intent", "CANDIDATE_REQUEST_EFFECT_AMBIGUOUS", 3,
      "bound", "bound", "ambiguous"],
    [9, binding.review_response_append_receipt.commit_sha,
      "review-request-response", "CANDIDATE_REQUEST_EFFECT_AMBIGUOUS", 3,
      "bound", "bound", "ambiguous"],
    [10, binding.request_binding_intent_append_receipt.commit_sha,
      "request-binding-intent", "CANDIDATE_REQUEST_EFFECT_AMBIGUOUS", 3,
      "bound", "bound", "ambiguous"],
    [11, binding.request_binding_response_append_receipt.commit_sha,
      "request-binding-response",
      "CANDIDATE_ATTEMPT_RECOVERED_AFTER_BINDING_RESPONSE", 3,
      "bound", "bound", "bound"],
    [12, release.commit_sha, "request-binding-response",
      "CANDIDATE_ATTEMPT_RECOVERED_AFTER_BINDING_RESPONSE", 3,
      "bound", "bound", "bound"],
  ];
  for (const [
    stage,
    commitSha,
    prefixPhase,
    failureCode,
    publicEffects,
    statusOutcome,
    reservationStatusOutcome,
    requestOutcome,
  ] of stages) {
    const recordIndex = records.findIndex((entry) =>
      entry.commit_sha === commitSha);
    assert.notEqual(recordIndex, -1, `stage ${stage} record is reachable`);
    const projection =
      classifyV2GitLedgerCandidateDispatchRecoveryPrefix({
        records: records.slice(0, recordIndex + 1),
        scheduled_scope_receipt: stage === 0
          ? attempt.preScopeReceipt
          : fullScopeReceipt,
      });
    assert.equal(projection.prefix_phase, prefixPhase, `stage ${stage}`);
    assert.equal(projection.failure_code, failureCode, `stage ${stage}`);
    assert.equal(
      projection.terminal_projection.public_effects_performed,
      publicEffects,
      `stage ${stage}`,
    );
    assert.equal(
      projection.terminal_projection.status_effect_outcome,
      statusOutcome,
      `stage ${stage}`,
    );
    assert.equal(
      projection.terminal_projection.reservation_status_effect_outcome,
      reservationStatusOutcome,
      `stage ${stage}`,
    );
    assert.equal(
      projection.terminal_projection.automatic_request_effect_outcome,
      requestOutcome,
      `stage ${stage}`,
    );
    assert.equal(
      projection.lease_release_record_oid,
      stage === 12 ? release.commit_sha : null,
      `stage ${stage}`,
    );
  }
});

test("candidate dispatch rejects a self-sealed forged ack before write and on restart", async () => {
  const source = await createScheduledCandidateDispatchAttempt();
  await releaseFixtureDiscoveryLease(source.ledger, source.discovery);
  source.fixture.failNextCandidateDispatchUpdate("batch-complete");
  await assert.rejects(
    source.ledger.recoverCandidateDispatchFailure({
      workflow_command_handle: source.scheduledCommand,
      trigger_identity: source.triggerIdentity,
      repository_endpoint_receipt: scheduleRepositoryEndpointReceipt(),
      expected_dispatch_binding: source.reserved.plan.items[0],
    }),
    (error) => error.code === "unexpected-http-status",
  );
  const sourceLoaded = await source.ledger.load();
  const sourceAck = sourceLoaded.records.at(-1);
  assert.equal(sourceAck.envelope.record_type,
    "candidate-dispatch-observation");
  assert.equal(sourceAck.envelope.payload.phase, "candidate-ack");
  const forgedPayload = forgeCandidateDispatchAckPayload(
    sourceAck.envelope.payload,
  );

  const target = await createScheduledCandidateDispatchAttempt();
  await releaseFixtureDiscoveryLease(target.ledger, target.discovery);
  const targetLoaded = await target.ledger.load();
  assert.equal(
    targetLoaded.tip_commit_sha,
    sourceAck.envelope.predecessor_commit_sha,
    "the independent target must expose the same deterministic pre-ack history",
  );
  const forgedRecord = createV2GitLedgerCandidateDispatchRecord({
    predecessor_commit_sha: targetLoaded.tip_commit_sha,
    server_observed_at: targetLoaded.post_ref.server_time,
    payload: forgedPayload,
  });
  const forgedEvaluated =
    createV2GitLedgerCandidateDispatchEvaluatedScopeReceipt({
      repository: REPOSITORY,
      payload: forgedPayload,
      trigger_identity: target.triggerIdentity,
      repository_endpoint_receipt: scheduleRepositoryEndpointReceipt(),
    });
  const writesBeforeForgedAppend = target.fixture.writeCalls;
  const tipBeforeForgedAppend = target.fixture.refTarget;
  await assert.rejects(
    target.ledger.appendRecord(forgedRecord, {
      evaluated_scope_receipt: forgedEvaluated,
    }),
    /terminal|public effects|reachable history/u,
  );
  assert.equal(target.fixture.writeCalls, writesBeforeForgedAppend);
  assert.equal(target.fixture.refTarget, tipBeforeForgedAppend);

  source.fixture.rewriteTipEnvelope((envelope) => {
    resealFixtureEnvelopePayload(
      envelope,
      forgeCandidateDispatchAckPayload(envelope.payload),
    );
  });
  const restarted = makeLedger(
    source.fixture,
    source.capability,
    source.verifier,
    source.preflight,
  );
  await assert.rejects(
    restarted.load(),
    /terminal|public effects|reachable history/u,
  );
});

test("candidate dispatch restart completes a partial final batch without redispatch", async () => {
  const attempt = await createScheduledCandidateDispatchAttempt();
  await releaseFixtureDiscoveryLease(attempt.ledger, attempt.discovery);
  attempt.fixture.failNextCandidateDispatchUpdate("cycle-complete");
  await assert.rejects(
    attempt.ledger.recoverCandidateDispatchFailure({
      workflow_command_handle: attempt.scheduledCommand,
      trigger_identity: attempt.triggerIdentity,
      repository_endpoint_receipt: scheduleRepositoryEndpointReceipt(),
      expected_dispatch_binding: attempt.reserved.plan.items[0],
    }),
    (error) => error.code === "unexpected-http-status",
  );
  const partial = await attempt.ledger.load();
  const partialCycle = partial.authority_projection.candidate_dispatch
    .current_cycle;
  assert.equal(partialCycle.active_reservation, null);
  assert.equal(partialCycle.completed_batches.length, partialCycle.batch_count);
  assert.equal(partialCycle.cycle_complete, false);
  assert.equal(partial.records.filter((entry) =>
    entry.envelope.record_type === "candidate-dispatch-observation" &&
    entry.envelope.payload.phase === "candidate-ack").length, 1);
  assert.equal(partial.records.at(-1).envelope.payload.phase, "batch-complete");

  attempt.runIdentity.run_id = "9003";
  attempt.runIdentity.run_attempt = 1;
  const restarted = makeLedger(
    attempt.fixture,
    attempt.capability,
    attempt.verifier,
    attempt.preflight,
  );
  const completed = await restarted.loadOrReserveCandidateDispatch({
    workflow_command_handle: await createScheduleWorkflowCommandHandle({
      runIdentity: attempt.runIdentity,
    }),
    trigger_identity: attempt.triggerIdentity,
    repository_endpoint_receipt: scheduleRepositoryEndpointReceipt(),
  });
  assert.equal(completed.state, "complete");
  assert.equal(completed.plan, null);
  assert.equal(completed.candidate_dispatch_handle, null);
  const final = await restarted.load();
  assert.equal(final.commit_count, partial.commit_count + 1);
  assert.equal(final.records.at(-1).envelope.payload.phase, "cycle-complete");
  assert.equal(final.records.filter((entry) =>
    entry.envelope.record_type === "candidate-dispatch-observation" &&
    entry.envelope.payload.phase === "reserve").length, 1);
  assert.equal(final.records.filter((entry) =>
    entry.envelope.record_type === "candidate-dispatch-observation" &&
    entry.envelope.payload.phase === "candidate-ack").length, 1);
  assert.equal(
    final.authority_projection.candidate_dispatch.current_cycle.cycle_complete,
    true,
  );
});

test("candidate dispatch scan exposes pending then expired recovery without redispatch", async () => {
  const attempt = await createScheduledCandidateDispatchAttempt();
  attempt.runIdentity.run_id = "9003";
  attempt.runIdentity.run_attempt = 1;
  const recoveryScanCommand = await createScheduleWorkflowCommandHandle({
    runIdentity: attempt.runIdentity,
  });
  const writesBeforePending = attempt.fixture.writeCalls;
  const pending = await attempt.ledger.loadOrReserveCandidateDispatch({
    workflow_command_handle: recoveryScanCommand,
    trigger_identity: attempt.triggerIdentity,
    repository_endpoint_receipt: scheduleRepositoryEndpointReceipt(),
  });
  assert.equal(pending.state, "recovery-required");
  assert.equal(pending.plan, null);
  assert.equal(pending.candidate_dispatch_handle, null);
  assert.equal(pending.recovery_required.ready, false);
  assert.equal(pending.recovery_required.mode, "pending-expiry");
  assert.equal(
    pending.recovery_required.ready_at,
    attempt.discovery.lease_receipt.expires_at,
  );
  assert.deepEqual(
    pending.recovery_required.expected_dispatch_binding,
    attempt.reserved.plan.items[0],
  );
  assert.equal(attempt.fixture.writeCalls, writesBeforePending);
  await assert.rejects(
    attempt.ledger.recoverCandidateDispatchFailure({
      workflow_command_handle: recoveryScanCommand,
      trigger_identity: attempt.triggerIdentity,
      repository_endpoint_receipt: scheduleRepositoryEndpointReceipt(),
      expected_dispatch_binding: attempt.reserved.plan.items[0],
    }),
    (error) => error.code === "candidate-dispatch-recovery-not-ready",
  );
  assert.equal(attempt.fixture.writeCalls, writesBeforePending);

  attempt.fixture.advanceServerTime(1_000);
  const restartedLedger = makeLedger(
    attempt.fixture,
    attempt.capability,
    attempt.verifier,
    attempt.preflight,
  );
  const ready = await restartedLedger.loadOrReserveCandidateDispatch({
    workflow_command_handle: recoveryScanCommand,
    trigger_identity: attempt.triggerIdentity,
    repository_endpoint_receipt: scheduleRepositoryEndpointReceipt(),
  });
  assert.equal(ready.state, "recovery-required");
  assert.equal(ready.plan, null);
  assert.equal(ready.recovery_required.ready, true);
  assert.equal(ready.recovery_required.mode, "expired");
  assert.equal(
    ready.recovery_required.ready_at,
    attempt.discovery.lease_receipt.expires_at,
  );
  assert.equal(attempt.fixture.writeCalls, writesBeforePending);
  const recovered = await restartedLedger.recoverCandidateDispatchFailure({
    workflow_command_handle: recoveryScanCommand,
    trigger_identity: attempt.triggerIdentity,
    repository_endpoint_receipt: scheduleRepositoryEndpointReceipt(),
    expected_dispatch_binding: ready.recovery_required
      .expected_dispatch_binding,
  });
  assert.equal(recovered.recovery_mode, "expired");
  assert.equal(recovered.result.outcome, "failed");
  assert.equal(recovered.result.public_effects_performed, 0);
  assert.equal(recovered.cycle_complete, true);
  const loaded = await restartedLedger.load();
  assert.equal(loaded.active_lease, null);
  const ack = loaded.records.find((entry) =>
    entry.envelope.record_type === "candidate-dispatch-observation" &&
    entry.envelope.payload.phase === "candidate-ack");
  assert.equal(
    ack.envelope.payload.candidate_ack.terminal_authority
      .lease_release_record_oid,
    null,
  );
  assert.equal(
    ack.envelope.payload.command_authority.pull_request_number,
    null,
  );
});

test("discovery continuity receipt closes full and minimal evidence", async () => {
  const fixture = githubGitFixture();
  const ledger = makeLedger(fixture);
  await ledger.bootstrapCapability();
  const preScopeReceipt = await ledger.defaultEvaluatedScopeReceipt();
  const loaded = await ledger.load();
  const lease = await ledger.acquireLease(
    leaseInput(loaded.tip_commit_sha),
    { evaluated_scope_receipt: preScopeReceipt },
  );
  const minimalPre = await loadFixtureMinimalScope();
  const transportFixture = providerTransportFixture();
  const snapshot = await createProviderTransport(transportFixture.fetch)
    .loadSnapshot({
      owner: REPOSITORY.owner,
      repo: REPOSITORY.name,
      pullNumber: PR.number,
      artifactSelectors: [{ kind: "issue_comment", id: "71" }],
      permissionSubjects: [],
    });
  const minimalPost = minimalScopeReceiptAt(
    minimalPre,
    "2026-08-13T12:20:00.000Z",
  );
  const input = {
    repository: REPOSITORY,
    scope: preScopeReceipt.scope,
    pre_scope_receipt_digest: preScopeReceipt.receipt_digest,
    lease_receipt: lease,
    discovery_snapshot: snapshot,
    transport_limits: V2_TRANSPORT_DEFAULT_LIMITS,
    minimal_pre: minimalPre,
    minimal_post: minimalPost,
  };
  const receipt = createV2GitLedgerDiscoveryContinuityReceipt(input);
  assert.equal(
    receipt.schema,
    V2_GIT_LEDGER_DISCOVERY_CONTINUITY_RECEIPT_SCHEMA,
  );
  assert.equal(receipt.full_snapshot.snapshot_schema_version, 2);
  assert.equal(
    receipt.full_snapshot.scope_pre.scope_receipt.endpoint_receipts
      .pull_request.path,
    "/repos/owner/repo/pulls/7",
  );
  assert.equal(
    receipt.minimal_pre.endpoint_receipts.length,
    minimalPre.endpoint_receipts.length,
  );
  assert.deepEqual(
    receipt.full_snapshot.summary.transport_limits,
    V2_TRANSPORT_DEFAULT_LIMITS,
  );
  assert.deepEqual(
    validateV2GitLedgerDiscoveryContinuityReceipt(receipt, {
      repository: REPOSITORY,
      scope: preScopeReceipt.scope,
      pre_scope_receipt_digest: preScopeReceipt.receipt_digest,
      lease_receipt: lease,
    }),
    receipt,
  );

  const narrower = createV2GitLedgerDiscoveryContinuityReceipt({
    ...input,
    transport_limits: {
      ...V2_TRANSPORT_DEFAULT_LIMITS,
      max_pages: V2_TRANSPORT_DEFAULT_LIMITS.max_pages - 1,
    },
  });
  assert.equal(
    narrower.full_snapshot.summary.transport_limits.max_pages,
    V2_TRANSPORT_DEFAULT_LIMITS.max_pages - 1,
  );
  assert.throws(
    () => createV2GitLedgerDiscoveryContinuityReceipt({
      ...input,
      transport_limits: {
        ...V2_TRANSPORT_DEFAULT_LIMITS,
        max_requests: V2_TRANSPORT_DEFAULT_LIMITS.max_requests + 1,
      },
    }),
    /transport limits\.max_requests is relaxed/u,
  );
  assert.throws(
    () => createV2GitLedgerDiscoveryContinuityReceipt({
      ...input,
      minimal_post: minimalScopeReceiptAt(
        minimalPre,
        "2026-08-12T12:00:00.000Z",
      ),
    }),
    /server time regressed/u,
  );
  const tampered = structuredClone(receipt);
  tampered.minimal_pre.endpoint_receipts[0].raw_body_sha256 =
    `sha256:${"f".repeat(64)}`;
  assert.throws(
    () => validateV2GitLedgerDiscoveryContinuityReceipt(tampered),
    /endpoint receipt digest is invalid/u,
  );
});

test("full discovery factory accepts only one branded leased continuity", async () => {
  const fixture = githubGitFixture();
  const preflight = await loadFixtureProviderPreflight();
  const capability = capabilityReceiptForTrigger(
    "pull_request_target",
    "refs/heads/main",
  );
  const ledger = makeLedger(fixture, capability, provenanceVerifier({
    eventName: "pull_request_target",
    ref: "refs/heads/main",
    shaValue: BASE,
  }), preflight);
  await ledger.bootstrapCapability();
  const minimalPre = await loadFixtureMinimalScope();
  const preScopeReceipt = await ledger
    .createPullRequestEventEvaluatedScopeReceipt({
      minimal_scope_handle: minimalPre,
      trigger_identity: {
        event_name: "pull_request_target",
        ref: "refs/heads/main",
        sha: BASE,
      },
    });
  const command = await createPullRequestTargetWorkflowCommandHandle();
  const discovery = await acquireFixtureLeasedDiscovery({
    ledger,
    command,
    preScopeReceipt,
    minimalPre,
  });
  assert.equal(discovery.lease_evaluated_scope_receipt.phase, "pre-scope");
  assert.equal(discovery.full_evaluated_scope_receipt.phase, "full-discovery");
  assert.equal(
    discovery.full_evaluated_scope_receipt.discovery_continuity_receipt
      .continuity_receipt_digest,
    discovery.continuity_authority.continuity_receipt
      .continuity_receipt_digest,
  );

  const writesBeforeForgery = fixture.writeCalls;
  await assert.rejects(
    ledger.createFullDiscoveryEvaluatedScopeReceipt({
      pre_scope_receipt: preScopeReceipt,
      lease_receipt: discovery.lease_receipt,
      continuity_handle: structuredClone(discovery.continuity_authority),
    }),
    (error) => error.code === "UNTRUSTED_LEASED_DISCOVERY_CONTINUITY_HANDLE",
  );
  await assert.rejects(
    ledger.createFullDiscoveryEvaluatedScopeReceipt({
      pre_scope_receipt: structuredClone(preScopeReceipt),
      lease_receipt: discovery.lease_receipt,
      continuity_handle: discovery.continuity_authority,
    }),
    (error) => error.code === "untrusted-pre-scope-receipt",
  );
  await assert.rejects(
    ledger.createFullDiscoveryEvaluatedScopeReceipt({
      pre_scope_receipt: preScopeReceipt,
      lease_receipt: structuredClone(discovery.lease_receipt),
      continuity_handle: discovery.continuity_authority,
    }),
    (error) => error.code === "LEASED_DISCOVERY_CONTINUITY_BINDING_MISMATCH",
  );
  await assert.rejects(
    ledger.createProviderEventFullDiscoveryEvaluatedScopeReceipt({
      full_scope_receipt: discovery.full_evaluated_scope_receipt,
      continuity_handle: discovery.continuity_authority,
    }),
    (error) => error.code === "untrusted-provider-pre-scope-receipt",
  );
  assert.equal(fixture.writeCalls, writesBeforeForgery);
});

test("provider event authority is pre-read, leased, fully rediscovered, and exact-bound", async () => {
  const preflight = await loadFixtureProviderPreflight();
  const fixture = githubGitFixture();
  const capability = capabilityReceiptForTrigger(
    "issue_comment",
    "refs/heads/main",
  );
  const verifier = provenanceVerifier({
    eventName: "issue_comment",
    ref: "refs/heads/main",
    shaValue: HEAD,
  });
  const ledger = makeLedger(fixture, capability, verifier, preflight);
  await ledger.bootstrapCapability();
  const minimalScopeHandle = await loadFixtureMinimalScope();
  const transportFixture = providerTransportFixture();
  const providerArtifactHandle = await loadProviderPreScopeArtifact(
    transportFixture.fetch,
  );
  const triggerIdentity = {
    event_name: "issue_comment",
    ref: "refs/heads/main",
    sha: HEAD,
  };
  const writesBeforeUntrusted = fixture.writeCalls;
  await assert.rejects(
    ledger.createProviderEventPreScopeEvaluatedScopeReceipt({
      minimal_scope_handle: structuredClone(minimalScopeHandle),
      trigger_identity: triggerIdentity,
      provider_artifact_handle: providerArtifactHandle,
    }),
    (error) => error.code === "UNTRUSTED_MINIMAL_LIVE_SCOPE_HANDLE",
  );
  await assert.rejects(
    ledger.createProviderEventPreScopeEvaluatedScopeReceipt({
      minimal_scope_handle: minimalScopeHandle,
      trigger_identity: triggerIdentity,
      provider_artifact_handle: structuredClone(providerArtifactHandle),
    }),
    (error) => error.code === "UNTRUSTED_PROVIDER_PRE_SCOPE_ARTIFACT_HANDLE",
  );
  assert.equal(fixture.writeCalls, writesBeforeUntrusted);

  const preScopeReceipt = await ledger
    .createProviderEventPreScopeEvaluatedScopeReceipt({
      minimal_scope_handle: minimalScopeHandle,
      trigger_identity: triggerIdentity,
      provider_artifact_handle: providerArtifactHandle,
    });
  const loaded = await ledger.load();
  const writesBeforeClone = fixture.writeCalls;
  await assert.rejects(
    ledger.acquireLease(
      leaseInput(loaded.tip_commit_sha),
      { evaluated_scope_receipt: structuredClone(preScopeReceipt) },
    ),
    (error) => error.code === "untrusted-evaluated-scope-receipt",
  );
  assert.equal(fixture.writeCalls, writesBeforeClone);
  const command = await createProviderWorkflowCommandHandle();
  const discovery = await acquireFixtureLeasedDiscovery({
    ledger,
    command,
    preScopeReceipt,
    minimalPre: minimalScopeHandle,
    artifactSelectors: [{ kind: "issue_comment", id: "71" }],
  });
  const lease = discovery.lease_receipt;
  const fullScopeReceipt = discovery.effect_evaluated_scope_receipt;
  assert.equal(
    fullScopeReceipt.discovery_continuity_receipt.continuity_receipt_digest,
    discovery.continuity_authority.continuity_receipt
      .continuity_receipt_digest,
  );
  const effect = effectRecord({
    predecessor: lease.acquire_commit_sha,
    lease,
    effectId: "provider-read-observation",
    idempotencyKey: "provider-read-observation-key",
    at: TIME,
  });
  const writesBeforePreScopeEffect = fixture.writeCalls;
  await assert.rejects(
    ledger.appendRecord(effect, {
      evaluated_scope_receipt: preScopeReceipt,
    }),
    (error) => error.code === "full-discovery-receipt-required",
  );
  assert.equal(fixture.writeCalls, writesBeforePreScopeEffect);
  const effectReceipt = await ledger.appendRecord(effect, {
    evaluated_scope_receipt: fullScopeReceipt,
  });
  const release = await ledger.releaseLease({
    predecessor_commit_sha: effectReceipt.commit_sha,
    lease_receipt: lease,
    released_at: TIME,
    control_comment_binding: null,
  }, {
    evaluated_scope_receipt: structuredClone(preScopeReceipt),
  });
  const final = await ledger.load();
  assert.equal(final.tip_commit_sha, release.commit_sha);
  assert.equal(final.active_lease, null);
  assert.equal(final.effect_intent_count, 1);
  assert.equal(
    final.records.at(-2).envelope.workflow_provenance.operation_binding
      .evaluated_scope_receipt.provider_artifact_receipt.phase,
    "full-discovery",
  );
});

test("provider full discovery cannot precede lease or change its native carrier", async (t) => {
  async function setup(transportFixture) {
    const preflight = await loadFixtureProviderPreflight();
    const fixture = githubGitFixture();
    const capability = capabilityReceiptForTrigger(
      "issue_comment",
      "refs/heads/main",
    );
    const verifier = provenanceVerifier({
      eventName: "issue_comment",
      ref: "refs/heads/main",
      shaValue: HEAD,
    });
    const ledger = makeLedger(fixture, capability, verifier, preflight);
    await ledger.bootstrapCapability();
    const minimalScopeHandle = await loadFixtureMinimalScope();
    const artifactHandle = await loadProviderPreScopeArtifact(
      transportFixture.fetch,
    );
    const preScopeReceipt = await ledger
      .createProviderEventPreScopeEvaluatedScopeReceipt({
        minimal_scope_handle: minimalScopeHandle,
        trigger_identity: {
          event_name: "issue_comment",
          ref: "refs/heads/main",
          sha: HEAD,
        },
        provider_artifact_handle: artifactHandle,
      });
    return { fixture, ledger, minimalScopeHandle, preScopeReceipt };
  }

  await t.test("full snapshot before lease", async () => {
    const transportFixture = providerTransportFixture({ startSecond: -180 });
    const { fixture, ledger, minimalScopeHandle, preScopeReceipt } =
      await setup(transportFixture);
    const snapshot = await createProviderTransport(transportFixture.fetch)
      .loadSnapshot({
        owner: REPOSITORY.owner,
        repo: REPOSITORY.name,
        pullNumber: PR.number,
        artifactSelectors: [{ kind: "issue_comment", id: "71" }],
        permissionSubjects: [],
      });
    const loaded = await ledger.load();
    const lease = await ledger.acquireLease(
      leaseInput(loaded.tip_commit_sha),
      { evaluated_scope_receipt: preScopeReceipt },
    );
    const writesBefore = fixture.writeCalls;
    assert.throws(
      () => createV2GitLedgerDiscoveryContinuityReceipt({
        repository: REPOSITORY,
        scope: preScopeReceipt.scope,
        pre_scope_receipt_digest: preScopeReceipt.receipt_digest,
        lease_receipt: lease,
        discovery_snapshot: snapshot,
        transport_limits: V2_TRANSPORT_DEFAULT_LIMITS,
        minimal_pre: minimalScopeHandle,
        minimal_post: minimalScopeReceiptAt(
          minimalScopeHandle,
          "2026-08-13T12:20:00.000Z",
        ),
      }),
      /server time regressed/u,
    );
    assert.equal(fixture.writeCalls, writesBefore);
  });

  await t.test("carrier edited after lease", async () => {
    const transportFixture = providerTransportFixture();
    const { fixture, ledger, minimalScopeHandle, preScopeReceipt } =
      await setup(transportFixture);
    transportFixture.setComment(providerIssueComment({
      body: "changed after lease",
      updated_at: "2026-08-13T12:09:00Z",
    }));
    await assert.rejects(
      acquireFixtureLeasedDiscovery({
        ledger,
        command: await createProviderWorkflowCommandHandle(),
        preScopeReceipt,
        minimalPre: minimalScopeHandle,
        artifactSelectors: [{ kind: "issue_comment", id: "71" }],
        transport: createProviderTransport(transportFixture.fetch),
      }),
      (error) => error.code === "LEASED_DISCOVERY_ABORTED",
    );
    const final = await ledger.load();
    assert.equal(final.active_lease, null);
    assert.equal(final.effect_intent_count, 0, "failed discovery never refunds into a POST");
  });
});

test("provider pre-scope rejects wrong identity, repository, PR, head, deletion, and policy", async (t) => {
  const cases = [
    ["actor", providerIssueComment({ user: { ...providerIssueComment().user, id: 1 } })],
    ["app", providerIssueComment({
      performed_via_github_app: {
        ...providerIssueComment().performed_via_github_app,
        id: 1,
      },
    })],
    ["repository", providerIssueComment({
      issue_url: "https://api.github.test/repos/other/repo/issues/7",
    })],
    ["pull request", providerIssueComment({
      issue_url: "https://api.github.test/repos/owner/repo/issues/8",
    })],
    ["deleted", null],
  ];
  for (const [name, comment] of cases) {
    await t.test(name, async () => {
      const transportFixture = providerTransportFixture({ comment });
      await assert.rejects(
        loadProviderPreScopeArtifact(transportFixture.fetch),
      );
    });
  }

  await t.test("head binding", async () => {
    const preflight = await loadFixtureProviderPreflight();
    const fixture = githubGitFixture();
    const capability = capabilityReceiptForTrigger(
      "issue_comment",
      "refs/heads/main",
    );
    const verifier = provenanceVerifier({
      eventName: "issue_comment",
      ref: "refs/heads/main",
      shaValue: HEAD,
    });
    const ledger = makeLedger(fixture, capability, verifier, preflight);
    await ledger.bootstrapCapability();
    const minimalScopeHandle = await loadFixtureMinimalScope();
    const transportFixture = providerTransportFixture();
    const wrongHeadHandle = await loadV2ProviderPreScopeArtifact({
      fetch: transportFixture.fetch,
      token: SYNTHETIC_BEARER,
      restBaseUrl: "https://api.github.test",
      owner: REPOSITORY.owner,
      repo: REPOSITORY.name,
      pullNumber: PR.number,
      headSha: BASE,
      selector: { kind: "issue_comment", id: "71" },
      expectedActor: CODEX_ACTOR,
      expectedApp: CODEX_APP,
    });
    const writesBefore = fixture.writeCalls;
    await assert.rejects(
      ledger.createProviderEventPreScopeEvaluatedScopeReceipt({
        minimal_scope_handle: minimalScopeHandle,
        trigger_identity: {
          event_name: "issue_comment",
          ref: "refs/heads/main",
          sha: HEAD,
        },
        provider_artifact_handle: wrongHeadHandle,
      }),
      (error) => error.code === "PROVIDER_PRE_SCOPE_HANDLE_BINDING_MISMATCH",
    );
    assert.equal(fixture.writeCalls, writesBefore);
  });

  await t.test("unbranded live authority", async () => {
    const preflight = await loadFixtureProviderPreflight();
    const fixture = githubGitFixture();
    const capability = capabilityReceiptForTrigger(
      "issue_comment",
      "refs/heads/main",
    );
    const verifier = provenanceVerifier({
      eventName: "issue_comment",
      ref: "refs/heads/main",
      shaValue: HEAD,
    });
    const ledger = makeLedger(
      fixture,
      capability,
      verifier,
      structuredClone(preflight),
    );
    await ledger.bootstrapCapability();
    const minimalScopeHandle = await loadFixtureMinimalScope();
    const transportFixture = providerTransportFixture();
    const artifactHandle = await loadProviderPreScopeArtifact(
      transportFixture.fetch,
    );
    const writesBefore = fixture.writeCalls;
    await assert.rejects(
      ledger.createProviderEventPreScopeEvaluatedScopeReceipt({
        minimal_scope_handle: minimalScopeHandle,
        trigger_identity: {
          event_name: "issue_comment",
          ref: "refs/heads/main",
          sha: HEAD,
        },
        provider_artifact_handle: artifactHandle,
      }),
      (error) => error.code === "UNTRUSTED_PREFLIGHT_HANDLE",
    );
    assert.equal(fixture.writeCalls, writesBefore);
  });

  await t.test("catalog policy mismatch", async () => {
    const preflight = await loadFixtureProviderPreflight();
    const base = capabilityBase();
    const wrongPolicy = providerIdentityPolicy();
    wrongPolicy.actor = { ...wrongPolicy.actor, id: "1" };
    delete wrongPolicy.catalog_digest;
    wrongPolicy.catalog_digest = digestCanonical(
      "codex-review-gate-v2-provider-identity-policy",
      wrongPolicy,
    );
    base.provider_identity_policy = wrongPolicy;
    const capability = sealCapability(base);
    const fixture = githubGitFixture();
    const ledger = makeLedger(fixture, capability, provenanceVerifier(), preflight);
    await ledger.bootstrapCapability();
    const minimalScopeHandle = await loadFixtureMinimalScope();
    const transportFixture = providerTransportFixture();
    const artifactHandle = await loadProviderPreScopeArtifact(
      transportFixture.fetch,
    );
    const writesBefore = fixture.writeCalls;
    await assert.rejects(
      ledger.createProviderEventPreScopeEvaluatedScopeReceipt({
        minimal_scope_handle: minimalScopeHandle,
        trigger_identity: {
          event_name: "pull_request",
          ref: "refs/pull/7/merge",
          sha: POTENTIAL,
        },
        provider_artifact_handle: artifactHandle,
      }),
      (error) => error.code === "provider-identity-policy-mismatch",
    );
    assert.equal(fixture.writeCalls, writesBefore);
  });
});

test("manual PR authority comes only from one protected workflow command and stays read-only", async () => {
  const command = await createManualWorkflowCommandHandle();
  const preflight = await loadFixtureProviderPreflight();
  const minimalScopeHandle = await loadFixtureMinimalScope();
  const fixture = githubGitFixture();
  const capability = capabilityReceiptForTrigger(
    "workflow_dispatch",
    "refs/heads/main",
  );
  const verifier = provenanceVerifier({
    eventName: "workflow_dispatch",
    ref: "refs/heads/main",
    shaValue: HEAD,
  });
  const ledger = makeLedger(fixture, capability, verifier, preflight);
  await ledger.bootstrapCapability();
  const triggerIdentity = {
    event_name: "workflow_dispatch",
    ref: "refs/heads/main",
    sha: HEAD,
  };
  const writesBeforeUntrusted = fixture.writeCalls;
  await assert.rejects(
    ledger.createManualPullRequestEvaluatedScopeReceipt({
      minimal_scope_handle: minimalScopeHandle,
      trigger_identity: triggerIdentity,
      workflow_command_handle: structuredClone(command),
    }),
    /protected descriptor-backed command/u,
  );
  await assert.rejects(
    ledger.createManualPullRequestEvaluatedScopeReceipt({
      minimal_scope_handle: minimalScopeHandle,
      trigger_identity: { ...triggerIdentity, event_name: "issue_comment" },
      workflow_command_handle: command,
    }),
    (error) => error.code === "manual-workflow-command-mismatch",
  );
  assert.equal(fixture.writeCalls, writesBeforeUntrusted);

  const manualReceipt = await ledger
    .createManualPullRequestEvaluatedScopeReceipt({
      minimal_scope_handle: minimalScopeHandle,
      trigger_identity: triggerIdentity,
      workflow_command_handle: command,
    });
  assert.equal(manualReceipt.selector.input_name, "pull-request");
  const underscoreSelection = createV2GitLedgerManualSelectionReceipt({
    source: "trusted-reusable-workflow-input",
    input_name: "pull_request_number",
    input_value: String(PR.number),
    command_receipt_digest: manualReceipt.selector.command_receipt_digest,
    scope: manualReceipt.scope,
  });
  assert.throws(
    () => createV2GitLedgerEvaluatedScopeReceipt({
      relation: "manual-pull-request",
      repository: REPOSITORY,
      scope: manualReceipt.scope,
      trigger_identity: triggerIdentity,
      selector: underscoreSelection,
      scope_endpoint_receipt: manualReceipt.scope_endpoint_receipt,
    }),
    /trusted explicit PR selection/u,
  );
  const plainManualReceipt = createV2GitLedgerEvaluatedScopeReceipt({
    relation: "manual-pull-request",
    repository: REPOSITORY,
    scope: manualReceipt.scope,
    trigger_identity: triggerIdentity,
    selector: manualReceipt.selector,
    scope_endpoint_receipt: manualReceipt.scope_endpoint_receipt,
  });
  const loaded = await ledger.load();
  const writesBeforePlain = fixture.writeCalls;
  await assert.rejects(
    ledger.acquireLease(leaseInput(loaded.tip_commit_sha), {
      evaluated_scope_receipt: plainManualReceipt,
    }),
    (error) => error.code === "untrusted-evaluated-scope-receipt",
  );
  assert.equal(fixture.writeCalls, writesBeforePlain);

  await assert.rejects(
    ledger.loadInitialRunnerStateAuthority({
      control_plane_authority: await ledger.loadControlPlaneAuthority(
        manualReceipt.scope,
      ),
      evaluated_scope_receipt: manualReceipt,
      workflow_command_handle: command,
    }),
    (error) => error.code === "full-discovery-receipt-required",
  );
  const discovery = await acquireFixtureLeasedDiscovery({
    ledger,
    command,
    preScopeReceipt: manualReceipt,
    minimalPre: minimalScopeHandle,
  });
  const lease = discovery.lease_receipt;
  const fullManualReceipt = discovery.effect_evaluated_scope_receipt;
  const manualControlPlaneAuthority = await ledger.loadControlPlaneAuthority(
    fullManualReceipt.scope,
  );
  const initialAuthority = await ledger.loadInitialRunnerStateAuthority({
    control_plane_authority: manualControlPlaneAuthority,
    evaluated_scope_receipt: fullManualReceipt,
    workflow_command_handle: command,
  });
  const beforeObservation = await ledger.load();
  const observationRecord = schedulerObservationRecord({
    predecessor: lease.acquire_commit_sha,
    lease,
    priorAuthorityDigest: priorRunnerAuthorityDigest(
      beforeObservation.records,
    ),
    trigger: "manual",
    effectId: "manual-scheduler-observation",
    idempotencyKey: "manual-scheduler-observation-key",
    initialAuthority,
  });
  const observation = await ledger.appendRecord(observationRecord, {
    evaluated_scope_receipt: fullManualReceipt,
    initial_runner_state_authority: initialAuthority,
  });
  assert.deepEqual(observationRecord.payload.action.scheduler_plan.actions, []);

  const generation = automaticGeneration(1);
  const reservation = requestReservation({
    generation,
    schedulerIntentId: "v2-request:" + "1".repeat(64),
  });
  const attemptedPublication = effectAttemptRecord({
    predecessor: observation.commit_sha,
    lease,
    generation,
    observationRecordOid: observation.commit_sha,
    reservationRecordOid: "2".repeat(40),
    reservation,
    schedulerActionKey: "manual-forbidden-post",
  });
  const writesBeforeAttempt = fixture.writeCalls;
  await assert.rejects(
    ledger.appendRecord(attemptedPublication, {
      evaluated_scope_receipt: fullManualReceipt,
    }),
    (error) => error.code === "manual-publication-forbidden",
  );
  assert.equal(fixture.writeCalls, writesBeforeAttempt);

  const commentPublication = createV2GitLedgerRecord({
    record_type: "effect-intent",
    predecessor_commit_sha: observation.commit_sha,
    pull_request: PR,
    head_ref_oid: HEAD,
    base_ref_oid: BASE,
    potential_merge_commit_oid: POTENTIAL,
    kind: "control-comment-create",
    effect_id: "manual-forbidden-comment",
    idempotency_key: "manual-forbidden-comment-key",
    server_observed_at: TIME,
    payload: effectPayload({
      phase: "intent",
      kind: "control-comment-create",
      predecessor: observation.commit_sha,
      action: {
        method: "POST",
        body_digest: `sha256:${"5".repeat(64)}`,
        pre_comment_inventory_digest: `sha256:${"6".repeat(64)}`,
      },
    }),
    control_comment_binding: null,
    lease: leaseBinding(lease),
  });
  await assert.rejects(
    ledger.appendRecord(commentPublication, {
      evaluated_scope_receipt: fullManualReceipt,
    }),
    (error) => error.code === "manual-publication-forbidden",
  );
  assert.equal(fixture.writeCalls, writesBeforeAttempt);

  const release = await ledger.releaseLease({
    predecessor_commit_sha: observation.commit_sha,
    lease_receipt: lease,
    released_at: TIME,
    control_comment_binding: null,
  }, {
    evaluated_scope_receipt: manualReceipt,
  });
  const final = await ledger.load();
  assert.equal(final.tip_commit_sha, release.commit_sha);
  assert.equal(final.active_lease, null);
  assert.equal(final.effect_intent_count, 1);
});

function scheduleCapabilityReceipt({
  allowedEventNames = ["schedule"],
} = {}) {
  const base = capabilityBase();
  base.workflow_provenance_policy.allowed_event_names =
    [...allowedEventNames].sort();
  base.workflow_provenance_policy.allowed_refs = ["refs/heads/main"];
  return sealCapability(base);
}

function candidateRepository() {
  return {
    owner: REPOSITORY.owner,
    name: REPOSITORY.name,
    id: REPOSITORY.id,
    node_id: REPOSITORY.node_id,
  };
}

function scheduleTriggerIdentity() {
  return {
    event_name: "schedule",
    ref: "refs/heads/main",
    sha: BASE,
  };
}

function scheduleRepositoryEndpointReceipt() {
  return {
    method: "GET",
    path: "/repos/owner/repo",
    status: 200,
    server_time: TIME,
    raw_body_sha256: `sha256:${"a".repeat(64)}`,
  };
}

function candidateDispatchTerminalResult({
  decision,
  schedulerAppend,
  leaseReleaseReceipt,
  preflight,
  continuityAuthority,
  controlPlaneReceipt,
  initialAuthority,
  establishedAuthority = null,
  runnerAuthority,
  statusIntent = null,
  statusResponse = null,
}) {
  const statusBound = statusIntent !== null && statusResponse !== null;
  return {
    schema: "codex-review-gate-production-assembly-v2",
    schema_version: 1,
    decision,
    report: { decision },
    due_at: null,
    wakeup_hints: "",
    status_plan: null,
    request_plan: null,
    comment_plan: null,
    writes_performed: statusBound,
    public_effects_performed: statusBound ? 1 : 0,
    effect_barrier: statusBound
      ? "STATUS_EFFECT_BOUND"
      : "NO_STATUS_EFFECT_REQUIRED",
    status_effect_outcome: statusBound ? "bound" : "not-required",
    status_ambiguity_code: null,
    status_intent_digest:
      statusIntent?.status_intent_handle.intent_digest ?? null,
    status_response_runner_state_digest:
      statusResponse?.runner_state_digest ?? null,
    reservation_status_effect_outcome: "not-required",
    reservation_status_ambiguity_code: null,
    automatic_reservation_digest: null,
    reservation_status_intent_digest: null,
    reservation_status_response_runner_state_digest: null,
    automatic_request_effect_outcome: "not-required",
    automatic_request_ambiguity_code: null,
    automatic_request_intent_digest: null,
    automatic_request_binding_runner_state_digest: null,
    authoritative_controlled_request: null,
    scheduler_append_receipt: structuredClone(schedulerAppend.append_receipt),
    lease_release_receipt: structuredClone(leaseReleaseReceipt),
    preflight_receipt_digest: preflight.receipt_digest,
    handoff_digest: digestCanonical(
      "candidate-dispatch-test-handoff",
      { runner_authority_digest: runnerAuthority.authority_digest },
    ),
    continuity_receipt_digest:
      continuityAuthority.continuity_receipt.continuity_receipt_digest,
    control_plane_receipt_digest: controlPlaneReceipt.receipt_digest,
    initial_runner_state_authority_digest:
      initialAuthority?.authority_digest ?? null,
    established_runner_state_authority_digest:
      establishedAuthority?.authority_digest ?? null,
    runner_authority_digest: runnerAuthority.authority_digest,
  };
}

function forgeCandidateDispatchAckPayload(payloadValue) {
  const payload = structuredClone(payloadValue);
  const ack = payload.candidate_ack;
  ack.terminal_authority.terminal_projection.public_effects_performed += 1;
  ack.terminal_authority.terminal_projection_digest = digestCanonical(
    "codex-review-gate-v2-candidate-dispatch-terminal-projection",
    ack.terminal_authority.terminal_projection,
  );
  const {
    authority_digest: _terminalDigest,
    ...terminalWithoutDigest
  } = ack.terminal_authority;
  ack.terminal_authority.authority_digest = digestCanonical(
    "codex-review-gate-v2-candidate-dispatch-terminal-authority",
    terminalWithoutDigest,
  );
  ack.result.controller_authority_digest =
    ack.terminal_authority.authority_digest;
  ack.result.controller_result_digest =
    ack.terminal_authority.terminal_projection_digest;
  ack.result.public_effects_performed =
    ack.terminal_authority.terminal_projection.public_effects_performed;
  const { result_digest: _resultDigest, ...resultWithoutDigest } = ack.result;
  ack.result.result_digest = digestCanonical(
    "codex-review-gate-v2-candidate-dispatch-result",
    resultWithoutDigest,
  );
  const { ack_digest: _ackDigest, ...ackWithoutDigest } = ack;
  ack.ack_digest = digestCanonical(
    "codex-review-gate-v2-candidate-dispatch-ack",
    ackWithoutDigest,
  );
  return payload;
}

function resealFixtureEnvelopePayload(envelope, payload) {
  envelope.payload = structuredClone(payload);
  envelope.payload_digest = digestV2GitLedgerPayload(envelope.payload);
  const provenance = envelope.workflow_provenance;
  const binding = structuredClone(provenance.operation_binding);
  const priorEvaluated = binding.evaluated_scope_receipt;
  binding.evaluated_scope_receipt =
    createV2GitLedgerCandidateDispatchEvaluatedScopeReceipt({
      repository: envelope.repository,
      payload: envelope.payload,
      trigger_identity: {
        event_name: priorEvaluated.trigger_event_name,
        ref: priorEvaluated.trigger_ref,
        sha: priorEvaluated.trigger_sha,
      },
      repository_endpoint_receipt:
        priorEvaluated.scope_endpoint_receipt,
    });
  binding.record_identity.payload_digest = envelope.payload_digest;
  const {
    request_digest: _requestDigest,
    audience: _audience,
    nonce: _nonce,
    ...requestFields
  } = binding;
  const nonceInput = {
    schema: V2_GIT_LEDGER_PROVENANCE_REQUEST_SCHEMA,
    schema_version: 1,
    ...requestFields,
  };
  binding.nonce = digestCanonical(
    "codex-review-gate-v2-git-ledger-provenance-nonce",
    nonceInput,
  );
  binding.audience = `${V2_GIT_LEDGER_OIDC_AUDIENCE}:` +
    binding.nonce.slice("sha256:".length);
  binding.request_digest = digestCanonical(
    "codex-review-gate-v2-git-ledger-provenance-request",
    {
      ...nonceInput,
      nonce: binding.nonce,
      audience: binding.audience,
    },
  );
  provenance.audience = binding.audience;
  provenance.claims.aud = binding.audience;
  provenance.operation_binding = binding;
  const { receipt_digest: _receiptDigest, ...provenanceWithoutDigest } =
    provenance;
  provenance.receipt_digest = digestCanonical(
    "codex-review-gate-v2-git-ledger-provenance",
    provenanceWithoutDigest,
  );
  const { envelope_digest: _envelopeDigest, ...envelopeWithoutDigest } =
    envelope;
  envelope.envelope_digest = digestCanonical(
    "codex-review-gate-v2-git-ledger-envelope",
    envelopeWithoutDigest,
  );
}

async function appendCompletedCandidateInventory({
  ledger,
  transportFixture,
  priorInventory = null,
}) {
  const transport = createV2GitHubCandidateInventory({
    fetch: transportFixture.fetch,
    token: SYNTHETIC_BEARER,
    repository: candidateRepository(),
    restBaseUrl: "https://github.example.test",
  });
  const initial = priorInventory === null
    ? await transport.scan()
    : await transport.scan({ prior_inventory: priorInventory });
  let loaded = await ledger.load();
  await appendCandidateInventoryPhase({
    ledger,
    loaded,
    phase: "cycle-start",
    initial,
  });
  const shards = [];
  for (let index = 0; index < initial.shards.length; index += 1) {
    loaded = await ledger.load();
    const shard = await transport.readShard({
      inventory: initial,
      shard_index: index,
    });
    shards.push(shard);
    await appendCandidateInventoryPhase({
      ledger,
      loaded,
      phase: "shard",
      initial,
      shard,
    });
  }
  loaded = await ledger.load();
  const finalInventory = await transport.scan({ prior_inventory: initial });
  const cycleReceipt = finalizeV2CandidateInventoryCycle({
    initial_inventory: initial,
    shard_receipts: shards,
    final_inventory: finalInventory,
  });
  await appendCandidateInventoryPhase({
    ledger,
    loaded,
    phase: "cycle-complete",
    initial,
    finalInventory,
    cycleReceipt,
  });
  return ledger.load();
}

async function createScheduledCandidateDispatchAttempt({
  leaseTtlSeconds = 900,
} = {}) {
  const fixture = githubGitFixture();
  const capability = scheduleCapabilityReceipt();
  const triggerIdentity = scheduleTriggerIdentity();
  const runIdentity = { ...OWNER };
  const verifier = provenanceVerifier({
    eventName: "schedule",
    ref: triggerIdentity.ref,
    shaValue: triggerIdentity.sha,
    runIdentity,
  });
  const preflight = await loadFixtureProviderPreflight();
  const ledger = makeLedger(fixture, capability, verifier, preflight);
  await ledger.bootstrapCapability();
  const candidateFixture = candidateTransportFixture(0, {
    exactScopeCandidateNumber: PR.number,
  });
  candidateFixture.setListedNumbers([PR.number]);
  await appendCompletedCandidateInventory({
    ledger,
    transportFixture: candidateFixture,
  });
  const scanCommand = await createScheduleWorkflowCommandHandle({
    runIdentity,
  });
  const reserved = await ledger.loadOrReserveCandidateDispatch({
    workflow_command_handle: scanCommand,
    trigger_identity: triggerIdentity,
    repository_endpoint_receipt: scheduleRepositoryEndpointReceipt(),
  });
  runIdentity.run_id = "9002";
  runIdentity.run_attempt = 1;
  const scheduledCommand = await createScheduleWorkflowCommandHandle({
    pullRequestNumber: PR.number,
    dispatchBinding: reserved.plan.items[0],
    runIdentity,
  });
  const minimal = await loadFixtureMinimalScope();
  const scheduled = await ledger.loadCandidateDispatchForScheduledPullRequest({
    workflow_command_handle: scheduledCommand,
    minimal_scope_handle: minimal,
    trigger_identity: triggerIdentity,
    expected_dispatch_binding: reserved.plan.items[0],
  });
  const preScopeReceipt = await ledger
    .loadScheduledPullRequestEvaluatedScopeReceipt({
      candidate_dispatch_handle: scheduled.candidate_dispatch_handle,
      minimal_scope_handle: minimal,
      trigger_identity: triggerIdentity,
    });
  const discovery = await acquireFixtureLeasedDiscovery({
    ledger,
    command: scheduledCommand,
    preScopeReceipt,
    minimalPre: minimal,
    leaseTtlSeconds,
  });
  return {
    fixture,
    ledger,
    triggerIdentity,
    runIdentity,
    capability,
    verifier,
    preflight,
    scanCommand,
    scheduledCommand,
    reserved,
    scheduled,
    preScopeReceipt,
    discovery,
  };
}

async function appendCandidateInventoryPhase({
  ledger,
  loaded,
  phase,
  initial,
  shard = null,
  finalInventory = null,
  cycleReceipt = null,
  authorityOverride = null,
}) {
  const authority = loaded.authority_projection.candidate_inventory;
  const payload = candidateInventoryPayload({
    phase,
    initial,
    shard,
    finalInventory,
    cycleReceipt,
    priorAuthorityDigest: authority.authority_digest,
    supersedes: phase === "cycle-start"
      ? authority.incomplete_cycle?.cycle_id ?? null
      : null,
  });
  return ledger.appendCandidateInventory({
    predecessor_commit_sha: loaded.tip_commit_sha,
    owner: OWNER,
    server_observed_at: TIME,
    payload,
    trigger_identity: {
      event_name: authorityOverride?.eventName ?? "schedule",
      ref: "refs/heads/main",
      sha: BASE,
    },
    repository_endpoint_receipt: {
      method: "GET",
      path: "/repos/owner/repo",
      status: 200,
      server_time: TIME,
      raw_body_sha256: `sha256:${"a".repeat(64)}`,
    },
  });
}

function candidateInventoryPayload({
  phase,
  initial,
  shard = null,
  finalInventory = null,
  cycleReceipt = null,
  priorAuthorityDigest,
  supersedes = null,
}) {
  return {
    schema: V2_GIT_LEDGER_CANDIDATE_INVENTORY_RECORD_SCHEMA,
    schema_version: 1,
    phase,
    cycle_id: `candidate-cycle:${initial.receipt_digest.slice("sha256:".length)}`,
    owner: OWNER,
    prior_candidate_authority_digest: priorAuthorityDigest,
    supersedes_incomplete_cycle_id: supersedes,
    initial_inventory_receipt_digest: initial.receipt_digest,
    initial_inventory: phase === "cycle-start" ? initial : null,
    shard_receipt: phase === "shard" ? shard : null,
    final_inventory: phase === "cycle-complete" ? finalInventory : null,
    cycle_receipt: phase === "cycle-complete" ? cycleReceipt : null,
  };
}

function candidateTransportFixture(
  initialCount,
  {
    exactScopeCandidateNumber = null,
    longNodeIds = false,
    longIds = false,
  } = {},
) {
  const identities = new Map();
  const ensureCandidate = (number) => {
    if (!identities.has(number)) {
      identities.set(number, {
        id: longIds
          ? `${"9".repeat(240)}${String(1000 + number)}`
          : String(1000 + number),
        node_id: number === exactScopeCandidateNumber
          ? PR.node_id
          : longNodeIds
            ? `PR_${String(number).padStart(4, "0")}_${"n".repeat(240)}`
            : `PR_candidate_${number}`,
        number,
        created_at: new Date(
          Date.parse("2026-08-01T00:00:00.000Z") + number * 1000,
        ).toISOString(),
      });
    }
    return identities.get(number);
  };
  let listedNumbers = Array.from(
    { length: initialCount },
    (_, index) => index + 1,
  );
  listedNumbers.forEach(ensureCandidate);
  return {
    setListedNumbers(value) {
      listedNumbers = [...value];
      listedNumbers.forEach(ensureCandidate);
    },
    async fetch(url, init) {
      assert.equal(init.method, "GET");
      const parsed = new URL(url);
      const listPath = "/repos/owner/repo/pulls";
      if (parsed.pathname === listPath && parsed.search !== "") {
        const page = Number(parsed.searchParams.get("page"));
        const offset = (page - 1) * 100;
        const selected = listedNumbers
          .map(ensureCandidate)
          .sort((left, right) =>
            Date.parse(left.created_at) - Date.parse(right.created_at) ||
            left.number - right.number)
          .slice(offset, offset + 100);
        const body = selected.map((candidate) => ({
          ...candidate,
          url: `https://github.example.test/repos/owner/repo/pulls/${candidate.number}`,
        }));
        const nextPage = offset + selected.length < listedNumbers.length
          ? page + 1
          : null;
        const link = nextPage === null
          ? null
          : `<https://github.example.test/repos/owner/repo/pulls?` +
            `state=all&sort=created&direction=asc&per_page=100&` +
            `page=${nextPage}>; rel="next"`;
        return candidateResponse(body, { link });
      }
      const match = parsed.pathname.match(/^\/repos\/owner\/repo\/pulls\/(\d+)$/u);
      if (match !== null) {
        const candidate = ensureCandidate(Number(match[1]));
        return candidateResponse({
          ...candidate,
          url: `https://github.example.test/repos/owner/repo/pulls/${candidate.number}`,
          state: "open",
          merged: false,
          merged_at: null,
          updated_at: "2026-08-13T11:59:00.000Z",
          draft: false,
          base: {
            ref: "main",
            sha: BASE,
            repo: {
              id: REPOSITORY.id,
              node_id: REPOSITORY.node_id,
              full_name: "owner/repo",
            },
          },
          head: {
            ref: `candidate-${candidate.number}`,
            sha: HEAD,
            repo: {
              id: REPOSITORY.id,
              node_id: REPOSITORY.node_id,
              full_name: "owner/repo",
            },
          },
        });
      }
      throw new Error(`unexpected candidate fixture request ${parsed}`);
    },
  };
}

function candidateResponse(value, { link = null } = {}) {
  const body = JSON.stringify(value);
  const headers = {
    Date: new Date(TIME).toUTCString(),
    "Content-Type": "application/json",
  };
  if (link !== null) headers.Link = link;
  return new Response(body, { status: 200, headers });
}

function makeLedger(
  fixture,
  capability = capabilityReceipt(),
  verifier = provenanceVerifier(),
  preflightHandle = null,
) {
  let production = createV2GitHubGitLedger({
    ...factoryInput(fixture, capability),
    preflightHandle,
    verifyWorkflowProvenance: verifier,
  });
  let defaultAuthorityReceipt = null;
  let defaultFullAuthorityReceipt = null;
  let minimalScopeHandle = null;
  const defaultAuthority = async () => {
    if (defaultAuthorityReceipt !== null) {
      return { evaluated_scope_receipt: defaultAuthorityReceipt };
    }
    minimalScopeHandle ??= await loadFixtureMinimalScope();
    const defaultEvent = capability.workflow_provenance_policy
      .allowed_event_names[0];
    const triggerIdentity = defaultEvent === "pull_request_target"
      ? {
          event_name: "pull_request_target",
          ref: "refs/heads/main",
          sha: BASE,
        }
      : {
          event_name: "pull_request",
          ref: "refs/pull/7/merge",
          sha: POTENTIAL,
        };
    defaultAuthorityReceipt = await production
      .createPullRequestEventEvaluatedScopeReceipt({
        minimal_scope_handle: minimalScopeHandle,
        trigger_identity: triggerIdentity,
      });
    return { evaluated_scope_receipt: defaultAuthorityReceipt };
  };
  const defaultEffectAuthority = async () => ({
    evaluated_scope_receipt:
      defaultFullAuthorityReceipt ??
      (await defaultAuthority()).evaluated_scope_receipt,
  });
  return {
    async bootstrapCapability() {
      const restricted = createV2GitHubGitLedgerBootstrap({
        fetch: fixture.fetch,
        token: SYNTHETIC_BEARER,
        repository: REPOSITORY,
        ledgerRef: V2_GIT_LEDGER_REF,
        restBaseUrl: "https://api.github.test",
        bootstrapCapabilityInput: bootstrapInputForCapability(capability),
        preflightHandle,
        verifyWorkflowProvenance: verifier,
      });
      const result = await restricted.bootstrapCapability();
      production = result.ledger;
      defaultAuthorityReceipt = null;
      defaultFullAuthorityReceipt = null;
      return result.bootstrap_receipt;
    },
    load: (...args) => production.load(...args),
    loadControlPlaneAuthority: (...args) =>
      production.loadControlPlaneAuthority(...args),
    loadControlPlaneReceipt: (...args) =>
      production.loadControlPlaneReceipt(...args),
    loadInitialRunnerStateAuthority: (...args) =>
      production.loadInitialRunnerStateAuthority(...args),
    loadEstablishedRunnerStateAuthority: (...args) =>
      production.loadEstablishedRunnerStateAuthority(...args),
    appendInitialSchedulerObservation: (...args) =>
      production.appendInitialSchedulerObservation(...args),
    appendEstablishedSchedulerObservation: (...args) =>
      production.appendEstablishedSchedulerObservation(...args),
    appendStatusWriteIntent: (...args) =>
      production.appendStatusWriteIntent(...args),
    appendStatusWriteResponse: (...args) =>
      production.appendStatusWriteResponse(...args),
    appendAutomaticRequestReservation: (...args) =>
      production.appendAutomaticRequestReservation(...args),
    appendReservationStatusWriteIntent: (...args) =>
      production.appendReservationStatusWriteIntent(...args),
    appendReservationStatusWriteResponse: (...args) =>
      production.appendReservationStatusWriteResponse(...args),
    appendAutomaticReviewRequestIntent: (...args) =>
      production.appendAutomaticReviewRequestIntent(...args),
    appendAutomaticReviewRequestBinding: (...args) =>
      production.appendAutomaticReviewRequestBinding(...args),
    append: async (record, authority = null) => production.append(
      record,
      authority ?? await defaultEffectAuthority(),
    ),
    appendRecord: async (record, authority = null) => production.appendRecord(
      record,
      authority ?? await defaultEffectAuthority(),
    ),
    appendEffectIntent: async (input, authority = null) => production.appendEffectIntent(
      input,
      authority ?? await defaultEffectAuthority(),
    ),
    appendEffectResponse: async (input, authority = null) => production.appendEffectResponse(
      input,
      authority ?? await defaultEffectAuthority(),
    ),
    appendCandidateInventory: (...args) =>
      production.appendCandidateInventory(...args),
    loadOrReserveCandidateDispatch: (...args) =>
      production.loadOrReserveCandidateDispatch(...args),
    loadCandidateDispatchForScheduledPullRequest: (...args) =>
      production.loadCandidateDispatchForScheduledPullRequest(...args),
    loadScheduledPullRequestEvaluatedScopeReceipt: (...args) =>
      production.loadScheduledPullRequestEvaluatedScopeReceipt(...args),
    createCandidateDispatchResultAuthority: (...args) =>
      production.createCandidateDispatchResultAuthority(...args),
    ackCandidateDispatch: (...args) =>
      production.ackCandidateDispatch(...args),
    recoverCandidateDispatchFailure: (...args) =>
      production.recoverCandidateDispatchFailure(...args),
    acquireLease: async (input, authority = null) => production.acquireLease(
      input,
      authority ?? await defaultAuthority(),
    ),
    releaseLease: async (input, authority = null) => production.releaseLease(
      input,
      authority ?? await defaultAuthority(),
    ),
    createPullRequestEventEvaluatedScopeReceipt: (...args) =>
      production.createPullRequestEventEvaluatedScopeReceipt(...args),
    createManualPullRequestEvaluatedScopeReceipt: (...args) =>
      production.createManualPullRequestEvaluatedScopeReceipt(...args),
    createProviderEventPreScopeEvaluatedScopeReceipt: (...args) =>
      production.createProviderEventPreScopeEvaluatedScopeReceipt(...args),
    async createFullDiscoveryEvaluatedScopeReceipt(...args) {
      const receipt = await production
        .createFullDiscoveryEvaluatedScopeReceipt(...args);
      defaultFullAuthorityReceipt = receipt;
      return receipt;
    },
    async createProviderEventFullDiscoveryEvaluatedScopeReceipt(...args) {
      const receipt = await production
        .createProviderEventFullDiscoveryEvaluatedScopeReceipt(...args);
      defaultFullAuthorityReceipt = receipt;
      return receipt;
    },
    defaultEvaluatedScopeReceipt: async () =>
      (await defaultAuthority()).evaluated_scope_receipt,
  };
}

async function createProtectedInitialRunnerContext(
  fixture,
  { runIdentity = OWNER } = {},
) {
  const preflight = await loadFixtureProviderPreflight();
  const capability = capabilityReceiptForTrigger(
    "pull_request_target",
    "refs/heads/main",
  );
  const verifier = provenanceVerifier({
    eventName: "pull_request_target",
    ref: "refs/heads/main",
    shaValue: BASE,
    runIdentity,
  });
  const ledger = makeLedger(fixture, capability, verifier, preflight);
  await ledger.bootstrapCapability();
  const minimalScopeHandle = await loadFixtureMinimalScope();
  const preScopeReceipt = await ledger
    .createPullRequestEventEvaluatedScopeReceipt({
      minimal_scope_handle: minimalScopeHandle,
      trigger_identity: {
        event_name: "pull_request_target",
        ref: "refs/heads/main",
        sha: BASE,
      },
    });
  const workflowCommandHandle =
    await createPullRequestTargetWorkflowCommandHandle({ runIdentity });
  const discovery = await acquireFixtureLeasedDiscovery({
    ledger,
    command: workflowCommandHandle,
    preScopeReceipt,
    minimalPre: minimalScopeHandle,
    leaseTtlSeconds: 900,
  });
  const lease = discovery.lease_receipt;
  const evaluatedScopeReceipt = discovery.effect_evaluated_scope_receipt;
  const controlPlaneAuthority = await ledger.loadControlPlaneAuthority(
    evaluatedScopeReceipt.scope,
  );
  const initialAuthority = await ledger.loadInitialRunnerStateAuthority({
    control_plane_authority: controlPlaneAuthority,
    evaluated_scope_receipt: evaluatedScopeReceipt,
    workflow_command_handle: workflowCommandHandle,
  });
  return {
    ledger,
    lease,
    evaluatedScopeReceipt,
    workflowCommandHandle,
    initialAuthority,
    capability,
    verifier,
    preflight,
    preScopeReceipt,
    controlPlaneAuthority,
    continuityAuthority: discovery.continuity_authority,
    discovery,
  };
}

async function acquireEstablishedRunnerContext({
  ledger,
  runIdentity,
  observationBoundary,
  transportStartSecond,
  minimalServerTime,
}) {
  const minimalScopeHandle = await loadFixtureMinimalScope();
  const preScopeReceipt = await ledger
    .createPullRequestEventEvaluatedScopeReceipt({
      minimal_scope_handle: minimalScopeHandle,
      trigger_identity: {
        event_name: "pull_request_target",
        ref: "refs/heads/main",
        sha: BASE,
      },
    });
  const workflowCommandHandle =
    await createPullRequestTargetWorkflowCommandHandle({
      runIdentity,
      observationBoundary,
    });
  const discovery = await acquireFixtureLeasedDiscovery({
    ledger,
    command: workflowCommandHandle,
    preScopeReceipt,
    minimalPre: minimalScopeHandle,
    transportStartSecond,
    minimalServerTime,
  });
  const evaluatedScopeReceipt = discovery.effect_evaluated_scope_receipt;
  const controlPlaneAuthority = await ledger.loadControlPlaneAuthority(
    evaluatedScopeReceipt.scope,
  );
  return {
    discovery,
    evaluatedScopeReceipt,
    preScopeReceipt,
    workflowCommandHandle,
    controlPlaneAuthority,
  };
}

async function acquireFixtureLeasedDiscovery({
  ledger,
  command,
  preScopeReceipt,
  minimalPre,
  artifactSelectors = [],
  transport: transportOverride = null,
  leaseTtlSeconds = 600,
  transportStartSecond = 600,
  minimalServerTime = "2026-08-13T12:20:00.000Z",
}) {
  const transportFixture = providerTransportFixture({
    startSecond: transportStartSecond,
  });
  const transport = transportOverride ??
    createProviderTransport(transportFixture.fetch);
  return acquireV2LeaseThenLoadDiscovery({
    command,
    fetch: (url, init) => minimalScopeFetchAt(minimalServerTime, url, init),
    token: SYNTHETIC_BEARER,
    rest_base_url: "https://api.github.test",
    graphql_url: "https://api.github.test/graphql",
    ledger,
    transport: artifactSelectors.length === 0
      ? transport
      : {
          loadSnapshot: (input) => transport.loadSnapshot({
            ...input,
            artifactSelectors,
          }),
        },
    lease_ttl_seconds: leaseTtlSeconds,
    evaluated_scope_receipt: preScopeReceipt,
    pre_scope: minimalPre,
  });
}

async function releaseFixtureDiscoveryLease(ledger, discovery) {
  const loaded = await ledger.load();
  return ledger.releaseLease({
    predecessor_commit_sha: loaded.tip_commit_sha,
    lease_receipt: discovery.lease_receipt,
    released_at: loaded.post_ref.server_time,
    control_comment_binding: loaded.control_comment_binding,
  }, {
    evaluated_scope_receipt: discovery.lease_evaluated_scope_receipt,
  });
}

function schedulerInputsForEstablishedAuthority(
  authority,
  { snapshotId, decision = "pending" } = {},
) {
  const observedAt = authority.source_authority.post_ref_receipt.server_time;
  const evaluation = {
    epoch_id: authority.scheduling.epoch.id,
    decision,
    complete: true,
    snapshot_id: snapshotId,
    snapshot_fingerprint: `sha256:${"6".repeat(64)}`,
    observed_at: observedAt,
    provider_activity_fingerprint: `sha256:${"7".repeat(64)}`,
    no_start_candidate: structuredClone(
      authority.scheduling.no_start_candidate,
    ),
    run_id: authority.scheduling.run_identity.run_id,
    run_attempt: authority.scheduling.run_identity.run_attempt,
  };
  return {
    scheduler_evaluation: evaluation,
    status_plan: {
      mode: authority.scheduling.status_target_mode,
      decision,
      writes: [],
      terminal_cutover: false,
      freshness_assurance: "point-in-time",
    },
  };
}

async function acquireDefaultDiscovery(
  ledger,
  { leaseTtlSeconds = 600 } = {},
) {
  const minimalPre = await loadFixtureMinimalScope();
  const preScopeReceipt = await ledger.defaultEvaluatedScopeReceipt();
  return acquireFixtureLeasedDiscovery({
    ledger,
    command: await createPullRequestTargetWorkflowCommandHandle(),
    preScopeReceipt,
    minimalPre,
    leaseTtlSeconds,
  });
}

function factoryInput(fixture, capability) {
  return {
    fetch: fixture.fetch,
    token: SYNTHETIC_BEARER,
    repository: REPOSITORY,
    ledgerRef: V2_GIT_LEDGER_REF,
    restBaseUrl: "https://api.github.test",
    capabilityReceipt: capability,
    verifyWorkflowProvenance: provenanceVerifier(),
  };
}

function capabilityReceipt() {
  return sealCapability(capabilityBase());
}

function capabilityReceiptForTrigger(eventName, ref) {
  const base = capabilityBase();
  base.workflow_provenance_policy.allowed_event_names = [eventName];
  base.workflow_provenance_policy.allowed_refs = [ref];
  return sealCapability(base);
}

function bootstrapInput() {
  return bootstrapInputForCapability(capabilityReceipt());
}

function bootstrapInputForCapability(capability) {
  return sealBootstrapInput(bootstrapInputBase(capability));
}

function bootstrapInputBase(capability = capabilityBase()) {
  return {
    schema: V2_GIT_LEDGER_BOOTSTRAP_INPUT_SCHEMA,
    schema_version: 1,
    sealed: false,
    bootstrap_eligible: true,
    current_attestation: false,
    repository: structuredClone(capability.repository),
    repository_endpoint_receipt:
      structuredClone(capability.repository_endpoint_receipt),
    ledger_ref: capability.ledger_ref,
    permissions: {
      contents_write_requested: true,
      metadata_read_observed: true,
      observed_only: true,
      observation_receipt_digest:
        capability.permissions.observation_receipt_digest,
    },
    protection: structuredClone(capability.protection),
    ruleset_receipt: structuredClone(capability.ruleset_receipt),
    protection_receipt: structuredClone(capability.protection_receipt),
    controller_release: structuredClone(capability.controller_release),
    workflow_provenance_policy:
      structuredClone(capability.workflow_provenance_policy),
    provider_identity_policy:
      structuredClone(capability.provider_identity_policy),
    observed_at: capability.observed_at,
  };
}

function sealBootstrapInput(base) {
  return {
    ...structuredClone(base),
    input_digest: digestCanonical(
      "codex-review-gate-v2-git-ledger-bootstrap-input",
      base,
    ),
  };
}

function capabilityBase() {
  return {
    schema: V2_GIT_LEDGER_CAPABILITY_SCHEMA,
    schema_version: 1,
    feature_enabled: true,
    bootstrap_candidate_digest: `sha256:${"b".repeat(64)}`,
    repository: REPOSITORY,
    repository_endpoint_receipt: {
      method: "GET",
      path: "/repos/owner/repo",
      status: 200,
      server_time: TIME,
      raw_body_sha256: `sha256:${"4".repeat(64)}`,
    },
    ledger_ref: V2_GIT_LEDGER_REF,
    permissions: {
      contents_write_observed: true,
      metadata_read_observed: true,
      observed_only: true,
      observation_receipt_digest: `sha256:${"3".repeat(64)}`,
    },
    protection: {
      deletion_blocked: true,
      non_fast_forward_blocked: true,
      force_pushes_blocked: true,
      live_ruleset_receipt_digest: `sha256:${"e".repeat(64)}`,
      accepted_records_restricted_by_oidc_source: true,
      source_workflow_pin: {
        repository: {
          owner: "Joey-Tools",
          name: "codex-review-gate-action",
          id: "4242",
        },
        workflow_path: ".github/workflows/codex-review-gate.yml",
        workflow_ref:
          "owner/repo/.github/workflows/controller.yml@refs/heads/main",
        workflow_sha: "2".repeat(40),
        job_workflow_ref:
          `Joey-Tools/codex-review-gate-action/.github/workflows/codex-review-gate.yml@${"2".repeat(40)}`,
        job_workflow_sha: "2".repeat(40),
        caller_workflow_file_receipt_digest: `sha256:${"a".repeat(64)}`,
        job_workflow_file_receipt_digest: `sha256:${"b".repeat(64)}`,
        release_receipt_digest: `sha256:${"c".repeat(64)}`,
      },
    },
    ruleset_receipt: {
      receipt_digest: `sha256:${"e".repeat(64)}`,
      configuration_digest: `sha256:${"f".repeat(64)}`,
      protection_digest: `sha256:${"e".repeat(64)}`,
      repository_id: REPOSITORY.id,
      ledger_ref: V2_GIT_LEDGER_REF,
      ruleset_ids: ["101"],
      target_includes_exact_ref: true,
      deletion_blocked: true,
      non_fast_forward_blocked: true,
      force_pushes_blocked: true,
      bypass_actors_empty: true,
    },
    protection_receipt: {
      receipt_digest: `sha256:${"0".repeat(64)}`,
      protection_digest: `sha256:${"e".repeat(64)}`,
      ruleset_receipt_digest: `sha256:${"e".repeat(64)}`,
      deletion_blocked: true,
      non_fast_forward_blocked: true,
      source_workflow_pinned: true,
    },
    controller_release: {
      repository: {
        owner: "Joey-Tools",
        name: "codex-review-gate-action",
        id: "4242",
      },
      release_sha: "2".repeat(40),
      workflow_path: ".github/workflows/codex-review-gate.yml",
      workflow_ref:
        "owner/repo/.github/workflows/controller.yml@refs/heads/main",
      workflow_sha: "2".repeat(40),
      job_workflow_ref:
        `Joey-Tools/codex-review-gate-action/.github/workflows/codex-review-gate.yml@${"2".repeat(40)}`,
      job_workflow_sha: "2".repeat(40),
      caller_workflow_file_receipt_digest: `sha256:${"a".repeat(64)}`,
      job_workflow_file_receipt_digest: `sha256:${"b".repeat(64)}`,
      release_receipt_digest: `sha256:${"c".repeat(64)}`,
      current: true,
    },
    workflow_provenance_policy: provenancePolicy(),
    provider_identity_policy: providerIdentityPolicy(),
    observed_at: TIME,
  };
}

function providerIdentityPolicy() {
  const withoutDigest = {
    schema: "codex-review-gate-provider-identity-policy-v2",
    schema_version: 1,
    catalog_version: 1,
    actor: CODEX_ACTOR,
    app: CODEX_APP,
    actor_endpoint_path:
      "/users/chatgpt-codex-connector%5Bbot%5D",
    app_endpoint_path: "/apps/chatgpt-codex-connector",
  };
  return {
    ...withoutDigest,
    catalog_digest: digestCanonical(
      "codex-review-gate-v2-provider-identity-policy",
      withoutDigest,
    ),
  };
}

function sealCapability(base) {
  return {
    ...structuredClone(base),
    receipt_digest: digestCanonical(
      "codex-review-gate-v2-git-ledger-capability",
      base,
    ),
  };
}

function provenancePolicy() {
  const subject = "repo:owner/repo:pull_request";
  return {
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
    subject_pattern_digest: digestCanonical(
      "codex-review-gate-v2-oidc-subject-pattern",
      subject,
    ),
    subject_policy_receipt_digest: `sha256:${"7".repeat(64)}`,
    execution_policy_receipt_digest: `sha256:${"8".repeat(64)}`,
    replay_registry_policy_receipt_digest: `sha256:${"9".repeat(64)}`,
    fork_pull_requests_api_only: true,
    candidate_code_execution_blocked: true,
    allowed_event_names: ["pull_request"],
    allowed_refs: ["refs/pull/7/merge"],
  };
}

function provenanceVerifier({
  fixedJti = null,
  omitJti = false,
  jtiPrefix = "oidc-jti",
  eventName = "pull_request",
  ref = "refs/pull/7/merge",
  shaValue = null,
  claimsSupported = V2_GIT_LEDGER_OIDC_CLAIMS,
  runIdentity = OWNER,
} = {}) {
  let ordinal = 0;
  const runIdentityByTokenOrdinal = new Map();
  return async (verifierRequest) => {
    const request = verifierRequest.provenance_request;
    let tokenOrdinal;
    let jti;
    let compactJwt;
    if (verifierRequest.mode === "mint-and-verify") {
      ordinal += 1;
      tokenOrdinal = ordinal;
      jti = omitJti ? null : fixedJti ?? `${jtiPrefix}-${tokenOrdinal}`;
      runIdentityByTokenOrdinal.set(tokenOrdinal, structuredClone(runIdentity));
      compactJwt = fixtureJwt({
        ordinal: tokenOrdinal,
        jti,
        request_digest: request.request_digest,
      });
    } else {
      compactJwt = verifierRequest.compact_jwt;
      const payload = JSON.parse(Buffer.from(
        compactJwt.split(".")[1],
        "base64url",
      ).toString("utf8"));
      tokenOrdinal = payload.ordinal;
      jti = payload.jti;
    }
    const tokenRunIdentity = runIdentityByTokenOrdinal.get(tokenOrdinal) ??
      runIdentity;
    const epoch = Math.floor(Date.parse(request.github_server_time) / 1000);
    const effectScope = request.effect_scope;
    const claims = {
      aud: request.audience,
      event_name: eventName,
      exp: epoch + 300,
      iat: epoch - 1,
      iss: "https://token.actions.githubusercontent.com",
      job_workflow_ref: request.source_workflow.job_workflow_ref,
      job_workflow_sha: request.source_workflow.job_workflow_sha,
      nbf: epoch - 1,
      ref,
      repository: `${REPOSITORY.owner}/${REPOSITORY.name}`,
      repository_id: REPOSITORY.id,
      repository_owner_id: "88",
      run_attempt: String(tokenRunIdentity.run_attempt),
      run_id: tokenRunIdentity.run_id,
      sha: shaValue ?? effectScope?.potential_merge_commit_oid ?? POTENTIAL,
      sub: "repo:owner/repo:pull_request",
      workflow_ref: request.source_workflow.workflow_ref,
      workflow_sha: request.source_workflow.workflow_sha,
    };
    if (jti !== null) claims.jti = jti;
    const operationBinding = {
      operation: request.operation,
      repository: request.repository,
      ledger_ref: request.ledger_ref,
      predecessor_commit_sha: request.predecessor_commit_sha,
      protection_receipt_digest: request.protection_receipt_digest,
      source_workflow: request.source_workflow,
      effect_scope: request.effect_scope,
      evaluated_scope_receipt: request.evaluated_scope_receipt,
      record_identity: request.record_identity,
      github_server_time: request.github_server_time,
      nonce: request.nonce,
      audience: request.audience,
      request_digest: request.request_digest,
    };
    const withoutDigest = {
      schema: V2_GIT_LEDGER_PROVENANCE_RECEIPT_SCHEMA,
      schema_version: 1,
      verified: true,
      signature_verified: true,
      jwks_verified: true,
      live_supported: true,
      issuer: "https://token.actions.githubusercontent.com",
      audience: request.audience,
      algorithm: "RS256",
      key_id: "fixture-key-1",
      claims,
      token_sha256: rawDigest(compactJwt),
      discovery: {
        url: "https://token.actions.githubusercontent.com/.well-known/openid-configuration",
        server_time: TIME,
        raw_body_sha256: `sha256:${"5".repeat(64)}`,
        claims_supported: [...claimsSupported].sort(),
      },
      jwks: {
        url: "https://token.actions.githubusercontent.com/.well-known/jwks",
        server_time: TIME,
        raw_body_sha256: `sha256:${"6".repeat(64)}`,
      },
      verified_at_server_time: request.github_server_time,
      replay_prevention_receipt_digest:
        `sha256:${(tokenOrdinal + 4096).toString(16).padStart(64, "0")}`,
      operation_binding: operationBinding,
    };
    const receipt = {
      ...withoutDigest,
      receipt_digest: digestCanonical(
        "codex-review-gate-v2-git-ledger-provenance",
        withoutDigest,
      ),
    };
    return {
      schema: V2_GIT_LEDGER_PROVENANCE_VERIFIER_RESULT_SCHEMA,
      schema_version: 1,
      mode: verifierRequest.mode,
      compact_jwt:
        verifierRequest.mode === "mint-and-verify" ? compactJwt : null,
      receipt,
    };
  };
}

function fixtureJwt(payload) {
  const header = Buffer.from(JSON.stringify({
    alg: "RS256",
    kid: "fixture-key-1",
    typ: "JWT",
  }), "utf8").toString("base64url");
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = Buffer.from(
    `fixture-signature-${payload.ordinal}`,
    "utf8",
  ).toString("base64url");
  return `${header}.${body}.${signature}`;
}

function leaseInput(predecessor) {
  return {
    predecessor_commit_sha: predecessor,
    pull_request: PR,
    head_ref_oid: HEAD,
    base_ref_oid: BASE,
    potential_merge_commit_oid: POTENTIAL,
    lease_id: "lease-run-9001-attempt-1",
    owner: OWNER,
    observed_at: TIME,
    lease_ttl_seconds: 600,
    control_comment_binding: null,
  };
}

function effectRecord({ predecessor, lease, effectId, idempotencyKey, at }) {
  return createV2GitLedgerEffectIntentRecord({
    predecessor_commit_sha: predecessor,
    scope: {
      pull_request: PR,
      head_ref_oid: HEAD,
      base_ref_oid: BASE,
      potential_merge_commit_oid: POTENTIAL,
    },
    kind: "thread-resolution-observation",
    effect_id: effectId,
    idempotency_key: idempotencyKey,
    server_observed_at: at,
    action: {
      thread_id: `thread-${effectId}`,
      head_oid: HEAD,
    },
    control_comment_binding: null,
    lease_receipt: lease,
  });
}

function automaticReservationRecord({ predecessor, lease, generation }) {
  throw new Error("automaticReservationRecord requires protected scheduler lineage");
}

function runnerEpochId() {
  return `v2-head:${runnerDigestCanonical("codex-review-gate-v2-head-epoch", {
    repository_node_id: REPOSITORY.node_id,
    pull_request_node_id: PR.node_id,
    head_ref_oid: HEAD,
  }).slice("sha256:".length)}`;
}

function emptyHeadLedger(observedAt = TIME) {
  return {
    schema: "codex-review-gate-head-ledger-v2",
    schema_version: 1,
    repository_node_id: REPOSITORY.node_id,
    pull_request_node_id: PR.node_id,
    head_ref_oid: HEAD,
    automatic_request_count: 0,
    exact_sha_context_count: 0,
    latest_status_idempotency_key: null,
    bound_attempt_ids: [],
    observed_at: observedAt,
  };
}

function initialScheduling({
  trigger = "schedule",
  statusTargetMode = "test-merge-with-head-sentinel",
  decision = "pending",
  runId = OWNER.run_id,
  runAttempt = OWNER.run_attempt,
} = {}) {
  const epochId = runnerEpochId();
  return {
    trigger,
    public_wait_supported: false,
    status_target_mode: statusTargetMode,
    run_identity: { run_id: runId, run_attempt: runAttempt },
    epoch: {
      id: epochId,
      started_at: TIME,
      controlled_request: null,
      automatic_request: {
        state: "available",
        intent_id: null,
        intent_persisted_at: null,
        effect_attempted_at: null,
      },
    },
    complete_snapshots: [],
    status: {
      exact_sha_context_count: 0,
      latest_idempotency_key: null,
      head_sentinel_receipt: null,
    },
    applied_action_keys: [],
    no_start_candidate: null,
    decision,
  };
}

function schedulerObservationRecord({
  predecessor,
  lease,
  priorAuthorityDigest,
  trigger = "schedule",
  effectId = "scheduler-observation-1",
  idempotencyKey = "scheduler-observation-key-1",
  initialAuthority = null,
  decision = "pending",
}) {
  const priorScheduling = initialAuthority === null
    ? initialScheduling({ trigger })
    : structuredClone(initialAuthority.scheduling);
  const snapshotTime = initialAuthority === null
    ? TIME
    : initialAuthority.source_authority.post_ref_receipt.server_time;
  const evaluation = {
    epoch_id: priorScheduling.epoch.id,
    decision: initialAuthority === null ? priorScheduling.decision : decision,
    complete: true,
    snapshot_id: "snapshot-1",
    snapshot_fingerprint: `sha256:${"8".repeat(64)}`,
    observed_at: snapshotTime,
    provider_activity_fingerprint: `sha256:${"9".repeat(64)}`,
    no_start_candidate: null,
    run_id: initialAuthority?.scheduling.run_identity.run_id ?? OWNER.run_id,
    run_attempt:
      initialAuthority?.scheduling.run_identity.run_attempt ?? OWNER.run_attempt,
  };
  delete priorScheduling.decision;
  const schedulerPlan = planV2Actions({
    schema: V2_SCHEDULER_SCHEMA,
    schema_version: V2_SCHEDULER_SCHEMA_VERSION,
    trigger: priorScheduling.trigger,
    now: snapshotTime,
    public_wait_supported: priorScheduling.public_wait_supported,
    status_target_mode: priorScheduling.status_target_mode,
    epoch: priorScheduling.epoch,
    evaluation,
    complete_snapshots: priorScheduling.complete_snapshots,
    status: {
      exact_sha_context_count: 0,
      latest_idempotency_key: null,
    },
    applied_action_keys: [],
  });
  const statusPlan = {
    mode: priorScheduling.status_target_mode,
    decision: evaluation.decision,
    writes: trigger === "manual" ? [] : [{
      role: "head-sentinel",
      sha: HEAD,
      context: "codex/github-review-gate",
      state: "pending",
      reason: "awaiting-terminal-test-merge-decision",
      idempotency_key: "status:fixture-head-pending",
    }],
    terminal_cutover: false,
    freshness_assurance: "point-in-time",
  };
  const action = {
    schema: "codex-review-gate-git-ledger-scheduler-observation-v2",
    schema_version: 1,
    prior_authority_digest: initialAuthority === null
      ? priorAuthorityDigest
      : initialAuthority.prior_authority_digest,
    prior_scheduling: priorScheduling,
    prior_head_ledger: initialAuthority === null
      ? emptyHeadLedger()
      : structuredClone(initialAuthority.head_ledger),
    scheduler_evaluation: evaluation,
    scheduler_plan: schedulerPlan,
    scheduler_plan_digest: digestCanonical(
      "codex-review-gate-v2-scheduler-plan",
      schedulerPlan,
    ),
    status_plan: statusPlan,
    status_plan_digest: digestCanonical(
      "codex-review-gate-v2-status-plan",
      statusPlan,
    ),
    snapshot_server_time: snapshotTime,
    initial_runner_state_authority: initialAuthority === null
      ? null
      : structuredClone(initialAuthority),
  };
  return createV2GitLedgerRecord({
    record_type: "effect-intent",
    predecessor_commit_sha: predecessor,
    pull_request: PR,
    head_ref_oid: HEAD,
    base_ref_oid: BASE,
    potential_merge_commit_oid: POTENTIAL,
    kind: "scheduler-observation",
    effect_id: effectId,
    idempotency_key: idempotencyKey,
    server_observed_at: snapshotTime,
    payload: effectPayload({
      phase: "intent",
      kind: "scheduler-observation",
      predecessor,
      action,
    }),
    control_comment_binding: null,
    lease: leaseBinding(lease),
  });
}

function requestReservation({
  generation,
  schedulerIntentId,
  createdAt = TIME,
  headLedger = emptyHeadLedger(createdAt),
}) {
  const statusLedgerBinding = {
    head_ref_oid: HEAD,
    automatic_request_count: headLedger.automatic_request_count,
    exact_sha_context_count: headLedger.exact_sha_context_count,
    latest_status_idempotency_key: headLedger.latest_status_idempotency_key,
    bound_attempt_ids: structuredClone(headLedger.bound_attempt_ids),
    observed_at: headLedger.observed_at,
    ledger_digest: runnerDigestCanonical(
      "codex-review-gate-v2-head-ledger",
      headLedger,
    ),
  };
  const preScopeDigest = digestCanonical("codex-review-gate-v2-scope", {
    repository_node_id: REPOSITORY.node_id,
    pull_request_node_id: PR.node_id,
    head_ref_oid: HEAD,
    base_ref_oid: BASE,
    potential_merge_commit_oid: POTENTIAL,
  });
  const intentDigest = runnerDigestCanonical("codex-review-gate-v2-request-intent", {
    repository_node_id: REPOSITORY.node_id,
    pull_request_node_id: PR.node_id,
    head_ref_oid: HEAD,
    ordinal: generation.index,
    generation_id: generation.generation_id,
    scheduler_intent_id: schedulerIntentId,
    body: "@codex review",
    created_at: createdAt,
    pre_scope_digest: preScopeDigest,
    ledger_digest: statusLedgerBinding.ledger_digest,
    recovery_authority: null,
  });
  const intentId = `v2-request:${intentDigest.slice("sha256:".length)}`;
  const withoutDigest = {
    schema: "codex-review-gate-request-reservation-v2",
    schema_version: 1,
    repository: {
      owner: REPOSITORY.owner,
      name: REPOSITORY.name,
      node_id: REPOSITORY.node_id,
    },
    pull_request: PR,
    epoch_head_sha: HEAD,
    ordinal: generation.index,
    generation_id: generation.generation_id,
    generation_kind: generation.kind,
    generation_index: generation.index,
    recovery_authority: null,
    scheduler_intent_id: schedulerIntentId,
    intent_id: intentId,
    intent_digest: intentDigest,
    attempt_id: `v2-attempt:${runnerDigestCanonical(
      "codex-review-gate-v2-request-attempt-id",
      { intent_id: intentId, intent_digest: intentDigest },
    ).slice("sha256:".length)}`,
    body: "@codex review",
    created_at: createdAt,
    automatic: true,
    consumed: true,
    pre_scope_digest: preScopeDigest,
    status_ledger_binding: statusLedgerBinding,
  };
  return {
    ...withoutDigest,
    reservation_digest: runnerDigestCanonical(
      "codex-review-gate-v2-request-reservation",
      withoutDigest,
    ),
  };
}

function protectedAutomaticReservationRecord({
  predecessor,
  lease,
  generation,
  observationRecordOid,
  observation,
  headLedger = emptyHeadLedger(
    observation.payload.action.snapshot_server_time,
  ),
}) {
  const persist = observation.payload.action.scheduler_plan.actions.find((action) =>
    action.kind === "persist_auto_request_intent");
  const post = observation.payload.action.scheduler_plan.actions.find((action) =>
    action.kind === "post_review_request");
  const reservation = requestReservation({
    generation,
    schedulerIntentId: persist.intent_id,
    createdAt: headLedger.observed_at,
    headLedger,
  });
  return createV2GitLedgerRecord({
    record_type: "effect-intent",
    predecessor_commit_sha: predecessor,
    pull_request: PR,
    head_ref_oid: HEAD,
    base_ref_oid: BASE,
    potential_merge_commit_oid: POTENTIAL,
    kind: "automatic-request-reservation",
    effect_id: `reservation-${generation.generation_id}`,
    idempotency_key: `reservation-key-${generation.generation_id}`,
    server_observed_at: headLedger.observed_at,
    payload: effectPayload({
      phase: "intent",
      kind: "automatic-request-reservation",
      predecessor,
      generation,
      action: {
        scheduler_observation_record_oid: observationRecordOid,
        scheduler_action_key: persist.idempotency_key,
        post_scheduler_action_key: post.idempotency_key,
        reservation,
        reservation_digest: reservation.reservation_digest,
        budget_limit: 3,
      },
    }),
    control_comment_binding: null,
    lease: leaseBinding(lease),
  });
}

function priorRunnerAuthorityDigest(records) {
  return digestCanonical("codex-review-gate-v2-runner-prior-authority", {
    scope: {
      pull_request: PR,
      head_ref_oid: HEAD,
      base_ref_oid: BASE,
      potential_merge_commit_oid: POTENTIAL,
    },
    records: records.map((entry) => ({
      record_oid: entry.commit_sha,
      parent_oids: entry.parents,
      tree_oid: entry.tree_sha,
      blob_oid: entry.blob_sha,
      envelope_digest: entry.envelope.envelope_digest,
    })),
  });
}

function reservationStatusIntentRecord({
  predecessor,
  lease,
  generation,
  reservationRecordOid,
  reservationDigest,
}) {
  return createV2GitLedgerRecord({
    record_type: "effect-intent",
    predecessor_commit_sha: predecessor,
    pull_request: PR,
    head_ref_oid: HEAD,
    base_ref_oid: BASE,
    potential_merge_commit_oid: POTENTIAL,
    kind: "reservation-status-write",
    effect_id: `reservation-status-${generation.generation_id}`,
    idempotency_key: `reservation-status-key-${generation.generation_id}`,
    server_observed_at: TIME,
    payload: effectPayload({
      phase: "intent",
      kind: "reservation-status-write",
      predecessor,
      generation,
      action: {
        reservation_record_oid: reservationRecordOid,
        generation_id: generation.generation_id,
        ordinal: generation.index,
        target_sha: HEAD,
        context: `codex/github-review-gate-reservation/${generation.index}`,
        state: "pending",
        description_digest: reservationDigest,
      },
    }),
    control_comment_binding: null,
    lease: leaseBinding(lease),
  });
}

function reservationStatusResponseRecord(intentRecord, intentCommitSha) {
  const action = intentRecord.payload.action;
  const pageBodyDigest = `sha256:${"b".repeat(64)}`;
  return createV2GitLedgerEffectResponseRecord({
    intent_record: intentRecord,
    intent_commit_sha: intentCommitSha,
    server_observed_at: TIME,
    receipt: {
      http_status: 201,
      status_id: "801",
      target_sha: HEAD,
      context: action.context,
      state: "pending",
      description_digest: action.description_digest,
      created_at: TIME,
      updated_at: TIME,
      creator: { login: "github-actions[bot]", type: "Bot" },
      post_server_time: TIME,
      post_raw_body_sha256: `sha256:${"a".repeat(64)}`,
      refetch_server_time: TIME,
      refetch_page_count: 1,
      refetch_item_count: 1,
      refetch_match_count: 1,
      refetch_inventory_digest: digestCanonical(
        "codex-review-gate-v2-reservation-status-refetch-inventory",
        {
          target_sha: HEAD,
          status_id: "801",
          context: action.context,
          pages: [{
            page: 1,
            raw_body_sha256: pageBodyDigest,
            item_count: 1,
          }],
        },
      ),
      refetch_pages: [{
        page: 1,
        http_status: 200,
        server_time: TIME,
        raw_body_sha256: pageBodyDigest,
        item_count: 1,
      }],
    },
  });
}

function reservationStatusWriteResponseReceipt(transport, boundary) {
  const pageBodyDigest = `sha256:${"b".repeat(64)}`;
  return {
    http_status: 201,
    status_id: "801",
    target_sha: transport.target_sha,
    context: transport.context,
    state: transport.state,
    description_digest: transport.description_digest,
    created_at: boundary,
    updated_at: boundary,
    creator: { login: "github-actions[bot]", type: "Bot" },
    post_server_time: boundary,
    post_raw_body_sha256: `sha256:${"a".repeat(64)}`,
    refetch_server_time: boundary,
    refetch_page_count: 1,
    refetch_item_count: 1,
    refetch_match_count: 1,
    refetch_inventory_digest: digestCanonical(
      "codex-review-gate-v2-reservation-status-refetch-inventory",
      {
        target_sha: transport.target_sha,
        status_id: "801",
        context: transport.context,
        pages: [{
          page: 1,
          raw_body_sha256: pageBodyDigest,
          item_count: 1,
        }],
      },
    ),
    refetch_pages: [{
      page: 1,
      http_status: 200,
      server_time: boundary,
      raw_body_sha256: pageBodyDigest,
      item_count: 1,
    }],
  };
}

function statusWriteResponseReceipt(transport, boundary) {
  const pageBodyDigest = `sha256:${"b".repeat(64)}`;
  return {
    http_status: 201,
    status_id: "801",
    target_sha: transport.target_sha,
    role: transport.role,
    context: transport.context,
    state: transport.state,
    description_digest: transport.description_digest,
    created_at: boundary,
    updated_at: boundary,
    creator: { login: "github-actions[bot]", type: "Bot" },
    post_server_time: boundary,
    post_raw_body_sha256: `sha256:${"a".repeat(64)}`,
    refetch_server_time: boundary,
    refetch_page_count: 1,
    refetch_item_count: 1,
    refetch_match_count: 1,
    refetch_inventory_digest: digestCanonical(
      "codex-review-gate-v2-status-refetch-inventory",
      {
        target_sha: transport.target_sha,
        status_id: "801",
        pages: [{
          page: 1,
          raw_body_sha256: pageBodyDigest,
          item_count: 1,
        }],
      },
    ),
    refetch_pages: [{
      page: 1,
      http_status: 200,
      server_time: boundary,
      raw_body_sha256: pageBodyDigest,
      item_count: 1,
    }],
  };
}

async function appendRequiredStatusForScheduler(ledger, schedulerAppend) {
  const intent = await ledger.appendStatusWriteIntent({
    scheduler_append: schedulerAppend,
    status_write_index: 0,
  });
  return ledger.appendStatusWriteResponse({
    status_intent_handle: intent.status_intent_handle,
    intent_append_receipt: intent.intent_append_receipt,
    receipt: statusWriteResponseReceipt(
      intent.transport,
      intent.intent_append_receipt.ref_reread.server_time,
    ),
  });
}

async function appendAutomaticReservationStatus(ledger, schedulerAppend) {
  await appendRequiredStatusForScheduler(ledger, schedulerAppend);
  const automatic = await ledger.appendAutomaticRequestReservation({
    scheduler_append: schedulerAppend,
  });
  const intent = await ledger.appendReservationStatusWriteIntent({
    automatic_reservation_handle: automatic.automatic_reservation_handle,
    reservation_append_receipt: automatic.reservation_append_receipt,
  });
  const response = await ledger.appendReservationStatusWriteResponse({
    reservation_status_intent_handle:
      intent.reservation_status_intent_handle,
    intent_append_receipt: intent.intent_append_receipt,
    receipt: reservationStatusWriteResponseReceipt(
      intent.transport,
      intent.intent_append_receipt.ref_reread.server_time,
    ),
  });
  return { automatic, intent, response };
}

function effectAttemptRecord({
  predecessor,
  lease,
  generation,
  observationRecordOid,
  reservationRecordOid,
  reservation,
  schedulerActionKey,
}) {
  const withoutDigest = {
    schema: "codex-review-gate-request-attempt-v2",
    schema_version: 1,
    attempt_id: reservation.attempt_id,
    reservation_digest: reservation.reservation_digest,
    scheduler_intent_id: reservation.scheduler_intent_id,
    recorded_at: TIME,
    recorded_before_effect: true,
    retry_limit: 0,
  };
  const attempt = {
    ...withoutDigest,
    attempt_digest: runnerDigestCanonical(
      "codex-review-gate-v2-request-attempt",
      withoutDigest,
    ),
  };
  return createV2GitLedgerRecord({
    record_type: "effect-intent",
    predecessor_commit_sha: predecessor,
    pull_request: PR,
    head_ref_oid: HEAD,
    base_ref_oid: BASE,
    potential_merge_commit_oid: POTENTIAL,
    kind: "effect-attempt",
    effect_id: `effect-attempt-${generation.generation_id}`,
    idempotency_key: `effect-attempt-key-${generation.generation_id}`,
    server_observed_at: TIME,
    payload: effectPayload({
      phase: "intent",
      kind: "effect-attempt",
      predecessor,
      generation,
      action: {
        scheduler_observation_record_oid: observationRecordOid,
        reservation_record_oid: reservationRecordOid,
        scheduler_action_key: schedulerActionKey,
        attempt,
      },
    }),
    control_comment_binding: null,
    lease: leaseBinding(lease),
  });
}

async function appendGenericRequiredStatus(
  ledger,
  lease,
  observationRecord,
  observationReceipt,
) {
  const observation = observationRecord.payload.action;
  const planned = observation.status_plan.writes[0];
  const publish = observation.scheduler_plan.actions.find((action) =>
    action.kind === "publish_status");
  assert.equal(observation.status_plan.writes.length, 1);
  assert.ok(publish);
  const description = planned.reason;
  const descriptionDigest = digestCanonical(
    "codex-review-gate-v2-status-description",
    { description },
  );
  const intentRecord = createV2GitLedgerEffectIntentRecord({
    predecessor_commit_sha: observationReceipt.commit_sha,
    scope: {
      pull_request: PR,
      head_ref_oid: HEAD,
      base_ref_oid: BASE,
      potential_merge_commit_oid: POTENTIAL,
    },
    kind: "status-write",
    effect_id: `fixture-status:${observationReceipt.commit_sha}`,
    idempotency_key: planned.idempotency_key,
    server_observed_at: observation.snapshot_server_time,
    action: {
      mode: observation.status_plan.mode,
      target_sha: planned.sha,
      role: planned.role,
      context: planned.context,
      state: planned.state,
      description_digest: descriptionDigest,
      scheduler_observation_record_oid: observationReceipt.commit_sha,
      scheduler_action_key: publish.idempotency_key,
      scheduler_plan_digest: observation.scheduler_plan_digest,
      status_plan_digest: observation.status_plan_digest,
      status_write_index: 0,
      status_write_count: 1,
    },
    control_comment_binding: null,
    lease_receipt: lease,
  });
  const intentReceipt = await ledger.appendRecord(intentRecord);
  const responseReceipt = statusWriteResponseReceipt({
    target_sha: planned.sha,
    role: planned.role,
    context: planned.context,
    state: planned.state,
    description_digest: descriptionDigest,
  }, intentReceipt.ref_reread.server_time);
  const responseRecord = createV2GitLedgerEffectResponseRecord({
    intent_record: intentRecord,
    intent_commit_sha: intentReceipt.commit_sha,
    server_observed_at: responseReceipt.refetch_server_time,
    receipt: responseReceipt,
  });
  return ledger.appendRecord(responseRecord);
}

async function appendProtectedRequestPrefix(
  ledger,
  lease,
  { initialAuthority, evaluatedScopeReceipt },
) {
  const generation = automaticGeneration(1);
  const beforeObservation = await ledger.load();
  const observationRecord = schedulerObservationRecord({
    predecessor: lease.acquire_commit_sha,
    lease,
    priorAuthorityDigest: priorRunnerAuthorityDigest(beforeObservation.records),
    initialAuthority,
  });
  const observationReceipt = await ledger.appendRecord(observationRecord, {
    evaluated_scope_receipt: evaluatedScopeReceipt,
    initial_runner_state_authority: initialAuthority,
  });
  const requiredStatus = await appendGenericRequiredStatus(
    ledger,
    lease,
    observationRecord,
    observationReceipt,
  );
  const statusControl = await ledger.loadControlPlaneAuthority(
    initialAuthority.scope,
  );
  const reservationRecord = protectedAutomaticReservationRecord({
    predecessor: requiredStatus.commit_sha,
    lease,
    generation,
    observationRecordOid: observationReceipt.commit_sha,
    observation: observationRecord,
    headLedger: statusControl.scoped_authority.runner_state.head_ledger,
  });
  const reservationReceipt = await ledger.appendRecord(reservationRecord);
  const reservationStatusIntent = reservationStatusIntentRecord({
    predecessor: reservationReceipt.commit_sha,
    lease,
    generation,
    reservationRecordOid: reservationReceipt.commit_sha,
    reservationDigest: reservationRecord.payload.action.reservation_digest,
  });
  const reservationStatusIntentReceipt = await ledger.appendRecord(
    reservationStatusIntent,
  );
  const reservationStatusResponse = reservationStatusResponseRecord(
    reservationStatusIntent,
    reservationStatusIntentReceipt.commit_sha,
  );
  const reservationStatusResponseReceipt = await ledger.appendRecord(
    reservationStatusResponse,
  );
  const postAction = observationRecord.payload.action.scheduler_plan.actions
    .find((action) => action.kind === "post_review_request");
  const attemptRecord = effectAttemptRecord({
    predecessor: reservationStatusResponseReceipt.commit_sha,
    lease,
    generation,
    observationRecordOid: observationReceipt.commit_sha,
    reservationRecordOid: reservationReceipt.commit_sha,
    reservation: reservationRecord.payload.action.reservation,
    schedulerActionKey: postAction.idempotency_key,
  });
  const attemptReceipt = await ledger.appendRecord(attemptRecord);
  return {
    generation,
    observationRecord,
    observationReceipt,
    reservationRecord,
    reservationReceipt,
    reservationStatusIntent,
    reservationStatusIntentReceipt,
    reservationStatusResponse,
    reservationStatusResponseReceipt,
    attemptRecord,
    attemptReceipt,
    schedulerActionKey: postAction.idempotency_key,
  };
}

async function appendControlledRequestAfterObservation(
  ledger,
  lease,
  { observationRecord, observationReceipt },
) {
  const generation = automaticGeneration(1);
  const requiredStatus = await appendGenericRequiredStatus(
    ledger,
    lease,
    observationRecord,
    observationReceipt,
  );
  const statusControl = await ledger.loadControlPlaneAuthority({
    pull_request: PR,
    head_ref_oid: HEAD,
    base_ref_oid: BASE,
    potential_merge_commit_oid: POTENTIAL,
  });
  const reservationRecord = protectedAutomaticReservationRecord({
    predecessor: requiredStatus.commit_sha,
    lease,
    generation,
    observationRecordOid: observationReceipt.commit_sha,
    observation: observationRecord,
    headLedger: statusControl.scoped_authority.runner_state.head_ledger,
  });
  const reservationReceipt = await ledger.appendRecord(reservationRecord);
  const reservationStatusIntent = reservationStatusIntentRecord({
    predecessor: reservationReceipt.commit_sha,
    lease,
    generation,
    reservationRecordOid: reservationReceipt.commit_sha,
    reservationDigest: reservationRecord.payload.action.reservation_digest,
  });
  const reservationStatusIntentReceipt = await ledger.appendRecord(
    reservationStatusIntent,
  );
  const reservationStatusResponse = reservationStatusResponseRecord(
    reservationStatusIntent,
    reservationStatusIntentReceipt.commit_sha,
  );
  const reservationStatusResponseReceipt = await ledger.appendRecord(
    reservationStatusResponse,
  );
  const postAction = observationRecord.payload.action.scheduler_plan.actions
    .find((action) => action.kind === "post_review_request");
  const attemptRecord = effectAttemptRecord({
    predecessor: reservationStatusResponseReceipt.commit_sha,
    lease,
    generation,
    observationRecordOid: observationReceipt.commit_sha,
    reservationRecordOid: reservationReceipt.commit_sha,
    reservation: reservationRecord.payload.action.reservation,
    schedulerActionKey: postAction.idempotency_key,
  });
  const attemptReceipt = await ledger.appendRecord(attemptRecord);
  const requestIntentRecord = reviewRequestRecord({
    predecessor: attemptReceipt.commit_sha,
    lease,
    effectId: "established-review-request",
    idempotencyKey: "established-review-request-key",
    at: observationRecord.payload.action.snapshot_server_time,
    generation,
    schedulerObservationRecordOid: observationReceipt.commit_sha,
    reservationRecordOid: reservationReceipt.commit_sha,
    attemptRecordOid: attemptReceipt.commit_sha,
    schedulerActionKey: postAction.idempotency_key,
  });
  const requestIntent = await ledger.appendRecord(requestIntentRecord);
  const requestResponseReceipt =
    await automaticReviewRequestBindingReceipt({
      action: requestIntentRecord.payload.action,
      observedAt: requestIntent.ref_reread.server_time,
    });
  const requestResponseRecord = createV2GitLedgerRecord({
    ...recordPlan(requestIntentRecord),
    record_type: "effect-response",
    predecessor_commit_sha: requestIntent.commit_sha,
    server_observed_at:
      requestResponseReceipt.request_scope_receipt.post_scope.observed_at,
    payload: effectPayload({
      phase: "response",
      kind: "review-request",
      predecessor: requestIntent.commit_sha,
      generation,
      intentCommitSha: requestIntent.commit_sha,
      action: requestIntentRecord.payload.action,
      receipt: requestResponseReceipt,
    }),
  });
  const requestResponse = await ledger.appendRecord(requestResponseRecord);
  const bindingIntentRecord = createV2GitLedgerRecord({
    ...recordPlan(requestIntentRecord),
    predecessor_commit_sha: requestResponse.commit_sha,
    kind: "request-binding",
    effect_id: "established-request-binding",
    idempotency_key: "established-request-binding-key",
    payload: effectPayload({
      phase: "intent",
      kind: "request-binding",
      predecessor: requestResponse.commit_sha,
      generation,
      action: {
        generation_id: generation.generation_id,
        request_id: "71",
        reservation_record_oid: reservationReceipt.commit_sha,
        attempt_record_oid: attemptReceipt.commit_sha,
      },
    }),
  });
  const bindingIntent = await ledger.appendRecord(bindingIntentRecord);
  const boundAt = requestResponseReceipt.created_at;
  const bindingResponseRecord = createV2GitLedgerRecord({
    ...recordPlan(bindingIntentRecord),
    record_type: "effect-response",
    predecessor_commit_sha: bindingIntent.commit_sha,
    server_observed_at: boundAt,
    payload: effectPayload({
      phase: "response",
      kind: "request-binding",
      predecessor: bindingIntent.commit_sha,
      generation,
      intentCommitSha: bindingIntent.commit_sha,
      action: bindingIntentRecord.payload.action,
      receipt: {
        request_id: "71",
        request_node_id: "IC_71",
        request_url:
          "https://github.com/owner/repo/pull/7#issuecomment-71",
        body_sha256: requestResponseReceipt.body_sha256,
        created_at: boundAt,
        updated_at: boundAt,
        raw_body_sha256: requestResponseReceipt.refetch_raw_body_sha256,
        actor: ACTOR,
        controlled: true,
      },
    }),
  });
  const bindingResponse = await ledger.appendRecord(bindingResponseRecord);
  return { boundAt, bindingResponse };
}

function reviewRequestRecord({
  predecessor,
  lease,
  effectId,
  idempotencyKey,
  at,
  generation = automaticGeneration(1),
  schedulerObservationRecordOid,
  reservationRecordOid,
  attemptRecordOid,
  schedulerActionKey,
}) {
  return createV2GitLedgerRecord({
    record_type: "effect-intent",
    predecessor_commit_sha: predecessor,
    pull_request: PR,
    head_ref_oid: HEAD,
    base_ref_oid: BASE,
    potential_merge_commit_oid: POTENTIAL,
    kind: "review-request",
    effect_id: effectId,
    idempotency_key: idempotencyKey,
    server_observed_at: at,
    payload: effectPayload({
      phase: "intent",
      kind: "review-request",
      predecessor,
      generation,
      action: {
        method: "POST",
        request_body_sha256: rawDigest("@codex review"),
        scheduler_observation_record_oid: schedulerObservationRecordOid,
        reservation_record_oid: reservationRecordOid,
        attempt_record_oid: attemptRecordOid,
        scheduler_action_key: schedulerActionKey,
      },
    }),
    control_comment_binding: null,
    lease: leaseBinding(lease),
  });
}

function artifactBindingIntent({
  predecessor,
  lease,
  generation,
  requestBindingRecordOid,
}) {
  return createV2GitLedgerRecord({
    record_type: "effect-intent",
    predecessor_commit_sha: predecessor,
    pull_request: PR,
    head_ref_oid: HEAD,
    base_ref_oid: BASE,
    potential_merge_commit_oid: POTENTIAL,
    kind: "artifact-binding",
    effect_id: `artifact-binding-${requestBindingRecordOid.slice(0, 12)}`,
    idempotency_key: `artifact-binding-key-${requestBindingRecordOid.slice(0, 12)}`,
    server_observed_at: TIME,
    payload: effectPayload({
      phase: "intent",
      kind: "artifact-binding",
      predecessor,
      generation,
      action: {
        generation_id: generation.generation_id,
        request_binding_record_oid: requestBindingRecordOid,
        request_id: "71",
        request_node_id: "IC_71",
        artifact_selector: { kind: "pull_request_review", id: "9001" },
        expected_actor: CODEX_ACTOR,
        expected_app: CODEX_APP,
      },
    }),
    control_comment_binding: null,
    lease: leaseBinding(lease),
  });
}

function artifactBindingResponse({
  intentRecord,
  intentCommitSha,
  artifactCreatedAt,
}) {
  const providerServerTime = new Date(
    Date.parse(artifactCreatedAt) + 1000,
  ).toISOString();
  const recordBoundary = new Date(
    Date.parse(artifactCreatedAt) + 2000,
  ).toISOString();
  return createV2GitLedgerRecord({
    ...recordPlan(intentRecord),
    record_type: "effect-response",
    predecessor_commit_sha: intentCommitSha,
    server_observed_at: recordBoundary,
    payload: effectPayload({
      phase: "response",
      kind: "artifact-binding",
      predecessor: intentCommitSha,
      generation: intentRecord.payload.generation,
      intentCommitSha,
      action: intentRecord.payload.action,
      receipt: {
        generation_id: "automatic:1",
        request_binding_record_oid:
          intentRecord.payload.action.request_binding_record_oid,
        request_id: "71",
        request_node_id: "IC_71",
        artifact_selector: { kind: "pull_request_review", id: "9001" },
        artifact_node_id: "PRR_9001",
        artifact_url:
          "https://github.com/owner/repo/pull/7#pullrequestreview-9001",
        artifact_type: "pull_request_review",
        artifact_created_at: artifactCreatedAt,
        server_time: providerServerTime,
        raw_body_sha256: `sha256:${"7".repeat(64)}`,
        actor: CODEX_ACTOR,
        app: CODEX_APP,
      },
    }),
  });
}

function automaticGeneration(index) {
  return {
    generation_id: `automatic:${index}`,
    kind: "automatic",
    index,
    review_epoch_digest: digestCanonical(
      "codex-review-gate-v2-review-epoch",
      {
        pull_request: PR,
        base_ref_oid: BASE,
        head_ref_oid: HEAD,
        potential_merge_commit_oid: POTENTIAL,
      },
    ),
  };
}

function effectPayload({
  phase,
  kind,
  predecessor,
  generation = null,
  action,
  intentCommitSha = null,
  receipt = null,
}) {
  return {
    schema: "codex-review-gate-git-ledger-effect-payload-v2",
    schema_version: 1,
    phase,
    kind,
    scope: {
      pull_request: PR,
      head_ref_oid: HEAD,
      base_ref_oid: BASE,
      potential_merge_commit_oid: POTENTIAL,
    },
    generation,
    ordinal: generation?.index ?? 1,
    predecessor_commit_sha: predecessor,
    action,
    intent_commit_sha: intentCommitSha,
    receipt,
  };
}

function evaluatedScopeReceipt({
  eventName = "pull_request",
  ref = "refs/pull/7/merge",
  sha = POTENTIAL,
  relation = "pull-request-event",
  selector = null,
  inventoryReceipt = null,
} = {}) {
  return createV2GitLedgerEvaluatedScopeReceipt({
    relation,
    repository: REPOSITORY,
    scope: {
      pull_request: PR,
      head_ref_oid: HEAD,
      base_ref_oid: BASE,
      potential_merge_commit_oid: POTENTIAL,
    },
    trigger_identity: {
      event_name: eventName,
      ref,
      sha,
    },
    selector,
    inventory_receipt: inventoryReceipt,
    scope_endpoint_receipt: {
      method: "GET",
      path: "/repos/owner/repo/pulls/7",
      status: 200,
      server_time: TIME,
      raw_body_sha256: `sha256:${"a".repeat(64)}`,
      pull_request: PR,
      head_ref_oid: HEAD,
      base_ref_oid: BASE,
      potential_merge_commit_oid: POTENTIAL,
    },
  });
}

async function loadFixtureMinimalScope() {
  return loadV2MinimalLiveScope({
    fetch: minimalScopeFetch,
    token: SYNTHETIC_BEARER,
    repository: { owner: REPOSITORY.owner, name: REPOSITORY.name },
    pull_number: PR.number,
    rest_base_url: "https://api.github.test",
    graphql_url: "https://api.github.test/graphql",
  });
}

async function automaticReviewRequestBindingReceipt({
  action,
  observedAt = TIME,
  requestId = "71",
  actor = ACTOR,
  app = APP,
} = {}) {
  const minimal = await loadFixtureMinimalScope();
  const preScope = minimalScopeReceiptAt(minimal, observedAt);
  const postScope = minimalScopeReceiptAt(minimal, observedAt);
  const scopeWithoutDigest = {
    schema: "codex-review-gate-parent-recorded-request-scope-v1",
    schema_version: 1,
    pre_scope: preScope,
    post_scope: postScope,
    stable: true,
  };
  const requestScopeReceipt = {
    ...scopeWithoutDigest,
    receipt_digest: digestCanonical(
      "codex-review-gate-v2-automatic-review-request-scope-receipt",
      scopeWithoutDigest,
    ),
  };
  const carrierSelector = { kind: "issue_comment", id: requestId };
  const identity = {
    carrier_selector: carrierSelector,
    request_id: requestId,
    request_node_id: `IC_${requestId}`,
    api_url:
      `https://api.github.test/repos/owner/repo/issues/comments/${requestId}`,
    request_url:
      `https://github.com/owner/repo/pull/7#issuecomment-${requestId}`,
    issue_url: "https://api.github.test/repos/owner/repo/issues/7",
    body_sha256: action.request_body_sha256,
    created_at: observedAt,
    updated_at: observedAt,
    actor: structuredClone(actor),
    app: structuredClone(app),
  };
  const requestDigest = digestCanonical(
    "codex-review-gate-v2-automatic-review-request-identity",
    identity,
  );
  const withoutDigest = {
    schema:
      "codex-review-gate-git-ledger-automatic-review-request-binding-receipt-v2",
    schema_version: 1,
    http_status: 201,
    ...identity,
    post_server_time: observedAt,
    post_raw_body_sha256: `sha256:${"2".repeat(64)}`,
    request_digest: requestDigest,
    refetch_http_status: 200,
    refetch_server_time: observedAt,
    refetch_raw_body_sha256: `sha256:${"4".repeat(64)}`,
    refetched_request_digest: requestDigest,
    request_scope_receipt: requestScopeReceipt,
  };
  return {
    ...withoutDigest,
    receipt_digest: digestCanonical(
      "codex-review-gate-v2-automatic-review-request-binding-receipt",
      withoutDigest,
    ),
  };
}

function minimalScopeReceiptAt(receipt, observedAt) {
  const projected = structuredClone(receipt);
  projected.endpoint_receipts = projected.endpoint_receipts.map((endpoint) => ({
    ...endpoint,
    server_time: observedAt,
  }));
  projected.observed_at = observedAt;
  delete projected.receipt_digest;
  projected.receipt_digest = runnerDigestCanonical(
    "codex-review-gate-v2-minimal-live-scope",
    projected,
  );
  return projected;
}

async function minimalScopeFetch(urlValue, init = {}) {
  return minimalScopeFetchAt(TIME, urlValue, init);
}

async function minimalScopeFetchAt(serverTime, urlValue, init = {}) {
  const url = new URL(urlValue);
  const date = new Date(serverTime).toUTCString();
  if (url.pathname === "/repos/owner/repo/pulls/7") {
    return response(200, {
      number: PR.number,
      url: "https://api.github.test/repos/owner/repo/pulls/7",
      node_id: PR.node_id,
      state: "open",
      merged: false,
      merged_at: null,
      updated_at: TIME,
    }, date);
  }
  if (url.pathname === "/graphql") {
    assert.equal(init.method, "POST");
    return response(200, {
      data: {
        repository: {
          id: REPOSITORY.node_id,
          name: REPOSITORY.name,
          owner: { login: REPOSITORY.owner },
          pullRequest: {
            id: PR.node_id,
            number: PR.number,
            state: "OPEN",
            merged: false,
            mergedAt: null,
            isDraft: false,
            updatedAt: TIME,
            mergeable: "MERGEABLE",
            baseRefName: "main",
            baseRef: { name: "main", target: { oid: BASE } },
            headRefName: "feature",
            headRefOid: HEAD,
            headRef: { name: "feature", target: { oid: HEAD } },
            potentialMergeCommit: {
              oid: POTENTIAL,
              tree: { oid: "e".repeat(40) },
              parents: {
                totalCount: 2,
                pageInfo: { hasNextPage: false, endCursor: "parent-2" },
                nodes: [{ oid: BASE }, { oid: HEAD }],
              },
            },
          },
        },
      },
    }, date);
  }
  if (url.pathname === `/repos/owner/repo/compare/${BASE}...${HEAD}`) {
    return response(200, {
      base_commit: { sha: BASE },
      merge_base_commit: { sha: BASE },
    }, date);
  }
  if (url.pathname === "/repos/owner/repo/git/ref/pull/7/merge") {
    return response(200, {
      ref: "refs/pull/7/merge",
      url: "https://api.github.test/repos/owner/repo/git/refs/pull/7/merge",
      object: {
        type: "commit",
        sha: POTENTIAL,
        url: `https://api.github.test/repos/owner/repo/git/commits/${POTENTIAL}`,
      },
    }, date);
  }
  throw new Error(`unexpected minimal scope request ${init.method} ${url.href}`);
}

async function loadFixtureProviderPreflight({
  actor = CODEX_ACTOR,
  app = CODEX_APP,
} = {}) {
  return createV2GitHubWorkflowPreflight({
    fetch: providerPreflightFetch({ actor, app }),
    token: SYNTHETIC_BEARER,
    repository: `${REPOSITORY.owner}/${REPOSITORY.name}`,
    restBaseUrl: "https://api.github.test",
  }).load({ command: providerPreflightCommand() });
}

function providerPreflightCommand() {
  return {
    schema: "codex-review-gate-workflow-command-v2",
    schema_version: 1,
    command: "run",
    repository: { owner: REPOSITORY.owner, name: REPOSITORY.name },
    pull_request: { number: PR.number },
    dispatch_binding: null,
    selection_policy: "joey-default",
    route: {
      operation: "ordinary",
      trigger: "provider-event",
      observation_boundary: "initial",
    },
    invocation: {
      event_name: "issue_comment",
      event_payload_sha256: `sha256:${"0".repeat(64)}`,
      run_id: OWNER.run_id,
      run_attempt: OWNER.run_attempt,
      actor_id: OWNER.actor_id,
    },
    workflow_receipt: {
      present: true,
      compatible: true,
      source: "trusted-reusable-workflow",
      repository: "Joey-Tools/codex-review-gate-action",
      path: ".github/workflows/codex-review-gate.yml",
      revision: "2".repeat(40),
      checkout_sha: "2".repeat(40),
      caller_repository: "owner/repo",
      caller_workflow_ref:
        "owner/repo/.github/workflows/controller.yml@refs/heads/main",
      caller_workflow_sha: "2".repeat(40),
      status_context: "codex/github-review-gate",
      status_target_mode: "test-merge-with-head-sentinel",
    },
    receipt_policy: {
      server_enforcement: V2_SERVER_ENFORCEMENT_POLICY,
      public_wait: V2_PUBLIC_WAIT_POLICY,
    },
  };
}

function providerPreflightFetch({ actor, app }) {
  const ledgerRuleset = {
    id: 101,
    name: "Codex ledger protection",
    target: "branch",
    source_type: "Repository",
    source: "owner/repo",
    enforcement: "active",
    bypass_actors: [],
    conditions: {
      ref_name: { include: [V2_GIT_LEDGER_REF], exclude: [] },
    },
    rules: [{ type: "deletion" }, { type: "non_fast_forward" }],
  };
  const effectiveRule = (type, id, parameters = null) => ({
    type,
    enforcement: "active",
    ruleset_id: id,
    ruleset_name: `Rules ${id}`,
    ruleset_source_type: "Repository",
    ruleset_source: "owner/repo",
    ...(parameters === null ? {} : { parameters }),
  });
  return async (urlValue, init = {}) => {
    const url = new URL(urlValue);
    const path = url.pathname;
    const date = new Date(TIME).toUTCString();
    let body;
    let status = 200;
    if (path === "/repos/owner/repo") {
      body = {
        id: Number(REPOSITORY.id),
        full_name: "owner/repo",
        node_id: REPOSITORY.node_id,
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
        owner: { id: Number(REPOSITORY.owner_id), login: "owner" },
      };
    } else if (path === "/repos/Joey-Tools/codex-review-gate-action") {
      body = {
        id: 4242,
        node_id: "R_release",
        full_name: "Joey-Tools/codex-review-gate-action",
      };
    } else if (path ===
        "/repos/Joey-Tools/codex-review-gate-action/contents/.github/workflows/codex-review-gate.yml") {
      const yaml = [
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
      body = {
        type: "file",
        path: ".github/workflows/codex-review-gate.yml",
        encoding: "base64",
        content: Buffer.from(yaml).toString("base64"),
        sha: "e".repeat(40),
      };
    } else if (path === "/apps/github-actions") {
      body = { id: 15368, node_id: "A_actions", slug: "github-actions" };
    } else if (path === "/apps/chatgpt-codex-connector") {
      body = { id: Number(app.id), node_id: app.node_id, slug: app.slug };
    } else if (path === "/users/chatgpt-codex-connector%5Bbot%5D") {
      body = {
        id: Number(actor.id),
        node_id: actor.node_id,
        login: actor.login,
        type: actor.type,
      };
    } else if (path === "/repos/owner/repo/actions/oidc/customization/sub") {
      body = {
        use_default: false,
        include_claim_keys: ["repo", "job_workflow_ref"],
      };
    } else if (path === "/repos/owner/repo/actions/workflows/controller.yml") {
      body = {
        id: 1,
        node_id: "W_controller",
        path: ".github/workflows/controller.yml",
        state: "active",
      };
    } else if (path ===
        "/repos/owner/repo/contents/.github/workflows/controller.yml") {
      const yaml = [
        "name: controller",
        "jobs:",
        "  gate:",
        "    uses: Joey-Tools/codex-review-gate-action/.github/workflows/" +
          `codex-review-gate.yml@${"2".repeat(40)}`,
        "",
      ].join("\n");
      body = {
        type: "file",
        path: ".github/workflows/controller.yml",
        encoding: "base64",
        content: Buffer.from(yaml).toString("base64"),
        sha: "d".repeat(40),
      };
    } else if (path === "/repos/owner/repo/rules/branches/main") {
      body = url.searchParams.get("page") === "1" ? [
        effectiveRule("required_status_checks", 10, {
          required_status_checks: [{
            context: "codex/github-review-gate",
            integration_id: 15368,
          }],
        }),
        effectiveRule("workflows", 11, {
          workflows: [{
            path: ".github/workflows/codex-review-gate.yml",
            ref: "2".repeat(40),
            repository_id: 4242,
            sha: "2".repeat(40),
          }],
        }),
      ] : [];
    } else if (path ===
        "/repos/owner/repo/branches/codex-review-gate-ledger-v2") {
      body = {
        name: "codex-review-gate-ledger-v2",
        commit: { sha: "f".repeat(40) },
      };
    } else if (path ===
        "/repos/owner/repo/rules/branches/codex-review-gate-ledger-v2") {
      body = url.searchParams.get("page") === "1" ? [
        effectiveRule("deletion", 101),
        effectiveRule("non_fast_forward", 101),
      ] : [];
    } else if (path === "/repos/owner/repo/rulesets") {
      body = url.searchParams.get("page") === "1" ? [ledgerRuleset] : [];
    } else if (path === "/repos/owner/repo/rulesets/101") {
      body = ledgerRuleset;
    } else {
      status = 404;
      body = { message: `unexpected preflight route ${path}` };
    }
    assert.equal(init.method, "GET");
    return response(status, body, date);
  };
}

function providerTransportFixture({
  startSecond = 600,
  comment = providerIssueComment(),
} = {}) {
  let second = startSecond;
  let currentComment = structuredClone(comment);
  const calls = [];
  const fixture = {
    calls,
    setComment(value) { currentComment = value === null ? null : structuredClone(value); },
    async fetch(urlValue, init = {}) {
      const url = new URL(urlValue);
      const method = init.method ?? "GET";
      calls.push({ method, path: url.pathname });
      second += 1;
      const date = new Date(Date.UTC(2026, 7, 13, 12, 0, second)).toUTCString();
      const repoPath = "/repos/owner/repo";
      if (url.pathname === "/graphql") {
        const query = String(JSON.parse(init.body).query);
        if (query.includes("CodexReviewGateV2Scope")) {
          return response(200, { data: providerScopePayload() }, date);
        }
        if (query.includes("CodexReviewGateV2ReviewThreads")) {
          return response(200, {
            data: {
              repository: {
                pullRequest: {
                  reviewThreads: emptyGraphqlConnection(),
                },
              },
            },
          }, date);
        }
        return response(200, { errors: [{ message: "unexpected query" }] }, date);
      }
      if (url.pathname === `${repoPath}/pulls/7`) {
        return response(200, {
          number: 7,
          node_id: PR.node_id,
          url: "https://api.github.test/repos/owner/repo/pulls/7",
          state: "open",
          merged: false,
          merged_at: null,
          mergeable: true,
          merge_commit_sha: POTENTIAL,
          base: { ref: "main", sha: BASE },
          head: { ref: "feature", sha: HEAD },
        }, date);
      }
      if (url.pathname === `${repoPath}/compare/${BASE}...${HEAD}`) {
        return response(200, {
          base_commit: { sha: BASE },
          merge_base_commit: { sha: BASE },
        }, date);
      }
      if (url.pathname === `${repoPath}/git/ref/pull/7/merge`) {
        return response(200, {
          ref: "refs/pull/7/merge",
          url: "https://api.github.test/repos/owner/repo/git/refs/pull/7/merge",
          object: {
            type: "commit",
            sha: POTENTIAL,
            url: `https://api.github.test/repos/owner/repo/git/commits/${POTENTIAL}`,
          },
        }, date);
      }
      if (url.pathname === `${repoPath}/issues/7/comments`) {
        return response(200, currentComment === null ? [] : [currentComment], date);
      }
      if (url.pathname === `${repoPath}/pulls/7/reviews` ||
          url.pathname === `${repoPath}/pulls/7/comments` ||
          url.pathname === `${repoPath}/issues/7/reactions` ||
          url.pathname === `${repoPath}/issues/comments/71/reactions`) {
        return response(200, [], date);
      }
      if (url.pathname === `${repoPath}/commits/${HEAD}/check-runs`) {
        return response(200, { total_count: 0, check_runs: [] }, date);
      }
      if (url.pathname === `${repoPath}/issues/comments/71`) {
        return currentComment === null
          ? response(404, { message: "Not Found" }, date)
          : response(200, currentComment, date);
      }
      if (url.pathname === repoPath) {
        return response(200, {
          full_name: "owner/repo",
          url: "https://api.github.test/repos/owner/repo",
          role_name: "admin",
          permissions: {
            admin: true,
            maintain: true,
            push: true,
            triage: true,
            pull: true,
          },
        }, date);
      }
      return response(404, { message: `unexpected transport route ${url.pathname}` }, date);
    },
  };
  return fixture;
}

function providerIssueComment(overrides = {}) {
  return {
    id: 71,
    node_id: "IC_71",
    url: "https://api.github.test/repos/owner/repo/issues/comments/71",
    html_url: "https://github.com/owner/repo/pull/7#issuecomment-71",
    issue_url: "https://api.github.test/repos/owner/repo/issues/7",
    user: {
      id: Number(CODEX_ACTOR.id),
      node_id: CODEX_ACTOR.node_id,
      login: CODEX_ACTOR.login,
      type: CODEX_ACTOR.type,
    },
    performed_via_github_app: {
      id: Number(CODEX_APP.id),
      node_id: CODEX_APP.node_id,
      slug: CODEX_APP.slug,
    },
    author_association: "MEMBER",
    body: "provider result",
    created_at: "2026-08-13T11:00:00Z",
    updated_at: "2026-08-13T11:00:00Z",
    ...overrides,
  };
}

function providerScopePayload() {
  return {
    repository: {
      id: REPOSITORY.node_id,
      name: REPOSITORY.name,
      owner: { login: REPOSITORY.owner },
      pullRequest: {
        id: PR.node_id,
        number: PR.number,
        state: "OPEN",
        merged: false,
        mergedAt: null,
        isDraft: false,
        mergeable: "MERGEABLE",
        baseRefName: "main",
        baseRefOid: BASE,
        baseRef: { name: "main", target: { oid: BASE } },
        headRefName: "feature",
        headRefOid: HEAD,
        headRef: { name: "feature", target: { oid: HEAD } },
        potentialMergeCommit: {
          oid: POTENTIAL,
          tree: { oid: "e".repeat(40) },
          parents: {
            totalCount: 2,
            pageInfo: { hasNextPage: false, endCursor: "parent-2" },
            nodes: [{ oid: BASE }, { oid: HEAD }],
          },
        },
      },
    },
  };
}

function emptyGraphqlConnection() {
  return {
    totalCount: 0,
    pageInfo: { hasNextPage: false, endCursor: null },
    nodes: [],
  };
}

function createProviderTransport(fetch) {
  return createV2GitHubTransport({
    fetch,
    token: SYNTHETIC_BEARER,
    restBaseUrl: "https://api.github.test",
    graphqlUrl: "https://api.github.test/graphql",
  });
}

async function loadProviderPreScopeArtifact(fetch) {
  return loadV2ProviderPreScopeArtifact({
    fetch,
    token: SYNTHETIC_BEARER,
    restBaseUrl: "https://api.github.test",
    owner: REPOSITORY.owner,
    repo: REPOSITORY.name,
    pullNumber: PR.number,
    headSha: HEAD,
    selector: { kind: "issue_comment", id: "71" },
    expectedActor: CODEX_ACTOR,
    expectedApp: CODEX_APP,
  });
}

async function createManualWorkflowCommandHandle() {
  return createWorkflowCommandHandle({
    eventName: "workflow_dispatch",
    controllerRoute: "evaluate-only",
    event: { inputs: { "pull-request": String(PR.number) } },
  });
}

async function createPullRequestTargetWorkflowCommandHandle({
  runIdentity = OWNER,
  observationBoundary = "initial",
} = {}) {
  return createWorkflowCommandHandle({
    eventName: "pull_request_target",
    controllerRoute: "ordinary",
    event: { pull_request: { number: PR.number } },
    runIdentity,
    observationBoundary,
  });
}

async function createProviderWorkflowCommandHandle() {
  return createWorkflowCommandHandle({
    eventName: "issue_comment",
    controllerRoute: "provider-event-hint",
    event: {
      issue: {
        number: PR.number,
        pull_request: {
          url: "https://api.github.test/repos/owner/repo/pulls/7",
        },
      },
    },
  });
}

async function createScheduleWorkflowCommandHandle({
  pullRequestNumber = null,
  dispatchBinding = null,
  runIdentity = OWNER,
  event = {},
  selectionPolicy = "joey-default",
  workflowSha = "2".repeat(40),
} = {}) {
  return createWorkflowCommandHandle({
    eventName: "schedule",
    controllerRoute: pullRequestNumber === null ? "scan-all-open" : "ordinary",
    event,
    runIdentity,
    pullRequestNumber,
    dispatchBinding,
    selectionPolicy,
    workflowSha,
  });
}

async function createWorkflowCommandHandle({
  eventName,
  controllerRoute,
  event,
  runIdentity = OWNER,
  observationBoundary = "initial",
  pullRequestNumber = PR.number,
  dispatchBinding = null,
  selectionPolicy = "joey-default",
  workflowSha = "2".repeat(40),
}) {
  const directory = await mkdtemp(join(tmpdir(), "v2-git-ledger-command-"));
  const eventPath = join(directory, "event.json");
  const commandPath = join(directory, "command.json");
  await writeFile(eventPath, JSON.stringify(event), { mode: 0o600 });
  const environment = {
    RUNNER_TEMP: directory,
    V2_CONTROLLER_INPUT_PATH: commandPath,
    V2_CONTROLLER_EVENT_PATH: eventPath,
    GITHUB_WORKSPACE: process.cwd(),
    GITHUB_REPOSITORY: "owner/repo",
    V2_CONTROLLER_PULL_REQUEST:
      pullRequestNumber === null ? "" : String(pullRequestNumber),
    V2_CONTROLLER_DISPATCH_BINDING:
      dispatchBinding === null ? "" : canonicalJson(dispatchBinding),
    V2_CONTROLLER_ROUTE: controllerRoute,
    V2_CONTROLLER_OBSERVATION_BOUNDARY: observationBoundary,
    GITHUB_EVENT_NAME: eventName,
    GITHUB_RUN_ID: runIdentity.run_id,
    GITHUB_RUN_ATTEMPT: String(runIdentity.run_attempt),
    GITHUB_ACTOR_ID: runIdentity.actor_id,
    V2_EXPECTED_WORKFLOW_REPOSITORY:
      "Joey-Tools/codex-review-gate-action",
    V2_ACTUAL_WORKFLOW_REPOSITORY:
      "Joey-Tools/codex-review-gate-action",
    V2_EXPECTED_WORKFLOW_SHA: workflowSha,
    V2_CHECKED_OUT_RELEASE_SHA: workflowSha,
    V2_EXPECTED_WORKFLOW_PATH:
      ".github/workflows/codex-review-gate.yml",
    GITHUB_WORKFLOW_REF:
      "owner/repo/.github/workflows/controller.yml@refs/heads/main",
    GITHUB_WORKFLOW_SHA: workflowSha,
    V2_SELECTION_POLICY: selectionPolicy,
    V2_STATUS_CONTEXT: "codex/github-review-gate",
    V2_STATUS_TARGET_MODE: "test-merge-with-head-sentinel",
  };
  try {
    return await prepareV2WorkflowCommand(environment);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function leaseBinding(lease) {
  return {
    lease_id: lease.lease_id,
    owner: lease.owner,
    acquire_commit_sha: lease.acquire_commit_sha,
    expires_at: lease.expires_at,
  };
}

function recordPlan(record) {
  const {
    schema: _schema,
    schema_version: _version,
    payload_digest: _payloadDigest,
    record_digest: _recordDigest,
    ...plan
  } = record;
  return structuredClone(plan);
}

function githubGitFixture() {
  const calls = [];
  const blobs = new Map();
  const trees = new Map();
  const commits = new Map();
  let refTarget = null;
  let second = 0;
  let mismatchReread = false;
  let refRereadOverride = null;
  let failAttestationUpdate = false;
  let failEffectUpdateKind = null;
  let failCandidateDispatchPhase = null;
  let moveRefOnCommitRead = false;
  let serverTimeFrozen = false;

  const fixture = {
    calls,
    blobs,
    trees,
    commits,
    get refTarget() { return refTarget; },
    get writeCalls() {
      return calls.filter((call) => new Set(["POST", "PATCH"]).has(call.method)).length;
    },
    mismatchNextRefReread() { mismatchReread = true; },
    failNextAttestationUpdate() { failAttestationUpdate = true; },
    failNextEffectUpdate(kind) { failEffectUpdateKind = kind; },
    failNextCandidateDispatchUpdate(phase) {
      failCandidateDispatchPhase = phase;
    },
    advanceServerTime(seconds) { second += seconds; },
    freezeServerTime() { serverTimeFrozen = true; },
    moveRefToParentOnNextCommitRead() { moveRefOnCommitRead = true; },
    tipRecordType() { return recordType(refTarget); },
    rewriteTipText(mutator) {
      const commit = commits.get(refTarget);
      const tree = trees.get(commit.tree.sha);
      const blob = blobs.get(tree.tree[0].sha);
      const content = mutator(blob.content);
      const rewrittenSha = gitObjectSha("blob", Buffer.from(content, "utf8"));
      blobs.set(rewrittenSha, { sha: rewrittenSha, content });
      const rewrittenTreeSha = canonicalTreeSha(rewrittenSha);
      trees.set(rewrittenTreeSha, {
        sha: rewrittenTreeSha,
        tree: [{
          path: V2_GIT_LEDGER_BLOB_PATH,
          mode: "100644",
          type: "blob",
          sha: rewrittenSha,
        }],
      });
      const commitBytes = Buffer.from([
        `tree ${rewrittenTreeSha}`,
        ...commit.parents.map((parent) => `parent ${parent.sha}`),
        `author ${commit.author.name} <${commit.author.email}> ${gitTimestamp(commit.author.date)}`,
        `committer ${commit.committer.name} <${commit.committer.email}> ${gitTimestamp(commit.committer.date)}`,
        "",
        commit.message,
      ].join("\n"), "utf8");
      const rewrittenCommitSha = gitObjectSha("commit", commitBytes);
      commits.set(rewrittenCommitSha, {
        ...structuredClone(commit),
        sha: rewrittenCommitSha,
        tree: { sha: rewrittenTreeSha },
      });
      refTarget = rewrittenCommitSha;
    },
    rewriteTipEnvelope(mutator) {
      fixture.rewriteTipText((text) => {
        const envelope = JSON.parse(text.trim());
        mutator(envelope);
        return `${canonicalJson(envelope)}\n`;
      });
    },
    async fetch(url, init) {
      const parsed = new URL(url);
      const path = parsed.pathname.replace("/repos/owner/repo", "");
      calls.push({ method: init.method, path, body: init.body ?? null });
      if (!serverTimeFrozen) second += 1;
      const date = new Date(Date.UTC(2026, 7, 13, 12, 0, second)).toUTCString();

      if (init.method === "POST" && path === "/git/blobs") {
        const body = JSON.parse(init.body);
        assert.equal(body.encoding, "utf-8");
        const sha = gitObjectSha("blob", Buffer.from(body.content, "utf8"));
        blobs.set(sha, { sha, content: body.content });
        return response(201, { sha, url: `https://api.github.test/blob/${sha}` }, date);
      }
      if (init.method === "POST" && path === "/git/trees") {
        const body = JSON.parse(init.body);
        const sha = canonicalTreeSha(body.tree[0].sha);
        trees.set(sha, { sha, tree: structuredClone(body.tree) });
        return response(201, { sha, tree: body.tree }, date);
      }
      if (init.method === "POST" && path === "/git/commits") {
        const body = JSON.parse(init.body);
        const commitBytes = Buffer.from([
          `tree ${body.tree}`,
          ...body.parents.map((parent) => `parent ${parent}`),
          `author ${body.author.name} <${body.author.email}> ${gitTimestamp(body.author.date)}`,
          `committer ${body.committer.name} <${body.committer.email}> ${gitTimestamp(body.committer.date)}`,
          "",
          body.message,
        ].join("\n"), "utf8");
        const sha = gitObjectSha("commit", commitBytes);
        const commit = {
          sha,
          message: body.message,
          tree: { sha: body.tree },
          parents: body.parents.map((parent) => ({ sha: parent })),
          author: structuredClone(body.author),
          committer: structuredClone(body.committer),
        };
        commits.set(sha, commit);
        return response(201, commit, date);
      }
      if (init.method === "POST" && path === "/git/refs") {
        const body = JSON.parse(init.body);
        assert.equal(refTarget, null);
        refTarget = body.sha;
        return response(201, refBody(refTarget), date);
      }
      if (init.method === "PATCH" && path === "/git/refs/heads/codex-review-gate-ledger-v2") {
        const body = JSON.parse(init.body);
        assert.equal(body.force, false);
        const candidate = commits.get(body.sha);
        if (failAttestationUpdate && recordType(body.sha) === "capability-attestation") {
          failAttestationUpdate = false;
          return response(500, {
            message: "Internal Server Error",
            documentation_url: "https://docs.github.com/rest",
            status: "500",
          }, date);
        }
        if (
          failEffectUpdateKind !== null &&
          recordEnvelope(body.sha).kind === failEffectUpdateKind
        ) {
          failEffectUpdateKind = null;
          return response(500, {
            message: "Internal Server Error",
            documentation_url: "https://docs.github.com/rest",
            status: "500",
          }, date);
        }
        if (
          failCandidateDispatchPhase !== null &&
          recordType(body.sha) === "candidate-dispatch-observation" &&
          recordEnvelope(body.sha).payload.phase ===
            failCandidateDispatchPhase
        ) {
          failCandidateDispatchPhase = null;
          return response(500, {
            message: "Internal Server Error",
            documentation_url: "https://docs.github.com/rest",
            status: "500",
          }, date);
        }
        const fastForward = candidate?.parents.length === 1 &&
          candidate.parents[0].sha === refTarget;
        if (!fastForward) {
          return response(422, {
            message: "Update is not a fast forward",
            documentation_url: "https://docs.github.com/rest/git/refs#update-a-reference",
            status: "422",
          }, date);
        }
        const old = refTarget;
        refTarget = body.sha;
        if (mismatchReread) {
          refRereadOverride = old;
          mismatchReread = false;
        }
        return response(200, refBody(refTarget), date);
      }
      if (init.method === "GET" && path === "/git/ref/heads/codex-review-gate-ledger-v2") {
        if (refTarget === null) {
          return response(404, {
            message: "Not Found",
            documentation_url: "https://docs.github.com/rest/git/refs#get-a-reference",
            status: "404",
          }, date);
        }
        const target = refRereadOverride ?? refTarget;
        refRereadOverride = null;
        return response(200, refBody(target), date);
      }
      const commitMatch = path.match(/^\/git\/commits\/([0-9a-f]{40})$/u);
      if (init.method === "GET" && commitMatch !== null) {
        const commit = commits.get(commitMatch[1]);
        if (moveRefOnCommitRead) {
          moveRefOnCommitRead = false;
          refTarget = commit.parents[0].sha;
        }
        return response(200, commit, date);
      }
      const treeMatch = path.match(/^\/git\/trees\/([0-9a-f]{40})$/u);
      if (init.method === "GET" && treeMatch !== null) {
        return response(200, trees.get(treeMatch[1]), date);
      }
      const blobMatch = path.match(/^\/git\/blobs\/([0-9a-f]{40})$/u);
      if (init.method === "GET" && blobMatch !== null) {
        const blob = blobs.get(blobMatch[1]);
        return response(200, {
          sha: blob.sha,
          encoding: "base64",
          content: Buffer.from(blob.content, "utf8").toString("base64"),
        }, date);
      }
      throw new Error(`unexpected fixture request ${init.method} ${path}`);
    },
  };
  return fixture;

  function refBody(sha) {
    return {
      ref: V2_GIT_LEDGER_REF,
      node_id: "REF_ledger",
      object: { type: "commit", sha },
    };
  }

  function recordType(commitSha) {
    return recordEnvelope(commitSha).record_type;
  }

  function recordEnvelope(commitSha) {
    const commit = commits.get(commitSha);
    const tree = trees.get(commit.tree.sha);
    const blob = blobs.get(tree.tree[0].sha);
    return JSON.parse(blob.content);
  }
}

function resealEnvelope(envelope) {
  delete envelope.envelope_digest;
  envelope.envelope_digest = digestCanonical(
    "codex-review-gate-v2-git-ledger-envelope",
    envelope,
  );
}

function resealProvenance(provenance) {
  const binding = provenance.operation_binding;
  const {
    nonce: _nonce,
    audience: _audience,
    request_digest: _requestDigest,
    ...bindingInput
  } = binding;
  const nonce = digestCanonical(
    "codex-review-gate-v2-git-ledger-provenance-nonce",
    {
      schema: "codex-review-gate-git-ledger-provenance-request-v2",
      schema_version: 1,
      ...bindingInput,
    },
  );
  binding.nonce = nonce;
  binding.audience =
    `${V2_GIT_LEDGER_OIDC_AUDIENCE}:${nonce.slice("sha256:".length)}`;
  const { request_digest: _bindingDigest, ...requestWithoutDigest } = binding;
  binding.request_digest = digestCanonical(
    "codex-review-gate-v2-git-ledger-provenance-request",
    {
      schema: "codex-review-gate-git-ledger-provenance-request-v2",
      schema_version: 1,
      ...requestWithoutDigest,
    },
  );
  provenance.audience = binding.audience;
  provenance.claims.aud = binding.audience;
  delete provenance.receipt_digest;
  provenance.receipt_digest = digestCanonical(
    "codex-review-gate-v2-git-ledger-provenance",
    provenance,
  );
}

function response(status, value, date) {
  const body = JSON.stringify(value);
  const headers = { Date: date, "Content-Type": "application/json" };
  return new Response(body, { status, headers });
}

function rawDigest(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function gitObjectSha(type, bytes) {
  const header = Buffer.from(`${type} ${bytes.byteLength}\0`, "utf8");
  return createHash("sha1").update(header).update(bytes).digest("hex");
}

function canonicalTreeSha(blobSha) {
  const bytes = Buffer.concat([
    Buffer.from(`100644 ${V2_GIT_LEDGER_BLOB_PATH}\0`, "utf8"),
    Buffer.from(blobSha, "hex"),
  ]);
  return gitObjectSha("tree", bytes);
}

function gitTimestamp(value) {
  return `${Math.floor(Date.parse(value) / 1000)} +0000`;
}

function digestCanonical(domain, value) {
  return rawDigest(`${domain}\0${canonicalJson(value)}`);
}

function runnerDigestCanonical(domain, value) {
  const domainBytes = Buffer.from(domain, "utf8");
  const valueBytes = Buffer.from(canonicalJson(value), "utf8");
  const hash = createHash("sha256");
  hash.update(`${domainBytes.length}:`);
  hash.update(domainBytes);
  hash.update("\0");
  hash.update(`${valueBytes.length}:`);
  hash.update(valueBytes);
  return `sha256:${hash.digest("hex")}`;
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
