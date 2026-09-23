import { Type, type Static } from '@sinclair/typebox';
import {
  artifactObject, strictObject, list, IdentifierSchema, ChainIdSchema, SafeIntegerSchema,
  SchemaVersionSchema, VersionReferenceSchema, ParameterSchema, OutputSchema,
  ConstraintSchema, FailurePolicySchema, AuthorizationClassSchema,
  EditableBoundSchema,
} from './common.js';

export const WorkflowNodeSchema = strictObject({
  nodeId: IdentifierSchema,
  actionType: IdentifierSchema,
  actionSchemaVersion: SchemaVersionSchema,
  chainId: ChainIdSchema,
  requiredCapabilities: Type.Array(IdentifierSchema, {
    maxItems: 128, uniqueItems: true,
  }),
  adapterConstraints: strictObject({
    adapters: list(VersionReferenceSchema, 128),
    protocols: Type.Array(IdentifierSchema, { maxItems: 128, uniqueItems: true }),
  }),
  inputs: list(ParameterSchema, 128),
  expectedOutputs: list(OutputSchema, 128),
  dependencies: Type.Array(IdentifierSchema, {
    maxItems: 1024, uniqueItems: true,
  }),
  userConstraints: list(ConstraintSchema, 128),
  failurePolicy: FailurePolicySchema,
  requiredAuthorizationClass: AuthorizationClassSchema,
  lockedParameters: list(ParameterSchema, 128),
  editableBounds: list(EditableBoundSchema, 128),
});

export const SemanticWorkflowSchema = artifactObject('semantic-workflow', {
  workflowId: IdentifierSchema,
  revision: SafeIntegerSchema,
  nodes: Type.Array(WorkflowNodeSchema, { minItems: 1, maxItems: 1024 }),
  resourceEdges: list(strictObject({
    fromNodeId: IdentifierSchema,
    outputId: IdentifierSchema,
    toNodeId: IdentifierSchema,
    inputName: IdentifierSchema,
  }), 4096),
});
export type SemanticWorkflow = Static<typeof SemanticWorkflowSchema>;
