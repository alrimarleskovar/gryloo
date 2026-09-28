// SPDX-License-Identifier: AGPL-3.0-only
/** Strict BUILD-007 closed transcript validator. No fallback provider is available. */
import { verifyTranscriptDocument } from './replay-upstream.mjs';
import { LIQUIDITY_FACTORY, LIQUIDITY_USDC, LIQUIDITY_WETH, POSITION_MANAGER } from '../../../../packages/reference-compiler/dist/index.js';
const address = value => typeof value === 'string' && /^0x[0-9a-f]{40}$/.test(value);
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value);
export function verifyCompositionTranscript(transcript, accounts) {
  const standard = verifyTranscriptDocument(transcript, { accounts });
  const pins = transcript.codeFingerprints?.composition;
  if (!pins || !address(pins.pool) || [LIQUIDITY_FACTORY, LIQUIDITY_WETH, LIQUIDITY_USDC, POSITION_MANAGER].includes(pins.pool) ||
    pins.fee !== 500 || [pins.poolCodeHash, pins.managerCodeHash, pins.factoryCodeHash,
      pins.usdcCodeHash, pins.wethCodeHash, pins.routerCodeHash, pins.quoterCodeHash].some(value => !hash(value)))
    throw new Error('COMPOSITION_TRANSCRIPT_PINS_INVALID');
  if (!/^[0-9a-f]{64}$/.test(transcript.scenarioResultsSha256 ?? '')) throw new Error('COMPOSITION_TRANSCRIPT_SCENARIO_INVALID');
  return { ...standard, composition: pins };
}
