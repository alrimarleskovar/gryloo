import { Type, type Static } from '@sinclair/typebox';
import {
  artifactObject, strictObject, list, IdentifierSchema, HashSchema, AllowlistSchema,
  SpendLimitSchema, BasisPointsSchema, BudgetSchema, OracleRuleSchema,
  AccountRiskRuleSchema, CheckpointRuleSchema, ProviderPolicySchema,
  NativeUnitsSchema, TimestampSchema, SafeIntegerSchema, RecoverySchema,
  EnforcementSchema, AuthorizationClassSchema,
} from './common.js';

export const AuthorizationPolicySchema = artifactObject('authorization-policy', {
  policyId: IdentifierSchema,
  semanticWorkflowHash: HashSchema,
  artifactSetHash: HashSchema,
  simulationHash: HashSchema,
  requiredAuthorizationClass: AuthorizationClassSchema,
  allowlists: AllowlistSchema,
  budgetReservation: strictObject({
    rule: Type.Literal('RESERVE_BEFORE_SUBMISSION'),
    concurrentConsumption: Type.Literal('CUMULATIVE_ACROSS_BRANCHES'),
    implementation: Type.Literal('NOT_IMPLEMENTED'),
  }),
  spendLimits: list(SpendLimitSchema, 128),
  maximumSlippageBps: BasisPointsSchema,
  gasBudgets: list(BudgetSchema, 128),
  feeBudgets: list(BudgetSchema, 128),
  oracleRules: list(OracleRuleSchema, 128),
  accountRiskRules: list(AccountRiskRuleSchema, 128),
  checkpointRules: list(CheckpointRuleSchema, 1024),
  providers: ProviderPolicySchema,
  nonce: NativeUnitsSchema,
  deadline: TimestampSchema,
  revocationEpoch: SafeIntegerSchema,
  recovery: RecoverySchema,
  enforcement: EnforcementSchema,
});
export type AuthorizationPolicy = Static<typeof AuthorizationPolicySchema>;
