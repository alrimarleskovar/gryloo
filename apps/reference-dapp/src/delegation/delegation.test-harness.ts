// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-AUTOMATION-002 test harness: delegated execution on a disposable loopback PostgreSQL with a controllable clock, the MOCKED loopback
 * chain doubles in process (Base Sepolia EVM + Solana Devnet), a memory signer provider, an owner with an EVM wallet (an EIP-7702 MetaMask
 * smart account on the double) and a Solana wallet — test keys in this process's memory only — and a software passkey. The owner enrolls
 * Credentials and signs the ONE workflow authorization exactly as the UI does, through the service. Evidence from it is MOCKED.
 */
import { createWorker, createPostgresWorkQueue, type Database, type Logger } from '@defi-workflow-engine/cloud-runtime';
import { associatedTokenAddress, erc7710, fromBase64, serializeSignedTransaction, splDelegation, toBase64 } from '@defi-workflow-engine/reference-compiler';
import { memorySignerProvider, type DelegatedSignerProvider } from '@defi-workflow-engine/reference-executor';
import { evaluateRule } from '../automations/evaluator.ts';
import { automationLogger } from '../automations/log.ts';
import { createPgAutomationStore } from '../automations/pg-store.ts';
import type { PriceSource } from '../automations/price-source.ts';
import { typedId } from '../platform/ids.ts';
import { createTestAuthenticator } from '../passkeys/passkey.test-harness.ts';
import { fromB64url } from '../passkeys/webauthn.ts';
import type { DelegationConfig } from './config.ts';
import { createEvmDouble } from './harness/evm-double.ts';
import { createSolanaDouble, DEVNET_GENESIS } from './harness/solana-double.ts';
import { delegationRuntime, signerAdmin, transportFor } from './runtime.ts';
import { delegationHandlers, executorDeps } from './executor-runtime.ts';
import { createDelegationService } from './service.ts';
import type { Owner } from './pg-store.ts';

export const ORIGIN = 'http://localhost:3999';
export const BASE_SEPOLIA = 'eip155:84532';
export const DEV_USDC = 'BRjpCHtyQLNCo8gqRUr8jtdAj5AjPYQaoqbvcZiHok1k';
const silent: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, child: () => silent } as unknown as Logger;

/** The owners' own wallet keys (a separate in-memory key store, never FloFi's signer provider). */
const ownerKeys = memorySignerProvider();
const word = (v: bigint) => v.toString(16).padStart(64, '0');
/** An EVM wallet of the test (in memory): signs EIP-712 digests as `eth_signTypedData_v4` would. */
export async function evmWallet() {
  const key = await ownerKeys.create('eip155');
  let signatures = 0;
  return { address: key.address, get signatures() { return signatures; },
    async signDigest(digest: string): Promise<string> {
      signatures++;
      const sig = await ownerKeys.signEvmDigest(key.ref, erc7710.bytesOf(digest));
      return '0x' + word(sig.r) + word(sig.s) + (sig.yParity + 27).toString(16);
    } };
}
/** A Solana wallet of the test (in memory): signs a transaction message as `solana:signTransaction` would. */
export async function solanaWallet() {
  const key = await ownerKeys.create('solana');
  let signatures = 0;
  return { address: key.address, get signatures() { return signatures; },
    async signTransaction(messageBase64: unknown): Promise<string> {
      signatures++;
      const message = fromBase64(messageBase64, 4096);
      return toBase64(serializeSignedTransaction([await ownerKeys.signSolanaMessage(key.ref, message)], message));
    } };
}

export type DelegationHarness = Awaited<ReturnType<typeof delegationHarness>>;
export async function delegationHarness(db: Database, options: { readonly start?: Date; readonly tenantId?: string; readonly signer?: DelegatedSignerProvider } = {}) {
  const tenantId = options.tenantId ?? 'default';
  let clock = options.start ?? new Date('2026-10-12T07:00:00.000Z');
  const now = () => new Date(clock.getTime());
  const config: DelegationConfig = { enabled: true, tenantId, mode: 'MOCKED_HARNESS', harnessUrl: 'http://127.0.0.1:1', rpc: {}, passkeyOrigin: ORIGIN,
    signer: { kind: 'memory' }, executor: true, hosted: false };
  const evm = createEvmDouble(84532, () => Math.floor(clock.getTime() / 1000)), sol = createSolanaDouble();
  const intercept: { evm?: (method: string, params: readonly unknown[]) => Promise<unknown> | undefined } = {};
  const evmRpc = async (method: string, params: readonly unknown[]) => { const hook = intercept.evm?.(method, params); return hook ? hook : evm.rpc(method, params); };
  const rpc = (chain: string) => chain === BASE_SEPOLIA ? evmRpc : chain === DEVNET_GENESIS ? sol.rpc : null;
  const signer = options.signer ?? memorySignerProvider();
  const lines: string[] = [];
  const log = (event: string, fields: Readonly<Record<string, unknown>>) => { lines.push(JSON.stringify({ event, ...fields })); };
  const rt = delegationRuntime(config, { db, tenantId }, { rpc, signer, now });
  const automations = createPgAutomationStore(db, tenantId);
  const service = createDelegationService({ config, db, store: rt.store, automations, signer: signerAdmin(signer),
    transport: (chain, purpose) => transportFor(config, chain, purpose, { rpc }), now, newId: typedId, log });
  const deps = executorDeps(rt, log);
  if ('code' in deps) throw new Error(deps.code);
  const prices: PriceSource = { id: 'fixture', maxAgeMs: 3_600_000, assets: ['ETH', 'BTC', 'SOL'], observe: async () => ({ ok: false, code: 'PRICE_SOURCE_OFF' }) };
  const evaluator = { store: automations, price: prices, log: automationLogger({ info: () => undefined, warn: () => undefined }), now, newId: (p: 'occ') => typedId(p) };

  const evmOwner = await evmWallet(), solOwner = await solanaWallet();
  const owner: Owner = { namespace: 'eip155', address: evmOwner.address };
  const proven: Owner[] = [owner, { namespace: 'solana', address: solOwner.address }];
  const passkey = createTestAuthenticator();
  const solTokenAccount = associatedTokenAddress(solOwner.address, DEV_USDC, splDelegation.TOKEN_PROGRAM, 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
  evm.control.upgrade(evmOwner.address);
  evm.control.fund(evmOwner.address, 'USDC', 1_000_000_000n);
  sol.control.mint(DEV_USDC, 6);
  sol.control.tokenAccount(solTokenAccount, solOwner.address, DEV_USDC, 100_000_000n);

  async function registerPasskey(): Promise<string> {
    const options = await service.passkeyOptions(owner);
    const r = passkey.register(fromB64url(options.challenge), ORIGIN, 'localhost');
    return (await service.passkeyRegister(owner, { ...r, challenge: options.challenge, label: 'Test passkey' })).passkeyId;
  }
  async function enrollEvm(passkeyId: string, patch: Record<string, unknown> = {}) {
    const g = await service.credentialPrepare(owner, proven, { mechanism: 'EVM_ERC7710_METAMASK_V1_3', walletAddress: evmOwner.address, network: 'base-sepolia',
      pairs: [{ input: 'USDC', output: 'WETH', perCallCap: '100' }], maxCalls: 40, expiresAt: '2026-12-31T00:00:00Z', passkeyId, label: 'MetaMask', ...patch });
    return service.credentialComplete(owner, g.grantId, { signature: await evmOwner.signDigest(String(g.enrollment!.digest)) });
  }
  async function enrollSolana(passkeyId: string, amount = '20') {
    const g = await service.credentialPrepare(owner, proven, { mechanism: 'SOLANA_SPL_DELEGATE_V1', walletAddress: solOwner.address, network: 'solana-devnet',
      tokens: [{ symbol: 'devUSDC', amount }], expiresAt: '2026-12-31T00:00:00Z', passkeyId, label: 'Phantom' });
    return service.credentialComplete(owner, g.grantId, { signedTransaction: await solOwner.signTransaction(g.enrollment!.message) });
  }
  const USDC_KEY = `${BASE_SEPOLIA}/erc20:${evm.control.profile.usdc}`, DEV_KEY = `${DEVNET_GENESIS}/token:${DEV_USDC}`;
  /** Weekly Monday 09:00 Europe/Lisbon, buy 50 USDC of WETH on Base Sepolia (+ optionally 5 devUSDC → SOL on Solana Devnet). */
  const multichainInput = (patch: Record<string, unknown> = {}, solana = true) => ({ version: 1, name: 'Weekly cross-chain', trigger: { kind: 'SCHEDULE',
    schedule: { frequency: 'WEEKLY', weekday: 1, time: '09:00', timezone: 'Europe/Lisbon' } },
    steps: [{ asset: 'ETH', side: 'BUY', network: 'base-sepolia', amount: '50', slippageBps: 50 }, ...solana ? [{ asset: 'SOL', side: 'BUY', network: 'solana-devnet', amount: '5', slippageBps: 50 }] : []],
    limits: { assets: [{ asset: USDC_KEY, maxPerExecution: '50', budgets: [{ period: 'WEEK', amount: '200' }] },
      ...solana ? [{ asset: DEV_KEY, maxPerExecution: '5', budgets: [{ period: 'WEEK', amount: '20' }] }] : []],
    maxExecutionsPerPeriod: { count: 4, period: 'WEEK' }, cooldownMinutes: 0, maxSlippageBps: 50 }, expiresAt: '2026-12-31T00:00:00Z', ...patch });
  /** Creates the automation and signs its ONE authorization with the passkey. */
  async function authorize(input: unknown) {
    const created = await service.automationCreate(owner, input);
    const review = await service.authorizationReview(owner, created.authorizationId);
    const assertion = passkey.assert(fromB64url(review.challenge), ORIGIN, 'localhost');
    const signed = await service.authorizationSign(owner, created.authorizationId, review.revision, assertion);
    return { created, review, signed };
  }
  /** Makes the rule due by the clock and evaluates it (one occurrence per slot). */
  async function trigger(ruleId: string) {
    const rule = (await automations.ruleById(ruleId))!;
    if (rule.nextEvaluationAt && rule.nextEvaluationAt > clock) clock = new Date(rule.nextEvaluationAt.getTime() + 30_000);
    return evaluateRule(evaluator, ruleId);
  }
  /** Drains delegation work items with the real worker loop (fenced leases, settle semantics). */
  async function drain(database: Database = db, workerId = 'test-worker'): Promise<number> {
    const queue = createPostgresWorkQueue({ db: database, ownerId: workerId, tenantId });
    const worker = createWorker({ queue: { ...queue, claim: limit => queue.claim(limit, ['delegation.execute']) }, handlers: delegationHandlers(deps as never), logger: silent,
      workerId, concurrency: 4 });
    let total = 0;
    for (;;) { const n = await worker.drainOnce(); total += n; if (n === 0) break; }
    return total;
  }
  return { tenantId, config, evm, sol, rpc, intercept, signer, rt, store: rt.store, automations, service, deps, evaluator, lines, owner, proven, evmOwner, solOwner, passkey,
    solTokenAccount, USDC_KEY, DEV_KEY, registerPasskey, enrollEvm, enrollSolana, multichainInput, authorize, trigger, drain, now,
    set(at: Date | string) { clock = new Date(at); }, advance(ms: number) { clock = new Date(clock.getTime() + ms); } };
}
