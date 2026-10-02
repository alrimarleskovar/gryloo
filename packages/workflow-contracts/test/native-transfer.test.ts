// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { createNativeTransferNode, readNativeTransferNode, TRANSFER_ACTION } from '../src/native-transfer.js';
import { validateArtifact } from '../src/schemas.js';

const fields = { chain: 'eip155:46630', amount: '1000000000000', recipient: 'CONNECTED_OWNER' as const };
describe('RH-DEMO-001 chain-neutral native transfer node', () => {
  it('binds the connected owner as session state, never an address', () => {
    const node = createNativeTransferNode('node-002', fields);
    expect(node).toMatchObject({ actionType: TRANSFER_ACTION, chainId: 'eip155:46630', requiredAuthorizationClass: 'MODE_A',
      adapterConstraints: { adapters: [{ id: 'evm.native-transfer', version: '1.0.0' }], protocols: ['native'] } });
    expect(JSON.stringify(node)).not.toMatch(/0x[0-9a-f]{40}/i);
    expect(readNativeTransferNode(node)).toEqual(fields);
    expect(() => validateArtifact('semantic-workflow', { schemaVersion: '1.0.0', workflowId: 'w', revision: 0, nodes: [node], resourceEdges: [] })).not.toThrow();
  });
  it('rejects malformed fields and any extra or altered declaration', () => {
    for (const bad of [{ ...fields, amount: '0' }, { ...fields, amount: '01' }, { ...fields, chain: 'solana:x' }, { ...fields, recipient: '0x' + '1'.repeat(40) }])
      expect(() => createNativeTransferNode('n', bad as typeof fields)).toThrow('TRANSFER_FIELDS_INVALID');
    const node = createNativeTransferNode('n', fields);
    expect(() => readNativeTransferNode({ ...node, lockedParameters: [{ name: 'amount' } as never] })).toThrow('TRANSFER_DECLARATION_INVALID');
    expect(() => readNativeTransferNode({ ...node, requiredAuthorizationClass: 'NONE' })).toThrow('TRANSFER_DECLARATION_INVALID');
    expect(() => readNativeTransferNode({ ...node, inputs: [node.inputs[0]!] })).toThrow('TRANSFER_PORTS_INVALID');
  });
});
