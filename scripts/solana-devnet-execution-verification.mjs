// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-DEMO-001 independent verification of an owner-executed Solana Devnet swap. READ-ONLY: the transport
 * refuses every method outside a read allowlist (no sendTransaction) and no key exists here.
 *
 *  A. Chain facts, re-derived from the public finalized transaction with the raw wire codec rather than Gryloo's
 *     reconciler: cluster genesis, finality, owner Ed25519 signature, instruction allowlist, Orca program, exact pool,
 *     swap_v2 arguments, fee, owner/vault balance deltas, minimum output and the Orca Traded event.
 *  B. Journal binding: every journal line validates, the reviewed message/commitment/plan bind the exact on-chain bytes,
 *     and Gryloo's own reconciler, re-run now against public Devnet, still returns RECONCILED.
 *  C. Evidence binding: the downloaded bundle equals the journal's evidence, its artifact hash recomputes, and every
 *     reported fact equals the chain.
 *
 *   pnpm build && node scripts/solana-devnet-execution-verification.mjs <signature> <journal.jsonl> <evidence.json>
 */
import { readFileSync } from 'node:fs';
import { ORCA_WHIRLPOOLS_DEVNET as profile, SOLANA_DEVNET_TOKENS as T } from '../packages/action-registry/dist/index.js';
import { associatedTokenAddress, base58Encode, decodeOrcaSwapV2, decompileMessageV0, fromBase64, orcaOracleAddress, parseMessageV0, parseOrcaTradedEvents,
  parseTransaction, sha256Hex, solanaSwapArtifactHash, solanaSwapHash, toBase64, verifyEd25519 } from '../packages/reference-compiler/dist/index.js';
import { validateSolanaSwapRun } from '../packages/reference-executor/dist/index.js';
import { reconcileSolanaSwapAttempt, classifySolanaSwapEvidence } from '../packages/reference-reconciler/dist/index.js';
import { hashArtifactBytes, hashJournalBytes } from '../packages/workflow-contracts/dist/index.js';

const [signature, journalPath, evidencePath] = process.argv.slice(2);
if (!signature || !journalPath || !evidencePath) throw new Error('usage: <signature> <journal.jsonl> <evidence.json>');
const READ_ONLY = new Set(['getGenesisHash', 'getSignatureStatuses', 'getTransaction', 'getMultipleAccounts', 'getBlockHeight']);
const endpoint = process.env.GRYLOO_SOLANA_DEVNET_RPC_URL ?? profile.rpc;
async function rpc(method, params) {
  if (!READ_ONLY.has(method)) throw new Error('READ_ONLY_VERIFICATION_DENIES_' + method);
  await new Promise(resolve => setTimeout(resolve, 250));
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error).slice(0, 300)}`);
  return body.result;
}
const checks = [];
const check = (ok, label) => { if (!ok) throw new Error('VERIFICATION_FAILED: ' + label); checks.push(label); };
const P = profile.programs, POOL = profile.pool;

// ---- A. Independent chain facts --------------------------------------------------------------------------------
check(await rpc('getGenesisHash', []) === profile.genesisHash, `cluster genesis ${profile.genesisHash} (Solana Devnet)`);
const status = (await rpc('getSignatureStatuses', [[signature], { searchTransactionHistory: true }])).value[0];
check(status?.confirmationStatus === 'finalized' && status.err === null, 'signature status finalized with no error');
const tx = await rpc('getTransaction', [signature, { encoding: 'base64', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
const meta = tx.meta, bytes = fromBase64(tx.transaction[0], 4096), wire = parseTransaction(bytes), message = parseMessageV0(wire.message);
const owner = message.staticKeys[0];
check(tx.version === 0 && wire.signatures.length === 1 && message.header[0] === 1 && base58Encode(wire.signatures[0]) === signature, 'one signer; the signature is the transaction id');
check(verifyEd25519(wire.signatures[0], wire.message, owner), `owner ${owner} Ed25519 signature verifies over the exact message`);
check(message.lookups.length === 0 && meta.loadedAddresses.writable.length === 0 && meta.loadedAddresses.readonly.length === 0, 'no address lookup tables');
const instructions = decompileMessageV0(message, {});
const allowed = new Set([P.computeBudget, P.associatedToken, P.system, P.token, P.whirlpool]);
check(instructions.every(ix => allowed.has(ix.programId)), 'only ComputeBudget, AssociatedToken, System, Token and Whirlpools instructions');
check(instructions.flatMap(ix => ix.accounts).filter(a => a.isSigner).every(a => a.pubkey === owner), 'the owner is the only signer');
const swaps = instructions.filter(ix => ix.programId === P.whirlpool);
check(swaps.length === 1, `exactly one Orca Whirlpools instruction (${P.whirlpool})`);
const swap = swaps[0], args = decodeOrcaSwapV2(swap.data), acct = i => swap.accounts[i].pubkey;
check(Buffer.from(swap.data.slice(0, 8)).toString('hex') === profile.swapV2Discriminator, 'instruction is swap_v2');
check(acct(4) === POOL.address && acct(5) === POOL.tokenMintA && acct(6) === POOL.tokenMintB && acct(8) === POOL.tokenVaultA && acct(10) === POOL.tokenVaultB &&
  acct(14) === orcaOracleAddress(POOL.address), `exact pool ${POOL.address}, mints, vaults and oracle`);
const ownerSol = associatedTokenAddress(owner, T.SOL.mint, P.token, P.associatedToken), ownerUsdc = associatedTokenAddress(owner, T.devUSDC.mint, P.token, P.associatedToken);
check(acct(3) === owner && swap.accounts[3].isSigner && acct(7) === ownerSol && acct(9) === ownerUsdc, 'token authority and both token accounts are the owner\'s own ATAs');
check(args.amountSpecifiedIsInput && args.aToB && args.sqrtPriceLimit === '0', 'exact input, SOL → devUSDC (a_to_b), no price limit');
const keys = message.staticKeys, at = k => keys.indexOf(k);
check(meta.err === null && meta.fee === 5000, `transaction succeeded; fee ${meta.fee} lamports`);
const tok = (list, k) => list.find(b => b.accountIndex === at(k));
const usdcBefore = BigInt(tok(meta.preTokenBalances, ownerUsdc)?.uiTokenAmount.amount ?? '0'), usdcAfter = BigInt(tok(meta.postTokenBalances, ownerUsdc).uiTokenAmount.amount);
const outputDelta = usdcAfter - usdcBefore;
const usdcDeposit = BigInt(meta.preBalances[at(ownerUsdc)] === 0 ? meta.postBalances[at(ownerUsdc)] : 0);
const lamportDelta = BigInt(meta.postBalances[0]) - BigInt(meta.preBalances[0]);
const inputDelta = -(lamportDelta + BigInt(meta.fee) + usdcDeposit);
check(meta.preBalances[at(ownerSol)] === 0 && meta.postBalances[at(ownerSol)] === 0, 'temporary wrapped-SOL account created and closed in the transaction');
check(inputDelta === BigInt(args.amount), `owner SOL input delta ${inputDelta} lamports = swap amount (net of fee ${meta.fee} and devUSDC account deposit ${usdcDeposit})`);
check(outputDelta > 0n && outputDelta >= BigInt(args.otherAmountThreshold), `owner devUSDC output delta ${outputDelta} ≥ minimum ${args.otherAmountThreshold}`);
const vaultSol = BigInt(tok(meta.postTokenBalances, POOL.tokenVaultA).uiTokenAmount.amount) - BigInt(tok(meta.preTokenBalances, POOL.tokenVaultA).uiTokenAmount.amount);
const vaultUsdc = BigInt(tok(meta.postTokenBalances, POOL.tokenVaultB).uiTokenAmount.amount) - BigInt(tok(meta.preTokenBalances, POOL.tokenVaultB).uiTokenAmount.amount);
check(vaultSol === BigInt(args.amount) && vaultUsdc === -outputDelta, 'pool vault deltas mirror the owner deltas');
const otherOwnerTokens = [...meta.preTokenBalances, ...meta.postTokenBalances].filter(b => b.owner === owner && keys[b.accountIndex] !== ownerUsdc);
check(otherOwnerTokens.length === 0, 'no other owner token account moved');
const events = parseOrcaTradedEvents(meta.logMessages);
check(events.length === 1 && events[0].whirlpool === POOL.address && events[0].aToB && events[0].inputAmount === args.amount && BigInt(events[0].outputAmount) === outputDelta,
  'exactly one Orca Traded event: pool, direction, input and output equal the measured deltas');
const inner = [...new Set(meta.innerInstructions.flatMap(group => group.instructions.map(i => keys[i.programIdIndex])))];
const chain = { cluster: 'devnet', genesisHash: profile.genesisHash, signature, slot: tx.slot, blockTime: tx.blockTime, confirmation: status.confirmationStatus, owner,
  program: P.whirlpool, pool: POOL.address, instruction: 'swap_v2', amountIn: args.amount, minimumOut: args.otherAmountThreshold, amountOut: outputDelta.toString(),
  feeLamports: String(meta.fee), devUsdcAccountDepositLamports: usdcDeposit.toString(), ownerLamports: { before: String(meta.preBalances[0]), after: String(meta.postBalances[0]) },
  ownerDevUsdc: { account: ownerUsdc, before: usdcBefore.toString(), after: usdcAfter.toString() }, trade: events[0], programs: [...new Set(instructions.map(i => i.programId))],
  innerPrograms: inner, messageHash: sha256Hex(wire.message), computeUnitsConsumed: meta.computeUnitsConsumed,
  explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet` };

// ---- B. Journal binding ---------------------------------------------------------------------------------------------
const lines = readFileSync(journalPath, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
for (const line of lines) validateSolanaSwapRun(line);
const record = lines.at(-1), review = record.review;
check(lines.every(line => line.id === record.id && line.review.commitment === review.commitment), `journal ${record.id}: ${lines.length} append-only lines, one Review commitment`);
const { commitment, ...content } = review;
check(solanaSwapHash(content) === commitment, 'Review commitment recomputes');
check(review.format === 'gryloo.orca-devnet-review.v1' && review.chain === profile.chain && review.cluster === 'devnet' && review.owner === owner, 'reviewed runtime, cluster and owner match the chain');
check(review.message === toBase64(wire.message) && review.messageHash === chain.messageHash && review.plan.segments[0].steps[0].payloadHash === chain.messageHash,
  'on-chain message is byte-identical to the reviewed message and the ExecutionPlan payload hash');
check(record.attempt.signature === signature && record.attempt.transaction === toBase64(bytes), 'journal signature and signed bytes equal the finalized transaction bytes');
check(review.amount === args.amount && review.quote.otherAmountThreshold === args.otherAmountThreshold && review.slippageBps === 50 &&
  review.input.mint === T.SOL.mint && review.output.mint === T.devUSDC.mint, 'reviewed amount, minimum, slippage and mints equal the on-chain swap');
check(record.provenance === 'PUBLIC_DEVNET' && record.ownerInitiated && record.verdict === 'RECONCILED' && record.attempt.state === 'CONFIRMED' && record.attempt.reconciled,
  'journal: PUBLIC_DEVNET, owner-initiated, CONFIRMED and RECONCILED');
const attempts = record.journal.entries.filter(e => e.level === 'attempt').map(e => e.toState);
check(JSON.stringify(attempts) === JSON.stringify(['PREPARED', 'SUBMITTING', 'PENDING', 'CONFIRMED']), `attempt states ${attempts.join(' → ')} (persisted before signing, signature before broadcast)`);
const fresh = await reconcileSolanaSwapAttempt(review, record.attempt, rpc);
check(fresh.verdict === 'RECONCILED' && fresh.inputSpent === args.amount && fresh.outputReceived === chain.amountOut && fresh.trade?.outputAmount === chain.amountOut,
  'Gryloo reconciler re-run now against public Devnet: RECONCILED');
check(classifySolanaSwapEvidence({ provenance: record.provenance, ownerInitiated: record.ownerInitiated, observation: fresh }) === 'DEVNET_EXECUTED', 'classification DEVNET_EXECUTED');

// ---- C. Evidence Bundle binding ---------------------------------------------------------------------------------------
const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
check(JSON.stringify(evidence) === JSON.stringify(record.evidence), 'downloaded Evidence Bundle equals the journal evidence');
const bundleHash = hashArtifactBytes('evidence-bundle', new TextEncoder().encode(JSON.stringify(evidence.bundle)));
check(bundleHash === evidence.bundleHash, `Evidence Bundle artifact hash recomputes: ${bundleHash}`);
check(evidence.bundle.journalHeadHash === hashJournalBytes(new TextEncoder().encode(JSON.stringify(record.journal))).at(-1) &&
  evidence.bundle.manifestHash === solanaSwapArtifactHash('strategy-manifest', review.manifest) && evidence.bundle.executionPlanHash === solanaSwapArtifactHash('execution-plan', review.plan),
  'bundle binds the journal head, Manifest and ExecutionPlan');
const pe = evidence.publicExecution;
check(evidence.evidenceClass === 'DEVNET_EXECUTED' && pe.environment === 'DEVNET_EXECUTED' && pe.realFunds === false && evidence.bundle.environment === 'TESTNET_EXECUTED' &&
  evidence.bundle.outcome === 'RECONCILED', 'class DEVNET_EXECUTED; frozen v1 bundle environment TESTNET_EXECUTED; realFunds false; never MAINNET_EXECUTED');
check(!JSON.stringify(evidence).includes('MAINNET_EXECUTED'), 'no MAINNET_EXECUTED anywhere in the evidence');
check(pe.signature === signature && pe.slot === tx.slot && pe.blockTime === tx.blockTime && pe.owner === owner && pe.pool === POOL.address && pe.providerProgram === P.whirlpool &&
  pe.requestedInput === args.amount && pe.minimumOutput === args.otherAmountThreshold && pe.actualInputDelta === args.amount && pe.actualOutputDelta === chain.amountOut &&
  pe.feeLamports === chain.feeLamports && pe.trade.outputAmount === chain.amountOut && pe.explorer === chain.explorer, 'every evidence fact equals the independent chain facts');

console.log(JSON.stringify({ result: 'VERIFIED', evidence: 'DEVNET_EXECUTED', readOnly: true, broadcast: false, verifiedAt: new Date().toISOString(), endpoint: new URL(endpoint).origin,
  chain, journal: { id: record.id, lines: lines.length, attemptStates: attempts, reviewCommitment: commitment, verdict: record.verdict },
  evidenceBundle: { bundleHash, bundleEnvironment: evidence.bundle.environment, evidenceClass: evidence.evidenceClass, publicExecutionEnvironment: pe.environment, realFunds: pe.realFunds },
  checks }, null, 2));
