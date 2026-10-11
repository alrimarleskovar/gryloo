// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-WORKFLOW-VISUAL-PRESENTATION-001: Channel Core's side of the workflow visual. A channel proposal's visual is the shared
 * projection of the very canonical workflow its approval handoff holds (same hash, for every capability the chat grammar authors); it
 * is sealed with the message body while the approval link never is; a visual that would not fit the outbox is left out, never the text.
 */
import { describe, expect, it } from 'vitest';
import { parseLocalCommand } from '../../domain/commands';
import { initialEditor } from '../../domain/editor';
import { dappReviewContext } from '../../engine/strategy-engine';
import { composeWorkflowOrRefuse } from '../../platform/index.ts';
import { workflowVisualModel, type WorkflowVisualModel } from '../../platform/workflow-visual.ts';
import { channelKeys, open, sealContext } from './crypto.ts';
import { MAX_SEALED_BODY_BYTES, sealReply } from './delivery.ts';
import { canonicalStrategy } from './strategy.ts';
import type { ChannelReply } from './types.ts';

const OWNER = '0x0000000000000000000000000000000000000001';
const SENTENCES = ['bridge 5 USDC from Base Sepolia to Arbitrum Sepolia via auto slippage 50 bps', 'swap 1 USDC to WETH on Base Sepolia slippage 50 bps',
  'swap 1 devUSDC to SOL on Solana Devnet slippage 50 bps', `supply 1 USDC to Aave on Base Sepolia beneficiary ${OWNER}`,
  `borrow 0.001 WBTC from Aave on Ethereum Sepolia beneficiary ${OWNER}`, `repay 1 USDC to Aave on Base Sepolia beneficiary ${OWNER}`,
  'withdraw 1 USDC from Aave on Base Sepolia', 'add liquidity 0.01 SOL and 0.3 devUSDC ticks -29952 to -25600 on Solana Devnet slippage 100 bps',
  'add liquidity 10 USDC and 0.005 WETH ticks 189960 to 200040 on Base Sepolia slippage 100 bps',
  `compose supply 10 USDC to Aave then borrow 2 USDC then swap borrowed USDC to WETH on Base Sepolia slippage 50 bps owner ${OWNER}`];
const chat = (sentence: string) => parseLocalCommand(sentence, initialEditor().workflow, dappReviewContext(), null);
const keys = channelKeys('c'.repeat(64)), ctx = { tenantId: 'default', keys };
const opened = (sealed: Buffer, outboxId: string) => JSON.parse(open(keys.seal, sealed, sealContext('default', 'channel_outbox', outboxId, 'body'))!) as ChannelReply;
const LINK = 'http://127.0.0.1:3100/approve#flofi_chs_' + 'A'.repeat(43);

describe('BUILD-WORKFLOW-VISUAL-PRESENTATION-001 Channel Core visual', () => {
  it('pictures exactly the canonical workflow the approval hands off: the shared projection, the same hash', () => {
    for (const sentence of SENTENCES) {
      const strategy = canonicalStrategy(chat(sentence));
      if (!strategy.ok) throw new Error(`${sentence}: ${strategy.code}`);
      expect(strategy.visual, sentence).toEqual(workflowVisualModel(composeWorkflowOrRefuse(strategy.spec, strategy.workflowHash)));
      expect(strategy.visual.workflowHash, sentence).toBe(strategy.workflowHash);
      expect(strategy.visual.steps.length, sentence).toBe(strategy.steps.length);
    }
  });

  it('seals the visual with the body, never the approval link, and leaves out a visual that would not fit — never the text', () => {
    const strategy = canonicalStrategy(chat(SENTENCES[9]!));
    if (!strategy.ok) throw new Error(strategy.code);
    const reply: ChannelReply = { text: 'Strategy ready', choices: [], link: { label: 'Open FloFi', url: LINK }, visual: { model: strategy.visual, language: 'PT' } };
    const body = opened(sealReply(ctx, 'cho_a', reply), 'cho_a');
    expect(body).toEqual({ text: 'Strategy ready', choices: [], link: null, visual: { model: JSON.parse(JSON.stringify(strategy.visual)), language: 'PT' } });
    expect(JSON.stringify(body)).not.toContain('flofi_chs_');
    const huge: WorkflowVisualModel = { ...strategy.visual, steps: Array.from({ length: 60 }, (_, i) => ({ ...strategy.visual.steps[0]!, id: `s${i + 1}`, index: i + 1 })) };
    expect(JSON.stringify(huge).length).toBeGreaterThan(MAX_SEALED_BODY_BYTES);
    expect(opened(sealReply(ctx, 'cho_b', { ...reply, visual: { model: huge, language: 'EN' } }), 'cho_b')).toEqual({ text: 'Strategy ready', choices: [], link: null });
    // A reply without a visual is sealed exactly as before.
    expect(opened(sealReply(ctx, 'cho_c', { text: 'hello', choices: [], link: null }), 'cho_c')).toEqual({ text: 'hello', choices: [], link: null });
  });
});
