import { GateFailure } from "./core.mjs";

export class EvidenceWorkBudget {
  constructor({
    maxItemsPerSnapshot,
    maxResponseBytes,
    maxResponseBytesPerWork,
    maxRequestAttemptsPerWork,
    maxConcurrency,
  }) {
    for (const [name, value] of Object.entries({
      maxItemsPerSnapshot,
      maxResponseBytes,
      maxResponseBytesPerWork,
      maxRequestAttemptsPerWork,
      maxConcurrency,
    })) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive safe integer`);
      }
    }

    this.limits = {
      maxItemsPerSnapshot,
      maxResponseBytes,
      maxResponseBytesPerWork,
      maxRequestAttemptsPerWork,
      maxConcurrency,
    };
    this.requestAttempts = 0;
    this.responseBytes = 0;
    this.activeRequests = 0;
    this.requestWaiters = [];
    this.activeAbortControllers = new Set();
    this.failure = null;
  }

  newSnapshot() {
    this.throwIfFailed();
    return {
      work: this,
      items: 0,
    };
  }

  throwIfFailed() {
    if (this.failure) {
      throw this.failure;
    }
  }

  consumeItems(snapshot, count, label) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("evidence item count must be a non-negative safe integer");
    }
    this.throwIfFailed();
    snapshot.items += count;
    if (snapshot.items > this.limits.maxItemsPerSnapshot) {
      this.fail(
        `Evidence snapshot item budget exceeded while loading ${label}: ` +
          `${snapshot.items} > ${this.limits.maxItemsPerSnapshot}.`,
      );
    }
  }

  async acquireRequest(label) {
    this.throwIfFailed();
    while (this.activeRequests >= this.limits.maxConcurrency) {
      await new Promise((resolve) => this.requestWaiters.push(resolve));
      this.throwIfFailed();
    }
    if (this.requestAttempts >= this.limits.maxRequestAttemptsPerWork) {
      this.fail(
        `Evidence request-attempt budget exhausted before ${label}: ` +
          `${this.requestAttempts} actual fetch attempts reached the ` +
          `${this.limits.maxRequestAttemptsPerWork} limit.`,
      );
    }

    this.activeRequests += 1;
    this.requestAttempts += 1;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.activeRequests -= 1;
      this.requestWaiters.shift()?.();
    };
  }

  rejectOversizedContentLength(contentLength, label) {
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      return;
    }
    this.throwIfFailed();
    if (contentLength > this.limits.maxResponseBytes) {
      this.fail(
        `Evidence response-byte budget exceeded for ${label}: declared ` +
          `${contentLength} > ${this.limits.maxResponseBytes}.`,
      );
    }
    if (
      this.responseBytes + contentLength >
      this.limits.maxResponseBytesPerWork
    ) {
      this.fail(
        `Evidence work response-byte budget would be exceeded by ${label}: ` +
          `${this.responseBytes + contentLength} > ` +
          `${this.limits.maxResponseBytesPerWork}.`,
      );
    }
  }

  consumeResponseBytes(byteCount, responseByteCount, label) {
    if (!Number.isSafeInteger(byteCount) || byteCount < 0) {
      throw new Error("evidence response byte count must be a non-negative safe integer");
    }
    this.throwIfFailed();
    this.responseBytes += byteCount;
    if (responseByteCount > this.limits.maxResponseBytes) {
      this.fail(
        `Evidence response-byte budget exceeded for ${label}: ` +
          `${responseByteCount} > ${this.limits.maxResponseBytes}.`,
      );
    }
    if (this.responseBytes > this.limits.maxResponseBytesPerWork) {
      this.fail(
        `Evidence work response-byte budget exceeded while loading ${label}: ` +
          `${this.responseBytes} > ${this.limits.maxResponseBytesPerWork}.`,
      );
    }
  }

  registerAbortController(controller) {
    this.throwIfFailed();
    if (
      !controller ||
      typeof controller.abort !== "function" ||
      typeof controller.signal?.aborted !== "boolean"
    ) {
      throw new Error("evidence request controller must provide an AbortSignal");
    }
    this.activeAbortControllers.add(controller);
    let unregistered = false;
    return () => {
      if (unregistered) {
        return;
      }
      unregistered = true;
      this.activeAbortControllers.delete(controller);
    };
  }

  fail(detail) {
    if (!this.failure) {
      this.failure = new GateFailure(
        "pending",
        "Codex review evidence is temporarily incomplete",
        detail,
      );
      for (const resolve of this.requestWaiters.splice(0)) {
        resolve();
      }
      for (const controller of this.activeAbortControllers) {
        if (!controller.signal.aborted) {
          controller.abort(this.failure);
        }
      }
    }
    throw this.failure;
  }
}

export async function mapWithConcurrency(values, concurrency, mapper) {
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new Error("worker concurrency must be a positive safe integer");
  }
  const results = new Array(values.length);
  let nextIndex = 0;
  let firstError = null;

  async function worker() {
    while (!firstError) {
      const index = nextIndex;
      if (index >= values.length) {
        return;
      }
      nextIndex += 1;
      try {
        results[index] = await mapper(values[index], index);
      } catch (error) {
        firstError ||= error;
      }
    }
  }

  const workerCount = Math.min(concurrency, values.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (firstError) {
    throw firstError;
  }
  return results;
}
