import { Type, type Static } from '@sinclair/typebox';
import {
  artifactObject, strictObject, IdentifierSchema, HashSchema, NativeUnitsSchema, NoteSchema,
} from './common.js';

const EvmAddress = Type.String({ pattern: '^0x[0-9a-f]{40}$' });
const Selector = Type.String({ pattern: '^0x[0-9a-f]{8}$' });
const PayloadArguments = Type.Union([
  strictObject({
    kind: Type.Literal('APPROVE'),
    spender: EvmAddress,
    amount: NativeUnitsSchema,
  }),
  strictObject({
    kind: Type.Literal('EXACT_INPUT_SINGLE'),
    tokenIn: EvmAddress,
    tokenOut: EvmAddress,
    fee: Type.Union([Type.Literal(100), Type.Literal(500), Type.Literal(3000), Type.Literal(10000)]),
    recipient: EvmAddress,
    amountIn: NativeUnitsSchema,
    amountOutMinimum: NativeUnitsSchema,
    sqrtPriceLimitX96: Type.Literal('0'),
    deadline: NativeUnitsSchema,
  }),
]);

export const EnforcementMatrixSchema = artifactObject('enforcement-matrix', {
  enforcementMatrixId: IdentifierSchema,
  semanticWorkflowHash: HashSchema,
  artifactSetHash: HashSchema,
  simulationHash: HashSchema,
  policyHash: HashSchema,
  manifestHash: HashSchema,
  executionPlanHash: HashSchema,
  authorizationMode: Type.Literal('MODE_A'),
  environment: strictObject({
    evidenceEnvironment: Type.Literal('FORK_REPRODUCED'),
    executionChainId: Type.Literal('eip155:31337'),
    sourceChainId: Type.Literal('eip155:8453'),
    sourceBlock: strictObject({
      height: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
      hash: HashSchema,
    }),
    stateSourceHash: HashSchema,
    simulationRawHash: HashSchema,
  }),
  payloads: Type.Array(strictObject({
    stepId: IdentifierSchema,
    payloadHash: HashSchema,
    payloadProfile: Type.Literal('EVM_EIP1559_UNSIGNED_V1'),
    chainId: Type.Literal(31337),
    from: EvmAddress,
    nonce: NativeUnitsSchema,
    to: EvmAddress,
    value: Type.Literal('0'),
    functionId: Selector,
    gasLimit: NativeUnitsSchema,
    maxFeePerGas: NativeUnitsSchema,
    maxPriorityFeePerGas: NativeUnitsSchema,
    arguments: PayloadArguments,
  }), { minItems: 1, maxItems: 2 }),
  limits: Type.Array(strictObject({
    limitId: IdentifierSchema,
    description: NoteSchema,
    value: Type.String({ minLength: 1, maxLength: 1024 }),
    locations: Type.Array(Type.Union([
      Type.Literal('EXACT_SIGNED_PAYLOAD'),
      Type.Literal('APPLICATION_GATEWAY'),
      Type.Literal('INTENT_PROTOCOL'),
      Type.Literal('SMART_ACCOUNT_MODULE_OR_GUARD'),
      Type.Literal('PROTOCOL_VERIFIER'),
      Type.Literal('MONITOR_ONLY'),
      Type.Literal('NOT_ENFORCED'),
    ]), { minItems: 1, maxItems: 7, uniqueItems: true }),
    payloadBindings: Type.Array(strictObject({
      stepId: IdentifierSchema,
      field: IdentifierSchema,
    }), { maxItems: 32 }),
  }), { minItems: 1, maxItems: 128 }),
  limitations: Type.Array(NoteSchema, { maxItems: 64 }),
});
export type EnforcementMatrix = Static<typeof EnforcementMatrixSchema>;
