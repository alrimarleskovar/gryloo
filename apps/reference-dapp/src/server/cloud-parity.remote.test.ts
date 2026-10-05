// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CLOUD-PARITY-001 remote cloud-parity sweep of ONE deployed origin (a Vercel Preview). Opt-in, never part of `pnpm test` or CI:
 *
 *   FLOFI_CLOUD_PARITY_ORIGIN=https://<preview> [FLOFI_CLOUD_PARITY_EVM_ACCOUNT=0x…] [FLOFI_CLOUD_PARITY_SOLANA_ACCOUNT=…]
 *   [FLOFI_CLOUD_PARITY_REPORT=/absolute/report.json] pnpm test:cloud-remote
 *
 * For every capability it authors the workflow with the app's own editor, calls the deployment's own server actions (discovered from
 * its client bundle) and records the outcome: a durable Simulate (read back on a new request) or a classified code. Every call is a
 * read, a quote or a simulation for PUBLIC addresses. Nothing is reviewed, prepared, signed or sent. The Router testnet path requires a
 * wallet session, so it signs the EIP-4361 sign-in with a disposable key generated in memory (never the owner's wallet, never funded;
 * the message authorizes no transaction). An optional Vercel automation bypass is read from VERCEL_AUTOMATION_BYPASS_SECRET.
 */
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { AAVE_V3_BASE_SEPOLIA, AAVE_V3_ETHEREUM_SEPOLIA } from '@defi-workflow-engine/action-registry';
import { createBaseSepoliaReviewContext, createEthereumSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { createNativeTransferNode, createSupplyNode, type SemanticWorkflow } from '@defi-workflow-engine/workflow-contracts';
import { createTestWallet } from '../../../../packages/reference-reconciler/test/test-wallet.ts';
import { editorReducer, initialEditor } from '../domain/editor';
import { createAuthoredLending } from '../domain/lending-authoring';
import { uniswapBandInput } from '../domain/uniswap-liquidity-authoring';

const ORIGIN = process.env.FLOFI_CLOUD_PARITY_ORIGIN ?? '';
const EVM = (process.env.FLOFI_CLOUD_PARITY_EVM_ACCOUNT ?? '0x8ef12e4e2fd397c227492019f626b5d1c5e41b3b').toLowerCase();
const SOLANA = process.env.FLOFI_CLOUD_PARITY_SOLANA_ACCOUNT ?? '6Mc7hRBcjoYukC7PNqKUbfS5pHeJwf41bogtUfKuMYQR';
const CODE = /^[A-Z][A-Z0-9_]{2,80}$/;
/** Codes that would mean the CLOUD PATH itself failed (as opposed to a deterministic domain or provider outcome). */
const RUNTIME_FAILURE = /^(CLOUD_RUNTIME_[A-Z_]+|ARGUMENTS_INVALID|[A-Z_]+_SERVICE_UNAVAILABLE|[A-Z_]+_STORAGE_[A-Z_]+|SCHEMA_NOT_MIGRATED|DATABASE_[A-Z_]+|WALLET_SESSION_NOT_CONFIGURED)$/;

type Outcome = { capability: string; action: string; outcome: string; runId?: string; readBack?: boolean; detail?: unknown };
const outcomes: Outcome[] = [];
const wf = (result: { error: string | null; workflow: unknown }) => { if (result.error) throw new Error(result.error); return structuredClone(result.workflow) as SemanticWorkflow; };

/** A browser-like client of the deployment: its own server-action ids, a cookie jar, and the RSC reply's first value. */
function client(origin: string) {
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET, jar = new Map<string, string>(), actions = new Map<string, string>();
  const headers = () => ({ ...bypass ? { 'x-vercel-protection-bypass': bypass } : {}, ...jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {} });
  const remember = (response: Response) => { for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(';'), at = pair!.indexOf('='), name = pair!.slice(0, at), value = pair!.slice(at + 1);
    if (/max-age=0|expires=thu, 01 jan 1970/i.test(line) || value === '') jar.delete(name); else jar.set(name, value);
  } };
  return {
    async discover() {
      const page = await (await fetch(origin + '/', { headers: headers(), redirect: 'manual' })).text();
      for (const script of new Set([...page.matchAll(/\/_next\/static\/[^"']+\.js/g)].map(m => m[0]))) {
        const text = await (await fetch(origin + script, { headers: headers() })).text();
        for (const m of text.matchAll(/createServerReference\)\("([0-9a-f]{40,42})",[^,]+,void 0,[^,]+,"([A-Za-z0-9]+)"\)/g)) actions.set(m[2]!, m[1]!);
      }
      return actions.size;
    },
    async call(name: string, ...args: unknown[]): Promise<unknown> {
      const id = actions.get(name);
      if (!id) return { ok: false, code: 'ACTION_NOT_DECLARED' };
      const response = await fetch(origin + '/', { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(300_000),
        headers: { ...headers(), 'next-action': id, 'content-type': 'text/plain;charset=UTF-8', accept: 'text/x-component', origin }, body: JSON.stringify(args) });
      remember(response);
      const root = flightRoot(Buffer.from(await response.arrayBuffer()));
      return root === undefined ? { ok: false, code: `HTTP_${response.status}` } : root;
    },
  };
}
/** The root value row of a React Flight reply. Long strings arrive as length-prefixed text rows (`<id>:T<hex bytes>,…`) with no newline. */
function flightRoot(bytes: Buffer): unknown {
  let at = 0;
  while (at < bytes.length) {
    const colon = bytes.indexOf(0x3a, at), id = bytes.subarray(at, colon).toString();
    // Hint rows (`:HL[…]`) have no id; every other row id is hexadecimal.
    if (colon < 0 || !/^[0-9a-f]*$/.test(id)) break;
    if (bytes[colon + 1] === 0x54) { const comma = bytes.indexOf(0x2c, colon); at = comma + 1 + parseInt(bytes.subarray(colon + 2, comma).toString(), 16); continue; }
    const end = bytes.indexOf(0x0a, colon), row = bytes.subarray(colon + 1, end < 0 ? bytes.length : end).toString();
    if (id === '1') return JSON.parse(row) as unknown;
    at = end < 0 ? bytes.length : end + 1;
  }
  return undefined;
}
const codeOf = (value: unknown) => {
  const v = value as { ok?: boolean; code?: unknown } | null;
  return v && v.ok === false ? (typeof v.code === 'string' && CODE.test(v.code) ? v.code : 'UNCLASSIFIED') : null;
};

describe('BUILD-CLOUD-PARITY-001 remote cloud parity', () => {
  it('every cloud capability reaches the deployment runtime; every local-only capability fails closed with its documented code', async () => {
    if (!/^https:\/\/[a-z0-9.-]+$/.test(ORIGIN)) throw new Error('Set FLOFI_CLOUD_PARITY_ORIGIN=https://<deployment> to run the remote sweep; it is never part of pnpm test or CI.');
    const c = client(ORIGIN);
    expect(await c.discover()).toBeGreaterThan(50);

    /** Simulate (no signature) then read the durable run back on a new request. */
    async function simulate(capability: string, action: string, status: string | null, ...args: unknown[]) {
      const value = await c.call(action, ...args) as { ok?: boolean; value?: { id?: string; quote?: { executionId?: string } } };
      const code = codeOf(value);
      if (code) { outcomes.push({ capability, action, outcome: code }); return; }
      const runId = value.value?.id ?? value.value?.quote?.executionId;
      let readBack: boolean | undefined;
      if (status && runId) { const back = await c.call(status, ...(status === 'routerStatus' ? ['testnet', runId] : [runId])) as { ok?: boolean; value?: { id?: string; quote?: { executionId?: string } } };
        readBack = back.ok === true && (back.value?.id ?? back.value?.quote?.executionId) === runId; }
      outcomes.push({ capability, action, outcome: 'SIMULATED', ...runId ? { runId } : {}, ...readBack === undefined ? {} : { readBack } });
    }

    // Native transfers (Robinhood Chain Testnet, Ethereum Sepolia).
    for (const [capability, chain] of [['native transfer · Robinhood Testnet', 'eip155:46630'], ['native transfer · Ethereum Sepolia', 'eip155:11155111']] as const)
      await simulate(capability, 'transferSimulate', 'transferStatus', { schemaVersion: '1.0.0', workflowId: 'parity-transfer', revision: 1, resourceEdges: [],
        nodes: [createNativeTransferNode('node-002', { chain, amount: '1000000000000', recipient: 'CONNECTED_OWNER' })] }, EVM);
    // Uniswap v3 exact-input swap (quote and preflight; no account needed).
    await simulate('Uniswap swap · Base Sepolia', 'publicPrepare', 'publicStatus', wf(editorReducer(initialEditor(), { type: 'ADD_TESTNET_SWAP', direction: 'USDC_TO_WETH', amount: '2',
      slippage: '50', source: 'CANVAS', baseRevision: 0 }, createBaseSepoliaReviewContext())));
    await simulate('Uniswap swap · Ethereum Sepolia', 'publicPrepare', 'publicStatus', wf(editorReducer(initialEditor(), { type: 'ADD_ETHEREUM_SEPOLIA_SWAP', direction: 'USDC_TO_WETH',
      amount: '2', slippage: '50', source: 'CHAT', baseRevision: 0 }, createBaseSepoliaReviewContext())));
    // Uniswap v3 concentrated liquidity around the live price on each chain.
    for (const [network, chain, context] of [['Base Sepolia', 'eip155:84532', createBaseSepoliaReviewContext()], ['Ethereum Sepolia', 'eip155:11155111', createEthereumSepoliaReviewContext()]] as const) {
      const price = await c.call('uniswapLiquidityPrice', chain) as { ok?: boolean; value?: { sqrtPriceX96: string } };
      if (!price.ok) { outcomes.push({ capability: `Uniswap liquidity · ${network}`, action: 'uniswapLiquidityPrice', outcome: codeOf(price) ?? 'UNCLASSIFIED' }); continue; }
      const band = uniswapBandInput(price.value!.sqrtPriceX96, 1_000, network);
      await simulate(`Uniswap liquidity · ${network}`, 'uniswapLiquiditySimulate', 'uniswapLiquidityStatus', wf(editorReducer(initialEditor(), { type: 'ADD_UNISWAP_LIQUIDITY',
        input: { network, maxUsdc: '1', maxWeth: '0.0005', rangeUnit: band.rangeUnit, lower: band.lower, upper: band.upper, slippage: '100' }, source: 'CANVAS', baseRevision: 0 }, context)), EVM);
    }
    // Aave V3 Supply (the Borrow/Repay/Withdraw actions share the same flow and runtime).
    for (const [capability, p] of [['Aave Supply · Base Sepolia USDC', AAVE_V3_BASE_SEPOLIA], ['Aave Supply · Ethereum Sepolia WBTC', AAVE_V3_ETHEREUM_SEPOLIA]] as const)
      await simulate(capability, 'supplySimulate', 'supplyStatus', { schemaVersion: '1.0.0', workflowId: 'parity-supply', revision: 0, resourceEdges: [],
        nodes: [createSupplyNode('supply', { chain: p.chain, asset: { chainId: p.chain, address: p.asset, decimals: p.decimals }, amount: p.decimals === 8 ? '10000' : '100000', beneficiary: EVM })] }, EVM);
    // Supply → Borrow → Swap composition.
    await simulate('Supply → Borrow → Swap composition · Base Sepolia', 'lendingSimulate', 'lendingStatus',
      createAuthoredLending('parity-lending', 0, { supply: '0.1', borrow: '0.01', slippage: '50', owner: EVM }), EVM);
    // Orca Whirlpools swap and liquidity (Solana Devnet).
    await simulate('Orca swap · Solana Devnet', 'solanaDevnetSimulate', 'solanaDevnetStatus', wf(editorReducer(initialEditor(), { type: 'ADD_SOLANA_SWAP',
      input: { network: 'Solana Devnet', from: 'SOL', to: 'devUSDC', amount: '0.01', slippage: '50' }, source: 'CANVAS', baseRevision: 0 }, createBaseSepoliaReviewContext())), SOLANA);
    const orca = await c.call('solanaLiquidityPrice') as { ok?: boolean; value?: { lowerPrice?: string; upperPrice?: string } };
    if (orca.ok && orca.value?.lowerPrice && orca.value.upperPrice) {
      const positionMint = createSolanaPublicKey();
      await simulate('Orca liquidity · Solana Devnet', 'solanaLiquiditySimulate', 'solanaLiquidityStatus', wf(editorReducer(initialEditor(), { type: 'ADD_SOLANA_LIQUIDITY',
        input: { network: 'Solana Devnet', maxSol: '0.01', maxDevUsdc: '0.3', rangeUnit: 'PRICE', lower: orca.value.lowerPrice, upper: orca.value.upperPrice, slippage: '100' },
        source: 'CANVAS', baseRevision: 0 }, createBaseSepoliaReviewContext())), SOLANA, { operation: 'OPEN', positionMint });
    } else outcomes.push({ capability: 'Orca liquidity · Solana Devnet', action: 'solanaLiquidityPrice', outcome: codeOf(orca) ?? 'PRICE_SHAPE_UNEXPECTED', detail: orca.value });

    // Cross-chain Router testnet: ownership needs a session; first without one, then with a disposable signed-in wallet.
    const router = wf(editorReducer(initialEditor(), { type: 'ADD_ROUTER_BRIDGE', input: { source: 'Base Sepolia', destination: 'Arbitrum Sepolia', token: 'USDC', amount: '1',
      recipient: '', slippage: '50', routing: 'AUTO' }, source: 'CANVAS', baseRevision: 0 }, createBaseSepoliaReviewContext()));
    outcomes.push({ capability: 'Router testnet · no session', action: 'routerSimulate', outcome: codeOf(await c.call('routerSimulate', 'testnet', router, EVM)) ?? 'SIMULATED' });
    const disposable = createTestWallet(), challenge = await c.call('walletSignInChallenge', disposable.address, 84532) as { ok?: boolean; value?: { message: string } };
    const session: { ok?: boolean; code?: string; value?: { account?: string } } = challenge.ok
      ? await c.call('walletSignIn', disposable.address, 84532, disposable.signMessage(challenge.value!.message)) as { ok?: boolean; value?: { account?: string } }
      : { ok: false, code: codeOf(challenge) ?? 'WALLET_SIGN_IN_CHALLENGE_UNAVAILABLE' };
    outcomes.push({ capability: 'Wallet session (EIP-4361, disposable key) over HTTPS', action: 'walletSignIn', outcome: session.ok && session.value?.account === disposable.address ? 'SIGNED_IN' : codeOf(session) ?? 'UNCLASSIFIED',
      detail: session.ok ? undefined : { challenge: codeOf(challenge) ?? challenge.ok, signIn: codeOf(session) } });
    outcomes.push({ capability: 'Wallet session read back', action: 'walletSessionStatus', outcome: (await c.call('walletSessionStatus') as { account?: string } | null)?.account === disposable.address ? 'SESSION_ACTIVE' : 'NO_SESSION' });
    await simulate('Cross-chain Router · Base Sepolia → Arbitrum Sepolia', 'routerSimulate', 'routerStatus', 'testnet', router, disposable.address);
    const runs = await c.call('routerRuns', 'testnet') as { ok?: boolean; value?: unknown[] };
    outcomes.push({ capability: 'Router testnet · run history for the session', action: 'routerRuns', outcome: runs.ok ? `RUNS_${runs.value!.length}` : codeOf(runs) ?? 'UNCLASSIFIED' });

    // Deliberately off or local-only on this deployment: each must fail closed with its documented code.
    const probes: [string, string, unknown[], (value: unknown) => string][] = [
      ['Router mainnet (owner real-funds gate)', 'routerSimulate', ['mainnet', router, disposable.address], v => codeOf(v) ?? 'SIMULATED'],
      ['Jupiter mainnet (owner real-funds gate)', 'jupiterInfo', [], v => codeOf(v) ?? 'ENABLED'],
      ['Copilot', 'copilotStatus', [], v => `MODE_${String((v as { mode?: string }).mode).toUpperCase()}`],
      ['Across MOCKED demo (BUILD-010)', 'acrossQuote', [router, EVM], v => codeOf(v) ?? 'QUOTED'],
      ['CoW MOCKED loopback (BUILD-005)', 'cowInfo', [{ workflow: router }], v => (v as { value?: { enabled?: boolean } }).value?.enabled === false ? 'COW_OFF' : codeOf(v) ?? 'ENABLED'],
      ['LI.FI bridge MOCKED (BUILD-008)', 'bridgeInfo', [], v => codeOf(v) ?? 'ENABLED'],
      ['Mode B local fork', 'modeBInfo', [], v => (v as { value?: { available?: boolean } }).value?.available === false ? 'LOCAL_FORK_ONLY' : codeOf(v) ?? 'AVAILABLE'],
      ['Mode B composition local fork', 'compositionInfo', [], v => (v as { value?: { available?: boolean } }).value?.available === false ? 'LOCAL_FORK_ONLY' : codeOf(v) ?? 'AVAILABLE'],
      ['Mode A local fork', 'modeAStatus', [], v => (v as { value?: { available?: boolean } }).value?.available === false || codeOf(v) === 'MODE_A_OFF' ? 'LOCAL_FORK_ONLY' : codeOf(v) ?? 'AVAILABLE'],
    ];
    for (const [capability, action, args, classify] of probes) { const value = await c.call(action, ...args); outcomes.push({ capability, action, outcome: classify(value), detail: codeOf(value) ?? undefined }); }

    console.table(outcomes.map(o => ({ capability: o.capability, outcome: o.outcome, readBack: o.readBack ?? '' })));
    if (process.env.FLOFI_CLOUD_PARITY_REPORT) await writeFile(process.env.FLOFI_CLOUD_PARITY_REPORT, JSON.stringify({ origin: ORIGIN, checkedAt: new Date().toISOString(), outcomes }, null, 2));
    // The cloud path never fails as such, and every durable Simulate is readable on a later request.
    expect(outcomes.filter(o => RUNTIME_FAILURE.test(o.outcome) || o.outcome === 'UNCLASSIFIED' || o.outcome === 'ACTION_NOT_DECLARED')).toEqual([]);
    expect(outcomes.filter(o => o.outcome === 'SIMULATED' && o.runId && o.readBack !== true)).toEqual([]);
    expect(outcomes.find(o => o.capability === 'Router testnet · no session')?.outcome).toBe('WALLET_SESSION_REQUIRED');
    expect(outcomes.find(o => o.action === 'walletSignIn')?.outcome).toBe('SIGNED_IN');
    for (const [capability, expected] of [['Router mainnet (owner real-funds gate)', 'ROUTER_NOT_ENABLED'], ['Across MOCKED demo (BUILD-010)', 'ACROSS_MOCKED_DEMO_LOCAL_ONLY'],
      ['CoW MOCKED loopback (BUILD-005)', 'COW_OFF'], ['LI.FI bridge MOCKED (BUILD-008)', 'BRIDGE_OFF'], ['Mode B local fork', 'LOCAL_FORK_ONLY']])
      expect(outcomes.find(o => o.capability === capability)?.outcome).toBe(expected);
  }, 900_000);
});

/** A random Solana public key (base58 of 32 bytes) for the position mint of an OPEN Simulate; no private key exists. */
function createSolanaPublicKey(): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz', bytes = randomBytes(32);
  let n = BigInt('0x' + bytes.toString('hex')), out = '';
  while (n > 0n) { out = alphabet[Number(n % 58n)] + out; n /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; out = '1' + out; }
  return out;
}
