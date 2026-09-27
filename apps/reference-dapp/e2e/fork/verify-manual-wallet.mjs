// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-003F G7 verifier: after the owner approved and swapped with a named, manually operated injected
 * wallet on the replayed chain-31337 fork, this independently re-reads both signed transactions from
 * the fork and compares every signed field with the reviewed unsigned bytes. Only exact equality and
 * an independently RECONCILED Evidence Bundle give PASS; anything else is LIMITED. No key is read.
 *   node verify-manual-wallet.mjs --wallet "<name version>" --browser "<name version>" [--execution exec-…]
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextEncoder } from 'node:util';
import { decodeSignedTransaction, verifySignedPayload } from '../../../../packages/reference-reconciler/dist/raw-transaction.js';
import { decodeUnsignedPayload, fromHex, toHex } from '../../../../packages/reference-compiler/dist/payload.js';
import { hashArtifactBytes } from '../../../../packages/workflow-contracts/dist/index.js';

const SELF = fileURLToPath(import.meta.url);
const sha256 = value => createHash('sha256').update(value).digest('hex');
function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index > 0 ? process.argv[index + 1] : undefined;
  return typeof value === 'string' && /^[A-Za-z0-9 ._()/+-]{2,80}$/.test(value) ? value : null;
}
async function rpc(url, method, params = []) {
  const response = await globalThis.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: globalThis.AbortSignal.timeout(20_000) });
  const body = await response.json();
  if (body.error || !('result' in body)) throw new Error(`FORK_RPC_${method}`);
  return body.result;
}
const lastValue = path => JSON.parse(readFileSync(path, 'utf8').trimEnd().split('\n').at(-1)).value;

export async function verifyManualWallet({ runtime, wallet, browser, executionId = null }) {
  const profile = JSON.parse(readFileSync(join(runtime, 'profile.json'), 'utf8'));
  const fixture = JSON.parse(readFileSync(join(runtime, 'fixture.json'), 'utf8'));
  const journal = join(runtime, 'journal');
  const executions = readdirSync(journal).filter(name => /^exec-[0-9a-f]{24}$/.test(name));
  // Without an explicit ID, the one execution that reached an Evidence Bundle is the G7 execution.
  const withEvidence = executions.filter(name => { try { return readFileSync(join(journal, name, 'evidence.jsonl')).length > 0; } catch { return false; } });
  const id = executionId ?? (withEvidence.length === 1 ? withEvidence[0] : executions.length === 1 ? executions[0] : null);
  if (!id || !executions.includes(id)) throw new Error('G7_EXECUTION_NOT_UNIQUE');
  const directory = join(journal, id);
  const prepared = JSON.parse(readFileSync(join(directory, 'prepared.json'), 'utf8'));
  const attempts = lastValue(join(directory, 'attempts.jsonl'));
  const evidence = lastValue(join(directory, 'evidence.jsonl'));
  const findings = [];
  const comparisons = [];
  if (profile.environment !== 'FORK_REPRODUCED') findings.push('ENVIRONMENT_NOT_FORK_REPRODUCED');
  if (await rpc(profile.rpcUrl, 'eth_chainId') !== '0x7a69') findings.push('FORK_CHAIN_MISMATCH');
  for (const view of prepared.payloads) {
    const attempt = attempts.filter(item => item.stepId === view.stepId).at(-1);
    if (attempt?.state !== 'CONFIRMED' || !attempt.transactionHash) { findings.push(`${view.stepId}_NOT_CONFIRMED`); continue; }
    const raw = await rpc(profile.rpcUrl, 'eth_getRawTransactionByHash', [attempt.transactionHash]);
    const receipt = await rpc(profile.rpcUrl, 'eth_getTransactionReceipt', [attempt.transactionHash]);
    const signed = decodeSignedTransaction(fromHex(raw), attempt.transactionHash);
    const reviewed = decodeUnsignedPayload(fromHex(view.bytes));
    const fields = ['nonce', 'maxPriorityFeePerGas', 'maxFeePerGas', 'gasLimit', 'to', 'value'].map(field =>
      ({ field, reviewed: String(reviewed[field]), signed: String(signed.unsigned[field]) }));
    fields.push({ field: 'chainId', reviewed: String(reviewed.chainId), signed: String(signed.unsigned.chainId) });
    fields.push({ field: 'data', reviewed: sha256(toHex(reviewed.data)), signed: sha256(toHex(signed.unsigned.data)) });
    fields.push({ field: 'signer', reviewed: prepared.owner, signed: signed.signer });
    let exact = fields.every(item => item.reviewed === item.signed);
    try { verifySignedPayload(fromHex(raw), attempt.transactionHash, prepared.owner, fromHex(view.bytes)); } catch { exact = false; }
    comparisons.push({ stepId: view.stepId, transactionHash: attempt.transactionHash, payloadHash: view.payloadHash,
      receiptStatus: receipt?.status ?? null, exact, fields });
    if (!exact) findings.push(`${view.stepId}_DIVERGENT`);
  }
  const bundle = evidence.find(item => item.version === 1);
  if (!bundle || bundle.outcome !== 'RECONCILED' || bundle.code !== 'EXACT') findings.push('NOT_RECONCILED');
  else if (hashArtifactBytes('evidence-bundle', new TextEncoder().encode(JSON.stringify(bundle.bundle))) !== bundle.evidenceBundleHash) findings.push('EVIDENCE_HASH_MISMATCH');
  if (!wallet || !browser) findings.push('WALLET_OR_BROWSER_UNNAMED');
  const result = { format: 'gryloo.build-003f-g7-manual-wallet.v1', result: findings.length ? 'LIMITED' : 'PASS', findings,
    wallet, browser, executionId: id, environment: profile.environment, sourceBlockNumber: profile.sourceBlockNumber,
    sourceBlockHash: profile.sourceBlockHash, transcriptSha256: fixture.transcriptSha256 ?? null, owner: prepared.owner,
    manifestHash: prepared.hashes.manifestHash, comparisons, evidenceBundleHash: bundle?.evidenceBundleHash ?? null,
    evidenceOutcome: bundle ? `${bundle.outcome}:${bundle.code}` : null, verifierSha256: sha256(readFileSync(SELF)),
    ownerAttestation: 'Signed by the named manually operated wallet; no Anvil signing, key file or clipboard log was used by Gryloo.' };
  writeFileSync(join(runtime, 'g7-manual-wallet.json'), `${JSON.stringify(result, null, 1)}\n`, { mode: 0o600 });
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  const runtime = process.env.GRYLOO_MODE_A_RUNTIME ?? '/home/asus/.gryloo/build-003f/g7-runtime';
  const executionId = process.argv.includes('--execution') ? process.argv[process.argv.indexOf('--execution') + 1] : null;
  verifyManualWallet({ runtime, wallet: argument('--wallet'), browser: argument('--browser'), executionId })
    .then(result => { process.stdout.write(`${JSON.stringify(result, null, 1)}\n`); if (result.result !== 'PASS') process.exitCode = 1; })
    .catch(error => { process.stderr.write(`${String(error?.message ?? 'G7_VERIFY_FAILED').replace(/[^A-Za-z0-9_:.-]/g, '')}\n`); process.exitCode = 1; });
}
