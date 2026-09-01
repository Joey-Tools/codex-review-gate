const SHARD_PATTERN = /^([1-9][0-9]*)\/([1-9][0-9]*)$/u;

export function parseTestShard(rawValue) {
  if (rawValue === undefined) {
    return Object.freeze({ mode: "all" });
  }
  if (rawValue === "off") {
    return Object.freeze({ mode: "off" });
  }

  const match = rawValue.match(SHARD_PATTERN);
  if (!match) {
    throw new Error(`invalid test shard: ${rawValue}`);
  }
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (
    !Number.isSafeInteger(index) ||
    !Number.isSafeInteger(total) ||
    index > total
  ) {
    throw new Error(`invalid test shard: ${rawValue}`);
  }
  return Object.freeze({ mode: "shard", index, total });
}

export function testShardSelects(shard, ordinal) {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) {
    throw new TypeError("test ordinal must be a non-negative safe integer");
  }
  if (shard.mode === "all") return true;
  if (shard.mode === "off") return false;
  return ordinal % shard.total === shard.index - 1;
}

export function createShardedTest(baseTest, rawValue, label = "test") {
  if (typeof baseTest !== "function") {
    throw new TypeError("base test must be a function");
  }
  const shard = parseTestShard(rawValue);
  let inventorySealed = false;
  let ordinal = 0;

  function shardedTest(name, optionsOrFunction, maybeFunction) {
    if (inventorySealed) {
      throw new Error(`${label} shard inventory is sealed`);
    }
    if (
      optionsOrFunction !== null &&
      typeof optionsOrFunction === "object"
    ) {
      for (const unsupportedOption of ["only", "skip", "todo"]) {
        if (Object.hasOwn(optionsOrFunction, unsupportedOption)) {
          throw new Error(
            `${label} shard inventory does not support the ${unsupportedOption} option`,
          );
        }
      }
    }
    const selected = testShardSelects(shard, ordinal);
    ordinal += 1;
    if (selected) {
      return maybeFunction === undefined
        ? baseTest(name, optionsOrFunction)
        : baseTest(name, optionsOrFunction, maybeFunction);
    }

    const reason = `${label} excluded by CI shard ${rawValue ?? "off"}`;
    if (typeof optionsOrFunction === "function") {
      return baseTest(name, { skip: reason }, optionsOrFunction);
    }
    return baseTest(
      name,
      { ...(optionsOrFunction ?? {}), skip: reason },
      maybeFunction,
    );
  }

  Object.defineProperty(shardedTest, "registeredCount", {
    configurable: false,
    enumerable: true,
    get: () => {
      inventorySealed = true;
      return ordinal;
    },
  });
  return shardedTest;
}
