import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { performance } from "node:perf_hooks";
import timers from "node:timers";
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

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

const CLEANUP_BLOCK = new Int32Array(new SharedArrayBuffer(4));

function blockCleanupBriefly() {
  Atomics.wait(CLEANUP_BLOCK, 0, 0, 2);
}

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

test("effect WAL hashes legal UTF-8 bytes and rejects a malformed equivalent", async () => {
  const rawStatus = {
    ...status({ id: 1, phase: "intent", digest: INTENT }),
    marker: "\uFFFD",
  };
  const legalRaw = Buffer.from(JSON.stringify([rawStatus]), "utf8");
  const replacement = Buffer.from("\uFFFD", "utf8");
  const replacementIndex = legalRaw.indexOf(replacement);
  assert.notEqual(replacementIndex, -1);
  const malformedRaw = Buffer.concat([
    legalRaw.subarray(0, replacementIndex),
    Buffer.from([0x80]),
    legalRaw.subarray(replacementIndex + replacement.length),
  ]);

  const legal = await makeWal(githubFixture({
    statuses: [rawStatus],
    inventoryRaw: legalRaw,
  }).fetch)
    .load({ head_ref_oid: HEAD });
  assert.equal(legal.pages[0].raw_body_sha256, sha256(legalRaw));

  await assert.rejects(
    makeWal(githubFixture({
      statuses: [rawStatus],
      inventoryRaw: malformedRaw,
    }).fetch)
      .load({ head_ref_oid: HEAD }),
    /valid UTF-8/u,
  );
});

test("effect WAL cleans up a locked malformed reader without awaiting cancel", async () => {
  let cancelCalled = false;
  let releaseCalled = false;
  const malformedReader = {
    get read() {
      throw new Error("WAL reader shape getter failed");
    },
    cancel() {
      cancelCalled = true;
      return new Promise(() => {});
    },
    releaseLock() {
      releaseCalled = true;
    },
  };
  const wal = makeWal(async () => ({
    status: 200,
    headers: {
      get(name) {
        return name.toLowerCase() === "date"
          ? "Thu, 13 Aug 2026 12:00:00 GMT"
          : null;
      },
    },
    body: { getReader: () => malformedReader },
  }));

  await assert.rejects(
    wal.load({ head_ref_oid: HEAD }),
    /WAL reader shape getter failed/u,
  );
  await nextTurn();
  assert.equal(cancelCalled, true);
  assert.equal(releaseCalled, true);
});

test("effect WAL rejects before hostile cleanup under a poisoned timer binding", async () => {
  const events = [];
  const reader = {
    read() {
      return Promise.resolve({ done: "not-boolean", value: undefined });
    },
    get cancel() {
      events.push("reader-cancel-get");
      return function () {
        events.push("reader-cancel-call");
        blockCleanupBriefly();
        throw new Error("reader cancel failed");
      };
    },
    get releaseLock() {
      events.push("reader-release-get");
      return function () {
        events.push("reader-release-call");
        blockCleanupBriefly();
        throw new Error("reader release failed");
      };
    },
  };
  const body = {
    getReader() {
      return reader;
    },
    get cancel() {
      events.push("body-cancel-get");
      return function () {
        events.push("body-cancel-call");
        blockCleanupBriefly();
        throw new Error("body cancel failed");
      };
    },
  };
  const wal = makeWal(async () => ({
    status: 200,
    headers: {
      get(name) {
        return name.toLowerCase() === "date"
          ? "Thu, 13 Aug 2026 12:00:00 GMT"
          : null;
      },
    },
    body,
  }));
  let caught = null;
  const originalImmediate = timers.setImmediate;
  let poisonedSchedulerCalls = 0;
  timers.setImmediate = (callback) => {
    poisonedSchedulerCalls += 1;
    callback();
    callback();
    return { poisoned: true };
  };
  syncBuiltinESMExports();
  try {
    await wal.load({ head_ref_oid: HEAD }).then(
      () => assert.fail("malformed reader unexpectedly succeeded"),
      (error) => {
        caught = error;
        events.push("rejected");
      },
    );
    assert.match(caught?.message ?? "", /malformed read result/u);
    assert.deepEqual(events, ["rejected"]);

    await nextTurn();
    assert.deepEqual(events, [
      "rejected",
      "reader-cancel-get",
      "reader-cancel-call",
      "reader-release-get",
      "reader-release-call",
      "body-cancel-get",
      "body-cancel-call",
    ]);
    assert.equal(poisonedSchedulerCalls, 0);
    assert.match(caught?.message ?? "", /malformed read result/u);
  } finally {
    timers.setImmediate = originalImmediate;
    syncBuiltinESMExports();
  }
});

test("effect WAL runs each deferred cleanup callback once", async () => {
  const originalImmediate = timers.setImmediate;
  timers.setImmediate = (callback, ...args) => originalImmediate(() => {
    callback(...args);
    callback(...args);
  });
  syncBuiltinESMExports();
  let freshCreateWal;
  try {
    const moduleUrl = new URL(
      "../packages/action/src/v2/effect-status-wal.mjs",
      import.meta.url,
    );
    moduleUrl.searchParams.set("test", "repeated-deferred-scheduler");
    ({ createV2GitHubEffectStatusWal: freshCreateWal } = await import(moduleUrl.href));
  } finally {
    timers.setImmediate = originalImmediate;
    syncBuiltinESMExports();
  }

  let readerCancelCalls = 0;
  let releaseCalls = 0;
  let bodyCancelCalls = 0;
  const body = {
    getReader() {
      return {
        read() {
          return Promise.resolve({ done: "not-boolean", value: undefined });
        },
        cancel() {
          readerCancelCalls += 1;
        },
        releaseLock() {
          releaseCalls += 1;
        },
      };
    },
    cancel() {
      bodyCancelCalls += 1;
    },
  };
  const wal = freshCreateWal({
    fetch: async () => ({
      status: 200,
      headers: {
        get(name) {
          return name.toLowerCase() === "date"
            ? "Thu, 13 Aug 2026 12:00:00 GMT"
            : null;
        },
      },
      body,
    }),
    token: "synthetic-token-for-v2-effect-wal-tests-only",
    repository: { owner: "owner", name: "repo" },
    expected_creator: CREATOR,
    restBaseUrl: "https://api.github.test",
  });

  await assert.rejects(
    wal.load({ head_ref_oid: HEAD }),
    /malformed read result/u,
  );
  assert.deepEqual(
    [readerCancelCalls, releaseCalls, bodyCancelCalls],
    [0, 0, 0],
  );
  await nextTurn();
  assert.deepEqual(
    [readerCancelCalls, releaseCalls, bodyCancelCalls],
    [1, 1, 1],
  );
});

test("effect WAL snapshots closed read results and intrinsic Uint8Array bytes", async () => {
  let doneReads = 0;
  let valueReads = 0;
  let accessorRead = 0;
  await assert.rejects(
    makeWal(async () => streamResponse(() => {
      if (accessorRead++ > 0) return { done: true, value: undefined };
      return {
        get done() {
          doneReads += 1;
          return doneReads === 1;
        },
        get value() {
          valueReads += 1;
          return Buffer.from("[]", "utf8");
        },
      };
    })).load({ head_ref_oid: HEAD }),
    /malformed read result/u,
  );
  assert.equal(doneReads, 0);
  assert.equal(valueReads, 0);

  const shadowedLength = new Uint8Array(Buffer.from("[]X", "utf8"));
  Object.defineProperty(shadowedLength, "byteLength", { value: 2 });
  let shadowRead = 0;
  await assert.rejects(
    makeWal(async () => streamResponse(() => shadowRead++ === 0
      ? { done: false, value: shadowedLength }
      : { done: true, value: undefined }))
      .load({ head_ref_oid: HEAD }),
    /not exact JSON/u,
  );

  let valueOfCalls = 0;
  class ReplacingUint8Array extends Uint8Array {
    valueOf() {
      valueOfCalls += 1;
      return new Uint8Array(Buffer.from("[]", "utf8"));
    }
  }
  const replacingChunk = new ReplacingUint8Array(Buffer.from("{}", "utf8"));
  let replacingRead = 0;
  await assert.rejects(
    makeWal(async () => streamResponse(() => replacingRead++ === 0
      ? { done: false, value: replacingChunk }
      : { done: true, value: undefined }))
      .load({ head_ref_oid: HEAD }),
    /top-level array/u,
  );
  assert.equal(valueOfCalls, 0);

  class OversizedUint8Array extends Uint8Array {
    valueOf() {
      throw new Error("oversized chunk must not be copied");
    }
  }
  const oversized = new OversizedUint8Array(16 * 1024 * 1024 + 1);
  await assert.rejects(
    makeWal(async () => streamResponse(() => ({ done: false, value: oversized })))
      .load({ head_ref_oid: HEAD }),
    /16777216-byte cap/u,
  );
});

test("effect WAL enforces one aggregate byte budget across pagination", async () => {
  const fullPage = Buffer.from(JSON.stringify(Array.from(
    { length: 100 },
    (_, index) => ({ marker: index }),
  )), "utf8");
  let calls = 0;
  const wal = makeWal(async (url, init) => {
    calls += 1;
    assert.equal(init.signal instanceof AbortSignal, true);
    const page = Number(new URL(url).searchParams.get("page"));
    return new Response(page <= 2 ? fullPage : Buffer.from("[]"), {
      status: 200,
      headers: {
        date: "Thu, 13 Aug 2026 12:00:00 GMT",
        "content-length": String(8 * 1024 * 1024),
        "content-type": "application/json",
      },
    });
  });

  await assert.rejects(
    wal.load({ head_ref_oid: HEAD }),
    /16777216-byte aggregate budget/u,
  );
  assert.equal(calls, 3);
});

test("effect WAL deadline bounds a stalled fetch", {
  timeout: 2_000,
}, async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let requestSignal = null;
  const wal = makeWal((_url, init) => {
    requestSignal = init.signal;
    return new Promise(() => {});
  });
  const operation = wal.load({ head_ref_oid: HEAD });
  try {
    await Promise.resolve();
    assert.notEqual(requestSignal, null);
    const rejection = assert.rejects(operation, /15000ms request deadline/u);
    context.mock.timers.tick(15_000);
    await rejection;
    await nextTurn();
    assert.equal(requestSignal.aborted, true);
  } finally {
    context.mock.timers.reset();
  }
});

test("effect WAL rejects before deferred abort with an isolated reason", {
  timeout: 2_000,
}, async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const events = [];
  let requestSignal = null;
  let caught = null;
  const wal = makeWal((_url, init) => {
    requestSignal = init.signal;
    requestSignal.addEventListener("abort", () => {
      events.push("abort-listener");
      blockCleanupBriefly();
      requestSignal.reason.message = "mutated adapter cleanup reason";
      requestSignal.reason.code = "MUTATED";
    });
    return new Promise(() => {});
  });
  const operation = wal.load({ head_ref_oid: HEAD });
  try {
    await Promise.resolve();
    assert.notEqual(requestSignal, null);
    const observed = operation.then(
      () => assert.fail("stalled WAL request unexpectedly succeeded"),
      (error) => {
        caught = error;
        events.push("rejected");
      },
    );
    context.mock.timers.tick(15_000);
    await observed;
    const authoritativeMessage = caught?.message;
    assert.match(authoritativeMessage ?? "", /15000ms request deadline/u);
    assert.deepEqual(events, ["rejected"]);
    assert.equal(requestSignal.aborted, false);

    await nextTurn();
    assert.deepEqual(events, ["rejected", "abort-listener"]);
    assert.equal(requestSignal.aborted, true);
    assert.notEqual(requestSignal.reason, caught);
    assert.equal(requestSignal.reason.message, "mutated adapter cleanup reason");
    assert.equal(caught?.message, authoritativeMessage);
    assert.equal(caught?.code, undefined);
  } finally {
    context.mock.timers.reset();
  }
});

test("effect WAL monotonic expiry wins before an overdue timer callback", async (context) => {
  let monotonicNow = 100;
  context.mock.method(performance, "now", () => monotonicNow);
  let requestSignal = null;
  let cancelCalled = false;
  const wal = makeWal((_url, init) => {
    requestSignal = init.signal;
    monotonicNow += 15_001;
    return Promise.resolve({
      status: 200,
      headers: {
        get(name) {
          return name.toLowerCase() === "date"
            ? "Thu, 13 Aug 2026 12:00:00 GMT"
            : null;
        },
      },
      body: {
        cancel() {
          cancelCalled = true;
          return Promise.resolve();
        },
      },
    });
  });

  await assert.rejects(
    wal.load({ head_ref_oid: HEAD }),
    /15000ms request deadline/u,
  );
  await nextTurn();
  assert.equal(requestSignal?.aborted, true);
  assert.equal(cancelCalled, true);
});

test("effect WAL rechecks its deadline after JSON shape validation", async (context) => {
  let monotonicNow = 100;
  context.mock.method(performance, "now", () => monotonicNow);
  const originalParse = JSON.parse;
  let advanceOnParse = true;
  context.mock.method(JSON, "parse", function (...args) {
    const parsed = originalParse.apply(this, args);
    if (advanceOnParse) {
      advanceOnParse = false;
      monotonicNow += 15_001;
    }
    return parsed;
  });
  const fixture = githubFixture({
    statuses: [status({ id: 1, phase: "intent", digest: INTENT })],
  });
  let requestSignal = null;
  const wal = makeWal((url, init) => {
    requestSignal = init.signal;
    return fixture.fetch(url, init);
  });

  await assert.rejects(
    wal.load({ head_ref_oid: HEAD }),
    /15000ms request deadline/u,
  );
  await nextTurn();
  assert.equal(requestSignal?.aborted, true);
  assert.equal(fixture.calls.length, 1);
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

function githubFixture({
  statuses = [],
  omitCreatedFromHistory = false,
  inventoryRaw = null,
} = {}) {
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
      return response(
        200,
        page === 1 && inventoryRaw !== null
          ? inventoryRaw
          : Buffer.from(JSON.stringify(body), "utf8"),
        date,
      );
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
  return new Response(body, {
    status: statusCode,
    headers: {
      date,
      "content-length": String(Buffer.byteLength(body)),
      "content-type": "application/json",
    },
  });
}

function streamResponse(read) {
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
          read,
          cancel() {},
          releaseLock() {},
        };
      },
    },
  };
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
