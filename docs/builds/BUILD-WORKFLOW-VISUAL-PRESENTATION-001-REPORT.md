# BUILD-WORKFLOW-VISUAL-PRESENTATION-001 — Report: one workflow visual for MCP, Telegram and WhatsApp

Date: 2026-10-11. Branch `codex/build-workflow-visual-presentation-001`, from `main` `c66b23a4cc9da4c35f64c667c4be94888c36dace`.
Plan: [BUILD-WORKFLOW-VISUAL-PRESENTATION-001-PLAN.md](BUILD-WORKFLOW-VISUAL-PRESENTATION-001-PLAN.md).

**Status: READY_FOR_OWNER_REVIEW.** All evidence is local: unit tests, loopback PostgreSQL, the Telegram Bot API double, the WhatsApp
FIXTURE transport and the mocked MCP Apps host. No live Telegram or WhatsApp message was sent, no MCP vendor host was used, no
production variable changed and no transaction of any kind occurred.

## 1. What changed for the user

| Surface | Before | Now |
| --- | --- | --- |
| MCP `request_user_approval` | JSON text + `structuredContent`; panel lists steps as `bridge (crosschain-router)` | same JSON first; then a readable summary with **Open in FloFi**, the workflow PNG as standard image content; the panel shows the workflow visual (accessible `role="img"`) |
| MCP `compose_strategy` | JSON text + `structuredContent` | same JSON first; then a readable summary; `structuredContent.visual` (no picture: see §4) |
| Telegram proposal | `sendMessage` text + Open FloFi button | one `sendPhoto`: the workflow PNG, the same text as caption, the same button |
| WhatsApp proposal | `cta_url` interactive text message | the same `cta_url` message with the workflow PNG as its image header |
| Fallback (any surface) | — | the previous text message, complete and unchanged |

Example (Portuguese, lending composition), as sent to a chat and painted in the panel:

```
FLOFI · FLUXO
Depositar → Pedir emprestado → Trocar
[Fundos de teste] [3 etapas] [Base Sepolia]
┌ 1  Depositar · Aave V3        10 USDC     Base Sepolia   Titular 0x0000…0001
│ ↓
├ 2  Pedir emprestado · Aave V3  2 USDC     Base Sepolia
│ ↓
└ 3  Trocar · Uniswap v3        2 USDC → WETH   Base Sepolia   Desvio máximo 0.5%
[A dívida continua após a troca]
Revise e assine no FloFi · nada está autorizado ainda
Fluxo 0x52a2…571c
```

## 2. Architecture and the exact renderer boundary

```
composeWorkflowOrRefuse (canonical IR + semanticWorkflowHash; v2: sequence hash)       ← authoritative, unchanged
   │ workflowVisualModel(composition)          src/platform/workflow-visual.ts         pure projection, frozen, no I/O
   ▼
WorkflowVisualModel (language-neutral facts + workflowHash reference)
   │ workflowVisualLayout(model, 'EN'|'PT', scale)   src/platform/workflow-visual-layout.ts   pure, deterministic, fixed size
   ▼
VisualLayout { tree: HTML/CSS element tree, width, height, title, summary, alt }
   ├── MCP App panel (src/mcp/app/panel.ts): paints `tree` as DOM — text via textContent, allowlisted style keys/values only
   └── workflowVisualPng(model, language)        src/server/workflow-visual-image.ts      next/og (Satori + resvg/sharp), PNG 1080 px
          ├── MCP: ImageContent (request_user_approval)
          └── Channel Core → ChannelImage { image/png bytes, alt } → Telegram sendPhoto | WhatsApp /media + image header
```

- **One projection, one layout, one rasterizer.** Adapters never lay anything out; the panel never computes a layout. Channels reach the
  rasterizer only through `src/channels/visuals.ts`, injected into Channel Core by the wiring (`http.ts`, `dispatch-http.ts`).
- **Smallest supported implementation.** `next/og` ships with the pinned `next@16.3.8` (Satori layout, resvg-wasm or the already-locked
  optional `sharp` for PNG encoding, bundled Geist font). No dependency, lockfile, service or storage was added. It is imported as
  `next/og.js` so that Next's bundler, Vitest and plain Node ESM (the browser suite's processes) all resolve it.
- **Platform purity kept.** The platform modules import only the engine and domain; the platform boundary test is unchanged. Only
  `src/server/workflow-visual-image.ts` imports `next/og.js`.
- **Phone-first layout.** Base width 480 px (scaled ×2.25 to a 1080 px PNG). A chat bubble (~330 pt) shows it at about two thirds, so
  secondary text stays near 10 pt. Every line has a fixed height (the PNG's size is known before rendering); titles and amounts step
  down in size before anything is clipped; long lists (> 4 steps) use compact cards. The panel scales the same tree to its frame.
- **Offline by construction.** Every string is limited to glyphs the bundled font covers (a test parses the font's `cmap`), so Satori
  never fetches a fallback font or emoji; a fetch trap proves rendering makes no request.

## 3. The shared visual model

`WorkflowVisualModel` v1: `workflowHash` (reference to the canonical hash), `fundsClass`, ordered `networks`, `chains`, `steps[]`,
`connections[]`, `warnings[]`. A step: `id`, `index`, `action`, `provider`, `chain`, `network`, `toNetwork`, `amounts` (exact decimal
strings from the IR), `amountKind` (`EXACT` | `MAXIMUM`), `toAsset`, `slippageBps`, `range`, `account` (shortened, or the connected
wallet), `testFunds`. Title, summary and alt text are derived per language. Connections are the IR's own dependency edges inside a
workflow and the order of a v2 step list; warnings are `REAL_FUNDS`, `DEBT_REMAINS` (the lending composition's review warning) and
`SEQUENCE_NOT_EXECUTABLE` (v2 lists, which have no sequential runner yet).

Supported representation (every engine example and the IR-level transfer are tested):

| Family | Source in the IR | Shown |
| --- | --- | --- |
| Swap (EVM) | `EVM_SWAP` | `1 USDC → WETH`, Uniswap v3, network, max slippage |
| Swap (Solana) | `SOLANA_SWAP` | `1 USDC → SOL`, Jupiter / Orca Whirlpools, Solana / Solana Devnet |
| Bridge | `ROUTER` | `5 USDC`, `Base Sepolia → Arbitrum Sepolia`, LI.FI / Across (or the routing named), recipient or "your connected wallet" |
| Supply / Borrow / Repay | `AAVE` | amount and asset, Aave V3, network, "on behalf of 0x1234…abcd" |
| Withdraw | `AAVE_WITHDRAW` | amount and asset, Aave V3, "to your connected wallet" |
| Liquidity | `UNISWAP_LIQUIDITY`, `ORCA_LIQUIDITY` | "Up to 10 USDC + 0.005 WETH" (limits, not spends), price range, max slippage |
| Lending composition | `LENDING_COMPOSITION` | three linked steps (supply → borrow → swap) with "debt remains after the swap" |
| Transfer | native-transfer node (`transferDetails`) | `0.000001 ETH`, network, "to your connected wallet" (Canvas-authored IR; no StrategySpec action exists) |
| Step lists (v2) | one composition per step | ordered, linked, EVM + Solana together, "cannot run as one workflow yet" |
| Anything else | `OTHER` | generic step with the IR's network and protocol, no amounts — never guessed |

Never in the model: approval links or secrets, sessions, OAuth tokens, capabilities, calldata, full addresses, provider ids. Never
invented: minimum received, fees, quotes (not in the canonical IR; FloFi's fresh simulation and Strategy Manifest show them).

## 4. MCP behaviour

- `content[0]` is still `JSON.stringify(structuredContent)`; every existing `structuredContent` field is unchanged (all existing MCP
  unit, PostgreSQL and browser tests pass unmodified, except the platform-parity test noted in §9). `structuredContent.visual` is new.
- `request_user_approval` adds `content[1]` (summary + `Open in FloFi: <origin>/approve#apr_…`, the public link that was already in
  the JSON), `content[2]` (`image/png`, `annotations.audience: ["user"]`) and `_meta['flofi/visual']` (the layout tree for the panel).
  The secret link stays only in `_meta['flofi/approval']`, as before.
- `compose_strategy` adds the summary and `structuredContent.visual`, but **no picture**: a model may compose many times while
  iterating, and an image in each result would cost it context. The approval is the moment the person is asked to act.
- Refusals are unchanged (one JSON text block, no visual).
- Hosts differ: some show image content to the user, some only to the model, some ignore it; the summary and the JSON keep every host
  working. `audience` is advisory.

## 5. Telegram behaviour

`sendPhoto` (multipart: `chat_id`, `caption` = the reply's whole text, `reply_markup` = the same keyboard, `photo` = the PNG bytes),
plain text, no `parse_mode`. Fallbacks to the existing `sendMessage`: no picture (renderer absent or failed, visual refused by the
output guard), a caption over 1024 characters (never clipped), or a photo Telegram rejects (400 other than "chat not found", 413) — in
the same attempt. Unchanged classes, never resent as text: 429 (after `retry_after`), 5xx (retried by Channel Core), 403/401/404,
"chat not found", timeouts and lost connections (UNCERTAIN: never resent). Retries, ordering, deduplication, opt-in/opt-out, the
outbox and attempt counting are Channel Core's, unchanged (one adapter send = one attempt, as before).

## 6. WhatsApp behaviour

Inside the 24-hour window: upload the PNG to the Cloud API media store (`POST /<version>/<phone number id>/media`, multipart bytes,
the token only in the `Authorization` header), then the same `cta_url` (or button) message with `header: { type: 'image', image: { id } }`.
A failed or malformed upload, or Meta rejecting the pictured message as an invalid request (`PROVIDER_REJECTED`), sends the existing
text message in the same attempt. Window closed, policy, throttling, unavailability and uncertain outcomes keep their classes and
`biz_opaque_callback_data` correlation. Outside the window: the template path, no upload, no picture. The live provider remains behind
`WHATSAPP_POLICY_CLEARANCE` (unchanged, null); everything here ran on the FIXTURE transport, which records uploads in memory.

## 7. Channel Core

`ChannelReply.visual?: { model, language }` (provider-neutral) is attached to the proposal reply (PROPOSE and LINK), sealed with the
body (≤ 12 KiB, else dropped — never the text); the approval link is still attached only in memory. At send time, delivery renders it
once (only when the free-form window is open and the output guard accepts every visual string) and passes
`SendContext.image = { mimeType: 'image/png', bytes, alt }`. No renderer, a failure or a refused visual → text only. The proposal's
visual is `workflowVisualModel` of the very composition the handoff stores (same hash; tested for every chat grammar capability).

## 8. Open in FloFi — workflow hash continuity

The picture is never the handoff. Proven end to end:

- **Channels** (`src/channels/visual.pg.test.ts`, PostgreSQL): picture rendered → the handoff behind the delivered link has
  `workflow_hash` = the picture's hash = the hash of `workflowVisualModel(composeWorkflowOrRefuse(stored strategy))` → the intended,
  proven wallet claims it (`workflowHash` and `semanticWorkflowHash(workflow)` equal) → `applyApproval` accepts exactly that workflow
  (APPLIED) → nothing executed. Same with the renderer failing (text proposal), on Telegram and WhatsApp, and in Portuguese.
- **Browser** (`whatsapp-approve.spec.ts`): the picture's hash equals the handoff's; the owner's **Load proposal** on `/approve` then
  applies it (the server refuses any other hash). `telegram-approve.spec.ts`: the real webhook route sends the photo; `/approve`,
  simulation and Review follow, with MOCKED authority still blocked.
- **MCP** (`src/mcp/visual.pg.test.ts`, `mcp-in-chat.spec.ts`): `structuredContent.visual.workflowHash` = `workflowHash`; the panel
  shows the visual and the full hash; the existing signing-window journey loads the same proposal; claims re-verify it; no stale Review
  authority is restored (unchanged `/approve` behaviour, re-run).

## 9. Tests and gates

New tests:

| File | Proves |
| --- | --- |
| `src/platform/workflow-visual.test.ts` | determinism; canonical workflow and hash untouched (frozen model); swap, bridge, lending, composition, liquidity, transfer, v2 EVM + Solana; EN/PT vocabulary; omitted metadata (no invented minimum/fee/quote, closed key set); no secret/link/full address; fixed size; long amounts; font-covered glyphs |
| `src/server/workflow-visual-image.test.ts` | identical PNG bytes per model and language, exact size, EN ≠ PT, no network (fetch trap), closed errors / null |
| `src/channels/core/visual.test.ts` | channel visual = canonical projection for every grammar capability; visual sealed, link never; oversized visual dropped, text kept |
| `src/channels/visual.pg.test.ts` | §8 continuity on Telegram and WhatsApp; fallbacks; Portuguese |
| `src/mcp/visual.pg.test.ts` | MCP compatibility, summary, image content, panel layout, secrets only in the existing private `_meta`, refusals unchanged |
| additions to `telegram.test.ts`, `whatsapp/render.test.ts` | photo/header shapes, multipart upload (Graph `/media` against a fake fetch), every fallback, unchanged failure classes, 24 h window/template |

Intentional changes to existing tests (for owner review):

- `src/channels/boundaries.test.ts`: the set of `src/server` modules reachable from channel entry points gains
  `src/server/workflow-visual-image.ts`; in exchange the test now also scans the renderer's whole closure (no signing, keys, flows,
  runtime, handoffs, `fetch`, `process.env`, secrets) and limits its packages to the engine's, `next/og.js` and React's types.
- `src/platform/approvals.pg.test.ts`: MCP's approval object is compared with the platform's minus MCP-only presentation fields;
  `visual` joins `message` there, and is asserted to be the projection of the same workflow.
- `src/channels/telegram/channel.pg.test.ts`: the "unknown outcome is never resent" case now scripts the timeout for both message
  methods (a proposal is a photo now) and asserts the single attempt was `sendPhoto`; the exact-command case asserts the photo.
- The Telegram doubles (`fixtures.test-harness.ts`, `e2e/telegram-bot-serve.ts`) accept multipart `sendPhoto` and read captions as
  message text; the channel and MCP browser specs assert the picture, the caption/header and the summary.

Gates run on the final tree are listed in §12.

## 10. Security and privacy

- Media leave FloFi only as bytes to the provider that already receives the proposal text (Telegram upload, WhatsApp media store); no
  public or private URL to the picture exists, nothing is stored by FloFi beyond the sealed presentation model inside the existing
  encrypted, erased-when-terminal outbox body. WhatsApp keeps uploaded media for up to 30 days (Meta's retention).
- The picture states only what the proposal text states: amounts, assets, networks, providers, shortened addresses, a shortened hash.
  Every visual string passes Channel Core's output guard; MCP's layout passes `assertSafeOutput`; tests scan models, layouts, summaries
  and content blocks for secrets, links, tokens and full addresses.
- The panel paints only allowlisted style properties with plain values (no `url()`, `var()`, markup or `innerHTML`); CSP unchanged.
- The renderer has no authority and no I/O: it takes the presentation model only.

## 11. Limitations (honest)

- No live provider was exercised: Telegram's real `sendPhoto` and Meta's real `/media` + image header are implemented to the documented
  APIs and tested against doubles/fake fetch only. WhatsApp stays policy-gated.
- Telegram compresses photos; a caption over 1024 characters means a text-only proposal (by design, never clipped).
- A WhatsApp media failure reported later by a status webhook is a FAILED delivery like any other (not re-sent as text); uploads are
  synchronous, so download-side media errors do not apply.
- MCP hosts render image content differently or not at all; ChatGPT/Claude rendering was not tested on vendor hosts.
- Exact-grammar channel turns answer in English even when `FLOFI_CHANNEL_LANGUAGE=PT` (pre-existing behaviour); the picture always
  matches the reply text's language, and Portuguese conversations get Portuguese pictures (tested).
- The panel's visual is a light card in both themes (it is the same picture the chats receive).

## 12. Final certification

Run on the committed implementation tree (`9955e0a`; the delivery commit after it changes only this section), Node 24.21.0,
pnpm 11.22.0, Anvil 1.8.3, a disposable loopback PostgreSQL 18.6 (CI's pinned image) and the app on loopback port 3131:

| Gate | Result |
| --- | --- |
| `pnpm check` (typecheck, lint, build, schema drift, unit tests) | PASS — 313 test files, 3,248 tests; 2 skipped are pre-existing, environment-gated fork fixtures (`it.skipIf`), unchanged here |
| `pnpm test:postgres` | PASS — 53 files, 337 tests |
| `python3 scripts/governance_lite.py` + `test_governance_lite.py` | PASS (1,719 text files) + 19 self-tests OK |
| `node scripts/guarded-release-browser.mjs product` | PASS — 24/24 profiles, 203 tests, none failed or skipped (Canvas, Build, Simulate, Dashboard, execution continuity, automations, delegated execution, Copilot, provenance boundaries) |
| CI browser step: `mcp-route-presentation` (OAuth off), `developer-journey`, `mcp-in-chat` + `mcp-route-presentation`, `channel-signing`, `whatsapp-approve` + `telegram-approve` | PASS — 11, 1, 21, 6, 2 |

Not run locally: the `composition` browser phase and the pinned fork/SBOM jobs (unaffected areas; CI runs them). Nothing here is live
provider, vendor-host, public-chain or production evidence.

Confirmations: no production environment variable changed; no transaction of any kind (no fork, testnet or mainnet submission, no
signature) occurred; no Canvas, Build, Simulate, Dashboard, landing, navigation, branding or global typography change (no file under
those surfaces changed, and their browser profiles pass); the WhatsApp policy gate and provider clearance are unchanged.
