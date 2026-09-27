// SPDX-License-Identifier: AGPL-3.0-only
/** Browser-side exact liquidity payload check before each EIP-1193 wallet request. */
import { decodeUnsignedPayload, fromHex, toHex, encodeLiquidityCall, LIQUIDITY_USDC, LIQUIDITY_WETH, POSITION_MANAGER,
  type LiquidityCall } from '@defi-workflow-engine/reference-compiler';
import { hashArtifactBytes, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { liquidityDetails, type ReviewContext } from '@defi-workflow-engine/reference-linter';
import type { PreparedLiquidity } from '../server/liquidity-service';
import { browserPayloadHash, type BrowserRequest } from './eip1193';
const hex = (value: bigint) => `0x${value.toString(16)}`;
export type LiquidityReviewed = { readonly bytes: string; readonly payloadHash: string; readonly owner: string;
  readonly operation: string; readonly nonce: string; readonly gasLimit: string; readonly maxFeePerGas: string };
export type LiquidityVerified = { readonly payloadHash: string; readonly request: BrowserRequest; readonly selector: string;
  readonly target: string; readonly calldata: string };
function fail(code: string): never { throw new Error(code); }
/** The call is derived from the IR and independently reviewed local position state by the UI. */
export async function verifyLiquidityBrowserPayload(view: LiquidityReviewed, call: LiquidityCall): Promise<LiquidityVerified> {
  if (!/^0x(?:[0-9a-f]{2})+$/.test(view.bytes) || !/^0x[0-9a-f]{40}$/.test(view.owner) ||
    !/^0x[0-9a-f]{64}$/.test(view.payloadHash)) fail('LIQUIDITY_BROWSER_INPUT_INVALID');
  const bytes = fromHex(view.bytes);
  const decoded = decodeUnsignedPayload(bytes);
  const expected = encodeLiquidityCall(call);
  const payloadHash = await browserPayloadHash(bytes);
  if (payloadHash !== view.payloadHash || decoded.chainId !== 31337 || decoded.value !== 0n || decoded.accessList.length !== 0 ||
    decoded.nonce.toString() !== view.nonce || decoded.gasLimit.toString() !== view.gasLimit ||
    decoded.maxFeePerGas.toString() !== view.maxFeePerGas || decoded.maxPriorityFeePerGas !== 1_000_000n ||
    decoded.to !== expected.to || toHex(decoded.data) !== toHex(expected.data)) fail('LIQUIDITY_BROWSER_PAYLOAD_CHANGED');
  if (call.kind === 'APPROVE' && (!([LIQUIDITY_USDC, LIQUIDITY_WETH].includes(call.token)) || decoded.to !== call.token ||
    toHex(decoded.data).slice(0, 10) !== '0x095ea7b3')) fail('LIQUIDITY_BROWSER_APPROVAL_INVALID');
  if (call.kind !== 'APPROVE' && decoded.to !== POSITION_MANAGER) fail('LIQUIDITY_BROWSER_TARGET_INVALID');
  const request: BrowserRequest = { from: view.owner, to: decoded.to, nonce: hex(decoded.nonce), gas: hex(decoded.gasLimit),
    maxFeePerGas: hex(decoded.maxFeePerGas), maxPriorityFeePerGas: hex(decoded.maxPriorityFeePerGas), value: '0x0',
    data: toHex(decoded.data), chainId: '0x7a69', type: '0x2' };
  return { payloadHash, request, selector: request.data.slice(0, 10), target: request.to, calldata: request.data };
}

/** Bind the reviewed call to the current shared IR and independently observed before-state. */
export function liquidityCallFromReview(prepared: PreparedLiquidity, workflow: SemanticWorkflow, context: ReviewContext): LiquidityCall {
  const workflowHash = hashArtifactBytes('semantic-workflow', new TextEncoder().encode(JSON.stringify(workflow)));
  if (prepared.workflowHash !== workflowHash || prepared.revision !== workflow.revision ||
      prepared.owner !== prepared.before.owner) fail('LIQUIDITY_BROWSER_IR_CHANGED');
  const nodes = workflow.nodes.filter(node => node.actionType === 'asset.liquidity.uniswap-v3');
  if (nodes.length !== 1) fail('LIQUIDITY_BROWSER_NODE_INVALID');
  const details = liquidityDetails(nodes[0]!, context);
  if (!details || details.recipient !== prepared.owner) fail('LIQUIDITY_BROWSER_NODE_INVALID');
  const fields = prepared.call.fields;
  const value = (name: string) => { const item = fields[name];
    if (typeof item !== 'string' || !/^(0|[1-9][0-9]*)$/.test(item)) fail('LIQUIDITY_BROWSER_CALL_INVALID');
    return BigInt(item); };
  const str = (name: string) => { const item = fields[name];
    if (typeof item !== 'string' || !/^0x[0-9a-f]{40}$/.test(item)) fail('LIQUIDITY_BROWSER_CALL_INVALID');
    return item; };
  const n = (name: string) => { const item = fields[name];
    if (typeof item !== 'number' || !Number.isSafeInteger(item)) fail('LIQUIDITY_BROWSER_CALL_INVALID');
    return item; };
  let call: LiquidityCall;
  switch (prepared.call.kind) {
    case 'APPROVE': {
      const token = str('token'), amount = value('amount');
      const expectedToken = prepared.operation.endsWith('WETH') ? LIQUIDITY_WETH : LIQUIDITY_USDC;
      const expectedAmount = prepared.operation.startsWith('RESET') ? 0n
        : BigInt(prepared.operation === 'APPROVE_WETH' ? details.amountWeth : details.amountUsdc);
      if (token !== expectedToken || amount !== expectedAmount) fail('LIQUIDITY_BROWSER_APPROVAL_INVALID');
      call = { kind: 'APPROVE', token, amount }; break;
    }
    case 'MINT': {
      const token0 = str('token0'), token1 = str('token1'), fee = n('fee'), tickLower = n('tickLower'), tickUpper = n('tickUpper');
      const recipient = str('recipient'), amount0Desired = value('amount0Desired'), amount1Desired = value('amount1Desired');
      const amount0Min = value('amount0Min'), amount1Min = value('amount1Min'), deadline = value('deadline');
      if (prepared.operation !== 'MINT' || token0 !== LIQUIDITY_WETH || token1 !== LIQUIDITY_USDC || fee !== 500 ||
        tickLower !== details.tickLower || tickUpper !== details.tickUpper || recipient !== prepared.owner ||
        amount0Desired !== BigInt(details.amountWeth) || amount1Desired !== BigInt(details.amountUsdc) ||
        amount0Min !== BigInt(details.minimumWeth) || amount1Min !== BigInt(details.minimumUsdc)) fail('LIQUIDITY_BROWSER_MINT_INVALID');
      call = { kind: 'MINT', token0, token1, fee, tickLower, tickUpper, amount0Desired, amount1Desired,
        amount0Min, amount1Min, recipient, deadline }; break;
    }
    case 'INCREASE': {
      const tokenId = value('tokenId'), amount0Desired = value('amount0Desired'), amount1Desired = value('amount1Desired');
      const amount0Min = value('amount0Min'), amount1Min = value('amount1Min'), deadline = value('deadline');
      if (prepared.operation !== 'INCREASE' || prepared.tokenId !== tokenId.toString() ||
        amount0Desired !== BigInt(details.amountWeth) || amount1Desired !== BigInt(details.amountUsdc) ||
        amount0Min !== BigInt(details.minimumWeth) || amount1Min !== BigInt(details.minimumUsdc)) fail('LIQUIDITY_BROWSER_INCREASE_INVALID');
      call = { kind: 'INCREASE', tokenId, amount0Desired, amount1Desired, amount0Min, amount1Min, deadline }; break;
    }
    case 'DECREASE': {
      const tokenId = value('tokenId'), liquidity = value('liquidity'), amount0Min = value('amount0Min');
      const amount1Min = value('amount1Min'), deadline = value('deadline');
      if (!['DECREASE_PARTIAL', 'DECREASE_FULL'].includes(prepared.operation) || prepared.tokenId !== tokenId.toString() ||
        !prepared.before.position || liquidity > BigInt(prepared.before.position.liquidity) ||
        amount0Min !== BigInt(details.minimumWeth) || amount1Min !== BigInt(details.minimumUsdc)) fail('LIQUIDITY_BROWSER_DECREASE_INVALID');
      call = { kind: 'DECREASE', tokenId, liquidity, amount0Min, amount1Min, deadline }; break;
    }
    case 'COLLECT': {
      const tokenId = value('tokenId'), recipient = str('recipient'), amount0Max = value('amount0Max'), amount1Max = value('amount1Max');
      if (!['COLLECT_PARTIAL', 'COLLECT_FINAL'].includes(prepared.operation) || prepared.tokenId !== tokenId.toString() ||
        recipient !== prepared.owner || !prepared.before.position ||
        amount0Max !== BigInt(prepared.before.position.owed0) || amount1Max !== BigInt(prepared.before.position.owed1))
        fail('LIQUIDITY_BROWSER_COLLECT_INVALID');
      call = { kind: 'COLLECT', tokenId, recipient, amount0Max, amount1Max }; break;
    }
    case 'BURN': {
      const tokenId = value('tokenId');
      if (prepared.operation !== 'BURN' || prepared.tokenId !== tokenId.toString() || !prepared.before.position ||
        prepared.before.position.liquidity !== '0' || prepared.before.position.owed0 !== '0' || prepared.before.position.owed1 !== '0')
        fail('LIQUIDITY_BROWSER_BURN_INVALID');
      call = { kind: 'BURN', tokenId }; break;
    }
  }
  if (!call || ('deadline' in call && call.deadline.toString() !== prepared.deadline)) fail('LIQUIDITY_BROWSER_CALL_INVALID');
  return call;
}
