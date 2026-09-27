// SPDX-License-Identifier: AGPL-3.0-only
/** Finite local-fork Safe 1.4.1 + Roles 2.1.0 transaction compiler. No signer lives here. */
import { keccak_256 } from '@noble/hashes/sha3.js';
import { hashModeBPermission } from '@defi-workflow-engine/workflow-contracts';
import { encodeApprove, encodeSwap, SWAP_ROUTER_02, type SwapArguments } from './abi.js';

const encoder = new TextEncoder();
const hex = (bytes: Uint8Array): string => '0x' + Buffer.from(bytes).toString('hex');
const raw = (value: string): Uint8Array => {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) throw new Error('MODE_B_HEX_INVALID');
  return Uint8Array.from(Buffer.from(value.slice(2), 'hex'));
};
const join = (...parts: Uint8Array[]): Uint8Array => Uint8Array.from(Buffer.concat(parts.map(part => Buffer.from(part))));
const word = (value: bigint): Uint8Array => {
  if (value < 0n || value >= 1n << 256n) throw new Error('MODE_B_WORD_INVALID');
  return raw('0x' + value.toString(16).padStart(64, '0'));
};
const address = (value: string): Uint8Array => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error('MODE_B_ADDRESS_INVALID');
  return join(new Uint8Array(12), raw(value));
};
const bytes4 = (value: string): Uint8Array => {
  if (!/^0x[0-9a-fA-F]{8}$/.test(value)) throw new Error('MODE_B_SELECTOR_INVALID');
  return join(raw(value), new Uint8Array(28));
};
const bytes32 = (value: string): Uint8Array => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error('MODE_B_BYTES32_INVALID');
  return raw(value);
};
const dynamic = (bytes: Uint8Array): Uint8Array => join(word(BigInt(bytes.length)), bytes, new Uint8Array((32 - bytes.length % 32) % 32));
const selector = (signature: string): Uint8Array => keccak_256(encoder.encode(signature)).slice(0, 4);
const call = (signature: string, payload: Uint8Array): string => hex(join(selector(signature), payload));
const key = (domain: string, salt: string): string => hex(keccak_256(join(encoder.encode(domain), bytes32(salt))));
const condition = (parent: number, paramType: number, operator: number, compValue: Uint8Array) => ({ parent, paramType, operator, compValue });
function conditionTuple(item: ReturnType<typeof condition>): Uint8Array {
  return join(word(BigInt(item.parent)), word(BigInt(item.paramType)), word(BigInt(item.operator)), word(128n), dynamic(item.compValue));
}
function conditionArray(items: ReturnType<typeof condition>[]): Uint8Array {
  const tails = items.map(conditionTuple);
  let offset = BigInt(32 * items.length);
  const offsets = tails.map(tail => { const at = word(offset); offset += BigInt(tail.length); return at; });
  return join(word(BigInt(items.length)), ...offsets, ...tails);
}
/** ABI top-level bytes[] preimage. Roles Packer strips the outer offset before hashing EqualTo. */
function bytesArrayPreimage(items: Uint8Array[]): Uint8Array {
  let offset = BigInt(32 * items.length);
  const values = items.map(dynamic);
  const offsets = values.map(value => { const at = word(offset); offset += BigInt(value.length); return at; });
  return join(word(32n), word(BigInt(items.length)), ...offsets, ...values);
}
export type ModeBProfile = {
  readonly chainId: 31337; readonly safe: string; readonly roles: string; readonly owner: string;
  readonly executor: string; readonly safeCodeHash: string; readonly rolesCodeHash: string;
  readonly semanticWorkflowHash: string; readonly quoteHash: string; readonly simulationHash: string; readonly sourceBlockHash: string;
};
export type ModeBCompiled = {
  readonly permission: Record<string, string | number>; readonly permissionHash: string;
  readonly swapCalldata: string; readonly roleKey: string; readonly allowanceKey: string;
  readonly installation: readonly { readonly label: string; readonly to: string; readonly data: string; readonly from: string }[];
  readonly executorCall: { readonly to: string; readonly data: string; readonly value: '0x0' };
  readonly revocation: readonly { readonly label: string; readonly to: string; readonly data: string; readonly from: string }[];
};
const norm = (value: string): string => value.toLowerCase();
export function compileModeB(profile: ModeBProfile, swap: SwapArguments, salt: string,
  setup: { readonly rolesOwnerIsSafe?: boolean; readonly moduleEnabled?: boolean } = {}): ModeBCompiled {
  if (profile.chainId !== 31337 || norm(profile.owner) === norm(profile.executor) || swap.amountIn <= 0n || swap.deadline <= 0n) throw new Error('MODE_B_PROFILE_INVALID');
  const roleKey = key('gryloo/mode-b/role/1', salt);
  const allowanceKey = key('gryloo/mode-b/allowance/1', salt);
  const swapBytes = encodeSwap(swap);
  const inner = swapBytes.slice(164, 392);
  if (inner.length !== 228) throw new Error('MODE_B_SWAP_INVALID');
  const conditions = [
    condition(0, 5, 5, new Uint8Array()), // Calldata Matches
    condition(0, 1, 16, word(swap.deadline)), // exact protocol deadline
    condition(0, 4, 16, bytesArrayPreimage([inner])), // exact nested swap parameters
    condition(0, 0, 30, bytes32(allowanceKey)), // one non-refilling call
    condition(2, 2, 0, new Uint8Array()), // dynamic bytes array element type
  ];
  const scopeTarget = call('scopeTarget(bytes32,address)', join(bytes32(roleKey), address(SWAP_ROUTER_02)));
  const scopeFunction = call('scopeFunction(bytes32,address,bytes4,(uint8,uint8,uint8,bytes)[],uint8)', join(
    bytes32(roleKey), address(SWAP_ROUTER_02), bytes4('0x5ae401dc'), word(160n), word(0n), conditionArray(conditions)));
  const setAllowance = call('setAllowance(bytes32,uint128,uint128,uint128,uint64,uint64)', join(bytes32(allowanceKey), word(1n), word(0n), word(0n), word(0n), word(0n)));
  const assignRoles = call('assignRoles(address,bytes32[],bool[])', join(address(profile.executor), word(96n), word(160n), word(1n), bytes32(roleKey), word(1n), word(1n)));
  const enableModule = call('enableModule(address)', address(profile.roles));
  const disableModule = call('disableModule(address,address)', join(address('0x0000000000000000000000000000000000000001'), address(profile.roles)));
  const unassignRoles = call('assignRoles(address,bytes32[],bool[])', join(address(profile.executor), word(96n), word(160n), word(1n), bytes32(roleKey), word(1n), word(0n)));
  const executorCall = call('execTransactionWithRole(address,uint256,bytes,uint8,bytes32,bool)', join(
    address(SWAP_ROUTER_02), word(0n), word(192n), word(0n), bytes32(roleKey), word(1n), dynamic(swapBytes)));
  const permission = {
    format: 'gryloo.mode-b-permission.v1', chainId: 31337, safe: norm(profile.safe), roles: norm(profile.roles), owner: norm(profile.owner), threshold: 1,
    rolesOwner: norm(profile.safe), executor: norm(profile.executor), roleKey, router: norm(SWAP_ROUTER_02), selector: '0x5ae401dc', callData: hex(swapBytes),
    tokenIn: norm(swap.tokenIn), tokenOut: norm(swap.tokenOut), recipient: norm(swap.recipient), amountIn: swap.amountIn.toString(),
    amountOutMinimum: swap.amountOutMinimum.toString(), cumulativeBudget: swap.amountIn.toString(), allowanceKey,
    deadline: swap.deadline.toString(), safeCodeHash: profile.safeCodeHash, rolesCodeHash: profile.rolesCodeHash,
    semanticWorkflowHash: profile.semanticWorkflowHash, quoteHash: profile.quoteHash, simulationHash: profile.simulationHash, sourceBlockHash: profile.sourceBlockHash,
    revocationMethod: 'ROLES_REMOVE_AND_SAFE_DISABLE',
  };
  const ownerTx = (label: string, to: string, data: string) => ({ label, to, data, from: profile.owner });
  return {
    permission, permissionHash: hashModeBPermission(permission), swapCalldata: hex(swapBytes), roleKey, allowanceKey,
    installation: [
      ...setup.rolesOwnerIsSafe ? [] : [ownerTx('Transfer Roles ownership to Safe', profile.roles,
        call('transferOwnership(address)', address(profile.safe)))],
      ...setup.moduleEnabled ? [] : [ownerTx('Enable Roles module in Safe', profile.safe,
        encodeSafeOwnerCall(profile.safe, profile.owner, profile.safe, enableModule))],
      ownerTx('Scope Router02 target through Safe', profile.safe, encodeSafeOwnerCall(profile.safe, profile.owner, profile.roles, scopeTarget)),
      ownerTx('Install exact scoped function through Safe', profile.safe, encodeSafeOwnerCall(profile.safe, profile.owner, profile.roles, scopeFunction)),
      ownerTx('Set one-time non-refilling allowance through Safe', profile.safe, encodeSafeOwnerCall(profile.safe, profile.owner, profile.roles, setAllowance)),
      ownerTx('Assign executor role through Safe', profile.safe, encodeSafeOwnerCall(profile.safe, profile.owner, profile.roles, assignRoles)),
      ownerTx('Approve finite Router02 token allowance from Safe', profile.safe, encodeSafeOwnerCall(profile.safe, profile.owner, swap.tokenIn, hex(encodeApprove(SWAP_ROUTER_02, swap.amountIn))))],
    executorCall: { to: profile.roles, data: executorCall, value: '0x0' },
    revocation: [ownerTx('Remove executor role through Safe', profile.safe, encodeSafeOwnerCall(profile.safe, profile.owner, profile.roles, unassignRoles)),
      ownerTx('Disable executor module in Roles through Safe', profile.safe, encodeSafeOwnerCall(profile.safe, profile.owner, profile.roles,
        call('disableModule(address,address)', join(address('0x0000000000000000000000000000000000000001'), address(profile.executor))))),
      ownerTx('Disable Roles module in Safe', profile.safe, encodeSafeOwnerCall(profile.safe, profile.owner, profile.safe, disableModule)),
      ownerTx('Clear residual Router02 token allowance from Safe', profile.safe, encodeSafeOwnerCall(profile.safe, profile.owner, swap.tokenIn, hex(encodeApprove(SWAP_ROUTER_02, 0n))))],
  };
}
/** Safe owner submits this transaction; v=1 approved-hash signature is valid only for msg.sender owner. */
export function encodeSafeOwnerCall(safe: string, owner: string, to: string, data: string): string {
  address(safe); // validation
  const payload = dynamic(raw(data));
  const signature = join(address(owner), word(0n), Uint8Array.of(1));
  return call('execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)', join(
    address(to), word(0n), word(320n), word(0n), word(0n), word(0n), word(0n), address('0x0000000000000000000000000000000000000000'),
    address('0x0000000000000000000000000000000000000000'), word(BigInt(320 + payload.length)), payload, dynamic(signature)));
}
/** Ethereum runtime-code hash for exact on-fork pin comparison. */
export function modeBCodeHash(code: string): string { return hex(keccak_256(raw(code))); }
