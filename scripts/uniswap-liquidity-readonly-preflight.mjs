#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-UNISWAP-LIQUIDITY-PUBLIC real READ-ONLY preflight against public Base Sepolia. No wallet, no key, no signature,
 * no transaction. It runs the production service code (`uniswap-liquidity-service.ts`) on a temporary file store with
 * the production read-only RPC client (send methods are not even allowlisted), and records:
 *   - chain id, head, contract code and pinned code hashes, Position Manager ↔ factory/WETH, factory.getPool, pool order,
 *     fee, tick spacing, slot0, liquidity, token metadata (via `price()` and `simulate()`);
 *   - wallet-independent transaction preparation: a full Review — exact approvals and owner-recipient mint calldata —
 *     simulated with `eth_simulateV1` from a public address that already holds test USDC and WETH (found from recent
 *     WETH transfers). Simulating from an address needs no authority over it; nothing is signed or sent.
 * Usage: node scripts/uniswap-liquidity-readonly-preflight.mjs [output.json]
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConcentratedLiquidityNode } from '../apps/reference-dapp/node_modules/@defi-workflow-engine/workflow-contracts/dist/index.js';
import { UNISWAP_V3_BASE_SEPOLIA_LIQUIDITY as profile } from '../apps/reference-dapp/node_modules/@defi-workflow-engine/action-registry/dist/index.js';
import { uniswapBandAroundSqrtPrice } from '../apps/reference-dapp/node_modules/@defi-workflow-engine/reference-compiler/dist/index.js';
import { createFileExecutionStorage } from '../apps/reference-dapp/node_modules/@defi-workflow-engine/reference-executor/dist/index.js';
import { createUniswapLiquidityService } from '../apps/reference-dapp/src/server/uniswap-liquidity-service.ts';
import { baseSepoliaRpcUrl, createBaseSepoliaReadRpc, UNISWAP_LIQUIDITY_RPC_METHODS } from '../apps/reference-dapp/src/server/public-testnet-rpc.ts';

const url = baseSepoliaRpcUrl(process.env.GRYLOO_BASE_SEPOLIA_RPC_URL);
const counted = createBaseSepoliaReadRpc(url, UNISWAP_LIQUIDITY_RPC_METHODS);
const methods = {};
const rpc = (method, params) => { methods[method] = (methods[method] ?? 0) + 1; return counted(method, params); };
// Discovery only (not part of the product path): recent WETH transfers via a separately allowlisted read client.
const logsRpc = createBaseSepoliaReadRpc(url, ['eth_blockNumber', 'eth_getLogs', 'eth_call', 'eth_getCode', 'eth_getBalance']);
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const word = a => a.slice(2).padStart(64, '0');
const balanceOf = async (token, who) => BigInt(await logsRpc('eth_call', [{ to: token, data: '0x70a08231' + word(who) }, 'latest']));
const MAX_USDC = 1_000_000n, MAX_WETH = 500_000_000_000_000n;   // 1 USDC, 0.0005 WETH

async function findHolder() {
  const head = Number(BigInt(await logsRpc('eth_blockNumber', [])));
  const seen = new Set();
  for (let window = 0; window < 40; window++) {
    const to = head - window * 1_000, from = to - 999;
    const logs = await logsRpc('eth_getLogs', [{ address: profile.token1.address, fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16), topics: [TRANSFER] }]);
    for (const log of logs) {
      for (const topic of [log.topics[2], log.topics[1]]) {
        if (!topic) continue;
        const who = '0x' + topic.slice(-40);
        if (seen.has(who) || who === '0x' + '0'.repeat(40)) continue;
        seen.add(who);
        if ((await logsRpc('eth_getCode', [who, 'latest'])) !== '0x') continue;      // externally owned accounts only
        if (await balanceOf(profile.token1.address, who) < MAX_WETH * 2n || await balanceOf(profile.token0.address, who) < MAX_USDC * 2n) continue;
        if (BigInt(await logsRpc('eth_getBalance', [who, 'latest'])) < 10n ** 14n) continue;
        return { address: who, scannedWindows: window + 1 };
      }
    }
  }
  throw new Error('PREFLIGHT_NO_PUBLIC_HOLDER_FOUND');
}

const started = new Date();
const dir = await mkdtemp(join(tmpdir(), 'flofi-unilp-preflight-'));
const service = createUniswapLiquidityService({ storage: createFileExecutionStorage(dir, 'UNISWAP_LIQUIDITY_BUSY'), rpc, provenance: 'PUBLIC_TESTNET', executionEnabled: false });
const price = await service.price();
const band = uniswapBandAroundSqrtPrice(BigInt(price.sqrtPriceX96), 1_000, profile.tickSpacing);
const chain = profile.chain;
const node = createConcentratedLiquidityNode('node-002', { chain, token0: { chainId: chain, address: profile.token0.address, decimals: 6 },
  token1: { chainId: chain, address: profile.token1.address, decimals: 18 }, amount0Max: MAX_USDC.toString(), amount1Max: MAX_WETH.toString(), amount0Min: '0', amount1Min: '0',
  tickLower: band.tickLower, tickUpper: band.tickUpper, feeTier: 500, slippageBps: 100, protocols: ['uniswap-v3'], recipient: null,
  positionAsset: { chainId: chain, address: profile.positionManager, decimals: 0 } });
const workflow = { schemaVersion: '1.0.0', workflowId: 'preflight', revision: 1, nodes: [node], resourceEdges: [] };
const holder = await findHolder();
const run = await service.simulate(workflow, holder.address);
let beginRefused = null;
try { await service.begin(run.id, holder.address, workflow); } catch (error) { beginRefused = error.message; }
const r = run.review;
const result = {
  build: 'BUILD-UNISWAP-LIQUIDITY-PUBLIC', kind: 'REAL_READ_ONLY_PREFLIGHT', evidenceLevel: 'PUBLIC_READ_ONLY',
  statement: 'Read-only public Base Sepolia reads and eth_simulateV1 simulation through the production service code. No wallet, key, signature or transaction.',
  startedAt: started.toISOString(), finishedAt: new Date().toISOString(), rpc: new URL(url).host, rpcMethodCounts: methods,
  network: { chainId: r.chainId, block: r.block }, contracts: r.contracts, token0: r.token0, token1: r.token1, pool: r.pool,
  currentPrice: price, simulatedOwner: { address: holder.address, note: 'public address holding test USDC/WETH; simulation only, no authority', scannedWindows: holder.scannedWindows },
  review: { commitment: r.commitment, range: r.range, intent: r.intent, expected: r.expected, minimums: r.minimums, deadline: r.deadline, approvals: r.approvals,
    calls: r.calls, fees: r.fees, simulation: r.simulation, recipient: r.recipient },
  executionAttempted: false, beginWithExecutionDisabled: beginRefused,
};
const output = process.argv[2];
if (output) await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ block: r.block.number, price: price.price, tick: price.tick, range: [r.range.tickLower, r.range.tickUpper], state: r.range.state,
  expected: r.expected, minimums: r.minimums, calls: r.calls.map(c => c.step), beginRefused, methods }, null, 2));
