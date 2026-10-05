// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-ETHEREUM-001 independent read-only verifier for the Aave V3 WBTC Supply on Ethereum Sepolia. No wallet, signing or
 * submission method: public JSON-RPC reads only, chain-bound to 0xaa36a7.
 *
 *   --prestate <owner> <amountUnits> <output.json>    Before execution: the owner's balances and Flofi's real simulation of
 *                                                     the exact calls (calldata, gas limits, expiry) for that owner.
 *   --evidence <owner-exported-evidence.json> <output.json>
 *                                                     After execution: re-checks every hash of the exported bundle and
 *                                                     independently reconciles each archived transaction from the chain.
 *
 * `GRYLOO_ETHEREUM_SEPOLIA_RPC_URL` (HTTPS) overrides the default public endpoint.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { AAVE_V3_ETHEREUM_SEPOLIA as p, ETHEREUM_SEPOLIA } from '../packages/action-registry/dist/index.js';
import { readSupplyState, simulateSupply, supplyArtifactHash, supplyHash } from '../packages/reference-compiler/dist/index.js';
import { createSupplyNode, hashJournalBytes } from '../packages/workflow-contracts/dist/index.js';
import { reconcileSupplyAttempt } from '../packages/reference-reconciler/dist/index.js';

const ADDRESS_BOOK = 'https://raw.githubusercontent.com/aave-dao/aave-address-book/c8f1011decd03d50374e0eddce08b691de7f1395/src/AaveV3Sepolia.sol';
const rpcUrl = process.env.GRYLOO_ETHEREUM_SEPOLIA_RPC_URL ?? ETHEREUM_SEPOLIA.rpc;
if (new URL(rpcUrl).protocol !== 'https:') throw Error('RPC_URL_MUST_BE_HTTPS');
const allowed = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_call',
  'eth_estimateGas', 'eth_getCode', 'eth_getBalance', 'eth_getTransactionCount', 'eth_gasPrice', 'eth_simulateV1']);
const transcript = [];
let queue = Promise.resolve();
function rpc(method, params) {
  if (!allowed.has(method)) throw Error('READ_ONLY_METHOD_REQUIRED');
  const job = queue.then(async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      await new Promise(resolve => globalThis.setTimeout(resolve, attempt ? 1000 * attempt : 100));
      const response = await globalThis.fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: transcript.length + 1, method, params }), signal: globalThis.AbortSignal.timeout(30_000) });
      const body = await response.json();
      transcript.push({ method, params, response: body });
      if (response.status === 429 || body.error?.code === -32005) { if (attempt < 3) continue; throw Error('PUBLIC_RPC_RATE_LIMITED'); }
      if (!response.ok || body.error) throw Error('PUBLIC_RPC_READ_FAILED');
      if (method === 'eth_chainId' && body.result !== p.chainHex) throw Error('SUPPLY_WRONG_CHAIN');
      return body.result;
    }
  });
  queue = job.catch(() => undefined);
  return job;
}
const fail = code => { throw Error(code); };
const address = value => /^0x[0-9a-f]{40}$/.test(value) ? value : fail('ADDRESS_INVALID');
const word = value => BigInt(value).toString(16).padStart(64, '0');

const [mode, ...args] = process.argv.slice(2);
if (!['--prestate', '--evidence'].includes(mode) || (mode === '--prestate' ? args.length !== 3 : args.length !== 2))
  throw Error('Usage: --prestate <owner> <amountUnits> output.json | --evidence owner-exported-evidence.json output.json');
if (await rpc('eth_chainId', []) !== p.chainHex) fail('SUPPLY_WRONG_CHAIN');
const book = await globalThis.fetch(ADDRESS_BOOK, { signal: globalThis.AbortSignal.timeout(30_000) });
if (!book.ok) fail('OFFICIAL_PROFILE_READ_FAILED');
const official = (await book.text()).toLowerCase();
for (const field of ['pool', 'provider', 'oracle', 'asset', 'aToken', 'variableDebtToken', 'faucet']) if (!official.includes(p[field])) fail('OFFICIAL_PROFILE_MISMATCH');

let result, outputPath;
if (mode === '--prestate') {
  const [ownerText, amount, output] = args, owner = address(ownerText.toLowerCase());
  outputPath = output;
  if (!/^[1-9][0-9]{0,20}$/.test(amount)) fail('AMOUNT_INVALID');
  const state = await readSupplyState(rpc, p, owner, owner);
  const prerequisites = { walletHoldsAmount: BigInt(state.balance) >= BigInt(amount), walletHoldsTestEth: BigInt(state.nativeBalance) > 0n, verifiedProfile: true };
  if (!Object.values(prerequisites).every(Boolean)) result = { status: 'STOP_PREREQUISITES_FAILED', readOnly: true, owner, amount, prerequisites, state };
  else {
    const workflow = { schemaVersion: '1.0.0', workflowId: 'build-ethereum-001-readonly', revision: 0, resourceEdges: [],
      nodes: [createSupplyNode('supply', { chain: p.chain, asset: { chainId: p.chain, address: p.asset, decimals: p.decimals }, amount, beneficiary: owner })] };
    const review = await simulateSupply(workflow, owner, rpc);
    result = { status: 'READ_ONLY_SIMULATION_VERIFIED', readOnly: true, ownerExecution: false, owner, amount, prerequisites,
      calls: review.transactions.map((tx, index) => ({ to: tx.to, value: tx.value, data: tx.data, chainId: tx.chainId, gasLimit: review.gasLimits[index] })),
      reviewBlock: review.state.block, expiresAt: review.expiresAt, approvalRequired: review.approvalRequired };
  }
} else {
  const [inputPath, output] = args;
  outputPath = output;
  const evidence = JSON.parse(await readFile(inputPath, 'utf8')), r = evidence.artifacts?.review, journal = evidence.artifacts?.journal, bundle = evidence.bundle;
  const publicExecution = evidence.publicExecution;
  if (!r || r.withdraw || r.repay || r.borrow || r.chain !== p.chain || r.pool !== p.pool || r.asset !== p.asset || r.aToken !== p.aToken ||
      bundle?.environment !== 'TESTNET_EXECUTED' || bundle.outcome !== 'RECONCILED' || publicExecution?.provenance !== 'PUBLIC_TESTNET' ||
      publicExecution.ownerInitiated !== true || publicExecution.chainId !== p.chainId) fail('REAL_OWNER_SUPPLY_EVIDENCE_REQUIRED');
  const { commitment, ...reviewContent } = r;
  if (supplyHash(reviewContent) !== commitment) fail('REVIEW_COMMITMENT_MISMATCH');
  if (supplyArtifactHash('evidence-bundle', bundle) !== evidence.bundleHash) fail('EVIDENCE_HASH_MISMATCH');
  for (const [field, kind, value] of [['semanticWorkflowHash', 'semantic-workflow', r.workflow], ['artifactSetHash', 'artifact-set', r.artifactSet],
    ['simulationHash', 'simulation-bundle', r.simulation], ['policyHash', 'authorization-policy', r.policy], ['manifestHash', 'strategy-manifest', r.manifest],
    ['executionPlanHash', 'execution-plan', r.plan]]) if (supplyArtifactHash(kind, value) !== bundle[field]) fail('ARTIFACT_HASH_MISMATCH');
  if (hashJournalBytes(new globalThis.TextEncoder().encode(JSON.stringify(journal))).at(-1) !== bundle.journalHeadHash) fail('JOURNAL_HASH_MISMATCH');
  if (supplyHash(publicExecution) !== bundle.evidence.find(item => item.evidenceId === 'supply-public-observations')?.contentHash) fail('OBSERVATION_HASH_MISMATCH');
  const archived = publicExecution.observations ?? [];
  if (archived.length !== r.transactions.length) fail('ONE_OBSERVATION_PER_REVIEWED_CALL_REQUIRED');
  const independent = [];
  for (const [index, observation] of archived.entries()) {
    const step = r.approvalRequired && index === 0 ? 'APPROVAL' : 'SUPPLY';
    const observed = await reconcileSupplyAttempt(r, { step, nonce: observation.walletEnvelope?.ownerNonceBefore ?? BigInt(observation.transaction.nonce).toString(),
      transaction: r.transactions[index], transactionHash: observation.receipt.transactionHash, preparedAtBlock: r.state.block }, rpc);
    if (observed.verdict !== 'RECONCILED') fail(`INDEPENDENT_RECONCILIATION_FAILED ${step}: ${observed.reason}`);
    if (supplyHash(observed.receipt) !== supplyHash(observation.receipt) || observed.cost !== observation.cost) fail('ARCHIVED_RECEIPT_MISMATCH');
    if (observed.receipt.l1Fee !== undefined) fail('L1_RECEIPT_CARRIES_L1_FEE');
    independent.push({ step, transactionHash: observed.receipt.transactionHash, blockNumber: Number(BigInt(observed.receipt.blockNumber)), cost: observed.cost,
      reason: observed.reason });
  }
  // Independent ABI: Pool.supply(asset, amount, onBehalfOf, referralCode 0) and, if required, the exact approval.
  const supplyData = '0x617ba037' + word(p.asset) + word(r.amount) + word(r.beneficiary) + word(0);
  const supplyCall = r.transactions.at(-1);
  if (supplyCall.to !== p.pool || BigInt(supplyCall.value) !== 0n || supplyCall.data !== supplyData) fail('INDEPENDENT_ABI_MISMATCH');
  if (r.approvalRequired && (r.transactions[0].to !== p.asset || r.transactions[0].data !== '0x095ea7b3' + word(p.pool) + word(r.amount))) fail('INDEPENDENT_APPROVAL_ABI_MISMATCH');
  if (publicExecution.supplyTransactionHash !== independent.at(-1).transactionHash) fail('ARCHIVED_HASH_MISMATCH');
  result = { status: 'TESTNET_EXECUTED', verdict: 'INDEPENDENTLY_RECONCILED', readOnly: true, owner: r.account, beneficiary: r.beneficiary, amount: r.amount,
    evidenceBundleHash: evidence.bundleHash, independent, independentAbi: { function: 'supply(address,uint256,address,uint16)', data: supplyData } };
}
result = { ...result, network: ETHEREUM_SEPOLIA.name, chainId: p.chainId, observedAt: new Date().toISOString(), officialSource: ADDRESS_BOOK, officialSourceHash: supplyHash(official),
  rpcHost: new URL(rpcUrl).host, rpcTranscript: transcript };
await writeFile(outputPath, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ status: result.status, readOnly: true, rpcReadCount: transcript.length, output: outputPath }));
if (result.status === 'STOP_PREREQUISITES_FAILED') process.exitCode = 1;
