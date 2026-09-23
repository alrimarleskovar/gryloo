import { Type, type Static } from '@sinclair/typebox';
import {
  artifactObject, strictObject, list, IdentifierSchema, ChainIdSchema, HashSchema,
  VersionReferenceSchema, AuthorizationClassSchema, EnforcementSchema,
} from './common.js';

const stepFields = {
  stepId: IdentifierSchema,
  nodeId: IdentifierSchema,
  chainId: ChainIdSchema,
  adapter: VersionReferenceSchema,
  dependencies: Type.Array(IdentifierSchema, {
    maxItems: 1024, uniqueItems: true,
  }),
  requiredAuthorizationClass: AuthorizationClassSchema,
};

export const ExecutionStepSchema = Type.Union([
  strictObject({
    ...stepFields,
    executionKind: Type.Literal('DIRECT_TRANSACTION'),
    payloadHash: HashSchema,
  }),
  strictObject({
    ...stepFields,
    executionKind: Type.Literal('SIGNED_INTENT'),
    intentHash: HashSchema,
  }),
]);

export const ExecutionPlanSchema = artifactObject('execution-plan', {
  executionPlanId: IdentifierSchema,
  semanticWorkflowHash: HashSchema,
  manifestHash: HashSchema,
  segments: Type.Array(strictObject({
    segmentId: IdentifierSchema,
    chainId: ChainIdSchema,
    dependencies: Type.Array(IdentifierSchema, {
      maxItems: 1024, uniqueItems: true,
    }),
    steps: Type.Array(ExecutionStepSchema, { minItems: 1, maxItems: 1024 }),
  }), { minItems: 1, maxItems: 1024 }),
  checkpointIds: list(IdentifierSchema),
  enforcement: EnforcementSchema,
});
export type ExecutionPlan = Static<typeof ExecutionPlanSchema>;
