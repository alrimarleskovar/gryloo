# Universal signing: capability matrix and owner E2E

This build's automated hosts/providers/wallets are fixtures. A PostgreSQL integration run can demonstrate the existing financial lifecycle with synthetic signatures/receipts; it is not a real ChatGPT, Claude, WhatsApp, Telegram, MetaMask or Phantom acceptance. Browser harnesses intentionally reject MOCKED financial authorization.

## Capability and evidence matrix

| Initiation surface / wallet path | Implemented path | Automated evidence | Live behavior verified in this BUILD | Remaining dependency |
| --- | --- | --- | --- | --- |
| ChatGPT MCP | OAuth → request_user_approval → MCP App → external FloFi window; account-authenticated nonsecret fallback | MCP protocol/PostgreSQL tests and named ChatGPT host fixture; actual browser proof/simulation/Review safety gates | No | Owner's deployed MCP connector, supported host App/link features, OAuth setup and real wallet |
| Claude MCP | Same shared MCP tool/App/window contract and fallback | Same tests plus named Claude host fixture | No | Owner's deployed Claude MCP connection, host App/link features, OAuth and real wallet |
| Telegram Bot API | Authentic webhook → Channel Core → Open FloFi button → same /approve; consented ping/dispatch status | Signed webhook/Bot API double, durable dedupe/dispatch, guarded browser journey | No | Bot token, webhook secret, user allowlist, reachable HTTPS deployment and scheduler |
| WhatsApp Cloud API | HMAC webhook → Channel Core → CTA URL → same /approve; delivery/window/template controls | Meta-shaped fixture transport/webhooks, PostgreSQL lifecycle and guarded browser journey | No; activation remains blocked | Existing policy-clearance code gate, owner-approved provider clearance, WABA/number, tokens/app secret, webhook/template |
| MetaMask desktop extension | Existing EIP-1193 selector; SIWE; existing exact transaction signing | Injected test wallet in guarded browser | No | Owner extension/version and supported network |
| MetaMask mobile | Fragment-only app link, or copy full approval link inside wallet browser | Link grammar/privacy assertions only; injected-wallet browser tests | No | Real iOS/Android wallet/browser preserves target fragment and injects provider |
| Phantom desktop | Existing Wallet Standard/Solana selector, SIWS and signing | Solana injected fixture in MCP browser suite | No | Owner extension/version, supported network/features |
| Phantom mobile | Open public wallet-browser landing page; paste private approval link inside it | Documented URL contract and privacy tests; Solana fixture | No | Real Phantom app/browser, Wallet Standard/signMessage support and selected network |
| In-frame signing | Disabled; opt-in environment probe only | No account request/sign/send in panel resource | No | Separate host security and live compatibility verification before enabling |
| WalletConnect/Reown | Deferred | No new SDK/session/relay | No | A verified unsupported owner-device requirement, plus boundary/dependency review |

All live cells are deliberately **No** for this build. Prior-build live evidence remains in its original reports and is not reassigned to this implementation.

## Shared deployment and safety prerequisites

Use an isolated Preview and test funds on supported public testnets. Install/migrate the existing platform schema before serving: `DATABASE_URL` and the existing platform-state configuration from [ENVIRONMENT.md](ENVIRONMENT.md). With remote financial flows, `API_BASE_URL`/`API_AUTH_TOKEN` select the existing remote engine while PostgreSQL hosts platform/channel state independently. Do not enable mainnet networks for this test. Set the existing session/origin/OAuth/channel secrets as Sensitive environment settings; never put them in conversation or evidence.

Configure only the testnet flow being used (for example the existing Base Sepolia → Arbitrum Sepolia router live deployment and provider RPC/route prerequisites). Use a small amount of test USDC plus test gas. No real funds, standing delegation or autonomous execution. Start with a desktop wallet; separately record actual mobile OS, wallet version and source host. Private approval URLs and proof signatures must be redacted from screenshots, transcripts and issues.

Shared owner sequence:

1. Ask for `bridge 1 USDC from Base Sepolia to Arbitrum Sepolia via auto slippage 50 bps`. Inspect the proposal and its network/test-funds label.
2. Open FloFi. Check its origin and the external requester's name, steps, workflow hash and **Nothing is authorized yet**. Choose whether to share run status; sharing is off for messaging channels by default.
3. Prove wallet ownership with a sign-in message. Reject a first proof prompt as a negative check, then retry. This step must create no transaction.
4. Click **Load proposal** once. Confirm **Ready for your review**. Click **Continue to simulation** and obtain a fresh testnet simulation.
5. Read the Strategy Manifest: owner, chain, recipient, amount, spend limits, exact approvals/calls, validity/deadlines and fees. Use FloFi's explicit **Approve & Continue**, then **Execute workflow**. Review and sign each transaction in your wallet.
6. Follow the existing run through reconciliation. If a submission response is lost, reopen **Your runs** and observe/reconcile that same attempt. Never start a new execution to recover an unknown submission. A missing chat notification says nothing about execution success.
7. With sharing enabled, confirm the original conversation receives the loaded/progress/reconciled state and evidence environment/bundle hash. Without sharing, it must not receive run details. Reject optimistic success without reconciliation.

## ChatGPT

Follow [MCP deployment/OAuth setup](MCP.md). Connect the Preview MCP endpoint in the owner's ChatGPT account through its supported connector flow. Ask it to compose, validate/review and invoke `request_user_approval` with the returned strategy and workflowHash. If the MCP App is available, use **Review with your wallet in FloFi**. If App support or link opening is refused, use the universal reference in the same browser that completed FloFi OAuth. The model receives no capability. For another browser or mobile app, use the panel's private wallet link, or open the reference in the authenticated browser first and then use `/approve`'s wallet controls.

Perform the shared sequence. Confirm the panel reports public execution/evidence facts back to this conversation. If a host does not implement `ui/update-model-context`, ask the assistant for `get_approval_status`; lack of App features is a host limitation, not signing authority. Record the actual ChatGPT client, App rendering, external opening/refusal, fallback and status behavior. Embedded signing is not part of acceptance.

## Claude

Follow the same [MCP setup](MCP.md) with the owner's Claude client and FloFi OAuth account. Compose the testnet strategy, request approval and use the same panel/window/fallback sequence. Verify request/account isolation by opening the nonsecret reference in a fresh browser: it must require the creating account. Complete the shared sequence and check the status in the original Claude conversation. Record the actual Claude client/version and supported App features separately; the named Claude test fixture proves only FloFi's protocol contract.

## Telegram

Follow [the existing Telegram owner runbook](CHANNELS-OWNER-E2E.md) for bot creation, webhook registration, user allowlist, privacy/support settings, scheduler and reachable Preview. It remains authoritative for provider setup; replace its former **Load proposal → Add to my workflow** steps with this build's single **Load proposal** and **Continue to simulation**. Channels may now host state on the shared PostgreSQL platform host alongside a remote financial runtime.

Send the shared test strategy to the bot, tap **Open FloFi**, then perform the shared owner sequence. Send `yes, execute it` and duplicate the incoming callback as negative checks: neither can move funds. Test `LINK` replacing the old request, `STATUS`, sharing off/on and `STOP` revoking the pending journey. Record real inbound webhook and bot messages, testnet explorer links and reconciled evidence, with the approval secret redacted. If the browser is closed, invoke the configured authenticated dispatch/scheduler to obtain the final status.

## WhatsApp

**Live E2E is blocked by the existing activation policy guard.** Do not change provider mode, bypass the guard or use Telegram credentials to simulate WhatsApp acceptance. Obtain the required owner-reviewed clearance and provider setup described in [WHATSAPP.md](WHATSAPP.md) and [CHANNELS-OWNER-E2E.md §9](CHANNELS-OWNER-E2E.md#9-whatsapp-what-would-be-needed). This BUILD preserves `WHATSAPP_POLICY_CLEARANCE`; it does not approve live use.

After that separate prerequisite is resolved, connect the signed webhook, allowed sender, WABA/number and approved template/window configuration. Send the shared test strategy, open its CTA into the same `/approve` journey and complete the shared sequence. Check delivered/read statuses, duplicate callbacks, opt-out, window expiry and scheduled terminal notification back to that same sender/conversation. Record actual Meta delivery and wallet/reconciliation evidence independently of fixture tests.

## Negative acceptance and completion record

Exercise cancellation before loading, expired link, withdrawn/replaced link, a different wallet/chain, edited workflow, rejected transaction signature, network interruption, duplicate callback and process/browser restart. Check that no transaction occurs without a fresh simulation, matching Manifest Review and valid explicit owner authority. Existing financial recovery must preserve uncertain attempts without automatic resubmission. For a consumed MCP session, reload with the claimant's existing proof: FloFi may restore the exact authoring proposal, but it must demand a new simulation/Review before a new execution. An unproved or different wallet must learn nothing from the public recovery id.

Attach a redacted record with date, deployment commit, actual channel/host version, OS/browser/wallet version, network, proposal hash, run id, explorer evidence, reconciliation outcome, bundle hash and observed original-conversation status. A fixture, rejected/mock execution or mere proof signature is insufficient to mark verified completion.

`READY_FOR_OWNER_REVIEW`: implementation and automated validation report are available. `READY_FOR_OWNER_E2E`: the specific channel's deployment/provider/host/wallet prerequisites are actually configured. `VERIFIED_COMPLETION`: owner-run live testnet execution, reconciliation and same-conversation status are evidenced. WhatsApp cannot reach owner E2E until its clearance dependency is resolved; no channel is declared live-verified by this BUILD.
