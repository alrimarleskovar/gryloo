# BUILD-PRIVACY-001 — dependency investigation

Investigated on 2026-10-04 against the unchanged privacy lockfile, SHA-256 `0dab416ebfcf01acfbf727abee9eb56c676cfe897f7ca2dc02edcb6935f805b1`. This is investigation evidence, **not approved inventory, license clearance or an audit exception**. No package pin, override, legal text, dependency verifier or CI file changed during this continuation.

The local npm audit reports **one low advisory**, [GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84), for Elliptic 6.6.1. Its path is Cloak → circomlibjs → ethers 5 → `@ethersproject/signing-key` → elliptic. npm's advisory response suggests `>=6.6.2`; GitHub's current advisory page says no patched version. A fresh read of the official npm registry confirms latest Elliptic is **6.6.1** and **6.6.2 is not published**. Cloak's latest stable remains **0.2.5**; the only newer tag is `0.2.6-staging.6c85601`. Switching to an unreviewed staging SDK or locally replacing cryptographic signing code is not a safe scoped remedy. The existing low-severity gate stays failing. The existing Underscore and WebSocket scoped patches remain intact.

The unchanged `python3 scripts/bootstrap-ci.py --verify-dependencies` completes registry reads and fails with **20 violations**: the baseline graph digest changed; packages/snapshots count is **411 rather than 262**; direct manifest/workspace inventory differs; the direct SDK pin is unapproved; 14 licenses are outside the admitted set; the exact exception set differs; and the reviewed-record count differs. It reports **no registry SRI mismatch, release-age violation or missing registry response** in this run. The verifier deliberately emits no approved dependency evidence when these checks fail.

The 14 entries requiring admission are:

| Locked identity | Registry `license` |
| --- | --- |
| `@iden3/bigarray@0.0.2` | GPL-3.0 |
| `@iden3/binfileutils@0.0.12` | GPL-3.0 |
| `circomlibjs@0.1.7` | GPL-3.0 |
| `esprima@1.2.5` | missing |
| `fastfile@0.0.20` | GPL-3.0 |
| `ffjavascript@0.2.63` | GPL-3.0 |
| `ffjavascript@0.3.0` | GPL-3.0 |
| `ffjavascript@0.3.1` | GPL-3.0 |
| `r1csfile@0.0.48` | GPL-3.0 |
| `snarkjs@0.7.6` | GPL-3.0 |
| `tweetnacl-util@0.15.1` | Unlicense |
| `tweetnacl@1.0.3` | Unlicense |
| `wasmbuilder@0.0.16` | GPL-3.0 |
| `wasmcurves@0.2.2` | GPL-3.0 |

The Esprima entry has a legacy `licenses: [{ type: "BSD", ... }]` declaration rather than modern `license` metadata. Inspection of its installed, lock-pinned npm package finds a two-condition BSD text in `LICENSE.BSD` and the same conditions with copyright holders in the `esprima.js` header. SHA-256: legal file `0e74697a68cebdcd61502c30fe80ab7f9e341d995dcd452023654d57133534b1`; source file `67d81c6f5f38b9957eaf667af9f4f180c25e6ab48578f01b3db76b6333d62b06`. This clarifies the missing-metadata finding; it does not silently map or admit that package through the verifier.

Remaining work is to establish the exact added graph and upstream legal obligations, preserve required notices/source obligations for the actual browser distribution, and admit reviewed identities/SRIs/routes through the repository's established inventory process. Increasing counts, accepting all GPL/Unlicense packages, or treating Solana-only usage as an advisory exemption would weaken the gate. No such change was made. This prerequisite is independent of wallet funds, signatures, secrets, API keys or GitHub-hosted Actions.
