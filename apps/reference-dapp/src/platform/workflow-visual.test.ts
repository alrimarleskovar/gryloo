// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-WORKFLOW-VISUAL-PRESENTATION-001: the shared workflow visual model and layout, from FloFi's canonical composition.
 *
 * The projection is deterministic, reads the canonical IR without changing it (same workflow, same hash), covers every action family
 * FloFi composes (swap, bridge, lending, liquidity, transfer, compositions and step lists, EVM and Solana), states only what the IR holds
 * (no minimum received, fee or quote is ever invented), carries no secret, link or full address, and lays out identically in English
 * and Portuguese with glyphs the rasterizer's bundled font covers.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { freeze, type Workflow } from '../domain/initial-workflow';
import { createAuthoredTransfer } from '../domain/robinhood-transfer-authoring';
import { dappReviewContext, semanticWorkflowHash, workflowSequenceHash } from '../engine/strategy-engine';
import { STRATEGY_EXAMPLES } from '../engine/strategy-examples';
import { composeWorkflowOrRefuse } from './strategy.ts';
import { visualModelStrings, workflowVisualModel, workflowVisualModelOfIr, type VisualStep, type WorkflowVisualModel } from './workflow-visual.ts';
import { glyphSafe, percentOfBps, VISUAL_BASE_WIDTH, VISUAL_GLYPHS, workflowVisualLayout, workflowVisualText, type VisualNode } from './workflow-visual-layout.ts';

const OWNER = '0x1111111111111111111111111111111111111111', RECIPIENT = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
const example = (id: string) => STRATEGY_EXAMPLES.find(e => e.id === id)!.strategy;
const visualOf = (strategy: unknown) => workflowVisualModel(composeWorkflowOrRefuse(strategy, undefined));
const only = (model: WorkflowVisualModel): VisualStep => { expect(model.steps).toHaveLength(1); return model.steps[0]!; };
const BRIDGE = { action: 'bridge', sourceNetwork: 'base-sepolia', destinationNetwork: 'arbitrum-sepolia', asset: 'USDC', amount: '5' };
const SOLANA_SWAP = { action: 'swap', network: 'solana-devnet', inputAsset: 'devUSDC', outputAsset: 'SOL', amount: '1', slippageBps: 50 };
/** The model's own field set: anything else (a minimum received, a fee, a link…) would be an invented or leaked value. */
const STEP_KEYS = ['account', 'action', 'amountKind', 'amounts', 'chain', 'id', 'index', 'network', 'provider', 'range', 'slippageBps', 'testFunds', 'toAsset', 'toNetwork'];
const MODEL_KEYS = ['chains', 'connections', 'fundsClass', 'networks', 'steps', 'version', 'warnings', 'workflowHash'];
const textsOf = (node: VisualNode): string[] => typeof node.props.children === 'string' ? [node.props.children] : (node.props.children ?? []).flatMap(textsOf);

describe('BUILD-WORKFLOW-VISUAL-PRESENTATION-001 visual model: a deterministic projection of the canonical workflow', () => {
  it('is deterministic: the same strategy gives the same model, layout and text, every time', () => {
    for (const { id, strategy } of STRATEGY_EXAMPLES) {
      const [a, b] = [visualOf(strategy), visualOf(structuredClone(strategy))];
      expect(JSON.stringify(a), id).toBe(JSON.stringify(b));
      for (const language of ['EN', 'PT'] as const) {
        expect(JSON.stringify(workflowVisualLayout(a, language)), id).toBe(JSON.stringify(workflowVisualLayout(b, language)));
        expect(workflowVisualText(a, language), id).toEqual(workflowVisualText(b, language));
      }
    }
  });

  it('never alters the canonical workflow or its hash, and refers to exactly that hash', () => {
    for (const { id, strategy } of [...STRATEGY_EXAMPLES, { id: 'step-list', strategy: { version: 2, steps: [BRIDGE, SOLANA_SWAP] } }]) {
      const composition = composeWorkflowOrRefuse(strategy, undefined), before = JSON.stringify(composition.steps.map(c => c.workflow));
      const model = workflowVisualModel(composition);
      workflowVisualLayout(model, 'PT', 1.6875);
      expect(JSON.stringify(composition.steps.map(c => c.workflow)), id).toBe(before);
      expect(model.workflowHash, id).toBe(composition.workflowHash);
      expect(composeWorkflowOrRefuse(strategy, model.workflowHash).workflowHash, id).toBe(composition.workflowHash);
      if (composition.steps.length === 1) expect(model.workflowHash, id).toBe(semanticWorkflowHash(composition.steps[0]!.workflow));
      // Read-only all the way down: presentation cannot be edited into something else.
      expect(Object.isFrozen(model) && Object.isFrozen(model.steps) && model.steps.every(s => Object.isFrozen(s) && Object.isFrozen(s.amounts)), id).toBe(true);
    }
  });

  it('shows a swap with its exact input, the output asset only, the provider, network and slippage (EVM and Solana)', () => {
    expect(only(visualOf(example('swap-base-sepolia')))).toMatchObject({ action: 'SWAP', provider: 'Uniswap v3', chain: 'EVM', network: 'Base Sepolia', toNetwork: null,
      amounts: [{ amount: '1', asset: 'USDC' }], amountKind: 'EXACT', toAsset: 'WETH', slippageBps: 50, testFunds: true });
    const solana = visualOf(example('swap-solana'));
    expect(only(solana)).toMatchObject({ action: 'SWAP', provider: 'Jupiter', chain: 'SOLANA', network: 'Solana', amounts: [{ amount: '1', asset: 'USDC' }], toAsset: 'SOL',
      testFunds: false });
    expect([solana.fundsClass, solana.warnings]).toEqual(['REAL_FUNDS', ['REAL_FUNDS']]);
    expect(only(visualOf(example('swap-solana-devnet')))).toMatchObject({ provider: 'Orca Whirlpools', chain: 'SOLANA', network: 'Solana Devnet', toAsset: 'SOL' });
  });

  it('shows a bridge with both networks, the routing the IR names and the recipient (shortened) or the signing wallet', () => {
    expect(only(visualOf(BRIDGE))).toMatchObject({ action: 'BRIDGE', provider: 'LI.FI / Across', network: 'Base Sepolia', toNetwork: 'Arbitrum Sepolia',
      amounts: [{ amount: '5', asset: 'USDC' }], slippageBps: 50, account: { role: 'CONNECTED_WALLET' } });
    expect(only(visualOf({ ...BRIDGE, routing: 'across', recipient: RECIPIENT }))).toMatchObject({ provider: 'Across', account: { role: 'RECIPIENT', address: '0xabcd…ef01' } });
    expect(only(visualOf({ ...BRIDGE, routing: 'lifi' })).provider).toBe('LI.FI');
    const mainnet = visualOf(example('bridge-base-arbitrum-one'));
    expect([mainnet.networks, mainnet.fundsClass, only(mainnet).toNetwork]).toEqual([['Base', 'Arbitrum One'], 'REAL_FUNDS', 'Arbitrum One']);
  });

  it('shows lending actions and the lending composition as its own three linked steps, with the debt that remains', () => {
    for (const action of ['supply', 'borrow', 'repay'] as const)
      expect(only(visualOf({ action, network: 'ethereum-sepolia', asset: 'WBTC', amount: '0.001', beneficiary: OWNER }))).toMatchObject({ action: action.toUpperCase(),
        provider: 'Aave V3', network: 'Ethereum Sepolia', amounts: [{ amount: '0.001', asset: 'WBTC' }], account: { role: 'BENEFICIARY', address: '0x1111…1111' } });
    expect(only(visualOf(example('withdraw-base-sepolia')))).toMatchObject({ action: 'WITHDRAW', account: { role: 'CONNECTED_WALLET' }, slippageBps: null });
    const lending = visualOf({ action: 'lending_composition', network: 'base-sepolia', asset: 'USDC', supplyAmount: '10', borrowAmount: '2', outputAsset: 'WETH', owner: OWNER });
    expect(lending.steps.map(s => [s.action, s.provider, s.amounts.map(a => `${a.amount} ${a.asset}`).join(), s.toAsset])).toEqual([['SUPPLY', 'Aave V3', '10 USDC', null],
      ['BORROW', 'Aave V3', '2 USDC', null], ['SWAP', 'Uniswap v3', '2 USDC', 'WETH']]);
    // The IR's own dependency edges, not an assumed order.
    expect(lending.connections).toEqual([{ from: 's1', to: 's2' }, { from: 's2', to: 's3' }]);
    expect(lending.warnings).toEqual(['DEBT_REMAINS']);
    // A step list of exactly supply → borrow → swap is FloFi's lending composition: the same picture and hash.
    const steps = visualOf({ version: 2, steps: [{ action: 'supply', network: 'base-sepolia', asset: 'USDC', amount: '10', beneficiary: OWNER },
      { action: 'borrow', network: 'base-sepolia', asset: 'USDC', amount: '2', beneficiary: OWNER }, { action: 'swap', network: 'base-sepolia', inputAsset: 'USDC', outputAsset: 'WETH', amount: '2' }] });
    expect(steps).toEqual(lending);
  });

  it('shows liquidity as maximum deposits (limits, not spends) with its price range and slippage, on Uniswap and Orca', () => {
    expect(only(visualOf(example('add-liquidity-base-sepolia')))).toMatchObject({ action: 'ADD_LIQUIDITY', provider: 'Uniswap v3', amountKind: 'MAXIMUM',
      amounts: [{ amount: '10', asset: 'USDC' }, { amount: '0.005', asset: 'WETH' }], range: { unit: 'USDC/WETH' }, slippageBps: 100 });
    expect(only(visualOf(example('add-liquidity-solana-devnet')))).toMatchObject({ action: 'ADD_LIQUIDITY', provider: 'Orca Whirlpools', chain: 'SOLANA',
      amounts: [{ amount: '0.01', asset: 'SOL' }, { amount: '0.3', asset: 'devUSDC' }], range: { unit: 'devUSDC/SOL' } });
    expect(workflowVisualText(visualOf(example('add-liquidity-base-sepolia')), 'EN').lines[0]).toMatch(/^1\. Add liquidity \(Uniswap v3\) · Up to 10 USDC \+ 0\.005 WETH · /);
  });

  it('shows a native transfer read from the canonical IR (a FloFi-authored workflow), bound to its semanticWorkflowHash', () => {
    const workflow: Workflow = freeze({ schemaVersion: '1.0.0', workflowId: 'workflow-local', revision: 1, resourceEdges: [],
      nodes: [createAuthoredTransfer('node-transfer', { network: 'Ethereum Sepolia', asset: 'ETH', amount: '0.000001', recipient: 'CONNECTED_OWNER' })] });
    const model = workflowVisualModelOfIr(workflow, dappReviewContext());
    expect(only(model)).toMatchObject({ action: 'TRANSFER', provider: null, network: 'Ethereum Sepolia', amounts: [{ amount: '0.000001', asset: 'ETH' }],
      account: { role: 'CONNECTED_WALLET' } });
    expect(model.workflowHash).toBe(semanticWorkflowHash(workflow));
    expect(workflowVisualText(model, 'PT').title).toBe('Transferir');
  });

  it('shows a multi-step EVM + Solana step list in order, linked by its sequence, bound to the sequence hash', () => {
    const composition = composeWorkflowOrRefuse({ version: 2, steps: [BRIDGE, SOLANA_SWAP] }, undefined), model = workflowVisualModel(composition);
    expect(model.steps.map(s => [s.index, s.action, s.chain, s.network])).toEqual([[1, 'BRIDGE', 'EVM', 'Base Sepolia'], [2, 'SWAP', 'SOLANA', 'Solana Devnet']]);
    expect([model.chains, model.networks]).toEqual([['EVM', 'SOLANA'], ['Base Sepolia', 'Arbitrum Sepolia', 'Solana Devnet']]);
    expect(model.connections).toEqual([{ from: 's1', to: 's2' }]);
    expect(model.warnings).toEqual(['SEQUENCE_NOT_EXECUTABLE']);
    expect(model.workflowHash).toBe(workflowSequenceHash(composition.steps.map(c => c.workflowHash)));
    expect(workflowVisualText(model, 'EN').title).toBe('Bridge → Swap');
    // A long list stays readable: compact cards, every step present.
    const long = visualOf({ version: 2, steps: Array.from({ length: 8 }, (_, i) => ({ action: 'supply', network: 'base-sepolia', asset: 'USDC', amount: String(i + 1),
      beneficiary: OWNER })) });
    expect(long.steps.map(s => s.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(long.connections).toHaveLength(7);
    expect(workflowVisualText(long, 'EN').title).toBe('8-step workflow');
    expect(textsOf(workflowVisualLayout(long, 'EN').tree).filter(t => /^[1-8]$/.test(t))).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
  });

  it('omits what the canonical IR does not state — never a minimum received, fee or quote, never a guessed value', () => {
    for (const { id, strategy } of STRATEGY_EXAMPLES) {
      const model = visualOf(strategy);
      expect(Object.keys(model).sort(), id).toEqual(MODEL_KEYS);
      for (const s of model.steps) expect(Object.keys(s).sort(), id).toEqual(STEP_KEYS);
      for (const language of ['EN', 'PT'] as const) {
        const all = [...textsOf(workflowVisualLayout(model, language).tree), workflowVisualText(model, language).alt].join('\n');
        expect(all, id).not.toMatch(/minimum|mínimo|received|recebid|\bfee\b|taxa|estimated|estimad|≈|quote|cota/i);
      }
    }
    // A step without slippage or account shows neither; a bridge without recipient names the signing wallet, never an address.
    const supply = only(visualOf(example('supply-base-sepolia'))), withdraw = only(visualOf(example('withdraw-base-sepolia')));
    expect([supply.slippageBps, supply.range, supply.toAsset, withdraw.slippageBps]).toEqual([null, null, null, null]);
    expect(workflowVisualText(visualOf(example('withdraw-base-sepolia')), 'EN').lines[0]).toBe('1. Withdraw (Aave V3) · 1 USDC · Base Sepolia · To your connected wallet');
    const bridge = visualOf(BRIDGE);
    expect(JSON.stringify(bridge).replace(bridge.workflowHash, '')).not.toMatch(/0x[0-9a-f]{40}/i);
  });

  it('carries no secret, link, session, capability or full address — only what the channel text already says', () => {
    const models = [visualOf({ ...BRIDGE, recipient: RECIPIENT }), visualOf({ action: 'lending_composition', network: 'base-sepolia', asset: 'USDC', supplyAmount: '10',
      borrowAmount: '2', outputAsset: 'WETH', owner: OWNER }), ...STRATEGY_EXAMPLES.map(e => visualOf(e.strategy))];
    for (const model of models) {
      const json = JSON.stringify(model).replace(model.workflowHash, '');
      expect(json).not.toMatch(/0x[0-9a-fA-F]{40}|flofi_|https?:|approve|secret|token|bearer|session|calldata|signature|privateKey|apr_/i);
      for (const text of visualModelStrings(model)) expect(text).not.toMatch(/0x[0-9a-fA-F]{20,}/);
    }
  });
});

describe('BUILD-WORKFLOW-VISUAL-PRESENTATION-001 visual layout and text (EN/PT)', () => {
  it('speaks the product\'s own vocabulary in English and Portuguese', () => {
    const lending = visualOf(example('lending-composition-base-sepolia')), bridge = visualOf({ ...BRIDGE, recipient: RECIPIENT });
    expect(workflowVisualText(lending, 'EN').title).toBe('Supply → Borrow → Swap');
    expect(workflowVisualText(lending, 'PT').title).toBe('Depositar → Pedir emprestado → Trocar');
    expect(workflowVisualText(bridge, 'PT').lines[0]).toBe('1. Transferir entre redes (LI.FI / Across) · 5 USDC · Base Sepolia → Arbitrum Sepolia · Desvio máximo 0.5% · ' +
      'Destinatário 0xabcd…ef01');
    expect(workflowVisualText(bridge, 'EN').summary).toBe('Bridge · Test funds · 1 step · Base Sepolia · Arbitrum Sepolia');
    expect(workflowVisualText(lending, 'PT').alt).toMatch(/^Fluxo FloFi: .*Fundos de teste · 3 etapas\..*A dívida continua após a troca\..*Revise e assine no FloFi · nada está autorizado ainda\./);
    const pt = textsOf(workflowVisualLayout(lending, 'PT').tree), en = textsOf(workflowVisualLayout(lending, 'EN').tree);
    expect(pt).toEqual(expect.arrayContaining(['FLOFI · FLUXO', 'Fundos de teste', 'A dívida continua após a troca', 'Revise e assine no FloFi · nada está autorizado ainda']));
    expect(en).toEqual(expect.arrayContaining(['FLOFI · WORKFLOW', 'Test funds', 'Debt remains after the swap', 'Review and sign in FloFi · nothing is authorized yet']));
    expect(textsOf(workflowVisualLayout(visualOf(example('swap-base')), 'PT').tree)).toEqual(expect.arrayContaining(['Fundos reais', 'Fundos reais: este fluxo usa uma mainnet']));
    expect([percentOfBps(50), percentOfBps(5), percentOfBps(100), percentOfBps(125), percentOfBps(0)]).toEqual(['0.5', '0.05', '1', '1.25', '0']);
  });

  it('has a fixed size known before rendering, scaled uniformly, with a short reference to the canonical hash', () => {
    for (const { id, strategy } of STRATEGY_EXAMPLES) {
      const model = visualOf(strategy), base = workflowVisualLayout(model, 'EN'), png = workflowVisualLayout(model, 'EN', 1080 / VISUAL_BASE_WIDTH);
      expect([base.width, png.width], id).toEqual([480, 1080]);
      expect(Math.abs(png.height - base.height * 1080 / 480), id).toBeLessThanOrEqual(1);
      expect([base.tree.props.style.width, base.tree.props.style.height], id).toEqual([`${base.width}px`, `${base.height}px`]);
      expect(textsOf(base.tree), id).toContain(`Workflow ${model.workflowHash.slice(0, 6)}…${model.workflowHash.slice(-4)}`);
      expect(JSON.stringify(base.tree), id).not.toContain(model.workflowHash);
    }
  });

  it('keeps long amounts readable (smaller first, then an ellipsis) while the alt text keeps every digit', () => {
    const amount = '123456789012345678901234567890.123456789012345678';
    const nodes = (node: VisualNode): VisualNode[] => [node, ...Array.isArray(node.props.children) ? node.props.children.flatMap(nodes) : []];
    const swap = visualOf(example('swap-base-sepolia')), liquidity = visualOf(example('add-liquidity-base-sepolia'));
    // A long exact amount is set smaller and stays whole.
    const precise = '1234567.123456789012345678', long: WorkflowVisualModel = { ...swap, steps: [{ ...swap.steps[0]!, amounts: [{ amount: precise, asset: 'USDC' }] }] };
    const line = nodes(workflowVisualLayout(long, 'EN').tree).find(n => n.props.children === `${precise} USDC → WETH`)!;
    expect(line.props.style.fontSize).toBe('15px');
    // The contract's extreme (30 integer digits, 18 decimals) cannot fit a phone-width line: it ends in an ellipsis, while the text
    // alternative (and the channel caption) keep every digit.
    const extreme: WorkflowVisualModel = { ...swap, steps: [{ ...swap.steps[0]!, amounts: [{ amount, asset: 'USDC' }] }] };
    expect(textsOf(workflowVisualLayout(extreme, 'EN').tree).find(t => t.startsWith('1234'))!.endsWith('…')).toBe(true);
    expect(workflowVisualText(extreme, 'EN').alt).toContain(`${amount} USDC → WETH`);
    const both: WorkflowVisualModel = { ...liquidity, steps: [{ ...liquidity.steps[0]!, amounts: [{ amount, asset: 'USDC' }, { amount, asset: 'WETH' }] }] };
    expect(textsOf(workflowVisualLayout(both, 'EN').tree).find(t => t.startsWith('Up to '))!.endsWith('…')).toBe(true);
    expect(workflowVisualText(both, 'EN').alt).toContain(`Up to ${amount} USDC + ${amount} WETH`);
  });

  it('uses only glyphs the rasterizer\'s bundled font covers, so drawing never needs another font or a network', () => {
    const font = readFileSync(join(dirname(createRequire(import.meta.url).resolve('next/package.json')), 'dist/compiled/@vercel/og/Geist-Regular.ttf'));
    const covered = cmapOf(font), allowed: number[] = [];
    for (let c = 0x20; c < 0x2300; c++) if (!String.fromCodePoint(c).match(VISUAL_GLYPHS)) allowed.push(c);
    expect(allowed.filter(c => !covered.has(c)).map(c => c.toString(16))).toEqual([]);
    expect(glyphSafe('Swap 1 USDC → WETH ✓ 🚀 ação')).toBe('Swap 1 USDC → WETH ? ? ação');
    for (const { strategy } of STRATEGY_EXAMPLES) for (const language of ['EN', 'PT'] as const) {
      const layout = workflowVisualLayout(visualOf(strategy), language);
      for (const text of [...textsOf(layout.tree), layout.alt, layout.title, layout.summary]) expect(text.match(VISUAL_GLYPHS)).toBeNull();
    }
  });
});

/** The code points of a TrueType font's cmap (formats 4 and 12). */
function cmapOf(font: Buffer): Set<number> {
  const covered = new Set<number>(), tables = font.readUInt16BE(4);
  let cmap = 0;
  for (let i = 0; i < tables; i++) if (font.toString('ascii', 12 + i * 16, 16 + i * 16) === 'cmap') cmap = font.readUInt32BE(12 + i * 16 + 8);
  for (let i = 0, n = font.readUInt16BE(cmap + 2); i < n; i++) {
    const at = cmap + font.readUInt32BE(cmap + 4 + i * 8 + 4), format = font.readUInt16BE(at);
    if (format === 4) {
      const segments = font.readUInt16BE(at + 6) / 2, ends = at + 14, starts = ends + segments * 2 + 2;
      for (let s = 0; s < segments; s++) for (let c = font.readUInt16BE(starts + 2 * s); c <= font.readUInt16BE(ends + 2 * s) && c !== 0xffff; c++) covered.add(c);
    } else if (format === 12) {
      for (let g = 0, groups = font.readUInt32BE(at + 12); g < groups; g++) for (let c = font.readUInt32BE(at + 16 + g * 12); c <= font.readUInt32BE(at + 20 + g * 12); c++) covered.add(c);
    }
  }
  return covered;
}
