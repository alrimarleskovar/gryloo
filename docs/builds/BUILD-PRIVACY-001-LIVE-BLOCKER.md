# BUILD-PRIVACY-001 — SDK contract and accepted authorization model

Inspected on 2026-10-04, after the reviewed LOCAL/MOCKED checkpoint was committed and pushed as `11670bf`. [PR #55](https://github.com/alrimarleskovar/gryloo/pull/55) remains draft. Selected policy: SOL → public USDC, with private SOL change.

## Current disposition

The owner accepted the exact-route limitation and explicitly selected **provider-managed Jupiter routing via Cloak**. The earlier blocker applied to an exact-route authorization contract; it does not forbid the newly authorized property contract. The original counterexample tests remain intact, committed and pushed at `6bded358886525d0d0e524ee0ba9013496101bcd` before this implementation continued. PR #55 remains draft.

The replacement model is technically consistent with the actual SDK's signed field agreement and swap external-data hash. No client-only route field is added, and no exact route or unsigned settlement message is represented as owner-approved. The UI and public review explicitly say:

- Routing provider: Jupiter via Cloak
- Exact DEX route: provider-managed and not authorization-bound

### Actual guarantee boundaries

| Reviewed property | Actual binding / verification |
| --- | --- |
| Cloak provider | Fixed Manifest/provider policy and pinned production relay; no public adapter fallback. |
| Shielded SOL, exact gross spend | Circuit mint/public amount and conservation; source proof bytes and public inputs are request-authenticated. |
| USDC mint, exact recipient ATA, exact minimum output | Poseidon swap external-data hash and SDK request authentication. LIVE preparation additionally derives the owner's actual USDC ATA. |
| Protocol fee ceiling | `max_fee` in the same proof hash and signed request; finalized program-owned PoolConfig supplies the reviewed ceiling. |
| Private residual SOL change | Actual SDK recoverable change, circuit output commitment/conservation, signed proof/ciphertext, exact durable note and finalized membership/unspent reconciliation. |
| Program identity | SDK authentication preimage program domain plus program-owned finalized accounts/instructions. |
| Mainnet identity | Pinned production RPC/relay and explicit mainnet genesis checks. Genesis is a client/observation guard, **not a new signed SDK field**. |
| Review freshness | Local 60-second review/sign/first-submission checks; signed issue timestamp and the documented relay first-use 300-second window. This does **not** enforce a settlement deadline or cancel an accepted swap; relay cached replay semantics are unchanged. Flofi never blindly replays it. |
| Exact DEX route | No protocol binding; explicitly provider-managed. |

The private change/refund construction and real proof kernel were checked against SDK 0.2.5. The SDK's own hash-verifying circuit loader supplied ceremony 0.2.0 bytes, and real Groth16 proofs over synthetic local witnesses passed verification with the actual zkey. Direct `snarkjs@0.7.6` is the same locked version already used transitively by the SDK; no proving or protocol primitive was replaced.

Official [request-authentication documentation](https://docs.cloak.ag/sdk/request-authentication) describes the client/Rust signed-field agreement and supported manual request construction. Read-only production relay health and finalized mainnet genesis/PoolConfig reads were checked on 2026-10-04. The relay reported an open swap intake and matching sealed program provenance. These observations verify availability/configuration, not acceptance of a signed financial request: none was sent. Authenticated production execution still needs owner-controlled inputs/signing after acceptance gates permit it.

WASM SHA-256: `02ec02e954ae3932827ad9de51afa597ca95569aa97fec8410879c937a58aa2b` (3,249,734 bytes). Zkey SHA-256: `9da7db8cb1370fc497d36a0365f1f107ab0b0c13ca66fa9f0287e5f96ee68d25` (19,657,219 bytes). Finalized SOL PoolConfig read: fixed 5,000,000 lamports plus 3/1000 of gross; 20,000,000 gross gives a 5,060,000 fee. Runtime always reads the account rather than treating this example as a constant.

Private refund Phase 1 uses the pinned SDK runtime's actual discriminator **13**, exactly **41 bytes**, with its commitment at bytes 1–32 (`dist/index.js:4164–4167`, `:4316–4324`). The unversioned program overview's generic close tag 5 is not used as private-refund evidence. Reconciliation additionally requires the authenticated refund event to match that wire commitment, actual SDK NK/nullifier derivation, canonical finalized leaf membership and unspent state. Unknown/malformed phases remain recovery-required. No trailing close-payload semantics were guessed. The SDK's runtime is authoritative for this private-leaf decoder, and the docs/SDK distinction is preserved rather than silently accepted as an equivalent ABI.

No additional security-critical property-binding blocker was found in this scoped model. This is not READY_FOR_OWNER_EXECUTION or challenge acceptance. The existing financial/linter/capability, dependency/license and reconciliation gates remain intact. RPC simulation of the source/settlement transactions is not performed or claimed; the candidate Review explicitly describes proof verification and finalized input-state checks.

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

## Historical exact-route finding

Flofi's public Jupiter path and LOCAL fixture bind an exact route. The inspected standard Cloak relay cannot provide that guarantee, and adding a route field to a client digest does not change the relay or circuit agreement. The owner has now authorized a distinct Cloak property contract; public Jupiter's route contract and the LOCAL fixture remain unchanged. The original 14 investigation tests still demonstrate why an exact route must never be claimed here.

## Implementation and remaining acceptance

The property contract, actual preparation/proof/request, browser vault/Review/Manifest, single-submission controller, immutable encrypted journal/backup and finalized source/output/input/change/refund observation/reconciliation paths are implemented locally behind the existing release gate. Restart and restored backups inspect only; missing authorization or divergent private/public state cannot yield success. Timeout close/refund events are inspected and actual private refund notes are reconstructed; no automatic owner close/withdrawal transaction is introduced.

See the [current report](BUILD-PRIVACY-001-REPORT.md) for exact validation and remaining owner/dependency acceptance boundaries. Production signed relay acceptance, browser proof generation with real owner-held notes, funded settlement/refund and multi-tab acceptance evidence have not been produced. Owner financial actions are not requested while the existing release gates remain blocked.
