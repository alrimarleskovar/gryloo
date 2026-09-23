// SPDX-License-Identifier: Apache-2.0
import { Type, type Static } from "@sinclair/typebox";
import {
  authorizationModeSchema,
  executionKindSchema,
  identifierSchema,
  versionSchema,
} from "./capabilities.js";

const nodeClassSchema = Type.Union([
  Type.Literal("READ"),
  Type.Literal("ROUTE"),
  Type.Literal("ACTION"),
  Type.Literal("LOGIC"),
  Type.Literal("RISK"),
  Type.Literal("APPROVAL"),
  Type.Literal("RECOVERY"),
  Type.Literal("MONITOR"),
]);

const portSchema = Type.Object(
  {
    name: identifierSchema,
    type: Type.Union([
      Type.Literal("ASSET_REF"),
      Type.Literal("AMOUNT_UNITS"),
      Type.Literal("BOOLEAN"),
      Type.Literal("ARTIFACT_REF"),
      Type.Literal("CONDITION"),
      Type.Literal("DURATION_MS"),
    ]),
    required: Type.Boolean(),
  },
  { additionalProperties: false },
);

const amountSchema = Type.String({
  pattern: "^(0|[1-9][0-9]*)$",
  maxLength: 78,
});

export const actionDefinitionSchema = Type.Object(
  {
    id: identifierSchema,
    version: versionSchema,
    nodeClass: nodeClassSchema,
    inputs: Type.Array(portSchema, { maxItems: 32 }),
    outputs: Type.Array(portSchema, { maxItems: 32 }),
    constraints: Type.Object(
      {
        arbitraryTargetsAllowed: Type.Literal(false),
        financialAmountEncoding: Type.Literal("NATIVE_UNIT_DECIMAL_STRINGS"),
        minInputAmountUnits: Type.Optional(amountSchema),
        maxInputAmountUnits: Type.Optional(amountSchema),
        allowedChainRefs: Type.Optional(
          Type.Array(
            Type.String({
              pattern: "^[a-z][a-z0-9-]*:[a-zA-Z0-9._-]+$",
              maxLength: 128,
            }),
            { uniqueItems: true, maxItems: 32 },
          ),
        ),
      },
      { additionalProperties: false },
    ),
    requiredCapability: Type.Object(
      { id: identifierSchema, version: versionSchema },
      { additionalProperties: false },
    ),
    executionKinds: Type.Array(executionKindSchema, {
      uniqueItems: true,
      maxItems: 2,
    }),
    authorizationModes: Type.Array(authorizationModeSchema, {
      uniqueItems: true,
      maxItems: 3,
    }),
  },
  { additionalProperties: false },
);

export type ActionDefinition = Static<typeof actionDefinitionSchema>;
