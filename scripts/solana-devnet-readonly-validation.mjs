// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEMO-001 public Solana Devnet READ-ONLY validation. Evidence class: PUBLIC_READ_ONLY.
 * Reads cluster genesis, the Orca Whirlpools program deployment, both mints, the WhirlpoolsConfig, the documented test
 * pool and its tick arrays, then (when a public Devnet address with SOL is given) builds the exact Gryloo v0 swap message
 * and simulates it with signature verification off. It holds no key, signs nothing and can never broadcast:
 * the transport refuses every method outside the read-only allowlist, including sendTransaction.
 *
 *   pnpm build && node scripts/solana-devnet-readonly-validation.mjs [publicDevnetAddressWithSol]
 */
import { ORCA_WHIRLPOOLS_DEVNET as profile, SOLANA_DEVNET_TOKENS as T } from '../packages/action-registry/dist/index.js';
import { base58Encode, fromBase64, readOrcaPool, simulateOrcaDevnetSwap, assertOrcaDevnetReview, orcaTickArrayStarts, orcaTickArrayAddress } from '../packages/reference-compiler/dist/index.js';
import { createExactInputSwapNode } from '../packages/workflow-contracts/dist/index.js';

const READ_ONLY = new Set(['getGenesisHash', 'getAccountInfo', 'getMultipleAccounts', 'getLatestBlockhash', 'getBlockHeight', 'simulateTransaction', 'getSlot']);
const endpoint = process.env.GRYLOO_SOLANA_DEVNET_RPC_URL ?? profile.rpc;
if (new URL(endpoint).protocol !== 'https:') throw new Error('HTTPS RPC required');
async function rpc(method, params) {
  if (!READ_ONLY.has(method)) throw new Error('READ_ONLY_VALIDATION_DENIES_' + method);
  await new Promise(resolve => setTimeout(resolve, 250));
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error).slice(0, 300)}`);
  return body.result;
}
const check = (ok, label) => { if (!ok) throw new Error('VALIDATION_FAILED: ' + label); return label; };
const report = { evidence: 'PUBLIC_READ_ONLY', broadcast: false, endpoint: new URL(endpoint).origin, checkedAt: new Date().toISOString(), checks: [] };

const genesis = await rpc('getGenesisHash', []);
report.checks.push(check(genesis === profile.genesisHash, `cluster genesis ${genesis} = Solana Devnet`));
const program = (await rpc('getAccountInfo', [profile.programs.whirlpool, { encoding: 'jsonParsed' }])).value;
check(program?.executable === true && program.owner === 'BPFLoaderUpgradeab1e11111111111111111111111', 'Whirlpools program is executable (upgradeable loader)');
const programData = (await rpc('getAccountInfo', [program.data.parsed.info.programData, { encoding: 'base64', dataSlice: { offset: 0, length: 45 } }])).value;
const header = fromBase64(programData.data[0]), view = new DataView(header.buffer, header.byteOffset);
report.program = { id: profile.programs.whirlpool, programData: program.data.parsed.info.programData, lastDeploySlot: Number(view.getBigUint64(4, true)),
  upgradeAuthority: header[12] === 1 ? base58Encode(header.slice(13, 45)) : null };
report.checks.push(`Whirlpools program deployed on Devnet (last deploy slot ${report.program.lastDeploySlot})`);
report.mints = {};
for (const token of Object.values(T)) {
  const mint = (await rpc('getAccountInfo', [token.mint, { encoding: 'jsonParsed' }])).value;
  check(mint?.owner === profile.programs.token && mint.data.parsed.info.decimals === token.decimals, `${token.symbol} mint ${token.mint} is a classic SPL mint with ${token.decimals} decimals`);
  report.mints[token.symbol] = { mint: token.mint, decimals: token.decimals, supply: mint.data.parsed.info.supply, mintAuthority: mint.data.parsed.info.mintAuthority };
  report.checks.push(`${token.symbol} mint verified`);
}
const config = (await rpc('getAccountInfo', [profile.whirlpoolsConfig, { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }])).value;
report.checks.push(check(config?.owner === profile.programs.whirlpool, `WhirlpoolsConfig ${profile.whirlpoolsConfig} owned by Whirlpools`));
const pool = await readOrcaPool(rpc);
report.pool = pool;
report.checks.push(`pool ${pool.address} matches config, mints, vaults and tick spacing ${pool.tickSpacing}; liquidity ${pool.liquidity}`);
const vaults = (await rpc('getMultipleAccounts', [[pool.tokenVaultA, pool.tokenVaultB], { encoding: 'jsonParsed' }])).value;
report.vaultBalances = { SOL: vaults[0].data.parsed.info.tokenAmount.uiAmountString, devUSDC: vaults[1].data.parsed.info.tokenAmount.uiAmountString };
const arrays = [true, false].map(aToB => orcaTickArrayStarts(pool.tickCurrentIndex, pool.tickSpacing, aToB).map(start => orcaTickArrayAddress(pool.address, start)));
const arrayAccounts = (await rpc('getMultipleAccounts', [arrays.flat(), { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }])).value;
check(arrayAccounts.every(a => a === null || a.owner === profile.programs.whirlpool), 'tick arrays are uninitialized or owned by Whirlpools');
report.tickArrays = { aToB: arrays[0], bToA: arrays[1], initialized: arrayAccounts.map(Boolean) };
report.checks.push('tick-array sequence derived for both directions');

const owner = process.argv[2];
if (owner) {
  report.simulations = [];
  for (const [from, to, amount] of [['SOL', 'devUSDC', '100000000'], ['devUSDC', 'SOL', '1000000']]) {
    const chain = profile.chain, input = T[from], output = T[to];
    const workflow = { schemaVersion: '1.0.0', workflowId: 'demo001-readonly', revision: 1, resourceEdges: [], nodes: [createExactInputSwapNode('node-002', { chain,
      input: { chainId: chain, address: input.mint, decimals: input.decimals }, output: { chainId: chain, address: output.mint, decimals: output.decimals },
      amount, slippageBps: 50, protocols: ['orca-whirlpools'], maximumAmount: input.maximumAmount })] };
    try {
      const review = await simulateOrcaDevnetSwap(workflow, owner, rpc);
      assertOrcaDevnetReview(review, workflow, owner, await rpc('getBlockHeight', [{ commitment: 'confirmed' }]));
      report.simulations.push({ swap: `${from} → ${to}`, amountIn: amount, expectedOut: review.quote.outAmount, minimumOut: review.quote.otherAmountThreshold,
        priceImpactPct: review.quote.priceImpactPct, simulatedTrade: review.simulatedTrade, simulatedInputSpent: review.simulationResult.inputSpent,
        simulatedOutputReceived: review.simulationResult.outputReceived, feeLamports: review.estimatedFeeLamports, computeUnitLimit: review.computeUnitLimit,
        unitsConsumed: review.simulationResult.unitsConsumed, messageHash: review.messageHash, messageBytes: fromBase64(review.message).length, slot: review.simulationResult.slot,
        reviewGuard: 'PASS' });
    } catch (cause) { report.simulations.push({ swap: `${from} → ${to}`, error: cause.message }); }
  }
}
console.log(JSON.stringify(report, null, 2));
