// SPDX-License-Identifier: AGPL-3.0-only
/** Additive BUILD-006 transcript checks before the existing closed loopback replay starts. */
import { verifyTranscriptDocument } from './replay-upstream.mjs';
import { LIQUIDITY_FACTORY, LIQUIDITY_USDC, LIQUIDITY_WETH, POSITION_MANAGER } from '../../../../packages/reference-compiler/dist/index.js';
const address = value => typeof value === 'string' && /^0x[0-9a-f]{40}$/.test(value);
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value);
export function verifyLiquidityTranscript(transcript, accounts) {
  const standard = verifyTranscriptDocument(transcript, { accounts });
  const pool = transcript.codeFingerprints?.pool;
  if (!pool || !address(pool.pool) || pool.pool === LIQUIDITY_FACTORY || pool.pool === POSITION_MANAGER ||
    pool.fee !== 500 || [pool.poolCodeHash, pool.managerCodeHash, pool.factoryCodeHash,
      pool.usdcCodeHash, pool.wethCodeHash].some(value => !hash(value)) ||
    [LIQUIDITY_FACTORY, LIQUIDITY_WETH, LIQUIDITY_USDC, POSITION_MANAGER].includes(pool.pool))
    throw new Error('LIQUIDITY_TRANSCRIPT_PINS_INVALID');
  if (transcript.scenarioResultsSha256 === undefined || !/^[0-9a-f]{64}$/.test(transcript.scenarioResultsSha256))
    throw new Error('LIQUIDITY_TRANSCRIPT_SCENARIO_INVALID');
  return { ...standard, pool };
}
