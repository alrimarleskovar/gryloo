import { type Static } from '@sinclair/typebox';
import {
  artifactObject, strictObject, list, IdentifierSchema, HashSchema,
  SafeIntegerSchema, VersionReferenceSchema, ContractReferenceSchema,
  QuantitySchema, FreshnessSchema, UncertaintySchema, NoteSchema,
} from './common.js';

export const SimulationBundleSchema = artifactObject('simulation-bundle', {
  simulationId: IdentifierSchema,
  semanticWorkflowRevision: SafeIntegerSchema,
  semanticWorkflowHash: HashSchema,
  artifactSetHash: HashSchema,
  adapters: list(VersionReferenceSchema, 128),
  contracts: list(ContractReferenceSchema, 128),
  outputs: list(strictObject({
    nodeId: IdentifierSchema,
    outputId: IdentifierSchema,
    expected: QuantitySchema,
    minimum: QuantitySchema,
    adverse: QuantitySchema,
  }), 4096),
  propagatedOutputs: list(strictObject({
    fromNodeId: IdentifierSchema,
    outputId: IdentifierSchema,
    toNodeId: IdentifierSchema,
    inputName: IdentifierSchema,
    quantity: QuantitySchema,
  }), 4096),
  failurePaths: list(strictObject({
    failedNodeId: IdentifierSchema,
    blockedNodeIds: list(IdentifierSchema),
    residualAssets: list(QuantitySchema, 128),
  }), 1024),
  uncertainty: list(UncertaintySchema, 128),
  unsupportedAssumptions: list(NoteSchema, 128),
  freshness: FreshnessSchema,
});
export type SimulationBundle = Static<typeof SimulationBundleSchema>;
