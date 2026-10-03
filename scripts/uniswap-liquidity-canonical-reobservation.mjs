#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-UNISWAP-LIQUIDITY-PUBLIC: READ-ONLY canonical re-observation of the completed owner E2E (run
 * unilp-ff982993a669f8a4f86a8d7b4c6c6369). It re-reads the WETH approval and the mint from public Base Sepolia, checks
 * them with the hardened production verifier (exact reviewed call inside the MetaMask redemption, delegation, canonical
 * block inclusion), re-derives their effects at the canonical blocks, and writes a NEW supplemental artifact that
 * references the historical Evidence Bundle by hash. The historical bundle is not read, rewritten or superseded.
 * No wallet, key, signature or transaction.
 * Usage: node scripts/uniswap-liquidity-canonical-reobservation.mjs <output.json>
 */
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { UNISWAP_V3_BASE_SEPOLIA_LIQUIDITY as profile } from '../apps/reference-dapp/node_modules/@defi-workflow-engine/action-registry/dist/index.js';
import { UNISWAP_SELECTORS as SEL, UNISWAP_TOPICS as TOPIC, decodeUniswapApprove, decodeUniswapMint, decodeUniswapPosition } from '../apps/reference-dapp/node_modules/@defi-workflow-engine/reference-compiler/dist/index.js';
import { verifyOwnerSubmission } from '../apps/reference-dapp/src/server/public-testnet-service.ts';
import { baseSepoliaRpcUrl, createBaseSepoliaReadRpc, UNISWAP_LIQUIDITY_RPC_METHODS } from '../apps/reference-dapp/src/server/public-testnet-rpc.ts';

const RUN = 'unilp-ff982993a669f8a4f86a8d7b4c6c6369';
const HISTORICAL_BUNDLE = '0xf3687b556fe8ee7cccde9000f33adf01e910d90dd03c14632fdcc30c4a034da2';
const APPROVAL = '0x292f12eea493fbcd20cd284a8bfdf74ec14a28dbfca8958a5e00f8dbf36fc35d';
const MINT = '0x158e125d6bfb4df04a87d743e25d5c5ca4b2eef634cd27319439b1fae6f283d2';
const TOKEN_ID = 82559n;
const ZERO_HASH = '0x' + '0'.repeat(64);
const REDEEMED = '0x40dadaa36c6c2e3d7317e24757451ffb2d603d875f0ad5e92c5dd156573b1873';
const rpc = createBaseSepoliaReadRpc(baseSepoliaRpcUrl(process.env.GRYLOO_BASE_SEPOLIA_RPC_URL), UNISWAP_LIQUIDITY_RPC_METHODS);
const fail = code => { throw new Error(code); };
const tag = n => '0x' + n.toString(16);
const word = v => BigInt(v).toString(16).padStart(64, '0');
const addr = a => a.slice(2).padStart(64, '0');
const topicAddress = t => '0x' + t.slice(-40);
const call = async (to, data, block) => rpc('eth_call', [{ to, data }, tag(block)]);
const sha = value => '0x' + createHash('sha256').update(value).digest('hex');

/** The single inner call of a canonical depth-1 redeemDelegations envelope (the verifier re-checks it independently). */
function innerCall(input) {
  const raw = input.slice(10), at = o => Number(BigInt('0x' + raw.slice(o * 2, o * 2 + 64)));
  const callsOffset = at(64), start = callsOffset + 64, length = at(start), packed = raw.slice((start + 32) * 2, (start + 32 + length) * 2);
  return { target: '0x' + packed.slice(0, 40), value: BigInt('0x' + packed.slice(40, 104)).toString(), data: '0x' + packed.slice(104) };
}
async function observe(hash) {
  const [tx, receipt] = await Promise.all([rpc('eth_getTransactionByHash', [hash]), rpc('eth_getTransactionReceipt', [hash])]);
  if (!tx || !receipt) fail('REOBSERVATION_TRANSACTION_MISSING');
  const blockNumber = Number(BigInt(receipt.blockNumber));
  const block = await rpc('eth_getBlockByNumber', [tag(blockNumber), false]);
  const redeemed = receipt.logs.filter(l => l.address.toLowerCase() === '0xdb9b1e94b5b69df7e401ddbede43491141047db3' && l.topics[0] === REDEEMED);
  if (redeemed.length !== 1) fail('REOBSERVATION_REDEMPTION_UNEXPECTED');
  const owner = topicAddress(redeemed[0].topics[1]);
  const inner = innerCall(tx.input.toLowerCase());
  // Hardened production verifier: exact call, canonical manager and code, owner already delegated before the block,
  // Redeemed topology, and canonical inclusion (non-zero block hash = canonical block at that height containing the tx).
  const verified = await verifyOwnerSubmission(rpc, { txHash: hash, account: owner, target: inner.target, data: inner.data, preBlock: blockNumber - 1 }, tx, receipt);
  return { tx, receipt, block, owner, inner, verified, blockNumber };
}

const approval = await observe(APPROVAL), mint = await observe(MINT);
if (approval.owner !== mint.owner) fail('REOBSERVATION_OWNER_DIVERGENT');
const owner = approval.owner;
// Approval: exact finite WETH approval to the verified Position Manager, effective at its canonical block.
const approved = decodeUniswapApprove(approval.inner.data);
if (approval.inner.target !== profile.token1.address || approved.spender !== profile.positionManager || approval.inner.value !== '0') fail('REOBSERVATION_APPROVAL_MISMATCH');
const approvalLogs = approval.receipt.logs.filter(l => l.address.toLowerCase() === profile.token1.address && l.topics[0] === TOPIC.approval);
if (approvalLogs.length !== 1 || topicAddress(approvalLogs[0].topics[1]) !== owner || topicAddress(approvalLogs[0].topics[2]) !== profile.positionManager ||
    BigInt(approvalLogs[0].data) !== approved.amount) fail('REOBSERVATION_APPROVAL_LOG_MISMATCH');
const allowanceAtApproval = BigInt(await call(profile.token1.address, SEL.allowance + addr(owner) + addr(profile.positionManager), approval.blockNumber));
if (allowanceAtApproval !== approved.amount) fail('REOBSERVATION_ALLOWANCE_MISMATCH');
// Mint: owner recipient, NFT transferred to the owner, position readback at the canonical mint block and today.
const minted = decodeUniswapMint(mint.inner.data);
if (mint.inner.target !== profile.positionManager || minted.recipient !== owner || minted.token0 !== profile.token0.address ||
    minted.token1 !== profile.token1.address || minted.fee !== profile.feeTier) fail('REOBSERVATION_MINT_MISMATCH');
const nft = mint.receipt.logs.filter(l => l.address.toLowerCase() === profile.positionManager && l.topics[0] === TOPIC.transfer);
if (nft.length !== 1 || BigInt(nft[0].topics[1]) !== 0n || topicAddress(nft[0].topics[2]) !== owner || BigInt(nft[0].topics[3]) !== TOKEN_ID) fail('REOBSERVATION_NFT_MISMATCH');
const increase = mint.receipt.logs.filter(l => l.address.toLowerCase() === profile.positionManager && l.topics[0] === TOPIC.increaseLiquidity);
if (increase.length !== 1 || BigInt(increase[0].topics[1]) !== TOKEN_ID) fail('REOBSERVATION_INCREASE_MISMATCH');
const increaseData = increase[0].data.slice(2), liquidity = BigInt('0x' + increaseData.slice(0, 64)),
  amount0 = BigInt('0x' + increaseData.slice(64, 128)), amount1 = BigInt('0x' + increaseData.slice(128, 192));
const ownerAt = async block => topicAddress(await call(profile.positionManager, SEL.ownerOf + word(TOKEN_ID), block));
const position = decodeUniswapPosition(await call(profile.positionManager, SEL.positions + word(TOKEN_ID), mint.blockNumber));
if (await ownerAt(mint.blockNumber) !== owner || position.liquidity !== liquidity || position.tickLower !== minted.tickLower || position.tickUpper !== minted.tickUpper)
  fail('REOBSERVATION_POSITION_MISMATCH');
const head = Number(BigInt(await rpc('eth_blockNumber', [])));
const ownerNow = await ownerAt(head);

const view = o => ({ transactionHash: o.receipt.transactionHash, blockNumber: o.blockNumber, canonicalBlockHash: o.block.hash,
  transactionIndex: Number(BigInt(o.receipt.transactionIndex)), includedInCanonicalBlock: o.block.transactions.includes(o.receipt.transactionHash),
  status: Number(BigInt(o.receipt.status)), type: o.tx.type, sender: o.verified.txFrom, to: o.verified.txTo, submissionKind: o.verified.delegated ? 'DELEGATED_SINGLE' : 'DIRECT',
  delegationDepth: o.verified.delegationDepth, authorizationList: 'authorizationList' in o.tx, innerCall: o.inner,
  receiptSha256: sha(JSON.stringify(o.receipt)), explorer: profile.explorer + 'tx/' + o.receipt.transactionHash });
const supplement = {
  kind: 'SUPPLEMENTAL_CANONICAL_REOBSERVATION', build: 'BUILD-UNISWAP-LIQUIDITY-PUBLIC', network: 'Base Sepolia', chainId: 84532, run: RUN,
  supplements: { evidenceBundleHash: HISTORICAL_BUNDLE, environment: 'TESTNET_EXECUTED', outcome: 'RECONCILED',
    relationship: 'supplements; the historical bundle is unchanged, not superseded and not re-read by this tool' },
  statement: 'Read-only re-observation from public Base Sepolia through the hardened production verifier (exact reviewed call inside the MetaMask redemption, owner delegation, canonical block inclusion). No wallet, key, signature or transaction.',
  observedAt: new Date().toISOString(), rpc: new URL(baseSepoliaRpcUrl(process.env.GRYLOO_BASE_SEPOLIA_RPC_URL)).host, observedHead: head, owner,
  correction: { field: 'WETH approval receipt blockHash', historicalValue: ZERO_HASH, canonicalValue: approval.block.hash, blockNumber: approval.blockNumber,
    cause: 'The approval receipt was observed while preconfirmed (Base Flashblocks): the provider returned the receipt with an all-zero block hash before the block was sealed. The verifier accepted any 32-byte hash; it now requires canonical inclusion.' },
  approval: { ...view(approval), token: profile.token1.address, spender: approved.spender, amount: approved.amount.toString(),
    allowanceAtCanonicalBlock: allowanceAtApproval.toString() },
  mint: { ...view(mint), positionManager: profile.positionManager, pool: profile.pool, recipient: minted.recipient, tokenId: TOKEN_ID.toString(),
    tickLower: minted.tickLower, tickUpper: minted.tickUpper, fee: minted.fee, liquidity: liquidity.toString(), amount0: amount0.toString(), amount1: amount1.toString(),
    amount0Min: minted.amount0Min.toString(), amount1Min: minted.amount1Min.toString(), deadline: minted.deadline.toString(),
    ownerOfAtCanonicalBlock: owner, ownerOfAtObservedHead: ownerNow, positionAtCanonicalBlock: { ...position, liquidity: position.liquidity.toString(),
      tokensOwed0: position.tokensOwed0.toString(), tokensOwed1: position.tokensOwed1.toString() } },
  transactionsSent: 0,
};
const bytes = JSON.stringify(supplement, null, 2) + '\n';
if (process.argv[2]) await writeFile(process.argv[2], bytes);
console.log(JSON.stringify({ owner, approvalBlock: approval.blockNumber, approvalCanonicalBlockHash: approval.block.hash, mintBlock: mint.blockNumber,
  mintCanonicalBlockHash: mint.block.hash, tokenId: TOKEN_ID.toString(), ownerOfNow: ownerNow, liquidity: liquidity.toString(), amount0: amount0.toString(),
  amount1: amount1.toString(), wethApproved: approved.amount.toString(), fileSha256: sha(bytes) }, null, 2));
