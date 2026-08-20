import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { setImmediate as scheduleImmediate } from "node:timers";

import {
  MAX_V2_CANDIDATES_PER_SHARD,
  V2CandidateInventoryError,
  createV2GitHubCandidateInventory,
  finalizeV2CandidateInventoryCycle,
  validateV2CandidateCycleReceipt,
  validateV2CandidateInventory,
} from "../packages/action/src/v2/candidate-inventory.mjs";

const requireBuiltin = createRequire(import.meta.url);
const mutableTimers = requireBuiltin("node:timers");

const API = "https://api.github.com";
const GRAPHQL_URL = "https://api.github.com/graphql";
const CUSTOM_GRAPHQL_URL = "https://github.example.test/api/graphql";
const REPOSITORY = Object.freeze({
  owner: "owner",
  name: "repo",
  id: "501",
  node_id: "R_repo",
});
const EXPECTED_CURRENT_OPEN_QUERY = `query CodexReviewGateCurrentOpenPullRequests(
  $owner: String!
  $name: String!
  $after: String
) {
  repository(owner: $owner, name: $name) {
    id
    databaseId
    nameWithOwner
    pullRequests(
      states: OPEN
      orderBy: {field: CREATED_AT, direction: ASC}
      first: 100
      after: $after
    ) {
      nodes {
        id
        fullDatabaseId
        number
        state
        isDraft
        createdAt
        updatedAt
        headRefOid
        headRefName
        baseRefOid
        baseRefName
        headRepository {
          id
          databaseId
          nameWithOwner
        }
        baseRepository {
          id
          databaseId
          nameWithOwner
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}`;

test("state=all inventory closes the 150-item close/reopen page boundary", async () => {
  const candidates = candidateRange(1, 150);
  const fake = fakeGitHub({
    datasets: () => candidates,
    lifecycle: (number) => number === 50 ? "closed" : "open",
  });
  const transport = createTransport(fake.fetch);
  const initial = await transport.scan();

  assert.equal(initial.stable, true);
  assert.equal(initial.candidates.length, 150);
  assert.deepEqual(initial.passes.map(({ pages }) => pages.length), [2, 2]);
  assert.ok(initial.candidates.some(({ number }) => number === 1));
  assert.ok(initial.candidates.some(({ number }) => number === 101));
  assert.ok(fake.calls.every((call) =>
    call.kind !== "list" ||
      (call.state === "all" && call.sort === "created" && call.direction === "asc")));

  const shard = await transport.readShard({ inventory: initial, shard_index: 0 });
  const final = await transport.scan({ prior_inventory: initial });
  const finalShard = await transport.readShard({
    inventory: final,
    shard_index: 0,
  });
  const cycle = finalizeV2CandidateInventoryCycle({
    initial_inventory: initial,
    shard_receipts: [shard],
    final_inventory: final,
    final_shard_receipts: [finalShard],
  });
  assert.deepEqual(validateV2CandidateCycleReceipt(cycle), cycle);
  assert.equal(cycle.open_pull_requests.length, 149);
  assert.equal(cycle.completeness, "bounded-stable-all-open-pull-requests");
  assert.equal(cycle.observed_at, finalShard.observed_at);
  assert.ok(cycle.open_pull_requests.some(({ number }) => number === 101));
  assert.ok(!cycle.open_pull_requests.some(({ number }) => number === 50));
});

test("current-open uses the fixed GraphQL query, cursor chain, and final fence", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  assert.equal(
    candidateInventory.V2_CURRENT_OPEN_PULL_REQUESTS_QUERY,
    EXPECTED_CURRENT_OPEN_QUERY,
  );
  const fake = fakeGraphQL({ datasets: () => candidateRange(1, 512) });
  const inventory = await createCurrentOpen(candidateInventory, fake).scan();

  assert.equal(inventory.schema_version, 4);
  assert.equal(inventory.graphql_url, GRAPHQL_URL);
  assert.equal(inventory.api_version, "2022-11-28");
  assert.equal(inventory.query, EXPECTED_CURRENT_OPEN_QUERY);
  assert.equal(
    inventory.completeness,
    "bounded-stable-sampled-current-open-net-set",
  );
  assert.equal(inventory.current_open_pull_requests.length, 512);
  assert.deepEqual(inventory.passes.map(({ pages }) => pages.length), [6, 6]);
  assert.deepEqual(
    inventory.passes.map(({ pages }) => pages.map(({ item_count }) => item_count)),
    [
      [100, 100, 100, 100, 100, 12],
      [100, 100, 100, 100, 100, 12],
    ],
  );
  assert.ok(inventory.passes.every((pass) =>
    pass.observation_window.started_at === pass.pages[0].server_time &&
    pass.observation_window.completed_at === pass.final_fence.server_time));
  for (const pass of [1, 2]) {
    const calls = fake.calls.filter((call) => call.pass === pass);
    assert.equal(calls.length, 7);
    assert.deepEqual(calls.map(({ kind }) => kind),
      ["page", "page", "page", "page", "page", "page", "fence"]);
    assert.equal(calls[0].variables.after, null);
    assert.equal(calls.at(-1).variables.after, null);
    for (let index = 1; index < 6; index += 1) {
      assert.equal(
        calls[index].variables.after,
        inventory.passes[pass - 1].pages[index - 1].end_cursor,
      );
    }
  }
  assert.ok(fake.calls.every((call) =>
    call.method === "POST" &&
    call.url === GRAPHQL_URL &&
    call.api_version === "2022-11-28" &&
    call.query === EXPECTED_CURRENT_OPEN_QUERY &&
    call.variables.owner === REPOSITORY.owner &&
    call.variables.name === REPOSITORY.name));
});

test("current-open GraphQL admits 512 and rejects 513 or a sixth-page successor", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  for (const count of [513, 512]) {
    const fake = fakeGraphQL({
      datasets: () => candidateRange(1, count),
      pageInfoProjection: count === 512
        ? ({ kind, page, pageInfo }) => kind === "page" && page === 6
          ? { ...pageInfo, hasNextPage: true, endCursor: "opaque:future" }
          : pageInfo
        : undefined,
    });
    await assert.rejects(
      createCurrentOpen(candidateInventory, fake).scan(),
      (error) => error.code === "CANDIDATE_OPEN_SET_CAP",
    );
    assert.equal(fake.calls.some(({ kind }) => kind === "fence"), false);
  }
});

test("current-open GraphQL rejects missing, repeated, and malformed cursor authority", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  const faults = [
    ({ kind, page, pageInfo }) => kind === "page" && page === 1
      ? { ...pageInfo, endCursor: null }
      : pageInfo,
    ({ kind, page, pageInfo, inputCursor }) => kind === "page" && page === 2
      ? { ...pageInfo, endCursor: inputCursor }
      : pageInfo,
    ({ kind, page, pageInfo }) => kind === "page" && page === 1
      ? { ...pageInfo, endCursor: "" }
      : pageInfo,
  ];
  for (const pageInfoProjection of faults) {
    const fake = fakeGraphQL({
      datasets: () => candidateRange(1, 250),
      pageInfoProjection,
    });
    await assert.rejects(
      createCurrentOpen(candidateInventory, fake).scan(),
      (error) => error.code === "CANDIDATE_PAGINATION_INVALID",
    );
  }
});

test("current-open GraphQL final fence rejects first-page or pageInfo drift", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  for (const fenceProjection of [
    ({ response }) => {
      response.data.repository.pullRequests.nodes[0].updatedAt =
        "2026-08-13T13:00:00.000Z";
      return response;
    },
    ({ response }) => {
      response.data.repository.pullRequests.pageInfo.endCursor =
        "opaque:fence-drift";
      return response;
    },
  ]) {
    const fake = fakeGraphQL({
      datasets: () => candidateRange(1, 101),
      fenceProjection,
    });
    await assert.rejects(
      createCurrentOpen(candidateInventory, fake).scan(),
      (error) => error.code === "CANDIDATE_OPEN_SET_DRIFT",
    );
  }
});

test("current-open durable replay binds custom GraphQL URL, raw bodies, and limits", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  const fake = fakeGraphQL({
    graphqlUrl: CUSTOM_GRAPHQL_URL,
    datasets: (pass) => candidateRange(1, pass === 1 ? 101 : 102),
  });
  const factory = createCurrentOpen(candidateInventory, fake, {
    graphqlUrl: CUSTOM_GRAPHQL_URL,
  });
  const inventory = await factory.scan();
  const projection = factory.projectForGitLedger(inventory);

  assert.equal(projection.schema_version, 4);
  assert.equal(projection.graphql_url, CUSTOM_GRAPHQL_URL);
  assert.equal(projection.api_version, "2022-11-28");
  assert.equal(projection.query, EXPECTED_CURRENT_OPEN_QUERY);
  assert.equal(projection.factory_epoch, inventory.factory_epoch);
  assert.equal(projection.ref_fence, null);
  assert.equal(projection.ref_fence_assurance, "not-bound-by-inventory");
  assert.deepEqual(projection.effective_limits, inventory.effective_limits);
  assert.equal(projection.raw_passes.length, 3);
  assert.deepEqual(
    projection.raw_passes.map(({ pass, pages }) => [pass, pages.length]),
    [[1, 2], [2, 2], [3, 2]],
  );
  assert.equal(
    projection.effective_limits.max_response_bytes,
    candidateInventory.MAX_V2_CURRENT_OPEN_CANDIDATE_RESPONSE_BYTES,
  );
  assert.equal(
    projection.effective_limits.max_response_chunks,
    candidateInventory.MAX_V2_CANDIDATE_RESPONSE_CHUNKS,
  );
  for (const rawPass of projection.raw_passes) {
    for (const artifact of [...rawPass.pages, rawPass.final_fence]) {
      const requestBytes = Buffer.from(artifact.request_body_base64, "base64");
      const responseBytes = Buffer.from(artifact.response_body_base64, "base64");
      const request = JSON.parse(requestBytes.toString("utf8"));
      assert.equal(request.query, EXPECTED_CURRENT_OPEN_QUERY);
      assert.equal(rawSha256(requestBytes), artifact.receipt.request_body_sha256);
      assert.equal(rawSha256(responseBytes), artifact.receipt.raw_body_sha256);
      assert.equal(artifact.receipt.url, CUSTOM_GRAPHQL_URL);
      assert.equal(artifact.receipt.method, "POST");
      assert.equal(artifact.receipt.api_version, "2022-11-28");
    }
  }
  const durable = structuredClone(projection);
  assert.deepEqual(
    candidateInventory
      .validateV2CurrentOpenCandidateInventoryGitLedgerProjection(
        durable,
        REPOSITORY,
      ),
    durable,
  );

  const tamperedBody = structuredClone(projection);
  tamperedBody.raw_passes[1].pages[0].response_body_base64 =
    Buffer.from('{"data":null}', "utf8").toString("base64");
  assert.throws(
    () => candidateInventory
      .validateV2CurrentOpenCandidateInventoryGitLedgerProjection(
        tamperedBody,
        REPOSITORY,
      ),
    /raw body digest/u,
  );
  const changedUrl = structuredClone(projection);
  changedUrl.graphql_url = GRAPHQL_URL;
  assert.throws(
    () => candidateInventory
      .validateV2CurrentOpenCandidateInventoryGitLedgerProjection(
        changedUrl,
        REPOSITORY,
    ),
    /GraphQL URL/u,
  );
  const changedApiVersion = structuredClone(projection);
  changedApiVersion.api_version = "2021-01-01";
  assert.throws(
    () => candidateInventory
      .validateV2CurrentOpenCandidateInventoryGitLedgerProjection(
        changedApiVersion,
        REPOSITORY,
      ),
    /API version/u,
  );
  for (const mutateRequest of [
    (request) => {
      request.query = request.query.replace("first: 100", "first: 99");
    },
    (request) => {
      request.variables.owner = "another-owner";
    },
  ]) {
    const forgedRequest = structuredClone(projection);
    const artifact = forgedRequest.raw_passes[0].pages[0];
    const request = JSON.parse(
      Buffer.from(artifact.request_body_base64, "base64").toString("utf8"),
    );
    mutateRequest(request);
    const requestBytes = Buffer.from(JSON.stringify(request), "utf8");
    const digest = rawSha256(requestBytes);
    artifact.request_body_base64 = requestBytes.toString("base64");
    artifact.receipt.request_body_sha256 = digest;
    forgedRequest.receipt.passes[0].pages[0].request_body_sha256 = digest;
    const { receipt_digest: _digest, ...receiptWithoutDigest } =
      forgedRequest.receipt;
    forgedRequest.receipt.receipt_digest = canonicalDigest(
      "codex-review-gate-v2-current-open-candidate-inventory",
      receiptWithoutDigest,
    );
    assert.throws(
      () => candidateInventory
        .validateV2CurrentOpenCandidateInventoryGitLedgerProjection(
          forgedRequest,
          REPOSITORY,
        ),
      /fixed query|request body digest/u,
    );
  }
  const changedLimits = structuredClone(projection);
  changedLimits.effective_limits.max_response_bytes -= 1;
  assert.throws(
    () => candidateInventory
      .validateV2CurrentOpenCandidateInventoryGitLedgerProjection(
        changedLimits,
        REPOSITORY,
      ),
    /effective.*limits/u,
  );
  const changedTightLimit = structuredClone(projection);
  changedTightLimit.effective_limits.timeout_ms -= 1;
  assert.throws(
    () => candidateInventory
      .validateV2CurrentOpenCandidateInventoryGitLedgerProjection(
        changedTightLimit,
        REPOSITORY,
      ),
    /effective limits differ/u,
  );
  for (const [field, tightened] of [
    ["max_passes", 2],
    ["max_pages", 1],
  ]) {
    const forgedTightReceipt = structuredClone(projection.receipt);
    forgedTightReceipt.effective_limits[field] = tightened;
    forgedTightReceipt.effective_limits.max_requests =
      forgedTightReceipt.effective_limits.max_passes *
      (forgedTightReceipt.effective_limits.max_pages + 1);
    const { receipt_digest: _receiptDigest, ...receiptWithoutDigest } =
      forgedTightReceipt;
    forgedTightReceipt.receipt_digest = canonicalDigest(
      "codex-review-gate-v2-current-open-candidate-inventory",
      receiptWithoutDigest,
    );
    assert.throws(
      () => candidateInventory.validateV2CurrentOpenCandidateInventory(
        forgedTightReceipt,
        REPOSITORY,
      ),
      /bounded stable passes|pass is outside its bounds/u,
    );
  }
  for (const mutateBoundary of [
    (value) => {
      const replacement = value.factory_epoch.endsWith("f") ? "e" : "f";
      value.factory_epoch = `${value.factory_epoch.slice(0, -1)}${replacement}`;
    },
    (value) => {
      value.ref_fence = { target_commit_sha: "a".repeat(40) };
    },
    (value) => {
      value.producer_assurance = "self-authenticated-http-replay";
    },
  ]) {
    const changedBoundary = structuredClone(projection);
    mutateBoundary(changedBoundary);
    assert.throws(
      () => candidateInventory
        .validateV2CurrentOpenCandidateInventoryGitLedgerProjection(
          changedBoundary,
          REPOSITORY,
        ),
      /producer boundary|projection schema/u,
    );
  }
});

test("current-open collection fence rejects cached scan reprojection", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  const fake = fakeGraphQL({ datasets: () => [] });
  const factory = createCurrentOpen(candidateInventory, fake);
  const cachedReceipt = await factory.scan();
  const staleFence = candidateInventory
    .createV2CurrentOpenCandidateInventoryCollectionFence();
  const reprojected = factory.projectForGitLedger(cachedReceipt);
  assert.throws(
    () => candidateInventory
      .assertV2CurrentOpenCandidateInventoryProjectionAfterFence(
        reprojected,
        staleFence,
      ),
    (error) =>
      error.code === "STALE_CURRENT_OPEN_INVENTORY_PROJECTION_HANDLE",
  );

  const inFlightFake = fakeGraphQL({ datasets: () => [] });
  let releaseFirstResponse;
  let markFirstResponseStarted;
  const firstResponseStarted = new Promise((resolve) => {
    markFirstResponseStarted = resolve;
  });
  const firstResponseReleased = new Promise((resolve) => {
    releaseFirstResponse = resolve;
  });
  let blockedFirstResponse = false;
  const inFlightFactory = createCurrentOpen(candidateInventory, {
    fetch: async (...args) => {
      const response = await inFlightFake.fetch(...args);
      if (!blockedFirstResponse) {
        blockedFirstResponse = true;
        markFirstResponseStarted();
        await firstResponseReleased;
      }
      return response;
    },
  });
  const inFlightScan = inFlightFactory.scan();
  await firstResponseStarted;
  const inFlightFence = candidateInventory
    .createV2CurrentOpenCandidateInventoryCollectionFence();
  releaseFirstResponse();
  const inFlightReceipt = await inFlightScan;
  const inFlightProjection = inFlightFactory.projectForGitLedger(
    inFlightReceipt,
  );
  assert.throws(
    () => candidateInventory
      .assertV2CurrentOpenCandidateInventoryProjectionAfterFence(
        inFlightProjection,
        inFlightFence,
      ),
    (error) =>
      error.code === "STALE_CURRENT_OPEN_INVENTORY_PROJECTION_HANDLE",
  );

  const freshFence = candidateInventory
    .createV2CurrentOpenCandidateInventoryCollectionFence();
  const freshReceipt = await factory.scan();
  const freshProjection = factory.projectForGitLedger(freshReceipt);
  assert.equal(
    candidateInventory
      .assertV2CurrentOpenCandidateInventoryProjectionAfterFence(
        freshProjection,
        freshFence,
      ),
    freshProjection,
  );
  assert.throws(
    () => candidateInventory
      .assertV2CurrentOpenCandidateInventoryProjectionAfterFence(
        freshProjection,
        freshFence,
      ),
    (error) => error.code === "CONSUMED_CURRENT_OPEN_COLLECTION_FENCE",
  );
  assert.throws(
    () => candidateInventory
      .assertV2CurrentOpenCandidateInventoryProjectionAfterFence(
        freshProjection,
        structuredClone(freshFence),
      ),
    (error) => error.code === "UNTRUSTED_CURRENT_OPEN_COLLECTION_FENCE",
  );
});

test("current-open durable projection rejects sparse arrays", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  const fake = fakeGraphQL({ datasets: () => [] });
  const factory = createCurrentOpen(candidateInventory, fake);
  const inventory = await factory.scan();
  const projection = factory.projectForGitLedger(inventory);
  assert.deepEqual(projection.semantic_projection, []);

  const sparse = structuredClone(projection);
  sparse.semantic_projection = Array(1);
  assert.throws(
    () => candidateInventory
      .validateV2CurrentOpenCandidateInventoryGitLedgerProjection(
        sparse,
        REPOSITORY,
      ),
    /dense|semantic projection/u,
  );
});

test("current-open projector is factory-bound and declares its replay trust boundary", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  const ownerFake = fakeGraphQL({ datasets: () => candidateRange(1, 2) });
  const ownerFactory = createCurrentOpen(candidateInventory, ownerFake);
  const inventory = await ownerFactory.scan();
  const callsAfterScan = ownerFake.calls.length;
  const projection = ownerFactory.projectForGitLedger(inventory);

  assert.equal(
    candidateInventory
      .assertV2CurrentOpenCandidateInventoryGitLedgerProjectionHandle(
        projection,
      ),
    projection,
  );
  const weakMapGetDescriptor = Object.getOwnPropertyDescriptor(
    WeakMap.prototype,
    "get",
  );
  const weakMapSetDescriptor = Object.getOwnPropertyDescriptor(
    WeakMap.prototype,
    "set",
  );
  Object.defineProperties(WeakMap.prototype, {
    get: {
      ...weakMapGetDescriptor,
      value() { throw new Error("poisoned WeakMap.get"); },
    },
    set: {
      ...weakMapSetDescriptor,
      value() { throw new Error("poisoned WeakMap.set"); },
    },
  });
  try {
    const poisonedProjection = ownerFactory.projectForGitLedger(inventory);
    assert.equal(
      candidateInventory
        .assertV2CurrentOpenCandidateInventoryGitLedgerProjectionHandle(
          poisonedProjection,
        ),
      poisonedProjection,
    );
  } finally {
    Object.defineProperties(WeakMap.prototype, {
      get: weakMapGetDescriptor,
      set: weakMapSetDescriptor,
    });
  }

  assert.equal(inventory.schema_version, 4);
  assert.equal(projection.schema_version, 4);
  assert.match(inventory.factory_epoch, /^current-open-factory:[0-9a-f]{64}$/u);
  assert.equal(projection.factory_epoch, inventory.factory_epoch);
  assert.equal(
    inventory.producer_assurance,
    "authenticated-producer-internal-consistency-replay",
  );
  assert.equal(projection.producer_assurance, inventory.producer_assurance);
  assert.equal(inventory.ref_fence, null);
  assert.equal(projection.ref_fence, null);
  assert.equal(inventory.ref_fence_assurance, "not-bound-by-inventory");
  assert.equal(projection.ref_fence_assurance, inventory.ref_fence_assurance);
  assert.deepEqual(projection.effective_limits, inventory.effective_limits);
  assert.equal(ownerFake.calls.length, callsAfterScan, "projection is zero-I/O");

  const foreignFake = fakeGraphQL({ datasets: () => candidateRange(1, 2) });
  const foreignFactory = createCurrentOpen(candidateInventory, foreignFake);
  const foreignInventory = await foreignFactory.scan();
  const foreignCallsAfterScan = foreignFake.calls.length;
  const foreignModule = await import(
    "../packages/action/src/v2/candidate-inventory.mjs?foreign-projection-brand"
  );
  const foreignModuleFake = fakeGraphQL({
    datasets: () => candidateRange(1, 2),
  });
  const foreignModuleFactory = createCurrentOpen(
    foreignModule,
    foreignModuleFake,
  );
  const foreignModuleInventory = await foreignModuleFactory.scan();
  const foreignModuleProjection = foreignModuleFactory.projectForGitLedger(
    foreignModuleInventory,
  );
  const foreignModuleCallsAfterScan = foreignModuleFake.calls.length;
  assert.equal(
    foreignInventory.current_open_semantic_digest,
    inventory.current_open_semantic_digest,
  );
  assert.notEqual(foreignInventory.factory_epoch, inventory.factory_epoch);
  for (const forged of [structuredClone(inventory), { ...inventory }]) {
    assert.throws(
      () => ownerFactory.projectForGitLedger(forged),
      (error) => error.code === "UNTRUSTED_CURRENT_OPEN_INVENTORY_HANDLE",
    );
  }
  assert.throws(
    () => foreignFactory.projectForGitLedger(inventory),
    (error) => error.code === "UNTRUSTED_CURRENT_OPEN_INVENTORY_HANDLE",
  );
  assert.throws(
    () => ownerFactory.projectForGitLedger(foreignInventory),
    (error) => error.code === "UNTRUSTED_CURRENT_OPEN_INVENTORY_HANDLE",
  );
  assert.throws(
    () => candidateInventory.projectV2CurrentOpenCandidateInventoryForGitLedger(
      inventory,
      REPOSITORY,
    ),
    (error) => error.code === "UNTRUSTED_CURRENT_OPEN_INVENTORY_HANDLE",
  );
  for (const untrusted of [
    inventory,
    structuredClone(projection),
    foreignModuleProjection,
    candidateInventory
      .validateV2CurrentOpenCandidateInventoryGitLedgerProjection(
        structuredClone(projection),
        REPOSITORY,
      ),
  ]) {
    assert.throws(
      () => candidateInventory
        .assertV2CurrentOpenCandidateInventoryGitLedgerProjectionHandle(
          untrusted,
        ),
      (error) =>
        error.code === "UNTRUSTED_CURRENT_OPEN_INVENTORY_PROJECTION_HANDLE",
    );
  }
  assert.equal(ownerFake.calls.length, callsAfterScan);
  assert.equal(foreignFake.calls.length, foreignCallsAfterScan);
  assert.equal(foreignModuleFake.calls.length, foreignModuleCallsAfterScan);
});

test("production current-open authority closes the canonical 512-candidate summary", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  assert.equal(
    candidateInventory.V2_LEGACY_STATE_ALL_CANDIDATE_INVENTORY_USE,
    "non-production-finish-only",
  );
  assert.equal(
    candidateInventory.V2_CURRENT_OPEN_PRODUCTION_CANDIDATE_AUTHORITY_SCHEMA,
    "codex-review-gate-current-open-production-candidate-authority-v2",
  );

  const fake = fakeGraphQL({ datasets: () => candidateRange(1, 512) });
  const factory = createCurrentOpen(candidateInventory, fake);
  const inventory = await factory.scan();
  const sourceProjection = factory.projectForGitLedger(inventory);
  const callsAfterProjection = fake.calls.length;
  const authority = factory.projectProductionCandidateAuthority(
    sourceProjection,
  );

  assert.deepEqual(Object.keys(authority).sort(), [
    "authority_class",
    "authority_digest",
    "candidate_count",
    "candidate_set_digest",
    "candidates",
    "repository",
    "schema",
    "schema_version",
    "source_current_open_semantic_digest",
  ]);
  assert.equal(authority.schema,
    candidateInventory.V2_CURRENT_OPEN_PRODUCTION_CANDIDATE_AUTHORITY_SCHEMA);
  assert.equal(authority.schema_version, 1);
  assert.equal(authority.authority_class, "production-current-open-net-set");
  assert.deepEqual(authority.repository, REPOSITORY);
  assert.equal(authority.candidate_count, 512);
  assert.equal(authority.candidates.length, 512);
  assert.equal(
    authority.source_current_open_semantic_digest,
    inventory.current_open_semantic_digest,
  );
  assert.deepEqual(Object.keys(authority.candidates[0]).sort(), [
    "identity",
    "identity_digest",
    "lifecycle_seed",
    "lifecycle_seed_digest",
  ]);
  assert.deepEqual(authority.candidates[0].identity, candidate(1));
  assert.deepEqual(Object.keys(authority.candidates[0].lifecycle_seed).sort(), [
    "base", "draft", "head", "state", "updated_at",
  ]);
  assert.equal(authority.candidates[0].lifecycle_seed.state, "open");
  assert.equal(
    authority.candidates[0].identity_digest,
    canonicalDigest(
      "codex-review-gate-v2-production-candidate-identity",
      authority.candidates[0].identity,
    ),
  );
  assert.equal(
    authority.candidates[0].lifecycle_seed_digest,
    canonicalDigest(
      "codex-review-gate-v2-production-candidate-lifecycle-seed",
      {
        identity: authority.candidates[0].identity,
        lifecycle_seed: authority.candidates[0].lifecycle_seed,
      },
    ),
  );
  assert.equal(
    authority.candidate_set_digest,
    canonicalDigest(
      "codex-review-gate-v2-production-current-open-candidate-set",
      authority.candidates,
    ),
  );
  const { authority_digest: _authorityDigest, ...withoutAuthorityDigest } =
    authority;
  assert.equal(
    authority.authority_digest,
    canonicalDigest(
      "codex-review-gate-v2-current-open-production-candidate-authority",
      withoutAuthorityDigest,
    ),
  );
  assert.equal(Object.hasOwn(authority, "receipt"), false);
  assert.equal(Object.hasOwn(authority, "raw_passes"), false);
  assert.equal(Object.hasOwn(authority, "factory_epoch"), false);
  assert.equal(Object.hasOwn(authority, "generation"), false);
  assert.ok(Object.isFrozen(authority));
  assert.ok(Object.isFrozen(authority.candidates));
  assert.ok(Object.isFrozen(authority.candidates[0]));
  assert.ok(Object.isFrozen(authority.candidates[0].lifecycle_seed.head.repo));
  assert.equal(
    candidateInventory
      .assertV2CurrentOpenProductionCandidateAuthorityHandle(
        authority,
        sourceProjection,
      ),
    authority,
  );
  assert.equal(fake.calls.length, callsAfterProjection, "upgrade is zero-I/O");
});

test("production current-open authority is one-shot, same-factory, and never offline-minted", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  assert.equal(
    Object.hasOwn(
      candidateInventory,
      "projectV2CurrentOpenProductionCandidateAuthority",
    ),
    false,
    "there is no raw caller minter",
  );
  const ownerFake = fakeGraphQL({ datasets: () => candidateRange(1, 2) });
  const ownerFactory = createCurrentOpen(candidateInventory, ownerFake);
  const ownerInventory = await ownerFactory.scan();
  const sourceProjection = ownerFactory.projectForGitLedger(ownerInventory);
  const callsAfterProjection = ownerFake.calls.length;

  const poisonedInputs = [
    structuredClone(sourceProjection),
    { ...sourceProjection },
  ];
  const accessor = structuredClone(sourceProjection);
  Object.defineProperty(accessor, "schema", {
    enumerable: true,
    get() { throw new Error("projector read an untrusted accessor"); },
  });
  poisonedInputs.push(accessor);
  const symbol = structuredClone(sourceProjection);
  symbol[Symbol("unexpected-production-source")] = true;
  poisonedInputs.push(symbol);
  const nonenumerable = structuredClone(sourceProjection);
  Object.defineProperty(nonenumerable, "unexpected", { value: true });
  poisonedInputs.push(nonenumerable);
  for (const poisoned of poisonedInputs) {
    assert.throws(
      () => ownerFactory.projectProductionCandidateAuthority(poisoned),
      (error) =>
        error.code === "UNTRUSTED_CURRENT_OPEN_PRODUCTION_AUTHORITY_SOURCE",
    );
  }
  assert.equal(ownerFake.calls.length, callsAfterProjection);

  const foreignFake = fakeGraphQL({ datasets: () => candidateRange(1, 2) });
  const foreignFactory = createCurrentOpen(candidateInventory, foreignFake);
  const foreignInventory = await foreignFactory.scan();
  const foreignProjection = foreignFactory.projectForGitLedger(
    foreignInventory,
  );
  assert.throws(
    () => ownerFactory.projectProductionCandidateAuthority(foreignProjection),
    (error) =>
      error.code === "UNTRUSTED_CURRENT_OPEN_PRODUCTION_AUTHORITY_SOURCE",
  );

  const authority = ownerFactory.projectProductionCandidateAuthority(
    sourceProjection,
  );
  assert.throws(
    () => ownerFactory.projectProductionCandidateAuthority(sourceProjection),
    (error) => error.code === "CONSUMED_CURRENT_OPEN_PRODUCTION_AUTHORITY_SOURCE",
  );
  const offline = candidateInventory
    .validateV2CurrentOpenProductionCandidateAuthority(
      structuredClone(authority),
      REPOSITORY,
    );
  assert.ok(Object.isFrozen(offline));
  assert.deepEqual(offline, authority);
  assert.notEqual(offline, authority);
  for (const untrusted of [structuredClone(authority), offline]) {
    assert.throws(
      () => candidateInventory
        .assertV2CurrentOpenProductionCandidateAuthorityHandle(
          untrusted,
          sourceProjection,
        ),
      (error) =>
        error.code === "UNTRUSTED_CURRENT_OPEN_PRODUCTION_AUTHORITY_HANDLE",
    );
  }

  const staleFake = fakeGraphQL({ datasets: () => candidateRange(1, 2) });
  const staleFactory = createCurrentOpen(candidateInventory, staleFake);
  const staleReceipt = await staleFactory.scan();
  const staleProjection = staleFactory.projectForGitLedger(staleReceipt);
  const currentReceipt = await staleFactory.scan();
  const currentProjection = staleFactory.projectForGitLedger(currentReceipt);
  assert.throws(
    () => staleFactory.projectProductionCandidateAuthority(staleProjection),
    (error) =>
      error.code === "STALE_CURRENT_OPEN_PRODUCTION_AUTHORITY_SOURCE",
  );
  const currentAuthority = staleFactory.projectProductionCandidateAuthority(
    currentProjection,
  );
  assert.equal(
    candidateInventory
      .assertV2CurrentOpenProductionCandidateAuthorityHandle(
        currentAuthority,
        currentProjection,
      ),
    currentAuthority,
  );
  assert.equal(ownerFake.calls.length, callsAfterProjection);
});

test("production current-open live admission requires its exact source projection pair", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  const leftFake = fakeGraphQL({ datasets: () => candidateRange(1, 2) });
  const rightFake = fakeGraphQL({ datasets: () => candidateRange(1, 2) });
  const leftFactory = createCurrentOpen(candidateInventory, leftFake);
  const rightFactory = createCurrentOpen(candidateInventory, rightFake);
  const leftReceipt = await leftFactory.scan();
  const rightReceipt = await rightFactory.scan();
  const leftProjection = leftFactory.projectForGitLedger(leftReceipt);
  const leftSiblingProjection = leftFactory.projectForGitLedger(leftReceipt);
  const rightProjection = rightFactory.projectForGitLedger(rightReceipt);
  const leftAuthority = leftFactory.projectProductionCandidateAuthority(
    leftProjection,
  );
  const rightAuthority = rightFactory.projectProductionCandidateAuthority(
    rightProjection,
  );
  assert.deepEqual(leftAuthority, rightAuthority,
    "equivalent factories intentionally publish equal durable summaries");

  for (const [authority, wrongProjection] of [
    [leftAuthority, rightProjection],
    [rightAuthority, leftProjection],
    [leftAuthority, leftSiblingProjection],
    [leftAuthority, structuredClone(leftProjection)],
    [leftAuthority, null],
  ]) {
    assert.throws(
      () => candidateInventory
        .consumeV2CurrentOpenProductionCandidateAuthorityHandle(
          authority,
          wrongProjection,
        ),
      (error) =>
        error.code === "UNTRUSTED_CURRENT_OPEN_PRODUCTION_AUTHORITY_PAIR",
    );
  }
  assert.equal(
    candidateInventory
      .consumeV2CurrentOpenProductionCandidateAuthorityHandle(
        leftAuthority,
        leftProjection,
      ),
    leftAuthority,
    "failed cross-pair attempts do not consume the correct live pair",
  );
  assert.equal(
    candidateInventory
      .consumeV2CurrentOpenProductionCandidateAuthorityHandle(
        rightAuthority,
        rightProjection,
      ),
    rightAuthority,
  );
});

test("production current-open live admission is one-shot and revoked when the next scan begins", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );

  const consumedFake = fakeGraphQL({ datasets: () => candidateRange(1, 1) });
  const consumedFactory = createCurrentOpen(candidateInventory, consumedFake);
  const consumedReceipt = await consumedFactory.scan();
  const consumedProjection = consumedFactory.projectForGitLedger(
    consumedReceipt,
  );
  const consumedAuthority = consumedFactory
    .projectProductionCandidateAuthority(consumedProjection);
  const consumedCalls = consumedFake.calls.length;
  assert.equal(
    candidateInventory
      .consumeV2CurrentOpenProductionCandidateAuthorityHandle(
        consumedAuthority,
        consumedProjection,
      ),
    consumedAuthority,
  );
  assert.throws(
    () => candidateInventory
      .consumeV2CurrentOpenProductionCandidateAuthorityHandle(
        consumedAuthority,
        consumedProjection,
      ),
    (error) =>
      error.code === "CONSUMED_CURRENT_OPEN_PRODUCTION_AUTHORITY_HANDLE",
  );
  assert.equal(consumedFake.calls.length, consumedCalls);

  const inner = fakeGraphQL({ datasets: () => candidateRange(1, 1) });
  let blockNext = false;
  let releaseBlocked = null;
  let markBlockedStarted = null;
  let blockedStarted = null;
  const fake = {
    calls: inner.calls,
    fetch(input, init) {
      if (!blockNext) return inner.fetch(input, init);
      blockNext = false;
      markBlockedStarted();
      return new Promise((resolve, reject) => {
        releaseBlocked = () => {
          Promise.resolve(inner.fetch(input, init)).then(resolve, reject);
        };
      });
    },
  };
  const factory = createCurrentOpen(candidateInventory, fake);
  const firstReceipt = await factory.scan();
  const firstProjection = factory.projectForGitLedger(firstReceipt);
  const firstAuthority = factory.projectProductionCandidateAuthority(
    firstProjection,
  );
  const callsBeforeSecondScan = inner.calls.length;
  blockedStarted = new Promise((resolve) => {
    markBlockedStarted = resolve;
  });
  blockNext = true;
  const secondScan = factory.scan();
  await blockedStarted;
  assert.equal(inner.calls.length, callsBeforeSecondScan,
    "the next scan is blocked before its first adapter response");
  assert.throws(
    () => candidateInventory
      .consumeV2CurrentOpenProductionCandidateAuthorityHandle(
        firstAuthority,
        firstProjection,
      ),
    (error) =>
      error.code === "STALE_CURRENT_OPEN_PRODUCTION_AUTHORITY_HANDLE",
  );
  assert.equal(inner.calls.length, callsBeforeSecondScan,
    "stale admission performs no adapter I/O");
  releaseBlocked();
  const secondReceipt = await secondScan;
  assert.throws(
    () => candidateInventory
      .consumeV2CurrentOpenProductionCandidateAuthorityHandle(
        firstAuthority,
        firstProjection,
      ),
    (error) =>
      error.code === "STALE_CURRENT_OPEN_PRODUCTION_AUTHORITY_HANDLE",
  );
  const secondProjection = factory.projectForGitLedger(secondReceipt);
  const secondAuthority = factory.projectProductionCandidateAuthority(
    secondProjection,
  );
  assert.equal(
    candidateInventory
      .consumeV2CurrentOpenProductionCandidateAuthorityHandle(
        secondAuthority,
        secondProjection,
      ),
    secondAuthority,
  );
});

test("production current-open authority claim blocks synchronous mint reentry", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  const fake = fakeGraphQL({ datasets: () => candidateRange(1, 1) });
  const factory = createCurrentOpen(candidateInventory, fake);
  const receipt = await factory.scan();
  const projection = factory.projectForGitLedger(receipt);
  const callsBeforeProjection = fake.calls.length;
  const parseDescriptor = Object.getOwnPropertyDescriptor(Date, "parse");
  const originalParse = parseDescriptor.value;
  let armed = true;
  let reenteredAuthority = null;
  let reentryError = null;
  Object.defineProperty(Date, "parse", {
    ...parseDescriptor,
    value(value) {
      if (armed && value === candidate(1).created_at) {
        armed = false;
        try {
          reenteredAuthority = factory.projectProductionCandidateAuthority(
            projection,
          );
        } catch (error) {
          reentryError = error;
        }
      }
      return Reflect.apply(originalParse, Date, [value]);
    },
  });
  let authority;
  try {
    authority = factory.projectProductionCandidateAuthority(projection);
  } finally {
    Object.defineProperty(Date, "parse", parseDescriptor);
  }
  assert.equal(reenteredAuthority, null);
  assert.equal(
    reentryError?.code,
    "CONSUMED_CURRENT_OPEN_PRODUCTION_AUTHORITY_SOURCE",
  );
  assert.equal(fake.calls.length, callsBeforeProjection);
  assert.equal(
    candidateInventory
      .consumeV2CurrentOpenProductionCandidateAuthorityHandle(
        authority,
        projection,
      ),
    authority,
  );
});

test("production current-open authority rechecks revocation before brand publication", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  const fake = fakeGraphQL({ datasets: () => candidateRange(1, 1) });
  const factory = createCurrentOpen(candidateInventory, fake);
  const receipt = await factory.scan();
  const projection = factory.projectForGitLedger(receipt);
  const parseDescriptor = Object.getOwnPropertyDescriptor(Date, "parse");
  const originalParse = parseDescriptor.value;
  let armed = true;
  let replacementScan = null;
  Object.defineProperty(Date, "parse", {
    ...parseDescriptor,
    value(value) {
      if (armed && value === candidate(1).created_at) {
        armed = false;
        replacementScan = factory.scan();
      }
      return Reflect.apply(originalParse, Date, [value]);
    },
  });
  try {
    assert.throws(
      () => factory.projectProductionCandidateAuthority(projection),
      (error) =>
        error.code === "STALE_CURRENT_OPEN_PRODUCTION_AUTHORITY_SOURCE",
    );
  } finally {
    Object.defineProperty(Date, "parse", parseDescriptor);
  }
  const replacementReceipt = await replacementScan;
  const replacementProjection = factory.projectForGitLedger(
    replacementReceipt,
  );
  const replacementAuthority = factory.projectProductionCandidateAuthority(
    replacementProjection,
  );
  assert.equal(
    candidateInventory
      .consumeV2CurrentOpenProductionCandidateAuthorityHandle(
        replacementAuthority,
        replacementProjection,
      ),
    replacementAuthority,
  );
});

test("production current-open canonical digests ignore runtime intrinsic poisoning", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  const fake = fakeGraphQL({ datasets: () => candidateRange(1, 2) });
  const factory = createCurrentOpen(candidateInventory, fake);
  const receipt = await factory.scan();
  const projection = factory.projectForGitLedger(receipt);
  const keysDescriptor = Object.getOwnPropertyDescriptor(Object, "keys");
  const stringifyDescriptor = Object.getOwnPropertyDescriptor(
    JSON,
    "stringify",
  );
  const isArrayDescriptor = Object.getOwnPropertyDescriptor(Array, "isArray");
  const sortDescriptor = Object.getOwnPropertyDescriptor(
    Array.prototype,
    "sort",
  );
  const joinDescriptor = Object.getOwnPropertyDescriptor(
    Array.prototype,
    "join",
  );
  Object.defineProperty(Object, "keys", {
    ...keysDescriptor,
    value(value) {
      const keys = Reflect.apply(keysDescriptor.value, Object, [value]);
      return keys.length < 2 ? keys : keys.slice(0, 1);
    },
  });
  Object.defineProperty(JSON, "stringify", {
    ...stringifyDescriptor,
    value() { return "\"poisoned-canonical-json\""; },
  });
  Object.defineProperty(Array, "isArray", {
    ...isArrayDescriptor,
    value() { return false; },
  });
  Object.defineProperty(Array.prototype, "sort", {
    ...sortDescriptor,
    value() { return this.reverse(); },
  });
  Object.defineProperty(Array.prototype, "join", {
    ...joinDescriptor,
    value() { return "poisoned-array-join"; },
  });
  let authority;
  try {
    authority = factory.projectProductionCandidateAuthority(projection);
  } finally {
    Object.defineProperties(Object, { keys: keysDescriptor });
    Object.defineProperties(JSON, { stringify: stringifyDescriptor });
    Object.defineProperties(Array, { isArray: isArrayDescriptor });
    Object.defineProperties(Array.prototype, {
      sort: sortDescriptor,
      join: joinDescriptor,
    });
  }
  const replayed = candidateInventory
    .validateV2CurrentOpenProductionCandidateAuthority(
      structuredClone(authority),
      REPOSITORY,
    );
  assert.deepEqual(replayed, authority,
    "restored canonicalization must replay the branded public summary");
  assert.equal(
    candidateInventory
      .consumeV2CurrentOpenProductionCandidateAuthorityHandle(
        authority,
        projection,
      ),
    authority,
  );
});

test("production current-open authority enforces exact own-data replay", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  const fake = fakeGraphQL({ datasets: () => candidateRange(1, 2) });
  const factory = createCurrentOpen(candidateInventory, fake);
  const receipt = await factory.scan();
  const projection = factory.projectForGitLedger(receipt);
  const authority = factory.projectProductionCandidateAuthority(projection);

  const accessor = structuredClone(authority);
  Object.defineProperty(accessor, "candidate_count", {
    enumerable: true,
    get() { throw new Error("validator read an authority accessor"); },
  });
  const symbol = structuredClone(authority);
  symbol[Symbol("unexpected-authority-field")] = true;
  const nonenumerable = structuredClone(authority);
  Object.defineProperty(nonenumerable, "unexpected", { value: true });
  const nonenumerableRequired = structuredClone(authority);
  Object.defineProperty(nonenumerableRequired, "candidate_count", {
    enumerable: false,
    value: authority.candidate_count,
  });
  const nestedSymbol = structuredClone(authority);
  nestedSymbol.candidates[0].lifecycle_seed.head.repo[
    Symbol("unexpected-repo-field")
  ] = true;
  for (const forged of [
    accessor,
    symbol,
    nonenumerable,
    nonenumerableRequired,
    nestedSymbol,
  ]) {
    assert.throws(
      () => candidateInventory
        .validateV2CurrentOpenProductionCandidateAuthority(
          forged,
          REPOSITORY,
        ),
      /own data|unexpected or missing fields/u,
    );
  }
  assert.equal(
    candidateInventory
      .assertV2CurrentOpenProductionCandidateAuthorityHandle(
        authority,
        projection,
      ),
    authority,
    "offline validation failures cannot consume or replace the live brand",
  );
});

test("production current-open authority exposes deterministic absent-to-present lifecycle seeds", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  const selected = candidateRange(1, 1);
  const fake = fakeGraphQL({
    datasets: (pass) => pass <= 2 ? selected : pass <= 4 ? [] : selected,
    nodeProjection: (node, { pass }) => ({
      ...node,
      updatedAt: pass <= 2
        ? "2026-08-13T12:00:00.000Z"
        : "2026-08-13T13:00:00.000Z",
    }),
  });
  const factory = createCurrentOpen(candidateInventory, fake);
  const collect = async () => {
    const receipt = await factory.scan();
    const projection = factory.projectForGitLedger(receipt);
    return factory.projectProductionCandidateAuthority(projection);
  };

  const initiallyPresent = await collect();
  const stablyAbsent = await collect();
  const reappeared = await collect();
  assert.equal(initiallyPresent.candidate_count, 1);
  assert.equal(stablyAbsent.candidate_count, 0);
  assert.deepEqual(stablyAbsent.candidates, []);
  assert.equal(reappeared.candidate_count, 1);
  assert.equal(
    initiallyPresent.candidates[0].identity_digest,
    reappeared.candidates[0].identity_digest,
    "immutable identity survives a closed/reopened lifecycle",
  );
  assert.notEqual(
    initiallyPresent.candidates[0].lifecycle_seed_digest,
    reappeared.candidates[0].lifecycle_seed_digest,
    "changed current-open metadata supplies a new lifecycle seed",
  );
  assert.notEqual(
    initiallyPresent.candidate_set_digest,
    stablyAbsent.candidate_set_digest,
  );
  assert.notEqual(stablyAbsent.candidate_set_digest, reappeared.candidate_set_digest);
  assert.equal(Object.hasOwn(stablyAbsent, "retained_prior_candidate_ids"), false);
  assert.equal(Object.hasOwn(reappeared, "generation"), false);

  const replayFake = fakeGraphQL({
    datasets: () => selected,
    nodeProjection: (node) => ({
      ...node,
      updatedAt: "2026-08-13T13:00:00.000Z",
    }),
  });
  const replayFactory = createCurrentOpen(candidateInventory, replayFake);
  const replayReceipt = await replayFactory.scan();
  const replayProjection = replayFactory.projectForGitLedger(replayReceipt);
  const replayed = replayFactory.projectProductionCandidateAuthority(
    replayProjection,
  );
  assert.deepEqual(replayed, reappeared,
    "equivalent current-open metadata has deterministic authority inputs");
});

test("production current-open authority inherits the typed 513-item upstream cap", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  const fake = fakeGraphQL({ datasets: () => candidateRange(1, 513) });
  const factory = createCurrentOpen(candidateInventory, fake);
  await assert.rejects(
    factory.scan(),
    (error) => error.code === "CANDIDATE_OPEN_SET_CAP",
  );
  assert.equal(fake.calls.some(({ kind }) => kind === "fence"), false);
  assert.throws(
    () => factory.projectProductionCandidateAuthority({}),
    (error) =>
      error.code === "UNTRUSTED_CURRENT_OPEN_PRODUCTION_AUTHORITY_SOURCE",
  );
});

test("current-open factory authority never crosses mutable WeakMap intrinsics", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  const fake = fakeGraphQL({ datasets: () => candidateRange(1, 2) });
  const factory = createCurrentOpen(candidateInventory, fake);
  const setDescriptor = Object.getOwnPropertyDescriptor(
    WeakMap.prototype,
    "set",
  );
  const originalSet = setDescriptor.value;
  let captured = null;
  Object.defineProperty(WeakMap.prototype, "set", {
    ...setDescriptor,
    value(key, value) {
      if (value !== null && typeof value === "object" &&
          Object.hasOwn(value, "factory_epoch") &&
          Object.hasOwn(value, "raw_passes") &&
          Object.hasOwn(value, "semantic_projection")) {
        captured = { map: this, binding: value };
      }
      return Reflect.apply(originalSet, this, [key, value]);
    },
  });
  let inventory;
  try {
    inventory = await factory.scan();
  } finally {
    Object.defineProperty(WeakMap.prototype, "set", setDescriptor);
  }

  const clone = structuredClone(inventory);
  if (captured !== null) {
    Reflect.apply(originalSet, captured.map, [clone, captured.binding]);
  }
  const callsAfterScan = fake.calls.length;
  assert.throws(
    () => factory.projectForGitLedger(clone),
    (error) => error.code === "UNTRUSTED_CURRENT_OPEN_INVENTORY_HANDLE",
  );
  assert.equal(captured, null, "private authority must stay in lexical slots");
  assert.equal(fake.calls.length, callsAfterScan);
});

test("current-open scan start revokes stale authority and supersedes older attempts", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  const staleFake = fakeGraphQL({ datasets: () => candidateRange(1, 2) });
  let fail = false;
  const staleFactory = createCurrentOpen(candidateInventory, {
    fetch: async (...args) => fail
      ? jsonResponse(
          { message: "failed refresh" },
          { Date: "Thu, 13 Aug 2026 12:00:00 GMT" },
          500,
        )
      : staleFake.fetch(...args),
  });
  const staleReceipt = await staleFactory.scan();
  assert.doesNotThrow(() => staleFactory.projectForGitLedger(staleReceipt));
  fail = true;
  await assert.rejects(
    staleFactory.scan(),
    (error) => error.code === "CANDIDATE_HTTP_UNREADABLE",
  );
  assert.throws(
    () => staleFactory.projectForGitLedger(staleReceipt),
    (error) => error.code === "UNTRUSTED_CURRENT_OPEN_INVENTORY_HANDLE",
  );

  const concurrentFake = fakeGraphQL({
    datasets: () => candidateRange(1, 2),
  });
  let releaseFirst;
  let markFirstBlocked;
  const firstBlocked = new Promise((resolve) => {
    markFirstBlocked = resolve;
  });
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let blockFirst = true;
  let concurrentFetchCalls = 0;
  const concurrentFactory = createCurrentOpen(candidateInventory, {
    fetch: async (...args) => {
      concurrentFetchCalls += 1;
      if (blockFirst) {
        blockFirst = false;
        markFirstBlocked();
        await firstGate;
      }
      return concurrentFake.fetch(...args);
    },
  });
  const olderAttempt = concurrentFactory.scan();
  await firstBlocked;
  const currentReceipt = await concurrentFactory.scan();
  const requestsBeforeOlderRelease = concurrentFetchCalls;
  releaseFirst();
  await assert.rejects(
    olderAttempt,
    (error) => error.code === "CANDIDATE_OPEN_SCAN_SUPERSEDED",
  );
  assert.equal(
    concurrentFetchCalls,
    requestsBeforeOlderRelease,
    "a superseded scan must not issue another page or fence request",
  );
  assert.doesNotThrow(() =>
    concurrentFactory.projectForGitLedger(currentReceipt));
});

test("current-open deadlines ignore poisoned Array iterators for fetch and body reads", {
  timeout: 2_000,
}, async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  let fetchSettled = false;
  let releaseFetch;
  const fetchGate = new Promise((resolve) => {
    releaseFetch = () => {
      fetchSettled = true;
      resolve(jsonResponse(
        { message: "late failure" },
        { Date: "Thu, 13 Aug 2026 12:00:00 GMT" },
        500,
      ));
    };
  });
  const fetchFallback = setTimeout(releaseFetch, 500);
  const delayedFetchFactory = createCurrentOpen(candidateInventory, {
    fetch: () => fetchGate,
  }, { timeoutMs: 5 });
  try {
    const fetchResult = await withTruncatedArrayIterator(
      () => delayedFetchFactory.scan(),
    );
    assert.equal(fetchResult.error?.code, "CANDIDATE_HTTP_TIMEOUT");
    assert.equal(fetchSettled, false, "fetch deadline settles before adapter");
  } finally {
    clearTimeout(fetchFallback);
    releaseFetch();
  }

  let cancelled = false;
  let readSettled = false;
  let releaseRead;
  const readGate = new Promise((resolve) => {
    releaseRead = () => {
      readSettled = true;
      resolve({ done: true, value: undefined });
    };
  });
  const readFallback = setTimeout(releaseRead, 500);
  const delayedReadFactory = createCurrentOpen(candidateInventory, {
    fetch: async () => ({
      status: 200,
      headers: {
        get(name) {
          if (name.toLowerCase() === "date") {
            return "Thu, 13 Aug 2026 12:00:00 GMT";
          }
          if (name.toLowerCase() === "x-github-request-id") {
            return "TEST:DELAYED-READ";
          }
          return null;
        },
      },
      body: {
        getReader() {
          return {
            read() {
              return readGate;
            },
            cancel() {
              cancelled = true;
              return Promise.resolve();
            },
            releaseLock() {},
          };
        },
      },
    }),
  }, { timeoutMs: 5 });
  try {
    const readResult = await withTruncatedArrayIterator(
      () => delayedReadFactory.scan(),
    );
    assert.equal(readResult.error?.code, "CANDIDATE_HTTP_TIMEOUT");
    assert.equal(readSettled, false, "body deadline settles before reader");
    await nextCleanupTurn();
    assert.equal(cancelled, true);
  } finally {
    clearTimeout(readFallback);
    releaseRead();
  }
});

test("current-open transport keeps typed errors private from abort and cancel adapters", {
  timeout: 2_000,
}, async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  let abortReason = null;
  const timeoutFactory = createCurrentOpen(candidateInventory, {
    fetch: async (_input, init) => new Promise(() => {
      init.signal.addEventListener("abort", () => {
        abortReason = init.signal.reason;
        if (abortReason !== null && typeof abortReason === "object") {
          abortReason.code = "FORGED_TIMEOUT";
          abortReason.name = "ForgedTimeout";
          Object.setPrototypeOf(abortReason, Error.prototype);
        }
      }, { once: true });
    }),
  }, { timeoutMs: 5 });
  let timeoutError = null;
  try {
    await timeoutFactory.scan();
  } catch (error) {
    timeoutError = error;
  }
  assert.equal(timeoutError?.code, "CANDIDATE_HTTP_TIMEOUT");
  assert.equal(timeoutError?.name, "V2CandidateInventoryError");
  assert.equal(
    timeoutError instanceof candidateInventory.V2CandidateInventoryError,
    true,
  );
  await nextCleanupTurn();
  assert.equal(abortReason instanceof Error, true);
  assert.notStrictEqual(abortReason, timeoutError);
  assert.equal(timeoutError?.code, "CANDIDATE_HTTP_TIMEOUT");
  assert.equal(timeoutError?.name, "V2CandidateInventoryError");
  assert.equal(
    timeoutError instanceof candidateInventory.V2CandidateInventoryError,
    true,
  );

  let cancelReason = null;
  let oversizedAbortReason = null;
  let delivered = false;
  const oversizedFactory = createCurrentOpen(candidateInventory, {
    fetch: async (_input, init) => {
      init.signal.addEventListener("abort", () => {
        oversizedAbortReason = init.signal.reason;
        if (oversizedAbortReason !== null &&
            typeof oversizedAbortReason === "object") {
          oversizedAbortReason.code = "FORGED_OVERSIZED_ABORT";
          oversizedAbortReason.name = "ForgedOversizedAbort";
          oversizedAbortReason.details = { forged: true };
          oversizedAbortReason.cause = new Error("forged oversized cause");
        }
      }, { once: true });
      return {
        status: 200,
        headers: {
          get(name) {
            if (name.toLowerCase() === "date") {
              return "Thu, 13 Aug 2026 12:00:00 GMT";
            }
            if (name.toLowerCase() === "x-github-request-id") {
              return "TEST:PRIVATE-CANCEL-REASON";
            }
            return null;
          }
        },
        body: {
          getReader() {
            return {
              read() {
                if (delivered) {
                  return Promise.resolve({ done: true, value: undefined });
                }
                delivered = true;
                return Promise.resolve({
                  done: false,
                  value: new Uint8Array(
                    candidateInventory
                      .MAX_V2_CURRENT_OPEN_CANDIDATE_RESPONSE_BYTES + 1,
                  ),
                });
              },
              cancel(reason) {
                cancelReason = reason;
                if (reason !== null && typeof reason === "object") {
                  reason.code = "FORGED_CANCEL";
                  reason.name = "ForgedCancel";
                  Object.setPrototypeOf(reason, Error.prototype);
                }
                return Promise.resolve();
              },
              releaseLock() {},
            };
          },
        },
      };
    },
  });
  let oversizedError = null;
  try {
    await oversizedFactory.scan();
  } catch (error) {
    oversizedError = error;
  }
  assert.equal(oversizedError?.code, "CANDIDATE_RESPONSE_TOO_LARGE");
  assert.equal(oversizedError?.name, "V2CandidateInventoryError");
  assert.equal(
    oversizedError instanceof candidateInventory.V2CandidateInventoryError,
    true,
  );
  await nextCleanupTurn();
  assert.equal(typeof cancelReason, "string");
  assert.notStrictEqual(oversizedAbortReason, oversizedError);
  assert.equal(oversizedError.code, "CANDIDATE_RESPONSE_TOO_LARGE");
  assert.equal(oversizedError.name, "V2CandidateInventoryError");
  assert.equal(oversizedError.details, null);
  assert.equal(oversizedError.cause, undefined);
  assert.equal(
    Object.getPrototypeOf(oversizedError),
    candidateInventory.V2CandidateInventoryError.prototype,
  );
});

test("candidate timeout settles before blocking abort and throwing reader cleanup", {
  timeout: 2_000,
}, async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  const events = [];
  let signalReason = null;
  let cancelReason = null;
  let poisonedSchedulerCalls = 0;
  const originalSetImmediate = mutableTimers.setImmediate;
  const factory = createCurrentOpen(candidateInventory, {
    fetch: async (_input, init) => {
      mutableTimers.setImmediate = (callback, ...args) => {
        poisonedSchedulerCalls += 1;
        Reflect.apply(callback, undefined, args);
        Reflect.apply(callback, undefined, args);
        return {};
      };
      syncBuiltinESMExports();
      init.signal.addEventListener("abort", () => {
        signalReason = init.signal.reason;
        events.push("abort-start");
        blockEventLoop(15);
        if (signalReason !== null && typeof signalReason === "object") {
          signalReason.code = "FORGED_CLEANUP";
          signalReason.name = "ForgedCleanup";
          signalReason.details = { forged: true };
          signalReason.cause = new Error("forged cleanup cause");
          Object.setPrototypeOf(signalReason, null);
        }
        events.push("abort-end");
      }, { once: true });
      return {
        status: 200,
        headers: {
          get(name) {
            if (name.toLowerCase() === "date") {
              return "Thu, 13 Aug 2026 12:00:00 GMT";
            }
            if (name.toLowerCase() === "x-github-request-id") {
              return "TEST:DEFERRED-HOSTILE-CLEANUP";
            }
            return null;
          },
        },
        body: {
          getReader() {
            return {
              read() {
                return new Promise(() => {});
              },
              cancel(reason) {
                cancelReason = reason;
                events.push("cancel-start");
                blockEventLoop(15);
                events.push("cancel-end");
                throw new Error("hostile cancel failure");
              },
              releaseLock() {
                events.push("release-start");
                blockEventLoop(15);
                events.push("release-end");
                throw new Error("hostile release failure");
              },
            };
          },
        },
      };
    },
  }, { timeoutMs: 5 });

  let caught = null;
  try {
    try {
      await factory.scan();
    } catch (error) {
      caught = error;
      events.push("caller-catch");
    }
  } finally {
    mutableTimers.setImmediate = originalSetImmediate;
    syncBuiltinESMExports();
  }

  assert.equal(caught?.code, "CANDIDATE_HTTP_TIMEOUT");
  assert.equal(caught?.name, "V2CandidateInventoryError");
  assert.equal(caught?.details, null);
  assert.equal(caught?.cause, undefined);
  assert.equal(
    Object.getPrototypeOf(caught),
    candidateInventory.V2CandidateInventoryError.prototype,
  );
  assert.deepEqual(events, ["caller-catch"]);
  assert.equal(poisonedSchedulerCalls, 0);

  await nextCleanupTurn();

  assert.deepEqual(events, [
    "caller-catch",
    "abort-start",
    "abort-end",
    "cancel-start",
    "cancel-end",
    "release-start",
    "release-end",
  ]);
  assert.notStrictEqual(signalReason, caught);
  assert.equal(typeof cancelReason, "string");
  assert.equal(caught.code, "CANDIDATE_HTTP_TIMEOUT");
  assert.equal(caught.name, "V2CandidateInventoryError");
  assert.equal(caught.details, null);
  assert.equal(caught.cause, undefined);
  assert.equal(
    Object.getPrototypeOf(caught),
    candidateInventory.V2CandidateInventoryError.prototype,
  );
});

test("state=all timeout also settles before its fresh abort cleanup reason", {
  timeout: 2_000,
}, async () => {
  const events = [];
  let signalReason = null;
  const transport = createV2GitHubCandidateInventory({
    fetch: (_input, init) => new Promise(() => {
      init.signal.addEventListener("abort", () => {
        signalReason = init.signal.reason;
        events.push("abort-start");
        blockEventLoop(15);
        signalReason.code = "FORGED_STATE_ALL_CLEANUP";
        signalReason.name = "ForgedStateAllCleanup";
        signalReason.details = { forged: true };
        signalReason.cause = new Error("forged state=all cleanup cause");
        Object.setPrototypeOf(signalReason, null);
        events.push("abort-end");
      }, { once: true });
    }),
    token: "synthetic-candidate-inventory-token",
    repository: REPOSITORY,
    restBaseUrl: API,
    timeoutMs: 5,
  });

  let caught = null;
  try {
    await transport.scan();
  } catch (error) {
    caught = error;
    events.push("caller-catch");
  }

  assert.equal(caught?.code, "CANDIDATE_HTTP_TIMEOUT");
  assert.equal(caught?.name, "V2CandidateInventoryError");
  assert.equal(caught?.details, null);
  assert.equal(caught?.cause, undefined);
  assert.equal(
    Object.getPrototypeOf(caught),
    V2CandidateInventoryError.prototype,
  );
  assert.deepEqual(events, ["caller-catch"]);

  await nextCleanupTurn();

  assert.deepEqual(events, ["caller-catch", "abort-start", "abort-end"]);
  assert.notStrictEqual(signalReason, caught);
  assert.equal(caught.code, "CANDIDATE_HTTP_TIMEOUT");
  assert.equal(caught.name, "V2CandidateInventoryError");
  assert.equal(caught.details, null);
  assert.equal(caught.cause, undefined);
  assert.equal(
    Object.getPrototypeOf(caught),
    V2CandidateInventoryError.prototype,
  );
});

test("current-open rejects adapter-forged typed errors", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  const malformedFake = fakeGraphQL({
    datasets: () => candidateRange(1, 1),
    responseProjection: () => ({ data: null }),
  });
  let priorInternalError = null;
  try {
    await createCurrentOpen(candidateInventory, malformedFake).scan();
  } catch (error) {
    priorInternalError = error;
  }
  assert.equal(priorInternalError?.code, "CANDIDATE_PAGE_MALFORMED");

  const forgedFetchFactory = createCurrentOpen(candidateInventory, {
    fetch: async () => {
      throw new candidateInventory.V2CandidateInventoryError(
        "CANDIDATE_OPEN_SET_UNSTABLE",
        "forged fetch taxonomy",
      );
    },
  });
  await assert.rejects(
    forgedFetchFactory.scan(),
    (error) => error.code === "CANDIDATE_HTTP_UNREADABLE" &&
      error.cause?.code === "CANDIDATE_OPEN_SET_UNSTABLE",
  );

  const forgedReadFactory = createCurrentOpen(candidateInventory, {
    fetch: async () => ({
      status: 200,
      headers: {
        get(name) {
          if (name.toLowerCase() === "date") {
            return "Thu, 13 Aug 2026 12:00:00 GMT";
          }
          if (name.toLowerCase() === "x-github-request-id") {
            return "TEST:FORGED-READ-ERROR";
          }
          return null;
        },
      },
      body: {
        getReader() {
          return {
            read() {
              return Promise.reject(
                new candidateInventory.V2CandidateInventoryError(
                  "CANDIDATE_RESPONSE_TOO_LARGE",
                  "forged reader taxonomy",
                ),
              );
            },
            cancel() {
              return Promise.resolve();
            },
            releaseLock() {},
          };
        },
      },
    }),
  });
  await assert.rejects(
    forgedReadFactory.scan(),
    (error) => error.code === "CANDIDATE_HTTP_UNREADABLE" &&
      error.cause?.code === "CANDIDATE_RESPONSE_TOO_LARGE",
  );

  const replayedResponse = (source) => {
    const headers = {
      get(name) {
        if (source === "headers") throw priorInternalError;
        if (name.toLowerCase() === "date") {
          return "Thu, 13 Aug 2026 12:00:00 GMT";
        }
        if (name.toLowerCase() === "x-github-request-id") {
          return "TEST:REPLAYED-INTERNAL-ERROR";
        }
        return null;
      },
    };
    const body = {
      getReader() {
        if (source === "getReader") throw priorInternalError;
        return {
          read() {
            if (source === "reader") {
              return Promise.reject(priorInternalError);
            }
            if (source === "readResult") {
              return Promise.resolve({
                get done() {
                  throw priorInternalError;
                },
                value: undefined,
              });
            }
            return Promise.resolve({ done: true, value: undefined });
          },
          cancel() {
            return Promise.resolve();
          },
          releaseLock() {},
        };
      },
    };
    const response = { status: 200, headers, body };
    if (source === "status") {
      Object.defineProperty(response, "status", {
        get() {
          throw priorInternalError;
        },
      });
    }
    if (source === "body") {
      Object.defineProperty(response, "body", {
        get() {
          throw priorInternalError;
        },
      });
    }
    return response;
  };
  for (const source of [
    "fetch", "status", "headers", "body", "getReader", "reader",
    "readResult",
  ]) {
    const replayFactory = createCurrentOpen(candidateInventory, {
      fetch: source === "fetch"
        ? async () => {
            throw priorInternalError;
          }
        : async () => replayedResponse(source),
    });
    await assert.rejects(
      replayFactory.scan(),
      (error) => error.code === "CANDIDATE_HTTP_UNREADABLE" &&
        error.cause === priorInternalError,
    );
  }
});

test("current-open accepts only fixed private body chunk backing", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  const payload = Buffer.from(JSON.stringify(graphqlResponse(
    [graphqlPullRequest(candidate(1))],
    { hasNextPage: false, endCursor: "opaque:1" },
  )), "utf8");
  const chunks = [];
  if (typeof SharedArrayBuffer === "function") {
    const shared = new Uint8Array(new SharedArrayBuffer(payload.byteLength));
    shared.set(payload);
    chunks.push(["shared", shared]);
  }
  try {
    const resizableBuffer = new ArrayBuffer(payload.byteLength, {
      maxByteLength: payload.byteLength + 1,
    });
    if (resizableBuffer.resizable === true) {
      const resizable = new Uint8Array(resizableBuffer);
      resizable.set(payload);
      chunks.push(["resizable", resizable]);
    }
  } catch {
    // The runtime does not expose resizable ArrayBuffer.
  }
  const detachedBuffer = new ArrayBuffer(payload.byteLength);
  const detached = new Uint8Array(detachedBuffer);
  detached.set(payload);
  structuredClone(detachedBuffer, { transfer: [detachedBuffer] });
  chunks.push(["detached", detached]);

  for (const [kind, chunk] of chunks) {
    let requests = 0;
    const factory = createCurrentOpen(candidateInventory, {
      fetch: async () => {
        requests += 1;
        let delivered = false;
        return {
          status: 200,
          headers: {
            get(name) {
              if (name.toLowerCase() === "date") {
                return "Thu, 13 Aug 2026 12:00:00 GMT";
              }
              if (name.toLowerCase() === "x-github-request-id") {
                return `TEST:${kind}:${requests}`;
              }
              return null;
            },
          },
          body: {
            getReader() {
              return {
                read() {
                  if (delivered) {
                    return Promise.resolve({ done: true, value: undefined });
                  }
                  delivered = true;
                  return Promise.resolve({ done: false, value: chunk });
                },
                cancel() {
                  return Promise.resolve();
                },
                releaseLock() {},
              };
            },
          },
        };
      },
    });
    await assert.rejects(
      factory.scan(),
      (error) => error.code === "CANDIDATE_HTTP_UNREADABLE",
      `${kind} body chunk must fail closed`,
    );
  }
});

test("current-open admits body chunk length before private snapshot allocation", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  const OriginalUint8Array = globalThis.Uint8Array;
  const oversizedLength = candidateInventory
    .MAX_V2_CURRENT_OPEN_CANDIDATE_RESPONSE_BYTES + 1;
  const oversizedChunk = new OriginalUint8Array(oversizedLength);
  let forbiddenSnapshotAllocations = 0;
  class AllocationGuardUint8Array extends OriginalUint8Array {
    constructor(...args) {
      if (typeof args[0] === "number" && args[0] >
          candidateInventory.MAX_V2_CURRENT_OPEN_CANDIDATE_RESPONSE_BYTES) {
        forbiddenSnapshotAllocations += 1;
        throw new Error("oversized private snapshot allocation");
      }
      super(...args);
    }
  }

  const scanWithReadResult = async (readResult) => {
    let delivered = false;
    const factory = createCurrentOpen(candidateInventory, {
      fetch: async () => ({
        status: 200,
        headers: {
          get(name) {
            if (name.toLowerCase() === "date") {
              return "Thu, 13 Aug 2026 12:00:00 GMT";
            }
            if (name.toLowerCase() === "x-github-request-id") {
              return "TEST:BODY-ADMISSION-BEFORE-COPY";
            }
            return null;
          },
        },
        body: {
          getReader() {
            return {
              read() {
                if (delivered) {
                  return Promise.resolve({ done: true, value: undefined });
                }
                delivered = true;
                return Promise.resolve(readResult);
              },
              cancel() {
                return Promise.resolve();
              },
              releaseLock() {},
            };
          },
        },
      }),
    });
    return factory.scan();
  };

  globalThis.Uint8Array = AllocationGuardUint8Array;
  try {
    await assert.rejects(
      scanWithReadResult({ done: false, value: oversizedChunk }),
      (error) => error.code === "CANDIDATE_RESPONSE_TOO_LARGE",
    );
    await assert.rejects(
      scanWithReadResult({ done: true, value: oversizedChunk }),
      (error) => error.code === "CANDIDATE_HTTP_UNREADABLE",
    );
  } finally {
    globalThis.Uint8Array = OriginalUint8Array;
  }
  assert.equal(
    forbiddenSnapshotAllocations,
    0,
    "rejected chunks must never be copied into an oversized private buffer",
  );
});

test("current-open publishes one immutable adapter request body", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  for (const mutateAfterAwait of [false, true]) {
    const baseFetch = plainGraphqlFetch(candidate(1));
    let bodyWasString = false;
    let immutableEnvelopeObserved = false;
    let mutationBlocked = false;
    const factory = createCurrentOpen(candidateInventory, {
      fetch: async (input, init) => {
        const original = init.body;
        bodyWasString = typeof original === "string";
        immutableEnvelopeObserved = typeof input === "string" &&
          Object.isFrozen(init) && Object.isFrozen(init.headers);
        if (mutateAfterAwait) await Promise.resolve();
        try {
          init.body = `X${String(original).slice(1)}`;
        } catch {
          mutationBlocked = true;
        }
        mutationBlocked = mutationBlocked && init.body === original;
        return baseFetch(input, init);
      },
    });
    const inventory = await factory.scan();
    const projection = factory.projectForGitLedger(inventory);
    assert.equal(bodyWasString, true);
    assert.equal(immutableEnvelopeObserved, true);
    assert.equal(mutationBlocked, true);
    for (const rawPass of projection.raw_passes) {
      for (const artifact of [...rawPass.pages, rawPass.final_fence]) {
        const requestBytes = Buffer.from(
          artifact.request_body_base64,
          "base64",
        );
        const request = JSON.parse(requestBytes.toString("utf8"));
        assert.equal(request.query, EXPECTED_CURRENT_OPEN_QUERY);
        assert.equal(
          rawSha256(requestBytes),
          artifact.receipt.request_body_sha256,
        );
      }
    }
  }
});

test("current-open live authority ignores poisoned freeze and clone globals", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  const ownerFactory = createCurrentOpen(candidateInventory, {
    fetch: plainGraphqlFetch(candidate(1)),
  });
  const foreignFactory = createCurrentOpen(candidateInventory, {
    fetch: plainGraphqlFetch(candidate(2)),
  });
  const freezeDescriptor = Object.getOwnPropertyDescriptor(Object, "freeze");
  const frozenDescriptor = Object.getOwnPropertyDescriptor(Object, "isFrozen");
  const valuesDescriptor = Object.getOwnPropertyDescriptor(Object, "values");
  const originalValues = valuesDescriptor.value;
  const capturedBindings = [];
  let freezeCalls = 0;
  let frozenCalls = 0;
  let valuesCalls = 0;
  Object.defineProperties(Object, {
    freeze: {
      ...freezeDescriptor,
      value(value) {
        freezeCalls += 1;
        if (value !== null && typeof value === "object" &&
            Object.hasOwn(value, "raw_passes") &&
            Object.hasOwn(value, "semantic_projection") &&
            Object.hasOwn(value, "factory_epoch")) {
          capturedBindings.push(value);
        }
        return value;
      },
    },
    isFrozen: {
      ...frozenDescriptor,
      value() {
        frozenCalls += 1;
        return false;
      },
    },
    values: {
      ...valuesDescriptor,
      value(value) {
        valuesCalls += 1;
        return Reflect.apply(originalValues, Object, [value]);
      },
    },
  });
  let ownerReceipt;
  let foreignReceipt;
  try {
    ownerReceipt = await ownerFactory.scan();
    foreignReceipt = await foreignFactory.scan();
  } finally {
    Object.defineProperties(Object, {
      freeze: freezeDescriptor,
      isFrozen: frozenDescriptor,
      values: valuesDescriptor,
    });
  }

  if (capturedBindings.length >= 2) {
    Object.assign(ownerReceipt, structuredClone(foreignReceipt));
    Object.assign(
      capturedBindings[0],
      structuredClone(capturedBindings[1]),
    );
    assert.throws(
      () => ownerFactory.projectForGitLedger(ownerReceipt),
      (error) => error.code === "UNTRUSTED_CURRENT_OPEN_INVENTORY_HANDLE",
    );
  } else {
    assert.throws(
      () => ownerFactory.projectForGitLedger(foreignReceipt),
      (error) => error.code === "UNTRUSTED_CURRENT_OPEN_INVENTORY_HANDLE",
    );
    assert.doesNotThrow(() => ownerFactory.projectForGitLedger(ownerReceipt));
  }
  assert.equal(capturedBindings.length, 0);
  assert.equal(freezeCalls, 0);
  assert.equal(frozenCalls, 0);
  assert.equal(valuesCalls, 0);

  const cloneDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "structuredClone",
  );
  let cloneCalls = 0;
  let projection;
  let cloneError = null;
  Object.defineProperty(globalThis, "structuredClone", {
    ...cloneDescriptor,
    value() {
      cloneCalls += 1;
      throw new Error("poisoned structuredClone dispatched");
    },
  });
  try {
    projection = ownerFactory.projectForGitLedger(ownerReceipt);
    candidateInventory
      .validateV2CurrentOpenCandidateInventoryGitLedgerProjection(
        projection,
        REPOSITORY,
      );
  } catch (error) {
    cloneError = error;
  } finally {
    Object.defineProperty(globalThis, "structuredClone", cloneDescriptor);
  }
  assert.equal(cloneError, null);
  assert.equal(cloneCalls, 0);
});

test("current-open request-id uniqueness ignores poisoned Set methods", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  const factory = createCurrentOpen(candidateInventory, {
    fetch: plainGraphqlFetch(candidate(1), {
      requestId: () => "TEST:CONSTANT-REQUEST-ID",
    }),
  });
  const hasDescriptor = Object.getOwnPropertyDescriptor(Set.prototype, "has");
  const addDescriptor = Object.getOwnPropertyDescriptor(Set.prototype, "add");
  let hasCalls = 0;
  let addCalls = 0;
  Object.defineProperties(Set.prototype, {
    has: {
      ...hasDescriptor,
      value() {
        hasCalls += 1;
        return false;
      },
    },
    add: {
      ...addDescriptor,
      value() {
        addCalls += 1;
        return this;
      },
    },
  });
  let observed = null;
  try {
    await factory.scan();
  } catch (error) {
    observed = error;
  } finally {
    Object.defineProperties(Set.prototype, {
      has: hasDescriptor,
      add: addDescriptor,
    });
  }
  assert.equal(observed?.code, "CANDIDATE_HTTP_REPLAYED");
  assert.equal(hasCalls, 0);
  assert.equal(addCalls, 0);
});

test("current-open completeness ignores poisoned Array map", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  const factory = createCurrentOpen(candidateInventory, {
    fetch: plainGraphqlFetch(candidate(1)),
  });
  const mapDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "map");
  let mapCalls = 0;
  Object.defineProperty(Array.prototype, "map", {
    ...mapDescriptor,
    value() {
      mapCalls += 1;
      throw new Error("poisoned Array map dispatched");
    },
  });
  let inventory;
  let projection;
  let validated;
  let observed = null;
  try {
    inventory = await factory.scan();
    projection = factory.projectForGitLedger(inventory);
    validated = candidateInventory
      .validateV2CurrentOpenCandidateInventoryGitLedgerProjection(
        projection,
        REPOSITORY,
      );
  } catch (error) {
    observed = error;
  } finally {
    Object.defineProperty(Array.prototype, "map", mapDescriptor);
  }
  assert.equal(observed, null);
  assert.equal(mapCalls, 0);
  assert.equal(inventory.current_open_pull_requests.length, 1);
  assert.equal(projection.semantic_projection.length, 1);
  assert.equal(validated.receipt.current_open_pull_requests.length, 1);
});

test("current-open completeness ignores poisoned Array iterators", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  const factory = createCurrentOpen(candidateInventory, {
    fetch: plainGraphqlFetch(candidate(1)),
  });
  const iteratorDescriptor = Object.getOwnPropertyDescriptor(
    Array.prototype,
    Symbol.iterator,
  );
  const originalIterator = iteratorDescriptor.value;
  let poisonCalls = 0;
  Object.defineProperty(Array.prototype, Symbol.iterator, {
    ...iteratorDescriptor,
    value(...args) {
      if (this.length > 0 && this[0] !== null &&
          typeof this[0] === "object" &&
          Object.hasOwn(this[0], "node_id") &&
          Object.hasOwn(this[0], "updated_at")) {
        poisonCalls += 1;
        return {
          next() {
            return { done: true, value: undefined };
          },
          [Symbol.iterator]() {
            return this;
          },
        };
      }
      return Reflect.apply(originalIterator, this, args);
    },
  });
  let inventory;
  let projection;
  let validated;
  try {
    inventory = await factory.scan();
    projection = factory.projectForGitLedger(inventory);
    validated = candidateInventory
      .validateV2CurrentOpenCandidateInventoryGitLedgerProjection(
        projection,
        REPOSITORY,
      );
  } finally {
    Object.defineProperty(
      Array.prototype,
      Symbol.iterator,
      iteratorDescriptor,
    );
  }
  assert.equal(poisonCalls, 0);
  assert.equal(inventory.current_open_pull_requests.length, 1);
  assert.equal(projection.receipt.passes[0].pages[0].item_count, 1);
  assert.equal(validated.receipt.current_open_pull_requests.length, 1);
});

test("current-open durable replay rejects a forged later stable pair", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  const fake = fakeGraphQL({
    datasets: (pass) => candidateRange(1, pass === 1 ? 1 : 2),
  });
  const factory = createCurrentOpen(candidateInventory, fake);
  const inventory = await factory.scan();
  const projection = factory.projectForGitLedger(inventory);
  assert.equal(projection.raw_passes.length, 3);

  const forged = structuredClone(projection);
  const firstReceipt = structuredClone(forged.receipt.passes[0]);
  firstReceipt.pass = 2;
  const firstRaw = structuredClone(forged.raw_passes[0]);
  firstRaw.pass = 2;
  for (const [index, page] of firstReceipt.pages.entries()) {
    const requestId = `FORGED:PASS2:PAGE${index + 1}`;
    page.request_id = requestId;
    firstRaw.pages[index].receipt.request_id = requestId;
  }
  firstReceipt.final_fence.request_id = "FORGED:PASS2:FENCE";
  firstRaw.final_fence.receipt.request_id = "FORGED:PASS2:FENCE";
  forged.receipt.passes = [
    forged.receipt.passes[0],
    firstReceipt,
    { ...forged.receipt.passes[1], pass: 3 },
    { ...forged.receipt.passes[2], pass: 4 },
  ];
  forged.raw_passes = [
    forged.raw_passes[0],
    firstRaw,
    { ...forged.raw_passes[1], pass: 3 },
    { ...forged.raw_passes[2], pass: 4 },
  ];
  const { receipt_digest: _receiptDigest, ...withoutDigest } = forged.receipt;
  forged.receipt.receipt_digest = canonicalDigest(
    "codex-review-gate-v2-current-open-candidate-inventory",
    withoutDigest,
  );
  assert.throws(
    () => candidateInventory
      .validateV2CurrentOpenCandidateInventoryGitLedgerProjection(
        forged,
        REPOSITORY,
      ),
    /earliest stable pair/u,
  );
});

test("current-open semantics cover net-current fields, not unobserved history", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  const stableA = await createCurrentOpen(candidateInventory, fakeGraphQL({
    datasets: () => candidateRange(1, 2),
  })).scan();
  const stableB = await createCurrentOpen(candidateInventory, fakeGraphQL({
    datasets: () => candidateRange(1, 2),
  })).scan();
  assert.equal(
    stableA.current_open_semantic_digest,
    stableB.current_open_semantic_digest,
    "transport Date is outside dispatch semantics",
  );

  const variants = [
    (node) => ({ ...node, updatedAt: "2026-08-13T13:00:00.000Z" }),
    (node) => ({ ...node, headRefOid: "f".repeat(40) }),
    (node) => ({ ...node, baseRefName: "release" }),
    (node) => ({ ...node, isDraft: true }),
  ];
  for (const nodeProjection of variants) {
    const changed = await createCurrentOpen(candidateInventory, fakeGraphQL({
      datasets: () => candidateRange(1, 2),
      nodeProjection,
    })).scan();
    assert.notEqual(
      changed.current_open_semantic_digest,
      stableA.current_open_semantic_digest,
    );
  }

  const observedReopen = await createCurrentOpen(candidateInventory, fakeGraphQL({
    datasets: (pass) => pass === 2
      ? candidateRange(2, 2)
      : candidateRange(1, 2),
    nodeProjection: (node, { pass }) => node.number === 1 && pass >= 3
      ? { ...node, updatedAt: "2026-08-13T14:00:00.000Z" }
      : node,
  })).scan();
  assert.equal(observedReopen.passes.length, 4);
  assert.notEqual(
    observedReopen.passes[1].current_open_semantic_digest,
    observedReopen.passes[2].current_open_semantic_digest,
    "an observed revision-visible reopen is dirty",
  );
  assert.equal(
    observedReopen.passes[2].current_open_semantic_digest,
    observedReopen.passes[3].current_open_semantic_digest,
  );
  assert.equal(
    observedReopen.completeness,
    "bounded-stable-sampled-current-open-net-set",
    "unobserved historical ABA requires independent dirty or event authority",
  );
});

test("current-open GraphQL rejects duplicate immutable full database and node identity", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  for (const duplicateField of ["fullDatabaseId", "id"]) {
    const fake = fakeGraphQL({
      datasets: () => candidateRange(1, 2),
      nodeProjection: (node) => node.number === 2
        ? {
            ...node,
            [duplicateField]: graphqlPullRequest(candidate(1))[duplicateField],
          }
        : node,
    });
    await assert.rejects(
      createCurrentOpen(candidateInventory, fake).scan(),
      (error) => error.code === "CANDIDATE_IDENTITY_CONFLICT",
    );
  }
});

test("current-open GraphQL fail-closes nullable identities and canonicalizes CREATED_AT ties", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  for (const nodeProjection of [
    (node) => ({ ...node, fullDatabaseId: null }),
    (node) => ({ ...node, fullDatabaseId: 1 }),
    (node) => ({ ...node, fullDatabaseId: "0" }),
    (node) => ({ ...node, fullDatabaseId: "01" }),
    (node) => ({ ...node, fullDatabaseId: "9223372036854775808" }),
    (node) => ({ ...node, fullDatabaseId: "9".repeat(1000) }),
    (node) => ({ ...node, headRepository: null }),
    (node) => ({ ...node, state: "CLOSED" }),
  ]) {
    const fake = fakeGraphQL({
      datasets: () => candidateRange(1, 1),
      nodeProjection,
    });
    await assert.rejects(
      createCurrentOpen(candidateInventory, fake).scan(),
      (error) => error instanceof V2CandidateInventoryError,
    );
  }

  const tieTime = "2026-01-01T00:00:00.000Z";
  const tied = fakeGraphQL({
    datasets: () => [candidate(2), candidate(1)],
    nodeProjection: (node) => ({ ...node, createdAt: tieTime }),
  });
  const inventory = await createCurrentOpen(candidateInventory, tied).scan();
  assert.deepEqual(
    inventory.current_open_pull_requests.map(({ number }) => number),
    [1, 2],
    "CREATED_AT ties are canonicalized without assuming a server number order",
  );

  const wideId = "9007199254740993";
  const wide = await createCurrentOpen(candidateInventory, fakeGraphQL({
    datasets: () => candidateRange(1, 1),
    nodeProjection: (node) => ({ ...node, fullDatabaseId: wideId }),
  })).scan();
  assert.equal(
    wide.current_open_pull_requests[0].id,
    wideId,
    "GraphQL BigInt IDs stay exact beyond Number.MAX_SAFE_INTEGER",
  );
});

test("current-open GraphQL rejects errors, partial data, and duplicate JSON keys", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  for (const responseProjection of [
    () => ({ data: null, errors: [{ message: "denied" }] }),
    ({ response }) => ({ ...response, extensions: {} }),
  ]) {
    const fake = fakeGraphQL({
      datasets: () => candidateRange(1, 1),
      responseProjection,
    });
    await assert.rejects(
      createCurrentOpen(candidateInventory, fake).scan(),
      (error) => error.code === "CANDIDATE_PAGE_MALFORMED",
    );
  }
  const inaccessible = fakeGraphQL({
    datasets: () => candidateRange(1, 1),
    responseProjection: () => ({ data: { repository: null } }),
  });
  await assert.rejects(
    createCurrentOpen(candidateInventory, inaccessible).scan(),
    (error) => error.code === "CANDIDATE_INACCESSIBLE",
  );
  const valid = graphqlResponse(
    [graphqlPullRequest(candidate(1))],
    { hasNextPage: false, endCursor: "opaque:1:1" },
  );
  const duplicateJsonFetch = async () => jsonTextResponse(
    `{"data":null,"data":${JSON.stringify(valid.data)}}`,
    {
      Date: "Thu, 13 Aug 2026 12:00:00 GMT",
      "X-GitHub-Request-Id": "TEST:DUPLICATE-JSON",
    },
  );
  await assert.rejects(
    candidateInventory.createV2GitHubCurrentOpenCandidateInventory({
      fetch: duplicateJsonFetch,
      token: "synthetic-current-open-inventory-token",
      repository: REPOSITORY,
      graphqlUrl: GRAPHQL_URL,
    }).scan(),
    (error) => error.code === "CANDIDATE_PAGE_MALFORMED",
  );
});

test("current-open offline replay rejects duplicate request-id metadata", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  const factory = createCurrentOpen(candidateInventory, fakeGraphQL({
    datasets: () => candidateRange(1, 1),
  }));
  const inventory = await factory.scan();
  const projection = factory.projectForGitLedger(inventory);
  const forged = structuredClone(projection);
  const pageReceipt = forged.receipt.passes[0].pages[0];
  const rawPage = forged.raw_passes[0].pages[0];
  forged.receipt.passes[0].final_fence = {
    ...structuredClone(pageReceipt),
    kind: "fence",
  };
  forged.receipt.passes[0].observation_window.completed_at =
    pageReceipt.server_time;
  forged.raw_passes[0].final_fence = {
    ...structuredClone(rawPage),
    kind: "fence",
  };
  const { receipt_digest: _receiptDigest, ...withoutDigest } = forged.receipt;
  forged.receipt.receipt_digest = canonicalDigest(
    "codex-review-gate-v2-current-open-candidate-inventory",
    withoutDigest,
  );
  assert.throws(
    () => candidateInventory
      .validateV2CurrentOpenCandidateInventoryGitLedgerProjection(
        forged,
        REPOSITORY,
      ),
    /request identity.*reused/u,
  );
});

test("current-open GraphQL bounds chunked bodies and keeps one deadline through EOF", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  for (const declaredLength of [null, "1"]) {
    let pulls = 0;
    let cancelled = false;
    const fetch = async () => new Response(new ReadableStream({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    }), {
      status: 200,
      headers: {
        Date: "Thu, 13 Aug 2026 12:00:00 GMT",
        "X-GitHub-Request-Id": `TEST:STREAM:${declaredLength ?? "none"}`,
        ...(declaredLength === null ? {} : { "Content-Length": declaredLength }),
      },
    });
    await assert.rejects(
      candidateInventory.createV2GitHubCurrentOpenCandidateInventory({
        fetch,
        token: "synthetic-current-open-inventory-token",
        repository: REPOSITORY,
        graphqlUrl: GRAPHQL_URL,
      }).scan(),
      (error) => error.code === "CANDIDATE_RESPONSE_TOO_LARGE",
    );
    await nextCleanupTurn();
    assert.ok(pulls <= 4, "streaming stops at the first cap-crossing chunk");
    assert.equal(cancelled, true);
  }

  const slowFetch = async () => new Response(new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
  }), {
    status: 200,
    headers: {
      Date: "Thu, 13 Aug 2026 12:00:00 GMT",
      "X-GitHub-Request-Id": "TEST:SLOW",
    },
  });
  const startedAt = Date.now();
  await assert.rejects(
    candidateInventory.createV2GitHubCurrentOpenCandidateInventory({
      fetch: slowFetch,
      token: "synthetic-current-open-inventory-token",
      repository: REPOSITORY,
      graphqlUrl: GRAPHQL_URL,
      timeoutMs: 25,
    }).scan(),
    (error) => error.code === "CANDIDATE_HTTP_TIMEOUT",
  );
  assert.ok(Date.now() - startedAt < 1_000);
});

test("current-open rejects empty and over-fragmented response bodies", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  for (const scenario of [
    {
      datasets: () => candidateRange(1, 1),
      fragment: { emptyChunks: 50_000 },
      code: "CANDIDATE_HTTP_UNREADABLE",
      maxPulls: 1,
    },
    {
      datasets: () => candidateRange(1, 100),
      fragment: { chunkSize: 1 },
      code: "CANDIDATE_RESPONSE_FRAGMENTED",
      maxPulls: 4_097,
    },
  ]) {
    const fake = fakeGraphQL({ datasets: scenario.datasets });
    const tracker = { pulls: 0, cancellations: 0 };
    const fetch = fragmentResponseBody(fake.fetch, scenario.fragment, tracker);
    await assert.rejects(
      candidateInventory.createV2GitHubCurrentOpenCandidateInventory({
        fetch,
        token: "synthetic-current-open-inventory-token",
        repository: REPOSITORY,
        graphqlUrl: GRAPHQL_URL,
      }).scan(),
      (error) => error.code === scenario.code,
    );
    await nextCleanupTurn();
    assert.ok(tracker.pulls <= scenario.maxPulls);
    assert.equal(tracker.cancellations, 1);
  }
});

test("current-open monotonic deadline survives immediately-ready body chunks", async () => {
  const candidateInventory = await import(
    "../packages/action/src/v2/candidate-inventory.mjs"
  );
  const tracker = { pulls: 0, cancellations: 0 };
  const responseBytes = Buffer.from(JSON.stringify(graphqlResponse(
    [graphqlPullRequest(candidate(1))],
    { hasNextPage: false, endCursor: "opaque:1:1" },
  )), "utf8");
  const fetch = async () => {
    let offset = 0;
    return {
      status: 200,
      headers: new Headers({
        Date: "Thu, 13 Aug 2026 12:00:00 GMT",
        "X-GitHub-Request-Id": "TEST:READY-MICROTASKS",
      }),
      body: {
        getReader() {
          return {
            read() {
              tracker.pulls += 1;
              if (offset >= responseBytes.byteLength) {
                return Promise.resolve({ done: true, value: undefined });
              }
              const value = responseBytes.subarray(offset, offset + 1);
              offset += 1;
              return Promise.resolve({ done: false, value });
            },
            cancel() {
              tracker.cancellations += 1;
              return Promise.resolve();
            },
            releaseLock() {},
          };
        },
      },
    };
  };
  await assert.rejects(
    candidateInventory.createV2GitHubCurrentOpenCandidateInventory({
      fetch,
      token: "synthetic-current-open-inventory-token",
      repository: REPOSITORY,
      graphqlUrl: GRAPHQL_URL,
      timeoutMs: 1,
    }).scan(),
    (error) => error.code === "CANDIDATE_HTTP_TIMEOUT",
  );
  await nextCleanupTurn();
  assert.ok(tracker.pulls <= 128, "deadline checking bounds ready microtasks");
  assert.equal(tracker.cancellations, 1);
});

test("candidate request tails cannot outlive the monotonic deadline", async () => {
  const performanceNowDescriptor = Object.getOwnPropertyDescriptor(
    performance,
    "now",
  );
  const setTimeoutDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "setTimeout",
  );
  const clearTimeoutDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "clearTimeout",
  );
  let monotonicTime = 0;
  let timerCallbackCount = 0;
  const timerHandles = [];
  Object.defineProperty(performance, "now", {
    configurable: true,
    value: () => monotonicTime,
    writable: true,
  });
  Object.defineProperty(globalThis, "setTimeout", {
    ...setTimeoutDescriptor,
    value(callback, delay, ...args) {
      const handle = {
        callback() {
          timerCallbackCount += 1;
          Reflect.apply(callback, undefined, args);
        },
        cleared: false,
        delay,
      };
      timerHandles.push(handle);
      return handle;
    },
  });
  Object.defineProperty(globalThis, "clearTimeout", {
    ...clearTimeoutDescriptor,
    value(handle) {
      handle.cleared = true;
    },
  });
  let isolatedCandidateInventory;
  try {
    isolatedCandidateInventory = await import(
      "../packages/action/src/v2/candidate-inventory.mjs?deadline-tail"
    );
  } finally {
    if (performanceNowDescriptor === undefined) {
      delete performance.now;
    } else {
      Object.defineProperty(performance, "now", performanceNowDescriptor);
    }
    Object.defineProperty(globalThis, "setTimeout", setTimeoutDescriptor);
    Object.defineProperty(globalThis, "clearTimeout", clearTimeoutDescriptor);
  }

  const stateAllFake = fakeGitHub({
    datasets: () => candidateRange(1, 1),
  });
  const stateAllFetch = async (input, init) => {
    const response = await stateAllFake.fetch(input, init);
    return {
      status: response.status,
      headers: {
        get(name) {
          const value = response.headers.get(name);
          if (name.toLowerCase() === "link") monotonicTime += 11;
          return value;
        },
      },
      body: response.body,
    };
  };
  await assert.rejects(
    isolatedCandidateInventory.createV2GitHubCandidateInventory({
      fetch: stateAllFetch,
      token: "synthetic-candidate-inventory-token",
      repository: REPOSITORY,
      restBaseUrl: API,
      timeoutMs: 10,
    }).scan(),
    (error) => error.code === "CANDIDATE_HTTP_TIMEOUT",
  );

  monotonicTime = 0;
  const parseDescriptor = Object.getOwnPropertyDescriptor(JSON, "parse");
  const originalParse = parseDescriptor.value;
  Object.defineProperty(JSON, "parse", {
    ...parseDescriptor,
    value(value, ...args) {
      const parsed = Reflect.apply(originalParse, JSON, [value, ...args]);
      if (typeof value === "string" && value.startsWith('{"data":')) {
        monotonicTime += 11;
      }
      return parsed;
    },
  });
  try {
    const currentOpenFake = fakeGraphQL({
      datasets: () => candidateRange(1, 1),
    });
    await assert.rejects(
      createCurrentOpen(isolatedCandidateInventory, currentOpenFake, {
        timeoutMs: 10,
      }).scan(),
      (error) => error.code === "CANDIDATE_HTTP_TIMEOUT",
    );
  } finally {
    Object.defineProperty(JSON, "parse", parseDescriptor);
  }

  assert.equal(timerCallbackCount, 0);
  assert.equal(timerHandles.length, 2);
  assert.ok(timerHandles.every(({ cleared }) => cleared));
});

test("state=all transport shares the bounded response chunk profile", async () => {
  const fake = fakeGitHub({ datasets: () => candidateRange(1, 1) });
  const tracker = { pulls: 0, cancellations: 0 };
  const fetch = fragmentResponseBody(
    fake.fetch,
    { emptyChunks: 1 },
    tracker,
  );
  await assert.rejects(
    createTransport(fetch).scan(),
    (error) => error.code === "CANDIDATE_HTTP_UNREADABLE",
  );
  await nextCleanupTurn();
  assert.equal(tracker.pulls, 1);
  assert.equal(tracker.cancellations, 1);
});

test("final cycle rejects close and reopen drift after the identity scan", async () => {
  for (const [before, after] of [
    ["open", "closed"],
    ["closed", "open"],
  ]) {
    let exactRead = 0;
    const fake = fakeGitHub({
      datasets: () => candidateRange(1, 1),
      lifecycle: () => {
        exactRead += 1;
        return exactRead === 1 ? before : after;
      },
    });
    const transport = createTransport(fake.fetch);
    const initial = await transport.scan();
    const shard = await transport.readShard({
      inventory: initial,
      shard_index: 0,
    });
    const final = await transport.scan({ prior_inventory: initial });
    const finalShard = await transport.readShard({
      inventory: final,
      shard_index: 0,
    });

    assert.throws(
      () => finalizeV2CandidateInventoryCycle({
        initial_inventory: initial,
        shard_receipts: [shard],
        final_inventory: final,
        final_shard_receipts: [finalShard],
      }),
      (error) => {
        assert.ok(error instanceof V2CandidateInventoryError);
        assert.equal(error.code, "CANDIDATE_LIFECYCLE_DRIFT");
        return true;
      },
      `${before} -> ${after} must not close a stable cycle`,
    );
  }
});

test("a PR created after the first pass extends the high watermark before stability", async () => {
  const first = candidateRange(1, 2);
  const expanded = candidateRange(1, 3);
  const fake = fakeGitHub({
    datasets: (pass) => pass === 1 ? first : expanded,
  });
  const inventory = await createTransport(fake.fetch).scan();

  assert.equal(inventory.passes.length, 3);
  assert.equal(inventory.candidates.length, 3);
  assert.equal(inventory.high_watermark.number, 3);
  assert.deepEqual(
    inventory.passes.map(({ candidates }) => candidates.length),
    [2, 3, 3],
  );
});

test("the protected prior candidate superset never shrinks on scan absence", async () => {
  const initialFake = fakeGitHub({ datasets: () => candidateRange(1, 3) });
  const initial = await createTransport(initialFake.fetch).scan();
  const laterFake = fakeGitHub({ datasets: () => candidateRange(3, 3) });
  const later = await createTransport(laterFake.fetch).scan({
    prior_inventory: initial,
  });

  assert.deepEqual(later.candidates.map(({ number }) => number), [1, 2, 3]);
  assert.deepEqual(later.retained_prior_candidate_ids, [
    candidate(1).id,
    candidate(2).id,
  ]);
  assert.deepEqual(validateV2CandidateInventory(later), later);

  const outside = structuredClone(later);
  outside.retained_prior_candidate_ids = ["999999"];
  assert.throws(
    () => validateV2CandidateInventory(outside),
    /retained id is outside the superset/u,
  );
  const duplicated = structuredClone(later);
  duplicated.retained_prior_candidate_ids = [
    candidate(1).id,
    candidate(1).id,
  ];
  assert.throws(
    () => validateV2CandidateInventory(duplicated),
    /must be unique and sorted/u,
  );
  const reversed = structuredClone(later);
  reversed.retained_prior_candidate_ids.reverse();
  assert.throws(
    () => validateV2CandidateInventory(reversed),
    /must be unique and sorted/u,
  );
});

test("validated inventory cache brands only module-produced frozen snapshots",
  async () => {
    const originalStructuredClone = globalThis.structuredClone;
    let fullInventoryCloneCount = 0;
    globalThis.structuredClone = (value, options) => {
      if (value?.schema === "codex-review-gate-candidate-inventory-v2") {
        fullInventoryCloneCount += 1;
      }
      return originalStructuredClone(value, options);
    };
    let isolatedInventory;
    try {
      isolatedInventory = await import(
        "../packages/action/src/v2/candidate-inventory.mjs?validated-cache-regression=1"
      );
    } finally {
      globalThis.structuredClone = originalStructuredClone;
    }

    const fake = fakeGitHub({ datasets: () => candidateRange(1, 300) });
    const transport = isolatedInventory.createV2GitHubCandidateInventory({
      fetch: fake.fetch,
      token: "synthetic-candidate-inventory-token",
      repository: REPOSITORY,
      restBaseUrl: API,
    });
    const initial = await transport.scan();
    const initialShards = [];
    for (let index = 0; index < initial.shards.length; index += 1) {
      initialShards.push(await transport.readShard({
        inventory: initial,
        shard_index: index,
      }));
    }
    const final = await transport.scan({ prior_inventory: initial });
    const finalShards = [];
    for (let index = 0; index < final.shards.length; index += 1) {
      finalShards.push(await transport.readShard({
        inventory: final,
        shard_index: index,
      }));
    }

    fullInventoryCloneCount = 0;
    isolatedInventory.finalizeV2CandidateInventoryCycle({
      initial_inventory: initial,
      shard_receipts: initialShards,
      final_inventory: final,
      final_shard_receipts: finalShards,
    });
    assert.equal(
      fullInventoryCloneCount,
      0,
      "one finalized cycle must not revalidate its branded inventories per shard",
    );
    assert.equal(
      isolatedInventory.validateV2CandidateInventory(initial),
      initial,
    );
    assert.equal(fullInventoryCloneCount, 0);
    assert.throws(
      () => isolatedInventory.validateV2CandidateInventory(initial, {
        ...REPOSITORY,
        id: "502",
        node_id: "R_foreign",
      }),
      /repository differs from expected scope/u,
    );
    assert.equal(fullInventoryCloneCount, 0);
    const originalFirstCandidateId = initial.candidates[0].id;
    assert.throws(
      () => {
        initial.candidates[0].id = "999999";
      },
      TypeError,
    );
    assert.equal(initial.candidates[0].id, originalFirstCandidateId);
    assert.equal(fullInventoryCloneCount, 0);

    const clone = originalStructuredClone(initial);
    const normalizedClone = isolatedInventory.validateV2CandidateInventory(clone);
    assert.notEqual(normalizedClone, clone);
    assert.equal(fullInventoryCloneCount, 1);
    assert.equal(
      isolatedInventory.validateV2CandidateInventory(normalizedClone),
      normalizedClone,
    );
    assert.equal(fullInventoryCloneCount, 1);
    const renormalizedClone = isolatedInventory.validateV2CandidateInventory(
      clone,
    );
    assert.notEqual(renormalizedClone, normalizedClone);
    assert.equal(fullInventoryCloneCount, 2);

    const foreignFake = fakeGitHub({ datasets: () => candidateRange(1, 2) });
    const foreignInventory = await createTransport(foreignFake.fetch).scan();
    const normalizedForeign = isolatedInventory.validateV2CandidateInventory(
      foreignInventory,
    );
    assert.notEqual(normalizedForeign, foreignInventory);
    assert.equal(fullInventoryCloneCount, 3);
    assert.notEqual(
      isolatedInventory.validateV2CandidateInventory(foreignInventory),
      normalizedForeign,
    );
    assert.equal(fullInventoryCloneCount, 4);

    const weakMapGetDescriptor = Object.getOwnPropertyDescriptor(
      WeakMap.prototype,
      "get",
    );
    const weakMapSetDescriptor = Object.getOwnPropertyDescriptor(
      WeakMap.prototype,
      "set",
    );
    let poisonedGetCalls = 0;
    let poisonedSetCalls = 0;
    const poisonedClone = originalStructuredClone(initial);
    Object.defineProperty(WeakMap.prototype, "get", {
      ...weakMapGetDescriptor,
      value() {
        poisonedGetCalls += 1;
        return initial;
      },
    });
    Object.defineProperty(WeakMap.prototype, "set", {
      ...weakMapSetDescriptor,
      value() {
        poisonedSetCalls += 1;
        return this;
      },
    });
    try {
      assert.equal(
        isolatedInventory.validateV2CandidateInventory(initial),
        initial,
      );
      const normalizedPoisonedClone =
        isolatedInventory.validateV2CandidateInventory(poisonedClone);
      assert.notEqual(normalizedPoisonedClone, poisonedClone);
      assert.notEqual(normalizedPoisonedClone, initial);
      assert.equal(
        isolatedInventory.validateV2CandidateInventory(
          normalizedPoisonedClone,
        ),
        normalizedPoisonedClone,
      );
      assert.equal(fullInventoryCloneCount, 5);
    } finally {
      Object.defineProperty(
        WeakMap.prototype,
        "get",
        weakMapGetDescriptor,
      );
      Object.defineProperty(
        WeakMap.prototype,
        "set",
        weakMapSetDescriptor,
      );
    }
    assert.equal(poisonedGetCalls, 0);
    assert.equal(poisonedSetCalls, 0);

    const mutated = originalStructuredClone(initial);
    mutated.receipt_digest = `sha256:${"0".repeat(64)}`;
    assert.throws(
      () => isolatedInventory.validateV2CandidateInventory(mutated),
      /receipt digest is invalid/u,
    );
    assert.equal(fullInventoryCloneCount, 5);
  });

test("more than 256 candidates produce canonical continuation shards", async () => {
  const fake = fakeGitHub({ datasets: () => candidateRange(1, 300) });
  const inventory = await createTransport(fake.fetch).scan();

  assert.equal(inventory.shards.length, 2);
  assert.equal(inventory.shards[0].candidates.length, MAX_V2_CANDIDATES_PER_SHARD);
  assert.equal(inventory.shards[0].next_shard_index, 1);
  assert.equal(inventory.shards[1].candidates.length, 44);
  assert.equal(inventory.shards[1].next_shard_index, null);

  const first = await createTransport(fake.fetch).readShard({
    inventory,
    shard_index: 0,
  });
  const second = await createTransport(fake.fetch).readShard({
    inventory,
    shard_index: 1,
  });
  assert.equal(first.observations.length, 256);
  assert.equal(second.observations.length, 44);
});

test("a multi-shard cycle closes only after the complete final lifecycle round", async () => {
  const fake = fakeGitHub({ datasets: () => candidateRange(1, 300) });
  const transport = createTransport(fake.fetch);
  const initial = await transport.scan();
  const firstRound = [];
  for (let index = 0; index < initial.shards.length; index += 1) {
    firstRound.push(await transport.readShard({
      inventory: initial,
      shard_index: index,
    }));
  }
  const final = await transport.scan({ prior_inventory: initial });
  const finalRound = [];
  for (let index = 0; index < final.shards.length; index += 1) {
    finalRound.push(await transport.readShard({
      inventory: final,
      shard_index: index,
    }));
  }

  const cycle = finalizeV2CandidateInventoryCycle({
    initial_inventory: initial,
    shard_receipts: firstRound,
    final_inventory: final,
    final_shard_receipts: finalRound,
  });
  assert.deepEqual(validateV2CandidateCycleReceipt(cycle), cycle);
  assert.deepEqual(
    cycle.final_shard_receipts.map(({ shard_index }) => shard_index),
    [0, 1],
  );
  assert.equal(cycle.open_pull_requests.length, 300);

  const reversed = structuredClone(cycle);
  reversed.final_shard_receipts.reverse();
  assert.throws(
    () => validateV2CandidateCycleReceipt(reversed),
    /missing or out of order/u,
  );
});

test("a full page without an exact next Link fails closed", async () => {
  const fake = fakeGitHub({
    datasets: () => candidateRange(1, 100),
    omitNextLink: true,
  });
  await assert.rejects(
    createTransport(fake.fetch).scan(),
    (error) => {
      assert.ok(error instanceof V2CandidateInventoryError);
      assert.equal(error.code, "CANDIDATE_PAGINATION_INCOMPLETE");
      return true;
    },
  );
});

test("final cycle rejects candidate drift during exact per-PR reads", async () => {
  const fake = fakeGitHub({ datasets: () => candidateRange(1, 2) });
  const transport = createTransport(fake.fetch);
  const initial = await transport.scan();
  const shard = await transport.readShard({ inventory: initial, shard_index: 0 });

  const expandedFake = fakeGitHub({ datasets: () => candidateRange(1, 3) });
  const final = await createTransport(expandedFake.fetch).scan({
    prior_inventory: initial,
  });
  assert.throws(
    () => finalizeV2CandidateInventoryCycle({
      initial_inventory: initial,
      shard_receipts: [shard],
      final_inventory: final,
    }),
    (error) => {
      assert.ok(error instanceof V2CandidateInventoryError);
      assert.equal(error.code, "CANDIDATE_INVENTORY_DRIFT");
      return true;
    },
  );
});

function createTransport(fetchImpl) {
  return createV2GitHubCandidateInventory({
    fetch: fetchImpl,
    token: "synthetic-candidate-inventory-token",
    repository: REPOSITORY,
    restBaseUrl: API,
  });
}

function createCurrentOpen(candidateInventory, fake, overrides = {}) {
  return candidateInventory.createV2GitHubCurrentOpenCandidateInventory({
    fetch: fake.fetch,
    token: "synthetic-current-open-inventory-token",
    repository: REPOSITORY,
    graphqlUrl: GRAPHQL_URL,
    ...overrides,
  });
}

function candidateRange(first, last) {
  return Array.from({ length: last - first + 1 }, (_, index) =>
    candidate(first + index));
}

function candidate(number) {
  return {
    id: String(1000 + number),
    node_id: `PR_${number}`,
    number,
    created_at: new Date(Date.UTC(2026, 0, 1, 0, number)).toISOString(),
  };
}

function listCandidate(value, apiBase = API) {
  return {
    ...value,
    url: `${apiBase}/repos/${REPOSITORY.owner}/${REPOSITORY.name}/pulls/${value.number}`,
    state: "open",
  };
}

function pullRequest(value, state, apiBase = API) {
  const merged = state === "merged";
  return {
    ...listCandidate(value, apiBase),
    state: state === "open" ? "open" : "closed",
    merged,
    merged_at: merged ? "2026-08-13T11:00:00Z" : null,
    updated_at: "2026-08-13T12:00:00Z",
    draft: false,
    base: {
      ref: "main",
      sha: "a".repeat(40),
      repo: {
        id: Number(REPOSITORY.id),
        node_id: REPOSITORY.node_id,
        full_name: `${REPOSITORY.owner}/${REPOSITORY.name}`,
      },
    },
    head: {
      ref: `feature-${value.number}`,
      sha: value.number.toString(16).padStart(40, "0"),
      repo: {
        id: Number(REPOSITORY.id),
        node_id: REPOSITORY.node_id,
        full_name: `${REPOSITORY.owner}/${REPOSITORY.name}`,
      },
    },
  };
}

function graphqlRepository() {
  return {
    id: REPOSITORY.node_id,
    databaseId: Number(REPOSITORY.id),
    nameWithOwner: `${REPOSITORY.owner}/${REPOSITORY.name}`,
  };
}

function graphqlPullRequest(
  value,
  { updatedAt = "2026-08-13T12:00:00.000Z" } = {},
) {
  return {
    id: value.node_id,
    fullDatabaseId: value.id,
    number: value.number,
    state: "OPEN",
    isDraft: false,
    createdAt: value.created_at,
    updatedAt,
    headRefOid: value.number.toString(16).padStart(40, "0"),
    headRefName: `feature-${value.number}`,
    baseRefOid: "a".repeat(40),
    baseRefName: "main",
    headRepository: graphqlRepository(),
    baseRepository: graphqlRepository(),
  };
}

function graphqlResponse(nodes, pageInfo) {
  return {
    data: {
      repository: {
        ...graphqlRepository(),
        pullRequests: { nodes, pageInfo },
      },
    },
  };
}

function fakeGraphQL({
  datasets,
  graphqlUrl = GRAPHQL_URL,
  nodeProjection = (node) => node,
  pageInfoProjection = ({ pageInfo }) => pageInfo,
  fenceProjection = ({ response }) => response,
  responseProjection = ({ response }) => response,
}) {
  const calls = [];
  let pass = 0;
  let responseCount = 0;
  let active = null;
  const fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    responseCount += 1;
    const date = new Date(Date.UTC(2026, 7, 13, 12, 0, responseCount))
      .toUTCString();
    if (url.href !== graphqlUrl) {
      return jsonResponse({ message: "not found" }, { Date: date }, 404);
    }
    let request;
    try {
      const requestBytes = typeof init.body === "string"
        ? Buffer.from(init.body, "utf8")
        : Buffer.from(init.body ?? []);
      request = JSON.parse(requestBytes.toString("utf8"));
    } catch {
      return jsonResponse({ message: "bad request" }, { Date: date }, 400);
    }
    const variables = request.variables ?? {};
    const inputCursor = variables.after;
    let kind;
    let page;
    let start;
    if (inputCursor === null && active?.awaitingFence === true) {
      kind = "fence";
      page = 1;
      start = 0;
    } else if (inputCursor === null && active === null) {
      pass += 1;
      active = {
        pass,
        dataset: datasets(pass),
        awaitingFence: false,
        expectedCursor: null,
        nextOffset: 0,
        page: 0,
      };
      kind = "page";
      page = 1;
      start = 0;
      active.page = 1;
    } else if (
      typeof inputCursor === "string" &&
      active !== null &&
      active.awaitingFence === false &&
      inputCursor === active.expectedCursor
    ) {
      kind = "page";
      active.page += 1;
      page = active.page;
      start = active.nextOffset;
    } else {
      return jsonResponse(
        { errors: [{ message: "unexpected cursor" }] },
        {
          Date: date,
          "X-GitHub-Request-Id": `TEST:${responseCount}`,
        },
      );
    }
    const currentPass = active.pass;
    const selected = active.dataset;
    const end = Math.min(start + 100, selected.length);
    const nodes = selected.slice(start, end).map((value, index) =>
      nodeProjection(graphqlPullRequest(value), {
        pass: currentPass,
        kind,
        page,
        index,
      }));
    const defaultPageInfo = {
      hasNextPage: end < selected.length,
      endCursor: nodes.length === 0
        ? null
        : `opaque:${currentPass}:${end}`,
    };
    const pageInfo = pageInfoProjection({
      pass: currentPass,
      kind,
      page,
      inputCursor,
      pageInfo: defaultPageInfo,
    });
    let response = graphqlResponse(nodes, pageInfo);
    if (kind === "fence") {
      response = fenceProjection({
        pass: currentPass,
        kind,
        page,
        inputCursor,
        response,
      });
    }
    response = responseProjection({
      pass: currentPass,
      kind,
      page,
      inputCursor,
      response,
    });
    calls.push({
      kind,
      pass: currentPass,
      page,
      input_cursor: inputCursor,
      url: url.href,
      method: init.method,
      query: request.query,
      variables: structuredClone(variables),
      api_version: init.headers?.["X-GitHub-Api-Version"] ?? null,
    });
    if (kind === "fence") {
      active = null;
    } else if (pageInfo.hasNextPage === true) {
      active.expectedCursor = pageInfo.endCursor;
      active.nextOffset = end;
    } else {
      active.awaitingFence = true;
    }
    return jsonResponse(response, {
      Date: date,
      "X-GitHub-Request-Id": `TEST:${responseCount}`,
    });
  };
  return { fetch, calls };
}

function fragmentResponseBody(
  fetchImpl,
  { emptyChunks = 0, chunkSize = null },
  tracker,
) {
  return async (input, init) => {
    const response = await fetchImpl(input, init);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let emptyRemaining = emptyChunks;
    let offset = 0;
    return {
      status: response.status,
      headers: response.headers,
      body: {
        getReader() {
          return {
            read() {
              tracker.pulls += 1;
              if (emptyRemaining > 0) {
                emptyRemaining -= 1;
                return Promise.resolve({
                  done: false,
                  value: new Uint8Array(0),
                });
              }
              if (offset >= bytes.byteLength) {
                return Promise.resolve({ done: true, value: undefined });
              }
              const end = chunkSize === null
                ? bytes.byteLength
                : Math.min(bytes.byteLength, offset + chunkSize);
              const value = bytes.slice(offset, end);
              offset = end;
              return Promise.resolve({ done: false, value });
            },
            cancel() {
              tracker.cancellations += 1;
              return Promise.resolve();
            },
            releaseLock() {},
          };
        },
      },
    };
  };
}

function plainGraphqlFetch(
  value,
  { requestId = (index) => `TEST:PLAIN:${index}` } = {},
) {
  const bytes = new Uint8Array(Buffer.from(JSON.stringify(graphqlResponse(
    [graphqlPullRequest(value)],
    { hasNextPage: false, endCursor: `opaque:${value.number}` },
  )), "utf8"));
  let requests = 0;
  return async () => {
    requests += 1;
    let delivered = false;
    return {
      status: 200,
      headers: {
        get(name) {
          switch (name.toLowerCase()) {
            case "date":
              return "Thu, 13 Aug 2026 12:00:00 GMT";
            case "x-github-request-id":
              return requestId(requests);
            case "content-length":
              return String(bytes.byteLength);
            default:
              return null;
          }
        },
      },
      body: {
        getReader() {
          return {
            read() {
              if (delivered) {
                return Promise.resolve({ done: true, value: undefined });
              }
              delivered = true;
              return Promise.resolve({ done: false, value: bytes });
            },
            cancel() {
              return Promise.resolve();
            },
            releaseLock() {},
          };
        },
      },
    };
  };
}

async function withTruncatedArrayIterator(operation) {
  const iteratorPrototype = Object.getPrototypeOf([][Symbol.iterator]());
  const nextDescriptor = Object.getOwnPropertyDescriptor(
    iteratorPrototype,
    "next",
  );
  const originalNext = nextDescriptor.value;
  const promiseResolve = Promise.resolve;
  const promiseThen = Promise.prototype.then;
  const marker = Symbol("current-open-array-iterator-step");
  Object.defineProperty(iteratorPrototype, "next", {
    ...nextDescriptor,
    value(...args) {
      const step = this[marker] ?? 0;
      Object.defineProperty(this, marker, {
        configurable: true,
        value: step + 1,
        writable: true,
      });
      if (step === 0) return Reflect.apply(originalNext, this, args);
      const skipped = Reflect.apply(originalNext, this, args);
      if (!skipped.done) {
        const promise = Reflect.apply(promiseResolve, Promise, [skipped.value]);
        Reflect.apply(promiseThen, promise, [undefined, () => {}]);
      }
      return { done: true, value: undefined };
    },
  });
  let error = null;
  try {
    await operation();
  } catch (caught) {
    error = caught;
  } finally {
    Object.defineProperty(iteratorPrototype, "next", nextDescriptor);
  }
  return { error };
}

function listPullRequest(
  value,
  apiBase = API,
  { updatedAt = "2026-08-13T12:00:00Z" } = {},
) {
  const { merged: _merged, ...simple } = pullRequest(value, "open", apiBase);
  return { ...simple, updated_at: updatedAt };
}

function fakeGitHub({
  datasets,
  lifecycle = () => "open",
  omitNextLink = false,
  omitFinalNextLink = false,
  listProjection = listCandidate,
  apiBase = API,
  terminalRelations = false,
  misleadingLastPage = null,
}) {
  const calls = [];
  let pass = 0;
  let responseCount = 0;
  const fetch = async (input) => {
    const url = new URL(String(input));
    responseCount += 1;
    const date = new Date(Date.UTC(2026, 7, 13, 12, 0, responseCount))
      .toUTCString();
    const apiUrl = new URL(apiBase);
    const apiPath = apiUrl.pathname.replace(/\/$/u, "");
    const listPath = `${apiPath}/repos/${REPOSITORY.owner}/${REPOSITORY.name}/pulls`;
    if (url.pathname === listPath && url.searchParams.has("state")) {
      const page = Number(url.searchParams.get("page"));
      if (page === 1) pass += 1;
      const selected = datasets(pass);
      const start = (page - 1) * 100;
      const items = selected.slice(start, start + 100)
        .map((value) => listProjection(value, apiBase, pass));
      const hasNext = start + 100 < selected.length || items.length === 100;
      const fullFinalPage = items.length === 100 &&
        start + items.length === selected.length;
      const headers = { Date: date };
      if (hasNext && !omitNextLink &&
          !(omitFinalNextLink && fullFinalPage)) {
        const next = new URL(`${apiUrl.origin}${listPath}`);
        for (const [key, value] of [
          ["state", url.searchParams.get("state")],
          ["sort", "created"],
          ["direction", "asc"],
          ["per_page", "100"],
          ["page", String(page + 1)],
        ]) next.searchParams.set(key, value);
        headers.Link = `<${next.href}>; rel="next"`;
      }
      if (headers.Link === undefined && terminalRelations) {
        const relations = [];
        for (const [relation, targetPage] of [
          ["prev", page > 1 ? page - 1 : null],
          ["first", 1],
        ]) {
          if (targetPage === null) continue;
          relations.push(linkRelation({
            apiUrl,
            listPath,
            state: url.searchParams.get("state"),
            page: targetPage,
            relation,
          }));
        }
        headers.Link = relations.join(", ");
      }
      if (misleadingLastPage !== null &&
          page === Math.ceil(selected.length / 100)) {
        headers.Link = linkRelation({
          apiUrl,
          listPath,
          state: url.searchParams.get("state"),
          page: misleadingLastPage,
          relation: "last",
        });
      }
      calls.push({
        kind: "list",
        pass,
        page,
        state: url.searchParams.get("state"),
        sort: url.searchParams.get("sort"),
        direction: url.searchParams.get("direction"),
      });
      return jsonResponse(items, headers);
    }
    const match = url.pathname.match(
      new RegExp(`^${listPath}/([1-9][0-9]*)$`, "u"),
    );
    if (match !== null) {
      const number = Number(match[1]);
      const selected = candidate(number);
      calls.push({ kind: "exact", number });
      return jsonResponse(
        pullRequest(selected, lifecycle(number), apiBase),
        { Date: date },
      );
    }
    return jsonResponse({ message: "not found" }, { Date: date }, 404);
  };
  return { fetch, calls };
}

function linkRelation({ apiUrl, listPath, state, page, relation }) {
  const target = new URL(`${apiUrl.origin}${listPath}`);
  for (const [key, value] of [
    ["state", state],
    ["sort", "created"],
    ["direction", "asc"],
    ["per_page", "100"],
    ["page", String(page)],
  ]) target.searchParams.set(key, value);
  return `<${target.href}>; rel="${relation}"`;
}

function rawSha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalDigest(domain, value) {
  return rawSha256(`${domain}\n${canonicalJson(value)}\n`);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function jsonResponse(value, headers, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

function jsonTextResponse(value, headers, status = 200) {
  return new Response(value, {
    status,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

function nextCleanupTurn() {
  return new Promise((resolve) => scheduleImmediate(resolve));
}

function blockEventLoop(durationMs) {
  const deadline = performance.now() + durationMs;
  while (performance.now() < deadline) {
    // Exercise a synchronously blocking untrusted cleanup adapter.
  }
}
