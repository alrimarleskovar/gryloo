// SPDX-License-Identifier: Apache-2.0
import { Type, type Static } from "@sinclair/typebox";
import { actionDefinitionSchema } from "./actions.js";
import {
  capabilityDeclarationSchema,
  identifierSchema,
  versionSchema,
} from "./capabilities.js";

function freezeRecursively<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeRecursively(child);
    Object.freeze(value);
  }
  return value;
}

export const actionRegistrySchema = freezeRecursively(
  Type.Object(
    {
      schemaVersion: Type.Literal("1.0.0"),
      registryId: identifierSchema,
      registryVersion: versionSchema,
      capabilities: Type.Array(capabilityDeclarationSchema, {
        minItems: 1,
        maxItems: 256,
      }),
      actions: Type.Array(actionDefinitionSchema, {
        minItems: 1,
        maxItems: 256,
      }),
    },
    {
      $id: "urn:defi-workflow-engine:action-registry/v1/action-registry",
      $schema: "http://json-schema.org/draft-07/schema#",
      additionalProperties: false,
    },
  ),
);

export type ActionRegistry = Static<typeof actionRegistrySchema>;
