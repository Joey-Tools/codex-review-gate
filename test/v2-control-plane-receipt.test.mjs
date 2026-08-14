import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  assertV2ControlPlaneReceiptHandle,
  createV2ControlPlaneReceiptFromGitLedgerAuthority,
  deriveV2ProjectorControlAuthority,
  validateV2ControlPlaneReceipt,
  V2_CONTROL_PLANE_LEDGER_REF,
  V2_CONTROL_PLANE_RECEIPT_SCHEMA,
} from "../packages/action/src/v2/control-plane-receipt.mjs";

const SHA = (character) => character.repeat(40);
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

test("serialized audit receipt validation never grants execution authority", () => {
  const receipt = serializedAuditReceipt();
  assert.equal(validateV2ControlPlaneReceipt(receipt), receipt);
  assert.equal(receipt.schema, V2_CONTROL_PLANE_RECEIPT_SCHEMA);
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
    schema_version: 1,
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
