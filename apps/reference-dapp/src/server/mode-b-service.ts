// SPDX-License-Identifier: AGPL-3.0-only
/** Local chain-31337 finite Mode B service. Read-only fork RPC; owner requests are returned, never sent. */
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, open, readFile, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { hashArtifactBytes, hashRawBytes, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { compileModeB, modeBCodeHash, FORK_CONTRACTS, BASE_CODE_PINS, type ModeBCompiled, type ModeBProfile } from '@defi-workflow-engine/reference-compiler';
import { decodeSignedTransaction, reconcileModeB, type ModeBReconciliation } from '@defi-workflow-engine/reference-reconciler';
import { createModeBWorker, signModeBLocalTransaction, type ModeBWorkerEvent } from '@defi-workflow-engine/reference-executor';
import { modeASwapFromWorkflow, type ForkCall } from './mode-a-service';

export type ModeBServerProfile = Omit<ModeBProfile, 'semanticWorkflowHash' | 'quoteHash' | 'simulationHash'> & { readonly format: 'gryloo.mode-b-fork-profile.v1'; readonly rpcUrl: string;
  readonly sourceChainId: 8453; readonly sourceBlockNumber: number; readonly environment: 'FORK_REPRODUCED';
  readonly journalDir: string };
export type ModeBPrepared = { readonly format: 'gryloo.mode-b-prepared.v1'; readonly executionId: string;
  readonly revision: number; readonly workflowHash: string; readonly preparedAt: string; readonly quoteBlockHash: string;
  readonly quoteExpiresAt: number; readonly direction: 'WETH_TO_USDC' | 'USDC_TO_WETH'; readonly tokenIn: string;
  readonly tokenOut: string; readonly amountIn: string; readonly quotedOut: string; readonly minimumOut: string;
  readonly fee: number; readonly deadline: string; readonly simulationHash: string; readonly simulationGas: string;
  readonly compiled: ModeBCompiled; readonly installationStart: number; readonly installation: readonly { readonly index: number; readonly hash: string }[];
  readonly beforeInputBalance: string; readonly beforeOutputBalance: string; readonly executionHash: string | null;
  readonly reconciliation: ModeBReconciliation | null; readonly revocation: readonly { readonly index: number; readonly hash: string }[] };
const HASH = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const EXECUTION = /^exec-[0-9a-f]{24}$/;
const FORK_ID = '0x7a69';
const asWord = (n: bigint): string => n.toString(16).padStart(64, '0');
const addressWord = (a: string): string => a.slice(2).toLowerCase().padStart(64, '0');
const word = (data: string, offset = 0): bigint => BigInt('0x' + data.slice(2 + offset * 2, 66 + offset * 2));
const bytes = (value: string) => Uint8Array.from(Buffer.from(value.slice(2), 'hex'));
const lower = (value: string) => value.toLowerCase();
const required = (value: unknown, label: string): string => { if (typeof value !== 'string') throw new Error(label); return value; };
function checkProfile(profile: ModeBServerProfile): void {
  if (profile.format !== 'gryloo.mode-b-fork-profile.v1' || profile.environment !== 'FORK_REPRODUCED' || profile.chainId !== 31337 ||
    profile.sourceChainId !== 8453 || !Number.isSafeInteger(profile.sourceBlockNumber) || !HASH.test(profile.sourceBlockHash) ||
    !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(profile.rpcUrl) || !profile.journalDir.startsWith('/')) throw new Error('MODE_B_PROFILE_INVALID');
  for (const value of [profile.safe, profile.roles, profile.owner, profile.executor]) if (!ADDRESS.test(lower(value))) throw new Error('MODE_B_PROFILE_INVALID');
  for (const value of [profile.safeCodeHash, profile.rolesCodeHash]) if (!HASH.test(value)) throw new Error('MODE_B_PROFILE_INVALID');
  if (lower(profile.owner) === lower(profile.executor)) throw new Error('MODE_B_PROFILE_INVALID');
}
export function createModeBService(profile: ModeBServerProfile, call: ForkCall) {
  checkProfile(profile);
  const path = (id: string) => { if (!EXECUTION.test(id)) throw new Error('MODE_B_EXECUTION_INVALID'); return join(profile.journalDir, id, 'prepared.json'); };
  async function read(id: string): Promise<ModeBPrepared> {
    const value = JSON.parse(await readFile(path(id), 'utf8')) as ModeBPrepared;
    if (value?.format !== 'gryloo.mode-b-prepared.v1' || value.executionId !== id) throw new Error('MODE_B_RECORD_INVALID');
    return value;
  }
  async function save(value: ModeBPrepared): Promise<void> {
    const file = path(value.executionId);
    await mkdir(join(profile.journalDir, value.executionId), { recursive: true, mode: 0o700 });
    // A new immutable record per update; serialized by the server action layer.
    const temp = file + '.' + randomBytes(8).toString('hex') + '.tmp';
    const handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
    const fs = await import('node:fs/promises');
    await fs.rename(temp, file);
    const dir = await open(join(profile.journalDir, value.executionId), 'r');
    try { await dir.sync(); } finally { await dir.close(); }
  }
  async function direct(to: string, data: string, block: unknown = 'latest'): Promise<string> {
    return lower(required(await call('eth_call', [{ to, data }, block]), 'MODE_B_READ_INVALID'));
  }
  async function chain(): Promise<{ number: number; hash: string; timestamp: number; baseFeePerGas: bigint }> {
    if (await call('eth_chainId') !== FORK_ID) throw new Error('MODE_B_CHAIN_INVALID');
    const block = await call('eth_getBlockByNumber', ['latest', false]) as { number?: string; hash?: string; timestamp?: string; baseFeePerGas?: string };
    if (!block || typeof block.number !== 'string' || !HASH.test(block.hash ?? '') || typeof block.timestamp !== 'string' || typeof block.baseFeePerGas !== 'string') throw new Error('MODE_B_BLOCK_INVALID');
    return { number: Number(BigInt(block.number)), hash: block.hash!, timestamp: Number(BigInt(block.timestamp)), baseFeePerGas: BigInt(block.baseFeePerGas) };
  }
  async function code(to: string, pin: string): Promise<void> {
    const value = required(await call('eth_getCode', [to, 'latest']), 'MODE_B_CODE_INVALID');
    if (modeBCodeHash(value) !== pin) throw new Error('MODE_B_CODE_PIN_MISMATCH');
  }
  async function boundary(): Promise<void> {
    await chain();
    await code(profile.safe, profile.safeCodeHash); await code(profile.roles, profile.rolesCodeHash);
    const owner = await direct(profile.roles, '0x8da5cb5b');
    const avatar = await direct(profile.roles, '0x5aef7de6');
    const target = await direct(profile.roles, '0xd4b83992');
    const safeOwners = await direct(profile.safe, '0xa0e67e2b');
    const threshold = await direct(profile.safe, '0xe75235b8');
    if (![lower(profile.owner), lower(profile.safe)].includes(lower('0x' + owner.slice(-40))) || lower('0x' + avatar.slice(-40)) !== lower(profile.safe) ||
      lower('0x' + target.slice(-40)) !== lower(profile.safe) || word(safeOwners, 32) !== 1n ||
      lower('0x' + safeOwners.slice(-40)) !== lower(profile.owner) || word(threshold) !== 1n) throw new Error('MODE_B_OWNER_MISMATCH');
  }
  async function prepare(workflow: SemanticWorkflow): Promise<ModeBPrepared> {
    const swap = modeASwapFromWorkflow(workflow);
    const workflowHash = hashArtifactBytes('semantic-workflow', new TextEncoder().encode(JSON.stringify(workflow)));
    const head = await chain();
    for (const [name, address] of Object.entries(FORK_CONTRACTS)) {
      if (name in BASE_CODE_PINS) {
        const runtime = required(await call('eth_getCode', [address, 'latest']), 'MODE_B_CODE_INVALID');
        const digest = '0x' + createHash('sha256').update(bytes(runtime)).digest('hex');
        if (digest !== BASE_CODE_PINS[name as keyof typeof BASE_CODE_PINS]) throw new Error('MODE_B_CODE_PIN_MISMATCH');
      }
    }
    const tokenIn = swap.direction === 'WETH_TO_USDC' ? FORK_CONTRACTS.weth : FORK_CONTRACTS.usdc;
    const tokenOut = swap.direction === 'WETH_TO_USDC' ? FORK_CONTRACTS.usdc : FORK_CONTRACTS.weth;
    const tiers = [100, 500, 3000, 10000] as const;
    const quotes: { fee: typeof tiers[number]; out: bigint; raw: string }[] = [];
    for (const fee of tiers) {
      try {
        const raw = await direct(FORK_CONTRACTS.quoter, `0xc6a5026a${addressWord(tokenIn)}${addressWord(tokenOut)}${asWord(swap.amountIn)}${asWord(BigInt(fee))}${asWord(0n)}`,
          { blockHash: head.hash, requireCanonical: true });
        const out = word(raw);
        if (out > 0n) quotes.push({ fee, out, raw });
      } catch { /* a non-existent tier is not a valid quote */ }
    }
    const selected = quotes.sort((a, b) => a.out === b.out ? a.fee - b.fee : a.out > b.out ? -1 : 1)[0];
    if (!selected) throw new Error('MODE_B_NO_QUOTE');
    const minimumOut = selected.out * BigInt(10_000 - swap.slippageBps) / 10_000n;
    // Anvil may jump from the recorded Base timestamp to current local wall time on its first mined block.
    const forkNow = Math.max(head.timestamp, Math.floor(Date.now() / 1000));
    const deadline = BigInt(forkNow + 1800);
    const quoteHash = hashRawBytes('raw-response', new TextEncoder().encode(JSON.stringify({ blockHash: head.hash, ...selected, out: selected.out.toString() })));
    const salt = '0x' + randomBytes(32).toString('hex');
    const initialProfile = { ...profile, semanticWorkflowHash: workflowHash, quoteHash, simulationHash: '0x' + '0'.repeat(64) };
    const swapArgs = { tokenIn, tokenOut, fee: selected.fee, recipient: profile.safe, amountIn: swap.amountIn,
      amountOutMinimum: minimumOut, sqrtPriceLimitX96: 0n as const, deadline };
    const safeEnabled = word(await direct(profile.safe, '0x2d9ad53d' + addressWord(profile.roles))) === 1n;
    const rolesOwner = lower('0x' + (await direct(profile.roles, '0x8da5cb5b')).slice(-40));
    if (rolesOwner !== lower(profile.owner) && rolesOwner !== lower(profile.safe)) throw new Error('MODE_B_ROLES_OWNER_INVALID');
    const setup = { rolesOwnerIsSafe: rolesOwner === lower(profile.safe), moduleEnabled: safeEnabled };
    const provisional = compileModeB(initialProfile, swapArgs, salt, setup);
    const transactions = provisional.installation;
    const start = 0;
    const ownerNonce = BigInt(required(await call('eth_getTransactionCount', [profile.owner, 'latest']), 'MODE_B_NONCE_INVALID'));
    const executorNonce = BigInt(required(await call('eth_getTransactionCount', [profile.executor, 'latest']), 'MODE_B_NONCE_INVALID'));
    const maxFeePerGas = '0x' + (head.baseFeePerGas * 2n + 1_000_000_000n).toString(16);
    const maxPriorityFeePerGas = '0x3b9aca00';
    const simulateCalls = transactions.slice(start).map((tx, index) => ({ from: profile.owner, to: tx.to, data: tx.data,
      nonce: '0x' + (ownerNonce + BigInt(index)).toString(16), gas: '0x2dc6c0', maxFeePerGas, maxPriorityFeePerGas, value: '0x0' }));
    simulateCalls.push({ from: profile.executor, to: provisional.executorCall.to, data: provisional.executorCall.data,
      nonce: '0x' + executorNonce.toString(16), gas: '0x2dc6c0', maxFeePerGas, maxPriorityFeePerGas, value: '0x0' });
    const simulation = await call('eth_simulateV1', [{ blockStateCalls: [{ calls: simulateCalls }], validation: true,
      traceTransfers: false, returnFullTransactions: false }, { blockHash: head.hash, requireCanonical: true }]);
    const simRows = (simulation as { calls?: { status?: string; gasUsed?: string }[] }[])?.[0]?.calls;
    if (!Array.isArray(simRows) || simRows.length !== simulateCalls.length || simRows.some(row => row.status !== '0x1')) throw new Error('MODE_B_SIMULATION_FAILED');
    const simulationHash = hashRawBytes('raw-response', new TextEncoder().encode(JSON.stringify(simulation)));
    const compiled = compileModeB({ ...initialProfile, simulationHash }, swapArgs, salt, setup);
    if (JSON.stringify(compiled.installation) !== JSON.stringify(provisional.installation) || compiled.executorCall.data !== provisional.executorCall.data) throw new Error('MODE_B_SIMULATION_BINDING_CHANGED');
    const beforeInputBalance = word(await direct(tokenIn, '0x70a08231' + addressWord(profile.safe))).toString();
    const beforeOutputBalance = word(await direct(tokenOut, '0x70a08231' + addressWord(profile.safe))).toString();
    const executionId = 'exec-' + randomBytes(12).toString('hex');
    const prepared: ModeBPrepared = { format: 'gryloo.mode-b-prepared.v1', executionId, revision: workflow.revision, workflowHash,
      preparedAt: new Date(forkNow * 1000).toISOString(), quoteBlockHash: head.hash, quoteExpiresAt: forkNow + 600,
      direction: swap.direction, tokenIn, tokenOut, amountIn: swap.amountIn.toString(), quotedOut: selected.out.toString(),
      minimumOut: minimumOut.toString(), fee: selected.fee, deadline: deadline.toString(), simulationHash,
      simulationGas: simRows.at(-1)!.gasUsed ?? '0x0', compiled, installationStart: start, installation: [], beforeInputBalance, beforeOutputBalance, executionHash: null, reconciliation: null, revocation: [] };
    await save(prepared);
    return prepared;
  }
  async function installationStep(id: string, index: number): Promise<{ readonly to: string; readonly data: string }> {
    const prepared = await read(id);
    if (!Number.isSafeInteger(index) || index !== prepared.installationStart + prepared.installation.length ||
      prepared.revocation.length || !prepared.compiled.installation[index]) throw new Error('MODE_B_STEP_ORDER_INVALID');
    if ((await chain()).timestamp > prepared.quoteExpiresAt) throw new Error('MODE_B_QUOTE_EXPIRED');
    await boundary();
    return prepared.compiled.installation[index]!;
  }
  async function confirm(id: string, phase: 'installation' | 'revocation', index: number, txHash: string): Promise<ModeBPrepared> {
    if (!HASH.test(txHash) || !Number.isInteger(index)) throw new Error('MODE_B_INPUT_INVALID');
    const value = await read(id);
    const list = phase === 'installation' ? value.compiled.installation : value.compiled.revocation;
    const already = phase === 'installation' ? value.installation : value.revocation;
    if (!list[index] || index !== (phase === 'installation' ? value.installationStart + already.length : already.length)) throw new Error('MODE_B_STEP_ORDER_INVALID');
    const receipt = await call('eth_getTransactionReceipt', [txHash]) as { status?: string } | null;
    const raw = await call('eth_getRawTransactionByHash', [txHash]);
    if (receipt?.status !== '0x1' || typeof raw !== 'string') throw new Error('MODE_B_TX_UNCONFIRMED');
    const parsed = decodeSignedTransaction(bytes(raw), txHash);
    if (lower(parsed.signer) !== lower(profile.owner) || lower(parsed.unsigned.to) !== lower(list[index].to) ||
      lower('0x' + Buffer.from(parsed.unsigned.data).toString('hex')) !== lower(list[index].data)) throw new Error('MODE_B_INSTALLATION_MISMATCH');
    const next = { ...value, [phase]: [...already, { index, hash: txHash }] } as ModeBPrepared;
    await save(next); return next;
  }
  async function status(id: string): Promise<{ prepared: ModeBPrepared; remainingBudget: string; residualTokenAllowance: string; moduleEnabled: boolean; executorEnabled: boolean }> {
    const prepared = await read(id);
    const allowance = await direct(profile.roles, '0x5e7c9fe8' + prepared.compiled.allowanceKey.slice(2));
    const moduleEnabled = word(await direct(profile.safe, '0x2d9ad53d' + addressWord(profile.roles))) === 1n;
    const executorEnabled = word(await direct(profile.roles, '0x2d9ad53d' + addressWord(profile.executor))) === 1n;
    const residualTokenAllowance = await direct(prepared.tokenIn, '0xdd62ed3e' + addressWord(profile.safe) + addressWord(FORK_CONTRACTS.router));
    return { prepared, remainingBudget: (word(allowance, 96) * BigInt(prepared.amountIn)).toString(), residualTokenAllowance: word(residualTokenAllowance).toString(), moduleEnabled, executorEnabled };
  }

  async function worker(id: string, keyPath: string): Promise<ModeBWorkerEvent> {
    const prepared = await read(id);
    if ((await chain()).timestamp > Number(prepared.deadline)) throw new Error('MODE_B_DEADLINE_EXPIRED');
    if (prepared.installation.length !== prepared.compiled.installation.length - prepared.installationStart || prepared.revocation.length)
      throw new Error('MODE_B_PERMISSION_NOT_INSTALLED');
    if (!isAbsolute(keyPath) || !keyPath.startsWith('/tmp/')) throw new Error('MODE_B_KEY_PATH_INVALID');
    const file = await stat(keyPath);
    if (!file.isFile() || (file.mode & 0o077) !== 0) throw new Error('MODE_B_KEY_PERMISSIONS_INVALID');
    const effectiveOwner = lower('0x' + (await direct(profile.roles, '0x8da5cb5b')).slice(-40));
    if (effectiveOwner !== lower(profile.safe)) throw new Error('MODE_B_ROLES_NOT_SAFE_OWNED');
    const job = { executionId: id, permissionHash: prepared.compiled.permissionHash, to: prepared.compiled.executorCall.to,
      data: prepared.compiled.executorCall.data, from: profile.executor, expiresAt: Number(prepared.deadline) };
    const driver = {
      chainId: async () => Number(BigInt(required(await call('eth_chainId'), 'MODE_B_CHAIN_INVALID'))),
      now: async () => (await chain()).timestamp,
      permissionActive: async () => {
        const state = await status(id);
        return state.moduleEnabled && state.executorEnabled;
      },
      allowanceRemaining: async () => {
        const state = await status(id);
        return BigInt(state.remainingBudget) === BigInt(prepared.amountIn) ? 1n : 0n;
      },
      receipt: async (hash: string) => {
        const receipt = await call('eth_getTransactionReceipt', [hash]) as { status?: string } | null;
        return receipt ? { status: receipt.status === '0x1' ? 1 as const : 0 as const } : null;
      },
      sendExact: async (request: { readonly from: string; readonly to: string; readonly data: string; readonly value: '0x0' }) => {
        if (lower(request.from) !== lower(profile.executor) || lower(request.to) !== lower(job.to) || request.data !== job.data || request.value !== '0x0')
          throw new Error('MODE_B_WORKER_CALL_CHANGED');
        const keyText = await readFile(keyPath, 'utf8');
        const keyValue = JSON.parse(keyText) as { executor?: unknown };
        if (typeof keyValue.executor !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(keyValue.executor)) throw new Error('MODE_B_LOCAL_KEY_INVALID');
        const key = Uint8Array.from(Buffer.from(keyValue.executor.slice(2), 'hex'));
        let signed: ReturnType<typeof signModeBLocalTransaction>;
        try {
          const nonce = BigInt(required(await call('eth_getTransactionCount', [profile.executor, 'pending']), 'MODE_B_NONCE_INVALID'));
          const head = await chain();
          signed = signModeBLocalTransaction({ expectedExecutor: profile.executor, to: job.to, data: job.data, nonce,
            gasLimit: 1_500_000n, maxFeePerGas: head.baseFeePerGas * 2n + 1_000_000n }, key);
        } finally { key.fill(0); }
        const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: [signed.raw] });
        const response = await fetch(profile.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body,
          signal: AbortSignal.timeout(20_000) });
        const result = await response.json() as { result?: unknown; error?: unknown };
        if (!response.ok || result.error || result.result !== signed.hash) throw new Error('MODE_B_SEND_UNKNOWN');
        return signed.hash;
      },
    };
    const event = await createModeBWorker(join(profile.journalDir, id, 'worker.jsonl'), job, driver).run();
    if (event.transactionHash) {
      const latest = await read(id);
      if (latest.executionHash && latest.executionHash !== event.transactionHash) throw new Error('MODE_B_TRANSACTION_CHANGED');
      if (!latest.executionHash) await save({ ...latest, executionHash: event.transactionHash });
    }
    return event;
  }
  async function reconcile(id: string): Promise<ModeBReconciliation> {
    const prepared = await read(id);
    const events = await createModeBWorker(join(profile.journalDir, id, 'worker.jsonl'), { executionId: id,
      permissionHash: prepared.compiled.permissionHash, to: prepared.compiled.executorCall.to, data: prepared.compiled.executorCall.data,
      from: profile.executor, expiresAt: Number(prepared.deadline) }, {
        chainId: async () => 31337, permissionActive: async () => false, allowanceRemaining: async () => 0n,
        sendExact: async () => { throw new Error('MODE_B_READ_ONLY'); }, receipt: async () => null, now: async () => 0,
      }).events();
    const txHash = events.findLast(event => event.transactionHash)?.transactionHash ?? null;
    if (!txHash) throw new Error('MODE_B_TRANSACTION_UNKNOWN');
    const receipt = await call('eth_getTransactionReceipt', [txHash]) as { status?: string; blockHash?: string } | null;
    const raw = await call('eth_getRawTransactionByHash', [txHash]);
    if (!receipt || typeof raw !== 'string') throw new Error('MODE_B_TRANSACTION_UNCONFIRMED');
    const signed = decodeSignedTransaction(bytes(raw), txHash);
    const statusNow = await status(id);
    const inputBalance = word(await direct(prepared.tokenIn, '0x70a08231' + addressWord(profile.safe)));
    const outputBalance = word(await direct(prepared.tokenOut, '0x70a08231' + addressWord(profile.safe)));
    const rolesOwner = lower('0x' + (await direct(profile.roles, '0x8da5cb5b')).slice(-40));
    const observedSafeCode = modeBCodeHash(required(await call('eth_getCode', [profile.safe, 'latest']), 'MODE_B_CODE_INVALID'));
    const observedRolesCode = modeBCodeHash(required(await call('eth_getCode', [profile.roles, 'latest']), 'MODE_B_CODE_INVALID'));
    const outcome = reconcileModeB({ chainId: 31337, safe: profile.safe, roles: profile.roles, rolesOwner, executor: profile.executor,
      transactionSigner: signed.signer,
      target: FORK_CONTRACTS.router, transactionTo: signed.unsigned.to, transactionInput: '0x' + Buffer.from(signed.unsigned.data).toString('hex'),
      expectedInput: prepared.compiled.executorCall.data, safeCodeHash: observedSafeCode, expectedSafeCodeHash: profile.safeCodeHash,
      rolesCodeHash: observedRolesCode, expectedRolesCodeHash: profile.rolesCodeHash, owner: profile.owner, expectedOwner: profile.owner,
      threshold: 1, moduleEnabled: statusNow.moduleEnabled, roleAssigned: statusNow.executorEnabled,
      allowanceRemaining: BigInt(statusNow.remainingBudget) === BigInt(prepared.amountIn) ? 1n : 0n,
      transactionReceipt: { status: receipt.status === '0x1' ? 1 : 0, blockHash: required(receipt.blockHash, 'MODE_B_RECEIPT_INVALID') },
      inputDebited: BigInt(prepared.beforeInputBalance) - inputBalance,
      outputCredited: outputBalance - BigInt(prepared.beforeOutputBalance), amountIn: BigInt(prepared.amountIn),
      minimumOut: BigInt(prepared.minimumOut), residualTokenAllowance: BigInt(statusNow.residualTokenAllowance) });
    await save({ ...prepared, executionHash: txHash, reconciliation: outcome });
    return outcome;
  }
  async function list(): Promise<readonly { executionId: string; preparedAt: string }[]> {
    let names: string[];
    try { names = await readdir(profile.journalDir); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    const values: { executionId: string; preparedAt: string }[] = [];
    for (const name of names.filter(name => EXECUTION.test(name))) {
      try { const value = await read(name); values.push({ executionId: name, preparedAt: value.preparedAt }); }
      catch { /* a partial local directory is not an execution */ }
    }
    return values.sort((a, b) => b.preparedAt.localeCompare(a.preparedAt));
  }
  return { prepare, installationStep, confirm, status, read, list, chain, boundary, worker, reconcile };
}
export type ModeBService = ReturnType<typeof createModeBService>;
