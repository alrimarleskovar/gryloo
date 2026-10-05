# BUILD-PRIVACY-001 — blocker closure, 2026-10-05

**READY_FOR_OWNER_EXECUTION = false.** The scoped SBOM defect is fixed. No other engineering defect was identified in this blocker-closure pass. Dependency inventory/license admission and the unresolved Elliptic advisory remain blockers. This conclusion covers the controlled shield-deposit implementation, not funded swap acceptance or production release clearance.

The inherited residual register defines a proposed, exact, expiring decision scope; its presence is not an acceptance record. This pass created no owner acceptance/admission record and performed no wallet connection, owner signing, funding or submission. The ordinary verifier, low audit threshold, lockfile, policy and production financial gate remain unchanged. The inherited launcher requires the owner to type its register-bound phrase in a real terminal before residual admission, and the page requires explicit acknowledgment. Nothing in this report supplies that decision. Unknown findings, invalid SBOMs, changed scope/lockfile or expired records fail closed.

## SBOM fix and validation

`evaluateOwnerProofGates` parses the SBOM into `unknown` and requires a non-null JSON object (not an array), `bomFormat === "CycloneDX"`, `Array.isArray(components)` and `components.length > 0`. Strings and array-like objects fail. This is the requested structural check, not exhaustive CycloneDX JSON Schema conformance.

The residual/SBOM suite passed **36 tests**, including a valid non-empty array and rejection of missing/empty/string/array-like components, malformed JSON, null and primitive/array documents. The focused owner-proof suite passed **152 tests in eight files**, including genuine SDK/public-mainnet preparation with capture-only signing and financial RPC methods forbidden. Instrumentation wrapped the actual loaded Elliptic instance's `sign`, `keyFromPrivate` and `genKeyPair`: **zero calls**. Preparation measured a 10,000-lamport fee and 11,970,880-lamport debit, with **zero wallet signature requests and zero submissions**.

Typecheck passed **15/15**; ESLint passed for both touched TypeScript files; the source-affected production build passed **8/8** (seven unchanged cached tasks, one rebuilt app). The existing dynamic-filesystem tracing warning remains on this local checkout-bound proof route; this is not permission to deploy that route. No unrelated heavy unit suite was repeated; the prior 1,623 passed/19 skipped and frozen-schema 11/11 results are retained. `git diff --check` passed.

Validation used Node 24.21.0 and pnpm 11.22.0. Turbo initially selected system pnpm 12.9.1; an ignored local executable link selected the pinned binary without bypassing version checks. Next's TypeScript subprocess required sandbox escalation. The first verifier run encountered a registry reset for `@solana/compat@8.3.0`; the exact retry completed all 411 reads and reproduced the 21 findings below. Neither environment failure was admitted or suppressed.

## Complete verifier findings

Exact command: `python3 scripts/bootstrap-ci.py --verify-dependencies`. Exit **1**, ending with `BUILD-002 dependency verification failed with 21 violation(s)`.

Lockfile SHA-256 remains `183f41fce7495413d6d2b990f6f947b110d1d777ed144c37dbe6800d777e1760`. The graph has 411 identities versus the admitted 262-identity baseline. The [authenticated review packet](BUILD-PRIVACY-001-ADMISSION-REVIEW.md) characterizes the 149 additions and their exact SRIs/routes and preserves archive-based legal evidence; it is not policy admission. This run reports no SRI mismatch, release-age finding or missing registry response. Comparing the actual app manifest with the verifier's expected dependencies found only the Cloak/snarkjs additions, with no removed/changed baseline pin or workspace link.

Categories: **A** = code/configuration defect we can safely fix; **B** = dependency upgrade/remediation available; **C** = license/inventory review requiring explicit policy admission; **D** = false positive, with concrete evidence; **E** = unresolved security risk. All 21 verifier findings are **C**. The verifier assigns no vulnerability severity; **unrated/blocking** denotes a blocking policy check. Elliptic is separately **E / LOW**. No safe A/B dependency fix or D false-positive classification was found.

| ID | Package/file | Exact finding | Category | Severity | Remediation |
| --- | --- | --- | --- | --- | --- |
| V01 | `pnpm-lock.yaml (resolved graph)` | `Baseline registry packages/snapshots or peer resolutions changed` | C | Unrated/blocking | Explicit review/admission of the characterized 149-identity graph; do not replace the baseline digest merely to pass. |
| V02 | `pnpm-lock.yaml (counts)` | `BUILD-CLOUD-001 lock count drift: packages=411, registry=411, snapshots=411` | C | Unrated/blocking | Explicit approval of the expanded exact inventory; do not increase counts without admission. |
| V03 | `apps/reference-dapp/package.json` | `BUILD-002 direct manifest versions or workspace links differ` | C | Unrated/blocking | Admit the two added direct pins; baseline pins and workspace links match. |
| V04 | `@cloak.dev/sdk@0.2.5` | `Unapproved direct pin: @cloak.dev/sdk@0.2.5` | C | Unrated/blocking | Review exact SDK identity/SRI/route and Apache-2.0 notice; obtain direct-pin admission. |
| V05 | `snarkjs@0.7.6` | `Unapproved direct pin: snarkjs@0.7.6` | C | Unrated/blocking | Review exact prover identity/SRI and GPL obligations; obtain direct-pin admission. |
| V06 | `@iden3/bigarray@0.0.2` | `Unreviewed dependency license: @iden3/bigarray@0.0.2: GPL-3.0` | C | Unrated/blocking | Resolve missing packaged grant/legal provenance and distribution obligations through explicit policy review. |
| V07 | `@iden3/binfileutils@0.0.12` | `Unreviewed dependency license: @iden3/binfileutils@0.0.12: GPL-3.0` | C | Unrated/blocking | Resolve missing packaged grant/legal provenance and distribution obligations through explicit policy review. |
| V08 | `circomlibjs@0.1.7` | `Unreviewed dependency license: circomlibjs@0.1.7: GPL-3.0` | C | Unrated/blocking | Resolve missing packaged grant/legal provenance and distribution obligations through explicit policy review. |
| V09 | `esprima@1.2.5` | `Unreviewed dependency license: esprima@1.2.5: None` | C | Unrated/blocking | Review/admit the legacy BSD grant for this exact identity; do not silently relabel registry metadata. |
| V10 | `fastfile@0.0.20` | `Unreviewed dependency license: fastfile@0.0.20: GPL-3.0` | C | Unrated/blocking | Review packaged COPYING, attribution and corresponding-source/distribution obligations; admit the exact identity. |
| V11 | `ffjavascript@0.2.63` | `Unreviewed dependency license: ffjavascript@0.2.63: GPL-3.0` | C | Unrated/blocking | Review packaged COPYING, attribution and corresponding-source/distribution obligations; admit the exact identity. |
| V12 | `ffjavascript@0.3.0` | `Unreviewed dependency license: ffjavascript@0.3.0: GPL-3.0` | C | Unrated/blocking | Review packaged COPYING, attribution and corresponding-source/distribution obligations; admit the exact identity. |
| V13 | `ffjavascript@0.3.1` | `Unreviewed dependency license: ffjavascript@0.3.1: GPL-3.0` | C | Unrated/blocking | Review packaged COPYING, attribution and corresponding-source/distribution obligations; admit the exact identity. |
| V14 | `r1csfile@0.0.48` | `Unreviewed dependency license: r1csfile@0.0.48: GPL-3.0` | C | Unrated/blocking | Review packaged COPYING, attribution and corresponding-source/distribution obligations; admit the exact identity. |
| V15 | `snarkjs@0.7.6` | `Unreviewed dependency license: snarkjs@0.7.6: GPL-3.0` | C | Unrated/blocking | Review packaged COPYING, attribution and corresponding-source/distribution obligations; admit the exact identity. |
| V16 | `tweetnacl-util@0.15.1` | `Unreviewed dependency license: tweetnacl-util@0.15.1: Unlicense` | C | Unrated/blocking | Review verified packaged Unlicense text and distribution evidence; admit the exact identity. |
| V17 | `tweetnacl@1.0.3` | `Unreviewed dependency license: tweetnacl@1.0.3: Unlicense` | C | Unrated/blocking | Review verified packaged Unlicense text and distribution evidence; admit the exact identity. |
| V18 | `wasmbuilder@0.0.16` | `Unreviewed dependency license: wasmbuilder@0.0.16: GPL-3.0` | C | Unrated/blocking | Review packaged COPYING, attribution and corresponding-source/distribution obligations; admit the exact identity. |
| V19 | `wasmcurves@0.2.2` | `Unreviewed dependency license: wasmcurves@0.2.2: GPL-3.0` | C | Unrated/blocking | Review packaged COPYING, attribution and corresponding-source/distribution obligations; admit the exact identity. |
| V20 | `Exact rejected identity set` | `Full rejected set drift: missing=[], new=['@iden3/bigarray@0.0.2', '@iden3/binfileutils@0.0.12', 'circomlibjs@0.1.7', 'esprima@1.2.5', 'fastfile@0.0.20', 'ffjavascript@0.2.63', 'ffjavascript@0.3.0', 'ffjavascript@0.3.1', 'r1csfile@0.0.48', 'snarkjs@0.7.6', 'tweetnacl-util@0.15.1', 'tweetnacl@1.0.3', 'wasmbuilder@0.0.16', 'wasmcurves@0.2.2']` | C | Unrated/blocking | Complete all fourteen exact identity/legal reviews; do not blanket-allow GPL/Unlicense or hide rejected identities. |
| V21 | `Registry evidence count` | `Incomplete registry review: 411 of 262` | C | Unrated/blocking | Admit the expanded inventory explicitly; all 411 reads succeeded and 262 is the frozen admitted count. |

Esprima is not classified D: modern registry `license` is missing and the exact identity remains unreviewed under policy. Its legacy BSD evidence narrows the policy decision without invalidating the gate. Fresh installed-file hashes match the SRI-verified archive review: `LICENSE.BSD` SHA-256 `0e74697a68cebdcd61502c30fe80ab7f9e341d995dcd452023654d57133534b1`; `esprima.js` SHA-256 `67d81c6f5f38b9957eaf667af9f4f180c25e6ab48578f01b3db76b6333d62b06`. No automatic registry-license relabeling or exception was added.

## Elliptic investigation

`pnpm audit --audit-level low --json` with pinned pnpm exits **1**: **one LOW**, zero info/moderate/high/critical. Identifier **GHSA-848j-6mx2-7j84 / CVE-2025-14505**; installed **elliptic 6.6.1**; category **E — unresolved security risk**.

The [GitHub reviewed advisory](https://github.com/advisories/GHSA-848j-6mx2-7j84) describes RFC 6979 nonce truncation during ECDSA signing and possible private-key exposure, affects versions through 6.6.1 and lists **no patched version**. Raw npm audit suggests `>=6.6.2`, but fresh [official Elliptic registry metadata](https://registry.npmjs.org/elliptic) has releases only through **6.6.1**, with `latest=6.6.1`. The suggested upgrade is not published and cannot be remediation.

Elliptic is exclusively transitive. `pnpm why elliptic` reports one installed version. Principal path:

`apps/reference-dapp → @cloak.dev/sdk@0.2.5 → circomlibjs@0.1.7 → ethers@5.8.0 → @ethersproject/signing-key@5.8.0 → elliptic@6.6.1`.

The audit enumerates **41 unique Ethers re-export paths**, all with that Cloak/circomlibjs/Ethers prefix and signing-key/Elliptic suffix; complete raw paths are below. Every intermediate Ethers package is 5.8.0. These reach the same installed Elliptic instance, not additional versions.

Fresh [Cloak registry metadata](https://registry.npmjs.org/@cloak.dev%2fsdk) still selects stable **0.2.5**; staging **0.2.6-staging.6c85601** also pins circomlibjs **0.1.7**. [circomlibjs latest](https://registry.npmjs.org/circomlibjs/latest) is **0.1.7**, depending on Ethers `^5.5.1`; [signing-key latest](https://registry.npmjs.org/@ethersproject%2fsigning-key/latest) is **5.8.0**, pinning Elliptic **6.6.1** exactly. No compatible published upgrade removes the advisory. An Ethers major migration, replacement cryptography, fabricated version or audit exception is not a deterministic scoped fix. No dependency changed.

The dependency and signing-key module load during SDK preparation; claiming Elliptic is absent would be false. The vulnerable private-key operations were **not reached in the genuine preparation run**: all instrumented methods recorded zero calls, while the test confirmed signing-key was loaded. Unit coverage additionally instruments mocked preparation and Ed25519 wallet signing. Installed circomlibjs source uses Ethers hashing/byte utilities; owner signing remains external Ed25519 Wallet Standard signing, without EVM/secp256k1 key custody. This is bounded runtime evidence, not a universal reachability proof or reason to suppress audit. Future provider/path changes require revalidation.

## Remaining decisions and checkpoint

`pnpm sbom --sbom-format cyclonedx --sbom-spec-version 1.6 --lockfile-only` passed: **411 components**, accepted by the corrected evaluator. Component names/versions/references and unique references were also inspected. This does not admit licenses or resolve audit.

The verifier remains red on 21 C findings; audit remains red on the E/LOW advisory. Decisions required: exact SDK/prover and expanded graph admission; fourteen license/provenance/distribution reviews, including three missing packaged-grant cases; and explicit unresolved-risk policy/owner decision or waiting for compatible upstream security remediation. No decision was made by this pass. No known A/B engineering fix remains for this requested blocker set. Release work may still be required after policy determines notice/source/distribution obligations; it is not pre-approved here.

The implementation can be committed as a validated, blocked checkpoint. That does not assert dependency admission, owner readiness, funded-mainnet success or production readiness. No allowlist, audit exception, forged admission or acceptance artifact is included. Evidence logs remain ignored under `.turbo/privacy001-closure-*`.

## Complete audit dependency paths

- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/abi>@ethersproject/hash>@ethersproject/abstract-signer>@ethersproject/abstract-provider>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/abstract-provider>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/abstract-signer>@ethersproject/abstract-provider>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/contracts>@ethersproject/abi>@ethersproject/hash>@ethersproject/abstract-signer>@ethersproject/abstract-provider>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/contracts>@ethersproject/abstract-provider>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/contracts>@ethersproject/abstract-signer>@ethersproject/abstract-provider>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/contracts>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/hash>@ethersproject/abstract-signer>@ethersproject/abstract-provider>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/hdnode>@ethersproject/abstract-signer>@ethersproject/abstract-provider>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/hdnode>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/hdnode>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/hdnode>@ethersproject/wordlists>@ethersproject/hash>@ethersproject/abstract-signer>@ethersproject/abstract-provider>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/json-wallets>@ethersproject/abstract-signer>@ethersproject/abstract-provider>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/json-wallets>@ethersproject/hdnode>@ethersproject/abstract-signer>@ethersproject/abstract-provider>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/json-wallets>@ethersproject/hdnode>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/json-wallets>@ethersproject/hdnode>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/json-wallets>@ethersproject/hdnode>@ethersproject/wordlists>@ethersproject/hash>@ethersproject/abstract-signer>@ethersproject/abstract-provider>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/json-wallets>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/providers>@ethersproject/abstract-provider>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/providers>@ethersproject/abstract-signer>@ethersproject/abstract-provider>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/providers>@ethersproject/hash>@ethersproject/abstract-signer>@ethersproject/abstract-provider>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/providers>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/wallet>@ethersproject/abstract-provider>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/wallet>@ethersproject/abstract-signer>@ethersproject/abstract-provider>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/wallet>@ethersproject/hash>@ethersproject/abstract-signer>@ethersproject/abstract-provider>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/wallet>@ethersproject/hdnode>@ethersproject/abstract-signer>@ethersproject/abstract-provider>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/wallet>@ethersproject/hdnode>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/wallet>@ethersproject/hdnode>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/wallet>@ethersproject/hdnode>@ethersproject/wordlists>@ethersproject/hash>@ethersproject/abstract-signer>@ethersproject/abstract-provider>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/wallet>@ethersproject/json-wallets>@ethersproject/abstract-signer>@ethersproject/abstract-provider>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/wallet>@ethersproject/json-wallets>@ethersproject/hdnode>@ethersproject/abstract-signer>@ethersproject/abstract-provider>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/wallet>@ethersproject/json-wallets>@ethersproject/hdnode>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/wallet>@ethersproject/json-wallets>@ethersproject/hdnode>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/wallet>@ethersproject/json-wallets>@ethersproject/hdnode>@ethersproject/wordlists>@ethersproject/hash>@ethersproject/abstract-signer>@ethersproject/abstract-provider>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/wallet>@ethersproject/json-wallets>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/wallet>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/wallet>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/wallet>@ethersproject/wordlists>@ethersproject/hash>@ethersproject/abstract-signer>@ethersproject/abstract-provider>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
- `apps__reference-dapp>@cloak.dev/sdk>circomlibjs>ethers>@ethersproject/wordlists>@ethersproject/hash>@ethersproject/abstract-signer>@ethersproject/abstract-provider>@ethersproject/transactions>@ethersproject/signing-key>elliptic`
