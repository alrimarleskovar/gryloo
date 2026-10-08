# Card and payment providers: Mercado Pago and Woovi

FloFi talks to providers only through its own abstractions. A provider is enabled purely by deployment configuration; there is
no provider setting in the product. Never paste a key into chat, an issue or a commit: set it in the Vercel project (or your
local shell) only. Variable reference: [ENVIRONMENT.md §5d](ENVIRONMENT.md).

```
FloFi
├── WalletProvider   EIP-6963 / EIP-1193 (EVM), Wallet Standard (Solana)
├── CardProvider     MercadoPagoCardProvider   apps/reference-dapp/src/server/mercado-pago-card-provider.ts
└── PaymentAdapter   WooviPixPaymentAdapter    apps/reference-dapp/src/server/woovi-pix-adapter.ts
```

Test and production never mix. A Production deployment (`VERCEL_ENV=production`) accepts only production credentials.
Previews, `vercel dev` and local servers accept only test/sandbox credentials. Any other combination leaves the provider
disabled.

## Mercado Pago: Credentials → Add card

**What it does.** Add card opens Mercado Pago's Secure Fields (MercadoPago.js v2, loaded from `https://sdk.mercadopago.com/js/v2`)
inside FloFi's existing dialog:
1. The card number, expiry and security code are typed into Mercado Pago's own iframes (`secure-fields.mercadopago.com`).
2. `createCardToken` returns a one-time token.
3. FloFi's server saves that token to a Mercado Pago customer: `POST /v1/customers` (keyed by the email the user enters), then
   `POST /v1/customers/{id}/cards`.

Adding a card does not charge it, and FloFi has no payment call.

**Credentials.** In Mercado Pago Developers → *Your integrations* → your application → *Test credentials* (and later *Production
credentials*), copy the **Public key** and the **Access token**. Test credentials may start with `TEST-` or, for the test-user
model, `APP_USR-`.

| Variable | Preview / local | Production |
| --- | --- | --- |
| `MERCADO_PAGO_ENVIRONMENT` | `test` | `production` |
| `MERCADO_PAGO_PUBLIC_KEY` | test public key | production public key |
| `MERCADO_PAGO_ACCESS_TOKEN` (secret, server only) | test access token | production access token |

**Testing without money.** Use Mercado Pago's published test cards (for example Visa `4235 6477 2802 5682`, any future expiry,
CVV `123`, name `APRO`, CPF `12345678909`). In test mode Mercado Pago only accepts customer emails of the form
`test_payer_<digits>@testuser.com`.

**What FloFi stores.** Only in the browser's Credentials store, per saved card:
- the provider (`mercado_pago`), the Mercado Pago customer id and saved-card id, and the payment method;
- the brand, last four digits and expiry month/year;
- a display name and timestamps;
- a server-sealed binding (HMAC over provider, environment, deployment tenant, customer id and card id).

The binding is what lets that browser remove the card at Mercado Pago later.

FloFi never receives or stores:
- the card number, BIN or security code;
- the cardholder's name or document;
- the email;
- the access token.

Any provider response that carries a card number or a security-code value is rejected and nothing is saved.

**Removal.** *Remove* deletes the saved-card reference at Mercado Pago (`DELETE /v1/customers/{id}/cards/{card}`) and FloFi's
copy. The card itself is unaffected.

**CSP.** The app's `connect-src` allows `api.mercadopago.com`, `api-static.mercadopago.com` and `secure-fields.mercadopago.com`.
Mercado Pago's optional device-profiling call to `www.mercadolibre.com` stays blocked; tokenizing a card does not need it.

## Woovi: stablecoin → Pix PaymentAdapter

**What it does.** It implements FloFi's canonical payment lifecycle with Woovi's Stablecoin payout (off-ramp) API, from the
official OpenAPI document at `https://api.woovi.com/api/openapi.json`. Every channel (FloFi, MCP clients, WhatsApp, agents)
authors the same canonical payment and ends at FloFi Review; none of them can authorize, sign or pay.

| Step | Woovi call |
| --- | --- |
| Discover sources | `GET /api/v1/stablecoin/wallets` (deposit address per currency/network) |
| Quote | `GET /api/v1/stablecoin/payout/quote?value=<BRL cents>&currency=USDC` |
| Instruct | none: the owner signs a USDC transfer to the account's deposit address in FloFi's wallet flow |
| Pay out (after FloFi verifies that transfer on-chain) | `POST /api/v1/stablecoin/payout` (PENDING, idempotent by `correlationId`), then `POST …/payout/approve` |
| Reconcile | `GET /api/v1/stablecoin/payout?correlationId=…`; webhooks (`x-webhook-signature`, RSA-SHA256, keys at `GET /api/v1/webhook/public-keys`) are only a hint to re-read |

**What is supported, exactly:**
- **Destination:** a Pix key. Woovi's payout API takes `pixKey` and has no BR Code input, so a Pix Copia e Cola is refused.
- **Source:** USDC on Base, and only when Woovi lists a USDC/BASE deposit address for the account. Woovi also lists USDT, USDC
  and BRLA on other networks; FloFi does not map them because it cannot sign or verify those networks today.
- **Quote:** BRL is the fixed side. FloFi acts on a quote for 60 s at most (Woovi publishes no payout-quote validity) and
  re-quotes before paying out.
- **Price movement:** if Woovi would now debit more USDC than the owner sent, the payout is not made and the payment needs
  recovery.
- **Fees:** Woovi's fee is debited separately in BRL from the operator's Woovi account. A quote whose Woovi fee is unpriced is
  refused.
- **Settlement:** a payment is `PAYMENT_SETTLED` only when Woovi reports `COMPLETED` with a Pix end-to-end id for the exact
  amount. Source confirmation is never settlement.
- **Failures after funds moved:** `FAILED` or returned payouts become `RECOVERY_REQUIRED` (the owner's funds sit in the
  operator's float), and unreachable or ambiguous states stay `UNKNOWN`.

**Credentials and account prerequisites (on the operator's Woovi account, not in FloFi):**
1. Sandbox: register at `https://app.woovi-sandbox.com/` (sandbox accounts are separate from production). Production:
   `https://app.woovi.com`.
2. A stablecoin subaccount with KYB **CONFIRMED**. KYB is started through Woovi support.
3. An App (API/Plugins → new application) with the scopes `STABLECOIN_PAYOUT_CREATE` and `STABLECOIN_SUBACCOUNT_LIST`. Its App
   ID is the credential.
4. Available OUT limit, and INTERNAL float funded at the addresses returned by `/stablecoin/wallets`.
5. For webhook-driven reconciliation, webhooks for `STABLECOIN_PAYOUT_COMPLETED`, `_FAILED`, `_REFUND_CONFIRMED` and
   `_REFUND_FAILED`, pointed at `https://<deployment>/api/payments/woovi/webhook`. FloFi verifies each signature against
   Woovi's published keys before anything else and then only re-reads the payout; workers polling the same API remain the
   authoritative path. A deployment that forwards to a separate API (`API_BASE_URL`) acknowledges with 202 and leaves
   reconciliation to that API's workers.

| Variable | Preview / local | Production |
| --- | --- | --- |
| `WOOVI_ENVIRONMENT` | `sandbox` (API `https://api.woovi-sandbox.com`) | `production` (API `https://api.woovi.com`) |
| `WOOVI_APP_ID` (secret, server only) | sandbox App ID | production App ID |
| `GRYLOO_PAYMENT` | `live` (quote, Simulate, Review) | `live` |
| `GRYLOO_PAYMENT_OWNER_EXECUTION` | not honored | `MAINNET_OWNER_APPROVED` to allow the owner-signed transfer |

**Runtime.** The flow is `pix-payment` (`src/server/payment-flow-service.ts`), exposed through the owner-bound server action
`src/app/payment-action.ts` and the cloud flow registry, like every other owner-signed flow:
`simulate` (draft + Woovi quote + the commitment to review) → `review` (the owner accepts that commitment) → `begin` (the
unsigned USDC transfer to Woovi's deposit address) → `handoff` → `report` (the wallet's transaction hash) → `observe` (verifies
the transfer on Base, from the owner, to the deposit address, for the exact amount, with 3 confirmations; only then creates and
approves the payout; then reconciles) → Evidence on settlement. A run belongs to the wallet session that simulated it.

**Sandbox never executes.** A Woovi sandbox account still lists deposit addresses for USDC on Base mainnet, so a sandbox
deployment can quote, simulate and record a Review but can never `begin`: the source transfer would be real USDC.
`GRYLOO_PAYMENT_OWNER_EXECUTION` is honored only with `WOOVI_ENVIRONMENT=production` (and therefore only on a Production
deployment). There is no product screen for payments in this build; the flow is invoked by FloFi's runtime and future surfaces.

Woovi documents its stablecoin endpoints for production. Whether the sandbox offers the stablecoin subaccount, wallets and
payouts is not published: confirm it with Woovi before relying on sandbox acceptance.
