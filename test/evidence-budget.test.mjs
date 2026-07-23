import assert from "node:assert/strict";
import test from "node:test";

import {
  EvidenceWorkBudget,
  mapWithConcurrency,
} from "../packages/action/src/evidence-budget.mjs";

function budget(overrides = {}) {
  return new EvidenceWorkBudget({
    maxItemsPerSnapshot: 5,
    maxResponseBytes: 8,
    maxResponseBytesPerWork: 12,
    maxRequestAttemptsPerWork: 3,
    maxConcurrency: 2,
    ...overrides,
  });
}

test("fails closed when aggregate evidence items cross the snapshot budget", () => {
  const work = budget();
  const snapshot = work.newSnapshot();

  work.consumeItems(snapshot, 3, "issue comments");
  assert.throws(
    () => work.consumeItems(snapshot, 3, "review threads"),
    (error) => {
      assert.equal(error.state, "pending");
      assert.match(error.message, /snapshot item budget exceeded/);
      return true;
    },
  );
});

test("enforces both single-response and aggregate response-byte budgets", () => {
  const single = budget();
  assert.throws(
    () => single.consumeResponseBytes(9, 9, "oversized response"),
    /response-byte budget exceeded/,
  );

  const aggregate = budget();
  aggregate.consumeResponseBytes(7, 7, "first response");
  assert.throws(
    () => aggregate.consumeResponseBytes(6, 6, "second response"),
    /work response-byte budget exceeded/,
  );
});

test("caps actual request attempts and wakes every semaphore waiter on exhaustion", async () => {
  const work = budget({
    maxRequestAttemptsPerWork: 2,
    maxConcurrency: 1,
  });

  const releaseFirst = await work.acquireRequest("first");
  const second = work.acquireRequest("second");
  const third = work.acquireRequest("third");
  const fourth = work.acquireRequest("fourth");
  releaseFirst();
  const releaseSecond = await second;
  releaseSecond();

  const [thirdResult, fourthResult] = await Promise.allSettled([third, fourth]);
  assert.equal(thirdResult.status, "rejected");
  assert.equal(fourthResult.status, "rejected");
  assert.equal(thirdResult.reason, fourthResult.reason);
  assert.equal(thirdResult.reason.state, "pending");
  assert.match(thirdResult.reason.message, /request-attempt budget exhausted/);
  assert.equal(work.requestAttempts, 2);
  assert.equal(work.activeRequests, 0);
});

test("broadcasts a sticky budget failure to every active request controller", () => {
  const work = budget();
  const first = new AbortController();
  const second = new AbortController();
  const unregisterFirst = work.registerAbortController(first);
  const unregisterSecond = work.registerAbortController(second);

  let failure;
  assert.throws(
    () => work.consumeResponseBytes(9, 9, "oversized response"),
    (error) => {
      failure = error;
      return /response-byte budget exceeded/.test(error.message);
    },
  );

  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, true);
  assert.equal(first.signal.reason, failure);
  assert.equal(second.signal.reason, failure);
  assert.throws(() => work.throwIfFailed(), (error) => error === failure);
  unregisterFirst();
  unregisterSecond();
  assert.equal(work.activeAbortControllers.size, 0);
});

test("bounded worker pool preserves order and never exceeds its concurrency cap", async () => {
  let active = 0;
  let maximumActive = 0;
  const result = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (value) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value * 10;
  });

  assert.deepEqual(result, [10, 20, 30, 40, 50, 60]);
  assert.equal(maximumActive, 2);
});

test("bounded worker pool stops assigning new work after the first failure", async () => {
  const started = [];
  await assert.rejects(
    () => mapWithConcurrency([0, 1, 2, 3, 4, 5], 2, async (value) => {
      started.push(value);
      if (value === 0) {
        throw new Error("stop");
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
      return value;
    }),
    /stop/,
  );

  assert.deepEqual(started, [0, 1]);
});
