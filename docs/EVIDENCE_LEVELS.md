# Evidence levels

## BUILD-ROUTER-001 Cross-chain Router evidence boundary

Router runs (Base mainnet USDC → Arbitrum One USDC, via LI.FI or direct Across, underlying Across) are classified `MOCKED`
(in-process and loopback chains and providers), `PUBLIC_READ_ONLY` (live provider quotes, real Base/Arbitrum reads and a real
`eth_simulateV1` of the exact Base transactions, without owner execution) or `MAINNET_EXECUTED`. `MAINNET_EXECUTED` is valid
only for an owner-initiated run whose Base transactions are the reviewed calls from the owner (directly or as one canonical
MetaMask delegated redemption), whose receipt carries exactly the reviewed Across `FundsDeposited`, and whose Arbitrum
`FilledRelay` for the same `(originChainId, depositId)` delivers at least the reviewed minimum to the reviewed recipient,
with the USDC `Transfer` in the fill receipt, both blocks at their chain's `safe` head. A provider status string is never
settlement evidence. A refund after the fill deadline is `REFUNDED`, not success. Current evidence is `MOCKED` plus
`PUBLIC_READ_ONLY` ([BUILD-ROUTER-001-READONLY.json](builds/BUILD-ROUTER-001-READONLY.json)); the BUILD-008/010 `MOCKED`
bridge records are unchanged.

## BUILD-UNISWAP-LIQUIDITY-PUBLIC Base Sepolia liquidity evidence boundary

Base Sepolia Uniswap v3 liquidity runs are classified `MOCKED` (in-process and loopback chains), `PUBLIC_READ_ONLY`
(real Base Sepolia reads and `eth_simulateV1` simulation without owner execution) or `TESTNET_EXECUTED`.
`TESTNET_EXECUTED` is valid only for an owner-initiated run whose approval and mint transactions are the reviewed
calls from the owner (directly or as one canonical MetaMask delegated redemption), and whose Approval, ERC-721
`Transfer(0 → owner)`, `IncreaseLiquidity` and pool `Mint` events, `ownerOf`, `positions` and owner balance deltas
reconcile with the reviewed ticks, minimums and maxima. Its Evidence Bundle records `environment: TESTNET_EXECUTED`.
Current evidence is `MOCKED` plus `PUBLIC_READ_ONLY` (docs/builds/BUILD-UNISWAP-LIQUIDITY-PUBLIC-READONLY.json). The
historical BUILD-006 `FORK_REPRODUCED` (chain 31337) and BUILD-007 Mode B results are unchanged and separate.

## BUILD-DEMO-001 Solana Devnet evidence boundary

Solana Devnet swap runs (Orca Whirlpools, valueless test tokens) are classified `MOCKED` (loopback harness and fixtures), `PUBLIC_READ_ONLY` (real Devnet pool reads and exact-message simulation without owner execution) or `DEVNET_EXECUTED`. `DEVNET_EXECUTED` is valid only for an owner-initiated Devnet transaction whose finalized bytes equal the owner-signed reviewed message and whose balance deltas and Orca `Traded` event reconcile. The frozen v1 Evidence Bundle enum has no Devnet member, so such a bundle records `environment: TESTNET_EXECUTED`, while its `publicExecution.environment` and evidence class are `DEVNET_EXECUTED`. Devnet evidence is never `MAINNET_EXECUTED` and never real funds. BUILD-DEMO-001 reached `DEVNET_EXECUTED` with owner-signed transaction `5Aoo6QX3b7rh3wAX5fxY8ybx7R7k1VgrT95QhuAf5HNF2zNiaCVAoTZtus3HbdwtZthSY9BiMKWiJRVQc67dLCbB` (slot 506,389,990). Its archived bundle (hash `0x621c869a0dbee6e0d827ed536d32230c1ef14e0281a84c92d2d0619e9716e6c9`) records `environment: TESTNET_EXECUTED` under the frozen schema. That is Devnet evidence with valueless tokens, not mainnet or real-funds evidence.

BUILD-015 Orca Whirlpools liquidity operations on Solana Devnet (open + add, partial removal with fee collection, exit with close) use the same classes. Each operation is classified separately. `DEVNET_EXECUTED` requires an owner-initiated operation whose finalized bytes equal the reviewed message signed by every reviewed signer, and whose Orca position events, position authority and owner/vault/position balance deltas reconcile, with withdrawn principal (from `LiquidityDecreased`) kept separate from collected fees. BUILD-015 reached `DEVNET_EXECUTED` for all three operations: open [`4NmXs8NoB6KW…`](https://explorer.solana.com/tx/4NmXs8NoB6KW8jzPesDRZqDcQ26QS4crkF13jN9kNkbPxUf4W8FDitGy3ywaNKBaVTUQM9HcLYLpvJQhvW8LaLJJ?cluster=devnet), partial removal [`5HQGjFbb1jbw…`](https://explorer.solana.com/tx/5HQGjFbb1jbwNCEvm2fZM3oKZVQvqQ879Q1vDLumCGJF8RDX5t8KaEmFaXnRhNvvP73uiwzrEKwg88EA3r3oNHPa?cluster=devnet) and exit [`8MAvfVGXXo6m…`](https://explorer.solana.com/tx/8MAvfVGXXo6mMcfkuikKnHmTfQ6S37Y5oPh6F7sdVJSNeNSgFZyFsGp1WpoonHHrAPLRWKzaQtq2zgCu1hzfZTV?cluster=devnet), for position `DscRyBK8SAH4F5KizzUpv9wd55QFk5cUbK9piNMXvgWv`. They were independently verified 55/55, and their archived bundles record `environment: TESTNET_EXECUTED` under the frozen schema. That is Devnet evidence with valueless tokens, not mainnet or real-funds evidence.

## BUILD-014 Jupiter / Solana evidence boundary

Jupiter swap runs are classified `MOCKED` (loopback harness and fixtures), `PUBLIC_READ_ONLY` (real Jupiter quotes, chain-verified lookup tables and public RPC simulation without owner execution) or `PUBLIC_EXECUTED`. `PUBLIC_EXECUTED` is valid only for an owner-initiated mainnet-beta transaction whose finalized bytes equal the owner-signed reviewed message and whose balance deltas reconcile; its Evidence Bundle environment is `MAINNET_EXECUTED`. Current BUILD-014 evidence is `MOCKED` plus `PUBLIC_READ_ONLY` only.

## BUILD-008 evidence boundary

DEC-0046 certifies BUILD-008 COMPLETE / CERTIFIED: MOCKED for the Base → Optimism USDC bridge. Live LI.FI token and quote/route data are real read-only provider evidence. Financial bridge execution, recovery and destination reconciliation remain deterministic MOCKED. The source and destination observations in the bridge Evidence Bundle are scripted local results, not public-chain financial execution or settlement. There is no `TESTNET_EXECUTED`, `MAINNET_EXECUTED` or real-funds claim. The BUILD-003/004/006/007 `FORK_REPRODUCED` and BUILD-005 `MOCKED` certifications are unchanged. BUILD-009 is planning only.

## BUILD-007 evidence boundary

DEC-0043 certifies BUILD-007 at `FORK_REPRODUCED` on local chain 31337 only. The evidence is the attempt-2 Base transcript at block 51,906,032, byte-identical closed replay, direct Safe/Roles mint-bound results, the actual local swap and Safe-owned mint, and independent raw-RPC reconciliation. This is not testnet or mainnet evidence. The boundary text below still applies.

Synthetic official-code rehearsals and their local-chain outcomes are `MOCKED`. A Base read-only transcript is source-state evidence, not a public-chain transaction result. BUILD-007 can reach `FORK_REPRODUCED` only after a complete new transcript at one Base source block, byte-identical closed replay, direct Safe/Roles boundary results, actual local swap and Safe-owned mint, independent raw-RPC reconciliation and passing gates. Receipts alone are `CONFIRMED_NOT_RECONCILED`; missing or inconsistent reads are `INCONCLUSIVE` or `DIVERGENT`. The one approved BUILD-007 Base attempt stopped before a transcript, so the actual BUILD-007 ceiling is currently `MOCKED`. Owner merge, post-merge gates and certification remain distinct decisions. Existing BUILD-003/004/006 fork and BUILD-005 mocked certifications are unchanged.

Future financial evidence environments are `MOCKED`, `FORK_REPRODUCED`,
`TESTNET_EXECUTED`, and `MAINNET_EXECUTED`. Future financial outcome statuses
include `CONFIRMED_NOT_RECONCILED`, `RECONCILED`, `INCONCLUSIVE`, and `DIVERGENT`.
They may be used only when their technical prerequisites are met.

BUILD-000 is governance-only:

- Evidence environment: `NOT_APPLICABLE`
- Financial outcome status: `NOT_APPLICABLE`
- Retained evidence: repository inventory, Git baseline, specification digest,
  governance checks, and human decision records

Governance checks are not financial execution or reconciliation evidence.

BUILD-001 adds contract verification only:

- Evidence environment: `NOT_APPLICABLE`
- Financial outcome status: `NOT_APPLICABLE`
- Authorization mode: `NONE`; financial enforcement: `NOT_ENFORCED`
- Retained evidence: versioned schemas, source tests, compatibility vectors,
  lockfile, approved plan, truthful report, and reviewed Git changes
- Per-run evidence: test and bootstrap logs, dependency checks, and SBOM digest
  in CI logs and the job summary

The SBOM file exists temporarily for validation. It is not committed, uploaded,
or claimed as a retained artifact. Local validation does not prove a remote CI
run. Synthetic fixtures containing financial environment or outcome enum values
test contracts; they do not demonstrate those outcomes. No primitive has P1–P14
certification from this build.

BUILD-002 local acceptance is demonstrated by strict compiler, full
dependency integrity/license inventory, frozen install, regression, browser,
accessibility, network, visual, audit, ephemeral SBOM and governance gates
recorded in the [BUILD-002 report](builds/BUILD-002-REPORT.md). These are local
observations; remote CI and future binary release compliance require their own
evidence.

BUILD-003A adds non-executing authoring and deterministic lint. Its interface
remains `MOCKED`; authorization is `NONE` and enforcement is `NOT_ENFORCED`.
Asset metadata is `NOT_ONCHAIN_VERIFIED`. Build financial evidence environment
and outcome are `NOT_APPLICABLE`. Browser surface tests and local static source
checks do not constitute quotes, simulation, protocol verification, transaction
execution or reconciliation. Local checks and remote CI are reported separately
in the [BUILD-003A report](builds/BUILD-003A-REPORT.md).

BUILD-003B adds a `MOCKED` Quote/State Artifact, Artifact Set and Simulation
Bundle chain built from a fixed synthetic rate. This is internal-logic evidence
only: the chain is not a live quote, not a financial simulation and not
execution evidence. P6 and P7 appear in mocked form and are not certified.
Build financial outcome remains `NOT_APPLICABLE`; no Evidence Bundle is
produced. Mocked provenance and hashes identify synthetic data and are not
authenticity proof. Local checks and remote CI are reported separately in the
[BUILD-003B report](builds/BUILD-003B-REPORT.md).

BUILD-003C introduces a separate `LIVE_READ_ONLY` or `RECORDED_REPLAY` observation mode. An observation is `NOT_EVIDENCE`, is not an authorization input, and has no financial outcome. The public Base RPC recording stopped after two HTTP 429 responses at request 12 (2/4 attempts, 24/84 requests). The original Alchemy attempt received HTTP 403 before a pinned method and remains preserved at 1/3 attempts and 1/63 requests. Under the approved DEC-0022 continuation, the owner recorded two real, canonical hash-pinned transcripts in attempts 2 and 3; final Alchemy usage is 3/3 attempts and 43/63 requests. The four code pins agree across directions and the historical replay passed local acceptance. This does not elevate the observation to financial evidence or independently enforced authorization. No further live recording is authorized. See the [BUILD-003C report](builds/BUILD-003C-REPORT.md).

## BUILD-003F real local-fork evidence (local acceptance)

F2's disposable-secret 51/51 fork cases and G1 C1–C10 prove the owner-controlled account boundary; they do not by themselves prove a Base fork outcome. F3 recorded finalized Base state at block 51,797,365 under one bounded owner run, producing credential-free transcript SHA-256 `ebf4daaf10f891a735db682e8db2ee383b5165cece414e606a2011e681ed7d75`. F4 reproduced seven scenarios byte-identically in the closed replay. F5 real-replay browser acceptance passed 18/18; the separate 42/42 synthetic and 42/42 dry-run replay suites remain `MOCKED` engineering evidence.

G7 is `FORK_REPRODUCED` only: MetaMask 13.48.0 in Brave 1.95.104 signed two exact EIP-1559 payloads on local chain 31337. Both receipts succeeded; independent chain reads and signed-byte verification produced `RECONCILED:EXACT`, 2,685.012130 USDC observed output, zero residual WETH router allowance and Evidence Bundle hash `0xd651a51063af8f86aee30d7f85844bb4747147bc27eb371807e38c3ac5f795b6`. This does not imply Base mainnet transaction execution, testnet execution, production readiness, custody or an independent Mode B limit. DEC-0030 accepted ADR-0004 and certified BUILD-003 at `FORK_REPRODUCED` on local chain 31337 after PR #11 4/4 and successful post-merge Governance and Contracts/app checks. See the [BUILD-003F report](builds/BUILD-003F-REPORT.md).

## BUILD-004 finite Mode B local evidence

DEC-0031 approved an independently scoped Safe/Roles swap on the controlled chain-31337 fork. The direct local-fork bypass, fork read-back and browser/worker tests run against the certified closed BUILD-003F replay, which never synthesizes a response, and are local `FORK_REPRODUCED` engineering evidence. The Safe's starting token state is not Base-observed. The owner selected three explicit `LOCAL_SETUP_NOT_BASE_OBSERVED` slot writes (DEC-0032), and local-only accounts are declared, not read from Base. An earlier replay extension that answered unrecorded reads with zeros was removed; its results are not evidence. The owner-operated MetaMask session on chain 31337 passed the independent key-free verifier. It is local `FORK_REPRODUCED` evidence, not a public-chain result. After PR #13 merged as `e71de3946c7aac6095023ca1ee6f1e1a58a98112` and post-merge runs `36333448106` and `36333448100` passed, DEC-0033 certified BUILD-004 `COMPLETE / CERTIFIED: FORK_REPRODUCED` on local chain 31337 only. `RECONCILED` in the automated test describes its disposable local transaction only. No `TESTNET_EXECUTED`, `MAINNET_EXECUTED` or production authority is implied. See the [BUILD-004 report](builds/BUILD-004-REPORT.md).

## BUILD-005 CoW loopback evidence

DEC-0034 approves a deterministic loopback CoW orderbook, disposable injected local wallet and scripted posting, tracking, cancellation and settlement. The adapter may show `RECONCILED` only after its scripted receipt, trade, balance, fee and allowance checks agree; the Evidence Bundle environment is always `MOCKED`. An ambiguous post remains unknown until UID lookup, and a missing or inconsistent settlement remains inconclusive or divergent. This does not raise BUILD-003/004 local-fork certification and does not establish any public CoW fill, public-chain receipt, production wallet safety or financial outcome. The [BUILD-005 report](builds/BUILD-005-REPORT.md) records local and CI results separately.

After the owner merged PR #15 as 37a0782ece81f83c362b50f68adfc1accb37ccff, post-merge Governance run 36344564513 and contracts/app run 36344564511 passed. DEC-0035 certifies BUILD-005 COMPLETE / CERTIFIED: MOCKED for this loopback signed-intent profile only. This does not alter the separate BUILD-003/004 FORK_REPRODUCED certifications or establish public CoW, public-chain, production-wallet or real-funds evidence.

## BUILD-006 certified local fork evidence (DEC-0037)

After PR #16 merged as 1edd783028ee8eed0953ca1e7e1446ad03229844 and the post-merge checks passed (Governance run 36361208012 and contracts/app run 36361208019 on 3e4aae6fb48812a6db64abdd771e13718f96615e), DEC-0037 certifies BUILD-006 COMPLETE / CERTIFIED: FORK_REPRODUCED on local chain 31337 only. The pre-merge text below is historical.

## BUILD-006 demonstrated locally (historical pre-merge record)

DEC-0036 authorizes an isolated Uniswap v3 liquidity lifecycle with a maximum `FORK_REPRODUCED` target on local chain 31337, conditional on a new complete credential-free closed replay and independent reconciliation of each local effect.

On 2026-09-28 those conditions were met locally. The owner-operated recording produced transcript `c9a02102…95805` at Base block 51,880,679; the closed replay was `REPLAY_BYTE_IDENTICAL`, and an independent raw-RPC verifier reconciled all 12 lifecycle operations. BUILD-006's demonstrated local level is therefore `FORK_REPRODUCED`. It is not certified until remote CI, the owner's merge, post-merge checks and a separate owner decision.

Offline fixtures and the synthetic dry run are `MOCKED`; read-only Base state is not public transaction evidence. BUILD-003/004 `FORK_REPRODUCED` and BUILD-005 `MOCKED` certifications remain separate. No `TESTNET_EXECUTED` or `MAINNET_EXECUTED` evidence exists.

## BUILD-012A exact public evidence gate

DEC-0056 permits TESTNET_EXECUTED only after a real owner-triggered Gryloo Supply on the verified official Aave V3 Base Sepolia deployment has exact transaction/event checks, successful canonical receipt and index-aware aToken principal delta. The downloadable canonical Evidence Bundle includes hashed observations and linked workflow, simulation, policy, Manifest, plan and journal. Deterministic harness observations remain MOCKED, and forks remain development evidence. No other Aave profile or network is promoted.
