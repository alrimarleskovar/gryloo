# BUILD-WORKFLOW-VISUAL-PRESENTATION-001 — Plan: one workflow visual for MCP, Telegram and WhatsApp

Date: 2026-10-10. Branch `codex/build-workflow-visual-presentation-001` (worktree `~/projects/flofi-workflow-visual-presentation-001`),
from `main` `c66b23a4cc9da4c35f64c667c4be94888c36dace` (PR #78, BUILD-AUTOMATION-002 merged). Nothing is merged by the agent.

> **The visual is presentation only.** It is projected from FloFi's canonical workflow (the composed Semantic Workflow IR and its
> `semanticWorkflowHash`) and never replaces it. It authorizes nothing, signs nothing, submits nothing, infers no missing financial
> parameter and changes no workflow. The approval handoff — not the picture — is what "Open in FloFi" loads, and FloFi's existing
> wallet proof → fresh simulation → Strategy Manifest Review → explicit wallet signature flow is unchanged.

## 1. What exists at `c66b23a`

| Area | State |
| --- | --- |
| Canonical workflow | `src/engine/strategy-engine.ts`: StrategySpec (v1) / step list (v2) → existing `Command` → `editorReducer` → Semantic Workflow IR + `semanticWorkflowHash` (v2: hash over ordered step hashes). `src/platform/strategy.ts` (`composeWorkflowOrRefuse`) is the one composition every surface calls. `src/domain/workflow-steps.ts` projects an IR into typed steps (`StepDetail`) through the authoring modules' own readers. |
| MCP | `src/mcp/tools.ts`: `compose_strategy`, `request_user_approval` (+ app-only tools). Every result is `content: [{ type: 'text', text: JSON }]` + `structuredContent`; the approval's secret link travels only in `_meta['flofi/approval']` (UI-only). `src/mcp/app/panel.ts`: the MCP App panel (self-contained script, text-only rendering, empty CSP domains). |
| Channel Core | `src/channels/core`: `ChannelReply = { text, choices, link }`, sealed (AES-GCM, ≤ 16 KiB) in the transactional outbox; the approval link is attached in memory at send time; `deliverConversation` classifies sends (TRANSIENT / RATE_LIMITED / PERMANENT / UNCERTAIN), retries, never resends UNCERTAIN, respects the adapter window. |
| Telegram | `sendMessage` + inline keyboard (URL button for the approval link), plain text, link previews off. |
| WhatsApp | Cloud API-shaped adapter, FIXTURE transport only until policy clearance is recorded in code; `cta_url` interactive message for the approval link; template outside the 24 h window. |
| Rendering dependencies | `next@16.3.8` ships `next/og` (`ImageResponse`: Satori layout + resvg/sharp rasterization, bundled Geist font). No other image stack is installed. |

## 2. Architecture

```
composeWorkflowOrRefuse (canonical)            ← the only input; workflowHash stays authoritative
        │  (pure projection, no I/O)
        ▼
src/platform/workflow-visual.ts      WorkflowVisualModel  (language-neutral facts + workflowHash reference)
        │  (pure, EN/PT)
        ▼
src/platform/workflow-visual-layout.ts   VisualLayout = { tree (HTML/CSS element tree), width, height, alt, summary, title }
        │
        ├── MCP App panel: paints the same tree as DOM (textContent + allowlisted styles), role="img" + alt
        └── src/server/workflow-visual-image.ts: tree → PNG with next/og (offline, deterministic)
                 ├── MCP: standard ImageContent (PNG) next to the unchanged JSON text and structuredContent
                 ├── Telegram: sendPhoto (multipart upload) + caption + "Open in FloFi" URL button
                 └── WhatsApp: POST /media (upload) → cta_url interactive message with an image header
```

**Shared renderer boundary (exact).** One projection (`workflowVisualModel`), one layout (`workflowVisualLayout`), one rasterizer
(`workflowVisualPng`). MCP and the channels never compute a layout; adapters only translate a ready PNG into a provider API. The
platform modules stay pure (no Next.js, no I/O); only `src/server/workflow-visual-image.ts` imports `next/og`.

## 3. Shared visual model

`WorkflowVisualModel` (version 1): `workflowHash` (reference only), `fundsClass`, ordered `networks`, `chains` (EVM / Solana),
`steps[]` (id, index, action family, provider, chain, network, destination network, exact amounts as decimal strings from the IR,
output asset when it is known only as an asset, slippage when the IR carries it, price/tick range, the account the IR names —
shortened), `connections[]` (IR dependencies inside one workflow; step order across a v2 list) and `warnings` (real funds, debt
remains, sequence not executable yet). Title, summary and alt text are derived per language (EN/PT).

Action families: Swap (Uniswap v3, Jupiter, Orca), Bridge (Cross-chain Router: LI.FI / Across / automatic), Supply, Borrow, Repay,
Withdraw (Aave V3), Add liquidity (Uniswap v3, Orca), Transfer (native transfer, from the IR), the lending composition and any v2
step list. Unknown nodes are shown generically, never guessed.

Never in the model: approval links or secrets, wallet sessions, OAuth tokens, capabilities, calldata, full addresses, provider ids.
Never invented: minimum received, fees, quotes — they are not in the canonical IR and appear only in FloFi's fresh simulation and
Strategy Manifest.

## 4. Surfaces

- **MCP.** `compose_strategy` and `request_user_approval` keep `content[0]` (the JSON text) and `structuredContent` exactly as before,
  adding `structuredContent.visual` (the model) and a concise text summary (with the public Open in FloFi link for approvals).
  `request_user_approval` also carries a PNG `image` block (audience `user`) and the layout tree in `_meta['flofi/visual']` (UI-only),
  which the panel paints; hosts without MCP Apps get the image and the summary; hosts that ignore images get the summary and the JSON.
  (Revised during implementation: `compose_strategy` carries no picture — a model may compose repeatedly while iterating, and an image
  per result would cost it context and latency; the approval is the moment the person acts.)
- **Telegram.** An approval reply with a visual becomes `sendPhoto` (multipart upload: bytes, not a URL), caption = the existing ready
  text (≤ 1024 characters, otherwise text only), the same URL button. A media-specific rejection (400) falls back to the existing
  `sendMessage` in the same attempt; throttling, unavailability and uncertain outcomes keep their current classes (never resent when
  uncertain).
- **WhatsApp.** In the 24 h window, an approval reply with a visual uploads the PNG (`/media`, multipart) and sends the existing
  `cta_url` message with an image header. A failed upload or an image rejection sends the existing text `cta_url` message. Outside the
  window the template path is unchanged (no image). FIXTURE transport only; no clearance change.
- **Channel Core.** `ChannelReply.visual?` (provider-neutral: the model + language) is sealed with the body (the link never is);
  delivery renders it once per message through an injected renderer and passes `SendContext.image` (`image/png` bytes + alt) to the
  adapter. A visual that fails the output guard or the renderer is dropped; the text message is always the fallback.

## 5. Security and privacy

- Media are uploaded as bytes to the provider that already receives the message text (Telegram `sendPhoto` upload, WhatsApp
  `/media`). No public URL, no new storage, no new service.
- The model holds only what the channel text already says (shortened addresses, amounts, networks, providers); the output guard checks
  every visual string; the rasterizer never reaches the network (only glyphs the bundled font covers; tested with a fetch trap).
- Rendering reads no wallet, runtime, flow, handoff or secret; boundary tests cover the import closure.

## 6. Tests

Unit: determinism (model, tree, PNG bytes), hash unchanged, each action family, EVM + Solana, EN + PT, omitted metadata, no leaks, no
network, MCP structuredContent compatibility, image and summary blocks, panel painter, Telegram photo + CTA + fallbacks + unchanged
retry classes, WhatsApp upload + CTA + fallbacks + window/template, Channel Core delivery with and without a renderer. PostgreSQL:
channel approval with a visual → the handoff's workflow hash and the claimed/applied workflow hash are the visual's hash. Browser:
`mcp-in-chat`, `mcp-route-presentation`, `channel-signing`, `telegram-approve`, `whatsapp-approve` (extended to assert the visual).
Gates: `pnpm check`, relevant PostgreSQL suites, governance-lite and its unittest suite.

## 7. Out of scope

Canvas, Build, Simulate, Dashboard, landing, navigation, branding or global typography changes; inbound media; WhatsApp activation or
clearance; new providers; generative images; execution lifecycle changes.
