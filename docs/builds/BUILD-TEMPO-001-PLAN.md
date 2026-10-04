# BUILD-TEMPO-001 — plan

Date: 2026-10-03. Isolated worktree `.turbo/build-tempo-001`, branch
`codex/build-tempo-001`, clean starting HEAD and fetched cloud base
`8d43ea675b5c1284c5e44c2599025776af3bcc00` (`claude/build-cloud-001`).
PRs #48–52 and their branches are not modified. No historical build, evidence,
manifest, or existing chain profile is rewritten.

## Official discovery before implementation

Retrieved the current official `https://docs.tempo.xyz/llms-full.txt` on this date.
It redirects documentation to `https://tempo.xyz/developers/docs/`.

| Topic | Finding and official reference |
| --- | --- |
| Networks | [Connection details](https://tempo.xyz/developers/docs/quickstart/connection-details): mainnet 4217, HTTP/WSS `rpc.tempo.xyz`; Moderato public testnet 42431, HTTP/WSS `rpc.moderato.tempo.xyz`, explorer `https://explore.testnet.tempo.xyz`. Devnet 31318 appears in the verification reference; no devnet execution enabled. |
| VM / wallets | [EVM differences](https://tempo.xyz/developers/docs/quickstart/evm-compatibility): Osaka EVM; ordinary EVM transactions supported, but native balance RPC is a compatibility placeholder, never spendable ETH. Native transfer value must be zero. EVM wallets do not automatically support Tempo envelopes. |
| Transaction | [Transaction specification](https://tempo.xyz/developers/docs/protocol/transactions/spec-tempo-transaction): type 0x76, calls, explicit fee token, nonce key, valid-before/after, optional sponsorship, key authorization and AA authorization. Phase 1 permits one call, protocol nonce key zero, explicit fee token and expiry, secp256k1 owner only; excludes sponsorship, delegation, batching, access keys and sessions. |
| Token | [TIP-20](https://tempo.xyz/developers/docs/protocol/tip20/spec): ERC-20-compatible interface plus six decimals, currency, pause/policies and 32-byte transfer memo events. Token addresses and protocol precompiles have special semantics; ordinary deployed-bytecode assumptions do not prove their behavior. |
| Fees | [Fee specification](https://tempo.xyz/developers/docs/protocol/fees/spec-fee): USD stablecoin fees, attodollars per gas, microtoken cost `ceil(gas * price / 10^12)`. Dynamic base fee, fee AMM liquidity, transaction/account/contract/fallback preferences. Bind pathUSD explicitly; never use eth_getBalance as a funding check. |
| Payment | [Transfer memos](https://tempo.xyz/developers/docs/guide/payments/transfer-memos): transferWithMemo(address,uint256,bytes32), Transfer and TransferWithMemo logs support invoice reconciliation. TIP-403 and receive policies can block/hold transfers, so receipt success alone is insufficient. |
| Venues evaluated | [Stablecoin DEX](https://tempo.xyz/developers/docs/guide/stablecoin-dex/executing-swaps) is an official enshrined orderbook at 0xdec0000000000000000000000000000000000000. Swaps require liquidity/quote/approval checks; defer to a subsequent capability. MPP sessions, Zones and sponsored payments are also deferred. |
| Faucet | [Official faucet](https://tempo.xyz/developers/docs/quickstart/faucet): owner may request test OUSD, pathUSD, AlphaUSD, BetaUSD, ThetaUSD with tempo_fundAddress or the official page. This build never invokes the faucet. pathUSD is 0x20c0000000000000000000000000000000000000; testnet only. |
| Consensus | Simplex BFT deterministic finality; verify canonical inclusion and finalized head, not Ethereum L1/L2 finality assumptions. |

## Narrow acceptance profile

One canonical `asset.transfer` using `tempo.tip20` on Moderato, 1–10,000,000
micro-pathUSD (at most 10 test tokens), explicit ordinary EVM recipient and bytes32
memo, at most 100,000 micro-pathUSD fee, short expiry. Mainnet disabled.

The existing Guided/Canvas workflow store feeds the canonical IR, linter and
capability registry. A compiler adapter produces the existing artifact-set,
simulation, authorization-policy, strategy-manifest and execution-plan schemas.
Review binds every field. Any changed intent, account, nonce, token policy,
insufficient balance, fee ceiling violation or stale head requires a fresh
preflight, simulation, Review and authorization.

Use the existing cloud storage ports, fenced leases, intent reservation,
projectors, queue, worker and evidence archive. Workers receive allowlisted read
RPC only and never signed bytes or submission methods. Browser wallet is the
only signer and submission boundary. Unsupported wallets fail closed.

Reconcile exact envelope, canonical inclusion, successful receipt, payment and
memo events, actual fee token/payer and balance changes. Unknown submission
remains observation-only and cannot release its nonce reservation.

## Validation and deliverables

Add unit/adversarial tests for IR, fee conversion, protocol envelope, Review
invalidation, single-attempt durability, reconciliation and wallet boundary; use
the shared PostgreSQL runtime tests for restart/worker/evidence behavior. Run
typecheck, lint, build, schema and regression tests. Capture a public read-only
RPC transcript with pinned blocks and honest results. Unfunded discovery is not
an owner simulation or public execution.

Deliver report, exact owner E2E instructions and a draft PR stacked on the cloud
branch. Stop before any owner signature, faucet write or transaction. Registry
public-execution evidence remains null until independently reconciled owner
execution. MOCKED, FORK_REPRODUCED and PUBLIC_TESTNET_EXECUTED are distinct;
existing EvidenceBundle v1 uses TESTNET_EXECUTED for the latter, without schema
or historical record changes.
