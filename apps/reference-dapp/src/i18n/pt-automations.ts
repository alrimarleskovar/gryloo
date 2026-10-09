// SPDX-License-Identifier: AGPL-3.0-only
/** BUILD-AUTOMATION-001: the Automations workspace, its in-app notice and the automation wording of /approve. */
export const portugueseAutomations: Readonly<Record<string, string>> = {
  // Workspace
  'Automations': 'Automações', 'Open Automations': 'Abrir Automações', 'Loading automations…': 'A carregar as automações…',
  'FloFi evaluates the schedules and price conditions you set, and asks you before every execution. Nothing runs or signs on its own: each proposal goes through a fresh simulation, your Strategy Manifest review and your own wallet signature.':
    'O FloFi avalia os agendamentos e as condições de preço que definir e pergunta-lhe antes de cada execução. Nada corre nem assina sozinho: cada proposta passa por uma nova simulação, pela sua revisão do Strategy Manifest e pela assinatura da sua própria carteira.',
  'Automations are not enabled on this deployment.': 'As automações não estão ativas neste ambiente.',
  'Connect a wallet from the header to use automations.': 'Ligue uma carteira no cabeçalho para usar automações.',
  'Verify wallet ownership to use automations.': 'Verifique a titularidade da carteira para usar automações.',
  'Waiting for you': 'À sua espera', 'Nothing is waiting for you. FloFi will ask here when an automation is due or a condition is met.':
    'Nada está à sua espera. O FloFi pergunta-lhe aqui quando uma automação chegar à hora marcada ou uma condição for atingida.',
  'Your automations': 'As suas automações', 'No automations yet. Create one below.': 'Ainda não há automações. Crie uma abaixo.', 'Archived ({0})': 'Arquivadas ({0})',
  'Recent proposals': 'Propostas recentes', 'Prices: {0}.': 'Preços: {0}.', 'Chainlink feeds on Base (read-only)': 'feeds Chainlink na Base (só leitura)',
  'test fixture (MOCKED)': 'dados de teste (MOCKED)', 'no price source on this deployment': 'sem fonte de preços neste ambiente',
  '1 automation proposal is waiting for you.': '1 proposta de automação está à sua espera.', '{0} automation proposals are waiting for you.': '{0} propostas de automação estão à sua espera.',
  // Kinds, states, schedule
  'Scheduled DCA': 'DCA agendado', 'Price trigger': 'Gatilho de preço', 'Daily watch': 'Ronda diária', 'Archived': 'Arquivada', 'Paused': 'Em pausa',
  'Awaiting you': 'À sua espera', 'Opened for review': 'Aberta para revisão', 'Loaded into your workflow': 'Carregada no seu fluxo', 'Dismissed': 'Recusada',
  'Ask me before every execution': 'Perguntar-me antes de cada execução', 'Every day at {0} ({1})': 'Todos os dias às {0} ({1})', 'Every {0} at {1} ({2})': 'Todas as semanas, {0} às {1} ({2})',
  'Monday': 'segunda-feira', 'Tuesday': 'terça-feira', 'Wednesday': 'quarta-feira', 'Thursday': 'quinta-feira', 'Friday': 'sexta-feira', 'Saturday': 'sábado', 'Sunday': 'domingo',
  'day': 'dia', 'week': 'semana', 'month': 'mês',
  'If {0} falls below {1}': 'Se {0} descer abaixo de {1}', 'If {0} rises above {1}': 'Se {0} subir acima de {1}',
  'If {0} falls {1}% from {2} (at or below {3})': 'Se {0} descer {1}% a partir de {2} (a {3} ou menos)', 'If {0} rises {1}% from {2} (at or above {3})': 'Se {0} subir {1}% a partir de {2} (a {3} ou mais)',
  'Prepare {0} {1} → {2} on {3}': 'Preparar {0} {1} → {2} na {3}', 'Notify me only': 'Só me avisar', 'Notify me': 'Avisar-me',
  'Max {0} per execution': 'Máx. {0} por execução', 'Max {0} per {1}': 'Máx. {0} por {1}', 'At most {0} proposals per {1}': 'No máximo {0} propostas por {1}',
  'Cooldown {0} min': 'Intervalo de espera {0} min', 'Max slippage {0} bps': 'Desvio máx. {0} bps',
  // Cards
  'Proposal from {0}': 'Proposta de {0}', 'Scheduled for': 'Agendada para', 'met': 'atingida', 'not observed': 'sem observação', '{0} since the last round': '{0} desde a última ronda',
  'fixture': 'dados de teste', 'Buy': 'Comprar', 'Sell': 'Vender', 'No BTC swap route in FloFi yet': 'O FloFi ainda não tem rota de troca para BTC',
  'Not executable on this deployment': 'Não executável neste ambiente', 'REAL FUNDS': 'FUNDOS REAIS', 'Amount ({0})': 'Montante ({0})', 'Prepare in Build': 'Preparar em Criar',
  'This is your own new trade, not part of this automation: it goes to your Build draft as an ordinary proposal, exactly as if you had composed it there. The automation adds no authority and no limits to it. Nothing is signed: apply it, simulate and review the Strategy Manifest first.':
    'Esta é uma nova operação sua, que não faz parte desta automação: vai para o seu rascunho em Criar como uma proposta normal, tal como se a tivesse composto lá. A automação não lhe acrescenta autoridade nem limites. Nada é assinado: aplique-a, simule e reveja primeiro o Strategy Manifest.',
  'Waiting until': 'À espera até', 'sent to your chat': 'enviada para a sua conversa', 'not delivered': 'não entregue', 'Review in FloFi': 'Rever no FloFi',
  'Ignore': 'Ignorar', 'Acknowledge': 'Tomar conhecimento',
  'Nothing is authorized yet. Review opens FloFi’s approval: prove your wallet, run a fresh simulation, review the Strategy Manifest and sign with your own wallet.':
    'Nada está autorizado ainda. Rever abre a aprovação do FloFi: verifique a sua carteira, execute uma nova simulação, reveja o Strategy Manifest e assine com a sua própria carteira.',
  'Automation {0}': 'Automação {0}', 'When': 'Quando', 'Condition': 'Condição', 'checked every {0} min': 'verificado a cada {0} min', 'Assets': 'Ativos',
  'from saved workflow (version {0})': 'do fluxo guardado (versão {0})', 'Next evaluation': 'Próxima avaliação', 'Last observation': 'Última observação',
  'Last evaluation': 'Última avaliação', '{0} pending proposal(s)': '{0} proposta(s) pendente(s)', 'Expires': 'Expira',
  'The saved workflow changed after this automation was created. FloFi proposes nothing until you rebind it to the current version.':
    'O fluxo guardado mudou depois de esta automação ser criada. O FloFi não propõe nada até a voltar a associar à versão atual.',
  'This action no longer reproduces with FloFi’s current engine. FloFi proposes nothing until you rebind it.':
    'Esta ação já não se reproduz com o motor atual do FloFi. O FloFi não propõe nada até a voltar a associar.',
  'Rebind': 'Voltar a associar', 'Pause': 'Pausar', 'Archive': 'Arquivar', 'History': 'Histórico', 'History of {0}': 'Histórico de {0}',
  'Evaluations and proposals are not transaction evidence. Executions, reconciliation and evidence are in your runs.':
    'Avaliações e propostas não são evidências de transações. Execuções, reconciliação e evidências estão nas suas execuções.',
  'Proposals': 'Propostas', 'Execution reconciled': 'Execução reconciliada', 'Execution ended': 'Execução terminada', 'Owner executed — reconciling': 'Executada pelo titular — a reconciliar',
  'evidence': 'evidência', 'Open run': 'Abrir execução', 'No proposals yet.': 'Ainda não há propostas.', 'Evaluations': 'Avaliações', '{0} slot(s)': '{0} horário(s)',
  // Create
  'Create an automation': 'Criar uma automação', 'Type': 'Tipo', 'Name': 'Nome', 'Repeat': 'Repetir', 'Every day': 'Todos os dias', 'Every week': 'Todas as semanas',
  'Day': 'Dia', 'Time': 'Hora', 'Watched asset': 'Ativo observado', 'Price falls below': 'O preço desce abaixo de', 'Price rises above': 'O preço sobe acima de',
  'Price falls by a percentage': 'O preço desce uma percentagem', 'Price rises by a percentage': 'O preço sobe uma percentagem', 'Threshold (USD)': 'Limiar (USD)',
  'Reference price (USD)': 'Preço de referência (USD)', 'Percentage': 'Percentagem', 'Check every': 'Verificar a cada', '{0} minutes': '{0} minutos', 'Time zone': 'Fuso horário',
  'Assets to check': 'Ativos a verificar',
  'Action: notify me. FloFi reports what it observed; you decide to buy, sell or ignore. It is not financial advice.':
    'Ação: avisar-me. O FloFi indica o que observou; decide se compra, vende ou ignora. Não é aconselhamento financeiro.',
  'Prepare': 'Preparar', 'A buy or a sell': 'Uma compra ou uma venda', 'A saved workflow': 'Um fluxo guardado', 'Nothing — notify me only': 'Nada — só me avisar',
  'Saved workflow': 'Fluxo guardado', 'Choose a saved workflow': 'Escolha um fluxo guardado', 'Side': 'Sentido', 'Asset': 'Ativo', 'not available here': 'indisponível aqui',
  'FloFi has no BTC swap route yet (no BTC, WBTC or cbBTC swap). You can watch BTC and get alerts, but FloFi cannot prepare a BTC purchase, and it never substitutes another asset.':
    'O FloFi ainda não tem rota de troca para BTC (sem troca de BTC, WBTC ou cbBTC). Pode observar o BTC e receber alertas, mas o FloFi não consegue preparar uma compra de BTC e nunca o substitui por outro ativo.',
  'This action is not available on this deployment ({0}).': 'Esta ação não está disponível neste ambiente ({0}).',
  'Test network: the swap executes at the test pool’s price, not at the observed market price.': 'Rede de testes: a troca é executada ao preço do pool de testes, não ao preço de mercado observado.',
  'Max per execution': 'Máximo por execução', 'Max amount per period': 'Montante máximo por período', 'Max proposals per period': 'Máximo de propostas por período',
  'Cooldown (minutes)': 'Intervalo de espera (minutos)', 'Max slippage (bps)': 'Desvio máximo (bps)', 'Expires on': 'Expira em',
  'Limits bound what FloFi proposes. They are not on-chain spending limits: every execution still needs your review and your wallet signature.':
    'Os limites restringem o que o FloFi propõe. Não são limites de gasto on-chain: cada execução continua a precisar da sua revisão e da assinatura da sua carteira.',
  'Create automation': 'Criar automação', 'Amount period': 'Período do montante', 'Proposal period': 'Período das propostas',
  // Notifications
  'Notifications': 'Notificações', 'In FloFi': 'No FloFi', 'always on — proposals wait for you in this workspace.': 'sempre ativas — as propostas esperam por si nesta área.',
  'not available on this deployment.': 'indisponível neste ambiente.', 'linked to your chat until': 'ligado à sua conversa até', 'Unlink': 'Desligar',
  'not linked.': 'não ligado.', 'Connect Telegram': 'Ligar Telegram', 'Send this message to the FloFi bot within 10 minutes:': 'Envie esta mensagem ao bot do FloFi nos próximos 10 minutos:',
  'A notification never authorizes anything. It only brings you back here, where your own wallet decides.':
    'Uma notificação nunca autoriza nada. Só o traz de volta aqui, onde decide a sua própria carteira.',
  // History outcomes
  'Automation created': 'Automação criada', 'Automation expired': 'Automação expirada', 'Resumed': 'Retomada', 'Rebound to the current workflow': 'Associada de novo ao fluxo atual',
  'Triggered — proposal created': 'Acionada — proposta criada', 'Market round reported': 'Ronda de mercado reportada', 'Evaluated — condition not met (watching)': 'Avaliada — condição não atingida (a observar)',
  'Evaluated — condition not met': 'Avaliada — condição não atingida', 'Condition already met — waiting for a new crossing': 'Condição já atingida — à espera de um novo cruzamento',
  'Condition still met — no new proposal': 'Condição ainda atingida — sem nova proposta', 'Condition cleared — watching again': 'Condição desfeita — a observar de novo',
  'Crossing during the cooldown — no proposal': 'Cruzamento durante o intervalo de espera — sem proposta', 'Blocked by a limit — no proposal': 'Bloqueada por um limite — sem proposta',
  'Missed while FloFi was unavailable': 'Perdida enquanto o FloFi esteve indisponível', 'Saved workflow changed — rebind required': 'Fluxo guardado alterado — é preciso voltar a associar',
  'No longer reproducible — rebind required': 'Já não reproduzível — é preciso voltar a associar', 'You started your own buy in Build': 'Iniciou uma compra sua em Criar',
  'You started your own sell in Build': 'Iniciou uma venda sua em Criar', 'Duplicate trigger ignored': 'Gatilho duplicado ignorado', 'Price observation too old — ignored': 'Observação de preço demasiado antiga — ignorada',
  'No price source on this deployment': 'Sem fonte de preços neste ambiente', 'Price source timed out — ignored': 'A fonte de preços excedeu o tempo — ignorada',
  'Price source unreachable — ignored': 'Fonte de preços inacessível — ignorada', 'Price source error — ignored': 'Erro da fonte de preços — ignorado',
  'Price feed failed verification — ignored': 'O feed de preços falhou a verificação — ignorado', 'Withdrawn by a rebind': 'Retirada por uma nova associação',
  // Notices and errors
  'Automation created. FloFi will ask you before every execution.': 'Automação criada. O FloFi pergunta-lhe antes de cada execução.', 'Automation paused.': 'Automação em pausa.',
  'Automation resumed.': 'Automação retomada.', 'Automation archived.': 'Automação arquivada.', 'Automation rebound.': 'Automação associada de novo.', 'Proposal dismissed.': 'Proposta recusada.',
  'Your own trade is in Build. Apply it, simulate and review before signing.': 'A sua operação está em Criar. Aplique-a, simule e reveja antes de assinar.', 'Telegram unlinked.': 'Telegram desligado.',
  'FloFi could not complete this ({0}).': 'O FloFi não conseguiu concluir isto ({0}).', 'Automations are unavailable on this deployment right now.': 'As automações estão indisponíveis neste ambiente de momento.',
  'This automation changed in another session. Refresh and try again.': 'Esta automação mudou noutra sessão. Atualize e tente novamente.',
  'You have reached the maximum number of automations.': 'Atingiu o número máximo de automações.',
  'FloFi has no BTC swap route yet. You can watch BTC and get alerts, but FloFi cannot prepare a BTC purchase.': 'O FloFi ainda não tem rota de troca para BTC. Pode observar o BTC e receber alertas, mas o FloFi não consegue preparar uma compra de BTC.',
  'FloFi cannot execute this action with your wallet yet.': 'O FloFi ainda não consegue executar esta ação com a sua carteira.',
  'Real-funds automations are disabled on this deployment.': 'As automações com fundos reais estão desativadas neste ambiente.', 'This action is not enabled on this deployment.': 'Esta ação não está ativa neste ambiente.',
  'The amount is above your maximum per execution.': 'O montante está acima do seu máximo por execução.', 'The slippage is above your maximum slippage.': 'O desvio está acima do seu desvio máximo.',
  'This would exceed your maximum amount for the period.': 'Isto excederia o seu montante máximo para o período.', 'This would exceed your maximum number of proposals for the period.': 'Isto excederia o seu número máximo de propostas para o período.',
  'FloFi cannot observe this asset’s price on this deployment.': 'O FloFi não consegue observar o preço deste ativo neste ambiente.', 'Check the fields and try again.': 'Verifique os campos e tente novamente.',
  'Check the schedule and the time zone.': 'Verifique o agendamento e o fuso horário.', 'Check the price condition.': 'Verifique a condição de preço.', 'Enter an amount above zero.': 'Indique um montante acima de zero.',
  'The expiry must be in the future (at most two years).': 'A expiração tem de ser no futuro (no máximo dois anos).', 'Use 1–80 characters for the name.': 'Use 1–80 caracteres no nome.',
  'Only a saved workflow with exactly one Base Sepolia or Ethereum Sepolia swap can be automated.': 'Só um fluxo guardado com exatamente uma troca na Base Sepolia ou na Ethereum Sepolia pode ser automatizado.',
  'The saved workflow changed. Rebind the automation before reviewing.': 'O fluxo guardado mudou. Volte a associar a automação antes de rever.', 'Resume the automation first.': 'Retome primeiro a automação.',
  'This proposal has expired.': 'Esta proposta expirou.', 'This proposal was dismissed.': 'Esta proposta foi recusada.', 'This proposal is no longer reproducible.': 'Esta proposta já não é reproduzível.',
  'You already added this proposal to your workflow.': 'Já adicionou esta proposta ao seu fluxo.', 'This proposal changed. Refresh and try again.': 'Esta proposta mudou. Atualize e tente novamente.',
  'The action must trade the asset the condition watches.': 'A ação tem de negociar o ativo que a condição observa.', 'Too many reviews opened recently. Try again later.': 'Demasiadas revisões abertas recentemente. Tente mais tarde.',
  'Too many open reviews for this automation. Finish or dismiss one first.': 'Demasiadas revisões abertas para esta automação. Conclua ou recuse uma primeiro.',
  'This network needs a wallet of another kind than the one you proved. Only your own wallet can approve its proposals.':
    'Esta rede precisa de uma carteira de outro tipo do que a que verificou. Só a sua própria carteira pode aprovar as propostas.',
  'Too many codes requested. Try again later.': 'Demasiados códigos pedidos. Tente mais tarde.', 'Telegram notifications are not available on this deployment.': 'As notificações do Telegram não estão disponíveis neste ambiente.',
  // /approve
  'Open this proposal from FloFi Automations': 'Abra esta proposta nas Automações do FloFi',
  'Getting the proposal your automation prepared…': 'A obter a proposta preparada pela sua automação…',
  'Open the proposal again from FloFi → Automations: FloFi prepares a fresh approval each time you open it.': 'Abra de novo a proposta em FloFi → Automações: o FloFi prepara uma nova aprovação sempre que a abre.',
  'Open the proposal again from FloFi → Automations if it is still waiting for you.': 'Abra de novo a proposta em FloFi → Automações se ainda estiver à sua espera.',
  'Closing this page grants no transaction authority. While the proposal is still waiting for you, open it again from FloFi → Automations.':
    'Fechar esta página não concede autoridade para nenhuma transação. Enquanto a proposta estiver à sua espera, abra-a de novo em FloFi → Automações.',
  'Prepared by your FloFi automation from a schedule or price condition you configured. It is not financial advice; you decide, and only your wallet can sign.':
    'Preparada pela sua automação do FloFi a partir de um agendamento ou de uma condição de preço que configurou. Não é aconselhamento financeiro; decide você, e só a sua carteira pode assinar.',
};
