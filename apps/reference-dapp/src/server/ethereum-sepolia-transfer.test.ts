// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-ETHEREUM-001: the native test-ETH self-transfer, the minimal owner-execution smoke path, on Ethereum Sepolia through the
 * unchanged RH-DEMO-001 service, executor and reconciler against a MOCKED loopback chain (chain 0xaa36a7).
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createNativeTransferNode, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createRobinhoodTransferChain, TRANSFER_OWNER as owner, type TransferChainOptions } from '../../e2e/robinhood-transfer-harness.mjs';
import { createRobinhoodTransferService } from './robinhood-transfer-service';
import { nativeTransferReadRpcs } from './robinhood-rpc';

const ETH = 'eip155:11155111';
const workflow = (chain = ETH, amount = '1000000000000'): SemanticWorkflow => ({ schemaVersion: '1.0.0', workflowId: 'eth-transfer', revision: 1, resourceEdges: [],
  nodes: [createNativeTransferNode('node-002', { chain, amount, recipient: 'CONNECTED_OWNER' })] });
async function setup(options: TransferChainOptions = {}) {
  const chain = createRobinhoodTransferChain({ network: 'ethereum-sepolia', ...options }), robinhood = createRobinhoodTransferChain();
  const journalDir = await mkdtemp(join(tmpdir(), 'build-ethereum-001-transfer-'));
  const service = createRobinhoodTransferService({ rpc: robinhood.rpc, rpcs: { [ETH]: chain.rpc }, journalDir, provenance: 'MOCKED' });
  return { chain, robinhood, journalDir, service };
}

describe('Ethereum Sepolia native test-ETH self-transfer', () => {
  it('reviews chain 0xaa36a7, sends once through the owner wallet, waits for three L1 confirmations and reconciles', async () => {
    const { chain, robinhood, journalDir, service } = await setup(), w = workflow();
    try {
      const simulated = await service.simulate(w, owner);
      expect(simulated.review).toMatchObject({ chain: ETH, chainId: 11155111, account: owner, recipient: owner, value: '1000000000000' });
      expect(simulated.review.transaction).toMatchObject({ chainId: '0xaa36a7', from: owner, to: owner, data: '0x' });
      expect(simulated.review.simulation.uncertainty).toEqual([{ code: 'L1_REORG_WINDOW', description: 'Inclusion is an Ethereum Sepolia block; reconciliation waits for 3 confirmations.' }]);
      const record = await service.review(simulated.id, simulated.review.commitment, w);
      const begin = await service.begin(record.id, owner, w);
      expect(begin.transaction.chainId).toBe('0xaa36a7');
      await service.handoff(record.id);
      const hash = await chain.rpc('MOCK_submit', [begin.transaction]) as string;
      await service.report(record.id, { kind: 'HASH', hash });
      // The harness mines the inclusion block 3 blocks ago at most: one more block is still needed for three confirmations.
      chain.state.block -= 1;
      expect((await service.observe(record.id)).error).toBe('AWAITING_CONFIRMATIONS');
      await chain.rpc('MOCK_mine', [1]);
      const done = await service.observe(record.id);
      expect(done.verdict).toBe('RECONCILED');
      expect(done.evidence?.bundle).toMatchObject({ environment: 'MOCKED', outcome: 'RECONCILED' });
      expect(done.evidence?.publicExecution).toMatchObject({ network: 'Ethereum Sepolia', chainId: 11155111, explorerUrl: `https://sepolia.etherscan.io/tx/${hash}` });
      expect(done.evidence?.bundle.reconciliation.limitations[0]).toContain('Ethereum Sepolia block level after 3 confirmations');
      expect(chain.transactions).toHaveLength(1);
      expect(robinhood.transactions).toHaveLength(0);
      // Owner nonces are per chain: the Ethereum Sepolia lease is qualified, so Robinhood nonce 7 stays free.
      expect((await readdir(journalDir)).filter(name => name.endsWith('.intent'))).toEqual([`eip155-11155111-${owner}-7.intent`]);
    } finally { await rm(journalDir, { recursive: true, force: true }); }
  });
  it('refuses a provider on another chain, Mainnet included, and an unenabled network', async () => {
    for (const reported of ['0xb626', '0x1', '0x14a34']) {
      const { journalDir, service } = await setup({ chain: reported });
      try { await expect(service.simulate(workflow(), owner)).rejects.toThrow('TRANSFER_WRONG_CHAIN'); } finally { await rm(journalDir, { recursive: true, force: true }); }
    }
    const journalDir = await mkdtemp(join(tmpdir(), 'build-ethereum-001-transfer-'));
    try {
      const robinhoodOnly = createRobinhoodTransferService({ rpc: createRobinhoodTransferChain().rpc, journalDir, provenance: 'MOCKED' });
      await expect(robinhoodOnly.simulate(workflow(), owner)).rejects.toThrow('TRANSFER_NETWORK_UNAVAILABLE');
      await expect(robinhoodOnly.simulate(workflow('eip155:1'), owner)).rejects.toThrow('TRANSFER_NETWORK_UNSUPPORTED');
    } finally { await rm(journalDir, { recursive: true, force: true }); }
  });
  it('enables each network only by its own flag; the harness serves both', () => {
    expect(Object.keys(nativeTransferReadRpcs('live', { GRYLOO_ROBINHOOD_TESTNET: 'live' }).rpcs)).toEqual([]);
    expect(nativeTransferReadRpcs('live', { GRYLOO_ROBINHOOD_TESTNET: 'live' }).rpc).toBeTypeOf('function');
    const ethereumOnly = nativeTransferReadRpcs('live', { GRYLOO_ETHEREUM_SEPOLIA_TRANSFER: 'live' });
    expect(ethereumOnly.rpc).toBeUndefined();
    expect(Object.keys(ethereumOnly.rpcs)).toEqual([ETH]);
    expect(Object.keys(nativeTransferReadRpcs('harness', {}).rpcs)).toEqual([ETH]);
    expect(() => nativeTransferReadRpcs('live', { GRYLOO_ETHEREUM_SEPOLIA_TRANSFER: 'live', GRYLOO_ETHEREUM_SEPOLIA_RPC_URL: 'http://insecure.example' }))
      .toThrow('TRANSFER_RPC_CONFIGURATION_INVALID');
  });
});
