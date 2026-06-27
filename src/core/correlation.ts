/**
 * Request Correlation ID system using AsyncLocalStorage.
 * Automatically tags every log line within a task execution context
 * with a unique request ID for end-to-end tracing.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import * as crypto from 'crypto';

interface CorrelationContext {
  requestId: string;
}

const correlationStore = new AsyncLocalStorage<CorrelationContext>();

/**
 * Runs a function within a correlation context.
 * All logs emitted inside `fn` will automatically include the request ID.
 */
export function withCorrelation<T>(fn: () => T | Promise<T>): T | Promise<T> {
  const requestId = crypto.randomUUID().substring(0, 8); // Short ID for readability
  return correlationStore.run({ requestId }, fn);
}

/**
 * Returns the current correlation ID, or undefined if not in a correlation context.
 */
export function getCorrelationId(): string | undefined {
  return correlationStore.getStore()?.requestId;
}
