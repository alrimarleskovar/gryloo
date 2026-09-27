// SPDX-License-Identifier: AGPL-3.0-only
/** The compiled Mode B installation, once signed and mined on the local chain-31337 fork, reads back as exactly what was reviewed. */
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { hashModeBPermission } from '@defi-workflow-engine/workflow-contracts';
import { baseAssetRegistry, referenceRegistry } from '../../../packages/action-registry/src/index.js';
import { createReviewContext } from '../../../packages/reference-linter/src/index.js';
import { createSwapNode } from '../../../apps/reference-dapp/src/domain/swap-authoring.js';
import { createForkRpc } from '../../../apps/reference-dapp/src/server/fork-rpc.js';
import { createModeBService, type ModeBServerProfile } from '../../../apps/reference-dapp/src/server/mode-b-service.js';
import { signModeBLocalTransaction } from '../../../packages/reference-executor/src/mode-b.js';
import { describe, expect, it } from 'vitest';
import { fromHex, modeBCodeHash, SWAP_ROUTER_02, toHex } from '../src/index.js';

const profilePath = process.env.GRYLOO_MODE_B_SMOKE_PROFILE;
const keyPath = process.env.GRYLOO_MODE_B_EXECUTOR_KEY_FILE;
const enabled = Boolean(profilePath && keyPath);
const workflow = () => ({ schemaVersion: '1.0.0' as const, workflowId: 'workflow-local', revision: 1,
  nodes: [createSwapNode('node-002', 'WETH_TO_USDC', '1', '100', createReviewContext({ registryId: referenceRegistry.registryId,
    capabilityId: referenceRegistry.capabilities[0]?.id, actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry }))], resourceEdges: [] });
const topic = (signature: string) => toHex(keccak_256(new TextEncoder().encode(signature)));
const selector = (signature: string) => topic(signature).slice(0, 10);
const word = (data: string, index: number) => BigInt('0x' + data.slice(2 + index * 64, 66 + index * 64));

describe('compiled finite authority read back from the closed Base fork', () => {
  it.skipIf(!enabled)('installs exactly the compiled conditions, allowance, membership, module and token approval', async () => {
    const profile = JSON.parse(await readFile(profilePath!, 'utf8')) as ModeBServerProfile;
    const ownerKey = fromHex((JSON.parse(await readFile(keyPath!, 'utf8')) as { owner: string }).owner);
    const dir = await mkdtemp(join(tmpdir(), 'gryloo-mode-b-compiler-fork-'));
    const call = createForkRpc({ url: profile.rpcUrl });
    let rpcId = 0;
    const mutate = async (method: string, params: unknown[] = []): Promise<unknown> => {
      const response = await fetch(profile.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }), signal: AbortSignal.timeout(20_000) });
      const data = await response.json() as { result?: unknown; error?: { message?: string } };
      if (!response.ok || data.error) throw new Error(`FORK_MUTATION_FAILED:${method}:${data.error?.message ?? response.status}`);
      return data.result;
    };
    const mined = async (hash: string): Promise<{ status: string; blockHash: string; logs: { address: string; topics: string[]; data: string }[] }> => {
      for (let attempt = 0; attempt < 50; attempt++) {
        const value = await call('eth_getTransactionReceipt', [hash]) as { status: string; blockHash: string; logs: { address: string; topics: string[]; data: string }[] } | null;
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('MODE_B_RECEIPT_TIMEOUT');
    };
    const snapshot = await mutate('evm_snapshot');
    try {
      await mutate('anvil_setBalance', [profile.owner, '0x56bc75e2d63100000']);
      const service = createModeBService({ ...profile, journalDir: dir }, call);
      const prepared = await service.prepare(workflow());
      const compiled = prepared.compiled;
      // The reviewed permission binds the code actually deployed at the reviewed addresses.
      expect(hashModeBPermission(compiled.permission)).toBe(compiled.permissionHash);
      expect(modeBCodeHash(await call('eth_getCode', [profile.safe, 'latest']) as string)).toBe(compiled.permission.safeCodeHash);
      expect(modeBCodeHash(await call('eth_getCode', [profile.roles, 'latest']) as string)).toBe(compiled.permission.rolesCodeHash);
      const receipts: { logs: { address: string; topics: string[]; data: string }[] }[] = [];
      for (const [index, tx] of compiled.installation.entries()) {
        const nonce = BigInt(await call('eth_getTransactionCount', [profile.owner, 'pending']) as string);
        const block = await service.chain();
        const { raw } = signModeBLocalTransaction({ expectedExecutor: profile.owner, to: tx.to, data: tx.data, nonce,
          gasLimit: 3_000_000n, maxFeePerGas: block.baseFeePerGas * 2n + 1_000_000n }, ownerKey);
        const hash = await mutate('eth_sendRawTransaction', [raw]) as string;
        const receipt = await mined(hash);
        expect(receipt.status, tx.label).toBe('0x1');
        receipts.push(receipt);
        await service.confirm(prepared.executionId, 'installation', index, hash);
      }
      const rolesLogs = receipts.flatMap(receipt => receipt.logs).filter(log => log.address.toLowerCase() === profile.roles);
      // Roles emits the stored condition tree verbatim: it must equal the compiled scopeFunction arguments byte for byte.
      const scopeFunction = selector('scopeFunction(bytes32,address,bytes4,(uint8,uint8,uint8,bytes)[],uint8)').slice(2);
      const compiledScope = compiled.installation.map(tx => tx.data.toLowerCase()).find(data => data.includes(scopeFunction))!;
      const compiledArgs = compiledScope.slice(compiledScope.indexOf(scopeFunction) + 8);
      const scopeLog = rolesLogs.find(log => log.topics[0] === topic('ScopeFunction(bytes32,address,bytes4,(uint8,uint8,uint8,bytes)[],uint8)'));
      expect(scopeLog, 'ScopeFunction event').toBeDefined();
      expect(compiledArgs.startsWith(scopeLog!.data.slice(2).toLowerCase())).toBe(true);
      expect(word(scopeLog!.data, 0)).toBe(BigInt(compiled.roleKey));
      expect('0x' + scopeLog!.data.slice(90, 130)).toBe(SWAP_ROUTER_02.toLowerCase());
      expect(scopeLog!.data.slice(130, 138)).toBe('5ae401dc');
      // One non-refilling call: balance 1, no refill, no period.
      const allowance = await call('eth_call', [{ to: profile.roles, data: selector('allowances(bytes32)') + compiled.allowanceKey.slice(2) }, 'latest']) as string;
      expect([word(allowance, 0), word(allowance, 2), word(allowance, 3)]).toEqual([0n, 0n, 1n]);
      // Safe module and Roles membership, and the finite Router02 approval, equal the review.
      expect(word(await call('eth_call', [{ to: profile.safe, data: selector('isModuleEnabled(address)') + profile.roles.slice(2).padStart(64, '0') }, 'latest']) as string, 0)).toBe(1n);
      expect(word(await call('eth_call', [{ to: profile.roles, data: selector('isModuleEnabled(address)') + profile.executor.slice(2).padStart(64, '0') }, 'latest']) as string, 0)).toBe(1n);
      const approval = await call('eth_call', [{ to: prepared.tokenIn, data: selector('allowance(address,address)') + profile.safe.slice(2).padStart(64, '0')
        + SWAP_ROUTER_02.slice(2).toLowerCase().padStart(64, '0') }, 'latest']) as string;
      expect(word(approval, 0)).toBe(BigInt(prepared.amountIn));
      const status = await service.status(prepared.executionId);
      expect([status.moduleEnabled, status.executorEnabled, status.remainingBudget]).toEqual([true, true, prepared.amountIn]);
    } finally {
      ownerKey.fill(0);
      await mutate('evm_revert', [snapshot]);
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
