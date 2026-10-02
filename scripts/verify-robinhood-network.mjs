// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-RH-001 read-only Robinhood Chain verification. Public RPC reads (eth_chainId, eth_getBlockByNumber,
 * eth_getCode only) and public registry GETs. No wallet, no key, no signing, no transaction.
 * Usage: node scripts/verify-robinhood-network.mjs output.json
 */
import { writeFile } from 'node:fs/promises';
import { ROBINHOOD_CHAIN_MAINNET, ROBINHOOD_CHAIN_TESTNET, ROBINHOOD_PROTOCOL_AVAILABILITY, robinhoodExpectedCode }
  from '../packages/action-registry/dist/index.js';
import { assertNetworkReadMethod, verifyNetworkState } from '../packages/reference-reconciler/dist/index.js';

const [outputPath] = process.argv.slice(2);
if (!outputPath) throw Error('Usage: node scripts/verify-robinhood-network.mjs output.json');
const headers = { 'content-type': 'application/json', 'user-agent': 'Gryloo/BUILD-RH-001 read-only verifier' };
const MAX_BYTES = 3_000_000;
let requests = 0;
async function getJson(url, init = {}) {
  const response = await globalThis.fetch(url, { ...init, headers: { ...headers, ...init.headers }, redirect: 'error',
    signal: globalThis.AbortSignal.timeout(30_000) });
  const body = await response.text();
  if (!response.ok || body.length > MAX_BYTES) throw Error(`HTTP_READ_FAILED ${response.status} ${url}`);
  return body;
}
function transport(url) {
  return async (method, params) => {
    assertNetworkReadMethod(method);
    requests += 1;
    const body = JSON.parse(await getJson(url, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: requests, method, params }) }));
    if (body.error || !('result' in body)) throw Error('PUBLIC_RPC_READ_FAILED');
    return body.result;
  };
}
const expectation = network => ({ chainId: network.chainId, maximumHeadAgeSeconds: 120, maximumClockSkewSeconds: 10,
  code: robinhoodExpectedCode(network) });

const networks = {};
for (const network of [ROBINHOOD_CHAIN_MAINNET, ROBINHOOD_CHAIN_TESTNET])
  networks[network.key] = await verifyNetworkState(transport(network.rpc), expectation(network), Date.now);

// Informational: the unattributed testnet replay of Uniswap v4 PoolManager and UniversalRouter (discovery §5).
const replay = [{ name: 'Uniswap v4 PoolManager (mainnet address)', address: '0x8366a39cc670b4001a1121b8f6a443a643e40951', expect: 'PRESENT' },
  { name: 'UniversalRouter (per-chain page address)', address: '0x8876789976decbfcbbbe364623c63652db8c0904', expect: 'PRESENT' }];
const replayed = {};
for (const network of [ROBINHOOD_CHAIN_MAINNET, ROBINHOOD_CHAIN_TESTNET])
  replayed[network.key] = (await verifyNetworkState(transport(network.rpc), { ...expectation(network), code: replay }, Date.now)).contracts;
const replayObservation = replay.map((item, index) => ({ ...item, mainnetCodeHash: replayed.mainnet[index].codeHash,
  testnetCodeHash: replayed.testnet[index].codeHash, identicalRuntimeCode: replayed.mainnet[index].codeHash === replayed.testnet[index].codeHash }));

// Canonical registries.
const uniswap = JSON.parse(await getJson('https://developers.uniswap.org/deployments.json'));
const uniswapRecords = chainId => uniswap.records.filter(record => record.chainId === chainId);
const uniswapMainnet = new Set(uniswapRecords(4663).map(record => record.address.toLowerCase()));
const uniswapRow = ROBINHOOD_PROTOCOL_AVAILABILITY.find(row => row.protocol === 'uniswap');
const morphoCommit = '88e3383fb3a305afa8322a1eda792ca80f29f3ec';
const morphoChain = await getJson(`https://raw.githubusercontent.com/morpho-org/sdks/${morphoCommit}/packages/morpho-ts/src/chain.ts`);
const morphoAddresses = (await getJson(`https://raw.githubusercontent.com/morpho-org/sdks/${morphoCommit}/packages/morpho-ts/src/addresses.ts`)).toLowerCase();
const morphoRow = ROBINHOOD_PROTOCOL_AVAILABILITY.find(row => row.protocol === 'morpho');
const routes = async url => JSON.parse(await getJson(url));
const acrossMainnet = await routes('https://app.across.to/api/available-routes?destinationChainId=4663');
const acrossTestnetIn = await routes('https://testnet.across.to/api/available-routes?destinationChainId=46630');
const acrossTestnetOut = await routes('https://testnet.across.to/api/available-routes?originChainId=46630');
const lifi = JSON.parse(await getJson('https://li.quest/v1/chains?chainTypes=EVM')).chains;
const registries = {
  uniswap: { source: 'https://developers.uniswap.org/deployments.json', generatedAt: uniswap.generatedAt, sourceCommit: uniswap.source?.commit,
    mainnetRecords: uniswapRecords(4663).length, testnetRecords: uniswapRecords(46630).length,
    pinnedMainnetContractsListed: uniswapRow.mainnetContracts.every(item => uniswapMainnet.has(item.address)) },
  morpho: { source: `morpho-org/sdks@${morphoCommit} packages/morpho-ts`, mainnetChainDeclared: /RobinhoodMainnet\s*=\s*4663\b/.test(morphoChain),
    testnetChainDeclared: /\b46630\b/.test(morphoChain), pinnedMorphoBlueListed: morphoAddresses.includes(morphoRow.mainnetContracts[0].address) },
  across: { mainnetRoutesInto4663: acrossMainnet.length, testnetRoutesInto46630: acrossTestnetIn.length, testnetRoutesFrom46630: acrossTestnetOut.length,
    baseUsdcArrivesAs: acrossMainnet.find(route => route.originChainId === 8453 && route.originTokenSymbol === 'USDC')?.destinationTokenSymbol ?? null },
  lifi: { mainnet4663: lifi.some(chain => chain.id === 4663 && chain.mainnet === true), testnet46630: lifi.some(chain => chain.id === 46630) },
};
const testnetPathExists = registries.uniswap.testnetRecords > 0 || registries.morpho.testnetChainDeclared ||
  registries.across.testnetRoutesInto46630 > 0 || registries.across.testnetRoutesFrom46630 > 0 || registries.lifi.testnet46630 ||
  networks.testnet.findings.some(finding => finding.code === 'UNEXPECTED_CODE');

const result = {
  evidence: 'PUBLIC_READ_ONLY', broadcast: false, signed: false, evidenceMaturity: null,
  checkedAt: new Date().toISOString(), rpcRequests: requests,
  endpoints: { mainnet: ROBINHOOD_CHAIN_MAINNET.rpc, testnet: ROBINHOOD_CHAIN_TESTNET.rpc },
  networks, registries, replayObservation,
  decisionGate: testnetPathExists ? 'REVIEW_REQUIRED: a testnet deployment or route appeared; re-run discovery'
    : 'C: no canonical public-testnet DeFi deployment on Robinhood Chain Testnet',
};
await writeFile(outputPath, JSON.stringify(result, null, 2) + '\n');
const failed = Object.values(networks).some(network => network.status !== 'VERIFIED') || !registries.uniswap.pinnedMainnetContractsListed ||
  !registries.morpho.mainnetChainDeclared || !registries.morpho.pinnedMorphoBlueListed;
console.log(`${result.decisionGate}; networks ${Object.values(networks).map(network => network.status).join('/')}; ${requests} RPC reads`);
if (failed || testnetPathExists) process.exitCode = 1;
