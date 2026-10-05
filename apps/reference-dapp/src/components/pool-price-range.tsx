// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { useWorkflow } from '../state/workflow-store';
import { useUniswapLiquidity } from '../state/uniswap-liquidity-store';
import { useSolanaLiquidity } from '../state/solana-liquidity-store';
import { uniswapBandInput, uniswapLiquidityDetails } from '../domain/uniswap-liquidity-authoring';
import { solanaLiquidityDetails } from '../domain/solana-liquidity-authoring';

export const poolPricePresets = {
  'Estável': { lower: -0.03, upper: 0.03, extent: 0.15 },
  'Amplo': { lower: -50, upper: 100, extent: 125 },
  'Unilateral inferior': { lower: -50, upper: 0, extent: 100 },
  'Unilateral superior': { lower: 0, upper: 100, extent: 125 },
} as const;
export type PoolPricePreset = keyof typeof poolPricePresets;
export function poolRangeOffsets(percent: number, preset: PoolPricePreset | null = null) {
  return preset ? poolPricePresets[preset] : { lower: -percent, upper: percent, extent: 100 };
}

export type RangeReference = { price: string; quoteToken?: string; sqrtPriceX96?: string };
type RangeEdit = { percent: number; preset: PoolPricePreset | null; extent: number; edited: boolean; reference: RangeReference | null; reviewedKey: string | null };
const initialRange: RangeEdit = { percent: 10, preset: null, extent: 100, edited: false, reference: null, reviewedKey: null };
type RangeContext = {
  entries: Record<string, RangeEdit>;
  reference(nodeId: string): RangeReference | null;
  refresh(nodeId: string): Promise<void>;
  edit(nodeId: string, percent: number, extent?: number): void;
  selectPreset(nodeId: string, preset: PoolPricePreset): void;
  reviewed(nodeId: string, key: string): void;
  reset(nodeId: string): void;
};
const Context = createContext<RangeContext | null>(null);
const validPrice = (price?: string) => Boolean(price && /^\d+(?:\.\d+)?$/.test(price) && /[1-9]/.test(price));

/** A shared UI editing buffer, never a second workflow or an executable range. */
export function PoolPriceRangeProvider({ children }: { children: ReactNode }) {
  const { state, pending, dismissProposal } = useWorkflow();
  const uniswap = useUniswapLiquidity(), solana = useSolanaLiquidity();
  const [entries, setEntries] = useState<Record<string, RangeEdit>>({});
  function protocol(nodeId: string) {
    const node = state.workflow.nodes.find(node => node.nodeId === nodeId);
    return node && uniswapLiquidityDetails(node) ? 'uniswap' : node && solanaLiquidityDetails(node) ? 'solana' : null;
  }
  function reference(nodeId: string): RangeReference | null {
    const price = protocol(nodeId) === 'uniswap' ? uniswap.price : protocol(nodeId) === 'solana' ? solana.price : null;
    return price && validPrice(price.price) ? { price: price.price, quoteToken: protocol(nodeId) === 'uniswap' ? 'USDC' : 'devUSDC', ...('sqrtPriceX96' in price ? { sqrtPriceX96: price.sqrtPriceX96 } : {}) } : null;
  }
  return <Context.Provider value={{ entries, reference,
    async refresh(nodeId) {
      if (reference(nodeId)) return;
      if (protocol(nodeId) === 'uniswap' && !uniswap.busy) await uniswap.fetchPrice();
      if (protocol(nodeId) === 'solana' && !solana.busy) await solana.fetchPrice();
    },
    edit(nodeId, percent, extent = 100) {
      if (!Number.isFinite(percent)) return;
      const value = Math.round(Math.min(90, Math.max(0.01, percent)) * 100) / 100;
      setEntries(current => { const entry = current[nodeId] ?? initialRange; return { ...current, [nodeId]: { percent: value, preset: null, extent, edited: true, reference: entry.reference ?? reference(nodeId), reviewedKey: null } }; });
      if (pending && 'nodeId' in pending.command && pending.command.nodeId === nodeId) dismissProposal();
    },
    selectPreset(nodeId, preset) {
      setEntries(current => { const entry = current[nodeId] ?? initialRange; return { ...current, [nodeId]: { ...entry, preset, extent: poolPricePresets[preset].extent,
        percent: preset === 'Estável' ? 0.03 : entry.percent, edited: true, reference: entry.reference ?? reference(nodeId), reviewedKey: null } }; });
      if (pending && 'nodeId' in pending.command && pending.command.nodeId === nodeId) dismissProposal();
    },
    reviewed(nodeId, key) { setEntries(current => ({ ...current, [nodeId]: { ...(current[nodeId] ?? initialRange), reviewedKey: key } })); },
    reset(nodeId) { if (pending && 'nodeId' in pending.command && pending.command.nodeId === nodeId) dismissProposal(); setEntries(current => ({ ...current, [nodeId]: { ...(current[nodeId] ?? initialRange), edited: false, reference: null, reviewedKey: null } })); },
  }}>{children}</Context.Provider>;
}

export function usePoolPriceRange(nodeId?: string) {
  const context = useContext(Context);
  const entry = nodeId ? context?.entries[nodeId] ?? initialRange : initialRange;
  const reference = entry.reference ?? (nodeId ? context?.reference(nodeId) ?? null : null);
  const key = JSON.stringify([entry.percent, entry.preset, reference]);
  return { ...entry, reference, reviewCurrent: entry.reviewedKey === key,
    edit: (percent: number, extent?: number) => { if (nodeId) context?.edit(nodeId, percent, extent); },
    selectPreset: (preset: PoolPricePreset) => { if (nodeId) context?.selectPreset(nodeId, preset); },
    markReviewed: () => { if (nodeId) context?.reviewed(nodeId, key); },
    reset: () => { if (nodeId) context?.reset(nodeId); },
    refresh: async () => { if (nodeId) await context?.refresh(nodeId); },
  };
}

/** Exact decimal percentage bounds; protocol alignment stays in the existing authoring validators. */
export function poolPriceBounds(reference: RangeReference | null, percent: number, preset: PoolPricePreset | null = null) {
  if (!reference || !validPrice(reference.price)) throw new Error('Reference price unavailable. Try again when a price is available.');
  const bps = Math.round(percent * 100);
  if (!Number.isFinite(percent) || bps < 1 || bps > 9000) throw new Error('Choose a range between 0.01% and 90%.');
  if (reference.sqrtPriceX96 && !preset) {
    const { rangeUnit, lower, upper } = uniswapBandInput(reference.sqrtPriceX96, bps);
    return { rangeUnit, lower, upper };
  }
  const [integer = '0', fraction = ''] = reference.price.split('.');
  const raw = BigInt(integer + fraction);
  function boundary(multiplier: number) {
    const digits = (raw * BigInt(multiplier)).toString().padStart(fraction.length + 5, '0');
    const decimals = fraction.length + 4;
    return `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`.replace(/0+$/, '').replace(/\.$/, '');
  }
  const offsets = poolRangeOffsets(percent, preset);
  return { rangeUnit: 'PRICE' as const, lower: boundary(10000 + Math.round(offsets.lower * 100)), upper: boundary(10000 + Math.round(offsets.upper * 100)) };
}

export function PoolPriceRange({ percent, preset = null, extent = 100, reference, onChange }: { percent: number; preset?: PoolPricePreset | null; extent?: number; reference: RangeReference | null; onChange(percent: number, extent?: number): void }) {
  const track = useRef<HTMLDivElement>(null);
  const offsets = poolRangeOffsets(percent, preset);
  const viewExtent = Math.max(extent, Math.abs(offsets.lower), offsets.upper);
  const label = (value: number) => `${value > 0 ? "+" : ""}${value}%`;
  function fromPointer(clientX: number) {
    const bounds = track.current?.getBoundingClientRect();
    if (bounds?.width) onChange(Math.abs((clientX - bounds.x) / bounds.width - 0.5) * viewExtent * 2, viewExtent);
  }
  return <div className="composer-price-range nodrag nopan" onClick={event => event.stopPropagation()}>
    <span className="composer-range-reference" title={reference ? 'Reference pool price' : 'Reference price unavailable'}>{reference ? Number(reference.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (reference.quoteToken ? ` ${reference.quoteToken}` : '') : '--'}</span>
    <div className="composer-price-track" ref={track}>
      <span className="composer-price-coverage" style={{ left: `${50 + offsets.lower / viewExtent * 50}%`, right: `${50 - offsets.upper / viewExtent * 50}%` }}/>
      <span className="composer-price-center" aria-label="Reference price"/>
      {(['Lower', 'Upper'] as const).map(side => <button key={side} type="button" role="slider" className="composer-price-handle"
        style={{ left: `${50 + (side === 'Lower' ? offsets.lower : offsets.upper) / viewExtent * 50}%` }} aria-label={`${side} price boundary`}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.abs(side === 'Lower' ? offsets.lower : offsets.upper)} aria-valuetext={label(side === 'Lower' ? offsets.lower : offsets.upper)}
        onPointerDown={event => { event.preventDefault(); event.stopPropagation(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) { event.stopPropagation(); fromPointer(event.clientX); } }}
        onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onKeyDown={event => { event.stopPropagation(); const sign = side === 'Lower' ? -1 : 1; const start = preset ? Math.abs(side === 'Lower' ? offsets.lower : offsets.upper) : percent; if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) { event.preventDefault(); onChange(event.key === 'Home' ? 0.01 : event.key === 'End' ? 90 : start + (event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : event.key === 'ArrowRight' ? sign : -sign) * (event.shiftKey ? 5 : 1), viewExtent); } }}>
        <span className={`composer-price-bound-label ${side.toLowerCase()}`}>{label(side === 'Lower' ? offsets.lower : offsets.upper)}</span>
      </button>)}
    </div>
  </div>;
}
