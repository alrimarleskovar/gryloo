# BUILD-003C — Read-only Base quote observation and BUILD-003B delivery records

Status: `LOCAL_ACCEPTANCE_PASSED`; implementation approved by the human owner on 2026-09-24. Remote PR CI is pending delivery.

**Choices made during planning:**

- **D-1: C.** The first read-only live-data increment.
- **D-2: A.** A local server transport behind one Server Action.
- **D-3: A, only for explicitly enabled local development.**
- **D-4: bounded recording.** One transcript per swap direction, at most four
  attempts and 84 read-only RPC requests in total. Stop on rate limiting or
  inconsistent responses. No CI live calls.
- **D-5: A.** An observation mode, with no new evidence environment.

**The owner then chose D-6 = B**, hash-pinned reads (§3.2.3), with these
conditions:

1. **Same block hash everywhere.** Every `eth_call` and `eth_getCode` read of
   an observation uses the same block parameter
   `{ "blockHash": H, "requireCanonical": true }`. The final block check is
   preserved.
2. **Support is verified during recording.** This happens in the authorized
   recording session (§3.5), within the total limit of four attempts and 84
   requests. The session is never restarted to renew those limits.
3. **No fallback.** If the endpoint does not support that form, the session
   stops and the diagnosis is recorded. There is no automatic fallback to
   block-number reads and no provider change.
4. **Local development only.** Live mode stays restricted to explicitly
   enabled local development. Production, CI and E2E make no live queries.
5. **Everything else is preserved:**
   - the separation between observations and `MOCKED` artifacts;
   - the protected files;
   - the dependencies;
   - the scope of 30 created and 35 modified paths.

   Observations remain `NOT_EVIDENCE` and never authorize execution.

**What the approval covers.** The owner explicitly approved:

- implementation of this plan on `codex/build-003c-mode-a-requirements-review`,
  from baseline `0faec71207628dfe27fb23c81680d2c27827f5ea`;
- the authorized recordings (§3.5);
- validations;
- the commit titled "Implement Build 003C read-only Base quote observation".

**Routine fixes.** Common implementation problems inside this scope may be
corrected without new approval. Work stops if a fix would change:

- the approved scope;
- the dependencies;
- a protected file;
- the strength of a check.

**Delivery.** The owner pushes from their own terminal. The agent then opens a
pull request into `main` with the GitHub CLI and inspects CI.

**Not approved:** merging, wallets, signing, authorization, execution and any
other build.

**Amendment 1 (owner-approved 2026-09-24, after an HTTP 429).** The first
recording attempt ended with `PROVIDER_RATE_LIMITED`.

- **First attempt.** HTTP 429 on request 12, the QuoterV2 `WETH9()` read, at
  2026-09-24T11:29:25Z. That result and its counters are preserved: 1 of 4
  attempts and 12 of 84 requests used. The stopped attempt is not a success,
  and neither cumulative limit is reset.
- **Resumption.** After a wait of at least ten minutes, a new attempt may use
  the remaining global budget of 3 attempts and 72 requests.
- **Request spacing.** Requests are spaced about 400 ms apart, start to start.
  The pause after the head block goes from 3 seconds to 1 second. The same
  spacing applies to the local live transport.
- **Unchanged:**
  - the 15-second freshness limit and the 20-second total-duration limit;
  - the stop-on-429 rule: another HTTP 429 stops recording, which is then
    reported;
  - no provider change, no looser time limits, no counter reset and no
    automatic retry;
  - reads stay read-only and hash-pinned, and every other approved scope item
    and safeguard is preserved.
- **Condition for continuing.** Implementation and acceptance checks continue
  only if the required recordings succeed.

**Amendment 2 (owner-approved 2026-09-24).** DEC-0021 supersedes the operative provider, credential, recording-budget and one test-scope terms below. The original public Base session is closed permanently at **2 of 4 attempts and 24 of 84 requests**, after HTTP 429 on request 12 in each attempt. Its results and counters remain historical and separate. The sole new provider is Alchemy Free Base mainnet at the fixed `https://base-mainnet.g.alchemy.com/v2` URL. The local development server reads `GRYLOO_ALCHEMY_API_KEY` from its process environment and sends it only in an `Authorization: Bearer` header; the key may not enter a URL, file, transcript, log, browser result or commit. The new recording session has a distinct persistent cap of **3 attempts and 63 requests** counted before send. No Alchemy request is authorized until the owner confirms a Free account and a privately supplied local server key. If setup needs a payment method, paid plan or charge for these calls, stop. The first authorized attempt verifies canonical hash-pinned `eth_getCode` and `eth_call`; unsupported pinning and all stated stop conditions end the session without fallback. The only additional modified baseline path is `apps/reference-dapp/e2e/fixtures.ts`, with `bypassCSP: negativeSelfTest` for the synthetic guard self-test alone. The scope is now **30 created and 36 modified paths**. Complete real replay, E2E, visual and governance acceptance before any commit. The owner handles push and merge.

**Amendment 3 (owner-approved 2026-09-24; DEC-0022).** On 2026-09-24 the owner reported that the first Alchemy HTTP 403 occurred while the existing Free app had no active endpoint or network. The owner has since enabled **Base Mainnet only** on that app; Base Sepolia and every other network remain disabled. No RPC request was made after this dashboard correction. The saved 403 response does not independently identify its cause, and canonical hash-pinned method support remains unverified. The owner explicitly approved this narrow exception on 2026-09-24. The original stop evidence and DEC-0021 limits remain binding except for the two precisely bounded continuation attempts below.

1. **Preserved evidence and counters.** Keep the public session stopped at **2/4 attempts and 24/84 requests** with both HTTP 429 results. Keep the original Alchemy `session.json` and `requests.jsonl` byte-identical: SHA-256 `b3747100197bb3656f4df0e9b1166f60ea1a10fe4909c72624dc0e23259c3ec3` and `d2c97c097d8c1444c094e6b80201fa26ae346b09cb62f4e2a49c90c81c5bacec`. They record HTTP 403 on attempt 1/request 1 (`eth_chainId`), with **1/3 attempts and 1/63 requests** consumed and `supportUnverified: true`. Do not clear the stopped flag, edit the original session, or start a fresh counter.
2. **Exact proposed continuation.** Under this explicit approval, create a separate credential-free continuation journal that verifies and links those two original digests and initializes cumulative counters at **1 attempt and 1 request**. Permit **one correction-specific retry** of the first direction (1 WETH → USDC) as attempt 2. Only if attempt 2 completes successfully and verifies both pinned methods may attempt 3 record the second direction (2,500 USDC → WETH). No fourth attempt, replay of a failed direction, or further retry is permitted. At most **2 additional attempts and 42 additional requests** may be sent, with at most 21 requests per observation; cumulative use may therefore reach at most **3/3 attempts and 43/63 requests**. The remaining nominal 20-request headroom cannot be used for another attempt or purpose. Count and persist each request before send across the original and continuation journals; fail closed on an interrupted or inconsistent journal.
3. **Provider and credential boundary.** Use only the existing Alchemy Free app with Base Mainnet enabled and the same fixed `https://base-mainnet.g.alchemy.com/v2` destination. Keep the API key only in the owner-controlled local server process environment and only in an `Authorization: Bearer` header. Never print, inspect, log, persist, transmit through chat, place in a URL or browser bundle, or commit it. Do not enable Base Sepolia or another network, create another account, use a paid plan, supply a payment method, incur a charge, or use another provider. Missing or malformed private configuration stops before any request.
4. **First-retry support and stop gates.** Attempt 2 must verify `{ "blockHash": H, "requireCanonical": true }` for `eth_getCode` (its request 3) and `eth_call` (its request 7) before any second-direction attempt. Keep the fixed method, target and selector allowlists, one request in flight, 400 ms spacing, 1-second head pause, 15-second freshness, 20-second duration and final block-hash consistency check. Stop the continuation immediately on HTTP 429 or any other non-200 response (including another 403), unsupported pinning, a non-quote JSON-RPC error, any inconsistency, code-digest mismatch, stale or noncanonical block, a cap breach, or a transport failure without an HTTP response. **No automatic retry and no no-response retry remain for this continuation.** No block-number, bare-hash or tag fallback, alternate URL or provider is permitted.
5. **Required evidence before acceptance.** Before any approved continuation request, verify the original digests and cumulative counters, the owner-reported Base Mainnet-only correction, the continuation journal's fail-closed behavior and all eligible offline checks. Record every allowed request's method, order, pin status, HTTP outcome and cumulative counters without a credential or sensitive response body. On a stop, retain the cause, original and continuation digests and counters; make no further request. On success, retain both complete raw transcripts with the same canonical hash pin within each observation, check matching code digests across directions, review and commit the code pins and replay fixture, and pass transcript-derived assertions, positive replay E2E, visual baselines and every governance gate before a BUILD-003C commit. Observations remain `NOT_EVIDENCE` and outside workflow authority; the owner retains push and merge. The owner may run the continuation command only after the separate journal and every offline precondition are validated; the agent does not make a live request.

**Amendment 3 completion (2026-09-24).** After the approved credential-free preflight, the owner executed the bounded continuation command once. Attempt 2 recorded 1 WETH → USDC and verified both canonical hash-pinned methods; attempt 3 then recorded 2,500 USDC → WETH. Each used 21 HTTP 200 requests, for **3/3 Alchemy attempts and 43/63 cumulative requests**. No further live request is authorized. The public session remains stopped at 2/4 attempts and 24/84 requests; the original Alchemy 403 files remain byte-identical at 1/3 attempts and 1/63 requests. Both transcripts, reviewed code pins, replay fixture, two new visual baselines and all local acceptance gates are documented in the [BUILD-003C report](BUILD-003C-REPORT.md). The owner's latest instruction authorizes the agent to commit, push this branch and open the PR after acceptance; only the owner may merge it. This delivery assignment supersedes the owner-push language above without changing the recording or product authority boundaries.

No Claude conversation or private memory is an authority source.

**Planning record.**

- Planning changed only this file, and restored the generated
  `apps/reference-dapp/next-env.d.ts` to its committed bytes after confirming
  it was generated (§2).
- No RPC request was made during planning.

The owner asked for these items. They map to the mandatory thirteen-section
template (Master Prompt §5.1):

| Requested item | Section |
|---|---|
| Smallest read-only increment and user-visible result | 1 |
| L-1 source and trust model | 3.2 |
| Proof that a displayed tier consumed the full input | 3.2.2 |
| Pinned block and final block-hash check, failing closed | 3.2.3 |
| L-2 where calls run | 3.3 |
| L-3 provider, local-development-only activation, keys and privacy, with the rate-limit correction | 3.4 |
| D-4 bounded recording session | 3.5 |
| L-4 evidence classification | 3.6 |
| L-6 on-chain verification | 3.7 |
| Separation from `MOCKED` artifacts; never an authorization input | 3.8 |
| Failure behavior | 3.9 |
| Exact network-rule changes | 3.10 |
| Provenance | 3.2–3.7 and 7 |
| Dependency impact | 3.13 and 10 |
| Tests | 5 and 6 |
| Exact file scope | 11 |
| BUILD-003B delivery update | 2 and 3.14 |
| Owner decisions and approval | Status and 13.1 |

## 1. Single objective

For each authored Base swap:

- obtain a real, read-only Uniswap v3 quote;
- verify on-chain the two Base assets it names, and the contracts it reads, in
  the same observation;
- record the result as a validated, hash-linked, revision-bound v1 Quote/State
  artifact with its raw transcript and provenance.

Live reads happen only in opt-in local development. The observation stays
separate from the BUILD-003B `MOCKED` chain and is never an authorization input.
The build also records the BUILD-003B delivery truthfully. Nothing becomes
authorizable, signable or executable.

### User-visible result

1. **A new region on Simulate.** Below the unchanged mocked artifact chain sits
   a separate region, **Base read-only observation**. It lists every authored
   swap, each with a **Read Base quote** button.
2. **What a read does.** The browser sends the current workflow and the swap's
   node ID only to the local reference server, on the same origin. The server
   reads Base mainnet at one pinned block (§3.2).
3. **What each swap shows:**
   - **Fee tiers.** Four rows in fixed order: fee 100, 500, 3000 and 10000, in
     hundredths of a basis point. Each row shows:
     - the observed pool address, or "no pool";
     - a status;
     - for `QUOTED` rows only, the quoted output for the exact authored input.
       This number appears only when full consumption of the input is proven
       (§3.2.2); otherwise it is withheld.

     Nothing ranks, recommends or labels a tier.
   - **Asset and deployment checks** (§3.7).
   - **Provenance:** mode, provider host, chain ID, block number, hash and time,
     retrieval time, expiry, request count, transcript hash and artifact hash.
   - **A mode label beside every quoted number:**
     - `LIVE READ-ONLY · NOT EVIDENCE`; or
     - `RECORDED REPLAY · NOT LIVE`.
   - **Collapsed copyable blocks:** the artifact JSON and the raw transcript.
   - **Disclosures:**
     - Base's statement that its public RPC is rate-limited and not suitable
       for production apps, and that this read is for local development only;
     - one provider;
     - the latest sealed block, which can still reorganize;
     - no minimum output, slippage bound or route choice;
     - gas, fees and price impact are not modeled;
     - "USD values: not modeled";
     - a read sends the pair and the amount to Base's public endpoint;
     - "Not an authorization input".
4. **Freshness.** An observation is current for 30 seconds from its block time.
   It becomes:
   - `EXPIRED` after that, or when the clock moves backwards;
   - `INVALIDATED BY EDIT` after any semantic edit.

   Starting a new read retires the previous observation for that swap. A
   retired observation is never reused.
5. **Failures.** Any failed check shows an explicit code and message, and no
   values (§3.9).
6. **Local development only.**
   - Live reads run only under `next dev` when the operator sets
     `GRYLOO_BASE_OBSERVATION=live`.
   - A production build (`next start`) refuses live mode.
   - Otherwise a read returns "Base reads are off on this server".
   - CI and E2E always use `replay` on committed recordings and never contact
     Base.
7. **Everything else unchanged:**
   - the mocked chain;
   - the unavailable Manifest review and Execute, which stay disabled
     unconditionally;
   - the `DRAFT` workflow state.

   Stale build labels in existing text become build-neutral (§3.11). The build
   label becomes `BUILD-003C`.
8. **Records.** The status documents record BUILD-003B's merge through PR #8 and
   its CI. The BUILD-003B plan and report stay byte-identical.

The user still cannot:

- connect a wallet;
- see a router, spender, recipient, approval or Permit2 address;
- obtain a minimum output, slippage bound, route recommendation or payload;
- compile an Authorization Policy or Strategy Manifest;
- sign, submit, execute or reconcile.

## 2. Relationship to v3.2

- **Sources.**
  - Master Spec:
    - §7.2;
    - §7.5 (every external observation records source, adapter, block,
      retrieval time, freshness, raw-response hash, normalized values, provider
      identifier, proposals, fees, gas, output bounds, uncertainty and registry
      validation; external data stays untrusted until validated; expired
      artifacts are never reused);
    - §15.1 (a direct Uniswap path first for same-chain swaps);
    - §17, §21 Phase 2, and Gates 1 and 2.
  - Master Prompt:
    - §1.6;
    - §2.5 (external responses are untrusted and are validated against the
      registry, allowlists, chain state and token metadata);
    - §2.6 (evidence labels);
    - §3.2 (no "best route" claim without criteria and provenance);
    - §4.1 P6;
    - Build 003 ("create validated Quote and State Artifacts", "inject …
      inconsistent RPC");
    - §5.
  - Governance: DEC-0019, the BUILD-003B plan and report, and ADR-0002.
- **Why this increment.** Every remaining Build 003 step needs live data first.
  This is the smallest useful read-only step.
- **Preserved differentiators.**
  - One revisioned IR.
  - Artifacts separated from intent.
  - External data untrusted until validated.
  - Mocked values are never reused as observations.
  - AI plays no role.
- **Product gate.** P6 is exercised with real data but is not certified. P7
  simulation remains mocked only. No policy, manifest or payload exists. No
  primitive is certified.
- **Dependencies.** BUILD-001 through BUILD-003B are merged. ADR-0001 remains
  `PROPOSED`.

### Authoritative sources for this plan (read 2026-09-24)

| Source | Location | SHA-256 of the retrieved file | Facts used |
|---|---|---|---|
| Base, Run a Node | https://docs.base.org/base-chain/node-operators/run-a-base-node.md (redirected to docs.base.org/specifications/node-operators/run-a-node.md) | `8dcf3955da25acb25b11b96d709c2f8844990ec765dec790968390b5940f04e6` | Lists `https://mainnet.base.org` as a free endpoint. "Our RPCs are rate-limited, they are not suitable for production apps." Directs production apps to a provider from the Base Services Hub |
| Base, Connect to Base | https://docs.base.org/get-started/connect-to-base.md | `cda7b0c411633a7b0b114f69425d90fdc6cff6a6d2a2a744af45698d80a49abb` | RPC endpoint `https://mainnet.base.org`; chain ID 8453 |
| Base RPC overview | https://docs.base.org/base-chain/api-reference/rpc-overview.md | `fe477a41f66f48e91b5f87c031d92ae3fa63c936ac821ff8808d2950f6bc21d1` | Public endpoints are HTTP only; `latest` is the most recently sealed block; `pending` is the Flashblock in progress |
| Base `eth_call` reference | https://docs.base.org/base-chain/api-reference/ethereum-json-rpc-api/eth_call.md | `7b9d7b54f8d201fab230365372573b0963772f7bc0603729203f7d36d1ee75ad` | The block parameter is a hex number or a tag; a block-hash object is not listed; error -32000 is "execution reverted" |
| Base docs index, full context | https://docs.base.org/llms-full.txt | `8e28924ed2b4258c09328893a0439985c283c8672083a25e5b0ede7034bcf0be` | "Treat 429 as rate-limited"; "handle occasional reorgs" |
| Base Denim upgrade overview | https://docs.base.org/upgrades/denim/overview.md | `19b6aba9c89054176f283e21b62df843bd79a0039db34739f4083bb77070b909` | Status "Planning", October 2026, for Sepolia and mainnet. 200 ms blocks. Optional `timestampMs` fields are added; "the existing seconds-based `timestamp` field is unchanged" |
| Uniswap v3 Base deployments | https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments (redirected from the docs.uniswap.org Base deployments page) | `da2c565a260fe0d598a2ddc372c7aeb0c561c7c268362f8fdb3880c02e6c69b1` | Base 8453: UniswapV3Factory `0x33128a8fC17869897dcE68Ed026d694621f6FDfD`, QuoterV2 `0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a`, WETH `0x4200000000000000000000000000000000000006` |
| `IQuoterV2.sol`, Uniswap/v3-periphery at `7c987c2a5131193d36d51001b1b04be907b0ba06` | contracts/interfaces/IQuoterV2.sol | `5b4556846b593ecf846b2a5b08953c3206f0901d5c071be8c6117c281df0db48` | Parameters and return values of `quoteExactInputSingle` |
| `QuoterV2.sol`, same commit | contracts/lens/QuoterV2.sol | `7c0a974a98e224b1ec63158bad6c13c73a659dec669dead1fd99a0b0d85418a6` | Zero price limit becomes `MIN_SQRT_RATIO + 1` or `MAX_SQRT_RATIO - 1`. The callback reads `pool.slot0()` and returns that price with the output, but not the input consumed |
| `PeripheryImmutableState.sol`, same commit | contracts/base/PeripheryImmutableState.sol | `3a69e6dbcf3f5a9a91ac2884373312241d0f5f444fcdb995ad52ff73bf425eaa` | Public immutable `factory` and `WETH9` |
| `UniswapV3Pool.sol`, Uniswap/v3-core at `b3884ced3b441fe0788c4ca2e561c79370905166` | contracts/UniswapV3Pool.sol | `96b70579f1bdbb28d05e42867a64d8653e2dda98c601f427c2405847a01163f2` | The swap loop condition at line 554, with no `break` in the file; `slot0` written at lines 642–650 before the callbacks at lines 675 and 681 |
| `SwapMath.sol`, same v3-core commit | contracts/libraries/SwapMath.sol | `d6cb9a153be4ea9fb2377ef88641ef7979b5cee6933162f1b732d0289e26e1b6` | A partial exact-input step consumes the remainder (`feeAmount = amountRemaining - amountIn`, line 93) |
| `TickMath.sol`, same v3-core commit | contracts/libraries/TickMath.sol | `83cf64b2ca84001effd16e007b49bac5359143b6c3132bfe42907b2426a0c5f5` | `MIN_SQRT_RATIO = 4295128739`, `MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342` |
| `IUniswapV3Factory.sol`, same v3-core commit | contracts/interfaces/IUniswapV3Factory.sol | `17c72e89a7d0eecca7929ca08d97f46e80930ef7024e4ccbc7b294c588477107` | `getPool` returns a pool or the zero address; the fee is in hundredths of a basis point |

**Correction to the previous draft.** The previous draft said that no cited Base
page stated rate limits or usage terms. That was wrong: Base's Run a Node page
states that its RPCs are rate-limited and not suitable for production apps.
This plan does not claim unrestricted use or production suitability anywhere.

The USDC and WETH identities come from the existing registry, which is
unchanged.

### Verified planning baseline, working tree and BUILD-003B delivery (2026-09-24)

- **Branches match.** Local `main`, local `origin/main` and GitHub `main`
  (authenticated GitHub API) resolve to
  `0faec71207628dfe27fb23c81680d2c27827f5ea`.
- **No open pull requests.**
- **SSH.** Shell `git fetch` over SSH still cannot authenticate from the agent
  shell. Transport settings were not changed.
- **`next-env.d.ts` was generated, and is now restored.**
  - A `next dev` process started at 11:07:05 local time. The file changed at
    11:07:08.
  - In Next 16.3.5's development phase, the build directory is `.next/dev`
    (`next/dist/server/config.js` line 1249).
  - Next's own generator (`writeAppTypeDeclarations`) produces, byte-for-byte:
    - the working copy, from `.next/dev`;
    - the committed copy, from `.next`.
  - The only differences were those two generated import lines. There were no
    user changes.
  - The process is no longer running. The file was restored, and its blob now
    equals `HEAD` (`ce4e94a6b10f160ee021fe18939af160d2927dcf`).
  - The working tree now differs from `main` only by this untracked plan.
- **Merge.** The owner account merged PR #8 at 2026-09-24T02:46:29Z as merge
  commit `0faec71…`:
  - parents: `36dd05e2bcea2d9a19c7b571d2126aea0390e5dd` and head
    `cee8ec17678997d2677ad813c9fafed87cc5b0ac`;
  - the merge tree equals the head tree
    `7e957f553eca7531a2587fe8804793cc075cf242`.
- **CI on the head commit passed:**
  - push runs: Governance 35948218571, contracts and reference app
    35948218817;
  - pull-request runs: Governance 35948277062, contracts and reference app
    35948277082.
- **Post-merge push on `main` passed:**
  - Governance run 35948667349 (job 107472223751);
  - contracts and reference app run 35948667352 (job 107472223580).
- **The historical report stays as written.** The BUILD-003B report was written
  before delivery and says remote CI was not part of its commit. It stays
  byte-identical:
  - plan SHA-256
    `e24eed8142b673b6df470fec54e9343aefed5ad12b31c96fb34a680a8f9dedef`;
  - report SHA-256
    `065635418aa6afdb9d604a699978019807e5162c4e3cfebede4072fe7c602c8e`.

  The facts above go into the living records instead (§3.14).

### Proposed requirement IDs (registered only after approval)

| Proposed ID | Requirement and source |
|---|---|
| B003C-OBSERVATION-001 | A read-only Base quote per authored swap from Uniswap v3 QuoterV2 at one pinned block, recorded as a validated v1 Quote/State artifact with a raw transcript; a number is shown only when full input consumption is proven; Master Spec §7.5, Master Prompt Build 003 |
| B003C-VERIFICATION-001 | Per-observation on-chain checks of chain, block consistency, code, code digests, asset metadata and deployment links, failing closed; Master Prompt §2.5 |
| B003C-NETWORK-001 | Egress only from a local development server to one fixed endpoint that Base documents as rate-limited and not for production. Method, target, selector, size, time, rate, per-process and breaker limits apply. The browser stays same-origin; CI and E2E use replay only; Master Spec §17 |
| B003C-FAILURE-001 | Every failure yields an explicit code and no partial values; inconsistent RPC responses are injected in tests; Master Prompt Build 003 |
| B003C-PROVENANCE-001 | Mode, host, block, times, transcript hash and artifact hash are visible, and the markers are in hashed fields; Master Prompt P6 and §2.6 |
| B003C-BOUNDARY-001 | Observations are never `MOCKED`, never evidence and never an authorization input; mocked values are never reused as observations; Master Spec §7.2, Master Prompt §1.6 |
| B003C-VISUAL-001 | Reviewed visual changes, then zero-pixel regression; Master Prompt §9.7 |
| B003C-COMPATIBILITY-001 | No contract, schema, compatibility-fixture, registry or dependency change; additive linter exports; ADR-0002 |
| B003C-GOVERNANCE-001 | BUILD-003B scope pinned historically; the exact BUILD-003C scope, network rules and consumer allowlist enforced; Master Prompt §5 |
| B003B-DELIVERY-001 | Retrospective: BUILD-003B merged through PR #8, with pull-request and post-merge CI passing; Master Prompt §5.5 |

## 3. Authorized scope

Nothing in this section is authorized until the owner approves this plan for
implementation (§13).

### 3.1 What is added

- **Linter observation module (pure, browser-safe, performs no I/O).**
  `packages/reference-linter/src/base-observation.ts` exports:
  - the frozen `BASE_OBSERVATION_PROFILE`;
  - `collectBaseTranscript(input, transport, clock)`, which runs the read plan
    and every check except the code-pin comparison, and returns the transcript;
  - `deriveBaseObservation(transcriptBytes, input, context)`, which decodes the
    transcript, applies every check including the code pins, and returns the
    artifact;
  - `reviewBaseObservation(...)`, the access and marker review.

  The transport is injected as an async function from request text to
  response text.
- **Server transport.** `apps/reference-dapp/src/server/base-rpc.ts` is
  server-only. It holds:
  - mode configuration;
  - the live HTTPS transport;
  - the replay transport;
  - process-wide limits and the breaker;
  - frozen Node validation of the artifact.
- **Server action.** `apps/reference-dapp/src/app/observation-action.ts` starts
  with `'use server'` and exports one action, `readBaseQuote`.
- **Browser verification, view model and a separate observation context.**
  `apps/reference-dapp/src/domain/base-observation.ts` and the store (§3.8).
- **Panel.** `apps/reference-dapp/src/components/observation-panel.tsx`.
- **Recorded replay fixture.**
  `apps/reference-dapp/e2e/observations/base-recorded-observations.json`. It
  holds exactly two live transcripts, one per direction (§3.5).
- **Records.** The BUILD-003B delivery update, the approval record, and this
  plan and its report.

Nothing else is added. In particular, there is:

- no Action Registry change;
- no router, SwapRouter02, UniversalRouter, Permit2, spender or recipient
  address;
- no new package, dependency, schema, hash domain or artifact kind.

The read-only factory and QuoterV2 addresses live only in the linter
observation profile.

### 3.2 L-1 Source and trust model

**Resolved by recommendation.** Read Uniswap v3 QuoterV2 and the factory
on-chain, through Base JSON-RPC `eth_call`, at one pinned block.

#### 3.2.1 Targets, read plan and encoding

**Read targets.** Base mainnet, chain ID 8453. Exact lowercase constants in the
profile:

| Target | Address | Source |
|---|---|---|
| USDC | `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` | Existing registry (BUILD-003A) |
| WETH | `0x4200000000000000000000000000000000000006` | Existing registry; also listed on the Uniswap Base page |
| UniswapV3Factory | `0x33128a8fc17869897dce68ed026d694621f6fdfd` | Uniswap v3 Base deployments page |
| QuoterV2 | `0x3d4e44eb1374240ce5f1b871ab261cd16335b76a` | Uniswap v3 Base deployments page |

**Read plan.** A fixed order, at most 21 JSON-RPC 2.0 requests, with IDs 1..n:

1. `eth_chainId`, which must return `0x2105`.
2. `eth_getBlockByNumber("latest", false)`, giving number N, hash H and
   timestamp T. `latest` is the most recently sealed block, not the Flashblocks
   `pending` state.
3. `eth_getCode(target, B)` for USDC, WETH, the factory and QuoterV2.
4. `eth_call` at B: `decimals()` and `symbol()` for USDC, then for WETH.
5. `eth_call` at B: QuoterV2 `factory()` and `WETH9()`.
6. `eth_call` at B: factory `getPool(tokenIn, tokenOut, fee)` for fees 100,
   500, 3000 and 10000.
7. `eth_call` at B: QuoterV2
   `quoteExactInputSingle((tokenIn, tokenOut, amountIn, fee, 0))` for each
   tier that has a pool, in the same order.
8. `eth_getBlockByNumber(N, false)`, the final consistency check (§3.2.3).

In steps 3 to 7, B is exactly the EIP-1898 object
`{ "blockHash": H, "requireCanonical": true }`, the same for every read of the
observation (D-6 = B). Every `eth_call` object is exactly `{to, data}`. It has
no `from`, `value`, `gas` or gas-price field, so no account is involved or
revealed.

**Encoding.** Six fixed selectors with hand-written static ABI encoding and
strict decoding, without an ABI library:

| Function | Selector |
|---|---|
| `decimals()` | `0x313ce567` |
| `symbol()` | `0x95d89b41` |
| `factory()` | `0xc45a0155` |
| `WETH9()` | `0x4aa4a4fc` |
| `getPool(address,address,uint24)` | `0x1698ee82` |
| `quoteExactInputSingle((address,address,uint256,uint24,uint160))` | `0xc6a5026a` |

The selectors were derived during planning with a scratch Keccak-256 that was
self-checked first. Tests re-derive them with a Keccak-256 embedded in the test
file.

Decoding is strict:

- exact return lengths;
- zero padding;
- `uint8`, `uint24`, `uint32` and `uint160` ranges;
- a zero-high-byte address;
- for `symbol()`: offset 32, length at most 32 and zero padding;
- JSON-RPC quantities and data as canonical lowercase hex.

**Rejected alternatives:**

- **The Uniswap Trading API or another routing API.** It needs a key and
  third-party terms, returns executable calldata or permit data, and cannot be
  reproduced at a pinned block.
- **Two sources with a cross-check.** Deferred.

One provider is used, and this is disclosed on every observation
(`SINGLE_PROVIDER`).

#### 3.2.2 Proof that a displayed tier consumed the full input

QuoterV2 does not return the input amount the pool actually consumed. The plan
therefore shows a tier's number only when the pinned sources prove full
consumption. Otherwise the number is withheld.

**Facts from the pinned sources (§2):**

1. **The loop's only exit.** `UniswapV3Pool.swap` loops
   `while (state.amountSpecifiedRemaining != 0 && state.sqrtPriceX96 != sqrtPriceLimitX96)`
   (line 554). The file contains no `break`, and the loop body has no `return`.
   The loop therefore ends only when the remaining input is zero or the price
   has reached the limit.
2. **Partial steps.** For exact input, each step subtracts
   `step.amountIn + step.feeAmount` (line 587). A step that stops short of its
   target price sets `feeAmount = amountRemaining - amountIn` (SwapMath line
   93), consuming the remainder exactly.
3. **Callback order.** After the loop, the pool writes
   `slot0.sqrtPriceX96 = state.sqrtPriceX96` (lines 642–650) before calling the
   swap callback (lines 675 and 681).
4. **What QuoterV2 returns.** Its callback reads `pool.slot0()` and returns that
   price as `sqrtPriceX96After` with the output amount. With a zero limit
   parameter, QuoterV2 passes the limit `L`:
   - `MIN_SQRT_RATIO + 1` (4295128740) when tokenIn sorts before tokenOut;
   - otherwise `MAX_SQRT_RATIO - 1`
     (1461446703485210103287273052203988822378723970341).

**Rule.** For a tier with a successful quote, `L` is determined by the
direction:

- If `sqrtPriceX96After != L`, facts 1 to 4 prove the loop ended with no
  remaining input. The full authored input, including the pool fee, was
  consumed, so the tier may be `QUOTED`.
- If `sqrtPriceX96After == L`, full consumption is not proven, and the pool may
  have run out of liquidity. The status is `FULL_INPUT_NOT_PROVEN`, and the
  number is withheld from the display and from the artifact.

**A number is displayed only when all of these hold:**

- the pool is non-zero, from the verified factory;
- the quote call succeeded;
- the return is exactly 128 bytes;
- `sqrtPriceX96After` lies strictly between `MIN_SQRT_RATIO` and
  `MAX_SQRT_RATIO` and differs from `L`;
- `amountOut > 0`, otherwise the status is `ZERO_OUTPUT` and there is no
  number;
- every whole-observation check passed.

**Limitation (disclosed as `SOURCE_EQUIVALENCE_NOT_VERIFIED`).** The proof
relies on the deployed bytecode behaving as the pinned source. This build
identifies the contracts by their documented addresses and trust-on-first-use
code pins. It does not compile the source to compare bytecode. Pool code is not
pinned, because each pool embeds its own immutables. Pool identity comes from
the pinned factory's `getPool`, and from QuoterV2 being bound to that factory.

#### 3.2.3 Block pinning and fail-closed consistency

**Pinning (D-6 = B).**

- Step 2 fixes N, H and T.
- Every later `eth_getCode` and `eth_call` sends the same block parameter
  `{ "blockHash": H, "requireCanonical": true }`, never a number or a tag.
- A node that lacks block H, or does not hold H on its canonical chain, must
  answer with an error instead of state from another block.
- Only the final check (step 8) addresses the block by number: canonical
  quantity N.

**Step 2 validation.**

- The result must be a non-null object.
- `number` must be a canonical quantity at most `2^53 - 1`.
- `hash` must be 32 bytes of data.
- `timestamp` must be a canonical quantity in seconds.
- Other block fields are ignored but kept in the transcript. Base's Denim
  upgrade adds optional millisecond fields and keeps `timestamp` in seconds.

**Pinned reads.**

- Any JSON-RPC error on a hash-pinned read fails the whole observation
  with `PINNED_READ_REJECTED`, carrying the provider's error code. Examples:
  - an unsupported block-parameter format;
  - an unknown hash;
  - a non-canonical hash.
- The only error that stays local to a tier is a quote revert, on the quote
  call alone. That means code 3, or code -32000 with a message beginning
  `execution reverted`.
- **No fallback.** There is no fallback to number-pinned or tag reads, and no
  other provider. The transport has no code path that sends a pinned read
  without the hash object.

**Final check (step 8).** `eth_getBlockByNumber(N, false)` must return a
non-null block whose `number` is N, `hash` is H and `timestamp` is T:

- a different hash gives `REORG_DETECTED`;
- a null result, or a different number or timestamp, gives `BLOCK_INCONSISTENT`.

**Monotonic head.** Within a server process, and within the recording session,
N must never be lower than a previously observed N (`BLOCK_INCONSISTENT`).

**Time.**

- T more than 15 seconds before completion gives `STALE_BLOCK`.
- T more than 2 seconds after completion gives `CLOCK_SKEW`.

**Envelope.** Each response must be one JSON object with:

- exactly `jsonrpc: "2.0"`;
- the same `id`;
- exactly one of `result` or `error`;
- no other keys.

Batch arrays, duplicate keys, extra keys or wrong types give
`RPC_RESPONSE_INVALID`.

**Consequence of any failure above.**

- The whole observation fails.
- No artifact or transcript is returned or displayed.
- The previous observation for that swap was already retired.
- In live mode, the process breaker trips (§3.4).

**Support and remaining trust (D-6 = B).**

- **Documentation.** Base's `eth_call` reference does not list the EIP-1898
  object form, so support is verified during the recording session (§3.5). If
  it is rejected, the session stops and the diagnosis is recorded.
- **What hash-pinning covers.** Every state read is bound to block H, even
  behind a load-balanced endpoint.
- **What it does not cover.** It still relies on the single provider honoring
  EIP-1898 semantics (`SINGLE_PROVIDER`). A block that is canonical at read
  time can still reorganize later (`UNSAFE_HEAD`).

#### 3.2.4 Tier statuses

| Status | Meaning |
|---|---|
| `NO_POOL` | `getPool` returned zero |
| `QUOTED` | All of §3.2.2 holds; the number is shown |
| `FULL_INPUT_NOT_PROVEN` | The price ended at the limit; the number is withheld |
| `ZERO_OUTPUT` | The output is zero; no number is shown |
| `QUOTE_REVERTED` | The quote call alone reverted |

Only `QUOTED` rows carry a number. The order is fixed, and nothing is ranked
or recommended. `gasEstimate` and `initializedTicksCrossed` stay in the
transcript only.

**Summary:**

| Aspect | L-1 |
|---|---|
| Failure behavior | §3.2.3 and §3.9. Only a quote revert is local to its tier |
| Provenance | Sources and digests in §2. Every request and response is in the transcript, and the artifact fields are in §7 |
| Tests | §6 |
| Dependency impact | None. No ABI or Ethereum library; Keccak exists only inside a test file |
| Network rules | None by itself: the linter module performs no I/O |

### 3.3 L-2 Where calls run (D-2 = A)

**Flow:**

1. The panel calls `readBaseQuote({ workflow, nodeId })`, a same-origin POST.
2. The action validates the input:
   - a closed object;
   - `validateAuthoringWorkflow`;
   - the node is a swap;
   - the payload is within Next's default body limit.
3. The action calls `collectBaseTranscript` through the configured transport,
   then `deriveBaseObservation` with the committed pins.
4. It validates the artifact with the frozen Node `hashArtifactBytes`.
5. It returns `{ ok: true, transcript, artifact }` or
   `{ ok: false, code, message, requestsSent }`.

**Browser verification before display:**

- The BUILD-003B digest self-check runs.
- The raw-response digest over the received transcript must equal
  `rawResponseHash`.
- The artifact re-derived from the transcript alone must deep-equal the
  received artifact.
- The semantic workflow hash must equal the current workflow's.

**Live transport rules:**

- **One destination.** The literal `https://base-mainnet.g.alchemy.com/v2`.
- **Request shape.**
  - `POST` with `content-type: application/json`.
  - No cookies. The only added header is server-only `Authorization: Bearer` from the local process environment.
  - `redirect: 'error'` and `cache: 'no-store'`.
- **Time limits.** 5 seconds per request and 20 seconds per observation.
- **Response checks.**
  - HTTP 200 with a JSON content type.
  - At most 131,072 bytes per response, enforced while streaming.
  - Parsed with the frozen `parseJsonBytes`.
- **Requests.**
  - Only the four methods.
  - At most 21 per observation.
  - Each is re-checked against the method, target and selector allowlists
    before sending.
- **Transcript size.** At most 1,048,576 bytes.

**Replay transport:**

- It reads only the fixed committed file.
- It matches every request byte-for-byte and never calls `fetch`.
- It marks the transcript `RECORDED_REPLAY` with the recording's times.

**Modes.** The server environment variable `GRYLOO_BASE_OBSERVATION` accepts:

- unset or `off`: off;
- `live`: development phase only (§3.4);
- `replay`;
- any other value: `CONFIGURATION_INVALID`.

No URL or file path comes from the environment. Live mode requires a server-only `GRYLOO_ALCHEMY_API_KEY` value; missing or malformed configuration fails before a request.

### 3.4 L-3 Provider and activation (D-3 = A, opt-in local development only)

**What Base says.** Base lists `https://mainnet.base.org` as a free endpoint
and states: "Our RPCs are rate-limited, they are not suitable for production
apps."

**Scope of use.** Alchemy Free is used only for opt-in local
development. It makes no claim of unrestricted use or production suitability:

- in the interface;
- in the README and records;
- in the report.

**Enforced activation:**

- **Development phase only.**
  - Live mode works only when Next runs in its development phase (`next dev`,
    where Next sets `NODE_ENV` to `development` and inlines it at build).
  - It also requires `GRYLOO_BASE_OBSERVATION=live`.
  - A production build (`next start`) with `live` returns
    `CONFIGURATION_INVALID`: "Live Base reads are for local development only".
- **Loopback.** The existing scripts bind the server to `127.0.0.1`.
- **Off by default.** CI and E2E use `replay` under `next start`, so live mode
  is refused twice over.

**Process-wide live limits.** These are held on `globalThis`, so development
module reloads cannot reset them:

- at least 10 seconds between live observation starts, and one in flight;
- about 400 ms between consecutive requests, start to start (Amendment 1);
- at most 3 live observation attempts and 63 requests per server process. The separate recording harness persists its own 3/63 counters across processes.

After that the process answers `LIVE_LIMIT_REACHED` until it restarts.

**Breaker.** The first provider failure trips the breaker, and live reads stop
for the rest of the process (`LIVE_SESSION_STOPPED`). Provider failures are:

- HTTP 429;
- any other non-200 status;
- a JSON-RPC error other than a quote revert;
- any inconsistent response (§3.2.3, §3.7);
- a transport failure.

There is no automatic retry after a provider response, including HTTP 429.

**Keys.**

- The owner supplies an Alchemy Free key privately to the local server process environment only after confirming Free account setup.
- No repository secret, `.env` file, URL parameter, transcript, log, browser response or commit may contain the key.
- The server rejects missing or malformed credentials before any live request.

**Privacy.**

- **What the provider sees:**
  - the server's IP and request timing;
  - the token pair;
  - the exact input amount;
  - the queried contracts.
- **What it never sees:**
  - a wallet or user address;
  - cookies.
- **Disclosure.** The panel says this before the first read.

**Retention.**

- **Server:** keeps nothing.
- **Browser:**
  - keeps observations in memory only;
  - discards them on reload;
  - uses no browser storage.

**Hosting.** Not approved. Live mode refuses to run outside the development
phase.

### 3.5 D-4 Bounded recording session

The recording is the only live-network activity in implementation. It is
authorized only as follows:

- **Purpose.** Exactly two transcripts, one per direction, recorded with the
  E2E amounts:
  - 1 WETH → USDC;
  - 2,500 USDC → WETH.

  After these, no further request is made.
- **When.** Only after the owner confirms the Alchemy Free account and privately supplied local server key, after offline checks pass, and before the code pins exist.
- **Harness.** A short script in the agent's scratchpad. It is not committed,
  and its SHA-256 and full request log go into the report.
  - It imports the built linter's `collectBaseTranscript`, which runs every
    check except the code-pin comparison.
  - It drives a capped transport with the same rules as the product's live
    transport.
- **Hard caps.** Over the whole session, across all processes:
  - at most 3 attempts;
  - at most 63 requests, counted before sending, so the 64th request is refused
    and never sent.

  There is one harness run, and it is never restarted to reset the caps.
- **Stop conditions.** The session ends immediately on the first of these:
  - HTTP 429 or any other non-200 response;
  - a JSON-RPC error other than a quote revert;
  - any inconsistent response under §3.2.3 or §3.7;
  - a block number lower than the previous attempt's;
  - code digests that differ between the two transcripts.

  A transport failure with no HTTP response (connection error or timeout) may
  use a remaining attempt after 10 seconds, within the caps. It is the only
  case that may.
- **Hash-pinned read support (D-6 = B).**
  - The first attempt verifies both hash-pinned `eth_getCode` (request 3) and `eth_call` (request 7) support.
  - If Alchemy rejects the `{ "blockHash": H, "requireCanonical": true }`
    form, the session stops.
  - The report records the diagnosis: the exact request, the HTTP status, and
    the JSON-RPC error code and message.
  - There is no fallback to block-number reads or another provider.
- **After a stop.** No further request. The report records the stop, and the
  agent waits for your instruction.
- **Code pins.**
  - The four code digests must be identical in both transcripts. They then
    become the committed pins.
  - The report lists the pins, blocks, hashes, times, host, request counts and
    outcomes for your review.
  - From that point on, every check, including the pins, runs offline against
    the recordings.
- **Pause after the head read.** 1 second (Amendment 1; originally 3 seconds).
- **Attempt 1 result (preserved).**
  - It stopped with `PROVIDER_RATE_LIMITED`: HTTP 429 on request 12 (QuoterV2
    `WETH9()`), with no `Retry-After` header.
  - Requests 1 to 11 were accepted. Requests 3 to 11 carried
    `{ "blockHash": H, "requireCanonical": true }` and were answered.
  - No transcript was recorded.
  - Used: 1 of 4 attempts and 12 of 84 requests.
- **Resumption under Amendment 1.**
  - The same session continues with its persisted counters, at least ten
    minutes after the stop.
  - Requests are spaced about 400 ms apart, start to start.
  - The time limits are unchanged.
  - Another HTTP 429 stops recording for good under this approval.
  - The session is resumed exactly once.
- **Final public-endpoint result (2026-09-24).** The single authorized resumption
  ended with HTTP 429 on request 12, again the hash-pinned QuoterV2 `WETH9()`
  read. It stopped at 2026-09-24T11:40:08.029Z with no `Retry-After` header.
  The persisted session now records 2 of 4 attempts and 24 of 84 requests,
  zero transcripts and no completed head. These counters and both stopped
  attempts are preserved; the public-endpoint recording is over under
  Amendment 1. The [in-progress report](BUILD-003C-REPORT.md) holds the full
  request summary and the subsequently approved Amendment 2.
- **No CI live calls.** Enforced by §3.10 rows 10 and 11.

### 3.6 L-4 Evidence classification (D-5 = A)

**The ruling.** Observations carry an observation mode instead of an evidence
environment, and every observation is `NOT_EVIDENCE`:

- `LIVE_READ_ONLY`: read now from the provider.
- `RECORDED_REPLAY`: served from a committed recording. It is historical.

**Build evidence labels.**

- This build's integration proofs stay `MOCKED`: scripted transports and the
  recorded replay.
- The recording session is reported as a fact, not as evidence maturity.
- The build's financial evidence environment and outcome remain
  `NOT_APPLICABLE`.
- No schema changes. BUILD-003B's C-1 gap remains.

**Hashed markers:**

- the `OBSERVED.` ID prefix;
- `sourceId` `base.json-rpc`;
- adapter `base.uniswap-v3-quoter-v2` version `1.0.0`;
- the `observation-mode` value;
- uncertainty codes, including `NOT_EVIDENCE`.

**Display.** The top bar's `MOCKED` badge stays, because it describes the build
and the mocked chain. `EVIDENCE_LEVELS.md` gains the vocabulary.

### 3.7 L-6 On-chain verification

**Resolved by recommendation.** Every check runs at block N and fails closed.

| Check | Rule | Failure code |
|---|---|---|
| Chain | `eth_chainId` is `0x2105` | `WRONG_CHAIN` |
| Code present | `eth_getCode` is not `0x` for USDC, WETH, the factory and QuoterV2 | `CODE_MISSING` |
| Code digest | The SHA-256 of the code bytes equals the committed pin (§3.5) | `CODE_DIGEST_MISMATCH` |
| Asset metadata | Decimals and symbol equal the registry: USDC 6 and `USDC`; WETH 18 and `WETH` | `ASSET_METADATA_MISMATCH` |
| Deployment links | QuoterV2 `factory()` equals the factory; `WETH9()` equals the WETH asset | `DEPLOYMENT_MISMATCH` |
| Block consistency | §3.2.3 | `REORG_DETECTED`, `BLOCK_INCONSISTENT`, `STALE_BLOCK`, `CLOCK_SKEW` |

**Code pins.**

- They are trust on first use from a single provider (§3.5), recorded for
  review.
- They detect later code differences. They do not prove authenticity.
- For proxies, only the proxy code is pinned (`IMPLEMENTATION_NOT_PINNED`).

**Registry status.** The registry's static `NOT_ONCHAIN_VERIFIED` stays; the
registry is byte-identical. Nothing is cached across observations.

### 3.8 Separation from `MOCKED` artifacts; never an authorization input

**From the BUILD-003B `MOCKED` chain:**

- **Distinct identity.** Observations have their own:
  - ID prefix, source, adapter and mode;
  - review;
  - context and region.

  They never enter the mocked Artifact Set or Simulation Bundle, and no live
  bundle exists.
- **No shared data path.** `mocked-chain.ts`, `mock-artifacts.ts` and
  `artifact-chain.ts` stay byte-identical. A governance scan forbids imports
  between the observation and mocked modules in both directions.
- **Cross-rejection.** `reviewMockedArtifactChain` rejects observations, and
  `reviewBaseObservation` rejects every `MOCKED` marker
  (`MOCK_MARKER_FORBIDDEN`).
- **Proven by tests.** Each is byte-identical with or without the other. The
  observation region has no `data-mocked-value`, `MOCKED` marker or synthetic
  rate.
- **No fallback.** A failed read never falls back to mocked values.

**Never an authorization input in this build:**

1. **No consumer can receive it.** A new governance scan limits the observation
   tokens to an allowlist of files:
   - tokens: `base-observation`, `observation-action`, `readBaseQuote`,
     `collectBaseTranscript`, `deriveBaseObservation`,
     `reviewBaseObservation`, `BASE_OBSERVATION_PROFILE`,
     `useBaseObservations`;
   - files:
     - `packages/reference-linter/src/base-observation.ts` and `index.ts`;
     - `apps/reference-dapp/src/server/base-rpc.ts`;
     - `src/app/observation-action.ts`;
     - `src/domain/base-observation.ts`;
     - `src/state/workflow-store.tsx`;
     - `src/components/observation-panel.tsx`;
     - their tests;
     - the contracts integration test.

   `app-shell.tsx` only renders the panel. The editor, commands, lint, review
   panel, summary bar, artifact inspector and mocked modules cannot reference
   observations.
2. **Not in the workflow state.** Observations live in a separate context
   exposed only by `useBaseObservations`. No editor command carries
   observation data. Tests prove the IR hash and revision are identical before
   and after reads.
3. **No authorization-shaped content.**
   - `outputBounds` and `proposedContracts`, `proposedSpenders` and
     `proposedRecipients` are empty.
   - `providerReference` is `NONE`.
   - A withheld tier carries no number at all.
4. **No authorization machinery exists.**
   - No policy, manifest, plan, journal or evidence type appears in
     application or linter source (the existing scan).
   - No compiler package exists (the package-set check).
   - The review's `authorizable: false` and `executable: false` are literal
     types.
5. **No enabling path.**
   - Manifest review and Execute buttons are disabled unconditionally, with no
     state dependency.
   - The workflow stays `DRAFT`.
   - E2E proves both after reads.
6. **Records.** The decision row, `AUTHORITY_MATRIX.md` and `SCOPE_GUARD.md`
   state that BUILD-003C observations are not authorization inputs. Using them
   as an input needs later decisions (A-1 to A-4).

### 3.9 Failure behavior

All failures are closed:

- nothing partial is displayed;
- the previous observation for that swap is already retired;
- the panel shows the code and a plain message.

| Code | Where | Trigger | Live breaker |
|---|---|---|---|
| `OBSERVATION_OFF` | Server | Mode unset or `off` | — |
| `CONFIGURATION_INVALID` | Server | Unknown mode, or `live` outside the development phase | — |
| `THROTTLED` | Server | A read is in flight, or less than 10 seconds since the last live start | — |
| `LIVE_LIMIT_REACHED` | Server | 3 attempts or 63 requests used in this process | — |
| `LIVE_SESSION_STOPPED` | Server | The breaker tripped earlier in this process | — |
| `INPUT_INVALID` | Server | Malformed input, invalid IR, the node is not a swap, or an oversized body | — |
| `PROVIDER_RATE_LIMITED` | Server | HTTP 429 | Trips |
| `PROVIDER_ERROR` | Server | Other non-200 status, or a JSON-RPC error on a step 1, 2 or 8 read | Trips |
| `PINNED_READ_REJECTED` | Server | A JSON-RPC error on a hash-pinned read other than a quote revert, including an unsupported block-parameter format (§3.2.3) | Trips |
| `TRANSPORT_FAILED` | Server | Connection error, timeout, redirect, wrong content type, oversized response or overall deadline | Trips |
| `RPC_RESPONSE_INVALID` | Server and browser | §3.2.3 envelope rules, non-canonical hex or an ABI decode failure | Trips |
| `WRONG_CHAIN`, `REORG_DETECTED`, `BLOCK_INCONSISTENT`, `STALE_BLOCK`, `CLOCK_SKEW` | Server and browser | §3.2.3 | Trips |
| `CODE_MISSING`, `CODE_DIGEST_MISMATCH`, `ASSET_METADATA_MISMATCH`, `DEPLOYMENT_MISMATCH` | Server and browser | §3.7 | Trips |
| `REPLAY_MISMATCH` | Server | A replay request differs from the recording | — |
| `TRANSCRIPT_TOO_LARGE`, `REQUEST_BUDGET_EXCEEDED` | Server | Above 1,048,576 bytes or 21 requests | Trips |
| `INTERNAL_ERROR` | Server | An unexpected exception, reported without details | Trips |
| `DIGEST_UNAVAILABLE`, `RAW_HASH_MISMATCH`, `DERIVATION_MISMATCH`, `WORKFLOW_BINDING_MISMATCH`, `MOCK_MARKER_FORBIDDEN` | Browser | Re-verification failures (§3.3) | — |

A dash means the code is produced before any request is sent, or outside live
mode. **Per-tier outcomes** (§3.2.4) are not failures.

### 3.10 Exact network-rule changes

| # | Rule | At `0faec71` | After BUILD-003C |
|---|---|---|---|
| 1 | Remote URL literals in application and linter source (governance) | Forbidden everywhere | One exemption: `https://base-mainnet.g.alchemy.com/v2` exactly once, only in `apps/reference-dapp/src/server/base-rpc.ts` |
| 2 | Network primitives: `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon` (governance) | Forbidden everywhere | `fetch(` exactly once, only in `base-rpc.ts`; the rest remain forbidden everywhere |
| 3 | Wallet and signing tokens (governance) | Forbidden | Unchanged, and applied to the new files |
| 4 | Node network modules: `node:http`, `node:https`, `node:net`, `node:tls`, `node:dgram`, `node:dns`, `http2`, `undici`, `child_process` | Not scanned | New scan: forbidden in application and linter source |
| 5 | JSON-RPC method literals | Not scanned | New scan: in non-test source, only `eth_chainId`, `eth_getBlockByNumber`, `eth_getCode` and `eth_call`, and only in the linter observation module and `base-rpc.ts` |
| 6 | Four-byte selector literals | Not scanned | New scan: non-test application and linter source may contain only the six read selectors |
| 7 | Server boundary | None | New scan: only `src/server/**` and the action file may import from `src/server/`. The action file's first statement after the SPDX comment is `'use server'`. No server file contains `'use client'`. The linter observation module has no `node:` import |
| 8 | Browser egress | E2E guard allows only `http://127.0.0.1:3000` | Guard unchanged. `next.config.ts` sends `Content-Security-Policy: connect-src 'self'` on every route, checked by governance and E2E |
| 9 | Mocked/observation separation and the consumer allowlist | None | New scans (§3.8) |
| 10 | CI live access | None needed | `playwright.config.ts` sets `GRYLOO_BASE_OBSERVATION=replay` and throws on any other value. Governance rejects any `GRYLOO_BASE_OBSERVATION` text in `.github/workflows/*` |
| 11 | Live mode | Not present | Development phase only, with process-wide limits and the breaker (§3.4). Unit tests prove refusal under production |
| 12 | Secrets and environment files | Forbidden | Unchanged |

### 3.11 Existing-screen changes

The only route stays `/`. Paths below are under `apps/reference-dapp/src/`.

| Deliberate visible change | Path | Affected snapshots |
|---|---|---|
| Build label `BUILD-003C`, page title and description | `config/product.ts`, `app/layout.tsx` | All eight existing |
| New Base read-only observation region below the chain | New `components/observation-panel.tsx`; `components/app-shell.tsx`; `app/globals.css` | `simulate`, `simulate-current`, `simulate-invalidated`, `simulate-expired`, plus two new |
| Build-neutral text replaces stale build labels: the unavailable-button names, the Execute and Simulate explanations, and the canvas footer | `components/summary-bar.tsx`, `components/app-shell.tsx`, `components/simulate-panel.tsx`, `components/workflow-canvas.tsx` | Simulate, Execute and Build states |

The Execute text says that neither mocked artifacts nor read-only Base
observations can authorize execution. `interface-honesty.spec.ts` and
`mock-artifact-chain.spec.ts` change only in the assertions that quote the old
labels and text.

**Colors.** The observation region uses a neutral blue-grey border and its own
badge tone. Nothing is amber (mocked) or green.

**Controls.** The only enabled control added is **Read Base quote**. The E2E
authority scan still rejects enabled controls whose names mention signing,
approval, authorization, submission, execution, a wallet or a connection.

### 3.12 Visual evidence process

The process repeats the BUILD-003B method:

1. At exact baseline `0faec71`, reproduce all eight existing snapshots with the
   approved browser (1440×900, en-US, light theme, reduced motion). Confirm
   strict RGB equality.
2. Retain those images as `*-before.png`.
3. Capture after images under the same settings and the same fixed clock.
4. Inspect every difference against §3.11. Retain strict-RGB diff images, and
   record the counts and hashes.
5. Only then let Playwright write the baselines. Confirm each one is
   pixel-identical to the inspected after image.

Add two inspected full-page snapshots from the replay fixture under a fixed
clock:

- `observation-recorded`;
- `observation-expired`.

All runs keep `maxDiffPixels: 0` with no masking or widened tolerance.

### 3.13 Workspace, dependencies, browser and CI

- **Dependencies.**
  - No new package, dependency or dependency edge.
  - The transcript uses the linter's existing `canonicalize` 5.0.0; the live
    transport uses Node's built-in `fetch`.
  - `pnpm-lock.yaml` and `scripts/bootstrap-ci.py` are unchanged.
  - 245 registry identities and 16 exceptions.
  - The SBOM accounting and `pnpm audit` inputs are unchanged.
- **Toolchain.**
  - Node 24.21.0, pnpm 11.22.0 and Playwright 1.63.0.
  - The approved headless shell, revision 1243, SHA-256
    `a9da028861a0cf789ff25c2fed45f5f1aaf969ed9247835b6a7821a4f7af9d1d`.
- **Contracts workflow.**
  - The linter export check adds `BASE_OBSERVATION_PROFILE`,
    `collectBaseTranscript`, `deriveBaseObservation` and
    `reviewBaseObservation`.
  - It requires the profile to be frozen, with exactly four 64-hex code pins.
  - E2E runs in replay under `next start`.
  - No step sets `GRYLOO_BASE_OBSERVATION` or contacts Base.

### 3.14 Governance transition after approval, including the BUILD-003B delivery update

- **Decision.** Record the approval as the next sequential decision (number
  0020 at this baseline; re-read the register first). It must include:
  - D-1 = C;
  - D-2 = A;
  - D-3 = A for opt-in local development only, with Base's rate-limit
    statement;
  - the D-4 caps and stop conditions;
  - D-5 = A;
  - D-6 = B and its five conditions;
  - Amendment 1: the preserved first-attempt result, the 400 ms spacing, the
    1-second pause and the unchanged limits;
  - the §3.10 rules;
  - "not an authorization input";
  - the owner's merge of BUILD-003B through PR #8 as `0faec71`.

  Add a marker check for it.
- **Requirements.**
  - Register the §2 IDs.
  - Point the BUILD-003B index note to B003B-DELIVERY-001.
  - Leave historical rows unchanged.
- **Delivery facts.**
  - `STATUS.md`, `README.md` and `NEXT_BUILD.md` record BUILD-003B as merged
    through PR #8 as `0faec71`, with the merge time and the §2 run IDs.
  - The BUILD-003B plan and report remain byte-identical.
- **Historical BUILD-003B scope.**
  - A fixed Git-tree comparison from `36dd05e…` to `0faec71…`.
  - Use the unchanged 25/34 sets, with no deletions and `100644` modes.
  - CI fetches `0faec71` explicitly.
  - The earlier historical checks stay unchanged.
- **Current BUILD-003C scope.**
  - Compare `0faec71` to the reviewed tree, including staged, unstaged and
    untracked files, against the amended §11 lists (30 created, 36 modified).
  - Reject deletions, symlinks, executable modes and unlisted paths.
- **Protected digests.**
  - Add the BUILD-003B plan and report digests.
  - Verify the BUILD-003B images from Git blobs at `0faec71`.
  - Check the new images and the replay fixture against the digests recorded
    in the report.
- **Templates.**
  - Add the BUILD-003C plan (13 headings) and report (14 headings).
  - The allowed BUILD-003 document set becomes the 003A, 003B and 003C plans
    and reports.
- **Authority matrix.**
  - Add a `BUILD-003C` `APPROVED` row: read-only Base observation, local
    development only, not an authorization input.
  - Rename the not-approved row to "Later BUILD-003 stages, wallet, signing or
    financial execution" `NOT_APPROVED`.
  - Update the regular expressions accordingly.
- **Status markers.**
  - `STATUS.md` must contain `BUILD-003C` and
    `0faec71207628dfe27fb23c81680d2c27827f5ea`.
  - `NEXT_BUILD.md` retains `NONE_APPROVED` and the BUILD-003C authority.
- **Scans.** All §3.10 rules. Every existing scan stays.
- **Living records.**
  - Update STATUS, NEXT_BUILD, AUTHORITY_MATRIX, EVIDENCE_LEVELS, SCOPE_GUARD,
    SECURITY_MODEL (egress, Base's rate-limit statement, privacy,
    single-provider trust and hash-pinned reads), README, and the
    approved-plan list in LICENSE_MAP.
  - `NEXT_BUILD` ends as `NONE_APPROVED`.
- **Delivery constraint.** Current governance CI rejects any tree containing
  this plan, for three reasons:
  - an unexpected path;
  - an unexpected BUILD-003 document;
  - unregistered IDs.

  The plan therefore ships only with the implementation, as BUILD-003A and
  BUILD-003B did.

## 4. Out of scope

- Production or hosted use of live reads, and any claim of production
  suitability or unrestricted use of Base's public endpoint.
- Wallet connection, owner or recipient input, balances and allowances.
- Router, SwapRouter02, UniversalRouter, Permit2, spender or recipient
  addresses, and any Action Registry change.
- Minimum output, slippage bounds, route selection or ranking, and any "best"
  claim.
- Using an observation as an authorization input in any form.
- Transaction construction, calldata for any state-changing function, and
  payload or intent hashes.
- Approvals, signatures, submission and execution.
- Authorization Policy, Strategy Manifest, Execution Plan, journal,
  reconciliation and Evidence Bundle.
- Feeding observations into the mocked Artifact Set or Simulation Bundle, or
  creating a live Simulation Bundle.
- Other providers, any fallback to number-pinned or tag
  reads, WebSocket RPC,
  the Flashblocks `pending` state, other chains, other tokens, and multi-hop
  quotes.
- Automatic retries after a provider failure.
- CI or E2E live calls, and any recording beyond §3.5.
- Fork, testnet and mainnet execution environments; persistence; hosting;
  external AI.
- New dependencies, packages, schemas or hash domains.
- Mode B, Mode C and package publication.
- Treating any BUILD-003B mocked value as evidence, input, observation or
  authority.

## 5. Acceptance criteria

- [x] **Request sequences.** For both directions, a scripted transport receives
  the exact §3.2.1 sequence:
  - allowlisted methods, targets and selectors only;
  - every `eth_call` and `eth_getCode` carries exactly
    `{ "blockHash": H, "requireCanonical": true }`;
  - no `from`, `value` or `gas` field.
- [x] **Full-input rule.** A tier shows a number only under §3.2.2:
  - the limit value withholds it, in both directions;
  - limit ± 1 shows it;
  - out-of-range prices and wrong lengths fail as invalid.

  No withheld number appears in the display, the view model or the artifact.
- [x] **Block consistency.** Every §3.2.3 inconsistency fails the whole
  observation, returns no artifact or transcript, and trips the breaker in
  live mode. A rejected hash-pinned read gives `PINNED_READ_REJECTED`, and no
  further request follows. No fallback exists.
- [x] **Artifact.** The derived artifact:
  - passes the frozen `hashArtifactBytes`;
  - equals the browser digest;
  - matches the raw-response digest of the transcript;
  - binds the current workflow revision and node.
- [x] **On-chain checks.** Every §3.7 check passes on both recordings and fails
  closed when perturbed.
- [x] **Live mode limits.**
  - Refused under a production build.
  - The process limits hold (3 attempts, 63 requests).
  - The breaker stops live reads after any provider failure.
  - No retry happens.
- [x] **No overclaiming.** The interface and records disclose Base's rate-limit
  statement and local-development-only use. No text claims production
  suitability or unrestricted use.
- [x] **Separation.** Cross-rejection holds, each side is unaffected by the
  other, and no mocked value, marker or rate appears in the observation
  region.
- [x] **Never an authorization input.**
  - The consumer allowlist holds.
  - The IR hash and revision are unchanged by reads.
  - Authority-shaped fields are empty.
  - The flags are literal.
  - Manifest review and Execute stay unconditionally disabled.
  - The workflow stays `DRAFT`.
- [x] **Freshness and invalidation.** Expiry, backward clocks, tab resume and
  semantic edits retire observations.
- [x] **Network rules.** Every §3.10 rule holds, and each new rule fails in an
  isolated negative copy. The E2E guard records no external request. The CSP
  header is present.
- [x] **Recording.** The session stayed within the D-4 caps and stop
  conditions, and verified hash-pinned read support (or stopped with a recorded
  diagnosis). The report records its log, harness digest, pins, blocks,
  hashes, times and counts.
- [x] **Visual evidence.** Before/after/diff evidence accounts for all eight
  changed snapshots. Both new snapshots pass at zero pixels. Keyboard checks
  and 375/768/1280 checks pass.
- [x] **Protected identities.** Contracts, schemas, fixtures, registry,
  lockfile and historical records keep their protected identities.
- [x] **Governance.** Historical and current governance gates pass.
- [x] **Delivery records.** The BUILD-003B delivery facts are recorded
  truthfully.
- [x] **Report.** The report separates local results, the recording session,
  remote CI and missing evidence.

## 6. Required tests

All acceptance tests run on the pinned toolchain. Only the §3.5 recording
contacts Base.

**Linter unit tests (`base-observation.test.ts`, scripted transports):**

- **Read plan:**
  - golden request sequences for both directions;
  - selectors re-derived with the in-test Keccak-256;
  - strict decoding;
  - the request budget.
- **Full-input rule:**
  - `sqrtPriceX96After` equal to the limit in each direction →
    `FULL_INPUT_NOT_PROVEN`, number absent from the artifact;
  - limit ± 1 → `QUOTED`;
  - values at or beyond `MIN_SQRT_RATIO` or `MAX_SQRT_RATIO`, and non-128-byte
    returns → `RPC_RESPONSE_INVALID`;
  - a zero output → `ZERO_OUTPUT`;
  - no ranking.
- **Block consistency:**
  - null block;
  - wrong number or timestamp;
  - changed hash on the re-read;
  - an unsupported-format, unknown-hash or non-canonical error on a
    hash-pinned read → `PINNED_READ_REJECTED`, with no further request;
  - every `eth_call` and `eth_getCode` parameter equals the same hash
    object;
  - a quote revert versus other `eth_call` errors;
  - stale and skewed times;
  - a lower head than one seen before;
  - envelope anomalies: extra key, wrong ID, both `result` and `error`, a
    wrong `jsonrpc`, a batch array, duplicate keys;
  - extra block fields such as `timestampMs` are accepted.
- **On-chain checks and markers:**
  - every §3.7 failure;
  - pins match both recordings;
  - cross-rejection with the mocked review.
- **Artifact:**
  - frozen and browser digests agree;
  - the raw-response digest is correct;
  - `collectBaseTranscript` followed by `deriveBaseObservation` is
    deterministic;
  - no input is mutated;
  - literal flags;
  - authority-shaped fields are empty.

**App unit tests (`base-rpc.test.ts`, stubbed `fetch`):**

- **Modes:**
  - mode parsing;
  - live is refused when `NODE_ENV` is `production`;
  - replay never calls `fetch`;
  - `REPLAY_MISMATCH`.
- **Transport:**
  - the exact destination;
  - `redirect: 'error'` and `no-store`;
  - timeouts;
  - non-200 status and 429;
  - content type;
  - streamed size caps;
  - allowlists enforced before `fetch`.
- **Process limits:**
  - the 10-second interval and in-flight lock;
  - 3 attempts and 63 requests, with the 64th refused before sending;
  - the breaker trips on each provider failure and stays tripped;
  - limits survive a module re-import.
- **Action input validation.**
- **Test URLs.** They use `.invalid` and are assembled at run time, so rule 1
  holds without a test exemption.

**App unit tests (`domain/base-observation.test.ts`):**

- The browser re-verification failures.
- Access and expiry.
- A new read retires the old observation.
- View model: withheld tiers carry no number.
- The observation context is separate from the workflow state.
- The IR hash and revision are unchanged by reads.

**Integration.** The contracts integration test confirms the new exports and
the unchanged `0.1.0` linter identity.

**E2E (new `base-observation.spec.ts`, guarded, fixed clock, replay under
`next start`):**

- **Read results.** Author 1 WETH → USDC and 2,500 USDC → WETH and read each.
  The UI shows:
  - `RECORDED REPLAY · NOT LIVE` beside every number;
  - four tier rows in fixed order;
  - checks and provenance;
  - Base's rate-limit and local-development disclosures;
  - "Not an authorization input".
- **Copyable artifact.** It parses with the frozen `parseArtifactBytes`, and
  the hashes match the displayed hashes.
- **Retirement.** Edits and expiry retire the observation, and a tab resume
  re-checks.
- **Separation.** The mocked region is unchanged. The observation region has no
  mocked markers.
- **No authority.**
  - No minimum output is shown.
  - No enabled authority control exists.
  - Manifest review and Execute stay disabled.
  - The workflow stays `DRAFT` with an unchanged revision.
- **Network.** The CSP header is present, and the loopback guard is clean.
- **Accessibility and layout.** Keyboard reach; no overflow at 375, 768 and
  1280.
- **Regression.** The existing suite passes with only the §3.11 assertion
  updates, and all ten snapshots pass at zero pixels.

**Governance and CI.** In isolated copies, each of these must fail:

- a second `fetch(`, or `fetch(` elsewhere;
- another remote URL, or the endpoint literal elsewhere;
- a `node:https` import;
- a non-allowlisted method;
- a seventh selector;
- the mode variable in a workflow file;
- a client import of `src/server/`;
- an observation token outside the consumer allowlist;
- a mocked–observation import in either direction;
- a removed CSP header;
- a changed byte in the BUILD-003B plan or report;
- an altered historical 003B tree set;
- an unregistered B003C ID;
- a missing report heading;
- an incomplete approval decision;
- an unauthorized path;
- a protected file removed from the index;
- a changed approved image.

## 7. Authority and artifacts

- **Authorization mode:** `NONE`.
- **Enforcement:** `NOT_ENFORCED`.
- **ADR-0001** remains `PROPOSED` and byte-identical.
- **Artifacts.** One ephemeral v1 Quote/State artifact per observation. It is
  never an authorization input (§3.8). The fields are mapped as follows.

| Field | Value |
|---|---|
| `artifactId` | `OBSERVED.base-quote.<nodeId>.r<revision>.b<block>` |
| `semanticWorkflowHash`, `nodeId` | Digest of the workflow at request time; the swap node |
| `sourceId`, `adapter` | `base.json-rpc`; `base.uniswap-v3-quoter-v2` `1.0.0` |
| `chainId`, `chainPosition` | `eip155:8453`; `BLOCK` N |
| `retrievedAt` | Transcript completion time |
| `freshness` | `observedAt` T; `expiresAt` T + 30 s; `maximumAgeSeconds` 30 |
| `rawResponseHash` | Raw-response digest of the transcript bytes |
| `normalizedValues` | `observation-mode`, `provider-host`, `block-hash`, `amount-in`, `asset-out`, four `code-sha256.*`, `decimals.*` and `symbol.*` for both assets, and per tier `tier-<fee>.status`, `tier-<fee>.pool` (when present) and `tier-<fee>.quoted-output` (only when `QUOTED`) |
| `providerReference` | `NONE` |
| `proposedContracts`, `proposedSpenders`, `proposedRecipients` | Empty |
| `fees`, `gas`, `outputBounds` | Empty, each disclosed by an uncertainty code |
| `uncertainty` | `SINGLE_PROVIDER`, `UNSAFE_HEAD`, `SINGLE_PROVIDER_FREE_PLAN_LOCAL_ONLY`, `NO_ROUTE_SELECTION`, `NO_MINIMUM_OUTPUT`, `NOT_AN_AUTHORIZATION_INPUT`, `GAS_AND_FEES_NOT_MODELED`, `PRICE_MOVES_AFTER_BLOCK`, `CODE_PINS_TRUST_ON_FIRST_USE`, `IMPLEMENTATION_NOT_PINNED`, `SOURCE_EQUIVALENCE_NOT_VERIFIED`, `NOT_EVIDENCE`; plus `RECORDED_NOT_CURRENT` in replay |
| `registryValidation` | Reference registry `1.0.0`, swap action, `CONTRACT_VALIDATED`, `NOT_ENFORCED` |

**Transcript.**

- A closed object serialized with RFC 8785:
  - `format` = `gryloo.base-observation-transcript.v1`;
  - `mode`, `providerHost`, `chainId`, `startedAt`, `completedAt`;
  - `exchanges`: an ordered list of exact request and response texts.
- At most 1,048,576 bytes.

**Recording file.** Exactly two `LIVE_READ_ONLY` transcripts (§3.5).

**Invalidation.** A semantic edit, expiry or a new read retires an observation.
Retired observations are never reused.

**Revocation or cancellation:** none.

## 8. Security impact

- **New trust boundaries:**
  - between the browser and the local development server (a same-origin
    Server Action, with Next's origin check);
  - between that server and one Alchemy Free provider;
  - between the provider's responses and displayed values.
- **Threats:**
  - a lying or inconsistent provider;
  - a load-balanced read from a divergent node;
  - a malformed or oversized response;
  - redirects or other egress;
  - quote misuse as a minimum output, route or authorization input;
  - a partial fill shown as a full quote;
  - mocked contamination;
  - leakage of the pair and amount;
  - provider rate limiting or abuse;
  - hosted use;
  - a replay mistaken for live data.
- **Controls:**
  - fixed destination and methods;
  - allowlisted targets and selectors;
  - size, time, rate, budget, process limits and the breaker;
  - development-only live mode;
  - the frozen JSON parser;
  - strict ABI decoding;
  - block pinning, monotonic head and the final re-read;
  - code pins;
  - deployment-link and metadata checks;
  - the full-input rule;
  - browser re-verification;
  - the consumer allowlist;
  - `connect-src 'self'`;
  - the unchanged E2E guard;
  - replay-only CI;
  - labels beside every number.
- **Limitations:**
  - One provider can present a consistent but false state. Code pins are
    trust on first use.
  - Proxy implementations are not observed.
  - Deployed bytecode is not proven equivalent to the pinned source.
  - Hash-pinned reads rely on the provider honoring EIP-1898 (D-6 = B).
  - `latest` can reorganize after the re-read.
  - This is local review, not enforcement.

## 9. Evidence target

- **Integration proofs:** `MOCKED`, from scripted transports and the recorded
  replay.
- **Observations:** `LIVE_READ_ONLY` or `RECORDED_REPLAY`, always
  `NOT_EVIDENCE`, never an authorization input.
- **Build financial evidence:** environment and outcome both
  `NOT_APPLICABLE`. There are no `FORK_REPRODUCED`, `TESTNET_EXECUTED` or
  `MAINNET_EXECUTED` claims.
- **Registry metadata:** stays `NOT_ONCHAIN_VERIFIED`.
- **Retained evidence:**
  - source and tests;
  - the recordings and pins;
  - the recording-session log and harness digest;
  - this plan and the report;
  - visual before and diff images with counts and hashes;
  - separately identified local and remote results.

## 10. License impact

- **Affected paths:**
  - `packages/reference-linter/**` and `apps/reference-dapp/**`
    (AGPL-3.0-only), including the recorded fixture;
  - governance files (Apache-2.0).
- **Classification.** No change. `LICENSE_MAP` changes only to list the
  approved plan.
- **Recordings.** They hold on-chain data and public contract code as returned
  by the provider. They are test data; no license is asserted over third-party
  bytecode.
- **Dependencies.** None added. No license exception changes, no
  `THIRD_PARTY_NOTICES.md` change and no publication.

## 11. Expected files

Paths are repository-relative. The lists are closed: 30 created and 36
modified, 65 in total. No other creates, deletions, renames or mode changes are
authorized. The recording harness stays in the agent's scratchpad and is never
committed.

### Create (30 paths)

```text
docs/builds/BUILD-003C-PLAN.md
docs/builds/BUILD-003C-REPORT.md
packages/reference-linter/src/base-observation.ts
packages/reference-linter/test/base-observation.test.ts
apps/reference-dapp/src/server/base-rpc.ts
apps/reference-dapp/src/server/base-rpc.test.ts
apps/reference-dapp/src/app/observation-action.ts
apps/reference-dapp/src/domain/base-observation.ts
apps/reference-dapp/src/domain/base-observation.test.ts
apps/reference-dapp/src/components/observation-panel.tsx
apps/reference-dapp/e2e/base-observation.spec.ts
apps/reference-dapp/e2e/observations/base-recorded-observations.json
apps/reference-dapp/e2e/base-observation.spec.ts-snapshots/observation-recorded-chromium-linux.png
apps/reference-dapp/e2e/base-observation.spec.ts-snapshots/observation-expired-chromium-linux.png
apps/reference-dapp/e2e/visual-evidence/build-003c/build-before.png
apps/reference-dapp/e2e/visual-evidence/build-003c/build-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003c/simulate-before.png
apps/reference-dapp/e2e/visual-evidence/build-003c/simulate-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003c/execute-before.png
apps/reference-dapp/e2e/visual-evidence/build-003c/execute-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003c/proposal-before.png
apps/reference-dapp/e2e/visual-evidence/build-003c/proposal-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003c/review-blocked-before.png
apps/reference-dapp/e2e/visual-evidence/build-003c/review-blocked-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003c/simulate-current-before.png
apps/reference-dapp/e2e/visual-evidence/build-003c/simulate-current-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003c/simulate-invalidated-before.png
apps/reference-dapp/e2e/visual-evidence/build-003c/simulate-invalidated-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003c/simulate-expired-before.png
apps/reference-dapp/e2e/visual-evidence/build-003c/simulate-expired-diff.png
```

### Modify (36 paths)

```text
.github/workflows/contracts.yml
.github/workflows/governance.yml
README.md
apps/reference-dapp/e2e/fixtures.ts
apps/reference-dapp/e2e/interface-honesty.spec.ts
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-current-chromium-linux.png
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-expired-chromium-linux.png
apps/reference-dapp/e2e/mock-artifact-chain.spec.ts-snapshots/simulate-invalidated-chromium-linux.png
apps/reference-dapp/e2e/swap-authoring.spec.ts-snapshots/proposal-chromium-linux.png
apps/reference-dapp/e2e/swap-authoring.spec.ts-snapshots/review-blocked-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/build-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/execute-chromium-linux.png
apps/reference-dapp/e2e/visual-shell.spec.ts-snapshots/simulate-chromium-linux.png
apps/reference-dapp/next.config.ts
apps/reference-dapp/playwright.config.ts
apps/reference-dapp/src/app/globals.css
apps/reference-dapp/src/app/layout.tsx
apps/reference-dapp/src/components/app-shell.tsx
apps/reference-dapp/src/components/simulate-panel.tsx
apps/reference-dapp/src/components/summary-bar.tsx
apps/reference-dapp/src/components/workflow-canvas.tsx
apps/reference-dapp/src/config/product.test.ts
apps/reference-dapp/src/config/product.ts
apps/reference-dapp/src/domain/contracts.integration.test.ts
apps/reference-dapp/src/state/workflow-store.tsx
docs/AUTHORITY_MATRIX.md
docs/DECISIONS.md
docs/EVIDENCE_LEVELS.md
docs/LICENSE_MAP.md
docs/NEXT_BUILD.md
docs/REQUIREMENTS.md
docs/SCOPE_GUARD.md
docs/SECURITY_MODEL.md
docs/STATUS.md
packages/reference-linter/src/index.ts
```

The two modified spec files change only in the assertions that quote build
labels or the Execute text (§3.11). Every other existing spec file is unchanged. The sole fixture change sets `bypassCSP` only for the synthetic negative guard self-test context; ordinary contexts retain production CSP.

### Do not touch

Every path tracked at `0faec71207628dfe27fb23c81680d2c27827f5ea` that is not in
Modify is protected byte-for-byte and mode-for-mode. That is 187 paths, listed
exhaustively below. It includes:

- the BUILD-003A and BUILD-003B plans and reports;
- the frozen contracts, the registry and the compatibility fixtures;
- `mocked-chain.ts`, `mock-artifacts.ts` and `artifact-chain.ts`;
- `review-panel.tsx` and `artifact-inspector.tsx`;
- the E2E network guard and the network-isolation spec;
- the lockfile and `bootstrap-ci.py`;
- the restored `next-env.d.ts`.

```text
.gitignore
.node-version
.npmrc
LICENSE
LICENSES/AGPL-3.0-only.txt
LICENSES/Apache-2.0.txt
NOTICE
THIRD_PARTY_NOTICES.md
TRADEMARKS.md
apps/reference-dapp/LICENSE
apps/reference-dapp/e2e/build-roundtrip.spec.ts
apps/reference-dapp/e2e/network-isolation.spec.ts
apps/reference-dapp/e2e/swap-authoring.spec.ts
apps/reference-dapp/e2e/visual-evidence/build-003a/build-before.png
apps/reference-dapp/e2e/visual-evidence/build-003a/build-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003a/execute-before.png
apps/reference-dapp/e2e/visual-evidence/build-003a/execute-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003a/simulate-before.png
apps/reference-dapp/e2e/visual-evidence/build-003a/simulate-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003b/build-before.png
apps/reference-dapp/e2e/visual-evidence/build-003b/build-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003b/execute-before.png
apps/reference-dapp/e2e/visual-evidence/build-003b/execute-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003b/proposal-before.png
apps/reference-dapp/e2e/visual-evidence/build-003b/proposal-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003b/review-blocked-before.png
apps/reference-dapp/e2e/visual-evidence/build-003b/review-blocked-diff.png
apps/reference-dapp/e2e/visual-evidence/build-003b/simulate-before.png
apps/reference-dapp/e2e/visual-evidence/build-003b/simulate-diff.png
apps/reference-dapp/e2e/visual-shell.spec.ts
apps/reference-dapp/next-env.d.ts
apps/reference-dapp/package.json
apps/reference-dapp/src/app/page.tsx
apps/reference-dapp/src/components/action-library.tsx
apps/reference-dapp/src/components/artifact-inspector.tsx
apps/reference-dapp/src/components/copilot-panel.tsx
apps/reference-dapp/src/components/review-panel.tsx
apps/reference-dapp/src/components/status-badge.tsx
apps/reference-dapp/src/components/top-bar.tsx
apps/reference-dapp/src/domain/artifact-chain.test.ts
apps/reference-dapp/src/domain/artifact-chain.ts
apps/reference-dapp/src/domain/commands.test.ts
apps/reference-dapp/src/domain/commands.ts
apps/reference-dapp/src/domain/editor.test.ts
apps/reference-dapp/src/domain/editor.ts
apps/reference-dapp/src/domain/initial-workflow.ts
apps/reference-dapp/src/domain/mock-actions.ts
apps/reference-dapp/src/domain/mock-artifacts.test.ts
apps/reference-dapp/src/domain/mock-artifacts.ts
apps/reference-dapp/src/domain/proposal.test.ts
apps/reference-dapp/src/domain/proposal.ts
apps/reference-dapp/src/domain/swap-authoring.test.ts
apps/reference-dapp/src/domain/swap-authoring.ts
apps/reference-dapp/tsconfig.json
docs/adr/ADR-0001-mode-b-authority.md
docs/adr/ADR-0002-canonical-contracts.md
docs/assets/1.jpeg
docs/assets/2.jpeg
docs/assets/3.jpeg
docs/builds/BUILD-000-LICENSING-AMENDMENT.md
docs/builds/BUILD-000-PLAN.md
docs/builds/BUILD-000-REPORT.md
docs/builds/BUILD-001-PLAN.md
docs/builds/BUILD-001-REPORT.md
docs/builds/BUILD-002-GOVERNANCE-AMENDMENT.md
docs/builds/BUILD-002-PLAN.md
docs/builds/BUILD-002-REPORT.md
docs/builds/BUILD-003A-PLAN.md
docs/builds/BUILD-003A-REPORT.md
docs/builds/BUILD-003B-PLAN.md
docs/builds/BUILD-003B-REPORT.md
docs/contracts/CANONICALIZATION_V1.md
docs/contracts/COMPATIBILITY_V1.md
docs/contracts/INVALIDATION_V1.md
docs/specs/MASTER_SPEC_V3.2.md
eslint.config.mjs
package.json
packages/action-registry/LICENSE
packages/action-registry/package.json
packages/action-registry/schemas/v1/action-registry.schema.json
packages/action-registry/src/actions.ts
packages/action-registry/src/base-assets.ts
packages/action-registry/src/capabilities.ts
packages/action-registry/src/index.ts
packages/action-registry/src/reference-registry.ts
packages/action-registry/src/schemas.ts
packages/action-registry/test/reference-registry.test.ts
packages/action-registry/test/registry.test.ts
packages/action-registry/tsconfig.json
packages/reference-linter/LICENSE
packages/reference-linter/package.json
packages/reference-linter/src/artifact-digest.ts
packages/reference-linter/src/context.ts
packages/reference-linter/src/mocked-chain.ts
packages/reference-linter/src/rules.ts
packages/reference-linter/src/validation.ts
packages/reference-linter/test/artifact-digest.test.ts
packages/reference-linter/test/linter.test.ts
packages/reference-linter/test/mocked-chain.test.ts
packages/reference-linter/test/validation.test.ts
packages/reference-linter/tsconfig.json
packages/workflow-contracts/LICENSE
packages/workflow-contracts/package.json
packages/workflow-contracts/schemas/v1/artifact-set.schema.json
packages/workflow-contracts/schemas/v1/authorization-policy.schema.json
packages/workflow-contracts/schemas/v1/evidence-bundle.schema.json
packages/workflow-contracts/schemas/v1/execution-journal.schema.json
packages/workflow-contracts/schemas/v1/execution-plan.schema.json
packages/workflow-contracts/schemas/v1/quote-state-artifact.schema.json
packages/workflow-contracts/schemas/v1/semantic-workflow.schema.json
packages/workflow-contracts/schemas/v1/simulation-bundle.schema.json
packages/workflow-contracts/schemas/v1/strategy-manifest.schema.json
packages/workflow-contracts/src/artifact-set.ts
packages/workflow-contracts/src/authorization-policy.ts
packages/workflow-contracts/src/canonical.ts
packages/workflow-contracts/src/common.ts
packages/workflow-contracts/src/evidence-bundle.ts
packages/workflow-contracts/src/execution-journal.ts
packages/workflow-contracts/src/execution-plan.ts
packages/workflow-contracts/src/index.ts
packages/workflow-contracts/src/invalidation.ts
packages/workflow-contracts/src/quote-state.ts
packages/workflow-contracts/src/raw-json.ts
packages/workflow-contracts/src/revision.ts
packages/workflow-contracts/src/schemas.ts
packages/workflow-contracts/src/semantic-workflow.ts
packages/workflow-contracts/src/simulation.ts
packages/workflow-contracts/src/state-transitions.ts
packages/workflow-contracts/src/strategy-manifest.ts
packages/workflow-contracts/test/canonical.test.ts
packages/workflow-contracts/test/contracts.test.ts
packages/workflow-contracts/test/invalidation.test.ts
packages/workflow-contracts/test/raw-json.test.ts
packages/workflow-contracts/test/revision-state.test.ts
packages/workflow-contracts/tsconfig.json
patches/@streamparser__json@0.0.26.patch
patches/@xyflow__system@0.0.82.patch
pnpm-lock.yaml
pnpm-workspace.yaml
prompts/DEFI_WORKFLOW_ENGINE_MASTER_PROMPT_ASTRA_v1.2_EN.md
scripts/bootstrap-ci.py
scripts/bootstrap-playwright.py
scripts/export-schemas.mjs
tests/compatibility/v1/action-registry.json
tests/compatibility/v1/artifact-set.json
tests/compatibility/v1/authorization-policy.json
tests/compatibility/v1/evidence-bundle.json
tests/compatibility/v1/execution-journal.json
tests/compatibility/v1/execution-plan.json
tests/compatibility/v1/hash-vectors.json
tests/compatibility/v1/invalidation-cases.json
tests/compatibility/v1/raw-json/invalid-duplicate-nested.json.txt
tests/compatibility/v1/raw-json/invalid-duplicate-root.json.txt
tests/compatibility/v1/raw-json/invalid-escaped-equivalent-key.json.txt
tests/compatibility/v1/raw-json/invalid-trailing-document.json.txt
tests/compatibility/v1/raw-json/invalid-utf8.hex
tests/compatibility/v1/raw-json/valid-distinct-nested-keys.json
tests/compatibility/v1/raw-json/valid-escaped-string-value.json
tests/compatibility/v1/revision-conflicts.json
tests/compatibility/v1/semantic-workflow.json
tests/compatibility/v1/simulation-bundle.json
tests/compatibility/v1/state-transitions.json
tests/compatibility/v1/strategy-manifest.json
third_party/licenses/caniuse-lite-1.0.30001810-LICENSE
third_party/licenses/img-sharp-libvips-darwin-arm64-1.3.3-README.md
third_party/licenses/img-sharp-libvips-darwin-x64-1.3.3-README.md
third_party/licenses/img-sharp-libvips-linux-arm-1.3.3-README.md
third_party/licenses/img-sharp-libvips-linux-arm64-1.3.3-README.md
third_party/licenses/img-sharp-libvips-linux-ppc64-1.3.3-README.md
third_party/licenses/img-sharp-libvips-linux-riscv64-1.3.3-README.md
third_party/licenses/img-sharp-libvips-linux-s390x-1.3.3-README.md
third_party/licenses/img-sharp-libvips-linux-x64-1.3.3-README.md
third_party/licenses/img-sharp-libvips-linuxmusl-arm64-1.3.3-README.md
third_party/licenses/img-sharp-libvips-linuxmusl-x64-1.3.3-README.md
third_party/licenses/img-sharp-wasm32-0.35.4-LICENSE
third_party/licenses/img-sharp-wasm32-0.35.4-README.md
third_party/licenses/img-sharp-win32-0.35.4-LICENSE
third_party/licenses/img-sharp-win32-arm64-0.35.4-README.md
third_party/licenses/img-sharp-win32-ia32-0.35.4-README.md
third_party/licenses/img-sharp-win32-x64-0.35.4-README.md
third_party/licenses/streamparser-json-MIT.txt
third_party/licenses/tslib-2.8.1-CopyrightNotice.txt
third_party/licenses/tslib-2.8.1-LICENSE.txt
third_party/licenses/xyflow-system-MIT.txt
tsconfig.base.json
turbo.json
```

## 12. Risks and rollback

- **A quote read as a recommendation, a minimum output or an authorization
  input.** Mitigation:
  - fixed tier order and no ranking;
  - withheld unproven numbers;
  - empty authority-shaped fields;
  - the consumer allowlist;
  - disclosures and labels.
- **Provider rate limiting.** Base documents it. Mitigation:
  - local development only;
  - self-limits, the breaker and no retry;
  - replay-only CI.
- **Recording failure.** If the session stops early under §3.5, implementation
  pauses for your instruction. The caps are never reset by restarting.
- **Code-pin drift.** Observations fail closed with `CODE_DIGEST_MISMATCH`
  until a reviewed change updates the pins.
- **Denim (planned October 2026).** Faster blocks and additional block fields
  are tolerated. The seconds-based `timestamp` field stays.
- **Label churn.** Handled by the evidence process. The build-neutral texts
  reduce future churn.
- **Delivery.**
  - The agent shell cannot push over SSH, so the owner pushes. The agent then
    opens the PR with the GitHub CLI and reports CI.
  - The branch name predates direction C. Implementation continues on it unless
    you ask for a rename.
- **Rollback.** A reviewed revert restores code, records, images and the
  recording together. There is no financial state, and the server keeps
  nothing.

## 13. Questions requiring human decision

### 13.1 Decisions for this build

**Recorded owner choices:**

- **D-1 = C:** direction.
- **D-2 = A:** a local server transport behind one Server Action.
- **D-3 = A, only for opt-in local development.** Alchemy Free is the approved single read provider under Amendment 2; no production deployment is approved.
- **D-4: bounded recording.** One transcript per direction, at most four
  attempts and 84 requests. Stop on rate limiting or inconsistent responses. No
  CI live calls (§3.5).
- **D-5 = A:** an observation mode, `NOT_EVIDENCE`, no schema change.
- **Amendment 1 (after an HTTP 429).** Resume the same recording session with
  the remaining 3 attempts and 72 requests. Space requests about 400 ms apart
  and use a 1-second pause after the head read. Time limits, providers and
  counters are unchanged, and stop-on-429 still applies (Status section).

- **D-6 = B:** hash-pinned reads with the five conditions recorded in the
  Status section. The block parameter is the same
  `{ "blockHash": H, "requireCanonical": true }` for every `eth_call` and
  `eth_getCode`, and the final block check is preserved. Support is verified
  inside the §3.5 caps. There is no fallback and no provider change. Live mode
  is local development only.

**Resolved by recommendation and covered by the approval:**

- **L-1:** on-chain QuoterV2 and factory reads.
- **L-6:** per-observation checks.
- **Process-wide live limits** equal to the Amendment 2 recording caps, plus the breaker.
- **Recording harness:** stays uncommitted in the scratchpad, logged in the
  report.
- **Placement:** below the mocked chain.
- **Stale labels:** build-neutral replacements.
- **Snapshots:** two new ones.
- **Build label:** `BUILD-003C`.

### 13.2 Later decisions (not part of BUILD-003C)

- **L-5 Fork environment:** needs an ADR.
- **Live data beyond this build:**
  - a second provider;
  - the `pending` state;
  - multi-hop quotes;
  - a live Simulation Bundle.
- **Wallets:** W-1 to W-3.
- **Authorization artifacts:**
  - A-1 to A-5, including any use of observations as authorization inputs;
  - A-2 is the prerequisite for any router, spender or Permit2 address.
- **Signing:** S-1 to S-3.
- **Financial execution:** X-1 to X-4.

**Approval recorded.** The owner approved implementation of this plan with
D-6 = B on 2026-09-24 (Status section). The approval covers:

- implementation on this branch;
- the Amendment 2 Alchemy session only after the Free account and private local key confirmation, within its separate 3/63 caps; that session stopped on HTTP 403 at 1/3 attempts and 1/63 requests, and DEC-0022 now authorizes only the separate carried-counter continuation in Amendment 3 after offline preconditions pass;
- validations;
- the commit titled "Implement Build 003C read-only Base quote observation";
- push and merge remain with the owner; no PR is authorized by this amendment.

Merging, wallets, authorization artifacts, signing, execution and any other
build remain unapproved.
