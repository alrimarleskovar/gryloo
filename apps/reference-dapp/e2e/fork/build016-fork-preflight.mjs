// SPDX-License-Identifier: AGPL-3.0-only
/** Certification-only, read-only coverage probe. Never records live source data or submits a transaction.
 * Start the unchanged composition harness with its pinned transcript, then:
 * node apps/reference-dapp/e2e/fork/build016-fork-preflight.mjs <profile.json> <new-output.json>
 * Exit 3 means BLOCKED, not a successful fork financial certification. Output creation is exclusive. */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectModeCObservation, modeBCodeHash, sqrtRatioAtTick } from '../../../../packages/reference-compiler/dist/index.js';
import { MODE_C_FACTORY, MODE_C_ROUTER, MODE_C_SOURCE, MODE_C_USDC, MODE_C_WETH } from '../../../../packages/workflow-contracts/dist/index.js';
import { canonical, verifyTranscriptDocument } from './replay-upstream.mjs';

const pool = '0xd0b53d9277642d899df5c87a3966a349a798f224';
export const BUILD016_COMPOSITION_PIN = '337da42d5a89f504a37ea795703b52a340a27cfbac2ccbf6793de532c30a496d';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const word = value => BigInt.asUintN(256, BigInt(value)).toString(16).padStart(64, '0');
const selector = value => modeBCodeHash('0x' + Buffer.from(value).toString('hex')).slice(0, 10);
const mappingSlot = (key, index) => modeBCodeHash('0x' + word(key) + word(index));

export async function inventoryBuild016Recordings() {
  const items = [];
  for (const name of ['base-fork', 'liquidity', 'composition']) {
    const bytes = await readFile(new URL(`./${name}-transcript.json`, import.meta.url));
    const t = JSON.parse(bytes);
    verifyTranscriptDocument(t, { accounts: t.identity.accounts });
    const slots = t.exchanges.flatMap(e => {
      const r = JSON.parse(e.anvilRequest);
      return r.method === 'eth_getStorageAt' ? [{ address: r.params[0], slot: r.params[1], sequence: e.sequence }] : [];
    });
    items.push({ path: `apps/reference-dapp/e2e/fork/${name}-transcript.json`, sha256: sha256(bytes),
      sourceChainId: t.sourceChainId, sourceBlockNumber: t.sourceBlockNumber, sourceBlockHash: t.sourceBlockHash,
      poolStorageSlots: slots.filter(s => s.address === pool),
      wethDecimalsSlotRecorded: slots.some(s => s.address === MODE_C_WETH && BigInt(s.slot) === 2n) });
  }
  return items;
}

/** Strictly loopback and read-only. Freshness uses the pinned LOCAL probe head, not an execution grant. */
export async function probeBuild016Fork(profile) {
  const url = new URL(profile.rpcUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || !url.port || profile.chainId !== 31337 ||
      profile.provenance?.upstream !== 'CLOSED_REPLAY_ONLY' || profile.provenance.transcriptSha256 !== BUILD016_COMPOSITION_PIN)
    throw new Error('BUILD016_CLOSED_PROFILE_REQUIRED');
  const recordings = await inventoryBuild016Recordings(), selected = recordings[2];
  if (selected.sha256 !== BUILD016_COMPOSITION_PIN || selected.sourceBlockNumber !== profile.sourceBlockNumber ||
      selected.sourceBlockHash !== profile.sourceBlockHash) throw new Error('BUILD016_SOURCE_PIN_MISMATCH');
  const reads = []; let id = 0;
  const allowed = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'anvil_metadata']);
  const rpc = async (method, params = []) => {
    if (!allowed.has(method)) throw new Error('BUILD016_READ_ONLY_METHOD_REQUIRED');
    const request = { jsonrpc: '2.0', id: ++id, method, params };
    const r = await globalThis.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request), signal: globalThis.AbortSignal.timeout(30000) });
    const response = await r.json();
    // Full large code bytes already reside in the hash-pinned source transcript; avoid duplicating them.
    const evidenceResponse = method === 'eth_getCode' && typeof response.result === 'string'
      ? { ...response, result: { byteLength: (response.result.length - 2) / 2,
        evmKeccak256: modeBCodeHash(response.result), bytesSha256: sha256(Buffer.from(response.result.slice(2), 'hex')),
        representation: 'CODE_COMMITMENTS_REFER_TO_PINNED_SOURCE_TRANSCRIPT' } } : response;
    reads.push({ request, httpStatus: r.status, response: evidenceResponse, wireResponseCanonicalSha256: sha256(canonical(response)) });
    if (!r.ok || response.error || !Object.hasOwn(response, 'result'))
      throw new Error(`${method}: ${JSON.stringify(response.error ?? { httpStatus: r.status })}`);
    return response.result;
  };
  const chain = await rpc('eth_chainId'), metadata = await rpc('anvil_metadata');
  if (chain !== '0x7a69' || metadata.forkedNetwork?.forkBlockNumber !== selected.sourceBlockNumber ||
      metadata.forkedNetwork?.forkBlockHash !== selected.sourceBlockHash) throw new Error('BUILD016_FORK_IDENTITY_MISMATCH');
  const head = await rpc('eth_getBlockByNumber', ['latest', false]);
  const at = { blockHash: head.hash, requireCanonical: true };
  const codeHashes = {};
  for (const address of [MODE_C_WETH, MODE_C_USDC, MODE_C_FACTORY, MODE_C_ROUTER, pool]) {
    const code = await rpc('eth_getCode', [address, at]);
    if (!/^0x(?:[0-9a-f]{2})+$/.test(code)) throw new Error('BUILD016_PROTOCOL_CODE_UNAVAILABLE');
    codeHashes[address] = { evmKeccak256: modeBCodeHash(code), bytesSha256: sha256(Buffer.from(code.slice(2), 'hex')) };
  }
  if ('0x' + codeHashes[pool].bytesSha256 !== profile.liquidity.poolCodeHash) throw new Error('BUILD016_POOL_SHA_PIN_MISMATCH');
  const source = { id: MODE_C_SOURCE, pool, poolCodeHash: codeHashes[pool].evmKeccak256,
    factory: MODE_C_FACTORY, fee: 500, maximumAgeSeconds: 30 };
  let collector;
  try {
    const result = await collectModeCObservation(rpc, { source, semanticWorkflowHash: '0x' + '0'.repeat(64) },
      'dip-swap', Number(BigInt(head.timestamp)));
    collector = { status: 'REFERENCE_READABLE_NOT_AUTHORIZED', artifact: result.artifact, raw: result.raw };
  } catch (e) { collector = { status: 'BLOCKED', error: e.message }; }
  const call = (to, data) => rpc('eth_call', [{ to, data }, at]);
  const decimals = {};
  for (const token of [MODE_C_WETH, MODE_C_USDC]) {
    try { decimals[token] = { result: await call(token, '0x313ce567') }; }
    catch (e) { decimals[token] = { error: e.message }; }
  }
  const slot0 = await call(pool, '0x3850c7bd');
  if (!/^0x[0-9a-f]{448}$/.test(slot0)) throw new Error('BUILD016_SLOT0_INVALID');
  const words = Array.from({ length: 7 }, (_, i) => BigInt('0x' + slot0.slice(2 + i * 64, 66 + i * 64)));
  const sqrt = words[0], tick = Number(BigInt.asIntN(256, words[1]));
  const liquidity = BigInt(await call(pool, '0x1a686502'));
  const spacing = Number(BigInt(await call(pool, '0xd0c93a7c')));
  if (spacing !== 10) throw new Error('BUILD016_TICK_SPACING_MISMATCH');
  const squaredTarget = sqrt * sqrt * 95n / 100n;
  let target = squaredTarget, next = (target + 1n) / 2n;
  while (next < target) { target = next; next = (target + squaredTarget / target) / 2n; }
  let lo = -887272, hi = 887272;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (sqrtRatioAtTick(mid) <= target) lo = mid; else hi = mid - 1; }
  const targetTick = lo, firstTick = Math.floor(tick / spacing) * spacing;
  const wordPosition = Math.floor(Math.floor(tick / spacing) / 256);
  const bitmap = BigInt(await call(pool, selector('tickBitmap(int16)') + word(wordPosition)));
  const recordedSlots = new Set(selected.poolStorageSlots.map(s => BigInt(s.slot).toString()));
  const crossed = [];
  for (let t = firstTick; sqrtRatioAtTick(t) >= target; t -= spacing) {
    const compressed = t / spacing;
    if (Math.floor(compressed / 256) !== wordPosition) throw new Error('BUILD016_PROBE_REQUIRES_ANOTHER_BITMAP_WORD');
    const bit = ((compressed % 256) + 256) % 256;
    if (!(bitmap & (1n << BigInt(bit)))) continue;
    const base = BigInt(mappingSlot(t, 5));
    // Tick.Info occupies four storage words in the actual V3 pool layout. No missing word is zero-filled.
    const slots = Array.from({ length: 4 }, (_, offset) => '0x' + word(base + BigInt(offset)));
    crossed.push({ tick: t, slots, missingSlots: slots.filter(s => !recordedSlots.has(BigInt(s).toString())) });
  }
  const tickProbes = [];
  for (const t of [crossed[0]?.tick, crossed.at(-1)?.tick].filter(t => t !== undefined)) {
    try { tickProbes.push({ tick: t, result: await call(pool, selector('ticks(int24)') + word(t)) }); }
    catch (e) { tickProbes.push({ tick: t, error: e.message }); }
  }
  const missingWords = crossed.reduce((n, t) => n + t.missingSlots.length, 0);
  const blocked = collector.status === 'BLOCKED' || missingWords > 0 || tickProbes.some(p => p.error);
  const document = { format: 'gryloo.build016.fork-certification-preflight.v1',
    status: blocked ? 'BLOCKED_MISSING_PINNED_STATE' : 'PREFLIGHT_ONLY_NOT_CERTIFIED',
    classification: 'NOT_EXECUTION_EVIDENCE', financialMaturityAchieved: null,
    financialTransactions: [], executionEvidenceBundle: null,
    source: selected, availableRecordings: recordings, localChainId: 31337,
    protocol: { weth: MODE_C_WETH, usdc: MODE_C_USDC, factory: MODE_C_FACTORY, router: MODE_C_ROUTER, pool, fee: 500, codeHashes },
    localHead: { number: head.number, hash: head.hash, timestamp: head.timestamp },
    probeClock: { now: Number(BigInt(head.timestamp)), label: 'LOCAL_HEAD_FOR_READ_COVERAGE_ONLY_NOT_EXECUTION_FRESHNESS' },
    localSetup: profile.provenance.localSetup, collector, decimals,
    priceTransitionCoverage: { referenceSqrtPriceX96: sqrt.toString(), referenceTick: tick, liquidity: liquidity.toString(),
      triggerBasisPoints: 500, maximumEligibleSqrtPriceX96: target.toString(), targetTick,
      tickSpacing: spacing, bitmapWordPosition: wordPosition, bitmap: '0x' + word(bitmap),
      initializedTicksToCross: crossed.length, missingTickStorageWords: missingWords, crossed, tickProbes,
      limitation: 'These are necessary crossing reads, not a complete future transaction read set. Recording must run the real swap to discover all required source reads.',
      layoutSource: 'https://raw.githubusercontent.com/Uniswap/v3-core/v1.0.0/contracts/UniswapV3Pool.sol' },
    reads };
  return { ...document, canonicalDocumentSha256: sha256(canonical(document)) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw new Error('Usage: build016-fork-preflight.mjs <closed-profile.json> <new-output.json>');
  const result = await probeBuild016Fork(JSON.parse(await readFile(process.argv[2], 'utf8')));
  await writeFile(process.argv[3], JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({ status: result.status, canonicalDocumentSha256: result.canonicalDocumentSha256,
    collector: result.collector.status, missingTickStorageWords: result.priceTransitionCoverage.missingTickStorageWords }) + '\n');
  process.exitCode = result.status === 'BLOCKED_MISSING_PINNED_STATE' ? 3 : 0;
}
