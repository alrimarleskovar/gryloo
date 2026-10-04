// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { editorReducer, initialEditor } from '../domain/editor';
import { BASE_SEPOLIA, createPublicTestnetService, explorerUrl, publicRecordingEnabled, type Rpc } from './public-testnet-service';

const account = '0x1111111111111111111111111111111111111111';
const sponsor = '0x2222222222222222222222222222222222222222';
const delegationManager = '0xdb9b1e94b5b69df7e401ddbede43491141047db3';
const delegatorImpl = '0x63c0c19a282a1b52b07dd5a65b58948a07dae32b';
const txHash = '0x' + 'a'.repeat(64);
const blockHash = '0x' + 'b'.repeat(64);
const word = (n: bigint) => '0x' + n.toString(16).padStart(64, '0');
const signedWord = (n: bigint) => word(n < 0n ? (1n << 256n) + n : n);
const addressWord = (a: string) => '0x' + a.slice(2).padStart(64, '0');
function delegatedEnvelope(target: string, data: string): string {
  const bytes = (value: string) => word(BigInt((value.length - 2) / 2)).slice(2) + value.slice(2).padEnd(Math.ceil((value.length - 2) / 64) * 64, '0');
  const one = (value: string) => word(1n).slice(2) + word(32n).slice(2) + bytes(value);
  const contexts = one('0x1234');
  const modes = word(1n).slice(2) + word(0n).slice(2);
  const call = '0x' + target.slice(2) + word(0n).slice(2) + data.slice(2);
  const calls = one(call);
  const contextOffset = 96n, modeOffset = contextOffset + BigInt(contexts.length / 2);
  const callsOffset = modeOffset + BigInt(modes.length / 2);
  return '0xcef6d209' + word(contextOffset).slice(2) + word(modeOffset).slice(2) + word(callsOffset).slice(2) + contexts + modes + calls;
}
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function workflow() {
  const start = initialEditor();
  const result = editorReducer(start, { type: 'ADD_TESTNET_SWAP', direction: 'USDC_TO_WETH', amount: '2',
    slippage: '50', source: 'CANVAS', baseRevision: 0 }, createBaseSepoliaReviewContext());
  expect(result.error).toBeNull();
  return structuredClone(result.workflow) as unknown as SemanticWorkflow;
}
function fixture(options: { pool?: string; balance?: bigint; gas?: bigint; output?: bigint; receiptStatus?: string;
  delegated?: boolean; delegatedType?: '0x2' | '0x4'; delegatedTarget?: string; preconfirmedReads?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gryloo-public-test-')); dirs.push(dir);
  let allowance = 2_000_000n;
  let input = options.balance ?? 4_000_000n;
  let output = options.output ?? 0n;
  let native = options.gas ?? 10n ** 18n;
  let submitted = false;
  let preconfirmed = options.preconfirmedReads ?? 0;
  let clock = 1701839100000;
  let quotedOutput = 1_000_000_000_000_000n;
  const rpc: Rpc = async (method, params) => {
    if (method === 'eth_chainId') return BASE_SEPOLIA.chainHex;
    if (method === 'eth_blockNumber') return '0x64';
    if (method === 'eth_getBlockByNumber') return params[0] === '0x65' ? { number: '0x65', hash: blockHash, timestamp: '0x' + (1701839102).toString(16), transactions: [txHash] }
      : { number: '0x64', hash: blockHash, timestamp: '0x' + (1701839100).toString(16) };
    if (method === 'eth_getCode') return options.delegated && params[0] === account ? '0xef0100' + delegatorImpl.slice(2) : '0x6000';
    if (method === 'eth_gasPrice') return '0x3b9aca00';
    if (method === 'eth_getBalance') return '0x' + native.toString(16);
    if (method === 'eth_estimateGas') return '0x186a0';
    if (method === 'eth_getTransactionReceipt') {
      if (!submitted) return null;
      const saved = JSON.parse(readFileSync(join(dir, serviceRunId + '.json'), 'utf8'));
      const attempt = saved.attempts.at(-1);
      const nested = options.delegatedType === '0x2';
      // A Base Flashblocks preconfirmation: the block is not sealed yet and the receipt's block hash is all zero.
      const zero = preconfirmed > 0; if (zero) preconfirmed -= 1;
      return { transactionHash: txHash, status: options.receiptStatus ?? '0x1', blockNumber: '0x65', blockHash: zero ? '0x' + '0'.repeat(64) : blockHash,
        from: options.delegated ? sponsor : account, to: options.delegated ? delegationManager : attempt.tx.to,
        gasUsed: nested ? '0x7358d' : options.delegated ? '0x2c189' : '0x186a0',
        effectiveGasPrice: options.delegated ? '0x5b8d81' : '0x3b9aca00',
        l1Fee: nested ? '0xb2dece3a8' : options.delegated ? '0x65fc49983' : '0x0',
        logs: options.delegated ? [
          ...(nested ? [{ address: delegationManager, topics: [
            '0x40dadaa36c6c2e3d7317e24757451ffb2d603d875f0ad5e92c5dd156573b1873',
            addressWord(account), addressWord(account) ] }] : []),
          { address: delegationManager, topics: [
            '0x40dadaa36c6c2e3d7317e24757451ffb2d603d875f0ad5e92c5dd156573b1873', addressWord(account), addressWord(sponsor) ] },
          ...(attempt.step === 'approval' ? [{ address: BASE_SEPOLIA.usdc, topics: [
            '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
            addressWord(account), addressWord(BASE_SEPOLIA.router) ], data: word(2_000_000n) }] : []),
          ...(attempt.step === 'swap' ? [
            { address: BASE_SEPOLIA.weth, topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              addressWord(BASE_SEPOLIA.pool), addressWord(account) ], data: word(output) },
            { address: BASE_SEPOLIA.usdc, topics: [
              '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
              addressWord(account), addressWord(BASE_SEPOLIA.pool) ], data: word(2_000_000n) },
            { address: BASE_SEPOLIA.pool, topics: [
              '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
              addressWord(BASE_SEPOLIA.router), addressWord(account) ],
              data: word(2_000_000n) + signedWord(-output).slice(2) },
          ] : []),
        ] : [] };
    }
    if (method === 'eth_getTransactionByHash') {
      const saved = JSON.parse(readFileSync(join(dir, serviceRunId + '.json'), 'utf8'));
      const tx = saved.attempts.at(-1).tx;
      const delegatedType = options.delegatedType ?? '0x4';
      const inner = delegatedEnvelope(options.delegatedTarget ?? tx.to, tx.data);
      return options.delegated ? { hash: txHash, from: sponsor, to: delegationManager,
        input: delegatedType === '0x2' ? delegatedEnvelope(delegationManager, inner) : inner,
        chainId: BASE_SEPOLIA.chainHex, type: delegatedType, nonce: '0x1d033', value: '0x0',
        ...(delegatedType === '0x4' ? { authorizationList: [
          { chainId: BASE_SEPOLIA.chainHex, address: delegatorImpl }] } : {}) } :
        { hash: txHash, from: account, to: tx.to, input: tx.data, chainId: BASE_SEPOLIA.chainHex,
          type: '0x2', nonce: '0x0', value: '0x0' };
    }
    if (method === 'eth_call') {
      const request = params[0] as { to: string; data: string };
      const selector = request.data.slice(0, 10);
      if (selector === '0xc45a0155') return addressWord(BASE_SEPOLIA.factory);
      if (selector === '0x4aa4a4fc') return addressWord(BASE_SEPOLIA.weth);
      if (selector === '0x313ce567') return word(request.to === BASE_SEPOLIA.usdc ? 6n : 18n);
      if (selector === '0x1698ee82') return addressWord(options.pool ?? BASE_SEPOLIA.pool);
      if (selector === '0x0dfe1681') return addressWord(BASE_SEPOLIA.usdc);
      if (selector === '0xd21220a7') return addressWord(BASE_SEPOLIA.weth);
      if (selector === '0xddca3f43') return word(500n);
      if (selector === '0x1a686502') return word(1_000_000n);
      if (selector === '0x3850c7bd') return word(1n);
      if (selector === '0xc6a5026a') return word(quotedOutput);
      if (selector === '0xdd62ed3e') return word(allowance);
      if (selector === '0x70a08231') return word(request.to === BASE_SEPOLIA.usdc ? input : output);
    }
    throw new Error('UNEXPECTED_RPC_' + method);
  };
  let serviceRunId = '';
  const service = createPublicTestnetService({ rpc, journalDir: dir, now: () => new Date(clock) });
  return { service, dir, setRunId(id: string) { serviceRunId = id; },
    confirm(received = 1_000_000_000_000_000n) { submitted = true; input = 2_000_000n; output = received;
      if (!options.delegated) native -= 100_000n * 1_000_000_000n; },
    confirmApproval() { submitted = true; allowance = 2_000_000n; if (!options.delegated) native -= 100_000n * 1_000_000_000n; },
    setAllowance(value: bigint) { allowance = value; }, advance(ms: number) { clock += ms; },
    changeQuote(value: bigint) { quotedOutput = value; } };
}

describe('public testnet execution boundary', () => {
  it('pins the exact chain and requires an explicit local recording gate', () => {
    expect(BASE_SEPOLIA.chainId).toBe(84532);
    expect(publicRecordingEnabled({ NODE_ENV: 'development', GRYLOO_PUBLIC_TESTNET: 'record', GRYLOO_PUBLIC_TESTNET_JOURNAL: '/tmp/journal' })).toBe(true);
    expect(publicRecordingEnabled({ NODE_ENV: 'test', GRYLOO_PUBLIC_TESTNET: 'record', GRYLOO_PUBLIC_TESTNET_JOURNAL: '/tmp/journal' })).toBe(false);
    expect(explorerUrl(txHash)).toBe('https://sepolia.basescan.org/tx/' + txHash);
  });
  it('fails closed if Factory returns another pool or the owner lacks input or native gas', async () => {
    await expect(fixture({ pool: account }).service.prepare(workflow())).rejects.toThrow('POOL_FACTORY_MISMATCH');
    const lowInput = fixture({ balance: 1n });
    const run = await lowInput.service.prepare(workflow());
    lowInput.service.review(run.quote.executionId, run.quote.manifestHash);
    await expect(lowInput.service.begin(run.quote.executionId, account)).rejects.toThrow('INSUFFICIENT_INPUT');
    const lowGas = fixture({ gas: 1n });
    const gasRun = await lowGas.service.prepare(workflow());
    lowGas.service.review(gasRun.quote.executionId, gasRun.quote.manifestHash);
    await expect(lowGas.service.begin(gasRun.quote.executionId, account)).rejects.toThrow('INSUFFICIENT_TEST_ETH');
  });
  it('retires stale or materially changed quotes before a transaction artifact is prepared', async () => {
    const stale = fixture(); const first = await stale.service.prepare(workflow());
    stale.service.review(first.quote.executionId, first.quote.manifestHash);
    stale.advance(61_000);
    await expect(stale.service.begin(first.quote.executionId, account)).rejects.toThrow('QUOTE_EXPIRED_REVIEW_REQUIRED');
    expect(stale.service.load(first.quote.executionId).reviewedManifestHash).toBeNull();
    const changed = fixture(); const second = await changed.service.prepare(workflow());
    changed.service.review(second.quote.executionId, second.quote.manifestHash);
    changed.changeQuote(2_000_000_000_000_000n);
    await expect(changed.service.begin(second.quote.executionId, account)).rejects.toThrow('QUOTE_CHANGED_REVIEW_REQUIRED');
    expect(changed.service.load(second.quote.executionId).attempts).toHaveLength(0);
  });
  it('persists the attempt before send, blocks duplication, and reconciles a public receipt', async () => {
    const f = fixture();
    const run = await f.service.prepare(workflow()); f.setRunId(run.quote.executionId);
    f.service.review(run.quote.executionId, run.quote.manifestHash);
    const begun = await f.service.begin(run.quote.executionId, account);
    expect(begun.attempt.state).toBe('PREPARED');
    expect(begun.attempt.environment).toBe('PUBLIC_TESTNET');
    expect(JSON.parse(readFileSync(join(f.dir, run.quote.executionId + '.json'), 'utf8')).attempts[0].state).toBe('PREPARED');
    await expect(f.service.begin(run.quote.executionId, account)).rejects.toThrow('ATTEMPT_ALREADY_ACTIVE');
    f.service.report(run.quote.executionId, begun.attempt.attemptId, { kind: 'HASH', txHash });
    expect(f.service.load(run.quote.executionId).attempts[0]?.txHash).toBe(txHash);
    expect((await f.service.observe(run.quote.executionId)).attempts[0]?.state).toBe('PENDING');
    f.confirm();
    const completed = await f.service.observe(run.quote.executionId);
    expect(completed.outcome?.outputReceived).toBe('1000000000000000');
    expect(completed.outcome?.inputSpent).toBe('2000000');
    expect(completed.outcome?.gasCostWei).toBe('100000000000000');
    expect(completed.outcome?.evidence.environment).toBe('TESTNET_EXECUTED');
    await expect(f.service.begin(run.quote.executionId, account)).rejects.toThrow('ATTEMPT_ALREADY_ACTIVE');
  });
  it('keeps a preconfirmed zero-block-hash receipt pending and reconciles only the later canonical receipt', async () => {
    const f = fixture({ delegated: true, delegatedType: '0x2', preconfirmedReads: 2 });
    const run = await f.service.prepare(workflow()); f.setRunId(run.quote.executionId);
    f.service.review(run.quote.executionId, run.quote.manifestHash);
    const begun = await f.service.begin(run.quote.executionId, account);
    f.service.report(run.quote.executionId, begun.attempt.attemptId, { kind: 'HASH', txHash });
    f.confirm();
    for (let read = 0; read < 2; read++) {
      const pending = await f.service.observe(run.quote.executionId);
      expect(pending.attempts[0]).toMatchObject({ state: 'PENDING', receipt: null });
      expect(pending.outcome).toBeNull();
    }
    const completed = await f.service.observe(run.quote.executionId);
    expect(completed.attempts[0]?.receipt?.blockHash).toBe(blockHash);
    expect(completed.outcome?.evidence.environment).toBe('TESTNET_EXECUTED');
    expect(JSON.stringify(completed)).not.toContain('0x' + '0'.repeat(64));
  });
  it('records an approval receipt separately and does not promote it as swap evidence', async () => {
    const f = fixture(); f.setAllowance(0n);
    const run = await f.service.prepare(workflow()); f.setRunId(run.quote.executionId);
    f.service.review(run.quote.executionId, run.quote.manifestHash);
    const approval = await f.service.begin(run.quote.executionId, account);
    expect(approval.attempt.step).toBe('approval');
    expect(approval.tx.to).toBe(BASE_SEPOLIA.usdc);
    f.service.report(run.quote.executionId, approval.attempt.attemptId, { kind: 'HASH', txHash });
    f.confirmApproval();
    const approved = await f.service.observe(run.quote.executionId);
    expect(approved.attempts[0]?.state).toBe('CONFIRMED');
    expect(approved.attempts[0]?.nativeAfter).toBe('999900000000000000');
    expect(approved.outcome).toBeNull();
    const swap = await f.service.begin(run.quote.executionId, account);
    expect(swap.attempt.step).toBe('swap');
  });
  it('recovers an expired-quote approval sent as one exact MetaMask delegated call without a second send', async () => {
    const f = fixture({ delegated: true }); f.setAllowance(0n);
    const run = await f.service.prepare(workflow()); f.setRunId(run.quote.executionId);
    f.service.review(run.quote.executionId, run.quote.manifestHash);
    const approval = await f.service.begin(run.quote.executionId, account);
    f.service.report(run.quote.executionId, approval.attempt.attemptId, { kind: 'HASH', txHash });
    f.confirmApproval(); f.advance(61_000);
    const recovered = await f.service.observe(run.quote.executionId);
    expect(recovered.quote.manifestHash).toBe(run.quote.manifestHash);
    expect(recovered.attempts).toHaveLength(1);
    expect(recovered.attempts[0]?.step).toBe('approval');
    expect(recovered.attempts[0]?.state).toBe('CONFIRMED');
    expect(recovered.attempts[0]?.nativeAfter).toBe('1000000000000000000');
    expect(recovered.attempts[0]?.receipt).toMatchObject({ submissionKind: 'DELEGATED_SINGLE',
      from: sponsor, to: delegationManager, executionTarget: BASE_SEPOLIA.usdc,
      delegationDepth: 1, executionCalldataDigest: approval.attempt.calldataDigest,
      executionGasCostWei: '1083702180617', l1FeeWei: '27376523651',
      gasCostWei: '1111078704268', gasPayer: sponsor, nonce: '118835' });
    expect(recovered.outcome).toBeNull();
  });
  it('refreshes the persisted swap after approval recovery without using the reloaded default canvas', async () => {
    const f = fixture({ delegated: true }); f.setAllowance(0n);
    const run = await f.service.prepare(workflow()); f.setRunId(run.quote.executionId);
    f.service.review(run.quote.executionId, run.quote.manifestHash);
    const approval = await f.service.begin(run.quote.executionId, account);
    f.service.report(run.quote.executionId, approval.attempt.attemptId, { kind: 'HASH', txHash });
    f.confirmApproval(); f.advance(61_000);
    const recovered = await f.service.observe(run.quote.executionId);
    await expect(f.service.prepare(initialEditor().workflow as unknown as SemanticWorkflow))
      .rejects.toThrow('PUBLIC_WORKFLOW_UNSUPPORTED');
    const refreshed = await f.service.refresh(run.quote.executionId);
    expect(refreshed.quote.executionId).toBe(run.quote.executionId);
    expect(refreshed.quote.manifestHash).not.toBe(recovered.quote.manifestHash);
    expect(refreshed.reviewedManifestHash).toBeNull();
    expect(refreshed.attempts).toEqual(recovered.attempts);
    expect(refreshed.quote.amountIn).toBe('2000000');
    expect(refreshed.quote.slippageBps).toBe(50);
    const reviewed = f.service.review(run.quote.executionId, refreshed.quote.manifestHash);
    expect(reviewed.reviewedManifestHash).toBe(refreshed.quote.manifestHash);
    const next = await f.service.begin(run.quote.executionId, account);
    expect(next.attempt.step).toBe('swap');
    expect(next.tx.to).toBe(BASE_SEPOLIA.router);
    expect(f.service.load(run.quote.executionId).attempts[0]).toEqual(recovered.attempts[0]);
  });
  it('keeps a delegated approval hash unresolved when its sole inner target differs', async () => {
    const f = fixture({ delegated: true, delegatedTarget: BASE_SEPOLIA.weth }); f.setAllowance(0n);
    const run = await f.service.prepare(workflow()); f.setRunId(run.quote.executionId);
    f.service.review(run.quote.executionId, run.quote.manifestHash);
    const approval = await f.service.begin(run.quote.executionId, account);
    f.service.report(run.quote.executionId, approval.attempt.attemptId, { kind: 'HASH', txHash });
    f.confirmApproval();
    await expect(f.service.observe(run.quote.executionId)).rejects.toThrow('TRANSACTION_MISMATCH');
    expect(f.service.load(run.quote.executionId).attempts[0]?.state).toBe('HASH');
    expect(f.service.load(run.quote.executionId).outcome).toBeNull();
  });
  it('reconciles a nested type-2 sponsored swap on existing allowance without preparing an approval', async () => {
    const f = fixture({ delegated: true, delegatedType: '0x2' });
    const run = await f.service.prepare(workflow()); f.setRunId(run.quote.executionId);
    f.service.review(run.quote.executionId, run.quote.manifestHash);
    const begun = await f.service.begin(run.quote.executionId, account);
    expect(begun.attempt.step).toBe('swap');
    expect(begun.tx.to).toBe(BASE_SEPOLIA.router);
    expect(begun.attempt.allowanceBefore).toBe('2000000');
    f.service.report(run.quote.executionId, begun.attempt.attemptId, { kind: 'HASH', txHash });
    f.confirm();
    const completed = await f.service.observe(run.quote.executionId);
    expect(completed.attempts).toHaveLength(1);
    expect(completed.attempts[0]?.nativeAfter).toBe('1000000000000000000');
    expect(completed.attempts[0]?.receipt).toMatchObject({ submissionKind: 'DELEGATED_SINGLE',
      delegationDepth: 2, executionTarget: BASE_SEPOLIA.router,
      executionCalldataDigest: begun.attempt.calldataDigest, gasPayer: sponsor,
      executionGasCostWei: '2834766472461', l1FeeWei: '48015139752', gasCostWei: '2882781612213' });
    expect(completed.outcome).toMatchObject({ inputSpent: '2000000', outputReceived: '1000000000000000',
      nativeAfter: '1000000000000000000', gasCostWei: '2882781612213' });
    expect(completed.outcome?.evidence.environment).toBe('TESTNET_EXECUTED');
  });
  it('rejects a nested sponsored swap when its final inner target differs from Router02', async () => {
    const f = fixture({ delegated: true, delegatedType: '0x2', delegatedTarget: BASE_SEPOLIA.usdc });
    const run = await f.service.prepare(workflow()); f.setRunId(run.quote.executionId);
    f.service.review(run.quote.executionId, run.quote.manifestHash);
    const begun = await f.service.begin(run.quote.executionId, account);
    expect(begun.attempt.step).toBe('swap');
    f.service.report(run.quote.executionId, begun.attempt.attemptId, { kind: 'HASH', txHash });
    f.confirm();
    await expect(f.service.observe(run.quote.executionId)).rejects.toThrow('TRANSACTION_MISMATCH');
    expect(f.service.load(run.quote.executionId).attempts[0]?.state).toBe('HASH');
    expect(f.service.load(run.quote.executionId).outcome).toBeNull();
  });
  it('refuses evidence when actual output falls below the authorized minimum', async () => {
    const f = fixture(); const run = await f.service.prepare(workflow()); f.setRunId(run.quote.executionId);
    f.service.review(run.quote.executionId, run.quote.manifestHash);
    const begun = await f.service.begin(run.quote.executionId, account);
    f.service.report(run.quote.executionId, begun.attempt.attemptId, { kind: 'HASH', txHash });
    f.confirm(1n);
    await expect(f.service.observe(run.quote.executionId)).rejects.toThrow('RECONCILIATION_MISMATCH');
    expect(f.service.load(run.quote.executionId).outcome).toBeNull();
  });
  it('records wallet rejection and reverts without promoting evidence', async () => {
    const f = fixture({ receiptStatus: '0x0' }); const run = await f.service.prepare(workflow()); f.setRunId(run.quote.executionId);
    f.service.review(run.quote.executionId, run.quote.manifestHash);
    const first = await f.service.begin(run.quote.executionId, account);
    expect(f.service.report(run.quote.executionId, first.attempt.attemptId, { kind: 'REJECTED' }).attempts[0]?.state).toBe('REJECTED');
    const second = await f.service.begin(run.quote.executionId, account);
    f.service.report(run.quote.executionId, second.attempt.attemptId, { kind: 'HASH', txHash });
    f.confirm();
    const reverted = await f.service.observe(run.quote.executionId);
    expect(reverted.attempts.at(-1)?.state).toBe('REVERTED');
    expect(reverted.outcome).toBeNull();
  });
});

if (process.env.GRYLOO_PUBLIC_TESTNET_READ === '1') {
  it('reads a fresh canonical Base Sepolia quote without wallet or submission', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gryloo-public-live-read-')); dirs.push(dir);
    const rpc: Rpc = async (method, params) => {
      const response = await fetch(BASE_SEPOLIA.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
      const payload = await response.json() as { result?: unknown; error?: unknown };
      if (!response.ok || payload.error) throw new Error('LIVE_RPC_READ_FAILED ' + JSON.stringify(payload.error));
      return payload.result;
    };
    const service = createPublicTestnetService({ rpc, journalDir: dir });
    const run = await service.prepare(workflow());
    expect(run.quote.chainId).toBe(84532);
    expect(run.quote.pool).toBe(BASE_SEPOLIA.pool);
    expect(BigInt(run.quote.expectedOut)).toBeGreaterThan(0n);
    expect(run.attempts).toHaveLength(0);
    expect(run.outcome).toBeNull();
  }, 60_000);
}
