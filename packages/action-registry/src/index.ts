// SPDX-License-Identifier: Apache-2.0
import { Ajv } from "ajv";
import { parseJsonBytes } from "@defi-workflow-engine/workflow-contracts";
import type {
  AuthorizationMode,
  ExecutionKind,
} from "./capabilities.js";
import { actionRegistrySchema, type ActionRegistry } from "./schemas.js";

export { actionRegistrySchema } from "./schemas.js";
export { referenceRegistry } from "./reference-registry.js";
export { baseAssetRegistry } from "./base-assets.js";
export { capabilityDeclares } from "./capabilities.js";
export type { ActionRegistry } from "./schemas.js";
export type { ActionDefinition } from "./actions.js";
export type {
  AuthorizationMode,
  CapabilityDeclaration,
  ExecutionKind,
} from "./capabilities.js";

type DeepReadonly<T> = T extends readonly (infer Element)[]
  ? readonly DeepReadonly<Element>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export type ImmutableActionRegistry = DeepReadonly<ActionRegistry>;

const validateStructure = new Ajv({
  strict: true,
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
}).compile<ActionRegistry>(actionRegistrySchema);

function uniqueNames(values: readonly { name: string }[]): boolean {
  return new Set(values.map((value) => value.name)).size === values.length;
}

/**
 * Validates an existing object. This API cannot detect duplicates discarded by
 * an earlier JSON parser; untrusted serialized input must use the byte API.
 */
export function validateActionRegistry(value: unknown): value is ActionRegistry {
  if (!validateStructure(value)) return false;

  if (
    new Set(value.actions.map((action) => action.id)).size !==
      value.actions.length ||
    new Set(value.capabilities.map((capability) => capability.id)).size !==
      value.capabilities.length
  ) {
    return false;
  }

  for (const action of value.actions) {
    const capability = value.capabilities.find(
      (candidate) =>
        candidate.id === action.requiredCapability.id &&
        candidate.version === action.requiredCapability.version,
    );

    if (
      capability === undefined ||
      !uniqueNames(action.inputs) ||
      !uniqueNames(action.outputs) ||
      action.executionKinds.some(
        (kind) => !capability.executionKinds.includes(kind),
      ) ||
      action.authorizationModes.some(
        (mode) => !capability.authorizationModes.includes(mode),
      )
    ) {
      return false;
    }

    const { minInputAmountUnits, maxInputAmountUnits } = action.constraints;
    if (
      minInputAmountUnits !== undefined &&
      maxInputAmountUnits !== undefined &&
      BigInt(minInputAmountUnits) > BigInt(maxInputAmountUnits)
    ) {
      return false;
    }
  }

  return true;
}

function freezeRecursively<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeRecursively(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

/** Raw duplicate-key and Unicode guards run before Ajv/object validation. */
export function parseActionRegistryBytes(
  bytes: Uint8Array,
): ImmutableActionRegistry {
  const value = parseJsonBytes(bytes);
  if (!validateActionRegistry(value)) {
    throw new Error("Invalid action registry");
  }
  return freezeRecursively(value);
}

export function getActionDefinition(
  registry: ImmutableActionRegistry,
  actionId: string,
): ImmutableActionRegistry["actions"][number] | undefined {
  return registry.actions.find((action) => action.id === actionId);
}

export interface ActionCompatibilityRequest {
  readonly actionId: string;
  readonly actionVersion: string;
  readonly capabilityId: string;
  readonly capabilityVersion: string;
  readonly executionKind: ExecutionKind;
  readonly authorizationMode: AuthorizationMode;
}

export type CompatibilityIssue =
  | "UNKNOWN_ACTION"
  | "ACTION_VERSION_MISMATCH"
  | "CAPABILITY_MISMATCH"
  | "UNSUPPORTED_EXECUTION_KIND"
  | "UNSUPPORTED_AUTHORIZATION_MODE";

export interface ActionCompatibilityResult {
  readonly compatible: boolean;
  readonly issues: readonly CompatibilityIssue[];
  readonly enforcement: "NOT_ENFORCED";
  readonly executable: false;
}

/** Checks declarations only; a compatible result grants no execution authority. */
export function checkActionCompatibility(
  registry: ImmutableActionRegistry,
  request: ActionCompatibilityRequest,
): ActionCompatibilityResult {
  const issues: CompatibilityIssue[] = [];
  const action = getActionDefinition(registry, request.actionId);

  if (action === undefined) {
    issues.push("UNKNOWN_ACTION");
  } else {
    if (action.version !== request.actionVersion) {
      issues.push("ACTION_VERSION_MISMATCH");
    }

    const capability = registry.capabilities.find(
      (candidate) =>
        candidate.id === request.capabilityId &&
        candidate.version === request.capabilityVersion,
    );

    if (
      capability === undefined ||
      action.requiredCapability.id !== request.capabilityId ||
      action.requiredCapability.version !== request.capabilityVersion
    ) {
      issues.push("CAPABILITY_MISMATCH");
    }

    if (
      !action.executionKinds.includes(request.executionKind) ||
      (capability !== undefined &&
        !capability.executionKinds.includes(request.executionKind))
    ) {
      issues.push("UNSUPPORTED_EXECUTION_KIND");
    }

    if (
      !action.authorizationModes.includes(request.authorizationMode) ||
      (capability !== undefined &&
        !capability.authorizationModes.includes(request.authorizationMode))
    ) {
      issues.push("UNSUPPORTED_AUTHORIZATION_MODE");
    }
  }

  return Object.freeze({
    compatible: issues.length === 0,
    issues: Object.freeze(issues),
    enforcement: "NOT_ENFORCED",
    executable: false,
  });
}
