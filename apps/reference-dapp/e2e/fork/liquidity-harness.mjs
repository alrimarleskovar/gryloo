// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-006 local-only lifecycle. Called by one bounded recording and byte-identical closed replay. */
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { setTimeout } from 'node:timers';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rpc, anvilTestWallet } from './harness.mjs';
import { fromHex, decodeUnsignedPayload, LIQUIDITY_FACTORY, LIQUIDITY_USDC, LIQUIDITY_WETH, POSITION_MANAGER } from '../../../../packages/reference-compiler/dist/index.js';
/**
 * Node type stripping needs explicit extensions; the application sources use bundler-style relative imports.
 * Only an extensionless relative import from inside apps/reference-dapp/src to an existing .ts file there is mapped.
 */
const APP_SOURCE = pathToFileURL(fileURLToPath(new URL('../../src/', import.meta.url))).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier) && context.parentURL?.startsWith(APP_SOURCE)) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (candidate.href.startsWith(APP_SOURCE) && existsSync(candidate)) return nextResolve(candidate.href, context);
    }
    return nextResolve(specifier, context);
  },
});
const word = value => BigInt(value).toString(16).padStart(64, '0');
const addressWord = value => value.slice(2).padStart(64, '0');
const sha = hex => `0x${createHash('sha256').update(Buffer.from(hex.slice(2), 'hex')).digest('hex')}`;
const poolSelector = '0x1698ee82';
const address = raw => {
  if (typeof raw !== 'string' || !/^0x[0-9a-f]{64}$/.test(raw)) throw new Error('LIQUIDITY_POOL_READ_INVALID');
  return `0x${raw.slice(-40)}`;
};
const pinned = blockHash => ({ blockHash, requireCanonical: true });
export async function discoverLiquidityPins(call = rpc) {
  if (await call('eth_chainId') !== '0x7a69') throw new Error('LOCAL_FORK_REQUIRED');
  const at = await call('eth_getBlockByNumber', ['latest', false]);
  if (!/^0x[0-9a-f]{64}$/.test(at?.hash)) throw new Error('LOCAL_BLOCK_INVALID');
  const pool = address(await call('eth_call', [{ to: LIQUIDITY_FACTORY,
    data: `${poolSelector}${addressWord(LIQUIDITY_WETH)}${addressWord(LIQUIDITY_USDC)}${word(500)}` }, pinned(at.hash)]));
  if (pool === '0x0000000000000000000000000000000000000000') throw new Error('LIQUIDITY_POOL_MISSING');
  const targets = { pool, manager: POSITION_MANAGER, factory: LIQUIDITY_FACTORY, usdc: LIQUIDITY_USDC, weth: LIQUIDITY_WETH };
  const pins = {};
  for (const [name, target] of Object.entries(targets)) {
    const code = await call('eth_getCode', [target, pinned(at.hash)]);
    if (typeof code !== 'string' || !/^0x(?:[0-9a-f]{2})+$/.test(code)) throw new Error(`LIQUIDITY_${name.toUpperCase()}_CODE_MISSING`);
    pins[`${name}CodeHash`] = sha(code);
  }
  const slot = await call('eth_call', [{ to: pool, data: '0x3850c7bd' }, pinned(at.hash)]);
  if (typeof slot !== 'string' || !/^0x[0-9a-f]{448}$/.test(slot)) throw new Error('LIQUIDITY_SLOT0_INVALID');
  const rawTick = BigInt(`0x${slot.slice(66, 130)}`) & ((1n << 24n) - 1n);
  const tick = Number(rawTick >= (1n << 23n) ? rawTick - (1n << 24n) : rawTick);
  return { liquidity: { pool, fee: 500, ...pins }, tick, blockHash: at.hash };
}
function requestFromPrepared(prepared) {
  const payload = decodeUnsignedPayload(fromHex(prepared.bytes));
  return { from: prepared.owner, to: payload.to, nonce: `0x${payload.nonce.toString(16)}`,
    gas: `0x${payload.gasLimit.toString(16)}`, maxFeePerGas: `0x${payload.maxFeePerGas.toString(16)}`,
    maxPriorityFeePerGas: `0x${payload.maxPriorityFeePerGas.toString(16)}`,
    value: '0x0', data: `0x${Buffer.from(payload.data).toString('hex')}`, chainId: '0x7a69', type: '0x2' };
}
/** All submissions here are disposable local chain-31337 wallet requests. */
export async function runLiquidityLifecycle({ call = rpc, profile, journalRoot, tolerant = false }) {
  const { createLiquidityService } = await import('../../src/server/liquidity-service.ts');
  const { createLiquidityNode } = await import('../../src/domain/liquidity-authoring.ts');
  const { baseAssetRegistry, referenceRegistry } = await import('../../../../packages/action-registry/dist/index.js');
  const context = { registryId: referenceRegistry.registryId, capabilityId: referenceRegistry.capabilities[0].id,
    actionId: referenceRegistry.actions[0].id, assets: baseAssetRegistry };
  const head = await call('eth_getBlockByNumber', ['latest', false]);
  const slot = await call('eth_call', [{ to: profile.liquidity.pool, data: '0x3850c7bd' }, pinned(head.hash)]);
  const rawTick = BigInt(`0x${slot.slice(66, 130)}`) & ((1n << 24n) - 1n);
  const tick = Number(rawTick >= (1n << 23n) ? rawTick - (1n << 24n) : rawTick);
  const center = Math.floor(tick / 10) * 10;
  const ticks = { lower: center - 100, upper: center + 100 };
  const workflow = { schemaVersion: '1.0.0', workflowId: 'workflow-local', revision: 1, resourceEdges: [],
    nodes: [createLiquidityNode('node-001', { weth: '0.1', usdc: '200', minimumWeth: '0', minimumUsdc: '0',
      tickLower: String(ticks.lower), tickUpper: String(ticks.upper), recipient: profile.owner }, context)] };
  const wallet = anvilTestWallet(call, profile.owner);
  const steps = [];
  let tokenId = null;
  const run = async (operation, extra = {}, fault = null) => {
    const api = createLiquidityService({ call, profile, journalDir: join(journalRoot, operation.toLowerCase()) });
    const prepared = await api.prepare({ workflow, operation, ...(tokenId ? { tokenId } : {}), ...extra });
    const { attemptId } = await api.begin(prepared.executionId, `${operation.toLowerCase()}-key-1`, workflow);
    let report;
    try { report = { kind: 'HASH', transactionHash: await wallet(requestFromPrepared(prepared), fault) }; }
    catch { report = { kind: 'UNKNOWN' }; }
    await api.submission(prepared.executionId, attemptId, report);
    if (report.kind === 'UNKNOWN') {
      const recovered = await api.recoverUnknown(prepared.executionId);
      if (!recovered.transactionHash) throw new Error('LIQUIDITY_UNKNOWN_UNRESOLVED');
    }
    let status;
    for (let i = 0; i < 100; i++) {
      status = await api.observe(prepared.executionId);
      if (status.journal?.attempts.at(-1)?.state !== 'PENDING') break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (status?.reconciliation?.outcome !== 'RECONCILED' || status.journal?.attempts.at(-1)?.state !== 'CONFIRMED')
      throw new Error(`LIQUIDITY_${operation}_NOT_RECONCILED:${status?.reconciliation?.code ?? 'NONE'}`);
    if (operation === 'MINT') tokenId = status.reconciliation.positionTokenId?.toString() ?? null;
    steps.push({ operation, executionId: prepared.executionId, workflowHash: prepared.workflowHash,
      manifestHash: prepared.artifacts.hashes.manifestHash, payloadHash: prepared.payloadHash,
      attemptId, transactionHash: status.transactionHash, outcome: status.reconciliation.outcome,
      code: status.reconciliation.code, tokenId: status.reconciliation.positionTokenId?.toString() ?? null,
      amountWeth: status.reconciliation.amountWeth?.toString() ?? null,
      amountUsdc: status.reconciliation.amountUsdc?.toString() ?? null,
      observedEthFee: status.reconciliation.totalEthFee?.toString() ?? null,
      evidenceBundleHash: status.evidence?.evidenceBundleHash ?? null,
      journalEntries: status.canonicalJournal?.entries.length ?? 0 });
    return { api, status };
  };
  try {
    await run('APPROVE_WETH'); await run('APPROVE_USDC'); await run('MINT');
    if (!tokenId) throw new Error('LIQUIDITY_MINT_TOKEN_ID_MISSING');
    const inspect = async () => {
      const api = createLiquidityService({ call, profile, journalDir: join(journalRoot, 'inspect') });
      return api.inspect(tokenId);
    };
    const first = await inspect();
    if (first.read.position?.owner !== profile.owner) throw new Error('LIQUIDITY_INSPECT_OWNER_MISMATCH');
    const allowances = first.read;
    if (BigInt(allowances.wethAllowance) < 100000000000000000n) {
      if (BigInt(allowances.wethAllowance) > 0n) await run('RESET_WETH');
      await run('APPROVE_WETH');
    }
    if (BigInt(allowances.usdcAllowance) < 200000000n) {
      if (BigInt(allowances.usdcAllowance) > 0n) await run('RESET_USDC');
      await run('APPROVE_USDC');
    }
    await run('INCREASE');
    await run('DECREASE_PARTIAL', { partBps: 5000 });
    await run('COLLECT_PARTIAL');
    await run('DECREASE_FULL');
    await run('COLLECT_FINAL');
    const final = await inspect();
    if (final.read.position?.liquidity !== '0' || final.read.position?.owed0 !== '0' || final.read.position?.owed1 !== '0')
      throw new Error('LIQUIDITY_RESIDUAL_POSITION');
    await run('BURN');
    return { status: 'COMPLETE', tokenId, ticks, steps, finalPosition: 'BURNED',
      localSetup: 'LOCAL_SETUP_NOT_BASE_OBSERVED', environment: profile.environment };
  } catch (error) {
    if (!tolerant) throw error;
    return { status: 'INCOMPLETE', tokenId, ticks, steps,
      failure: String(error?.message ?? 'LIQUIDITY_LIFECYCLE_FAILED').replace(/[^A-Za-z0-9_:.,-]/g, '').slice(0, 160),
      localSetup: 'LOCAL_SETUP_NOT_BASE_OBSERVED', environment: profile.environment };
  }
}
