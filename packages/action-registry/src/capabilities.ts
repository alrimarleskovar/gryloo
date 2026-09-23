// SPDX-License-Identifier: Apache-2.0
import { Type, type Static } from "@sinclair/typebox";

export const identifierSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$",
});

export const versionSchema = Type.String({
  pattern: "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$",
  maxLength: 32,
});

export const executionKindSchema = Type.Union([
  Type.Literal("DIRECT_TRANSACTION"),
  Type.Literal("SIGNED_INTENT"),
]);

export const authorizationModeSchema = Type.Union([
  Type.Literal("A"),
  Type.Literal("B"),
  Type.Literal("C"),
]);

export const capabilityDeclarationSchema = Type.Object(
  {
    id: identifierSchema,
    version: versionSchema,
    status: Type.Literal("DECLARED_ONLY"),
    enforcement: Type.Literal("NOT_ENFORCED"),
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

export type ExecutionKind = Static<typeof executionKindSchema>;
export type AuthorizationMode = Static<typeof authorizationModeSchema>;
export type CapabilityDeclaration = Static<typeof capabilityDeclarationSchema>;

/** Declaration matching only; this never establishes executable authority. */
export function capabilityDeclares(
  capability: Readonly<{
    executionKinds: readonly ExecutionKind[];
    authorizationModes: readonly AuthorizationMode[];
  }>,
  executionKind: ExecutionKind,
  authorizationMode: AuthorizationMode,
): boolean {
  return (
    capability.executionKinds.includes(executionKind) &&
    capability.authorizationModes.includes(authorizationMode)
  );
}
