import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire, syncBuiltinESMExports } from "node:module";
import test from "node:test";

const requireFromTest = createRequire(import.meta.url);
const mutableTimers = requireFromTest("node:timers");
const FRONTIER_MODULE =
  "../packages/action/src/v2/persistent-frontier.mjs";
const EPOCH_ID = `sha256:${"a".repeat(64)}`;

test("persistent frontier is deterministic, copy-on-write, and pageable within one operation budget", async () => {
  const { createV2PersistentMerkleMap } = await import(FRONTIER_MODULE);
  const firstStore = memoryBlobStore();
  const first = createV2PersistentMerkleMap({
    domain: "candidate-identity-frontier",
    epoch_id: EPOCH_ID,
    ...firstStore.adapter,
  });
  const empty = first.emptyRoot();
  const entries = Array.from({ length: 200 }, (_, index) => ({
    key: { pull_request_number: index + 1 },
    value: identity(index + 1),
  }));
  const published = await first.apply({
    root: empty,
    updates: entries.toReversed(),
    mode: "insert-only",
  });
  assert.equal(published.root.count, 200);
  assert.ok(published.created_objects.length > 1);
  assert.deepEqual(
    await first.lookup({
      root: published.root,
      key: { pull_request_number: 73 },
    }),
    { found: true, value: identity(73) },
  );
  const pageOne = await first.scan({ root: published.root, limit: 37 });
  assert.equal(pageOne.entries.length, 37);
  assert.notEqual(pageOne.next_cursor, null);
  const pageTwo = await first.scan({
    root: published.root,
    cursor: pageOne.next_cursor,
    limit: 37,
  });
  assert.equal(pageTwo.entries.length, 37);
  assert.equal(new Set([
    ...pageOne.entries,
    ...pageTwo.entries,
  ].map(({ key }) => key.pull_request_number)).size, 74);

  const scanned = [];
  let cursor = null;
  do {
    const page = await first.scan({
      root: published.root,
      cursor,
      limit: 31,
    });
    scanned.push(...page.entries);
    cursor = page.next_cursor;
  } while (cursor !== null);
  assert.deepEqual(
    scanned.map(({ key }) => key.pull_request_number).sort((a, b) => a - b),
    entries.map(({ key }) => key.pull_request_number),
  );

  const secondStore = memoryBlobStore();
  const second = createV2PersistentMerkleMap({
    domain: "candidate-identity-frontier",
    epoch_id: EPOCH_ID,
    ...secondStore.adapter,
  });
  const reordered = await second.apply({
    root: second.emptyRoot(),
    updates: entries,
    mode: "insert-only",
  });
  assert.equal(reordered.root.root_digest, published.root.root_digest);
  assert.equal(reordered.root.node.object_oid, published.root.node.object_oid);

  const incrementalStore = memoryBlobStore();
  const incremental = createV2PersistentMerkleMap({
    domain: "candidate-identity-frontier",
    epoch_id: EPOCH_ID,
    ...incrementalStore.adapter,
  });
  let incrementalRoot = incremental.emptyRoot();
  for (const update of entries.toReversed()) {
    const next = await incremental.apply({
      root: incrementalRoot,
      updates: [update],
      mode: "insert-only",
    });
    incrementalRoot = next.root;
  }
  assert.equal(incrementalRoot.root_digest, published.root.root_digest);
  assert.equal(incrementalRoot.node.object_oid, published.root.node.object_oid);

  const extended = await first.apply({
    root: published.root,
    updates: [{
      key: { pull_request_number: 201 },
      value: identity(201),
    }],
    mode: "insert-only",
  });
  assert.equal(
    (await first.lookup({
      root: published.root,
      key: { pull_request_number: 201 },
    })).found,
    false,
    "the old authenticated root remains immutable",
  );
  assert.deepEqual(
    await first.lookup({
      root: extended.root,
      key: { pull_request_number: 201 },
    }),
    { found: true, value: identity(201) },
  );
  assert.ok(
    extended.created_objects.length < published.created_objects.length,
    "one addition rewrites only its leaf-to-root path",
  );
});

test("persistent identity frontier permits additions but rejects deletion-by-replacement", async () => {
  const { createV2PersistentMerkleMap } = await import(FRONTIER_MODULE);
  const store = memoryBlobStore();
  const frontier = createV2PersistentMerkleMap({
    domain: "candidate-identity-frontier",
    epoch_id: EPOCH_ID,
    ...store.adapter,
  });
  const initial = await frontier.apply({
    root: frontier.emptyRoot(),
    updates: [{ key: { pull_request_number: 7 }, value: identity(7) }],
    mode: "insert-only",
  });
  await assert.rejects(
    frontier.apply({
      root: initial.root,
      updates: [{
        key: { pull_request_number: 7 },
        value: { ...identity(7), node_id: "PR_replaced" },
      }],
      mode: "insert-only",
    }),
    (error) => error.code === "PERSISTENT_FRONTIER_VALUE_CONFLICT",
  );
  const idempotent = await frontier.apply({
    root: initial.root,
    updates: [{ key: { pull_request_number: 7 }, value: identity(7) }],
    mode: "insert-only",
  });
  assert.equal(idempotent.root.root_digest, initial.root.root_digest);
  assert.deepEqual(idempotent.created_objects, []);

  const state = createV2PersistentMerkleMap({
    domain: "candidate-current-state",
    epoch_id: EPOCH_ID,
    ...store.adapter,
  });
  const open = await state.apply({
    root: state.emptyRoot(),
    updates: [{ key: { pull_request_number: 7 }, value: { state: "open" } }],
    mode: "upsert",
  });
  const closed = await state.apply({
    root: open.root,
    updates: [{ key: { pull_request_number: 7 }, value: { state: "closed" } }],
    mode: "upsert",
  });
  assert.deepEqual(
    await state.lookup({
      root: closed.root,
      key: { pull_request_number: 7 },
    }),
    { found: true, value: { state: "closed" } },
  );
  const withNull = await state.apply({
    root: closed.root,
    updates: [{ key: { pull_request_number: 8 }, value: null }],
    mode: "upsert",
  });
  assert.deepEqual(
    await state.lookup({
      root: withNull.root,
      key: { pull_request_number: 8 },
    }),
    { found: true, value: null },
  );
  assert.deepEqual(
    await state.lookup({
      root: withNull.root,
      key: { pull_request_number: 9 },
    }),
    { found: false, value: null },
  );
});

test("persistent frontier root is independent of every small insertion permutation", async () => {
  const { createV2PersistentMerkleMap } = await import(FRONTIER_MODULE);
  const updates = Array.from({ length: 5 }, (_, index) => ({
    key: { pull_request_number: index + 1 },
    value: identity(index + 1),
  }));
  let expected = null;
  for (const order of permutations(updates)) {
    const store = memoryBlobStore();
    const frontier = createV2PersistentMerkleMap({
      domain: "candidate-identity-frontier",
      epoch_id: EPOCH_ID,
      ...store.adapter,
    });
    let root = frontier.emptyRoot();
    for (const update of order) {
      ({ root } = await frontier.apply({
        root,
        updates: [update],
        mode: "insert-only",
      }));
    }
    expected ??= {
      root_digest: root.root_digest,
      object_oid: root.node.object_oid,
    };
    assert.deepEqual(
      { root_digest: root.root_digest, object_oid: root.node.object_oid },
      expected,
    );
  }
});

test("persistent frontier fails closed on missing, replaced, or cross-domain nodes", async () => {
  const { createV2PersistentMerkleMap } = await import(FRONTIER_MODULE);
  const store = memoryBlobStore();
  const frontier = createV2PersistentMerkleMap({
    domain: "candidate-identity-frontier",
    epoch_id: EPOCH_ID,
    ...store.adapter,
  });
  const published = await frontier.apply({
    root: frontier.emptyRoot(),
    updates: Array.from({ length: 80 }, (_, index) => ({
      key: { pull_request_number: index + 1 },
      value: identity(index + 1),
    })),
    mode: "insert-only",
  });
  const rootOid = published.root.node.object_oid;
  const rootBytes = store.blobs.get(rootOid);
  store.blobs.delete(rootOid);
  await assert.rejects(
    frontier.lookup({
      root: published.root,
      key: { pull_request_number: 1 },
    }),
    (error) => error.code === "PERSISTENT_FRONTIER_OBJECT_MISSING",
  );
  store.blobs.set(rootOid, rootBytes);
  store.blobs.set(rootOid, new TextEncoder().encode("{}\n"));
  await assert.rejects(
    frontier.lookup({
      root: published.root,
      key: { pull_request_number: 1 },
    }),
    (error) => error.code === "PERSISTENT_FRONTIER_OBJECT_MISMATCH",
  );
  store.blobs.set(rootOid, rootBytes);

  const bomBytes = new Uint8Array(rootBytes.byteLength + 3);
  bomBytes.set([0xef, 0xbb, 0xbf], 0);
  bomBytes.set(rootBytes, 3);
  const bomRoot = rebindRootNodeBytes({
    root: published.root,
    bytes: bomBytes,
    domain: "candidate-identity-frontier",
  });
  store.blobs.set(bomRoot.node.object_oid, bomBytes);
  await assert.rejects(
    frontier.lookup({
      root: bomRoot,
      key: { pull_request_number: 1 },
    }),
    (error) => error.code === "PERSISTENT_FRONTIER_OBJECT_MALFORMED",
  );

  const malformedNodeBytes = new TextEncoder().encode("[]\n");
  const malformedNodeRoot = rebindRootNodeBytes({
    root: published.root,
    bytes: malformedNodeBytes,
    domain: "candidate-identity-frontier",
  });
  store.blobs.set(malformedNodeRoot.node.object_oid, malformedNodeBytes);
  await assert.rejects(
    frontier.lookup({
      root: malformedNodeRoot,
      key: { pull_request_number: 1 },
    }),
    (error) => error.code === "PERSISTENT_FRONTIER_NODE_MALFORMED",
  );

  const sharedBuffer = new SharedArrayBuffer(rootBytes.byteLength);
  const sharedBytes = new Uint8Array(sharedBuffer);
  sharedBytes.set(rootBytes);
  const sharedFrontier = createV2PersistentMerkleMap({
    domain: "candidate-identity-frontier",
    epoch_id: EPOCH_ID,
    readBlob: async (objectOid) => objectOid === rootOid
      ? sharedBytes
      : store.adapter.readBlob(objectOid),
    writeBlob: store.adapter.writeBlob,
  });
  await assert.rejects(
    sharedFrontier.lookup({
      root: published.root,
      key: { pull_request_number: 1 },
    }),
    (error) => error.code === "PERSISTENT_FRONTIER_OBJECT_UNREADABLE",
  );

  const resizableBuffer = new ArrayBuffer(rootBytes.byteLength, {
    maxByteLength: 4 * 1024 * 1024,
  });
  const resizableBytes = new Uint8Array(resizableBuffer);
  resizableBytes.set(rootBytes);
  const resizableFrontier = createV2PersistentMerkleMap({
    domain: "candidate-identity-frontier",
    epoch_id: EPOCH_ID,
    readBlob(objectOid) {
      if (objectOid !== rootOid) return store.adapter.readBlob(objectOid);
      return {
        then(resolve) {
          resolve(resizableBytes);
          queueMicrotask(() => queueMicrotask(() => {
            resizableBuffer.resize(4 * 1024 * 1024);
          }));
        },
      };
    },
    writeBlob: store.adapter.writeBlob,
  });
  await assert.rejects(
    resizableFrontier.lookup({
      root: published.root,
      key: { pull_request_number: 1 },
    }),
    (error) => error.code === "PERSISTENT_FRONTIER_OBJECT_UNREADABLE",
  );
  assert.equal(resizableBuffer.byteLength, 4 * 1024 * 1024);

  const otherDomain = createV2PersistentMerkleMap({
    domain: "candidate-current-state",
    epoch_id: EPOCH_ID,
    ...store.adapter,
  });
  await assert.rejects(
    otherDomain.lookup({
      root: published.root,
      key: { pull_request_number: 1 },
    }),
    (error) => error.code === "PERSISTENT_FRONTIER_DOMAIN_MISMATCH",
  );

  const firstPage = await frontier.scan({ root: published.root, limit: 10 });
  const oversizedForeignCursor = Object.fromEntries(Array.from(
    { length: 8_192 },
    (_, index) => [`extra_${index}`, index],
  ));
  const readsBeforeForeignCursor = store.readCalls.length;
  await assert.rejects(
    frontier.scan({
      root: published.root,
      cursor: oversizedForeignCursor,
      limit: 10,
    }),
    (error) => error.code === "UNTRUSTED_PERSISTENT_FRONTIER_CURSOR",
  );
  assert.equal(
    store.readCalls.length,
    readsBeforeForeignCursor,
    "foreign cursors are rejected by identity before adapter I/O",
  );
  await assert.rejects(
    frontier.scan({
      root: published.root,
      cursor: structuredClone(firstPage.next_cursor),
      limit: 10,
    }),
    (error) => error.code === "UNTRUSTED_PERSISTENT_FRONTIER_CURSOR",
  );
  const otherEpoch = createV2PersistentMerkleMap({
    domain: "candidate-identity-frontier",
    epoch_id: `sha256:${"b".repeat(64)}`,
    ...store.adapter,
  });
  await assert.rejects(
    otherEpoch.scan({
      root: published.root,
      cursor: firstPage.next_cursor,
      limit: 10,
    }),
    (error) => error.code === "UNTRUSTED_PERSISTENT_FRONTIER_CURSOR",
  );

  const originalWeakMapSet = WeakMap.prototype.set;
  const originalWeakMapGet = WeakMap.prototype.get;
  const originalWeakMapDelete = WeakMap.prototype.delete;
  let capturedBinding = null;
  Object.defineProperties(WeakMap.prototype, {
    set: {
      configurable: true,
      writable: true,
      value(key, binding) {
        capturedBinding = { map: this, key, binding };
        return Reflect.apply(originalWeakMapSet, this, [key, binding]);
      },
    },
    get: {
      configurable: true,
      writable: true,
      value() {
        throw new Error("mutable WeakMap.prototype.get was dispatched");
      },
    },
    delete: {
      configurable: true,
      writable: true,
      value() {
        throw new Error("mutable WeakMap.prototype.delete was dispatched");
      },
    },
  });
  try {
    const protectedPage = await frontier.scan({
      root: published.root,
      limit: 11,
    });
    assert.equal(capturedBinding, null);
    const protectedNext = await frontier.scan({
      root: published.root,
      cursor: protectedPage.next_cursor,
      limit: 11,
    });
    assert.equal(protectedNext.entries.length, 11);
  } finally {
    Object.defineProperties(WeakMap.prototype, {
      set: {
        configurable: true,
        writable: true,
        value: originalWeakMapSet,
      },
      get: {
        configurable: true,
        writable: true,
        value: originalWeakMapGet,
      },
      delete: {
        configurable: true,
        writable: true,
        value: originalWeakMapDelete,
      },
    });
  }
});

test("persistent frontier closes empty, singleton, and size-cap boundaries", async () => {
  const {
    MAX_V2_PERSISTENT_FRONTIER_KEY_BYTES,
    MAX_V2_PERSISTENT_FRONTIER_NODE_BYTES,
    MAX_V2_PERSISTENT_FRONTIER_UPDATES,
    MAX_V2_PERSISTENT_FRONTIER_VALUE_BYTES,
    createV2PersistentMerkleMap,
  } = await import(FRONTIER_MODULE);
  const store = memoryBlobStore();
  const frontier = createV2PersistentMerkleMap({
    domain: "candidate-identity-frontier",
    epoch_id: EPOCH_ID,
    ...store.adapter,
  });
  const empty = frontier.emptyRoot();
  assert.equal(empty.count, 0);
  assert.deepEqual(await frontier.lookup({
    root: empty,
    key: { pull_request_number: 1 },
  }), { found: false, value: null });
  assert.deepEqual(await frontier.scan({ root: empty, limit: 1 }), {
    entries: [],
    next_cursor: null,
  });

  const singleton = await frontier.apply({
    root: empty,
    updates: [{ key: { pull_request_number: 1 }, value: identity(1) }],
    mode: "insert-only",
  });
  assert.equal(singleton.root.count, 1);
  assert.equal(singleton.root.height, 0);
  assert.equal(singleton.created_objects.length, 1);
  assert.deepEqual(
    await frontier.scan({ root: singleton.root, limit: 1 }),
    {
      entries: [{
        key: { pull_request_number: 1 },
        value: identity(1),
      }],
      next_cursor: null,
    },
  );

  await assert.rejects(
    frontier.apply({
      root: singleton.root,
      updates: [{
        key: { value: "k".repeat(MAX_V2_PERSISTENT_FRONTIER_KEY_BYTES) },
        value: { ok: true },
      }],
      mode: "insert-only",
    }),
    (error) => error.code === "PERSISTENT_FRONTIER_KEY_SIZE_CAP",
  );
  await assert.rejects(
    frontier.apply({
      root: singleton.root,
      updates: [{
        key: { pull_request_number: 2 },
        value: "v".repeat(MAX_V2_PERSISTENT_FRONTIER_VALUE_BYTES),
      }],
      mode: "insert-only",
    }),
    (error) => error.code === "PERSISTENT_FRONTIER_VALUE_SIZE_CAP",
  );
  const readsBeforeOversizedUpdates = store.readCalls.length;
  const writesBeforeOversizedUpdates = store.writeCalls.length;
  await assert.rejects(
    frontier.apply({
      root: singleton.root,
      updates: Array.from(
        { length: MAX_V2_PERSISTENT_FRONTIER_UPDATES + 1 },
        (_, index) => ({ key: { index }, value: { index } }),
      ),
      mode: "insert-only",
    }),
    TypeError,
  );
  assert.equal(store.readCalls.length, readsBeforeOversizedUpdates);
  assert.equal(store.writeCalls.length, writesBeforeOversizedUpdates);
  const oversizedDescriptor = structuredClone(singleton.root);
  oversizedDescriptor.node.object_bytes = MAX_V2_PERSISTENT_FRONTIER_NODE_BYTES + 1;
  await assert.rejects(
    frontier.lookup({
      root: oversizedDescriptor,
      key: { pull_request_number: 1 },
    }),
    (error) => error.code === "PERSISTENT_FRONTIER_DESCRIPTOR_MALFORMED",
  );
});

test("persistent frontier authenticates original keys and rejects shared children", async () => {
  const { createV2PersistentMerkleMap } = await import(FRONTIER_MODULE);
  const domain = "candidate-identity-frontier";
  const singletonStore = memoryBlobStore();
  const singletonFrontier = createV2PersistentMerkleMap({
    domain,
    epoch_id: EPOCH_ID,
    ...singletonStore.adapter,
  });
  const singleton = await singletonFrontier.apply({
    root: singletonFrontier.emptyRoot(),
    updates: [{ key: { pull_request_number: 1 }, value: identity(1) }],
    mode: "insert-only",
  });
  const forgedKeyRoot = authenticateRootNodeMutation({
    root: singleton.root,
    store: singletonStore,
    domain,
    mutate(node) {
      node.entry.key = { pull_request_number: 2 };
    },
  });
  await assert.rejects(
    singletonFrontier.lookup({
      root: forgedKeyRoot,
      key: { pull_request_number: 1 },
    }),
    (error) => error.code === "PERSISTENT_FRONTIER_KEY_MISMATCH",
  );

  const branchStore = memoryBlobStore();
  const branchFrontier = createV2PersistentMerkleMap({
    domain,
    epoch_id: EPOCH_ID,
    ...branchStore.adapter,
  });
  const branch = await branchFrontier.apply({
    root: branchFrontier.emptyRoot(),
    updates: Array.from({ length: 8 }, (_, index) => ({
      key: { pull_request_number: index + 1 },
      value: identity(index + 1),
    })),
    mode: "insert-only",
  });
  const sharedChildRoot = authenticateRootNodeMutation({
    root: branch.root,
    store: branchStore,
    domain,
    mutate(node) {
      assert.equal(node.kind, "branch");
      node.right = structuredClone(node.left);
    },
  });
  await assert.rejects(
    branchFrontier.scan({ root: sharedChildRoot, limit: 8 }),
    (error) => error.code === "PERSISTENT_FRONTIER_NODE_MALFORMED",
  );
});

test("persistent frontier enforces aggregate I/O and absolute wall budgets", async () => {
  const { createV2PersistentMerkleMap } = await import(FRONTIER_MODULE);
  let limitReads = 0;
  const accessorLimits = {};
  Object.defineProperty(accessorLimits, "max_duration_ms", {
    enumerable: true,
    get() {
      limitReads += 1;
      return limitReads < 5 ? 1 : 30_001;
    },
  });
  assert.throws(
    () => createV2PersistentMerkleMap({
      domain: "candidate-identity-frontier",
      epoch_id: EPOCH_ID,
      operation_limits: accessorLimits,
      ...memoryBlobStore().adapter,
    }),
    /operation limits must use enumerable data properties/u,
  );
  assert.equal(limitReads, 0, "limit accessors are rejected without invocation");

  const authorityStore = memoryBlobStore();
  const authorityFrontier = createV2PersistentMerkleMap({
    domain: "candidate-identity-frontier",
    epoch_id: EPOCH_ID,
    ...authorityStore.adapter,
  });
  const validEmpty = authorityFrontier.emptyRoot();
  let rootDigestReads = 0;
  const accessorRoot = { ...validEmpty };
  delete accessorRoot.root_digest;
  Object.defineProperty(accessorRoot, "root_digest", {
    enumerable: true,
    get() {
      rootDigestReads += 1;
      return rootDigestReads < 4
        ? validEmpty.root_digest
        : `sha256:${"b".repeat(64)}`;
    },
  });
  await assert.rejects(
    authorityFrontier.apply({
      root: accessorRoot,
      updates: [],
      mode: "insert-only",
    }),
    /persistent frontier root must use enumerable data properties/u,
  );
  assert.equal(rootDigestReads, 0, "root accessors are rejected without invocation");
  assert.deepEqual(authorityStore.readCalls, []);
  assert.deepEqual(authorityStore.writeCalls, []);

  const accessorUpdate = {};
  Object.defineProperties(accessorUpdate, {
    key: { enumerable: true, value: { pull_request_number: 1 } },
    value: { enumerable: true, get: () => identity(1) },
  });
  await assert.rejects(
    authorityFrontier.apply({
      root: validEmpty,
      updates: [accessorUpdate],
      mode: "insert-only",
    }),
    /persistent frontier update 0 must use enumerable data properties/u,
  );
  assert.deepEqual(authorityStore.writeCalls, []);
  const decoratedUpdates = [{
    key: { pull_request_number: 1 },
    value: identity(1),
  }];
  decoratedUpdates.audit = true;
  await assert.rejects(
    authorityFrontier.apply({
      root: validEmpty,
      updates: decoratedUpdates,
      mode: "insert-only",
    }),
    /persistent frontier updates must be a dense closed array/u,
  );
  assert.deepEqual(authorityStore.writeCalls, []);
  let updateElementReads = 0;
  const accessorUpdates = [];
  Object.defineProperty(accessorUpdates, "0", {
    enumerable: true,
    get() {
      updateElementReads += 1;
      return {
        key: { pull_request_number: 1 },
        value: identity(1),
      };
    },
  });
  accessorUpdates.length = 1;
  await assert.rejects(
    authorityFrontier.apply({
      root: validEmpty,
      updates: accessorUpdates,
      mode: "insert-only",
    }),
    /persistent frontier updates must use enumerable data elements/u,
  );
  assert.equal(updateElementReads, 0, "update accessors are never invoked");
  assert.deepEqual(authorityStore.writeCalls, []);

  const writeStore = memoryBlobStore();
  const writeTight = createV2PersistentMerkleMap({
    domain: "candidate-identity-frontier",
    epoch_id: EPOCH_ID,
    operation_limits: { max_write_objects: 1 },
    ...writeStore.adapter,
  });
  await assert.rejects(
    writeTight.apply({
      root: writeTight.emptyRoot(),
      updates: Array.from({ length: 8 }, (_, index) => ({
        key: { pull_request_number: index + 1 },
        value: identity(index + 1),
      })),
      mode: "insert-only",
    }),
    (error) => error.code === "PERSISTENT_FRONTIER_OPERATION_WRITE_CAP",
  );
  assert.equal(
    writeStore.writeCalls.length,
    0,
    "the whole object graph is budgeted before the first orphan write",
  );

  const populatedStore = memoryBlobStore();
  const populated = createV2PersistentMerkleMap({
    domain: "candidate-identity-frontier",
    epoch_id: EPOCH_ID,
    ...populatedStore.adapter,
  });
  const published = await populated.apply({
    root: populated.emptyRoot(),
    updates: Array.from({ length: 8 }, (_, index) => ({
      key: { pull_request_number: index + 1 },
      value: identity(index + 1),
    })),
    mode: "insert-only",
  });
  populatedStore.readCalls.length = 0;
  await populated.scan({ root: published.root, limit: 2 });
  const onePageReads = populatedStore.readCalls.length;
  assert.ok(onePageReads > 1);
  const cumulative = createV2PersistentMerkleMap({
    domain: "candidate-identity-frontier",
    epoch_id: EPOCH_ID,
    operation_limits: { max_read_objects: onePageReads },
    ...populatedStore.adapter,
  });
  const cumulativeFirst = await cumulative.scan({
    root: published.root,
    limit: 2,
  });
  await assert.rejects(
    cumulative.scan({
      root: published.root,
      cursor: cumulativeFirst.next_cursor,
      limit: 2,
    }),
    (error) => error.code === "PERSISTENT_FRONTIER_OPERATION_READ_CAP",
  );
  await assert.rejects(
    cumulative.scan({
      root: published.root,
      cursor: cumulativeFirst.next_cursor,
      limit: 2,
    }),
    (error) => error.code === "UNTRUSTED_PERSISTENT_FRONTIER_CURSOR",
  );
  const adapterReceivers = [];
  const readTight = createV2PersistentMerkleMap({
    domain: "candidate-identity-frontier",
    epoch_id: EPOCH_ID,
    operation_limits: { max_read_objects: 1 },
    readBlob: function (objectOid, options) {
      adapterReceivers.push(this);
      if (this !== undefined) {
        this.read_objects = 0;
        this.read_bytes = 0;
        this.deadline_at = Number.MAX_SAFE_INTEGER;
      }
      return populatedStore.adapter.readBlob(objectOid, options);
    },
    writeBlob: populatedStore.adapter.writeBlob,
  });
  await assert.rejects(
    readTight.scan({ root: published.root, limit: 8 }),
    (error) => error.code === "PERSISTENT_FRONTIER_OPERATION_READ_CAP",
  );
  assert.ok(adapterReceivers.length > 0);
  assert.ok(adapterReceivers.every((receiver) => receiver === undefined));

  const byteStore = memoryBlobStore();
  const byteTight = createV2PersistentMerkleMap({
    domain: "candidate-current-state",
    epoch_id: EPOCH_ID,
    operation_limits: { max_update_bytes: 128 },
    ...byteStore.adapter,
  });
  await assert.rejects(
    byteTight.apply({
      root: byteTight.emptyRoot(),
      updates: [{ key: { number: 1 }, value: "x".repeat(256) }],
      mode: "upsert",
    }),
    (error) => error.code === "PERSISTENT_FRONTIER_UPDATE_BYTE_CAP",
  );
  assert.equal(byteStore.writeCalls.length, 0);

  const timeout = createV2PersistentMerkleMap({
    domain: "candidate-identity-frontier",
    epoch_id: EPOCH_ID,
    operation_limits: { max_duration_ms: 25 },
    readBlob: async () => new Promise(() => {}),
    writeBlob: async () => assert.fail("timeout probe must not write"),
  });
  await assert.rejects(
    timeout.lookup({
      root: published.root,
      key: { pull_request_number: 1 },
    }),
    (error) => error.code === "PERSISTENT_FRONTIER_OPERATION_TIMEOUT",
  );

  const abortingTimeout = createV2PersistentMerkleMap({
    domain: "candidate-identity-frontier",
    epoch_id: EPOCH_ID,
    operation_limits: { max_duration_ms: 25 },
    readBlob: async (_objectOid, { signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      }, { once: true });
    }),
    writeBlob: async () => assert.fail("timeout probe must not write"),
  });
  await assert.rejects(
    abortingTimeout.lookup({
      root: published.root,
      key: { pull_request_number: 1 },
    }),
    (error) => error.code === "PERSISTENT_FRONTIER_OPERATION_TIMEOUT",
  );

  const blockingTimeout = createV2PersistentMerkleMap({
    domain: "candidate-identity-frontier",
    epoch_id: EPOCH_ID,
    operation_limits: { max_duration_ms: 1 },
    readBlob() {
      const until = Date.now() + 20;
      while (Date.now() < until) {
        // Deliberately block to exercise post-call deadline classification.
      }
      throw new Error("adapter failed after the deadline");
    },
    writeBlob: async () => assert.fail("timeout probe must not write"),
  });
  await assert.rejects(
    blockingTimeout.lookup({
      root: published.root,
      key: { pull_request_number: 1 },
    }),
    (error) => error.code === "PERSISTENT_FRONTIER_OPERATION_TIMEOUT",
  );

  const largeLeafStore = memoryBlobStore();
  const largeLeafWriter = createV2PersistentMerkleMap({
    domain: "candidate-current-state",
    epoch_id: EPOCH_ID,
    ...largeLeafStore.adapter,
  });
  const largeLeaf = await largeLeafWriter.apply({
    root: largeLeafWriter.emptyRoot(),
    updates: [{
      key: { number: 1 },
      value: Array.from({ length: 12_000 }, () => null),
    }],
    mode: "upsert",
  });
  const largeLeafReader = createV2PersistentMerkleMap({
    domain: "candidate-current-state",
    epoch_id: EPOCH_ID,
    operation_limits: { max_duration_ms: 1 },
    ...largeLeafStore.adapter,
  });
  await assert.rejects(
    largeLeafReader.lookup({
      root: largeLeaf.root,
      key: { number: 1 },
    }),
    (error) => error.code === "PERSISTENT_FRONTIER_OPERATION_TIMEOUT",
  );
});

test("persistent frontier keeps cursor state off mutable collection methods", async () => {
  const { createV2PersistentMerkleMap } = await import(FRONTIER_MODULE);
  const originalSetAdd = Set.prototype.add;
  let poisonedSetAddCalls = 0;
  Object.defineProperty(Set.prototype, "add", {
    configurable: true,
    writable: true,
    value(value) {
      poisonedSetAddCalls += 1;
      return Reflect.apply(originalSetAdd, this, [value]);
    },
  });
  let frontier;
  const store = memoryBlobStore();
  try {
    frontier = createV2PersistentMerkleMap({
      domain: "candidate-current-state",
      epoch_id: EPOCH_ID,
      ...store.adapter,
    });
  } finally {
    Object.defineProperty(Set.prototype, "add", {
      configurable: true,
      writable: true,
      value: originalSetAdd,
    });
  }
  assert.equal(poisonedSetAddCalls, 0);

  const iterator = new Map().values();
  const iteratorPrototype = Object.getPrototypeOf(iterator);
  const originalIteratorNext = iteratorPrototype.next;
  let poisonedIteratorCalls = 0;
  Object.defineProperty(iteratorPrototype, "next", {
    configurable: true,
    writable: true,
    value() {
      poisonedIteratorCalls += 1;
      return { done: true, value: undefined };
    },
  });
  let publication;
  try {
    publication = frontier.apply({
      root: frontier.emptyRoot(),
      updates: [{ key: { number: 1 }, value: "A" }],
      mode: "upsert",
    });
  } finally {
    Object.defineProperty(iteratorPrototype, "next", {
      configurable: true,
      writable: true,
      value: originalIteratorNext,
    });
  }
  const published = await publication;
  assert.equal(poisonedIteratorCalls, 0);
  assert.equal(published.root.count, 1);
  assert.deepEqual(
    await frontier.lookup({ root: published.root, key: { number: 1 } }),
    { found: true, value: "A" },
  );

  const originalArrayIterator = Array.prototype[Symbol.iterator];
  let poisonedArrayIteratorCalls = 0;
  Object.defineProperty(Array.prototype, Symbol.iterator, {
    configurable: true,
    writable: true,
    value() {
      poisonedArrayIteratorCalls += 1;
      return Reflect.apply(originalArrayIterator, this, []);
    },
  });
  let secondPublication;
  try {
    secondPublication = frontier.apply({
      root: published.root,
      updates: [{ key: { number: 2 }, value: "B" }],
      mode: "upsert",
    });
  } finally {
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      configurable: true,
      writable: true,
      value: originalArrayIterator,
    });
  }
  const secondPublished = await secondPublication;
  assert.equal(poisonedArrayIteratorCalls, 0);
  assert.equal(secondPublished.root.count, 2);

  const timeoutFrontier = createV2PersistentMerkleMap({
    domain: "candidate-current-state",
    epoch_id: EPOCH_ID,
    operation_limits: { max_duration_ms: 25 },
    readBlob: async () => new Promise(() => {}),
    writeBlob: async () => assert.fail("deadline probe must not write"),
  });
  Object.defineProperty(Array.prototype, Symbol.iterator, {
    configurable: true,
    writable: true,
    value() {
      poisonedArrayIteratorCalls += 1;
      return { next: () => ({ done: true, value: undefined }) };
    },
  });
  let timedLookup;
  try {
    timedLookup = timeoutFrontier.lookup({
      root: secondPublished.root,
      key: { number: 1 },
    });
  } finally {
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      configurable: true,
      writable: true,
      value: originalArrayIterator,
    });
  }
  await assert.rejects(
    timedLookup,
    (error) => error.code === "PERSISTENT_FRONTIER_OPERATION_TIMEOUT",
  );
  assert.equal(poisonedArrayIteratorCalls, 0);
});

test("persistent frontier duration fence survives wall-clock rollback", async (context) => {
  const current = await import(FRONTIER_MODULE);
  const store = memoryBlobStore();
  const writer = current.createV2PersistentMerkleMap({
    domain: "candidate-current-state",
    epoch_id: EPOCH_ID,
    ...store.adapter,
  });
  const published = await writer.apply({
    root: writer.emptyRoot(),
    updates: [{ key: { number: 1 }, value: { state: "open" } }],
    mode: "upsert",
  });

  let wallNow = 1_000_000;
  let monotonicNow = 10_000;
  context.mock.method(Date, "now", () => wallNow);
  context.mock.method(performance, "now", () => monotonicNow);
  const isolated = await import(`${FRONTIER_MODULE}?monotonic-wall-rollback`);
  let observedWallDeadline = null;
  const reader = isolated.createV2PersistentMerkleMap({
    domain: "candidate-current-state",
    epoch_id: EPOCH_ID,
    operation_limits: { max_duration_ms: 25 },
    readBlob(objectOid, options) {
      observedWallDeadline = options.deadline_ms;
      wallNow -= 60_000;
      monotonicNow += 26;
      return store.adapter.readBlob(objectOid, options);
    },
    writeBlob: async () => assert.fail("deadline probe must not write"),
  });

  await assert.rejects(
    reader.lookup({ root: published.root, key: { number: 1 } }),
    (error) => error.code === "PERSISTENT_FRONTIER_OPERATION_TIMEOUT",
  );
  assert.equal(
    observedWallDeadline,
    1_000_025,
    "adapter evidence retains its wall-clock deadline",
  );
});

test("persistent frontier rejects settlement at the exact monotonic deadline", async (context) => {
  const current = await import(FRONTIER_MODULE);
  const store = memoryBlobStore();
  const writer = current.createV2PersistentMerkleMap({
    domain: "candidate-current-state",
    epoch_id: EPOCH_ID,
    ...store.adapter,
  });
  const published = await writer.apply({
    root: writer.emptyRoot(),
    updates: [{ key: { number: 1 }, value: { state: "open" } }],
    mode: "upsert",
  });

  let wallNow = 1_000_000;
  let monotonicNow = 10_000;
  context.mock.method(Date, "now", () => wallNow);
  context.mock.method(performance, "now", () => monotonicNow);
  const isolated = await import(`${FRONTIER_MODULE}?monotonic-exact-boundary`);
  const reader = isolated.createV2PersistentMerkleMap({
    domain: "candidate-current-state",
    epoch_id: EPOCH_ID,
    operation_limits: { max_duration_ms: 25 },
    readBlob(objectOid, options) {
      monotonicNow += 25;
      return store.adapter.readBlob(objectOid, options);
    },
    writeBlob: async () => assert.fail("deadline probe must not write"),
  });

  await assert.rejects(
    reader.lookup({ root: published.root, key: { number: 1 } }),
    (error) => error.code === "PERSISTENT_FRONTIER_OPERATION_TIMEOUT",
  );
});

test("persistent frontier ignores wall-clock jumps for duration enforcement", async (context) => {
  const current = await import(FRONTIER_MODULE);
  const store = memoryBlobStore();
  const writer = current.createV2PersistentMerkleMap({
    domain: "candidate-current-state",
    epoch_id: EPOCH_ID,
    ...store.adapter,
  });
  const published = await writer.apply({
    root: writer.emptyRoot(),
    updates: [{ key: { number: 1 }, value: { state: "open" } }],
    mode: "upsert",
  });

  let wallNow = 1_000_000;
  let monotonicNow = 10_000;
  context.mock.method(Date, "now", () => wallNow);
  context.mock.method(performance, "now", () => monotonicNow);
  const isolated = await import(`${FRONTIER_MODULE}?wall-clock-forward-jump`);
  let observedWallDeadline = null;
  const reader = isolated.createV2PersistentMerkleMap({
    domain: "candidate-current-state",
    epoch_id: EPOCH_ID,
    operation_limits: { max_duration_ms: 25 },
    readBlob(objectOid, options) {
      observedWallDeadline = options.deadline_ms;
      wallNow += 60_000;
      monotonicNow += 24;
      return store.adapter.readBlob(objectOid, options);
    },
    writeBlob: async () => assert.fail("deadline probe must not write"),
  });

  assert.deepEqual(
    await reader.lookup({ root: published.root, key: { number: 1 } }),
    { found: true, value: { state: "open" } },
  );
  assert.equal(observedWallDeadline, 1_000_025);
});

test("persistent frontier rearms an early timer until monotonic expiry", async (context) => {
  const current = await import(FRONTIER_MODULE);
  const store = memoryBlobStore();
  const writer = current.createV2PersistentMerkleMap({
    domain: "candidate-current-state",
    epoch_id: EPOCH_ID,
    ...store.adapter,
  });
  const published = await writer.apply({
    root: writer.emptyRoot(),
    updates: [{ key: { number: 1 }, value: { state: "open" } }],
    mode: "upsert",
  });

  let wallNow = 1_000_000;
  let monotonicNow = 10_000;
  const timerHandles = [];
  context.mock.method(Date, "now", () => wallNow);
  context.mock.method(performance, "now", () => monotonicNow);
  context.mock.method(globalThis, "setTimeout", (callback, delay) => {
    const handle = { callback, cleared: false, delay };
    timerHandles.push(handle);
    return handle;
  });
  context.mock.method(globalThis, "clearTimeout", (handle) => {
    handle.cleared = true;
  });
  const isolated = await import(`${FRONTIER_MODULE}?early-timeout-callback`);
  let requestSignal = null;
  const reader = isolated.createV2PersistentMerkleMap({
    domain: "candidate-current-state",
    epoch_id: EPOCH_ID,
    operation_limits: { max_duration_ms: 25 },
    readBlob: async (_objectOid, { signal }) => {
      requestSignal = signal;
      return new Promise(() => {});
    },
    writeBlob: async () => assert.fail("deadline probe must not write"),
  });

  const pending = reader.lookup({
    root: published.root,
    key: { number: 1 },
  });
  let outcome = "pending";
  void pending.then(
    () => { outcome = "resolved"; },
    (error) => { outcome = error.code; },
  );
  for (let index = 0; index < 4 && timerHandles.length === 0; index += 1) {
    await Promise.resolve();
  }
  assert.equal(timerHandles.length, 1);
  assert.equal(timerHandles[0].delay, 25);

  timerHandles[0].callback();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(outcome, "pending", "an early timer callback cannot expire the call");
  assert.equal(requestSignal?.aborted, false);
  assert.equal(timerHandles.length, 2);
  assert.equal(timerHandles[1].delay, 25);

  monotonicNow += 25;
  timerHandles[1].callback();
  await assert.rejects(
    pending,
    (error) => error.code === "PERSISTENT_FRONTIER_OPERATION_TIMEOUT",
  );
  assert.equal(requestSignal?.aborted, false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requestSignal?.aborted, true);
  assert.equal(timerHandles[1].cleared, true);
});

test("persistent frontier timeout settles before bounded abort cleanup and ignores timer export poison", async (context) => {
  const current = await import(FRONTIER_MODULE);
  const store = memoryBlobStore();
  const writer = current.createV2PersistentMerkleMap({
    domain: "candidate-current-state",
    epoch_id: EPOCH_ID,
    ...store.adapter,
  });
  const published = await writer.apply({
    root: writer.emptyRoot(),
    updates: [{ key: { number: 1 }, value: { state: "open" } }],
    mode: "upsert",
  });

  let monotonicNow = 10_000;
  const timerHandles = [];
  context.mock.method(Date, "now", () => 1_000_000);
  context.mock.method(performance, "now", () => monotonicNow);
  context.mock.method(globalThis, "setTimeout", (callback, delay) => {
    const handle = { callback, cleared: false, delay };
    timerHandles.push(handle);
    return handle;
  });
  context.mock.method(globalThis, "clearTimeout", (handle) => {
    handle.cleared = true;
  });

  const isolated = await import(
    `${FRONTIER_MODULE}?deferred-bounded-abort-cleanup`
  );
  let requestSignal = null;
  let failureObserved = false;
  let abortCalls = 0;
  let abortObservedAfterFailure = null;
  let caughtError = null;
  let cleanupReasonBeforeMutation = null;
  let synchronousWork = 0;
  const reader = isolated.createV2PersistentMerkleMap({
    domain: "candidate-current-state",
    epoch_id: EPOCH_ID,
    operation_limits: { max_duration_ms: 25 },
    readBlob: async (_objectOid, { signal }) => {
      requestSignal = signal;
      signal.addEventListener("abort", () => {
        abortCalls += 1;
        abortObservedAfterFailure = failureObserved;
        for (let index = 0; index < 1_000; index += 1) {
          synchronousWork += index & 1;
        }
        cleanupReasonBeforeMutation = {
          value: signal.reason,
          name: signal.reason.name,
          code: signal.reason.code,
          details: signal.reason.details,
          prototype: Object.getPrototypeOf(signal.reason),
        };
        signal.reason.name = "MutatedCleanupError";
        signal.reason.code = "MUTATED_CLEANUP_REASON";
        signal.reason.details = { mutated: true };
      }, { once: true });
      return new Promise(() => {});
    },
    writeBlob: async () => assert.fail("deadline probe must not write"),
  });

  const pending = reader.lookup({
    root: published.root,
    key: { number: 1 },
  });
  for (let index = 0;
    index < 8 && (timerHandles.length === 0 || requestSignal === null);
    index += 1) {
    await Promise.resolve();
  }
  assert.equal(timerHandles.length, 1);
  assert.notEqual(requestSignal, null);

  const originalSetImmediate = mutableTimers.setImmediate;
  let poisonedSchedulerCalls = 0;
  let poisonedCallbackCalls = 0;
  let timerCallbackError = null;
  mutableTimers.setImmediate = (callback) => {
    poisonedSchedulerCalls += 1;
    callback();
    poisonedCallbackCalls += 1;
    callback();
    poisonedCallbackCalls += 1;
    return { poisoned: true };
  };
  syncBuiltinESMExports();
  try {
    monotonicNow += 25;
    timerHandles[0].callback();
  } catch (error) {
    timerCallbackError = error;
  } finally {
    mutableTimers.setImmediate = originalSetImmediate;
    syncBuiltinESMExports();
  }
  assert.equal(timerCallbackError, null);
  assert.equal(poisonedSchedulerCalls, 0);
  assert.equal(poisonedCallbackCalls, 0);

  try {
    await pending;
    assert.fail("deadline probe must reject");
  } catch (error) {
    caughtError = error;
  }
  failureObserved = true;
  assert.equal(caughtError.name, "V2PersistentFrontierError");
  assert.equal(caughtError.code, "PERSISTENT_FRONTIER_OPERATION_TIMEOUT");
  assert.equal(caughtError.details, null);
  assert.equal(Object.hasOwn(caughtError, "cause"), false);
  assert.equal(
    Object.getPrototypeOf(caughtError),
    isolated.V2PersistentFrontierError.prototype,
  );
  assert.equal(abortCalls, 0);
  assert.equal(requestSignal.aborted, false);
  assert.equal(timerHandles[0].cleared, true);

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(abortCalls, 1);
  assert.equal(abortObservedAfterFailure, true);
  assert.equal(requestSignal.aborted, true);
  assert.notEqual(requestSignal.reason, caughtError);
  assert.equal(cleanupReasonBeforeMutation.value, requestSignal.reason);
  assert.equal(cleanupReasonBeforeMutation.name, "Error");
  assert.equal(cleanupReasonBeforeMutation.code, undefined);
  assert.equal(cleanupReasonBeforeMutation.details, undefined);
  assert.equal(cleanupReasonBeforeMutation.prototype, Error.prototype);
  assert.equal(requestSignal.reason.name, "MutatedCleanupError");
  assert.equal(requestSignal.reason.code, "MUTATED_CLEANUP_REASON");
  assert.deepEqual(requestSignal.reason.details, { mutated: true });
  assert.equal(caughtError.name, "V2PersistentFrontierError");
  assert.equal(caughtError.code, "PERSISTENT_FRONTIER_OPERATION_TIMEOUT");
  assert.equal(caughtError.details, null);
  assert.equal(Object.hasOwn(caughtError, "cause"), false);
  assert.equal(
    Object.getPrototypeOf(caughtError),
    isolated.V2PersistentFrontierError.prototype,
  );
  assert.equal(synchronousWork, 500);
});

test("persistent frontier resists accidental canonical helper monkey patches", async () => {
  const { createV2PersistentMerkleMap } = await import(FRONTIER_MODULE);
  const originalDefineProperty = Object.defineProperty;
  const targets = [
    [JSON, "stringify", JSON.stringify, () => "\"poisoned\""],
    [Reflect, "ownKeys", Reflect.ownKeys, () => []],
    [Object, "getOwnPropertyDescriptor", Object.getOwnPropertyDescriptor,
      () => undefined],
    [Object, "defineProperty", Object.defineProperty,
      () => { throw new Error("poisoned defineProperty dispatched"); }],
    [Object, "freeze", Object.freeze, (value) => value],
    [Object, "isFrozen", Object.isFrozen, () => true],
    [Object, "keys", Object.keys, () => []],
    [globalThis, "structuredClone", globalThis.structuredClone,
      () => ({ replaced: true })],
    [Buffer, "byteLength", Buffer.byteLength, () => 1],
    [RegExp.prototype, "exec", RegExp.prototype.exec, () => null],
    [Array, "isArray", Array.isArray, () => false],
    [Math, "min", Math.min, () => 0],
  ];
  let poisonedCalls = 0;
  for (let index = 0; index < targets.length; index += 1) {
    const [owner, key, original, poison] = targets[index];
    originalDefineProperty(owner, key, {
      configurable: true,
      writable: true,
      value(...args) {
        poisonedCalls += 1;
        return poison(...args);
      },
    });
    targets[index] = [owner, key, original, poison];
  }

  const store = memoryBlobStore();
  let publication;
  try {
    const frontier = createV2PersistentMerkleMap({
      domain: "candidate-current-state",
      epoch_id: EPOCH_ID,
      ...store.adapter,
    });
    publication = {
      frontier,
      promise: frontier.apply({
        root: frontier.emptyRoot(),
        updates: [{ key: { number: 1 }, value: { state: "open" } }],
        mode: "upsert",
      }),
    };
  } finally {
    for (let index = 0; index < targets.length; index += 1) {
      const [owner, key, original] = targets[index];
      originalDefineProperty(owner, key, {
        configurable: true,
        writable: true,
        value: original,
      });
    }
  }
  const published = await publication.promise;
  assert.equal(poisonedCalls, 0);
  assert.deepEqual(
    await publication.frontier.lookup({
      root: published.root,
      key: { number: 1 },
    }),
    { found: true, value: { state: "open" } },
  );
});

test("persistent frontier descriptor snapshots ignore inherited value state", async () => {
  const { createV2PersistentMerkleMap } = await import(FRONTIER_MODULE);
  const store = memoryBlobStore();
  const frontier = createV2PersistentMerkleMap({
    domain: "candidate-current-state",
    epoch_id: EPOCH_ID,
    ...store.adapter,
  });
  let limitGetterCalls = 0;
  const accessorLimits = {};
  Object.defineProperty(accessorLimits, "max_duration_ms", {
    enumerable: true,
    get() {
      limitGetterCalls += 1;
      return 1;
    },
  });
  let valueGetterCalls = 0;
  const accessorUpdate = {
    key: { number: 1 },
  };
  Object.defineProperty(accessorUpdate, "value", {
    enumerable: true,
    get() {
      valueGetterCalls += 1;
      return { state: "open" };
    },
  });

  let limitError = null;
  let updatePromise;
  Object.defineProperty(Object.prototype, "value", {
    configurable: true,
    writable: true,
    value: 1,
  });
  try {
    try {
      createV2PersistentMerkleMap({
        domain: "candidate-current-state",
        epoch_id: EPOCH_ID,
        operation_limits: accessorLimits,
        ...store.adapter,
      });
    } catch (error) {
      limitError = error;
    }
    updatePromise = frontier.apply({
      root: frontier.emptyRoot(),
      updates: [accessorUpdate],
      mode: "upsert",
    });
  } finally {
    delete Object.prototype.value;
  }
  assert.match(
    limitError?.message ?? "",
    /operation limits must use enumerable data properties/u,
  );
  await assert.rejects(
    updatePromise,
    /persistent frontier update 0 must use enumerable data properties/u,
  );
  assert.equal(limitGetterCalls, 0);
  assert.equal(valueGetterCalls, 0);
  assert.equal(store.writeCalls.length, 0);
});

test("persistent frontier write loss leaves only retryable content-addressed orphans", async () => {
  const { createV2PersistentMerkleMap } = await import(FRONTIER_MODULE);
  const store = memoryBlobStore();
  let loseFirstResponse = true;
  const frontier = createV2PersistentMerkleMap({
    domain: "candidate-identity-frontier",
    epoch_id: EPOCH_ID,
    readBlob: store.adapter.readBlob,
    async writeBlob(bytes, options) {
      const oid = await store.adapter.writeBlob(bytes, options);
      if (loseFirstResponse) {
        loseFirstResponse = false;
        throw new Error("simulated response loss after object creation");
      }
      return oid;
    },
  });
  const empty = frontier.emptyRoot();
  const updates = Array.from({ length: 8 }, (_, index) => ({
    key: { pull_request_number: index + 1 },
    value: identity(index + 1),
  }));
  await assert.rejects(
    frontier.apply({ root: empty, updates, mode: "insert-only" }),
    (error) => error.code === "PERSISTENT_FRONTIER_OBJECT_UNWRITABLE",
  );
  assert.equal(empty.count, 0, "the failed call cannot publish a new root");
  assert.equal(store.blobs.size, 1, "only one unreachable object was created");
  const recovered = await frontier.apply({
    root: empty,
    updates,
    mode: "insert-only",
  });
  const freshStore = memoryBlobStore();
  const fresh = createV2PersistentMerkleMap({
    domain: "candidate-identity-frontier",
    epoch_id: EPOCH_ID,
    ...freshStore.adapter,
  });
  const expected = await fresh.apply({
    root: fresh.emptyRoot(),
    updates,
    mode: "insert-only",
  });
  assert.equal(recovered.root.root_digest, expected.root.root_digest);
  assert.equal(recovered.root.node.object_oid, expected.root.node.object_oid);
});

test("persistent frontier rejects ambiguous or unbounded canonical JSON before writes", async () => {
  const { createV2PersistentMerkleMap } = await import(FRONTIER_MODULE);
  const store = memoryBlobStore();
  const frontier = createV2PersistentMerkleMap({
    domain: "candidate-current-state",
    epoch_id: EPOCH_ID,
    ...store.adapter,
  });
  const invalidValues = [
    {
      value: { number: -0 },
      code: "PERSISTENT_FRONTIER_NON_CANONICAL_NUMBER",
    },
    {
      value: new Array(1),
      code: "PERSISTENT_FRONTIER_NON_CANONICAL_ARRAY",
    },
    {
      value: Object.assign([1], { extra: true }),
      code: "PERSISTENT_FRONTIER_NON_CANONICAL_ARRAY",
    },
  ];
  for (const [index, invalid] of invalidValues.entries()) {
    await assert.rejects(
      frontier.apply({
        root: frontier.emptyRoot(),
        updates: [{ key: { index }, value: invalid.value }],
        mode: "upsert",
      }),
      (error) => error.code === invalid.code,
    );
  }
  const invalidKeys = [
    undefined,
    -0,
    new Array(1),
    { value: undefined },
  ];
  for (const key of invalidKeys) {
    await assert.rejects(
      frontier.lookup({
        root: frontier.emptyRoot(),
        key,
      }),
      "empty-root lookup must reject keys outside the canonical domain",
    );
  }
  let deep = { terminal: true };
  for (let index = 0; index < 70; index += 1) deep = { child: deep };
  await assert.rejects(
    frontier.apply({
      root: frontier.emptyRoot(),
      updates: [{ key: { number: 1 }, value: deep }],
      mode: "upsert",
    }),
    (error) => error.code === "PERSISTENT_FRONTIER_CANONICAL_DEPTH_CAP",
  );
  assert.equal(store.writeCalls.length, 0);

  const proxyStore = memoryBlobStore();
  const proxyFrontier = createV2PersistentMerkleMap({
    domain: "candidate-current-state",
    epoch_id: EPOCH_ID,
    ...proxyStore.adapter,
  });
  const proxyTraps = [];
  const proxyValue = new Proxy({ state: "captured" }, {
    getPrototypeOf(target) {
      proxyTraps.push("getPrototypeOf");
      return Reflect.getPrototypeOf(target);
    },
    ownKeys(target) {
      proxyTraps.push("ownKeys");
      return Reflect.ownKeys(target);
    },
  });
  await assert.rejects(
    proxyFrontier.apply({
      root: proxyFrontier.emptyRoot(),
      updates: [{
        key: { number: 1 },
        value: { nested: proxyValue },
      }],
      mode: "upsert",
    }),
    (error) => error.code === "PERSISTENT_FRONTIER_NON_CANONICAL_OBJECT",
  );
  assert.deepEqual(proxyTraps, [], "proxy inputs are rejected without traps");
  assert.equal(proxyStore.writeCalls.length, 0);

  const setterStore = memoryBlobStore();
  const setterFrontier = createV2PersistentMerkleMap({
    domain: "candidate-current-state",
    epoch_id: EPOCH_ID,
    ...setterStore.adapter,
  });
  let inheritedSetterCalls = 0;
  Object.defineProperty(Object.prototype, "key", {
    configurable: true,
    set() {
      inheritedSetterCalls += 1;
      Object.defineProperty(this, "key", {
        value: { number: 2 },
        enumerable: true,
        writable: true,
        configurable: true,
      });
    },
  });
  try {
    const setterPublished = await setterFrontier.apply({
      root: setterFrontier.emptyRoot(),
      updates: [{ key: { number: 1 }, value: "A" }],
      mode: "upsert",
    });
    assert.equal(inheritedSetterCalls, 0);
    assert.deepEqual(
      await setterFrontier.lookup({
        root: setterPublished.root,
        key: { number: 1 },
      }),
      { found: true, value: "A" },
    );
    assert.deepEqual(
      await setterFrontier.lookup({
        root: setterPublished.root,
        key: { number: 2 },
      }),
      { found: false, value: null },
    );
  } finally {
    delete Object.prototype.key;
  }
});

function identity(number) {
  return {
    id: String(1000 + number),
    node_id: `PR_${number}`,
    number,
    created_at: new Date(Date.UTC(2026, 0, 1, 0, number)).toISOString(),
  };
}

function* permutations(values, prefix = []) {
  if (values.length === 0) {
    yield prefix;
    return;
  }
  for (let index = 0; index < values.length; index += 1) {
    yield* permutations(
      values.toSpliced(index, 1),
      [...prefix, values[index]],
    );
  }
}

function memoryBlobStore() {
  const blobs = new Map();
  const readCalls = [];
  const writeCalls = [];
  return {
    blobs,
    readCalls,
    writeCalls,
    adapter: {
      async readBlob(objectOid) {
        readCalls.push(objectOid);
        const value = blobs.get(objectOid);
        return value === undefined ? null : new Uint8Array(value);
      },
      async writeBlob(bytes) {
        const value = new Uint8Array(bytes);
        const header = new TextEncoder().encode(`blob ${value.byteLength}\0`);
        const objectOid = createHash("sha1")
          .update(header)
          .update(value)
          .digest("hex");
        writeCalls.push(objectOid);
        blobs.set(objectOid, value);
        return objectOid;
      },
    },
  };
}

function authenticateRootNodeMutation({ root, store, domain, mutate }) {
  const originalBytes = store.blobs.get(root.node.object_oid);
  const node = JSON.parse(new TextDecoder().decode(originalBytes));
  mutate(node);
  delete node.node_digest;
  node.node_digest = digestCanonicalForTest(
    `${domain}:persistent-frontier-node`,
    node,
  );
  const bytes = new TextEncoder().encode(`${canonicalJsonForTest(node)}\n`);
  const objectOid = gitBlobOidForTest(bytes);
  store.blobs.set(objectOid, bytes);
  const descriptor = {
    object_oid: objectOid,
    object_sha256: rawDigestForTest(bytes),
    object_bytes: bytes.byteLength,
    node_digest: node.node_digest,
    kind: node.kind,
    prefix_bits: node.prefix_bits,
    prefix: node.prefix,
    min_key_digest: node.min_key_digest,
    max_key_digest: node.max_key_digest,
    count: node.count,
    height: node.height,
  };
  const withoutDigest = {
    schema: root.schema,
    schema_version: root.schema_version,
    domain: root.domain,
    count: descriptor.count,
    height: descriptor.height,
    node: descriptor,
  };
  return {
    ...withoutDigest,
    root_digest: digestCanonicalForTest(
      `${domain}:persistent-frontier-root`,
      withoutDigest,
    ),
  };
}

function rebindRootNodeBytes({ root, bytes, domain }) {
  const descriptor = {
    ...root.node,
    object_oid: gitBlobOidForTest(bytes),
    object_sha256: rawDigestForTest(bytes),
    object_bytes: bytes.byteLength,
  };
  const withoutDigest = {
    schema: root.schema,
    schema_version: root.schema_version,
    domain: root.domain,
    count: root.count,
    height: root.height,
    node: descriptor,
  };
  return {
    ...withoutDigest,
    root_digest: digestCanonicalForTest(
      `${domain}:persistent-frontier-root`,
      withoutDigest,
    ),
  };
}

function gitBlobOidForTest(bytes) {
  const header = new TextEncoder().encode(`blob ${bytes.byteLength}\0`);
  return createHash("sha1").update(header).update(bytes).digest("hex");
}

function rawDigestForTest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function digestCanonicalForTest(domain, value) {
  const encoder = new TextEncoder();
  const domainBytes = encoder.encode(domain);
  const payload = encoder.encode(canonicalJsonForTest(value));
  const prefix = Buffer.alloc(8);
  prefix.writeUInt32BE(domainBytes.length, 0);
  prefix.writeUInt32BE(payload.length, 4);
  return `sha256:${createHash("sha256")
    .update(prefix)
    .update(domainBytes)
    .update(payload)
    .digest("hex")}`;
}

function canonicalJsonForTest(value) {
  if (value === null || typeof value === "string" ||
      typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonForTest).join(",")}]`;
  }
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJsonForTest(value[key])}`).join(",")}}`;
}
