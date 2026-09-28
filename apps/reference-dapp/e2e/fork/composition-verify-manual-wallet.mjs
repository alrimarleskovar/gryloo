// SPDX-License-Identifier: AGPL-3.0-only
/** Independent BUILD-007 raw-RPC verifier. Reads no wallet or provider key. */
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeModeBSignedTransaction, reconcileCompositionMint } from '../../../../packages/reference-reconciler/dist/index.js';
import { buildCompositionMintCall, LIQUIDITY_USDC, LIQUIDITY_WETH, POSITION_MANAGER, FORK_CONTRACTS,
  modeBCodeHash } from '../../../../packages/reference-compiler/dist/index.js';
const SELF = fileURLToPath(import.meta.url);
const word = value => BigInt(value).toString(16).padStart(64, '0');
const aw = value => value.slice(2).padStart(64, '0');
const bytes = value => Uint8Array.from(Buffer.from(value.slice(2), 'hex'));
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
  if (!response.ok || body.error || !('result' in body)) throw new Error(`COMPOSITION_VERIFY_RPC_${method}`);
  return body.result;
}
const valueAt = (url, block, to, data, index = 0) => rpc(url, 'eth_call', [{ to, data }, { blockHash: block, requireCanonical: true }])
  .then(result => BigInt('0x' + result.slice(2 + index * 64, 66 + index * 64)));
const address = value => '0x' + BigInt(value).toString(16).padStart(40, '0');
const signed24 = value => { const n = Number(BigInt(value) & 0xffffffn); return n >= 0x800000 ? n - 0x1000000 : n; };
async function verify(runtime, wallet, browser, explicitId) {
  const profile = JSON.parse(readFileSync(join(runtime, 'profile.json'), 'utf8'));
  if (profile.chainId !== 31337 || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(profile.rpcUrl))
    throw new Error('COMPOSITION_VERIFY_PROFILE_INVALID');
  const ids = readdirSync(profile.journalDir).filter(name => /^exec-[0-9a-f]{24}$/.test(name));
  const id = explicitId ?? (ids.length === 1 ? ids[0] : null);
  if (!id || !ids.includes(id)) throw new Error('COMPOSITION_VERIFY_EXECUTION_NOT_UNIQUE');
  const prepared = JSON.parse(readFileSync(join(profile.journalDir, id, 'composition.json'), 'utf8'));
  const events = readFileSync(join(profile.journalDir, id, 'composition-events.jsonl'), 'utf8').trimEnd()
    .split('\n').map(line => JSON.parse(line));
  const findings = [], comparisons = [];
  if (profile.environment !== 'FORK_REPRODUCED') findings.push('MOCKED_SOURCE_LIMIT');
  if (await rpc(profile.rpcUrl, 'eth_chainId') !== '0x7a69') findings.push('CHAIN_CHANGED');
  const checkTransaction = async (label, hash, signer, to, data) => {
    const [raw, receipt] = await Promise.all([
      rpc(profile.rpcUrl, 'eth_getRawTransactionByHash', [hash]),
      rpc(profile.rpcUrl, 'eth_getTransactionReceipt', [hash]),
    ]);
    if (typeof raw !== 'string' || !receipt) { findings.push(`${label}_MISSING`); return null; }
    let signed;
    try { signed = decodeModeBSignedTransaction(bytes(raw), hash); }
    catch { findings.push(`${label}_SIGNED_INVALID`); return null; }
    const exact = signed.signer === signer && signed.to === to && signed.data === data &&
      receipt.status === '0x1' && receipt.transactionHash === hash;
    comparisons.push({ label, hash, signer: signed.signer, target: signed.to, dataSha256: sha256(bytes(signed.data)),
      receiptStatus: receipt.status, exact });
    if (!exact) findings.push(`${label}_DIVERGENT`);
    return { signed, receipt, raw };
  };
  for (const row of prepared.installation) {
    const call = prepared.compiled.installation[row.index];
    await checkTransaction(`INSTALL_${row.index}`, row.hash, profile.owner, call.to, call.data);
  }
  const swap = events.findLast(event => event.level === 'ATTEMPT' && event.step === 'SWAP' && event.state === 'RECONCILED');
  const mint = events.findLast(event => event.level === 'ATTEMPT' && event.step === 'MINT' && event.state === 'RECONCILED');
  const reservation = events.find(event => event.level === 'ATTEMPT' && event.step === 'MINT' && event.state === 'RESERVED');
  if (!swap?.transactionHash || !mint?.transactionHash || !reservation?.desiredWETH || !reservation?.desiredUSDC)
    findings.push('TWO_STEP_RECONCILIATION_MISSING');
  let mintOutcome = null, tokenId = null;
  if (!findings.includes('TWO_STEP_RECONCILIATION_MISSING')) {
    const swapTx = await checkTransaction('SWAP', swap.transactionHash, profile.executor,
      prepared.compiled.swapCall.to, prepared.compiled.swapCall.data);
    const mintCall = buildCompositionMintCall(prepared.compiled, BigInt(reservation.desiredWETH), BigInt(reservation.desiredUSDC));
    const mintTx = await checkTransaction('MINT', mint.transactionHash, profile.executor, mintCall.to, mintCall.data);
    if (swapTx && mintTx) {
      const swapBlock = swapTx.receipt.blockHash, mintBlock = mintTx.receipt.blockHash;
      const balance = (token, block) => valueAt(profile.rpcUrl, block, token, '0x70a08231' + aw(profile.safe));
      const [beforeWETH, beforeUSDC, afterWETH, afterUSDC, remainingMintCalls, remainingWETHAllowance,
        remainingUSDCAllowance, safeCode, rolesCode] = await Promise.all([
        balance(LIQUIDITY_WETH, swapBlock), balance(LIQUIDITY_USDC, swapBlock),
        balance(LIQUIDITY_WETH, mintBlock), balance(LIQUIDITY_USDC, mintBlock),
        valueAt(profile.rpcUrl, mintBlock, profile.roles, '0x5e7c9fe8' + prepared.compiled.mintAllowanceKey.slice(2), 3),
        valueAt(profile.rpcUrl, mintBlock, LIQUIDITY_WETH, '0xdd62ed3e' + aw(profile.safe) + aw(POSITION_MANAGER)),
        valueAt(profile.rpcUrl, mintBlock, LIQUIDITY_USDC, '0xdd62ed3e' + aw(profile.safe) + aw(POSITION_MANAGER)),
        rpc(profile.rpcUrl, 'eth_getCode', [profile.safe, { blockHash: mintBlock, requireCanonical: true }]),
        rpc(profile.rpcUrl, 'eth_getCode', [profile.roles, { blockHash: mintBlock, requireCanonical: true }]),
      ]);
      const mintLog = mintTx.receipt.logs.find(log => log.address.toLowerCase() === POSITION_MANAGER &&
        log.topics.length === 4 && log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' &&
        log.topics[1] === '0x' + '0'.repeat(64) && log.topics[2] === '0x' + aw(profile.safe));
      tokenId = mintLog ? BigInt(mintLog.topics[3]) : null;
      let position = null;
      if (tokenId && tokenId > 0n) {
        const [owner, data] = await Promise.all([
          valueAt(profile.rpcUrl, mintBlock, POSITION_MANAGER, '0x6352211e' + word(tokenId)),
          rpc(profile.rpcUrl, 'eth_call', [{ to: POSITION_MANAGER, data: '0x99fbab88' + word(tokenId) },
            { blockHash: mintBlock, requireCanonical: true }]),
        ]);
        const at = index => BigInt('0x' + data.slice(2 + index * 64, 66 + index * 64));
        position = { tokenId, owner: address(owner), token0: address(at(2)), token1: address(at(3)),
          fee: Number(at(4)), tickLower: signed24(at(5)), tickUpper: signed24(at(6)), liquidity: at(7),
          owed0: at(10), owed1: at(11) };
      }
      mintOutcome = reconcileCompositionMint({ chainId: 31337, transactionHash: mint.transactionHash,
        raw: bytes(mintTx.raw), roles: profile.roles, safe: profile.safe, pool: profile.liquidity.pool,
        executor: profile.executor, expectedRoleCall: mintCall.data,
        expectedSafeCodeHash: profile.safeCodeHash, actualSafeCodeHash: modeBCodeHash(safeCode),
        expectedRolesCodeHash: profile.rolesCodeHash, actualRolesCodeHash: modeBCodeHash(rolesCode),
        receipt: { status: 1, blockHash: mintBlock, gasUsed: BigInt(mintTx.receipt.gasUsed),
          effectiveGasPrice: BigInt(mintTx.receipt.effectiveGasPrice),
          logs: mintTx.receipt.logs.map(log => ({ address: log.address.toLowerCase(), topics: log.topics, data: log.data })) },
        stateBlockHash: mintBlock, beforeWETH, afterWETH, beforeUSDC, afterUSDC, remainingMintCalls,
        remainingWETHAllowance, remainingUSDCAllowance, maxWETH: BigInt(prepared.terms.maxWETH),
        maxUSDC: BigInt(prepared.terms.maxUSDC), minWETH: BigInt(prepared.terms.minWETH),
        minUSDC: BigInt(prepared.terms.minUSDC), tickLower: prepared.terms.tickLower,
        tickUpper: prepared.terms.tickUpper, desiredWETH: BigInt(reservation.desiredWETH),
        desiredUSDC: BigInt(reservation.desiredUSDC), position });
      if (mintOutcome.outcome !== 'RECONCILED' || mintOutcome.tokenId !== mint.tokenId)
        findings.push('MINT_INDEPENDENT_RECONCILIATION_FAILED');
      if (BigInt(swapTx.receipt.blockNumber) >= BigInt(mintTx.receipt.blockNumber)) findings.push('STEP_ORDER_INVALID');
      const initialUSDC = await balance(LIQUIDITY_USDC, prepared.beforeUSDCBlock);
      const initialWETH = await balance(LIQUIDITY_WETH, prepared.beforeUSDCBlock);
      const actualOut = beforeWETH - initialWETH, spent = initialUSDC - beforeUSDC;
      if (spent !== BigInt(prepared.terms.swap.amountIn) || actualOut < BigInt(prepared.terms.swap.amountOutMinimum) ||
          actualOut.toString() !== swap.actualWETH || beforeUSDC.toString() !== swap.safeUSDC)
        findings.push('SWAP_DELTA_MISMATCH');
      const remainingSwap = await valueAt(profile.rpcUrl, swapBlock, profile.roles,
        '0x5e7c9fe8' + prepared.compiled.swapAllowanceKey.slice(2), 3);
      if (remainingSwap !== 0n) findings.push('SWAP_ROLE_NOT_CONSUMED');
      const routerAllowance = await valueAt(profile.rpcUrl, swapBlock, LIQUIDITY_USDC,
        '0xdd62ed3e' + aw(profile.safe) + aw(FORK_CONTRACTS.router));
      if (routerAllowance !== 0n) findings.push('SWAP_ROUTER_ALLOWANCE_REMAINS');
    }
  }
  for (const row of prepared.revocation) {
    const call = prepared.compiled.revocation[row.index];
    await checkTransaction(`REVOKE_${row.index}`, row.hash, profile.owner, call.to, call.data);
  }
  if (!wallet || !browser) findings.push('WALLET_OR_BROWSER_UNNAMED');
  const result = { format: 'gryloo.build-007-independent-verification.v1',
    result: findings.length ? 'LIMITED' : 'PASS', findings, environment: profile.environment,
    executionId: id, sourceBlockNumber: profile.sourceBlockNumber, sourceBlockHash: profile.sourceBlockHash,
    wallet, browser, comparisons, tokenId: tokenId?.toString() ?? null, mintOutcome,
    verifierSha256: sha256(readFileSync(SELF)),
    ownerAttestation: 'A named owner-operated injected wallet may be supplied; this verifier reads no private key.' };
  writeFileSync(join(runtime, 'composition-verification.json'), JSON.stringify(result, null, 1) + '\n', { mode: 0o600 });
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  const runtime = process.env.GRYLOO_MODE_B_RUNTIME ?? '/home/asus/.gryloo/build-007/replay-runtime';
  const id = process.argv.includes('--execution') ? process.argv[process.argv.indexOf('--execution') + 1] : null;
  verify(runtime, argument('--wallet'), argument('--browser'), id)
    .then(result => { process.stdout.write(JSON.stringify(result, null, 1) + '\n'); if (result.result !== 'PASS') process.exitCode = 1; })
    .catch(error => { process.stderr.write(`${String(error.message).replace(/[^A-Za-z0-9_:.-]/g, '').slice(0, 300)}\n`); process.exitCode = 1; });
}
export { verify as verifyCompositionManualWallet };
