// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  actionRegistrySchema,
  checkActionCompatibility,
  getActionDefinition,
  parseActionRegistryBytes,
  validateActionRegistry,
  type ActionCompatibilityRequest,
  type ActionRegistry,
} from "../src/index.js";

const fixtureBytes = readFileSync(
  new URL(
    "../../../tests/compatibility/v1/action-registry.json",
    import.meta.url,
  ),
);

function mutableFixture(): ActionRegistry {
  return JSON.parse(fixtureBytes.toString("utf8")) as ActionRegistry;
}

const request: ActionCompatibilityRequest = {
  actionId: "asset.swap",
  actionVersion: "1.0.0",
  capabilityId: "asset.swap.execution",
  capabilityVersion: "1.0.0",
  executionKind: "DIRECT_TRANSACTION",
  authorizationMode: "A",
};

describe("declarative Action Registry", () => {
  it("parses the fixture through guarded bytes and freezes the registry/schema", () => {
    const registry = parseActionRegistryBytes(fixtureBytes);
    expect(validateActionRegistry(registry)).toBe(true);
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.actions)).toBe(true);
    expect(Object.isFrozen(registry.actions[0]?.constraints)).toBe(true);
    expect(Object.isFrozen(actionRegistrySchema.properties.actions)).toBe(true);
    expect(getActionDefinition(registry, "asset.swap")?.nodeClass).toBe("ACTION");
  });

  it("reports declaration compatibility without claiming executability", () => {
    const registry = parseActionRegistryBytes(fixtureBytes);
    for (const executionKind of [
      "DIRECT_TRANSACTION",
      "SIGNED_INTENT",
    ] as const) {
      expect(
        checkActionCompatibility(registry, { ...request, executionKind }),
      ).toEqual({
        compatible: true,
        issues: [],
        enforcement: "NOT_ENFORCED",
        executable: false,
      });
    }
  });

  it("fails unknown actions, mismatched versions, capabilities and modes", () => {
    const registry = parseActionRegistryBytes(fixtureBytes);
    const cases: readonly [
      Partial<ActionCompatibilityRequest>,
      string,
    ][] = [
      [{ actionId: "unknown.action" }, "UNKNOWN_ACTION"],
      [{ actionVersion: "2.0.0" }, "ACTION_VERSION_MISMATCH"],
      [{ capabilityId: "unknown.capability" }, "CAPABILITY_MISMATCH"],
      [{ capabilityVersion: "2.0.0" }, "CAPABILITY_MISMATCH"],
      [{ authorizationMode: "B" }, "UNSUPPORTED_AUTHORIZATION_MODE"],
      [{ authorizationMode: "C" }, "UNSUPPORTED_AUTHORIZATION_MODE"],
    ];
    for (const [change, issue] of cases) {
      const result = checkActionCompatibility(registry, {
        ...request,
        ...change,
      });
      expect(result.compatible).toBe(false);
      expect(result.issues).toContain(issue);
      expect(result.executable).toBe(false);
    }
    expect(getActionDefinition(registry, "unknown.action")).toBeUndefined();
  });

  it("rejects unsupported execution kinds declared by an action", () => {
    const registry = mutableFixture();
    const capability = registry.capabilities[0];
    if (capability === undefined) throw new Error("Missing fixture capability");
    capability.executionKinds = ["DIRECT_TRANSACTION"];
    expect(validateActionRegistry(registry)).toBe(false);
  });

  it("rejects duplicate IDs and unresolved required capabilities", () => {
    const actionDuplicate = mutableFixture();
    const action = actionDuplicate.actions[0];
    if (action === undefined) throw new Error("Missing fixture action");
    actionDuplicate.actions.push(structuredClone(action));
    expect(validateActionRegistry(actionDuplicate)).toBe(false);

    const capabilityDuplicate = mutableFixture();
    const capability = capabilityDuplicate.capabilities[0];
    if (capability === undefined) throw new Error("Missing fixture capability");
    capabilityDuplicate.capabilities.push(structuredClone(capability));
    expect(validateActionRegistry(capabilityDuplicate)).toBe(false);

    const unresolved = mutableFixture();
    const unresolvedAction = unresolved.actions[0];
    if (unresolvedAction === undefined) throw new Error("Missing fixture action");
    unresolvedAction.requiredCapability.id = "unknown.capability";
    expect(validateActionRegistry(unresolved)).toBe(false);
  });

  it("rejects additional executable fields and inverted amount constraints", () => {
    const additional = mutableFixture();
    Object.assign(additional.actions[0] ?? {}, {
      deployedAddress: "unapproved-target",
    });
    expect(validateActionRegistry(additional)).toBe(false);

    const inverted = mutableFixture();
    const action = inverted.actions[0];
    if (action === undefined) throw new Error("Missing fixture action");
    action.constraints.minInputAmountUnits = "1000001";
    expect(validateActionRegistry(inverted)).toBe(false);
  });

  it("rejects duplicate serialized keys at the public byte ingress", () => {
    const duplicate = fixtureBytes
      .toString("utf8")
      .replace(
        '"registryVersion": "1.0.0"',
        '"registryVersion": "1.0.0", "\\u0072egistryVersion": "1.0.0"',
      );
    expect(() =>
      parseActionRegistryBytes(new TextEncoder().encode(duplicate)),
    ).toThrow();
  });
});
