// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-ETHEREUM-001 read-only Ethereum Sepolia verification. Public JSON-RPC reads only (eth_chainId, net_version,
 * eth_getBlockByNumber, eth_getCode, eth_call) pinned to one block, plus public registry GETs. No wallet, no key, no
 * signing, no transaction. Every registered identity is checked against chain state and against its first-party source.
 * Usage: node scripts/verify-ethereum-sepolia.mjs output.json [https-rpc-url]
 */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { AAVE_V3_ETHEREUM_SEPOLIA as AAVE, ETHEREUM_SEPOLIA, ETHEREUM_SEPOLIA_ASSETS, UNISWAP_V3_ETHEREUM_SEPOLIA as UNI }
  from '../packages/action-registry/dist/index.js';
import { modeBCodeHash, SUPPLY_METAMASK, SUPPLY_METAMASK_CODE_HASHES, supplySelector } from '../packages/reference-compiler/dist/index.js';

const [outputPath, rpcUrl = ETHEREUM_SEPOLIA.rpc] = process.argv.slice(2);
if (!outputPath) throw Error('Usage: node scripts/verify-ethereum-sepolia.mjs output.json [https-rpc-url]');
if (new URL(rpcUrl).protocol !== 'https:') throw Error('RPC_URL_MUST_BE_HTTPS');
const AAVE_BOOK = { repository: 'aave-dao/aave-address-book', commit: 'c8f1011decd03d50374e0eddce08b691de7f1395',
  fileCommit: '4ee7b505d40760f48bcfdc4edd5fe3d532ec88d2', path: 'src/AaveV3Sepolia.sol' };
const UNISWAP_REGISTRY = 'https://developers.uniswap.org/deployments.json';
const READ_METHODS = new Set(['eth_chainId', 'net_version', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call']);
const MAX_BYTES = 4_000_000;
const headers = { 'content-type': 'application/json', 'user-agent': 'Flofi/BUILD-ETHEREUM-001 read-only verifier' };
let requests = 0;

async function getText(url, init = {}) {
  const response = await globalThis.fetch(url, { ...init, headers: { ...headers, ...init.headers }, redirect: 'error', signal: globalThis.AbortSignal.timeout(30_000) });
  const body = await response.text();
  if (!response.ok || body.length > MAX_BYTES) throw Error(`HTTP_READ_FAILED ${response.status} ${url}`);
  return body;
}
async function rpc(method, params) {
  if (!READ_METHODS.has(method)) throw Error('READ_METHOD_DENIED');
  requests += 1;
  const body = JSON.parse(await getText(rpcUrl, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: requests, method, params }) }));
  if (body.error || !('result' in body)) throw Error(`PUBLIC_RPC_READ_FAILED ${method}`);
  return body.result;
}

const checks = [];
const check = (name, ok, observed) => { checks.push({ name, ok: Boolean(ok), ...(observed === undefined ? {} : { observed }) }); return ok; };
const word = value => BigInt(value).toString(16).padStart(64, '0');
const addressWord = address => address.slice(2).toLowerCase().padStart(64, '0');
const words = data => (data.slice(2).match(/.{64}/g) ?? []).map(w => BigInt('0x' + w));
const addressAt = (data, index) => '0x' + data.slice(2 + index * 64 + 24, 2 + (index + 1) * 64).toLowerCase();
const bits = (value, from, width) => Number((value >> BigInt(from)) & ((1n << BigInt(width)) - 1n));
const sha256 = code => createHash('sha256').update(Buffer.from(code.slice(2), 'hex')).digest('hex');

const chainId = await rpc('eth_chainId', []);
check('eth_chainId is 0xaa36a7', chainId === ETHEREUM_SEPOLIA.chainHex, chainId);
const netVersion = await rpc('net_version', []);
check('net_version is 11155111', netVersion === String(ETHEREUM_SEPOLIA.chainId), netVersion);
const genesis = await rpc('eth_getBlockByNumber', ['0x0', false]);
check('genesis hash matches the registry', genesis.hash === ETHEREUM_SEPOLIA.genesisHash, genesis.hash);
const latest = await rpc('eth_getBlockByNumber', ['latest', false]);
// Every state read is pinned to one block a few blocks behind the head, so the report is one consistent snapshot.
const pinned = await rpc('eth_getBlockByNumber', ['0x' + (Number(BigInt(latest.number)) - 3).toString(16), false]);
const at = pinned.number;
const block = { number: Number(BigInt(pinned.number)), hash: pinned.hash, timestamp: new Date(Number(BigInt(pinned.timestamp)) * 1000).toISOString(),
  headNumber: Number(BigInt(latest.number)) };
const call = (to, data) => rpc('eth_call', [{ to, data }, at]);
const fn = (signature, ...args) => supplySelector(signature) + args.join('');
const codeOf = async address => { const code = await rpc('eth_getCode', [address, at]); return { bytes: (code.length - 2) / 2, sha256: sha256(code), keccak256: modeBCodeHash(code) }; };

// ── Aave V3 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const aave = { profile: { pool: AAVE.pool, provider: AAVE.provider, oracle: AAVE.oracle, faucet: AAVE.faucet, asset: AAVE.asset, aToken: AAVE.aToken,
  variableDebtToken: AAVE.variableDebtToken }, code: {} };
for (const [name, address] of Object.entries(aave.profile)) {
  aave.code[name] = await codeOf(address);
  check(`Aave ${name} has code`, aave.code[name].bytes > 0, aave.code[name].bytes);
}
check('provider.getPool() is the registered Pool', addressAt(await call(AAVE.provider, fn('getPool()')), 0) === AAVE.pool);
check('provider.getPriceOracle() is the registered Oracle', addressAt(await call(AAVE.provider, fn('getPriceOracle()')), 0) === AAVE.oracle);
check('pool.ADDRESSES_PROVIDER() is the registered Provider', addressAt(await call(AAVE.pool, fn('ADDRESSES_PROVIDER()')), 0) === AAVE.provider);
const reserveList = await call(AAVE.pool, fn('getReservesList()'));
const reserves = words(reserveList).slice(2).map(value => '0x' + value.toString(16).padStart(40, '0'));
check('WBTC is a listed reserve', reserves.includes(AAVE.asset), reserves.length);
async function reserve(asset) {
  const data = await call(AAVE.pool, fn('getReserveData(address)', addressWord(asset))), w = words(data), configuration = w[0];
  return { id: Number(w[7]), aToken: addressAt(data, 8), variableDebtToken: addressAt(data, 10), liquidityIndex: w[1].toString(), variableBorrowIndex: w[3].toString(),
    decimals: bits(configuration, 48, 8), active: bits(configuration, 56, 1) === 1, frozen: bits(configuration, 57, 1) === 1,
    borrowingEnabled: bits(configuration, 58, 1) === 1, paused: bits(configuration, 60, 1) === 1, ltvBps: bits(configuration, 0, 16),
    liquidationThresholdBps: bits(configuration, 16, 16), borrowCap: bits(configuration, 80, 36), supplyCap: bits(configuration, 116, 36) };
}
const wbtc = await reserve(AAVE.asset);
aave.wbtcReserve = wbtc;
check('WBTC reserve id is the registered id', wbtc.id === AAVE.reserveId, wbtc.id);
check('WBTC reserve aToken and variable debt token match the profile', wbtc.aToken === AAVE.aToken && wbtc.variableDebtToken === AAVE.variableDebtToken);
check('WBTC reserve has 8 decimals', wbtc.decimals === AAVE.decimals, wbtc.decimals);
check('WBTC reserve is active, not frozen, not paused, borrowable', wbtc.active && !wbtc.frozen && !wbtc.paused && wbtc.borrowingEnabled);
check('WBTC token reports 8 decimals', words(await call(AAVE.asset, fn('decimals()')))[0] === BigInt(AAVE.decimals));
check('aToken underlying is WBTC and its pool is the Pool', addressAt(await call(AAVE.aToken, fn('UNDERLYING_ASSET_ADDRESS()')), 0) === AAVE.asset &&
  addressAt(await call(AAVE.aToken, fn('POOL()')), 0) === AAVE.pool);
check('variable debt token underlying is WBTC', addressAt(await call(AAVE.variableDebtToken, fn('UNDERLYING_ASSET_ADDRESS()')), 0) === AAVE.asset);
const wbtcSupplied = words(await call(AAVE.aToken, fn('totalSupply()')))[0];
aave.wbtcSupplied = wbtcSupplied.toString();
aave.wbtcSupplyHeadroom = wbtc.supplyCap === 0 ? 'UNCAPPED' : (BigInt(wbtc.supplyCap) * 10n ** 8n - wbtcSupplied).toString();
check('WBTC supply cap leaves headroom', wbtc.supplyCap === 0 || BigInt(wbtc.supplyCap) * 10n ** 8n > wbtcSupplied, aave.wbtcSupplyHeadroom);
const price = words(await call(AAVE.oracle, fn('getAssetPrice(address)', addressWord(AAVE.asset))))[0];
aave.wbtcOraclePriceBase8 = price.toString();
check('oracle prices WBTC above zero', price > 0n, price.toString());
// The USDC blocker that made WBTC the Ethereum Sepolia lending asset (plan §2): supply cap reached.
const usdcAddress = ETHEREUM_SEPOLIA_ASSETS.USDC.address, usdc = await reserve(usdcAddress);
const usdcSupplied = words(await call(usdc.aToken, fn('totalSupply()')))[0];
aave.usdcReserve = { ...usdc, supplied: usdcSupplied.toString(), capUnits: (BigInt(usdc.supplyCap) * 10n ** 6n).toString(),
  capReached: usdc.supplyCap !== 0 && usdcSupplied >= BigInt(usdc.supplyCap) * 10n ** 6n };

// ── Uniswap v3 ──────────────────────────────────────────────────────────────────────────────────────────────────────
const uniswap = { profile: { factory: UNI.factory, positionManager: UNI.positionManager, quoter: UNI.quoter, router: UNI.router, pool: UNI.pool }, code: {} };
for (const [name, address] of Object.entries(uniswap.profile)) {
  uniswap.code[name] = await codeOf(address);
  check(`Uniswap ${name} code matches its SHA-256 pin`, uniswap.code[name].sha256 === UNI.codeSha256[name], uniswap.code[name].sha256);
}
for (const name of ['positionManager', 'quoter', 'router']) {
  check(`${name}.factory() is the Factory`, addressAt(await call(UNI[name], fn('factory()')), 0) === UNI.factory);
  check(`${name}.WETH9() is the registered WETH`, addressAt(await call(UNI[name], fn('WETH9()')), 0) === UNI.weth);
}
check('factory.getPool(USDC, WETH, 3000) is the registered pool',
  addressAt(await call(UNI.factory, fn('getPool(address,address,uint24)', addressWord(UNI.usdc), addressWord(UNI.weth), word(UNI.fee))), 0) === UNI.pool);
check('pool token0 is USDC and token1 is WETH', addressAt(await call(UNI.pool, fn('token0()')), 0) === UNI.usdc && addressAt(await call(UNI.pool, fn('token1()')), 0) === UNI.weth);
check('pool fee is 3000 and tick spacing 60', words(await call(UNI.pool, fn('fee()')))[0] === 3000n && words(await call(UNI.pool, fn('tickSpacing()')))[0] === 60n);
check('pool.factory() is the Factory', addressAt(await call(UNI.pool, fn('factory()')), 0) === UNI.factory);
check('USDC has 6 decimals and WETH 18', words(await call(UNI.usdc, fn('decimals()')))[0] === 6n && words(await call(UNI.weth, fn('decimals()')))[0] === 18n);
const slot0 = words(await call(UNI.pool, fn('slot0()')));
const tick = Number(BigInt.asIntN(24, slot0[1]));
uniswap.pool = { sqrtPriceX96: slot0[0].toString(), tick, unlocked: slot0[6] === 1n, liquidity: words(await call(UNI.pool, fn('liquidity()')))[0].toString() };
check('pool is initialized, unlocked and has in-range liquidity', slot0[0] > 4_295_128_739n && slot0[6] === 1n && BigInt(uniswap.pool.liquidity) > 0n);
const quote = words(await call(UNI.quoter, fn('quoteExactInputSingle((address,address,uint256,uint24,uint160))', addressWord(UNI.usdc), addressWord(UNI.weth),
  word(1_000_000n), word(UNI.fee), word(0n))));
uniswap.quote1Usdc = { amountIn: '1000000', amountOutWeth: quote[0].toString(), initializedTicksCrossed: Number(quote[2]), gasEstimate: quote[3].toString() };
check('QuoterV2 quotes 1 USDC → WETH above zero', quote[0] > 0n, quote[0].toString());

// ── MetaMask delegation framework (relayed submissions accepted by the reconcilers) ─────────────────────────────────
const metamask = {};
for (const [index, name] of ['manager', 'implementation', 'limited', 'exact'].entries()) {
  const code = await codeOf(SUPPLY_METAMASK[name]);
  const pin = SUPPLY_METAMASK_CODE_HASHES[ETHEREUM_SEPOLIA.chainId][index];
  metamask[name] = { address: SUPPLY_METAMASK[name], keccak256: code.keccak256, matchesPin: code.keccak256 === pin, sameAsBaseSepolia: code.keccak256 === SUPPLY_METAMASK.codeHashes[index] };
  check(`MetaMask ${name} code matches the Ethereum Sepolia pin`, metamask[name].matchesPin, code.keccak256);
}

// ── First-party registries ──────────────────────────────────────────────────────────────────────────────────────────
const book = (await getText(`https://raw.githubusercontent.com/${AAVE_BOOK.repository}/${AAVE_BOOK.commit}/${AAVE_BOOK.path}`)).toLowerCase();
const inBook = address => book.includes(address.toLowerCase());
check('Aave address book lists the Pool, Provider, Oracle, Faucet, WBTC, aToken and variable debt token',
  [AAVE.pool, AAVE.provider, AAVE.oracle, AAVE.faucet, AAVE.asset, AAVE.aToken, AAVE.variableDebtToken].every(inBook));
const registryText = await getText(UNISWAP_REGISTRY), registry = JSON.parse(registryText);
const uniswapRecords = registry.records.filter(record => record.chainId === ETHEREUM_SEPOLIA.chainId).map(record => record.address.toLowerCase());
check('Uniswap deployments.json lists the Factory, NonfungiblePositionManager, QuoterV2 and SwapRouter02 on 11155111',
  [UNI.factory, UNI.positionManager, UNI.quoter, UNI.router].every(address => uniswapRecords.includes(address)));

const report = {
  build: 'BUILD-ETHEREUM-001', kind: 'READ_ONLY_PUBLIC_VERIFICATION', evidenceClass: 'PUBLIC_READ_ONLY', generatedAt: new Date().toISOString(),
  rpc: { host: new URL(rpcUrl).host, methods: [...READ_METHODS], requests }, network: { chainId, netVersion, genesisHash: genesis.hash, block },
  aave, uniswap, metamask,
  sources: { aaveAddressBook: { ...AAVE_BOOK, url: `https://github.com/${AAVE_BOOK.repository}/blob/${AAVE_BOOK.commit}/${AAVE_BOOK.path}` },
    uniswapDeployments: { url: UNISWAP_REGISTRY, sha256: createHash('sha256').update(registryText).digest('hex'), recordsOnChain: uniswapRecords.length } },
  limitations: ['Read-only: no transaction, signature or wallet request was made.', 'Values are a snapshot at the pinned block; every execution re-reads them.',
    'A passing report verifies identities and relationships; it is not execution evidence.'],
  checks, allChecksPassed: checks.every(item => item.ok),
};
await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ block: block.number, checks: checks.length, failed: checks.filter(item => !item.ok).map(item => item.name), requests }));
if (!report.allChecksPassed) process.exitCode = 1;
