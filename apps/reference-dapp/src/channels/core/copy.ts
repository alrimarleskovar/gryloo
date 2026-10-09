// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUILD-CHANNELS-001: every sentence a channel sends, written by FloFi (EN/PT) — never by a model. Facts come only from FloFi's own
 * state: the canonical strategy, the shared platform's gates and approval status, the preview projection and the run's evidence as
 * recorded. Addresses and hashes are always shortened. No copy ever says or implies that a message authorized, signed or executed
 * anything; execution happens only in FloFi with the owner's wallet.
 */
import type { ChannelLanguage } from './config.ts';

/** `0x1234…abcd` for every address or hash in a channel text. */
export const shorten = (text: string) => text.replace(/0x([0-9a-fA-F]{4})[0-9a-fA-F]{32,60}([0-9a-fA-F]{4})(?![0-9a-fA-F])/g, '0x$1…$2');
const NETWORK_LABEL: Readonly<Record<string, string>> = { 'base': 'Base', 'base-sepolia': 'Base Sepolia', 'arbitrum-one': 'Arbitrum One',
  'arbitrum-sepolia': 'Arbitrum Sepolia', 'ethereum-sepolia': 'Ethereum Sepolia', 'solana': 'Solana', 'solana-devnet': 'Solana Devnet' };
export const networkLabel = (id: string) => NETWORK_LABEL[id] ?? id;

export type PreviewNote = { readonly kind: 'PASSED'; readonly provenance: string } | { readonly kind: 'FAILED'; readonly code: string }
  | { readonly kind: 'SKIPPED' } | { readonly kind: 'DISABLED' };
export type ReadyFacts = { readonly lines: readonly string[]; readonly networks: readonly string[]; readonly fundsClass: 'TEST_FUNDS' | 'REAL_FUNDS';
  readonly notes: readonly string[]; readonly preview: PreviewNote; readonly intendedWallet: string | null; readonly aiInterpreted: boolean; readonly expiresMinutes: number };
export type RunLine = { readonly status: string; readonly reconciled: boolean; readonly terminal: boolean; readonly errorCode: string | null;
  readonly evidenceEnvironment: string | null; readonly evidenceOutcome: string | null; readonly evidenceBundleHash: string | null };

const EN = {
  firstContact: (support: string, privacy: string) => `FloFi (automated assistant). I compose DeFi strategies for you to review and sign in FloFi. I can't sign, execute or move funds, and nothing you write here authorizes anything. Never send a private key or seed phrase. Human support: ${support}. Privacy: ${privacy}. Reply STOP to stop messages.`,
  help: (support: string, privacy: string) => `What I can do: compose a strategy from your message (for example "Supply 100 USDC on Aave on Base Sepolia"), ask for anything missing, correct it ("make it 50"), and tell you its status (STATUS). LINK sends a fresh approval link, NEW starts over, STOP stops messages.\nExecution happens only in FloFi, with your own wallet, after a fresh simulation and your review of the Strategy Manifest. Messages here never authorize anything.\nHuman support: ${support}. Privacy: ${privacy}.`,
  ready: 'Strategy ready:',
  network: (labels: string, real: boolean) => `Network: ${labels}${real ? ' — REAL FUNDS' : ' (test funds)'}`,
  preview: (p: PreviewNote) => p.kind === 'PASSED' ? `Simulation preview passed (read-only${p.provenance === 'MOCKED' ? ', MOCKED' : ''}). FloFi simulates again before your review.`
    : p.kind === 'FAILED' ? `Simulation preview did not pass (${p.code}). FloFi will show the details when you open it.`
      : p.kind === 'SKIPPED' ? 'FloFi runs the simulation when you open it.' : 'FloFi runs the simulation when you open it.',
  authorize: (wallet: string | null, minutes: number) => `Nothing is authorized yet: open FloFi${wallet ? `, connect the wallet ${wallet}` : ', connect your wallet'}, review the Strategy Manifest and sign there. The link works once and expires in ${minutes} minutes.`,
  ai: 'Interpreted from your message with an AI assistant. It is not financial advice; you decide.',
  linkLabel: 'Open FloFi',
  authority: 'Nothing can be authorized here — not with "yes", "confirm" or any other message. To execute, open FloFi with the approval link, connect your wallet, check the fresh simulation and the Strategy Manifest, and sign there. Send LINK for a fresh link.',
  refused: (code: string) => REFUSALS_EN[code] ?? `FloFi couldn't prepare an approval link (${code}). Nothing was proposed.`,
  noPending: 'There is no pending strategy. Tell me what you want to do.',
  cancelled: 'Cancelled. The previous approval link no longer works.',
  replaced: 'The previous approval link no longer works.',
  linkLost: 'Your approval link could not be delivered, so it was withdrawn. Send LINK for a fresh one.',
  noApproval: 'There is no proposal from this chat yet.',
  approval: (status: string, expires: string) => APPROVAL_EN[status]?.(expires) ?? `Proposal: ${status}.`,
  notShared: 'The wallet owner has not shared run status with this chat (it can be turned on in FloFi).',
  noRuns: 'No execution has started from it yet.',
  run: (r: RunLine) => r.reconciled ? `Execution reconciled ✅ · evidence: ${r.evidenceEnvironment ?? 'unknown'} · outcome: ${r.evidenceOutcome ?? 'unknown'}${r.evidenceBundleHash ? ` · bundle ${shorten(r.evidenceBundleHash)}` : ''}`
    : r.terminal ? `Execution ended without success (${r.errorCode ?? r.status}). See FloFi for details.` : `Execution in progress (${r.status}).`,
  loaded: 'Your proposal is loaded in FloFi for the connected wallet. Nothing is signed yet: FloFi simulates again and you review the Strategy Manifest before any signature.',
  secret: 'Never send a private key or seed phrase — FloFi never needs one. I did not store this message or send it to any AI, but it already reached the messaging provider: if it was real, treat it as compromised and move your funds to a new wallet.',
  unsupported: 'I can only read text messages. Please write what you want to do.',
  late: 'Your message reached FloFi late, so I did not act on it. Please send it again if you still want it.',
  optedOut: 'You will not receive more messages from FloFi here. Reply START to resume.',
  optedIn: 'Messages resumed.',
  subscribed: (owner: string, days: number) => `This chat now receives FloFi automation notifications for ${owner} (for ${days} days; send STOP to end them, or unlink in FloFi). A notification never authorizes anything: it only points you to FloFi, where your own wallet decides.`,
  subscribeFailed: 'That code is not valid (it may have expired or been used). Create a new one in FloFi → Automations → Notifications.',
  subscribeUnavailable: 'Automation notifications are not available in this chat.',
  grammarOnly: 'I could not read that as a strategy. Try for example: "supply 100 USDC to Aave on Base Sepolia beneficiary 0x…" or "swap 1 USDC to WETH on Base Sepolia slippage 50 bps". Send HELP for more.',
  choose: 'Reply with the number of your choice.',
  busy: 'Too many messages right now — please wait a moment and try again.',
  error: 'Something went wrong on FloFi\'s side. Nothing was proposed or authorized. Please try again.',
};
const REFUSALS_EN: Readonly<Record<string, string>> = {
  MAINNET_HANDOFF_DISABLED_BY_POLICY: 'This strategy uses a mainnet (real funds). Proposals with real funds are disabled for this channel.',
  TEST_FUNDS_HANDOFF_DISABLED_BY_POLICY: 'Test-network proposals are disabled for this channel.',
  FLOW_NOT_ENABLED_IN_DEPLOYMENT: 'FloFi cannot execute this strategy on this deployment right now. Nothing was proposed.',
  OWNER_EXECUTION_NOT_ENABLED_IN_DEPLOYMENT: 'FloFi cannot execute this strategy on this deployment right now. Nothing was proposed.',
  NO_EXECUTION_FLOW: 'FloFi has no execution flow for this strategy. Nothing was proposed.',
  OWNER_EXECUTION_NOT_IMPLEMENTED: 'FloFi has no execution flow for this strategy. Nothing was proposed.',
  CLOUD_RUNTIME_NOT_CONFIGURED: 'FloFi cannot execute strategies on this deployment. Nothing was proposed.',
  MCP_CLOUD_RUNTIME_REQUIRED: 'FloFi cannot execute strategies on this deployment. Nothing was proposed.',
  MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED: 'FloFi cannot execute this sequence of steps yet. Nothing was proposed.',
  REVIEW_BLOCKED: 'FloFi\'s review blocks this strategy, so no approval link was created.',
  HANDOFF_RATE_LIMITED: 'Too many approval links in a short time — please wait and try again.',
  HANDOFF_PENDING_LIMIT: 'Too many open approval links — send NEW to start over.',
  CHANNEL_STRATEGY_PARITY_FAILED: 'FloFi could not turn that into a canonical strategy. Nothing was proposed.',
  STRATEGY_SCHEMA_INVALID: 'FloFi could not turn that into a canonical strategy. Nothing was proposed.',
};
const APPROVAL_EN: Readonly<Record<string, (expires: string) => string>> = {
  PENDING: e => `Proposal waiting for you to open it in FloFi (expires ${e}).`, CLAIMED: () => 'Proposal loaded for a wallet in FloFi; nothing is signed yet.',
  APPLIED: () => 'Proposal in a FloFi workflow; any execution needs the wallet owner\'s review and signature there.', EXPIRED: () => 'Proposal expired. Send LINK for a fresh one.',
  SUPERSEDED: () => 'Proposal replaced by a newer one.', REVOKED: () => 'Proposal withdrawn.', STALE: () => 'Proposal no longer valid with FloFi\'s current rules. Send NEW.',
};

type Copy = typeof EN;
const PT: Copy = {
  firstContact: (support, privacy) => `FloFi (assistente automático). Eu monto estratégias DeFi para você revisar e assinar no FloFi. Não posso assinar, executar nem mover fundos, e nada do que você escrever aqui autoriza qualquer coisa. Nunca envie chave privada ou frase-semente. Suporte humano: ${support}. Privacidade: ${privacy}. Responda PARAR para não receber mais mensagens.`,
  help: (support, privacy) => `O que posso fazer: montar uma estratégia a partir da sua mensagem (por exemplo "Coloca 100 USDC na Aave na Base Sepolia"), perguntar o que faltar, corrigir ("muda para 50") e informar o status (ESTADO). LINK envia um novo link de aprovação, NOVO recomeça, PARAR interrompe as mensagens.\nA execução acontece só no FloFi, com a sua própria carteira, depois de uma nova simulação e da sua revisão do Strategy Manifest. Mensagens aqui nunca autorizam nada.\nSuporte humano: ${support}. Privacidade: ${privacy}.`,
  ready: 'Estratégia pronta:',
  network: (labels, real) => `Rede: ${labels}${real ? ' — FUNDOS REAIS' : ' (fundos de teste)'}`,
  preview: p => p.kind === 'PASSED' ? `Prévia da simulação aprovada (somente leitura${p.provenance === 'MOCKED' ? ', MOCKED' : ''}). O FloFi simula de novo antes da sua revisão.`
    : p.kind === 'FAILED' ? `A prévia da simulação não passou (${p.code}). O FloFi mostra os detalhes quando você abrir.` : 'O FloFi roda a simulação quando você abrir.',
  authorize: (wallet, minutes) => `Nada está autorizado ainda: abra o FloFi${wallet ? `, conecte a carteira ${wallet}` : ', conecte sua carteira'}, revise o Strategy Manifest e assine lá. O link funciona uma vez e expira em ${minutes} minutos.`,
  ai: 'Interpretado da sua mensagem com um assistente de IA. Não é recomendação financeira; a decisão é sua.',
  linkLabel: 'Abrir no FloFi',
  authority: 'Nada pode ser autorizado aqui — nem com "sim", "confirmo" ou qualquer outra mensagem. Para executar, abra o FloFi pelo link de aprovação, conecte sua carteira, confira a nova simulação e o Strategy Manifest e assine lá. Envie LINK para um novo link.',
  refused: code => REFUSALS_PT[code] ?? `O FloFi não conseguiu preparar um link de aprovação (${code}). Nada foi proposto.`,
  noPending: 'Não há estratégia pendente. Diga o que você quer fazer.',
  cancelled: 'Cancelado. O link de aprovação anterior não funciona mais.',
  replaced: 'O link de aprovação anterior não funciona mais.',
  linkLost: 'Seu link de aprovação não pôde ser entregue, então foi retirado. Envie LINK para um novo.',
  noApproval: 'Ainda não há proposta desta conversa.',
  approval: (status, expires) => APPROVAL_PT[status]?.(expires) ?? `Proposta: ${status}.`,
  notShared: 'O dono da carteira não compartilhou o status das execuções com esta conversa (dá para ativar no FloFi).',
  noRuns: 'Nenhuma execução começou a partir dela ainda.',
  run: r => r.reconciled ? `Execução reconciliada ✅ · evidência: ${r.evidenceEnvironment ?? 'desconhecida'} · resultado: ${r.evidenceOutcome ?? 'desconhecido'}${r.evidenceBundleHash ? ` · bundle ${shorten(r.evidenceBundleHash)}` : ''}`
    : r.terminal ? `Execução terminou sem sucesso (${r.errorCode ?? r.status}). Veja os detalhes no FloFi.` : `Execução em andamento (${r.status}).`,
  loaded: 'Sua proposta foi carregada no FloFi para a carteira conectada. Nada foi assinado ainda: o FloFi simula de novo e você revisa o Strategy Manifest antes de qualquer assinatura.',
  secret: 'Nunca envie chave privada ou frase-semente — o FloFi nunca precisa disso. Não guardei esta mensagem nem a enviei para nenhuma IA, mas ela já passou pelo provedor de mensagens: se era real, considere-a comprometida e mova seus fundos para uma nova carteira.',
  unsupported: 'Só consigo ler mensagens de texto. Escreva o que você quer fazer.',
  late: 'Sua mensagem chegou atrasada ao FloFi, então não agi sobre ela. Envie de novo se ainda quiser.',
  optedOut: 'Você não vai receber mais mensagens do FloFi aqui. Responda VOLTAR para retomar.',
  optedIn: 'Mensagens retomadas.',
  subscribed: (owner, days) => `Esta conversa agora recebe as notificações de automações do FloFi para ${owner} (por ${days} dias; envie PARAR para encerrar, ou desvincule no FloFi). Uma notificação nunca autoriza nada: ela só leva você ao FloFi, onde a sua própria carteira decide.`,
  subscribeFailed: 'Esse código não é válido (pode ter expirado ou já ter sido usado). Crie um novo no FloFi → Automações → Notificações.',
  subscribeUnavailable: 'As notificações de automações não estão disponíveis nesta conversa.',
  grammarOnly: 'Não consegui ler isso como uma estratégia. Tente por exemplo: "supply 100 USDC to Aave on Base Sepolia beneficiary 0x…" ou "swap 1 USDC to WETH on Base Sepolia slippage 50 bps". Envie AJUDA para mais.',
  choose: 'Responda com o número da sua escolha.',
  busy: 'Muitas mensagens agora — espere um momento e tente de novo.',
  error: 'Algo deu errado do lado do FloFi. Nada foi proposto nem autorizado. Tente de novo.',
};
const REFUSALS_PT: Readonly<Record<string, string>> = {
  MAINNET_HANDOFF_DISABLED_BY_POLICY: 'Esta estratégia usa uma mainnet (fundos reais). Propostas com fundos reais estão desativadas neste canal.',
  TEST_FUNDS_HANDOFF_DISABLED_BY_POLICY: 'Propostas em redes de teste estão desativadas neste canal.',
  FLOW_NOT_ENABLED_IN_DEPLOYMENT: 'O FloFi não pode executar esta estratégia neste ambiente agora. Nada foi proposto.',
  OWNER_EXECUTION_NOT_ENABLED_IN_DEPLOYMENT: 'O FloFi não pode executar esta estratégia neste ambiente agora. Nada foi proposto.',
  NO_EXECUTION_FLOW: 'O FloFi não tem fluxo de execução para esta estratégia. Nada foi proposto.',
  OWNER_EXECUTION_NOT_IMPLEMENTED: 'O FloFi não tem fluxo de execução para esta estratégia. Nada foi proposto.',
  CLOUD_RUNTIME_NOT_CONFIGURED: 'O FloFi não executa estratégias neste ambiente. Nada foi proposto.',
  MCP_CLOUD_RUNTIME_REQUIRED: 'O FloFi não executa estratégias neste ambiente. Nada foi proposto.',
  MULTI_STEP_SEQUENCE_NOT_IMPLEMENTED: 'O FloFi ainda não executa esta sequência de passos. Nada foi proposto.',
  REVIEW_BLOCKED: 'A revisão do FloFi bloqueia esta estratégia, então nenhum link de aprovação foi criado.',
  HANDOFF_RATE_LIMITED: 'Muitos links de aprovação em pouco tempo — espere e tente de novo.',
  HANDOFF_PENDING_LIMIT: 'Muitos links de aprovação abertos — envie NOVO para recomeçar.',
  CHANNEL_STRATEGY_PARITY_FAILED: 'O FloFi não conseguiu transformar isso em uma estratégia canônica. Nada foi proposto.',
  STRATEGY_SCHEMA_INVALID: 'O FloFi não conseguiu transformar isso em uma estratégia canônica. Nada foi proposto.',
};
const APPROVAL_PT: Readonly<Record<string, (expires: string) => string>> = {
  PENDING: e => `Proposta esperando você abrir no FloFi (expira ${e}).`, CLAIMED: () => 'Proposta carregada para uma carteira no FloFi; nada foi assinado ainda.',
  APPLIED: () => 'Proposta em um workflow do FloFi; qualquer execução precisa da revisão e da assinatura do dono da carteira lá.',
  EXPIRED: () => 'Proposta expirada. Envie LINK para uma nova.', SUPERSEDED: () => 'Proposta substituída por uma mais nova.', REVOKED: () => 'Proposta retirada.',
  STALE: () => 'Proposta não é mais válida com as regras atuais do FloFi. Envie NOVO.',
};

export const channelCopy = (language: ChannelLanguage): Copy => language === 'PT' ? PT : EN;

/** The "Strategy ready" text (the approval link travels separately, as the reply's one link). */
export function readyText(language: ChannelLanguage, facts: ReadyFacts): string {
  const m = channelCopy(language);
  const lines = [m.ready, ...facts.lines.map((line, i) => `${i + 1}. ${line}`), m.network(facts.networks.map(networkLabel).join(' → '), facts.fundsClass === 'REAL_FUNDS'),
    ...facts.notes.slice(0, 3), m.preview(facts.preview), m.authorize(facts.intendedWallet, facts.expiresMinutes), ...facts.aiInterpreted ? [m.ai] : []];
  return shorten(lines.join('\n'));
}
