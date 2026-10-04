// SPDX-License-Identifier: AGPL-3.0-only
/** Public reads only. Never funds, signs or broadcasts. Usage: node scripts/verify-tempo-readonly.mjs output.json [owner] */
import { writeFile } from 'node:fs/promises';
import { TEMPO_PAYMENT as p } from '../packages/action-registry/dist/index.js';
import { createTokenPaymentNode } from '../packages/workflow-contracts/dist/index.js';
import { supplyCall, simulateTempoPayment, tempoBalance } from '../packages/reference-compiler/dist/index.js';
const [output, ownerInput] = process.argv.slice(2);
if (!output) throw new Error('OUTPUT_REQUIRED');
const allowed = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_estimateGas', 'eth_simulateV1', 'eth_gasPrice', 'eth_getTransactionCount',
  'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getRawTransactionByHash']);
const transcript = [];
let queue = Promise.resolve();
const read = async (method, params) => {
  if (!allowed.has(method)) throw new Error('READ_ONLY_METHOD_REQUIRED');
  await new Promise(resolve => globalThis.setTimeout(resolve, 180));
  const response = await globalThis.fetch(p.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'error', signal: globalThis.AbortSignal.timeout(20000),
    body: JSON.stringify({ jsonrpc: '2.0', id: transcript.length + 1, method, params }) });
  const body = await response.json(); transcript.push({ method, params, response: body, observedAt: new Date().toISOString() });
  if (!response.ok || body.error || !('result' in body)) throw new Error(JSON.stringify(body.error ?? { status: response.status }));
  return body.result;
};
const rpc = (method, params) => { const next = queue.then(() => read(method, params)); queue = next.catch(() => undefined); return next; };
const artifact = { build: 'BUILD-TEMPO-001', evidenceLevel: 'PUBLIC_READ_ONLY', observedAt: new Date().toISOString(), rpc: p.rpc,
  chainId: p.chainId, ownerSigned: false, transactionsSubmitted: 0, faucetInvoked: false, transcript };
try {
  const chain = await rpc('eth_chainId', []); if (chain !== p.chainHex) throw new Error('WRONG_CHAIN');
  const head = await rpc('eth_getBlockByNumber', ['finalized', false]);
  artifact.finalized = { number: head.number, hash: head.hash, timestamp: head.timestamp };
  // Observe already-public transactions to check reconciliation RPC availability. These are not Flofi executions.
  artifact.existingPublicTransactions = [];
  for (const hash of head.transactions.slice(0, 3)) {
    const transaction = await rpc('eth_getTransactionByHash', [hash]);
    const receipt = await rpc('eth_getTransactionReceipt', [hash]);
    const raw = await rpc('eth_getRawTransactionByHash', [hash]);
    artifact.existingPublicTransactions.push({ hash, transaction, receipt, raw, meaning: 'Unrelated pre-existing public transaction; not owner or Flofi execution evidence' });
  }
  artifact.token = {};
  for (const signature of ['decimals()', 'currency()', 'paused()', 'transferPolicyId()']) {
    artifact.token[signature] = await rpc('eth_call', [{ to: p.token, data: supplyCall(signature) }, head.number]);
  }
  // A synthetic discovery address is not an owner; its actual balance is read, never assumed.
  const owner = ownerInput ?? '0x1111111111111111111111111111111111111111';
  artifact.account = owner; artifact.accountMeaning = ownerInput ? 'Supplied address; no wallet access or authorization' : 'Synthetic publicly known discovery address; not the owner, any simulation is unauthorised and ephemeral';
  artifact.balance = (await tempoBalance(rpc, owner, head.number)).toString();
  const fields = { chain: p.chain, token: p.token, decimals: 6, adapterId: p.adapterId, feeToken: p.token,
    amount: '1000000', maximumFee: '10000', recipient: '0x2222222222222222222222222222222222222222', memo: '0x' + '01'.repeat(32) };
  const workflow = { schemaVersion: '1.0.0', workflowId: 'tempo-readonly', revision: 1, nodes: [createTokenPaymentNode('payment', fields)], resourceEdges: [] };
  artifact.workflow = workflow;
  try { artifact.review = await simulateTempoPayment(workflow, owner, rpc); artifact.preflight = 'PASSED_READ_ONLY'; }
  catch (e) { artifact.preflight = 'BLOCKED_FAIL_CLOSED'; artifact.reason = e.message; }
  artifact.status = 'DISCOVERY_COMPLETE';
} catch (e) { artifact.status = 'DISCOVERY_FAILED'; artifact.reason = e.message; process.exitCode = 1; }
await writeFile(output, JSON.stringify(artifact, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: artifact.status, preflight: artifact.preflight, reason: artifact.reason, calls: transcript.length }));
