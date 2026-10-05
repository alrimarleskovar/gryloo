// SPDX-License-Identifier: AGPL-3.0-only
import type { CapabilityBlockerCode } from '@defi-workflow-engine/action-registry';
import type { ReviewContext } from '@defi-workflow-engine/reference-linter';
import type { Workflow } from './initial-workflow';
import { ROUTER_NETWORK_OPTIONS, ROUTER_ROUTING_LABEL } from './router-authoring';
import { workflowSteps, type WorkflowStep } from './workflow-steps';
import { copilotCopy, type CopilotLanguage } from './copilot-messages';
import type { CopilotQuestionTopic } from './copilot-intent-v2';

/**
 * BUILD-COPILOT-002: read-only answers written by Flofi, never by the model. The model only classifies the question;
 * every fact here comes from `CopilotFacts`, a projection of state Flofi already holds in the browser (canonical IR,
 * pending proposal, lint review, capability blockers, the active flow's own simulation/review record). Prices, APY,
 * balances, gas, ETAs, health factors and chain state are not in that state, so they are never stated.
 */
export type SimulationFlow = 'SUPPLY' | 'LENDING' | 'ROUTER' | 'SOLANA_SWAP' | 'ORCA' | 'UNISWAP' | 'PUBLIC_TESTNET' | 'TRANSFER' | 'MOCKED_CHAIN';
export type CopilotFacts = {
  readonly revision: number;
  readonly steps: readonly WorkflowStep[];
  readonly pending: { readonly commandType: string; readonly baseRevision: number; readonly diff: readonly string[] } | null;
  readonly findings: readonly { readonly severity: 'WARNING' | 'BLOCK'; readonly code: string; readonly nodeId: string; readonly message: string }[];
  readonly reviewError: string | null;
  readonly capability: { readonly environment: string; readonly executionSupported: boolean; readonly executionReady: boolean; readonly evidenceCeiling: string | null;
    readonly blockers: readonly { readonly nodeId: string; readonly code: CapabilityBlockerCode | string }[] } | null;
  /** The active flow's own record: whether a simulation/review exists for the current revision. Contents are not narrated. */
  readonly simulation: { readonly flow: SimulationFlow; readonly status: 'CURRENT' | 'STALE' | 'NONE'; readonly reviewed: boolean };
  readonly walletConnected: boolean;
};
export type CopilotFactsInput = {
  readonly workflow: Workflow; readonly context: ReviewContext;
  readonly pending: { readonly command: { readonly type: string; readonly baseRevision: number }; readonly diff: readonly string[] } | null;
  readonly findings?: CopilotFacts['findings']; readonly reviewError?: string | null; readonly capability?: CopilotFacts['capability'];
  readonly simulation?: Partial<CopilotFacts['simulation']> & { readonly flow?: SimulationFlow }; readonly walletConnected?: boolean;
};
/** The flow whose panel owns Simulate/Review for this workflow, chosen like the app shell chooses its panel. */
export function simulationFlowOf(steps: readonly WorkflowStep[]): SimulationFlow {
  const types = new Set(steps.map(step => step.detail.type));
  if (types.has('LENDING_COMPOSITION')) return 'LENDING';
  if (types.has('ROUTER')) return 'ROUTER';
  if (types.has('AAVE') || types.has('AAVE_WITHDRAW')) return 'SUPPLY';
  if (types.has('UNISWAP_LIQUIDITY')) return 'UNISWAP';
  if (types.has('ORCA_LIQUIDITY')) return 'ORCA';
  if (types.has('SOLANA_SWAP')) return 'SOLANA_SWAP';
  if (steps.some(step => step.detail.type === 'EVM_SWAP' && step.detail.network === 'Base Sepolia')) return 'PUBLIC_TESTNET';
  if (steps.some(step => step.detail.type === 'OTHER' && step.detail.actionType === 'asset.transfer')) return 'TRANSFER';
  return 'MOCKED_CHAIN';
}
export function buildCopilotFacts(input: CopilotFactsInput): CopilotFacts {
  const steps = workflowSteps(input.workflow, input.context);
  return { revision: input.workflow.revision, steps,
    pending: input.pending ? { commandType: input.pending.command.type, baseRevision: input.pending.command.baseRevision, diff: [...input.pending.diff] } : null,
    findings: input.findings ?? [], reviewError: input.reviewError ?? null, capability: input.capability ?? null,
    simulation: { flow: input.simulation?.flow ?? simulationFlowOf(steps), status: input.simulation?.status ?? 'NONE', reviewed: input.simulation?.reviewed ?? false },
    walletConnected: input.walletConnected ?? false };
}

const recipientOf = (value: string, pt: boolean) => value === '' || value === 'CONNECTED_OWNER' ? (pt ? 'sua carteira conectada' : 'your connected wallet') : value;
/** One short line per step, used in lists and in the step buttons of a clarification. */
export function stepSummary(step: WorkflowStep, language: CopilotLanguage): string {
  const pt = language === 'PT', d = step.detail;
  switch (d.type) {
    case 'EVM_SWAP': return `Swap ${d.amount} ${d.from} → ${d.to} · ${d.network}`;
    case 'SOLANA_SWAP': return `Swap ${d.input.amount} ${d.input.from} → ${d.input.to} · ${d.input.network} (${step.protocol})`;
    case 'ROUTER': return `Bridge ${d.input.amount} USDC · ${step.network}`;
    case 'AAVE': return `${d.operation === 'SUPPLY' ? 'Supply' : d.operation === 'BORROW' ? 'Borrow' : 'Repay'} ${d.input.amount} USDC · Aave V3 · ${d.input.network}`;
    case 'AAVE_WITHDRAW': return `Withdraw ${d.input.amount} USDC · Aave V3 · ${d.input.network}`;
    case 'UNISWAP_LIQUIDITY': return `${pt ? 'Liquidez' : 'Liquidity'} ≤ ${d.input.maxUsdc} USDC + ${d.input.maxWeth} WETH · Uniswap v3 · Base Sepolia`;
    case 'ORCA_LIQUIDITY': return `${pt ? 'Liquidez' : 'Liquidity'} ≤ ${d.input.maxSol} SOL + ${d.input.maxDevUsdc} devUSDC · Orca · Solana Devnet`;
    case 'LENDING_COMPOSITION': return d.role === 'SUPPLY' ? `Supply ${d.input.supply} USDC · Aave V3 (${pt ? 'composição' : 'composition'})`
      : d.role === 'BORROW' ? `Borrow ${d.input.borrow} USDC · Aave V3 (${pt ? 'composição' : 'composition'})`
      : `Swap ${pt ? 'do USDC emprestado' : 'of the borrowed USDC'} → WETH · Uniswap v3 (${pt ? 'composição' : 'composition'})`;
    case 'TEMPLATE': return pt ? `Template ${d.template} (só autoria)` : `Template ${d.template} (authoring only)`;
    case 'OTHER': return `${d.actionType} · ${step.network}`;
  }
}
/** A full sentence about one step, from its typed IR fields only. */
export function stepSentence(step: WorkflowStep, language: CopilotLanguage): string {
  const pt = language === 'PT', d = step.detail;
  switch (d.type) {
    case 'EVM_SWAP': return pt ? `Troca ${d.amount} ${d.from} por ${d.to} na ${d.network} pela Uniswap v3, com slippage máximo de ${d.slippage} bps.`
      : `Swaps ${d.amount} ${d.from} for ${d.to} on ${d.network} through Uniswap v3, with at most ${d.slippage} bps slippage.`;
    case 'SOLANA_SWAP': return pt ? `Troca ${d.input.amount} ${d.input.from} por ${d.input.to} na ${d.input.network} via ${step.protocol}, com slippage máximo de ${d.input.slippage} bps.`
      : `Swaps ${d.input.amount} ${d.input.from} for ${d.input.to} on ${d.input.network} through ${step.protocol}, with at most ${d.input.slippage} bps slippage.`;
    case 'ROUTER': {
      const option = ROUTER_NETWORK_OPTIONS[d.network], routing = ROUTER_ROUTING_LABEL[d.input.routing];
      return pt ? `Faz bridge de ${d.input.amount} USDC da ${option.sourceLabel} para a ${option.destinationLabel} pelo Flofi Cross-chain Router (${routing}), com slippage máximo de ${d.input.slippage} bps, para ${recipientOf(d.input.recipient, pt)}.`
        : `Bridges ${d.input.amount} USDC from ${option.sourceLabel} to ${option.destinationLabel} through the Flofi Cross-chain Router (${routing}), with at most ${d.input.slippage} bps slippage, to ${recipientOf(d.input.recipient, pt)}.`;
    }
    case 'AAVE': return d.operation === 'SUPPLY' ? (pt ? `Faz supply de ${d.input.amount} USDC na Aave V3 na Base Sepolia para ${d.input.beneficiary}.`
        : `Supplies ${d.input.amount} USDC to Aave V3 on Base Sepolia for ${d.input.beneficiary}.`)
      : d.operation === 'BORROW' ? (pt ? `Pega emprestado ${d.input.amount} USDC da Aave V3 na Base Sepolia (taxa variável) para ${d.input.beneficiary}.`
        : `Borrows ${d.input.amount} USDC from Aave V3 on Base Sepolia (variable rate) for ${d.input.beneficiary}.`)
      : (pt ? `Paga ${d.input.amount} USDC de dívida variável na Aave V3 na Base Sepolia em nome de ${d.input.beneficiary}.`
        : `Repays ${d.input.amount} USDC of variable debt to Aave V3 on Base Sepolia on behalf of ${d.input.beneficiary}.`);
    case 'AAVE_WITHDRAW': return pt ? `Retira ${d.input.amount} USDC da Aave V3 na Base Sepolia para sua carteira conectada.`
      : `Withdraws ${d.input.amount} USDC from Aave V3 on Base Sepolia to your connected wallet.`;
    case 'UNISWAP_LIQUIDITY': return pt ? `Adiciona liquidez concentrada na Uniswap v3 (Base Sepolia, USDC/WETH 0.05%): até ${d.input.maxUsdc} USDC e ${d.input.maxWeth} WETH entre ${d.lowerPrice} e ${d.upperPrice} USDC por WETH, com slippage máximo de ${d.input.slippage} bps.`
      : `Adds concentrated liquidity on Uniswap v3 (Base Sepolia, USDC/WETH 0.05%): up to ${d.input.maxUsdc} USDC and ${d.input.maxWeth} WETH between ${d.lowerPrice} and ${d.upperPrice} USDC per WETH, with at most ${d.input.slippage} bps slippage.`;
    case 'ORCA_LIQUIDITY': return pt ? `Adiciona liquidez concentrada na Orca Whirlpools (Solana Devnet, SOL/devUSDC): até ${d.input.maxSol} SOL e ${d.input.maxDevUsdc} devUSDC entre ${d.lowerPrice} e ${d.upperPrice} devUSDC por SOL, com slippage máximo de ${d.input.slippage} bps.`
      : `Adds concentrated liquidity on Orca Whirlpools (Solana Devnet, SOL/devUSDC): up to ${d.input.maxSol} SOL and ${d.input.maxDevUsdc} devUSDC between ${d.lowerPrice} and ${d.upperPrice} devUSDC per SOL, with at most ${d.input.slippage} bps slippage.`;
    case 'LENDING_COMPOSITION': return d.role === 'SUPPLY' ? (pt ? `Faz supply de ${d.input.supply} USDC na Aave V3 como colateral para ${d.input.owner}.`
        : `Supplies ${d.input.supply} USDC to Aave V3 as collateral for ${d.input.owner}.`)
      : d.role === 'BORROW' ? (pt ? `Depois de um checkpoint de health factor (HF ≥ 2.0), pega emprestado ${d.input.borrow} USDC da Aave V3.`
        : `After a health-factor checkpoint (HF ≥ 2.0), borrows ${d.input.borrow} USDC from Aave V3.`)
      : (pt ? `Troca exatamente os ${d.input.borrow} USDC emprestados por WETH na Uniswap v3, com slippage máximo de ${d.input.slippage} bps. A dívida continua.`
        : `Swaps exactly the borrowed ${d.input.borrow} USDC to WETH on Uniswap v3 with at most ${d.input.slippage} bps slippage. The debt remains.`);
    case 'TEMPLATE': return pt ? `Um passo template "${d.template}": um marcador de autoria que nunca executa.` : `A "${d.template}" template step: an authoring placeholder that never executes.`;
    case 'OTHER': return pt ? `Um passo ${d.actionType} na ${step.network}. O painel dele mostra os detalhes.` : `A ${d.actionType} step on ${step.network}. Its own panel shows the details.`;
  }
}
/** Which approvals and signatures a step's reviewed flow asks for, from Flofi's own flow implementations. */
function approvalLine(step: WorkflowStep, pt: boolean): string {
  const d = step.detail;
  switch (d.type) {
    case 'AAVE': return d.operation === 'BORROW'
      ? (pt ? 'Borrow: a Review lista cada transação deste passo antes de sua carteira assinar.' : 'Borrow: Review lists every transaction of this step before your wallet signs.')
      : (pt ? `${d.operation === 'SUPPLY' ? 'Supply' : 'Repay'}: a Aave precisa de permissão para mover seu USDC, então o fluxo inclui uma transação de approval de USDC antes, mostrada na Review.`
        : `${d.operation === 'SUPPLY' ? 'Supply' : 'Repay'}: Aave needs permission to move your USDC, so the flow includes a USDC approval transaction first, shown in Review.`);
    case 'AAVE_WITHDRAW': return pt ? 'Withdraw: a Review lista cada transação deste passo antes de sua carteira assinar.' : 'Withdraw: Review lists every transaction of this step before your wallet signs.';
    case 'ROUTER': return pt ? `Bridge: um approval exato de USDC (nunca ilimitado) para o spender da rota, depois o depósito na ${ROUTER_NETWORK_OPTIONS[d.network].sourceLabel}.`
      : `Bridge: an exact USDC approval (never unlimited) to the route's spender, then the deposit on ${ROUTER_NETWORK_OPTIONS[d.network].sourceLabel}.`;
    case 'EVM_SWAP': return d.network === 'Base Sepolia'
      ? (pt ? `Swap: só pede approval se a allowance atual de ${d.from} for menor que o valor do swap; depois a transação de swap.` : `Swap: an approval only if your current ${d.from} allowance is below the swap amount, then the swap transaction.`)
      : (pt ? 'Swap na Base: a Review mostra cada transação antes de qualquer assinatura.' : 'Base swap: Review shows every transaction before any signature.');
    case 'SOLANA_SWAP': case 'ORCA_LIQUIDITY': return pt ? 'Solana: não há approvals ERC-20; você revisa e assina cada transação exata.' : 'Solana: there are no ERC-20 approvals; you review and sign each exact transaction.';
    case 'UNISWAP_LIQUIDITY': return pt ? 'Liquidez Uniswap: approvals exatos de cada token, e cada approval e o mint precisam da própria assinatura.' : 'Uniswap liquidity: exact approvals for each token, and each approval and the mint need their own wallet signature.';
    case 'LENDING_COMPOSITION': return pt ? 'Composição: approval de USDC para o Pool da Aave antes do Supply e approval para o router antes do Swap; cada passo é assinado separadamente.'
      : 'Composition: a USDC approval to the Aave Pool before Supply and an approval to the swap router before Swap; each step is signed separately.';
    case 'TEMPLATE': return pt ? 'Template: nunca executa e não precisa de approval.' : 'Template: never executes and needs no approval.';
    case 'OTHER': return pt ? 'Este passo tem seu próprio painel de Review, que lista cada transação.' : 'This step has its own Review panel, which lists every transaction.';
  }
}
function failureLine(step: WorkflowStep, pt: boolean): string {
  const d = step.detail;
  if (d.type === 'ROUTER') { const source = ROUTER_NETWORK_OPTIONS[d.network].sourceLabel; return pt
    ? `Bridge: o sucesso exige observar o fill na ${ROUTER_NETWORK_OPTIONS[d.network].destinationLabel}. Se nenhum relayer preencher antes do prazo, a Across devolve o depósito para você na ${source}, e o Flofi acompanha esse reembolso. Se o depósito reverter, nenhum USDC sai da sua carteira.`
    : `Bridge: success needs the fill observed on ${ROUTER_NETWORK_OPTIONS[d.network].destinationLabel}. If no relayer fills before the fill deadline, Across refunds the deposit to you on ${source}, and Flofi watches for that refund. If the deposit reverts, no USDC leaves your wallet.`; }
  if (d.type === 'LENDING_COMPOSITION') return pt ? 'Composição: se o Swap falhar, o USDC emprestado e a dívida continuam; não há pagamento nem nova tentativa automática.'
    : 'Composition: if the Swap fails, the borrowed USDC and the debt remain; there is no automatic repayment or retry.';
  if (d.type === 'TEMPLATE') return pt ? 'Template: nunca executa.' : 'Template: never executes.';
  return pt ? `${stepSummary(step, 'PT')}: uma transação que falhar ou reverter é registrada e reconciliada; nada é tentado de novo automaticamente.`
    : `${stepSummary(step, 'EN')}: a failed or reverted transaction is recorded and reconciled; nothing is retried automatically.`;
}
const BLOCKER: Readonly<Record<string, readonly [string, string]>> = {
  UNKNOWN_ACTION: ['This action is not recognized.', 'Esta ação não é reconhecida.'],
  ADAPTER_NOT_AVAILABLE: ['The selected adapter is not available for this action.', 'O adapter escolhido não está disponível para esta ação.'],
  ADAPTER_VERSION_UNSUPPORTED: ['The selected adapter version is not supported.', 'A versão do adapter escolhido não é suportada.'],
  CHAIN_NOT_SUPPORTED: ['This action is not supported on its selected chain.', 'Esta ação não é suportada na rede escolhida.'],
  ENVIRONMENT_NOT_SUPPORTED: ['This adapter is not available in this environment.', 'Este adapter não está disponível neste ambiente.'],
  ACTION_TEMPLATE_ONLY: ['This action is available for workflow authoring only.', 'Esta ação serve só para autoria do fluxo.'],
  PUBLIC_EXECUTION_NOT_ENABLED: ['Public test execution is not available yet.', 'A execução pública de teste ainda não está disponível.'],
  MAINNET_EXECUTION_NOT_ENABLED: ['Mainnet execution is not available.', 'A execução em mainnet não está disponível.'],
  RUNTIME_UNAVAILABLE: ['The required local runtime or quote provider is unavailable here.', 'O runtime local ou o provedor de cotação necessário não está disponível aqui.'],
  AUTHORIZATION_MODE_UNSUPPORTED: ['This adapter does not support the workflow authorization mode.', 'Este adapter não suporta o modo de autorização do fluxo.'],
  WALLET_NOT_CONNECTED: ['Connect the required wallet before execution.', 'Conecte a carteira necessária antes de executar.'],
  WRONG_WALLET_CHAIN: ['Switch the wallet to the required network before execution.', 'Troque a carteira para a rede necessária antes de executar.'],
  ARTIFACTS_MISSING: ['Create and review current execution artifacts first.', 'Crie e revise os artefatos de execução atuais primeiro.'],
  ARTIFACTS_STALE: ['Execution artifacts changed or expired. Simulate and review again.', 'Os artefatos de execução mudaram ou expiraram. Simule e revise de novo.'],
  SIMULATION_REQUIRED: ['Run the exact simulation before execution.', 'Rode a simulação exata antes de executar.'],
  AUTHORIZATION_REQUIRED: ['Review and authorize the exact action before execution.', 'Revise e autorize a ação exata antes de executar.'],
  CAPABILITY_NOT_IMPLEMENTED: ['Execution is not implemented for this action here.', 'A execução não está implementada para esta ação aqui.'],
  PROTOCOL_NOT_DEPLOYED: ['The selected protocol has no canonical deployment on this network.', 'O protocolo escolhido não tem deployment canônico nesta rede.'],
};
const uniq = <T>(values: readonly T[]) => [...new Set(values)];

/** Flofi's own answer to a read-only question. Creates no proposal and changes nothing. */
export function answerQuestion(topic: CopilotQuestionTopic, step: WorkflowStep | null, facts: CopilotFacts, language: CopilotLanguage):
  { readonly text: string; readonly notes: readonly string[] } {
  const pt = language === 'PT', m = copilotCopy(language);
  const readOnly = pt ? 'Somente leitura: nada foi proposto, alterado, assinado ou executado.' : 'Read only: nothing was proposed, changed, signed or executed.';
  const steps = facts.steps, financial = steps.filter(item => item.kind !== 'TEMPLATE');
  const list = (items: readonly WorkflowStep[]) => items.map(item => `${item.index}. ${stepSentence(item, language)}`);
  const funds = () => {
    const real = uniq(financial.filter(item => item.testFunds === false).map(item => item.network));
    if (!financial.length) return pt ? 'Só há o template inicial: nada executaria.' : 'Only the starting template is here: nothing would execute.';
    return real.length ? (pt ? `Usa fundos reais em: ${real.join(', ')}.` : `Uses real funds on: ${real.join(', ')}.`)
      : financial.every(item => item.testFunds === true) ? (pt ? 'Usa apenas tokens de teste.' : 'Uses test tokens only.') : (pt ? 'Confira a rede de cada passo.' : 'Check each step\'s network.');
  };
  const pendingNote = facts.pending ? [pt ? `Há uma proposta pendente (${facts.pending.commandType}) ainda não aplicada; a resposta descreve o fluxo atual, sem ela.`
    : `A proposal (${facts.pending.commandType}) is pending and not applied; this answer describes the current workflow without it.`] : [];
  const answer = (text: string, notes: readonly string[] = []) => ({ text, notes: [...notes, readOnly] });
  const blockers = () => uniq((facts.capability?.blockers ?? []).map(item => BLOCKER[item.code]?.[pt ? 1 : 0] ?? item.code));
  const simulationLine = () => {
    const s = facts.simulation;
    if (s.flow === 'MOCKED_CHAIN') return s.status === 'CURRENT' ? (pt ? 'Há artefatos simulados atuais (MOCKED): dados sintéticos de fixture, não uma cotação real nem uma simulação financeira.'
      : 'Mocked artifacts are current: synthetic fixture data, not a live quote or a financial simulation.')
      : s.status === 'STALE' ? (pt ? 'Os artefatos simulados ficaram desatualizados porque o fluxo mudou ou expirou.' : 'The mocked artifacts are stale: the workflow changed or they expired.')
      : (pt ? 'Ainda não há resultado de simulação para este fluxo. Rode Simulate primeiro.' : 'There is no simulation result for this workflow yet. Run Simulate first.');
    return s.status === 'CURRENT' ? (pt ? 'Existe uma simulação atual para esta revisão. Os números dela aparecem na aba Simulate; o Copilot informa apenas o status.'
      : 'A current simulation exists for this revision. Its figures are in the Simulate tab; the Copilot reports only its status.')
      : s.status === 'STALE' ? (pt ? 'A última simulação ficou desatualizada porque o fluxo mudou. Simule de novo.' : 'The last simulation is stale because the workflow changed. Simulate again.')
      : (pt ? 'Ainda não há resultado de simulação para este fluxo. Rode Simulate primeiro.' : 'There is no simulation result for this workflow yet. Run Simulate first.');
  };
  switch (topic) {
    case 'WORKFLOW_OVERVIEW': case 'STEP_COUNT': {
      const text = pt ? `Este fluxo (revisão ${facts.revision}) tem ${steps.length} passo${steps.length === 1 ? '' : 's'}.` : `This workflow (revision ${facts.revision}) has ${steps.length} step${steps.length === 1 ? '' : 's'}.`;
      return answer(text, [...(topic === 'STEP_COUNT' ? steps.map(item => `${item.index}. ${stepSummary(item, language)}`) : list(steps)), funds(), ...pendingNote,
        ...(topic === 'WORKFLOW_OVERVIEW' && financial.length ? [pt ? 'Cada transação é simulada e revisada, e sua carteira assina; nada roda automaticamente.'
          : 'Each transaction is simulated and reviewed, and your wallet signs it; nothing runs automatically.'] : [])]);
    }
    case 'STEP_DETAIL': {
      if (!step) return answer(pt ? 'Diga qual passo, por exemplo “o passo 2” ou “o swap”.' : 'Say which step, for example “step 2” or “the swap”.', steps.map(item => `${item.index}. ${stepSummary(item, language)}`));
      return answer(pt ? `Passo ${step.index}: ${stepSentence(step, language)}` : `Step ${step.index}: ${stepSentence(step, language)}`, [
        pt ? `Protocolo: ${step.protocol}. Rede: ${step.network}.` : `Protocol: ${step.protocol}. Network: ${step.network}.`,
        step.testFunds === false ? (pt ? 'Fundos reais.' : 'Real funds.') : step.testFunds ? (pt ? 'Tokens de teste.' : 'Test tokens.') : '',
        pt ? `Política de falha: ${step.failurePolicy}. Autorização: ${step.authorization === 'MODE_A' ? 'sua carteira assina cada transação' : step.authorization}.`
          : `Failure policy: ${step.failurePolicy}. Authorization: ${step.authorization === 'MODE_A' ? 'your wallet signs each transaction' : step.authorization}.`,
        ...(step.dependencies.length ? [pt ? `Depende de: ${step.dependencies.join(', ')}.` : `Depends on: ${step.dependencies.join(', ')}.`] : []),
      ].filter(Boolean));
    }
    case 'PROTOCOLS': return answer(financial.length ? (pt ? `Protocolos neste fluxo: ${uniq(financial.map(item => item.protocol)).join('; ')}.`
      : `Protocols in this workflow: ${uniq(financial.map(item => item.protocol)).join('; ')}.`) : funds(), financial.map(item => `${item.index}. ${stepSummary(item, language)} — ${item.protocol}`));
    case 'NETWORKS': return answer(pt ? `Redes neste fluxo: ${uniq(steps.map(item => item.network)).join('; ')}.` : `Networks in this workflow: ${uniq(steps.map(item => item.network)).join('; ')}.`, [funds()]);
    case 'APPROVALS': {
      const subject = step ? [step] : financial;
      return answer(pt ? 'Aprovações e assinaturas que a Review vai pedir:' : 'Approvals and signatures the reviewed flow asks for:', [
        ...(subject.length ? subject.map(item => `${item.index}. ${approvalLine(item, pt)}`) : [funds()]),
        pt ? 'Sua própria carteira assina cada transação (MODE_A); o Flofi não guarda chaves e o Copilot não pode assinar.' : 'Your own wallet signs each transaction (MODE_A); Flofi holds no keys and the Copilot cannot sign.']);
    }
    case 'EXECUTION_FLOW': return answer(pt ? 'Ao executar, para cada passo: Simulate cria uma simulação nova, a Review mostra as transações exatas e o Strategy Manifest, sua carteira assina cada transação, e o Flofi registra, recupera e reconcilia o resultado.'
      : 'When you execute, for each step: Simulate creates a fresh simulation, Review shows the exact transactions and the Strategy Manifest, your wallet signs each transaction, and Flofi records, recovers and reconciles the result.',
      [...list(financial), funds(), ...(facts.capability ? [facts.capability.executionSupported ? (pt ? 'A execução é suportada neste ambiente.' : 'Execution is supported in this environment.')
        : (pt ? 'A execução não está disponível neste ambiente; pergunte “por que não consigo executar?” para ver o motivo.' : 'Execution is not available in this environment; ask “why can\'t I execute?” for the reason.')] : []), ...pendingNote]);
    case 'EXECUTION_BLOCKERS': {
      const reasons = blockers(), blocks = facts.findings.filter(item => item.severity === 'BLOCK').map(item => item.message);
      if (facts.reviewError) reasons.push(pt ? `O fluxo atual não é válido: ${facts.reviewError}` : `The current workflow is not valid: ${facts.reviewError}`);
      if (!reasons.length && !blocks.length) return answer(facts.capability?.executionReady ? (pt ? 'O Flofi não vê bloqueio de execução para a revisão atual. Você ainda revisa e assina cada transação.'
        : 'Flofi reports no execution blocker for the current revision. You still review and sign each transaction.')
        : (pt ? 'O Flofi não tem um bloqueio específico para mostrar, mas a execução não está pronta. Siga Simulate e Review.' : 'Flofi has no specific blocker to show, but execution is not ready. Follow Simulate and Review.'), [simulationLine()]);
      return answer(pt ? 'A execução está bloqueada por:' : 'Execution is blocked by:', [...reasons, ...blocks, simulationLine()]);
    }
    case 'MANIFEST': return answer(facts.simulation.reviewed ? (pt ? 'Existe uma Review aceita para a revisão atual. O Strategy Manifest permite somente as transações exatas revisadas: ações, valores, destinatários e approvals listados nela.'
      : 'A Review was accepted for the current revision. Its Strategy Manifest allows only the exact reviewed transactions: the actions, amounts, recipients and approvals it lists.')
      : (pt ? 'Ainda não há Strategy Manifest atual: o Flofi o cria na Review, depois de uma simulação nova. Ele permitirá somente as transações exatas revisadas.'
        : 'There is no current Strategy Manifest yet: Flofi builds it in Review after a fresh simulation. It will allow only the exact reviewed transactions.'),
      [...financial.map(item => `${item.index}. ${approvalLine(item, pt)}`), pt ? 'Qualquer mudança no fluxo invalida a simulação, o Manifest e a autorização.' : 'Any change to the workflow invalidates the simulation, the Manifest and the authorization.']);
    case 'SIMULATION': return answer(simulationLine(), facts.simulation.reviewed ? [pt ? 'A Review desta simulação foi aceita.' : 'The Review for this simulation was accepted.'] : []);
    case 'FAILURE': {
      const subject = step ? [step] : financial;
      return answer(pt ? 'Política de falha ABORT: se uma transação falhar, o Flofi para essa execução; nada continua ou é tentado de novo automaticamente.'
        : 'Failure policy ABORT: if a transaction fails, Flofi stops that run; nothing continues or retries automatically.', subject.map(item => `${item.index}. ${failureLine(item, pt)}`));
    }
    case 'PROPOSAL': return facts.pending ? answer(pt ? `A proposta pendente (${facts.pending.commandType}, da revisão ${facts.pending.baseRevision}) ainda não foi aplicada:`
      : `The pending proposal (${facts.pending.commandType}, from revision ${facts.pending.baseRevision}) is not applied yet:`, [...facts.pending.diff,
      pt ? 'Ela só muda o fluxo quando você clica em Apply proposal.' : 'It changes the workflow only when you click Apply proposal.'])
      : answer(pt ? 'Não há proposta pendente.' : 'There is no pending proposal.');
    case 'REVIEW_FINDINGS': return answer(facts.findings.length ? (pt ? `A revisão automática tem ${facts.findings.length} apontamento(s):` : `The automatic review has ${facts.findings.length} finding(s):`)
      : facts.reviewError ? (pt ? `O fluxo atual não é válido: ${facts.reviewError}` : `The current workflow is not valid: ${facts.reviewError}`)
      : (pt ? 'A revisão automática não tem apontamentos para a revisão atual.' : 'The automatic review has no findings for the current revision.'),
      facts.findings.map(item => `${item.severity} · ${item.message}`));
    case 'CAPABILITIES': return answer(m.capabilities);
    case 'MARKET_DATA': return answer(pt ? 'O Flofi não tem preços ao vivo, APY, saldos, preço de gas, tempo de bridge nem health factor neste espaço de trabalho, e o Copilot nunca estima esses valores.'
      : 'Flofi has no live prices, APY, balances, gas prices, bridge times or health factors in this workspace, and the Copilot never estimates them.',
      [pt ? 'Cotações e resultados simulados aparecem apenas em Simulate e Review, vindos dos provedores do próprio fluxo.' : 'Quotes and simulated outcomes appear only in Simulate and Review, from the flow\'s own providers.']);
    case 'OTHER': return answer(pt ? 'O Copilot responde perguntas sobre os passos deste fluxo, protocolos, redes, approvals, Manifest, status da simulação, bloqueios e falhas.'
      : 'The Copilot answers questions about this workflow\'s steps, protocols, networks, approvals, Manifest, simulation status, blockers and failure handling.');
  }
}
