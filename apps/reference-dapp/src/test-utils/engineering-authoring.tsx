// SPDX-License-Identifier: AGPL-3.0-only
'use client';
import { useLocale } from '../i18n/locale';

import {LendingAuthoringForm} from '../components/lending-panel';
import { WithdrawAuthoringForm } from '../components/withdraw-panel';
import { RobinhoodTransferAuthoringForm } from '../components/robinhood-transfer-panel';
import { useState, type FormEvent, type ReactNode } from 'react';
import { inputSymbol, parseHumanAmount, parseSlippage, type Direction } from '../domain/swap-authoring';
import { createBaseSepoliaReviewContext } from '@defi-workflow-engine/reference-linter';
import { useWorkflow } from '../state/workflow-store';
import { useCow } from '../state/cow-store';
import { useLiquidity } from '../state/liquidity-store';
import { useComposition } from '../state/composition-store';
import { createCompositionWorkflow } from '../domain/composition-authoring';
import { createLiquidityNode, type LiquidityInput } from '../domain/liquidity-authoring';
import { createBridgeNode, type BridgeInput } from '../domain/bridge-authoring';
import { useBridge } from '../state/bridge-store';
import { createBridgeSwapWorkflow } from '../domain/bridge-swap-authoring';
import { createAcrossWorkflow } from '../domain/across-authoring';
import { createCrossChainLiquidityWorkflow, type CrossChainLiquidityInput } from '../domain/cross-chain-liquidity';

import { RepayAuthoringForm } from '../components/repay-panel';
import { BorrowAuthoringForm } from '../components/borrow-panel';
import { SupplyAuthoringForm } from '../components/supply-panel';
import { SolanaSwapForm } from '../components/jupiter-panel';
import { SolanaLiquidityForm } from '../components/solana-liquidity-panel';
import { UniswapLiquidityForm } from '../components/uniswap-liquidity-panel';
import { RouterForm } from '../components/router-panel';

export function EngineeringAuthoring({ selectedId, children }: { selectedId: string | null; children?: ReactNode }) {
  const { t: tr } = useLocale();
  const { state, context, propose } = useWorkflow();
  const cowEnabled = useCow().info?.enabled === true;
  const bridgeEnabled = useBridge().enabled;
  const [crossInput, setCrossInput] = useState<CrossChainLiquidityInput>({ amount: '100', bridgeSlippageBps: '50',
    swapSlippageBps: '50', tickLower: '-200100', tickUpper: '-199900',
    recipient: '0x1111111111111111111111111111111111111111', provider: 'lifi.rest', noSwap: false });
  const [crossError, setCrossError] = useState('');
  function submitCross(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { createCrossChainLiquidityWorkflow(state.workflow.workflowId, state.workflow.revision + 1, crossInput);
      setCrossError(''); propose({ type: 'AUTHOR_CROSS_CHAIN_LIQUIDITY', input: crossInput,
        source: 'CANVAS', baseRevision: state.workflow.revision }); }
    catch (cause) { setCrossError(cause instanceof Error ? cause.message : 'Invalid composition'); }
  }
  const [bridgeInput, setBridgeInput] = useState<BridgeInput>({ amount: '', slippageBps: '50' });
  const [bridgeError, setBridgeError] = useState('');
  const [swapBridgeSlippage, setSwapBridgeSlippage] = useState('50');
  const [acrossAmount, setAcrossAmount] = useState('');
  const [acrossError, setAcrossError] = useState('');
  function submitAcross(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { const input = { amount: acrossAmount, slippageBps: '50' };
      createAcrossWorkflow(state.workflow.workflowId, state.workflow.revision + 1, input); setAcrossError('');
      propose({ type: 'AUTHOR_ACROSS', input, source: 'CANVAS', baseRevision: state.workflow.revision });
    } catch (cause) { setAcrossError(cause instanceof Error ? cause.message : 'Enter a valid USDC amount'); }
  }
  function submitBridgeSwap() {
    try { const input = { ...bridgeInput, swapSlippageBps: swapBridgeSlippage };
      createBridgeSwapWorkflow(state.workflow.workflowId, state.workflow.revision + 1, input); setBridgeError('');
      propose({ type: 'AUTHOR_BRIDGE_SWAP', input, source: 'CANVAS', baseRevision: state.workflow.revision });
    } catch (cause) { setBridgeError(cause instanceof Error ? cause.message : 'BRIDGE_SWAP_INPUT_INVALID'); }
  }
  const selectedBridge = selectedId ? state.workflow.nodes.find(node => node.nodeId === selectedId && node.actionType === 'asset.bridge') : null;
  function submitBridge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { createBridgeNode(selectedBridge?.nodeId ?? 'node-preview', bridgeInput); setBridgeError('');
      propose(selectedBridge ? { type: 'SET_BRIDGE', nodeId: selectedBridge.nodeId, input: bridgeInput, source: 'CANVAS', baseRevision: state.workflow.revision }
        : { type: 'ADD_BRIDGE', input: bridgeInput, source: 'CANVAS', baseRevision: state.workflow.revision });
    } catch (cause) { setBridgeError(cause instanceof Error ? cause.message : 'BRIDGE_INPUT_INVALID'); }
  }
  const composition = useComposition();
  const compositionEnabled = composition.info?.available === true;
  const liquidityEnabled = useLiquidity().info?.available === true || compositionEnabled;
  const [direction, setDirection] = useState<Direction>('USDC_TO_WETH');
  const [swapNetwork, setSwapNetwork] = useState<'BASE' | 'BASE_SEPOLIA' | 'SOLANA' | 'SOLANA_DEVNET'>('BASE');
  const [liquidityNetwork, setLiquidityNetwork] = useState<'SOLANA_DEVNET' | 'BASE_SEPOLIA' | 'BASE'>('SOLANA_DEVNET');
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState('');
  const [allowCow, setAllowCow] = useState(false);
  const [error, setError] = useState('');
  const [liquidity, setLiquidity] = useState<LiquidityInput>({ weth: '', usdc: '', minimumWeth: '', minimumUsdc: '', tickLower: '', tickUpper: '', recipient: '' });
  const [liquidityError, setLiquidityError] = useState('');
  const selectedLiquidity = selectedId ? state.workflow.nodes.find(node => node.nodeId === selectedId && node.actionType === 'asset.liquidity.uniswap-v3') : null;
  function submitLiquidity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      createLiquidityNode(selectedLiquidity?.nodeId ?? 'node-preview', liquidity, context);
      setLiquidityError('');
      propose(selectedLiquidity ? { type: 'SET_LIQUIDITY', nodeId: selectedLiquidity.nodeId, input: liquidity, source: 'CANVAS', baseRevision: state.workflow.revision }
        : { type: 'ADD_LIQUIDITY', input: liquidity, source: 'CANVAS', baseRevision: state.workflow.revision });
    } catch (cause) { setLiquidityError(cause instanceof Error ? cause.message : 'Invalid liquidity input'); }
  }
  function submitComposition() {
    try {
      if (!compositionEnabled || !composition.info?.safe || direction !== 'USDC_TO_WETH' || allowCow) throw new Error('COMPOSITION_MODE_B_PROFILE_REQUIRED');
      const safe = composition.info.safe.toLowerCase();
      if (liquidity.recipient.toLowerCase() !== safe) throw new Error('COMPOSITION_SAFE_RECIPIENT_REQUIRED');
      const input = { swapUSDC: amount, slippageBps: slippage, mint: { ...liquidity, recipient: safe } };
      createCompositionWorkflow(state.workflow.workflowId, state.workflow.revision + 1, safe, input, context);
      setLiquidityError('');
      propose({ type: 'AUTHOR_COMPOSITION', safe, input, source: 'CANVAS', baseRevision: state.workflow.revision });
    } catch (cause) { setLiquidityError(cause instanceof Error ? cause.message : 'Invalid composition input'); }
  }
  function setLiquidityField(key: keyof LiquidityInput, value: string) { setLiquidity(current => ({ ...current, [key]: value })); }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      parseHumanAmount(amount, inputSymbol(direction), swapNetwork === 'BASE_SEPOLIA' ? createBaseSepoliaReviewContext() : context);
      parseSlippage(slippage);
      setError('');
      propose({ type: swapNetwork === 'BASE_SEPOLIA' ? 'ADD_TESTNET_SWAP' : cowEnabled && allowCow ? 'ADD_COW_SWAP' : 'ADD_SWAP',
        direction, amount, slippage, source: 'CANVAS', baseRevision: state.workflow.revision });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid swap input'); }
  }
  const networkSelect = <select id="swap-network" value={swapNetwork} onChange={event => setSwapNetwork(event.target.value as 'BASE' | 'BASE_SEPOLIA' | 'SOLANA' | 'SOLANA_DEVNET')}>
    <option value="BASE_SEPOLIA">{tr("Base Sepolia")}</option><option value="BASE">{tr("Base")}</option><option value="SOLANA">{tr("Solana")}</option><option value="SOLANA_DEVNET">{tr("Solana Devnet")}</option>
  </select>;
  return <details className="library panel" aria-label={tr("Advanced action setup")}><summary>{tr("Advanced action setup")}</summary><div className="library-content">
    {children}
    <details><summary>{tr("Compatibility template · Supply → Borrow → Swap")}</summary><LendingAuthoringForm key={state.workflow.revision}/></details><RobinhoodTransferAuthoringForm/><WithdrawAuthoringForm/><RepayAuthoringForm/><BorrowAuthoringForm/><SupplyAuthoringForm/>
    <p className="muted">{tr("Configure provider-specific and composed actions.")}</p>
    <form className="swap-create across-create" onSubmit={submitAcross} aria-label={tr("Create direct Across bridge proposal")}>
      <strong>{tr("Bridge · Base → Arbitrum via Across")}</strong>
      <p className="muted">{tr("Direct Across quote. Deposit, fill and refund are simulated.")}</p>
      <label htmlFor="across-amount">{tr("Across amount (USDC)")}</label>
      <input id="across-amount" type="text" inputMode="decimal" autoComplete="off" value={acrossAmount}
        onChange={event => setAcrossAmount(event.target.value)} />
      {acrossError && <p role="alert">{tr(acrossError)}</p>}
      <button type="submit">{tr("Review direct Across bridge")}</button>
    </form>
    {bridgeEnabled && <form className="swap-create bridge-create" onSubmit={submitBridge} aria-label={tr("Create Base to Optimism bridge proposal")}>
      <strong>{tr("Bridge · Base → Optimism")}</strong>
      <p className="muted">{tr("USDC to USDC. Recipient is your connected address. Live LI.FI route, MOCKED execution.")}</p>
      <label htmlFor="bridge-amount">{tr("USDC amount")}</label>
      <input id="bridge-amount" type="text" inputMode="decimal" autoComplete="off" maxLength={40} value={bridgeInput.amount}
        onChange={e => setBridgeInput(value => ({ ...value, amount: e.target.value }))} aria-invalid={Boolean(bridgeError)} aria-describedby={bridgeError ? 'bridge-create-error' : undefined}/>
      <label htmlFor="bridge-slippage">{tr("Maximum slippage (bps)")}</label>
      <input id="bridge-slippage" type="text" inputMode="numeric" autoComplete="off" maxLength={5} value={bridgeInput.slippageBps}
        onChange={e => setBridgeInput(value => ({ ...value, slippageBps: e.target.value }))} aria-invalid={Boolean(bridgeError)} aria-describedby={bridgeError ? 'bridge-create-error' : undefined}/>
      {bridgeError && <p id="bridge-create-error" role="alert">{tr(bridgeError)}{tr(". Use 1–300 bps and up to 1,000,000 USDC.")}</p>}
      <button type="submit">{tr(selectedBridge ? 'Review bridge edit' : 'Review bridge proposal')}</button>
    </form>}
    <details className="swap-create router-create" aria-label={tr("Create testnet cross-chain bridge proposal")}>
      <summary>{tr("Cross-chain bridge · Base Sepolia → Arbitrum Sepolia (testnet, any wallet)")}</summary>
      <RouterForm network="testnet"/>
    </details>
    <details className="swap-create router-create" aria-label={tr("Create cross-chain bridge proposal")}>
      <summary>{tr("Cross-chain bridge · Base → Arbitrum (Router)")}</summary>
      <RouterForm/>
    </details>
    <details className="swap-create build009-create" aria-label={tr("Create Base to Arbitrum bridge swap proposal")}>
      <summary>{tr("Base → Arbitrum → WETH")}</summary>
      <p className="muted">{tr("Live read-only LI.FI quotes. Financial execution and reconciliation are MOCKED.")}</p>
      <label htmlFor="build009-amount">{tr("Source amount (USDC)")}</label>
      <input id="build009-amount" type="text" inputMode="decimal" maxLength={40} value={bridgeInput.amount} onChange={event => setBridgeInput(value => ({ ...value, amount: event.target.value }))}/>
      <label htmlFor="build009-bridge-slip">{tr("Bridge slippage (bps)")}</label>
      <input id="build009-bridge-slip" type="text" inputMode="numeric" maxLength={5} value={bridgeInput.slippageBps} onChange={event => setBridgeInput(value => ({ ...value, slippageBps: event.target.value }))}/>
      <label htmlFor="build009-swap-slip">{tr("Arbitrum swap slippage (bps)")}</label>
      <input id="build009-swap-slip" type="text" inputMode="numeric" maxLength={5} value={swapBridgeSlippage} onChange={event => setSwapBridgeSlippage(event.target.value)}/>
      <button type="button" onClick={submitBridgeSwap}>{tr("Review Base → Arbitrum bridge → WETH swap")}</button>
      {bridgeError && <p role="alert">{tr(bridgeError)}</p>}
    </details>
    <details className="cross-liquidity-create" aria-label={tr("Create cross-chain liquidity proposal")}><summary>{tr("Base → Arbitrum → Uniswap v3 position")}</summary>
      <form className="swap-create" onSubmit={submitCross} aria-label={tr("Compose cross-chain liquidity")}>
        <p className="muted">{tr("One semantic bridge, calculated destination split and existing Uniswap v3 position. MOCKED financial rehearsal.")}</p>
        <label>{tr("Composition source quantity (USDC)")}<input value={crossInput.amount} onChange={e => setCrossInput(v => ({ ...v, amount: e.target.value }))} inputMode="decimal" /></label>
        <label>{tr("Composition bridge provider")}<select value={crossInput.provider} onChange={e => setCrossInput(v => ({ ...v, provider: e.target.value as CrossChainLiquidityInput['provider'] }))}><option value="lifi.rest">{tr("LI.FI")}</option><option value="across.direct">{tr("Across direct")}</option></select></label>
        <label>{tr("Cross-chain bridge tolerance (bps)")}<input value={crossInput.bridgeSlippageBps} onChange={e => setCrossInput(v => ({ ...v, bridgeSlippageBps: e.target.value }))} inputMode="numeric" /></label>
        <label>{tr("Composition swap slippage (bps)")}<input value={crossInput.swapSlippageBps} onChange={e => setCrossInput(v => ({ ...v, swapSlippageBps: e.target.value }))} inputMode="numeric" /></label>
        <label>{tr("Composition lower tick")}<input value={crossInput.tickLower} onChange={e => setCrossInput(v => ({ ...v, tickLower: e.target.value }))} inputMode="numeric" /></label>
        <label>{tr("Composition upper tick")}<input value={crossInput.tickUpper} onChange={e => setCrossInput(v => ({ ...v, tickUpper: e.target.value }))} inputMode="numeric" /></label>
        <label>{tr("Composition LP recipient")}<input value={crossInput.recipient} onChange={e => setCrossInput(v => ({ ...v, recipient: e.target.value.toLowerCase() }))} autoComplete="off" /></label>
        <label><input type="checkbox" checked={crossInput.noSwap} onChange={e => setCrossInput(v => ({ ...v, noSwap: e.target.checked }))} />{tr(" No swap (USDC-only range)")}</label>
        <button type="submit">{tr("Review cross-chain composition")}</button>
        {crossError && <p role="alert">{tr(crossError)}</p>}
      </form>
    </details>
    {swapNetwork === 'SOLANA' || swapNetwork === 'SOLANA_DEVNET' ? <div className="swap-create" role="group" aria-label={tr("Create swap proposal")}>
      <strong>{tr("Swap")}</strong>
      <label htmlFor="swap-network">{tr("Network")}</label>
      {tr(networkSelect)}
      <SolanaSwapForm key={swapNetwork} network={swapNetwork === 'SOLANA' ? 'Solana' : 'Solana Devnet'}/>
      <small>{tr(swapNetwork === 'SOLANA' ? 'Solana mainnet via Jupiter. Simulate for a live quote; execution needs your wallet signature.'
        : 'Solana Devnet via Orca Whirlpools with valueless test tokens. Simulate for a live Devnet quote; execution needs your wallet signature.')}</small>
    </div> : <form className="swap-create" onSubmit={submit} aria-label={tr("Create swap proposal")}>
      <strong>{tr("Swap")}</strong>
      <label htmlFor="swap-network">{tr("Network")}</label>
      {tr(networkSelect)}
      <label htmlFor="swap-direction">{tr("Direction")}</label>
      <select id="swap-direction" value={direction} onChange={event => setDirection(event.target.value as Direction)}>
        <option value="USDC_TO_WETH">{tr("USDC → WETH")}</option><option value="WETH_TO_USDC">{tr("WETH → USDC")}</option>
      </select>
      <label htmlFor="swap-amount">{tr("Input amount (required)")}</label>
      <input id="swap-amount" type="text" inputMode="decimal" autoComplete="off" spellCheck={false} maxLength={80} value={amount} onChange={event => setAmount(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? 'swap-create-error' : undefined}/>
      <label htmlFor="swap-slippage">{tr("Slippage in bps (required)")}</label>
      <input id="swap-slippage" type="text" inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={5} value={slippage} onChange={event => setSlippage(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? 'swap-create-error' : undefined}/>
      {cowEnabled && swapNetwork === 'BASE' && <label className="cow-authoring-choice"><input type="checkbox" checked={allowCow} onChange={event => setAllowCow(event.target.checked)}/>{tr(" Enable CoW signed intent for this swap")}</label>}
      {error && <p id="swap-create-error" role="alert">{tr(error)}{tr(". Check the amount, asset cap and slippage.")}</p>}
      <button type="submit">{tr("Review swap proposal")}</button>
      <small>{tr(swapNetwork === 'BASE_SEPOLIA' ? 'Use test USDC and WETH only. Simulate for a live quote before review.' : 'Base swaps use the existing local review path.')}</small>
    </form>}
    <div className="swap-create" role="group" aria-label={tr("Create liquidity position proposal")}>
      <strong>{tr("Liquidity position")}</strong>
      <label htmlFor="liquidity-network">{tr("Network")}</label>
      <select id="liquidity-network" value={liquidityNetwork} onChange={event => setLiquidityNetwork(event.target.value as 'SOLANA_DEVNET' | 'BASE_SEPOLIA' | 'BASE')}>
        <option value="SOLANA_DEVNET">{tr("Solana Devnet")}</option><option value="BASE_SEPOLIA">{tr("Base Sepolia")}</option>{liquidityEnabled && <option value="BASE">{tr("Base (local fork)")}</option>}
      </select>
      {liquidityNetwork === 'SOLANA_DEVNET' ? <SolanaLiquidityForm/> : liquidityNetwork === 'BASE_SEPOLIA' ? <UniswapLiquidityForm/> : <small>{tr("Use the Base Uniswap v3 position form below.")}</small>}
    </div>
    {liquidityEnabled && <form className="swap-create liquidity-create" onSubmit={submitLiquidity} aria-label={tr("Create or edit Base liquidity proposal")}>
      <strong>{tr("Uniswap v3 position · Base")}</strong>
      <p className="muted">{tr("One isolated WETH/USDC position, fee tier 500. Wallet operations are reviewed separately on the local fork.")}</p>
      <label htmlFor="liquidity-weth">{tr("Maximum WETH")}</label>
      <input id="liquidity-weth" type="text" inputMode="decimal" autoComplete="off" maxLength={80} value={liquidity.weth} onChange={e => setLiquidityField('weth', e.target.value)}/>
      <label htmlFor="liquidity-usdc">{tr("Maximum USDC")}</label>
      <input id="liquidity-usdc" type="text" inputMode="decimal" autoComplete="off" maxLength={80} value={liquidity.usdc} onChange={e => setLiquidityField('usdc', e.target.value)}/>
      <label htmlFor="liquidity-min-weth">{tr("Minimum WETH received or deposited")}</label>
      <input id="liquidity-min-weth" type="text" inputMode="decimal" autoComplete="off" maxLength={80} value={liquidity.minimumWeth} onChange={e => setLiquidityField('minimumWeth', e.target.value)}/>
      <label htmlFor="liquidity-min-usdc">{tr("Minimum USDC received or deposited")}</label>
      <input id="liquidity-min-usdc" type="text" inputMode="decimal" autoComplete="off" maxLength={80} value={liquidity.minimumUsdc} onChange={e => setLiquidityField('minimumUsdc', e.target.value)}/>
      <label htmlFor="liquidity-lower">{tr("Lower tick")}</label>
      <input id="liquidity-lower" type="text" inputMode="numeric" autoComplete="off" maxLength={8} value={liquidity.tickLower} onChange={e => setLiquidityField('tickLower', e.target.value)}/>
      <label htmlFor="liquidity-upper">{tr("Upper tick")}</label>
      <input id="liquidity-upper" type="text" inputMode="numeric" autoComplete="off" maxLength={8} value={liquidity.tickUpper} onChange={e => setLiquidityField('tickUpper', e.target.value)}/>
      <label htmlFor="liquidity-recipient">{tr("Position NFT recipient")}</label>
      <input id="liquidity-recipient" type="text" autoComplete="off" spellCheck={false} maxLength={42} value={liquidity.recipient} onChange={e => setLiquidityField('recipient', e.target.value)}/>
      {liquidityError && <p role="alert">{tr(liquidityError)}</p>}
      <button type="submit">{tr(selectedLiquidity ? 'Review position edit' : 'Review position proposal')}</button>
      {compositionEnabled && <button type="button" onClick={submitComposition}>{tr("Review swap → position composition")}</button>}
      <small>{tr("Pool identity, current tick and price are checked before simulation. Editing here invalidates prior liquidity artifacts.")}</small>
    </form>}
  </div></details>;
}
