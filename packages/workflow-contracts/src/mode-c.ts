// SPDX-License-Identifier: Apache-2.0
/** BUILD-016 additive authority profile; no change to frozen artifact/hash semantics. */
import { canonicalJson, hashRawBytes, hashArtifactValue } from './canonical.js';
import { validateArtifact } from './schemas.js';
import type { QuoteStateArtifact } from './quote-state.js';
import type { StrategyManifest } from './strategy-manifest.js';
import type { ExecutionPlan } from './execution-plan.js';
export type ModeCManifest = Omit<StrategyManifest, 'schemaVersion' | 'enforcement'> & {
  readonly schemaVersion: '2.0.0'; readonly enforcement: 'SMART_ACCOUNT_MODULE_OR_GUARD' };
export type ModeCExecutionPlan = Omit<ExecutionPlan, 'schemaVersion' | 'enforcement'> & {
  readonly schemaVersion: '2.0.0'; readonly enforcement: 'SMART_ACCOUNT_MODULE_OR_GUARD' };

export const MODE_C_SOURCE = 'build016.uniswap-v3-pool-state';
export const MODE_C_VERIFIER = 'build016.buy-dip.roles-condition.v1';
export const MODE_C_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
export const MODE_C_WETH = '0x4200000000000000000000000000000000000006';
export const MODE_C_FACTORY = '0x33128a8fc17869897dce68ed026d694621f6fdfd';
export const MODE_C_ROUTER = '0x2626664c2603336e57b271c5c0b26f421741e481';
export type ModeCPolicy = {
  readonly format: 'gryloo.mode-c-buy-dip.v1'; readonly chainId: 31337;
  readonly semanticWorkflowHash: string; readonly artifactSetHash: string; readonly simulationHash: string;
  readonly permissionHash: string; readonly owner: string; readonly executor: string;
  readonly safe: string; readonly roles: string; readonly roleKey: string; readonly allowanceKey: string;
  readonly tokenIn: typeof MODE_C_USDC; readonly tokenOut: typeof MODE_C_WETH;
  readonly router: typeof MODE_C_ROUTER; readonly functionId: '0x5ae401dc'; readonly recipient: string;
  readonly swapCalldata: string; readonly executorCalldata: string;
  readonly maximumSwapAmount: string; readonly totalBudget: string; readonly perPeriodBudget: string;
  readonly minimumOut: string; readonly maximumSlippageBps: number;
  readonly triggerDropBps: 500; readonly maximumExecutions: 1; readonly maximumPerPeriod: 1;
  readonly periodSeconds: number; readonly frequencySeconds: number; readonly cooldownSeconds: number;
  readonly startsAt: number; readonly expiresAt: number; readonly revocationEpoch: number;
  readonly revocation: 'ROLES_REMOVE_AND_SAFE_DISABLE';
  readonly source: { readonly id: typeof MODE_C_SOURCE; readonly pool: string; readonly poolCodeHash: string;
    readonly factory: typeof MODE_C_FACTORY; readonly fee: 500; readonly maximumAgeSeconds: number };
  readonly reference: QuoteStateArtifact; readonly referenceHash: string;
  readonly verifier: { readonly id: typeof MODE_C_VERIFIER; readonly address: string; readonly templateHash: string; readonly runtimeHash:string };
};
/** Serialization only for the additive BUILD-016 envelope; frozen public surfaces stay unchanged. */
export const serializeModeC = (value: unknown): string => canonicalJson(value);
const fields = ['format','chainId','semanticWorkflowHash','artifactSetHash','simulationHash','permissionHash',
  'owner','executor','safe','roles','roleKey','allowanceKey','tokenIn','tokenOut','router','functionId','recipient',
  'swapCalldata','executorCalldata','maximumSwapAmount','totalBudget','perPeriodBudget','minimumOut','maximumSlippageBps',
  'triggerDropBps','maximumExecutions','maximumPerPeriod','periodSeconds','frequencySeconds','cooldownSeconds',
  'startsAt','expiresAt','revocationEpoch','revocation','source','reference','referenceHash','verifier'];
export const modeCCommitment = (kind: string, value: unknown): string =>
  hashRawBytes('intent', new TextEncoder().encode(canonicalJson({ format: `gryloo.build016.${kind}.v1`, value })));
const hash = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v);
const address = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-f]{40}$/.test(v);
const quantity = (v: unknown): v is string => typeof v === 'string' && /^[1-9][0-9]{0,76}$/.test(v) && BigInt(v) < 1n << 256n;
const keys = (v: object, names: readonly string[]) => Object.keys(v).sort().join() === [...names].sort().join();
export function validateModeCPolicy(input: unknown): ModeCPolicy {
  canonicalJson(input); // rejects getters, non-JSON values and noncanonical object shapes
  if (!input || typeof input !== 'object' || Array.isArray(input) || !keys(input, fields)) throw new Error('MODE_C_POLICY_INVALID');
  const p = input as ModeCPolicy;
  if (p.format !== 'gryloo.mode-c-buy-dip.v1' || p.chainId !== 31337 || p.tokenIn !== MODE_C_USDC || p.tokenOut !== MODE_C_WETH ||
    p.router !== MODE_C_ROUTER || p.functionId !== '0x5ae401dc' || p.triggerDropBps !== 500 || p.maximumExecutions !== 1 ||
    p.maximumPerPeriod !== 1 || p.recipient !== p.safe || p.owner === p.executor ||
    p.revocation !== 'ROLES_REMOVE_AND_SAFE_DISABLE') throw new Error('MODE_C_POLICY_INVALID');
  for (const v of [p.owner,p.executor,p.safe,p.roles,p.recipient,p.verifier?.address,p.source?.pool])
    if (!address(v)) throw new Error('MODE_C_POLICY_INVALID');
  for (const v of [p.semanticWorkflowHash,p.artifactSetHash,p.simulationHash,p.permissionHash,p.roleKey,p.allowanceKey,
    p.referenceHash,p.verifier?.templateHash,p.verifier?.runtimeHash,p.source?.poolCodeHash]) if (!hash(v)) throw new Error('MODE_C_POLICY_INVALID');
  for (const v of [p.maximumSwapAmount,p.totalBudget,p.perPeriodBudget,p.minimumOut])
    if (!quantity(v)) throw new Error('MODE_C_POLICY_INVALID');
  if (BigInt(p.maximumSwapAmount) > BigInt(p.totalBudget) || BigInt(p.maximumSwapAmount) > BigInt(p.perPeriodBudget) ||
    !Number.isSafeInteger(p.maximumSlippageBps) || p.maximumSlippageBps < 0 || p.maximumSlippageBps > 300)
    throw new Error('MODE_C_POLICY_INVALID');
  for (const v of [p.startsAt,p.expiresAt,p.periodSeconds,p.frequencySeconds,p.cooldownSeconds,p.revocationEpoch,p.source?.maximumAgeSeconds])
    if (!Number.isSafeInteger(v) || v < 0) throw new Error('MODE_C_POLICY_INVALID');
  if (p.expiresAt <= p.startsAt || p.periodSeconds < 1 || p.frequencySeconds < 1 || p.source.maximumAgeSeconds < 1 ||
    p.source.maximumAgeSeconds > 60 || p.expiresAt > 8_640_000_000_000 ||
    p.source.id !== MODE_C_SOURCE || p.source.factory !== MODE_C_FACTORY || p.source.fee !== 500 ||
    !keys(p.source, ['id','pool','poolCodeHash','factory','fee','maximumAgeSeconds']) ||
    p.verifier.id !== MODE_C_VERIFIER || !keys(p.verifier, ['id','address','templateHash','runtimeHash'])) throw new Error('MODE_C_POLICY_INVALID');
  for (const v of [p.swapCalldata,p.executorCalldata]) if (!/^0x(?:[0-9a-f]{2})+$/.test(v)) throw new Error('MODE_C_POLICY_INVALID');
  if (hashArtifactValue('quote-state-artifact', p.reference) !== p.referenceHash)
    throw new Error('MODE_C_REFERENCE_MISMATCH');
  const ref = readModeCPoolObservation(p.reference, p);
  if (ref.observedAt > p.startsAt) throw new Error('MODE_C_REFERENCE_MISMATCH');
  return JSON.parse(canonicalJson(p)) as ModeCPolicy;
}
export function hashModeCPolicy(p: unknown): string { return modeCCommitment('policy', validateModeCPolicy(p)); }

/** Read only this separate authorizing profile. Never accepts the Base observation profile. */
export function readModeCPoolObservation(input: unknown, p: Pick<ModeCPolicy, 'source' | 'semanticWorkflowHash'>) {
  const a = validateArtifact('quote-state-artifact', input);
  if (a.sourceId !== MODE_C_SOURCE || a.adapter.id !== 'uniswap-v3.pool-state.build016' || a.adapter.version !== '1.0.0')
    throw new Error('MODE_C_WRONG_SOURCE');
  if (a.chainId !== 'eip155:31337' || a.chainPosition.kind !== 'BLOCK' || a.semanticWorkflowHash !== p.semanticWorkflowHash ||
    a.registryValidation.result !== 'CONTRACT_VALIDATED') throw new Error('MODE_C_OBSERVATION_INVALID');
  const values = new Map(a.normalizedValues.map(v => [v.name, v]));
  const names = ['pool','pool-code-hash','factory','token0','token1','fee','sqrt-price-x96','block-hash'];
  if (values.size !== names.length || !names.every(n => values.has(n)) || a.normalizedValues.length !== names.length)
    throw new Error('MODE_C_OBSERVATION_INVALID');
  const id = (n: string) => { const v = values.get(n); return v?.kind === 'IDENTIFIER' ? v.value : null; };
  const fee = values.get('fee');
  if (id('pool') !== p.source.pool || id('pool-code-hash') !== p.source.poolCodeHash || id('factory') !== MODE_C_FACTORY ||
    id('token0') !== MODE_C_WETH || id('token1') !== MODE_C_USDC || fee?.kind !== 'INTEGER' || fee.value !== 500)
    throw new Error('MODE_C_POOL_MISMATCH');
  const sqrt = id('sqrt-price-x96'), blockHash = id('block-hash');
  if (!quantity(sqrt) || BigInt(sqrt) <= 4295128739n || BigInt(sqrt) >= 1n << 120n || !hash(blockHash))
    throw new Error('MODE_C_OBSERVATION_INVALID');
  const observedAt = Date.parse(a.freshness.observedAt) / 1000, expiresAt = Date.parse(a.freshness.expiresAt) / 1000;
  const retrievedAt = Date.parse(a.retrievedAt) / 1000;
  if (![observedAt,expiresAt,retrievedAt].every(Number.isSafeInteger) || retrievedAt < observedAt ||
    a.freshness.maximumAgeSeconds !== p.source.maximumAgeSeconds || expiresAt !== observedAt + p.source.maximumAgeSeconds)
    throw new Error('MODE_C_OBSERVATION_INVALID');
  return { artifact: a, sqrt: BigInt(sqrt), observedAt, expiresAt, retrievedAt, blockHash,
    blockNumber: a.chainPosition.height, hash: hashArtifactValue('quote-state-artifact', a) };
}
/** Rational boundary test, no floats; decimals cancel for the same immutable pair. */
export function modeCDipEligible(observedNumerator: bigint, observedDenominator: bigint, referenceNumerator: bigint, referenceDenominator: bigint): boolean {
  if ([observedNumerator,observedDenominator,referenceNumerator,referenceDenominator].some(v => v <= 0n))
    throw new Error('MODE_C_PRICE_INVALID');
  return observedNumerator * referenceDenominator * 100n <= referenceNumerator * observedDenominator * 95n;
}
export function validateModeCManifest(p: ModeCPolicy, input: unknown): ModeCManifest {
  canonicalJson(input);
  if (!input || typeof input !== 'object' || !('schemaVersion' in input) || input.schemaVersion !== '2.0.0' ||
    !('enforcement' in input) || input.enforcement !== 'SMART_ACCOUNT_MODULE_OR_GUARD') throw new Error('MODE_C_MANIFEST_INVALID');
  // Validate shared field shapes without changing or hashing a frozen v1 artifact.
  validateArtifact('strategy-manifest', { ...input, schemaVersion:'1.0.0', enforcement:'NOT_ENFORCED' });
  const m = input as ModeCManifest;
  if (m.authorizationMode !== 'MODE_C' || m.policyHash !== hashModeCPolicy(p) || m.semanticWorkflowHash !== p.semanticWorkflowHash ||
    m.artifactSetHash !== p.artifactSetHash || m.simulationHash !== p.simulationHash || m.owner.chainId !== 'eip155:31337' ||
    m.owner.address !== p.owner || m.executor?.chainId !== 'eip155:31337' || m.executor.address !== p.executor ||
    Date.parse(m.expiresAt) / 1000 !== p.expiresAt || m.revocationEpoch !== p.revocationEpoch ||
    m.maximumSlippageBps !== p.maximumSlippageBps || m.providers.kind !== 'FIXED' || m.providers.providerId !== MODE_C_SOURCE ||
    m.recovery.failurePolicy !== 'ABORT' || m.recovery.maximumAttemptsPerStep !== 1 || !m.recovery.requiresHumanReview ||
    m.recovery.residualAssetRecipient.chainId !== 'eip155:31337' || m.recovery.residualAssetRecipient.address !== p.safe || m.spendLimits.length !== 1 ||
    m.spendLimits[0]?.asset.chainId !== 'eip155:31337' || !('address' in m.spendLimits[0].asset) ||
    m.spendLimits[0].asset.address !== MODE_C_USDC || m.spendLimits[0].asset.decimals !== 6 ||
    m.spendLimits[0].maximumAmount !== p.totalBudget || m.spendLimits[0].maximumPerStepAmount !== p.maximumSwapAmount ||
    m.spendLimits[0].maximumCumulativeAmount !== p.totalBudget || m.enforcement !== 'SMART_ACCOUNT_MODULE_OR_GUARD')
    throw new Error('MODE_C_MANIFEST_MISMATCH');
  return m;
}
export function hashModeCManifest(p: ModeCPolicy, m: unknown): string {
  return modeCCommitment('strategy-manifest', validateModeCManifest(p,m));
}
export function validateModeCExecutionPlan(p: ModeCPolicy, m: ModeCManifest, input: unknown): ModeCExecutionPlan {
  canonicalJson(input);
  if (!input || typeof input !== 'object' || !('schemaVersion' in input) || input.schemaVersion !== '2.0.0' ||
    !('enforcement' in input) || input.enforcement !== 'SMART_ACCOUNT_MODULE_OR_GUARD') throw new Error('MODE_C_PLAN_INVALID');
  validateArtifact('execution-plan',{...input,schemaVersion:'1.0.0',enforcement:'NOT_ENFORCED'});
  const plan = input as ModeCExecutionPlan;
  if (plan.manifestHash !== hashModeCManifest(p,m) || plan.semanticWorkflowHash !== p.semanticWorkflowHash ||
    plan.segments.length !== 1 || plan.segments[0]?.chainId !== 'eip155:31337' || plan.segments[0].steps.length !== 1 ||
    plan.segments[0].steps[0]?.requiredAuthorizationClass !== 'MODE_C' ||
    plan.segments[0].steps[0].executionKind !== 'DIRECT_TRANSACTION' ||
    plan.segments[0].steps[0].payloadHash !== hashRawBytes('payload',new Uint8Array(Buffer.from(p.executorCalldata.slice(2),'hex'))))
    throw new Error('MODE_C_PLAN_MISMATCH');
  return plan;
}
