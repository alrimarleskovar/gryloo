# Gryloo

Gryloo is a non-custodial, conversational and visual compiler plus bounded
executor for multichain DeFi workflows. Chat, canvas, and integrations will use
one canonical Semantic Workflow IR; AI proposals never constitute financial
authority.

## Current status

BUILD-003 and BUILD-004 are certified only for their recorded controlled local-fork evidence. BUILD-005 is COMPLETE / CERTIFIED: MOCKED under DEC-0035 after PR #15 merged and post-merge checks passed. Its CoW signed-intent journey in the reference app uses a deterministic loopback orderbook, disposable local wallet and `MOCKED` scripted settlement. BUILD-006 is COMPLETE / CERTIFIED: FORK_REPRODUCED under DEC-0037, for its isolated Uniswap v3 Mode A liquidity lifecycle on local chain 31337 only. BUILD-007 is planning only. See the [current status](docs/STATUS.md), [BUILD-006 plan](docs/builds/BUILD-006-PLAN.md), [BUILD-006 report](docs/builds/BUILD-006-REPORT.md), [BUILD-005 plan](docs/builds/BUILD-005-PLAN.md), [report](docs/builds/BUILD-005-REPORT.md) and [local signed-intent contract](docs/contracts/COW_SIGNED_INTENT_V1.md). No public CoW, public-chain or production certification follows. Gryloo remains a global non-custodial multichain product; Solana retains its stated roadmap priority.

## Licensing

Gryloo is multi-licensed. [LICENSE](LICENSE) routes to the official license
texts, and [the license map](docs/LICENSE_MAP.md) classifies each path.
`docs/assets/**` is excluded as third-party reference material. The licenses
grant no Gryloo trademark rights; see [TRADEMARKS.md](TRADEMARKS.md).

## Sources of truth

- [Master Product Specification v3.2](docs/specs/MASTER_SPEC_V3.2.md)
- [Astra Development Master Prompt v1.2](prompts/DEFI_WORKFLOW_ENGINE_MASTER_PROMPT_ASTRA_v1.2_EN.md)
- [Governance decisions](docs/DECISIONS.md)

The files in `docs/assets/` are visual direction only. They do not authorize
copying third-party branding, interface text, or unsupported safety claims.

## Contract packages

- `@defi-workflow-engine/workflow-contracts@0.1.0`: artifact contracts, raw-byte
  ingress, canonical hashes, invalidation, revision checks, and state transitions.
- `@defi-workflow-engine/action-registry@0.1.0`: declarative action definitions
  and capability contracts.

Both packages are private and Apache-2.0. Exports are limited to the documented
root API, `./schemas`, `./schemas/v1/*.schema.json`, and `./package.json`.
See [compatibility](docs/contracts/COMPATIBILITY_V1.md),
[canonicalization](docs/contracts/CANONICALIZATION_V1.md), and
[invalidation](docs/contracts/INVALIDATION_V1.md).

CI bootstraps verified official Node.js `24.21.0` and pnpm `11.22.0` archives
with runner Python, Git, and Bash and no third-party Actions. Dependencies use
exact pins and a frozen lockfile; install scripts are disabled. SBOM validation
emits a digest; no retained SBOM artifact is claimed.

BUILD-002's approved private [reference application](apps/reference-dapp)
provides the local mocked Gryloo visual shell and shared revisioned workflow
state. Its source is AGPL-3.0-only. The exact third-party license and
attribution inventory is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md);
the current validation record is the
[BUILD-002 report](docs/builds/BUILD-002-REPORT.md).

## BUILD-003A

The private `@defi-workflow-engine/reference-linter@0.1.0` package adds
deterministic, non-enforcing review of isolated Base USDC↔WETH exact-input
intent. The existing [reference application](apps/reference-dapp) supports the
same intent through local chat and canvas controls. It provides no quote,
protocol connection, wallet or execution. Both the app and linter are
AGPL-3.0-only. See the [approved plan](docs/builds/BUILD-003A-PLAN.md) and
[implementation report](docs/builds/BUILD-003A-REPORT.md) for exact scope and
separate local and remote evidence.

## BUILD-003B

The Simulate tab of the [reference application](apps/reference-dapp) now
builds a `MOCKED` Quote/State Artifact, Artifact Set and Simulation Bundle for
each authored Base swap, from a fixed synthetic rate of 1 WETH = 1,000 USDC.
The chain is hash-linked to one workflow revision, expires after 60 seconds and
is invalidated by any semantic edit. It is not a live quote or a financial
simulation, and Execute remains unavailable. See the
[approved plan](docs/builds/BUILD-003B-PLAN.md) and
[implementation report](docs/builds/BUILD-003B-REPORT.md).

## BUILD-003C (merged through PR #9)

The approved [plan](docs/builds/BUILD-003C-PLAN.md) adds a separate read-only Base/Uniswap v3 quote observation with every state read pinned by block hash and canonicality. It never feeds the mocked artifact chain or authorization. The public recording stopped after two HTTP 429 responses at 2/4 attempts and 24/84 requests. The original Alchemy Free attempt received HTTP 403 at its first request and remains preserved at 1/3 attempts and 1/63 requests. After the owner enabled Base Mainnet only and approved DEC-0022, the bounded owner-run continuation verified both hash-pinned methods and completed both directions in attempts 2 and 3, ending at 3/3 cumulative Alchemy attempts and 43/63 requests. The [BUILD-003C report](docs/builds/BUILD-003C-REPORT.md) records the two real transcript hashes, four reviewed code pins, replay fixture, ten visual baselines and passing local checks. The provider remains fixed to Base mainnet with a server-only Bearer credential; no paid plan, charge or further RPC request is authorized. Wallet, signing, execution and a subsequent build remain unavailable. The owner retains merge.

## BUILD-003D (closed under Option B)

The approved [plan](docs/builds/BUILD-003D-PLAN.md) aimed for a Mode A vertical slice on a recorded, controlled Base fork.

**What BUILD-003D delivers**, all accepted offline with scripted transports and synthetic loopback upstreams (see the [report](docs/builds/BUILD-003D-REPORT.md)):

- a deterministic Simulate viewport and screenshot-diff forensics;
- an offline Anvil compatibility gate;
- the additive enforcement-matrix contract and exact-payload profile;
- pure compiler, executor and reconciler packages;
- the fork harness and replay infrastructure.

**What it does not deliver.** All three owner-run recording attempts stopped, so no recorded Base state, fork execution, wallet signing, reconciliation evidence or certification exists. The recording, fork application integration and manual-wallet acceptance move to BUILD-003F, which is not approved. BUILD-004 planning waits for BUILD-003 certification. The application still offers no wallet, signing, submission or execution.

## BUILD-003F (local fork acceptance; delivered)

DEC-0028 approved the [BUILD-003F plan](docs/builds/BUILD-003F-PLAN.md). One owner-run Alchemy Free recording acquired finalized Base state under a fixed request/CU cap, and a credential-free transcript replay reproduced all seven scenarios byte-identically. The reference app's opt-in Mode A path on local chain 31337 lets a human review two exact payloads before an injected wallet signs them. The owner operated MetaMask on the replayed fork; independent verification found both signed payloads exact, both receipts successful and a `RECONCILED:EXACT` Evidence Bundle. See the [report](docs/builds/BUILD-003F-REPORT.md) for the actual transcript, source block, wallet/version, test counts and limitations.

This is **local-fork evidence**, not a Base mainnet or public-testnet transaction and not a production wallet or hosted execution service. Gryloo never holds the wallet key. After PR #11 passed 4/4 checks, merge `4bf7d4f6e96c5ef433b0c930dad067d4001f2956` and successful post-merge checks, DEC-0030 accepted ADR-0004 and certified BUILD-003 `COMPLETE / CERTIFIED: FORK_REPRODUCED` on local chain 31337 only. No later-build implementation, public-chain, production, live-provider, wallet-custody or financial-execution authority is approved.

## BUILD-004 finite Mode B local fork (certified `FORK_REPRODUCED`, local chain 31337)

The approved [BUILD-004 plan](docs/builds/BUILD-004-PLAN.md) adds an opt-in Safe 1.4.1 plus Zodiac Roles 2.1.0 path for one exact Uniswap swap on local chain 31337. The app reviews the finite permission and separate owner transactions, displays remaining native-unit budget and residual token allowance, runs a browser-independent disposable executor, reconciles chain effects, and requests four distinct revocation signatures. The [report](docs/builds/BUILD-004-REPORT.md) records the automated local proof and the owner-operated MetaMask acceptance. DEC-0033 certifies BUILD-004 `COMPLETE / CERTIFIED: FORK_REPRODUCED` on local chain 31337 only, after PR #13 merged as `e71de3946c7aac6095023ca1ee6f1e1a58a98112` and both post-merge checks passed; this is not public-chain or production authority. DEC-0030 still certifies BUILD-003 only at `FORK_REPRODUCED`.


## BUILD-007 local composition (in progress)

The approved [BUILD-007 plan](docs/builds/BUILD-007-PLAN.md) adds one finite Safe/Roles USDC → WETH swap followed by a Safe-owned Uniswap v3 WETH/USDC fee tier 500 mint on local chain 31337. The new authoring, review, fixed worker and recovery path is opt-in. Synthetic rehearsals are `MOCKED`; a distinct read-only Base recording and closed fork evidence are required for any `FORK_REPRODUCED` claim. Earlier certified builds remain separate. No public-chain transaction, production wallet, real funds or PR merge is authorized.
