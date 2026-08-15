/**
 * RECOVERED from the compiled `native-service/bimax-mac-capability` bundle on 2026-08-10.
 *
 * The TypeScript original was evicted by iCloud (storage full) with no git copy — this
 * directory has never been committed. Bun's `--compile` embeds the bundled JavaScript with
 * its source-path comments intact, so this is the REAL logic, not a reconstruction from
 * call sites. What the compiler erased is gone: type annotations, interfaces, and the
 * original comments. Types below were re-derived from usage and are the only part of this
 * file that is inference rather than recovery.
 *
 * Bundler artefacts to expect: identifiers may carry numeric suffixes (`crypto3`,
 * `resolve4`) from module-scope deduplication, and imports were hoisted out of this file.
 */
import { createHash as createHash4 } from "crypto";

import { BIMAX_CU_PROTOCOL, type NativeServiceHandshake } from "./native.service.client";

/**
 * Shapes below are re-derived from this file's own validators (`validateElementRef`,
 * `validateValue`, `validatePrecondition`) and from the consumers in
 * `native.tool.coordinator.ts`. They describe the same values the recovered logic already
 * enforces at runtime — the annotations add no new checks.
 */
export interface NativeElementRef {
  token: string;
  snapshotId: string;
  pid: number;
  windowId: number;
  windowGeneration: number;
  axRevision: number;
  stablePathHash: string;
}

export type NativeSemanticValue =
  | { type: "string"; value: string }
  | { type: "number"; value: number }
  | { type: "boolean"; value: boolean };

/** Only these two actions compile; everything else is a separate commit boundary. */
export type NativeTransactionAction = "set_value" | "set_selected";

/** Transactions are background-only by construction — see the policy check in the compiler. */
export type NativeTransactionDeliveryPolicy = "background_native" | "background_only";

export interface NativeTransactionPrecondition {
  expectedRole?: string;
  expectedValue?: string;
  expectedFocused?: boolean;
  expectedSelected?: boolean;
}

export interface NativeTransactionStep {
  stepId: string;
  element: NativeElementRef;
  action: NativeTransactionAction;
  value: NativeSemanticValue;
  precondition?: NativeTransactionPrecondition;
}

export interface NativeTransactionInput {
  basedOnSnapshotId: string;
  deliveryPolicy: NativeTransactionDeliveryPolicy;
  steps: NativeTransactionStep[];
}

/** The generation-bound window every step of a transaction must share. */
export interface NativeTransactionTarget {
  pid: number;
  windowId: number;
  windowGeneration: number;
}

/** What the user is asked to approve — the binding hash plus the steps in readable form. */
export interface NativeTransactionApprovalManifest {
  version: string;
  bindingHash: string;
  basedOnSnapshotId: string;
  target: NativeTransactionTarget;
  deliveryPath: NativeTransactionDeliveryPolicy;
  steps: ReadonlyArray<NativeTransactionStep & {
    impact: string;
    commitBoundary: boolean;
    requiredEvidence: string;
  }>;
  containsCommitBoundary: boolean;
}

export interface CompiledNativeTransaction {
  readonly request: Readonly<{
    basedOnSnapshotId: string;
    steps: readonly NativeTransactionStep[];
    deliveryPolicy: NativeTransactionDeliveryPolicy;
    approvalManifestHash: string;
  }>;
  readonly canonicalPayload: string;
  readonly approvalManifest: Readonly<NativeTransactionApprovalManifest>;
}

var compiledTransactions = new WeakSet<object>();
export function isCompiledNativeTransaction(value: unknown): value is CompiledNativeTransaction {
  return !!value && typeof value === "object" && compiledTransactions.has(value as object);
}
export class NativeTransactionCompileError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "NativeTransactionCompileError";
  }
}
// A function declaration (not a `var` arrow): TypeScript only treats a call as never-returning —
// and so only narrows the code after it — when the target is declared this way.
function fail(code: string, message: string): never {
  throw new NativeTransactionCompileError(code, message);
}
function assertNonEmpty(value: unknown, field: string, maxLength?: number): void {
  if (typeof value !== "string" || value.length === 0 || value.includes("\x00") || maxLength !== undefined && value.length > maxLength) {
    fail("invalid_transaction_field", `${field} must be non-empty${maxLength ? ` and at most ${maxLength} characters` : ""}`);
  }
}
function assertSafeInteger(value: unknown, field: string, minimum: number, maximum: number = Number.MAX_SAFE_INTEGER): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail("invalid_transaction_target", `${field} must be a safe integer between ${minimum} and ${maximum}`);
  }
}
function rejectUnknownKeys(value: object, allowed: readonly string[], field: string): void {
  const accepted = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!accepted.has(key))
      fail("invalid_transaction_field", `${field}.${key} is not allowed`);
  }
}
function validateElementRef(element: any, basedOnSnapshotId: string): void {
  if (!element || typeof element !== "object")
    fail("invalid_transaction_target", "every step requires a complete element ref");
  rejectUnknownKeys(element, [
    "token",
    "snapshotId",
    "pid",
    "windowId",
    "windowGeneration",
    "axRevision",
    "stablePathHash"
  ], "element");
  assertNonEmpty(element.token, "element.token");
  assertNonEmpty(element.snapshotId, "element.snapshotId");
  assertNonEmpty(element.stablePathHash, "element.stablePathHash");
  assertSafeInteger(element.pid, "element.pid", 1, 2147483647);
  assertSafeInteger(element.windowId, "element.windowId", 1, 4294967295);
  assertSafeInteger(element.windowGeneration, "element.windowGeneration", 0);
  assertSafeInteger(element.axRevision, "element.axRevision", 0);
  if (element.snapshotId !== basedOnSnapshotId) {
    fail("transaction_snapshot_mismatch", "every step must use the authorizing snapshot");
  }
}
function validateValue(step: any): void {
  const value = step.value;
  if (!value || typeof value !== "object")
    fail("transaction_value_required", `${step.action} requires a typed value`);
  rejectUnknownKeys(value, ["type", "value"], "value");
  if (value.type === "string") {
    if (typeof value.value !== "string")
      fail("invalid_transaction_value", "string values must contain a string");
  } else if (value.type === "number") {
    if (typeof value.value !== "number" || !Number.isFinite(value.value)) {
      fail("invalid_transaction_value", "number values must be finite");
    }
  } else if (value.type === "boolean") {
    if (typeof value.value !== "boolean")
      fail("invalid_transaction_value", "boolean values must contain a boolean");
  } else {
    fail("invalid_transaction_value", "transaction values must be string, number, or boolean");
  }
  if (step.action === "set_selected" && value.type !== "boolean") {
    fail("invalid_transaction_value", "set_selected requires a boolean value");
  }
}
function validatePrecondition(value: any): void {
  if (value === undefined)
    return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid_transaction_precondition", "precondition must be an object");
  }
  const allowed = new Set(["expectedRole", "expectedValue", "expectedFocused", "expectedSelected"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key))
      fail("invalid_transaction_precondition", `unsupported precondition ${key}`);
  }
  if (value.expectedRole !== undefined && typeof value.expectedRole !== "string")
    fail("invalid_transaction_precondition", "expectedRole must be a string");
  if (value.expectedValue !== undefined && typeof value.expectedValue !== "string")
    fail("invalid_transaction_precondition", "expectedValue must be a string");
  if (value.expectedFocused !== undefined && typeof value.expectedFocused !== "boolean")
    fail("invalid_transaction_precondition", "expectedFocused must be boolean");
  if (value.expectedSelected !== undefined && typeof value.expectedSelected !== "boolean")
    fail("invalid_transaction_precondition", "expectedSelected must be boolean");
}
function canonicalNativeManifest(value: unknown): string {
  const normalize3 = (part: any): any => {
    if (part === null || typeof part === "string" || typeof part === "boolean")
      return part;
    if (typeof part === "number") {
      if (!Number.isFinite(part))
        fail("manifest_not_canonical", "manifest numbers must be finite");
      return Object.is(part, -0) ? 0 : part;
    }
    if (Array.isArray(part))
      return part.map((item) => {
        if (item === undefined)
          fail("manifest_not_canonical", "manifest arrays cannot contain undefined");
        return normalize3(item);
      });
    if (part && typeof part === "object") {
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(part).sort()) {
        const child = part[key];
        if (child !== undefined)
          result[key] = normalize3(child);
      }
      return result;
    }
    return fail("manifest_not_canonical", "manifest contains a non-JSON value");
  };
  return JSON.stringify(normalize3(value)).replace(/\//g, "\\/");
}
function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value as Record<string, unknown>))
    deepFreeze(child);
  return Object.freeze(value);
}
function requireTransactionCapability(handshake: NativeServiceHandshake | undefined): number {
  const delivery = handshake?.capabilities?.delivery;
  if (handshake?.selectedProtocol !== BIMAX_CU_PROTOCOL || !delivery?.semanticTransactions) {
    fail("transaction_capability_unavailable", "the measured native handshake does not support semantic transactions");
  }
  const advertised = new Set(delivery.semanticActions);
  const verified = new Set(delivery.verifiedSemanticActions.filter((action) => advertised.has(action)));
  if (!verified.has("set_value") || !verified.has("set_selected")) {
    fail("transaction_capability_unavailable", "the full transaction action subset has not been verified live");
  }
  const max = handshake.limits.maxTransactionSteps;
  if (!Number.isSafeInteger(max) || max < 1)
    fail("transaction_capability_unavailable", "the service advertised an invalid transaction limit");
  return Math.min(5, max);
}
export function compileNativeSemanticTransaction(
  input: NativeTransactionInput,
  handshake: NativeServiceHandshake | undefined,
): CompiledNativeTransaction {
  const maxSteps = requireTransactionCapability(handshake);
  if (!input || typeof input !== "object")
    fail("invalid_transaction_field", "transaction input must be an object");
  assertNonEmpty(input?.basedOnSnapshotId, "basedOnSnapshotId");
  if (!Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > maxSteps) {
    fail("invalid_transaction_size", `semantic transactions require 1-${maxSteps} steps`);
  }
  // `requireTransactionCapability` above throws unless the handshake is present and capable, so
  // from here it is known-good; TypeScript cannot carry that narrowing across the call.
  const capable = handshake as NativeServiceHandshake;
  const acceptedPolicies = new Set(capable.capabilities.delivery.policies);
  const verifiedPolicies2 = new Set(capable.capabilities.delivery.verifiedDeliveryPolicies.filter((policy) => acceptedPolicies.has(policy)));
  if (input.deliveryPolicy !== "background_native" && input.deliveryPolicy !== "background_only" || !verifiedPolicies2.has(input.deliveryPolicy)) {
    fail("transaction_policy_unsupported", "transaction delivery policy must be a verified background policy");
  }
  const ids = new Set<string>();
  let target: { pid: number; windowId: number; windowGeneration: number } | undefined;
  const steps = input.steps.map((candidate, index) => {
    const step = candidate;
    if (!step || typeof step !== "object" || Array.isArray(step))
      fail("invalid_transaction_step", `step ${index + 1} must be an object`);
    const allowed = new Set(["stepId", "element", "action", "value", "precondition"]);
    for (const key of Object.keys(step)) {
      if (!allowed.has(key))
        fail("transaction_action_unsupported", `transaction step field ${key} is not allowed`);
    }
    assertNonEmpty(step.stepId, "stepId", 64);
    if (ids.has(step.stepId))
      fail("invalid_transaction_step_id", "transaction step ids must be unique");
    ids.add(step.stepId);
    if (step.action !== "set_value" && step.action !== "set_selected") {
      fail("transaction_commit_boundary", `action ${String(step.action)} must be governed as a separate commit action`);
    }
    validateElementRef(step.element, input.basedOnSnapshotId);
    validateValue(step);
    validatePrecondition(step.precondition);
    const current = {
      pid: step.element.pid,
      windowId: step.element.windowId,
      windowGeneration: step.element.windowGeneration
    };
    if (!target)
      target = current;
    else if (target.pid !== current.pid || target.windowId !== current.windowId || target.windowGeneration !== current.windowGeneration) {
      fail("transaction_target_mismatch", "every step must target the same generation-bound window");
    }
    return {
      stepId: step.stepId,
      element: { ...step.element },
      action: step.action,
      value: { ...step.value },
      ...step.precondition ? { precondition: { ...step.precondition } } : {}
    };
  });
  const payload = {
    basedOnSnapshotId: input.basedOnSnapshotId,
    steps,
    deliveryPolicy: input.deliveryPolicy
  };
  const canonicalPayload = canonicalNativeManifest(payload);
  const bindingHash = createHash4("sha256").update(canonicalPayload, "utf8").digest("hex");
  const request = deepFreeze({
    ...payload,
    approvalManifestHash: bindingHash
  });
  // `steps` is validated as non-empty above and every step assigns `target`, so by here exactly one
  // generation-bound window has been agreed. Assert that rather than leaving the manifest's target
  // fields optional — a manifest with a partial target would be approvable but unbindable.
  if (!target) fail("transaction_target_mismatch", "transaction produced no target window");
  const frozenTarget: NativeTransactionTarget = target;
  const approvalManifest = deepFreeze({
    version: "bimax.cu.transaction-approval.v1",
    bindingHash,
    basedOnSnapshotId: input.basedOnSnapshotId,
    target: { ...frozenTarget },
    deliveryPath: input.deliveryPolicy,
    steps: steps.map((step) => ({
      ...step,
      element: { ...step.element },
      value: { ...step.value },
      ...step.precondition ? { precondition: { ...step.precondition } } : {},
      impact: "routine",
      commitBoundary: false,
      requiredEvidence: "semantic"
    })),
    containsCommitBoundary: false
  });
  const compiled = deepFreeze({
    request,
    canonicalPayload,
    approvalManifest
  });
  compiledTransactions.add(compiled);
  return compiled;
}
