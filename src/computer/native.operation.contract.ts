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
import { WINDOW_TILE_PRESETS } from "./native.window.layout";
import { verifiedWorkspaceOperations, type NativeServiceHandshake } from "./native.service.client";

var objectSchema = (properties: Record<string, unknown>, required: readonly string[] = []) => ({
  type: "object",
  additionalProperties: false,
  properties,
  ...required.length ? { required } : {}
});
var semanticValueSchema = {
  oneOf: [{ type: "string", maxLength: 4096 }, { type: "number" }, { type: "boolean" }]
};
var semanticPayloadSchema = {
  oneOf: [
    objectSchema({
      kind: { const: "text_range" },
      range: objectSchema({
        location: { type: "integer", minimum: 0 },
        length: { type: "integer", minimum: 0 }
      }, ["location", "length"])
    }, ["kind", "range"]),
    objectSchema({
      kind: { const: "text_match" },
      match: objectSchema({
        text: { type: "string", minLength: 1, maxLength: 4096 },
        prefix: { type: "string", maxLength: 4096 },
        suffix: { type: "string", maxLength: 4096 },
        placement: { type: "string", enum: ["select", "before", "after"] }
      }, ["text"])
    }, ["kind", "match"]),
    objectSchema({
      kind: { const: "caret" },
      caret: objectSchema({
        anchor: { type: "string", enum: ["index", "start", "end"] },
        index: { type: "integer", minimum: 0 }
      }, ["anchor"])
    }, ["kind", "caret"]),
    objectSchema({
      kind: { const: "scroll" },
      scroll: objectSchema({ direction: { type: "string", enum: ["up", "down", "left", "right"] } }, ["direction"])
    }, ["kind", "scroll"]),
    objectSchema({
      kind: { const: "scroll_fraction" },
      scrollFraction: objectSchema({
        axis: { type: "string", enum: ["horizontal", "vertical"] },
        fraction: { type: "number", minimum: 0, maximum: 1 }
      }, ["axis", "fraction"])
    }, ["kind", "scrollFraction"])
  ]
};
export function buildNativeOperationToolContracts(handshake: NativeServiceHandshake | undefined): any[] {
  if (!handshake)
    return [];
  const contracts: any[] = [];
  const { capabilities, limits } = handshake;
  const verifiedOperations = verifiedWorkspaceOperations(handshake);
  const workspaceOperations = [
    capabilities.workspace.apps && "apps",
    capabilities.workspace.windows && "windows",
    capabilities.workspace.displays && "displays",
    ...[
      "resolve_app",
      "launch_app",
      "inspect_file",
      "open_file",
      "reveal_file",
      "trash_file",
      "duplicate_file",
      "open_url",
      "move_window",
      "resize_window",
      "set_window_frame",
      "minimize_window",
      "unminimize_window",
      "close_window",
      "set_window_fullscreen"
    ].filter((operation) => verifiedOperations.includes(operation))
  ].filter((value) => !!value);
  if (workspaceOperations.length) {
    const mutating = workspaceOperations.some((operation) => operation !== "apps" && operation !== "windows" && operation !== "displays" && operation !== "inspect_file");
    contracts.push({
      name: "BimaxWorkspaceTool",
      description: mutating ? "Read native application, window, and display identity; resolve or background-launch a registered application; inspect, open, reveal, duplicate, or trash a workspace file; and move, resize, tile, minimize, or close an exact window." : "Read native application, exact-window, and display identity without mutation.",
      schema: objectSchema({
        operation: { type: "string", enum: workspaceOperations },
        pid: { type: "integer", minimum: 1 },
        includeOffscreenWindows: { type: "boolean", default: false },
        bundleId: { type: "string", minLength: 1, maxLength: 256 },
        appName: { type: "string", minLength: 1, maxLength: 256 },
        readinessTimeoutMs: { type: "integer", minimum: 0, maximum: 1e4 },
        path: { type: "string", minLength: 1, maxLength: 4096 },
        url: { type: "string", minLength: 1, maxLength: 2048 },
        windowId: { type: "integer", minimum: 1 },
        windowGeneration: { type: "integer", minimum: 0 },
        frame: objectSchema({
          x: { type: "number" },
          y: { type: "number" },
          width: { type: "number", minimum: 0 },
          height: { type: "number", minimum: 0 }
        }, ["x", "y", "width", "height"]),
        tile: { type: "string", enum: WINDOW_TILE_PRESETS },
        fullScreen: { type: "boolean" }
      }, ["operation"])
    });
  }
  if (capabilities.observe.profiles.length && capabilities.observe.scopes.length) {
    const observationProperties = {
      pid: { type: "integer", minimum: 1 },
      windowId: { type: "integer", minimum: 1 },
      windowGeneration: { type: "integer", minimum: 0 },
      scope: { type: "string", enum: capabilities.observe.scopes },
      profile: { type: "string", enum: capabilities.observe.profiles },
      maxElements: { type: "integer", minimum: 1, maximum: limits.maxElements },
      sinceSnapshotId: { type: "string", minLength: 1 },
      query: { type: "string", minLength: 1, maxLength: 256 }
    };
    contracts.push({
      name: "BimaxObserveTool",
      description: "Capture a bounded native Accessibility snapshot or diff for one exact scope, optionally reading up to three related app/system-UI trees in parallel.",
      schema: objectSchema({
        ...observationProperties,
        relatedObservations: {
          type: "array",
          maxItems: 3,
          items: objectSchema(observationProperties, ["pid", "scope", "profile"])
        }
      }, ["pid", "scope", "profile"])
    });
  }
  const acceptedActions = new Set(capabilities.delivery.semanticActions);
  const verifiedActions2 = capabilities.delivery.verifiedSemanticActions.filter((action) => acceptedActions.has(action));
  const acceptedPolicies = new Set(capabilities.delivery.policies);
  const verifiedPolicies2 = capabilities.delivery.verifiedDeliveryPolicies.filter((policy) => acceptedPolicies.has(policy));
  if (verifiedActions2.length && verifiedPolicies2.length) {
    contracts.push({
      name: "BimaxActionTool",
      description: "Deliver one verified semantic action to a fresh snapshot-bound element ref.",
      schema: objectSchema({
        snapshotId: { type: "string", minLength: 1 },
        elementToken: { type: "string", minLength: 1 },
        action: { type: "string", enum: verifiedActions2 },
        value: semanticValueSchema,
        payload: semanticPayloadSchema,
        deliveryPolicy: { type: "string", enum: verifiedPolicies2 },
        evidenceTier: { type: "integer", enum: [1, 2] },
        postcondition: objectSchema({
          text: { type: "string", maxLength: 4096 },
          textPresence: { type: "string", enum: ["present", "absent"] },
          expectedValue: { type: "string", maxLength: 4096 },
          valueMustChange: { type: "boolean" },
          expectedFocused: { type: "boolean" },
          expectedSelected: { type: "boolean" },
          elementExists: { type: "boolean" }
        }),
        settleTimeoutMs: { type: "integer", minimum: 50, maximum: 5000 }
      }, ["snapshotId", "elementToken", "action", "deliveryPolicy"])
    });
  }
  const transactionActions = ["set_value", "set_selected"].filter((action) => verifiedActions2.includes(action));
  const transactionPolicies = verifiedPolicies2.filter((policy) => policy === "background_native" || policy === "background_only");
  if (capabilities.delivery.semanticTransactions && transactionActions.length === 2 && transactionPolicies.length) {
    contracts.push({
      name: "BimaxTransactionTool",
      description: "Compile one bounded same-snapshot multi-edit or additive multi-select transaction.",
      schema: objectSchema({
        basedOnSnapshotId: { type: "string", minLength: 1 },
        deliveryPolicy: { type: "string", enum: transactionPolicies },
        steps: {
          type: "array",
          minItems: 1,
          maxItems: limits.maxTransactionSteps,
          items: objectSchema({
            stepId: { type: "string", minLength: 1, maxLength: 64 },
            elementToken: { type: "string", minLength: 1 },
            action: { type: "string", enum: transactionActions },
            value: semanticValueSchema,
            precondition: objectSchema({
              expectedRole: { type: "string" },
              expectedValue: { type: "string" },
              expectedFocused: { type: "boolean" },
              expectedSelected: { type: "boolean" }
            })
          }, ["stepId", "elementToken", "action", "value"])
        }
      }, ["basedOnSnapshotId", "deliveryPolicy", "steps"])
    });
  }
  const captureModes = [
    capabilities.observe.regionCapture && "image",
    capabilities.observe.som && "som",
    capabilities.observe.zoom && "zoom"
  ].filter((value) => !!value);
  if (captureModes.length) {
    contracts.push({
      name: "BimaxCaptureTool",
      description: "Capture a live-gate-verified native image mode behind a session-owned handle.",
      schema: objectSchema({
        mode: { type: "string", enum: captureModes },
        pid: { type: "integer", minimum: 1 },
        windowId: { type: "integer", minimum: 1 },
        windowGeneration: { type: "integer", minimum: 0 },
        displayId: { type: "integer", minimum: 1 },
        basedOnSnapshotId: { type: "string", minLength: 1 },
        region: objectSchema({
          x: { type: "number", minimum: 0 },
          y: { type: "number", minimum: 0 },
          width: { type: "number", exclusiveMinimum: 0 },
          height: { type: "number", exclusiveMinimum: 0 }
        }, ["x", "y", "width", "height"]),
        zoomFactor: { type: "number", exclusiveMinimum: 0, maximum: 8 },
        format: { type: "string", enum: ["png", "jpeg"] },
        jpegQuality: { type: "number", minimum: 0, maximum: 1 },
        maxDimension: { type: "integer", minimum: 1, maximum: limits.maxImageDimension }
      }, ["mode"])
    });
  }
  return contracts;
}
