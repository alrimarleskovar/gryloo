// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-ETHEREUM-001 local fork rehearsal: Aave V3 WBTC Supply → Borrow → Repay → Withdraw and the native test-ETH
 * self-transfer, driven through the real Flofi services, executor model and reconcilers, against a LOCAL Anvil fork of
 * public Ethereum Sepolia state and the official Aave v3.0 contracts.
 *
 * Evidence class: MOCKED (docs/EVIDENCE_LEVELS.md: rehearsals of official code on a local chain are MOCKED). The fork is
 * a live fork, not a byte-identical closed replay, so it is NOT `FORK_REPRODUCED`, and it is never public execution.
 *
 * Safety: every signed transaction goes to the loopback Anvil only (checked before each send). The owner is a fresh
 * disposable key kept in a mode-0600 file under /tmp for the duration of the run and deleted afterwards; it holds no
 * value anywhere. Anvil reads public state through the read-only fork URL; nothing is ever broadcast to Sepolia.
 *
 * Usage: FLOFI_ETHEREUM_SEPOLIA_FORK_REHEARSAL=local node scripts/ethereum-sepolia-fork-rehearsal.mjs <anvil> <output.json> [forkUrl]
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { secp256k1 } from '../packages/reference-reconciler/node_modules/@noble/curves/secp256k1.js';
import { keccak_256 } from '../packages/reference-compiler/node_modules/@noble/hashes/sha3.js';
import { AAVE_V3_ETHEREUM_SEPOLIA as eth, ETHEREUM_SEPOLIA_TRANSFER } from '../packages/action-registry/dist/index.js';
import { rlpEncode, rlpInteger, toHex, fromHex, supplyCall } from '../packages/reference-compiler/dist/index.js';
import { createBorrowNode, createNativeTransferNode, createRepayNode, createSupplyNode, createWithdrawNode } from '../packages/workflow-contracts/dist/index.js';
import { createSupplyService } from '../apps/reference-dapp/src/server/supply-service.ts';
import { createRobinhoodTransferService } from '../apps/reference-dapp/src/server/robinhood-transfer-service.ts';

const [anvil, output, forkUrl = 'https://ethereum-sepolia-rpc.publicnode.com'] = process.argv.slice(2);
if (process.env.FLOFI_ETHEREUM_SEPOLIA_FORK_REHEARSAL !== 'local' || !anvil || !output) throw Error('Usage: FLOFI_ETHEREUM_SEPOLIA_FORK_REHEARSAL=local node scripts/ethereum-sepolia-fork-rehearsal.mjs <anvil> <output.json> [forkUrl]');
if (!/^https:\/\//.test(forkUrl)) throw Error('FORK_URL_MUST_BE_HTTPS');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); s.on('error', reject); });

async function json(url, method, params) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await response.json();
  if (body.error) throw Error(`${method}: ${JSON.stringify(body.error).slice(0, 300)}`);
  return body.result;
}
const head = Number(BigInt(await json(forkUrl, 'eth_blockNumber', [])));
if (BigInt(await json(forkUrl, 'eth_chainId', [])) !== 11155111n) throw Error('FORK_SOURCE_NOT_SEPOLIA');
const forkBlock = head - 3, port = await freePort(), local = `http://127.0.0.1:${port}`;
const child = spawn(anvil, ['--host', '127.0.0.1', '--port', String(port), '--fork-url', forkUrl, '--fork-block-number', String(forkBlock),
  '--no-storage-caching', '--timeout', '45000', '--retries', '5'], { stdio: ['ignore', 'ignore', 'inherit'] });
const keyDir = await mkdtemp('/tmp/flofi-ethereum-001-fork-');
const result = { evidenceClass: 'MOCKED', boundary: 'Local Anvil fork of public Ethereum Sepolia state with the official Aave v3.0 contracts. Not a closed replay (so not FORK_REPRODUCED); never public execution.',
  checkedAt: new Date().toISOString(), forkSource: forkUrl, forkBlock, anvil: null, owner: null, steps: [] };
try {
  for (let i = 0; i < 100; i++) { try { await json(local, 'eth_chainId', []); break; } catch { await pause(200); } }
  result.anvil = await json(local, 'web3_clientVersion', []);
  if (BigInt(await json(local, 'eth_chainId', [])) !== 11155111n) throw Error('LOCAL_FORK_CHAIN_MISMATCH');
  // Disposable owner: a fresh key, mode 0600 under /tmp, deleted at the end. It exists only for this local fork.
  const key = randomBytes(32), keyFile = join(keyDir, 'owner.key');
  await writeFile(keyFile, toHex(key), { mode: 0o600 }); await chmod(keyFile, 0o600);
  const owner = toHex(keccak_256(secp256k1.getPublicKey(key, false).slice(1)).slice(12));
  result.owner = owner;
  await json(local, 'anvil_setBalance', [owner, '0xde0b6b3a7640000']);
  // Setup only (not evidence): the permissionless Aave faucet mints test WBTC to the owner from an impersonated helper.
  const helper = '0x' + 'f1'.repeat(20);
  await json(local, 'anvil_impersonateAccount', [helper]); await json(local, 'anvil_setBalance', [helper, '0xde0b6b3a7640000']);
  await json(local, 'eth_sendTransaction', [{ from: helper, to: eth.faucet, data: supplyCall('mint(address,address,uint256)', eth.asset, owner, 1_000_000n) }]);
  await json(local, 'anvil_mine', ['0x1']);

  /** Chain-bound read client for the loopback fork: Ethereum Sepolia chain id or nothing; no send method. */
  const reads = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_getBalance', 'eth_getTransactionCount',
    'eth_estimateGas', 'eth_gasPrice', 'eth_getTransactionByHash', 'eth_getTransactionReceipt']);
  const rpc = async (method, params) => {
    if (!reads.has(method)) throw Error('FORK_RPC_METHOD_DENIED');
    const value = await json(local, method, params);
    if (method === 'eth_chainId' && BigInt(value) !== 11155111n) throw Error('SUPPLY_WRONG_CHAIN');
    return value;
  };
  /** The owner's wallet stand-in: signs the exact prepared request with the disposable key and sends it to the LOOPBACK fork only. */
  async function ownerSend(tx, nonce, fees) {
    if (new URL(local).hostname !== '127.0.0.1') throw Error('REFUSING_NON_LOOPBACK_SEND');
    const fields = [rlpInteger(BigInt(tx.chainId)), rlpInteger(BigInt(nonce)), rlpInteger(BigInt(fees.priority)), rlpInteger(BigInt(fees.max)), rlpInteger(BigInt(tx.gas)),
      fromHex(tx.to), rlpInteger(BigInt(tx.value)), fromHex(tx.data === '0x' ? '0x' : tx.data), []];
    const digest = keccak_256(Uint8Array.of(2, ...rlpEncode(fields))), signature = secp256k1.sign(digest, key, { prehash: false });
    const publicKey = secp256k1.getPublicKey(key, false);
    const parity = [0, 1].find(i => toHex(secp256k1.Signature.fromBytes(signature).addRecoveryBit(i).recoverPublicKey(digest).toBytes(false)) === toHex(publicKey));
    const r = BigInt(toHex(signature.slice(0, 32))), s = BigInt(toHex(signature.slice(32)));
    const raw = toHex(Uint8Array.of(2, ...rlpEncode([...fields, rlpInteger(BigInt(parity)), rlpInteger(r), rlpInteger(s)])));
    const hash = await json(local, 'eth_sendRawTransaction', [raw]);
    await json(local, 'anvil_mine', ['0x4']);
    return hash;
  }
  const journalDir = await mkdtemp(join(keyDir, 'journal-'));
  const supplyService = createSupplyService({ rpc: async () => { throw Error('BASE_NOT_USED'); }, rpcs: { [eth.chain]: rpc }, journalDir, provenance: 'MOCKED' });
  const asset = { chainId: eth.chain, address: eth.asset, decimals: eth.decimals };
  const flow = node => ({ schemaVersion: '1.0.0', workflowId: 'build-ethereum-001-fork', revision: 0, nodes: [node], resourceEdges: [] });
  const lendingSteps = [
    ['Supply 0.001 WBTC', flow(createSupplyNode('supply', { chain: eth.chain, asset, amount: '100000', beneficiary: owner }))],
    ['Borrow 0.0001 WBTC', flow(createBorrowNode('borrow', { chain: eth.chain, asset, amount: '10000', beneficiary: owner, interestRateMode: 2 }))],
    ['Repay 0.00005 WBTC', flow(createRepayNode('repay', { chain: eth.chain, asset, amount: '5000', beneficiary: owner, interestRateMode: 2 }))],
    ['Withdraw 0.0002 WBTC', flow(createWithdrawNode('withdraw', { chain: eth.chain, asset, amount: '20000', recipient: 'CONNECTED_OWNER' }))],
  ];
  for (const [label, workflow] of lendingSteps) {
    let run = await supplyService.simulate(workflow, owner);
    run = await supplyService.review(run.id, run.review.commitment, workflow);
    const transactions = [];
    for (let guard = 0; run.verdict === 'PENDING' && guard < 3; guard++) {
      const begin = await supplyService.begin(run.id, owner, workflow);
      await supplyService.handoff(run.id, begin.step);
      const gasPrice = BigInt(begin.transaction.gasPrice), priority = gasPrice < 1_000_000_000n ? gasPrice : 1_000_000_000n;
      const hash = await ownerSend(begin.transaction, begin.transaction.nonce, { max: gasPrice, priority });
      transactions.push({ step: begin.step, hash, to: begin.transaction.to, data: begin.transaction.data });
      await supplyService.report(run.id, begin.step, { kind: 'HASH', hash });
      run = await supplyService.observe(run.id);
    }
    const last = run.observations.at(-1);
    result.steps.push({ label, verdict: run.verdict, reason: last?.reason ?? run.error, transactions,
      reviewBlock: run.review.state.block, healthFactorAfter: last?.postPosition?.borrow?.healthFactor ?? null,
      position: last?.postPosition?.position ?? null, debt: last?.postPosition?.borrow?.debt ?? null, walletBalance: last?.postPosition?.balance ?? null,
      evidence: run.evidence ? { environment: run.evidence.bundle.environment, outcome: run.evidence.bundle.outcome, bundleHash: run.evidence.bundleHash } : null });
    if (run.verdict !== 'RECONCILED') throw Error(`${label} did not reconcile: ${run.error ?? last?.reason}`);
  }
  // The native test-ETH self-transfer on the same fork.
  const transferService = createRobinhoodTransferService({ rpcs: { [ETHEREUM_SEPOLIA_TRANSFER.chain]: rpc }, journalDir, provenance: 'MOCKED' });
  const transfer = flow(createNativeTransferNode('transfer', { chain: ETHEREUM_SEPOLIA_TRANSFER.chain, amount: '1000000000000', recipient: 'CONNECTED_OWNER' }));
  let record = await transferService.simulate(transfer, owner);
  record = await transferService.review(record.id, record.review.commitment, transfer);
  const begin = await transferService.begin(record.id, owner, transfer);
  await transferService.handoff(record.id);
  const transferHash = await ownerSend({ ...begin.transaction }, begin.record.attempt.nonce, { max: BigInt(begin.transaction.maxFeePerGas), priority: 0n });
  await transferService.report(record.id, { kind: 'HASH', hash: transferHash });
  record = await transferService.observe(record.id);
  result.steps.push({ label: 'Native self-transfer 0.000001 test ETH', verdict: record.verdict, reason: record.observations.at(-1)?.reason ?? record.error,
    transactions: [{ step: 'TRANSFER', hash: transferHash }], fee: record.observations.at(-1)?.facts?.fee ?? null,
    evidence: record.evidence ? { environment: record.evidence.bundle.environment, outcome: record.evidence.bundle.outcome, bundleHash: record.evidence.bundleHash } : null });
  if (record.verdict !== 'RECONCILED') throw Error(`Transfer did not reconcile: ${record.error}`);
  result.allReconciled = true;
} catch (cause) {
  result.allReconciled = false; result.failure = cause instanceof Error ? cause.message : String(cause);
} finally {
  child.kill('SIGTERM');
  await rm(keyDir, { recursive: true, force: true });
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify({ allReconciled: result.allReconciled, failure: result.failure ?? null, steps: result.steps.map(s => [s.label, s.verdict, s.reason]) }, null, 2));
if (!result.allReconciled) process.exitCode = 1;
