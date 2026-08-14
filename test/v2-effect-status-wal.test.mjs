import assert from "node:assert/strict";
import test from "node:test";

import {
  V2_EFFECT_STATUS_CONTEXT_PREFIX,
  createV2GitHubEffectStatusWal,
} from "../packages/action/src/v2/effect-status-wal.mjs";

const HEAD = "a".repeat(40);
const INTENT = `sha256:${"b".repeat(64)}`;
const RESPONSE = `sha256:${"c".repeat(64)}`;
const CREATOR = {
  id: "15368",
  node_id: "MDM6QXBwMTUzNjg=",
  login: "github-actions[bot]",
  type: "Bot",
};

test("effect WAL writes intent before response and exact-refetches both statuses", async () => {
  const fixture = githubFixture();
  const wal = makeWal(fixture.fetch);

  const intent = await wal.persistIntent({
    head_ref_oid: HEAD,
    ordinal: 1,
    intent_digest: INTENT,
  });
  assert.equal(intent.phase, "intent");
  assert.equal(intent.status.state, "pending");
  assert.equal(intent.status.description, `intent:${INTENT}`);

  const response = await wal.persistResponse({
    head_ref_oid: HEAD,
    ordinal: 1,
    intent_digest: INTENT,
    response_digest: RESPONSE,
  });
  assert.equal(response.phase, "response");
  assert.equal(response.status.state, "success");
  assert.equal(response.status.description, `response:${RESPONSE}`);

  const loaded = await wal.load({ head_ref_oid: HEAD });
  assert.equal(loaded.record_count, 1);
  assert.equal(loaded.next_ordinal, 2);
  assert.equal(loaded.records[0].intent.digest, INTENT);
  assert.equal(loaded.records[0].response.digest, RESPONSE);
  assert.equal(
    fixture.calls.filter((call) => call.method === "POST").length,
    2,
  );
  assert.deepEqual(
    fixture.calls.filter((call) => call.method === "POST")
      .map((call) => JSON.parse(call.body)),
    [
      {
        state: "pending",
        context: `${V2_EFFECT_STATUS_CONTEXT_PREFIX}1`,
        description: `intent:${INTENT}`,
      },
      {
        state: "success",
        context: `${V2_EFFECT_STATUS_CONTEXT_PREFIX}1`,
        description: `response:${RESPONSE}`,
      },
    ],
  );
});

test("an existing ordinal is consumed and cannot be refunded or replayed", async () => {
  const fixture = githubFixture({
    statuses: [status({ id: 1, phase: "intent", digest: INTENT })],
  });
  const wal = makeWal(fixture.fetch);
  await assert.rejects(
    wal.persistIntent({
      head_ref_oid: HEAD,
      ordinal: 1,
      intent_digest: INTENT,
    }),
    /next append-only ordinal 2/u,
  );
  await assert.rejects(
    wal.persistResponse({
      head_ref_oid: HEAD,
      ordinal: 1,
      intent_digest: `sha256:${"d".repeat(64)}`,
      response_digest: RESPONSE,
    }),
    /no exact append-only intent authority/u,
  );
  assert.equal(fixture.calls.some((call) => call.method === "POST"), false);
});

test("duplicate, response-only, gapped, and source-mismatched histories fail closed", async () => {
  const cases = [
    {
      name: "duplicate",
      statuses: [
        status({ id: 1, phase: "intent", digest: INTENT }),
        status({ id: 2, phase: "intent", digest: INTENT }),
      ],
      error: /repeats intent/u,
    },
    {
      name: "response-only",
      statuses: [status({ id: 2, phase: "response", digest: RESPONSE })],
      error: /response without intent/u,
    },
    {
      name: "gap",
      statuses: [status({ id: 3, ordinal: 2, phase: "intent", digest: INTENT })],
      error: /not contiguous/u,
    },
    {
      name: "creator",
      statuses: [status({
        id: 1,
        phase: "intent",
        digest: INTENT,
        creator: { ...CREATOR, id: "999" },
      })],
      error: /source-pinned authority/u,
    },
  ];
  for (const candidate of cases) {
    const fixture = githubFixture({ statuses: candidate.statuses });
    await assert.rejects(
      makeWal(fixture.fetch).load({ head_ref_oid: HEAD }),
      candidate.error,
      candidate.name,
    );
  }
});

test("response status must be semantically later than its intent", async () => {
  const fixture = githubFixture({
    statuses: [
      status({ id: 2, phase: "intent", digest: INTENT }),
      status({ id: 1, phase: "response", digest: RESPONSE }),
    ],
  });
  await assert.rejects(
    makeWal(fixture.fetch).load({ head_ref_oid: HEAD }),
    /response is not after intent/u,
  );
});

test("created status must appear exactly once in paginated history", async () => {
  const fixture = githubFixture({ omitCreatedFromHistory: true });
  await assert.rejects(
    makeWal(fixture.fetch).persistIntent({
      head_ref_oid: HEAD,
      ordinal: 1,
      intent_digest: INTENT,
    }),
    /absent from exact paginated history/u,
  );
  assert.equal(fixture.calls.filter((call) => call.method === "POST").length, 1);
});

function makeWal(fetch) {
  return createV2GitHubEffectStatusWal({
    fetch,
    token: "synthetic-token-for-v2-effect-wal-tests-only",
    repository: { owner: "owner", name: "repo" },
    expected_creator: CREATOR,
    restBaseUrl: "https://api.github.test",
  });
}

function githubFixture({ statuses = [], omitCreatedFromHistory = false } = {}) {
  const records = structuredClone(statuses);
  const calls = [];
  let nextId = records.reduce((maximum, item) =>
    Math.max(maximum, Number(item.id)), 0) + 1;
  let second = 0;
  return {
    calls,
    async fetch(url, init) {
      const parsed = new URL(url);
      calls.push({ method: init.method, url: String(url), body: init.body ?? null });
      second += 1;
      const date = new Date(Date.UTC(2026, 7, 13, 12, 0, second)).toUTCString();
      if (init.method === "POST") {
        const body = JSON.parse(init.body);
        const phase = body.state === "pending" ? "intent" : "response";
        const created = status({
          id: nextId++,
          ordinal: Number(body.context.slice(V2_EFFECT_STATUS_CONTEXT_PREFIX.length)),
          phase,
          digest: body.description.slice(`${phase}:`.length),
          createdAt: new Date(Date.UTC(2026, 7, 13, 12, 0, second)).toISOString(),
        });
        if (!omitCreatedFromHistory) records.push(created);
        return response(201, JSON.stringify(created), date);
      }
      const page = Number(parsed.searchParams.get("page"));
      const body = page === 1 ? records : [];
      return response(200, JSON.stringify(body), date);
    },
  };
}

function status({
  id,
  ordinal = 1,
  phase,
  digest,
  creator = CREATOR,
  createdAt = "2026-08-13T12:00:01.000Z",
}) {
  return {
    id,
    node_id: `CS_${id}`,
    sha: HEAD,
    state: phase === "intent" ? "pending" : "success",
    context: `${V2_EFFECT_STATUS_CONTEXT_PREFIX}${ordinal}`,
    description: `${phase}:${digest}`,
    creator: { ...creator, avatar_url: "https://github.test/avatar" },
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function response(statusCode, body, date) {
  return {
    status: statusCode,
    headers: { get: (name) => name.toLowerCase() === "date" ? date : null },
    async text() { return body; },
  };
}
