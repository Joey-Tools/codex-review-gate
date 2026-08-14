import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_V2_CANDIDATES_PER_SHARD,
  V2CandidateInventoryError,
  createV2GitHubCandidateInventory,
  finalizeV2CandidateInventoryCycle,
  validateV2CandidateCycleReceipt,
  validateV2CandidateInventory,
} from "../packages/action/src/v2/candidate-inventory.mjs";

const API = "https://api.github.com";
const REPOSITORY = Object.freeze({
  owner: "owner",
  name: "repo",
  id: "501",
  node_id: "R_repo",
});

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
  const cycle = finalizeV2CandidateInventoryCycle({
    initial_inventory: initial,
    shard_receipts: [shard],
    final_inventory: final,
  });
  assert.deepEqual(validateV2CandidateCycleReceipt(cycle), cycle);
  assert.equal(cycle.open_pull_requests.length, 149);
  assert.ok(cycle.open_pull_requests.some(({ number }) => number === 101));
  assert.ok(!cycle.open_pull_requests.some(({ number }) => number === 50));
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
  const initialFake = fakeGitHub({ datasets: () => candidateRange(1, 2) });
  const initial = await createTransport(initialFake.fetch).scan();
  const laterFake = fakeGitHub({ datasets: () => candidateRange(2, 2) });
  const later = await createTransport(laterFake.fetch).scan({
    prior_inventory: initial,
  });

  assert.deepEqual(later.candidates.map(({ number }) => number), [1, 2]);
  assert.deepEqual(later.retained_prior_candidate_ids, [candidate(1).id]);
  assert.deepEqual(validateV2CandidateInventory(later), later);
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

function listCandidate(value) {
  return {
    ...value,
    url: `${API}/repos/${REPOSITORY.owner}/${REPOSITORY.name}/pulls/${value.number}`,
    state: "open",
  };
}

function pullRequest(value, state) {
  const merged = state === "merged";
  return {
    ...listCandidate(value),
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

function fakeGitHub({
  datasets,
  lifecycle = () => "open",
  omitNextLink = false,
}) {
  const calls = [];
  let pass = 0;
  let responseCount = 0;
  const fetch = async (input) => {
    const url = new URL(String(input));
    responseCount += 1;
    const date = new Date(Date.UTC(2026, 7, 13, 12, 0, responseCount))
      .toUTCString();
    const listPath = `/repos/${REPOSITORY.owner}/${REPOSITORY.name}/pulls`;
    if (url.pathname === listPath && url.searchParams.has("state")) {
      const page = Number(url.searchParams.get("page"));
      if (page === 1) pass += 1;
      const selected = datasets(pass);
      const start = (page - 1) * 100;
      const items = selected.slice(start, start + 100).map(listCandidate);
      const hasNext = start + 100 < selected.length || items.length === 100;
      const headers = { Date: date };
      if (hasNext && !omitNextLink) {
        const next = new URL(`${API}${listPath}`);
        for (const [key, value] of [
          ["state", "all"],
          ["sort", "created"],
          ["direction", "asc"],
          ["per_page", "100"],
          ["page", String(page + 1)],
        ]) next.searchParams.set(key, value);
        headers.Link = `<${next.href}>; rel="next"`;
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
      return jsonResponse(pullRequest(selected, lifecycle(number)), { Date: date });
    }
    return jsonResponse({ message: "not found" }, { Date: date }, 404);
  };
  return { fetch, calls };
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
