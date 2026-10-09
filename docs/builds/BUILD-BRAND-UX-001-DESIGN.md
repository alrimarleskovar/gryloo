# BUILD-BRAND-UX-001 — design compatibility

**Latest owner correction (2026-10-09):** public marketing no longer shows the Devnet record, environment labels or sandbox copy described in the initial audit below. It uses curated real-asset product illustrations, a supported-network section and Tempo labeled as the next supported network. Recorded execution evidence remains in its original reports and in-app provenance controls. See [handoff](BUILD-BRAND-UX-001-HANDOFF.md) for exact final changes and validation.

Sources inspected on 2026-10-09 against main `fefda242e4abea5b8be5db57a9b8a09adbd2b65a`:

- `WORLD/FloFi-Landing-Work-Alrimar-2026-10-03.zip`, SHA-256 `40cbe55fecfb3cfc8c9a4e5b0570ea879774dbf18ac28c6907c9bc8c2051bb46`.
- `WORLD/tokensandlogo.zip`, SHA-256 `e42082c13345c8ef6b4ee62b34157e3f8767aea8dd56a5620dd04e8a1a3b8cba`.

Both were extracted to `/tmp/flofi-brand-source` after checking total uncompressed size, absolute/traversal paths, backslashes and symlinks. No exported scripts, vendored runtimes, dependency lockfiles, engine code or archive build output were imported or executed.

| Area | Discrepancy / reusable material | Resolution |
| --- | --- | --- |
| Palette | Landing uses turquoise `#00d8d0`, sampled from an older symbol, and navy `#07182d`. Supplied approved tokens specify blue `#2343D9`, navy `#041B3D`, muted `#4B5B73`, border `#D9E2EC`. | Adapt the isolated marketing palette and decorative tints to approved blue/navy. Preserve the layout, gradients and white-to-navy closing direction. |
| Typography | Landing uses Arial and 700/800 weights. Current app and package specify Outfit and IBM Plex Mono; app ships weights 400/500/600. | Reuse the existing self-hosted Next fonts; headings 600, metadata in Plex Mono. No new fonts/dependencies. |
| Logo | Landing's old turquoise PNG differs from the supplied blue droplet symbol and PNG wordmark. | Reuse existing `/brand/flofi-symbol-{light,dark}.svg` and wordmarks, which match all four supplied identity assets byte-for-byte. No recoloring or replacement. |
| Mascot | Landing has no separate mascot. Current app's Aceno welcome droplet is independently approved. | Retain the existing decorative welcome mascot and its dark variant; invent no alternative character. |
| Tokens | Current product tokens cover surfaces, borders, text, buttons, states and controls. They do not cover the marketing page's perspective scenes, scroll story or pill composition. | Keep marketing geometry local in a CSS Module. Use approved palette/type values there. Avoid importing reference HTML or overwriting global tokens. |
| Brand conflict | The current app's light palette includes the older `#1d5fca`; supplied package uses `#2343D9`. Current graphite tokens and identity assets already follow the newer system. | Conservatively retain the established product theme and state colors; apply the explicit supplied palette to the new landing. A wholesale app theme migration is outside these responsive changes. |
| Reusable source | Five-stage story, hero/product illustrations, review composition, Devnet record, closing atmosphere, bilingual strings, IntersectionObserver motion. | Integrate the React/CSS source selectively. Product illustrations remain labeled and cannot sign; disabled illustration authorization stays disabled. |
| Motion | Reduced-motion disabled transitions but still required a 400vh scroll story. | Show the complete vertical timeline under reduced motion at every width. Disable all nonessential animation and pointer depth there. |
| Claims | “Starting on Solana”, vague “low risk” request, hypothetical partner copy, Jupiter/Kamino listed together as future ecosystem. | Position as multichain; illustrate familiar crypto workflows with explicit scenario/roadmap labels. Keep verified Devnet proof separate. Describe merged sandbox API/SDK/MCP accurately, without risk guarantees or enabled mainnet claims. |
| Evidence | Solana Devnet swap in supplied page is recorded in current main's demo report. | Keep the exact Explorer link and `DEVNET_EXECUTED` scope; explain valueless test tokens. No mainnet, audit, APY or safety guarantee. |
| Routing | Source archive moved an older monolithic builder; current main has a persistent workspace and deep links. | Use `/` for landing and `/app` for builder. One product layout shares `/app/**`, `/approve`, `/connections`; server actions/API/OAuth URLs stay at their original paths. Update only test entry URLs and product Build navigation. |
| CTAs | Temporary `#documentation` destination. | Point documentation CTAs to the real repository developer docs; keep product anchors and app launch links functional. |
| Mobile | Primary toolbar actions clipped behind horizontal scrolling at 320px; small utility targets, long trip to chat. | Wrap action/utility rows, enlarge targets, add Canvas/Copilot focus shortcuts, use 16px form input, safe-area and dynamic dialog sizing, and contain dense tables locally. No store or financial gate change. |

## Attribution

Landing React/CSS and the original closing horizon are adapted from Caio's supplied handoff, whose source carries AGPL-3.0-only headers. The horizon is described there as an original generated illustration; it depicts no protocol, transaction or product result. The supplied Solana mark is retained as third-party brand material, attributed in `THIRD_PARTY_NOTICES.md`; it is not relicensed. FloFi identity provenance remains in `public/brand/flofi-identity.source.md`. Trademark and license records remain applicable.

The former root README is preserved at [README-ENGINEERING-HISTORY.md](README-ENGINEERING-HISTORY.md). Its prose is unchanged; relative links are rebased to its new location. Existing status, decisions and historical reports are untouched.

## Crypto visual refinement

The owner's additional requirement replaces the marketing-only Devnet placeholders with recognizable ETH, USDC, SOL, BTC and WBTC, and Ethereum, Base, Arbitrum and Solana ecosystem names. The hero depicts an illustrative ETH → USDC swap on Base followed by a USDC bridge to Arbitrum. The Review mockup depicts an illustrative Uniswap swap on Ethereum; it shows an example input amount and requires a fresh quote instead of inventing prices, output amounts, balances or execution results. Five scenario cards include swaps, bridging, Aave lending, recurring Bitcoin purchases and a SOL/USDC/ETH composition. Recurring purchases and broad multichain composition explicitly carry roadmap labels.

All icons share a contained frame and preserve source proportions and colors. Existing official ETH/SOL/Base marks and registry USDC/Arbitrum assets are reused. The added Bitcoin icon retains its CC0 dedication and WBTC its third-party brand attribution; see the crypto source register. The recorded Solana Explorer link, `DEVNET_EXECUTED` scope and valueless-test-token explanation remain intact. Actual builder screenshots retain their real network labels. The scenario illustrations do not connect a wallet or import financial stores.
