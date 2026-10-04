# BUILD-PRIVACY-001 — verified live SDK boundary

Inspected on 2026-10-04, after the reviewed LOCAL/MOCKED checkpoint was committed and pushed as `86800ee019da7a5b77b4b6125710cbde35a05a40`. [PR #55](https://github.com/alrimarleskovar/gryloo/pull/55) remains draft. Selected policy: SOL → public USDC, with private SOL change.

## Finding and stopping condition

The approved SDK's standard relay swap cannot bind execution to the exact route reviewed by Flofi. This is a factual blocker for that integration under the existing authorization requirements, independently of the unresolved dependency gates. No financial boundary was enabled and no owner signature, funding or transaction was requested.

This conclusion concerns the published **0.2.5 SDK standard relay path**. It is not a claim that every possible Cloak program integration is impossible. No alternative route-committing relay contract or independently prepared settlement path has been verified. Such a path would need to meet the same Manifest, privacy and reconciliation requirements before enabling execution.

## Reproducible package evidence

The npm tarball's SHA-512 integrity was checked against the registry before inspecting its runtime and declarations:

| Item | Value |
| --- | --- |
| Package | `@cloak.dev/sdk@0.2.5` |
| npm `gitHead` | `699ff35888304c870c08377b7679017789195271` |
| Tarball SRI | `sha512-D2gwVEBpnPX23sxUuMQHefXO03s+euajiXKJpQkTx+RI5dTvJXFbnwA3UqYZ+lLwToHvBqjYGqPwjDsCUCdoyw==` |
| `dist/index.js` SHA-256 | `7e3a1e148102682e26e4859cd328e22bcdc7a6960c1837f69562db48d388a995` |
| `dist/index.d.ts` SHA-256 | `52989572b39612d6ebb78271e0f9fad307729e4fe00730e3514db83e31be0476` |

Runtime locations refer to that exact tarball, extracted read-only for investigation under `/tmp/privacy001-cloak-sdk/package`:

| Boundary | Evidence |
| --- | --- |
| Request authentication | `dist/index.js:1158`, `TRANSACT_SWAP_AUTH_FIELDS`; `:1222`, `buildAuthRequest`, copies only the agreed field list before hashing. Route/quote/unsigned-message/Manifest commitments are absent. |
| On-chain swap parameter hash | `dist/index.js:5841`, `computeSwapExtDataHash`, binds output mint, recipient ATA, minimum output, gross withdrawal, refund authorization and fee ceiling; it has no exact Jupiter route or instruction commitment. |
| Relay swap submission | `dist/index.js:9446`, request construction; `:9477`, authentication; `:9488`, POST to `/transact_swap`. The SDK sends DEX filters and slippage/minimum constraints, with no selected route or transaction to execute. |
| Preparation ordering | `swapUtxo` begins at `dist/index.js:8769`; viewing-key registration is at `:8829`; proof generation at `:9337`; signature/submission follows inside the same call. The predicted-state callback at `:9441` exposes the PDA, not the prepared request or unsigned transaction. |
| Public swap API | `UtxoSwapParams` and `TransactOptions` in `dist/index.d.ts`; the complete export list at `:5755`. No prepare-only swap engine exposes the full proof/request/transaction before wallet authorization. |

The website describes the standard [SDK APIs and agreed request-authentication fields](https://docs.cloak.ag/sdk/api-reference). Its older type examples do not supersede the inspected 0.2.5 declarations. The [documented flow](https://docs.cloak.ag/platform/transaction-flows) separates opening SwapState from later settlement; verifying a settlement after submission cannot prevent execution of a changed route. The [program's documented public-input layout](https://docs.cloak.ag/protocol/shield-pool) has fixed proof fields and an external-data hash rather than a separately declared route commitment.

## Executable counterexamples

`apps/reference-dapp/src/privacy/live-sdk-boundary.test.ts` calls the actual installed SDK's `buildRelayAuthPreimage`. It never proves, signs, contacts a network or submits. Its proof/public-input strings are synthetic and are never presented as valid chain evidence.

The tests compare the final request digest, excluding the independently randomized authentication nonce:

- Changing an added `route_id`, `route_hash`, `route`, `quote`, `unsigned_transaction` or `manifest_hash` leaves the signed request digest identical.
- Changing supported minimum-output, fee-cap, recipient-ATA, mint, proof or public-input fields changes the digest.
- Adding route hashing only to the client's field list changes its digest relative to the SDK's relay agreement. This does not establish relay support for the added field.
- The financial execution gate still rejects execution; the actual swap and verified-artifact-loader exports exist, while internal swap proof/hash helpers are not exported.

The digest tests demonstrate SDK authentication behavior, not a transaction signed by an owner or an experiment against the production relay. They do not claim the relay accepts arbitrary extra fields; an ignored or rejected extra field cannot provide a verified route commitment.

## Why local adapter work cannot resolve this contract

Flofi's existing `simulateJupiterSwap` binds a route commitment, inspected accounts/instructions, exact message hash and unsigned transaction before Review. The LOCAL/MOCKED compiler similarly binds its fixture route to the Manifest and authorization. Letting the relay choose a route later, even within an approved DEX list and minimum output, would drop that requirement. An after-the-fact mismatch verdict would detect the deviation only after financial execution.

The SDK does export verified circuit artifacts, note/nullifier primitives, generic instruction and transaction construction. Splitting or independently implementing proof preparation is engineering work, not by itself a protocol impossibility. It still cannot make the current relay swap request authenticate and honor an exact reviewed Jupiter route. Intercepting the signing callback also cannot add that missing contract: it receives the request-auth preimage after internal preparation, and the supported request schema still lacks the route commitment.

A genuine continuation requires a verified Cloak SDK/relay interface that prepares and simulates the intended messages before authorization **and honors an authenticated exact route/payload commitment**, or a verified compatible protocol path with the same guarantees. A client-only field, synthetic proof, public fallback, post-submission review or altered acceptance requirement is not a remedy.

## Remaining live stage and validation

Real proof/transaction preparation, browser financial integration, authoritative mainnet source/settlement/output/nullifier/change/refund observations, recovery/backup UI and journal integration, and live timeout/refund handling remain incomplete. The completed SDK note/vault/reservation/replay/reconciliation foundations are preserved. No funded evidence or challenge acceptance is claimed.

The new boundary suite passes **14 tests** against the installed SDK. The full focused privacy regression run passes **81 tests in 8 files**, including those 14. Focused ESLint and the dapp TypeScript check pass. The pushed local checkpoint's earlier validation remains 1,395 tests, 2 existing skips, 2 browser checks and all 16 build/typecheck tasks; the complete suite was not rerun for this test/documentation-only investigation.

Dependency acceptance remains separately blocked by the Elliptic advisory and inventory/license review recorded in [the dependency investigation](BUILD-PRIVACY-001-DEPENDENCIES.md). No gate was changed. Owner funding/signing does not remedy the route-binding blocker and is not required now. The SDK/relay contract must be resolved before reaching an owner financial boundary.
