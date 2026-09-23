import { Type, type Static, type TProperties, type TSchema } from '@sinclair/typebox';

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function strictObject<P extends TProperties>(properties: P) {
  return Type.Object(properties, { additionalProperties: false });
}

export function artifactObject<P extends TProperties>(kind: string, properties: P) {
  return deepFreeze(Type.Object({
    schemaVersion: Type.Literal('1.0.0'),
    ...properties,
  }, {
    additionalProperties: false,
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: `urn:defi-workflow-engine:contracts/v1/${kind}`,
  }));
}

export function list<T extends TSchema>(item: T, maxItems = 1024) {
  return Type.Array(item, { maxItems });
}

export const IdentifierSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
});
export const ChainIdSchema = Type.String({ minLength: 3, maxLength: 128, pattern: '^[a-z][a-z0-9-]*:[A-Za-z0-9._-]+$' });
export const HashSchema = Type.String({
  pattern: '^0x[0-9a-f]{64}$',
});
export const TimestampSchema = Type.String({
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
});
export const SafeIntegerSchema = Type.Integer({
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
});
export const PositiveIntegerSchema = Type.Integer({
  minimum: 1,
  maximum: Number.MAX_SAFE_INTEGER,
});
export const NativeUnitsSchema = Type.String({
  pattern: '^(0|[1-9][0-9]*)$',
  maxLength: 78,
});
export const NonzeroNativeUnitsSchema = Type.String({
  pattern: '^[1-9][0-9]*$',
  maxLength: 78,
});
export const AddressSchema = Type.String({
  minLength: 1,
  maxLength: 160,
  pattern: '^[A-Za-z0-9._:-]+$',
});
export const SchemaVersionSchema = Type.String({
  pattern: '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$',
  maxLength: 32,
});
export const BasisPointsSchema = Type.Integer({ minimum: 0, maximum: 10000 });
export const NoteSchema = Type.String({ minLength: 1, maxLength: 1024 });

export const AuthorizationClassSchema = Type.Union([
  Type.Literal('NONE'),
  Type.Literal('MODE_A'),
  Type.Literal('MODE_B'),
  Type.Literal('MODE_C'),
]);
export const ExecutionKindSchema = Type.Union([
  Type.Literal('DIRECT_TRANSACTION'),
  Type.Literal('SIGNED_INTENT'),
]);
export const EnforcementSchema = Type.Literal('NOT_ENFORCED');

export const AssetSchema = Type.Union([
  strictObject({
    chainId: ChainIdSchema,
    address: AddressSchema,
    decimals: Type.Integer({ minimum: 0, maximum: 255 }),
  }),
  strictObject({
    chainId: ChainIdSchema,
    nativeId: IdentifierSchema,
    decimals: Type.Integer({ minimum: 0, maximum: 255 }),
  }),
]);
export type Asset = Static<typeof AssetSchema>;

export const QuantitySchema = strictObject({
  asset: AssetSchema,
  amount: NativeUnitsSchema,
});
export const AccountSchema = strictObject({
  chainId: ChainIdSchema,
  address: AddressSchema,
});
export const VersionReferenceSchema = strictObject({
  id: IdentifierSchema,
  version: SchemaVersionSchema,
});
export const ContractReferenceSchema = strictObject({
  chainId: ChainIdSchema,
  address: AddressSchema,
  version: IdentifierSchema,
});
export const FunctionReferenceSchema = strictObject({
  chainId: ChainIdSchema,
  contract: AddressSchema,
  functionId: IdentifierSchema,
});
export const OutputReferenceSchema = strictObject({
  nodeId: IdentifierSchema,
  outputId: IdentifierSchema,
});

export const ParameterSchema = Type.Union([
  strictObject({
    name: IdentifierSchema,
    kind: Type.Literal('QUANTITY'),
    value: QuantitySchema,
  }),
  strictObject({
    name: IdentifierSchema,
    kind: Type.Literal('ACCOUNT'),
    value: AccountSchema,
  }),
  strictObject({
    name: IdentifierSchema,
    kind: Type.Literal('ASSET'),
    value: AssetSchema,
  }),
  strictObject({
    name: IdentifierSchema,
    kind: Type.Literal('IDENTIFIER'),
    value: IdentifierSchema,
  }),
  strictObject({
    name: IdentifierSchema,
    kind: Type.Literal('INTEGER'),
    value: SafeIntegerSchema,
  }),
  strictObject({
    name: IdentifierSchema,
    kind: Type.Literal('BOOLEAN'),
    value: Type.Boolean(),
  }),
  strictObject({
    name: IdentifierSchema,
    kind: Type.Literal('OUTPUT_REFERENCE'),
    value: OutputReferenceSchema,
  }),
]);

export const OutputSchema = strictObject({
  outputId: IdentifierSchema,
  asset: AssetSchema,
  minimumAmount: NativeUnitsSchema,
});
export const ConstraintSchema = Type.Union([
  strictObject({
    kind: Type.Literal('MAXIMUM_INPUT'),
    quantity: QuantitySchema,
  }),
  strictObject({
    kind: Type.Literal('MINIMUM_OUTPUT'),
    quantity: QuantitySchema,
  }),
  strictObject({
    kind: Type.Literal('MAXIMUM_SLIPPAGE_BPS'),
    maximumBps: BasisPointsSchema,
  }),
]);
export const EditableBoundSchema = strictObject({
  parameterName: IdentifierSchema,
  asset: AssetSchema,
  minimumAmount: NativeUnitsSchema,
  maximumAmount: NativeUnitsSchema,
});
export const FailurePolicySchema = Type.Union([
  Type.Literal('ABORT'),
  Type.Literal('RETRY'),
  Type.Literal('REQUOTE_WITHIN_LIMITS'),
  Type.Literal('PAUSE_FOR_APPROVAL'),
  Type.Literal('CANCEL_IF_AVAILABLE'),
  Type.Literal('REQUEST_REFUND'),
  Type.Literal('COMPENSATE'),
]);
export const FreshnessSchema = strictObject({
  observedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  maximumAgeSeconds: SafeIntegerSchema,
});
export const UncertaintySchema = strictObject({
  code: IdentifierSchema,
  description: NoteSchema,
});

export const BudgetSchema = strictObject({
  asset: AssetSchema,
  maximumAmount: NativeUnitsSchema,
});
export const SpendLimitSchema = strictObject({
  asset: AssetSchema,
  maximumAmount: NativeUnitsSchema,
  maximumPerStepAmount: NativeUnitsSchema,
  maximumCumulativeAmount: NativeUnitsSchema,
});

export const ProviderPolicySchema = Type.Union([
  strictObject({
    kind: Type.Literal('FIXED'),
    providerId: IdentifierSchema,
  }),
  strictObject({
    kind: Type.Literal('AUTHORIZED_SET'),
    providerIds: Type.Array(IdentifierSchema, {
      minItems: 1, maxItems: 128, uniqueItems: true,
    }),
  }),
]);

export const OracleRuleSchema = strictObject({
  oracleId: IdentifierSchema,
  baseAsset: AssetSchema,
  quoteAsset: AssetSchema,
  maximumAgeSeconds: SafeIntegerSchema,
  maximumDeviationBps: BasisPointsSchema,
});
export const AccountRiskRuleSchema = strictObject({
  account: AccountSchema,
  minimumHealthFactorNumerator: NativeUnitsSchema,
  minimumHealthFactorDenominator: NonzeroNativeUnitsSchema,
  maximumLtvBps: BasisPointsSchema,
  maximumExposure: list(QuantitySchema, 128),
  oracleId: IdentifierSchema,
  checkpointId: IdentifierSchema,
});
export const CheckpointRuleSchema = strictObject({
  checkpointId: IdentifierSchema,
  beforeNodeId: IdentifierSchema,
  maximumSlippageBps: BasisPointsSchema,
  minimumOutputs: list(QuantitySchema, 128),
});
export const RecoverySchema = strictObject({
  failurePolicy: FailurePolicySchema,
  residualAssetRecipient: AccountSchema,
  maximumAttemptsPerStep: PositiveIntegerSchema,
  requiresHumanReview: Type.Literal(true),
});
export const AllowlistSchema = strictObject({
  owners: list(AccountSchema, 128),
  accounts: list(AccountSchema, 128),
  recipients: list(AccountSchema, 128),
  chains: Type.Array(IdentifierSchema, { maxItems: 128, uniqueItems: true }),
  adapters: list(VersionReferenceSchema, 128),
  protocols: Type.Array(IdentifierSchema, { maxItems: 128, uniqueItems: true }),
  contracts: list(ContractReferenceSchema, 128),
  functions: list(FunctionReferenceSchema, 256),
});

export const RuntimeStateSchema = Type.Union([
  Type.Literal('DRAFT'),
  Type.Literal('REVIEWED'),
  Type.Literal('SIMULATED'),
  Type.Literal('AUTHORIZED'),
  Type.Literal('EXECUTING'),
  Type.Literal('RECONCILING'),
  Type.Literal('COMPLETED'),
  Type.Literal('PAUSED'),
  Type.Literal('RECOVERY_REQUIRED'),
  Type.Literal('PARTIALLY_COMPLETED'),
  Type.Literal('FAILED'),
  Type.Literal('EXPIRED'),
  Type.Literal('CANCELLED'),
  Type.Literal('PLANNED'),
  Type.Literal('READY'),
  Type.Literal('PREPARED'),
  Type.Literal('SUBMITTING'),
  Type.Literal('SUBMISSION_RESULT_UNKNOWN'),
  Type.Literal('PENDING'),
  Type.Literal('CONFIRMED'),
  Type.Literal('REVERTED'),
  Type.Literal('NOT_FOUND'),
  Type.Literal('PARTIALLY_FILLED'),
  Type.Literal('SETTLED'),
  Type.Literal('REFUND_PENDING'),
  Type.Literal('REFUNDED'),
  Type.Literal('RECONCILIATION_REQUIRED'),
]);

export const MAX_NATIVE_UNITS = (1n << 256n) - 1n;
