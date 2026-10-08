// SPDX-License-Identifier: AGPL-3.0-only
/** Canonical wallet selector, Credentials (wallets, cards, payment connections) and wallet-provider messages. */
export const portugueseWallets: Readonly<Record<string, string>> = {
  // Wallet selector
  'Connect a wallet': 'Ligar uma carteira', 'Add a wallet': 'Adicionar uma carteira',
  'Choose a wallet to prove ownership': 'Escolha uma carteira para verificar a titularidade',
  'Choose a Solana wallet to prove ownership': 'Escolha uma carteira Solana para verificar a titularidade',
  'Close wallet selector': 'Fechar seletor de carteiras',
  'FloFi opens only the wallet you choose. Connecting shares your public address; it never approves a transaction.':
    'O FloFi abre apenas a carteira que escolher. Ligar partilha o seu endereço público; nunca aprova uma transação.',
  'Detected': 'Detetada', 'Last used': 'Usada recentemente', 'Other wallets': 'Outras carteiras', 'Not detected': 'Não detetada',
  '{0} on {1}': '{0} em {1}', '{0} on {1}, not detected': '{0} em {1}, não detetada',
  'No wallet detected in this browser. Install or enable a wallet extension, then refresh.':
    'Nenhuma carteira detetada neste navegador. Instale ou ative uma extensão de carteira e atualize a página.',
  'No compatible wallet. Enable MetaMask or Rabby for this site and refresh; Brave Wallet cannot be used.':
    'Nenhuma carteira compatível. Ative o MetaMask ou o Rabby para este site e atualize a página; a Brave Wallet não pode ser usada.',
  'That wallet is no longer available. Refresh the page and choose it again.': 'Essa carteira já não está disponível. Atualize a página e escolha-a novamente.',
  'Could not connect your Solana wallet. Check your wallet and try again.': 'Não foi possível ligar a sua carteira Solana. Verifique a carteira e tente novamente.',
  'Solana wallet not connected': 'Carteira Solana não ligada',
  'Connect Solana wallet and prove ownership': 'Ligar carteira Solana e verificar titularidade',
  // Credentials: wallets
  'Keep the wallets and cards you use with FloFi in one place. Saved credentials are references only: they never approve a transaction or a payment.':
    'Mantenha num só lugar as carteiras e os cartões que usa com o FloFi. As credenciais guardadas são apenas referências: nunca aprovam uma transação ou um pagamento.',
  'No wallets yet': 'Ainda sem carteiras', 'Add a wallet to save its public address here. FloFi never holds your keys.':
    'Adicione uma carteira para guardar aqui o seu endereço público. O FloFi nunca guarda as suas chaves.',
  'Active': 'Ativa', 'Connected · not saved': 'Ligada · não guardada', 'Saved': 'Guardada',
  'Copy {0} address': 'Copiar endereço de {0}', 'Address copied.': 'Endereço copiado.', 'Address could not be copied.': 'Não foi possível copiar o endereço.',
  'Wallet name': 'Nome da carteira', 'Save name': 'Guardar nome', 'Wallet renamed.': 'Carteira renomeada.', 'Use 1–{0} characters.': 'Use 1–{0} caracteres.',
  'Rename': 'Renomear', 'Rename {0}': 'Renomear {0}', 'Save {0}': 'Guardar {0}', 'Disconnect': 'Desligar', 'Disconnect {0}': 'Desligar {0}',
  'Connect': 'Ligar', 'Connect {0}': 'Ligar {0}', 'Remove': 'Remover', 'Remove {0}': 'Remover {0}', 'Remove {0} from FloFi?': 'Remover {0} do FloFi?',
  'This also disconnects it.': 'Isto também a desliga.',
  "Only FloFi's reference is removed; the wallet and its assets are not affected.": 'Só a referência do FloFi é removida; a carteira e os seus ativos não são afetados.',
  '{0} removed from FloFi. Your wallet and its funds are unchanged.': '{0} removida do FloFi. A sua carteira e os seus fundos não foram alterados.',
  '{0} saved to Credentials.': '{0} guardada nas Credenciais.', 'This wallet could not be saved.': 'Não foi possível guardar esta carteira.',
  '{0} disconnected.': '{0} desligada.', "{0} isn't detected in this browser.": '{0} não foi detetada neste navegador.', '{0} did not connect.': '{0} não ligou.',
  '{0} connected {1}, not this saved wallet. Choose {2} in {3} to use it.': '{0} ligou {1}, não esta carteira guardada. Escolha {2} em {3} para a usar.',
  // Credentials: cards and payment connections
  'Cards': 'Cartões', 'Add card': 'Adicionar cartão', 'Add a card': 'Adicionar um cartão', 'No cards yet': 'Ainda sem cartões',
  "Cards are added through a certified card provider's secure entry. FloFi never sees or stores your card number or security code.":
    'Os cartões são adicionados através da entrada segura de um fornecedor de cartões certificado. O FloFi nunca vê nem guarda o número do cartão ou o código de segurança.',
  'Payment connections': 'Ligações de pagamento', 'No payment provider connected': 'Nenhum fornecedor de pagamentos ligado',
  'Pix and boleto payments need a connected payment provider. None is connected yet.': 'Os pagamentos Pix e boleto precisam de um fornecedor de pagamentos ligado. Ainda não há nenhum ligado.',
  '· Expires {0}': '· Expira {0}', 'Remove this card from FloFi? The card itself is not affected.': 'Remover este cartão do FloFi? O cartão em si não é afetado.',
  'This card could not be removed right now. Try again.': 'Não foi possível remover este cartão agora. Tente novamente.', 'Card removed from FloFi.': 'Cartão removido do FloFi.',
  '{0} added to Credentials.': '{0} adicionado às Credenciais.', 'Card': 'Cartão',
  'Card number': 'Número do cartão', 'Expiry': 'Validade', 'Security code': 'Código de segurança', 'Name on card': 'Nome no cartão', 'Document': 'Documento',
  'Number': 'Número', 'Email': 'Email', 'Adding…': 'A adicionar…', 'Close': 'Fechar',
  "Card details are entered in {0}'s secure fields. FloFi receives only a token, the brand, the last four digits and the expiry date.":
    'Os dados do cartão são introduzidos nos campos seguros de {0}. O FloFi recebe apenas um token, a marca, os últimos quatro dígitos e a validade.',
  'Fill in every field.': 'Preencha todos os campos.', 'Check the card details and try again.': 'Verifique os dados do cartão e tente novamente.',
  'The card could not be added. Nothing was saved.': 'Não foi possível adicionar o cartão. Nada foi guardado.',
  'Enter a valid email address.': 'Introduza um endereço de email válido.', 'This email already has the maximum number of saved cards.': 'Este email já tem o número máximo de cartões guardados.',
  'The card could not be saved. Check the details and try again.': 'Não foi possível guardar o cartão. Verifique os dados e tente novamente.',
  'Secure card entry could not be loaded. Nothing was collected. Try again later.': 'Não foi possível carregar a entrada segura do cartão. Nada foi recolhido. Tente mais tarde.',
  'Card entry status could not be checked. Nothing was collected. Try again later.': 'Não foi possível verificar o estado da entrada de cartões. Nada foi recolhido. Tente mais tarde.',
  'Checking secure card entry…': 'A verificar a entrada segura de cartões…', "Secure card entry isn't available yet.": 'A entrada segura de cartões ainda não está disponível.',
  "FloFi never asks for your card number or security code in its own forms. Cards are added only through a certified card provider's secure entry, and no card provider is connected to FloFi yet.":
    'O FloFi nunca pede o número do cartão ou o código de segurança nos seus próprios formulários. Os cartões só são adicionados através da entrada segura de um fornecedor certificado, e ainda não há nenhum fornecedor de cartões ligado ao FloFi.',
};
