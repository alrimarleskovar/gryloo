import { Type, type Static } from '@sinclair/typebox';
import {
  artifactObject, list, IdentifierSchema, HashSchema, SafeIntegerSchema,
  AuthorizationClassSchema, AccountSchema, TimestampSchema, NativeUnitsSchema,
  SpendLimitSchema, BudgetSchema, BasisPointsSchema, ProviderPolicySchema,
  RecoverySchema, EnforcementSchema,
} from './common.js';

export const StrategyManifestSchema = artifactObject('strategy-manifest', {
  manifestId: IdentifierSchema,
  semanticWorkflowRevision: SafeIntegerSchema,
  semanticWorkflowHash: HashSchema,
  artifactSetHash: HashSchema,
  simulationHash: HashSchema,
  policyHash: HashSchema,
  authorizationMode: AuthorizationClassSchema,
  owner: AccountSchema,
  executor: Type.Union([AccountSchema, Type.Null()]),
  expiresAt: TimestampSchema,
  nonce: NativeUnitsSchema,
  revocationEpoch: SafeIntegerSchema,
  spendLimits: list(SpendLimitSchema, 128),
  maximumSlippageBps: BasisPointsSchema,
  gasBudgets: list(BudgetSchema, 128),
  feeBudgets: list(BudgetSchema, 128),
  providers: ProviderPolicySchema,
  recovery: RecoverySchema,
  enforcement: EnforcementSchema,
});
export type StrategyManifest = Static<typeof StrategyManifestSchema>;
