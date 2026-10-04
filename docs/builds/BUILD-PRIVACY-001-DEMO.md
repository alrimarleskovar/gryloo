# BUILD-PRIVACY-001 — demonstration and owner instructions

## Available demonstration: authoring and fail-closed feasibility

This draft demonstrates privacy as a policy on Flofi's existing swap IR. **It does not execute a financial swap.** No owner wallet, funding, deposit, message signature or transaction signature is needed for this demonstration.

Use Node 24.21.0 and pnpm 11.22.0 in the isolated `codex/build-privacy-001-cloak` worktree:

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build --cache-dir .turbo/privacy001-cache
pnpm --filter @defi-workflow-engine/reference-dapp start --port 3017
```

1. Open `http://127.0.0.1:3017` in a fresh browser session.
2. Enter **`swap 0.02 SOL to USDC privately`** in the existing Guided assistant.
3. Review the proposal. It names Cloak, **Privacy REQUIRED**, public USDC proceeds and private SOL change. Apply the proposal.
4. Inspect the existing Canvas and canonical artifact inspector: one `asset.swap.exact-input` node contains the required privacy capabilities and the pinned `cloak.solana` adapter.
5. Select **Simulate → Check privacy feasibility**. The result explicitly says **financial simulation not performed / acceptance blocked**.
6. Export the non-executed feasibility report. Its workflow hash binds the policy; `execution: NOT_EXECUTED` and `acceptance: BLOCKED` prevent confusion with financial acceptance evidence. It contains no private notes or keys.
7. Select **Execute**. Owner authorization is disabled and the missing execution gates are visible. No executable Manifest is issued.
8. In a fresh session, enter **`Swap 5 USDC to SOL privately`**. Flofi rejects the unsupported direction rather than converting it into a public swap.

Canvas alternative: use the existing Solana mainnet swap form, select **Privacy → Required / Cloak**, enter 0.02 SOL → USDC and review the proposal. Guided and Canvas produce the same canonical node and hash-covered policy. Changing an existing private node into a public node is refused; remove it and author a separate public workflow if that is the intended edit.

The automated browser demonstration is isolated from other builds and uses neither Anvil nor a wallet:

```sh
pnpm --filter @defi-workflow-engine/reference-dapp exec playwright test --config playwright.privacy.config.ts
```

Install Playwright's matching Chromium and OS libraries using your usual development setup if they are absent. The first test aborts any request to a non-loopback host and verifies none occurred.

## Exact privacy explanation for the current submission

> Flofi makes privacy a required property of its existing canonical workflow, rather than a separate application. For this Cloak integration, the supported target is shielded SOL input exchanged for public USDC, with remaining SOL change kept shielded. USDC proceeds and their recipient are public. Deposits, swap transactions, timing and network metadata remain observable; this is not a claim that the entire trade is invisible or that anonymity is guaranteed. Flofi refuses public fallback for a privacy-required workflow. Its adapter preserves actual Cloak note and refund authority in encrypted, run-linked browser checkpoints, and its reconciliation contract requires settlement plus verified, reloadable private change before success. The present draft demonstrates policy authoring, fail-closed feasibility and local SDK/state security tests. Funded execution, exact financial simulation and authoritative chain reconciliation are not yet integrated, so it provides no mainnet execution acceptance evidence.

This wording is accurate for this draft. Do not replace “not yet integrated” with an execution-success claim until real acceptance evidence exists. Do not publish note encodings, private keys, viewing keys, note salts, refund secrets, an unlocked vault or its passphrase. Encrypted backups also contain spending authority and are not challenge artifacts.

## Owner-only actions remaining

**Now:** no financial owner action can unblock this implementation. Do not fund or sign in an attempt to bypass the engineering gates in the report.

Separate owner-only repository/hosting follow-up remains: inspect GitHub **Billing & plans** for the failed-payment/spending-limit condition reported by [contract CI](https://github.com/alrimarleskovar/gryloo/actions/runs/37200420919) and [governance CI](https://github.com/alrimarleskovar/gryloo/actions/runs/37200420925), resolve the account condition personally, then rerun those checks. Open the [failed Vercel preview](https://vercel.com/alrimarleskovars-projects/flofi/Axy3vxeYHHCRSGCjJcBpoeMYVGdx) and inspect its build logs; the deployment error cause is unverified here. These actions do not resolve the financial execution engineering gates. The agent has not changed account billing, spending limits or deployment settings.

**Only after those gates are implemented and reviewed**, the owner must personally perform these actions:

1. Select a Solana mainnet wallet supporting `solana:signTransaction`, `solana:signMessage` and account-change events. Bind the exact owner and public USDC recipient in Review. Verify genesis `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` and Cloak program `zh1eLd6rSphLejbFfJEneUwzHRfMKxgzrgkfwA6qRkW`.
2. Choose and retain the owner-held vault unlock secret, grant persistent browser storage if supported, and retain a verified encrypted backup plus its recovery reference outside the browser. A wallet seed/private key is never needed by Flofi.
3. Fund the owner wallet with 0.03 SOL for the proposed shield plus the **freshly reviewed** network, protocol, relay and account-creation costs. These costs must be obtained from the deployed configuration and current quote; this document specifies no invented fee allowance or USDC minimum.
4. Review the exact shield payload and recovery preparation, then personally approve its wallet signature. Confirm and reload the actual deposited private note before proceeding.
5. Author `swap 0.02 SOL to USDC privately`. Review the actual input note commitments, 0.02 SOL gross spend, quoted minimum public USDC output, recipient ATA, fee caps, 0.01 SOL private change (when inputs total exactly 0.03 SOL), expiry and refund/recovery policy. Preparation must already be durably persisted and the exact financial simulation must pass.
6. Personally approve Cloak's required message authentication and any reviewed wallet authorization. Flofi must use the relay path; never silently switch to an unrevealed public or no-relay execution mode.
7. Wait for both required public stages and authoritative settlement. Reload the encrypted result in a new browser session, verify private change and retained refund authority, then export only redacted genuine evidence linked to the run/Manifest and journal.

Any account change, expired review, storage failure, missing recovery material, ambiguous submission or unverifiable result stops this path. Recover/reconcile the same attempt before considering another; never regenerate notes or retry blindly. The agent has not performed any of these owner financial actions.
