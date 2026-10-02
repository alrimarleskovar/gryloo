// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-015 public Solana Devnet READ-ONLY validation of Orca Whirlpools liquidity. Evidence class: PUBLIC_READ_ONLY.
 * Reads cluster genesis, the Whirlpools program deployment, the documented test pool (fee tier, rewards, tick spacing),
 * the current price and the tick arrays of the aligned ±10% range. When a public Devnet address with SOL and devUSDC is
 * given, it builds the exact Gryloo OPEN message for the owner execution profile (≤ 0.01 SOL, ≤ 0.30 devUSDC, ±10%,
 * 100 bps) and simulates it with signature verification off, then simulates one composite message that also removes all
 * liquidity, collects fees and closes the position, to prove every lifecycle instruction against the deployed program.
 * It holds no key, signs nothing and can never broadcast: the transport refuses every method outside the read-only
 * allowlist, including sendTransaction. The position-mint address used here is random public-key bytes with no secret.
 *
 *   pnpm build && node scripts/solana-devnet-liquidity-readonly-validation.mjs [publicDevnetAddress] [output.json]
 */
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { ORCA_WHIRLPOOLS_DEVNET_LIQUIDITY as profile } from '../packages/action-registry/dist/index.js';
import { assertOrcaLiquidityReview, base58Encode, compileMessageV0, fromBase64, orcaLiquidityAccounts, orcaLiquidityInstructions, orcaLiquidityTickArray,
  parseOrcaLiquidityEvents, readOrcaLiquidityPool, readOrcaLiquidityPrice, serializeMessageV0, serializeSignedTransaction, setComputeUnitLimit, simulateOrcaLiquidity,
  toBase64 } from '../packages/reference-compiler/dist/index.js';
import { createConcentratedLiquidityNode } from '../packages/workflow-contracts/dist/index.js';

const READ_ONLY = new Set(['getGenesisHash', 'getAccountInfo', 'getMultipleAccounts', 'getLatestBlockhash', 'getBlockHeight', 'simulateTransaction', 'getSlot']);
const endpoint = process.env.GRYLOO_SOLANA_DEVNET_RPC_URL ?? profile.rpc;
if (new URL(endpoint).protocol !== 'https:') throw new Error('HTTPS RPC required');
async function rpc(method, params) {
  if (!READ_ONLY.has(method)) throw new Error('READ_ONLY_VALIDATION_DENIES_' + method);
  await new Promise(resolve => setTimeout(resolve, 300));
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error).slice(0, 300)}`);
  return body.result;
}
const check = (ok, label) => { if (!ok) throw new Error('VALIDATION_FAILED: ' + label); return label; };
const report = { evidence: 'PUBLIC_READ_ONLY', broadcast: false, signed: false, endpoint: new URL(endpoint).origin, checkedAt: new Date().toISOString(), checks: [] };

const genesis = await rpc('getGenesisHash', []);
report.checks.push(check(genesis === profile.genesisHash, `cluster genesis ${genesis} = Solana Devnet`));
const program = (await rpc('getAccountInfo', [profile.programs.whirlpool, { encoding: 'jsonParsed' }])).value;
check(program?.executable === true && program.owner === 'BPFLoaderUpgradeab1e11111111111111111111111', 'Whirlpools program is executable (upgradeable loader)');
const programData = (await rpc('getAccountInfo', [program.data.parsed.info.programData, { encoding: 'base64', dataSlice: { offset: 0, length: 45 } }])).value;
const header = fromBase64(programData.data[0]), view = new DataView(header.buffer, header.byteOffset);
report.program = { id: profile.programs.whirlpool, programData: program.data.parsed.info.programData, lastDeploySlot: Number(view.getBigUint64(4, true)),
  sourceReviewed: profile.officialSource };
report.checks.push(`Whirlpools program deployed on Devnet (last deploy slot ${report.program.lastDeploySlot})`);
const pool = await readOrcaLiquidityPool(rpc);
report.pool = { address: pool.address, config: pool.whirlpoolsConfig, tickSpacing: pool.tickSpacing, feeRate: pool.feeRate, liquidity: pool.liquidity, sqrtPrice: pool.sqrtPrice,
  tickCurrentIndex: pool.tickCurrentIndex, slot: pool.slot, rewardEmitters: pool.rewardMints.length };
report.checks.push(`pool ${pool.address} matches config, mints, vaults, tick spacing ${pool.tickSpacing}, fee ${pool.feeRate}; no reward emitters`);
const price = await readOrcaLiquidityPrice(rpc);
report.range = price;
report.checks.push(`±10% band ${price.lowerPrice}–${price.upperPrice} devUSDC/SOL aligned outward to ticks ${price.tickLower}..${price.tickUpper}`);
const arrays = [orcaLiquidityTickArray(pool.address, price.tickLower), orcaLiquidityTickArray(pool.address, price.tickUpper)];
const arrayAccounts = (await rpc('getMultipleAccounts', [arrays, { encoding: 'base64', dataSlice: { offset: 0, length: 8 } }])).value;
check(arrayAccounts.every(a => a?.owner === profile.programs.whirlpool && Buffer.from(a.data[0], 'base64').toString('hex') === profile.tickArrayDiscriminator),
  'range tick arrays are initialized fixed-size TickArray accounts owned by Whirlpools');
report.tickArrays = arrays;
report.checks.push('range tick arrays initialized (fixed-size)');

const owner = process.argv[2];
if (owner) {
  const c = t => ({ chainId: profile.chain, address: t.mint, decimals: t.decimals });
  const fields = { chain: profile.chain, token0: c(profile.token0), token1: c(profile.token1), amount0Max: '10000000', amount1Max: '300000', amount0Min: '0', amount1Min: '0',
    tickLower: price.tickLower, tickUpper: price.tickUpper, feeTier: profile.feeTier, slippageBps: 100, protocols: [profile.protocol], recipient: null,
    positionAsset: { chainId: profile.chain, address: profile.programs.whirlpool, decimals: 0 } };
  const workflow = { schemaVersion: '1.0.0', workflowId: 'build015-readonly', revision: 1, resourceEdges: [], nodes: [createConcentratedLiquidityNode('node-002', fields)] };
  const positionMint = base58Encode(randomBytes(32));
  const review = await simulateOrcaLiquidity(workflow, owner, { operation: 'OPEN', positionMint }, rpc);
  assertOrcaLiquidityReview(review, workflow, owner, await rpc('getBlockHeight', [{ commitment: 'confirmed' }]));
  const s = review.simulationResult;
  report.open = { owner, profile: { maxSol: '0.01', maxDevUsdc: '0.30', rangeBps: 1000, slippageBps: 100 }, rangeState: review.range.state,
    alignedRange: { tickLower: review.range.tickLower, tickUpper: review.range.tickUpper, lowerPrice: review.range.lowerPrice, upperPrice: review.range.upperPrice },
    expected: review.expected, tokenBounds: { maxA: review.operationPlan.tokenA, maxB: review.operationPlan.tokenB }, simulatedDeposit: { a: s.depositedA, b: s.depositedB },
    residual: { a: s.residualTokenA, b: s.residualTokenB }, rentPaidLamports: s.rentPaidLamports, feeLamports: review.estimatedFeeLamports, unitsConsumed: s.unitsConsumed,
    computeUnitLimit: review.computeUnitLimit, messageBytes: fromBase64(review.message).length, signers: review.signers.length, programs: review.programs,
    instructions: review.instructionSummary.map(i => i.name), createdAccounts: s.createdAccounts.length, messageHash: review.messageHash };
  check(s.depositedA === review.expected.amountA && s.depositedB === review.expected.amountB, 'deployed program deposit equals Gryloo integer math');
  check(BigInt(review.expected.liquidity) > 0n && BigInt(review.operationPlan.tokenA) <= 10_000_000n && BigInt(review.operationPlan.tokenB) <= 300_000n,
    'non-zero liquidity within the 0.01 SOL / 0.30 devUSDC maxima');
  report.checks.push(`exact OPEN message simulated: deposit ${s.depositedA} lamports + ${s.depositedB} devUSDC units, liquidity ${review.expected.liquidity}; Review guard PASS`);
  // Lifecycle layout proof: the same open + increase followed by decrease(all) + collect_fees + close_position in ONE read-only message.
  const accounts = orcaLiquidityAccounts(owner, positionMint, review.range.tickLower, review.range.tickUpper);
  const open = orcaLiquidityInstructions(accounts, review.operationPlan, 600_000);
  const exit = orcaLiquidityInstructions(accounts, { ...review.operationPlan, operation: 'EXIT', tokenA: '0', tokenB: '0', wrapLamports: '0', decrease: true, close: true }, 600_000);
  const instructions = [setComputeUnitLimit(600_000), ...open.slice(1, -1), ...exit.slice(2)];
  const latest = (await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }])).value;
  const message = serializeMessageV0(compileMessageV0(owner, instructions, latest.blockhash, {}));
  const ownerBefore = (await rpc('getMultipleAccounts', [[owner], { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }])).value[0].lamports;
  const sim = (await rpc('simulateTransaction', [toBase64(serializeSignedTransaction([null, null], message)), { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: false,
    commitment: 'confirmed', accounts: { encoding: 'base64', addresses: [owner, accounts.position, accounts.positionMint, accounts.positionTokenAccount] } }])).value;
  check(sim.err === null, 'composite lifecycle simulation succeeded');
  const events = parseOrcaLiquidityEvents(sim.logs);
  check(events.map(e => e.kind).join() === 'PositionOpened,LiquidityIncreased,LiquidityDecreased' && events.every(e => e.position === accounts.position),
    'PositionOpened, LiquidityIncreased and LiquidityDecreased events for the new position');
  check(sim.accounts.slice(1).every(a => a === null || a.lamports === 0), 'position, position mint and position token account are closed');
  const net = BigInt(sim.accounts[0].lamports) - BigInt(ownerBefore);
  report.lifecycle = { instructions: ['open_position_with_token_extensions', 'increase_liquidity_v2', 'decrease_liquidity_v2', 'collect_fees_v2', 'close_position_with_token_extensions'],
    events: events.map(e => ({ kind: e.kind, liquidity: e.liquidity, tokenA: e.tokenA, tokenB: e.tokenB })), unitsConsumed: sim.unitsConsumed, messageBytes: message.length,
    ownerLamportNetChange: net.toString(), note: 'All account deposits are refunded on close; the owner loses only the two-signature network fee and integer rounding.' };
  check(net >= -10_002n && net <= -10_000n, 'owner SOL net change is only the 10,000-lamport fee plus rounding');
  report.checks.push('all five lifecycle instructions accepted by the deployed program in one read-only simulation; every deposit refunded');
}
const out = process.argv[3];
if (out) writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
