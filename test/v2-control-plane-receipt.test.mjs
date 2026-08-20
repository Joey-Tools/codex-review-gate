import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  assertV2ControlPlaneReceiptHandle,
  createV2ControlPlaneReceiptFromGitLedgerAuthority,
  deriveV2ProjectorControlAuthority,
  V2_CONTROL_PLANE_HEAD_HISTORY_INTENT_KINDS,
  V2_CONTROL_PLANE_HEAD_HISTORY_RESPONSE_KINDS,
  validateV2ControlPlaneReceipt,
  V2_CONTROL_PLANE_LEDGER_REF,
  V2_CONTROL_PLANE_RECEIPT_SCHEMA,
  V2_CONTROL_PLANE_RECEIPT_SCHEMA_VERSION,
} from "../packages/action/src/v2/control-plane-receipt.mjs";

const SHA = (character) => character.repeat(40);
const OID = (label) => createHash("sha256")
  .update(label, "utf8").digest("hex").slice(0, 40);
const DIGEST = (label) => `sha256:${createHash("sha256")
  .update(label, "utf8").digest("hex")}`;

test("rejects every caller-constructed ledger authority before projection", () => {
  const forged = {
    schema: "codex-review-gate-git-ledger-control-plane-authority-v2",
    schema_version: 1,
    scope: exactLedgerScope(),
    load: {},
    scoped_authority: {},
    stable: true,
    binding_digest: DIGEST("forged"),
  };
  assert.throws(
    () => createV2ControlPlaneReceiptFromGitLedgerAuthority(forged),
    (error) => error?.code === "UNTRUSTED_CONTROL_PLANE_AUTHORITY_HANDLE",
  );
});

test("head history policy excludes exact-scope observations and publications", () => {
  assert.deepEqual(V2_CONTROL_PLANE_HEAD_HISTORY_INTENT_KINDS, [
    "automatic-request-reservation",
  ]);
  assert.deepEqual(V2_CONTROL_PLANE_HEAD_HISTORY_RESPONSE_KINDS, [
    "review-request",
    "request-binding",
    "artifact-binding",
    "scheduler-state",
  ]);
  for (const exactScopeKind of [
    "no-start-observation",
    "thread-resolution-observation",
    "status-write",
    "control-comment-create",
    "control-comment-update",
    "sticky-comment",
  ]) {
    assert.equal(
      V2_CONTROL_PLANE_HEAD_HISTORY_RESPONSE_KINDS.includes(exactScopeKind),
      false,
    );
  }
});

test("serialized audit receipt validation never grants execution authority", () => {
  const receipt = serializedAuditReceipt();
  assert.equal(validateV2ControlPlaneReceipt(receipt), receipt);
  assert.equal(receipt.schema, V2_CONTROL_PLANE_RECEIPT_SCHEMA);
  assert.equal(receipt.schema_version, V2_CONTROL_PLANE_RECEIPT_SCHEMA_VERSION);
  assert.equal(receipt.schema_version, 2);
  assert.equal(receipt.ledger_ref, V2_CONTROL_PLANE_LEDGER_REF);
  assert.throws(
    () => assertV2ControlPlaneReceiptHandle(receipt),
    (error) => error?.code === "UNTRUSTED_CONTROL_PLANE_RECEIPT_HANDLE",
  );
  assert.throws(
    () => deriveV2ProjectorControlAuthority(receipt, exactProjectedScope()),
    (error) => error?.code === "UNTRUSTED_CONTROL_PLANE_RECEIPT_HANDLE",
  );
});

test("serialized validation preserves the exact legacy v1 request-binding shape",
  () => {
    const receipt = structuredClone(serializedAuditReceipt());
    receipt.schema_version = 1;
    receipt.derived.budget = {
      automatic_reservations_on_head: 1,
      automatic_requests_on_head: 1,
      manual_requests_in_epoch: 0,
    };
    receipt.derived.generations = [generationAudit({
      baseOid: receipt.scope.base_oid,
    })];
    const binding = requestBindingAudit({
      baseOid: receipt.scope.base_oid,
    });
    delete binding.current_incarnation;
    receipt.derived.request_bindings = [binding];
    resealAuditReceipt(receipt);

    assert.equal(validateV2ControlPlaneReceipt(receipt), receipt);

    const v1WithV2Marker = structuredClone(receipt);
    v1WithV2Marker.derived.request_bindings[0].current_incarnation = true;
    resealAuditReceipt(v1WithV2Marker);
    assert.throws(
      () => validateV2ControlPlaneReceipt(v1WithV2Marker),
      /derived request binding must use the closed key set/u,
    );

    const v2WithoutMarker = structuredClone(receipt);
    v2WithoutMarker.schema_version = 2;
    resealAuditReceipt(v2WithoutMarker);
    assert.throws(
      () => validateV2ControlPlaneReceipt(v2WithoutMarker),
      /derived request binding must use the closed key set/u,
    );

    const unsupported = structuredClone(serializedAuditReceipt());
    unsupported.schema_version = 3;
    resealAuditReceipt(unsupported);
    assert.throws(
      () => validateV2ControlPlaneReceipt(unsupported),
      /control_plane_receipt\.schema_version must be an integer in its closed range/u,
    );
  });

test("legacy v1 request bindings stop at the closed 67-generation profile",
  () => {
    const legacy = structuredClone(serializedAuditReceipt());
    legacy.schema_version = 1;
    legacy.record_count = 67;
    legacy.derived.request_bindings = [
      ...Array.from({ length: 3 }, (_, offset) => requestBindingAudit({
        index: offset + 1,
        baseOid: legacy.scope.base_oid,
        requestId: String(1_000 + offset),
        recordOid: OID(`legacy-automatic-${offset + 1}`),
        currentIncarnation: false,
      })),
      ...Array.from({ length: 64 }, (_, offset) => requestBindingAudit({
        index: offset + 1,
        generationKind: "manual",
        baseOid: legacy.scope.base_oid,
        requestId: String(2_000 + offset),
        recordOid: OID(`legacy-manual-${offset + 1}`),
        currentIncarnation: false,
      })),
    ];
    for (const binding of legacy.derived.request_bindings) {
      delete binding.current_incarnation;
    }
    resealAuditReceipt(legacy);

    assert.equal(validateV2ControlPlaneReceipt(legacy), legacy);

    const overflow = structuredClone(legacy);
    overflow.record_count = 68;
    const extra = requestBindingAudit({
      index: 64,
      generationKind: "manual",
      baseOid: legacy.scope.base_oid,
      requestId: "2999",
      recordOid: OID("legacy-manual-overflow"),
      currentIncarnation: false,
    });
    delete extra.current_incarnation;
    overflow.derived.request_bindings.push(extra);
    resealAuditReceipt(overflow);
    assert.throws(
      () => validateV2ControlPlaneReceipt(overflow),
      /derived\.request_bindings must be a bounded array/u,
    );

    const current = structuredClone(serializedAuditReceipt());
    current.record_count = 68;
    current.derived.budget = {
      automatic_reservations_on_head: 1,
      automatic_requests_on_head: 1,
      manual_requests_in_epoch: 0,
    };
    const currentRequestId = "3999";
    const currentRecordOid = OID("current-request-binding");
    current.derived.generations = [generationAudit({
      baseOid: current.scope.base_oid,
      reviewEpochDigest: current.scope.review_epoch_digest,
      requestId: currentRequestId,
      requestBindingRecordOid: currentRecordOid,
    })];
    current.derived.request_bindings = [
      ...Array.from({ length: 67 }, (_, offset) => requestBindingAudit({
        baseOid: SHA("9"),
        requestId: String(3_000 + offset),
        recordOid: OID(`current-head-history-${offset + 1}`),
        currentIncarnation: false,
      })),
      requestBindingAudit({
        baseOid: current.scope.base_oid,
        requestId: currentRequestId,
        recordOid: currentRecordOid,
        currentIncarnation: true,
      }),
    ];
    resealAuditReceipt(current);

    assert.equal(validateV2ControlPlaneReceipt(current), current);
  });

test("audit validation rejects receipt and derived digest tampering", () => {
  const receiptTamper = structuredClone(serializedAuditReceipt());
  receiptTamper.tip_tree_digest = DIGEST("different-tip-tree");
  assert.throws(
    () => validateV2ControlPlaneReceipt(receiptTamper),
    (error) => error?.code === "RECEIPT_DIGEST_MISMATCH",
  );

  const derivedTamper = structuredClone(serializedAuditReceipt());
  derivedTamper.derived.budget.automatic_reservations_on_head = 1;
  assert.throws(
    () => validateV2ControlPlaneReceipt(derivedTamper),
    (error) => error?.code === "DERIVED_DIGEST_MISMATCH",
  );
});

test("audit validation rejects standalone-head success and cross-repository receipt", () => {
  const status = structuredClone(serializedAuditReceipt());
  status.derived.status_bindings = [statusBindingAudit({ state: "success" })];
  status.derived.derived_digest = canonicalDigest(
    "codex-review-gate-v2-control-plane-derived-facts",
    without(status.derived, "derived_digest"),
  );
  status.receipt_digest = canonicalDigest(
    "codex-review-gate-v2-control-plane-receipt",
    without(status, "receipt_digest"),
  );
  assert.throws(
    () => validateV2ControlPlaneReceipt(status),
    /closed status profile/u,
  );

  const repository = structuredClone(serializedAuditReceipt());
  repository.repository_endpoint_receipt.path = "/repos/attacker/repo";
  repository.receipt_digest = canonicalDigest(
    "codex-review-gate-v2-control-plane-receipt",
    without(repository, "receipt_digest"),
  );
  assert.throws(
    () => validateV2ControlPlaneReceipt(repository),
    /repository_endpoint_receipt\.path/u,
  );
});

test("audit validation accepts only the exact protected status response binding", () => {
  const receipt = structuredClone(serializedAuditReceipt());
  receipt.derived.status_bindings = [statusBindingAudit()];
  receipt.derived.sentinel_binding = structuredClone(
    receipt.derived.status_bindings[0],
  );
  resealAuditReceipt(receipt);
  assert.equal(validateV2ControlPlaneReceipt(receipt), receipt);

  for (const mutate of [
    (binding) => { delete binding.refetch_pages; },
    (binding) => { binding.untrusted = true; },
    (binding) => { binding.refetch_match_count = 2; },
    (binding) => { binding.refetch_pages[0].raw_body_sha256 = DIGEST("forged"); },
  ]) {
    const forged = structuredClone(receipt);
    mutate(forged.derived.status_bindings[0]);
    forged.derived.sentinel_binding = structuredClone(
      forged.derived.status_bindings[0],
    );
    resealAuditReceipt(forged);
    assert.throws(() => validateV2ControlPlaneReceipt(forged));
  }
});

test("serialized aggregate artifact projection preserves canonical binding order and provenance",
  () => {
    const receipt = serializedArtifactAuditReceipt([
      artifactBindingAudit({
        selector: { kind: "pull_request_review", id: "202" },
      }),
      artifactBindingAudit({
        selector: { kind: "inline_comment", id: "203" },
      }),
    ]);

    assert.equal(validateV2ControlPlaneReceipt(receipt), receipt);
    assert.deepEqual(
      receipt.derived.artifact_bindings.map((binding) =>
        binding.artifact_selector),
      [
        { kind: "pull_request_review", id: "202" },
        { kind: "inline_comment", id: "203" },
      ],
    );
    assert.deepEqual(
      receipt.derived.artifact_bindings.map((binding) => binding.record_oid),
      [SHA("7"), SHA("7")],
    );
    assert.deepEqual(
      receipt.derived.artifact_bindings.map((binding) =>
        binding.payload_digest),
      [DIGEST("aggregate-artifact-payload"),
        DIGEST("aggregate-artifact-payload")],
    );
  });

test("serialized artifact projection rejects duplicate and order tampering", () => {
  const receipt = serializedArtifactAuditReceipt([
    artifactBindingAudit({
      selector: { kind: "pull_request_review", id: "202" },
    }),
    artifactBindingAudit({
      selector: { kind: "inline_comment", id: "203" },
    }),
  ]);

  const reordered = structuredClone(receipt);
  reordered.derived.artifact_bindings.reverse();
  assert.throws(
    () => validateV2ControlPlaneReceipt(reordered),
    (error) => error?.code === "DERIVED_DIGEST_MISMATCH",
  );

  const duplicated = structuredClone(receipt);
  duplicated.derived.artifact_bindings[1] = structuredClone(
    duplicated.derived.artifact_bindings[0],
  );
  assert.throws(
    () => validateV2ControlPlaneReceipt(duplicated),
    /artifact binding selectors must be unique/u,
  );
});

test("serialized artifact projection rejects closed-shape and digest violations",
  () => {
    const extraKey = serializedArtifactAuditReceipt([artifactBindingAudit()]);
    extraKey.derived.artifact_bindings[0].untrusted = true;
    resealAuditReceipt(extraKey);
    assert.throws(
      () => validateV2ControlPlaneReceipt(extraKey),
      /derived artifact binding must use the closed key set/u,
    );

    const invalidDigest = serializedArtifactAuditReceipt([
      artifactBindingAudit(),
    ]);
    invalidDigest.derived.artifact_bindings[0].payload_digest = "sha256:invalid";
    resealAuditReceipt(invalidDigest);
    assert.throws(
      () => validateV2ControlPlaneReceipt(invalidDigest),
      /artifact binding\.payload_digest must be a canonical SHA-256 digest/u,
    );

    for (const field of ["generation_id", "request_node_id"]) {
      const missingIdentity = serializedArtifactAuditReceipt([
        artifactBindingAudit(),
      ]);
      missingIdentity.derived.artifact_bindings[0][field] = null;
      resealAuditReceipt(missingIdentity);
      assert.throws(
        () => validateV2ControlPlaneReceipt(missingIdentity),
        new RegExp(`artifact binding\\.${field}`, "u"),
        `${field} is a required closed artifact-binding identity`,
      );
    }

    for (const fixture of [{
      name: "unknown artifact type",
      artifactType: "issue-comment",
      error: /artifact binding\.artifact_type is unsupported/u,
    }, {
      name: "artifact type differs from its selector kind",
      artifactType: "inline_comment",
      error: /artifact binding\.artifact_type must exactly match artifact_selector\.kind/u,
    }]) {
      const tampered = serializedArtifactAuditReceipt([
        artifactBindingAudit(),
      ]);
      tampered.derived.artifact_bindings[0].artifact_type = fixture.artifactType;
      resealAuditReceipt(tampered);
      assert.throws(
        () => validateV2ControlPlaneReceipt(tampered),
        fixture.error,
        fixture.name,
      );
    }
  });

test("serialized artifact bindings join one unique request generation", () => {
  const receipt = serializedArtifactAuditReceipt([artifactBindingAudit()]);
  assert.equal(validateV2ControlPlaneReceipt(receipt), receipt);

  for (const fixture of [{
    name: "request binding record",
    mutate(binding) { binding.request_binding_record_oid = SHA("8"); },
  }, {
    name: "generation",
    mutate(binding) { binding.generation_id = "automatic:2"; },
  }, {
    name: "request identity",
    mutate(binding) { binding.request_node_id = "IC_other"; },
  }]) {
    const tampered = structuredClone(receipt);
    fixture.mutate(tampered.derived.artifact_bindings[0]);
    resealAuditReceipt(tampered);
    assert.throws(
      () => validateV2ControlPlaneReceipt(tampered),
      /unique request binding and generation/u,
      fixture.name,
    );
  }

  const artifactBeforeRequest = structuredClone(receipt);
  artifactBeforeRequest.derived.artifact_bindings[0].artifact_created_at =
    receipt.derived.request_bindings[0].created_at;
  resealAuditReceipt(artifactBeforeRequest);
  assert.throws(
    () => validateV2ControlPlaneReceipt(artifactBeforeRequest),
    /artifact must follow its request/u,
  );

  const duplicatedRequest = structuredClone(receipt);
  duplicatedRequest.derived.request_bindings.push(structuredClone(
    duplicatedRequest.derived.request_bindings[0],
  ));
  resealAuditReceipt(duplicatedRequest);
  assert.throws(
    () => validateV2ControlPlaneReceipt(duplicatedRequest),
    /request binding identities must be unique/u,
  );
});

test("serialized head history keeps its origin base while requiring the current head",
  () => {
    const receipt = structuredClone(serializedAuditReceipt());
    receipt.derived.budget = {
      automatic_reservations_on_head: 1,
      automatic_requests_on_head: 1,
      manual_requests_in_epoch: 0,
    };
    receipt.derived.generations = [generationAudit()];
    receipt.derived.request_bindings = [requestBindingAudit({
      currentIncarnation: false,
    })];
    resealAuditReceipt(receipt);

    assert.equal(validateV2ControlPlaneReceipt(receipt), receipt);
    assert.equal(receipt.derived.generations[0].base_oid, SHA("9"));
    assert.equal(receipt.derived.request_bindings[0].base_oid, SHA("9"));
    assert.equal(receipt.derived.generations[0].head_oid, receipt.scope.head_oid);

    const foreignHead = structuredClone(receipt);
    foreignHead.derived.generations[0].head_oid = SHA("8");
    resealAuditReceipt(foreignHead);
    assert.throws(
      () => validateV2ControlPlaneReceipt(foreignHead),
      /derived generation\.head_oid/u,
    );

    const foreignRequestHead = structuredClone(receipt);
    foreignRequestHead.derived.request_bindings[0].head_oid = SHA("8");
    resealAuditReceipt(foreignRequestHead);
    assert.equal(validateV2ControlPlaneReceipt(foreignRequestHead),
      foreignRequestHead);

    const forgedForeignIncarnation = structuredClone(foreignRequestHead);
    forgedForeignIncarnation.derived.request_bindings[0]
      .current_incarnation = true;
    resealAuditReceipt(forgedForeignIncarnation);
    assert.throws(
      () => validateV2ControlPlaneReceipt(forgedForeignIncarnation),
      /current scope base and head/u,
    );

    const forgedPriorBaseIncarnation = structuredClone(receipt);
    forgedPriorBaseIncarnation.derived.request_bindings[0]
      .current_incarnation = true;
    resealAuditReceipt(forgedPriorBaseIncarnation);
    assert.throws(
      () => validateV2ControlPlaneReceipt(forgedPriorBaseIncarnation),
      /current scope base and head/u,
    );

    const currentBinding = structuredClone(receipt);
    currentBinding.derived.generations[0].base_oid = receipt.scope.base_oid;
    currentBinding.derived.generations[0].review_epoch_digest =
      receipt.scope.review_epoch_digest;
    currentBinding.derived.request_bindings[0].base_oid = receipt.scope.base_oid;
    currentBinding.derived.request_bindings[0].current_incarnation = true;
    resealAuditReceipt(currentBinding);
    assert.equal(validateV2ControlPlaneReceipt(currentBinding), currentBinding);

    const priorPotentialOrigin = structuredClone(currentBinding);
    priorPotentialOrigin.derived.generations[0].review_epoch_digest =
      DIGEST("prior-potential-origin");
    resealAuditReceipt(priorPotentialOrigin);
    assert.equal(
      validateV2ControlPlaneReceipt(priorPotentialOrigin),
      priorPotentialOrigin,
    );

    const repeatedAcrossBase = structuredClone(receipt);
    repeatedAcrossBase.derived.generations.push({
      ...structuredClone(repeatedAcrossBase.derived.generations[0]),
      base_oid: receipt.scope.base_oid,
      review_epoch_digest: DIGEST("repeated-current-review-epoch"),
    });
    resealAuditReceipt(repeatedAcrossBase);
    assert.throws(
      () => validateV2ControlPlaneReceipt(repeatedAcrossBase),
      (error) => error?.code === "GENERATION_ID_INVALID",
    );
  });

test("serialized automatic generation keeps its A origin across a current B binding",
  () => {
    const receipt = structuredClone(serializedAuditReceipt());
    receipt.derived.budget = {
      automatic_reservations_on_head: 1,
      automatic_requests_on_head: 1,
      manual_requests_in_epoch: 0,
    };
    receipt.derived.generations = [generationAudit()];
    receipt.derived.request_bindings = [requestBindingAudit({
      baseOid: receipt.scope.base_oid,
      currentIncarnation: true,
    })];
    resealAuditReceipt(receipt);

    assert.equal(validateV2ControlPlaneReceipt(receipt), receipt);
    assert.equal(receipt.derived.generations[0].base_oid, SHA("9"));
    assert.equal(
      receipt.derived.generations[0].review_epoch_digest,
      DIGEST("origin-review-epoch-1"),
    );
    assert.equal(
      receipt.derived.request_bindings[0].base_oid,
      receipt.scope.base_oid,
    );
    assert.equal(receipt.derived.request_bindings[0].current_incarnation, true);

    for (const fixture of [{
      name: "generation identity",
      mutate(value) {
        value.derived.request_bindings[0].generation_id = "automatic:2";
        value.derived.request_bindings[0].generation_index = 2;
      },
      error: /exact generation reference/u,
    }, {
      name: "binding record",
      mutate(value) {
        value.derived.generations[0].request_binding_record_oid = SHA("8");
      },
      error: /exact generation reference/u,
    }, {
      name: "binding payload",
      mutate(value) {
        value.derived.generations[0].request_binding_payload_digest =
          DIGEST("other-binding-payload");
      },
      error: /exact generation reference/u,
    }, {
      name: "request identity",
      mutate(value) {
        value.derived.generations[0].request_id = "72";
      },
      error: /request binding does not identify/u,
    }, {
      name: "current binding scope",
      mutate(value) {
        value.derived.request_bindings[0].base_oid = SHA("9");
      },
      error: /current scope base and head/u,
    }, {
      name: "generation head",
      mutate(value) {
        value.derived.generations[0].head_oid = SHA("8");
      },
      error: /derived generation\.head_oid/u,
    }]) {
      const tampered = structuredClone(receipt);
      fixture.mutate(tampered);
      resealAuditReceipt(tampered);
      assert.throws(
        () => validateV2ControlPlaneReceipt(tampered),
        fixture.error,
        fixture.name,
      );
    }
  });

test("serialized current manual binding defines its exact generation origin",
  () => {
    const receipt = structuredClone(serializedAuditReceipt());
    const binding = requestBindingAudit({
      generationKind: "manual",
      baseOid: receipt.scope.base_oid,
      currentIncarnation: true,
    });
    const generation = generationAudit({
      baseOid: receipt.scope.base_oid,
      reviewEpochDigest: receipt.scope.review_epoch_digest,
    });
    generation.generation_id = "manual:1";
    generation.kind = "manual";
    generation.reservation_record_oid = null;
    generation.reservation_payload_digest = null;
    generation.reservation_digest = null;
    generation.request_effect_record_oid = null;
    generation.request_effect_payload_digest = null;
    generation.created_request_id = null;
    receipt.derived.budget = {
      automatic_reservations_on_head: 0,
      automatic_requests_on_head: 0,
      manual_requests_in_epoch: 1,
    };
    receipt.derived.generations = [generation];
    receipt.derived.request_bindings = [binding];
    resealAuditReceipt(receipt);

    assert.equal(validateV2ControlPlaneReceipt(receipt), receipt);

    for (const [name, mutate] of [[
      "manual origin base",
      (value) => { value.derived.generations[0].base_oid = SHA("9"); },
    ], [
      "manual origin epoch",
      (value) => {
        value.derived.generations[0].review_epoch_digest =
          DIGEST("prior-manual-epoch");
      },
    ]]) {
      const tampered = structuredClone(receipt);
      mutate(tampered);
      resealAuditReceipt(tampered);
      assert.throws(
        () => validateV2ControlPlaneReceipt(tampered),
        /exact generation reference/u,
        name,
      );
    }
  });

test("serialized recovery bindings use a closed causal v2 projection", () => {
  const receipt = serializedRecoveryAuditReceipt();
  assert.equal(validateV2ControlPlaneReceipt(receipt), receipt);

  const retargetRecovery = structuredClone(receipt);
  const retargetBinding = retargetRecovery.derived.recovery_bindings[0];
  retargetBinding.completion_recovery_authority.scope.base_oid =
    receipt.scope.base_oid;
  retargetBinding.completion_recovery_authority.scope.merge_base_oid =
    receipt.scope.base_oid;
  retargetBinding.completion_recovery_authority.scope_digest = canonicalDigest(
    "codex-review-gate-v2-automatic-recovery-scope",
    retargetBinding.completion_recovery_authority.scope,
  );
  resealRecoveryAuthority(retargetBinding);
  resealRecoveryTransition(retargetBinding);
  resealAuditReceipt(retargetRecovery);
  assert.equal(validateV2ControlPlaneReceipt(retargetRecovery), retargetRecovery);

  const reorderedIncarnation = structuredClone(receipt);
  reorderedIncarnation.derived.request_bindings.reverse();
  resealAuditReceipt(reorderedIncarnation);
  assert.throws(
    () => validateV2ControlPlaneReceipt(reorderedIncarnation),
    /current_incarnation markers must form one ledger suffix/u,
  );

  const extraKey = structuredClone(receipt);
  extraKey.derived.recovery_bindings[0].untrusted = true;
  resealAuditReceipt(extraKey);
  assert.throws(
    () => validateV2ControlPlaneReceipt(extraKey),
    /derived recovery binding must use the closed key set/u,
  );

  const nonCausal = structuredClone(receipt);
  nonCausal.derived.recovery_bindings[0].ledger_order
    .prior_request_binding_index = 1;
  resealAuditReceipt(nonCausal);
  assert.throws(
    () => validateV2ControlPlaneReceipt(nonCausal),
    /strictly causal/u,
  );

  const reorderedClosures = structuredClone(receipt);
  reorderedClosures.derived.recovery_bindings[0]
    .completion_recovery_authority.finding_ids[0] = "finding-other";
  resealRecoveryAuthority(reorderedClosures.derived.recovery_bindings[0]);
  resealAuditReceipt(reorderedClosures);
  assert.throws(
    () => validateV2ControlPlaneReceipt(reorderedClosures),
    /closure ordering/u,
  );

  const missingPrior = structuredClone(receipt);
  missingPrior.derived.request_bindings.shift();
  resealAuditReceipt(missingPrior);
  assert.throws(
    () => validateV2ControlPlaneReceipt(missingPrior),
    /prior request binding/u,
  );
});

test("legacy v1 recovery receipts retain their exact pre-ledger-order shape",
  () => {
    const receipt = serializedRecoveryAuditReceipt();
    receipt.schema_version = 1;
    const recovery = receipt.derived.recovery_bindings[0];
    delete recovery.ledger_index;
    delete recovery.ledger_order;
    delete recovery.next_request_binding_record_oid;
    delete recovery.next_request_id;
    for (const binding of receipt.derived.request_bindings) {
      delete binding.current_incarnation;
    }
    receipt.derived.generations.forEach((generation) => {
      generation.base_oid = receipt.scope.base_oid;
    });
    receipt.derived.request_bindings.forEach((binding) => {
      binding.base_oid = receipt.scope.base_oid;
    });
    recovery.completion_recovery_authority.scope.base_oid =
      receipt.scope.base_oid;
    recovery.completion_recovery_authority.scope.merge_base_oid =
      receipt.scope.base_oid;
    recovery.completion_recovery_authority.scope_digest = canonicalDigest(
      "codex-review-gate-v2-automatic-recovery-scope",
      recovery.completion_recovery_authority.scope,
    );
    resealRecoveryAuthority(recovery);
    resealRecoveryTransition(recovery);
    resealAuditReceipt(receipt);

    assert.equal(validateV2ControlPlaneReceipt(receipt), receipt);

    const v1WithV2Order = structuredClone(receipt);
    v1WithV2Order.derived.recovery_bindings[0].ledger_index = 1;
    resealAuditReceipt(v1WithV2Order);
    assert.throws(
      () => validateV2ControlPlaneReceipt(v1WithV2Order),
      /derived recovery binding must use the closed key set/u,
    );
  });

function serializedAuditReceipt() {
  const derivedInput = {
    budget: {
      automatic_reservations_on_head: 0,
      automatic_requests_on_head: 0,
      manual_requests_in_epoch: 0,
    },
    generations: [],
    recovery_bindings: [],
    request_bindings: [],
    artifact_bindings: [],
    no_start_observations: [],
    thread_resolution_observations: [],
    status_bindings: [],
    sentinel_binding: null,
    control_comment_binding: null,
    sticky_comment_binding: null,
  };
  const derived = {
    ...derivedInput,
    derived_digest: canonicalDigest(
      "codex-review-gate-v2-control-plane-derived-facts",
      derivedInput,
    ),
  };
  const withoutDigest = {
    schema: V2_CONTROL_PLANE_RECEIPT_SCHEMA,
    schema_version: V2_CONTROL_PLANE_RECEIPT_SCHEMA_VERSION,
    repository: {
      owner: "owner",
      name: "repo",
      id: "100",
      node_id: "R_repo",
      owner_id: "200",
    },
    repository_endpoint_receipt: {
      method: "GET",
      path: "/repos/owner/repo",
      status: 200,
      server_time: "2026-08-13T12:00:00.000Z",
      raw_body_sha256: DIGEST("repo-response"),
    },
    ledger_ref: V2_CONTROL_PLANE_LEDGER_REF,
    scope: exactProjectedScope(),
    genesis_oid: SHA("1"),
    tip_oid: SHA("2"),
    tip_tree_digest: DIGEST("tip-tree"),
    ruleset_receipt: { receipt_digest: DIGEST("ruleset") },
    protection_receipt: {
      receipt_digest: DIGEST("protection-receipt"),
      protection_digest: DIGEST("protection"),
    },
    capability_attestation: {
      record_oid: SHA("3"),
      oidc_attestation_digest: DIGEST("oidc-attestation"),
      workflow_provenance_policy_digest: DIGEST("provenance-policy"),
      controller_release_digest: DIGEST("controller-release"),
      provider_identity_policy_catalog_digest: DIGEST("provider-catalog"),
    },
    record_count: 3,
    fully_reachable_record_manifest_digest: DIGEST("manifest"),
    two_pass_reads: {
      pre: {
        read_index: 1,
        ref_oid: SHA("2"),
        server_time: "2026-08-13T12:00:00.000Z",
        raw_body_sha256: DIGEST("pre-ref"),
      },
      post: {
        read_index: 2,
        ref_oid: SHA("2"),
        server_time: "2026-08-13T12:00:01.000Z",
        raw_body_sha256: DIGEST("post-ref"),
      },
      stable: true,
    },
    source_inventory_digest: DIGEST("load-inventory"),
    source_authority_digest: DIGEST("authority"),
    source_binding_digest: DIGEST("binding"),
    provenance_reverification_digest: DIGEST("reverification"),
    derived,
  };
  return {
    ...withoutDigest,
    receipt_digest: canonicalDigest(
      "codex-review-gate-v2-control-plane-receipt",
      withoutDigest,
    ),
  };
}

function exactProjectedScope() {
  return {
    repository_id: "100",
    repository_node_id: "R_repo",
    pull_request_number: 42,
    pull_request_node_id: "PR_node",
    base_oid: SHA("4"),
    head_oid: SHA("5"),
    potential_merge_oid: SHA("6"),
    review_epoch_digest: DIGEST("review-epoch"),
  };
}

function exactLedgerScope() {
  return {
    pull_request: { number: 42, node_id: "PR_node" },
    head_ref_oid: SHA("5"),
    base_ref_oid: SHA("4"),
    potential_merge_commit_oid: SHA("6"),
  };
}

function statusBindingAudit({ state = "pending" } = {}) {
  const page = {
    page: 1,
    http_status: 200,
    server_time: "2026-08-13T12:00:00.000Z",
    raw_body_sha256: DIGEST("status-refetch-page"),
    item_count: 1,
  };
  return {
    record_oid: SHA("8"),
    payload_digest: DIGEST("status-payload"),
    http_status: 201,
    status_id: "18",
    target_sha: SHA("5"),
    role: "head-sentinel",
    context: "codex/github-review-gate",
    state,
    description_digest: DIGEST("status-description"),
    created_at: "2026-08-13T12:00:00.000Z",
    updated_at: "2026-08-13T12:00:00.000Z",
    creator: { login: "github-actions[bot]", type: "Bot" },
    post_server_time: "2026-08-13T12:00:00.000Z",
    post_raw_body_sha256: DIGEST("status-post"),
    refetch_server_time: "2026-08-13T12:00:00.000Z",
    refetch_page_count: 1,
    refetch_item_count: 1,
    refetch_match_count: 1,
    refetch_inventory_digest: canonicalDigest(
      "codex-review-gate-v2-status-refetch-inventory",
      {
        target_sha: SHA("5"),
        status_id: "18",
        pages: [{
          page: page.page,
          raw_body_sha256: page.raw_body_sha256,
          item_count: page.item_count,
        }],
      },
    ),
    refetch_pages: [page],
  };
}

function artifactBindingAudit({
  selector = { kind: "pull_request_review", id: "202" },
} = {}) {
  return {
    record_oid: SHA("7"),
    payload_digest: DIGEST("aggregate-artifact-payload"),
    generation_id: "automatic:1",
    request_binding_record_oid: SHA("c"),
    request_id: "71",
    request_node_id: "IC_71",
    artifact_selector: structuredClone(selector),
    artifact_node_id: `ARTIFACT_${selector.id}`,
    artifact_url:
      `https://github.com/owner/repo/pull/42#artifact-${selector.id}`,
    artifact_type: selector.kind,
    artifact_created_at: "2026-08-13T12:01:00.000Z",
    server_time: "2026-08-13T12:02:00.000Z",
    raw_body_sha256: DIGEST(`artifact-${selector.id}`),
    actor: {
      id: "199175422",
      node_id: "BOT_codex",
      login: "chatgpt-codex-connector[bot]",
      type: "Bot",
    },
    app: {
      id: "1144995",
      node_id: "APP_codex",
      slug: "chatgpt-codex-connector",
    },
  };
}

function serializedArtifactAuditReceipt(bindings) {
  const receipt = structuredClone(serializedAuditReceipt());
  receipt.derived.budget = {
    automatic_reservations_on_head: 1,
    automatic_requests_on_head: 1,
    manual_requests_in_epoch: 0,
  };
  receipt.derived.generations = [generationAudit()];
  receipt.derived.request_bindings = [requestBindingAudit({
    currentIncarnation: false,
  })];
  receipt.derived.artifact_bindings = structuredClone(bindings);
  resealAuditReceipt(receipt);
  return receipt;
}

function generationAudit({
  index = 1,
  baseOid = SHA("9"),
  reviewEpochDigest = DIGEST(`origin-review-epoch-${index}`),
  requestId = "71",
  requestBindingRecordOid = SHA("c"),
  requestCreatedAt = "2026-08-13T12:00:00.000Z",
} = {}) {
  return {
    generation_id: `automatic:${index}`,
    kind: "automatic",
    index,
    review_epoch_digest: reviewEpochDigest,
    base_oid: baseOid,
    head_oid: SHA("5"),
    reservation_record_oid: index === 1 ? SHA("a") : SHA("e"),
    reservation_payload_digest: DIGEST(`reservation-payload-${index}`),
    reservation_digest: DIGEST(`reservation-${index}`),
    request_effect_record_oid: index === 1 ? SHA("b") : SHA("f"),
    request_effect_payload_digest: DIGEST(`request-effect-payload-${index}`),
    created_request_id: requestId,
    request_binding_record_oid: requestBindingRecordOid,
    request_binding_payload_digest:
      DIGEST(`request-binding-payload-${index}`),
    request_id: requestId,
    request_url:
      `https://github.com/owner/repo/pull/42#issuecomment-${requestId}`,
    request_created_at: requestCreatedAt,
  };
}

function requestBindingAudit({
  index = 1,
  generationKind = "automatic",
  baseOid = SHA("9"),
  requestId = "71",
  recordOid = SHA("c"),
  createdAt = "2026-08-13T12:00:00.000Z",
  currentIncarnation = baseOid === SHA("4"),
} = {}) {
  return {
    record_oid: recordOid,
    payload_digest: DIGEST(`request-binding-payload-${index}`),
    generation_id: `${generationKind}:${index}`,
    generation_kind: generationKind,
    generation_index: index,
    base_oid: baseOid,
    head_oid: SHA("5"),
    request_id: requestId,
    request_node_id: `IC_${requestId}`,
    request_url:
      `https://github.com/owner/repo/pull/42#issuecomment-${requestId}`,
    body_sha256: DIGEST(`request-body-${index}`),
    created_at: createdAt,
    updated_at: createdAt,
    raw_body_sha256: DIGEST(`request-raw-body-${index}`),
    actor_id: "15368",
    actor_node_id: "U_actions",
    controlled: true,
    current_incarnation: currentIncarnation,
  };
}

function serializedRecoveryAuditReceipt() {
  const receipt = structuredClone(serializedAuditReceipt());
  receipt.record_count = 3;
  receipt.derived.budget = {
    automatic_reservations_on_head: 2,
    automatic_requests_on_head: 2,
    manual_requests_in_epoch: 0,
  };
  receipt.derived.generations = [
    generationAudit(),
    generationAudit({
      index: 2,
      baseOid: receipt.scope.base_oid,
      reviewEpochDigest: receipt.scope.review_epoch_digest,
      requestId: "72",
      requestBindingRecordOid: SHA("d"),
      requestCreatedAt: "2026-08-13T12:04:00.000Z",
    }),
  ];
  receipt.derived.request_bindings = [
    requestBindingAudit({ currentIncarnation: false }),
    requestBindingAudit({
      index: 2,
      baseOid: receipt.scope.base_oid,
      requestId: "72",
      recordOid: SHA("d"),
      createdAt: "2026-08-13T12:04:00.000Z",
      currentIncarnation: true,
    }),
  ];
  receipt.derived.recovery_bindings = [recoveryBindingAudit()];
  resealAuditReceipt(receipt);
  return receipt;
}

function recoveryBindingAudit() {
  const completion = recoveryAuthorityAudit();
  return {
    record_oid: SHA("7"),
    payload_digest: DIGEST("recovery-transition-payload"),
    ledger_index: 1,
    prior_generation_id: "automatic:1",
    next_generation_id: "automatic:2",
    committed: true,
    recovery_transition_digest: canonicalDigest(
      "codex-review-gate-v2-automatic-request-recovery-transition",
      {
        review_epoch_id: completion.review_epoch_id,
        prior_generation_id: completion.prior_generation_id,
        next_generation_id: completion.next_generation_id,
        prior_request_id: completion.prior_request_id,
        prior_request_binding_record_oid:
          completion.prior_request_binding_record_oid,
        prior_request_binding_receipt_digest:
          completion.prior_request_binding_receipt_digest,
        scope_digest: completion.scope_digest,
      },
    ),
    intent_recovery_authority_digest: DIGEST("intent-recovery-authority"),
    completion_recovery_authority: completion,
    completion_recovery_authority_digest: completion.authority_digest,
    completion_scheduler_observation_record_oid: SHA("8"),
    completion_full_scope_receipt_digest:
      DIGEST("completion-full-scope-receipt"),
    server_time: "2026-08-13T12:03:00.000Z",
    ledger_order: {
      prior_request_binding_index: 0,
      recovery_transition_index: 1,
      next_request_binding_index: 2,
    },
    next_request_binding_record_oid: SHA("d"),
    next_request_id: "72",
  };
}

function recoveryAuthorityAudit() {
  const scope = {
    repository_node_id: "R_repo",
    pull_request_node_id: "PR_node",
    pull_request_number: 42,
    base_oid: SHA("9"),
    head_oid: SHA("5"),
    merge_base_oid: SHA("9"),
  };
  const withoutDigest = {
    schema: "codex-review-gate-automatic-request-recovery-authority-v2",
    schema_version: 1,
    decision: "findings",
    snapshot_fingerprint: DIGEST("recovery-snapshot"),
    review_epoch_id: "review-epoch-1",
    prior_generation_id: "automatic:1",
    prior_generation_index: 1,
    next_generation_id: "automatic:2",
    next_generation_index: 2,
    prior_request_id: "71",
    prior_request_binding_record_oid: SHA("c"),
    prior_request_binding_receipt_digest:
      DIGEST("prior-request-binding-receipt"),
    scope,
    scope_digest: canonicalDigest(
      "codex-review-gate-v2-automatic-recovery-scope",
      scope,
    ),
    finding_ids: ["finding-1"],
    closure_ids: ["closure-1"],
    closure_records: [{
      finding_id: "finding-1",
      finding_kind: "inline",
      finding_artifact_id: "artifact-1",
      finding_server_time: "2026-08-13T12:00:00.000Z",
      closure_id: "closure-1",
      closure_server_time: "2026-08-13T12:01:00.000Z",
      closure_authority_digest: DIGEST("closure-authority"),
    }],
    finding_observed_at: "2026-08-13T12:00:00.000Z",
    closure_observed_at: "2026-08-13T12:01:00.000Z",
    final_snapshot_server_time: "2026-08-13T12:02:00.000Z",
    pagination_sha256: DIGEST("pagination"),
    final_reread_sha256: DIGEST("final-reread"),
    evidence_snapshot_digest: DIGEST("evidence-snapshot"),
    reducer_input_digest: DIGEST("reducer-input"),
    reducer_report_digest: DIGEST("reducer-report"),
    same_review_epoch: true,
  };
  return {
    ...withoutDigest,
    authority_digest: canonicalDigest(
      "codex-review-gate-v2-automatic-request-recovery-authority",
      withoutDigest,
    ),
  };
}

function resealRecoveryAuthority(binding) {
  const authority = binding.completion_recovery_authority;
  authority.authority_digest = canonicalDigest(
    "codex-review-gate-v2-automatic-request-recovery-authority",
    without(authority, "authority_digest"),
  );
  binding.completion_recovery_authority_digest = authority.authority_digest;
}

function resealRecoveryTransition(binding) {
  const completion = binding.completion_recovery_authority;
  binding.recovery_transition_digest = canonicalDigest(
    "codex-review-gate-v2-automatic-request-recovery-transition",
    {
      review_epoch_id: completion.review_epoch_id,
      prior_generation_id: completion.prior_generation_id,
      next_generation_id: completion.next_generation_id,
      prior_request_id: completion.prior_request_id,
      prior_request_binding_record_oid:
        completion.prior_request_binding_record_oid,
      prior_request_binding_receipt_digest:
        completion.prior_request_binding_receipt_digest,
      scope_digest: completion.scope_digest,
    },
  );
}

function resealAuditReceipt(receipt) {
  receipt.derived.derived_digest = canonicalDigest(
    "codex-review-gate-v2-control-plane-derived-facts",
    without(receipt.derived, "derived_digest"),
  );
  receipt.receipt_digest = canonicalDigest(
    "codex-review-gate-v2-control-plane-receipt",
    without(receipt, "receipt_digest"),
  );
}

function without(value, key) {
  const copy = structuredClone(value);
  delete copy[key];
  return copy;
}

function canonicalDigest(domain, value) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0${canonicalJson(value)}`, "utf8")
    .digest("hex")}`;
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" ||
      typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
