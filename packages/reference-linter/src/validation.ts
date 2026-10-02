// SPDX-License-Identifier: AGPL-3.0-only
import { Ajv } from 'ajv';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import workflowSchema from '@defi-workflow-engine/workflow-contracts/schemas/v1/semantic-workflow.schema.json' with { type: 'json' };
import { assetSymbol, createReviewContext, hasKeys, isRecord, type ReviewContext } from './context.js';
import { LIQUIDITY_ACTION, validateLiquidityNode } from './liquidity.js';
import { validateCompositionWorkflow } from './composition.js';
import { validateBridgeWorkflow } from './bridge.js';
import { validateBridgeSwapWorkflow } from './bridge-swap.js';
import { validateCrossChainLiquidityWorkflow } from './cross-chain-liquidity.js';
import { BRIDGE_ACTION } from '@defi-workflow-engine/workflow-contracts';

import { isLendingComposition } from '@defi-workflow-engine/workflow-contracts';
import { validateLendingComposition } from './lending-composition.js';
import { validateSupplyWorkflow } from './supply.js';
import { isSolanaSwapNode, validateSolanaSwapWorkflow } from './solana-swap.js';
import { isConcentratedLiquidityNode, validateSolanaLiquidityWorkflow } from './solana-liquidity.js';

const schemaValidator = new Ajv({ strict: true, allErrors: true, coerceTypes: false, removeAdditional: false, useDefaults: false, ownProperties: true }).compile<SemanticWorkflow>(workflowSchema);
const SWAP = 'asset.swap.exact-input';
const UINT256 = (1n << 256n) - 1n;
const MAX_BYTES = 1_048_576;

function fail(code: string): never { throw new Error(code); }
function unique(values: readonly string[], code: string): void {
  if (new Set(values).size !== values.length) fail(code);
}
function boundedObject(value: unknown): void {
  const seen = new Set<object>();
  let bytes = 0, tokens = 0;
  function visit(item: unknown, depth: number): void {
    if (depth > 64 || ++tokens > 131_072) fail('INPUT_TOO_LARGE');
    if (item === null || typeof item === 'boolean') { bytes += 5; return; }
    if (typeof item === 'number') {
      if (!Number.isSafeInteger(item)) fail('UNSAFE_NUMBER');
      bytes += 24; return;
    }
    if (typeof item === 'string') { bytes += item.length * 3 + 2; return; }
    if (typeof item !== 'object') fail('MALFORMED_OBJECT');
    if (seen.has(item)) fail('CYCLIC_OBJECT');
    seen.add(item);
    if (Array.isArray(item)) {
      if (Object.getPrototypeOf(item) !== Array.prototype || item.length > 4096
          || Reflect.ownKeys(item).length !== item.length + 1) fail('MALFORMED_ARRAY');
      bytes += 2;
      for (let index = 0; index < item.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) fail('MALFORMED_ARRAY');
        visit(descriptor.value, depth + 1);
      }
    } else if (isRecord(item)) {
      bytes += 2;
      const keys = Reflect.ownKeys(item);
      if (keys.length > 16_384) fail('INPUT_TOO_LARGE');
      for (const key of keys) {
        if (typeof key !== 'string' || key.length > 512) fail('MALFORMED_OBJECT');
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) fail('MALFORMED_OBJECT');
        bytes += key.length * 3 + 3;
        visit(descriptor.value, depth + 1);
      }
    } else fail('MALFORMED_OBJECT');
    seen.delete(item);
    if (bytes > MAX_BYTES) fail('INPUT_TOO_LARGE');
  }
  visit(value, 0);
}

function nativeAmount(value: string, maximum: string): void {
  if (!/^[1-9][0-9]{0,77}$/.test(value)) fail('INVALID_AMOUNT');
  const n = BigInt(value);
  if (n > UINT256 || n > BigInt(maximum)) fail('AMOUNT_OUT_OF_RANGE');
}

/** Closed schema plus the stricter temporary BUILD-003A authoring profile. */
export function validateAuthoringWorkflow(input: unknown, context: ReviewContext): SemanticWorkflow {
  const trusted = createReviewContext(context);
  try { boundedObject(input); }
  catch (cause) {
    if (cause instanceof Error && ['INPUT_TOO_LARGE', 'UNSAFE_NUMBER', 'CYCLIC_OBJECT', 'MALFORMED_ARRAY', 'MALFORMED_OBJECT'].includes(cause.message)) throw cause;
    fail('MALFORMED_OBJECT');
  }
  if (!schemaValidator(input)) fail('INVALID_SEMANTIC_WORKFLOW');
  const workflow = input;
  if (isLendingComposition(workflow)) { validateLendingComposition(workflow); return workflow; }
  if (workflow.nodes.some(node => node.actionType === 'asset.liquidity.prepare')) {
    validateCrossChainLiquidityWorkflow(workflow);
    return workflow;
  }
  if (workflow.nodes.some(node => node.actionType === BRIDGE_ACTION)) {
    if (workflow.nodes.length === 2) validateBridgeSwapWorkflow(workflow);
    else validateBridgeWorkflow(workflow);
    return workflow;
  }
  if (workflow.resourceEdges.length === 1 && workflow.nodes.length === 2 &&
      workflow.nodes.some(node => node.actionType === LIQUIDITY_ACTION) &&
      workflow.nodes.some(node => node.actionType === SWAP)) {
    validateCompositionWorkflow(workflow, trusted);
    return workflow;
  }
  if (workflow.nodes.some(node => ['supply','borrow','repay','withdraw'].includes(node.actionType))) validateSupplyWorkflow(workflow);
  // The canonical swap on Solana: same action and ports, chain-specific asset and provider profile.
  if (workflow.nodes.some(isSolanaSwapNode)) { validateSolanaSwapWorkflow(workflow); return workflow; }
  // The canonical concentrated-liquidity action; its only runtime today is Orca Whirlpools on Solana Devnet.
  if (workflow.nodes.some(isConcentratedLiquidityNode)) { validateSolanaLiquidityWorkflow(workflow); return workflow; }
  unique(workflow.nodes.map(node => node.nodeId), 'DUPLICATE_NODE');
  const nodes = new Map(workflow.nodes.map(node => [node.nodeId, node]));
  for (const node of workflow.nodes) {
    unique(node.inputs.map(p => p.name), 'DUPLICATE_INPUT');
    unique(node.expectedOutputs.map(p => p.outputId), 'DUPLICATE_OUTPUT');
    unique(node.lockedParameters.map(p => p.name), 'DUPLICATE_LOCK');
    unique(node.editableBounds.map(p => p.parameterName), 'DUPLICATE_BOUND');
    for (const parent of node.dependencies) if (!nodes.has(parent) || parent === node.nodeId) fail('INVALID_DEPENDENCY');
    if (node.actionType === LIQUIDITY_ACTION) { validateLiquidityNode(node, trusted); continue; }
    if (node.actionType !== SWAP) continue;
    if (node.actionSchemaVersion !== '1.0.0' || node.chainId !== trusted.assets.USDC.asset.chainId
        || node.requiredCapabilities.length !== 1 || node.requiredCapabilities[0] !== trusted.capabilityId
        || node.requiredAuthorizationClass !== 'MODE_A' || node.failurePolicy !== 'ABORT'
        || node.adapterConstraints.adapters.length !== 0 || !(node.adapterConstraints.protocols.length === 1 && node.adapterConstraints.protocols[0] === 'uniswap') &&
        !(node.adapterConstraints.protocols.length === 2 && node.adapterConstraints.protocols[0] === 'uniswap' &&
          node.adapterConstraints.protocols[1] === 'cow-protocol') || node.dependencies.length !== 0) fail('INVALID_SWAP_DECLARATION');
    if (node.inputs.length !== 2 || !hasKeys(Object.fromEntries(node.inputs.map(p => [p.name, p])), ['amount-in', 'asset-out'])) fail('INVALID_SWAP_PORTS');
    const amount = node.inputs.find(p => p.name === 'amount-in');
    const assetOut = node.inputs.find(p => p.name === 'asset-out');
    if (amount?.kind !== 'QUANTITY' || assetOut?.kind !== 'ASSET') fail('INVALID_SWAP_PORTS');
    const from = assetSymbol(amount.value.asset, trusted);
    const to = assetSymbol(assetOut.value, trusted);
    if (from === null || to === null || from === to) fail('INVALID_ASSET_PAIR');
    nativeAmount(amount.value.amount, trusted.assets[from].maximumAmountUnits);
    if (node.expectedOutputs.length !== 1 || node.expectedOutputs[0]?.outputId !== 'amount-out'
        || assetSymbol(node.expectedOutputs[0].asset, trusted) !== to
        || node.expectedOutputs[0].minimumAmount !== '0') fail('UNQUOTED_OUTPUT_REQUIRED');
    const maximum = node.userConstraints.filter(c => c.kind === 'MAXIMUM_INPUT');
    const slips = node.userConstraints.filter(c => c.kind === 'MAXIMUM_SLIPPAGE_BPS');
    if (maximum.length !== 1 || node.userConstraints.length !== maximum.length + slips.length
        || maximum[0]?.kind !== 'MAXIMUM_INPUT'
        || assetSymbol(maximum[0].quantity.asset, trusted) !== from
        || maximum[0].quantity.amount !== amount.value.amount) fail('INVALID_SWAP_CONSTRAINT');
    if (node.lockedParameters.length > 1 || node.editableBounds.length > 1) fail('INVALID_SWAP_BOUND');
    const locked = node.lockedParameters[0];
    if (locked && (locked.name !== 'amount-in' || locked.kind !== 'QUANTITY'
        || assetSymbol(locked.value.asset, trusted) !== from || locked.value.amount !== amount.value.amount
        || node.editableBounds.length !== 0)) fail('INVALID_SWAP_LOCK');
    const bound = node.editableBounds[0];
    if (!locked) {
      if (!bound || bound.parameterName !== 'amount-in' || assetSymbol(bound.asset, trusted) !== from) fail('INVALID_SWAP_BOUND');
      nativeAmount(bound.minimumAmount, trusted.assets[from].maximumAmountUnits);
      nativeAmount(bound.maximumAmount, trusted.assets[from].maximumAmountUnits);
      if (BigInt(bound.minimumAmount) > BigInt(bound.maximumAmount)
          || BigInt(amount.value.amount) < BigInt(bound.minimumAmount)
          || BigInt(amount.value.amount) > BigInt(bound.maximumAmount)) fail('INVALID_SWAP_BOUND');
    }
  }
  const visited = new Set<string>(), visiting = new Set<string>();
  function checkCycle(id: string): void {
    if (visiting.has(id)) fail('CYCLIC_DEPENDENCY');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const parent of nodes.get(id)!.dependencies) checkCycle(parent);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of nodes.keys()) checkCycle(id);
  unique(workflow.resourceEdges.map(e => JSON.stringify([e.fromNodeId, e.outputId, e.toNodeId, e.inputName])), 'DUPLICATE_EDGE');
  for (const edge of workflow.resourceEdges) {
    const from = nodes.get(edge.fromNodeId), to = nodes.get(edge.toNodeId);
    if (!from || !to) fail('INVALID_EDGE');
    if ([SWAP, LIQUIDITY_ACTION].includes(from.actionType) || [SWAP, LIQUIDITY_ACTION].includes(to.actionType)) fail('SWAP_EDGE_UNSUPPORTED');
    if (!from.expectedOutputs.some(p => p.outputId === edge.outputId)
        || !to.dependencies.includes(edge.fromNodeId)) fail('INVALID_EDGE');
    const target = to.inputs.find(p => p.name === edge.inputName);
    if (target?.kind !== 'OUTPUT_REFERENCE' || target.value.nodeId !== edge.fromNodeId
        || target.value.outputId !== edge.outputId) fail('INVALID_EDGE');
  }
  for (const node of workflow.nodes) {
    if ([SWAP, LIQUIDITY_ACTION].includes(node.actionType)) continue;
    if (node.dependencies.some(id => [SWAP, LIQUIDITY_ACTION].includes(nodes.get(id)!.actionType))) fail('SWAP_EDGE_UNSUPPORTED');
    for (const input of node.inputs) if (input.kind === 'OUTPUT_REFERENCE' &&
      (!nodes.has(input.value.nodeId) || !nodes.get(input.value.nodeId)?.expectedOutputs.some(p => p.outputId === input.value.outputId)
        || !node.dependencies.includes(input.value.nodeId))) fail('INVALID_REFERENCE');
  }
  return workflow;
}
