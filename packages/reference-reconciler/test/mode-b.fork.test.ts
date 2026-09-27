// SPDX-License-Identifier: AGPL-3.0-only
/** Independent reconciliation over observations read directly from the local chain-31337 fork, not from the service's record. */
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { baseAssetRegistry, referenceRegistry } from '../../../packages/action-registry/src/index.js';
import { createReviewContext } from '../../../packages/reference-linter/src/index.js';
import { fromHex, modeBCodeHash, toHex } from '../../../packages/reference-compiler/src/index.js';
import { signModeBLocalTransaction } from '../../../packages/reference-executor/src/mode-b.js';
import { createSwapNode } from '../../../apps/reference-dapp/src/domain/swap-authoring.js';
import { createForkRpc } from '../../../apps/reference-dapp/src/server/fork-rpc.js';
import { createModeBService, type ModeBServerProfile } from '../../../apps/reference-dapp/src/server/mode-b-service.js';
import { describe, expect, it } from 'vitest';
import { decodeSignedTransaction } from '../src/raw-transaction.js';
import { reconcileModeB, type ModeBChainEvidence } from '../src/mode-b.js';

const profilePath = process.env.GRYLOO_MODE_B_SMOKE_PROFILE;
const keyPath = process.env.GRYLOO_MODE_B_EXECUTOR_KEY_FILE;
const enabled = Boolean(profilePath && keyPath);
const workflow = () => ({ schemaVersion: '1.0.0' as const, workflowId: 'workflow-local', revision: 1,
  nodes: [createSwapNode('node-002', 'WETH_TO_USDC', '1', '100', createReviewContext({ registryId: referenceRegistry.registryId,
    capabilityId: referenceRegistry.capabilities[0]?.id, actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry }))], resourceEdges: [] });
const selector = (signature: string) => toHex(keccak_256(new TextEncoder().encode(signature)).subarray(0, 4));
const pad = (address: string) => address.slice(2).toLowerCase().padStart(64, '0');
const ROUTER = '0x2626664c2603336e57b271c5c0b26f421741e481';

describe('Mode B reconciliation from direct fork reads', () => {
  it.skipIf(!enabled)('reconciles the real execution and refuses divergent, reverted and unknown evidence', async () => {
    const profile = JSON.parse(await readFile(profilePath!, 'utf8')) as ModeBServerProfile;
    const keys = JSON.parse(await readFile(keyPath!, 'utf8')) as { owner: string; executor: string };
    const ownerKey = fromHex(keys.owner);
    const executorKey = fromHex(keys.executor);
    const dir = await mkdtemp(join(tmpdir(), 'gryloo-mode-b-reconciler-fork-'));
    const call = createForkRpc({ url: profile.rpcUrl });
    let rpcId = 0;
    const mutate = async (method: string, params: unknown[] = []): Promise<unknown> => {
      const response = await fetch(profile.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }), signal: AbortSignal.timeout(20_000) });
      const data = await response.json() as { result?: unknown; error?: { message?: string } };
      if (!response.ok || data.error) throw new Error(`FORK_MUTATION_FAILED:${method}:${data.error?.message ?? response.status}`);
      return data.result;
    };
    const read = async (to: string, data: string) => BigInt(await call('eth_call', [{ to, data }, 'latest']) as string);
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
      const send = async (from: string, key: Uint8Array, to: string, data: string) => {
        const nonce = BigInt(await call('eth_getTransactionCount', [from, 'pending']) as string);
        const block = await service.chain();
        return signModeBLocalTransaction({ expectedExecutor: from, to, data, nonce, gasLimit: 3_000_000n,
          maxFeePerGas: block.baseFeePerGas * 2n + 1_000_000n }, key);
      };
      for (const [index, tx] of prepared.compiled.installation.entries()) {
        const signed = await send(profile.owner, ownerKey, tx.to, tx.data);
        await mined(await mutate('eth_sendRawTransaction', [signed.raw]) as string);
        await service.confirm(prepared.executionId, 'installation', index, signed.hash);
      }
      const balance = (token: string) => read(token, selector('balanceOf(address)') + pad(profile.safe));
      const inputBefore = await balance(prepared.tokenIn);
      const outputBefore = await balance(prepared.tokenOut);
      const executed = await send(profile.executor, executorKey, prepared.compiled.executorCall.to, prepared.compiled.executorCall.data);
      await mined(await mutate('eth_sendRawTransaction', [executed.raw]) as string);

      // Every observation below is an independent read of the fork, including signer recovery from the mined raw bytes.
      const raw = await call('eth_getRawTransactionByHash', [executed.hash]) as string;
      const decoded = decodeSignedTransaction(fromHex(raw), executed.hash);
      expect(decoded.signer.toLowerCase()).toBe(profile.executor);
      const receipt = await mined(executed.hash);
      const allowance = await call('eth_call', [{ to: profile.roles, data: selector('allowances(bytes32)') + prepared.compiled.allowanceKey.slice(2) }, 'latest']) as string;
      const observed: ModeBChainEvidence = {
        chainId: Number(BigInt(await call('eth_chainId') as string)), safe: profile.safe, roles: profile.roles,
        rolesOwner: '0x' + (await call('eth_call', [{ to: profile.roles, data: selector('owner()') }, 'latest']) as string).slice(-40),
        executor: profile.executor, transactionSigner: decoded.signer, target: ROUTER, transactionTo: decoded.unsigned.to,
        transactionInput: toHex(decoded.unsigned.data), expectedInput: prepared.compiled.executorCall.data,
        safeCodeHash: modeBCodeHash(await call('eth_getCode', [profile.safe, 'latest']) as string), expectedSafeCodeHash: profile.safeCodeHash,
        rolesCodeHash: modeBCodeHash(await call('eth_getCode', [profile.roles, 'latest']) as string), expectedRolesCodeHash: profile.rolesCodeHash,
        owner: '0x' + (await call('eth_call', [{ to: profile.safe, data: selector('getOwners()') }, 'latest']) as string).slice(-40),
        expectedOwner: profile.owner, threshold: Number(await read(profile.safe, selector('getThreshold()'))),
        moduleEnabled: await read(profile.safe, selector('isModuleEnabled(address)') + pad(profile.roles)) === 1n,
        roleAssigned: await read(profile.roles, selector('isModuleEnabled(address)') + pad(profile.executor)) === 1n,
        allowanceRemaining: BigInt('0x' + allowance.slice(2 + 3 * 64, 2 + 4 * 64)),
        transactionReceipt: { status: receipt.status === '0x1' ? 1 : 0, blockHash: receipt.blockHash },
        inputDebited: inputBefore - await balance(prepared.tokenIn), outputCredited: await balance(prepared.tokenOut) - outputBefore,
        amountIn: BigInt(prepared.amountIn), minimumOut: BigInt(prepared.minimumOut),
        residualTokenAllowance: await read(prepared.tokenIn, selector('allowance(address,address)') + pad(profile.safe) + pad(ROUTER)),
      };
      expect(reconcileModeB(observed)).toMatchObject({ outcome: 'RECONCILED', remainingBudget: '0', residualTokenAllowance: '0' });

      // The same real observations against a different review, or with a real revert, never reconcile.
      const otherCall = prepared.compiled.executorCall.data.slice(0, -1) + (prepared.compiled.executorCall.data.endsWith('0') ? '1' : '0');
      expect(reconcileModeB({ ...observed, expectedInput: otherCall }).outcome).toBe('DIVERGENT');
      expect(reconcileModeB({ ...observed, expectedRolesCodeHash: profile.safeCodeHash }).outcome).toBe('DIVERGENT');
      expect(reconcileModeB({ ...observed, expectedOwner: profile.executor }).outcome).toBe('DIVERGENT');
      expect(reconcileModeB({ ...observed, minimumOut: observed.outputCredited + 1n }).outcome).toBe('DIVERGENT');
      const replay = await send(profile.executor, executorKey, prepared.compiled.executorCall.to, prepared.compiled.executorCall.data);
      const replayReceipt = await mined(await mutate('eth_sendRawTransaction', [replay.raw]) as string);
      expect(replayReceipt.status).toBe('0x0');
      expect(reconcileModeB({ ...observed, transactionReceipt: { status: 0, blockHash: replayReceipt.blockHash } }).outcome).toBe('REVERTED');
      const unsent = await send(profile.executor, executorKey, prepared.compiled.executorCall.to, prepared.compiled.executorCall.data);
      expect(await call('eth_getTransactionReceipt', [unsent.hash])).toBeNull();
      expect(reconcileModeB({ ...observed, transactionReceipt: null }).outcome).toBe('INCONCLUSIVE');
    } finally {
      ownerKey.fill(0); executorKey.fill(0);
      await mutate('evm_revert', [snapshot]);
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
