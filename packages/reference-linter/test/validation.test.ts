// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { baseAssetRegistry, referenceRegistry } from '@defi-workflow-engine/action-registry';
import { createReviewContext, validateAuthoringWorkflow } from '../src/index.js';
import { initialWorkflow } from '../../../apps/reference-dapp/src/domain/initial-workflow';
import { createSwapNode, parseHumanAmount, parseSlippage } from '../../../apps/reference-dapp/src/domain/swap-authoring';
import { createMockNode } from '../../../apps/reference-dapp/src/domain/mock-actions';

const source = { registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0]?.id, actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry };
const context = createReviewContext(source);
const valid = () => ({ ...initialWorkflow(), nodes: [...initialWorkflow().nodes, createSwapNode('node-002', 'USDC_TO_WETH', '2', '50', context)] });
const asRecord = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;
const reject = (edit: (workflow: ReturnType<typeof valid>) => void) => {
  const workflow = structuredClone(valid()); edit(workflow);
  expect(() => validateAuthoringWorkflow(workflow, context)).toThrow();
};

describe('closed runtime validation', () => {
  it('rejects malformed contexts, then freezes reconstructed values', () => {
    const forged = structuredClone(source);
    forged.assets.USDC.maximumAmountUnits = '999999999999999999999';
    expect(() => createReviewContext(forged)).toThrow('INVALID_REVIEW_CONTEXT');
    expect(Object.isFrozen(context.assets.USDC.asset)).toBe(true);
    expect(context.assets.USDC.maximumAmountUnits).toBe('1000000000000');
  });
  it('converts precisely within caps without floats', () => {
    expect(parseHumanAmount('0.000001', 'USDC', context)).toBe('1');
    expect(parseHumanAmount('0.000000000000000001', 'WETH', context)).toBe('1');
    expect(parseHumanAmount('1000000', 'USDC', context)).toBe('1000000000000');
    expect(parseHumanAmount('1000', 'WETH', context)).toBe('1000000000000000000000');
    for (const value of ['', '0', '01', '-1', '1e3', '1.0000001', '1000000.000001', '1.', ' 1', '1,000', '1'.repeat(81)]) {
      expect(() => parseHumanAmount(value, 'USDC', context)).toThrow();
    }
    expect(() => parseHumanAmount('1000.000000000000000001', 'WETH', context)).toThrow();
    for (const value of ['', '-1', '1.5', '10001', '01', 'NaN']) expect(() => parseSlippage(value)).toThrow();
  });
  it('permits the approved CoW option while preserving legacy Uniswap-only swaps', () => {
    const next = structuredClone(valid());
    expect(next.nodes[1]!.adapterConstraints.protocols).toEqual(['uniswap']);
    next.nodes[1]!.adapterConstraints.protocols = ['uniswap', 'cow-protocol'];
    expect(validateAuthoringWorkflow(next, context)).toBe(next);
    next.nodes[1]!.adapterConstraints.protocols = ['uniswap'];
    expect(validateAuthoringWorkflow(next, context)).toBe(next);
    reject(w => { w.nodes[1]!.adapterConstraints.protocols = ['cow-protocol']; });
  });
  it('accepts narrower valid bounds but enforces their intersection with the trusted cap', () => {
    const narrowed = structuredClone(valid());
    narrowed.nodes[1]!.editableBounds[0]!.minimumAmount = '1000000';
    narrowed.nodes[1]!.editableBounds[0]!.maximumAmount = '2000000';
    expect(validateAuthoringWorkflow(narrowed, context)).toBe(narrowed);
    reject(w => { w.nodes[1]!.editableBounds[0]!.minimumAmount = '2000001'; });
    reject(w => { w.nodes[1]!.editableBounds[0]!.maximumAmount = '1999999'; });
    reject(w => { w.nodes[1]!.editableBounds[0]!.minimumAmount = '0'; });
    reject(w => { w.nodes[1]!.editableBounds[0]!.maximumAmount = '1000000000001'; });
  });
  it('rejects alternate contexts, hidden object fields, unusual arrays and graph cycles', () => {
    const forged = structuredClone(context);
    asRecord(forged.assets.USDC).maximumAmountUnits = '999999999999999999';
    expect(() => validateAuthoringWorkflow(valid(), forged)).toThrow('INVALID_REVIEW_CONTEXT');
    expect(() => parseHumanAmount('1000001', 'USDC', forged)).toThrow('INVALID_REVIEW_CONTEXT');
    expect(() => createSwapNode('node-003', 'USDC_TO_WETH', '1000001', '50', forged)).toThrow('INVALID_REVIEW_CONTEXT');
    const hostile = new Proxy(source, { getPrototypeOf() { throw new Error('hostile trap'); } });
    expect(() => createReviewContext(hostile)).toThrow('INVALID_REVIEW_CONTEXT');
    const hidden = structuredClone(valid());
    Object.defineProperty(hidden.nodes[1], 'runtime', { value: 'AUTHORIZED', enumerable: false });
    expect(() => validateAuthoringWorkflow(hidden, context)).toThrow('MALFORMED_OBJECT');
    const unusual = structuredClone(valid());
    Object.defineProperty(unusual.nodes, 'runtime', { get() { return 'AUTHORIZED'; } });
    expect(() => validateAuthoringWorkflow(unusual, context)).toThrow('MALFORMED_ARRAY');
    const cycle = structuredClone(valid());
    cycle.nodes.push(createMockNode('node-003', 'read'));
    cycle.nodes[0]!.dependencies.push('node-003');
    cycle.nodes[2]!.dependencies.push('node-001');
    expect(() => validateAuthoringWorkflow(cycle, context)).toThrow('CYCLIC_DEPENDENCY');
  });
  it('rejects forged fields, identities, bounds, ports, graphs and output promises', () => {
    reject(w => { asRecord(w.nodes[1]).runtimeStatus = 'AUTHORIZED'; });
    reject(w => { w.nodes[1]!.nodeId = w.nodes[0]!.nodeId; });
    reject(w => { w.nodes[1]!.inputs.push(w.nodes[1]!.inputs[0]!); });
    reject(w => { asRecord(w.nodes[1]!.inputs[0]!.value).amount = '0001'; });
    reject(w => { asRecord(asRecord(w.nodes[1]!.inputs[0]!.value).asset).decimals = 18; });
    reject(w => { asRecord(w.nodes[1]!.inputs[1]!.value).address = '0xdead'; });
    reject(w => { w.nodes[1]!.editableBounds[0]!.maximumAmount = '999999999999999'; });
    reject(w => { w.nodes[1]!.editableBounds[0]!.minimumAmount = '2000001'; });
    reject(w => { w.nodes[1]!.expectedOutputs[0]!.minimumAmount = '1'; });
    reject(w => { w.nodes[1]!.dependencies.push('node-001'); });
    reject(w => { w.resourceEdges.push({ fromNodeId: 'node-001', outputId: 'result', toNodeId: 'node-002', inputName: 'amount-in' }); });
    reject(w => { w.resourceEdges.push({ fromNodeId: 'missing', outputId: 'result', toNodeId: 'node-001', inputName: 'amount' }); });
    reject(w => { asRecord(w.nodes[1]!.userConstraints[1]).maximumBps = -1; });
    reject(w => { asRecord(w.nodes[1]!.userConstraints[1]).maximumBps = 1.5; });
    const cycle = asRecord(valid()); cycle.self = cycle;
    expect(() => validateAuthoringWorkflow(cycle, context)).toThrow('CYCLIC_OBJECT');
    const getter = valid(); Object.defineProperty(getter, 'runtime', { get() { return 1; }, enumerable: true });
    expect(() => validateAuthoringWorkflow(getter, context)).toThrow('MALFORMED_OBJECT');
  });
});
