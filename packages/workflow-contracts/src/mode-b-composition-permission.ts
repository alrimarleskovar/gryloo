import { canonicalJson, hashData } from './canonical.js';

const address = /^0x[0-9a-f]{40}$/;
const hash = /^0x[0-9a-f]{64}$/;
const quantity = /^(?:0|[1-9][0-9]*)$/;
const calldata = /^0x(?:[0-9a-f]{2})+$/;
const fields = [
  'format', 'chainId', 'safe', 'roles', 'owner', 'threshold', 'executor', 'sourceBlockHash',
  'safeCodeHash', 'rolesCodeHash', 'routerCodeHash', 'managerCodeHash', 'poolCodeHash',
  'semanticWorkflowHash', 'artifactSetHash', 'simulationHash', 'policyHash', 'manifestHash',
  'swapRoleKey', 'swapAllowanceKey', 'swapCalldata', 'swapInputUSDC', 'swapMinWETH', 'swapDeadline',
  'mintRoleKey', 'mintAllowanceKey', 'token0', 'token1', 'fee', 'tickLower', 'tickUpper',
  'recipient', 'maxWETH', 'maxUSDC', 'minWETH', 'minUSDC', 'mintDeadline', 'totalUSDCBudget',
  'revocationMethod',
] as const;
export type CompositionPermission = Record<(typeof fields)[number], string | number>;

/** Separate versioned binding. The onchain Roles installation, not this digest, enforces call bounds. */
export function hashModeBCompositionPermission(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype)
    throw new Error('COMPOSITION_PERMISSION_INVALID');
  const record = input as Record<string, unknown>;
  if (Object.keys(record).sort().join() !== [...fields].sort().join() ||
      record.format !== 'gryloo.mode-b-composition-permission.v1' || record.chainId !== 31337 ||
      record.threshold !== 1 || record.fee !== 500 ||
      record.revocationMethod !== 'ROLES_REMOVE_AND_SAFE_DISABLE') throw new Error('COMPOSITION_PERMISSION_INVALID');
  for (const field of ['safe', 'roles', 'owner', 'executor', 'token0', 'token1', 'recipient'] as const)
    if (typeof record[field] !== 'string' || !address.test(record[field])) throw new Error('COMPOSITION_PERMISSION_INVALID');
  if (record.owner === record.executor || record.recipient !== record.safe ||
      record.token0 !== '0x4200000000000000000000000000000000000006' ||
      record.token1 !== '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')
    throw new Error('COMPOSITION_PERMISSION_INVALID');
  for (const field of ['sourceBlockHash', 'safeCodeHash', 'rolesCodeHash', 'routerCodeHash', 'managerCodeHash', 'poolCodeHash',
    'semanticWorkflowHash', 'artifactSetHash', 'simulationHash', 'policyHash', 'manifestHash',
    'swapRoleKey', 'swapAllowanceKey', 'mintRoleKey', 'mintAllowanceKey'] as const)
    if (typeof record[field] !== 'string' || !hash.test(record[field])) throw new Error('COMPOSITION_PERMISSION_INVALID');
  if (record.swapRoleKey === record.mintRoleKey || record.swapAllowanceKey === record.mintAllowanceKey ||
      typeof record.swapCalldata !== 'string' || !calldata.test(record.swapCalldata)) throw new Error('COMPOSITION_PERMISSION_INVALID');
  for (const field of ['swapInputUSDC', 'swapMinWETH', 'swapDeadline', 'maxWETH', 'maxUSDC', 'minWETH',
    'minUSDC', 'mintDeadline', 'totalUSDCBudget'] as const)
    if (typeof record[field] !== 'string' || !quantity.test(record[field]) || BigInt(record[field]) >= (1n << 256n))
      throw new Error('COMPOSITION_PERMISSION_INVALID');
  for (const field of ['tickLower', 'tickUpper'] as const)
    if (typeof record[field] !== 'number' || !Number.isSafeInteger(record[field]) || Math.abs(record[field]) > 887272 || record[field] % 10 !== 0)
      throw new Error('COMPOSITION_PERMISSION_INVALID');
  if ((record.tickLower as number) >= (record.tickUpper as number) ||
      BigInt(record.swapInputUSDC as string) === 0n || BigInt(record.swapMinWETH as string) === 0n ||
      BigInt(record.maxWETH as string) === 0n || BigInt(record.maxUSDC as string) === 0n ||
      BigInt(record.minWETH as string) === 0n || BigInt(record.minUSDC as string) === 0n ||
      BigInt(record.minWETH as string) > BigInt(record.maxWETH as string) ||
      BigInt(record.minUSDC as string) > BigInt(record.maxUSDC as string) ||
      BigInt(record.swapInputUSDC as string) + BigInt(record.maxUSDC as string) > BigInt(record.totalUSDCBudget as string))
    throw new Error('COMPOSITION_PERMISSION_INVALID');
  return hashData('mode-b-composition-permission', new TextEncoder().encode(canonicalJson(record)));
}
