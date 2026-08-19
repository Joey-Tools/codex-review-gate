import { createHash } from "node:crypto";
import { setImmediate as scheduleImmediate } from "node:timers";
import { TextDecoder, TextEncoder, types as utilTypes } from "node:util";

export const V2_PERSISTENT_FRONTIER_ROOT_SCHEMA =
  "codex-review-gate-persistent-frontier-root-v2";
export const V2_PERSISTENT_FRONTIER_NODE_SCHEMA =
  "codex-review-gate-persistent-frontier-node-v2";
export const V2_PERSISTENT_FRONTIER_CURSOR_SCHEMA =
  "codex-review-gate-persistent-frontier-cursor-v2";
export const MAX_V2_PERSISTENT_FRONTIER_KEY_BYTES = 2 * 1024;
export const MAX_V2_PERSISTENT_FRONTIER_VALUE_BYTES = 64 * 1024;
export const MAX_V2_PERSISTENT_FRONTIER_NODE_BYTES = 1024 * 1024;
export const MAX_V2_PERSISTENT_FRONTIER_HEIGHT = 256;
export const MAX_V2_PERSISTENT_FRONTIER_UPDATES = 512;
export const MAX_V2_PERSISTENT_FRONTIER_SCAN = 512;
export const MAX_V2_PERSISTENT_FRONTIER_OPERATION_OBJECTS = 4096;
export const MAX_V2_PERSISTENT_FRONTIER_OPERATION_BYTES = 64 * 1024 * 1024;
export const MAX_V2_PERSISTENT_FRONTIER_UPDATE_BYTES = 16 * 1024 * 1024;
export const MAX_V2_PERSISTENT_FRONTIER_OPERATION_MS = 30_000;
export const MAX_V2_PERSISTENT_FRONTIER_CANONICAL_DEPTH = 64;
export const MAX_V2_PERSISTENT_FRONTIER_CANONICAL_NODES = 65_536;

const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const BITS = /^[01]*$/u;
const DOMAIN = /^[a-z0-9](?:[a-z0-9.-]{0,126}[a-z0-9])?$/u;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const isProxy = utilTypes.isProxy;
const isUint8Array = utilTypes.isUint8Array;
const isSharedArrayBuffer = utilTypes.isSharedArrayBuffer;
const SafeMap = Map;
const SafeSet = Set;
const SafeWeakMap = WeakMap;
const SafePromise = Promise;
const SafeAbortController = AbortController;
const SafeUint8Array = Uint8Array;
const SafeArrayBuffer = ArrayBuffer;
const SafeBuffer = Buffer;
const reflectApply = Reflect.apply;
const reflectOwnKeys = Reflect.ownKeys;
const dateNow = Date.now;
const performanceNowIntrinsic = performance.now;
const safeSetTimeout = setTimeout;
const safeClearTimeout = clearTimeout;
const safeScheduleImmediate = scheduleImmediate;
const objectFreeze = Object.freeze;
const objectIsFrozen = Object.isFrozen;
const objectIs = Object.is;
const objectKeys = Object.keys;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectDefineProperty = Object.defineProperty;
const objectHasOwn = Object.hasOwn;
const objectPrototype = Object.prototype;
const jsonParse = JSON.parse;
const jsonStringify = JSON.stringify;
const numberIsSafeInteger = Number.isSafeInteger;
const numberParseInt = Number.parseInt;
const mathMin = Math.min;
const mathMax = Math.max;
const bufferAlloc = SafeBuffer.alloc;
const bufferByteLength = SafeBuffer.byteLength;
const bufferWriteUInt32BE = SafeBuffer.prototype.writeUInt32BE;
const safeStructuredClone = structuredClone;
const promiseResolveIntrinsic = SafePromise.resolve;
const promiseThenIntrinsic = SafePromise.prototype.then;
const mapGetIntrinsic = SafeMap.prototype.get;
const mapSetIntrinsic = SafeMap.prototype.set;
const mapHasIntrinsic = SafeMap.prototype.has;
const setAddIntrinsic = SafeSet.prototype.add;
const setHasIntrinsic = SafeSet.prototype.has;
const weakMapGetIntrinsic = SafeWeakMap.prototype.get;
const weakMapSetIntrinsic = SafeWeakMap.prototype.set;
const weakMapDeleteIntrinsic = SafeWeakMap.prototype.delete;
const arraySortIntrinsic = Array.prototype.sort;
const arrayJoinIntrinsic = Array.prototype.join;
const arrayIsArray = Array.isArray;
const stringStartsWithIntrinsic = String.prototype.startsWith;
const stringEndsWithIntrinsic = String.prototype.endsWith;
const stringSliceIntrinsic = String.prototype.slice;
const stringPadStartIntrinsic = String.prototype.padStart;
const numberToStringIntrinsic = Number.prototype.toString;
const regexpExecIntrinsic = RegExp.prototype.exec;
const functionHasInstanceIntrinsic = Function.prototype[Symbol.hasInstance];
const textEncodeIntrinsic = objectGetPrototypeOf(encoder).encode;
const textDecodeIntrinsic = objectGetPrototypeOf(decoder).decode;
const typedArrayByteLengthGetter = objectGetOwnPropertyDescriptor(
  objectGetPrototypeOf(SafeUint8Array.prototype),
  "byteLength",
).get;
const typedArrayBufferGetter = objectGetOwnPropertyDescriptor(
  objectGetPrototypeOf(SafeUint8Array.prototype),
  "buffer",
).get;
const arrayBufferResizableGetter = objectGetOwnPropertyDescriptor(
  SafeArrayBuffer.prototype,
  "resizable",
)?.get ?? null;
const abortControllerAbortIntrinsic = SafeAbortController.prototype.abort;
const abortControllerSignalGetter = objectGetOwnPropertyDescriptor(
  SafeAbortController.prototype,
  "signal",
).get;
const hashPrototype = objectGetPrototypeOf(createHash("sha256"));
const hashUpdateIntrinsic = hashPrototype.update;
const hashDigestIntrinsic = hashPrototype.digest;

export class V2PersistentFrontierError extends Error {
  constructor(code, message, details = null, cause = undefined) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "V2PersistentFrontierError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Create one canonical persistent Merkle-Patricia map.
 *
 * The protected property is exact key/value membership. A node's path is the
 * domain-separated SHA-256 of the canonical original key, while every leaf
 * retains that original key and verifies it again on load. Compressed binary
 * branch points are therefore a pure function of the final key set: insertion
 * order and batch partitioning cannot change the authenticated root.
 *
 * Operation byte limits count canonical raw Git-blob bytes. A production Git
 * adapter must additionally charge its encoded request/response bytes and
 * request count against the checkpoint transaction's shared absolute budget.
 * Scan cursors are same-factory, single-job, linear capabilities: consuming a
 * cursor invalidates it before the first asynchronous read. A complete scan is
 * guaranteed only when that root fits the configured single-operation budget;
 * authenticated continuation for larger offline audits belongs to the ledger
 * integration rather than to this runtime cursor.
 * The Node realm, module bootstrap, and production adapter functions are a
 * trusted authority boundary. Captured helpers reduce accidental monkey-patch
 * dispatch, but this module is not a realm sandbox and does not authorize a
 * generic caller-supplied adapter to mint production checkpoint authority.
 * The hard deadline cannot preempt arbitrary synchronous work during the
 * initial trusted adapter call; a post-call monotonic fence still classifies
 * an adapter that returns or throws at or after the exact deadline as timed out.
 * Adapter abort listeners are trusted cleanup and must remain non-throwing,
 * cooperative, and bounded. Native Node EventTarget listener failures may be
 * rethrown on process.nextTick and are not contained by this module.
 * Serialized roots/nodes must also arrive through the ledger's byte-bounded
 * decoder; JavaScript cannot enumerate an already-materialized, unbounded own
 * key set without first allocating that enumeration.
 */
export function createV2PersistentMerkleMap({
  domain,
  epoch_id,
  readBlob,
  writeBlob,
  operation_limits = {},
} = {}) {
  const selectedDomain = normalizeDomain(domain);
  const selectedEpochId = normalizeEpochId(epoch_id);
  if (typeof readBlob !== "function" || typeof writeBlob !== "function") {
    throw new TypeError("persistent frontier requires blob read and write adapters");
  }
  const operationLimits = normalizeOperationLimits(operation_limits);
  const cursorBindings = new SafeWeakMap();

  const emptyRoot = () => sealRoot({
    domain: selectedDomain,
    count: 0,
    height: 0,
    node: null,
  });

  async function apply({ root, updates, mode }) {
    const operation = createOperationContext({
      limits: operationLimits,
      readBlob,
      writeBlob,
    });
    const selectedRoot = validateRoot(root, selectedDomain);
    if (mode !== "insert-only" && mode !== "upsert") {
      throw new TypeError("persistent frontier apply mode is invalid");
    }
    const selectedUpdates = normalizeUpdates(
      updates,
      selectedDomain,
      operation,
    );
    if (selectedUpdates.length === 0) {
      const result = deepFreeze({ root: selectedRoot, created_objects: [] });
      assertOperationOpen(operation);
      return result;
    }
    let current = selectedRoot.node === null
      ? null
      : stubNode(selectedRoot.node);
    let changed = false;
    for (let index = 0; index < selectedUpdates.length; index += 1) {
      const update = selectedUpdates[index];
      if (current === null) {
        current = dirtyLeaf(update);
        changed = true;
        continue;
      }
      const inserted = await insertEntry({
        node: current,
        entry: update,
        mode,
        domain: selectedDomain,
        operation,
      });
      current = inserted.node;
      changed ||= inserted.changed;
    }
    if (!changed) {
      const result = deepFreeze({ root: selectedRoot, created_objects: [] });
      assertOperationOpen(operation);
      return result;
    }
    const preparedObjects = [];
    const descriptor = prepareNode({
      node: current,
      domain: selectedDomain,
      operation,
      preparedObjects,
      preparedOids: new SafeSet(),
      persisted: new SafeWeakMap(),
    });
    await publishPreparedObjects(preparedObjects, operation);
    const result = deepFreeze({
      root: sealRoot({
        domain: selectedDomain,
        count: descriptor.count,
        height: descriptor.height,
        node: descriptor,
      }),
      created_objects: mapArray(
        preparedObjects,
        ({ descriptor: value }) => value,
      ),
    });
    assertOperationOpen(operation);
    return result;
  }

  async function lookup({ root, key }) {
    const operation = createOperationContext({
      limits: operationLimits,
      readBlob,
      writeBlob,
    });
    const selectedRoot = validateRoot(root, selectedDomain);
    const selectedKey = normalizeKey(key, selectedDomain, operation);
    if (selectedRoot.node === null) {
      const result = deepFreeze({ found: false, value: null });
      assertOperationOpen(operation);
      return result;
    }
    const keyBits = digestBits(selectedKey.key_digest);
    let node = stubNode(selectedRoot.node);
    const seenOids = new SafeSet();
    while (true) {
      assertOperationOpen(operation);
      if (!node.dirty) {
        if (setHas(seenOids, node.descriptor.object_oid)) {
          throw frontierError(
            "PERSISTENT_FRONTIER_OBJECT_REUSED",
            "persistent frontier lookup encountered a reused or cyclic node",
            { object_oid: node.descriptor.object_oid },
          );
        }
        setAdd(seenOids, node.descriptor.object_oid);
      }
      node = await materializeNode(node, selectedDomain, operation);
      const summary = nodeSummary(node);
      if (!stringStartsWith(keyBits, summary.prefix)) {
        const result = deepFreeze({ found: false, value: null });
        assertOperationOpen(operation);
        return result;
      }
      if (node.kind === "leaf") {
        if (node.entry.key_digest !== selectedKey.key_digest) {
          const result = deepFreeze({ found: false, value: null });
          assertOperationOpen(operation);
          return result;
        }
        if (node.entry.key_canonical !== selectedKey.key_canonical) {
          throw frontierError(
            "PERSISTENT_FRONTIER_KEY_HASH_COLLISION",
            "persistent frontier key hash maps to a different original key",
            { key_digest: selectedKey.key_digest },
          );
        }
        const result = deepFreeze({
          found: true,
          value: cloneValue(node.entry.value),
        });
        assertOperationOpen(operation);
        return result;
      }
      node = keyBits[summary.prefix_bits] === "0" ? node.left : node.right;
    }
  }

  async function scan({
    root,
    cursor = null,
    limit = MAX_V2_PERSISTENT_FRONTIER_SCAN,
  }) {
    const cursorBinding = cursor === null
      ? null
      : weakMapGet(cursorBindings, cursor);
    if (cursor !== null && cursorBinding === undefined) {
      throw frontierError(
        "UNTRUSTED_PERSISTENT_FRONTIER_CURSOR",
        "persistent frontier cursor is foreign, stale, cloned, or malformed",
      );
    }
    const operation = cursorBinding?.operation ?? createOperationContext({
      limits: operationLimits,
      readBlob,
      writeBlob,
    });
    const selectedRoot = validateRoot(root, selectedDomain);
    assertOperationOpen(operation);
    if (!numberIsSafeInteger(limit) || limit <= 0 ||
        limit > MAX_V2_PERSISTENT_FRONTIER_SCAN) {
      throw new TypeError("persistent frontier scan limit is invalid");
    }
    const selectedCursor = cursor === null
      ? null
      : validateCursor(
        cursor,
        selectedRoot,
        selectedDomain,
        selectedEpochId,
        cursorBindings,
      );
    if (selectedCursor !== null && selectedCursor.operation !== operation) {
      throw frontierError(
        "UNTRUSTED_PERSISTENT_FRONTIER_CURSOR",
        "persistent frontier cursor operation binding changed",
      );
    }
    if (selectedRoot.node === null) {
      const result = deepFreeze({ entries: [], next_cursor: null });
      assertOperationOpen(operation);
      return result;
    }
    const entries = [];
    await collectEntries({
      node: stubNode(selectedRoot.node),
      domain: selectedDomain,
      operation,
      afterDigest: selectedCursor?.last_key_digest ?? null,
      limit: limit + 1,
      entries,
      seenOids: new SafeSet(),
    });
    const hasMore = entries.length > limit;
    const selected = copyArrayRange(entries, 0, limit);
    let nextCursor = null;
    if (hasMore) {
      const last = selected[selected.length - 1];
      nextCursor = sealCursor({
        domain: selectedDomain,
        epochId: selectedEpochId,
        rootDigest: selectedRoot.root_digest,
        lastKeyDigest: last.key_digest,
        lastKeyCanonical: last.key_canonical,
      });
      weakMapSet(cursorBindings, nextCursor, {
        root_digest: selectedRoot.root_digest,
        epoch_id: selectedEpochId,
        cursor_digest: nextCursor.cursor_digest,
        operation,
      });
    }
    const result = deepFreeze({
      entries: mapArray(selected, (entry) => ({
        key: cloneValue(entry.key),
        value: cloneValue(entry.value),
      })),
      next_cursor: nextCursor,
    });
    assertOperationOpen(operation);
    return result;
  }

  return objectFreeze({ emptyRoot, apply, lookup, scan });
}

async function insertEntry({ node, entry, mode, domain, operation }) {
  assertOperationOpen(operation);
  const current = await materializeNode(node, domain, operation);
  const currentSummary = nodeSummary(current);
  const entryBits = digestBits(entry.key_digest);
  if (current.kind === "leaf") {
    if (current.entry.key_digest === entry.key_digest) {
      if (current.entry.key_canonical !== entry.key_canonical) {
        throw frontierError(
          "PERSISTENT_FRONTIER_KEY_HASH_COLLISION",
          "persistent frontier key hash maps to two original keys",
          { key_digest: entry.key_digest },
        );
      }
      if (current.entry.value_digest === entry.value_digest &&
          canonicalJson(current.entry.value, { operation }) ===
            canonicalJson(entry.value, { operation })) {
        return { node: current, changed: false };
      }
      if (mode === "insert-only") {
        throw frontierError(
          "PERSISTENT_FRONTIER_VALUE_CONFLICT",
          "insert-only frontier entry cannot change its retained value",
          { key_digest: entry.key_digest },
        );
      }
      return { node: dirtyLeaf(entry), changed: true };
    }
    return {
      node: joinNodes(current, dirtyLeaf(entry)),
      changed: true,
    };
  }
  if (!stringStartsWith(entryBits, currentSummary.prefix)) {
    return {
      node: joinNodes(current, dirtyLeaf(entry)),
      changed: true,
    };
  }
  const side = entryBits[currentSummary.prefix_bits];
  const selected = side === "0" ? current.left : current.right;
  const inserted = await insertEntry({
    node: selected,
    entry,
    mode,
    domain,
    operation,
  });
  if (!inserted.changed) return { node: current, changed: false };
  return {
    node: side === "0"
      ? dirtyBranch(inserted.node, current.right)
      : dirtyBranch(current.left, inserted.node),
    changed: true,
  };
}

function joinNodes(first, second) {
  const leftFirst = asciiCompare(
    nodeSummary(first).min_key_digest,
    nodeSummary(second).min_key_digest,
  ) < 0;
  return leftFirst ? dirtyBranch(first, second) : dirtyBranch(second, first);
}

function dirtyLeaf(entry) {
  return {
    kind: "leaf",
    entry,
    left: null,
    right: null,
    dirty: true,
    loaded: true,
    descriptor: null,
  };
}

function dirtyBranch(left, right) {
  const summary = branchSummary(nodeSummary(left), nodeSummary(right));
  return {
    kind: "branch",
    entry: null,
    left,
    right,
    dirty: true,
    loaded: true,
    descriptor: null,
    summary,
  };
}

function stubNode(descriptor) {
  return {
    kind: descriptor.kind,
    entry: null,
    left: null,
    right: null,
    dirty: false,
    loaded: false,
    descriptor,
  };
}

async function materializeNode(node, domain, operation) {
  if (node.dirty || node.loaded) return node;
  return loadNode(node.descriptor, domain, operation);
}

function nodeSummary(node) {
  if (!node.dirty) return node.descriptor;
  if (node.kind === "leaf") {
    const prefix = digestBits(node.entry.key_digest);
    return {
      kind: "leaf",
      prefix_bits: 256,
      prefix,
      count: 1,
      height: 0,
      min_key_digest: node.entry.key_digest,
      max_key_digest: node.entry.key_digest,
    };
  }
  return node.summary;
}

function branchSummary(left, right) {
  if (asciiCompare(left.max_key_digest, right.min_key_digest) >= 0) {
    throw frontierError(
      "PERSISTENT_FRONTIER_NODE_MALFORMED",
      "persistent frontier branch key ranges overlap",
    );
  }
  const leftMinBits = digestBits(left.min_key_digest);
  const rightMaxBits = digestBits(right.max_key_digest);
  const prefix = commonBitPrefix(leftMinBits, rightMaxBits);
  if (prefix.length >= 256 ||
      !stringStartsWith(left.prefix, `${prefix}0`) ||
      !stringStartsWith(right.prefix, `${prefix}1`)) {
    throw frontierError(
      "PERSISTENT_FRONTIER_NODE_MALFORMED",
      "persistent frontier branch is not the canonical Patricia split",
    );
  }
  const height = mathMax(left.height, right.height) + 1;
  const count = left.count + right.count;
  if (height > MAX_V2_PERSISTENT_FRONTIER_HEIGHT ||
      !numberIsSafeInteger(count)) {
    throw frontierError(
      "PERSISTENT_FRONTIER_HEIGHT_CAP",
      "persistent frontier branch exceeds its structural cap",
    );
  }
  return {
    kind: "branch",
    prefix_bits: prefix.length,
    prefix,
    count,
    height,
    min_key_digest: left.min_key_digest,
    max_key_digest: right.max_key_digest,
  };
}

function prepareNode({
  node,
  domain,
  operation,
  preparedObjects,
  preparedOids,
  persisted,
}) {
  assertOperationOpen(operation);
  if (!node.dirty) return node.descriptor;
  const cached = weakMapGet(persisted, node);
  if (cached !== undefined) return cached;
  const summary = nodeSummary(node);
  const left = node.kind === "branch"
    ? prepareNode({
      node: node.left,
      domain,
      operation,
      preparedObjects,
      preparedOids,
      persisted,
    })
    : null;
  const right = node.kind === "branch"
    ? prepareNode({
      node: node.right,
      domain,
      operation,
      preparedObjects,
      preparedOids,
      persisted,
    })
    : null;
  if (node.kind === "branch") {
    const persistedSummary = branchSummary(left, right);
    if (canonicalJson(persistedSummary) !== canonicalJson(summary)) {
      throw frontierError(
        "PERSISTENT_FRONTIER_NODE_MISMATCH",
        "persistent frontier child descriptors changed their branch summary",
      );
    }
  }
  if (operation.prepared_write_objects + 1 >
      operation.limits.max_write_objects) {
    throw frontierError(
      "PERSISTENT_FRONTIER_OPERATION_WRITE_CAP",
      "persistent frontier prepare exceeds its aggregate object budget",
    );
  }
  assertOperationOpen(operation);
  const withoutDigest = {
    schema: V2_PERSISTENT_FRONTIER_NODE_SCHEMA,
    schema_version: 1,
    domain,
    kind: node.kind,
    prefix_bits: summary.prefix_bits,
    prefix: summary.prefix,
    height: summary.height,
    count: summary.count,
    min_key_digest: summary.min_key_digest,
    max_key_digest: summary.max_key_digest,
    entry: node.kind === "leaf" ? cloneValue(node.entry) : null,
    left,
    right,
  };
  const value = {
    ...withoutDigest,
    node_digest: digestCanonical(
      `${domain}:persistent-frontier-node`,
      withoutDigest,
    ),
  };
  const bytes = textEncode(`${canonicalJson(value)}\n`);
  const byteLength = typedArrayByteLength(bytes);
  if (byteLength > MAX_V2_PERSISTENT_FRONTIER_NODE_BYTES) {
    throw frontierError(
      "PERSISTENT_FRONTIER_NODE_SIZE_CAP",
      "persistent frontier node exceeds its blob cap",
    );
  }
  if (operation.prepared_write_bytes + byteLength >
      operation.limits.max_write_bytes) {
    throw frontierError(
      "PERSISTENT_FRONTIER_OPERATION_WRITE_CAP",
      "persistent frontier prepare exceeds its aggregate byte budget",
    );
  }
  const expectedOid = gitBlobOid(bytes);
  const descriptor = deepFreeze({
    object_oid: expectedOid,
    object_sha256: rawDigest(bytes),
    object_bytes: byteLength,
    node_digest: value.node_digest,
    kind: summary.kind,
    prefix_bits: summary.prefix_bits,
    prefix: summary.prefix,
    min_key_digest: summary.min_key_digest,
    max_key_digest: summary.max_key_digest,
    count: summary.count,
    height: summary.height,
  });
  weakMapSet(persisted, node, descriptor);
  if (!setHas(preparedOids, expectedOid)) {
    operation.prepared_write_objects += 1;
    operation.prepared_write_bytes += byteLength;
    setAdd(preparedOids, expectedOid);
    appendArrayElement(preparedObjects, {
      descriptor,
      bytes: new SafeUint8Array(bytes),
    });
  }
  return descriptor;
}

async function publishPreparedObjects(preparedObjects, operation) {
  let totalBytes = 0;
  for (let index = 0; index < preparedObjects.length; index += 1) {
    totalBytes += typedArrayByteLength(preparedObjects[index].bytes);
  }
  assertOperationOpen(operation);
  if (preparedObjects.length > operation.limits.max_write_objects ||
      totalBytes > operation.limits.max_write_bytes) {
    throw frontierError(
      "PERSISTENT_FRONTIER_OPERATION_WRITE_CAP",
      "persistent frontier update exceeds its aggregate write budget",
      {
        objects: preparedObjects.length,
        bytes: totalBytes,
      },
    );
  }
  for (let index = 0; index < preparedObjects.length; index += 1) {
    const object = preparedObjects[index];
    const actualOid = await callBlobAdapter({
      operation,
      kind: "write",
      objectOid: object.descriptor.object_oid,
      bytes: object.bytes,
    });
    if (actualOid !== object.descriptor.object_oid) {
      throw frontierError(
        "PERSISTENT_FRONTIER_OBJECT_MISMATCH",
        "persistent frontier blob writer returned the wrong Git object id",
      );
    }
  }
}

async function loadNode(descriptorValue, domain, operation) {
  const descriptor = normalizeDescriptor(descriptorValue);
  const returnedBytes = await callBlobAdapter({
    operation,
    kind: "read",
    objectOid: descriptor.object_oid,
    expectedBytes: descriptor.object_bytes,
  });
  if (returnedBytes === null || returnedBytes === undefined) {
    throw frontierError(
      "PERSISTENT_FRONTIER_OBJECT_MISSING",
      "persistent frontier node blob is missing",
      { object_oid: descriptor.object_oid },
    );
  }
  if (!isUint8Array(returnedBytes)) {
    throw frontierError(
      "PERSISTENT_FRONTIER_OBJECT_UNREADABLE",
      "persistent frontier node reader returned non-bytes",
    );
  }
  // callBlobAdapter already converted an accepted view to one module-owned,
  // fixed ArrayBuffer snapshot before crossing this async return boundary.
  const bytes = returnedBytes;
  const byteLength = typedArrayByteLength(bytes);
  if (byteLength !== descriptor.object_bytes ||
      byteLength > MAX_V2_PERSISTENT_FRONTIER_NODE_BYTES ||
      rawDigest(bytes) !== descriptor.object_sha256 ||
      gitBlobOid(bytes) !== descriptor.object_oid) {
    throw frontierError(
      "PERSISTENT_FRONTIER_OBJECT_MISMATCH",
      "persistent frontier node bytes differ from their descriptor",
      { object_oid: descriptor.object_oid },
    );
  }
  let text;
  let parsed;
  try {
    text = textDecode(bytes);
    if (!stringEndsWith(text, "\n")) throw new Error("missing canonical newline");
    parsed = jsonParse(text);
    if (`${canonicalJson(parsed)}\n` !== text) {
      throw new Error("node JSON is not canonical");
    }
  } catch (error) {
    throw frontierError(
      "PERSISTENT_FRONTIER_OBJECT_MALFORMED",
      "persistent frontier node is not canonical UTF-8 JSON",
      { object_oid: descriptor.object_oid },
      error,
    );
  }
  let normalized;
  try {
    normalized = normalizeNode(parsed, descriptor, domain, operation);
  } catch (error) {
    if (error instanceof V2PersistentFrontierError) throw error;
    throw frontierError(
      "PERSISTENT_FRONTIER_NODE_MALFORMED",
      "persistent frontier node has an invalid structural shape",
      { object_oid: descriptor.object_oid },
      error,
    );
  }
  const result = normalized.kind === "leaf"
    ? {
      kind: "leaf",
      entry: normalized.entry,
      left: null,
      right: null,
      dirty: false,
      loaded: true,
      descriptor,
    }
    : {
      kind: "branch",
      entry: null,
      left: stubNode(normalized.left),
      right: stubNode(normalized.right),
      dirty: false,
      loaded: true,
      descriptor,
    };
  assertOperationOpen(operation);
  return result;
}

function normalizeNode(value, descriptor, expectedDomain, operation) {
  value = snapshotExactDataObject(value, [
    "schema", "schema_version", "domain", "kind", "prefix_bits", "prefix",
    "height", "count", "min_key_digest", "max_key_digest", "entry", "left",
    "right", "node_digest",
  ], "persistent frontier node");
  if (value.schema !== V2_PERSISTENT_FRONTIER_NODE_SCHEMA ||
      value.schema_version !== 1 || value.domain !== expectedDomain ||
      (value.kind !== "leaf" && value.kind !== "branch")) {
    throw frontierError(
      value.domain !== expectedDomain
        ? "PERSISTENT_FRONTIER_DOMAIN_MISMATCH"
        : "PERSISTENT_FRONTIER_NODE_MALFORMED",
      "persistent frontier node identity is invalid",
    );
  }
  const summary = normalizeSummary(value, "persistent frontier node");
  let entry = null;
  let left = null;
  let right = null;
  if (value.kind === "leaf") {
    if (value.left !== null || value.right !== null) {
      throw frontierError(
        "PERSISTENT_FRONTIER_NODE_MALFORMED",
        "persistent frontier leaf must not have children",
      );
    }
    entry = normalizeEntry(value.entry, expectedDomain, operation);
    const expected = nodeSummary(dirtyLeaf(entry));
    if (canonicalJson(summary) !== canonicalJson(expected)) {
      throw frontierError(
        "PERSISTENT_FRONTIER_NODE_MISMATCH",
        "persistent frontier leaf summary is invalid",
      );
    }
  } else {
    if (value.entry !== null) {
      throw frontierError(
        "PERSISTENT_FRONTIER_NODE_MALFORMED",
        "persistent frontier branch must not have an entry",
      );
    }
    left = normalizeDescriptor(value.left);
    right = normalizeDescriptor(value.right);
    const expected = branchSummary(left, right);
    if (canonicalJson(summary) !== canonicalJson(expected)) {
      throw frontierError(
        "PERSISTENT_FRONTIER_NODE_MISMATCH",
        "persistent frontier branch summary is not canonical",
      );
    }
  }
  if (!regexTest(SHA256, value.node_digest)) {
    throw frontierError(
      "PERSISTENT_FRONTIER_NODE_MALFORMED",
      "persistent frontier node digest is malformed",
    );
  }
  const { node_digest: _nodeDigest, ...withoutDigest } = value;
  const expectedDigest = digestCanonical(
    `${expectedDomain}:persistent-frontier-node`,
    withoutDigest,
  );
  if (value.node_digest !== expectedDigest ||
      descriptor.node_digest !== expectedDigest ||
      !summariesEqual(summary, descriptor)) {
    throw frontierError(
      "PERSISTENT_FRONTIER_NODE_MISMATCH",
      "persistent frontier node differs from its authenticated descriptor",
    );
  }
  return deepFreeze({ ...cloneValue(value), entry, left, right });
}

function normalizeSummary(value, label) {
  if ((value.kind !== "leaf" && value.kind !== "branch") ||
      !numberIsSafeInteger(value.prefix_bits) || value.prefix_bits < 0 ||
      value.prefix_bits > 256 || typeof value.prefix !== "string" ||
      value.prefix.length !== value.prefix_bits ||
      value.prefix.length > 256 || !regexTest(BITS, value.prefix) ||
      !numberIsSafeInteger(value.height) || value.height < 0 ||
      value.height > MAX_V2_PERSISTENT_FRONTIER_HEIGHT ||
      !numberIsSafeInteger(value.count) || value.count <= 0 ||
      !regexTest(SHA256, value.min_key_digest) ||
      !regexTest(SHA256, value.max_key_digest) ||
      asciiCompare(value.min_key_digest, value.max_key_digest) > 0 ||
      (value.kind === "leaf" &&
        (value.prefix_bits !== 256 || value.height !== 0 || value.count !== 1 ||
          value.min_key_digest !== value.max_key_digest ||
          value.prefix !== digestBits(value.min_key_digest))) ||
      (value.kind === "branch" &&
        (value.prefix_bits >= 256 || value.height === 0 || value.count < 2))) {
    throw frontierError(
      "PERSISTENT_FRONTIER_NODE_MALFORMED",
      `${label} summary is invalid`,
    );
  }
  return {
    kind: value.kind,
    prefix_bits: value.prefix_bits,
    prefix: value.prefix,
    count: value.count,
    height: value.height,
    min_key_digest: value.min_key_digest,
    max_key_digest: value.max_key_digest,
  };
}

function normalizeDescriptor(value) {
  value = snapshotExactDataObject(value, [
    "object_oid", "object_sha256", "object_bytes", "node_digest", "kind",
    "prefix_bits", "prefix", "min_key_digest", "max_key_digest", "count",
    "height",
  ], "persistent frontier node descriptor");
  if (!regexTest(SHA1, value.object_oid) ||
      !regexTest(SHA256, value.object_sha256) ||
      !regexTest(SHA256, value.node_digest) ||
      !numberIsSafeInteger(value.object_bytes) || value.object_bytes <= 0 ||
      value.object_bytes > MAX_V2_PERSISTENT_FRONTIER_NODE_BYTES) {
    throw frontierError(
      "PERSISTENT_FRONTIER_DESCRIPTOR_MALFORMED",
      "persistent frontier node descriptor is invalid",
    );
  }
  const summary = normalizeSummary(value, "persistent frontier descriptor");
  return deepFreeze({
    object_oid: value.object_oid,
    object_sha256: value.object_sha256,
    object_bytes: value.object_bytes,
    node_digest: value.node_digest,
    ...summary,
  });
}

function summariesEqual(left, right) {
  return left.kind === right.kind && left.prefix_bits === right.prefix_bits &&
    left.prefix === right.prefix && left.count === right.count &&
    left.height === right.height &&
    left.min_key_digest === right.min_key_digest &&
    left.max_key_digest === right.max_key_digest;
}

function normalizeUpdates(value, domain, operation) {
  const selectedUpdates = snapshotDenseDataArray(
    value,
    MAX_V2_PERSISTENT_FRONTIER_UPDATES,
    "persistent frontier updates",
  );
  const byDigest = new SafeMap();
  const uniqueEntries = [];
  let aggregateBytes = 0;
  for (let index = 0; index < selectedUpdates.length; index += 1) {
    const update = selectedUpdates[index];
    assertOperationOpen(operation);
    const selectedUpdate = snapshotExactDataObject(
      update,
      ["key", "value"],
      `persistent frontier update ${index}`,
    );
    const key = normalizeKey(selectedUpdate.key, domain, operation);
    const normalizedValue = canonicalSnapshot(selectedUpdate.value, {
      maxBytes: MAX_V2_PERSISTENT_FRONTIER_VALUE_BYTES,
      sizeCode: "PERSISTENT_FRONTIER_VALUE_SIZE_CAP",
      label: "persistent frontier value",
      operation,
    });
    aggregateBytes += typedArrayByteLength(textEncode(key.key_canonical)) +
      typedArrayByteLength(textEncode(normalizedValue.canonical));
    if (aggregateBytes > operation.limits.max_update_bytes) {
      throw frontierError(
        "PERSISTENT_FRONTIER_UPDATE_BYTE_CAP",
        "persistent frontier updates exceed their aggregate byte budget",
        { bytes: aggregateBytes },
      );
    }
    const entry = normalizeEntry({
      key: key.key,
      key_canonical: key.key_canonical,
      key_digest: key.key_digest,
      value: normalizedValue.value,
      value_digest: digestCanonicalText(
        `${domain}:persistent-frontier-value`,
        normalizedValue.canonical,
      ),
    }, domain, operation);
    const prior = mapGet(byDigest, entry.key_digest);
    if (prior !== undefined && prior.key_canonical !== entry.key_canonical) {
      throw frontierError(
        "PERSISTENT_FRONTIER_KEY_HASH_COLLISION",
        "one frontier apply contains two original keys with one key hash",
        { key_digest: entry.key_digest },
      );
    }
    if (prior !== undefined && prior.value_digest !== entry.value_digest) {
      throw frontierError(
        "PERSISTENT_FRONTIER_UPDATE_CONFLICT",
        "one frontier apply contains conflicting values for the same key",
      );
    }
    if (prior === undefined) appendArrayElement(uniqueEntries, entry);
    mapSet(byDigest, entry.key_digest, entry);
  }
  return sortArray(uniqueEntries, (left, right) =>
    asciiCompare(left.key_digest, right.key_digest));
}

function normalizeEntry(value, domain, operation = null) {
  value = snapshotExactDataObject(value, [
    "key", "key_canonical", "key_digest", "value", "value_digest",
  ], "persistent frontier entry");
  const key = normalizeKey(value.key, domain, operation);
  if (value.key_canonical !== key.key_canonical ||
      value.key_digest !== key.key_digest) {
    throw frontierError(
      "PERSISTENT_FRONTIER_KEY_MISMATCH",
      "persistent frontier key digest or canonical bytes are invalid",
    );
  }
  const normalizedValue = canonicalSnapshot(value.value, {
    maxBytes: MAX_V2_PERSISTENT_FRONTIER_VALUE_BYTES,
    sizeCode: "PERSISTENT_FRONTIER_VALUE_SIZE_CAP",
    label: "persistent frontier value",
    operation,
  });
  if (!regexTest(SHA256, value.value_digest) ||
      value.value_digest !== digestCanonicalText(
        `${domain}:persistent-frontier-value`,
        normalizedValue.canonical,
      )) {
    throw frontierError(
      "PERSISTENT_FRONTIER_VALUE_MISMATCH",
      "persistent frontier value digest is invalid",
    );
  }
  return deepFreeze({
    key: cloneValue(key.key),
    key_canonical: key.key_canonical,
    key_digest: key.key_digest,
    value: cloneValue(normalizedValue.value),
    value_digest: value.value_digest,
  });
}

function normalizeKey(value, domain, operation = null) {
  const normalized = canonicalSnapshot(value, {
    maxBytes: MAX_V2_PERSISTENT_FRONTIER_KEY_BYTES,
    sizeCode: "PERSISTENT_FRONTIER_KEY_SIZE_CAP",
    label: "persistent frontier key",
    operation,
  });
  return {
    key: normalized.value,
    key_canonical: normalized.canonical,
    key_digest: digestCanonicalText(
      `${domain}:persistent-frontier-key`,
      normalized.canonical,
    ),
  };
}

function validateRoot(value, expectedDomain) {
  value = snapshotExactDataObject(value, [
    "schema", "schema_version", "domain", "count", "height", "node",
    "root_digest",
  ], "persistent frontier root");
  if (value.schema !== V2_PERSISTENT_FRONTIER_ROOT_SCHEMA ||
      value.schema_version !== 1 || value.domain !== expectedDomain) {
    throw frontierError(
      value.domain !== expectedDomain
        ? "PERSISTENT_FRONTIER_DOMAIN_MISMATCH"
        : "PERSISTENT_FRONTIER_ROOT_MALFORMED",
      "persistent frontier root identity is invalid",
    );
  }
  const node = value.node === null ? null : normalizeDescriptor(value.node);
  if (!numberIsSafeInteger(value.count) || value.count < 0 ||
      !numberIsSafeInteger(value.height) || value.height < 0 ||
      value.height > MAX_V2_PERSISTENT_FRONTIER_HEIGHT ||
      (node === null && (value.count !== 0 || value.height !== 0)) ||
      (node !== null &&
        (value.count !== node.count || value.height !== node.height))) {
    throw frontierError(
      "PERSISTENT_FRONTIER_ROOT_MALFORMED",
      "persistent frontier root summary is invalid",
    );
  }
  if (!regexTest(SHA256, value.root_digest)) {
    throw frontierError(
      "PERSISTENT_FRONTIER_ROOT_MALFORMED",
      "persistent frontier root digest is malformed",
    );
  }
  const { root_digest: _rootDigest, ...withoutDigest } = value;
  if (value.root_digest !== digestCanonical(
    `${expectedDomain}:persistent-frontier-root`,
    withoutDigest,
  )) {
    throw frontierError(
      "PERSISTENT_FRONTIER_ROOT_MISMATCH",
      "persistent frontier root digest is invalid",
    );
  }
  return deepFreeze({ ...cloneValue(value), node });
}

function sealRoot({ domain, count, height, node }) {
  const withoutDigest = {
    schema: V2_PERSISTENT_FRONTIER_ROOT_SCHEMA,
    schema_version: 1,
    domain,
    count,
    height,
    node: node === null ? null : cloneValue(node),
  };
  return deepFreeze({
    ...withoutDigest,
    root_digest: digestCanonical(
      `${domain}:persistent-frontier-root`,
      withoutDigest,
    ),
  });
}

function sealCursor({
  domain,
  epochId,
  rootDigest,
  lastKeyDigest,
  lastKeyCanonical,
}) {
  const withoutDigest = {
    schema: V2_PERSISTENT_FRONTIER_CURSOR_SCHEMA,
    schema_version: 1,
    domain,
    epoch_id: epochId,
    root_digest: rootDigest,
    last_key_digest: lastKeyDigest,
    last_key_canonical: lastKeyCanonical,
  };
  return deepFreeze({
    ...withoutDigest,
    cursor_digest: digestCanonical(
      `${domain}:persistent-frontier-cursor`,
      withoutDigest,
    ),
  });
}

function validateCursor(value, root, domain, epochId, bindings) {
  const original = value;
  value = snapshotExactDataObject(value, [
    "schema", "schema_version", "domain", "epoch_id", "root_digest",
    "last_key_digest", "last_key_canonical", "cursor_digest",
  ], "persistent frontier cursor");
  const binding = weakMapGet(bindings, original);
  if (value.schema !== V2_PERSISTENT_FRONTIER_CURSOR_SCHEMA ||
      value.schema_version !== 1 || value.domain !== domain ||
      value.epoch_id !== epochId ||
      value.root_digest !== root.root_digest ||
      !regexTest(SHA256, value.last_key_digest) ||
      typeof value.last_key_canonical !== "string" ||
      typeof value.cursor_digest !== "string" || binding === undefined ||
      binding.root_digest !== root.root_digest ||
      binding.epoch_id !== epochId ||
      binding.cursor_digest !== value.cursor_digest) {
    throw frontierError(
      "UNTRUSTED_PERSISTENT_FRONTIER_CURSOR",
      "persistent frontier cursor is foreign, stale, cloned, or malformed",
    );
  }
  let parsed;
  try {
    parsed = jsonParse(value.last_key_canonical);
  } catch (error) {
    throw frontierError(
      "UNTRUSTED_PERSISTENT_FRONTIER_CURSOR",
      "persistent frontier cursor key is not canonical JSON",
      null,
      error,
    );
  }
  const key = normalizeKey(parsed, domain, binding.operation);
  const withoutDigest = {
    schema: value.schema,
    schema_version: value.schema_version,
    domain: value.domain,
    epoch_id: value.epoch_id,
    root_digest: value.root_digest,
    last_key_digest: value.last_key_digest,
    last_key_canonical: value.last_key_canonical,
  };
  if (key.key_canonical !== value.last_key_canonical ||
      key.key_digest !== value.last_key_digest ||
      value.cursor_digest !== digestCanonical(
        `${domain}:persistent-frontier-cursor`,
        withoutDigest,
      )) {
    throw frontierError(
      "UNTRUSTED_PERSISTENT_FRONTIER_CURSOR",
      "persistent frontier cursor digest is invalid",
    );
  }
  weakMapDelete(bindings, original);
  return {
    last_key_digest: value.last_key_digest,
    operation: binding.operation,
  };
}

async function collectEntries({
  node,
  domain,
  operation,
  afterDigest,
  limit,
  entries,
  seenOids,
}) {
  assertOperationOpen(operation);
  if (entries.length >= limit) return;
  const summary = nodeSummary(node);
  if (afterDigest !== null &&
      asciiCompare(summary.max_key_digest, afterDigest) <= 0) return;
  if (!node.dirty) {
    if (setHas(seenOids, node.descriptor.object_oid)) {
      throw frontierError(
        "PERSISTENT_FRONTIER_OBJECT_REUSED",
        "persistent frontier scan encountered a reused or cyclic node",
        { object_oid: node.descriptor.object_oid },
      );
    }
    setAdd(seenOids, node.descriptor.object_oid);
  }
  const current = await materializeNode(node, domain, operation);
  if (current.kind === "leaf") {
    if (afterDigest === null ||
        asciiCompare(current.entry.key_digest, afterDigest) > 0) {
      appendArrayElement(entries, current.entry);
    }
    return;
  }
  await collectEntries({
    node: current.left,
    domain,
    operation,
    afterDigest,
    limit,
    entries,
    seenOids,
  });
  if (entries.length >= limit) return;
  await collectEntries({
    node: current.right,
    domain,
    operation,
    afterDigest,
    limit,
    entries,
    seenOids,
  });
}

function digestBits(value) {
  if (!regexTest(SHA256, value)) {
    throw frontierError(
      "PERSISTENT_FRONTIER_KEY_MISMATCH",
      "persistent frontier key digest is malformed",
    );
  }
  let bits = "";
  for (let index = "sha256:".length; index < value.length; index += 1) {
    bits += stringPadStart(
      numberToString(numberParseInt(value[index], 16), 2),
      4,
      "0",
    );
  }
  return bits;
}

function commonBitPrefix(left, right) {
  let index = 0;
  while (index < left.length && left[index] === right[index]) index += 1;
  return stringSlice(left, 0, index);
}

function normalizeDomain(value) {
  if (typeof value !== "string" || !regexTest(DOMAIN, value)) {
    throw new TypeError("persistent frontier domain is invalid");
  }
  return value;
}

function normalizeEpochId(value) {
  if (typeof value !== "string" || !regexTest(SHA256, value)) {
    throw new TypeError("persistent frontier epoch id is invalid");
  }
  return value;
}

function normalizeOperationLimits(value) {
  assertPlainObject(value, "persistent frontier operation limits");
  const defaults = {
    max_read_objects: MAX_V2_PERSISTENT_FRONTIER_OPERATION_OBJECTS,
    max_write_objects: MAX_V2_PERSISTENT_FRONTIER_OPERATION_OBJECTS,
    max_read_bytes: MAX_V2_PERSISTENT_FRONTIER_OPERATION_BYTES,
    max_write_bytes: MAX_V2_PERSISTENT_FRONTIER_OPERATION_BYTES,
    max_update_bytes: MAX_V2_PERSISTENT_FRONTIER_UPDATE_BYTES,
    max_duration_ms: MAX_V2_PERSISTENT_FRONTIER_OPERATION_MS,
  };
  const defaultKeys = objectKeys(defaults);
  const allowed = new SafeSet();
  for (let index = 0; index < defaultKeys.length; index += 1) {
    setAdd(allowed, defaultKeys[index]);
  }
  const supplied = new SafeMap();
  const suppliedKeys = reflectOwnKeys(value);
  for (let index = 0; index < suppliedKeys.length; index += 1) {
    const key = suppliedKeys[index];
    if (typeof key !== "string" || !setHas(allowed, key)) {
      throw new TypeError("persistent frontier operation limits are not closed");
    }
    const descriptor = objectGetOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !hasOwn(descriptor, "value") ||
        descriptor.enumerable !== true) {
      throw new TypeError(
        "persistent frontier operation limits must use enumerable data properties",
      );
    }
    mapSet(supplied, key, descriptor.value);
  }
  const normalized = { ...defaults };
  for (let index = 0; index < defaultKeys.length; index += 1) {
    const key = defaultKeys[index];
    const hardMaximum = defaults[key];
    if (!mapHas(supplied, key)) continue;
    const selected = mapGet(supplied, key);
    if (!numberIsSafeInteger(selected) || selected <= 0 ||
        selected > hardMaximum) {
      throw new TypeError(
        `persistent frontier ${key} may only tighten its hard maximum`,
      );
    }
    normalized[key] = selected;
  }
  return objectFreeze(normalized);
}

function createOperationContext({ limits, readBlob, writeBlob }) {
  const adapterDeadlineAt = dateNow() + limits.max_duration_ms;
  const deadlineMonotonicAt = monotonicNow() + limits.max_duration_ms;
  return {
    limits,
    readBlob,
    writeBlob,
    // Wall-clock values are adapter evidence only. Duration enforcement uses
    // the monotonic deadline so a host clock adjustment cannot extend a call.
    adapter_deadline_at: adapterDeadlineAt,
    deadline_monotonic_at: deadlineMonotonicAt,
    read_objects: 0,
    write_objects: 0,
    read_bytes: 0,
    write_bytes: 0,
    prepared_write_objects: 0,
    prepared_write_bytes: 0,
  };
}

function assertOperationOpen(operation) {
  if (monotonicNow() >= operation.deadline_monotonic_at) {
    throw frontierError(
      "PERSISTENT_FRONTIER_OPERATION_TIMEOUT",
      "persistent frontier operation exceeded its absolute deadline",
    );
  }
}

async function callBlobAdapter({
  operation,
  kind,
  objectOid,
  expectedBytes = null,
  bytes = null,
}) {
  assertOperationOpen(operation);
  const isRead = kind === "read";
  const objectKey = isRead ? "read_objects" : "write_objects";
  const byteKey = isRead ? "read_bytes" : "write_bytes";
  const objectLimit = isRead
    ? operation.limits.max_read_objects
    : operation.limits.max_write_objects;
  const byteLimit = isRead
    ? operation.limits.max_read_bytes
    : operation.limits.max_write_bytes;
  const capCode = isRead
    ? "PERSISTENT_FRONTIER_OPERATION_READ_CAP"
    : "PERSISTENT_FRONTIER_OPERATION_WRITE_CAP";
  const suppliedByteLength = isRead ? expectedBytes : typedArrayByteLength(bytes);
  if (operation[objectKey] + 1 > objectLimit ||
      isRead && expectedBytes > byteLimit - operation[byteKey] ||
      !isRead && suppliedByteLength > byteLimit - operation[byteKey]) {
    throw frontierError(
      capCode,
      `persistent frontier ${kind} exceeds its aggregate operation budget`,
    );
  }
  operation[objectKey] += 1;
  operation[byteKey] += suppliedByteLength;
  const remainingMs = operation.deadline_monotonic_at - monotonicNow();
  if (remainingMs <= 0) {
    throw frontierError(
      "PERSISTENT_FRONTIER_OPERATION_TIMEOUT",
      "persistent frontier operation exceeded its absolute deadline",
    );
  }
  const controller = new SafeAbortController();
  let timer;
  let locallyTimedOut = false;
  const timeout = new SafePromise((_, reject) => {
    const expire = () => {
      const timeoutRemainingMs =
        operation.deadline_monotonic_at - monotonicNow();
      if (timeoutRemainingMs > 0) {
        timer = safeSetTimeout(
          expire,
          timeoutRemainingMs > 1 ? timeoutRemainingMs : 1,
        );
        return;
      }
      locallyTimedOut = true;
      reject(frontierError(
        "PERSISTENT_FRONTIER_OPERATION_TIMEOUT",
        `persistent frontier ${kind} exceeded its absolute deadline`,
      ));
      deferAbortController(controller);
    };
    timer = safeSetTimeout(expire, remainingMs > 1 ? remainingMs : 1);
  });
  let result;
  try {
    const adapter = isRead ? operation.readBlob : operation.writeBlob;
    const call = isRead
      ? reflectApply(adapter, undefined, [objectOid, {
        max_bytes: mathMin(
          MAX_V2_PERSISTENT_FRONTIER_NODE_BYTES,
          expectedBytes,
        ),
        deadline_ms: operation.adapter_deadline_at,
        signal: abortSignal(controller),
      }])
      : reflectApply(adapter, undefined, [new SafeUint8Array(bytes), {
        expected_object_oid: objectOid,
        max_bytes: byteLimit - operation[byteKey] +
          typedArrayByteLength(bytes),
        deadline_ms: operation.adapter_deadline_at,
        signal: abortSignal(controller),
      }]);
    result = await settleFirst(call, timeout);
  } catch (error) {
    if (locallyTimedOut ||
        monotonicNow() >= operation.deadline_monotonic_at) {
      throw frontierError(
        "PERSISTENT_FRONTIER_OPERATION_TIMEOUT",
        `persistent frontier ${kind} exceeded its absolute deadline`,
      );
    }
    throw frontierError(
      isRead
        ? "PERSISTENT_FRONTIER_OBJECT_UNREADABLE"
        : "PERSISTENT_FRONTIER_OBJECT_UNWRITABLE",
      `persistent frontier node blob could not be ${isRead ? "read" : "written"}`,
      { object_oid: objectOid },
      error,
    );
  } finally {
    safeClearTimeout(timer);
  }
  assertOperationOpen(operation);
  if (!isRead || !isUint8Array(result)) return result;
  const backingBuffer = typedArrayBuffer(result);
  if (isSharedArrayBuffer(backingBuffer) ||
      isResizableArrayBuffer(backingBuffer)) {
    throw frontierError(
      "PERSISTENT_FRONTIER_OBJECT_UNREADABLE",
      "persistent frontier node reader returned concurrently mutable bytes",
      { object_oid: objectOid },
    );
  }
  if (typedArrayByteLength(result) > expectedBytes) {
    throw frontierError(
      capCode,
      "persistent frontier read adapter exceeded its reserved byte allowance",
    );
  }
  try {
    return new SafeUint8Array(result);
  } catch (error) {
    throw frontierError(
      "PERSISTENT_FRONTIER_OBJECT_UNREADABLE",
      "persistent frontier node bytes could not be privately snapshotted",
      { object_oid: objectOid },
      error,
    );
  }
}

function monotonicNow() {
  return reflectApply(performanceNowIntrinsic, performance, []);
}

function gitBlobOid(bytes) {
  const header = textEncode(`blob ${typedArrayByteLength(bytes)}\0`);
  const hash = createHash("sha1");
  hashUpdate(hash, header);
  hashUpdate(hash, bytes);
  return hashDigest(hash, "hex");
}

function rawDigest(value) {
  const hash = createHash("sha256");
  hashUpdate(hash, value);
  return `sha256:${hashDigest(hash, "hex")}`;
}

function digestCanonical(domain, value) {
  return digestCanonicalText(domain, canonicalJson(value));
}

function digestCanonicalText(domain, canonicalValue) {
  const domainBytes = textEncode(domain);
  const payload = textEncode(canonicalValue);
  const prefix = reflectApply(bufferAlloc, SafeBuffer, [8]);
  reflectApply(bufferWriteUInt32BE, prefix, [typedArrayByteLength(domainBytes), 0]);
  reflectApply(bufferWriteUInt32BE, prefix, [typedArrayByteLength(payload), 4]);
  const hash = createHash("sha256");
  hashUpdate(hash, prefix);
  hashUpdate(hash, domainBytes);
  hashUpdate(hash, payload);
  return `sha256:${hashDigest(hash, "hex")}`;
}

function canonicalJson(value, {
  maxBytes = 2 * MAX_V2_PERSISTENT_FRONTIER_NODE_BYTES,
  sizeCode = "PERSISTENT_FRONTIER_CANONICAL_SIZE_CAP",
  label = "persistent frontier canonical value",
  operation = null,
} = {}) {
  return canonicalSnapshot(value, {
    maxBytes,
    sizeCode,
    label,
    operation,
  }).canonical;
}

function canonicalSnapshot(value, {
  maxBytes = 2 * MAX_V2_PERSISTENT_FRONTIER_NODE_BYTES,
  sizeCode = "PERSISTENT_FRONTIER_CANONICAL_SIZE_CAP",
  label = "persistent frontier canonical value",
  operation = null,
} = {}) {
  const state = {
    bytes: 0,
    chunks: [],
    max_bytes: maxBytes,
    nodes: 0,
    size_code: sizeCode,
    label,
    operation,
  };
  const snapshot = serializeCanonical(value, state, 0);
  const canonical = arrayJoin(state.chunks, "");
  if (operation !== null) assertOperationOpen(operation);
  return {
    canonical,
    value: snapshot,
  };
}

function serializeCanonical(value, state, depth) {
  if (state.operation !== null) assertOperationOpen(state.operation);
  state.nodes += 1;
  if (state.nodes > MAX_V2_PERSISTENT_FRONTIER_CANONICAL_NODES) {
    throw frontierError(
      "PERSISTENT_FRONTIER_CANONICAL_NODE_CAP",
      `${state.label} exceeds its structural node cap`,
    );
  }
  if (depth > MAX_V2_PERSISTENT_FRONTIER_CANONICAL_DEPTH) {
    throw frontierError(
      "PERSISTENT_FRONTIER_CANONICAL_DEPTH_CAP",
      `${state.label} exceeds its structural depth cap`,
    );
  }
  if (value === null || typeof value === "boolean") {
    appendCanonicalChunk(state, jsonStringify(value));
    return value;
  }
  if (typeof value === "string") {
    if (value.length > state.max_bytes ||
        reflectApply(bufferByteLength, SafeBuffer, [value, "utf8"]) >
        state.max_bytes) {
      throw frontierError(
        state.size_code,
        `${state.label} exceeds its canonical byte cap`,
      );
    }
    appendCanonicalChunk(state, jsonStringify(value));
    return value;
  }
  if (typeof value === "number") {
    if (!numberIsSafeInteger(value) || objectIs(value, -0)) {
      throw frontierError(
        "PERSISTENT_FRONTIER_NON_CANONICAL_NUMBER",
        `${state.label} contains a non-canonical number`,
      );
    }
    appendCanonicalChunk(state, numberToString(value, 10));
    return value;
  }
  if (isProxy(value)) {
    throw frontierError(
      "PERSISTENT_FRONTIER_NON_CANONICAL_OBJECT",
      `${state.label} contains a proxy-backed object`,
    );
  }
  if (arrayIsArray(value)) {
    const lengthDescriptor = objectGetOwnPropertyDescriptor(value, "length");
    if (lengthDescriptor === undefined ||
        !hasOwn(lengthDescriptor, "value") ||
        lengthDescriptor.enumerable !== false ||
        !numberIsSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0 ||
        lengthDescriptor.value > MAX_V2_PERSISTENT_FRONTIER_CANONICAL_NODES) {
      throw frontierError(
        "PERSISTENT_FRONTIER_CANONICAL_NODE_CAP",
        `${state.label} array exceeds its structural cap`,
      );
    }
    const length = lengthDescriptor.value;
    const ownKeys = reflectOwnKeys(value);
    if (arrayHasNonString(ownKeys) || ownKeys.length !== length + 1 ||
        !arrayIncludes(ownKeys, "length")) {
      throw frontierError(
        "PERSISTENT_FRONTIER_NON_CANONICAL_ARRAY",
        `${state.label} array has holes, symbols, or custom properties`,
      );
    }
    const descriptors = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = objectGetOwnPropertyDescriptor(
        value,
        numberToString(index, 10),
      );
      if (descriptor === undefined || !hasOwn(descriptor, "value") ||
          descriptor.enumerable !== true) {
        throw frontierError(
          "PERSISTENT_FRONTIER_NON_CANONICAL_ARRAY",
          `${state.label} array is sparse or accessor-backed`,
        );
      }
      appendArrayElement(descriptors, descriptor.value);
    }
    const snapshot = [];
    appendCanonicalChunk(state, "[");
    for (let index = 0; index < length; index += 1) {
      if (index > 0) appendCanonicalChunk(state, ",");
      appendArrayElement(
        snapshot,
        serializeCanonical(descriptors[index], state, depth + 1),
      );
    }
    appendCanonicalChunk(state, "]");
    return snapshot;
  }
  assertPlainObject(value, state.label);
  const ownKeys = reflectOwnKeys(value);
  if (ownKeys.length > MAX_V2_PERSISTENT_FRONTIER_CANONICAL_NODES ||
      arrayHasNonString(ownKeys)) {
    throw frontierError(
      "PERSISTENT_FRONTIER_CANONICAL_NODE_CAP",
      `${state.label} object exceeds its closed key cap`,
    );
  }
  let aggregateKeyCodeUnits = 0;
  for (let index = 0; index < ownKeys.length; index += 1) {
    aggregateKeyCodeUnits += ownKeys[index].length;
    if (aggregateKeyCodeUnits > state.max_bytes ||
        reflectApply(
          bufferByteLength,
          SafeBuffer,
          [ownKeys[index], "utf8"],
        ) > state.max_bytes) {
      throw frontierError(
        state.size_code,
        `${state.label} keys exceed their canonical byte cap`,
      );
    }
  }
  const keys = sortArray(ownKeys, asciiCompare);
  const descriptors = new SafeMap();
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const descriptor = objectGetOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !hasOwn(descriptor, "value") ||
        descriptor.enumerable !== true) {
      throw frontierError(
        "PERSISTENT_FRONTIER_NON_CANONICAL_OBJECT",
        `${state.label} object has hidden or accessor-backed state`,
      );
    }
    mapSet(descriptors, key, descriptor.value);
  }
  const snapshot = {};
  appendCanonicalChunk(state, "{");
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (index > 0) appendCanonicalChunk(state, ",");
    if (reflectApply(bufferByteLength, SafeBuffer, [key, "utf8"]) >
        state.max_bytes) {
      throw frontierError(
        state.size_code,
        `${state.label} key exceeds its canonical byte cap`,
      );
    }
    appendCanonicalChunk(state, jsonStringify(key));
    appendCanonicalChunk(state, ":");
    const child = serializeCanonical(mapGet(descriptors, key), state, depth + 1);
    objectDefineProperty(snapshot, key, {
      value: child,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  appendCanonicalChunk(state, "}");
  return snapshot;
}

function appendCanonicalChunk(state, value) {
  const bytes = reflectApply(bufferByteLength, SafeBuffer, [value, "utf8"]);
  if (state.bytes + bytes > state.max_bytes) {
    throw frontierError(
      state.size_code,
      `${state.label} exceeds its canonical byte cap`,
    );
  }
  state.bytes += bytes;
  appendArrayElement(state.chunks, value);
}

function asciiCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertPlainObject(value, label) {
  if (value === null || typeof value !== "object" || isProxy(value) ||
      arrayIsArray(value) ||
      objectGetPrototypeOf(value) !== objectPrototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

function snapshotDenseDataArray(value, maxLength, label) {
  if (isProxy(value) || !arrayIsArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }
  const lengthDescriptor = objectGetOwnPropertyDescriptor(value, "length");
  if (lengthDescriptor === undefined || !hasOwn(lengthDescriptor, "value") ||
      lengthDescriptor.enumerable !== false ||
      !numberIsSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 || lengthDescriptor.value > maxLength) {
    throw new TypeError(`${label} exceed their cap`);
  }
  const length = lengthDescriptor.value;
  const ownKeys = reflectOwnKeys(value);
  if (arrayHasNonString(ownKeys) || ownKeys.length !== length + 1 ||
      !arrayIncludes(ownKeys, "length")) {
    throw new TypeError(`${label} must be a dense closed array`);
  }
  const snapshot = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = objectGetOwnPropertyDescriptor(
      value,
      numberToString(index, 10),
    );
    if (descriptor === undefined || !hasOwn(descriptor, "value") ||
        descriptor.enumerable !== true) {
      throw new TypeError(`${label} must use enumerable data elements`);
    }
    appendArrayElement(snapshot, descriptor.value);
  }
  return snapshot;
}

function snapshotExactDataObject(value, keys, label) {
  assertPlainObject(value, label);
  const actual = reflectOwnKeys(value);
  const expected = sortArray(copyArrayRange(keys, 0, keys.length), asciiCompare);
  const sortedActual = sortArray(actual, asciiCompare);
  if (arrayHasNonString(actual) || actual.length !== expected.length ||
      arraysDiffer(sortedActual, expected)) {
    throw new TypeError(`${label} must use its exact closed key set`);
  }
  const snapshot = {};
  for (let index = 0; index < expected.length; index += 1) {
    const key = expected[index];
    const descriptor = objectGetOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !hasOwn(descriptor, "value") ||
        descriptor.enumerable !== true) {
      throw new TypeError(`${label} must use enumerable data properties`);
    }
    objectDefineProperty(snapshot, key, {
      value: descriptor.value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return snapshot;
}

function appendArrayElement(array, value) {
  objectDefineProperty(array, numberToString(array.length, 10), {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function copyArrayRange(array, start, end) {
  const copy = [];
  const upper = mathMin(end, array.length);
  for (let index = start; index < upper; index += 1) {
    appendArrayElement(copy, array[index]);
  }
  return copy;
}

function mapArray(array, project) {
  const mapped = [];
  for (let index = 0; index < array.length; index += 1) {
    appendArrayElement(mapped, project(array[index], index));
  }
  return mapped;
}

function sortArray(array, compare) {
  reflectApply(arraySortIntrinsic, array, [compare]);
  return array;
}

function arrayJoin(array, separator) {
  return reflectApply(arrayJoinIntrinsic, array, [separator]);
}

function stringStartsWith(value, search) {
  return reflectApply(stringStartsWithIntrinsic, value, [search]);
}

function stringEndsWith(value, search) {
  return reflectApply(stringEndsWithIntrinsic, value, [search]);
}

function stringSlice(value, start, end) {
  return reflectApply(stringSliceIntrinsic, value, [start, end]);
}

function stringPadStart(value, length, fill) {
  return reflectApply(stringPadStartIntrinsic, value, [length, fill]);
}

function numberToString(value, radix) {
  return reflectApply(numberToStringIntrinsic, value, [radix]);
}

function regexTest(pattern, value) {
  return reflectApply(regexpExecIntrinsic, pattern, [value]) !== null;
}

function settleFirst(left, right) {
  return new SafePromise((resolve, reject) => {
    const leftPromise = isInstanceOf(left, SafePromise)
      ? left
      : reflectApply(promiseResolveIntrinsic, SafePromise, [left]);
    reflectApply(promiseThenIntrinsic, leftPromise, [resolve, reject]);
    reflectApply(promiseThenIntrinsic, right, [resolve, reject]);
  });
}

function cloneValue(value) {
  return reflectApply(safeStructuredClone, undefined, [value]);
}

function textEncode(value) {
  return reflectApply(textEncodeIntrinsic, encoder, [value]);
}

function textDecode(value) {
  return reflectApply(textDecodeIntrinsic, decoder, [value]);
}

function typedArrayByteLength(value) {
  return reflectApply(typedArrayByteLengthGetter, value, []);
}

function typedArrayBuffer(value) {
  return reflectApply(typedArrayBufferGetter, value, []);
}

function isResizableArrayBuffer(value) {
  return arrayBufferResizableGetter !== null &&
    reflectApply(arrayBufferResizableGetter, value, []);
}

function abortController(controller) {
  return reflectApply(abortControllerAbortIntrinsic, controller, [
    new Error("persistent frontier adapter cleanup after timeout"),
  ]);
}

function deferAbortController(controller) {
  let invoked = false;
  const cleanup = () => {
    if (invoked) return;
    invoked = true;
    try {
      abortController(controller);
    } catch {
      // The caller-visible timeout settled in the prior turn. This catches
      // synchronous controller failure, not native EventTarget rethrows.
    }
  };
  try {
    safeScheduleImmediate(cleanup);
  } catch {
    // Scheduling adapter cleanup is best-effort after the primary timeout.
  }
}

function abortSignal(controller) {
  return reflectApply(abortControllerSignalGetter, controller, []);
}

function hashUpdate(hash, value) {
  reflectApply(hashUpdateIntrinsic, hash, [value]);
}

function hashDigest(hash, encoding) {
  return reflectApply(hashDigestIntrinsic, hash, [encoding]);
}

function isInstanceOf(value, constructor) {
  return reflectApply(functionHasInstanceIntrinsic, constructor, [value]);
}

function arrayHasNonString(array) {
  for (let index = 0; index < array.length; index += 1) {
    if (typeof array[index] !== "string") return true;
  }
  return false;
}

function arrayIncludes(array, expected) {
  for (let index = 0; index < array.length; index += 1) {
    if (array[index] === expected) return true;
  }
  return false;
}

function arraysDiffer(left, right) {
  if (left.length !== right.length) return true;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return true;
  }
  return false;
}

function hasOwn(value, key) {
  return reflectApply(objectHasOwn, undefined, [value, key]);
}

function mapGet(map, key) {
  return reflectApply(mapGetIntrinsic, map, [key]);
}

function mapSet(map, key, value) {
  return reflectApply(mapSetIntrinsic, map, [key, value]);
}

function mapHas(map, key) {
  return reflectApply(mapHasIntrinsic, map, [key]);
}

function setAdd(set, value) {
  return reflectApply(setAddIntrinsic, set, [value]);
}

function setHas(set, value) {
  return reflectApply(setHasIntrinsic, set, [value]);
}

function weakMapGet(map, key) {
  return reflectApply(weakMapGetIntrinsic, map, [key]);
}

function weakMapSet(map, key, value) {
  return reflectApply(weakMapSetIntrinsic, map, [key, value]);
}

function weakMapDelete(map, key) {
  return reflectApply(weakMapDeleteIntrinsic, map, [key]);
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !objectIsFrozen(value)) {
    objectFreeze(value);
    const keys = objectKeys(value);
    for (let index = 0; index < keys.length; index += 1) {
      deepFreeze(value[keys[index]]);
    }
  }
  return value;
}

function frontierError(code, message, details = null, cause = undefined) {
  return new V2PersistentFrontierError(code, message, details, cause);
}
