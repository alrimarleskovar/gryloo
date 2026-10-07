// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useId } from 'react';
import { STOCK_EQUITIES, useStockCardInputs, type StockCardInput, type StockEquity } from './canvas-card-inputs';
import { TokenAmountInput } from './token-amount-input';

export function StocksSettings({ card, expanded, onExpandedChange }: { card: StockCardInput; expanded: boolean; onExpandedChange(expanded: boolean): void }) {
  const stocks = useStockCardInputs();
  const contentId = useId();
  return <section className="inspector panel inspector-disclosure" aria-label="Action inspector">
    <button type="button" className="inspector-toggle" aria-expanded={expanded} aria-controls={contentId} onClick={() => onExpandedChange(!expanded)}>
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" style={{ transform: expanded ? 'rotate(90deg)' : undefined }}><path d="m6 3 5 5-5 5"/></svg><span>Advanced Settings</span>
    </button>
    <div id={contentId} className="inspector-body" hidden={!expanded}>
      <h2>Stocks settings</h2>
      <p className="composer-editor-context">Stocks · Robinhood · {stocks.network}</p>
      <StocksConfiguration amount={card.amount} equity={card.equity} onAmountChange={amount => stocks.edit(card.id, { amount })} onEquityChange={equity => stocks.edit(card.id, { equity })}/>
    </div>
  </section>;
}

export function StocksConfiguration({ amount, equity, onAmountChange, onEquityChange }: {
  amount: string; equity: StockEquity; onAmountChange(amount: string): void; onEquityChange(equity: StockEquity): void;
}) {
  return <div className="inspector-fields">
    <label>Equity<select aria-label="Equity" value={equity} onChange={event => onEquityChange(event.target.value as StockEquity)}>
      {STOCK_EQUITIES.map(symbol => <option key={symbol} value={symbol}>{symbol}</option>)}
    </select></label>
    <label>Amount<TokenAmountInput aria-label="Stocks amount" value={amount} maxLength={80} onValueChange={onAmountChange}/></label>
  </div>;
}
