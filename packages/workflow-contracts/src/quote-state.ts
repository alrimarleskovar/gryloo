import { Type, type Static } from '@sinclair/typebox';
import {
  artifactObject, strictObject, list, IdentifierSchema, ChainIdSchema, HashSchema,
  SafeIntegerSchema, TimestampSchema, VersionReferenceSchema, ParameterSchema,
  AccountSchema, ContractReferenceSchema, QuantitySchema, FreshnessSchema,
  UncertaintySchema,
} from './common.js';

export const QuoteStateArtifactSchema = artifactObject('quote-state-artifact', {
  artifactId: IdentifierSchema,
  semanticWorkflowHash: HashSchema,
  nodeId: IdentifierSchema,
  sourceId: IdentifierSchema,
  adapter: VersionReferenceSchema,
  chainId: ChainIdSchema,
  chainPosition: Type.Union([
    strictObject({ kind: Type.Literal('BLOCK'), height: SafeIntegerSchema }),
    strictObject({ kind: Type.Literal('SLOT'), height: SafeIntegerSchema }),
  ]),
  retrievedAt: TimestampSchema,
  freshness: FreshnessSchema,
  rawResponseHash: HashSchema,
  normalizedValues: list(ParameterSchema, 128),
  providerReference: Type.Union([
    strictObject({ kind: Type.Literal('NONE') }),
    strictObject({ kind: Type.Literal('ROUTE'), id: IdentifierSchema }),
    strictObject({ kind: Type.Literal('ORDER'), id: IdentifierSchema }),
  ]),
  proposedContracts: list(ContractReferenceSchema, 128),
  proposedSpenders: list(AccountSchema, 128),
  proposedRecipients: list(AccountSchema, 128),
  fees: list(QuantitySchema, 128),
  gas: list(QuantitySchema, 128),
  outputBounds: list(strictObject({
    outputId: IdentifierSchema,
    expected: QuantitySchema,
    minimum: QuantitySchema,
    adverse: QuantitySchema,
  }), 128),
  uncertainty: list(UncertaintySchema, 128),
  registryValidation: strictObject({
    registryVersion: IdentifierSchema,
    actionType: IdentifierSchema,
    result: Type.Union([
      Type.Literal('CONTRACT_VALIDATED'),
      Type.Literal('REJECTED'),
    ]),
    enforcement: Type.Literal('NOT_ENFORCED'),
  }),
});
export type QuoteStateArtifact = Static<typeof QuoteStateArtifactSchema>;
