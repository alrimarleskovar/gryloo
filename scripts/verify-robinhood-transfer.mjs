// SPDX-License-Identifier: AGPL-3.0-only
/**
 * RH-DEMO-001 strictly read-only independent verification of an archived Robinhood Testnet self-transfer.
 * It reads only the official public testnet RPC through an allowlist of read methods. It has no wallet,
 * no key, no signing and no submission path.
 * Usage: node scripts/verify-robinhood-transfer.mjs <evidence.json | run-journal.jsonl> <verification.json>
 */
import { readFile, writeFile } from 'node:fs/promises';
import { ROBINHOOD_CHAIN_TESTNET } from '../packages/action-registry/dist/index.js';
import { assertTransferVerifierMethod, verifyArchivedNativeTransfer } from '../packages/reference-reconciler/dist/index.js';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) throw Error('Usage: node scripts/verify-robinhood-transfer.mjs <evidence.json | run-journal.jsonl> <verification.json>');
const text = await readFile(inputPath, 'utf8');
// A run journal is append-only JSON lines; its last line carries the reconciled evidence.
const archive = inputPath.endsWith('.jsonl') ? JSON.parse(text.trimEnd().split('\n').at(-1)).evidence : JSON.parse(text);
if (!archive?.bundle || !archive?.artifacts?.review) throw Error('ARCHIVE_EVIDENCE_MISSING');
const transcript = [];
let id = 0;
async function rpc(method, params) {
  assertTransferVerifierMethod(method);
  for (let attempt = 0; attempt < 4; attempt++) {
    await new Promise(resolve => globalThis.setTimeout(resolve, attempt ? 1000 * attempt : 200));
    const response = await globalThis.fetch(ROBINHOOD_CHAIN_TESTNET.rpc, { method: 'POST', redirect: 'error', signal: globalThis.AbortSignal.timeout(30_000),
      headers: { 'content-type': 'application/json', 'user-agent': 'Gryloo/RH-DEMO-001 independent verifier' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    if (response.status === 429 && attempt < 3) continue;
    const body = await response.json();
    transcript.push({ method, params, result: body.result ?? null, error: body.error ?? null });
    if (!response.ok || body.error) throw Error('PUBLIC_RPC_READ_FAILED ' + response.status + ' ' + method + ' ' + JSON.stringify(body.error ?? null).slice(0, 200));
    return body.result;
  }
  throw Error('PUBLIC_RPC_RATE_LIMITED');
}
const verification = await verifyArchivedNativeTransfer(archive, rpc, { expectedEnvironment: 'TESTNET_EXECUTED', chainId: ROBINHOOD_CHAIN_TESTNET.chainId });
const result = { build: 'RH-DEMO-001', evidence: 'TESTNET_EXECUTED', status: verification.status, readOnly: true, signed: false, broadcast: false,
  endpoint: ROBINHOOD_CHAIN_TESTNET.rpc, checkedAt: new Date().toISOString(), bundleHash: archive.bundleHash,
  explorer: `${ROBINHOOD_CHAIN_TESTNET.explorer}/tx/${verification.transactionHash}`, verification, transcript };
await writeFile(outputPath, JSON.stringify(result, null, 2) + '\n');
console.log(`${verification.status}: ${verification.transactionHash} block ${verification.blockNumber} signer ${verification.signer} fee ${verification.fee} wei, finality ${verification.finality}`);
