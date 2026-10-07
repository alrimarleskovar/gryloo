// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { useWorkflow } from '../state/workflow-store';
import { walletEnvironmentLabel } from '../wallet/environment';
import { useExecutionEnvironment } from '../state/capability-store';
import { composerSummary } from '../domain/composer-presentation';

export const STOCK_EQUITIES = ['AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN'] as const;
export type StockEquity = typeof STOCK_EQUITIES[number];
export type StockCardInput = { id: string; amount: string; equity: StockEquity; position: { x: number; y: number } };
type StockInputs = {
  cards: StockCardInput[]; network: string;
  add(position: StockCardInput['position']): string;
  edit(id: string, patch: Partial<Pick<StockCardInput, 'amount' | 'equity' | 'position'>>): void;
  remove(ids: readonly string[]): void;
};
const StocksContext = createContext<StockInputs | null>(null);
type Contributions = NonNullable<ReturnType<typeof composerSummary>['liquidityValues']>;
type ContributionInputs = { read(nodeId: string): Contributions | null; edit(nodeId: string, index: number, amount: string): void };
const ContributionsContext = createContext<ContributionInputs | null>(null);

/** Canvas editing state only. Stocks never enters canonical commands or financial providers. */
export function CanvasCardInputsProvider({ children }: { children: ReactNode }) {
  const { state, context, pending, dismissProposal, actionSetup, editPoolSetup, cryptoSelections, editCanvasAmount } = useWorkflow();
  const { walletEnvironment } = useExecutionEnvironment();
  const [cards, setCards] = useState<StockCardInput[]>([]);
  const serial = useRef(0);
  const [amounts, setAmounts] = useState<Record<string, { revision: number; values: Contributions }>>({});
  function read(nodeId: string) {
    if (actionSetup?.id === nodeId && actionSetup.action === 'pool') return [
      { amount: actionSetup.input.maxUsdc, token: actionSetup.cryptoSelection?.from ?? 'USDC' }, { amount: actionSetup.input.maxWeth, token: actionSetup.cryptoSelection?.to ?? 'WETH' }];
    const node = state.workflow.nodes.find(node => node.nodeId === nodeId);
    if (!node) return null;
    const entry = amounts[nodeId];
    const values = entry?.revision === state.workflow.revision ? entry.values : composerSummary(state.workflow, node, context).liquidityValues ?? null;
    const selection = cryptoSelections[nodeId];
    return values && selection ? values.map((value, index) => ({ ...value, token: index ? selection.to! : selection.from })) : values;
  }
  return <StocksContext.Provider value={{ cards, network: walletEnvironmentLabel(walletEnvironment),
    add(position) {
      const id = `stocks-card-${++serial.current}`;
      setCards(current => [...current, { id, amount: '0', equity: 'AAPL', position }]);
      return id;
    },
    edit(id, patch) { setCards(current => current.map(card => card.id === id ? { ...card, ...patch } : card)); },
    remove(ids) { setCards(current => current.filter(card => !ids.includes(card.id))); },
  }}><ContributionsContext.Provider value={{ read,
    edit(nodeId, index, amount) {
      const values = read(nodeId);
      if (!values?.[index]) return;
      if (actionSetup?.id === nodeId && actionSetup.action === 'pool') {
        editPoolSetup(nodeId, { ...actionSetup.input, [index === 0 ? 'maxUsdc' : 'maxWeth']: amount });
        return;
      }
      if (cryptoSelections[nodeId] && index === 0) editCanvasAmount(nodeId, amount);
      setAmounts(current => ({ ...current, [nodeId]: { revision: state.workflow.revision,
        values: values.map((value, slot) => slot === index ? { ...value, amount } : value) } }));
      if (pending && 'nodeId' in pending.command && pending.command.nodeId === nodeId) dismissProposal();
    },
  }}>{children}</ContributionsContext.Provider></StocksContext.Provider>;
}

const emptyStocks: StockInputs = { cards: [], network: 'Testnet', add: () => '', edit: () => {}, remove: () => {} };
export function useStockCardInputs() { return useContext(StocksContext) ?? emptyStocks; }
export function usePoolContributionInputs(nodeId?: string) {
  const context = useContext(ContributionsContext);
  return { values: nodeId ? context?.read(nodeId) ?? null : null,
    edit(index: number, amount: string) { if (nodeId) context?.edit(nodeId, index, amount); } };
}
