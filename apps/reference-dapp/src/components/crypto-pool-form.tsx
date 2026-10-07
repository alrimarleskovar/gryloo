// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useState, type FormEvent } from 'react';
import { cryptoInputOf, cryptoProfile } from '../domain/crypto-action-picker';
import { useUniswapLiquidity } from '../state/uniswap-liquidity-store';
import { uniswapBandInput, uniswapLiquidityProfileFor } from '../domain/uniswap-liquidity-authoring';
import { useWorkflow } from '../state/workflow-store';
import { useBuild009Wallet } from '../state/build009-wallet-store';
import { TokenAmountInput } from './token-amount-input';
import { usePoolContributionInputs } from './canvas-card-inputs';
import { poolReviewFormId } from './composer-card';
import { usePoolPriceRange, poolPriceBounds } from './pool-price-range';

/** Picker drafts use the existing pool builders and range validators at Review. */
export function CryptoPoolForm({ nodeId }: { nodeId: string }) {
  const { state, actionSetup, cryptoSelections, editPoolSetup, reviewCryptoPool, dismissProposal } = useWorkflow();
  const liquidity = useUniswapLiquidity();
  const wallet = useBuild009Wallet(), contributions = usePoolContributionInputs(nodeId), range = usePoolPriceRange(nodeId);
  const setup = actionSetup?.id === nodeId && actionSetup.action === 'pool' ? actionSetup : null;
  const node = state.workflow.nodes.find(node => node.nodeId === nodeId), existing = node ? cryptoInputOf(node) : null;
  const selection = setup?.cryptoSelection ?? cryptoSelections[nodeId] ?? existing?.selection;
  const [fields, setFields] = useState({ rangeUnit: existing?.rangeUnit ?? 'TICK', lower: existing && existing.selection.network === selection?.network ? existing.lower ?? '-887270' : selection?.network === 'Solana Devnet' ? '-443584' : selection?.network === 'Ethereum Sepolia' ? '-887220' : '-887270', upper: existing && existing.selection.network === selection?.network ? existing.upper ?? '887270' : selection?.network === 'Solana Devnet' ? '443584' : selection?.network === 'Ethereum Sepolia' ? '887220' : '887270', slippage: existing?.slippage ?? '50' });
  const [error, setError] = useState('');
  if (!selection || selection.action !== 'pool' || !contributions.values) return null;
  const input = setup?.input ?? fields;
  const set = (patch: Partial<typeof fields>) => {
    dismissProposal(); range.reset();
    if (setup) editPoolSetup(nodeId, { ...setup.input, ...patch }); else setFields(current => ({ ...current, ...patch }));
  };
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!selection) return;
    try {
      const bounds = range.edited ? poolPriceBounds(range.reference, range.percent, range.preset) : input;
      const failure = reviewCryptoPool(nodeId, { selection, amount: contributions.values![0]!.amount, secondAmount: contributions.values![1]!.amount,
        rangeUnit: bounds.rangeUnit, lower: bounds.lower, upper: bounds.upper, slippage: input.slippage,
        ...(setup?.cryptoBeneficiary ?? existing?.beneficiary ?? wallet.account ? { beneficiary: setup?.cryptoBeneficiary ?? existing?.beneficiary ?? wallet.account! } : {}) });
      if (failure) throw new Error(failure);
      if (range.edited) range.markReviewed();
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid pool settings'); }
  }
  async function aroundCurrent() {
    if (selection?.network !== 'Base Sepolia' && selection?.network !== 'Ethereum Sepolia') return;
    const price = await liquidity.fetchPrice(uniswapLiquidityProfileFor(selection.network).chain);
    if (price) { const bounds = uniswapBandInput(price.sqrtPriceX96, 1_000, selection.network); set({ rangeUnit: bounds.rangeUnit, lower: bounds.lower, upper: bounds.upper }); }
  }
  const profile = cryptoProfile(selection)!;
  const symbols = [selection.from, selection.to!];
  return <form id={poolReviewFormId(nodeId)} className="inspector-fields" aria-label={`Edit ${selection.network} liquidity position`} onSubmit={submit}>
    <p className="muted">{profile.provider} · {selection.network} · {symbols.join(' / ')}</p>
    {symbols.map((symbol, index) => <label key={symbol}>Maximum {symbol}<TokenAmountInput aria-label={`Maximum ${symbol}`} maxLength={40} value={contributions.values![index]!.amount} onValueChange={amount => contributions.edit(index, amount)}/></label>)}
    <label>Range unit<select aria-label="Range unit" value={input.rangeUnit} onChange={event => set({ rangeUnit: event.target.value as 'PRICE' | 'TICK' })}>
      <option value="TICK">Tick</option>{selection.network !== 'Base' && <option value="PRICE">Price</option>}
    </select></label>
    <label>Lower bound<input aria-label="Lower bound" value={input.lower} onChange={event => set({ lower: event.target.value })}/></label>
    <label>Upper bound<input aria-label="Upper bound" value={input.upper} onChange={event => set({ upper: event.target.value })}/></label>
    {selection.network === 'Base Sepolia' || selection.network === 'Ethereum Sepolia' ? <button type="button" className="quiet" disabled={liquidity.busy || !liquidity.available} onClick={() => void aroundCurrent()}>Use ±10% around the current {selection.network} price</button> : <button type="button" className="quiet" onClick={() => void range.refresh()}>Refresh current pool price</button>}
    {selection.network !== 'Base' && <label>Slippage (bps)<input aria-label="Liquidity slippage (bps)" inputMode="numeric" value={input.slippage} onChange={event => set({ slippage: event.target.value })}/></label>}
    {error && <p role="alert">{error}</p>}
  </form>;
}
