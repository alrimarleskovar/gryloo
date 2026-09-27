// SPDX-License-Identifier: AGPL-3.0-only
/** Automated local chain-31337 proof. Uses disposable test keys from a mode-0600 file outside Git. */
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { encodeUnsignedPayload, rlpDecode, rlpEncode, rlpInteger, rlpList, toHex, fromHex } from '@defi-workflow-engine/reference-compiler';
import { baseAssetRegistry, referenceRegistry } from '../../../packages/action-registry/src/index.js';
import { createReviewContext } from '../../../packages/reference-linter/src/index.js';
import { createSwapNode } from '../../../apps/reference-dapp/src/domain/swap-authoring.js';
import { createForkRpc } from '../../../apps/reference-dapp/src/server/fork-rpc.js';
import { createModeBService, type ModeBServerProfile } from '../../../apps/reference-dapp/src/server/mode-b-service.js';
import { describe, expect, it } from 'vitest';
import { signModeBLocalTransaction } from '../src/mode-b.js';
const profilePath = process.env.GRYLOO_MODE_B_SMOKE_PROFILE;
const keyPath = process.env.GRYLOO_MODE_B_EXECUTOR_KEY_FILE;
const enabled = Boolean(profilePath && keyPath);
const workflow = () => ({ schemaVersion: '1.0.0' as const, workflowId: 'workflow-local', revision: 1,
  nodes: [createSwapNode('node-002', 'WETH_TO_USDC', '1', '100', createReviewContext({ registryId: referenceRegistry.registryId,
    capabilityId: referenceRegistry.capabilities[0]?.id, actionId: referenceRegistry.actions[0]?.id, assets: baseAssetRegistry }))], resourceEdges: [] });
describe('Safe-owned finite authority on the closed Base fork', () => {
  it.skipIf(!enabled)('installs exact authority, executes after worker restart, reconciles, and revokes', async () => {
    const profile = JSON.parse(await readFile(profilePath!, 'utf8')) as ModeBServerProfile;
    const keys = JSON.parse(await readFile(keyPath!, 'utf8')) as { owner: string; executor: string };
    const ownerKey = fromHex(keys.owner);
    const executorKey = fromHex(keys.executor);
    const ownerAddr = toHex(keccak_256(secp256k1.getPublicKey(ownerKey, false).subarray(1)).subarray(12));
    expect(ownerAddr).toBe(profile.owner);
    const dir = await mkdtemp(join(tmpdir(), 'gryloo-mode-b-fork-'));
    const call = createForkRpc({ url: profile.rpcUrl });
    let rpcId = 0;
    async function mutate(method: string, params: unknown[] = []): Promise<unknown> {
      const response = await fetch(profile.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }), signal: AbortSignal.timeout(20_000) });
      const data = await response.json() as { result?: unknown; error?: { message?: string } };
      if (!response.ok || data.error) throw new Error(`FORK_MUTATION_FAILED:${method}:${data.error?.message ?? response.status}`);
      return data.result;
    }
    function signOwner(to: string, data: string, nonce: bigint, fee: bigint): string {
      const unsigned = encodeUnsignedPayload({ chainId: 31337, nonce, maxPriorityFeePerGas: 1_000_000n,
        maxFeePerGas: fee, gasLimit: 3_000_000n, to, value: 0n, data: fromHex(data), accessList: [] });
      const sig = secp256k1.Signature.fromBytes(secp256k1.sign(keccak_256(unsigned), ownerKey,
        { prehash: false, format: 'recovered' }), 'recovered');
      const encoded = rlpEncode([...rlpList(rlpDecode(unsigned.subarray(1))), rlpInteger(BigInt(sig.recovery!)), rlpInteger(sig.r), rlpInteger(sig.s)]);
      return toHex(Uint8Array.of(2, ...encoded));
    }
    async function receipt(hash: string): Promise<{ status: string }> {
      for (let attempt = 0; attempt < 30; attempt++) {
        const value = await call('eth_getTransactionReceipt', [hash]) as { status: string } | null;
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('MODE_B_RECEIPT_TIMEOUT');
    }
    const snapshot = await mutate('evm_snapshot');
    try {
      await mutate('anvil_setBalance', [profile.owner, '0x56bc75e2d63100000']);
      const service = createModeBService({ ...profile, journalDir: dir }, call);
      await service.boundary();
      const prepared = await service.prepare(workflow());
      for (const [index, tx] of prepared.compiled.installation.entries()) {
        const nonce = BigInt(await call('eth_getTransactionCount', [profile.owner, 'pending']) as string);
        const block = await service.chain();
        const raw = signOwner(tx.to, tx.data, nonce, block.baseFeePerGas * 2n + 1_000_000n);
        const hash = await mutate('eth_sendRawTransaction', [raw]) as string;
        const mined = await receipt(hash);
        expect(mined.status).toBe('0x1');
        await service.confirm(prepared.executionId, 'installation', index, hash);
      }
      const active = await service.status(prepared.executionId);
      expect(active.moduleEnabled).toBe(true);
      expect(active.executorEnabled).toBe(true);
      expect(active.remainingBudget).toBe(prepared.amountIn);
      const owner = await call('eth_call', [{ to: profile.roles, data: '0x8da5cb5b' }, 'latest']) as string;
      expect('0x' + owner.slice(-40)).toBe(profile.safe);
      const baseCall = prepared.compiled.executorCall.data;
      const word = (value: bigint) => value.toString(16).padStart(64, '0');
      const alter = (data: string, byteOffset: number, length: number, replacement: string) =>
        data.slice(0, 2 + byteOffset * 2) + replacement.padStart(length * 2, '0') + data.slice(2 + (byteOffset + length) * 2);
      async function direct(data: string, to = profile.roles) {
        const nonce = BigInt(await call('eth_getTransactionCount', [profile.executor, 'pending']) as string);
        const block = await service.chain();
        const signed = signModeBLocalTransaction({ expectedExecutor: profile.executor, to, data, nonce,
          gasLimit: 1_500_000n, maxFeePerGas: block.baseFeePerGas * 2n + 1_000_000n }, executorKey);
        // A boundary rejection must be an onchain revert of a mined transaction, never an RPC refusal.
        const status = (await receipt(await mutate('eth_sendRawTransaction', [signed.raw]) as string)).status;
        return status === '0x1';
      }
      const selectorOf = (signature: string) => toHex(keccak_256(new TextEncoder().encode(signature)).subarray(0, 4));
      const transferRoles = selectorOf('transferOwnership(address)') + profile.executor.slice(2).padStart(64, '0');
      expect(await direct(transferRoles, profile.roles), 'executor cannot transfer Roles ownership').toBe(false);
      expect(await direct(prepared.compiled.installation.at(-1)!.data, profile.safe), 'executor cannot invoke owner Safe signature').toBe(false);
      const upgrade = selectorOf('setFallbackHandler(address)') + profile.owner.slice(2).padStart(64, '0');
      expect(await direct(upgrade, profile.safe), 'executor cannot change Safe fallback handler').toBe(false);
      for (const [name, data] of [
        ['wrong target', alter(baseCall, 4, 32, profile.safe.slice(2))],
        ['wrong selector', alter(baseCall, 228, 4, '04e45aaf')],
        ['wrong token', alter(baseCall, 396, 32, profile.safe.slice(2))],
        ['wrong receiver', alter(baseCall, 492, 32, profile.owner.slice(2))],
        ['one unit above amount', alter(baseCall, 524, 32, word(BigInt(prepared.amountIn) + 1n))],
        ['wrong protocol deadline', alter(baseCall, 232, 32, word(BigInt(prepared.deadline) + 1n))],
        ['arbitrary value', alter(baseCall, 36, 32, word(1n))],
        ['delegatecall', alter(baseCall, 100, 32, word(1n))],
      ] as const) expect(await direct(data), name).toBe(false);
      const foreignFields = [rlpInteger(8453n), rlpInteger(BigInt(await call('eth_getTransactionCount', [profile.executor, 'pending']) as string)),
        rlpInteger(1_000_000n), rlpInteger(2_000_000n), rlpInteger(1_500_000n), fromHex(profile.roles),
        rlpInteger(0n), fromHex(baseCall), []];
      const foreignUnsigned = Uint8Array.of(2, ...rlpEncode(foreignFields));
      const foreignSig = secp256k1.Signature.fromBytes(secp256k1.sign(keccak_256(foreignUnsigned), executorKey,
        { prehash: false, format: 'recovered' }), 'recovered');
      const foreignRaw = toHex(Uint8Array.of(2, ...rlpEncode([...foreignFields,
        rlpInteger(BigInt(foreignSig.recovery!)), rlpInteger(foreignSig.r), rlpInteger(foreignSig.s)])));
      await expect(mutate('eth_sendRawTransaction', [foreignRaw])).rejects.toThrow('FORK_MUTATION_FAILED');
      const expirySnapshot = await mutate('evm_snapshot');
      await mutate('evm_setNextBlockTimestamp', [Number(prepared.deadline) + 1]);
      await mutate('evm_mine');
      expect(await direct(baseCall), 'expired protocol deadline').toBe(false);
      await mutate('evm_revert', [expirySnapshot]);
      const competeSnapshot = await mutate('evm_snapshot');
      await mutate('evm_setAutomine', [false]);
      const nonce = BigInt(await call('eth_getTransactionCount', [profile.executor, 'pending']) as string);
      const block = await service.chain();
      const pair = [nonce, nonce + 1n].map(value => signModeBLocalTransaction({ expectedExecutor: profile.executor,
        to: profile.roles, data: baseCall, nonce: value, gasLimit: 1_500_000n,
        maxFeePerGas: block.baseFeePerGas * 2n + 1_000_000n }, executorKey));
      const hashes = [];
      for (const signed of pair) hashes.push(await mutate('eth_sendRawTransaction', [signed.raw]) as string);
      await mutate('evm_mine'); await mutate('evm_setAutomine', [true]);
      const outcomes = await Promise.all(hashes.map(hash => receipt(hash)));
      expect(outcomes.map(item => item.status).sort()).toEqual(['0x0', '0x1']);
      await mutate('evm_revert', [competeSnapshot]);
      const headBeforeWorker = await service.chain();
      expect(headBeforeWorker.timestamp, `deadline ${prepared.deadline}`).toBeLessThanOrEqual(Number(prepared.deadline));
      const submitted = await service.worker(prepared.executionId, keyPath!);
      if (submitted.state !== 'PENDING') throw new Error(submitted.code ?? 'MODE_B_WORKER_PRECHECK_FAILED');
      const restarted = createModeBService({ ...profile, journalDir: dir }, call);
      expect((await restarted.worker(prepared.executionId, keyPath!)).state).toBe('CONFIRMED');
      const outcome = await restarted.reconcile(prepared.executionId);
      expect(outcome.outcome).toBe('RECONCILED');
      expect(outcome.remainingBudget).toBe('0');
      expect(await direct(baseCall), 'replay of the executed call after the one-time budget is consumed').toBe(false);
      for (const [index, tx] of prepared.compiled.revocation.entries()) {
        const nonce = BigInt(await call('eth_getTransactionCount', [profile.owner, 'pending']) as string);
        const block = await service.chain();
        const hash = await mutate('eth_sendRawTransaction', [signOwner(tx.to, tx.data, nonce, block.baseFeePerGas * 2n + 1_000_000n)]) as string;
        expect((await receipt(hash)).status).toBe('0x1');
        await service.confirm(prepared.executionId, 'revocation', index, hash);
      }
      const revoked = await service.status(prepared.executionId);
      expect(revoked.moduleEnabled).toBe(false);
      expect(revoked.executorEnabled).toBe(false);
      expect(revoked.residualTokenAllowance).toBe('0');
      expect(await direct(baseCall), 'revoked authority').toBe(false);
    } finally {
      ownerKey.fill(0); executorKey.fill(0);
      await mutate('evm_revert', [snapshot]);
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
