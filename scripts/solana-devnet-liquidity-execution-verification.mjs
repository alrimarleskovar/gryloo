// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-015 independent verification of an owner-executed Orca liquidity lifecycle on Solana Devnet. Read-only: the
 * transport refuses sendTransaction and every non-read method. It re-derives each operation's facts from the public
 * finalized transaction with the raw wire codec, binds them to Gryloo's append-only journal and Evidence Bundle, and
 * re-runs Gryloo's reconciler as a second opinion. Run it only after the owner has executed through the Gryloo UI.
 *
 *   pnpm build && node scripts/solana-devnet-liquidity-execution-verification.mjs <journalDir> <ownerAddress> [output.json]
 *
 * `verifyOrcaLiquidityLifecycle` is exported so the same checks run in unit tests against the MOCKED loopback.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ORCA_WHIRLPOOLS_DEVNET_LIQUIDITY as profile, ORCA_LIQUIDITY_TOP_LEVEL_PROGRAMS, ORCA_LIQUIDITY_INNER_PROGRAMS, base58Encode, decompileMessageV0, fromBase64,
  parseMessageV0, parseOrcaLiquidityEvents, parseTransaction, sha256Hex, solanaSwapArtifactHash, summarizeOrcaLiquidityInstructions, verifyEd25519 } from '../packages/reference-compiler/dist/index.js';
import { reconcileOrcaLiquidityAttempt } from '../packages/reference-reconciler/dist/index.js';

const READ_ONLY = new Set(['getGenesisHash', 'getSignatureStatuses', 'getTransaction', 'getMultipleAccounts']);
export function readOnlyRpc(endpoint) {
  return async (method, params) => {
    if (!READ_ONLY.has(method)) throw new Error('VERIFICATION_DENIES_' + method);
    await new Promise(resolve => setTimeout(resolve, 250));
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const body = await response.json();
    if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error).slice(0, 300)}`);
    return body.result;
  };
}
const lastRecord = (dir, id) => { const lines = readFileSync(join(dir, id + '.jsonl'), 'utf8').trimEnd().split('\n'); return { record: JSON.parse(lines.at(-1)), lines: lines.length }; };

/** Every check throws on failure; the returned report lists what was verified. */
export async function verifyOrcaLiquidityLifecycle({ journalDir, owner, rpc, provenance = 'PUBLIC_DEVNET' }) {
  const checks = [], check = (ok, label) => { if (!ok) throw new Error('VERIFICATION_FAILED: ' + label); checks.push(label); };
  check(await rpc('getGenesisHash', []) === profile.genesisHash, 'cluster is Solana Devnet');
  const registry = readFileSync(join(journalDir, owner + '.orcalp-positions'), 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  const operations = [];
  for (const entry of registry) {
    const { record } = lastRecord(journalDir, entry.id), review = record.review, attempt = record.attempt;
    if (record.verdict !== 'RECONCILED') { operations.push({ id: record.id, operation: record.operation, verdict: record.verdict, state: attempt?.state ?? null, verified: false }); continue; }
    const label = `${record.operation} ${record.id}`;
    check(record.provenance === provenance && record.ownerInitiated === true && review.owner === owner && record.positionMint === entry.positionMint, `${label}: owner-initiated ${provenance} run`);
    // Review and journal integrity.
    check(solanaSwapArtifactHash('execution-plan', review.plan) === record.journal.executionPlanHash, `${label}: journal binds the ExecutionPlan`);
    check(sha256Hex(fromBase64(review.message)) === review.messageHash && review.plan.segments[0].steps[0].payloadHash === review.messageHash, `${label}: message hash = ExecutionPlan payload`);
    const states = record.journal.entries.filter(e => e.level === 'attempt').map(e => e.toState);
    check(states[0] === 'PREPARED' && states[1] === 'SUBMITTING' && states.at(-1) === 'CONFIRMED', `${label}: durable before signing, signature before broadcast (${states.join(' → ')})`);
    // Public chain facts with the raw wire codec.
    const tx = await rpc('getTransaction', [attempt.signature, { encoding: 'base64', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
    check(tx && tx.meta && tx.meta.err === null, `${label}: finalized and successful`);
    const raw = fromBase64(tx.transaction[0], 2048), parsed = parseTransaction(raw);
    check(Buffer.from(raw).toString('base64') === attempt.transaction, `${label}: on-chain bytes = journal signed bytes`);
    check(Buffer.from(parsed.message).toString('base64') === review.message, `${label}: on-chain message = reviewed message`);
    check(base58Encode(parsed.signatures[0]) === attempt.signature, `${label}: transaction id = journal signature`);
    check(parsed.signatures.length === review.signers.length && review.signers.every((s, i) => verifyEd25519(parsed.signatures[i], parsed.message, s)),
      `${label}: valid Ed25519 signatures from exactly ${review.signers.length === 2 ? 'the owner and the position-mint key' : 'the owner'}`);
    const message = parseMessageV0(parsed.message), keys = message.staticKeys, ixs = decompileMessageV0(message, {});
    check(keys[0] === owner && message.lookups.length === 0, `${label}: owner is fee payer; no lookup tables`);
    const names = summarizeOrcaLiquidityInstructions(ixs).map(i => i.name);
    check(JSON.stringify(names) === JSON.stringify(review.instructionSummary.map(i => i.name)), `${label}: instructions ${names.filter(n => !['set_compute_unit_limit', 'create_idempotent'].includes(n)).join(', ')}`);
    const top = [...new Set(ixs.map(i => i.programId))];
    const inner = [...new Set((tx.meta.innerInstructions ?? []).flatMap(g => g.instructions.map(i => keys[i.programIdIndex])))];
    check(top.every(p => ORCA_LIQUIDITY_TOP_LEVEL_PROGRAMS.includes(p)) && inner.every(p => ORCA_LIQUIDITY_INNER_PROGRAMS.includes(p)) && top.includes(profile.programs.whirlpool),
      `${label}: only allowlisted programs (top ${top.length}, inner ${inner.length})`);
    const events = parseOrcaLiquidityEvents(tx.meta.logMessages);
    check(events.every(e => e.whirlpool === profile.pool.address && e.position === review.accounts.position && e.tickLower === review.range.tickLower &&
      e.tickUpper === review.range.tickUpper), `${label}: Orca events on the verified pool, position and range`);
    const liquidityEvent = events.find(e => e.kind !== 'PositionOpened');
    check(!review.operationPlan.decrease && review.operation !== 'OPEN' || liquidityEvent?.liquidity === review.operationPlan.liquidityDelta, `${label}: liquidity delta ${review.operationPlan.liquidityDelta}`);
    // Evidence Bundle binding and honest labelling.
    const evidence = record.evidence;
    check(evidence && solanaSwapArtifactHash('evidence-bundle', evidence.bundle) === evidence.bundleHash, `${label}: Evidence Bundle hash recomputes`);
    check(evidence.bundle.environment === (provenance === 'MOCKED' ? 'MOCKED' : 'TESTNET_EXECUTED') && evidence.publicExecution.environment === (provenance === 'MOCKED' ? 'MOCKED' : 'DEVNET_EXECUTED') &&
      evidence.publicExecution.realFunds === false && !JSON.stringify(evidence).includes('MAINNET_EXECUTED'), `${label}: evidence labelled ${evidence.publicExecution.environment}, realFunds false`);
    check(evidence.publicExecution.signature === attempt.signature && evidence.publicExecution.positionMint === record.positionMint, `${label}: evidence binds signature and position`);
    // Second opinion: Gryloo's own reconciler against the public chain.
    const again = await reconcileOrcaLiquidityAttempt(review, attempt, rpc);
    check(again.verdict === 'RECONCILED', `${label}: Gryloo reconciler re-run → RECONCILED`);
    operations.push({ id: record.id, operation: record.operation, verdict: record.verdict, verified: true, signature: attempt.signature, slot: tx.slot,
      effects: again.effects && { depositedA: again.effects.depositedA, depositedB: again.effects.depositedB, withdrawnPrincipalA: again.effects.withdrawnPrincipalA,
        withdrawnPrincipalB: again.effects.withdrawnPrincipalB, collectedFeesA: again.effects.collectedFeesA, collectedFeesB: again.effects.collectedFeesB,
        rentPaidLamports: again.effects.rentPaidLamports, rentRefundedLamports: again.effects.rentRefundedLamports }, feeLamports: again.feeLamports });
  }
  const positions = [...new Set(registry.map(e => e.positionMint))].map(mint => {
    const runs = operations.filter((_, i) => registry[i].positionMint === mint);
    return { positionMint: mint, operations: runs.map(r => `${r.operation}:${r.verdict}`) };
  });
  return { evidence: provenance === 'MOCKED' ? 'MOCKED' : 'DEVNET_EXECUTED_VERIFICATION', broadcast: false, owner, checkedAt: new Date().toISOString(), positions, operations,
    checks, verified: checks.length };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [journalDir, owner, out] = process.argv.slice(2);
  if (!journalDir || !owner) throw new Error('usage: <journalDir> <ownerAddress> [output.json]');
  const endpoint = process.env.GRYLOO_SOLANA_DEVNET_RPC_URL ?? profile.rpc;
  if (new URL(endpoint).protocol !== 'https:') throw new Error('HTTPS RPC required');
  const report = await verifyOrcaLiquidityLifecycle({ journalDir, owner, rpc: readOnlyRpc(endpoint) });
  if (out) (await import('node:fs')).writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ verified: report.verified, positions: report.positions }, null, 2));
}
