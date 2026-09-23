import { Type, type Static } from '@sinclair/typebox';
import {
  artifactObject, strictObject, list, IdentifierSchema, HashSchema,
  PositiveIntegerSchema, TimestampSchema, QuantitySchema, AccountSchema, NoteSchema,
} from './common.js';

export const EvidenceBundleSchema = artifactObject('evidence-bundle', {
  evidenceBundleId: IdentifierSchema,
  version: PositiveIntegerSchema,
  supersedes: Type.Union([HashSchema, Type.Null()]),
  semanticWorkflowHash: HashSchema,
  artifactSetHash: HashSchema,
  simulationHash: HashSchema,
  policyHash: HashSchema,
  manifestHash: HashSchema,
  executionPlanHash: HashSchema,
  journalHeadHash: HashSchema,
  observedAt: TimestampSchema,
  environment: Type.Union([
    Type.Literal('MOCKED'),
    Type.Literal('FORK_REPRODUCED'),
    Type.Literal('TESTNET_EXECUTED'),
    Type.Literal('MAINNET_EXECUTED'),
  ]),
  outcome: Type.Union([
    Type.Literal('CONFIRMED_NOT_RECONCILED'),
    Type.Literal('RECONCILED'),
    Type.Literal('INCONCLUSIVE'),
    Type.Literal('DIVERGENT'),
  ]),
  receipts: list(strictObject({ receiptId: IdentifierSchema, contentHash: HashSchema }), 4096),
  differences: list(strictObject({ field: IdentifierSchema, expected: QuantitySchema, observed: QuantitySchema }), 4096),
  reconciliation: strictObject({
    balances: list(QuantitySchema), allowances: list(QuantitySchema), debt: list(QuantitySchema),
    positions: list(QuantitySchema), fees: list(QuantitySchema), residualAssets: list(QuantitySchema),
    ownership: list(AccountSchema), limitations: list(NoteSchema),
  }),
  evidence: list(strictObject({
    evidenceId: IdentifierSchema,
    kind: Type.Union([
      Type.Literal('SCHEMA_VALIDATION'),
      Type.Literal('HASH_VECTOR'),
      Type.Literal('JOURNAL_ENTRY'),
      Type.Literal('EXTERNAL_REFERENCE'),
    ]),
    contentHash: HashSchema,
  }), 4096),
});
export type EvidenceBundle = Static<typeof EvidenceBundleSchema>;
